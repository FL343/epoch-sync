'use strict';
// cloud audit Q341: a points write that failed in the last runs of a season is no longer dropped when the season turns.
// A settle's points write that fails waits in the points-row backlog (w, O480) and the next run writes it again. When the next
// run was already in the new season, the turn dropped it (warned, "dropped: this season writes ..."): last season's board never
// got that match, and the player's first settle of the new season soft-reset from his row before it -- the winner lost the points
// of the season's last match (silver and below keep their points through the soft reset), the loser kept the points he lost.
// Now the new season's runs move such a write aside (wp), write it to last season's board -- where the match belongs -- until it
// lands, and take it as his row there for every soft-reset read until then.
//   [1] the turn with Steam back: the first run of season 1 writes both waiting values to last season's board (the match's
//       receipt on them), the backlog empties, the first settle of season 1 soft-resets from them; logged
//   [1b] the same with LP_LAST_HOLD_MS=0 (O481 off): the same writes (this is the O480 backlog, not the O481 stale-read check)
//   [2] last season's board still failing in season 1: tried every run (the tries count), the first settle of season 1
//       soft-resets from the waiting value; the season-1 write that lands does not take it away; written once Steam is back, and
//       the kept write of the season-1 board stays his kept write
//   [3] both boards failing: the season-1 write waits too (w) next to it (wp); the season-1 board back first: its write lands
//       there and last season's still waits; then that one lands too
//   [4] the retry landed, then the soft-reset read of last season's board is a copy behind it: his kept write of that board
//       (l, O481 / W126) is taken, one [stale-read]; a match that spans the turn: landed and read in the same run
//   [5] a confession fine at the turn comes off the soft reset of the waiting value
//   [6] older seasons: a w or a wp two seasons back is dropped (warned), nothing written; one of last season this run cannot
//       name waits
//   [7] pure: the fuse (7 days) and malformed entries
//   [8] source pins: the move comes before any points write of the run; the settle's writer never touches wp; last season's
//       board is written in one place
//   [9] a points write laid ahead (Q334: a) by the season's last run, which died before its outcome was known -- cut before
//       the write (Steam never got it) or right after (Steam took it): the turn moves it, a and all; the first run of season 1
//       writes it to last season's board (logged as laid ahead, not as failed), the first settle soft-resets from it; one that
//       fails there waits as a failed one (a gone, one try)
//   [10] - [12] the first review's blocks (Q341 REVIEW.md, review/extra-blocks.js [R1] - [R3]), merged with the reissue as it
//       asked: [10] a dry run (APPLY_MMR=0) at the turn writes neither points board; [11] last season's board failing 40 minutes
//       after the turn, then a lagging copy: the kept write still stands in (its hold counts from the landing); [12] a preseason
//       retry lands on the preseason board as before, never a wp
const path = require('path'), fs = require('fs');
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
const clone = (o) => JSON.parse(J(o));

