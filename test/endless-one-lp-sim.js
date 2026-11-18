'use strict';
// O825 (ELP v4) one endless points value over the four families: a simulation of PLAYER OUTCOMES over the pure rules
// (points-plan.js), fixed random seed, a few seconds. test/endless-lp.js pins each rule; this file asks what the rules do to players
// who mix party sizes -- the checks the plan (companion repo KNIFE_O825_ENDLESS_ONE_LP_PLAN section 9, T1-T6) was decided on.
//   The player model is the one of test/endless-lp-sim.js: a player has a true level tau (0 = the bronze line .. 6 = the
//   grandmaster line, fractions allowed); his mean depth in a family is that family's pass-line table read at tau; a run's depth
//   is lognormal around it (coefficient of variation 0.3 / 0.6). The lines the rules use are the priors (trio / quad = the duo
//   lines until the season has data). A run costs OVERHEAD_S + depth x PER_LEVEL_S seconds (a team run is longer: its lines are
//   deeper). One points value, one placement (the first MIN_RUNS runs of any family, seeded on the solo scale by the rules' seed
//   reading -- version 6: three runs, the lowest left out), as the job settles.
//   [T1] a player who mixes the four families passes about half his runs IN EVERY FAMILY (0.42..0.58), at every level.
//        Mutation: one hidden skill over all the runs (not a family's own) -> red (the solo runs miss, the team runs pass)
//   [T2] a new party size is no free points: the first five runs of a family the player never played gain no more (+60) than the
//        same five runs by the same player already at home in that family (five own runs of it in his history: the borrowed
//        skill reads like the own one). Mutation: no borrowed runs (the family starts from the silver line) -> red (+300 and more).
//        Beside it (printed): the same five runs played solo. Five TEAM runs gain more than five solo runs by the team length
//        factor itself (about +90 at platinum / diamond: a team run is about 1.6 times as long) -- that difference is the rule
//        of [T3], not a gift of the switch; the plan's first wording ("no more than solo + 60") was measured before that factor.
//   [T3] a team run is longer, the team length factor pays for it: from the placement to diamond, the HOURS of a duo-only and a
//        quad-only player over those of a solo-only one stay in 0.9..1.25 for a silver / gold / platinum-level player and under
//        1.5 for a diamond-level one. Mutations: TEAM_GAIN 1000 -> red; the factor on both pass and miss -> red at platinum
//   [T4] the team gate: of the players between diamond and master (tau 4.5), the share that ever reaches master in 300 runs
//        playing duo only is at most the solo-only share + 15 points. Mutation: TEAM_GATE 100 -> red
//   [T5] carried: a gold-level friend of a master-level player (duo), or of three (quad), does not reach master in 300 runs --
//        nobody of 20 by the mean reading of the team's depth, nobody of 20 pairs when the strong seat leads; of 20 quads led by
//        three masters at most a quarter (measured 4: such a team plays within a tenth of a master team's depth, the gate cannot
//        tell them apart; the plan's 0-2 was measured without the team length factor). Mutation: no gate -> red (20 of 20)
//   [T6] a one-family player is where version 3 left him: a solo-only player through the new calls (elpHiddenFor, the family
//        named) walks the same points, run for run, as through the version 3 calls (hiddenOf, no family). Mutation: a call that
//        names solo read as a team run -> red. (test/endless-lp-sim.js keeps its own assertions; the frozen cases are in
//        test/endless-lp.js [11].)
//   [top] the zero-sum top by the reading of endless-lp-sim.js [5] (its 20 grandmaster-level players, its seeds, from 8600, 300
//        runs): solo only walks to the very same points through the new calls (the mean change of [5], within +-200); duo only
//        and mixed are printed and guarded at +-450 (the mean of 20 such walks between the floor 8000 and the top 9999 has a
//        sampling spread of about 150: a guard, not a tuning target).
// Version 6 (three placement runs, 2026-11-18): [T3], [T5] and [top] are read over GROUPS random sequences and beside the five-run
//   rule (FIVE: MIN_RUNS 5, the trimmed mean at the seed) on the same sequences. Their old lines judged ONE sequence, and each sat
//   on that sequence's tail under the five-run rule itself -- over ten sequences: the hours ratio of a cell reads 0.90..1.27
//   (five runs) / 0.84..1.43 (three) around the same means (within 0.06, diamond 0.10); the carried quads 2..7 of 20 (five) /
//   1..7 (three), 49 and 41 of 200; the solo top -302..-10 (five) / -302..-188 (three), means -209 / -223. What version 6
//   does move: a solo player's runs from the placement to diamond, 140 / 87 / 43 / 18 -> 125 / 70 / 43 / 25 (silver / gold /
//   platinum / diamond level): below the cap the seed no longer loses to one weak run; from the platinum level up the seed cap
//   2800 (the top of gold: platinum is won in a promotion run, the user's call) costs about five runs -- test/endless-lp-sim.js
//   [2] holds the user's table for it (the diamond level at 25 of 20 +-30 %).
// Required (not run) it exports the simulation, for the re-tuning the plan schedules once the season has real data.
const path = require('path');
const fs = require('fs');
const PP0 = require(path.join(__dirname, '..', 'points-plan.js'));
const E = PP0.ELP, FAMS = PP0.ELP_FAMS, LINES = E.PRIOR;
const DIAMOND = PP0.LP_SEG[4].min, MASTER = PP0.LP_SEG[5].min;
const PER_LEVEL_S = 105, OVERHEAD_S = 120;   // a level: 75 s + shop / wager / transitions; a run: character pick + dial + results

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function depthOf(r, mu, cv) { const s = Math.sqrt(Math.log(1 + cv * cv)); return Math.max(0, Math.round(mu * Math.exp(s * gauss(r) - s * s / 2))); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };
// the mean depth of a player of true level tau in a family whose lines are `line`
function muOf(tau, line) { const n = line.length; if (tau <= 0) return line[0] * Math.max(0.3, 1 + tau); if (tau >= n - 1) return line[n - 1] + (tau - (n - 1)) * (line[n - 1] - line[n - 2]); const k = Math.floor(tau); return line[k] + (tau - k) * (line[k + 1] - line[k]); }
function loadVariant(pairs) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  for (const [a, b] of pairs) { if (s.indexOf(a) < 0) throw new Error('mutation anchor missing: ' + a.slice(0, 80)); s = s.split(a).join(b); }
  const win = {}; new Function('window', s)(win); return win.POINTS_PLAN;
}

