'use strict';
// ============================================================
// overall-ladder.js - composite ("overall") endless ladders: competitive (client knife 3.5d) + casual / classic (O276, knife 5.1b)
// ============================================================
// One row per player and family across the team-size ladders. Rule v2 (O276, the user's call of 10-07 #5): the BEST of K * depth
// over the played sizes -- trying another size never lowers it; team depths are discounted (K) for the extra hooks. The knife 3.5d
// rule (M-weighted mean floored at the solo depth) stays only for the playtest / demo jobs until the knife 5.1b rollout gate flips
// (V51B_PT; through Next Fest the trial's live behaviour does not change). Families: competitive (lifetime + season twin), casual
// (lifetime + season twin, endless_board_overall), classic (lifetime only, endless_classic_overall; classic rows carry no build).
//   [1] overallScore v2 (pure) + the legacy mean (overallScore(b, true) == overallScoreMean(b)) + overallDominant
//   [2] constants / board names (client RANKED_CONFIG + ENDLESS_LEVELS mirror these; the companion repo pins both sides)
//   [3] wiring pins (provisioning, the gate, the three-family writer, the reads keep detailData)
//   [4] O290 e2e over the REAL main(): a current composite row is left alone, a stale one gets its build; mutation (e.details) -> red
//   [5] O276 e2e (EA job): casual + classic composites written from their per-size bests (v2 rule, dominant build / size)
//   [6] O276 e2e (PT_MODE job, gate closed): no casual / classic composite boards or rows; the competitive composite keeps the mean
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
process.env.STATE_SALT = 's';   // same salt as the child runs below, so V.pid() addresses their state rows ([4b])
const V = require('../validate.js');
const attest = require('../attest.js');
const assert = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); process.exitCode = 1; } };
const eq = (label, got, exp) => assert(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'EXPECT ' + JSON.stringify(exp));

const pack = (depth, bank) => V.packEndlessScore(depth, bank);
const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');

console.log('== [1] overallScore v2 (pure): best of K * depth over the played sizes ==');
eq('nothing played -> 0', V.overallScore({}), 0);
eq('solo only: depth 12 -> 1200 (K[0] = 1)', V.overallScore({ 1: pack(12, 5000) }), 1200);
eq('duo only: depth 20 -> 20 * 0.9 = 1800', V.overallScore({ 2: pack(20, 9000) }), 1800);
eq('trio only: depth 20 -> 20 * 0.8 = 1600', V.overallScore({ 3: pack(20, 9000) }), 1600);
eq('quad only: depth 20 -> 20 * 0.7 = 1400', V.overallScore({ 4: pack(20, 9000) }), 1400);
eq('solo 12 + duo 20: max(12, 18) = 18 -> 1800 (was the mean 14)', V.overallScore({ 1: pack(12, 1), 2: pack(20, 1) }), 1800);
eq('solo 12 + duo 4: max(12, 3.6) -> 1200 (a weak team run changes nothing)', V.overallScore({ 1: pack(12, 1), 2: pack(4, 1) }), 1200);
eq('duo 40 then a trio try at 8: max(36, 6.4) -> 3600 (trying never lowers it; the mean gave 21.2)', V.overallScore({ 2: pack(40, 1), 3: pack(8, 1) }), 3600);
eq('duo 10 + trio 30 (no solo): max(9, 24) -> 2400', V.overallScore({ 2: pack(10, 1), 3: pack(30, 1) }), 2400);
eq('zero-depth rows are ignored (packed 0 / depth 0)', V.overallScore({ 1: 0, 2: pack(0, 500) }), 0);
eq('bank does not matter (same depth, different bank -> same score)', [V.overallScore({ 1: pack(7, 100) }), V.overallScore({ 1: pack(7, 99999) })], [700, 700]);
eq('classic packing (depth major, money tail) unpacks the same way', V.overallScore({ 2: V.packClassicScore(15, 2500000) }), 1350);
console.log('== [1] legacy mean (knife 3.5d; the gated playtest / demo jobs only) ==');
eq('legacy: solo 12 + duo 20 -> mean(2*12, 0.9*20)/3 = 14 -> 1400', V.overallScore({ 1: pack(12, 1), 2: pack(20, 1) }, true), 1400);
eq('legacy: solo 12 + duo 4 -> floored at solo 1200', V.overallScore({ 1: pack(12, 1), 2: pack(4, 1) }, true), 1200);
eq('legacy: duo 10 + trio 30 -> (9 + 24)/2 = 16.5 -> 1650', V.overallScore({ 2: pack(10, 1), 3: pack(30, 1) }, true), 1650);
eq('legacy flag == overallScoreMean', [V.overallScore({ 1: pack(10, 1), 2: pack(10, 1), 3: pack(10, 1) }, true), V.overallScoreMean({ 1: pack(10, 1), 2: pack(10, 1), 3: pack(10, 1) })], [1000, 1000]);
console.log('== [1] overallDominant (the size that carries the score; ties -> the smaller size) ==');
eq('solo only -> 1', V.overallDominant({ 1: pack(5, 1) }), 1);
eq('duo 20 (18) beats solo 12 -> 2', V.overallDominant({ 1: pack(12, 1), 2: pack(20, 1) }), 2);
eq('solo 12 beats duo 13 (11.7) -> 1', V.overallDominant({ 1: pack(12, 1), 2: pack(13, 1) }), 1);
eq('tie on discounted depth -> the smaller size', V.overallDominant({ 2: pack(8, 1), 3: pack(9, 1) }), 2);   // 7.2 vs 7.2
eq('nothing -> 0', V.overallDominant({}), 0);
{
  const b = { 1: pack(12, 1), 2: pack(20, 1), 3: pack(9, 1), 4: pack(26, 1) };
  assert('v2 score == 100 x K[dominant] x depth[dominant] (the row\'s size and build match its score)', V.overallScore(b) === Math.round(V.COMP.OVERALL.K[V.overallDominant(b) - 1] * 26 * 100) && V.overallDominant(b) === 4);
}

