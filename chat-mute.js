'use strict';
// Chat moderation lane -- pure helpers for validate.js (processChatMute does the IO).
//
// Two boards, no server:
//   1. `chat_mute` (trusted writes): one row per muted account, score = expiry in unix MINUTES (0 = permanent).
//      Clients read the whole board (<=100 rows) on channel join and every 10 min: receivers hide the row's messages,
//      the muted account's own client refuses to send. Manual mutes are written straight onto this board by the ops
//      tool (SetLeaderboardScore with the publisher key) -- the repo keeps no identity list. This lane only
//      (a) adds AUTOMATIC mutes and (b) sweeps expired rows (manual and automatic alike).
//   2. `chat_report_box` (client writes, friends reads): one row per REPORTER = the snapshot of the last chat line they
//      reported (target sid + scope + tsMin + fnv hash of the full text + up to 228 bytes of text, utf8 or utf16le).
//      A snapshot is the reporter's claim (any client can forge one) -> evidence for a human only. The automatic
//      rule counts DISTINCT reporters per target inside a sliding window and never reads the text:
//        >= AUTO_REPORTERS (10) distinct reporters within WINDOW_MIN (24h) -> mute for AUTO_MUTE_MIN (24h).
//      A manual row with a later (or permanent) expiry is never shortened by the automatic rule.
// State (chat-mute.json, HMAC pid keyed, no raw ids, no text): { seen: { reporterPid: lastTsMin }, rep: { targetPid: [[reporterPid, tsMin], ...] },
//   auto: { targetPid: untilMin }, digest: { day, at } }. Report text reaches ONLY the private mail digest (same Resend channel as the
//   feedback digest: FB_DIGEST_TO / RESEND_API_KEY); logs carry counts and pseudonyms only.
const CHAT_MUTE = Object.freeze({
  MUTE_LB: 'chat_mute',               // lockstep: client mute-directory.js BOARD
  REPORT_LB: 'chat_report_box',       // lockstep: client chat-report.js BOARD
  MAGIC: 0xB8, VER: 1,                // lockstep: client chat-report.js packReport
  BODY_MAX: 228,
  EPOCH0: Date.UTC(2026, 0, 1),       // client tsMin epoch (minutes since 2026-01-01)
  AUTO_REPORTERS: 10,                 // decision 2026-09-23 (user): 10 distinct reporters ...
  WINDOW_MIN: 1440,                   // ... inside 24h ...
  AUTO_MUTE_MIN: 1440,                // ... -> automatic 24h mute (values provisional -> 3.5c2a)
  REPORT_TTL_MIN: 1440,               // reports older than the window are pruned from state
  MAX_PER_TARGET: 400,
});

// details int32[] -> { ver, scope, enc, len, target, tsMin, hash, text } | null (mirror of client decodeReport)
function decodeReport(words) {
  if (!Array.isArray(words) || words.length < 6) return null;
  const w0 = words[0] | 0;
  if ((w0 & 0xFF) !== CHAT_MUTE.MAGIC) return null;
  const ver = (w0 >>> 8) & 0xFF, scope = (w0 >>> 16) & 0xFF, enc = (w0 >>> 24) & 0xFF;
  const len = words[1] | 0;
  if (len < 0 || len > CHAT_MUTE.BODY_MAX) return null;
  const target = ((BigInt(words[3] >>> 0) << 32n) | BigInt(words[2] >>> 0)).toString();
  const bytes = Buffer.alloc(len);
  for (let i = 0; i < len; i++) bytes[i] = (words[6 + (i >> 2)] >>> ((i & 3) * 8)) & 0xFF;
  let text = '';
  if (enc === 1) { for (let i = 0; i + 1 < len; i += 2) text += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)); }
  else text = bytes.toString('utf8');
  text = text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  return { ver, scope, enc, len, target, tsMin: words[4] | 0, hash: words[5] | 0, text };
}
function tsMinToUnixMin(tsMin) { return Math.floor(CHAT_MUTE.EPOCH0 / 60000) + (tsMin | 0); }
function sidPlausible(sid) { return /^\d{15,20}$/.test(String(sid || '')); }

