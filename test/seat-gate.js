'use strict';
// Q80 (cloud audit 2026-10): once a match key's start roster is registered, a record counts only when that roster seats
// its writer at the seat the record is written from. The match key is in every public start record, so any account could
// write a settle record for a match that is still being played: two outside accounts wrote a matching pair naming
// themselves the winners before the real result was in, the job settled it after the 5-minute pacing and the absence
// grace, the real players who had not written their result yet were convicted as leavers (-100 points, an exit), and the
// real result arrived to a processed key (review-q69.js R1 / R1b / R2 / R3). Registration counts one vote per seat: a
// start seat claimed by two or more accounts gives none of them a vote, so outside starts can take votes away but never
// outvote the players.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/roster-contest.js), plus the pure helpers.
//   [1] units: registerStartRosters (dispute rule, endless keeps the plain count, a split roster is marked, every start
//       record must name the same seats out of the same seat count and the voters left the same accounts),
//       seatGateRoster, seatedOnRoster, applySeatGate
//   [2] R1: two outside accounts write a fake result a minute after the real starts; dropped, flagged once, the real
//       players are not convicted while they play, the real result settles twelve minutes in, nobody convicted at maturity
//   [3] R1b: the outside accounts also copy the key into start records of their own after the first look: dropped, not
//       in the started list; R1c: before the first look: seats 2 / 3 disputed, the roster still registers from the
//       other two players, the real result settles
//   [4] five outside accounts start at the winners' seats before the first look and write the winning result for two of
//       them (no dispute rule: they outvote the players 5 to 4 and take the win): the players' roster registers, the
//       real result settles, the outside accounts gain nothing
//   [5] R2: nobody writes a result, two outside accounts write a fake one twenty minutes in: dropped; at maturity the
//       four players each get the exit their own starts earn, no -100
//   [6] part 6 of review4-q43.js with starts (two losers move onto the winners' seats, one outside account): the three
//       forged records are dropped, the winners win, the two forgers are leavers (their own starts), the outsider flagged
//   [7] a real quitter shielded by an outside account at his empty seat, with starts: the quitter is convicted
//   [8] P2 of review-q69.js: sixteen outside accounts copy the quitter's start before the first look to crowd him out of
//       the started list: their starts are dropped, the quitter is still convicted
//   [9] a player who doctors his own roster on a registered key: the key settles by the per-seat majority as before
//       (holding it would let him void his match)
//   [10] pinned residual: a 1V1 where a second account starts at the opponent's seat before the first look: no roster
//        can register, the key is held (nobody rated, nobody convicted) -- the same as the loser not writing his records
//   [11] wiring pins + mutation self-checks (gate removed / dispute rule removed / registered keys contested again /
//        start records not gated)
//   [12] with the team-gamble accusation pass (Q43) in the tree: five outside accounts no longer charge an honest host
//        (review4-q43.js part 3, real starts registered); mutant (gate removed -> judged again). Skipped without Q43.
//   [13] two colluding losers name other accounts at the winners' seats in their starts (a 2-2 split there): the roster is
//        marked split, gates nothing, the Q75 contest holds the key (the gate would have dropped the winners' records);
//        mutant (a split roster gates -> the losers take the win)
//   [14] a colluding majority of voters (an opponent dropped before level 1, an outside account starting from his seat)
//        seats an alt where an honest player started: split too, held; same mutant
//   [15] review-q80.js T1 / T2: before the first look, outside accounts vote from seat numbers past the players' seat
//        count (five in a 2V2: two at the winners' seats, three at seats 4..6 of a seven-seat roster; three in a 1V1),
//        then copy the real result at the winners' seats: the roster is split (the start records disagree on the seat
//        count and the voters left on the roster), the Q75 contest holds the key, the outside accounts gain nothing,
//        nobody is convicted; mutant (the agreement check removed -> the outside pair takes the win)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-gate-'));
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

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const H = SID(1), V = SID(2), X = SID(3), Y = SID(4), O = SID(9), O2 = SID(10), O3 = SID(11), O4 = SID(12), O5 = SID(13);
const A = SID(21), B = SID(22), C = SID(23);
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat, '0' = the seat left empty (bot / missing id)
const SC = { 3: [9000, 6000, 3000], 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : SC[pc][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 2V2 ranked (mt 6): the {0,1} v {2,3} convention, ranks by score inside each team; `winTeam` 0 = seats 0/1 won
const t2rank = (seat, winTeam) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === winTeam ? 1 : 3) + inTeam; };
const t2settle = (hash, seat, ros, winTeam) => rec(0xB1, 6, hash, seat, t2rank(seat, winTeam || 0), ((seat >> 1) & 1) === (winTeam || 0), ros);
const t2start = (hash, seat, ros) => rec(0xB2, 6, hash, seat, 0, false, ros);
// 3P ranked (mt 2): ranks by score = by seat
const ffaSettle = (hash, seat, ros) => rec(0xB1, 2, hash, seat, 1 + seat, seat === 0, ros);
const ffaStart = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const P1 = SID(41), P2 = SID(42), P3 = SID(43), P4 = SID(44), X1 = SID(45), Y1 = SID(46);
const Q = Array.from({ length: 16 }, (_, i) => SID(51 + i));   // outside accounts
const ALL = [H, V, X, Y, O, O2, O3, O4, O5, A, B, C, P1, P2, P3, P4, X1, Y1].concat(Q);
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const FLOOR = v.SANITY.MIN_START_AGE_MS, MATURE = v.STARTS_MATURITY_MS + 60000;
// run 1 (first sighting, deferred by the start floor), run 2 one floor later
function twoRuns(recs1, recs2, script) {
  const r1 = runCron(boardsWith(recs1), null, null, script);
  const r2 = runCron(boardsWith(recs2 || recs1), advance(r1.state, FLOOR + 1000), null, script);
  return { r1, r2 };
}
const Q75 = /roster contest, not settled \(Q75\)/;

// the 2V2 used by [2]..[6] and [8]: [H, V, X, Y], H and V won
const ROS = [H, V, X, Y], DOC = [X, Y, H, V];
const honest4 = (h) => [0, 1, 2, 3].map(s => ({ sid: ROS[s], d: t2settle(h, s, ROS, 0) }));
const starts4 = (h) => [0, 1, 2, 3].map(s => ({ sid: ROS[s], d: t2start(h, s, ROS) }));
// review4-q43.js part 6: X and Y move themselves onto the winning seats, O sits at seat 2 naming himself
const part6 = (h) => [{ sid: H, d: t2settle(h, 0, ROS, 0) }, { sid: V, d: t2settle(h, 1, ROS, 0) },
  { sid: X, d: t2settle(h, 0, DOC, 0) }, { sid: Y, d: t2settle(h, 1, DOC, 0) }, { sid: O, d: t2settle(h, 2, [X, Y, O, V], 0) }];

