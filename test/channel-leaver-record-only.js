'use strict';
// M194 / W57 (2026-10-15, user ruling under architecture decision 10): through the Steam Next Fest the DEMO channel records
// leaves but does not discount XP for them -- LEAVER_XP_RECORD_ONLY_UNTIL (demo.yml only) pins the leaver factor at 1.0
// until that instant. This test pins:
//   [1] the switch itself (leaverXpRecordOnlyUntil): demo channel only, strict ISO-8601 UTC, before the instant only,
//       at most LEAVER_XP_RECORD_ONLY_MAX_MS ahead; anything else = 0 = the normal discount
//   [2] end to end over the REAL validate.js main() against an offline board stub, per channel x switch state
//       (on / unset / expired x demo / playtest / main): a 3-player quick match where A (two earlier leaves = factor 0.5)
//       and B finish and C starts but never finishes. Switch on (demo only): A is credited exactly as if he had no leaves,
//       B is unchanged, C's leave is still counted and A's earlier leaves stay -- the only difference a before/after
//       replay may show is "a demo account with leaves on record gets more XP". Every other cell: A is discounted as before.
//   [3] mutation self-check: the factor pin removed from creditXp -> the demo "on" cell goes red
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'LEAVE_CONFIRM_MS'];
for (const k of SCRUB) delete process.env[k];
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
for (const k of FILE_VARS) delete process.env[k];
const v = require(VALIDATE);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'EXPECT ' + JSON.stringify(exp));

// ---- [1] the switch ----
console.log('-- [1] leaverXpRecordOnlyUntil --');
{
  const f = v.leaverXpRecordOnlyUntil, NOW = Date.parse('2026-10-16T00:00:00Z'), END = Date.parse('2026-10-27T00:00:00Z'), MAX = v.LEAVER_XP_RECORD_ONLY_MAX_MS;
  eq('demo, before the instant -> the instant', f('demo', '2026-10-27T00:00:00Z', NOW), END);
  eq('demo, seconds / millis / no seconds all strict UTC', [f('demo', '2026-10-27T00:00:00.000Z', NOW), f('demo', '2026-10-27T00:00Z', NOW)], [END, END]);
  eq('demo, surrounding blanks trimmed', f('demo', '  2026-10-27T00:00:00Z ', NOW), END);
  eq('demo, at the instant -> 0 (over)', f('demo', '2026-10-27T00:00:00Z', END), 0);
  eq('demo, after the instant -> 0 (expired)', f('demo', '2026-10-27T00:00:00Z', END + 1), 0);
  eq('demo, unset / empty / null -> 0', [f('demo', undefined, NOW), f('demo', '', NOW), f('demo', null, NOW)], [0, 0, 0]);
  eq('demo, not strict UTC (date only / offset / local / garbage) -> 0',
    [f('demo', '2026-10-27', NOW), f('demo', '2026-10-27T08:00:00+08:00', NOW), f('demo', '2026-10-27T00:00:00', NOW), f('demo', 'soon', NOW), f('demo', '2026-13-45T00:00:00Z', NOW)], [0, 0, 0, 0, 0]);
  eq('demo, exactly the cap ahead -> honored; past the cap (a typo\'d year) -> 0',
    [f('demo', new Date(NOW + MAX).toISOString(), NOW), f('demo', new Date(NOW + MAX + 1000).toISOString(), NOW), f('demo', '2027-10-27T00:00:00Z', NOW)], [NOW + MAX, 0, 0]);
  eq('cap = 31 days', MAX, 31 * 24 * 3600 * 1000);
  eq('main (ea) / playtest / unknown channel -> 0', [f('ea', '2026-10-27T00:00:00Z', NOW), f('playtest', '2026-10-27T00:00:00Z', NOW), f(null, '2026-10-27T00:00:00Z', NOW)], [0, 0, 0]);
  eq('this test process (no switch set) -> off', v.LEAVER_XP_RECORD_ONLY, 0);
  eq('effectiveLeaverFactor untouched (client lockstep mirror): 2 leaves / 0 games', v.effectiveLeaverFactor(2, 0), 0.5);
}

// ---- [2] end to end over the real reconcile ----
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
const HELPER = ['stub.js', 'fx.json', 'post.log'];
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaver-record-only-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    for (const [name, body] of Object.entries(files || {})) fs.writeFileSync(path.join(dir, name), body);
    const base = Object.assign({}, process.env);
    for (const k of SCRUB.concat(FILE_VARS)) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',
    }, env || {});
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const left = {};
    for (const name of fs.readdirSync(dir)) if (HELPER.indexOf(name) < 0) left[name] = fs.readFileSync(path.join(dir, name), 'utf8');
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, left };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}

