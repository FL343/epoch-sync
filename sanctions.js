'use strict';
// ============================================================
// sanctions.js -- anti-cheat sanction sync pipeline (EOS -> boards + platform bans)
// ============================================================
// Consumes the EOS Sanctions "sync" Web API (an incremental event stream with a
// lastLogId cursor; eventType 1=create 2=update 3=delete) and enforces downstream:
//   1. ban gate board (trusted-writes 'ban_board'): one row per sanctioned
//      account, score=1. Detail layout (client eac-gate decodes the same way):
//        details[0] = expiry in unix minutes (0 = permanent)
//        details[1] = action code: 1 = full ban (RESTRICT_GAME_ACCESS et al),
//                     2 = matchmaking-only (RESTRICT_MATCHMAKING). Absent/0 =
//                     legacy row = full ban (conservative).
//        details[2..5] = sanction referenceId (UUID, 16 bytes as 4 big-endian
//                     int32s; all-zero = absent) -- the appeal handle the client
//                     must show even when the guard is not running.
//      The client boot gate / queue gate / roster cross-check all read this
//      board; clearing the row (on unban / expiry) restores access. Fail-open on
//      the client side, so a missing board only ever weakens, never strands.
//   2. leaderboard exile (FULL bans only -- a matchmaking restriction is not a
//      score-fraud verdict): the banned account's rows on the display boards are
//      moved to a same-shape '<board>_banned' shadow board (trusted) and deleted
//      from the source. THE SHADOW IS THE STORAGE: restore on unban reads the
//      shadow row back (score + raw detail bytes preserved). No identity or
//      score ever needs to live in repo state -- the state file stays a cursor.
//   3. platform game bans (optional; FULL bans only -- a Steam game ban is a
//      public account mark): ICheatReportingService report+ban per app id listed
//      in BAN_APPIDS (revoke on unban). Runs only where that env is set (one
//      job), so a two-job workflow cannot double-issue.
//   4. expiry sweep: EOS does not emit a sync event when a temporary sanction
//      lapses on its own (only create/update/delete are in the stream), so a
//      details[0] deadline that passes would otherwise leave the gate row -- and
//      the exiled scores -- in place forever. Every run scans ban_board for
//      expired rows and runs the unban path on them (idempotent; the client
//      additionally fail-opens past the deadline locally so nobody waits on us).
//   5. a mail note per processed event (rare-event observability; same channel
//      as the feedback digest).
// Own workflow (sanctions.yml), hourly + manual dispatch -- never inside the
// reconcile tick. State file is disjoint (sanctions.json / pt-sanctions.json),
// persisted with the usual rebase-retry.
//
// Identity (2026-08-28 drill finding, docs-confirmed): sync events DO carry
// identityProvider + accountId fields, but portal-created sanctions leave both
// null -- only productUserId is guaranteed. So the platform id is resolved via
// the Connect Web API instead (GET /user/v1/product-users?productUserId=...,
// policy action queryProductUsersForAnyUser, max 16 per call), which returns the
// account list per PUID: [{accountId, identityProviderId:'steam', displayName}].
// The event's own identity fields are still used when present (saves a call).
// A PUID with no steam account linked is logged (pseudonymized) and skipped --
// there is nothing to enforce against on the board side.
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
const SN_EVENT_CAP = Math.max(1, Number(process.env.SN_EVENT_CAP || 500));   // safety valve per run
const SN_MAP_BATCH = 16;   // documented max productUserId values per Connect query

const pid = (s) => crypto.createHmac('sha256', String(process.env.STATE_SALT || '')).update(String(s)).digest('hex').slice(0, 16);
const plog = (s) => pid(s).slice(0, 8);

