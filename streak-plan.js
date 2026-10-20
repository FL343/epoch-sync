'use strict';
// ============================================================
// streak-plan.js - the matchmade win streak rules (O181): one copy for this job and for the client
// ============================================================
// O181 (2026-10-20, the companion repo's knife 5.4b3): a win streak over matchmade matches (quick, ranked and team share
// one count) earns an XP bonus on the win that brings it to 2 / 3 / 5 / 7 (+5 / 10 / 15 / 20 percent). The bonus adds into
// the same percentage as the level boost and the supporter pack (one multiplier, no new rounding step). This job holds the
// truth; the client keeps an optimistic copy of the same state and shows the streak next to the player's name before a
// match. Both sides run THIS file: validate.js requires it, and the companion repo vendors a comment-stripped copy into the
// client (its scripts/gen-streak-vendor.js; byte-locked by its schema lockstep test, and both repos replay the golden cases
// fixtures/streak-plan/cases.json). Rules for this file (as points-plan.js):
//   - self-contained: no require, no process.env, no clock, no I/O (the caller passes the minute it runs at);
//   - `//` line comments only, never `//` inside a string, ASCII-only code (the vendor copy strips comments line by line);
//   - CommonJS when `this` is this file's own exports object, else window.STREAK_PLAN.
// RULES_VER: +1 in the same change as any number or rule here that moves a streak or a bonus. FIXTURES_HASH: canonical hash of
//   fixtures/streak-plan/cases.json (tools/gen-streak-fixtures.js prints it), updated in the same change as the file.
//
// State, one per player (xp.json `sk` here, the client's profile there), never shared between players:
//   { p: the streak folded so far, b: the best streak, h: the newest start minute folded into p, l: the matchHash folded
//     last, e: [[start minute, matchHash, k], ...] in order, f: [[minute, matchHash], ...] absence freezes granted }
//   k: 0 freeze (moves nothing: an interrupted match, a loss after a teammate left, a first absence in a week, a result not
//   known yet), 1 win, 2 loss, 3 break (a confessed quit, a repeat absence).
// Order: this job settles out of order (a match held for a crashed player can settle an hour after the matches the others
//   played next), so events sort by the match's START minute, never by settle order: a late loss can not zero the wins
//   that came after it. Ties sort losses and breaks first, freezes next, wins last (the order kindest to the player), then
//   by matchHash.
// Window: an event stays sortable for WINDOW_MIN after its start (12 h > the latest revision: the 1 h leave wait, the 2 h
//   orphan verdict, the 6 h late result); older ones fold into p in order, and at most CAP stay. An event for a match older
//   than everything folded (start minute <= h) is stale and ignored both ways: it neither extends nor breaks the streak.
// The same match twice: the later event replaces the earlier one and keeps the earlier start minute (a confessed quit, then
//   the player's own result after he came back; a conviction, then his result coming in late).
// ============================================================
(function (cjs, root, factory) {
  const api = factory();
  if (cjs) module.exports = api;
  else if (root) root.STREAK_PLAN = api;
})(typeof module === 'object' && !!module && typeof exports === 'object' && this === exports, typeof window !== 'undefined' ? window : null, function () {
  const RULES_VER = 1;
  const FIXTURES_HASH = 'd5546b06a96f68db';
  const K = Object.freeze({ FREEZE: 0, WIN: 1, LOSS: 2, BREAK: 3 });
  // the win that brings the streak to n earns the percent of the highest tier n reaches
  const TIERS = [[2, 5], [3, 10], [5, 15], [7, 20]];
  const WINDOW_MIN = 12 * 60;
  const CAP = 64;
  // a convicted absence (crash or killed process; this job can not tell them apart) freezes once per FREEZE_GRACE_MIN,
  //   then breaks: an honest crash keeps the streak, a "kill it when losing" works once a week
  const FREEZE_GRACE_MIN = 7 * 24 * 60;
  const FREEZE_KEEP = 8;
  // display: others see the streak from SHOW_OTHERS, the player's own results page from SHOW_SELF (the first bonus)
  const SHOW_OTHERS = 3;
  const SHOW_SELF = 2;
  // a streak claimed by its owner before a match is shown as min(claim, this job's value + CLAIM_SLACK) (the last match or two
  //   is not settled yet when the next one loads); with this job's value unread, at most CLAIM_UNREAD
  const CLAIM_MAX = 99;
  const CLAIM_SLACK = 2;
  const CLAIM_UNREAD = 3;
  // published block on the player's xp row, after the career matrix: [TAIL_MAGIC | ver << 8 | len << 16, cur, best, matchHash]
  const TAIL_MAGIC = 0xC9;
  const TAIL_VER = 1;
  const TAIL_LEN = 3;

  function xpPct(n) {
    let p = 0;
    for (const t of TIERS) if ((n | 0) >= t[0]) p = t[1];
    return p;
  }
  function isK(k) { return k === 0 || k === 1 || k === 2 || k === 3; }
  function step(cur, k) { return k === 1 ? cur + 1 : ((k === 2 || k === 3) ? 0 : cur); }
  function rankK(k) { return (k === 2 || k === 3) ? 0 : (k === 0 ? 1 : 2); }
  function order(a, b) { return (a[0] - b[0]) || (rankK(a[2]) - rankK(b[2])) || ((a[1] >>> 0) - (b[1] >>> 0)); }
  function blank() { return { p: 0, b: 0, h: 0, l: 0, e: [], f: [] }; }
  // a clean copy of any stored state (a missing or damaged field reads as empty; never throws)
  function norm(st) {
    const s = (st && typeof st === 'object') ? st : {};
    const out = { p: Math.max(0, s.p | 0), b: Math.max(0, s.b | 0), h: s.h | 0, l: s.l | 0, e: [], f: [] };
    if (Array.isArray(s.e)) {
      const byMh = {};
      for (const x of s.e) {
        if (!Array.isArray(x) || x.length < 3 || !isK(x[2] | 0)) continue;
        const ev = [x[0] | 0, x[1] | 0, x[2] | 0];
        const prev = byMh[ev[1]];
        if (prev) { prev[0] = Math.min(prev[0], ev[0]); prev[2] = ev[2]; } else { byMh[ev[1]] = ev; out.e.push(ev); }
      }
      out.e.sort(order);
    }
    if (Array.isArray(s.f)) for (const x of s.f) if (Array.isArray(x) && x.length >= 2) out.f.push([x[0] | 0, x[1] | 0]);
    if (out.b < out.p) out.b = out.p;
    return out;
  }
  // { cur, best, mh }: the streak now, the best ever, the matchHash this state knows last (in start order)
  function current(st) {
    const s = norm(st);
    let cur = s.p, best = s.b;
    for (const x of s.e) { cur = step(cur, x[2]); if (cur > best) best = cur; }
    return { cur, best, mh: s.e.length ? s.e[s.e.length - 1][1] : s.l };
  }
  // one match's outcome into a state -> { st, at, before, late, replaced, stale }
  //   at = the streak right after this match in start order (a win's bonus is xpPct(at)); late = matches that started after
  //   it were already in. lim = { win, cap } (this job: the defaults; the client: win 0 = no time fold, its own cap).
  function apply(st, t0, mh, k, nowMin, lim) {
    const s = norm(st);
    const L = lim || {};
    const win = (L.win == null) ? WINDOW_MIN : Math.max(0, L.win | 0);
    const cap = (L.cap == null) ? CAP : Math.max(1, L.cap | 0);
    const T = t0 | 0, M = mh | 0, KK = k | 0;
    if (!isK(KK)) return { st: s, at: current(s).cur, before: current(s).cur, late: false, replaced: false, stale: true };
    const i = s.e.findIndex((x) => x[1] === M);
    let replaced = false;
    if (i >= 0) {
      const t = Math.min(s.e[i][0], T);
      s.e.splice(i, 1);
      s.e.push([t, M, KK]);
      replaced = true;
    } else if (s.h > 0 && T <= s.h) {
      const c = current(s);
      return { st: s, at: c.cur, before: c.cur, late: true, replaced: false, stale: true };
    } else {
      s.e.push([T, M, KK]);
    }
    s.e.sort(order);
    let cur = s.p, best = s.b, at = 0, before = 0, idx = -1;
    for (let j = 0; j < s.e.length; j++) {
      const x = s.e[j];
      if (idx < 0 && x[1] === M) { idx = j; before = cur; }
      cur = step(cur, x[2]);
      if (cur > best) best = cur;
      if (j === idx) at = cur;
    }
    s.b = best;
    const late = idx >= 0 && idx < s.e.length - 1;
    while (s.e.length && ((win > 0 && s.e[0][0] < (nowMin | 0) - win) || s.e.length > cap)) {
      const x = s.e.shift();
      s.p = step(s.p, x[2]);
      if (x[0] > s.h) s.h = x[0];
      s.l = x[1];
    }
    return { st: s, at, before, late, replaced, stale: false };
  }
  // a convicted absence (no confession, no result of his own) -> { st, k }: the first one in FREEZE_GRACE_MIN freezes (and is
  //   remembered), every later one breaks; the same match asked twice keeps its first answer
  function absence(st, mh, nowMin) {
    const s = norm(st);
    const M = mh | 0, now = nowMin | 0;
    s.f = s.f.filter((x) => now - x[0] < FREEZE_GRACE_MIN);
    let k = K.BREAK;
    if (s.f.some((x) => x[1] === M)) k = K.FREEZE;
    else if (!s.f.length) { s.f.push([now, M]); k = K.FREEZE; }
    while (s.f.length > FREEZE_KEEP) s.f.shift();
    return { st: s, k };
  }
  // a conviction taken back (his own result came in late): its freeze grant is returned
  function pardon(st, mh) {
    const s = norm(st);
    s.f = s.f.filter((x) => x[1] !== (mh | 0));
    return s;
  }
  // the client's state after it read this job's published tail: the tail is the truth up to its match; the client's own
  //   events after that match fold on top. A tail match the client never logged (another machine, a reinstall, a log that
  //   dropped it) -> the tail alone. A tail with no match (matchHash 0) keeps every local event.
  function merge(st, auth) {
    const s = norm(st);
    if (!auth) return s;
    const cur = Math.max(0, auth.cur | 0), best = Math.max(0, auth.best | 0), M = auth.mh | 0;
    if (M !== 0) {
      const i = s.e.findIndex((x) => x[1] === M);
      if (i >= 0) { if (s.e[i][0] > s.h) s.h = s.e[i][0]; s.e = s.e.slice(i + 1); }
      else if (M !== s.l) s.e = [];
      s.l = M;
    }
    s.p = cur;
    s.b = Math.max(s.b, best, cur);
    return s;
  }
  function tail(st) {
    const c = current(st);
    return [(TAIL_MAGIC | (TAIL_VER << 8) | (TAIL_LEN << 16)) | 0, c.cur | 0, c.best | 0, c.mh | 0];
  }
  // the tail in a details array, read from `from` (the end of the career matrix) over self-describing blocks; null = none
  function tailOf(d, from) {
    if (!Array.isArray(d)) return null;
    let i = Math.max(0, from | 0);
    while (i < d.length) {
      const h = d[i] | 0, len = (h >>> 16) & 0xff;
      if ((h & 0xff) === TAIL_MAGIC) {
        if (len < TAIL_LEN || i + TAIL_LEN >= d.length) return null;
        return { ver: (h >>> 8) & 0xff, cur: Math.max(0, d[i + 1] | 0), best: Math.max(0, d[i + 2] | 0), mh: d[i + 3] | 0 };
      }
      if (len === 0) return null;
      i += 1 + len;
    }
    return null;
  }
  // what others are shown for a streak its owner claims (auth = this job's published value, null = unread)
  function displayCap(claim, auth) {
    const c = Math.max(0, Math.min(CLAIM_MAX, claim | 0));
    if (auth == null) return Math.min(c, CLAIM_UNREAD);
    return Math.min(c, Math.max(0, auth | 0) + CLAIM_SLACK);
  }
  function shows(n, self) { return (n | 0) >= (self ? SHOW_SELF : SHOW_OTHERS); }
  return {
    RULES_VER, FIXTURES_HASH, K, TIERS, WINDOW_MIN, CAP, FREEZE_GRACE_MIN, FREEZE_KEEP, SHOW_OTHERS, SHOW_SELF,
    CLAIM_MAX, CLAIM_SLACK, CLAIM_UNREAD, TAIL_MAGIC, TAIL_VER, TAIL_LEN,
    xpPct, blank, norm, current, apply, absence, pardon, merge, tail, tailOf, displayCap, shows,
  };
});
