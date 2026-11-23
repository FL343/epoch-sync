'use strict';
// ============================================================
// endless-level8.js -- O991 (ELP version 8, 2026-11-23; plan mvp/KNIFE_O991_ENDLESS_GROW_PLAN.md in the companion repo): the grow
//   phase. The job half, on the REAL ratingHistUpsert / elpSettleAll / ratingHistRemove / ratingScoreOf / elpHiddensOf, against a
//   model built from points-plan.js ELP8:
//   [1] intake: a version 8 run carries ELP_R_V8 ALONE (never ELP_R_V7), the bit stays with later segments; elpSegLv / elpRunVer; a
//       signed solo record of an elp-8 key (and the dev key under ELP_DEV_VER=8) reads 8; team segments COMP | LINE | V8 pass sanity
//       at 2..4 seats, V8 without LINE / with classic / an unknown bit do not (T10, the job half)
//   [2] a placed player's FIRST version 8 run starts from his version 7 level read through the two line tables (elpLevelInit8), its
//       target / points / states follow ELP8, the version 7 level stays as it was; the row is v4 (version 7 and version 8 states)
//   [3] the cap: a version 7 level far above what he played lately (the 0.6.1 duo tail) starts at the deepest newest run x1.15
//   [4] a new player: three version 8 placement runs from the silver line (PLACE on the part past the grow phase, a miss floored),
//       the third seeds from the version 8 level; the row v4 carries the version 8 state alone
//   [5] R2: a death in the grow phase (15 levels passed or fewer) takes points and leaves the level; one past it moves the level
//   [6] team: the roster's HIGHEST version 8 level is the line (frozen, + the O992 line without the floor member), each steps his own
//   [7] T9 versions by run: a world of version 6 / 7 runs (solo, team, a conviction) settles to the very values the job before O991
//       gave it (fixtures/elp8/v7-world.json, made with that job: node test/endless-level8.js --v7-fixture=<its validate.js>)
//   [8] T11 the cutover (D6): with ELP_PUB_VER 7 a parked version 7 run waits; with 8 it settles at its save depth under version 7;
//       a parked version 8 run never; a version 7 run still being played never; a version 6 one parked in both
//   [9] a conviction of a version 8 run replays the version 8 level from the state before it (the version 7 level stays)
//   [10] tables: a version 8 reading takes version 8 tables only (else the version 8 prior), a version 7 one never a version 8 table;
//        PUB_VER 8 publishes version 8 with the version 8 priors; the live lines read lv8.Lm and leave out players without one
//   [11] T12 rows: the job writes v4 / v3 / v2 by what the player holds; the reader takes v2 / v3 / v4 and the rows the job before
//        O991 wrote (fixtures/elp8/rows-old.json) read the same; RATING.ROW_VERS lists 4
//   [12] Q3 milestones: a version 8 run pays its family's version 8 steps (solo 26 / 29 / 33, duo 32 / 36 / 41, quad 35 / 40 / 44),
//        a version 7 run the old ones; the call sites pass the list by the run's version
//   [13] T14 the gate in the job: a placed diamond player's pass is held under master until his smoothed level reaches 104 %
//   [14] a member who stopped writing (the team's final segment ends his copy: ratingHistFinal) keeps the version 8 bit and settles
//        on the team line (a version 7 copy loses its bit there as it always did: [7]'s world pins that unchanged)
//   [15] a client still on the version 8 prior after a version 8 table was recorded: his pass at the prior's target stays a pass
//   [20] mutations: each check above turns red on the matching break
// ============================================================
const path = require('path'), fs = require('fs'), os = require('os');
for (const k of ['ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER', 'ELP_IDLE_MS', 'PT_MODE', 'SEASON_NOW', 'COUCH_DUO']) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const V7_FIXTURE = path.join(ROOT, 'fixtures', 'elp8', 'v7-world.json');
const ROWS_FIXTURE = path.join(ROOT, 'fixtures', 'elp8', 'rows-old.json');
const fxArg = (process.argv.find((a) => a.startsWith('--v7-fixture=')) || '').slice('--v7-fixture='.length);
const rowsArg = (process.argv.find((a) => a.startsWith('--rows-fixture=')) || '').slice('--rows-fixture='.length);
const v = require(path.join(ROOT, 'validate.js'));
const attest = require(path.join(ROOT, 'attest.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const PPSRC = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = (x) => JSON.stringify(x);
const F = attest.SEG_FINAL, SUS = attest.SEG_SUSPENDED, MIN = 60000, DAY = 86400000, T0 = 1764000000000;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (m, n) => m.pid(SID(n));
const C = (st, p) => st.hist[v.elpAllKey(p, 0)];
const runOf = (st, p, fam, id) => ((st.hist[v.ratingHistKey(p, fam || 'solo', 0)] || { runs: [] }).runs.find((q) => (q[0] >>> 0) === (id >>> 0)));
const arr = (x, placing) => [x.L, x.Lm, x.s, x.last, x.run, placing == null ? -1 : placing];
const S = (L, Lm, s, last, run) => ({ L, Lm, s, last, run });
const L7 = PP.ELP7.PRIOR, L8 = PP.ELP8.PRIOR;
const V8 = { v7: true, quit: false, v8: true }, V7 = { v7: true, quit: false };
// a version 7 table (the version 7 priors) recorded two days before the worlds start: every version 7 reading of these worlds reads
//   these lines (no other candidate), every version 8 reading the version 8 prior (no version 8 table) -- one reading each
const tab7 = () => ({ day: 20251122, season: 0, ms: T0 - 2 * DAY, key: J([7, 1500, 500, 100, 2]), byFam: { solo: { N: 0, pass: L7.solo }, duo: { N: 0, pass: L7.duo }, trio: { N: 0, pass: L7.trio }, quad: { N: 0, pass: L7.quad } } });
const world = () => ({ hist: {}, elpTab: [tab7()] });
// a placed player of family fam holding version 7 level x7 and settled version 7 runs of the family at these depths (oldest first)
function v7Holder(m, st, n, fam, x7, depths, lp, t0) {
  const p = P(m, n);
  const runs = depths.map((d, i) => [80000 + 100 * n + i, d, t0 + i * MIN, 2, 0, d, t0 + i * MIN, 1 | m.ELP_R_V7, 40000 + 100 * n + i]);
  st.hist[m.ratingHistKey(p, fam, 0)] = { best: [0, 0], runs, old: [], t: t0 };
  st.hist[m.elpAllKey(p, 0)] = { lp, placed: 1, seedRun: [fam, runs[0][0]], n: depths.length, ring: [], t: t0, lv: { [fam]: x7 } };
  return p;
}
const newestFirst = (ds) => ds.slice().reverse();

// ---- [1] intake ----
const _crypto = require('crypto');
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
function kp(seedHex) { const priv = _crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' }); return { priv, pub: _crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex') }; }
function soloRec(keyId, k, o) {
  const sid = BigInt('76561198000000001');
  const base = [0xB1, 3, 7, attest.hash32('m-o991'), 5, 0, 1, 0, 1, 900, 4000, o.disp | 0, Number(sid & 0xFFFFFFFFn) | 0, Number((sid >> 32n) & 0xFFFFFFFFn) | 0,
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
function sIntake(m) {
  const e = [], st = { hist: {} }, p = P(m, 1);
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 18, T0, 0, 900, V8);
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 20, T0 + MIN, 0, 900);   // a later segment without the bits
  const r = runOf(st, p, 'solo', 41);
  if (!r || !((r[7] | 0) & m.ELP_R_V8) || ((r[7] | 0) & m.ELP_R_V7)) e.push('a version 8 run: fl ' + (r && r[7]) + ' (ELP_R_V8 alone)');
  if (m.elpRunVer(r) !== 8) e.push('elpRunVer of a version 8 run ' + m.elpRunVer(r));
  m.ratingHistUpsert(st, p, 'solo', 0, 41, 21, T0 + 2 * MIN, F, 900, { v7: true, quit: true, v8: true });
  if (!((r[7] | 0) & m.ELP_R_QUIT) || !((r[7] | 0) & m.ELP_R_V8)) e.push('the final quit segment: fl ' + r[7]);
  m.ratingHistUpsert(st, p, 'solo', 0, 42, 9, T0 + 3 * MIN, F, 901, V7);
  m.ratingHistUpsert(st, p, 'solo', 0, 43, 9, T0 + 4 * MIN, F, 902);
  if (m.elpRunVer(runOf(st, p, 'solo', 42)) !== 7 || m.elpRunVer(runOf(st, p, 'solo', 43)) !== 6 || ((runOf(st, p, 'solo', 42)[7] | 0) & m.ELP_R_V8)) e.push('a version 7 / 6 run: ' + J([runOf(st, p, 'solo', 42)[7], runOf(st, p, 'solo', 43)[7]]));
  const a = m.elpSegLv({ ok: true, elp: 8 }, { flags: F, dispCode: 5 }), b = m.elpSegLv({ ok: true, elp: 7 }, { flags: F, dispCode: 0 });
  if (J(a) !== J({ v7: true, quit: true, v8: true }) || J(b) !== J({ v7: true, quit: false, v8: false })) e.push('elpSegLv ' + J([a, b]));
  // a signed record: the key's table entry says elp 8 -> the verdict reads 8; the dev key reads ELP_DEV_VER
  const k8 = kp('a'.repeat(64)), kd = kp('2'.repeat(64));
  const TABLE = { 2026112401: { pubs: [k8.pub], sealed: true, pubInfo: { [k8.pub]: { ch: 'ea', elp: 8 } } }, dev: { pubs: [kd.pub], sealed: false } };
  const keep = process.env.ELP_DEV_VER;
  try {
    const s8 = attest.verifySoloRecord(soloRec(2026112401, k8, { start: 15, end: 20, flags: F, disp: 0 }), TABLE);
    if (!s8.ok || s8.elp !== 8 || !m.elpSegLv(s8, s8.fields).v8) e.push('elp-8 key: ' + J([s8.ok, s8.reason, s8.elp]));
    process.env.ELP_DEV_VER = '8';
    const d8 = attest.verifySoloRecord(soloRec(0, kd, { start: 0, end: 5, flags: 0, disp: 0 }), TABLE);
    if (!d8.ok || d8.elp !== 8 || !m.elpSegLv(d8, d8.fields).v8) e.push('dev key under ELP_DEV_VER=8: ' + J([d8.ok, d8.elp]));
  } finally { if (keep == null) delete process.env.ELP_DEV_VER; else process.env.ELP_DEV_VER = keep; }
  // team sanity: the new bit rides with SEG_LINE
  const COMP = attest.SEG_COMP, LINE = attest.SEG_LINE, V8B = attest.SEG_V8;
  if (V8B !== 256) e.push('SEG_V8 ' + V8B);
  for (const pc of [2, 3, 4]) {
    const g = (o) => [mkTeam('76561198000000001', 0, Object.assign({ pc }, o)), mkTeam('76561198000000002', 1, Object.assign({ pc }, o))];
    for (const [label, o] of [['a version 8 checkpoint segment', { start: 15, end: 20, flags: COMP | LINE | V8B }], ['a version 8 run ending at its target', { start: 20, end: 24, flags: COMP | LINE | V8B | F }], ['a version 8 save segment', { start: 20, end: 23, flags: COMP | LINE | V8B | SUS }]]) {
      const x = m.sanityFlags(g(o));
      if (x.length) e.push(pc + ' seats, ' + label + ': ' + J(x));
    }
    if (m.sanityFlags(g({ start: 0, end: 5, flags: COMP | V8B })).indexOf('flags') < 0) e.push(pc + ' seats: V8 without LINE passed');
    if (m.sanityFlags(g({ start: 0, end: 5, flags: attest.SEG_CLASSIC | LINE | V8B })).indexOf('flags') < 0) e.push(pc + ' seats: V8 with classic passed');
    if (m.sanityFlags(g({ start: 0, end: 5, flags: COMP | LINE | V8B | 512 })).indexOf('flags') < 0) e.push(pc + ' seats: an unknown bit passed');
  }
  // the team intake reads the bit into lv.v8 (the line that calls ratingHistUpsert for a team writer)
  if (!/\{ v7: !!\(\(f\.flags \| 0\) & attest\.SEG_LINE\), quit: false, v8: !!\(\(f\.flags \| 0\) & attest\.SEG_V8\) \}/.test(m.__SRC || SRC)) e.push('the team intake does not pass SEG_V8 as lv.v8');
  return e;
}

