'use strict';
// W103 / O507 (client knife 5.6b section 9): a quick 1V1 whose other player pressed Esc mid-match -- his game wrote its own
// abandon confession (0xB5, user-quit) -- and whose stayer got the end on his screen and wrote his result (peers-gone as
// the host, host-left as the joiner). One writer: the key never settled, the start-orphan verdict paid the stayer the flat
// CONSOLATION_XP (50) two hours later. quitLoneVerdicts now settles it for him as a matchmade win.
//   [0] the constants and exports
//   [1] units (quitLoneClaim): the honest shapes claim (peers-gone at seat 0, host-left at seat 1, two copies of his); every
//       condition that is not met claims nothing (a finished or other end, provisional / split / synthetic / lent roster, a
//       contest note, a processed or split key, ranked, a party queue, a room, three seats, a bot seat, the quitter without
//       his own start / with a result / without a confession, a confession refunded / convicted / synthetic / already
//       settled, the writer's own confession, no level or a level out of range, a sanity-flagged result, another table, two
//       writers, the wrong seat, two copies that disagree)
//   [2] units (quitLoneVerdicts): the per-level floor, an incomplete read, a consistent key, past maturity, the host-left copy
//   [3] end to end, the three fixtures of the brief: (a) confession + one-sided result -- the host's peers-gone and the
//       joiner's host-left: a win's XP (190: never the daily first win, it stays for his next win -- a normal win later
//       that day carries it, 340), a career win, CP, once only, no consolation, the quitter's one leave;
//       (b) confession + nobody wrote: as before; (c) no confession, one side: as before (50 at maturity, the silent seat
//       convicted by the start-orphan verdict)
//   [4] end to end, the edges: an early quit (2 levels: 63, the daily first win kept for the next win the same day;
//       1 level: the 50 floor); a finished result + the quitter's late result (he came back: the normal settle, his leave
//       forgiven -- as before); an incomplete read at the due time (held, then paid once); a ranked 1V1 (untouched)
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
const PEERS_GONE = 1, HOST_LEFT = 2, USER_QUIT = 5;

// ---- [0] ----
console.log('[0] constants and exports');
T('QUIT_LONE = quick (1), two seats, a 60-second level', v.QUIT_LONE && v.QUIT_LONE.MT === 1 && v.QUIT_LONE.PC === 2 && v.QUIT_LONE.LEVEL_SECONDS === 60, J(v.QUIT_LONE));
T('exported: quitLoneClaim / quitLoneVerdicts', typeof v.quitLoneClaim === 'function' && typeof v.quitLoneVerdicts === 'function');
T('the floor it replaces is CONSOLATION_XP 50', v.CONSOLATION_XP === 50);

