'use strict';
// ============================================================
// endless-level8-main.js -- O991 (ELP version 8, 2026-11-23) on the REAL main() (validate.js spawned against fake Steam boards, the
//   harness of test/endless-level-main.js): the chain memory carries version 8 runs (as the intake leaves them: fl ELP_R_V8) beside
//   version 7 ones; the job settles each by its own version, keeps the states and writes the v4 row; the table follows the levers.
//   [1] the live levers of version 7 (ELP_PUB_VER=7): version 8 runs settle by the grow-phase rules (lv8, r[10] / r[11]), a version 7
//       player's runs by the version 7 rules (lv only); the row on endless_rating_all is v4 for the version 8 player, v3 for the
//       version 7 one; the table stays version 7 (a 0.6.2 client keeps reading it)
//   [2] ELP_PUB_VER=8: the table carries 8 and the version 8 priors for a family without data
//   [3] the cutover (D6): ELP_CUTOVER_MS past the instant with ELP_PUB_VER=7 leaves a parked version 7 run waiting; with ELP_PUB_VER=8
//       it settles it at its save depth under version 7 (a parked version 8 run waits in both)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-level8-main-'));
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

// two players as the intake leaves them: S8 plays five version 8 runs (three placement, two points), S7 five version 7 runs
const NOW = Date.parse('2026-10-01T12:00:00Z');
function mixedWorld() {
  const st = { hist: {} }, s8 = SID(51), s7 = SID(52), p8 = P(s8), p7 = P(s7), t0 = NOW - 2 * DAY;
  [24, 31, 26, 30, 21].forEach((d, i) => v.ratingHistUpsert(st, p8, 'solo', 0, 700 + i, d, t0 + i * 3600000, F, 9700 + i, { v7: true, quit: false, v8: true }));
  [9, 6, 12, 14, 4].forEach((d, i) => v.ratingHistUpsert(st, p7, 'solo', 0, 800 + i, d, t0 + i * 3600000, F, 9800 + i, { v7: true, quit: false }));
  return { st, s8, s7, p8, p7 };
}
const soloFile = (hist) => ({ runs: {}, wait: {}, ms: {}, held: {}, hist: JSON.parse(J(hist)) });
console.log('-- O991 version 8 on the real main() --');
{
  const w = mixedWorld();
  const r1 = runCron(world([{ steamID: w.s8, score: 1, details: [0, 0, 0, 0] }, { steamID: w.s7, score: 1, details: [0, 0, 0, 0] }]), { SOLO_FILE: soloFile(w.st.hist) }, { ELP_PUB_VER: '7' });
  T('[1] run exits 0', r1.code === 0, r1.out.slice(-500));
  const hist = ((r1.state.SOLO_FILE || {}).hist || {}), h8 = hist[w.p8 + '|solo|0'], h7 = hist[w.p7 + '|solo|0'], c8 = hist[w.p8 + '|all|0'], c7 = hist[w.p7 + '|all|0'];
  const runs8 = h8 ? h8.runs : [], runs7 = h7 ? h7.runs : [];
  T('[1] the five version 8 runs settled by the grow-phase rules: ELP_R_V8 alone, states on every run, the level on lv8 (no version 7 level), placed',
    runs8.length === 5 && runs8.every((r) => r[3] === 2 && (r[7] & v.ELP_R_V8) && !(r[7] & v.ELP_R_V7) && Array.isArray(r[10]) && Array.isArray(r[11]) && (r[5] | 0) >= PP.ELP8.T_MIN)
      && c8 && c8.placed === 1 && c8.lv8 && PP.elpLevelOf8(c8.lv8.solo) && !c8.lv && J(c8.lv8.solo) === J({ L: runs8[4][11][0], Lm: runs8[4][11][1], s: runs8[4][11][2], last: runs8[4][11][3], run: runs8[4][11][4] }),
    J({ runs: runs8.map((r) => [r[3], r[7], r[5], r[4], r[10], r[11]]), c: c8 && { placed: c8.placed, lp: c8.lp, lv: c8.lv, lv8: c8.lv8 } }));
  // the version 8 placement walks from the silver line 24 by the version 8 rules (the job's settle = the model, one reading each)
  let x = PP.elpLevelInit8(null, [], null, PP.ELP8.PRIOR.solo), okWalk = true;
  runs8.slice(0, 3).forEach((r, i) => { const Tt = PP.elpTargetOfL8(x.L, 9700 + i); if ((r[5] | 0) !== Tt) okWalk = false; x = PP.elpLevelStep8(x, { pass: (r[1] | 0) >= Tt, depth: r[1] | 0, T: Tt, placing: i }); });
  T('[1] the version 8 placement targets follow the model (silver line 24, PLACE on the part past 15) and the third run seeds from its level', okWalk && runs8[2][4] === PP.elpLevelSeed8(x.L, PP.ELP8.PRIOR.solo, PP.ELP8.PRIOR.solo),
    J({ targets: runs8.map((r) => r[5]), seed: runs8[2][4], model: PP.elpLevelSeed8(x.L, PP.ELP8.PRIOR.solo, PP.ELP8.PRIOR.solo) }));
  T('[1] the five version 7 runs settled by the version 7 rules (lv, no lv8)', runs7.length === 5 && runs7.every((r) => r[3] === 2 && (r[7] & v.ELP_R_V7) && !(r[7] & v.ELP_R_V8)) && c7 && c7.placed === 1 && c7.lv && PP.elpLevelOf(c7.lv.solo) && !c7.lv8,
    J({ c: c7 && { lv: c7.lv, lv8: c7.lv8 } }));
  const w8 = postsTo(r1, RALL).find((q) => field(q, 'steamid') === w.s8), w7 = postsTo(r1, RALL).find((q) => field(q, 'steamid') === w.s7);
  const d8 = w8 ? detailsOf(w8) : [], d7 = w7 ? detailsOf(w7) : [], row8 = PP.elpRowOf(d8), row7 = PP.elpRowOf(d7);
  T('[1] the rows: v4 with the version 8 state for the version 8 player, v3 for the version 7 one (score = the points)', !!w8 && ((d8[0] >>> 8) & 0xff) === 4 && !!row8 && J(row8.lv8.solo) === J(c8.lv8.solo) && Number(field(w8, 'score')) === (c8.lp | 0)
    && !!w7 && ((d7[0] >>> 8) & 0xff) === 3 && !!row7 && J(row7.lv.solo) === J(c7.lv.solo) && row7.lv8.solo === null, J({ d8: d8.slice(0, 34), d7: d7.slice(0, 22) }));
  const tc = postsTo(r1, TIERCUT), dec = tc.length ? v.tiercutDecode(Number(field(tc[0], 'score')), detailsOf(tc[0])) : null;
  T('[1] the version 7 levers: the published table stays version 7 (the version 7 priors)', !!dec && dec.ver === 7 && J(dec.byFam.duo.pass) === J(PP.ELP7.PRIOR.duo), J(dec));
  T('[1] the settle log marks the version 8 runs', /endless points solo [0-9a-f]{8}: run [0-9a-f]+ target \d+ (passed|missed) -> [-+]\d+.*\[v8\]/.test(r1.out), r1.out.split('\n').filter((l) => /endless points solo/.test(l)).slice(0, 4).join(' | '));
  // [2] ELP_PUB_VER=8
  const r2 = runCron(world([]), { SOLO_FILE: soloFile(mixedWorld().st.hist) }, { ELP_PUB_VER: '8' });
  const tc2 = postsTo(r2, TIERCUT), dec2 = tc2.length ? v.tiercutDecode(Number(field(tc2[0], 'score')), detailsOf(tc2[0])) : null;
  T('[2] ELP_PUB_VER=8: the table carries 8 and the version 8 priors for a family without data (rulesSame for a version 8 copy)', r2.code === 0 && !!dec2 && dec2.ver === 8 && J(dec2.byFam.duo.pass) === J(PP.ELP8.PRIOR.duo) && dec2.rulesSame === true, J(dec2));
}
// [3] the cutover: a version 7 run and a version 8 run parked at a save point (no newer run, seen an hour ago). The job's clock is the
//   real one (SEASON_NOW only pins the season), so the instants are real-time
{
  const st = { hist: {} }, p7 = P(SID(53)), p8 = P(SID(54)), NOWR = Date.now();
  v.ratingHistUpsert(st, p7, 'solo', 0, 610, 9, NOWR - 3600000, SUS, 9610, { v7: true, quit: false });
  v.ratingHistUpsert(st, p8, 'solo', 0, 611, 23, NOWR - 3600000, SUS, 9611, { v7: true, quit: false, v8: true });
  const run = (env) => { const r = runCron(world([]), { SOLO_FILE: soloFile(st.hist) }, env), hs = (r.state.SOLO_FILE || {}).hist || {}; return { r, r7: (hs[p7 + '|solo|0'] || { runs: [] }).runs[0], r8: (hs[p8 + '|solo|0'] || { runs: [] }).runs[0] }; };
  const a = run({ ELP_PUB_VER: '7', ELP_CUTOVER_MS: String(NOWR - 60000) }), b = run({ ELP_PUB_VER: '8', ELP_CUTOVER_MS: String(NOWR - 60000) });
  T('[3] ELP_PUB_VER=7 + the cutover: a parked version 7 run waits (its gate is not up), a parked version 8 run waits', a.r.code === 0 && !!a.r7 && !a.r7[3] && !!a.r8 && !a.r8[3], J({ r7: a.r7, r8: a.r8 }));
  T('[3] ELP_PUB_VER=8 + the cutover: the parked version 7 run settles at its save depth under version 7 (version 7 states); the version 8 one waits',
    b.r.code === 0 && !!b.r7 && b.r7[3] === 2 && (b.r7[1] | 0) === 9 && Array.isArray(b.r7[10]) && !!PP.elpLevelOf({ L: b.r7[10][0], Lm: b.r7[10][1], s: b.r7[10][2], last: b.r7[10][3], run: b.r7[10][4] }) && !!b.r8 && !b.r8[3],
    J({ r7: b.r7, r8: b.r8 }));
}
console.log(failN ? 'FAIL (endless-level8-main) ' + failN : 'endless-level8-main: all ok');
process.exit(failN ? 1 : 0);
