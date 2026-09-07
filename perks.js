'use strict';
// ============================================================
// perks.js - endless perk build replay (record tail: build word + pick log)
// ============================================================
// Since 2026-09-07 endless records carry three more tail ints: the perk build the run held when the
// segment closed (3 slots x [id 7 | lv 2]) and a 20 x 3-bit pick log (0 none / 1..3 card / 4 banked
// 4th card / 5 skip). The draw is a pure derivation of (season seed, draw depth, build so far), so
// the log fully determines the build: this module replays the log with the SAME table + RNG the
// client ships (perks-vendor/, comment-stripped byte copies locked by the companion repo's tests)
// and rejects any record whose build the log cannot produce (perk_forge). Inside a run the log only
// grows, so a later segment's log must extend the previous one (perk_chain).
//
// Fail-closed: a malformed log, a build without picks, more draws than the depth allows, or a
// build the replay does not reproduce -> reject (processed, never healed). A record with neither
// build nor picks (pre-perk clients, warm-up runs) is trivially fine.
// ============================================================
const fs = require('fs');
const path = require('path');

// lockstep: client RANKED_CONFIG.ENDLESS.PERKS (the vendor's FALLBACK carries the same values)
const PERKS_CFG = { SLOTS: 3, MAX_DRAWS: 20, DRAW_EVERY: 5, GATE_EVERY: 10, PICK_TIMEOUT_S: 20, PITY_EVERY: 3, CONTRACT_MAX: 2, VALUE_MUL_CAP: 1.6, CLASS_MUL_CAP: 25, TABLE_VER: 1 };
const VENDOR_DIR = path.join(__dirname, 'perks-vendor');
const VENDOR_FILES = ['rng.js', 'perks.js'];   // load order: the table module reads window.RNG / window.makeRNG

let _P = null;
function load() {
  if (_P) return _P;
  const win = { RANKED_CONFIG: { ENDLESS: { PERKS: PERKS_CFG } } };
  for (const f of VENDOR_FILES) new Function('window', fs.readFileSync(path.join(VENDOR_DIR, f), 'utf8'))(win);
  if (!win.PERKS || !win.RNG || typeof win.PERKS.replay !== 'function') throw new Error('perks vendor failed to load');
  _P = win.PERKS;
  return _P;
}
// draw pool by seat count: a solo run draws from the solo pool, a shared team build from the co-op pool
function modeOf(pc) { return (pc | 0) >= 2 ? 'coop' : 'solo'; }

// prev log (lo, hi) is a prefix of cur log (lo, hi)
function isPrefix(prevLo, prevHi, curLo, curHi) {
  const P = load();
  const a = P.unpackPicks(prevLo | 0, prevHi | 0), b = P.unpackPicks(curLo | 0, curHi | 0);
  const n = P.picksCount(a);
  if (n < 0) return false;
  for (let k = 0; k < n; k++) if ((a[k] | 0) !== (b[k] | 0)) return false;
  return true;
}

// f: tail fields { build, picksLo, picksHi, seasonId, endDepth }; run: chain memory ({ pk: {lo, hi} } or null); pc: seats
//   -> { ok: true, n, build } | { ok: false, reason: 'perk_forge' | 'perk_chain', why }
function verifyPerkPicks(f, run, pc) {
  const P = load();
  const build = (f && f.build) >>> 0, lo = (f && f.picksLo) | 0, hi = (f && f.picksHi) | 0;
  const arr = P.unpackPicks(lo, hi);
  const n = P.picksCount(arr);
  if (n < 0) return { ok: false, reason: 'perk_forge', why: 'picks-shape' };
  if (!P.buildValid(build)) return { ok: false, reason: 'perk_forge', why: 'build-shape' };
  if (run && run.pk && !isPrefix(run.pk.lo | 0, run.pk.hi | 0, lo, hi)) return { ok: false, reason: 'perk_chain', why: 'prefix' };
  if (n === 0) return build === 0 ? { ok: true, n: 0, build: 0 } : { ok: false, reason: 'perk_forge', why: 'build-without-picks' };
  const r = P.replay(P.seasonSeed(f.seasonId | 0), arr, f.endDepth | 0, { mode: modeOf(pc) });
  if (!r.ok) return { ok: false, reason: 'perk_forge', why: String(r.why) + (r.at != null ? '@' + r.at : '') };
  if ((r.build >>> 0) !== build) return { ok: false, reason: 'perk_forge', why: 'build-mismatch' };
  return { ok: true, n, build };
}

module.exports = { PERKS_CFG, VENDOR_DIR, VENDOR_FILES, load, modeOf, isPrefix, verifyPerkPicks };
