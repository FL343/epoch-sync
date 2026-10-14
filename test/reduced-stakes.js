'use strict';
const path = require('path');
const { reducedStakesPlan, RS_MAGIC, lpSeg } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const t = (label, cond) => cond ? ok(label) : bad(label);

console.log('=== not applicable -> null ===');
eq('quick (matchType 1)', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 300 }, { steamID: 'B', mmr: 1800, rank: 2, lp: 300 }], 1), null);
eq('< 2 players', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 300 }], 2), null);
eq('spread <= threshold (200)', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 300 }, { steamID: 'B', mmr: 1200, rank: 2, lp: 300 }], 2), null);

console.log('=== 2P mismatch, weak loses -> PROTECTED (bronze) ===');
const p2 = reducedStakesPlan([{ steamID: 'S', mmr: 1600, rank: 1, lp: 300 }, { steamID: 'W', mmr: 1000, rank: 2, lp: 300 }], 2);
t('triggered (non-null)', p2 != null);
eq('weak flag = PROTECTED(2)', p2.W.flag, 2);
eq('strong flag = none(0)', p2.S.flag, 0);
t('weak normal is a real loss (<0)', p2.W.normalDelta < 0);
t('weak loss compressed (adj less negative than normal)', p2.W.adjDelta > p2.W.normalDelta);
t('strong gain compressed (0 < adj < normal)', p2.S.adjDelta > 0 && p2.S.adjDelta < p2.S.normalDelta);

console.log('=== 2P mismatch, weak WINS -> UPSET (full at bonus 1.0) ===');
const p3 = reducedStakesPlan([{ steamID: 'S', mmr: 1600, rank: 2, lp: 300 }, { steamID: 'W', mmr: 1000, rank: 1, lp: 300 }], 2);
eq('weak flag = UPSET(1)', p3.W.flag, 1);
eq('weak full (adj === normal at bonus 1.0)', p3.W.adjDelta, p3.W.normalDelta);
eq('strong flag = none(0)', p3.S.flag, 0);
eq('strong upset-loss mild (FP-safe: -15*0.5+5 -> -2)', p3.S.adjDelta, -2);
t('strong upset-loss milder than full loss', p3.S.adjDelta > p3.S.normalDelta);

console.log('=== grandmaster strong stomp -> gain crushed to nothing (rs 0, zero-sum top, Q160) ===');
const p4 = reducedStakesPlan([{ steamID: 'G', mmr: 2000, rank: 1, lp: 8500 }, { steamID: 'W', mmr: 1000, rank: 2, lp: 300 }], 2);
eq('grandmaster normal gain = 20', p4.G.normalDelta, 20);
eq('grandmaster crushed gain (20*0 -> 0)', p4.G.adjDelta, 0);
eq('grandmaster flag none', p4.G.flag, 0);
eq('weak flag PROTECTED', p4.W.flag, 2);
{
  const { teamLpPlan } = require('../validate.js');
  const t4 = teamLpPlan([{ steamID: 'a', seat: 0, mmr: 2000, lp: 8500 }, { steamID: 'b', seat: 1, mmr: 2000, lp: 8500 },
    { steamID: 'c', seat: 2, mmr: 1000, lp: 0 }, { steamID: 'd', seat: 3, mmr: 1000, lp: 0 }], 6, [6100, 5200, 4800, 3900], [], 0);
  eq('grandmaster team expected win: normal round(20/2) = 10 each', [t4.a.normalDelta, t4.b.normalDelta], [10, 10]);
  eq('grandmaster team expected win crushed to nothing (round(20*0/2) + 0)', [t4.a.adjDelta, t4.b.adjDelta], [0, 0]);
  eq('grandmaster upset loss stays the mild penalty (-20*0.5 = -10)', reducedStakesPlan([{ steamID: 'G', mmr: 2000, rank: 2, lp: 8500 }, { steamID: 'W', mmr: 1000, rank: 1, lp: 300 }], 2).G.adjDelta, -10);
}

console.log('=== drip never discounted (only the win/loss component is scaled) ===');
const seg = lpSeg(1000);
const adjCorrect = Math.round(-15 * seg.rs + seg.drip);       // drip added AFTER scaling base
const adjIfDiscounted = Math.round((-15 + seg.drip) * seg.rs); // wrong: drip scaled too
t('drip-preserved differs from drip-discounted', adjCorrect !== adjIfDiscounted);
eq('p2.W uses drip-preserved formula', p2.W.adjDelta, adjCorrect);

