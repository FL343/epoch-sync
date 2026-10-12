'use strict';
// The playtest / demo reconcile twins set SKILL_FILE / GROUPS_FILE but deliberately leave them off the persist list
// (workflow comment "rating-side state is never produced in PT mode"; test/channel-workflows.js NOT_PERSISTED). That
// exemption was trusted, not verified: the day PT_MODE starts rating or group decay, each run would rebuild the
// file from {} -- no error, nothing red (cloud audit Q48). This test proves it instead, end to end over the REAL
// validate.js main() against an offline board stub, under each twin's OWN state-file names (parsed from its
// workflow; cwd = an empty temp dir; a *_FILE var the workflow does not set is left at its default, like CI):
//   [1] playtest twin: a consistent 2P quick match (start attested, matured) settles; every state file the run
//       wrote is on the job's persist list, or carries no data; no main-channel (unprefixed) state file appears
//   [2] demo twin: the same
//   [3] sensitivity: the same match on the main channel DOES write rating + group memory (the fixture reaches the
//       code the exemption depends on)
//   [4] mutation self-checks: PT_MODE's rating / group-decay skip removed -> [1] goes red; a written file dropped
//       from the persist list, or no longer named by the twin (falls back to the main channel's file) -> flagged
// When [1] / [2] go red because PT_MODE now produces rating state: persist the file in playtest.yml + demo.yml and
// drop it from NOT_PERSISTED in test/channel-workflows.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY'];
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

// ---- the twins' own state-file names and persist lists (same parse as test/channel-workflows.js) ----
const WF = path.join(__dirname, '..', '.github', 'workflows');
function jobBody(src, job) {
  const start = src.indexOf('\n  ' + job + ':\n');
  if (start < 0) return '';
  const next = src.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}
function twinOf(file, job) {
  const body = jobBody(fs.readFileSync(path.join(WF, file), 'utf8'), job);
  const files = {};
  for (const m of body.matchAll(/^ {10}([A-Z0-9_]+_FILE):\s*([a-z0-9.-]+\.json)\s*$/gm)) files[m[1]] = m[2];
  const p = body.slice(body.indexOf('- name: persist')).match(/for f in ([^;]+); do/);
  return { file, job, ptMode: /^ {10}PT_MODE:\s*'1'\s*$/m.test(body), files, persist: p ? p[1].trim().split(/\s+/) : [] };
}
// read-only consults are pointed into the temp dir too (hermetic: never the repo's copy); the persistence question is
//   about what the run WRITES, and validate.js writes only through writeStateFile(<var>, ...)
const WRITTEN = new Set(Array.from(SRC.matchAll(/writeStateFile\(([A-Z0-9_]+_FILE),/g), m => m[1]));
const DEFAULTS = {};
for (const m of SRC.matchAll(/const ([A-Z0-9_]+_FILE) = process\.env\.\1 \|\| '([a-z0-9.-]+\.json)'/g)) DEFAULTS[m[1]] = m[2];

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
// files: { name: content } carried into the temp cwd. Returns the exit code, output and every file the run left there.
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'channel-state-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const before = {};
    for (const [name, body] of Object.entries(files || {})) { fs.writeFileSync(path.join(dir, name), body); before[name] = body; }
    const base = Object.assign({}, process.env);
    for (const k of SCRUB.concat(FILE_VARS)) delete base[k];
    const readOnly = {};
    for (const k of FILE_VARS) if (!WRITTEN.has(k) && !(env && env[k])) readOnly[k] = path.join(dir, 'ro-' + k.toLowerCase() + '.json');
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock: the points board name is season-derived
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',   // world() lists shard_0..shard_7 = the full record shard set of these runs
    }, readOnly, env || {});
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const out = {};
    for (const name of fs.readdirSync(dir)) {
      if (HELPER.indexOf(name) >= 0 || /^ro-/.test(name)) continue;
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      if (before[name] !== body) out[name] = body;   // created or changed by the run
    }
    const left = {};
    for (const name of fs.readdirSync(dir)) if (HELPER.indexOf(name) < 0 && !/^ro-/.test(name)) left[name] = fs.readFileSync(path.join(dir, name), 'utf8');
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), wrote: out, left };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}

