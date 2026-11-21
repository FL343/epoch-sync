'use strict';
// ============================================================
// endless-level.js -- O942 (ELP version 7, 2026-11-21; plan mvp/KNIFE_O942_ELP_LINE_SETTLE_PLAN.md in the companion repo): a
//   competitive endless run ends at its target and the target follows a per-player, per-family level (points-plan.js ELP7). The job
//   half, on the REAL elpSettleAll / ratingHistUpsert / ratingHistRemove / ratingScoreOf, against a model built from points-plan.js:
//   [1] intake: the version 7 bit comes with a run's first segment and stays; the quit bit only with the final segment; elpSegLv
//   [2] solo: three placement runs walk the level (PLACE, a miss floored at its depth), the third seeds from the level; points runs
//       settle by endlessSettleLv with the smoothed level and lambda of the line; R1 (a quit) and R2 (no level passed) leave the
//       level; every run keeps its states (r[10] / r[11]); the receipts; the row is v3 with the level states
//   [3] a version 6 run settles as before (no level, no r[10]); a player's first version 7 run starts from the version 6 reading
//   [4] team: the target is the roster's HIGHEST level (frozen once), every member steps his OWN level
//   [5] the cutover (D6): from RATING.CUTOVER_MS a parked version 6 run settles; a parked version 7 run does not
//   [6] a conviction of a version 7 run replays the family's level from the state before it (the later runs' points stay)
//   [7] the tables: the version of a recorded table, a version 6 reading never takes a version 7 table, a version 7 one may;
//       the published version / priors follow RATING.PUB_VER
//   [8] mutations: each check above turns red on the matching break
// ============================================================
const path = require('path'), fs = require('fs'), os = require('os');
for (const k of ['ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER', 'ELP_IDLE_MS', 'PT_MODE', 'SEASON_NOW', 'COUCH_DUO']) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));
const PP = require(path.join(__dirname, '..', 'points-plan.js'));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = (x) => JSON.stringify(x);
const F = attest.SEG_FINAL, SUS = attest.SEG_SUSPENDED, MIN = 60000, T0 = 1764000000000;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (m, n) => m.pid(SID(n));
const H = (st, p, fam) => st.hist[v.ratingHistKey(p, fam || 'solo', 0)];
const C = (st, p) => st.hist[v.elpAllKey(p, 0)];
const LINES = PP.ELP.PRIOR;   // no table recorded: every reading falls back to the version 6 priors
const arr = (x, placing) => [x.L, x.Lm, x.s, x.last, x.run, placing == null ? -1 : placing];
const runOf = (st, p, fam, id) => (H(st, p, fam) || { runs: [] }).runs.find((q) => (q[0] >>> 0) === (id >>> 0));

// ---- [1] intake ----
function sIntake(m) {
  const e = [], st = { hist: {} }, p = P(m, 1);
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 3, T0, 0, 900, { v7: true, quit: false });
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 5, T0 + MIN, 0, 900);   // a later segment without the bit (a caller that passes none)
  const r = runOf(st, p, 'solo', 41);
  if (!r || !((r[7] | 0) & m.ELP_R_V7)) e.push('the version 7 bit left with a later segment: fl ' + (r && r[7]));
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 6, T0 + 2 * MIN, 0, 900, { v7: true, quit: true });   // not final: no quit bit
  if ((r[7] | 0) & m.ELP_R_QUIT) e.push('a non-final segment set the quit bit');
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 6, T0 + 3 * MIN, F, 900, { v7: true, quit: true });
  if (!((r[7] | 0) & m.ELP_R_QUIT) || !((r[7] | 0) & 1)) e.push('the final quit segment: fl ' + r[7]);
  m.ratingHistUpsert(st, p, 'solo', 0, 42, 4, T0 + 4 * MIN, F, 901);   // a version 6 run
  if ((runOf(st, p, 'solo', 42)[7] | 0) & (m.ELP_R_V7 | m.ELP_R_QUIT)) e.push('a version 6 run carries a version 7 / quit bit');
  const a = m.elpSegLv({ ok: true, elp: 7 }, { flags: F, dispCode: 5 }), b = m.elpSegLv({ ok: true, elp: 7 }, { flags: 0, dispCode: 5 }), c = m.elpSegLv({ ok: true, elp: 6 }, { flags: F, dispCode: 0 });
  if (J(a) !== J({ v7: true, quit: true }) || J(b) !== J({ v7: true, quit: false }) || J(c) !== J({ v7: false, quit: false })) e.push('elpSegLv ' + J([a, b, c]));
  return e;
}

