'use strict';
// Q406 (cloud audit R3-A3-02): an endless co-op segment (type 7, two to four seats) where only one player's result ever
// lands -- the host left the run (endless writes nothing for a quit), crashed, or his result never came; the player who
// stayed wrote the segment (finished / peers-gone / host-left). One writer is a `lone` group and never settled: the stayer
// lost the segment's XP, his best and (team competitive) its milestones. endlessLoneVerdicts settles such a key for its one
// writer, in its normal endless lane, ENDLESS_LONE.WAIT_MS after the job first saw it; the silent seats are not charged.
//   [0] the constants: the wait sits an hour past the client's endless resend window (its lockstep test pins CLIENT_TTL_MS
//       to the game's OB.TTL_ENDLESS_MS); the accepted ends; the exports
//   [1] units (endlessLoneClaim): the honest shape claims (each accepted end, a copy, a trio); every condition that is not
//       met claims nothing; the verdict pass (endlessLoneVerdicts) stamps, waits, holds on a partial read, pays, forgets
//   [2] end to end, casual co-op duo: two writers (the control); one writer -- nothing before the wait, paid on the due run,
//       once, the silent seat gets nothing; the other result landing late inside the wait -- the normal two-writer settle
//   [3] continues: the writer pays what he pays beside a second writer, the silent seat is not charged (counted)
//   [4] team competitive duo: a resumed final segment only the joiner wrote -- his ladder run ends at its depth; the
//       silent host pays no resume fee and his own run is not ended by the joiner's word (the control: both are)
//   [5] an incomplete shard read at the due time holds it; the next complete read pays it, once
//   [6] nothing for: the other seat never wrote a start; an outside account starts from his seat; a result that fails the
//       sanity screen; an anti-cheat kick
//   [7] three seats: one writer, two silent -- settles for him after the wait; one of the two others late inside the wait --
//       the absent-seat settle as today (Q47), no lone settle
//   [8] mutation self-checks (each load-bearing condition removed -> its scenario goes red)
// End to end over the REAL validate.js main() against the offline board stub of test/lib/settle-stub.js.
const fs = require('fs'), path = require('path');
process.env.STATE_SALT = 's';   // the child runs' salt, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const H = require('./lib/settle-stub');
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const W = v.ENDLESS_LONE.WAIT_MS;

