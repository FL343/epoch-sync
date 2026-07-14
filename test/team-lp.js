'use strict';
// Unit tests for the M3 team rating/points path (PARTY_MODES plan §5), which ships as ONE change:
//   1. trueskill.updateTeamMatch -- two-team update (team strength = sum mu, binary outcome,
//      per-member variance-scaled updates; 1v1 reduces to exactly the pairwise updateMatch step).
//   2. teamLpPlan -- halved team-LP for match type 4 (team-average tier for the win/loss component,
//      own-tier drip added un-halved), mismatch compensation at team granularity, and the
//      abandoned-teammate loss shield. appliesLp(4) flips true in the same change (red line:
//      a type-4 record must never reach the individual full-stakes LP path).
//   3. reducedStakesPlan premade units -- the FFA "premade debt" (design line 66): a premade
//      seat-pair (mask in matchType bits 4..7) settles at its average rank / average tier and both
//      members get the SAME delta; solos keep the original formula bit for bit.
//   node test/team-lp.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const ts = require(path.join(__dirname, '..', 'trueskill.js'));
const { teamLpPlan, reducedStakesPlan, lpDelta, lpSeg, appliesLp, isTeamMt, baseMt, premadeMaskOf } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const t = (label, cond) => cond ? ok(label) : bad(label);
const near = (label, got, exp, tol) => Math.abs(got - exp) <= (tol == null ? 1e-9 : tol) ? ok(label) : bad(label + ' = ' + got + ' (EXPECT ~' + exp + ')');

// ============================================================
console.log('=== matchType helpers (base nibble + premade mask) ===');
eq('baseMt: low nibble', [baseMt(2), baseMt(0x12), baseMt(0x32), baseMt(4)], [2, 2, 2, 4]);
eq('premadeMaskOf: bits 4..7', [premadeMaskOf(2), premadeMaskOf(0x12), premadeMaskOf(0x22), premadeMaskOf(0x32)], [0, 1, 2, 3]);

// ============================================================
console.log('=== updateTeamMatch: 1v1 reduces to the pairwise updateMatch step ===');
{
  const a = { id: 'a', mu: 27, sigma: 7.5 }, b = { id: 'b', mu: 24, sigma: 8.1 };
  const pair = ts.updateMatch([{ id: 'a', rank: 1, mu: a.mu, sigma: a.sigma }, { id: 'b', rank: 2, mu: b.mu, sigma: b.sigma }]);
  const team = ts.updateTeamMatch([{ rank: 1, players: [a] }, { rank: 2, players: [b] }]);
  const by = (arr) => { const o = {}; for (const p of arr) o[p.id] = p; return o; };
  const P = by(pair), T = by(team);
  near('winner mu identical', T.a.mu, P.a.mu);
  near('winner sigma identical', T.a.sigma, P.a.sigma);
  near('loser mu identical', T.b.mu, P.b.mu);
  near('loser sigma identical', T.b.sigma, P.b.sigma);
}

