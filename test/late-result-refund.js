'use strict';
// Q228 (cloud audit 2026-10): a convicted leave whose own finished result comes in late.
// The client keeps a result it could not upload and sends it again from the menus and at the next boot, for up to two
// hours (outbox, cloud workbench W34). A player whose result arrives after the settle convicted him (an absent seat is
// convicted once LEAVE_CONFIRM_MS has passed since his own start was read) found a processed key: the -100 and the exit
// stood for a match he finished. Each conviction at a settle now leaves an entry in the confession table; his own late
// record retracts the exit and moves his points by the fine + the finish he would have had (w) - what the other members
// of his premade unit gained by his absence (g), at most LATE_CAP.N times per account a week.
// End-to-end over the REAL validate.js main() against an offline board stub (same harness as test/leave-confirm.js), the
// points board carried from run to run (every points write lands on it). Gold (2500) numbers: 3P 1st +38 / 2nd +3 /
// last -17; 2P 1st +38 / last -17; 4P 1st +38 / 2nd +15 / 3rd -4 / last -17; a pair at average place 2.5 of 4 +3.
//   [1] ranked FFA 3P, he placed last: convicted at the wait (-100, an exit), his result 20 min later: +83 back (2483:
//       the -17 he would have taken), the exit retracted, nothing else written
//   [2] the same 3 hours after the conviction (past the confession window, inside LATE_RESULT_MS)
//   [3] the others' records gone from the shards by then: his record alone, carrying the settled scores, still counts
//   [4] past LATE_RESULT_MS: nothing given back, the entry closed
//   [5] his late record with other scores / from another seat / saying he abandoned: nothing given back
//   [6] quick FFA (exit only), on a run with nothing fresh to settle: the exit retraction reaches leavers.json
//   [7] the conviction's points write failed: nothing was taken, the late result retracts the exit, his -17 stays unpaid
//   [8] start-orphan verdict (ranked 1V1, the winner's result alone at maturity): not covered, the exit stands
//   [9] control: no late result -> the conviction stands, the entry closes after LATE_RESULT_MS
//   [13] he placed 1st of 3 solo: +138 back (2538); the stranger who moved up by his absence is not charged
//   [14] a premade pair 1st and 4th of 4, the 4th convicted: his partner took +38 alone where the pair took +3 each:
//        +68 back (2468), the pair together where staying would have put it; [14b] the partner's write failed: +103
//   [15] ranked 2V2, his team lost, his teammate shielded (-2): +93 back (2493), the teammate not charged
//   [16] the cap (LATE_CAP_N=1): a second late result of the same account inside the week: the leave stands
//   [10] units: reconcileConfessions on a conviction's entry (seat, scores tag, window, abandoner, board, cap, floor)
//   [17] units: lateShadow (ranks, the plan, the series clamp, a seeded settle, 0..LP_MAX, mates)
//   [11] wiring pins
//   [12] mutation self-checks
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const POST_FAIL = JSON.parse(process.env.STUB_POST_FAIL || '[]');",   // steam ids whose points write (board 7) answers result 2
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    const sm = /steamid=([0-9]+)/.exec(body);',
  "    if (/SetLeaderboardScore/.test(u) && /leaderboardid=7(&|$)/.test(body) && sm && POST_FAIL.indexOf(sm[1]) >= 0) {",
  "      fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, failed: 1 }) + '\\n');",
  '      return resp({ result: { result: 2 } });',
  '    }',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'late-result-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock (ranked points go to the pinned season's board; see test/leave-confirm.js)
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (every stored instant moves back: start
//   sightings, absent-seat stamps, the writers' busy marks, the confession table's entries, the late-result cap times)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const cf = files.CONFESSIONS_FILE || {};
  for (const k of Object.keys(cf)) if (cf[k] && cf[k].t0) cf[k].t0 -= ms;
  const lv = files.LEAVERS_FILE || {};
  for (const k of Object.keys(lv)) if (lv[k] && Array.isArray(lv[k].lf)) lv[k].lf = lv[k].lf.map((t) => t - ms);
  return files;
}
const pointPosts = (r) => r.posts.filter(p => !p.failed && /SetLeaderboardScore/.test(p.url) && /leaderboardid=7(&|$)/.test(p.body));
const ratingPosts = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=6(&|$)/.test(p.body));
const xpPostsOf = (r, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=5(&|$)/.test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body));
const pointsOf = (r, sid) => pointPosts(r).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const entryOf = (r, sid, key) => (r.state.CONFESSIONS_FILE || {})[v.pid(sid) + '|' + key];

const MIN = 60000, HOUR = 3600 * 1000, DAY = 24 * HOUR;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
const settle = (mt, h, ros, seat, rank, win, sc, disp) => ({ sid: ros[seat], d: rec(0xB1, mt, h, seat, rank, win, ros, sc, disp) });
// a record written by `sid` (its writer) carrying another seat's fields
const settleAs = (sid, mt, h, ros, seat, rank, win, sc) => ({ sid, d: rec(0xB1, mt, h, seat, rank, win, ros, sc) });
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
function timeline(steps, ids, script, envAll) {
  const out = []; let state = null; const pts = {};
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs, pts, ids), state ? advance(state, ms) : null, Object.assign({}, envAll || {}, env || {}), script);
    for (const p of pointPosts(r)) { const s = /steamid=([0-9]+)/.exec(p.body)[1]; pts[s] = Number(/score=(-?[0-9]+)/.exec(p.body)[1]); }
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const LATE = /late-result [^\n]*convicted before his result came in[^\n]*Q228/;

