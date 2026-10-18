'use strict';
// Q183 (cloud audit 2026-10, found doing the Q167 rework): a ranked team match where a player's record went missing after
//   he was seen agreeing (Q149: he finished -- the group waited, his record rotated off its shard, or a client overwrote it
//   with an empty one). The points plan read the team without him: the honest loser who stayed lost the mismatch
//   protection of the normal finish (a gold loser beside a fresh account: -7 where the normal finish gave -2; up to 11
//   points lower across tiers), and a withdrawal on either side moved the others' points both ways (a winner's withdrawal
//   took the strong-team factor off the losers: -7 for -2). Now such a seat is a finished member of its team in the plan
//   (teamLpPlan finished): every present player's points are those of the normal finish. And the loser shielded because
//   his teammate left at the start (convicted) also gets the full-team reading -- the leaver counted at his pre-match
//   rating and points, as if he had stayed and lost: the normal finish -- and keeps the better of it and the present-only
//   reading: with a higher-tier teammate gone he lost up to 2 points more than if that teammate had stayed and lost.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/leaver-ghost.js), plus
//   the pure plan:
//   [0] wiring pins (a failure here is a pin, not behaviour)
//   [1] pure: a seat seen agreeing (either team) leaves every present player at his normal-finish points (a grid)
//   [2] pure: the shielded loser takes exactly the better of the normal finish and the present-only reading (a grid), and
//       the named case (a gold loser whose diamond teammate left: -2 before, -1 = the normal finish now)
//   [3] ranked 2V2, the loser's fresh-account teammate writes the loss, then overwrites it with an empty record: the loser
//       who stayed and the winners take the normal-finish points; logged
//   [4] the same on the winning team: a fresh-account winner writes the win and overwrites it; the two honest losers (level
//       with the strong winner) take the normal-finish points (-2), not the full loss of a team read without him (-7)
//   [5] ranked 2V2, the gold loser's diamond teammate writes the start and leaves: convicted, -100; the loser who stayed
//       takes the normal-finish points (-1; before -2)
//   [6] the teammate seen agreeing has no points row yet this season: read at the placement seed the normal finish would
//       have given him (not written), so the loser who stayed again takes the normal-finish points
//   [7] ranked 3v3, one loser stays, one is seen agreeing and overwrites, one writes the start and leaves: the shielded
//       loser takes the better of his two readings, the one seen agreeing counted once (not also as a leaver)
//   [8] the teammate seen agreeing has a ranked rating apart from his stored one: the plan reads the ranked one, as the
//       normal finish does
//   [9] (Q207) the teammate who left quit with a confession, fined on the board before the settle run: his points read
//       as at his leave (the fine added back), so the loser who stayed again takes the normal-finish points
//   [10] (Q207) the same, but this season's board shows no row for him at the settle, six minutes after his fine (a copy of the
//       board behind it): the settle takes the fine this job wrote as his row (O481) and adds it back as in [9], it neither seeds
//       him again nor writes over the fine; with the kept write past its hold (or before O481) the settle seeds him, and the
//       seed is read as it stands (adding the fine on top of it would read him 100 points too high)
//   [11] (Q207) the fine is added back once, not more: a teammate just below a tier line reads at his points as at his
//       leave, so the loser who stayed takes the normal finish, not the softer loss of a team read a tier higher
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/leaver-ghost.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'RS_THRESHOLD', 'RS_UPSET_BONUS', 'RS_STRONG_UPSET_LOSS',
  'LP_LAST_HOLD_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
