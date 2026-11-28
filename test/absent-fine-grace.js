'use strict';
// Q447 (cloud audit 2026-11-24; ASK_USER A93, recommended option 1): the week's first ranked absence is not fined.
// A ranked seat convicted absent at a settle (his own start read, no record and no confession of his; the others' records
// agree) took the leaver fine every time -- the honest player whose connection dropped and never came back as the
// quitter (V123 / V157). With ABSENT_GRACE_N set (validate.yml: 1) the first such conviction in ABSENT_GRACE.MS (7 days) is
// fined only what his absence handed his own premade party (g; 0 for a solo seat: not fined; 2nd draft after review 1);
// the conviction itself stands (the leave counted, the streak event, no points for the finish, the Q228 entry).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/late-result-refund.js),
// the points board carried from run to run. Gold (2500) numbers as there: 3P 1st +38 / 2nd +3 / last -17.
//   [1] units: the knob (off when unset), the window list, the graced fine (min(fine, g)), the saving, the give-back rule
//       (ded + w - g >= 0, the 0 edge), the spend / give back helpers
//   [2] grace on, ranked FFA 3P, he wrote his start and nothing else: convicted (a leave) with no fine, the grace listed,
//       the entry kept (ded 0, gr 1), the others' writes identical to the control's, the summary row
//   [3] control (knob unset = the status quo): fined 100 (2500 -> 2400), nothing listed
//   [4] a second conviction inside the week: fined, the list stays one; [4b] the second one 8 days later: graced again
//   [5] at 0 points: nothing to fine, no grace spent (the next one inside the week is still graced)
//   [6] a confession (his own word that he left): fined as before, no grace spent
//   [7] quick FFA: no fine anyway, no grace spent, the leave counted
//   [8] his late result (Q228) after a graced conviction: placed last (the finish a loss): nothing taken, the exit
//       retracted, the grace stays spent; [8b] placed 1st: +38 back (his finish), the grace given back
//   [9] a confirmed game error (O618) on a graced conviction: the exit retracted, the grace given back (unit over
//       reconcileConfessions)
//   [10] the V157 shape: a 6-seat quick table with competitive seats (O716), a competitive seat absent: not fined; a quick
//       seat absent: no fine and no grace either
//   [13] review 1 F1: a premade pair, the weak member absent: fined only what his absence handed his partner (g 35, not the
//       fine), the pair not better off than together; his late result: +3 back, the grace given back; [13c] g covering the
//       fine: fined as before, the grace not spent
//   [11] wiring pins: validate.yml turns it on for the main channel only
//   [12] mutation self-checks
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['ABSENT_GRACE_N', 'ABSENT_GRACE_WINDOW_MS', 'LEAVER_LP_EASY', 'LEAVER_LP_EASY_UNTIL', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'GITHUB_STEP_SUMMARY'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const v = require(VALIDATE);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'absent-grace-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock (ranked points go to the pinned season's board; see test/leave-confirm.js)
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    if (state.PENDING_WRITES_FILE && v.pwMapNames) state.PENDING_WRITES_FILE = v.pwMapNames(state.PENDING_WRITES_FILE, v.pwOpenName, e.STATE_SALT);   // O807: board names are sealed on disk
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (test/late-result-refund.js, plus the grace
//   list: its times are epoch seconds)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const cf = files.CONFESSIONS_FILE || {};
  for (const k of Object.keys(cf)) if (cf[k] && cf[k].t0) cf[k].t0 -= ms;
  const lv = files.LEAVERS_FILE || {};
  for (const k of Object.keys(lv)) {
    if (lv[k] && Array.isArray(lv[k].lf)) lv[k].lf = lv[k].lf.map((t) => t - ms);
    if (lv[k] && Array.isArray(lv[k].ed)) lv[k].ed = lv[k].ed.map((t) => t - Math.floor(ms / 1000));
    if (lv[k] && Array.isArray(lv[k].ag)) lv[k].ag = lv[k].ag.map((x) => [x[0] - Math.floor(ms / 1000), x[1]]);
  }
  return files;
}
const pointPosts = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=7(&|$)/.test(p.body));
const pointsOf = (r, sid) => pointPosts(r).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leaverOf = (r, sid) => ((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {};
const leavesOf = (r, sid) => leaverOf(r, sid).leaves | 0;
const agOf = (r, sid) => (leaverOf(r, sid).ag || []).length;
const entryOf = (r, sid, key) => (r.state.CONFESSIONS_FILE || {})[v.pid(sid) + '|' + key];
const sumRow = (r) => { const m = /\| ranked absences convicted at a settle and not fined, the week's first \(Q447; ABSENT_GRACE_N ([0-9]+) per ([0-9]+) days, 0 = off\) \| ([0-9]+) \|/.exec(r.summary || ''); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };

const MIN = 60000, HOUR = 3600 * 1000, DAY = 24 * HOUR;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2) and a confession (0xB5) carry zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : sc[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
const settle = (mt, h, ros, seat, rank, win, sc, disp) => ({ sid: ros[seat], d: rec(0xB1, mt, h, seat, rank, win, ros, sc, disp) });
const confess = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB5, mt, h, seat, 0, false, ros, null, 5) });
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

