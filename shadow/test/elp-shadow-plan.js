'use strict';
// O759 / O760 shadow math (shadow/elp-shadow-plan.js). Runs in .github/workflows/elp-shadow.yml only -- never in the
//   reconcile workflows' test step (test/*.js): a red shadow must not stop a settle.
//   [1] the normal quantile
//   [2] the empirical reading equals validate.js elpLinesOf at w 1, and CUT_PCT equals its RATING.TIERS7
//   [3] the fits recover a log-normal; the hybrid lines land on the analytic lines
//   [4] credibility: 0 players -> 0, rising with N, Z_k = 0.9 exactly at N = 9 (C_K / TAU)^2; blend at Z 0 / 1
//   [5] few players -> the prior (no players -> exactly the presets the official table publishes)
//   [6] EMA; [7] round + monotone fix as validate.js; [8] the season prior chain
//   [9] O759: ranks, Spearman, deserved points, the bonus / extra-loss caps, the gate
//   [10] the bootstrap (quick) reproduces SHADOW.C_K within 35 %
//   [11] mutations: the plain sorted reading instead of the fit -> the grandmaster error at N 300 is worse;
//        credibility ignoring N -> [5] red; no monotone fix -> [7] red; no swing cap in extraIfOn -> [9] red
const path = require('path');
const fs = require('fs');
const Module = require('module');
const ROOT = path.join(__dirname, '..', '..');
const S = require(path.join(__dirname, '..', 'elp-shadow-plan.js'));
const V = require(path.join(ROOT, 'validate.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));
const B = require(path.join(__dirname, '..', 'sim-bootstrap.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'elp-shadow-plan.js'), 'utf8');
function variant(pairs) {
  let s = SRC;
  for (const [a, b] of pairs) { if (s.indexOf(a) < 0) throw new Error('mutation anchor missing: ' + a.slice(0, 80)); s = s.split(a).join(b); }
  const m = new Module(path.join(__dirname, '..', 'elp-shadow-plan.js'), module);
  m.filename = path.join(__dirname, '..', 'elp-shadow-plan.js'); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  m._compile(s, m.filename);
  return m.exports;
}

// checks reused by the mutations (each returns a list of failures)
function checkFewPlayers(M) {
  const bad = [];
  for (const fam of PP.ELP_FAMS) {
    const pr = PP.ELP.PRIOR[fam].slice();
    const s0 = M.shadowLines([], pr, null);
    if (s0.pass.join() !== pr.join()) bad.push(fam + ' N 0 ' + s0.pass.join('/'));
    const few = M.shadowLines([300, 500, 700, 900, 1100], pr, null);
    if (few.pass.join() !== pr.join()) bad.push(fam + ' N 5 ' + few.pass.join('/'));
  }
  const r = B.rng(11), h = B.sample(B.MODELS.A, r, 12);
  const z12 = M.credOf(12);
  if (!z12.every((z) => z > 0 && z < 0.7)) bad.push('Z at N 12 ' + z12.map((z) => z.toFixed(2)).join('/'));
  void h;
  return bad;
}
function checkMonotone(M) {
  const bad = [];
  const cases = [[[1, 1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6, 7]], [[0.2, 3.4, 3.6, 9, 8.6, 30, 29.6], [1, 3, 4, 9, 10, 30, 31]], [[2, 6, 10, 15, 24, 38, 55], [2, 6, 10, 15, 24, 38, 55]]];
  for (const [inp, want] of cases) { const got = M.finalize(inp); if (got.join() !== want.join()) bad.push(inp.join('/') + ' -> ' + got.join('/')); }
  // the same fix validate.js applies: N >= 200 (w 1) the official pass equals finalize(the empirical lines)
  const r = B.rng(99);
  for (let i = 0; i < 20; i++) {
    const h = B.sample(B.MODELS.D, r, 200 + i * 37);
    const off = V.elpLinesOf(h, PP.ELP.PRIOR.solo).pass, mine = M.finalize(M.linesFromCuts(M.empCuts(h)));
    if (off.join() !== mine.join()) { bad.push('vs validate: ' + off.join('/') + ' / ' + mine.join('/')); break; }
  }
  return bad;
}
function checkExtra(M) {
  const bad = [], cap = PP.ELP.SWING_CAP;
  for (const lp of [8000, 8500, 9000, 9900]) for (const des of [8000, 8400, 9000, 9999]) for (const d of [-60, -20, -1, 1, 20, 56, 100, 119]) for (const pass of [true, false]) {
    if ((pass && d < 0) || (!pass && d > 0)) continue;
    const e = M.extraIfOn(lp, d, pass, des);
    if (Math.abs(d + e) > cap) bad.push('swing ' + (d + e) + ' (lp ' + lp + ', deserved ' + des + ', d ' + d + ')');
    if (e > 0 && !(pass && des > lp)) bad.push('bonus without a pass below the deserved points');
    if (e < 0 && !(!pass && des < lp)) bad.push('extra loss without a miss above the deserved points');
    if (e > S.SHADOW.BONUS_CAP || -e > S.SHADOW.EXTRA_CAP) bad.push('over the cap ' + e);
    if (e > 0 && e > des - lp) bad.push('bonus past the gap');
  }
  return bad;
}

console.log('-- [1] normal quantile');
T('[1] 0.5 -> 0, 0.975 -> 1.959964, 0.01 -> -2.326348, 0.999 -> 3.090232', near(S.normInv(0.5), 0, 1e-12) && near(S.normInv(0.975), 1.959964, 1e-6) && near(S.normInv(0.01), -2.326348, 1e-6) && near(S.normInv(0.999), 3.090232, 1e-6));
T('[1] symmetric', near(S.normInv(0.2) + S.normInv(0.8), 0, 1e-9));

console.log('-- [2] the empirical reading = validate.js elpLinesOf at w 1');
T('[2] CUT_PCT = validate.js RATING.TIERS7 (grandmaster .. silver)', S.SHADOW.CUT_PCT.join() === V.RATING.TIERS7.slice(0, 6).map((x) => x[0]).join());
T('[2] blend bounds still 20 / 200 (the official head-count blend the shadow compares with)', V.RATING.N_PRIOR_ONLY === 20 && V.RATING.N_FULL === 200);
{ const bad = checkMonotone(S).filter((x) => x.startsWith('vs validate')); T('[2] 20 samples N 200..900: finalize(linesFromCuts(empCuts)) = elpLinesOf().pass', bad.length === 0, bad.join('; ')); }

console.log('-- [3] the fits recover a log-normal');
{
  const r = B.rng(5), h = [];
  for (let i = 0; i < 6000; i++) h.push(Math.round(100 * Math.exp(2 + 0.6 * Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r()))));
  const fu = S.fitUpper(h), ff = S.fitFull(h);
  T('[3] upper-half fit: mu ' + fu.mu.toFixed(3) + ' sigma ' + fu.sigma.toFixed(3) + ' (2 / 0.6)', near(fu.mu, 2, 0.05) && near(fu.sigma, 0.6, 0.05));
  T('[3] full fit: mu ' + ff.mu.toFixed(3) + ' sigma ' + ff.sigma.toFixed(3) + ' p0 ' + ff.p0.toFixed(3), near(ff.mu, 2, 0.05) && near(ff.sigma, 0.6, 0.05) && ff.p0 < 0.01);
  const exact = S.linesFromCuts(S.SHADOW.CUT_PCT.map((p) => Math.exp(2 + 0.6 * S.normInv(1 - p / 100))));
  const hy = S.linesOf('hybrid', h).lines;
  T('[3] hybrid lines within 4 % of the analytic ones: ' + hy.map((x) => x.toFixed(1)).join('/') + ' vs ' + exact.map((x) => x.toFixed(1)).join('/'), hy.every((x, k) => Math.abs(Math.log(x / exact[k])) < 0.04));
  T('[3] too few points -> no fit', S.fitUpper([100, 200, 300]) === null && S.fitFull([100, 200]) === null && S.linesOf('hybrid', [100]) === null);
  T('[3] zeros below the median do not break the upper fit', S.fitUpper(new Array(40).fill(0).concat(h.slice(0, 60))) !== null);
}

console.log('-- [4] credibility');
{
  const Z0 = S.credOf(0), Z50 = S.credOf(50), Z500 = S.credOf(500);
  T('[4] N 0 -> 0 for every tier', Z0.every((z) => z === 0));
  T('[4] rises with N; the top tiers (largest C_K) lowest', Z50.every((z, k) => z < Z500[k]) && Z500[6] < Z500[1]);
  const c = S.SHADOW.C_K, t = S.SHADOW.TAU;
  T('[4] Z_k = 0.9 at N = 9 (C_K / TAU)^2', c.every((ck, k) => near(S.credOf(9 * (ck / t) * (ck / t))[k], 0.9, 1e-9)));
  const fl = [3, 7, 11, 14, 18, 25, 33], pr = [2, 6, 10, 15, 24, 38, 55];
  T('[4] blend at Z 0 = prior, at Z 1 = fit, in between in log space', S.blendLog(fl, pr, [0, 0, 0, 0, 0, 0, 0]).every((x, k) => near(x, pr[k], 1e-9)) && S.blendLog(fl, pr, [1, 1, 1, 1, 1, 1, 1]).every((x, k) => near(x, fl[k], 1e-9)) && near(S.blendLog(fl, pr, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])[6], Math.sqrt(33 * 55), 1e-9));
  T('[4] seRel = C_K / sqrt(N); N 0 -> null', near(S.seRelOf(100)[6], c[6] / 10, 1e-12) && S.seRelOf(0)[0] === null);
}

console.log('-- [5] few players -> the prior');
{ const bad = checkFewPlayers(S); T('[5] N 0 and N 5 publish exactly the presets (4 families); N 12 partial credibility', bad.length === 0, bad.join('; ')); }

console.log('-- [6] EMA');
T('[6] no yesterday -> today; alpha 1 -> today; 0.3 mixes', S.ema([10, 20], null).join() === '10,20' && S.ema([10, 20], [0, 0], 1).join() === '10,20' && near(S.ema([10], [20], 0.3)[0], 17, 1e-12) && S.ema([10, 20], [1, 2, 3]).join() === '10,20');

console.log('-- [7] round + monotone fix');
{ const bad = checkMonotone(S); T('[7] cases + validate.js parity', bad.length === 0, bad.join('; ')); }

console.log('-- [8] the season prior chain');
{
  const fin = { 0: { solo: [3, 7, 10, 13, 17, 23, 32] }, 1: { solo: [3, 7, 11, 14, 18, 25, 35] } };
  const p0 = S.priorOf('solo', 0, fin), p1 = S.priorOf('solo', 1, fin), p2 = S.priorOf('solo', 2, fin), p3 = S.priorOf('solo', 3, fin), pd = S.priorOf('duo', 1, fin);
  T('[8] season 0 -> preset', p0.src === 'preset' && p0.lines.join() === PP.ELP.PRIOR.solo.join());
  T('[8] season 1 -> geometric mix of the S0 final and the preset', p1.src === 's0-final+preset' && near(p1.lines[6], Math.sqrt(32 * 55), 1e-9));
  T('[8] season 2 -> the S1 final', p2.src === 's1-final' && p2.lines.join() === fin[1].solo.join());
  T('[8] no final of the previous season -> preset', p3.src === 'preset' && pd.src === 'preset');
}

console.log('-- [9] O759');
{
  T('[9] mid ranks with ties', S.pctRanks([5, 1, 5, 9]).join() === [0.5, 0, 0.5, 1].join() && S.pctRanks([7]).join() === '0.5');
  T('[9] Spearman: same order 1, reversed -1, monotone transform 1', near(S.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1, 1e-12) && near(S.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-12) && near(S.spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]), 1, 1e-12) && S.spearman([1, 1], [2, 3]) === null);
  T('[9] deserved 8000 .. 9999', S.deservedOf(0) === 8000 && S.deservedOf(1) === 9999 && S.deservedOf(0.5) === 9000 && S.deservedOf(2) === 9999);
  const bad = checkExtra(S);
  T('[9] extraIfOn: bonus only on a pass below the deserved points, extra loss only on a miss above, caps, |run| <= SWING_CAP', bad.length === 0, bad.slice(0, 3).join('; '));
  T('[9] examples: pass 300 below (+60), pass 30 below (+30), near the swing cap (+19), miss 500 above (-20)', S.extraIfOn(8700, 40, true, 9000) === 60 && S.extraIfOn(8970, 40, true, 9000) === 30 && S.extraIfOn(8700, 100, true, 9000) === 19 && S.extraIfOn(9500, -30, false, 9000) === -20);
  const g1 = S.gateOf(20, 0.8), g2 = S.gateOf(19, 0.95), g3 = S.gateOf(40, null), g4 = S.gateOf(40, 0.7);
  T('[9] gate: 20 + 0.8 opens; 19 / no correlation / 0.7 stay closed', g1.open && !g2.open && g2.needPool === 1 && !g3.open && g3.needCorr === null && !g4.open && near(g4.needCorr, 0.1, 1e-9));
}

