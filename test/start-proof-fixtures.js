'use strict';
// Golden cases of start-proof.js (O462): the matchmade start record's seat commitment lives in one self-contained module that
// this job requires and the client runs as a comment-stripped copy (it replays the same cases), so a commitment, a derivation
// or a block layout that moves on one side only turns one of the two suites red.
//   [1] fixtures/start-proof/cases.json is what tools/gen-start-proof-fixtures.js generates from start-proof.js today
//   [2] FIXTURES_HASH in start-proof.js is the file's canonical hash; the file's rulesVer is RULES_VER
//   [3] every case replays to its out
//   [4] coverage: every kind, and ok / bad / none among the checks
//   [5] the module loads the way the client loads it: comments stripped, new Function('window', src) -> window.START_PROOF,
//       same outputs for every case
//   [6] the module stays self-contained: no require, no process, no clock, no block comment, ASCII-only code
//   [7] properties over random rosters: a record built from its own bind checks ok; moving any one roster int, the seed or
//       the matchHash turns it bad; dropping the block turns it none; every seat count fits a leaderboard row (64 ints)
//   [8] mutation: a copy with the commitment tag moved fails cases (the replay really compares)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SP = require(path.join(ROOT, 'start-proof.js'));
const G = require(path.join(ROOT, 'tools', 'gen-start-proof-fixtures.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const text = fs.readFileSync(G.FILE, 'utf8');
const doc = JSON.parse(text);

console.log('=== start-proof golden cases (O462) ===');
// [1]
T('[1] the case file is what the generator gives today (node tools/gen-start-proof-fixtures.js to regenerate)', G.render(G.build(SP)) === text);
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
  T('[4] all four kinds present', ['hash', 'derive', 'bind', 'check'].every((k) => kinds.has(k)), [...kinds].join(','));
  const states = new Set(doc.cases.filter((c) => c.kind === 'check').map((c) => c.out.state));
  T('[4] ok, bad and none all appear among the checks', ['ok', 'bad', 'none'].every((s) => states.has(s)), [...states].join(','));
  T('[4] a 6-seat record with its block fits a row', doc.cases.some((c) => c.kind === 'check' && c.out.state === 'ok' && c.in.d[8] === 6 && c.in.d.length <= SP.MAX_DETAILS));
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
const SRC = fs.readFileSync(path.join(ROOT, 'start-proof.js'), 'utf8');
const code = strip(SRC);
{
  const win = {};
  let err = null;
  try { new Function('window', code)(win); } catch (e) { err = e; }
  T('[5] the stripped copy loads with new Function(\'window\', src) onto window.START_PROOF', !err && win.START_PROOF && typeof win.START_PROOF.check === 'function', err && err.message);
  if (win.START_PROOF) T('[5] the stripped copy replays every case to its out', J(replayAll(win.START_PROOF)) === J(want));
  if (win.START_PROOF) T('[5] the stripped copy carries the same RULES_VER and FIXTURES_HASH', win.START_PROOF.RULES_VER === SP.RULES_VER && win.START_PROOF.FIXTURES_HASH === SP.FIXTURES_HASH);
}
// [6]
T('[6] no require, no process, no clock in the module code', !/\brequire\s*\(|\bprocess\b|\bDate\b|\bperformance\b/.test(code));
T('[6] no block comment in the module (the client copy strips // lines only)', !/\/\*/.test(SRC));
T('[6] ASCII-only module code', !/[^\x00-\x7f]/.test(code));
// [7] properties (seeded, deterministic)
{
  let seed = 20261021;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const i32 = () => ((rnd(65536) << 16) | rnd(65536)) | 0;
  const hex = (k) => { let s = ''; for (let i = 0; i < k; i++) s += '0123456789abcdef'[rnd(16)]; return s; };
  let okN = 0, okBad = 0, moveN = 0, moveBad = 0, noneN = 0, noneBad = 0, fitBad = 0;
  for (let it = 0; it < 300; it++) {
    const pc = 1 + rnd(SP.MAX_SEATS), n = hex(32), ro = [];
    for (let i = 0; i < 2 * pc; i++) ro.push(rnd(4) === 0 ? 0 : i32());
    const m = SP.bind(n, pc, ro, G.sha);
    const d = [0xB2, SP.START_VER, 1 + rnd(9), SP.hash32(m.matchId), m.runSeed, rnd(pc), 0, 0, pc, 0];
    for (let i = 0; i < pc; i++) d.push(0);
    d.push(0);
    const full = d.concat(ro, SP.tail(n));
    if (full.length > SP.MAX_DETAILS) fitBad++;
    if (SP.check(full, G.sha) === 'ok' && SP.nonceOf(full) === n && m.runSeed >= 1 && m.runSeed <= 0x7fffffff && /^m_[0-9a-f]{24}$/.test(m.matchId)) okN++; else okBad++;
    const at = [3, 4, SP.rosterStart(pc) + rnd(2 * pc)][rnd(3)];
    const moved = full.slice(); moved[at] = (moved[at] + 1 + rnd(1000)) | 0;
    if (SP.check(moved, G.sha) === 'bad') moveN++; else moveBad++;
    if (SP.check(full.slice(0, SP.tailStart(pc)), G.sha) === 'none') noneN++; else noneBad++;
  }
  T('[7] a record built from its own bind checks ok (' + okN + ' rosters)', okBad === 0, okBad + ' not ok');
  T('[7] one roster int, the seed or the matchHash moved -> bad (' + moveN + ')', moveBad === 0, moveBad + ' not bad');
  T('[7] no block -> none (' + noneN + ')', noneBad === 0, noneBad + ' not none');
  T('[7] every seat count up to MAX_SEATS fits ' + SP.MAX_DETAILS + ' ints with its block', fitBad === 0 && SP.tailStart(SP.MAX_SEATS) + 1 + SP.TAIL_LEN <= SP.MAX_DETAILS, fitBad + ' too long');
  T('[7] a junk sha256 function or a throwing one gives no binding', SP.bind('0'.repeat(32), 1, [1, 2], () => 'zz') === null && SP.bind('0'.repeat(32), 1, [1, 2], () => { throw new Error('x'); }) === null);
}
// [8] mutation
{
  const mut = code.replace("'gmt-o462-seat|1|'", "'gmt-o462-seat|2|'");
  if (mut === code) bad('[8] mutation target (the commitment tag) not found');
  else {
    const w = {}; new Function('window', mut)(w);
    const red = replayAll(w.START_PROOF).filter((x, i) => x !== want[i]).length;
    T('[8] a copy with the commitment tag moved fails ' + red + ' case(s)', red > 0);
  }
}

console.log(failN ? ('start-proof-fixtures: ' + failN + ' FAIL') : 'start-proof-fixtures: all ok');
process.exit(failN ? 1 : 0);
