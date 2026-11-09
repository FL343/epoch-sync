'use strict';
// O777 (2026-11-09, user ruling under architecture decision 10): the full game's launch week (EA 2026-11-17, the window to
// 2026-11-24T03:17:00Z in validate.yml) is lenient with leaves on the MAIN channel -- a brand-new anti-cheat chain and the
// first-boot crash of dual-GPU laptops had not met real players, and a hard crash the player cannot come back from within
// the hour is convicted as a leave. test/channel-leaver-record-only.js pins the XP switch per channel; this file pins the rest:
//   [1] the ranked leave fine of the window (leaverLpFineOf): LEAVER_LP_EASY (a whole number 0..LEAVER_LP_PENALTY) until
//       LEAVER_LP_EASY_UNTIL (strict ISO-8601 UTC, at most 31 days ahead), main channel only; anything else = the normal fine.
//       Injected clocks only (the land gates run this file on a next-year clock too).
//   [2] the window leaves (noteLeave marks a leave convicted while the XP switch is on: w [mh, g, 1] + ro): the window never
//       counts them, also after the instant -- the user's example: 3 window leaves in a first 20 matches = x1.0 afterwards
//       (unmarked: x0.5); leaves outside the window count as before; a random history equals a brute-force event list with
//       the window leaves taken out; the list stays bounded; a retraction takes a marked one back (ro too); old-format
//       entries read as before; ro is never read by the factor
//   [3] creditXp after the window (this process: no switch): 3 window leaves cost nothing, 3 plain ones x0.5
//   [4] end to end over the REAL validate.js main() on the main channel, a ranked 3-player match where I leaves: switch on =
//       fined 50 (receipt -50, ded 50), G (two earlier leaves) credited in full, I's leave marked; the switch past / the fine
//       malformed / nothing set = fined 100 (marked only while the XP switch is on). Then the window over, a quick 1V1 I
//       finishes: credited in full after the window cell (his marked leave uncounted), x0.5 after the plain cell.
//   [5] end to end, a ranked confession inside the window: fined 50 at first sight, and coming back to finish gives back
//       exactly the 50 taken (not 100)
//   [6] source: every leave fine goes through LEAVER_LP_FINE (a new site cannot read LEAVER_LP_PENALTY directly);
//       points-plan.js untouched (its default stays the normal fine)
//   [7] mutations, each turning its check red: the fine never expires / the expiry reversed / the fine on another channel /
//       a fine above the normal one taken / the mark not read (window leaves counted after the window) / the mark not
//       written (the conviction sites) / the conviction fine and the confession fine back on LEAVER_LP_PENALTY
const assert = require('assert');
const fs = require('fs'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const VFILE = H.VALIDATE, VSRC = H.SRC;
const v = require(VFILE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));

let failN = 0, n = 0;
const ok = (m) => { n++; console.log('  ok    ' + m); };
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const U = (label, fn) => { try { fn(v, VSRC); ok(label); } catch (e) { bad(label + ' -- ' + (e && e.message)); } };
const J = JSON.stringify;
const W = v.LEAVER_XP.window;