// ---- [1] units ----
console.log('[1] quitLoneClaim');
const A = H.SID(9701), B = H.SID(9702), X = H.SID(9703), Z = H.SID(9704);
const KEY = (0x10301 | 0) + '_1234_1';
const vecOf = (r) => J(r.d.slice(10, 10 + (r.d[8] | 0)));
// A (seat 0) stayed and wrote his result, B (seat 1) started, quit and confessed
const res = (sid, seat, ros, disp, o) => {
  const x = o || {};
  const d = rec(0xB1, x.mt || 1, 0x10301, seat, 1, true, ros, x.sc || [500, 300], disp == null ? PEERS_GONE : disp, x.prog);
  return { steamID: sid, shard: 's0', d, dispCode: d[10 + ros.length] | 0, disp: v.dispName(d[10 + ros.length] | 0), roster: v.decodeRoster(d) };
};
const entry = (o) => Object.assign({ t0: 1, mt: 1, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [v.pid(A)], started: [v.pid(A), v.pid(B)] }, o || {});
const g = [res(A, 0, [A, B])];
const quitB = () => new Set([v.pid(B) + '|' + KEY]);
const claim = (p, gg, o) => {
  const x = o || {};
  return v.quitLoneClaim(p, KEY, gg || g, x.pending || {}, x.processed || new Set(), x.confState || {}, x.confSeen || quitB(), x.quitSeen === undefined ? quitB() : x.quitSeen, vecOf);
};
{
  const c0 = claim(entry());
  T('honest (the host stayed, peers-gone): claims for him at his seat, the quitter named', !!c0 && c0.w === A && c0.o === B && c0.seat === 0 && c0.m === KEY && c0.prog === 6, J(c0));
  const gj = [res(B, 1, [A, B], HOST_LEFT)];
  const pj = entry({ settled: [v.pid(B)] });
  const qa = new Set([v.pid(A) + '|' + KEY]);
  const cj = v.quitLoneClaim(pj, KEY, gj, {}, new Set(), {}, qa, qa, vecOf);
  T('honest (the joiner stayed, host-left): claims for him', !!cj && cj.w === B && cj.o === A && cj.seat === 1, J(cj));
  T('two copies of his (peers-gone and host-left, the same scores): claims', !!claim(entry(), [res(A, 0, [A, B]), res(A, 0, [A, B], HOST_LEFT)]));
  T('his result says finished: nothing (the other player was there at the end, his own result will come)', claim(entry(), [res(A, 0, [A, B], 0)]) === null);
  T('his result says finished-nosummary (Q68): nothing', claim(entry(), [res(A, 0, [A, B], 10)]) === null);
  T('his result says user-quit: nothing', claim(entry(), [res(A, 0, [A, B], USER_QUIT)]) === null);
  T('his result says level-begin-timeout: nothing', claim(entry(), [res(A, 0, [A, B], 3)]) === null);
  T('roster still provisional: nothing', claim(entry({ prov: 'abc' })) === null);
  T('roster split: nothing', claim(entry({ split: 1 })) === null);
  T('synthetic entry (no start roster): nothing', claim(entry({ synth: true, roster: {} })) === null);
  T('entry lent its t0 to a table split: nothing', claim(entry({ lent: 5 })) === null);
  T('contest note on the key: nothing', claim(entry(), null, { pending: { ['~' + KEY]: { t0: 1, c: 1 } } }) === null);
  T('key split before (its mark processed): nothing', claim(entry(), null, { processed: new Set([v.splitMark(KEY)]) }) === null);
  T('key processed: nothing', claim(entry(), null, { processed: new Set([KEY]) }) === null);
  T('ranked (2): nothing (the Q184 lane and the start-orphan verdict, as before)', claim(entry({ mt: 2 }), [res(A, 0, [A, B], PEERS_GONE, { mt: 2 })]) === null);
  T('a party queue (party bits on the type): nothing', claim(entry({ mt: 0x31 }), [res(A, 0, [A, B], PEERS_GONE, { mt: 0x31 })]) === null);
  T('a friends\' room (10): nothing', claim(entry({ mt: 10 }), [res(A, 0, [A, B], PEERS_GONE, { mt: 10 })]) === null);
  {
    const g3 = [res(A, 0, [A, B, X], PEERS_GONE, { sc: [500, 300, 100] })];
    T('three seats: nothing', claim(entry({ roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(X) }, started: [v.pid(A), v.pid(B), v.pid(X)] }), g3) === null);
  }
  {
    const gb = [res(A, 0, [A, '0'], PEERS_GONE, { sc: [500, 100] })];
    T('one human and a bot (the roster has his seat only): nothing', claim(entry({ roster: { 0: v.pid(A) }, started: [v.pid(A)] }), gb) === null);
  }
  T('the quitter never wrote his own start: nothing', claim(entry({ started: [v.pid(A)] })) === null);
  T('the quitter wrote a result once (p.settled): nothing', claim(entry({ settled: [v.pid(A), v.pid(B)] })) === null);
  T('no confession of his: nothing (a crash or a pulled cable, as before)', claim(entry(), null, { quitSeen: new Set(), confSeen: new Set() }) === null);
  T('his confession from an earlier run (state, a leave counted): claims', !!claim(entry(), null, { quitSeen: new Set(), confSeen: new Set(), confState: { [v.pid(B) + '|' + KEY]: { t0: 1, mt: 1, ded: 0, ex: 1 } } }));
  T('his confession refunded (he came back and finished): nothing', claim(entry(), null, { quitSeen: new Set(), confSeen: new Set(), confState: { [v.pid(B) + '|' + KEY]: { t0: 1, mt: 1, ded: 0, ex: 0, refunded: 1 } } }) === null);
  T('a conviction\'s entry (not his own word): nothing', claim(entry(), null, { quitSeen: new Set(), confSeen: new Set(), confState: { [v.pid(B) + '|' + KEY]: { t0: 1, cv: 1, ex: 1 } } }) === null);
  T('a synthetic (team-gamble) entry: nothing', claim(entry(), null, { quitSeen: new Set(), confSeen: new Set(), confState: { [v.pid(B) + '|' + KEY]: { t0: 1, nf: 1, ex: 1 } } }) === null);
  T('an entry marked settled at first sight (done, no leave counted): nothing', claim(entry(), null, { quitSeen: new Set(), confSeen: new Set(), confState: { [v.pid(B) + '|' + KEY]: { t0: 1, mt: 1, done: 1 } } }) === null);
  T('the writer confessed too (read this run): nothing', claim(entry(), null, { confSeen: new Set([v.pid(A) + '|' + KEY, v.pid(B) + '|' + KEY]) }) === null);
  T('the writer confessed too (state): nothing', claim(entry(), null, { confState: { [v.pid(A) + '|' + KEY]: { t0: 1, ex: 1 } } }) === null);
  T('no level reported (progress 0 would read as a full match): nothing', claim(entry(), [res(A, 0, [A, B], PEERS_GONE, { prog: 0 })]) === null);
  T('a level count past the match (7): nothing', claim(entry(), [res(A, 0, [A, B], PEERS_GONE, { prog: 7 })]) === null);
  {
    const ins = res(A, 0, [A, B], PEERS_GONE, { sc: [5000000, 300] });
    T('his result fails the sanity screen: nothing', v.sanityFlags([ins]).length > 0 && claim(entry(), [ins]) === null, J(v.sanityFlags([ins])));
  }
  T('his result names another table (an alt at the quitter\'s seat): nothing', claim(entry(), [res(A, 0, [A, X])]) === null);
  T('two writers: nothing (the normal settle owns it)', claim(entry(), [res(A, 0, [A, B]), res(B, 1, [A, B])]) === null);
  T('written from a seat the roster gives somebody else: nothing', claim(entry(), [res(A, 1, [B, A])]) === null);
  T('his two copies disagree on the scores: nothing', claim(entry(), [res(A, 0, [A, B]), res(A, 0, [A, B], PEERS_GONE, { sc: [500, 301] })]) === null);
  T('the quitter is the writer (the roster names one account twice): nothing', claim(entry({ roster: { 0: v.pid(A), 1: v.pid(A) } }), [res(A, 0, [A, A])]) === null);
  T('an outside account at no seat confessed: nothing', claim(entry(), null, { quitSeen: new Set([v.pid(Z) + '|' + KEY]), confSeen: new Set([v.pid(Z) + '|' + KEY]) }) === null);
}

