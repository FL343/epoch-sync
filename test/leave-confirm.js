'use strict';
// Q121 (cloud audit 2026-10): a missing result is evidence that a player left only once his match must be over.
// Two players of a match (modified clients, no outside account) wrote one consistent made-up result a minute in, each
// from his own seat; the seat gate and the roster checks (Q75 / Q80) pass it. After the start floor and the absence grace
// the job settled it: the players still at the table were convicted as leavers (their own starts, no result yet), the two
// writers rated as the winners, and the real result reached a processed key. Now an absent seat whose player wrote his own
// start and no result or confession holds the group until LEAVE_CONFIRM_MS after the job first read that start.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as test/seat-gate.js).
//   [1] units: leaveConfirmHold (no absent seat / named only / waiting / past the wait / own result / confession /
//       measured from the start sighting / a stamp from the future restarts the wait / the floor / two seats)
//   [2] units: noteOwnStarts keeps when each start was first read (relative to t0, first sighting only, none at t0)
//   [3] LEAVE_CONFIRM_MS from the environment: a value under the floor is raised to it
//   [4] N1 (review3-q80.js): 4-player ranked FFA, two players write the made-up result a minute in: the key waits, the
//       real result disagrees with it, nobody is rated or convicted; the start verdict closes it at maturity
//   [5] N2: 2V2 ranked, the losing pair writes "we won" a minute in: the same
//   [6] quick FFA (exit rate only): the same, nobody gets an exit
//   [7] a bot match with two humans: one writes his result a minute in; the other's real result disagrees, neither gains
//   [8] an honest quitter (his start, no result, no confession): the key waits until his match must be over, then
//       settles with him convicted once and the others rated
//   [9] a quitter who confessed: no wait past the absence grace, counted once on the confession path
//   [10] the wait runs from the job's first read of the other players' starts: the modified host and his partner write
//        their own starts 45 minutes early (a start roster registers from two), the made-up result follows the others'
//        starts, the real result lands 66 minutes after the early starts
//   [10b] Q121 review A2-A6: the made-up result leaves the seats still playing empty ('0', the bot-seat form), so its own
//         roster shows nobody absent -- ranked FFA, 2V2, quick, a bot match, a friend room: the key waits for them anyway
//         (the registered start roster names them), nobody gains
//   [10c] the same with two alts named in those seats (A7), and with only one writer blanking them (A9)
//   [10d] controls: startRosterGaps units; an honest match where everybody wrote the real result settles with no wait
//   [11] wiring pins (hold placement, the start roster gaps, the wait constant, the start sightings, summary row, exports)
//   [12] mutation self-checks (hold removed -> [4] [5] [7] red; measured from t0 -> [10] red; confession ignored -> [9] waits;
//        start roster gaps ignored / their pid ignored -> [10b] [10c] red)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
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
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leave-confirm-'));
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
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) and the
      //   points writes read below would go elsewhere -- every test runs before each production reconcile, so a
      //   date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so
//   every stored instant moves back instead: start sightings, absent-seat stamps and the writers' busy marks)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const anyPoints = (r) => posts(r, 7).length;


const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const LEAVE_WAIT = /leave-wait [^\n]*until the match must be over, deferred \(Q121\)/;
const waitSecs = (r) => { const m = /leave-wait [^\n]* -- ([0-9]+)s until the match must be over/.exec(r.out); return m ? Number(m[1]) : -1; };
const SUMMARY_ROW = /\| groups waiting for a seat that started but has no result yet, until the match must be over \(Q121\) \| ([0-9]+) \|/;

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat, '0' = a bot seat; sc: the per-seat scores this writer reports (the consistency vector)
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// the confession a quitter's own client writes (result-reporter submitMatchAbandon): result fields 0, disp 5 = user-quit
function confess(mt, hash, seat, ros) {
  const pc = ros.length, d = [0xB5, 1, mt, hash | 0, 1234, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(5);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
const settle = (mt, h, ros, seat, rank, win, sc) => ({ sid: ros[seat], d: rec(0xB1, mt, h, seat, rank, win, ros, sc) });
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const REAL4 = [6100, 5200, 4800, 3900], FAKE4 = [1000, 900, 6100, 5200];   // the made-up row: seats 2 / 3 on top
const N1P = [101, 102, 103, 104].map(SID), N2P = [111, 112, 113, 114].map(SID), QP = [121, 122, 123, 124].map(SID);
const BP = [151, 152].map(SID), HQ = [131, 132, 133].map(SID), CQ = [136, 137, 138].map(SID), EP = [141, 142, 143, 144].map(SID);
// [10b] [10c] [10d]: one id set per scenario (one account = one entry per shard, the steps reuse the boards)
const B1P = [161, 162, 163, 164].map(SID), B2P = [165, 166, 167, 168].map(SID), B3P = [171, 172, 173, 174].map(SID), BBP = [175, 176].map(SID);
const BFP = [177, 178, 179].map(SID), A7P = [181, 182, 183, 184].map(SID), A7X = [185, 186].map(SID), A9P = [187, 188, 189, 190].map(SID);
const HNP = [191, 192, 193, 194].map(SID);
const ALL = [].concat(N1P, N2P, QP, BP, HQ, CQ, EP, B1P, B2P, B3P, BBP, BFP, A7P, A7X, A9P, HNP);
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// a timeline of runs: [[ms since the previous run, records visible in that run], ...] -> every run's result
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const up = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] > 2500; };
const down = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] < 2500; };
const none = (rs, sid) => ptsIn(rs, sid).length === 0;
const xpPosts = (rs, sid) => [].concat(...rs.map(r => posts(r, 5).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body))));
const neverLeft = (rs, sids) => sids.every(s => rs.every(r => leavesOf(r, s) === 0));

