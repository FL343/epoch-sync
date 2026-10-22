'use strict';
// cloud audit Q245 (2026-10): one solo segment key, two accounts -- each account's own signed segment is judged on its own.
//   A solo segment's key is d[3]_d[4]_d[2]: the hash of the match id the renderer hands the guard (32 bits), the run seed
//   (the season seed: the same for every run of a season) and the match type. A modified client can make its own guard sign
//   a real segment of its own under another player's key (the key is in every public start record). The solo lane settled
//   the FIRST record of the key whose signature and owner binding verified and then closed the key (processed + the done
//   memory), so:
//     - the outsider's segment read before the victim's in the same run settled (his own play) and the victim's never did;
//     - the outsider's segment settled a run before the victim's landed: the key was closed, the victim's never looked at;
//     - the outsider's segment rejected by a later check (chain / perk / sanity) closed the key the same way, and a check
//       that flags (sanity / perk / seedcap veto) flagged every writer of the key, the victim too.
//   Now the lane judges the records of each account (writer) on their own: the done memory remembers the owner
//   ([keyName, seconds, owner] for the key's first owner, key|owner for the next), a key it remembers per owner comes back
//   for an owner it never processed (pacing from the key's first processing, no missing-start signal), and a flag only
//   hits the account whose own record failed. A whole-key entry (written before this change) and a processed key with no
//   entry stay closed for everyone: nothing that settled before is looked at again.
//   [0] wiring pins
//   [1] same run, the outsider's signed segment read first: both settle once (each his own), never again
//   [2] the outsider's segment settles a run before the victim's lands: the victim's settles when it lands, no ns signal
//   [3] the outsider's segment is chain-rejected (run burnt) first: the victim's still settles
//   [4] the outsider's segment fails sanity (span) first: only the outsider is flagged, the victim settles
//   [5] a whole-key done entry (before this change) + a processed key with no entry: stay closed, nothing settles again
//   [6] a garbage pc=1 row of a third account under a key the lane remembers per owner: flagged once, nothing settles twice
//   [7] the owner's own segment written back after its key left the processed list: nothing settles, counted once (Q144)
//   [8] unit: soloOwnerGroups / soloDoneNote / soloDoneHas / soloReopenOwners / soloDoneT0
//   [9] mutation self-check: without the reopen [2] fails; judging only the first owner fails [1]
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/solo-lane-foreign-key.js.
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
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

// ---- a copy of this tree with one test signing key (the guard-signed solo lane needs a key the job verifies) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-lane-ok-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  return dir;
}
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('5f'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099102001;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-lane-ok-run-'));
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
    const summary = fs.readFileSync(sumPath, 'utf8');
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// time passes: every clock the state keeps moves back by ms (the done memory keeps seconds)
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
    for (const k of Object.keys(so.done || {})) if (Array.isArray(so.done[k])) so.done[k][1] -= Math.floor(ms / 1000);
  }
  return files;
}
// steps: [[ms since the previous run, recs, files0?, mut?], ...]; mut(files) edits the state handed to that run
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs, files0, mut] of steps) {
    let files = state ? advance(state, ms) : (files0 || null);
    if (mut) files = mut(files || {});
    const r = runCron(tree, world(recs), files);
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
function start7(hash, seat, ros, runSeed) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, runSeed, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// a malformed pc=1 record (too short for any attest layout: a hard reject before any crypto)
function shortSolo(hash, sid, runSeed) {
  const p = sidPair(sid);
  return [0xB1, 3, 7, hash | 0, runSeed, 0, 0, 0, 1, 60, 999, 0, p[0], p[1], 0, 3, 0, 0, 0, 0];
}
// a guard-signed casual solo segment of sid under the key hash32(id) _ runSeed _ 7, depth 5 -> ed (8 = a clean segment;
//   12 = a span past the checkpoint cadence: sanity), resuming a run whose chain memory soloSeed puts in place (attVer 5)
function signedSolo(sid, id, runSeed, ed) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1, 300, 1000, 0, lo, hi, 5, ed == null ? 8 : ed, 0, 0, 0, A.SEG_CASUAL | A.SEG_RESUMED,
    KEY_ID, (5 | ((A.hash32(id + '-tag') & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
// the chain memory of each account's run (each runs his own: the run key is the owner's pid + season + seed); burnt = a
//   run caught resuming a used row (every later segment of it chain-rejects)
const soloSeed = (sids, runSeed, burnt) => {
  const runs = {};
  for (const s of sids) runs[v.soloRunKey(v.pid(s), 0, runSeed)] = Object.assign({ max: 7, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 }, (burnt || []).indexOf(s) >= 0 ? { burnt: 1 } : {});
  return { SOLO_FILE: { runs, wait: {}, ms: {} } };
};
const LB = { xp: 5, solo: 15 };
// shard order: an account's first record goes to shard_0, its second to shard_1, ... -- the reconcile reads shard_0 first
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: LB.solo, name: v.ENDLESS_LB_SOLO, entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;
const plogOf = (sid) => v.pid(sid).slice(0, 8);   // validate.js plog
// a settle line of this account under this key ("  solo settle <m>: <plog> casual depth ...")
const settles = (r, m, sid) => r.out.split('\n').filter((l) => l.indexOf('solo settle ' + m + ': ' + plogOf(sid) + ' ') >= 0).length;
const soloLbOf = (r, sid) => r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + LB.solo + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body)).length;
const xpOf = (r, sid) => r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + LB.xp + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body)).length;
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {});

