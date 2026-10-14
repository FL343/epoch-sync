'use strict';
// Q214 (cloud audit 2026-10): a friends' room (type 10) or a bot match (type 11) held by a RESULT on another table now
// settles on its majority table past the Q200 maturity. Before, an outside account that wrote a result of its own -- a
// seat count or seat map of its own, or at a player's seat -- held the key for good (Q200 README residual 1, repro-q200.js
// S1): two seat layouts or a seat named twice is a roster contest, nothing ends the contest of these two types, and the
// players who finished got no XP. Now, once the key's Q200 note is STARTS_MATURITY_MS old and the run read every shard in
// full, the key's result writers are counted by table (each writer for the one table all his records of the key name,
// nobody for a writer split over two tables or not at his own seat); more than half of the writers on one table leaves
// the results on any other table out before grouping, and the Q200 filter, the contest and the settle go on as usual.
// Only when no table has more than half, a table that names writers of another table while that table names none of its
// own writers is set aside with its writers (outside accounts that wrote the players into a table of their own) and the
// rest counted again: the majority first, so one member of a room who writes a table of his own never beats the room.
// Nobody flagged, nobody convicted (XP only, to the writers kept).
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/private-contest-expiry.js, plus a lever that fails one shard read).
//   [0] wiring pins (the call after the seat gate and before grouping, the gates, the vote with the majority first and
//       the set-aside only without one, the table, only results dropped, the summary row, the exports)
//   [1] units on applyTableMajority: a friends' room key with one outside result (left out at maturity; nothing a second
//       before, on an incomplete read, without a note, with a registered seat gate, once processed, with no starts
//       state); matchmade and endless keys untouched; two outside accounts naming the players against two players
//       (no majority: theirs set aside, left out) and two with a table of their own naming none of them (a tie); a
//       writer whose own start names another table (counts, votes for nothing); a copy of the players' result from a
//       player's seat (left out); every result on one table (nothing); a bot match; a lone human against one outside
//       account naming him (left out); three outside accounts naming the players and three with a table of their own
//       (their table has more than half and wins: documented); an outside start alone (left to the Q200 filter); a
//       player's result with another seat count on the room's seat map (left out: the table is the seat count and the
//       seat map); a player against the room, both tables naming each other's writers (nothing set aside: the majority,
//       or a tie in a two-seat room, also with an outside table of its own beside them); one member of a room who
//       writes a table of his own naming none of the others (outvoted by the room; in a two-seat room, a tie, the
//       room's table set aside: documented)
//   [2] a three-player friends' room, two outside accounts with a start and a result of their own: settled past
//       maturity on the players' table (three of five), the three players paid, the outsiders nothing, nobody flagged or
//       counted as a leaver, the summary row
//   [3] a bot match with two humans, the outsider with a start and a result at a bot seat: the same
//   [4] the outsider copies the players' start and result word for word, from a player's seat: the same, past the
//       five-minute pacing floor (two start claims on one seat: no start roster, the settle's own first sighting)
//   [5] a made-up result ahead of the real one (Q80 third review), one outside account: held an hour after the real
//       result and a minute before maturity, settled on the players' table past it
//   [6] two outside accounts naming the players against two players: no majority, their table set aside, settled on the
//       players' table past maturity
//   [7] a lone human against bots and one outside account naming him: the same, on the lone lane
//   [8] an incomplete read past maturity: nothing left out, still held; the next full read settles it
//   [9] outside accounts outnumbering the players (three against two), naming them (documented): their table has more
//       than half and wins, the players get nothing (as when it was held) -- the same records as [13] with the roles
//       turned round; pinned so a change to it is seen
//   [10] control: an honest friends' room settles at its first look, no table-majority line
//   [11] two outside accounts with a table of their own naming none of the players (a tie): held past maturity and a day
//       later, the tie logged and counted, nobody paid
//   [12] three outside accounts with a table of their own naming none of the players (documented): their table wins --
//       the players get nothing (as when it was held), nobody flagged or counted as a leaver, the outsiders the XP of a
//       room they could have played among themselves; pinned so a change to it is seen
//   [13] a three-player friends' room, one of them writes his start and result on a table of his own that names none of
//       the others: outvoted (two of three) past maturity, the two paid, he nothing, nobody flagged
//       (past the leave wait for his seat of the room)
//   [14] a bot match with two humans, one of them writes a table that names only him (documented): a tie, the room's table
//       set aside, he paid on the lone lane, the other human nothing (as when it was held) -- the same records as [7]
//       with the roles turned round
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
  "  if (/GetLeaderboardEntries/.test(u) && process.env.STUB_FAIL_ID && new RegExp('leaderboardid=' + process.env.STUB_FAIL_ID + '(&|$)').test(u)) return { ok: false, status: 403, text: async () => '{}' };",
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