console.log('=== 4P FFA mismatch: field-mean split + no false reveal for a net-0 middle ===');
const p6 = reducedStakesPlan([
  { steamID: 'A', mmr: 1800, rank: 1, lp: 300 },
  { steamID: 'B', mmr: 1700, rank: 2, lp: 300 },
  { steamID: 'C', mmr: 1000, rank: 3, lp: 300 },
  { steamID: 'D', mmr: 900, rank: 4, lp: 300 },
], 2);
eq('A (top strong) flag none', p6.A.flag, 0);
eq('B (strong) flag none', p6.B.flag, 0);
eq('C (weak, net 0) flag none -> no false PROTECTED', p6.C.flag, 0);
eq('D (weak, net loss) flag PROTECTED', p6.D.flag, 2);
t('A gain compressed', p6.A.adjDelta < p6.A.normalDelta);
t('D loss protected', p6.D.adjDelta > p6.D.normalDelta);

// ============================================================
// O82 6P matchmaking: FFA trio unit (mtCode bits 8..10 = start seat + 1) settles at the 3-man
// average rank (the pair rule generalized), and the solo-tilt kicks in against a LIVE trio:
// solo losses compressed x RS_SOLO_VS_TRIO (escort shield, PROTECTED reveal), trio wins
// compressed x RS_TRIO_WIN (convoy tax, silent). Factors compose with mismatch by min().
// ============================================================
console.log('=== O82 trio unit + solo tilt ===');
const path82 = require('path');
const V82 = require(path82.join(__dirname, '..', 'validate.js'));
const { RS_SOLO_VS_TRIO, RS_TRIO_WIN } = V82;
eq('tilt factors pinned (conservative start, B5/B6 calibration)', [RS_SOLO_VS_TRIO, RS_TRIO_WIN], [0.6, 0.7]);
{
  // 6P FFA, no mismatch (equal mmr): trio seats 0-2 rank {1,2,3}, solos rank {4,5,6}.
  const mk6 = (ranks) => [0, 1, 2, 3, 4, 5].map(s => ({ steamID: 'p' + s, seat: s, mmr: 1000, rank: ranks[s], lp: 300 }));
  const trioAt = 1;   // seats 0-2
  const pT = reducedStakesPlan(mk6([1, 2, 3, 4, 5, 6]), 2, 0, trioAt);
  t('trio plan non-null without mismatch (unit present)', pT != null);
  eq('trio members share one delta (avg rank 2)', [pT.p0.adjDelta === pT.p1.adjDelta, pT.p1.adjDelta === pT.p2.adjDelta], [true, true]);
  // trio avg rank 2 -> prog 0.8 -> winning base -> convoy tax x0.7
  const seg82 = lpSeg(300);
  const trioBase = seg82.win * (2 * 0.8 - 1);
  eq('trio win taxed x' + RS_TRIO_WIN, pT.p0.adjDelta, Math.round(trioBase * RS_TRIO_WIN + seg82.drip));
  eq('trio normalDelta untaxed', pT.p0.normalDelta, Math.round(trioBase + seg82.drip));
  eq('trio tax is silent (no reveal flag)', pT.p0.flag, 0);
  // losing solos: base < 0 -> escort shield x0.6 + PROTECTED
  const soloProg6 = (6 - 1 - (6 - 1)) / 5;   // rank 6 -> prog 0
  const soloBase6 = -seg82.loss * (1 - 2 * soloProg6);
  eq('last solo shielded x' + RS_SOLO_VS_TRIO, pT.p5.adjDelta, Math.round(soloBase6 * RS_SOLO_VS_TRIO + seg82.drip));
  eq('last solo flag PROTECTED', pT.p5.flag, 2);
  t('rank-4 solo also below the line -> shielded too', pT.p3.adjDelta > pT.p3.normalDelta);
  // winning solo (solo rank 1, trio takes 2/3/4): a solo GAIN is never shielded
  const pW = reducedStakesPlan(mk6([2, 3, 4, 1, 5, 6]), 2, 0, trioAt);
  eq('winning solo keeps full gain (shield is loss-only)', pW.p3.adjDelta, pW.p3.normalDelta);
  // trio member absent -> unit dissolves -> all-solo no-mismatch -> null (conservative like pairs)
  const partsMissing = mk6([1, 2, 3, 4, 5, 6]).filter(p => p.seat !== 1);
  eq('trio member absent + fair field -> null (fall back to plain path)', reducedStakesPlan(partsMissing, 2, 0, trioAt), null);
  // trio + pair coexist (5P {3,2}): both units settle at their averages
  const p5p = reducedStakesPlan([
    { steamID: 'd0', seat: 0, mmr: 1000, rank: 4, lp: 300 },
    { steamID: 'd1', seat: 1, mmr: 1000, rank: 5, lp: 300 },
    { steamID: 't0', seat: 2, mmr: 1000, rank: 1, lp: 300 },
    { steamID: 't1', seat: 3, mmr: 1000, rank: 2, lp: 300 },
    { steamID: 't2', seat: 4, mmr: 1000, rank: 3, lp: 300 },
  ], 2, 1, 3);   // pair bit0 (seats 0,1) + trio at seats 2-4
  t('5P {3,2}: pair unit shares a delta', p5p.d0.adjDelta === p5p.d1.adjDelta);
  t('5P {3,2}: trio unit shares a delta', p5p.t0.adjDelta === p5p.t1.adjDelta && p5p.t1.adjDelta === p5p.t2.adjDelta);
  // quick (mt 1) still never plans
  eq('quick (mt 1) with trio bits -> null', reducedStakesPlan(mk6([1, 2, 3, 4, 5, 6]), 1 | (trioAt << 8), 0, trioAt), null);
}

