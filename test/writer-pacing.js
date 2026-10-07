'use strict';
// One match at a time per account (R1-A2-07 / R1-A2-01, 2026-10-07): end-to-end over the REAL validate.js main()
// against an offline stateful board stub, several runs with the job's clock advanced between them.
//   [1] helper semantics (writerReadyAt / writerClaim)
//   [2] two colluding writers + a batch of consistent quick groups with no start attestation: nothing settles on
//       first sight (the group's own first sighting starts the clock, ns counted once), then one group per floor
//   [3] the same on the ranked code: one LP write per floor
//   [4] a lone writer on the bot lane cannot run parallel bot matches: one per (level-scaled) floor
//   [5] private rooms: one per floor
//   [6] honest back-to-back attested matches (no overlap) settle in the same run -- no new delay
//   [7] after an outage several of one pair's starts are first sighted together: they drain one floor apart
//   [8] the older start wins the slot even when its key sorts later (oldest-first order)
//   [9] wiring pins (gate order, every lane, export, no bypass)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-pacing-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) and the
      //   [3] write count below would read 0 -- every test runs before each production reconcile, so a date-dependent
      //   red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so
//   every stored instant moves back instead: start sightings and the writers' busy marks)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) if (st[k] && st[k].t0) st[k].t0 -= ms;
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// matchmade 2P settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function mm(mt, hash, seat, sids) {
  const d = [0xB1, 3, mt, hash | 0, 1234, seat, seat === 0 ? 1 : 2, (6 << 1) | (seat === 0 ? 1 : 0), 2, 720, 9000, 4000, 0];
  for (const s of (sids || [A, B])) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