// ---- [2] solo: placement, points, R1, R2, states, receipts, row ----
// plan steps: 'P' pass at the target, 'M' miss (depth = T - k), 'Q' quit (a miss with the quit bit), 'Z' no level passed
const SOLO_PLAN = [['P'], ['M', 2], ['P'], ['P'], ['P'], ['M', 1], ['Q', 2], ['Z'], ['P'], ['P']];
function sSolo(m, out) {
  const e = [], st = { hist: {} }, p = P(m, 2);
  let x = PP.elpLevelInit(null, LINES.solo), lp = null, n = 0, id = 100, sawR1 = false, sawR2 = false;
  for (const step of SOLO_PLAN) {
    const seed = 5000 + id, kind = step[0], Tt = PP.elpTargetOfL(x.L, seed);
    const depth = kind === 'P' ? Tt : kind === 'Z' ? 0 : Math.max(0, Tt - (step[1] | 0)), quit = kind === 'Q', pass = depth >= Tt;
    const placing = n < PP.ELP.MIN_RUNS ? n : -1;
    m.ratingHistUpsert(st, p, 'solo', 0, id, depth, T0 + id * MIN, F, seed, { v7: true, quit });
    m.elpSettleAll(st, 0, T0 + id * MIN + 1000);
    const r = runOf(st, p, 'solo', id), c = C(st, p);
    const before = x;
    let d;
    if (placing >= 0) {
      x = PP.elpLevelStep(x, { pass, depth, T: Tt, quit, placing });
      if (n + 1 >= PP.ELP.MIN_RUNS) { lp = PP.elpLevelSeed(x.L, LINES.solo, LINES.solo); d = lp; } else d = 0;
    } else {
      const sl = PP.endlessSettleLv(lp, pass, before.Lm, LINES.solo, PP.targetOffset(seed), 'solo', PP.elpLineOfL(before.L));
      d = sl.nv - lp; lp = sl.nv;
      x = PP.elpLevelStep(x, { pass, depth, T: Tt, quit, placing: -1 });
      if (quit && !pass) { sawR1 = true; if (x.L !== before.L || x.s !== before.s) e.push('R1: the quit run moved the level'); }
      if (kind === 'Z' && Tt >= PP.ELP7.R2_T_MIN && before.Lm >= PP.ELP7.R2_LM_MIN) { sawR2 = true; if (x.L !== before.L) e.push('R2: the no-level run moved the level'); }
    }
    if (!r || r[3] !== 2) { e.push('run ' + id + ' did not settle'); break; }
    if ((r[5] | 0) !== Tt) e.push('run ' + id + ' target ' + r[5] + ' != ' + Tt);
    if ((r[4] | 0) !== d) e.push('run ' + id + ' points ' + r[4] + ' != ' + d);
    if (J(r[10]) !== J(arr(before, placing)) || J(r[11]) !== J(arr(x, placing))) e.push('run ' + id + ' states ' + J([r[10], r[11]]) + ' != ' + J([arr(before, placing), arr(x, placing)]));
    if (!c || J(c.lv && c.lv.solo) !== J(x)) e.push('run ' + id + ' level ' + J(c && c.lv) + ' != ' + J(x));
    if (n + 1 >= PP.ELP.MIN_RUNS && (!c.placed || (c.lp | 0) !== lp)) e.push('run ' + id + ' lp ' + (c && c.lp) + ' != ' + lp);
    if (n + 1 < PP.ELP.MIN_RUNS && c.placed) e.push('placed before the last placement run');
    n++; id++;
  }
  if (!sawR1 || !sawR2) e.push('the plan did not reach R1 / R2 (' + sawR1 + ' / ' + sawR2 + ')');
  // the receipts: one per run, newest first, the seed run SEEDED
  const c = C(st, p), ring = (c && c.ring) || [];
  if (ring.length !== Math.min(SOLO_PLAN.length, PP.RECEIPT_CAP || 8)) e.push('receipts ' + ring.length);
  // the row: v3, the level states as the entry holds them
  const sc = m.ratingScoreOf(st, p, 0, T0 + 9e6), row = sc ? PP.elpRowOf(sc.details) : null;
  if (!row || ((sc.details[0] >>> 8) & 0xff) !== 3 || J(row.lv.solo) !== J(c.lv.solo) || row.lv.duo !== null) e.push('row v3 ' + J(row && row.lv));
  if (out) Object.assign(out, { st, p, x, lp });
  return e;
}

