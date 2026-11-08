'use strict';
// ============================================================
// shadow/sim-bootstrap.js -- O760: how many placed players before the pass lines can trust real data, and how much to
//   smooth day over day. Fixed random seed; about half a minute. Prints the tables shadow/README.md quotes; the constants
//   SHADOW.C_K / SHADOW.EMA_ALPHA (shadow/elp-shadow-plan.js) come from here.
// ============================================================
// Made-up players: a true level (mean depth) ~ log-normal over the population, runs log-normal around it (coefficient of
//   variation 0.3 / 0.6, as test/endless-lp-sim.js), 5..10 runs in the window, the hidden skill = points-plan.js hiddenOf.
//   Four population models: A median 7 levels, spread 0.6 · B median 7, spread 0.9 · C two groups (80 % median 5 spread 0.6
//   + 20 % median 15 spread 0.5: not log-normal at all) · D median 4, spread 0.9 + 15 % tourists around 0.7 levels (many
//   zero runs). The truth of a model = the official live lines (the sorted values, validate.js elpLinesOf) of 200 000 players.
// [1] bootstrap: R samples of N players per model; each method's lines vs the truth: relative RMSE and bias per tier
//     (emp = the official live reading, full = hurdle log-normal, upper = upper-half quantile fit, hybrid = upper above
//     the median + the sorted value below); C_K = the hybrid RMSE x sqrt(N) at N 300 (median over the models)
// [2] the whole new line (hybrid + credibility against the preset prior) vs the official blend (head count 20 .. 200),
//     both against the truth, by N: which N is "real data" for each
// [2b] the prior weight TAU: the [2] error averaged over the models, per TAU and N
// [3] a season day by day (players arrive, play, place; a 12 % skill rise on day 50 = a balance patch): day-over-day
//     jitter, how often a published line moves, error vs the truth, the EMA's step response (90 %), per EMA alpha
// Usage: node shadow/sim-bootstrap.js [--quick]   (--quick: fewer samples, for shadow/test/elp-shadow-plan.js)
// ============================================================
const path = require('path');
const PP = require(path.join(__dirname, '..', 'points-plan.js'));
const S = require(path.join(__dirname, 'elp-shadow-plan.js'));

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function depthOf(r, mu, cv) { const s = Math.sqrt(Math.log(1 + cv * cv)); return Math.max(0, Math.round(mu * Math.exp(s * gauss(r) - s * s / 2))); }
const NAMES = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];
const MODELS = {
  A: { label: 'median 7, spread 0.6', mu: (r) => 7 * Math.exp(0.6 * gauss(r)) },
  B: { label: 'median 7, spread 0.9', mu: (r) => 7 * Math.exp(0.9 * gauss(r)) },
  C: { label: '80 % median 5 + 20 % median 15', mu: (r) => (r() < 0.8 ? 5 * Math.exp(0.6 * gauss(r)) : 15 * Math.exp(0.5 * gauss(r))) },
  D: { label: 'median 4, spread 0.9 + 15 % tourists', mu: (r) => (r() < 0.15 ? 0.7 * Math.exp(0.4 * gauss(r)) : 4 * Math.exp(0.9 * gauss(r))) },
};
// one player's hidden skill (x100) for a true level mu
function hiddenFor(r, mu) {
  const cv = r() < 0.5 ? 0.3 : 0.6, runs = r() < 0.7 ? 10 : 5 + Math.floor(r() * 5), d = [];
  for (let i = 0; i < runs; i++) d.push(depthOf(r, mu, cv));
  return PP.hiddenOf(d);
}
function sample(model, r, N, scale) { const out = []; for (let i = 0; i < N; i++) out.push(hiddenFor(r, model.mu(r) * (scale || 1))); return out; }
function truthOf(model, seed, scale) { return S.linesFromCuts(S.empCuts(sample(model, rng(seed), 200000, scale))); }
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };
const pct = (x) => (x == null || !isFinite(x) ? '   -  ' : ((x >= 0 ? ' ' : '') + (100 * x).toFixed(1) + '%').padStart(6));

