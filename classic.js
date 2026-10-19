'use strict';
// Classic loyalty crate (companion knife 5.3 O81) -- pure helpers for the classic-owner lane of validate.js.
//
// Truth model: Steam's own license record of the older game (ISteamUser/CheckAppOwnership v4 on CLASSIC_APPID), read
// strictly (ownership.js ownsStrict: bought by the player himself, permanent, not cancelled, not a site license, not
// family-shared). An owner gets the REVOCABLE grant-box bit CLASSIC.BIT (word 1 of the mask); the client lights the
// classic crate only while that bit is set AND its own live ownership check agrees.
//
// Unlike the supporter bit this one is taken back: owners are re-probed once a day, and two definite "not owned"
// answers in a row clear the bit (a refund or a lost license; a single odd answer never flickers the crate). Errors and
// malformed answers change nothing but the check time (so a failing player is retried tomorrow, not every tick).
//
// Probe order (capped per run): players who just finished a match first (a fresh purchase shows up within one tick
//   for them: a known non-owner is re-checked after RECHECK_WRITER_MS), then players never looked at, then the stalest
//   daily re-checks.
// State (classic.json, HMAC pid keyed, never a raw id): { pid: { o: 0|1, c: lastCheckMin, n: consecutive definite "not owned" } }
// Appid comes from the environment (CLASSIC_APPID; workflow secret) -- no game ids in this public repo. 0 = lane off.
const ownership = require('./ownership.js');

const CLASSIC = Object.freeze({
  APPID: Number(process.env.CLASSIC_APPID) || 0,
  BIT: 32,                              // lockstep: client COSMETICS.GRANT_BITS_REVOCABLE.classic
  RECHECK_MS: 24 * 3600 * 1000,         // daily re-check (owners too: refunds)
  RECHECK_WRITER_MS: 30 * 60 * 1000,    // a known non-owner who just finished a match: re-check after 30 min
  CLEAR_AFTER: 2,                       // definite "not owned" answers in a row before an owner loses the bit
  MAX_CHECKS_PER_RUN: 150,
  MAX_WRITES_PER_RUN: 200,
});

// CheckAppOwnership v4 answer -> 'own' | 'not' | null (unknown: no definite answer)
function probeResult(json, sid) {
  if (!ownership.definite(json)) return null;
  return ownership.ownsStrict(json, sid) ? 'own' : 'not';
}

// Which sids to probe this run (pure; deterministic order). writers = this run's record writers / rosters.
function checkPlan(state, cands, writers, pidOf, nowMs, max) {
  const nowMin = Math.floor(nowMs / 60000);
  const lim = max == null ? CLASSIC.MAX_CHECKS_PER_RUN : max;
  const valid = (s) => /^\d{10,20}$/.test(s);
  const ageMs = (e) => (nowMin - (e.c | 0)) * 60000;
  const first = [], unknown = [], stale = [];
  const seen = new Set();
  for (const s0 of writers || []) {
    const sid = String(s0);
    if (!valid(sid) || seen.has(sid)) continue;
    seen.add(sid);
    const e = state[pidOf(sid)];
    if (!e || ageMs(e) >= (e.o ? CLASSIC.RECHECK_MS : CLASSIC.RECHECK_WRITER_MS)) first.push(sid);
  }
  for (const s0 of cands || []) {
    const sid = String(s0);
    if (!valid(sid) || seen.has(sid)) continue;
    seen.add(sid);
    const e = state[pidOf(sid)];
    if (!e) { unknown.push(sid); continue; }
    if (ageMs(e) >= CLASSIC.RECHECK_MS) stale.push({ sid, c: e.c | 0 });
  }
  first.sort();
  unknown.sort();
  stale.sort((a, b) => a.c - b.c || (a.sid < b.sid ? -1 : 1));
  return first.concat(unknown, stale.map(s => s.sid)).slice(0, lim);
}

// Record a probe result (mutates state; returns the entry). result: 'own' | 'not' | null.
function applyProbe(state, pid, result, nowMs) {
  const nowMin = Math.floor(nowMs / 60000);
  const e = state[pid] || (state[pid] = { o: 0, c: 0, n: 0 });
  e.c = nowMin;
  if (result === 'own') { e.o = 1; e.n = 0; }
  else if (result === 'not') { e.n = (e.n | 0) + 1; if (e.n >= CLASSIC.CLEAR_AFTER) e.o = 0; }
  return e;
}

// The mask this lane wants to write for one player, or null when nothing changes. granted = the merged current mask
//   (board read, with the permanent bits other lanes wrote earlier in this run OR-ed into word 0). Only CLASSIC.BIT may
//   change: word 0 (the permanent bits) is copied verbatim, every other bit of word 1 too.
function maskPlan(granted, wantOwned) {
  const g = [(granted && granted[0]) | 0, (granted && granted[1]) | 0];
  const w = (CLASSIC.BIT / 32) | 0, b = 1 << (CLASSIC.BIT & 31);
  const has = !!(g[w] & b);
  if (has === !!wantOwned) return null;
  const m = g.slice();
  m[w] = wantOwned ? (m[w] | b) : (m[w] & ~b);
  if (m[0] !== g[0]) throw new Error('classic maskPlan touched the permanent word');   // tripwire (cannot happen while BIT >= 32)
  return m;
}

module.exports = { CLASSIC, probeResult, checkPlan, applyProbe, maskPlan };