const MIN = 60000;
const A = '76561198000000001', B = '76561198000000002';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// ledger record, result-reporter wire form (as test/once-only-effects.js): magic, ver, mt, hash, seed, seat, rank,
//   (progress<<1)|win, pc, dur, scores x pc, disp, roster (lo, hi) x pc. Start records (0xB2) zero every result field.
function rec(magic, mt, hash, seat, sids) {
  const settle = magic === 0xB1, pc = sids.length;
  const d = [magic, settle ? 3 : 1, mt, hash | 0, 1234, seat, settle ? seat + 1 : 0, settle ? ((6 << 1) | (seat === 0 ? 1 : 0)) : 0, pc, settle ? 720 : 0];
  for (let i = 0; i < pc; i++) d.push(settle ? 9000 - 4000 * i : 0);
  d.push(0);
  for (const s of sids) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const K = 0x4801, MT = 1, KEY = K + '_1234_' + MT;
const ROWS = [
  { shard: 0, sid: A, d: rec(0xB2, MT, K, 0, [A, B]) }, { shard: 0, sid: B, d: rec(0xB2, MT, K, 1, [A, B]) },   // both attest the start
  { shard: 1, sid: A, d: rec(0xB1, MT, K, 0, [A, B]) }, { shard: 1, sid: B, d: rec(0xB1, MT, K, 1, [A, B]) },   // both finish: consistent
];
function world(extra) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of ROWS) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  return boards.concat([{ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }], extra || []);
}
// carry a run's files into the next run as if `ms` had passed (the job clock is Date.now(): stored instants move back).
//   keep = the job's persist list: the next CI run checks out only what was committed (null = carry everything)
function advance(left, names, ms, keep) {
  const files = {};
  for (const [name, body] of Object.entries(left)) if (!keep || keep.indexOf(name) >= 0) files[name] = body;
  const st = files[names.STARTS_FILE] ? JSON.parse(files[names.STARTS_FILE]) : null;
  if (st) { for (const k of Object.keys(st)) if (st[k] && st[k].t0) st[k].t0 -= ms; files[names.STARTS_FILE] = JSON.stringify(st); }
  const sg = files[names.SIGNALS_FILE] ? JSON.parse(files[names.SIGNALS_FILE]) : null;
  if (sg && sg.players) { for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms; files[names.SIGNALS_FILE] = JSON.stringify(sg); }
  return files;
}
// two runs: the first sees the start attestations, the second (past maturity) settles
function settleTwice(env, names, extra, keep, script) {
  const r1 = runCron(world(extra), null, env, script);
  const r2 = runCron(world(extra), advance(r1.left, names, v.STARTS_MATURITY_MS + MIN, keep), env, script);
  return { r1, r2 };
}
const hasData = (body) => {
  let j; try { j = JSON.parse(body); } catch (e) { return true; }   // unreadable = something was written
  if (j == null) return false;
  if (Array.isArray(j)) return j.length > 0;
  return typeof j !== 'object' || Object.keys(j).length > 0;
};
const processedHas = (r, names) => { try { return JSON.parse(r.left[names.PROCESSED_FILE]).indexOf(KEY) >= 0; } catch (e) { return false; } };

// a twin run's findings: written but unpersisted files that carry data, main-channel files, unknown files
function findings(tw, r) {
  const out = [];
  const own = new Set(Object.values(tw.files));
  const mainNames = new Set(Object.values(DEFAULTS));
  for (const [name, body] of Object.entries(r.wrote)) {
    if (/\.tmp$/.test(name)) { out.push(name + ': temp file left behind'); continue; }
    if (tw.persist.indexOf(name) >= 0) continue;
    if (!own.has(name)) { out.push(name + (mainNames.has(name) ? ': main-channel state file written by the ' + tw.job + ' job' : ': written but not named by ' + tw.file)); continue; }
    if (hasData(body)) out.push(name + ': not persisted by ' + tw.file + ' but carries data (' + body.slice(0, 80) + ')');
  }
  return out;
}
function twinCase(tag, tw, env, script) {
  const names = Object.assign({}, DEFAULTS, tw.files);
  const { r1, r2 } = settleTwice(Object.assign({ PT_MODE: '1' }, tw.files, env), names, null, tw.persist, script);
  return { tag, tw, names, r1, r2 };
}
function checkTwin(c) {
  const { tag, tw, names, r1, r2 } = c;
  T(tag + ' ' + tw.file + ' parsed (PT_MODE=1, ' + Object.keys(tw.files).length + ' state files, ' + tw.persist.length + ' persisted)', tw.ptMode && Object.keys(tw.files).length >= 10 && tw.persist.length >= 8);
  T(tag + ' run 1 exits 0', r1.code === 0, r1.out.slice(-600));
  T(tag + ' run 2 exits 0 and settles the match (main path)', r2.code === 0 && /1 consistent/.test(r2.out) && processedHas(r2, names), r2.out.slice(-800));
  const xp = (() => { try { return JSON.parse(r2.wrote[names.XP_FILE]); } catch (e) { return {}; } })();
  T(tag + ' the settle loop ran for both players (XP credited)', Object.keys(xp).length === 2, Object.keys(xp).join(','));
  for (const [i, r] of [[1, r1], [2, r2]]) {
    const f = findings(tw, r);
    T(tag + ' run ' + i + ': every file written is persisted, or empty', f.length === 0, f.join(' | '));
  }
}

