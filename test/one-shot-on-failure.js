'use strict';
// One-shot writes stay one-shot when the run FAILS after them (audit R1-B2-03, 2026-10-08). The interrupted-match
// consolation XP and the confession points fine / refund are relative writes ("board value now + delta") that land
// before the run's normal state save. A later exit in the same run (STRICT_BOARDS listing wobble, aborted read, a
// crash, the step timeout) used to drop their markers, and the next run paid / fined / refunded the same match
// again -- once per failing run. Two halves, both pinned here:
//   code     -- validate.js puts the markers on disk next to the writes (saveEarlyMarks: ahead of the consolation
//               loop, after every confession points write) and writes every state file atomically
//   workflow -- the persist step commits the state files after a failed run too (always(), not after a skipped run),
//               the run step times out before the job so persist still gets its turn
// End-to-end over the REAL validate.js main() against an offline board stub, several runs carrying the on-disk state
// forward exactly as a persist-on-failure workflow would:
//   [1] ranked confession, run fails right after (report board absent): one fine across a failing run, another
//       failing run and a healthy one; the exit-rate hit counted once
//   [2] consolation paid, then the run fails: one credit across three runs, the verdict's exit-rate hit once
//   [3] consolation paid, then the confession path itself fails (points board absent): still one credit
//   [4] honest confession refunded, then the run fails: one refund across three runs
//   [5] APPLY_MMR=0 dry-run: the early marks write no state file (same as the early-exit persist)
//   [6] reconcileConfessions checkpoint contract (in-process): called after each points write, with the write
//       already applied; never for an exit-rate-only confession
//   [7] source pins (marks saved right after the starts verdict, copy of confState, checkpoint wired, atomic writes)
//   [8] workflow pins (validate / playtest / demo: run step timeout below the job's, persist always() unless the run
//       was skipped, replicate after a landed persist)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'CONSOLATION_XP', 'REPORT_LB', 'TRUST_LB', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY',
  'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub (writes are logged, not applied: assertions count writes per run)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state.
// The state files are read back whatever the exit code: that is what a persist-on-failure step commits.
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'one-shot-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock: the points board name is season-derived
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',   // world() lists shard_0..shard_7 = the full record shard set (knobs of R1-B2-04; inert before it)
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    const leftovers = fs.readdirSync(dir).filter(f => /\.tmp$/.test(f));
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, leftovers };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  for (const f of ['STARTS_FILE', 'CONFESSIONS_FILE']) { const st = files[f] || {}; for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; } }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const writesTo = (r, boardId, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(p.body)));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const confOf = (r, sid, m) => (r.state.CONFESSIONS_FILE || {})[v.pid(sid) + '|' + m];
const count = (s, re) => (s.match(re) || []).length;
const tail = (r) => r.out.slice(-700);

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// ledger record, result-reporter wire form: magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc. Start (0xB2) / confession (0xB5) records zero every result field.
function rec(magic, mt, hash, seat, sids, disp) {
  const settle = magic === 0xB1, pc = sids.length;
  const d = [magic, settle ? 3 : 1, mt, hash | 0, 1234, seat, settle ? seat + 1 : 0, settle ? ((6 << 1) | (seat === 0 ? 1 : 0)) : 0, pc, settle ? 720 : 0];
  for (let i = 0; i < pc; i++) d.push(settle ? 9000 - 4000 * i : 0);
  d.push(disp | 0);
  for (const s of sids) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const HOUR = 3600000, MIN = 60000;
// rows: [{ shard, sid, d }] -- one row per (shard, account), like the real boards
function world(rows, extra) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  return boards.concat(extra);
}
const MAIN = { RANKED_LB: 'rating', LP_LB: 'points' };
const PT = { PT_MODE: '1' };
const STRICT = { STRICT_BOARDS: '1' };   // the production setting; no report_box in these worlds = exit 1 after the early writes
const env = (...xs) => Object.assign({}, ...xs);
const REPORT_EXIT = /::error::report board absent/;

