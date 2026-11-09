'use strict';
// classic-repack-gone.js -- O624: the classic ladder rewrite (O569) and accounts that no longer own the app.
//   Live 2026-11-01 (demo job, the first two runs after O569): 215 / 300 then 109 / 249 rows rewritten, then "140 left" for good --
//   every one of the 140 rewrites came back result 27 (Expired: the account no longer owns the app, the same code the classic app
//   gave for 58 accounts on 2026-10-05). A failed rewrite keeps nothing and the next read of the board finds the row again, so every
//   run that settled anything (and the hourly quiet run) sent the 140 again: 140 Web API calls and 140 warnings a run, "left" never 0.
//   Now a 27 marks the account in the per-account memory the composite rows already keep (soloState.ovGone, pid-keyed, 7 days):
//   his rows stay out of the plan for the window (the cap goes to rows that can be written), the 27 is a log line, not a warning,
//   "left" counts only writable rows and the summary counts the others apart. Nobody's score moves (a row keeps its depth).
//   [1] units: appGone (no memory / no mark / fresh / the window's edge / past it), OV_GONE_MS one week
//   [2] the quiet run (real validate.js main(), offline board stub): 3 accounts answer 27 -- tried once, marked pid-keyed, no
//       warning, counted apart; the next quiet run sends nothing to them and says so; past 7 days each is tried once again (one
//       who owns the app again is rewritten, the others marked again); the memory survives the cup block of the quiet exit
//   [3] the settle run (a co-op classic run sighted and settled): the first settle run marks them, the next one skips them, the
//       memory is saved with the settle; the writable rows are rewritten as before
//   [4] mutants: marks not read / a 27 not marked / the quiet run not saving / the settle not passing the memory
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

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const VSRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(VSRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const S0_NOW = '2026-10-01T12:00:00Z';
const CLS2 = 20, OV_CLS = 32;
const BEST = { [CLS2]: 'endless_classic_duo', [OV_CLS]: 'endless_classic_overall' };
// the offline board stub of test/classic-repack.js, plus STUB_GONE: the accounts whose SetLeaderboardScore Steam answers with
//   HTTP 200 { result: { result: 27 } } (no longer own the app; nothing kept)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const GONE = JSON.parse(process.env.STUB_GONE || '[]');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1];",
  '    const gone = /SetLeaderboardScore/.test(u) && GONE.indexOf(sid) >= 0;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: !gone, gone }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: had ? had.id : nextId++ } } });',
  '    }',
  '    if (gone) return resp({ result: { result: 27 } });',
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
function runCron(script, boards, files, gone, envExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-repack-gone-'));
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
      STUB_GONE: JSON.stringify(gone || []),
    }, envExtra || {}, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    if (state.PENDING_WRITES_FILE) { const V807 = require(path.join(__dirname, '..', 'validate.js')); state.PENDING_WRITES_FILE = V807.pwMapNames(state.PENDING_WRITES_FILE, V807.pwOpenName, e.STATE_SALT); }   // O807: board names are sealed on disk
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// the chain memories age by the step between runs (as test/classic-repack.js), ovGone marks too when `goneMs` is given
function advance(state, ms, goneMs) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  if (so && so.ovGone && goneMs) for (const k of Object.keys(so.ovGone)) so.ovGone[k] -= goneMs;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) { const ew = pw[k] && pw[k].ew; if (ew) for (const b of Object.keys(ew)) if (ew[b] && ew[b].t) ew[b].t -= ms; }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9, MIN = 60000, DAY = 86400000;
function rec7(hash, seat, ros, sd, ed, flags, sc) {
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push(sc[i] | 0);
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
const SEG_CLASSIC = 32;
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
function step(w, ms, envExtra, goneMs) {
  if (w.state && w.state.__failed) return null;
  const files = w.state ? advance(w.state, ms, goneMs) : w.files;
  const r = runCron(w.script, boardsOf(w), files, w.gone, Object.assign({}, w.env, envExtra || {}));
  w.log.push(r);
  if (r.code !== 0) { w.state = { __failed: true }; return r; }
  w.state = r.state;
  for (const p of r.posts) {
    if (!p.applied) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1], sid = (/steamid=([0-9]+)/.exec(p.body) || [])[1];
    if (!w.b[bid]) continue;
    if (/SetLeaderboardScore/.test(p.url)) w.b[bid][sid] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
    else if (/DeleteLeaderboardScore/.test(p.url)) delete w.b[bid][sid];
  }
  return r;
}
const SC = 10000, OLD = (d, bank) => d * SC + Math.min(SC - 1, Math.floor(Math.max(0, bank) / 100000));   // the pre-O569 key
const BUILD = 2026100101;
const oldRow = (d, bank, extra) => ({ score: OLD(d, bank), hex: hexLE([bank, BUILD].concat(extra || [])) });
const A = SID(1), B = SID(2), C = SID(3), D = SID(4), N1 = SID(21), N2 = SID(22), N3 = SID(23);
const GONE = [N1, N2, N3];
// a classic duo board of old-key rows: C / D (own the app), N1-N3 (no longer own it), A / B (the co-op writers of [3])
function world(opt) {
  opt = opt || {};
  const rows = {
    [C]: oldRow(20, 55580, [1]), [D]: oldRow(20, 44389, [2]),
    [N1]: oldRow(20, 60000, [3]), [N2]: oldRow(18, 30000, [4]), [N3]: oldRow(9, 9000, [5]),
  };
  if (opt.writers) { rows[A] = oldRow(5, 9000, [7]); rows[B] = oldRow(5, 4000, [7]); }
  return { recs: [], b: { [CLS2]: rows, [OV_CLS]: {} }, state: null, log: [], hn: 0x6240, script: opt.script || null, env: Object.assign({ CLASSIC_REPACK_EVERY: '1' }, opt.env || {}), files: null, gone: (opt.gone || GONE).slice() };
}
const repackPosts = (r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + CLS2 + '(&|$)').test(p.body)).map((p) => (/steamid=([0-9]+)/.exec(p.body) || [])[1]);
const warnLines = (r) => r.out.split('\n').filter((l) => /^::warning::classic repack/.test(l));
const sumRow = (r, re) => { const m = re.exec(r.summary); return m ? m[1].trim() : null; };
const O569_ROW = /\| classic ladder rows in the old key rewritten \/ planned this run \/ still in the old key after it \(O569\) \| ([^|]*) \|/;
const O624_ROW = /\| classic ladder rows in the old key of accounts that no longer own the app \(result 27\), not rewritten for 7 days \(O624\) \| ([^|]*) \|/;
const goneOf = (w) => Object.keys(((w.state && w.state.SOLO_FILE) || {}).ovGone || {}).sort();
const pidsOf = (sids) => sids.map((s) => v.pid(s)).sort();
const fine = (w) => !(w.state && w.state.__failed) && w.log.every((r) => r.code === 0);

