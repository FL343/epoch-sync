'use strict';
// O480 R1 (pseudo-realtime ladder): the rating row carries the rating the points plan reads.
// The mismatch check of a ranked settle reads the ranked rating (rm / rv in skill.json; the stored one until a player has one),
// and the rating board's own score is the stored rating after the repeat-group decay -- another number. For the client to run
// the same points plan over its opponents (points-plan.js), every rating write now carries details
// [RATING_MAGIC 0xCD, plan rating, RULES_VER, 0]. A row from before carries none (the reader falls back to the score).
//   [1] codec: ratingDetails / ratingDetailsOf round trip; a row without details or with another magic decodes to null
//   [2] ranked 1V1 over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js): both rating writes carry the
//       details, the plan rating = the display of the ranked rating the settle stored (what the next ranked settle reads)
//   [3] quick 1V1 between accounts with no ranked rating: the plan rating = the row's own score (the stored rating stands in)
//   [4] quick 1V1 where one account has a ranked rating: his plan rating stays his ranked one (a quick settle does not move
//       it), the other's = his score
//   [5] wiring: the settle's mismatch reads the same rating (rIn) the writer publishes (rankedRatingOf, else stored)
// Residual (kept on purpose): a losing leaver whose ranked rating moved alone (Q167 rework) gets no rating write (his stored rating
// and his row stay as they were, test/leaver-ghost.js / test/team-absent-rating.js pin that), so his published plan rating catches
// up at his next rated settle.
const path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const tsm = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

console.log('=== the rating row carries the rating the points plan reads (O480) ===');
// ---- [1] codec ----
T('[1] ratingDetails = [0xCD, rating, RULES_VER, 0]', J(PP.ratingDetails(1234)) === J([0xCD, 1234, PP.RULES_VER, 0]) && PP.RATING_MAGIC === 0xCD);
T('[1] round trip', J(PP.ratingDetailsOf(PP.ratingDetails(987))) === J({ rating: 987, rulesVer: PP.RULES_VER }));
T('[1] a row from before (no details) decodes to null', PP.ratingDetailsOf([]) === null && PP.ratingDetailsOf(null) === null && PP.ratingDetailsOf(undefined) === null);
T('[1] another magic decodes to null', PP.ratingDetailsOf([0xC5, 1, 2, 3, 4, 5]) === null && PP.ratingDetailsOf([0xCD, 5]) === null);

// ---- a 1V1 played out: starts, then results, the job running every 6 minutes ----
const MIN = 60000;
const RATING = 6, POINTS = 7;
function play(mt, hash, a, b, aWins, skill0, lp0) {
  const ros = [a, b];
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, [0, 0]) }));
  const sc = aWins ? [6100, 3000] : [3000, 6100];
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, (seat === 0) === aWins ? 1 : 2, (seat === 0) === aWins, ros, sc) }));
  const boards = (recs) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: ros.filter((s) => lp0 && lp0[s] != null).map((s) => ({ steamID: s, score: lp0[s] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
  const rs = [];
  let state = null;
  for (const [ms, recs] of [[0, S], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]]) {
    const r = H.runCron(boards(recs), state ? H.advance(state, ms) : (skill0 ? { SKILL_FILE: skill0 } : null), null, null, 'rating-details');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  const last = rs[rs.length - 1];
  return { rs, last, key: H.keyOf(S[0].d), out: rs.map((r) => r.out).join('') };
}
const ratingWrites = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, RATING, sid)));
const skillOf = (r, sid) => ((r.state.SKILL_FILE || {})[v.pid(sid)]) || null;
const disp = (mu, sigma) => tsm.displayRating(mu, sigma);
const planOf = (r, sid) => { const s = skillOf(r, sid); return Number.isFinite(s && s.rm) ? disp(s.rm, s.rv) : disp(s.mu, s.sigma); };