// ---- [1] ranked confession, then the run fails ----
console.log('-- [1] confession fine, then a failing exit --');
{
  const K = 0x4101, sids = [C, D];
  const conf = { shard: 0, sid: C, d: rec(0xB5, 2, K, 0, sids, 5) };   // C quit a ranked match
  const key = keyOf(conf.d);
  const extra = [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: C, score: 2000 }, { steamID: D, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] }];
  const fines = (r) => writesTo(r, 7, C).length;
  const r1 = runCron(world([conf], extra), null, env(MAIN, STRICT));
  T('[1] run 1 fails after the confession block', r1.code === 1 && REPORT_EXIT.test(r1.out), tail(r1));
  T('[1] run 1: fined once (-100)', fines(r1) === 1 && /score=1900(&|$)/.test(writesTo(r1, 7, C)[0] ? writesTo(r1, 7, C)[0].body : ''));
  const st1 = confOf(r1, C, key);
  T('[1] run 1: the fine\'s marker is on disk despite the failure (deducted amount kept for a refund)', !!st1 && st1.ded === 100, JSON.stringify(r1.state.CONFESSIONS_FILE));
  T('[1] run 1: the exit-rate hit is on disk too', leavesOf(r1, C) === 1);
  T('[1] run 1: no half-written temp file left behind', r1.leftovers.length === 0, r1.leftovers.join(','));
  const r2 = runCron(world([conf], extra), advance(r1.state, 10 * MIN), env(MAIN, STRICT));
  T('[1] run 2 (still failing): no second fine, exit rate unchanged', r2.code === 1 && fines(r2) === 0 && leavesOf(r2, C) === 1, tail(r2));
  const r3 = runCron(world([conf], extra), advance(r2.state, 10 * MIN), MAIN);
  T('[1] run 3 (healthy): no fine, exit rate unchanged', r3.code === 0 && fines(r3) === 0 && leavesOf(r3, C) === 1, tail(r3));
  T('[1] exactly one fine across the three runs', fines(r1) + fines(r2) + fines(r3) === 1);
}

// interrupted-match world: a quick match whose start was registered 3h ago (past maturity); A quit (confession),
// B finished alone (lone settle record) -> the matured verdict consoles B
const orphanWorld = (K, extra) => {
  const sids = [A, B];
  const rows = [
    { shard: 1, sid: A, d: rec(0xB5, 1, K, 0, sids, 5) },
    { shard: 2, sid: B, d: rec(0xB1, 1, K, 1, sids) },
  ];
  const key = keyOf(rows[0].d);
  // t0 3h back: maturity is 2h, so the verdict is due on the first run with an hour to spare; both wrote their start
  // records when the entry was registered (Q69: the verdict convicts only a seat whose own start is on file)
  const starts = { [key]: { t0: Date.now() - 3 * HOUR, mt: 1, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [], started: [v.pid(A), v.pid(B)] } };
  return { boards: world(rows, extra), key, starts };
};

// ---- [2] consolation paid, then the run fails ----
console.log('-- [2] consolation, then a failing exit --');
{
  const w = orphanWorld(0x4202, [{ id: 5, name: 'progress', entries: [{ steamID: B, score: 1000 }] }, { id: 8, name: 'cp_bank', entries: [] }]);
  const credits = (r) => writesTo(r, 5, B).length;
  const r1 = runCron(w.boards, { STARTS_FILE: w.starts }, env(PT, STRICT));
  T('[2] run 1 fails after the consolation', r1.code === 1 && REPORT_EXIT.test(r1.out), tail(r1));
  T('[2] run 1: B consoled once (+50)', credits(r1) === 1 && /score=1050(&|$)/.test(writesTo(r1, 5, B)[0] ? writesTo(r1, 5, B)[0].body : ''), tail(r1));
  T('[2] run 1: the verdict\'s key is processed on disk and its pending entry gone', processedOf(r1).has(w.key) && !(r1.state.STARTS_FILE || {})[w.key]);
  const r2 = runCron(w.boards, advance(r1.state, 10 * MIN), env(PT, STRICT));
  T('[2] run 2 (still failing): no second credit', r2.code === 1 && credits(r2) === 0, tail(r2));
  const r3 = runCron(w.boards, advance(r2.state, 10 * MIN), PT);
  T('[2] run 3 (healthy): no credit', r3.code === 0 && credits(r3) === 0, tail(r3));
  T('[2] exactly one credit across the three runs', credits(r1) + credits(r2) + credits(r3) === 1);
  T('[2] A\'s exit counted exactly once', leavesOf(r3, A) === 1, JSON.stringify(r3.state.LEAVERS_FILE));
}

