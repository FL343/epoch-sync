'use strict';
// Q316 (cloud audit 2026-10): a two-player friends' room (type 10) where only one player's result ever lands -- the other
// one, honest, closed the game on the results page (or it crashed there) and did not come back to a menu inside the
// client's 2-hour resend window. The key had one writer for good and the player who stayed to the end got nothing.
// privateLoneVerdicts settles such a key for its one writer, base XP, PRIVATE_LONE.WAIT_MS after the job first saw it.
//   [0] the constant: the wait sits at least half an hour past the client's resend window (its lockstep test pins
//       CLIENT_TTL_MS to the game's OB.TTL_MS)
//   [1] units (privateLoneClaim): the honest shape claims; every condition that is not met claims nothing (provisional,
//       split or lent roster, a contest note, a split mark, the silent seat without its own start / with a result / with a
//       confession, his own confession, a result not finished, a result that fails the sanity screen, another table, two
//       writers, another seat, not a friends' room, one human and a bot)
//   [2] end to end: two finishers (104 / 44, the control); one finisher -- nothing before the wait, 74 once after it, never
//       again; the other player's late result inside the wait (Q224 review N5) -- the normal 104 / 44, nothing more after
//   [3] end to end, nothing for: a player whose partner left mid-match (peers-gone, Q195: as before); a partner who never
//       wrote a start (no registered roster); an outside account starting from his seat (the key contested); a result of
//       his that fails the sanity screen (not paid and not flagged either: a one-writer key never settles today)
//   [4] an incomplete shard read at the due time holds it; the next complete read pays it, once
//   [5] a room of three, all honest, whose two other results land late one after the other inside the wait (Q316 review
//       R6): the settle as today, 104 / 74 / 44 -- the absence stamp is set only on the due run, so the last one's
//       5-minute grace starts when the room turns consistent, not when the first result was seen
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

// ---- [0] ----
console.log('[0] the wait against the client\'s resend window');
T('PRIVATE_LONE.CLIENT_TTL_MS is 2 hours (the game\'s OB.TTL_MS, pinned there)', v.PRIVATE_LONE.CLIENT_TTL_MS === 2 * HOUR, J(v.PRIVATE_LONE));
T('PRIVATE_LONE.WAIT_MS >= CLIENT_TTL_MS + 30 min', v.PRIVATE_LONE.WAIT_MS >= v.PRIVATE_LONE.CLIENT_TTL_MS + 30 * MIN, J(v.PRIVATE_LONE));
T('exported: privateLoneClaim / privateLoneVerdicts', typeof v.privateLoneClaim === 'function' && typeof v.privateLoneVerdicts === 'function');