// ---- [1] units ----
{
  const now = Date.parse('2026-11-01T12:00:00Z'), g = { a: now - 1000, b: now - v.OV_GONE_MS + 1, c: now - v.OV_GONE_MS, d: 'x' };
  eq('[1] OV_GONE_MS = one week', v.OV_GONE_MS, 7 * DAY);
  eq('[1] appGone: no memory / no mark / a fresh mark / 1 ms inside the week / the week\'s edge / an unreadable mark',
    [v.appGone(null, 'a', now), v.appGone(g, 'z', now), v.appGone(g, 'a', now), v.appGone(g, 'b', now), v.appGone(g, 'c', now), v.appGone(g, 'd', now)],
    [false, false, true, true, false, false]);
  eq('[1] appGone ignores inherited names (a pid is hex, but the map is a plain object)', v.appGone({}, 'constructor', now), false);
}

// ---- [2] the quiet run ----
function course2(script) {
  const w = world({ script });
  step(w, 0);                                   // quiet run 1: C / D rewritten, N1-N3 answer 27
  step(w, 5 * MIN);                             // quiet run 2: N1-N3 within the week
  w.gone = [N1, N3];                            // N2 adds the app back
  step(w, 5 * MIN, null, 7 * DAY + MIN);        // quiet run 3: a week later
  step(w, 5 * MIN);                             // quiet run 4: N1 / N3 within their new week
  return w;
}
const ref = course2();
{
  const w = ref, [r1, r2, r3, r4] = w.log;
  T('[2] (the course ran: four quiet runs)', fine(w) && w.log.length === 4, w.log.map((r) => r.code).join(','));
  eq('[2] run 1: every old row tried once, highest first (C / D rewritten, N1-N3 answer 27)', repackPosts(r1), [N1, C, D, N2, N3]);
  eq('[2] run 1: the three accounts remembered pid-keyed (no steamID in the state)', [goneOf(w.log[0] && { state: r1.state }), JSON.stringify(r1.state.SOLO_FILE || {}).includes(N1)], [pidsOf(GONE), false]);
  eq('[2] run 1: a 27 is a log line, not a warning', [warnLines(r1).length, r1.out.split('\n').filter((l) => /result 27 \(no longer owns the app\) -> not rewritten for 7 days \(O624\)/.test(l)).length], [0, 3]);
  eq('[2] run 1: "left" counts only writable rows, the others apart (log / summary)',
    [r1.out.split('\n').filter((l) => /classic repack \(quiet\)/.test(l)).map((l) => l.trim()), sumRow(r1, O569_ROW), sumRow(r1, O624_ROW)],
    [['classic repack (quiet): 2/5 rows rewritten in the new key, 0 left, 3 of accounts that no longer own the app not rewritten (O624) (O569)'], '2 / 5 / 0', '3']);
  eq('[2] run 2: nothing sent to them (nor to the rewritten rows), no warning, the log says why', [repackPosts(r2), warnLines(r2).length,
    r2.out.split('\n').filter((l) => /classic repack \(quiet\)/.test(l)).map((l) => l.trim()), sumRow(r2, O569_ROW), sumRow(r2, O624_ROW)],
    [[], 0, ['classic repack (quiet): nothing to rewrite, 3 rows of accounts that no longer own the app not rewritten (O624)'], '-', '3']);
  eq('[2] run 2: the memory kept through the quiet exit\'s cup block', goneOf({ state: r2.state }), pidsOf(GONE));
  eq('[2] run 3, a week later: each tried once again -- N2 (owns the app again) rewritten, N1 / N3 marked again', [repackPosts(r3), w.b[CLS2][N2].score, goneOf({ state: r3.state })],
    [[N1, N2, N3], v.packClassicScore(18, 30000), pidsOf([N1, N3])]);
  eq('[2] run 4: N1 / N3 within their new week, nothing sent', [repackPosts(r4), warnLines(r4).length, sumRow(r4, O624_ROW)], [[], 0, '2']);
  eq('[2] the rows of accounts that own the app end in the new key, the others keep theirs (depth unchanged)',
    [C, D, N1, N3].map((s) => w.b[CLS2][s].score), [v.packClassicScore(20, 55580), v.packClassicScore(20, 44389), OLD(20, 60000), OLD(9, 9000)]);
}