const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + 60000;
SC[2] = [7000, 4000];   // 1V1 scores (rec() picks the row by player count)
const Q80LINE = /record\(s\) from accounts the start roster does not seat there -- not counted \(Q80\)/;
const Q80ROW = (r, off, dis, split) => new RegExp('\\| records off their start-roster seat, not counted / start keys with a seat claimed twice / start rosters the voters split, no seat gate \\(Q80\\) \\| ' + off + ' / ' + dis + ' / ' + (split | 0) + ' \\|').test(r.summary);
const rowOf = (r) => (r.summary.match(/[^\n]*\(Q80\)[^\n]*/) || [''])[0];
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
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
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const up = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] > 2500; };
const down = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] < 2500; };
const none = (rs, sid) => ptsIn(rs, sid).length === 0;

// the 2V2 of R1 / R2: P1 / P2 (seats 0 / 1) beat P3 / P4; X1 / Y1 are outside accounts holding the public key
const RR = [P1, P2, P3, P4], FAKE = [P1, P2, X1, Y1];
const realStarts = (h) => [0, 1, 2, 3].map(s => ({ sid: RR[s], d: t2start(h, s, RR) }));
const realSettles = (h) => [0, 1, 2, 3].map(s => ({ sid: RR[s], d: t2settle(h, s, RR, 0) }));
const fakeSettles = (h) => [{ sid: X1, d: t2settle(h, 2, FAKE, 1) }, { sid: Y1, d: t2settle(h, 3, FAKE, 1) }];   // "seats 2 / 3 (us) won"
const fakeStarts = (h) => [{ sid: X1, d: t2start(h, 2, FAKE) }, { sid: Y1, d: t2start(h, 3, FAKE) }];
// R1: the real starts, a fake result one minute in, the real result twelve minutes in, maturity
const r1Steps = (h, extra1) => {
  const S = realStarts(h), F = fakeSettles(h).concat(extra1 || []), R = realSettles(h);
  return [[0, S], [1 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [5 * MIN, S.concat(F)], [1 * MIN, S.concat(F, R)], [3 * HOUR, S.concat(F, R)]];
};
// [4]: five outside accounts start at the winners' seats before the first look; two of them write the winning result
const SW = [Q[0], Q[1], P3, P4];
const swingStarts = (h) => [0, 1, 0, 1, 0].map((s, i) => ({ sid: Q[i], d: t2start(h, s, SW) }));
const swingSettles = (h) => [{ sid: Q[0], d: t2settle(h, 0, SW, 0) }, { sid: Q[1], d: t2settle(h, 1, SW, 0) }];
const swingSteps = (h) => {
  const S = realStarts(h).concat(swingStarts(h));
  return [[0, S], [6 * MIN, S.concat(swingSettles(h), realSettles(h))]];
};
// [8]: P4 quits after his start; sixteen outside accounts copy the key into starts at his seat, ahead of his own row
const p2Steps = (h) => {
  const S = realStarts(h).slice(0, 3).concat(Q.slice(0, 16).map(sid => ({ sid, d: t2start(h, 3, RR) })), realStarts(h).slice(3));
  const R = realSettles(h).slice(0, 3);
  return [[0, S], [6 * MIN, S.concat(R)], [GRACE, S.concat(R)]];
};
// [9]: the loser P3 doctors his own roster (an outside account at seat 3); everyone else honest
const doctorSteps = (h) => {
  const R = realSettles(h); R[2] = { sid: P3, d: t2settle(h, 2, [P1, P2, P3, Q[0]], 0) };
  const S = realStarts(h).concat(R);
  return [[0, S], [FLOOR + 1000, S]];
};

console.log('=== a record counts only from the seat its start roster gives its writer (Q80) ===');

// ---- [1] units ----
{
  const eq = (label, got, exp) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'expect ' + JSON.stringify(exp));
  const S = (sid, seat, ros, mt) => ({ steamID: sid, d: [0xB2, 3, mt || 6, 77, 1, seat], roster: Object.assign({}, ros) });
  const RO = { 0: P1, 1: P2, 2: P3, 3: P4 }, PR = { 0: v.pid(P1), 1: v.pid(P2), 2: v.pid(P3), 3: v.pid(P4) };
  const honest = [0, 1, 2, 3].map(s => S(RR[s], s, RO));
  let pend = {};
  T('[1] four honest starts register the roster', v.registerStartRosters(honest, new Set(), pend, 5) === 1 && JSON.stringify(pend['77_1_6'].roster) === JSON.stringify(PR) && pend['77_1_6'].t0 === 5, JSON.stringify(pend));
  pend = {};
  const one = honest.concat([S(Q[0], 2, { 0: P1, 1: P2, 2: Q[0], 3: P4 })]);
  T('[1] an outside start at seat 2: both claimants lose their vote, the other three still register the players\' roster',
    v.registerStartRosters(one, new Set(), pend, 5) === 1 && JSON.stringify(pend['77_1_6'].roster) === JSON.stringify(PR), JSON.stringify(pend));
  pend = {};
  const many = honest.concat([0, 1, 0, 1, 0].map((s, i) => S(Q[i], s, { 0: Q[0], 1: Q[1], 2: P3, 3: P4 })));
  T('[1] five outside starts at seats 0 / 1 (5 to 4 by plain count): the players\' roster', v.registerStartRosters(many, new Set(), pend, 5) === 1 && JSON.stringify(pend['77_1_6'].roster) === JSON.stringify(PR), JSON.stringify(pend));
  pend = {};
  T('[1] every seat claimed twice: nothing registers', v.registerStartRosters(honest.concat([0, 1, 2, 3].map(s => S(Q[s], s, { 0: Q[0], 1: Q[1], 2: Q[2], 3: Q[3] }))), new Set(), pend, 5) === 0 && !pend['77_1_6']);
  pend = {};
  T('[1] a 1V1 with a second account at seat 1: one vote left, nothing registers', v.registerStartRosters([S(P1, 0, { 0: P1, 1: P2 }, 2), S(P2, 1, { 0: P1, 1: P2 }, 2), S(Q[0], 1, { 0: P1, 1: Q[0] }, 2)], new Set(), pend, 5) === 0 && Object.keys(pend).length === 0);
  pend = {};
  T('[1] a cold-reconnect duplicate is one claimant, not a dispute', v.registerStartRosters(honest.concat([S(P3, 2, RO)]), new Set(), pend, 5) === 1 && JSON.stringify(pend['77_1_6'].roster) === JSON.stringify(PR));
  pend = {};
  const en = [S(P1, 0, { 0: P1, 1: P2 }, 7), S(P2, 1, { 0: P1, 1: P2 }, 7), S(Q[0], 0, { 0: P1, 1: P2 }, 7)];
  T('[1] endless keys keep the plain count (cloud audit Q78)', v.registerStartRosters(en, new Set(), pend, 5) === 1 && !!pend['77_1_7']);
  pend = { '77_1_6': { t0: 1, mt: 6, roster: {}, settled: [], synth: true } };
  T('[1] a key already pending or processed is left alone', v.registerStartRosters(honest, new Set(), pend, 5) === 0 && pend['77_1_6'].synth === true
    && v.registerStartRosters(honest, new Set(['77_1_6']), {}, 5) === 0);
  // a split roster: registered as before, marked
  pend = {};
  T('[1] honest starts: the roster is not split', v.registerStartRosters(honest, new Set(), pend, 5) === 1 && !('split' in pend['77_1_6']), JSON.stringify(pend));
  const SPL = { 0: Q[0], 1: Q[1], 2: P3, 3: P4 };
  pend = {};
  T('[1] two voters name other accounts at seats 0 / 1 (2 to 2): registered split, seats 0 / 1 empty',
    v.registerStartRosters([S(P1, 0, RO), S(P2, 1, RO), S(P3, 2, SPL), S(P4, 3, SPL)], new Set(), pend, 5) === 1 && pend['77_1_6'].split === 1
    && !pend['77_1_6'].roster[0] && !pend['77_1_6'].roster[1] && pend['77_1_6'].roster[2] === v.pid(P3), JSON.stringify(pend));
  pend = {};
  T('[1] three voters seat an alt where the fourth started: registered split',
    v.registerStartRosters([S(P1, 0, RO), S(X1, 1, { 0: Q[0], 1: X1, 2: P3, 3: P4 }), S(P3, 2, { 0: Q[0], 1: X1, 2: P3, 3: P4 }), S(P4, 3, { 0: Q[0], 1: X1, 2: P3, 3: P4 })], new Set(), pend, 5) === 1
    && pend['77_1_6'].split === 1 && pend['77_1_6'].roster[0] === v.pid(Q[0]), JSON.stringify(pend));
  pend = {};
  T('[1] one voter names a seat nobody else names: split (his roster is not the others\' -- Q80 review)',
    v.registerStartRosters(honest.slice(0, 3).concat([S(P4, 3, { 0: P1, 1: P2, 2: P3, 3: P4, 4: Q[0] })]), new Set(), pend, 5) === 1 && pend['77_1_6'].split === 1, JSON.stringify(pend));
  // Q80 review (review-q80.js T1 / T2): the start records must agree on the seat count and the seats, the voters left on
  //   the accounts; S8 carries the seat count (d[8])
  const S8 = (sid, seat, ros, pc, mt) => ({ steamID: sid, d: [0xB2, 3, mt || 6, 77, 1, seat, 0, 0, pc], roster: Object.assign({}, ros) });
  const h8 = [0, 1, 2, 3].map(s => S8(RR[s], s, RO, 4));
  const R7 = { 0: Q[0], 1: Q[1], 2: P3, 3: P4, 4: Q[2], 5: Q[3], 6: Q[4] };
  pend = {};
  T('[1] honest starts with their seat count, plus a cold-reconnect copy: not split', v.registerStartRosters(h8.concat([S8(P2, 1, RO, 4)]), new Set(), pend, 5) === 1 && !('split' in pend['77_1_6']), JSON.stringify(pend));
  pend = {};
  T('[1] T1: five outside starts, two at the winners\' seats and three from seats 4..6 of a seven-seat roster: registered split',
    v.registerStartRosters(h8.concat([S8(Q[0], 0, R7, 7), S8(Q[1], 1, R7, 7), S8(Q[2], 4, R7, 7), S8(Q[3], 5, R7, 7), S8(Q[4], 6, R7, 7)]), new Set(), pend, 5) === 1
    && pend['77_1_6'].split === 1, JSON.stringify(pend));
  pend = {};
  T('[1] the same with the players\' seat count written (seats 4..6 past it): split', v.registerStartRosters(h8.concat([S8(Q[0], 0, R7, 4), S8(Q[1], 1, R7, 4), S8(Q[2], 4, R7, 4),
    S8(Q[3], 5, R7, 4), S8(Q[4], 6, R7, 4)]), new Set(), pend, 5) === 1 && pend['77_1_6'].split === 1, JSON.stringify(pend));
  pend = {};
  const R1V = { 0: Q[0], 1: P2, 2: Q[1], 3: Q[2] };
  T('[1] T2: a 1V1, one outside start at seat 0 and two from seats 2 / 3: registered split', v.registerStartRosters([S8(P1, 0, { 0: P1, 1: P2 }, 2, 2), S8(P2, 1, { 0: P1, 1: P2 }, 2, 2),
    S8(Q[0], 0, R1V, 4, 2), S8(Q[1], 2, R1V, 4, 2), S8(Q[2], 3, R1V, 4, 2)], new Set(), pend, 5) === 1 && pend['77_1_2'].split === 1, JSON.stringify(pend));
  pend = {};
  T('[1] a disputed claimant\'s start with another seat count: split (every start counts here, not only the voters)',
    v.registerStartRosters(h8.concat([S8(Q[0], 2, RO, 5)]), new Set(), pend, 5) === 1 && pend['77_1_6'].split === 1, JSON.stringify(pend));
  pend = {};
  T('[1] an outside start past the seat count naming the players\' roster word for word: split (he is not on it)',
    v.registerStartRosters(h8.concat([S8(Q[0], 4, RO, 4)]), new Set(), pend, 5) === 1 && pend['77_1_6'].split === 1, JSON.stringify(pend));
  pend = {};
  T('[1] three copies of the players\' start at a disputed seat (review-q69.js P2): the players\' roster, not split',
    v.registerStartRosters(h8.concat([S8(Q[0], 3, RO, 4), S8(Q[1], 3, RO, 4), S8(Q[2], 3, RO, 4)]), new Set(), pend, 5) === 1 && !('split' in pend['77_1_6'])
    && JSON.stringify(pend['77_1_6'].roster) === JSON.stringify(PR), JSON.stringify(pend));
  T('[1] rosterCanon: seat order; startRosterDisagrees on its own', v.rosterCanon({ 1: P2, 0: P1 }) === v.rosterCanon({ 0: P1, 1: P2 })
    && v.rosterCanon({ 0: P1, 1: P2 }) !== v.rosterCanon({ 0: P2, 1: P1 }) && v.startRosterDisagrees(h8) === false
    && v.startRosterDisagrees(h8.concat([S8(Q[0], 4, R7, 7)])) === true && v.startRosterDisagrees(h8.concat([S8(Q[0], 4, R7, 4)])) === true
    && v.startRosterDisagrees(h8.concat([S8(Q[0], 0, R7, 4)])) === true && v.startRosterDisagrees(h8.concat([S8(Q[0], 3, RO, 4)])) === false);
  // REVIEW-2: a disputed claimant's start counts for the agreement too (his vote is gone, his roster is not)
  pend = {};
  T('[1] two outside starts at seats 0 / 1 naming a roster of their own: registered split (the players\' roster, no gate)',
    v.registerStartRosters(h8.concat([S8(Q[0], 0, { 0: Q[0], 1: Q[1], 2: P3, 3: P4 }, 4), S8(Q[1], 1, { 0: Q[0], 1: Q[1], 2: P3, 3: P4 }, 4)]), new Set(), pend, 5) === 1
    && pend['77_1_6'].split === 1 && pend['77_1_6'].roster[0] === v.pid(P1), JSON.stringify(pend));
  // seatGateRoster / seatedOnRoster
  const reg = { t0: 1, mt: 6, roster: PR, settled: [] };
  eq('[1] seatGateRoster: no entry / synthetic / empty roster / endless / split -> no gate', [v.seatGateRoster(undefined), v.seatGateRoster({ t0: 1, mt: 6, roster: {}, settled: [], synth: true }),
    v.seatGateRoster({ t0: 1, mt: 6, roster: {}, settled: [] }), v.seatGateRoster({ t0: 1, mt: 7, roster: PR, settled: [] }),
    v.seatGateRoster({ t0: 1, mt: 6, roster: PR, settled: [], split: 1 })], [null, null, null, null, null]);
  T('[1] seatGateRoster: a registered roster', v.seatGateRoster(reg) === PR);
  const R = (sid, seat) => ({ steamID: sid, d: [0xB1, 3, 6, 77, 1, seat] });
  eq('[1] seatedOnRoster: his seat / another account\'s seat / a seat the roster leaves empty / no gate',
    [v.seatedOnRoster(reg, R(P3, 2)), v.seatedOnRoster(reg, R(X1, 2)), v.seatedOnRoster({ t0: 1, mt: 6, roster: { 0: PR[0], 1: PR[1] }, settled: [] }, R(X1, 2)), v.seatedOnRoster(undefined, R(X1, 2))],
    [true, false, false, true]);
  // applySeatGate: in place, both lists, processed keys kept
  const K = (h, seat, sid, start) => ({ steamID: sid, shard: 3, start: !!start, d: [start ? 0xB2 : 0xB1, 3, 6, h, 1, seat] });
  const recs = [K(77, 0, P1), K(77, 2, X1), K(88, 2, X1), K(99, 3, Y1), K(77, 3, P4)], starts = [K(77, 2, P3, 1), K(77, 3, Y1, 1)];
  const pending = { '77_1_6': reg, '99_1_6': { t0: 1, mt: 6, roster: PR, settled: [] } };
  const g = v.applySeatGate(recs, starts, pending, new Set(['99_1_6']));
  eq('[1] applySeatGate: kept records', recs.map(r => r.d[3] + '@' + r.d[5]), ['77@0', '88@2', '99@3', '77@3']);
  eq('[1] applySeatGate: kept starts', starts.map(r => r.d[3] + '@' + r.d[5]), ['77@2']);
  T('[1] applySeatGate: dropped, by key', g.n === 2 && Array.from(g.out.keys()).join() === '77_1_6' && g.out.get('77_1_6').map(r => String(r.steamID)).join() === [X1, Y1].join());
}

