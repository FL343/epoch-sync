'use strict';
// O716 review (M627, cloud workbench; audit queue Q389): what a QUICK seat of a mixed table settles by.
// Over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js, as test/mixed-table.js).
//   D10 takes the ranked branch of the anti-farming rules (Q210 / Q167) for a whole mixed table; the ranked seats' points and
//   ranked rating settle against the absent team there. A quick seat of that table settles as a quick one (D3): its stored
//   rating takes the update an all-quick table gives it. Before: one ranked-unlocked account and three quick ones taking turns
//   at a quick-family team code (the ranked seat set, the other pair writing the start and leaving) walked the quick seat's
//   stored rating 1000 -> 1795 in 12 turns, and his first ranked settle seeded him from it (3194 points, the seed cap).
//   [1] Q210 path (the whole losing team absent): the quick seat's stored rating as at the all-quick table (no move); the ranked
//       seat's points and stored rating as at the all-ranked table
//   [2] Q167 path (one loser leaves, one stays): the quick seat's stored rating as at the all-quick table (present against
//       present); the ranked seat's as at the all-ranked table
//       (and a table with every seat ranked by the mask settles exactly as the old ranked code)
//   [3] the walk: four turns of [1], then the quick seat's first ranked settle seeds as from the all-quick walk
//   [5] mutants: the quick view taken out (Q210 path / Q167 path) -> each caught
const fs = require('fs'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const ts = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const J = JSON.stringify;
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT;
const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN;
const XPB = 5, RATING = 6, POINTS = 7, CPB = 8;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: CPB, name: 'cp_bank', entries: [] }]);
function run(steps, pts0, files0, script) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || null), null, script || null, 'mtqv');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
const placeIn = (sc, seat) => 1 + sc.filter((x) => x > sc[seat]).length;
function match(mt, hash, ros, res, sc) {
  const St = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, mt, hash, seat, placeIn(sc, seat), placeIn(sc, seat) === 1, ros, sc, 0) }));
  return { S: St, all: St.concat(R), key: hash + '_1234_' + mt };
}
const LEAVE_STEPS = (mm, extra) => [[0, mm.S], [5 * MIN, mm.all.concat(extra || [])], [GRACE, mm.all.concat(extra || [])], [LEAVE, mm.all.concat(extra || [])], [3 * HOUR, mm.all.concat(extra || [])]];
const posts = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const skillIn = (state, sid) => ((state && state.SKILL_FILE) || {})[v.pid(sid)] || null;
const dispIn = (state, sid) => { const s = skillIn(state, sid) || ts.DEFAULTS; return ts.displayRating(s.mu, s.sigma); };
const sameSkill = (a, b) => !!a && !!b && a.mu === b.mu && a.sigma === b.sigma;
const ptsOf = (m, sid) => J(posts(m, POINTS, sid).map((p) => p.score));