console.log('=== Q245: one solo segment key, two accounts -- each account\'s own signed segment is judged on its own ===');

// ---- [0] wiring pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('the lane judges each owner\'s records on their own', '    for (const g of gs) if (await soloSettleOwner(Object.assign({}, c, { g }))) n++;');
  pin('the done memory is checked per owner', '    if (soloDoneHas(soloState, m, pid(String(c.g[0].steamID)))) {');
  pin('soloDone remembers the owner', '      processed.add(m); soloDoneNote(soloState, m, f.keyName, nowMs, p);\n');
  pin('a processed solo key comes back for an owner the lane never processed', "  const fresh = consistentMatches.filter(c => !processed.has(c.m) || (c.solo && soloReopenOwners(soloState, c.m, c.g).length > 0));");
  pin('a reopened owner paces from the key\'s first processing (no missing-start signal)', '    if (!pend && processed.has(m)) { const t0 = soloDoneT0(soloState, m, c.g); if (t0 != null) pend = { t0, reopened: true }; }');
  T('[0] the settle loop line is unchanged', SRC.split('if (c.solo) { if (await soloSettle(c)) settledSolo++; continue; }').length === 2);
}

// ---- cases (also run on the mutant trees in [9]) ----
// [1] same run: r0 the victim's start; r1 (+2 h) the outsider's signed segment on shard_0, the victim's on shard_1; r2 the same rows
function caseSameRun(tree, n) {
  const S = SID(5101 + n * 2), O = SID(5102 + n * 2), RS = 545100 + n, id = 'q245-same-' + n;
  const segS = signedSolo(S, id, RS), segO = signedSolo(O, id, RS), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) }, oStart = { sid: O, d: start7(segS[3], 0, [O], RS), shard: 2 };   // his own start splits the key (no seat gate)
  const rows = [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }];
  const rs = timeline(tree, [[0, [own], soloSeed([S, O], RS)], [2 * HOUR, rows], [2 * HOUR, rows]]);
  return { rs, m, S, O, same: keyOf(segO) === m };
}
// [2] the outsider's segment settles alone in r1; the victim's lands in r2 (+2 h); r3 the same rows
function caseLater(tree, n) {
  const S = SID(5201 + n * 2), O = SID(5202 + n * 2), RS = 545200 + n, id = 'q245-later-' + n;
  const segS = signedSolo(S, id, RS), segO = signedSolo(O, id, RS), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) }, oStart = { sid: O, d: start7(segS[3], 0, [O], RS), shard: 2 };
  const rs = timeline(tree, [[0, [own], soloSeed([S, O], RS)], [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }]],
    [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }]], [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }]]]);
  return { rs, m, S, O };
}