// the settle's source: validate.js and the points rules it requires (points-plan.js, O480)
const SRC = fs.readFileSync(VALIDATE, 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
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
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');

function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q183-'));
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
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned season clock (points writes go to the base board), as in test/leaver-ghost.js
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const RATING = 6, POINTS = 7;
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const writesTo = (rs, boardId, sid) => [].concat(...rs.map(r => posts(r, boardId).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]))));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const SID = (n) => '7656119802' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SC = { 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : SC[pc][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const teamRank = (seat, winTeam) => { const team = ((seat / 2) | 0) & 1; return (team === winTeam ? 1 : 3) + (seat % 2); };
const settle = (mt, hash, seat, ros) => rec(0xB1, mt, hash, seat, teamRank(seat, 0), (((seat / 2) | 0) & 1) === 0, ros);
const start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs, pts) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: Object.keys(pts).map(s => ({ steamID: s, score: pts[s] })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const LEAVE = v.LEAVE_CONFIRM_MS + MIN;
function runSteps(steps, pts, skill0, env) {
  const rs = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : { SKILL_FILE: skill0 || {} }, env);
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], out: rs.map(r => r.out).join('') };
}
const lastPts = (m, sid) => { const w = writesTo(m.rs, POINTS, sid); return w.length ? w[w.length - 1] : null; };
// one ranked 2V2 (mt 6; seats 0 / 1 = team A wins, 2 / 3 = team B), every seat writes its start and its result; `late`
//   maps the records seen from the third run on (the write-then-overwrite: a seat's result replaced by an empty record)
function match(hash, ros, pts, sk0, lateOf) {
  const mt = 6;
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const R = ros.map((sid, i) => ({ sid, d: settle(mt, hash, i, ros) }));
  const late = lateOf ? lateOf(R) : R;
  const steps = [[0, S], [MIN, S.concat(R)], [v.SANITY.MIN_START_AGE_MS, S.concat(late)], [GRACE, S.concat(late)], [LEAVE, S.concat(late)], [3 * HOUR, S.concat(late)]];
  return Object.assign(runSteps(steps, pts, sk0), { key: keyOf(S[0].d) });
}
const overwrite = (who) => (R) => R.map((r) => (r.sid === who ? { sid: who, d: [0] } : r));   // the same shard row, emptied

console.log('=== a teammate seen agreeing whose record is gone, and a shielded loser\'s full-team reading (Q183) ===');

