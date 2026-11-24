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
//   [16] Q432 (2026-11-22, P0): a 0.6.1 client never read its row back; the job carries every reading a run kept (c.lvs / r[12]),
//        so no run that client ended at its own line is judged a miss over four runs back to back
//   [17] Q432 lift: the one-time re-read of runs the old job (the lowest reading only) judged misses at a line-end: passed, the
//        difference added, nothing taken, a death / quit / a death the depth rules a reading out for stays, once only
//   [18] O992 (2026-11-23): the host may start before a member's hello reached him; a team line without the member who sets the
//        floor is a line too (a pass there passes every seat, a death under it stays a miss)
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
  if (J(a) !== J({ v7: true, quit: true, v8: false }) || J(b) !== J({ v7: true, quit: false, v8: false }) || J(c) !== J({ v7: false, quit: false, v8: false })) e.push('elpSegLv ' + J([a, b, c]));   // O991: + v8 (test/endless-level8.js)
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
    if (J(r[10].slice(0, 6)) !== J(arr(before, placing)) || (r[10][6] | 0) !== Tt || J(r[11]) !== J(arr(x, placing))) e.push('run ' + id + ' states ' + J([r[10], r[11]]) + ' != ' + J([arr(before, placing).concat([Tt]), arr(x, placing)]));
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
  if (!r || J(r[10].slice(0, 6)) !== J(arr(x0, -1)) || (r[5] | 0) !== Tt) e.push('first version 7 run: ' + J(r && [r[5], r[10]]) + ' != ' + J([Tt, arr(x0, -1)]));
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
  // one state each: the highest (every member counted) and, since O992, the other member's alone (the higher one's hello may not
  //   have reached the host before he started)
  const low = Math.min(xA.L, xB.L), wantLns = [PP.elpLineOfL(line)].concat(PP.elpLineOfL(low) !== PP.elpLineOfL(line) ? [PP.elpLineOfL(low)] : []);
  if (!tm || J(tm.lvLns) !== J(wantLns)) e.push('team lines ' + J(tm && tm.lvLns) + ' != ' + J(wantLns) + ' (one state each: the highest, and the other member\'s alone)');
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
  if (J(last[10].slice(0, 6)) !== J(arr(start, -1))) e.push('the later run\'s before-state ' + J(last[10]) + ' != ' + J(arr(start, -1)));
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