const MIN = 60000;
const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const SALTED = (sid) => crypto.createHmac('sha256', 's').update(String(sid)).digest('hex').slice(0, 16);   // validate.js pid() under STATE_SALT 's'
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// ledger record, result-reporter wire form (as test/channel-state-files.js); start records (0xB2) zero every result field
function rec(magic, mt, hash, seat, sids) {
  const settle = magic === 0xB1, pc = sids.length;
  const d = [magic, settle ? 3 : 1, mt, hash | 0, 1234, seat, settle ? seat + 1 : 0, settle ? ((6 << 1) | (seat === 0 ? 1 : 0)) : 0, pc, settle ? 720 : 0];
  for (let i = 0; i < pc; i++) d.push(settle ? 9000 - 3000 * i : 0);
  d.push(0);
  for (const s of sids) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const K = 0x4807, MT = 1, ROSTER = [A, B, C];
// all three attest the start (C's own start = he is convicted under Q69), A and B finish, C never does
const ROWS = [
  { shard: 0, sid: A, d: rec(0xB2, MT, K, 0, ROSTER) }, { shard: 0, sid: B, d: rec(0xB2, MT, K, 1, ROSTER) }, { shard: 0, sid: C, d: rec(0xB2, MT, K, 2, ROSTER) },
  { shard: 1, sid: A, d: rec(0xB1, MT, K, 0, ROSTER) }, { shard: 1, sid: B, d: rec(0xB1, MT, K, 1, ROSTER) },
];
const XP_BOARD = 5;
function world(extra) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of ROWS) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  return boards.concat([{ id: XP_BOARD, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }], extra || []);
}
// the twin's own state-file names (same parse as test/channel-state-files.js)
const WF = path.join(__dirname, '..', '.github', 'workflows');
function twinFiles(file, job) {
  const src = fs.readFileSync(path.join(WF, file), 'utf8');
  const start = src.indexOf('\n  ' + job + ':\n');
  const next = src.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const body = next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
  const files = {};
  for (const m of body.matchAll(/^ {10}([A-Z0-9_]+_FILE):\s*([a-z0-9.-]+\.json)\s*$/gm)) files[m[1]] = m[2];
  const sw = body.match(/^ {10}LEAVER_XP_RECORD_ONLY_UNTIL:\s*'([^']*)'\s*$/m);
  return { files, until: sw ? sw[1] : null };
}
const DM = twinFiles('demo.yml', 'demo'), PT = twinFiles('playtest.yml', 'playtest');
const MAIN_FILES = {};
for (const m of SRC.matchAll(/const ([A-Z0-9_]+_FILE) = process\.env\.\1 \|\| '([a-z0-9.-]+\.json)'/g)) MAIN_FILES[m[1]] = m[2];
const CHANNEL = {
  demo: { files: DM.files, env: Object.assign({ PT_MODE: '1', APPID: '2', DEMO_APPID: '2' }, DM.files) },
  playtest: { files: PT.files, env: Object.assign({ PT_MODE: '1', APPID: '1', DEMO_APPID: '2' }, PT.files) },
  main: { files: MAIN_FILES, env: { RANKED_LB: 'rating', LP_LB: 'points' }, boards: [{ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }] },
};
// run 1 sees the starts; between runs the clock moves on (stored instants shift back): past start maturity, then past
//   C's leave confirmation -- by the third run A + B are settled and C convicted. Returns the last run (output and
//   board writes of all three).
function advance(left, names, ms) {
  const files = Object.assign({}, left);
  if (files[names.STARTS_FILE]) {
    const st = JSON.parse(files[names.STARTS_FILE]);
    for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
    files[names.STARTS_FILE] = JSON.stringify(st);
  }
  return files;
}
function cell(ch, until, priorLeavesA, script) {
  const c = CHANNEL[ch], names = c.files;
  const env = Object.assign({}, c.env, until == null ? {} : { LEAVER_XP_RECORD_ONLY_UNTIL: until });
  const seed = {};
  if (priorLeavesA) seed[names.LEAVERS_FILE] = JSON.stringify({ [SALTED(A)]: { leaves: priorLeavesA, lastMatch: 'earlier_1' } });
  const r1 = runCron(world(c.boards), seed, env, script);
  const r2a = runCron(world(c.boards), advance(r1.left, names, v.STARTS_MATURITY_MS + MIN), env, script);
  const r2 = runCron(world(c.boards), advance(r2a.left, names, v.LEAVE_CONFIRM_MS + MIN), env, script);
  r2.out = r1.out + r2a.out + r2.out;
  r2.posts = r1.posts.concat(r2a.posts, r2.posts);   // whichever run settles (the absence grace may already be over in the second)
  const xpOf = (sid) => {
    const w = r2.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + XP_BOARD + '(&|$)').test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body));
    const m = w.length ? /score=(-?[0-9]+)/.exec(w[w.length - 1].body) : null;
    return m ? Number(m[1]) : null;
  };
  let leavers = {}; try { leavers = JSON.parse(r2.left[names.LEAVERS_FILE] || '{}'); } catch (e) {}
  const leavesOf = (sid) => (leavers[SALTED(sid)] && leavers[SALTED(sid)].leaves) | 0;
  return { r1, r2, xpA: xpOf(A), xpB: xpOf(B), leavesA: leavesOf(A), leavesC: leavesOf(C), out: r2.out };
}
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const PAST = new Date(Date.now() - 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

console.log('-- [2] end to end: 3P quick, A has 2 earlier leaves, B clean, C leaves --');
const base = cell('demo', null, 0);   // nobody has leaves: the undiscounted reference
T('[2] reference run settles (A + B credited, C convicted)', base.r2.code === 0 && base.xpA > 0 && base.xpB > 0 && base.leavesC === 1, base.out.slice(-900));
const want = {   // A's XP per cell: full = the reference value; half = what the 0.5 factor makes of it
  full: base.xpA,
  half: v.computeXpGain('valid', 0, 9000, false, true, 0.5, 1),
};
T('[2] the discounted value is really lower (the fixture reaches the factor)', want.half > 0 && want.half < want.full, JSON.stringify(want));
const CELLS = [
  ['demo', 'on', FUTURE, 'full'], ['demo', 'unset', null, 'half'], ['demo', 'expired', PAST, 'half'],
  ['playtest', 'on', FUTURE, 'half'], ['playtest', 'unset', null, 'half'],
  ['main', 'on', FUTURE, 'half'], ['main', 'unset', null, 'half'],
];
for (const [ch, state, until, exp] of CELLS) {
  const c = cell(ch, until, 2);
  const tag = '[2] ' + ch + ' / switch ' + state + ':';
  T(tag + ' run exits 0', c.r1.code === 0 && c.r2.code === 0, c.out.slice(-900));
  eq(tag + ' A (2 earlier leaves) credited ' + exp, c.xpA, want[exp]);
  eq(tag + ' B (no leaves) unchanged', c.xpB, base.xpB);
  eq(tag + ' C\'s leave still counted', c.leavesC, 1);
  eq(tag + ' A\'s earlier leaves kept', c.leavesA, 2);
  const onLine = /leaver xp: record-only on the demo channel until /.test(c.out);
  T(tag + ' "record-only on" logged only when it is on', onLine === (exp === 'full'));
  if (exp === 'full') T(tag + ' the XP line says what it would have been', /x1 \(record-only, would be x0\.5\)/.test(c.out));
  if (state === 'expired') T(tag + ' "window ended" logged', /leaver xp: record-only window ended at /.test(c.out));
  if (state === 'on' && ch !== 'demo') T(tag + ' warns: set on a non-demo channel is ignored', /::warning::LEAVER_XP_RECORD_ONLY_UNTIL is set on the [a-z]+ channel -- ignored \(demo only\)/.test(c.out));
}
{
  const c = cell('demo', '2026-10-27', 2);   // date only: not strict UTC
  eq('[2] demo / malformed value: A discounted (fail-safe to the status quo)', c.xpA, want.half);
  T('[2] demo / malformed value: warned', /::warning::LEAVER_XP_RECORD_ONLY_UNTIL="2026-10-27" not honored/.test(c.out));
}
{
  // the value demo.yml actually carries: a quoted strict UTC instant, within the cap whenever it is still ahead
  T('[2] demo.yml carries the switch', !!DM.until, String(DM.until));
  T('[2] playtest.yml does not', PT.until == null);
  const t = Date.parse(DM.until || '');
  if (t > Date.now()) eq('[2] demo.yml value honored while ahead', v.leaverXpRecordOnlyUntil('demo', DM.until, Date.now()), t);
  else ok('[2] demo.yml value is in the past: the discount is back on (the line can stay or go)');
}

// ---- [3] mutation self-check ----
console.log('-- [3] mutation self-check --');
{
  const from = 'const factor = LEAVER_XP_RECORD_ONLY ? 1 : lf;';
  if (SRC.split(from).length !== 2) bad('[3] anchor (factor pin in creditXp) not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-leaver-record-only-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, 'const factor = lf;'));
      const c = cell('demo', FUTURE, 2, script);
      T('[3] pin removed -> the demo "on" cell discounts A again (the [2] demo/on check goes red)', c.r2.code === 0 && c.xpA === want.half, 'xpA=' + c.xpA + ' ' + c.out.slice(-400));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (channel-leaver-record-only)') : 'ALL OK (channel-leaver-record-only)');
process.exit(failN ? 1 : 0);