// ---- scenarios (each a list of timeline steps; the mutants below rerun them) ----
// the made-up result a minute after the starts, the real one twelve minutes in, then the start verdict's maturity
const framedSteps = (S, F, R) => [[0, S], [1 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [1 * MIN, S.concat(F, R)],
  [6 * MIN, S.concat(F, R)], [6 * MIN, S.concat(F, R)], [3 * HOUR, S.concat(F, R)]];
const N1 = () => {   // 4-player ranked FFA (mt 2), N1P[2] / N1P[3] write the made-up result
  const h = 0x9101, P = N1P;
  const S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const F = [settle(2, h, P, 2, 1, true, FAKE4), settle(2, h, P, 3, 2, false, FAKE4)];
  const R = [settle(2, h, P, 0, 1, true, REAL4), settle(2, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]] };
};
const t2rank = (seat, winTeam) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === winTeam ? 1 : 3) + inTeam; };
const N2 = () => {   // 2V2 ranked (mt 6): seats 0 / 1 really won, the losers 2 / 3 write "we won" (their made-up row)
  const h = 0x9102, P = N2P, FK = [900, 800, 6100, 5200];
  const S = [0, 1, 2, 3].map(s => start(6, h, P, s));
  const F = [2, 3].map(s => settle(6, h, P, s, t2rank(s, 1), true, FK));
  const R = [0, 1].map(s => settle(6, h, P, s, t2rank(s, 0), true, REAL4));
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]] };
};
const QK = () => {   // 4-player quick FFA (mt 1): no points surface, an exit is the whole stake
  const h = 0x9103, P = QP;
  const S = [0, 1, 2, 3].map(s => start(1, h, P, s));
  const F = [settle(1, h, P, 2, 1, true, FAKE4), settle(1, h, P, 3, 2, false, FAKE4)];
  const R = [settle(1, h, P, 0, 1, true, REAL4), settle(1, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]] };
};
const BOT = () => {   // bot match (mt 11, tier auto): two humans + two bot seats; BP[1] writes his result a minute in
  const h = 0x9104, ros = [BP[0], BP[1], '0', '0'];
  const S = [0, 1].map(s => start(11, h, ros, s));
  const F = [settle(11, h, ros, 1, 1, true, [900, 6100, 1000, 800])];
  const R = [settle(11, h, ros, 0, 1, true, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [BP[0]], writers: [BP[1]] };
};
const QUIT = () => {   // 3-player ranked FFA, HQ[2] leaves after his start: no result, no confession
  const h = 0x9105, P = HQ, SC3 = [9000, 6000, 3000];
  const S = [0, 1, 2].map(s => start(2, h, P, s));
  const R = [settle(2, h, P, 0, 1, true, SC3), settle(2, h, P, 1, 2, false, SC3)];
  const steps = [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [v.LEAVE_CONFIRM_MS - 23 * MIN, S.concat(R)]];
  return { key: keyOf(S[0].d), steps, P };
};
const CONF = () => {   // the same, the quitter's client confessed (user-quit)
  const h = 0x9106, P = CQ, SC3 = [9000, 6000, 3000];
  const S = [0, 1, 2].map(s => start(2, h, P, s));
  const R = [settle(2, h, P, 0, 1, true, SC3), settle(2, h, P, 1, 2, false, SC3)];
  const C = [{ sid: P[2], d: confess(2, h, 2, P) }];
  const steps = [[0, S], [12 * MIN, S.concat(R, C)], [6 * MIN, S.concat(R, C)], [6 * MIN, S.concat(R, C)]];
  return { key: keyOf(S[0].d), steps, P };
};
const EARLY = () => {   // the modified host EP[0] and EP[3] write their own starts 45 minutes before the others (one start alone
  //   registers no roster), then the made-up result once the others' starts are in
  const h = 0x9107, P = EP, FK = [6100, 900, 800, 5200], RL = [2000, 6100, 5200, 3000];
  const S0 = [start(2, h, P, 0), start(2, h, P, 3)], S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const F = [settle(2, h, P, 0, 1, true, FK), settle(2, h, P, 3, 2, false, FK)];
  const R = [settle(2, h, P, 1, 1, true, RL), settle(2, h, P, 2, 2, false, RL)];
  const steps = [[0, S0], [45 * MIN, S], [1 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [5 * MIN, S.concat(F)],
    [5 * MIN, S.concat(F, R)], [6 * MIN, S.concat(F, R)], [3 * HOUR, S.concat(F, R)]];
  return { key: keyOf(S[0].d), steps, honest: [P[1], P[2]], writers: [P[0], P[3]] };
};

// [10b]: the made-up result's own roster blanks the seats still playing ('0' = the bot-seat form decodeRoster skips)
const blank = (P, seats) => P.map((x, i) => (seats.indexOf(i) >= 0 ? '0' : x));
const BLANK_FFA = () => {   // A2: 4-player ranked FFA, B1P[2] / B1P[3] write the made-up result with seats 0 / 1 empty
  const h = 0x9111, P = B1P, FR = blank(P, [0, 1]);
  const S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const F = [settle(2, h, FR, 2, 1, true, FAKE4), settle(2, h, FR, 3, 2, false, FAKE4)];
  const R = [settle(2, h, P, 0, 1, true, REAL4), settle(2, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]], seats: '0,1', lane: 'points' };
};
const BLANK_2V2 = () => {   // A3: 2V2 ranked, the losers write "we won" with the real winners' seats empty
  const h = 0x9112, P = B2P, FR = blank(P, [0, 1]), FK = [900, 800, 6100, 5200];
  const S = [0, 1, 2, 3].map(s => start(6, h, P, s));
  const F = [2, 3].map(s => settle(6, h, FR, s, t2rank(s, 1), true, FK));
  const R = [0, 1].map(s => settle(6, h, P, s, t2rank(s, 0), true, REAL4));
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]], seats: '0,1', lane: 'points' };
};
const BLANK_QK = () => {   // A4: 4-player quick FFA, as A2
  const h = 0x9113, P = B3P, FR = blank(P, [0, 1]);
  const S = [0, 1, 2, 3].map(s => start(1, h, P, s));
  const F = [settle(1, h, FR, 2, 1, true, FAKE4), settle(1, h, FR, 3, 2, false, FAKE4)];
  const R = [settle(1, h, P, 0, 1, true, REAL4), settle(1, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]], seats: '0,1', lane: 'xp' };
};
const BLANK_BOT = () => {   // A5: bot match, two humans + two bot seats; BBP[1] writes "I won" with the other human's seat empty
  const h = 0x9114, ros = [BBP[0], BBP[1], '0', '0'], FR = ['0', BBP[1], '0', '0'];
  const S = [0, 1].map(s => start(11, h, ros, s));
  const F = [settle(11, h, FR, 1, 1, true, [900, 6100, 1000, 800])];
  const R = [settle(11, h, ros, 0, 1, true, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [BBP[0]], writers: [BBP[1]], seats: '0', lane: 'xp' };
};
const BLANK_FRIEND = () => {   // A6: 3-player friend room (type 10), BFP[1] / BFP[2] write a consistent made-up result, seat 0 empty
  const h = 0x9115, P = BFP, FR = blank(P, [0]), FK = [1000, 9000, 6000], RL = [9000, 6000, 3000];
  const S = [0, 1, 2].map(s => start(10, h, P, s));
  const F = [settle(10, h, FR, 1, 1, true, FK), settle(10, h, FR, 2, 2, false, FK)];
  const R = [settle(10, h, P, 0, 1, true, RL)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0]], writers: [P[1], P[2]], seats: '0', lane: 'xp' };
};
const ALTS = () => {   // A7: 4-player ranked FFA, the made-up result names two alts (no start of theirs) in seats 0 / 1
  const h = 0x9116, P = A7P, FR = [A7X[0], A7X[1], P[2], P[3]];
  const S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const F = [settle(2, h, FR, 2, 1, true, FAKE4), settle(2, h, FR, 3, 2, false, FAKE4)];
  const R = [settle(2, h, P, 0, 1, true, REAL4), settle(2, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]], seats: '0,1', lane: 'points' };
};
const ONE_BLANKS = () => {   // A9: only A9P[2] blanks seats 0 / 1, A9P[3] copies the real roster (same made-up scores)
  const h = 0x9117, P = A9P, FR = blank(P, [0, 1]);
  const S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const F = [settle(2, h, FR, 2, 1, true, FAKE4), settle(2, h, P, 3, 2, false, FAKE4)];
  const R = [settle(2, h, P, 0, 1, true, REAL4), settle(2, h, P, 1, 2, false, REAL4)];
  return { key: keyOf(S[0].d), steps: framedSteps(S, F, R), honest: [P[0], P[1]], writers: [P[2], P[3]], seats: '0,1', lane: 'points' };
};
const HONEST = () => {   // [10d] 4-player ranked FFA, everybody writes the real result twelve minutes in
  const h = 0x9118, P = HNP;
  const S = [0, 1, 2, 3].map(s => start(2, h, P, s));
  const R = [0, 1, 2, 3].map(s => settle(2, h, P, s, s + 1, s === 0, REAL4));
  return { key: keyOf(S[0].d), steps: [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]], P };
};
// [10b] [10c] the framers gain when the start roster gaps are ignored (the mutants below): a matchmade lane rates the
//   made-up winner (or credits the writers' quick XP while the players at the table get none); the bot / friend lane
//   credits the writers' XP while the players at the table get none
const framersGained = (c, rs) => (c.lane === 'points' ? up(rs, c.writers[0]) : c.writers.every(s => xpPosts(rs, s).length === 1))
  && c.honest.every(s => (c.lane === 'points' ? none(rs, s) : xpPosts(rs, s).length === 0));

