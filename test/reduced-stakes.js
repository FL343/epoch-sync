'use strict';
const path = require('path');
const { reducedStakesPlan, RS_MAGIC, lpSeg } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const t = (label, cond) => cond ? ok(label) : bad(label);

console.log('=== not applicable -> null ===');
eq('quick (matchType 1)', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 1000 }, { steamID: 'B', mmr: 1800, rank: 2, lp: 1000 }], 1), null);
eq('< 2 players', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 1000 }], 2), null);
eq('spread <= threshold (200)', reducedStakesPlan([{ steamID: 'A', mmr: 1000, rank: 1, lp: 1000 }, { steamID: 'B', mmr: 1200, rank: 2, lp: 1000 }], 2), null);

console.log('=== 2P mismatch, weak loses -> PROTECTED (bronze) ===');
const p2 = reducedStakesPlan([{ steamID: 'S', mmr: 1600, rank: 1, lp: 1000 }, { steamID: 'W', mmr: 1000, rank: 2, lp: 1000 }], 2);
t('triggered (non-null)', p2 != null);
eq('weak flag = PROTECTED(2)', p2.W.flag, 2);
eq('strong flag = none(0)', p2.S.flag, 0);
t('weak normal is a real loss (<0)', p2.W.normalDelta < 0);
t('weak loss compressed (adj less negative than normal)', p2.W.adjDelta > p2.W.normalDelta);
t('strong gain compressed (0 < adj < normal)', p2.S.adjDelta > 0 && p2.S.adjDelta < p2.S.normalDelta);

console.log('=== 2P mismatch, weak WINS -> UPSET (full at bonus 1.0) ===');
const p3 = reducedStakesPlan([{ steamID: 'S', mmr: 1600, rank: 2, lp: 1000 }, { steamID: 'W', mmr: 1000, rank: 1, lp: 1000 }], 2);
eq('weak flag = UPSET(1)', p3.W.flag, 1);
eq('weak full (adj === normal at bonus 1.0)', p3.W.adjDelta, p3.W.normalDelta);
eq('strong flag = none(0)', p3.S.flag, 0);
eq('strong upset-loss mild (FP-safe: -15*0.5+5 -> -2)', p3.S.adjDelta, -2);
t('strong upset-loss milder than full loss', p3.S.adjDelta > p3.S.normalDelta);

console.log('=== grandmaster strong stomp -> gain crushed (rs 0.05) ===');
const p4 = reducedStakesPlan([{ steamID: 'G', mmr: 2000, rank: 1, lp: 8500 }, { steamID: 'W', mmr: 1000, rank: 2, lp: 1000 }], 2);
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
  { steamID: 'A', mmr: 1800, rank: 1, lp: 1000 },
  { steamID: 'B', mmr: 1700, rank: 2, lp: 1000 },
  { steamID: 'C', mmr: 1000, rank: 3, lp: 1000 },
  { steamID: 'D', mmr: 900, rank: 4, lp: 1000 },
], 2);
eq('A (top strong) flag none', p6.A.flag, 0);
eq('B (strong) flag none', p6.B.flag, 0);
eq('C (weak, net 0) flag none -> no false PROTECTED', p6.C.flag, 0);
eq('D (weak, net loss) flag PROTECTED', p6.D.flag, 2);
t('A gain compressed', p6.A.adjDelta < p6.A.normalDelta);
t('D loss protected', p6.D.adjDelta > p6.D.normalDelta);

console.log('=== reveal magic ===');
eq('RS_MAGIC = 0xC5', RS_MAGIC, 0xC5);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
