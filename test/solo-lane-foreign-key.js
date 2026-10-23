'use strict';
// cloud audit W41 (2026-10): a failed solo check must not close a key that a real record would settle later.
//   The solo lane takes every pc=1 endless record of a key (B-F10) and, on a hard reject (short / magic / ver / bad
//   signature / foreign owner), it used to mark the key processed. processed is shared by every lane, and the key is in
//   every public start record, so an account outside the match could end a run's settlement for good:
//     - a co-op endless run: one start naming another roster (the key splits: no seat gate) and one malformed pc=1
//       record, written before the real result -- the result then arrived to a processed key;
//     - a single-player run's next segment: its start (the guard writes it at the previous checkpoint) gives the key; the
//       same two rows inside the provisional window (Q118) closed the key before the signed segment landed, and the
//       run's later segments rejected as chain gaps 7 days on;
//     - a run where a shard read failed registers no endless start (start-wait): one malformed pc=1 record alone closed
//       the key the same way.
//   Now a hard reject flags and warns once (recordFlag keeps one flag per key while its records are on the shards), the
//   key stays open, and a record that verifies settles it.
//   [0] wiring pins
//   [1] a seated member's malformed pc=1 row next to the trio's consistent records: the key is not closed, warned once
//   [2] an outsider before the result (split start + short pc=1), the trio's results from r2, the outsider's rows gone in
//       r3: the trio settles (ladder + XP)
//   [3] an outsider pre-poisons the key of a signed solo segment: the segment settles once when it lands
//   [4] no start entry at all: an outsider's short pc=1 alone, then the signed segment: it settles
//   [5] B-F10 unchanged: a signed solo segment + two colluders' consistent pc=2 records under its key: the solo segment
//       settles once, no duo ladder write, no colluder XP
//   [6] the owner's own short record on his own key: not closed, one REJECTED warning and one flag over two runs
//   [7] mutation self-check: a tree copy with the old line (processed.add on a hard reject) fails [2] and [3]
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/state-prune-rework.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

// ---- a copy of this tree with one test signing key (the guard-signed solo lane needs a key the job verifies) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-lane-fk-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);   // Q225: skips other tests' .mutant-* scratch files
  return dir;
}
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('5e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099100801;
function addTestKey(dir) {
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
}
const TREE = copyTree('fix');
addTestKey(TREE);
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-lane-fk-run-'));
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
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'),
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
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
// steps: [[ms since the previous run, recs, files0?], ...]
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs, files0] of steps) {
    const r = runCron(tree, world(recs), state ? advance(state, ms) : (files0 || null), { RESUME_TAG_REQUIRED: '0' });
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 7;
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// casual co-op endless settle (mt 7): pc seats, the run's depth 0 -> 3
function settle7(hash, seat, ros, runSeed) {
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, runSeed == null ? SEED : runSeed, seat, seat + 1, 12, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  return d;
}
function start7(hash, seat, ros, runSeed) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, runSeed == null ? SEED : runSeed, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// a malformed pc=1 record (too short for any attest layout: a hard reject before any crypto)
function shortSolo(hash, seat, sid, runSeed) {
  const p = sidPair(sid);
  return [0xB1, 3, 7, hash | 0, runSeed == null ? SEED : runSeed, seat, 0, 0, 1, 60, 999, 0, p[0], p[1], 0, 3, 0, 0, 0, 0];
}
// a guard-signed casual solo segment, depth 5 -> 8, resuming a run whose chain memory is seeded below (attVer 5 layout)
function signedSolo(sid, id, runSeed) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1, 300, 1000, 0, lo, hi, 5, 8, 0, 0, 0, A.SEG_CASUAL | A.SEG_RESUMED,
    KEY_ID, (5 | ((A.hash32(id + '-tag') & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
const soloSeed = (sid, runSeed) => ({ SOLO_FILE: { runs: { [v.soloRunKey(v.pid(sid), 0, runSeed)]: { max: 7, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 } }, wait: {}, ms: {} } });
const LB = { xp: 5, duo: 11, trio: 12, solo: 15 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: LB.duo, name: 'endless_board', entries: [] }, { id: LB.trio, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: LB.solo, name: v.ENDLESS_LB_SOLO, entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const writesTo = (r, id) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(p.body)).length;
const xpOf = (r, sid) => r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + LB.xp + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body)).length;
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;

console.log('=== W41: a failed solo check does not close the key (outside rows under a co-op or a solo segment key) ===');

// ---- [0] wiring pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('a hard reject flags + warns once and leaves the key open',
    "      if (recordFlag(signals, c.g, m, nowMs, 'at')) {   // O198 v1: a signature failure carries its own ledger source (still one f)\n        sigDirty = true; trustTouched.add(sid);\n        RUN.soloRej = (RUN.soloRej | 0) + 1;\n"
    + "        ghWarn('match=' + m + ': solo segment ' + plog(sid) + ' REJECTED (' + gate.reason + ') -- not settled, the key stays open');\n"
    + "      } else console.log('  solo ' + m + ': ' + plog(sid) + ' rejected again (' + gate.reason + '), flagged before -- not settled, the key stays open');\n      return false;\n");
  T('[0] the solo lane closes no key before the signature verified', !/processed\.add\(m\);\s+\/\/ a bad signature \/ foreign owner never heals/.test(SRC));
  pin('B-F10: the solo lane still takes every pc=1 record of the key', "consistentMatches.push({ m, g: solos, void: false, solo: true });");
}

