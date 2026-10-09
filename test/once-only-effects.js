'use strict';
// One-shot effects stay one-shot across runs (audit R1-B2-06, 2026-10-07). End-to-end over the REAL validate.js
// main() against an offline board stub, several runs with the job's clock advanced between them (stored instants
// move back), plus the pure retention helper.
//   [1] pruneConfessions: inside the window always kept; past it kept while the record is still on a shard or the
//       read was partial (null); dropped once a complete read no longer shows it
//   [2] playtest-shaped 2P quick match (A quits = confession, B finishes = lone settle, both attested the start):
//       the matured orphan verdict convicts nobody and lands on an early-exit run ("no consistent matches") -- its
//       key must still reach processed, so the still-visible starts never re-register and B's consolation XP is
//       paid exactly once
//   [3] ranked confession on a match that never reaches processed (no start attesters, no settlement): fined once;
//       past the 48h window the entry is kept while its record is up -- across an early-exit run, a main-path run
//       and a run with the record's shard unreadable -- and dropped once the record is overwritten
//   [4] the same on the playtest channel (exit-rate only)
//   [5] honest confession unchanged: refunded on a consistent settle, once, and still once past the window
//   [6] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
// knobs a CI/developer shell could carry that change behavior: scrubbed here (the module reads them at load) and
//   from every child env -- each run sets exactly what it needs
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY'];
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
// stateless board stub (writes are logged, not applied: every assertion below counts writes per run);
//   STUB_FAIL = { boardName: httpStatus } makes that board's entry reads fail (408 / 429 / 5xx retry; READ_RETRY_MS 0 below)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}');",
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
  "    if (b && FAIL[b.name]) return resp({ error: 'injected' }, FAIL[b.name]);",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'once-only-'));
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
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',   // world() lists shard_0..shard_7 = the full record shard set of these runs
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every
//   stored instant moves back instead: start sightings, confession sightings and the writers' busy marks)
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

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const E = '76561198000000005', F = '76561198000000006';
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
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const PRUNE = v.CONFESS_PRUNE_MS || 48 * HOUR, MAT = v.STARTS_MATURITY_MS;
// rows: [{ shard, sid, d }] -- one row per (shard, account), like the real boards
function world(rows, extra) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  return boards.concat(extra);
}

// ---- [1] pruneConfessions (pure) ----
console.log('-- [1] confession retention helper --');
{
  T('[1] exported', typeof v.pruneConfessions === 'function');
  if (typeof v.pruneConfessions === 'function') {
    const now = 100 * DAY;
    const mk = () => ({ fresh: { t0: now - HOUR, done: 1 }, oldUp: { t0: now - PRUNE - HOUR, done: 1 }, oldGone: { t0: now - PRUNE - HOUR, done: 1 }, oldRefunded: { t0: now - 30 * DAY, refunded: 1 } });
    let s = mk();
    const n = v.pruneConfessions(s, now, new Set(['oldUp', 'oldRefunded']));
    T('[1] complete read: inside the window kept even when gone', !!s.fresh);
    T('[1] complete read: past the window kept while its record is still up (incl. a refunded one)', !!s.oldUp && !!s.oldRefunded);
    T('[1] complete read: past the window AND gone -> dropped', !s.oldGone && n === 1);
    s = mk();
    T('[1] partial read (null): nothing dropped', v.pruneConfessions(s, now, null) === 0 && Object.keys(s).length === 4);
    s = mk();
    T('[1] no visibility info (undefined): nothing dropped', v.pruneConfessions(s, now) === 0 && Object.keys(s).length === 4);
  }
}

// ---- [2] early-exit orphan verdict reaches processed (consolation once) ----
console.log('-- [2] orphan verdict on an early-exit run is persisted --');
{
  const K = 0x3101, mt = 1, sids = [A, B];
  const rows = [
    { shard: 0, sid: A, d: rec(0xB2, mt, K, 0, sids) },      // A attests the start
    { shard: 0, sid: B, d: rec(0xB2, mt, K, 1, sids) },      // B attests the start
    { shard: 1, sid: A, d: rec(0xB5, mt, K, 0, sids, 5) },   // A quits (user-quit confession)
    { shard: 1, sid: B, d: rec(0xB1, mt, K, 1, sids) },      // B finishes alone (lone settle: never a consistent group)
  ];
  const key = keyOf(rows[0].d);
  const boards = world(rows, [{ id: 5, name: 'progress', entries: [{ steamID: B, score: 1000 }] }, { id: 8, name: 'cp_bank', entries: [] }]);
  const PT = { PT_MODE: '1' };
  const r1 = runCron(boards, null, PT);
  T('[2] run 1 exits 0', r1.code === 0, r1.out.slice(-600));
  T('[2] run 1 is an early-exit run', /no consistent matches/.test(r1.out));
  T('[2] run 1: start registered pending, A confession counted', !!(r1.state.STARTS_FILE || {})[key] && leavesOf(r1, A) === 1);
  const r2 = runCron(boards, advance(r1.state, MAT + MIN), PT);
  T('[2] run 2 exits 0 on the early-exit path', r2.code === 0 && /no consistent matches/.test(r2.out), r2.out.slice(-600));
  T('[2] run 2: matured verdict convicts nobody (A confessed, B wrote a settle)', /start-orphan [^\n]*-> 0 exit-rate hits/.test(r2.out));
  T('[2] run 2: B consoled once', writesTo(r2, 5, B).length === 1);
  T('[2] run 2: the verdict key reached processed', processedOf(r2).has(key));
  T('[2] run 2: pending entry gone', !(r2.state.STARTS_FILE || {})[key]);
  const r3 = runCron(boards, advance(r2.state, MAT + MIN), PT);
  T('[2] run 3: still-visible starts do not re-register the key', r3.code === 0 && !(r3.state.STARTS_FILE || {})[key] && !/start-pending/.test(r3.out));
  const r4 = runCron(boards, advance(r3.state, MAT + MIN), PT);
  T('[2] run 4: no second verdict, no second consolation', r4.code === 0 && !/start-orphan/.test(r4.out) && writesTo(r3, 5, B).length + writesTo(r4, 5, B).length === 0);
  T('[2] A counted exactly once across all runs', leavesOf(r4, A) === 1);
}

