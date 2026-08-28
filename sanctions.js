'use strict';
// ============================================================
// sanctions.js -- anti-cheat sanction sync pipeline (EOS -> boards + platform bans)
// ============================================================
// Consumes the EOS Sanctions "sync" Web API (an incremental event stream with a
// lastLogId cursor; eventType 1=create 2=update 3=delete) and enforces downstream:
//   1. ban gate board (trusted-writes 'ban_board'): one row per banned account,
//      score=1, details[0]=expiry in unix minutes (0 = permanent). The client
//      boot gate / queue gate / roster cross-check all read this board; clearing
//      the row (on unban / expiry-delete event) restores access. Fail-open on the
//      client side, so a missing board only ever weakens, never strands players.
//   2. leaderboard exile: the banned account's rows on the display boards are
//      moved to a same-shape '<board>_banned' shadow board (trusted) and deleted
//      from the source. THE SHADOW IS THE STORAGE: restore on unban reads the
//      shadow row back (score + raw detail bytes preserved). No identity or
//      score ever needs to live in repo state -- the state file stays a cursor.
//   3. platform game bans (optional): ICheatReportingService report+ban per app
//      id listed in BAN_APPIDS (revoke on unban). Runs only where that env is
//      set (one job), so a two-job workflow cannot double-issue.
//   4. a mail note per processed event (rare-event observability; same channel
//      as the feedback digest).
// Own workflow (sanctions.yml), hourly + manual dispatch -- never inside the
// reconcile tick. State file is disjoint (sanctions.json / pt-sanctions.json),
// persisted with the usual rebase-retry.
//
// Identity: sync events carry identityProvider + accountId for accounts that
// authenticated through the platform identity provider; accountId may be the
// full 64-bit id or the 32-bit account number (converted here). Events without
// a platform identity are logged (pseudonymized) and skipped -- there is
// nothing to enforce against on this side.
// Logs are public (Actions): account ids only ever appear as HMAC pseudonyms.
// The mail body may carry the real id (private inbox, needs to be actionable).
const fs = require('fs');
const crypto = require('crypto');
const v = require('./validate.js');

const SN_STATE_FILE = process.env.SN_STATE_FILE || 'sanctions.json';
const BAN_LB = process.env.BAN_LB || 'ban_board';            // lockstep: client eac-gate BOARD_BAN
const BAN_SHADOW_SUFFIX = '_banned';
// Display boards to exile. Extra names (season ladders etc.) come in via env --
// keep repo defaults to the safe common set.
const EXILE_BOARDS = String(process.env.EXILE_BOARDS || 'xp_ladder,endless_board,endless_board_trio,card_box')
  .split(',').map(s => s.trim()).filter(Boolean);
const BAN_APPIDS = String(process.env.BAN_APPIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const EOS_BASE = process.env.EOS_BASE || 'https://api.epicgames.dev';
const SN_PAGE_LIMIT = Math.max(1, Number(process.env.SN_PAGE_LIMIT || 100));
const SN_EVENT_CAP = Math.max(1, Number(process.env.SN_EVENT_CAP || 500));   // safety valve per run
// steamid64 universe base (0x110000100000000). Hex on purpose: the repo hygiene
// scan rejects raw 17-digit ids anywhere outside test/.
const SID64_BASE = 0x110000100000000n;

const pid = (s) => crypto.createHmac('sha256', String(process.env.STATE_SALT || '')).update(String(s)).digest('hex').slice(0, 16);
const plog = (s) => pid(s).slice(0, 8);

function loadState() {
  try { return JSON.parse(fs.readFileSync(SN_STATE_FILE, 'utf8')); }
  catch (e) { return { lastLogId: 0, boards: {} }; }
}
function saveState(st) { fs.writeFileSync(SN_STATE_FILE, JSON.stringify(st, null, 0)); }

// ---- EOS auth (client_credentials on the trusted-server client) ----
async function eosToken() {
  const id = process.env.EOS_TRUSTED_CLIENT_ID, sec = process.env.EOS_TRUSTED_CLIENT_SECRET;
  const dep = process.env.EOS_DEPLOYMENT_ID;
  if (!id || !sec || !dep) throw new Error('missing EOS_TRUSTED_CLIENT_ID/SECRET or EOS_DEPLOYMENT_ID');
  const res = await fetch(EOS_BASE + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&deployment_id=' + encodeURIComponent(dep),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.access_token) throw new Error('EOS token HTTP ' + res.status + ' ' + JSON.stringify(j && j.errorCode || null));
  return j.access_token;
}

// ---- sync fetch (path shape tolerant: docs list /sanctions/v1/sync; some EOS
//      surfaces scope by deployment -- try plain first, fall back once) ----
async function fetchSyncPage(token, lastLogId) {
  const q = '?limit=' + SN_PAGE_LIMIT + (lastLogId ? '&lastLogId=' + encodeURIComponent(lastLogId) : '');
  const tryUrls = [
    EOS_BASE + '/sanctions/v1/sync' + q,
    EOS_BASE + '/sanctions/v1/' + encodeURIComponent(process.env.EOS_DEPLOYMENT_ID || '') + '/sync' + q,
  ];
  let last = null;
  for (const url of tryUrls) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 404) { last = res; continue; }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error('sanctions sync HTTP ' + res.status + ' ' + JSON.stringify(j && (j.errorCode || j.message) || null));
    return j;
  }
  throw new Error('sanctions sync 404 on both path shapes (policy missing sanctions:syncSanctionEvents?)' + (last ? ' HTTP ' + last.status : ''));
}