// ---- scenarios ----
// a ranked match where seat `gone` wrote his start; his result reaches the shards only after the conviction (the wait
//   runs LEAVE_CONFIRM_MS from the job's first read of his start: runs at 0 / 12 / 18 / 24 min / past the hour)
//   rankOf(seat) -> his rank claim (FFA: by score; teams: the team convention)
const ffaRank = (sc) => (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
function game(mt, h, P, sc, gone, rankOf, lateMs, late) {
  const S = P.map((_, s) => start(mt, h, P, s));
  const R = P.map((_, s) => s).filter((s) => s !== gone).map((s) => settle(mt, h, P, s, rankOf(s), rankOf(s) <= P.length / 2, sc));
  const own = settle(mt, h, P, gone, rankOf(gone), rankOf(gone) <= P.length / 2, sc);
  const steps = [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [v.LEAVE_CONFIRM_MS - 23 * MIN, S.concat(R)]];
  if (lateMs != null) steps.push([lateMs, late ? late(S, R, own) : S.concat(R, [own])]);
  return { key: keyOf(S[0].d), steps, P, S, R, own };
}
// 3-player ranked FFA (mt 2): P[2] (seat 2) the one convicted
const SC3 = [9000, 6000, 3000];
let nid = 300;
const ids = (n) => Array.from({ length: n }, () => SID(nid++));
const quitSteps = (mt, h, P, lateMs, lateRecs) => game(mt, h, P, SC3, 2, ffaRank(SC3), lateMs, lateRecs ? (S, R) => lateRecs(S, R) : null);
const lateOwn = (mt, h, P) => (S, R) => S.concat(R, [settle(mt, h, P, 2, 3, false, SC3)]);
const A = (lateMs, which, mt) => { const P = ids(3), h = 0x9a00 + nid, m = mt || 2; return quitSteps(m, h, P, lateMs, which ? which(m, h, P) : lateOwn(m, h, P)); };

// ---- [1] convicted, his result 20 min later ----
{
  const c = A(20 * MIN), rs = timeline(c.steps, c.P), [p0, p1, p2] = c.P;
  T('[1] ranked FFA: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  const e4 = entryOf(rs[4], p2, c.key);
  T('[1] the conviction run: settled, he is convicted (-100, an exit) and kept with the fine taken, his seat, the scores, the board, his finish (-17), no gain to charge',
    processedOf(rs[4]).has(c.key) && leavesOf(rs[4], p2) === 1 && JSON.stringify(pointsOf(rs[4], p2)) === '[2400]'
    && !!e4 && e4.cv === 1 && e4.ded === 100 && e4.ex === 1 && e4.s === 2 && /^[0-9a-f]{12}$/.test(e4.v || '') && e4.b === '7' && e4.w === -17 && e4.g === 0 && !e4.refunded,
    JSON.stringify(e4) + ' ' + JSON.stringify(pointsOf(rs[4], p2)) + ' ' + rs[4].out.slice(-600));
  T('[1] the others settled as before: 1st of 2 +38, 2nd of 2 -17', JSON.stringify(pointsOf(rs[4], p0)) === '[2538]' && JSON.stringify(pointsOf(rs[4], p1)) === '[2483]',
    JSON.stringify([pointsOf(rs[4], p0), pointsOf(rs[4], p1)]));
  T('[1] his result 20 min later: +83 back (2400 -> 2483, the -17 he would have taken), the exit retracted, the entry closed as forgiven',
    JSON.stringify(pointsOf(rs[5], p2)) === '[2483]' && leavesOf(rs[5], p2) === 0 && LATE.test(rs[5].out) && entryOf(rs[5], p2, c.key).refunded === 1,
    JSON.stringify(pointsOf(rs[5], p2)) + ' ' + leavesOf(rs[5], p2) + ' ' + rs[5].out.slice(-800));
  T('[1] nothing else written in that run: the others\' points and ratings untouched, no XP, the key still settled',
    pointPosts(rs[5]).length === 1 && ratingPosts(rs[5]).length === 0 && xpPostsOf(rs[5], p0).length + xpPostsOf(rs[5], p1).length + xpPostsOf(rs[5], p2).length === 0
    && processedOf(rs[5]).has(c.key) && leavesOf(rs[5], p0) + leavesOf(rs[5], p1) === 0,
    JSON.stringify(rs[5].posts.map(p => p.body.slice(0, 90))));
  T('[1] the forgiveness time kept for the cap', (() => { const l = (rs[5].state.LEAVERS_FILE || {})[v.pid(p2)]; return !!l && Array.isArray(l.lf) && l.lf.length === 1; })(),
    JSON.stringify((rs[5].state.LEAVERS_FILE || {})[v.pid(p2)]));
  T('[1] a run after that: nothing more (forgiven once)', (() => {
    const r6 = runCron(boardsWith(c.steps[5][1], { [p2]: 2483 }, c.P), advance(rs[5].state, 5 * MIN));
    return r6.code === 0 && pointsOf(r6, p2).length === 0 && leavesOf(r6, p2) === 0 && !LATE.test(r6.out);
  })());
  T('[1] run summary row: one conviction kept / one late result forgiven / none over the cap',
    /\| leaves convicted at a settle this run, kept for a late result \/ late results forgiven \(points of the finish, exit retracted\) \/ late results over the cap, the leave stands \(Q228\) \| 1 \/ 0 \/ 0 \|/.test(rs[4].summary)
    && /\(Q228\) \| 0 \/ 1 \/ 0 \|/.test(rs[5].summary), rs[5].summary.split('\n').filter(l => /Q228/.test(l)).join(' / '));
}

// ---- [2] 3 hours after the conviction (the confession window is 2 hours) ----
{
  const c = A(3 * HOUR), rs = timeline(c.steps, c.P), p2 = c.P[2];
  T('[2] 3 h after the conviction: forgiven (2483), the exit retracted', allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], p2)) === '[2483]' && leavesOf(rs[5], p2) === 0,
    JSON.stringify(pointsOf(rs[5], p2)) + ' ' + last(rs).out.slice(-600));
}