// boards: 50 record shards (one account = one entry per shard), progress (5), rating (6), points (7: every account at
//   2500 unless the carried board says otherwise), cp_bank (8)
function boardsWith(recs, pts, ids) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ids.map(s => ({ steamID: s, score: pts[s] == null ? 2500 : pts[s] })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// a timeline of runs: [[ms since the previous run, records visible, env?], ...]; the points board carries every write
function timeline(steps, ids, script, envAll, pts0, state0) {
  const out = []; let state = state0 || null; const pts = Object.assign({}, pts0 || {});
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs, pts, ids), state ? advance(state, ms) : null, Object.assign({}, envAll || {}, env || {}), script);
    for (const p of pointPosts(r)) { const s = /steamid=([0-9]+)/.exec(p.body)[1]; pts[s] = Number(/score=(-?[0-9]+)/.exec(p.body)[1]); }
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  out.pts = pts;
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const ON = { ABSENT_GRACE_N: '1' };
const GRACED = /leaver LP [^\n]*not fined -- his first absence in 7 days \(1 of 1 in the window, Q447\)/;
const GAVE_BACK = /the week's grace of that conviction given back \(Q447\)/;

// a ranked match where seat `gone` wrote his start and nothing else until (maybe) a late step: runs at 0 / 12 / 18 / 24 min
//   / past the hour (the conviction run is index 4; see test/late-result-refund.js)
const ffaRank = (sc) => (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
function game(mt, h, P, sc, gone, rankOf, o) {
  o = o || {};
  const S = P.map((_, s) => start(mt, h, P, s));
  const R = P.map((_, s) => s).filter((s) => s !== gone).map((s) => settle(mt, h, P, s, rankOf(s), rankOf(s) <= P.length / 2, sc));
  const own = settle(mt, h, P, gone, rankOf(gone), rankOf(gone) <= P.length / 2, sc);
  const extra = o.confess ? [confess(mt, h, P, gone)] : [];
  const vis = S.concat(R, extra);
  const steps = [[o.gap || 0, S.concat(extra)], [12 * MIN, vis], [6 * MIN, vis], [6 * MIN, vis], [v.LEAVE_CONFIRM_MS - 23 * MIN, vis]];
  if (o.lateMs != null) steps.push([o.lateMs, vis.concat([own])]);
  return { key: keyOf(S[0].d), steps, P, S, R, own };
}
const SC3 = [9000, 6000, 3000], SC3TOP = [6000, 3000, 9000];
let nid = 500;
const ids = (n) => Array.from({ length: n }, () => SID(nid++));
const g3 = (P, h, o, sc, mt) => game(mt || 2, h, P, sc || SC3, 2, ffaRank(sc || SC3), o);

const mutants = [];
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-absent-grace-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  mutants.push(script);
  return script;
};