// ---- [0] wiring pins ----
{
  T('[0] teamLpPlan takes the finished seats and reads them as members of their team',
    /function teamLpPlan\(parts, matchType, scores, leaverSeats, winTeamOverride, absent, finished\)/.test(SRC)
    && /const roster = parts\.concat\(finished \|\| \[\]\);/.test(SRC) && /for \(const p of roster\) \{ const t = teamOf\(p\.seat\); agg\[t\]\.n\+\+;/.test(SRC)
    && /const mmrs = roster\.map\(p => p\.mmr \| 0\);/.test(SRC));
  T('[0] the shielded loser keeps the better of the present-only and the full-team reading',
    /const mine = \(!won && shielded\.has\(p\.steamID\)\) \? \(absent \|\| \[\]\)\.filter\(a => teamOf\(a\.seat\) === t\) : \[\];/.test(SRC)
    && /if \(fMis && fAvg < fMean\) ff = fSeg\.rs;/.test(SRC) && /if \(fAdj > adjDelta\) \{ adjDelta = fAdj;/.test(SRC));
  T('[0] Q207: a confessed leaver reads with his recorded fine added back (not when this settle seeded him, not once refunded)',
    /if \(leaver && lpx != null && !seededNow\.has\(x\.steamID\)\) \{ const cs = confState\[pid\(String\(x\.steamID\)\) \+ '\|' \+ c\.m\]; if \(cs && !cs\.refunded && \(cs\.ded \| 0\) > 0\) lpx \+= cs\.ded \| 0; \}/.test(SRC)
    && SRC.indexOf('const seededNow = new Set();') < SRC.indexOf('const planRow = async (x, leaver) => {'));
  T('[0] the settle passes the agreed seats as finished, not as absent leavers, with points',
    /for \(const x of ghostLoss\) if \(!agreedIds\.has\(String\(x\.steamID\)\)\) absentIn\.push\(await planRow\(x, true\)\);/.test(SRC)
    && /for \(const x of agreedAbs\) finishedIn\.push\(await planRow\(x\)\);/.test(SRC)
    && /matchPlan\(planIn, matchType, \{ scores, leaverSeats: [^\n]*, winTeam: t2Win, absent: absentIn, finished: finishedIn \}\)/.test(SRC)
    && /teamLpPlan\(parts, matchType, t\.scores, t\.leaverSeats, t\.winTeam, t\.absent, t\.finished\)/.test(SRC)
    && /return \{ seat: x\.seat \| 0, mmr: ts\.displayRating\(r\.mu, r\.sigma\), lp: lpx == null \? 0 : lpx \};/.test(SRC));
}

const MT = 6, SCN = [0, 0, 0, 0];
const LPS = [0, 700, 2500, 3500, 5000, 7000, 9000];
const MMRS = [600, 1000, 1400, 1800, 2200, 2600];
const row = (id, seat, mmr, lp) => ({ steamID: id, seat, mmr, lp });

// ---- [1] pure: a seat seen agreeing leaves every present player at his normal-finish points ----
{
  let n = 0, badLose = 0, badWin = 0, ex = null;
  for (const lw of LPS) for (const lz0 of LPS) for (const lz1 of LPS) for (const mw of MMRS) for (const mz0 of MMRS) for (const mz1 of MMRS) {
    const X = row('X', 0, mw, lw), Y = row('Y', 1, 1000, 0), Z0 = row('Z0', 2, mz0, lz0), Z1 = row('Z1', 3, mz1, lz1);
    const full = v.teamLpPlan([X, Y, Z0, Z1], MT, SCN, [], 0, [], []);
    const loseGone = v.teamLpPlan([X, Y, Z0], MT, SCN, [], 0, [], [{ seat: 3, mmr: mz1, lp: lz1 }]);
    const winGone = v.teamLpPlan([X, Z0, Z1], MT, SCN, [], 0, [], [{ seat: 1, mmr: 1000, lp: 0 }]);
    n++;
    for (const id of ['X', 'Y', 'Z0']) if (loseGone[id].adjDelta !== full[id].adjDelta || loseGone[id].flag !== full[id].flag) { badLose++; ex = ex || { id, full: full[id], gone: loseGone[id], X, Z0, Z1 }; }
    for (const id of ['X', 'Z0', 'Z1']) if (winGone[id].adjDelta !== full[id].adjDelta || winGone[id].flag !== full[id].flag) { badWin++; ex = ex || { id, full: full[id], gone: winGone[id], X, Z0, Z1 }; }
  }
  T('[1] a losing seat seen agreeing: winners and the loser who stayed at the normal finish (' + n + ' cases)', badLose === 0, badLose + ' off, e.g. ' + JSON.stringify(ex));
  T('[1] a winning seat seen agreeing: his teammate and both losers at the normal finish', badWin === 0, badWin + ' off, e.g. ' + JSON.stringify(ex));
}

// ---- [2] pure: the shielded loser's full-team reading ----
{
  let n = 0, belowNormal = 0, belowPresent = 0, notExact = 0, gained = 0, ex = null;
  for (const lw of LPS) for (const lz0 of LPS) for (const lz1 of LPS) for (const mw of MMRS) for (const mz0 of MMRS) for (const mz1 of MMRS) {
    const X = row('X', 0, mw, lw), Y = row('Y', 1, mw, lw), Z0 = row('Z0', 2, mz0, lz0), Z1 = row('Z1', 3, mz1, lz1);
    const full = v.teamLpPlan([X, Y, Z0, Z1], MT, SCN, [], 0, [], []).Z0.adjDelta;
    const present = v.teamLpPlan([X, Y, Z0], MT, SCN, [3], 0, [], []).Z0.adjDelta;   // the shield on the present only (no absent row)
    const left = v.teamLpPlan([X, Y, Z0], MT, SCN, [3], 0, [{ seat: 3, mmr: mz1, lp: lz1 }], []);
    n++;
    if (left.Z0.adjDelta < full) { belowNormal++; ex = ex || { full, present, left: left.Z0, Z0, Z1, X }; }
    if (left.Z0.adjDelta < present) { belowPresent++; ex = ex || { full, present, left: left.Z0, Z0, Z1, X }; }
    if (left.Z0.adjDelta !== Math.max(full, present)) { notExact++; ex = ex || { full, present, left: left.Z0, Z0, Z1, X }; }
    if (left.Z0.adjDelta > present) gained++;
  }
  T('[2] a loser whose teammate left at the start: never below the normal finish (' + n + ' cases)', belowNormal === 0, belowNormal + ', e.g. ' + JSON.stringify(ex));
  T('[2] ... nor below the present-only reading of before', belowPresent === 0, belowPresent + ', e.g. ' + JSON.stringify(ex));
  T('[2] ... and exactly the better of the two (no more: nothing added on top of either)', notExact === 0, notExact + ', e.g. ' + JSON.stringify(ex));
  T('[2] ... and the full-team reading does lift some (the higher-tier teammate cases)', gained > 0, 'gained ' + gained);
  const X = row('X', 0, 2000, 0), Y = row('Y', 1, 2000, 0), Z0 = row('Z0', 2, 1400, 2500), Z1 = row('Z1', 3, 1400, 5000);
  const full = v.teamLpPlan([X, Y, Z0, Z1], MT, SCN, [], 0, [], []).Z0;
  const left = v.teamLpPlan([X, Y, Z0], MT, SCN, [3], 0, [{ seat: 3, mmr: 1400, lp: 5000 }], []).Z0;
  const present = v.teamLpPlan([X, Y, Z0], MT, SCN, [3], 0, [], []).Z0;
  T('[2] a gold loser whose diamond teammate left: -2 on the present only, -1 = the normal finish now (PROTECTED)',
    present.adjDelta === -2 && full.adjDelta === -1 && left.adjDelta === -1 && left.flag === 2, JSON.stringify({ present, full, left }));
  const noAbsentLp = v.teamLpPlan([X, Y, Z0], MT, SCN, [3], 0, [{ seat: 3, mmr: 1400 }], []).Z0;
  T('[2] an absent row without points (an older caller) reads as 0 points, never below the present-only reading', noAbsentLp.adjDelta >= present.adjDelta, JSON.stringify(noAbsentLp));
}

const X = SID(1), Y = SID(2), Z0 = SID(3), Z1 = SID(4);
const HIGH = { mu: 30, sigma: 2 };   // display 1960; a fresh account (no row) reads 1000: more than the 400 mismatch line

// ---- [3] the loser's fresh-account teammate writes the loss, then overwrites it ----
{
  const sk0 = {}; for (const s0 of [X, Y, Z0]) sk0[v.pid(s0)] = { mu: HIGH.mu, sigma: HIGH.sigma };
  const pts = { [X]: 2500, [Y]: 2500, [Z0]: 2500, [Z1]: 2500 };   // gold: win 35, loss 20, drip 3, rs .5
  const ros = [X, Y, Z0, Z1];
  const m = match(0xE183, ros, pts, sk0, overwrite(Z1));
  const n = match(0xE184, ros, pts, sk0, null);   // the normal finish
  T('[3] both settle (exit 0 every run); Z1 seen agreeing, not convicted', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && processedOf(n.last).has(n.key) && leavesOf(m.last, Z1) === 0 && /record gone but seen agreeing earlier/.test(m.out), m.out.slice(-1500));
  T('[3] logged: seat 3 read as a finished member', new RegExp('agreed-gone ' + m.key + ': seat 3 read as finished member\\(s\\) of their team in the points plan \\(Q183\\)').test(m.out), m.out.slice(-1500));
  T('[3] the loser who stayed takes the normal-finish points (-2, PROTECTED; before: -7)', lastPts(m, Z0) === lastPts(n, Z0) && lastPts(m, Z0) === 2500 + Math.round(-20 * 0.5 / 2 + 3)
    && /PROTECTED normal -7/.test(m.out), JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
  T('[3] the winners take the normal-finish points', [X, Y].every(s => lastPts(m, s) != null && lastPts(m, s) === lastPts(n, s)), JSON.stringify([X, Y].map(s => [lastPts(m, s), lastPts(n, s)])));
  T('[3] nobody points-written for Z1 (not rated, not convicted)', writesTo(m.rs, POINTS, Z1).length === 0, JSON.stringify(writesTo(m.rs, POINTS, Z1)));
}

// ---- [4] the same on the winning team ----
{
  const sk0 = {}; for (const s0 of [X, Z0, Z1]) sk0[v.pid(s0)] = { mu: HIGH.mu, sigma: HIGH.sigma };   // Y fresh (1000)
  const pts = { [X]: 2500, [Y]: 2500, [Z0]: 2500, [Z1]: 2500 };
  const ros = [X, Y, Z0, Z1];
  const m = match(0xE185, ros, pts, sk0, overwrite(Y));
  const n = match(0xE186, ros, pts, sk0, null);
  T('[4] both settle; Y seen agreeing, not convicted', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key) && leavesOf(m.last, Y) === 0,
    m.out.slice(-1500));
  T('[4] the two honest losers take the normal-finish points (-2: the strong team\'s mild upset loss; before: -7)',
    [Z0, Z1].every(s => lastPts(m, s) === lastPts(n, s) && lastPts(m, s) === 2500 + Math.round(-20 * 0.5 / 2 + 3)), JSON.stringify([Z0, Z1].map(s => [lastPts(m, s), lastPts(n, s)])));
  T('[4] the winner who stayed takes the normal-finish points', lastPts(m, X) != null && lastPts(m, X) === lastPts(n, X), JSON.stringify([lastPts(m, X), lastPts(n, X)]));
}

// ---- [5] the gold loser's diamond teammate writes the start and leaves ----
{
  const W = { mu: 31, sigma: 2 }, L = { mu: 16, sigma: 2 };   // displays 2000 / 1400
  const sk0 = { [v.pid(X)]: W, [v.pid(Y)]: W, [v.pid(Z0)]: L, [v.pid(Z1)]: L };
  const pts = { [X]: 0, [Y]: 0, [Z0]: 2500, [Z1]: 5000 };
  const ros = [X, Y, Z0, Z1], mt = 6;
  const S = ros.map((sid, i) => ({ sid, d: start(mt, 0xE187, i, ros) }));
  const R3 = [0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, 0xE187, i, ros) }));
  const all = S.concat(R3);
  const m = runSteps([[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]], pts, sk0);
  const n = match(0xE188, ros, pts, sk0, null);
  const key = keyOf(S[0].d);
  T('[5] both settle; Z1 convicted once, -100 points', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(key) && leavesOf(m.last, Z1) === 1
    && writesTo(m.rs, POINTS, Z1).slice(-1)[0] === 4900, m.out.slice(-1500));
  T('[5] the loser who stayed takes the normal-finish points (-1, PROTECTED; before: -2)', lastPts(n, Z0) === 2499 && lastPts(m, Z0) === lastPts(n, Z0), JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}

