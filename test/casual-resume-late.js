'use strict';
// cloud audit Q425 (2026-11-20 found by the Q424 review, fixed 2026-11-25): a casual segment of a resumed session seen BEFORE that
//   session's resume record. A casual token resume (the gold-bought save item: the guard's checkpoint-snapshot row, solo O218 / couch
//   C3a) starts a new guard session at a checkpoint C; only its first segment [C, C+5] (SEG_RESUMED + the row's tag) replaces the run
//   memory. The guard's outbox retries a failed upload later, so the session's next segment can reach the job first: judged on the
//   timeline the resume had not replaced yet it was perk REJECT (perk_chain: prefix) + a "suspected forgery" flag on an honest player,
//   or reroll chain REJECT (reroll-lost), or chain REJECT (after-final) -- each time processed, never settled, even once the resume
//   came. Fix (validate.js casualLateResumeAt + the lane's lateResume): a casual segment that fits the run the way a session resumed at
//   some checkpoint C <= min(its start, the run's head) would (O903 cut, replayed build, reroll bits kept up to C) waits for the resume
//   on the chain-wait clock; past COMP.CHAIN_WAIT_MS the old verdict applies, nobody flagged.
//   [1] unit: casualLateResumeAt -- the resumed session's next segment (its C), a twin with / without the reroll bit, C capped by the
//       run's head; null for: competitive / classic / a resume / a burnt run / no run / a pick before the first checkpoint rewritten /
//       a build its log does not replay / a reroll bit ahead of its depth / a run head below the first checkpoint; the couch draw pool
//   [2] main(): the reviewer's four orders (solo + couch): nobody flagged, the resumed line settles to its end (ladder 67), the resume
//       a pass late settles all four segments with the usual order's XP and CP; the dead death seen after the resume waits (Q422's
//       part), never flagged
//   [3] main(): a reroll bit the dead timeline took past the checkpoint (reroll-lost): the resumed line's segment waits, then settles
//   [4] main(): the resume a few days late still settles; the resume that never comes: after the chain wait the segment is rejected,
//       nobody flagged; still flagged at once: a pick before the first checkpoint rewritten, a build its log does not replay
//   [5] mutations (each must turn this file red)
// Usage: node test/casual-resume-late.js [<epoch-sync root>] [--no-mut] [--fail-fast]   (root defaults to this checkout; --no-mut =
//   the mutation children, --fail-fast = stop at the first red part). Outside the tree it is the Q425 repro: an epoch-sync without
//   the fix exits 1, with it 0. Harness = the Q424 review's repro-resume-row-late.js (test/casual-resume-dead-line.js shape: copied
//   tree + one sealed test key + a stub Steam, every *_FILE redirected).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ARGS = process.argv.slice(2);
const NO_MUT = ARGS.indexOf('--no-mut') >= 0;
const ROOT = path.resolve(ARGS.find((a) => !a.startsWith('--')) || path.join(__dirname, '..'));
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const perks = require(path.join(ROOT, 'perks.js'));
const P = perks.load();

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const CAS = A.SEG_CASUAL, RES = A.SEG_RESUMED, FIN = A.SEG_FINAL, COUCH = A.SEG_COUCH;

