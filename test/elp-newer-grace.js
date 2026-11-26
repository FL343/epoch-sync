'use strict';
// ============================================================
// elp-newer-grace.js -- cloud audit Q433, second draft (2026-11-25; architecture decision 10): a newer run of the player gives a
//   competitive run up only once RATING.GIVEUP_MS (2 h) passed after the later of the newer run's first sighting and the run's own
//   last segment (validate.js elpGiveUpDue, read by elpRunReady). Before, a newer run gave the run up the very pass the job first
//   saw it, at the depth the run held then, while the run's own last segment was not settled yet: read in that pass and deferred
//   one floor by the one-match-at-a-time rule (the newer run's [0,0] segment is taken first, startDepth order, and claims the
//   account's slot -- 2026-11-24 10:11:50Z: a run to 17, line 17, settled at 15: -11), or not on the shards yet (the guard's retry
//   outbox sends it at the next run start). Of the runs a newer run gave up in the launch weeks and a later segment raised, 117 of
//   120 (not parked) had that segment within 30 min. Folds O1044 1 in: a run still being played (its segments keep coming) is never
//   given up by a run first seen beside it. Waiting gives nothing: a run whose final never comes is given up GIVEUP_MS later at the
//   depth it reached -- the same verdict, later.
//   [0] static pins: the predicate, the anchor, the boundary, the grace (2 h, no shorter than RATING.HOLD_MS, inside IDLE_MS), the
//       export, the two texts the game repo's reward-cron-registry.js pins
//   [1] elpGiveUpDue units: no newer run; the anchor = the newer run's first sighting or the run's own last segment, the later;
//       runs first seen in one pass; the boundary at exactly GIVEUP_MS; an older-version run between is skipped (elpNewerRun's rule),
//       a later version counts; no clock / an anchor from the future: due (as before); through elpRunReady / elpPendingSettles
//   [2] points, the 11-24 shape (pure): the final segment 5 min after the newer run -> the run settles at 20 exactly as with no newer
//       run (a pass); with a grace of 0 (the rule before) it is given up at 15 (a miss)
//   [3] O1044 1 shapes (pure): a run still being played before a run finished in the same pass is not given up while its segments
//       come (settles at its final depth); its segments stop: given up GIVEUP_MS after the last one, at the depth reached; a parked
//       run and a finished run of one pass: both GIVEUP_MS on, the parked one as the rule before did at once; a parked run whose
//       continuation reaches the shards after the next run settles at its final depth
//   [4] main() (the real job, state carried, every clock moved back between runs): a placed player's run to 20 (line 18) whose
//       final segment is writer-paced behind the next run's [0,0] quit (the 11-24 shape) / comes 30 min after it (the retry outbox)
//       settles exactly as the same run with no next run (control), the next run after it; a crash (no final): given up at 15 two
//       hours on with the points the rule before gave at once; the paced shape with ELP_GIVEUP_MS=0 gives the run up at 15
//   [5] property, 4000 random histories: a grace of 0 reads every run as the rule before the grace; the default grace settles a
//       prefix of what a grace of 0 settles at the same instant, and GIVEUP_MS later at least all of it
//   [6] mutations: elpGiveUpDue left out; the anchor without the run's own last segment (or with its first sighting); > for >=; an
//       anchor from the future not due; no version skip; no clock not due
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), harness as test/elp-gap-hold.js.
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH', 'COMP_CHAIN_WAIT_MS', 'COMP_GAP_SETTLE_MS', 'ENDLESS_PACE_FRAC', 'SEASON_NOW',
  'ELP_IDLE_MS', 'ELP_HOLD_MS', 'ELP_GIVEUP_MS', 'ELP_CUTOVER_MS', 'ELP_PUB_VER'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const MIN = 60000, HOUR = 3600 * 1000, DAY = 86400000;