// ---- [1] units ----
console.log('[1] privateLoneClaim');
{
  const A = H.SID(9601), B = H.SID(9602), X = H.SID(9603), Z = H.SID(9604);
  const KEY = (0x31601 | 0) + '_1234_10';
  const res = (sid, seat, ros, disp, sc) => { const d = H.rec(0xB1, 10, 0x31601, seat, 1, true, ros, sc || [500, 300], disp | 0); return { steamID: sid, shard: 's0', d, dispCode: disp | 0, disp: v.dispName(disp | 0), roster: v.decodeRoster(d) }; };
  const vecOf = (r) => J(r.d.slice(10, 10 + (r.d[8] | 0)));
  const entry = (o) => Object.assign({ t0: 1, mt: 10, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [v.pid(B)], started: [v.pid(A), v.pid(B)] }, o || {});
  // B (seat 1) wrote his result, A (seat 0) started and wrote nothing
  const g = [res(B, 1, [A, B])];
  const claim = (p, gg, o) => { const x = o || {}; return v.privateLoneClaim(p, KEY, gg || g, x.pending || {}, x.processed || new Set(), x.confState || {}, x.confSeen || new Set(), vecOf); };
  const c0 = claim(entry());
  T('honest shape: claims for its writer at his seat', !!c0 && c0.w === B && c0.seat === 1 && c0.m === KEY, J(c0));
  T('two records of his (a cold-reconnect copy) still claim', !!claim(entry(), [res(B, 1, [A, B]), res(B, 1, [A, B])]));
  T('roster still provisional: nothing', claim(entry({ prov: 'abc' })) === null);
  T('roster split: nothing', claim(entry({ split: 1 })) === null);
  T('synthetic entry (no start roster): nothing', claim(entry({ synth: true, roster: {} })) === null);
  T('entry lent its t0 to a table split: nothing', claim(entry({ lent: 5 })) === null);
  T('contest note on the key: nothing', claim(entry(), null, { pending: { ['~' + KEY]: { t0: 1, c: 1 } } }) === null);
  T('key split before (its mark processed): nothing', claim(entry(), null, { processed: new Set([v.splitMark ? v.splitMark(KEY) : 'x']) }) === null || !v.splitMark, 'splitMark export');
  T('key processed: nothing', claim(entry(), null, { processed: new Set([KEY]) }) === null);
  T('silent seat never wrote his own start: nothing', claim(entry({ started: [v.pid(B)] })) === null);
  T('silent seat wrote a result once (p.settled): nothing', claim(entry({ settled: [v.pid(B), v.pid(A)] })) === null);
  T('silent seat confessed (state): nothing', claim(entry(), null, { confState: { [v.pid(A) + '|' + KEY]: { t0: 1 } } }) === null);
  T('silent seat confessed (read this run): nothing', claim(entry(), null, { confSeen: new Set([v.pid(A) + '|' + KEY]) }) === null);
  T('the writer confessed: nothing', claim(entry(), null, { confSeen: new Set([v.pid(B) + '|' + KEY]) }) === null);
  T('his result is peers-gone, not finished: nothing', claim(entry(), [res(B, 1, [A, B], 1)]) === null);
  {
    const ins = res(B, 1, [A, B], 0, [500, 5000000]);   // a score past the cap
    T('his result fails the sanity screen: nothing', v.sanityFlags([ins]).length > 0 && claim(entry(), [ins]) === null, J(v.sanityFlags([ins])));
  }
  T('his result names another table (an alt at seat 0): nothing', claim(entry(), [res(B, 1, [X, B])]) === null);
  T('his result names a third seat the roster has not: nothing', claim(entry(), [(() => { const d = H.rec(0xB1, 10, 0x31601, 1, 1, true, [A, B, Z], [500, 300, 100], 0); return { steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) }; })()]) === null);
  T('two writers: nothing (the normal settle owns it)', claim(entry(), [res(B, 1, [A, B]), res(A, 0, [A, B])]) === null);
  T('his two records disagree on the scores: nothing', claim(entry(), [res(B, 1, [A, B]), res(B, 1, [A, B], 0, [500, 301])]) === null);
  T('written from a seat the roster gives somebody else: nothing', claim(entry(), [res(B, 0, [B, A])]) === null);
  T('not a friends\' room (quick): nothing', claim(entry({ mt: 1 }), [(() => { const d = H.rec(0xB1, 1, 0x31601, 1, 1, true, [A, B], [500, 300], 0); return { steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) }; })()]) === null);
  {
    // one human and a bot: the bot's seat is no roster seat, so the roster is his alone at seat 0 and his record (two
    //   seats, past the sanity screen's player count) names it -- the only check that stops it is "no other seat"
    const d = H.rec(0xB1, 10, 0x31601, 0, 1, true, [B, '0'], [500, 100], 0);
    const r = { steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) };
    T('one human and a bot: the record names him alone and passes the sanity screen', J(Object.keys(r.roster)) === '["0"]' && !v.sanityFlags([r]).length, J(r.roster) + ' ' + J(v.sanityFlags([r])));
    T('one human and a bot (no other roster seat): nothing', claim(entry({ roster: { 0: v.pid(B) }, started: [v.pid(B)], settled: [v.pid(B)] }), [r]) === null);
  }
  // three humans: one wrote, the two others started and wrote nothing -> claims too
  {
    const d = H.rec(0xB1, 10, 0x31601, 2, 1, true, [A, X, B], [100, 200, 500], 0);
    const g3 = [{ steamID: B, shard: 's0', d, dispCode: 0, disp: 'finished', roster: v.decodeRoster(d) }];
    const p3 = entry({ roster: { 0: v.pid(A), 1: v.pid(X), 2: v.pid(B) }, started: [v.pid(A), v.pid(X), v.pid(B)] });
    T('three humans, the two others started and wrote nothing: claims', !!claim(p3, g3));
    T('three humans, one of the others never started: nothing', claim(Object.assign({}, p3, { started: [v.pid(A), v.pid(B)] }), g3) === null);
  }
  // the verdict pass: stamps, waits, pays, forgets
  {
    const pend = { [KEY]: entry() };
    const groups = { [KEY]: g };
    const run = (now, complete, ck) => v.privateLoneVerdicts(pend, groups, new Set(), ck || new Set(), now, {}, new Set(), complete, vecOf);
    const r1 = run(1000, true);
    T('first sight: waiting, stamped (p.pl), no absence stamp yet', r1.waiting === 1 && !r1.due.length && pend[KEY].pl === 1000 && pend[KEY].absentAt === undefined, J(r1) + ' ' + J(pend[KEY]));
    const r2 = run(1000 + v.PRIVATE_LONE.WAIT_MS - 1, true);
    T('a millisecond short of the wait: still waiting', r2.waiting === 1 && !r2.due.length && pend[KEY].pl === 1000);
    const r3 = run(1000 + v.PRIVATE_LONE.WAIT_MS, false);
    T('due on an incomplete read: held, still no absence stamp', r3.held === 1 && !r3.due.length && pend[KEY].absentAt === undefined, J(pend[KEY]));
    const r4 = run(1000 + v.PRIVATE_LONE.WAIT_MS, true);
    T('due on a complete read: the group, marked pvLone', r4.due.length === 1 && r4.due[0].pvLone === true && r4.due[0].m === KEY && r4.due[0].g === g && r4.due[0].void === false, J(r4.due.map((x) => x.m)));
    T('due on a complete read: the absence stamp set to p.pl (its grace already over)', pend[KEY].absentAt === 1000, J(pend[KEY]));
    {
      const pa = { [KEY]: entry({ absentAt: 777 }) };
      v.privateLoneVerdicts(pa, groups, new Set(), new Set(), 1000, {}, new Set(), true, vecOf);
      v.privateLoneVerdicts(pa, groups, new Set(), new Set(), 1000 + v.PRIVATE_LONE.WAIT_MS, {}, new Set(), true, vecOf);
      T('an absence stamp already there is kept', pa[KEY].absentAt === 777, J(pa[KEY]));
    }
    const r5 = run(2000 + v.PRIVATE_LONE.WAIT_MS, true, new Set([KEY]));
    T('a consistent key (his partner\'s result landed): skipped, nothing due', !r5.due.length && !r5.waiting);
    groups[KEY] = [];
    run(3000 + v.PRIVATE_LONE.WAIT_MS, false);
    T('claim gone on an incomplete read: the stamp is kept', pend[KEY].pl === 1000);
    run(3000 + v.PRIVATE_LONE.WAIT_MS, true);
    T('claim gone on a complete read: the stamp is dropped (the wait starts over)', pend[KEY].pl === undefined);
    groups[KEY] = g; pend[KEY].pl = 9e15;
    run(5000, true);
    T('a stamp from the future restarts the wait', pend[KEY].pl === 5000);
  }
}

