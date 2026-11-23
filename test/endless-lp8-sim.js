'use strict';
// ============================================================
// endless-lp8-sim.js -- O991 (ELP version 8, 2026-11-23): the points of the grow-phase rules over a population, on the REAL
//   points-plan.js functions (version 7 for the baseline, version 8 for the new rules) and a frozen depth model:
//   fixtures/elp8/sim-depths.json = how deep a run of each tier's middle player goes on the 0.6.1 curve (cur) and on the version 8
//   curve (v8), from the companion repo's simulation (archive/O991_GROW_2026-11-23/sim/lp.js; the fixture's about says how). The
//   plan's tripwires (mvp/KNIFE_O991_ENDLESS_GROW_PLAN.md section 9) that read player outcomes:
//   [T5] the floor does not trap the weakest: the weakest 5 % pass level T_MIN in >= 40 % of their runs, and all 40 of them reach
//        diamond within 3000 runs
//   [T6] grinding: hours to diamond version 8 / version 7 <= 1.4 for silver / gold / platinum, <= 2.0 for the weakest tenth; hours to
//        master within +-25 % for the master / grandmaster players; every tier under diamond gains on average a run. The hours ratios
//        pool three seed groups (120 players a tier): one group of 40 scatters the master players' ratio over 1.10-1.27 at the 104 %
//        gate (six groups tried, 2026-11-23), so one lucky draw (1.11) sat far under the bound while the expectation (about 1.18) sits
//        close to it; pooled, the check reads the expectation
//   [T7] sandbagging: dying on purpose at the cheapest death that lowers the level (the depth past the grow phase: the rules decide
//        it), then farming the low target, reaches diamond in >= 0.85 x the honest hours, every tier from bronze up
//   [T14] the master gate (D3): within 300 runs, platinum players never reach master, diamond players at most 20 % (8 / 40), master
//        and grandmaster players >= 90 %
//   [M] mutations on a copy of points-plan.js: T_MIN 25 -> T5 red; lambda back to the version 7 base / the version 8 compensation
//       gone (lambda x1 and MUL8 back to the version 7 multipliers) -> T6 red; R2 back to "no level passed" (a death at level 2 drops
//       the level) -> T7 red; the gate back to 100 % -> T14 red. (T6 bounds the outcome, not each constant: lambda gone alone moves
//       platinum only 1.31 -> 1.40 and MUL8 alone 1.31 -> 1.34 on the pooled players, so neither alone is a mutation of it.)
//   Each player: three placement runs from the silver line, then up to 3000 points runs; a run costs its levels x 82 s + 120 s
//   (the live median of 0.6.1). Seeds as the companion simulation's.
// ============================================================
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const PPSRC = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
const PP0 = require(path.join(ROOT, 'points-plan.js'));
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'elp8', 'sim-depths.json'), 'utf8'));
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const NAMES = DOC.tiers, TI = (n) => NAMES.indexOf(n);
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// a draw from a histogram (index = depth): the inverse of its cumulative counts
function drawOf(h) { const cum = []; let a = 0; for (const x of h) { a += x; cum.push(a); } return (u) => { const k = u * a; let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > k) hi = mid; else lo = mid + 1; } return lo; }; }
const D7 = DOC.cur.map(drawOf), D8 = DOC.v8.map(drawOf);
const SPL = 82, OVER = 120, PLAYERS = 40, RUNS = 3000;
const share = (h, d) => h.slice(d).reduce((s, x) => s + x, 0) / h.reduce((s, x) => s + x, 0);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
// the cheapest death that lowers a version 8 level x (the depth a sandbagger dies at): the rules under test decide it
function sandbagDepth(M, x, Tt) { for (let d = 0; d < Tt; d++) { const y = M.elpLevelStep8(x, { pass: false, depth: d, T: Tt, placing: -1 }); if (y && y.L < x.L) return d; } return Tt - 1; }
// one player of tier ti: placement, then up to `runs` points runs. ver 7 = the version 7 rules on the 0.6.1 curve, 8 = version 8 on
//   its curve. policy 'sandbag': (version 8) while the level sits above the floor + 2 levels, die at the cheapest death that lowers it
function play(M, ver, ti, seed, runs, policy, stats) {
  const r = rng(seed), draw = ver === 7 ? D7[ti] : D8[ti], S7 = M.ELP7.PRIOR.solo, S8 = M.ELP8.PRIOR.solo;
  const tgt = (L, s2) => (ver === 7 ? M.elpTargetOfL(L, s2) : M.elpTargetOfL8(L, s2));
  const step = (x, o) => (ver === 7 ? M.elpLevelStep(x, o) : M.elpLevelStep8(x, o));
  let x = ver === 7 ? M.elpLevelInit(null, S7) : M.elpLevelInit8(null, [], null, S8), sec = 0;
  for (let i = 0; i < M.ELP.MIN_RUNS; i++) {
    const s2 = (r() * 4294967296) >>> 0, Tt = tgt(x.L, s2), Dd = draw(r()), pass = Dd >= Tt;
    sec += (pass ? Tt : Dd + 1) * SPL + OVER;
    x = step(x, { pass, depth: pass ? Tt : Dd, T: Tt, placing: i });
  }
  let lp = ver === 7 ? M.elpLevelSeed(x.L, S7, S7) : M.elpLevelSeed8(x.L, S8, S8), hD = null, hM = null, passN = 0, n = 0;
  for (; n < runs; n++) {
    const s2 = (r() * 4294967296) >>> 0, Tt = tgt(x.L, s2);
    let Dd = draw(r());
    if (policy === 'sandbag' && ver === 8 && x.L > M.ELP8.T_MIN * 100 + 200) Dd = sandbagDepth(M, x, Tt);
    const pass = Dd >= Tt, t = M.lpTierIdx(lp), before = lp;
    sec += (pass ? Tt : Dd + 1) * SPL + OVER; if (pass) passN++;
    lp = ver === 7 ? M.endlessSettleLv(lp, pass, x.Lm, S7, M.targetOffset(s2), 'solo', M.elpLineOfL(x.L)).nv
      : M.endlessSettleLv8(lp, pass, x.Lm, S8, M.targetOffset(s2), 'solo', M.elpLineOfL8(x.L)).nv;
    if (stats) { const k = stats[t] || (stats[t] = { n: 0, sum: 0 }); k.n++; k.sum += lp - before; }
    x = step(x, { pass, depth: pass ? Tt : Dd, T: Tt, quit: false, placing: -1 });
    if (hD == null && lp >= M.LP_SEG[4].min) hD = sec / 3600;
    if (hM == null && lp >= M.LP_SEG[5].min) { hM = sec / 3600; n++; break; }
  }
  return { hD, hM, pass: passN / Math.max(1, n) };
}
// 40 players of tier ti: mean hours to diamond (when 20 or more got there) / to master (36 or more), how many got there, pass rate
function cell(M, ver, ti, policy, groups) {
  const hD = [], hM = [], ps = [], G = groups || [0], n = PLAYERS * G.length;
  for (const g of G) for (let j = 0; j < PLAYERS; j++) { const o = play(M, ver, ti, 60000 + g + ti * 977 + j * 13, RUNS, policy); if (o.hD != null) hD.push(o.hD); if (o.hM != null) hM.push(o.hM); ps.push(o.pass); }
  return { hD: hD.length >= n / 2 ? mean(hD) : null, nD: hD.length, hM: hM.length >= n * 0.9 ? mean(hM) : null, nM: hM.length, pass: mean(ps) };
}
const memo = new Map();
const cellOf = (M, ver, ti, policy, groups) => { const k = (M === PP0 ? 'base' : 'mut') + ver + ':' + ti + ':' + (policy || '') + ':' + (groups || [0]).join(','); if (M !== PP0 || !memo.has(k)) { const c = cell(M, ver, ti, policy, groups); if (M !== PP0) return c; memo.set(k, c); } return memo.get(k); };
const POOL = [0, 100003, 200003];   // [T6]: three seed groups (group 0 = the seeds every other check uses)
const f1 = (x) => (x == null ? '-' : x.toFixed(2));

