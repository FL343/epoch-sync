'use strict';
// Q427 (cloud audit; player voice V072): a quick match of three to six seats whose other players ALL pressed Esc mid-match --
// each wrote his own start and his own abandon confession (0xB5, user-quit) and no result -- while one player stayed to the
// end on his screen and wrote his result (peers-gone as the host, host-left as the last joiner). One writer is no consistent
// group, and the W103 lane took two seats only: the key went to the start-orphan verdict two hours later and paid the stayer
// the flat CONSOLATION_XP (50) -- no win, no career win, no CP. The lane now takes three to six seats (QUIT_LONE.PC_MAX), and
// its W113 follow-up (a quitter who came back and dropped later, his own result after the settle) takes them too.
//   [0] the constant
//   [1] units (quitLoneClaim, three / four / six seats): the honest shapes claim (each quitter named at his seat, in seat
//       order); one other seat that did not quit claims nothing (no confession, a refunded / convicted / synthetic one, no
//       start of his own, a result of his), nor one account at two seats, a bot seat, seven seats, an alt at a quitter's
//       seat on the result, a seat out of the match, a party queue, the old ranked code
//   [2] units (quitLoneLateDue, three seats): the stamp of a later share (his seat and the stayer's), a fellow quitter's
//       records in the group, the signals once per key; a three-seat stamp without the stayer's seat, a stranger, a seat
//       swapped: not paid
//   [3] end to end: three seats (the host stayed), four (the last joiner, host-left), six -- the win's XP once (never the
//       daily first win), a career win, CP, nobody rated, every quitter one leave and nothing else, every quitter's entry
//       stamped; the summary row; ranked seats (O716 D12: the stayer's x1.25, no points; a ranked quitter fined by his own
//       confession, as today)
//   [4] end to end, unchanged: one other seat crashed (no confession: the 50 at maturity, the silent seat convicted); two
//       players stayed and wrote (the normal settle); an incomplete read at the due time (held, then paid once); the old
//       ranked code 2 with three seats
//   [5] end to end, W113 on three seats: one quitter's late result after the lane (his share once, his leave forgiven, the
//       other quitter nothing); both quitters' late results (each paid once, the signals of the key once)
//   [6] mutants: validate.js with one part of the fix put back -- each goes red
// End to end over the REAL validate.js main() against the offline board stub of test/lib/settle-stub.js.
const fs = require('fs');
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
const PEERS_GONE = 1, HOST_LEFT = 2, USER_QUIT = 5, RECONNECT_FAILED = 6;

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
const scoresOf = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(600 - 50 * i); return a; };
const rankIn = (sc, seat) => 1 + sc.filter((y) => y > sc[seat]).length;
const vecOf = (r) => J(r.d.slice(10, 10 + (r.d[8] | 0)));

// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const mutants = [];
function mutant(from, to, tag) {
  const src = fs.readFileSync(H.VALIDATE, 'utf8');
  if (src.split(from).length !== 2) { bad(tag + ' mutant anchor found exactly once: ' + from.slice(0, 90)); return null; }
  const out = path.join(H.ROOT, '.mutant-quit-lone-multi-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(out, src.replace(from, to));
  mutants.push(out);
  return out;
}
process.on('exit', () => { for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} } });

// ---- [0] ----
console.log('[0] the constant');
T('QUIT_LONE: two to six seats (PC .. PC_MAX), the rest as W103', v.QUIT_LONE && v.QUIT_LONE.MT === 1 && v.QUIT_LONE.PC === 2 && v.QUIT_LONE.PC_MAX === 6 && v.QUIT_LONE.LEVEL_SECONDS === 60, J(v.QUIT_LONE));

