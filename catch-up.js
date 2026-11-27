'use strict';
// ============================================================
// catch-up.js - O1093 the deserved points of a ranked versus player (the "skill catch-up" table), pure
// ============================================================
// Why (the user, 2026-11-26, looking at the live points board: "why is the leader so far ahead, can diamond catch up more
//   easily"): the points leader was sixth by hidden rating -- he had played the most. At the top nearly every match is a
//   mismatch with the top player on the strong side, and a strong side's win is cut to the tier's rs (diamond 0.30, master
//   0.15), so a stronger player who started later gains 3-12 points a win and never closes the gap. The user's call: "the one
//   whose hidden rating is higher gains more" -- one-sided: a player ahead of his rating loses nothing (architecture
//   decision 10: the player who played the most is not punished for it).
// The table: the population is every row of the season's points board. A player's hidden rating is the rating the mismatch
//   check of the points plan reads for him (his ranked rating, the stored one until he has one: the plan rating of his rating
//   row, details[1]) -- not the rating board's score. His hidden rank = 1 + the players of the population rated strictly above
//   him (ties share the better place). His deserved points `des` = the points at that same place of the points board (points
//   sorted high to low). A player with fewer than CATCH_MIN_GAMES ranked games has no deserved points (0): a new account on a
//   hot streak waits for the rating to mean something.
// How it reaches the settle and the client (companion KNIFE_O1093 section 3.1): the job writes `des` into the 4th int of the
//   player's rating row at every rating write of his (the int was a constant 0), and keeps the same number in his skill
//   entry (`cu`). The next ranked settle reads `cu` as it stood when the run began -- the number his client read off the row
//   when the match started -- so both ends feed the points plan one value. No expiry: the plan reads no clock, and the bonus
//   of a match is capped by the plan itself.
// This file only builds the table; what a deserved number does at a settle is points-plan.js (RULES_VER 3 on). Until then
//   the job runs it as a SHADOW (validate.js: the number is published and logged, no points move).
// Pure: no clock, no I/O, no environment. test/catch-up.js.
// ============================================================
const CATCH_MIN_GAMES = 20;   // ranked games (the career matrix's ranked cells) before a player has deserved points
const CATCH_FLOOR = 4000;     // the shadow's reading of points-plan.js CATCH_FLOOR (diamond): the bonus is for diamond and up

// the population table: rows = [{ lp, hidden }] (every row of the points board, each with the hidden rating read for it)
//   -> { n, lpDesc: points high to low, hiddenDesc: hidden ratings high to low }
function tableOf(rows) {
  const lpDesc = [], hiddenDesc = [];
  for (const r of (rows || [])) {
    if (!r || !Number.isFinite(r.lp) || !Number.isFinite(r.hidden)) continue;
    lpDesc.push(r.lp | 0); hiddenDesc.push(r.hidden | 0);
  }
  lpDesc.sort((a, b) => b - a); hiddenDesc.sort((a, b) => b - a);
  return { n: lpDesc.length, lpDesc, hiddenDesc };
}
// 1 + how many of the population are rated strictly above `hidden` (binary search over hiddenDesc)
function hiddenRankOf(table, hidden) {
  const a = table.hiddenDesc, h = hidden | 0;
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] > h) lo = mid + 1; else hi = mid; }
  return lo + 1;
}
// the points at place `rank` (1-based) of the points board; past the end of the board: 0 (no deserved points)
function deservedOf(lpDesc, rank) {
  const k = rank | 0;
  return (k >= 1 && k <= lpDesc.length) ? (lpDesc[k - 1] | 0) : 0;
}
// a player's deserved points: his hidden rating read against the table, 0 under CATCH_MIN_GAMES ranked games
function desOf(table, hidden, rankedGames) {
  if (!table || !table.n || !Number.isFinite(hidden) || (rankedGames | 0) < CATCH_MIN_GAMES) return 0;
  return deservedOf(table.lpDesc, hiddenRankOf(table, hidden));
}
// the ranked games of a player's career matrix (xp state entry: cm = { '<mode>:<character>': [games, seconds, wins, losses] },
//   mode 1 = ranked; a ranked seat of a mixed table is counted there too)
function rankedGamesOf(xpEntry) {
  const cm = xpEntry && xpEntry.cm;
  if (!cm || typeof cm !== 'object') return 0;
  let n = 0;
  for (const k of Object.keys(cm)) if (k.slice(0, 2) === '1:' && Array.isArray(cm[k])) n += Math.max(0, cm[k][0] | 0);
  return n;
}
// SHADOW (until points-plan.js applies the rule): what the catch-up would have added to one settled line.
//   row: the player's plan row ({ adjDelta, normalDelta, why }), lp: his points before the match, des: his deserved points as
//   the run began, taxed: his unit pays a win tax of its own (a live trio, a couch pair). The rule: a WIN of the strong side
//   of a mismatch (why has 'expected') is paid in full instead of cut to the tier's rs, never past des. `full` here = the
//   row's normalDelta: exact for a solo or a pair in a brawl and for a team row; a taxed unit keeps its own tax under the
//   rule, so its reading here is a little high -- `approx` marks it.
//   Returns { extra, low: the same reading for a player under CATCH_FLOOR (kept apart: logged only, not in the rule), approx }.
function shadowExtra(row, lp, des, taxed) {
  const out = { extra: 0, low: 0, approx: false };
  if (!row || !Array.isArray(row.why) || row.why.indexOf('expected') < 0) return out;
  const cur = lp | 0, d = des | 0;
  if (d <= cur) return out;
  const more = Math.min((row.normalDelta | 0) - (row.adjDelta | 0), d - cur);
  if (more <= 0) return out;
  out.approx = !!taxed || row.why.indexOf('couch_mult') >= 0;
  if (cur >= CATCH_FLOOR) out.extra = more; else out.low = more;
  return out;
}

module.exports = { CATCH_MIN_GAMES, CATCH_FLOOR, tableOf, hiddenRankOf, deservedOf, desOf, rankedGamesOf, shadowExtra };