let EXTRA_ENV = {};
// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('7e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099112201;
function copyTree(tag, src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-newer-grace-' + tag + '-'));
  require(path.join(ROOT, 'test', 'root-listing')).copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  if (src != null) fs.writeFileSync(path.join(dir, 'validate.js'), src);
  return dir;
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
function runCron(tree, boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-newer-grace-run-'));
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
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0', ...EXTRA_ENV,
    }, stateEnv);
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
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) { if (so.runs[k].t) so.runs[k].t -= ms; for (const d of Object.keys(so.runs[k].saves || {})) if (so.runs[k].saves[d].t) so.runs[k].saves[d].t -= ms; }
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
    for (const k of Object.keys(so.done || {})) if (Array.isArray(so.done[k])) so.done[k][1] -= Math.floor(ms / 1000);
    // the competitive run history (Q433 repro): first / last seen, save points, the entry clocks, the hold notes (patched tree)
    for (const k of Object.keys(so.hist || {})) {
      const h = so.hist[k];
      if (h.t) h.t -= ms; if (h.ht) h.ht -= ms;
      for (const r of (Array.isArray(h.runs) ? h.runs : [])) {
        if (!Array.isArray(r)) continue;
        if (r[2]) r[2] -= ms; if (r[6]) r[6] -= ms;
        if (Array.isArray(r[9])) for (let i = 0; i + 2 < r[9].length; i += 3) { if (r[9][i + 1]) r[9][i + 1] -= ms; if (r[9][i + 2]) r[9][i + 2] -= ms; }
      }
      if (h.hold) for (const id of Object.keys(h.hold)) h.hold[id] -= ms;
    }
  }
  return files;
}
const LB = { xp: 5, cp: 8, casSolo: 15, couchCas: 20 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const sids = new Set();
  for (const r of recs) { sids.add(r.sid); boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: LB.casSolo, name: 'endless_board_solo', entries: [] }, { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 17, name: 'endless_board_overall', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 18, name: 'endless_comp_couch', entries: [] }, { id: 19, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: 21, name: 'endless_save_box_casual_couch', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs], ...]
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(tree, world(recs), state ? advance(state, ms) : null);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };
// a guard-signed solo segment (attest.js layout attVer 3, as test/solo-chain-keep.js)
function soloSeg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed, 0, 1, 0, 1, 300, o.score == null ? 1000 : o.score, o.disp | 0, lo, hi, o.sd, o.ed, 0, 0, 0, o.flags | 0,
    KEY_ID, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}



