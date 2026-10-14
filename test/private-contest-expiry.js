'use strict';
// Q200 (cloud audit 2026-10): a friends' room (type 10) or a bot match (type 11) held by the roster contest (Q75 / Q80) now
// stops being held by start records alone once the hold is STARTS_MATURITY_MS old. Before, such a key had no end: its start
// entry is exempt from the orphan verdict and the contest note's void is matchmade-only, so one outside start record
// (written before the job's first look, from a seat the room does not have) kept both players at 0 XP for as long as it
// stayed on its shard (B009 final review, review4 of Q75 / Q80 D3: 31 days). Now the key gets a note of its own when it is
// first found contested (no contest mark, nothing voids it); once that note is STARTS_MATURITY_MS old, a start record whose
// writer wrote no result for the key is left out of the check. A result record is never left out.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as test/leave-confirm.js).
//   [0] wiring pins (the filter, the note in the contest branch, the clock, the summary row, the export)
//   [1] units: applyRosterContest on a friends' room key (held, note made, still held a minute before maturity, lifted at
//       maturity), a start of a result writer kept, an outside result kept, a bot key, a matchmade key (sticky, unchanged),
//       an endless key (untouched), no starts state (no note, held)
//   [2] D3: a two-player friends' room, an outside start from seat 2 before the job's first look, the real result twelve
//       minutes in: held at 1h58 after the contest began, settled at 2h01 (both players paid, the outsider nothing, nobody
//       flagged or counted as a leaver), the note gone once processed, the log line and the summary row
//   [3] the same for a bot match with two humans and two bot seats (the outsider at a bot seat)
//   [4] a lone human against bots (the single-writer lane), the outsider at a bot seat: settled on the lone lane
//   [5] the outsider also wrote a result (a claim to XP): still held after maturity and a day later, nobody paid
//   [6] a player of the room wrote a start naming an alt at an extra seat and quit (no result): the other two are paid
//       after maturity and the absence grace for his seat, the quitter nothing
//   [7] made-up results ahead of the real one (Q80 third review): held in the first hours (six minutes in, past the pacing
//       floor, only the made-up result written) and after them, the outsiders get nothing
//   [8] control: an honest friends' room settles at its first look past the pacing floor, no note, no lift line
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-contest-'));
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
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) -- every test
      //   runs before each production reconcile, so a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every stored