function loadState() {
  // lastLogId is an opaque STRING id (drill-verified 2026-08-28: a UUID, not a
  // number -- the docs type it "string"); '' = no cursor yet (full sync).
  try {
    const st = JSON.parse(fs.readFileSync(SN_STATE_FILE, 'utf8'));
    if (typeof st.lastLogId !== 'string') st.lastLogId = '';   // migrate the pre-drill numeric field
    if (!st.boards) st.boards = {};
    return st;
  } catch (e) { return { lastLogId: '', boards: {} }; }
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

// ---- sync fetch (docs: GET /sanctions/v1/sync, query param lastLogId only) ----
// The endpoint returns the next batch of events after the cursor; batch size is the
// server's choice (no client-side limit parameter exists). Events arrive in log order
// -- the caller consumes them as-is and takes the LAST element's logId as the next
// cursor. Repeat until an empty batch = caught up.
async function fetchSyncBatch(token, lastLogId) {
  const url = EOS_BASE + '/sanctions/v1/sync' + (lastLogId ? '?lastLogId=' + encodeURIComponent(lastLogId) : '');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error('sanctions sync HTTP ' + res.status + ' ' + JSON.stringify(j && (j.errorCode || j.message) || null));
  return j;
}

// ---- event normalization (field names per the Sanctions Web API docs) ----
// Thin mapper so the rest of the file never touches raw payload shape. logId stays
// a STRING (resume token). Events with no logId/puid are unusable and dropped.
function normalizeEvents(json) {
  const raw = (json && Array.isArray(json.elements)) ? json.elements : (Array.isArray(json) ? json : []);
  return raw.map(o => ({
    logId: String(o.logId || ''),
    eventType: Number(o.eventType) || 0,
    puid: String(o.productUserId || ''),
    action: String(o.action || ''),
    pending: !!o.pending,
    automated: !!o.automated,
    idp: String(o.identityProvider || ''),
    accountId: String(o.accountId || ''),
    expiresAt: o.expirationTimestamp || null,
    refId: String(o.referenceId || ''),
    justification: String(o.justification || ''),
    displayName: String(o.displayName || ''),
  })).filter(e => e.logId && e.puid);
}

// steam id straight off the event, when it carries one. Portal-created sanctions
// leave identityProvider/accountId null (drill-verified 2026-08-28), so this is only
// a fast path -- resolveSteamIds below is the real resolver.
function sidOfEvent(ev) {
  if (!/steam/i.test(ev.idp || '')) return null;
  const a = String(ev.accountId || '').replace(/[^0-9]/g, '');
  return a.length === 17 ? a : null;
}

// PUID -> steamid64 via the Connect Web API (docs: GET /user/v1/product-users,
// policy action queryProductUsersForAnyUser, max 16 productUserId values/call).
// Returns a plain {puid: sid} map; a PUID with no linked steam account is absent.
async function resolveSteamIds(token, puids) {
  const out = {};
  for (let i = 0; i < puids.length; i += SN_MAP_BATCH) {
    const batch = puids.slice(i, i + SN_MAP_BATCH);
    const q = batch.map(x => 'productUserId=' + encodeURIComponent(x)).join('&');
    const res = await fetch(EOS_BASE + '/user/v1/product-users?' + q,
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error('product-users HTTP ' + res.status + ' ' + JSON.stringify(j && j.errorCode || null));
    const users = (j && j.productUsers) || {};
    for (const puid of Object.keys(users)) {
      const accts = (users[puid] && users[puid].accounts) || [];
      const steam = accts.find(a => String(a.identityProviderId || '').toLowerCase() === 'steam');
      const sid = steam && String(steam.accountId || '').replace(/[^0-9]/g, '');
      if (sid && sid.length === 17) out[puid] = sid;
    }
  }
  return out;
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

// ---- ban_board detail codec (client eac-gate.js decodes the same layout) ----
// Action string -> code. Only RESTRICT_MATCHMAKING maps to the softer queue-only
// gate; every other (or unknown/custom) action stays a full ban -- unknown
// severity must not accidentally widen access.
const ACT_FULL = 1, ACT_MM = 2;
function actionCodeOf(action) {
  return /RESTRICT_MATCHMAKING/i.test(String(action || '')) ? ACT_MM : ACT_FULL;
}
// UUID string -> 4 big-endian int32s (all-zero when absent/malformed).
function refIdInts(refId) {
  const hex = String(refId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return [0, 0, 0, 0];
  const out = [];
  for (let i = 0; i < 4; i++) out.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16) | 0);
  return out;
}
// Inverse (tooling/tests; the client carries its own mirror -- lockstep-pinned).
function refIdFromInts(ints) {
  if (!Array.isArray(ints) || ints.length < 4 || ints.every(x => (x | 0) === 0)) return '';
  let hex = '';
  for (let i = 0; i < 4; i++) hex += ((ints[i] | 0) >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function banDetails(expMin, actCode, refId) {
  return [expMin | 0, actCode | 0].concat(refIdInts(refId));
}

// ---- board row moves (exile/restore) ----
// Detail bytes are round-tripped through validate.js's own codec (decodeDetails ->
// int32 array -> postFormDetails) rather than a second hand-rolled hex/percent
// encoder: one encoder in the repo, and the shadow row is byte-identical to the
// source row it replaces.
async function setRow(boardId, sid, score, detailHex) {
  const det = detailHex ? v.decodeDetails(String(detailHex)) : null;
  const params = {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID,
    leaderboardid: boardId, steamid: sid, score: score | 0, scoremethod: 'ForceUpdate', format: 'json',
  };
  const r = (det && det.length)
    ? await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', params, det)
    : await v.postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', params);
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
// Two-step per moderation/TOOLS.md: report (carries the evidence text, so an appeal
// review can find it by reportid -- moderation README rule 2) then ban. Only runs
// where BAN_APPIDS is set; unset (the default) = boards-only enforcement.
async function steamBan(sid, appid, durationSec, ev) {
  const evidence = 'EOS sanction ' + (ev.refId || '?') + ' action=' + (ev.action || '?') +
    (ev.automated ? ' (automated detection)' : ' (manual)') +
    ' puid=' + (ev.puid || '?') + ' justification: ' + (ev.justification || '(none)');
  const rep = await v.postForm('/ICheatReportingService/ReportPlayerCheating/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid,
    heuristic: 1, severity: 10, raw_report: evidence, format: 'json',
  });
  const reportid = rep.json && rep.json.response && rep.json.response.reportid;
  if (!reportid) { v.ghWarn('steam ban: no reportid (app ' + appid + ', HTTP ' + rep.status + ')'); return false; }
  const ban = await v.postForm('/ICheatReportingService/RequestPlayerGameBan/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid, reportid,
    duration: durationSec | 0, delayban: 0, flags: 0,
    cheatdescription: 'EOS sanction ' + (ev.refId || ''), format: 'json',
  });
  if (!ban.ok) v.ghWarn('steam ban failed (app ' + appid + ', HTTP ' + ban.status + ')');
  else console.log('  steam ban issued app=' + appid + ' report=' + reportid);
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
async function restoreRows(boards, sid) {
  let restored = 0;
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
  return restored;
}

async function enactBan(boards, sid, expMin, ev) {
  const actCode = actionCodeOf(ev && ev.action);
  await setRow(boards.ban, sid, 1, v.encodeDetails(banDetails(expMin, actCode, ev && ev.refId)));
  if (actCode === ACT_MM) {
    // Matchmaking-only: gate row is the whole enforcement (client blocks queue
    // contexts, everything else stays open). Also walk the restore/unban path so
    // a full->mm downgrade (update event) hands the scores and platform access
    // back; on a fresh mm sanction both are structural no-ops.
    const restored = await restoreRows(boards, sid);
    let unbans = 0;
    for (const app of BAN_APPIDS) if (await steamUnban(sid, app)) unbans++;
    console.log('sanction MM-RESTRICT ' + plog(sid) + ': gate row set (queue-only)' +
      (restored ? ', restored ' + restored + ' row(s) (downgrade)' : ''));
    return { moved: 0, bans: 0 };
  }
  let moved = 0;
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
  // pass the event object through -- steamBan reads refId/action/justification off
  // it for the evidence text (first cut passed a pre-baked string: '[object Object]')
  for (const app of BAN_APPIDS) if (await steamBan(sid, app, dur, ev || {})) bans++;
  console.log('sanction BAN ' + plog(sid) + ': gate row set, exiled ' + moved + ' board row(s), platform bans ' + bans + '/' + BAN_APPIDS.length);
  return { moved, bans };
}

async function enactUnban(boards, sid) {
  await delRow(boards.ban, sid);
  const restored = await restoreRows(boards, sid);
  let unbans = 0;
  for (const app of BAN_APPIDS) if (await steamUnban(sid, app)) unbans++;
  console.log('sanction UNBAN ' + plog(sid) + ': gate row cleared, restored ' + restored + ' board row(s), platform unbans ' + unbans + '/' + BAN_APPIDS.length);
  return { restored, unbans };
}

// ---- expiry sweep (pipeline leg 4) ----
// Pure part: which rows of the gate board have lapsed. details[0] is unix
// minutes; 0 = permanent (never sweeps). Exported for tests.
function expiredSids(ents, nowMs) {
  const out = [];
  for (const e of (ents || [])) {
    if ((e.score | 0) <= 0) continue;
    const det = v.decodeDetails(String(e.detailData || ''));
    const expMin = det && det.length ? (det[0] | 0) : 0;
    if (expMin > 0 && expMin * 60000 <= nowMs) out.push(String(e.steamID));
  }
  return out;
}

async function sweepExpired(boards, mail) {
  const { ents } = await v.readBoardAll(boards.ban, 'ban sweep');
  const lapsed = expiredSids(ents, Date.now());
  for (const sid of lapsed) {
    const r = await enactUnban(boards, sid);
    mail.push('EXPIRE ' + sid + ' restored=' + r.restored + ' platform=' + r.unbans);
  }
  return lapsed.length;
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
  let processed = 0, skipped = 0, unmapped = 0;
  let cursor = String(st.lastLogId || '');
  const cursor0 = cursor;
  const boards0 = JSON.stringify(st.boards || {});   // persist when the id cache grows (sweep-only runs)
  let boards = null;
  // Documented resume protocol: ask with the cursor, consume the batch IN THE ORDER
  // RETURNED, then set the cursor to the LAST element's logId. logId is opaque -- it
  // is never sorted or compared, only carried forward. An empty batch = caught up.
  for (let round = 0; round < 20 && processed + skipped < SN_EVENT_CAP; round++) {
    const evs = normalizeEvents(await fetchSyncBatch(token, cursor));
    if (!evs.length) break;
    // One identity lookup per batch (docs cap 16/call; resolveSteamIds pages).
    const need = [...new Set(evs.filter(e => !sidOfEvent(e)).map(e => e.puid))];
    const map = need.length ? await resolveSteamIds(token, need) : {};
    for (const ev of evs) {
      cursor = ev.logId;                       // advance even when skipped: it is a resume token
      const verb = verbOf(ev);
      if (verb === 'skip') {
        console.log('sanction event ' + plog(ev.puid) + ' type=' + ev.eventType + ' -> skip' + (ev.pending ? ' (pending)' : ''));
        skipped++;
        continue;
      }
      const sid = sidOfEvent(ev) || map[ev.puid] || null;
      if (!sid) {
        // No steam account linked to this PUID: nothing to enforce on the board side.
        // The client-side gate still applies (the guard queries its own sanctions).
        v.ghWarn('sanction ' + verb + ' for ' + plog(ev.puid) + ' has no linked steam account -- board enforcement skipped');
        unmapped++; skipped++;
        continue;
      }
      if (!boards) boards = await resolveBoards(st);
      if (!boards.ban) throw new Error('ban gate board unavailable -- refusing to advance the cursor');
      if (verb === 'ban') {
        const r = await enactBan(boards, sid, expiryMinOf(ev.expiresAt), ev);
        mail.push((actionCodeOf(ev.action) === ACT_MM ? 'MM-RESTRICT ' : 'BAN ') + sid + ' action=' + ev.action + (ev.automated ? ' (automated)' : '') +
          ' exp=' + (expiryMinOf(ev.expiresAt) || 'permanent') + ' exiled=' + r.moved + ' platform=' + r.bans + ' ref=' + ev.refId);
      } else {
        const r = await enactUnban(boards, sid);
        mail.push('UNBAN ' + sid + ' restored=' + r.restored + ' platform=' + r.unbans + ' ref=' + ev.refId);
      }
      processed++;
    }
  }
  // Expiry sweep every run (leg 4): natural lapses never appear in the event
  // stream. Board resolution is cached in state, the gate board is tiny, and the
  // sweep is idempotent -- a failed run just retries next tick.
  let lapsed = 0;
  try {
    if (!boards) boards = await resolveBoards(st);
    if (boards.ban) lapsed = await sweepExpired(boards, mail);
  } catch (e) { v.ghWarn('expiry sweep failed (retries next tick): ' + (e && e.message)); }
  if (cursor !== cursor0 || JSON.stringify(st.boards || {}) !== boards0 || !fs.existsSync(SN_STATE_FILE)) {
    st.lastLogId = cursor;
    saveState(st);
  }
  await maybeMail(mail);
  console.log('sanctions: processed ' + processed + ', skipped ' + skipped + (unmapped ? ' (unmapped ' + unmapped + ')' : '') +
    (lapsed ? ', expired ' + lapsed : '') + ', cursor ' + (cursor ? cursor.slice(0, 8) + '...' : '(none)'));
}

if (require.main === module) {
  main().catch(e => { console.error('sanctions run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = {
  SN_STATE_FILE, BAN_LB, BAN_SHADOW_SUFFIX, EXILE_BOARDS, SN_MAP_BATCH,
  normalizeEvents, sidOfEvent, expiryMinOf, verbOf, loadState, saveState,
  ACT_FULL, ACT_MM, actionCodeOf, refIdInts, refIdFromInts, banDetails, expiredSids,
};