// ---- [1] units: quitLoneClaim ----
console.log('[1] quitLoneClaim, three to six seats');
const U = []; for (let i = 0; i < 7; i++) U.push(H.SID(9601 + i));
const X = H.SID(9690);
const KEY = (0x10601 | 0) + '_1234_1';
// the writer at `seat` of an n-seat table; o.ros (the result's roster), o.mt, o.disp, o.sc, o.prog
const resN = (n, seat, o) => {
  const x = o || {};
  const ros = x.ros || U.slice(0, n), sc = x.sc || scoresOf(ros.length);
  const d = rec(0xB1, x.mt || 1, 0x10601, seat, rankIn(sc, seat), false, ros, sc, x.disp == null ? PEERS_GONE : x.disp, x.prog);
  return { steamID: ros[seat], shard: 's0', d, dispCode: d[10 + ros.length] | 0, disp: v.dispName(d[10 + ros.length] | 0), roster: v.decodeRoster(d) };
};
const rosterOf = (n) => { const r = {}; for (let i = 0; i < n; i++) r[i] = v.pid(U[i]); return r; };
const entryN = (n, stay, o) => Object.assign({ t0: 1, mt: 1, roster: rosterOf(n), settled: [v.pid(U[stay])], started: U.slice(0, n).map((s) => v.pid(s)) }, o || {});
const quitters = (n, stay) => { const s = new Set(); for (let i = 0; i < n; i++) if (i !== stay) s.add(v.pid(U[i]) + '|' + KEY); return s; };
const claimN = (n, stay, o) => {
  const x = o || {};
  const qs = x.quitSeen || quitters(n, stay);
  return (x.v || v).quitLoneClaim(x.p || entryN(n, stay), KEY, x.g || [resN(n, stay)], x.pending || {}, x.processed || new Set(), x.confState || {}, x.confSeen || qs, qs, vecOf);
};
for (const [n, stay, disp, what] of [[3, 0, PEERS_GONE, 'the host stayed (peers-gone)'], [3, 2, HOST_LEFT, 'the last joiner stayed (host-left)'], [4, 1, PEERS_GONE, 'a joiner the host migrated to'],
  [6, 5, HOST_LEFT, 'the last joiner of six'], [6, 3, PEERS_GONE, 'seat 3 of six']]) {
  const c = claimN(n, stay, { g: [resN(n, stay, { disp })] });
  const want = []; for (let i = 0; i < n; i++) if (i !== stay) want.push({ o: U[i], seat: i });
  T(n + ' seats, ' + what + ': claims for him at his seat, every quitter named at his seat in seat order', !!c && c.w === U[stay] && c.seat === stay && c.prog === 6 && J(c.os) === J(want) && c.o === want[0].o, J(c));
}
{
  const n = 4, stay = 0;
  const qs = quitters(n, stay);
  const less = new Set(qs); less.delete(v.pid(U[2]) + '|' + KEY);
  T('4 seats, seat 2 wrote no confession (a crash or a pulled cable): nothing (as today)', claimN(n, stay, { quitSeen: less, confSeen: less }) === null);
  T('4 seats, seat 2 confessed on an earlier run (state, a leave counted): claims', !!claimN(n, stay, { quitSeen: less, confSeen: less, confState: { [v.pid(U[2]) + '|' + KEY]: { t0: 1, mt: 1, ded: 0, ex: 1 } } }));
  for (const [f, what] of [[{ refunded: 1, ex: 0 }, 'refunded (he came back and finished)'], [{ cv: 1, ex: 1 }, 'a conviction\'s entry'], [{ nf: 1, ex: 1 }, 'a synthetic entry'], [{ done: 1 }, 'settled at first sight']]) {
    T('4 seats, seat 2\'s confession ' + what + ': nothing', claimN(n, stay, { quitSeen: less, confSeen: less, confState: { [v.pid(U[2]) + '|' + KEY]: Object.assign({ t0: 1, mt: 1 }, f) } }) === null);
  }
  T('4 seats, seat 3 never wrote his own start: nothing', claimN(n, stay, { p: entryN(n, stay, { started: [0, 1, 2].map((i) => v.pid(U[i])) }) }) === null);
  T('4 seats, seat 1 wrote a result once (p.settled): nothing (two writers: the normal settle)', claimN(n, stay, { p: entryN(n, stay, { settled: [v.pid(U[0]), v.pid(U[1])] }) }) === null);
  T('4 seats, the writer confessed too: nothing', claimN(n, stay, { confState: { [v.pid(U[0]) + '|' + KEY]: { t0: 1, ex: 1 } } }) === null);
  const ro2 = rosterOf(n); ro2[3] = ro2[1];
  // (the sanity screen's dup-sid flags these results too: the roster check is the second guard, as W103's op === wp)
  T('4 seats, one account at two seats (seats 1 and 3): nothing', claimN(n, stay, { p: entryN(n, stay, { roster: ro2 }), g: [resN(n, stay, { ros: [U[0], U[1], U[2], U[1]] })] }) === null);
  const ro3 = rosterOf(n); ro3[3] = ro3[0];
  T('4 seats, the writer at two seats: nothing', claimN(n, stay, { p: entryN(n, stay, { roster: ro3 }), g: [resN(n, stay, { ros: [U[0], U[1], U[2], U[0]] })] }) === null);
  const robot = rosterOf(n); delete robot[3];
  T('4 seats, seat 3 a bot (no roster entry): nothing', claimN(n, stay, { p: entryN(n, stay, { roster: robot }), g: [resN(n, stay, { ros: [U[0], U[1], U[2], '0'] })] }) === null);
  T('4 seats, his result names an alt at seat 2: nothing', claimN(n, stay, { g: [resN(n, stay, { ros: [U[0], U[1], X, U[3]] })] }) === null);
  const ro5 = rosterOf(n); ro5[4] = v.pid(X);
  T('4 seats, a fifth seat on the start roster: nothing', claimN(n, stay, { p: entryN(n, stay, { roster: ro5 }) }) === null);
  T('4 seats, a party queue (party bits on the type): nothing', claimN(n, stay, { p: entryN(n, stay, { mt: 0x31 }), g: [resN(n, stay, { mt: 0x31 })] }) === null);
  T('4 seats, the old ranked code 2: nothing (as today)', claimN(n, stay, { p: entryN(n, stay, { mt: 2 }), g: [resN(n, stay, { mt: 2 })] }) === null);
  T('4 seats, his result says finished: nothing (the others were there at the end)', claimN(n, stay, { g: [resN(n, stay, { disp: 0 })] }) === null);
  T('4 seats, a ranked-seat mask (O716 one queue): claims', !!claimN(n, stay, { p: entryN(n, stay, { mt: 1 | (0b1011 << 11) }), g: [resN(n, stay, { mt: 1 | (0b1011 << 11) })] }));
}
{
  const n = 7, stay = 0;
  T('seven seats (past PC_MAX): nothing', claimN(n, stay) === null);
}