// ---- [2] R1: an outside pair writes a fake result while the real match is played ----
{
  const h = 0x8001, key = keyOf(t2start(h, 0, RR));
  const rs = timeline(r1Steps(h));
  T('[2] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[2] run 1 registers the players\' roster', pendOf(rs[0], key) && pendOf(rs[0], key).roster[2] === v.pid(P3));
  T('[2] run 2 drops the two fake records (logged, summary row)', Q80LINE.test(rs[1].out) && Q80ROW(rs[1], 2, 0), rowOf(rs[1]));
  T('[2] while the match is played: nothing settles, nobody is convicted', !processedOf(rs[3]).has(key) && rs.slice(0, 4).every(r => anyPoints(r) === 0)
    && RR.every(s => leavesOf(rs[3], s) === 0), rs[3].out.slice(-600));
  T('[2] the real result settles twelve minutes in: P1 / P2 win, P3 / P4 lose', processedOf(rs[4]).has(key) && up(rs, P1) && up(rs, P2) && down(rs, P3) && down(rs, P4),
    JSON.stringify(RR.map(s => ptsIn(rs, s))));
  T('[2] the outside pair gains nothing', none(rs, X1) && none(rs, Y1));
  T('[2] at maturity nobody is convicted', RR.concat([X1, Y1]).every(s => leavesOf(rs[5], s) === 0));
  T('[2] the outside pair flagged once each over five sightings, the players not at all', fOf(rs[5], X1) === 1 && fOf(rs[5], Y1) === 1 && RR.every(s => fOf(rs[5], s) === 0),
    JSON.stringify(RR.concat([X1, Y1]).map(s => fOf(rs[5], s))));
}

