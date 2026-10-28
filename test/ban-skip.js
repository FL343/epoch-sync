'use strict';
// ============================================================
// ban-skip.js - full bans kept off the Gold Rush Cup podium, the endless tier cuts and the composite ladders (cloud audit Q338)
// ============================================================
// The reconcile never looked at the ban gate board (ban_board, written by sanctions.js). A fully banned account kept
//   - a place on the weekly cup podium and its name mark, the honest fourth losing the third place it should move up to (R2-B2-52;
//     the weekly boards change name every week, so the sanctions exile list cannot reach them);
//   - its rating row inside the tier-cut percentiles: a banned cheater on top pushed the grandmaster cut out of every honest
//     player's reach;
//   - a composite row: the sanctions job runs in its own lane, and a reconcile run that read his per-size bests before the
//     sanctions run moved his rows and the composite board after it wrote his composite row back for good.
// Now the reconcile reads the ban board once per run (by name off the listing, never creating it) and leaves full bans out --
// without lowering any honest number (architecture rule 10): an edition's entrant count still counts every row, a cut is the
// lower of the cut with and without the banned players, and a failed ban read falls back to what the job did before.
//   [1] the ban row: banRowFull agrees with sanctions.js (banDetails, ACT_*, expiredSids) and the client gate (unknown action = full)
//   [2] cup (pure): solo, a tie, a team with an honest member, an all-banned team, the held count, no ban = the old verdict, fuzz
//   [3] tier cuts (pure): banned on top lowers a cut, banned at the bottom leaves it, no ban = the old cuts, fuzz (no tier drops)
//   [4] e2e cup over the REAL main(): banned champion + team; a winner banned after the settle loses his row and gets it back on
//       an unban; a failed ban read waits inside CUP_BAN_WAIT_MS and settles as before past it
//   [5] e2e tier cuts: banned on top; a failed ban read publishes the cuts over everyone
//   [6] e2e composite: no row for a banned account, a stray one deleted, an honest one untouched; a failed ban read = as before
//   [7] wiring pins + mutation self-checks (each mutation of validate.js turns a check of [2]-[6] red)
// Usage: node test/ban-skip.js
// ============================================================
const fs = require('fs'), path = require('path'), os = require('os');
const S = require('./lib/settle-stub.js');
for (const k of S.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // the child runs use 's' too, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const s = require(path.join(__dirname, '..', 'sanctions.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const eq = (label, got, exp) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'EXPECT ' + JSON.stringify(exp));
const SID = S.SID;
const C = v.CUP;
const NOW_MS = Date.parse('2026-11-24T12:00:00Z');
let seed = 0x5338;
const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };

// ---- [1] the ban row ----
console.log('-- [1] the ban row (sanctions.js writes it; the reconcile and the client read it) --');
{
  T('[1] one board name: sanctions.js BAN_LB is validate.js BAN_LB', s.BAN_LB === v.BAN_LB && v.BAN_LB === (process.env.BAN_LB || 'ban_board'));
  T('[1] the matchmaking-only code is sanctions.js ACT_MM', v.BAN_ACT_MM === s.ACT_MM && s.ACT_FULL !== s.ACT_MM);
  const minNow = Math.floor(NOW_MS / 60000);
  const full = (expMin, act) => v.banRowFull(1, s.banDetails(expMin, act, ''), NOW_MS);
  eq('[1] full ban: permanent / ahead / just expired / long expired', [full(0, s.ACT_FULL), full(minNow + 60, s.ACT_FULL), full(minNow, s.ACT_FULL), full(minNow - 600, s.ACT_FULL)], [true, true, false, false]);
  eq('[1] matchmaking-only: permanent / ahead -> not a full ban (it keeps every ranking)', [full(0, s.ACT_MM), full(minNow + 60, s.ACT_MM)], [false, false]);
  eq('[1] a row from before the action field ([expiry] / no details) and an unknown code are full bans (the client gate reads them the same way)', [v.banRowFull(1, [0], NOW_MS), v.banRowFull(1, [], NOW_MS), v.banRowFull(1, null, NOW_MS), v.banRowFull(1, [0, 7], NOW_MS)], [true, true, true, true]);
  eq('[1] a row with score 0 is no ban (sanctions writes score 1; expiredSids skips score <= 0 too)', v.banRowFull(0, [0, 1], NOW_MS), false);
  // expiry agrees with the sweep: a full row is "not a full ban" exactly when sanctions.js expiredSids would lift it
  let agree = true;
  for (let i = 0; i < 400; i++) {
    const expMin = [0, minNow - 1 - rnd(1000), minNow, minNow + 1 + rnd(1000)][rnd(4)];
    const ent = { steamID: SID(1 + i), score: 1, detailData: v.encodeDetails(s.banDetails(expMin, s.ACT_FULL, '')) };
    const lifted = s.expiredSids([ent], NOW_MS).length === 1;
    if (lifted === v.fullBanSet([ent], NOW_MS).has(ent.steamID)) agree = false;
  }
  T('[1] 400 random full rows: banned here <=> not lifted by the sanctions expiry sweep (same clock test)', agree);
  const set = v.fullBanSet([
    { steamID: SID(1), score: 1, detailData: v.encodeDetails(s.banDetails(0, s.ACT_FULL, '')) },
    { steamID: SID(2), score: 1, detailData: v.encodeDetails(s.banDetails(0, s.ACT_MM, '')) },
    { steamID: SID(3), score: 1, detailData: '' },
    { steamID: SID(4), score: 1, detailData: v.encodeDetails(s.banDetails(minNow - 5, s.ACT_FULL, '')) },
  ], NOW_MS);
  eq('[1] fullBanSet over raw board entries (detailData hex): full, legacy kept; matchmaking-only, expired left out', [...set].sort(), [SID(1), SID(3)].sort());
  T('[1] the gate board is on the sanctions keep list (a full ban never exiles the gate row itself)', !!s.EXILE_KEEP.BAN_LB && s.keepBoardNames().has(v.BAN_LB) && s.exileSources(9, []).indexOf(v.BAN_LB) < 0);
}

