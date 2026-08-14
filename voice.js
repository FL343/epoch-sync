'use strict';
// ============================================================
// voice.js -- player-voice pipeline (community feedback + votes)
// ============================================================
// Players submit short free-text feedback (client-writable voice_box board) and
// votes (voice_vote board, rolling window). This job harvests both, sanitizes,
// aggregates vote tallies, and republishes the display set onto trusted-writes
// feed boards (voice_feed_<cat>_<hot|new>) that clients read. Nothing a player
// wrote is ever shown to other players without passing through this job: the
// feed boards are the moderation choke point.
//
// Runs as its OWN workflow (voice.yml), deliberately NOT inside the reconcile
// tick: harvesting two boards + rewriting up to 8 feed boards must never add
// latency to match settlement. State is disjoint (voice.json only), so the
// bot-state pushes of the two workflows can always rebase cleanly past each
// other; the persist step retries the push a few times to absorb the race.
//
// Wire formats (64x int32 details; locked with the client writer -- the client
// repo carries a lockstep test against the constants below):
//   box  entry: [0xB6, VER<<24|cat<<16|enc<<8|len, lang16, itemId, tsMin, body...]
//   vote entry: [0xB7, VER<<24|count<<16, (itemId, tsMin<<2|dir) * count]
//   feed entry: [0xB6, VER<<24|cat<<16|enc<<8|len, lang16, itemId, tsMin, up, down, body...]
// enc: 0=utf-8, 1=utf-16le (client picks whichever is smaller; body <= 208 bytes).
// lang16: two ASCII letters packed c0<<8|c1 (self-describing -- no table to sync).
// dir: 0=clear vote, 1=up, 2=down, 3=report (report is record-only here; the
//      auto-unlist threshold ships with the governance slice).
// tsMin: minutes since VOICE_EPOCH0 (custom epoch -- immune to the int32-seconds
//      2038 family by construction).
// itemId: fnv1a32(steamid + ':' + tsMin) -- recomputed here; mismatch = drop.
//
// Feed placement: one leaderboard entry per account is a Steam invariant, so
// "one display slot per author per board" is structural -- writing an author's
// better item simply overwrites their entry. An item is placeable only while
// its author sid is recoverable (still their current box entry, or already on
// a feed board); items that fall out of both are archived in state (votes kept).
//
// State (voice.json, public repo): sanitized text + HMAC pseudonyms only.
// Author identity for feed writes is recovered from live board reads each run
// and never persisted.
const fs = require('fs');
const v = require('./validate.js');   // main() is require-guarded; safe to import helpers

const VOICE_MAGIC = 0xB6, VOTE_MAGIC = 0xB7, VOICE_VER = 1;
const VOICE_BODY_MAX = 208;                       // bytes; client enforces, we re-check
const VOICE_CATS = ['bug', 'idea', 'balance', 'other'];
const VOICE_EPOCH0 = Date.UTC(2026, 0, 1);        // ms; tsMin = minutes since this
const VOICE_VOTE_WINDOW = 30;                     // votes per rolling upload (2+30*2=62<=64)
const VOICE_LB = process.env.VOICE_LB || 'voice_box';
const VOICE_VOTE_LB = process.env.VOICE_VOTE_LB || 'voice_vote';
const VOICE_FEED_PREFIX = process.env.VOICE_FEED_PREFIX || 'voice_feed';
const VOICE_STATE_FILE = process.env.VOICE_STATE_FILE || 'voice.json';
const VOICE_FEED_CAP = Math.max(1, Number(process.env.VOICE_FEED_CAP || 100));
const VOICE_WRITE_CAP = Math.max(1, Number(process.env.VOICE_WRITE_CAP || 200));  // safety valve per run

function feedBoardName(catIdx, sort) { return VOICE_FEED_PREFIX + '_' + VOICE_CATS[catIdx] + '_' + sort; }

function packLang(code) {
  const s = String(code || 'xx').toLowerCase();
  const a = s.charCodeAt(0) || 120, b = s.charCodeAt(1) || 120;
  return (((a & 0xFF) << 8) | (b & 0xFF)) | 0;
}
function unpackLang(n) { return String.fromCharCode((n >> 8) & 0xFF, n & 0xFF); }