// ---- [2] his first version 8 run (the conversion) ----
function sFirst(m, out) {
  const e = [], st = world(), x7 = S(1200, 1150, 3, 1, 2), ds = [12, 11, 13], t0 = T0 + 100 * MIN, lp0 = 2500;
  const p = v7Holder(m, st, 2, 'solo', x7, ds, lp0, t0);
  const x8 = PP.elpLevelInit8(x7, newestFirst(ds), L7.solo, L8.solo);
  const starts = m.elpLevelStarts8(st, p, C(st, p), 'solo', 0, st.hist[m.ratingHistKey(p, 'solo', 0)], 7001, t0 + 30 * MIN, t0 + 31 * MIN, null);
  if (J(starts) !== J([x8])) e.push('the starts ' + J(starts) + ' != one, the conversion ' + J(x8));
  const seed = 19, Tt = PP.elpTargetOfL8(x8.L, seed), at = t0 + 30 * MIN;   // offset +2
  m.ratingHistUpsert(st, p, 'solo', 0, 7001, Tt, at, F, seed, V8);
  m.elpSettleAll(st, 0, at + 1000);
  const r = runOf(st, p, 'solo', 7001), c = C(st, p);
  const after = PP.elpLevelStep8(x8, { pass: true, depth: Tt, T: Tt, placing: -1 });
  const sl = PP.endlessSettleLv8(lp0, true, x8.Lm, L8.solo, PP.targetOffset(seed), 'solo', PP.elpLineOfL8(x8.L));
  if (!r || r[3] !== 2) return ['the version 8 run did not settle'];
  if ((r[5] | 0) !== Tt || (r[4] | 0) !== sl.nv - lp0) e.push('target / points ' + J([r[5], r[4]]) + ' != ' + J([Tt, sl.nv - lp0]));
  if (J(r[10]) !== J(arr(x8, -1).concat([Tt])) || J(r[11]) !== J(arr(after, -1))) e.push('states ' + J([r[10], r[11]]) + ' != ' + J([arr(x8, -1).concat([Tt]), arr(after, -1)]));
  if (J(c.lv8 && c.lv8.solo) !== J(after) || J(c.lv.solo) !== J(x7)) e.push('levels lv8 ' + J(c.lv8) + ' / lv ' + J(c.lv) + ' (the version 7 level must stay)');
  if ((c.lp | 0) !== sl.nv) e.push('points ' + c.lp + ' != ' + sl.nv);
  // his second version 8 run reads his version 8 level (not the version 7 one again)
  const seed2 = 2, T2 = PP.elpTargetOfL8(after.L, seed2), at2 = at + 40 * MIN, d2 = T2 - 3;
  m.ratingHistUpsert(st, p, 'solo', 0, 7002, d2, at2, F, seed2, V8);
  m.elpSettleAll(st, 0, at2 + 1000);
  const r2 = runOf(st, p, 'solo', 7002), after2 = PP.elpLevelStep8(after, { pass: false, depth: d2, T: T2, placing: -1 });
  if (!r2 || (r2[5] | 0) !== T2 || J(C(st, p).lv8.solo) !== J(after2)) e.push('the second run ' + J(r2 && [r2[5], r2[10], r2[11]]) + ' != ' + J([T2, after2]));
  const sc = m.ratingScoreOf(st, p, 0, at2 + 2000), row = sc ? PP.elpRowOf(sc.details) : null;
  if (!row || ((sc.details[0] >>> 8) & 0xff) !== 4 || J(row.lv8.solo) !== J(after2) || J(row.lv.solo) !== J(x7)) e.push('row v4 ' + J(row && { lv: row.lv, lv8: row.lv8 }));
  if (out) Object.assign(out, { st, p, x7, x8, after, after2 });
  return e;
}

