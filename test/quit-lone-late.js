'use strict';
// W113 (follow-up of W103 / O507): a quick 1V1 settled on the quit-lone lane for the stayer, whose quitter had come back
// after his Esc and dropped later (no Esc: his client writes host-left or reconnect-failed). His own result lands after the
// lane settled the key: the confession pass forgives his leave on it, and now he is paid his share of the two records, as
// the normal settle of them pays it (before: 0 -- the lane had processed the key; cloud review of W103, residual 1).
//   [0] the export
//   [1] units (quitLoneLateDue): the honest shape is due; nothing without the lane's stamp, once paid, before the
//       forgiveness, on a conviction / synthetic entry, on an unprocessed key or without the group; the shapes it does not
//       pay (a quit end of his, another writer, a seat swapped, ranked, his record alone, two records of his, a sanity flag)
//       are logged and left
//   [2] end to end: his host-left / reconnect-failed result after the lane -- 100 (the same XP / CP as the normal settle of
//       the same records, which pays the stayer the full 340 when it comes first), a career game, his streak frozen, once
//       only; the stayer as the lane paid him; the signals of both; no rating; the joiner stayed (the host's late
//       reconnect-failed with the joiner's host-left: a void consensus, its signals as such)
//   [3] end to end, the edges: a finished result of his (an interrupted end: no second winner), the result after the
//       confession window (nothing, the leave stands), a result with other scores (nothing), one level played (the progress
//       discount, no floor for him), his own newer match settling in the same run (the older share first), one match at a
//       time (deferred one run, then paid once), a seedcap veto on the key (held, paid once lifted), his seedcap reject
//       window (his XP only)
// End to end over the REAL validate.js main() against the offline board stub of test/lib/settle-stub.js.
const path = require('path');
process.env.STATE_SALT = 's';   // the child runs' salt, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000;