console.log('=== the week\'s first ranked absence is not fined (Q447) ===');
(async () => {
try {
  // ---- [1] units ----
  {
    T('[1] the knob is off when unset (the status quo): N 0, window 7 days', v.ABSENT_GRACE.N === 0 && v.ABSENT_GRACE.MS === 7 * DAY, JSON.stringify(v.ABSENT_GRACE));
    T('[1] off: never free, whatever the list', v.absentGraceFree({}, 'p', Date.now(), 100) === false);
    // the graced fine: the party's gain from his absence, at most the fine; the saving through the board's floor
    T('[1] absentGraceFine: g 0 -> 0 (a solo seat), g 35 -> 35, g above the fine -> the fine, a negative g -> 0',
      v.absentGraceFine(100, 0) === 0 && v.absentGraceFine(100, 35) === 35 && v.absentGraceFine(50, 70) === 50 && v.absentGraceFine(100, -5) === 0 && v.absentGraceFine(100, undefined) === 0);
    const grid = [];
    for (const cur of [0, 1, 10, 34, 35, 36, 99, 100, 101, 2500]) for (const fine of [0, 20, 50, 100]) for (const g of [0, 3, 35, 50, 120]) {
      const gf = v.absentGraceFine(fine, g), want = v.leaverLpPenalty(cur, gf) - v.leaverLpPenalty(cur, fine), got = v.absentGraceSaves(cur, fine, gf);
      if (got !== want) grid.push([cur, fine, g, got, want].join('/'));
    }
    T('[1] absentGraceSaves = leaverLpPenalty(cur, graced fine) - leaverLpPenalty(cur, fine) over a grid (the board\'s floor at 0)', grid.length === 0, grid.slice(0, 5).join(' '));
    T('[1] absentGraceSaves: 0 at 0 points, 0 when g covers the fine, 10 at 10 points (all he has), 65 at 2500 with g 35',
      v.absentGraceSaves(0, 100, 0) === 0 && v.absentGraceSaves(2500, 50, 50) === 0 && v.absentGraceSaves(10, 100, 0) === 10 && v.absentGraceSaves(10, 100, 35) === 0 && v.absentGraceSaves(2500, 100, 35) === 65);
    // P3-a (review 1): the give-back at a late result -- ded + w - g >= 0, the 0 edge included
    const back = (o) => v.absentGraceBack(Object.assign({ cv: 1, gr: 1 }, o));
    T('[1] absentGraceBack: a settle that moved no rating (w = g = 0, ded 0: Q136) -> given back (he ends at 0 as fined + late)', back({ ded: 0, w: 0, g: 0 }) === true);
    T('[1] absentGraceBack: solo 1st (+38) -> back; solo last (-17) -> kept spent', back({ ded: 0, w: 38, g: 0 }) === true && back({ ded: 0, w: -17, g: 0 }) === false);
    T('[1] absentGraceBack: the pair (ded 35, w 3, g 35) -> back; ded + w - g = 0 exactly -> back; -1 -> kept',
      back({ ded: 35, w: 3, g: 35 }) === true && back({ ded: 35, w: 0, g: 35 }) === true && back({ ded: 34, w: 0, g: 35 }) === false);
    T('[1] absentGraceBack: not graced / not a conviction -> never', v.absentGraceBack({ cv: 1, ded: 0, w: 38, g: 0 }) === false && v.absentGraceBack({ gr: 1, ded: 0, w: 38, g: 0 }) === false && v.absentGraceBack(null) === false);
    const r = spawnSync(process.execPath, ['-e', [
      "const v = require(" + JSON.stringify(VALIDATE) + ");",
      "const now = 1800000000000, D = 86400000, L = {}, out = {};",
      "out.k = v.ABSENT_GRACE;",
      "out.free0 = v.absentGraceFree(L, 'p', now, 100);",
      "out.zeroSaves = v.absentGraceFree(L, 'p', now, 0);",
      "v.noteAbsentGrace(L, 'p', now - 8 * D, '111_1234_2');",
      "out.oldOnly = [v.absentGraceUsed(L, 'p', now), v.absentGraceFree(L, 'p', now, 100)];",
      "v.noteAbsentGrace(L, 'p', now - D, '222_1234_2');",
      "out.after = [v.absentGraceUsed(L, 'p', now), v.absentGraceFree(L, 'p', now, 100), JSON.stringify(L.p)];",
      "out.back = [v.returnAbsentGrace(L, 'p', '333_1234_2'), v.returnAbsentGrace(L, 'p', '222_1234_2'), JSON.stringify(L.p)];",
      "out.none = [v.returnAbsentGrace({}, 'q', '222_1234_2'), v.absentGraceUsed({ q: { leaves: 2 } }, 'q', now)];",
      "console.log(JSON.stringify(out));",
    ].join('\n')], { env: Object.assign({}, process.env, ON, { ABSENT_GRACE_WINDOW_MS: '' }), encoding: 'utf8' });
    let u = null; try { u = JSON.parse(String(r.stdout).trim().split('\n').pop()); } catch (e) {}
    T('[1] ABSENT_GRACE_N=1: N 1, the window 7 days', !!u && u.k.N === 1 && u.k.MS === 7 * DAY, r.stdout + r.stderr);
    if (u) {
      T('[1] an empty list is free (it saves him something)', u.free0 === true);
      T('[1] not free when it saves nothing (0 points / g covers the fine: nothing spent)', u.zeroSaves === false);
      T('[1] a grace older than the window does not count', u.oldOnly[0] === 0 && u.oldOnly[1] === true, JSON.stringify(u.oldOnly));
      const lp = JSON.parse(u.after[2]);
      T('[1] one inside the window: used 1, not free; the old one pruned when written; the leave count not touched',
        u.after[0] === 1 && u.after[1] === false && lp.ag.length === 1 && lp.ag[0][1] === 222 && (lp.leaves | 0) === 0 && !Array.isArray(lp.w), u.after[2]);
      T('[1] given back by its match only (another match: nothing), the list removed when empty', u.back[0] === false && u.back[1] === true && JSON.parse(u.back[2]).ag === undefined, JSON.stringify(u.back));
      T('[1] no entry / no list: nothing to give back, 0 used', u.none[0] === false && u.none[1] === 0);
    }
  }

  // ---- [2] grace on / [3] control ----
  let ctl = null, on = null;
  {
    const P = ids(3), c = g3(P, 0x7a01);
    on = timeline(c.steps, c.P, null, ON);
    const [p0, p1, p2] = c.P, e4 = entryOf(on[4], p2, c.key);
    T('[2] grace on: five runs exit 0, the key settled at the fifth', allOk(on, 5) && processedOf(on[4]).has(c.key), last(on).out.slice(-800));
    T('[2] he is convicted (a leave counted) but not fined: no points write of his, the board still 2500',
      leavesOf(on[4], p2) === 1 && pointsOf(on[4], p2).length === 0 && on.pts[p2] == null, JSON.stringify(pointsOf(on[4], p2)) + ' ' + on[4].out.slice(-600));
    T('[2] the entry kept for a late result: cv, nothing taken (ded 0), graced (gr 1), his finish (-17), the board',
      !!e4 && e4.cv === 1 && e4.ded === 0 && e4.gr === 1 && e4.ex === 1 && e4.w === -17 && e4.g === 0 && e4.b === '7', JSON.stringify(e4));
    T('[2] the grace listed once on his leaver state, nobody else\'s', agOf(on[4], p2) === 1 && agOf(on[4], p0) + agOf(on[4], p1) === 0, JSON.stringify(leaverOf(on[4], p2)));
    T('[2] the log line says why', GRACED.test(on[4].out), on[4].out.split('\n').filter(l => /leaver LP/.test(l)).join(' / '));
    T('[2] the run summary row: 1 per 7 days, one graced', JSON.stringify(sumRow(on[4])) === '[1,7,1]', JSON.stringify(sumRow(on[4])));

    const c2 = g3(P, 0x7a01);
    ctl = timeline(c2.steps, c2.P);
    const e4c = entryOf(ctl[4], p2, c2.key);
    T('[3] control (knob unset): fined 100 (2400), the entry keeps the fine, no grace listed, the row reads off',
      allOk(ctl, 5) && JSON.stringify(pointsOf(ctl[4], p2)) === '[2400]' && !!e4c && e4c.ded === 100 && !e4c.gr && agOf(ctl[4], p2) === 0
      && leavesOf(ctl[4], p2) === 1 && JSON.stringify(sumRow(ctl[4])) === '[0,7,0]', JSON.stringify(e4c) + ' ' + JSON.stringify(sumRow(ctl[4])));
    T('[2] the others\' writes identical to the control\'s (1st of 2 +38, 2nd of 2 -17); nobody else\'s leave',
      JSON.stringify([pointsOf(on[4], p0), pointsOf(on[4], p1)]) === '[[2538],[2483]]'
      && JSON.stringify([pointsOf(on[4], p0), pointsOf(on[4], p1)]) === JSON.stringify([pointsOf(ctl[4], p0), pointsOf(ctl[4], p1)])
      && leavesOf(on[4], p0) + leavesOf(on[4], p1) === 0, JSON.stringify([pointsOf(on[4], p0), pointsOf(on[4], p1), pointsOf(ctl[4], p0), pointsOf(ctl[4], p1)]));
    T('[2] the same streak event as the control (the week\'s first absence freezes)',
      JSON.stringify(((on[4].state.XP_FILE || {})[v.pid(p2)] || {}).sk) === JSON.stringify(((ctl[4].state.XP_FILE || {})[v.pid(p2)] || {}).sk), JSON.stringify(((on[4].state.XP_FILE || {})[v.pid(p2)] || {}).sk));
  }

  // ---- [4] a second conviction inside the week / [4b] 8 days later ----
  const second = (gapMs, script) => {
    const P = ids(3), c1 = g3(P, 0x7b01), r1 = timeline(c1.steps, c1.P, script, ON);
    const c2 = g3([ids(1)[0], ids(1)[0], P[2]], 0x7b02, { gap: gapMs });
    const ids2 = Array.from(new Set(P.concat(c2.P)));
    const r2 = timeline(c2.steps, ids2, script, ON, r1.pts, last(r1).state);
    return { P, c1, r1, c2, r2, p: P[2] };
  };
  {
    const s = second(DAY);
    T('[4] the first conviction graced (2500)', allOk(s.r1, 5) && pointsOf(s.r1[4], s.p).length === 0 && agOf(s.r1[4], s.p) === 1, s.r1[4].out.slice(-500));
    T('[4] a second one a day later: fined (2500 -> 2400), the list still one, two leaves',
      allOk(s.r2, 5) && JSON.stringify(pointsOf(s.r2[4], s.p)) === '[2400]' && agOf(s.r2[4], s.p) === 1 && leavesOf(s.r2[4], s.p) === 2
      && entryOf(s.r2[4], s.p, s.c2.key).ded === 100 && !entryOf(s.r2[4], s.p, s.c2.key).gr, JSON.stringify(pointsOf(s.r2[4], s.p)) + ' ' + s.r2[4].out.slice(-600));
    const s8 = second(8 * DAY);
    T('[4b] the second one 8 days later: graced again (still 2500), the old grace pruned (the list one)',
      allOk(s8.r2, 5) && pointsOf(s8.r2[4], s8.p).length === 0 && agOf(s8.r2[4], s8.p) === 1 && entryOf(s8.r2[4], s8.p, s8.c2.key).gr === 1 && GRACED.test(s8.r2[4].out),
      JSON.stringify(leaverOf(s8.r2[4], s8.p)) + ' ' + s8.r2[4].out.slice(-500));
  }

  // ---- [5] at 0 points ----
  {
    const P = ids(3), c = g3(P, 0x7c01), rs = timeline(c.steps, c.P, null, ON, { [P[2]]: 0 });
    T('[5] at 0 points: no fine to waive, no grace spent, the leave counted', allOk(rs, 5) && agOf(rs[4], P[2]) === 0 && leavesOf(rs[4], P[2]) === 1
      && !entryOf(rs[4], P[2], c.key).gr && !GRACED.test(rs[4].out), JSON.stringify(leaverOf(rs[4], P[2])) + ' ' + rs[4].out.slice(-500));
  }

  // ---- [6] a confession ----
  {
    const P = ids(3), c = g3(P, 0x7d01, { confess: true }), rs = timeline(c.steps, c.P, null, ON);
    const fined = rs.reduce((a, r) => a.concat(pointsOf(r, P[2])), []);
    T('[6] a confession (his own word that he left): fined as before (2400), no grace spent, nothing graced',
      rs.every(r => r.code === 0) && JSON.stringify(fined) === '[2400]' && rs.every(r => agOf(r, P[2]) === 0) && !rs.some(r => GRACED.test(r.out)),
      JSON.stringify(fined) + ' ' + JSON.stringify(leaverOf(last(rs), P[2])) + ' ' + last(rs).out.slice(-500));
  }

  // ---- [7] quick FFA ----
  {
    const P = ids(3), c = g3(P, 0x7e01, null, null, 1), rs = timeline(c.steps, c.P, null, ON);
    T('[7] quick FFA: the leave counted, no points write, no grace spent', allOk(rs, 5) && leavesOf(rs[4], P[2]) === 1 && pointPosts(rs[4]).length === 0
      && agOf(rs[4], P[2]) === 0 && !GRACED.test(rs[4].out), JSON.stringify(leaverOf(rs[4], P[2])));
  }

  // ---- [8] his late result after a graced conviction ----
  {
    const P = ids(3), c = g3(P, 0x7f01, { lateMs: 20 * MIN }), rs = timeline(c.steps, c.P, null, ON);
    T('[8] placed last, his result 20 min later: nothing taken (the -17 is not charged late), the exit retracted, the grace stays spent',
      allOk(rs, 6) && pointsOf(rs[5], P[2]).length === 0 && leavesOf(rs[5], P[2]) === 0 && agOf(rs[5], P[2]) === 1 && entryOf(rs[5], P[2], c.key).refunded === 1 && !GAVE_BACK.test(rs[5].out),
      JSON.stringify(leaverOf(rs[5], P[2])) + ' ' + rs[5].out.slice(-600));
    const Q = ids(3), t = g3(Q, 0x7f02, { lateMs: 20 * MIN }, SC3TOP), rt = timeline(t.steps, t.P, null, ON);
    T('[8b] placed 1st, his result later: +38 back (2538, his finish), the exit retracted, the grace given back',
      allOk(rt, 6) && pointsOf(rt[4], Q[2]).length === 0 && JSON.stringify(pointsOf(rt[5], Q[2])) === '[2538]' && leavesOf(rt[5], Q[2]) === 0 && agOf(rt[5], Q[2]) === 0 && GAVE_BACK.test(rt[5].out),
      JSON.stringify(pointsOf(rt[5], Q[2])) + ' ' + JSON.stringify(leaverOf(rt[5], Q[2])) + ' ' + rt[5].out.slice(-600));
  }

  // ---- [9] a confirmed game error on a graced conviction (unit over reconcileConfessions) ----
  const errUnit = async (mod) => {
    const now = 1800000000000, key = '12345_1234_2', p = 'pp';
    const confState = { [p + '|' + key]: { t0: now - HOUR, mt: 2, ded: 0, ex: 1, cv: 1, gr: 1, s: 2, v: 'abcdefabcdef', b: '7', w: -17, g: 0, done: 1, es: 'GM-999', eb: 20261124 } };
    const leavers = { [p]: { leaves: 1, lastMatch: key, w: [[12345, 0]], ag: [[Math.floor((now - HOUR) / 1000), 12345]] } };
    const writes = [];
    const quiet = console.log; console.log = () => {};
    try {
      await mod.reconcileConfessions([], {}, new Set([key]), confState, leavers, now, {
        penalty: 100, lpMax: 6000, maturityMs: 2 * HOUR, lateMs: 6 * HOUR, lpBoard: '7', vecTag: () => '', readLp: async () => ({ score: 2500, details: [] }),
        writeLp: async (sid, nv) => { writes.push([sid, nv]); return true; }, errRefund: () => ({ steamID: '76561198000000999', note: 'listed' }),
      });
    } finally { console.log = quiet; }
    return { st: confState[p + '|' + key], lv: leavers[p], writes };
  };
  {
    const r = await errUnit(v);
    T('[9] a confirmed game error: nothing to refund (no fine was taken), the exit retracted, the grace given back',
      r.writes.length === 0 && r.st.refunded === 1 && r.st.er === 1 && (r.lv.leaves | 0) === 0 && r.lv.ag === undefined, JSON.stringify(r));
  }

  // ---- [10] the V157 shape: 6 seats, a quick table with competitive seats 0 / 2 / 3 / 4 (O716 mt bits 11-16) ----
  {
    const MT = 59393;   // base 1 + competitive seats 0, 2, 3, 4 (the match in V157: -1084440449_39168281_59393)
    T('[10] the table: quick base, seats 0 / 2 / 3 / 4 competitive', v.baseMt(MT) === 1 && (MT >> 11 & 63) === 0b011101);
    const SC6 = [12000, 11000, 10000, 9000, 8000, 7000];
    const P = ids(6), c = game(MT, 0x7f10, P, SC6, 3, ffaRank(SC6)), rs = timeline(c.steps, c.P, null, ON);
    T('[10] the competitive seat 3 absent, the others agree: convicted (a leave), not fined, the grace listed',
      allOk(rs, 5) && processedOf(rs[4]).has(c.key) && leavesOf(rs[4], P[3]) === 1 && pointsOf(rs[4], P[3]).length === 0 && agOf(rs[4], P[3]) === 1 && entryOf(rs[4], P[3], c.key).gr === 1,
      JSON.stringify(entryOf(rs[4], P[3], c.key)) + ' ' + rs[4].out.slice(-700));
    const rc = timeline(game(MT, 0x7f10, P, SC6, 3, ffaRank(SC6)).steps, P);
    T('[10] control: the same seat fined (2400); the other competitive seats\' writes the same with and without the grace',
      JSON.stringify(pointsOf(rc[4], P[3])) === '[2400]' && JSON.stringify([0, 2, 4].map((s) => pointsOf(rs[4], P[s]))) === JSON.stringify([0, 2, 4].map((s) => pointsOf(rc[4], P[s]))),
      JSON.stringify([0, 2, 3, 4].map((s) => [pointsOf(rs[4], P[s]), pointsOf(rc[4], P[s])])));
    const Q = ids(6), q = game(MT, 0x7f11, Q, SC6, 1, ffaRank(SC6)), rq = timeline(q.steps, q.P, null, ON);
    T('[10] a quick seat (1) absent: a leave, no fine and no grace spent (nothing to waive)', allOk(rq, 5) && leavesOf(rq[4], Q[1]) === 1 && pointsOf(rq[4], Q[1]).length === 0 && agOf(rq[4], Q[1]) === 0,
      JSON.stringify(leaverOf(rq[4], Q[1])));
  }

  // ---- [13] a premade pair (review 1 F1): the weak member's absence hands his partner a windfall (g), fined as before ----
  //   test/late-result-refund.js [14]: a ranked FFA of 4, seats 2 / 3 premade (mask bit 1) placing 1st and 4th; together +3
  //   each (+6); the 4th writes his start only, his partner settles alone at 1st of 3 (+38): g = 35 on the 4th's entry.
  const SC4P = [6000, 3000, 9000, 1000], MT_PAIR = 2 | (0x2 << 4);
  const pairGame = (P, h, o) => game(MT_PAIR, h, P, SC4P, 3, ffaRank(SC4P), o);
  const PARTY = /leaver LP [^\n]*pts 2500-35->2465 only what his absence handed his party, not the fine \(100\) -- his first absence in 7 days \(1 of 1 in the window, Q447\)/;
  {
    const P = ids(4), c = pairGame(P, 0x9e01), rs = timeline(c.steps, c.P, null, ON);
    const e = entryOf(rs[4], P[3], c.key) || {};
    T('[13] grace on: the partner +38 (alone at 1st), the dropper fined only g (35: 2500 -> 2465), graced (the grace listed), a leave',
      allOk(rs, 5) && JSON.stringify(pointsOf(rs[4], P[2])) === '[2538]' && JSON.stringify(pointsOf(rs[4], P[3])) === '[2465]' && agOf(rs[4], P[3]) === 1 && leavesOf(rs[4], P[3]) === 1
      && e.gr === 1 && e.ded === 35 && e.g === 35 && e.w === 3 && PARTY.test(rs[4].out), JSON.stringify([pointsOf(rs[4], P[2]), pointsOf(rs[4], P[3]), e]) + ' ' + rs[4].out.slice(-700));
    T('[13] the pair nets +3 dropping him (+38 - 35), not more than staying together (+6)', (2538 - 2500) + (2465 - 2500) <= 6);
    const Q = ids(4), q = pairGame(Q, 0x9e01), rq = timeline(q.steps, q.P);
    T('[13] control (knob unset): fined 100 (2400), the partner the same +38', JSON.stringify(pointsOf(rq[4], Q[3])) === '[2400]' && JSON.stringify(pointsOf(rq[4], Q[2])) === '[2538]',
      JSON.stringify([pointsOf(rq[4], Q[2]), pointsOf(rq[4], Q[3])]));
    const L = ids(4), l = pairGame(L, 0x9e02, { lateMs: 20 * MIN }), rl = timeline(l.steps, l.P, null, ON);
    T('[13b] his result 20 min later: +3 back (2468 = his share), the pair at +6 as if together, the exit retracted, the grace given back (ded + w - g = 3)',
      allOk(rl, 6) && JSON.stringify(pointsOf(rl[5], L[3])) === '[2468]' && (2538 - 2500) + (2468 - 2500) === 6 && leavesOf(rl[5], L[3]) === 0 && agOf(rl[5], L[3]) === 0 && GAVE_BACK.test(rl[5].out),
      JSON.stringify([pointsOf(rl[5], L[3]), leaverOf(rl[5], L[3])]) + ' ' + rl[5].out.slice(-600));
    const LC = ids(4), lc = pairGame(LC, 0x9e02, { lateMs: 20 * MIN }), rlc = timeline(lc.steps, lc.P);
    T('[13b] control: the same late result ends him at 2468 too (fined 100, +103 back)', allOk(rlc, 6) && JSON.stringify(pointsOf(rlc[5], LC[3])) === '[2468]', JSON.stringify(pointsOf(rlc[5], LC[3])));
    const until = new Date(Date.now() + 10 * DAY).toISOString().replace(/\.[0-9]{3}Z$/, 'Z');
    const EASY20 = Object.assign({}, ON, { LEAVER_LP_EASY: '20', LEAVER_LP_EASY_UNTIL: until });
    const F = ids(4), f = pairGame(F, 0x9e03), rf = timeline(f.steps, f.P, null, EASY20);
    const ef = entryOf(rf[4], F[3], f.key) || {};
    T('[13c] g covers the fine (an easy fine of 20 < g 35): fined the 20 as before, nothing graced, the grace not spent',
      allOk(rf, 5) && JSON.stringify(pointsOf(rf[4], F[3])) === '[2480]' && agOf(rf[4], F[3]) === 0 && !ef.gr && ef.ded === 20 && /leaver LP [^\n]*pts 2500-20->2480/.test(rf[4].out) && sumRow(rf[4])[2] === 0,
      JSON.stringify([pointsOf(rf[4], F[3]), ef, sumRow(rf[4])]) + ' ' + rf[4].out.slice(-500));
  }

  // ---- [11] wiring pins ----
  {
    const WF = path.join(__dirname, '..', '.github', 'workflows');
    const yml = fs.readFileSync(path.join(WF, 'validate.yml'), 'utf8');
    const at = yml.indexOf('\n      - name: run\n'), end = yml.indexOf('\n      - name: ', at + 1), run = yml.slice(at, end < 0 ? yml.length : end);
    T('[11] validate.yml: the reconcile run step turns the grace on (ABSENT_GRACE_N: \'1\')', at >= 0 && /\n          ABSENT_GRACE_N: '1'\n/.test(run), run.split('\n').filter(l => /ABSENT_GRACE/.test(l)).join(' / '));
    const elsewhere = fs.readdirSync(WF).filter((f) => /\.ya?ml$/.test(f) && f !== 'validate.yml' && /\bABSENT_GRACE_N\b/.test(fs.readFileSync(path.join(WF, f), 'utf8')));
    T('[11] on no other workflow (the playtest / demo twins have no points board)', elsewhere.length === 0, elsewhere.join(','));
    T('[11] validate.js: the conviction fine reads the grace (the graced fine cut from LEAVER_LP_FINE by g); a confession\'s fine does not (reconcileConfessions takes opts.penalty as before)',
      /const gFine = absentGraceFine\(LEAVER_LP_FINE, confState\[cvKey\]\.g\);/.test(SRC)
      && /const graced = absentGraceFree\(leavers, pid\(x\.steamID\), nowMs, absentGraceSaves\(cur, LEAVER_LP_FINE, gFine\)\);/.test(SRC)
      && /const nv = leaverLpPenalty\(cur, graced \? gFine : LEAVER_LP_FINE\);/.test(SRC)
      && SRC.split('absentGraceFree(').length === 3 && SRC.split('absentGraceFine(').length === 3 && SRC.split('absentGraceBack(').length === 3);
  }

  // ---- [12] mutation self-checks ----
  {
    const runOn = (script, P, h, o, sc, mt, pts0) => timeline(g3(P, h, o, sc, mt).steps, P, script, ON, pts0);
    // m1: the grace never applies -> [2] fined
    { const s = mutant('const graced = absentGraceFree(', 'const graced = false && absentGraceFree(', 'never');
      if (s) { const P = ids(3), rs = runOn(s, P, 0x7a51); T('[12] mutant: the grace never applies -> [2] fined (2400)', JSON.stringify(pointsOf(rs[4], P[2])) === '[2400]', JSON.stringify(pointsOf(rs[4], P[2]))); } }
    // m2: the grace not spent -> [4] the second conviction graced too
    { const s = mutant("if (graced) { noteAbsentGrace(leavers, pid(x.steamID), nowMs, c.m); confState[cvKey].gr = 1;", "if (graced) { confState[cvKey].gr = 1;", 'nospend');
      if (s) { const r = second(DAY, s); T('[12] mutant: the grace not spent -> [4] the second conviction not fined', pointsOf(r.r2[4], r.p).length === 0, JSON.stringify(pointsOf(r.r2[4], r.p))); } }
    // m3: the window ignored -> [4b] an 8-day-old grace still counts, the second conviction fined
    { const s = mutant("return e.ag.filter((x) => Array.isArray(x) && Number(x[0]) > from).length;", "return e.ag.filter((x) => Array.isArray(x)).length;", 'nowindow');
      if (s) { const r = second(8 * DAY, s); T('[12] mutant: the window ignored -> [4b] fined (2400)', JSON.stringify(pointsOf(r.r2[4], r.p)) === '[2400]', JSON.stringify(pointsOf(r.r2[4], r.p))); } }
    // m4: the points guard removed -> [5] a grace spent at 0 points
    { const s = mutant('return ABSENT_GRACE.N > 0 && (saves | 0) > 0 && ', 'return ABSENT_GRACE.N > 0 && ', 'nosaves');
      if (s) { const P = ids(3), rs = runOn(s, P, 0x7c51, null, null, null, { [P[2]]: 0 }); T('[12] mutant: spent when it saves nothing -> [5] a grace spent at 0 points', agOf(rs[4], P[2]) === 1, JSON.stringify(leaverOf(rs[4], P[2]))); } }
    // m5: the loss guard removed on a late result -> [8] the grace given back on a loss
    { const s = mutant('return !!(st && st.cv && st.gr) && (st.ded | 0) + (st.w | 0) - (st.g | 0) >= 0;', 'return !!(st && st.cv && st.gr);', 'noloss');
      if (s) { const P = ids(3), rs = runOn(s, P, 0x7f51, { lateMs: 20 * MIN }); T('[12] mutant: no loss guard -> [8] the grace given back on a loss', allOk(rs, 6) && agOf(rs[5], P[2]) === 0, JSON.stringify(leaverOf(rs[5], P[2]))); } }
    // m6: the late give-back removed -> [8b] the grace stays spent
    { const s = mutant("if (absentGraceBack(st) && returnAbsentGrace(leavers, p, m))", "if (false && absentGraceBack(st) && returnAbsentGrace(leavers, p, m))", 'nolateback');
      if (s) { const P = ids(3), rs = runOn(s, P, 0x7f52, { lateMs: 20 * MIN }, SC3TOP); T('[12] mutant: no late give-back -> [8b] the grace stays spent', allOk(rs, 6) && agOf(rs[5], P[2]) === 1 && JSON.stringify(pointsOf(rs[5], P[2])) === '[2538]', JSON.stringify(leaverOf(rs[5], P[2]))); } }
    // m7: the game-error give-back removed -> [9] the grace stays spent
    { const s = mutant("if (st.cv && st.gr && returnAbsentGrace(leavers, p, m)) console.log(what", "if (false && st.cv && st.gr && returnAbsentGrace(leavers, p, m)) console.log(what", 'noerrback');
      if (s) { const mod = require(s); const r = await errUnit(mod); T('[12] mutant: no game-error give-back -> [9] the grace stays spent', Array.isArray(r.lv.ag) && r.lv.ag.length === 1, JSON.stringify(r.lv)); } }
    // m8: on by default -> [3] the control (knob unset) not fined
    { const s = mutant('N: Math.max(0, Number(process.env.ABSENT_GRACE_N || 0) | 0),', 'N: Math.max(0, Number(process.env.ABSENT_GRACE_N || 1) | 0),', 'ondefault');
      if (s) { const P = ids(3), rs = timeline(g3(P, 0x7a52).steps, P, s); T('[12] mutant: on by default -> [3] the control not fined', pointsOf(rs[4], P[2]).length === 0, JSON.stringify(pointsOf(rs[4], P[2]))); } }
    // m9 (review 1 F1): the graced fine back to 0 -> [13] the dropper of a pair not fined (the partner's +38 kept)
    { const s = mutant('const nv = leaverLpPenalty(cur, graced ? gFine : LEAVER_LP_FINE);', 'const nv = leaverLpPenalty(cur, graced ? 0 : LEAVER_LP_FINE);', 'zerofine');
      if (s) { const P = ids(4), rs = timeline(pairGame(P, 0x9e51).steps, P, s, ON); T('[12] mutant: graced fine 0 -> [13] the dropper not fined, the pair +38', allOk(rs, 5) && pointsOf(rs[4], P[3]).length === 0 && JSON.stringify(pointsOf(rs[4], P[2])) === '[2538]', JSON.stringify([pointsOf(rs[4], P[2]), pointsOf(rs[4], P[3])])); } }
    // m10: g not read for the saving -> [13c] the grace spent though g covers the fine
    { const s = mutant('absentGraceSaves(cur, LEAVER_LP_FINE, gFine)', 'absentGraceSaves(cur, LEAVER_LP_FINE, 0)', 'savesnog');
      if (s) { const until = new Date(Date.now() + 10 * DAY).toISOString().replace(/\.[0-9]{3}Z$/, 'Z'); const P = ids(4), rs = timeline(pairGame(P, 0x9e53).steps, P, s, Object.assign({}, ON, { LEAVER_LP_EASY: '20', LEAVER_LP_EASY_UNTIL: until }));
        T('[12] mutant: the saving ignores g -> [13c] a grace spent where nothing was waived', allOk(rs, 5) && agOf(rs[4], P[3]) === 1, JSON.stringify(leaverOf(rs[4], P[3]))); } }
    // m11: the graced fine not capped at the fine -> [1] absentGraceFine(50, 70) above the fine
    { const s = mutant('function absentGraceFine(fine, g) { return Math.min(Math.max(0, fine | 0), Math.max(0, g | 0)); }', 'function absentGraceFine(fine, g) { return Math.max(0, g | 0); }', 'nocap');
      if (s) { const mod = require(s); T('[12] mutant: the graced fine not capped -> [1] above the fine (70 > 50)', mod.absentGraceFine(50, 70) === 70); } }
    // m12 (review 1 P3-a): the give-back edge -> [1] ded + w - g = 0 kept spent
    { const s = mutant('(st.ded | 0) + (st.w | 0) - (st.g | 0) >= 0;', '(st.ded | 0) + (st.w | 0) - (st.g | 0) > 0;', 'edge');
      if (s) { const mod = require(s); T('[12] mutant: give-back at > 0 -> [1] the w = g = 0 settle (Q136) keeps the grace spent', mod.absentGraceBack({ cv: 1, gr: 1, ded: 0, w: 0, g: 0 }) === false && mod.absentGraceBack({ cv: 1, gr: 1, ded: 35, w: 0, g: 35 }) === false); } }
  }
} finally {
  for (const m of mutants) { try { fs.unlinkSync(m); } catch (e) {} }
}

console.log(failN ? '\n' + failN + ' FAILED' : '\nall passed');
process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