// ---- [3] the cap ----
function sCap(m) {
  const e = [], st = world(), x7 = S(2500, 2400, 3, 1, 2), ds = [8, 9, 7], t0 = T0 + 200 * MIN;
  const p = v7Holder(m, st, 3, 'duo', x7, ds, 3100, t0);
  const capped = PP.elpLevelInit8(x7, newestFirst(ds), L7.duo, L8.duo), open = PP.elpLevelInit8(x7, [], L7.duo, L8.duo);
  if (!(capped.L < open.L - 300)) return ['the world is not a real test: ' + J([capped, open])];
  const seed = 2, Tt = PP.elpTargetOfL8(capped.L, seed), at = t0 + 30 * MIN;
  m.ratingHistUpsert(st, p, 'duo', 0, 7101, Tt, at, F, seed, V8);   // no roster: his own level
  m.elpSettleAll(st, 0, at + 1000);
  const r = runOf(st, p, 'duo', 7101);
  if (!r || J(r[10]) !== J(arr(capped, -1).concat([Tt]))) e.push('the first duo run started from ' + J(r && r[10]) + ', not the capped ' + J(arr(capped, -1).concat([Tt])) + ' (uncapped ' + open.L + ')');
  return e;
}

// ---- [4] a new player: placement from the silver line ----
function sPlace(m) {
  const e = [], st = world(), p = P(m, 4), t0 = T0 + 300 * MIN;
  let x = PP.elpLevelInit8(null, [], null, L8.solo), lp = null;
  const plan = [['P'], ['M', 3], ['P']];
  plan.forEach((step, i) => {
    const seed = 100 + i, Tt = PP.elpTargetOfL8(x.L, seed), depth = step[0] === 'P' ? Tt : Tt - step[1], at = t0 + i * 40 * MIN;
    m.ratingHistUpsert(st, p, 'solo', 0, 7200 + i, depth, at, F, seed, V8);
    m.elpSettleAll(st, 0, at + 1000);
    const r = runOf(st, p, 'solo', 7200 + i), before = x;
    x = PP.elpLevelStep8(x, { pass: depth >= Tt, depth, T: Tt, placing: i });
    if (!r || r[3] !== 2 || (r[5] | 0) !== Tt || J(r[10]) !== J(arr(before, i).concat([Tt])) || J(r[11]) !== J(arr(x, i))) e.push('placement run ' + i + ': ' + J(r && [r[5], r[10], r[11]]) + ' != ' + J([Tt, arr(before, i), arr(x, i)]));
    if (i === 2) lp = PP.elpLevelSeed8(x.L, L8.solo, L8.solo);
  });
  const c = C(st, p);
  if (!c || !c.placed || (c.lp | 0) !== lp) e.push('the seed ' + (c && c.lp) + ' != ' + lp);
  if (c && c.lv) e.push('a version 8 player holds a version 7 level ' + J(c.lv));
  const sc = m.ratingScoreOf(st, p, 0, t0 + 200 * MIN), row = sc ? PP.elpRowOf(sc.details) : null;
  if (!row || ((sc.details[0] >>> 8) & 0xff) !== 4 || J(row.lv8.solo) !== J(x) || row.lv.solo !== null) e.push('row ' + J(row && { lv: row.lv, lv8: row.lv8 }));
  return e;
}

// ---- [5] R2 in the job ----
function sR2(m) {
  const e = [], o = {};
  const e0 = sFirst(m, o);
  if (e0.length) return ['the world of [2]: ' + e0[0]];
  const { st, p, after2 } = o, t = T0 + 1000 * MIN;
  for (const [id, depth, keeps] of [[7301, 15, true], [7302, 0, true], [7303, 16, false]]) {
    const before = PP.elpLevelOf8(C(st, p).lv8.solo), lpB = C(st, p).lp | 0, seed = 2, Tt = PP.elpTargetOfL8(before.L, seed);
    m.ratingHistUpsert(st, p, 'solo', 0, id, depth, t + (id - 7300) * 40 * MIN, F, seed, V8);
    m.elpSettleAll(st, 0, t + (id - 7300) * 40 * MIN + 1000);
    const r = runOf(st, p, 'solo', id), now = C(st, p).lv8.solo;
    if (!r || r[3] !== 2 || !((r[4] | 0) < 0)) e.push('a death at ' + depth + ' took no points: ' + J(r && r[4]));
    if (keeps && J(now) !== J(before)) e.push('a death at ' + depth + ' (in the grow phase) moved the level ' + J([before, now]));
    if (!keeps && J(now) === J(before)) e.push('a death at ' + depth + ' (past the grow phase) left the level');
    void lpB; void after2;
  }
  return e;
}

// ---- [6] team ----
function sTeam(m, out) {
  const e = [], st = world(), t0 = T0 + 400 * MIN, RID = 7401, seed = 2;
  const xA7 = S(1800, 1750, 3, 1, 2), xB7 = S(900, 880, 3, 0, 2), dA = [18, 17, 19], dB = [9, 8, 10];
  const A = v7Holder(m, st, 5, 'duo', xA7, dA, 3000, t0), B = v7Holder(m, st, 6, 'duo', xB7, dB, 1500, t0);
  const xA = PP.elpLevelInit8(xA7, newestFirst(dA), L7.duo, L8.duo), xB = PP.elpLevelInit8(xB7, newestFirst(dB), L7.duo, L8.duo);
  const hi = Math.max(xA.L, xB.L), lo = Math.min(xA.L, xB.L), Tt = PP.elpTargetOfL8(hi, seed), at = t0 + 30 * MIN;
  if (!(PP.elpLineOfL8(hi) > PP.elpLineOfL8(lo))) return ['the world is not a real test: ' + J([xA, xB])];
  m.elpTeamNote(st, RID, [A, B], 'duo', 0, at);
  for (const q of [A, B]) m.ratingHistUpsert(st, q, 'duo', 0, RID, Tt, at, F, seed, V8);
  m.elpSettleAll(st, 0, at + MIN);
  const tm = st.elpTeam[String(RID)], want = [PP.elpLineOfL8(hi), PP.elpLineOfL8(lo)];
  if (!tm || tm.lvL8 !== hi || J(tm.lvLns8) !== J(want) || tm.hasLv8 !== 1) e.push('team ' + J(tm) + ' != line ' + hi + ' lines ' + J(want));
  if (tm && (tm.hasLv || tm.lvL != null)) e.push('a version 8 team run wrote the version 7 team fields');
  for (const [q, x] of [[A, xA], [B, xB]]) {
    const r = runOf(st, q, 'duo', RID), stp = PP.elpLevelStep8(x, { pass: true, depth: Tt, T: Tt, placing: -1 });
    if (!r || r[3] !== 2 || (r[5] | 0) !== Tt) e.push('seat ' + q.slice(-4) + ' target ' + (r && r[5]) + ' != ' + Tt);
    if (J(C(st, q).lv8 && C(st, q).lv8.duo) !== J(stp)) e.push('seat ' + q.slice(-4) + ' stepped ' + J(C(st, q).lv8) + ' != his own ' + J(stp));
  }
  if (out) Object.assign(out, { xA, xB, hi });
  return e;
}