// ---- [2] units: quitLoneLateDue on three seats ----
console.log('[2] quitLoneLateDue, three seats');
{
  const A = U[0], B = U[1], C = U[2], K3 = KEY;
  const stampOf = (seat, o) => Object.assign({ t0: 1, mt: 1, ded: 0, ex: 0, refunded: 1, ql: { w: v.pid(A), s: seat, ws: 0, t: 5 } }, o || {});
  const g3 = (recs) => [{ m: K3, g: recs, void: false }];
  const late = (seat, disp) => resN(3, seat, { disp: disp == null ? RECONNECT_FAILED : disp });
  {
    const cm = g3([resN(3, 0), late(1)]);
    const r = v.quitLoneLateDue({ [v.pid(B) + '|' + K3]: stampOf(1) }, cm, new Set([K3]));
    T('B (seat 1) came back and dropped, his result with the stayer\'s: due, the signals recorded (the first share of the key)', r.due.length === 1 && cm[0].qlLate && cm[0].qlLate.o === B && cm[0].qlLate.w === A && cm[0].qlLate.sig !== false, J(cm[0].qlLate));
  }
  {
    const cm = g3([resN(3, 0), late(1), late(2)]);
    const cs = { [v.pid(B) + '|' + K3]: stampOf(1), [v.pid(C) + '|' + K3]: stampOf(2) };
    const r = v.quitLoneLateDue(cs, cm, new Set([K3]));
    T('both quitters\' results in the group: the first due this run (one share a run), C\'s records are no stranger\'s', r.due.length === 1 && r.skip === 0 && cm[0].qlLate && cm[0].qlLate.o === B && cm[0].qlLate.sig !== false, J([r, cm[0].qlLate]));
    cs[v.pid(B) + '|' + K3].qlPaid = 1;
    const cm2 = g3([resN(3, 0), late(1), late(2)]);
    const r2 = v.quitLoneLateDue(cs, cm2, new Set([K3]));
    T('the next run: C\'s share due, the key\'s signals already recorded with B\'s (sig false)', r2.due.length === 1 && cm2[0].qlLate && cm2[0].qlLate.o === C && cm2[0].qlLate.sig === false, J(cm2[0].qlLate));
  }
  // n = the skip lines: one per stamped entry the group is read for
  const skip3 = (cs, recs, label, n) => { const cm = g3(recs); const r = v.quitLoneLateDue(cs, cm, new Set([K3])); T(label + ': not paid, logged as such', r.due.length === 0 && r.skip === (n || 1) && !cm[0].qlLate, J(r)); };
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1, { ql: { w: v.pid(A), s: 1, t: 5 } }) }, [resN(3, 0), late(1)], 'a three-seat stamp without the stayer\'s seat (no build writes one)');
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1) }, [resN(3, 0), late(1), late(2)], 'another quitter\'s records, his entry not stamped by the lane');
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1), [v.pid(C) + '|' + K3]: stampOf(2, { refunded: undefined }) }, [resN(3, 0), late(1), late(2)], 'another quitter\'s records, his leave not forgiven');
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1), [v.pid(C) + '|' + K3]: stampOf(2) }, [resN(3, 0), late(1), late(2, USER_QUIT)], 'another quitter\'s quit end in the group (both entries read: neither paid)', 2);
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1) }, [resN(3, 0), late(1), resN(3, 2, { ros: [A, B, X], disp: RECONNECT_FAILED })], 'a stranger\'s record');
  skip3({ [v.pid(B) + '|' + K3]: stampOf(1, { ql: { w: v.pid(A), s: 1, ws: 2, t: 5 } }) }, [resN(3, 0), late(1)], 'the stayer at another seat than the stamp\'s');
}

