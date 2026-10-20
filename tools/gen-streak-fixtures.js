'use strict';
// ============================================================
// gen-streak-fixtures.js - the golden cases of streak-plan.js (O181)
// ============================================================
// Writes fixtures/streak-plan/cases.json: hand-picked streak situations (the INPUTS below) and what streak-plan.js gives
// for them today (the outputs). Both repos replay the file -- this repo's test/streak-plan-fixtures.js against
// streak-plan.js, the client's against its vendored copy -- so a rule that moves on one side only turns one of them red.
//   node tools/gen-streak-fixtures.js           write the file and print its FIXTURES_HASH
//   node tools/gen-streak-fixtures.js --check   exit 1 when the file is not what a fresh generation gives
// Regenerate only with a rules change (RULES_VER + 1 and FIXTURES_HASH in streak-plan.js, same change), and read the diff.
// Case kinds:
//   pct: { n } -> xpPct(n)
//   cap: { claim, auth } -> displayCap(claim, auth) (auth null = unread)
//   seq: { ops, lim? } run from a blank state, one result per op, then the state and current() at the end:
//     ['a', t0, mh, k, now]  apply -> { at, before, late, replaced, stale }
//     ['x', mh, now, t0]     absence (a conviction), then apply its answer -> { k, at }
//     ['p', mh]              pardon (the conviction's freeze grant back)
//     ['m', cur, best, mh]   merge a read-back tail
//     ['t', decoyLen]        tail (and read it back from behind a decoy block of decoyLen ints) -> { tail, read }
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'streak-plan', 'cases.json');
const W = 1, L = 2, B = 3, F = 0;
const T0 = 29000000;   // a start minute (2025) the sequences count from
const a = (dt, mh, k, now) => ['a', T0 + dt, mh, k, T0 + (now == null ? dt + 10 : now)];

const CASES = [
  // ---- the bonus tiers ----
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 30].map((n) => ({ name: 'xp percent at streak ' + n, kind: 'pct', n })),
  // ---- what others are shown ----
  { name: 'claim within the slack', kind: 'cap', claim: 5, auth: 4 },
  { name: 'claim over the slack', kind: 'cap', claim: 9, auth: 4 },
  { name: 'claim with nothing published', kind: 'cap', claim: 9, auth: null },
  { name: 'claim under the published value', kind: 'cap', claim: 2, auth: 6 },
  { name: 'claim over the max', kind: 'cap', claim: 500, auth: 400 },
  { name: 'negative claim', kind: 'cap', claim: -3, auth: 2 },
  // ---- in order ----
  { name: 'three wins in order: bonus on the second and the third', kind: 'seq', ops: [a(0, 11, W), a(20, 12, W), a(40, 13, W)] },
  { name: 'seven wins: every tier', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(40, 3, W), a(60, 4, W), a(80, 5, W), a(100, 6, W), a(120, 7, W), a(140, 8, W)] },
  { name: 'a loss zeroes, a break zeroes, a freeze holds', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(40, 3, F), a(60, 4, W), a(80, 5, L), a(100, 6, W), a(120, 7, W), a(140, 8, B), a(160, 9, W)] },
  // ---- out of order ----
  { name: 'a late loss started before three wins does not zero them', kind: 'seq', ops: [a(20, 2, W, 30), a(40, 3, W, 50), a(60, 4, W, 70), a(0, 1, L, 80)] },
  { name: 'a late loss started between the wins zeroes the ones before it only', kind: 'seq', ops: [a(0, 1, W, 10), a(40, 3, W, 50), a(60, 4, W, 70), a(20, 2, L, 80)] },
  { name: 'a late win started before two wins: its own bonus counts what came before it', kind: 'seq', ops: [a(0, 1, W, 10), a(40, 3, W, 50), a(60, 4, W, 70), a(20, 2, W, 80)] },
  { name: 'same start minute: the loss sorts first, the win last (kindest)', kind: 'seq', ops: [a(0, 1, W), a(20, 9, W, 30), a(20, 3, L, 30)] },
  { name: 'same start minute: a freeze between a break and a win', kind: 'seq', ops: [a(0, 1, W), a(20, 7, W, 30), a(20, 5, F, 30), a(20, 6, B, 30)] },
  { name: 'same start minute, two wins: by matchHash', kind: 'seq', ops: [a(0, 1, W), a(20, -5, W, 30), a(20, 4, W, 30)] },
  // ---- the same match twice ----
  { name: 'a confessed quit then his own win after he came back', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(40, 3, B, 45), a(40, 3, W, 60)] },
  { name: 'a replacement keeps the earlier start minute', kind: 'seq', ops: [a(0, 1, W), a(30, 2, W), a(10, 3, B, 40), a(50, 3, L, 60)] },
  // ---- the window ----
  { name: 'events older than 12 hours fold into the prefix in order', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(40, 3, L), a(60, 4, W), a(800, 5, W), a(820, 6, W)] },
  { name: 'an event older than the fold is stale both ways', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(800, 3, W), a(10, 4, L, 810), a(15, 5, W, 815)] },
  { name: 'the cap folds the oldest', kind: 'seq', lim: { win: 0, cap: 3 }, ops: [a(0, 1, W), a(20, 2, L), a(40, 3, W), a(60, 4, W), a(80, 5, W)] },
  { name: 'no time fold (the client) keeps day-old events', kind: 'seq', lim: { win: 0, cap: 32 }, ops: [a(0, 1, W), a(2000, 2, W), a(4000, 3, W)] },
  // ---- convicted absences ----
  { name: 'the first absence in a week freezes, the second breaks', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), ['x', 3, T0 + 100, T0 + 40], a(60, 4, W), ['x', 5, T0 + 200, T0 + 80], a(100, 6, W)] },
  { name: 'an absence asked twice keeps its first answer', kind: 'seq', ops: [a(0, 1, W), ['x', 3, T0 + 100, T0 + 20], ['x', 3, T0 + 110, T0 + 20], ['x', 8, T0 + 120, T0 + 40]] },
  { name: 'a week later the freeze is back', kind: 'seq', ops: [a(0, 1, W), ['x', 2, T0 + 30, T0 + 20], a(40, 3, W), ['x', 4, T0 + 30 + 7 * 1440, T0 + 7 * 1440]] },
  { name: 'a pardoned conviction returns its grant: the next absence freezes again', kind: 'seq', ops: [a(0, 1, W), ['x', 2, T0 + 30, T0 + 20], ['p', 2], a(20, 2, F, 60), a(40, 3, W), ['x', 4, T0 + 200, T0 + 60]] },
  // ---- read-back merge (the client) ----
  { name: 'merge: the tail match is in the log, later local events fold on top', kind: 'seq', lim: { win: 0, cap: 32 }, ops: [a(0, 1, W), a(20, 2, W), a(40, 3, W), a(60, 4, F), ['m', 1, 4, 2], ['t', 0]] },
  { name: 'merge: a tail match never logged here -> the tail alone', kind: 'seq', lim: { win: 0, cap: 32 }, ops: [a(0, 1, W), a(20, 2, W), ['m', 5, 9, 77], ['t', 0]] },
  { name: 'merge: a tail with no match keeps every local event', kind: 'seq', lim: { win: 0, cap: 32 }, ops: [a(0, 1, W), a(20, 2, W), ['m', 0, 0, 0], ['t', 0]] },
  { name: 'merge: the tail match is the one folded last', kind: 'seq', lim: { win: 0, cap: 2 }, ops: [a(0, 1, W), a(20, 2, W), a(40, 3, W), a(60, 4, W), ['m', 2, 3, 2], ['t', 0]] },
  // ---- the published block ----
  { name: 'tail read back from the matrix end and from behind another block', kind: 'seq', ops: [a(0, 1, W), a(20, 2, W), a(40, 3, L), a(60, 4, W), ['t', 0], ['t', 5]] },
  { name: 'tail of a blank state', kind: 'seq', ops: [['t', 0]] },
];