// ---------------- [1] the launch-week ranked fine ----------------
const NOW = Date.parse('2026-11-17T00:00:00Z'), END = Date.parse('2026-11-24T03:17:00Z'), ENDS = '2026-11-24T03:17:00Z';
function check1(vv) {
  const f = (ch, fine, until, base, now) => vv.leaverLpFineOf(ch, fine, until, base == null ? 100 : base, now == null ? NOW : now);
  assert.deepStrictEqual(f('ea', '50', ENDS), { fine: 50, until: END }, 'main, inside the window: 50');
  assert.deepStrictEqual([f('ea', '50', ENDS, 100, END - 1).fine, f('ea', '50', ENDS, 100, END).fine, f('ea', '50', ENDS, 100, END + 1).fine], [50, 100, 100], 'the instant itself and after: the normal fine');
  assert.deepStrictEqual(f('ea', '50', ENDS, 100, END), { fine: 100, until: 0 }, 'past: off');
  assert.deepStrictEqual([f('ea', '0', ENDS).fine, f('ea', ' 50 ', ENDS).fine, f('ea', '100', ENDS).fine, f('ea', 50, ENDS).fine], [0, 50, 100, 50], 'whole numbers 0..base');
  for (const x of ['101', '9999', '-5', '5.5', 'fifty', '', null, undefined, '1e2', '0x32', '50 points']) assert.deepStrictEqual(f('ea', x, ENDS), { fine: 100, until: 0 }, 'fine ' + J(x) + ': the normal fine');
  for (const x of ['2026-11-24', '2026-11-24T03:17:00+08:00', '2026-11-24T03:17:00', 'soon', '', null, '2026-13-45T00:00:00Z']) assert.strictEqual(f('ea', '50', x).fine, 100, 'until ' + J(x) + ': the normal fine');
  const MAX = vv.LEAVER_XP_RECORD_ONLY_MAX_MS;
  assert.strictEqual(f('ea', '50', new Date(NOW + MAX).toISOString(), 100, NOW).fine, 50, 'exactly 31 days ahead: honored');
  assert.strictEqual(f('ea', '50', new Date(NOW + MAX + 1000).toISOString(), 100, NOW).fine, 100, 'past the cap (a typo\'d year): the normal fine');
  assert.strictEqual(f('ea', '50', '2027-11-24T03:17:00Z').fine, 100, 'next year: the normal fine');
  for (const ch of ['demo', 'playtest', null, 'main', 'EA']) assert.deepStrictEqual(f(ch, '50', ENDS), { fine: 100, until: 0 }, 'channel ' + J(ch) + ': the normal fine');
  assert.deepStrictEqual([f('ea', '50', ENDS, 80).fine, f('ea', '90', ENDS, 80).fine], [50, 80], 'an overridden normal fine: never harsher than it');
  assert.strictEqual(vv.leaverSwitchUntil(ENDS, END - 1), END, 'the shared instant reader');
  assert.strictEqual(vv.leaverSwitchUntil(ENDS, END + 1), 0, 'the shared instant reader: past');
}
U('[1] leaverLpFineOf: 50 inside the window on the main channel, the normal fine at / after the instant, malformed, too far ahead or another channel', check1);
U('[1] this test process (nothing set): the fine is LEAVER_LP_PENALTY, the switch off', (vv) => {
  assert.strictEqual(vv.LEAVER_LP_FINE, PP.LEAVER_LP_PENALTY);
  assert.strictEqual(vv.LEAVER_LP_FINE, 100);
  assert.strictEqual(vv.LEAVER_LP_EASY_ON.until, 0);
  assert.strictEqual(vv.LEAVER_XP_RECORD_ONLY, 0);
});