console.log('=== a missing result convicts a player only once his match must be over (Q121) ===');

// ---- [1] units: leaveConfirmHold ----
{
  const L = v.LEAVE_CONFIRM_MS, FL = v.LEAVE_CONFIRM_MIN_MS, now = 10 * HOUR;
  const [a, b] = [SID(901), SID(902)], ha = v.pid(a), hb = v.pid(b);
  const pend = (extra) => Object.assign({ t0: now - 10 * MIN, roster: { 2: ha, 3: hb }, settled: [], started: [ha, hb] }, extra || {});
  const abs = [{ seat: 2, steamID: a }];
  const H = (absent, p, t, ms, own, conf) => v.leaveConfirmHold(absent, p, t, ms == null ? L : ms, own || (() => false), conf || (() => false));
  T('[1] no absent seat / no entry -> no hold', !H([], pend(), now).hold && !H(null, pend(), now).hold && !H(abs, null, now).hold);
  T('[1] a seat named by the others only (no start of his) -> no hold (Q69 does not convict him)', !H(abs, pend({ started: [hb] }), now).hold);
  const w = H(abs, pend(), now);
  T('[1] his start, no result, 10 min in -> hold for the rest of the wait, his seat listed', w.hold && w.seats.join() === '2' && w.waitMs === L - 10 * MIN, JSON.stringify(w));
  T('[1] past the wait -> no hold', !H(abs, pend({ t0: now - L }), now).hold && !H(abs, pend({ t0: now - L - 1 }), now).hold);
  T('[1] his own result for the key, or his confession -> no hold', !H(abs, pend(), now, null, (h) => h === ha).hold && !H(abs, pend(), now, null, null, (h) => h === ha).hold);
  const s = H(abs, pend({ t0: now - L, startSeen: { [ha]: 20 * MIN } }), now);
  T('[1] measured from the job\'s first read of his start (t0 + startSeen), not t0', s.hold && s.waitMs === 20 * MIN, JSON.stringify(s));
  const f = H(abs, pend({ t0: now + HOUR }), now);
  T('[1] a stamp from the future restarts the wait, never skips it', f.hold && f.waitMs === L, JSON.stringify(f));
  const fl = H(abs, pend(), now, 1000);
  T('[1] a wait under the floor is raised to it', fl.hold && fl.waitMs === FL - 10 * MIN, JSON.stringify(fl));
  const two = H([{ seat: 2, steamID: a }, { seat: 3, steamID: b }], pend({ startSeen: { [hb]: 5 * MIN } }), now);
  T('[1] two seats: both listed, the longer wait', two.hold && two.seats.join() === '2,3' && two.waitMs === L - 5 * MIN, JSON.stringify(two));
  T('[1] the wait covers the longest match (45 min floor, 60 min default, at most the 2 h start maturity)', FL === 45 * MIN && L === HOUR && L < v.STARTS_MATURITY_MS, FL + ' ' + L);
}