// ---- [1] / [2] the twins as configured ----
const PT = twinOf('playtest.yml', 'playtest'), DM = twinOf('demo.yml', 'demo');
console.log('-- [1] playtest twin --');
const c1 = twinCase('[1]', PT, { APPID: '1', DEMO_APPID: '2' });
checkTwin(c1);
console.log('-- [2] demo twin --');
checkTwin(twinCase('[2]', DM, { APPID: '2', DEMO_APPID: '2' }));

// ---- [3] sensitivity: the main channel rates the same match ----
console.log('-- [3] the same match on the main channel --');
{
  const names = Object.assign({}, DEFAULTS);
  const { r2 } = settleTwice({ RANKED_LB: 'rating', LP_LB: 'points' }, names, [{ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }], null);
  T('[3] settles', r2.code === 0 && processedHas(r2, names), r2.out.slice(-800));
  T('[3] skill.json carries both players', hasData(r2.wrote[names.SKILL_FILE] || '') && Object.keys(JSON.parse(r2.wrote[names.SKILL_FILE])).length === 2);
  T('[3] groups.json carries the pair', hasData(r2.wrote[names.GROUPS_FILE] || ''));
}

// ---- [4] mutation self-check ----
console.log('-- [4] mutation self-check --');
{
  const from = '    if (!PT_MODE) {\n      const tsIn = parts.map(';
  if (SRC.split(from).length !== 2) bad('[4] anchor (PT_MODE rating skip in the settle loop) not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-channel-state-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, '    if (true) {\n      const tsIn = parts.map('));
      const c = twinCase('[4]', PT, { APPID: '1', DEMO_APPID: '2' }, script);
      const f = findings(PT, c.r2);
      T('[4] rating skip removed -> the playtest run writes unpersisted rating state and [1] goes red',
        c.r2.code === 0 && processedHas(c.r2, c.names) && f.some(x => x.indexOf(PT.files.SKILL_FILE) === 0) && f.some(x => x.indexOf(PT.files.GROUPS_FILE) === 0), f.join(' | ') + ' // ' + c.r2.out.slice(-400));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
  // the other two shapes the check exists for, on the playtest twin as configured
  const noXpPersist = Object.assign({}, PT, { persist: PT.persist.filter(f => f !== PT.files.XP_FILE) });
  T('[4] ' + PT.files.XP_FILE + ' dropped from the persist list -> flagged (written with data, not persisted)',
    findings(noXpPersist, c1.r2).some(x => x.indexOf(PT.files.XP_FILE + ': not persisted') === 0));
  const files = Object.assign({}, PT.files); delete files.XP_FILE;
  const noXpName = Object.assign({}, PT, { files });
  const c = twinCase('[4]', noXpName, { APPID: '1', DEMO_APPID: '2' });
  T('[4] XP_FILE no longer named by the twin -> flagged (the job writes the main channel\'s ' + DEFAULTS.XP_FILE + ')',
    findings(noXpName, c.r2).some(x => x.indexOf(DEFAULTS.XP_FILE + ': main-channel state file') === 0), findings(noXpName, c.r2).join(' | '));
}

console.log(failN ? ('FAIL x' + failN + ' (channel-state-files)') : 'ALL OK (channel-state-files)');
process.exit(failN ? 1 : 0);
