'use strict';
// Absent-seat hold on the endless lanes (Q47, cloud audit 2026-10; residual 1 of R1-B2-04). End-to-end over the REAL
// validate.js main() against an offline board stub, several runs with the job's clock advanced between them (stored
// instants move back), the same harness as test/absence-grace.js.
// The endless lanes (casual co-op, team competitive segments, team classic segments) credit only the seats that WROTE a
// record -- best on the seat-count ladder, progress XP, milestones. A 3- or 4-seat group used to settle as soon as two
// writers agreed, and the key was marked processed: a seat whose record landed a little later (slow results screen, upload
// retry) or sat on a shard this run could not read lost that segment's best and XP for good. Now such a group waits like
// the matchmade lanes (absenceHold): settled in full once the record lands, or without the seat once a COMPLETE read still
// lacks it after the grace. Never a flag, never a conviction (endless has no leaver economy).
//   [1] casual co-op trio, late record: held (grace), settled with all three writers when it lands
//   [2] casual co-op trio, the third seat never writes: held for the grace, then settled for the two writers; nobody convicted
//   [3] casual co-op trio, the late writer's shard unreadable (503): held (read); next complete run settles all three
//   [4] grace over but this run's read is incomplete: still held; the next complete read settles without the seat
//   [5] team competitive trio segment, late record: held, then settled in full (chain advanced once)
//   [6] team classic trio segment, late record: held, then settled in full
//   [7] casual co-op quad: one late seat holds the group of three writers
//   [8] 2-seat run: unchanged (a lone record never settles; both records settle at once, no hold)
//   [9] a writer seen agreeing earlier whose record is gone (shard rotation) is not waited for
//   [10] wiring pins
//   [11] mutation self-checks (each lane's gate removed -> its late-record scenario goes red)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub (writes logged, not applied). Fault injection by board name:
//   STUB_FAIL { name: httpStatus }   every entry read of that board fails
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
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-endless-'));
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
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock (pre-season: no season twin boards needed)
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const writes = (r, boardId, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(p.body)));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const holdLine = (r) => (r.out.match(/ {2}absent-hold [^\n]*/) || [''])[0];

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// type-7 settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, progress/win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc, endless tail (startDepth, endDepth, continues, tokens [, season, flags])
function rec7(hash, seat, roster, tail) {
  const pc = roster.length;
  const d = [0xB1, 3, 7, hash | 0, 5, seat, 0, 0, pc, 900];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  for (const x of tail) d.push(x | 0);
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const CASUAL = [0, 6, 0, 0], COMP = [0, 5, 0, 0, 0, attest.SEG_COMP], CLASSIC = [0, 5, 0, 0, 0, attest.SEG_CLASSIC];
const TRIO = [A, B, C], QUAD = [A, B, C, D], DUO = [A, B];
const BOARD = { progress: 5, trio: 11, quad: 12, compTrio: 13, classicTrio: 14, duo: 15 };
// rows: [{ shard, sid, d }] -- one row per (shard, account), like the real boards; 50 shards = the full live set
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] });
  return boards;
}
// seat i on shard i; `skip` = seats whose record is not on the boards (yet)
const rowsOf = (hash, roster, tail, skip) => roster.map((sid, seat) => ({ shard: seat, sid, d: rec7(hash, seat, roster, tail) })).filter((r) => (skip || []).indexOf(r.sid) < 0);
// the start attestation was sighted 30 min ago (live runs: always past the depth-scaled pacing floor)
const attested = (hash) => { const s = {}; s[hash + '_5_7'] = { t0: Date.now() - 30 * 60000, mt: 7, roster: {}, settled: [] }; return { STARTS_FILE: s }; };
const GRACE = v.ABSENT_GRACE_MS, MIN = 60000;