// ---- [7] T9: version 6 / 7 runs settle exactly as before (fixture made with the job before O991) ----
// the world: solo version 6 placement + a version 7 player (placement, points, a quit, a death, a save resumed), a version 7 team
//   run, a conviction of a version 7 run, a version 7 run parked under the version 7 levers -- every settle the version 7 rules give
function v7WorldRun(m) {
  const st = { hist: {} }, t0 = T0 + 5000 * MIN, keepPub = m.RATING.PUB_VER, keepCut = m.RATING.CUTOVER_MS;
  const Pv = (n) => m.pid(SID(n));
  try {
    m.RATING.PUB_VER = 7; m.RATING.CUTOVER_MS = t0 + 500 * MIN;
    const a = Pv(61), b = Pv(62), c = Pv(63), d = Pv(64);
    [8, 10, 12].forEach((dd, i) => m.ratingHistUpsert(st, a, 'solo', 0, 9100 + i, dd, t0 + i * MIN, F, 5100 + i));
    const steps = [[6, F, false], [3, F, false], [9, F, false], [9, F, false], [4, F, true], [0, F, false], [7, SUS, false]];
    steps.forEach(([dd, fl, q], i) => m.ratingHistUpsert(st, b, 'solo', 0, 9200 + i, dd, t0 + (10 + i * 20) * MIN, fl, 5200 + i, { v7: true, quit: q }));
    m.ratingHistUpsert(st, b, 'solo', 0, 9206, 9, t0 + 200 * MIN, F, 5206, { v7: true, quit: false });   // the save resumed and ended
    [[12, 13, 14], [5, 6, 7]].forEach((ds, k) => ds.forEach((dd, i) => m.ratingHistUpsert(st, [c, d][k], 'solo', 0, 9300 + 10 * k + i, dd, t0 + i * MIN, F, 5300 + 10 * k + i, { v7: true, quit: false })));
    m.elpSettleAll(st, 0, t0 + 210 * MIN);
    m.elpTeamNote(st, 9400, [c, d], 'duo', 0, t0 + 220 * MIN);
    for (const q of [c, d]) m.ratingHistUpsert(st, q, 'duo', 0, 9400, 11, t0 + 220 * MIN, F, 5400, { v7: true, quit: false });
    // a member who stopped writing: d wrote one checkpoint, c went on to the end; the team's final segment ends d's copy
    //   (ratingHistFinal: a version 7 copy loses its version bit there, as it always did -- pinned unchanged)
    m.elpTeamNote(st, 9450, [c, d], 'duo', 0, t0 + 225 * MIN);
    for (const q of [d, c]) m.ratingHistUpsert(st, q, 'duo', 0, 9450, 5, t0 + 225 * MIN, 0, 5450, { v7: true, quit: false });
    m.ratingHistUpsert(st, c, 'duo', 0, 9450, 9, t0 + 228 * MIN, F, 5450, { v7: true, quit: false });
    m.ratingHistFinal(st, d, 'duo', 0, 9450);
    m.ratingHistUpsert(st, c, 'solo', 0, 9500, 6, t0 + 230 * MIN, SUS, 5500, { v7: true, quit: false });   // parked: the version 7 levers never cut it
    m.ratingHistUpsert(st, a, 'solo', 0, 9600, 5, t0 + 240 * MIN, SUS, 5600);                           // a version 6 run parked: cut past the instant
    m.elpSettleAll(st, 0, t0 + 600 * MIN);
    m.ratingHistRemove(st, b, 'solo', 0, 9202);   // a conviction of a version 7 points run
    m.elpSettleAll(st, 0, t0 + 700 * MIN);
    const rows = {};
    for (const p of [a, b, c, d]) { const sc = m.ratingScoreOf(st, p, 0, t0 + 800 * MIN); rows[p.slice(0, 8)] = sc ? sc.details : null; }
    return { hist: st.hist, elpTeam: st.elpTeam || null, rows };
  } finally { m.RATING.PUB_VER = keepPub; m.RATING.CUTOVER_MS = keepCut; }
}
function sV7World(m) {
  if (!fs.existsSync(V7_FIXTURE)) return ['no fixture ' + path.relative(ROOT, V7_FIXTURE)];
  const want = JSON.parse(fs.readFileSync(V7_FIXTURE, 'utf8')).world, got = JSON.parse(J(v7WorldRun(m)));
  const e = [];
  for (const k of Object.keys(want.hist)) if (J(got.hist[k]) !== J(want.hist[k])) e.push('hist ' + k.slice(0, 8) + k.slice(k.indexOf('|')) + ': ' + J(got.hist[k]).slice(0, 160) + ' != ' + J(want.hist[k]).slice(0, 160));
  if (Object.keys(got.hist).length !== Object.keys(want.hist).length) e.push('hist keys ' + Object.keys(got.hist).length + ' != ' + Object.keys(want.hist).length);
  if (J(got.elpTeam) !== J(want.elpTeam)) e.push('elpTeam ' + J(got.elpTeam) + ' != ' + J(want.elpTeam));
  if (J(got.rows) !== J(want.rows)) e.push('rows ' + J(got.rows) + ' != ' + J(want.rows));
  return e;
}

// ---- [8] T11 the cutover ----
function sCut(m) {
  const e = [], t = T0 + 600 * MIN, keepPub = m.RATING.PUB_VER, keepCut = m.RATING.CUTOVER_MS;
  const mk = () => {
    const st = world(), p6 = P(m, 70), p7 = P(m, 71), p8 = P(m, 72), q7 = P(m, 73);
    m.ratingHistUpsert(st, p6, 'solo', 0, 7500, 7, t, SUS, 9500);                          // version 6, parked
    m.ratingHistUpsert(st, p7, 'solo', 0, 7501, 9, t, SUS, 9501, V7);                      // version 7, parked at 9
    m.ratingHistUpsert(st, p8, 'solo', 0, 7502, 22, t, SUS, 9502, V8);                     // version 8, parked
    m.ratingHistUpsert(st, q7, 'solo', 0, 7503, 10, t + 1500, 0, 9503, V7);                // version 7, still being played (a checkpoint)
    return { st, p6, p7, p8, q7 };
  };
  try {
    m.RATING.CUTOVER_MS = t + 500;
    m.RATING.PUB_VER = 7;
    const a = mk();
    m.elpSettleAll(a.st, 0, t + 2000);
    if (!runOf(a.st, a.p6, 'solo', 7500)[3]) e.push('PUB_VER 7: the parked version 6 run did not settle');
    if (runOf(a.st, a.p7, 'solo', 7501)[3]) e.push('PUB_VER 7: a parked version 7 run was cut (its gate is not up)');
    m.RATING.PUB_VER = 8;
    const b = mk();
    m.elpSettleAll(b.st, 0, t + 2000);
    const r6 = runOf(b.st, b.p6, 'solo', 7500), r7 = runOf(b.st, b.p7, 'solo', 7501), r8 = runOf(b.st, b.p8, 'solo', 7502), rq = runOf(b.st, b.q7, 'solo', 7503);
    if (!r6[3]) e.push('PUB_VER 8: the parked version 6 run did not settle');
    if (!r7[3]) e.push('PUB_VER 8: the parked version 7 run did not settle at the cutover');
    else if ((r7[1] | 0) !== 9 || !Array.isArray(r7[10]) || !PP.elpLevelOf({ L: r7[10][0], Lm: r7[10][1], s: r7[10][2], last: r7[10][3], run: r7[10][4] }) || (C(b.st, b.p7).lv8)) e.push('PUB_VER 8: the cut version 7 run did not settle at its save depth under version 7 ' + J([r7[1], r7[10], C(b.st, b.p7).lv8]));
    if (r8[3]) e.push('PUB_VER 8: a parked version 8 run was cut');
    if (rq[3]) e.push('PUB_VER 8: a version 7 run still being played was cut (it may still pass)');
    m.RATING.CUTOVER_MS = t + 5000;
    const c = mk();
    m.elpSettleAll(c.st, 0, t + 2000);
    if (runOf(c.st, c.p7, 'solo', 7501)[3]) e.push('PUB_VER 8: a parked version 7 run settled before the cutover instant');
  } finally { m.RATING.PUB_VER = keepPub; m.RATING.CUTOVER_MS = keepCut; }
  return e;
}