// one player: the placement (MIN_RUNS runs, the family of each by pick) then n runs. opt = { M (rules), tau, cv, seed, n, pick(i, r),
//   startLp (points set by hand), v3 (the version 3 calls: hiddenOf of the solo runs, no family named -- solo-only players),
//   mu (fam -> his mean depth, instead of the lines read at tau), pre ([[fam, depth], ..] older runs already in his history) }
function play(opt) {
  const M = opt.M || PP0, r = rng(opt.seed), runs = (opt.pre || []).slice(), muF = opt.mu || ((fam) => muOf(opt.tau, LINES[fam]));
  for (let i = 0; i < M.ELP.MIN_RUNS; i++) { const fam = opt.pick(i - M.ELP.MIN_RUNS, r); runs.unshift([fam, depthOf(r, muF(fam), opt.cv)]); }
  // the seed: the rules' seed reading (version 6 elpSeedHidden; a variant without it: the trimmed skill on the solo scale). The v3 calls name no family: a solo-only player's runs read as they are
  const seedH = typeof M.elpSeedHidden === 'function' ? M.elpSeedHidden(opt.v3 ? runs.map((x) => ['solo', x[1]]) : runs, LINES) : (opt.v3 ? M.hiddenOf(runs.map((x) => x[1])) : M.elpHiddenFor('solo', runs, LINES));
  let lp = opt.startLp != null ? opt.startLp : M.endlessSeedLp(seedH, LINES.solo);
  const out = { lp0: lp, pass: { solo: [], duo: [], trio: [], quad: [] }, toD: null, toDSec: null, maxLp: lp, sec: 0, first5: [], trail: [] };
  const seen = {}; for (const x of runs) seen[x[0]] = (seen[x[0]] || 0) + 1;
  for (let i = 0; i < opt.n; i++) {
    const fam = opt.pick(i, r), seedRun = (r() * 4294967296) >>> 0;
    const H = opt.v3 ? M.hiddenOf(runs.map((x) => x[1])) : M.elpHiddenFor(fam, runs, LINES);
    const d = depthOf(r, muF(fam), opt.cv);
    const T = M.targetOf(lp, LINES[fam], seedRun, H, false), pass = d >= T;
    const s = opt.v3 ? M.endlessSettle(lp, pass, H, LINES[fam], M.targetOffset(seedRun)) : M.endlessSettle(lp, pass, H, LINES[fam], M.targetOffset(seedRun), fam);
    out.pass[fam].push(pass ? 1 : 0);
    if ((seen[fam] || 0) < M.ELP.MIN_RUNS) out.first5.push(s.nv - lp);   // a run of a family he has not five runs of yet
    seen[fam] = (seen[fam] || 0) + 1;
    lp = s.nv; out.sec += OVERHEAD_S + d * PER_LEVEL_S; out.trail.push(lp);
    runs.unshift([fam, d]); if (runs.length > 60) runs.pop();
    if (lp > out.maxLp) out.maxLp = lp;
    if (out.toD == null && lp >= DIAMOND) { out.toD = i + 1; out.toDSec = out.sec; }
  }
  out.lp = lp;
  return out;
}
const only = (fam) => () => fam;
const MIX_W = [['solo', 0.4], ['duo', 0.3], ['trio', 0.15], ['quad', 0.15]];
const mixed = (i, r) => { let u = r(); for (const [f, w] of MIX_W) { if (u < w) return f; u -= w; } return 'quad'; };
const switcher = (at, a, b) => (i) => (i < at ? a : b);
const CVS = [0.3, 0.6], LEVELS = [['silver', 1], ['gold', 2], ['platinum', 3], ['diamond', 4]];