// ---- end to end harness ----
const PROGRESS = 5, RATING = 6, POINTS = 7, CPB = 8;
const boardsOf = (recs, prog, cpw) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
  { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: [] },
  { id: CPB, name: 'cp_bank', entries: Object.keys(cpw).map((s) => ({ steamID: s, score: cpw[s].score, details: cpw[s].details || [] })) }]);
function run(steps, script) {
  const prog = {}, cpw = {};
  const rs = [];
  let state = null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, prog, cpw), state ? H.advance(state, ms) : null, env || null, script || null, 'q427');
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
const pointsPosts = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, POINTS, sid)));
const last = (m) => m.rs[m.rs.length - 1].state;
const leavesOf = (m, sid) => (((last(m).LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const xpLines = (m, sid) => m.out.split('\n').filter((l) => l.indexOf('  xp ' + v.pid(sid).slice(0, 8) + ' ') === 0);
const confOf = (m, sid, key) => (last(m).CONFESSIONS_FILE || {})[v.pid(sid) + '|' + key] || null;
const sigOf = (m, sid) => ((last(m).SIGNALS_FILE || {}).players || {})[v.pid(sid)] || null;
const pairOf = (m, a, b) => ((last(m).SIGNALS_FILE || {}).pairs || {})[v.pairKey(v.pid(a), v.pid(b))] || null;
const anyRated = (m) => [].concat(...m.rs.map((r) => H.setPosts(r, RATING))).length > 0;
// an n-seat quick match; o.stay = the stayer's seat (his result o.disp); o.conf = the seats that confessed (default: every
//   other one); o.res = extra { seat: disp } results; o.late = { seat: disp } results written later (the `full` set)
function match(n, hash, o) {
  const x = o || {};
  const ros = []; for (let i = 0; i < n; i++) ros.push(H.SID(9000 + ((hash & 0xfff) * 8) % 900 + i + (x.sidBase || 0)));
  const sc = x.sc || scoresOf(n), mt = x.mt || 1, stay = x.stay == null ? 0 : x.stay;
  const S = ros.map((sid, seat) => ({ sid, d: rec(0xB2, mt, hash, seat, 0, false, ros) }));
  const res = Object.assign({ [stay]: x.disp == null ? PEERS_GONE : x.disp }, x.res || {});
  const R = Object.keys(res).map((k) => { const seat = k | 0, rk = rankIn(sc, seat); return { sid: ros[seat], d: rec(0xB1, mt, hash, seat, rk, rk === 1, ros, sc, res[k], x.prog) }; });
  const conf = x.conf || ros.map((_, i) => i).filter((i) => i !== stay && res[i] == null);
  const C = conf.map((seat) => ({ sid: ros[seat], d: rec(0xB5, mt, hash, seat, 0, false, ros, null, USER_QUIT) }));
  const L = Object.keys(x.late || {}).map((k) => { const seat = k | 0, rk = rankIn(sc, seat); return { sid: ros[seat], d: rec(0xB1, mt, hash, seat, rk, false, ros, sc, x.late[k], x.prog) }; });
  return { ros, sc, stay, key: hash + '_1234_' + mt, base: S.concat(R, C), full: S.concat(R, C, L) };
}
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation, the 5-minute absence grace and the 6-level floor
const winOf = (money) => 100 + 80 + Math.min(100, Math.floor(money / 50));   // base + rank 1 + money / 50: the quit-lone lane never takes the daily first win
const SHARE = 100;   // a late quitter's interrupted end: the base only
const STD = (base) => [[0, base], [STEP, base], [STEP, base], [STEP, base], [2 * HOUR, base], [24 * HOUR, base]];

// ---- [3] ----
console.log('[3] end to end: three, four and six seats');
let ctl3 = null;   // the three-seat match: the control the mutants re-run
for (const [n, stay, disp, hash, what] of [[3, 0, PEERS_GONE, 0x10611, 'the host stayed'], [4, 3, HOST_LEFT, 0x10612, 'the last joiner stayed (host-left)'], [6, 2, PEERS_GONE, 0x10613, 'seat 2 of six stayed']]) {
  const m = match(n, hash, { stay, disp });
  if (n === 3) ctl3 = m;
  const t = run(STD(m.base));
  const tag = '(' + n + ' seats, ' + what + ') ';
  const W = m.ros[stay], want = winOf(m.sc[stay]);
  T(tag + 'runs ok', t.okAll, t.out.slice(-1500));
  T(tag + 'the win\'s XP, ' + want + ', once only (not the 50)', xpPosts(t, W).length === 1 && xpAfter(t, 5, W) === want, J(xpPosts(t, W).map((p) => p.score)));
  T(tag + 'rank 1 of the one writer, a career win, no daily first win, the streak frozen', xpLines(t, W).some((l) => /valid rank1 x1 .*career 1g\/1w\/0l streak f/.test(l) && !/dailyWin/.test(l)), xpLines(t, W).join(' | '));
  T(tag + 'CP written for him', cpPosts(t, W).length === 1 && cpPosts(t, W)[0].score > 0, J(cpPosts(t, W)));
  T(tag + 'settled on the quit-lone lane, every quitter named, no start-orphan verdict, no consolation', new RegExp('quit-lone settle ' + m.key + ': ').test(t.out) && /\/ Q427\)/.test(t.out)
    && !new RegExp('start-orphan ' + m.key).test(t.out) && !/consolation xp /.test(t.out), t.out.split('\n').filter((l) => /quit-lone|start-orphan|consolation/.test(l)).join(' | '));
  const qs = m.ros.filter((_, i) => i !== stay);
  T(tag + 'every quitter: no XP, no CP, one leave (his confession)', qs.every((s) => xpPosts(t, s).length === 0 && cpPosts(t, s).length === 0 && leavesOf(t, s) === 1), J(qs.map((s) => [xpPosts(t, s).length, cpPosts(t, s).length, leavesOf(t, s)])));
  T(tag + 'every quitter\'s confession entry stamped (the stayer, his own seat, the stayer\'s seat)', qs.every((s) => { const c = confOf(t, s, m.key), seat = m.ros.indexOf(s); return !!(c && c.ql && c.ql.w === v.pid(W) && c.ql.s === seat && c.ql.ws === stay && !c.qlPaid); }),
    J(qs.map((s) => (confOf(t, s, m.key) || {}).ql)));
  T(tag + 'nobody rated (no rating or points write)', !anyRated(t) && [].concat(...t.rs.map((r) => H.setPosts(r, POINTS))).length === 0);
  T(tag + 'summary row: 1 due, 1 paid', t.rs.some((r) => /\| quick matches whose other player\(s\) all quit and confessed, only the stayer wrote a result \(W103, 3-6 seats Q427\)[^|]*\| 1 \/ 0 \/ 0 \(1\) \|/.test(r.summary)),
    t.rs.map((r) => (/quick matches whose other player[^\n]*/.exec(r.summary) || [''])[0]).join(' || '));
}
{
  // O716 one queue: a four-seat table with ranked seats 0 and 2 (the stayer at 0, a quitter at 2)
  const mt = 1 | (0b0101 << 11);
  const m = match(4, 0x10614, { stay: 0, mt });
  const t = run(STD(m.base));
  const W = m.ros[0];
  T('(ranked seats) runs ok, settled on the quit-lone lane', t.okAll && new RegExp('quit-lone settle ' + m.key + ': ').test(t.out), t.out.slice(-1500));
  T('(ranked seats) the stayer on a ranked seat: the win\'s XP x1.25 once, no points (O716 D12)', xpPosts(t, W).length === 1 && xpAfter(t, 5, W) > winOf(m.sc[0]) && pointsPosts(t, W).length === 0,
    J([xpPosts(t, W).map((p) => p.score), pointsPosts(t, W)]));
  T('(ranked seats) the ranked quitter fined at his confession (a points write), the quick ones the exit rate only, one leave each',
    pointsPosts(t, m.ros[2]).length === 1 && pointsPosts(t, m.ros[1]).length === 0 && pointsPosts(t, m.ros[3]).length === 0 && [1, 2, 3].every((i) => leavesOf(t, m.ros[i]) === 1),
    J([1, 2, 3].map((i) => [pointsPosts(t, m.ros[i]).length, leavesOf(t, m.ros[i])])));
  T('(ranked seats) nobody rated, no lone-1V1 claim', !anyRated(t) && !/lone-1v1 /.test(t.out));
}

// ---- [4] ----
console.log('[4] end to end, unchanged');
{
  // one other seat crashed (no confession): as today -- the flat 50 at maturity, the silent seat convicted
  const m = match(3, 0x10621, { conf: [1] });
  const t = run(STD(m.base));
  T('(a crash at seat 2) runs ok', t.okAll, t.out.slice(-1500));
  T('(a crash at seat 2) as today: the flat 50 at the start maturity, once, no quit-lone settle', xpPosts(t, m.ros[0]).length === 1 && xpAfter(t, 3, m.ros[0]) === 0 && xpAfter(t, 5, m.ros[0]) === 50
    && !/quit-lone settle /.test(t.out), J(xpPosts(t, m.ros[0]).map((p) => p.score)));
  T('(a crash at seat 2) the silent seat convicted by the start-orphan verdict, the quitter by his confession', leavesOf(t, m.ros[2]) === 1 && leavesOf(t, m.ros[1]) === 1, J([leavesOf(t, m.ros[1]), leavesOf(t, m.ros[2])]));
}
{
  // two players stayed and wrote (peers-gone each, the same scores), one quit: the normal settle, as today
  const m = match(3, 0x10622, { res: { 1: PEERS_GONE }, conf: [2] });
  const t = run(STD(m.base));
  T('(two stayed) runs ok, no quit-lone line', t.okAll && !/quit-lone/.test(t.out), t.out.slice(-1500));
  T('(two stayed) the normal settle: seat 0 the winner with his daily first win, seat 1 second', xpAfter(t, 5, m.ros[0]) === winOf(m.sc[0]) + 150 && xpAfter(t, 5, m.ros[1]) === 100 + 45 + 11,
    J([xpPosts(t, m.ros[0]).map((p) => p.score), xpPosts(t, m.ros[1]).map((p) => p.score)]));
}
{
  // an incomplete shard read at the due time: held that run, the next complete read pays once
  const m = match(3, 0x10623);
  const FAIL = { STUB_FAIL: JSON.stringify({ shard_40: 503 }) };
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base, FAIL], [STEP, m.base], [STEP, m.base], [2 * HOUR, m.base]]);
  T('(incomplete read) runs ok', t.okAll, t.out.slice(-1500));
  T('(incomplete read) held that run, nothing paid', xpAfter(t, 2, m.ros[0]) === 0 && (/quit-lone [^\n]*due, held \(incomplete shard read\)/.test(t.rs[2].out) || /absent-hold [^\n]*not every record shard was read/.test(t.rs[2].out)),
    t.rs[2].out.split('\n').filter((l) => /quit-lone|absent-hold|shard/.test(l)).join(' | '));
  T('(incomplete read) the next complete reads pay ' + winOf(m.sc[0]) + ', once', xpAfter(t, 5, m.ros[0]) === winOf(m.sc[0]) && xpPosts(t, m.ros[0]).length === 1, J(xpPosts(t, m.ros[0]).map((p) => p.score)));
}
{
  // the old ranked code 2 with three seats: untouched (the start-orphan verdict consoles the stayer)
  const m = match(3, 0x10624, { mt: 2 });
  const t = run(STD(m.base));
  T('(old ranked code) runs ok, no quit-lone line, the stayer not paid a win', t.okAll && !/quit-lone/.test(t.out) && !xpPosts(t, m.ros[0]).some((p) => p.score > v.CONSOLATION_XP), J(xpPosts(t, m.ros[0]).map((p) => p.score)));
}