// ---- [3] consolation paid, then the confession path itself fails ----
console.log('-- [3] consolation, then the points board is missing on the confession path --');
{
  const base = [{ id: 5, name: 'progress', entries: [{ steamID: B, score: 1000 }] }, { id: 6, name: 'rating', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
  const w = orphanWorld(0x4303, base);
  const credits = (r) => writesTo(r, 5, B).length;
  const r1 = runCron(w.boards, { STARTS_FILE: w.starts }, env(MAIN, STRICT));
  T('[3] run 1 fails on the confession path, after the consolation', r1.code === 1 && /::error::points board absent \(confession path\)/.test(r1.out) && credits(r1) === 1, tail(r1));
  const r2 = runCron(w.boards, advance(r1.state, 10 * MIN), env(MAIN, STRICT));
  T('[3] run 2 (still failing): no second credit', r2.code === 1 && credits(r2) === 0, tail(r2));
  const healed = orphanWorld(0x4303, base.concat([{ id: 7, name: 'points', entries: [] }])).boards;
  const r3 = runCron(healed, advance(r2.state, 10 * MIN), MAIN);
  T('[3] run 3 (board back): no credit', r3.code === 0 && credits(r3) === 0, tail(r3));
}

// ---- [4] honest confession refunded, then the run fails ----
console.log('-- [4] refund, then a failing exit --');
{
  const K = 0x4404, sids = [C, D];
  const conf = { shard: 0, sid: C, d: rec(0xB5, 2, K, 0, sids, 5) };
  const key = keyOf(conf.d);
  const settles = [{ shard: 3, sid: C, d: rec(0xB1, 2, K, 0, sids) }, { shard: 3, sid: D, d: rec(0xB1, 2, K, 1, sids) }];   // C came back and finished
  const extra = [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: C, score: 2000 }, { steamID: D, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] }];
  const refunds = (r) => count(r.out, /confess-forgive /g);
  const r0 = runCron(world([conf], extra), null, MAIN);
  T('[4] run 0 (healthy): fined at quit time', r0.code === 0 && writesTo(r0, 7, C).length === 1 && (confOf(r0, C, key) || {}).ded === 100, tail(r0));
  const r1 = runCron(world([conf].concat(settles), extra), advance(r0.state, 10 * MIN), env(MAIN, STRICT));
  T('[4] run 1 refunds once, then fails', r1.code === 1 && REPORT_EXIT.test(r1.out) && refunds(r1) === 1 && /score=2100(&|$)/.test(writesTo(r1, 7, C)[0] ? writesTo(r1, 7, C)[0].body : ''), tail(r1));
  T('[4] run 1: the refund\'s marker is on disk, exit signal retracted', (confOf(r1, C, key) || {}).refunded === 1 && leavesOf(r1, C) === 0, JSON.stringify(r1.state.CONFESSIONS_FILE));
  const r2 = runCron(world([conf].concat(settles), extra), advance(r1.state, 10 * MIN), env(MAIN, STRICT));
  T('[4] run 2 (still failing): no second refund', r2.code === 1 && refunds(r2) === 0, tail(r2));
  const r3 = runCron(world([conf].concat(settles), extra), advance(r2.state, 10 * MIN), MAIN);
  T('[4] run 3 (healthy): no refund', r3.code === 0 && refunds(r3) === 0 && leavesOf(r3, C) === 0, tail(r3));
}

// ---- [5] dry-run writes no state ----
console.log('-- [5] APPLY_MMR=0 --');
{
  const w = orphanWorld(0x4505, [{ id: 5, name: 'progress', entries: [{ steamID: B, score: 1000 }] }, { id: 8, name: 'cp_bank', entries: [] }]);
  const r = runCron(w.boards, { STARTS_FILE: w.starts }, env(PT, STRICT, { APPLY_MMR: '0' }));
  T('[5] dry-run fails the same way, no board write', r.code === 1 && REPORT_EXIT.test(r.out) && !r.posts.some(p => /SetLeaderboardScore/.test(p.url)), tail(r));
  T('[5] dry-run: no marks written (processed / confessions / leavers absent, starts as carried in)',
    !r.state.PROCESSED_FILE && !r.state.CONFESSIONS_FILE && !r.state.LEAVERS_FILE && !!(r.state.STARTS_FILE || {})[w.key]);
}