// ---- [2] units: noteOwnStarts keeps the first sighting ----
{
  const t0 = 5 * HOUR, rA = { steamID: SID(911), d: [] }, rB = { steamID: SID(912), d: [] }, rC = { steamID: SID(913), d: [] };
  const p = { t0, roster: {}, settled: [] };
  v.noteOwnStarts(p, [rA], t0);
  v.noteOwnStarts(p, [rC], t0 + 400);
  T('[2] read at t0 or within a second of it (the run that registered the entry): started, no stamp (the wait counts from t0)',
    p.started.length === 2 && !p.startSeen, JSON.stringify(p.startSeen));
  v.noteOwnStarts(p, [rB], t0 + 7 * MIN);
  v.noteOwnStarts(p, [rB], t0 + 30 * MIN);
  T('[2] read later: ms after t0, first sighting only', (p.startSeen || {})[v.pid(SID(912))] === 7 * MIN, JSON.stringify(p.startSeen));
  const q = { t0, roster: {}, settled: [] };
  v.noteOwnStarts(q, [rB]);
  T('[2] no time given (older callers): started, no stamp', q.started.length === 1 && !q.startSeen);
}

// ---- [3] the environment cannot shorten the wait below the floor ----
{
  const read = (val) => {
    const r = spawnSync(process.execPath, ['-e', 'const v = require(' + JSON.stringify(VALIDATE) + '); process.stdout.write(String(v.LEAVE_CONFIRM_MS));'],
      { env: Object.assign({}, process.env, { LEAVE_CONFIRM_MS: val, STATE_SALT: 's' }), encoding: 'utf8' });
    return Number(r.stdout);
  };
  T('[3] LEAVE_CONFIRM_MS=60000 -> the 45 min floor; 5400000 -> 90 min', read('60000') === v.LEAVE_CONFIRM_MIN_MS && read('5400000') === 90 * MIN);
}