// ============================================================
// Q160 layer 5 (cloud audit): a strong side's expected win is compressed at the team / unit average tier for every
// member, the strong one included (architecture decision 10). The rework's fourth layer held the strong member at his
// own tier: it cut a grandmaster carrying zero-points accounts (a known residual now, +4 a 2V2 win, +9 a 3V3) but cut
// the honest grandmaster queued with lower-tier friends as hard (a gold friend, 6 wins in 8: -12 where this gives +12).
// ============================================================
console.log('=== Q160 layer 5: the strong member of a mixed-tier party takes the team plan on an expected win ===');
{
  const { teamLpPlan } = require('../validate.js');
  const P = (id, seat, mmr, lp) => ({ steamID: id, seat, mmr, lp });
  // one line for every member of a strong team on an expected win: adjDelta less the member's own drip is the team's
  const sameLine = (plan, ids) => {
    const v = ids.map((id, i) => plan[id].adjDelta - lpSeg(LPS[id]).drip);
    return v.every((x) => Math.abs(x - v[0]) <= 1);
  };
  const LPS = { g: 8500, f: 2500, z: 0, z1: 0, z2: 0, m: 6500, d: 4500, p: 3500, b: 300 };
  // the honest case the fourth layer cut: grandmaster + gold friend (diamond average, rs .30) beat two golds
  const tf = teamLpPlan([P('g', 0, 2000, 8500), P('f', 1, 1600, 2500), P('c', 2, 1000, 2500), P('d', 3, 1000, 2500)], 6, [6100, 5200, 4800, 3900], [], 0);
  eq('grandmaster + gold friend 2V2 expected win: grandmaster round(28*.3/2 + 0) = 4 (fourth layer: 0), gold round(28*.3/2 + 3) = 7', [tf.g.adjDelta, tf.f.adjDelta], [4, 7]);
  t('grandmaster + gold friend: one team line (adjDelta less own drip)', sameLine(tf, ['g', 'f']));
  const tfl = teamLpPlan([P('g', 0, 2000, 8500), P('f', 1, 1600, 2500), P('c', 2, 1000, 2500), P('d', 3, 1000, 2500)], 6, [3000, 2000, 6100, 5200], [], 1);
  eq('grandmaster + gold friend upset loss unchanged round(-25*.5/2 + own drip)', [tfl.g.adjDelta, tfl.f.adjDelta], [-6, -3]);
  // 8 matches, 6 wins (the review's H8): 6 x 4 - 2 x 6 = +12 for the grandmaster, never a net loss on a winning run
  eq('grandmaster + gold friend, 6 wins in 8: grandmaster +12 (fourth layer: -12)', 6 * tf.g.adjDelta + 2 * tfl.g.adjDelta, 12);
  // a master with a diamond friend (one tier apart): master takes the team plan too
  const tm = teamLpPlan([P('m', 0, 2000, 6500), P('d', 1, 1700, 4500), P('c', 2, 1200, 4500), P('e', 3, 1200, 4500)], 6, [6100, 5200, 4800, 3900], [], 0);
  t('master + diamond friend expected win: one team line, master above his own-tier plan', sameLine(tm, ['m', 'd'])
    && tm.m.adjDelta > Math.round(lpSeg(5500).win * lpSeg(6500).rs / 2 + lpSeg(6500).drip));
  // the carry (known residual, accepted under decision 10): grandmaster + zero vs two zeros
  const t2 = teamLpPlan([P('g', 0, 2000, 8500), P('z', 1, 1000, 0), P('c', 2, 1000, 0), P('e', 3, 1000, 0)], 6, [6100, 5200, 4800, 3900], [], 0);
  eq('2V2 grandmaster + zero (residual): grandmaster 4, zero round(28*.3/2 + 5) = 9', [t2.g.adjDelta, t2.z.adjDelta], [4, 9]);
  eq('2V2: normal deltas unchanged (round(28/2 + own drip))', [t2.g.normalDelta, t2.z.normalDelta], [14, 19]);
  eq('2V2: strong side never flags', [t2.g.flag, t2.z.flag], [0, 0]);
  const t3 = teamLpPlan([P('g', 0, 2000, 8500), P('z1', 1, 1000, 0), P('z2', 2, 1000, 0), P('c', 3, 1000, 0), P('d', 4, 1000, 0), P('e', 5, 1000, 0)], 9, [6100, 5200, 5000, 4800, 3900, 3000], [], 0);
  eq('3V3 grandmaster + two zeros (gold average, rs .50, residual): grandmaster round(35*.5/2) = 9, zeros 14', [t3.g.adjDelta, t3.z1.adjDelta, t3.z2.adjDelta], [9, 14, 14]);
  t('3V3: one team line', sameLine(t3, ['g', 'z1', 'z2']));
  const ts2 = teamLpPlan([P('g', 0, 1000, 8500), P('z', 1, 1000, 0), P('c', 2, 2000, 0), P('d', 3, 2000, 0)], 6, [6100, 5200, 4800, 3900], [], 0);
  eq('weak team upset win unchanged (full: round(28/2 + own drip))', [ts2.g.adjDelta, ts2.z.adjDelta], [14, 19]);
  // FFA pair: grandmaster + gold friend premade (seats 0-1) takes 1st and 2nd over two golds: one unit delta
  const pp = reducedStakesPlan([{ steamID: 'g', seat: 0, mmr: 2000, rank: 1, lp: 8500 }, { steamID: 'f', seat: 1, mmr: 1600, rank: 2, lp: 2500 },
    { steamID: 'c', seat: 2, mmr: 1000, rank: 3, lp: 2500 }, { steamID: 'd', seat: 3, mmr: 1000, rank: 4, lp: 2500 }], 0x12, 1);
  t('FFA pair grandmaster + gold friend, 1st and 2nd: one shared delta, above zero (fourth layer: grandmaster 0)', pp.g.adjDelta === pp.f.adjDelta && pp.g.adjDelta > 0);
  eq('FFA pair: one normal delta for the unit', pp.g.normalDelta, pp.f.normalDelta);
  eq('FFA pair: won kept', [pp.g.won, pp.f.won], [true, true]);
  const pz = reducedStakesPlan([{ steamID: 'g', seat: 0, mmr: 2000, rank: 1, lp: 8500 }, { steamID: 'z', seat: 1, mmr: 1000, rank: 2, lp: 0 },
    { steamID: 'c', seat: 2, mmr: 1000, rank: 3, lp: 0 }, { steamID: 'd', seat: 3, mmr: 1000, rank: 4, lp: 0 }], 0x12, 1);
  eq('FFA pair grandmaster + zero (residual): one unit delta round(18.67*.3 + 2) = 8', [pz.g.adjDelta, pz.z.adjDelta], [8, 8]);
  const ppl = reducedStakesPlan([{ steamID: 'g', seat: 0, mmr: 2000, rank: 3, lp: 8500 }, { steamID: 'f', seat: 1, mmr: 1600, rank: 4, lp: 2500 },
    { steamID: 'c', seat: 2, mmr: 1000, rank: 1, lp: 2500 }, { steamID: 'd', seat: 3, mmr: 1000, rank: 2, lp: 2500 }], 0x12, 1);
  t('FFA pair upset loss: both members still share one delta', ppl.g.adjDelta === ppl.f.adjDelta && ppl.g.adjDelta < 0);
  // FFA trio: grandmaster + two gold friends (seats 0-2) take 1-3 over three gold solos: one unit delta
  const mkT = [0, 1, 2, 3, 4, 5].map((s) => ({ steamID: 'q' + s, seat: s, mmr: s === 0 ? 2000 : (s < 3 ? 1500 : 1000), rank: s + 1, lp: s === 0 ? 8500 : 2500 }));
  const pt = reducedStakesPlan(mkT, 2, 0, 1);
  t('FFA trio grandmaster + two gold friends: one shared delta, above zero', pt.q0.adjDelta === pt.q1.adjDelta && pt.q1.adjDelta === pt.q2.adjDelta && pt.q0.adjDelta > 0);
  // a weak premade's upset win and a fair match keep one shared delta (as before)
  const pw = reducedStakesPlan([{ steamID: 'a', seat: 0, mmr: 1000, rank: 1, lp: 3500 }, { steamID: 'b', seat: 1, mmr: 1000, rank: 2, lp: 300 },
    { steamID: 'c', seat: 2, mmr: 2000, rank: 3, lp: 300 }, { steamID: 'd', seat: 3, mmr: 2000, rank: 4, lp: 300 }], 0x12, 1);
  t('weak mixed-tier pair upset win: one shared full delta (UPSET)', pw.a.adjDelta === pw.b.adjDelta && pw.a.adjDelta === pw.a.normalDelta && pw.a.flag === 1);
  const pf = reducedStakesPlan([{ steamID: 'g', seat: 0, mmr: 1500, rank: 1, lp: 8500 }, { steamID: 'f', seat: 1, mmr: 1500, rank: 2, lp: 2500 },
    { steamID: 'c', seat: 2, mmr: 1400, rank: 3, lp: 2500 }, { steamID: 'd', seat: 3, mmr: 1300, rank: 4, lp: 2500 }], 0x12, 1);
  t('fair match (no mismatch), grandmaster + gold pair wins: one shared full delta', pf.g.adjDelta === pf.f.adjDelta && pf.g.adjDelta === pf.g.normalDelta && pf.g.adjDelta > 0);
  const ph = reducedStakesPlan([{ steamID: 'a', seat: 0, mmr: 1600, rank: 1, lp: 300 }, { steamID: 'b', seat: 1, mmr: 1600, rank: 2, lp: 300 },
    { steamID: 'c', seat: 2, mmr: 1000, rank: 3, lp: 300 }, { steamID: 'd', seat: 3, mmr: 900, rank: 4, lp: 300 }], 0x12, 1);
  eq('honest same-tier strong pair: unchanged shared delta', [ph.a.adjDelta, ph.b.adjDelta], [Math.round(lpSeg(300).win * (2 * (2.5 / 3) - 1) * lpSeg(300).rs + lpSeg(300).drip), Math.round(lpSeg(300).win * (2 * (2.5 / 3) - 1) * lpSeg(300).rs + lpSeg(300).drip)]);
  // Q167's leaver branch (an expected win where the losing team left at the start) takes the same team plan: grandmaster
  // + gold friend present (400 apart, no spread among the present), both opponents convicted leavers at 1000
  const tg = teamLpPlan([P('g', 0, 2000, 8500), P('f', 1, 1600, 2500)], 6, [6100, 5200, 0, 0], [2, 3], 0, [{ seat: 2, mmr: 1000 }, { seat: 3, mmr: 1000 }]);
  eq('Q167 leavers: grandmaster + gold friend take the team plan (4 / 7), not the own-tier 0', [tg.g.adjDelta, tg.f.adjDelta], [4, 7]);
}

console.log('=== reveal magic ===');
eq('RS_MAGIC = 0xC5', RS_MAGIC, 0xC5);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