// ---- [6] the teammate seen agreeing has no points yet this season: read at the placement seed the settle would give him ----
{
  const sk0 = {}; for (const s0 of [X, Y, Z0, Z1]) sk0[v.pid(s0)] = { mu: HIGH.mu, sigma: HIGH.sigma };   // all level: no mismatch
  const pts = { [X]: 3500, [Y]: 3500, [Z0]: 3500 };   // Z1 has no row: the normal finish seeds him (display 1960 -> 3200)
  const ros = [X, Y, Z0, Z1];
  const m = match(0xE189, ros, pts, sk0, overwrite(Z1));
  const n = match(0xE18A, ros, pts, sk0, null);
  T('[6] both settle; the normal finish seeds Z1 at 3200, the overwrite writes nothing for him', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0)
    && writesTo(n.rs, POINTS, Z1).slice(-1)[0] != null && writesTo(m.rs, POINTS, Z1).length === 0 && /first settle this season, display 1960 -> pts 3200/.test(n.out), n.out.slice(-1500));
  T('[6] the loser who stayed takes the normal-finish points (team average platinum: -9; read at 0 points it would be silver)', lastPts(m, Z0) === lastPts(n, Z0) && lastPts(n, Z0) === 3500 + Math.round(-22 / 2 + 2),
    JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}

