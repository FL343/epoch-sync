'use strict';
// ============================================================
// shadow/elp-shadow-plan.js -- the O759 / O760 SHADOW math (pure functions + constants). Computes, never writes.
// ============================================================
// The shadow runs as its own workflow (.github/workflows/elp-shadow.yml) and only reads the state file the reconcile job
//   already committed. Nothing official requires this file: validate.js / points-plan.js / the reconcile workflows stay as
//   they are (shadow/test/elp-shadow-run.js pins that). Adopting a part later is its own change (a constant / a variable
//   in the official job + the client), decided on the history this shadow leaves on the shadow/elp branch.
//
// O760 (pass lines from few players): the official job blends the prior lines into the live lines by head count
//   (N <= 20 prior only, N >= 200 live only; the live line of a tier = the middle of its percentile span, read off the
//   sorted hidden skills). The top tiers sit on the top 1 % / 4 %: at N = 200 that is 2 / 8 players, so the line jumps
//   with every one of them. The shadow reads the same percentiles off a FITTED curve instead:
//   1. fit a log-normal to the hidden skills of the family's placed players (FIT_METHOD; sim-bootstrap.js compares the
//      variants: the full hurdle fit, the upper-half quantile fit, and the hybrid = upper-half fit for the cuts at or
//      above the median + the plain sorted value below it),
//   2. the seven lines from the curve by the official definition (linesFromCuts: the same percentiles, the same middles),
//   3. weigh each line against the prior by credibility Z_k = N / (N + K_k), K_k = (C_K[k] / TAU)^2 -- inverse-variance
//      weighting: the fitted line's relative standard error is about C_K[k] / sqrt(N) (measured by the bootstrap),
//      the prior's TAU; in log space (lines are ratios: a 10 % miss at 55 levels and at 6 levels weigh the same),
//   4. smooth day over day (EMA_ALPHA of today, the rest yesterday's smoothed line; restarts on a season change),
//   5. round + the official monotone fix (each line >= the one below + 1, >= 1).
//   The prior: season 0 the static preset (points-plan.js ELP.PRIOR); season 1 the season-0 final mixed with the preset
//   (S0 is two weeks: PRIOR_MIX_S1 of the final); season 2+ the previous season's final smoothed lines.
// O759 (grandmaster calibration, off by default, opens by itself): per family the grandmaster pool (points >= 8000),
//   ranked by hidden skill; a player's deserved points = 8000 + percentile x 1999. The switch would open when
//   ① the effective pool (grandmasters with a full window of WINDOW settled runs) >= GM_POOL_MIN and
//   ② the percentile ranks of the players in both pools correlate >= GM_CORR_MIN day over day (Spearman).
//   If open: a pass below the deserved points adds a bonus (up to the gap, BONUS_CAP), a miss above them takes a little
//   more (up to the excess, EXTRA_CAP); a run never moves more than ELP.SWING_CAP in total. The shadow reports what that
//   would have done to the runs of the last day. BONUS_CAP / EXTRA_CAP are first guesses, to be tuned on real data.
// ============================================================
const path = require('path');
const PP = require(path.join(__dirname, '..', 'points-plan.js'));
const ELP = PP.ELP, LP_SEG = PP.LP_SEG;