// ---- [3] a version 6 player, then his first version 7 run ----
function sV6(m) {
  const e = [], st = { hist: {} }, p = P(m, 3), depths = [8, 10, 12];
  depths.forEach((dd, i) => m.ratingHistUpsert(st, p, 'solo', 0, 200 + i, dd, T0 + i * MIN, F, 7000 + i));
  m.elpSettleAll(st, 0, T0 + 10 * MIN);
  const c = C(st, p);
  if (!c || !c.placed) e.push('the version 6 placement did not seed');
  if (c && c.lv) e.push('a version 6 run gave a level');
  for (let i = 0; i < 3; i++) { const r = runOf(st, p, 'solo', 200 + i); if (!r || r[10] != null || r[11] != null) e.push('version 6 run ' + i + ' carries states'); }
  const seed6 = PP.endlessSeedLp(PP.elpSeedHidden(depths.slice().reverse().map((dd) => ['solo', dd]), LINES), LINES.solo);
  if (c && (c.lp | 0) !== seed6) e.push('version 6 seed ' + (c && c.lp) + ' != ' + seed6);
  // his first version 7 run: the level starts from the version 6 reading of the runs before it (placed: the trimmed reading)
  const H6 = PP.elpHiddenFor('solo', depths.slice().reverse().map((dd) => ['solo', dd]), LINES);
  const x0 = PP.elpLevelInit(H6, LINES.solo), seed = 7100, Tt = PP.elpTargetOfL(x0.L, seed);
  m.ratingHistUpsert(st, p, 'solo', 0, 210, Tt, T0 + 20 * MIN, F, seed, { v7: true, quit: false });
  m.elpSettleAll(st, 0, T0 + 21 * MIN);
  const r = runOf(st, p, 'solo', 210);
  if (!r || J(r[10]) !== J(arr(x0, -1)) || (r[5] | 0) !== Tt) e.push('first version 7 run: ' + J(r && [r[5], r[10]]) + ' != ' + J([Tt, arr(x0, -1)]));
  return e;
}