// ---------------- [2] the window leaves ----------------
// a history driven through the cron helpers and a brute-force event list side by side; a window leave is not an event
function sim(vv) {
  const leavers = {}, p = 'p1', events = [];   // brute force: 'G' or { mh, ro }
  let G = 0, mhN = 0;
  return {
    leavers, p, events,
    get G() { return G; },
    leave(ro) { const mh = ++mhN; vv.noteLeave(leavers, p, mh + '_2_1', !!ro); events.push({ mh, ro: !!ro }); return mh; },
    finish() { G++; vv.noteFinish(leavers, p, G); events.push('G'); },
    retract(mh) { vv.unnoteLeave(leavers, p, mh + '_2_1'); const i = events.findIndex((e) => e !== 'G' && e.mh === mh); if (i >= 0) events.splice(i, 1); },
    brute() { const last = events.filter((e) => e === 'G' || !e.ro).slice(-W); const lw = last.filter((e) => e !== 'G').length; return { lw, gw: last.length - lw }; },
    win() { const w = vv.leaverWindowOf(leavers[p], G); return { lw: w.lw, gw: w.gw }; },
    factor() { return vv.leaverFactorOf(leavers[p] || 0, G); },
    e() { return leavers[p]; },
  };
}
function check2a(vv) {
  const L = {};
  vv.noteLeave(L, 'p', '11_2_1', true);
  assert.deepStrictEqual(L.p, { leaves: 1, lastMatch: '11_2_1', w: [[11, 0, 1]], ro: 1 }, 'a window leave: [mh, 0, 1] + ro');
  vv.noteLeave(L, 'p', '12_2_1', false);
  vv.noteLeave(L, 'p', '13_2_1');   // no flag: this run's switch (off in this process)
  assert.deepStrictEqual(L.p.w, [[11, 0, 1], [12, 0], [13, 0]], 'plain leaves: [mh, 0] (the switch off)');
  assert.strictEqual(L.p.ro, 1, 'ro counts the window leaves only');
  assert.strictEqual(L.p.leaves, 3, 'the lifetime count has every convicted leave');
}
U('[2] noteLeave: a window leave is written [mh, 0, 1] with ro; a plain one [mh, 0]', check2a);
function check2b(vv) {
  // the user's example: 3 window leaves in a first 20 matches -> x1.0 after the window; the same 3 plain -> x0.5
  const a = sim(vv), b = sim(vv);
  for (const s of [a, b]) for (let i = 0; i < 20; i++) { if (i % 6 === 2) s.leave(s === a); else s.finish(); }
  assert.strictEqual(a.events.filter((e) => e !== 'G').length, 3, 'fixture: 3 leaves');
  assert.strictEqual(a.G, 17, 'fixture: 17 finishes');
  assert.strictEqual(a.factor(), 1, '3 window leaves in the first 20: x1.0 after the window');
  assert.strictEqual(b.factor(), 0.5, 'the same 3 plain: 3 in 20 -> x0.5');
  assert.deepStrictEqual(a.win(), { lw: 0, gw: 17 }, 'the window sees no leave and no event for them');
  assert.strictEqual(a.e().ro, 3, 'ro: 3');
  // leaves outside the window count as before: the 3 window ones + 3 plain later
  for (let i = 0; i < 3; i++) a.leave(false);
  assert.deepStrictEqual(a.win(), { lw: 3, gw: 17 }, 'the plain ones inside the window');
  assert.strictEqual(a.factor(), 0.5, '3 plain in 20 counted events: x0.5 (with the window ones counted it would be 6 in 23: x0.3)');
  assert.strictEqual(vv.effectiveLeaverFactor(6, 17), 0.3, '(the counted reading)');
}
U('[2] the window leaves are not counted after the window (3 in the first 20: x1.0, plain x0.5); plain leaves count as before', check2b);
function check2c(vv) {
  for (let seed = 1; seed <= 300; seed++) {
    let st = seed >>> 0; const r = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
    const s = sim(vv), mine = [];
    const pRo = [0.1, 0.5, 0.9][seed % 3], pLeave = [0.15, 0.4][seed % 2];
    let retracted = false;
    const steps = 30 + Math.floor(r() * 250);
    for (let k = 0; k < steps; k++) {
      const x = r();
      if (x < pLeave) mine.push(s.leave(r() < pRo));
      else if (x < pLeave + 0.03 && mine.length) { s.retract(mine.splice(Math.floor(r() * mine.length), 1)[0]); retracted = true; }
      else s.finish();
      const a = s.win(), b = s.brute();
      if (!retracted) assert.deepStrictEqual(a, b, 'seed ' + seed + ' step ' + k);
      else assert.ok(a.lw <= b.lw, 'seed ' + seed + ' step ' + k + ': ' + J(a) + ' vs ' + J(b));
      const e = s.e();
      if (e && Array.isArray(e.w)) assert.ok(e.w.length <= W, 'bounded: ' + e.w.length);
      if (!retracted) assert.strictEqual((e && e.ro) | 0, s.events.filter((y) => y !== 'G' && y.ro).length, 'ro = the window leaves');
    }
  }
}
U('[2] the window == a brute-force event list with the window leaves taken out (300 random histories, 10-90% of the leaves in the window; retractions: never more leaves inside); bounded', check2c);
function check2d(vv) {
  // the list's bound with window leaves: the oldest window leave goes first, so 50 plain leaves keep their place
  const s = sim(vv);
  for (let i = 0; i < W; i++) s.leave(false);
  s.leave(true);
  assert.strictEqual(s.e().w.length, W, 'bounded at the window');
  assert.deepStrictEqual(s.win(), s.brute(), 'the 50 plain leaves all still read');
  assert.strictEqual(s.e().w.filter((x) => x[2]).length, 0, 'the window leave was the one dropped');
  const t = sim(vv);
  for (let i = 0; i < 70; i++) { t.leave(true); t.finish(); }
  assert.ok(t.e().w.length <= W, '70 window leaves: bounded');
  assert.deepStrictEqual(t.win(), t.brute(), 'and read as 70 finishes');
  assert.strictEqual(t.factor(), 1);
}
U('[2] the bound: window leaves are dropped first (50 plain leaves keep their place); 70 window leaves stay bounded', check2d);
function check2e(vv) {
  const L = {};
  vv.noteLeave(L, 'p', '21_2_1', true); vv.noteFinish(L, 'p', 1);
  vv.noteLeave(L, 'p', '22_2_1', false); vv.noteFinish(L, 'p', 2);
  vv.noteLeave(L, 'p', '23_2_1', true);
  vv.unnoteLeave(L, 'p', '23_2_1');
  assert.deepStrictEqual([L.p.w, L.p.ro, L.p.leaves], [[[21, 1, 1], [22, 1]], 1, 2], 'a window leave taken back: off the list, ro -1');
  vv.unnoteLeave(L, 'p', '22_2_1');
  assert.deepStrictEqual([L.p.w, L.p.ro, L.p.leaves], [[[21, 2, 1]], 1, 1], 'a plain one: ro unchanged, its finishes to the window leave before it');
  vv.unnoteLeave(L, 'p', '21_2_1');
  assert.deepStrictEqual(L.p, { leaves: 0, lastMatch: '23_2_1', w: [] }, 'the last window leave: ro gone');
}
U('[2] unnoteLeave takes a window leave back (ro too); a plain one leaves ro', check2e);
function check2f(vv) {
  // old format (no w, written before O717 N2): read as before; its first write converts it, a window leave on top
  const O = { p: { leaves: 2, lastMatch: '' } };
  assert.strictEqual(vv.leaverFactorOf(O.p, 0), vv.effectiveLeaverFactor(2, 0), 'old format: the old rule');
  vv.noteLeave(O, 'p', '31_2_1', true);
  assert.deepStrictEqual(O.p, { leaves: 3, lastMatch: '31_2_1', w: [[31, 0, 1]], o: 2, ro: 1 }, 'converted: its old leaves kept as old, the window leave marked');
  assert.strictEqual(vv.leaverFactorOf(O.p, 0), vv.effectiveLeaverFactor(2, 0), 'the old leaves still count, the window one not');
  // 2-element entries (every entry before O777): read as before, a window leave added on top
  const P = { p: { leaves: 2, lastMatch: '', w: [[41, 3], [42, 0]] } };
  const before = vv.leaverWindowOf(P.p, 10);
  assert.deepStrictEqual([before.lw, before.gw], [2, 10], 'a 2-element list: as before');
  vv.noteLeave(P, 'p', '43_2_1', true);
  const after = vv.leaverWindowOf(P.p, 10);
  assert.deepStrictEqual([after.lw, after.gw], [2, 10], 'a window leave on top: the same reading');
  // ro is never read by the factor
  const Q = { leaves: 3, lastMatch: '', w: [[51, 0], [52, 0], [53, 0]] };
  assert.strictEqual(vv.leaverFactorOf(Object.assign({ ro: 99 }, Q), 0), vv.leaverFactorOf(Q, 0), 'ro is a count to read, not a factor input');
}
U('[2] old formats read as before (no w; 2-element entries); ro never moves the factor', check2f);

