'use strict';
// ============================================================
// elp-gap-hold.js -- cloud audit Q433 (2026-11-25; architecture decision 10): a competitive solo / couch run whose middle segment is
//   late (the guard's retry outbox) or lost (written over on the shards) holds only its chain head in the run history while its
//   later segments wait in the solo lane (Q428 settles them on their own once the gap window ran out). Before: 24 h without a
//   settled segment, a newer run of his, or the version cutover settled the run at its chain head meanwhile -- a run that reached
//   its line read as a miss (a placed player, a run to 20, line 18: -13 instead of +68), and the later segments raised its depth
//   with its points gone. Now the solo lane notes the run every pass a segment of it waits (inside the gap window) or is chained
//   and deferred (pacing / a board unresolved) -- validate.js elpHoldNote, the entry's hold[runId] -- and elpRunReady settles a
//   run noted within RATING.HOLD_MS on its final segment only; a segment of the run that settles takes a note of an earlier pass
//   away (ratingHistUpsert), so a deferral that ended leaves nothing behind.
//   Second draft (same day): a newer run gives a run up only once RATING.GIVEUP_MS passed after the later of the newer run's first
//   sighting and the run's own last segment (elpGiveUpDue; its own file test/elp-newer-grace.js). The shapes below that end with a
//   newer run giving a run up now move on by that grace first.
//   [0] static pins: the predicate (final first, the hold only on newer / idle / cut), the three lane sites, the lane's skip of
//       casual / classic / couch casual / the trial channel, the gap-window bound, the history family (couch: couchRatingFam),
//       the one caller of elpHoldNote, the clear in ratingHistUpsert, elpTrim's prune, the summary row
//   [1] pure units: elpHoldNote (notes an unsettled, unfinished run of an existing entry only; prunes stale notes), elpRunHeld
//       (inside HOLD_MS only; a note from the future / no clock: not held), elpRunReady (a held run: not by idle / newer / cutover,
//       still by its final segment; the hold past HOLD_MS: the old rules), elpPendingSettles (the run behind a held one waits),
//       elpTrim (notes of settled / gone runs leave, an empty map goes), ratingHistUpsert (a settled segment takes a note of an
//       earlier pass away, one of this pass stays)
//   [2] pure points: a placed player's run [0,5] + its later segments waiting, the lane's notes every 5 min through the idle time:
//       nothing settles until the final segment raises it to 20 -> the no-gap result (+83 at T 20); without the notes it settles
//       at 5 (-10, the bug); a newer run behind it waits too, then both settle in order
//   [3] main() (the real job, state carried, every clock moved back between runs): idle / a newer run / a late predecessor ->
//       the run settles at 20 exactly as the same run with no gap (control); a deferred segment (pacing, a board unresolved) holds
//       it too; a resume whose save point never came (save-orphan: never settled on its own) holds it only inside the gap window,
//       then the run settles at its head as before; a segment deferred by pacing that then settles leaves no hold: a newer run gives
//       the run up in the same pass as before
//   [4] mutations: the predicate without the hold; the hold left off a newer run / the idle settle / the cutover (each); the hold
//       over the final segment too; each of the three lane sites (the wait, pacing, the board); the gap-window bound; a hold that
//       never ends; a note on a settled run; no clear when a segment settles; elpTrim without its prune
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), harness as test/solo-gap-settle.js.
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

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
// a mutated copy of validate.js, loaded in this process (requires point at the real tree)
function load(src) {
  const R = ROOT.replace(/\\/g, '/');
  const m = src.replace(/require\('\.\//g, "require('" + R + '/').replace(/__dirname/g, JSON.stringify(R));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-gap-hold-load-'));
  const p = path.join(dir, 'validate.js');
  fs.writeFileSync(p, m);
  try { return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const mutate = (from, to) => { const n = SRC.split(from).length - 1; if (n !== 1) throw new Error('mutation anchor found ' + n + 'x: ' + from.slice(0, 120)); return SRC.split(from).join(to); };

console.log('=== Q433: a competitive run a segment of which still waits is not settled at its chain head meanwhile ===');
// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('7e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099112201;
function copyTree(tag, src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-gap-hold-' + tag + '-'));
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-gap-hold-run-'));
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
function world(recs, noCp) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const sids = new Set();
  for (const r of recs) { sids.add(r.sid); boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, ...(noCp ? [] : [{ id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) }]),
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
// a guard-signed casual couch segment of sid (attest.js A3 layout, as test/couch-casual-settle.js)
function couchSeg(sid, id, runSeed, o) {
  const n = o.n || 2;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (let i = 0; i < n; i++) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed, 0, 0, 0, o.flags == null ? (A.SEG_CASUAL | A.SEG_COUCH) : o.flags, 0, 0, 0, 0, 0, 0);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), KEY_ID, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}

// ---- [0] static pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 140));
  pin('elpRunReady: the hold read once (a newer run: after its grace too, Q433 second draft)', 'const r = h.runs[i], held = elpRunHeld(h, r, nowMs), newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs) && !held, idle = nowMs != null && nowMs - (r[6] || r[2] || 0) >= RATING.IDLE_MS && !held;');
  pin('elpRunReady: the final segment settles whatever is held, the cutover not while held', 'return !!(((r[7] | 0) & 1) || newer || (idle && !((r[7] | 0) & 2)) || (cut && !held));');
  pin('the lane: a segment waiting for its chain notes its run', "    if (plan.ok === null) elpHold(true);   // waiting for its chain (logged just below)\n    if (plan.ok === null) { console.log('  solo ' + m");
  pin('the lane: a chained segment left pending (a board unresolved) notes its run', "{ elpHold(false); console.log('  ' + laneTag + ' ' + m + ': cp/'");
  pin('the lane: a chained segment deferred by pacing notes its run', "      elpHold(false);\n      console.log('  solo-pacing ' + m");
  T('[0] the lane notes at those three sites only (one match at a time: the line stays as test/writer-pacing.js pins it)', SRC.split('elpHold(true)').length === 2 && SRC.split('elpHold(false)').length === 3 &&
    SRC.indexOf('    if (writerPaced(m, [sid], pend.t0, reqMs)) return false;\n    if (scInWin) {') > 0);
  pin('ratingHistUpsert: a settled segment takes a note of an earlier pass away', "if (h.hold && typeof h.hold === 'object' && Number(h.hold[String(runId)]) < nowMs) { delete h.hold[String(runId)]; if (!Object.keys(h.hold).length) delete h.hold; }");
  pin('competitive runs only (casual / classic / couch casual have no run history; the trial channel keeps none)', 'if (PT_MODE || casual || classic || ccCas) return;');
  pin('a wait holds only inside the gap window (past it the job settles nothing of it by itself: save-orphan / held by the key policy aside)',
    'if (waiting && !(nowMs - ((soloState.wait[m] && soloState.wait[m].t0) || nowMs) <= Math.min(COMP.GAP_SETTLE_MS, COMP.CHAIN_WAIT_MS))) return;');
  pin('the note names the entry and run its settle raises (couch: couchRatingFam, solo: solo; ratingRunId of the chain key)',
    "elpHoldNote(soloState, p, cc ? couchRatingFam() : 'solo', f.seasonId, ratingRunId(key), nowMs)");
  T('[0] ... the same two the settle raises', SRC.indexOf('ratingHistUpsert(soloState, p, couchRatingFam(), f.seasonId, ratingRunId(key), f.endDepth') > 0 &&
    SRC.indexOf("ratingHistUpsert(soloState, p, 'solo', f.seasonId, ratingRunId(key), f.endDepth") > 0);
  const callers = SRC.split('\n').filter((l) => /elpHoldNote\(/.test(l) && !/^\s*\/\//.test(l) && !/^function /.test(l));
  T('[0] elpHoldNote has one caller (the solo lane): no other lane holds a run (the team lanes: no signature, no gap settle)', callers.length === 1, callers.map((l) => l.trim().slice(0, 100)).join(' || '));
  pin('elpTrim: the notes of settled / gone runs leave', "    for (const k of Object.keys(h.hold)) if (!h.runs.some((r) => !r[3] && String(r[0] >>> 0) === k)) delete h.hold[k];");
  pin('summary row', "'| competitive solo / couch runs a segment of which waits or is deferred: not settled by 24 h idle / a newer run / the cutover meanwhile (Q433) | ' + s('elpHeld', 0) + ' |',");
  T('[0] RATING.HOLD_MS 2 h (well inside IDLE_MS: one missed pass never lets a run go)', v.RATING.HOLD_MS === 2 * HOUR && v.RATING.HOLD_MS < v.RATING.IDLE_MS, String(v.RATING.HOLD_MS));
}

// ---- [1] pure units ----
const t0 = 1795528957049;
const run = (id, depth, seen, flags) => [id, depth, seen, 0, 0, 0, seen, flags | 0, id];
function units(vv) {
  const H0 = vv.RATING.HOLD_MS, IDLE = vv.RATING.IDLE_MS;
  const st = () => ({ hist: { 'p|solo|0': { best: [0, 0], runs: [run(1, 5, t0, 0)], old: [], t: t0 } } });
  const E = (s) => s.hist['p|solo|0'];
  const o = {};
  let s = st();
  o.notes = vv.elpHoldNote(s, 'p', 'solo', 0, 1, t0 + 1000) === true && !!E(s).hold && E(s).hold['1'] === t0 + 1000;
  s = st(); o.noEntry = vv.elpHoldNote(s, 'q', 'solo', 0, 1, t0) === false && !s.hist['q|solo|0'] && vv.elpHoldNote(s, 'p', 'duo', 0, 1, t0) === false && !s.hist['p|duo|0'];
  s = st(); o.noRun = vv.elpHoldNote(s, 'p', 'solo', 0, 2, t0) === false && !E(s).hold;
  s = st(); E(s).runs[0][3] = 2; o.settledNot = vv.elpHoldNote(s, 'p', 'solo', 0, 1, t0) === false && !E(s).hold;
  s = st(); E(s).runs[0][7] = 1; o.finalNot = vv.elpHoldNote(s, 'p', 'solo', 0, 1, t0) === false && !E(s).hold;
  s = st(); E(s).runs.push(run(2, 5, t0, 0)); E(s).hold = { 2: t0 - H0, 9: t0 - 5 };
  vv.elpHoldNote(s, 'p', 'solo', 0, 1, t0); o.prunesStale = !('2' in E(s).hold) && E(s).hold['9'] === t0 - 5 && E(s).hold['1'] === t0;
  const h = { runs: [run(1, 5, t0, 0)], hold: { 1: t0 } };
  o.heldIn = vv.elpRunHeld(h, h.runs[0], t0) && vv.elpRunHeld(h, h.runs[0], t0 + H0 - 1);
  o.heldOut = !vv.elpRunHeld(h, h.runs[0], t0 + H0);
  { const s7 = st(); vv.elpHoldNote(s7, 'p', 'solo', 0, 1, t0); vv.elpHoldNote(s7, 'p', 'solo', 0, 1, t0 + HOUR); const h7 = E(s7);
    o.refresh = h7.hold['1'] === t0 + HOUR && vv.elpRunHeld(h7, h7.runs[0], t0 + HOUR + H0 - MIN) && !vv.elpRunHeld(h7, h7.runs[0], t0 + HOUR + H0); }
  o.heldFutureNull = !vv.elpRunHeld(h, h.runs[0], t0 - 1) && !vv.elpRunHeld(h, h.runs[0], null) && !vv.elpRunHeld({ runs: h.runs }, h.runs[0], t0);
  // elpRunReady: idle
  const now = t0 + IDLE + 5 * MIN;
  const idleH = (note) => ({ runs: [run(1, 5, t0, 0)], hold: note == null ? undefined : { 1: note } });
  o.idleOld = vv.elpRunReady(idleH(null), 0, now);
  o.idleHeld = !vv.elpRunReady(idleH(now - MIN), 0, now);
  o.idleStale = vv.elpRunReady(idleH(now - H0), 0, now);
  // a newer run: the held run does not settle, and holds back the run behind it
  const nh = (note) => ({ runs: [run(1, 5, t0, 0), run(2, 20, t0 + HOUR, 1)], hold: note == null ? undefined : { 1: note } });
  const n1 = t0 + HOUR + vv.RATING.GIVEUP_MS;   // past the grace after the newer run (Q433 second draft: elpGiveUpDue)
  o.newerOld = vv.elpRunReady(nh(null), 0, n1) && JSON.stringify([...vv.elpPendingSettles(nh(null), n1)]) === '[0,1]';
  o.newerHeld = !vv.elpRunReady(nh(n1 - MIN), 0, n1) && JSON.stringify([...vv.elpPendingSettles(nh(n1 - MIN), n1)]) === '[]';
  // the final segment settles a held run
  const fh = { runs: [run(1, 20, t0, 1)], hold: { 1: t0 } };
  o.finalHeld = vv.elpRunReady(fh, 0, t0 + MIN);
  // the cutover: a parked version 7 run below the published version settles at its save depth -- not while held
  const keep = [vv.RATING.CUTOVER_MS, vv.RATING.PUB_VER];
  vv.RATING.CUTOVER_MS = t0 - DAY; vv.RATING.PUB_VER = 8;
  try {
    const ch = (note) => ({ runs: [run(1, 10, t0, 2 | 4)], hold: note == null ? undefined : { 1: note } });
    o.cutOld = vv.elpRunReady(ch(null), 0, t0 + MIN);
    o.cutHeld = !vv.elpRunReady(ch(t0), 0, t0 + MIN);
  } finally { vv.RATING.CUTOVER_MS = keep[0]; vv.RATING.PUB_VER = keep[1]; }
  o.parkedIdle = !vv.elpRunReady({ runs: [run(1, 10, t0, 2)] }, 0, t0 + IDLE + MIN);
  // elpTrim: notes of settled / gone runs leave, an empty map goes
  const tr = { runs: [run(1, 5, t0, 0), run(2, 5, t0, 0)], old: [], hold: { 1: t0, 2: t0, 7: t0 } };
  tr.runs[0][3] = 2; vv.elpTrim(tr);
  const tr2 = { runs: [run(1, 5, t0, 0)], old: [], hold: { 1: t0 } }; tr2.runs[0][3] = 2; vv.elpTrim(tr2);
  o.trim = JSON.stringify(tr.hold) === JSON.stringify({ 2: t0 }) && !('hold' in tr2);
  { const bad = ['x', 7, true].map((hv) => { const b = { runs: [run(1, 5, t0, 0)], old: [], hold: hv }; b.runs[0][3] = 2; try { vv.elpTrim(b); return b.hold === hv; } catch (e) { return false; } });
    o.trimBad = bad.every(Boolean); }
  // ratingHistUpsert: a segment of the run settles -- a note of an earlier pass leaves (the map with it when empty), one of this pass
  //   stays, another run's note is not touched
  const up = { hist: { 'p|solo|0': { best: [0, 0], runs: [run(1, 5, t0, 0), run(2, 5, t0, 0)], old: [], t: t0, hold: { 1: t0 + MIN, 2: t0 + MIN } } } };
  vv.ratingHistUpsert(up, 'p', 'solo', 0, 1, 10, t0 + 2 * MIN, 0, 1);
  const up2 = { hist: { 'p|solo|0': { best: [0, 0], runs: [run(1, 5, t0, 0)], old: [], t: t0, hold: { 1: t0 + MIN } } } };
  vv.ratingHistUpsert(up2, 'p', 'solo', 0, 1, 10, t0 + MIN, 0, 1);
  const up3 = { hist: { 'p|solo|0': { best: [0, 0], runs: [run(1, 5, t0, 0)], old: [], t: t0, hold: { 1: t0 + MIN } } } };
  vv.ratingHistUpsert(up3, 'p', 'solo', 0, 1, 10, t0 + 2 * MIN, 0, 1);
  o.upsertClears = JSON.stringify(up.hist['p|solo|0'].hold) === JSON.stringify({ 2: t0 + MIN }) && up2.hist['p|solo|0'].hold && up2.hist['p|solo|0'].hold['1'] === t0 + MIN && !('hold' in up3.hist['p|solo|0']);
  return o;
}
const U = units(v);
T('[1] elpHoldNote notes an unsettled run of an existing entry (hold[runId] = now)', U.notes);
T('[1] ... no entry / another family: nothing noted, nothing created', U.noEntry);
T('[1] ... a run the entry does not hold: nothing noted', U.noRun);
T('[1] ... a settled run: nothing noted', U.settledNot);
T('[1] ... a run whose final segment came: nothing noted (that settles it whatever waits)', U.finalNot);
T('[1] ... a stale note of another run leaves with the next note, a fresh one stays', U.prunesStale);
T('[1] elpRunHeld: inside RATING.HOLD_MS', U.heldIn);
T('[1] elpRunHeld: not at RATING.HOLD_MS', U.heldOut);
T('[1] elpRunHeld: a note from the future / no clock / no map: not held', U.heldFutureNull);
T('[1] each note replaces the last: the hold runs RATING.HOLD_MS from the newest note (review round 1, P3)', U.refresh);
T('[1] elpRunReady idle: settles without a note (as before)', U.idleOld);
T('[1] elpRunReady idle: not while held', U.idleHeld);
T('[1] elpRunReady idle: the old rule again once the note is RATING.HOLD_MS old', U.idleStale);
T('[1] a newer run: gives the run up without a note (as before), both settle', U.newerOld);
T('[1] a newer run: not while held -- and the newer run waits behind it', U.newerHeld);
T('[1] the final segment settles a held run', U.finalHeld);
T('[1] the cutover settles a parked old-version run without a note (as before)', U.cutOld);
T('[1] the cutover: not while held', U.cutHeld);
T('[1] a parked run is not idle-settled (unchanged)', U.parkedIdle);
T('[1] elpTrim: the notes of settled / gone runs leave, an empty map goes', U.trim);
T('[1] elpTrim: a hold that is not a map (a damaged file) is left alone, nothing thrown (review round 1, P3)', U.trimBad);
T('[1] ratingHistUpsert: a settled segment takes its run\'s note of an earlier pass away (an empty map goes), one of this pass stays, another run\'s stays', U.upsertClears);

// ---- [2] pure points (the review's elp-points shape) ----
const F = A.SEG_FINAL, T0 = Date.UTC(2026, 10, 1), t1 = T0 + 2 * DAY;
function points(vv, notes) {
  const p = vv.pid('76561198000099999');
  const placed = () => { const st = {}; [20, 20, 20, 20, 20].forEach((d, i) => { vv.ratingHistUpsert(st, p, 'solo', 0, 100 + i, d, T0 + i * 60000, F, 500 + i); vv.elpSettleAll(st, 0, T0 + i * 60000 + 1000); }); return st; };
  const runOfP = (st, id) => st.hist[vv.ratingHistKey(p, 'solo', 0)].runs.find((x) => (x[0] >>> 0) === id);
  const pass = (st, t, ids) => { if (notes) for (const id of ids) vv.elpHoldNote(st, p, 'solo', 0, id, t); return vv.elpSettleAll(st, 0, t); };
  // control: no gap -- the run reached 20 (final) as the job saw it; then a newer run to 20
  const c = placed();
  vv.ratingHistUpsert(c, p, 'solo', 0, 200, 5, t1, 0, 600); vv.ratingHistUpsert(c, p, 'solo', 0, 200, 20, t1 + HOUR, F, 600); vv.elpSettleAll(c, 0, t1 + HOUR + 1000);
  vv.ratingHistUpsert(c, p, 'solo', 0, 201, 20, t1 + 2 * HOUR, F, 601); vv.elpSettleAll(c, 0, t1 + 2 * HOUR + 1000);
  const ctl = { a: runOfP(c, 200).slice(3, 6), b: runOfP(c, 201).slice(3, 6) };
  // idle: [0,5] settled, the rest waits (noted every 5 min while notes) for 24 h 30 min, then the final segment raises it to 20
  const a = placed(); vv.ratingHistUpsert(a, p, 'solo', 0, 200, 5, t1, 0, 600);
  let early = null;
  for (let t = t1 + 10 * MIN; t <= t1 + DAY + 30 * MIN; t += 5 * MIN) { pass(a, t, [200]); if (!early && runOfP(a, 200)[3]) early = { at: t - t1, r: runOfP(a, 200).slice(1, 6) }; }
  vv.ratingHistUpsert(a, p, 'solo', 0, 200, 20, t1 + DAY + 40 * MIN, F, 600); pass(a, t1 + DAY + 41 * MIN, [200]);
  // newer: the same gap; an hour on a newer run (final at 20) comes, then the run's own final segment at 3 h
  const b = placed(); vv.ratingHistUpsert(b, p, 'solo', 0, 200, 5, t1, 0, 600);
  let earlyB = null;
  for (let t = t1 + 10 * MIN; t <= t1 + 3 * HOUR; t += 5 * MIN) {
    if (t === t1 + HOUR) vv.ratingHistUpsert(b, p, 'solo', 0, 201, 20, t, F, 601);
    pass(b, t, [200]); if (!earlyB && runOfP(b, 200)[3]) earlyB = { at: t - t1, r: runOfP(b, 200).slice(1, 6), newer: (runOfP(b, 201) || [])[3] | 0 };
  }
  vv.ratingHistUpsert(b, p, 'solo', 0, 200, 20, t1 + 3 * HOUR + MIN, F, 600); pass(b, t1 + 3 * HOUR + 2 * MIN, [200]);
  return { ctl, idle: { early, end: runOfP(a, 200).slice(1, 6) }, newer: { early: earlyB, a: runOfP(b, 200).slice(3, 6), b: runOfP(b, 201).slice(3, 6) } };
}
const PT = points(v, true), PN = points(v, false);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
T('[2] control (no gap): the run passes at its line 20 (+83), the newer run after it settles too', PT.ctl.a[0] === 2 && PT.ctl.a[1] === 83 && PT.ctl.a[2] === 20 && PT.ctl.b[0] === 2, JSON.stringify(PT.ctl));
T('[2] the bug shape, no notes: 24 h on, the run settles at its head 5 (-10)', !!PN.idle.early && PN.idle.early.r[0] === 5 && PN.idle.early.r[3] === -10, JSON.stringify(PN.idle));
T('[2] idle, noted: nothing settles while its segments wait; the final segment settles it at 20 exactly as the control (+83)', !PT.idle.early && PT.idle.end[0] === 20 && same(PT.idle.end.slice(2), PT.ctl.a), JSON.stringify(PT.idle));
T('[2] the bug shape, no notes: the newer run gives it up at its head once its grace passed (-10; second draft: the grace, not the notes, decides when)', !!PN.newer.early && PN.newer.early.r[0] === 5 && PN.newer.early.r[3] === -10 && PN.newer.early.at === HOUR + v.RATING.GIVEUP_MS, JSON.stringify(PN.newer));
T('[2] a newer run, noted: neither settles while it waits; then both in order, each as the control', !PT.newer.early && same(PT.newer.a, PT.ctl.a) && same(PT.newer.b, PT.ctl.b), JSON.stringify(PT.newer));

// ---- [3] main() ----
const S = SID(4330), PID = v.pid(S);
function placedSolo(at) {
  const st = { runs: {}, wait: {}, ms: {} };
  [20, 20, 20, 20, 20].forEach((d, i) => { v.ratingHistUpsert(st, PID, 'solo', 0, 100 + i, d, at + i * 60000, A.SEG_FINAL, 500 + i); v.elpSettleAll(st, 0, at + i * 60000 + 1000); });
  return st;
}
const runIdOf = (rs) => v.ratingRunId(v.soloRunKey(PID, 0, rs));
const entryOf = (state) => ((state.SOLO_FILE || {}).hist || {})[PID + '|solo|0'] || null;
function runOf(state, rs) { const h = entryOf(state); return h ? (h.runs.find((r) => (r[0] >>> 0) === runIdOf(rs)) || null) : null; }
const recs = (seg, sh) => [{ sid: S, d: start7(seg[3], S, seg[4]), shard: sh }, { sid: S, d: seg, shard: sh + 1 }];
// steps: [[ms since the previous run, records, no cp board]]; the first state = the placed player
function play(tree, steps) {
  const outR = []; let state = { SOLO_FILE: placedSolo(Date.now() - 30 * DAY) };
  for (const [ms, rr, noCp] of steps) {
    const r = runCron(tree, world(rr, noCp), advance(state, ms));
    outR.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return outR;
}
const RS_A = 433001, RS_B = 433002;
const a0 = soloSeg({ sid: S, id: 'q433-a0', runSeed: RS_A, sd: 0, ed: 5, flags: 0 });
const a1 = soloSeg({ sid: S, id: 'q433-a1', runSeed: RS_A, sd: 5, ed: 10, flags: 0 });   // the late / lost one
const a2 = soloSeg({ sid: S, id: 'q433-a2', runSeed: RS_A, sd: 10, ed: 15, flags: 0 });
const a3 = soloSeg({ sid: S, id: 'q433-a3', runSeed: RS_A, sd: 15, ed: 20, flags: A.SEG_FINAL });
const a1f = soloSeg({ sid: S, id: 'q433-a1f', runSeed: RS_A, sd: 5, ed: 10, flags: A.SEG_FINAL });   // a run that ends at 10
const ar = soloSeg({ sid: S, id: 'q433-ar', runSeed: RS_A, sd: 10, ed: 15, flags: A.SEG_RESUMED });  // a resume whose save point [5,10 SUSPENDED] never came
const b0 = soloSeg({ sid: S, id: 'q433-b0', runSeed: RS_B, sd: 0, ed: 5, flags: A.SEG_FINAL });
const HEAD = recs(a0, 0), TAIL = recs(a2, 2).concat(recs(a3, 4)), MID = recs(a1, 6), BRUN = recs(b0, 8), END10 = recs(a1f, 10), RESUME = recs(ar, 12);
const snap = (r, rsId) => { const x = runOf(r.state, rsId); return x ? { depth: x[1], settled: x[3], d: x[4], T: x[5] } : null; };
const holdOf = (r) => { const h = entryOf(r.state); return h && h.hold ? Object.keys(h.hold).map(Number) : []; };
const codes = (rs) => rs.map((r) => r.code).join('');
const SCEN = {
  // no gap: what the run settles at
  control: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(MID, TAIL)], [2 * HOUR, HEAD.concat(MID, TAIL)], [2 * HOUR, HEAD.concat(MID, TAIL)]]),
  // [5,10] never comes; [10,15] + [15,20 FINAL] wait from 10 min after the head; a pass 24 h 2 min after the head (the idle settle
  //   due, the gap window not run out), then the window runs out (Q428 settles them on their own)
  idle: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(TAIL)], [24 * HOUR - 8 * MIN, HEAD.concat(TAIL)], [20 * MIN, HEAD.concat(TAIL)], [HOUR, HEAD.concat(TAIL)]]),
  // the same gap; 10 min later he plays another run (one final segment): its first sighting, its settle 2 h on, then the window runs out
  newer: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(TAIL)], [10 * MIN, HEAD.concat(TAIL, BRUN)], [2 * HOUR, HEAD.concat(TAIL, BRUN)], [22 * HOUR, HEAD.concat(TAIL, BRUN)], [HOUR, HEAD.concat(TAIL, BRUN)]]),
  // late, not lost: the newer run in between, [5,10] comes 3 h after the head (the retry outbox)
  late: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(TAIL)], [10 * MIN, HEAD.concat(TAIL, BRUN)], [2 * HOUR, HEAD.concat(TAIL, BRUN)], [HOUR, HEAD.concat(TAIL, BRUN, MID)], [2 * HOUR, HEAD.concat(TAIL, BRUN, MID)], [2 * HOUR, HEAD.concat(TAIL, BRUN, MID)]]),
  // [5,10 FINAL] first seen a minute before the idle settle is due: pacing defers it (5 levels = about 3 min) past that instant
  pacing: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [24 * HOUR - MIN, HEAD.concat(END10)], [2 * MIN, HEAD.concat(END10)], [5 * MIN, HEAD.concat(END10)]]),
  // [5,10 FINAL] chains 10 min after the head, but the CP board is missing from the listing (left pending) past the idle instant
  board: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(END10), true], [24 * HOUR - 8 * MIN, HEAD.concat(END10), true], [10 * MIN, HEAD.concat(END10)]]),
  // a resume whose save point never came waits (save-orphan: the job never settles it by itself) from 10 min after the head:
  //   held inside the gap window, then RATING.HOLD_MS more, then the run settles at its head as before
  orphan: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(RESUME)], [24 * HOUR - 5 * MIN, HEAD.concat(RESUME)], [HOUR, HEAD.concat(RESUME)], [HOUR + 10 * MIN, HEAD.concat(RESUME)]]),
  // no gap, a deferral that ended: [5,10] (not final) first seen with its start (pacing defers it: noted), settles 10 min on; he
  //   stops (a crash) and plays another run 10 min later: its first segment deferred, then settled -- the run is given up at 10 in
  //   that pass, as without this rule
  //   Q433 second draft: given up once the grace after the newer run passed (the pass 2 h on), not in the pass that first saw it
  ended: (tree) => play(tree, [[0, HEAD], [2 * HOUR, HEAD], [10 * MIN, HEAD.concat(MID)], [10 * MIN, HEAD.concat(MID)], [10 * MIN, HEAD.concat(MID, BRUN)], [10 * MIN, HEAD.concat(MID, BRUN)], [2 * HOUR, HEAD.concat(MID, BRUN)]]),
};
function judge(tree, which) {
  const o = {}, want = (k) => !which || which.indexOf(k) >= 0;
  const c = SCEN.control(tree), cA = snap(c[c.length - 1], RS_A);
  o.control = { codes: codes(c), A: cA };
  const likeCtl = (x) => !!x && !!cA && x.settled === 2 && x.depth === 20 && x.d === cA.d && x.T === cA.T;
  if (want('idle')) { const r = SCEN.idle(tree); o.idle = { codes: codes(r), at24: snap(r[3], RS_A), hold24: holdOf(r[3]), end: snap(r[r.length - 1], RS_A), holdEnd: holdOf(r[r.length - 1]) }; o.idle.ok = !o.idle.at24.settled && likeCtl(o.idle.end); }
  if (want('newer')) { const r = SCEN.newer(tree); o.newer = { codes: codes(r), atB: snap(r[4], RS_A), bAtB: snap(r[4], RS_B), end: snap(r[r.length - 1], RS_A), b: snap(r[r.length - 1], RS_B) }; o.newer.ok = !o.newer.atB.settled && !(o.newer.bAtB && o.newer.bAtB.settled) && likeCtl(o.newer.end) && !!o.newer.b && o.newer.b.settled === 2; }
  if (want('late')) { const r = SCEN.late(tree); o.late = { codes: codes(r), atB: snap(r[4], RS_A), end: snap(r[r.length - 1], RS_A), b: snap(r[r.length - 1], RS_B) }; o.late.ok = !o.late.atB.settled && likeCtl(o.late.end) && !!o.late.b && o.late.b.settled === 2; }
  if (want('pacing')) { const r = SCEN.pacing(tree); o.pacing = { codes: codes(r), deferred: /solo-pacing .*deferred/.test(r[3].out), after: snap(r[3], RS_A), end: snap(r[r.length - 1], RS_A) }; o.pacing.ok = o.pacing.deferred && !o.pacing.after.settled && !!o.pacing.end && o.pacing.end.settled === 2 && o.pacing.end.depth === 10; }
  if (want('board')) { const r = SCEN.board(tree); o.board = { codes: codes(r), pending: /board unresolved -- left pending/.test(r[3].out), after: snap(r[3], RS_A), end: snap(r[r.length - 1], RS_A) }; o.board.ok = o.board.pending && !o.board.after.settled && !!o.board.end && o.board.end.settled === 2 && o.board.end.depth === 10; }
  if (want('ended')) { const r = SCEN.ended(tree); o.ended = { codes: codes(r), deferred: /solo-pacing .*deferred/.test(r[2].out), noteGone: holdOf(r[3]).length === 0, inGrace: snap(r[5], RS_A), end: snap(r[6], RS_A), b: snap(r[6], RS_B) }; o.ended.ok = o.ended.deferred && o.ended.noteGone && !!o.ended.inGrace && !o.ended.inGrace.settled && !!o.ended.end && o.ended.end.settled === 2 && o.ended.end.depth === 10 && !!o.ended.b && o.ended.b.settled === 2; }
  if (want('orphan')) { const r = SCEN.orphan(tree); o.orphan = { codes: codes(r), orphan: /save-orphan/.test(r[3].out), in: snap(r[3], RS_A), after: snap(r[4], RS_A), end: snap(r[r.length - 1], RS_A) }; o.orphan.ok = o.orphan.orphan && !o.orphan.in.settled && !o.orphan.after.settled && !!o.orphan.end && o.orphan.end.settled === 2 && o.orphan.end.depth === 5; }
  return o;
}
const TREE = copyTree('fix');
const J = judge(TREE);
fs.rmSync(TREE, { recursive: true, force: true });
const js = (x) => JSON.stringify(x);
T('[3] control (no gap): every run exit 0, the run passes at 20', /^0+$/.test(J.control.codes) && J.control.A && J.control.A.settled === 2 && J.control.A.depth === 20 && J.control.A.d > 0, js(J.control));
T('[3] idle: 24 h after its head, its segments waiting, the run is not settled (held: its note in the entry)', /^0+$/.test(J.idle.codes) && !J.idle.at24.settled && J.idle.hold24.indexOf(runIdOf(RS_A)) >= 0, js(J.idle));
T('[3] idle: the window runs out, its segments settle, the run settles at 20 exactly as the control; the note is gone', J.idle.ok && J.idle.holdEnd.length === 0, js(J.idle));
T('[3] a newer run: neither the run nor the newer run settles while its segments wait; then the run as the control, the newer run after it', /^0+$/.test(J.newer.codes) && J.newer.ok, js(J.newer));
T('[3] a late predecessor (3 h, a newer run in between): the run waits for it and settles as the control', /^0+$/.test(J.late.codes) && J.late.ok, js(J.late));
T('[3] a segment deferred by pacing over the idle instant holds the run; it then settles at 10', /^0+$/.test(J.pacing.codes) && J.pacing.ok, js(J.pacing));
T('[3] a segment left pending (the CP board missing) over the idle instant holds the run; it then settles at 10', /^0+$/.test(J.board.codes) && J.board.ok, js(J.board));
T('[3] a deferral that ended (pacing, then settled) leaves no hold: the newer run gives the run up at 10 as before -- once its grace passed (second draft), not in the pass that first saw it', /^0+$/.test(J.ended.codes) && J.ended.ok, js(J.ended));
T('[3] a resume whose save point never came: held inside the gap window and RATING.HOLD_MS after, then the run settles at its head 5 as before', /^0+$/.test(J.orphan.codes) && J.orphan.ok, js(J.orphan));