// ---- pick logs that replay (the real vendor table + RNG, channel 'ea' like the production job) ----
const pad = (a) => { const o = a.slice(0, 20); while (o.length < 20) o.push(0); return o; };
const packed = (a) => P.packPicks(pad(a));
function replayBuild(arr, season, runSeed, pc, flags, endDepth) {
  const f = { seasonId: season, runSeed, flags };
  const r = P.replay(P.seasonSeed(season), pad(arr), endDepth, perks.replayOpts(f, pc, 'ea'));
  return r.ok ? (r.build >>> 0) : null;
}
// extend `head` to n picks, each the first choice of `order` that still replays (deterministic)
function grow(head, n, season, runSeed, pc, flags, order) {
  const out = head.slice();
  while (out.length < n) {
    let got = null;
    for (const c of (order || [1, 2, 3, 5])) {
      const t = out.concat([c]);
      if (replayBuild(t, season, runSeed, pc, flags, 5 * t.length) != null) { got = c; break; }
    }
    if (got == null) throw new Error('no replayable choice at draw ' + out.length);
    out.push(got);
  }
  return out;
}
// a different replayable choice at draw k (same head)
function otherAt(log, k, season, runSeed, pc, flags) {
  for (const c of [1, 2, 3, 5]) {
    if (c === log[k]) continue;
    const t = log.slice(0, k).concat([c]);
    if (replayBuild(t, season, runSeed, pc, flags, 5 * t.length) != null) return c;
  }
  throw new Error('no other replayable choice at draw ' + k);
}


// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('9d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099111801;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// guard-signed couch casual segment (layout of test/couch-casual-settle.js couchRec, perk + reroll words filled)
function couchRec(sid, id, runSeed, o) {
  const n = o.n || 2;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (let i = 0; i < n; i++) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed | 0, o.conts | 0, 0, o.season | 0, o.flags, o.build >>> 0, o.lo | 0, o.hi | 0, o.rl | 0, o.rh | 0, (o.tag | 0) & A.RESUME_TAG_MASK);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), KEY_ID, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
// guard-signed solo segment (attVer 5, BASE_LEN 30; layout of test/resume-replay.js seg, perk + reroll words filled)
function soloRec(sid, id, runSeed, o) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1,
    300, o.score == null ? 1000 : o.score, o.disp | 0, lo, hi, o.sd | 0, o.ed | 0, o.conts | 0, 0, o.season | 0, o.flags | 0,
    KEY_ID, (5 | (((o.tag | 0) & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, o.build >>> 0, o.lo | 0, o.hi | 0, o.rl | 0, o.rh | 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  const d = b.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };   // the guard's single-shape start

function copyTree(root, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q425-' + tag + '-'));
  require(path.join(root, 'test', 'root-listing')).copyRootTree(root, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  return dir;
}
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
function runCron(tree, boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q425-run-'));
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
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
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
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
  }
  return files;
}
const LB = { xp: 5, cp: 8, casSolo: 25, couchCas: 20, couchCasBox: 21 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 22, name: 'endless_board', entries: [] }, { id: 23, name: 'endless_board_trio', entries: [] },
    { id: 24, name: 'endless_board_quad', entries: [] }, { id: LB.casSolo, name: 'endless_board_solo', entries: [] }, { id: 26, name: 'endless_board_overall', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 18, name: 'endless_comp_couch', entries: [] }, { id: 19, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: LB.couchCasBox, name: 'endless_save_box_casual_couch', entries: [] });
  return boards;
}
// steps: [msSincePrevious, recs]; files0 seeds the first run
function timeline(tree, steps, files0) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const files = state ? advance(state, ms) : files0;
    const r = runCron(tree, world(recs), files);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const HOUR = 3600 * 1000;
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const flaggedOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {}).f | 0);
const trustFl = (r, sid) => ((((r.state.TRUST_FILE || {}).acct || {})[v.pid(sid)] || {}).ev || []).filter((e) => e.s === 'fl').length;
const linesOf = (r, m) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n').slice(0, 1500);
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2500)); return true; };


