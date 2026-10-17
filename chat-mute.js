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
// State (chat-mute.json, keyed tokens only, no raw ids, no text): { sig: { rowToken: stampMin }, rep: { targetKey: [[pairToken,
//   unixMin], ...] }, auto: { targetKey: untilMin }, pend: { mailToken: stampMin }, digest: { day, at }, kv, pre }. A row token
//   stands for one harvested report row, a pair token for one (reporter, target) pair; no key stays with a reporter
//   (Q209, see KEYS_VER). Report text reaches ONLY the private mail digest (same Resend channel as the
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
  ROW_TTL_MIN: 30 * 1440,             // Q209: a harvested row's token is kept 30 days; a row older than that is not taken
  ROWS_MAX: 50000,                    // Q209: size fuse on the row tokens (oldest stamps go first)
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
// Returns { fresh: [{ reporterSid, target, scope, tsMin, text }], skipped, clamped, stale }.
// ForceUpdate keeps ONE row per reporter, so a row is fresh when it was not harvested before: st.sig holds a keyed token of
// every row harvested in the last ROW_TTL_MIN (rowTok -- one per row, nothing in it shared by two rows of one reporter;
// Q209: it used to be one entry per reporter, rewritten with each of his reports, which chained his reports together in the
// public history). The reporter's clock orders nothing: a row stamped earlier than the previous one (clock set back after
// running fast) is still a new report, and a stamp ahead of the cron's clock (wrong time zone + hand-set clock) is clamped
// to now instead of dropped (a forged future stamp gains nothing: its window then runs from this harvest). A row whose own
// stamp is more than ROW_TTL_MIN old is not taken (stale): its token may be gone, and it could not count anyway (reports
// count for WINDOW_MIN); only a lane down for that long loses such a row from the digest. A token is stamped
// max(now, min(row time, now + ROW_TTL_MIN)) -- never earlier than the row's own time, so by the time it is pruned the row
// is stale (prune); a row stamped further ahead than that may come in again once its token is pruned, with the same pair
// token (one reporter of that target either way).
function rowTok(pidOf, rk, rep) { return pidOf('chat-rt|' + rk + '|' + pidOf(rowKey(rep))); }
function pairTok(pidOf, rk, tk) { return pidOf('chat-rp|' + rk + '|' + tk); }
function rowStamp(rowMin, nowUnixMin) { return Math.max(nowUnixMin, Math.min(rowMin, nowUnixMin + CHAT_MUTE.ROW_TTL_MIN)); }
function rowKey(rep) { return 'chat-row|' + rep.ver + '|' + rep.scope + '|' + rep.enc + '|' + rep.len + '|' + rep.target + '|' + rep.hash + '|' + rep.tsMin; }
// pidOf keys the reporter side (the row, pair and mail tokens), tpidOf the target side (st.rep / st.auto keys; default
// pidOf) -- validate.js passes the lane's two pseudonyms (CHAT_KEYS, Q190), see rekeyLegacy.
function harvest(st, rows, pidOf, nowUnixMin, tpidOf) {
  st.rep = st.rep || {}; st.auto = st.auto || {};
  const sig = st.sig || {};
  const pre = new Set(st.pre || []);   // rows on the box when a pid-keyed state was dropped: never taken (rekeyLegacy)
  const fresh = [];
  let skipped = 0, clamped = 0, stale = 0;
  for (const r of rows || []) {
    const rep = decodeReport(r.det);
    if (!rep || !sidPlausible(r.reporterSid) || !sidPlausible(rep.target) || String(rep.target) === String(r.reporterSid)) { skipped++; continue; }
    if (pre.size && pre.has(preKey(pidOf, r.reporterSid, rep))) { skipped++; continue; }
    const rk = pidOf(r.reporterSid);
    const rt = rowTok(pidOf, rk, rep);
    if (sig[rt] !== undefined) { skipped++; continue; }
    const rowMin = tsMinToUnixMin(rep.tsMin);
    if (nowUnixMin - rowMin > CHAT_MUTE.ROW_TTL_MIN) { skipped++; stale++; continue; }
    let at = rowMin;
    if (at > nowUnixMin) { at = nowUnixMin; clamped++; }
    sig[rt] = rowStamp(rowMin, nowUnixMin);
    const tk = (tpidOf || pidOf)(rep.target), pt = pairTok(pidOf, rk, tk);
    const list = st.rep[tk] || (st.rep[tk] = []);
    if (!list.some(x => x[0] === pt)) list.push([pt, at]); else { const i = list.findIndex(x => x[0] === pt); list[i] = [pt, at]; }
    while (list.length > CHAT_MUTE.MAX_PER_TARGET) list.shift();
    fresh.push({ reporterSid: String(r.reporterSid), target: rep.target, scope: rep.scope, tsMin: rep.tsMin, text: rep.text });
  }
  if (fresh.length) st.sig = sortKeys(sig);
  return { fresh, skipped, clamped, stale };
}
const sortKeys = (o) => { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; };
// Prune reports outside the window (pure; mutates).
function prune(st, nowUnixMin) {
  st.rep = st.rep || {};
  for (const tp of Object.keys(st.rep)) {
    st.rep[tp] = st.rep[tp].filter(x => nowUnixMin - (x[1] | 0) <= CHAT_MUTE.REPORT_TTL_MIN);
    if (!st.rep[tp].length) delete st.rep[tp];
  }
  st.auto = st.auto || {};
  for (const tp of Object.keys(st.auto)) if ((st.auto[tp] | 0) > 0 && (st.auto[tp] | 0) <= nowUnixMin) delete st.auto[tp];
  return pruneRows(st, nowUnixMin);
}
// Q209: row tokens leave by age only (never by the reporter's next report -- that would pair his two rows again), and past
// ROWS_MAX the oldest stamps go first (a token evicted early lets its row come in again: same pair token, same time, so the
// target's count does not change; the digest may show it twice). Only row tokens (a number stamp) are touched -- a kv 1
// digest (a string) waits for upgrade. Returns how many tokens the fuse evicted.
function pruneRows(st, nowUnixMin) {
  if (!st.sig) return 0;
  const ks = [];
  for (const k of Object.keys(st.sig)) {
    const v = st.sig[k];
    if (typeof v !== 'number') continue;
    if (nowUnixMin - v > CHAT_MUTE.ROW_TTL_MIN) delete st.sig[k]; else ks.push(k);
  }
  if (ks.length <= CHAT_MUTE.ROWS_MAX) return 0;
  ks.sort((a, b) => (st.sig[a] - st.sig[b]) || (a < b ? -1 : a > b ? 1 : 0));
  const n = ks.length - CHAT_MUTE.ROWS_MAX;
  for (let i = 0; i < n; i++) delete st.sig[ks[i]];
  return n;
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

// ---- digest queue (the state file is committed to a PUBLIC repository every tick) ----
// The queue of harvested rows still owed to the private digest holds keyed tokens only -- never a raw id, never text:
//   st.pend     = { mailToken: stampMin }  one entry per queued row (Q209: it was one entry per reporter, replaced by his
//                                          newer report -- a key that stayed with him); the row a token stands for is
//                                          gone from the box once the reporter sends a newer report, and is then
//                                          counted as missing when the digest goes out
//   st.pendLost = number of queued rows dropped over PEND_MAX -- a count for the mail body, nothing else
// When the digest goes out the rows are read back from the report box (read every tick anyway) and matched by
// mail token, so report text and raw ids exist only on Steam and in the private inbox. A channel without a mail
// channel queues nothing. The tokens go through the keyed pseudonym (pidOf): the public file cannot confirm a guess.
const PEND_MAX = 200;
function mailSig(f, pidOf) { return pidOf('chat-mail|' + f.target + '|' + (f.scope | 0) + '|' + (f.tsMin | 0) + '|' + String(f.text == null ? '' : f.text)); }
// the queue key of one row: the reporter's lane key and the row's mail digest (so a Q190 queue moves without a board read)
function mailTok(f, pidOf) { return pidOf('chat-mt|' + pidOf(String(f.reporterSid)) + '|' + mailSig(f, pidOf)); }
// Queue fresh rows ({ reporterSid, target, scope, tsMin, text }: harvest's fresh list, or a legacy pendingMail list).
function queueMail(st, fresh, pidOf, nowUnixMin) {
  let added = 0;
  const stamp = Math.floor(Number(nowUnixMin) || 0);
  for (const f of fresh || []) {
    if (!f || !sidPlausible(f.reporterSid)) continue;
    const pend = st.pend || (st.pend = {});
    const t = mailTok(f, pidOf);
    if (pend[t] !== undefined) continue;
    pend[t] = stamp; added++;
  }
  if (st.pend) {
    const keys = Object.keys(st.pend);
    if (keys.length > PEND_MAX) {
      keys.sort((a, b) => ((st.pend[a] | 0) - (st.pend[b] | 0)) || (a < b ? -1 : a > b ? 1 : 0));
      for (let i = 0; i < keys.length - PEND_MAX; i++) { delete st.pend[keys[i]]; st.pendLost = (st.pendLost | 0) + 1; }
    }
    st.pend = sortKeys(st.pend);
  }
  return added;
}
// Read the queued rows back from this run's report box rows ([{ reporterSid, det }]).
// Returns { found: [{ reporterSid, target, scope, tsMin, text }] (oldest first), missing }.
function pendingRows(st, rows, pidOf) {
  const pend = st.pend || {};
  const found = [], hit = new Set();
  for (const r of rows || []) {
    if (!sidPlausible(r.reporterSid)) continue;
    const rep = decodeReport(r.det);
    if (!rep) continue;
    const f = { reporterSid: String(r.reporterSid), target: rep.target, scope: rep.scope, tsMin: rep.tsMin, text: rep.text };
    const t = mailTok(f, pidOf);
    if (pend[t] === undefined || hit.has(t)) continue;
    hit.add(t); found.push(f);
  }
  found.sort((a, b) => (a.tsMin | 0) - (b.tsMin | 0));
  return { found, missing: Object.keys(pend).length - found.length };
}
// An earlier version queued the raw rows themselves (st.pendingMail = [{ reporterSid, target, scope, tsMin, text }]).
// Never keep them: with a mail channel they move into the keyed queue, without one they are dropped. Returns how many.
function scrubLegacy(st, pidOf, mailOn, nowUnixMin) {
  const old = Array.isArray(st.pendingMail) ? st.pendingMail : [];
  delete st.pendingMail;
  if (mailOn && old.length) queueMail(st, old, pidOf, nowUnixMin);
  return old.length;
}
// The only keys that reach the committed file. A new state field has to be added here on purpose -- and must hold
// keyed pseudonyms, counts or times only. (sig: row tokens of harvested rows -- under a Q190 state, the keyed digest of each
// reporter's last row; seen: only in a Q190 state, the moved one keeps none.) The maps are written in key order (Q209: in
// insertion order the keys added in one run would sit in harvest order).
const PUBLIC_KEYS = Object.freeze(['seen', 'sig', 'rep', 'auto', 'digest', 'pend', 'pendLost', 'kv', 'pre']);
const SORTED = ['sig', 'rep', 'auto', 'pend'];
function publicState(st) {
  const o = {};
  for (const k of PUBLIC_KEYS) if (st && st[k] !== undefined) o[k] = (SORTED.indexOf(k) >= 0 && st[k] && typeof st[k] === 'object' && !Array.isArray(st[k])) ? sortKeys(st[k]) : st[k];
  return o;
}
// ---- lane keys (Q190, cloud audit 2026-10) ----
// The state is committed to a public repository. It used to key reporters and targets alike with validate.js pid, the
// pseudonym every state file shares -- and public boards tie a pid back to a SteamID, so the public history told who
// reported whom. validate.js now passes the lane's own keys (CHAT_KEYS: one domain for reporters, another for targets --
// the keys of rep and auto): a target is identifiable once the mute board shows his automatic mute, and that must not
// reveal the reports he filed himself. st.kv marks a state on those keys (written only while the state holds entries, so
// the untouched empty state stays byte-identical).
// Q209: kv 1 kept one key per reporter (seen / sig / pend, and the reporter key in every rep entry), so all of one
// reporter's reports shared it -- once one of them was tied to him (a muted target, a chat line only he could have
// reported), every other one was too. kv 2 keeps tokens per row (sig), per (reporter, target) pair (rep entries) and per
// queued row (pend); a kv 1 state moves in place with no board read (upgrade). An older version reads kv 2 as a state it
// does not know: it drops it on a complete read of the report box and marks every row then on the box as taken (only
// fewer reports count; a mute already on the mute board keeps its row).
const KEYS_VER = 2;
const KEYED = ['seen', 'sig', 'rep', 'auto', 'pend', 'pre'];
function hasEntries(st) { return KEYED.some(k => !!st && !!st[k] && Object.keys(st[k]).length > 0); }
function keysReady(st) { return !!st && (st.kv === KEYS_VER || !hasEntries(st)); }
function markKeys(st) { if (hasEntries(st)) st.kv = KEYS_VER; else delete st.kv; }
// Q209: a kv 1 state moves onto the per-row / per-pair tokens in place (pure; mutates). Each reporter's sig (the digest of
// his last row) becomes that row's token, stamped from his seen (the row's time); each rep entry [reporter key, t] becomes
// [pair token, t]; each queued pend entry becomes the queue token of the same row. The move tells the public history
// nothing it did not hold already (each new token stands for the kv 1 entry it replaces), and no report taken after it
// shares a key with an earlier one of the same reporter unless it is about the same target. Returns { rows, reports, mail },
// or null when the state was not on kv 1.
function upgrade(st, pidOf, nowUnixMin) {
  if (!st || st.kv !== 1) return null;
  const res = { rows: 0, reports: 0, mail: 0 };
  const sig = {}, seen = st.seen || {};
  for (const rk of Object.keys(st.sig || {})) {
    const v = st.sig[rk];
    if (typeof v !== 'string') continue;
    const rowMin = seen[rk] !== undefined ? tsMinToUnixMin(seen[rk]) : nowUnixMin;
    sig[pidOf('chat-rt|' + rk + '|' + v)] = rowStamp(rowMin, nowUnixMin); res.rows++;
  }
  const rep = {};
  for (const tk of Object.keys(st.rep || {})) {
    const list = (st.rep[tk] || []).filter(x => Array.isArray(x)).map(x => [pairTok(pidOf, x[0], tk), x[1]]);
    if (list.length) { rep[tk] = list; res.reports += list.length; }
  }
  if (st.pend) {
    const pend = {};
    for (const rk of Object.keys(st.pend)) { pend[pidOf('chat-mt|' + rk + '|' + st.pend[rk])] = Math.floor(Number(nowUnixMin) || 0); res.mail++; }
    st.pend = sortKeys(pend);
  }
  delete st.seen;
  st.sig = sortKeys(sig); st.rep = sortKeys(rep);
  st.kv = KEYS_VER;
  return res;
}
// st.pre: keyed tokens (through the reporter-side function) of the rows on the report box when a pid-keyed state was
// dropped -- no account in them, fixed from then on (never pruned, never written again); harvest skips such a row.
function preKey(pidOf, reporterSid, rep) { return pidOf('chat-pre|' + String(reporterSid) + '|' + rowKey(rep)); }
// Drop a state written under validate.js pid, from a COMPLETE read of the report box (rows as for harvest; validate.js
// calls it only then). Nothing of it is carried onto the lane keys: a value copied from a pid-keyed entry into a
// lane-keyed one in the same commit (a reporter's stamp, a reporter set, a mute expiry) shows anyone who diffs that commit
// which lane key is which pid, and so whose every later report it is. Instead every row now on the box goes into st.pre
// (taken before, or still in flight: not taken again under the new keys). The cost only lowers counts: those reports
// leave the 24h reporter sets (nobody is muted for them; a mute already on the mute board keeps its row and expiry, the
// state's auto map only stops a rewrite inside the same window), and the digest entries still queued are counted in
// pendLost (their rows stay readable on the report box). An older version that ran after the move dropped kv and pre
// (they are not in its PUBLIC_KEYS), so its state comes back here whole. Returns { dropped, pre }.
function rekeyLegacy(st, rows, byOf) {
  const pre = new Set(st.pre || []);
  for (const r of rows || []) {
    const rep = decodeReport(r.det);
    if (!rep || !sidPlausible(r.reporterSid) || !sidPlausible(rep.target) || String(rep.target) === String(r.reporterSid)) continue;
    pre.add(preKey(byOf, r.reporterSid, rep));
  }
  let dropped = Object.keys(st.seen || {}).length + Object.keys(st.auto || {}).length;
  for (const tk of Object.keys(st.rep || {})) dropped += (st.rep[tk] || []).length;
  const lost = Object.keys(st.pend || {}).length;
  if (lost) st.pendLost = (st.pendLost | 0) + lost;
  delete st.seen; st.sig = {}; st.rep = {}; st.auto = {}; delete st.pend;
  st.pre = Array.from(pre).sort();
  st.kv = KEYS_VER;
  return { dropped: dropped + lost, pre: pre.size };
}
module.exports = { CHAT_MUTE, decodeReport, tsMinToUnixMin, harvest, prune, pruneRows, reporterCount, plan, digestLines, sidPlausible,
  PEND_MAX, PUBLIC_KEYS, mailSig, mailTok, queueMail, pendingRows, scrubLegacy, publicState, KEYS_VER, hasEntries, keysReady, markKeys, rekeyLegacy, preKey,
  upgrade, rowTok, pairTok, rowKey };