// ---------------- [3] creditXp after the window ----------------
function check3(vv) {
  const mkRec = (seat, dispCode, sid) => { const d = []; d[5] = seat; return { d, dispCode, steamID: sid }; };
  const A = '76561198000000201', B = '76561198000000202';
  const gainOf = (ro) => {
    const leavers = {}, xpState = {}, xp = {}, changed = {};
    for (let i = 0; i < 3; i++) vv.noteLeave(leavers, vv.pid(A), (200 + i) + '_1_1', ro);
    const log = console.log; console.log = () => {};   // creditXp logs every credit
    try { vv.creditXp([mkRec(0, 0, A), mkRec(1, 0, B)], 1, [9000, 6000], { [A]: 1, [B]: 2 }, xp, changed, xpState, leavers, 5); } finally { console.log = log; }
    return xp[A] | 0;
  };
  const full = vv.computeXpGain('valid', 0, 9000, false, true, 1, 1), half = vv.computeXpGain('valid', 0, 9000, false, true, 0.5, 1);
  assert.ok(half < full, 'fixture reaches the factor');
  assert.strictEqual(gainOf(true), full, '3 window leaves: credited in full after the window');
  assert.strictEqual(gainOf(false), half, '3 plain leaves: x0.5');
}
U('[3] creditXp after the window (no switch in this process): 3 window leaves cost nothing, 3 plain ones x0.5', check3);

