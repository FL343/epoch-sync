'use strict';
// Q166 (cloud audit 2026-10, Q144 review section 10): signals.flagged ("this key was already flagged", recordFlag) kept one
//   entry per key for 45 days with no cap. A rejected solo segment flags its key and leaves the shards the next run, so one
//   account writing 50 forged segments a run grew it by 50 a run (about 21 MB in 45 days; five accounts past GitHub's
//   100 MB file limit). Now an entry whose match key was off the shards on two complete reads an hour apart is dropped.
//   [0] wiring pins
//   [1] pruneFlagged (pure): kept while on the shards, armed on the first complete read that misses it, dropped on one an
//       hour later, disarmed when the key is back, an incomplete read changes nothing, an m|blank|pid flag by its writer's
//       own blank start of m (Q166 rework: not by m), blankSeen, the arm goes with its flag (pruneSignals), no flagOff field
//       when nothing is armed
//   [2] main(): one account, 50 forged solo segments a run for two hours at the five-minute cadence: the flags stop
//       growing (before: +50 a run); every forged key is counted once (f) as before
//   [3] main(): a key whose three players disagree, its records kept on the shards for three hours: flagged once, never
//       armed, f 1 each
//   [4] main(): the same key once its records left: armed, dropped an hour later; the records written back: flagged
//       again, its players not counted again (Q98: one match flags a player once, his fm remembers it); a key still on
//       the shards in the same runs untouched
//   [5] main(): its records gone while a shard fails to read: nothing armed for two hours; the first complete read arms,
//       the next one an hour later drops
//   [6] main(): its records gone while the one-shot recovery pools are configured: nothing armed; past the file, armed and
//       dropped
//   [7] main() (Q166 rework, the review's R2): six accounts take turns on one set of 300 matchmade keys, each account a
//       different 50 a run (one per shard), every key always on the shards, a blank seat in every start, 30-minute
//       cadence: each account keeps at most its live 50 plus two runs of arms (150; 900 in all; before: every account on
//       every key, 50N^2 = 1800); f: every key counted once when first written (300 after the six runs that cover all
//       300), at most 50 more a run, never fewer (Q98: a key written again is not counted again while its writer's fm
//       still holds it -- fm keeps the last 32, so how many of the last three runs count again is not pinned here)
//   [8] main() (Q166 rework): one account keeps its blank start of one matchmade key on the shards for three hours: its
//       flag is never armed, f 1 (not dropped and counted again)
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/state-prune.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'PROCESSED_CAP', 'PROCESSED_KEEP', 'PROCESSED_PRUNE_WAIT_MS',
  'ENDLESS_PENDING_TTL_MS', 'COMP_RUN_TTL_MS', 'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'SOLO_DONE_CAP', 'FLAG_PRUNE_WAIT_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); T(label + ' = ' + a, a === b, 'EXPECT ' + b); };
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const HOUR = 3600 * 1000, MIN = 60000;

console.log('=== Q166: signals.flagged entries of keys off the shards are dropped ===');

// ---- [0] wiring pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('main prunes the flags right after loading the signals, on a complete read without recovery pools',
    "  const signals = loadSignals();\n  let sigDirty = false;\n  // Q166: a flag whose key was off the shards on two complete reads an hour apart is dropped (pruneFlagged)\n" +
    "  const prunedF = pruneFlagged(signals, blankSeen(seenKeys), shardsComplete && !recCfg, Date.now());   // Q166 rework: + each blank start's m|blank|pid\n  if (prunedF.dropped || prunedF.armed || prunedF.disarmed) sigDirty = true;\n");
  pin('a blank flag by its writer (Q166 rework)', "    if (k.indexOf('|blank|') >= 0 ? seen.has(k) : seen.has(flagBaseKey(k))) {");
  pin('blankSeen adds every blank start read this run', "  for (const [m, r] of BLANK_STARTS) out.add(m + '|blank|' + pid(String(r.steamID)));\n");
  T('[0] the blank starts are read (registerStartRosters) before the flags are pruned', SRC.indexOf('  const registeredEarly = registerStartRosters(') > 0 && SRC.indexOf('  const registeredEarly = registerStartRosters(') < SRC.indexOf('  const prunedF = pruneFlagged('));
  pin('an arm goes with its flag', "  for (const k of Object.keys(s.flagOff || {})) if (!s.flagged[k]) delete s.flagOff[k];   // Q166: an arm goes with its flag (pruneFlagged)\n");
  pin('the wait default (an hour)', 'const FLAG_PRUNE_WAIT_MS = Number(process.env.FLAG_PRUNE_WAIT_MS || 3600 * 1000);');
  T('[0] seenKeys is built before the signals load (every key read this run, before any gate)', SRC.indexOf('  const seenKeys = new Set(') > 0 && SRC.indexOf('  const seenKeys = new Set(') < SRC.indexOf('  const signals = loadSignals();'));
  eq('[0] exported', [typeof v.pruneFlagged, typeof v.flagBaseKey, v.FLAG_PRUNE_WAIT_MS, typeof v.blankSeen, Array.isArray(v.BLANK_STARTS)], ['function', 'function', HOUR, 'function', true]);
}