// ---- [2] the verdict pass ----
console.log('[2] quitLoneVerdicts');
{
  const MAT = v.STARTS_MATURITY_MS;
  const run = (now, o) => {
    const x = o || {};
    const pend = { [KEY]: entry(x.p) };
    return v.quitLoneVerdicts(pend, { [KEY]: x.g || g }, new Set(), x.ck || new Set(), now, MAT, {}, quitB(), quitB(), x.complete === undefined ? true : x.complete, vecOf);
  };
  const r1 = run(1 + 5 * MIN - 1);
  T('under five minutes: waiting', r1.waiting === 1 && !r1.due.length, J(r1));
  const r2 = run(1 + 6 * MIN - 1);
  T('six levels need six minutes: still waiting at 5:59', r2.waiting === 1 && !r2.due.length, J(r2));
  const r3 = run(1 + 6 * MIN);
  T('six levels, six minutes: due, marked quitLone, not void', r3.due.length === 1 && r3.due[0].m === KEY && r3.due[0].void === false && r3.due[0].quitLone && r3.due[0].quitLone.w === A && r3.due[0].quitLone.prog === 6, J(r3.due));
  const r4 = run(1 + 5 * MIN, { g: [res(A, 0, [A, B], PEERS_GONE, { prog: 2 })] });
  T('two levels: due at the five-minute start-age floor', r4.due.length === 1, J(r4));
  const r5 = run(1 + 6 * MIN, { complete: false });
  T('due on an incomplete read: held', r5.held === 1 && !r5.due.length, J(r5));
  const r6 = run(1 + 6 * MIN, { ck: new Set([KEY]) });
  T('a consistent key: skipped', !r6.due.length && !r6.waiting && !r6.held);
  const r7 = run(1 + MAT);
  T('at the start maturity: left to the start-orphan verdict', !r7.due.length && !r7.waiting && !r7.held);
  const gh = [res(B, 1, [A, B], HOST_LEFT)];
  const pend = { [KEY]: entry({ settled: [v.pid(B)] }) };
  const qa = new Set([v.pid(A) + '|' + KEY]);
  const r8 = v.quitLoneVerdicts(pend, { [KEY]: gh }, new Set(), new Set(), 1 + 6 * MIN, MAT, {}, qa, qa, true, vecOf);
  T('a host-left copy is settled as peers-gone (not a VOID vote), the group read is left as read', r8.due.length === 1 && r8.due[0].g[0].dispCode === PEERS_GONE && r8.due[0].g[0].disp === 'peers-gone'
    && gh[0].dispCode === HOST_LEFT && !v.isVoidDisp(r8.due[0].g[0].dispCode), J(r8.due.map((x) => x.g.map((r) => r.disp))));
  const r9 = v.quitLoneVerdicts({ ['~' + KEY]: { t0: 1, c: 1 }, [KEY]: entry() }, { [KEY]: g }, new Set(), new Set(), 1 + 6 * MIN, MAT, {}, quitB(), quitB(), true, vecOf);
  T('a key with a contest note: skipped (its note entry is not a key either)', !r9.due.length && !r9.waiting, J(r9));
}

