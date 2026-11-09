'use strict';
// O789 (1) (2026-11-09, EA gap audit 2 E-02; user ruling: give the 60, ship it during S0): the live channel seeds the one-shot starter wallet too.
//   CP comes only from matchmade games (+ the competitive endless milestones); the playtest / demo jobs seeded every first-seen
//   account with PT_SEED_CP (60) from the start, the live job did not -- and 95% of the trial's players never played a matchmade
//   game, so the 20 CP competitive resume and the casual continue stayed grey for them. seedStarterCp now runs on every channel.
//   [0] wiring + class tripwire: every seed call site is ungated (no PT_MODE on its line), five lanes (solo, quit-lone late, team
//       competitive, co-op endless, matchmade); no line of validate.js gates the CP wallet on the channel; the PT_SEED_CP line keeps
//       the shape the companion repo's playtest-gate pins
//   [1] pure: seedStarterCp seeds only accounts with no wallet row (0 / negative / positive rows untouched, a repeated id once);
//       the seed buys the competitive resume and the first casual continue (economy reachable)
//   [2] main(), live channel: a new account whose only record is a competitive solo segment [0,5] -> one wallet write of 60
//   [3] the same account a run later, its wallet row (60) on the board, next segment [5,10] -> 60 + the depth-10 milestone = 100,
//       no second seed
//   [4] main(), live channel: a new account's first casual run, one continue used in [0,5], [5,10] in the same run -> one wallet
//       write of 60 - 20 = 40 (seeded before the debit, never into debt)
//   [5] an account whose wallet row is 0 (spent) is not first-seen: no seed, no write
//   [6] PT_SEED_CP=0 turns it off: no seed, no write (no row = still first-seen if it comes back on)
//   [7] mutation self-check: (a) the solo lane's seed line deleted -> [2] fails; (b) the first-seen check removed -> [5] fails
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/solo-neg-duration.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COMP_CHAIN_WAIT_MS', 'SEASON_NOW', 'PT_SEED_CP', 'COMP_RESUME_CP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

console.log('=== O789 (1): the live channel seeds the starter wallet ===');