// record (result-reporter wire form) with a level count: magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc,
//   dur, scores, disp, roster; a start (0xB2) and a confession (0xB5) carry zeroed results
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp, prog) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, zero ? 1 : 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : (((prog == null ? 6 : prog) << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : ((sc || [])[i] | 0));
  d.push(disp | 0);
  for (const s of ros) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const FINISHED = 0, PEERS_GONE = 1, HOST_LEFT = 2, USER_QUIT = 5, RECONNECT_FAILED = 6;

// ---- [0] ----
console.log('[0] the export');
T('exported: quitLoneLateDue', typeof v.quitLoneLateDue === 'function');

// ---- [1] units ----
console.log('[1] quitLoneLateDue');
if (typeof v.quitLoneLateDue !== 'function') bad('quitLoneLateDue missing: the units skipped (the end-to-end sections below still run)');
else {
  const A = H.SID(9801), B = H.SID(9802), X = H.SID(9803);
  const KEY = (0x10401 | 0) + '_1234_1', KEY2 = (0x10401 | 0) + '_1234_2';
  const res = (sid, seat, disp, o) => {
    const x = o || {};
    const ros = x.ros || [A, B], sc = x.sc || [500, 300];
    const d = rec(0xB1, x.mt || 1, 0x10401, seat, 1 + sc.filter((y) => y > sc[seat]).length, false, ros, sc, disp, x.prog);
    return { steamID: sid, shard: 's0', d, dispCode: d[10 + ros.length] | 0, disp: v.dispName(d[10 + ros.length] | 0), roster: v.decodeRoster(d) };
  };
  // A (seat 0) stayed, B (seat 1) quit, confessed, came back and dropped: the lane stamped B's entry
  const stamp = (o) => Object.assign({ t0: 1, mt: 1, ded: 0, ex: 0, refunded: 1, ql: { w: v.pid(A), s: 1, t: 5 } }, o || {});
  const due = (o) => {
    const x = o || {};
    const key = x.key || KEY;
    const cs = { [v.pid(B) + '|' + key]: x.st === undefined ? stamp() : x.st };
    const cm = x.cm || [{ m: key, g: x.g || [res(A, 0, PEERS_GONE), res(B, 1, HOST_LEFT)], void: false }];
    const r = v.quitLoneLateDue(cs, cm, x.processed || new Set([key]));
    return { r, cm };
  };
  const d0 = due();
  T('honest (his host-left result with the stayer\'s peers-gone): due, marked with both of them and the match start',
    d0.r.due.length === 1 && d0.r.skip === 0 && d0.cm[0].qlLate && d0.cm[0].qlLate.o === B && d0.cm[0].qlLate.w === A && d0.cm[0].qlLate.t === 5
    && d0.cm[0].qlLate.k === v.pid(B) + '|' + KEY, J(d0.cm[0].qlLate));
  T('his reconnect-failed result: due', due({ g: [res(A, 0, PEERS_GONE), res(B, 1, RECONNECT_FAILED)] }).r.due.length === 1);
  {
    // the host (A, seat 0) quit and came back, the joiner (B, seat 1) stayed: the lane stamped A's entry
    const cm = [{ m: KEY, g: [res(A, 0, RECONNECT_FAILED), res(B, 1, HOST_LEFT)] }];
    const r = v.quitLoneLateDue({ [v.pid(A) + '|' + KEY]: stamp({ ql: { w: v.pid(B), s: 0, t: 5 } }) }, cm, new Set([KEY]));
    T('the joiner stayed (his host-left at seat 1), the host quit (his result at seat 0): due', r.due.length === 1 && cm[0].qlLate && cm[0].qlLate.o === A && cm[0].qlLate.w === B, J(r));
  }
  T('no stamp (a key the lane did not settle -- the normal settle paid it): nothing', due({ st: stamp({ ql: undefined }) }).r.due.length === 0 && due({ st: stamp({ ql: undefined }) }).r.skip === 0);
  T('paid already (qlPaid): nothing', due({ st: stamp({ qlPaid: 1 }) }).r.due.length === 0);
  T('his leave not forgiven (no result of his in a consistent group yet): nothing', due({ st: stamp({ refunded: undefined }) }).r.due.length === 0);
  T('a conviction entry (cv) / a synthetic one (nf): nothing', due({ st: stamp({ cv: 1 }) }).r.due.length === 0 && due({ st: stamp({ nf: 1 }) }).r.due.length === 0);
  T('the key not processed (the normal settle takes it): nothing', due({ processed: new Set() }).r.due.length === 0);
  T('no consistent group for the key this run: nothing', due({ cm: [] }).r.due.length === 0);
  T('the quit-lone verdict entry of the key itself is not taken', due({ cm: [{ m: KEY, g: [res(A, 0, PEERS_GONE)], quitLone: { w: A } }] }).r.due.length === 0);
  const skip = (o, label) => { const d = due(o); T(label + ': not paid, logged as such', d.r.due.length === 0 && d.r.skip === 1 && !d.cm[0].qlLate, J(d.r)); };
  skip({ g: [res(A, 0, PEERS_GONE), res(B, 1, USER_QUIT)] }, 'a quit end of his in the group');
  skip({ g: [res(A, 0, PEERS_GONE), res(B, 1, HOST_LEFT), res(X, 1, HOST_LEFT)] }, 'another writer');
  skip({ g: [res(A, 1, PEERS_GONE), res(B, 0, HOST_LEFT)] }, 'the seats swapped');
  skip({ key: KEY2, g: [res(A, 0, PEERS_GONE, { mt: 2 }), res(B, 1, HOST_LEFT, { mt: 2 })] }, 'ranked');
  skip({ g: [res(B, 1, HOST_LEFT)] }, 'his record alone');
  // two records of his on the key: the normal settle drops a writer who wrote it twice (sanitySplit, 'dup-writer') and pays him
  //   nothing either
  skip({ g: [res(A, 0, PEERS_GONE), res(B, 1, HOST_LEFT), res(B, 1, RECONNECT_FAILED)] }, 'two records of his (host-left and reconnect-failed)');
  skip({ g: [res(A, 0, PEERS_GONE, { sc: [5000000, 300] }), res(B, 1, HOST_LEFT, { sc: [5000000, 300] })] }, 'a sanity flag on the group');
}

// ---- end to end harness ----
const PROGRESS = 5, RATING = 6, POINTS = 7, CPB = 8;
const boardsOf = (recs, prog, cpw) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
  { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: [] },
  { id: CPB, name: 'cp_bank', entries: Object.keys(cpw).map((s) => ({ steamID: s, score: cpw[s].score, details: cpw[s].details || [] })) }]);