// ---- [9] a conviction of a version 8 run ----
function sReplay(m) {
  const e = [], o = {};
  const e0 = sFirst(m, o);
  if (e0.length) return ['the world of [2]: ' + e0[0]];
  const { st, p, x7, after } = o, last = runOf(st, p, 'solo', 7002), lastPts = last[4];
  m.ratingHistRemove(st, p, 'solo', 0, 7001);   // the first version 8 run: the second one is replayed from the state before it
  const c = C(st, p), t = last[10][6] | 0;
  const exp = PP.elpLevelStep8(PP.elpLevelInit8(x7, [13, 11, 12], L7.solo, L8.solo), { pass: (last[1] | 0) >= t, depth: last[1] | 0, T: t, placing: -1 });
  if (J(c.lv8.solo) !== J(exp)) e.push('replayed ' + J(c.lv8.solo) + ' != ' + J(exp));
  if (J(c.lv.solo) !== J(x7)) e.push('the version 7 level moved ' + J(c.lv));
  if (last[4] !== lastPts) e.push('the later run\'s points moved');
  void after;
  return e;
}

// ---- [10] tables ----
function sTables(m) {
  const e = [], X8 = [21, 23, 25, 27, 30, 33, 39], X7 = [3, 7, 11, 17, 26, 36, 46];
  const st = { hist: {}, elpTab: [{ day: 20261201, season: 0, ms: T0, key: J([7, 1500]), byFam: { solo: { N: 30, pass: X7 } } }, { day: 20261202, season: 0, ms: T0 + DAY, key: J([8, 1500]), byFam: { solo: { N: 30, pass: X8 } } }] };
  if (J(m.elpLinesAt8(st, 'solo', 0, T0 + 10)) !== J(L8.solo)) e.push('a version 8 reading took the version 7 table');
  if (J(m.elpLinesAt8(st, 'solo', 0, T0 + DAY + 10)) !== J(X8)) e.push('a version 8 reading missed the version 8 table');
  if (J(m.elpLinesAt(st, 'solo', 0, T0 + DAY + 10, m.ELP_V7_TABS)) !== J(X7)) e.push('a version 7 reading took the version 8 table');
  if (J(m.elpLinesAt8(st, 'duo', 0, T0 + DAY + 10)) !== J(L8.duo)) e.push('a family the version 8 table lacks: not the version 8 prior');
  const keep = m.RATING.PUB_VER;
  try {
    m.RATING.PUB_VER = 8;
    if (m.tiercutEncode(0, {})[2] !== 8 || J(m.elpPriorPub()) !== J(L8) || !m.elpTableKey().startsWith('[8,') || J(m.tiercutEncode(0, {}).slice(8, 15)) !== J(L8.solo)) e.push('published version 8');
    if (m.elpCutVer() !== 8) e.push('elpCutVer at 8 = ' + m.elpCutVer());
    m.RATING.PUB_VER = 7;
    if (J(m.elpPriorPub()) !== J(L7) || m.elpCutVer() !== 7) e.push('published version 7');
    m.RATING.PUB_VER = 6;
    if (m.elpCutVer() !== 7) e.push('elpCutVer at 6 = ' + m.elpCutVer());
  } finally { m.RATING.PUB_VER = keep; }
  // the live lines: PUB_VER 8 reads lv8.Lm and leaves out a player without one; PUB_VER 7 the version 7 Lm
  const lv = { hist: {} }, a = P(m, 80), b = P(m, 81);
  for (const p of [a, b]) lv.hist[m.ratingHistKey(p, 'solo', 0)] = { best: [0, 0], runs: [[1, 20, T0, 2, 0, 20, T0, 1], [2, 22, T0 + 1, 2, 0, 22, T0 + 1, 1], [3, 24, T0 + 2, 2, 0, 24, T0 + 2, 1]], old: [], t: T0 };
  lv.hist[m.elpAllKey(a, 0)] = { lp: 3000, placed: 1, n: 3, ring: [], lv: { solo: S(1500, 1450, 2, 1, 1) }, lv8: { solo: S(2700, 2650, 2, 1, 1) } };
  lv.hist[m.elpAllKey(b, 0)] = { lp: 3000, placed: 1, n: 3, ring: [], lv: { solo: S(1300, 1250, 2, 1, 1) } };
  try {
    m.RATING.PUB_VER = 8;
    const h8 = m.elpHiddensOf(lv, 'solo', 0);
    if (J(h8) !== J({ [a]: 2650 })) e.push('PUB_VER 8 lines read ' + J(h8) + ' (want lv8.Lm of the one player holding it)');
    m.RATING.PUB_VER = 7;
    const h7 = m.elpHiddensOf(lv, 'solo', 0);
    if (h7[a] !== 1450 || h7[b] !== 1250) e.push('PUB_VER 7 lines read ' + J(h7));
  } finally { m.RATING.PUB_VER = keep; }
  return e;
}

// ---- [11] T12 rows ----
function sRows(m) {
  const e = [], R = m.RATING, Q = m.__PP || PP;   // the reader of the module under test (a mutant's own copy)
  if (J(R.ROW_VERS) !== J([1, 2, 3, 4]) || Q.ELP.ROW_VER_LV8 !== 4) e.push('ROW_VERS ' + J(R.ROW_VERS));
  const st = { hist: {} }, p2 = P(m, 82), p3 = P(m, 83), p4 = P(m, 84);
  st.hist[m.elpAllKey(p2, 0)] = { lp: 1000, placed: 1, n: 4, ring: [], h: [800, null, null, null], ht: 1 };
  st.hist[m.elpAllKey(p3, 0)] = { lp: 1000, placed: 1, n: 4, ring: [], h: [800, null, null, null], ht: 1, lv: { solo: S(900, 880, 2, 1, 1) } };
  st.hist[m.elpAllKey(p4, 0)] = { lp: 1000, placed: 1, n: 4, ring: [], h: [800, null, null, null], ht: 1, lv: { solo: S(900, 880, 2, 1, 1) }, lv8: { duo: S(2900, 2880, 2, 1, 1) } };
  const ver = (p) => ((m.ratingScoreOf(st, p, 0, 1).details[0] >>> 8) & 0xff);
  if (ver(p2) !== 2 || ver(p3) !== 3 || ver(p4) !== 4) e.push('the job writes ' + J([ver(p2), ver(p3), ver(p4)]) + ' (want v2 / v3 / v4)');
  const r4 = Q.elpRowOf(m.ratingScoreOf(st, p4, 0, 1).details);
  if (!r4 || J(r4.lv8.duo) !== J(S(2900, 2880, 2, 1, 1)) || J(r4.lv.solo) !== J(S(900, 880, 2, 1, 1)) || r4.lv8.solo !== null) e.push('v4 read ' + J(r4));
  // rows the job before O991 wrote (v2 / v3), read by this reader: the same values, lv8 none
  if (!fs.existsSync(ROWS_FIXTURE)) e.push('no fixture ' + path.relative(ROOT, ROWS_FIXTURE));
  else for (const x of JSON.parse(fs.readFileSync(ROWS_FIXTURE, 'utf8')).rows) {
    const got = Q.elpRowOf(x.det), o = x.read;
    const want = o == null ? null : { n: o.n, tier: o.tier, placed: o.placed, h: o.h, lv: o.lv, lv8: { solo: null, duo: null, trio: null, quad: null }, ring: o.ring };
    if (want && J(got) !== J(want)) e.push(x.name + ': ' + J(got) + ' != ' + J(want));
    if (!want && got !== null) e.push(x.name + ': read as a row');
  }
  return e;
}

