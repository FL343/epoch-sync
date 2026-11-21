'use strict';
// ============================================================
// endless-level-main.js -- O942 (ELP version 7, 2026-11-21) on the REAL main() (validate.js spawned against fake Steam boards, the
//   harness of test/endless-rating.js): the chain memory carries version 7 runs (as the intake leaves them: fl ELP_R_V7), the job
//   settles them under the level rules, keeps the states and writes the v3 row; the published table follows the two levers.
//   [1] lever off (default): version 7 runs settle by the level rules; the row on endless_rating_all is v3 with the level state; the
//       table stays version 6 (the version 6 priors), so a version 6 client keeps reading it
//   [2] ELP_PUB_VER=7: the table carries 7 and the version 7 priors for a family without data
//   [3] ELP_CUTOVER_MS: a version 6 run parked at a save point settles on the first run past the instant; before it, it waits
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'SEASON_NOW', 'ELP_IDLE_MS', 'COUCH_DUO',
  'ENDLESS_RATING_LB', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER', 'GITHUB_STEP_SUMMARY'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const PP = require(path.join(__dirname, '..', 'points-plan.js'));
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = (x) => JSON.stringify(x);
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (sid) => v.pid(sid);
const F = 2, SUS = 1, DAY = 86400000;
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
  '    if (/FindOrCreateLeaderboard/.test(u)) { const nm = /name=([^&]+)/.exec(String(init.body || \'\')); const have = nm ? FX.boards.find(b => b.name === decodeURIComponent(nm[1])) : null; const id = have ? have.id : nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
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
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-level-main-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T12:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const CARRIER = SID(777), RALL = 34, TIERCUT = 41;
function world(allRows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
    { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 13, name: 'endless_comp_trio', entries: [] }, { id: 17, name: 'endless_comp_quad', entries: [] },
    { id: RALL, name: 'endless_rating_all', entries: allRows || [] },
    { id: 30, name: 'endless_rating_solo', entries: [] }, { id: 31, name: 'endless_rating_duo', entries: [] }, { id: 32, name: 'endless_rating_trio', entries: [] }, { id: 33, name: 'endless_rating_quad', entries: [] },
    { id: TIERCUT, name: 'endless_tiercut', entries: [] },
    { id: 40, name: 'version_gate', entries: [{ steamID: CARRIER, score: 2026100101 }] });
  return boards;
}
const postsTo = (r, boardId, kind) => r.posts.filter(x => new RegExp(kind || 'SetLeaderboardScore').test(x.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(x.body));
const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };

// a player's version 7 runs as the intake leaves them (final segments, the version bit): three placement runs and two points runs
const NOW = Date.parse('2026-10-01T12:00:00Z');
function v7World() {
  const st = { hist: {} }, sid = SID(41), p = P(sid), t0 = NOW - 2 * DAY;
  [[9, 6], [3, 11], [12, 12], [14, 14], [4, 15]].forEach(([d], i) => v.ratingHistUpsert(st, p, 'solo', 0, 500 + i, d, t0 + i * 3600000, F, 9000 + i, { v7: true, quit: false }));
  return { st, sid, p };
}
console.log('-- O942 version 7 on the real main() --');
{
  const { st, sid, p } = v7World();
  const solo = { runs: {}, wait: {}, ms: {}, held: {}, hist: st.hist };
  const r1 = runCron(world([{ steamID: sid, score: 1, details: [0, 0, 0, 0] }]), { SOLO_FILE: solo });   // a stale row: the job rewrites the rows it holds the account of
  T('[1] run exits 0', r1.code === 0, r1.out.slice(-500));
  const hist = ((r1.state.SOLO_FILE || {}).hist || {}), h = hist[p + '|solo|0'], c = hist[p + '|all|0'];
  const runs = h ? h.runs : [];
  T('[1] the five version 7 runs settled by the level rules: the version bit kept, the states before / after on every run, the level on the points entry',
    runs.length === 5 && runs.every((r) => r[3] === 2 && (r[7] & v.ELP_R_V7) && Array.isArray(r[10]) && Array.isArray(r[11])) && c && c.placed === 1 && c.lv && PP.elpLevelOf(c.lv.solo) && J(c.lv.solo) === J({ L: runs[4][11][0], Lm: runs[4][11][1], s: runs[4][11][2], last: runs[4][11][3], run: runs[4][11][4] }),
    J({ runs: runs.map((r) => [r[3], r[7], r[5], r[4], r[10], r[11]]), c: c && { placed: c.placed, lp: c.lp, lv: c.lv } }));
  const w = postsTo(r1, RALL).find((x) => field(x, 'steamid') === sid);
  const det = w ? detailsOf(w) : [], row = PP.elpRowOf(det);
  T('[1] the row on endless_rating_all is v3 and carries the solo level state (score = the points)', !!w && ((det[0] >>> 8) & 0xff) === 3 && !!row && J(row.lv.solo) === J(c.lv.solo) && Number(field(w, 'score')) === (c.lp | 0),
    J({ det: det.slice(0, 20), lp: c && c.lp }));
  const tc = postsTo(r1, TIERCUT);
  const dec = tc.length ? v.tiercutDecode(Number(field(tc[0], 'score')), detailsOf(tc[0])) : null;
  T('[1] lever off: the published table stays version 6 (the version 6 priors), so a version 6 client keeps reading it', !!dec && dec.ver === 6 && J(dec.byFam.duo.pass) === J(PP.ELP.PRIOR.duo), J(dec));
  // [2] ELP_PUB_VER=7
  const r2 = runCron(world([]), { SOLO_FILE: { runs: {}, wait: {}, ms: {}, held: {}, hist: v7World().st.hist } }, { ELP_PUB_VER: '7' });
  const tc2 = postsTo(r2, TIERCUT), dec2 = tc2.length ? v.tiercutDecode(Number(field(tc2[0], 'score')), detailsOf(tc2[0])) : null;
  T('[2] ELP_PUB_VER=7: the table carries 7 and the version 7 priors for a family without data', r2.code === 0 && !!dec2 && dec2.ver === 7 && J(dec2.byFam.duo.pass) === J(PP.ELP7.PRIOR.duo), J(dec2));
}
// [3] the cutover: a version 6 run parked at a save point (no newer run, seen an hour ago). The job's clock is the real one (SEASON_NOW only
//   pins the season), so the instants here are real-time
{
  const st = { hist: {} }, sid = SID(42), p = P(sid), NOWR = Date.now();
  v.ratingHistUpsert(st, p, 'solo', 0, 600, 7, NOWR - 3600000, SUS, 9600);
  const mk = () => ({ runs: {}, wait: {}, ms: {}, held: {}, hist: JSON.parse(JSON.stringify(st.hist)) });
  const before = runCron(world([]), { SOLO_FILE: mk() }, { ELP_CUTOVER_MS: String(NOWR + 3600000) });
  const after = runCron(world([]), { SOLO_FILE: mk() }, { ELP_CUTOVER_MS: String(NOWR - 60000) });
  const rb = (((before.state.SOLO_FILE || {}).hist || {})[p + '|solo|0'] || { runs: [] }).runs[0], ra = (((after.state.SOLO_FILE || {}).hist || {})[p + '|solo|0'] || { runs: [] }).runs[0];
  T('[3] ELP_CUTOVER_MS: a parked version 6 run waits before the instant and settles past it (at its save depth, version 6: no states)', !!rb && !rb[3] && !!ra && ra[3] === 2 && (ra[1] | 0) === 7 && ra[10] == null,
    J({ before: rb, after: ra }));
}
console.log(failN ? 'FAIL (endless-level-main) ' + failN : 'endless-level-main: all ok');
process.exit(failN ? 1 : 0);