// ---- [5] ----
console.log('[5] end to end: W113 on three seats');
{
  // B (seat 1) pressed Esc, came back and dropped (his reconnect-failed result, landing after the lane); C (seat 2) quit for good
  const m = match(3, 0x10631, { late: { 1: RECONNECT_FAILED } });
  const at = 4;
  const steps = [[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.full], [STEP, m.full], [2 * HOUR, m.full], [24 * HOUR, m.full]];
  const t = run(steps);
  const [A, B, C] = m.ros;
  T('(one came back) runs ok', t.okAll, t.out.slice(-1500));
  T('(one came back) the lane paid the stayer first (' + winOf(m.sc[0]) + '), nothing for B then', xpAfter(t, 2, A) === winOf(m.sc[0]) && xpAfter(t, at - 1, B) === 0, xpAfter(t, 2, A) + ' / ' + xpAfter(t, at - 1, B));
  T('(one came back) B\'s share when his result lands: ' + SHARE + ', once; his leave forgiven', xpAfter(t, at, B) === SHARE && xpPosts(t, B).length === 1 && leavesOf(t, B) === 0 && confOf(t, B, m.key).qlPaid === 1,
    J([xpPosts(t, B).map((p) => p.score), leavesOf(t, B)]) + ' ' + t.out.split('\n').filter((l) => /quit-lone late|confess-forgive/.test(l)).join(' | '));
  T('(one came back) an interrupted end: a career game, no win or loss', xpLines(t, B).length === 1 && /innocent rank2 x1 \+100 -> 100 career 1g\/0w\/0l/.test(xpLines(t, B)[0]), xpLines(t, B).join(' | '));
  T('(one came back) B\'s CP once', cpPosts(t, B).length === 1 && cpPosts(t, B)[0].score > 0, J(cpPosts(t, B)));
  T('(one came back) C: nothing, one leave; the stayer as the lane paid him', xpPosts(t, C).length === 0 && leavesOf(t, C) === 1 && xpPosts(t, A).length === 1 && xpAfter(t, 7, A) === winOf(m.sc[0]),
    J([xpPosts(t, C), leavesOf(t, C), xpPosts(t, A).map((p) => p.score)]));
  T('(one came back) the signals of the two records once (a game each, the stayer the winner, the pair once)', sigOf(t, A) && sigOf(t, A).g === 1 && sigOf(t, A).w === 1 && sigOf(t, B) && sigOf(t, B).g === 1
    && pairOf(t, A, B) && pairOf(t, A, B).n === 1 && !pairOf(t, A, C), J([sigOf(t, A), sigOf(t, B), pairOf(t, A, B), pairOf(t, A, C)]));
  T('(one came back) nobody rated', !anyRated(t) && [].concat(...t.rs.map((r) => H.setPosts(r, POINTS))).length === 0);
}
let ctl5 = null;
{
  // both quitters came back and dropped; their results land together after the lane: each paid his share once, on runs of
  //   their own, the signals of the key once
  const m = match(3, 0x10632, { late: { 1: RECONNECT_FAILED, 2: RECONNECT_FAILED } });
  ctl5 = m;
  const t = run([[0, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.base], [STEP, m.full], [STEP, m.full], [STEP, m.full], [2 * HOUR, m.full]]);
  const [A, B, C] = m.ros;
  T('(both came back) runs ok', t.okAll, t.out.slice(-1500));
  T('(both came back) B and C: ' + SHARE + ' each, once each; their leaves forgiven', [B, C].every((s) => xpPosts(t, s).length === 1 && xpAfter(t, 7, s) === SHARE && leavesOf(t, s) === 0 && confOf(t, s, m.key).qlPaid === 1),
    J([B, C].map((s) => [xpPosts(t, s).map((p) => p.score), leavesOf(t, s)])) + ' ' + t.out.split('\n').filter((l) => /quit-lone late/.test(l)).join(' | '));
  T('(both came back) C ranked among the three records (third of three)', xpLines(t, C).some((l) => /innocent rank3 /.test(l)), xpLines(t, C).join(' | '));
  // two reconnect-failed votes of three: the normal settle of these records is a void consensus -- its signals are a void each
  T('(both came back) the signals of the key once: a void each (the normal settle\'s void consensus), every pair once',
    [A, B, C].every((s) => sigOf(t, s) && sigOf(t, s).v === 1 && sigOf(t, s).g === 0) && [[A, B], [A, C], [B, C]].every(([a, b]) => pairOf(t, a, b) && pairOf(t, a, b).n === 1),
    J([[A, B, C].map((s) => [(sigOf(t, s) || {}).v, (sigOf(t, s) || {}).g]), [[A, B], [A, C], [B, C]].map(([a, b]) => (pairOf(t, a, b) || {}).n)]));
  T('(both came back) the stayer as the lane paid him', xpPosts(t, A).length === 1 && xpAfter(t, 7, A) === winOf(m.sc[0]), J(xpPosts(t, A).map((p) => p.score)));
}