const A = H.SID(4801), B = H.SID(4802), C = H.SID(4803), D = H.SID(4804), E = H.SID(4805), F = H.SID(4806);
// ---- [2] ranked 1V1, A holds a ranked rating apart from his stored one, B none ----
{
  const sk = { [v.pid(A)]: { mu: 27, sigma: 4, rm: 31, rv: 3 } };
  const m = play(2, 0xD480, A, B, true, sk, { [A]: 2500, [B]: 2400 });
  T('[2] four runs exit 0 and the match settles', m.rs.every((r) => r.code === 0) && new Set(m.last.state.PROCESSED_FILE || []).has(m.key), m.last.out.slice(-600));
  for (const [sid, nm] of [[A, 'A'], [B, 'B']]) {
    const w = ratingWrites(m, sid), s = skillOf(m.last, sid);
    T('[2] ' + nm + ': one rating write, score = his stored rating, details [0xCD, the plan rating, RULES_VER, 0]', w.length === 1
      && w[0].score === disp(s.mu, s.sigma) && J(w[0].details) === J([0xCD, planOf(m.last, sid), PP.RULES_VER, 0]), J(w) + ' skill ' + J(s));
    T('[2] ' + nm + ': the plan rating is his RANKED rating after the update (moved by this ranked settle)', Number.isFinite(s.rm) && w.length === 1 && w[0].details[1] === disp(s.rm, s.rv), J(s));
  }
  T('[2] A\'s published plan rating differs from his row score (the two numbers the client must not mix up)', ratingWrites(m, A)[0] && ratingWrites(m, A)[0].details[1] !== ratingWrites(m, A)[0].score, J(ratingWrites(m, A)));
}
// ---- [3] quick 1V1, no ranked rating on either side ----
{
  const m = play(1, 0xD481, C, D, false, null, null);
  T('[3] settled', m.rs.every((r) => r.code === 0) && new Set(m.last.state.PROCESSED_FILE || []).has(m.key), m.last.out.slice(-600));
  for (const [sid, nm] of [[C, 'C'], [D, 'D']]) {
    const w = ratingWrites(m, sid), s = skillOf(m.last, sid);
    T('[3] ' + nm + ': plan rating = the row score (the stored rating stands in), no ranked rating stored', w.length === 1 && w[0].details && w[0].details[1] === w[0].score
      && w[0].score === disp(s.mu, s.sigma) && !Number.isFinite(s.rm), J(w) + ' ' + J(s));
  }
}
// ---- [4] quick 1V1, E holds a ranked rating ----
{
  const sk = { [v.pid(E)]: { mu: 26, sigma: 5, rm: 33, rv: 2.5 } };
  const m = play(1, 0xD482, E, F, true, sk, null);
  const w = ratingWrites(m, E), s = skillOf(m.last, E);
  T('[4] E: the quick settle keeps his ranked rating, the details carry it (not his moved score)', w.length === 1 && s.rm === 33 && s.rv === 2.5
    && w[0].details[1] === disp(33, 2.5) && w[0].score === disp(s.mu, s.sigma) && w[0].score !== w[0].details[1], J(w) + ' ' + J(s));
  const wf = ratingWrites(m, F);
  T('[4] F: plan rating = his score', wf.length === 1 && wf[0].details[1] === wf[0].score, J(wf));
}
// ---- [5] wiring ----
T('[5] the plan reads rankedRatingOf(skill) at a ranked settle, the writer publishes the same (else the stored display)',
  /const rIn = \(sid, base\) => \{ const rr = rankedNow \? rankedRatingOf\(skill\[pid\(sid\)\]\) : null;/.test(H.SRC)
  && /const rr = rankedRatingOf\(skill\[pid\(sid\)\]\);\n\s*const planRating = rr \? ts\.displayRating\(rr\.mu, rr\.sigma\) : disp;/.test(H.SRC)
  && /, ratingDetails\(planRating\)\);/.test(H.SRC));

console.log(failN ? ('rating-details: ' + failN + ' FAIL') : 'rating-details: all ok');
process.exit(failN ? 1 : 0);
