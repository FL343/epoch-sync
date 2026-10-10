'use strict';
// Q69 (cloud audit 2026-10): a leave is convicted only on the named player's OWN record for the match. End-to-end over
// the REAL validate.js main() against an offline stateful board stub (same harness as test/writer-pacing.js).
//   [1] the frame: two owned accounts write a consistent ranked 3P match (with or without a start pair) naming V at the
//       third seat -- V keeps his points, gets no exit-rate hit; the writers get the `un` signal; the run summary counts it
//   [2] an honest leaver who wrote his start record (level 1 began) is still convicted: exit rate + 100 points
//   [3] his start record rotates off its shard before the group settles: still convicted (remembered in starts.json)
//   [4] quick (no points surface, the demo case): the frame costs V no exit rate; an honest quick leaver still gets one
//   [5] wiring pins (filter, shield input, summary row, orphan-path helper)
//   [6] confessions: a quitter with no start of his who confessed is counted once by the confession path; residual: his
//       confession first read in the run the entry matures is lost (pinned); on the settle path a confessor is no
//       named-only seat (no un mark on the writers)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaver-own-record-'));
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
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }   // absentAt: the absent-seat grace stamp (R1-B2-04), when present
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const pointsWritesFor = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body));

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', V = '76561198000000077';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// 3P record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
const SC3 = [9000, 6000, 3000];
function rec3(magic, mt, hash, seat, ros) {
  const start = magic === 0xB2;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : 1 + seat, start ? 0 : ((6 << 1) | (seat === 0 ? 1 : 0)), 3, start ? 0 : 720,
    start ? 0 : SC3[0], start ? 0 : SC3[1], start ? 0 : SC3[2], 0];
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const settle = (mt, hash, seat, ros) => rec3(0xB1, mt, hash, seat, ros);
const startRec = (mt, hash, seat, ros) => rec3(0xB2, mt, hash, seat, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [A, B, C, V].map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
// run 1 (first sighting, deferred by the start floor), run 2 one floor later: the group settles
function twoRuns(recs1, recs2) {
  const r1 = runCron(boardsWith(recs1));
  const r2 = runCron(boardsWith(recs2 || recs1), advance(r1.state, FLOOR + 1000));
  return { r1, r2 };
}

console.log('=== leaver conviction needs the player\'s own record (Q69) ===');

// ---- [1] the frame ----
for (const withStarts of [true, false]) {
  const tag = withStarts ? '[1a] with a start pair' : '[1b] no start record at all';
  const ros = [A, B, V], h = withStarts ? 0x6901 : 0x6902;
  const recs = [{ sid: A, d: settle(2, h, 0, ros) }, { sid: B, d: settle(2, h, 1, ros) }];
  if (withStarts) recs.push({ sid: A, d: startRec(2, h, 0, ros) }, { sid: B, d: startRec(2, h, 1, ros) });
  const { r1, r2 } = twoRuns(recs);
  T(tag + ': both runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-800));
  T(tag + ': the match settles (the writers are rated as usual)', processedOf(r2).has(keyOf(settle(2, h, 0, ros))));
  T(tag + ': V keeps his points (no write for him)', pointsWritesFor(r2, V).length === 0, JSON.stringify(pointsWritesFor(r2, V)));
  T(tag + ': V gets no exit-rate hit', leavesOf(r2, V) === 0, 'leaves=' + leavesOf(r2, V));
  T(tag + ': logged as named-only, not a leaver', /never wrote his own record for this match -- not a leaver \(Q69\)/.test(r2.out));
  T(tag + ': no "leaver LP" line', !/leaver LP /.test(r2.out));
  T(tag + ': each writer carries the un signal once', (sigOf(r2, A).un | 0) === 1 && (sigOf(r2, B).un | 0) === 1, 'A.un=' + sigOf(r2, A).un + ' B.un=' + sigOf(r2, B).un);
  T(tag + ': V gets no signal row from it', !((r2.state.SIGNALS_FILE || {}).players || {})[v.pid(V)]);
}

// ---- [2] honest leaver: wrote his start (level 1 began), quit, no settle ----
{
  const ros = [A, B, C], h = 0x6903;
  const recs = [{ sid: A, d: settle(2, h, 0, ros) }, { sid: B, d: settle(2, h, 1, ros) },
    { sid: A, d: startRec(2, h, 0, ros) }, { sid: B, d: startRec(2, h, 1, ros) }, { sid: C, d: startRec(2, h, 2, ros) }];
  const { r1, r2 } = twoRuns(recs);
  const st1 = ((((r1.state.STARTS_FILE || {})[keyOf(settle(2, h, 0, ros))]) || {}).started || []).slice().sort();
  T('[2] run 1: start pending carries the three own starts', JSON.stringify(st1) === JSON.stringify([v.pid(A), v.pid(B), v.pid(C)].sort()), JSON.stringify(st1));
  T('[2] C convicted: one exit-rate hit', leavesOf(r2, C) === 1, 'leaves=' + leavesOf(r2, C));
  const w = pointsWritesFor(r2, C);
  T('[2] C loses 100 points (2500 -> 2400)', w.length === 1 && /score=2400(&|$)/.test(w[0].body), JSON.stringify(w));
  T('[2] no named-only line', !/Q69\)/.test(r2.out));
  T('[2] no un signal on honest writers', (sigOf(r2, A).un | 0) === 0);
}

// ---- [3] the leaver's start rotates off its shard before the settle ----
{
  const ros = [A, B, C], h = 0x6904;
  const base = [{ sid: A, d: settle(2, h, 0, ros) }, { sid: B, d: settle(2, h, 1, ros) },
    { sid: A, d: startRec(2, h, 0, ros) }, { sid: B, d: startRec(2, h, 1, ros) }];
  const { r2 } = twoRuns(base.concat([{ sid: C, d: startRec(2, h, 2, ros) }]), base);
  T('[3] C convicted on his remembered own start', leavesOf(r2, C) === 1 && pointsWritesFor(r2, C).length === 1, 'leaves=' + leavesOf(r2, C));
}

// ---- [4] quick (no points surface): exit rate only ----
{
  const ros = [A, B, V], h = 0x6905;
  const { r2 } = twoRuns([{ sid: A, d: settle(1, h, 0, ros) }, { sid: B, d: settle(1, h, 1, ros) }]);
  T('[4] framed quick: V no exit-rate hit', processedOf(r2).has(keyOf(settle(1, h, 0, ros))) && leavesOf(r2, V) === 0, 'leaves=' + leavesOf(r2, V));
  const ros2 = [A, B, C], h2 = 0x6906;
  const { r2: q2 } = twoRuns([{ sid: A, d: settle(1, h2, 0, ros2) }, { sid: B, d: settle(1, h2, 1, ros2) }, { sid: C, d: startRec(1, h2, 2, ros2) }]);
  T('[4] honest quick leaver (own start) still gets the exit-rate hit', leavesOf(q2, C) === 1, 'leaves=' + leavesOf(q2, C));
  T('[4] quick never writes points', pointsWritesFor(q2, C).length === 0);
}

// ---- [5] wiring pins ----
{
  const at = SRC.indexOf('const leavers0 = detectLeavers(g).filter((x) => {');
  T('[5] the leaver filter routes every absent seat through the own-record check', at > 0 && SRC.indexOf('return ownOrNamed(x);', at) > at && SRC.indexOf('return ownOrNamed(x);', at) < SRC.indexOf('});', at));
  T('[5] named-only seats still shield their teammates', /teamLpPlan\(planIn, matchType, scores, leavers0\.concat\(namedOnly\)\.map\(x => x\.seat\), t2Win\)/.test(SRC));
  T('[5] the orphan path remembers own starts every run', /noteOwnStarts\(p, sg\[m\]\);/.test(SRC) && /if \(!hasOwnStart\(p, h\)\) continue;/.test(SRC));
  T('[5] the settle filter takes a confession as his own record', /if \(own\.has\(hx\) \|\| confSeen\.has\(hx \+ '\|' \+ c\.m\) \|\| confState\[hx \+ '\|' \+ c\.m\]\) return true;/.test(SRC));
  T('[5] run summary row', /s\('unattested', 0\)/.test(SRC));
  T('[5] exports', typeof v.noteOwnStarts === 'function' && typeof v.hasOwnStart === 'function' && v.OWN_START_CAP === 16);
}

// ---- [6] confessions are own records ----
// abandon confession (0xB5): the start layout (zeroed result fields) with the disp slot set; 5 = user-quit
const confess = (mt, hash, seat, ros) => { const d = rec3(0xB2, mt, hash, seat, ros); d[0] = 0xB5; d[13] = 5; return d; };
{
  // (a) quick match: A and B attested the start, C quit before level 1 began (no start of his) and confessed; nobody
  //   settled. Normal flow: the confession is read long before the two-hour maturity -> counted once by the
  //   confession path; the orphan verdict at maturity does not count him again.
  const ros = [A, B, C], h = 0x6907;
  const key = keyOf(startRec(1, h, 0, ros));
  const recs = [{ sid: A, d: startRec(1, h, 0, ros) }, { sid: B, d: startRec(1, h, 1, ros) }, { sid: C, d: confess(1, h, 2, ros) }];
  const r1 = runCron(boardsWith(recs));
  const r2 = runCron(boardsWith(recs), advance(r1.state, 2 * 3600 * 1000 + 60000));
  T('[6a] run 1: C counted once by his confession', leavesOf(r1, C) === 1, 'leaves=' + leavesOf(r1, C) + ' ' + r1.out.slice(-400));
  T('[6a] at maturity: the key processed, C still exactly one exit-rate hit', r2.code === 0 && processedOf(r2).has(key) && leavesOf(r2, C) === 1, 'leaves=' + leavesOf(r2, C));
  // residual (pinned): the pending entry is already past maturity when C's confession is first read (cron down or his
  //   shard unread for most of the window, and he quit before level 1): the orphan verdict processes the key without
  //   him, the confession path then only marks it done -- one exit-rate hit lost. A change that closes it flips this.
  const pend = { [key]: { t0: Date.now() - 3 * 3600 * 1000, mt: 1, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C) }, settled: [], started: [v.pid(A), v.pid(B)] } };
  const r3 = runCron(boardsWith([{ sid: C, d: confess(1, h, 2, ros) }]), { STARTS_FILE: pend });
  T('[6a] residual: confession first read on the maturity run is not counted', r3.code === 0 && processedOf(r3).has(key) && leavesOf(r3, C) === 0, 'leaves=' + leavesOf(r3, C));
}
for (const stillUp of [true, false]) {
  // (b) ranked 3P: A and B settle (with starts), C quit and confessed (no start). The confession path fines him at
  //   first sight; on the settle run he is the usual "already confessed" seat, not a named-only one (no un on A / B).
  const tag = stillUp ? '[6b] confession still on the shard' : '[6c] confession rotated off before the settle run';
  const ros = [A, B, C], h = stillUp ? 0x6908 : 0x6909;
  const base = [{ sid: A, d: settle(2, h, 0, ros) }, { sid: B, d: settle(2, h, 1, ros) }, { sid: A, d: startRec(2, h, 0, ros) }, { sid: B, d: startRec(2, h, 1, ros) }];
  const withC = base.concat([{ sid: C, d: confess(2, h, 2, ros) }]);
  const { r1, r2 } = twoRuns(withC, stillUp ? withC : base);
  T(tag + ': the match settles', r2.code === 0 && processedOf(r2).has(keyOf(settle(2, h, 0, ros))), r2.out.slice(-600));
  T(tag + ': C one exit-rate hit and one -100 in total (the confession)', leavesOf(r2, C) === 1 && pointsWritesFor(r1, C).length + pointsWritesFor(r2, C).length === 1,
    'leaves=' + leavesOf(r2, C) + ' writes=' + (pointsWritesFor(r1, C).length + pointsWritesFor(r2, C).length));
  T(tag + ': the usual "already confessed" line, no named-only line', /already confessed -- consensus conviction skipped/.test(r2.out) && !/Q69\)/.test(r2.out));
  T(tag + ': no un signal on the writers', (sigOf(r2, A).un | 0) === 0 && (sigOf(r2, B).un | 0) === 0);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (leaver-own-record) ===');
process.exit(failN === 0 ? 0 : 1);