// a late record on lane `tail` / roster / ladder: run 1 without C held, run 2 with C settled in full
function lateCase(tag, hash, roster, tail, boardId, script) {
  const m = hash + '_5_7';
  const r1 = runCron(world(rowsOf(hash, roster, tail, [C])), attested(hash), null, script);
  const r2 = runCron(world(rowsOf(hash, roster, tail)), advance(r1.state, MIN), null, script);
  return { m, r1, r2,
    held1: r1.code === 0 && !processedOf(r1).has(m) && writes(r1, BOARD.progress).length === 0 && /grace 300s left/.test(holdLine(r1)),
    full2: r2.code === 0 && processedOf(r2).has(m) && roster.every((sid) => writes(r2, BOARD.progress, sid).length === 1 && writes(r2, boardId, sid).length === 1) };
}

// ---- [1] casual co-op trio, late record ----
console.log('-- [1] casual co-op trio, late record --');
{
  const x = lateCase('co-op', 0x4710, TRIO, CASUAL, BOARD.trio);
  T('[1] run 1 (C not written yet): held for the grace, nothing written', x.held1, x.r1.out.slice(-600));
  T('[1] run 1: logged on the co-op lane', /absent-hold [^\n]*\(co-op\): seat 2 wrote no record/.test(holdLine(x.r1)), holdLine(x.r1));
  T('[1] run 1: the gap is stamped in the start entry, the writers recorded as agreeing', ((x.r1.state.STARTS_FILE || {})[x.m] || {}).absentAt > 0 && (((x.r1.state.STARTS_FILE || {})[x.m] || {}).agreed || []).length === 2);
  T('[1] run 2 (C landed): settled, all three get the trio best and their XP', x.full2, 'xp=' + writes(x.r2, BOARD.progress).length + ' trio=' + writes(x.r2, BOARD.trio).length + ' ' + x.r2.out.slice(-400));
  T('[1] run 2: nothing held any more', !/absent-hold/.test(x.r2.out));
}

// ---- [2] the third seat never writes ----
console.log('-- [2] the third seat never writes --');
{
  const h = 0x4720, m = h + '_5_7';
  const boards = world(rowsOf(h, TRIO, CASUAL, [C]));
  const r1 = runCron(boards, attested(h));
  const r2 = runCron(boards, advance(r1.state, 2 * MIN));
  T('[2] two minutes later: still held', !processedOf(r2).has(m) && /grace 1[0-9][0-9]s left/.test(holdLine(r2)), holdLine(r2));
  const r3 = runCron(boards, advance(r2.state, GRACE));
  T('[2] grace over, complete read: settled for the two writers only', processedOf(r3).has(m) && writes(r3, BOARD.trio, A).length === 1 && writes(r3, BOARD.trio, B).length === 1 && writes(r3, BOARD.trio, C).length === 0 && writes(r3, BOARD.progress, C).length === 0,
    r3.out.slice(-400));
  T('[2] nobody convicted, no flag (endless has no leaver economy)', leavesOf(r3, C) === 0 && !/leaver [^\n]*in roster, no record/.test(r3.out) && !/sanity-flagged/.test(r3.out));
  const r4 = runCron(world(rowsOf(h, TRIO, CASUAL)), advance(r3.state, MIN));
  T('[2] a record landing after the settle changes nothing (processed)', writes(r4, BOARD.trio).length === 0 && writes(r4, BOARD.progress).length === 0);
}

// ---- [3] the late writer's shard is unreadable ----
console.log('-- [3] unreadable shard --');
{
  const h = 0x4730, m = h + '_5_7';
  const boards = world(rowsOf(h, TRIO, CASUAL));
  const r1 = runCron(boards, attested(h), { STUB_FAIL: JSON.stringify({ shard_2: 503 }) });
  T('[3] run 1 (C\'s shard 503): held on the read, nothing written', r1.code === 0 && !processedOf(r1).has(m) && /not every record shard was read this run/.test(holdLine(r1)) && writes(r1, BOARD.trio).length === 0, holdLine(r1) || r1.out.slice(-400));
  const r2 = runCron(boards, advance(r1.state, MIN));
  T('[3] run 2 (readable): settled with all three', processedOf(r2).has(m) && TRIO.every((sid) => writes(r2, BOARD.trio, sid).length === 1 && writes(r2, BOARD.progress, sid).length === 1));
}

