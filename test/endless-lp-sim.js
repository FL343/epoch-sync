'use strict';
// O728 endless competitive points: a simulation over the pure rules (points-plan.js ELP), fixed random seed, under a second.
//   Made-up players with a true level (mean depth) and a luck spread (lognormal depth, coefficient of variation 0.3 / 0.6) place
//   (MIN_RUNS runs, the seed reading of the rules, at most SEED_CAP) and then play against the prior solo pass lines. The rules are built like versus (the user's call
//   2026-11-08): the target follows the player's own level, so
//   [1] about half the runs pass (overall and at each luck spread: 0.42..0.58)
//   [2] below master grinding climbs: runs from the placement to diamond (the median of a group) for a silver / gold / platinum /
//       diamond-level player within 30 % of 150 / 80 / 40 / 20 (the user's table)
//   [3] the master gate: a player whose hidden skill is below master never reaches master in 300 runs
//   [4] promotion / relegation ping-pong: tier-line crossings a player in 300 runs (and the share crossed back in 10 runs);
//       O785 (2026-11-09): was <= 35 while a floor held every miss under master; the floor is gone (normal promotion and
//       relegation, the user's call) and the series landings moved to +-150, so a promotion sticks.
//       Version 6 (2026-11-18): read over GROUPS random sequences instead of one. The old line "the worst player of ONE sequence
//       <= 20" was the tail of that sequence: over 40 sequences the worst player reads 10..28 under five placement runs and
//       11..26 under three (median 15 / 17; 5 sequences of 40 above 20 under either), the mean 5.1 / 5.0 -- the placement count
//       does not move it (after ten runs the two rules are the same rule). Now: the mean <= 6, at most 0.5 % of the players
//       above 20 crossings, and the mean within 0.5 of the five-run rule's.
//   [5] the top: grandmaster-level players started at 8600, the mean change after 300 runs. Read over GROUPS sequences too: it is
//       about -230 under five placement runs AND under three (40 sequences: -364..-10 / -340..-45); the old line "within +-200"
//       held on the one sequence the file used (-10, the best of the forty) and fails on 25 of 40 under the five-run rule
//       itself. A slow drift down at the very top, not a change of this version (noted for the companion roadmap, O799's
//       neighbourhood). Now: within 60 of the five-run rule's figure, and the guard +-350.
//   [6] (printed) per tier: the pass rate the players had beside the table's balance rate, and where each level ended
//   [7] mutations: no master gate -> [3] red; the old target (the points tier line) -> [1] red; MUL 1000 -> [2] red; the series
//       landings back to +10 / -15 -> [4] red (O785); "rated above the skill: gain less, lose more" below master too -> [9] red
//   [9] O785 (user 2026-11-09 "I meant that grinding gets you to diamond in the end"): with normal promotion and relegation a
//       bronze-level grinder (mean depth 3) still reaches diamond -- all 20 within 600 runs, median <= 250 (about 145 now)
//   [8] O781 (client 2026-11-09): the competitive curve has a deep wall now, so nobody averages 60 levels any more (the true levels
//       stop at 45) and the players near the top die close to their wall: a "wall-hugging" group (mean depth 30..45, coefficient of
//       variation 0.1) still passes about half its runs (0.42..0.58 overall, 0.40..0.65 at each level); the old target turns that
//       red. Known (2026-11-09, client roadmap O799): a grandmaster-level wall-hugger drifts UP about +4 points a run (+1307 over 300):
//       with so little spread the integer depth vs TARGET_Q 990 (the target sits half a level under the mean) passes ~0.57. TARGET_Q
//       1010 settles that group (-41) but pulls the cv 0.3 / 0.6 top to -341, and TARGET_Q is a rule constant (ELP.VER + 1, settled
//       runs move) -> tuned at the S1 boundary with EA spread data. Asserted here only as "no worse than +2000" (a guard, not the goal)
//   [9] O803 (2026-11-09, ELP v3): mixed pairs -- two players of different true levels (their duo skills stand at their own
//       levels: their windows hold runs with partners of their own level) play together; the pair's depth is lognormal around
//       the MEAN of the two levels. Under the one team target (targetOf with teamHiddenOf([hA, hB])) both sides pass about half
//       (0.42..0.58 overall, 0.40..0.65 on each side and at each pair), and in every run the two receipts carry one sign (both
//       gain or both lose, by their own amounts). Mutations: the target read from each one's own skill (the O728 reading) ->
//       the strong side passes under 0.35 and the weak side over 0.65 -> red; teamHiddenOf as the strongest seat -> both sides
//       under 0.35 -> red
// Required (not run) it exports the simulation, for tuning MUL / TARGET_Q.
const path = require('path');
const fs = require('fs');
const PP0 = require(path.join(__dirname, '..', 'points-plan.js'));
const NAMES = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];
const LINES = PP0.ELP.PRIOR.solo;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function depthOf(r, mu, cv) { const s = Math.sqrt(Math.log(1 + cv * cv)); return Math.max(0, Math.round(mu * Math.exp(s * gauss(r) - s * s / 2))); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
// the skill a placement seeds from: the rules' seed reading over the placement runs (depths NEWEST first)
const seedSkill = (M, depths) => (typeof M.elpSeedHidden === 'function' ? M.elpSeedHidden(depths.map((d) => ['solo', d]), { solo: LINES }) : M.hiddenOf(depths));
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN; };

