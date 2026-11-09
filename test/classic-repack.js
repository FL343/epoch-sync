'use strict';
// O569 (the user's 10-27 ruling: a classic ladder ranks the same depth by money, the same money by time). The classic ladders
//   (endless_classic_solo / _duo / _trio / _quad) packed depth x 10000 + bank / 100,000: under $100,000 every run of a depth tied
//   (the demo's depth-20 cap goal is $42,325), so the top rows all read 200000 and Steam ranked them by arrival ($44,389 above
//   $55,580). The tail now counts the bank in 1/2000ths of the one-player goal line at that depth (packClassicScore), capped at
//   5x the line; the depth half is unchanged. Rows written before it are read through classicRowScore (their exact bank is
//   details[0]) and rewritten in the new key, CLASSIC_REPACK_CAP a run, highest first, their own details passed back.
//   [1] units: the user's two rows, the step and the cap, depth first, exact integers (BigInt), the new key never below the old
//       one (a pending the client holds in the old key still confirms), classicRowScore idempotent / rows it leaves alone,
//       classicRepackPlan (skip, order, cap), the ladder names
//   [2] over the REAL validate.js main() against an offline board stub (the harness of test/endless-best-owed.js): a classic duo
//       board of rows in the old key, a co-op classic run of A and B: A's better old run is not overwritten by a poorer one of
//       the same depth (it only looked lower in the old key), B's new best is written once and not undone by the rewrite,
//       the rewrite goes highest first, at most the cap a run, details byte for byte, a row without details and a row already
//       in the new key are never written; the quiet runs finish the rest, then nothing more is written; the user's two rows
//       end in money order
//   [3] a waiting best write of the Q319 backlog in the old key is written in the new one; a dry run / CAP 0 writes no rewrite;
//       a quiet run outside its slot reads nothing
//   [3b] with Q334 (writes laid ahead in the backlog): one laid ahead in the old key by a run that ended goes out in the new key
//       (never landed) or is found on the board and not sent again (landed); the settle lays only real new bests, in the new key
//   [4] mutants: rows not repacked on read / no rewrite / no cap / no skip / backlog not repacked / no quiet rewrite / Q319 retry
//       row not repacked
//   [5] wiring pins
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_LB_SOLO', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD',
  'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'START_CONFIRM_MS',
  'LP_LAST_HOLD_MS', 'PAGE_CAP', 'CLASSIC_REPACK_CAP', 'CLASSIC_REPACK_EVERY'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

// ---- the harness of test/endless-best-owed.js (offline board stub, the real main() per run, boards carried over) ----
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const S0_NOW = '2026-10-01T12:00:00Z', S1_NOW = '2026-12-10T12:00:00Z', WEEK = v.cupWeekId(Date.parse(S1_NOW));
// the endless best boards the world keeps (every other board the job may create reads empty and is not followed)
const EN = 15, EN3 = 11, EN4 = 12, COMP2 = 16, COMP3 = 13, COMP4 = 17, CLS2 = 20, CLS3 = 21, CLS4 = 22, OV_COMP = 30, OV_CAS = 31, OV_CLS = 32, EN_S1 = 23, COMP2_S1 = 24, COMP2_W = 25;
const BEST = { [EN]: 'endless_board', [EN3]: 'endless_board_trio', [EN4]: 'endless_board_quad', [COMP2]: 'endless_comp_duo', [COMP3]: 'endless_comp_trio', [COMP4]: 'endless_comp_quad',
  [CLS2]: 'endless_classic_duo', [CLS3]: 'endless_classic_trio', [CLS4]: 'endless_classic_quad', [OV_COMP]: 'endless_comp_overall', [OV_CAS]: 'endless_board_overall', [OV_CLS]: 'endless_classic_overall',
  [EN_S1]: 'endless_board_s1', [COMP2_S1]: 'endless_comp_duo_s1', [COMP2_W]: v.cupWeekBoardName('endless_comp_duo', WEEK) };