// ---------------- [4] end to end, the main channel ----------------
const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN;
const XPB = 5, RATING = 6, POINTS = 7;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
function run(steps, pts0, files0, env, script) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || null), env, script, 'launch-week');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, 0) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_' + mt, mh: hash | 0 };
}
const ptsWrites = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, POINTS, sid)));
const xpOf = (m, sid) => { const w = [].concat(...m.rs.map((r) => H.postsOf(r, XPB, sid))); return w.length ? w[w.length - 1].score : null; };
const lastRing = (m, sid) => { const w = ptsWrites(m, sid); return w.length ? PP.lpDetailsOf(w[w.length - 1].details).ring : null; };
const low = (e) => e.flags & 0xff;

const G = H.SID(7771), Hh = H.SID(7772), I = H.SID(7773);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const FUTURE = iso(Date.now() + 24 * HOUR), PAST = iso(Date.now() - HOUR);
const ENV = {
  on: { LEAVER_XP_RECORD_ONLY_UNTIL: FUTURE, LEAVER_LP_EASY: '50', LEAVER_LP_EASY_UNTIL: FUTURE },
  past: { LEAVER_XP_RECORD_ONLY_UNTIL: PAST, LEAVER_LP_EASY: '50', LEAVER_LP_EASY_UNTIL: PAST },
  broken: { LEAVER_XP_RECORD_ONLY_UNTIL: FUTURE, LEAVER_LP_EASY: '50', LEAVER_LP_EASY_UNTIL: FUTURE.slice(0, 10) },   // date only: the fine is not honored, the XP switch is
  unset: {},
};
const MM = match(2, 0x77701, [G, Hh, I], [0, 1]);   // ranked FFA, I writes his start and leaves
const PTS = { [G]: { score: 2500 }, [Hh]: { score: 2400 }, [I]: { score: 1500 } };
const LV0 = { [v.pid(G)]: { leaves: 2, lastMatch: 'x' }, [v.pid(I)]: { leaves: 1, lastMatch: 'y' } };   // old format: G x0.5, I one old leave
const STEPS = (mm) => [[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [LEAVE, mm.all], [3 * HOUR, mm.all]];
function cell(name, script, lv) {
  const m = run(STEPS(MM), PTS, { LEAVERS_FILE: lv === undefined ? LV0 : lv }, ENV[name], script);
  const w = ptsWrites(m, I), ring = lastRing(m, I);
  const cs = ((m.last.state.CONFESSIONS_FILE || {})[v.pid(I) + '|' + MM.key]) || null;
  const entryI = ((m.last.state.LEAVERS_FILE || {})[v.pid(I)]) || null;
  return { m, w, ring, cs, entryI, xpG: xpOf(m, G), out: m.out };
}
// after the window: a quick 1V1 I wins against Hh, no switch set
const Q2 = match(1, 0x77702, [I, Hh], [0, 1]);
function after(c, script) {
  const n = run([[0, Q2.S], [5 * MIN, Q2.all], [GRACE, Q2.all], [6 * MIN, Q2.all]], c.m.pts, H.advance(c.m.last.state, 10 * MIN), {}, script);
  return { n, xpI: xpOf(n, I), out: n.out };
}
const XP_FULL = v.computeXpGain('valid', 0, 6000, false, true, 1, 1), XP_HALF = v.computeXpGain('valid', 0, 6000, false, true, 0.5, 1);

console.log('-- [4] end to end, main channel: ranked 3P, I leaves; then a quick 1V1 after the window --');
const ref = cell('unset', null, {});   // nobody has earlier leaves: G's undiscounted XP
T('[4] reference run settles (G + Hh credited, I fined 100)', ref.m.okAll && ref.xpG > 0 && ref.w.length === 1 && ref.w[0].score === 1400, ref.out.slice(-800));
const E4 = {};
function checkOn(c) {
  return c.m.okAll && c.w.length === 1 && c.w[0].score === 1450 && c.ring && c.ring[0].mh === MM.mh && c.ring[0].delta === -50 && low(c.ring[0]) === PP.RECEIPT_F.LEAVE
    && c.cs && c.cs.ded === 50 && c.cs.cv === 1;
}
function checkMarked(c) {
  const w = (c.entryI && c.entryI.w) || [];
  return !!c.entryI && c.entryI.leaves === 2 && c.entryI.o === 1 && c.entryI.ro === 1 && w.length === 1 && J(w[0]) === J([MM.mh, 0, 1]);
}
for (const name of ['on', 'past', 'broken', 'unset']) {
  const c = E4[name] = cell(name);
  const tag = '[4] ' + name + ':';
  T(tag + ' runs exit 0, the match settled', c.m.okAll && new Set(c.m.last.state.PROCESSED_FILE || []).has(MM.key), c.out.slice(-800));
  if (name === 'on') {
    T(tag + ' I fined 50 (1500 -> 1450, LEAVE receipt -50, ded 50 for a late result)', checkOn(c), J(c.w) + ' ' + J(c.ring) + ' ' + J(c.cs));
    T(tag + ' the fine logged, the window announced', /leaver LP [^\n]* pts 1500-50->1450/.test(c.out) && /leaver points: ranked leave fine 50 \(normally 100\) until /.test(c.out), c.out.slice(-600));
  } else {
    T(tag + ' I fined 100 (1500 -> 1400, ded 100)', c.w.length === 1 && c.w[0].score === 1400 && c.ring[0].delta === -100 && c.cs && c.cs.ded === 100, J(c.w) + ' ' + J(c.cs));
  }
  if (name === 'past') T(tag + ' "the easy fine ended" logged', /leaver points: the easy fine ended at /.test(c.out));
  if (name === 'broken') T(tag + ' the malformed fine warned', /::warning::LEAVER_LP_EASY="50" \/ LEAVER_LP_EASY_UNTIL="[0-9-]+" not honored/.test(c.out), c.out.slice(-600));
  const xpOn = name === 'on' || name === 'broken';   // the XP switch is well-formed in these two
  T(tag + ' G (two earlier leaves, ranked) credited ' + (xpOn ? 'in full (record-only)' : 'with the discount'), xpOn ? c.xpG === ref.xpG : (c.xpG > 0 && c.xpG < ref.xpG), c.xpG + ' vs ' + ref.xpG);
  T(tag + ' I\'s leave ' + (xpOn ? 'marked [mh, 0, 1], ro 1 (his old leave kept as old)' : 'plain [mh, 0], no ro'),
    xpOn ? checkMarked(c) : (!!c.entryI && J(c.entryI.w) === J([[MM.mh, 0]]) && c.entryI.ro === undefined && c.entryI.o === 1), J(c.entryI));
}
const A_ON = after(E4.on), A_PAST = after(E4.past);
T('[4] after the window: the 1V1 settles in both', A_ON.n.okAll && A_PAST.n.okAll && A_ON.xpI != null && A_PAST.xpI != null, A_ON.out.slice(-600));
T('[4] after the window cell: I credited in full (his old leave counts, the window one not: 1 in 20 -> x1.0)', A_ON.xpI === XP_FULL, A_ON.xpI + ' vs ' + XP_FULL);
T('[4] after the plain cell: I x0.5 (2 leaves in 20)', A_PAST.xpI === XP_HALF, A_PAST.xpI + ' vs ' + XP_HALF);

// ---------------- [5] end to end, a ranked confession inside the window ----------------
const P1 = H.SID(7774), Q1 = H.SID(7775);
const CM = match(2, 0x77703, [P1, Q1], [0, 1]);
const CONF = { sid: Q1, d: H.rec(0xB5, 2, 0x77703, 1, 0, false, [P1, Q1], [6000, 5000], 5) };   // Q1 quits (user-quit)
function confCell(script) {
  const m = run([[0, CM.S], [5 * MIN, CM.S.concat([CONF])], [5 * MIN, CM.all.concat([CONF])], [GRACE, CM.all], [6 * MIN, CM.all]],
    { [P1]: { score: 2500 }, [Q1]: { score: 2200 } }, null, ENV.on, script);
  return { m, w: ptsWrites(m, Q1), out: m.out };
}
console.log('-- [5] end to end: a ranked confession inside the window, then he comes back and finishes --');
function checkConf(c) {
  return c.m.okAll && c.w.length >= 2 && c.w[0].score === 2150 && /confess [^\n]* pts 2200-50->2150/.test(c.out)
    && /confess-forgive [^\n]* settled after all, refund \+50 -> 2200/.test(c.out);
}
const C5 = confCell();
T('[5] fined 50 at first sight (2200 -> 2150), given back exactly the 50 when he finishes (-> 2200, not 2250)', checkConf(C5), J(C5.w) + ' ' + C5.out.split('\n').filter((l) => /confess/.test(l)).join(' | '));

// ---------------- [6] source ----------------
function check6(vv, src) {
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/ .*$/, ''));
  const calls = code.filter((l) => /\bleaverLpPenalty\(/.test(l) && !/module\.exports/.test(l));
  assert.ok(calls.length >= 2, 'fine sites found: ' + calls.length);
  for (const l of calls) assert.ok(/leaverLpPenalty\([^,]+, (LEAVER_LP_FINE|opts\.penalty)\)/.test(l), 'a fine site not on LEAVER_LP_FINE: ' + l.trim());
  const pen = code.filter((l) => /\bpenalty: /.test(l));
  assert.ok(pen.length >= 1 && pen.every((l) => /penalty: LEAVER_LP_FINE\b/.test(l)), 'the confession fine: ' + pen.map((l) => l.trim()).join(' | '));
  // LEAVER_LP_PENALTY in code only where it is the base of the window's fine, the knob, or a log
  const direct = code.filter((l) => /\bLEAVER_LP_PENALTY\b/.test(l) && !/pointsPlan\.configure|^\s*LEAVER_LP_PENALTY: process\.env|RS_TRIO_WIN, LEAVER_LP_PENALTY,|leaverLpFineOf\(KEY_CHANNEL|console\.log\(|ghWarn\(|^\s*\+ ' and a strict/.test(l));
  assert.deepStrictEqual(direct.map((l) => l.trim()), [], 'LEAVER_LP_PENALTY read directly');
  const pp = fs.readFileSync(path.join(H.ROOT, 'points-plan.js'), 'utf8');
  assert.ok(/LEAVER_LP_PENALTY: 100 \}\);/.test(pp) && !/LEAVER_LP_EASY/.test(pp), 'points-plan.js: the normal fine stays its default, no window there');
}
U('[6] source: every leave fine on LEAVER_LP_FINE (no direct LEAVER_LP_PENALTY fine), points-plan.js untouched', check6);

// ---------------- [7] mutations ----------------
console.log('-- [7] mutations --');
const mutantFile = (key) => path.join(H.ROOT, '.mutant-launch-week-' + process.pid + '-' + key + '.js');
function mutant(key, from, to) {
  if (VSRC.split(from).length !== 2) { bad('[7] mutant ' + key + ': anchor not found exactly once'); return null; }
  const file = mutantFile(key);
  fs.writeFileSync(file, VSRC.replace(from, to));
  return file;
}
// unit-level: the mutant copy required in this process, the check must throw
const UNIT = {
  noExpiry: ['  const until = leaverSwitchUntil(rawUntil, nowMs);\n  if (!until) return off;', '  const until = leaverSwitchUntil(rawUntil, nowMs) || 1;', check1],
  expiryReversed: ['!(t > now) || t - now > LEAVER_XP_RECORD_ONLY_MAX_MS', '!(t < now)', check1],
  fineOtherChannel: ["  if (channel !== 'ea') return off;", "  if (channel === 'playtest') return off;", check1],
  harsherFine: ['  if (!(fine <= Number(base))) return off;\n', '', check1],
  markNotRead: ['    if (w[j] && w[j][2]) continue;   // O777', '    if (false) continue;   // O777', check2b],
  markNotReadXp: ['    if (w[j] && w[j][2]) continue;   // O777', '    if (false) continue;   // O777', check3],
  fineSiteSource: ['        const nv = leaverLpPenalty(cur, LEAVER_LP_FINE);', '        const nv = leaverLpPenalty(cur, LEAVER_LP_PENALTY);', check6],
};
for (const key of Object.keys(UNIT)) {
  const [from, to, fn] = UNIT[key];
  const file = mutant(key, from, to);
  if (!file) continue;
  let red = false, why = '';
  // red = the check's own assertion fails (a mutant that does not even load is no proof)
  try { const mv = require(file); fn(mv, VSRC.replace(from, to)); } catch (e) { red = e instanceof assert.AssertionError; why = (e && e.message) || ''; } finally { try { fs.unlinkSync(file); } catch (e) {} }
  T('[7] mutant ' + key + ' -> red', red, 'stayed green');
  if (red) console.log('        (' + why.split('\n')[0].slice(0, 140) + ')');
}
// end to end: the mutant copy runs as the cron; red = the runs exit 0 and the checked value is the pre-O777 one (not a crash)
const E2E = {
  markNotWritten: ['  const mark = ro === undefined ? LEAVER_XP_RECORD_ONLY > 0 : !!ro;', '  const mark = !!ro;', (file) => {
    const c = cell('on', file), a = after(c, file);
    return c.m.okAll && a.n.okAll && !checkMarked(c) && J(c.entryI && c.entryI.w) === J([[MM.mh, 0]]) && a.xpI === XP_HALF;   // unmarked, counted after the window
  }],
  fineSiteOld: ['        const nv = leaverLpPenalty(cur, LEAVER_LP_FINE);', '        const nv = leaverLpPenalty(cur, LEAVER_LP_PENALTY);', (file) => {
    const c = cell('on', file);
    return c.m.okAll && !checkOn(c) && c.w.length === 1 && c.w[0].score === 1400;   // the 100 inside the window
  }],
  confFineOld: ['      penalty: LEAVER_LP_FINE, lpMax: LP_MAX,', '      penalty: LEAVER_LP_PENALTY, lpMax: LP_MAX,', (file) => {
    const c = confCell(file);
    return c.m.okAll && !checkConf(c) && /confess [^\n]* pts 2200-100->2100/.test(c.out);   // the 100 inside the window
  }],
};
for (const key of Object.keys(E2E)) {
  const [from, to, redFn] = E2E[key];
  const file = mutant(key, from, to);
  if (!file) continue;
  let red = false;
  try { red = redFn(file); } catch (e) { red = true; } finally { try { fs.unlinkSync(file); } catch (e) {} }
  T('[7] mutant ' + key + ' (end to end) -> red', red, 'stayed green');
}

console.log(failN ? ('FAIL x' + failN + ' (channel-launch-week)') : ('ALL OK (channel-launch-week, ' + n + ' checks)'));
process.exit(failN ? 1 : 0);
