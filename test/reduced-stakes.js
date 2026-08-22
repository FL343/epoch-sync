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

console.log('=== grandmaster strong stomp -> gain crushed (rs 0.05) ===');
const p4 = reducedStakesPlan([{ steamID: 'G', mmr: 2000, rank: 1, lp: 8500 }, { steamID: 'W', mmr: 1000, rank: 2, lp: 300 }], 2);
eq('grandmaster normal gain = 20', p4.G.normalDelta, 20);
eq('grandmaster crushed gain (20*0.05 -> 1)', p4.G.adjDelta, 1);
eq('grandmaster flag none', p4.G.flag, 0);
eq('weak flag PROTECTED', p4.W.flag, 2);

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

console.log('=== reveal magic ===');
eq('RS_MAGIC = 0xC5', RS_MAGIC, 0xC5);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
