'use strict';
// Golden cases of streak-plan.js (O181): the matchmade win streak rules live in one self-contained module that the settle
// requires and the client runs as a comment-stripped copy (it replays the same cases), so a rule that moves on one side only
// turns one of the two suites red.
//   [1] fixtures/streak-plan/cases.json is what tools/gen-streak-fixtures.js generates from streak-plan.js today
//   [2] FIXTURES_HASH in streak-plan.js is the file's canonical hash; the file's rulesVer is RULES_VER
//   [3] every case replays to its out
//   [4] coverage: every case kind and op, and the situations the rules name
//   [5] the module loads the way the client loads it: comments stripped, new Function('window', src) -> window.STREAK_PLAN,
//       same outputs for every case
//   [6] the module stays self-contained: no require, no process.env, no clock, no block comment, ASCII-only code
//   [7] properties over random sequences: order-insensitive within the window (any arrival order of the same events gives the
//       same streak; the best may differ, it never comes back down), a replacement equals a direct apply, stale events change nothing, norm() of junk never throws
//   [8] mutation: a copy with one tier moved fails cases (the replay really compares)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SP = require(path.join(ROOT, 'streak-plan.js'));
const G = require(path.join(ROOT, 'tools', 'gen-streak-fixtures.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const text = fs.readFileSync(G.FILE, 'utf8');
const doc = JSON.parse(text);

console.log('=== streak-plan golden cases (O181) ===');
// [1]
T('[1] the case file is what the generator gives today (node tools/gen-streak-fixtures.js to regenerate)', G.render(G.build(SP)) === text);
T('[1] the generator lists every case of the file, in order', J(doc.cases.map((c) => c.name)) === J(G.CASES.map((c) => c.name)), doc.cases.length + ' vs ' + G.CASES.length);
// [2]
T('[2] FIXTURES_HASH = canonical hash of the case file', SP.FIXTURES_HASH === G.canonHash(text), SP.FIXTURES_HASH + ' vs ' + G.canonHash(text));
T('[2] the case file carries RULES_VER', doc.rulesVer === SP.RULES_VER && Number.isInteger(SP.RULES_VER) && SP.RULES_VER >= 1, doc.rulesVer + ' vs ' + SP.RULES_VER);
// [3]
const replayAll = (M) => doc.cases.map((c) => J(G.replay(M, Object.assign({ kind: c.kind }, c.in))));
const want = doc.cases.map((c) => J(c.out));
{
  const got = replayAll(SP), off = [];
  got.forEach((g, i) => { if (g !== want[i]) off.push(doc.cases[i].name); });
  T('[3] every case replays to its out (' + doc.cases.length + ' cases)', !off.length, off.slice(0, 5).join(' | '));
}
// [4]
{
  const kinds = new Set(doc.cases.map((c) => c.kind));
  T('[4] all three kinds present', ['pct', 'cap', 'seq'].every((k) => kinds.has(k)), [...kinds].join(','));
  const ops = new Set();
  for (const c of doc.cases) if (c.kind === 'seq') for (const op of c.in.ops) ops.add(op[0]);
  T('[4] every op present (apply / absence / pardon / merge / tail)', ['a', 'x', 'p', 'm', 't'].every((o) => ops.has(o)), [...ops].join(','));
  const pct = doc.cases.filter((c) => c.kind === 'pct').map((c) => c.out);
  T('[4] every tier percent appears', SP.TIERS.every((t) => pct.indexOf(t[1]) >= 0) && pct.indexOf(0) >= 0);
  const steps = [];
  for (const c of doc.cases) if (c.kind === 'seq') for (const s of c.out.steps) steps.push(s);
  T('[4] late, replaced and stale applies all appear', steps.some((s) => s.late && !s.stale) && steps.some((s) => s.replaced) && steps.some((s) => s.stale));
  T('[4] an absence that freezes and one that breaks', steps.some((s) => s.k === 0) && steps.some((s) => s.k === 3));
  T('[4] a folded prefix (window or cap)', doc.cases.some((c) => c.kind === 'seq' && c.out.st.p > 0));
  T('[4] an unread claim and a claim over the slack', doc.cases.some((c) => c.kind === 'cap' && c.in.auth == null) && doc.cases.some((c) => c.kind === 'cap' && c.in.auth != null && c.out < c.in.claim));
}
// [5] the client's way of loading it (the client vendor generator's line strip)
function strip(src) {
  const out = [];
  for (const raw of String(src).split(/\r?\n/)) {
    let line = raw, inS = null, cut = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inS) { if (ch === '\\') { i++; continue; } if (ch === inS) inS = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break; }
    }
    if (cut >= 0) line = line.slice(0, cut);
    line = line.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    out.push(line);
  }
  return out.join('\n') + '\n';
}
const SRC = fs.readFileSync(path.join(ROOT, 'streak-plan.js'), 'utf8');
const code = strip(SRC);
{
  const win = {};
  let err = null;
  try { new Function('window', code)(win); } catch (e) { err = e; }
  T('[5] the stripped copy loads with new Function(\'window\', src) onto window.STREAK_PLAN', !err && win.STREAK_PLAN && typeof win.STREAK_PLAN.apply === 'function', err && err.message);
  if (win.STREAK_PLAN) T('[5] the stripped copy replays every case to its out', J(replayAll(win.STREAK_PLAN)) === J(want));
  if (win.STREAK_PLAN) T('[5] the stripped copy carries the same RULES_VER and FIXTURES_HASH', win.STREAK_PLAN.RULES_VER === SP.RULES_VER && win.STREAK_PLAN.FIXTURES_HASH === SP.FIXTURES_HASH);
}
// [6]
T('[6] no require, no process, no clock in the module code', !/\brequire\s*\(|\bprocess\b|\bDate\b|\bperformance\b/.test(code));
T('[6] no block comment in the module (the client copy strips // lines only)', !/\/\*/.test(SRC));
T('[6] ASCII-only module code', !/[^\x00-\x7f]/.test(code));
// [7] properties (seeded, deterministic)
{
  let seed = 20261020;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const T0 = 29000000;
  let orderOk = 0, orderBad = 0, replOk = 0, replBad = 0, staleOk = 0, staleBad = 0, junkOk = 0, junkBad = 0;
  for (let it = 0; it < 400; it++) {
    const n = 2 + rnd(9);
    const evs = [];
    for (let i = 0; i < n; i++) evs.push([T0 + rnd(300), 1000 + i, [0, 1, 1, 1, 2, 3][rnd(6)]]);
    const now = T0 + 400;
    // best is not compared: a late event that would have broken a run does not take back the best already reached (by design)
    const run = (list) => { let st = SP.blank(); for (const e of list) st = SP.apply(st, e[0], e[1], e[2], now).st; return SP.current(st).cur + J(st.e); };
    const a = run(evs);
    const shuffled = evs.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t; }
    if (run(shuffled) === a) orderOk++; else orderBad++;
    // replacement: apply a different k first, then the real one -> same as the real one alone
    const k0 = evs[0];
    const pre = evs.slice(); pre.unshift([k0[0], k0[1], (k0[2] + 1) % 4]);
    if (run(pre) === a) replOk++; else replBad++;
    // stale: fold everything (a far-later event), then an event older than the fold changes nothing
    let st = SP.blank();
    for (const e of evs) st = SP.apply(st, e[0], e[1], e[2], now).st;
    st = SP.apply(st, T0 + 5000, 99, 1, T0 + 5000).st;
    const before = J(st);
    const r = SP.apply(st, T0 + 1, 77, [1, 2, 3][rnd(3)], T0 + 5001);
    if (r.stale && J(r.st) === before) staleOk++; else staleBad++;
    // junk never throws and comes back clean
    const junk = [null, 7, 'x', { p: -4, e: [[1], 'q', [1, 2, 9], [3, 4, 1]], f: 'no' }, { e: [[5, 6, 1], [4, 6, 2]] }][rnd(5)];
    try { const s = SP.norm(junk); if (s.p >= 0 && Array.isArray(s.e) && Array.isArray(s.f) && s.e.every((x) => [0, 1, 2, 3].indexOf(x[2]) >= 0)) junkOk++; else junkBad++; } catch (e) { junkBad++; }
  }
  T('[7] any arrival order of the same events gives the same streak (' + orderOk + ' sequences)', orderBad === 0, orderBad + ' differ');
  T('[7] the same match applied twice = the later outcome alone (' + replOk + ')', replBad === 0, replBad + ' differ');
  T('[7] a stale event changes nothing (' + staleOk + ')', staleBad === 0, staleBad + ' changed');
  T('[7] norm() of junk never throws and keeps only valid events (' + junkOk + ')', junkBad === 0, junkBad + ' bad');
  const dup = SP.norm({ e: [[10, 5, 1], [8, 5, 2]] });
  T('[7] norm() folds a duplicated matchHash into one event (the later outcome, the earlier start)', dup.e.length === 1 && dup.e[0][0] === 8 && dup.e[0][2] === 2, J(dup.e));
}
// [8] mutation
{
  const mut = code.replace('[[2, 5], [3, 10], [5, 15], [7, 20]]', '[[2, 5], [3, 10], [5, 16], [7, 20]]');
  if (mut === code) bad('[8] mutation target (the tier table) not found');
  else {
    const w = {}; new Function('window', mut)(w);
    const red = replayAll(w.STREAK_PLAN).filter((x, i) => x !== want[i]).length;
    T('[8] a copy with the 5-streak tier moved fails ' + red + ' case(s)', red > 0);
  }
}

console.log(failN ? ('streak-plan-fixtures: ' + failN + ' FAIL') : 'streak-plan-fixtures: all ok');
process.exit(failN ? 1 : 0);