// ---- [2] cup (pure) ----
console.log('-- [2] cup podium without full bans (pure) --');
const thr = { solo: C.THR_SOLO, team: C.THR_TEAM, podium: C.PODIUM };
const soloRows = (n, scoreOf) => Array.from({ length: n }, (_, i) => ({ sid: SID(100 + i), score: scoreOf ? scoreOf(i) : 1000 - i, det: [] }));
const duoRows = (n, scoreOf) => { const out = []; for (let i = 0; i < n; i++) { const a = SID(300 + 2 * i), b = SID(301 + 2 * i), sc = scoreOf ? scoreOf(i) : 500 - i; out.push({ sid: a, score: sc, det: [sc, 0].concat(v.teamBlock([a, b])) }, { sid: b, score: sc, det: [sc, 0].concat(v.teamBlock([a, b])) }); } return out; };
const podOf = (vd, pc) => ((vd.pod || {})[pc] || []).map((e) => [e[0], e[2].slice().sort()]);
{
  const rows = soloRows(C.THR_SOLO);
  const old = v.cupVerdict({ 1: rows }, thr);
  T('[2] no ban set (undefined / null / empty) = the verdict before Q338', JSON.stringify(v.cupVerdict({ 1: rows }, thr, null)) === JSON.stringify(old) && JSON.stringify(v.cupVerdict({ 1: rows }, thr, new Set())) === JSON.stringify(old));
  const nw = v.cupVerdict({ 1: rows }, thr, new Set([SID(100)]));
  eq('[2] solo: the banned champion leaves, places 1-3 go to the next three', podOf(nw, 1), [[1, [SID(101)]], [2, [SID(102)]], [3, [SID(103)]]]);
  eq('[2] solo: the entrant count still counts him (40, held)', [nw.n[0], nw.h[0]], [C.THR_SOLO, 1]);
  const two = v.cupVerdict({ 1: rows }, thr, new Set([SID(100), SID(101)]));
  eq('[2] two banned rows: 40 entrants still held (left out, 38 would not be: the edition stays held for the honest winners)', [two.n[0], two.h[0], podOf(two, 1).map((e) => e[1][0])], [C.THR_SOLO, 1, [SID(102), SID(103), SID(104)]]);
  const tie = v.cupVerdict({ 1: soloRows(C.THR_SOLO, (i) => (i <= 1 ? 900 : 900 - i * 10)) }, thr, new Set([SID(100)]));
  eq('[2] a banned player tied with an honest one for first: the honest one keeps first, the places below move up', podOf(tie, 1), [[1, [SID(101)]], [2, [SID(102)]], [3, [SID(103)]]]);
  const drows = duoRows(C.THR_TEAM);
  const dv = v.cupVerdict({ 2: drows }, thr, new Set([SID(300), SID(302), SID(303)]));
  eq('[2] duo: a team with one banned member keeps its place (the mark goes to the honest member only); an all-banned team leaves', podOf(dv, 2), [[1, [SID(301)]], [2, [SID(304), SID(305)]], [3, [SID(306), SID(307)]]]);
  eq('[2] duo: entrants still ' + C.THR_TEAM + ' teams, held', [dv.n[1], dv.h[1]], [C.THR_TEAM, 1]);
  const marks = v.cupMarksOf(dv, []);
  T('[2] no mark for any banned account', !marks[SID(300)] && !marks[SID(302)] && !marks[SID(303)] && !!marks[SID(301)]);
  T('[2] cupSkipBanned does not touch its input', JSON.stringify(v.cupStandings(drows, 2)) === JSON.stringify(v.cupStandings(drows, 2)) && (() => { const st = v.cupStandings(drows, 2); const before = JSON.stringify(st); v.cupSkipBanned(st.groups, new Set([SID(300)])); return JSON.stringify(st) === before; })());
  // fuzz: no honest account loses a mark or a place; held / entrant counts identical
  let harm = 0, held = 0, gained = 0;
  for (let it = 0; it < 300; it++) {
    const ns = C.THR_SOLO - 2 + rnd(30), nt = C.THR_TEAM - 2 + rnd(12);
    const rs = soloRows(ns, () => 100 + rnd(60)), rt = duoRows(nt, () => 50 + rnd(25));
    // shuffle team partners a little: some rows of a pair carry a different roster (a member who also played with someone else)
    for (let k = 0; k < 3; k++) { const i = rnd(rt.length); rt[i] = Object.assign({}, rt[i], { score: rt[i].score + rnd(5) }); }
    const banned = new Set();
    for (const r of rs.concat(rt)) if (rnd(8) === 0) banned.add(r.sid);
    const a = v.cupVerdict({ 1: rs, 2: rt }, thr), b = v.cupVerdict({ 1: rs, 2: rt }, thr, banned);
    if (JSON.stringify(a.n) !== JSON.stringify(b.n) || JSON.stringify(a.h) !== JSON.stringify(b.h)) held++;
    const ma = v.cupMarksOf(a, []), mb = v.cupMarksOf(b, []);
    for (const sid of Object.keys(ma)) {
      if (banned.has(sid)) continue;
      for (const m of ma[sid]) { const m2 = (mb[sid] || []).find((x) => x.pc === m.pc); if (!m2 || m2.place > m.place) harm++; }
    }
    for (const sid of Object.keys(mb)) { if (banned.has(sid)) harm += 1000; else if (!ma[sid]) gained++; }
  }
  eq('[2] fuzz 300 weeks: honest marks lost or worse place / banned marks', harm, 0);
  eq('[2] fuzz 300 weeks: entrant counts or held flags changed', held, 0);
  T('[2] fuzz: some honest accounts moved up into a mark (the fix does something) -- ' + gained, gained > 0);
}