function fnv1a32(s) {
  let h = 0x811c9dc5 >>> 0; s = String(s == null ? '' : s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h | 0;
}

// int32 words -> body bytes -> string (enc 0=utf8 1=utf16le)
function unpackText(words, ofs, len, enc) {
  const buf = Buffer.alloc(Math.max(0, len | 0));
  for (let i = 0; i < len; i++) {
    const w = words[ofs + (i >> 2)] | 0;
    buf[i] = (w >>> ((i & 3) * 8)) & 0xFF;
  }
  return buf.toString(enc === 1 ? 'utf16le' : 'utf8');
}
function packText(str, enc) {
  const buf = Buffer.from(String(str), enc === 1 ? 'utf16le' : 'utf8');
  const words = [];
  for (let i = 0; i < buf.length; i++) {
    const wi = i >> 2;
    if (words.length <= wi) words.push(0);
    words[wi] = (words[wi] | (buf[i] << ((i & 3) * 8))) | 0;
  }
  return { words, len: buf.length };
}

// Strip control chars (keep \n), collapse newline runs, trim. Returns '' when
// nothing survives -- caller drops the item.
function sanitizeText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nowTsMin(nowMs) { return Math.floor(((nowMs == null ? Date.now() : nowMs) - VOICE_EPOCH0) / 60000); }

// Decode + validate one voice_box entry. Returns {itemId,cat,lang,ts,text} or null.
function decodeBoxEntry(sid, words, nowMin) {
  if (!words || words.length < 6 || words[0] !== VOICE_MAGIC) return null;
  const w1 = words[1] | 0;
  const ver = (w1 >>> 24) & 0xFF, cat = (w1 >>> 16) & 0xFF, enc = (w1 >>> 8) & 0xFF, len = w1 & 0xFF;
  if (ver !== VOICE_VER || cat >= VOICE_CATS.length || enc > 1) return null;
  if (len < 1 || len > VOICE_BODY_MAX || words.length < 5 + ((len + 3) >> 2)) return null;
  const lang = unpackLang(words[2] | 0), itemId = words[3] | 0, ts = words[4] | 0;
  if (ts < 0 || ts > nowMin + 1440) return null;                    // future beyond +1d = bad clock/forgery
  if (fnv1a32(String(sid) + ':' + ts) !== itemId) return null;      // provenance check
  const text = sanitizeText(unpackText(words, 5, len, enc));
  if (!text) return null;
  // A tampered oversize body re-encodes past the cap -> fail closed.
  if (Buffer.byteLength(text, 'utf8') > VOICE_BODY_MAX * 3) return null;
  return { itemId, cat, lang, ts, text };
}

// Decode one voice_vote entry into [{itemId, dir, ts}] (window order kept).
function decodeVoteEntry(words) {
  if (!words || words.length < 2 || words[0] !== VOTE_MAGIC) return [];
  const w1 = words[1] | 0;
  const ver = (w1 >>> 24) & 0xFF, count = (w1 >>> 16) & 0xFF;
  if (ver !== VOICE_VER || count > VOICE_VOTE_WINDOW || words.length < 2 + count * 2) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const itemId = words[2 + i * 2] | 0, w = words[3 + i * 2] | 0;
    out.push({ itemId, dir: w & 3, ts: w >>> 2 });
  }
  return out;
}

// Merge decoded vote windows into state.votes: per (voterPid,itemId) the latest
// ts wins (re-vote / un-vote / report are all just the newest direction).
function mergeVotes(votes, voterPid, decoded) {
  let dirty = false;
  for (const vt of decoded) {
    const key = String(vt.itemId);
    const slot = votes[key] || (votes[key] = {});
    const cur = slot[voterPid];
    if (!cur || vt.ts > cur[1] || (vt.ts === cur[1] && vt.dir !== cur[0])) {
      slot[voterPid] = [vt.dir, vt.ts];
      dirty = true;
    }
  }
  return dirty;
}

// Tally one item's votes, excluding the author's own (self votes and self
// reports never count). dir 0 entries count as nothing (cleared).
function tallyVotes(slot, authorPid) {
  let up = 0, down = 0, rep = 0;
  for (const pidKey of Object.keys(slot || {})) {
    if (pidKey === authorPid) continue;
    const dir = slot[pidKey][0] | 0;
    if (dir === 1) up++; else if (dir === 2) down++; else if (dir === 3) rep++;
  }
  return { up, down, rep };
}

// hot = net votes weighted minus age in hours (older items decay one point per
// hour; a fresh +1 outweighs a day-old +25 tie). new = tsMin (custom epoch).
function hotScoreOf(up, down, ts, nowMs) {
  const ageH = Math.floor(((nowMs == null ? Date.now() : nowMs) - (VOICE_EPOCH0 + ts * 60000)) / 3600000);
  const s = (up - down) * 100 - Math.max(0, ageH);
  return Math.max(-2147483648, Math.min(2147483647, s)) | 0;
}