const P3 = [501, 502, 503].map(SID), X3 = [508, 509].map(SID);
const B2 = [511, 512].map(SID), BX = SID(519);
const C2 = [521, 522].map(SID), CX = SID(529);
const E2 = [531, 532].map(SID), EX = SID(539);
const T2 = [541, 542].map(SID), TX = [548, 549].map(SID);
const L1 = [551].map(SID), LX = SID(559);
const I2 = [561, 562].map(SID), IX = SID(569);
const O2 = [571, 572].map(SID), OX = [576, 577, 578].map(SID);
const H2 = [581, 582].map(SID);
const D2 = [591, 592].map(SID), DX = [598, 599].map(SID);
const F2 = [611, 612].map(SID), FX = [616, 617, 618].map(SID);
const G3 = [621, 622, 623].map(SID), K2 = [631, 632].map(SID);
const ALL = [].concat(P3, X3, B2, [BX], C2, [CX], E2, [EX], T2, TX, L1, [LX], I2, [IX], O2, OX, H2, D2, DX, F2, FX, G3, K2);
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// a timeline of runs: [[ms since the previous run, records visible in that run, extra env], ...] -> every run's result
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, env || null, script);
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
const TMAJ = /table-majority ([0-9]+_[0-9]+_[0-9]+): ([0-9]+) of ([0-9]+) result writers on one table past the hold's maturity(?: \(([0-9]+) more set aside: [^)]*\))? -- ([0-9]+) result\(s\) on another table left out, nobody flagged \(Q214\)/;
const TROW = (r, a, b) => new RegExp("\\| friends' room / bot match keys held past maturity by results on two tables: the other table's results left out / no table with more than half, still held \\(Q214\\) \\| " + a + ' / ' + b + ' \\|').test(r.summary);

const TTIE = /table-majority ([0-9]+_[0-9]+_[0-9]+): no table has more than half of the ([0-9]+) result writers(?: \(([0-9]+) more set aside: [^)]*\))? -- held as before \(Q214\)/;
// "<votes>/<writers counted>/<writers set aside>/<results left out>"
const MAJ = (r, key) => { const m = new RegExp('table-majority ' + key + ': ([0-9]+) of ([0-9]+) result writers on one table past the hold\'s maturity(?: \\(([0-9]+) more set aside: [^)]*\\))? -- ([0-9]+) result\\(s\\) on another table left out').exec(r.out); return m ? [m[1], m[2], m[3] || '0', m[4]].join('/') : ''; };
const TIE = (r, key) => new RegExp('table-majority ' + key + ': no table has more than half').test(r.out);
const lines = (r, re) => (r.out.match(re || /[^\n]*(Q214|Q200|Q75|private settle|bots settle)[^\n]*/g) || []).join(' | ');