// ---- [4] team: the highest level, each his own step ----
function sTeam(m, out) {
  const e = [], st = { hist: {} }, A = P(m, 4), B = P(m, 5), RID = 900, seed = 7777;
  [[A, [20, 22, 24]], [B, [4, 5, 6]]].forEach(([q, ds], k) => ds.forEach((dd, i) => m.ratingHistUpsert(st, q, 'solo', 0, 300 + 10 * k + i, dd, T0 + i * MIN, F, 8000 + 10 * k + i)));
  m.elpSettleAll(st, 0, T0 + 10 * MIN);
  const at = T0 + 20 * MIN;
  const lvOf = (ds) => PP.elpLevelInit(PP.elpHiddenFor('duo', ds.slice().reverse().map((dd) => ['solo', dd]), LINES, 1), LINES.duo);
  const xA = lvOf([20, 22, 24]), xB = lvOf([4, 5, 6]), line = Math.max(xA.L, xB.L), Tt = PP.elpTargetOfL(line, seed);
  m.elpTeamNote(st, RID, [A, B], 'duo', 0, at);
  for (const q of [A, B]) m.ratingHistUpsert(st, q, 'duo', 0, RID, Tt, at, F, seed, { v7: true, quit: false });
  m.elpSettleAll(st, 0, at + MIN);
  const rA = runOf(st, A, 'duo', RID), rB = runOf(st, B, 'duo', RID), tm = st.elpTeam && st.elpTeam[String(RID)];
  if (!tm || tm.lvL !== line) e.push('team line ' + (tm && tm.lvL) + ' != the highest ' + line + ' (' + xA.L + ' / ' + xB.L + ')');
  if (!rA || !rB || (rA[5] | 0) !== Tt || (rB[5] | 0) !== Tt) e.push('targets ' + J([rA && rA[5], rB && rB[5]]) + ' != ' + Tt);
  const sA = PP.elpLevelStep(xA, { pass: true, depth: Tt, T: Tt, placing: -1 }), sB = PP.elpLevelStep(xB, { pass: true, depth: Tt, T: Tt, placing: -1 });
  if (J(C(st, A).lv && C(st, A).lv.duo) !== J(sA) || J(C(st, B).lv && C(st, B).lv.duo) !== J(sB)) e.push('own steps ' + J([C(st, A).lv, C(st, B).lv]) + ' != ' + J([sA, sB]));
  if (out) Object.assign(out, { xA, xB, line });
  return e;
}

// ---- [5] the cutover ----
function sCut(m) {
  const e = [], st = { hist: {} }, p6 = P(m, 6), p7 = P(m, 7), t = T0 + 50 * MIN, keep = m.RATING.CUTOVER_MS;
  try {
    m.RATING.CUTOVER_MS = 0;
    m.ratingHistUpsert(st, p6, 'solo', 0, 400, 7, t, SUS, 9000);                                   // a version 6 run parked at a save point
    m.ratingHistUpsert(st, p7, 'solo', 0, 401, 7, t, SUS, 9001, { v7: true, quit: false });       // a version 7 run parked
    const p8 = P(m, 11);
    m.ratingHistUpsert(st, p8, 'solo', 0, 402, 10, t + 1500, 0, 9002);                                // a version 6 run still being played (a checkpoint segment, seconds old, not parked)
    m.elpSettleAll(st, 0, t + 1000);
    if (runOf(st, p6, 'solo', 400)[3] || runOf(st, p7, 'solo', 401)[3]) e.push('a parked run settled before the cutover');
    m.RATING.CUTOVER_MS = t + 500;
    m.elpSettleAll(st, 0, t + 2000);
    const r6 = runOf(st, p6, 'solo', 400), r7 = runOf(st, p7, 'solo', 401);
    if (!r6[3]) e.push('the parked version 6 run did not settle at the cutover');
    if (r6[3] && (r6[1] | 0) !== 7) e.push('it settled at ' + r6[1] + ', not its save depth 7');
    if (r7[3]) e.push('a parked version 7 run was force-settled');
    const r8 = runOf(st, p8, 'solo', 402);
    if (r8[3]) e.push('an open version 6 run still being played was cut (it may still pass: it must wait for its own end)');
  } finally { m.RATING.CUTOVER_MS = keep; }
  return e;
}