// result-reporter wire forms (endless co-op, match type 7): settle = 10 header + pc scores + disp + 2pc roster + 11 tail
//   (startDepth, endDepth, continue nibbles, 0, 0, flags, 0 x5); start (0xB2) = 10 header + pc zero scores + disp + 2pc roster
const SEED = 7;
function en7(hash, seat, ros, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, o.mt || 7, hash | 0, SEED, seat, 0, 0, pc, 900];
  for (let i = 0; i < pc; i++) d.push((o.sc || [400, 300, 200, 100])[i]);
  d.push(o.disp | 0);
  for (const s of ros) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  d.push(o.from | 0, o.to == null ? 5 : o.to, o.cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0);
  return d;
}
function st7(hash, seat, ros, mt) {
  const pc = ros.length;
  const d = [0xB2, 1, mt || 7, hash | 0, SEED, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (hash, mt) => (hash | 0) + '_' + SEED + '_' + (mt || 7);

// ---- [0] ----
console.log('[0] the wait against the client\'s endless resend window');
T('ENDLESS_LONE.CLIENT_TTL_MS is 72 hours (the game\'s OB.TTL_ENDLESS_MS, pinned there)', v.ENDLESS_LONE.CLIENT_TTL_MS === 72 * HOUR, J(v.ENDLESS_LONE));
T('ENDLESS_LONE.WAIT_MS >= CLIENT_TTL_MS + 30 min', W >= v.ENDLESS_LONE.CLIENT_TTL_MS + 30 * MIN, J(v.ENDLESS_LONE));
T('ENDLESS_LONE.WAIT_MS well inside the 30-day life of an endless start entry', W < v.ENDLESS.PENDING_TTL_MS / 4, String(v.ENDLESS.PENDING_TTL_MS));
T('accepted ends: finished, peers-gone, host-left, finished without a summary (Q68) -- never a quit, a kick or an error', J(v.ENDLESS_LONE.DISPS.slice().sort((a, b) => a - b)) === J([0, 1, 2, v.DISP_NOSUMMARY]) && v.DISP_NOSUMMARY === 10, J(v.ENDLESS_LONE.DISPS));
T('exported: endlessLoneClaim / endlessLoneVerdicts', typeof v.endlessLoneClaim === 'function' && typeof v.endlessLoneVerdicts === 'function');

// ---- [1] units ----
console.log('[1] endlessLoneClaim / endlessLoneVerdicts');
{
  const A = H.SID(9701), B = H.SID(9702), X = H.SID(9703), Z = H.SID(9704);
  const HASH = 0x40601, KEY = keyOf(HASH);
  const res = (sid, seat, ros, o) => { const d = en7(HASH, seat, ros, o); const disp = (o && o.disp) | 0; return { steamID: sid, shard: 's0', d, dispCode: disp, disp: v.dispName(disp), roster: v.decodeRoster(d) }; };
  const vecOf = (r) => { const pc = r.d[8] | 0; return J(r.d.slice(10, 10 + pc).concat(r.d.slice(11 + 3 * pc, 15 + 3 * pc))); };
  const ros2 = [A, B];
  const ro2 = v.decodeRoster(en7(HASH, 0, ros2));
  const tst2 = { [v.pid(A)]: v.testimonyOf(2, 0, ro2), [v.pid(B)]: v.testimonyOf(2, 1, ro2) };
  const entry = (o) => Object.assign({ t0: 1, mt: 7, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [v.pid(B)], started: [v.pid(A), v.pid(B)], tst: Object.assign({}, tst2) }, o || {});
  // B (seat 1, the joiner) wrote his result, A (seat 0, the host) started and wrote nothing
  const g = [res(B, 1, ros2)];
  const claim = (p, gg, o) => { const x = o || {}; return v.endlessLoneClaim(p, KEY, gg || g, x.pending || {}, x.processed || new Set(), x.confState || {}, x.confSeen || new Set(), vecOf); };
  const c0 = claim(entry());
  T('honest shape: claims for its writer at his seat', !!c0 && c0.w === B && c0.seat === 1 && c0.pc === 2 && c0.m === KEY, J(c0));
  T('two records of his (a resend copy) still claim', !!claim(entry(), [res(B, 1, ros2), res(B, 1, ros2)]));
  T('his result says peers-gone: claims (the host whose partner left writes that)', !!claim(entry(), [res(B, 1, ros2, { disp: 1 })]));
  T('his result says host-left: claims (the joiner whose host left writes that)', !!claim(entry(), [res(B, 1, ros2, { disp: 2 })]));
  T('his result is finished without a summary (Q68): claims', !!claim(entry(), [res(B, 1, ros2, { disp: 10 })]));
  T('the host wrote, the joiner is silent: claims too', !!claim(entry({ settled: [v.pid(A)] }), [res(A, 0, ros2)]));
  T('no testimony of his own on record (his start rotated off before it was read): still claims', !!claim(entry({ tst: { [v.pid(A)]: tst2[v.pid(A)] } })));
  T('roster still provisional: nothing', claim(entry({ prov: 'abc' })) === null);
  T('roster split: nothing', claim(entry({ split: 1 })) === null);
  T('synthetic entry (no start roster): nothing', claim(entry({ synth: true, roster: {} })) === null);
  T('entry lent its t0 to a table split: nothing', claim(entry({ lent: 5 })) === null);
  T('contest note on the key: nothing', claim(entry(), null, { pending: { ['~' + KEY]: { t0: 1, c: 1 } } }) === null);
  T('key split before (its mark processed): nothing', claim(entry(), null, { processed: new Set([v.splitMark(KEY)]) }) === null);
  T('key processed: nothing', claim(entry(), null, { processed: new Set([KEY]) }) === null);
  T('silent seat never wrote his own start: nothing', claim(entry({ started: [v.pid(B)] })) === null);
  T('silent seat wrote a result once (p.settled): nothing', claim(entry({ settled: [v.pid(B), v.pid(A)] })) === null);
  T('silent seat confessed (state): nothing', claim(entry(), null, { confState: { [v.pid(A) + '|' + KEY]: { t0: 1 } } }) === null);
  T('silent seat confessed (read this run): nothing', claim(entry(), null, { confSeen: new Set([v.pid(A) + '|' + KEY]) }) === null);
  T('the writer confessed: nothing', claim(entry(), null, { confSeen: new Set([v.pid(B) + '|' + KEY]) }) === null);
  T('silent seat\'s start told another story (two stories, \'x\'): nothing', claim(entry({ tst: Object.assign({}, tst2, { [v.pid(A)]: 'x' }) })) === null);
  T('silent seat\'s start put him at the other seat: nothing', claim(entry({ tst: Object.assign({}, tst2, { [v.pid(A)]: v.testimonyOf(2, 1, ro2) }) })) === null);
  T('silent seat without any testimony on record: nothing', claim(entry({ tst: { [v.pid(B)]: tst2[v.pid(B)] } })) === null);
  T('the writer told two stories (\'x\'): nothing', claim(entry({ tst: Object.assign({}, tst2, { [v.pid(B)]: 'x' }) })) === null);
  for (const [dc, nm] of [[5, 'user-quit'], [7, 'kicked'], [8, 'eac-kick'], [9, 'eac-drop'], [3, 'level-begin-timeout'], [11, 'game-error']]) {
    T('his result is ' + nm + ': nothing', claim(entry(), [res(B, 1, ros2, { disp: dc })]) === null);
  }
  T('one of his two records is a quit: nothing', claim(entry(), [res(B, 1, ros2), res(B, 1, ros2, { disp: 5 })]) === null);
  {
    const ins = res(B, 1, ros2, { from: 5, to: 3 });   // depth going backwards
    T('his result fails the sanity screen: nothing', v.sanityFlags([ins]).length > 0 && claim(entry(), [ins]) === null, J(v.sanityFlags([ins])));
  }
  {
    const cr = res(B, 1, ros2, { flags: attest.SEG_COUCH });
    T('a couch segment (one machine, own lane): nothing', v.isCouchRec(cr) && claim(entry(), [cr]) === null);
  }
  T('his result names another table (an alt at seat 0): nothing', claim(entry(), [res(B, 1, [X, B])]) === null);
  T('his result names a third seat the roster has not: nothing', claim(entry(), [res(B, 1, [A, B, Z])]) === null);
  T('two writers: nothing (the normal settle owns it)', claim(entry(), [res(B, 1, ros2), res(A, 0, ros2)]) === null);
  T('his two records disagree on the depth: nothing', claim(entry(), [res(B, 1, ros2), res(B, 1, ros2, { to: 6 })]) === null);
  T('written from a seat the roster gives somebody else: nothing', claim(entry(), [res(B, 0, [B, A])]) === null);
  {
    const d = en7(HASH, 0, [B]);   // the signed solo lane (pc 1) settles alone already
    const r = { steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) };
    T('one seat (the solo lane): nothing', claim(entry({ roster: { 0: v.pid(B) }, started: [v.pid(B)] }), [r]) === null);
  }
  {
    const d = H.rec(0xB1, 10, HASH, 1, 1, true, ros2, [500, 300], 0);   // a friends' room record: Q316's lane
    const r = { steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) };
    T('not endless (a friends\' room, Q316): nothing', claim(entry({ mt: 10 }), [r]) === null);
  }
  // three seats: one wrote, the two others started and wrote nothing -> claims too
  {
    const ros3 = [A, X, B];
    const ro3 = v.decodeRoster(en7(HASH, 0, ros3));
    const g3 = [res(B, 2, ros3)];
    const p3 = entry({ roster: { 0: v.pid(A), 1: v.pid(X), 2: v.pid(B) }, started: [v.pid(A), v.pid(X), v.pid(B)], tst: { [v.pid(A)]: v.testimonyOf(3, 0, ro3), [v.pid(X)]: v.testimonyOf(3, 1, ro3), [v.pid(B)]: v.testimonyOf(3, 2, ro3) } });
    T('three seats, the two others started and wrote nothing: claims', !!claim(p3, g3));
    T('three seats, one of the others never started: nothing', claim(Object.assign({}, p3, { started: [v.pid(A), v.pid(B)] }), g3) === null);
    T('three seats on a roster of two: nothing', claim(entry(), g3) === null);
  }
  // the verdict pass: stamps, waits, pays, forgets
  {
    const pend = { [KEY]: entry() };
    const groups = { [KEY]: g };
    const run = (now, complete, ck) => v.endlessLoneVerdicts(pend, groups, new Set(), ck || new Set(), now, {}, new Set(), complete, vecOf);
    const r1 = run(1000, true);
    T('first sight: waiting, stamped (p.el), no absence stamp yet', r1.waiting === 1 && !r1.due.length && pend[KEY].el === 1000 && pend[KEY].absentAt === undefined, J(r1) + ' ' + J(pend[KEY]));
    const r2 = run(1000 + W - 1, true);
    T('a millisecond short of the wait: still waiting', r2.waiting === 1 && !r2.due.length && pend[KEY].el === 1000);
    const r3 = run(1000 + W, false);
    T('due on an incomplete read: held, still no absence stamp', r3.held === 1 && !r3.due.length && pend[KEY].absentAt === undefined, J(pend[KEY]));
    const r4 = run(1000 + W, true);
    T('due on a complete read: the group, marked enLone', r4.due.length === 1 && r4.due[0].enLone === true && r4.due[0].m === KEY && r4.due[0].g === g && r4.due[0].void === false, J(r4.due.map((x) => x.m)));
    T('due on a complete read: the absence stamp set to p.el (its grace already over)', pend[KEY].absentAt === 1000, J(pend[KEY]));
    {
      const pa = { [KEY]: entry({ absentAt: 777 }) };
      v.endlessLoneVerdicts(pa, groups, new Set(), new Set(), 1000, {}, new Set(), true, vecOf);
      v.endlessLoneVerdicts(pa, groups, new Set(), new Set(), 1000 + W, {}, new Set(), true, vecOf);
      T('an absence stamp already there is kept', pa[KEY].absentAt === 777, J(pa[KEY]));
    }
    const r5 = run(2000 + W, true, new Set([KEY]));
    T('a consistent key (his partner\'s result landed): skipped, nothing due', !r5.due.length && !r5.waiting);
    {
      const pq = { [KEY]: entry({ mt: 10 }) };
      const rq = v.endlessLoneVerdicts(pq, groups, new Set(), new Set(), 1000, {}, new Set(), true, vecOf);
      T('an entry of another match type is not looked at', !rq.waiting && !rq.due.length && pq[KEY].el === undefined);
    }
    groups[KEY] = [];
    run(3000 + W, false);
    T('claim gone on an incomplete read: the stamp is kept', pend[KEY].el === 1000);
    run(3000 + W, true);
    T('claim gone on a complete read: the stamp is dropped (the wait starts over)', pend[KEY].el === undefined);
    groups[KEY] = g; pend[KEY].el = 9e15;
    run(5000, true);
    T('a stamp from the future restarts the wait', pend[KEY].el === 5000);
  }
}

