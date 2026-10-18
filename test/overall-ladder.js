'use strict';
// ============================================================
// overall-ladder.js - composite ("overall") competitive endless ladder (client knife 3.5d, 2026-09-10; experimental)
// ============================================================
// One score per player across the team-size ladders: overallScore(bests) = 100 x max(solo depth, M-weighted mean over the
// PLAYED sizes of K * depth). Solo counts double (M) and floors the result (trying a team run can lift you, never pull you
// below your solo depth); team depths are discounted (K) for the extra hooks. Pure function + the cron wiring pins
// (board constant / provisioning / recompute-and-write block).
const fs = require('fs');
const path = require('path');
const V = require('../validate.js');
const assert = (label, cond) => { if (cond) console.log('  ok    ' + label); else { console.log('  FAIL  ' + label); process.exitCode = 1; } };
const eq = (label, got, exp) => assert(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp));

const pack = (depth, bank) => V.packEndlessScore(depth, bank);

console.log('== overallScore (pure) ==');
eq('nothing played -> 0', V.overallScore({}), 0);
eq('solo only: depth 12 -> 1200 (plain depth, K[0] = 1)', V.overallScore({ 1: pack(12, 5000) }), 1200);
eq('duo only: depth 20 -> 20 * 0.9 = 1800', V.overallScore({ 2: pack(20, 9000) }), 1800);
eq('trio only: depth 20 -> 20 * 0.8 = 1600', V.overallScore({ 3: pack(20, 9000) }), 1600);
eq('solo 12 + duo 20: mean(2*12, 0.9*20)/3 = 14 -> 1400 (team run lifts the solo player)', V.overallScore({ 1: pack(12, 1), 2: pack(20, 1) }), 1400);
eq('solo 12 + duo 4: mean = (24 + 3.6)/3 = 9.2 < solo 12 -> floored at 1200 (a weak team run never pulls you below solo)', V.overallScore({ 1: pack(12, 1), 2: pack(4, 1) }), 1200);
eq('solo 10 + duo 10 + trio 10: (20 + 9 + 8)/4 = 9.25 -> floored 1000', V.overallScore({ 1: pack(10, 1), 2: pack(10, 1), 3: pack(10, 1) }), 1000);
eq('duo 10 + trio 30 (no solo): (9 + 24)/2 = 16.5 -> 1650', V.overallScore({ 2: pack(10, 1), 3: pack(30, 1) }), 1650);
eq('zero-depth rows are ignored (packed 0 / depth 0)', V.overallScore({ 1: 0, 2: pack(0, 500) }), 0);
eq('bank does not matter (same depth, different bank -> same score)', [V.overallScore({ 1: pack(7, 100) }), V.overallScore({ 1: pack(7, 99999) })], [700, 700]);

console.log('== overallDominant ==');
eq('solo only -> 1', V.overallDominant({ 1: pack(5, 1) }), 1);
eq('duo 20 (18) beats solo 12 -> 2', V.overallDominant({ 1: pack(12, 1), 2: pack(20, 1) }), 2);
eq('solo 12 beats duo 13 (11.7) -> 1', V.overallDominant({ 1: pack(12, 1), 2: pack(13, 1) }), 1);
eq('tie on discounted depth -> the smaller size', V.overallDominant({ 2: pack(8, 1), 3: pack(9, 1) }), 2);   // 7.2 vs 7.2
eq('nothing -> 0', V.overallDominant({}), 0);

console.log('== constants (client RANKED_CONFIG.ENDLESS.COMP.OVERALL mirrors these; the companion repo pins both sides) ==');
eq('COMP.OVERALL', V.COMP.OVERALL, { K: [1.0, 0.9, 0.8, 0.7], M: [2, 1, 1, 1] });
eq('board name default', V.ENDLESS_COMP_LB_OVERALL, process.env.ENDLESS_COMP_LB_OVERALL || 'endless_comp_overall');