// ---- [4] mutations ----
const MUT = [
  ['the predicate without the hold', 'held = elpRunHeld(h, r, nowMs), newer', 'held = false, newer', 'points+idle'],
  ['the hold not on a newer run', 'newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs) && !held,', 'newer = elpNewerRun(h, i) && elpGiveUpDue(h, i, nowMs),', 'units'],
  ['a note kept until it is stale (not replaced each pass: review round 1, X7)', '  w[String(runId >>> 0)] = nowMs;', '  if (!(String(runId >>> 0) in w)) w[String(runId >>> 0)] = nowMs;', 'units'],
  ['elpTrim walks a hold that is not a map', "  if (h.hold && typeof h.hold === 'object') {   // Q433 review P3", '  if (h.hold) {   // Q433 review P3', 'units'],
  ['the hold not on the idle settle', '>= RATING.IDLE_MS && !held;', '>= RATING.IDLE_MS;', 'units'],
  ['the hold not on the cutover', '|| (cut && !held));', '|| cut);', 'units'],
  ['the hold over the final segment too', 'return !!(((r[7] | 0) & 1) || newer ||', 'return !!((((r[7] | 0) & 1) && !held) || newer ||', 'units'],
  ['the lane: no note for a waiting segment', '    if (plan.ok === null) elpHold(true);   // waiting for its chain (logged just below)\n', '', 'idle'],
  ['the lane: no note for a segment left pending', "{ elpHold(false); console.log('  ' + laneTag + ' ' + m + ': cp/'", "{ console.log('  ' + laneTag + ' ' + m + ': cp/'", 'board'],
  ['the lane: no note for a segment deferred by pacing', "      elpHold(false);\n      console.log('  solo-pacing ' + m", "      console.log('  solo-pacing ' + m", 'pacing'],
  ['the lane: a wait holds past the gap window', 'if (waiting && !(nowMs - ((soloState.wait[m] && soloState.wait[m].t0) || nowMs) <= Math.min(COMP.GAP_SETTLE_MS, COMP.CHAIN_WAIT_MS))) return;', '', 'orphan'],
  ['a hold that never ends', 'return t <= nowMs && nowMs - t < RATING.HOLD_MS;', 'return t <= nowMs;', 'units'],
  ['a note on a settled / finished run', 'if (!r || r[3] || ((r[7] | 0) & 1)) return false;', 'if (!r) return false;', 'units'],
  ['no clear when a segment settles', "    if (h.hold && typeof h.hold === 'object' && Number(h.hold[String(runId)]) < nowMs) { delete h.hold[String(runId)]; if (!Object.keys(h.hold).length) delete h.hold; }", '', 'ended'],
  ['elpTrim without its prune', "    for (const k of Object.keys(h.hold)) if (!h.runs.some((r) => !r[3] && String(r[0] >>> 0) === k)) delete h.hold[k];", '', 'units'],
];
for (const [label, from, to, how] of MUT) {
  let red = false, why = '';
  try {
    const src = mutate(from, to);
    if (how === 'units' || how === 'points+idle') {
      const vm = load(src);
      if (how === 'units') { const u = units(vm); const bad = Object.keys(U).filter((k) => u[k] !== U[k]); red = bad.length > 0; why = bad.join(','); }
      else { const pt = points(vm, true); red = !!pt.idle.early || !!pt.newer.early; why = js(pt.idle.early); }
    }
    if (!red && how !== 'units') {
      const tree = copyTree('mut', src);
      try {
        const which = how === 'points+idle' ? 'idle' : how;
        const j = judge(tree, [which]);
        red = !j[which].ok; why += (why ? ' / ' : '') + js(j[which]).slice(0, 300);
      } finally { fs.rmSync(tree, { recursive: true, force: true }); }
    }
  } catch (e) { red = false; why = 'threw: ' + String(e && e.message).slice(0, 200); }
  T('[4] mutant "' + label + '" turns this file red', red, why);
}

if (failN) { console.log('FAIL (elp-gap-hold) ' + failN); process.exit(1); } else console.log('ALL PASS (elp-gap-hold)');