// ---- event normalization (field-name tolerant; pure, unit-tested) ----
function normalizeEvents(json) {
  const raw = Array.isArray(json) ? json
    : (json && Array.isArray(json.elements)) ? json.elements
      : (json && Array.isArray(json.events)) ? json.events
        : (json && Array.isArray(json.data)) ? json.data : [];
  const pick = (o, names) => { for (const n of names) if (o && o[n] != null) return o[n]; return null; };
  return raw.map(o => ({
    logId: Number(pick(o, ['logId', 'logID', 'id'])) || 0,
    eventType: Number(pick(o, ['eventType', 'event_type', 'type'])) || 0,
    puid: String(pick(o, ['productUserId', 'productUserID', 'puid']) || ''),
    action: String(pick(o, ['action']) || ''),
    pending: !!pick(o, ['pending']),
    automated: !!pick(o, ['automated']),
    idp: String(pick(o, ['identityProvider', 'identityProviderId']) || ''),
    accountId: String(pick(o, ['accountId', 'accountID', 'account_id']) || ''),
    expiresAt: pick(o, ['expirationTimestamp', 'expiresAt', 'expiration']) || null,
    refId: String(pick(o, ['referenceId', 'refId']) || ''),
  })).filter(e => e.logId > 0);
}

// steam identity -> steamid64 digits, or null when the event carries none.
function sidOfEvent(ev) {
  if (!/steam/i.test(ev.idp || '')) return null;
  const a = String(ev.accountId || '').replace(/\D/g, '');
  if (!a) return null;
  if (a.length === 17) return a;                       // already a steamid64
  const n = BigInt(a);
  if (n > 0n && n < 4294967296n) return String(SID64_BASE + n);   // 32-bit account number
  return null;
}

// expiry -> unix minutes int32 (0 = permanent/unknown). Accepts epoch seconds,
// epoch millis, or an ISO string.
function expiryMinOf(x) {
  if (x == null) return 0;
  let ms = 0;
  if (typeof x === 'number') ms = x > 4e10 ? x : x * 1000;
  else { const t = Date.parse(String(x)); ms = Number.isFinite(t) ? t : 0; }
  if (!(ms > Date.now())) return 0;
  return Math.floor(ms / 60000) | 0;
}

// eventType + pending -> enforcement verb ('ban' | 'unban' | 'skip'); pure.
function verbOf(ev) {
  if (ev.eventType === 3) return 'unban';
  if (ev.eventType === 1 || ev.eventType === 2) return ev.pending ? 'skip' : 'ban';
  return 'skip';
}

// ---- raw-detail rewrite helper (exile/restore preserves the source row's
//      detail bytes verbatim; detailData comes back as hex) ----
function hexToPct(hex) {
  const m = String(hex || '').match(/../g) || [];
  return m.map(b => '%' + b).join('');
}
async function postFormDetailsHex(path, params, hex) {
  const body = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&')
    + (hex ? '&details=' + hexToPct(hex) : '');
  const res = await fetch(v.BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json: j };
}

