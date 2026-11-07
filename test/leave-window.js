'use strict';
// O717 N2 (user ruling 2026-11-07): the quick-match XP discount reads the leave rate of the player's last LEAVER_XP.window
//   matchmade events (valid finishes + convicted leaves), strictly (the user chose this over the lighter of the window and
//   the lifetime factor: the full game starts from zero at launch).
//   [1] an old-format entry (no w: the lifetime count only) reads exactly the old rule while his events fit the window, and
//       never a lower factor than the old rule past it (its leaves count as his oldest events)
//   [2] the user's case: 10 leaves in a first 40 events -> 50 clean finishes clear it (the lifetime rule still discounted)
//   [3] the window agrees with a brute-force event list (random sequences of finishes / leaves / retractions, old prefixes):
//       equal with no retraction, never more leaves inside with one (a leave the window dropped does not come back)
//   [4] strictly the window: the factor is the window's alone (random histories vs the brute force); a long clean record then
//       a run of leaves is discounted by them, and cleared as they leave the window
//   [5] retraction: the named match's listed leave, its finishes joining the leave before it; an unlisted one = an old one
//   [6] creditXp: a valid finish moves the window, an innocent / abandoner end does not; the XP uses leaverFactorOf
//   [7] source: validate.js counts a leave only through noteLeave / unnoteLeave, and the table function only through
//       leaverFactorOf (a new site cannot go back to the lifetime count)
//   [8] mutation: each part taken out (validate.js copy with it removed) turns its check red
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const VFILE = path.join(__dirname, '..', 'validate.js');
const VSRC = fs.readFileSync(VFILE, 'utf8');
const V = require(VFILE);
let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ok    ' + name); }
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const W = V.LEAVER_XP.window;

// a player's history, driven through the cron helpers and a brute-force event list side by side
function sim(v, opts) {
  const o = opts || {};
  const leavers = {}, p = 'p1';
  const events = [];   // brute force: 'G' or { mh }
  let G = 0, mhN = 0;
  if (o.oldLeaves || o.oldGames) {   // an old-format entry: o leaves, then old finishes (the conservative reading: leaves first)
    leavers[p] = { leaves: o.oldLeaves | 0, lastMatch: '' };
    for (let i = 0; i < (o.oldLeaves | 0); i++) events.push({ mh: -1 - i });
    for (let i = 0; i < (o.oldGames | 0); i++) events.push('G');
    G = o.oldGames | 0;
  }
  return {
    leavers, p, events,
    get G() { return G; },
    leave() { const mh = ++mhN; v.noteLeave(leavers, p, mh + '_7_1'); events.push({ mh }); return mh; },
    finish() { G++; v.noteFinish(leavers, p, G); events.push('G'); },
    retract(mh) { v.unnoteLeave(leavers, p, mh + '_7_1'); const i = events.findIndex((e) => e !== 'G' && e.mh === mh); if (i >= 0) events.splice(i, 1); },
    retractOld() { v.unnoteLeave(leavers, p, '999999_7_1'); const i = events.findIndex((e) => e !== 'G' && e.mh < 0); if (i >= 0) events.splice(i, 1); },
    brute() { const last = events.slice(-W); const lw = last.filter((e) => e !== 'G').length; return { lw, gw: last.length - lw }; },
    lifetime() { return { leaves: events.filter((e) => e !== 'G').length, games: G }; },
    win() { const w = v.leaverWindowOf(leavers[p], G); return { lw: w.lw, gw: w.gw }; },
    factor() { return v.leaverFactorOf(leavers[p] || 0, G); },
  };
}

