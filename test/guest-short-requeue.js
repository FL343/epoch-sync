'use strict';
// guest-short-requeue (O989): a machine with a couch guest enters a matchmade room; the host's seat table seats its account
// (the main) but not the guest (the declaration came too late). The client refuses that start frame: it does not adopt
// the match, writes NO start record, no result and no abandon confession, leaves the room and goes back to the queue. The
// other players play the match to the end and write their records, their rosters naming the main at his seat.
// What the job does with it rests on Q69 (a leave is convicted only on the player's OWN record for the match -- see
// test/leaver-own-record.js for the rule itself); this file pins that exact shape, table by table, over the REAL
// validate.js main() (offline board stub, test/lib/settle-stub.js):
//   [1] brawl of four, the main's seat ranked / quick: the three others settle among themselves after the absence grace
//       alone (no 60 min leave wait); the main gets no exit, no points fine, no rating, no XP, no streak event -- not one
//       board write; nobody is flagged
//   [2] the one trace: a main who has signals of his own is counted (nb, Q174) when the others place him in the lower half
//       -- a counter, no flag, no penalty; one who has none is not counted
//   [3] team brawl (base 3), 2V2 duel (base 5), 3V3 duel (base 8): the main on the LOSING team -> the match settles with no
//       rating move for anybody (Q149 named-loser: his teammate loses nothing, the winners gain nothing), XP as ever; the
//       main untouched. The main on the WINNING team -> rated as ever, the main untouched
//   [4] a table of two (the main + one stranger): the stranger's lone records never settle and convict nobody
//   [5] the table never settles (start-orphan verdict at maturity): the main is not convicted
//   [6] the boundary -- what DOES make it a leave: the main's own start record (level 1 began on his machine), or his own
//       abandon confession. The client's requeue path must write neither
//   [7] the seat table DID seat the guest (guest bit set) and the main still wrote nothing: the same -- pair out, the
//       others settle, nobody convicted or flagged (only on a job that reads guest seats)
//   [8] mutants: the named-only filter of the settle path / of the start-orphan verdict taken out -> the main is convicted
//   node test/guest-short-requeue.js [sections, e.g. 1,3]
const fs = require('fs'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
for (const k of H.FILE_VARS) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const ts = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT;
const HAS_GUEST = PP.GUEST_SEAT_SHIFT != null;
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const on = (n) => !ONLY.length || ONLY.indexOf(String(n)) >= 0;

const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const LEAVE_WAIT = (v.LEAVE_CONFIRM_MS || HOUR) + MIN;
const XPB = 5, RATING = 6, POINTS = 7, CPB = 8, VGATE = 9;
const OPS = H.SID(9000001);
const VG = { id: VGATE, name: 'version_gate', entries: [{ steamID: OPS, score: 1 }] };
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: CPB, name: 'cp_bank', entries: [] }, VG]);
// steps: [[ms since the previous run, records]]; pts carried run to run
function run(steps, pts0, files0, script) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const files = state ? H.advance(state, ms) : Object.assign({}, files0 || {});
    const r = H.runCron(boardsOf(recs, pts), files, null, script || null, 'guest-short');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster;
//   a start (0xB2) and a confession (0xB5) carry zeroed results
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, zero ? 1 : 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : ((sc || [])[i] | 0));
  d.push(disp | 0);
  for (const s of ros) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const Z = '0';