// ---- [6] checkpoint contract of reconcileConfessions (in-process) ----
console.log('-- [6] checkpoint contract --');
(async () => {
  const now = 100 * 86400000, mR = '911_7_2', mQ = '912_7_1';
  const board = { [A]: 2000, [B]: 2000 }, st = {}, leavers = {}, seen = [];
  const opts = {
    penalty: 100, lpMax: 9999, maturityMs: v.STARTS_MATURITY_MS, consistentKeys: new Set([mR]),
    appliesLpFn: (x) => (x & 0xF) === 2, seedFor: () => 0,
    readLp: async (sid) => (board[sid] == null ? null : { score: board[sid], details: null }),
    writeLp: async (sid, score) => { board[sid] = score; return true; },
    checkpoint: () => seen.push({ a: board[A], marked: !!st[v.pid(A) + '|' + mR], ded: (st[v.pid(A) + '|' + mR] || {}).ded, refunded: (st[v.pid(A) + '|' + mR] || {}).refunded, leaves: (leavers[v.pid(A)] || {}).leaves }),
  };
  await v.reconcileConfessions([{ steamID: A, m: mR, mt: 2, dispCode: 5 }, { steamID: B, m: mQ, mt: 1, dispCode: 5 }], {}, new Set(), st, leavers, now, opts);
  T('[6] one checkpoint for the ranked fine, none for the exit-rate-only confession', seen.length === 1, JSON.stringify(seen));
  T('[6] the checkpoint runs after the write, with the marker, the amount and the exit hit in place',
    !!seen[0] && seen[0].a === 1900 && seen[0].marked && seen[0].ded === 100 && seen[0].leaves === 1, JSON.stringify(seen[0]));
  const groups = { [mR]: [{ steamID: A, d: [], dispCode: 0 }, { steamID: C, d: [], dispCode: 0 }] };
  await v.reconcileConfessions([{ steamID: A, m: mR, mt: 2, dispCode: 5 }], groups, new Set(), st, leavers, now + 10 * MIN, opts);
  T('[6] one more checkpoint for the refund, after the write, with the refund marked and the exit retracted',
    seen.length === 2 && seen[1].a === 2000 && seen[1].refunded === 1 && seen[1].leaves === 0, JSON.stringify(seen));
  await v.reconcileConfessions([{ steamID: A, m: mR, mt: 2, dispCode: 5 }], groups, new Set(), st, leavers, now + 20 * MIN, opts);
  T('[6] nothing written, no checkpoint', seen.length === 2 && board[A] === 2000);
  const noCk = Object.assign({}, opts); delete noCk.checkpoint;
  const st2 = {}, lv2 = {};
  const r = await v.reconcileConfessions([{ steamID: B, m: '913_7_2', mt: 2, dispCode: 5 }], {}, new Set(), st2, lv2, now, noCk);
  T('[6] checkpoint is optional (no callback, same effects)', r.penalized === 1 && board[B] === 1900);

  // ---- [7] source pins ----
  console.log('-- [7] source pins --');
  const pin = (label, re) => T('[7] pin: ' + label, re.test(SRC));
  pin('atomic state write helper (temp file + rename)', /function writeStateFile\(file, text\) \{ const tmp = file \+ '\.tmp'; fs\.writeFileSync\(tmp, text\); fs\.renameSync\(tmp, file\); \}/);
  const direct = Array.from(SRC.matchAll(/fs\.writeFileSync\(\s*([A-Za-z0-9_.]+)/g), m => m[1]).filter(a => a !== 'tmp');
  T('[7] pin: no state file written in place (every *_FILE goes through writeStateFile)', direct.length === 0, direct.join(','));
  pin('early marks saved right after the starts verdict, before any consolation write', /RUN\.pending = Object\.keys\(startsPending\)\.length; RUN\.convicted = startsRes\.convicted;\s*\n(?:\s*\/\/[^\n]*\n)*\s*const saveEarlyMarks = \(leaversDirty\) => \{[\s\S]{0,400}?\};\s*\n\s*saveEarlyMarks\(startsRes\.convicted > 0\);[\s\S]{0,1200}?let consoledN = 0;/);
  pin('early marks honor the dry-run switch', /const saveEarlyMarks = \(leaversDirty\) => \{\s*\n\s*if \(!APPLY_MMR\) return;/);
  pin('early marks save starts, a COPY of confessions, leavers on demand, processed on growth', /if \(!APPLY_MMR\) return;\s*\n\s*saveStarts\(startsPending\);\s*\n\s*saveConfessions\(Object\.assign\(\{\}, confState\), nowMs, confLive\);\s*\n\s*if \(leaversDirty\) saveLeavers\(leavers\);\s*\n\s*if \(processed\.size !== processedN0\) saveProcessed\(processed\);/);
  pin('confession path gets the checkpoint', /checkpoint: \(\) => saveEarlyMarks\(true\),/);
  pin('checkpoint after the fine write', /const okW = await opts\.writeLp\(String\(c\.steamID\), nv, e && e\.details\);\s*\n[^\n]*\n\s*if \(opts\.checkpoint\) opts\.checkpoint\(\);/);
  pin('checkpoint after the refund write', /st\.refunded = 1;\s*\n\s*if \(wrote && opts\.checkpoint\) opts\.checkpoint\(\);/);
  pin('main-path tail save stays ahead of the trust / redeem upkeep (persist then keeps it on their exits)', /\n  saveProcessed\(processed\);\s*\n\s*saveSkill\(skill\);[\s\S]{0,600}?\n  await maintainTrust\(\);\s*\n[\s\S]{0,300}?await processRedeems\(cp\);/);

  // ---- [8] workflow pins ----
  console.log('-- [8] workflow pins --');
  const WF = path.join(__dirname, '..', '.github', 'workflows');
  const stepOf = (y, name) => { const re = new RegExp('\\n      - name: ' + name + '\\n([\\s\\S]*?)(?=\\n      - name: |$)'); const m = re.exec(y); return m ? m[1] : ''; };
  for (const f of ['validate.yml', 'playtest.yml', 'demo.yml']) {
    let y = '';
    try { y = fs.readFileSync(path.join(WF, f), 'utf8'); } catch (e) {}
    T('[8] ' + f + ' readable', !!y);
    if (!y) continue;
    const jobT = Number((/\n    timeout-minutes: (\d+)/.exec(y) || [])[1]);
    const run = stepOf(y, 'run'), persist = stepOf(y, 'persist');
    const runT = Number((/\n        timeout-minutes: (\d+)/.exec(run) || [])[1]);
    T('[8] ' + f + ': run step has an id and runs validate.js', /(^|\n)        id: run\n/.test(run) && /node validate\.js/.test(run));
    T('[8] ' + f + ': run step times out at least a minute before the job (' + runT + ' < ' + jobT + ')', runT > 0 && jobT > 0 && runT <= jobT - 1);
    const ifP = (/\n        if: ([^\n]*)/.exec(persist) || [])[1] || '';
    T('[8] ' + f + ': persist commits after a failed run, never after a skipped one', /(^|\n)        id: persist\n/.test(persist) && /^always\(\) && /.test(ifP) && /steps\.run\.outcome != 'skipped'/.test(ifP), ifP);
    T('[8] ' + f + ': persist keeps the yield gate when the run step has one', !/steps\.gate\.outputs\.yield/.test(run) || /steps\.gate\.outputs\.yield != 'true'/.test(ifP));
    T('[8] ' + f + ': persist still adds only the named state files', /git add -- \$state_files/.test(persist) && !/git add (-A|\.|--all)/.test(persist));
    const rep = stepOf(y, 'replicate');
    if (rep) {
      const ifR = (/\n        if: ([^\n]*)/.exec(rep) || [])[1] || '';
      T('[8] ' + f + ': replicate follows every persist that ran clean', /^always\(\) && /.test(ifR) && /steps\.persist\.outcome == 'success'/.test(ifR), ifR);
    }
  }

  console.log(failN ? ('FAIL x' + failN + ' (one-shot-on-failure)') : 'ALL OK (one-shot-on-failure)');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