// [T1] the pass rate of a mixed player in each family, per level
function mixedRates(M) {
  const out = {};
  for (const [name, tau] of LEVELS.concat([['master', 5]])) {
    const by = { solo: [], duo: [], trio: [], quad: [] };
    for (const cv of CVS) for (let j = 0; j < 10; j++) { const p = play({ M, tau, cv, n: 600, seed: 410000 + Math.round(tau * 1000) + j * 131 + (cv > 0.5 ? 7 : 0), pick: mixed }); for (const f of FAMS) by[f].push(...p.pass[f]); }
    out[name] = FAMS.map((f) => mean(by[f]));
  }
  return out;
}
const ratesOk = (rt) => Object.values(rt).every((row) => row.every((x) => x >= 0.42 && x <= 0.58));
// [T2] a solo player near his level plays 40 solo runs, then five runs of a family he never played: what those five gave (first5)
//   beside the same five runs (the same seed, the same depths) by the same player with five older runs of that family in his
//   history (home: his own skill of the family, nothing borrowed), and beside the same five played solo (solo)
function switchGain(M) {
  const out = [];
  for (const [name, tau, lp0] of [['platinum', 3, 3500], ['diamond', 4, 4800], ['master', 5, 6500]]) for (const fam of ['duo', 'quad']) {
    const sw = [], home = [], solo = [];
    for (let j = 0; j < 40; j++) {
      const seed = 300000 + Math.round(tau * 1000) + j * 17, o = { M, tau, cv: 0.3, seed, startLp: lp0 };
      const r2 = rng(seed ^ 0x5bd1e995), pre = []; for (let k = 0; k < M.ELP.MIN_RUNS; k++) pre.push([fam, depthOf(r2, muOf(tau, LINES[fam]), 0.3)]);
      const a = play(Object.assign({ n: 45, pick: switcher(40, 'solo', fam) }, o)), h = play(Object.assign({ n: 45, pick: switcher(40, 'solo', fam), pre }, o));
      const b = play(Object.assign({ n: 45, pick: only('solo') }, o)), c = play(Object.assign({ n: 40, pick: only('solo') }, o));
      sw.push(a.lp - a.trail[39]); home.push(h.lp - h.trail[39]); solo.push(b.lp - c.lp);
    }
    out.push({ name, fam, first5: mean(sw), home: mean(home), solo: mean(solo) });
  }
  return out;
}
const switchOk = (g) => g.every((x) => x.first5 <= x.home + 60);
// [T3] hours from the placement to diamond: duo-only and quad-only over solo-only, per level
function hoursRatio(M, shift) {
  const out = {}, sh = (shift | 0) * 1000003;   // shift: another random sequence (0 = the one the figures were tuned on)
  for (const [name, tau] of LEVELS) {
    const cell = {};
    for (const fam of ['solo', 'duo', 'quad']) {
      const hrs = [], runs = [];
      for (const cv of CVS) for (let j = 0; j < 20; j++) {
        const p = play({ M, tau, cv, n: 600, seed: 10000 + sh + (fam === 'solo' ? 0 : fam === 'duo' ? 100000 : 300000) + Math.round(tau * 1000) + j * 131 + (cv > 0.5 ? 7 : 0), pick: only(fam) });
        hrs.push(p.toDSec == null ? 9e9 : p.toDSec / 3600); runs.push(p.toD == null ? 9999 : p.toD);
      }
      cell[fam] = { h: median(hrs), r: median(runs) };
    }
    out[name] = { soloRuns: cell.solo.r, duoRuns: cell.duo.r, quadRuns: cell.quad.r, duo: cell.duo.h / cell.solo.h, quad: cell.quad.h / cell.solo.h };
  }
  return out;
}
const hoursOk = (h) => ['silver', 'gold', 'platinum'].every((n) => [h[n].duo, h[n].quad].every((x) => x >= 0.9 && x <= 1.25)) && [h.diamond.duo, h.diamond.quad].every((x) => x <= 1.5);
// [T4] of 40 players of level tau playing one family only: how many ever reach master in 300 runs / end there
function masterShare(M, tau, fam) {
  let ever = 0, end = 0;
  for (let j = 0; j < 40; j++) { const p = play({ M, tau, cv: j % 2 ? 0.6 : 0.3, n: 300, seed: 700000 + Math.round(tau * 1000) + j * 37 + (fam === 'solo' ? 0 : 5000), pick: only(fam) }); if (p.maxLp >= MASTER) ever++; if (p.lp >= MASTER) end++; }
  return { ever, end, n: 40 };
}
const gateOk = (M) => { const s = masterShare(M, 4.5, 'solo'), d = masterShare(M, 4.5, 'duo'); return (d.ever - s.ever) / s.n <= 0.15; };
// [T5] carried: a weak seat B always plays with strong seats A (duo: A + B; quad: three A + B). Each seat starts from a window of ten
//   runs at his own level; from then on his window holds the team's runs. The team's depth is lognormal around a weighted mean of
//   the two levels: wStrong 0.5 = the mean of the seats (the reading of endless-lp-sim.js [9]), 0.7 = the strong seats lead.
//   Returns the highest points B held.
function carried(M, tauA, tauB, fam, wStrong, seed, n) {
  const r = rng(seed), size = fam === 'duo' ? 2 : fam === 'trio' ? 3 : 4, cv = 0.3, L = LINES[fam];
  const muA = muOf(tauA, L), muB = muOf(tauB, L), wA = [], wB = [], soloB = [];
  for (let i = 0; i < E.WINDOW; i++) { wA.push(depthOf(r, muA, cv)); wB.push(depthOf(r, muB, cv)); }
  for (let i = 0; i < M.ELP.MIN_RUNS; i++) soloB.push(depthOf(r, muOf(tauB, LINES.solo), cv));
  const seedB = typeof M.elpSeedHidden === 'function' ? M.elpSeedHidden(soloB.map((d) => ['solo', d]), LINES) : M.hiddenOf(soloB);
  let lpA = M.endlessSeedLp(M.hiddenOf(wA), L), lpB = M.endlessSeedLp(seedB, LINES.solo), maxB = lpB;
  const ws = (size - 1) * wStrong / ((size - 1) * wStrong + (1 - wStrong)), muT = ws * muA + (1 - ws) * muB;
  for (let i = 0; i < n; i++) {
    const seedRun = (r() * 4294967296) >>> 0, hA = M.hiddenOf(wA), hB = M.hiddenOf(wB), list = [hB];
    for (let k = 1; k < size; k++) list.push(hA);
    const T = M.targetOf(0, L, seedRun, M.teamHiddenOf(list), false), d = depthOf(r, muT, cv), pass = d >= T, off = M.targetOffset(seedRun);
    lpA = M.endlessSettle(lpA, pass, hA, L, off, fam).nv; lpB = M.endlessSettle(lpB, pass, hB, L, off, fam).nv;
    if (lpB > maxB) maxB = lpB;
    wA.unshift(d); wA.pop(); wB.unshift(d); wB.pop();
  }
  return maxB;
}
function carriedCounts(M, shift) {
  const out = [], sh = (shift | 0) * 1000003;
  for (const [name, tauA, tauB, fam] of [['a master with a gold friend (duo)', 5, 2, 'duo'], ['three masters with a gold friend (quad)', 5, 2, 'quad']]) for (const w of [0.5, 0.7]) {
    let inM = 0;
    for (let j = 0; j < 20; j++) if (carried(M, tauA, tauB, fam, w, 400000 + sh + tauA * 1000 + tauB * 100 + j * 13 + (w > 0.6 ? 5 : 0) + (fam === 'quad' ? 50000 : 0), 300) >= MASTER) inM++;
    out.push({ name, fam, w, inM, n: 20 });
  }
  return out;
}
// the gold friend stays out of master: nobody of 20 with a master friend (duo, both readings) or with three by the mean reading;
//   at most a quarter of 20 quads when the three masters lead (measured 4)
const carriedOk = (c) => c.every((x) => x.inM <= (x.fam === 'quad' && x.w > 0.6 ? 5 : 0));
// [T6] a solo-only player: the new calls against the version 3 calls, run for run
function soloSame(M) {
  let n = 0;
  for (const tau of [0.5, 1, 2, 3, 4, 5, 6.5]) for (const cv of CVS) for (let j = 0; j < 3; j++) {
    const o = { M, tau, cv, n: 300, seed: 610000 + Math.round(tau * 1000) + j * 131 + (cv > 0.5 ? 7 : 0), pick: only('solo') };
    const a = play(o), b = play(Object.assign({ v3: true }, o));
    if (a.lp0 !== b.lp0 || JSON.stringify(a.trail) !== JSON.stringify(b.trail)) return { same: false, n };
    n += a.trail.length;
  }
  return { same: true, n };
}
// [top] the grandmaster-level players of endless-lp-sim.js [5] (solo mean depth 50, its seeds) from 8600 over 300 runs; in a team
//   family the same level read on that family's scale
const GM_MU = 50, gmMu = (fam) => (fam === 'solo' ? GM_MU : PP0.elpConvert(GM_MU * 100, LINES.solo, LINES[fam]) / 100);
function topDrift(M, shift) {
  const out = {}, sh = (shift | 0) * 1000003;
  for (const [name, pick] of [['solo', only('solo')], ['duo', only('duo')], ['mixed', mixed]]) {
    const xs = []; for (const cv of CVS) for (let j = 0; j < 10; j++) xs.push(play({ M, mu: gmMu, cv, seed: 90000 + sh + j * 31 + (cv > 0.5 ? 3 : 0), n: 300, startLp: 8600, pick }).lp - 8600);
    out[name] = { mean: mean(xs), min: Math.min.apply(null, xs), max: Math.max.apply(null, xs), xs };
  }
  return out;
}
// the three checks over GROUPS random sequences
const GROUPS = 6;
function hoursMean(M) {   // per level: the mean over the sequences of the duo / quad hours ratio, and the solo runs to diamond
  const hs = []; for (let g = 0; g < GROUPS; g++) hs.push(hoursRatio(M, g));
  const out = {};
  for (const [n] of LEVELS) out[n] = { duo: mean(hs.map((h) => h[n].duo)), quad: mean(hs.map((h) => h[n].quad)), soloRuns: Math.round(mean(hs.map((h) => h[n].soloRuns))) };
  return out;
}
function carriedTotals(M) {   // per case: the teams of 20 x GROUPS whose gold friend reached master
  const cs = []; for (let g = 0; g < GROUPS; g++) cs.push(carriedCounts(M, g));
  return cs[0].map((x, i) => ({ name: x.name, fam: x.fam, w: x.w, inM: cs.reduce((a, c) => a + c[i].inM, 0), n: 20 * GROUPS }));
}
// nobody by the mean reading or in a pair; of the quads led by three masters at most three in ten
const carriedTotOk = (c) => c.every((x) => x.inM <= (x.fam === 'quad' ? (x.w > 0.6 ? 0.3 * x.n : 0.03 * x.n) : 0));
function topMeans(M) { const ts = []; for (let g = 0; g < GROUPS; g++) ts.push(topDrift(M, g)); const out = {}; for (const k of ['solo', 'duo', 'mixed']) out[k] = mean([].concat(...ts.map((t) => t[k].xs))); return out; }
module.exports = { play, muOf, mixedRates, switchGain, hoursRatio, hoursMean, masterShare, carried, carriedCounts, carriedTotals, soloSame, topDrift, topMeans, loadVariant, only, mixed, switcher, LEVELS, PER_LEVEL_S, OVERHEAD_S, GROUPS };