// ---- [3] tier cuts (pure) ----
console.log('-- [3] tier cuts without full bans (pure) --');
const tierIdx = (score, cuts) => { for (let i = 0; i < 6; i++) if ((score | 0) >= (cuts[i] | 0)) return i; return 6; };
{
  const prior = v.RATING.PRIOR.solo;
  const rows = {};
  for (let i = 0; i < 220; i++) rows[SID(1000 + i)] = 100 * (230 - i);
  const top = Object.assign({}, rows); for (let i = 0; i < 3; i++) top[SID(1500 + i)] = 90000;
  const topBan = new Set([0, 1, 2].map((i) => SID(1500 + i)));
  const all = v.ratingCutsOf(Object.values(top), prior), nw = v.ratingCutsSkipBanned(top, topBan, prior);
  T('[3] no ban set = ratingCutsOf over everyone', JSON.stringify(v.ratingCutsSkipBanned(top, null, prior)) === JSON.stringify(all) && JSON.stringify(v.ratingCutsSkipBanned(top, new Set(), prior)) === JSON.stringify(all));
  eq('[3] three banned at 90000: the grandmaster cut comes down from their score to the third honest player', [all.cuts[0], nw.cuts[0]], [90000, 22800]);
  T('[3] every cut <= the cut over everyone; N = everyone (223); nb = 3', nw.cuts.every((c, i) => c <= all.cuts[i]) && nw.N === 223 && nw.nb === 3, JSON.stringify(nw));
  const low = Object.assign({}, rows); for (let i = 0; i < 3; i++) low[SID(1500 + i)] = 100;
  const allL = v.ratingCutsOf(Object.values(low), prior), nwL = v.ratingCutsSkipBanned(low, topBan, prior), honL = v.ratingCutsOf(Object.values(rows), prior);
  T('[3] three banned at the bottom: leaving them out alone would RAISE some cut (the case the rule is for)', honL.cuts.some((c, i) => c > allL.cuts[i]), JSON.stringify([honL.cuts, allL.cuts]));
  eq('[3] ... so the published cuts stay those over everyone (nobody drops a tier)', nwL.cuts, allL.cuts);
  // few players (blend with the prior): fewer players means more weight on the prior -- either direction, the lower wins
  const few = {}; for (let i = 0; i < 30; i++) few[SID(2000 + i)] = 100 * (40 - i);
  const fb = new Set([SID(2000), SID(2001), SID(2029)]);
  const allF = v.ratingCutsOf(Object.values(few), prior), nwF = v.ratingCutsSkipBanned(few, fb, prior);
  T('[3] a small field (prior blend): every cut <= the cut over everyone', nwF.cuts.every((c, i) => c <= allF.cuts[i]), JSON.stringify([nwF.cuts, allF.cuts]));
  let harm = 0, mono = 0, lowered = 0;
  for (let it = 0; it < 400; it++) {
    const n = rnd(320), r = {}, b = new Set();
    for (let i = 0; i < n; i++) { const sid = SID(3000 + i); r[sid] = rnd(30000); if (rnd(10) === 0) b.add(sid); }
    const a0 = v.ratingCutsOf(Object.values(r), prior), b0 = v.ratingCutsSkipBanned(r, b, prior);
    for (let i = 0; i < 5; i++) if (b0.cuts[i] < b0.cuts[i + 1] + 100) mono++;
    if (b0.N !== a0.N) mono++;
    for (const sid of Object.keys(r)) if (!b.has(sid) && tierIdx(r[sid], b0.cuts) > tierIdx(r[sid], a0.cuts)) harm++;
    if (b0.cuts.some((c, i) => c < a0.cuts[i])) lowered++;
  }
  eq('[3] fuzz 400 fields: an honest player in a lower tier than before', harm, 0);
  eq('[3] fuzz 400 fields: cuts not one depth apart / N changed', mono, 0);
  T('[3] fuzz: some cuts came down (the fix does something) -- ' + lowered, lowered > 0);
}