// ---- [3] the others' records gone from the shards ----
{
  const c = A(40 * MIN, (mt, h, P) => (S) => S.concat([settle(mt, h, P, 2, 3, false, SC3)])), rs = timeline(c.steps, c.P), p2 = c.P[2];
  T('[3] his record alone (the others\' rotated off), carrying the settled scores: forgiven (2483)', allOk(rs, 6)
    && JSON.stringify(pointsOf(rs[5], p2)) === '[2483]' && leavesOf(rs[5], p2) === 0 && LATE.test(rs[5].out), last(rs).out.slice(-700));
}

// ---- [4] past LATE_RESULT_MS ----
{
  const c = A(v.LATE_RESULT_MS + 10 * MIN), rs = timeline(c.steps, c.P), p2 = c.P[2];
  T('[4] past LATE_RESULT_MS: nothing given back, the exit stands, the entry closed', allOk(rs, 6)
    && pointsOf(rs[5], p2).length === 0 && leavesOf(rs[5], p2) === 1 && !LATE.test(rs[5].out) && entryOf(rs[5], p2, c.key).done === 1,
    JSON.stringify(entryOf(rs[5], p2, c.key)) + ' ' + last(rs).out.slice(-500));
}

// ---- [5] a late record that is not his finished result for those scores ----
const FORGED = [3000, 6000, 9000];
const forgedScores = (mt, h, P) => (S, R) => S.concat(R, [settle(mt, h, P, 2, 1, true, FORGED)]);
const otherSeat = (mt, h, P) => (S, R) => S.concat(R, [settleAs(P[2], mt, h, P, 1, 2, false, SC3)]);
const abandoned = (mt, h, P) => (S, R) => S.concat(R, [settle(mt, h, P, 2, 3, false, SC3, 5)]);
{
  for (const [label, which] of [['other scores', forgedScores], ['from another seat', otherSeat], ['saying he abandoned (disp 5)', abandoned]]) {
    const c = A(20 * MIN, which), rs = timeline(c.steps, c.P), [p0, p1, p2] = c.P;
    T('[5] his late record ' + label + ': nothing given back, the exit stands, nobody else moves', allOk(rs, 6)
      && pointPosts(rs[5]).length === 0 && ratingPosts(rs[5]).length === 0 && leavesOf(rs[5], p2) === 1 && !LATE.test(rs[5].out)
      && leavesOf(rs[5], p0) + leavesOf(rs[5], p1) === 0 && !entryOf(rs[5], p2, c.key).refunded,
      JSON.stringify(rs[5].posts.map(p => p.body.slice(0, 80))) + ' ' + last(rs).out.slice(-500));
  }
}

// ---- [6] quick FFA (exit only), on a run with nothing fresh to settle ----
{
  const c = A(20 * MIN, null, 1), rs = timeline(c.steps, c.P), p2 = c.P[2];
  const e4 = entryOf(rs[4], p2, c.key);
  T('[6] quick FFA: convicted with an exit only (no points), kept with nothing taken and no points board',
    allOk(rs, 6) && leavesOf(rs[4], p2) === 1 && pointPosts(rs[4]).length === 0 && !!e4 && e4.ded === 0 && e4.b == null, last(rs).out.slice(-500));
  T('[6] his result later, nothing fresh to settle that run (early return): the exit retracted and saved',
    /no fresh matches, skip/.test(rs[5].out) && LATE.test(rs[5].out) && leavesOf(rs[5], p2) === 0 && pointPosts(rs[5]).length === 0,
    rs[5].out.slice(-600));
}

// ---- [7] the conviction's points write failed ----
{
  const c = A(20 * MIN), p2 = c.P[2];
  c.steps[4] = [c.steps[4][0], c.steps[4][1], { STUB_POST_FAIL: JSON.stringify([p2]) }];
  const rs = timeline(c.steps, c.P);
  T('[7] the fine\'s write failed: nothing taken (the board still 2500), the entry keeps no fine',
    allOk(rs, 6) && leavesOf(rs[4], p2) === 1 && pointsOf(rs[4], p2).length === 0 && entryOf(rs[4], p2, c.key).ded === 0, JSON.stringify(entryOf(rs[4], p2, c.key)));
  T('[7] his result later: the exit retracted, no points written (0 - 17 gives nothing back; his finish is not charged either)',
    leavesOf(rs[5], p2) === 0 && pointPosts(rs[5]).length === 0 && LATE.test(rs[5].out) && /nothing to give back/.test(rs[5].out), rs[5].out.slice(-500));
}

// ---- [8] start-orphan verdict: ranked 1V1, only the winner's result at maturity -- not covered ----
{
  const P = ids(2), h = 0x9b01, S = [0, 1].map(s => start(2, h, P, s)), SC2 = [8000, 4000];
  const W = [settle(2, h, P, 0, 1, true, SC2)], L = [settle(2, h, P, 1, 2, false, SC2)];
  const steps = [[0, S], [12 * MIN, S.concat(W)], [30 * MIN, S.concat(W)], [v.STARTS_MATURITY_MS - 41 * MIN, S.concat(W)], [20 * MIN, S.concat(W, L)]];
  const rs = timeline(steps, P), key = keyOf(S[0].d);
  T('[8] 1V1: the start-orphan verdict convicts the silent seat (an exit), the winner consoled, no entry kept',
    allOk(rs, 5) && processedOf(rs[3]).has(key) && leavesOf(rs[3], P[1]) === 1 && xpPostsOf(rs[3], P[0]).length === 1 && !entryOf(rs[3], P[1], key),
    JSON.stringify(entryOf(rs[3], P[1], key)) + ' ' + rs[3].out.slice(-700));
  T('[8] his result later (consistent with the winner\'s): the exit stands, nothing written',
    leavesOf(rs[4], P[1]) === 1 && !LATE.test(rs[4].out) && rs[4].posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=[567](&|$)/.test(p.body)).length === 0,
    JSON.stringify(rs[4].posts.map(p => p.body.slice(0, 80))) + ' ' + rs[4].out.slice(-600));
}

