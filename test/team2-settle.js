'use strict';
// Unit tests for the mode-2 (base 5/6) settle path, which ships as ONE change:
//   1. MT_ALLOWED gains 5/6; sanityFlags extends the team branch (no premade mask, strictly 4
//      seats) and gives mode-2 a x3 score headroom for the gamble round (TEAM2.SCORE_MULT).
//   2. The match OUTCOME is a sub-score race, not money: team2WinTeamOf derives the winner from
//      the writers' own rank claims ({1,2}v{3,4} convention, unanimity required); a conflict is
//      sanity-flagged ('rank-conflict'), never settled from money order.
//   3. team2RankOf assigns convention ranks from the derived winner (block offsets, so absent
//      seats never collapse to money order); teamRankOf's money-sum overwrite stays 3/4-only.
//   4. appliesLp(6) flips true in the same change that routes mode-2 through teamLpPlan with a
//      winTeamOverride (red line: a base-6 record must never reach the money-derived team path,
//      and 5 stays LP-free like every quick code).
//   node test/team2-settle.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const { appliesLp, isTeamMt, isSubScoreMt, team2WinTeamOf, team2RankOf, teamRankOf, teamLpPlan,
        sanityFlags, SANITY, TEAM2, baseMt } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const t = (label, cond) => cond ? ok(label) : bad(label);

// consistent-group record builder: only the fields the functions under test read.
//   d layout (v3): [magic, ver, mt, hash, seed, seat, rank, win|prog<<1, pc, dur, ...scores, disp]
const REC = (sid, seat, rank, o) => {
  o = o || {};
  const scores = o.scores || [100, 40, 95, 60];
  return {
    steamID: sid, shard: 0, dispCode: 0, disp: 'finished', roster: o.roster || {},
    d: [0xB1, 3, (o.mt == null ? 5 : o.mt), 12345, 678, seat, rank, 1 | ((o.prog == null ? 5 : o.prog) << 1), scores.length, (o.dur == null ? 900 : o.dur)].concat(scores, [0]),
  };
};
// full honest group under the convention: winners (rank 1,2 by score) + losers (3,4)
const fullGroup = (winTeam, o) => {
  o = o || {};
  const scores = o.scores || [100, 40, 95, 60];
  const parts = [0, 1, 2, 3].map(s => ({ seat: s, score: scores[s] }));
  const blocks = [parts.filter(p => ((p.seat >> 1) & 1) === winTeam), parts.filter(p => ((p.seat >> 1) & 1) !== winTeam)]
    .map(b => b.sort((x, y) => (y.score !== x.score) ? y.score - x.score : x.seat - y.seat));
  const rankBySeat = {};
  blocks.forEach((b, bi) => b.forEach((p, i) => { rankBySeat[p.seat] = bi * 2 + i + 1; }));
  return [0, 1, 2, 3].map(s => REC('sid' + s, s, rankBySeat[s], Object.assign({ scores }, o)));
};

// ============================================================
console.log('=== helper domains ===');
eq('isTeamMt covers 3/4/5/6 (masked too)', [isTeamMt(3), isTeamMt(4), isTeamMt(5), isTeamMt(6), isTeamMt(2), isTeamMt(7)], [true, true, true, true, false, false]);
eq('isSubScoreMt = 5/6 only', [isSubScoreMt(5), isSubScoreMt(6), isSubScoreMt(3), isSubScoreMt(4), isSubScoreMt(7)], [true, true, false, false, false]);
eq('appliesLp: 6 joins {2,4}; 5 stays quick (no LP)', [appliesLp(5), appliesLp(6), appliesLp(2), appliesLp(4), appliesLp(1), appliesLp(3)], [false, true, true, true, false, false]);
t('MT_ALLOWED contains 5 and 6', SANITY.MT_ALLOWED.indexOf(5) >= 0 && SANITY.MT_ALLOWED.indexOf(6) >= 0);
t('TEAM2.SCORE_MULT exported (gamble headroom pin for the client lockstep)', (TEAM2.SCORE_MULT | 0) >= 1);

// ============================================================
console.log('=== team2WinTeamOf: claims-derived outcome, unanimity required ===');
{
  eq('unanimous A win (full group)', team2WinTeamOf(fullGroup(0)), 0);
  eq('unanimous B win (full group)', team2WinTeamOf(fullGroup(1)), 1);
  // RED LINE: B wins the sub-score race while holding LESS money than A -> still team B.
  const g = fullGroup(1, { scores: [500, 400, 90, 60] });
  eq('B wins with less money (sub-score beats money)', team2WinTeamOf(g), 1);
  // partial groups: any unanimous subset decides (same trust level as the score vector itself)
  eq('winners-only pair claims', team2WinTeamOf([REC('a', 0, 1, {}), REC('b', 1, 2, {})]), 0);
  eq('losers-only pair claims (their claim convicts themselves)', team2WinTeamOf([REC('c', 2, 3, {}), REC('d', 3, 4, {})]), 0);
  eq('lone winner claim from team B seat', team2WinTeamOf([REC('c', 2, 1, {})]), 1);
  // conflicts / malformed
  const cf = fullGroup(0); cf[2].d[6] = 1;   // seat 2 also claims a winning rank
  eq('conflicting claims -> null', team2WinTeamOf(cf), null);
  const od = fullGroup(0); od[1].d[6] = 5;
  eq('out-of-domain rank -> null', team2WinTeamOf(od), null);
  const z = fullGroup(0); z[0].d[6] = 0;
  eq('rank 0 (unset) -> null', team2WinTeamOf(z), null);
}