// [1] per model, method, N: relative RMSE / bias per tier (log errors)
function bootstrap(opt) {
  const o = opt || {}, Ns = o.Ns || [50, 100, 200, 300, 500, 1000], methods = ['emp', 'full', 'upper', 'hybrid'];
  const res = {};
  let k = 0;
  for (const [mk, model] of Object.entries(MODELS)) {
    const truth = truthOf(model, 777 + (k++) * 101);
    res[mk] = { truth, byN: {} };
    for (const N of Ns) {
      const R = o.R || (N >= 1000 ? 120 : 250), r = rng(4242 + N * 7 + k * 31), acc = {};
      for (const m of methods) acc[m] = { se: [0, 0, 0, 0, 0, 0, 0], bias: [0, 0, 0, 0, 0, 0, 0], n: 0 };
      for (let i = 0; i < R; i++) {
        const h = sample(model, r, N);
        for (const m of methods) {
          const l = S.linesOf(m, h);
          if (!l) continue;
          acc[m].n++;
          for (let t = 0; t < 7; t++) { const e = Math.log(Math.max(S.SHADOW.LINE_FLOOR, l.lines[t]) / Math.max(S.SHADOW.LINE_FLOOR, truth[t])); acc[m].se[t] += e * e; acc[m].bias[t] += e; }
        }
      }
      res[mk].byN[N] = {};
      for (const m of methods) { const a = acc[m]; res[mk].byN[N][m] = { rmse: a.se.map((x) => Math.sqrt(x / Math.max(1, a.n))), bias: a.bias.map((x) => x / Math.max(1, a.n)), n: a.n }; }
    }
  }
  return res;
}
// C_K of a method: RMSE x sqrt(N) at N (median over the models A-D)
function cKOf(res, method, N) { return [0, 1, 2, 3, 4, 5, 6].map((t) => median(Object.keys(res).map((mk) => res[mk].byN[N][method].rmse[t] * Math.sqrt(N)))); }

// [2] the whole new line vs the official blend, against the truth
function wholeLine(opt) {
  const o = opt || {}, Ns = o.Ns || [20, 50, 100, 150, 200, 300, 500, 1000], V = require(path.join(__dirname, '..', 'validate.js'));
  const prior = PP.ELP.PRIOR.solo.slice(), out = {};
  let k = 0;
  for (const [mk, model] of Object.entries(MODELS)) {
    const truth = truthOf(model, 777 + (k++) * 101);
    out[mk] = { truth, byN: {} };
    for (const N of Ns) {
      const R = o.R || 200, r = rng(9191 + N * 3 + k * 17), eNew = [0, 0, 0, 0, 0, 0, 0], eOld = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < R; i++) {
        const h = sample(model, r, N);
        const nw = S.shadowLines(h, prior, null).pass, od = V.elpLinesOf(h, prior).pass;
        for (let t = 0; t < 7; t++) { eNew[t] += Math.abs(Math.log(nw[t] / truth[t])); eOld[t] += Math.abs(Math.log(od[t] / truth[t])); }
      }
      out[mk].byN[N] = { newE: eNew.map((x) => x / R), oldE: eOld.map((x) => x / R) };
    }
  }
  return out;
}

// [3] a season day by day: per alpha, the day-over-day jitter of the smoothed lines (days with N >= 20), how often a
//   published (integer) line of gold .. grandmaster moves (per 30 days, days with N >= 50), the mean error of silver ..
//   grandmaster vs the truth, and the EMA's own step response (days to cover 90 % of a jump: ln 0.1 / ln(1 - alpha))
function season(opt) {
  const o = opt || {}, days = o.days || 90, alphas = o.alphas || [1, 0.5, 0.35, 0.3, 0.25, 0.15], shiftDay = 50, shift = 1.12;
  const model = MODELS.A, prior = PP.ELP.PRIOR.solo.slice();
  const t0 = truthOf(model, 31337), t1 = truthOf(model, 31337, shift);
  const out = {};
  for (const a of alphas) {
    const r = rng(2026);
    const players = [];
    let prev = null, jit = 0, jitN = 0, err = 0, errN = 0, maxJ = 0, moves = 0, movesN = 0;
    const tierJ = [0, 0, 0, 0, 0, 0, 0];
    for (let d = 0; d < days; d++) {
      const arrive = Math.round((o.arrive || 6) + (o.grow || 0.15) * d);
      for (let i = 0; i < arrive; i++) players.push({ mu: model.mu(r), cv: r() < 0.5 ? 0.3 : 0.6, runs: [], p: 0.25 + 0.6 * r() });
      for (const pl of players) {
        if (r() > pl.p) continue;
        pl.p *= 0.985;
        pl.runs.unshift(depthOf(r, pl.mu * (d >= shiftDay ? shift : 1), pl.cv));
        if (pl.runs.length > 10) pl.runs.pop();
      }
      const h = players.filter((pl) => pl.runs.length >= 5).map((pl) => PP.hiddenOf(pl.runs));
      const sh = S.shadowLines(h, prior, prev && prev.smooth, { alpha: a });
      const truth = d >= shiftDay ? t1 : t0;
      if (prev && h.length >= 20) {
        let m = 0;
        for (let t = 0; t < 7; t++) { const j = Math.abs(sh.smooth[t] - prev.smooth[t]) / prev.smooth[t]; tierJ[t] += j; m = Math.max(m, j); }
        jit += m; jitN++; maxJ = Math.max(maxJ, m);
      }
      if (prev && h.length >= 50) { for (let t = 2; t < 7; t++) if (sh.pass[t] !== prev.pass[t]) moves++; movesN++; }
      if (h.length >= 20) { for (let t = 1; t < 7; t++) err += Math.abs(Math.log(sh.smooth[t] / truth[t])) / 6; errN++; }
      prev = sh;
      if (d === days - 1) out[a] = { N: h.length, jitter: jit / Math.max(1, jitN), maxJitter: maxJ, tierJitter: tierJ.map((x) => x / Math.max(1, jitN)), err: err / Math.max(1, errN), moves30: 30 * moves / Math.max(1, movesN), step90: a >= 1 ? 0 : Math.log(0.1) / Math.log(1 - a) };
    }
  }
  return out;
}
// [2b] the prior weight: mean |relative error| of silver .. grandmaster (published lines) over the four models, per TAU and N
function tauScan(opt) {
  const o = opt || {}, taus = o.taus || [0.2, 0.3, 0.4, 0.5, 0.7], Ns = o.Ns || [30, 50, 100, 200, 300, 500], prior = PP.ELP.PRIOR.solo.slice(), out = {};
  const truths = Object.values(MODELS).map((m, k) => [m, truthOf(m, 777 + k * 101)]);
  for (const tau of taus) {
    out[tau] = {};
    for (const N of Ns) {
      let e = 0, n = 0;
      truths.forEach(([model, truth], k) => {
        const r = rng(5150 + N * 11 + k * 7);
        for (let i = 0; i < (o.R || 120); i++) {
          const p = S.shadowLines(sample(model, r, N), prior, null, { tau }).pass;
          for (let t = 1; t < 7; t++) { e += Math.abs(Math.log(p[t] / truth[t])); n++; }
        }
      });
      out[tau][N] = e / n;
    }
  }
  return out;
}