// STUB_INJECT, this run only: { post: { <board id>: { <sid>: [o1, o2, ...] } } } -- his n-th write to that board this run answers
//   o_n = [status | 'throw', applied] (null or absent: normally), Steam keeping it when `applied`
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const INJ = JSON.parse(process.env.STUB_INJECT || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'const seen = {};',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1], bid = (/leaderboardid=([0-9]+)/.exec(body) || [])[1];",
  '    const set = /SetLeaderboardScore/.test(u);',
  "    const k = bid + ':' + sid; if (set) seen[k] = (seen[k] || 0) + 1;",
  '    const f = set && INJ.post && INJ.post[bid] && INJ.post[bid][sid] ? INJ.post[bid][sid][seen[k] - 1] || null : null;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: f ? !!f[1] : true, failed: f ? f[0] : 0 }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: had ? had.id : nextId++ } } });',
  '    }',
  "    if (f) { if (f[0] === 'throw') throw new Error('injected network error'); return resp({ error: 'injected' }, f[0]); }",
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const bid = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[bid];',
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
function runCron(script, boards, files, inject, envExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-repack-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json'); fs.writeFileSync(fxPath, JSON.stringify({ boards }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: S0_NOW, STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
      STUB_INJECT: JSON.stringify(inject || {}),
    }, envExtra || {}, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    if (state.PENDING_WRITES_FILE) { const V807 = require(path.join(__dirname, '..', 'validate.js')); state.PENDING_WRITES_FILE = V807.pwMapNames(state.PENDING_WRITES_FILE, V807.pwOpenName, e.STATE_SALT); }   // O807: board names are sealed on disk
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// the chain memories age by the step between runs (a start attestation's first sighting, the pacing clocks, a backlog entry's times)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) { const ew = pw[k] && pw[k].ew; if (ew) for (const b of Object.keys(ew)) if (ew[b] && ew[b].t) ew[b].t -= ms; }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9, MIN = 60000;
function rec7(hash, seat, ros, sd, ed, flags, sc, season) {
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push(sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, season | 0, flags | 0);
  return d;
}
function start7(hash, seat, ros) {
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, ros.length, 0];
  for (let i = 0; i < ros.length; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const SEG_COMP = 8, SEG_CLASSIC = 32;
function world(opt) {
  const w = { recs: [], b: {}, state: null, log: [], hn: 0x5190, script: (opt && opt.script) || null, env: (opt && opt.env) || {}, files: (opt && opt.files) || null };
  for (const id of Object.keys(BEST)) w.b[id] = {};
  for (const id of Object.keys((opt && opt.rows) || {})) Object.assign(w.b[id], opt.rows[id]);
  return w;
}
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, detailData: hexLE(r.d) }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [SID(1), SID(2)].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
  for (const id of Object.keys(BEST)) boards.push({ id: Number(id), name: BEST[id], entries: Object.keys(w.b[id]).map((s) => ({ steamID: s, score: w.b[id][s].score | 0, detailData: w.b[id][s].hex || '' })) });
  return boards;
}
const bodyHex = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };
function step(w, ms, inject, envExtra) {
  if (w.state && w.state.__failed) return null;
  const files = w.state ? advance(w.state, ms) : w.files;
  const r = runCron(w.script, boardsOf(w), files, inject, Object.assign({}, w.env, envExtra || {}));
  w.log.push(r);
  if (r.code !== 0) { w.state = { __failed: true }; return r; }
  if (!(envExtra && envExtra.APPLY_MMR === '0')) w.state = r.state;
  for (const p of r.posts) {
    if (!p.applied) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1], sid = (/steamid=([0-9]+)/.exec(p.body) || [])[1];
    if (!w.b[bid]) continue;
    if (/SetLeaderboardScore/.test(p.url)) w.b[bid][sid] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
    else if (/DeleteLeaderboardScore/.test(p.url)) delete w.b[bid][sid];
  }
  return r;
}
const A = SID(1), B = SID(2), ROS = [A, B];
// one co-op run of A and B (seat 0 = A) from depth sd to ed, both writing it: the starts and results go up together, the first run
//   sights it (paced; injSight), the next one -- `gap` later (default 10 minutes) -- settles it (injSettle). Returns its match key.
function run(w, flags, ed, sc, injSettle, o) {
  o = o || {};
  const h = ++w.hn;
  w.recs.push({ sid: A, d: start7(h, 0, ROS) }, { sid: B, d: start7(h, 1, ROS) }, { sid: A, d: rec7(h, 0, ROS, o.sd | 0, ed, flags, sc, o.season) }, { sid: B, d: rec7(h, 1, ROS, o.sd | 0, ed, flags, sc, o.season) });
  step(w, 5 * MIN, o.injSight || null, o.env);
  step(w, o.gap || 10 * MIN, injSettle || null, o.env);
  return h + '_' + SEED + '_7';
}
const quiet = (w, n, inject, env) => { for (let i = 0; i < n; i++) step(w, 5 * MIN, inject || null, env); };
const fine = (w) => !(w.state && w.state.__failed) && w.log.every((r) => r.code === 0);
const row = (w, bid, s) => (w.b[bid][s] ? w.b[bid][s].score : null);
const outOf = (w) => w.log.map((r) => r.out).join('\n');