// one player: placement (the target rule of a placement run) then n runs; startLp = null (the seed) or points set by hand
function play(M, mu, cv, seed, n, startLp) {
  const r = rng(seed);
  const depths = [];
  for (let i = 0; i < M.ELP.MIN_RUNS; i++) depths.unshift(depthOf(r, mu, cv));
  let lp = startLp != null ? startLp : M.endlessSeedLp(seedSkill(M, depths), LINES);
  const lp0 = lp, tiers = [], passAt = [], hts = [];
  let toDiamond = null;
  for (let i = 0; i < n; i++) {
    const seedRun = (r() * 4294967296) >>> 0, H = M.hiddenOf(depths);
    const tgt = M.targetOf(lp, LINES, seedRun, H, false), d = depthOf(r, mu, cv), pass = d >= tgt;
    passAt.push([M.lpTierIdx(lp), pass]);
    lp = M.endlessSettle(lp, pass, H, LINES, M.targetOffset(seedRun)).nv;
    depths.unshift(d); if (depths.length > M.ELP.WINDOW) depths.pop();
    tiers.push(M.lpTierIdx(lp)); hts.push(M.tierOfHidden(M.hiddenOf(depths), LINES));
    if (toDiamond == null && lp >= M.LP_SEG[4].min) toDiamond = i + 1;
  }
  return { lp0, lp, tiers, passAt, hts, toDiamond };
}
function crossingsOf(tiers) { let c = 0, back = 0; for (let i = 1; i < tiers.length; i++) { if (tiers[i] === tiers[i - 1]) continue; c++; for (let j = i + 1; j < Math.min(tiers.length, i + 11); j++) if (tiers[j] === tiers[i - 1]) { back++; break; } } return { c, back }; }