const MIN = 60000;
const POINTS = 7, S1B = 9;   // the preseason board 'points' (last season's from season 1 on) and 'points_s1' (listed, so a failure can name it)
const PRE = { SEASON_NOW: '2026-11-30T23:50:00Z' }, S1 = { SEASON_NOW: '2026-12-01T00:00:00Z' }, S2 = { SEASON_NOW: '2027-03-01T00:05:00Z' };
const HOLD_OFF = { LP_LAST_HOLD_MS: '0' };
const fail = (env, boards) => Object.assign({}, env, { STUB_FAIL_POST: J(boards) });
const ents = (rows) => Object.keys(rows || {}).map((s) => ({ steamID: s, score: rows[s].score, details: rows[s].details || [] }));
const boardsOf = (recs, rows) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: ents(rows.points) }, { id: S1B, name: 'points_s1', entries: ents(rows.s1) }, { id: 8, name: 'cp_bank', entries: [] }]);
const sidOf = (p) => /steamid=([0-9]+)/.exec(p.body)[1];
// steps: [[ms, records, env?, lag?]]. Each board holds every write to it that landed (a failing board's writes did not); a step's
//   lag (sid -> { score, details } or null) is the copy of last season's board ('points') this run reads for those players.
function run(steps, rows0, files0) {
  const rows = clone(rows0 || { points: {}, s1: {} });
  const rs = [];
  let state = null;
  for (const [ms, recs, env, lag] of steps) {
    const seen = clone(rows);
    if (lag) for (const s of Object.keys(lag)) { if (lag[s]) seen.points[s] = lag[s]; else delete seen.points[s]; }
    const r = H.runCron(boardsOf(recs, seen), state ? H.advance(state, ms) : (files0 || null), env || null, null, 'season-turn-backlog');
    rs.push(r); state = r.state;
    const failing = (env && env.STUB_FAIL_POST) ? JSON.parse(env.STUB_FAIL_POST) : {};
    r.failing = failing;
    for (const [id, nm, key] of [[POINTS, 'points', 'points'], [S1B, 'points_s1', 's1']]) {
      if (failing[nm]) continue;
      for (const p of H.setPosts(r, id)) rows[key][sidOf(p)] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    }
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], rows, out: rs.map((r) => r.out).join(''), okAll: rs.length === steps.length && rs.every((r) => r.code === 0) };
}
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_' + mt, mh: hash | 0 };
}
const plog = (sid) => v.pid(String(sid)).slice(0, 8);
const entryOf = (r, sid) => ((r.state.PENDING_WRITES_FILE || {})[v.pid(sid)]) || {};
const posts = (r, id, sid) => (r.failing && r.failing[id === POINTS ? 'points' : 'points_s1'] ? [] : H.postsOf(r, id, sid));   // the writes that landed
const tried = (r, id, sid) => H.postsOf(r, id, sid);   // every write sent (the stub logs a failed one too)
const staleN = (out) => (out.match(/\[stale-read\]/g) || []).length;
const seedLine = (out, sid) => (new RegExp('seed [^\\n]*' + plog(sid) + ' first settle this season, soft-reset from (-?[0-9]+) -> pts (-?[0-9]+)').exec(out) || []).slice(1).map(Number);
const ringOf = (det) => PP.lpDetailsOf(det || []).ring;
const FAILP = { points: 500 };

// the preseason part every case shares: A (1500) beats B (1400) at 23:50 the night before season 1, every points write answered
//   500: both values wait (A 1500 + 44, B 1400 - 13: silver keeps its points through the soft reset, so a lost match shows)
const pre = (A, B, hash) => {
  const m1 = match(2, hash, [A, B]);
  const a = run([[0, m1.S, PRE], [5 * MIN, m1.all, fail(PRE, FAILP)]], { points: { [A]: { score: 1500 }, [B]: { score: 1400 } }, s1: {} });
  return { m1, a };
};