// [T5]
function t5(M) {
  const e = [], w = TI('bot5%'), p = share(DOC.v8[w], M.ELP8.T_MIN), c = cellOf(M, 8, w);
  if (!(p >= 0.40)) e.push('the weakest 5 % pass level ' + M.ELP8.T_MIN + ' in ' + (100 * p).toFixed(1) + ' % of their runs (< 40 %)');
  if (c.nD !== PLAYERS) e.push('the weakest 5 %: ' + c.nD + ' / ' + PLAYERS + ' reach diamond within ' + RUNS + ' runs');
  return { e, info: 'weakest 5 % pass level ' + M.ELP8.T_MIN + ': ' + (100 * p).toFixed(1) + ' %, diamond ' + c.nD + ' / ' + PLAYERS + ' (' + f1(c.hD) + ' h)' };
}
// [T6]
function t6(M) {
  const e = [], parts = [];
  const ratio = (ti, k) => { const a = cellOf(PP0, 7, ti, null, POOL), b = cellOf(M, 8, ti, null, POOL); return (a[k] && b[k]) ? b[k] / a[k] : null; };
  for (const [n, cap] of [['silver', 1.4], ['gold', 1.4], ['plat', 1.4], ['bot10%', 2.0]]) {
    const q = ratio(TI(n), 'hD');
    parts.push(n + ' ' + f1(q));
    if (q == null || q > cap) e.push(n + ': hours to diamond version 8 / version 7 = ' + f1(q) + ' (cap ' + cap + ')');
  }
  for (const n of ['master', 'gm']) {
    const q = ratio(TI(n), 'hM');
    parts.push(n + ' to master ' + f1(q));
    if (q == null || q < 0.75 || q > 1.25) e.push(n + ': hours to master version 8 / version 7 = ' + f1(q) + ' (+-25 %)');
  }
  const st = {};
  for (let ti = TI('bronze'); ti < NAMES.length; ti++) for (let j = 0; j < 20; j++) play(M, 8, ti, 90000 + ti * 31 + j, RUNS, null, st);
  const per = [0, 1, 2, 3].map((k) => (st[k] ? st[k].sum / st[k].n : null));
  parts.push('points a run bronze..platinum ' + per.map(f1).join(' / ') + ', diamond ' + f1(st[4] ? st[4].sum / st[4].n : null));
  if (per.some((x) => x == null || !(x > 0))) e.push('a tier under diamond does not gain on average: ' + per.map(f1).join(' / '));
  return { e, info: parts.join(' | ') };
}
// [T7]
function t7(M) {
  const e = [], parts = [];
  for (let ti = TI('bronze'); ti < NAMES.length; ti++) {
    const h = cellOf(M, 8, ti), s = cellOf(M, 8, ti, 'sandbag'), q = (h.hD && s.hD) ? s.hD / h.hD : null;
    parts.push(NAMES[ti] + ' ' + f1(q));
    if (q == null || q < 0.85) e.push(NAMES[ti] + ': the sandbagger reaches diamond in ' + f1(q) + ' x the honest hours (< 0.85)');
  }
  return { e, info: 'sandbag / honest hours to diamond: ' + parts.join(' / ') };
}
// [T14]
function t14(M) {
  const e = [], cnt = (ti) => { let k = 0; for (let j = 0; j < PLAYERS; j++) if (play(M, 8, ti, 70000 + ti * 211 + j * 17, 300).hM != null) k++; return k; };
  const c = { plat: cnt(TI('plat')), diam: cnt(TI('diam')), master: cnt(TI('master')), gm: cnt(TI('gm')) };
  if (c.plat !== 0) e.push('platinum players reach master: ' + c.plat + ' / ' + PLAYERS);
  if (c.diam > 8) e.push('diamond players reach master: ' + c.diam + ' / ' + PLAYERS + ' (> 8)');
  if (c.master < 36 || c.gm < 36) e.push('master / grandmaster players reach master: ' + c.master + ' / ' + c.gm + ' of ' + PLAYERS + ' (< 36)');
  return { e, info: 'master within 300 runs: platinum ' + c.plat + ' / diamond ' + c.diam + ' / master ' + c.master + ' / grandmaster ' + c.gm + ' of ' + PLAYERS };
}