const SC = 10000, OLD = (d, bank) => d * SC + Math.min(SC - 1, Math.floor(Math.max(0, bank) / 100000));   // the pre-O569 key
const NEW_BIG = (d, bank) => { const g = BigInt(v.classicGoalAt(Math.max(1, d))); const t = BigInt(Math.max(0, bank)) * 2000n / g; return d * SC + Number(t > 9999n ? 9999n : t); };

// ---- [1] units ----
{
  eq('[1] the user\'s two depth-20 rows ($55,580 / $44,389) in the old key / the new key', [OLD(20, 55580), OLD(20, 44389), v.packClassicScore(20, 55580), v.packClassicScore(20, 44389)], [200000, 200000, 202626, 202097]);
  const g20 = v.classicGoalAt(20);
  eq('[1] TIE_PER_GOAL 2000 (one step = 1/2000 of the goal line: $21.16 at depth 20) / the goal line of depth 20', [v.CLASSIC.TIE_PER_GOAL, g20], [2000, 42325]);
  T('[1] one step apart: $22 more at depth 20 is one tail step up, $21 more may be the same step', v.packClassicScore(20, 44389 + 22) === v.packClassicScore(20, 44389) + 1 || v.packClassicScore(20, 44389 + 22) === v.packClassicScore(20, 44389) + 2);
  eq('[1] the cap at 5x the goal line (9999) / just under it / the most an int bank can be / a negative bank / depth 0 counts against the depth-1 line',
    [v.packClassicScore(20, g20 * 5), v.packClassicScore(20, g20 * 5 - 22), v.packClassicScore(20, 2147483647), v.packClassicScore(20, -5), v.packClassicScore(0, 650)], [209999, 209998, 209999, 200000, 2000]);
  T('[1] depth first: one level deeper with no money ranks above the richest run of the level before', v.packClassicScore(21, 0) > v.packClassicScore(20, 2147483647));
  let rnd = 0x9e3779b9; const R = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd; };
  let exact = true, mono = true, notBelow = true, firstBad = null;
  for (let i = 0; i < 20000; i++) {
    const d = 1 + (R() % 5000), bank = R() % 2147483648;
    const a = v.packClassicScore(d, bank);
    if (a !== NEW_BIG(d, bank)) { exact = false; firstBad = firstBad || [d, bank, a, NEW_BIG(d, bank)]; }
    if (v.packClassicScore(d, bank + 1) < a) mono = false;
    if (d <= 2000 && a < OLD(d, bank)) { notBelow = false; firstBad = firstBad || ['below', d, bank]; }
  }
  T('[1] exact integers: 20000 random (depth 1..5000, bank 0..2^31) equal the BigInt floor (no float rounding either side)', exact, JSON.stringify(firstBad));
  T('[1] more money never ranks lower at the same depth (sampled)', mono);
  T('[1] the new key is never below the old one up to depth 2000 (goal < 2e8): a pending the old client holds still confirms against the rewritten row', notBelow, JSON.stringify(firstBad));
  // classicRowScore
  const det = [55580, 2026100101, 7, 8, 9];
  eq('[1] classicRowScore: an old row -> the new key / a new-key row unchanged (idempotent) / no details / an empty array / a negative bank / a negative score (as read)',
    [v.classicRowScore(200000, det), v.classicRowScore(202626, det), v.classicRowScore(200000, null), v.classicRowScore(200000, []), v.classicRowScore(200000, [-1]), v.classicRowScore(-3, det)],
    [202626, 202626, 200000, 200000, 200000, -3]);
  let idem = true;
  for (let i = 0; i < 5000; i++) { const d = R() % 3000, b = R() % 2147483648, o = OLD(d, b), n = v.classicRowScore(o, [b]); if (v.classicRowScore(n, [b]) !== n || Math.floor(n / SC) !== d) idem = false; }
  T('[1] classicRowScore keeps the depth and repacks once (5000 random old rows: a second pass changes nothing)', idem);
  // classicRepackPlan
  const rows = [{ sid: '3', s: 70500, was: 70000 }, { sid: '1', s: 202626, was: 200000 }, { sid: '2', s: 202097, was: 200000 }, { sid: '9', s: 50000, was: 50000 }, { sid: '0', s: 202097, was: 200000 }, { sid: '5', s: 92068, was: 90000 }];
  eq('[1] classicRepackPlan: unchanged rows dropped, highest first (ties by sid), cap 3', v.classicRepackPlan(rows, 3).map((r) => r.sid), ['1', '0', '2']);
  eq('[1] classicRepackPlan: skip(row) drops it before the cap / cap 0 = nothing', [v.classicRepackPlan(rows, 3, (r) => r.sid === '0').map((r) => r.sid), v.classicRepackPlan(rows, 0).length], [['1', '2', '5'], 0]);
  eq('[1] the four classic ladders and no other board', ['endless_classic_solo', 'endless_classic_duo', 'endless_classic_trio', 'endless_classic_quad', 'endless_board', 'endless_classic_overall', 'endless_comp_duo'].map(v.isClassicLadder),
    [true, true, true, true, false, false, false]);
  const hx = (arr) => arr.map((n) => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
  eq('[1] ladderRowScore: no entry / a classic row repacked / another board as read', [v.ladderRowScore('endless_classic_duo', null), v.ladderRowScore('endless_classic_duo', { score: 200000, detailData: hx(det) }), v.ladderRowScore('endless_board', { score: 200000, detailData: hx(det) })],
    [null, 202626, 200000]);
  eq('[1] defaults: CLASSIC_REPACK_CAP 300 a run, a quiet run repacks in one five-minute slot of 12 (hourly)', [v.CLASSIC_REPACK_CAP, v.CLASSIC_REPACK_EVERY], [300, 12]);
}