let mutN = 0;
function withMutant(from, to, tag, fn) {
  if (H.SRC.split(from).length !== 2) { T(tag + ' mutant anchor found exactly once', false, from.slice(0, 90)); return; }
  const f = path.join(H.ROOT, '.mutant-mtqv-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(f, H.SRC.replace(from, to));
  try { fn(f); } finally { try { fs.unlinkSync(f); } catch (e) {} }
}

// team brawl (base 3: seats 0-1 team 0, 2-3 team 1). R (seat 0) queued ranked, W (seat 1), G1, G2 quick.
const R = H.SID(7161), W = H.SID(7162), G1 = H.SID(7163), G2 = H.SID(7164);
const ROS = [R, W, G1, G2], PTS = { [R]: { score: 1000 } };
const MIXED = 3 | S(0b0001);
// [1] / [2] one table, four ways: all quick (3), mixed (3 + seat 0 ranked), all ranked (4), all ranked by the mask (3 + every seat,
//   as the new client writes it)
const ALLMASK = 3 | S(0b1111);
const table = (res, sc, hashBase, script) => [3, MIXED, 4, ALLMASK].map((mt, i) => {
  const mm = match(mt, hashBase + i, ROS, res, sc);
  return { mm, m: run(LEAVE_STEPS(mm), PTS, null, script) };
});
const CASES = [
  { tag: '[1] Q210 path (the whole losing team absent)', res: [0, 1], sc: [900, 700, 0, 0], h: 0x71601, log: /whole team 1 absent -> rated against/ },
  { tag: '[2] Q167 path (one loser leaves, one stays)', res: [0, 1, 3], sc: [900, 700, 0, 300], h: 0x71611, log: /leaver-ghost / },
];
function checkCase(c, script, mutTag) {
  const [q, x, r, rm] = table(c.res, c.sc, c.h + (script ? 0x100 : 0), script);
  const allOk = [q, x, r, rm].every((t) => t.m.okAll && settled(t.m, t.mm.key));
  if (mutTag) return allOk && dispIn(x.m.last.state, W) !== dispIn(q.m.last.state, W);
  T(c.tag + ': the three tables settle, the mixed one by the ranked branch', allOk && c.log.test(x.m.out), x.m.out.slice(-500));
  T(c.tag + ': the quick seat W\'s stored rating as at the all-quick table (' + dispIn(q.m.last.state, W) + '; the all-ranked table ' + dispIn(r.m.last.state, W) + ')',
    sameSkill(skillIn(x.m.last.state, W), skillIn(q.m.last.state, W)) || (!skillIn(x.m.last.state, W) && !skillIn(q.m.last.state, W)), J([skillIn(q.m.last.state, W), skillIn(x.m.last.state, W)]));
  T(c.tag + ': the ranked seat R\'s points as at the all-ranked table (' + ptsOf(r.m, R) + ')', ptsOf(x.m, R) === ptsOf(r.m, R) && posts(r.m, POINTS, R).length === 1, ptsOf(x.m, R));
  T(c.tag + ': the ranked seat R\'s stored rating as at the all-ranked table', sameSkill(skillIn(x.m.last.state, R), skillIn(r.m.last.state, R)), J([skillIn(x.m.last.state, R), skillIn(r.m.last.state, R)]));
  T(c.tag + ': every seat ranked by the mask settles as the old ranked code (stored ratings, points)', [R, W, G1, G2].every((s) => sameSkill(skillIn(rm.m.last.state, s), skillIn(r.m.last.state, s)) && ptsOf(rm.m, s) === ptsOf(r.m, s)),
    J([R, W, G1, G2].map((s) => [ptsOf(r.m, s), ptsOf(rm.m, s)])));
  T(c.tag + ': no points row for a quick seat (D3 / D9)', [W, G1, G2].every((s) => posts(x.m, POINTS, s).length === 0));
  return true;
}
for (const c of CASES) checkCase(c);

// [3] the walk: four turns of [1] spaced 3 h apart, then W's first ranked 1V1 against X (1000 points)
const X = H.SID(7169);
function walk(mt, script) {
  let state = null, pts = Object.assign({}, PTS);
  for (let i = 0; i < 4; i++) {
    const mm = match(mt, 0x71700 + i + (mt === 3 ? 0 : 0x10) + (script ? 0x100 : 0), ROS, [0, 1], [900, 700, 0, 0]);
    const m = run(LEAVE_STEPS(mm).map(([ms, recs], j) => [j === 0 && state ? 3 * HOUR : ms, recs]), pts, state, script);
    if (!m.okAll || !settled(m, mm.key)) return { bad: m.out.slice(-500) };
    state = m.last.state; pts = m.pts;
  }
  const disp = dispIn(state, W);
  const mm = match(2, 0x71790 + (mt === 3 ? 0 : 1) + (script ? 0x100 : 0), [W, X], [0, 1], [800, 400]);
  const m = run([[3 * HOUR, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [6 * MIN, mm.all]], Object.assign({ [X]: { score: 1000 } }, pts), state, script);
  const seed = /first settle this season, display (-?[0-9]+) -> pts (-?[0-9]+)/.exec((m.out.match(new RegExp('seed [^\\n]*' + v.pid(W).slice(0, 8) + '[^\\n]*')) || [''])[0]);
  return { disp, seed: seed ? +seed[2] : null, ok: m.okAll && settled(m, mm.key), out: m.out };
}
{
  const a = walk(3), b = walk(MIXED);
  T('[3] both walks settle, W seeded at his first ranked settle', !a.bad && !b.bad && a.ok && b.ok && a.seed != null && b.seed != null, (a.bad || '') + (b.bad || '') + (b.out || '').slice(-300));
  T('[3] after four mixed turns W seeds as after four all-quick ones (display ' + a.disp + ' / ' + b.disp + ', seed ' + a.seed + ' / ' + b.seed + ')',
    !a.bad && !b.bad && a.disp === b.disp && a.seed === b.seed, J([a, b].map((k) => [k.disp, k.seed])));
}

// [5] mutants
withMutant('      if (quickView) tsOut = tsOut.flatMap(', '      if (false) tsOut = tsOut.flatMap(', '[5a]', (f) =>
  T('[5a] mutant (the quick view taken out): [1] W moves against the absent team -- caught', checkCase(CASES[0], f, true)));
withMutant('          if (rankedSeatMaskOf(matchType)) quickView = new Map(tsOut.map(', '          if (false) quickView = new Map(tsOut.map(', '[5b]', (f) =>
  T('[5b] mutant (the Q167 quick view taken out): [2] W moves against the leaver -- caught', checkCase(CASES[1], f, true)));

console.log(failN ? ('mixed-table-quick-view: ' + failN + ' FAIL') : 'mixed-table-quick-view: all ok');
process.exit(failN ? 1 : 0);