const SHADOW = Object.freeze({
  VER: 1,
  // the percentiles of the official live lines (validate.js RATING.TIERS7: top x % lower bounds, grandmaster .. silver);
  //   shadow/test/elp-shadow-run.js checks they equal validate.js's
  CUT_PCT: Object.freeze([1, 4, 10, 20, 35, 60]),
  FIT_METHOD: 'hybrid',
  FIT_MIN: 8,                 // points the fit needs (placed players in the fitted part); fewer -> the prior alone
  SHOW_MIN: 20,               // the per-family empirical / fitted values are printed from this many placed players up
  // relative RMSE x sqrt(N) of each fitted line (bronze .. grandmaster), FIT_METHOD 'hybrid', measured by
  //   shadow/sim-bootstrap.js [1] (the median over its four population models at N = 300). With TAU 0.3 a line counts as
  //   real data (Z >= 0.9) from N = 9 (C_K / TAU)^2: bronze .. gold about 90, platinum 110, diamond 160, master 300,
  //   grandmaster 520 placed players
  C_K: Object.freeze([0.94, 0.89, 0.94, 1.05, 1.25, 1.74, 2.29]),
  TAU: 0.3,                   // the prior's relative uncertainty (log space); sim-bootstrap.js [2b]: the lowest error of 0.2..0.7
  EMA_ALPHA: 0.3,             // today's share of the published line; sim-bootstrap.js [3]: jitter 3.0 % -> 1.4 % a day, 90 % of a jump in 6.5 days
  PRIOR_MIX_S1: 0.5,          // season 1 prior: this share of the season-0 final, the rest the static preset (log space)
  LINE_FLOOR: 0.5,            // levels: the floor before a log (bronze lines of 1-2 levels)
  // O759
  GM_TIER: 6, GM_MIN: 8000, GM_SPAN: 1999,
  GM_POOL_MIN: 20, GM_CORR_MIN: 0.8, GM_CORR_PAIRS: 5,
  BONUS_CAP: 60, EXTRA_CAP: 20,
});

// ---- the standard normal quantile (Acklam's rational approximation, |relative error| < 1.2e-9) ----
const NA = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const NB = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
const NC = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const ND = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
function normInv(p) {
  if (!(p > 0 && p < 1)) return p <= 0 ? -Infinity : Infinity;
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((NC[0] * q + NC[1]) * q + NC[2]) * q + NC[3]) * q + NC[4]) * q + NC[5]) / ((((ND[0] * q + ND[1]) * q + ND[2]) * q + ND[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((NC[0] * q + NC[1]) * q + NC[2]) * q + NC[3]) * q + NC[4]) * q + NC[5]) / ((((ND[0] * q + ND[1]) * q + ND[2]) * q + ND[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((NA[0] * r + NA[1]) * r + NA[2]) * r + NA[3]) * r + NA[4]) * r + NA[5]) * q / (((((NB[0] * r + NB[1]) * r + NB[2]) * r + NB[3]) * r + NB[4]) * r + 1);
}

// ---- lines ----
// the seven lines (levels, floats; bronze .. grandmaster) from the six cut values c (levels; grandmaster .. silver lower
//   bounds): the official definition (validate.js elpLinesOf): the middle of each tier's span, grandmaster its cut + half
//   the master span
function linesFromCuts(c) {
  const lower = [0, c[5], c[4], c[3], c[2], c[1], c[0]];
  const out = [];
  for (let k = 0; k < 7; k++) out.push(k < 6 ? (lower[k] + lower[k + 1]) / 2 : c[0] + (c[0] - c[1]) / 2);
  return out;
}
// the cut values off the sorted hidden skills (hidden100 ints), exactly as validate.js elpLinesOf reads them
function empCuts(h100) {
  const N = h100.length, s = h100.slice().sort((a, b) => b - a);
  return SHADOW.CUT_PCT.map((pct) => (N ? (s[Math.min(N - 1, Math.max(1, Math.ceil(pct / 100 * N)) - 1)] | 0) / 100 : 0));
}
// a fit's cut values: the level at quantile 1 - pct / 100
function fitCuts(fit) { return SHADOW.CUT_PCT.map((pct) => fit.q(1 - pct / 100)); }

