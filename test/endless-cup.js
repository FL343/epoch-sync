'use strict';
// ============================================================
// endless-cup.js - O180 Gold Rush Cup (client knife 5.1c-1, 2026-10-18): weekly competitive boards -> weekly settle -> name marks
// ============================================================
// The companion repo's KNIFE_51_SEASON_BOARDS_PLAN (sections 0c / 4.2 / 4.2b) in cron terms: every competitive endless settle on
// the EA app id also KeepBest-writes this week's board (<ladder>_w<YYYYWW>); the first run after a week ends settles it: a family
// is HELD with >= THR_SOLO players / THR_TEAM teams, its top PODIUM places win a name mark (endless_cup_honor, one row per winner,
// worn until the next settle); a carrier row (endless_cup) tells the client this week, the thresholds, the entrants and which
// editions were held. A seedcap conviction revokes the mark of the run that won it; the place is not re-awarded.
//   [1] week math: ISO weeks across year ends, Monday 00:00 UTC boundary, round trips, editions from 2026-W47
//   [2] standings: solo per player, teams per roster set (best row, members holding a row), rows without a block, podium ranking
//   [3] verdict: thresholds, podium places (ties share, next place skips), entry cap
//   [4] marks + honor rows: best place per family, revoked out, encode / decode, upkeep plan (write once, delete stale)
//   [5] carrier + held masks + revoke + prune
//   [6] wiring pins: EA-only, every exit path, weekly twin beside the season twin, conviction path, provisioning, edition gate
//   [7] e2e over the REAL validate.js main() (offline board stub): a settle-free tick in the next week settles the cup (held /
//       not held), writes the honor rows + carrier; a current second tick writes nothing; the week after deletes the old marks;
//       a revoked winner gets no row (and loses his)
//   [8] e2e settle: a duo competitive segment writes this week's duo board (created on the fly, team block, id kept in the
//       chain memory) and the carrier counts one team
//   [9] mutation self-checks
// Usage: node test/endless-cup.js
// ============================================================
const fs = require('fs'), path = require('path');
const S = require('./lib/settle-stub.js');
for (const k of S.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const C = v.CUP;
const SID = S.SID;

// ---- [1] week math ----
console.log('-- [1] week math --');
{
  const W = (iso) => v.cupWeekId(Date.parse(iso));
  eq('[1] EA day Tue 2026-11-17 is week 2026-W47', W('2026-11-17T12:00:00Z'), 202647);
  eq('[1] Monday 00:00 UTC opens the week / Sunday 23:59:59 is the week before', [W('2026-11-16T00:00:00Z'), W('2026-11-15T23:59:59Z')], [202647, 202646]);
  eq('[1] 2026 has 53 weeks (Thu 2026-12-31 and Fri 2027-01-01 are W53; Mon 2027-01-04 is 2027-W01)', [W('2026-12-31T10:00:00Z'), W('2027-01-01T10:00:00Z'), W('2027-01-04T00:00:00Z')], [202653, 202653, 202701]);
  eq('[1] a January day in the previous ISO year (Sun 2021-01-03 = 2020-W53)', W('2021-01-03T23:00:00Z'), 202053);
  eq('[1] week start of 2026-W47 = Mon 2026-11-16 00:00 UTC', new Date(v.cupWeekStart(202647)).toISOString(), '2026-11-16T00:00:00.000Z');
  let rt = true;
  for (let t = Date.parse('2025-12-01T00:00:00Z'); t < Date.parse('2028-02-01T00:00:00Z'); t += 86400000) { const w = v.cupWeekId(t); if (v.cupWeekId(v.cupWeekStart(w)) !== w || v.cupWeekStart(w) > t || t - v.cupWeekStart(w) >= 7 * 86400000) { rt = false; break; } }
  T('[1] every day 2025-12 .. 2028-01: its week starts on or before it, less than 7 days before, and round-trips', rt);
  eq('[1] next / back across the year end', [v.cupNextWeek(202653), v.cupWeekBack(202701, 1), v.cupWeekBack(202647, 3)], [202701, 202653, 202644]);
  eq('[1] editions: W46 none, W47 = 1, W53 = 7, 2027-W01 = 8', [v.cupEdition(202646), v.cupEdition(202647), v.cupEdition(202653), v.cupEdition(202701)], [0, 1, 7, 8]);
  eq('[1] weekly board name = ladder + _w + week (a _test ladder keeps its suffix first)', [v.cupWeekBoardName('endless_comp_solo', 202647), v.cupWeekBoardName('endless_comp_duo_test', 202701)], ['endless_comp_solo_w202647', 'endless_comp_duo_test_w202701']);
}

// ---- [2] standings ----
console.log('-- [2] standings --');
const team = (sids) => [0, 0].concat(v.teamBlock(sids));
{
  const solo = v.cupStandings([{ sid: SID(1), score: 300 }, { sid: SID(2), score: 500 }, { sid: SID(3), score: 0 }], 1);
  eq('[2] solo: a group per player with a positive score, best first', solo.groups.map((g) => [g.score, g.sids]), [[500, [SID(2)]], [300, [SID(1)]]]);
  const A = SID(11), B = SID(12), Cc = SID(13), D = SID(14), N = SID(15);
  // A+B best 20 (A's row), B's own best 25 with C, D wrote with the named-only N (N holds no row)
  const rows = [{ sid: A, score: 20, det: team([A, B]) }, { sid: B, score: 25, det: team([B, Cc]) }, { sid: Cc, score: 25, det: team([B, Cc]) }, { sid: D, score: 18, det: team([D, N]) }];
  const st = v.cupStandings(rows, 2);
  eq('[2] team: a group per roster set (B+C 25, A+B 20 via A\'s row, D+N 18); n counts teams', [st.n, st.groups.map((g) => [g.score, g.sids.slice().sort()])], [3, [[25, [B, Cc].sort()], [20, [A, B].sort()], [18, [D]]]]);
  T('[2] team: a roster member holding no row on the board (named-only) is not in the group\'s sids', st.groups[2].sids.indexOf(N) < 0);
  const nb = v.cupStandings([{ sid: A, score: 9, det: [9, 0] }, { sid: B, score: 9, det: team([Cc, D]) }], 2);
  T('[2] team: a row without a block, or whose block does not hold its owner, is a group of its own', nb.n === 2 && nb.groups.every((g) => g.sids.length === 1));
  eq('[2] teamBlockSids round-trips the cron team block', v.teamBlockSids(team([A, B, Cc])), [A, B, Cc]);
  T('[2] teamBlockSids rejects a foreign magic / short block', v.teamBlockSids([0, 0, 0x55 | (1 << 8) | (2 << 16), 1, 2, 3, 4]) === null && v.teamBlockSids([0, 0, 0xD4 | (1 << 8) | (3 << 16), 1, 2]) === null);
}

// ---- [3] verdict ----
console.log('-- [3] verdict --');
const soloRows = (n, scoreOf) => Array.from({ length: n }, (_, i) => ({ sid: SID(100 + i), score: scoreOf ? scoreOf(i) : 1000 - i }));
const thr = { solo: C.THR_SOLO, team: C.THR_TEAM, podium: C.PODIUM };
{
  const under = v.cupVerdict({ 1: soloRows(C.THR_SOLO - 1) }, thr);
  T('[3] ' + (C.THR_SOLO - 1) + ' solo players: not held, no podium, entrants recorded', under.h[0] === 0 && !under.pod[1] && under.n[0] === C.THR_SOLO - 1);
  const at = v.cupVerdict({ 1: soloRows(C.THR_SOLO) }, thr);
  T('[3] ' + C.THR_SOLO + ' solo players: held, podium = the top three', at.h[0] === 1 && JSON.stringify(at.pod[1].map((e) => [e[0], e[2]])) === JSON.stringify([[1, [SID(100)]], [2, [SID(101)]], [3, [SID(102)]]]));
  const tie = v.cupVerdict({ 1: soloRows(C.THR_SOLO, (i) => (i < 2 ? 900 : 800 - i)) }, thr);
  eq('[3] a tie shares the place, the next place skips (1, 1, 3)', tie.pod[1].map((e) => e[0]), [1, 1, 3]);
  const tie2 = v.cupVerdict({ 1: soloRows(C.THR_SOLO, (i) => (i === 0 ? 990 : i < 3 ? 900 : 800 - i)) }, thr);
  eq('[3] (1, 2, 2) -> the next row is 4th, no third mark', tie2.pod[1].map((e) => e[0]), [1, 2, 2]);
  const storm = v.cupVerdict({ 1: soloRows(C.THR_SOLO, () => 500) }, thr);
  T('[3] a tie storm (everyone level) caps at MAX_ENTRIES entries', storm.pod[1].length === C.MAX_ENTRIES && storm.pod[1].every((e) => e[0] === 1));
  const teams = []; for (let i = 0; i < C.THR_TEAM; i++) { const a = SID(300 + 2 * i), b = SID(301 + 2 * i); teams.push({ sid: a, score: 500 - i, det: team([a, b]) }, { sid: b, score: 500 - i, det: team([a, b]) }); }
  const dv = v.cupVerdict({ 2: teams }, thr), dv2 = v.cupVerdict({ 2: teams.slice(2) }, thr);
  T('[3] ' + C.THR_TEAM + ' duo teams (' + teams.length + ' rows): held, the champion entry is the whole team', dv.h[1] === 1 && dv.n[1] === C.THR_TEAM && dv.pod[2][0][2].slice().sort().join() === [SID(300), SID(301)].sort().join());
  T('[3] ' + (C.THR_TEAM - 1) + ' duo teams: not held (teams count, not rows)', dv2.h[1] === 0 && dv2.n[1] === C.THR_TEAM - 1);
}

// ---- [4] marks + honor rows ----
console.log('-- [4] marks + honor rows --');
{
  const vd = { n: [40, 15, 0, 0], h: [1, 1, 0, 0], pod: { 1: [[1, 900, [SID(1)]], [2, 800, [SID(2)]], [3, 700, [SID(3)]]], 2: [[1, 600, [SID(2), SID(9)]], [2, 500, [SID(1), SID(2)]]] } };
  const mk = v.cupMarksOf(vd, [SID(3)]);
  eq('[4] marks: per family the best place, by family; a revoked winner out', mk, { [SID(1)]: [{ pc: 1, place: 1 }, { pc: 2, place: 2 }], [SID(2)]: [{ pc: 1, place: 2 }, { pc: 2, place: 1 }], [SID(9)]: [{ pc: 2, place: 1 }] });
  const det = v.cupHonorEncode(202647, mk[SID(1)]);
  eq('[4] honor row details [magic | ver << 8, week, (pc << 8 | place) ...]', det, [C.HONOR_MAGIC | (C.VER << 8), 202647, (1 << 8) | 1, (2 << 8) | 2]);
  eq('[4] honor decode', v.cupHonorDecode(202647, det), { week: 202647, marks: [{ pc: 1, place: 1 }, { pc: 2, place: 2 }] });
  T('[4] honor decode rejects another magic / version 0', v.cupHonorDecode(1, [0xEC, 202647, 257]) === null && v.cupHonorDecode(1, [C.HONOR_MAGIC, 202647, 257]) === null);
  const existing = {
    [SID(1)]: { s: 202647, det: det },                                                  // current -> kept
    [SID(2)]: { s: 202646, det: v.cupHonorEncode(202646, [{ pc: 1, place: 1 }]) },     // last week's row of a winner -> deleted + rewritten
    [SID(8)]: { s: 202646, det: v.cupHonorEncode(202646, [{ pc: 3, place: 3 }]) },     // last week's row, no mark now -> deleted
  };
  const plan = v.cupHonorPlan(existing, mk, 202647, { [SID(9)]: 1 });
  eq('[4] upkeep: stale rows deleted, a current row kept, an absent row written once (one already written this week is not written back)', [plan.deletes.sort(), plan.keep, plan.writes.map((w) => w.sid)], [[SID(2), SID(8)].sort(), [SID(1)], [SID(2)]]);
}

// ---- [5] carrier + held masks + revoke + prune ----
console.log('-- [5] carrier + held masks + revoke + prune --');
{
  const cup = { s: 202648, w: { 202647: { n: [40, 3, 0, 0], h: [1, 0, 0, 0], pod: {} }, 202648: { n: [45, 16, 0, 0], h: [1, 1, 0, 0], pod: {} } } };
  eq('[5] held masks relative to week 202649 (bit 0 = 202648, bit 1 = 202647)', v.cupHeldMasks(cup, 202649), [3, 1, 0, 0]);
  const det = v.cupCarrierEncode({ week: 202649, thrSolo: 40, thrTeam: 15, podium: 3, n: [12, 2, 0, 1], held: [3, 1, 0, 0], settled: 202648 });
  eq('[5] carrier details', det, [C.CARRIER_MAGIC | (C.VER << 8), 202649, 40, 15, 3, 12, 2, 0, 1, 3, 1, 0, 0, 202648]);
  const dec = v.cupCarrierDecode(202649, det);
  T('[5] carrier decode round-trips', dec && dec.week === 202649 && dec.thrSolo === 40 && dec.thrTeam === 15 && dec.podium === 3 && dec.n.join() === '12,2,0,1' && dec.held.join() === '3,1,0,0' && dec.settled === 202648);
  T('[5] carrier decode rejects a short row / another magic', v.cupCarrierDecode(1, det.slice(0, 13)) === null && v.cupCarrierDecode(1, [0xEC].concat(det.slice(1))) === null);
  const cv = { s: 202647, w: { 202647: { h: [1, 1, 0, 0], pod: { 1: [[1, 900, [SID(1)]], [2, 800, [SID(2)]]], 2: [[1, 600, [SID(1), SID(5)]]] } } } };
  eq('[5] revoke: only the entry carrying exactly the convicted score, only the convicted seats', v.cupRevoke(cv, 1, 900, [SID(1), SID(2)]), [[202647, SID(1)]]);
  T('[5] revoke: the team mark of the same player (other score) stays; a second revoke is a no-op', JSON.stringify(cv.w[202647].rv) === JSON.stringify([SID(1)]) && v.cupRevoke(cv, 1, 900, [SID(1)]).length === 0);
  const pr = { w: { 202630: {}, 202640: {}, 202647: {} }, wb: { 202630: { 1: 5 }, 202647: { 1: 6 } } };
  const nPr = v.pruneCup(pr, 202648);
  T('[5] prune keeps the last KEEP_WEEKS weeks (verdicts + weekly board ids)', nPr === 1 && !pr.w[202630] && pr.w[202640] && pr.w[202647] && !pr.wb[202630] && pr.wb[202647]);
}

// ---- [6] wiring pins ----
console.log('-- [6] wiring pins --');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
{
  T('[6] cup boards provisioned on the EA app (trusted) at the tail of the up-front list', /\[ENDLESS_CUP_LB, true\], \[ENDLESS_CUP_HONOR_LB, true\]\]\) \{/.test(SRC));
  T('[6] the playtest / demo board plan does not provision the cup (EA only)', !/ENDLESS_CUP|_w\d/.test(SRC.slice(SRC.indexOf('function ptBoardPlan('), SRC.indexOf('return { create, forbidden };'))));
  T('[6] the upkeep returns early on the channel twins (PT_MODE)', /const maintainCup = async \(st, counts\) => \{\n    if \(PT_MODE \|\| !st\) return false;/.test(SRC));
  T('[6] every exit path runs the upkeep: two settle-free returns (shared loaded chain memory, saved when changed) + the main path (saved again)', (SRC.match(/const st0 = loadSolo\(\); await maintainRating\(st0, new Set\(\)\); if \(await maintainCup\(st0, null\) && APPLY_MMR\) saveSolo\(st0, nowMs\);/g) || []).length === 2 && /if \(await maintainCup\(soloState, cupCounts\)\) saveSolo\(soloState, nowMs\);/.test(SRC));
  T('[6] weekly reads only on the EA app and from edition 1', /if \(!PT_MODE && cupEdition\(cupWeekNow\) >= 1\) \{/.test(SRC) && /const cupWeekPut = \(f, sid, packed, w\) => \{\n    if \(!cupWeekOk \|\| PT_MODE\) return;/.test(SRC));
  T('[6] solo competitive lane: the weekly twin right after the season twin (same season gate)', /changedCompSeason\[sid\] = \{ s: packed, ts: f\.score \| 0, build: f\.build >>> 0 \};[^\n]*\n      if \(\(f\.seasonId \| 0\) === \(seasonId \| 0\)\) cupWeekPut\(null, sid, packed, \{ s: packed, ts: f\.score \| 0, build: f\.build >>> 0 \}\);/.test(SRC));
  T('[6] team competitive lane: the weekly twin right after the season twin, carrying the roster (team block)', /fam\.seasonChanged\[sid\] = \{ s: packed, ts: teamT, build: f\.build >>> 0, team: rosterSids \};[^\n]*\n            if \(\(t\.seasonId \| 0\) === \(seasonId \| 0\)\) cupWeekPut\(fam, sid, packed, \{ s: packed, ts: teamT, build: f\.build >>> 0, team: rosterSids \}\);/.test(SRC));
  T('[6] the weekly rows go through ladderDetails (team block like every team row)', /leaderboardid: bid, steamid: sid, score: w\.s, scoremethod: 'ForceUpdate', format: 'json' \}, ladderDetails\(w\)\);\n      const okFlag[^\n]*\n      if \(!okFlag\) ghWarn\('write ' \+ name/.test(SRC));
  T('[6] a conviction deletes this week\'s row (correction targets) and earlier weeks\' rows, and revokes the mark', /\[compWeekId, compWeekBest, 'solo-comp-week'\]/.test(SRC) && /\[famC\.weekId, famC\.weekBest, famC\.low \+ '-comp-week'\]/.test(SRC) && /for \(const \[wk, sidR\] of cupRevoke\(soloState\.cup, pcC, packedC, sidsC\)\)/.test(SRC));
  T('[6] the weekly board id is kept in the chain memory when the week\'s first write creates it', /\(soloState\.cup\.wb\[cupWeekNow\] = soloState\.cup\.wb\[cupWeekNow\] \|\| \{\}\)\[pc\] = bid;/.test(SRC));
  T('[6] run summary row', /Gold Rush Cup \(O180\): settled \/ honor rows written \/ deleted \/ carrier/.test(SRC));
  T('[6] the threshold override is honoured only with the _test cup boards (local end-to-end)', /if \(\/_test\$\/\.test\(ENDLESS_CUP_LB\) && \/_test\$\/\.test\(ENDLESS_CUP_HONOR_LB\)\) \{\n  if \(process\.env\.CUP_THR_SOLO\)/.test(SRC) && C.THR_SOLO === 40 && C.THR_TEAM === 15);
  T('[6] board names keep the env-default form the client lockstep reads', /const ENDLESS_CUP_LB = process\.env\.ENDLESS_CUP_LB \|\| 'endless_cup';/.test(SRC) && /const ENDLESS_CUP_HONOR_LB = process\.env\.ENDLESS_CUP_HONOR_LB \|\| 'endless_cup_honor';/.test(SRC));
}

// ---- e2e harness ----
const BOARD = { cp: 8, compSolo: 14, compDuo: 16, compTrio: 13, compQuad: 17, cup: 50, honor: 51, vgate: 40, wSolo: 60, wDuo: 61 };
const CARRIER = SID(777);
function world(rows, extra) {
  const b = S.shardBoards(rows || [], [
    { id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: BOARD.cp, name: 'cp_bank', entries: [SID(1), SID(2)].map((s) => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compSolo, name: 'endless_comp_solo', entries: [] }, { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compQuad, name: 'endless_comp_quad', entries: [] },
    { id: BOARD.vgate, name: 'version_gate', entries: [{ steamID: CARRIER, score: 2026100101 }] },
  ]);
  return b.concat(extra || []);
}
const NOW_W48 = '2026-11-24T12:00:00Z', NOW_W49 = '2026-12-02T12:00:00Z', NOW_W47 = '2026-11-20T12:00:00Z';
const run = (boards, files, env) => S.runCron(boards, files, Object.assign({ SEASON_NOW: NOW_W48 }, env || {}), null, 'endless-cup');
const setTo = (r, id) => S.setPosts(r, id);
const delTo = (r, id) => r.posts.filter((p) => /DeleteLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(p.body));
const field = (p, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(p.body); return m ? decodeURIComponent(m[1]) : null; };
const rowsAsEntries = (rows) => rows.map((r) => ({ steamID: r.sid, score: r.score, details: r.det || [r.score, 0] }));
function duoTeams(n) { const out = []; for (let i = 0; i < n; i++) { const a = SID(300 + 2 * i), b = SID(301 + 2 * i); out.push({ sid: a, score: 500 - i, det: [500 - i, 0].concat(v.teamBlock([a, b])) }, { sid: b, score: 500 - i, det: [500 - i, 0].concat(v.teamBlock([a, b])) }); } return out; }

// ---- [7] e2e: settle-free ticks settle the cup ----
console.log('-- [7] e2e: weekly settle on settle-free ticks --');
{
  const wk = 202647;
  const weekBoards = (soloN, teamN) => [{ id: BOARD.wSolo, name: 'endless_comp_solo_w' + wk, entries: rowsAsEntries(soloRows(soloN)) }, { id: BOARD.wDuo, name: 'endless_comp_duo_w' + wk, entries: rowsAsEntries(duoTeams(teamN)) }];
  const cupBoards = (honorRows, carrierRows) => [{ id: BOARD.cup, name: 'endless_cup', entries: carrierRows || [] }, { id: BOARD.honor, name: 'endless_cup_honor', entries: honorRows || [] }];
  const solo0 = { runs: {}, wait: {}, ms: {}, held: {}, hist: {}, cup: { s: 202646, w: {} } };
  const r1 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards())), { SOLO_FILE: solo0 });
  T('[7] W48 settle-free tick exits 0', r1.code === 0, r1.out.slice(-600));
  const cup1 = (r1.state.SOLO_FILE || {}).cup || {};
  T('[7] week 2026-W47 (edition 1) settled: solo ' + C.THR_SOLO + ' players + duo ' + C.THR_TEAM + ' teams both held', cup1.s === wk && cup1.w[wk] && cup1.w[wk].h.join('') === '1100' && cup1.w[wk].n.join() === [C.THR_SOLO, C.THR_TEAM, 0, 0].join(), JSON.stringify(cup1).slice(0, 400));
  const hw = setTo(r1, BOARD.honor), byS = {};
  for (const p of hw) byS[field(p, 'steamid')] = { score: Number(field(p, 'score')), det: S.postDetails(p.body) };
  const expW = [SID(100), SID(101), SID(102), SID(300), SID(301), SID(302), SID(303), SID(304), SID(305)];
  T('[7] honor rows: solo top three + the three duo champion / runner-up / third teams (both members), score = the settled week', hw.length === expW.length && expW.every((s) => byS[s] && byS[s].score === wk), JSON.stringify(Object.keys(byS)));
  T('[7] honor details: the solo champion [magic, week, 1:1], the duo third-place pair [.., 2:3]', JSON.stringify(byS[SID(100)] && byS[SID(100)].det) === JSON.stringify(v.cupHonorEncode(wk, [{ pc: 1, place: 1 }])) && JSON.stringify(byS[SID(305)] && byS[SID(305)].det) === JSON.stringify(v.cupHonorEncode(wk, [{ pc: 2, place: 3 }])));
  T('[7] the written rows are remembered for the week (hw.ok)', cup1.hw && cup1.hw.w === wk && expW.every((s) => cup1.hw.ok[s] === 1));
  const cw = setTo(r1, BOARD.cup);
  const cdec = cw.length ? v.cupCarrierDecode(Number(field(cw[0], 'score')), S.postDetails(cw[0].body)) : null;
  T('[7] carrier published once on the version_gate account: week W48, thresholds, entrants 0 (no settle this run), held bits for W47, settled W47', cw.length === 1 && field(cw[0], 'steamid') === CARRIER && cdec && cdec.week === 202648 && cdec.thrSolo === C.THR_SOLO && cdec.thrTeam === C.THR_TEAM && cdec.podium === C.PODIUM && cdec.n.join() === '0,0,0,0' && cdec.held.join() === '1,1,0,0' && cdec.settled === wk, JSON.stringify(cdec));
  // second tick: rows current, carrier current -> nothing written
  const honorNow = expW.map((s) => ({ steamID: s, score: wk, details: byS[s].det }));
  const carrierNow = [{ steamID: CARRIER, score: 202648, details: S.postDetails(cw[0].body) }];
  const r2 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards(honorNow, carrierNow))), { SOLO_FILE: r1.state.SOLO_FILE });
  T('[7] second tick, everything current: no honor write / delete, carrier not republished, no second settle', r2.code === 0 && setTo(r2, BOARD.honor).length === 0 && delTo(r2, BOARD.honor).length === 0 && setTo(r2, BOARD.cup).length === 0 && !/cup: settled week/.test(r2.out));
  // the week after: W48 had no boards -> settled not held, W47 marks deleted
  const r3 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards(honorNow, carrierNow))), { SOLO_FILE: r2.state.SOLO_FILE || r1.state.SOLO_FILE }, { SEASON_NOW: NOW_W49 });
  const cup3 = (r3.state.SOLO_FILE || {}).cup || {};
  T('[7] W49: week W48 settled not held (no board), every W47 mark deleted, nothing written', r3.code === 0 && cup3.s === 202648 && cup3.w[202648] && cup3.w[202648].h.join('') === '0000' && delTo(r3, BOARD.honor).length === expW.length && setTo(r3, BOARD.honor).length === 0, r3.out.split('\n').filter((l) => /cup/.test(l)).join(' | '));
  const c3 = setTo(r3, BOARD.cup), c3d = c3.length ? v.cupCarrierDecode(Number(field(c3[0], 'score')), S.postDetails(c3[0].body)) : null;
  T('[7] W49 carrier: held bits shift (bit 1 = W47), settled W48', c3d && c3d.week === 202649 && c3d.held.join() === '2,2,0,0' && c3d.settled === 202648, JSON.stringify(c3d));
  // under the threshold: not held, no solo marks
  const r4 = run(world([], weekBoards(C.THR_SOLO - 1, C.THR_TEAM - 1).concat(cupBoards())), { SOLO_FILE: solo0 });
  const cup4 = (r4.state.SOLO_FILE || {}).cup || {};
  T('[7] ' + (C.THR_SOLO - 1) + ' players / ' + (C.THR_TEAM - 1) + ' teams: the edition is not held, no honor row', r4.code === 0 && cup4.w[wk] && cup4.w[wk].h.join('') === '0000' && setTo(r4, BOARD.honor).length === 0);
  // a revoked winner: his row deleted, nobody promoted
  const soloRv = JSON.parse(JSON.stringify(r1.state.SOLO_FILE));
  soloRv.cup.w[wk].rv = [SID(100)];
  const r5 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards(honorNow, carrierNow))), { SOLO_FILE: soloRv });
  T('[7] a revoked champion: his row deleted, no new row for the fourth (not re-awarded)', r5.code === 0 && delTo(r5, BOARD.honor).map((p) => field(p, 'steamid')).join() === SID(100) && setTo(r5, BOARD.honor).length === 0);
  // channel twin: nothing at all
  const r6 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards())), { SOLO_FILE: solo0 }, { PT_MODE: '1' });
  T('[7] PT_MODE (demo / playtest job): no cup settle, no honor / carrier write', !/cup: settled week/.test(r6.out) && setTo(r6, BOARD.honor).length === 0 && setTo(r6, BOARD.cup).length === 0);
  // first run ever (no cup state): the week before this one is settled
  const r7 = run(world([], weekBoards(C.THR_SOLO, C.THR_TEAM).concat(cupBoards())), { SOLO_FILE: { runs: {}, wait: {}, ms: {}, held: {}, hist: {} } });
  T('[7] first run without cup state settles last week (W47) and writes its marks', r7.code === 0 && ((r7.state.SOLO_FILE || {}).cup || {}).s === wk && setTo(r7, BOARD.honor).length === expW.length);
  // a week before edition 1: settled empty without reading
  const r8 = run(world([], cupBoards()), { SOLO_FILE: { runs: {}, wait: {}, ms: {}, held: {}, hist: {} } }, { SEASON_NOW: NOW_W47 });
  T('[7] W47 itself: W46 settled empty (edition 0), carrier for edition 1 published, no honor row', r8.code === 0 && ((r8.state.SOLO_FILE || {}).cup || {}).s === 202646 && setTo(r8, BOARD.honor).length === 0 && setTo(r8, BOARD.cup).length === 1);
}