// ---- [3] the settle run ----
const ROS = [A, B];
function course3(script) {
  const w = world({ script, writers: true, env: { CLASSIC_REPACK_EVERY: '1000003', CLASSIC_REPACK_CAP: '300' } });
  const h = ++w.hn;
  w.recs.push({ sid: A, d: start7(h, 0, ROS) }, { sid: B, d: start7(h, 1, ROS) }, { sid: A, d: rec7(h, 0, ROS, 0, 5, SEG_CLASSIC, [2600, 2200]) }, { sid: B, d: rec7(h, 1, ROS, 0, 5, SEG_CLASSIC, [2600, 2200]) });
  step(w, 5 * MIN);    // the run sighted (the settle path; its rewrites go out)
  step(w, 10 * MIN);   // the run settled
  return w;
}
const ref3 = course3();
{
  const w = ref3, [s1, s2] = w.log;
  T('[3] (the course ran: a co-op classic run sighted and settled)', fine(w) && w.log.length === 2 && /classic repack \(settle\)/.test(s1.out), w.log.map((r) => r.code).join(','));
  eq('[3] settle run 1: N1-N3 tried once and marked, no warning', [GONE.map((s) => repackPosts(s1).filter((x) => x === s).length), warnLines(s1).length, goneOf({ state: s1.state })], [[1, 1, 1], 0, pidsOf(GONE)]);
  eq('[3] settle run 2: nothing sent to them, no warning, the summary counts them', [repackPosts(s2).filter((x) => GONE.indexOf(x) >= 0), warnLines(s2).length, sumRow(s2, O624_ROW)], [[], 0, '3']);
  eq('[3] the writable rows as before: C / D / A rewritten, B gets his new best', [C, D, A, B].map((s) => w.b[CLS2][s].score),
    [v.packClassicScore(20, 55580), v.packClassicScore(20, 44389), v.packClassicScore(5, 9000), v.packClassicScore(5, 4800)]);
}