// ---- [4] grace over but the read is incomplete ----
console.log('-- [4] grace over, incomplete read --');
{
  const h = 0x4740, m = h + '_5_7';
  const boards = world(rowsOf(h, TRIO, CASUAL, [C]));
  const r1 = runCron(boards, attested(h));
  const r2 = runCron(boards, advance(r1.state, GRACE + MIN), { STUB_FAIL: JSON.stringify({ shard_9: 503 }) });
  T('[4] grace over, one (other) shard failed: still held', !processedOf(r2).has(m) && /not every record shard was read/.test(holdLine(r2)) && writes(r2, BOARD.trio).length === 0);
  const r3 = runCron(boards, advance(r2.state, MIN));
  T('[4] next complete read: settled for the two writers', processedOf(r3).has(m) && writes(r3, BOARD.trio).length === 2 && writes(r3, BOARD.trio, C).length === 0);
}

// ---- [5] team competitive trio segment ----
console.log('-- [5] team competitive segment --');
{
  const x = lateCase('team comp', 0x4750, TRIO, COMP, BOARD.compTrio);
  T('[5] run 1: held on the team comp lane, chain not advanced', x.held1 && /\(team comp\): seat 2/.test(holdLine(x.r1)) && !/endless-comp settle/.test(x.r1.out), holdLine(x.r1) || x.r1.out.slice(-600));
  T('[5] run 2: settled once, all three on the trio competitive ladder with their XP', x.full2 && (x.r2.out.match(/endless-comp settle /g) || []).length === 1, x.r2.out.slice(-600));
}

// ---- [6] team classic trio segment ----
console.log('-- [6] team classic segment --');
{
  const x = lateCase('team classic', 0x4760, TRIO, CLASSIC, BOARD.classicTrio);
  T('[6] run 1: held on the team classic lane', x.held1 && /\(team classic\): seat 2/.test(holdLine(x.r1)) && !/endless-classic settle/.test(x.r1.out), holdLine(x.r1) || x.r1.out.slice(-600));
  T('[6] run 2: settled once, all three on the trio classic ladder with their XP', x.full2 && (x.r2.out.match(/endless-classic settle /g) || []).length === 1, x.r2.out.slice(-600));
}

// ---- [7] casual co-op quad ----
console.log('-- [7] quad --');
{
  const x = lateCase('co-op', 0x4770, QUAD, CASUAL, BOARD.quad);
  T('[7] three writers of four: held, then settled with all four', x.held1 && x.full2, holdLine(x.r1) + ' / ' + x.r2.out.slice(-300));
}

// ---- [8] 2-seat run ----
console.log('-- [8] 2-seat run (unchanged) --');
{
  const h = 0x4780, m = h + '_5_7';
  const r1 = runCron(world(rowsOf(h, DUO, CASUAL, [B])), attested(h));
  T('[8] one record of two: lone, not settled, no hold logged', !processedOf(r1).has(m) && !/absent-hold/.test(r1.out) && writes(r1, BOARD.duo).length === 0);
  const r2 = runCron(world(rowsOf(h, DUO, CASUAL)), advance(r1.state, MIN));
  T('[8] both records: settled at once, no hold', processedOf(r2).has(m) && !/absent-hold/.test(r2.out) && writes(r2, BOARD.duo).length === 2);
}

// ---- [9] a writer seen agreeing earlier ----
console.log('-- [9] earlier writer gone from its shard --');
{
  const h = 0x4790, m = h + '_5_7';
  const r1 = runCron(world(rowsOf(h, TRIO, CASUAL, [C])), attested(h));   // A + B seen, C missing: held
  // next run: C landed but B's row is gone (B's later writes rotated onto that shard) -> A + C agree, B already agreed
  const r2 = runCron(world(rowsOf(h, TRIO, CASUAL, [B])), advance(r1.state, MIN));
  T('[9] B (seen agreeing on run 1) is not waited for: settled at once for the writers present', !processedOf(r1).has(m) && processedOf(r2).has(m) && !/absent-hold/.test(r2.out)
    && writes(r2, BOARD.trio, A).length === 1 && writes(r2, BOARD.trio, C).length === 1, r2.out.slice(-400));
}

