'use strict';
// O181 matchmade win streak in the settle (client knife 5.4b3, 2026-10-20). Rules: streak-plan.js (test/streak-plan-fixtures.js);
// this file pins the settle's wiring:
//   [1] the gate is on for the full game's job (no PT_MODE); the boost takes the streak tier inside the same percentage
//   [2] creditXp: three wins in a row -> +5 % on the second, +10 % on the third, nothing on a loss; the state and the tail follow
//   [3] creditXp without the streak argument (a direct caller): no state, the old gains
//   [4] freezes: an innocent end and a peers-gone end move nothing and earn no tier
//   [5] team match: a loss with an absent teammate freezes, a loss with the team whole zeroes, an absent opponent changes nothing
//   [6] out of order: a loss that STARTED before two wins settles after them and zeroes nothing
//   [7] absences: the week's first freezes (and is remembered), the second breaks, a pardon turns it into a freeze and gives
//       the grant back; streakApplyEarly applies a run's early events in order
//   [8] the published block: 41 ints without a streak state (unchanged), 45 with one; the v1 reader ([2..4]) and the matrix
//       header are untouched, the tail reads back after the matrix
//   [9] the playtest / demo jobs (PT_MODE=1): no state, no tier, no tail (a child process)
// Over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js):
//   [10] ranked 1V1: A's loss starts first but its results come in last; A wins three matches meanwhile: the second and third
//        wins carry the tier, the late loss zeroes nothing, A's xp row publishes streak 3 (best 3)
//   [11] a confession in a run with no settle (the early return): the break lands in the XP state file
//   [12] an absence convicted at a settle: the week's first freezes and his row is rewritten with the tail (same score);
//        the next one within the week breaks
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const SP = require(path.join(H.ROOT, 'streak-plan.js'));
const supporters = require(path.join(H.ROOT, 'supporters.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const NOW = Date.UTC(2027, 0, 15, 12, 0, 0);
const TODAY = Math.floor(NOW / DAY);

console.log('=== matchmade win streak in the settle (O181) ===');
// ---- [1] ----
T('[1] the gate is on for the full game\'s job', v.V54B3_STREAK === true && v.streakPlan === SP);
T('[1] the boost takes the streak tier inside the same percentage (level 25 = 15 %, + supporter 10 %, + streak 10 %)',
  v.xpBoostMult(25, true, 10) === supporters.xpMult(15 + 10, true) && v.xpBoostMult(25, true, 10) === 1 + (15 + 10 + 10) / 100 && v.xpBoostMult(25, true) === v.xpBoostMult(25, true, 0));
T('[1] a negative or junk tier adds nothing', v.xpBoostMult(5, false, -7) === v.xpBoostMult(5, false) && v.xpBoostMult(5, false, 'x') === v.xpBoostMult(5, false));

const A = H.SID(9101), B = H.SID(9102), C = H.SID(9103), D = H.SID(9104);
const mkRec = (seat, dispCode, sid, mh) => { const d = []; d[3] = mh | 0; d[5] = seat; return { d, dispCode, steamID: sid }; };
// one settle of a 1V1 (mt) between x (seat 0) and y (seat 1): winner = rank 1
function settle1v1(st, x, y, xWins, mh, t0, opt) {
  const o = opt || {};
  const g = [mkRec(0, o.dispX | 0, x, mh), mkRec(1, o.dispY | 0, y, mh)];
  const rankOf = { [x]: xWins ? 1 : 2, [y]: xWins ? 2 : 1 };
  const before = Object.assign({}, st.xp);
  v.creditXp(g, o.mt || 2, xWins ? [5000, 3000] : [3000, 5000], rankOf, st.xp, st.changed, st.xpState, {}, TODAY, 1, st.det, null,
    o.noSk ? undefined : { t0, nowMs: o.now || NOW, absentSeats: new Set() });
  return { gx: (st.xp[x] | 0) - (before[x] | 0), gy: (st.xp[y] | 0) - (before[y] | 0) };
}
const fresh = () => ({ xp: {}, changed: {}, xpState: {}, det: {} });
const lvlOf = (xpv) => v.xpLevelOf(xpv | 0);
const want = (cls, rank0, money, first, lvl, pct) => v.computeXpGain(cls, rank0, money, true, first, 1, v.xpBoostMult(lvl, false, pct));
// ---- [2] ----
{
  const s = fresh();
  const x0 = 0;
  const g1 = settle1v1(s, A, B, true, 101, NOW - 50 * MIN);
  const x1 = s.xp[A];
  const g2 = settle1v1(s, A, B, true, 102, NOW - 30 * MIN);
  const x2 = s.xp[A];
  const g3 = settle1v1(s, A, B, true, 103, NOW - 10 * MIN);
  T('[2] first win: no tier (streak 1), daily first win as before', g1.gx === want('valid', 0, 5000, true, lvlOf(x0), 0), g1.gx + ' vs ' + want('valid', 0, 5000, true, lvlOf(x0), 0));
  T('[2] second win: +5 % (streak 2)', g2.gx === want('valid', 0, 5000, false, lvlOf(x1), 5) && g2.gx !== want('valid', 0, 5000, false, lvlOf(x1), 0), g2.gx + ' vs ' + want('valid', 0, 5000, false, lvlOf(x1), 5));
  T('[2] third win: +10 % (streak 3)', g3.gx === want('valid', 0, 5000, false, lvlOf(x2), 10), g3.gx + ' vs ' + want('valid', 0, 5000, false, lvlOf(x2), 10));
  T('[2] the loser earns no tier', [g1, g2, g3].every((g) => g.gy > 0) && g2.gy === want('valid', 1, 3000, false, lvlOf(s.xp[B] - g3.gy - g2.gy), 0));
  const ca = SP.current(s.xpState[v.pid(A)].sk), cb = SP.current(s.xpState[v.pid(B)].sk);
  T('[2] state: A streak 3 (best 3, last match 103), B 0', ca.cur === 3 && ca.best === 3 && ca.mh === 103 && cb.cur === 0 && cb.best === 0, J(ca) + ' ' + J(cb));
  const tail = SP.tailOf(s.det[A], 41);
  T('[2] the career block creditXp built carries the tail (streak 3)', s.det[A].length === 45 && tail && tail.cur === 3 && tail.best === 3 && tail.mh === 103, J(s.det[A]));
  // a fourth: a loss zeroes, no tier
  const g4 = settle1v1(s, A, B, false, 104, NOW - 5 * MIN);
  T('[2] a loss zeroes the streak (best stays 3)', SP.current(s.xpState[v.pid(A)].sk).cur === 0 && SP.current(s.xpState[v.pid(A)].sk).best === 3 && g4.gx > 0);
}
// ---- [3] ----
{
  const s = fresh(), s2 = fresh();
  settle1v1(s, A, B, true, 201, NOW - 40 * MIN, { noSk: true });
  const g2 = settle1v1(s, A, B, true, 202, NOW - 20 * MIN, { noSk: true });
  settle1v1(s2, A, B, true, 201, NOW - 40 * MIN);
  const g2s = settle1v1(s2, A, B, true, 202, NOW - 20 * MIN);
  T('[3] without the streak argument: no state, the old gain (no tier)', !s.xpState[v.pid(A)].sk && g2.gx === want('valid', 0, 5000, false, lvlOf(s.xp[A] - g2.gx), 0) && g2s.gx > g2.gx);
  T('[3] ... and the block has no tail (41 ints)', s.det[A].length === 41);
}
// ---- [4] ----
{
  const s = fresh();
  settle1v1(s, A, B, true, 301, NOW - 60 * MIN);
  settle1v1(s, A, B, true, 302, NOW - 50 * MIN);
  const xi = s.xp[A];
  const gi = settle1v1(s, A, B, true, 303, NOW - 40 * MIN, { dispX: 2, dispY: 2 });   // host-left: innocent
  T('[4] an innocent end: frozen (streak 2 kept), base only, no tier', SP.current(s.xpState[v.pid(A)].sk).cur === 2 && gi.gx === v.computeXpGain('innocent', 0, 5000, true, false, 1, v.xpBoostMult(lvlOf(xi), false, 0)));
  const xp1 = s.xp[A];
  const gp = settle1v1(s, A, B, true, 304, NOW - 30 * MIN, { dispX: 1 });   // peers-gone: valid, the lone survivor's end
  T('[4] a peers-gone end: frozen (streak 2), the valid gain without a tier', SP.current(s.xpState[v.pid(A)].sk).cur === 2 && gp.gx === want('valid', 0, 5000, false, lvlOf(xp1), 0));
  const xp2 = s.xp[A];
  const g3 = settle1v1(s, A, B, true, 305, NOW - 20 * MIN);
  T('[4] the next win continues from 2 -> 3 (+10 %)', SP.current(s.xpState[v.pid(A)].sk).cur === 3 && g3.gx === want('valid', 0, 5000, false, lvlOf(xp2), 10));
  T('[4] the freezes are events (k 0) of their own matches', s.xpState[v.pid(A)].sk.e.filter((e) => e[2] === 0).map((e) => e[1]).join(',') === '303,304');
}
// ---- [5] team ----
{
  // ranked mode-2 2V2 (mt 6): seats 0,1 = team 0, seats 2,3 = team 1; team 1 wins (ranks 1, 2)
  const teamSettle = (s, mh, t0, absent, present) => {
    const g = present.map((seat) => mkRec(seat, 0, [A, B, C, D][seat], mh));
    const rankOf = { [A]: 3, [B]: 4, [C]: 1, [D]: 2 };
    v.creditXp(g, 6, [100, 90, 200, 190], rankOf, s.xp, s.changed, s.xpState, {}, TODAY, 1, s.det, null, { t0, nowMs: NOW, absentSeats: new Set(absent) });
  };
  const s = fresh();
  for (const sid of [A, B, C, D]) s.xpState[v.pid(sid)] = { lastWinDay: 0, games: 0, sk: { p: 2, b: 2 } };
  teamSettle(s, 401, NOW - 30 * MIN, [1], [0, 2, 3]);   // A's teammate B (seat 1) absent; A's team loses
  const cur = (sid) => SP.current(s.xpState[v.pid(sid)].sk).cur;
  T('[5] a loss with an absent teammate: frozen (2 kept)', cur(A) === 2);
  T('[5] the winners whose opponent is absent: +1 (3)', cur(C) === 3 && cur(D) === 3);
  T('[5] the absent seat itself gets nothing from creditXp', cur(B) === 2 && !SP.norm(s.xpState[v.pid(B)].sk).e.length);
  teamSettle(s, 402, NOW - 10 * MIN, [], [0, 1, 2, 3]);
  T('[5] a loss with the team whole zeroes (A 0, B 0), the winners go on (4)', cur(A) === 0 && cur(B) === 0 && cur(C) === 4 && cur(D) === 4);
}
// ---- [6] out of order ----
{
  const s = fresh();
  settle1v1(s, A, B, true, 501, NOW - 40 * MIN);
  settle1v1(s, A, B, true, 502, NOW - 20 * MIN);
  settle1v1(s, A, B, false, 500, NOW - 60 * MIN);   // started first, settles last
  const c = SP.current(s.xpState[v.pid(A)].sk);
  T('[6] a loss that started before two wins and settles after them zeroes nothing (2)', c.cur === 2 && c.best === 2, J(s.xpState[v.pid(A)].sk));
  T('[6] the late event counted', (v.streakPlan && true) && J(s.xpState[v.pid(A)].sk.e.map((e) => e[1])) === J([500, 501, 502]));
}
// ---- [7] absences + early events ----
{
  const xs = {};
  const p = v.pid(A);
  xs[p] = { lastWinDay: 0, games: 0, sk: { p: 4, b: 4 } };
  const r1 = v.streakAbsence(xs, p, NOW - 3 * HOUR, 601, NOW - 2 * HOUR);
  T('[7] the week\'s first absence freezes (4 kept), the grant remembered', r1 && SP.current(xs[p].sk).cur === 4 && xs[p].sk.f.length === 1 && xs[p].sk.f[0][1] === 601);
  const r2 = v.streakAbsence(xs, p, NOW - 2 * HOUR, 602, NOW - HOUR);
  T('[7] the second within the week breaks (0)', r2 && SP.current(xs[p].sk).cur === 0);
  const r3 = v.streakAbsence(xs, p, NOW - 3 * HOUR, 601, NOW);
  T('[7] the same absence asked again keeps its first answer (still a freeze)', xs[p].sk.e.find((e) => e[1] === 601)[2] === 0 && r3);
  T('[7] a pardon: the break turns into a freeze, the grant comes back only for its own match', v.streakPardon(xs, p, 602) && xs[p].sk.e.find((e) => e[1] === 602)[2] === 0 && SP.current(xs[p].sk).cur === 4 && xs[p].sk.f.length === 1);
  T('[7] a pardon of a match with no event moves nothing', v.streakPardon(xs, p, 777) === false && v.streakPardon({}, p, 601) === false);
  const ys = { [p]: { lastWinDay: 0, games: 0, sk: { p: 3, b: 3 } } };
  const n = v.streakApplyEarly(ys, [{ p, mh: 701, t0: NOW - 2 * HOUR, kind: 'absence' }, { p, mh: 702, t0: NOW - HOUR, kind: 'break' }, { p, mh: 999, kind: 'nonsense' }, { p, mh: 701, kind: 'pardon' }], NOW);
  T('[7] streakApplyEarly applies absence / break / pardon in order and skips an unknown kind', n === 3 && J(ys[p].sk.e.map((e) => [e[1], e[2]])) === J([[701, 0], [702, 3]]) && SP.current(ys[p].sk).cur === 0 && ys[p].sk.f.length === 0);
  const zs = {};
  v.streakApplyEarly(zs, [{ p: 'newpid', mh: 1, t0: NOW, kind: 'break' }], NOW);
  T('[7] an early event of a player with no XP state yet creates it', zs.newpid && zs.newpid.sk && zs.newpid.sk.e.length === 1);
}
// ---- [8] the published block ----
{
  const st = { cg: 3, cw: 2, cl: 1, cm: { '1:2': [3, 900, 2, 1] } };
  const b0 = v.careerBlockOf(st);
  T('[8] no streak state: 41 ints, as before', b0.length === 41);
  const b1 = v.careerBlockOf(Object.assign({}, st, { sk: { p: 5, b: 7, l: 42 } }));
  T('[8] with a streak state: 45 ints, the first 41 identical', b1.length === 45 && J(b1.slice(0, 41)) === J(b0));
  T('[8] the tail reads back after the matrix (streak 5, best 7, last match 42)', J(SP.tailOf(b1, 41)) === J({ ver: 1, cur: 5, best: 7, mh: 42 }));
  T('[8] a deployed client\'s v1 read ([2..4]) and the matrix header are untouched', b1[0] === v.CAREER_MAGIC && b1[2] === 3 && b1[3] === 2 && b1[4] === 1 && (b1[5] & 0xff) === v.CAREER_MATRIX_MAGIC);
  T('[8] room left under the 64-int details cap', b1.length <= 64);
}
// ---- [9] the playtest / demo jobs ----
{
  const code = [
    "process.env.PT_MODE = '1'; process.env.STATE_SALT = 's';",
    "const v = require(" + J(H.VALIDATE) + ");",
    "const g = [{ d: [0, 0, 2, 9, 0, 0], dispCode: 0, steamID: '76561198000000001' }, { d: [0, 0, 2, 9, 0, 1], dispCode: 0, steamID: '76561198000000002' }];",
    "const xs = {}, xp = {}, det = {};",
    "v.creditXp(g, 2, [5, 3], { '76561198000000001': 1, '76561198000000002': 2 }, xp, {}, xs, {}, 1, 1, det, null, { t0: 1, nowMs: 2, absentSeats: new Set() });",
    "v.creditXp(g, 2, [5, 3], { '76561198000000001': 1, '76561198000000002': 2 }, xp, {}, xs, {}, 1, 1, det, null, { t0: 3, nowMs: 4, absentSeats: new Set() });",
    "const st = xs[v.pid('76561198000000001')];",
    "console.log(JSON.stringify({ gate: v.V54B3_STREAK, sk: st.sk || null, len: det['76561198000000001'].length, ab: v.streakAbsence(xs, 'p', 1, 2, 3), early: v.streakApplyEarly(xs, [{ p: 'p', mh: 1, t0: 1, kind: 'break' }], 5) }));",
  ].join('\n');
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', cwd: path.join(__dirname, '..'), env: Object.assign({}, process.env, { PT_MODE: '1' }), timeout: 60000 });
  let o = null;
  try { o = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (e) {}
  T('[9] PT_MODE=1: the gate is off, no state after two wins, a 41-int block, absences and early events move nothing', !!o && o.gate === false && o.sk === null && o.len === 41 && o.ab === null && o.early === 0, (r.stdout || '').slice(-300) + (r.stderr || '').slice(-300));
}

// ================= end to end =================
const RATING = 6, POINTS = 7, PROGRESS = 5;
const GRACE = (v.ABSENT_GRACE_MS || 300000) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN;
// the streak state's minutes ride the test clock like the starts do (H.advance moves the starts' t0 into the past)
function advance(state, ms) {
  const files = H.advance(state, ms);
  const dm = Math.round(ms / MIN);
  const xs = files.XP_FILE;
  if (xs) for (const k of Object.keys(xs)) {
    const sk = xs[k] && xs[k].sk;
    if (!sk) continue;
    if (Array.isArray(sk.e)) for (const e of sk.e) e[0] -= dm;
    if (Array.isArray(sk.f)) for (const f of sk.f) f[0] -= dm;
    if (sk.h) sk.h -= dm;
  }
  return files;
}
const boardsOf = (recs, prog, pts) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
  { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: Object.keys(pts || {}).map((s) => ({ steamID: s, score: pts[s], details: [] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
// steps: [[ms since the previous run, records]]; prog: { sid: { score, details } } carried run to run (every progress write lands)
function run(steps, prog0, files0, pts0) {
  const prog = JSON.parse(J(prog0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, prog, pts0), state ? advance(state, ms) : (files0 || null), null, null, 'streak');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, PROGRESS)) prog[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], prog, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// a ranked FFA / 1V1 (mt) on seats ros, scores descending by seat unless sc; `res` = seats writing a result
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, (o.disp || {})[seat] | 0) }));
  return { S, R, key: hash + '_1234_' + mt, mh: hash | 0 };
}
const xpWrites = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, PROGRESS, sid)));
const settledKeys = (m) => new Set(m.last.state.PROCESSED_FILE || []);
const skOf = (r, sid) => { const e = (r.state.XP_FILE || {})[v.pid(sid)]; return e && e.sk ? e.sk : null; };