// the full hurdle log-normal: the zero share p0 + mean / sd of the logs of the positive skills (levels)
function fitFull(h100) {
  const x = h100.map((v) => (v | 0) / 100), pos = x.filter((v) => v > 0);
  if (pos.length < SHADOW.FIT_MIN) return null;
  const p0 = (x.length - pos.length) / x.length, ln = pos.map(Math.log);
  const mu = ln.reduce((s, v) => s + v, 0) / ln.length;
  const sd = Math.sqrt(ln.reduce((s, v) => s + (v - mu) * (v - mu), 0) / Math.max(1, ln.length - 1));
  if (!(sd > 0)) return null;
  return { method: 'full', mu, sigma: sd, p0, n: pos.length, q: (p) => (p <= p0 ? 0 : Math.exp(mu + sd * normInv((p - p0) / (1 - p0)))) };
}
// the upper-half quantile fit: least squares of log(skill) on the normal score of its plotting position (Blom), over the
//   placed players at or above the median -- the bottom (zeros, one-run tourists) does not bend the top
function fitUpper(h100) {
  const x = h100.map((v) => (v | 0) / 100).sort((a, b) => a - b), N = x.length;
  const zs = [], ys = [];
  for (let i = 0; i < N; i++) { const p = (i + 1 - 0.375) / (N + 0.25); if (p >= 0.5 && x[i] > 0) { zs.push(normInv(p)); ys.push(Math.log(x[i])); } }
  if (zs.length < SHADOW.FIT_MIN) return null;
  const mz = zs.reduce((s, v) => s + v, 0) / zs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < zs.length; i++) { sxy += (zs[i] - mz) * (ys[i] - my); sxx += (zs[i] - mz) * (zs[i] - mz); }
  const sigma = sxx > 0 ? sxy / sxx : 0;
  if (!(sigma > 0)) return null;
  const mu = my - sigma * mz;
  return { method: 'upper', mu, sigma, n: zs.length, q: (p) => Math.exp(mu + sigma * normInv(p)) };
}
// the cuts of one method (null = not enough points): 'emp' the sorted values, 'full' / 'upper' the curve, 'hybrid' the
//   upper-half curve for the cuts at or above the median and the sorted value below it (the bronze / silver cut at the
//   40th percentile has plenty of players; the curve is extrapolated there)
function cutsOf(method, h100) {
  if (method === 'emp') return h100.length ? { cuts: empCuts(h100), fit: null } : null;
  const fit = method === 'full' ? fitFull(h100) : fitUpper(h100);
  if (!fit) return null;
  const cuts = fitCuts(fit);
  if (method === 'hybrid') { const e = empCuts(h100); SHADOW.CUT_PCT.forEach((pct, i) => { if (1 - pct / 100 < 0.5) cuts[i] = e[i]; }); }
  return { cuts, fit };
}
function linesOf(method, h100) { const c = cutsOf(method, h100); return c ? { lines: linesFromCuts(c.cuts), cuts: c.cuts, fit: c.fit } : null; }

// the credibility of each line at N placed players (0..1)
function credOf(N, cK, tau) { return (cK || SHADOW.C_K).map((c) => { const K = (c / (tau || SHADOW.TAU)) * (c / (tau || SHADOW.TAU)); return N > 0 ? N / (N + K) : 0; }); }
// the estimated relative standard error of each fitted line at N
function seRelOf(N, cK) { return (cK || SHADOW.C_K).map((c) => (N > 0 ? c / Math.sqrt(N) : null)); }
// each line: the fitted value and the prior weighed by Z in log space
function blendLog(fitLines, prior, Z) {
  const f = SHADOW.LINE_FLOOR;
  return prior.map((p, k) => (fitLines ? Math.exp(Z[k] * Math.log(Math.max(f, fitLines[k])) + (1 - Z[k]) * Math.log(Math.max(f, p))) : Math.max(f, p)));
}
// the day-over-day smoothing: today's share alpha (no yesterday = today)
function ema(raw, prevSmooth, alpha) {
  const a = alpha == null ? SHADOW.EMA_ALPHA : alpha;
  return (Array.isArray(prevSmooth) && prevSmooth.length === raw.length) ? raw.map((v, k) => a * v + (1 - a) * prevSmooth[k]) : raw.slice();
}
// round + the official monotone fix (validate.js elpLinesOf)
function finalize(lines) { const out = lines.map((v) => Math.round(v)); for (let k = 0; k < out.length; k++) out[k] = Math.max(k ? out[k - 1] + 1 : 1, out[k]); return out; }
// the prior lines of family fam in season s; finals = { season: { fam: [7 floats] } } (the last smoothed lines of each season)
function priorOf(fam, s, finals) {
  const preset = (ELP.PRIOR[fam] || ELP.PRIOR.solo).slice();
  const prev = finals && finals[String((s | 0) - 1)] && finals[String((s | 0) - 1)][fam];
  if (!(s >= 1) || !Array.isArray(prev) || prev.length !== 7) return { lines: preset, src: 'preset' };
  if ((s | 0) === 1) { const a = SHADOW.PRIOR_MIX_S1, f = SHADOW.LINE_FLOOR; return { lines: preset.map((p, k) => Math.exp(a * Math.log(Math.max(f, prev[k])) + (1 - a) * Math.log(Math.max(f, p)))), src: 's0-final+preset' }; }
  return { lines: prev.slice(), src: 's' + ((s | 0) - 1) + '-final' };
}
// one family's shadow lines for one day: h100 = the placed players' hidden skills; prior = priorOf(...).lines; prevSmooth =
//   yesterday's smoothed lines of the same season (or null)
function shadowLines(h100, prior, prevSmooth, opt) {
  const o = opt || {}, method = o.method || SHADOW.FIT_METHOD, N = h100.length;
  const l = N >= SHADOW.FIT_MIN ? linesOf(method, h100) : null;
  const Z = l ? credOf(N, o.cK, o.tau) : prior.map(() => 0);
  const raw = blendLog(l ? l.lines : null, prior, Z);
  const smooth = ema(raw, prevSmooth, o.alpha);
  return { N, method, fit: l ? l.fit : null, fitLines: l ? l.lines : null, cuts: l ? l.cuts : null, Z, raw, smooth, pass: finalize(smooth) };
}