// ---- end to end harness ----
const BOARD = { progress: 5, rating: 6, points: 7, cp: 8, endless: 11, trio: 12, quad: 13, compDuo: 16, compTrio: 14 };
const CP0 = 1000;
const extra = (cpHolders) => [{ id: BOARD.progress, name: 'progress', entries: [] }, { id: BOARD.rating, name: 'rating', entries: [] }, { id: BOARD.points, name: 'points', entries: [] },
  { id: BOARD.cp, name: 'cp_bank', entries: (cpHolders || []).map((s) => ({ steamID: s, score: CP0 })) }, { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
  { id: BOARD.endless, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
  { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: 17, name: 'endless_comp_quad', entries: [] }];
// steps: [[ms since the previous run, records, env]]; the boards are stateless (every write is read off the post log)
function run(steps, cpHolders, script) {
  const rs = [];
  let state = null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(H.shardBoards(recs, extra(cpHolders)), state ? H.advance(state, ms) : null, env || null, script || null, 'q406');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0), last: rs[rs.length - 1] };
}
const postsTo = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const postsAt = (m, i, board, sid) => H.postsOf(m.rs[i], board, sid);
const xpBy = (m, i, sid) => { for (let k = 0; k < m.rs.length && k <= i; k++) if (H.postsOf(m.rs[k], BOARD.progress, sid).length) return true; return false; };
const lastCp = (m, sid) => { const w = postsTo(m, BOARD.cp, sid); return w.length ? w[w.length - 1].score : null; };
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation and the 5-minute absence grace
// a duo segment: starts of the given seats, results of the given seats
function seg(hash, ros, starters, writers, o) {
  const S = starters.map((seat) => ({ sid: ros[seat], d: st7(hash, seat, ros) }));
  const R = writers.map((seat) => ({ sid: ros[seat], d: en7(hash, seat, ros, Object.assign({}, o || {}, { disp: ((o && o.disp) || {})[seat] | 0 })) }));
  return { S, R, all: S.concat(R), key: keyOf(hash) };
}
// the steps of one lone key: first sight, the roster confirmed, waits, the due run (index 4), then later runs
const loneSteps = (recs, env) => [[0, recs], [STEP, recs], [W - 2 * STEP, recs], [STEP, recs], [STEP, recs, env || null], [STEP, recs], [DAY, recs], [8 * DAY, recs]];
const DUE = 4;

