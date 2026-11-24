'use strict';
// ============================================================
// elp-restart-start.js -- O1015 (2026-11-24, the user: fix it now and make the points up): a relaunched 0.6.1-0.6.3 client's start, on the REAL
//   ratingHistUpsert / elpSettleAll / elpO1015Lift. Such a client lost its level on every relaunch and started its next run from the
//   hidden strength (elpLevelInit); a session that went on without a relaunch walked on from there. The job now reads those starts
//   too, for the verdict only:
//   [1] a placed player whose family holds a version 7 level far above his hidden strength; his relaunched client's run ends at the
//       restart start's target: a pass with the points of that reading; the next run of the session ends at the target the restart
//       chain stepped to: a pass too. Each run's states / levels / set (r[10]-r[12], lv, lvs) are exactly those of the job without
//       the restart readings (the level the job carries never follows them)
//   [2] the restart start is the job's own hidden strength from the runs before it (what his row carried), independently computed
//   [3] not on: a quit, a death short of the target, a placement run, after the version 8 gate (PUB_VER 8, cutover before the run),
//       a team run, the family's first version 7 run (its starts are real readings anyway)
//   [4] the lift: runs the job before O1015 judged misses become passes (target = the depth, points only up), a death stays, the
//       states / levels / set / hidden strengths stay, a second lift changes nothing
//   [5] a client that relaunches before every run: no run it ended at its line is judged a miss
//   [9] mutations: each check above turns red on the matching break
// ============================================================
const path = require('path'), fs = require('fs'), os = require('os');
for (const k of ['ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER', 'ELP_IDLE_MS', 'PT_MODE', 'SEASON_NOW', 'COUCH_DUO']) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const attest = require(path.join(ROOT, 'attest.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = (x) => JSON.stringify(x);
const F = attest.SEG_FINAL, MIN = 60000, T0 = 1764000000000;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (m, n) => m.pid(SID(n));
const C = (st, p) => st.hist[v.elpAllKey(p, 0)];
const HS = (st, p) => st.hist[v.ratingHistKey(p, 'solo', 0)];
const runOf = (st, p, id) => (HS(st, p) || { runs: [] }).runs.find((q) => (q[0] >>> 0) === (id >>> 0));
const S = (L, Lm, s, last, run) => ({ L, Lm, s, last, run });
const V7 = { v7: true, quit: false }, V7Q = { v7: true, quit: true };
const X7 = S(3000, 2950, 3, 1, 2), DS = [12, 11, 13];

// the job past the version 8 gate (its cutover before these worlds): no restart readings
function restartOff(m) {
  const R = m.RATING, keep = { pub: R.PUB_VER, cut: R.CUTOVER_MS };
  R.PUB_VER = 8; R.CUTOVER_MS = 1;
  return () => { R.PUB_VER = keep.pub; R.CUTOVER_MS = keep.cut; };
}
// a placed player holding version 7 level x7 of solo with settled version 7 runs at depths ds (oldest first; their depths feed the
//   hidden strength only)
function holder(m, n, o) {
  o = o || {};
  const st = { hist: {} }, p = P(m, n), t0 = T0 + 100 * n * MIN, ds = o.ds || DS;
  const runs = ds.map((d, i) => [80000 + 100 * n + i, d, t0 + i * MIN, 2, 0, d, t0 + i * MIN, 1 | m.ELP_R_V7, 40000 + 100 * n + i]);
  st.hist[m.ratingHistKey(p, 'solo', 0)] = { best: [0, 0], runs, old: [], t: t0 };
  st.hist[m.elpAllKey(p, 0)] = { lp: o.lp || 3200, placed: o.placed === false ? 0 : 1, seedRun: ['solo', runs[0][0]], n: ds.length, ring: [], t: t0, ...(o.noLevel ? {} : { lv: { solo: o.x7 || X7 } }) };
  return { st, p, t0, at: t0 + 30 * MIN };
}
// the restart start the job should read at a run first seen at `at` (no other run of his after the holder's): the hidden strength of
//   the holder's depths (newest first) under the lines in force, elpLevelInit -- computed here, not by the job's helper
function restartStartOf(st, at, ds) {
  const lines = v.elpLinesByFam(st, 0, at, 7), runs = (ds || DS).slice().reverse().map((d) => ['solo', d]);
  return PP.elpLevelInit(PP.elpHiddenFor('solo', runs, lines), lines.solo);
}
const lineAt = (L, seed) => PP.elpTargetOfL(L, seed);
// play run (id, depth, seed, lv) on a fresh world twice -- the real job, and the job with the restart readings off -- and return both
function both(m, n, plays, o) {
  const a = holder(m, n, o), b = holder(m, n, o);
  for (const pl of plays) { m.ratingHistUpsert(a.st, a.p, 'solo', 0, pl.id, pl.depth, a.at + pl.dt * MIN, F, pl.seed, pl.lv || V7); m.elpSettleAll(a.st, 0, a.at + pl.dt * MIN + 1000); }
  const undo = restartOff(m);
  try { for (const pl of plays) { m.ratingHistUpsert(b.st, b.p, 'solo', 0, pl.id, pl.depth, b.at + pl.dt * MIN, F, pl.seed, pl.lv || V7); m.elpSettleAll(b.st, 0, b.at + pl.dt * MIN + 1000); } } finally { undo(); }
  return { on: a, off: b };
}
// the fields the restart readings may never move: every run's states, the levels, the set, the hidden strengths
const frozen = (w) => J({ runs: (HS(w.st, w.p).runs || []).map((r) => [r[0], r[1], r[10], r[11], r[12]]), lv: C(w.st, w.p).lv, lvs: C(w.st, w.p).lvs, h: C(w.st, w.p).h });

// ---- [1] / [2] the relaunched client's two runs ----
function sChain(m, out) {
  const e = [], w0 = holder(m, 1), xr = restartStartOf(w0.st, w0.at);
  let sA = 0, sB = 0, tA = 0, tB = 0, xA = null;
  for (let s1 = 1; s1 < 200 && !sA; s1++) { const t = lineAt(xr.L, s1); if (t < lineAt(X7.L, s1) - 4) { sA = s1; tA = t; } }
  if (!sA) return ['the world is not a real test: no seed with a restart target well below the job\'s'];
  xA = PP.elpLevelStep(xr, { pass: true, depth: tA, T: tA, quit: false, placing: -1 });
  const xrB = restartStartOf(w0.st, w0.at + 30 * MIN, [12, 11, 13, tA]);
  for (let s2 = 1; s2 < 400 && !sB; s2++) { const t = lineAt(xA.L, s2); if (t !== lineAt(xrB.L, s2) && t < lineAt(X7.L, s2) - 4) { sB = s2; tB = t; } }
  if (!sB) return ['the world is not a real test: no second seed where the chain\'s target differs from a fresh restart and the job\'s'];
  const plays = [{ id: 7101, depth: tA, seed: sA, dt: 0 }, { id: 7102, depth: tB, seed: sB, dt: 30 }];
  const w = both(m, 1, plays);
  for (const [i, pl] of plays.entries()) {
    const ra = runOf(w.on.st, w.on.p, pl.id), rb = runOf(w.off.st, w.off.p, pl.id);
    if (!ra || ra[3] !== 2) { e.push('run ' + (i + 1) + ' did not settle'); continue; }
    if ((rb[5] | 0) <= pl.depth) e.push('the world is not a real test: without the restart readings run ' + (i + 1) + ' is a pass already ' + J(rb.slice(0, 6)));
    if ((ra[5] | 0) !== pl.depth || !((ra[4] | 0) > (rb[4] | 0))) e.push('run ' + (i + 1) + ' (ended at its line ' + pl.depth + ') judged ' + J(ra.slice(0, 6)) + ' (without: ' + J(rb.slice(0, 6)) + ')');
  }
  // the points of run 1: the pass under the restart start at the points before it
  const sl = PP.endlessSettleLv(3200, true, xr.Lm, v.elpLinesByFam(w.on.st, 0, w.on.at, 7).solo, PP.targetOffset(sA), 'solo', PP.elpLineOfL(xr.L));
  const r1 = runOf(w.on.st, w.on.p, 7101);
  if (r1 && (r1[4] | 0) !== sl.nv - 3200) e.push('run 1 points ' + r1[4] + ' != the restart start\'s pass ' + (sl.nv - 3200));
  if (frozen(w.on) !== frozen(w.off)) e.push('the level / set / states moved with the restart readings: ' + frozen(w.on).slice(0, 300) + ' vs ' + frozen(w.off).slice(0, 300));
  if (out) Object.assign(out, { sA, sB, tA, tB, xr });
  return e;
}
function sStart(m) {
  const e = [], w = holder(m, 2), r = [7201, 9, w.at, 0, 0, 0, w.at, 1 | m.ELP_R_V7, 3];
  const ctx = { order: new Map(), h0: new Map(), oldUntil: m.elpOldUntil(w.st) };
  const x = m.elpRestartStart(w.st, w.p, C(w.st, w.p), 'solo', 0, r, w.at + MIN, ctx), want = restartStartOf(w.st, w.at);
  if (J(x) !== J(want)) e.push('the job\'s restart start ' + J(x) + ' != elpLevelInit of his hidden strength ' + J(want));
  if (!(want.L < X7.L - 500)) e.push('the world is not a real test: the restart start is not well below his level ' + J([want, X7]));
  return e;
}

// ---- [3] not on ----
function sNot(m, o) {
  const e = [], k = sChain(m, o);
  if (!o.sA) return k.length ? k : ['no world'];
  const { sA, tA } = o, cases = [
    ['a quit at the restart target\'s depth', 3, [{ id: 7301, depth: tA, seed: sA, dt: 0, lv: V7Q }]],
    ['a death one level short of it', 4, [{ id: 7401, depth: tA - 1, seed: sA, dt: 0 }]],
    ['a placement run', 5, [{ id: 7501, depth: tA, seed: sA, dt: 0 }], { placed: false }],
    ['the family\'s first version 7 run', 6, [{ id: 7601, depth: tA, seed: sA, dt: 0 }], { noLevel: true }],
  ];
  for (const [what, n, plays, wo] of cases) {
    const w = both(m, n, plays, wo);
    const a = J([C(w.on.st, w.on.p), HS(w.on.st, w.on.p)]), b = J([C(w.off.st, w.off.p), HS(w.off.st, w.off.p)]);
    if (a !== b) e.push(what + ': the restart readings changed something ' + a.slice(0, 200) + ' vs ' + b.slice(0, 200));
  }
  // past the version 8 gate: the job publishes 8 and its cutover is before the run
  {
    const w = holder(m, 7), R = m.RATING, keep = { pub: R.PUB_VER, cut: R.CUTOVER_MS };
    R.PUB_VER = 8; R.CUTOVER_MS = w.at - MIN;
    try { m.ratingHistUpsert(w.st, w.p, 'solo', 0, 7701, tA, w.at, F, sA, V7); m.elpSettleAll(w.st, 0, w.at + 1000); } finally { R.PUB_VER = keep.pub; R.CUTOVER_MS = keep.cut; }
    const r = runOf(w.st, w.p, 7701);
    if (!r || (r[5] | 0) === tA) e.push('a version 7 run first seen past the version 8 gate read the restart start ' + J(r && r.slice(0, 6)));
  }
  // the choice itself: a verdict-only reading whose target is not the depth is never scored (a death short of it), even when it would
  //   score best; at the depth it is, and it never carries
  {
    const xr = S(1200, 1190, 2, -1, 0), xj = S(3000, 2950, 3, 1, 2), seed = sA, tr = lineAt(xr.L, seed);
    const reads = [{ x: xj, L: xj.L }, { x: xr, L: xr.L, verdictOnly: true }], val = (a) => ({ score: a.rd.verdictOnly ? 100 : 0 });
    const short = m.elpLvChoose(reads, tr - 1, seed, false, -1, false, val), at = m.elpLvChoose(reads, tr, seed, false, -1, false, val);
    if (short.pick.rd.verdictOnly) e.push('a death short of the restart target was scored by the restart reading');
    if (!at.pick.rd.verdictOnly) e.push('a run ending at the restart target did not take the restart reading');
    if (at.carry.rd.verdictOnly || at.outs.length !== 1) e.push('the restart reading carried / went out ' + J([at.carry.rd, at.outs]));
  }
  // a team run: the reader gives none; the same run without the team gives the restart start (so the guard is what stops it)
  {
    const w = holder(m, 8), c = C(w.st, w.p), h = HS(w.st, w.p), r = [7801, tA, w.at, 0, 0, 0, w.at, 1 | m.ELP_R_V7, sA];
    const ctx = { order: new Map(), h0: new Map(), oldUntil: m.elpOldUntil(w.st) };
    const own = m.elpRestartReads(w.st, w.p, c, h, r, 'solo', 0, w.at + MIN, ctx, undefined, false, []);
    const team = m.elpRestartReads(w.st, w.p, c, h, r, 'solo', 0, w.at + MIN, ctx, { L: 2000, lns: [20] }, false, []);
    if (!own.length || !own.every((x) => x.verdictOnly)) e.push('his own run got no verdict-only restart reading ' + J(own));
    if (team.length) e.push('a team run got restart readings ' + J(team));
  }
  return e;
}

// ---- [4] the lift ----
function sLift(m) {
  const o = {}, k = sChain(m, o);
  if (!o.sA) return k.length ? k : ['no world'];
  const e = [], { sA, sB, tA, tB } = o, w = holder(m, 9), undo = restartOff(m);
  try {   // the job before O1015 settles the session (both runs misses) and a death short of the first target
    m.ratingHistUpsert(w.st, w.p, 'solo', 0, 7901, tA, w.at, F, sA, V7); m.elpSettleAll(w.st, 0, w.at + 1000);
    m.ratingHistUpsert(w.st, w.p, 'solo', 0, 7902, tB, w.at + 30 * MIN, F, sB, V7); m.elpSettleAll(w.st, 0, w.at + 31 * MIN);
    m.ratingHistUpsert(w.st, w.p, 'solo', 0, 7903, tA + 2, w.at + 60 * MIN, F, sA, V7); m.elpSettleAll(w.st, 0, w.at + 61 * MIN);   // a death past the restart line
  } finally { undo(); }
  const was = [7901, 7902, 7903].map((id) => runOf(w.st, w.p, id).slice(0, 6)), lp0 = C(w.st, w.p).lp | 0, fz0 = frozen(w);
  if (!((was[0][5] | 0) > tA && (was[1][5] | 0) > tB && (was[2][5] | 0) > tA + 2)) return ['the world is not a real test: the old job passed them ' + J(was)];
  const lf = m.elpO1015Lift(w.st, 0, w.at + 200 * MIN), lp1 = C(w.st, w.p).lp | 0;
  const now = [7901, 7902, 7903].map((id) => runOf(w.st, w.p, id).slice(0, 6));
  if ((now[0][5] | 0) !== tA || (now[1][5] | 0) !== tB) e.push('the lift did not put the two runs at their lines ' + J(now));
  if (!((now[0][4] | 0) > (was[0][4] | 0) && (now[1][4] | 0) > (was[1][4] | 0))) e.push('the lift added nothing to the runs ' + J([was, now]));
  if (J(now[2]) !== J(was[2])) e.push('a death no restart reading passes moved ' + J([was[2], now[2]]));
  if (!(lp1 > lp0) || lf.pts !== lp1 - lp0 || lf.runs !== 2 || lf.players !== 1) e.push('the lift ' + J(lf) + ' points ' + lp0 + ' -> ' + lp1);
  if (frozen(w) !== fz0) e.push('the lift moved the level / set / states / hidden strengths');
  const lf2 = m.elpO1015Lift(w.st, 0, w.at + 210 * MIN);
  if (lf2.runs || (C(w.st, w.p).lp | 0) !== lp1) e.push('a second lift moved it again ' + J(lf2));
  return e;
}

// ---- [5] a client that relaunches before every run ----
function sRelaunch(m) {
  const e = [];
  let ends = 0, missed = 0, worlds = 0;
  for (const base of [[12, 11, 13], [20, 18, 22], [8, 9, 7]]) for (const seed0 of [11, 23, 37, 51]) {
    const w = holder(m, 10 + worlds, { ds: base }), ds = base.slice();
    worlds++;
    for (let k = 0; k < 3; k++) {
      const at = w.at + 30 * k * MIN, x = restartStartOf(w.st, at, ds), seed = seed0 + 7 * k, t = lineAt(x.L, seed);
      m.ratingHistUpsert(w.st, w.p, 'solo', 0, 8001 + k, t, at, F, seed, V7); m.elpSettleAll(w.st, 0, at + 1000);
      const r = runOf(w.st, w.p, 8001 + k);
      ends++;
      if (!r || (r[5] | 0) > t) { missed++; if (missed <= 3) e.push('base ' + J(base) + ' run ' + (k + 1) + ': ended at its line ' + t + ', judged against ' + (r && r[5])); }
      ds.push(t);
    }
  }
  if (!ends) e.push('no runs');
  return e;
}

const SCEN = [
  ['[1] a relaunched client\'s run ending at the restart start\'s target and the next run at the chain\'s: passes with that reading\'s points; the level / set / states are exactly those without the restart readings', (m) => sChain(m)],
  ['[2] the restart start is elpLevelInit of the job\'s own hidden strength from the runs before it', sStart],
  ['[3] not on a quit, a death short of the target, a placement run, the family\'s first version 7 run, past the version 8 gate, a team run', (m) => sNot(m, {})],
  ['[4] the lift: the old job\'s misses at the restart lines become passes (points only up), a death stays, nothing else moves, once only', sLift],
  ['[5] a client that relaunches before every run: no run it ended at its line is judged a miss', sRelaunch],
];
console.log('-- O1015: a relaunched 0.6.1-0.6.3 client\'s start (the job) --');
for (const [label, fn] of SCEN) { let errs; try { errs = fn(v); } catch (err) { errs = ['threw ' + (err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err)]; } T(label, !errs.length, errs.slice(0, 3).join(' | ')); }

function mutantOf(pairs) {
  const R = ROOT.replace(/\\/g, '/');
  let s = SRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); s = s.split(good).join(badS); }
  s = s.replace(/require\('\.\//g, "require('" + R + '/').replace(/__dirname/g, JSON.stringify(R));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-restart-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, s);
  try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const MUTS = [
  ['the restart readings never added', [['  for (const rd of elpRestartReads(st, p, c, h, r, fam, s, nowMs, ctx, team, quit, reads)) reads.push(rd);   // O1015: verdict only', '']], (m) => sChain(m)],
  ['the restart readings enter the carry / the outs', [['const all = every.filter((a) => !a.rd.verdictOnly), only =', 'const all = every, only =']], (m) => sChain(m)],
  ['no chain (each run reads a fresh restart start only)', [['    V = elpLvLowest(keep.map(', '    V = []; void (keep.map(']], (m) => sChain(m)],
  ['the restart start reads the job\'s level instead of the hidden strength', [['  return pointsPlan.elpLevelInit(b.runs.length ? pointsPlan.elpHiddenFor(fam, b.runs, lines, mr) : null, lines[fam]);', '  return pointsPlan.elpLevelOf(c && c.lv ? c.lv[fam] : null) || pointsPlan.elpLevelInit(null, lines[fam]);']], sStart],
  ['a quit reads the restart starts', [['  if (team || quit || !c || !c.placed || !elpRestartOn(r, nowMs)) return [];', '  if (team || !c || !c.placed || !elpRestartOn(r, nowMs)) return [];']], (m) => sNot(m, {})],
  ['a death short of the target uses a restart reading (any kept one, not only at the depth)', [['only = every.filter((a) => a.rd.verdictOnly && a.t === depth);', 'only = every.filter((a) => a.rd.verdictOnly && a.t >= depth);']], (m) => sNot(m, {})],
  ['no version 8 gate boundary', [['function elpRestartOn(r, nowMs) { const at = r && r[2] ? r[2] : nowMs; return !(RATING.PUB_VER >= 8 && RATING.CUTOVER_MS > 0 && at >= RATING.CUTOVER_MS); }', 'function elpRestartOn(r, nowMs) { return true; }']], (m) => sNot(m, {})],
  ['a team run reads the restart starts', [['  if (team || quit || !c || !c.placed || !elpRestartOn(r, nowMs)) return [];', '  if (quit || !c || !c.placed || !elpRestartOn(r, nowMs)) return [];']], (m) => sNot(m, {})],
  ['the lift rewrites a flipped run\'s states (the level would follow it on a replay)', [['      r[4] = (r[4] | 0) + up; r[5] = best.t; gain += up; flips++;', '      r[4] = (r[4] | 0) + up; r[5] = best.t; r[11] = elpLvArr(hit[0].x, -1); gain += up; flips++;']], sLift],
  ['the lift passes a death (any restart target at or under the depth)', [['.map((x) => ({ x, t: pointsPlan.elpTargetOfL(x.L, seed) })).filter((a) => a.t === depth);', '.map((x) => ({ x, t: pointsPlan.elpTargetOfL(x.L, seed) })).filter((a) => a.t <= Math.max(1, depth));']], sLift],
];
console.log('-- [9] mutations --');
for (const [label, pairs, fn] of MUTS) {
  let red = false, why = '';
  try { const e = fn(mutantOf(pairs)); red = e.length > 0; why = e[0] || ''; }
  catch (err) { if (/anchor missing/.test(err.message)) { bad('[9] ' + label + ': ' + err.message); continue; } red = true; why = 'threw: ' + err.message.slice(0, 80); }
  T('[9] mutation "' + label + '" turns its check red', red, why);
}
console.log(failN ? 'FAIL (elp-restart-start) ' + failN : 'elp-restart-start: all ok');
process.exit(failN ? 1 : 0);