console.log('-- [10] the bootstrap reproduces C_K');
{
  const Bq = B.bootstrap({ Ns: [300], R: 60 }), ck = B.cKOf(Bq, 'hybrid', 300);
  T('[10] quick bootstrap C_K ' + ck.map((x) => x.toFixed(2)).join('/') + ' within 35 % of SHADOW.C_K', ck.every((x, k) => Math.abs(Math.log(x / S.SHADOW.C_K[k])) < 0.3));
  const em = B.cKOf(Bq, 'emp', 300);
  T('[11] the plain sorted reading (the official live lines) is worse at the top (quick run: > 1.1 x; the full bootstrap: 3.39 vs 2.29): grandmaster C_K ' + em[6].toFixed(2) + ' vs fit ' + ck[6].toFixed(2), em[6] > ck[6] * 1.1);
}

console.log('-- [11] mutations');
{
  const noN = variant([['return N > 0 ? N / (N + K) : 0;', 'return 1;']]);
  T('[11] credibility ignoring N turns [5] red', checkFewPlayers(noN).length > 0);
  const noMono = variant([['for (let k = 0; k < out.length; k++) out[k] = Math.max(k ? out[k - 1] + 1 : 1, out[k]); return out; }', 'return out; }']]);
  T('[11] no monotone fix turns [7] red', checkMonotone(noMono).length > 0);
  const noCap = variant([['Math.min(gap, SHADOW.BONUS_CAP, cap - (d | 0))', 'Math.min(gap, SHADOW.BONUS_CAP)']]);
  T('[11] no swing cap in extraIfOn turns [9] red', checkExtra(noCap).length > 0);
}

console.log(failN ? ('elp-shadow-plan: ' + failN + ' FAIL') : 'elp-shadow-plan: all ok');
process.exit(failN ? 1 : 0);