// ---- [4] mutants ----
const MUT = {
  // the marks never read: the plan sends every old row again each run (the live 140)
  noRead: ['const all = cand.filter((r) => !appGone(gone, pid(r.sid), nowMs)), away', 'const all = cand.filter(() => true), away'],
  // a 27 never marked
  noMark: ['          gone[pid(r.sid)] = nowMs;\n', ''],
  // the quiet run does not save what it marked
  noQuietSave: ["if (await classicRepackWrite(rows, 'quiet', null, st.ovGone || (st.ovGone = {}))) saveSolo(st, nowMs);", "await classicRepackWrite(rows, 'quiet', null, st.ovGone || (st.ovGone = {}));"],
  // the settle passes no memory
  noSettle: ['  }, soloState.ovGone || (soloState.ovGone = {}));   // O624', '  }, null);   // O624'],
};
let mutN = 0;
const mutPaths = [];
function withMut(key, fn) {
  const [from, to] = MUT[key];
  const n = VSRC.split(from).length - 1;
  if (n !== 1) { failN++; console.log('  FAIL  [4] mutant ' + key + ': anchor found ' + n + ' times'); return; }
  const script = path.join(__dirname, '..', '.mutant-classic-repack-gone-' + process.pid + '-' + (++mutN) + '.js');
  mutPaths.push(script);
  fs.writeFileSync(script, VSRC.split(from).join(to));
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
withMut('noRead', (s) => { const w = course2(s); T('[4] mutant noRead: N1-N3 sent again on quiet run 2 -> caught', fine(w) && repackPosts(w.log[1]).filter((x) => GONE.indexOf(x) >= 0).length === 3); });
withMut('noMark', (s) => { const w = course2(s); T('[4] mutant noMark: nobody remembered, N1-N3 sent again on quiet run 2 -> caught', fine(w) && goneOf({ state: w.log[0].state }).length === 0 && repackPosts(w.log[1]).length === 3); });
withMut('noQuietSave', (s) => { const w = course2(s); T('[4] mutant noQuietSave: the marks lost with the quiet run, N1-N3 sent again -> caught', fine(w) && goneOf({ state: w.log[0].state }).length === 0 && repackPosts(w.log[1]).length === 3); });
withMut('noSettle', (s) => { const w = course3(s); T('[4] mutant noSettle: N1-N3 sent again by the second settle run, with warnings -> caught', fine(w) && repackPosts(w.log[1]).filter((x) => GONE.indexOf(x) >= 0).length === 3 && warnLines(w.log[1]).length === 3); });
T('[4] (every mutant file removed)', mutPaths.length === 4 && !mutPaths.some((f) => fs.existsSync(f)));

// ---- [5] wiring pins ----
{
  const cnt = (re) => (VSRC.match(re) || []).length;
  eq('[5] one week, one constant (top level; the composite writer reads the same one)', [cnt(/const OV_GONE_MS = /g), cnt(/^const OV_GONE_MS = 7 \* 86400000;/gm)], [1, 1]);
  T('[5] the composite rows and the classic repack share soloState.ovGone', cnt(/soloState\.ovGone \|\| \(soloState\.ovGone = \{\}\)/g) === 2);
  T('[5] a 27 is not a warning: the repack checks result 27 before its ghWarn', /result\.result === 27\) \{\n\s+if \(!appGone\(gone, pid\(r\.sid\), nowMs\)\) goneN\+\+;\n\s+gone\[pid\(r\.sid\)\] = nowMs;[\s\S]{0,300}return 'gone';\n\s+\}\n\s+if \(!okFlag\) ghWarn\('classic repack '/.test(VSRC));
  eq('[5] the summary row (O624)', cnt(/not rewritten for 7 days \(O624\) \| ' \+ s\('classicRepackGone', 0\)/g), 1);
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (classic-repack-gone) ===' : '=== PASS -- 0 fail (classic-repack-gone) ===');
process.exit(failN ? 1 : 0);