function botRec(hash) {   // one human (seat 0) + one bot, auto tier, 6 levels
  const d = [0xB1, 3, 11, hash | 0, 777, 0, 1, (6 << 1) | 1, 2, 480, 9000, 100, 0];
  const p = sidPair(A); d.push(p[0], p[1], 0, 0);
  return d;
}
function privRec(hash, seat) {   // private room, 3 levels played
  const d = [0xB1, 3, 10, hash | 0, 555, seat, seat === 0 ? 1 : 2, (3 << 1) | (seat === 0 ? 1 : 0), 2, 400, 5000, 3000, 0];
  for (const s of [A, B]) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: A, score: 2000 }, { steamID: B, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;

// ---- [1] helpers ----
{
  const sg = { players: {} };
  T('[1] no marks: readyAt = t0 + req', v.writerReadyAt(sg, [A, B], 1000, 300) === 1300);
  v.writerClaim(sg, [A, B], 1300, 5000);
  T('[1] claim marks every writer', sg.players[v.pid(A)].bz === 1300 && sg.players[v.pid(B)].bz === 1300);
  T('[1] a mark later than t0 pushes the slot', v.writerReadyAt(sg, [A, C], 1100, 300) === 1600);
  T('[1] a mark earlier than t0 does not', v.writerReadyAt(sg, [A], 2000, 300) === 2300);
  v.writerClaim(sg, [A], 1200, 5000);
  T('[1] a claim never moves a mark backwards', sg.players[v.pid(A)].bz === 1300);
}

// ---- [2] fabricated quick batch (no start attestation): first sight defers, then one group per floor ----
{
  const N = 6, recs = [];
  for (let i = 0; i < N; i++) { recs.push({ sid: A, d: mm(1, 0x2000 + i, 0) }); recs.push({ sid: B, d: mm(1, 0x2000 + i, 1) }); }
  const boards = boardsWith(recs);
  const r1 = runCron(boards);
  T('[2] run 1 exits 0', r1.code === 0, r1.out.slice(-800));
  T('[2] run 1: nothing settles on first sight', processedOf(r1).size === 0 && posts(r1, 5).length === 0, 'processed=' + processedOf(r1).size);
  const st1 = r1.state.STARTS_FILE || {};
  T('[2] run 1: every group got a synthetic first-sighting entry', Object.keys(st1).length === N && Object.values(st1).every(p => p.synth === true));
  const pa = (r1.state.SIGNALS_FILE || { players: {} }).players[v.pid(A)] || {};
  T('[2] run 1: ns counted once per group per writer', pa.ns === N, 'ns=' + pa.ns);
  let r = r1, settledTotal = 0, okRuns = true;
  for (let k = 2; k <= 4; k++) {
    const rk = runCron(boards, advance(r.state, FLOOR + 1000));
    const now = processedOf(rk).size - settledTotal;
    if (rk.code !== 0 || now !== 1) { okRuns = false; bad('[2] run ' + k + ': settled ' + now + ' (expect exactly 1) code=' + rk.code); }
    settledTotal = processedOf(rk).size; r = rk;
  }
  if (okRuns) ok('[2] runs 2..4 (one floor apart): exactly one group each');
  T('[2] the deferred groups are logged as one-match-at-a-time waits', /writer-pacing /.test(r.out));
  const pa4 = (r.state.SIGNALS_FILE || { players: {} }).players[v.pid(A)] || {};
  T('[2] ns not counted again when the group settles', pa4.ns === N, 'ns=' + pa4.ns);
}

// ---- [3] ranked code: one points write per floor ----
{
  const N = 4, recs = [];
  for (let i = 0; i < N; i++) { recs.push({ sid: A, d: mm(2, 0x3000 + i, 0) }); recs.push({ sid: B, d: mm(2, 0x3000 + i, 1) }); }
  const boards = boardsWith(recs);
  const r1 = runCron(boards);
  const r2 = runCron(boards, advance(r1.state, FLOOR + 1000));
  const lpA = posts(r2, 7).filter(p => /steamid=76561198000000001(&|$)/.test(p.body));
  T('[3] ranked batch: one group settles per floor (one points write for the winner)', processedOf(r2).size === 1 && lpA.length === 1, 'processed=' + processedOf(r2).size + ' lpWrites=' + lpA.length);
}

// ---- [4] lone writer on the bot lane: one bot match per level-scaled floor ----
{
  const N = 5, recs = [];
  for (let i = 0; i < N; i++) recs.push({ sid: A, d: botRec(0x1000 + i) });
  const boards = boardsWith(recs);
  const reqB = Math.max(FLOOR, 6 * v.BOT_XP.LEVEL_SECONDS * 1000 * v.BOT_XP.PACE_FRAC);
  const r1 = runCron(boards);
  T('[4] run 1: no bot match settles on first sight', processedOf(r1).size === 0);
  const r2 = runCron(boards, advance(r1.state, reqB + 1000));
  T('[4] one floor later: exactly one bot match settles', processedOf(r2).size === 1, 'processed=' + processedOf(r2).size);
  const r3 = runCron(boards, advance(r2.state, reqB + 1000));
  T('[4] another floor: exactly one more', processedOf(r3).size === 2, 'processed=' + processedOf(r3).size);
  const xp = posts(r3, 5);
  T('[4] one XP write in that run', xp.length === 1, 'xpWrites=' + xp.length);
}

// ---- [5] private rooms: one per floor ----
{
  const N = 3, recs = [];
  for (let i = 0; i < N; i++) { recs.push({ sid: A, d: privRec(0x4000 + i, 0) }); recs.push({ sid: B, d: privRec(0x4000 + i, 1) }); }
  const boards = boardsWith(recs);
  const reqP = Math.max(FLOOR, 3 * v.PRIVATE_XP.LEVEL_SECONDS * 1000 * v.PRIVATE_XP.PACE_FRAC);
  const r1 = runCron(boards);
  const r2 = runCron(boards, advance(r1.state, reqP + 1000));
  T('[5] private batch: one room settles per floor', processedOf(r2).size === 1, 'processed=' + processedOf(r2).size);
}

// ---- [6] honest back-to-back attested matches settle together (no overlap -> no new delay) ----
{
  const m1 = mm(1, 0x5001, 0), m2 = mm(1, 0x5002, 0);
  const boards = boardsWith([{ sid: A, d: m1 }, { sid: B, d: mm(1, 0x5001, 1) }, { sid: A, d: m2 }, { sid: B, d: mm(1, 0x5002, 1) }]);
  const now = Date.now();
  const starts = {};
  starts[keyOf(m1)] = { t0: now - 25 * 60000, mt: 1, roster: {}, settled: [] };   // first match started 25 min ago
  starts[keyOf(m2)] = { t0: now - 12 * 60000, mt: 1, roster: {}, settled: [] };   // the next one 12 min ago
  const r = runCron(boards, { STARTS_FILE: starts });
  T('[6] both honest matches settle in one run', processedOf(r).size === 2 && !/writer-pacing /.test(r.out), 'processed=' + processedOf(r).size);
}

// ---- [7] outage: one pair's three attested starts first sighted together drain one floor apart ----
{
  const ms = [0x6001, 0x6002, 0x6003].map(h => [mm(1, h, 0), mm(1, h, 1)]);
  const boards = boardsWith([].concat(...ms.map(([a, b]) => [{ sid: A, d: a }, { sid: B, d: b }])));
  const now = Date.now(), starts = {};
  for (const [a] of ms) starts[keyOf(a)] = { t0: now - FLOOR - 30000, mt: 1, roster: {}, settled: [] };   // 30 s margin: robust to clock skew between this process and the child runs
  const r1 = runCron(boards, { STARTS_FILE: starts });
  const r2 = runCron(boards, advance(r1.state, FLOOR + 1000));
  const r3 = runCron(boards, advance(r2.state, FLOOR + 1000));
  T('[7] after an outage: 1, then 2, then 3 settled', [r1, r2, r3].map(x => processedOf(x).size).join(',') === '1,2,3', [r1, r2, r3].map(x => processedOf(x).size).join(','));
}

// ---- [8] oldest start wins the slot even when its key sorts later ----
{
  const older = mm(1, 0x7FFF0, 0), newer = mm(1, 0x10, 0);   // newer key sorts first by name
  T('[8] fixture: the newer group sorts first by key', keyOf(newer) < keyOf(older));
  const boards = boardsWith([{ sid: A, d: older }, { sid: B, d: mm(1, 0x7FFF0, 1) }, { sid: A, d: newer }, { sid: B, d: mm(1, 0x10, 1) }]);
  const now = Date.now(), starts = {};
  starts[keyOf(older)] = { t0: now - FLOOR - 60000, mt: 1, roster: {}, settled: [] };   // overlapping starts one minute apart
  starts[keyOf(newer)] = { t0: now - FLOOR - 1000, mt: 1, roster: {}, settled: [] };
  const r = runCron(boards, { STARTS_FILE: starts });
  const p = processedOf(r);
  T('[8] the older start settled, the newer one waits', p.size === 1 && p.has(keyOf(older)), [...p].join(','));
}

// ---- [9] wiring pins ----
{
  const gate = SRC.indexOf('let pend = startsPending[c.m];');
  T('[9] matchmade gate creates the synthetic first-sighting entry before pacing', gate > 0 && SRC.indexOf('pend = startsPending[c.m] = { t0: nowMs, mt: matchType, roster: {}, settled: [], synth: true };', gate) > gate &&
    SRC.indexOf('if (pacingDefer(pend, nowMs, SANITY.MIN_START_AGE_MS))', gate) > gate);
  T('[9] matchmade lanes apply the one-match rule right after the floor', /if \(!isPrivateMt\(matchType\) && !isBotMt\(matchType\) && writerPaced\(c\.m, writerSids, pend\.t0, SANITY\.MIN_START_AGE_MS\)\) continue;/.test(SRC));
  T('[9] private lane applies it after its own floor', /if \(writerPaced\(c\.m, writerSids, pendP\.t0, reqMsP\)\) continue;/.test(SRC));
  T('[9] bot lane applies it after its own floor', /if \(writerPaced\(c\.m, writerSids, pendB\.t0, reqMsB\)\) continue;/.test(SRC));
  T('[9] the old unconstrained "no attestation" pass is gone', !/if \(!pend\) for \(const sid of writerSids\)/.test(SRC));
  T('[9] exports', typeof v.writerReadyAt === 'function' && typeof v.writerClaim === 'function' && typeof v.freshOrderPaced === 'function');
  T('[9] run summary reports the deferrals', /one-match-at-a-time deferrals/.test(SRC));
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (writer-pacing)');
process.exit(failN ? 1 : 0);