// steps: [[ms since the previous run, records, env, state files to set]]; every progress / cp write lands
function run(steps) {
  const prog = {}, cpw = {};
  const rs = [];
  let state = null;
  for (const [ms, recs, env, files] of steps) {
    const st = state ? H.advance(state, ms) : null;
    const r = H.runCron(boardsOf(recs, prog, cpw), files ? Object.assign(st || {}, files) : st, env || null, null, 'w113');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, PROGRESS)) prog[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    for (const p of H.setPosts(r, CPB)) cpw[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, prog, cpw, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
const xpAfter = (m, i, sid) => { let x = 0; for (let k = 0; k <= i && k < m.rs.length; k++) for (const p of H.postsOf(m.rs[k], PROGRESS, sid)) x = p.score; return x; };
const xpPosts = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, PROGRESS, sid)));
const cpPosts = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, CPB, sid)));
const last = (m) => m.rs[m.rs.length - 1].state;
const leavesOf = (m, sid) => (((last(m).LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const xpLines = (m, sid) => m.out.split('\n').filter((l) => l.indexOf('  xp ' + v.pid(sid).slice(0, 8) + ' ') === 0);
const sigOf = (m, sid) => ((last(m).SIGNALS_FILE || {}).players || {})[v.pid(sid)] || null;
const pairOf = (m, a, b) => ((last(m).SIGNALS_FILE || {}).pairs || {})[v.pairKey(v.pid(a), v.pid(b))] || null;
const confOf = (m, sid, key) => (last(m).CONFESSIONS_FILE || {})[v.pid(sid) + '|' + key] || null;
const lateLines = (m) => m.out.split('\n').filter((l) => /quit-lone late/.test(l)).join(' | ');
// a quick 1V1 (mt 1): seat 0 leads 500 to 300; the stayer (seat 0) wrote peers-gone; the quitter (seat 1) confessed; o.late =
//   his own result's end (written later); o.prog = levels; o.lateSc = other scores on his result
function quick(hash, ros, o) {
  const x = o || {};
  const sc = x.sc || [500, 300], prog = x.prog;
  const rk = (seat) => 1 + sc.filter((y) => y > sc[seat]).length;
  const S = [0, 1].map((seat) => ({ sid: ros[seat], d: rec(0xB2, 1, hash, seat, 0, false, ros) }));
  const R = [{ sid: ros[0], d: rec(0xB1, 1, hash, 0, rk(0), rk(0) === 1, ros, sc, PEERS_GONE, prog) }];
  const C = [{ sid: ros[1], d: rec(0xB5, 1, hash, 1, 0, false, ros, null, USER_QUIT) }];
  const lsc = x.lateSc || sc;
  const L = [{ sid: ros[1], d: rec(0xB1, 1, hash, 1, 1 + lsc.filter((y) => y > lsc[1]).length, false, ros, lsc, x.late == null ? HOST_LEFT : x.late, prog) }];
  return { base: S.concat(R, C), full: S.concat(R, C, L), key: hash + '_1234_1' };
}
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation, the 5-minute absence grace and the 6-level floor
const FULL_WIN = 100 + 80 + 10 + 150;   // base + rank 1 + 500 / 50 + the daily first win
const QUIT_WIN = 100 + 80 + 10;         // the stayer on the quit-lone lane (W103): never the daily first win
const SHARE = 100;                      // the quitter's interrupted end: the base only

// ---- [2] ----
console.log('[2] end to end: his late result after the lane');
// the normal settle of the same records (his result there before the lane can take the key): the numbers to match
let parityCp = null;
{
  const P0 = H.SID(9811), P1 = H.SID(9812);
  const m = quick(0x10411, [P0, P1]);
  const t = run([[0, m.base], [STEP, m.full], [STEP, m.full], [2 * HOUR, m.full]]);
  T('(p) his result before the lane: runs ok', t.okAll, t.out.slice(-1500));
  T('(p) his result before the lane: the normal settle as today (' + FULL_WIN + ' / ' + SHARE + '), no quit-lone line',
    xpAfter(t, 3, P0) === FULL_WIN && xpAfter(t, 3, P1) === SHARE && !/quit-lone/.test(t.out), xpAfter(t, 3, P0) + ' / ' + xpAfter(t, 3, P1));
  parityCp = cpPosts(t, P1).length ? cpPosts(t, P1)[cpPosts(t, P1).length - 1].score : null;
  T('(p) his CP on the normal settle (the share below must match it)', parityCp != null && parityCp > 0, J(cpPosts(t, P1)));
}
for (const [label, late, at] of [['host-left', HOST_LEFT, 4], ['reconnect-failed', RECONNECT_FAILED, 5]]) {
  const P0 = H.SID(9820 + at), P1 = H.SID(9830 + at);
  const m = quick(0x10420 + at, [P0, P1], { late });
  const steps = [[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base]].map((s, i) => (i >= at ? [s[0], m.full] : s));
  steps.push([2 * HOUR, m.full], [24 * HOUR, m.full]);
  const t = run(steps);
  const tag = '(' + label + ', from run ' + (at + 1) + ') ';
  T(tag + 'runs ok', t.okAll, t.out.slice(-1500));
  T(tag + 'the lane settled the key for the stayer first (run 3), nothing for him then', xpAfter(t, 2, P0) === QUIT_WIN && xpAfter(t, at - 1, P1) === 0, xpAfter(t, 2, P0) + ' / ' + xpAfter(t, at - 1, P1));
  T(tag + 'the lane stamped his confession entry (the stayer, his seat, the start)', (() => {
    const c = t.rs[2].state.CONFESSIONS_FILE[v.pid(P1) + '|' + m.key], s1 = (t.rs[1].state.STARTS_FILE || {})[m.key];
    return !!(c && c.ql && c.ql.w === v.pid(P0) && c.ql.s === 1 && s1 && c.ql.t === s1.t0 - STEP && !c.qlPaid && !(t.rs[3].state.STARTS_FILE || {})[m.key]);   // the run after drops the start (the share sorts by the stamp)
  })(), J([t.rs[2].state.CONFESSIONS_FILE, (t.rs[1].state.STARTS_FILE || {})[m.key]]));
  T(tag + 'his share when his result lands: ' + SHARE + ', once only', xpAfter(t, at, P1) === SHARE && xpPosts(t, P1).length === 1 && xpAfter(t, at + 2, P1) === SHARE, J(xpPosts(t, P1).map((p) => p.score)));
  T(tag + 'an interrupted end: a career game, no win or loss, no daily first win, his streak frozen',
    xpLines(t, P1).length === 1 && /innocent rank2 x1 \+100 -> 100 career 1g\/0w\/0l streak f/.test(xpLines(t, P1)[0]) && !/dailyWin/.test(xpLines(t, P1)[0]), xpLines(t, P1).join(' | '));
  T(tag + 'his CP: the normal settle\'s, once', cpPosts(t, P1).length === 1 && cpPosts(t, P1)[0].score === parityCp, J(cpPosts(t, P1)) + ' vs ' + parityCp);
  T(tag + 'his leave forgiven (as before)', leavesOf(t, P1) === 0 && /confess-forgive /.test(t.rs[at].out), String(leavesOf(t, P1)));
  T(tag + 'the stayer as the lane paid him (' + QUIT_WIN + ', one write)', xpPosts(t, P0).length === 1 && xpAfter(t, at + 2, P0) === QUIT_WIN && cpPosts(t, P0).length === 1, J(xpPosts(t, P0).map((p) => p.score)));
  T(tag + 'logged, the entry marked paid', /quit-lone late settle /.test(t.rs[at].out) && confOf(t, P1, m.key) && confOf(t, P1, m.key).qlPaid === 1, lateLines(t));
  T(tag + 'summary row: 1 due, 0 not paid, 1 paid', /\| those keys whose quitter's own result came in after the settle, his leave forgiven \(W113\)[^|]*\| 1 \/ 0 \(1\) \|/.test(t.rs[at].summary),
    (/those keys whose quitter[^\n]*/.exec(t.rs[at].summary) || [''])[0]);
  T(tag + 'the signals of both records (one game each, the stayer the winner, the pair once)',
    sigOf(t, P0) && sigOf(t, P0).g === 1 && sigOf(t, P0).w === 1 && sigOf(t, P1) && sigOf(t, P1).g === 1 && sigOf(t, P1).w === 0 && pairOf(t, P0, P1) && pairOf(t, P0, P1).n === 1,
    J([sigOf(t, P0), sigOf(t, P1), pairOf(t, P0, P1)]));
  T(tag + 'nobody rated (no rating or points write)', [].concat(...t.rs.map((r) => H.setPosts(r, RATING).concat(H.setPosts(r, POINTS)))).length === 0);
}

{
  // the joiner stayed: the host (seat 0, leading 500 to 300) pressed Esc, came back and dropped (his reconnect-failed, late);
  //   the joiner (seat 1) wrote host-left. Two void votes: the normal settle of these records is a VOID (both innocent, the
  //   void counters); the lane paid the joiner (rank 1 of the one writer, W103), his share is the base and the void counters
  const P0 = H.SID(9921), P1 = H.SID(9922), ros = [P0, P1], hash = 0x10521, sc = [500, 300];
  const S = [0, 1].map((seat) => ({ sid: ros[seat], d: rec(0xB2, 1, hash, seat, 0, false, ros) }));
  const R = [{ sid: P1, d: rec(0xB1, 1, hash, 1, 2, false, ros, sc, HOST_LEFT) }];
  const C = [{ sid: P0, d: rec(0xB5, 1, hash, 0, 0, false, ros, null, USER_QUIT) }];
  const L = [{ sid: P0, d: rec(0xB1, 1, hash, 0, 1, false, ros, sc, RECONNECT_FAILED) }];
  const base = S.concat(R, C), full = base.concat(L), key = hash + '_1234_1';
  const t = run([[0, base], [STEP, base], [STEP, base], [STEP, base], [STEP, full], [STEP, full], [2 * HOUR, full]]);
  T('(the joiner stayed) runs ok', t.okAll, t.out.slice(-1500));
  T('(the joiner stayed) the lane paid the joiner first (186, behind), stamped the host\'s entry at seat 0',
    xpAfter(t, 2, P1) === 100 + 80 + 6 && (() => { const c = t.rs[2].state.CONFESSIONS_FILE[v.pid(P0) + '|' + key]; return !!(c && c.ql && c.ql.w === v.pid(P1) && c.ql.s === 0); })(),
    xpAfter(t, 2, P1) + ' ' + J(t.rs[2].state.CONFESSIONS_FILE));
  T('(the joiner stayed) the host\'s share: ' + SHARE + ', once; the joiner as the lane paid him', xpAfter(t, 6, P0) === SHARE && xpPosts(t, P0).length === 1 && xpPosts(t, P1).length === 1
    && confOf(t, P0, key).qlPaid === 1 && leavesOf(t, P0) === 0, J([xpPosts(t, P0), xpPosts(t, P1)]) + ' ' + lateLines(t));
  T('(the joiner stayed) the signals of a void consensus (a void each, no game or win, the pair once)',
    sigOf(t, P0) && sigOf(t, P0).v === 1 && sigOf(t, P0).g === 0 && sigOf(t, P1) && sigOf(t, P1).v === 1 && sigOf(t, P1).g === 0 && sigOf(t, P1).w === 0
    && pairOf(t, P0, P1) && pairOf(t, P0, P1).n === 1 && pairOf(t, P0, P1).x === 0, J([sigOf(t, P0), sigOf(t, P1), pairOf(t, P0, P1)]));
}

// ---- [3] ----
console.log('[3] end to end: the edges');
{
  // a finished result of his (he says he played to the end), leading or behind: an interrupted end -- no second winner
  for (const [sc, lbl] of [[[500, 300], 'behind'], [[300, 500], 'ahead']]) {
    const P0 = H.SID(sc[0] === 500 ? 9841 : 9843), P1 = H.SID(sc[0] === 500 ? 9842 : 9844);
    const m = quick(sc[0] === 500 ? 0x10441 : 0x10443, [P0, P1], { late: FINISHED, sc });
    const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.full], [STEP, m.full], [2 * HOUR, m.full]]);
    T('finished result of his, ' + lbl + ': runs ok', t.okAll, t.out.slice(-1500));
    T('finished result of his, ' + lbl + ': ' + SHARE + ' as an interrupted end (no win, no daily first win, no win or loss on his career), once',
      xpAfter(t, 6, P1) === SHARE && xpPosts(t, P1).length === 1 && xpLines(t, P1).some((l) => /innocent rank\d x1 \+100 -> 100 career 1g\/0w\/0l/.test(l) && !/dailyWin/.test(l)), xpLines(t, P1).join(' | '));
    T('finished result of his, ' + lbl + ': the stayer\'s lane win stands, one career win between the two',
      xpAfter(t, 6, P0) === (sc[0] === 500 ? QUIT_WIN : 100 + 80 + 6) && xpLines(t, P0).some((l) => /career 1g\/1w\/0l/.test(l)) && !xpLines(t, P1).some((l) => /career \d+g\/[1-9]/.test(l)), xpLines(t, P0).concat(xpLines(t, P1)).join(' | '));
  }
}
{
  // his result after the confession window closed (a run 2 h after his confession was first read, without his result, closes
  //   it): his leave stands, nothing paid (as before)
  const P0 = H.SID(9851), P1 = H.SID(9852);
  const m = quick(0x10451, [P0, P1]);
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [2 * HOUR, m.base], [STEP, m.full], [24 * HOUR, m.full]]);
  T('after the confession window: runs ok', t.okAll, t.out.slice(-1500));
  T('after the confession window: nothing for him, his leave stands, no late line', xpPosts(t, P1).length === 0 && leavesOf(t, P1) === 1 && !/quit-lone late/.test(t.out), J([xpPosts(t, P1), leavesOf(t, P1)]) + ' ' + lateLines(t));
}
{
  // his result with other scores (not consistent with the stayer's): nothing forgiven, nothing paid (as before)
  const P0 = H.SID(9861), P1 = H.SID(9862);
  const m = quick(0x10461, [P0, P1], { lateSc: [400, 300] });
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.full], [STEP, m.full], [2 * HOUR, m.full]]);
  T('other scores: runs ok', t.okAll, t.out.slice(-1500));
  T('other scores: nothing for him, his leave stands, no late line', xpPosts(t, P1).length === 0 && leavesOf(t, P1) === 1 && !/quit-lone late/.test(t.out), J([xpPosts(t, P1), leavesOf(t, P1)]) + ' ' + lateLines(t));
  T('other scores: the stayer as the lane paid him', xpAfter(t, 5, P0) === QUIT_WIN && xpPosts(t, P0).length === 1, J(xpPosts(t, P0).map((p) => p.score)));
}
{
  // one level played: the progress discount the normal settle applies (100 x 1/6 = 17); the W103 floor is the stayer's only
  const P0 = H.SID(9871), P1 = H.SID(9872);
  const m = quick(0x10471, [P0, P1], { prog: 1 });
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.full], [STEP, m.full]]);
  T('one level: runs ok', t.okAll, t.out.slice(-1500));
  T('one level: his share 17 (the normal settle\'s), once; the stayer\'s 50 floor', xpAfter(t, 5, P1) === 17 && xpPosts(t, P1).length === 1 && xpAfter(t, 5, P0) === 50,
    xpAfter(t, 5, P0) + ' / ' + J(xpPosts(t, P1).map((p) => p.score)));
}
{
  // his own newer match (with someone else; he came back, dropped, and started it before the lane settled the first one) settles
  //   in the same run as his late share: the older match goes first (by its start, not by the lane's settle), both paid
  const P0 = H.SID(9881), P1 = H.SID(9882), Q1 = H.SID(9883);
  const m = quick(0x10481, [P0, P1]);
  const nS = [0, 1].map((seat) => ({ sid: [P1, Q1][seat], d: rec(0xB2, 1, 0x10482, seat, 0, false, [P1, Q1]) }));
  const nR = [0, 1].map((seat) => ({ sid: [P1, Q1][seat], d: rec(0xB1, 1, 0x10482, seat, seat + 1, seat === 0, [P1, Q1], [500, 300], FINISHED) }));
  const a1 = m.base.concat(nS), a4 = m.full.concat(nS, nR);
  const t = run([[0, m.base], [STEP, a1], [STEP, a1], [STEP, a1], [STEP, a4], [STEP, a4]]);
  const o4 = t.rs[4].out, iLate = o4.indexOf('quit-lone late settle '), iNew = o4.search(/\n  xp [0-9a-f]+ valid rank1/);
  T('his newer match in the same run: runs ok', t.okAll, t.out.slice(-1500));
  T('his newer match in the same run: both settle there, his share first (' + SHARE + ' + ' + FULL_WIN + ')',
    xpAfter(t, 4, P1) === SHARE + FULL_WIN && xpPosts(t, P1).length === 1 && iLate >= 0 && iNew > iLate && !/writer-pacing/.test(o4),
    J(xpPosts(t, P1).map((p) => p.score)) + ' ' + iLate + '/' + iNew + ' ' + o4.split('\n').filter((l) => /writer-pacing|quit-lone late|xp /.test(l)).join(' | '));
}
{
  // one match at a time: his newer match settled a minute ago, his late share waits for its slot, then is paid once
  const P0 = H.SID(9891), P1 = H.SID(9892), Q1 = H.SID(9893);
  const m = quick(0x10491, [P0, P1]);
  const nS = [0, 1].map((seat) => ({ sid: [P1, Q1][seat], d: rec(0xB2, 1, 0x10492, seat, 0, false, [P1, Q1]) }));
  const nR = [0, 1].map((seat) => ({ sid: [P1, Q1][seat], d: rec(0xB1, 1, 0x10492, seat, seat + 1, seat === 0, [P1, Q1], [500, 300], FINISHED) }));
  const a4 = m.base.concat(nS), a5 = a4.concat(nR), a6 = m.full.concat(nS, nR);
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, a4], [STEP, a5], [MIN, a6], [STEP, a6], [STEP, a6]]);
  T('one match at a time: runs ok', t.okAll, t.out.slice(-1500));
  T('one match at a time: his share waits a run (writer pacing), nothing paid then', xpAfter(t, 6, P1) === FULL_WIN && /writer-pacing /.test(t.rs[6].out) && !/quit-lone late settle/.test(t.rs[6].out),
    xpAfter(t, 6, P1) + ' ' + t.rs[6].out.split('\n').filter((l) => /writer-pacing|quit-lone late/.test(l)).join(' | '));
  T('one match at a time: paid the next run, once', xpAfter(t, 8, P1) === FULL_WIN + SHARE && (t.out.match(/quit-lone late settle /g) || []).length === 1, J(xpPosts(t, P1).map((p) => p.score)));
}