if (require.main === module) {
  let failN = 0;
  const ok = (m) => console.log('  ok    ' + m);
  const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
  const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
  const f2 = (x) => x.toFixed(2), sg = (x) => (x >= 0 ? '+' : '') + x.toFixed(0);
  console.log('=== O825 one endless points value: player outcomes (ELP v' + E.VER + ', TEAM_GAIN ' + E.TEAM_GAIN + ', TEAM_GATE ' + E.TEAM_GATE + '; lines solo ' + JSON.stringify(LINES.solo) + ' / team ' + JSON.stringify(LINES.duo) + '; a level ' + PER_LEVEL_S + ' s + ' + OVERHEAD_S + ' s a run) ===');
  // [T1]
  const rt = mixedRates(PP0);
  T('[T1] a player mixing the families (' + MIX_W.map(([f, w]) => f + ' ' + w).join(', ') + ') passes about half his runs in EVERY family (0.42..0.58; solo / duo / trio / quad): ' + Object.keys(rt).map((k) => k + ' ' + rt[k].map(f2).join(' ')).join(' | '), ratesOk(rt));
  const oneSkill = loadVariant([['for (const r of list) { if (r && r[0] === fam) { own.push(Math.max(0, r[1] | 0)); if (own.length >= ELP.WINDOW) break; } }', 'for (const r of list) { if (r) { own.push(Math.max(0, r[1] | 0)); if (own.length >= ELP.WINDOW) break; } }']]);
  const rt1 = mixedRates(oneSkill);
  T('[T1] mutation "one hidden skill over all his runs (not a family\'s own)" turns it red: the solo runs miss, the team runs pass (gold ' + rt1.gold.map(f2).join(' ') + ')', !ratesOk(rt1) && rt1.gold[0] < 0.42 && rt1.gold[1] > 0.58);
  // [T2]
  const sw = switchGain(PP0);
  T('[T2] a new party size is no free points: the first five runs of a family never played vs the same five by the same player at home in it (mean of 40 players, +60 allowed; third number: the same five played solo): ' + sw.map((x) => x.name + ' ' + x.fam + ' ' + sg(x.first5) + ' / ' + sg(x.home) + ' / ' + sg(x.solo)).join(' | '), switchOk(sw));
  const noBorrow = loadVariant([['if (elpLinesOk(to)) {', 'if (false) {']]);
  const sw0 = switchGain(noBorrow);
  T('[T2] mutation "no borrowed runs" (the new family starts from the silver line) turns it red: ' + sw0.map((x) => x.name + ' ' + x.fam + ' ' + sg(x.first5)).join(' | '), !switchOk(sw0) && sw0.every((x) => x.first5 >= x.home + 150));
  // [T3]
  const FIVE = loadVariant([['MIN_RUNS: 3, TRIM: 1,', 'MIN_RUNS: 5, TRIM: 1,'], ['elpConvert, elpHiddenFor, elpSeedHidden, tierOfHidden,', 'elpConvert, elpHiddenFor, tierOfHidden,']]);   // the five-run rule (version 5) beside it
  const hr = hoursMean(PP0), hr5 = hoursMean(FIVE);
  const hline = (h) => LEVELS.map(([n]) => n + ' x' + f2(h[n].duo) + ' x' + f2(h[n].quad) + ' (solo runs ' + h[n].soloRuns + ')').join(' | ');
  T('[T3] hours from the placement to diamond, duo-only / quad-only over solo-only, the mean of ' + GROUPS + ' random sequences (0.9..1.25; diamond level <= 1.5): ' + hline(hr), hoursOk(hr));
  T('[T3] ... under five placement runs the same sequences give ' + hline(hr5) + ' -- the placement count leaves the ratios where they were (each within 0.15)', hoursOk(hr5) && LEVELS.every(([n]) => Math.abs(hr[n].duo - hr5[n].duo) <= 0.15 && Math.abs(hr[n].quad - hr5[n].quad) <= 0.15));
  const hr0 = hoursMean(loadVariant([['TEAM_GAIN: 1300', 'TEAM_GAIN: 1000']]));
  T('[T3] mutation "TEAM_GAIN 1000" (no length factor) turns it red: a team player needs ' + LEVELS.map(([n]) => 'x' + f2(hr0[n].duo)).join(' ') + ' the hours', !hoursOk(hr0) && hr0.gold.duo > 1.25);
  const hr2 = hoursMean(loadVariant([['const mul = team ? Math.round(isPass ? ELP.MUL[cur] * ELP.TEAM_GAIN / 1000 : ELP.MUL[cur] * 1000 / ELP.TEAM_GAIN) : ELP.MUL[cur];', 'const mul = team ? Math.round(ELP.MUL[cur] * ELP.TEAM_GAIN / 1000) : ELP.MUL[cur];']]));
  T('[T3] mutation "the factor on both pass and miss" turns platinum red (the gain is capped, the loss is not): platinum x' + f2(hr2.platinum.duo) + ' x' + f2(hr2.platinum.quad), !hoursOk(hr2) && Math.max(hr2.platinum.duo, hr2.platinum.quad) > 1.25);
  // [T4]
  const gs = masterShare(PP0, 4.5, 'solo'), gd = masterShare(PP0, 4.5, 'duo');
  T('[T4] the team gate: of 40 players between diamond and master (tau 4.5), ever at master in 300 runs: solo only ' + gs.ever + ' (ending there ' + gs.end + '), duo only ' + gd.ever + ' (' + gd.end + ') -- at most the solo share + 15 points', gateOk(PP0));
  const g100 = loadVariant([['TEAM_GATE: 110', 'TEAM_GATE: 100']]), gd100 = masterShare(g100, 4.5, 'duo');
  T('[T4] mutation "TEAM_GATE 100" (the solo gate for teams) turns it red: duo only ' + gd100.ever + ' of 40 (the team diamond and master lines sit close together)', !gateOk(g100));
  console.log('  [T4] (printed) ever / ending at master of 40, solo only | duo only: ' + [4.8, 5, 5.2, 5.5, 6].map((tau) => { const a = masterShare(PP0, tau, 'solo'), b = masterShare(PP0, tau, 'duo'); return 'tau ' + tau + ' ' + a.ever + '/' + a.end + ' | ' + b.ever + '/' + b.end; }).join(' ; '));
  // [T5]
  const cc = carriedTotals(PP0), cc5 = carriedTotals(FIVE);
  T('[T5] carried: a gold-level friend does not reach master in 300 runs, of ' + cc[0].n + ' pairs / quads over ' + GROUPS + ' random sequences (a pair: nobody; a quad by the mean reading w 0.5: at most 3 %; the three masters lead w 0.7: at most 30 %): ' + cc.map((x) => x.name + ' w ' + x.w + ': ' + x.inM).join(' | '), carriedTotOk(cc));
  T('[T5] ... under five placement runs the same sequences give ' + cc5.map((x) => x.inM).join(' / ') + ' -- the placement count does not carry anybody further (at most 5 points more in any case)', carriedTotOk(cc5) && cc.every((x, i) => x.inM <= cc5[i].inM + 0.05 * x.n));
  const noGate = loadVariant([['if (cur < line && nv > Math.max(cur, cap))', 'if (false)']]), cc0 = carriedTotals(noGate);
  T('[T5] mutation "no gate" turns it red: ' + cc0.map((x) => x.inM + ' of ' + x.n).join(' | '), !carriedTotOk(cc0) && cc0.some((x) => x.inM >= 0.5 * x.n));
  // [T6]
  const ss = soloSame(PP0);
  T('[T6] a solo-only player walks the same points run for run through the new calls (elpHiddenFor, the family named) and the version 3 calls (' + ss.n + ' runs of 42 players)', ss.same && ss.n === 42 * 300);
  const soloTeam = loadVariant([["function elpIsTeam(fam) { return fam === 'duo' || fam === 'trio' || fam === 'quad'; }", "function elpIsTeam(fam) { return fam === 'solo' || fam === 'duo' || fam === 'trio' || fam === 'quad'; }"]]);
  T('[T6] mutation "a run named solo read as a team run" turns it red', !soloSame(soloTeam).same);
  // [top]
  const td = topDrift(PP0), tm = topMeans(PP0), tm5 = topMeans(FIVE);
  const SIM5 = require(path.join(__dirname, 'endless-lp-sim.js')), gm5 = mean(SIM5.simulate(PP0).gm);
  T('[top] the top (the grandmaster-level players of endless-lp-sim.js [5], from 8600, 300 runs): on its first sequence solo only walks to the very same points through the new calls (' + sg(td.solo.mean) + ' = the figure of [5] ' + sg(gm5) + '); over ' + GROUPS + ' random sequences solo only ' + sg(tm.solo) + ', duo only ' + sg(tm.duo) + ', mixed ' + sg(tm.mixed) + ' (guard +-350 / +-450 / +-450)',
    Math.round(td.solo.mean) === Math.round(gm5) && Math.abs(tm.solo) <= 350 && Math.abs(tm.duo) <= 450 && Math.abs(tm.mixed) <= 450);
  T('[top] ... under five placement runs the same sequences give ' + sg(tm5.solo) + ' / ' + sg(tm5.duo) + ' / ' + sg(tm5.mixed) + ' -- the slow drift down at the top is not this version\'s (each within 60)', ['solo', 'duo', 'mixed'].every((k) => Math.abs(tm[k] - tm5[k]) <= 60));
  console.log(failN ? ('endless-one-lp-sim: ' + failN + ' FAIL') : 'endless-one-lp-sim: all ok');
  process.exit(failN ? 1 : 0);
}