// ---- scenarios (each a list of timeline steps; the mutation script reruns them) ----
// the players' starts and the outside start before the job's first look, the results twelve minutes in (the hold and its
//   note begin there), then a minute before maturity, two minutes after it, a day later
const heldSteps = (S, R) => [[0, S], [12 * MIN, S.concat(R)], [MAT - 2 * MIN, S.concat(R)], [3 * MIN, S.concat(R)], [DAY, S.concat(R)]];
const ROOM3 = () => {   // [2] three players; X3[0] / X3[1] write a start and a result from seats 3 / 4 of a five-seat table
  const h = 0xA301, P = P3, ros = [P[0], P[1], P[2]], xr = ros.concat(X3), sc = [6100, 5200, 4800], xsc = [900, 800, 700, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 2), start(10, h, xr, 3), start(10, h, xr, 4)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, ros, 2, sc), settle(10, h, xr, 3, xsc), settle(10, h, xr, 4, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: X3 };
};
const BOTS = () => {   // [3] bot match, two humans and two bot seats; BX writes a start and a result from bot seat 2, named there
  const h = 0xA302, P = B2, ros = [P[0], P[1], '0', '0'], xr = [P[0], P[1], BX, '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, ros, 1), start(11, h, xr, 2)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, ros, 1, sc), settle(11, h, xr, 2, [900, 800, 6100, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [BX] };
};
const COPY = () => {   // [4] CX copies the players' start and result word for word, written from seat 1 (C2[1]'s seat)
  const h = 0xA303, P = C2, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 1, CX)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, ros, 1, sc, CX)];
  const all = S.concat(R);   // the start claims on seat 1 split, no start roster registers: the settle's own first sighting
  //   starts the five-minute pacing floor once the key is no longer held (as in R3 of repro-q200.js)
  return { key: keyOf(S[0].d), honest: P, outside: [CX], steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [6 * MIN, all], [DAY, all]] };
};
const EARLY1 = () => {   // [5] EX starts from seat 2 before the first look and writes a made-up result a minute in (himself on top);
  //   the real result twelve minutes in. The hold and its note begin with the made-up result (run 1).
  const h = 0xA304, P = E2, ros = [P[0], P[1]], xr = [P[0], P[1], EX], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const F = [settle(10, h, xr, 2, [900, 800, 6100])];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  const all = S.concat(F, R);
  return { key: keyOf(S[0].d), honest: P, outside: [EX],
    steps: [[0, S], [MIN, S.concat(F)], [5 * MIN, S.concat(F)], [6 * MIN, all], [HOUR, all], [MAT - 72 * MIN, all], [2 * MIN, all], [DAY, all]] };
};
const NAME2 = () => {   // [6] two players; TX[0] / TX[1] write a start and a result from seats 2 / 3 of a four-seat table naming them
  const h = 0xA305, P = T2, ros = [P[0], P[1]], xr = ros.concat(TX), sc = [6100, 5200], xsc = [900, 800, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2), start(10, h, xr, 3)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc), settle(10, h, xr, 3, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: TX };
};
const LONE1 = () => {   // [7] one human against three bots; LX writes a start and a result from bot seat 1, named there (the human at 0)
  const h = 0xA306, P = L1, ros = [P[0], '0', '0', '0'], xr = [P[0], LX, '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, xr, 1)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, xr, 1, [900, 6100, 4800, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [LX] };
};
const PARTIAL = () => {   // [8] the shape of [4] of test/private-contest-expiry.js (IX at seat 2 of three), the run past maturity
  //   cannot read one shard (an incomplete read), the next one can
  const h = 0xA307, P = I2, ros = [P[0], P[1]], xr = [P[0], P[1], IX], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, [900, 800, 6100])];
  const all = S.concat(R);
  return { key: keyOf(S[0].d), honest: P, outside: [IX],
    steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all, { STUB_FAIL_ID: '1049' }], [3 * MIN, all]] };
};
const OUTNUM = () => {   // [9] two players; OX[0..2] write a start and a result from seats 2..4 of a five-seat table
  const h = 0xA308, P = O2, ros = [P[0], P[1]], xr = ros.concat(OX), sc = [6100, 5200], xsc = [900, 800, 6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2), start(10, h, xr, 3), start(10, h, xr, 4)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc), settle(10, h, xr, 3, xsc), settle(10, h, xr, 4, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: OX };
};
const DISJ2 = () => {   // [11] two players; DX[0] / DX[1] write a start and a result from seats 0 / 1 of a two-seat table of their own
  const h = 0xA30A, P = D2, ros = [P[0], P[1]], xr = [DX[0], DX[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, sc), settle(10, h, xr, 1, sc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: DX };
};
const DISJ3 = () => {   // [12] two players; FX[0..2] write a start and a result from seats 0..2 of a three-seat table of their own
  const h = 0xA30B, P = F2, ros = [P[0], P[1]], xr = [FX[0], FX[1], FX[2]], sc = [6100, 5200], xsc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, xsc), settle(10, h, xr, 1, xsc), settle(10, h, xr, 2, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R).concat([[6 * MIN, S.concat(R)]]), honest: P, outside: FX };
};
const DEFECT3 = () => {   // [13] three players; G3[2] writes his start and result from seat 0 of a one-seat table of his own
  const h = 0xA30C, P = [G3[0], G3[1]], ros = G3.slice(), own = [G3[2]], sc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, own, 0)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, own, 0, [6100])];
  const all = S.concat(R);   // seat 2 of the room's starts has no result left once his goes: the leave wait (Q121) runs
  //   from the settle's first look past the pacing floor
  return { key: keyOf(S[0].d), honest: P, outside: [G3[2]], steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [6 * MIN, all], [HOUR + MIN, all]] };
};
const DEFECT2 = () => {   // [14] bot match, two humans; K2[1] writes his start and result from his seat 1 on a table that
  //   names only him (the other seats bots): the records of [7] with the roles turned round
  const h = 0xA30D, P = [K2[0]], ros = [K2[0], K2[1], '0', '0'], own = ['0', K2[1], '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, own, 1)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, own, 1, [900, 6100, 4800, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [K2[1]] };
};
const HONEST = () => {   // [10] control: a two-player friends' room, nobody outside
  const h = 0xA309, P = H2, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  return { key: keyOf(S[0].d), honest: P, steps: [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]] };
};

console.log("=== a friends' room or bot match held by a result on another table, past maturity (Q214) ===");