// ---- [9] control: no late result ----
{
  const c = A(v.LATE_RESULT_MS + 10 * MIN, (mt, h, P) => (S, R) => S.concat(R)), rs = timeline(c.steps, c.P), p2 = c.P[2];
  T('[9] no late result: the conviction stands (nothing back, an exit), the entry closes past LATE_RESULT_MS', allOk(rs, 6)
    && pointsOf(rs[5], p2).length === 0 && leavesOf(rs[5], p2) === 1 && entryOf(rs[5], p2, c.key).done === 1 && !entryOf(rs[5], p2, c.key).refunded,
    JSON.stringify(entryOf(rs[5], p2, c.key)));
}

// ---- [13] he placed 1st of 3, solo ----
const SC3TOP = [6000, 3000, 9000];
const topGame = (lateMs) => { const P = ids(3); return game(2, 0x9d00 + nid, P, SC3TOP, 2, ffaRank(SC3TOP), lateMs); };
{
  const c = topGame(20 * MIN), rs = timeline(c.steps, c.P), [p0, p1, p2] = c.P;
  T('[13] he led and dropped: the 2nd moved up to 1st of 2 (+38 where 2nd of 3 gives +3), the 3rd took -17',
    allOk(rs, 6) && JSON.stringify(pointsOf(rs[4], p0)) === '[2538]' && JSON.stringify(pointsOf(rs[4], p1)) === '[2483]' && JSON.stringify(pointsOf(rs[4], p2)) === '[2400]',
    JSON.stringify([pointsOf(rs[4], p0), pointsOf(rs[4], p1), pointsOf(rs[4], p2)]) + ' ' + rs[4].out.slice(-600));
  T('[13] kept: his finish +38, the stranger\'s gain not charged (g 0)', (() => { const e = entryOf(rs[4], p2, c.key); return !!e && e.w === 38 && e.g === 0; })(), JSON.stringify(entryOf(rs[4], p2, c.key)));
  T('[13] his result later: +138 back (2538, 1st of 3), nobody else moves', JSON.stringify(pointsOf(rs[5], p2)) === '[2538]' && pointPosts(rs[5]).length === 1 && leavesOf(rs[5], p2) === 0,
    JSON.stringify(rs[5].posts.map(p => p.body.slice(0, 90))) + ' ' + rs[5].out.slice(-500));
}

// ---- [14] a premade pair (seats 2 / 3, mask bit 1) placing 1st and 4th of 4, the 4th convicted ----
const SC4P = [6000, 3000, 9000, 1000], MT_PAIR = 2 | (0x2 << 4);
const pairGame = (lateMs) => { const P = ids(4); return game(MT_PAIR, 0x9e00 + nid, P, SC4P, 3, ffaRank(SC4P), lateMs); };
{
  const c = pairGame(20 * MIN), rs = timeline(c.steps, c.P), [p0, p1, p2, p3] = c.P;
  T('[14] the pair broken by his absence: his partner settles alone at 1st of 3 (+38; together at 2.5 of 4 it is +3 each)',
    allOk(rs, 6) && JSON.stringify(pointsOf(rs[4], p2)) === '[2538]' && JSON.stringify(pointsOf(rs[4], p0)) === '[2503]' && JSON.stringify(pointsOf(rs[4], p1)) === '[2483]'
    && JSON.stringify(pointsOf(rs[4], p3)) === '[2400]', JSON.stringify(c.P.map((s) => pointsOf(rs[4], s))) + ' ' + rs[4].out.slice(-700));
  const e = entryOf(rs[4], p3, c.key);
  T('[14] kept: his finish as the pair (+3), his partner\'s gain (+38 - 3 = 35)', !!e && e.w === 3 && e.g === 35, JSON.stringify(e));
  T('[14] his result later: +68 back (2468); the pair ends at +38 - 32 = +6, as together (+3 +3)', JSON.stringify(pointsOf(rs[5], p3)) === '[2468]' && pointPosts(rs[5]).length === 1 && leavesOf(rs[5], p3) === 0,
    JSON.stringify(rs[5].posts.map(p => p.body.slice(0, 90))) + ' ' + rs[5].out.slice(-500));
}
{
  const c = pairGame(20 * MIN), p2 = c.P[2], p3 = c.P[3];
  c.steps[4] = [c.steps[4][0], c.steps[4][1], { STUB_POST_FAIL: JSON.stringify([p2]) }];
  const rs = timeline(c.steps, c.P);
  T('[14b] the partner\'s points write failed: his gain never landed, nothing charged (g 0), +103 back (2503)',
    allOk(rs, 6) && pointsOf(rs[4], p2).length === 0 && entryOf(rs[4], p3, c.key).g === 0 && JSON.stringify(pointsOf(rs[5], p3)) === '[2503]',
    JSON.stringify(entryOf(rs[4], p3, c.key)) + ' ' + JSON.stringify(pointsOf(rs[5], p3)));
}

// ---- [15] ranked 2V2 (mt 6), his team lost, his teammate shielded ----
const SC4 = [6100, 5200, 4800, 3900];
const t2rank = (seat) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === 0 ? 1 : 3) + inTeam; };   // team A won
{
  const P = ids(4), c = game(6, 0x9f00 + nid, P, SC4, 3, t2rank, 20 * MIN), rs = timeline(c.steps, c.P), [p0, p1, p2, p3] = c.P;
  T('[15] 2V2: the winners +21, his teammate shielded (-2 where the full team loss is -7), he is fined',
    allOk(rs, 6) && JSON.stringify(pointsOf(rs[4], p0)) === '[2521]' && JSON.stringify(pointsOf(rs[4], p2)) === '[2498]' && JSON.stringify(pointsOf(rs[4], p3)) === '[2400]',
    JSON.stringify(P.map((s) => pointsOf(rs[4], s))) + ' ' + rs[4].out.slice(-700));
  const e = entryOf(rs[4], p3, c.key);
  T('[15] kept: his finish -7, the teammate\'s shield not charged (a team record carries no party bits)', !!e && e.w === -7 && e.g === 0, JSON.stringify(e));
  T('[15] his result later: +93 back (2493), nobody else moves', JSON.stringify(pointsOf(rs[5], p3)) === '[2493]' && pointPosts(rs[5]).length === 1 && leavesOf(rs[5], p3) === 0,
    JSON.stringify(rs[5].posts.map(p => p.body.slice(0, 90))) + ' ' + rs[5].out.slice(-500));
}