module.exports = { MODELS, rng, depthOf, hiddenFor, sample, truthOf, bootstrap, cKOf, wholeLine, season, tauScan };

if (require.main === module) {
  const quick = process.argv.includes('--quick');
  const t0 = Date.now();
  console.log('=== O760 shadow bootstrap (log-normal fits of the hidden skill; ' + (quick ? 'quick' : 'full') + ') ===');
  const B = bootstrap(quick ? { Ns: [100, 300], R: 60 } : {});
  const Ns = Object.keys(B.A.byN).map(Number);
  console.log('\n[1] relative RMSE per tier (bronze .. grandmaster) vs the truth; bias in brackets for the top three');
  for (const mk of Object.keys(B)) {
    console.log('  model ' + mk + ' (' + MODELS[mk].label + '), truth lines ' + B[mk].truth.map((x) => x.toFixed(1)).join(' / '));
    for (const N of Ns) for (const m of ['emp', 'full', 'upper', 'hybrid']) {
      const x = B[mk].byN[N][m];
      console.log('    N ' + String(N).padStart(4) + ' ' + m.padEnd(6) + x.rmse.map(pct).join(' ') + '   [' + x.bias.slice(4).map(pct).join(' ') + ']');
    }
  }
  const nRef = Ns.includes(300) ? 300 : Ns[Ns.length - 1];
  for (const m of ['emp', 'upper', 'hybrid']) console.log('  C_K ' + m.padEnd(6) + '(RMSE x sqrt(N) at N ' + nRef + ', median of models): ' + cKOf(B, m, nRef).map((x) => x.toFixed(2)).join(', '));
  if (!quick) {
    const W = wholeLine();
    console.log('\n[2] mean |relative error| of the published line vs the truth: new (hybrid + credibility, TAU ' + S.SHADOW.TAU + ') / official blend');
    for (const mk of Object.keys(W)) {
      console.log('  model ' + mk + ' truth ' + W[mk].truth.map((x) => x.toFixed(1)).join(' / ') + ' | prior ' + PP.ELP.PRIOR.solo.join(' / '));
      for (const N of Object.keys(W[mk].byN).map(Number)) {
        const x = W[mk].byN[N];
        console.log('    N ' + String(N).padStart(4) + '  new ' + x.newE.map(pct).join(' ') + '  | old ' + x.oldE.map(pct).join(' '));
      }
    }
    const TS = tauScan();
    console.log('\n[2b] mean |relative error| of silver .. grandmaster over the four models, per TAU (the prior weight) and N');
    for (const tau of Object.keys(TS)) console.log('    TAU ' + String(tau).padEnd(4) + Object.keys(TS[tau]).map((N) => ' N ' + N + ' ' + pct(TS[tau][N])).join(' |'));
    const SE = season();
    console.log('\n[3] a 90-day season (model A, arrivals 6 + 0.15 / day, skill +12 % on day 50): per EMA alpha');
    for (const a of Object.keys(SE)) {
      const x = SE[a];
      console.log('    alpha ' + String(a).padEnd(4) + ' placed ' + x.N + ' | jitter (largest tier / day) mean ' + pct(x.jitter) + ' max ' + pct(x.maxJitter) + ' | per tier ' + x.tierJitter.map(pct).join(' ') + ' | gold..GM integer moves / 30 days ' + x.moves30.toFixed(1) + ' | error ' + pct(x.err) + ' | 90 % step ' + x.step90.toFixed(1) + ' days');
    }
  }
  console.log('\n(' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}