// ---- [12] Q3 milestones ----
function sMilestones(m) {
  const e = [], list = (fam) => PP.elpMilestones8(fam);
  const crossed = (L, depths) => { const run = { ms: 0 }, out = []; for (const d of depths) out.push(...m.soloMilestones(run, d, L).map((x) => x[0])); return out; };
  if (J(crossed(list('solo'), [20, 25, 26, 30, 33])) !== J([26, 29, 33])) e.push('solo ' + J(crossed(list('solo'), [20, 25, 26, 30, 33])));
  if (J(crossed(list('duo'), [31, 32, 40, 41])) !== J([32, 36, 41]) || J(crossed(list('trio'), [41])) !== J([32, 36, 41])) e.push('duo / trio');
  if (J(crossed(list('quad'), [34, 35, 43, 44])) !== J([35, 40, 44])) e.push('quad ' + J(crossed(list('quad'), [34, 35, 43, 44])));
  if (J(crossed(null, [10, 20, 30])) !== J([10, 20, 30])) e.push('the version 7 list (no list given)');
  const run = { ms: 0 }; m.soloMilestones(run, 12, null);   // a version 7 run crossed the first step this season
  if (J(m.soloMilestones(run, 26, list('solo'))) !== J([])) e.push('the first step paid twice in a season (version 7 at 10, then version 8 at 26)');
  const cp = (L, d) => m.soloMilestones({ ms: 0 }, d, L).reduce((a, x) => a + x[1], 0);
  if (cp(list('solo'), 33) !== 270 || cp(null, 30) !== 270) e.push('CP 40 / 80 / 150 both ways');
  const src = m.__SRC || SRC;   // a mutant carries its own source
  if (!/const msSolo = elpSegLv\(v, f\)\.v8 \? pointsPlan\.elpMilestones8\('solo'\) : null;/.test(src) || !/f\.endDepth, msSolo\)\) \{/.test(src)) e.push('the solo call site does not pass the version 8 list');
  if (!/f\.endDepth, \(\(f\.flags \| 0\) & attest\.SEG_V8\) \? pointsPlan\.elpMilestones8\(fam\.low\) : null\)\) \{/.test(src)) e.push('the team call site does not pass the version 8 list of its family');
  return e;
}

// ---- [13] T14 the gate in the job ----
function sGate(m) {
  const e = [], t0 = T0 + 900 * MIN;
  for (const [Lm, held] of [[3535, true], [3536, false]]) {
    const st = world(), p = P(m, 90);
    st.hist[m.ratingHistKey(p, 'solo', 0)] = { best: [0, 0], runs: [], old: [], t: t0 };
    st.hist[m.elpAllKey(p, 0)] = { lp: 5850, placed: 1, n: 9, ring: [], t: t0, lv8: { solo: S(3600, Lm, 3, 1, 1) } };
    const seed = 19, Tt = PP.elpTargetOfL8(3600, seed);
    m.ratingHistUpsert(st, p, 'solo', 0, 7600, Tt, t0 + MIN, F, seed, V8);
    m.elpSettleAll(st, 0, t0 + 2 * MIN);
    const lp = C(st, p).lp | 0;
    if (held && lp > 5879) e.push('Lm ' + Lm + ' (under 104 % of the master line): the pass went to ' + lp);
    if (!held && lp <= 5879) e.push('Lm ' + Lm + ' (104 % reached): the pass was held at ' + lp);
  }
  return e;
}

// ---- [14] a member who stopped writing (review 2026-11-23): the team's final segment ends his copy (ratingHistFinal); a version 8
//   copy keeps its version and settles on the team's version 8 line like the seat that played on ----
function sDropped(m) {
  const e = [], st = world(), t0 = T0 + 1100 * MIN, RID = 7801, seed = 2;
  const xA7 = S(1000, 980, 3, 1, 2), xB7 = S(700, 680, 3, 0, 2), dA = [11, 10, 12], dB = [7, 6, 8];
  const A = v7Holder(m, st, 93, 'duo', xA7, dA, 3000, t0), B = v7Holder(m, st, 94, 'duo', xB7, dB, 1500, t0);
  const xA = PP.elpLevelInit8(xA7, newestFirst(dA), L7.duo, L8.duo), xB = PP.elpLevelInit8(xB7, newestFirst(dB), L7.duo, L8.duo);
  const Tt = PP.elpTargetOfL8(Math.max(xA.L, xB.L), seed), at = t0 + 30 * MIN;
  m.elpTeamNote(st, RID, [A, B], 'duo', 0, at);
  for (const q of [B, A]) m.ratingHistUpsert(st, q, 'duo', 0, RID, 20, at, 0, seed, V8);   // both wrote the first checkpoint; B stopped there
  m.ratingHistUpsert(st, A, 'duo', 0, RID, Tt, at + 10 * MIN, F, seed, V8);
  m.ratingHistFinal(st, B, 'duo', 0, RID);
  m.elpSettleAll(st, 0, at + 11 * MIN);
  const rA = runOf(st, A, 'duo', RID), rB = runOf(st, B, 'duo', RID), tm = st.elpTeam && st.elpTeam[String(RID)];
  // his copy is a miss at 20 against one of the team's frozen lines (the one that costs him least: elpLvChoose8), read as version 8
  const lineTs = ((tm && tm.lvLns8) || []).map((ln) => PP.elpTargetOfL8(ln * 100, seed));
  if (!rB || m.elpRunVer(rB) !== 8) e.push('the copy of the member who stopped lost its version: fl ' + (rB && rB[7]));
  else if (rB[3] !== 2 || !rA || (rA[5] | 0) !== Tt || lineTs.indexOf(rB[5] | 0) < 0 || !Array.isArray(rB[10]) || !PP.elpLevelOf8({ L: rB[10][0], Lm: rB[10][1], s: rB[10][2], last: rB[10][3], run: rB[10][4] }) || !(C(st, B).lv8 && C(st, B).lv8.duo)) e.push('his copy did not settle on a team line under version 8: ' + J([rB[3], rB[5], lineTs, rA && rA[5], Tt, rB[10], C(st, B).lv8]));
  return e;
}

// ---- [15] a client still on the version 8 prior a day after the job recorded a version 8 table (review 2026-11-23): his first
//   version 8 run read his start through the prior (a lower target than the table gives); he passed at it -- not a miss ----
function sPrior8(m) {
  const e = [], st = world(), x7 = S(1200, 1150, 3, 1, 2), ds = [12, 11, 13], t0 = T0 + 1200 * MIN, HI8 = [24, 26, 28, 30, 33, 36, 42];
  st.elpTab.push({ day: 20251122, season: 0, ms: T0 - 2 * DAY, key: J([8, 1500]), byFam: { solo: { N: 30, pass: HI8 } } });
  const p = v7Holder(m, st, 95, 'solo', x7, ds, 2500, t0);
  const xc = PP.elpLevelInit8(x7, newestFirst(ds), L7.solo, L8.solo), xt = PP.elpLevelInit8(x7, newestFirst(ds), L7.solo, HI8);
  let seed = 0, Tc = 0, Tt = 0;
  for (const s2 of [2, 4, 19, 6, 1]) { const a = PP.elpTargetOfL8(xc.L, s2), b = PP.elpTargetOfL8(xt.L, s2); if (a < b) { seed = s2; Tc = a; Tt = b; break; } }
  if (!seed) return ['the world is not a real test: ' + J([xc, xt])];
  const at = t0 + 30 * MIN;
  m.ratingHistUpsert(st, p, 'solo', 0, 7901, Tc, at, F, seed, V8);   // his client's line ended the run at Tc
  m.elpSettleAll(st, 0, at + 1000);
  const r = runOf(st, p, 'solo', 7901);
  if (!r || r[3] !== 2 || (r[5] | 0) > Tc) e.push('his pass at ' + Tc + ' (the prior) was judged against ' + (r && r[5]) + ' (the table gives ' + Tt + ')');
  return e;
}

