'use strict';
// Unit tests for the team-mode match handling (match types 3/4): isTeamMt classification,
// appliesLp stays ranked-FFA-only (type-4 team LP ships with the halved team-LP path later),
// and teamRankOf -- the seat-convention ranking (seats (0,1) vs (2,3), winning pair {1,2})
// that replaces raw score order for team matches. Mirrors the client's results ordering.
//   node test/team-rank.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const { isTeamMt, appliesLp, teamRankOf, creditXp, computeXpGain, XP_CFG } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

// ============================================================
console.log('=== match-type classification ===');
eq('isTeamMt: 1/2 (FFA) false', [isTeamMt(1), isTeamMt(2)], [false, false]);
eq('isTeamMt: 3/4 (team mode 1) true', [isTeamMt(3), isTeamMt(4)], [true, true]);
eq('isTeamMt: 5/6 (mode 2, reserved) false until it ships', [isTeamMt(5), isTeamMt(6)], [false, false]);
eq('appliesLp: 3 (quick team) false -- quick never moves LP', appliesLp(3), false);
eq('appliesLp: 4 (ranked team) false -- pinned until the halved team-LP path ships', appliesLp(4), false);
eq('appliesLp: 2 (ranked FFA) still true', appliesLp(2), true);

// ============================================================
console.log('=== teamRankOf (seat convention (0,1) vs (2,3), winners {1,2}) ===');
const P = (seat, score, id) => ({ seat, score, steamID: id });
// divergence case: raw score order would put s0 (100) first, but team B (95+60=155) beats A (100+40=140)
const parts1 = [P(0, 100, 'a'), P(1, 40, 'b'), P(2, 95, 'c'), P(3, 60, 'd')];
eq('B-total wins: winners {c,d}={1,2} by own score, losers {a,b}={3,4}', teamRankOf(parts1), { c: 1, d: 2, a: 3, b: 4 });
// raw-score divergence made explicit: top individual scorer lands rank 3 when their team loses
eq('top scorer on losing team ranks 3 (NOT 1 as raw score order would)', teamRankOf(parts1).a, 3);
// A wins
eq('A-total wins: {a,b}={1,2}', teamRankOf([P(0, 90, 'a'), P(1, 80, 'b'), P(2, 50, 'c'), P(3, 40, 'd')]), { a: 1, b: 2, c: 3, d: 4 });
// total tie -> team A wins (deterministic, mirrors the client rule)
eq('total tie -> team A wins', teamRankOf([P(0, 50, 'a'), P(1, 50, 'b'), P(2, 60, 'c'), P(3, 40, 'd')]), { a: 1, b: 2, c: 3, d: 4 });
// within-team score tie -> lower seat first (mirrors the client's stable sort)
eq('within-team tie -> lower seat first', teamRankOf([P(0, 50, 'a'), P(1, 50, 'b'), P(2, 90, 'c'), P(3, 90, 'd')]), { c: 1, d: 2, a: 3, b: 4 });
// seat order in the input array must not matter
eq('input order agnostic', teamRankOf([P(3, 60, 'd'), P(0, 100, 'a'), P(2, 95, 'c'), P(1, 40, 'b')]), { c: 1, d: 2, a: 3, b: 4 });
// missing seat (leaver match) -> null (caller falls back to raw score order)
eq('3 seats -> null (fallback to raw order)', teamRankOf([P(0, 100, 'a'), P(1, 40, 'b'), P(2, 95, 'c')]), null);
eq('empty/undefined -> null', [teamRankOf([]), teamRankOf(null)], [null, null]);

// ============================================================
console.log('=== creditXp integration with a team match (type 3 = quick class) ===');
const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const mkRec = (seat, dispCode, sid) => { const d = []; d[5] = seat; return { d, dispCode, steamID: sid }; };
const TODAY = 20000;
{
  // same fixture as parts1: scores by seat [100, 40, 95, 60]; team ranks c=1 d=2 a=3 b=4
  const g = [mkRec(0, 0, A), mkRec(1, 0, B), mkRec(2, 0, C), mkRec(3, 0, D)];
  const scores = [100, 40, 95, 60];
  const rankOf = { [A]: 3, [B]: 4, [C]: 1, [D]: 2 };   // what main() feeds after the teamRankOf overwrite
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  creditXp(g, 3, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  // type 3 = quick class: NO ranked multiplier; daily-first goes to the team-rank-1 player (C)
  const expC = computeXpGain('valid', 0, 95, false, true, 1);    // rank1 + daily first win
  const expD = computeXpGain('valid', 1, 60, false, false, 1);
  const expA = computeXpGain('valid', 2, 100, false, false, 1);  // top scorer, but team lost -> rank3 bonus
  const expB = computeXpGain('valid', 3, 40, false, false, 1);
  eq('team-rank-1 (C) gets rank1 bonus + daily first win', xp[C], expC);
  eq('losing top scorer (A) gets rank3 bonus (not rank1)', xp[A], expA);
  eq('remaining seats credited by team rank', [xp[D], xp[B]], [expD, expB]);
  // quick class: recompute C with the ranked multiplier and confirm it differs (i.e. type 3 did NOT apply it)
  const expCRanked = computeXpGain('valid', 0, 95, true, true, 1);
  if (expCRanked !== expC) ok('type 3 skipped the ranked multiplier (quick class confirmed)');
  else bad('cannot distinguish ranked multiplier (XP_CFG.rankedMult == 1?)');
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== PASS (team-rank) ===');
process.exit(failN ? 1 : 0);