// ---- [2] ----
console.log('[2] end to end, casual co-op duo: two writers, one writer, a late second result');
const control2 = (() => {
  const A = H.SID(9711), B = H.SID(9712);
  const m = seg(0x40611, [A, B], [0, 1], [0, 1]);
  const t = run([[0, m.all], [STEP, m.all], [STEP, m.all], [HOUR, m.all]]);
  T('control: runs ok', t.okAll, t.out.slice(-1500));
  T('control: both writers get XP and the duo best', postsTo(t, BOARD.progress, A).length === 1 && postsTo(t, BOARD.progress, B).length === 1 && postsTo(t, BOARD.endless, A).length >= 1 && postsTo(t, BOARD.endless, B).length >= 1, J([postsTo(t, BOARD.progress, A), postsTo(t, BOARD.progress, B)]));
  T('control: no lone verdict', !/endless-lone/.test(t.out));
  return { xp: postsTo(t, BOARD.progress, B)[0], best: postsTo(t, BOARD.endless, B).slice(-1)[0] };
})();
function loneDuo(script) {
  const A = H.SID(9721), B = H.SID(9722);
  const m = seg(0x40621, [A, B], [0, 1], [1], { disp: { 1: 2 } });   // the host (A) left, B's result says host-left
  return { A, B, t: run(loneSteps(m.all), null, script) };
}
{
  const { A, B, t } = loneDuo();
  T('one writer: runs ok', t.okAll, t.out.slice(-1500));
  T('one writer: nothing for him before the wait', !xpBy(t, DUE - 1, B), J(postsTo(t, BOARD.progress, B)));
  T('one writer: the wait is logged once, on first sight', /endless-lone .*settles for him alone in 73 h unless theirs land \(Q406\)/.test(t.rs[1].out) && (t.out.match(/settles for him alone in/g) || []).length === 1);
  T('one writer: paid on the due run (the wait over)', postsAt(t, DUE, BOARD.progress, B).length === 1, J(postsTo(t, BOARD.progress, B)));
  T('one writer: the same XP and best as beside a second writer', J(postsTo(t, BOARD.progress, B)[0]) === J(control2.xp) && (postsTo(t, BOARD.endless, B).slice(-1)[0] || {}).score === control2.best.score, J([postsTo(t, BOARD.progress, B), postsTo(t, BOARD.endless, B), control2]));
  T('one writer: paid once only (a day and a week later, nothing more)', postsTo(t, BOARD.progress, B).length === 1, J(postsTo(t, BOARD.progress, B)));
  T('one writer: the silent seat gets nothing (no XP, no best)', postsTo(t, BOARD.progress, A).length === 0 && postsTo(t, BOARD.endless, A).length === 0);
  T('one writer: the settle is logged as Q406', /endless settle .*\(one writer, the other seat\(s\) wrote no result: for him alone, Q406\)/.test(t.rs[DUE].out), t.rs[DUE].out.split('\n').filter((l) => /endless/.test(l)).join(' | '));
  T('one writer: summary row (due 1, paid 1)', /endless co-op segments only one player wrote a result for[^\n]*\| 1 \/ 0 \/ 0 \(1\) \/ 0 \|/.test(t.rs[DUE].summary), (t.rs[DUE].summary.match(/[^\n]*Q406[^\n]*/) || [''])[0]);
}
{
  const A = H.SID(9731), B = H.SID(9732);
  const m = seg(0x40631, [A, B], [0, 1], [0, 1]);
  const early = m.S.concat(m.R.filter((r) => r.sid === B));
  // A's result lands 71 hours after B's (his client's resend, inside its 72-hour window); the job keeps running in between,
  //   so a wait shorter than the client's window would have settled the key for B alone first
  const steps = [[0, early], [STEP, early]];
  for (let i = 0; i < 7; i++) steps.push([10 * HOUR, early]);
  steps.push([71 * HOUR - STEP - 70 * HOUR, m.all], [STEP, m.all], [STEP, m.all], [4 * HOUR, m.all], [DAY, m.all]);
  const t = run(steps);
  T('late second result: runs ok', t.okAll, t.out.slice(-1500));
  T('late second result: nothing paid before it landed', !xpBy(t, 8, A) && !xpBy(t, 8, B));
  T('late second result: both paid, once each, as in the control', postsTo(t, BOARD.progress, A).length === 1 && postsTo(t, BOARD.progress, B).length === 1, J([postsTo(t, BOARD.progress, A), postsTo(t, BOARD.progress, B)]));
  T('late second result: no lone settle', !/for him alone, Q406/.test(t.out));
}