// ---- [6] mutants ----
console.log('[6] mutants: one part of the fix put back');
{
  // the code before (two seats only): the three-seat stayer gets the 50 again
  const s = mutant('pc < QUIT_LONE.PC || pc > QUIT_LONE.PC_MAX) return null;', 'pc !== QUIT_LONE.PC) return null;', '6a');
  if (s) {
    const t = run(STD(ctl3.base), s);
    T('[6a] mutant (two seats only, as before Q427): [3] goes red -- the three-seat stayer gets the flat 50', t.okAll && xpAfter(t, 5, ctl3.ros[0]) === 50 && !/quit-lone settle /.test(t.out), J(xpPosts(t, ctl3.ros[0]).map((p) => p.score)));
  }
}
{
  const s = mutant('for (const s of others) {', 'for (const s of others.slice(0, 1)) {', '6b');
  if (s) {
    const mv = require(s);
    const less = quitters(4, 0); less.delete(v.pid(U[2]) + '|' + KEY);
    T('[6b] mutant (only the first other seat must have quit): [1] goes red -- seat 2 without a confession claims', !!claimN(4, 0, { v: mv, quitSeen: less, confSeen: less }) && claimN(4, 0, { quitSeen: less, confSeen: less }) === null);
  }
}
{
  const s = mutant('    if (!hasOwnStart(p, op) || (p.settled || []).indexOf(op) >= 0) return null;\n    const cs = confState', '    if ((p.settled || []).indexOf(op) >= 0) return null;\n    const cs = confState', '6c');
  if (s) {
    const mv = require(s);
    const o = { p: entryN(4, 0, { started: [0, 1, 2].map((i) => v.pid(U[i])) }) };
    T('[6c] mutant (a quitter\'s own start not required): [1] goes red -- seat 3 without his own start claims', !!claimN(4, 0, Object.assign({ v: mv }, o)) && claimN(4, 0, o) === null);
  }
}
{
  const s = mutant('const qos = c.quitLone.os || [{ o: c.quitLone.o, seat: 1 - (c.quitLone.seat | 0) }];', 'const qos = [{ o: c.quitLone.o, seat: 1 - (c.quitLone.seat | 0) }];', '6d');
  if (s) {
    const t = run(STD(ctl3.base), s);
    T('[6d] mutant (only the first quitter stamped, as a 1V1): [3] goes red -- seat 2\'s entry has no stamp', t.okAll && !(confOf(t, ctl3.ros[2], ctl3.key) || {}).ql, J((confOf(t, ctl3.ros[2], ctl3.key) || {}).ql));
  }
}
{
  const s = mutant("} else if (h !== op && h !== q.w && seat !== qs && seat !== ws && fellow(h, seat) && dispClassOf(r.dispCode) !== 'abandoner') {", '} else if (false) {', '6e');
  if (s) {
    const t = run([[0, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.full], [STEP, ctl5.full], [STEP, ctl5.full]], s);
    T('[6e] mutant (a fellow quitter\'s records count as a stranger\'s): [5] goes red -- neither late quitter paid', t.okAll && xpPosts(t, ctl5.ros[1]).length === 0 && xpPosts(t, ctl5.ros[2]).length === 0,
      J([xpPosts(t, ctl5.ros[1]).length, xpPosts(t, ctl5.ros[2]).length]));
  }
}
{
  const s = mutant('if (L.sig !== false) { recordMatchSignals(', 'if (true) { recordMatchSignals(', '6f');
  if (s) {
    const t = run([[0, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.base], [STEP, ctl5.full], [STEP, ctl5.full], [STEP, ctl5.full]], s);
    T('[6f] mutant (the signals at every share): [5] goes red -- the stayer\'s void and the pairs counted twice', t.okAll && (sigOf(t, ctl5.ros[0]) || {}).v === 2 && (pairOf(t, ctl5.ros[0], ctl5.ros[1]) || {}).n === 2,
      J([(sigOf(t, ctl5.ros[0]) || {}).v, (pairOf(t, ctl5.ros[0], ctl5.ros[1]) || {}).n]));
  }
}
{
  const s = mutant('const ws = q.ws != null ? (q.ws | 0) : (pc0 === QUIT_LONE.PC ? 1 - qs : -1);', 'const ws = 1 - qs;', '6g');
  if (s) {
    const mv = require(s);
    const cm = [{ m: KEY, g: [resN(3, 0), resN(3, 2, { disp: RECONNECT_FAILED })], void: false }];
    const r = mv.quitLoneLateDue({ [v.pid(U[2]) + '|' + KEY]: { t0: 1, mt: 1, ded: 0, ex: 0, refunded: 1, ql: { w: v.pid(U[0]), s: 2, ws: 0, t: 5 } } }, cm, new Set([KEY]));
    const cm0 = [{ m: KEY, g: [resN(3, 0), resN(3, 2, { disp: RECONNECT_FAILED })], void: false }];
    const r0 = v.quitLoneLateDue({ [v.pid(U[2]) + '|' + KEY]: { t0: 1, mt: 1, ded: 0, ex: 0, refunded: 1, ql: { w: v.pid(U[0]), s: 2, ws: 0, t: 5 } } }, cm0, new Set([KEY]));
    T('[6g] mutant (the stayer\'s seat read as a 1V1\'s): [2] goes red -- seat 2\'s late share not paid', r.due.length === 0 && r0.due.length === 1, J([r, r0]));
  }
}

console.log(failN ? '\nquit-lone-multi: ' + failN + ' FAILED' : '\nquit-lone-multi: all ok');
process.exit(failN ? 1 : 0);