// ---- [1] pruneFlagged (pure) ----
{
  const t0 = 1e12;
  const S = () => ({ flagged: { k1: t0, k2: t0, 'k3|blank|abc': t0 }, players: {}, pairs: {}, rep: {}, rseen: {} });
  let s = S();
  eq('[1] every key on the shards: kept, nothing armed, no flagOff field', [v.pruneFlagged(s, new Set(['k1', 'k2', 'k3', 'k3|blank|abc']), true, t0 + HOUR), Object.keys(s.flagged).length, 'flagOff' in s],
    [{ dropped: 0, armed: 0, disarmed: 0 }, 3, false]);
  eq('[1] the first complete read that misses k2: armed, kept', [v.pruneFlagged(s, new Set(['k1', 'k3', 'k3|blank|abc']), true, t0 + HOUR), Object.keys(s.flagged).sort(), s.flagOff],
    [{ dropped: 0, armed: 1, disarmed: 0 }, ['k1', 'k2', 'k3|blank|abc'], { k2: t0 + HOUR }]);
  eq('[1] off again 59 minutes later: kept', [v.pruneFlagged(s, new Set(['k1', 'k3', 'k3|blank|abc']), true, t0 + HOUR + 59 * MIN), Object.keys(s.flagged).length], [{ dropped: 0, armed: 0, disarmed: 0 }, 3]);
  eq('[1] an incomplete read an hour later: nothing changes', [v.pruneFlagged(s, new Set(['k1', 'k3']), false, t0 + 2 * HOUR), Object.keys(s.flagged).length, s.flagOff], [{ dropped: 0, armed: 0, disarmed: 0 }, 3, { k2: t0 + HOUR }]);
  eq('[1] no key set: nothing changes', [v.pruneFlagged(s, null, true, t0 + 2 * HOUR), Object.keys(s.flagged).length], [{ dropped: 0, armed: 0, disarmed: 0 }, 3]);
  eq('[1] off on a complete read an hour after the arm: dropped with its arm', [v.pruneFlagged(s, new Set(['k1', 'k3', 'k3|blank|abc']), true, t0 + 2 * HOUR), Object.keys(s.flagged).sort(), s.flagOff],
    [{ dropped: 1, armed: 0, disarmed: 0 }, ['k1', 'k3|blank|abc'], {}]);
  s = S();
  v.pruneFlagged(s, new Set(['k2', 'k3', 'k3|blank|abc']), true, t0);
  eq('[1] k1 back before the hour: disarmed, kept', [v.pruneFlagged(s, new Set(['k1', 'k2', 'k3', 'k3|blank|abc']), true, t0 + 30 * MIN), s.flagOff], [{ dropped: 0, armed: 0, disarmed: 1 }, {}]);
  eq('[1] k1 off again: armed afresh (the hour counts from now)', [v.pruneFlagged(s, new Set(['k2', 'k3', 'k3|blank|abc']), true, t0 + 40 * MIN), v.pruneFlagged(s, new Set(['k2', 'k3', 'k3|blank|abc']), true, t0 + 90 * MIN), 'k1' in s.flagged],
    [{ dropped: 0, armed: 1, disarmed: 0 }, { dropped: 0, armed: 0, disarmed: 0 }, true]);
  s = S();
  v.pruneFlagged(s, new Set(['k1', 'k2']), true, t0);
  eq('[1] m|blank|pid by its writer, not by m: armed when the writer\'s own blank start of m is off (m on the shards)', s.flagOff, { 'k3|blank|abc': t0 });
  eq('[1] ... dropped an hour later though m stays on the shards (another account\'s start)', [v.pruneFlagged(s, new Set(['k1', 'k2', 'k3']), true, t0 + HOUR), Object.keys(s.flagged).sort()], [{ dropped: 1, armed: 0, disarmed: 0 }, ['k1', 'k2']]);
  s = S();
  v.pruneFlagged(s, new Set(['k1', 'k2', 'k3']), true, t0);
  eq('[1] ... kept while the writer\'s own blank start of m is on the shards (disarmed)', [v.pruneFlagged(s, new Set(['k1', 'k2', 'k3', 'k3|blank|abc']), true, t0 + 2 * HOUR), 'k3|blank|abc' in s.flagged], [{ dropped: 0, armed: 0, disarmed: 1 }, true]);
  v.BLANK_STARTS.push(['k5', { steamID: '765611980000001' }], ['k6', { steamID: '765611980000002' }]);
  eq('[1] blankSeen: the keys read plus each blank start\'s m|blank|pid', Array.from(v.blankSeen(new Set(['k1']))).sort(), ['k1', 'k5|blank|' + v.pid('765611980000001'), 'k6|blank|' + v.pid('765611980000002')].sort());
  v.BLANK_STARTS.length = 0;
  eq('[1] flagBaseKey', [v.flagBaseKey('1_2_3'), v.flagBaseKey('1_2_3|blank|ff'), v.flagBaseKey('')], ['1_2_3', '1_2_3', '']);
  // the arm goes with its flag (the 45-day window, pruneSignals)
  s = { day: { d: 0, n: {} }, players: {}, pairs: {}, rep: {}, rseen: {}, flagged: { old: t0, young: t0 + 44 * 86400000 }, flagOff: { old: t0 + HOUR, young: t0 + HOUR, stray: t0 } };
  v.pruneSignals(s, t0 + 46 * 86400000);
  eq('[1] pruneSignals: a flag past 45 days goes, its arm and a stray arm with it', [Object.keys(s.flagged), Object.keys(s.flagOff)], [['young'], ['young']]);
  // a key dropped and written again is flagged again; its player is not counted again (Q98: his fm remembers the match)
  s = S();
  v.recordFlag(s, [{ steamID: '765611980000001' }], 'k9', t0);
  v.pruneFlagged(s, new Set(['k1', 'k2', 'k3', 'k3|blank|abc']), true, t0 + HOUR); v.pruneFlagged(s, new Set(['k1', 'k2', 'k3', 'k3|blank|abc']), true, t0 + 2 * HOUR);
  eq('[1] a dropped key written again is flagged again, its player not counted again (Q98)', [v.recordFlag(s, [{ steamID: '765611980000001' }], 'k9', t0 + 3 * HOUR), 'k9' in s.flagged, s.players[v.pid('765611980000001')].f], [true, true, 1]);
}