console.log('== wiring pins (validate.js) ==');
const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('provisioned up-front with the solo/team ladders (trusted) [+ casual solo ladder / casual save box, client knife 3.7a]', /\[ENDLESS_COMP_LB_OVERALL, true\], \[ENDLESS_LB_SOLO, true\], \[SAVE_BOX_LB_CASUAL, false\],\s*\n\s*\[ENDLESS_LB_CLASSIC_SOLO, true\]/.test(src));   // classic surface continues the list (client knife 3.9b N3)
assert('playtest board plan adds the overall ladder (trusted)', /add\(cfg\.compOverallLb, 1\);/.test(src) && /compOverallLb: ENDLESS_COMP_LB_OVERALL,/.test(src));
assert('lifetime board find-or-create + season twin via resolveSeasonBoard', /overallId = await findOrCreateBoard\(ENDLESS_COMP_LB_OVERALL, true\);/.test(src) && /resolveSeasonBoard\(lr, ENDLESS_COMP_LB_OVERALL, seasonId\)/.test(src));
assert('composite candidates = union of the four per-size best maps + this tick changed pools (lifetime + season) -> rollout backfill, not movers only',
  /\[changedComp, compFam\.DUO\.changed \|\| \{\}, compFam\.TRIO\.changed \|\| \{\}, compFam\.QUAD\.changed \|\| \{\}\]/.test(src) && /\[changedCompSeason, compFam\.DUO\.seasonChanged \|\| \{\}, compFam\.TRIO\.seasonChanged \|\| \{\}, compFam\.QUAD\.seasonChanged \|\| \{\}\]/.test(src)
  && /const bestMaps = season \? \[compSeasonBest, compFam\.DUO\.seasonBest \|\| \{\}, compFam\.TRIO\.seasonBest \|\| \{\}, compFam\.QUAD\.seasonBest \|\| \{\}\] : \[compBest, compFam\.DUO\.best \|\| \{\}, compFam\.TRIO\.best \|\| \{\}, compFam\.QUAD\.best \|\| \{\}\];/.test(src)
  && /const famOf = \{ 2: compFam\.DUO, 3: compFam\.TRIO, 4: compFam\.QUAD \};/.test(src) && /4: compFam\.QUAD\.best\[sid\] \| 0 \}/.test(src)
  && /const sids = \[\.\.\.new Set\(\[\.\.\.pools, \.\.\.bestMaps\]\.flatMap\(p => Object\.keys\(p\)\)\)\];/.test(src));
assert('composite board read once per tick; only rows missing or differing (score / dominant build / size) are ForceUpdated; read failure = skip, never wipe',
  /const br = await readBoardAll\(bid, label \+ ' board'\);/.test(src) && /return !c \|\| c\.s !== want\[0\] \|\| \(c\.det\[1\] \| 0\) !== want\[1\] \|\| \(c\.det\[2\] \| 0\) !== want\[2\];/.test(src)
  && /composite rows skipped this tick'\); return; \}/.test(src));
assert('score from the three per-size bests via overallScore; ForceUpdate; details = [score, dominant build, size]',
  /const s = overallScore\(bests\);/.test(src) && /return \[s \| 0, buildOf\(dom, sid, season\) \| 0, dom \| 0\];/.test(src) && /scoremethod: 'ForceUpdate', format: 'json' \}, want\);/.test(src));
assert('bulk reads keep the raw detailData hex (build at [1]) for the dominant size when it did not change this tick (O290: was e.details)',
  /compDet\[e\.steamID\] = e\.detailData;/.test(src) && /compSeasonDet\[e\.steamID\] = e\.detailData;/.test(src) && /[^n]det\[e\.steamID\] = e\.detailData;/.test(src)
  && /seasonDet\[e\.steamID\] = e\.detailData;/.test(src) && /const arr = decodeDetails\(det\);/.test(src)
  && /cur\[String\(e\.steamID\)\] = \{ s: e\.score \| 0, det: decodeDetails\(e\.detailData\) \};/.test(src));
assert('O290: no raw board entry is read through e.details (a Web API entry carries detailData; the points-row objects of readLp are {score, details})',
  !/= e\.details;/.test(src) && !/decodeDetails\(e\.details\)/.test(src));