const SEA = 0;
const pk = (log) => { const p = packed(log); return { lo: p.lo, hi: p.hi }; };
const samePk = (a, log) => !!a && a.lo === packed(log).lo && a.hi === packed(log).hi;
// ---- main() scenarios ----
const runOf = (r, key) => (((r.state.SOLO_FILE || {}).runs || {})[key]) || {};
const scoreOf = (w) => Number((/(?:^|&)score=(-?\d+)/.exec(w.body) || [0, 0])[1]);
const lastScore = (r, id, sid) => { const w = writesTo(r, id, sid); return w.length ? scoreOf(w[w.length - 1]) : null; };
// the stub board hands out the same starting rows on every pass (writes are not carried over): sum what each pass added / charged
const xpSum = (X) => X.rs.reduce((n, r) => n + (lastScore(r, LB.xp, X.S) || 0), 0);
const cpCharged = (X) => X.rs.reduce((n, r) => { const c = lastScore(r, LB.cp, X.S); return n + (c == null ? 0 : 1000 - c); }, 0);
const ladderBest = (X, id) => Math.max(0, ...X.rs.map((r) => writesTo(r, id, X.S).map(scoreOf)).reduce((a, b) => a.concat(b), []));
// one run: o.couch, o.sidN, o.rs, o.gaps (ms before each pass; default 2 h), o.tail (the passes after the last, default one 2 h later), o.seedRun (run memory fields), o.segs(L, FL) -> [{ name, sd, ed, flags, log, tag?, conts?, build?, rl?, disp?, id? }], o.passes = [[seg idx...], ...]
//   (each pass writes those results; records stay on the shards). L = the pick logs of this run: p12 (the checkpoint 60), x13 (the card X
//   at 65), y13 (another card at 65), x14 (X, then the card at 70), x14b (X, then another card at 70), x15 / x15b (x14, then one card /
//   another at 75). Returns { rs (one per pass, + one
//   more pass), segs, S, key, L }.
function play(tree, label, o) {
  const S = SID(o.sidN), RS = o.rs;
  const couch = !!o.couch, pc = couch ? 2 : 1, FL = couch ? (CAS | COUCH) : CAS;
  const key = couch ? v.teamRunKey([S, S], SEA, RS) : v.soloRunKey(v.pid(S), SEA, RS);
  const g = (head, n) => grow(head, n, SEA, RS, pc, FL, [1, 2, 3, 5]);
  const L = { p12: g([], 12) };
  L.x13 = g(L.p12, 13);
  L.y13 = L.p12.concat([otherAt(L.x13, 12, SEA, RS, pc, FL)]);
  L.x14 = g(L.x13, 14);
  L.x14b = L.x13.concat([otherAt(L.x14, 13, SEA, RS, pc, FL)]);
  L.x15 = g(L.x14, 15);
  L.x15b = L.x14.concat([otherAt(L.x15, 14, SEA, RS, pc, FL)]);
  const seed = { SOLO_FILE: { runs: { [key]: Object.assign({ max: 60, ms: 0, saves: {}, t: Date.now(), seg0: 1, k: 1, pk: pk(L.p12) }, o.seedRun || {}) }, wait: {}, ms: {} } };
  const segs = o.segs(L, FL).map((s, i) => {
    const pp = packed(s.log);
    const x = { sd: s.sd, ed: s.ed, flags: s.flags, build: s.build != null ? s.build : replayBuild(s.log, SEA, RS, pc, FL, s.ed), lo: pp.lo, hi: pp.hi, tag: s.tag | 0, conts: s.conts | 0, rl: s.rl | 0, rh: s.rh | 0, disp: s.disp | 0 };
    const d = couch ? couchRec(S, 'q425-' + label + '-' + (s.id || i), RS, Object.assign({ seats: [300, 200], n: 2 }, x)) : soloRec(S, 'q425-' + label + '-' + (s.id || i), RS, Object.assign({ score: 1000 + i }, x));
    return { name: s.name, d, m: keyOf(d), score: 1000 + i, s };
  });
  const starts = segs.map((s, i) => ({ sid: S, d: start7(s.d[3], S, RS), shard: 10 + i }));
  const steps = [[0, starts]];
  const out = [];
  o.passes.forEach((pass, k) => { for (const i of pass) out.push({ sid: S, d: segs[i].d, shard: 30 + i }); steps.push([(o.gaps && o.gaps[k] != null) ? o.gaps[k] : 2 * HOUR, starts.concat(out.slice())]); });
  for (const gp of (o.tail || [2 * HOUR])) steps.push([gp, starts.concat(out.slice())]);
  const rs = timeline(tree, steps, seed).slice(1);
  return { rs, segs, S, key, L, couch };
}
const settledIn = (r, s) => procHas(r, s.m) && new RegExp('settle ' + s.m.replace(/[-]/g, '\\-') + ':').test(r.out);
const settledAny = (X, i) => X.rs.some((r) => settledIn(r, X.segs[i]));
const allLines = (X, idx) => (idx || X.segs.map((s, i) => i)).map((i) => X.segs[i].name + ' :: ' + X.rs.map((r) => linesOf(r, X.segs[i].m)).join(' | ')).join('\n');
const lastRun = (X) => runOf(X.rs[X.rs.length - 1], X.key);
const lastFlag = (X) => flaggedOf(X.rs[X.rs.length - 1], X.S) + trustFl(X.rs[X.rs.length - 1], X.S);
const ladId = (X) => X.couch ? LB.couchCas : LB.casSolo;