function check1(v) {
  for (let L = 0; L <= 60; L++) for (let Gm = 0; Gm <= 120; Gm++) {
    const old = v.effectiveLeaverFactor(L, Gm);
    const now = v.leaverFactorOf({ leaves: L, lastMatch: '' }, Gm);
    const asCount = v.leaverFactorOf(L, Gm);
    if (L + Gm <= W) assert.strictEqual(now, old, 'old entry ' + L + '/' + Gm + ' inside the window: the old rule');
    assert.ok(now >= old, 'old entry ' + L + '/' + Gm + ': never below the old rule (' + now + ' < ' + old + ')');
    assert.strictEqual(asCount, now, 'a bare count reads as an old entry');
    // its first write converts it: the same reading
    const e = { leaves: L, lastMatch: '' };
    v.leaverEntry({ x: e }, 'x');
    assert.strictEqual(v.leaverFactorOf(e, Gm), now, 'converted ' + L + '/' + Gm);
  }
}
ok('[1] an old-format entry: the old rule inside the window, never a heavier discount past it (and after its conversion)', () => check1(V));

function check2(v) {
  const s = sim(v);
  for (let i = 0; i < 10; i++) { s.leave(); s.finish(); s.finish(); s.finish(); }   // 40 events, 10 leaves
  assert.strictEqual(s.factor(), 0.3, '10 in 40: 25% -> x0.3');
  for (let i = 0; i < W; i++) s.finish();
  assert.strictEqual(s.factor(), 1, '50 clean finishes clear it');
  assert.strictEqual(v.effectiveLeaverFactor(10, s.G), 0.5, '(the lifetime rule: 10 in 100 still x0.5)');
  // the same from an old-format entry (the history kept only as counts)
  const t = sim(v, { oldLeaves: 10, oldGames: 30 });
  assert.strictEqual(t.factor(), 0.3);
  for (let i = 0; i < W; i++) t.finish();
  assert.strictEqual(t.factor(), 1, 'an old entry: 50 clean finishes clear it too');
}
ok('[2] 10 leaves in a first 40 events: x0.3, then 50 clean finishes -> x1 (lifetime: still x0.5)', () => check2(V));

function check3(v) {
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const s = sim(v, seed % 3 ? null : { oldLeaves: Math.floor(r() * 12), oldGames: Math.floor(r() * 70) });
    const mine = [];
    let retracted = false;
    const steps = 30 + Math.floor(r() * 220);
    for (let k = 0; k < steps; k++) {
      const x = r();
      if (x < 0.2) mine.push(s.leave());
      else if (x < 0.23 && mine.length) { s.retract(mine.splice(Math.floor(r() * mine.length), 1)[0]); retracted = true; }
      else if (x < 0.24) { s.retractOld(); retracted = true; }
      else s.finish();
      const a = s.win(), b = s.brute();
      if (!retracted) assert.deepStrictEqual(a, b, 'seed ' + seed + ' step ' + k);
      else assert.ok(a.lw <= b.lw && a.lw + a.gw <= Math.max(b.lw + b.gw, W), 'seed ' + seed + ' step ' + k + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
      const e = s.leavers[s.p];
      if (e && Array.isArray(e.w)) assert.ok(e.w.length <= W, 'bounded');
    }
  }
}
ok('[3] the window == a brute-force event list (400 random histories; with retractions: never more leaves inside)', () => check3(V));

function check4(v) {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(1000 + seed);
    const s = sim(v);
    for (let k = 0; k < 150; k++) {
      if (r() < 0.15) s.leave(); else s.finish();
      const b = s.brute();
      assert.strictEqual(s.factor(), v.effectiveLeaverFactor(b.lw, b.gw), 'seed ' + seed + ' step ' + k + ': the factor is the window\'s alone');
    }
  }
  const s = sim(v);
  for (let i = 0; i < 200; i++) s.finish();
  s.leave(); s.leave(); s.leave();
  assert.strictEqual(v.effectiveLeaverFactor(3, 203), 1, '(the lifetime rule: 3 in 203 -> x1)');
  assert.strictEqual(s.factor(), 0.5, '200 clean then 3 leaves: 3 in the last 50 -> x0.5');
  for (let i = 0; i < 47; i++) s.finish();
  assert.strictEqual(s.factor(), 0.5, '47 clean later: the 3 still inside');
  s.finish();
  assert.strictEqual(s.factor(), 1, 'the 48th: one has left the window (2 in 50 -> x1)');
}
ok('[4] strictly the window (user: no "lighter of the two"): 200 clean then 3 leaves -> x0.5, cleared as they leave the window', () => check4(V));