// ---- [4] [5] [6] the made-up result from inside the match ----
for (const [tag, build, lane] of [['[4] N1 4-player ranked FFA', N1, 'points'], ['[5] N2 2V2 ranked', N2, 'points'], ['[6] 4-player quick FFA', QK, 'exit']]) {
  const c = build(), rs = timeline(c.steps), every = c.honest.concat(c.writers);
  T(tag + ': eight runs exit 0', allOk(rs, 8), last(rs).out.slice(-800));
  T(tag + ': past the start floor and the absence grace the key waits for seats 0 / 1 (their starts, no result yet)',
    [rs[2], rs[3]].some(r => /leave-wait [^\n]*seats 0,1 /.test(r.out)) && !rs.slice(0, 4).some(r => processedOf(r).has(c.key)), rs[3].out.slice(-600));
  T(tag + ': the run summary counts it', [rs[2], rs[3]].some(r => Number((SUMMARY_ROW.exec(r.summary) || [])[1]) > 0), (rs[3].summary.match(/[^\n]*\(Q121\)[^\n]*/) || [''])[0]);
  T(tag + ': nobody is ever convicted, nobody rated (the writers gain nothing)', neverLeft(rs, every) && every.every(s => none(rs, s)),
    JSON.stringify(every.map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])));
  T(tag + ': the real result disagrees with the made-up one -> the start verdict closes the key at maturity, everyone exempt',
    processedOf(last(rs)).has(c.key) && c.honest.every(s => xpPosts(rs, s).length === 1), JSON.stringify(c.honest.map(s => xpPosts(rs, s).length)) + ' ' + last(rs).out.slice(-400));
}