// ============================================================
console.log('=== team2RankOf: convention blocks from the derived winner ===');
const P = (id, seat, score) => ({ steamID: id, seat, score });
{
  const parts = [P('a', 0, 100), P('b', 1, 40), P('c', 2, 95), P('d', 3, 60)];
  eq('B wins: losers keep {3,4} by score, winners {1,2} by score', team2RankOf(parts, 1), { c: 1, d: 2, a: 3, b: 4 });
  eq('A wins: mirror', team2RankOf(parts, 0), { a: 1, b: 2, c: 3, d: 4 });
  // intra-team order = own score desc, tie -> lower seat
  const tie = [P('a', 0, 50), P('b', 1, 50), P('c', 2, 10), P('d', 3, 90)];
  eq('intra-team tie -> lower seat first', team2RankOf(tie, 0), { a: 1, b: 2, d: 3, c: 4 });
  // RED LINE: money-rich losers stay {3,4} (teamRankOf would call them winners)
  const rich = [P('a', 0, 500), P('b', 1, 400), P('c', 2, 90), P('d', 3, 60)];
  eq('rich losers stay {3,4}', team2RankOf(rich, 1), { c: 1, d: 2, a: 3, b: 4 });
  eq('(contrast) teamRankOf money rule would flip it', teamRankOf(rich), { a: 1, b: 2, c: 3, d: 4 });
  // absent seats: block offsets survive (never collapse to dense money order)
  eq('absent winner: lone winner rank 1, losers {3,4}', team2RankOf([P('c', 2, 95), P('a', 0, 500), P('b', 1, 400)], 1), { c: 1, a: 3, b: 4 });
  eq('winners-only group', team2RankOf([P('a', 0, 40), P('b', 1, 90)], 0), { b: 1, a: 2 });
  eq('null winner -> null (caller flags upstream)', team2RankOf(parts, null), null);
}

// ============================================================
console.log('=== teamLpPlan winTeamOverride (mode-2 red line) ===');
const TP = (id, seat, mmr, lp) => ({ steamID: id, seat, mmr, lp });
{
  const parts = [TP('a', 0, 1000, 300), TP('b', 1, 1000, 300), TP('c', 2, 1000, 300), TP('d', 3, 1000, 300)];
  // money says A (140 > 95+60=155? no: A=140, B=155 -> money says B). Use scores where money says A:
  const scores = [500, 400, 90, 60];   // A=900, B=150 by money
  const plan6 = teamLpPlan(parts, 6, scores, [], 1);   // sub-score says B
  t('mt6 plan non-null (appliesLp(6) live)', plan6 != null);
  eq('override wins over money: B takes the win component (+28 each)', [plan6.c.adjDelta, plan6.d.adjDelta], [28, 28]);
  eq('money-rich A takes the loss (-2 each)', [plan6.a.adjDelta, plan6.b.adjDelta], [-2, -2]);
  // no override -> money fallback unchanged (3/4 path compatibility; prod always passes it for 5/6)
  const planMoney = teamLpPlan(parts, 6, scores, []);
  eq('no override -> money fallback (A wins)', [planMoney.a.adjDelta, planMoney.c.adjDelta], [28, -2]);
  eq('mt5 (quick mode-2) -> null, LP never moves', teamLpPlan(parts, 5, scores, [], 1), null);
  // mt4 existing behavior byte-identical when override is omitted (regression anchor)
  const plan4 = teamLpPlan(parts, 4, [100, 40, 95, 60], []);
  eq('mt4 unchanged (B wins by money): winners +28 / losers -2', [plan4.c.adjDelta, plan4.a.adjDelta], [28, -2]);
}

// ============================================================
console.log('=== sanityFlags: mode-2 branch ===');
{
  eq('clean mt5 group -> no flags', sanityFlags(fullGroup(0)), []);
  eq('clean mt6 group -> no flags', sanityFlags(fullGroup(1, { mt: 6 })), []);
  // gamble headroom: above the global cap but inside cap*TEAM2.SCORE_MULT is legal for 5/6 only
  const hi = Math.round(SANITY.SCORE_CAP * (TEAM2.SCORE_MULT - 0.5));
  eq('mt5 score inside the x' + TEAM2.SCORE_MULT + ' headroom -> clean', sanityFlags(fullGroup(0, { scores: [hi, 40, 95, 60] })), []);
  t('same score on mt3 -> flagged (headroom is mode-2 only)', sanityFlags(fullGroup(0, { mt: 3, scores: [hi, 40, 95, 60] })).indexOf('score') >= 0);
  const over = Math.round(SANITY.SCORE_CAP * TEAM2.SCORE_MULT) + 1;
  t('mt5 above the headroom -> score flag', sanityFlags(fullGroup(0, { scores: [over, 40, 95, 60] })).indexOf('score') >= 0);
  // structural: never a premade mask, strictly 4 seats
  t('masked mode-2 code (0x15) -> team-mask', sanityFlags(fullGroup(0, { mt: 0x15 })).indexOf('team-mask') >= 0);
  t('pc!=4 -> pc flag', sanityFlags([REC('a', 0, 1, { scores: [100, 40] }), REC('b', 1, 2, { scores: [100, 40] })]).indexOf('pc') >= 0);
  // rank conflict inside a score-consistent group = forgery evidence -> flag-don't-settle
  const cf = fullGroup(0); cf[2].d[6] = 1;
  t('rank conflict -> rank-conflict flag', sanityFlags(cf).indexOf('rank-conflict') >= 0);
  t('mt3 group never checks rank claims (no conflict flag)', sanityFlags(fullGroup(0, { mt: 3 })).indexOf('rank-conflict') < 0);
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== PASS (team2-settle) ===');
process.exit(failN ? 1 : 0);