//   instant moves back instead: start sightings and notes, absent-seat stamps and the writers' busy marks)
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
const xpOf = (r, sid) => posts(r, 5).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

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
const start = (mt, h, ros, seat, sid) => ({ sid: sid || ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
// a friends' room ranks by score (rank 1 = the top score); a bot match reads its ranks from the vector (rank field 0)
const settle = (mt, h, ros, seat, sc, sid) => {
  const rk = v.isBotMt(mt) ? 0 : 1 + sc.filter((x, i) => x > sc[seat] && ros[i] !== '0').length;
  return { sid: sid || ros[seat], d: rec(0xB1, mt, h, seat, rk, rk === 1, ros, sc) };
};
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const MIN = 60000, HOUR = 3600 * 1000, DAY = 24 * HOUR;
const MAT = v.STARTS_MATURITY_MS;

const D2P = [301, 302].map(SID), DX = SID(309);
const B2P = [311, 312].map(SID), BX = SID(319);
const L1P = [321].map(SID), LX = SID(329);
const R2P = [331, 332].map(SID), RX = SID(339);
const M3P = [341, 342, 343].map(SID), MA = SID(349);
const E2P = [351, 352].map(SID), EX = [358, 359].map(SID);
const H2P = [361, 362].map(SID);
const ALL = [].concat(D2P, [DX], B2P, [BX], L1P, [LX], R2P, [RX], M3P, [MA], E2P, EX, H2P);
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
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
const xpIn = (rs, sid) => [].concat(...rs.map(r => xpOf(r, sid)));
const paidOnlyIn = (rs, sid, i) => rs.every((r, j) => (j === i) === (xpOf(r, sid).length > 0)) && xpOf(rs[i], sid).every(x => x > 0);
const neverPaid = (rs, sid) => xpIn(rs, sid).length === 0;
const nobodyHurt = (rs, sids) => sids.every(s => rs.every(r => leavesOf(r, s) === 0 && fOf(r, s) === 0));
const HELD = /roster contest, not settled \(Q75\)/;
const LIFT = /contest-lifted ([0-9]+_[0-9]+_[0-9]+): contested since [^\n]* by start records alone -- ([0-9]+) start record\(s\) from accounts that wrote no result left out, settled as usual \(Q200\)/;
const ROW = (r, n) => new RegExp("\\| friends' room / bot match keys no longer held by start records alone, a contest past maturity \\(Q200\\) \\| " + n + ' \\|').test(r.summary);

// ---- scenarios (each a list of timeline steps; the mutation script reruns them) ----
// the players' starts and an outside start before the job's first look, the real result twelve minutes in, then the
//   hold measured from that run: a minute before maturity, two minutes after it, a day later
const heldSteps = (S, R) => [[0, S], [12 * MIN, S.concat(R)], [MAT - 2 * MIN, S.concat(R)], [3 * MIN, S.concat(R)], [DAY, S.concat(R)]];
const D3 = () => {   // [2] two-player friends' room, no bot seat; the outside start names DX at seat 2 (seat count 3)
  const h = 0xA201, P = D2P, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, [P[0], P[1], DX], 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [DX] };
};
const BOT2 = () => {   // [3] bot match, two humans and two bot seats; the outside start names BX at bot seat 2
  const h = 0xA202, P = B2P, ros = [P[0], P[1], '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, ros, 1), start(11, h, [P[0], P[1], BX, '0'], 2)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, ros, 1, sc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [BX] };
};
const LONE = () => {   // [4] one human against three bots; the outside start names LX at bot seat 1
  const h = 0xA203, P = L1P, ros = [P[0], '0', '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, [P[0], LX, '0', '0'], 1)];
  const R = [settle(11, h, ros, 0, sc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [LX] };
};
const RES = () => {   // [5] the outsider writes a start and a result (copying the scores, naming himself at seat 2)
  const h = 0xA204, P = R2P, ros = [P[0], P[1]], xr = [P[0], P[1], RX], sc = [6100, 5200], xsc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [RX] };
};
const MEMBER = () => {   // [6] three-player friends' room; P2 starts naming his alt MA at an extra seat 3 and quits (no result)
  const h = 0xA205, P = M3P, ros = [P[0], P[1], P[2]], sc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, [P[0], P[1], P[2], MA], 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  const all = S.concat(R);   // P2's seat is absent from the result: the absence grace (ABSENT_GRACE_MS) runs from the lift
  return { key: keyOf(S[0].d), steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [6 * MIN, all], [DAY, all]], honest: [P[0], P[1]], outside: [P[2], MA] };
};
const EARLY = () => {   // [7] EX[0] starts from seat 2 (seat count 4) before the first look; EX[0] / EX[1] write a made-up result
  //   from seats 2 / 3 a minute in (themselves on top); the real result twelve minutes in
  const h = 0xA206, P = E2P, ros = [P[0], P[1]], xr = [P[0], P[1], EX[0], EX[1]], sc = [6100, 5200], fsc = [900, 800, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const F = [settle(10, h, xr, 2, fsc), settle(10, h, xr, 3, fsc)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  const all = S.concat(F, R);
  return { key: keyOf(S[0].d), honest: P, outside: EX,
    steps: [[0, S], [MIN, S.concat(F)], [5 * MIN, S.concat(F)], [6 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [DAY, all]] };
};
const HONEST = () => {   // [8] control: a two-player friends' room, nobody outside
  const h = 0xA207, P = H2P, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  return { key: keyOf(S[0].d), honest: P, steps: [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]] };
};

console.log("=== a friends' room or bot match held by start records alone, past maturity (Q200) ===");

// ---- [0] wiring pins ----
{
  T('[0] the filter: past maturity on its note, a type 10 / 11 key keeps only the starts of result writers',
    /const xpOnly = xpOnlyContestMt\(g\[0\]\.d\[2\] \| 0\);/.test(SRC)
    && /if \(xpOnly && seen && now - \(seen\.t0 \|\| 0\) >= STARTS_MATURITY_MS\) \{/.test(SRC)
    && /const wrote = new Set\(g\.map\(\(r\) => String\(r\.steamID\)\)\);/.test(SRC)
    && /const keep = st\.filter\(\(r\) => wrote\.has\(String\(r\.steamID\)\)\);/.test(SRC)
    && /const recsM = g\.concat\(st\);/.test(SRC));
  T('[0] the note is made when the key is held (no contest mark), a lift only when it is not', /markContest\(pending, m, now\); \}[^\n]*\n\s+if \(res\.contested\.has\(m\)\) \{ if \(xpOnly && pending\) seenNote\(pending, m, now\); \}[^\n]*\n\s+else if \(left\) \{/.test(SRC));
  T('[0] xpOnlyContestMt: friends\' room or bot match', /function xpOnlyContestMt\(mt\) \{ return isPrivateMt\(mt\) \|\| isBotMt\(mt\); \}/.test(SRC));
  T('[0] the lift is counted and logged', /RUN\.contestLifted = \(RUN\.contestLifted \| 0\) \+ 1;/.test(SRC) && /contest-lifted /.test(SRC));
  T('[0] summary row', /s\('contestLifted', 0\)/.test(SRC));
  T('[0] the note keeps no contest mark for these keys (markContest is matchmade-only)', /function markContest\(pending, m, now\) \{ if \(pending && isMatchmadeMt\(String\(m\)\.split\('_'\)\[2\] \| 0\)\) seenNote\(pending, m, now\)\.c = 1; \}/.test(SRC));
  T('[0] exports', typeof v.applyRosterContest === 'function' && typeof v.STARTS_MATURITY_MS === 'number');
}

// ---- [1] units ----
{
  const sidR = (sid, mt, h, seat, ros, magic) => ({ steamID: sid, d: rec(magic || 0xB1, mt, h, seat, 0, false, ros, ros.map(() => 0)), roster: v.decodeRoster(rec(magic || 0xB1, mt, h, seat, 0, false, ros, ros.map(() => 0))) });
  const A = SID(401), B = SID(402), X = SID(409);
  const unit = (mt, h, extra) => {
    const ros = [A, B], key = h + '_1234_' + mt;
    const g = [sidR(A, mt, h, 0, ros), sidR(B, mt, h, 1, ros)].concat(extra.res || []);
    const starts = [sidR(A, mt, h, 0, ros, 0xB2), sidR(B, mt, h, 1, ros, 0xB2)].concat(extra.starts || []);
    return { key, g, starts };
  };
  const call = (u, pending, now) => {
    const gr = { groups: { [u.key]: u.g }, consistentMatches: [{ m: u.key, g: u.g }], inconsistentGroups: [] };
    const res = v.applyRosterContest(gr, u.starts, pending, { players: {}, flagged: {} }, new Set(), now);
    return { held: res.contested.has(u.key), left: gr.consistentMatches.map(c => c.m) };
  };
  const quiet = (fn) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
  const t0 = 5e12;
  // a friends' room key with one outside start from seat 2
  const u = unit(10, 9001, { starts: [sidR(X, 10, 9001, 2, [A, B, X], 0xB2)] });
  const pend = {};
  const c1 = quiet(() => call(u, pend, t0));
  T('[1] friends\' room: held at first sight, a note made without a contest mark', c1.held && pend['~' + u.key] && pend['~' + u.key].t0 === t0 && !pend['~' + u.key].c, JSON.stringify(pend));
  const c2 = quiet(() => call(u, pend, t0 + MAT - 1000));
  T('[1] ... still held a second before maturity, the note not moved', c2.held && (pend['~' + u.key] || {}).t0 === t0);
  const c3 = quiet(() => call(u, pend, t0 + MAT));
  T('[1] ... lifted at maturity, the key stays in the consistent list', !c3.held && c3.left.indexOf(u.key) >= 0, JSON.stringify(c3));
  // the start of a result writer is kept: B's own start names another seat count
  const ub = unit(10, 9002, {}); ub.starts[1] = sidR(B, 10, 9002, 1, [A, B, X], 0xB2);
  const pb = { ['~' + ub.key]: { t0: t0 - MAT, s: [], r: 0, c: 0 } };
  T('[1] a result writer\'s own start that disagrees still holds the key past maturity', quiet(() => call(ub, pb, t0)).held);
  // an outside result is never left out
  const ur = unit(10, 9003, { res: [sidR(X, 10, 9003, 2, [A, B, X])], starts: [sidR(X, 10, 9003, 2, [A, B, X], 0xB2)] });
  const pr = { ['~' + ur.key]: { t0: t0 - DAY, s: [], r: 0, c: 0 } };
  T('[1] an outside result still holds the key a day past maturity', quiet(() => call(ur, pr, t0)).held);
  // a bot match key behaves like a friends' room key
  const ubot = unit(11, 9004, { starts: [sidR(X, 11, 9004, 2, [A, B, X], 0xB2)] });
  const pbot = {};
  quiet(() => call(ubot, pbot, t0));
  T('[1] bot match: note made, lifted at maturity', pbot['~' + ubot.key] && !pbot['~' + ubot.key].c && !quiet(() => call(ubot, pbot, t0 + MAT)).held, JSON.stringify(pbot));
  // a matchmade key keeps its sticky contest (Q127): marked, still held past maturity (it voids in reconcileStarts)
  const umm = unit(2, 9005, { starts: [sidR(X, 2, 9005, 2, [A, B, X], 0xB2)] });
  const pmm = {};
  quiet(() => call(umm, pmm, t0));
  T('[1] matchmade: contest mark set, still held past maturity (unchanged)', (pmm['~' + umm.key] || {}).c === 1 && quiet(() => call(umm, pmm, t0 + MAT + DAY)).held, JSON.stringify(pmm));
  // an endless key is left to its own settle: no note
  const uen = unit(7, 9006, { starts: [sidR(X, 7, 9006, 2, [A, B, X], 0xB2)] });
  const pen = {};
  T('[1] endless: not held here, no note', !quiet(() => call(uen, pen, t0)).held && !pen['~' + uen.key]);
  // a direct caller with no starts state: held, nothing written
  T('[1] no starts state: held, no crash', quiet(() => call(u, null, t0 + DAY)).held);
}

// ---- [2]-[8] end to end ----
function scenario(tag, label, mk, check) {
  const s = mk(), rs = timeline(s.steps);
  console.log('  ' + tag + ' ' + label);
  check(s, rs);
}
scenario('[2]', "D3: two-player friends' room, an outside start before the first look", D3, (s, rs) => {
  T('[2] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[2] held from the result (12 min) to a minute before maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[2] the key\'s note made at the first hold, no contest mark', pendOf(rs[1], '~' + s.key) && !pendOf(rs[1], '~' + s.key).c, JSON.stringify(pendOf(rs[1], '~' + s.key)));
  const m = LIFT.exec(rs[3].out);
  T('[2] lifted two minutes past maturity: one start left out, the log line names the key', m && m[1] === s.key && m[2] === '1' && !HELD.test(rs[3].out), (rs[3].out.match(/[^\n]*(Q200|Q75)[^\n]*/g) || []).join(' | '));
  T('[2] settled then: both players paid in that run only', processedOf(rs[3]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 3)), JSON.stringify(s.honest.map(p => rs.map(r => xpOf(r, p)))));
  T('[2] the outsider gets nothing', s.outside.every(x => neverPaid(rs, x)));
  T('[2] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
  T('[2] the note is gone once the key is processed', !pendOf(rs[4], '~' + s.key), JSON.stringify(pendOf(rs[4], '~' + s.key)));
  T('[2] summary row: 0 while held, 1 in the run that lifts it', ROW(rs[2], 0) && ROW(rs[3], 1) && ROW(rs[4], 0), (rs[3].summary.match(/[^\n]*Q200[^\n]*/) || [''])[0]);
});
scenario('[3]', 'bot match, two humans, the outsider at a bot seat', BOT2, (s, rs) => {
  T('[3] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[3] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[3] lifted and settled past it: both humans paid, the outsider nothing', LIFT.test(rs[3].out) && processedOf(rs[3]).has(s.key)
    && s.honest.every(p => paidOnlyIn(rs, p, 3)) && s.outside.every(x => neverPaid(rs, x)), (rs[3].out.match(/[^\n]*(Q200|bots settle)[^\n]*/g) || []).join(' | '));
  T('[3] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[4]', 'a lone human against bots, the outsider at a bot seat', LONE, (s, rs) => {
  T('[4] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[4] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[4] lifted and settled on the lone lane past it', LIFT.test(rs[3].out) && /bots settle [^\n]*\(lone lane x0\.6\)/.test(rs[3].out)
    && paidOnlyIn(rs, s.honest[0], 3) && neverPaid(rs, s.outside[0]), (rs[3].out.match(/[^\n]*(Q200|bots settle)[^\n]*/g) || []).join(' | '));
});
scenario('[5]', 'the outsider also wrote a result', RES, (s, rs) => {
  T('[5] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[5] held in every run after the results, a day past maturity too; nothing lifted', rs.slice(1).every(r => HELD.test(r.out)) && !LIFT.test(outOf(rs))
    && !processedOf(rs[4]).has(s.key));
  T('[5] nobody paid', s.honest.concat(s.outside).every(x => neverPaid(rs, x)));
});
scenario('[6]', 'a player starts naming an alt at an extra seat and quits', MEMBER, (s, rs) => {
  T('[6] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[6] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[6] lifted past it, then the absence grace for the quitter\'s seat', LIFT.test(rs[3].out) && /absent-hold [^\n]*seat 2 wrote no record/.test(rs[3].out) && !processedOf(rs[3]).has(s.key),
    (rs[3].out.match(/[^\n]*(Q200|absent-hold)[^\n]*/g) || []).join(' | '));
  T('[6] settled past the grace: the two who finished are paid, the quitter and his alt nothing', processedOf(rs[4]).has(s.key)
    && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => neverPaid(rs, x)), (rs[4].out.match(/[^\n]*(Q200|private settle|absent-hold|leave-wait)[^\n]*/g) || []).join(' | '));
  T('[6] nobody counted as a leaver or flagged (no leaver economy in a friends\' room)', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[7]', 'a made-up result written ahead of the real one (Q80 third review)', EARLY, (s, rs) => {
  T('[7] every run exits 0', allOk(rs, 7), outOf(rs).slice(-600));
  T('[7] six minutes in (past the pacing floor), only the made-up result written: held by the players\' starts', HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key),
    (rs[2].out.match(/[^\n]*(Q75|Q200|private)[^\n]*/g) || []).join(' | '));
  T('[7] held from the made-up result on, in the first hours and after them; nothing lifted', rs.slice(1).every(r => HELD.test(r.out)) && !LIFT.test(outOf(rs))
    && !processedOf(rs[6]).has(s.key));
  T('[7] the outside accounts get nothing', s.outside.every(x => neverPaid(rs, x)));
});
scenario('[8]', "control: an honest friends' room", HONEST, (s, rs) => {
  T('[8] every run exits 0', allOk(rs, 3), outOf(rs).slice(-600));
  const paidRun = rs.findIndex(r => processedOf(r).has(s.key));
  T('[8] settles at its first look past the pacing floor, both paid, nothing held or lifted, no note', paidRun >= 1 && s.honest.every(p => xpIn(rs, p).length === 1)
    && !HELD.test(outOf(rs)) && !LIFT.test(outOf(rs)) && rs.every(r => !pendOf(r, '~' + s.key)), 'paid in run ' + paidRun);
});

if (failN) { console.log(failN + ' FAILED'); process.exit(1); }
console.log('all ok');