// ---- [7] bot match, two humans ----
{
  const c = BOT(), rs = timeline(c.steps);
  T('[7] bot match: eight runs exit 0', allOk(rs, 8), last(rs).out.slice(-800));
  T('[7] bot match: the lone early record waits for the other human (his start, no result yet)', [rs[2], rs[3]].some(r => /leave-wait [^\n]*seat 0 /.test(r.out)), rs[3].out.slice(-600));
  T('[7] bot match: the early writer gets no XP; the two records disagree, neither human does (the same as any voided match)',
    xpPosts(rs, c.writers[0]).length === 0 && xpPosts(rs, c.honest[0]).length === 0 && neverLeft(rs, c.honest.concat(c.writers)),
    JSON.stringify(c.honest.concat(c.writers).map(s => xpPosts(rs, s).length)));
}

// ---- [8] an honest quitter: convicted once his match must be over ----
{
  const c = QUIT(), rs = timeline(c.steps), [p0, p1, p2] = c.P;
  T('[8] quitter: five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[8] quitter: past the absence grace the key waits, 24 min after his start about 36 min are left', LEAVE_WAIT.test(rs[2].out) && LEAVE_WAIT.test(rs[3].out)
    && !processedOf(rs[3]).has(c.key) && Math.abs(waitSecs(rs[3]) - 36 * 60) <= 60 && leavesOf(rs[3], p2) === 0, rs[3].out.slice(-500));
  T('[8] quitter: once his match must be over the key settles, he is convicted once (-100, an exit), the others rated',
    processedOf(rs[4]).has(c.key) && leavesOf(rs[4], p2) === 1 && down(rs, p2) && up(rs, p0) && leavesOf(rs[4], p0) + leavesOf(rs[4], p1) === 0,
    JSON.stringify(c.P.map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])) + ' ' + rs[4].out.slice(-400));
}

// ---- [9] a quitter who confessed: no extra wait ----
{
  const c = CONF(), rs = timeline(c.steps), [p0, p1, p2] = c.P;
  T('[9] confessed: four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T('[9] confessed: no leave wait; the key settles right after the absence grace, his exit counted once',
    !LEAVE_WAIT.test(outOf(rs)) && processedOf(rs[2]).has(c.key) && leavesOf(last(rs), p2) === 1 && down(rs, p2) && up(rs, p0) && leavesOf(last(rs), p1) === 0,
    JSON.stringify(c.P.map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])) + ' ' + rs[2].out.slice(-400));
}

// ---- [10] the wait runs from the job's first read of the other players' starts ----
{
  const c = EARLY(), rs = timeline(c.steps), every = c.honest.concat(c.writers);
  T('[10] early host start: nine runs exit 0', allOk(rs, 9), last(rs).out.slice(-800));
  const seen = (pendOf(rs[1], c.key) || {}).startSeen || {};
  T('[10] early host start: the roster registers from the two early starts; the others\' are stamped about 45 min after t0, the early two none',
    !!pendOf(rs[0], c.key) && c.honest.every(s => Math.abs((seen[v.pid(s)] | 0) - 45 * MIN) < MIN) && c.writers.every(s => !seen[v.pid(s)]), JSON.stringify(seen));
  T('[10] early host start: 61 min after the host\'s start (past t0 + the wait) the key still waits for seats 1 / 2',
    /leave-wait [^\n]*seats 1,2 /.test(rs[5].out) && !processedOf(rs[5]).has(c.key), rs[5].out.slice(-500));
  T('[10] early host start: the real result lands 66 min in and disagrees; nobody convicted or rated',
    neverLeft(rs, every) && every.every(s => none(rs, s)) && processedOf(last(rs)).has(c.key), JSON.stringify(every.map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])));
}

// ---- [10b] [10c] the made-up result blanks the seats still playing, or names alts there ----
for (const [tag, build] of [['[10b] A2 ranked FFA, seats 0 / 1 blanked', BLANK_FFA], ['[10b] A3 2V2 ranked, the winners blanked', BLANK_2V2],
  ['[10b] A4 quick FFA, seats 0 / 1 blanked', BLANK_QK], ['[10b] A5 bot match, the other human blanked', BLANK_BOT],
  ['[10b] A6 friend room, seat 0 blanked', BLANK_FRIEND], ['[10c] A7 ranked FFA, two alts in seats 0 / 1', ALTS],
  ['[10c] A9 ranked FFA, one writer blanks seats 0 / 1', ONE_BLANKS]]) {
  const c = build(), rs = timeline(c.steps), every = c.honest.concat(c.writers);
  T(tag + ': eight runs exit 0', allOk(rs, 8), last(rs).out.slice(-800));
  T(tag + ': past the start floor the key waits for seat' + (c.seats.length > 1 ? 's ' : ' ') + c.seats + ' (on the start roster, their starts, no result yet)',
    [rs[2], rs[3]].some(r => new RegExp('leave-wait [^\\n]*seats? ' + c.seats + ' ').test(r.out)) && !rs.slice(0, 4).some(r => processedOf(r).has(c.key)), rs[3].out.slice(-600));
  T(tag + ': nobody convicted; the framers gain nothing, the players at the table lose nothing',
    neverLeft(rs, every) && every.every(s => none(rs, s)) && !framersGained(c, rs) && c.writers.every(s => c.lane === 'points' || xpPosts(rs, s).length <= 1),
    JSON.stringify(every.map(s => [ptsIn(rs, s), xpPosts(rs, s).length, leavesOf(last(rs), s)])));
}