// ---- [0] wiring pins ----
{
  T('[0] called after the seat gate and before grouping, on this run\'s full-read flag; its counts kept',
    /const seatGate = applySeatGate\(recs, starts, startsPending, processed\);\n\s+RUN\.offSeat = seatGate\.n;\n(\s*\/\/[^\n]*\n)*\s+const tableMaj = applyTableMajority\(recs, starts, startsPending, processed, Date\.now\(\), shardsComplete\);\n\s+RUN\.tableMajority = tableMaj\.keys\.length; RUN\.tableTie = tableMaj\.ties\.length;\n\s+const gr = groupRecords\(recs, /.test(SRC));
  T('[0] gates: a full read, a friends\' room or bot match, not endless, not processed, no seat gate, the Q200 note STARTS_MATURITY_MS old',
    /if \(!complete \|\| !pending \|\| !recs \|\| !recs\.length\) return res;/.test(SRC)
    && /if \(!xpOnlyContestMt\(mt\) \|\| isEndlessMt\(mt\) \|\| processed\.has\(m\) \|\| seatGateRoster\(pending\[m\]\)\) continue;/.test(SRC)
    && /const seen = pending\['~' \+ m\];\n\s+if \(!seen \|\| now - \(seen\.t0 \|\| 0\) < STARTS_MATURITY_MS\) continue;/.test(SRC));
  T('[0] the vote: each writer for the one table of his results and his own starts; more than half of the writers first; only without it a table with a one-sided claim on another table\'s writers set aside with its own, and a recount',
    /for \(const r of stByKey\[m\] \|\| \[\]\) if \(of\[String\(r\.steamID\)\]\) of\[String\(r\.steamID\)\]\.add\(recTable\(r\)\);/.test(SRC)
    && /if \(of\[w\]\.size !== 1\) continue;/.test(SRC) && /if \(t !== null\) vote\[w\] = t;/.test(SRC)
    && /if \(aside\.has\(vote\[w\]\)\) continue;\n\s+counted\+\+;/.test(SRC)
    && /return \{ votes, counted, win: Object\.keys\(votes\)\.find\(\(t\) => votes\[t\] \* 2 > counted\) \};/.test(SRC)
    && /let tally = count\(new Set\(\)\);\n\s+if \(tally\.win === undefined\) \{/.test(SRC)
    && /const claims = \(t, u\) => writers\.some\(\(w\) => vote\[w\] === u && named\[t\]\.has\(w\)\);/.test(SRC)
    && /const aside = new Set\(tables\.filter\(\(t\) => tables\.some\(\(u\) => u !== t && claims\(t, u\) && !claims\(u, t\)\)\)\);\n\s+if \(aside\.size\) tally = count\(aside\);/.test(SRC));
  T('[0] the table: seat count and roster, nobody\'s for a writer not at his own seat',
    /function recTable\(r\) \{\n\s+const own = r\.roster && r\.roster\[r\.d\[5\] \| 0\];\n\s+if \(own == null \|\| String\(own\) !== String\(r\.steamID\)\) return null;[^\n]*\n\s+return \(r\.d\[8\] \| 0\) \+ '\|' \+ rosterCanon\(r\.roster\);/.test(SRC));
  T('[0] only results are left out (starts stay for the Q200 filter)', /const drop = g\.filter\(\(r\) => recTable\(r\) !== win\);/.test(SRC)
    && !/starts\.length = /.test(SRC.slice(SRC.indexOf('function applyTableMajority('), SRC.indexOf('// O93: the one-attester exception'))));
  T('[0] summary row', /s\('tableMajority', 0\) \+ ' \/ ' \+ s\('tableTie', 0\)/.test(SRC));
  T('[0] exports', typeof v.applyTableMajority === 'function' && typeof v.recTable === 'function');
}

// ---- [1] units ----
if (typeof v.applyTableMajority !== 'function') bad('[1] applyTableMajority is not in this validate.js (the units are skipped)');
else {
  const mk = (sid, mt, h, seat, ros, magic) => { const d = rec(magic || 0xB1, mt, h, seat, 0, false, ros, ros.map(() => 0)); return { steamID: sid, d, roster: v.decodeRoster(d) }; };
  const quiet = (fn) => { const l = console.log, w = console.warn; console.log = console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
  const A = SID(601), B = SID(602), X = SID(609), Y = SID(608), Z = SID(607);
  const t0 = 5e12;
  const call = (recs, starts, pend, o) => {
    o = o || {};
    const list = recs.slice();
    const res = quiet(() => v.applyTableMajority(list, starts, pend, o.processed || new Set(), o.now || t0, o.complete !== false));
    return { kept: list.map(r => r.steamID + '@' + (r.d[5] | 0)).join(','), res };
  };
  const mature = (key, back) => ({ ['~' + key]: { t0: t0 - (back == null ? MAT : back), s: [], r: 0, c: 0 } });
  const room = (mt, h, outRos, outSeats, opts) => {   // A / B at seats 0 / 1, outside results (and starts) on outRos
    opts = opts || {};
    const ros = opts.ros || [A, B], key = h + '_1234_' + mt;
    const R = ros.map((s, i) => s === '0' ? null : mk(s, mt, h, i, ros)).filter(Boolean);
    const X1 = outSeats.map(([sid, seat]) => mk(sid, mt, h, seat, outRos));
    const S = ros.map((s, i) => s === '0' ? null : mk(s, mt, h, i, ros, 0xB2)).filter(Boolean).concat(outSeats.map(([sid, seat]) => mk(sid, mt, h, seat, outRos, 0xB2)));
    return { key, recs: R.concat(X1), starts: S, honestKept: R.map(r => r.steamID + '@' + (r.d[5] | 0)).join(',') };
  };
  let u = room(10, 9101, [A, B, X], [[X, 2]]), c = call(u.recs, u.starts, mature(u.key));
  T('[1] friends\' room, one outside result past maturity: his result left out, the players\' kept, the key counted', c.res.n === 1 && c.res.keys.join() === u.key && !c.res.ties.length && c.kept === u.honestKept, JSON.stringify(c));
  c = call(u.recs, u.starts, mature(u.key, MAT - 1000));
  T('[1] ... a second before maturity: nothing left out', c.res.n === 0 && !c.res.keys.length && c.kept.split(',').length === 3);
  c = call(u.recs, u.starts, mature(u.key), { complete: false });
  T('[1] ... on an incomplete read: nothing', c.res.n === 0 && c.kept.split(',').length === 3);
  c = call(u.recs, u.starts, {});
  T('[1] ... with no note (never held): nothing', c.res.n === 0 && c.kept.split(',').length === 3);
  c = call(u.recs, u.starts, Object.assign(mature(u.key), { [u.key]: { t0: t0 - DAY, mt: 10, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [] } }));
  T('[1] ... with a registered seat gate: nothing (the gate decides)', c.res.n === 0 && c.kept.split(',').length === 3);
  c = call(u.recs, u.starts, mature(u.key), { processed: new Set([u.key]) });
  T('[1] ... once processed: nothing', c.res.n === 0 && c.kept.split(',').length === 3);
  T('[1] ... no starts state at all: nothing, no crash', call(u.recs, u.starts, null).res.n === 0);
  u = room(2, 9102, [A, B, X], [[X, 2]]);
  T('[1] a matchmade key: nothing (its contest voids)', call(u.recs, u.starts, mature(u.key)).res.n === 0);
  u = room(7, 9103, [A, B, X], [[X, 2]]);
  T('[1] an endless key: nothing (its own settle)', call(u.recs, u.starts, mature(u.key)).res.n === 0);
  u = room(10, 9104, [A, B, X, Y], [[X, 2], [Y, 3]]); c = call(u.recs, u.starts, mature(u.key));
  T('[1] two outside results naming the players against two players: no majority, their table set aside, left out', c.res.n === 2 && c.res.keys.join() === u.key && !c.res.ties.length && c.kept === u.honestKept, JSON.stringify(c));
  u = room(10, 9115, [X, Y], [[X, 0], [Y, 1]]); c = call(u.recs, u.starts, mature(u.key));
  T('[1] two outside results on a table of their own naming none of the players: nothing left out, the key a tie', c.res.n === 0 && c.res.ties.join() === u.key && c.kept.split(',').length === 4, JSON.stringify(c.res));
  u = room(10, 9105, [A, B, X], [[X, 2]]); u.starts[1] = mk(B, 10, 9105, 1, [A, B, X], 0xB2); c = call(u.recs, u.starts, mature(u.key));
  T('[1] a writer whose own start names another table counts and votes for nothing: one of two with the outside table set aside, a tie', c.res.n === 0 && c.res.ties.join() === u.key, JSON.stringify(c.res));
  u = room(10, 9106, [A, B], [[X, 1]]); c = call(u.recs, u.starts, mature(u.key));
  T('[1] a copy of the players\' result written from a player\'s seat (not at his own seat): left out', c.res.n === 1 && c.kept === u.honestKept, JSON.stringify(c));
  u = room(10, 9107, null, []); u.recs[1] = mk(B, 10, 9107, 1, [A, B]); u.recs[1].d[11] = 77; c = call(u.recs, u.starts, mature(u.key));
  T('[1] every result on one table (scores apart): nothing done, no tie either', c.res.n === 0 && !c.res.keys.length && !c.res.ties.length);
  u = room(11, 9108, [A, B, X, '0'], [[X, 2]], { ros: [A, B, '0', '0'] }); c = call(u.recs, u.starts, mature(u.key));
  T('[1] a bot match, the outside result from a bot seat: left out', c.res.n === 1 && c.kept === u.honestKept, JSON.stringify(c));
  u = room(11, 9109, [A, X, '0', '0'], [[X, 1]], { ros: [A, '0', '0', '0'] }); c = call(u.recs, u.starts, mature(u.key));
  T('[1] a lone human against bots and one outside result naming him: left out', c.res.n === 1 && c.res.keys.join() === u.key && c.kept === u.honestKept, JSON.stringify(c));
  u = room(10, 9110, [A, B, X, Y, Z], [[X, 2], [Y, 3], [Z, 4]]); c = call(u.recs, u.starts, mature(u.key));
  T('[1] three outside results naming the players against two players: their table has more than half, the players\' results left out (documented: the same records as a five-seat room whose two members wrote a table of their own)', c.res.n === 2 && c.kept === [X + '@2', Y + '@3', Z + '@4'].join(), JSON.stringify(c));
  u = room(10, 9116, [X, Y, Z], [[X, 0], [Y, 1], [Z, 2]]); c = call(u.recs, u.starts, mature(u.key));
  T('[1] three outside results on a table of their own against two players: the players\' results left out (documented: as when held, they get nothing)', c.res.n === 2 && c.kept === [X + '@0', Y + '@1', Z + '@2'].join(), JSON.stringify(c));
  u = room(10, 9111, null, []); u.starts.push(mk(X, 10, 9111, 2, [A, B, X], 0xB2)); c = call(u.recs, u.starts, mature(u.key));
  T('[1] an outside start with no result (the players\' results on one table): nothing here (the Q200 filter\'s)', c.res.n === 0 && !c.res.ties.length);
  const C = SID(606);
  u = room(10, 9112, null, [], { ros: [A, B, C] }); u.recs[2].d[8] = 4; c = call(u.recs, u.starts, mature(u.key));
  T('[1] a player writes his result with another seat count, same seat map (his start the room\'s): his result left out', c.res.n === 1 && c.kept === [A + '@0', B + '@1'].join(), JSON.stringify(c));
  u = room(10, 9113, null, [], { ros: [A, B, C] }); u.recs[2].d[8] = 4; u.starts[2].d[8] = 4; c = call(u.recs, u.starts, mature(u.key));
  T('[1] a player against the room, his start and result on another seat count: the tables name each other\'s writers, nothing set aside, the majority leaves his result out', c.res.n === 1 && c.kept === [A + '@0', B + '@1'].join(), JSON.stringify(c));
  u = room(10, 9114, null, [], { ros: [A, C] }); u.recs[1].d[8] = 3; u.starts[1].d[8] = 3; c = call(u.recs, u.starts, mature(u.key));
  T('[1] ... in a two-seat room: one against one, nothing set aside, a tie', c.res.n === 0 && c.res.ties.join() === u.key, JSON.stringify(c.res));
  u = room(10, 9119, null, [], { ros: [A, C] }); u.recs[1].d[8] = 3; u.starts[1].d[8] = 3;
  u.recs.push(mk(Y, 10, 9119, 0, [Y])); u.starts.push(mk(Y, 10, 9119, 0, [Y], 0xB2)); c = call(u.recs, u.starts, mature(u.key));
  T('[1] ... and an outside account on a table of its own beside them: one against one against one, the two naming each other not set aside, a tie', c.res.n === 0 && c.res.ties.join() === u.key, JSON.stringify(c.res));
  const D = SID(605);
  u = room(10, 9117, null, [], { ros: [A, B, D] }); u.recs[2] = mk(D, 10, 9117, 0, [D]); u.starts[2] = mk(D, 10, 9117, 0, [D], 0xB2); c = call(u.recs, u.starts, mature(u.key));
  T('[1] one member of a three-seat room writes a table of his own naming none of the others: two of three on the room\'s table, his result left out (the room\'s table, which names him, never set aside ahead of the count)', c.res.n === 1 && c.res.keys.join() === u.key && c.kept === [A + '@0', B + '@1'].join(), JSON.stringify(c));
  u = room(10, 9118, null, [], { ros: [A, D] }); u.recs[1] = mk(D, 10, 9118, 0, [D]); u.starts[1] = mk(D, 10, 9118, 0, [D], 0xB2); c = call(u.recs, u.starts, mature(u.key));
  T('[1] ... in a two-seat room: one against one, the room\'s table set aside, the other player\'s result left out (documented: he gets nothing, as when it was held)', c.res.n === 1 && c.kept === D + '@0', JSON.stringify(c));
}

// ---- [2]-[12] end to end ----
function scenario(tag, label, mk, check) {
  const s = mk(), rs = timeline(s.steps);
  console.log('  ' + tag + ' ' + label);
  check(s, rs);
}
scenario('[2]', "a three-player friends' room, two outside accounts with a start and a result of their own", ROOM3, (s, rs) => {
  T('[2] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[2] held from the results to a minute before maturity, nothing left out yet', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key) && !TMAJ.test(outOf(rs.slice(0, 3))));
  const m = LIFT.exec(rs[3].out);
  T('[2] past maturity: 3 of 5 on the players\' table, nothing set aside, 2 results left out, the 2 outside starts by the Q200 filter, not held', MAJ(rs[3], s.key) === '3/5/0/2' && m && m[2] === '2' && !HELD.test(rs[3].out), lines(rs[3]));
  T('[2] settled then: the three players paid in that run only', processedOf(rs[3]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 3)), JSON.stringify(s.honest.map(p => rs.map(r => xpOf(r, p)))));
  T('[2] the outside accounts get nothing', s.outside.every(x => neverPaid(rs, x)));
  T('[2] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
  T('[2] summary row: 0 / 0 while held, 1 / 0 in the run that settles it', TROW(rs[2], 0, 0) && TROW(rs[3], 1, 0) && TROW(rs[4], 0, 0), (rs[3].summary.match(/[^\n]*Q214[^\n]*/) || [''])[0]);
});
scenario('[3]', 'a bot match, two humans, the outsider with a start and a result at a bot seat', BOTS, (s, rs) => {
  T('[3] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[3] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[3] past it: 2 of 3 on the players\' table, his result left out, settled: both humans paid, the outsider nothing', MAJ(rs[3], s.key) === '2/3/0/1' && LIFT.test(rs[3].out)
    && /bots settle /.test(rs[3].out) && processedOf(rs[3]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 3)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[3]));
  T('[3] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[4]', "the outsider copies the players' start and result, written from a player's seat", COPY, (s, rs) => {
  T('[4] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[4] held until maturity (a seat named twice)', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[4] past it: his copy left out (not at his own seat), his start by the Q200 filter, no longer held; the pacing floor from the settle\'s own first sighting',
    MAJ(rs[3], s.key) === '2/3/0/1' && LIFT.test(rs[3].out) && !HELD.test(rs[3].out) && /pacing [0-9_]+: start first sighted 0s ago/.test(rs[3].out) && !processedOf(rs[3]).has(s.key), lines(rs[3]));
  T('[4] settled past the floor: both players paid in that run only, he nothing', processedOf(rs[4]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[4]));
  T('[4] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[5]', 'a made-up result ahead of the real one, one outside account (Q80 third review)', EARLY1, (s, rs) => {
  T('[5] every run exits 0', allOk(rs, 8), outOf(rs).slice(-600));
  T('[5] held from the made-up result on, an hour after the real one and a minute before maturity too; nothing left out', [1, 2, 3, 4, 5].every(i => HELD.test(rs[i].out))
    && !TMAJ.test(outOf(rs.slice(0, 6))) && !processedOf(rs[5]).has(s.key), lines(rs[5]));
  T('[5] past maturity: 2 of 3 on the players\' table, his result left out, settled: both players paid in that run only, he nothing', MAJ(rs[6], s.key) === '2/3/0/1'
    && processedOf(rs[6]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 6)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[6]));
  T('[5] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[6]', 'two outside accounts naming the players against two players', NAME2, (s, rs) => {
  T('[6] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[6] held from the results to a minute before maturity, nothing left out yet', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key) && !TMAJ.test(outOf(rs.slice(0, 3))) && !TIE(rs[2], s.key));
  T('[6] past maturity: two against two, no majority; their table set aside with its 2 writers, 2 of 2 on the players\' table, their 2 results left out, settled: both players paid in that run only', MAJ(rs[3], s.key) === '2/2/2/2'
    && LIFT.test(rs[3].out) && !HELD.test(rs[3].out) && !TIE(rs[3], s.key) && processedOf(rs[3]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 3)), lines(rs[3]));
  T('[6] the outside accounts get nothing, nobody counted as a leaver or flagged', s.outside.every(x => neverPaid(rs, x)) && nobodyHurt(rs, s.honest.concat(s.outside)));
  T('[6] summary row: 1 / 0 in the run that settles it', TROW(rs[2], 0, 0) && TROW(rs[3], 1, 0) && TROW(rs[4], 0, 0), (rs[3].summary.match(/[^\n]*Q214[^\n]*/) || [''])[0]);
});
scenario('[7]', 'a lone human against bots and one outside account naming him', LONE1, (s, rs) => {
  T('[7] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[7] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[7] past it: one against one, no majority; his table set aside, 1 of 1 on the human\'s table, his result left out, settled on the lone lane: the human paid in that run only, he nothing', MAJ(rs[3], s.key) === '1/1/1/1'
    && /bots settle [^\n]*\(lone lane x0\.6\)/.test(rs[3].out) && processedOf(rs[3]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 3)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[3]));
  T('[7] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[8]', 'an incomplete read past maturity, then a full one', PARTIAL, (s, rs) => {
  T('[8] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[8] the run that cannot read a shard leaves nothing out: still held', /read shard failed: shard s49 HTTP 403/.test(rs[3].out) && HELD.test(rs[3].out) && !TMAJ.test(rs[3].out) && !TIE(rs[3], s.key) && !processedOf(rs[3]).has(s.key), lines(rs[3], /[^\n]*(Q214|Q75|read shard)[^\n]*/g));
  T('[8] the next full read settles it on the players\' table: both paid there, the outsider nothing', MAJ(rs[4], s.key) === '2/3/0/1' && processedOf(rs[4]).has(s.key)
    && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[4]));
});
scenario('[9]', 'outside accounts outnumbering the players, three against two, naming them (documented)', OUTNUM, (s, rs) => {
  T('[9] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[9] past maturity their table has more than half and wins: 3 of 5, nothing set aside, the players\' 2 results left out', MAJ(rs[3], s.key) === '3/5/0/2', lines(rs[3]));
  T('[9] the players get nothing (as when it was held), the outside accounts are paid once', s.honest.every(p => neverPaid(rs, p)) && s.outside.every(x => xpIn(rs, x).length === 1),
    JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[9] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[10]', "control: an honest friends' room", HONEST, (s, rs) => {
  T('[10] every run exits 0', allOk(rs, 3), outOf(rs).slice(-600));
  const paidRun = rs.findIndex(r => processedOf(r).has(s.key));
  T('[10] settles at its first look past the pacing floor, both paid, no table-majority line, summary 0 / 0', paidRun >= 1 && s.honest.every(p => xpIn(rs, p).length === 1)
    && !/table-majority /.test(outOf(rs)) && rs.every(r => TROW(r, 0, 0)), 'paid in run ' + paidRun);
});
scenario('[11]', 'two outside accounts with a table of their own, naming none of the players (a tie)', DISJ2, (s, rs) => {
  T('[11] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[11] held in every run after the results, a day past maturity too; nothing left out or lifted', rs.slice(1).every(r => HELD.test(r.out)) && !TMAJ.test(outOf(rs)) && !LIFT.test(outOf(rs)) && !processedOf(rs[4]).has(s.key));
  T('[11] past maturity the tie is logged and counted, nothing set aside', TIE(rs[3], s.key) && TIE(rs[4], s.key) && !TIE(rs[2], s.key) && TROW(rs[3], 0, 1) && !/set aside/.test(lines(rs[3])), lines(rs[3]));
  T('[11] nobody paid, nobody counted as a leaver or flagged', s.honest.concat(s.outside).every(x => neverPaid(rs, x)) && nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[12]', 'three outside accounts with a table of their own, naming none of the players (documented)', DISJ3, (s, rs) => {
  T('[12] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[12] past maturity their table wins: 3 of 5, nothing set aside, the players\' 2 results left out', MAJ(rs[3], s.key) === '3/5/0/2', lines(rs[3]));
  T('[12] the players get nothing (as when it was held)', s.honest.every(p => neverPaid(rs, p)));
  T('[12] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
  T('[12] the outside accounts are paid once, the XP of a room they could have played among themselves', s.outside.every(x => xpIn(rs, x).length === 1),
    JSON.stringify(s.outside.map(x => rs.map(r => xpOf(r, x)))));
});
scenario('[13]', "a three-player friends' room, one of them on a table of his own naming none of the others", DEFECT3, (s, rs) => {
  T('[13] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[13] held from the results to a minute before maturity (seat 0 named twice), nothing left out yet', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key) && !TMAJ.test(outOf(rs.slice(0, 3))));
  T('[13] past maturity: 2 of 3 on the room\'s table, nothing set aside, his result left out, his start by the Q200 filter, not held', MAJ(rs[3], s.key) === '2/3/0/1' && LIFT.test(rs[3].out) && !HELD.test(rs[3].out), lines(rs[3]));
  T('[13] then the leave wait for his seat of the room (Q121), and settled past it: the two paid in that run only, he nothing', /leave-wait [^\n]*seat 2 /.test(rs[4].out) && !processedOf(rs[4]).has(s.key)
    && processedOf(rs[5]).has(s.key) && s.honest.every(p => paidOnlyIn(rs, p, 5)) && s.outside.every(x => neverPaid(rs, x)),
    lines(rs[4]) + ' || ' + JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[13] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[14]', 'a bot match, two humans, one of them on a table that names only him (documented)', DEFECT2, (s, rs) => {
  T('[14] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[14] held until maturity', HELD.test(rs[1].out) && HELD.test(rs[2].out) && !processedOf(rs[2]).has(s.key));
  T('[14] past it: one against one, the room\'s table set aside with its writer, 1 of 1 on his table, the other human\'s result left out', MAJ(rs[3], s.key) === '1/1/1/1', lines(rs[3]));
  T('[14] the other human gets nothing (as when it was held), he is paid once on the lone lane', s.honest.every(p => neverPaid(rs, p)) && s.outside.every(x => xpIn(rs, x).length === 1)
    && /bots settle [^\n]*\(lone lane x0\.6\)/.test(outOf(rs)),
    JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[14] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});

if (failN) { console.log(failN + ' FAILED'); process.exit(1); }
console.log('all ok');