// ---- the fixtures (made once, with the job before O991; see the header) ----
if (fxArg) {
  const old = require(path.resolve(fxArg));
  const w = JSON.parse(J(v7WorldRun(old)));
  fs.mkdirSync(path.dirname(V7_FIXTURE), { recursive: true });
  fs.writeFileSync(V7_FIXTURE, J({ about: 'O991 T9: version 6 / 7 runs settled by the job before version 8 (test/endless-level8.js v7WorldRun); every value must stay', world: w }) + '\n');
  console.log('wrote ' + path.relative(ROOT, V7_FIXTURE));
  process.exit(0);
}
if (rowsArg) {
  const OPP = require(path.resolve(rowsArg));
  const ring = [{ mh: -5, delta: 40, flags: 264 }, { mh: 77, delta: -13, flags: 258 }];
  const mk = (name, row) => { const det = OPP.elpRowDetails(row, ring); return { name, det, read: OPP.elpRowOf(det) }; };
  const rows = [
    mk('v2, solo and duo skills', { n: 7, tier: 1, placed: 1, h: { solo: 950, duo: 1480 } }),
    mk('v2, no skill', { n: 9, tier: 3, placed: 1 }),
    mk('v3, a solo level and a duo level', { n: 7, tier: 2, placed: 1, h: { solo: 950, duo: 1480 }, lv: { solo: { L: 940, Lm: 905, s: 3, last: 1, run: 2 }, duo: { L: 1500, Lm: 1420, s: 6, last: 0, run: 1 } } }),
    mk('v3, a quad level only', { n: 12, tier: 4, placed: 1, h: { quad: 2400 }, lv: { quad: { L: 2400, Lm: 2380, s: 1, last: 1, run: 15 } } }),
    { name: 'v1, the per-family row', det: [0xEE | 256, 7, 950, 1, 1, 198, 0], read: null },
  ];
  fs.mkdirSync(path.dirname(ROWS_FIXTURE), { recursive: true });
  fs.writeFileSync(ROWS_FIXTURE, J({ about: 'O991 T12: points rows written by the job before version 8 (its points-plan.js) and how its reader read them', rows }) + '\n');
  console.log('wrote ' + path.relative(ROOT, ROWS_FIXTURE));
  process.exit(0);
}

const SCEN = [['[1] intake: ELP_R_V8 alone, kept; elpSegLv / elpRunVer; an elp-8 key and the dev key under ELP_DEV_VER=8 read 8; team COMP | LINE | V8 at 2..4 seats, V8 alone / with classic / an unknown bit rejected', sIntake],
  ['[2] his first version 8 run starts from his version 7 level read on the version 8 scale (one reading here), target / points / states by ELP8, the version 7 level stays, the next run reads the version 8 level, the row is v4', sFirst],
  ['[3] the cap: a version 7 level far above his newest runs starts at the deepest of them x1.15 read on the version 8 scale', sCap],
  ['[4] a new player: three version 8 placement runs from the silver line, the third seeds from the version 8 level, the row v4 carries it alone', sPlace],
  ['[5] R2: a death in the grow phase (15 or 0 levels passed) takes points and leaves the level; one at 16 moves it', sR2],
  ['[6] team: the roster\'s highest version 8 level is the line (frozen in hasLv8 / lvL8 / lvLns8, + the O992 line), each member steps his own', sTeam],
  ['[7] T9 version 6 / 7 runs (solo, a team run, a quit, a save, a conviction, the version 7 levers) settle to the values of the job before O991', sV7World],
  ['[8] T11 the cutover: under PUB_VER 7 a parked version 7 run waits; under 8 it settles at its save depth (version 7 rules), never a version 8 run or one still being played, never before the instant', sCut],
  ['[9] a conviction of a version 8 run replays the version 8 level from the state before it; the version 7 level and the later points stay', sReplay],
  ['[10] tables: version 8 readings take version 8 tables only, version 7 readings never; PUB_VER 8 publishes 8 with the version 8 priors, elpCutVer; the live lines read lv8.Lm (no lv8 = left out) under 8, lv.Lm under 7', sTables],
  ['[11] T12 rows: the job writes v2 / v3 / v4 by what the player holds, v4 reads back, the rows of the job before O991 read the same (lv8 none), ROW_VERS lists 4', sRows],
  ['[12] Q3 milestones: the version 8 steps by family, the version 7 ones without a list, one step once a season either way, both call sites pass the list by the run\'s version', sMilestones],
  ['[13] T14 the gate in the job: a diamond pass is held under master at Lm 35.35 and goes through at 35.36 (104 % of 34)', sGate],
  ['[14] a member who stopped writing: his version 8 copy keeps its version when the team\'s final segment ends it and settles on the team line', sDropped],
  ['[15] a client still on the version 8 prior a day after a version 8 table was recorded: his pass at the prior\'s lower target is a pass', sPrior8]];
console.log('-- O991 version 8: the job --');
for (const [label, fn] of SCEN) { let e; try { e = fn(v); } catch (err) { e = ['threw: ' + (err && err.stack || err).toString().slice(0, 300)]; } T(label, e.length === 0, e.slice(0, 3).join(' | ')); }