function packFeedDetails(item, up, down) {
  // Prefer the smaller encoding, same rule as the client writer.
  const u8 = packText(item.text, 0), u16 = packText(item.text, 1);
  const pick = u16.len < u8.len ? { enc: 1, p: u16 } : { enc: 0, p: u8 };
  if (pick.p.len > VOICE_BODY_MAX) return null;
  const w1 = ((VOICE_VER & 0xFF) << 24) | ((item.cat & 0xFF) << 16) | ((pick.enc & 0xFF) << 8) | (pick.p.len & 0xFF);
  return [VOICE_MAGIC | 0, w1 | 0, packLang(item.lang), item.itemId | 0, item.ts | 0, up | 0, down | 0].concat(pick.p.words);
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(VOICE_STATE_FILE, 'utf8'));
    return { boards: s.boards || {}, items: s.items || {}, votes: s.votes || {} };
  } catch (e) { return { boards: {}, items: {}, votes: {} }; }
}
function saveState(st) { fs.writeFileSync(VOICE_STATE_FILE, JSON.stringify(st)); }

async function main() {
  const missing = [];
  for (const k of ['APPID', 'STEAM_PUBLISHER_KEY', 'STATE_SALT']) if (!process.env[k]) missing.push(k);
  if (missing.length) { console.error('missing env: ' + missing.join(', ')); process.exit(1); }
  const nowMs = Date.now(), nowMin = nowTsMin(nowMs);
  const st = loadState();
  let dirty = false;

  // ---- resolve boards (find-or-create bypasses the listing lag; box/vote are
  //      client-writable and provisioned out of band -- absent = skip, warn) ----
  const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + process.env.STEAM_PUBLISHER_KEY + '&appid=' + process.env.APPID + '&format=json');
  const list = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []);
  const byName = (n) => { const f = list.find(x => String(x.name || x.Name) === n); return f ? (f.id || f.ID) : null; };
  // Listing-lag bypass for the two client-writable boards: FindOrCreateLeaderboard
  // with createifnotfound=0 is a pure by-name lookup (never creates, so it can
  // never mis-provision them as trusted-writes). Ids are cached in state.
  const findBoard = async (n) => {
    if (st.boards[n]) return st.boards[n];
    let id = byName(n);
    if (!id) {
      const res = await v.postForm('/ISteamLeaderboards/FindOrCreateLeaderboard/v2/', {
        key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, name: n, createifnotfound: 0, format: 'json',
      });
      const lb = (res.json && res.json.result && res.json.result.leaderboard) || (res.json && res.json.leaderboard) || null;
      id = lb && (lb.leaderBoardID || lb.leaderboardID || lb.id || lb.ID) || null;
    }
    if (id) { st.boards[n] = id; dirty = true; }
    return id;
  };
  const boxId = await findBoard(VOICE_LB), voteId = await findBoard(VOICE_VOTE_LB);
  if (!boxId) { console.log('voice box board absent (pre-create ' + VOICE_LB + ', client-writable) -- skip run'); return; }

  // ---- harvest submissions ----
  const sidByItem = {};                        // runtime only, never persisted
  const box = await v.readBoardAll(boxId, 'voice box');
  let newItems = 0;
  for (const e of box.ents) {
    const sid = String(e.steamID);
    const it = decodeBoxEntry(sid, v.decodeDetails(e.detailData), nowMin);
    if (!it) continue;
    sidByItem[String(it.itemId)] = sid;
    const key = String(it.itemId);
    if (!st.items[key]) {
      st.items[key] = { ap: v.pid(sid), cat: it.cat, lang: it.lang, ts: it.ts, text: it.text, st: 'live' };
      newItems++; dirty = true;
    }
  }

  // ---- harvest votes ----
  let voteEnts = 0;
  if (voteId) {
    const vb = await v.readBoardAll(voteId, 'voice votes');
    for (const e of vb.ents) {
      const decoded = decodeVoteEntry(v.decodeDetails(e.detailData));
      if (!decoded.length) continue;
      voteEnts++;
      if (mergeVotes(st.votes, v.pid(String(e.steamID)), decoded)) dirty = true;
    }
  }

  // ---- read current feed boards (recovers author sids for older items) ----
  const feeds = {};                            // name -> { id, entries: {sid: {itemId, score}} }
  for (let c = 0; c < VOICE_CATS.length; c++) {
    for (const sort of ['hot', 'new']) {
      const name = feedBoardName(c, sort);
      let id = st.boards[name] || byName(name);
      if (!id) { id = await v.findOrCreateBoard(name); }
      if (!id) { console.log('feed board unavailable: ' + name + ' -- skip'); continue; }
      if (st.boards[name] !== id) { st.boards[name] = id; dirty = true; }
      const br = await v.readBoardAll(id, name);
      const entries = {};
      for (const e of br.ents) {
        const d = v.decodeDetails(e.detailData);
        if (d[0] === VOICE_MAGIC && d.length >= 7) {
          entries[String(e.steamID)] = { itemId: d[3] | 0, score: e.score | 0, up: d[5] | 0, down: d[6] | 0 };
          if (!sidByItem[String(d[3] | 0)]) sidByItem[String(d[3] | 0)] = String(e.steamID);
        } else {
          entries[String(e.steamID)] = { itemId: 0, score: e.score | 0, up: 0, down: 0 };
        }
      }
      feeds[name] = { id, entries };
    }
  }

  // ---- archive items that are no longer placeable anywhere ----
  for (const key of Object.keys(st.items)) {
    const item = st.items[key];
    if (item.st === 'live' && !sidByItem[key]) { item.st = 'archived'; dirty = true; }
    else if (item.st === 'archived' && sidByItem[key]) { item.st = 'live'; dirty = true; }
  }

  // ---- compute + write desired feed sets ----
  let writes = 0, dels = 0, writeFail = 0;
  for (let c = 0; c < VOICE_CATS.length; c++) {
    // candidates: live items of this category with a recoverable author
    const cand = [];
    for (const key of Object.keys(st.items)) {
      const item = st.items[key];
      if (item.st !== 'live' || (item.cat | 0) !== c || !sidByItem[key]) continue;
      const t = tallyVotes(st.votes[key], item.ap);
      cand.push({ key, item, sid: sidByItem[key], up: t.up, down: t.down });
    }
    for (const sort of ['hot', 'new']) {
      const name = feedBoardName(c, sort);
      const feed = feeds[name];
      if (!feed) continue;
      const scored = cand.map(x => ({ ...x, score: sort === 'hot' ? hotScoreOf(x.up, x.down, x.item.ts, nowMs) : (x.item.ts | 0) }))
        .sort((a, b) => b.score - a.score || (b.item.ts | 0) - (a.item.ts | 0));
      const seen = new Set(); const desired = [];
      for (const x of scored) {                 // one slot per author = their best item
        if (seen.has(x.sid)) continue;
        seen.add(x.sid); desired.push(x);
        if (desired.length >= VOICE_FEED_CAP) break;
      }
      const desiredSids = new Set(desired.map(x => x.sid));
      for (const x of desired) {
        const cur = feed.entries[x.sid];
        if (cur && cur.itemId === (x.item.itemId | 0) && cur.score === x.score && cur.up === x.up && cur.down === x.down) continue;
        if (writes + dels >= VOICE_WRITE_CAP) { v.ghWarn('voice write cap reached (' + VOICE_WRITE_CAP + ') -- rest next run'); break; }
        const det = packFeedDetails({ ...x.item, itemId: x.key | 0 }, x.up, x.down);
        if (!det) continue;
        const r = await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', {
          key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, leaderboardid: feed.id,
          steamid: x.sid, score: x.score, scoremethod: 'ForceUpdate', format: 'json',
        }, det);
        if (r.ok) writes++; else { writeFail++; v.ghWarn('feed write failed ' + name + ' HTTP ' + r.status); }
      }
      for (const sid of Object.keys(feed.entries)) {
        if (desiredSids.has(sid)) continue;
        if (writes + dels >= VOICE_WRITE_CAP) break;
        const r = await v.postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', {
          key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, leaderboardid: feed.id,
          steamid: sid, format: 'json',
        });
        if (r.ok) dels++; else v.ghWarn('feed delete failed ' + name + ' HTTP ' + r.status);
      }
    }
  }

  if (dirty) saveState(st);
  console.log('voice: items+' + newItems + ' (total ' + Object.keys(st.items).length + '), voteEnts=' + voteEnts +
    ', feed writes=' + writes + ' dels=' + dels + (writeFail ? ' FAILED=' + writeFail : '') + (dirty ? ' state saved' : ' no state change'));
}

if (require.main === module) {
  main().catch(e => { console.error('voice run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = {
  VOICE_MAGIC, VOTE_MAGIC, VOICE_VER, VOICE_BODY_MAX, VOICE_CATS, VOICE_EPOCH0,
  VOICE_VOTE_WINDOW, VOICE_LB, VOICE_VOTE_LB, VOICE_FEED_PREFIX, VOICE_FEED_CAP,
  feedBoardName, packLang, unpackLang, fnv1a32, unpackText, packText, sanitizeText,
  nowTsMin, decodeBoxEntry, decodeVoteEntry, mergeVotes, tallyVotes, hotScoreOf, packFeedDetails,
};