// ---- [0] wiring + class tripwire ----
{
  const code = SRC.split('\n').filter((l) => !/^\s*\/\//.test(l) && !/^module\.exports|^Object\.assign\(module\.exports/.test(l));   // the export lists name both
  const calls = code.filter((l) => /seedStarterCp\(cp, changedCp,/.test(l) && !/^function /.test(l));
  T('[0] five seed call sites (solo / quit-lone late / team competitive / co-op endless / matchmade)', calls.length === 5, calls.length + ' found');
  T('[0] no seed call is gated on the channel (PT_MODE on its line)', calls.every((l) => !/PT_MODE/.test(l)), calls.filter((l) => /PT_MODE/.test(l)).map((l) => l.trim()).join(' || '));
  T('[0] the lanes: [sid] / [L.o] / own roster + writers (x2) / writers', ['[sid]);', '[L.o]);', 'ownRosterSids.concat(writerSids))]);', 'writerSids);'].every((s) => calls.some((l) => l.indexOf(s) >= 0)));
  // class tripwire: the CP wallet is the same surface on every channel -- a new gate that hands the live job a different wallet rule
  //   (a seed, a credit, a debit only on one channel) must come here and say why
  const gated = code.filter((l) => /PT_MODE/.test(l) && /seedStarterCp|changedCp|\bcp\[|creditCp\(/.test(l));
  T('[0] no line gates the CP wallet on the channel', gated.length === 0, gated.map((l) => l.trim().slice(0, 140)).join(' || '));
  T('[0] the old playtest-only name is gone', !/ptSeedCp/.test(SRC));
  // the companion repo (mvp/test/playtest-gate.js) pins the 60 through this exact line
  T('[0] PT_SEED_CP line keeps its pinned shape', /const PT_SEED_CP = Math\.max\(0, Number\(process\.env\.PT_SEED_CP \|\| 60\)\);/.test(SRC));
  const fn = SRC.slice(SRC.indexOf('\nfunction seedStarterCp('), SRC.indexOf('\n}\n', SRC.indexOf('\nfunction seedStarterCp(')));
  T('[0] seedStarterCp: first-seen = no wallet row (cp[sid] != null skips), assigns the baseline', /if \(cp\[sid\] != null\) continue;/.test(fn) && /cp\[sid\] = PT_SEED_CP; changedCp\[sid\] = PT_SEED_CP;/.test(fn));
}

// ---- [1] pure ----
{
  const cpMap = { a: 120, b: 0, c: -40 }, changed = {};
  const n = v.seedStarterCp(cpMap, changed, ['a', 'b', 'c', 'd', 'e', 'd']);
  T('[1] seeds only accounts with no wallet row, a repeated id once', n === 2 && cpMap.d === v.PT_SEED_CP && cpMap.e === v.PT_SEED_CP && changed.d === v.PT_SEED_CP && changed.e === v.PT_SEED_CP, 'n=' + n);
  T('[1] positive / zero / negative rows untouched', cpMap.a === 120 && cpMap.b === 0 && cpMap.c === -40 && changed.a === undefined && changed.b === undefined && changed.c === undefined);
  T('[1] a second call seeds nobody', v.seedStarterCp(cpMap, changed, ['d', 'e']) === 0);
  T('[1] the baseline is 60', v.PT_SEED_CP === 60);
  // economy reachable (E-02): a player who only plays single-player can afford the competitive resume and the first casual continue
  T('[1] the seed buys the competitive resume (COMP.RESUME_CP ' + v.COMP.RESUME_CP + ')', v.PT_SEED_CP >= v.COMP.RESUME_CP);
  T('[1] the seed buys the first casual continue (' + v.endlessContinueCost(1) + ')', v.PT_SEED_CP >= v.endlessContinueCost(1));
}

// ---- main() harness (live channel: PT_MODE scrubbed) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-cp-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  return dir;
}
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('5d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099110901;
function addTestKey(dir) {
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
}
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
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
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(tree, boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-cp-run-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1',
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// move every first-sighting / wait clock in the carried state back by ms (= ms of real time passed between two runs)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
  }
  return files;
}
const LB = { xp: 5, cp: 8, solo: 15, comp: 16 };
// cp: { sid: score } = the wallet rows on cp_bank this run (absent = no row = first-seen)
function world(recs, cp) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: Object.keys(cp || {}).map(s => ({ steamID: s, score: cp[s] })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: LB.solo, name: v.ENDLESS_LB_SOLO, entries: [] }, { id: LB.comp, name: v.ENDLESS_COMP_LB, entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
// steps: [{ ms (since the previous run), recs, cp (wallet rows), tree?, env? }]; the wallet a run wrote is NOT carried by itself --
//   each step names the rows the board holds (the cases pass what the run before wrote)
function timeline(tree, steps, files0) {
  const out = []; let state = null;
  for (const s of steps) {
    const r = runCron(s.tree || tree, world(s.recs, s.cp), state ? advance(state, s.ms) : (files0 || null), s.env);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const HOUR = 3600 * 1000;
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function startSolo(hash, sid, runSeed) {
  const p = sidPair(sid);
  return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]];
}
// a guard-signed solo segment (attVer 5 layout: base 30 ints + 16 signature ints); tail [14..17] = start / end depth, continues, tokens
function signedSeg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed, 0, 1, 0, 1, 300, o.score == null ? 1000 : o.score, 0, lo, hi, o.sd, o.ed, o.cont | 0, 0, 0, o.flags | 0,
    KEY_ID, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
const cpWrites = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + LB.cp + '(&|$)').test(p.body)).map((p) => Number(/score=(-?\d+)/.exec(p.body)[1]));
const allCp = (rs) => [].concat(...rs.map(cpWrites));
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;
const seeds = (r) => r.out.split('\n').filter((l) => /^\s*starter cp /.test(l)).length;
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);

// ---- cases (also run on the mutant trees in [7]) ----
// [2] / [3] a new account's competitive run: r1 the [0,5] start, r2 (2 h on) the signed segment settles (no wallet row anywhere);
//   r3 (2 h on) the next segment [5,10] with its wallet row as r2 wrote it
function caseComp(tree, n) {
  const S = SID(7891001 + n), RS = 789100 + n;
  const a = signedSeg({ sid: S, id: 'o789-comp-a-' + n, runSeed: RS, sd: 0, ed: 5, score: 4000 });
  const st = { sid: S, d: startSolo(a[3], S, RS) };
  const rs = timeline(tree, [{ ms: 0, recs: [st] }, { ms: 2 * HOUR, recs: [st, { sid: S, d: a }] }]);
  if (rs.length !== 2 || rs.some((r) => r.code !== 0)) return { rs, m: keyOf(a), S };
  const w2 = cpWrites(rs[1]);
  const b = signedSeg({ sid: S, id: 'o789-comp-b-' + n, runSeed: RS, sd: 5, ed: 10, score: 9000 });
  const stB = { sid: S, d: startSolo(b[3], S, RS) };
  const cp3 = w2.length ? { [S]: w2[w2.length - 1] } : {};
  const r3 = runCron(tree, world([stB, { sid: S, d: b }, { sid: S, d: a }], cp3), advance(rs[1].state, 2 * HOUR));
  const r3b = r3.code === 0 ? runCron(tree, world([stB, { sid: S, d: b }, { sid: S, d: a }], cp3), advance(r3.state, 2 * HOUR)) : null;
  return { rs: rs.concat([r3].concat(r3b ? [r3b] : [])), m: keyOf(a), mb: keyOf(b), S };
}
// [4] a new account's casual run: [0,5] with one continue, [5,10]; both on the board from r1 (no wallet row)
function caseCasual(tree, n) {
  const S = SID(7892001 + n), RS = 789200 + n;
  const a = signedSeg({ sid: S, id: 'o789-cas-a-' + n, runSeed: RS, sd: 0, ed: 5, cont: 1, flags: A.SEG_CASUAL });
  const b = signedSeg({ sid: S, id: 'o789-cas-b-' + n, runSeed: RS, sd: 5, ed: 10, cont: 1, flags: A.SEG_CASUAL });
  const recs = [{ sid: S, d: startSolo(a[3], S, RS) }, { sid: S, d: startSolo(b[3], S, RS) }, { sid: S, d: a }, { sid: S, d: b }];
  const rs = timeline(tree, [{ ms: 0, recs }, { ms: 2 * HOUR, recs }, { ms: 2 * HOUR, recs }]);
  return { rs, ma: keyOf(a), mb: keyOf(b), S };
}
// [5] / [6] a fresh competitive run [0,5] of an account with the given wallet rows / env
function caseFresh(tree, n, cpOf, env) {
  const S = SID(7893001 + n), RS = 789300 + n;
  const a = signedSeg({ sid: S, id: 'o789-fresh-' + n, runSeed: RS, sd: 0, ed: 5, score: 4000 });
  const st = { sid: S, d: startSolo(a[3], S, RS) };
  const cp = cpOf ? cpOf(S) : {};
  const rs = timeline(tree, [{ ms: 0, recs: [st], cp, env }, { ms: 2 * HOUR, recs: [st, { sid: S, d: a }], cp, env }, { ms: 2 * HOUR, recs: [st, { sid: S, d: a }], cp, env }]);
  return { rs, m: keyOf(a), S };
}

const TREE = copyTree('fix');
addTestKey(TREE);

// ---- [2] / [3] ----
const R2 = caseComp(TREE, 0);
if (!brk(R2.rs, 4, '[2]')) {
  const rs = R2.rs;
  T('[2] the competitive segment settles once (r2)', sum(rs, (r) => lines(r, R2.m, /solo settle /)) === 1 && lines(rs[1], R2.m, /solo settle /) === 1,
    rs.map((r) => lines(r, R2.m, /solo settle |sanity-flagged|REJECT|pending/)).join('/'));
  T('[2] one wallet write, 60 (the seed: no milestone below depth 10, no resume)', JSON.stringify(cpWrites(rs[1])) === '[60]' && cpWrites(rs[0]).length === 0, JSON.stringify(rs.slice(0, 2).map(cpWrites)));
  T('[2] the wallet buys the competitive resume', (cpWrites(rs[1])[0] | 0) >= v.COMP.RESUME_CP);
  T('[2] one "starter cp" line', seeds(rs[1]) === 1 && seeds(rs[0]) === 0, rs.map(seeds).join('/'));
  T('[3] a run later, its wallet row 60 on the board: [5,10] settles, 60 + milestone 40 = 100, no second seed',
    sum(rs.slice(2), (r) => lines(r, R2.mb, /solo settle /)) === 1 && JSON.stringify(allCp(rs.slice(2))) === '[100]' && sum(rs.slice(2), seeds) === 0,
    'cp=' + JSON.stringify(rs.slice(2).map(cpWrites)) + ' seeds=' + rs.slice(2).map(seeds).join('/') + ' settle=' + rs.slice(2).map((r) => lines(r, R2.mb, /solo settle |chain/)).join('/'));
}
// ---- [4] ----
{
  const R4 = caseCasual(TREE, 0);
  if (!brk(R4.rs, 3, '[4]')) {
    const rs = R4.rs;
    T('[4] both casual segments settle', sum(rs, (r) => lines(r, R4.ma, /solo settle /)) === 1 && sum(rs, (r) => lines(r, R4.mb, /solo settle /)) === 1,
      rs.map((r) => lines(r, R4.ma, /solo settle /) + '+' + lines(r, R4.mb, /solo settle /)).join('/'));
    T('[4] one wallet write: 60 seeded, then the first continue (-' + v.endlessContinueCost(1) + ') = 40, never negative', JSON.stringify(allCp(rs)) === '[' + (60 - v.endlessContinueCost(1)) + ']',
      JSON.stringify(rs.map(cpWrites)));
    T('[4] seeded once', sum(rs, seeds) === 1);
  }
}
// ---- [5] ----
const R5 = caseFresh(TREE, 0, (S) => ({ [S]: 0 }));
if (!brk(R5.rs, 3, '[5]')) {
  T('[5] a spent wallet (row 0) is not first-seen: settles, no seed, no wallet write', sum(R5.rs, (r) => lines(r, R5.m, /solo settle /)) === 1 && allCp(R5.rs).length === 0 && sum(R5.rs, seeds) === 0,
    'cp=' + JSON.stringify(R5.rs.map(cpWrites)) + ' seeds=' + R5.rs.map(seeds).join('/'));
}
// ---- [6] ----
{
  const R6 = caseFresh(TREE, 1, null, { PT_SEED_CP: '0' });
  if (!brk(R6.rs, 3, '[6]')) {
    T('[6] PT_SEED_CP=0: settles, no seed, no wallet write (no row left behind)', sum(R6.rs, (r) => lines(r, R6.m, /solo settle /)) === 1 && allCp(R6.rs).length === 0 && sum(R6.rs, seeds) === 0,
      'cp=' + JSON.stringify(R6.rs.map(cpWrites)));
  }
}
// ---- [7] mutation self-check ----
{
  const soloLine = '    seedStarterCp(cp, changedCp, [sid]);   // O789 (1): every channel (cpId resolved: the lane returned above without it)\n';
  const firstSeen = '    if (cp[sid] != null) continue;\n    cp[sid] = PT_SEED_CP;';
  if (SRC.split(soloLine).length !== 2 || SRC.split(firstSeen).length !== 2) bad('[7] a fix line was not found -- the mutants cannot be built');
  else {
    const MA = copyTree('mut-a'); addTestKey(MA);
    fs.writeFileSync(path.join(MA, 'validate.js'), SRC.replace(soloLine, ''));
    const M2 = caseComp(MA, 5);
    T('[7a] the solo lane\'s seed line deleted: [2] fails (the segment settles, no wallet write)', M2.rs.length >= 2 && lines(M2.rs[1], M2.m, /solo settle /) === 1 && cpWrites(M2.rs[1]).length === 0,
      'cp=' + JSON.stringify(M2.rs.map(cpWrites)));
    const MB = copyTree('mut-b'); addTestKey(MB);
    fs.writeFileSync(path.join(MB, 'validate.js'), SRC.replace(firstSeen, '    cp[sid] = PT_SEED_CP;'));
    const M5 = caseFresh(MB, 5, (S) => ({ [S]: 0 }));
    T('[7b] the first-seen check removed: [5] fails (the spent wallet is seeded again)', M5.rs.length === 3 && JSON.stringify(allCp(M5.rs)).indexOf('60') >= 0,
      'cp=' + JSON.stringify(M5.rs.map(cpWrites)));
    for (const d of [MA, MB]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
  }
}
try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (starter-cp) ===' : '=== PASS -- 0 fail (starter-cp) ===');
process.exit(failN ? 1 : 0);