// ---- [6] a conviction replays the level ----
function sReplay(m) {
  const e = [], o = {};
  const e0 = sSolo(m, o);
  if (e0.length) return ['the solo world: ' + e0[0]];
  const { st, p } = o, h = H(st, p), v7runs = h.runs.filter((r) => r[3] && ((r[7] | 0) & m.ELP_R_V7));
  // take out the second-to-last version 7 points run (a pass); the last one is replayed from the state before the removed one
  const gone = v7runs[v7runs.length - 2], last = v7runs[v7runs.length - 1], lastPts = last[4];
  const start = PP.elpLevelOf({ L: gone[10][0], Lm: gone[10][1], s: gone[10][2], last: gone[10][3], run: gone[10][4] });
  const exp = PP.elpLevelStep(start, { pass: (last[1] | 0) >= (last[5] | 0), depth: last[1] | 0, T: last[5] | 0, quit: !!((last[7] | 0) & m.ELP_R_QUIT), placing: -1 });
  m.ratingHistRemove(st, p, 'solo', 0, gone[0] >>> 0);
  const c = C(st, p);
  if (J(c.lv.solo) !== J(exp)) e.push('replayed level ' + J(c.lv.solo) + ' != ' + J(exp));
  if (J(last[10]) !== J(arr(start, -1))) e.push('the later run\'s before-state ' + J(last[10]) + ' != ' + J(arr(start, -1)));
  if (last[4] !== lastPts) e.push('the later run\'s points moved');
  return e;
}

// ---- [2b] the tiers read the SMOOTHED level: a placed gold player (2050, the relegation band) whose level dropped to the silver line
//   while his smoothed level still sits on the gold line misses -- read on Lm his skill tier is gold = his points tier: the demotion
//   protection holds (no forced drop); read on the jumpy L it is silver: forced down through the series clamp ----
function sTiers(m) {
  const e = [], st = { hist: {} }, p = P(m, 8), seed = 6100;
  const c = m.elpAllOf(st, p, 0, true);
  Object.assign(c, { placed: 1, lp: 2050, n: 5, seedRun: ['solo', 1], ring: [], lv: { solo: { L: 600, Lm: 1000, s: 3, last: 0, run: 1 } } });
  const x = c.lv.solo, Tt = PP.elpTargetOfL(x.L, seed), line = PP.elpLineOfL(x.L), off = PP.targetOffset(seed), depth = Math.max(0, Tt - 1);
  const want = PP.endlessSettleLv(2050, false, x.Lm, LINES.solo, off, 'solo', line), jumpy = PP.endlessSettleLv(2050, false, x.L, LINES.solo, off, 'solo', line);
  if (want.nv === jumpy.nv || !want.protect) e.push('the world does not tell Lm from L (' + want.nv + ' / ' + jumpy.nv + ', protect ' + want.protect + ')');
  m.ratingHistUpsert(st, p, 'solo', 0, 600, depth, T0, F, seed, { v7: true, quit: false });
  m.elpSettleAll(st, 0, T0 + 1000);
  const r = runOf(st, p, 'solo', 600);
  if (!r || r[3] !== 2 || (r[4] | 0) !== want.nv - 2050) e.push('points ' + (r && r[4]) + ' != ' + (want.nv - 2050) + ' (the jumpy level gives ' + (jumpy.nv - 2050) + ')');
  return e;
}

// ---- [7] tables ----
function sTables(m) {
  const e = [], key7 = J([7, 1500, 500, 100, 2, PP.ELP7.PRIOR, 0, 0, 1300, 110]), key6 = J([6, 1500, 500, 100, 2, PP.ELP.PRIOR, 0, 0, 1300, 110]);
  const X = [3, 7, 11, 17, 26, 36, 46];
  const st = { hist: {}, elpTab: [{ day: 20261201, season: 0, ms: T0, key: key7, byFam: { solo: { N: 30, pass: X } } }] };
  if (m.elpTabVer(st.elpTab[0]) !== 7 || m.elpTabVer({ key: key6 }) !== 6 || m.elpTabVer({ key: 'x' }) !== 6) e.push('elpTabVer');
  if (J(m.elpLinesAt(st, 'solo', 0, T0 + 1)) !== J(PP.ELP.PRIOR.solo)) e.push('a version 6 reading took a version 7 table');
  if (J(m.elpLinesAt(st, 'solo', 0, T0 + 1, Infinity)) !== J(X)) e.push('a version 7 reading missed the version 7 table');
  const keep = m.RATING.PUB_VER;
  try {
    m.RATING.PUB_VER = 6;
    if (m.tiercutEncode(0, {})[2] !== 6 || J(m.elpPriorPub()) !== J(PP.ELP.PRIOR) || !m.elpTableKey().startsWith('[6,')) e.push('published version 6');
    m.RATING.PUB_VER = 7;
    if (m.tiercutEncode(0, {})[2] !== 7 || J(m.elpPriorPub()) !== J(PP.ELP7.PRIOR) || !m.elpTableKey().startsWith('[7,') || J(m.tiercutEncode(0, {}).slice(8, 15)) !== J(PP.ELP7.PRIOR.solo)) e.push('published version 7');
  } finally { m.RATING.PUB_VER = keep; }
  return e;
}