// ---- [1] ----
const R1 = caseSameRun(TREE, 0);
if (!brk(R1.rs, 3, '[1]')) {
  const rs = R1.rs, m = R1.m;
  T('[1] the two segments share one key', R1.same);
  T('[1] r1: the outsider\'s segment settles (his own play), the victim\'s too', settles(rs[1], m, R1.O) === 1 && settles(rs[1], m, R1.S) === 1,
    'outsider=' + rs.map((r) => settles(r, m, R1.O)).join('/') + ' victim=' + rs.map((r) => settles(r, m, R1.S)).join('/'));
  T('[1] each once over three runs, one solo ladder write and one XP write each', sum(rs, (r) => settles(r, m, R1.O)) === 1 && sum(rs, (r) => settles(r, m, R1.S)) === 1
    && sum(rs, (r) => soloLbOf(r, R1.S)) === 1 && sum(rs, (r) => soloLbOf(r, R1.O)) === 1 && sum(rs, (r) => xpOf(r, R1.S)) === 1 && sum(rs, (r) => xpOf(r, R1.O)) === 1,
    'lb=' + [R1.S, R1.O].map((s) => sum(rs, (r) => soloLbOf(r, s))).join('/') + ' xp=' + [R1.S, R1.O].map((s) => sum(rs, (r) => xpOf(r, s))).join('/'));
  const done = (rs[2].state.SOLO_FILE || {}).done || {};
  T('[1] the done memory holds both owners (one entry each), the key processed', typeof v.soloDoneHas === 'function' && v.soloDoneHas(rs[2].state.SOLO_FILE, m, v.pid(R1.S)) && v.soloDoneHas(rs[2].state.SOLO_FILE, m, v.pid(R1.O))
    && Object.keys(done).filter((k) => k === m || k.indexOf(m + '|') === 0).length === 2 && procHas(rs[2], m), JSON.stringify(done));
  T('[1] nobody flagged', !((rs[2].state.SIGNALS_FILE || {}).flagged || {})[m] && (sigOf(rs[2], R1.S).f | 0) === 0 && (sigOf(rs[2], R1.O).f | 0) === 0);
}
// ---- [2] ----
const R2 = caseLater(TREE, 0);
if (!brk(R2.rs, 4, '[2]')) {
  const rs = R2.rs, m = R2.m;
  T('[2] r1: the outsider\'s segment settles alone, the key processed', settles(rs[1], m, R2.O) === 1 && procHas(rs[1], m));
  T('[2] r2: the victim\'s segment lands and settles under the processed key', settles(rs[2], m, R2.S) === 1,
    'victim=' + rs.map((r) => settles(r, m, R2.S)).join('/') + '\n' + rs[2].out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n'));
  T('[2] each once over four runs, the victim on the ladder once', sum(rs, (r) => settles(r, m, R2.O)) === 1 && sum(rs, (r) => settles(r, m, R2.S)) === 1 && sum(rs, (r) => soloLbOf(r, R2.S)) === 1);
  T('[2] the victim carries no missing-start signal (his start was read before the key closed)', (sigOf(rs[3], R2.S).ns | 0) === 0, JSON.stringify(sigOf(rs[3], R2.S)));
  T('[2] the summary counts the reopened key', /\| solo keys holding segments of more than one account \/ processed keys reopened for an account not processed under them \(Q245\) \| \d+ \/ 1 \|/.test(rs[2].summary),
    rs[2].summary.split('\n').filter((l) => /Q245/.test(l)).join(' / '));
}
// ---- [3] the outsider's segment is chain-rejected first (his run is burnt) ----
{
  const S = SID(5301), O = SID(5302), RS = 545300, id = 'q245-burnt';
  const segS = signedSolo(S, id, RS), segO = signedSolo(O, id, RS), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) }, oStart = { sid: O, d: start7(segS[3], 0, [O], RS), shard: 2 };
  const rs = timeline(TREE, [[0, [own], soloSeed([S, O], RS, [O])], [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }]],
    [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }]], [2 * HOUR, [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }]]]);
  if (!brk(rs, 4, '[3]')) {
    T('[3] r1: the outsider\'s segment chain-rejects (run-burnt), the key processed', lines(rs[1], m, /chain REJECT \(run-burnt\)/) === 1 && procHas(rs[1], m));
    T('[3] the victim\'s segment settles once', sum(rs, (r) => settles(r, m, S)) === 1 && sum(rs, (r) => soloLbOf(r, S)) === 1, rs.map((r) => settles(r, m, S)).join('/'));
    T('[3] the outsider earns nothing', sum(rs, (r) => settles(r, m, O) + soloLbOf(r, O) + xpOf(r, O)) === 0);
  }
}
// ---- [4] the outsider's segment fails sanity first (a span past the checkpoint cadence) ----
{
  const S = SID(5401), O = SID(5402), RS = 545400, id = 'q245-sanity';
  const segS = signedSolo(S, id, RS), segO = signedSolo(O, id, RS, 12), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) }, oStart = { sid: O, d: start7(segS[3], 0, [O], RS), shard: 2 };
  const rows = [own, oStart, { sid: O, d: segO, shard: 0 }, { sid: S, d: segS, shard: 1 }];
  const rs = timeline(TREE, [[0, [own], soloSeed([S, O], RS)], [2 * HOUR, rows], [2 * HOUR, rows]]);
  if (!brk(rs, 3, '[4]')) {
    T('[4] the outsider\'s segment is sanity-flagged', lines(rs[1], m, /sanity-flagged \[span\]/) === 1);
    T('[4] only the outsider is flagged, the victim is not', (sigOf(rs[2], O).f | 0) === 1 && (sigOf(rs[2], S).f | 0) === 0, 'outsider f=' + (sigOf(rs[2], O).f | 0) + ' victim f=' + (sigOf(rs[2], S).f | 0));
    T('[4] the victim\'s segment settles once', sum(rs, (r) => settles(r, m, S)) === 1 && sum(rs, (r) => soloLbOf(r, S)) === 1, rs.map((r) => settles(r, m, S)).join('/'));
    T('[4] the outsider earns nothing', sum(rs, (r) => settles(r, m, O) + soloLbOf(r, O) + xpOf(r, O)) === 0);
  }
}
// ---- [5] a whole-key done entry (before this change) + a processed key with no entry: stay closed ----
{
  const S = SID(5501), O = SID(5502), RS = 545500;
  const segS = signedSolo(S, 'q245-legacy', RS), m = keyOf(segS);
  const segS2 = signedSolo(S, 'q245-noentry', RS), m2 = keyOf(segS2);
  const files = soloSeed([S, O], RS);
  files.SOLO_FILE.done = { [m]: [String(KEY_ID), Math.floor(Date.now() / 1000) - 3600] };   // the old shape: the key, whoever owned it
  files.PROCESSED_FILE = [m, m2];
  const rows = [{ sid: S, d: segS }, { sid: S, d: segS2 }];
  const rs = timeline(TREE, [[0, rows, files], [2 * HOUR, rows]]);
  if (!brk(rs, 2, '[5]')) {
    T('[5] neither key settles again (a whole-key entry; a processed key with no entry)', sum(rs, (r) => settles(r, m, S) + settles(r, m2, S) + soloLbOf(r, S) + xpOf(r, S)) === 0,
      rs.map((r) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 || l.indexOf(m2) >= 0).join(' | ')).join(' || '));
    T('[5] no reopen counted', rs.every((r) => !/\| solo keys holding segments of more than one account \/ processed keys reopened for an account not processed under them \(Q245\) \| \d+ \/ [1-9]/.test(r.summary)));
  }
}
// ---- [6] a garbage pc=1 row of a third account under a key the lane remembers per owner ----
{
  const S = SID(5601), W = SID(5602), RS = 545600;
  const segS = signedSolo(S, 'q245-garbage', RS), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) };
  const rows = [own, { sid: S, d: segS, shard: 1 }];
  const rowsW = rows.concat([{ sid: W, d: start7(segS[3], 0, [W], RS), shard: 2 }, { sid: W, d: shortSolo(segS[3], W, RS), shard: 0 }]);
  const rs = timeline(TREE, [[0, [own], soloSeed([S], RS)], [2 * HOUR, rows], [2 * HOUR, rowsW], [2 * HOUR, rowsW]]);
  if (!brk(rs, 4, '[6]')) {
    T('[6] the owner settles once (r1), never again', settles(rs[1], m, S) === 1 && sum(rs, (r) => settles(r, m, S)) === 1 && sum(rs, (r) => soloLbOf(r, S)) === 1);
    T('[6] the third account\'s row is rejected and warned once, then looked at quietly', lines(rs[2], m, /REJECTED \(short\)/) === 1 && lines(rs[3], m, /REJECTED/) === 0 && lines(rs[3], m, /rejected again \(short\)/) === 1,
      rs.map((r) => lines(r, m, /REJECTED|rejected again/)).join('/'));
    T('[6] only the third account is flagged', (sigOf(rs[3], W).f | 0) === 1 && (sigOf(rs[3], S).f | 0) === 0);
  }
}
// ---- [7] the owner's own segment written back after its key left the processed list (Q144) ----
{
  const S = SID(5701), RS = 545700;
  const segS = signedSolo(S, 'q245-replay', RS), m = keyOf(segS);
  const own = { sid: S, d: start7(segS[3], 0, [S], RS) };
  const rows = [own, { sid: S, d: segS, shard: 1 }];
  const drop = (files) => { files.PROCESSED_FILE = (files.PROCESSED_FILE || []).filter((k) => k !== m); return files; };
  const rs = timeline(TREE, [[0, [own], soloSeed([S], RS)], [2 * HOUR, rows], [2 * HOUR, rows, null, drop], [2 * HOUR, rows]]);
  if (!brk(rs, 4, '[7]')) {
    T('[7] settled once (r1)', settles(rs[1], m, S) === 1 && sum(rs, (r) => settles(r, m, S)) === 1 && sum(rs, (r) => soloLbOf(r, S)) === 1);
    T('[7] r2: back in the processed list, nothing settles, counted once', procHas(rs[2], m) && lines(rs[2], m, /processed before/) === 1 && lines(rs[3], m, /processed before/) === 0,
      rs.map((r) => lines(r, m, /processed before/)).join('/'));
  }
}
// ---- [8] unit ----
if (typeof v.soloOwnerGroups !== 'function') bad('[8] the Q245 helpers are not exported (soloOwnerGroups / soloDoneHas / soloReopenOwners / soloDoneT0)');
else {
  const r = (sid) => ({ steamID: sid, d: [] });
  const a = SID(5801), b = SID(5802), c2 = SID(5803);
  eq('[8] soloOwnerGroups: one group per writer, in shard order', v.soloOwnerGroups([r(a), r(b), r(a), r(c2)]).map((g) => g.map((x) => x.steamID)), [[a, a], [b], [c2]]);
  const st = {};
  v.soloDoneNote(st, 'k1', 2099102001, 5000, 'pa');
  v.soloDoneNote(st, 'k1', 2099102001, 7000, 'pb');
  v.soloDoneNote(st, 'k1', 2099102001, 9000, 'pa');
  eq('[8] soloDoneNote: the first owner at the key, the next at key|owner, the same owner refreshed', st, { done: { k1: ['2099102001', 9, 'pa'], 'k1|pb': ['2099102001', 7, 'pb'] } });
  eq('[8] soloDoneNote without an owner = the old whole-key shape', (() => { const s = {}; v.soloDoneNote(s, 'x', 2026100901, 5000); return s; })(), { done: { x: ['2026100901', 5] } });
  eq('[8] soloDoneHas: per owner; a whole-key entry covers every owner', [v.soloDoneHas(st, 'k1', 'pa'), v.soloDoneHas(st, 'k1', 'pb'), v.soloDoneHas(st, 'k1', 'pc'),
    v.soloDoneHas({ done: { k1: ['n', 1] } }, 'k1', 'pc'), v.soloDoneHas({}, 'k1', 'pa'), v.soloDoneHas(null, 'k1', 'pa')], [true, true, false, true, false, false]);
  const pa = v.pid(a), pb = v.pid(b);
  const s2 = { done: { k2: ['n', 100, pa] } };
  eq('[8] soloReopenOwners: the owners of a per-owner key the lane never processed', v.soloReopenOwners(s2, 'k2', [r(a), r(b), r(b)]), [b]);
  eq('[8] soloReopenOwners: none for a whole-key entry, a key with no entry, no state', [v.soloReopenOwners({ done: { k2: ['n', 100] } }, 'k2', [r(b)]), v.soloReopenOwners({ done: {} }, 'k2', [r(b)]), v.soloReopenOwners(null, 'k2', [r(b)])], [[], [], []]);
  // the first owner's entry forgotten (pruneSoloDone: its key verifies no more / the fuse) = closed for everyone, like a key
  //   with no entry -- never a record looked at again on a later owner's entry alone; the later owner stays processed
  eq('[8] soloReopenOwners: a key known only by a later owner\'s entry (the first one pruned) is closed', v.soloReopenOwners({ done: { ['k2|' + pb]: ['n', 100, pb] } }, 'k2', [r(b), r(c2)]), []);
  eq('[8] soloDoneEntry: a later owner\'s entry still found once the first one is pruned', v.soloDoneEntry({ done: { ['k2|' + pb]: ['n', 100, pb] } }, 'k2', pb), ['n', 100, pb]);
  eq('[8] soloDoneT0: the earliest processing of the key (ms), null when none', [v.soloDoneT0({ done: { k3: ['n', 50, pa], ['k3|' + pb]: ['n', 40, pb] } }, 'k3', [r(a), r(b)]), v.soloDoneT0({ done: {} }, 'k3', [r(a)])], [40000, null]);
  // pruneSoloDone forgets each entry by its own key name (a per-owner entry goes with its own signing key)
  const s3 = { done: { k4: ['old', 10, pa], ['k4|' + pb]: ['live', 11, pb] } };
  eq('[8] pruneSoloDone drops a per-owner entry by its own key name', [v.pruneSoloDone(s3, [{ old: { pubs: [], held: [{ pub: 'aa', reason: 'revoked' }] }, live: { pubs: ['bb'], held: [] } }]), Object.keys(s3.done)], [{ gone: 1, fuse: 0 }, ['k4|' + pb]]);
}
// ---- [9] mutation self-check ----
{
  const mut = (tag, from, to) => {
    const t = copyTree(tag); addTestKey(t);
    if (SRC.split(from).length !== 2) { bad('[9] ' + tag + ': the line to mutate was not found exactly once'); return null; }
    fs.writeFileSync(path.join(t, 'validate.js'), SRC.replace(from, to));
    return t;
  };
  const M1 = mut('noreopen', "  const fresh = consistentMatches.filter(c => !processed.has(c.m) || (c.solo && soloReopenOwners(soloState, c.m, c.g).length > 0));",
    "  const fresh = consistentMatches.filter(c => !processed.has(c.m));");
  if (M1) {
    const x = caseLater(M1, 1);
    T('[9] mutant without the reopen: [2] fails (the victim\'s segment never settles)', x.rs.length === 4 && sum(x.rs, (r) => settles(r, x.m, x.S)) === 0 && sum(x.rs, (r) => settles(r, x.m, x.O)) === 1);
    try { fs.rmSync(M1, { recursive: true, force: true }); } catch (e) {}
  }
  const M2 = mut('firstonly', '    for (const g of gs) if (await soloSettleOwner(Object.assign({}, c, { g }))) n++;',
    '    if (await soloSettleOwner(c)) n++;');
  if (M2) {
    const x = caseSameRun(M2, 1);
    T('[9] mutant judging the key as one unit: [1] fails (only the outsider settles)', x.rs.length === 3 && sum(x.rs, (r) => settles(r, x.m, x.O)) === 1 && sum(x.rs, (r) => settles(r, x.m, x.S)) === 0,
      'outsider=' + x.rs.map((r) => settles(r, x.m, x.O)).join('/') + ' victim=' + x.rs.map((r) => settles(r, x.m, x.S)).join('/'));
    try { fs.rmSync(M2, { recursive: true, force: true }); } catch (e) {}
  }
  const M3 = mut('nopace', '    if (!pend && processed.has(m)) { const t0 = soloDoneT0(soloState, m, c.g); if (t0 != null) pend = { t0, reopened: true }; }\n', '');
  if (M3) {
    const x = caseLater(M3, 1);
    const vic = x.rs.map((r) => settles(r, x.m, x.S)).join('/'), ns = sigOf(x.rs[3], x.S).ns | 0;
    // the start entry of a processed key is dropped every run, so a first-sighting clock restarts every run: never paced through
    T('[9] mutant without the reopened pacing start: [2] fails (the victim is deferred every run, a missing-start signal each run)', x.rs.length === 4 && sum(x.rs, (r) => settles(r, x.m, x.S)) === 0 && ns > 0, 'victim=' + vic + ' ns=' + ns);
    try { fs.rmSync(M3, { recursive: true, force: true }); } catch (e) {}
  }
}
try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (solo-lane-owner-key) ===' : '=== PASS -- 0 fail (solo-lane-owner-key) ===');
process.exit(failN ? 1 : 0);