console.log('=== updateTeamMatch: 2v2 basics ===');
{
  const mk = (id) => ({ id, mu: 25, sigma: 25 / 3 });
  const out = ts.updateTeamMatch([{ rank: 1, players: [mk('w1'), mk('w2')] }, { rank: 2, players: [mk('l1'), mk('l2')] }]);
  const by = {}; for (const p of out) by[p.id] = p;
  t('both winners gain mu', by.w1.mu > 25 && by.w2.mu > 25);
  t('both losers drop mu', by.l1.mu < 25 && by.l2.mu < 25);
  t('equal-sigma teammates move equally (no INTRA-team transfer)', Math.abs(by.w1.mu - by.w2.mu) < 1e-9);
  t('all sigmas shrink', out.every(p => p.sigma < 25 / 3 + 1e-9));
  near('zero-sum at equal sigma', by.w1.mu - 25, 25 - by.l1.mu, 1e-9);
}
{
  // upset (weak team wins) moves mu more than an expected win
  const T = (mu) => [{ id: 'x' + mu, mu, sigma: 4 }, { id: 'y' + mu, mu, sigma: 4 }];
  const upset = ts.updateTeamMatch([{ rank: 1, players: T(20) }, { rank: 2, players: T(30) }]);
  const expected = ts.updateTeamMatch([{ rank: 1, players: T(30) }, { rank: 2, players: T(20) }]);
  const gain = (out, id) => out.find(p => p.id === id).mu - 20;
  t('underdog win gains more than expected win', gain(upset, 'x20') > (expected.find(p => p.id === 'x30').mu - 30));
}
{
  // under-manned team (abandoned teammate): still updates, present players only
  const out = ts.updateTeamMatch([{ rank: 1, players: [{ id: 'solo', mu: 25, sigma: 8 }] }, { rank: 2, players: [{ id: 'l1', mu: 25, sigma: 8 }, { id: 'l2', mu: 25, sigma: 8 }] }]);
  eq('1v2 returns all present players', out.length, 3);
  t('under-manned winner gains', out.find(p => p.id === 'solo').mu > 25);
  // draw / empty-team guards return inputs unchanged (mu-wise)
  const draw = ts.updateTeamMatch([{ rank: 1, players: [{ id: 'a', mu: 25, sigma: 8 }] }, { rank: 1, players: [{ id: 'b', mu: 25, sigma: 8 }] }]);
  t('equal rank -> no mu movement', draw.every(p => Math.abs(p.mu - 25) < 1e-9));
  const empty = ts.updateTeamMatch([{ rank: 1, players: [] }, { rank: 2, players: [{ id: 'b', mu: 25, sigma: 8 }] }]);
  t('empty side -> no movement', Math.abs(empty[0].mu - 25) < 1e-9);
}