// ---- end to end harness ----
const PROGRESS = 5, RATING = 6, POINTS = 7, CPB = 8;
const boardsOf = (recs, prog, cpw) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
  { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: [] },
  { id: CPB, name: 'cp_bank', entries: Object.keys(cpw).map((s) => ({ steamID: s, score: cpw[s].score, details: cpw[s].details || [] })) }]);
// steps: [[ms since the previous run, records, env]]; every progress / cp write lands
function run(steps, script) {
  const prog = {}, cpw = {};
  const rs = [];
  let state = null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, prog, cpw), state ? H.advance(state, ms) : null, env || null, script || null, 'w103');
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
const leavesOf = (m, sid) => ((((m.rs[m.rs.length - 1].state.LEAVERS_FILE) || {})[v.pid(sid)]) || {}).leaves | 0;
const xpLines = (m, sid) => m.out.split('\n').filter((l) => l.indexOf('  xp ' + v.pid(sid).slice(0, 8) + ' ') === 0);
// a quick 1V1 (mt 1): seat 0 leads 500 to 300; o.res = { seat: disp }, o.conf = [seats that confessed], o.prog = levels
function quick(hash, ros, o) {
  const x = o || {};
  const sc = x.sc || [500, 300];
  const mt = x.mt || 1;
  const S = (x.starters || [0, 1]).map((seat) => ({ sid: ros[seat], d: rec(0xB2, mt, hash, seat, 0, false, ros) }));
  const R = Object.keys(x.res || {}).map((k) => { const seat = k | 0, rk = 1 + sc.filter((y) => y > sc[seat]).length; return { sid: ros[seat], d: rec(0xB1, mt, hash, seat, rk, rk === 1, ros, sc, x.res[k], x.prog) }; });
  const C = (x.conf || []).map((seat) => ({ sid: ros[seat], d: rec(0xB5, mt, hash, seat, 0, false, ros, null, USER_QUIT) }));
  return { S, R, C, key: hash + '_1234_' + mt };
}
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation, the 5-minute absence grace and the 6-level floor
const FULL_WIN = 100 + 80 + 10 + 150;   // base + rank 1 + 500 / 50 + the daily first win
const QUIT_WIN = 100 + 80 + 10;         // the same win on the quit-lone lane: never the daily first win
const FULL_LOSS = 100 + 45 + 6;         // base + rank 2 + 300 / 50

