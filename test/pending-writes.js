'use strict';
// O480 R1 (follow-up 5 of the evaluation): a failed points write of the settle is no longer lost.
// Until now a settle whose points write failed (Steam down, a 5xx, result != 1) still marked the match processed, and the delta was
// gone for good (the comment by the read retries claimed it self-healed; it did not). Now the write waits in the points-row
// backlog (PENDING_WRITES_FILE, w = the board, the absolute value, the details it carried with its receipts, first failure, tries):
// the match stays processed (nothing settles twice), every reader of the points board takes that value as the player's row, and
// the next run writes it again (ForceUpdate of an absolute value: idempotent).
//   [1] a settle whose points writes fail: the match processed, the values wait (w), the rest of the settle (rating, XP) as before
//   [2] the next run with nothing fresh to settle writes them (each lands, the backlog empties)
//   [3] the next run settles another match of the same player: its delta counts from the waiting value, not the stale row, one
//       write carries both receipts, the backlog empties
//   [4] the write fails again: the tries count, the first failure is kept
//   [5] a confession fine reads the waiting value as the player's points
//   [6] the fuse: a write waiting past 7 days is dropped (warned); one for another board (the season turned) is dropped (warned)
//   [7] a player this run cannot name (no record of his read, no row read) keeps waiting
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

const MIN = 60000, GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const POINTS = 7;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
// steps: [[ms, records, env?]]; the points board carries every write that landed (a failed one does not reach it)
function run(steps, pts0, files0) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || null), env || null, null, 'pending-writes');
    rs.push(r); state = r.state;
    const failing = env && env.STUB_FAIL_POST && JSON.parse(env.STUB_FAIL_POST).points;
    r.failing = !!failing;   // the stub logs every POST: a failing run's points POSTs did not land
    if (!failing) for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_' + mt, mh: hash | 0 };
}
const FAIL = { STUB_FAIL_POST: J({ points: 500 }) };
const waiting = (r, sid) => { const e = ((r.state.PENDING_WRITES_FILE || {})[v.pid(sid)]) || {}; return e.w || null; };
const settled = (r, key) => new Set(r.state.PROCESSED_FILE || []).has(key);
const pointWrites = (r, sid) => (r.failing ? [] : H.postsOf(r, POINTS, sid));   // the writes that landed