// ---- [9] the live pass lines: version 6 published = the hidden skill (depth mean); version 7 = the smoothed level (Lm), a player with
//   no level yet = TARGET_Q of his hidden skill ----
function sLines(m) {
  const e = [], st = { hist: {} }, A = P(m, 9), B = P(m, 10), keep = m.RATING.PUB_VER;
  [[A, [10, 12, 14]], [B, [6, 7, 8]]].forEach(([q, ds], k) => ds.forEach((dd, i) => m.ratingHistUpsert(st, q, 'solo', 0, 700 + 10 * k + i, dd, T0 + i * MIN, F, 9500 + 10 * k + i)));
  m.elpSettleAll(st, 0, T0 + 10 * MIN);
  const cA = C(st, A); (cA.lv = cA.lv || {}).solo = { L: 1500, Lm: 1420, s: 3, last: 1, run: 1 };   // A holds a version 7 level
  const HA = PP.hiddenOf([14, 12, 10]), HB = PP.hiddenOf([8, 7, 6]);
  try {
    m.RATING.PUB_VER = 6;
    const v6 = m.elpHiddensOf(st, 'solo', 0);
    if (v6[A] !== HA || v6[B] !== HB) e.push('version 6 readings ' + J([v6[A], v6[B]]) + ' != ' + J([HA, HB]));
    m.RATING.PUB_VER = 7;
    const v7 = m.elpHiddensOf(st, 'solo', 0);
    if (v7[A] !== 1420 || v7[B] !== Math.round(HB * PP.ELP.TARGET_Q / 1000)) e.push('version 7 readings ' + J([v7[A], v7[B]]) + ' != ' + J([1420, Math.round(HB * PP.ELP.TARGET_Q / 1000)]));
  } finally { m.RATING.PUB_VER = keep; }
  return e;
}

const SCEN = [['[1] intake: the version bit stays, the quit bit only with the final segment, elpSegLv', sIntake],
  ['[2] solo: placement walks the level and seeds from it, points runs by endlessSettleLv + lambda, R1 / R2 leave the level, states / receipts / row v3', sSolo],
  ['[2b] the tiers read the smoothed level (here the demotion protection), not the jumpy one', sTiers],
  ['[3] a version 6 player settles as before (no level); his first version 7 run starts from the version 6 reading', sV6],
  ['[4] team: the roster\'s highest level is the target (frozen), every member steps his own level', sTeam],
  ['[5] the cutover settles a parked version 6 run at its save depth; never a version 7 one, never one still being played', sCut],
  ['[6] a conviction of a version 7 run replays the family\'s level from the state before it', sReplay],
  ['[7] tables: the version of a recorded table, version 6 readings skip version 7 tables, the published version / priors follow PUB_VER', sTables],
  ['[9] the live pass lines read the smoothed level once the published table is version 7 (the hidden skill under version 6)', sLines]];
console.log('-- O942 version 7: the job --');
for (const [label, fn] of SCEN) { const e = fn(v); T(label, e.length === 0, e.slice(0, 3).join(' | ')); }
{
  const o = {}; sTeam(v, o);
  T('[4] the world is a real test: the two members\' levels differ and the higher one sets the line', o.xA && o.xA.L !== o.xB.L && o.line === Math.max(o.xA.L, o.xB.L), J(o));
}