// ---- O290 (client knife 5.1b, 2026-10-18) end to end over the REAL validate.js main() ----
//   Offline board stub (test/endless-rating.js shape) whose GetLeaderboardEntries rows have the real Web API shape: details as a
//   little-endian hex string in `detailData`. A settle-free tick does not reach the composite writer, so the fixture carries a
//   duo competitive segment (first sighting = paced, nothing settled; the run still reads every competitive board and runs the
//   composite writer over the bests it read). Expected: a composite row that is already current is NOT rewritten; a composite row
//   with build 0 gets the dominant size's build from its per-size row. The mutation self-check runs a copy of validate.js with
//   the five reads reverted to e.details and must see the opposite (the current row rewritten with build 0).
console.log('== O290 e2e: composite rows read the per-size rows through detailData ==');
{
  const { spawnSync } = require('child_process');
  const os = require('os');
  const attest = require('../attest.js');
  const VALIDATE = path.join(__dirname, '..', 'validate.js');
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
  const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
    'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
    'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
    'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_COMP_LB_OVERALL', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO',
    'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID'];
  const FILE_VARS = Array.from(new Set(Array.from(src.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
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
  function runCron(validatePath, boards) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overall-ladder-'));
    try {
      const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
      const fxPath = path.join(dir, 'fx.json');
      fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
      const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
      const base = Object.assign({}, process.env);
      for (const k of SCRUB) delete base[k];
      const stateEnv = {};
      for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
      const e = Object.assign(base, {
        STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
        SEASON_NOW: '2026-10-01T12:00:00Z',   // pre-season (season 0): lifetime composite only
        STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      }, stateEnv);
      const r = spawnSync(process.execPath, ['-r', stub, validatePath], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
      const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
      return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts };
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
  }
  const SID = (n) => '7656119800' + String(n).padStart(7, '0');
  const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const SEED = 9;
  function rec7(hash, seat, ros, sd, ed, flags) {
    const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
    for (let i = 0; i < ros.length; i++) d.push([400, 300][i]);
    d.push(0);
    for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
    d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
    return d;
  }
  function start7(hash, seat, ros) {
    const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, ros.length, 0];
    for (let i = 0; i < ros.length; i++) d.push(0);
    d.push(0);
    for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
    return d;
  }
  const ros = [SID(1), SID(2)];
  const segRows = ros.map((sid, i) => ({ sid, d: start7(0x4a01, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(0x4a01, i, ros, 0, 5, attest.SEG_COMP) })));
  const BUILD_A = 0x0102, BUILD_B = 0x0304;
  const OVERALL = 21;
  function world() {
    const boards = [];
    for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    const used = {};
    for (const r of segRows) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
    boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
      { id: 8, name: 'cp_bank', entries: ros.map(s => ({ steamID: s, score: 1000 })) },
      { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
      { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
      { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 13, name: 'endless_comp_trio', entries: [] }, { id: 17, name: 'endless_comp_quad', entries: [] },
      // per-size solo rows: [ts, build] like every endless ladder row
      { id: 20, name: 'endless_comp_solo', entries: [
        { steamID: SID(50), score: pack(12, 5000), details: [1760000000, BUILD_A] },
        { steamID: SID(51), score: pack(8, 300), details: [1760000000, BUILD_B] }] },
      // composite rows: SID(50) already current [1200, build A, size 1]; SID(51) stale with build 0 (the O290 symptom on the live boards)
      { id: OVERALL, name: 'endless_comp_overall', entries: [
        { steamID: SID(50), score: 1200, details: [1200, BUILD_A, 1] },
        { steamID: SID(51), score: 800, details: [800, 0, 1] }] },
      { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
    return boards;
  }
  const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
  const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };
  const overallWrites = (r) => { const o = {}; for (const w of r.posts) if (/SetLeaderboardScore/.test(w.url) && new RegExp('leaderboardid=' + OVERALL + '(&|$)').test(w.body)) o[field(w, 'steamid')] = { s: Number(field(w, 'score')), det: detailsOf(w) }; return o; };

  const r1 = runCron(VALIDATE, world());
  const w1 = overallWrites(r1);
  assert('O290 e2e: run exits 0 and reaches the composite writer (fresh duo segment, paced)', r1.code === 0 && /overall comp writes: /.test(r1.out));
  if (!(r1.code === 0 && /overall comp writes: /.test(r1.out))) console.log(r1.out.split('\n').slice(-25).join('\n'));
  eq('O290 e2e: only the stale composite row is written (the current one is left alone)', Object.keys(w1).sort(), [SID(51)]);
  eq('O290 e2e: the stale row gets the dominant size\'s build from the per-size row [score, build, size]', w1[SID(51)] && w1[SID(51)].det, [800, BUILD_B, 1]);

  // mutation self-check: the five reads reverted to e.details -> the current row is rewritten with build 0 (the live symptom)
  const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'overall-ladder-mut-'));
  try {
    let msrc = src;
    for (const [good, badStr] of [
      ['compDet[e.steamID] = e.detailData;', 'compDet[e.steamID] = e.details;'],
      ['compSeasonDet[e.steamID] = e.detailData;', 'compSeasonDet[e.steamID] = e.details;'],
      [' det[e.steamID] = e.detailData;', ' det[e.steamID] = e.details;'],
      ['seasonDet[e.steamID] = e.detailData;', 'seasonDet[e.steamID] = e.details;'],
      ['det: decodeDetails(e.detailData) }; }', 'det: decodeDetails(e.details) }; }'],
    ]) msrc = msrc.split(good).join(badStr);
    msrc = msrc.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
    const mpath = path.join(mdir, 'validate.js');
    fs.writeFileSync(mpath, msrc);
    const rm = runCron(mpath, world());
    const wm = overallWrites(rm);
    assert('O290 mutation self-check: reading e.details rewrites the current row with build 0 (this test goes red on the bug)',
      rm.code === 0 && wm[SID(50)] && JSON.stringify(wm[SID(50)].det) === JSON.stringify([1200, 0, 1]) && wm[SID(51)] && wm[SID(51)].det[1] === 0);
  } finally { try { fs.rmSync(mdir, { recursive: true, force: true }); } catch (err) {} }
}

if (process.exitCode) console.log('FAIL (overall-ladder)'); else console.log('ALL PASS (overall-ladder)');