function summary(SP, st) { const c = SP.current(st); return { cur: c.cur, best: c.best, mh: c.mh }; }
function replay(SP, c) {
  if (c.kind === 'pct') return SP.xpPct(c.n);
  if (c.kind === 'cap') return SP.displayCap(c.claim, c.auth);
  if (c.kind !== 'seq') throw new Error('unknown case kind ' + c.kind);
  let st = SP.blank();
  const steps = [];
  for (const op of c.ops) {
    if (op[0] === 'a') {
      const r = SP.apply(st, op[1], op[2], op[3], op[4], c.lim);
      st = r.st;
      steps.push({ at: r.at, before: r.before, late: r.late, replaced: r.replaced, stale: r.stale });
    } else if (op[0] === 'x') {
      const ab = SP.absence(st, op[1], op[2]);
      const r = SP.apply(ab.st, op[3], op[1], ab.k, op[2], c.lim);
      st = r.st;
      steps.push({ k: ab.k, at: r.at });
    } else if (op[0] === 'p') {
      st = SP.pardon(st, op[1]);
      steps.push({ f: st.f.length });
    } else if (op[0] === 'm') {
      st = SP.merge(st, { cur: op[1], best: op[2], mh: op[3] });
      steps.push(summary(SP, st));
    } else if (op[0] === 't') {
      const t = SP.tail(st);
      const decoy = op[1] | 0 ? [(0x77 | (1 << 8) | ((op[1] | 0) << 16)) | 0].concat(new Array(op[1] | 0).fill(0xC9)) : [];
      steps.push({ tail: t, read: SP.tailOf([0xCA, 2].concat(decoy, t), 2) });
    } else throw new Error('unknown op ' + op[0]);
  }
  return { steps, end: summary(SP, st), st };
}
function build(SP) {
  return { about: 'golden cases of streak-plan.js (O181); generated by tools/gen-streak-fixtures.js -- do not edit by hand', rulesVer: SP.RULES_VER,
    cases: CASES.map((c) => { const { name, kind } = c, inp = Object.assign({}, c); delete inp.name; delete inp.kind; return { name, kind, in: inp, out: replay(SP, c) }; }) };
}
const canonHash = (text) => crypto.createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex').slice(0, 16);
function render(doc) {
  return '{\n  "about": ' + JSON.stringify(doc.about) + ',\n  "rulesVer": ' + JSON.stringify(doc.rulesVer) + ',\n  "cases": [\n'
    + doc.cases.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]\n}\n';
}
function main() {
  const SP = require(path.join(__dirname, '..', 'streak-plan.js'));
  const text = render(build(SP));
  const check = process.argv.indexOf('--check') >= 0;
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  if (check) {
    if (cur !== text) { console.log('[streak-fixtures] DRIFT: ' + path.relative(process.cwd(), FILE) + ' is not what streak-plan.js gives today'); process.exit(1); }
    console.log('[streak-fixtures] up to date (' + CASES.length + ' cases, hash ' + canonHash(text) + ')');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, text);
  console.log('[streak-fixtures] wrote ' + CASES.length + ' cases -> FIXTURES_HASH \'' + canonHash(text) + '\'' + (SP.FIXTURES_HASH === canonHash(text) ? ' (matches streak-plan.js)' : ' (set it in streak-plan.js)'));
}

module.exports = { CASES, FILE, replay, build, render, canonHash };
if (require.main === module) main();