console.log('== [2] constants / board names ==');
eq('COMP.OVERALL (K live; M read by the legacy mean only)', V.COMP.OVERALL, { K: [1.0, 0.9, 0.8, 0.7], M: [2, 1, 1, 1] });
eq('board names (defaults)', [V.ENDLESS_COMP_LB_OVERALL, V.ENDLESS_LB_OVERALL, V.ENDLESS_LB_CLASSIC_OVERALL],
  [process.env.ENDLESS_COMP_LB_OVERALL || 'endless_comp_overall', process.env.ENDLESS_LB_OVERALL || 'endless_board_overall', process.env.ENDLESS_LB_CLASSIC_OVERALL || 'endless_classic_overall']);
eq('rollout gate closed on the playtest / demo jobs (flip on 10-27, after Next Fest)', V.V51B_PT, false);

console.log('== [3] wiring pins (validate.js) ==');
assert('gate: V51B = !PT_MODE || V51B_PT (one constant; the EA job runs the new rule now)', /const V51B_PT = false;\nconst V51B = !PT_MODE \|\| V51B_PT;/.test(src));
assert('provisioned up-front with the solo/team ladders (trusted) [+ casual solo ladder / casual save box, client knife 3.7a]', /\[ENDLESS_COMP_LB_OVERALL, true\], \[ENDLESS_LB_SOLO, true\], \[SAVE_BOX_LB_CASUAL, false\],\s*\n\s*\[ENDLESS_LB_CLASSIC_SOLO, true\]/.test(src));   // classic surface continues the list (client knife 3.9b N3)
assert('O276: the EA list provisions the casual + classic composites at its tail (trusted)', /\[ENDLESS_TIERCUT_LB, true\],\n      \[ENDLESS_LB_OVERALL, true\], \[ENDLESS_LB_CLASSIC_OVERALL, true\]\]\) \{/.test(src));
assert('playtest board plan adds the overall ladder (trusted); the casual / classic composites only once the gate flips',
  /add\(cfg\.compOverallLb, 1\);/.test(src) && /compOverallLb: ENDLESS_COMP_LB_OVERALL,/.test(src)
  && /casualOverallLb: V51B_PT \? ENDLESS_LB_OVERALL : null, classicOverallLb: V51B_PT \? ENDLESS_LB_CLASSIC_OVERALL : null,/.test(src) && /add\(cfg\.casualOverallLb, 1\); add\(cfg\.classicOverallLb, 1\);/.test(src));