// ---- [7] ranked 3v3: one loser stays, one is seen agreeing and overwrites, one writes the start and leaves ----
//   the loser who stayed is shielded (a teammate left) and reads the one seen agreeing as finished: the better of that
//   present-only reading and the normal finish, each seat counted once
{
  SC[6] = [6100, 5800, 5200, 4800, 4300, 3900];
  const A = SID(11), B = SID(12), C = SID(13), L0 = SID(14), L1 = SID(15), L2 = SID(16);
  const ros = [A, B, C, L0, L1, L2], mt = 9, hash = 0xE18B;
  const WIN = { mu: 41, sigma: 2 }, LOS = { mu: 16, sigma: 2 };   // displays 2400 / 1400: the losers the weak team
  const sk0 = {}; for (const s0 of [A, B, C]) sk0[v.pid(s0)] = WIN; for (const s0 of [L0, L1, L2]) sk0[v.pid(s0)] = LOS;
  const pts = { [A]: 2500, [B]: 2500, [C]: 2500, [L0]: 0, [L1]: 0, [L2]: 9000 };   // the leaver a grandmaster, the other two bronze
  const r3 = (seat) => rec(0xB1, mt, hash, seat, seat < 3 ? 1 + seat : 4 + (seat % 3), seat < 3, ros);
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const R = [0, 1, 2, 3, 4].map((i) => ({ sid: ros[i], d: r3(i) }));
  const W = R.map((r) => (r.sid === L1 ? { sid: L1, d: [0] } : r));
  const steps = [[0, S], [MIN, S.concat(R)], [v.SANITY.MIN_START_AGE_MS, S.concat(W)], [GRACE, S.concat(W)], [LEAVE, S.concat(W)], [3 * HOUR, S.concat(W)]];
  const m = runSteps(steps, pts, sk0);
  const key = keyOf(S[0].d);
  // the two readings the plan compares for L0 (pure, as main() passes them)
  const pr = (sid, seat, lp) => row(sid, seat, 2400 - (seat >= 3 ? 1000 : 0), lp);
  const P3 = [pr('A', 0, 2500), pr('B', 1, 2500), pr('C', 2, 2500)];
  const normal = v.teamLpPlan(P3.concat([pr('L0', 3, 0), pr('L1', 4, 0), pr('L2', 5, 9000)]), mt, SC[6], [], 0, [], []).L0.adjDelta;
  const present = v.teamLpPlan(P3.concat([pr('L0', 3, 0)]), mt, SC[6], [5], 0, [], [{ seat: 4, mmr: 1400, lp: 0 }]).L0.adjDelta;
  T('[7] every run exits 0, settled; L1 seen agreeing (not convicted), L2 convicted', m.rs.every(r => r.code === 0) && processedOf(m.last).has(key)
    && leavesOf(m.last, L1) === 0 && leavesOf(m.last, L2) === 1 && /record gone but seen agreeing earlier/.test(m.out), m.out.slice(-1500));
  T('[7] the two readings differ here (normal finish ' + normal + ', present-only ' + present + ')', normal > present, JSON.stringify({ normal, present }));
  T('[7] the loser who stayed takes the better one (the normal finish), L1 counted once', lastPts(m, L0) === 0 + normal, JSON.stringify([lastPts(m, L0), normal, present]));
}