// ---- [3] ----
console.log('[3] continues: the writer pays as beside a second writer, the silent seat is not charged');
const CONT = 0x12;   // seat 0 (the host) pressed continue twice, seat 1 once
const ctl3 = (() => {
  const A = H.SID(9741), B = H.SID(9742);
  const m = seg(0x40641, [A, B], [0, 1], [0, 1], { cont: CONT });
  const t = run([[0, m.all], [STEP, m.all], [STEP, m.all], [HOUR, m.all]], [A, B]);
  T('control: runs ok', t.okAll, t.out.slice(-1500));
  const a = lastCp(t, A), b = lastCp(t, B);
  T('control: both charged (the host more, two presses)', a != null && b != null && a < CP0 && b < CP0, J([a, b]));
  return { a, b };
})();
function loneCont(script) {
  const A = H.SID(9751), B = H.SID(9752);
  const m = seg(0x40651, [A, B], [0, 1], [1], { cont: CONT });
  return { A, B, t: run(loneSteps(m.all), [A, B], script) };
}
{
  const { A, B, t } = loneCont();
  T('one writer: runs ok', t.okAll, t.out.slice(-1500));
  T('one writer: he is charged what he is charged beside a second writer', lastCp(t, B) === ctl3.b, J([lastCp(t, B), ctl3]));
  T('one writer: the silent host is not charged', postsTo(t, BOARD.cp, A).length === 0, J(postsTo(t, BOARD.cp, A)));
  T('one writer: logged, and counted in the summary', /endless cp .*seat 0 [0-9a-f]+ 2 continues \([0-9]+\) not charged -- he wrote no result, the one writer's word only \(Q406\)/.test(t.out)
    && new RegExp('\\| 1 / 0 / 0 \\(1\\) / ' + (CP0 - ctl3.a) + ' \\|').test(t.rs[DUE].summary), (t.rs[DUE].summary.match(/[^\n]*Q406[^\n]*/) || [''])[0]);
}