{
  // a seedcap veto on the key (the auditor proved the score vector over the cap after the lane settled it): his share is held
  //   while it stands (the normal settle holds a vetoed key), paid once it is lifted
  const P0 = H.SID(9901), P1 = H.SID(9902);
  const m = quick(0x10501, [P0, P1]);
  const ENF = { SEEDCAP_ENFORCE: '1' };
  const veto = { SC_STATE_FILE: { veto: { [m.key]: { t: 0, seats: [0] } }, suspects: {}, audited: {} } };
  const lift = { SC_STATE_FILE: { veto: {}, suspects: {}, audited: {} } };
  const t = run([[0, m.base, ENF], [STEP, m.base, ENF], [STEP, m.base, ENF], [STEP, m.base, ENF], [STEP, m.full, ENF, veto], [STEP, m.full, ENF, veto], [STEP, m.full, ENF, lift]]);
  T('seedcap veto: runs ok', t.okAll, t.out.slice(-1500));
  T('seedcap veto: his share held while it stands (logged), paid once after it is lifted', xpAfter(t, 5, P1) === 0 && /quit-lone late [^\n]*seedcap over-cap veto -- held/.test(t.rs[4].out)
    && xpAfter(t, 6, P1) === SHARE && xpPosts(t, P1).length === 1 && confOf(t, P1, m.key).qlPaid === 1, J(xpPosts(t, P1).map((p) => p.score)) + ' ' + lateLines(t));
}
{
  // his seedcap reject window open when his share settles: his XP stays, the rest of his share (CP) is discarded, the entry paid
  //   (as the normal settle treats a writer inside his window)
  const P0 = H.SID(9911), P1 = H.SID(9912);
  const m = quick(0x10511, [P0, P1]);
  const REJ = { SEEDCAP_REJECT: '1' };
  const nowMin = Math.floor(Date.now() / 60000);
  const sus = { SC_STATE_FILE: { veto: {}, suspects: { [v.pid(P1)]: { n: 1, t0: nowMin, t1: nowMin } }, audited: {} } };
  const t = run([[0, m.base, REJ], [STEP, m.base, REJ], [STEP, m.base, REJ], [STEP, m.base, REJ], [STEP, m.full, REJ, sus], [STEP, m.full, REJ, sus]]);
  T('his reject window: runs ok', t.okAll, t.out.slice(-1500));
  T('his reject window: his XP ' + SHARE + ' stays, no CP of his, once, the entry paid', xpAfter(t, 5, P1) === SHARE && xpPosts(t, P1).length === 1 && cpPosts(t, P1).length === 0
    && /inside reject window -- own settlement discarded except XP \(W113\)/.test(t.rs[4].out) && confOf(t, P1, m.key).qlPaid === 1, J([xpPosts(t, P1), cpPosts(t, P1)]) + ' ' + lateLines(t));
}

console.log(failN ? '\nquit-lone-late: ' + failN + ' FAILED' : '\nquit-lone-late: all ok');
process.exit(failN ? 1 : 0);