const FAIL_FAST = ARGS.indexOf('--fail-fast') >= 0;
const stopIfRed = () => { if (FAIL_FAST && failN) { console.log('\n' + failN + ' FAILED (fail-fast)'); process.exit(1); } };
console.log('=== Q425 a resumed session\'s segment seen before its resume record (' + path.basename(ROOT) + ') ===');
const HAS = typeof v.casualLateResumeAt === 'function';
const HAS_Q422 = typeof v.deadLineOf === 'function';   // with the kept lines of cloud audit Q422 the dead death seen after the resume settles there
T('[0] validate.js exports casualLateResumeAt', HAS);

// ---- [1] unit ----
if (HAS) {
  const RS1 = 942501, CLS = A.SEG_CLASSIC, CMP = A.SEG_COMP;
  const g1 = (head, n, pc, FL) => grow(head, n, SEA, RS1, pc, FL, [1, 2, 3, 5]);
  const fOf = (log, sd, ed, flags, pc, FL, o) => {
    const pp = packed(log);
    return Object.assign({ flags, startDepth: sd, endDepth: ed, build: replayBuild(log, SEA, RS1, pc, FL, ed), picksLo: pp.lo, picksHi: pp.hi, seasonId: SEA, runSeed: RS1, rerollLo: 0, rerollHi: 0 }, o || {});
  };
  for (const [tag, pc, FL] of [['solo', 1, CAS], ['couch', 2, CAS | COUCH]]) {
    const p12 = g1([], 12, pc, FL), x13 = g1(p12, 13, pc, FL);
    const y13 = p12.concat([otherAt(x13, 12, SEA, RS1, pc, FL)]);
    const z13 = g1([otherAt(p12, 0, SEA, RS1, pc, FL)], 13, pc, FL);
    const run = () => ({ max: 65, pk: pk(x13), rr: { lo: (1 << 20) >>> 0, hi: 0 } });   // bit 20 = the ask at depth 63, past the checkpoint 60
    const at = (r, f) => v.casualLateResumeAt(r, f, pc, 'ea');
    eq('[1] ' + tag + ': the resumed session\'s next segment (another card at 65, bit 20 lost) -> resumed at 60', at(run(), fOf(y13, 65, 67, FL | FIN, pc, FL)), 60);
    eq('[1] ' + tag + ': a twin (the same card at 65) that lost bit 20 -> 60', at(run(), fOf(x13, 65, 67, FL | FIN, pc, FL)), 60);
    eq('[1] ' + tag + ': a twin that kept bit 20 -> 65', at(run(), fOf(x13, 65, 67, FL | FIN, pc, FL, { rerollLo: (1 << 20) >>> 0 })), 65);
    eq('[1] ' + tag + ': C is capped by the run\'s head (head 62: 60, not 65)', at({ max: 62, pk: pk(p12) }, fOf(g1(x13, 14, pc, FL), 65, 70, FL, pc, FL)), 60);
    eq('[1] ' + tag + ': no pick log in the run memory -> the reroll reading alone (65)', at({ max: 65 }, fOf(y13, 65, 67, FL, pc, FL)), 65);
    eq('[1] ' + tag + ': competitive -> null', at(run(), fOf(y13, 65, 67, (FL & ~CAS) | CMP, pc, FL)), null);
    eq('[1] ' + tag + ': classic -> null', at(run(), fOf(y13, 65, 67, FL | CLS, pc, FL)), null);
    eq('[1] ' + tag + ': a resume itself -> null', at(run(), fOf(y13, 60, 65, FL | RES, pc, FL)), null);
    eq('[1] ' + tag + ': a burnt run -> null', at(Object.assign(run(), { burnt: 1 }), fOf(y13, 65, 67, FL, pc, FL)), null);
    eq('[1] ' + tag + ': no run memory -> null', at(undefined, fOf(y13, 65, 67, FL, pc, FL)), null);
    eq('[1] ' + tag + ': a pick before the first checkpoint rewritten -> null', at(run(), fOf(z13, 65, 67, FL, pc, FL)), null);
    eq('[1] ' + tag + ': a build its log does not replay -> null', at(run(), fOf(y13, 65, 67, FL, pc, FL, { build: (replayBuild(y13, SEA, RS1, pc, FL, 67) + 1) >>> 0 })), null);
    eq('[1] ' + tag + ': a reroll bit ahead of its depth -> null', at(run(), fOf(y13, 65, 67, FL, pc, FL, { rerollLo: ((1 << 20) | (1 << 30)) >>> 0 })), null);
    eq('[1] ' + tag + ': the run\'s head below the first checkpoint -> null', at({ max: 4, pk: pk([]) }, fOf(y13, 65, 67, FL, pc, FL)), null);
    const b13 = g1(p12.slice(0, 5).concat([otherAt(p12, 5, SEA, RS1, pc, FL)]), 13, pc, FL);   // the pick at depth 30 rewritten
    eq('[1] ' + tag + ': a pick at depth 30 rewritten, no resume seen yet -> a resume at 25 would explain it', at(run(), fOf(b13, 65, 67, FL, pc, FL)), 25);
    eq('[1] ' + tag + ': ... but after a resume at 60 (run.rd) a later resume starts at 60 or deeper -> null', at(Object.assign(run(), { rd: 60 }), fOf(b13, 65, 67, FL, pc, FL)), null);
    eq('[1] ' + tag + ': run.rd 60 still lets the resumed session at 60 wait', at(Object.assign(run(), { rd: 60 }), fOf(y13, 65, 67, FL, pc, FL)), 60);
  }
}
if (typeof v.soloAdvance === 'function') {   // run.rd: the deepest casual token resume so far
  const adv = (st, fl, sd) => { v.soloAdvance(st, 'k', { flags: fl, startDepth: sd, endDepth: sd + 5 }, 'm' + sd + fl, { ok: true, proven: sd }, 1); return st.runs.k.rd; };
  const st = { runs: { k: { max: 70, ms: 0, saves: {}, t: 0 } }, wait: {} };
  eq('[1] soloAdvance: a casual token resume at 60 keeps run.rd 60', adv(st, CAS | RES, 60), 60);
  eq('[1] soloAdvance: a segment that is not a resume leaves it', adv(st, CAS, 65), 60);
  eq('[1] soloAdvance: a couch casual resume at 65 -> 65', adv(st, CAS | COUCH | RES, 65), 65);
  eq('[1] soloAdvance: never moves back (a resume at 55 seen later)', adv(st, CAS | RES, 55), 65);
  eq('[1] soloAdvance: a competitive / classic resume keeps none', [adv({ runs: { k: { max: 70, ms: 0, saves: {}, t: 0 } }, wait: {} }, A.SEG_COMP | RES, 60), adv({ runs: { k: { max: 70, ms: 0, saves: {}, t: 0 } }, wait: {} }, A.SEG_CLASSIC | RES, 60)], [undefined, undefined]);
}
stopIfRed();