// Fold this run's report rows into state (pure; mutates `st`). rows = [{ reporterSid, det }] (det = decoded int32[]).
// Returns { fresh: [{ reporterSid, target, scope, tsMin, text }], skipped }. A row is fresh when its tsMin is newer than
// the reporter's last seen snapshot (ForceUpdate = one row per reporter; older/equal = already harvested).
function harvest(st, rows, pidOf, nowUnixMin) {
  st.seen = st.seen || {}; st.rep = st.rep || {}; st.auto = st.auto || {};
  const fresh = [];
  let skipped = 0;
  for (const r of rows || []) {
    const rep = decodeReport(r.det);
    if (!rep || !sidPlausible(r.reporterSid) || !sidPlausible(rep.target) || String(rep.target) === String(r.reporterSid)) { skipped++; continue; }
    const rp = pidOf(r.reporterSid);
    if ((st.seen[rp] | 0) >= rep.tsMin) { skipped++; continue; }
    const at = tsMinToUnixMin(rep.tsMin);
    if (at > nowUnixMin + 60) { skipped++; continue; }   // clock from the future = forged/skewed row, ignore
    st.seen[rp] = rep.tsMin;
    const tp = pidOf(rep.target);
    const list = st.rep[tp] || (st.rep[tp] = []);
    if (!list.some(x => x[0] === rp)) list.push([rp, at]); else { const i = list.findIndex(x => x[0] === rp); list[i] = [rp, at]; }
    while (list.length > CHAT_MUTE.MAX_PER_TARGET) list.shift();
    fresh.push({ reporterSid: String(r.reporterSid), target: rep.target, scope: rep.scope, tsMin: rep.tsMin, text: rep.text });
  }
  return { fresh, skipped };
}
// Prune reports outside the window (pure; mutates).
function prune(st, nowUnixMin) {
  st.rep = st.rep || {};
  for (const tp of Object.keys(st.rep)) {
    st.rep[tp] = st.rep[tp].filter(x => nowUnixMin - (x[1] | 0) <= CHAT_MUTE.REPORT_TTL_MIN);
    if (!st.rep[tp].length) delete st.rep[tp];
  }
  st.auto = st.auto || {};
  for (const tp of Object.keys(st.auto)) if ((st.auto[tp] | 0) > 0 && (st.auto[tp] | 0) <= nowUnixMin) delete st.auto[tp];
}
// Distinct reporters per target inside the window (pure).
function reporterCount(st, tp, nowUnixMin) {
  const list = (st.rep && st.rep[tp]) || [];
  const s = new Set();
  for (const [rp, at] of list) if (nowUnixMin - (at | 0) <= CHAT_MUTE.WINDOW_MIN) s.add(rp);
  return s.size;
}
// Mute plan (pure): given state + current board rows [{ sid, until }] + the sid<->pid map of this run's targets,
// returns { writes: [{ sid, until, why }], deletes: [{ sid, why }] }.
//   writes  = automatic mutes for targets over the threshold whose board row is absent or expires earlier (never shortens a longer/permanent row)
//   deletes = expired rows (until > 0 && until <= now), manual or automatic
function plan(st, boardRows, targets, pidOf, nowUnixMin) {
  const writes = [], deletes = [];
  const rowBy = new Map();
  for (const r of boardRows || []) rowBy.set(String(r.sid), r.until | 0);
  for (const [sid, until] of rowBy) if (until > 0 && until <= nowUnixMin) deletes.push({ sid, why: 'expired' });
  const wantUntil = nowUnixMin + CHAT_MUTE.AUTO_MUTE_MIN;
  for (const sid of targets || []) {
    const tp = pidOf(sid);
    const n = reporterCount(st, tp, nowUnixMin);
    if (n < CHAT_MUTE.AUTO_REPORTERS) continue;
    const cur = rowBy.has(String(sid)) ? rowBy.get(String(sid)) : null;
    if (cur === 0) continue;                                   // permanent manual mute: leave it
    if (cur != null && cur > wantUntil) continue;              // longer manual mute: leave it
    if ((st.auto[tp] | 0) >= wantUntil - 5) continue;          // already wrote this window
    writes.push({ sid: String(sid), until: wantUntil, why: 'auto:' + n });
  }
  return { writes, deletes };
}
// Mail digest body lines (text goes to the private inbox only).
function digestLines(fresh, plog) {
  return (fresh || []).slice(0, 200).map(f => '[' + (f.scope === 1 ? 'global' : f.scope === 2 ? 'party' : f.scope === 3 ? 'dm' : 'chat') + ' ts=' + f.tsMin + ' reporter=' + f.reporterSid + ' target=' + f.target + ']\n' + f.text);
}
module.exports = { CHAT_MUTE, decodeReport, tsMinToUnixMin, harvest, prune, reporterCount, plan, digestLines, sidPlausible };