// ---- [2] the rewrite over the real main() ----
const C = SID(3), D = SID(4), E = SID(5), F = SID(6), G = SID(7), X = SID(8), H = SID(10), I = SID(11), J = SID(12);
const BUILD = 2026100101;
const oldRow = (d, bank, extra) => { const det = [bank, BUILD].concat(extra || []); return { score: OLD(d, bank), hex: hexLE(det), det }; };
const CDEEP5 = [2600, 2200], C5 = v.packClassicScore(5, 4800);
function classicWorld(env, files) {
  const rows = {
    [A]: oldRow(5, 9000, [7]),          // a better depth-5 run of A's ($9,000) that reads lower in the old key (50000) than the coming $4,800 run in the new one (52157)
    [B]: oldRow(5, 4000, [7]),          // B's old best, beaten by the coming run ($4,000 < $4,800 at depth 5; still in the old key at its settle)
    [C]: oldRow(20, 55580, [1, 2, 3]),  // the user's two rows: tied 200000, ranked by arrival
    [D]: oldRow(20, 44389, [4, 5, 6]),
    [E]: oldRow(7, 9000),
    [H]: oldRow(3, 2000), [I]: oldRow(2, 1000), [J]: oldRow(1, 500),   // low rows: H / I go with the settle, J is left to the quiet runs
    [F]: { score: 30000, hex: '' },     // no details: left as it stands
    [G]: { score: v.packClassicScore(9, 13000), hex: hexLE([13000, BUILD]) },   // already in the new key
  };
  return world({ rows: { [CLS2]: rows }, env: Object.assign({ CLASSIC_REPACK_EVERY: '1000003' }, env || {}), files });
}
const repackWrites = (r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + CLS2 + '(&|$)').test(p.body))
  .map((p) => ({ sid: (/steamid=([0-9]+)/.exec(p.body) || [])[1], s: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) }));