// ---- [2] main(): the reviewer's four orders ----
const TT = copyTree(ROOT, 'tree');
process.on('exit', () => { try { fs.rmSync(TT, { recursive: true, force: true }); } catch (e) {} });
const shape = (L, FL) => [
  { name: 'dead 60->65 (X at 65)', sd: 60, ed: 65, flags: FL, log: L.x13 },
  { name: 'dead death 65->66 FINAL', sd: 65, ed: 66, flags: FL | FIN, log: L.x13 },
  { name: 'resumed 60->65 (another card Y at 65) -- its upload retried', sd: 60, ed: 65, flags: FL | RES, log: L.y13, tag: 0x4251 },
  { name: 'resumed death 65->67 FINAL (Y)', sd: 65, ed: 67, flags: FL | FIN, log: L.y13 }];
const ORDERS = [['usual order', [[0, 1], [2], [3]]], ['the resume row a pass late', [[0, 1], [3], [2]]], ['the resume row late, the dead death later still', [[0], [3], [1, 2]]], ['the resumed death first in one pass with the dead line', [[0, 3], [1, 2]]]];
const sets = (X) => X.segs.map((s, i) => settledAny(X, i) ? 1 : 0).join('');
const waitedQ425 = (X, i) => X.rs.some((r) => /waits for it \(Q425\)/.test(linesOf(r, X.segs[i].m)));
for (const couch of [false, true]) {
  const tg = couch ? 'couch' : 'solo';
  let usual = null;
  ORDERS.forEach(([nm, passes], k) => {
    const X = play(TT, 'o' + k + tg, { couch, sidN: 9425200 + k + (couch ? 10 : 0), rs: 942520 + k + (couch ? 10 : 0), passes, segs: shape });
    if (brk(X.rs, passes.length + 1, '[2] ' + tg + ' ' + nm)) return;
    const st = sets(X);
    eq('[2] ' + tg + ' ' + nm + ': nobody flagged', lastFlag(X), 0);
    T('[2] ' + tg + ' ' + nm + ': the resumed line settles to its end (ladder 67)', st[2] === '1' && st[3] === '1' && ladderBest(X, ladId(X)) === 670001, 'settled ' + st + ', ladder ' + ladderBest(X, ladId(X)) + '\n' + allLines(X));
    if (k === 0) usual = { xp: xpSum(X), cp: cpCharged(X) };
    if (k === 1) {
      eq('[2] ' + tg + ' ' + nm + ': all four settle', st, '1111');
      eq('[2] ' + tg + ' ' + nm + ': XP / CP equal to the usual order', { xp: xpSum(X), cp: cpCharged(X) }, usual);
      T('[2] ' + tg + ' ' + nm + ': the resumed death waited for the resume (after-final on the dead line)', waitedQ425(X, 3), allLines(X, [3]));
    }
    if (k >= 2) {
      T('[2] ' + tg + ' ' + nm + ': the resumed death waited for the resume (perk_chain on the dead line)', waitedQ425(X, 3), allLines(X, [3]));
      if (HAS_Q422) eq('[2] ' + tg + ' ' + nm + ': with Q422 the dead death seen after the resume settles on its kept line', st, '1111');
      else T('[2] ' + tg + ' ' + nm + ': the dead death seen after the resume waits, not processed (Q422 settles it on its line)', !procHas(X.rs[X.rs.length - 1], X.segs[1].m) && waitedQ425(X, 1), allLines(X, [1]));
    }
  });
  stopIfRed();
}