// ---- [8] e2e settle: a duo competitive segment writes this week's duo board ----
console.log('-- [8] e2e: duo segment -> weekly board --');
{
  const SEED = 9;
  function rec7(hash, seat, ros, sd, ed, flags) {
    const pc = ros.length;
    const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, pc, 900];
    for (let i = 0; i < pc; i++) d.push([400, 300][i]);
    d.push(0);
    for (const s of ros) { const p = S.sidPair(s); d.push(p[0], p[1]); }
    d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
    return d;
  }
  function start7(hash, seat, ros) {
    const pc = ros.length;
    const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
    for (let i = 0; i < pc; i++) d.push(0);
    d.push(0);
    for (const s of ros) { const p = S.sidPair(s); d.push(p[0], p[1]); }
    return d;
  }
  const ros = [SID(1), SID(2)];
  const rows = ros.map((sid, i) => ({ sid, d: start7(0x5a01, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(0x5a01, i, ros, 0, 5, attest.SEG_COMP) })));
  const solo0 = { runs: {}, wait: {}, ms: {}, held: {}, hist: {}, cup: { s: 202646, w: {} } };
  const boards = world(rows, [{ id: BOARD.cup, name: 'endless_cup', entries: [] }, { id: BOARD.honor, name: 'endless_cup_honor', entries: [] }]);
  const r1 = run(boards, { SOLO_FILE: solo0 }, { SEASON_NOW: NOW_W47 });
  const adv = (state, ms) => { const f = S.advance(state, ms); const so = f.SOLO_FILE; if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms; return f; };
  const r2 = run(boards, adv(r1.state, 10 * 60000), { SEASON_NOW: NOW_W47 });
  T('[8] the duo segment settles (paced first, ten minutes later)', r1.code === 0 && r2.code === 0 && /endless-comp settle/.test(r2.out), r2.out.slice(-500));
  const created = r2.posts.filter((p) => /FindOrCreateLeaderboard/.test(p.url) && /name=endless_comp_duo_w202647(&|$)/.test(p.body));
  T('[8] this week\'s duo board created on the fly (trusted writes)', created.length === 1 && /onlytrustedwrites=1/.test(created[0].body));
  const wbId = (((r2.state.SOLO_FILE || {}).cup || {}).wb || {})[202647];
  const wid = wbId && wbId[2];
  const wrows = wid ? setTo(r2, wid) : [];
  T('[8] its id is kept in the chain memory, both writers\' rows written with the team block', !!wid && wrows.length === 2 && wrows.every((p) => JSON.stringify(v.teamBlockSids(S.postDetails(p.body))) === JSON.stringify(ros)), JSON.stringify(wbId));
  const cw = setTo(r2, BOARD.cup), cd = cw.length ? v.cupCarrierDecode(Number(field(cw[cw.length - 1], 'score')), S.postDetails(cw[cw.length - 1].body)) : null;
  T('[8] the carrier counts this week\'s entrants: one duo team', cd && cd.week === 202647 && cd.n.join() === '0,1,0,0', JSON.stringify(cd));
  const r0 = run(boards, adv(r1.state, 10 * 60000), { SEASON_NOW: '2026-11-10T12:00:00Z' });
  T('[8] before edition 1 (W46): the segment settles but no weekly board is created', r0.code === 0 && /endless-comp settle/.test(r0.out) && !r0.posts.some((p) => /FindOrCreateLeaderboard/.test(p.url) && /_w2026/.test(p.body)));
}