// ---- cases (also run on the mutant tree in [7]) ----
// [2] an outsider before the result: r1 starts + the outsider's split start + short pc=1; r2 + the trio's results; r3 the
//     outsider's rows gone
function caseOutsiderCoop(tree, n) {
  const a = SID(4101 + n * 4), b = SID(4102 + n * 4), c = SID(4103 + n * 4), o = SID(4104 + n * 4);
  const ros = [a, b, c], h = 0x41a0 + n, m = h + '_' + SEED + '_7';
  const starts = [{ sid: a, d: start7(h, 0, ros) }, { sid: b, d: start7(h, 1, ros) }, { sid: c, d: start7(h, 2, ros) }];
  const res = [{ sid: a, d: settle7(h, 0, ros) }, { sid: b, d: settle7(h, 1, ros) }, { sid: c, d: settle7(h, 2, ros) }];
  const outside = [{ sid: o, d: start7(h, 2, [a, b, o]) }, { sid: o, d: shortSolo(h, 2, o) }];
  const rs = timeline(tree, [[0, starts.concat(outside)], [3 * HOUR, starts.concat(outside, res)], [3 * HOUR, starts.concat(res)], [3 * HOUR, starts.concat(res)]]);
  return { rs, m, ros, o };
}
// [3] an outsider pre-poisons a solo segment key: r1 the owner's start; r2 (2 min on) + the outsider's start + short pc=1;
//     r3 + the owner's signed segment (the outsider's short row still there)
function caseOutsiderSolo(tree, n) {
  const S = SID(4201 + n * 2), O = SID(4202 + n * 2), RS = 434300 + n;
  const seg = signedSolo(S, 'w41-solo-' + n, RS), h = seg[3], m = keyOf(seg);
  const own = { sid: S, d: start7(h, 0, [S], RS) };
  const outside = [{ sid: O, d: start7(h, 0, [O], RS) }, { sid: O, d: shortSolo(h, 0, O, RS) }];
  const rs = timeline(tree, [[0, [own], soloSeed(S, RS)], [2 * MIN, [own].concat(outside)], [2 * HOUR, [own, { sid: S, d: seg }, outside[1]]], [2 * HOUR, [own, { sid: S, d: seg }]]]);
  return { rs, m };
}