// ---- [10] real intake (second opinion 11-21 night: no record had gone through intake as version 7) ----
//   solo: a record signed by a key whose table entry says elp 7 -> verifySoloRecord gives elp 7 -> elpSegLv sets the version bit; a key
//   without it -> 6; the dev key (unsealed) -> ELP_DEV_VER (default 6). team: COMP | LINE segments pass sanity at 2..4 seats, including
//   the shape that never existed before -- a run that ENDS on a pass exactly at a checkpoint depth ([5..10] final) -- and a save
//   segment; LINE with classic, or an unknown bit, does not
const _crypto = require('crypto');
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
function kp(seedHex) { const priv = _crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' }); return { priv, pub: _crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex') }; }
function soloRec(keyId, k, o) {
  const sid = BigInt('76561198000000001');
  const base = [0xB1, 3, 7, attest.hash32('m-o942'), 5, 0, 1, 0, 1, 900, 4000, o.disp | 0, Number(sid & 0xFFFFFFFFn) | 0, Number((sid >> 32n) & 0xFFFFFFFFn) | 0,
    o.start | 0, o.end | 0, 0, 0, 0, o.flags | 0, keyId | 0, 3, 0, 0, 0];
  const sig = _crypto.sign(null, attest.toBytes(base), k.priv), d = base.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function mkTeam(writer, seat, o) {
  const pc = o.pc, d = [0xB1, 3, 7, 222, 9, seat, 0, 0, pc, 1200];
  for (let i = 0; i < pc; i++) d.push(3000 + 100 * i);
  d.push(o.disp | 0);
  const sids = ['76561198000000001', '76561198000000002', '76561198000000003', '76561198000000004'].slice(0, pc);
  for (const x of sids) { const b = BigInt(x); d.push(Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0); }
  d.push(o.start | 0, o.end | 0, 0, 0, 1, o.flags | 0, 0, 0, 0, 0, 0);
  return { steamID: writer, d, roster: v.decodeRoster(d), dispCode: o.disp | 0 };
}
function sIntakeReal(m) {
  const e = [], k7 = kp('e'.repeat(64)), k6 = kp('f'.repeat(64)), kd = kp('1'.repeat(64));
  const TABLE = { 2026120101: { pubs: [k7.pub], sealed: true, pubInfo: { [k7.pub]: { ch: 'ea', elp: 7 } } }, 2026112102: { pubs: [k6.pub], sealed: true, pubInfo: { [k6.pub]: { ch: 'ea' } } }, dev: { pubs: [kd.pub], sealed: false } };
  const keep = process.env.ELP_DEV_VER;
  try {
    const a = attest.verifySoloRecord(soloRec(2026120101, k7, { start: 5, end: 10, flags: F, disp: 5 }), TABLE);
    const lvA = m.elpSegLv(a, a.fields);
    if (!a.ok || a.elp !== 7 || !lvA.v7 || !lvA.quit) e.push('elp-7 key: ' + J([a.ok, a.reason, a.elp, lvA]));
    const b = attest.verifySoloRecord(soloRec(2026112102, k6, { start: 0, end: 5, flags: 0, disp: 0 }), TABLE);
    if (!b.ok || b.elp !== 6 || m.elpSegLv(b, b.fields).v7) e.push('old key: ' + J([b.ok, b.reason, b.elp]));
    delete process.env.ELP_DEV_VER;
    const c = attest.verifySoloRecord(soloRec(0, kd, { start: 0, end: 5, flags: 0, disp: 0 }), TABLE);
    process.env.ELP_DEV_VER = '7';
    const c7 = attest.verifySoloRecord(soloRec(0, kd, { start: 0, end: 5, flags: 0, disp: 0 }), TABLE);
    if (!c.ok || c.elp !== 6 || !c7.ok || c7.elp !== 7) e.push('dev key: ' + J([c.ok, c.elp, c7.ok, c7.elp]));
  } finally { if (keep == null) delete process.env.ELP_DEV_VER; else process.env.ELP_DEV_VER = keep; }
  const COMP = attest.SEG_COMP, LINE = attest.SEG_LINE, FIN = attest.SEG_FINAL;
  for (const pc of [2, 3, 4]) {
    const g = (o) => [mkTeam('76561198000000001', 0, Object.assign({ pc }, o)), mkTeam('76561198000000002', 1, Object.assign({ pc }, o))];
    const okSeg = m.sanityFlags(g({ start: 5, end: 10, flags: COMP | LINE | FIN }));
    if (okSeg.length) e.push(pc + ' seats: a version 7 run ending on a pass at a checkpoint depth [5..10] final: ' + J(okSeg));
    const save = m.sanityFlags(g({ start: 10, end: 13, flags: COMP | LINE | attest.SEG_SUSPENDED }));
    if (save.length) e.push(pc + ' seats: a version 7 save segment: ' + J(save));
    const mid = m.sanityFlags(g({ start: 0, end: 5, flags: COMP | LINE }));
    if (mid.length) e.push(pc + ' seats: a version 7 checkpoint segment: ' + J(mid));
    if (m.sanityFlags(g({ start: 0, end: 5, flags: attest.SEG_CLASSIC | LINE })).indexOf('flags') < 0) e.push(pc + ' seats: LINE with classic passed');
    if (m.sanityFlags(g({ start: 0, end: 5, flags: COMP | 256 })).indexOf('flags') < 0) e.push(pc + ' seats: an unknown bit passed');
  }
  return e;
}

// ---- [11]..[15] (second opinion 2026-11-21 night): the readings of a level that may differ from his client's ----
// a placed version 6 player of family fam with these depths (solo runs), settled; then his row is made to carry skill rowH for fam
//   (the skill his client reads off the row: computed another day, under another table) -- the job's own reading of the same runs
//   stays the trimmed mean. Returns { st, p, own: the job's own start, row: the row's start }.
const FAMI = (fam) => PP.ELP_FAMS.indexOf(fam);
function placedWith(m, n, fam, depths, rowH, t0) {
  const st = { hist: {} }, p = P(m, n);
  depths.forEach((dd, i) => m.ratingHistUpsert(st, p, 'solo', 0, 9000 + 100 * n + i, dd, t0 + i * MIN, F, 6000 + 100 * n + i));
  m.elpSettleAll(st, 0, t0 + 10 * MIN);
  const c = C(st, p);
  const runs = depths.slice().reverse().map((dd) => ['solo', dd]);
  const own = PP.elpLevelInit(PP.elpHiddenFor(fam, runs, LINES), LINES[fam]);
  if (rowH != null) c.h[FAMI(fam)] = rowH;
  return { st, p, c, own, row: rowH == null ? null : PP.elpLevelInit(rowH, LINES[fam]) };
}
function placedInto(m, st, n, depths, rowH, fam, t0) {
  const p = P(m, n);
  depths.forEach((dd, i) => m.ratingHistUpsert(st, p, 'solo', 0, 9000 + 100 * n + i, dd, t0 + i * MIN, F, 6000 + 100 * n + i));
  return { p, rowH, fam };
}
const outcomesOf = (Tc) => [{ pass: true, d: Tc }].concat([...new Set([0, 1, Tc >> 1, Tc - 2, Tc - 1])].filter((d) => d >= 0 && d < Tc).map((d) => ({ pass: false, d })), [{ pass: false, d: Tc >> 1, quit: true }]);

// [11] solo: his first version 7 run with two readings (the job's own and the row's); his client started from either. Every outcome
//   of that run, then a run back to back that his client shows passed at its own next target: the job never judges a miss (on
//   either run), and the depth rules out a reading below it (a death under his client's target is not turned into a pass by it)
function sCarry(m) {
  const e = [];
  const t0 = T0 + 2000 * MIN, seed1 = 7301, seed2 = 7302;
  for (const rowH of [700, 900, 1000, 1400, 1700]) for (const truthRow of [false, true]) {
    const base = placedWith(m, 31, 'solo', [10, 12, 14], rowH, t0);
    const xc0 = truthRow ? base.row : base.own, Tc1 = PP.elpTargetOfL(xc0.L, seed1);
    for (const o of outcomesOf(Tc1)) {
      const w = placedWith(m, 31, 'solo', [10, 12, 14], rowH, t0), at1 = t0 + 20 * MIN, quit = !!o.quit;
      m.ratingHistUpsert(w.st, w.p, 'solo', 0, 501, o.d, at1, F, seed1, { v7: true, quit });
      m.elpSettleAll(w.st, 0, at1 + 1000);
      const r1 = runOf(w.st, w.p, 'solo', 501);
      if (!r1 || r1[3] !== 2) { e.push('run 1 did not settle'); continue; }
      const tag = 'row ' + rowH + (truthRow ? ' (his client read the row)' : ' (his client read the job\'s own)') + ', run 1 ' + (o.pass ? 'pass' : (quit ? 'quit' : 'death')) + '@' + o.d;
      if (o.pass && (r1[5] | 0) > o.d) e.push(tag + ': run 1 his pass judged a miss (T ' + r1[5] + ')');
      const xo = PP.elpTargetOfL(base.own.L, seed1), xr = PP.elpTargetOfL(base.row.L, seed1);
      if (!o.pass && (r1[5] | 0) <= o.d && !(xo === o.d || xr === o.d)) e.push(tag + ': a reading the depth rules out turned his miss into a pass (T ' + r1[5] + ')');
      // his client goes on from its own state, without the row coming back; the next run passes at the target his client shows
      const xc1 = PP.elpLevelStep(xc0, { pass: o.pass, depth: o.d, T: Tc1, quit, placing: -1 }), Tc2 = PP.elpTargetOfL(xc1.L, seed2), at2 = at1 + 30 * MIN;
      m.ratingHistUpsert(w.st, w.p, 'solo', 0, 502, Tc2, at2, F, seed2, { v7: true, quit: false });
      m.elpSettleAll(w.st, 0, at2 + 1000);
      const r2 = runOf(w.st, w.p, 'solo', 502);
      if (!r2 || r2[3] !== 2) { e.push(tag + ': run 2 did not settle'); continue; }
      if ((r2[5] | 0) > Tc2) e.push(tag + ': run 2, his pass at ' + Tc2 + ' judged against ' + r2[5]);
    }
  }
  return e;
}

// [12] team: one member read above what his client sent must not lift the whole team's target. P's level reads line ~10 (one
//   reading); Q's first version 7 duo run: the job's own reading of his runs reads line ~14, his row (his client) ~8. The host took
//   the highest of what was sent (P's) and the run ended there: a pass for every seat
function sTeamOver(m) {
  const e = [], st = { hist: {} }, t0 = T0 + 3000 * MIN, RID = 950, seed = 7401;
  const Pp = placedInto(m, st, 41, [9, 10, 11], null, 'duo', t0), Qp = placedInto(m, st, 42, [13, 14, 15], 800, 'duo', t0);
  m.elpSettleAll(st, 0, t0 + 10 * MIN);
  C(st, Qp.p).h[FAMI('duo')] = 800;   // his row carries a lower duo skill (his client reads it)
  const lv = (ds) => PP.elpLevelInit(PP.elpHiddenFor('duo', ds.slice().reverse().map((dd) => ['solo', dd]), LINES, 1), LINES.duo);
  const xP = lv([9, 10, 11]), xQ = lv([13, 14, 15]), xQr = PP.elpLevelInit(800, LINES.duo);
  const host = Math.max(xP.L, xQr.L), Th = PP.elpTargetOfL(host, seed), at = t0 + 20 * MIN;
  if (!(xQ.L > xP.L && xP.L > xQr.L) || PP.elpTargetOfL(xQ.L, seed) <= Th) return ['the world is not a real test: ' + J([xP.L, xQ.L, xQr.L])];
  m.elpTeamNote(st, RID, [Pp.p, Qp.p], 'duo', 0, at);
  for (const q of [Pp.p, Qp.p]) m.ratingHistUpsert(st, q, 'duo', 0, RID, Th, at, F, seed, { v7: true, quit: false });
  m.elpSettleAll(st, 0, at + MIN);
  for (const q of [Pp.p, Qp.p]) { const r = runOf(st, q, 'duo', RID); if (!r || r[3] !== 2 || (r[5] | 0) > Th) e.push('seat ' + q.slice(-4) + ': the team\'s pass at ' + Th + ' judged against ' + (r && r[5])); }
  return e;
}

// [12b] the team version of [11]: Q's first version 7 duo run read two ways (his client: the row's lower skill); every outcome of
//   that run, then the next run back to back (no row read back): each member's client goes on from its own state with the host's
//   verdict, the host takes the highest of those for the next line and the run passes there -- no seat judged a miss on either run
function sTeamBack(m) {
  const e = [], t0 = T0 + 6000 * MIN, seeds = [7701, 7702], R1 = 970, R2 = 971;
  const lv = (ds) => PP.elpLevelInit(PP.elpHiddenFor('duo', ds.slice().reverse().map((dd) => ['solo', dd]), LINES, 1), LINES.duo);
  for (const rowH of [700, 800, 900]) {
    const xP = lv([9, 10, 11]), xQr = PP.elpLevelInit(rowH, LINES.duo), Th1 = PP.elpTargetOfL(Math.max(xP.L, xQr.L), seeds[0]);
    for (const o of outcomesOf(Th1).filter((x) => !x.quit)) {
      const st = { hist: {} };
      const Pp = placedInto(m, st, 46, [9, 10, 11], null, 'duo', t0), Qp = placedInto(m, st, 47, [13, 14, 15], rowH, 'duo', t0);
      m.elpSettleAll(st, 0, t0 + 10 * MIN);
      C(st, Qp.p).h[FAMI('duo')] = rowH;   // his row carries a lower duo skill (his client reads it)
      const at1 = t0 + 20 * MIN, at2 = t0 + 50 * MIN, pass1 = o.d >= Th1;
      m.elpTeamNote(st, R1, [Pp.p, Qp.p], 'duo', 0, at1);
      for (const q of [Pp.p, Qp.p]) m.ratingHistUpsert(st, q, 'duo', 0, R1, o.d, at1, F, seeds[0], { v7: true, quit: false });
      m.elpSettleAll(st, 0, at1 + MIN);
      const cP = PP.elpLevelStep(xP, { pass: pass1, depth: o.d, T: Th1, placing: -1 }), cQ = PP.elpLevelStep(xQr, { pass: pass1, depth: o.d, T: Th1, placing: -1 });
      const Th2 = PP.elpTargetOfL(Math.max(cP.L, cQ.L), seeds[1]);
      m.elpTeamNote(st, R2, [Pp.p, Qp.p], 'duo', 0, at2);
      for (const q of [Pp.p, Qp.p]) m.ratingHistUpsert(st, q, 'duo', 0, R2, Th2, at2, F, seeds[1], { v7: true, quit: false });
      m.elpSettleAll(st, 0, at2 + MIN);
      const tag = 'row ' + rowH + ', run 1 ' + (pass1 ? 'pass' : 'death') + '@' + o.d;
      for (const q of [Pp.p, Qp.p]) {
        const r1 = runOf(st, q, 'duo', R1), r2 = runOf(st, q, 'duo', R2);
        if (!r1 || r1[3] !== 2 || !r2 || r2[3] !== 2) { e.push(tag + ': seat ' + q.slice(-4) + ' did not settle'); continue; }
        if (pass1 && (r1[5] | 0) > o.d) e.push(tag + ': seat ' + q.slice(-4) + ' run 1, the team\'s pass judged against ' + r1[5]);
        if ((r2[5] | 0) > Th2) e.push(tag + ': seat ' + q.slice(-4) + ' run 2, the team\'s pass at ' + Th2 + ' judged against ' + r2[5]);
      }
    }
  }
  return e;
}

// [13] one pass or two: P and Q play two duo runs back to back; the first a miss that lowers Q (the higher of the two). Settled in
//   one pass or in two, the second run reads the same lines and every seat ends the same
function sTwoPasses(m) {
  const e = [], t0 = T0 + 4000 * MIN, seeds = [7501, 7502], R1 = 960, R2 = 961;
  const world = () => {
    const st = { hist: {} }, A = placedInto(m, st, 43, [8, 9, 10], null, 'duo', t0).p, B = placedInto(m, st, 44, [14, 15, 16], null, 'duo', t0).p;
    m.elpSettleAll(st, 0, t0 + 10 * MIN);
    return { st, A, B };
  };
  const play = (w, k, depth, at) => { m.elpTeamNote(w.st, k ? R2 : R1, [w.A, w.B], 'duo', 0, at); for (const q of [w.A, w.B]) m.ratingHistUpsert(w.st, q, 'duo', 0, k ? R2 : R1, depth, at, F, seeds[k], { v7: true, quit: false }); };
  const a1 = t0 + 20 * MIN, a2 = t0 + 40 * MIN, d1 = 3, d2 = 6;
  const one = world(); play(one, 0, d1, a1); play(one, 1, d2, a2); m.elpSettleAll(one.st, 0, a2 + MIN);
  const two = world(); play(two, 0, d1, a1); m.elpSettleAll(two.st, 0, a1 + MIN); play(two, 1, d2, a2); m.elpSettleAll(two.st, 0, a2 + MIN);
  const view = (w) => J({ tm: (({ lvL, lvLns }) => ({ lvL, lvLns }))(w.st.elpTeam[String(R2)] || {}), a: (runOf(w.st, w.A, 'duo', R2) || []).slice(3, 6).concat([(runOf(w.st, w.A, 'duo', R2) || [])[11]]), b: (runOf(w.st, w.B, 'duo', R2) || []).slice(3, 6).concat([(runOf(w.st, w.B, 'duo', R2) || [])[11]]), la: C(w.st, w.A).lv, lb: C(w.st, w.B).lv });
  const r1B = runOf(two.st, two.B, 'duo', R1);
  if (!r1B || !Array.isArray(r1B[10]) || !(r1B[11][0] < r1B[10][0])) e.push('the world is not a real test: the first run did not lower Q ' + J(r1B && [r1B[10], r1B[11]]));
  if (view(one) !== view(two)) e.push('one pass ' + view(one) + ' != two passes ' + view(two));
  return e;
}

// [14] a run that stood parked (save point) is judged with every reading: its client may have read its target again on resume
//   (the remembered target is kept on that machine only) -- here the row's lower one after a save past it; it passed there
function sResumed(m) {
  const e = [], t0 = T0 + 5000 * MIN, seed = 7601;
  const w = placedWith(m, 45, 'solo', [10, 12, 14], 700, t0);
  const Tr = PP.elpTargetOfL(w.row.L, seed), To = PP.elpTargetOfL(w.own.L, seed), at = t0 + 20 * MIN;
  if (!(Tr + 2 < To)) return ['the world is not a real test: ' + J([Tr, To])];
  m.ratingHistUpsert(w.st, w.p, 'solo', 0, 601, Tr + 1, at, SUS, seed, { v7: true, quit: false });   // saved past the row's target
  m.ratingHistUpsert(w.st, w.p, 'solo', 0, 601, Tr + 2, at + 30 * MIN, F, seed);                      // resumed: the line ends it at the next pass
  m.elpSettleAll(w.st, 0, at + 31 * MIN);
  const r = runOf(w.st, w.p, 'solo', 601);
  if (!r || r[3] !== 2 || !Array.isArray(r[9]) || (r[5] | 0) > Tr + 2) e.push('the resumed pass at ' + (Tr + 2) + ' judged against ' + (r && r[5]) + ' (own ' + To + ', row ' + Tr + ')');
  return e;
}

// [15] a conviction's replay steps each later run with the target its CARRIED step read (r[10][6]), which may differ from the one
//   its points came from (r[5]): here one says pass, the other miss
function sReplayCarry(m) {
  const e = [], o = {};
  const e0 = sSolo(m, o);
  if (e0.length) return ['the solo world: ' + e0[0]];
  const { st, p } = o, h = H(st, p), v7runs = h.runs.filter((r) => r[3] && ((r[7] | 0) & m.ELP_R_V7));
  const gone = v7runs[v7runs.length - 2], last = v7runs[v7runs.length - 1];
  if (!((last[1] | 0) >= (last[5] | 0))) return ['the world is not a real test: the last run is not a pass'];
  last[10][6] = (last[1] | 0) + 2;   // its carried step read a target above its depth: a miss
  const start = PP.elpLevelOf({ L: gone[10][0], Lm: gone[10][1], s: gone[10][2], last: gone[10][3], run: gone[10][4] });
  const exp = PP.elpLevelStep(start, { pass: false, depth: last[1] | 0, T: last[10][6], quit: !!((last[7] | 0) & m.ELP_R_QUIT), placing: -1 });
  m.ratingHistRemove(st, p, 'solo', 0, gone[0] >>> 0);
  if (J(C(st, p).lv.solo) !== J(exp)) e.push('replayed ' + J(C(st, p).lv.solo) + ' != ' + J(exp) + ' (stepped with the carried target)');
  if ((last[10][6] | 0) !== (last[1] | 0) + 2) e.push('the replay lost the carried target ' + J(last[10]));
  return e;
}

// [16] Q432: a 0.6.1 client never reads its row back -- its level walks its own chain from its own start (the job's own reading or the
//   row's). Four runs, every start and run-1 outcome, then each of the next three runs a pass at the target HIS CLIENT shows, a death
//   one short of it, or a death three short: no run his client ended at its line is judged a miss (the P0: the screen said "target
//   reached"); deaths judged passes (the set's price, in his favour) stay under 10 %. Carrying only the lowest reading (rule (c)
//   alone) fails it: the chains cross after a death between the two targets
// O1015 (2026-11-24): the restart readings (elpRestartReads: a relaunched 0.6.1-0.6.3 client's start, verdict only) are switched off in
//   [16] / [17] -- the job past the version 8 gate (PUB_VER 8, its cutover before these worlds) -- so they keep checking the Q432 set /
//   lift ALONE: a client here that never reads its row walks the job's own chain, which the restart readings would read too and mask.
//   Those readings have their own checks (test/elp-restart-start.js); with them on, deaths judged passes here rise to about 13 % (the
//   chance cost the user accepted for O1015).
function restartOff(m) {
  const R = m.RATING, keep = { pub: R.PUB_VER, cut: R.CUTOVER_MS };
  R.PUB_VER = 8; R.CUTOVER_MS = 1;
  return () => { R.PUB_VER = keep.pub; R.CUTOVER_MS = keep.cut; };
}
function sCarryLong(m, out) { const undo = restartOff(m); try { return sCarryLongOn(m, out); } finally { undo(); } }
function sCarryLongOn(m, out) {
  const e = [], t0 = T0 + 7000 * MIN, seeds = [7801, 7802, 7803, 7804];
  let deaths = 0, lenient = 0;
  const nexts = (Tc) => [{ pass: true, d: Tc }, { pass: false, d: Math.max(0, Tc - 1) }, { pass: false, d: Math.max(0, Tc - 3) }];
  for (const rowH of [700, 1400]) for (const truthRow of [false, true]) {
    const base = placedWith(m, 32, 'solo', [10, 12, 14], rowH, t0), xc0 = truthRow ? base.row : base.own, Tc1 = PP.elpTargetOfL(xc0.L, seeds[0]);
    const o1s = outcomesOf(Tc1).filter((x) => !x.quit).slice(0, 4);
    for (const o1 of o1s) for (const o2i of [0, 1, 2]) for (const o3i of [0, 1, 2]) for (const o4i of [0, 1, 2]) {
      const w = placedWith(m, 32, 'solo', [10, 12, 14], rowH, t0);
      let xc = xc0, T = Tc1, o = o1;
      const tag = 'row ' + rowH + (truthRow ? ' (client: row)' : ' (client: job\'s own)') + ' ' + [o1, o2i, o3i, o4i].map((x) => (typeof x === 'object' ? (x.pass ? 'p' : 'd' + x.d) : x)).join('/');
      for (let k = 0; k < 4; k++) {
        if (k > 0) { T = PP.elpTargetOfL(xc.L, seeds[k]); o = nexts(T)[[o2i, o3i, o4i][k - 1]]; }
        const at = t0 + (20 + 30 * k) * MIN, rid = 801 + k;
        m.ratingHistUpsert(w.st, w.p, 'solo', 0, rid, o.d, at, F, seeds[k], { v7: true, quit: false });
        m.elpSettleAll(w.st, 0, at + 1000);
        const r = runOf(w.st, w.p, 'solo', rid);
        if (!r || r[3] !== 2) { e.push(tag + ': run ' + (k + 1) + ' did not settle'); break; }
        if (o.pass && (r[5] | 0) > o.d) e.push(tag + ': run ' + (k + 1) + ', his client ended at its line ' + o.d + ', judged against ' + r[5]);
        if (!o.pass) { deaths++; if ((r[5] | 0) <= o.d) lenient++; }
        xc = PP.elpLevelStep(xc, { pass: o.pass, depth: o.d, T, quit: false, placing: -1 });   // his client: its own chain, no row
      }
    }
  }
  if (out) Object.assign(out, { deaths, lenient });
  if (deaths && lenient / deaths > 0.10) e.push('deaths judged passes ' + lenient + ' / ' + deaths + ' (over 10 %)');
  return e;
}

// [17] Q432 lift: chains settled by the OLD job (the lowest reading only: a mutant of this file) where a run his client ended at its
//   line was judged a miss; elpQ432Lift of the real job turns those runs into passes (target = the depth), adds the difference (the
//   points only go up, every player), leaves quits / deaths no reading of the replayed set passes as they were, and a second lift
//   changes nothing
function sLift(m) { const undo = restartOff(m); try { return sLiftOn(m); } finally { undo(); } }
function sLiftOn(m) {
  const e = [], old = mutantOf([['const set = elpLvSetOf(after, ch.outs);', 'const set = [after];'], ['if (have) return elpLvUniq([have].concat(elpLvSet(c, fam)));', 'if (have) return [have];']]);
  restartOff(old);   // the old job had no restart readings either (O1015 came after the Q432 lift)
  const t0 = T0 + 8000 * MIN, seeds = [7901, 7902, 7903];
  const nexts = (Tc) => [{ pass: true, d: Tc }, { pass: false, d: Math.max(0, Tc - 1) }, { pass: false, d: Math.max(0, Tc - 3) }];
  let harmed = 0, worlds = 0;
  for (const rowH of [700, 1400]) for (const truthRow of [false, true]) {
    const base = placedWith(old, 34, 'solo', [10, 12, 14], rowH, t0), xc0 = truthRow ? base.row : base.own, Tc1 = PP.elpTargetOfL(xc0.L, seeds[0]);
    for (const o1 of outcomesOf(Tc1).filter((x) => !x.quit).slice(0, 4)) for (const o2i of [0, 1, 2]) for (const o3i of [0, 1, 2]) {
      const w = placedWith(old, 34, 'solo', [10, 12, 14], rowH, t0);
      let xc = xc0, T = Tc1, o = o1;
      const plays = [];
      for (let k = 0; k < 3; k++) {
        if (k > 0) { T = PP.elpTargetOfL(xc.L, seeds[k]); o = nexts(T)[[o2i, o3i][k - 1]]; }
        const at = t0 + (20 + 30 * k) * MIN, rid = 901 + k;
        old.ratingHistUpsert(w.st, w.p, 'solo', 0, rid, o.d, at, F, seeds[k], { v7: true, quit: false });
        old.elpSettleAll(w.st, 0, at + 1000);
        plays.push({ rid, o });
        xc = PP.elpLevelStep(xc, { pass: o.pass, depth: o.d, T, quit: false, placing: -1 });
      }
      const was = plays.map((pl) => (runOf(w.st, w.p, 'solo', pl.rid) || []).slice(0, 6));
      const hurt = plays.filter((pl, i) => pl.o.pass && (was[i][5] | 0) > pl.o.d);
      worlds++;
      if (!hurt.length) continue;
      harmed++;
      const tag = 'row ' + rowH + (truthRow ? ' (client: row)' : ' (client: own)') + ' ' + [o1.pass ? 'p' : 'd' + o1.d, o2i, o3i].join('/');
      // the row's reading at a past first run cannot be read again (the row has moved on since): a client that started from a row
      //   reading the job's own does not repeat (here a made-up row skill) is lifted only where the chain the job carried passes -- the
      //   lift must never take anything from him; a client that started from the job's own reading (the live case: the row's skill is
      //   the job's own hidden skill of the day) gets every line-end passed
      const lp0 = C(w.st, w.p).lp | 0, lf = m.elpQ432Lift(w.st, 0, t0 + 200 * MIN), lp1 = C(w.st, w.p).lp | 0;
      if (lp1 < lp0 || lf.pts !== lp1 - lp0) e.push(tag + ': the lift moved ' + lp0 + ' -> ' + lp1 + ' ' + J(lf));
      if (!truthRow && !(lp1 > lp0 && lf.runs >= 1)) e.push(tag + ': the lift found nothing ' + J(lf));
      plays.forEach((pl, i) => {
        const r = runOf(w.st, w.p, 'solo', pl.rid);
        if (!truthRow && pl.o.pass && (r[5] | 0) > pl.o.d) e.push(tag + ': run ' + (i + 1) + ' ended at his line ' + pl.o.d + ' still judged against ' + r[5]);
        if ((r[4] | 0) < (was[i][4] | 0)) e.push(tag + ': run ' + (i + 1) + ' lost points ' + was[i][4] + ' -> ' + r[4]);
      });
      const lf2 = m.elpQ432Lift(w.st, 0, t0 + 210 * MIN);
      if (lf2.runs || (C(w.st, w.p).lp | 0) !== lp1) e.push(tag + ': a second lift moved it again ' + J(lf2));
      if (harmed >= 8) break;
    }
    if (harmed >= 8) break;
  }
  if (!harmed) e.push('the world is not a real test: the old job hurt no chain of ' + worlds);
  // a death no reading passes, and a quit, stay misses
  {
    const w = placedWith(old, 35, 'solo', [10, 12, 14], 900, t0), x0 = w.own, Ta = PP.elpTargetOfL(x0.L, 7951);
    old.ratingHistUpsert(w.st, w.p, 'solo', 0, 951, 0, t0 + 20 * MIN, F, 7951, { v7: true, quit: false });
    old.ratingHistUpsert(w.st, w.p, 'solo', 0, 952, Math.max(0, Ta - 1), t0 + 50 * MIN, F, 7952, { v7: true, quit: true });
    old.elpSettleAll(w.st, 0, t0 + 60 * MIN);
    const before = J([runOf(w.st, w.p, 'solo', 951), runOf(w.st, w.p, 'solo', 952), C(w.st, w.p).lp]);
    m.elpQ432Lift(w.st, 0, t0 + 200 * MIN);
    const after = J([runOf(w.st, w.p, 'solo', 951).slice(0, 12), runOf(w.st, w.p, 'solo', 952).slice(0, 12), C(w.st, w.p).lp]);
    if (J(JSON.parse(before).map((x, i) => (i < 2 ? x.slice(0, 12) : x))) !== after) e.push('a death at 0 / a quit moved: ' + before + ' -> ' + after);
  }
  // a death between his two readings' targets (the lower one rules itself out: the run went past it) stays a miss
  {
    const w = placedWith(old, 36, 'solo', [10, 12, 14], 1400, t0), seed = 7961, To = PP.elpTargetOfL(w.own.L, seed), Tr = PP.elpTargetOfL(w.row.L, seed);
    if (!(To + 1 < Tr)) e.push('the world is not a real test: own ' + To + ' row ' + Tr);
    else {
      old.ratingHistUpsert(w.st, w.p, 'solo', 0, 961, To + 1, t0 + 20 * MIN, F, seed, { v7: true, quit: false });
      old.elpSettleAll(w.st, 0, t0 + 30 * MIN);
      const r0 = (runOf(w.st, w.p, 'solo', 961) || []).slice(0, 6), lp0 = C(w.st, w.p).lp | 0;
      if (!((r0[5] | 0) > To + 1)) e.push('the world is not a real test: the old job passed the death ' + J(r0));
      m.elpQ432Lift(w.st, 0, t0 + 200 * MIN);
      const r1 = (runOf(w.st, w.p, 'solo', 961) || []).slice(0, 6);
      if (J(r0) !== J(r1) || (C(w.st, w.p).lp | 0) !== lp0) e.push('a death between his two targets became a pass: ' + J(r0) + ' -> ' + J(r1));
    }
  }
  return e;
}

// [18] O992: the host started before the strong member's hello reached him, so his line was the weak member's alone (below the
//   strong one's lowest reading). The run passes at that line: no seat is judged a miss; a death under it is still a miss
function sTeamMissing(m) {
  const e = [], t0 = T0 + 9000 * MIN, seed = 7451;
  const lv = (ds) => PP.elpLevelInit(PP.elpHiddenFor('duo', ds.slice().reverse().map((dd) => ['solo', dd]), LINES, 1), LINES.duo);
  const xS = lv([16, 17, 18]), xW = lv([7, 8, 9]), Tw = PP.elpTargetOfL(xW.L, seed), Ts = PP.elpTargetOfL(xS.L, seed);
  if (!(Ts > Tw + 2)) return ['the world is not a real test: ' + J([xS.L, xW.L, Ts, Tw])];
  for (const [label, depth, wantPass] of [['the team passes at the weak member\'s line', Tw, true], ['a death under it', Math.max(0, Tw - 2), false]]) {
    const st = { hist: {} }, RID = 990 + (wantPass ? 0 : 1);
    const S = placedInto(m, st, 48, [16, 17, 18], null, 'duo', t0), W = placedInto(m, st, 49, [7, 8, 9], null, 'duo', t0);
    m.elpSettleAll(st, 0, t0 + 10 * MIN);
    const at = t0 + 20 * MIN;
    m.elpTeamNote(st, RID, [S.p, W.p], 'duo', 0, at);
    for (const q of [S.p, W.p]) m.ratingHistUpsert(st, q, 'duo', 0, RID, depth, at, F, seed, { v7: true, quit: false });
    m.elpSettleAll(st, 0, at + MIN);
    for (const q of [S.p, W.p]) {
      const r = runOf(st, q, 'duo', RID);
      if (!r || r[3] !== 2) { e.push(label + ': seat ' + q.slice(-4) + ' did not settle'); continue; }
      const passed = (r[5] | 0) <= depth;
      if (passed !== wantPass) e.push(label + ' (depth ' + depth + '): seat ' + q.slice(-4) + ' judged against ' + r[5] + (wantPass ? ' (a miss)' : ' (a pass)'));
    }
  }
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
  ['[9] the live pass lines read the smoothed level once the published table is version 7 (the hidden skill under version 6)', sLines],
  ['[10] real intake: a signed solo record carries its key\'s rules version into the version bit (elp 7 / old key 6 / dev key ELP_DEV_VER); team LINE segments (a final one ending at a checkpoint depth, a save one) pass sanity at 2..4 seats, LINE + classic / unknown bits do not', sIntakeReal],
  ['[11] solo, two readings of his first version 7 level: no outcome of that run and no pass his client shows on the run after it is judged a miss; the depth rules out a reading below it', sCarry],
  ['[12] team: one member read above what his client sent does not lift the team\'s target (a pass for every seat)', sTeamOver],
  ['[12b] team: the over-read member\'s first run, every outcome, then the next run back to back passing at the host\'s next line: no seat judged a miss', sTeamBack],
  ['[13] two team runs back to back: one pass or two, the second reads the same lines and every seat ends the same', sTwoPasses],
  ['[14] a run that stood parked is judged with every reading (its client may have read its target again on resume)', sResumed],
  ['[15] a conviction\'s replay steps a later run with the target its carried step read (r[10][6])', sReplayCarry],
  ['[16] Q432: a client that never reads its row back, four runs: no run it ended at its line judged a miss; deaths judged passes under 10 %', sCarryLong],
  ['[17] Q432 lift: chains the old job hurt get their line-end runs passed and the difference added (only up), a death / quit stays, a second lift changes nothing', sLift],
  ['[18] O992: the host started before the strong member\'s hello came (his line = the weak member\'s): a pass there is a pass for every seat, a death under it a miss', sTeamMissing]];
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
  ['the team line is the LOWEST level', [['tm.lvL = pointsPlan.elpTeamLine(sets.map((xs) => xs[0]));', 'tm.lvL = Math.min.apply(null, sets.map((xs) => xs[0]));']], sTeam],
  ['every member takes the team line (the ratchet)', [['const after = pointsPlan.elpLevelStep(a.rd.x, { pass: depth >= a.t, depth, T: a.t, quit, placing });', 'const after = pointsPlan.elpLevelStep(Object.assign({}, a.rd.x, { L: a.rd.L }), { pass: depth >= a.t, depth, T: a.t, quit, placing });']], sTeam],
  ['the cutover never comes', [['const cut = RATING.CUTOVER_MS > 0 && nowMs != null', 'const cut = false && nowMs != null']], sCut],
  ['the cutover also cuts runs still being played (no parked check)', [[' && elpRunVer(r) < elpCutVer() && !!((r[7] | 0) & 2);', ' && elpRunVer(r) < elpCutVer();']], sCut],   // O991: the version test reads elpRunVer / elpCutVer
  ['a conviction does not replay the level', [['  if (lvGone && c) elpLevelReplay(c, h, fam, lvGone);', '  if (false) elpLevelReplay(c, h, fam, lvGone);']], sReplay],
  ['a later segment drops the version bit', [['| ((r[7] | 0) & (ELP_R_V7 | ELP_R_V8 | ELP_R_QUIT)) |', '| ((r[7] | 0) & ELP_R_QUIT) |']], sIntake],   // O991: the kept bits carry ELP_R_V8 too
  ['a version 6 reading takes version 7 tables', [['const mv = maxVer == null ? 6 : maxVer;', 'const mv = maxVer == null ? Infinity : maxVer;']], sTables],
  ['the placement seeds from the level BEFORE the last placement run', [['lp = Math.max(lp, pointsPlan.elpLevelSeed(x.L, tb[fam], tb.solo));', 'lp = Math.max(lp, pointsPlan.elpLevelSeed(ch.carry.rd.x.L, tb[fam], tb.solo));']], sSolo],
  ['a points run reads the jumpy level for its tiers (not Lm)', [['pointsPlan.endlessSettleLv(cur, depth >= a.t, a.rd.x.Lm, tb[fam], off, fam, pointsPlan.elpLineOfL(a.rd.L));', 'pointsPlan.endlessSettleLv(cur, depth >= a.t, a.rd.x.L, tb[fam], off, fam, pointsPlan.elpLineOfL(a.rd.L));']], sTiers],
  ['the row stays v2 (no level states)', [['placed: 1, h, lv: c.lv || null, lv8: c.lv8 || null }, c.ring || []);', 'placed: 1, h }, c.ring || []);']], sSolo],   // O991: the row also carries lv8
  ['the team sanity drops SEG_LINE from the accepted bits', [['| attest.SEG_CLASSIC | attest.SEG_LINE | attest.SEG_V8)) !== 0 || ((fl & attest.SEG_LINE) && (fl & attest.SEG_CLASSIC))', '| attest.SEG_CLASSIC | attest.SEG_V8)) !== 0 || ((fl & attest.SEG_LINE) && (fl & attest.SEG_CLASSIC))']], sIntakeReal],   // O991: + SEG_V8
  ['the job carries the reading its points came from (rule (a)), without the set', [['  return { pick, carry, outs };\n}', '  return { pick, carry: { rd: pick.rd, t: pick.t, after: pointsPlan.elpLevelStep(pick.rd.x, { pass: depth >= pick.t, depth, T: pick.t, quit, placing }) }, outs };\n}'], ['const set = elpLvSetOf(after, ch.outs);', 'const set = [after];']], sCarry],
  ['Q432: the job carries the lowest reading only (no set)', [['const set = elpLvSetOf(after, ch.outs);', 'const set = [after];']], sCarryLong],
  ['Q432: the next run does not read the carried set', [['if (have) return elpLvUniq([have].concat(elpLvSet(c, fam)));', 'if (have) return [have];']], sCarryLong],
  ['Q432 lift: a reading under the depth also passes (a death becomes a pass)', [['const hit = keep.filter((a) => a.t === depth);', 'const hit = cand.filter((a) => a.t <= Math.max(1, depth));']], sLift],
  ['O992: the team lines keep the floor of the whole roster (nobody left out)', [['    if (sets.length > 1) {\n      const top = mins.indexOf(floor)', '    if (false) {\n      const top = mins.indexOf(floor)']], sTeamMissing],
  ['Q432 lift: the lift re-reads nothing (no replayed set: the lowest reading only)', [['S = elpLvSetOf(elpLvOfArr(r[11]), keep.map(', 'S = [elpLvOfArr(r[11])].filter(Boolean); void (keep.map(']], sLift],
  ['the depth rules out nothing', [['  let keep = resumed ? all : all.filter((a) => a.t >= depth);', '  let keep = all;']], sCarry],
  ['a first version 7 run reads the job\'s own start only', [['  if (rs != null) xs.push(pointsPlan.elpLevelInit(rs, lines[fam]));\n  return elpLvUniq(xs);', '  return elpLvUniq(xs.slice(0, 1));']], sCarry],
  ['the team reads one state per member (its own line only)', [['    for (const xs of sets) for (const L of xs) if (L >= floor) lns.add(pointsPlan.elpLineOfL(L));', '']], sTeamOver],
  ['a team run carries the reading its points came from (rule (a)), back to back, without the set', [['  return { pick, carry, outs };\n}', '  return { pick, carry: { rd: pick.rd, t: pick.t, after: pointsPlan.elpLevelStep(pick.rd.x, { pass: depth >= pick.t, depth, T: pick.t, quit, placing }) }, outs };\n}'], ['const set = elpLvSetOf(after, ch.outs);', 'const set = [after];'], ['.concat(elpLvSetOfArrs(last.set)));   // Q432', '); //']], sTeamBack],
  ['a team run reads one state per member, back to back', [['    for (const xs of sets) for (const L of xs) if (L >= floor) lns.add(pointsPlan.elpLineOfL(L));', '']], sTeamBack],
  ['the pass walks player by player', [['const t = leftAt(x); if (!q || t < qt) { q = x; qt = t; }', 'const t = 0; if (!q) { q = x; qt = t; }']], sTwoPasses],
  ['a resumed run is filtered by its depth too', [['  const resumed = Array.isArray(r[9]) && r[9].length > 0;', '  const resumed = false;']], sResumed],
  ['the replay steps with the points target (r[5])', [['t = r[10].length > 6 ? (r[10][6] | 0) : (r[5] | 0);', 't = (r[5] | 0);']], sReplayCarry],
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
