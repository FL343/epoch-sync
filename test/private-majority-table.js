'use strict';
// Q214 / Q220 (cloud audit 2026-10): a friends' room (type 10) or a bot match (type 11) held by a RESULT on another table
// settles past the Q200 maturity, each table on a key of its own. Before Q214, an outside account that wrote a result of
// its own -- a seat count or seat map of its own, or at a player's seat -- held the key for good (Q200 README residual 1,
// repro-q200.js S1): two seat layouts or a seat named twice is a roster contest, nothing ends the contest of these two
// types, and the players who finished got no XP. Q214 voted the tables (the majority first) and left the other table's
// results out: outside accounts as many as the players held it still (a tie), more than them took it, and a member of
// a bot match who wrote a table of his own took it from the other human (its README residuals 1, 2 and 8). Q220: once
// the key's Q200 note is STARTS_MATURITY_MS old and the run read every shard in full, each table settles on a key of
// its own (splitKey: 't' + a hash of the key and the table, the seed, the type -- no record a client writes carries a
// key starting with a letter), its results and the starts that name it moved there; a writer counts for a table when
// every result he wrote names it at his own seat (his starts follow their own table), the results of any other writer
// are left out, nobody flagged. A table settles there as any key does (XP to the writers of its results; a friends'
// room table with one writer does not settle). Once a table of the key has an entry or is processed the split is sticky.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/private-contest-expiry.js, plus a lever that fails one shard read).
//   [0] wiring pins (the call after the seat gate and before grouping, the gates, a writer counted by his results only,
//       the sticky split, the key form, the entry (on the first split t0 from the original entry or the note, after it
//       now; no seat gate; the original entry's sightings of the table's own starts), the starts that follow their
//       table, only results dropped, the
//       summary row, the exports, the split keys among the keys seen this run, the report index on the match hash)
//   [1] units on applyTableSplit: a friends' room key with one outside result (two keys past maturity; nothing a second
//       before, on an incomplete read, without a note, with a registered seat gate, once processed, with no starts
//       state); matchmade and endless keys untouched; the entry's t0 (from the original entry, else the note, none
//       without either) and the original entry's sightings carried; sticky (whatever the read, note or seat gate; a
//       table written since gets a key of its own on an entry that starts now, no sightings carried); a copy of the players' result from a player's seat (one table, on
//       a key of its own); no writer on one table of his own (held); a writer on two tables (left out); a writer whose
//       own start names another table (counted by his result); a bot match; a lone human against one outside account;
//       three outside accounts against two players (two keys); an outside start alone (the Q200 filter's); the key form
//   [2] a three-player friends' room, two outside accounts with a start and a result of their own: two keys past
//       maturity, the three players paid then, the outsiders on their own table once their hold is over, nobody
//       flagged or counted as a leaver, the original key never processed, the summary row
//   [3] a bot match with two humans, the outsider with a start and a result at a bot seat: the same (he on the lone lane)
//   [4] the outsider copies the players' start and result word for word, from a player's seat: one table, its key,
//       both players paid at maturity (no pacing restart: the entry's t0 is the note's), he nothing
//   [5] a made-up result ahead of the real one (Q80 third review), one outside account: held an hour after the real
//       result and a minute before maturity, split past it; the players paid, his one-writer table nothing
//   [6] two outside accounts naming the players against two players: two keys, both tables paid
//   [7] a lone human against bots and one outside account naming him: the same, both on the lone lane
//   [8] an incomplete read past maturity: nothing moved, still held; the next full read splits it
//   [9] outside accounts outnumbering the players (three against two), naming them: the players paid on their table
//       (Q214 gave their table the key and the players nothing), the outsiders on theirs
//   [10] control: an honest friends' room settles at its first look, no table-split line
//   [11] two outside accounts with a table of their own naming none of the players: both tables paid (Q214: held)
//   [12] three outside accounts with a table of their own naming none of the players: both tables paid (Q214: theirs)
//   [13] a three-player friends' room, one of them writes his start and result on a table of his own that names none of
//       the others: the two paid past the absent-seat hold of his seat, he nothing (a one-writer friends' room table)
//   [14] a bot match with two humans, one of them writes a table that names only him: both paid on the lone lane
//       (Q214 gave his table the key and the other human nothing) -- the same records as [7] with the roles turned round
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
const ANYSPLIT = /table-split [^\n]*\(Q220\)/;
// "<tables>/<writers per table, sorted>/<results left out>" of the first split of `key`
const SPLIT = (r, key) => {
  const m = new RegExp('table-split ' + key + ": results on ([0-9]+) tables past the hold's maturity -- each table settles on a key of its own \\((.*?)\\), (nothing left out|([0-9]+) result\\(s\\) from writers not on one table of their own left out, nobody flagged: [^\\n]*) \\(Q220\\)").exec(r.out);
  return m ? [m[1], Array.from(m[2].matchAll(/t[0-9]+_[0-9]+_[0-9]+ ([0-9]+) writer\(s\)/g), x => x[1]).sort().join(','), m[4] || '0'].join('/') : '';
};
// "<writers>/<results left out>" of a split into one table
const ONE = (r, key) => {
  const m = new RegExp('table-split ' + key + ": one table left past the hold's maturity -- it settles on a key of its own \\(t[0-9]+_[0-9]+_[0-9]+ ([0-9]+) writer\\(s\\)\\), (nothing left out|([0-9]+) result\\(s\\) from writers not on one table of their own left out, nobody flagged: [^\\n]*) \\(Q220\\)").exec(r.out);
  return m ? m[1] + '/' + (m[3] || '0') : '';
};
const TROW = (r, a, b, c) => new RegExp("\\| friends' room / bot match keys held past maturity by results on two tables: two tables or more, each on a key of its own / one table, on a key of its own, the others' results left out / no writer on one table, still held \\(Q214, Q220\\) \\| " + a + ' / ' + b + ' / ' + c + ' \\|').test(r.summary);
const lines = (r, re) => (r.out.match(re || /[^\n]*(Q220|Q200|Q75|private settle|bots settle|absent-hold|leave-wait|lone\()[^\n]*/g) || []).join(' | ');
// the key a table of the scenario settles on: the record's own table (as applyTableSplit reads it)
const kOf = (key, x) => v.splitKey(key, v.recTable({ steamID: x.sid, d: x.d, roster: v.decodeRoster(x.d) }));
const lone = (rs, k) => new RegExp('bots settle ' + k + ': 1 writer[^\\n]*\\(lone lane x0\\.6\\)').test(outOf(rs));

// ---- scenarios (each a list of timeline steps; the mutation script reruns them) ----
// the players' starts and the outside start before the job's first look, the results twelve minutes in (the hold and its
//   note begin there), then a minute before maturity, two minutes after it, a day later
const heldSteps = (S, R) => [[0, S], [12 * MIN, S.concat(R)], [MAT - 2 * MIN, S.concat(R)], [3 * MIN, S.concat(R)], [DAY, S.concat(R)]];
const ROOM3 = () => {   // [2] three players; X3[0] / X3[1] write a start and a result from seats 3 / 4 of a five-seat table
  const h = 0xA301, P = P3, ros = [P[0], P[1], P[2]], xr = ros.concat(X3), sc = [6100, 5200, 4800], xsc = [900, 800, 700, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 2), start(10, h, xr, 3), start(10, h, xr, 4)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, ros, 2, sc), settle(10, h, xr, 3, xsc), settle(10, h, xr, 4, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: X3, hrec: R[0], xrec: R[3] };
};
const BOTS = () => {   // [3] bot match, two humans and two bot seats; BX writes a start and a result from bot seat 2, named there
  const h = 0xA302, P = B2, ros = [P[0], P[1], '0', '0'], xr = [P[0], P[1], BX, '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, ros, 1), start(11, h, xr, 2)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, ros, 1, sc), settle(11, h, xr, 2, [900, 800, 6100, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [BX], hrec: R[0], xrec: R[2] };
};
const COPY = () => {   // [4] CX copies the players' start and result word for word, written from seat 1 (C2[1]'s seat)
  const h = 0xA303, P = C2, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 1, CX)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, ros, 1, sc, CX)];
  const all = S.concat(R);   // the start claims on seat 1 split, no start roster registers (Q214: the settle's own first
  //   sighting started the five-minute pacing floor; Q220: the entry's t0 is the note's, the hold's own start)
  return { key: keyOf(S[0].d), honest: P, outside: [CX], hrec: R[0], steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [6 * MIN, all], [DAY, all]] };
};
const EARLY1 = () => {   // [5] EX starts from seat 2 before the first look and writes a made-up result a minute in (himself on top);
  //   the real result twelve minutes in. The hold and its note begin with the made-up result (run 1).
  const h = 0xA304, P = E2, ros = [P[0], P[1]], xr = [P[0], P[1], EX], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const F = [settle(10, h, xr, 2, [900, 800, 6100])];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  const all = S.concat(F, R);
  return { key: keyOf(S[0].d), honest: P, outside: [EX], hrec: R[0], xrec: F[0],
    steps: [[0, S], [MIN, S.concat(F)], [5 * MIN, S.concat(F)], [6 * MIN, all], [HOUR, all], [MAT - 72 * MIN, all], [2 * MIN, all], [DAY, all]] };
};
const NAME2 = () => {   // [6] two players; TX[0] / TX[1] write a start and a result from seats 2 / 3 of a four-seat table naming them
  const h = 0xA305, P = T2, ros = [P[0], P[1]], xr = ros.concat(TX), sc = [6100, 5200], xsc = [900, 800, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2), start(10, h, xr, 3)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc), settle(10, h, xr, 3, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: TX, hrec: R[0], xrec: R[2] };
};
const LONE1 = () => {   // [7] one human against three bots; LX writes a start and a result from bot seat 1, named there (the human at 0)
  const h = 0xA306, P = L1, ros = [P[0], '0', '0', '0'], xr = [P[0], LX, '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, xr, 1)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, xr, 1, [900, 6100, 4800, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [LX], hrec: R[0], xrec: R[1] };
};
const PARTIAL = () => {   // [8] the shape of [4] of test/private-contest-expiry.js (IX at seat 2 of three), the run past maturity
  //   cannot read one shard (an incomplete read), the next one can
  const h = 0xA307, P = I2, ros = [P[0], P[1]], xr = [P[0], P[1], IX], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, [900, 800, 6100])];
  const all = S.concat(R);
  return { key: keyOf(S[0].d), honest: P, outside: [IX], hrec: R[0], xrec: R[2],
    steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all, { STUB_FAIL_ID: '1049' }], [3 * MIN, all]] };
};
const OUTNUM = () => {   // [9] two players; OX[0..2] write a start and a result from seats 2..4 of a five-seat table
  const h = 0xA308, P = O2, ros = [P[0], P[1]], xr = ros.concat(OX), sc = [6100, 5200], xsc = [900, 800, 6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2), start(10, h, xr, 3), start(10, h, xr, 4)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc), settle(10, h, xr, 3, xsc), settle(10, h, xr, 4, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: OX, hrec: R[0], xrec: R[2] };
};
const DISJ2 = () => {   // [11] two players; DX[0] / DX[1] write a start and a result from seats 0 / 1 of a two-seat table of their own
  const h = 0xA30A, P = D2, ros = [P[0], P[1]], xr = [DX[0], DX[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, sc), settle(10, h, xr, 1, sc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: DX, hrec: R[0], xrec: R[2] };
};
const DISJ3 = () => {   // [12] two players; FX[0..2] write a start and a result from seats 0..2 of a three-seat table of their own
  const h = 0xA30B, P = F2, ros = [P[0], P[1]], xr = [FX[0], FX[1], FX[2]], sc = [6100, 5200], xsc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, xsc), settle(10, h, xr, 1, xsc), settle(10, h, xr, 2, xsc)];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R).concat([[6 * MIN, S.concat(R)]]), honest: P, outside: FX, hrec: R[0], xrec: R[2] };
};
const DEFECT3 = () => {   // [13] three players; G3[2] writes his start and result from seat 0 of a one-seat table of his own
  const h = 0xA30C, P = [G3[0], G3[1]], ros = G3.slice(), own = [G3[2]], sc = [6100, 5200, 4800];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, own, 0)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, own, 0, [6100])];
  const all = S.concat(R);   // seat 2 of the room's table wrote no result on it: its absent-seat hold runs from the split
  return { key: keyOf(S[0].d), honest: P, outside: [G3[2]], hrec: R[0], xrec: R[2], steps: [[0, S], [12 * MIN, all], [MAT - 2 * MIN, all], [3 * MIN, all], [6 * MIN, all], [HOUR + MIN, all]] };
};
const DEFECT2 = () => {   // [14] bot match, two humans; K2[1] writes his start and result from his seat 1 on a table that
  //   names only him (the other seats bots): the records of [7] with the roles turned round
  const h = 0xA30D, P = [K2[0]], ros = [K2[0], K2[1], '0', '0'], own = ['0', K2[1], '0', '0'], sc = [6100, 5200, 4800, 3900];
  const S = [start(11, h, ros, 0), start(11, h, own, 1)];
  const R = [settle(11, h, ros, 0, sc), settle(11, h, own, 1, [900, 6100, 4800, 3900])];
  return { key: keyOf(S[0].d), steps: heldSteps(S, R), honest: P, outside: [K2[1]], hrec: R[0], xrec: R[1] };
};
const HONEST = () => {   // [10] control: a two-player friends' room, nobody outside
  const h = 0xA309, P = H2, ros = [P[0], P[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  return { key: keyOf(S[0].d), honest: P, steps: [[0, S], [12 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]] };
};

console.log("=== a friends' room or bot match held by results on two tables, past maturity: each table on a key of its own (Q214, Q220) ===");

// ---- [0] wiring pins ----
const FN = SRC.slice(SRC.indexOf('function applyTableSplit('), SRC.indexOf('// O93: the one-attester exception'));
{
  T('[0] called after the seat gate and before grouping, on this run\'s full-read flag; its counts kept',
    /const seatGate = applySeatGate\(recs, starts, startsPending, processed\);\n\s+RUN\.offSeat = seatGate\.n;\n(\s*\/\/[^\n]*\n)*\s+const tableSplit = applyTableSplit\(recs, starts, startsPending, processed, Date\.now\(\), shardsComplete\);\n\s+RUN\.tableSplit = tableSplit\.keys\.length; RUN\.tableOne = tableSplit\.one\.length; RUN\.tableHeld = tableSplit\.held\.length;\n\s+const gr = groupRecords\(recs, /.test(SRC));
  T('[0] gates: a friends\' room or bot match, not endless, not processed; the first split only on a full read, with no seat gate, the Q200 note STARTS_MATURITY_MS old and results on two tables',
    /if \(!pending \|\| !recs \|\| !recs\.length\) return res;/.test(FN)
    && /if \(!xpOnlyContestMt\(mt\) \|\| isEndlessMt\(mt\) \|\| processed\.has\(m\)\) continue;/.test(FN)
    && /if \(!before\) \{\n\s+if \(!complete \|\| seatGateRoster\(pending\[m\]\)\) continue;\n\s+const seen = pending\['~' \+ m\];\n\s+if \(!seen \|\| now - \(seen\.t0 \|\| 0\) < STARTS_MATURITY_MS\) continue;\n\s+if \(new Set\(g\.map\(recTable\)\)\.size < 2\) continue;/.test(FN));
  T('[0] a writer counts for the one table all his results name at his own seat; his starts do not count',
    /for \(const r of g\) \(of\[String\(r\.steamID\)\] = of\[String\(r\.steamID\)\] \|\| new Set\(\)\)\.add\(recTable\(r\)\);/.test(FN)
    && /if \(of\[w\]\.size !== 1\) continue;/.test(FN) && /if \(t === null\) continue;/.test(FN) && !/stByKey\[m\][^\n]*of\[/.test(FN));
  T('[0] sticky: a key marked split (processed), whose entry or note lent its t0, or with a table already on its key (entry or processed) moves again whatever its read, note or seat gate (Q220 review 2: the mark, not this run\'s tables)',
    /const before = processed\.has\(splitMark\(m\)\) \|\| !!\(base && base\.lent\) \|\| !!\(note && note\.lent\)\n\s+\|\| tables\.some\(\(t\) => \{ const k = splitKey\(m, t\); return processed\.has\(k\) \|\| !!pending\[k\]; \}\);/.test(FN)
    && FN.indexOf('const base = pending[m], note = pending[\'~\' + m];') >= 0 && FN.indexOf('const base = pending[m], note = pending[\'~\' + m];') < FN.indexOf('const before = '));
  T('[0] every split marks the key and the entry and note it read (their first lending time), after the records moved',
    /for \(const r of stByKey\[m\] \|\| \[\]\) \{ const t = recTable\(r\); if \(t !== null && keyOfT\[t\]\) moveToKey\(r, keyOfT\[t\]\); \}\n\s+processed\.add\(splitMark\(m\)\);\n\s+if \(base && !base\.lent\) base\.lent = now;\n\s+if \(note && !note\.lent\) note\.lent = now;/.test(FN));
  T('[0] the mark: a letter (not the split key\'s), a hash of the key alone, the seed, the type',
    /function splitMark\(m\) \{ const p = String\(m\)\.split\('_'\); return 's' \+ splitHash\(m, ''\) \+ '_' \+ p\[1\] \+ '_' \+ p\[2\]; \}/.test(SRC));
  T('[0] the key: a letter, a hash of the key and the table, the seed, the type', /function splitKey\(m, t\) \{ const p = String\(m\)\.split\('_'\); return 't' \+ splitHash\(m, t\) \+ '_' \+ p\[1\] \+ '_' \+ p\[2\]; \}/.test(SRC)
    && /function moveToKey\(r, k\) \{\n\s+if \(r\.h0 === undefined\) r\.h0 = r\.d\[3\];\n\s+r\.d = r\.d\.slice\(\);\n\s+r\.d\[3\] = k\.slice\(0, k\.indexOf\('_'\)\);/.test(SRC));
  T('[0] the entry: on the first split t0 from the original entry, else the note, none without either; a table first seen after the split from now (Q220 review); no seat gate; the original entry\'s sightings of the table\'s own starts',
    /const t0 = before \? now : \(\(base && base\.t0\) \|\| \(note && note\.t0\) \|\| 0\);/.test(FN) && /if \(processed\.has\(k\) \|\| pending\[k\] \|\| !t0\) continue;/.test(FN)
    && /const e = pending\[k\] = \{ t0, mt, roster: \{\}, settled: \[\], split: 1 \};/.test(FN)
    && /if \(base && base\.t0 === t0\) for \(const r of stByKey\[m\] \|\| \[\]\) \{\n\s+const h = pid\(String\(r\.steamID\)\);\n\s+if \(recTable\(r\) !== t \|\| !hasOwnStart\(base, h\) \|\| hasOwnStart\(e, h\)\) continue;\n\s+\(e\.started = e\.started \|\| \[\]\)\.push\(h\);\n\s+if \(base\.startSeen && base\.startSeen\[h\] != null\) \(e\.startSeen = e\.startSeen \|\| \{\}\)\[h\] = base\.startSeen\[h\];/.test(FN)
    && /if \(!p \|\| p\.synth \|\| p\.split \|\| !p\.roster\) return null;/.test(SRC));
  T('[0] the results of the counted writers and the starts that name their table move; only results are left out',
    /for \(const r of g\) \{ const t = tableOf\[String\(r\.steamID\)\]; if \(t !== undefined\) moveToKey\(r, keyOfT\[t\]\); \}/.test(FN)
    && /for \(const r of stByKey\[m\] \|\| \[\]\) \{ const t = recTable\(r\); if \(t !== null && keyOfT\[t\]\) moveToKey\(r, keyOfT\[t\]\); \}/.test(FN)
    && /const drop = g\.filter\(\(r\) => tableOf\[String\(r\.steamID\)\] === undefined\);/.test(FN) && !/starts\.length = /.test(FN));
  T('[0] the table: seat count and roster, nobody\'s for a writer not at his own seat',
    /function recTable\(r\) \{\n\s+const own = r\.roster && r\.roster\[r\.d\[5\] \| 0\];\n\s+if \(own == null \|\| String\(own\) !== String\(r\.steamID\)\) return null;[^\n]*\n\s+return \(r\.d\[8\] \| 0\) \+ '\|' \+ rosterCanon\(r\.roster\);/.test(SRC));
  T('[0] summary row', /s\('tableSplit', 0\) \+ ' \/ ' \+ s\('tableOne', 0\) \+ ' \/ ' \+ s\('tableHeld', 0\)/.test(SRC));
  T('[0] exports', typeof v.applyTableSplit === 'function' && typeof v.recTable === 'function' && typeof v.splitKey === 'function' && typeof v.applyTableMajority === 'undefined');
  T('[0] the split key of every friends\' room / bot match record on a table of its writer\'s own is among the keys seen this run (ahead of the prune of processed keys)',
    (() => {
      const b = /\n(\s*\/\/[^\n]*\n)*\s+for \(const r of recs\.concat\(starts\)\) \{\n\s+const mt = r\.d\[2\] \| 0;\n\s+if \(!xpOnlyContestMt\(mt\) \|\| isEndlessMt\(mt\)\) continue;\n\s+const t = recTable\(r\);\n\s+if \(t !== null\) seenKeys\.add\(splitKey\(r\.d\[3\] \+ '_' \+ r\.d\[4\] \+ '_' \+ r\.d\[2\], t\)\);\n\s+\}/.exec(SRC);
      return !!b && SRC.indexOf('const seenKeys = new Set(recs.concat(starts)') >= 0 && SRC.indexOf('const seenKeys = new Set(recs.concat(starts)') < b.index
        && b.index < SRC.indexOf('const prunedP = pruneProcessed(');
    })());
  T('[0] the report index keeps the match hash of a record moved to a split key', /matchIndex\.set\(\(r\.h0 !== undefined \? r\.h0 : r\.d\[3\]\) >>> 0, \{ hostSid: host \}\);/.test(SRC));
}

// ---- [1] units ----
if (typeof v.applyTableSplit !== 'function') bad('[1] applyTableSplit is not in this validate.js (the units are skipped)');
else {
  const mk = (sid, mt, h, seat, ros, magic) => { const d = rec(magic || 0xB1, mt, h, seat, 0, false, ros, ros.map(() => 0)); return { steamID: sid, d, roster: v.decodeRoster(d), shard: 's0' }; };
  const said = [];
  const quiet = (fn) => { const l = console.log, w = console.warn; said.length = 0; console.log = console.warn = (x) => said.push(String(x)); try { return fn(); } finally { console.log = l; console.warn = w; } };
  const A = SID(601), B = SID(602), X = SID(609), Y = SID(608), Z = SID(607);
  const t0 = 5e12;
  const kk = (r) => r.d[3] + '_' + r.d[4] + '_' + r.d[2];
  const call = (recs, starts, pend, o) => {
    o = o || {};
    const list = recs.map(r => Object.assign({}, r)), st = (starts || []).map(r => Object.assign({}, r));
    const res = quiet(() => v.applyTableSplit(list, st, pend, o.processed || new Set(), o.now || t0, o.complete !== false));
    return { res, pend, list, st, said: said.slice(),
      at: (sid, seat, magic) => { const r = (magic === 0xB2 ? st : list).find(x => x.steamID === sid && (x.d[5] | 0) === seat); return r ? kk(r) : '-'; },
      kept: list.map(r => r.steamID + '@' + (r.d[5] | 0)).join(',') };
  };
  const mature = (key, back) => ({ ['~' + key]: { t0: t0 - (back == null ? MAT : back), s: [], r: 0, c: 0 } });
  const room = (mt, h, outRos, outSeats, opts) => {   // A / B at seats 0 / 1, outside results (and starts) on outRos
    opts = opts || {};
    const ros = opts.ros || [A, B], key = h + '_1234_' + mt;
    const R = ros.map((s, i) => s === '0' ? null : mk(s, mt, h, i, ros)).filter(Boolean);
    const X1 = outSeats.map(([sid, seat]) => mk(sid, mt, h, seat, outRos));
    const S = ros.map((s, i) => s === '0' ? null : mk(s, mt, h, i, ros, 0xB2)).filter(Boolean).concat(outSeats.map(([sid, seat]) => mk(sid, mt, h, seat, outRos, 0xB2)));
    return { key, recs: R.concat(X1), starts: S, hk: v.splitKey(key, v.recTable(R[0])), xk: X1.length ? v.splitKey(key, v.recTable(X1[0])) : '' };
  };
  const untouched = (c, u) => c.res.n === 0 && !c.res.keys.length && !c.res.one.length && !c.res.again && c.list.every(r => kk(r) === u.key) && c.st.every(r => kk(r) === u.key);
  let u = room(10, 9101, [A, B, X], [[X, 2]]), c = call(u.recs, u.starts, mature(u.key));
  T('[1] friends\' room, one outside result past maturity: two keys, the players\' results and starts on one, his on the other, nothing left out, the key counted',
    c.res.keys.join() === u.key && c.res.n === 0 && !c.res.one.length && c.at(A, 0) === u.hk && c.at(B, 1) === u.hk && c.at(X, 2) === u.xk && u.hk !== u.xk
    && c.at(A, 0, 0xB2) === u.hk && c.at(B, 1, 0xB2) === u.hk && c.at(X, 2, 0xB2) === u.xk && c.list.length === 3, JSON.stringify(c.res));
  T('[1] ... each key gets an entry: t0 from the note (no original entry), no roster, split (no seat gate)',
    [u.hk, u.xk].every(k => c.pend[k] && c.pend[k].t0 === t0 - MAT && c.pend[k].split === 1 && !Object.keys(c.pend[k].roster).length && c.pend[k].mt === 10), JSON.stringify(c.pend));
  T('[1] ... the moved records keep the match hash (h0) and their own details untouched', c.list.every(r => r.h0 === 9101) && u.recs.every(r => r.d[3] === 9101));
  T('[1] ... logged once with the writers of each table', c.said.length === 1 && c.said[0].indexOf('table-split ' + u.key + ': results on 2 tables past the hold\'s maturity -- each table settles on a key of its own (' + u.hk + ' 2 writer(s), ' + u.xk + ' 1 writer(s)), nothing left out (Q220)') >= 0, c.said.join(' | '));
  T('[1] ... a second before maturity: nothing', untouched(call(u.recs, u.starts, mature(u.key, MAT - 1000)), u));
  T('[1] ... on an incomplete read: nothing', untouched(call(u.recs, u.starts, mature(u.key), { complete: false }), u));
  T('[1] ... with no note (never held): nothing', untouched(call(u.recs, u.starts, {}), u));
  T('[1] ... with a registered seat gate: nothing (the gate decides)', untouched(call(u.recs, u.starts, Object.assign(mature(u.key), { [u.key]: { t0: t0 - DAY, mt: 10, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [] } })), u));
  T('[1] ... once processed: nothing', untouched(call(u.recs, u.starts, mature(u.key), { processed: new Set([u.key]) }), u));
  T('[1] ... no starts state at all: nothing, no crash', untouched(call(u.recs, u.starts, null), u));
  let w = room(2, 9102, [A, B, X], [[X, 2]]);
  T('[1] a matchmade key: nothing (its contest voids)', untouched(call(w.recs, w.starts, mature(w.key)), w));
  w = room(7, 9103, [A, B, X], [[X, 2]]);
  T('[1] an endless key: nothing (its own settle)', untouched(call(w.recs, w.starts, mature(w.key)), w));
  // the original entry: its t0, and its sightings of each table's own starts
  const base = { t0: t0 - DAY, mt: 10, roster: {}, settled: [], split: 1, started: [v.pid(A), v.pid(B), v.pid(X)], startSeen: { [v.pid(B)]: 4000, [v.pid(X)]: 9000 } };
  c = call(u.recs, u.starts, Object.assign(mature(u.key), { [u.key]: base }));
  T('[1] t0 from the original entry, and its sightings of each table\'s own starts carried (who, and when): no leave wait restarts',
    c.pend[u.hk].t0 === t0 - DAY && c.pend[u.xk].t0 === t0 - DAY && c.pend[u.hk].started.join() === [v.pid(A), v.pid(B)].join() && JSON.stringify(c.pend[u.hk].startSeen) === JSON.stringify({ [v.pid(B)]: 4000 })
    && c.pend[u.xk].started.join() === v.pid(X) && JSON.stringify(c.pend[u.xk].startSeen) === JSON.stringify({ [v.pid(X)]: 9000 }) && c.pend[u.key] === base, JSON.stringify(c.pend));
  c = call(u.recs, u.starts, Object.assign(mature(u.key), { [u.key]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [] } }));
  T('[1] ... an original entry that saw no starts carries none', !c.pend[u.hk].started && !c.pend[u.hk].startSeen && c.pend[u.hk].t0 === t0 - DAY);
  c = call(u.recs, u.starts, { ['~' + u.key]: { t0: 0, s: [], r: 0, c: 0 } });
  T('[1] no t0 anywhere (a note at 0): the records move, no entry is made (the settle\'s own first sighting makes one)', c.res.keys.join() === u.key && !c.pend[u.hk] && !c.pend[u.xk] && c.at(A, 0) === u.hk);
  // sticky
  c = call(u.recs, u.starts, Object.assign({ [u.hk]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [], split: 1 } }, { [u.key]: { t0: t0 - DAY, mt: 10, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [] } }), { complete: false });
  T('[1] sticky: one of its tables has an entry -- moved again on an incomplete read, with no note, under a seat gate; counted as again, not as a split; the missing table gets its entry from now (not the original\'s day-old t0), logged',
    c.res.again === 1 && !c.res.keys.length && c.at(A, 0) === u.hk && c.at(X, 2) === u.xk && c.pend[u.xk] && c.pend[u.xk].t0 === t0 && c.pend[u.hk].t0 === t0 - DAY
    && c.said.length === 1 && c.said[0].indexOf('split before -- 1 table(s) written since on a key of their own (' + u.xk + ' 1 writer(s)), nothing left out (Q220)') >= 0, JSON.stringify(c.res) + ' ' + c.said.join(' | '));
  const both = { [u.hk]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [], split: 1 }, [u.xk]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [], split: 1 } };
  c = call(u.recs, u.starts, JSON.parse(JSON.stringify(both)), { complete: false });
  T('[1] ... every table on its key already: moved, nothing logged', c.res.again === 1 && c.at(A, 0) === u.hk && c.at(X, 2) === u.xk && !c.said.length);
  c = call(u.recs, u.starts, {}, { processed: new Set([u.hk, u.xk]) });
  T('[1] ... both processed (their entries gone): still moved (the settle skips them), no entry made', c.res.again === 1 && c.at(A, 0) === u.hk && c.at(X, 2) === u.xk && !c.pend[u.hk] && !c.pend[u.xk]);
  const late = room(10, 9101, [Y], [[Y, 0]]);
  c = call(u.recs.concat(late.recs.slice(2)), u.starts.concat(late.starts.slice(2)), Object.assign(JSON.parse(JSON.stringify(both)), { [u.key]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [] } }));
  T('[1] ... a table written since the split (an outside account\'s) settles on a key of its own on an entry from now, the others where they were (their entries untouched)', c.res.again === 1 && c.at(Y, 0) === late.xk && late.xk !== u.hk && late.xk !== u.xk
    && c.pend[late.xk] && c.pend[late.xk].t0 === t0 && c.pend[u.hk].t0 === t0 - DAY && c.pend[u.xk].t0 === t0 - DAY && c.at(A, 0) === u.hk && c.said.length === 1 && /split before -- 1 table\(s\) written since/.test(c.said[0]), c.said.join(' | '));
  c = call(u.recs.concat(late.recs.slice(2)), u.starts.concat(late.starts.slice(2)), Object.assign(JSON.parse(JSON.stringify(both)), { [u.key]: { t0: t0 - DAY, mt: 10, roster: {}, settled: [], started: [v.pid(Y)], startSeen: { [v.pid(Y)]: 4000 } } }));
  T('[1] ... nor the original entry\'s day-old sighting of that table\'s own start (it waits as a new match does; Q220 review)',
    c.at(Y, 0, 0xB2) === late.xk && !!c.pend[late.xk] && c.pend[late.xk].t0 === t0 && !c.pend[late.xk].started && !c.pend[late.xk].startSeen, JSON.stringify(c.pend[late.xk]));
  // one table, none, a writer on two tables
  w = room(10, 9106, [A, B], [[X, 1]]); c = call(w.recs, w.starts, mature(w.key));
  T('[1] a copy of the players\' result written from a player\'s seat (not at his own seat): left out, the one table on a key of its own',
    c.res.one.join() === w.key && !c.res.keys.length && c.res.n === 1 && c.kept === [A + '@0', B + '@1'].join() && c.at(A, 0) === w.hk && c.at(B, 1) === w.hk
    && c.st.filter(r => r.steamID === X).every(r => kk(r) === w.key) && c.pend[w.hk] && /one table left past the hold's maturity -- it settles on a key of its own/.test(c.said.join()), JSON.stringify(c.res));
  w = room(10, 9107, null, []); w.recs[1] = mk(B, 10, 9107, 1, [A, B]); w.recs[1].d[11] = 77;
  T('[1] every result on one table (scores apart): nothing done', untouched(call(w.recs, w.starts, mature(w.key)), w));
  w = room(10, 9120, null, []); const a2 = mk(A, 10, 9120, 0, [A, B]); a2.d[8] = 3; w.recs = [w.recs[0], a2, mk(B, 10, 9120, 0, [A, B])];
  c = call(w.recs, w.starts, mature(w.key));
  T('[1] no writer on one table of his own (one on two tables, one not at his own seat): held, nothing moved or left out', c.res.held.join() === w.key && untouched(c, w) && /no result writer on one table of his own -- held as before \(Q220\)/.test(c.said.join()));
  w = room(10, 9121, null, []); const x1 = mk(X, 10, 9121, 2, [A, B, X]), x2 = mk(X, 10, 9121, 0, [X]); w.recs = w.recs.concat([x1, x2]);
  c = call(w.recs, w.starts, mature(w.key));
  T('[1] an outside writer on two tables: both his results left out, the players\' table on a key of its own', c.res.one.join() === w.key && c.res.n === 2 && c.kept === [A + '@0', B + '@1'].join() && c.at(A, 0) === w.hk, JSON.stringify(c.res));
  w = room(10, 9105, [A, B, X], [[X, 2]]); w.starts[1] = mk(B, 10, 9105, 1, [A, B, X], 0xB2); c = call(w.recs, w.starts, mature(w.key));
  T('[1] a writer whose own start names another table counts by his result: his result on his result\'s table, his start follows its own',
    c.res.keys.join() === w.key && c.at(B, 1) === w.hk && c.at(B, 1, 0xB2) === w.xk && c.at(X, 2) === w.xk, JSON.stringify(c.res));
  w = room(11, 9108, [A, B, X, '0'], [[X, 2]], { ros: [A, B, '0', '0'] }); c = call(w.recs, w.starts, mature(w.key));
  T('[1] a bot match, the outside result from a bot seat: two keys', c.res.keys.join() === w.key && c.at(A, 0) === w.hk && c.at(X, 2) === w.xk && /_1234_11$/.test(w.hk));
  w = room(11, 9109, [A, X, '0', '0'], [[X, 1]], { ros: [A, '0', '0', '0'] }); c = call(w.recs, w.starts, mature(w.key));
  T('[1] a lone human against bots and one outside result naming him: two keys', c.res.keys.join() === w.key && c.at(A, 0) === w.hk && c.at(X, 1) === w.xk);
  w = room(10, 9110, [A, B, X, Y, Z], [[X, 2], [Y, 3], [Z, 4]]); c = call(w.recs, w.starts, mature(w.key));
  T('[1] three outside results naming the players against two players: two keys, nothing left out', c.res.keys.join() === w.key && c.res.n === 0 && c.at(A, 0) === w.hk && [X, Y, Z].every((s, i) => c.at(s, 2 + i) === w.xk));
  w = room(10, 9116, [X, Y, Z], [[X, 0], [Y, 1], [Z, 2]]); c = call(w.recs, w.starts, mature(w.key));
  T('[1] three outside results on a table of their own: two keys', c.res.keys.join() === w.key && c.at(A, 0) === w.hk && c.at(X, 0) === w.xk);
  w = room(10, 9111, null, []); w.starts.push(mk(X, 10, 9111, 2, [A, B, X], 0xB2));
  T('[1] an outside start with no result (the players\' results on one table): nothing here (the Q200 filter\'s)', untouched(call(w.recs, w.starts, mature(w.key)), w));
  // the key
  const t1 = v.recTable(u.recs[0]), t2 = v.recTable(u.recs[2]);
  T('[1] the key: a letter, then the hash of the key and the table; the seed and the type kept; the same table the same key, another table or key another',
    /^t[0-9]+_1234_10$/.test(v.splitKey(u.key, t1)) && v.splitKey(u.key, t1) === v.splitKey(u.key, t1) && v.splitKey(u.key, t1) !== v.splitKey(u.key, t2) && v.splitKey('9102_1234_10', t1) !== v.splitKey(u.key, t1));
  T('[1] no record a client writes reaches a split key (its match hash is a number)', [0, 1, -1, 0x7fffffff, -0x80000000, 9101].every(n => !/^t/.test(keyOf(rec(0xB1, 10, n, 0, 1, true, [A], [1])))));
  T('[1] the table: nobody\'s for a writer not at his own seat; the seat count and roster otherwise', v.recTable(mk(X, 10, 1, 1, [A, B])) === null && v.recTable(mk(B, 10, 1, 1, [A, B])) === t1
    && v.recTable(Object.assign(mk(B, 10, 1, 1, [A, B]), {})) !== v.recTable(Object.assign(mk(B, 10, 1, 1, [A, B, X]))));
}

// ---- [2]-[14] end to end ----
function scenario(tag, label, mkS, check) {
  const s = mkS(), rs = timeline(s.steps);
  if (s.hrec) s.hk = kOf(s.key, s.hrec);
  if (s.xrec) s.xk = kOf(s.key, s.xrec);
  console.log('  ' + tag + ' ' + label);
  check(s, rs);
}
const keyNever = (rs, s) => rs.every(r => !processedOf(r).has(s.key));
const heldUntil = (rs, s, n) => rs.slice(1, n).every(r => HELD.test(r.out)) && !ANYSPLIT.test(outOf(rs.slice(0, n)));
scenario('[2]', "a three-player friends' room, two outside accounts with a start and a result of their own", ROOM3, (s, rs) => {
  T('[2] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[2] held from the results to a minute before maturity, nothing moved yet', heldUntil(rs, s, 3) && !processedOf(rs[2]).has(s.hk));
  T('[2] past maturity: two keys (3 writers, 2 writers), nothing left out, not held', SPLIT(rs[3], s.key) === '2/2,3/0' && !HELD.test(rs[3].out), lines(rs[3]));
  T('[2] the players\' table settles then: the three players paid in that run only', processedOf(rs[3]).has(s.hk) && s.honest.every(p => paidOnlyIn(rs, p, 3)), JSON.stringify(s.honest.map(p => rs.map(r => xpOf(r, p)))));
  T('[2] the outside table waits out the absent-seat hold of the three players it names, then settles once: they get the XP of a room of their own',
    new RegExp('absent-hold ' + s.xk + ': seats 0,1,2 wrote no record').test(rs[3].out) && processedOf(rs[4]).has(s.xk) && s.outside.every(x => paidOnlyIn(rs, x, 4)), lines(rs[3]));
  T('[2] the original key is never processed; nobody counted as a leaver or flagged', keyNever(rs, s) && nobodyHurt(rs, s.honest.concat(s.outside)));
  T('[2] summary row: 0 / 0 / 0 while held, 1 / 0 / 0 in the run that splits it, 0 / 0 / 0 after', TROW(rs[2], 0, 0, 0) && TROW(rs[3], 1, 0, 0) && TROW(rs[4], 0, 0, 0), (rs[3].summary.match(/[^\n]*Q220[^\n]*/) || [''])[0]);
});
scenario('[3]', 'a bot match, two humans, the outsider with a start and a result at a bot seat', BOTS, (s, rs) => {
  T('[3] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[3] held until maturity', heldUntil(rs, s, 3));
  T('[3] past it: two keys (2 writers, 1), both humans paid in that run only', SPLIT(rs[3], s.key) === '2/1,2/0' && new RegExp('bots settle ' + s.hk + ': 2 writers').test(rs[3].out)
    && s.honest.every(p => paidOnlyIn(rs, p, 3)), lines(rs[3]));
  T('[3] he on the lone lane once the humans\' seats on his table are past their hold', lone(rs, s.xk) && s.outside.every(x => paidOnlyIn(rs, x, 4)));
  T('[3] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)) && keyNever(rs, s));
});
scenario('[4]', "the outsider copies the players' start and result, written from a player's seat", COPY, (s, rs) => {
  T('[4] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[4] held until maturity (a seat named twice)', heldUntil(rs, s, 3));
  T('[4] past it: his copy left out (not at his own seat), the players\' table on a key of its own, settled in that run (its t0 the note\'s: no pacing restart)',
    ONE(rs[3], s.key) === '2/1' && !HELD.test(rs[3].out) && !/pacing /.test(rs[3].out) && processedOf(rs[3]).has(s.hk), lines(rs[3]));
  T('[4] both players paid in that run only, he nothing', s.honest.every(p => paidOnlyIn(rs, p, 3)) && s.outside.every(x => neverPaid(rs, x)), JSON.stringify(s.honest.map(p => rs.map(r => xpOf(r, p)))));
  T('[4] summary row 0 / 1 / 0 in that run; nobody counted as a leaver or flagged', TROW(rs[3], 0, 1, 0) && TROW(rs[4], 0, 0, 0) && nobodyHurt(rs, s.honest.concat(s.outside)) && keyNever(rs, s));
});
scenario('[5]', 'a made-up result ahead of the real one, one outside account (Q80 third review)', EARLY1, (s, rs) => {
  T('[5] every run exits 0', allOk(rs, 8), outOf(rs).slice(-600));
  T('[5] held from the made-up result on, an hour after the real one and a minute before maturity too; nothing moved', [1, 2, 3, 4, 5].every(i => HELD.test(rs[i].out))
    && !ANYSPLIT.test(outOf(rs.slice(0, 6))) && !processedOf(rs[5]).has(s.hk), lines(rs[5]));
  T('[5] past maturity: two keys (the players 2, he 1), both players paid in that run only', SPLIT(rs[6], s.key) === '2/1,2/0' && processedOf(rs[6]).has(s.hk) && s.honest.every(p => paidOnlyIn(rs, p, 6)), lines(rs[6]));
  T('[5] his table has one writer: a friends\' room never settles that (lone), he nothing', new RegExp('match=' + s.xk + ': lone\\(1\\)').test(rs[7].out) && s.outside.every(x => neverPaid(rs, x)) && !processedOf(rs[7]).has(s.xk));
  T('[5] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[6]', 'two outside accounts naming the players against two players', NAME2, (s, rs) => {
  T('[6] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[6] held from the results to a minute before maturity', heldUntil(rs, s, 3));
  T('[6] past maturity: two keys (2 and 2), the players paid in that run only', SPLIT(rs[3], s.key) === '2/2,2/0' && !HELD.test(rs[3].out) && s.honest.every(p => paidOnlyIn(rs, p, 3)), lines(rs[3]));
  T('[6] the outside table past the hold of the players\' seats on it, once', s.outside.every(x => paidOnlyIn(rs, x, 4)), JSON.stringify(s.outside.map(x => rs.map(r => xpOf(r, x)))));
  T('[6] nobody counted as a leaver or flagged; summary 1 / 0 / 0 then', nobodyHurt(rs, s.honest.concat(s.outside)) && TROW(rs[3], 1, 0, 0) && TROW(rs[4], 0, 0, 0));
});
scenario('[7]', 'a lone human against bots and one outside account naming him', LONE1, (s, rs) => {
  T('[7] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[7] held until maturity', heldUntil(rs, s, 3));
  T('[7] past it: two keys (1 and 1), the human paid on the lone lane in that run only', SPLIT(rs[3], s.key) === '2/1,1/0' && lone(rs, s.hk) && s.honest.every(p => paidOnlyIn(rs, p, 3)), lines(rs[3]));
  T('[7] he on the lone lane once the human\'s seat on his table is past its hold', lone(rs, s.xk) && s.outside.every(x => paidOnlyIn(rs, x, 4)));
  T('[7] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[8]', 'an incomplete read past maturity, then a full one', PARTIAL, (s, rs) => {
  T('[8] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[8] the run that cannot read a shard moves nothing: still held', /read shard failed: shard s49 HTTP 403/.test(rs[3].out) && HELD.test(rs[3].out) && !ANYSPLIT.test(rs[3].out) && !processedOf(rs[3]).has(s.hk), lines(rs[3], /[^\n]*(Q220|Q75|read shard)[^\n]*/g));
  T('[8] the next full read splits it: both players paid there, his one-writer table nothing', SPLIT(rs[4], s.key) === '2/1,2/0' && processedOf(rs[4]).has(s.hk)
    && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => neverPaid(rs, x)), lines(rs[4]));
});
scenario('[9]', 'outside accounts outnumbering the players, three against two, naming them', OUTNUM, (s, rs) => {
  T('[9] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[9] past maturity: two keys (2 and 3), nothing left out', SPLIT(rs[3], s.key) === '2/2,3/0', lines(rs[3]));
  T('[9] the players paid on their table in that run only (Q214: their table lost, nothing)', s.honest.every(p => paidOnlyIn(rs, p, 3)), JSON.stringify(s.honest.map(x => rs.map(r => xpOf(r, x)))));
  T('[9] the outside accounts paid once on theirs, past the hold of the players\' seats on it', s.outside.every(x => paidOnlyIn(rs, x, 4)), JSON.stringify(s.outside.map(x => rs.map(r => xpOf(r, x)))));
  T('[9] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[10]', "control: an honest friends' room", HONEST, (s, rs) => {
  T('[10] every run exits 0', allOk(rs, 3), outOf(rs).slice(-600));
  const paidRun = rs.findIndex(r => processedOf(r).has(s.key));
  T('[10] settles on its own key at its first look past the pacing floor, both paid, no table-split line, summary 0 / 0 / 0', paidRun >= 1 && s.honest.every(p => xpIn(rs, p).length === 1)
    && !/table-split /.test(outOf(rs)) && rs.every(r => TROW(r, 0, 0, 0)), 'paid in run ' + paidRun);
});
scenario('[11]', 'two outside accounts with a table of their own, naming none of the players', DISJ2, (s, rs) => {
  T('[11] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[11] held from the results to a minute before maturity', heldUntil(rs, s, 3));
  T('[11] past maturity: two keys (2 and 2), no longer held (Q214: a tie, held for good)', SPLIT(rs[3], s.key) === '2/2,2/0' && !HELD.test(rs[3].out) && !HELD.test(rs[4].out), lines(rs[3]));
  T('[11] both tables settle in that run, everyone paid once', processedOf(rs[3]).has(s.hk) && processedOf(rs[3]).has(s.xk) && s.honest.concat(s.outside).every(x => paidOnlyIn(rs, x, 3)),
    JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[11] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[12]', 'three outside accounts with a table of their own, naming none of the players', DISJ3, (s, rs) => {
  T('[12] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[12] past maturity: two keys (2 and 3)', SPLIT(rs[3], s.key) === '2/2,3/0', lines(rs[3]));
  T('[12] the players paid in that run only (Q214: their table lost, nothing)', s.honest.every(p => paidOnlyIn(rs, p, 3)));
  T('[12] the outside accounts paid once, the XP of a room they could have played among themselves', s.outside.every(x => paidOnlyIn(rs, x, 3)),
    JSON.stringify(s.outside.map(x => rs.map(r => xpOf(r, x)))));
  T('[12] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[13]', "a three-player friends' room, one of them on a table of his own naming none of the others", DEFECT3, (s, rs) => {
  T('[13] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[13] held from the results to a minute before maturity (seat 0 named twice)', heldUntil(rs, s, 3));
  T('[13] past maturity: two keys (the room 2, he 1), the room\'s table holds for his seat on it', SPLIT(rs[3], s.key) === '2/1,2/0' && new RegExp('absent-hold ' + s.hk + ': seat 2 wrote no record').test(rs[3].out), lines(rs[3]));
  T('[13] the two paid past that hold in that run only (Q214: past the 1-hour leave wait), he nothing (a one-writer friends\' room table)',
    processedOf(rs[4]).has(s.hk) && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => neverPaid(rs, x)), JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[13] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[14]', 'a bot match, two humans, one of them on a table that names only him', DEFECT2, (s, rs) => {
  T('[14] every run exits 0', allOk(rs, 5), outOf(rs).slice(-600));
  T('[14] held until maturity', heldUntil(rs, s, 3));
  T('[14] past it: two keys (1 and 1)', SPLIT(rs[3], s.key) === '2/1,1/0', lines(rs[3]));
  T('[14] the other human paid on the lone lane once his seat on the room\'s table is past its hold (Q214: nothing); he on the lone lane too',
    lone(rs, s.hk) && lone(rs, s.xk) && s.honest.every(p => paidOnlyIn(rs, p, 4)) && s.outside.every(x => paidOnlyIn(rs, x, 3)),
    JSON.stringify(s.honest.concat(s.outside).map(x => rs.map(r => xpOf(r, x)))));
  T('[14] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});

if (failN) { console.log(failN + ' FAILED'); process.exit(1); }
console.log('all ok');