// ---- [9] mutation self-checks ----
console.log('-- [9] mutation self-checks --');
{
  const c0 = C.THR_SOLO;
  C.THR_SOLO = c0 + 1;
  T('[9] raising THR_SOLO un-holds the ' + c0 + '-player edition', v.cupVerdict({ 1: soloRows(c0) }, { solo: C.THR_SOLO, team: C.THR_TEAM, podium: C.PODIUM }).h[0] === 0);
  C.THR_SOLO = c0;
  const f0 = C.FIRST_WEEK;
  C.FIRST_WEEK = 202648;
  T('[9] moving FIRST_WEEK moves edition 1', v.cupEdition(202647) === 0 && v.cupEdition(202648) === 1);
  C.FIRST_WEEK = f0;
  T('[9] restored', v.cupEdition(202647) === 1);
  T('[9] the podium-steps knob is off by default (fixed top three, user call 10-18)', Array.isArray(C.PODIUM_STEPS) && C.PODIUM_STEPS.length === 0 && v.cupPodiumFor(5000, C.PODIUM) === 3);
  C.PODIUM_STEPS = [[40, 5]];
  const wide = v.cupVerdict({ 1: soloRows(C.THR_SOLO) }, { solo: C.THR_SOLO, team: C.THR_TEAM, podium: C.PODIUM });
  T('[9] knob on ([[40, 5]]): a 40-player edition marks the top five', wide.pod[1].length === 5 && wide.pod[1][4][0] === 5);
  C.PODIUM_STEPS = [];
}

console.log(failN ? ('FAIL (endless-cup) ' + failN) : 'ALL PASS (endless-cup)');
process.exit(failN ? 1 : 0);