// ---- [10] wiring pins ----
console.log('-- [10] wiring pins --');
{
  const iSolo = SRC.indexOf('if (c.solo) { if (await soloSettle(c)) settledSolo++; continue; }');
  const iEndless = SRC.indexOf('if (isEndlessMt(matchType)) {');
  const iHelper = SRC.indexOf('const endlessAbsence = (pendE) => {');
  const iGateBoards = SRC.indexOf("if (!isClassicSeg && (!cpId || !bId || (seasonId >= 1 && !bSeasonId)))");
  T('[10] the helper sits inside the endless block, after the solo lane split off', iSolo > 0 && iSolo < iEndless && iEndless < iHelper && iHelper < iGateBoards);
  T('[10] the helper reuses the matchmade rule (absentRosterSeats minus earlier writers, absenceHold on the run\'s completeness)',
    /const absentE = absentRosterSeats\(g\)\.filter\(\(x\) => agreedE\.indexOf\(pid\(String\(x\.steamID\)\)\) < 0\);/.test(SRC) && /absenceHold\(absentE, pendE, nowMs, shardsComplete, ABSENT_GRACE_MS\)/.test(SRC));
  for (const [lane, pend, stamp, gate, pace, settle] of [
    ['team classic', 'pendK', 'const absK = endlessAbsence(pendK);', "if (endlessHeld('team classic', absK)) continue;", 'const reqK = endlessRequiredMs(', 'recordEndlessSignals('],
    ['team comp', 'pendT', 'const absT = endlessAbsence(pendT);', "if (endlessHeld('team comp', absT)) continue;", 'const reqT = endlessRequiredMs(', 'recordEndlessSignals('],
    ['co-op', 'pend7', 'const abs7 = endlessAbsence(pend7);', "if (endlessHeld('co-op', abs7)) continue;", 'const reqMs = endlessRequiredMs(t, chainMax);', 'recordEndlessSignals('],
  ]) {
    const iPend = SRC.indexOf('startsPending[c.m] = { t0: nowMs, mt: matchType', SRC.indexOf('let ' + pend + ' = startsPending[c.m];'));
    const iS = SRC.indexOf(stamp), iG = SRC.indexOf(gate), iP = SRC.indexOf(pace, iG), iX = SRC.indexOf(settle, iP);
    T('[10] ' + lane + ': the gap is checked once the start entry is in hand, ahead of the pacing gate and of anything credited',
      iPend > 0 && iPend < iS && iS < iG && iG < iP && iP < iX && SRC.split(gate).length === 2, [iPend, iS, iG, iP, iX].join(','));
  }
  T('[10] holds share the run summary counter with the matchmade lanes', /RUN\.absentHeld = \(RUN\.absentHeld \| 0\) \+ 1;\n {8}console\.log\('  absent-hold ' \+ c\.m \+ ' \(' \+ lane/.test(SRC));
}

// ---- [11] mutation self-checks ----
console.log('-- [11] mutation self-checks --');
{
  const mutants = [
    ['endless hold helper never holds', 'if (!ab.res.hold) return false;', 'return false;', (script) => !lateCase('co-op', 0x47B1, TRIO, CASUAL, BOARD.trio, script).full2],
    ['co-op lane gate removed', "if (endlessHeld('co-op', abs7)) continue;", '', (script) => !lateCase('co-op', 0x47B2, TRIO, CASUAL, BOARD.trio, script).full2],
    ['team comp lane gate removed', "if (endlessHeld('team comp', absT)) continue;", '', (script) => !lateCase('team comp', 0x47B3, TRIO, COMP, BOARD.compTrio, script).full2],
    ['team classic lane gate removed', "if (endlessHeld('team classic', absK)) continue;", '', (script) => !lateCase('team classic', 0x47B4, TRIO, CLASSIC, BOARD.classicTrio, script).full2],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-absence-endless-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[11] ' + label + ' -> the late seat loses its credit again', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (absence-grace-endless)') : 'ALL OK (absence-grace-endless)');
process.exit(failN ? 1 : 0);