function check5(v) {
  const L = {};
  v.noteLeave(L, 'p', '11_7_1'); v.noteFinish(L, 'p', 1); v.noteFinish(L, 'p', 2);
  v.noteLeave(L, 'p', '22_7_1'); v.noteFinish(L, 'p', 3);
  assert.deepStrictEqual(L.p.w, [[11, 2], [22, 1]]);
  v.unnoteLeave(L, 'p', '22_7_1');
  assert.deepStrictEqual(L.p.w, [[11, 3]], 'its finishes join the leave before it');
  assert.strictEqual(L.p.leaves, 1);
  v.unnoteLeave(L, 'p', '11_7_1');
  assert.deepStrictEqual(L.p.w, [], 'the first one: its finishes go ahead of the list');
  const O = { p: { leaves: 3, lastMatch: '' } };
  v.unnoteLeave(O, 'p', '5_7_1');
  assert.deepStrictEqual(O.p, { leaves: 2, lastMatch: '' }, 'an old entry: the count only (still old format)');
  v.noteLeave(O, 'p', '6_7_1');
  assert.strictEqual(O.p.o, 2, 'converted on its first write: the old leaves kept as old');
  v.unnoteLeave(O, 'p', '5_7_1');
  assert.strictEqual(O.p.o, 1, 'an unlisted match: one old leave fewer');
  assert.deepStrictEqual(O.p.w, [[6, 0]]);
}
ok('[5] retraction: the named listed leave (its finishes to the one before); unlisted = an old one', () => check5(V));

function check6(v) {
  const mkRec = (seat, dispCode, sid) => { const d = []; d[5] = seat; return { d, dispCode, steamID: sid }; };
  const A = '76561198000000101', B = '76561198000000102';
  const leavers = {}, xpState = {}, xp = {}, changed = {};
  for (let i = 0; i < 4; i++) v.noteLeave(leavers, v.pid(A), (100 + i) + '_7_1');
  const run = (dA) => v.creditXp([mkRec(0, dA, A), mkRec(1, 0, B)], 1, [300, 200], { [A]: 1, [B]: 2 }, xp, changed, xpState, leavers, 1);
  run(2);   // innocent: no finish
  run(5);   // abandoner: no finish
  assert.deepStrictEqual(leavers[v.pid(A)].w.map((x) => x[1]), [0, 0, 0, 0]);
  assert.strictEqual(v.leaverFactorOf(leavers[v.pid(A)], (xpState[v.pid(A)] || {}).games), 0.3, '4 leaves, 0 finishes: x0.3');
  for (let i = 0; i < W; i++) run(0);
  assert.strictEqual(xpState[v.pid(A)].games, W);
  assert.strictEqual(v.leaverFactorOf(leavers[v.pid(A)], xpState[v.pid(A)].games), 1, '50 valid finishes later: x1');
  assert.deepStrictEqual(leavers[v.pid(A)].w, [], 'what the window no longer sees is dropped');
  assert.strictEqual(leavers[v.pid(A)].leaves, 4, 'the lifetime count stays');
  assert.strictEqual(leavers[v.pid(B)], undefined, 'no entry made for a clean player');
}
ok('[6] creditXp: valid finishes move the window (innocent / abandoner do not); 50 of them clear 4 leaves', () => check6(V));