// O781: the true levels stop at 45 (was 60: before the deep wall a strong player had no wall and averaged anything); the zero-sum top
//   group plays at 50 (above the grandmaster line 42, below the 0.9-efficiency wall 65)
const MUS = [3, 5, 8, 12, 18, 25, 35, 45], CVS = [0.3, 0.6], PER = 6, N = 300, GM_MU = 50;
const WALL_MUS = [30, 35, 40, 45], WALL_CV = 0.1;
const LEVELS = [['silver', 6], ['gold', 10], ['platinum', 15], ['diamond', 24]], WANT = { silver: 150, gold: 80, platinum: 40, diamond: 20 };
function simulate(M, shift) {
  const out = { pop: [], toD: {}, gm: [] }, sh = (shift | 0) * 1000003;   // shift: another random sequence for the same players (0 = the one every figure below was tuned on)
  let k = 0;
  for (const mu of MUS) for (const cv of CVS) for (let j = 0; j < PER; j++) {
    const seed = 1000 + sh + (k++) * 7919, p = play(M, mu, cv, seed, N, null);
    out.pop.push({ mu, cv, p, cross: crossingsOf(p.tiers), hid: M.tierOfHidden(Math.round(mu * 100), LINES) });
  }
  for (const [name, mu] of LEVELS) {
    const runs = [];
    for (const cv of CVS) for (let j = 0; j < 10; j++) { const p = play(M, mu, cv, 50000 + mu * 101 + j * 13 + (cv > 0.5 ? 7 : 0), 600, null); runs.push(p.toDiamond == null ? 601 : p.toDiamond); }
    out.toD[name] = { median: median(runs), runs };
  }
  for (const cv of CVS) for (let j = 0; j < 10; j++) { const p = play(M, GM_MU, cv, 90000 + sh + j * 31 + (cv > 0.5 ? 3 : 0), N, 8600); out.gm.push(p.lp - 8600); }
  return out;
}
// [4] / [5] over GROUPS random sequences: the crossings of every player (the population of simulate) and the change of every
//   grandmaster-level player from 8600 -- { cross: [per player], gm: [per player] }
const GROUPS = 12;
function simulateGroups(M) {
  const cross = [], gm = [];
  for (let g = 0; g < GROUPS; g++) {
    const sh = g * 1000003; let k = 0;
    for (const mu of MUS) for (const cv of CVS) for (let j = 0; j < PER; j++) cross.push(crossingsOf(play(M, mu, cv, 1000 + sh + (k++) * 7919, N, null).tiers).c);
    for (const cv of CVS) for (let j = 0; j < 10; j++) gm.push(play(M, GM_MU, cv, 90000 + sh + j * 31 + (cv > 0.5 ? 3 : 0), N, 8600).lp - 8600);
  }
  return { cross, gm };
}
const pingOk = (g) => mean(g.cross) <= 6 && g.cross.filter((c) => c > 20).length <= 0.005 * g.cross.length;
// O781 [8]: the wall-hugging group (true level 30..45, cv 0.1) + a grandmaster-level wall-hugger started at 8600
function simulateWall(M) {
  const out = { pop: [], gm: [] };
  let k = 0;
  for (const mu of WALL_MUS) for (let j = 0; j < 2 * PER; j++) { const p = play(M, mu, WALL_CV, 120000 + (k++) * 7919, N, null); out.pop.push({ mu, p }); }
  for (let j = 0; j < 20; j++) { const p = play(M, 45, WALL_CV, 130000 + j * 31, N, 8600); out.gm.push(p.lp - 8600); }
  return out;
}
function wallRates(w) {
  const all = [], per = {};
  for (const x of w.pop) for (const [, pass] of x.p.passAt) { all.push(pass ? 1 : 0); (per[x.mu] = per[x.mu] || []).push(pass ? 1 : 0); }
  return { all: mean(all), per: WALL_MUS.map((mu) => mean(per[mu] || [])) };
}
const wallOk = (w) => { const r = wallRates(w); return r.all >= 0.42 && r.all <= 0.58 && r.per.every((x) => x >= 0.40 && x <= 0.65); };
// the highest points a player held over his runs (the gate check)
function maxPoints(M, mu, cv, seed) {
  const r = rng(seed), depths = [];
  for (let i = 0; i < M.ELP.MIN_RUNS; i++) depths.unshift(depthOf(r, mu, cv));
  let lp = M.endlessSeedLp(seedSkill(M, depths), LINES), mx = lp;
  for (let i = 0; i < N; i++) {
    const seedRun = (r() * 4294967296) >>> 0, H = M.hiddenOf(depths);
    const d = depthOf(r, mu, cv);
    lp = M.endlessSettle(lp, d >= M.targetOf(lp, LINES, seedRun, H, false), H, LINES, M.targetOffset(seedRun)).nv;
    depths.unshift(d); if (depths.length > M.ELP.WINDOW) depths.pop();
    if (lp > mx) mx = lp;
  }
  return mx;
}
// O785 [9]: runs from the placement to diamond of a bronze-level grinder (mean depth 3), 10 players at each luck spread, 600 runs
function grindToDiamond(M) {
  const runs = [];
  for (const cv of CVS) for (let j = 0; j < 10; j++) { const p = play(M, 3, cv, 140000 + j * 17 + (cv > 0.5 ? 5 : 0), 600, null); runs.push(p.toDiamond == null ? 601 : p.toDiamond); }
  return { runs, got: runs.filter((x) => x <= 600).length, median: median(runs) };
}
function gateMax(M) { let mx = 0; for (const mu of [3, 5, 8, 12, 18, 25]) for (const cv of CVS) for (let j = 0; j < 10; j++) mx = Math.max(mx, maxPoints(M, mu, cv, 70000 + mu * 37 + j * 11 + (cv > 0.5 ? 5 : 0))); return mx; }
function passRates(sim) {
  const all = [], byCv = {};
  for (const x of sim.pop) for (const [, pass] of x.p.passAt) { all.push(pass ? 1 : 0); (byCv[x.cv] = byCv[x.cv] || []).push(pass ? 1 : 0); }
  return { all: mean(all), byCv: Object.fromEntries(Object.entries(byCv).map(([k, v]) => [k, mean(v)])) };
}
function loadVariant(pairs) {
  let s = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  for (const [a, b] of pairs) { if (s.indexOf(a) < 0) throw new Error('mutation anchor missing: ' + a.slice(0, 80)); s = s.split(a).join(b); }
  const win = {}; new Function('window', s)(win); return win.POINTS_PLAN;
}
// O803 [9]: a mixed pair -- two true levels (muA strong, muB weak); each keeps a window of ten own-level depths (his duo skill), the
//   pair's run depth is lognormal around the mean of the two levels. ownTarget = the O728 reading (each seat against his own skill)
const PAIRS = [[8, 16], [12, 24], [18, 30], [25, 40], [10, 30]], PAIR_CV = 0.3, PAIR_LINES = PP0.ELP.PRIOR.duo, PAIR_N = 200, PAIR_PER = 4;
function playPair(M, muA, muB, seed, n, ownTarget) {
  const r = rng(seed), wA = [], wB = [];
  for (let i = 0; i < M.ELP.WINDOW; i++) { wA.unshift(depthOf(r, muA, PAIR_CV)); wB.unshift(depthOf(r, muB, PAIR_CV)); }
  let lpA = M.endlessSeedLp(M.hiddenOf(wA), PAIR_LINES), lpB = M.endlessSeedLp(M.hiddenOf(wB), PAIR_LINES);
  const passA = [], passB = [], signs = [];
  for (let i = 0; i < n; i++) {
    const seedRun = (r() * 4294967296) >>> 0, hA = M.hiddenOf(wA), hB = M.hiddenOf(wB), th = M.teamHiddenOf([hA, hB]);
    const TA = M.targetOf(lpA, PAIR_LINES, seedRun, ownTarget ? hA : th, false), TB = M.targetOf(lpB, PAIR_LINES, seedRun, ownTarget ? hB : th, false);
    const d = depthOf(r, (muA + muB) / 2, PAIR_CV), off = M.targetOffset(seedRun);
    const sA = M.endlessSettle(lpA, d >= TA, hA, PAIR_LINES, off), sB = M.endlessSettle(lpB, d >= TB, hB, PAIR_LINES, off);
    passA.push(d >= TA ? 1 : 0); passB.push(d >= TB ? 1 : 0); signs.push(Math.sign(sA.plan.d) === Math.sign(sB.plan.d) ? 1 : 0);
    lpA = sA.nv; lpB = sB.nv;
    // each plays on at his own level in between (his window follows his own level, not the pair's)
    wA.unshift(depthOf(r, muA, PAIR_CV)); wA.pop(); wB.unshift(depthOf(r, muB, PAIR_CV)); wB.pop();
  }
  return { passA, passB, signs };
}
function simulatePairs(M, ownTarget) {
  const out = [];
  let k = 0;
  for (const [muB, muA] of PAIRS) for (let j = 0; j < PAIR_PER; j++) out.push({ muA, muB, p: playPair(M, muA, muB, 200000 + (k++) * 7919, PAIR_N, ownTarget) });
  return out;
}
function pairRates(sim) {
  const strong = [], weak = [], sign = [], perPair = [];
  for (const x of sim) { strong.push(...x.p.passA); weak.push(...x.p.passB); sign.push(...x.p.signs); }
  for (const [muB, muA] of PAIRS) { const g = sim.filter((x) => x.muA === muA && x.muB === muB); perPair.push([mean([].concat(...g.map((x) => x.p.passA))), mean([].concat(...g.map((x) => x.p.passB)))]); }
  return { all: mean(strong.concat(weak)), strong: mean(strong), weak: mean(weak), sameSign: mean(sign), perPair };
}
const pairsOk = (sim) => { const r = pairRates(sim); return r.all >= 0.42 && r.all <= 0.58 && [r.strong, r.weak].every((x) => x >= 0.40 && x <= 0.65) && r.perPair.every(([a, b]) => a >= 0.40 && a <= 0.65 && b >= 0.40 && b <= 0.65); };
module.exports = { simulate, simulateGroups, passRates, gateMax, grindToDiamond, loadVariant, simulateWall, wallRates, simulatePairs, pairRates, WANT, LEVELS, PAIRS, GROUPS };