// ---- [16] the cap: two convictions of the same account a day apart, both his results late (LATE_CAP_N=1) ----
function capSteps(P) {
  const g1 = game(2, 0xa000 + nid++, P, SC3, 2, ffaRank(SC3), 20 * MIN), g2 = game(2, 0xa000 + nid++, P, SC3, 2, ffaRank(SC3), 20 * MIN);
  const keep = g1.steps[5][1];   // the first match's records stay on the shards
  const s2 = g2.steps.map(([ms, recs, env], i) => [i === 0 ? DAY : ms, keep.concat(recs), env]);
  return { steps: g1.steps.concat(s2), k1: g1.key, k2: g2.key };
}
{
  const P = ids(3), c = capSteps(P), rs = timeline(c.steps, P, null, { LATE_CAP_N: '1' }), p2 = P[2];
  T('[16] LATE_CAP_N=1: the first late result forgiven (2483)', allOk(rs, 12) && JSON.stringify(pointsOf(rs[5], p2)) === '[2483]' && leavesOf(rs[5], p2) === 0,
    JSON.stringify(pointsOf(rs[5], p2)) + ' ' + last(rs).out.slice(-600));
  T('[16] the second a day later: the leave stands (no points, the exit counted), the entry closed, the summary counts it',
    pointsOf(rs[11], p2).length === 0 && leavesOf(rs[11], p2) === 1 && entryOf(rs[11], p2, c.k2).done === 1 && !entryOf(rs[11], p2, c.k2).refunded
    && /the leave stands \(Q228\)/.test(rs[11].out) && /\(Q228\) \| 0 \/ 0 \/ 1 \|/.test(rs[11].summary),
    JSON.stringify(entryOf(rs[11], p2, c.k2)) + ' ' + rs[11].out.slice(-600));
}
{
  const P = ids(3), c = capSteps(P), p2 = P[2];
  c.steps[6] = [8 * DAY, c.steps[6][1], c.steps[6][2]];   // the second match a week and a day after the first
  const rs = timeline(c.steps, P, null, { LATE_CAP_N: '1' });
  T('[16] the second a week later: forgiven again (the first has left the window; 2483 fined to 2383, his last place -17 back: 2466)', allOk(rs, 12) && JSON.stringify(pointsOf(rs[11], p2)) === '[2466]' && leavesOf(rs[11], p2) === 0,
    JSON.stringify(pointsOf(rs[11], p2)) + ' ' + rs[11].out.slice(-600));
}