// ---- [8] mutations ----
function mutantOf(pairs) {
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
  let s = SRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); s = s.split(good).join(badS); }
  s = s.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-level-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, s);
  try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const MUTS = [
  ['a version 7 run settles by the version 6 rules (no dispatch)', [['  if ((r[7] | 0) & ELP_R_V7) return elpSettleRunLv(st, p, c, h, r, fam, s, nowMs, ctx);', '  if (false) return elpSettleRunLv(st, p, c, h, r, fam, s, nowMs, ctx);']], sSolo],
  ['the team line is the LOWEST level', [['tm.lvL = pointsPlan.elpTeamLine(tm.r.map(', 'tm.lvL = Math.min.apply(null, tm.r.map(']], sTeam],
  ['every member takes the team line (the ratchet)', [['const after = pointsPlan.elpLevelStep(pick.x, { pass, depth, T, quit, placing });', 'const after = pointsPlan.elpLevelStep(teamL !== undefined ? Object.assign({}, pick.x, { L: teamL }) : pick.x, { pass, depth, T, quit, placing });']], sTeam],
  ['the cutover never comes', [['const cut = RATING.CUTOVER_MS > 0 && nowMs != null', 'const cut = false && nowMs != null']], sCut],
  ['the cutover also cuts runs still being played (no parked check)', [[' && !((r[7] | 0) & ELP_R_V7) && !!((r[7] | 0) & 2);', ' && !((r[7] | 0) & ELP_R_V7);']], sCut],
  ['a conviction does not replay the level', [['  if (lvGone && c) elpLevelReplay(c, h, fam, lvGone);', '  if (false) elpLevelReplay(c, h, fam, lvGone);']], sReplay],
  ['a later segment drops the version bit', [['| ((r[7] | 0) & (ELP_R_V7 | ELP_R_QUIT)) |', '| ((r[7] | 0) & ELP_R_QUIT) |']], sIntake],
  ['a version 6 reading takes version 7 tables', [['const mv = maxVer == null ? 6 : maxVer;', 'const mv = maxVer == null ? Infinity : maxVer;']], sTables],
  ['the placement seeds from the level BEFORE the last placement run', [['const lp = Math.max.apply(null, tabs.map((tb) => pointsPlan.elpLevelSeed(after.L, tb[fam], tb.solo)));', 'const lp = Math.max.apply(null, tabs.map((tb) => pointsPlan.elpLevelSeed(pick.x.L, tb[fam], tb.solo)));']], sSolo],
  ['a points run reads the jumpy level for its tiers (not Lm)', [['sl = pointsPlan.endlessSettleLv(cur, depth >= t, x.Lm, tb[fam], off, fam, pointsPlan.elpLineOfL(L));', 'sl = pointsPlan.endlessSettleLv(cur, depth >= t, x.L, tb[fam], off, fam, pointsPlan.elpLineOfL(L));']], sTiers],
  ['the row stays v2 (no level states)', [['placed: 1, h, lv: c.lv || null }, c.ring || []);', 'placed: 1, h }, c.ring || []);']], sSolo],
  ['the version 7 lines keep reading the depth mean', [['    if (RATING.PUB_VER >= 7) {\n      const c = elpAllOf(st, p, seasonId)', '    if (false) {\n      const c = elpAllOf(st, p, seasonId)']], sLines],
];
console.log('-- [8] mutations --');
for (const [label, pairs, fn] of MUTS) {
  let red = false, why = '';
  try { const e = fn(mutantOf(pairs)); red = e.length > 0; why = e[0] || ''; }
  catch (err) { if (/anchor missing/.test(err.message)) { bad('[8] ' + label + ': ' + err.message); continue; } red = true; why = 'threw: ' + err.message.slice(0, 80); }
  T('[8] mutation "' + label + '" turns its check red', red, why);
}
console.log(failN ? 'FAIL (endless-level) ' + failN : 'endless-level: all ok');
process.exit(failN ? 1 : 0);