// ---- [10] ----
{
  const E = H.SID(9201), F = H.SID(9202), G = H.SID(9203);
  const L = match(2, 0x5B301, [G, E], [0, 1]);   // E loses to G -- starts first, results come in last
  const W1 = match(2, 0x5B302, [E, F], [0, 1]);   // E beats F
  const W2 = match(2, 0x5B303, [E, F], [0, 1]);
  const W3 = match(2, 0x5B304, [E, F], [0, 1]);
  let recs = [];
  const add = (...xs) => { for (const x of xs) recs = recs.concat(x); return recs.slice(); };
  // every step 7 minutes (the 5-minute start age and the one-match-at-a-time gap with margin: a fake-clock run of the suite
  //   gives each cron process the same instant, so a step exactly at 5 minutes flips on milliseconds)
  const m = run([
    [0, add(L.S)],
    [7 * MIN, add(W1.S)],
    [7 * MIN, add(W1.R)],
    [7 * MIN, add(W2.S)],
    [7 * MIN, add(W2.R)],
    [7 * MIN, add(W3.S)],
    [7 * MIN, add(W3.R)],
    [7 * MIN, add(L.R)],
  ], {});
  const done = settledKeys(m);
  T('[10] every match settled', m.okAll && [L, W1, W2, W3].every((x) => done.has(x.key)), m.out.slice(-800));
  const w = xpWrites(m, E);
  T('[10] E\'s xp row written at each of its four settles', w.length === 4, J(w.map((x) => x.score)));
  if (w.length === 4) {
    const g1 = w[0].score, g2 = w[1].score - w[0].score, g3 = w[2].score - w[1].score;
    T('[10] win 1: no tier (daily first win)', g1 === want('valid', 0, 6000, true, 0, 0), g1 + ' vs ' + want('valid', 0, 6000, true, 0, 0));
    T('[10] win 2: +5 %', g2 === want('valid', 0, 6000, false, lvlOf(w[0].score), 5), g2 + ' vs ' + want('valid', 0, 6000, false, lvlOf(w[0].score), 5));
    T('[10] win 3: +10 %', g3 === want('valid', 0, 6000, false, lvlOf(w[1].score), 10), g3 + ' vs ' + want('valid', 0, 6000, false, lvlOf(w[1].score), 10));
    const t3 = SP.tailOf(w[2].details, 41), t4 = SP.tailOf(w[3].details, 41);
    T('[10] after win 3 the row publishes streak 3', t3 && t3.cur === 3 && t3.best === 3 && t3.mh === W3.mh, J(t3));
    T('[10] the loss that started first settles last and zeroes nothing: the row still publishes 3', t4 && t4.cur === 3 && t4.best === 3 && t4.mh === W3.mh, J(t4));
    T('[10] its settle logged the loss as a late event', /streak l0/.test(m.rs[7].out) && /streak w3 \+10%/.test(m.rs[6].out), m.rs[7].out.slice(-400));
  }
  const skF = skOf(m.last, F);
  T('[10] F lost three: streak 0', skF && SP.current(skF).cur === 0);
}
// ---- [11] a confession in a run with no settle ----
{
  const P = H.SID(9211), Q = H.SID(9212);
  const mm = match(2, 0x5B311, [P, Q], [0]);
  const conf = { sid: Q, d: H.rec(0xB5, 2, 0x5B311, 1, 0, false, [P, Q], [6000, 5000], 5) };   // Q quits (user-quit)
  const files0 = { XP_FILE: { [v.pid(Q)]: { lastWinDay: 0, games: 4, sk: { p: 3, b: 3 } } } };
  const m = run([[0, mm.S], [7 * MIN, mm.S.concat([conf])]], {}, files0);
  const sk = skOf(m.last, Q);
  T('[11] the run returned early (no settle group)', /no (consistent|fresh) match/.test(m.last.out), m.last.out.slice(-400));
  T('[11] the break landed in the XP state file (3 -> 0), sorted at the match\'s start', sk && SP.current(sk).cur === 0 && sk.e.length === 1 && sk.e[0][1] === mm.mh && sk.e[0][2] === 3, J(sk));
  T('[11] logged', /streak: 1 early event\(s\) written to the XP state/.test(m.last.out));
}
// ---- [12] an absence convicted at a settle ----
{
  const X = H.SID(9221), Y = H.SID(9222), Z = H.SID(9223);
  const mm = match(2, 0x5B321, [X, Y, Z], [0, 1]);   // Z writes his start and leaves
  const steps = [[0, mm.S], [7 * MIN, mm.S.concat(mm.R)], [GRACE, mm.S.concat(mm.R)], [LEAVE, mm.S.concat(mm.R)], [3 * HOUR, mm.S.concat(mm.R)]];
  const prog0 = { [Z]: { score: 5000, details: [] } };
  const m = run(steps, prog0, { XP_FILE: { [v.pid(Z)]: { lastWinDay: 0, games: 9, cg: 9, cw: 5, cl: 4, sk: { p: 4, b: 4 } } } });
  const sk = skOf(m.last, Z), wz = xpWrites(m, Z);
  T('[12] settled, Z convicted', m.okAll && settledKeys(m).has(mm.key) && /in roster, no record/.test(m.out), m.out.slice(-600));
  T('[12] the week\'s first absence freezes Z (4 kept), the grant remembered', sk && SP.current(sk).cur === 4 && sk.f.length === 1 && sk.e.some((e) => e[1] === mm.mh && e[2] === 0), J(sk));
  T('[12] Z\'s row rewritten, same score, with the tail', wz.length === 1 && wz[0].score === 5000 && (() => { const t = SP.tailOf(wz[0].details, 41); return t && t.cur === 4; })(), J(wz));
  // again within the week: a break
  const mm2 = match(2, 0x5B322, [X, Y, Z], [0, 1]);
  const m2 = run([[0, mm2.S], [7 * MIN, mm2.S.concat(mm2.R)], [GRACE, mm2.S.concat(mm2.R)], [LEAVE, mm2.S.concat(mm2.R)], [3 * HOUR, mm2.S.concat(mm2.R)]],
    m.prog, { XP_FILE: m.last.state.XP_FILE });
  const sk2 = skOf(m2.last, Z), wz2 = xpWrites(m2, Z);
  T('[12] the next absence within the week breaks (0)', sk2 && SP.current(sk2).cur === 0 && sk2.e.some((e) => e[1] === mm2.mh && e[2] === 3), J(sk2));
  T('[12] ... and the rewritten row publishes 0', wz2.length === 1 && (() => { const t = SP.tailOf(wz2[0].details, 41); return t && t.cur === 0 && t.best === 4; })(), J(wz2));
}

console.log(failN ? ('streak: ' + failN + ' FAIL') : 'streak: all ok');
process.exit(failN ? 1 : 0);