// ---- [8] the teammate seen agreeing has a ranked rating apart from his stored one: the plan reads the ranked one ----
{
  const sk0 = {}; for (const s0 of [X, Y, Z0]) sk0[v.pid(s0)] = { mu: HIGH.mu, sigma: HIGH.sigma };
  sk0[v.pid(Z1)] = { mu: HIGH.mu, sigma: HIGH.sigma, rm: 15, rv: 2 };   // stored 1960 (level), ranked 1360 (a spread of 600)
  const pts = { [X]: 2500, [Y]: 2500, [Z0]: 2500, [Z1]: 2500 };
  const ros = [X, Y, Z0, Z1];
  const m = match(0xE18C, ros, pts, sk0, overwrite(Z1));
  const n = match(0xE18D, ros, pts, sk0, null);
  T('[8] the loser who stayed takes the normal-finish points (-2: the mismatch of the ranked rating; read on the stored one: -7)',
    m.rs.every(r => r.code === 0) && lastPts(m, Z0) === lastPts(n, Z0) && lastPts(n, Z0) === 2500 + Math.round(-20 * 0.5 / 2 + 3), JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}

// ---- [9] (Q207) the gold loser's diamond teammate quits with a confession: the confession path fines him at first sight,
//   before the run reads the points board, so every later read holds his points after the leave (the stub keeps no
//   writes: the board passes them per step). Read as they stand the team average falls a tier (3025 -> 2975) and the
//   loser who stayed took -2 where the normal finish gives -1; with the fine added back he takes the normal finish ----
{
  const W = { mu: 31, sigma: 2 }, L = { mu: 16, sigma: 2 };   // displays 2000 / 1400
  const sk0 = { [v.pid(X)]: W, [v.pid(Y)]: W, [v.pid(Z0)]: L, [v.pid(Z1)]: L };
  const pts0 = { [X]: 0, [Y]: 0, [Z0]: 2000, [Z1]: 4050 }, pts1 = Object.assign({}, pts0, { [Z1]: 3950 });
  const ros = [X, Y, Z0, Z1], mt = 6, hash = 0xE18E;
  const conf = () => { const d = start(mt, hash, 3, ros); d[0] = 0xB5; d[10 + ros.length] = 5; return d; };   // user-quit
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const all = S.concat([0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, hash, i, ros) })), [{ sid: Z1, d: conf() }]);
  const steps = [[0, S, pts0], [5 * MIN, all, pts0], [GRACE, all, pts1], [LEAVE, all, pts1], [3 * HOUR, all, pts1]];
  const rs = []; let state = null;
  for (const [ms, recs, pts] of steps) { const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : { SKILL_FILE: sk0 }); rs.push(r); state = r.state; if (r.code !== 0) break; }
  const m = { rs, last: rs[rs.length - 1], out: rs.map(r => r.out).join('') };
  const n = match(0xE18F, ros, pts0, sk0, null);
  T('[9] both settle; Z1 fined once by his confession (-100), not convicted again', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(keyOf(S[0].d))
    && leavesOf(m.last, Z1) === 1 && writesTo(m.rs, POINTS, Z1).length === 1 && /already confessed -- consensus conviction skipped/.test(m.out), m.out.slice(-1500));
  T('[9] the loser who stayed takes the normal-finish points (-1; read on the fined points: -2)', lastPts(n, Z0) === 1999 && lastPts(m, Z0) === lastPts(n, Z0), JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}