// ---- [3] main(): a reroll bit the dead timeline took past the checkpoint ----
const BIT20 = (1 << 20) >>> 0;
const shapeR = (L, FL) => [
  { name: 'dead 60->65 (rerolled the ask at 63)', sd: 60, ed: 65, flags: FL, log: L.x13, rl: BIT20 },
  { name: 'resumed 60->65 (the same card, no reroll at 63)', sd: 60, ed: 65, flags: FL | RES, log: L.x13, tag: 0x4252 },
  { name: 'resumed death 65->67 FINAL', sd: 65, ed: 67, flags: FL | FIN, log: L.x13 }];
for (const couch of [false, true]) {
  const tg = couch ? 'couch' : 'solo';
  const X = play(TT, 'r' + tg, { couch, sidN: 9425300 + (couch ? 10 : 0), rs: 942530 + (couch ? 10 : 0), passes: [[0], [2], [1]], segs: shapeR });
  if (!brk(X.rs, 4, '[3] ' + tg)) {
    eq('[3] ' + tg + ': nobody flagged', lastFlag(X), 0);
    eq('[3] ' + tg + ': all three settle', sets(X), '111');
    T('[3] ' + tg + ': the resumed death waited (reroll-lost on the dead line)', X.rs.some((r) => /reroll-lost on the run's line.*waits for it \(Q425\)/.test(linesOf(r, X.segs[2].m))), allLines(X, [2]));
    eq('[3] ' + tg + ': ladder 67', ladderBest(X, ladId(X)), 670001);
  }
  stopIfRed();
}

// ---- [4] main(): late by days / never / still flagged ----
const DAY = 24 * HOUR;
{
  const X = play(TT, 'days', { sidN: 9425400, rs: 942540, passes: [[0], [3], [2]], gaps: [2 * HOUR, 2 * HOUR, 3 * DAY], segs: (L, FL) => shape(L, FL) });
  if (!brk(X.rs, 4, '[4] three days')) {
    eq('[4] the resume three days late: nobody flagged', lastFlag(X), 0);
    T('[4] the resume three days late: the resumed line settles', settledAny(X, 2) && settledAny(X, 3), 'settled ' + sets(X) + '\n' + allLines(X));
  }
}
{
  const X = play(TT, 'never', { sidN: 9425410, rs: 942541, passes: [[0], [3]], tail: [2 * HOUR, 8 * DAY], segs: (L, FL) => shape(L, FL) });
  if (!brk(X.rs, 4, '[4] never')) {
    const last = X.rs[X.rs.length - 1];
    eq('[4] the resume never comes: nobody flagged', lastFlag(X), 0);
    T('[4] the resume never comes: waits first, then rejected (processed, not settled) past the chain wait', waitedQ425(X, 3) && procHas(last, X.segs[3].m) && !settledAny(X, 3) && /never came, nobody flagged \(Q425\)/.test(linesOf(last, X.segs[3].m)), allLines(X, [3]));
  }
}
for (const [nm, mk] of [
  ['a pick before the first checkpoint rewritten', (L, FL, ex) => ({ log: ex.z13 })],
  ['a build its log does not replay', (L, FL, ex) => ({ log: L.y13, build: (ex.yBuild + 1) >>> 0 })],
  ['after a resume at 60, a pick at depth 30 rewritten', (L, FL, ex) => ({ log: ex.b13, afterResume: true })]]) {
  const X = play(TT, 'flag' + nm.length, { sidN: 9425420 + nm.length, rs: 942542 + nm.length, passes: [[0], [1]], segs: (L, FL) => {
    const RSx = 942542 + nm.length;
    const ex = { z13: grow([otherAt(L.p12, 0, SEA, RSx, 1, FL)], 13, SEA, RSx, 1, FL, [1, 2, 3, 5]), yBuild: replayBuild(L.y13, SEA, RSx, 1, FL, 67),
      b13: grow(L.p12.slice(0, 5).concat([otherAt(L.p12, 5, SEA, RSx, 1, FL)]), 13, SEA, RSx, 1, FL, [1, 2, 3, 5]) };
    const bad = Object.assign({ name: nm + ' 65->67', sd: 65, ed: 67, flags: FL | FIN }, mk(L, FL, ex));
    const first = bad.afterResume ? { name: 'resumed 60->65', sd: 60, ed: 65, flags: FL | RES, log: L.y13, tag: 0x4253 } : { name: 'dead 60->65', sd: 60, ed: 65, flags: FL, log: L.x13 };
    delete bad.afterResume;
    return [first, bad];
  } });
  if (!brk(X.rs, 3, '[4] ' + nm)) {
    const last = X.rs[X.rs.length - 1];
    T('[4] ' + nm + ': still perk REJECT + flagged at once, processed', lastFlag(X) > 0 && procHas(last, X.segs[1].m) && !waitedQ425(X, 1), 'flags ' + lastFlag(X) + '\n' + allLines(X, [1]));
  }
}
stopIfRed();

// ---- [5] mutations: each must turn this file red ----
if (!NO_MUT) {
  const VAL = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
  const MUTS = [
    ['the after-final hook removed', "lateResume('after-final') === 'wait') return false;", "false) return false;"],
    ['the reroll-lost hook removed', "if (rc === 'reroll-lost' && lateResume('reroll-lost') === 'wait') return false;   // Q425", ''],
    ['the perk_chain hook removed', "? lateResume('perk_chain') : null;   // Q425", '? null : null;   // Q425'],
    ['a resume that never came flags again', "if (late !== 'gone') { recordFlag(", "if (true) { recordFlag("],
    ['the wait never ends', 'const gone = nowMs - (w.t0 || 0) > COMP.CHAIN_WAIT_MS;', 'const gone = false;'],
    ['the O903 cut not applied (the whole log must match)', '{ flags: fl | attest.SEG_RESUMED, startDepth: c }', '{ startDepth: c }'],
    ['C not capped by the run\'s head', 'const top = Math.min(f.startDepth | 0, run.max | 0), floor', 'const top = f.startDepth | 0, floor'],
    ['C may go behind the run\'s last resume', 'floor = Math.max(COMP.CKPT_EVERY, run.rd | 0);', 'floor = COMP.CKPT_EVERY;'],
    ['soloAdvance does not keep the last resume depth', 'run.rd = Math.max(run.rd | 0, f.startDepth | 0);', 'run.rd = run.rd;'],
    ['a burnt run waits too', 'if (!run || run.burnt) return null;', 'if (!run) return null;'],
    ['competitive / classic wait too', 'if (!run || run.burnt) return null;\n  if (!(fl & attest.SEG_CASUAL) || (fl & (attest.SEG_RESUMED | attest.SEG_COMP | attest.SEG_CLASSIC))) return null;', 'if (!run || run.burnt) return null;\n  if (fl & attest.SEG_RESUMED) return null;'],
    ['the reroll reading not cut at C (every bit of the run must be kept)', 'if (rerollChain(f, run, CASUAL_LIVES, c)) continue;', 'if (rerollChain(f, run, CASUAL_LIVES, null)) continue;'],
  ];
  for (const [label, from, to] of MUTS) {
    const n = VAL.split(from).length - 1;
    if (n !== 1) { bad('[5] mutation anchor for "' + label + '" occurs ' + n + ' times in validate.js (want 1)'); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q425-mut-'));
    try {
      require(path.join(ROOT, 'test', 'root-listing')).copyRootTree(ROOT, dir, ['.git', 'node_modules']);
      fs.copyFileSync(__filename, path.join(dir, 'test', path.basename(__filename)));   // run as the repro from outside the tree: the child is this same file
      fs.writeFileSync(path.join(dir, 'validate.js'), VAL.replace(from, () => to));
      const r = spawnSync(process.execPath, [path.join(dir, 'test', path.basename(__filename)), dir, '--no-mut', '--fail-fast'], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      const fails = ((r.stdout || '').match(/^ {2}FAIL {2}.*$/gm) || []);
      T('[5] mutation "' + label + '" -> red (' + fails.length + ' FAIL)', r.status === 1 && fails.length > 0, 'exit ' + r.status + '\n' + (r.stdout || '').slice(-1200) + (r.stderr || '').slice(-600));
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }
}

console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
