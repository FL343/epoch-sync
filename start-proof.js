'use strict';
// ============================================================
// start-proof.js - the matchmade start record's seat commitment (O462): one copy for this job and for the client
// ============================================================
// O462 (2026-10-21, the companion repo's plan mvp/KNIFE_O462_PLAN.md; cloud audit Q208's root fix): a matchmade start record
// (0xB2) names its match by public numbers only (the matchHash, the run seed, the roster), so an account outside the match can
// copy them and write a start record of its own, and the match counts as contested. The fix: the host draws 16 random bytes n
// when it starts the match and hashes n with the seat count and the roster:
//   h = sha256('gmt-o462-seat|1|' + n + '|' + pc + '|' + roster ints joined by ',')
// The match id is 'm_' + the first 24 hex digits of h and the run seed is the next 8 hex digits (31 bits, never 0). n travels
// to every player of the match (start frame, host handoff, rejoin answer; it is public, nothing to hide), and every
// matchmade start record (version 2) carries it in a self-describing block after its roster:
//   [TAIL_MAGIC | TAIL_VER << 8 | TAIL_LEN << 16, n0, n1, n2, n3]   (n as four big-endian int32)
// This job recomputes h from the record's own n, seat count and roster: the matchHash and the seed of the record match ->
// the roster is the one the host committed to (finding another n for another roster is a 63-bit second preimage). Whether
// the writer sits at the seat he writes from is the caller's check (it knows the row's owner). A record without the block
// is 'none' and counts as today; a block that does not bind is 'bad'.
// Both sides run THIS file: validate.js requires it, and the companion repo vendors a comment-stripped copy into the client
// (its scripts/gen-start-proof-vendor.js; byte-locked by its schema lockstep test, and both repos replay the golden cases
// fixtures/start-proof/cases.json). Rules for this file (as streak-plan.js):
//   - self-contained: no require, no process.env, no clock, no I/O; the caller passes the sha256 function (node crypto here,
//     the client's synchronous SHA256HEX there) taking an ASCII string and giving 64 lowercase hex digits;
//   - line comments only, never two slashes inside a string, ASCII-only code (the vendor copy strips comments line by line);
//   - CommonJS when `this` is this file's own exports object, else window.START_PROOF.
// RULES_VER: +1 in the same change as anything here that changes a commitment, a derivation or the block. FIXTURES_HASH:
//   canonical hash of fixtures/start-proof/cases.json (tools/gen-start-proof-fixtures.js prints it), same change.
// ============================================================
(function (cjs, root, factory) {
  const api = factory();
  if (cjs) module.exports = api;
  else if (root) root.START_PROOF = api;
})(typeof module === 'object' && !!module && typeof exports === 'object' && this === exports, typeof window !== 'undefined' ? window : null, function () {
  const RULES_VER = 1;
  const FIXTURES_HASH = 'e67f2db14f2a4f05';
  const TAG = 'gmt-o462-seat|1|';
  const START_VER = 2;     // the start record version that may carry the block (matchmade only; the others stay 1)
  const TAIL_MAGIC = 0xE2;
  const TAIL_VER = 1;
  const TAIL_LEN = 4;
  const MAX_SEATS = 8;     // as the client's result-reporter.js and validate.js
  const MAX_DETAILS = 64;  // a leaderboard row holds at most 64 ints
  const NONCE_RE = /^[0-9a-f]{32}$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;

  function isNonce(n) { return typeof n === 'string' && NONCE_RE.test(n); }
  // FNV-1a 32 bit, signed (the client's result-reporter.js hash32, the matchHash of every record)
  function hash32(s) {
    let h = 0x811c9dc5 >>> 0;
    s = String(s == null ? '' : s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h | 0;
  }
  function commitString(nHex, pc, rosterInts) {
    return TAG + nHex + '|' + (pc | 0) + '|' + rosterInts.map((x) => x | 0).join(',');
  }
  // h (64 lowercase hex) -> the match id and the run seed (1 .. 2^31-1)
  function derive(h) {
    if (typeof h !== 'string' || !HEX64_RE.test(h)) return null;
    return { matchId: 'm_' + h.slice(0, 24), runSeed: (parseInt(h.slice(24, 32), 16) & 0x7fffffff) || 1 };
  }
  // n, the seat count and the roster ints -> { matchId, runSeed }, or null when an input is malformed
  function bind(nHex, pc, rosterInts, sha256hex) {
    if (!isNonce(nHex) || !Array.isArray(rosterInts) || (pc | 0) < 1 || (pc | 0) > MAX_SEATS || rosterInts.length !== 2 * (pc | 0)) return null;
    if (typeof sha256hex !== 'function') return null;
    let h = null;
    try { h = sha256hex(commitString(nHex, pc, rosterInts)); } catch (e) { h = null; }
    return derive(typeof h === 'string' ? h.toLowerCase() : null);
  }
  function tail(nHex) {
    if (!isNonce(nHex)) return [];
    const out = [(TAIL_MAGIC | (TAIL_VER << 8) | (TAIL_LEN << 16)) | 0];
    for (let i = 0; i < 4; i++) out.push(parseInt(nHex.slice(8 * i, 8 * i + 8), 16) | 0);
    return out;
  }
  // the first block at or after `from`: n, or null (no block, another version, or cut short)
  function tailOf(d, from) {
    if (!Array.isArray(d)) return null;
    for (let i = Math.max(0, from | 0); i < d.length; i++) {
      const h = d[i] | 0;
      if ((h & 0xff) !== TAIL_MAGIC || ((h >>> 16) & 0xff) !== TAIL_LEN) continue;
      if (((h >>> 8) & 0xff) !== TAIL_VER) return null;
      if (i + TAIL_LEN > d.length - 1) return null;
      let n = '';
      for (let k = 1; k <= TAIL_LEN; k++) n += ('00000000' + ((d[i + k] | 0) >>> 0).toString(16)).slice(-8);
      return n;
    }
    return null;
  }
  // a start record's layout: [magic, ver, mt, matchHash, seed, seat, 0, 0, pc, 0], pc seat scores, disp, 2 * pc roster ints
  function rosterStart(pc) { return 11 + (pc | 0); }
  function tailStart(pc) { return 11 + 3 * (pc | 0); }
  function rosterOf(d) {
    if (!Array.isArray(d) || d.length < 10) return null;
    const pc = d[8] | 0;
    if (pc < 1 || pc > MAX_SEATS || d.length < tailStart(pc)) return null;
    return d.slice(rosterStart(pc), tailStart(pc)).map((x) => x | 0);
  }
  // 'none' (no block), 'bad' (a block that does not bind the record's matchHash and seed) or 'ok'
  function check(d, sha256hex) {
    const ro = rosterOf(d);
    if (!ro) return 'none';
    const pc = d[8] | 0;
    const n = tailOf(d, tailStart(pc));
    if (!n) return 'none';
    const m = bind(n, pc, ro, sha256hex);
    if (!m) return 'bad';
    return (hash32(m.matchId) === (d[3] | 0) && m.runSeed === (d[4] | 0)) ? 'ok' : 'bad';
  }
  function nonceOf(d) { const ro = rosterOf(d); return ro ? tailOf(d, tailStart(d[8] | 0)) : null; }
  return {
    RULES_VER, FIXTURES_HASH, TAG, START_VER, TAIL_MAGIC, TAIL_VER, TAIL_LEN, MAX_SEATS, MAX_DETAILS,
    isNonce, hash32, commitString, derive, bind, tail, tailOf, rosterStart, tailStart, rosterOf, check, nonceOf,
  };
});