// ---- [10] (Q207) a gold loser's teammate with no points row quits with a confession: the confession path seeds him
//   (display 1775 -> 3100) and fines him 100 (written: 3000), but this season's board still shows no row for him at the
//   settle six minutes later (the stub keeps no writes and the step passes none: a copy of the board behind the fine).
//   O481: the settle takes the fine this job wrote as his row ([stale-read]) and adds it back as in [9]: 3100, his points as
//   at his leave, team average 2975 (gold), -2 as in the normal finish; it no longer seeds him again and writes that seed
//   (3100) over his fine. With the hold off (the job before O481; a kept write past its hold) the settle seeds him again at
//   3100, read as it stands: the same plan. Adding the recorded fine on top of the seed would read 3200 (team average 3025,
//   platinum) and give -1 ----
{
  const W = { mu: 31, sigma: 2 }, L = { mu: 16, sigma: 2 }, F = { mu: 25.375, sigma: 2 };   // displays 2000 / 1400 / 1775
  const sk0 = { [v.pid(X)]: W, [v.pid(Y)]: W, [v.pid(Z0)]: L, [v.pid(Z1)]: F };
  const pts0 = { [X]: 0, [Y]: 0, [Z0]: 2850 };   // Z1: no row, before and after his fine
  const ros = [X, Y, Z0, Z1], mt = 6, hash = 0xE1A0;
  const conf = () => { const d = start(mt, hash, 3, ros); d[0] = 0xB5; d[10 + ros.length] = 5; return d; };   // user-quit
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const all = S.concat([0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, hash, i, ros) })), [{ sid: Z1, d: conf() }]);
  const steps = [[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]];
  const m = runSteps(steps, pts0, sk0);
  const o = runSteps(steps, pts0, sk0, { LP_LAST_HOLD_MS: '0' });
  const n = match(0xE1A1, ros, pts0, sk0, null);
  const staleZ1 = new RegExp('\\[stale-read\\] points ' + v.pid(Z1).slice(0, 8) + ' \\(points board\\): read no row without the last write of this job \\(3000, ');
  T('[10] both settle; Z1 fined from his seed by his confession (3100 -> 3000); the read without the fine takes it (O481): not seeded again, the fine not written over, not convicted again',
    m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(keyOf(S[0].d)) && leavesOf(m.last, Z1) === 1
    && /pts 3100-100->3000 \(seeded base\)/.test(m.out) && staleZ1.test(m.out) && !/leaver, first settle this season/.test(m.out)
    && JSON.stringify(writesTo(m.rs, POINTS, Z1)) === '[3000]' && /already confessed -- consensus conviction skipped/.test(m.out), m.out.slice(-1500));
  T('[10] the hold off (the job before O481): seeded again at the settle (3100, written over his fine), not convicted again',
    o.rs.every(r => r.code === 0) && processedOf(o.last).has(keyOf(S[0].d)) && leavesOf(o.last, Z1) === 1 && !/\[stale-read\]/.test(o.out)
    && /leaver, first settle this season, display 1775 -> pts 3100/.test(o.out) && JSON.stringify(writesTo(o.rs, POINTS, Z1)) === '[3000,3100]'
    && /already confessed -- consensus conviction skipped/.test(o.out), o.out.slice(-1500));
  T('[10] the loser who stayed takes the normal-finish points, hold on or off (-2; the fine added on top of the seed: -1)',
    lastPts(n, Z0) === 2848 && lastPts(m, Z0) === lastPts(n, Z0) && lastPts(o, Z0) === lastPts(n, Z0), JSON.stringify([lastPts(m, Z0), lastPts(o, Z0), lastPts(n, Z0)]));
}
// ---- [11] (Q207) the gold loser's teammate (3950, just below the platinum line) quits with a confession: fined to 3850 at
//   first sight. Read as at his leave (3950: team average 2975, gold) the loser who stayed takes the normal finish, -2.
//   The fine added back twice would read him at 4050 (team average 3025, platinum) and give -1: more than staying ----
{
  const W = { mu: 31, sigma: 2 }, L = { mu: 16, sigma: 2 };   // displays 2000 / 1400
  const sk0 = { [v.pid(X)]: W, [v.pid(Y)]: W, [v.pid(Z0)]: L, [v.pid(Z1)]: L };
  const pts0 = { [X]: 0, [Y]: 0, [Z0]: 2000, [Z1]: 3950 }, pts1 = Object.assign({}, pts0, { [Z1]: 3850 });
  const ros = [X, Y, Z0, Z1], mt = 6, hash = 0xE1B0;
  const conf = () => { const d = start(mt, hash, 3, ros); d[0] = 0xB5; d[10 + ros.length] = 5; return d; };   // user-quit
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const all = S.concat([0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, hash, i, ros) })), [{ sid: Z1, d: conf() }]);
  const steps = [[0, S, pts0], [5 * MIN, all, pts0], [GRACE, all, pts1], [LEAVE, all, pts1], [3 * HOUR, all, pts1]];
  const rs = []; let state = null;
  for (const [ms, recs, pts] of steps) { const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : { SKILL_FILE: sk0 }); rs.push(r); state = r.state; if (r.code !== 0) break; }
  const m = { rs, last: rs[rs.length - 1], out: rs.map(r => r.out).join('') };
  const n = match(0xE1B1, ros, pts0, sk0, null);
  T('[11] both settle; Z1 fined once by his confession (3950 -> 3850), not convicted again', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(keyOf(S[0].d))
    && leavesOf(m.last, Z1) === 1 && /pts 3950-100->3850/.test(m.out) && /already confessed -- consensus conviction skipped/.test(m.out), m.out.slice(-1500));
  T('[11] the loser who stayed takes the normal-finish points (-2; the fine added back twice: -1)', lastPts(n, Z0) === 1998 && lastPts(m, Z0) === lastPts(n, Z0),
    JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}
console.log(failN ? 'agreed-teammate: ' + failN + ' FAIL' : 'agreed-teammate: all ok');
process.exit(failN ? 1 : 0);