const want = { [A]: v.packClassicScore(5, 9000), [B]: C5, [C]: 202626, [D]: 202097, [E]: v.packClassicScore(7, 9000), [H]: v.packClassicScore(3, 2000), [I]: v.packClassicScore(2, 1000), [J]: v.packClassicScore(1, 500), [F]: 30000, [G]: v.packClassicScore(9, 13000) };
function course2(script, env) {
  const w = classicWorld(Object.assign({ CLASSIC_REPACK_CAP: '3' }, env || {}));
  if (script) w.script = script;
  run(w, SEG_CLASSIC, 5, CDEEP5);
  const afterRun = {}; for (const s of Object.keys(want)) afterRun[s] = row(w, CLS2, s);
  quiet(w, 3, null, { CLASSIC_REPACK_EVERY: '1' });
  const afterQuiet = w.log.length;
  quiet(w, 1, null, { CLASSIC_REPACK_EVERY: '1' });
  return { w, afterRun, afterQuiet };
}
const ref = course2();
{
  const w = ref.w;
  T('[2] (the course ran: a co-op classic run sighted and settled, three quiet runs, one more)', fine(w) && w.log.length === 6, w.log.map((r) => r.code).join(','));
  const fin = {}; for (const s of Object.keys(want)) fin[s] = row(w, CLS2, s);
  eq('[2] every row ends in the new key: A keeps his $9,000 depth-5 run, B gets the new $4,800 depth-5 best, C / D / E / H / I / J repacked, F (no details) and G (new key) as they were', fin, want);
  T('[2] the user\'s two rows end in money order ($55,580 above $44,389)', fin[C] > fin[D]);
  const all = w.log.map(repackWrites);
  const of = (s) => all.reduce((a, ws) => a.concat(ws.filter((x) => x.sid === s)), []);
  eq('[2] A: never written with the poorer run (one rewrite to his own row in the new key, his details back) ', of(A).map((x) => [x.s, x.hex]), [[want[A], hexLE([9000, BUILD, 7])]]);
  eq('[2] B: one write, the new best (the rewrite of his old row is skipped: this run writes him)', of(B).map((x) => x.s), [C5]);
  eq('[2] C / D / E / J: one rewrite each, details byte for byte', [C, D, E, J].map((s) => of(s).map((x) => [x.s, x.hex])),
    [[[202626, hexLE([55580, BUILD, 1, 2, 3])]], [[202097, hexLE([44389, BUILD, 4, 5, 6])]], [[want[E], hexLE([9000, BUILD])]], [[want[J], hexLE([500, BUILD])]]]);
  eq('[2] F (no details) / G (already in the new key): never written', [of(F).length, of(G).length], [0, 0]);
  const perRun = all.map((ws) => ws.filter((x) => x.sid !== B || x.s !== C5).map((x) => x.sid));
  eq('[2] the rewrites run by run (cap 3, highest first; B skipped at his settle, this run writes him): sight C D E / settle A H I / quiet J / nothing',
    perRun, [[C, D, E], [A, H, I], [J], [], [], []]);
  eq('[2] after the run: J still in the old key until a quiet run', [ref.afterRun[J], ref.afterRun[I]], [OLD(1, 500), want[I]]);
  eq('[2] the last quiet run writes nothing to the board (all rows in the new key)', repackWrites(w.log[ref.afterQuiet]).length, 0);
  eq('[2] the run log says what it did', outOf(w).split('\n').filter((l) => /classic repack/.test(l)).map((l) => l.trim()),
    ['classic repack (settle): 3/3 rows rewritten in the new key, 5 left (O569)', 'classic repack (settle): 3/3 rows rewritten in the new key, 1 left (O569)', 'classic repack (quiet): 1/1 rows rewritten in the new key, 0 left (O569)']);
  eq('[2] the run summary row (O569), run by run', w.log.map((r) => { const m = /\| classic ladder rows in the old key rewritten \/ planned this run \/ still in the old key after it \(O569\) \| ([^|]*) \|/.exec(r.summary); return m ? m[1].trim() : null; }),
    ['3 / 3 / 5', '3 / 3 / 1', '1 / 1 / 0', '-', '-', '-']);
}