console.log('=== a points write that failed in the season\'s last runs goes on to that season\'s board (Q341) ===');
// ---- [1] / [1b] the turn with Steam back ----
{
  const A = H.SID(5101), B = H.SID(5102);
  const go = (extra) => {
    const t = pre(A, B, 0x4B101);
    const m2 = match(2, 0x4B102, [A, B]);
    const env = Object.assign({}, S1, extra || {});
    const b = run([[10 * MIN, t.m1.all, env], [5 * MIN, t.m1.all.concat(m2.S), env], [5 * MIN, t.m1.all.concat(m2.all), env]], t.a.rows, t.a.last.state);
    return { t, m2, b };
  };
  const { t, m2, b } = go();
  const wa = entryOf(t.a.last, A).w, wb = entryOf(t.a.last, B).w;
  T('[1] (23:50: both points writes fail, both values wait for the preseason board: A 1544, B 1387)', t.a.okAll && wa && wb && wa.b === 'points' && wa.v === 1544 && wb.v === 1387
    && PP.receiptOf(wa.d, t.m1.mh) && PP.receiptOf(wa.d, t.m1.mh).delta === 44, J(t.a.last.state.PENDING_WRITES_FILE));
  const pa = posts(b.rs[0], POINTS, A), pb = posts(b.rs[0], POINTS, B);
  T('[1] the first run of season 1 (nothing fresh) writes both values to last season\'s board, the match\'s receipt on them', b.okAll && /no fresh matches|no consistent matches/.test(b.rs[0].out)
    && J(pa.map((x) => x.score)) === '[1544]' && J(pb.map((x) => x.score)) === '[1387]' && PP.receiptOf(pa[0].details, t.m1.mh).delta === 44 && PP.receiptOf(pb[0].details, t.m1.mh).delta === -13,
    J(pa) + ' ' + J(pb) + ' ' + b.rs[0].out.slice(-900));
  T('[1] ... logged: kept at the turn (not dropped), then landed', new RegExp('points write of ' + plog(A) + ' for last season\'s board points \\(value 1544, 1 tries\\) waits on for that board, not dropped at the turn \\(Q341\\)').test(b.rs[0].out)
    && new RegExp('points write of ' + plog(A) + ' for last season\'s board points that failed before \\(1 tries\\) landed: 1544 \\(Q341\\)').test(b.rs[0].out)
    && !/dropped: this season writes/.test(b.out), b.rs[0].out.slice(-900));
  const ea = entryOf(b.rs[0], A);
  T('[1] ... the backlog holds no write of theirs any more, A\'s landed write is his kept write of that board (O481)', !ea.w && !ea.wp && !entryOf(b.rs[0], B).w && !entryOf(b.rs[0], B).wp
    && ea.l && ea.l.b === 'points' && ea.l.v === 1544, J(b.rs[0].state.PENDING_WRITES_FILE));
  const sa = posts(b.rs[2], S1B, A), sb = posts(b.rs[2], S1B, B);
  T('[1] the first settle of season 1 soft-resets from 1544 / 1387 (not 1500 / 1400): A 1544 + 44 = 1588, B 1387 - 13 = 1374', J(seedLine(b.rs[2].out, A)) === '[1544,1544]' && J(seedLine(b.rs[2].out, B)) === '[1387,1387]'
    && J(sa.map((x) => x.score)) === '[1588]' && J(sb.map((x) => x.score)) === '[1374]' && PP.receiptOf(sa[0].details, m2.mh) && !PP.receiptOf(sa[0].details, t.m1.mh), J(sa) + ' ' + J(sb) + ' ' + b.rs[2].out.slice(-900));
  T('[1] ... nothing more written to last season\'s board, no [stale-read]', tried(b.rs[1], POINTS, A).length + tried(b.rs[2], POINTS, A).length + tried(b.rs[1], POINTS, B).length + tried(b.rs[2], POINTS, B).length === 0
    && staleN(b.out) === 0, b.out.slice(-600));
  const o = go(HOLD_OFF);
  T('[1b] LP_LAST_HOLD_MS=0: the same writes to both boards (the backlog of O480, not the stale-read check of O481)', o.b.okAll
    && J(posts(o.b.rs[0], POINTS, A)) === J(pa) && J(posts(o.b.rs[0], POINTS, B)) === J(pb) && J(posts(o.b.rs[2], S1B, A)) === J(sa) && J(posts(o.b.rs[2], S1B, B)) === J(sb)
    && !entryOf(o.b.rs[0], A).l, J(posts(o.b.rs[2], S1B, A)) + ' vs ' + J(sa));
}
// ---- [2] last season's board still failing in season 1 ----
{
  const A = H.SID(5111), B = H.SID(5112);
  const t = pre(A, B, 0x4B111);
  const m2 = match(2, 0x4B112, [A, B]);
  const SF = fail(S1, FAILP);   // the base board -- last season's from season 1 on -- answers 500, points_s1 takes writes
  const b = run([[10 * MIN, t.m1.all, SF], [5 * MIN, t.m1.all.concat(m2.S), SF], [5 * MIN, t.m1.all.concat(m2.all), SF], [5 * MIN, t.m1.all.concat(m2.all), S1]], t.a.rows, t.a.last.state);
  const n = [0, 1, 2].map((i) => (entryOf(b.rs[i], A).wp || {}).n);
  T('[2] last season\'s board answers 500: tried every run of season 1, the tries counted, the value waits (wp)', b.okAll && [0, 1, 2].every((i) => tried(b.rs[i], POINTS, A).length === 1 && tried(b.rs[i], POINTS, A)[0].score === 1544)
    && J(n) === '[2,3,4]' && entryOf(b.rs[2], A).wp.v === 1544 && entryOf(b.rs[2], A).wp.b === 'points' && !entryOf(b.rs[2], A).w
    && /points write of [0-9a-f]{8} for last season's board points failed again \(status 500\) -- 1544 waits for the next run \(try 2, Q341\)/.test(b.rs[0].out), J(n) + ' ' + b.rs[0].out.slice(-700));
  const sa = posts(b.rs[2], S1B, A);
  T('[2] the first settle of season 1 soft-resets from the waiting 1544 (the board still shows 1500): 1588, no [stale-read]', J(seedLine(b.rs[2].out, A)) === '[1544,1544]'
    && J(sa.map((x) => x.score)) === '[1588]' && J(seedLine(b.rs[2].out, B)) === '[1387,1387]' && staleN(b.out) === 0, J(sa) + ' ' + b.rs[2].out.slice(-900));
  T('[2] ... the season-1 write that landed leaves last season\'s write waiting (another board: it supersedes nothing there)', entryOf(b.rs[2], A).wp && entryOf(b.rs[2], A).l
    && entryOf(b.rs[2], A).l.b === 'points_s1' && entryOf(b.rs[2], A).l.v === 1588, J(entryOf(b.rs[2], A)));
  const pa = posts(b.rs[3], POINTS, A);
  T('[2] Steam back: the next run writes 1544 to last season\'s board, the wait ends, his kept write stays the season-1 one', J(pa.map((x) => x.score)) === '[1544]'
    && PP.receiptOf(pa[0].details, t.m1.mh).delta === 44 && !entryOf(b.rs[3], A).wp && entryOf(b.rs[3], A).l && entryOf(b.rs[3], A).l.b === 'points_s1' && entryOf(b.rs[3], A).l.v === 1588
    && tried(b.rs[3], S1B, A).length === 0, J(pa) + ' ' + J(entryOf(b.rs[3], A)) + ' ' + b.rs[3].out.slice(-600));
}
// ---- [3] both boards failing ----
{
  const A = H.SID(5121), B = H.SID(5122);
  const t = pre(A, B, 0x4B121);
  const m2 = match(2, 0x4B122, [A, B]);
  const SFF = fail(S1, { points: 500, points_s1: 500 });
  const all = t.m1.all.concat(m2.all);
  const b = run([[10 * MIN, t.m1.all, SFF], [5 * MIN, t.m1.all.concat(m2.S), SFF], [5 * MIN, all, SFF], [5 * MIN, all, fail(S1, FAILP)], [5 * MIN, all, S1]], t.a.rows, t.a.last.state);
  const e2 = entryOf(b.rs[2], A), e3 = entryOf(b.rs[3], A);
  T('[3] both boards answer 500: the season-1 write (1588) waits (w) next to last season\'s (wp, 1544)', b.okAll && e2.w && e2.w.b === 'points_s1' && e2.w.v === 1588
    && e2.wp && e2.wp.b === 'points' && e2.wp.v === 1544, J(e2));
  T('[3] points_s1 back first: its waiting write lands there (1588), last season\'s still waits (it supersedes nothing on another board)', J(posts(b.rs[3], S1B, A).map((x) => x.score)) === '[1588]'
    && J(tried(b.rs[3], POINTS, A).map((x) => x.score)) === '[1544]' && !e3.w && e3.wp && e3.wp.v === 1544 && e3.wp.n === e2.wp.n + 1, J(e3) + ' ' + b.rs[3].out.slice(-700));
  T('[3] then last season\'s board: written there (1544 / 1387), the backlog empties', J(posts(b.rs[4], POINTS, A).map((x) => x.score)) === '[1544]' && J(posts(b.rs[4], POINTS, B).map((x) => x.score)) === '[1387]'
    && J(posts(b.rs[3], S1B, B).map((x) => x.score)) === '[1374]' && tried(b.rs[4], S1B, A).length === 0 && !entryOf(b.rs[4], A).w && !entryOf(b.rs[4], A).wp && !entryOf(b.rs[4], B).wp,
    J(entryOf(b.rs[4], A)) + ' ' + b.rs[4].out.slice(-700));
}
// ---- [4] a copy of last season's board behind the write that landed ----
{
  const A = H.SID(5131), B = H.SID(5132);
  const lag = { [A]: { score: 1500, details: [] } };   // A's row before the season's last match
  {
    const t = pre(A, B, 0x4B131);
    const m2 = match(2, 0x4B132, [A, B]);
    const b = run([[10 * MIN, t.m1.all, S1], [5 * MIN, t.m1.all.concat(m2.S), S1, lag], [5 * MIN, t.m1.all.concat(m2.all), S1, lag]], t.a.rows, t.a.last.state);
    T('[4] the retry landed at 00:00, the soft-reset read at 00:10 is a copy behind it: his kept write of that board is taken (1544), one [stale-read]', b.okAll
      && J(posts(b.rs[0], POINTS, A).map((x) => x.score)) === '[1544]' && J(seedLine(b.rs[2].out, A)) === '[1544,1544]' && J(posts(b.rs[2], S1B, A).map((x) => x.score)) === '[1588]'
      && staleN(b.out) === 1 && new RegExp('\\[stale-read\\] points ' + plog(A) + ' \\(prev points, points\\): read 1500 without').test(b.out), b.out.slice(-900));
  }
  {
    // a match across the turn: starts 23:55 (the retry fails again), settles in the first run of season 1 -- the retry lands
    //   in that run, and the soft-reset read of the same run (a copy behind it, and the hold off) takes it
    const t = pre(A, B, 0x4B133);
    const m2 = match(2, 0x4B134, [A, B]);
    const b = run([[5 * MIN, t.m1.all.concat(m2.S), fail(PRE, FAILP)], [10 * MIN, t.m1.all.concat(m2.all), Object.assign({}, S1, HOLD_OFF), lag]], t.a.rows, t.a.last.state);
    T('[4] a match across the turn: the first run of season 1 lands last season\'s write and soft-resets from it in the same run (copy behind, hold off): 1588', b.okAll
      && J(posts(b.rs[1], POINTS, A).map((x) => x.score)) === '[1544]' && J(seedLine(b.rs[1].out, A)) === '[1544,1544]' && J(posts(b.rs[1], S1B, A).map((x) => x.score)) === '[1588]'
      && (entryOf(b.rs[0], A).w || {}).n === 2, J(posts(b.rs[1], S1B, A)) + ' ' + b.rs[1].out.slice(-900));
  }
}
// ---- [5] a confession fine at the turn ----
{
  const A = H.SID(5141), B = H.SID(5142);
  const t = pre(A, B, 0x4B141);
  const ros = [A, B], h3 = 0x4B142, sc = [6000, 5000];
  const S3 = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, h3, seat, 0, false, ros, sc) }));
  const conf = { sid: A, d: H.rec(0xB5, 2, h3, 0, 0, false, ros, sc, 5) };
  const c = run([[10 * MIN, t.m1.all.concat(S3, [conf]), fail(S1, FAILP)]], t.a.rows, t.a.last.state);
  const wc = posts(c.last, S1B, A);
  T('[5] A quits his first match of season 1 (last season\'s board still failing): the fine comes off the soft reset of the waiting 1544 -> 1444', c.okAll
    && J(wc.map((x) => x.score)) === '[1444]' && entryOf(c.last, A).wp && entryOf(c.last, A).wp.v === 1544, J(wc) + ' ' + c.out.slice(-700));
}
// ---- [6] older seasons, a player this run cannot name ----
{
  const A = H.SID(5151), B = H.SID(5152), C = H.SID(5153);
  const t0 = Date.now() - 10 * MIN;
  const files = { PENDING_WRITES_FILE: {
    [v.pid(A)]: { w: { b: 'points', v: 1600, d: [], t: t0, n: 1 } },     // two seasons back by season 2
    [v.pid(B)]: { wp: { b: 'points', v: 1450, d: [], t: t0, n: 2 } },    // moved aside at the turn into season 1, still waiting
    [v.pid(C)]: { w: { b: 'points_s1', v: 1700, d: [], t: t0, n: 1 } },  // last season's, nobody this run names him
  } };
  const r = run([[0, [], S2]], { points: {}, s1: {} }, files);
  const s = r.last.state.PENDING_WRITES_FILE || {};
  T('[6] season 2: a w of two seasons back is dropped as before (warned), so is a wp of two seasons back (warned), nothing written to either old board', r.okAll
    && !s[v.pid(A)] && !s[v.pid(B)] && /points write of [0-9a-f]{8} for board points dropped: this season writes points_s2/.test(r.out)
    && /points write of [0-9a-f]{8} for board points dropped: last season's board is points_s1 \(value 1450, 2 tries, Q341\)/.test(r.out)
    && H.setPosts(r.last, POINTS).length === 0 && H.setPosts(r.last, S1B).length === 0, J(s) + ' ' + r.out.slice(-600));
  T('[6] ... last season\'s write of a player this run cannot name is kept for last season\'s board (wp), waiting', s[v.pid(C)] && s[v.pid(C)].wp && s[v.pid(C)].wp.b === 'points_s1'
    && s[v.pid(C)].wp.v === 1700 && !s[v.pid(C)].w, J(s));
  const p = run([[0, [], PRE]], { points: {}, s1: {} }, { PENDING_WRITES_FILE: { [v.pid(C)]: { wp: { b: 'points', v: 1700, d: [], t: t0, n: 1 } } } });
  T('[6] preseason (no last season): a wp is left alone', p.okAll && J(((p.last.state.PENDING_WRITES_FILE || {})[v.pid(C)] || {}).wp) === J({ b: 'points', v: 1700, d: [], t: t0, n: 1 }), J(p.last.state.PENDING_WRITES_FILE));
}
// ---- [7] pure: the fuse ----
{
  const now = 9e12;
  const s = { a: { wp: { b: 'points', v: 1, d: [], t: now - 7 * 86400000 - 1, n: 9 } }, b: { wp: { b: 'points', v: 2, d: [], t: now - 1000, n: 1 } }, c: { wp: { b: 'points', v: 'x' } },
    d: { wp: { v: 3, d: [], t: now } }, e: { wp: { b: 'points', v: 4, d: [], t: now - 7 * 86400000 - 1, n: 2 }, l: { b: 'points_s1', v: 5, d: [], t: now - 1000 } } };
  const r = v.prunePendingWrites(s, now);
  T('[7] a wp past 7 days is dropped, a malformed one too, a recent one kept, the rest of the entry left', r.writes === 4 && J(Object.keys(s).sort()) === J(['b', 'e']) && J(s.b.wp.v) === '2'
    && !s.e.wp && s.e.l && s.e.l.v === 5, J(s));
}
// ---- [8] source pins ----
{
  const src = fs.readFileSync(H.VALIDATE, 'utf8');
  const at = (re) => { const m = re.exec(src); return m ? m.index : -1; };
  const load = at(/const lpBacklog = loadPendingWrites\(\);/), move = at(/e\.wp = e\.w; delete e\.w;/), writer = at(/const writeLpRow = async/);
  const body = (/const writeLpRow = async \(sid, score, prevDet, rv, events, opt\) => \{\n([\s\S]*?)\n  \};/.exec(src) || [])[1] || '';
  T('[8] the move comes right after the backlog is loaded, ahead of the writer of points rows (no write of the run can take or cover it)', load > 0 && move > load && writer > move
    && move - load < 2000, [load, move, writer].join(' '));
  T('[8] the writer of this season\'s points rows never touches wp', body.length > 500 && !/\bwp\b/.test(body), String(body.length));
  T('[8] last season\'s board is written in one place (lpPrevRetry), the quiet path and the settle\'s board read call it', (src.match(/leaderboardid: prevLpId\b/g) || []).length === 1
    && /const lpPrevRetry = async \(rowSids\) => \{[\s\S]*?leaderboardid: prevLpId,[\s\S]*?\n  \};/.test(src) && /const lpRetry = async \(\) => \{\n    await lpPrevRetry\(\[\]\);/.test(src)
    && /await lpPrevRetry\(Object\.keys\(lp\)\);/.test(src));
}

// ---- [9] a write laid ahead by the season's last run, which died before it knew the outcome (Q334) ----
{
  const go = (n, took, env0) => {
    const A = H.SID(5191 + 10 * n), B = H.SID(5192 + 10 * n);
    const t = pre(A, B, 0x4B191 + 0x10 * n);
    // the state a run killed around its points writes leaves on disk: the match processed, the writes laid ahead (a, no try yet)
    const st = clone(t.a.last.state);
    for (const s of [A, B]) { const w = st.PENDING_WRITES_FILE[v.pid(s)].w; w.a = 1; w.n = 0; }
    const rows = clone(t.a.rows);
    if (took) for (const s of [A, B]) { const w = st.PENDING_WRITES_FILE[v.pid(s)].w; rows.points[s] = { score: w.v, details: w.d }; }   // Steam kept them
    const m2 = match(2, 0x4B192 + 0x10 * n, [A, B]);
    const b = run([[10 * MIN, t.m1.all, env0 || S1], [5 * MIN, t.m1.all.concat(m2.S), S1], [5 * MIN, t.m1.all.concat(m2.all), S1]], rows, st);
    return { A, B, t, m2, b };
  };
  for (const [n, took] of [[0, false], [1, true]]) {
    const { A, B, b } = go(n, took);
    const tag = took ? 'right after its write (Steam took it)' : 'right before its write (Steam never got it)';
    const pa = posts(b.rs[0], POINTS, A), pb = posts(b.rs[0], POINTS, B);
    T('[9] killed ' + tag + ': the first run of season 1 writes both laid-ahead values to last season\'s board (1544 / 1387)', b.okAll
      && J(pa.map((x) => x.score)) === '[1544]' && J(pb.map((x) => x.score)) === '[1387]' && J(b.rows.points[A].score) === '1544' && J(b.rows.points[B].score) === '1387',
      J(pa) + ' ' + J(pb) + ' ' + b.rs[0].out.slice(-900));
    T('[9] ... logged as laid ahead by a run that ended (moved a and all, then landed), not as a failed write', new RegExp('points write of ' + plog(A) + ' for last season\'s board points \\(value 1544, 0 tries, laid ahead by a run that ended before its outcome was known\\) waits on for that board, not dropped at the turn \\(Q341\\)').test(b.rs[0].out)
      && new RegExp('points write of ' + plog(A) + ' for last season\'s board points laid ahead by a run that ended before its outcome was known landed: 1544 \\(Q334, Q341\\)').test(b.rs[0].out)
      && !new RegExp(plog(A) + ' for last season\'s board points that failed before').test(b.rs[0].out) && !/dropped: this season writes/.test(b.out), b.rs[0].out.slice(-900));
    T('[9] ... the backlog holds no write of theirs, and the first settle of season 1 soft-resets from them: 1588 / 1374', !entryOf(b.rs[0], A).wp && !entryOf(b.rs[0], A).w && !entryOf(b.rs[0], B).wp
      && J(seedLine(b.rs[2].out, A)) === '[1544,1544]' && J(seedLine(b.rs[2].out, B)) === '[1387,1387]'
      && J(posts(b.rs[2], S1B, A).map((x) => x.score)) === '[1588]' && J(posts(b.rs[2], S1B, B).map((x) => x.score)) === '[1374]', b.rs[2].out.slice(-900));
  }
  const f = go(2, false, fail(S1, FAILP));
  const wa = entryOf(f.b.rs[0], f.A).wp;
  T('[9] laid ahead, and last season\'s board still failing in season 1: it waits as a failed one (a gone, try 1), the soft reset counts from it', wa && wa.v === 1544 && !wa.a && wa.n === 1
    && new RegExp('points write of ' + plog(f.A) + ' for last season\'s board points failed again \\([^)]*\\) -- 1544 waits for the next run \\(try 1, Q341\\)').test(f.b.rs[0].out)
    && J(seedLine(f.b.rs[2].out, f.A)) === '[1544,1544]' && J(posts(f.b.rs[2], S1B, f.A).map((x) => x.score)) === '[1588]', J(wa) + ' ' + f.b.rs[0].out.slice(-900));
}

// ---- [10] - [12] the first review's blocks (review/extra-blocks.js [R1] - [R3]) ----
// [10] dry run (APPLY_MMR=0) at the turn: nothing written to last season's board, the waiting value still the soft-reset source
{
  const A = H.SID(5161), B = H.SID(5162);
  const t = pre(A, B, 0x4B161);
  const DRY = Object.assign({}, S1, { APPLY_MMR: '0' });
  const b = run([[10 * MIN, t.m1.all, DRY]], t.a.rows, t.a.last.state);
  T('[10] APPLY_MMR=0 at the turn: no write to either points board', b.okAll && H.setPosts(b.last, POINTS).length === 0 && H.setPosts(b.last, S1B).length === 0, b.out.slice(-600));
}
// [11] last season's board fails for 40 minutes after the turn (longer than the 30-minute hold), then the write lands and the
//   next soft-reset read is a copy behind it: the kept write must still stand in (its hold counts from the landing)
{
  const A = H.SID(5171), B = H.SID(5172);
  const t = pre(A, B, 0x4B171);
  const m2 = match(2, 0x4B172, [A, B]);
  const lag = { [A]: { score: 1500, details: [] } };
  const SF = fail(S1, FAILP);
  const b = run([[10 * MIN, t.m1.all, SF], [20 * MIN, t.m1.all, SF], [20 * MIN, t.m1.all, S1], [5 * MIN, t.m1.all.concat(m2.S), S1, lag], [5 * MIN, t.m1.all.concat(m2.all), S1, lag]], t.a.rows, t.a.last.state);
  T('[11] landed 40 min after the turn, a lagging copy 10 min later: soft reset from 1544 (kept write), one [stale-read]', b.okAll
    && J(posts(b.rs[2], POINTS, A).map((x) => x.score)) === '[1544]' && J(seedLine(b.rs[4].out, A)) === '[1544,1544]' && staleN(b.out) === 1, J(seedLine(b.rs[4].out, A)) + ' ' + b.out.slice(-700));
}
// [12] preseason runs with a waiting w of the preseason board: not moved aside (the preseason has no last season)
{
  const A = H.SID(5181), B = H.SID(5182);
  const t = pre(A, B, 0x4B181);
  const b = run([[5 * MIN, t.m1.all, PRE]], t.a.rows, t.a.last.state);
  const e = entryOf(b.last, A);
  T('[12] preseason retry: the w lands on the preseason board as before, never a wp', b.okAll && !e.wp && !e.w && J(posts(b.last, POINTS, A).map((x) => x.score)) === '[1544]', J(e) + ' ' + b.out.slice(-500));
}

console.log(failN ? ('season-turn-backlog: ' + failN + ' FAIL') : 'season-turn-backlog: all ok');
process.exit(failN ? 1 : 0);