// ---- [1] a seated member's malformed pc=1 row next to the trio's consistent records ----
{
  const a = SID(4001), b = SID(4002), c = SID(4003), ros = [a, b, c], h = 0x4100, m = h + '_' + SEED + '_7';
  const recs = [{ sid: a, d: start7(h, 0, ros) }, { sid: b, d: start7(h, 1, ros) }, { sid: c, d: start7(h, 2, ros) },
    { sid: a, d: settle7(h, 0, ros) }, { sid: b, d: settle7(h, 1, ros) }, { sid: c, d: settle7(h, 2, ros) }, { sid: c, d: shortSolo(h, 2, c) }];
  const rs = timeline(TREE, [[0, recs], [3 * HOUR, recs]]);
  if (!brk(rs, 2, '[1]')) {
    T('[1] the key is not closed (r1 / r2)', !procHas(rs[0], m) && !procHas(rs[1], m), [procHas(rs[0], m), procHas(rs[1], m)].join('/'));
    T('[1] REJECTED once, then quietly looked at again', lines(rs[0], m, /REJECTED \(short\) -- not settled, the key stays open/) === 1 && lines(rs[1], m, /REJECTED/) === 0 && lines(rs[1], m, /rejected again \(short\), flagged before/) === 1,
      rs.map((r) => lines(r, m, /REJECTED|rejected again/)).join('/'));
    T('[1] one flag on the key, nothing settled while the row is there', !!((rs[1].state.SIGNALS_FILE || {}).flagged || {})[m] && sum(rs, (r) => writesTo(r, LB.trio)) === 0);
  }
}
// ---- [2] ----
const R2 = caseOutsiderCoop(TREE, 0);
if (!brk(R2.rs, 4, '[2]')) {
  const rs = R2.rs, m = R2.m;
  T('[2] r1 / r2: the outsider\'s short pc=1 row is rejected, the key stays open', !procHas(rs[0], m) && !procHas(rs[1], m) && lines(rs[0], m, /REJECTED \(short\)/) === 1, [procHas(rs[0], m), procHas(rs[1], m)].join('/'));
  T('[2] r3 (the outsider\'s rows gone): the trio settles -- 3 trio ladder writes, XP for each seat', writesTo(rs[2], LB.trio) === 3 && R2.ros.every((s) => xpOf(rs[2], s) === 1) && procHas(rs[2], m),
    'trio=' + rs.map((r) => writesTo(r, LB.trio)).join('/') + ' xp=' + R2.ros.map((s) => sum(rs, (r) => xpOf(r, s))).join('/'));
  T('[2] settled once, the outsider earns nothing', sum(rs, (r) => writesTo(r, LB.trio)) === 3 && sum(rs, (r) => xpOf(r, R2.o)) === 0);
}
// ---- [3] ----
const R3 = caseOutsiderSolo(TREE, 0);
if (!brk(R3.rs, 4, '[3]')) {
  const rs = R3.rs, m = R3.m;
  T('[3] r2 (the outsider\'s start splits the key, his short pc=1 row is rejected): the key stays open', /start-split /.test(rs[1].out) && lines(rs[1], m, /REJECTED \(short\)/) === 1 && !procHas(rs[1], m));
  T('[3] r3: the signed segment settles once, one solo ladder write', lines(rs[2], m, /solo settle /) === 1 && writesTo(rs[2], LB.solo) === 1 && procHas(rs[2], m),
    'settle=' + rs.map((r) => lines(r, m, /solo settle /)).join('/') + ' soloLb=' + rs.map((r) => writesTo(r, LB.solo)).join('/'));
  T('[3] never twice', sum(rs, (r) => lines(r, m, /solo settle /)) === 1);
}
// ---- [4] no start entry at all: an outsider's short pc=1 alone, then the signed segment ----
{
  const S = SID(4301), O = SID(4302), RS = 434390;
  const seg = signedSolo(S, 'w41-nostart', RS), m = keyOf(seg);
  const rs = timeline(TREE, [[0, [{ sid: O, d: shortSolo(seg[3], 0, O, RS) }], soloSeed(S, RS)], [2 * HOUR, [{ sid: S, d: seg }]], [2 * HOUR, [{ sid: S, d: seg }]]]);
  if (!brk(rs, 3, '[4]')) {
    T('[4] r1: rejected, not closed', lines(rs[0], m, /REJECTED \(short\)/) === 1 && !procHas(rs[0], m));
    T('[4] the signed segment settles once (r2 is the pacing wait)', sum(rs, (r) => lines(r, m, /solo settle /)) === 1 && procHas(rs[2], m), rs.map((r) => lines(r, m, /solo settle /)).join('/'));
  }
}
// ---- [5] B-F10 unchanged: a signed solo segment + two colluders' consistent pc=2 records under its key ----
{
  const S = SID(4401), X = SID(4402), Y = SID(4403), RS = 424200;
  const seg = signedSolo(S, 'w41-bf10', RS), m = keyOf(seg), ros = [X, Y];
  const coll = (seat) => { const d = [0xB1, 3, 7, seg[3], RS, seat, seat + 1, 12, 2, 600, 400, 300, 0]; for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); } d.push(0, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0); return d; };
  const recs = [{ sid: S, d: seg }, { sid: X, d: coll(0) }, { sid: Y, d: coll(1) }];
  const rs = timeline(TREE, [[0, recs, soloSeed(S, RS)], [2 * HOUR, recs], [2 * HOUR, recs]]);
  if (!brk(rs, 3, '[5]')) {
    T('[5] the solo segment settles once', sum(rs, (r) => lines(r, m, /solo settle /)) === 1 && sum(rs, (r) => writesTo(r, LB.solo)) === 1);
    T('[5] no duo ladder write, no colluder XP', sum(rs, (r) => writesTo(r, LB.duo)) === 0 && sum(rs, (r) => xpOf(r, X) + xpOf(r, Y)) === 0);
  }
}
// ---- [6] the owner's own short record on his own key ----
{
  const S = SID(4501), h = 0x4501, m = h + '_' + SEED + '_7';
  const recs = [{ sid: S, d: shortSolo(h, 0, S) }];
  const rs = timeline(TREE, [[0, recs], [10 * MIN, recs]]);
  if (!brk(rs, 2, '[6]')) {
    T('[6] not closed, one REJECTED warning over two runs', !procHas(rs[1], m) && sum(rs, (r) => lines(r, m, /REJECTED/)) === 1 && lines(rs[1], m, /rejected again/) === 1);
    T('[6] one flag, the owner counted once', !!((rs[1].state.SIGNALS_FILE || {}).flagged || {})[m] && ((((rs[1].state.SIGNALS_FILE || {}).players || {})[v.pid(S)] || {}).f | 0) === 1,
      JSON.stringify(((rs[1].state.SIGNALS_FILE || {}).players || {})[v.pid(S)] || {}));
  }
}
// ---- [7] mutation self-check: the old line back (processed.add on a hard reject) ----
{
  const MUT = copyTree('mut');
  addTestKey(MUT);
  const a = SRC.indexOf('      // cloud audit W41 (2026-10): a failed check never closes the key.');
  const endMark = "the key stays open');\n      return false;\n";
  const b = SRC.indexOf(endMark, a);
  const old = "      recordFlag(signals, c.g, m, nowMs); sigDirty = true; trustTouched.add(sid);\n      RUN.soloRej = (RUN.soloRej | 0) + 1;\n"
    + "      ghWarn('match=' + m + ': solo segment ' + plog(sid) + ' REJECTED (' + gate.reason + ') -- not settled');\n"
    + "      processed.add(m);   // a bad signature / foreign owner never heals\n      return false;\n";
  if (a < 0 || b < 0) bad('[7] the fix block was not found -- the mutant cannot be built');
  else {
    fs.writeFileSync(path.join(MUT, 'validate.js'), SRC.slice(0, a) + old + SRC.slice(b + endMark.length));
    const M2 = caseOutsiderCoop(MUT, 1), M3 = caseOutsiderSolo(MUT, 1);
    T('[7] mutant: [2] fails (the trio never settles, the key closed in r1)', M2.rs.length === 4 && procHas(M2.rs[0], M2.m) && sum(M2.rs, (r) => writesTo(r, LB.trio)) === 0);
    T('[7] mutant: [3] fails (the signed segment never settles)', M3.rs.length === 4 && procHas(M3.rs[1], M3.m) && sum(M3.rs, (r) => lines(r, M3.m, /solo settle /)) === 0);
  }
  try { fs.rmSync(MUT, { recursive: true, force: true }); } catch (e) {}
}
try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (solo-lane-foreign-key) ===' : '=== PASS -- 0 fail (solo-lane-foreign-key) ===');
process.exit(failN ? 1 : 0);