// ---- [3] the backlog, a dry run, CAP 0, a quiet run outside its slot ----
{
  const ewOld = OLD(6, 7000), ewNew = v.packClassicScore(6, 7000);
  const files = { PENDING_WRITES_FILE: { [v.pid(X)]: { ew: { endless_classic_duo: { v: ewOld, ts: 7000, bd: BUILD, t: Date.now() - 60000, n: 1 } } } } };
  const w = classicWorld({ CLASSIC_REPACK_CAP: '0' }, files);
  w.recs.push({ sid: X, d: start7(0x7777, 0, [X, SID(9)]) });   // X writes something this run (the job knows his account), nothing settles
  quiet(w, 1);
  const xs = w.log.map(repackWrites).reduce((a, ws) => a.concat(ws.filter((x) => x.sid === X)), []);
  eq('[3] a waiting best write (Q319) laid down in the old key goes out in the new one, with its bank', xs.map((x) => [x.s, x.hex.slice(0, 8)]), [[ewNew, hexLE([7000])]]);
  T('[3] ... and the run log names the repack of the waiting write', /endless best write of .* on endless_classic_duo: [0-9]+ repacked [0-9]+ \(O569\)/.test(outOf(w)), outOf(w).split('\n').filter((l) => /O569/.test(l)).join(' | '));
  eq('[3] CLASSIC_REPACK_CAP 0: no rewrite of the old rows (only the waiting write)', w.log.map(repackWrites).reduce((a, ws) => a.concat(ws.map((x) => x.sid)), []), [X]);
  const dry = classicWorld({}, null);
  step(dry, 5 * MIN, null, { APPLY_MMR: '0', CLASSIC_REPACK_EVERY: '1' });
  eq('[3] a dry run (APPLY_MMR=0) writes no rewrite', repackWrites(dry.log[0]).length, 0);
  const off = classicWorld({}, null);
  quiet(off, 1);
  eq('[3] a quiet run outside its slot rewrites nothing and reads no classic ladder for it', [repackWrites(off.log[0]).length, /\(repack\)/.test(outOf(off))], [0, false]);
}