async function setRow(boardId, sid, score, detailHex) {
  const r = await postFormDetailsHex('/ISteamLeaderboards/SetLeaderboardScore/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID,
    leaderboardid: boardId, steamid: sid, score: score | 0, scoremethod: 'ForceUpdate', format: 'json',
  }, detailHex || '');
  return r.ok;
}
async function delRow(boardId, sid) {
  const r = await v.postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID,
    leaderboardid: boardId, steamid: sid, format: 'json',
  });
  return r.ok;
}

// ---- platform game bans (ICheatReportingService; publisher key scope) ----
async function steamBan(sid, appid, durationSec, why) {
  const rep = await v.postForm('/ICheatReportingService/ReportPlayerCheating/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid,
    heuristic: 1, severity: 10, format: 'json',
  });
  const reportid = rep.json && rep.json.response && rep.json.response.reportid;
  if (!reportid) { v.ghWarn('steam ban: no reportid (app ' + appid + ', HTTP ' + rep.status + ')'); return false; }
  const ban = await v.postForm('/ICheatReportingService/RequestPlayerGameBan/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid, reportid,
    duration: durationSec | 0, delayban: 0, flags: 0, cheatdescription: why, format: 'json',
  });
  if (!ban.ok) v.ghWarn('steam ban failed (app ' + appid + ', HTTP ' + ban.status + ')');
  return ban.ok;
}
async function steamUnban(sid, appid) {
  const r = await v.postForm('/ICheatReportingService/RemovePlayerGameBan/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid, format: 'json',
  });
  if (!r.ok) v.ghWarn('steam unban failed (app ' + appid + ', HTTP ' + r.status + ')');
  return r.ok;
}

// ---- enforcement (idempotent by construction: absent source row = skip;
//      re-running a processed event converges to the same end state) ----
async function enactBan(boards, sid, expMin, refId) {
  let moved = 0;
  await setRow(boards.ban, sid, 1, hexFromInts([expMin | 0]));
  for (const name of EXILE_BOARDS) {
    const srcId = boards.src[name], shId = boards.shadow[name];
    if (!srcId || !shId) continue;
    const row = await v.readUserEntry(srcId, sid, 'exile ' + name);
    if (!row) continue;
    const okW = await setRow(shId, sid, row.score | 0, String(row.detailData || ''));
    if (!okW) { v.ghWarn('exile write failed ' + name + ' (' + plog(sid) + ') -- source row kept'); continue; }
    await delRow(srcId, sid);
    moved++;
  }
  let bans = 0;
  const dur = expMin > 0 ? Math.max(60, expMin * 60 - Math.floor(Date.now() / 1000)) : 315360000;
  for (const app of BAN_APPIDS) if (await steamBan(sid, app, dur, 'anti-cheat sanction ' + (refId || ''))) bans++;
  console.log('sanction BAN ' + plog(sid) + ': gate row set, exiled ' + moved + ' board row(s), platform bans ' + bans + '/' + BAN_APPIDS.length);
  return { moved, bans };
}

async function enactUnban(boards, sid) {
  let restored = 0;
  await delRow(boards.ban, sid);
  for (const name of EXILE_BOARDS) {
    const srcId = boards.src[name], shId = boards.shadow[name];
    if (!srcId || !shId) continue;
    const row = await v.readUserEntry(shId, sid, 'restore ' + name);
    if (!row) continue;
    const okW = await setRow(srcId, sid, row.score | 0, String(row.detailData || ''));
    if (!okW) { v.ghWarn('restore write failed ' + name + ' (' + plog(sid) + ') -- shadow row kept'); continue; }
    await delRow(shId, sid);
    restored++;
  }
  let unbans = 0;
  for (const app of BAN_APPIDS) if (await steamUnban(sid, app)) unbans++;
  console.log('sanction UNBAN ' + plog(sid) + ': gate row cleared, restored ' + restored + ' board row(s), platform unbans ' + unbans + '/' + BAN_APPIDS.length);
  return { restored, unbans };
}

// int32[] -> hex (little-endian words), the inverse of decode; tiny local twin
// of the pctBytes packing so setRow can take one hex-string shape everywhere.
function hexFromInts(arr) {
  const b = Buffer.alloc(arr.length * 4);
  arr.forEach((x, i) => b.writeInt32LE(x | 0, i * 4));
  return b.toString('hex');
}