// ---- O759 ----
// the mid-rank percentile (0 lowest .. 1 highest) of each value; one value -> 0.5
function pctRanks(vals) {
  const n = vals.length, idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]), out = new Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && vals[idx[j + 1]] === vals[idx[i]]) j++; const r = (i + j) / 2; for (let k = i; k <= j; k++) out[idx[k]] = n > 1 ? r / (n - 1) : 0.5; i = j + 1; }
  return out;
}
// Pearson correlation of two equal-length arrays (null when either has no spread)
function pearson(a, b) {
  const n = a.length; if (n < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
  return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : null;
}
// Spearman of two equal-length arrays = Pearson of their mid ranks
function spearman(a, b) { return pearson(pctRanks(a), pctRanks(b)); }
function deservedOf(pct) { return SHADOW.GM_MIN + Math.round(Math.max(0, Math.min(1, pct)) * SHADOW.GM_SPAN); }
// what the calibration would add (> 0) / take (< 0) on top of a settled run's change d (the run passed or not), for a player
//   whose points before the run were lpBefore and whose deserved points are deserved; a run moves SWING_CAP at most
function extraIfOn(lpBefore, d, pass, deserved) {
  const gap = (deserved | 0) - (lpBefore | 0), cap = ELP.SWING_CAP;
  if (pass && gap > 0) return Math.max(0, Math.min(gap, SHADOW.BONUS_CAP, cap - (d | 0)));
  if (!pass && gap < 0) return -Math.max(0, Math.min(-gap, SHADOW.EXTRA_CAP, cap + (d | 0)));
  return 0;
}
// the gate: { pool (effective pool >= GM_POOL_MIN), corr (>= GM_CORR_MIN; null correlation = not met), open (both) }
function gateOf(effective, corr) {
  const pool = (effective | 0) >= SHADOW.GM_POOL_MIN, c = corr != null && corr >= SHADOW.GM_CORR_MIN;
  return { pool, corr: c, open: pool && c, needPool: Math.max(0, SHADOW.GM_POOL_MIN - (effective | 0)), needCorr: corr == null ? null : Math.max(0, +(SHADOW.GM_CORR_MIN - corr).toFixed(3)) };
}

module.exports = {
  SHADOW, normInv, linesFromCuts, empCuts, fitCuts, fitFull, fitUpper, cutsOf, linesOf, credOf, seRelOf, blendLog, ema, finalize,
  priorOf, shadowLines, pctRanks, pearson, spearman, deservedOf, extraIfOn, gateOf,
};