// ---- main() harness (offline fake Steam; a copy of this tree with one test signing key, as test/state-prune-rework.js) ----
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-prune-tree-'));
// Q225: not the .mutant-*.js files other tests write into the root and delete while the suite runs 4 at a time, nor an
//   entry gone between the listing and its copy (test/root-listing.js)
require('./root-listing').copyRootTree(ROOT, TREE, ['.git', 'test', 'node_modules']);
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const KPRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('4d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const KPUB = crypto.createPublicKey(KPRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099020101;
{
  const kf = path.join(TREE, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [KPUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: accepted on every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
}
const VALIDATE = path.join(TREE, 'validate.js');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
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
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flag-prune-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z', RECOVER_FILE: path.join(dir, 'no-recover.json'),
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// the job clock moves by shifting every stored instant back (the flags and their arms included)
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
  if (sg && sg.flagOff) for (const k of Object.keys(sg.flagOff)) sg.flagOff[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
  }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a friends'-room result (type 10, one seat per account of `ros`) written by the player at `seat`, with the score vector he
//   claims: three of them that disagree flag every writer once. Two voices no longer flag anybody for disagreeing -- a
//   ranked 1V1 (this fixture first, Q289, test/pair-dispute-1v1.js), a friends' room of two (this fixture next, Q291,
//   test/two-voice-dispute.js) -- so the keys here have three writers; the flag bookkeeping tested here is the same
function result(hash, seat, ros, scores) {
  const pc = ros.length;
  const d = [0xB1, 3, 10, hash | 0, 1234, seat, 1 + seat, (6 << 1) | (seat === 0 ? 1 : 0), pc, 720].concat(scores.slice(0, pc), [0]);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// guard-signed solo segment, attVer 3 layout (attest.js LAYOUTS[3]); forged = a signature that does not verify
let segN = 0;
function forgedSeg(sid) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32('q166-' + (++segN)), 555, 0, 1, 0, 1, 900, 1000, 0, lo, hi, 0, 1, 0, 0, 0, 0, KEY_ID, 3, 0, 0, 0];
  const sig = Buffer.alloc(64, 7);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) {
    if (r.shard != null) { boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); continue; }
    used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d });
  }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 21, name: 'endless_comp_solo', entries: [] }, { id: 22, name: 'endless_board_solo', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs (or a function of the run index), env?], ...]