let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const js = (x) => JSON.stringify(x);
// a copy of validate.js (src, or the file itself) loaded in this process with env set while it loads (RATING reads it then)
function load(src, env) {
  const R = ROOT.replace(/\\/g, '/');
  const m = (src == null ? SRC : src).replace(/require\('\.\//g, "require('" + R + '/').replace(/__dirname/g, JSON.stringify(R));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-newer-grace-load-'));
  const p = path.join(dir, 'validate.js');
  fs.writeFileSync(p, m);
  const keep = {};
  for (const k of Object.keys(env || {})) { keep[k] = process.env[k]; process.env[k] = env[k]; }
  try { return require(p); } finally {
    for (const k of Object.keys(env || {})) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}
const mutate = (from, to) => { const n = SRC.split(from).length - 1; if (n !== 1) throw new Error('mutation anchor found ' + n + 'x: ' + from.slice(0, 120)); return SRC.split(from).join(to); };
const V0 = load(null, { ELP_GIVEUP_MS: '0' });   // the same rules with a grace of 0
// the rule before the grace: elpRunReady without elpGiveUpDue (a grace of 0 must read exactly so, [5])
const VPRE = load(mutate('newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs) && !held,', 'newer = elpNewerRun(h, i) && !held,'));
const G = v.RATING.GIVEUP_MS;

console.log('=== Q433 second draft: a newer run gives a run up only after a grace (elpGiveUpDue; O1044 1) ===');
// ---- [0] static pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 140));
  pin('elpRunReady: a newer run counts once its grace passed (and the hold of Q433 is off)', 'newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs) && !held,');
  pin('elpGiveUpDue: the anchor = the first run elpNewerRun counts, first seen, or the run\'s own last segment, the later', 'const at = Math.max(Number(h.runs[k][2]) || 0, Number(r[6] || r[2]) || 0);');
  pin('elpGiveUpDue: due once GIVEUP_MS passed (an anchor from the future: due)', 'return !(at <= nowMs) || nowMs - at >= RATING.GIVEUP_MS;');
  pin('the grace: env ELP_GIVEUP_MS, 2 h by default', "GIVEUP_MS: Number(process.env.ELP_GIVEUP_MS || 2 * 3600000),");
  T('[0] RATING.GIVEUP_MS = 2 h: no shorter than RATING.HOLD_MS (a hold note of Q433 runs out inside it, [5]) and well inside IDLE_MS (24 h)',
    G === 2 * HOUR && G >= v.RATING.HOLD_MS && G < v.RATING.IDLE_MS, String(G));
  T('[0] elpGiveUpDue exported', typeof v.elpGiveUpDue === 'function');
  // the game repo's mvp/test/reward-cron-registry.js pins these two texts of validate.js: they stay
  T('[0] the texts the game repo pins (reward-cron-registry.js) are still there', SRC.indexOf('nowMs - (r[6] || r[2] || 0) >= RATING.IDLE_MS') > 0 && SRC.indexOf('newer = elpNewerRun(h, i)') > 0);
  T('[0] a grace of 0 loads as 0 (env)', V0.RATING.GIVEUP_MS === 0);
}

// ---- [1] elpGiveUpDue units ----
const t0 = 1795528957049;
const V7 = 4, V8 = 16;   // validate.js ELP_R_V7 / ELP_R_V8 (r[7])
const run = (id, depth, seen, flags, last) => [id, depth, seen, 0, 0, 0, last == null ? seen : last, flags | 0, id];
function units(vv) {
  const GG = vv.RATING.GIVEUP_MS, o = {};
  const due = (runs, i, now) => vv.elpGiveUpDue({ runs }, i, now);
  o.alone = due([run(1, 5, t0)], 0, t0) === true;   // no run after it (elpNewerRun is false then anyway)
  // the newer run first seen 30 min after the run's last segment: the anchor is the newer run
  let rs = [run(1, 5, t0, 0, t0 + 10 * MIN), run(2, 0, t0 + 30 * MIN, 1)];
  o.byNewer = due(rs, 0, t0 + 30 * MIN) === false && due(rs, 0, t0 + 30 * MIN + GG - 1) === false && due(rs, 0, t0 + 30 * MIN + GG) === true;
  // the run's own segment 30 min after the newer run's first sighting (still being played): the anchor is that segment
  rs = [run(1, 5, t0, 0, t0 + HOUR), run(2, 0, t0 + 30 * MIN, 1)];
  o.byOwn = due(rs, 0, t0 + 30 * MIN + GG) === false && due(rs, 0, t0 + HOUR + GG - 1) === false && due(rs, 0, t0 + HOUR + GG) === true;
  // first seen in one pass (O1044 1): the anchor is that pass
  rs = [run(1, 5, t0), run(2, 0, t0, 1)];
  o.samePass = due(rs, 0, t0) === false && due(rs, 0, t0 + GG) === true;
  // a version 7 run, then a version 6 run first seen 10 min on (an old client: elpNewerRun does not count it), then a version 7
  //   run 3 h on: the anchor is the version 7 run
  rs = [run(1, 5, t0, V7), run(2, 3, t0 + 10 * MIN, 1), run(3, 0, t0 + 3 * HOUR, 1 | V7)];
  o.verSkip = due(rs, 0, t0 + 3 * HOUR + HOUR) === false && due(rs, 0, t0 + 3 * HOUR + GG) === true;
  rs = [run(1, 5, t0, V7), run(2, 3, t0 + 10 * MIN, 1 | V8)];   // a later version counts
  o.verLater = due(rs, 0, t0 + 10 * MIN + GG - 1) === false && due(rs, 0, t0 + 10 * MIN + GG) === true;
  // no clock / an anchor from the future (a damaged file): due, as before
  rs = [run(1, 5, t0), run(2, 0, t0 + 5 * HOUR, 1)];
  o.future = due(rs, 0, t0) === true && due([run(1, 5, t0, 0, t0 + 5 * HOUR), run(2, 0, t0, 1)], 0, t0) === true;
  o.noClock = due([run(1, 5, t0), run(2, 0, t0, 1)], 0, null) === true;
  // through elpRunReady: the final segment settles at once whatever the grace; a newer run once the grace passed; a run with no
  //   newer run by the idle rule as before
  rs = [run(1, 5, t0), run(2, 0, t0, 1)];
  o.ready = vv.elpRunReady({ runs: rs }, 0, t0 + GG - 1) === false && vv.elpRunReady({ runs: rs }, 0, t0 + GG) === true &&
    vv.elpRunReady({ runs: [run(1, 5, t0, 1), run(2, 0, t0, 1)] }, 0, t0) === true &&
    vv.elpRunReady({ runs: [run(1, 5, t0)] }, 0, t0 + vv.RATING.IDLE_MS) === true && vv.elpRunReady({ runs: [run(1, 5, t0)] }, 0, t0 + vv.RATING.IDLE_MS - 1) === false;
  // the run behind waits in start order
  o.behind = js([...vv.elpPendingSettles({ runs: rs }, t0 + GG - 1)]) === '[]' && js([...vv.elpPendingSettles({ runs: rs }, t0 + GG)]) === '[0,1]';
  return o;
}
const U = units(v);
for (const k of Object.keys(U)) T('[1] elpGiveUpDue / elpRunReady: ' + k, U[k] === true);

// ---- [2] points, the 11-24 shape (pure) ----
const F = A.SEG_FINAL, SUSP = A.SEG_SUSPENDED, T0 = Date.UTC(2026, 10, 1), t1 = T0 + 2 * DAY;
function placedOf(vv, p) { const st = {}; [20, 20, 20, 20, 20].forEach((d, i) => { vv.ratingHistUpsert(st, p, 'solo', 0, 100 + i, d, T0 + i * 60000, F, 500 + i); vv.elpSettleAll(st, 0, T0 + i * 60000 + 1000); }); return st; }
const runIn = (vv, st, p, id) => { const h = st.hist[vv.ratingHistKey(p, 'solo', 0)]; return h.runs.find((x) => (x[0] >>> 0) === id) || null; };
// passes every 5 min from `from` to `to`; ev[t] = function (st) adding segments at that pass; returns the first pass that settled each id
function passes(vv, st, from, to, ev, ids, p) {
  const first = {};
  for (let t = from; t <= to; t += 5 * MIN) {
    if (ev[t]) ev[t](st);
    vv.elpSettleAll(st, 0, t);
    for (const id of ids) { const r = runIn(vv, st, p, id); if (r && r[3] && !first[id]) first[id] = { at: t, r: r.slice(1, 6) }; }
  }
  return first;
}
function points(vv) {
  const p = vv.pid('76561198000099998');
  const up = (id, d, t, fl, seed, lv) => (st) => vv.ratingHistUpsert(st, p, 'solo', 0, id, d, t, fl, seed, lv);
  // run 200 reached 15 (that segment settled at t1); its final segment to 20 settles 65 min on. Control: nothing else
  const c = placedOf(vv, p); up(200, 15, t1, 0, 600)(c);
  const ctl = passes(vv, c, t1 + 5 * MIN, t1 + 4 * HOUR, { [t1 + 65 * MIN]: up(200, 20, t1 + 65 * MIN, F, 600) }, [200], p);
  // the shape: the next run (quit at 0) settles 5 min before that final segment (its [0,0] took the slot, the final waited a floor)
  const s = placedOf(vv, p); up(200, 15, t1, 0, 600)(s);
  const shp = passes(vv, s, t1 + 5 * MIN, t1 + 4 * HOUR, {
    [t1 + 60 * MIN]: up(201, 0, t1 + 60 * MIN, F, 601, { quit: true }),
    [t1 + 65 * MIN]: up(200, 20, t1 + 65 * MIN, F, 600),
  }, [200, 201], p);
  return { ctl: ctl[200], a: shp[200], b: shp[201] };
}
{
  const P1 = points(v), P0 = points(V0);
  T('[2] control: the run settles at 20 when its final segment comes, a pass (d > 0)', !!P1.ctl && P1.ctl.at === t1 + 65 * MIN && P1.ctl.r[0] === 20 && P1.ctl.r[3] > 0, js(P1.ctl));
  T('[2] the next run 5 min before the final segment: the run still settles at 20 exactly as the control, the next run after it in the same pass',
    !!P1.a && P1.a.at === P1.ctl.at && js(P1.a.r) === js(P1.ctl.r) && !!P1.b && P1.b.at === P1.a.at, js(P1));
  T('[2] ... with a grace of 0 (the rule before): given up at 15 the pass the next run came, a miss (the bug)', !!P0.a && P0.a.at === t1 + 60 * MIN && P0.a.r[0] === 15 && P0.a.r[3] < 0, js(P0.a));
}

// ---- [3] O1044 1 shapes (pure) ----
function o1044(vv) {
  const p = vv.pid('76561198000099997'), GG = vv.RATING.GIVEUP_MS;
  const up = (id, d, t, fl, seed) => (st) => vv.ratingHistUpsert(st, p, 'solo', 0, id, d, t, fl, seed);
  const ta = t1;
  const o = {};
  // (a) alive: run 300 (being played) and run 301 (finished, quit early) first seen in one pass, 300 first in the list; 300's
  //   segments every 15 min, its final at 3 h (depth 65)
  let st = placedOf(vv, p); up(300, 5, ta, 0, 700)(st); up(301, 0, ta, F, 701)(st);
  let ev = {};
  for (let k = 1; k <= 12; k++) ev[ta + k * 15 * MIN] = up(300, 5 + 5 * k, ta + k * 15 * MIN, k === 12 ? F : 0, 700);
  o.alive = passes(vv, st, ta, ta + 5 * HOUR, ev, [300, 301], p);
  // (b) the same, but its segments stop after 1 h (a crash at depth 25)
  st = placedOf(vv, p); up(300, 5, ta, 0, 700)(st); up(301, 0, ta, F, 701)(st);
  ev = {};
  for (let k = 1; k <= 4; k++) ev[ta + k * 15 * MIN] = up(300, 5 + 5 * k, ta + k * 15 * MIN, 0, 700);
  o.crash = passes(vv, st, ta, ta + 5 * HOUR, ev, [300, 301], p);
  // (c) a parked run (save point at 10) and a finished run first seen in one pass: nothing more comes
  st = placedOf(vv, p); up(300, 10, ta, SUSP, 700)(st); up(301, 0, ta, F, 701)(st);
  o.parked = passes(vv, st, ta, ta + 5 * HOUR, {}, [300, 301], p);
  // (d) a parked run (save point at 10), the next run 10 min on; the run's continuation (played before the next run, sent by the
  //   retry outbox) reaches the shards 40 / 70 min on: [10,15], then its final [15,20]
  st = placedOf(vv, p); up(300, 10, ta, SUSP, 700)(st);
  o.resumed = passes(vv, st, ta, ta + 5 * HOUR, { [ta + 10 * MIN]: up(301, 0, ta + 10 * MIN, F, 701), [ta + 40 * MIN]: up(300, 15, ta + 40 * MIN, 0, 700), [ta + 70 * MIN]: up(300, 20, ta + 70 * MIN, F, 700) }, [300, 301], p);
  o.GG = GG;
  return o;
}
{
  const O = o1044(v), Z = o1044(V0);
  T('[3] a run still being played, a finished run first seen beside it after it: not given up while its segments come; settles at its final depth 65 when the final comes, the other run after it',
    !!O.alive[300] && O.alive[300].at === t1 + 3 * HOUR && O.alive[300].r[0] === 65 && !!O.alive[301] && O.alive[301].at === O.alive[300].at, js(O.alive));
  T('[3] ... with a grace of 0: given up at 5 in the pass that first saw both (O1044 1, the bug)', !!Z.alive[300] && Z.alive[300].at === t1 && Z.alive[300].r[0] === 5, js(Z.alive[300]));
  T('[3] its segments stop at 1 h (depth 25): given up GIVEUP_MS after its last segment, at 25, the other run with it',
    !!O.crash[300] && O.crash[300].at >= t1 + HOUR + G && O.crash[300].at < t1 + HOUR + G + 5 * MIN && O.crash[300].r[0] === 25 && !!O.crash[301] && O.crash[301].at === O.crash[300].at, js(O.crash));
  T('[3] a parked run and a finished run of one pass: both settle GIVEUP_MS on (the parked one at its save depth 10, as the rule before did at once)',
    !!O.parked[300] && O.parked[300].at === t1 + G && O.parked[300].r[0] === 10 && !!O.parked[301] && O.parked[301].at === t1 + G &&
    !!Z.parked[300] && Z.parked[300].at === t1 && js(Z.parked[300].r) === js(O.parked[300].r), js({ O: O.parked, Z: Z.parked }));
  T('[3] a parked run whose continuation reaches the shards after the next run (inside the grace): settles at its final depth 20',
    !!O.resumed[300] && O.resumed[300].at === t1 + 70 * MIN && O.resumed[300].r[0] === 20 && !!O.resumed[301] && O.resumed[301].at === O.resumed[300].at, js(O.resumed));
  T('[3] ... with a grace of 0: given up at its save depth 10 when the next run came', !!Z.resumed[300] && Z.resumed[300].at === t1 + 10 * MIN && Z.resumed[300].r[0] === 10, js(Z.resumed[300]));
}

// ---- [4] main() ----
const S = SID(4332), P = v.pid(S);
function placedSolo(at) {
  const st = { runs: {}, wait: {}, ms: {} };
  [20, 20, 20, 20, 20].forEach((d, i) => { v.ratingHistUpsert(st, P, 'solo', 0, 100 + i, d, at + i * 60000, A.SEG_FINAL, 500 + i); v.elpSettleAll(st, 0, at + i * 60000 + 1000); });
  return st;
}
const runIdOf = (rs) => v.ratingRunId(v.soloRunKey(P, 0, rs));
function runOf(state, rs) { const h = ((state.SOLO_FILE || {}).hist || {})[P + '|solo|0']; return h ? (h.runs.find((r) => (r[0] >>> 0) === runIdOf(rs)) || null) : null; }
const recs = (seg, sh) => [{ sid: S, d: start7(seg[3], S, seg[4]), shard: sh }, { sid: S, d: seg, shard: sh + 1 }];
function play(tree, steps) {
  const outR = []; let state = { SOLO_FILE: placedSolo(Date.now() - 30 * DAY) };
  for (const [ms, rr] of steps) {
    const r = runCron(tree, world(rr), advance(state, ms));
    outR.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return outR;
}
const RS_A = 433115, RS_B = 433102;   // run A: target offset -2 (line 18 for this player): 20 passes, 15 misses
const a0 = soloSeg({ sid: S, id: 'q433g-a0', runSeed: RS_A, sd: 0, ed: 5, flags: 0 });
const a1 = soloSeg({ sid: S, id: 'q433g-a1', runSeed: RS_A, sd: 5, ed: 10, flags: 0 });
const a2 = soloSeg({ sid: S, id: 'q433g-a2', runSeed: RS_A, sd: 10, ed: 15, flags: 0 });
const a3 = soloSeg({ sid: S, id: 'q433g-a3', runSeed: RS_A, sd: 15, ed: 20, flags: A.SEG_FINAL });   // its last segment
const b0 = soloSeg({ sid: S, id: 'q433g-b0', runSeed: RS_B, sd: 0, ed: 0, flags: A.SEG_FINAL, disp: A.DISP_USER_QUIT });   // the next run, quit at 0
const HEAD = recs(a0, 0), MID = recs(a1, 2).concat(recs(a2, 6)), FSTART = [{ sid: S, d: start7(a3[3], S, a3[4]), shard: 4 }], FSEG = [{ sid: S, d: a3, shard: 5 }], BRUN = recs(b0, 8);
// the head settles, then [5,10] + [10,15] (one pass: deferred, the next: both), then the final segment's start row
const BEFORE = [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(MID)], [10 * MIN, HEAD.concat(MID)], [5 * MIN, HEAD.concat(MID, FSTART)]];
const ALL = HEAD.concat(MID, FSTART, FSEG), NOF = HEAD.concat(MID, FSTART, BRUN);
const SCEN = {
  control: (t) => play(t, BEFORE.concat([[5 * MIN, ALL], [5 * MIN, ALL]])),
  // the 11-24 shape: the final segment and the next run's [0,0] first seen in one pass; the [0,0] takes the slot, the final waits a floor
  paced: (t) => play(t, BEFORE.concat([[5 * MIN, ALL.concat(BRUN)], [5 * MIN, ALL.concat(BRUN)]])),
  // the final segment comes 30 min after the next run (the retry outbox sends it at the next start)
  outbox: (t) => play(t, BEFORE.concat([[5 * MIN, NOF], [30 * MIN, ALL.concat(BRUN)], [5 * MIN, ALL.concat(BRUN)]])),
  // the final segment never comes (a crash)
  crash: (t) => play(t, BEFORE.concat([[5 * MIN, NOF], [HOUR, NOF], [HOUR + 5 * MIN, NOF]])),
};
const snap = (r, rs) => { const x = runOf(r.state, rs); return x ? { depth: x[1], settled: x[3], d: x[4], T: x[5] } : null; };
const codes = (rs) => rs.map((r) => r.code).join('');
function judge(tree) {
  const R = {};
  for (const k of Object.keys(SCEN)) { const rs = SCEN[k](tree); R[k] = { codes: codes(rs), steps: rs.map((r) => ({ A: snap(r, RS_A), B: snap(r, RS_B), paced: /writer-pacing .*deferred/.test(r.out) })) }; }
  return R;
}
{
  const TREE = copyTree('fix');
  const J = judge(TREE);
  EXTRA_ENV = { ELP_GIVEUP_MS: '0' };
  const J0 = { paced: { steps: SCEN.paced(TREE).map((r) => ({ A: snap(r, RS_A) })) }, crash: { steps: SCEN.crash(TREE).map((r) => ({ A: snap(r, RS_A) })) } };
  EXTRA_ENV = {};
  fs.rmSync(TREE, { recursive: true, force: true });
  const lastOf = (k, w) => J[k].steps[J[k].steps.length - 1][w];
  const c = lastOf('control', 'A');
  const neverLow = (k) => J[k].steps.every((s) => !(s.A && s.A.settled && s.A.depth < 20));
  const like = (x) => !!x && !!c && x.settled === 2 && x.depth === 20 && x.d === c.d && x.T === c.T;
  T('[4] control: every run exit 0, run A passes at 20 (line 18)', /^0+$/.test(J.control.codes) && !!c && c.settled === 2 && c.depth === 20 && c.d > 0 && c.T === 18, js(J.control));
  T('[4] paced (the 11-24 shape): the final segment is writer-paced behind the next run [0,0]; run A waits (not given up at 15) and settles as the control; the next run after it',
    /^0+$/.test(J.paced.codes) && J.paced.steps[5].paced && !J.paced.steps[5].A.settled && neverLow('paced') && like(lastOf('paced', 'A')) && lastOf('paced', 'B').settled === 2, js(J.paced));
  T('[4] outbox: the final segment 30 min after the next run -- run A settles as the control', /^0+$/.test(J.outbox.codes) && neverLow('outbox') && like(lastOf('outbox', 'A')) && lastOf('outbox', 'B').settled === 2, js(J.outbox));
  const cr = J.crash.steps, z = J0.crash.steps;
  T('[4] crash (no final segment): run A not given up the first hour; given up at 15 two hours after the next run, with the points the rule before gave at once',
    /^0+$/.test(J.crash.codes) && !cr[5].A.settled && !cr[6].A.settled && cr[7].A.settled === 2 && cr[7].A.depth === 15 &&
    !!z[5].A && z[5].A.settled === 2 && z[5].A.depth === 15 && z[5].A.d === cr[7].A.d && z[5].A.T === cr[7].A.T, js({ grace: cr.slice(5).map((s) => s.A), zero: z.slice(5).map((s) => s.A) }));
  T('[4] paced with ELP_GIVEUP_MS=0 (the rule before): run A given up at 15, a miss (the bug this file guards)',
    !!J0.paced.steps[5].A && J0.paced.steps[5].A.settled === 2 && J0.paced.steps[5].A.depth === 15 && J0.paced.steps[5].A.d < 0, js(J0.paced.steps.slice(5)));
}

// ---- [5] property: random histories ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
{
  const rnd = rng(433002);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let n = 0, eqBad = [], prefBad = [], laterBad = [];
  for (let it = 0; it < 4000; it++) {
    const now = t0 + Math.floor(rnd() * 3 * DAY);
    const m = 1 + Math.floor(rnd() * 6), runs = [];
    let seen = now - Math.floor(rnd() * 3 * DAY);
    for (let k = 0; k < m; k++) {
      seen = Math.min(now, seen + (rnd() < 0.3 ? 0 : Math.floor(rnd() * 8 * HOUR)));   // first-seen order; some in one pass
      const last = Math.min(now, seen + (rnd() < 0.4 ? 0 : Math.floor(rnd() * 10 * HOUR)));
      const fl = pick([0, 0, 0, 1, 2]) | pick([0, V7, V8, V7]);
      const r = [100 + k, Math.floor(rnd() * 40), seen, 0, 0, 0, last, fl, 100 + k];
      runs.push(r);
    }
    for (let k = 0; k < m && rnd() < 0.5; k++) runs[k][3] = 2;   // a settled prefix
    const hold = {};
    if (rnd() < 0.3) { const r = pick(runs); hold[String(r[0])] = now - Math.floor(rnd() * 3 * HOUR); }
    const h = () => ({ runs: runs.map((r) => r.slice()), hold: Object.assign({}, hold) });
    for (let i = 0; i < m; i++) { n++; if (V0.elpRunReady(h(), i, now) !== VPRE.elpRunReady(h(), i, now)) eqBad.push(it + ':' + i); }
    const pz = [...V0.elpPendingSettles(h(), now)], pg = [...v.elpPendingSettles(h(), now)];
    if (js(pg) !== js(pz.slice(0, pg.length))) prefBad.push(it);
    const pl = [...v.elpPendingSettles(h(), now + G)];
    if (js(pl.slice(0, pz.length)) !== js(pz)) laterBad.push(it);
  }
  T('[5] a grace of 0 reads every run exactly as the rule before the grace (' + n + ' runs of 4000 random histories, holds, versions, parked)', eqBad.length === 0, eqBad.slice(0, 10).join(' '));
  T('[5] the default grace settles a prefix of what a grace of 0 settles at the same instant (never more, never another order)', prefBad.length === 0, prefBad.slice(0, 10).join(' '));
  T('[5] ... and GIVEUP_MS later at least all of it (the same verdict, later)', laterBad.length === 0, laterBad.slice(0, 10).join(' '));
}

// ---- [6] mutations ----
const MUT = [
  ['elpGiveUpDue left out of elpRunReady', 'newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs) && !held,', 'newer = elpNewerRun(h, i) && !held,'],
  ['the anchor without the run\'s own last segment', 'const at = Math.max(Number(h.runs[k][2]) || 0, Number(r[6] || r[2]) || 0);', 'const at = Number(h.runs[k][2]) || 0;'],
  ['> for >= at the boundary', 'nowMs - at >= RATING.GIVEUP_MS;', 'nowMs - at > RATING.GIVEUP_MS;'],
  ['an anchor from the future not due', 'return !(at <= nowMs) || nowMs - at >= RATING.GIVEUP_MS;', 'return nowMs - at >= RATING.GIVEUP_MS;'],
  ['no version skip (the next run in the list, whatever its version)', '  while (k < h.runs.length && elpRunVer(h.runs[k]) < v) k++;', ''],
  ['no clock: not due', '  if (nowMs == null) return true;\n  const r = h.runs[i], v = elpRunVer(r);', '  if (nowMs == null) return false;\n  const r = h.runs[i], v = elpRunVer(r);'],
  ['the grace counted from the run\'s first sighting, not its last segment', 'Number(r[6] || r[2]) || 0', 'Number(r[2]) || 0'],
];
for (const [label, from, to] of MUT) {
  let red = false, why = '';
  try {
    const vm = load(mutate(from, to));
    const u = units(vm); const bad = Object.keys(U).filter((k) => u[k] !== U[k]);
    if (bad.length) { red = true; why = 'units ' + bad.join(','); }
    if (!red) { const pt = points(vm); if (!(pt.a && pt.ctl && pt.a.at === pt.ctl.at && js(pt.a.r) === js(pt.ctl.r))) { red = true; why = 'points ' + js(pt.a); } }
    if (!red) { const o = o1044(vm); if (!(o.alive[300] && o.alive[300].r[0] === 65)) { red = true; why = 'O1044 ' + js(o.alive[300]); } }
  } catch (e) { red = false; why = 'threw: ' + String(e && e.message).slice(0, 200); }
  T('[6] mutant "' + label + '" turns this file red', red, why);
}

if (failN) { console.log('FAIL (elp-newer-grace) ' + failN); process.exit(1); } else console.log('ALL PASS (elp-newer-grace)');
