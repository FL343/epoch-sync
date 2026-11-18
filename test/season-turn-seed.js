'use strict';
// O786 season turn drill (companion KNIFE_O785_LP_LANDING_PLAN section 6 item 3): the first ranked settle of season 1, run through the
// real job (stubbed Steam), seeds every player with the new rules:
//   [1] a previous-season finish drops one tier, 60 under its line: gold 2500 -> 1940, silver 1999 -> 540, grandmaster 8500 -> 5940
//       (reveal at most diamond), bronze 300 kept
//   [2] a player with no previous-season row (new to ranked) is measured with the same ruler: his display seed soft-resets
//       (display 1650 -> seed 1600 -> 540), not the plain seed 1600
//   [3] the same new player in the preseason keeps the plain seed (1600): the one-ruler branch is a season 1+ rule
//   [4] every seed landing past bronze sits in a promotion band (the first match of the season is a promotion match)
const path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const MIN = 60000;
const POINTS = 7, S1B = 9;
const PRE = { SEASON_NOW: '2098-12-31T20:00:00Z' }, S1 = { SEASON_NOW: '2099-01-01T00:10:00Z' };
const ents = (rows) => Object.keys(rows || {}).map((s) => ({ steamID: s, score: rows[s].score, details: rows[s].details || [] }));
const boardsOf = (recs, rows) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: ents(rows.points) }, { id: S1B, name: 'points_s1', entries: ents(rows.s1) }, { id: 8, name: 'cp_bank', entries: [] }]);
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, all: S.concat(R) };
}
function run(steps, rows, files) {
  const rs = [];
  let state = files || null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, rows), rs.length ? H.advance(state, ms) : state, env, null, 'season-turn-seed');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, out: rs.map((r) => r.out).join(''), okAll: rs.length === steps.length && rs.every((r) => r.code === 0) };
}
const plog = (sid) => v.pid(String(sid)).slice(0, 8);
const resetLine = (out, sid) => (new RegExp('seed [^\\n]*' + plog(sid) + ' first settle this season, soft-reset from (-?[0-9]+) -> pts (-?[0-9]+)').exec(out) || []).slice(1).map(Number);
const displayLine = (out, sid) => (new RegExp('seed [^\\n]*' + plog(sid) + ' first settle this season, display ([0-9]+) -> pts (-?[0-9]+)').exec(out) || []).slice(1).map(Number);

console.log('=== O786 the first settle of season 1 seeds with the new rules (real job, stubbed Steam) ===');
const G = H.SID(7861), S = H.SID(7862), GM = H.SID(7863), N = H.SID(7864), B = H.SID(7865);
// N: display 1650 = (mu - 3 sigma) * 40 + 1000 with sigma 2 -> mu 22.25 (the seed reads his stored rating)
const files = { SKILL_FILE: { [v.pid(N)]: { mu: 22.25, sigma: 2 } } };
{
  const m = match(2, 0x7861, [G, S, GM, N]);
  const rows = { points: { [G]: { score: 2500 }, [S]: { score: 1999 }, [GM]: { score: 8500 } }, s1: {} };
  const r = run([[0, m.S, S1], [5 * MIN, m.all, S1]], rows, files);
  T('the season 1 match settles', r.okAll && /season 1: points -> points_s1 \(soft-reset source points\)/.test(r.out), r.out.slice(-800));
  T('[1] gold 2500 -> 1940, silver 1999 -> 540, grandmaster 8500 -> 5940 (one tier down, 60 under the line; reveal at most diamond)',
    J(resetLine(r.out, G)) === '[2500,1940]' && J(resetLine(r.out, S)) === '[1999,540]' && J(resetLine(r.out, GM)) === '[8500,5940]',
    J([resetLine(r.out, G), resetLine(r.out, S), resetLine(r.out, GM)]));
  T('[2] new to ranked in season 1: display 1650 -> 540 (his seed 1600 soft-reset: one ruler with the players who played)', J(displayLine(r.out, N)) === '[1650,540]', J(displayLine(r.out, N)) + ' ' + r.out.slice(-600));
  T('[4] every landing past bronze is in a promotion band', [1940, 540, 5940].every((x) => PP.boundaryOf(x) === 'promotion'));
}
{
  const m = match(2, 0x7862, [B, N]);
  const r = run([[0, m.S, S1], [5 * MIN, m.all, S1]], { points: { [B]: { score: 300 } }, s1: {} }, files);
  T('[1] bronze 300 kept', r.okAll && J(resetLine(r.out, B)) === '[300,300]', J(resetLine(r.out, B)));
}
{
  const m = match(2, 0x7863, [B, N]);
  const r = run([[0, m.S, PRE], [5 * MIN, m.all, PRE]], { points: { [B]: { score: 300 } }, s1: {} }, files);
  T('[3] the same new player in the preseason keeps the plain seed: display 1650 -> 1600', r.okAll && J(displayLine(r.out, N)) === '[1650,1600]', J(displayLine(r.out, N)) + ' ' + r.out.slice(-600));
}

console.log(failN ? ('season-turn-seed: ' + failN + ' FAIL') : 'season-turn-seed: all ok');
process.exit(failN ? 1 : 0);