// ---- [3b] with Q334 (the settle lays its writes ahead in the backlog before they go out; a run that ended leaves them laid) ----
//   CAP 0 throughout: only the writes the backlog / the settle make, no rewrite of the old rows
const laidAhead = () => ({ PENDING_WRITES_FILE: { [v.pid(X)]: { ew: { endless_classic_duo: { v: OLD(6, 7000), ts: 7000, bd: BUILD, t: Date.now() - 60000, n: 0, a: 1 } } } } });
const ewLeft = (w, s) => { const e = w.state && w.state.PENDING_WRITES_FILE && w.state.PENDING_WRITES_FILE[v.pid(s)]; return (e && e.ew && e.ew.endless_classic_duo) || null; };
const writesOf = (w, s) => w.log.map(repackWrites).reduce((a, ws) => a.concat(ws.filter((x) => x.sid === s)), []);
// a write laid ahead in the old key that DID land (his row reads it, old key, details [7000, build]) by a run that ended: found
//   on the board -- his row read repacked against the waiting value repacked -- and not sent again
function retryFound(script) {
  const w = classicWorld({ CLASSIC_REPACK_CAP: '0' }, laidAhead());
  if (script) w.script = script;
  w.b[CLS2][X] = oldRow(6, 7000);
  w.recs.push({ sid: X, d: start7(0x7778, 0, [X, SID(9)]) });
  quiet(w, 1);
  return w;
}
{
  // a write laid ahead in the old key that never landed (no row of his): goes out in the new key, the wait ends
  const w = classicWorld({ CLASSIC_REPACK_CAP: '0' }, laidAhead());
  w.recs.push({ sid: X, d: start7(0x7777, 0, [X, SID(9)]) });
  quiet(w, 1);
  eq('[3b] a write laid ahead in the old key by a run that ended, never landed: one write, in the new key, with its bank', writesOf(w, X).map((x) => [x.s, x.hex.slice(0, 8)]), [[v.packClassicScore(6, 7000), hexLE([7000])]]);
  T('[3b] ... the log says it was laid ahead by a run that ended (Q334), the wait is over', fine(w) && /endless best write of .* on endless_classic_duo laid ahead by a run that ended before its outcome was known landed: [0-9]+ \(Q334\)/.test(outOf(w)) && ewLeft(w, X) == null,
    outOf(w).split('\n').filter((l) => /Q334|O569/.test(l)).join(' | '));
  const f = retryFound();
  eq('[3b] the same write that did land (his row in the old key): found on the board, not sent again (no write of his), the wait is over',
    [fine(f), writesOf(f, X).length, ewLeft(f, X)], [true, 0, null]);
  T('[3b] ... the log says found on the board', /endless best write of .* on endless_classic_duo laid ahead by a run that ended before its outcome was known: found on the board \(Q334\)/.test(outOf(f)), outOf(f).split('\n').filter((l) => /Q334|Q319|O569/.test(l)).join(' | '));
  // the settle lays its classic writes ahead in the new key: A (a better old row, $9,000) is laid nowhere, B's new best is; B's
  //   write fails at the settle -> it waits in the new key (no longer "ahead"), the next quiet run writes it
  const s = classicWorld({ CLASSIC_REPACK_CAP: '0' });
  run(s, SEG_CLASSIC, 5, CDEEP5, { post: { [CLS2]: { [B]: [[500, false]] } } });
  const wb = ewLeft(s, B);
  eq('[3b] the settle (Q334 write ahead): A laid nowhere, B\'s failed write waits in the new key (value / bank / tries / ahead flag)',
    [fine(s), ewLeft(s, A), wb && [wb.v, wb.ts, wb.n, 'a' in wb]], [true, null, [C5, 4800, 1, false]]);
  eq('[3b] ... A never written, B\'s row still his old one', [writesOf(s, A).length, row(s, CLS2, B)], [0, OLD(5, 4000)]);
  quiet(s, 1);
  eq('[3b] ... the next quiet run writes B\'s best (his old row read repacked below it), the wait is over', [fine(s), row(s, CLS2, B), ewLeft(s, B)], [true, C5, null]);
}