// ---- e2e harness (test/endless-cup.js / test/endless-rating.js / test/overall-ladder.js shapes) ----
const BOARD = { cp: 8, compSolo: 14, compDuo: 16, compTrio: 13, compQuad: 17, compOverall: 18, cup: 50, honor: 51, vgate: 40, wSolo: 60, wDuo: 61, ban: 70, rSolo: 30, rDuo: 31, rTrio: 32, rQuad: 33, tiercut: 41 };
const CARRIER = SID(777);
const banEnt = (sid, act, expMin) => ({ steamID: sid, score: 1, details: s.banDetails(expMin | 0, act || s.ACT_FULL, '') });
function world(recs, extra, opt) {
  const o = opt || {};
  const b = [
    { id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: BOARD.cp, name: 'cp_bank', entries: [SID(1), SID(2)].map((x) => ({ steamID: x, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compSolo, name: 'endless_comp_solo', entries: o.compSolo || [] }, { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compQuad, name: 'endless_comp_quad', entries: [] },
    { id: BOARD.compOverall, name: 'endless_comp_overall', entries: o.compOverall || [] },
    { id: BOARD.rSolo, name: 'endless_rating_solo', entries: o.rSolo || [] }, { id: BOARD.rDuo, name: 'endless_rating_duo', entries: [] },
    { id: BOARD.rTrio, name: 'endless_rating_trio', entries: [] }, { id: BOARD.rQuad, name: 'endless_rating_quad', entries: [] },
    { id: BOARD.tiercut, name: 'endless_tiercut', entries: o.tiercut || [] },
    { id: BOARD.vgate, name: 'version_gate', entries: [{ steamID: CARRIER, score: 2026100101 }] },
  ];
  if (o.ban) b.push({ id: BOARD.ban, name: 'ban_board', entries: o.ban });
  return S.shardBoards(recs || [], b.concat(extra || []));
}
const run = (boards, files, env, script) => S.runCron(boards, files, Object.assign({ SEASON_NOW: '2026-11-24T12:00:00Z' }, env || {}), script || null, 'ban-skip');
const setTo = (r, id) => S.setPosts(r, id);
const delTo = (r, id) => r.posts.filter((p) => /DeleteLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(p.body));
const field = (p, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(p.body); return m ? decodeURIComponent(m[1]) : null; };
const sidsOf = (posts) => posts.map((p) => field(p, 'steamid')).sort();
const asEntries = (rows) => rows.map((r) => ({ steamID: r.sid, score: r.score, details: r.det && r.det.length ? r.det : [r.score, 0] }));
const WK = 202647;
const weekBoards = () => [{ id: BOARD.wSolo, name: 'endless_comp_solo_w' + WK, entries: asEntries(soloRows(C.THR_SOLO)) }, { id: BOARD.wDuo, name: 'endless_comp_duo_w' + WK, entries: asEntries(duoRows(C.THR_TEAM)) }];
const cupBoards = (honor) => [{ id: BOARD.cup, name: 'endless_cup', entries: [] }, { id: BOARD.honor, name: 'endless_cup_honor', entries: honor || [] }];
const solo0 = () => ({ runs: {}, wait: {}, ms: {}, held: {}, hist: {}, cup: { s: 202646, w: {} } });
const CUP_BAN = [banEnt(SID(100)), banEnt(SID(300)), banEnt(SID(302)), banEnt(SID(303)), banEnt(SID(104), s.ACT_MM)];
const CUP_WIN = [SID(101), SID(102), SID(103), SID(301), SID(304), SID(305), SID(306), SID(307)].sort();

// [4] runs, kept for the mutation checks in [7]
function cupE2e(script) {
  const out = {};
  out.r1 = run(world([], weekBoards().concat(cupBoards()), { ban: CUP_BAN }), { SOLO_FILE: solo0() }, null, script);
  const cup1 = ((out.r1.state.SOLO_FILE || {}).cup || {});
  out.cup1 = cup1;
  out.honor1 = sidsOf(setTo(out.r1, BOARD.honor));
  return out;
}
console.log('-- [4] e2e: cup settle over the real main() --');
let E4;
{
  E4 = cupE2e();
  const { r1, cup1 } = E4;
  T('[4] settle-free W48 tick exits 0 and reads the ban board', r1.code === 0 && /ban board: 4 account\(s\) fully banned/.test(r1.out), r1.out.slice(-800));
  eq('[4] week W47 settled, entrants solo 40 / duo 15 teams (banned rows counted), both held', cup1.w && cup1.w[WK] && [cup1.s, cup1.w[WK].n, cup1.w[WK].h], [WK, [C.THR_SOLO, C.THR_TEAM, 0, 0], [1, 1, 0, 0]]);
  eq('[4] honor rows: solo #2-#4, duo: the honest member of the banned-member team + the next two teams; no banned account; the matchmaking-only SID(104) is not banned (he places 4th, off the podium)', E4.honor1, CUP_WIN);
  T('[4] the settle line names the banned rows left off the podium', /cup: week 202647: 4 row\(s\) of fully banned accounts left off the podium/.test(r1.out), r1.out.split('\n').filter((l) => /cup/.test(l)).join(' | '));
  // a winner banned AFTER the settle: his row is deleted and his written flag forgotten; nobody else written (places are not re-awarded)
  const honorNow = setTo(r1, BOARD.honor).map((p) => ({ steamID: field(p, 'steamid'), score: Number(field(p, 'score')), details: S.postDetails(p.body) }));
  const r2 = run(world([], weekBoards().concat(cupBoards(honorNow)), { ban: CUP_BAN.concat([banEnt(SID(101))]) }), { SOLO_FILE: r1.state.SOLO_FILE });
  const cup2 = ((r2.state.SOLO_FILE || {}).cup || {});
  T('[4] a winner banned after the settle: his honor row deleted, nothing written, no second settle', r2.code === 0 && sidsOf(delTo(r2, BOARD.honor)).join() === SID(101) && setTo(r2, BOARD.honor).length === 0 && !/cup: settled week/.test(r2.out), r2.out.split('\n').filter((l) => /cup/.test(l)).join(' | '));
  T('[4] ... and his "row written this week" flag is forgotten (the others keep theirs)', cup2.hw && !cup2.hw.ok[SID(101)] && cup2.hw.ok[SID(102)] === 1);
  // the ban is lifted while W47 is still the latest settled week: his row is written again
  const r3 = run(world([], weekBoards().concat(cupBoards(honorNow.filter((e) => e.steamID !== SID(101)))), { ban: CUP_BAN }), { SOLO_FILE: r2.state.SOLO_FILE });
  T('[4] the ban lifted: his mark row is written back (1:1 champion of W47)', r3.code === 0 && sidsOf(setTo(r3, BOARD.honor)).join() === SID(101) && JSON.stringify(S.postDetails(setTo(r3, BOARD.honor)[0].body)) === JSON.stringify(v.cupHonorEncode(WK, [{ pc: 1, place: 1 }])));
  // a row the sanctions job moved away (exiled) stays away: no delete, no rewrite, flag kept (the unban restores it from the shadow)
  const r4 = run(world([], weekBoards().concat(cupBoards(honorNow.filter((e) => e.steamID !== SID(102)))), { ban: CUP_BAN.concat([banEnt(SID(102))]) }), { SOLO_FILE: r1.state.SOLO_FILE });
  const cup4 = ((r4.state.SOLO_FILE || {}).cup || {});
  T('[4] a banned winner whose row the sanctions job already moved: nothing written or deleted, his written flag kept', r4.code === 0 && setTo(r4, BOARD.honor).length === 0 && delTo(r4, BOARD.honor).length === 0 && cup4.hw && cup4.hw.ok[SID(102)] === 1);
  // the ban board read fails 12 h after the week ended: the settle waits, nothing is written
  const r5 = run(world([], weekBoards().concat(cupBoards()), { ban: CUP_BAN }), { SOLO_FILE: solo0() }, { STUB_FAIL: JSON.stringify({ ban_board: 500 }), SEASON_NOW: '2026-11-23T12:00:00Z' });
  const cup5 = ((r5.state.SOLO_FILE || {}).cup || {});
  T('[4] ban board read fails 12 h after the week: W47 not settled this run (warned), no honor row', r5.code === 0 && cup5.s === 202646 && setTo(r5, BOARD.honor).length === 0 && /cup: ban board not read -- week 202647 settled next run/.test(r5.out), r5.out.split('\n').filter((l) => /cup|ban/.test(l)).join(' | '));
  // ... still failing 25 h after: settled as before Q338 (banned counted), with a warning
  const r6 = run(world([], weekBoards().concat(cupBoards()), { ban: CUP_BAN }), { SOLO_FILE: solo0() }, { STUB_FAIL: JSON.stringify({ ban_board: 500 }), SEASON_NOW: '2026-11-24T01:00:00Z' });
  const cup6 = ((r6.state.SOLO_FILE || {}).cup || {});
  const old = v.cupVerdict({ 1: soloRows(C.THR_SOLO), 2: duoRows(C.THR_TEAM) }, thr);
  T('[4] ... still failing 25 h after the week: settled with the verdict before Q338 (banned champion included), warned', r6.code === 0 && cup6.s === WK && JSON.stringify(cup6.w[WK]) === JSON.stringify(old) && /ban board still not read 24 h after week 202647 ended/.test(r6.out), JSON.stringify(cup6.w && cup6.w[WK]).slice(0, 300));
  // no ban board on the listing (no ban ever written on this app): nobody banned, the verdict before Q338
  const r7 = run(world([], weekBoards().concat(cupBoards())), { SOLO_FILE: solo0() });
  const cup7 = ((r7.state.SOLO_FILE || {}).cup || {});
  T('[4] no ban board on the app: settled as before Q338, the board is not created', r7.code === 0 && JSON.stringify(cup7.w && cup7.w[WK]) === JSON.stringify(old) && !r7.posts.some((p) => /FindOrCreateLeaderboard/.test(p.url) && field(p, 'name') === 'ban_board'));
}

// ---- [5] tier cuts e2e ----
console.log('-- [5] e2e: tier cuts over the real main() --');
function ratingWorld() {
  const st = { runs: {}, wait: {}, ms: {}, held: {}, hist: {} };
  const rows = [];
  const add = (sid, depth) => {
    for (let r = 0; r < 5; r++) v.ratingHistUpsert(st, v.pid(sid), 'solo', 0, 1000 + r, depth, NOW_MS - 86400000 + r);
    const sc = v.ratingScoreOf(st.hist[v.ratingHistKey(v.pid(sid), 'solo', 0)]);
    rows.push({ steamID: sid, score: sc.score, details: sc.details });
  };
  for (let i = 0; i < 220; i++) add(SID(1000 + i), 230 - i);
  for (let i = 0; i < 3; i++) add(SID(1500 + i), 900);
  rows.sort((a, b) => b.score - a.score);
  return { st, rows };
}
const RW = ratingWorld();
const tcOf = (r) => { const p = setTo(r, BOARD.tiercut)[0]; return p ? v.tiercutDecode(Number(field(p, 'score')), S.postDetails(p.body)) : null; };
const RBAN = [0, 1, 2].map((i) => banEnt(SID(1500 + i)));
let E5;
{
  E5 = run(world([], [], { rSolo: RW.rows, ban: RBAN }), { SOLO_FILE: RW.st });
  const dec = tcOf(E5);
  const all = v.ratingCutsOf(RW.rows.map((x) => x.score), v.RATING.PRIOR.solo);
  T('[5] run exits 0, no rating row rewritten (history matches the board), carrier published', E5.code === 0 && setTo(E5, BOARD.rSolo).length === 0 && delTo(E5, BOARD.rSolo).length === 0 && !!dec, E5.out.split('\n').filter((l) => /tiercut|rating|ban/.test(l)).join(' | '));
  eq('[5] published solo cuts: the lower of with / without the 3 banned (grandmaster 22800, not 90000), N 223', dec && [dec.byFam.solo.cuts, dec.byFam.solo.N], [v.ratingCutsSkipBanned(Object.fromEntries(RW.rows.map((x) => [x.steamID, x.score])), new Set(RBAN.map((e) => e.steamID)), v.RATING.PRIOR.solo).cuts, 223]);
  T('[5] every published cut <= the cut over everyone', dec && dec.byFam.solo.cuts.every((c, i) => c <= all.cuts[i]));
  T('[5] the log says the banned were left out', /tiercut solo: N=223 .*\(3 banned left out/.test(E5.out));
  const rf = run(world([], [], { rSolo: RW.rows, ban: RBAN }), { SOLO_FILE: RW.st }, { STUB_FAIL: JSON.stringify({ ban_board: 500 }) });
  const decF = tcOf(rf);
  eq('[5] ban board read fails: the cuts over everyone are published (as before Q338)', decF && decF.byFam.solo.cuts, all.cuts);
}

// ---- [6] composite e2e ----
console.log('-- [6] e2e: composite ladder over the real main() --');
const SEED = 9;
function rec7(hash, seat, ros, sd, ed, flags) {
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push([400, 300][i]);
  d.push(0);
  for (const x of ros) { const p = S.sidPair(x); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
  return d;
}
function start7(hash, seat, ros) {
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, ros.length, 0];
  for (let i = 0; i < ros.length; i++) d.push(0);
  d.push(0);
  for (const x of ros) { const p = S.sidPair(x); d.push(p[0], p[1]); }
  return d;
}
// a fresh duo competitive segment (paced on first sighting: nothing settles, but the run reads every endless board and runs the
//   composite writers -- test/overall-ladder.js [4])
const ROS = [SID(1), SID(2)];
const SEG = ROS.map((sid, i) => ({ sid, d: start7(0x4a01, i, ROS) })).concat(ROS.map((sid, i) => ({ sid, d: rec7(0x4a01, i, ROS, 0, 5, attest.SEG_COMP) })));
const X = SID(51), Y = SID(52), Z = SID(53);
const pz = v.packEndlessScore(25, 1000), px = v.packEndlessScore(40, 1000);
const OV = { compSolo: [{ steamID: X, score: px, details: [1760000000, 0] }, { steamID: Z, score: pz, details: [1760000000, 0] }], compOverall: [{ steamID: Y, score: 4000, details: [4000, 0, 1] }, { steamID: Z, score: 2500, details: [2500, 0, 1] }] };
const OVBAN = [banEnt(X), banEnt(Y)];
let E6;
{
  E6 = run(world(SEG, [], Object.assign({ ban: OVBAN }, OV)), {}, { SEASON_NOW: '2026-10-01T12:00:00Z' });
  T('[6] run exits 0 and reaches the composite writer', E6.code === 0 && /overall comp writes: /.test(E6.out), E6.out.split('\n').slice(-20).join('\n'));
  eq('[6] composite writes: none (the banned X with a per-size best in hand gets no row; the honest Z row is current)', sidsOf(setTo(E6, BOARD.compOverall)), []);
  eq('[6] composite deletes: the banned Y stray row only', sidsOf(delTo(E6, BOARD.compOverall)), [Y]);
  T('[6] logged', /fully banned -> composite row deleted/.test(E6.out));
  const rf = run(world(SEG, [], Object.assign({ ban: OVBAN }, OV)), {}, { SEASON_NOW: '2026-10-01T12:00:00Z', STUB_FAIL: JSON.stringify({ ban_board: 500 }) });
  T('[6] ban board read fails: as before Q338 (X written, Y not deleted)', rf.code === 0 && sidsOf(setTo(rf, BOARD.compOverall)).join() === X && delTo(rf, BOARD.compOverall).length === 0, rf.out.split('\n').filter((l) => /overall|ban/.test(l)).join(' | '));
  const rmm = run(world(SEG, [], Object.assign({ ban: [banEnt(X, s.ACT_MM), banEnt(Y, s.ACT_MM)] }, OV)), {}, { SEASON_NOW: '2026-10-01T12:00:00Z' });
  T('[6] matchmaking-only restrictions keep their composite rows (X written, Y kept)', rmm.code === 0 && sidsOf(setTo(rmm, BOARD.compOverall)).join() === X && delTo(rmm, BOARD.compOverall).length === 0);
}

// ---- [7] wiring pins + mutation self-checks ----
console.log('-- [7] wiring pins + mutation self-checks --');
const SRC = S.SRC;
{
  const lane = SRC.slice(SRC.indexOf('const banSetOnce = async () => {'), SRC.indexOf('const maintainRating = async'));
  T('[7] the ban board is looked up on the listing only, never created (sanctions.js owns it)', /=== BAN_LB/.test(lane) && !/findOrCreateBoard\(BAN_LB/.test(SRC) && !/resolveSeasonBoard\([^)]*BAN_LB/.test(SRC));
  T('[7] read once per run (memoized, failure included)', /if \(banSet !== undefined\) return banSet;/.test(lane) && /banSet = null;/.test(lane));
  T('[7] every exit path that keeps the cup / tier cuts gets the bans (maintainRating / maintainCup ask for them themselves)', (SRC.match(/await banSetOnce\(\)/g) || []).length === 3);
  T('[7] the composite read of the bans sits after the per-size reads (just before the composite loop)', SRC.indexOf('const ovBans = await banSetOnce();') > SRC.indexOf("'solo comp board'") && SRC.indexOf('const ovBans = await banSetOnce();') < SRC.indexOf('for (const F of OVERALL_FAMS) { await writeOverall(F, false); await writeOverall(F, true); }'));
}
const ROOT = S.ROOT.replace(/\\/g, '/');
function mutant(pairs) {
  let m = SRC;
  for (const [good, bad] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80)); m = m.split(good).join(bad); }
  m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ban-skip-mut-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
  return { path: p, dir, mod: () => { delete require.cache[p]; return require(p); }, done: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}
{
  // pure mutations (loaded in-process: main() only runs as the entry module)
  const pure = [
    ['cupSkipBanned returns the groups untouched', [['if (!banned || !banned.size) return groups;', 'return groups;']], (m) => JSON.stringify(podOf(m.cupVerdict({ 1: soloRows(C.THR_SOLO) }, thr, new Set([SID(100)])), 1)[0]) !== JSON.stringify([1, [SID(101)]])],
    ['a team keeps a banned member in its mark list', [['const sids = g.sids.filter((s) => !banned.has(String(s)));', 'const sids = g.sids.slice();']], (m) => JSON.stringify(podOf(m.cupVerdict({ 2: duoRows(C.THR_TEAM) }, thr, new Set([SID(300)])), 2)[0]) !== JSON.stringify([1, [SID(301)]])],
    ['the cut over the players not banned replaces the cut over everyone (no lower-of)', [['cuts: all.cuts.map((c, i) => Math.min(c | 0, hon.cuts[i] | 0))', 'cuts: hon.cuts']], (m) => { const low = {}; for (let i = 0; i < 220; i++) low[SID(1000 + i)] = 100 * (230 - i); for (let i = 0; i < 3; i++) low[SID(1500 + i)] = 100; const a = m.ratingCutsOf(Object.values(low), m.RATING.PRIOR.solo).cuts; return m.ratingCutsSkipBanned(low, new Set([0, 1, 2].map((i) => SID(1500 + i))), m.RATING.PRIOR.solo).cuts.some((c, i) => c > a[i]); }],
    ['the published N drops the banned players', [['return { N: all.N, w: all.w,', 'return { N: hon.N, w: all.w,']], (m) => { const r = {}; for (let i = 0; i < 30; i++) r[SID(1 + i)] = i * 100; return m.ratingCutsSkipBanned(r, new Set([SID(1)]), m.RATING.PRIOR.solo).N !== 30; }],
    ['matchmaking-only read as a full ban', [['if (act === BAN_ACT_MM) return false;', '']], (m) => m.banRowFull(1, [0, 2], NOW_MS) === true],
    ['an expired row read as a ban', [['if (expMin > 0 && expMin * 60000 <= nowMs) return false;', '']], (m) => m.banRowFull(1, [Math.floor(NOW_MS / 60000) - 10, 1], NOW_MS) === true],
  ];
  for (const [name, pairs, isRed] of pure) {
    const mu = mutant(pairs);
    let red = false;
    try { red = !!isRed(mu.mod()); } catch (e) { red = true; } finally { mu.done(); }
    T('[7] mutation "' + name + '" is caught', red);
  }
  // e2e mutations: each over the real main() of a mutated copy
  const e2e = [
    ['the settle ignores the bans (cupVerdict without them)', [['podium: CUP.PODIUM }, bans);', 'podium: CUP.PODIUM });']], (p) => JSON.stringify(cupE2e(p).honor1) !== JSON.stringify(CUP_WIN)],   // the upkeep still keeps SID(100) off, but the honest #4 loses his place
    ['the honor upkeep writes banned winners', [["if (bans) for (const sid of Object.keys(want)) if (bans.has(sid)) { delete want[sid]; if (existing[sid]) banGone.add(sid); }", '']], (p) => { const r = run(world([], weekBoards().concat(cupBoards()), { ban: [banEnt(SID(101))] }), { SOLO_FILE: Object.assign(solo0(), { cup: { s: WK, w: { [WK]: v.cupVerdict({ 1: soloRows(C.THR_SOLO) }, thr) } } }) }, null, p); return sidsOf(setTo(r, BOARD.honor)).indexOf(SID(101)) >= 0; }],
    ['the settle does not wait for a failed ban read', [["if (seasonNowMs() < cupWeekStart(cupNextWeek(wk)) + CUP_BAN_WAIT_MS) { ghWarn('cup: ban board not read -- week ' + wk + ' settled next run'); break; }", '']], (p) => { const r = run(world([], weekBoards().concat(cupBoards()), { ban: CUP_BAN }), { SOLO_FILE: solo0() }, { STUB_FAIL: JSON.stringify({ ban_board: 500 }) }, p); return ((r.state.SOLO_FILE || {}).cup || {}).s === WK; }],
    ['the tier cuts ignore the bans', [['byFam[fam] = ratingCutsSkipBanned(rows, bans, RATING.PRIOR[fam]);', 'byFam[fam] = ratingCutsSkipBanned(rows, null, RATING.PRIOR[fam]);']], (p) => { const d = tcOf(run(world([], [], { rSolo: RW.rows, ban: RBAN }), { SOLO_FILE: RW.st }, null, p)); return !d || d.byFam.solo.cuts[0] === 90000; }],
    ['the composite writer writes banned accounts', [["if (ovBans && ovBans.has(sid)) return false;   // Q338: no composite row for a fully banned account", '']], (p) => sidsOf(setTo(run(world(SEG, [], Object.assign({ ban: OVBAN }, OV)), {}, { SEASON_NOW: '2026-10-01T12:00:00Z' }, p), BOARD.compOverall)).indexOf(X) >= 0],
    ['the composite writer leaves a banned stray row', [['const strays = ovBans ? Object.keys(cur).filter((sid) => ovBans.has(sid)) : [];', 'const strays = [];']], (p) => delTo(run(world(SEG, [], Object.assign({ ban: OVBAN }, OV)), {}, { SEASON_NOW: '2026-10-01T12:00:00Z' }, p), BOARD.compOverall).length === 0],
  ];
  for (const [name, pairs, isRed] of e2e) {
    const mu = mutant(pairs);
    let red = false;
    try { red = !!isRed(mu.path); } catch (e) { red = true; console.log('    (' + (e && e.message) + ')'); } finally { mu.done(); }
    T('[7] mutation "' + name + '" is caught by the e2e run', red);
  }
}

if (failN) { console.log('FAIL (ban-skip): ' + failN); process.exit(1); }
console.log('ALL PASS (ban-skip)');
