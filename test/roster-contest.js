'use strict';
// Q75 (cloud audit 2026-10): on a match key the job holds no start roster for, a record written by an account that was not
// in the match no longer counts as a vote. Every honest record of a match key names the same account at every seat (the
// host's START_GAME seat map, unchanged until a rematch, and a writer sits at his own seat), so a key whose records name
// two accounts for one seat is held like an inconsistent one: nobody rated, nobody convicted from it (Q114 review: nobody
// flagged either -- an outside start record alone makes such a key). Once a start roster is registered the seat gate decides who counts instead (Q80, test/seat-gate.js); the keys left
// here are the ones without one: no start seen (rotated off, a synthetic first-sighting entry) or a start seat claimed by
// two or more accounts so often that no roster could be registered.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/leaver-own-record.js), plus the pure helpers.
//   [1] rosterContestSeats / applyRosterContest units (a registered start roster leaves the key to the seat gate)
//   [2] control: an honest 2V2 (four starts, four settles) settles as before, no contest line, nobody flagged, both
//       summary rows (Q75 / Q80) read 0
//   [3] no start seen: two losers and one outside account turn a 2V2 around (review4-q43.js part 6): not settled, no
//       points move, the true winner is no leaver, nobody flagged over two runs (Q114 review), run summary row; no
//       synthetic start entry, so nothing matures into a verdict later; at maturity the key voids from its note
//       (contest-void, Q127): processed, nothing moves, nobody convicted
//   [4] no start seen: five outside accounts take a 2V2 over (review4-q43.js part 5): not settled, the outsiders gain nothing
//   [5] outside accounts write a start at every seat (no start roster can register): the key is held, nobody rated or
//       convicted; once those rows are gone the roster registers, but the key stays held (a matchmade key contested once
//       stays held, Q127) and voids at maturity, nobody rated, flagged or convicted
//   [6] sticky (Q127, was "nothing sticky"): once the contesting rows are gone the key stays held, the honest records do
//       not settle it
//   [7] no start seen: a real quitter shielded by an outside account at his empty seat (that account's roster leaves the
//       seat empty so the self-seat sanity check passes): not settled
//   [8] a key with a registered start roster is left to the seat gate (part 6 with starts): no contest line, Q75 row 0
//   [9] wiring pins + mutation self-checks (pass removed / writer seat ignored together with the seat-layout check -> red;
//       either one alone still holds [7], since O's roster leaves his own seat empty)
//   [10] with the team-gamble accusation pass (Q43) in the tree: five outside accounts that also start at every seat (no
//        start roster) no longer charge an honest host (review4-q43.js part 3); control; pin; mutant (the pass ignores the
//        contest -> judged again). Skipped without Q43.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-contest-'));
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
const ALL = [H, V, X, Y, O, O2, O3, O4, O5, A, B, C];
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

const Q80ROW = (r, off, dis, split) => new RegExp('\\| records off their start-roster seat, not counted / start keys with a seat claimed twice / start rosters the voters split, no seat gate \\(Q80\\) \\| ' + off + ' / ' + dis + ' / ' + (split | 0) + ' \\|').test(r.summary);
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
// outside accounts that write a start record at every seat of the 2V2, agreeing among themselves
const OUTS4 = [O, O2, O3, O4];
const outStarts4 = (h) => [0, 1, 2, 3].map(s => ({ sid: OUTS4[s], d: t2start(h, s, OUTS4) }));

console.log('=== one account per seat per match key without a start roster (Q75) ===');

