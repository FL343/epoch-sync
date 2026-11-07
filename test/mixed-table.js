'use strict';
// O716 one queue for quick + ranked, part B: one table seats both, each seat settles by its own entry (the ranked-seat mask in
// bits 11-16 of the match type; the user's calls of 2026-11-07, plan KNIFE_O716 section 0 D3 / D8-D12).
// Over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js), the same table settled three ways -- every
// seat quick (1), every seat ranked (2), seats 0 and 2 ranked in a quick brawl (1 + mask):
//   [1] the mixed table settles once; a ranked seat takes exactly what it takes at the all-ranked table (points, its seed on a
//       first settle with SEEDED, XP x1.25, CP x2, ranked rating, the ranked career cell), a quick seat exactly what it takes
//       at the all-quick table (no points row written -- not even a seed --, quick XP / CP, no ranked rating, quick cell);
//       every seat's stored rating moves as at either table (TrueSkill reads the whole table)
//   [2] D8: a 2V2 (team brawl) with one quick, one ranked member a side: the quick member with no points this season counts in
//       his team's average tier at the placement seed (not written), a quick member with a row at his row; mutant (the seed
//       line taken out: he counts as 0) -> the ranked teammate's points move
//   [3] D9: a mixed brawl, a ranked seat and a quick seat leave: the ranked leaver pays the -100 (LEAVE receipt), the quick
//       leaver no points (both counted in the exit rate); mutant (the fine back on the table's rule) -> the quick leaver fined
//   [4] D9: a confession -- a ranked seat's quit is fined at first sight, a quick seat's is the exit rate only; mutant
//       (the table's rule) -> the quick quitter fined
//   [5] D10: the stand-in (Q227) and the absent-team branches (Q210 / Q167) take the ranked branch on a mixed table (pins)
//   [6] mutant: the points line on the table's rule (anyLp) -> the quick seats of [1] get points rows
const fs = require('fs'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const ts = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const F = PP.RECEIPT_F, low = (e) => e.flags & 0xff;
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT;

const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN;
const XPB = 5, RATING = 6, POINTS = 7, CPB = 8;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: CPB, name: 'cp_bank', entries: [] }]);
// steps: [[ms since the previous run, records]]; pts carried run to run (each points write lands); files0: the first run's state
function run(steps, pts0, files0, script) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || null), null, script || null, 'mixed-table');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// a matchmade table (mt) on seats ros: every seat writes its start (unless noStart), `res` = the seats writing a result;
//   scores descending by seat (sc overrides)
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const St = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) })).filter((x, seat) => !(o.noStart || []).includes(seat));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, 0) }));
  return { S: St, R, all: St.concat(R), key: hash + '_1234_' + mt, mh: hash | 0 };
}
const SETTLE = (mm) => [[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [6 * MIN, mm.all]];
const posts = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const lastOf = (m, board, sid) => { const w = posts(m, board, sid); return w.length ? w[w.length - 1] : null; };
const ringOf = (m, sid) => { const w = lastOf(m, POINTS, sid); return w ? PP.lpDetailsOf(w.details).ring : null; };
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const skillOf = (m, sid) => (m.last.state.SKILL_FILE || {})[v.pid(sid)] || null;
const cellsOf = (m, sid) => Object.keys(((m.last.state.XP_FILE || {})[v.pid(sid)] || {}).cm || {}).sort();
let mutN = 0;
function mutant(from, to, tag) {
  if (H.SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once: ' + from.slice(0, 80)); return null; }
  const f = path.join(H.ROOT, '.mutant-mixed-table-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(f, H.SRC.replace(from, to));
  return f;
}
const withMutant = (from, to, tag, fn) => { const f = mutant(from, to, tag); if (!f) return; try { fn(f); } finally { try { fs.unlinkSync(f); } catch (e) {} } };

console.log('=== O716 mixed table: each seat settles by its own entry ===');
const A = H.SID(7161), B = H.SID(7162), C = H.SID(7163), D = H.SID(7164);
const ROS = [A, B, C, D];
// A (ranked) and B (quick) have no points row (a first settle); C (ranked) 2500, D (quick) 2400
const PTS = { [C]: { score: 2500 }, [D]: { score: 2400 } };
const MIXED = 1 | S(0b0101);
// ---- [1] ----
const tbl = (mt, hash) => { const mm = match(mt, hash, ROS, [0, 1, 2, 3]); return { mm, m: run(SETTLE(mm), PTS) }; };
const Q = tbl(1, 0x71601), R = tbl(2, 0x71602), X = tbl(MIXED, 0x71603);
T('[1] the three tables settle', Q.m.okAll && R.m.okAll && X.m.okAll && settled(Q.m, Q.mm.key) && settled(R.m, R.mm.key) && settled(X.m, X.mm.key), X.m.out.slice(-1500));
{
  const rk = [A, C], qk = [B, D];
  T('[1] points: the ranked seats as at the all-ranked table (same score, same delta in the receipt), A seeded (SEEDED)',
    rk.every((s) => { const x = lastOf(X.m, POINTS, s), r = lastOf(R.m, POINTS, s), rx = ringOf(X.m, s), rr = ringOf(R.m, s); return x && r && x.score === r.score && rx[0].delta === rr[0].delta && rx[0].mh === X.mm.mh; })
      && (low(ringOf(X.m, A)[0]) & F.SEEDED) === F.SEEDED, J(rk.map((s) => [lastOf(X.m, POINTS, s), lastOf(R.m, POINTS, s)])));
  T('[1] points: no row written for a quick seat (not even B\'s seed; D\'s row untouched), as at the all-quick table',
    qk.every((s) => posts(X.m, POINTS, s).length === 0 && posts(Q.m, POINTS, s).length === 0) && posts(R.m, POINTS, B).length === 1, J(qk.map((s) => posts(X.m, POINTS, s))));
  T('[1] XP: ranked seats as all-ranked (x1.25), quick seats as all-quick', rk.every((s) => lastOf(X.m, XPB, s).score === lastOf(R.m, XPB, s).score)
    && qk.every((s) => lastOf(X.m, XPB, s).score === lastOf(Q.m, XPB, s).score) && lastOf(R.m, XPB, B).score > lastOf(Q.m, XPB, B).score,
    J(ROS.map((s) => [lastOf(Q.m, XPB, s), lastOf(R.m, XPB, s), lastOf(X.m, XPB, s)].map((p) => p && p.score))));
  T('[1] CP: ranked seats as all-ranked (x2), quick seats as all-quick', rk.every((s) => lastOf(X.m, CPB, s).score === lastOf(R.m, CPB, s).score)
    && qk.every((s) => lastOf(X.m, CPB, s).score === lastOf(Q.m, CPB, s).score) && lastOf(R.m, CPB, A).score > lastOf(Q.m, CPB, A).score,
    J(ROS.map((s) => [lastOf(Q.m, CPB, s), lastOf(R.m, CPB, s), lastOf(X.m, CPB, s)].map((p) => p && p.score))));
  T('[1] stored rating: every seat moves as at either table (TrueSkill reads the whole table)', ROS.every((s) => J([skillOf(X.m, s).mu, skillOf(X.m, s).sigma]) === J([skillOf(R.m, s).mu, skillOf(R.m, s).sigma])
    && J([skillOf(X.m, s).mu, skillOf(X.m, s).sigma]) === J([skillOf(Q.m, s).mu, skillOf(Q.m, s).sigma])), J(ROS.map((s) => skillOf(X.m, s))));
  T('[1] ranked rating: the ranked seats as all-ranked, the quick seats none (as all-quick; Q160)', rk.every((s) => skillOf(X.m, s).rm === skillOf(R.m, s).rm && skillOf(X.m, s).rm != null)
    && qk.every((s) => skillOf(X.m, s).rm === undefined && skillOf(Q.m, s).rm === undefined), J(ROS.map((s) => skillOf(X.m, s))));
  T('[1] career: the ranked seats in the ranked cell (1:*), the quick seats in the quick one (0:*)', rk.every((s) => cellsOf(X.m, s).length === 1 && /^1:/.test(cellsOf(X.m, s)[0]))
    && qk.every((s) => cellsOf(X.m, s).length === 1 && /^0:/.test(cellsOf(X.m, s)[0])), J(ROS.map((s) => cellsOf(X.m, s))));
  T('[1] logged: a points line for the ranked seats only', /settle [^\n]*\| pts /.test(X.m.out) && (X.m.out.match(/settle [^:\n]*: [0-9a-f]{8} rank[^\n]*\| pts /g) || []).length === 2, (X.m.out.match(/  settle [^\n]*/g) || []).join(' || '));
  // [6] mutant: the points line on the table's rule
  withMutant('        if (lpId && seatLp(r.id)) {   // quick = MMR only', '        if (lpId && anyLp) {   // quick = MMR only', '[6]', (f) => {
    const mm = match(MIXED, 0x71604, ROS, [0, 1, 2, 3]), m = run(SETTLE(mm), PTS, null, f);
    T('[6] mutant (the points line on the table\'s rule): the quick seats get points rows -- caught', m.okAll && posts(m, POINTS, D).length === 1, J(posts(m, POINTS, D)) + m.out.slice(-400));
  });
}
// ---- [2] D8 ----
{
  const E = H.SID(7171), Fq = H.SID(7172), G = H.SID(7173), Hq = H.SID(7174);
  const TEAM = 3 | S(0b0101);   // team brawl: seats 0-1 = team 0, 2-3 = team 1; seats 0 and 2 ranked
  const sk = { [v.pid(Fq)]: { mu: 40, sigma: 2 } };   // F (quick, team 0) strong, no points row
  const pts = { [E]: { score: 1000 }, [G]: { score: 1000 }, [Hq]: { score: 500 } };
  const sc = [900, 700, 600, 500];   // team 0 wins on money
  const mm = match(TEAM, 0x71611, [E, Fq, G, Hq], [0, 1, 2, 3], { sc });
  const m = run(SETTLE(mm), pts, { SKILL_FILE: sk });
  const dispOf = (sid) => { const s = sk[v.pid(sid)] || ts.DEFAULTS; return ts.displayRating(s.mu, s.sigma); };
  const seedF = PP.seasonSeedLp(null, dispOf(Fq));
  const planWith = (fLp) => PP.matchPlan([[E, 0, 1000], [Fq, 1, fLp], [G, 2, 1000], [Hq, 3, 500]].map(([sid, seat, lp]) => ({ steamID: sid, seat, mmr: dispOf(sid), rank: 0, lp })),
    TEAM, { scores: sc, leaverSeats: [], winTeam: null, absent: [], finished: [] });
  const want = (fLp) => ({ E: PP.settleLine(1000, planWith(fLp)[E], 0, 4, false).nv, G: PP.settleLine(1000, planWith(fLp)[G], 0, 4, false).nv });
  const wSeed = want(seedF), wZero = want(0);
  T('[2] (the case reads apart: F\'s seed and a 0 give E different points)', wSeed.E !== wZero.E, J([wSeed, wZero, seedF]));
  T('[2] D8: E (ranked, team 0) settles with his quick teammate F at F\'s placement seed ' + seedF + ' (not written), G with H at H\'s row',
    m.okAll && settled(m, mm.key) && lastOf(m, POINTS, E) && lastOf(m, POINTS, E).score === wSeed.E && lastOf(m, POINTS, G).score === wSeed.G, J([lastOf(m, POINTS, E), lastOf(m, POINTS, G), wSeed]) + m.out.slice(-600));
  T('[2] no points row for the quick members (F not seeded, H untouched)', posts(m, POINTS, Fq).length === 0 && posts(m, POINTS, Hq).length === 0);
  withMutant('      if (lpId && rankedSeatMaskOf(matchType) && isTeamMt(matchType)) for (const q of planIn) if (!seatLp(q.steamID) && lp[q.steamID] == null) q.lp = (await planRow(q)).lp;\n', '', '[2]', (f) => {
    const mx = run(SETTLE(match(TEAM, 0x71612, [E, Fq, G, Hq], [0, 1, 2, 3], { sc })), pts, { SKILL_FILE: sk }, f);
    T('[2] mutant (the seed line taken out: F counts as 0): E\'s points move to ' + wZero.E + ' -- caught', mx.okAll && lastOf(mx, POINTS, E) && lastOf(mx, POINTS, E).score === wZero.E, J(lastOf(mx, POINTS, E)));
  });
}
// ---- [3] D9: leavers ----
{
  const K = H.SID(7181), L = H.SID(7182), M = H.SID(7183), N = H.SID(7184);
  const mm = match(MIXED, 0x71621, [K, L, M, N], [0, 1]);   // M (ranked, seat 2) and N (quick, seat 3) write their start and leave
  const pts = { [K]: { score: 2500 }, [L]: { score: 2400 }, [M]: { score: 1500 }, [N]: { score: 1400 } };
  const steps = [[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [LEAVE, mm.all], [3 * HOUR, mm.all]];
  const m = run(steps, pts);
  const lv = m.last.state.LEAVERS_FILE || {};
  T('[3] the ranked leaver pays -' + PP.LEAVER_LP_PENALTY + ' (LEAVE receipt), the quick leaver no points', m.okAll && settled(m, mm.key) && posts(m, POINTS, M).length === 1
    && lastOf(m, POINTS, M).score === 1500 - PP.LEAVER_LP_PENALTY && low(ringOf(m, M)[0]) === F.LEAVE && posts(m, POINTS, N).length === 0, J([posts(m, POINTS, M), posts(m, POINTS, N)]) + m.out.slice(-800));
  T('[3] both counted in the exit rate', ((lv[v.pid(M)] || {}).leaves | 0) === 1 && ((lv[v.pid(N)] || {}).leaves | 0) === 1, J(lv));
  T('[3] the writers: K (ranked) settled, L (quick) no points', posts(m, POINTS, K).length === 1 && posts(m, POINTS, L).length === 0);
  withMutant('      if (lpId && seatAppliesLp(matchType, x.seat)) {   // O716: the leaver\'s own entry', '      if (lpId && anyLp) {   // O716: the leaver\'s own entry', '[3]', (f) => {
    const mx = run(steps.map(([ms, recs]) => [ms, recs]), pts, null, f);
    T('[3] mutant (the fine on the table\'s rule): the quick leaver fined -- caught', mx.okAll && posts(mx, POINTS, N).length === 1 && lastOf(mx, POINTS, N).score === 1400 - PP.LEAVER_LP_PENALTY, J(posts(mx, POINTS, N)));
  });
}
// ---- [4] D9: confessions ----
{
  const P = H.SID(7191), Qq = H.SID(7192), Rr = H.SID(7193), Ss = H.SID(7194);
  const conf = (mt, hash, ros) => ({ sid: ros[1], d: H.rec(0xB5, mt, hash, 1, 0, false, ros, [6000, 5000], 5) });   // seat 1 quits (user-quit)
  const mq = match(1 | S(0b01), 0x71631, [P, Qq], []), cq = conf(1 | S(0b01), 0x71631, [P, Qq]);   // Q (seat 1) came in quick
  const mr = match(1 | S(0b10), 0x71632, [Rr, Ss], []), cr = conf(1 | S(0b10), 0x71632, [Rr, Ss]);   // S (seat 1) came in ranked
  const pts = { [P]: { score: 2500 }, [Qq]: { score: 2200 }, [Rr]: { score: 2500 }, [Ss]: { score: 2200 } };
  const steps = [[0, mq.S.concat(mr.S)], [5 * MIN, mq.S.concat(mr.S, [cq, cr])]];
  const m = run(steps, pts);
  T('[4] a ranked seat\'s confession: fined at first sight (LEAVE receipt)', m.okAll && posts(m, POINTS, Ss).length === 1 && lastOf(m, POINTS, Ss).score === 2200 - PP.LEAVER_LP_PENALTY
    && low(ringOf(m, Ss)[0]) === F.LEAVE, J(posts(m, POINTS, Ss)) + m.out.slice(-600));
  T('[4] a quick seat\'s confession: the exit rate only (no points write, logged non-ranked)', posts(m, POINTS, Qq).length === 0 && /confess [^\n]*exit-rate only \(non-ranked\)/.test(m.out)
    && (((m.last.state.LEAVERS_FILE || {})[v.pid(Qq)] || {}).leaves | 0) === 1, m.out.slice(-600));
  T('[4] the confession record carries its seat to the fine (wiring pin)', /mt: d\[2\] \| 0, seat: d\[5\] \| 0, dispCode \}/.test(H.SRC) && /appliesLpFn: seatAppliesLp,/.test(H.SRC)
    && /opts\.appliesLpFn\(c\.mt \| 0, confSeatOf\(c\)\)/.test(H.SRC));
  withMutant('      appliesLpFn: seatAppliesLp,', '      appliesLpFn: (mt) => anyAppliesLp(mt),', '[4]', (f) => {
    const mx = run(steps, pts, null, f);
    T('[4] mutant (the fine on the table\'s rule): the quick quitter fined -- caught', mx.okAll && posts(mx, POINTS, Qq).length === 1, J(posts(mx, POINTS, Qq)));
  });
  T('[4] unit: no seat named (a team-gamble verdict off the roster) -> a mixed table fines nobody, an old ranked code fines',
    PP.seatAppliesLp(1 | S(0b01), -1) === false && PP.seatAppliesLp(2, -1) === true);
}
// ---- [5] D10 pins: a mixed table takes the ranked branch of the anti-farming rules ----
{
  T('[5] Q210 (a whole absent team at a quick settle moves nobody): only a table with no ranked seat', /if \(ghost\.length && !anyLp\) \{/.test(H.SRC));
  T('[5] Q167 (the losing leavers stand in for the winners\' update): any ranked seat', /if \(!ghost\.length && ghostLoss\.length && anyLp\) \{/.test(H.SRC));
  T('[5] Q227 (a seat seen agreeing stands in): any ranked seat', /if \(anyAppliesLp\(matchType\) && !PT_MODE && pend\.agv && pend\.agv\[hx\] != null/.test(H.SRC));
  T('[5] the plan (mismatch over the whole table, D11): the planners open on any ranked seat', /if \(!anyAppliesLp\(matchType\) \|\| isTeamMt\(matchType\) \|\| !parts/.test(fs.readFileSync(path.join(H.ROOT, 'points-plan.js'), 'utf8'))
    && /if \(!anyAppliesLp\(matchType\) \|\| !isTeamMt\(matchType\)\) return null;/.test(fs.readFileSync(path.join(H.ROOT, 'points-plan.js'), 'utf8')));
  T('[5] no whole-table appliesLp(matchType) gate left in the settle (each is anyLp or a seat\'s)', !/appliesLp\(matchType\)\)? *\{|&& appliesLp\(matchType\)/.test(H.SRC.replace(/seatLp = \(sid\) => [^\n]*/, '')), (H.SRC.match(/[^\n]*&& appliesLp\(matchType\)[^\n]*/g) || []).join(' || '));
}
console.log(failN ? ('mixed-table: ' + failN + ' FAIL') : 'mixed-table: all ok');
process.exit(failN ? 1 : 0);
