'use strict';
// Absent-seat hold (R1-B2-04 / R1-X14, cloud audit 2026-10). End-to-end over the REAL validate.js main() against an offline
// board stub, several runs with the job's clock advanced between them (stored instants move back), plus the pure helpers.
// A roster seat with no record used to be convicted as a leaver on the spot, and the match marked processed:
//   - R1-B2-04: one record shard failed to read (5xx after retries, a 429 that was never retried, a 200 with no entries
//     block, a shard missing from the listing) -> the finisher whose record sits there was convicted (-100 points + exit
//     rate, no points / XP for the match) and their record was never looked at again
//   - R1-X14: a finisher whose record landed a little after the others' (slow results screen, upload retry) -> same
// Now the group waits: settles in full once the record lands, or without the seat once a COMPLETE read still lacks it
// after the grace (job clock, not run count).
//   [1] helpers: absentRosterSeats / absenceHold / shardPlan / transientStatus / constants
//   [2] 3P ranked, the finisher's shard unreadable (503 / 429 / 200 without entries / missing from the listing): no
//       conviction, held; next complete run settles all three seats
//   [3] late record (complete reads): held, still held two minutes later, settled in full when it lands
//   [4] a genuine leaver: held for the grace, then convicted exactly once (an empty shard answering an odd 200 does not
//       make the read incomplete)
//   [4b] Q69: the same absence, but the absent seat never wrote his own start record (only the others name him): held, then not convicted
//   [5] grace already over but this run's read is incomplete: still held; convicted on the next complete read
//   [6] private room (3 seats): the late finisher gets their XP (the group used to settle without them)
//   [7] bot match with two humans: the second human's late record joins the settle; when it never lands, the lone
//       record settles after the grace and nobody is convicted
//   [8] start verdicts (reconcileStarts) wait for a complete read: pure + end to end
//   [9] a single 429 on a shard is retried (the read completes, the match settles in one run)
//   [9b] escape hatch SHARD_STRICT_BODY=0: a 200 without entries reads as an empty board again (old behavior)
//   [10] wiring pins
//   [11] mutation self-checks (the gate / the verdict hold removed -> [3] / [8] go red)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/once-only-effects.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY'];
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
// stateless board stub (writes logged, not applied). Fault injection by board name:
//   STUB_FAIL      { name: httpStatus }   every entry read of that board fails
//   STUB_FAIL_ONCE { name: httpStatus }   the first entry read fails, later ones succeed (one process = one run)
//   STUB_MALFORMED [name]                  entry reads answer 200 with no entries block
//   STUB_HIDE      [name]                  the board is left out of the listing
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}'), ONCE = JSON.parse(process.env.STUB_FAIL_ONCE || '{}');",
  "const MAL = JSON.parse(process.env.STUB_MALFORMED || '[]'), HIDE = JSON.parse(process.env.STUB_HIDE || '[]');",
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
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.filter(b => HIDE.indexOf(b.name) < 0).map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  "    if (b && FAIL[b.name]) return resp({ error: 'injected' }, FAIL[b.name]);",
  "    if (b && ONCE[b.name]) { const st = ONCE[b.name]; delete ONCE[b.name]; return resp({ error: 'injected once' }, st); }",
  '    if (b && MAL.indexOf(b.name) >= 0) return resp({});',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'absence-grace-'));
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
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock: the points board name is season-derived
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
const convictLines = (r) => (r.out.match(/ {2}leaver [^\n]*\(in roster, no record/g) || []).length;
const settleLines = (r, m) => (r.out.match(new RegExp(' {2}settle ' + m + ': ', 'g')) || []).length;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc (a bot seat = sid 0)
function rec(mt, hash, seed, seat, roster, scores, levels, dur) {
  const pc = roster.length;
  const d = [0xB1, 3, mt, hash | 0, seed, seat, seat + 1, (levels << 1) | (seat === 0 ? 1 : 0), pc, dur];
  for (let i = 0; i < pc; i++) d.push(scores[i]);
  d.push(0);
  for (const s of roster) { const p = s ? sidPair(s) : [0, 0]; d.push(p[0], p[1]); }
  return d;
}
const ROS = [A, B, C];
const ranked = (h, seat) => rec(2, h, 1234, seat, ROS, [9000, 6000, 3000], 6, 720);
const priv3 = (h, seat) => rec(10, h, 555, seat, ROS, [5000, 3000, 1000], 3, 400);
const bot3 = (h, seat) => rec(11, h, 777, seat, [A, B, null], [9000, 6000, 100], 6, 480);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// rows: [{ shard, sid, d }] -- one row per (shard, account), like the real boards; 50 shards = the full live set
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: A, score: 2000 }, { steamID: B, score: 2000 }, { steamID: C, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// A on shard 0, B on shard 1, C on shard 2 (C's row only when withC)
const rows3 = (mk, h, withC) => [{ shard: 0, sid: A, d: mk(h, 0) }, { shard: 1, sid: B, d: mk(h, 1) }].concat(withC ? [{ shard: 2, sid: C, d: mk(h, 2) }] : []);
const FLOOR = v.SANITY.MIN_START_AGE_MS, GRACE = v.ABSENT_GRACE_MS, MIN = 60000;
// the human sids of a settle record's roster (a bot seat = sid 0 is skipped)
const rosterSids = (d) => { const pc = d[8], out = []; for (let i = 0; i < pc; i++) { const s = (BigInt(d[12 + pc + 2 * i] >>> 0) << 32n) | BigInt(d[11 + pc + 2 * i] >>> 0); if (s) out.push(s.toString()); } return out; };
// the match's start attestation was sighted by an earlier run, past the start floor (30 s margin: clock skew between this process and the child runs);
// every seated human wrote his own start record at level 1 unless `noStart` lists him (Q69: a leave is convicted only on the player's own record)
const attested = (d, ageMs, noStart) => { const s = {}; s[keyOf(d)] = { t0: Date.now() - (ageMs || FLOOR + 30000), mt: d[2], roster: {}, settled: [], started: rosterSids(d).filter((x) => (noStart || []).indexOf(x) < 0).map(v.pid) }; return { STARTS_FILE: s }; };

// ---- [1] helpers ----
console.log('-- [1] helpers --');
{
  T('[1] exports', typeof v.absentRosterSeats === 'function' && typeof v.absenceHold === 'function' && typeof v.shardPlan === 'function' && typeof v.transientStatus === 'function');
  T('[1] grace default 5 min, floor 3 min', GRACE === 300000 && v.ABSENT_GRACE_MIN_MS === 180000);
  T('[1] live shard count 50 (client LEDGER_SHARDS)', v.LEDGER_SHARDS === 50);
  const mk = (seat, roster, sid) => { const d = []; d[5] = seat; return { d, roster, steamID: sid }; };
  const sortS = (x) => x.slice().sort((a, b) => a.seat - b.seat);
  T('[1] absentRosterSeats: two records = detectLeavers', JSON.stringify(sortS(v.absentRosterSeats([mk(0, { 0: A, 1: B, 2: C }, A), mk(1, { 0: A, 1: B, 2: C }, B)]))) === JSON.stringify([{ seat: 2, steamID: C }]));
  T('[1] absentRosterSeats: a lone record lists the other roster seats (bot seats are not in the roster)', JSON.stringify(sortS(v.absentRosterSeats([mk(0, { 0: A, 1: B }, A)]))) === JSON.stringify([{ seat: 1, steamID: B }]));
  T('[1] absentRosterSeats: lone human vs bots -> nothing absent', v.absentRosterSeats([mk(0, { 0: A }, A)]).length === 0);
  T('[1] absentRosterSeats: everyone present -> nothing', v.absentRosterSeats([mk(0, { 0: A, 1: B }, A), mk(1, { 0: A, 1: B }, B)]).length === 0);
  const now = 10 * 3600000, gone = [{ seat: 2, steamID: C }];
  T('[1] absenceHold: nothing absent -> no hold, no stamp', (() => { const p = {}; const h = v.absenceHold([], p, now, true, GRACE); return h.hold === null && !p.absentAt; })());
  T('[1] absenceHold: incomplete read -> read hold, gap stamped', (() => { const p = {}; const h = v.absenceHold(gone, p, now, false, GRACE); return h.hold === 'read' && p.absentAt === now; })());
  T('[1] absenceHold: complete, first sight -> grace hold of the full grace', (() => { const p = {}; const h = v.absenceHold(gone, p, now, true, GRACE); return h.hold === 'grace' && h.waitMs === GRACE && p.absentAt === now; })());
  T('[1] absenceHold: stamp kept on later runs (never moved forward)', (() => { const p = { absentAt: now - MIN }; v.absenceHold(gone, p, now, true, GRACE); return p.absentAt === now - MIN; })());
  T('[1] absenceHold: grace over + complete -> settle without the seat', v.absenceHold(gone, { absentAt: now - GRACE }, now, true, GRACE).hold === null);
  T('[1] absenceHold: grace over but incomplete -> still held', v.absenceHold(gone, { absentAt: now - GRACE - MIN }, now, false, GRACE).hold === 'read');
  T('[1] absenceHold: a stamp from the future restarts the wait', (() => { const h = v.absenceHold(gone, { absentAt: now + 3600000 }, now, true, GRACE); return h.hold === 'grace' && h.waitMs === GRACE; })());
  T('[1] absenceHold: a grace below the floor is raised to 3 min', (() => { const h = v.absenceHold(gone, { absentAt: now - 2 * MIN }, now, true, 1000); return h.hold === 'grace' && h.waitMs === MIN; })());
  const names = []; for (let i = 0; i < 50; i++) names.push('lb_rec_' + i);
  T('[1] shardPlan: full live set -> read 50, nothing missing', (() => { const p = v.shardPlan(names, 'lb_rec_', 50, false); return p.read.length === 50 && !p.missing.length && !p.extra.length && !p.mismatch; })());
  T('[1] shardPlan: one shard missing from the listing -> reported missing', (() => { const p = v.shardPlan(names.filter(n => n !== 'lb_rec_7'), 'lb_rec_', 50, false); return p.read.length === 49 && p.missing.join() === 'lb_rec_7' && !p.mismatch; })());
  T('[1] shardPlan: other boards with the prefix are not read', (() => { const p = v.shardPlan(names.concat(['lb_rec_50', 'lb_rec_old']), 'lb_rec_', 50, false); return p.read.length === 50 && p.extra.join() === 'lb_rec_50,lb_rec_old'; })());
  T('[1] shardPlan: prefix boards but none of the expected names -> mismatch, read them all', (() => { const p = v.shardPlan(['lb_rec_a', 'lb_rec_b'], 'lb_rec_', 50, false); return p.mismatch && p.read.length === 2; })());
  T('[1] shardPlan: no board at all -> everything missing (no mismatch)', (() => { const p = v.shardPlan([], 'lb_rec_', 50, false); return !p.mismatch && p.read.length === 0 && p.missing.length === 50; })());
  T('[1] shardPlan: sandbox (local e2e pool) reads every listed board', (() => { const p = v.shardPlan(['lbtest_pool', 'lbtest_pool_b', 'lbtest_pool_c'], 'lbtest_pool', 50, true); return p.read.length === 3 && !p.missing.length && !p.mismatch; })());
  T('[1] transientStatus: 5xx / 408 / 429 retry, other 4xx do not', v.transientStatus(503) && v.transientStatus(500) && v.transientStatus(408) && v.transientStatus(429) && !v.transientStatus(403) && !v.transientStatus(404) && !v.transientStatus(200));
}

// ---- [2] R1-B2-04: the finisher's shard unreadable ----
console.log('-- [2] unreadable shard --');
for (const [label, env, expectLog] of [
  ['503 after retries', { STUB_FAIL: JSON.stringify({ shard_2: 503 }) }, /read shard failed/],
  ['429 every time', { STUB_FAIL: JSON.stringify({ shard_2: 429 }) }, /read shard failed/],
  ['200 without entries', { STUB_MALFORMED: JSON.stringify(['shard_2']) }, /without entry information/],
  ['left out of the listing', { STUB_HIDE: JSON.stringify(['shard_2']) }, /1 of 50 shard\(s\) missing/],
]) {
  const h = 0x2100 + label.length, m = keyOf(ranked(h, 0));
  const boards = world(rows3(ranked, h, true));
  const r1 = runCron(boards, attested(ranked(h, 0)), env);
  T('[2 ' + label + '] run 1 exits 0 and logs the fault', r1.code === 0 && expectLog.test(r1.out), r1.out.slice(-600));
  T('[2 ' + label + '] run 1: nobody convicted, match not processed', convictLines(r1) === 0 && leavesOf(r1, C) === 0 && !processedOf(r1).has(m) && writes(r1, 7).length === 0,
    'convict=' + convictLines(r1) + ' leaves=' + leavesOf(r1, C) + ' processed=' + processedOf(r1).has(m) + ' pointsWrites=' + writes(r1, 7).length);
  T('[2 ' + label + '] run 1: logged as an incomplete-read hold', /absent-hold [^\n]*not every record shard was read this run/.test(r1.out));
  const r2 = runCron(boards, advance(r1.state, MIN));
  T('[2 ' + label + '] run 2 (shard readable): settled with all three seats, nobody convicted', processedOf(r2).has(m) && settleLines(r2, m) === 3 && convictLines(r2) === 0 && leavesOf(r2, C) === 0,
    'processed=' + processedOf(r2).has(m) + ' settleLines=' + settleLines(r2, m) + ' convict=' + convictLines(r2));
  T('[2 ' + label + '] run 2: C gets their points and XP like the others', writes(r2, 7, C).length === 1 && writes(r2, 5, C).length === 1, 'points=' + writes(r2, 7, C).length + ' xp=' + writes(r2, 5, C).length);
}

// ---- [3] R1-X14: late record ----
console.log('-- [3] late record --');
{
  const h = 0x3100, m = keyOf(ranked(h, 0));
  const r1 = runCron(world(rows3(ranked, h, false)), attested(ranked(h, 0)));
  T('[3] run 1 (C not written yet): held for the grace, nobody convicted', r1.code === 0 && !processedOf(r1).has(m) && convictLines(r1) === 0 && /absent-hold [^\n]*grace 300s left/.test(r1.out), r1.out.slice(-600));
  T('[3] run 1: the gap is stamped in the start entry', ((r1.state.STARTS_FILE || {})[m] || {}).absentAt > 0);
  const r2 = runCron(world(rows3(ranked, h, false)), advance(r1.state, 2 * MIN));   // about 180 s left (minus the real time between the runs)
  T('[3] run 2 two minutes later (C still missing): still held', !processedOf(r2).has(m) && convictLines(r2) === 0 && /absent-hold [^\n]*grace 1[0-9][0-9]s left/.test(r2.out), (r2.out.match(/absent-hold[^\n]*/) || [''])[0]);
  const r3 = runCron(world(rows3(ranked, h, true)), advance(r2.state, 30000));
  T('[3] run 3 (C landed): settled with all three seats, C never convicted', processedOf(r3).has(m) && settleLines(r3, m) === 3 && convictLines(r3) === 0 && leavesOf(r3, C) === 0,
    'settleLines=' + settleLines(r3, m) + ' convict=' + convictLines(r3));
  T('[3] run 3: C credited (points + XP)', writes(r3, 7, C).length === 1 && writes(r3, 5, C).length === 1);
}

// ---- [4] a genuine leaver ----
console.log('-- [4] genuine leaver --');
{
  const h = 0x4100, m = keyOf(ranked(h, 0));
  const boards = world(rows3(ranked, h, false));
  const r1 = runCron(boards, attested(ranked(h, 0)));
  T('[4] run 1: held', !processedOf(r1).has(m) && convictLines(r1) === 0);
  // run 2: the grace has passed; an EMPTY shard (listing says 0 entries) answering a 200 with no entries block is not a fault
  const r2 = runCron(boards, advance(r1.state, GRACE + 1000), { STUB_MALFORMED: JSON.stringify(['shard_9']) });
  T('[4] run 2 (grace over, complete read): C convicted once, the others settle', processedOf(r2).has(m) && settleLines(r2, m) === 2 && convictLines(r2) === 1 && leavesOf(r2, C) === 1,
    'processed=' + processedOf(r2).has(m) + ' settleLines=' + settleLines(r2, m) + ' convict=' + convictLines(r2) + ' leaves=' + leavesOf(r2, C));
  T('[4] run 2: the leaver points penalty is written for C', writes(r2, 7, C).length === 1 && /leaver LP [^\n]*pts 2000-100->1900/.test(r2.out));
  const r3 = runCron(boards, advance(r2.state, MIN));
  T('[4] run 3: nothing more (processed)', convictLines(r3) === 0 && leavesOf(r3, C) === 1 && writes(r3, 7).length === 0);
  // Q69: the same absence, but C never wrote his own start record (only A's and B's rosters name him): held for the grace
  // like any absent seat, then the others settle and C is not convicted
  const h2 = 0x4200, m2 = keyOf(ranked(h2, 0));
  const boards2 = world(rows3(ranked, h2, false));
  const q1 = runCron(boards2, attested(ranked(h2, 0), 0, [C]));
  T('[4b] Q69 run 1 (C named only): held like any absent seat', !processedOf(q1).has(m2) && convictLines(q1) === 0);
  const q2 = runCron(boards2, advance(q1.state, GRACE + 1000));
  T('[4b] Q69 run 2 (grace over): A and B settle, C not convicted, no points penalty, logged', processedOf(q2).has(m2) && settleLines(q2, m2) === 2 && convictLines(q2) === 0 && leavesOf(q2, C) === 0
    && writes(q2, 7, C).length === 0 && /never wrote his own record for this match/.test(q2.out),
    'processed=' + processedOf(q2).has(m2) + ' settleLines=' + settleLines(q2, m2) + ' convict=' + convictLines(q2) + ' leaves=' + leavesOf(q2, C));
}

// ---- [5] grace over but the read is incomplete ----
console.log('-- [5] grace over, incomplete read --');
{
  const h = 0x5100, m = keyOf(ranked(h, 0));
  const boards = world(rows3(ranked, h, false));
  const r1 = runCron(boards, attested(ranked(h, 0)));
  const r2 = runCron(boards, advance(r1.state, GRACE + MIN), { STUB_FAIL: JSON.stringify({ shard_9: 503 }) });
  T('[5] run 2 (grace over, one shard failed): still held, nobody convicted', !processedOf(r2).has(m) && convictLines(r2) === 0 && leavesOf(r2, C) === 0 && /absent-hold [^\n]*not every record shard/.test(r2.out));
  const r3 = runCron(boards, advance(r2.state, MIN));
  T('[5] run 3 (complete read): convicted now, once', processedOf(r3).has(m) && convictLines(r3) === 1 && leavesOf(r3, C) === 1);
}

// ---- [6] private room: the late finisher keeps their XP ----
console.log('-- [6] private room --');
{
  const h = 0x6100, m = keyOf(priv3(h, 0));
  const reqP = Math.max(FLOOR, 3 * v.PRIVATE_XP.LEVEL_SECONDS * 1000 * v.PRIVATE_XP.PACE_FRAC);
  const r1 = runCron(world(rows3(priv3, h, false)), attested(priv3(h, 0), reqP + 30000));
  T('[6] run 1 (C not written yet): the room waits', !processedOf(r1).has(m) && /absent-hold /.test(r1.out) && writes(r1, 5).length === 0, r1.out.slice(-500));
  const r2 = runCron(world(rows3(priv3, h, true)), advance(r1.state, MIN));
  T('[6] run 2 (C landed): settled with three writers, XP for all three', processedOf(r2).has(m) && /private settle [^\n]*: 3 writers/.test(r2.out) && writes(r2, 5, C).length === 1 && writes(r2, 5).length === 3,
    'xpWrites=' + writes(r2, 5).length + ' ' + ((r2.out.match(/private settle[^\n]*/) || [''])[0]));
}

// ---- [7] bot match with two humans ----
console.log('-- [7] bot match --');
{
  const reqB = Math.max(FLOOR, 6 * v.BOT_XP.LEVEL_SECONDS * 1000 * v.BOT_XP.PACE_FRAC);
  const h = 0x7100, m = keyOf(bot3(h, 0));
  const onlyA = [{ shard: 0, sid: A, d: bot3(h, 0) }], both = onlyA.concat([{ shard: 1, sid: B, d: bot3(h, 1) }]);
  const r1 = runCron(world(onlyA), attested(bot3(h, 0), reqB + 30000));
  T('[7] run 1 (B not written yet): the lone record waits', !processedOf(r1).has(m) && /absent-hold /.test(r1.out) && writes(r1, 5).length === 0, r1.out.slice(-500));
  const r2 = runCron(world(both), advance(r1.state, MIN));
  T('[7] run 2 (B landed): two-writer settle, XP for both, no lone discount', processedOf(r2).has(m) && /bots settle [^\n]*: 2 writers/.test(r2.out) && !/lone lane/.test(r2.out) && writes(r2, 5, A).length === 1 && writes(r2, 5, B).length === 1,
    (r2.out.match(/bots settle[^\n]*/) || [''])[0]);
  const h2 = 0x7200, m2 = keyOf(bot3(h2, 0));
  const lone = [{ shard: 0, sid: A, d: bot3(h2, 0) }];
  const q1 = runCron(world(lone), attested(bot3(h2, 0), reqB + 30000));
  const q2 = runCron(world(lone), advance(q1.state, GRACE + 1000));
  T('[7b] B never lands: after the grace the lone record settles (A only), nobody convicted', !processedOf(q1).has(m2) && processedOf(q2).has(m2) && /lone lane/.test(q2.out) && writes(q2, 5, A).length === 1 && writes(q2, 5, B).length === 0 && leavesOf(q2, B) === 0,
    (q2.out.match(/bots settle[^\n]*/) || [''])[0]);
}

// ---- [8] start verdicts wait for a complete read ----
console.log('-- [8] start verdicts --');
{
  const MAT = v.STARTS_MATURITY_MS, now = 100 * 3600000, m = '77_88_2';
  const mkPend = () => { const p = {}; p[m] = { t0: now - MAT - MIN, mt: 2, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [v.pid(A)], started: [v.pid(A), v.pid(B)] }; return p; };
  let pend = mkPend(), lv = {};
  let res = v.reconcileStarts([], {}, new Set(), new Set(), pend, lv, now, MAT, {}, false);
  T('[8] readComplete=false: matured entry held, nobody convicted, entry kept', res.held === 1 && res.convicted === 0 && !lv[v.pid(B)] && !!pend[m], JSON.stringify(res));
  res = v.reconcileStarts([], {}, new Set(), new Set(), pend, lv, now, MAT, {}, true);
  T('[8] readComplete=true: verdict as before (B convicted, A exempt)', res.convicted >= 1 && (lv[v.pid(B)] || {}).leaves === 1 && !lv[v.pid(A)], JSON.stringify(res));
  pend = mkPend(); lv = {};
  res = v.reconcileStarts([], {}, new Set(), new Set(), pend, lv, now, MAT, {});
  T('[8] readComplete omitted (older callers): verdict as before', (lv[v.pid(B)] || {}).leaves === 1);
  // end to end: the main path passes the run's shard completeness
  const st = {}; st[m] = { t0: Date.now() - MAT - MIN, mt: 2, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [], started: [v.pid(A), v.pid(B)] };
  const e1 = runCron(world([]), { STARTS_FILE: st }, { STUB_FAIL: JSON.stringify({ shard_4: 503 }) });
  T('[8] e2e run with a failed shard: no exit-rate verdict, entry kept', leavesOf(e1, A) === 0 && leavesOf(e1, B) === 0 && !!(e1.state.STARTS_FILE || {})[m], e1.out.slice(-400));
  const e2 = runCron(world([]), advance(e1.state, MIN));
  T('[8] e2e next complete run: verdict lands', leavesOf(e2, A) === 1 && leavesOf(e2, B) === 1);
}

// ---- [9] a single 429 is retried ----
console.log('-- [9] 429 retry --');
{
  const h = 0x9100, m = keyOf(ranked(h, 0));
  const r1 = runCron(world(rows3(ranked, h, true)), attested(ranked(h, 0)), { STUB_FAIL_ONCE: JSON.stringify({ shard_2: 429 }) });
  T('[9] one 429 on C\'s shard: retried, read complete, settled in one run with all three seats', processedOf(r1).has(m) && settleLines(r1, m) === 3 && convictLines(r1) === 0 && !/read shard failed/.test(r1.out),
    'settleLines=' + settleLines(r1, m) + ' ' + r1.out.slice(-400));
}

// ---- [9b] escape hatch: SHARD_STRICT_BODY=0 reads a 200 without entries as an empty board (the old behavior) ----
{
  const h = 0x9200, m = keyOf(ranked(h, 0));
  const r1 = runCron(world(rows3(ranked, h, true)), attested(ranked(h, 0)), { STUB_MALFORMED: JSON.stringify(['shard_2']), SHARD_STRICT_BODY: '0' });
  T('[9b] SHARD_STRICT_BODY=0: no read failure logged, C\'s gap waits on the grace (not on the read)', !/without entry information/.test(r1.out) && /absent-hold [^\n]*grace 300s left/.test(r1.out) && !processedOf(r1).has(m),
    (r1.out.match(/absent-hold[^\n]*/) || [''])[0]);
}

// ---- [10] wiring pins ----
console.log('-- [10] wiring pins --');
{
  const iHold = SRC.indexOf('const absHold = absenceHold(absentNow, pend, nowMs, shardsComplete, ABSENT_GRACE_MS);');
  const iPace = SRC.indexOf('if (pacingDefer(pend, nowMs, SANITY.MIN_START_AGE_MS))');
  const iGate = SRC.indexOf('if (absHold.hold) {');
  const iWriter = SRC.indexOf('if (!isPrivateMt(matchType) && !isBotMt(matchType) && writerPaced(c.m, writerSids, pend.t0, SANITY.MIN_START_AGE_MS)) continue;');
  const iPriv = SRC.indexOf('if (isPrivateMt(matchType)) {', iWriter), iBot = SRC.indexOf('if (isBotMt(matchType)) {', iWriter);
  T('[10] gap stamped before the start floor, judged after it, before the one-match claim and every lane', iHold > 0 && iHold < iPace && iPace < iGate && iGate < iWriter && iWriter < iPriv && iWriter < iBot);
  T('[10] the absent list skips writers seen agreeing earlier', /const absentNow = absentRosterSeats\(g\)\.filter\(\(x\) => agreed\.indexOf\(pid\(String\(x\.steamID\)\)\) < 0\);/.test(SRC));
  T('[10] start verdicts get the run\'s completeness', /reconcileStarts\(starts, groups, consistentKeys, processed, startsPending, leavers, nowMs, STARTS_MATURITY_MS, confState, shardsComplete\)/.test(SRC));
  T('[10] shard reads are strict about the body (escape hatch SHARD_STRICT_BODY=0)', /readBoardAll\(id, 'shard ' \+ label, \{ strictBody: SHARD_STRICT_BODY, expectEntries: /.test(SRC) && /const SHARD_STRICT_BODY = process\.env\.SHARD_STRICT_BODY !== '0';/.test(SRC));
  T('[10] completeness starts from the shard listing check', /let shardsComplete = shards\.length > 0 && !shardSel\.missing\.length && !shardSel\.mismatch;/.test(SRC));
  T('[10] reads retry on transientStatus', /if \(transientStatus\(r\.status\) && attempt < 2\)/.test(SRC));
  T('[10] run summary reports the holds', /absent-seat holds \(incomplete read \/ grace\)/.test(SRC));
}

// ---- [11] mutation self-checks ----
console.log('-- [11] mutation self-checks --');
{
  const mutants = [
    ['absent-seat gate removed', 'if (absHold.hold) {', 'if (false && absHold.hold) {', (script) => {
      const h = 0xB100;
      const r = runCron(world(rows3(ranked, h, false)), attested(ranked(h, 0)), null, script);
      return convictLines(r) === 1;   // [3] run 1 convicts the late finisher again
    }],
    ['verdict hold removed', "if (readComplete === false) { held++; continue; }", "if (false) { held++; continue; }", (script) => {
      const m = '77_88_2', st = {}; st[m] = { t0: Date.now() - v.STARTS_MATURITY_MS - MIN, mt: 2, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [], started: [v.pid(A), v.pid(B)] };
      const r = runCron(world([]), { STARTS_FILE: st }, { STUB_FAIL: JSON.stringify({ shard_4: 503 }) }, script);
      return leavesOf(r, B) === 1;   // [8] verdict lands on an incomplete read again
    }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-absence-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[11] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (absence-grace)') : 'ALL OK (absence-grace)');
process.exit(failN ? 1 : 0);