// ---- [3] ----
console.log('[3] end to end: the three fixtures');
{
  // (a1) the host (seat 0) stayed and wrote peers-gone, the joiner (seat 1) quit and confessed
  const P0 = H.SID(9711), P1 = H.SID(9712);
  const m = quick(0x10311, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1] });
  const all = m.S.concat(m.R, m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all], [24 * HOUR, all]]);
  T('(a1) host stayed: runs ok', t.okAll, t.out.slice(-1500));
  T('(a1) host stayed: a win\'s XP, ' + QUIT_WIN + ', once only (not the 50)', xpPosts(t, P0).length === 1 && xpAfter(t, 5, P0) === QUIT_WIN, J(xpPosts(t, P0).map((p) => p.score)));
  T('(a1) host stayed: a career win, no daily first win taken, the streak frozen (an interrupted end)', xpLines(t, P0).some((l) => /valid rank1 x1 .*career 1g\/1w\/0l streak f/.test(l) && !/dailyWin/.test(l)), xpLines(t, P0).join(' | '));
  T('(a1) host stayed: CP written for him', cpPosts(t, P0).length === 1 && cpPosts(t, P0)[0].score > 0, J(cpPosts(t, P0)));
  T('(a1) host stayed: settled on the quit-lone lane, logged', new RegExp('quit-lone settle ' + m.key + ': ').test(t.out), t.out.split('\n').filter((l) => /quit-lone/.test(l)).join(' | '));
  T('(a1) host stayed: no start-orphan verdict, no consolation (the key was processed)', !new RegExp('start-orphan ' + m.key).test(t.out) && !/consolation xp /.test(t.out));
  T('(a1) the quitter: no XP, no CP, one leave (his confession)', xpPosts(t, P1).length === 0 && cpPosts(t, P1).length === 0 && leavesOf(t, P1) === 1, J([xpPosts(t, P1), cpPosts(t, P1), leavesOf(t, P1)]));
  T('(a1) nobody rated (no rating or points write)', H.setPosts(t.rs[3], RATING).length === 0 && [].concat(...t.rs.map((r) => H.setPosts(r, POINTS))).length === 0);
  T('(a1) summary row: 1 due, 1 paid', t.rs.some((r) => /\| quick 1V1s whose other player quit and confessed, only the stayer wrote a result \(W103\)[^|]*\| 1 \/ 0 \/ 0 \(1\) \|/.test(r.summary)),
    t.rs.map((r) => (/quick 1V1s whose other player quit[^\n]*/.exec(r.summary) || [''])[0]).join(' || '));
}
{
  // (a2) the host (seat 0) quit and confessed, the joiner (seat 1) stayed: his client writes host-left (O41)
  const P0 = H.SID(9721), P1 = H.SID(9722);
  const m = quick(0x10321, [P0, P1], { res: { 1: HOST_LEFT }, conf: [0], sc: [300, 500] });
  const all = m.S.concat(m.R, m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all], [24 * HOUR, all]]);
  T('(a2) joiner stayed: runs ok', t.okAll, t.out.slice(-1500));
  T('(a2) joiner stayed (host-left): the same win, ' + QUIT_WIN + ', once', xpPosts(t, P1).length === 1 && xpAfter(t, 5, P1) === QUIT_WIN, J(xpPosts(t, P1).map((p) => p.score)));
  T('(a2) joiner stayed: not voided (a host-left end is no VOID vote here)', !new RegExp('VOID ' + m.key).test(t.out));
  T('(a2) the quitter: no XP, one leave', xpPosts(t, P0).length === 0 && leavesOf(t, P0) === 1, J([xpPosts(t, P0), leavesOf(t, P0)]));
}
{
  // (a3) the stayer was behind when the other quit (300 to 500): still the win -- the quitter forfeited
  const P0 = H.SID(9725), P1 = H.SID(9726);
  const m = quick(0x10325, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1], sc: [300, 500] });
  const all = m.S.concat(m.R, m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all]]);
  T('(a3) behind when the other quit: runs ok', t.okAll, t.out.slice(-1500));
  T('(a3) behind when the other quit: the win, his own money bonus (300 / 50)', xpAfter(t, 4, P0) === 100 + 80 + 6 && xpLines(t, P0).some((l) => /career 1g\/1w\/0l/.test(l)), J(xpPosts(t, P0).map((p) => p.score)));
}
{
  // (a4) the quit-lone win, then a normal win the same day: the daily first win comes with the second (190 + 340)
  const P0 = H.SID(9727), P1 = H.SID(9728), Q1 = H.SID(9729);
  const m = quick(0x10327, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1] });
  const n = quick(0x10328, [P0, Q1], { res: { 0: 0, 1: 0 } });
  const a1 = m.S.concat(m.R, m.C), a2 = a1.concat(n.S, n.R);
  const t = run([[0, a1], [STEP, a1], [STEP, a1], [STEP, a2], [STEP, a2], [STEP, a2], [STEP, a2]]);
  T('(a4) a win later that day: runs ok', t.okAll, t.out.slice(-1500));
  T('(a4) a win later that day carries the daily first win (' + QUIT_WIN + ' + ' + FULL_WIN + ')', xpAfter(t, 2, P0) === QUIT_WIN && xpAfter(t, 6, P0) === QUIT_WIN + FULL_WIN && xpPosts(t, P0).length === 2, J(xpPosts(t, P0).map((p) => p.score)));
}
{
  // (b) the other quit and confessed, the stayer wrote nothing either (he closed the game too)
  const P0 = H.SID(9731), P1 = H.SID(9732);
  const m = quick(0x10331, [P0, P1], { conf: [1] });
  const all = m.S.concat(m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [2 * HOUR, all], [24 * HOUR, all]]);
  T('(b) nobody wrote: runs ok', t.okAll, t.out.slice(-1500));
  T('(b) nobody wrote: as before -- no XP for either, the quitter\'s one leave', xpPosts(t, P0).length === 0 && xpPosts(t, P1).length === 0 && leavesOf(t, P1) === 1, J([xpPosts(t, P0), xpPosts(t, P1), leavesOf(t, P1)]));
  T('(b) nobody wrote: no quit-lone line', !/quit-lone/.test(t.out));
}
{
  // (c) no confession: the other player's game just stopped (a crash, a pulled cable); only the stayer wrote
  const P0 = H.SID(9741), P1 = H.SID(9742);
  const m = quick(0x10341, [P0, P1], { res: { 0: PEERS_GONE } });
  const all = m.S.concat(m.R);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all], [24 * HOUR, all]]);
  T('(c) no confession: runs ok', t.okAll, t.out.slice(-1500));
  T('(c) no confession: as before -- the flat 50 at the start maturity, once', xpPosts(t, P0).length === 1 && xpAfter(t, 3, P0) === 0 && xpAfter(t, 5, P0) === 50, J(xpPosts(t, P0).map((p) => p.score)));
  T('(c) no confession: the silent seat convicted by the start-orphan verdict, as before', leavesOf(t, P1) === 1 && xpPosts(t, P1).length === 0, J([leavesOf(t, P1), xpPosts(t, P1)]));
  T('(c) no confession: no quit-lone line', !/quit-lone/.test(t.out));
}