// ---- [10d] controls ----
{
  const ro = { 0: v.pid(HNP[0]), 1: v.pid(HNP[1]), 2: v.pid(HNP[2]), 3: v.pid(HNP[3]) };
  const g = (seats) => seats.map(s => ({ steamID: HNP[s] }));
  const gaps = (x) => x.map(o => o.seat + ':' + (o.pid === ro[o.seat] ? 'ok' : o.pid)).join();
  T('[10d] startRosterGaps: no registered roster -> nothing', v.startRosterGaps(null, g([2, 3]), [], []).length === 0);
  T('[10d] startRosterGaps: every roster seat wrote a record in the group -> nothing', v.startRosterGaps(ro, g([0, 1, 2, 3]), [], []).length === 0);
  T('[10d] startRosterGaps: the seats with no record in the group, by their start roster pid', gaps(v.startRosterGaps(ro, g([2, 3]), [], [])) === '0:ok,1:ok',
    JSON.stringify(v.startRosterGaps(ro, g([2, 3]), [], [])));
  T('[10d] startRosterGaps: a seat already among the result roster\'s absent seats, or seen agreeing, is not added twice',
    gaps(v.startRosterGaps(ro, g([2, 3]), [{ seat: 0, steamID: HNP[0] }], [v.pid(HNP[1])])) === '', JSON.stringify(v.startRosterGaps(ro, g([2, 3]), [{ seat: 0, steamID: HNP[0] }], [v.pid(HNP[1])])));
  const c = HONEST(), rs = timeline(c.steps);
  T('[10d] honest 4-player ranked FFA, everybody writes the real result: four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T('[10d] honest: no leave wait, settled past the start floor, the winner rated up and nobody convicted',
    !LEAVE_WAIT.test(outOf(rs)) && processedOf(rs[1]).has(c.key) && up(rs, c.P[0]) && neverLeft(rs, c.P), JSON.stringify(c.P.map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])) + ' ' + rs[1].out.slice(-400));
}

// ---- [11] wiring pins ----
{
  const iAbs = SRC.indexOf('    if (absHold.hold) {'), iLc = SRC.indexOf('    const lcHold = leaveConfirmHold(lcAbsent, pend, nowMs, LEAVE_CONFIRM_MS, (h) => resultBy.has(h), ');
  const iPace = SRC.indexOf('if (!isPrivateMt(matchType) && !isBotMt(matchType) && writerPaced(c.m, writerSids, pend.t0, SANITY.MIN_START_AGE_MS)) continue;');
  const iEnd = SRC.indexOf("console.log('  endless settle ' + c.m");
  T('[11] the hold sits after the endless lane and the absence grace, before the one-match-at-a-time claim and every other lane',
    iEnd > 0 && iAbs > iEnd && iLc > iAbs && iPace > iLc && SRC.split('    if (lcHold.hold) {').length === 2, [iEnd, iAbs, iLc, iPace].join(' '));
  T('[11] the held seats: the result roster\'s absent seats plus the start roster gaps of this group',
    SRC.split('    const lcAbsent = absentNow.concat(startRosterGaps(seatGateRoster(pend), g, absentNow, agreed));\n    const lcHold = leaveConfirmHold(lcAbsent, ').length === 2
    && /const h = x\.pid \|\| pid\(String\(x\.steamID\)\);/.test(SRC));
  T('[11] the settle loop reads this run\'s starts and results for the key before judging',
    /noteOwnStarts\(pend, starts\.filter\(\(r\) => \(r\.d\[3\] \+ '_' \+ r\.d\[4\] \+ '_' \+ r\.d\[2\]\) === c\.m\), nowMs\);\n    const resultBy = new Set\(pend\.settled \|\| \[\]\);/.test(SRC));
  T('[11] confessions read this run and those already counted both release the wait', /\(h\) => confSeen\.has\(h \+ '\|' \+ c\.m\) \|\| !!confState\[h \+ '\|' \+ c\.m\]\);/.test(SRC));
  T('[11] every start sighting is stamped (start verdict, settle loop, leaver filter)', /noteOwnStarts\(p, sg\[m\], now\);/.test(SRC)
    && (SRC.match(/noteOwnStarts\(pend, starts\.filter\([^\n]*, nowMs\);/g) || []).length === 2);
  T('[11] the wait: 60 min default, 45 min floor, from the environment', /const LEAVE_CONFIRM_MIN_MS = 2700000;\nconst LEAVE_CONFIRM_MS = Math\.max\(LEAVE_CONFIRM_MIN_MS, Number\(process\.env\.LEAVE_CONFIRM_MS \|\| 3600000\)\);/.test(SRC));
  T('[11] run summary row + exports', /s\('leaveWait', 0\)/.test(SRC) && typeof v.leaveConfirmHold === 'function' && typeof v.noteOwnStarts === 'function'
    && typeof v.startRosterGaps === 'function');
}