// ============================================================
console.log('=== teamLpPlan: halved team LP, full drip, team-average tier ===');
const TP = (id, seat, mmr, lp) => ({ steamID: id, seat, mmr, lp });
{
  // fair 4P bronze, B (95+60=155) beats A (100+40=140)
  const parts = [TP('a', 0, 1000, 300), TP('b', 1, 1000, 300), TP('c', 2, 1000, 300), TP('d', 3, 1000, 300)];
  const plan = teamLpPlan(parts, 4, [100, 40, 95, 60], []);
  t('mt4 plan non-null', plan != null);
  eq('winners: round(45/2 + 5) = 28 each (halved win, full drip)', [plan.c.adjDelta, plan.d.adjDelta], [28, 28]);
  eq('losers: round(-15/2 + 5) = -2 each', [plan.a.adjDelta, plan.b.adjDelta], [-2, -2]);
  eq('fair match: no flags', [plan.a.flag, plan.c.flag], [0, 0]);
  const seg = lpSeg(300);
  t('drip NOT halved (would be ' + Math.round((seg.win + seg.drip) / 2) + ' if it were)', plan.c.adjDelta !== Math.round((seg.win + seg.drip) / 2));
  eq('not a team type -> null', teamLpPlan(parts, 2, [100, 40, 95, 60], []), null);
  eq('quick team (mt 3) -> null (quick never moves LP)', teamLpPlan(parts, 3, [100, 40, 95, 60], []), null);
  eq('short score vector -> null', teamLpPlan(parts, 4, [100, 40], []), null);
  // total tie -> team A wins (mirrors teamRankOf / client rule)
  const tie = teamLpPlan(parts, 4, [50, 50, 60, 40], []);
  t('total tie -> team A takes the win component', tie.a.adjDelta === 28 && tie.c.adjDelta === -2);
}
{
  // team-average tier picks the win/loss component; drip stays own-tier
  // A = {1900 silver, 2100 gold} -> avg 2000 = GOLD (win 35); B = bronze (7-tier 2026-07-14: silver 600-1999)
  const parts = [TP('a', 0, 1000, 1900), TP('b', 1, 1000, 2100), TP('c', 2, 1000, 300), TP('d', 3, 1000, 300)];
  const plan = teamLpPlan(parts, 4, [100, 40, 30, 20], []);
  eq('A winners share the GOLD 35/2 component; drip differs by own tier (silver 4 / gold 3)',
    [plan.a.adjDelta, plan.b.adjDelta], [Math.round(35 / 2 + 4), Math.round(35 / 2 + 3)]);
  eq('B losers: bronze team avg -> round(-15/2 + 5)', [plan.c.adjDelta, plan.d.adjDelta], [-2, -2]);
}
{
  // mismatch at TEAM granularity (design line 118: team-average tier coefficient, team LP then halved)
  const strongWin = teamLpPlan(
    [TP('s1', 0, 1600, 300), TP('s2', 1, 1600, 300), TP('w1', 2, 1000, 300), TP('w2', 3, 1000, 300)],
    4, [100, 90, 40, 30], []);
  eq('strong expected win compressed by team-avg rs (.70): round(45*.7/2+5)=21', [strongWin.s1.adjDelta, strongWin.s2.adjDelta], [21, 21]);
  eq('strong side never flags', [strongWin.s1.flag, strongWin.s2.flag], [0, 0]);
  eq('weak protected loss: round(-15*.7/2+5)=0, flag=2 on real net loss (normal -2)',
    [strongWin.w1.adjDelta, strongWin.w1.flag, strongWin.w1.normalDelta], [0, 2, -2]);
  const upset = teamLpPlan(
    [TP('s1', 0, 1600, 300), TP('s2', 1, 1600, 300), TP('w1', 2, 1000, 300), TP('w2', 3, 1000, 300)],
    4, [40, 30, 100, 90], []);
  eq('weak upset win: full at bonus 1.0 (adj == normal == 28), flag UPSET', [upset.w1.adjDelta, upset.w1.normalDelta, upset.w1.flag], [28, 28, 1]);
  eq('strong upset loss mild (x0.5): round(-15*.5/2+5)=1', upset.s1.adjDelta, 1);
}
{
  // §7 abandoned-teammate shield: seat 1 convicted absent, team A loses -> seat 0 loss compressed by OWN rs
  const parts = [TP('a', 0, 1000, 300), TP('c', 2, 1000, 300), TP('d', 3, 1000, 300)];
  const plan = teamLpPlan(parts, 4, [100, 40, 95, 60], [1]);
  eq('abandoned teammate: loss * own rs (.70) -> 0, flag PROTECTED', [plan.a.adjDelta, plan.a.flag], [0, 2]);
  eq('winners unaffected by the shield', [plan.c.adjDelta, plan.d.adjDelta], [28, 28]);
  // the absent leaver's FROZEN score still counts for his team's total: A total 140 includes seat1's 40
  const flipped = teamLpPlan(parts, 4, [100, 60, 95, 60], [1]);   // A 160 > B 155 -> A wins thanks to the frozen 60
  t('leaver frozen score counts toward team total (survivor wins)', flipped.a.adjDelta === 28 && flipped.a.flag === 0);
}