assert('lifetime board find-or-create + season twin via resolveSeasonBoard (competitive; casual behind the gate; classic lifetime only)',
  /overallId = await findOrCreateBoard\(ENDLESS_COMP_LB_OVERALL, true\);/.test(src) && /resolveSeasonBoard\(lr, ENDLESS_COMP_LB_OVERALL, seasonId\)/.test(src)
  && /if \(V51B\) \{\n    casOverallId = byNameLb\(ENDLESS_LB_OVERALL\) \|\| await findOrCreateBoard\(ENDLESS_LB_OVERALL, true\);/.test(src)
  && /resolveSeasonBoard\(lr, ENDLESS_LB_OVERALL, seasonId\)\)\.id/.test(src) && /clsOverallId = byNameLb\(ENDLESS_LB_CLASSIC_OVERALL\) \|\| await findOrCreateBoard\(ENDLESS_LB_CLASSIC_OVERALL, true\);/.test(src)
  && !/resolveSeasonBoard\(lr, ENDLESS_LB_CLASSIC_OVERALL/.test(src));
assert('one writer for the three families: competitive always (legacy = !V51B), casual + classic pushed only when V51B',
  /const OVERALL_FAMS = \[\{ label: 'overall comp', id: overallId, seasonId: overallSeasonId, legacy: !V51B,/.test(src)
  && /if \(V51B\) \{\n    OVERALL_FAMS\.push\(\{ label: 'overall casual', id: casOverallId, seasonId: casOverallSeasonId, legacy: false,/.test(src)
  && /OVERALL_FAMS\.push\(\{ label: 'overall classic', id: clsOverallId, seasonId: null, legacy: false,/.test(src)
  && /for \(const F of OVERALL_FAMS\) \{ await writeOverall\(F, false\); await writeOverall\(F, true\); \}/.test(src));
assert('casual sizes = the casual ladder maps (1 solo / 2 base / 3 trio / 4 quad); classic = solo + the classic families (no season, no build)',
  /1: \{ best: endlessSoloBest, sBest: endlessSoloSeasonBest, det: endlessSoloDet, sDet: endlessSoloSeasonDet, ch: changedEndlessSolo, sCh: changedEndlessSoloSeason \},/.test(src)
  && /2: \{ best: endlessBest, sBest: endlessSeasonBest, det: endlessDet, sDet: endlessSeasonDet, ch: changedEndless, sCh: changedEndlessSeason \},/.test(src)
  && /4: \{ best: endlessQuadBest, sBest: endlessQuadSeasonBest, det: endlessQuadDet, sDet: endlessQuadSeasonDet, ch: changedEndlessQuad, sCh: changedEndlessQuadSeason \} \} \}\);/.test(src)
  && /1: \{ best: endlessClassicSoloBest, ch: changedEndlessClassicSolo \}, 2: sizeOf\(classicFam\.DUO\), 3: sizeOf\(classicFam\.TRIO\), 4: sizeOf\(classicFam\.QUAD\) \} \}\);/.test(src));
assert('composite candidates = union of the four per-size best maps + this tick\'s changed pools -> rollout backfill, not movers only',
  /const sids = \[\.\.\.new Set\(\[1, 2, 3, 4\]\.flatMap\(n => Object\.keys\(at\(n, CK\)\)\.concat\(Object\.keys\(at\(n, BK\)\)\)\)\)\];/.test(src));
assert('composite board read once per tick; only rows missing or differing (score / dominant build / size) are ForceUpdated; read failure = skip, never wipe',
  /const br = await readBoardAll\(bid, label \+ ' board'\);/.test(src) && /return !c \|\| c\.s !== want\[0\] \|\| \(c\.det\[1\] \| 0\) !== want\[1\] \|\| \(c\.det\[2\] \| 0\) !== want\[2\];/.test(src)
  && /composite rows skipped this tick'\); return; \}/.test(src));
assert('score via overallScore(bests, F.legacy); ForceUpdate; details = [score, dominant build, size]',
  /const s = overallScore\(bests, F\.legacy\);/.test(src) && /return \[s \| 0, buildOf\(dom, sid\) \| 0, dom \| 0\];/.test(src) && /scoremethod: 'ForceUpdate', format: 'json' \}, want\);/.test(src));
assert('bulk reads keep the raw detailData hex (build at [1]) for the dominant size when it did not change this tick (O290: was e.details)',
  /compDet\[e\.steamID\] = e\.detailData;/.test(src) && /compSeasonDet\[e\.steamID\] = e\.detailData;/.test(src) && /[^n]det\[e\.steamID\] = e\.detailData;/.test(src)
  && /seasonDet\[e\.steamID\] = e\.detailData;/.test(src) && /const arr = decodeDetails\(at\(n, DK\)\[sid\]\);/.test(src)
  && /cur\[String\(e\.steamID\)\] = \{ s: e\.score \| 0, det: decodeDetails\(e\.detailData\) \};/.test(src)
  && ['endlessDet', 'endlessSeasonDet', 'endlessTrioDet', 'endlessTrioSeasonDet', 'endlessQuadDet', 'endlessQuadSeasonDet', 'endlessSoloDet', 'endlessSoloSeasonDet'].every(m => src.indexOf(m + '[e.steamID] = e.detailData;') > 0));
assert('O290: no raw board entry is read through e.details (a Web API entry carries detailData; the points-row objects of readLp are {score, details})',
  !/= e\.details;/.test(src) && !/decodeDetails\(e\.details\)/.test(src));

// ---- e2e harness over the REAL validate.js main() (test/endless-rating.js shape: offline stateless board stub, rows in the Web API
//   shape -- details as a little-endian hex string in `detailData` -- every *_FILE redirected into a temp cwd) ----
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_LB_SOLO', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_COMP_LB_OVERALL', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO',
  'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'ENDLESS_LB_OVERALL', 'ENDLESS_LB_CLASSIC_OVERALL',
  'ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD'];
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
  "    if (/FindOrCreateLeaderboard/.test(u)) { const nm = /name=([^&]+)/.exec(String(init.body || '')); const have = nm ? FX.boards.find(b => b.name === decodeURIComponent(nm[1])) : null; const id = have ? have.id : nextId++; if (!have && nm) FX.boards.push({ id, name: decodeURIComponent(nm[1]), entries: [] }); return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }",
  "    if (/SetLeaderboardScore/.test(u) && FX.refuse && FX.refuse.indexOf((/steamid=([0-9]+)/.exec(String(init.body || '')) || [])[1]) >= 0) return resp({ result: { result: 27 } });",
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
function runCron(validatePath, boards, env, files, refuse) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overall-ladder-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ refuse: refuse || [], boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T12:00:00Z',   // pre-season (season 0): lifetime composites only
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, validatePath], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
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
// a fresh duo competitive segment (first sighting = paced: nothing settles, but the run reads every endless board and runs the
//   composite writers over the bests it read -- a settle-free tick never reaches them)
const ros = [SID(1), SID(2)];
const segRows = ros.map((sid, i) => ({ sid, d: start7(0x4a01, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(0x4a01, i, ros, 0, 5, attest.SEG_COMP) })));
const BOARD = { compSolo: 20, compOverall: 21, casSolo: 22, casDuo: 15, casTrio: 11, casQuad: 12, casOverall: 23, clsSolo: 24, clsDuo: 25, clsTrio: 26, clsQuad: 27, clsOverall: 28 };
function world(extra, opt) {
  const o = opt || {};
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of segRows) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] },
    { id: 8, name: 'cp_bank', entries: ros.map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: BOARD.casDuo, name: 'endless_board', entries: (extra.casDuo || []) }, { id: BOARD.casTrio, name: 'endless_board_trio', entries: (extra.casTrio || []) },
    { id: BOARD.casQuad, name: 'endless_board_quad', entries: (extra.casQuad || []) }, { id: BOARD.casSolo, name: 'endless_board_solo', entries: (extra.casSolo || []) },
    { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 13, name: 'endless_comp_trio', entries: [] }, { id: 17, name: 'endless_comp_quad', entries: [] },
    { id: BOARD.compSolo, name: 'endless_comp_solo', entries: (extra.compSolo || []) },
    { id: BOARD.compOverall, name: 'endless_comp_overall', entries: (extra.compOverall || []) },
    { id: BOARD.clsSolo, name: 'endless_classic_solo', entries: (extra.clsSolo || []) }, { id: BOARD.clsDuo, name: 'endless_classic_duo', entries: (extra.clsDuo || []) },
    { id: BOARD.clsTrio, name: 'endless_classic_trio', entries: [] }, { id: BOARD.clsQuad, name: 'endless_classic_quad', entries: [] },
    { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
  if (!o.noOverallBoards) boards.push({ id: BOARD.casOverall, name: 'endless_board_overall', entries: (extra.casOverall || []) }, { id: BOARD.clsOverall, name: 'endless_classic_overall', entries: (extra.clsOverall || []) });
  if (!o.pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };
const writesTo = (r, id) => { const o = {}; for (const w of r.posts) if (/SetLeaderboardScore/.test(w.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(w.body)) o[field(w, 'steamid')] = { s: Number(field(w, 'score')), det: detailsOf(w) }; return o; };
const created = (r, name) => r.posts.some(w => /FindOrCreateLeaderboard/.test(w.url) && field(w, 'name') === name);
const BUILD_A = 0x0102, BUILD_B = 0x0304, BUILD_C = 0x0506;

console.log('== [4] O290 e2e: composite rows read the per-size rows through detailData ==');
{
  const ex = {
    compSolo: [{ steamID: SID(50), score: pack(12, 5000), details: [1760000000, BUILD_A] }, { steamID: SID(51), score: pack(8, 300), details: [1760000000, BUILD_B] }],
    compOverall: [{ steamID: SID(50), score: 1200, details: [1200, BUILD_A, 1] }, { steamID: SID(51), score: 800, details: [800, 0, 1] }],   // SID(51) = the O290 symptom
  };
  const r1 = runCron(VALIDATE, world(ex));
  const w1 = writesTo(r1, BOARD.compOverall);
  assert('[4] run exits 0 and reaches the composite writer (fresh duo segment, paced)', r1.code === 0 && /overall comp writes: /.test(r1.out), r1.out.split('\n').slice(-25).join('\n'));
  eq('[4] only the stale composite row is written (the current one is left alone)', Object.keys(w1).sort(), [SID(51)]);
  eq('[4] the stale row gets the dominant size\'s build from the per-size row [score, build, size]', w1[SID(51)] && w1[SID(51)].det, [800, BUILD_B, 1]);
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
    const wm = writesTo(runCron(mpath, world(ex)), BOARD.compOverall);
    assert('[4] mutation self-check: reading e.details rewrites the current row with build 0 (this test goes red on the bug)',
      wm[SID(50)] && JSON.stringify(wm[SID(50)].det) === JSON.stringify([1200, 0, 1]) && wm[SID(51)] && wm[SID(51)].det[1] === 0, JSON.stringify(wm));
  } finally { try { fs.rmSync(mdir, { recursive: true, force: true }); } catch (err) {} }
}

console.log('== [4b] a composite write refused with result 27 (account no longer owns the app) is not retried for 7 days ==');
{
  const ex = {
    compSolo: [{ steamID: SID(52), score: pack(9, 1), details: [1, BUILD_A] }, { steamID: SID(53), score: pack(7, 1), details: [1, BUILD_B] }],
    compOverall: [],
  };
  const r1 = runCron(VALIDATE, world(ex), null, null, [SID(52)]);
  const w1 = writesTo(r1, BOARD.compOverall);
  const gone = ((r1.state.SOLO_FILE || {}).ovGone) || {};
  assert('[4b] tick 1: both tried; the refused account is remembered pid-keyed (no steamID in the state), no warning line for it',
    r1.code === 0 && !!(w1[SID(52)] && w1[SID(53)]) && Object.keys(gone).length === 1 && Object.keys(gone)[0] === V.pid(SID(52)) && !JSON.stringify(gone).includes(SID(52))
    && /result 27 \(no longer owns the app\) -> not retried for 7 days/.test(r1.out) && !/write overall comp \S+ failed/.test(r1.out), JSON.stringify({ w1: Object.keys(w1), gone }));
  const r2 = runCron(VALIDATE, world(ex), null, { SOLO_FILE: r1.state.SOLO_FILE }, [SID(52)]);
  const w2 = writesTo(r2, BOARD.compOverall);
  assert('[4b] tick 2: the refused account is not tried again; the other row (still missing on the stateless stub) is', r2.code === 0 && !w2[SID(52)] && !!w2[SID(53)], JSON.stringify(Object.keys(w2)));
  const old = JSON.parse(JSON.stringify(r1.state.SOLO_FILE));
  for (const k of Object.keys(old.ovGone)) old.ovGone[k] -= 8 * 86400000;
  const r3 = runCron(VALIDATE, world(ex), null, { SOLO_FILE: old }, []);
  assert('[4b] after 7 days the account is tried again (and the stale mark pruned)', r3.code === 0 && !!writesTo(r3, BOARD.compOverall)[SID(52)] && !Object.keys(((r3.state.SOLO_FILE || {}).ovGone) || {}).length);
}

console.log('== [5] O276 e2e (EA job): casual + classic composites from their per-size bests ==');
{
  const ex = {
    // casual: SID(60) solo 10 + duo 30 -> max(10, 27) = 2700 dominant 2 build C; SID(61) quad 40 -> 2800 dominant 4 build B;
    //   SID(62) solo 9 with a current composite row -> left alone
    casSolo: [{ steamID: SID(60), score: pack(10, 1), details: [1, BUILD_A] }, { steamID: SID(62), score: pack(9, 1), details: [1, BUILD_A] }],
    casDuo: [{ steamID: SID(60), score: pack(30, 1), details: [1, BUILD_C] }],
    casQuad: [{ steamID: SID(61), score: pack(40, 1), details: [1, BUILD_B] }],
    casOverall: [{ steamID: SID(62), score: 900, details: [900, BUILD_A, 1] }],
    // classic: SID(70) solo 20 ([bank, 0]) + duo 25 -> max(20, 22.5) = 2250 dominant 2, build 0
    clsSolo: [{ steamID: SID(70), score: V.packClassicScore(20, 1200000), details: [1200000, 0] }],
    clsDuo: [{ steamID: SID(70), score: V.packClassicScore(25, 2600000), details: [2600000, 0] }],
  };
  const r = runCron(VALIDATE, world(ex));
  const wc = writesTo(r, BOARD.casOverall), wk = writesTo(r, BOARD.clsOverall);
  assert('[5] run exits 0; both writers ran', r.code === 0 && /overall casual writes: /.test(r.out) && /overall classic writes: /.test(r.out), r.out.split('\n').filter(l => /overall/.test(l)).join(' | '));
  eq('[5] casual composite: only the moved / new rows (SID 60, 61), the current one (62) untouched', Object.keys(wc).sort(), [SID(60), SID(61)].sort());
  eq('[5] casual SID 60: solo 10 + duo 30 -> [2700, duo build, 2]', wc[SID(60)] && wc[SID(60)].det, [2700, BUILD_C, 2]);
  eq('[5] casual SID 61: quad 40 only -> [2800, quad build, 4]', wc[SID(61)] && wc[SID(61)].det, [2800, BUILD_B, 4]);
  eq('[5] classic composite SID 70: solo 20 + duo 25 -> [2250, 0, 2] (classic rows carry no build)', wk[SID(70)] && wk[SID(70)].det, [2250, 0, 2]);
  eq('[5] classic composite is lifetime only (no season twin resolved even in a season)', /seasonal overall classic/.test(r.out), false);
  const r2 = runCron(VALIDATE, world(ex, { noOverallBoards: true }));
  assert('[5] the casual / classic composite boards are provisioned on the EA job when missing (trusted)', created(r2, 'endless_board_overall') && created(r2, 'endless_classic_overall'));
}

console.log('== [6] O276 e2e (PT_MODE job, gate closed): the trial keeps the knife 3.5d behaviour ==');
{
  const ex = {
    compSolo: [{ steamID: SID(80), score: pack(12, 1), details: [1, BUILD_A] }],
    casSolo: [{ steamID: SID(60), score: pack(10, 1), details: [1, BUILD_A] }],
    clsSolo: [{ steamID: SID(70), score: V.packClassicScore(20, 1200000), details: [1200000, 0] }],
  };
  // the competitive composite on the trial: SID(80) solo 12 + duo 20 -> the MEAN rule (1400), not the v2 best (1800)
  const duoRow = { steamID: SID(80), score: pack(20, 1), details: [1, BUILD_B] };
  const boards = world(ex, { pt: true, noOverallBoards: true });
  boards.find(b => b.name === 'endless_comp_duo').entries.push(duoRow);
  const r = runCron(VALIDATE, boards, { PT_MODE: '1', RANKED_LB: 'rating', LP_LB: 'points', DEMO_APPID: '2', APPID: '2', PT_SHARD_COUNT: '50' });
  const wo = writesTo(r, BOARD.compOverall);
  assert('[6] run exits 0 in PT_MODE', r.code === 0, r.out.split('\n').slice(-20).join('\n'));
  eq('[6] competitive composite keeps the mean rule on the trial (solo 12 + duo 20 -> 1400, dominant 2)', wo[SID(80)] && wo[SID(80)].det, [1400, BUILD_B, 2]);
  assert('[6] no casual / classic composite board created and no such writer ran on the trial', !created(r, 'endless_board_overall') && !created(r, 'endless_classic_overall') && !/overall casual writes|overall classic writes/.test(r.out));
}

if (process.exitCode) console.log('FAIL (overall-ladder)'); else console.log('ALL PASS (overall-ladder)');