// ---- [20] mutations ----
function mutantOf(pairs, ppPairs) {
  const ROOTF = ROOT.replace(/\\/g, '/');
  let s = SRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); s = s.split(good).join(badS); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-level8-'));
  if (ppPairs && ppPairs.length) {
    let q = PPSRC;
    for (const [good, badS] of ppPairs) { if (q.indexOf(good) < 0) throw new Error('mutation anchor missing (points-plan): ' + good.slice(0, 90)); q = q.split(good).join(badS); }
    fs.writeFileSync(path.join(dir, 'points-plan.js'), q);
    s = s.replace(/require\('\.\/points-plan\.js'\)/g, "require('" + dir.replace(/\\/g, '/') + "/points-plan.js')");
  }
  s = s.replace(/require\('\.\//g, "require('" + ROOTF + '/').replace(/__dirname/g, JSON.stringify(ROOTF));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, s);
  try {
    delete require.cache[p];
    const mod = require(p); mod.__SRC = s;
    if (ppPairs && ppPairs.length) mod.__PP = require(path.join(dir, 'points-plan.js'));   // the copy the mutant loaded (the require cache)
    return mod;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const MUTS = [
  ['a version 8 run settles by the version 7 rules (no dispatch)', [['  if ((r[7] | 0) & ELP_R_V8) return elpSettleRunLv8(st, p, c, h, r, fam, s, nowMs, ctx);', '  if (false) return elpSettleRunLv8(st, p, c, h, r, fam, s, nowMs, ctx);']], [], sFirst],
  ['T9: the version by the first-seen instant (every run version 8 by time)', [['  if ((r[7] | 0) & ELP_R_V8) return elpSettleRunLv8(st, p, c, h, r, fam, s, nowMs, ctx);', '  if ((r[2] || 0) >= 0) return elpSettleRunLv8(st, p, c, h, r, fam, s, nowMs, ctx);']], [], sV7World],
  ['a version 8 run also carries ELP_R_V7', [['const vb = (lv && lv.v8) ? ELP_R_V8 : (lv && lv.v7) ? ELP_R_V7 : 0,', 'const vb = (lv && lv.v8) ? (ELP_R_V8 | ELP_R_V7) : (lv && lv.v7) ? ELP_R_V7 : 0,']], [], sIntake],
  ['a later segment drops the version 8 bit', [['| ((r[7] | 0) & (ELP_R_V7 | ELP_R_V8 | ELP_R_QUIT)) |', '| ((r[7] | 0) & (ELP_R_V7 | ELP_R_QUIT)) |']], [], sIntake],
  ['T10: the team sanity drops SEG_V8 from the accepted bits', [['| attest.SEG_CLASSIC | attest.SEG_LINE | attest.SEG_V8)) !== 0', '| attest.SEG_CLASSIC | attest.SEG_LINE)) !== 0']], [], sIntake],
  ['T10: SEG_V8 accepted without SEG_LINE', [[' || ((fl & attest.SEG_V8) && !(fl & attest.SEG_LINE))) out.push(\'flags\');', ') out.push(\'flags\');']], [], sIntake],
  ['T10: the team intake drops the version 8 bit (its runs would settle as version 7)', [['quit: false, v8: !!((f.flags | 0) & attest.SEG_V8) });', 'quit: false });']], [], sIntake],
  ['the first version 8 run starts from the version 7 level as it is (no conversion)', [], [['const L = Math.max(FL, Math.min(cap, elpConvert(x7.L, lines7, lines8))), Lm = Math.max(FL, Math.min(cap, elpConvert(x7.Lm, lines7, lines8)));', 'const L = Math.max(FL, Math.min(cap, x7.L)), Lm = Math.max(FL, Math.min(cap, x7.Lm));']], sFirst],
  ['the conversion without the cap', [], [['const cap = ds.length ? elpConvert(', 'const cap = false ? elpConvert(']], sCap],
  ['the first version 8 run reads the silver line (the version 7 level ignored)', [['  if (!v7s.length) for (const l8 of l8s) xs.push(pointsPlan.elpLevelInit8(null, depths, null, l8));', '  for (const l8 of l8s) xs.push(pointsPlan.elpLevelInit8(null, depths, null, l8)); if (false)']], [], sFirst],
  ['a version 8 run reads the version 7 level again (not its version 8 one)', [['  if (have) return elpLvUniq([have].concat(elpLvSet8(c, fam)));', '  if (false) return [have];']], [], sFirst],
  ['a version 8 run steps the version 7 level (lv) instead of lv8', [['  (c.lv8 = c.lv8 || {})[fam] = after;', '  (c.lv = c.lv || {})[fam] = after;']], [], sFirst],
  ['R2 back to "no level passed" only', [], [['if (!pass && depth <= ELP8.GROW_END) return x;', 'if (!pass && depth === 0) return x;']], sR2],
  ['R2 gone (every death moves the level)', [], [['if (!pass && depth <= ELP8.GROW_END) return x;', 'void 0;']], sR2],
  ['the team line is the LOWEST version 8 level', [['tm.lvL8 = pointsPlan.elpTeamLine(sets.map((xs) => xs[0]));', 'tm.lvL8 = Math.min.apply(null, sets.map((xs) => xs[0]));']], [], sTeam],
  ['every member takes the team line (the ratchet)', [['const after8 = pointsPlan.elpLevelStep8(a.rd.x, { pass: depth >= a.t, depth, T: a.t, quit, placing });', 'const after8 = pointsPlan.elpLevelStep8(Object.assign({}, a.rd.x, { L: a.rd.L }), { pass: depth >= a.t, depth, T: a.t, quit, placing });']], [], sTeam],
  ['T11: the cutover keeps cutting version 6 only (the version 7 rule)', [['function elpCutVer() { return Math.max(7, RATING.PUB_VER | 0); }', 'function elpCutVer() { return 7; }']], [], sCut],
  ['T11: the cutover cuts every version (a parked version 8 run too)', [[' && elpRunVer(r) < elpCutVer() && !!((r[7] | 0) & 2);', ' && !!((r[7] | 0) & 2);']], [], sCut],
  ['T11: the cutover cuts runs still being played', [[' && elpRunVer(r) < elpCutVer() && !!((r[7] | 0) & 2);', ' && elpRunVer(r) < elpCutVer();']], [], sCut],
  ['a conviction does not replay the version 8 level', [['  if (lvGone8 && c) elpLevelReplay8(c, h, fam, lvGone8);', '  if (false) elpLevelReplay8(c, h, fam, lvGone8);']], [], sReplay],
  ['a version 8 reading takes any table (version 7 lines)', [['&& elpTabVer(x) >= 8) at = x;', '&& elpTabVer(x) >= 0) at = x;']], [], sTables],
  ['a version 7 reading takes version 8 tables (maxVer back to Infinity)', [['const ELP_V7_TABS = 7;', 'const ELP_V7_TABS = Infinity;']], [], sTables],
  ['the version 8 live lines read the version 7 levels', [['      if (lv8) out[p] = lv8.Lm;\n      continue;', '      void lv8;']], [], sTables],
  ['PUB_VER 8 publishes the version 7 priors', [['function elpPriorPub() { return RATING.PUB_VER >= 8 ? pointsPlan.ELP8.PRIOR : RATING.PUB_VER >= 7', 'function elpPriorPub() { return RATING.PUB_VER >= 9 ? pointsPlan.ELP8.PRIOR : RATING.PUB_VER >= 7']], [], sTables],
  ['T12: the row stays v3 (no version 8 states)', [['placed: 1, h, lv: c.lv || null, lv8: c.lv8 || null }, c.ring || []);', 'placed: 1, h, lv: c.lv || null }, c.ring || []);']], [], sRows],
  ['T12: the reader drops v3 rows', [], [['if (ver !== ELP.ROW_VER && ver !== ELP.ROW_VER_LV && ver !== ELP.ROW_VER_LV8) return null;', 'if (ver !== ELP.ROW_VER && ver !== ELP.ROW_VER_LV8) return null;']], sRows],
  ['Q3: the team call site pays the version 7 steps for a version 8 run', [['f.endDepth, ((f.flags | 0) & attest.SEG_V8) ? pointsPlan.elpMilestones8(fam.low) : null)) {', 'f.endDepth, null)) {']], [], sMilestones],
  ['Q3: soloMilestones ignores the list', [['const out = [], L = (Array.isArray(list) && list.length) ? list : COMP.MILESTONES;', 'const out = [], L = COMP.MILESTONES;']], [], sMilestones],
  ['T14: the gate back to 100 % (the version 7 rule)', [], [['GATE: 104, TEAM_GATE: 104,', 'GATE: 100, TEAM_GATE: 104,']], sGate],
  ['a member who stopped writing loses the version 8 bit (ratingHistFinal as before O991)', [['  r[7] = 1 | ((r[7] | 0) & ELP_R_V8);', '  r[7] = 1;']], [], sDropped],
  ['the version 8 prior is not among the first-run lines', [['.map((tb) => tb[fam]), [pointsPlan.ELP8.PRIOR[fam]]));', '.map((tb) => tb[fam])));']], [], sPrior8],
];
console.log('-- [20] mutations --');
for (const [label, pairs, ppPairs, fn] of MUTS) {
  let red = false, why = '';
  try { const e = fn(mutantOf(pairs, ppPairs)); red = e.length > 0; why = e[0] || ''; }
  catch (err) { if (/anchor missing/.test(err.message)) { bad('[20] ' + label + ': ' + err.message); continue; } red = true; why = 'threw: ' + err.message.slice(0, 80); }
  T('[20] mutation "' + label + '" turns its check red', red, why);
}
console.log(failN ? 'FAIL (endless-level8) ' + failN : 'endless-level8: all ok');
process.exit(failN ? 1 : 0);