// ---- end to end harness ----
const PROGRESS = 5, RATING = 6, POINTS = 7;
const boardsOf = (recs, prog) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
  { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
// steps: [[ms since the previous run, records, env]]; every progress write lands
function run(steps) {
  const prog = {};
  const rs = [];
  let state = null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, prog), state ? H.advance(state, ms) : null, env || null, null, 'q316');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, PROGRESS)) prog[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, prog, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
const xpAfter = (m, i, sid) => { let x = 0; for (let k = 0; k <= i && k < m.rs.length; k++) for (const p of H.postsOf(m.rs[k], PROGRESS, sid)) x = p.score; return x; };
const xpPosts = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, PROGRESS, sid)));
// a friends' room (two players unless ros says more): P0 at seat 0 wins 500 to 300, six levels played; opt.resSc = other
//   scores in the results than in the starts
function room(hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || [500, 300];
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const S = (o.starters || ros.map((_, i) => i)).map((seat) => ({ sid: ros[seat], d: H.rec(0xB2, 10, hash, seat, 0, false, ros, sc) }));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, 10, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, o.resSc || sc, (o.disp || {})[seat] | 0) }));
  return { S, R, key: hash + '_1234_10' };
}
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation and the 5-minute absence grace

// ---- [2] ----
console.log('[2] end to end: two finishers, one finisher, a late second result');
{
  const P0 = H.SID(9611), P1 = H.SID(9612);
  const m = room(0x31611, [P0, P1], [0, 1]);
  const t = run([[0, m.S.concat(m.R)], [STEP, m.S.concat(m.R)], [STEP, m.S.concat(m.R)], [HOUR, m.S.concat(m.R)]]);
  T('control: runs ok', t.okAll, t.out.slice(-1500));
  T('control: two finishers get 104 / 44', xpAfter(t, 3, P0) === 104 && xpAfter(t, 3, P1) === 44, xpAfter(t, 3, P0) + ' / ' + xpAfter(t, 3, P1));
  T('control: no lone-room verdict', !/private-lone/.test(t.out));
}
{
  const P0 = H.SID(9621), P1 = H.SID(9622);
  const m = room(0x31621, [P0, P1], [1]);   // P0 (the winner) closed the game on the results page: only his start is up
  const all = m.S.concat(m.R);
  const W = v.PRIVATE_LONE.WAIT_MS;
  const t = run([[0, all], [STEP, all], [W - 2 * STEP, all], [STEP, all], [STEP, all], [STEP, all], [24 * HOUR, all], [8 * 24 * HOUR, all]]);
  T('one finisher: runs ok', t.okAll, t.out.slice(-1500));
  T('one finisher: nothing for him before the wait', xpAfter(t, 3, P1) === 0, String(xpAfter(t, 3, P1)));
  T('one finisher: the wait is logged', /private-lone .*min until it settles for him alone \(Q316\)/.test(t.rs[2].out));
  T('one finisher: 74 (the base for 6 levels) once the wait is over', xpAfter(t, 5, P1) === 74, String(xpAfter(t, 5, P1)));
  T('one finisher: paid once only (a day and a week later, nothing more)', xpPosts(t, P1).length === 1 && xpAfter(t, 7, P1) === 74, J(xpPosts(t, P1).map((p) => p.score)));
  T('one finisher: the silent seat gets nothing, is never convicted', xpPosts(t, P0).length === 0 && !/start-orphan/.test(t.out));
  T('one finisher: the settle is logged as Q316', /private settle .*one writer, the other seat\(s\) never wrote a result: base XP for him alone, Q316/.test(t.out));
  T('one finisher: summary row', /friends' rooms only one player wrote a result for/.test(t.rs[5].summary));
}
{
  const P0 = H.SID(9631), P1 = H.SID(9632);
  const m = room(0x31631, [P0, P1], [0, 1]);
  const early = m.S.concat(m.R.filter((r) => r.sid === P1));
  const full = m.S.concat(m.R);
  // P0's result lands 1 h 50 min after P1's (his client's resend, inside its 2-hour window); the job runs every 20 minutes
  //   in between, so a wait shorter than the client's window would have settled the key for P1 alone first
  const gap = [];
  for (let i = 0; i < 5; i++) gap.push([20 * MIN, early]);
  const t = run([[0, early], [STEP, early]].concat(gap, [[110 * MIN - STEP - 100 * MIN, full], [STEP, full], [STEP, full], [4 * HOUR, full], [24 * HOUR, full]]));
  T('late second result: runs ok', t.okAll, t.out.slice(-1500));
  T('late second result: nothing paid before it landed', xpAfter(t, 6, P0) === 0 && xpAfter(t, 6, P1) === 0, xpAfter(t, 6, P0) + ' / ' + xpAfter(t, 6, P1));
  T('late second result: the normal 104 / 44', xpAfter(t, 11, P0) === 104 && xpAfter(t, 11, P1) === 44, xpAfter(t, 11, P0) + ' / ' + xpAfter(t, 11, P1));
  T('late second result: each paid once, no lone-room settle', xpPosts(t, P0).length === 1 && xpPosts(t, P1).length === 1 && !/settles for him alone, base XP/.test(t.out), J([xpPosts(t, P0), xpPosts(t, P1)].map((x) => x.map((p) => p.score))));
}

// ---- [3] ----
console.log('[3] end to end: nothing for');
{
  const P0 = H.SID(9641), P1 = H.SID(9642);
  const m = room(0x31641, [P0, P1], [1], { disp: { 1: 1 } });   // P0 left mid-match, P1's result says peers-gone
  const all = m.S.concat(m.R);
  const t = run([[0, all], [STEP, all], [4 * HOUR, all], [STEP, all], [24 * HOUR, all]]);
  T('peers-gone: runs ok', t.okAll, t.out.slice(-1500));
  T('peers-gone: nothing, as before (Q195)', xpPosts(t, P1).length === 0 && !/private-lone/.test(t.out), J(xpPosts(t, P1)));
}
{
  const P0 = H.SID(9651), P1 = H.SID(9652);
  const m = room(0x31651, [P0, P1], [1], { starters: [1] });   // P0 never wrote a start
  const all = m.S.concat(m.R);
  const t = run([[0, all], [STEP, all], [4 * HOUR, all], [STEP, all], [24 * HOUR, all]]);
  T('no start of the other seat: runs ok', t.okAll, t.out.slice(-1500));
  T('no start of the other seat: nothing (one start registers no roster)', xpPosts(t, P1).length === 0 && !/private-lone/.test(t.out));
}
{
  const P0 = H.SID(9661), P1 = H.SID(9662), J1 = H.SID(9663);
  const m = room(0x31661, [P0, P1], [1]);
  const outside = { sid: J1, d: H.rec(0xB2, 10, 0x31661, 0, 0, false, [J1, P1], [500, 300]) };   // an outside account starts from P0's seat
  const all = m.S.concat(m.R, [outside]);
  const t = run([[0, all], [STEP, all], [4 * HOUR, all], [STEP, all], [24 * HOUR, all]]);
  T('outside start from the silent seat: runs ok', t.okAll, t.out.slice(-1500));
  T('outside start from the silent seat: nobody paid (the key is contested)', xpPosts(t, P1).length === 0 && xpPosts(t, J1).length === 0 && !/settles for him alone, base XP/.test(t.out));
}

{
  const P0 = H.SID(9681), P1 = H.SID(9682);
  const m = room(0x31681, [P0, P1], [1], { resSc: [500, 5000000] });   // the stayer's result carries a score past the cap
  const all = m.S.concat(m.R);
  const t = run([[0, all], [STEP, all], [v.PRIVATE_LONE.WAIT_MS, all], [STEP, all], [24 * HOUR, all]]);
  T('his result fails the sanity screen: runs ok', t.okAll, t.out.slice(-1500));
  T('his result fails the sanity screen: not paid, not flagged, no lone-room verdict (as today)', xpPosts(t, P1).length === 0 && !/sanity-flagged/.test(t.out) && !/private-lone/.test(t.out), J(xpPosts(t, P1)));
}

// ---- [4] ----
console.log('[4] an incomplete read at the due time');
{
  const P0 = H.SID(9671), P1 = H.SID(9672);
  const m = room(0x31671, [P0, P1], [1]);
  const all = m.S.concat(m.R);
  const W = v.PRIVATE_LONE.WAIT_MS;
  const FAIL = { STUB_FAIL: JSON.stringify({ shard_40: 503 }) };
  const t = run([[0, all], [STEP, all], [W + STEP, all, FAIL], [STEP, all], [STEP, all], [24 * HOUR, all]]);
  T('incomplete read: runs ok', t.okAll, t.out.slice(-1500));
  T('incomplete read: held, nothing paid that run', xpAfter(t, 2, P1) === 0 && /private-lone .*due, held \(incomplete shard read\)/.test(t.rs[2].out), t.rs[2].out.split('\n').filter((l) => /private-lone|shard/.test(l)).join(' | '));
  T('incomplete read: the next complete reads pay 74, once', xpAfter(t, 5, P1) === 74 && xpPosts(t, P1).length === 1, J(xpPosts(t, P1).map((p) => p.score)));
}

// ---- [5] ----
console.log('[5] a room of three, the two other results late one after the other (Q316 review R6)');
{
  const A = H.SID(9691), B = H.SID(9692), C = H.SID(9693);
  const m = room(0x31691, [A, B, C], [0, 1, 2], { sc: [500, 300, 200] });
  const rOf = (sid) => m.R.filter((r) => r.sid === sid);
  const s0 = m.S, s1 = m.S.concat(rOf(A)), s2 = s1.concat(rOf(B)), s3 = s2.concat(rOf(C));
  // the starts are read first, A's result 20 minutes later; B's lands about 45 minutes after A's (a resend, past the
  //   60-minute wait for the match), C's one run (5 minutes) after B's -- inside the 5-minute absence grace that starts
  //   on the run the room turns consistent
  const steps = [[0, s0], [20 * MIN, s1]];
  for (let k = 0; k < 8; k++) steps.push([5 * MIN, s1]);
  steps.push([5 * MIN, s2], [5 * MIN, s3], [5 * MIN, s3], [HOUR, s3], [24 * HOUR, s3]);
  const t = run(steps);
  const pa = xpPosts(t, A).map((p) => p.score), pb = xpPosts(t, B).map((p) => p.score), pc = xpPosts(t, C).map((p) => p.score);
  T('three, two late: runs ok', t.okAll, t.out.slice(-1500));
  T('three, two late: A waited alone for a while (the lone claim held, then let go)', /private-lone .*min until it settles for him alone/.test(t.out));
  T('three, two late: all three paid once, as today (104 / 74 / 44)', J([pa, pb, pc]) === J([[104], [74], [44]]), J([pa, pb, pc]));
  T('three, two late: no lone-room settle', !/settles for him alone, base XP/.test(t.out));
}

console.log(failN ? '\nprivate-lone-stayer: ' + failN + ' FAILED' : '\nprivate-lone-stayer: all ok');
process.exit(failN ? 1 : 0);