// ---- [1] units ----
{
  const R = (sid, seat, ros) => ({ steamID: sid, d: [0xB1, 3, 2, 1, 1, seat], roster: Object.assign({}, ros) });
  const eq = (label, got, exp) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'expect ' + JSON.stringify(exp));
  const r3 = { 0: A, 1: B, 2: C };
  eq('[1] honest copies agree', v.rosterContestSeats([R(A, 0, r3), R(B, 1, r3), R(B, 1, r3)]), []);
  eq('[1] a writer at a seat the others give to someone else', v.rosterContestSeats([R(A, 0, r3), R(O, 0, { 1: B, 2: C })]), [0]);
  eq('[1] two rosters disagree at a seat nobody writes', v.rosterContestSeats([R(A, 0, r3), R(B, 1, { 0: A, 1: B, 2: O })]), [2]);
  eq('[1] an empty seat names nobody', v.rosterContestSeats([R(A, 0, { 0: A, 1: B }), R(B, 1, r3)]), []);
  eq('[1] several seats, sorted', v.rosterContestSeats([R(H, 0, { 0: H, 1: V, 2: X, 3: Y }), R(X, 0, { 0: X, 1: Y, 2: H, 3: V })]), [0, 1, 2, 3]);
  eq('[1] nothing in, nothing out', [v.rosterContestSeats(null), v.rosterContestSeats([]), v.rosterContestSeats([{}])], [[], [], []]);
  // applyRosterContest: lists spliced, nobody flagged (Q114 review), processed / endless / registered keys untouched
  const mk = (m, recs) => recs.map(r => Object.assign({}, r, { d: [0xB1, 3, Number(m.split('_')[2]), Number(m.split('_')[0]), Number(m.split('_')[1]), r.d[5]] }));
  const bad1 = mk('1_1_2', [R(A, 0, r3), R(O, 0, { 1: B, 2: C })]), good = mk('2_1_2', [R(A, 0, r3), R(B, 1, r3)]);
  const done = mk('3_1_2', [R(A, 0, r3), R(O, 0, { 1: B, 2: C })]), endless = mk('4_1_7', [R(A, 0, r3), R(O, 0, { 1: B, 2: C })]);
  const bad2 = mk('5_1_6', [R(A, 0, r3), R(B, 1, { 0: A, 1: B, 2: O })]);
  const reg = mk('6_1_2', [R(A, 0, r3), R(O, 0, { 1: B, 2: C })]), syn = mk('7_1_2', [R(A, 0, r3), R(O, 0, { 1: B, 2: C })]);
  const gr = { groups: { '1_1_2': bad1, '2_1_2': good, '3_1_2': done, '4_1_7': endless, '5_1_6': bad2, '6_1_2': reg, '7_1_2': syn },
    consistentMatches: [{ m: '1_1_2', g: bad1 }, { m: '2_1_2', g: good }, { m: '3_1_2', g: done }, { m: '4_1_7', g: endless }, { m: '6_1_2', g: reg }, { m: '7_1_2', g: syn }],
    inconsistentGroups: [{ m: '5_1_6', g: bad2 }] };
  const pending = {
    '6_1_2': { t0: 1, mt: 2, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C) }, settled: [] },   // registered start roster: the seat gate's
    '7_1_2': { t0: 1, mt: 2, roster: {}, settled: [], synth: true },                                // synthetic first sighting: no roster
  };
  const sig = { players: {}, flagged: {} };
  const res = v.applyRosterContest(gr, [], pending, sig, new Set(['3_1_2']), 1000);
  eq('[1] applyRosterContest: contested keys', Array.from(res.contested.keys()).sort(), ['1_1_2', '5_1_6', '7_1_2']);
  eq('[1] consistent list keeps the rest (the registered key too)', gr.consistentMatches.map(c => c.m), ['2_1_2', '3_1_2', '4_1_7', '6_1_2']);
  eq('[1] inconsistent list loses the contested key', gr.inconsistentGroups.map(c => c.m), []);
  T('[1] nobody flagged, no key marked (Q114 review)', !Object.keys(sig.flagged).length && !Object.keys(sig.players).length, JSON.stringify(sig));
  T('[1] not dirty, nobody touched', res.dirty === false && res.touched.length === 0);
  const again = v.applyRosterContest({ groups: { '1_1_2': bad1 }, consistentMatches: [{ m: '1_1_2', g: bad1 }], inconsistentGroups: [] }, [], {}, sig, new Set(), 2000);
  T('[1] a second sighting flags nobody either', again.contested.size === 1 && again.dirty === false && !(sig.players[v.pid(A)] || {}).f);
  // a start record of the key counts like a settle record (a writer at his own seat)
  const st = [{ steamID: O, d: [0xB2, 3, 2, 2, 1, 2], roster: { 0: A, 1: B, 2: O } }];
  const res2 = v.applyRosterContest({ groups: { '2_1_2': good }, consistentMatches: [{ m: '2_1_2', g: good }], inconsistentGroups: [] }, st, {}, { players: {}, flagged: {} }, new Set(), 1);
  eq('[1] a start record of the key counts too', res2.contested.get('2_1_2'), [2]);
}