// ============================================================
console.log('=== reducedStakesPlan premade units (FFA debt, design line 66) ===');
{
  // regression: no mask + fair match -> null (plain lpDelta path unchanged)
  const parts = [TP('a', 0, 1000, 300), TP('b', 1, 1000, 300), TP('c', 2, 1000, 300), TP('d', 3, 1000, 300)];
  parts.forEach((p, i) => { p.rank = i + 1; });
  eq('mask 0 + fair -> null', reducedStakesPlan(parts, 2, 0), null);
  eq('mask omitted (legacy call) -> null', reducedStakesPlan(parts, 2), null);
}
const RP = (id, seat, rank, mmr, lp) => ({ steamID: id, seat, rank, mmr, lp });
{
  // pair at (2,3) with ranks {2,3}: avg 2.5 in 4P -> exactly mid -> win/loss component 0 -> drip only
  const parts = [RP('a', 0, 1, 1000, 300), RP('b', 1, 4, 1000, 300), RP('c', 2, 2, 1000, 300), RP('d', 3, 3, 1000, 300)];
  const plan = reducedStakesPlan(parts, 0x22, premadeMaskOf(0x22));
  t('live pair -> plan returned even without mismatch', plan != null);
  eq('pair at avg rank 2.5 -> drip only (+5) and SAME delta both members', [plan.c.adjDelta, plan.d.adjDelta], [5, 5]);
  eq('solos keep the original formula (== lpDelta)', [plan.a.adjDelta, plan.b.adjDelta], [lpDelta(300, 1, 4), lpDelta(300, 4, 4)]);
  eq('no mismatch -> no flags', [plan.a.flag, plan.c.flag], [0, 0]);
}
{
  // pair takes ranks {1,2}: each gets the rank-1.5 interpolation (the debt: no full rank-1 payout),
  // and the pair's combined payout equals the two individual payouts (linear interpolation preserves the sum)
  const parts = [RP('a', 0, 3, 1000, 300), RP('b', 1, 4, 1000, 300), RP('c', 2, 1, 1000, 300), RP('d', 3, 2, 1000, 300)];
  const plan = reducedStakesPlan(parts, 0x22, 2);
  eq('pair ranks {1,2} -> both round(45*2/3 + 5) = 35', [plan.c.adjDelta, plan.d.adjDelta], [35, 35]);
  t('debt: no member gets the solo rank-1 payout (50)', plan.c.adjDelta < lpDelta(300, 1, 4));
  eq('pair sum == solo sum (interpolation is linear)', plan.c.adjDelta + plan.d.adjDelta, lpDelta(300, 1, 4) + lpDelta(300, 2, 4));
}
{
  // partner absent (leaver): survivor falls back to SOLO; with no other live pair + fair -> null
  const parts = [RP('a', 0, 1, 1000, 300), RP('b', 1, 2, 1000, 300), RP('c', 2, 3, 1000, 300)];   // seat 3 absent
  eq('pair incomplete + fair -> null (survivor settles solo via lpDelta)', reducedStakesPlan(parts, 0x22, 2), null);
}
{
  // duo+duo FFA (both pairs premade, e.g. ranked S0 while team modes are dark): mask=3, two pair units
  const parts = [RP('a', 0, 1, 1000, 300), RP('b', 1, 4, 1000, 300), RP('c', 2, 2, 1000, 300), RP('d', 3, 3, 1000, 300)];
  const plan = reducedStakesPlan(parts, 0x32, 3);
  eq('both pairs at avg 2.5 -> everyone drip-only (+5)', [plan.a.adjDelta, plan.b.adjDelta, plan.c.adjDelta, plan.d.adjDelta], [5, 5, 5, 5]);
}
{
  // quick FFA never moves LP, masked or not
  const parts = [RP('a', 0, 1, 1000, 300), RP('b', 1, 2, 1000, 300), RP('c', 2, 3, 1000, 300), RP('d', 3, 4, 1000, 300)];
  eq('masked quick (0x21) -> null', reducedStakesPlan(parts, 0x21, 2), null);
  eq('team type routed elsewhere -> null even with a mask', reducedStakesPlan(parts, 4, 2), null);
}
{
  // mismatch + premade: the PAIR is one mismatch unit (average rating vs match mean)
  const P2 = [
    { steamID: 'p1', seat: 0, rank: 1, mmr: 1600, lp: 300 },
    { steamID: 'p2', seat: 1, rank: 2, mmr: 1600, lp: 300 },
    { steamID: 's1', seat: 2, rank: 3, mmr: 1000, lp: 300 },
    { steamID: 's2', seat: 3, rank: 4, mmr: 900, lp: 300 },
  ];
  const plan = reducedStakesPlan(P2, 0x12, 1);
  t('strong premade pair compressed + same delta', plan.p1.adjDelta === plan.p2.adjDelta && plan.p1.adjDelta < plan.p1.normalDelta);
  eq('pair normal = rank-1.5 interpolation (35)', plan.p1.normalDelta, 35);
  eq('weak bottom solo protected', plan.s2.flag, 2);
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== PASS (team-lp) ===');
process.exit(failN ? 1 : 0);