// ---- [3] R1b / R1c: the outside pair also writes start records ----
{
  const h = 0x8002, key = keyOf(t2start(h, 0, RR));
  const rs = timeline(r1Steps(h, fakeStarts(h)));   // R1b: after the first look
  T('[3] R1b: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  const st = (pendOf(rs[1], key) || {}).started || [];
  T('[3] R1b: their starts are dropped too, not in the started list', Q80ROW(rs[1], 4, 0) && st.length === 4 && [X1, Y1].every(s => st.indexOf(v.pid(s)) < 0) && RR.every(s => st.indexOf(v.pid(s)) >= 0),
    rowOf(rs[1]) + ' started=' + JSON.stringify(st));
  T('[3] R1b: the real result settles, nobody convicted, the pair gains nothing', processedOf(rs[4]).has(key) && up(rs, P1) && up(rs, P2) && none(rs, X1) && none(rs, Y1)
    && RR.every(s => leavesOf(rs[5], s) === 0));
  const h2 = 0x8003, key2 = keyOf(t2start(h2, 0, RR));
  const S = realStarts(h2).concat(fakeStarts(h2)), F = fakeSettles(h2), R = realSettles(h2);
  // R1c: before the first look; the pair's rows rotate off in the last run
  const rc = timeline([[0, S], [6 * MIN, S.concat(F)], [6 * MIN, S.concat(F, R)], [6 * MIN, realStarts(h2).concat(R)]]);
  T('[3] R1c: four runs exit 0', allOk(rc, 4), last(rc).out.slice(-800));
  // REVIEW-2: their starts name another roster, so it registers split (no gate): the votes left are the players' here, but
  //   the job cannot tell them from colluders' (A1)
  T('[3] R1c: seats 2 / 3 disputed, the roster registers from P1 / P2, split', /start-dispute [^\n]*: seat\(s\) 2,3 claimed by two or more accounts/.test(rc[0].out)
    && pendOf(rc[0], key2) && pendOf(rc[0], key2).roster[2] === v.pid(P3) && pendOf(rc[0], key2).roster[3] === v.pid(P4) && pendOf(rc[0], key2).split === 1 && Q80ROW(rc[0], 0, 1, 1), rowOf(rc[0]));
  T('[3] R1c: nothing settles while the pair\'s rows are up (Q75 contest); the real result settles once they are gone', !processedOf(rc[1]).has(key2) && !processedOf(rc[2]).has(key2)
    && Q75.test(rc[2].out) && processedOf(rc[3]).has(key2) && up(rc, P1) && up(rc, P2) && none(rc, X1) && none(rc, Y1) && RR.every(s => leavesOf(rc[3], s) === 0), rc[3].out.slice(-600));
}

// ---- [4] five outside starts at the winners' seats before the first look ----
{
  const h = 0x8004, key = keyOf(t2start(h, 0, RR));
  const rs = timeline(swingSteps(h).concat([[6 * MIN, realStarts(h).concat(realSettles(h))]]));   // the outside rows rotate off in the last run
  T('[4] three runs exit 0', allOk(rs, 3), last(rs).out.slice(-800));
  T('[4] seats 0 / 1 disputed, the players\' roster registers from P3 / P4, split (REVIEW-2)', pendOf(rs[0], key) && pendOf(rs[0], key).roster[0] === v.pid(P1) && pendOf(rs[0], key).roster[1] === v.pid(P2)
    && pendOf(rs[0], key).split === 1 && Q80ROW(rs[0], 0, 1, 1), rowOf(rs[0]) + ' ' + JSON.stringify(pendOf(rs[0], key)));
  T('[4] held while the outside rows are up; then the real result settles, the outside accounts gain nothing', !processedOf(rs[1]).has(key) && Q75.test(rs[1].out)
    && processedOf(rs[2]).has(key) && up(rs, P1) && up(rs, P2) && none(rs, Q[0]) && none(rs, Q[1]),
    JSON.stringify([P1, P2, Q[0], Q[1]].map(s => ptsIn(rs, s))));
}

// ---- [5] R2: nobody writes a result, an outside pair writes a fake one twenty minutes in ----
{
  const h = 0x8005, key = keyOf(t2start(h, 0, RR));
  const S = realStarts(h), F = fakeSettles(h);
  const rs = timeline([[0, S], [20 * MIN, S], [1 * MIN, S.concat(F)], [6 * MIN, S.concat(F)], [6 * MIN, S.concat(F)], [3 * HOUR, S.concat(F)]]);
  T('[5] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[5] no points move for anybody (no -100)', rs.every(r => anyPoints(r) === 0), JSON.stringify(rs.map(r => posts(r, 7).length)));
  T('[5] at maturity each player gets the one exit his own start earns, the outside pair none', processedOf(rs[5]).has(key) && RR.every(s => leavesOf(rs[5], s) === 1)
    && [X1, Y1].every(s => leavesOf(rs[5], s) === 0), JSON.stringify(RR.concat([X1, Y1]).map(s => leavesOf(rs[5], s))) + ' ' + rs[5].out.slice(-400));
}

// ---- [6] review4-q43.js part 6 with starts ----
{
  const h = 0x8006, recs = part6(h).concat(starts4(h)), key = keyOf(recs[0].d);
  const rs = timeline([[0, recs], [FLOOR + 1000, recs], [GRACE, recs]]);
  T('[6] three runs exit 0', allOk(rs, 3), last(rs).out.slice(-800));
  T('[6] the three forged records are dropped, no contest', Q80ROW(rs[0], 3, 0) && !Q75.test(outOf(rs)), rowOf(rs[0]));
  T('[6] the key settles: H and V win, X and Y are leavers (their own starts), O gains nothing', processedOf(rs[2]).has(key) && up(rs, H) && up(rs, V)
    && down(rs, X) && down(rs, Y) && leavesOf(rs[2], X) === 1 && leavesOf(rs[2], Y) === 1 && leavesOf(rs[2], H) + leavesOf(rs[2], V) === 0 && none(rs, O),
    JSON.stringify([H, V, X, Y, O].map(s => ptsIn(rs, s))) + ' leaves ' + JSON.stringify([H, V, X, Y].map(s => leavesOf(rs[2], s))));
  T('[6] the three writers off their seats flagged once each', [X, Y, O].every(s => fOf(rs[2], s) === 1) && [H, V].every(s => fOf(rs[2], s) === 0),
    JSON.stringify([H, V, X, Y, O].map(s => fOf(rs[2], s))));
}

// ---- [7] a real quitter shielded by an outside account at his empty seat, with starts ----
{
  const h = 0x8007, ros = [A, B, C];
  const recs = [{ sid: A, d: ffaSettle(h, 0, ros) }, { sid: B, d: ffaSettle(h, 1, ros) },
    { sid: A, d: ffaStart(h, 0, ros) }, { sid: B, d: ffaStart(h, 1, ros) }, { sid: C, d: ffaStart(h, 2, ros) },
    { sid: O, d: ffaSettle(h, 2, [A, B, '0']) }];
  const key = keyOf(recs[0].d);
  const rs = timeline([[0, recs], [FLOOR + 1000, recs], [GRACE, recs]]);
  T('[7] three runs exit 0', allOk(rs, 3), last(rs).out.slice(-800));
  T('[7] O is dropped; the key settles with C a leaver on his own start', Q80ROW(rs[0], 1, 0) && processedOf(rs[2]).has(key) && leavesOf(rs[2], C) === 1
    && [A, B, O].every(s => leavesOf(rs[2], s) === 0) && none(rs, O) && up(rs, A), JSON.stringify([A, B, C, O].map(s => ptsIn(rs, s))) + ' C=' + leavesOf(rs[2], C));
}

// ---- [8] P2: sixteen outside starts at the quitter's seat ahead of his own ----
{
  const h = 0x8008, key = keyOf(t2start(h, 0, RR));
  const rs = timeline(p2Steps(h));
  T('[8] three runs exit 0', allOk(rs, 3), last(rs).out.slice(-800));
  const st = (pendOf(rs[0], key) || {}).started || [];
  T('[8] seat 3 disputed, the roster registers from the other three; the sixteen starts dropped', Q80ROW(rs[0], 16, 1) && pendOf(rs[0], key).roster[3] === v.pid(P4)
    && st.length === 4 && st.indexOf(v.pid(P4)) >= 0, rowOf(rs[0]) + ' started=' + st.length);
  T('[8] the quitter P4 is still convicted (-100, an exit)', processedOf(rs[2]).has(key) && leavesOf(rs[2], P4) === 1 && down(rs, P4) && Q.slice(0, 16).every(s => none(rs, s)),
    'P4 leaves ' + leavesOf(rs[2], P4) + ' ' + JSON.stringify(ptsIn(rs, P4)));
}

// ---- [9] a player doctors his own roster on a registered key ----
{
  const h = 0x8009, key = keyOf(t2start(h, 0, RR));
  const rs = timeline(doctorSteps(h));
  T('[9] two runs exit 0', allOk(rs, 2), last(rs).out.slice(-800));
  T('[9] no contest, no seat-gate drop: the key settles by the per-seat majority, P1 / P2 win', !Q75.test(outOf(rs)) && !Q80LINE.test(outOf(rs)) && processedOf(rs[1]).has(key)
    && up(rs, P1) && up(rs, P2) && none(rs, Q[0]), rs[1].out.slice(-600));
}

// ---- [10] pinned residual: a 1V1 with a second account at the opponent's seat before the first look ----
{
  const h = 0x800a, ros = [P1, P2];
  const recs = [{ sid: P1, d: ffaStart(h, 0, ros) }, { sid: P2, d: ffaStart(h, 1, ros) }, { sid: Q[0], d: ffaStart(h, 1, [P1, Q[0]]) },
    { sid: P1, d: ffaSettle(h, 0, ros) }, { sid: P2, d: ffaSettle(h, 1, ros) }];
  const key = keyOf(recs[0].d);
  const rs = timeline([[0, recs], [FLOOR + 1000, recs], [MATURE, recs]]);
  T('[10] three runs exit 0', allOk(rs, 3), last(rs).out.slice(-800));
  T('[10] no roster registers; the key is held by the Q75 contest: nobody rated, nobody convicted', !pendOf(rs[2], key) && Q75.test(rs[0].out) && !processedOf(rs[2]).has(key)
    && rs.every(r => anyPoints(r) === 0) && [P1, P2, Q[0]].every(s => leavesOf(rs[2], s) === 0), rs[2].out.slice(-600));
}

// ---- [11] wiring pins + mutation self-checks ----
{
  const iP = SRC.indexOf('  const processed = loadProcessed();\n  const processedN0 = processed.size;');
  const iR = SRC.indexOf('const registeredEarly = registerStartRosters(starts, processed, startsPending, Date.now());');
  const iG = SRC.indexOf('const seatGate = applySeatGate(recs, starts, startsPending, processed);');
  const iGr = SRC.indexOf('const gr = groupRecords(recs, { vecOf, MAX_SEATS });');
  T('[11] main: processed loaded, rosters registered, records gated -- in that order, before grouping', iP > 0 && iR > iP && iG > iR && iGr > iG);
  T('[11] the start cross-check is told registration already ran', /reconcileStarts\(starts, groups, consistentKeys, processed, startsPending, leavers, nowMs, STARTS_MATURITY_MS, confState, shardsComplete, registeredEarly\)/.test(SRC));
  T('[11] dropped writers flagged per key and handed to the trust tier', /for \(const \[m, rs\] of seatGate\.out\) \{ if \(recordFlag\(signals, rs, m \+ '\|seat', Date\.now\(\)\)\) sigDirty = true; for \(const r of rs\) trustTouched\.add\(String\(r\.steamID\)\); \}/.test(SRC));
  T('[11] run summary row', /s\('offSeat', 0\) \+ ' \/ ' \+ s\('disputed', 0\)/.test(SRC) && /RUN\.offSeat = seatGate\.n;/.test(SRC));
  T('[11] exports', ['registerStartRosters', 'seatGateRoster', 'seatedOnRoster', 'applySeatGate'].every(f => typeof v[f] === 'function'));
  const mutants = [
    ['seat gate removed', 'const seatGate = applySeatGate(recs, starts, startsPending, processed);', 'const seatGate = { out: new Map(), n: 0 };', (script) => {
        const rs = timeline(r1Steps(0x8011), script);   // [2] the outside pair's result settles first, P1 / P2 convicted
        return [P1, P2].every(s => leavesOf(last(rs), s) === 1);
      }],
    ['dispute rule removed', '    if (!isEndlessMt(sg[m][0].d[2] | 0)) {\n      const claim = {};', '    if (false) {\n      const claim = {};', (script) => {
        const rs = timeline(swingSteps(0x8014), script);   // [4] the outside roster registers: the real result no longer settles
        const key = keyOf(t2start(0x8014, 0, RR));          //   (held as a split roster, or the outside accounts take the win)
        return !(processedOf(last(rs)).has(key) && up(rs, P1) && up(rs, P2));
      }],
    ['registered keys held by the contest again', '    if (seatGateRoster(pending && pending[m])) continue;   // Q80: a registered start roster already decides who counts (applySeatGate)\n', '', (script) => {
        const rs = timeline(doctorSteps(0x8019), script);   // [9] the doctored roster voids the match
        return !processedOf(last(rs)).has(keyOf(t2start(0x8019, 0, RR)));
      }],
    ['start records not gated', '  for (const list of [recs, starts]) {', '  for (const list of [recs]) {', (script) => {
        const rs = timeline(p2Steps(0x8018), script);   // [8] the sixteen copies crowd P4 out of the started list
        return leavesOf(last(rs), P4) === 0;
      }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-seat-gate-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[11] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [12] with the team-gamble accusation pass (Q43) in the tree: outside accounts cannot charge a host ----
// review4-q43.js part 3: a real 2V2 [P, A, B, C], all four wrote their records and starts, the host P's team lost. Five
//   outside accounts write refusals onto the key: two sit on the winning seats and name the host, three only vote the
//   roster. Counted per account that is 5 to 4, so the roster used to move the outsiders onto the winning seats and charge
//   the host's costly refusal; two keys with disjoint namers judged him a leaver. With Q80 the players' start roster is
//   registered and the outside records do not seat their writers: dropped, no strike, no judgment.
if (typeof v.applyTeam2Accusations !== 'function') console.log('  skip  [12] no team-gamble accusation pass (Q43) in this tree');
else {
  const P = SID(31), TAG = v.T2BY_TAG;
  const reals = [[SID(32), SID(33), SID(34)], [SID(35), SID(36), SID(37)]];
  const outs = [O, O2, O3, O4, O5];
  const refuse = (h, seat, ros, named) => { const d = t2settle(h, seat, ros, 1); d[6] = 0; if (named) d.push(TAG | named); return d; };
  const key12 = (i, k) => {
    const [a, b, c] = reals[i], ros = [P, a, b, c], h = 0x8020 + i, recs = [];
    [P, a, b, c].forEach((sid, s) => recs.push({ sid, d: t2settle(h, s, ros, 1) }, { sid, d: t2start(h, s, ros) }));   // team 1 (b, c) won
    const acc = i === 0 ? [0, 1] : [2, 3];   // this key's two namers (disjoint across the keys)
    outs.slice(0, k).forEach((sid, j) => {
      const at = acc.indexOf(j), fake = [P, a, outs[acc[0]], outs[acc[1]]];
      recs.push({ sid, d: at >= 0 ? refuse(h, 2 + at, fake, 1) : refuse(h, 2, fake, 0) });
    });
    return { recs, key: keyOf(recs[0].d) };
  };
  const play12 = (k, script) => {
    let state = null, out = '';
    for (let i = 0; i < 2; i++) {
      const { recs } = key12(i, k);
      const all = [P].concat(reals[0], reals[1], outs);
      const boards = boardsWith(recs).map(b => b.name === 'points' ? Object.assign({}, b, { entries: all.map(s => ({ steamID: s, score: 2500 })) }) : b);
      for (const step of [0, FLOOR + 1000, GRACE]) {
        const r = runCron(boards, state ? advance(state, step) : null, null, script);
        if (r.code !== 0) return { bad: r.out.slice(-800) };
        state = r.state; out += r.out;
      }
      state = advance(state, 24 * HOUR);
    }
    const sg = state.SIGNALS_FILE || {}, av = Object.keys(sg.t2av || {}).filter(x => x.endsWith('|' + v.pid(P))).map(x => sg.t2av[x].v);
    return { state, out, av, leaves: (((state.LEAVERS_FILE || {})[v.pid(P)]) || {}).leaves | 0 };
  };
  const r5 = play12(5);
  T('[12] five outside accounts: runs exit 0', !r5.bad, r5.bad);
  if (!r5.bad) {
    T('[12] ... the host is not struck or judged', !r5.av.some(x => x === 'free' || x === 'judge') && r5.leaves === 0, 'verdicts=' + JSON.stringify(r5.av) + ' leaves=' + r5.leaves);
    T('[12] ... the outside records dropped by the seat gate, both keys settle', (r5.out.match(Q80LINE) || []).length >= 1 && !Q75.test(r5.out) && !/team2 accusation [^\n]*-> strike/.test(r5.out)
      && [0, 1].every(i => (r5.state.PROCESSED_FILE || []).indexOf(key12(i, 5).key) >= 0));
  }
  const script = path.join(__dirname, '..', '.mutant-seat-gate-q43-' + process.pid + '.js');
  const from = 'const seatGate = applySeatGate(recs, starts, startsPending, processed);';
  try {
    fs.writeFileSync(script, SRC.replace(from, 'const seatGate = { out: new Map(), n: 0 };'));
    const m = play12(5, script);
    T('[12] mutant: seat gate removed -> the host is judged again', !m.bad && m.av.indexOf('judge') >= 0 && m.leaves === 1, m.bad || ('verdicts=' + JSON.stringify(m.av) + ' leaves=' + m.leaves));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}

// ---- [13] / [14] a roster its voters split gates nothing ----
// [13] P3 / P4 (seats 2 / 3) lose to P1 / P2. Their modded starts name two other accounts at seats 0 / 1, so the four votes
//   there split 2 to 2 and the roster leaves seats 0 / 1 empty: gating on it dropped the winners' own records and settled
//   the losers' claim. [14] P2 dropped before level 1 (no start, no record); the losers and an outside account starting
//   from the empty seat 1 name another account at seat 0, three votes to P1's one, so the roster seats that account where
//   P1 started. Both rosters are marked split: no seat gate, the Q75 contest holds the key, nobody rated or convicted.
{
  const SPLIT_FROM = '  if (!p || p.synth || p.split || !p.roster || isEndlessMt(p.mt | 0)) return null;';
  const SPLIT_TO = '  if (!p || p.synth || !p.roster || isEndlessMt(p.mt | 0)) return null;';
  const cases = [
    ['[13]', 0x8030, () => {
      const h = 0x8030, SPL = [Q[0], Q[1], P3, P4];
      const S = [{ sid: P1, d: t2start(h, 0, RR) }, { sid: P2, d: t2start(h, 1, RR) }, { sid: P3, d: t2start(h, 2, SPL) }, { sid: P4, d: t2start(h, 3, SPL) }];
      const R = [{ sid: P1, d: t2settle(h, 0, RR, 0) }, { sid: P2, d: t2settle(h, 1, RR, 0) }, { sid: P3, d: t2settle(h, 2, SPL, 1) }, { sid: P4, d: t2settle(h, 3, SPL, 1) }];
      return { S, R, honest: [P1, P2], cheats: [P3, P4] };
    }],
    ['[14]', 0x8031, () => {
      const h = 0x8031, CM = [Q[0], X1, P3, P4];
      const S = [{ sid: P1, d: t2start(h, 0, RR) }, { sid: X1, d: t2start(h, 1, CM) }, { sid: P3, d: t2start(h, 2, CM) }, { sid: P4, d: t2start(h, 3, CM) }];
      const R = [{ sid: P1, d: t2settle(h, 0, RR, 0) }, { sid: P3, d: t2settle(h, 2, CM, 1) }, { sid: P4, d: t2settle(h, 3, CM, 1) }];
      return { S, R, honest: [P1], cheats: [P3, P4] };
    }],
  ];
  for (const [tag, h, build] of cases) {
    const { S, R, honest, cheats } = build();
    const steps = [[0, S], [FLOOR + 1000, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]];
    const key = keyOf(S[0].d), rs = timeline(steps);
    T(tag + ' four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
    const p = pendOf(rs[0], key) || {};
    T(tag + ' the roster registers split, logged and counted', p.split === 1 && /start-split /.test(rs[0].out) && Q80ROW(rs[0], 0, 0, 1), JSON.stringify(p) + ' ' + rowOf(rs[0]));
    T(tag + ' no seat gate (nothing dropped); the Q75 contest holds the key until the start entry matures', !Q80LINE.test(outOf(rs)) && Q75.test(rs[1].out) && Q75.test(rs[2].out)
      && !processedOf(rs[2]).has(key));
    T(tag + ' nobody rated; the honest players are no leavers at maturity', honest.concat(cheats).every(s => none(rs, s)) && honest.every(s => leavesOf(last(rs), s) === 0),
      JSON.stringify(honest.concat(cheats).map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])));
    if (SRC.split(SPLIT_FROM).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-seat-gate-split-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(SPLIT_FROM, SPLIT_TO));
      const m = timeline(steps, script);
      T(tag + ' mutant: a split roster gates -> the colluders take the win', cheats.every(s => up(m, s)) && honest.every(s => !up(m, s)),
        JSON.stringify(honest.concat(cheats).map(s => ptsIn(m, s))));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [15] review-q80.js T1 / T2: outside votes from seats past the players' seat count ----
// Before the job's first look, outside accounts write starts at the winners' seats (taking both sides' votes there) and
//   from seats the match does not have, naming a roster of their own; after the real result they copy it at the winners'
//   seats. Without the agreement check their roster registered unsplit, the gate dropped the winners' records and the
//   outside pair took the win.
{
  const FROM = '    if (!isEndlessMt(pending[m].mt) && (startRosterSplit(att, votes, roster) || startRosterDisagrees(all))) {';
  const TO = '    if (!isEndlessMt(pending[m].mt) && (startRosterSplit(att, votes, roster))) {';
  const cases = [
    ['[15] T1 2V2', 0x8040, () => {
      const h = 0x8040, R7 = [Q[0], Q[1], P3, P4, Q[2], Q[3], Q[4]], F4 = [Q[0], Q[1], P3, P4];
      const S = realStarts(h).concat([[Q[0], 0], [Q[1], 1], [Q[2], 4], [Q[3], 5], [Q[4], 6]].map(([sid, seat]) => ({ sid, d: t2start(h, seat, R7) })));
      const F = [{ sid: Q[0], d: t2settle(h, 0, F4, 0) }, { sid: Q[1], d: t2settle(h, 1, F4, 0) }];
      return { S, R: realSettles(h).concat(F), winners: [P1, P2], losers: [P3, P4], takers: [Q[0], Q[1]], all: RR.concat(Q.slice(0, 5)) };
    }],
    ['[15] T2 1V1', 0x8041, () => {
      const h = 0x8041, ros = [P1, P2], R4 = [Q[0], P2, Q[1], Q[2]];
      const S = [{ sid: P1, d: ffaStart(h, 0, ros) }, { sid: P2, d: ffaStart(h, 1, ros) }].concat([[Q[0], 0], [Q[1], 2], [Q[2], 3]].map(([sid, seat]) => ({ sid, d: ffaStart(h, seat, R4) })));
      const R = [{ sid: P1, d: ffaSettle(h, 0, ros) }, { sid: P2, d: ffaSettle(h, 1, ros) }, { sid: Q[0], d: ffaSettle(h, 0, [Q[0], P2]) }];
      return { S, R, winners: [P1], losers: [P2], takers: [Q[0]], all: ros.concat(Q.slice(0, 3)) };
    }],
  ];
  for (const [tag, h, build] of cases) {
    const { S, R, winners, losers, takers, all } = build();
    const steps = [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]];
    const key = keyOf(S[0].d), rs = timeline(steps);
    T(tag + ': five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
    const p = pendOf(rs[0], key) || {};
    T(tag + ': the roster registers split (logged, counted)', p.split === 1 && /start-split /.test(rs[0].out), JSON.stringify(p) + ' ' + rowOf(rs[0]));
    T(tag + ': no seat gate; the Q75 contest holds the key, nobody rated', !Q80LINE.test(outOf(rs)) && Q75.test(rs[1].out) && !processedOf(rs[3]).has(key)
      && all.every(s => none(rs, s)), JSON.stringify(all.map(s => ptsIn(rs, s))));
    T(tag + ': no player convicted at maturity (the outside accounts that only wrote starts at seats past the count get their own exit)',
      winners.concat(losers, takers).every(s => leavesOf(last(rs), s) === 0), JSON.stringify(all.map(s => leavesOf(last(rs), s))));
    if (SRC.split(FROM).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-seat-gate-agree-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(FROM, TO));
      const m = timeline(steps, script);
      T(tag + ' mutant: the agreement check removed -> the outside accounts take the win', takers.every(s => up(m, s)) && winners.every(s => !up(m, s)),
        JSON.stringify(winners.concat(losers, takers).map(s => ptsIn(m, s))));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [16] REVIEW-2 A1: the losers P3 / P4 name alts Q0 / Q1 at the winners' seats; the alts start there ----
// Before the job's first look (no race: they write at level 1 like everyone). The alts take P1 / P2's votes away at
//   seats 0 / 1; P3 / P4 are the only voters left and name their own roster. Comparing the voters only, it registered
//   unsplit, the gate dropped P1 / P2's records and P3 / P4 took the win (the alts lose). Every start counts now: split,
//   the Q75 contest holds the key, nobody rated or convicted.
{
  const h = 0x8050, AL = [Q[0], Q[1], P3, P4];
  const S = [{ sid: P1, d: t2start(h, 0, RR) }, { sid: P2, d: t2start(h, 1, RR) }].concat([0, 1, 2, 3].map(s => ({ sid: AL[s], d: t2start(h, s, AL) })));
  const R = [{ sid: P1, d: t2settle(h, 0, RR, 0) }, { sid: P2, d: t2settle(h, 1, RR, 0) }].concat([0, 1, 2, 3].map(s => ({ sid: AL[s], d: t2settle(h, s, AL, 1) })));
  const steps = [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]];
  const key = keyOf(S[0].d), rs = timeline(steps), all6 = RR.concat([Q[0], Q[1]]);
  T('[16] five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[16] seats 0 / 1 disputed; the roster registers split', (pendOf(rs[0], key) || {}).split === 1 && /start-split /.test(rs[0].out), JSON.stringify(pendOf(rs[0], key)));
  T('[16] no seat gate; the Q75 contest holds the key, nobody rated', !Q80LINE.test(outOf(rs)) && Q75.test(rs[1].out) && !processedOf(rs[3]).has(key) && all6.every(s => none(rs, s)),
    JSON.stringify(all6.map(s => ptsIn(rs, s))));
  T('[16] nobody convicted at maturity', all6.every(s => leavesOf(last(rs), s) === 0), JSON.stringify(all6.map(s => leavesOf(last(rs), s))));
  const MFROM = '  return all.some((r) => sig(r) !== sig(all[0]));';
  const MTO = '  const att = all.filter((r) => all.filter((o) => (o.d[5] | 0) === (r.d[5] | 0)).length === 1); const so = (r) => (r.d[8] | 0) + \'|\' + Object.keys(r.roster || {}).sort().join(\',\'); return all.some((r) => so(r) !== so(all[0])) || att.some((r) => rosterCanon(r.roster) !== rosterCanon(att[0].roster));';
  if (SRC.split(MFROM).length !== 2) bad('[16] mutant: anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-seat-gate-allstarts-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(MFROM, MTO));
      const m = timeline(steps, script);
      T('[16] mutant: comparing the voters only -> P3 / P4 take the win, P1 / P2 get nothing', up(m, P3) && up(m, P4) && none(m, P1) && none(m, P2),
        JSON.stringify(all6.map(s => ptsIn(m, s))));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (seat-gate) ===');
process.exit(failN === 0 ? 0 : 1);