// ---- [2] control: an honest 2V2 ----
{
  const h = 0x7501, recs = honest4(h).concat(starts4(h));
  const { r1, r2 } = twoRuns(recs);
  T('[2] both runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-800));
  T('[2] the match settles', processedOf(r2).has(keyOf(recs[0].d)), r2.out.slice(-800));
  const up = (s) => pointsOf(r2, s).length === 1 && pointsOf(r2, s)[0] > 2500, down = (s) => pointsOf(r2, s).length === 1 && pointsOf(r2, s)[0] < 2500;
  T('[2] H and V win points, X and Y lose points', up(H) && up(V) && down(X) && down(Y), JSON.stringify([H, V, X, Y].map(s => pointsOf(r2, s))));
  T('[2] no contest or seat-gate line, nobody flagged', !Q75.test(r1.out + r2.out) && !/\(Q80\)/.test(r1.out + r2.out) && [H, V, X, Y].every(s => fOf(r2, s) === 0));
  T('[2] run summary rows read 0', /\| match keys with two accounts on one seat or two seat layouts, not settled \(Q75\) \| 0 \|/.test(r2.summary) && Q80ROW(r1, 0, 0) && Q80ROW(r2, 0, 0), r2.summary.slice(0, 400));
}

// ---- [3] no start seen: two losers and one outside account turn the 2V2 around ----
{
  const h = 0x7502, recs = part6(h), key = keyOf(recs[0].d);
  const { r1, r2 } = twoRuns(recs);
  T('[3] both runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-800));
  T('[3] not settled', !processedOf(r2).has(key));
  T('[3] no points move for anybody', anyPoints(r1) === 0 && anyPoints(r2) === 0, JSON.stringify(posts(r2, 7)));
  T('[3] the true winner V is no leaver', leavesOf(r2, V) === 0 && !/leaver LP /.test(r2.out));
  T('[3] logged with the contested seats', /two accounts named for seat\(s\) 0,1,2,3 -- roster contest, not settled \(Q75\)/.test(r1.out), (r1.out.match(/[^\n]*Q75[^\n]*/) || [''])[0]);
  T('[3] nobody flagged over two runs (Q114 review)', [H, V, X, Y, O].every(s => fOf(r2, s) === 0), JSON.stringify([H, V, X, Y, O].map(s => fOf(r2, s))));
  T('[3] run summary row reads 1', /\| match keys with two accounts on one seat or two seat layouts, not settled \(Q75\) \| 1 \|/.test(r1.summary));
  T('[3] no synthetic start entry for the held key', !pendOf(r2, key), JSON.stringify(pendOf(r2, key)));
  const r3 = runCron(boardsWith(recs), advance(r2.state, MATURE));
  T('[3] at maturity: voided from its note (contest-void, Q127), nobody convicted, nothing moves', r3.code === 0 && processedOf(r3).has(key)
    && new RegExp('contest-void ' + key + ': [^\\n]*no start roster -- void, nobody rated \\(Q127\\)').test(r3.out)
    && [H, V, X, Y, O].every(s => leavesOf(r3, s) === 0) && anyPoints(r3) === 0, r3.out.slice(-600));
}

// ---- [4] no start seen: five outside accounts take the 2V2 over ----
{
  const h = 0x7503, win1 = 1;   // X and Y (seats 2 / 3) won this one
  const recs = [0, 1, 2, 3].map(s => ({ sid: ROS[s], d: t2settle(h, s, ROS, win1) }));
  const fake = [H, V, O, O2];
  recs.push({ sid: O, d: t2settle(h, 2, fake, win1) }, { sid: O2, d: t2settle(h, 3, fake, win1) });
  for (const o of [O3, O4, O5]) recs.push({ sid: o, d: t2settle(h, 1, [H, o, O, O2], win1) });
  const { r2 } = twoRuns(recs);
  T('[4] not settled, no points move', r2.code === 0 && !processedOf(r2).has(keyOf(recs[0].d)) && anyPoints(r2) === 0, r2.out.slice(-600));
  T('[4] contest logged', Q75.test(r2.out));
}

// ---- [5] outside accounts start at every seat: no start roster registers, the key is held until their rows are gone ----
{
  const h = 0x7504, key = keyOf(t2start(h, 0, ROS));
  const recs = honest4(h).concat(starts4(h), outStarts4(h));
  const { r1, r2 } = twoRuns(recs);
  T('[5] both runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-800));
  T('[5] every start seat claimed twice: logged, no roster registered', /start-dispute [^\n]*: seat\(s\) 0,1,2,3 claimed by two or more accounts -- those claimants do not vote \(Q80\)/.test(r1.out) && !pendOf(r2, key), (r1.out.match(/[^\n]*start-dispute[^\n]*/) || [''])[0]);
  T('[5] held as a contest: not settled, no points move, nobody convicted', !processedOf(r2).has(key) && anyPoints(r1) + anyPoints(r2) === 0 && Q75.test(r1.out) && [H, V, X, Y].every(s => leavesOf(r2, s) === 0), r2.out.slice(-600));
  T('[5] summary rows: one contested key, one disputed start key', /\| match keys with two accounts on one seat or two seat layouts, not settled \(Q75\) \| 1 \|/.test(r1.summary) && Q80ROW(r1, 0, 1), (r1.summary.match(/[^\n]*\(Q7[5]\)[^\n]*|[^\n]*\(Q80\)[^\n]*/g) || []).join(" ; "));
  // the outside rows rotate off: the players' starts register now, but the dispute marked the key contested (Q127, the
  //   key's note in the starts state): it stays held one floor later too, and voids at maturity
  const clean = honest4(h).concat(starts4(h));
  const r3 = runCron(boardsWith(clean), advance(r2.state, FLOOR + 1000));
  T('[5] the outside rows gone: the players\' roster registers, the key stays held (contested once, Q127)', r3.code === 0 && pendOf(r3, key) && (pendOf(r3, key).roster || {})[0] === v.pid(H)
    && (pendOf(r3, '~' + key) || {}).c === 1 && Q75.test(r3.out) && !processedOf(r3).has(key), r3.out.slice(-600));
  const r4 = runCron(boardsWith(clean), advance(r3.state, FLOOR + 1000));
  T('[5] ... and one floor later: still held, the key does not settle, nobody rated', r4.code === 0 && Q75.test(r4.out) && !processedOf(r4).has(key) && anyPoints(r3) + anyPoints(r4) === 0, r4.out.slice(-600));
  const r5 = runCron(boardsWith(clean), advance(r4.state, MATURE));
  T('[5] ... voided at maturity: nobody rated, flagged or convicted', r5.code === 0 && processedOf(r5).has(key) && anyPoints(r5) === 0
    && [H, V, X, Y].concat(OUTS4).every(s => leavesOf(r5, s) === 0 && fOf(r5, s) === 0), r5.out.slice(-600));
}

// ---- [6] sticky (Q127; this was "nothing sticky") ----
// A matchmade key contested once stays held: X and Y can no longer keep the forged rows up while they would lose and take
//   them down to let a result they like settle (REVIEW of Q127, S1-S4)
{
  const h = 0x7505, key = keyOf(t2start(h, 0, ROS));
  const r1 = runCron(boardsWith(part6(h)));
  T('[6] run 1: contested, the key\'s note marked (Q127)', r1.code === 0 && Q75.test(r1.out) && (pendOf(r1, '~' + key) || {}).c === 1, JSON.stringify(pendOf(r1, '~' + key)));
  // X and Y overwrite their rows with what really happened, O's row rotates off
  const r2 = runCron(boardsWith(honest4(h)), advance(r1.state, FLOOR + 1000));
  const r3 = runCron(boardsWith(honest4(h)), advance(r2.state, FLOOR + 1000));
  T('[6] the honest records no longer settle the key: still held after the forged rows are gone', r2.code === 0 && r3.code === 0 && Q75.test(r2.out) && Q75.test(r3.out)
    && !processedOf(r3).has(key) && (pendOf(r3, '~' + key) || {}).c === 1, r3.out.slice(-600));
  T('[6] nobody rated or flagged', anyPoints(r2) + anyPoints(r3) === 0 && [H, V, X, Y, O].every(s => fOf(r3, s) === 0), JSON.stringify([H, V, X, Y, O].map(s => [pointsOf(r3, s), fOf(r3, s)])));
}

// ---- [7] no start seen: a real quitter shielded by an outside account at his empty seat ----
const part7 = (h) => {
  const ros = [A, B, C];
  return [{ sid: A, d: ffaSettle(h, 0, ros) }, { sid: B, d: ffaSettle(h, 1, ros) },
    { sid: O, d: ffaSettle(h, 2, [A, B, '0']) }];   // O copies the scores and sits at seat 2, leaving that seat empty in his roster
};
{
  const h = 0x7506, recs = part7(h), key = keyOf(recs[0].d);
  const { r1, r2 } = twoRuns(recs);
  T('[7] not settled: O does not sit in for C', r2.code === 0 && !processedOf(r2).has(key) && anyPoints(r2) === 0, r2.out.slice(-600));
  // the first run names the seat; from then on the key's note holds it (Q127), logged without the seat
  T('[7] contest at seat 2 (first sighting), held by the key\'s note after', /two accounts named for seat\(s\) 2 -- roster contest/.test(r1.out) && Q75.test(r2.out)
    && (pendOf(r2, '~' + key) || {}).c === 1, (r1.out.match(/[^\n]*Q75[^\n]*/) || [''])[0]);
}

// ---- [8] a registered start roster: the key is left to the seat gate ----
{
  const h = 0x7507, recs = part6(h).concat(starts4(h)), key = keyOf(recs[0].d);
  const r1 = runCron(boardsWith(recs));
  T('[8] the honest roster registers', r1.code === 0 && pendOf(r1, key) && pendOf(r1, key).roster[0] === v.pid(H), r1.out.slice(-600));
  T('[8] no contest line, Q75 row reads 0; the seat gate drops the three off-seat records', !Q75.test(r1.out)
    && /\| match keys with two accounts on one seat or two seat layouts, not settled \(Q75\) \| 0 \|/.test(r1.summary) && Q80ROW(r1, 3, 0), r1.summary.slice(0, 600));
}

// ---- [9] wiring pins + mutation self-checks ----
{
  const iG = SRC.indexOf('const seatGate = applySeatGate(recs, starts, startsPending, processed);');
  const iC = SRC.indexOf('const rcRes = applyRosterContest(gr, starts, startsPending, signals, processed, Date.now());');
  const iD = SRC.indexOf('const t2ldRes = applyTeam2LoneDissent(gr, signals, processed, Date.now(), vecOf);');
  const iS = SRC.indexOf('const startsRes = reconcileStarts(starts, groups, consistentKeys,');
  T('[9] the contest pass runs after the seat gate, before the team-gamble dissent pass (when in the tree) and the start cross-check', iG > 0 && iC > iG && (iD < 0 || iD > iC) && iS > iC);
  T('[9] contested writers go to the trust-tier candidates, signals saved', /for \(const sid of rcRes\.touched\) trustTouched\.add\(sid\);/.test(SRC) && /if \(rcRes\.dirty\) sigDirty = true;/.test(SRC));
  T('[9] run summary row', /s\('contested', 0\)/.test(SRC) && /RUN\.contested = rcRes\.contested\.size;/.test(SRC));
  T('[9] exports', typeof v.rosterContestSeats === 'function' && typeof v.applyRosterContest === 'function');
  const mutants = [
    ['contest pass removed', 'const rcRes = applyRosterContest(gr, starts, startsPending, signals, processed, Date.now());',
      'const rcRes = { contested: new Map(), dirty: false, touched: [] };', (script) => {
        const recs = part6(0x7511);
        const { r2 } = twoRuns(recs, null, script);
        return processedOf(r2).has(keyOf(recs[0].d)) || anyPoints(r2) > 0;   // [3] the forged result settles again
      }],
    ["writer's own seat ignored and the seat-layout check removed", [['    add(r.d[5] | 0, pid(String(r.steamID)));\n', ''],
      ['    if (seats.length || seatLayoutsDisagree(recsM)) { res.contested.set(m, seats); markContest(pending, m, now); }', '    if (seats.length) { res.contested.set(m, seats); markContest(pending, m, now); }']], null, (script) => {
        const recs = part7(0x7513);
        const { r2 } = twoRuns(recs, null, script);
        return processedOf(r2).has(keyOf(recs[0].d));   // [7] O sits in for C again
      }],
  ];
  // Q80 third review: O's roster leaves his own seat empty, so his record also disagrees on the seat layout -- either check
  //   alone holds [7]; only both removed lets O sit in for C
  const holdsAlone = [["writer's own seat ignored alone", [['    add(r.d[5] | 0, pid(String(r.steamID)));\n', '']]],
    ['the seat-layout check removed alone', [['    if (seats.length || seatLayoutsDisagree(recsM)) { res.contested.set(m, seats); markContest(pending, m, now); }', '    if (seats.length) { res.contested.set(m, seats); markContest(pending, m, now); }']]]];
  const build = (label, from, to) => {
    const reps = Array.isArray(from) ? from : [[from, to]];
    let src = SRC;
    for (const [a, b] of reps) {
      if (src.split(a).length !== 2) { bad('[9] ' + label + ': anchor not found exactly once'); return null; }
      src = src.replace(a, b);
    }
    const script = path.join(__dirname, '..', '.mutant-roster-contest-' + process.pid + '.js');
    fs.writeFileSync(script, src);
    return script;
  };
  for (const [label, from, to, check] of mutants) {
    const script = build(label, from, to);
    if (!script) continue;
    try {
      T('[9] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
  for (const [label, reps] of holdsAlone) {
    const script = build(label, reps);
    if (!script) continue;
    try {
      const recs = part7(0x7514), { r2 } = twoRuns(recs, null, script);
      T('[9] ' + label + ' -> [7] still held (the other check catches it)', r2.code === 0 && !processedOf(r2).has(keyOf(recs[0].d)) && anyPoints(r2) === 0, r2.out.slice(-400));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [10] with the team-gamble accusation pass (Q43) in the tree: outside accounts cannot charge a host ----
// review4-q43.js part 3: a real 2V2 [P, A, B, C], all four wrote their records (and starts), the host P's team lost.
//   Five outside accounts write refusals onto the key: two sit on the winning seats and name the host, three only vote
//   the roster. They also write a start record at every seat first, so no start roster registers (with one, the seat
//   gate would drop their records -- test/seat-gate.js). Counted per account that is 5 to 4, so the roster used to move
//   the outsiders onto the winning seats and charge the host's costly refusal; two keys with disjoint namers judged him a
//   leaver. With Q75 the key is contested (two accounts for every seat), the pass leaves it alone: no strike, no judgment.
if (typeof v.applyTeam2Accusations !== 'function') console.log('  skip  [10] no team-gamble accusation pass (Q43) in this tree');
else {
  const P = SID(31), TAG = v.T2BY_TAG;
  const reals = [[SID(32), SID(33), SID(34)], [SID(35), SID(36), SID(37)]];
  const outs = [O, O2, O3, O4, O5];
  const refuse = (h, seat, ros, named) => { const d = t2settle(h, seat, ros, 1); d[6] = 0; if (named) d.push(TAG | named); return d; };
  const key10 = (i, k) => {
    const [a, b, c] = reals[i], ros = [P, a, b, c], h = 0x7520 + i, recs = [];
    [P, a, b, c].forEach((sid, s) => recs.push({ sid, d: t2settle(h, s, ros, 1) }, { sid, d: t2start(h, s, ros) }));   // team 1 (b, c) won
    const acc = i === 0 ? [0, 1] : [2, 3];   // this key's two namers (disjoint across the keys)
    outs.slice(0, k).forEach((sid, j) => {
      const at = acc.indexOf(j), fake = [P, a, outs[acc[0]], outs[acc[1]]];
      recs.push({ sid, d: at >= 0 ? refuse(h, 2 + at, fake, 1) : refuse(h, 2, fake, 0) });
      recs.push({ sid, d: t2start(h, j % 4, fake) });   // a start at every seat: no start roster registers
    });
    return { recs, key: keyOf(recs[0].d) };
  };
  const GRACE = (v.ABSENT_GRACE_MS || 0) + 60000;
  const play10 = (k, script) => {
    let state = null, out = '';
    for (let i = 0; i < 2; i++) {
      const { recs } = key10(i, k);
      const all = [P].concat(reals[0], reals[1], outs);
      const boards = boardsWith(recs).map(b => b.name === 'points' ? Object.assign({}, b, { entries: all.map(s => ({ steamID: s, score: 2500 })) }) : b);
      for (const step of [0, FLOOR + 1000, GRACE]) {
        const r = runCron(boards, state ? advance(state, step) : null, null, script);
        if (r.code !== 0) return { bad: r.out.slice(-800) };
        state = r.state; out += r.out;
      }
      state = advance(state, 24 * 3600 * 1000);
    }
    const sg = state.SIGNALS_FILE || {}, av = Object.keys(sg.t2av || {}).filter(x => x.endsWith('|' + v.pid(P))).map(x => sg.t2av[x].v);
    return { state, out, av, leaves: (((state.LEAVERS_FILE || {})[v.pid(P)]) || {}).leaves | 0 };
  };
  const r5 = play10(5);
  T('[10] five outside accounts: runs exit 0', !r5.bad, r5.bad);
  if (!r5.bad) {
    T('[10] ... no start roster registers (every seat claimed twice)', (r5.out.match(/start-dispute [^\n]*seat\(s\) 0,1,2,3 claimed/g) || []).length >= 2, (r5.out.match(/[^\n]*start-dispute[^\n]*/) || [''])[0]);
    T('[10] ... the host is not struck or judged', !r5.av.some(x => x === 'free' || x === 'judge') && r5.leaves === 0, 'verdicts=' + JSON.stringify(r5.av) + ' leaves=' + r5.leaves);
    T('[10] ... both keys held as contested', (r5.out.match(/roster contest, not settled \(Q75\)/g) || []).length >= 2 && !/team2 accusation [^\n]*-> strike/.test(r5.out));
  }
  const r0 = play10(0);
  T('[10] control, nobody outside: both keys settle, no accusation', !r0.bad && !Q75.test(r0.out) && r0.av.length === 0 && [0, 1].every(i => (r0.state.PROCESSED_FILE || []).indexOf(key10(i, 0).key) >= 0), r0.bad || r0.out.slice(-400));
  T('[10] pin: the main path hands the accusation pass the contested keys', /startRecs: starts, contested: rcRes\.contested \}\)/.test(SRC) && /if \(hold && hold\.contested && hold\.contested\.has\(m\)\) continue;/.test(SRC));
  const from = '    if (hold && hold.contested && hold.contested.has(m)) continue;';
  if (SRC.split(from).length !== 2) bad('[10] mutant anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-roster-contest-q43-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, ''));
      const m = play10(5, script);
      T('[10] mutant: the accusation pass ignores the contest -> the host is judged again', !m.bad && m.av.indexOf('judge') >= 0 && m.leaves === 1, m.bad || ('verdicts=' + JSON.stringify(m.av) + ' leaves=' + m.leaves));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (roster-contest) ===');
process.exit(failN === 0 ? 0 : 1);