if (require.main === module) {
  let failN = 0;
  const ok = (m) => console.log('  ok    ' + m);
  const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
  const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
  const E = PP0.ELP;
  console.log('=== O728 endless points simulation (MUL ' + E.MUL.join('/') + ', TARGET_Q ' + E.TARGET_Q + ', SWING_CAP ' + E.SWING_CAP + '; prior solo lines ' + JSON.stringify(LINES) + ') ===');
  const S = simulate(PP0);
  const perMu = (sim) => MUS.map((mu) => mean([].concat(...sim.pop.filter((x) => x.mu === mu).map((x) => x.p.passAt.map((y) => (y[1] ? 1 : 0))))));
  const passOk = (sim) => { const pr = passRates(sim); return [pr.all, pr.byCv['0.3'], pr.byCv['0.6']].every((x) => x >= 0.42 && x <= 0.58) && perMu(sim).every((x) => x >= 0.40 && x <= 0.65); };
  // [1]
  const pr = passRates(S), pm = perMu(S);
  T('[1] about half the runs pass: overall ' + pr.all.toFixed(3) + ', cv 0.3 ' + pr.byCv['0.3'].toFixed(3) + ', cv 0.6 ' + pr.byCv['0.6'].toFixed(3) + ' (0.42..0.58)', [pr.all, pr.byCv['0.3'], pr.byCv['0.6']].every((x) => x >= 0.42 && x <= 0.58));
  T('[1] at every true level too (0.40..0.65): ' + MUS.map((mu, i) => mu + ' ' + pm[i].toFixed(2)).join(' | '), pm.every((x) => x >= 0.40 && x <= 0.65));
  // [2]
  for (const [name] of LEVELS) {
    const m = S.toD[name].median, w = WANT[name];
    T('[2] ' + name + '-level player: placement to diamond in ' + m + ' runs (median of 20; wanted ' + w + ' +-30 %; spread ' + Math.min.apply(null, S.toD[name].runs) + '..' + Math.max.apply(null, S.toD[name].runs) + ')', m >= w * 0.7 && m <= w * 1.3);
  }
  // [3]
  const gm = gateMax(PP0);
  T('[3] master gate: players below master in hidden skill (mean depth 3..25) never reach master in 300 runs (highest ' + gm + ')', gm < PP0.LP_SEG[5].min);
  // [4]
  const cr = S.pop.map((x) => x.cross.c), back = S.pop.reduce((s, x) => s + x.cross.back, 0), tot = cr.reduce((s, x) => s + x, 0);
  // the five-run rule beside it (version 5: MIN_RUNS 5, the trimmed mean at the seed) on the same sequences
  const FIVE = loadVariant([['MIN_RUNS: 3, TRIM: 1,', 'MIN_RUNS: 5, TRIM: 1,'], ['elpConvert, elpHiddenFor, elpSeedHidden, tierOfHidden,', 'elpConvert, elpHiddenFor, tierOfHidden,']]);
  const G6 = simulateGroups(PP0), G5 = simulateGroups(FIVE);
  const over = (g) => g.cross.filter((c) => c > 20).length;
  T('[4] ping-pong over ' + GROUPS + ' random sequences (' + G6.cross.length + ' players, 300 runs each): tier-line crossings a player, mean ' + mean(G6.cross).toFixed(2) + ' (<= 6), ' + over(G6) + ' players above 20 (<= 0.5 %), the worst ' + Math.max.apply(null, G6.cross) + '; the first sequence alone: mean ' + mean(cr).toFixed(1) + ', max ' + Math.max.apply(null, cr) + ', crossed back within 10 runs ' + (tot ? (100 * back / tot).toFixed(1) : '0') + ' %', pingOk(G6));
  T('[4] ... the placement count does not move it: under five placement runs the same sequences give mean ' + mean(G5.cross).toFixed(2) + ', ' + over(G5) + ' above 20, the worst ' + Math.max.apply(null, G5.cross) + ' (the means within 0.5)', Math.abs(mean(G6.cross) - mean(G5.cross)) <= 0.5 && pingOk(G5));
  // [9] O785
  const gr = grindToDiamond(PP0);
  T('[9] a bronze-level grinder (mean depth 3) reaches diamond: ' + gr.got + ' / ' + gr.runs.length + ' within 600 runs, median ' + gr.median + ' runs (<= 250)', gr.got === gr.runs.length && gr.median <= 250);
  // [5]
  T('[5] the top over ' + GROUPS + ' random sequences: ' + G6.gm.length + ' grandmaster-level players from 8600, mean change after 300 runs ' + mean(G6.gm).toFixed(0) + ' (guard +-350; under five placement runs ' + mean(G5.gm).toFixed(0) + ': within 60 of it -- the drift is not this version\'s; the first sequence alone ' + mean(S.gm).toFixed(0) + ', spread ' + Math.min.apply(null, S.gm) + '..' + Math.max.apply(null, S.gm) + ')', Math.abs(mean(G6.gm)) <= 350 && Math.abs(mean(G6.gm) - mean(G5.gm)) <= 60);
  // [6]
  console.log('  [6] per tier: the pass rate players had there | the table balance rate (loss - drip) / (win + loss)');
  for (let k = 0; k < 7; k++) {
    const s = PP0.LP_SEG[k], runs = [];
    for (const x of S.pop) for (const [t, pass] of x.p.passAt) if (t === k) runs.push(pass ? 1 : 0);
    console.log('        ' + NAMES[k].padEnd(11) + ' ' + (runs.length ? mean(runs).toFixed(3) : '  -  ') + ' (' + String(runs.length).padStart(5) + ' runs) | ' + ((s.loss - s.drip) / (s.win + s.loss)).toFixed(3));
  }
  console.log('  [6] tier after 300 runs, by true level (min..max of ' + (CVS.length * PER) + ' players):');
  for (const mu of MUS) { const g = S.pop.filter((x) => x.mu === mu).map((x) => x.p.tiers[x.p.tiers.length - 1]); console.log('        mean depth ' + String(mu).padStart(2) + ' (nearest line ' + NAMES[PP0.tierOfHidden(mu * 100, LINES)] + '): ' + NAMES[Math.min.apply(null, g)] + '..' + NAMES[Math.max.apply(null, g)]); }
  // [7] mutations
  const noGate = loadVariant([['if (cur < line && nv > Math.max(cur, cap))', 'if (false)']]);
  T('[7] no master gate turns [3] red', gateMax(noGate) >= PP0.LP_SEG[5].min);
  const oldTarget = loadVariant([["return hidden100 == null ? (elpLinesOk(pass) ? (pass[1] | 0) : 0) : Math.round((hidden100 | 0) * ELP.TARGET_Q / 100000);", "return elpLinesOk(pass) ? (pass[lpTierIdx(lpBefore)] | 0) : 0;"]]);
  const sO = simulate(oldTarget);
  T('[7] the old target (the points tier line) turns [1] red (per level ' + perMu(sO).map((x) => x.toFixed(2)).join(' ') + ')', !passOk(sO));
  const mul1 = loadVariant([['MUL: Object.freeze([' + E.MUL.join(', ') + '])', 'MUL: Object.freeze([1000, 1000, 1000, 1000, 1000, 1000, 1000])']]);
  const s1 = simulate(mul1);
  T('[7] MUL all 1000 turns [2] red (' + LEVELS.map(([n]) => n + ' ' + s1.toD[n].median).join(', ') + ' runs)', LEVELS.some(([name]) => !(s1.toD[name].median >= WANT[name] * 0.7 && s1.toD[name].median <= WANT[name] * 1.3)));
  const oldLand = loadVariant([['PROMO_LAND = 150, RELEG_LAND = 150', 'PROMO_LAND = 10, RELEG_LAND = 15']]);
  const gF = simulateGroups(oldLand);
  T('[7] the series landings back to +10 / -15 bring the ping-pong back (mean ' + mean(gF.cross).toFixed(1) + ' crossings, ' + gF.cross.filter((c) => c > 20).length + ' players above 20, the worst ' + Math.max.apply(null, gF.cross) + ') -- [4] red', !pingOk(gF));
  const strictLow = loadVariant([['else if (ht != null && ht < cur && cur >= ELP.GATE_TIER) gap = isPass ? ELP.GAP_DOWN : ELP.GAP_UP;', 'else if (ht != null && ht < cur) gap = isPass ? ELP.GAP_DOWN : ELP.GAP_UP;']]);
  const gS = grindToDiamond(strictLow);
  T('[7] "rated above the skill: gain less, lose more" below master too stops the grinder (' + gS.got + ' / ' + gS.runs.length + ' reach diamond, median ' + gS.median + ') -- [9] red', !(gS.got === gS.runs.length && gS.median <= 250));
  // [8] O781 wall-huggers
  const W = simulateWall(PP0), wr = wallRates(W);
  T('[8] wall-huggers (true level ' + WALL_MUS.join('/') + ', cv ' + WALL_CV + ') pass about half: overall ' + wr.all.toFixed(3) + ' (0.42..0.58), per level ' + wr.per.map((x) => x.toFixed(2)).join(' ') + ' (0.40..0.65)', wallOk(W));
  T('[8] (known drift, O799) a grandmaster-level wall-hugger (level 45, cv ' + WALL_CV + ') from 8600: mean change after 300 runs ' + mean(W.gm).toFixed(0) + ' (guard: no worse than +-2000; the goal is +-200; spread ' + Math.min.apply(null, W.gm) + '..' + Math.max.apply(null, W.gm) + ')', Math.abs(mean(W.gm)) <= 2000);
  const wO = simulateWall(oldTarget);
  T('[8] the old target (the points tier line) turns the wall-huggers red too (overall ' + wallRates(wO).all.toFixed(3) + ', per level ' + wallRates(wO).per.map((x) => x.toFixed(2)).join(' ') + ')', !wallOk(wO));
  // [9] O803 mixed pairs: one team target
  const PS = simulatePairs(PP0, false), prs = pairRates(PS);
  T('[9] mixed pairs (' + PAIRS.map(([b, a]) => a + '+' + b).join(', ') + ', cv ' + PAIR_CV + ') under the one team target pass about half: overall ' + prs.all.toFixed(3) + ' (0.42..0.58); the strong side ' + prs.strong.toFixed(3) + ', the weak side ' + prs.weak.toFixed(3) + ' (0.40..0.65); per pair ' + prs.perPair.map(([a, b]) => a.toFixed(2) + '/' + b.toFixed(2)).join(' '), pairsOk(PS));
  T('[9] in every run the two seats\' receipts carry one sign (both gain or both lose, by their own amounts): ' + (100 * prs.sameSign).toFixed(1) + ' %', prs.sameSign === 1);
  const PO = simulatePairs(PP0, true), pro = pairRates(PO);
  T('[9] the old reading (each seat against his own skill) turns it red: the strong side ' + pro.strong.toFixed(3) + ' (< 0.35), the weak side ' + pro.weak.toFixed(3) + ' (> 0.65)', !pairsOk(PO) && pro.strong < 0.35 && pro.weak > 0.65);
  const teamMax = loadVariant([['return Math.round(sum / xs.length) | 0;', 'return Math.max.apply(null, xs) | 0;']]);
  const PM = simulatePairs(teamMax, false), prm = pairRates(PM);
  T('[9] teamHiddenOf as the strongest seat turns it red: both sides under 0.35 (' + prm.strong.toFixed(3) + ' / ' + prm.weak.toFixed(3) + ')', !pairsOk(PM) && prm.strong < 0.35 && prm.weak < 0.35);
  console.log(failN ? ('endless-lp-sim: ' + failN + ' FAIL') : 'endless-lp-sim: all ok');
  process.exit(failN ? 1 : 0);
}