// ---- [10] units: reconcileConfessions on a conviction's entry ----
const U = {};
(async () => {
  const P = ids(3), h = 0x9c01, m = keyOf(rec(0xB1, 2, h, 0, 1, true, P, SC3));
  const own = (seat, sc, disp, sid) => Object.assign({ steamID: sid || P[2], dispCode: disp | 0 }, { d: rec(0xB1, 2, h, seat, 3, false, P, sc, disp) });
  const tag = (r) => JSON.stringify(r.d.slice(10, 13));
  // x: { lf, readLp, lpBoard }
  const run = async (st, g, consistent, now, mod, x) => {
    const vm = mod || v, o = x || {};
    const lv = { leaves: 1, lastMatch: m }; if (o.lf) lv.lf = o.lf.slice();
    const confState = { [v.pid(P[2]) + '|' + m]: Object.assign({}, st) }, leavers = { [v.pid(P[2])]: lv }, writes = [];
    const res = await vm.reconcileConfessions([], { [m]: g }, new Set([m]), confState, leavers, now == null ? 1000 : now, {
      penalty: 100, lpMax: 9999, maturityMs: 2 * HOUR, lateMs: 6 * HOUR, appliesLpFn: () => true, consistentKeys: new Set(consistent ? [m] : []), vecTag: tag,
      lpBoard: o.lpBoard == null ? 7 : o.lpBoard,
      readLp: o.readLp || (async () => ({ score: 2400, details: null })), writeLp: async (sid, score) => { writes.push([sid, score]); return true; },
    });
    return { res, st: confState[v.pid(P[2]) + '|' + m], leaves: leavers[v.pid(P[2])].leaves, lf: leavers[v.pid(P[2])].lf, writes };
  };
  const base = { t0: 0, mt: 2, ded: 100, ex: 1, cv: 1, s: 2, v: JSON.stringify(SC3), b: '7', w: -17, g: 0 };
  Object.assign(U, { run, own, base });   // [12] runs the units on a mutant too
  let r = await run(base, [own(2, SC3)], false);
  T('[10] his own record, the convicted seat, the settled scores, alone on the shards: +83 (fine 100 + finish -17), exit retracted, counted, the time kept',
    r.writes.length === 1 && r.writes[0][1] === 2483 && r.leaves === 0 && r.st.refunded === 1 && r.res.late === 1 && r.res.retracted === 1 && r.res.refunded === 1
    && JSON.stringify(r.lf) === '[1000]', JSON.stringify(r));
  r = await run(Object.assign({}, base, { w: 38, g: 35 }), [own(2, SC3)], false);
  T('[10] fine 100 + finish 38 - the others\' gain 35: +103', r.writes.length === 1 && r.writes[0][1] === 2503, JSON.stringify(r));
  r = await run(Object.assign({}, base, { w: -17, g: 90 }), [own(2, SC3)], false);
  T('[10] a gain above the fine and the finish: nothing back (never down), the exit retracted', r.writes.length === 0 && r.leaves === 0 && r.st.refunded === 1, JSON.stringify(r));
  r = await run(Object.assign({}, base, { ded: 0, w: 38, g: 0 }), [own(2, SC3)], false);
  T('[10] nothing taken (a 0-points player, or the write failed) and a win: his finish +38', r.writes.length === 1 && r.writes[0][1] === 2438, JSON.stringify(r));
  r = await run(base, [own(2, SC3)], false, null, null, { lpBoard: 90001 });
  T('[10] the points board changed (a new season): nothing back, the exit retracted', r.writes.length === 0 && r.leaves === 0 && r.st.refunded === 1, JSON.stringify(r));
  r = await run(Object.assign({}, base, { b: undefined, w: undefined, g: undefined, ded: 0 }), [own(2, SC3)], false);
  T('[10] no board on the entry (a quick match): the exit retracted, no write', r.writes.length === 0 && r.leaves === 0 && r.st.refunded === 1 && r.res.retracted === 1 && r.res.refunded === 0, JSON.stringify(r));
  r = await run(base, [own(2, SC3)], false, null, null, { readLp: async () => null });
  T('[10] no points of his on the board: nothing written, the exit retracted', r.writes.length === 0 && r.leaves === 0 && r.st.refunded === 1, JSON.stringify(r));
  r = await run(base, [own(1, SC3)], true);
  T('[10] another seat: nothing', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded && r.res.late === 0, JSON.stringify(r));
  r = await run(base, [own(2, FORGED)], true);
  T('[10] other scores (even in a group marked consistent): nothing', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded, JSON.stringify(r));
  r = await run(base, [own(2, SC3, 5)], true);
  T('[10] an abandoner disp: nothing', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded, JSON.stringify(r));
  r = await run(Object.assign({}, base, { v: undefined }), [own(2, SC3)], true);
  T('[10] an entry without the scores tag (even a consistent group): nothing', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded, JSON.stringify(r));
  r = await run(base, [own(2, SC3, 0, P[1])], true);
  T('[10] another account carrying his seat and the scores: nothing', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded, JSON.stringify(r));
  r = await run(Object.assign({}, base, { t0: 7 * DAY - 1000 }), [own(2, SC3)], false, 7 * DAY, null, { lf: [1000, 2 * DAY] });
  T('[10] the cap: two forgiven in the last week -> the leave stands, the entry closed, counted', r.writes.length === 0 && r.leaves === 1 && r.st.done === 1 && !r.st.refunded
    && r.res.lateCapped === 1 && r.res.late === 0 && JSON.stringify(r.lf) === JSON.stringify([1000, 2 * DAY]), JSON.stringify(r));
  r = await run(Object.assign({}, base, { t0: 7 * DAY + 1000 }), [own(2, SC3)], false, 7 * DAY + 2000, null, { lf: [1000, 2 * DAY] });
  T('[10] the cap: one of them past the week -> forgiven, the old time dropped', r.writes.length === 1 && r.leaves === 0 && JSON.stringify(r.lf) === JSON.stringify([2 * DAY, 7 * DAY + 2000]), JSON.stringify(r));
  r = await run(base, [], false, 3 * HOUR);
  T('[10] 3 h on, nothing yet: the entry stays open (a confession\'s would close at 2 h)', !r.st.done && !r.st.refunded, JSON.stringify(r));
  r = await run(base, [], false, 6 * HOUR + 1);
  T('[10] past lateMs: closed, the fine stands', r.st.done === 1 && r.res.finalized === 1 && r.leaves === 1, JSON.stringify(r));
  r = await run(base, [own(2, SC3)], false, 6 * HOUR + 1);
  T('[10] his record past lateMs: nothing back, closed', r.writes.length === 0 && r.st.done === 1 && !r.st.refunded && r.leaves === 1, JSON.stringify(r));
  r = await run({ t0: 0, mt: 2, ded: 100, ex: 1 }, [own(2, SC3)], false);
  T('[10] a confession\'s entry keeps its own probe (a lone record refunds nothing)', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded, JSON.stringify(r));
  r = await run({ t0: 0, mt: 2, ded: 100, ex: 1 }, [own(2, SC3)], true, null, null, { lf: [500, 600] });
  T('[10] a confession\'s entry in a consistent group: its fine back as before (+100), no Q228 count, the cap not read',
    r.writes.length === 1 && r.writes[0][1] === 2500 && r.leaves === 0 && r.res.late === 0 && r.res.retracted === 1 && JSON.stringify(r.lf) === '[500,600]', JSON.stringify(r));

  // ---- [17] units: lateShadow ----
  const row = (id, seat, rank, lp, mmr) => ({ steamID: id, seat, rank, lp: lp == null ? 2500 : lp, mmr: mmr == null ? 1500 : mmr });
  const ffa = (mt) => (all) => v.reducedStakesPlan(all, mt, v.premadeMaskOf(mt), v.premadeTrioAtOf(mt));
  let s = v.lateShadow([row('a', 0, 1), row('b', 1, 2)], row('x', 2, 3), { a: 38, b: -17 }, new Set(), ffa(2), new Set());
  T('[17] 3P, him last: w -17, no gain', s.w === -17 && s.g.length === 0, JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 2), row('b', 1, 3)], row('x', 2, 1), { a: 38, b: -17 }, new Set(), ffa(2), new Set([0, 1]));
  T('[17] 3P, him 1st, both counted: w 38, a gained 35 (+38 where 2nd of 3 gives +3), b none', s.w === 38 && JSON.stringify(s.g) === '[["a",35]]', JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 2), row('b', 1, 3)], row('x', 2, 1), { a: 38, b: -17 }, new Set(), ffa(2), new Set());
  T('[17] ... with no mates: no gain counted', s.w === 38 && s.g.length === 0, JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 2), row('b', 1, 3), row('c', 2, 1)], row('x', 3, 4), { a: 3, b: -17, c: 38 }, new Set(), ffa(MT_PAIR), new Set([2]));
  T('[17] the pair (seats 2 / 3) 1st and 4th of 4: w +3 (the pair\'s average place), the partner gained 35', s.w === 3 && JSON.stringify(s.g) === '[["c",35]]', JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 1), row('b', 1, 2)], row('x', 2, 1, 2950), { a: 38, b: -17 }, new Set(), ffa(2), new Set());
  T('[17] a promotion series (2950, 1st): the clamp lands him over the line (+60 to 3010)', s.w === 3010 - 2950, JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 1), row('b', 1, 2)], row('x', 2, 1, 2950), { a: 38, b: -17 }, new Set(['x']), ffa(2), new Set());
  T('[17] ... seeded this settle: no clamp (+38)', s.w === 38, JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 2), row('b', 1, 3)], row('x', 2, 1, 9990), { a: 3, b: -17 }, new Set(), ffa(2), new Set());
  T('[17] at the top: never past LP_MAX (+9)', s.w === 9, JSON.stringify(s));
  s = v.lateShadow([row('a', 0, 3), row('b', 1, 2)], row('x', 2, 3, 5), { a: -17, b: 38 }, new Set(), ffa(2), new Set());
  T('[17] at the bottom: never below 0 (-5)', s.w === -5, JSON.stringify(s));
  const team = (all) => v.teamLpPlan(all, 6, SC4, [], 0, [], []);
  s = v.lateShadow([row('a', 0, 1), row('b', 1, 2), row('c', 2, 3)], row('x', 3, 4), { a: 21, b: 21, c: -2 }, new Set(), team, new Set());
  T('[17] 2V2, his team lost: w -7 (the full team loss), the teammate\'s shield not counted', s.w === -7 && s.g.length === 0, JSON.stringify(s));
})().then(async () => {
  // ---- [11] wiring pins ----
  T('[11] the window: 6 hours default; the cap: 2 a week default; from the environment',
    /const LATE_RESULT_MS = Number\(process\.env\.LATE_RESULT_MS \|\| 6 \* 3600 \* 1000\);/.test(SRC) && v.LATE_RESULT_MS === 6 * HOUR
    && v.LATE_CAP.N === 2 && v.LATE_CAP.MS === 7 * DAY && /LATE_CAP = \{ N: Number\(process\.env\.LATE_CAP_N \|\| 2\), MS: Number\(process\.env\.LATE_CAP_MS \|\| 7 \* 86400000\) \}/.test(SRC));
  T('[11] the settle conviction writes its entry (seat, scores tag; at a ranked settle the board, the finish, the gain) and records the fine it took',
    SRC.split("      confState[cvKey] = { t0: nowMs, mt: matchType, ded: 0, ex: 1, cv: 1, s: x.seat | 0, v: vecTag(g[0]) };").length === 2
    && SRC.split("        Object.assign(confState[cvKey], { b: String(lpId), w: sh ? sh.w : 0, g: sh ? sh.g.reduce((a, y) => a + y[1], 0) : 0 });").length === 2
    && SRC.split('confState[cvKey].ded = cur - nv; }').length === 2);
  T('[11] the start-orphan verdict keeps no entry (not covered)', (() => {
    const i = SRC.indexOf('function reconcileStarts('), j = SRC.indexOf('\nfunction ', i + 10);
    return i > 0 && j > i && SRC.slice(i, j).indexOf('cv: 1') < 0;
  })());
  T('[11] the shadow runs after the points loop (it reads each rated player\'s delta) and before the leaver loop', (() => {
    const iL = SRC.indexOf('lp[r.id] = nv; changedLp[r.id] = nv; lpMoved[r.id] = nv - cur;'), iS = SRC.indexOf('lateSh[x.steamID] = lateShadow(');
    const iG = SRC.indexOf('      for (const o of ghostRanked) {'), iC = SRC.indexOf('      const sh = lateSh[x.steamID];');
    return iL > 0 && iS > iL && iG > iS && iC > iG;
  })());
  T('[11] only writes that landed count (after the points writes, before the state save)', (() => {
    const iW = SRC.indexOf('  const wPoints = await mapPool(Object.keys(changedLp)'), iU = SRC.indexOf('st.g = gains.reduce((a, y) => a + (lpOk.has(y[0]) ? y[1] : 0), 0);');
    const iD = SRC.indexOf('      if (!lpOk.has(sid)) st.ded = 0;'), iS = SRC.lastIndexOf('  saveConfessions(confState, nowMs, confLive);');
    return iW > 0 && iU > iW && iD > iW && iS > iU && iS > iD;
  })());
  T('[11] the upkeep passes the window, the scores tag and the board; a late result forgiven is saved on the early return too',
    /lateMs: LATE_RESULT_MS, vecTag, lpBoard: lpId0,/.test(SRC)
    && /if \(startsRes\.convicted \|\| confRes\.exitHits \|\| confRes\.refunded \|\| confRes\.retracted \|\| confRes\.late\) \{ saveLeavers\(leavers\); \}/.test(SRC)
    && /else if \(\(retracted \|\| st\.cv\) && opts\.checkpoint\) opts\.checkpoint\(\);/.test(SRC));
  T('[11] summary row + exports', /s\('lateCv', 0\) \+ ' \/ ' \+ s\('lateForgive', 0\) \+ ' \/ ' \+ s\('lateCapped', 0\)/.test(SRC)
    && typeof v.reconcileConfessions === 'function' && typeof v.lateShadow === 'function');

  // ---- [12] mutation self-checks ----
  const mutants = [
    ['settle conviction not kept', "      confState[cvKey] = { t0: nowMs, mt: matchType, ded: 0, ex: 1, cv: 1, s: x.seat | 0, v: vecTag(g[0]) };",
      "      confState[cvKey] = { t0: nowMs, done: 1 };", (script) => {
        const c = A(20 * MIN), rs = timeline(c.steps, c.P, script);   // [1] before the fix: the fine and the exit stand
        return allOk(rs, 6) && pointsOf(rs[5], c.P[2]).length === 0 && leavesOf(rs[5], c.P[2]) === 1;
      }],
    ['scores tag not checked', "      if (opts.vecTag(r) === st.v) return r;", '      return r;', (script) => {
      const c = A(20 * MIN, forgedScores), rs = timeline(c.steps, c.P, script);   // [5] other scores forgiven
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], c.P[2])) === '[2483]';
    }],
    // (in a full run the seat gate drops a record from a seat the start roster gives someone else ahead of grouping, Q80;
    //   the probe's own seat check is the unit's)
    ['seat not checked', "      if ((r.d[5] | 0) !== (st.s | 0) || sanityFlags([r]).length) continue;", '      if (sanityFlags([r]).length) continue;', async (script) => {
      const r = await U.run(U.base, [U.own(1, SC3)], true, null, require(script));   // [10] a record from another seat forgiven
      return r.writes.length === 1 && r.st.refunded === 1;
    }],
    ['conviction entry on the confession window', "    const winMs = st.cv ? (opts.lateMs || opts.maturityMs) : opts.maturityMs;", '    const winMs = opts.maturityMs;', (script) => {
      const c = A(3 * HOUR), rs = timeline(c.steps, c.P, script);   // [2] closed at 2 h, nothing back at 3 h
      return allOk(rs, 6) && pointsOf(rs[5], c.P[2]).length === 0 && leavesOf(rs[5], c.P[2]) === 1;
    }],
    ['the fine alone given back (no finish)', 'Math.max(0, (st.ded | 0) + (st.w | 0) - (st.g | 0))', 'Math.max(0, (st.ded | 0))', (script) => {
      const c = A(20 * MIN), rs = timeline(c.steps, c.P, script);   // [1] +100: a loss that never happened (2500)
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], c.P[2])) === '[2500]';
    }],
    ['the partner\'s gain not charged', 'Math.max(0, (st.ded | 0) + (st.w | 0) - (st.g | 0))', 'Math.max(0, (st.ded | 0) + (st.w | 0))', (script) => {
      const c = pairGame(20 * MIN), rs = timeline(c.steps, c.P, script);   // [14] +103: the pair keeps the partner's +35
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], c.P[3])) === '[2503]';
    }],
    ['a stranger\'s gain charged', '    if (moved[r.steamID] == null || !(mates && mates.has(r.seat | 0))) continue;', '    if (moved[r.steamID] == null) continue;', (script) => {
      const c = topGame(20 * MIN), rs = timeline(c.steps, c.P, script);   // [13] +103: the stranger's +35 charged to him
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], c.P[2])) === '[2503]';
    }],
    ['the partner\'s gain counted when his write failed', '      st.g = gains.reduce((a, y) => a + (lpOk.has(y[0]) ? y[1] : 0), 0);', '', (script) => {
      const c = pairGame(20 * MIN), p2 = c.P[2], p3 = c.P[3];
      c.steps[4] = [c.steps[4][0], c.steps[4][1], { STUB_POST_FAIL: JSON.stringify([p2]) }];
      const rs = timeline(c.steps, c.P, script);   // [14b] +68: charged for a gain that never landed
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], p3)) === '[2468]';
    }],
    ['failed write keeps its fine', '      if (!lpOk.has(sid)) st.ded = 0;\n', '', (script) => {
      const c = A(20 * MIN), p2 = c.P[2];
      c.steps[4] = [c.steps[4][0], c.steps[4][1], { STUB_POST_FAIL: JSON.stringify([p2]) }];
      const rs = timeline(c.steps, c.P, script);   // [7] a fine never taken given back (2500 -> 2583)
      return allOk(rs, 6) && JSON.stringify(pointsOf(rs[5], p2)) === '[2583]';
    }],
    ['the board not checked', "    const sameBoard = !st.cv || (st.b != null && opts.lpBoard != null && String(st.b) === String(opts.lpBoard));", '    const sameBoard = true;', async (script) => {
      const r = await U.run(U.base, [U.own(2, SC3)], false, null, require(script), { lpBoard: 90001 });   // [10] written on a new season's board
      return r.writes.length === 1;
    }],
    ['no cap', '        if (lf.length >= LATE_CAP.N) {', '        if (false) {', (script) => {
      const P = ids(3), c = capSteps(P), rs = timeline(c.steps, P, script, { LATE_CAP_N: '1' });   // [16] the second forgiven too
      return allOk(rs, 12) && JSON.stringify(pointsOf(rs[11], P[2])) === '[2466]';
    }],
    ['late result not saved on the early return', '      else if ((retracted || st.cv) && opts.checkpoint) opts.checkpoint();   // Q228: an exit retracted or a late result forgiven alone too\n', '', (script) => {
      const tmp = path.join(__dirname, '..', '.mutant-late-result-b-' + process.pid + '.js');
      try {
        fs.writeFileSync(tmp, fs.readFileSync(script, 'utf8').replace(' || confRes.exitHits || confRes.refunded || confRes.retracted || confRes.late) { saveLeavers(leavers); }', ' || confRes.exitHits || confRes.refunded) { saveLeavers(leavers); }'));
        const c = A(20 * MIN, null, 1), rs = timeline(c.steps, c.P, tmp);   // [6] the retraction is lost on the early return
        return allOk(rs, 6) && LATE.test(rs[5].out) && leavesOf(rs[5], c.P[2]) === 1;
      } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
    }],
  ];
  for (const [i, [label, from, to, check]] of mutants.entries()) {
    if (SRC.split(from).length !== 2) { bad('[12] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-late-result-' + process.pid + '-' + i + '.js');   // one path each: a unit mutant require()s it
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[12] ' + label + ' -> the scenario goes red', await check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
  console.log(failN ? '=== FAIL -- ' + failN + ' fail (late-result-refund) ===' : '=== PASS -- 0 fail (late-result-refund) ===');
  process.exit(failN ? 1 : 0);
});