const A = H.SID(4901), B = H.SID(4902), C = H.SID(4903), D = H.SID(4904);
console.log('=== a failed points write waits for its retry (O480) ===');
// ---- [1] + [2] ----
{
  const mm = match(2, 0x49A01, [A, B]);
  const steps = [[0, mm.S, FAIL], [5 * MIN, mm.all, FAIL], [GRACE, mm.all, FAIL], [6 * MIN, mm.all, FAIL]];
  const m = run(steps, { [A]: { score: 2500 }, [B]: { score: 2400 } });
  const wa = waiting(m.last, A), wb = waiting(m.last, B);
  T('[1] the match settles and is processed (nothing settles twice)', m.okAll && settled(m.last, mm.key), m.out.slice(-600));
  T('[1] both values wait: board points, the settled value, the details with this match\'s receipt; the two quiet runs after the settle tried again (3 tries)', wa && wb && wa.b === 'points' && wa.v === 2538 && wb.v === 2383
    && wa.n === 3 && Number.isFinite(wa.t) && PP.receiptOf(wa.d, mm.mh) && PP.receiptOf(wa.d, mm.mh).delta === 38, J(m.last.state.PENDING_WRITES_FILE));
  T('[1] the rest of the settle as before (rating and XP written)', m.rs.some((r) => H.setPosts(r, 6).length === 2) && m.rs.some((r) => H.setPosts(r, 5).length === 2));
  T('[1] logged', /points write of [0-9a-f]{8} failed -- 2538 waits for the next run \(try 1\)/.test(m.out), m.out.slice(-500));
  // [2] the next run, Steam back, nothing fresh: the quiet path writes both
  const n = run([[0, mm.all]], m.pts, H.advance(m.last.state, 5 * MIN));
  T('[2] a run with nothing fresh writes both values (their receipts on them) and the backlog empties', n.okAll && /no fresh matches/.test(n.out)
    && J(pointWrites(n.last, A).map((x) => x.score)) === '[2538]' && J(pointWrites(n.last, B).map((x) => x.score)) === '[2383]'
    && PP.receiptOf(pointWrites(n.last, A)[0].details, mm.mh).delta === 38 && !waiting(n.last, A) && !waiting(n.last, B), n.out.slice(-600));
  T('[2] logged: landed', /points write of [0-9a-f]{8} that failed before \(3 tries\) landed: 2538/.test(n.out));
}
// ---- [3] the next run settles another match of the same player ----
{
  const m1 = match(2, 0x49A02, [C, D]);
  const m = run([[0, m1.S, FAIL], [5 * MIN, m1.all, FAIL], [GRACE, m1.all, FAIL], [6 * MIN, m1.all, FAIL]], { [C]: { score: 2500 }, [D]: { score: 2400 } });
  T('[3] first match: C\'s value waits', settled(m.last, m1.key) && waiting(m.last, C) && waiting(m.last, C).v === 2538, J(m.last.state.PENDING_WRITES_FILE));
  const m2 = match(2, 0x49A03, [C, D]);
  // Steam back: the waiting value lands at the first chance (a retry, or the next settle of C), the second settle counts from it
  const n = run([[0, m2.S, FAIL], [5 * MIN, m2.all], [GRACE, m2.all], [6 * MIN, m2.all]], m.pts, H.advance(m.last.state, 10 * MIN));
  const wc = [].concat(...n.rs.map((r) => pointWrites(r, C)));
  const lastC = wc[wc.length - 1];
  T('[3] C ends at 2500 + 38 + 38 = 2576 (the second settle never counts from the stale 2500)', settled(n.last, m2.key) && lastC && lastC.score === 2576 && wc.every((x) => x.score === 2538 || x.score === 2576), J(wc) + ' ' + n.out.slice(-500));
  const ring = lastC ? PP.lpDetailsOf(lastC.details).ring : [];
  T('[3] ... his row carries both receipts (newest first), the backlog empty', ring.length === 2 && ring[0].mh === m2.mh && ring[1].mh === m1.mh && !waiting(n.last, C) && !waiting(n.last, D), J(ring));
}
// ---- [3b] the overlay itself: the board still shows the row from before the failed write, the settle reads the waiting value ----
{
  const E = H.SID(4905), F = H.SID(4906);
  const VBITS = (PP.RULES_VER & 0xffff) << 8;
  const backlog = { [v.pid(E)]: { w: { b: 'points', v: 2538, d: PP.lpDetails(null, [{ mh: 777, delta: 38, flags: VBITS }]), t: Date.now() - 20 * MIN, n: 1 } } };
  const m2 = match(2, 0x49A07, [E, F]);
  const n = run([[0, m2.S, FAIL], [5 * MIN, m2.all], [GRACE, m2.all], [6 * MIN, m2.all]], { [E]: { score: 2500 }, [F]: { score: 2400 } }, { PENDING_WRITES_FILE: backlog });
  const we = [].concat(...n.rs.map((r) => pointWrites(r, E)));
  T('[3b] one write: 2538 + 38 = 2576 from the waiting value (the board showed 2500), both receipts, the wait gone', settled(n.last, m2.key) && we.length === 1 && we[0].score === 2576
    && J(PP.lpDetailsOf(we[0].details).ring.map((e) => e.mh)) === J([m2.mh, 777]) && !waiting(n.last, E), J(we) + ' ' + n.out.slice(-500));
}
// ---- [4] fails again ----
{
  const mm = match(2, 0x49A04, [A, B]);
  const m = run([[0, mm.S, FAIL], [5 * MIN, mm.all, FAIL], [GRACE, mm.all, FAIL], [6 * MIN, mm.all, FAIL]], { [A]: { score: 2000 }, [B]: { score: 2400 } });
  const w1 = waiting(m.last, A);
  const n = run([[0, mm.all, FAIL]], m.pts, H.advance(m.last.state, 5 * MIN));
  const w2 = waiting(n.last, A);
  T('[4] the retry fails too: one try more, the first failure kept', w1 && w2 && w2.n === w1.n + 1 && w2.t === w1.t - 5 * MIN && w2.v === w1.v, J([w1, w2]));
}
// ---- [5] a confession fine reads the waiting value ----
{
  const ros = [C, D], hash = 0x49A05, sc = [6000, 5000];
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc) }));
  const conf = { sid: D, d: H.rec(0xB5, 2, hash, 1, 0, false, ros, sc, 5) };
  const backlog = { [v.pid(D)]: { w: { b: 'points', v: 2300, d: [], t: Date.now() - 10 * MIN, n: 1 } } };
  const m = run([[0, S.concat([conf])]], { [C]: { score: 2500 }, [D]: { score: 2400 } }, { PENDING_WRITES_FILE: backlog });
  const wd = pointWrites(m.last, D);
  T('[5] the fine takes 100 off the waiting 2300 (not the stale 2400): one write of 2200, the wait superseded', wd.length === 1 && wd[0].score === 2200 && !waiting(m.last, D), J(wd) + ' ' + m.out.slice(-400));
}
// ---- [6] the fuse, another board ----
{
  const now = 9e12;
  const s = { a: { w: { b: 'points', v: 1, d: [], t: now - 7 * 86400000 - 1, n: 9 } }, b: { w: { b: 'points', v: 2, d: [], t: now - 1000, n: 1 } }, c: { w: { v: 'x' } } };
  const r = v.prunePendingWrites(s, now);
  T('[6] a write waiting past 7 days is dropped, a malformed one too, a recent one kept', r.writes === 2 && J(Object.keys(s)) === J(['b']), J(s));
  const backlog = { [v.pid(A)]: { w: { b: 'points_s0x', v: 2600, d: [], t: Date.now(), n: 1 } } };
  const mm = match(2, 0x49A06, [A, B]);
  const m = run([[0, mm.all]], { [A]: { score: 2500 } }, { PENDING_WRITES_FILE: backlog });
  T('[6] one written for another board (the season turned meanwhile) is dropped with a warning, nothing written', !waiting(m.last, A) && pointWrites(m.last, A).length === 0
    && /points write of [0-9a-f]{8} for board points_s0x dropped/.test(m.out), m.out.slice(-400));
}
// ---- [7] a player this run cannot name keeps waiting ----
{
  const ghost = '0123456789abcdef';
  const backlog = { [ghost]: { w: { b: 'points', v: 1234, d: [], t: Date.now(), n: 1 } } };
  const m = run([[0, []]], {}, { PENDING_WRITES_FILE: backlog });
  T('[7] nobody to name it: nothing written, the wait kept', m.okAll && (m.last.state.PENDING_WRITES_FILE || {})[ghost] && (m.last.state.PENDING_WRITES_FILE || {})[ghost].w.v === 1234
    && m.last.posts.filter((p) => /leaderboardid=7(&|$)/.test(p.body)).length === 0, J(m.last.state.PENDING_WRITES_FILE));
}

console.log(failN ? ('pending-writes: ' + failN + ' FAIL') : 'pending-writes: all ok');
process.exit(failN ? 1 : 0);