// ---- [4] mutants ----
const VSRC = fs.readFileSync(VALIDATE, 'utf8');
const MUT = {
  // rows taken as read (the old key) into the best maps: a poorer run of the same depth looks new and overwrites the better one
  noNormalize: ['      best[e.steamID] = s;\n', '      best[e.steamID] = was;\n'],
  // no rewrite at all
  noRewrite: ['    if (!APPLY_MMR || !CLASSIC_REPACK_CAP || !rows || !rows.length) return 0;\n', '    return 0;\n'],   // O624: returns how many accounts it marked
  // the cap not applied
  noCap: ['plan = all.slice(0, CLASSIC_REPACK_CAP);', 'plan = all;'],
  // the rows this run writes not skipped: the rewrite of an old row lands after the run's new best
  noSkip: ['    return r.best[r.sid] !== r.s || pool[r.sid] != null;\n', '    void pool; return false;\n'],
  // the backlog's waiting write not repacked
  noBacklog: ["      if (!isClassicLadder(name) || !was || typeof was !== 'object' || was.ts == null) continue;\n", '      continue;\n'],
  // a quiet run never rewrites
  noQuiet: ['persistStartsSide(); await classicRepackQuiet(); await maintainTrust();', 'persistStartsSide(); await maintainTrust();'],
  // the Q319 retry reads his row as it stands (old key) against the waiting value repacked: a landed write is sent again
  noRetryNormalize: ['row = ladderRowScore(name, e); }   // O569: classic rows repacked', 'row = e ? e.score | 0 : null; }'],
};
let mutN = 0;
const mutPaths = [];
function withMut(key, fn) {
  const [from, to] = MUT[key];
  const n = VSRC.split(from).length - 1;
  if (n < 1 || (n > 1 && key !== 'noQuiet')) { bad('[4] mutant ' + key + ': anchor found ' + n + ' times'); return; }
  const script = path.join(__dirname, '..', '.mutant-classic-repack-' + process.pid + '-' + (++mutN) + '.js');
  mutPaths.push(script);
  fs.writeFileSync(script, VSRC.split(from).join(to));
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const finalOf = (w) => { const o = {}; for (const s of Object.keys(want)) o[s] = row(w, CLS2, s); return o; };
withMut('noNormalize', (s) => { const m = course2(s); T('[4] mutant noNormalize (old rows into the best maps): A\'s $9,000 run overwritten by the $4,800 one -> caught', fine(m.w) && row(m.w, CLS2, A) === C5, String(row(m.w, CLS2, A))); });
withMut('noRewrite', (s) => { const m = course2(s); T('[4] mutant noRewrite: C / D still tied in the old key -> caught', fine(m.w) && row(m.w, CLS2, C) === 200000 && row(m.w, CLS2, D) === 200000); });
withMut('noCap', (s) => { const m = course2(s); T('[4] mutant noCap: more than 3 rewrites in one run -> caught', fine(m.w) && m.w.log.map(repackWrites).some((ws) => ws.filter((x) => x.sid !== B).length > 3)); });
withMut('noSkip', (s) => { const m = course2(s); T('[4] mutant noSkip: B\'s new best undone by the rewrite of his old row -> caught', fine(m.w) && row(m.w, CLS2, B) !== C5, String(row(m.w, CLS2, B))); });
withMut('noBacklog', (s) => {
  const files = { PENDING_WRITES_FILE: { [v.pid(X)]: { ew: { endless_classic_duo: { v: OLD(6, 7000), ts: 7000, bd: BUILD, t: Date.now() - 60000, n: 1 } } } } };
  const w = classicWorld({ CLASSIC_REPACK_CAP: '0' }, files); w.script = s; w.recs.push({ sid: X, d: start7(0x7777, 0, [X, SID(9)]) }); quiet(w, 1);
  const xs = w.log.map(repackWrites).reduce((a, ws) => a.concat(ws.filter((x) => x.sid === X)), []);
  T('[4] mutant noBacklog: the waiting write goes out in the old key -> caught', fine(w) && xs.length === 1 && xs[0].s === OLD(6, 7000), JSON.stringify(xs));
});
withMut('noQuiet', (s) => { const m = course2(s); T('[4] mutant noQuiet: J left in the old key after the quiet runs -> caught', fine(m.w) && row(m.w, CLS2, J) === OLD(1, 500)); });
withMut('noRetryNormalize', (s) => { const f = retryFound(s), xs = writesOf(f, X); T('[4] mutant noRetryNormalize: the landed write laid ahead (Q334) is sent again -> caught', fine(f) && xs.length === 1, JSON.stringify(xs)); });
T('[4] (every mutant file removed)', mutPaths.length === 7 && !mutPaths.some((f) => fs.existsSync(f)));

// ---- [5] wiring pins ----
{
  const cnt = (re) => (VSRC.match(re) || []).length;
  eq('[5] both quiet exits rewrite after the Q319 retries (persistStartsSide(); await classicRepackQuiet(); await maintainTrust();)', cnt(/persistStartsSide\(\); await classicRepackQuiet\(\); await maintainTrust\(\);/g), 2);
  eq('[5] the classic solo board and the three family boards read through readClassicLadder', cnt(/await readClassicLadder\(/g), 2);
  eq('[5] the two single-row reads (Q319 retry, a page-capped board) through ladderRowScore', cnt(/row = ladderRowScore\(name, e\);/g), 2);
  T('[5] the settle rewrite runs after the classic ladder writes (after the team ladder summary line)', /if \(eclTeamN\) console\.log\([^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*await classicRepackWrite\(classicRepack, 'settle'/.test(VSRC));
  T('[5] the rewrite passes the row\'s own details back (postFormDetails ... r.det)', /scoremethod: 'ForceUpdate', format: 'json' \}, r\.det\)/.test(VSRC));
  T('[5] no reader left on the old divisor (CLASSIC.TIEBREAK_DIV gone)', !/CLASSIC\.TIEBREAK_DIV|TIEBREAK_DIV: 100000/.test(VSRC));
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (classic-repack) ===' : '=== PASS -- 0 fail (classic-repack) ===');
process.exit(failN ? 1 : 0);