// ---- [4] ----
console.log('[4] team competitive duo: a resumed final segment only the joiner wrote');
const histOf = (r, sid) => ((((r.state.SOLO_FILE || {}).hist) || {})[v.pid(sid) + '|duo|0'] || { runs: [] }).runs;
function compDuo(base, hostWrites, script) {
  const Hh = H.SID(base), Jj = H.SID(base + 1);
  const ros = [Hh, Jj];
  const a = seg(0x40660 + base, ros, [0, 1], [0, 1], { from: 0, to: 5, flags: attest.SEG_COMP | attest.SEG_SUSPENDED });
  const b = seg(0x40670 + base, ros, [0, 1], hostWrites ? [0, 1] : [1], { from: 5, to: 9, flags: attest.SEG_COMP | attest.SEG_RESUMED | attest.SEG_FINAL, disp: { 1: 2 } });
  const ra = a.all, rb = a.all.concat(b.all);
  const steps = [[0, ra], [10 * MIN, ra], [10 * MIN, rb]].concat(hostWrites ? [[10 * MIN, rb], [10 * MIN, rb]] : loneSteps(rb).slice(1));
  return { Hh, Jj, t: run(steps, [Hh, Jj], script) };
}
{
  const { Hh, Jj, t } = compDuo(9760, true);
  T('control: runs ok', t.okAll, t.out.slice(-1500));
  T('control: both segments settle', (t.out.match(/endless-comp settle /g) || []).length === 2, (t.out.match(/endless-comp[^\n]*/g) || []).join(' | '));
  T('control: the host pays the resume fee', lastCp(t, Hh) === CP0 - v.COMP.RESUME_CP, J(postsTo(t, BOARD.cp, Hh)));
  const hH = histOf(t.last, Hh), hJ = histOf(t.last, Jj);
  T('control: both runs reach depth 9 and end (final)', hH.length === 1 && hJ.length === 1 && hH[0][1] === 9 && hJ[0][1] === 9 && (hH[0][7] & 1) === 1 && (hJ[0][7] & 1) === 1, J([hH, hJ]));
}
function loneComp(script) { return compDuo(9770, false, script); }
{
  const { Hh, Jj, t } = loneComp();
  T('one writer: runs ok', t.okAll, t.out.slice(-1500));
  T('one writer: the first segment settles at once, the second only after the wait', (t.rs[1].out.match(/endless-comp settle /g) || []).length === 1 && !/endless-comp settle /.test(t.rs.slice(2, 2 + DUE).map((r) => r.out).join(''))
    && /endless-comp settle .*\(one writer, the other seat\(s\) wrote no result: for him alone, Q406\)/.test(t.rs[2 + DUE].out), (t.out.match(/endless-(comp|lone)[^\n]*/g) || []).join(' | '));
  T('one writer: the silent host pays no resume fee (logged)', postsTo(t, BOARD.cp, Hh).filter((p) => p.score < CP0).length === 0 && /host [0-9a-f]+ resume fee 20 not charged -- he wrote no result, the one writer's word only \(Q406\)/.test(t.out), J(postsTo(t, BOARD.cp, Hh)));
  const hH = histOf(t.last, Hh), hJ = histOf(t.last, Jj);
  T('one writer: his run reaches depth 9 and ends', hJ.length === 1 && hJ[0][1] === 9 && (hJ[0][7] & 1) === 1, J(hJ));
  T('one writer: the host\'s run stays as today: at his own depth 5, parked on its save point, not ended by the joiner\'s word', hH.length === 1 && hH[0][1] === 5 && (hH[0][7] & 1) === 0, J(hH));
  T('one writer: his duo best written on the due run, none for the host then (his stays from the segment he wrote)', postsAt(t, 2 + DUE, BOARD.compDuo, Jj).length === 1 && postsAt(t, 2 + DUE, BOARD.compDuo, Hh).length === 0 && postsAt(t, 1, BOARD.compDuo, Hh).length === 1,
    J([postsTo(t, BOARD.compDuo, Jj), postsTo(t, BOARD.compDuo, Hh)]));
}

// ---- [5] ----
console.log('[5] an incomplete read at the due time');
{
  const A = H.SID(9781), B = H.SID(9782);
  const m = seg(0x40681, [A, B], [0, 1], [1]);
  const FAIL = { STUB_FAIL: J({ shard_40: 503 }) };
  const t = run(loneSteps(m.all, FAIL));
  T('incomplete read: runs ok', t.okAll, t.out.slice(-1500));
  T('incomplete read: held, nothing paid that run', !xpBy(t, DUE, B) && /endless-lone .*due, held \(incomplete shard read\)/.test(t.rs[DUE].out), t.rs[DUE].out.split('\n').filter((l) => /endless-lone|shard/.test(l)).join(' | '));
  T('incomplete read: the next complete read pays, once', postsAt(t, DUE + 1, BOARD.progress, B).length === 1 && postsTo(t, BOARD.progress, B).length === 1, J(postsTo(t, BOARD.progress, B)));
  T('incomplete read: the silent seat gets nothing', postsTo(t, BOARD.progress, A).length === 0);
}

// ---- [6] ----
console.log('[6] end to end: nothing for');
function nothingFor(label, base, recsOf, script) {
  const A = H.SID(base), B = H.SID(base + 1), X = H.SID(base + 2);
  const t = run(loneSteps(recsOf(A, B, X)), null, script);
  if (!script) T(label + ': runs ok', t.okAll, t.out.slice(-1500));
  return { A, B, X, t };
}
{
  const { A, B, t } = nothingFor('no start of the other seat', 9791, (A, B) => seg(0x40691, [A, B], [1], [1]).all);
  T('no start of the other seat: nothing (one start registers no roster)', postsTo(t, BOARD.progress, B).length === 0 && postsTo(t, BOARD.progress, A).length === 0 && !/endless-lone/.test(t.out));
}
{
  const { B, X, t } = nothingFor('outside start from the silent seat', 9795, (A, B, X) => seg(0x40695, [A, B], [0, 1], [1]).all.concat([{ sid: X, d: st7(0x40695, 0, [X, B]) }]));
  T('outside start from the silent seat: nobody paid (the key is contested)', postsTo(t, BOARD.progress, B).length === 0 && postsTo(t, BOARD.progress, X).length === 0 && !/for him alone, Q406/.test(t.out));
}
function insane(script) { return nothingFor('his result fails the sanity screen', 9801, (A, B) => seg(0x406A1, [A, B], [0, 1], [1], { from: 5, to: 3 }).all, script); }
{
  const { B, t } = insane();
  T('his result fails the sanity screen: not paid, not flagged, no lone verdict (as today)', postsTo(t, BOARD.progress, B).length === 0 && !/sanity-flagged|sanity flag/.test(t.out) && !/endless-lone/.test(t.out), (t.out.match(/[^\n]*sanity[^\n]*/g) || []).join(' | '));
}
function kicked(script) { return nothingFor('an anti-cheat kick', 9805, (A, B) => seg(0x406A5, [A, B], [0, 1], [1], { disp: { 1: 8 } }).all, script); }
{
  const { B, t } = kicked();
  T('his result is an anti-cheat kick: not paid, no lone verdict', postsTo(t, BOARD.progress, B).length === 0 && !/endless-lone/.test(t.out));
}

// ---- [7] ----
console.log('[7] three seats');
{
  const A = H.SID(9811), C = H.SID(9812), B = H.SID(9813);
  const m = seg(0x406B1, [A, C, B], [0, 1, 2], [2], { disp: { 2: 2 } });
  const t = run(loneSteps(m.all));
  T('three, one writer: runs ok', t.okAll, t.out.slice(-1500));
  T('three, one writer: paid on the due run, the trio best his alone', postsAt(t, DUE, BOARD.progress, B).length === 1 && postsTo(t, BOARD.progress, B).length === 1 && postsTo(t, BOARD.trio, B).length >= 1 && !postsTo(t, BOARD.trio, A).length && !postsTo(t, BOARD.trio, C).length, J([postsTo(t, BOARD.progress, B), postsTo(t, BOARD.trio, B)]));
  T('three, one writer: the two silent seats get nothing', postsTo(t, BOARD.progress, A).length === 0 && postsTo(t, BOARD.progress, C).length === 0);
}
{
  const A = H.SID(9821), C = H.SID(9822), B = H.SID(9823);
  const m = seg(0x406C1, [A, C, B], [0, 1, 2], [1, 2]);
  const early = m.S.concat(m.R.filter((r) => r.sid === B));
  const t = run([[0, early], [STEP, early], [HOUR, early], [5 * HOUR, m.all], [STEP, m.all], [STEP, m.all], [HOUR, m.all], [DAY, m.all]]);
  T('three, the second result late inside the wait: runs ok', t.okAll, t.out.slice(-1500));
  T('three, the second result late inside the wait: settled for the two writers as today (Q47), no lone settle', postsTo(t, BOARD.progress, B).length === 1 && postsTo(t, BOARD.progress, C).length === 1 && postsTo(t, BOARD.progress, A).length === 0 && !/for him alone, Q406/.test(t.out),
    J([postsTo(t, BOARD.progress, B), postsTo(t, BOARD.progress, C)]) + ' ' + (t.out.match(/endless (settle|absent)[^\n]*/g) || []).join(' | '));
}

// ---- [8] mutation self-checks ----
console.log('[8] mutation self-checks');
{
  const SRC = fs.readFileSync(H.VALIDATE, 'utf8');
  const unitClaims = (mod, patch) => {   // the honest unit shape with one condition broken: does the (mutated) claim still claim?
    const A = H.SID(9901), B = H.SID(9902), HASH = 0x40901, KEY = keyOf(HASH), ros2 = [A, B];
    const d = en7(HASH, 1, ros2);
    const g = [{ steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: mod.decodeRoster(d) }];
    const ro2 = mod.decodeRoster(en7(HASH, 0, ros2));
    const p = Object.assign({ t0: 1, mt: 7, roster: { 0: mod.pid(A), 1: mod.pid(B) }, settled: [mod.pid(B)], started: [mod.pid(A), mod.pid(B)], tst: { [mod.pid(A)]: mod.testimonyOf(2, 0, ro2), [mod.pid(B)]: mod.testimonyOf(2, 1, ro2) } }, patch(mod, A, B, ro2));
    const vecOf = (r) => { const pc = r.d[8] | 0; return J(r.d.slice(10, 10 + pc).concat(r.d.slice(11 + 3 * pc, 15 + 3 * pc))); };
    return !!mod.endlessLoneClaim(p, KEY, g, {}, new Set(), {}, new Set(), vecOf);
  };
  const noStart = (mod) => unitClaims(mod, (m, A, B) => ({ started: [m.pid(B)] }));
  const otherStory = (mod) => unitClaims(mod, (m, A, B, ro2) => ({ tst: { [m.pid(A)]: m.testimonyOf(2, 1, ro2), [m.pid(B)]: m.testimonyOf(2, 1, ro2) } }));   // the silent seat's start put him at the joiner's seat
  const lateSecond = (script) => {   // the late second result scenario of [2]: with no wait, B settles alone first and A's result comes too late
    const A = H.SID(9911), B = H.SID(9912);
    const m = seg(0x40911, [A, B], [0, 1], [0, 1]);
    const early = m.S.concat(m.R.filter((r) => r.sid === B));
    const t = run([[0, early], [STEP, early], [STEP, early], [HOUR, early], [5 * HOUR, m.all], [STEP, m.all], [STEP, m.all]], null, script);
    return t.okAll && postsTo(t, BOARD.progress, A).length === 0;
  };
  const silentCharged = (script) => { const { A, t } = loneCont(script); return t.okAll && postsTo(t, BOARD.cp, A).some((p) => p.score < CP0); };
  const hostFeeOrEnded = (script) => { const { Hh, t } = loneComp(script); const hH = histOf(t.last, Hh); return t.okAll && (postsTo(t, BOARD.cp, Hh).some((p) => p.score < CP0) || (!!hH[0] && (hH[0][7] & 1) === 1)); };
  const hostEnded = (script) => { const { Hh, t } = loneComp(script); const hH = histOf(t.last, Hh); return t.okAll && !!hH[0] && (hH[0][7] & 1) === 1; };
  const notPaid = (script) => { const { B, t } = loneDuo(script); return t.okAll && postsTo(t, BOARD.progress, B).length === 0; };
  const lateByARun = (script) => { const { B, t } = loneDuo(script); return t.okAll && postsAt(t, DUE, BOARD.progress, B).length === 0; };
  const kickPaid = (script) => { const { B, t } = kicked(script); return postsTo(t, BOARD.progress, B).length > 0 || /endless-lone/.test(t.out); };
  const insaneSeen = (script) => { const { t } = insane(script); return /endless-lone/.test(t.out) || /sanity/.test(t.out); };
  const mutants = [
    // [label, from, to, check(script or module), unit?]
    ['the silent seat\'s own start not required', "    if (h === wp || !hasOwnStart(p, h) || (p.settled || []).indexOf(h) >= 0 || said(h)) return null;\n    if (tst[h] !==", "    if (h === wp || (p.settled || []).indexOf(h) >= 0 || said(h)) return null;\n    if (tst[h] !==", noStart, true],
    ['the testimony checks removed', "if (tst[h] !== testimonyOf(pc, s, g[0].roster)) return null;", '', otherStory, true],
    ['no wait', 'const ENDLESS_LONE = { WAIT_MS: 73 * 3600000,', 'const ENDLESS_LONE = { WAIT_MS: 0,', lateSecond],
    ['the silent seats charged like writers (loneSilent never true)', 'const loneSilent = (sid) => !!c.enLone && writerSids.indexOf(String(sid)) < 0;', 'const loneSilent = (sid) => false;', silentCharged],
    ['the resume-fee skip removed', 'if (loneSilent(host)) {', 'if (false) {', hostFeeOrEnded],
    ['the team final ends the silent members\' runs', "if (!PT_MODE && !c.enLone && ((f.flags | 0) & attest.SEG_FINAL))", "if (!PT_MODE && ((f.flags | 0) & attest.SEG_FINAL))", hostEnded],
    ['the verdicts not joined to the settle', 'for (const c of elRes.due) consistentMatches.push(c);', '', notPaid],
    ['no absence stamp on the due run', 'if (!(Number(p.absentAt) > 0)) p.absentAt = p.el;   // only now (see above)', '', lateByARun],
    ['every end accepted', 'ENDLESS_LONE.DISPS.indexOf(r.dispCode | 0) < 0) return null;', 'false) return null;', kickPaid],
    ['the sanity screen not asked', 'if (isCouchRec(r) || vecOf(r) !== v0 || sanityFlags([r]).length) return null;', 'if (isCouchRec(r) || vecOf(r) !== v0) return null;', insaneSeen],
  ];
  for (const [label, from, to, check, unit] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[8] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(path.dirname(H.VALIDATE), '.mutant-endless-lone-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      let red;
      if (unit) { delete require.cache[require.resolve(script)]; red = check(require(script)); }
      else red = check(script);
      T('[8] ' + label + ' -> its scenario goes red', red);
    } catch (e) { bad('[8] ' + label + ': ' + (e && e.stack || e)); }
    finally { try { delete require.cache[require.resolve(script)]; } catch (e) {} try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? '\nendless-lone-stayer: ' + failN + ' FAILED' : '\nendless-lone-stayer: all ok');
process.exit(failN ? 1 : 0);