function timeline(steps) {
  const out = []; let state = null;
  steps.forEach(([ms, recs, env], i) => {
    if (out.length && out[out.length - 1].code !== 0) return;
    const r = runCron(boardsWith(typeof recs === 'function' ? recs(i) : recs), state ? advance(state, ms) : null, env || null);
    out.push(r); state = r.state;
  });
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const brk = (rs, n, tag) => { if (allOk(rs, n)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };
const sigOf = (r) => r.state.SIGNALS_FILE || {};
const flags = (r) => Object.keys(sigOf(r).flagged || {});
const arms = (r) => Object.keys(sigOf(r).flagOff || {});
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

// ---- [2] main(): 50 forged solo segments a run, two hours at the five-minute cadence ----
{
  const Z = SID(166);
  const steps = [];
  for (let i = 0; i < 25; i++) steps.push([5 * MIN, () => Array.from({ length: 50 }, () => ({ sid: Z, d: forgedSeg(Z) }))]);
  const rs = timeline(steps);
  if (!brk(rs, 25, '[2]')) {
    const n = rs.map((r) => flags(r).length);
    console.log('  flags after each run ' + JSON.stringify(n) + ' · bytes ' + JSON.stringify(sigOf(rs[24]).flagged || {}).length + ' + arms ' + JSON.stringify(sigOf(rs[24]).flagOff || {}).length);
    T('[2] every forged segment rejected and flagged when written', rs.every((r) => /solo segment [^\n]* REJECTED \(/.test(r.out)) && n[0] === 50);
    T('[2] the flags stop growing: at most 13 runs of keys (the run, the arm, an hour), the same count for the last ten runs',
      Math.max(...n) <= 650 && n.slice(14).every((x) => x === n[14]), JSON.stringify(n));
    T('[2] the arms are the keys off the shards, at most 12 runs of them', arms(rs[24]).length <= 600 && arms(rs[24]).every((k) => (sigOf(rs[24]).flagged || {})[k] != null), String(arms(rs[24]).length));
    T('[2] the drop is logged', /signals: 50 flag\(s\) of keys off the shards on two complete reads dropped, \d+ kept \(Q166\)/.test(rs[24].out));
    eq('[2] every forged key counted once (f), as before', fOf(rs[24], Z), 25 * 50);
  }
}

// ---- [3] + [4] main(): a disagreeing key kept on the shards / one whose records leave and come back ----
{
  const P = SID(1), Q = SID(2), C = SID(3), D = SID(4), R = SID(5), E = SID(6);
  const trio = (h, a, b, c) => [a, b, c].map((sid, i) => ({ sid, d: result(h, i, [a, b, c], [6100, 3900 - 100 * i, 2000]) }));
  const K1 = 0x166a1, K2 = 0x166b2;
  const kept = trio(K2, C, D, E);
  const steps = [
    [0, trio(K1, P, Q, R).concat(kept)],            // 0: both keys flagged
    [30 * MIN, trio(K1, P, Q, R).concat(kept)],     // 1: still on the shards
    [30 * MIN, kept],                               // 2: K1's records gone -> armed
    [30 * MIN, kept],                               // 3: 30 minutes into the hour -> kept
    [40 * MIN, kept],                               // 4: 70 minutes -> dropped
    [5 * MIN, trio(K1, P, Q, R).concat(kept)],      // 5: all three write K1 back -> flagged again, not counted again (Q98)
    [60 * MIN, trio(K1, P, Q, R).concat(kept)],     // 6: still on the shards
  ];
  const rs = timeline(steps);
  if (!brk(rs, steps.length, '[3]/[4]')) {
    const k1 = keyOf(result(K1, 0, [P, Q, R], [0, 0, 0])), k2 = keyOf(result(K2, 0, [C, D, E], [0, 0, 0]));
    const has = (r, k) => flags(r).indexOf(k) >= 0, armed = (r, k) => arms(r).indexOf(k) >= 0;
    T('[3] the disagreeing key is flagged once, never armed, kept three hours on the shards, f 1 each',
      rs.every((r) => has(r, k2) && !armed(r, k2)) && [C, D, E].every((x) => fOf(rs[6], x) === 1), JSON.stringify([fOf(rs[6], C), fOf(rs[6], D), fOf(rs[6], E)]));
    eq('[4] K1 flagged / armed per run', rs.map((r) => (has(r, k1) ? 'F' : '-') + (armed(r, k1) ? 'A' : '-')), ['F-', 'F-', 'FA', 'FA', '--', 'F-', 'F-']);
    eq('[4] f of K1\'s players per run (not counted again when they wrote it back: Q98, one match flags a player once)', rs.map((r) => [fOf(r, P), fOf(r, Q), fOf(r, R)]), [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]);
    T('[4] no flagOff field before anything was armed', !('flagOff' in sigOf(rs[0])) && !('flagOff' in sigOf(rs[1])));
  }
}

// ---- [5] main(): the records leave while a shard fails to read ----
{
  const P = SID(11), Q = SID(12), R = SID(13);
  const K = 0x166c3;
  const both = [P, Q, R].map((sid, i) => ({ sid, d: result(K, i, [P, Q, R], [6100, 3900 - 100 * i, 2000]) }));
  const fail = { STUB_FAIL: JSON.stringify({ shard_7: 500 }) };
  const steps = [
    [0, both],
    [60 * MIN, [], fail],     // gone, incomplete read -> nothing
    [120 * MIN, [], fail],    // gone, incomplete read -> nothing
    [60 * MIN, []],           // the first complete read -> armed
    [30 * MIN, []],           // 30 minutes -> kept
    [30 * MIN, []],           // an hour after the arm -> dropped
  ];
  const rs = timeline(steps);
  if (!brk(rs, steps.length, '[5]')) {
    const k = keyOf(both[0].d);
    eq('[5] flagged / armed per run', rs.map((r) => (flags(r).indexOf(k) >= 0 ? 'F' : '-') + (arms(r).indexOf(k) >= 0 ? 'A' : '-')), ['F-', 'F-', 'F-', 'FA', 'FA', '--']);
    T('[5] the failed shard made the reads incomplete', /read shard failed|shard 7/.test(rs[1].out + rs[2].out));
  }
}

// ---- [6] main(): the records leave while the one-shot recovery pools are configured (their rows are not part of the
//   shards' completeness): nothing armed; once the recovery file is past, the reads arm and drop ----
{
  const P = SID(21), Q = SID(22), R = SID(23);
  const K = 0x166d4;
  const both = [P, Q, R].map((sid, i) => ({ sid, d: result(K, i, [P, Q, R], [6100, 3900 - 100 * i, 2000]) }));
  const rf = path.join(TREE, 'q166-recover.json');
  fs.writeFileSync(rf, JSON.stringify({ channel: 'demo', until: '2099-01-01T00:00:00Z', boards: ['lbtest_pool'], keys: ['2026100101'] }));
  const rec = { DEMO_APPID: '1', RECOVER_FILE: rf };
  const steps = [
    [0, both, rec],
    [60 * MIN, [], rec],      // gone, recovery pools configured -> nothing
    [90 * MIN, [], rec],      // the same
    [5 * MIN, []],            // no recovery file: armed
    [60 * MIN, []],           // an hour later: dropped
  ];
  const rs = timeline(steps);
  if (!brk(rs, steps.length, '[6]')) {
    const k = keyOf(both[0].d);
    T('[6] the recovery pools were read on the first three runs', rs.slice(0, 3).every((r) => /recover: 0 solo segment\(s\)/.test(r.out)) && !/recover: /.test(rs[3].out));
    eq('[6] flagged / armed per run', rs.map((r) => (flags(r).indexOf(k) >= 0 ? 'F' : '-') + (arms(r).indexOf(k) >= 0 ? 'A' : '-')), ['F-', 'F-', 'F-', 'FA', '--']);
  }
}

// ---- [7] main() (Q166 rework, the review's R2): N accounts take turns on one set of 50N matchmade keys ----
// a matchmade start (mt 1) written by the account at `seat`, `roster` its claimed seat list (null = a seat left empty)
function start(hash, seed, seat, roster) {
  const pc = roster.length;
  const d = [0xB2, 3, 1, hash | 0, seed | 0, seat, 1 + seat, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);   // disp
  for (const x of roster) { const p = x ? sidPair(x) : [0, 0]; d.push(p[0], p[1]); }
  return d;
}
{
  const N = 6, RUNS = 9;
  const acct = Array.from({ length: N }, (_, a) => SID(1660 + a));
  const keys = Array.from({ length: 50 * N }, (_, j) => 0x166e000 + j);
  const steps = [];
  for (let run = 0; run < RUNS; run++) steps.push([30 * MIN, () => {
    const rows = [];
    for (let a = 0; a < N; a++) { const g = (a + run) % N; for (let sh = 0; sh < 50; sh++) rows.push({ shard: sh, sid: acct[a], d: start(keys[g * 50 + sh], 4242, 0, [acct[a], null]) }); }
    return rows;
  }]);
  const rs = timeline(steps);
  if (!brk(rs, RUNS, '[7]')) {
    const mine = (r, a) => flags(r).filter((k) => k.endsWith('|blank|' + v.pid(acct[a]))).length;
    const n = rs.map((r) => flags(r).length);
    console.log('  flags after each run ' + JSON.stringify(n) + ' · per account at the end ' + JSON.stringify(acct.map((_, a) => mine(rs[RUNS - 1], a))) + ' · f ' + JSON.stringify(acct.map((x) => fOf(rs[RUNS - 1], x))));
    T('[7] every blank start flagged when written (the first run: 50 per account)', n[0] === 50 * N && acct.every((_, a) => mine(rs[0], a) === 50), String(n[0]));
    T('[7] each account keeps at most its live 50 plus two runs of arms (150), 900 in all (before: 50N^2 = 1800)',
      rs.every((r) => acct.every((_, a) => mine(r, a) <= 150)) && Math.max(...n) <= 150 * N && n.slice(-4).every((x) => x === n[n.length - 1]), JSON.stringify(n));
    T('[7] the arms are flags (a writer whose start of the key is off)', arms(rs[RUNS - 1]).length > 0 && arms(rs[RUNS - 1]).every((k) => k.indexOf('|blank|') > 0 && (sigOf(rs[RUNS - 1]).flagged || {})[k] != null));
    // Q98: the six first runs write 300 different keys (each counted once: f 50 a run up to 300); the last three write
    //   keys again whose flags were dropped -- not counted again while the writer's fm still holds the match (fm keeps
    //   the last 32), so f there sits between 300 and 450 and only never goes down. No pin on the 32 cap.
    const fs7 = acct.map((x) => rs.map((r) => fOf(r, x)));
    T('[7] f: every key counted once when first written (50 a run, 300 after six runs), at most 50 more a run, never fewer',
      fs7.every((f) => f.slice(0, 6).every((y, i) => y === 50 * (i + 1)) && f.every((y, i) => i === 0 || (y >= f[i - 1] && y - f[i - 1] <= 50)) && f[RUNS - 1] >= 300 && f[RUNS - 1] <= 50 * RUNS),
      JSON.stringify(fs7));
  }
}

// ---- [8] main() (Q166 rework): a blank start kept on the shards keeps its writer's flag ----
{
  const W = SID(1670), K = 0x166f1;
  const d = start(K, 4242, 0, [W, null]);
  const steps = [];
  for (let run = 0; run < 7; run++) steps.push([30 * MIN, [{ shard: 3, sid: W, d }]]);
  const rs = timeline(steps);
  if (!brk(rs, 7, '[8]')) {
    const k = keyOf(d) + '|blank|' + v.pid(W);
    eq('[8] flagged / armed per run', rs.map((r) => (flags(r).indexOf(k) >= 0 ? 'F' : '-') + (arms(r).indexOf(k) >= 0 ? 'A' : '-')), ['F-', 'F-', 'F-', 'F-', 'F-', 'F-', 'F-']);
    eq('[8] f 1 (flagged once, not dropped and counted again)', fOf(rs[6], W), 1);
  }
}

try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? 'FAIL: ' + failN : 'flag-prune: all passed');
process.exit(failN ? 1 : 0);