async function maybeMail(lines) {
  const to = process.env.SN_MAIL_TO || process.env.FB_DIGEST_TO, apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey || !lines.length) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FB_DIGEST_FROM || 'onboarding@resend.dev',
        to: [to],
        subject: (process.env.FB_DIGEST_TAG || '') + 'sanctions: ' + lines.length + ' event(s)',
        text: lines.join('\n'),
      }),
    });
    if (!res.ok) v.ghWarn('sanctions mail failed HTTP ' + res.status);
  } catch (e) { v.ghWarn('sanctions mail threw: ' + (e && e.message)); }
}

async function resolveBoards(st) {
  const boards = { ban: null, src: {}, shadow: {} };
  const cached = st.boards || (st.boards = {});
  const get = async (name, trusted) => {
    if (cached[name]) return cached[name];
    const id = await v.findOrCreateBoard(name, trusted);
    if (id) cached[name] = id;
    return id;
  };
  boards.ban = await get(BAN_LB, true);
  for (const name of EXILE_BOARDS) {
    // source boards are provisioned elsewhere; find-or-create keeps this robust
    // against listing lag but a trusted-vs-open mismatch never matters for reads,
    // and we only ever write rows that already existed on the source.
    boards.src[name] = await get(name, true);
    boards.shadow[name] = await get(name + BAN_SHADOW_SUFFIX, true);
  }
  return boards;
}

async function main() {
  const missing = [];
  for (const k of ['APPID', 'STEAM_PUBLISHER_KEY', 'STATE_SALT', 'EOS_TRUSTED_CLIENT_ID', 'EOS_TRUSTED_CLIENT_SECRET', 'EOS_DEPLOYMENT_ID']) {
    if (!process.env[k]) missing.push(k);
  }
  if (missing.length) { console.error('missing env: ' + missing.join(', ')); process.exit(1); }
  const st = loadState();
  const token = await eosToken();
  const mail = [];
  let processed = 0, skipped = 0, cursor = Number(st.lastLogId) || 0;
  let boards = null;
  for (let page = 0; page < 10 && processed + skipped < SN_EVENT_CAP; page++) {
    const json = await fetchSyncPage(token, cursor);
    const evs = normalizeEvents(json).sort((a, b) => a.logId - b.logId).filter(e => e.logId > cursor);
    if (!evs.length) break;
    for (const ev of evs) {
      const verb = verbOf(ev);
      const sid = sidOfEvent(ev);
      if (verb === 'skip' || !sid) {
        console.log('sanction event log=' + ev.logId + ' type=' + ev.eventType + ' ' +
          (sid ? plog(sid) : 'no-steam-identity(puid ' + plog(ev.puid) + ')') + ' -> skip' + (ev.pending ? ' (pending)' : ''));
        skipped++;
        cursor = ev.logId;
        continue;
      }
      if (!boards) boards = await resolveBoards(st);
      if (!boards.ban) throw new Error('ban gate board unavailable -- refusing to advance the cursor');
      if (verb === 'ban') {
        const r = await enactBan(boards, sid, expiryMinOf(ev.expiresAt), ev.refId);
        mail.push('BAN ' + sid + ' action=' + ev.action + (ev.automated ? ' (automated)' : '') +
          ' exp=' + (expiryMinOf(ev.expiresAt) || 'permanent') + ' exiled=' + r.moved + ' platform=' + r.bans + ' log=' + ev.logId);
      } else {
        const r = await enactUnban(boards, sid);
        mail.push('UNBAN ' + sid + ' restored=' + r.restored + ' platform=' + r.unbans + ' log=' + ev.logId);
      }
      processed++;
      cursor = ev.logId;
    }
    if (evs.length < SN_PAGE_LIMIT) break;
  }
  if (cursor !== (Number(st.lastLogId) || 0) || !fs.existsSync(SN_STATE_FILE)) {
    st.lastLogId = cursor;
    saveState(st);
  }
  await maybeMail(mail);
  console.log('sanctions: processed ' + processed + ', skipped ' + skipped + ', cursor ' + cursor);
}

if (require.main === module) {
  main().catch(e => { console.error('sanctions run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = {
  SN_STATE_FILE, BAN_LB, BAN_SHADOW_SUFFIX, EXILE_BOARDS, SID64_BASE,
  normalizeEvents, sidOfEvent, expiryMinOf, verbOf, hexToPct, hexFromInts,
  loadState, saveState,
};