// ---- [12] mutation self-checks ----
{
  const mutants = [
    ['hold removed', '    if (lcHold.hold) {', '    if (false && lcHold.hold) {', (script) => {
      const a = N1(), ra = timeline(a.steps, script);   // [4] before the fix: the two at the table convicted, the writers rated up
      const b = N2(), rb = timeline(b.steps, script);
      const q = QK(), rq = timeline(q.steps, script);
      const t = BOT(), rt = timeline(t.steps, script);  // [7] before the fix: the early writer's lone record takes the XP
      return a.honest.every(s => leavesOf(last(ra), s) === 1 && down(ra, s)) && up(ra, a.writers[0])   // the made-up winner rated up
        && b.honest.every(s => leavesOf(last(rb), s) === 1) && b.writers.every(s => up(rb, s))
        && q.honest.every(s => leavesOf(last(rq), s) === 1)
        && xpPosts(rt, t.writers[0]).length === 1 && xpPosts(rt, t.honest[0]).length === 0;
    }],
    ['measured from t0', '    let at = (Number(pend.t0) || 0) + (Number(seen[h]) > 0 ? Number(seen[h]) : 0);', '    let at = (Number(pend.t0) || 0);', (script) => {
      const c = EARLY(), rs = timeline(c.steps, script);   // [10] the hold ends 60 min after the host's start: the two at the table convicted
      return c.honest.every(s => leavesOf(last(rs), s) === 1);
    }],
    ['start sightings not stamped', '(p.startSeen || (p.startSeen = {}))[h] = dt;', 'void dt;', (script) => {
      const c = EARLY(), rs = timeline(c.steps, script);
      return c.honest.every(s => leavesOf(last(rs), s) === 1);
    }],
    ['start roster gaps ignored (only the result roster\'s absent seats)', '    const lcAbsent = absentNow.concat(startRosterGaps(seatGateRoster(pend), g, absentNow, agreed));',
      '    const lcAbsent = absentNow;', (script) => {   // [10b] [10c] before the review fix: settled at once, the framers gain
        return [BLANK_FFA, BLANK_QK, BLANK_BOT, BLANK_FRIEND, ALTS, ONE_BLANKS].every(b => { const c = b(); return framersGained(c, timeline(c.steps, script)); });
      }],
    ['start roster pid ignored', '    const h = x.pid || pid(String(x.steamID));', '    const h = pid(String(x.steamID));', (script) => {
      return [BLANK_FFA, ALTS].every(b => { const c = b(); return framersGained(c, timeline(c.steps, script)); });
    }],
    ['confession ignored', '    if ((ownResult && ownResult(h)) || (confessed && confessed(h))) continue;', '    if (ownResult && ownResult(h)) continue;', (script) => {
      const c = CONF(), rs = timeline(c.steps, script);    // [9] the confessor's key waits the full hour
      return LEAVE_WAIT.test(outOf(rs)) && !processedOf(rs[2]).has(c.key);
    }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[12] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-leave-confirm-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[12] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (leave-confirm) ===' : '=== PASS -- 0 fail (leave-confirm) ===');
process.exit(failN ? 1 : 0);