// ---- [4] ----
console.log('[4] end to end: the edges');
{
  // an early quit (2 levels): 190 x 2/6 = 63 (more than 50); the daily first win is kept for his next full win the same day
  const P0 = H.SID(9751), P1 = H.SID(9752), Q1 = H.SID(9753);
  const m = quick(0x10351, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1], prog: 2 });
  const n = quick(0x10352, [P0, Q1], { res: { 0: 0, 1: 0 } });
  const a1 = m.S.concat(m.R, m.C), a2 = a1.concat(n.S, n.R);
  const t = run([[0, a1], [STEP, a1], [STEP, a1], [STEP, a2], [STEP, a2], [STEP, a2], [STEP, a2]]);
  T('early quit: runs ok', t.okAll, t.out.slice(-1500));
  T('early quit (2 levels): 63, no daily first win spent on it', xpAfter(t, 2, P0) === 63 && xpLines(t, P0).some((l) => /valid rank1 x1 prog x0\.3333/.test(l) && !/dailyWin/.test(l)), J(xpPosts(t, P0).map((p) => p.score)) + ' ' + xpLines(t, P0).join(' | '));
  T('early quit: his next full win the same day still carries the daily first win (63 + ' + FULL_WIN + ')', xpAfter(t, 6, P0) === 63 + FULL_WIN && xpPosts(t, P0).length === 2, J(xpPosts(t, P0).map((p) => p.score)));
}
{
  // a quit in the first level (1 level): 190 x 1/6 = 32 -> the 50 floor (never below what the start-orphan verdict paid)
  const P0 = H.SID(9761), P1 = H.SID(9762);
  const m = quick(0x10361, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1], prog: 1 });
  const all = m.S.concat(m.R, m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all]]);
  T('first-level quit: runs ok', t.okAll, t.out.slice(-1500));
  T('first-level quit: the 50 floor, once, logged', xpPosts(t, P0).length === 1 && xpAfter(t, 4, P0) === 50 && xpLines(t, P0).some((l) => /\(floor 50, was \+32, W103\)/.test(l)), J(xpPosts(t, P0).map((p) => p.score)) + ' ' + xpLines(t, P0).join(' | '));
}
{
  // a finished result: the quitter came back after his Esc and played to the end; his own result lands 40 minutes later (a
  //   resend). As before: the normal settle when it lands (his loss XP, his leave forgiven), nothing on the quit-lone lane
  const P0 = H.SID(9771), P1 = H.SID(9772);
  const m = quick(0x10371, [P0, P1], { res: { 0: 0, 1: 0 }, conf: [1] });
  const early = m.S.concat(m.R.filter((r) => r.sid === P0), m.C), full = m.S.concat(m.R, m.C);
  const steps = [[0, early], [STEP, early], [STEP, early]];
  for (let i = 0; i < 4; i++) steps.push([7 * MIN, early]);
  steps.push([7 * MIN, full], [STEP, full], [STEP, full], [2 * HOUR, full]);
  const t = run(steps);
  T('came back and finished: runs ok', t.okAll, t.out.slice(-1500));
  T('came back and finished: nothing paid before his result landed', xpAfter(t, 6, P0) === 0 && xpAfter(t, 6, P1) === 0, xpAfter(t, 6, P0) + ' / ' + xpAfter(t, 6, P1));
  T('came back and finished: the normal ' + FULL_WIN + ' / ' + FULL_LOSS + ', each once', xpPosts(t, P0).length === 1 && xpPosts(t, P1).length === 1 && xpAfter(t, 10, P0) === FULL_WIN && xpAfter(t, 10, P1) === FULL_LOSS,
    J([xpPosts(t, P0), xpPosts(t, P1)].map((x) => x.map((p) => p.score))));
  T('came back and finished: his leave forgiven, no quit-lone line', leavesOf(t, P1) === 0 && !/quit-lone/.test(t.out), J([leavesOf(t, P1)]) + ' ' + t.out.split('\n').filter((l) => /quit-lone/.test(l)).join(' | '));
}
{
  // an incomplete shard read when it is due: held, the next complete read pays once
  const P0 = H.SID(9781), P1 = H.SID(9782);
  const m = quick(0x10381, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1] });
  const all = m.S.concat(m.R, m.C);
  const FAIL = { STUB_FAIL: JSON.stringify({ shard_40: 503 }) };
  const t = run([[0, all], [STEP, all], [STEP, all, FAIL], [STEP, all], [STEP, all], [2 * HOUR, all]]);
  T('incomplete read: runs ok', t.okAll, t.out.slice(-1500));
  T('incomplete read: held that run, nothing paid', xpAfter(t, 2, P0) === 0 && /quit-lone [^\n]*due, held \(incomplete shard read\)/.test(t.rs[2].out) || (xpAfter(t, 2, P0) === 0 && /absent-hold [^\n]*not every record shard was read/.test(t.rs[2].out)),
    t.rs[2].out.split('\n').filter((l) => /quit-lone|absent-hold|shard/.test(l)).join(' | '));
  T('incomplete read: the next complete reads pay ' + QUIT_WIN + ', once', xpAfter(t, 5, P0) === QUIT_WIN && xpPosts(t, P0).length === 1, J(xpPosts(t, P0).map((p) => p.score)));
}
{
  // a ranked 1V1 of the same shape: untouched (the confession fines him; the start-orphan verdict consoles the stayer)
  const P0 = H.SID(9791), P1 = H.SID(9792);
  const m = quick(0x10391, [P0, P1], { res: { 0: PEERS_GONE }, conf: [1], mt: 2 });
  const all = m.S.concat(m.R, m.C);
  const t = run([[0, all], [STEP, all], [STEP, all], [STEP, all], [2 * HOUR, all], [24 * HOUR, all]]);
  T('ranked: runs ok', t.okAll, t.out.slice(-1500));
  T('ranked: no quit-lone line, the stayer not paid a win', !/quit-lone/.test(t.out) && !xpPosts(t, P0).some((p) => p.score > v.CONSOLATION_XP), J(xpPosts(t, P0).map((p) => p.score)));
}

console.log(failN ? '\nquit-lone-1v1: ' + failN + ' FAILED' : '\nquit-lone-1v1: all ok');
process.exit(failN ? 1 : 0);
