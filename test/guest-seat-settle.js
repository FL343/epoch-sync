'use strict';
// O989 a couch pair in the online queue: one machine = one account (the main) plus a guest seat with no account. The guest
// seats of a table are bits 17-22 of the match type (points-plan.js GUEST_SEAT_SHIFT); the roster leaves them empty and the
// guest of seat g belongs to the account at seat g - 1. Over the REAL validate.js main() (offline board stub,
// test/lib/settle-stub.js):
//   [1] K2: an outside account's start from a declared guest seat (naming itself there) registers nowhere and its result
//       counts nowhere; nobody is flagged, the players settle. Mutant (the start drop taken out) -> the outsider is seated
//   [2] a declared guest seat is no blank seat: the players' starts vote as ever (no start-blank line)
//   [3] quick brawl with a couch pair (3 / 4 / 6 seats): the guest takes his place and counts in the player count for
//       everybody (XP as at a table where the guest is an account), the guest himself appears in no output
//   [4] ranked seats: a stranger settles as at the table where the guest is an ordinary account, a losing solo never worse
//       (the couch shield); the main settles by the average place of his two seats; mutants
//   [5] team codes: the guest seat counts as accounted for (Q149), the team is rated at full strength; the couch 2V2 (two
//       accounts, a guest each) settles; mutant (the guest seat left unaccounted) -> no rating move
//   [6] everybody else quit: the stayer of a couch table still takes the quit-lone settle (the guest follows his main)
//   [7] the header checks: a guest bit on a code / seat that cannot carry one holds the match, nobody flagged; a result
//       written from a guest seat or naming an account there drops that record alone, nobody flagged, its writer no leaver
//   [8] rules-cfg: the values of the run that settles a couch match are the ones on its receipts (revision stamp); a later
//       revision does not re-read a settled match; the pulse row carries the cfg
//   [9] the couch-match signal, and the synthetic guest id is in no state file and no board write
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
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT, G = (seats) => seats << PP.GUEST_SEAT_SHIFT;
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const on = (n) => !ONLY.length || ONLY.indexOf(String(n)) >= 0;

const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN;
const XPB = 5, RATING = 6, POINTS = 7, CPB = 8, PULSE = 9, VGATE = 10;
const OPS = H.SID(9000001);
const boardsOf = (recs, pts, extra) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: CPB, name: 'cp_bank', entries: [] }].concat(extra || []));
// steps: [[ms since the previous run, records]]; pts carried run to run (each points write lands); files0: the first run's state
function run(steps, pts0, files0, script, env, extra) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, pts, extra), state ? H.advance(state, ms) : (files0 || null), env || null, script || null, 'guest-seat');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// a matchmade table (mt) on seats ros ('0' = a guest seat): every account seat writes its start (unless noStart), `res` = the
//   seats writing a result; scores descending by seat (sc overrides)
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const St = ros.map((s, seat) => ({ sid: s, seat, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) })).filter((x) => x.sid !== '0' && !(o.noStart || []).includes(x.seat));
  const R = res.map((seat) => ({ sid: ros[seat], seat, d: H.rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, o.disp == null ? 0 : o.disp) }));
  return { S: St, R, all: St.concat(R), key: hash + '_1234_' + mt, mh: hash | 0, sc, ros, mt, rankOf };
}
const SETTLE = (mm, more) => [[0, mm.S.concat(more || [])], [5 * MIN, mm.all.concat(more || [])], [GRACE, mm.all.concat(more || [])], [6 * MIN, mm.all.concat(more || [])]];
const posts = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const lastOf = (m, board, sid) => { const w = posts(m, board, sid); return w.length ? w[w.length - 1] : null; };
const ringOf = (m, sid) => { const w = lastOf(m, POINTS, sid); return w ? PP.lpDetailsOf(w.details).ring : null; };
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const skillOf = (m, sid) => (m.last.state.SKILL_FILE || {})[v.pid(sid)] || null;
const sigOf = (m, sid) => (((m.last.state.SIGNALS_FILE || {}).players) || {})[v.pid(sid)] || null;
const flaggedN = (m) => Object.keys(((m.last.state.SIGNALS_FILE || {}).flagged) || {}).length;
const xpOf = (m, sid) => { const w = lastOf(m, XPB, sid); return w ? w.score : null; };
let mutN = 0;
function mutantOf(file, from, to, tag) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once: ' + from.slice(0, 90)); return null; }
  const f = path.join(H.ROOT, '.mutant-guest-seat-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(f, src.replace(from, to));
  return f;
}
const withMutant = (from, to, tag, fn) => { const f = mutantOf(H.VALIDATE, from, to, tag); if (!f) return; try { fn(f); } finally { try { fs.unlinkSync(f); } catch (e) {} } };

console.log('=== O989 guest seats: a couch pair in the online queue ===');
const A = H.SID(9891), B = H.SID(9892), C = H.SID(9893), D = H.SID(9894), E = H.SID(9895), X = H.SID(9899);
const Z = '0';

// ---- [1] K2: an outside account claims the guest seat ----
if (on(1)) {
  const mt = 1 | G(0b0010);
  const ros = [A, Z, B, C], rosX = [A, X, B, C];
  const mm = match(mt, 0x98901, ros, [0, 2, 3]);
  const xs = { sid: X, seat: 1, d: H.rec(0xB2, mt, 0x98901, 1, 0, false, rosX, mm.sc) };
  const xr = { sid: X, seat: 1, d: H.rec(0xB1, mt, 0x98901, 1, 2, false, rosX, mm.sc, 0) };
  const steps = [[0, mm.S.concat([xs])], [5 * MIN, mm.all.concat([xs, xr])], [GRACE, mm.all.concat([xs, xr])], [6 * MIN, mm.all.concat([xs, xr])]];
  const m = run(steps, {});
  const st = (m.rs[0].state.STARTS_FILE || {})[mm.key] || {};
  T('[1] the outside start from the guest seat registers nowhere: the roster seats the three accounts, the guest seat empty',
    m.okAll && J(Object.keys(st.roster || {}).sort()) === J(['0', '2', '3']) && !st.split, J(st) + m.rs[0].out.slice(-600));
  T('[1] the players settle; the outsider earns nothing and is rated nowhere', settled(m, mm.key) && [A, B, C].every((s) => xpOf(m, s) > 0 && skillOf(m, s)) && xpOf(m, X) == null && !skillOf(m, X),
    J([xpOf(m, A), xpOf(m, X), skillOf(m, X)]) + m.out.slice(-900));
  T('[1] nobody flagged', flaggedN(m) === 0, J((m.last.state.SIGNALS_FILE || {}).flagged));
  if (ONLY.indexOf('k2raw') >= 0) console.log(m.out);
}
console.log(failN ? ('guest-seat-settle: ' + failN + ' FAIL') : 'guest-seat-settle: all ok');
process.exit(failN ? 1 : 0);
