// ============================================================
// lp-seed.js -- placement seeding (2026-07-14): a player's FIRST ranked settle
// starts from a TrueSkill-derived LP seed instead of 0.
// ============================================================
// Covers: seed formula (clamp both ends / slope / rounding), the platinum cap
// landing OUTSIDE both promotion/relegation bands (a fresh seed must never spawn
// someone directly into a decisive series match at the cap), the new-player
// identity (display <= 1000 -> 0 = the old everyone-starts-bronze behavior),
// and 7-tier segment-table invariants (monotonic mins, band separation, max
// swing < margin -- the crossline proofs must survive any future tier edit).
// Usage: node test/lp-seed.js
// ============================================================
'use strict';
const V = require('../validate.js');
const { seedLp, LP_SEED, LP_SEG, boundaryOf, lpSeg } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => {
  if (JSON.stringify(got) === JSON.stringify(exp)) ok(label + ' = ' + JSON.stringify(got));
  else bad(label + ' = ' + JSON.stringify(got) + ' (EXPECT ' + JSON.stringify(exp) + ')');
};
const t = (label, cond) => cond ? ok(label) : bad(label);

console.log('=== seedLp formula ===');
eq('constants', LP_SEED, { BASE: 1000, SLOPE: 4, CAP: 3200 });
eq('new player (display 1000) -> 0', seedLp(1000), 0);
eq('below base (weak, 900) -> clamp 0', seedLp(900), 0);
eq('display 0 (no skill entry path) -> 0', seedLp(0), 0);
eq('average-ish 1200 -> 800 (silver floor)', seedLp(1200), 800);
eq('good 1500 -> 2000 (gold floor)', seedLp(1500), 2000);
eq('strong 1740 -> 2960 (gold top)', seedLp(1740), 2960);
eq('elite 1800 -> cap 3200 (platinum)', seedLp(1800), 3200);
eq('super elite 3000 -> still cap 3200', seedLp(3000), 3200);
eq('non-numeric -> 0 (|0 coercion)', seedLp(undefined), 0);

console.log('=== cap lands outside decisive-series bands ===');
// A capped seed must be band-free: landing in a promotion/relegation band would make a brand-new
// placement player's very first revealed match a decisive series -- confusing and unearned.
eq('cap 3200 is band-free', boundaryOf(LP_SEED.CAP), null);
t('cap inside platinum (3000..3999)', lpSeg(LP_SEED.CAP).min === 3000);
t('cap clear of relegation band (3000+120)', LP_SEED.CAP > 3000 + 120);
t('cap clear of promotion band (4000-120)', LP_SEED.CAP < 4000 - 120);

console.log('=== 7-tier segment invariants (crossline proofs must survive tier edits) ===');
eq('7 tiers', LP_SEG.length, 7);
eq('tier mins', LP_SEG.map(s => s.min), [0, 600, 2000, 3000, 4000, 6000, 8000]);
{
  let monotonic = true, bandsOk = true, swingOk = true, rsOk = true;
  for (let i = 0; i < LP_SEG.length; i++) {
    const s = LP_SEG[i];
    if (i > 0) {
      if (s.min <= LP_SEG[i - 1].min) monotonic = false;
      // relegation band (bottom 120 of tier i) and promotion band (top 120 below tier i's floor)
      // must not overlap inside the tier BELOW: span > 2 * margin
      if (s.min - LP_SEG[i - 1].min <= 2 * 120) bandsOk = false;
      if (s.rs >= LP_SEG[i - 1].rs) rsOk = false;   // mismatch retention strictly tightens upward
    }
    if (s.win + s.drip >= 120) swingOk = false;     // max natural swing < BOUNDARY_MARGIN
    if (s.loss >= 120) swingOk = false;
  }
  t('mins strictly increasing', monotonic);
  t('every span > 2x margin (240) -- bands never overlap', bandsOk);
  t('max single-game swing (win+drip) < margin on every tier', swingOk);
  t('rs coefficient strictly decreasing (0.70 -> 0.05)', rsOk);
}
// EV gradient sanity: (win-loss)/3 + drip decreasing tier over tier, zero-sum top
{
  const ev = LP_SEG.map(s => (s.win - s.loss) / 3 + s.drip);
  let dec = true;
  for (let i = 1; i < ev.length; i++) if (ev[i] > ev[i - 1]) dec = false;
  t('per-game EV monotonically decreasing (' + ev.map(x => x.toFixed(1)).join(' > ') + ')', dec);
  eq('grandmaster EV = 0 (zero-sum top)', ev[ev.length - 1], 0);
}

console.log('');
if (failN) { console.log('FAIL x ' + failN); process.exit(1); }
console.log('ALL PASS (lp-seed)');