// ---- [3] ranked confession on a match that never reaches processed ----
console.log('-- [3] confession applied once past the 48h window (main channel, ranked) --');
{
  const K = 0x3202, mt = 2, sids = [C, D];
  const conf = { shard: 0, sid: C, d: rec(0xB5, mt, K, 0, sids, 5) };   // C quit; no start attestation visible (lost writes), no settle
  const key = keyOf(conf.d);
  const extra = [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: C, score: 2000 }, { steamID: D, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] }];
  const MAIN = { RANKED_LB: 'rating', LP_LB: 'points' };
  const fines = (r) => writesTo(r, 7, C).length;
  const r1 = runCron(world([conf], extra), null, MAIN);
  T('[3] run 1 exits 0', r1.code === 0, r1.out.slice(-600));
  T('[3] run 1: fined once (-100) + one exit-rate hit', fines(r1) === 1 && /score=1900(&|$)/.test(writesTo(r1, 7, C)[0] ? writesTo(r1, 7, C)[0].body : '') && leavesOf(r1, C) === 1);
  T('[3] run 1: the match never reaches processed', !processedOf(r1).has(key));
  // run 2: 48h + 1 min later, record still on its shard (early-exit run)
  const r2 = runCron(world([conf], extra), advance(r1.state, PRUNE + MIN), MAIN);
  T('[3] run 2 (past the window, early exit): no fine, entry kept while the record is up', r2.code === 0 && /no consistent matches/.test(r2.out) && fines(r2) === 0 && !!confOf(r2, C, key));
  // run 3: an unrelated attested quick match E/F settles consistently -> the MAIN path runs (pacing defers it once)
  const K2 = 0x3303, ef = [E, F];
  const efRows = [
    { shard: 1, sid: E, d: rec(0xB2, 1, K2, 0, ef) }, { shard: 1, sid: F, d: rec(0xB2, 1, K2, 1, ef) },
    { shard: 2, sid: E, d: rec(0xB1, 1, K2, 0, ef) }, { shard: 2, sid: F, d: rec(0xB1, 1, K2, 1, ef) },
  ];
  const r3 = runCron(world([conf].concat(efRows), extra), advance(r2.state, HOUR), MAIN);
  T('[3] run 3 takes the main path', r3.code === 0 && /1 consistent, 1 fresh/.test(r3.out), r3.out.slice(-600));
  T('[3] run 3: no fine, exit rate unchanged, entry kept', fines(r3) === 0 && leavesOf(r3, C) === 1 && !!confOf(r3, C, key));
  // run 4: the confession's shard is unreadable this run (partial read) -> nothing can prove the record gone
  const r4 = runCron(world([conf].concat(efRows), extra), advance(r3.state, 10 * MIN), Object.assign({ STUB_FAIL: JSON.stringify({ shard_0: 429 }) }, MAIN));
  T('[3] run 4: E/F settled on the main path while shard_0 failed', r4.code === 0 && /read shard failed/.test(r4.out) && processedOf(r4).has(keyOf(efRows[2].d)), r4.out.slice(-600));
  T('[3] run 4: partial read keeps the old entry', !!confOf(r4, C, key) && fines(r4) === 0);
  // run 5: shard_0 readable again, record still up -> still never fined again
  const r5 = runCron(world([conf].concat(efRows), extra), advance(r4.state, 10 * MIN), MAIN);
  T('[3] run 5 (no fresh matches path): no fine, entry kept', r5.code === 0 && /no fresh matches, skip/.test(r5.out) && fines(r5) === 0 && !!confOf(r5, C, key));
  // run 6: C's row on shard_0 overwritten by a later record of his -> complete read without it -> entry dropped
  const later = { shard: 0, sid: C, d: rec(0xB2, 1, 0x3404, 0, [C, D]) };
  const r6 = runCron(world([later].concat(efRows), extra), advance(r5.state, 10 * MIN), MAIN);
  T('[3] run 6: record overwritten -> entry dropped, still no fine', r6.code === 0 && !confOf(r6, C, key) && fines(r6) === 0);
  T('[3] exactly one fine and one exit-rate hit across six runs', [r1, r2, r3, r4, r5, r6].reduce((n, r) => n + fines(r), 0) === 1 && leavesOf(r6, C) === 1);
}