// a matchmade table (mt) on seats ros ('0' = a guest seat): `st` = the seats writing a start, `res` = the seats writing a
//   result; o.sc = the scores by seat (the absent main's seat reads 0); o.ranks = the rank claims by seat (duel codes: the
//   winning team's block first), else the place by score
function match(mt, hash, ros, st, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => (o.ranks ? o.ranks[seat] : 1 + sc.filter((x) => x > sc[seat]).length);
  const winOf = (seat) => (o.ranks ? o.ranks[seat] <= ros.length / 2 : rankOf(seat) === 1);
  const St = st.map((seat) => ({ sid: ros[seat], seat, d: rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = res.map((seat) => ({ sid: ros[seat], seat, d: rec(0xB1, mt, hash, seat, rankOf(seat), winOf(seat), ros, sc, 0) }));
  return { S: St, R, all: St.concat(R), key: hash + '_1234_' + mt, mh: hash | 0, sc, ros, mt };
}
const cat = (list, f) => [].concat(...list.map(f));
// the four runs of a settle that waits for nothing but the absence grace
const SETTLE = (mm, more) => { const ms = Array.isArray(mm) ? mm : [mm], x = more || []; return [[0, cat(ms, (m) => m.S).concat(x)], [5 * MIN, cat(ms, (m) => m.all).concat(x)], [GRACE, cat(ms, (m) => m.all).concat(x)], [6 * MIN, cat(ms, (m) => m.all).concat(x)]]; };
const posts = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const settledAt = (m, key) => m.rs.findIndex((r) => new Set(r.state.PROCESSED_FILE || []).has(key));
const skillOf = (m, sid) => (m.last.state.SKILL_FILE || {})[v.pid(sid)] || null;
const sigOf = (m, sid) => (((m.last.state.SIGNALS_FILE || {}).players) || {})[v.pid(sid)] || null;
const flaggedN = (m) => Object.keys(((m.last.state.SIGNALS_FILE || {}).flagged) || {}).length;
const leavesOf = (m, sid) => (((m.last.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const lastPost = (m, board, sid) => { const w = posts(m, board, sid); return w.length ? w[w.length - 1] : null; };
const xpOf = (m, sid) => { const w = lastPost(m, XPB, sid); return w ? w.score : null; };
const ptsOf = (...sids) => { const o = {}; for (const s of sids) o[s] = { score: 1000 }; return o; };
// every board write of the whole run that names the account, whatever the board
const anyWrite = (m, sid) => [].concat(...m.rs.map((r) => r.posts.filter((p) => new RegExp('steamid=' + sid + '(&|$)').test(p.body)))).length;
// the state files of the last run that still hold the account's pid (the settled key's start entry is gone by then)
const stateFilesWith = (m, sid) => Object.keys(m.last.state).filter((f) => J(m.last.state[f] || null).indexOf(v.pid(sid)) >= 0).sort();
// untouched: no exit, no rating row, no board write of any kind, no state file names him
const untouched = (m, sid) => leavesOf(m, sid) === 0 && !skillOf(m, sid) && anyWrite(m, sid) === 0 && stateFilesWith(m, sid).length === 0;
const why = (m, sid) => J({ leaves: leavesOf(m, sid), skill: skillOf(m, sid), writes: anyWrite(m, sid), files: stateFilesWith(m, sid) });
const NOT_A_LEAVER = (key, seat) => new RegExp('leaver ' + key + ': seat ' + seat + ' = \\S+ named by the others but never wrote his own record for this match -- not a leaver \\(Q69\\)');
// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const tmpFiles = [];
process.on('exit', () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) {} } });
let mutN = 0;
function vMut(from, to, tag) {
  const src = fs.readFileSync(H.VALIDATE, 'utf8');
  if (src.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once: ' + from.slice(0, 90)); return null; }
  const f = path.join(H.ROOT, '.mutant-guest-short-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(f, src.replace(from, to)); tmpFiles.push(f);
  return f;
}

console.log('=== guest-short-requeue: a seated main who refused the start frame and wrote nothing ===');
const SIDS = (base) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => H.SID(base + i));

// ---- [1] brawl of four ----
if (on(1)) {
  for (const [label, mt, base] of [['every seat ranked', 1 | S(0b1111), 97110], ['every seat quick', 1, 97120], ['the main quick, the others ranked', 1 | S(0b0111), 97130], ['the main ranked, the others quick', 1 | S(0b1000), 97140]]) {
    const [A, B, C, M] = SIDS(base);
    // the main sits at seat 3; the others' records read his seat at 0 (he never played)
    const mm = match(mt, 0x97100 + (base % 100), [A, B, C, M], [0, 1, 2], [0, 1, 2], { sc: [900, 700, 500, 0] });
    const m = run(SETTLE(mm), ptsOf(A, B, C, M));
    const rankedOthers = [0, 1, 2].filter((s) => PP.seatAppliesLp(mt, s));
    T('[1] ' + label + ': the three others settle among themselves in the run after the absence grace (no leave wait)', m.okAll && settledAt(m, mm.key) === 2, 'settled at run ' + settledAt(m, mm.key) + m.out.slice(-1200));
    T('[1] ' + label + ': the main is logged named-only, not a leaver (Q69)', NOT_A_LEAVER(mm.key, 3).test(m.out), m.out.slice(-900));
    T('[1] ' + label + ': the main is untouched -- no exit, no rating, not one board write (points 1000 as before), in no state file', untouched(m, M) && m.pts[M].score === 1000, why(m, M));
    T('[1] ' + label + ': the others are rated and earn XP; their points move only on ranked seats (' + rankedOthers.length + ' of 3); nobody is flagged',
      [A, B, C].every((s) => skillOf(m, s) && xpOf(m, s) > 0) && [A, B, C].every((s, i) => (posts(m, POINTS, s).length > 0) === PP.seatAppliesLp(mt, i)) && flaggedN(m) === 0 && leavesOf(m, A) + leavesOf(m, B) + leavesOf(m, C) === 0,
      J([A, B, C].map((s) => [!!skillOf(m, s), xpOf(m, s), posts(m, POINTS, s).length])));
  }
}

// ---- [2] the one trace ----
if (on(2)) {
  const [A, B, C, M, E] = SIDS(97210), [A2, B2, C2, M2] = SIDS(97220);
  const first = match(1, 0x97201, [M, E], [0, 1], [0, 1], { sc: [900, 500] });   // the main played a match of his own before (signals of his own)
  const gs = match(1 | S(0b1111), 0x97202, [A, B, C, M], [0, 1, 2], [0, 1, 2], { sc: [900, 700, 500, 0] });
  const gs2 = match(1 | S(0b1111), 0x97203, [A2, B2, C2, M2], [0, 1, 2], [0, 1, 2], { sc: [900, 700, 500, 0] });
  const m = run(SETTLE([first, gs, gs2]), ptsOf(A, B, C, M, A2, B2, C2, M2));
  const sg = sigOf(m, M) || {};
  T('[2] a main with signals of his own: the table counts on him as one lower-half place the others wrote for him (nb 1, three accounts) -- a counter',
    m.okAll && settled(m, gs.key) && (sg.nb | 0) === 1 && (sg.nbo || []).length === 3 && /named-ffa-account /.test(m.out) && /counted, nobody flagged \(Q174\)/.test(m.out), J(sg));
  T('[2] ... and nothing else: no exit, no points write, nobody flagged', leavesOf(m, M) === 0 && posts(m, POINTS, M).length === 0 && m.pts[M].score === 1000 && flaggedN(m) === 0, why(m, M));
  T('[2] a main with no signals of his own is not counted at all (no entry is made for him)', settled(m, gs2.key) && !sigOf(m, M2) && untouched(m, M2), why(m, M2));
  T('[2] each of the three writers carries the "named a seat that never wrote" counter (un 1) -- a counter as well', [A, B, C].every((s) => ((sigOf(m, s) || {}).un | 0) === 1), J([A, B, C].map((s) => (sigOf(m, s) || {}).un)));
}

// ---- [3] team codes ----
if (on(3)) {
  // seats 0..ts-1 = team 0, ts..2ts-1 = team 1; the main's seat reads 0
  const cases = [
    ['team brawl (base 3)', 3 | S(0b1111), 97310, 4, { lose: { sc: [500, 0, 900, 700] }, win: { sc: [2500, 0, 900, 700] } }],
    ['2V2 duel (base 5)', 5 | S(0b1111), 97330, 4, { lose: { sc: [500, 0, 900, 700], ranks: [3, 4, 1, 2] }, win: { sc: [2500, 0, 900, 700], ranks: [1, 2, 3, 4] } }],
    ['3V3 duel (base 8)', 8 | S(0b111111), 97350, 6, { lose: { sc: [500, 400, 0, 900, 800, 700], ranks: [4, 5, 6, 1, 2, 3] }, win: { sc: [2500, 2400, 0, 900, 800, 700], ranks: [1, 2, 3, 4, 5, 6] } }],
  ];
  for (const [label, mt, base, pc, o] of cases) {
    const tsz = pc / 2, mSeat = tsz - 1;   // the main is the last seat of team 0
    const acc = SIDS(base).slice(0, pc), accW = SIDS(base + 10).slice(0, pc);
    const others = acc.map((_, i) => i).filter((i) => i !== mSeat);
    const lose = match(mt, 0x97300 + (base % 100), acc, others, others, o.lose);
    const win = match(mt, 0x97300 + (base % 100) + 1, accW, others, others, o.win);
    const m = run(SETTLE([lose, win]), ptsOf(...acc, ...accW));
    const M = acc[mSeat], MW = accW[mSeat], mates = others.filter((i) => i < tsz), opp = others.filter((i) => i >= tsz);
    T('[3] ' + label + ', the main on the losing team: the match settles after the grace with no rating move for anybody (Q149 named-loser)',
      m.okAll && settledAt(m, lose.key) === 2 && new RegExp('named-loser ' + lose.key + ': seat ' + mSeat + ' \\(named by the others only\\)').test(m.out) && others.every((i) => !skillOf(m, acc[i]) && posts(m, POINTS, acc[i]).length === 0),
      J(others.map((i) => [!!skillOf(m, acc[i]), posts(m, POINTS, acc[i]).length])) + m.out.slice(-1200));
    T('[3] ' + label + ': ... his teammate(s) lose nothing, the winners gain nothing, everybody who played gets the XP; nobody flagged, nobody a leaver',
      others.every((i) => m.pts[acc[i]].score === 1000 && xpOf(m, acc[i]) > 0 && leavesOf(m, acc[i]) === 0) && flaggedN(m) === 0, J(others.map((i) => [m.pts[acc[i]].score, xpOf(m, acc[i])])));
    T('[3] ' + label + ': ... the main is untouched', untouched(m, M) && m.pts[M].score === 1000, why(m, M));
    T('[3] ' + label + ', the main on the winning team: rated as ever (his team wins, the other team loses), the main untouched',
      settledAt(m, win.key) === 2 && !new RegExp('named-loser ' + win.key).test(m.out) && mates.every((i) => skillOf(m, accW[i]) && skillOf(m, accW[i]).mu > ts.DEFAULTS.mu)
      && opp.every((i) => skillOf(m, accW[i]) && skillOf(m, accW[i]).mu < ts.DEFAULTS.mu) && untouched(m, MW) && m.pts[MW].score === 1000,
      J(others.map((i) => skillOf(m, accW[i]) && skillOf(m, accW[i]).mu)) + why(m, MW));
  }
}

// ---- [4] a table of two ----
if (on(4)) {
  const MATURE = (v.STARTS_MATURITY_MS || 2 * HOUR) + 10 * MIN;
  for (const [label, mt, base] of [['both seats ranked', 1 | S(0b11), 97410], ['both seats quick', 1, 97420]]) {
    const [A, M] = SIDS(base);
    // the stranger alone at the table: his start, and a result of his own if his client wrote one
    const mm = match(mt, 0x97400 + (base % 100), [A, M], [0], [0], { sc: [900, 0] });
    const m = run([[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [MATURE, mm.all], [6 * MIN, mm.all]], ptsOf(A, M));
    T('[4] ' + label + ': the stranger\'s lone start registers no roster, his lone result never settles; he is not a leaver and not flagged',
      m.okAll && !settled(m, mm.key) && !skillOf(m, A) && leavesOf(m, A) === 0 && flaggedN(m) === 0 && m.pts[A].score === 1000, why(m, A) + m.out.slice(-900));
    T('[4] ' + label + ': the main is untouched', untouched(m, M) && m.pts[M].score === 1000, why(m, M));
  }
}

// ---- [5] the table never settles ----
if (on(5)) {
  const [A, B, C, M] = SIDS(97510);
  const MATURE = (v.STARTS_MATURITY_MS || 2 * HOUR) + 10 * MIN;
  // the others began level 1 (their starts) and the table died: no result from anybody
  const mm = match(1 | S(0b1111), 0x97501, [A, B, C, M], [0, 1, 2], [], { sc: [0, 0, 0, 0] });
  const m = run([[0, mm.S], [5 * MIN, mm.S], [MATURE, mm.S], [6 * MIN, mm.S]], ptsOf(A, B, C, M));
  T('[5] the start-orphan verdict at maturity: the seat that never wrote its own start is not convicted (logged), the key is closed',
    m.okAll && settled(m, mm.key) && new RegExp('start-orphan ' + mm.key + ': 1 roster seat\\(s\\) never wrote their own start record -- not convicted').test(m.out), m.out.slice(-1200));
  T('[5] ... the main: no exit, no points write, no board write (the three who started and never settled take the ordinary exit-rate hit, no points fine)',
    leavesOf(m, M) === 0 && anyWrite(m, M) === 0 && m.pts[M].score === 1000 && [A, B, C].every((s) => leavesOf(m, s) === 1 && m.pts[s].score === 1000), why(m, M) + J([A, B, C].map((s) => leavesOf(m, s))));
}

// ---- [6] the boundary: what does make it a leave ----
if (on(6)) {
  const [A, B, C, M] = SIDS(97610), [A2, B2, C2, M2] = SIDS(97620);
  const mt = 1 | S(0b1111);
  // (a) his own start record: level 1 began on his machine, then he was gone
  const a = match(mt, 0x97601, [A, B, C, M], [0, 1, 2, 3], [0, 1, 2], { sc: [900, 700, 500, 0] });
  const ma = run([[0, a.S], [5 * MIN, a.all], [GRACE, a.all], [LEAVE_WAIT, a.all], [6 * MIN, a.all]], ptsOf(A, B, C, M));
  T('[6] the main wrote his own start: the settle waits out the leave wait (not settled at the grace), then convicts him -- one exit and the ranked fine',
    ma.okAll && settledAt(ma, a.key) === 3 && leavesOf(ma, M) === 1 && ma.pts[M].score === 1000 - PP.DEFAULTS.LEAVER_LP_PENALTY && !NOT_A_LEAVER(a.key, 3).test(ma.out), 'settled at run ' + settledAt(ma, a.key) + ' ' + why(ma, M) + ' pts ' + ma.pts[M].score);
  // (b) no start, but his own abandon confession (disposition 5 = a user quit)
  const b = match(mt, 0x97602, [A2, B2, C2, M2], [0, 1, 2], [0, 1, 2], { sc: [900, 700, 500, 0] });
  const conf = { sid: M2, seat: 3, d: rec(0xB5, mt, 0x97602, 3, 0, false, [A2, B2, C2, M2], null, 5) };
  const mb = run(SETTLE(b, [conf]), ptsOf(A2, B2, C2, M2));
  T('[6] the main wrote no start but his own abandon confession: counted on the confession path -- one exit and the ranked fine',
    mb.okAll && leavesOf(mb, M2) === 1 && mb.pts[M2].score === 1000 - PP.DEFAULTS.LEAVER_LP_PENALTY && !NOT_A_LEAVER(b.key, 3).test(mb.out), why(mb, M2) + ' pts ' + mb.pts[M2].score + mb.out.slice(-900));
}

// ---- [7] the table seats the guest ----
if (on(7)) {
  if (!HAS_GUEST) console.log('  skip  [7] this job does not read guest seats (before O989)');
  else {
    const G = (seats) => seats << PP.GUEST_SEAT_SHIFT;
    const [A, B, M] = SIDS(97710), [C, D, M2] = SIDS(97720);
    // a brawl of four: the main at seat 2, his guest at seat 3; neither took part
    const ffa = match(1 | S(0b0111) | G(0b1000), 0x97701, [A, B, M, Z], [0, 1], [0, 1], { sc: [900, 700, 0, 0] });
    // a team brawl: the pair is team 0 (the main at seat 0, his guest at seat 1), the two strangers team 1
    const team = match(3 | S(0b1101) | G(0b0010), 0x97702, [M2, Z, C, D], [2, 3], [2, 3], { sc: [0, 0, 900, 700] });
    const m = run(SETTLE([ffa, team]), ptsOf(A, B, M, C, D, M2));
    T('[7] brawl, the pair seated and absent: the two others settle between themselves; the main named-only, untouched; nobody flagged',
      m.okAll && settledAt(m, ffa.key) === 2 && NOT_A_LEAVER(ffa.key, 2).test(m.out) && untouched(m, M) && m.pts[M].score === 1000 && [A, B].every((s) => skillOf(m, s) && xpOf(m, s) > 0) && flaggedN(m) === 0,
      why(m, M) + m.out.slice(-1200));
    T('[7] team brawl, the pair is the whole losing team: settled with no rating move (nobody on the losing team is accounted for), the main untouched, the two who played get the XP',
      settledAt(m, team.key) === 2 && untouched(m, M2) && m.pts[M2].score === 1000 && [C, D].every((s) => !skillOf(m, s) && m.pts[s].score === 1000 && xpOf(m, s) > 0), why(m, M2) + J([C, D].map((s) => [!!skillOf(m, s), m.pts[s].score, xpOf(m, s)])));
    T('[7] the guest has no id: no board write and no state row beyond the accounts\'', J(m.last.state).indexOf('~guest') < 0 && [].concat(...m.rs.map((r) => r.posts)).every((p) => !/steamid=0(&|$)/.test(p.body)));
  }
}

// ---- [8] mutants ----
if (on(8)) {
  const [A, B, C, M] = SIDS(97810), [A2, B2, C2, M2] = SIDS(97820);
  const mt = 1 | S(0b1111);
  const f1 = vMut("      if (own.has(hx) || confSeen.has(hx + '|' + c.m) || confState[hx + '|' + c.m]) return true;   // his confession", "      if (hx) return true;   // his confession", '[8a]');
  if (f1) {
    const mm = match(mt, 0x97801, [A, B, C, M], [0, 1, 2], [0, 1, 2], { sc: [900, 700, 500, 0] });
    const mx = run(SETTLE(mm), ptsOf(A, B, C, M), null, f1);
    T('[8] mutant (the settle path convicts a seat the others only name): the main takes an exit and the ranked fine -- caught', mx.okAll && leavesOf(mx, M) === 1 && mx.pts[M].score === 1000 - PP.DEFAULTS.LEAVER_LP_PENALTY, why(mx, M) + ' pts ' + mx.pts[M].score);
  }
  const f2 = vMut('      if (!hasOwnStart(p, h)) continue;   // Q69: named by others only -- logged below, not convicted\n', '', '[8b]');
  if (f2) {
    const MATURE = (v.STARTS_MATURITY_MS || 2 * HOUR) + 10 * MIN;
    const mm = match(mt, 0x97802, [A2, B2, C2, M2], [0, 1, 2], [], { sc: [0, 0, 0, 0] });
    const mx = run([[0, mm.S], [5 * MIN, mm.S], [MATURE, mm.S], [6 * MIN, mm.S]], ptsOf(A2, B2, C2, M2), null, f2);
    T('[8] mutant (the start-orphan verdict convicts a seat with no start of its own): the main takes an exit -- caught', mx.okAll && leavesOf(mx, M2) === 1, why(mx, M2));
  }
}

console.log(failN ? ('GUEST-SHORT-REQUEUE: ' + failN + ' FAIL') : 'GUEST-SHORT-REQUEUE: ALL PASS');
process.exit(failN ? 1 : 0);
