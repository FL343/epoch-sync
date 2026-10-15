'use strict';
// cloud audit Q242 (2026-10): a guard-signed single-player endless segment whose durationSec is negative settles.
//   The guard measures a segment as wall clock minus wall clock (run_tracker.h writeSegment: soloNow() - segT0, both
//   time(nullptr)). Under a verified signature a negative value has one cause: the player's system clock went back
//   inside the segment (a manual clock change, a time sync correcting a clock that ran fast, a dual boot fighting
//   over the hardware clock, a VM snapshot restore). soloSanity used to push 'duration' for it after the signature
//   gate: the segment never settled, its owner took a forgery flag, and every later segment of the run waited out the
//   7-day chain wait and was rejected. Nothing in the lane reads durationSec (pacing runs on this job's own clock, XP /
//   CP / milestones / ladder come from the depths and the bank), so the value is now counted (RUN.soloNegDur), never
//   a reason to reject. Records that do not verify are judged exactly as before.
//   [0] wiring pins + the durationSec tripwire (no consumer may read it without deciding what a negative value means)
//   [1] pure: soloSanity no longer reports a negative duration, every other bound still does; soloClockBack
//   [2] a competitive segment [5,10] with durationSec -3600: settles once, ladder + milestone CP + XP, no flag, counted
//   [3] the same segment with durationSec +300: the board writes are byte-for-byte the ones of [2] (no reward moves)
//   [4] a casual run: segment [0,5] with the clock gone back, then [5,10]: both settle, nobody waits for a chain
//   [5] forged: [2] with a flipped signature -> REJECTED (bad-sig) and flagged, never settled; signed by an unknown
//       key -> pending, never settled
//   [6] a negative duration does not hide another bound: score over the cap -> sanity-flagged [score], not settled
//   [7] mutation self-check: a tree copy with the old line back fails [2] and [4]
//   [8] the deploy: a segment the old line flagged and parked settles on the first run of the new code (sanity-flagged
//       keys are never marked processed, so they come back every run); a casual run's parked next segment settles too
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/state-prune-rework.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COMP_CHAIN_WAIT_MS', 'SEASON_NOW'];
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-neg-dur-' + tag + '-'));
  // another test's scratch file may be listed and gone by the time it is copied (test/root-listing.js, Q225)
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  return dir;
}
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('6e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099101501;
const PRIV_UNKNOWN = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('7f'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const KEY_ID_UNKNOWN = 2099101502;   // never registered
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-neg-dur-run-'));
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
    const summary = fs.readFileSync(sumPath, 'utf8');
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
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
// steps: [[ms since the previous run, recs, files0?, tree of this run?], ...]
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs, files0, stepTree] of steps) {
    const r = runCron(stepTree || tree, world(recs), state ? advance(state, ms) : (files0 || null));
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// the guard's start record of a solo segment (unsigned, single attester; registers the segment key's first sighting)
function startSolo(hash, sid, runSeed) {
  const p = sidPair(sid);
  return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]];
}
// a guard-signed solo segment (attVer 5 layout: base 30 ints + 16 signature ints), durationSec at [9]
function signedSeg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed, 0, 1, 0, 1, o.dur | 0, o.score == null ? 1000 : o.score, 0, lo, hi, o.sd, o.ed, 0, 0, 0, o.flags | 0,
    o.keyId || KEY_ID, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), o.priv || PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  if (o.flipSig) b[b.length - 1] ^= 1;
  return b;
}
// chain memory of a run that already settled up to depth `max` (the segment under test continues it)
const soloSeed = (sid, runSeed, max) => ({ SOLO_FILE: { runs: { [v.soloRunKey(v.pid(sid), 0, runSeed)]: { max, ms: 0, saves: {}, t: Date.now(), seg0: 1 } }, wait: {}, ms: {} } });
const LB = { xp: 5, cp: 8, solo: 15, comp: 16 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: LB.solo, name: v.ENDLESS_LB_SOLO, entries: [] }, { id: LB.comp, name: v.ENDLESS_COMP_LB, entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const writes = (r, id) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(p.body));
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;
const flagged = (r, m) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[m]);
const playerF = (r, sid) => (((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0);
const summaryNeg = (r) => { const x = /\| signed solo segments whose guard clock went back inside the segment[^|]*\| (\d+) \|/.exec(r.summary || ''); return x ? Number(x[1]) : -1; };
// the board writes a run made, without the per-run noise (order kept)
const boardWrites = (rs) => [].concat(...rs.map(r => r.posts.filter(p => /SetLeaderboardScore/.test(p.url)).map(p => p.body)));

console.log('=== Q242: a signed solo segment whose guard clock went back settles (counted, not rejected) ===');

// ---- [0] wiring pins + the durationSec tripwire ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  const i0 = SRC.indexOf('\nfunction soloSanity('), sanBody = i0 < 0 ? '' : SRC.slice(i0, SRC.indexOf('\n}\n', i0));
  T('[0] soloSanity no longer pushes \'duration\'', sanBody.length > 0 && !/out\.push\('duration'\)/.test(sanBody));
  pin('soloClockBack reads durationSec', 'function soloClockBack(f) { return (f.durationSec | 0) < 0; }');
  pin('soloDone counts a verified segment whose clock went back', "if (soloClockBack(f)) {   // Q242: an honest clock change, not a forgery -- counted, the segment handled like any other\n        RUN.soloNegDur = (RUN.soloNegDur | 0) + 1;");
  pin('summary row', "'| signed solo segments whose guard clock went back inside the segment, counted and handled as usual (Q242) | ' + s('soloNegDur', 0) + ' |',");
  // tripwire: durationSec is the guard's WALL clock difference -- negative for an honest player whose clock went back. A new
  //   consumer (a rate bound, a pacing input, a reward) must decide what a negative value means before it reads the field.
  const uses = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').filter((l) => /durationSec/.test(l) && !/^\s*\/\//.test(l));
  const vUses = uses('validate.js');
  T('[0] validate.js reads durationSec in soloClockBack only (a new consumer: see the soloSanity note, Q242)', vUses.length === 1 && /function soloClockBack/.test(vUses[0]), vUses.map((l) => l.trim().slice(0, 100)).join(' || '));
  // other tests write .mutant-*.js scratch files into the root and delete them while the suite runs in parallel (Q225)
  const others = require('./root-listing').rootEntries(ROOT).filter((f) => /\.js$/.test(f) && f !== 'validate.js' && f !== 'attest.js' && f !== 'sanctions.js');
  const oUses = others.filter((f) => uses(f).length);
  T('[0] no other lane file reads durationSec (attest.js decodes it; sanctions.js has an unrelated ban duration)', oUses.length === 0, oUses.join(', '));
}

// ---- [1] pure ----
{
  const seg = (o) => Object.assign({ startDepth: 0, endDepth: 5, score: 1000, durationSec: 300, dispCode: 0, continuesUsed: 0, tokensCp: 0,
    seasonId: 0, flags: 0, build: 0, picksLo: 0, picksHi: 0, rerollLo: 0, rerollHi: 0 }, o || {});
  T('[1] durationSec -3600 -> no flags', JSON.stringify(v.soloSanity(seg({ durationSec: -3600 }))) === '[]', JSON.stringify(v.soloSanity(seg({ durationSec: -3600 }))));
  T('[1] durationSec -1 casual -> no flags', v.soloSanity(seg({ durationSec: -1, flags: A.SEG_CASUAL })).length === 0);
  T('[1] durationSec -2147483648 (int32 floor) -> no flags', v.soloSanity(seg({ durationSec: -2147483648 })).length === 0);
  T('[1] a negative duration hides no other bound (span / cont / flags / score still reported)',
    v.soloSanity(seg({ durationSec: -60, endDepth: 6 })).indexOf('span') >= 0 && v.soloSanity(seg({ durationSec: -60, continuesUsed: 1 })).indexOf('cont') >= 0 &&
    v.soloSanity(seg({ durationSec: -60, flags: 8 })).indexOf('flags') >= 0 && v.soloSanity(seg({ durationSec: -60, score: 1e9 })).join(',') === 'score');
  T('[1] soloClockBack: -1 / -3600 true, 0 / 300 false', typeof v.soloClockBack === 'function' &&
    v.soloClockBack(seg({ durationSec: -1 })) && v.soloClockBack(seg({ durationSec: -3600 })) && !v.soloClockBack(seg({ durationSec: 0 })) && !v.soloClockBack(seg({ durationSec: 300 })));
}

// ---- cases (also run on the mutant tree in [7]) ----
// [2] / [3] a competitive segment [5,10] continuing a run settled to 5: r1 its start; r2 (2 h on) start + the signed segment
function caseComp(tree, n, dur, extra, trees) {
  const S = SID(5101 + n), RS = 525200 + n;
  const seg = signedSeg(Object.assign({ sid: S, id: 'q242-comp-' + n, runSeed: RS, sd: 5, ed: 10, dur, score: 5000 }, extra || {}));
  const m = keyOf(seg), st = { sid: S, d: startSolo(seg[3], S, RS) };
  const t = trees || [];
  const rs = timeline(tree, [[0, [st], soloSeed(S, RS, 5), t[0]], [2 * HOUR, [st, { sid: S, d: seg }], null, t[1]], [2 * HOUR, [st, { sid: S, d: seg }], null, t[2]]]);
  return { rs, m, S };
}
// [4] a casual run: [0,5] with the clock gone back two hours, then [5,10]; both on the board from r1
function caseChain(tree, n, trees) {
  const S = SID(5301 + n), RS = 535300 + n;
  const a = signedSeg({ sid: S, id: 'q242-chain-a-' + n, runSeed: RS, sd: 0, ed: 5, dur: -7200, flags: A.SEG_CASUAL });
  const b = signedSeg({ sid: S, id: 'q242-chain-b-' + n, runSeed: RS, sd: 5, ed: 10, dur: 420, flags: A.SEG_CASUAL });
  const recs = [{ sid: S, d: startSolo(a[3], S, RS) }, { sid: S, d: startSolo(b[3], S, RS) }, { sid: S, d: a }, { sid: S, d: b }];
  const t = trees || [];
  const rs = timeline(tree, [[0, recs, null, t[0]], [2 * HOUR, recs, null, t[1]], [2 * HOUR, recs, null, t[2]], [2 * HOUR, recs, null, t[3]]]);
  return { rs, ma: keyOf(a), mb: keyOf(b), S };
}

// ---- [2] ----
const R2 = caseComp(TREE, 0, -3600);
if (!brk(R2.rs, 3, '[2]')) {
  const rs = R2.rs, m = R2.m, S = R2.S;
  T('[2] settles once (r2), the key processed', sum(rs, (r) => lines(r, m, /solo settle /)) === 1 && lines(rs[1], m, /solo settle /) === 1 && procHas(rs[1], m),
    'settle=' + rs.map((r) => lines(r, m, /solo settle /)).join('/'));
  T('[2] never sanity-flagged', sum(rs, (r) => lines(r, m, /sanity-flagged/)) === 0);
  T('[2] one competitive ladder write, the depth-10 milestone CP, XP', writes(rs[1], LB.comp).length === 1 && writes(rs[1], LB.cp).length === 1 && writes(rs[1], LB.xp).length === 1,
    'comp=' + writes(rs[1], LB.comp).length + ' cp=' + writes(rs[1], LB.cp).length + ' xp=' + writes(rs[1], LB.xp).length);
  T('[2] no flag on the key, the owner never flagged', !rs.some((r) => flagged(r, m)) && playerF(rs[2], S) === 0, 'f=' + playerF(rs[2], S));
  T('[2] counted once: summary row 1 in r2, 0 in r3; one log line', summaryNeg(rs[1]) === 1 && summaryNeg(rs[2]) === 0 && sum(rs, (r) => lines(r, m, /clock went back inside the segment/)) === 1,
    'summary=' + rs.map(summaryNeg).join('/'));
}
// ---- [3] the same segment with a positive duration: the same board writes ----
{
  const R3 = caseComp(TREE, 0, 300);
  if (!brk(R3.rs, 3, '[3]')) {
    T('[3] settles once', sum(R3.rs, (r) => lines(r, R3.m, /solo settle /)) === 1);
    const a = boardWrites(R2.rs), b = boardWrites(R3.rs);
    T('[3] the board writes (ladder / CP / XP, scores and details) are the ones of [2]', a.length > 0 && JSON.stringify(a) === JSON.stringify(b),
      '\n      neg: ' + a.join('\n           ') + '\n      pos: ' + b.join('\n           '));
    T('[3] not counted', R3.rs.every((r) => summaryNeg(r) === 0));
  }
}
// ---- [4] ----
const R4 = caseChain(TREE, 0);
if (!brk(R4.rs, 4, '[4]')) {
  const rs = R4.rs;
  T('[4] the segment with the clock gone back settles', sum(rs, (r) => lines(r, R4.ma, /solo settle /)) === 1, rs.map((r) => lines(r, R4.ma, /solo settle |sanity-flagged/)).join('/'));
  T('[4] the next segment settles too (no chain wait)', sum(rs, (r) => lines(r, R4.mb, /solo settle /)) === 1 && sum(rs, (r) => lines(r, R4.mb, /chain-gap/)) <= 1,
    'settle=' + rs.map((r) => lines(r, R4.mb, /solo settle /)).join('/') + ' gap=' + rs.map((r) => lines(r, R4.mb, /chain-gap/)).join('/'));
  // both segments settle in the same run; the lane writes the casual ladder once per player with the deeper result
  const sw = [].concat(...rs.map((r) => writes(r, LB.solo)));
  T('[4] the casual ladder reaches depth 10, the owner never flagged', sw.length >= 1 && v.unpackEndlessScore(+/score=(\d+)/.exec(sw[sw.length - 1].body)[1]).depth === 10 &&
    playerF(rs[3], R4.S) === 0 && !flagged(rs[3], R4.ma), sw.map((p) => /score=(\d+)/.exec(p.body)[1]).join(','));
}
// ---- [5] forged ----
{
  const F1 = caseComp(TREE, 1, -3600, { flipSig: true });
  if (!brk(F1.rs, 3, '[5a]')) {
    T('[5] a flipped signature: REJECTED (bad-sig), flagged, never settled', sum(F1.rs, (r) => lines(r, F1.m, /REJECTED \(bad-sig\)/)) === 1 && flagged(F1.rs[2], F1.m) &&
      playerF(F1.rs[2], F1.S) === 1 && sum(F1.rs, (r) => lines(r, F1.m, /solo settle /)) === 0 && sum(F1.rs, (r) => writes(r, LB.comp).length + writes(r, LB.xp).length) === 0);
    T('[5] a forged record is not counted as a clock that went back', F1.rs.every((r) => summaryNeg(r) === 0));
  }
  const F2 = caseComp(TREE, 2, -3600, { priv: PRIV_UNKNOWN, keyId: KEY_ID_UNKNOWN });
  if (!brk(F2.rs, 3, '[5b]')) {
    T('[5] an unregistered key: pending, never settled, not flagged', sum(F2.rs, (r) => lines(r, F2.m, /pending \(unknown-key\)/)) >= 2 &&
      sum(F2.rs, (r) => lines(r, F2.m, /solo settle /)) === 0 && !flagged(F2.rs[2], F2.m) && F2.rs.every((r) => summaryNeg(r) === 0));
  }
}
// ---- [6] a negative duration does not hide another bound ----
{
  const R6 = caseComp(TREE, 3, -3600, { score: 2000000000 });
  if (!brk(R6.rs, 3, '[6]')) {
    T('[6] score over the cap: sanity-flagged [score] (no duration), not settled, flagged once', sum(R6.rs, (r) => lines(r, R6.m, /sanity-flagged \[score\]/)) >= 1 &&
      sum(R6.rs, (r) => lines(r, R6.m, /sanity-flagged \[[^\]]*duration/)) === 0 && sum(R6.rs, (r) => lines(r, R6.m, /solo settle /)) === 0 && playerF(R6.rs[2], R6.S) === 1);
  }
}
// ---- [7] mutation self-check: the old line back ----
const MUT = copyTree('mut');   // the old code: also the tree before the deploy in [8]
addTestKey(MUT);
{
  const fixLine = "  // durationSec: counted by the caller (soloClockBack), never a reason to reject -- see the note above (Q242)\n";
  const oldLine = "  if ((f.durationSec | 0) < 0) out.push('duration');\n";
  if (SRC.split(fixLine).length !== 2) bad('[7] the fix line was not found -- the mutant cannot be built');
  else {
    fs.writeFileSync(path.join(MUT, 'validate.js'), SRC.replace(fixLine, oldLine));
    const M2 = caseComp(MUT, 4, -3600), M4 = caseChain(MUT, 1);
    T('[7] mutant: [2] fails (sanity-flagged [duration], never settled, the owner flagged)', M2.rs.length === 3 && sum(M2.rs, (r) => lines(r, M2.m, /sanity-flagged \[duration\]/)) >= 1 &&
      sum(M2.rs, (r) => lines(r, M2.m, /solo settle /)) === 0 && playerF(M2.rs[2], M2.S) === 1);
    T('[7] mutant: [4] fails (neither segment settles; the next one waits for its chain)', M4.rs.length === 4 && sum(M4.rs, (r) => lines(r, M4.ma, /solo settle /) + lines(r, M4.mb, /solo settle /)) === 0 &&
      sum(M4.rs, (r) => lines(r, M4.mb, /waiting for its chain \(chain-gap\)/)) >= 2);
  }
}
// ---- [8] the deploy: runs 1-2 on the old code, then the new one on the carried state ----
const D8 = caseComp(TREE, 6, -3600, null, [MUT, MUT, TREE]), C8 = caseChain(TREE, 2, [MUT, MUT, TREE, TREE]);
if (!brk(D8.rs, 3, '[8a]')) {
  const rs = D8.rs, m = D8.m;
  T('[8] before the deploy: sanity-flagged [duration], not settled, the owner flagged', lines(rs[1], m, /sanity-flagged \[duration\]/) === 1 && lines(rs[1], m, /solo settle /) === 0 &&
    !procHas(rs[1], m) && playerF(rs[1], D8.S) === 1);
  T('[8] the first run of the new code settles it (ladder / milestone CP / XP) and counts it', lines(rs[2], m, /solo settle /) === 1 && procHas(rs[2], m) && summaryNeg(rs[2]) === 1 &&
    writes(rs[2], LB.comp).length === 1 && writes(rs[2], LB.cp).length === 1 && writes(rs[2], LB.xp).length === 1);
}
if (!brk(C8.rs, 4, '[8b]')) {
  const rs = C8.rs;
  T('[8] a casual run parked before the deploy: the flagged segment and the one waiting for its chain both settle after it',
    sum(rs.slice(0, 2), (r) => lines(r, C8.ma, /sanity-flagged \[duration\]/)) >= 1 && sum(rs.slice(0, 2), (r) => lines(r, C8.mb, /waiting for its chain \(chain-gap\)/)) >= 1 &&
    sum(rs.slice(2), (r) => lines(r, C8.ma, /solo settle /)) === 1 && sum(rs.slice(2), (r) => lines(r, C8.mb, /solo settle /)) === 1 && sum(rs, (r) => lines(r, C8.mb, /chain REJECT/)) === 0,
    rs.map((r) => lines(r, C8.ma, /solo settle /) + '+' + lines(r, C8.mb, /solo settle /)).join('/'));
}
try { fs.rmSync(MUT, { recursive: true, force: true }); } catch (e) {}
try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (solo-neg-duration) ===' : '=== PASS -- 0 fail (solo-neg-duration) ===');
process.exit(failN ? 1 : 0);
