'use strict';
// ============================================================
// match-sig.js - the guard's match signature block (0xE5) on a result record: one copy for this job and for the client
// ============================================================
// The client's guard (the native sidecar that runs the game's authority core on the host / in a bot match) can vouch for a
// few facts of a match result record because it computed them itself: the match hash and seed of the core it ran, the seat
// count, every seat's final score (its core prices every catch), the writer's own account (read from Steam by the guard,
// never taken from the renderer) and how many levels its own wall clock saw played. The renderer still builds and uploads the
// record; before the upload it hands those fields to the guard, the guard compares them with its own state and, only when
// every one matches, signs them and returns this block, which the renderer appends as the LAST thing of the record. A
// mismatch, no guard or a guard without a key = no block = the record is judged exactly as before (the guard never signs
// what it did not check: a renderer handing over a table that differs from the core gets a refusal, not a signature).
// Block v1 (BLOCK_INTS = 21 ints):
//   [0]  MAGIC | VER << 8 | LEN << 16   self-describing (LEN = 20 ints follow): a reader that does not know the block skips it
//   [1]  keyId                          the signing key's build number (0 = the dev key, test boards only)
//   [2]  flags                          bits 0-1 role: ROLE_OWN 1 = the signer's own core (host, bot match) / ROLE_RELAY 2 = a
//                                       joiner re-signing the host core's final summary | bit 2 F_MIGRATED: the core started
//                                       from an injected state after a host change | bit 3 F_BARE: a level ran without a world
//                                       the core built itself | bits 8-15 SEEN: bit k = the account on roster seat k
//                                       authenticated on the signer's guard channel this match (the signer's own seat is
//                                       always set) | bits 16-19 LEVELS: levels the signer's wall clock saw played (0..15)
//   [3]  xcheck                         diff | miss << 8 | stale << 16 | unrun << 24, each capped at 255: joiner events the
//                                       host's guard saw changed / missing / never claimed / claimed but never run by its core
//                                       (0 on a bot match)
//   [4]  source                         account id (SteamID64 low 32 bits) whose core produced the score table
//   [5..20] signature                   Ed25519, 64 bytes as 16 little-endian int32
// Signed message = the ASCII bytes of DOMAIN, then the little-endian bytes of these int32s: block[0..4], d[1] (ledger
//   version), d[2] & 0xf (base match type; the high bits are testimony), h0 (the record's ORIGINAL matchHash d[3]: a table
//   split may rewrite d[3], the caller passes the original), d[4] (seed), d[5] (writer's seat), d[8] (seat count pc),
//   d[10 .. 10+pc) (seat scores), d[11+pc .. 11+3pc) (roster: low then high int32 per seat).
// NOT vouched for (in the record, outside the message): disposition, rank claim, win / progress bits, duration, the
//   character block, refusal tags, the bot tier bits of d[2], the presence of anyone on a seat whose SEEN bit is 0.
// Where: always the last block; only zeros may follow it ('trailing' otherwise). A later tail block goes BEFORE it.
// Both sides run THIS file: attest.js requires it (verifyMatchSig adds the Ed25519 check and the key table), and the companion
// repo vendors a comment-stripped copy into the client (its scripts/gen-match-sig-vendor.js; byte-locked by its schema
// lockstep test; both repos replay fixtures/match-sig/cases.json, and the client's guard builds the same bytes in C++).
// Rules for this file (as start-proof.js): self-contained (no require, no process.env, no clock, no I/O), line comments only,
// never two slashes inside a string, ASCII-only code; CommonJS when `this` is this file's own exports object, else
// window.MATCH_SIG.
// RULES_VER: +1 in the same change as anything here that changes the block, the message or a verdict. FIXTURES_HASH:
//   canonical hash of fixtures/match-sig/cases.json (tools/gen-match-sig-fixtures.js prints it), same change.
// ============================================================
(function (cjs, root, factory) {
  const api = factory();
  if (cjs) module.exports = api;
  else if (root) root.MATCH_SIG = api;
})(typeof module === 'object' && !!module && typeof exports === 'object' && this === exports, typeof window !== 'undefined' ? window : null, function () {
  const RULES_VER = 1;
  const FIXTURES_HASH = '38cbdd37dcbc8a40';
  const MAGIC = 0xE5;
  const VER = 1;
  const LEN = 20;
  const BLOCK_INTS = 21;
  const HEAD_INTS = 5;
  const SIG_INTS = 16;
  const DOMAIN = 'GMT-MSIG';
  const LEDGER_MAGIC = 0xB1;
  const LEDGER_VER = 3;
  const MT_ENDLESS = 7;
  const CHAR_MAGIC = 0xD8;   // the character block: its third byte is the seat count, not a length
  const T2BY_TAG = 0x74320000; // the team gamble refusal tag: one int at the fixed offset right after the roster
  const MAX_SEATS = 8;       // as the client's result-reporter.js and validate.js
  const MAX_DETAILS = 64;    // a leaderboard row holds at most 64 ints
  const ROLE_OWN = 1;
  const ROLE_RELAY = 2;
  const F_MIGRATED = 4;
  const F_BARE = 8;
  const SEEN_SHIFT = 8;
  const LEVELS_SHIFT = 16;
  const LEVELS_MAX = 15;
  const XCHECK_CAP = 255;

  function headWord() { return (MAGIC | (VER << 8) | (LEN << 16)) | 0; }
  function cap(v, max) { v = v | 0; return v < 0 ? 0 : (v > max ? max : v); }
  // { role, migrated, bare, seen, levels } -> flags int
  function packFlags(o) {
    o = o || {};
    return ((cap(o.role, 3)) | (o.migrated ? F_MIGRATED : 0) | (o.bare ? F_BARE : 0)
      | ((cap(o.seen, 0xff)) << SEEN_SHIFT) | ((cap(o.levels, LEVELS_MAX)) << LEVELS_SHIFT)) | 0;
  }
  function flagsOf(v) {
    v = v | 0;
    return { role: v & 3, migrated: !!(v & F_MIGRATED), bare: !!(v & F_BARE), seen: (v >>> SEEN_SHIFT) & 0xff, levels: (v >>> LEVELS_SHIFT) & 0xf };
  }
  // { diff, miss, stale, unrun } -> xcheck int (each capped at XCHECK_CAP)
  function packXcheck(o) {
    o = o || {};
    return (cap(o.diff, XCHECK_CAP) | (cap(o.miss, XCHECK_CAP) << 8) | (cap(o.stale, XCHECK_CAP) << 16) | (cap(o.unrun, XCHECK_CAP) << 24)) | 0;
  }
  function xcheckOf(v) {
    v = v | 0;
    return { diff: v & 0xff, miss: (v >>> 8) & 0xff, stale: (v >>> 16) & 0xff, unrun: (v >>> 24) & 0xff };
  }
  // the five signed head ints
  function head(keyId, flags, xcheck, source) { return [headWord(), keyId | 0, flags | 0, xcheck | 0, source | 0]; }
  function rosterEnd(pc) { return 11 + 3 * (pc | 0); }
  // a result record's seat count, or 0 when the ints are not a non-endless result record that holds its roster
  function pcOf(d) {
    if (!Array.isArray(d) || d.length < 11 || ((d[0] | 0) & 0xff) !== LEDGER_MAGIC) return 0;
    const pc = d[8] | 0;
    if (pc < 1 || pc > MAX_SEATS || d.length < rosterEnd(pc)) return 0;
    if (((d[2] | 0) & 0xf) === MT_ENDLESS) return 0;   // endless records carry their own tails and are never signed this way
    return pc;
  }
  // the signature block of a record: { state, at, ver, why }
  //   'none'    no block (or not a record this block can sit on)
  //   'ok'      a v1 block at d[at .. at + BLOCK_INTS), only zeros after it
  //   'unknown' a block of another version (a newer writer; the caller waits, never judges)
  //   'bad'     a v1 block that is cut short ('short'), has another length ('len') or has non-zero ints after it ('trailing')
  // Walk (as the gamble refusal reader): from the roster end, skip the team refusal tag, then block by block -- the character
  //   block by its seat count, any other block by its length byte; a word with length 0 ends the walk (not a block).
  function find(d) {
    const pc = pcOf(d);
    if (!pc) return { state: 'none' };
    let i = rosterEnd(pc);
    if (i < d.length && ((d[i] | 0) & ~0x3F) === T2BY_TAG) i++;
    while (i < d.length) {
      const h = d[i] | 0, mg = h & 0xff, ver = (h >>> 8) & 0xff, len = (h >>> 16) & 0xff;
      if (mg === CHAR_MAGIC && len === pc) { i += 1 + Math.ceil(pc / 4); continue; }
      if (!len) return { state: 'none' };
      if (mg === MAGIC) {
        if (ver !== VER) return { state: 'unknown', at: i, ver };
        if (len !== LEN) return { state: 'bad', at: i, ver, why: 'len' };
        if (i + BLOCK_INTS > d.length) return { state: 'bad', at: i, ver, why: 'short' };
        for (let k = i + BLOCK_INTS; k < d.length; k++) if ((d[k] | 0) !== 0) return { state: 'bad', at: i, ver, why: 'trailing' };
        return { state: 'ok', at: i, ver };
      }
      i += 1 + len;
    }
    return { state: 'none' };
  }
  function le32(out, v) { const u = (v | 0) >>> 0; out.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, (u >>> 24) & 0xff); }
  // the signed bytes (plain array of 0..255) for record d and the block's first HEAD_INTS ints; h0 = the original matchHash
  //   (null = d[3]). null when d is not a record the block can sit on or the head is short.
  function message(d, blk, h0) {
    const pc = pcOf(d);
    if (!pc || !Array.isArray(blk) || blk.length < HEAD_INTS) return null;
    const out = [];
    for (let i = 0; i < DOMAIN.length; i++) out.push(DOMAIN.charCodeAt(i) & 0xff);
    for (let i = 0; i < HEAD_INTS; i++) le32(out, blk[i]);
    le32(out, d[1]);
    le32(out, (d[2] | 0) & 0xf);
    le32(out, h0 == null ? d[3] : h0);
    le32(out, d[4]);
    le32(out, d[5]);
    le32(out, d[8]);
    for (let i = 0; i < pc; i++) le32(out, d[10 + i]);
    for (let i = 0; i < 2 * pc; i++) le32(out, d[11 + pc + i]);
    return out;
  }
  // the 64 signature bytes of a block (ints 5..20)
  function sigBytes(blk) {
    const out = [];
    for (let i = 0; i < SIG_INTS; i++) le32(out, blk[HEAD_INTS + i]);
    return out;
  }
  // 64 signature bytes -> the 16 ints the block carries
  function sigInts(bytes) {
    const out = [];
    for (let i = 0; i < SIG_INTS; i++) {
      const b = (k) => (bytes[i * 4 + k] | 0) & 0xff;
      out.push((b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)) | 0);
    }
    return out;
  }
  // the whole block, or null when the record cannot carry it within a row (the writer then uploads the record without it)
  function attach(d, blk) {
    if (!pcOf(d) || !Array.isArray(blk) || blk.length !== BLOCK_INTS || (blk[0] | 0) !== headWord()) return null;
    if (d.length + BLOCK_INTS > MAX_DETAILS) return null;
    return d.concat(blk.map((x) => x | 0));
  }
  // what the signature, once it verifies, lets a reader believe about the table: { ok, why }
  //   ok = no relayed-event trouble, no host change, a world for every level, and a source that fits the role: the signer's
  //   own core (ROLE_OWN) = the writer's own account; a relayed summary (ROLE_RELAY) = another seat of the roster
  function trust(d, at) {
    const pc = pcOf(d);
    if (!pc || !(at >= 0) || at + BLOCK_INTS > d.length) return { ok: false, why: 'shape' };
    const f = flagsOf(d[at + 2]), x = d[at + 3] | 0, src = d[at + 4] | 0, seat = d[5] | 0;
    if (seat < 0 || seat >= pc) return { ok: false, why: 'seat' };
    const lo = (s) => d[11 + pc + 2 * s] | 0;
    if (x !== 0) return { ok: false, why: 'xcheck' };
    if (f.migrated) return { ok: false, why: 'migrated' };
    if (f.bare) return { ok: false, why: 'bare' };
    if (!((f.seen >>> seat) & 1)) return { ok: false, why: 'seen' };
    if (f.role === ROLE_OWN) return src === lo(seat) ? { ok: true, why: '' } : { ok: false, why: 'source' };
    if (f.role === ROLE_RELAY) {
      for (let s = 0; s < pc; s++) if (s !== seat && lo(s) !== 0 && lo(s) === src) return { ok: true, why: '' };
      return { ok: false, why: 'source' };
    }
    return { ok: false, why: 'role' };
  }
  function levelsOf(d, at) { return flagsOf(d[at + 2]).levels; }
  return {
    RULES_VER, FIXTURES_HASH, MAGIC, VER, LEN, BLOCK_INTS, HEAD_INTS, SIG_INTS, DOMAIN, LEDGER_MAGIC, LEDGER_VER, MT_ENDLESS,
    CHAR_MAGIC, T2BY_TAG, MAX_SEATS, MAX_DETAILS, ROLE_OWN, ROLE_RELAY, F_MIGRATED, F_BARE, SEEN_SHIFT, LEVELS_SHIFT, LEVELS_MAX,
    XCHECK_CAP, headWord, packFlags, flagsOf, packXcheck, xcheckOf, head, rosterEnd, pcOf, find, message, sigBytes, sigInts,
    attach, trust, levelsOf,
  };
});