function check7(src) {
  const fnBody = (name) => { const i = src.indexOf('\nfunction ' + name + '('); assert.ok(i >= 0, name); const j = src.indexOf('\n}\n', i); return src.slice(i, j); };
  let rest = src;
  for (const f of ['leaverEntry', 'noteLeave', 'unnoteLeave', 'leaverFactorOf']) rest = rest.split(fnBody(f)).join('');
  const bad = rest.split('\n').filter((l) => /\.leaves\s*(\+=|-=|\+\+|--|=(?!=))/.test(l) && !/^\s*\/\//.test(l));
  assert.deepStrictEqual(bad, [], 'a leave counted outside noteLeave / unnoteLeave');
  const tbl = rest.split('\n').filter((l) => /\beffectiveLeaverFactor\(/.test(l) && !/^\s*\/\//.test(l) && !/^function effectiveLeaverFactor\(/.test(l) && !/module\.exports/.test(l));
  assert.deepStrictEqual(tbl, [], 'the table function called outside leaverFactorOf');
  assert.ok(/if \(cls === 'valid'\) \{ st\.games \+= 1; noteFinish\(leavers, p, st\.games\); \}/.test(src), 'creditXp: a valid finish moves the window');
}
ok('[7] source: leaves only through noteLeave / unnoteLeave; the table only through leaverFactorOf; creditXp calls noteFinish', () => check7(VSRC));

// [8] mutation
const MUT = {
  noFinish: ["    if (cls === 'valid') { st.games += 1; noteFinish(leavers, p, st.games); }", "    if (cls === 'valid') { st.games += 1; }", (v, src) => check6(v)],
  lighterOf: ["  return effectiveLeaverFactor(win.lw, win.gw);\n}", "  return Math.max(effectiveLeaverFactor(win.lw, win.gw), effectiveLeaverFactor(e.leaves | 0, games | 0));\n}", (v) => check4(v)],
  noWindow: ["const LEAVER_XP = { minSample: 20, window: 50,", "const LEAVER_XP = { minSample: 20, window: 1e9,", (v) => check2(v)],
  noOld: ["  if (!Array.isArray(e.w)) { const o = e.leaves | 0; e.w = []; if (o > 0) e.o = o; }", "  if (!Array.isArray(e.w)) { e.w = []; }", (v) => check1(v)],
  noOldIn: ["    oldIn = Math.min(o, W - ev); lw += oldIn; ev += oldIn;", "    oldIn = 0;", (v) => check1(v)],
  lifetime: ["    const lf = leaverFactorOf(leavers[p] || 0, st.games);", "    const lf = effectiveLeaverFactor((leavers[p] && leavers[p].leaves) || 0, st.games);", (v, src) => check7(src)],
  rawRetract: ["      if (st.ex && leavers[p]) { unnoteLeave(leavers, p, m); st.ex = 0; retracted = true; res.retracted++; }", "      if (st.ex && leavers[p]) { leavers[p].leaves = Math.max(0, (leavers[p].leaves | 0) - 1); st.ex = 0; retracted = true; res.retracted++; }", (v, src) => check7(src)],
  mergeLost: ["    if (i > 0) e.w[i - 1][1] = (e.w[i - 1][1] | 0) + ((e.w[i][1]) | 0);\n", '', (v) => check3(v)],
};
for (const key of Object.keys(MUT)) {
  const [from, to, run] = MUT[key];
  ok('[8] mutation ' + key + ' -> red', () => {
    assert.strictEqual(VSRC.split(from).length, 2, 'mutant ' + key + ': anchor once');
    const src = VSRC.replace(from, to);
    const file = path.join(__dirname, '..', '.mutant-leave-window-' + process.pid + '-' + key + '.js');
    fs.writeFileSync(file, src);
    let red = false;
    try { run(require(file), src); } catch (e) { red = true; } finally { try { fs.unlinkSync(file); } catch (e) {} }
    assert.ok(red, 'mutant ' + key + ' stayed green');
  });
}
console.log('leave-window: ' + n + ' ok');