console.log('=== O991 version 8 points over a population (the real rules; fixtures/elp8/sim-depths.json) ===');
const t0 = Date.now();
for (const [label, fn] of [['[T5] the floor does not trap the weakest', t5], ['[T6] hours to diamond / master against version 7, and every tier under diamond gains', t6],
  ['[T7] sandbagging the target costs at least 0.85 x the honest hours to diamond', t7], ['[T14] the master gate within 300 runs', t14]]) {
  const r = fn(PP0);
  T(label + ' (' + r.info + ')', r.e.length === 0, r.e.slice(0, 3).join(' | '));
}
{   // the table behind the checks (printed)
  const rows = [];
  for (let ti = 0; ti < NAMES.length; ti++) { const a = cellOf(PP0, 7, ti), b = cellOf(PP0, 8, ti); rows.push(NAMES[ti] + ' pass ' + (100 * a.pass).toFixed(0) + '/' + (100 * b.pass).toFixed(0) + '% diamond ' + f1(a.hD) + '/' + f1(b.hD) + ' h [' + a.nD + '/' + b.nD + '] master ' + f1(a.hM) + '/' + f1(b.hM) + ' h'); }
  console.log('  (version 7 / version 8 per tier: ' + rows.join(' ; ') + ')');
}
// [M] mutations: a copy of points-plan.js with one rule moved
function mutPP(pairs) {
  let s = PPSRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80)); s = s.split(good).join(badS); }
  const w = {}; new Function('window', s)(w);   // eslint-disable-line no-new-func
  return w.POINTS_PLAN;
}
const MUTS = [
  ['T5: the floor 25 (variant B of the plan)', [['GROW_END: 15, T_MIN: 20,', 'GROW_END: 15, T_MIN: 25,']], t5],
  ['T6: lambda on the version 7 base (REF 1000: every version 8 line at the cap)', [['PROP: Object.freeze({ REF: 2000, LO: 500, HI: 2000 }),', 'PROP: Object.freeze({ REF: 1000, LO: 500, HI: 2000 }),']], t6],
  ['T6: the version 8 compensation gone (lambda x1 and MUL8 back to the version 7 multipliers)', [['function elpPropK8(line) { return Math.max(ELP8.PROP.LO, Math.min(ELP8.PROP.HI, Math.round(Math.max(0, line | 0) * 100 * 1000 / ELP8.PROP.REF))); }', 'function elpPropK8(line) { void line; return 1000; }'],
    ['MUL: Object.freeze([2800, 2500, 2400, 2500, 2900, 2800, 2800]),', 'MUL: Object.freeze([1800, 1800, 2100, 2200, 2800, 2800, 2800]),']], t6],
  ['T7: R2 back to "no level passed" (a death at level 2 lowers the level)', [['if (!pass && depth <= ELP8.GROW_END) return x;', 'if (!pass && depth === 0) return x;']], t7],
  ['T14: the solo gate back to 100 %', [['GATE: 104, TEAM_GATE: 104,', 'GATE: 100, TEAM_GATE: 104,']], t14],
];
for (const [label, pairs, fn] of MUTS) {
  let red = false, why = '';
  try { const r = fn(mutPP(pairs)); red = r.e.length > 0; why = r.e[0] || r.info; }
  catch (err) { if (/anchor missing/.test(err.message)) { bad('[M] ' + label + ': ' + err.message); continue; } red = true; why = 'threw: ' + err.message.slice(0, 80); }
  T('[M] mutation "' + label + '" turns its check red' + (red ? ' (' + why + ')' : ''), red, why);
}
console.log('  (' + Math.round((Date.now() - t0) / 1000) + ' s)');
console.log(failN ? 'FAIL (endless-lp8-sim) ' + failN : 'endless-lp8-sim: all ok');
process.exit(failN ? 1 : 0);
