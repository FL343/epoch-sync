'use strict';
// Supporter pack (paid DLC) perks -- pure helpers for validate.js.
//
// Truth model: the only signal is Steam's own ownership record (ISteamUser/CheckAppOwnership on the
// DLC appid). A player who truly owns it (not family-shared, not a site license) gets three things,
// each idempotent and never revoked (the pack is "consumed" on first detection by policy):
//   1. a row on the wall board (trusted writes): score = SCORE_BASE - firstSeenMinute, so the default
//      Descending sort lists supporters in the order they were first detected (earliest first).
//      A player can hide from the wall via the opt-out board (client-writable, 1 = hide / 0 = show);
//      the cron deletes / re-adds the wall row accordingly. State remembers what was written.
//   2. grant-box bit GRANT_BIT (permanent consumption evidence; the client ORs it into cosmetic unlocks).
//   3. a permanent +XP_BONUS_PCT% points bonus, stacked on top of the level-milestone boost
//      (xpMult below is the single multiplier expression; the client's optimistic mirror uses the
//      same shape 1 + (pct + bonus) / 100 so both sides round identically).
// State (supporters.json, HMAC pid keyed, never a raw id): { pid: { o: 0|1, f: firstSeenMin, c: lastCheckMin,
//   w: 0|1 wall row present, x: 0|1 opted out } }. Owners are never re-probed (permanent); non-owners are
//   re-probed at most once per RECHECK_NON_MS so a new purchase is picked up within a day; unknown players
//   are probed on first sight. Per-run probe count is capped (MAX_CHECKS_PER_RUN) -- the queue drains
//   across ticks, newest-unknown first.
// DLC appid comes from the environment (SUPPORTER_DLC_APPID; workflow secret) -- same policy as APPID: no game
// identifiers in this public repo. 0 = channel disabled (processSupporters no-ops with a warning).
const SUPPORTER = Object.freeze({
  DLC_APPID: Number(process.env.SUPPORTER_DLC_APPID) || 0,
  WALL_LB: 'supporter_wall',
  OPTOUT_LB: 'supporter_optout',
  GRANT_BIT: 7,
  XP_BONUS_PCT: 10,
  SCORE_BASE: 0x7fffffff,
  RECHECK_NON_MS: 24 * 3600 * 1000,
  MAX_CHECKS_PER_RUN: 150,
});

// Steam CheckAppOwnership response -> true only for a real, personal license.
function ownsFromResponse(json, sid) {
  const a = json && json.appownership;
  if (!a || a.ownsapp !== true) return false;
  if (a.sitelicense === true) return false;
  if (a.ownersteamid != null && String(a.ownersteamid) !== String(sid)) return false;   // family sharing = borrowed
  return true;
}

// Which of `sids` need a probe this run (pure; deterministic order: unknown first, then stalest).
function checkPlan(state, sids, pidOf, nowMs, max) {
  const nowMin = Math.floor(nowMs / 60000);
  const lim = max == null ? SUPPORTER.MAX_CHECKS_PER_RUN : max;
  const unknown = [], stale = [];
  const seen = new Set();
  for (const sid0 of sids || []) {
    const sid = String(sid0);
    if (!/^\d{10,20}$/.test(sid) || seen.has(sid)) continue;
    seen.add(sid);
    const e = state[pidOf(sid)];
    if (!e) { unknown.push(sid); continue; }
    if (e.o) continue;                                                   // owner: permanent, never re-probed
    const ageMs = (nowMin - (e.c | 0)) * 60000;
    if (ageMs >= SUPPORTER.RECHECK_NON_MS) stale.push({ sid, c: e.c | 0 });
  }
  stale.sort((a, b) => a.c - b.c || (a.sid < b.sid ? -1 : 1));
  unknown.sort();
  return unknown.concat(stale.map(s => s.sid)).slice(0, lim);
}

// Record a probe result (mutates state; returns the entry). First ownership sighting fixes `f`.
function applyProbe(state, pid, owned, nowMs) {
  const nowMin = Math.floor(nowMs / 60000);
  const e = state[pid] || (state[pid] = { o: 0, f: 0, c: 0, w: 0, x: 0 });
  e.c = nowMin;
  if (owned) { if (!e.o) { e.o = 1; if (!e.f) e.f = nowMin; } }
  else e.o = 0;
  return e;
}

function wallScore(firstMin) { return (SUPPORTER.SCORE_BASE - (firstMin | 0)) | 0; }

// Single multiplier expression shared with the client mirror (1 + (pct + bonus) / 100).
function xpMult(levelPct, supporter) { return 1 + ((levelPct | 0) + (supporter ? SUPPORTER.XP_BONUS_PCT : 0)) / 100; }

// Wall/opt-out reconciliation plan for one owner entry (pure): what to do given the current
// opted-out flag from the opt-out board. Returns 'write' | 'delete' | null.
function wallAction(e, optedOut) {
  if (!e || !e.o) return null;
  if (optedOut) return e.w ? 'delete' : null;
  return e.w ? null : 'write';
}

module.exports = { SUPPORTER, ownsFromResponse, checkPlan, applyProbe, wallScore, xpMult, wallAction };