// ---- [4] playtest channel (exit-rate only) ----
console.log('-- [4] same on the playtest channel --');
{
  const K = 0x3505, mt = 1, sids = [C, D];
  const conf = { shard: 3, sid: C, d: rec(0xB5, mt, K, 0, sids, 5) };
  const key = keyOf(conf.d);
  const extra = [{ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
  const PT = { PT_MODE: '1' };
  const r1 = runCron(world([conf], extra), null, PT);
  T('[4] run 1: exit-rate hit, no board write for the confessor (no points surface)', r1.code === 0 && leavesOf(r1, C) === 1 && !r1.posts.some(p => /SetLeaderboardScore/.test(p.url) && p.body.indexOf('steamid=' + C) >= 0), r1.out.slice(-600));
  const r2 = runCron(world([conf], extra), advance(r1.state, PRUNE + MIN), PT);
  const r3 = runCron(world([conf], extra), advance(r2.state, HOUR), PT);
  T('[4] past the window: entry kept, never counted again', r3.code === 0 && !!confOf(r3, C, key) && leavesOf(r3, C) === 1);
}

// ---- [5] honest confession behavior unchanged (refund once, also past the window) ----
console.log('-- [5] honest reconnect-and-finish --');
(async () => {
  const now = 100 * DAY, m = '901_7_2';
  const board = { [A]: 2000 }, st = {}, leavers = {}, writes = [];
  const opts = {
    penalty: 100, lpMax: 9999, maturityMs: MAT, consistentKeys: new Set([m]),
    appliesLpFn: (x) => (x & 0xF) === 2, seedFor: () => 0,
    readLp: async (sid) => (board[sid] == null ? null : { score: board[sid], details: null }),
    writeLp: async (sid, score) => { board[sid] = score; writes.push([sid, score]); return true; },
  };
  const confs = [{ steamID: A, m, mt: 2, dispCode: 5 }];
  const groups = { [m]: [{ steamID: A, d: [], dispCode: 0 }, { steamID: B, d: [], dispCode: 0 }] };
  await v.reconcileConfessions(confs, {}, new Set(), st, leavers, now, opts);
  T('[5] fined at quit time', board[A] === 1900 && leavers[v.pid(A)].leaves === 1);
  const r2 = await v.reconcileConfessions(confs, groups, new Set(), st, leavers, now + 10 * MIN, opts);
  T('[5] came back and finished (consistent group): exact refund + exit signal retracted', board[A] === 2000 && r2.refunded === 1 && leavers[v.pid(A)].leaves === 0);
  if (typeof v.pruneConfessions === 'function') {
    const late = now + PRUNE + HOUR;
    v.pruneConfessions(st, late, new Set([v.pid(A) + '|' + m]));
    T('[5] refunded entry kept past the window while the record is up', !!st[v.pid(A) + '|' + m]);
    const r3 = await v.reconcileConfessions(confs, groups, new Set(), st, leavers, late, opts);
    T('[5] re-sighted past the window: no second fine, no second refund', board[A] === 2000 && r3.refunded === 0 && r3.exitHits === 0 && writes.length === 2);
    v.pruneConfessions(st, late, new Set());
    T('[5] dropped once a complete read no longer shows it', !st[v.pid(A) + '|' + m]);
  }

  // ---- [6] wiring pins ----
  console.log('-- [6] wiring pins --');
  const pin = (label, re) => T('[6] pin: ' + label, re.test(SRC));
  pin('early-exit persist saves processed on growth, not on conviction count', /const persistStartsSide = \(\) => \{[\s\S]{0,900}?if \(processed\.size !== processedN0\) saveProcessed\(processed\);/);
  pin('processed size captured right after load', /const processed = loadProcessed\(\);\s*\n\s*const processedN0 = processed\.size;/);
  T('[6] pin: both confession saves pass the visibility set (none left without it)', (SRC.match(/saveConfessions\(confState, nowMs, confLive\)/g) || []).length === 2 && !/saveConfessions\(confState, nowMs\)/.test(SRC));
  pin('a failed shard read marks the run partial', /else \{ shardsComplete = false; ghWarn\('read shard failed: '/);
  pin('a PAGE_CAP-cut shard read marks the run partial', /const \{ ents, complete \} = await readBoardAll\(id, 'shard ' \+ label, \{ strictBody: SHARD_STRICT_BODY[^\n]*\n\s*if \(!complete\) shardsComplete = false;/);
  pin('visibility set only from a complete read', /const confLive = shardsComplete \? new Set\(/);

  console.log(failN ? ('FAIL x' + failN + ' (once-only-effects)') : 'ALL OK (once-only-effects)');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
