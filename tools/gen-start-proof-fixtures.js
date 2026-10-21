'use strict';
// ============================================================
// gen-start-proof-fixtures.js - the golden cases of start-proof.js (O462)
// ============================================================
// Writes fixtures/start-proof/cases.json: hand-picked inputs (the CASES below) and what start-proof.js gives for them today.
// Both repos replay the file -- this repo's test/start-proof.js against start-proof.js, the client's against its vendored
// copy -- so a commitment, a derivation or a block layout that moves on one side only turns one of them red.
//   node tools/gen-start-proof-fixtures.js           write the file and print its FIXTURES_HASH
//   node tools/gen-start-proof-fixtures.js --check   exit 1 when the file is not what a fresh generation gives
// Regenerate only with a rules change (RULES_VER + 1 and FIXTURES_HASH in start-proof.js, same change), and read the diff.
// Case kinds:
//   hash:   { s } -> hash32(s)
//   derive: { h } -> derive(h)
//   bind:   { n, pc, ro } -> { m: bind(...), tail: tail(n) }
//   check:  { d } -> { state: check(d), n: nonceOf(d) }   (d built here from a bound match, then possibly tampered)
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'start-proof', 'cases.json');
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

const N1 = '00112233445566778899aabbccddeeff';
const N2 = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';
const N3 = '7fffffff80000000ffffffff00000001';
// roster ints as the client writes them (encodeSid: low then high int32 per seat; '0' seats are 0, 0)
const sid = (lo, hi) => [lo | 0, hi | 0];
const R2 = [].concat(sid(1194683941, 17825793), sid(-2027419035, 17825793));
const R3 = [].concat(sid(1194683941, 17825793), sid(0, 0), sid(77, 17825793));
const R6 = [].concat(sid(11, 17825793), sid(-12, 17825793), sid(13, 17825793), sid(2147483647, 17825793), sid(-2147483648, 17825793), sid(16, 17825793));

// a start record the way the client writes it: head, pc zero scores, disp 0, roster, then the extra ints
function rec(SP, mt, n, pc, ro, seat, extra) {
  const m = SP.bind(n, pc, ro, sha);
  const d = [0xB2, SP.START_VER, mt, SP.hash32(m.matchId), m.runSeed, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  return d.concat(ro, extra == null ? SP.tail(n) : extra);
}
function tamper(d, i, v) { const o = d.slice(); o[i] = v | 0; return o; }

function cases(SP) {
  const ok2 = rec(SP, 2, N1, 2, R2, 0);
  const ok3 = rec(SP, 1 | (1 << 4), N2, 3, R3, 2);
  const ok6 = rec(SP, 9, N3, 6, R6, 5);
  const otherBlock = [(0x77 | (1 << 8) | (2 << 16)) | 0, 5, 6];
  return [
    ...['', 'm_0123456789abcdef01234567', 'm_1700000000000_1a2b3c_ff'].map((s) => ({ name: 'hash32 of ' + JSON.stringify(s), kind: 'hash', s })),
    { name: 'derive: zero seed bits -> seed 1', kind: 'derive', h: '0'.repeat(64) },
    { name: 'derive: all ones -> top seed 2^31-1', kind: 'derive', h: 'f'.repeat(64) },
    { name: 'derive: not 64 hex -> null', kind: 'derive', h: 'abc' },
    { name: 'bind 1V1 ranked', kind: 'bind', n: N1, pc: 2, ro: R2 },
    { name: 'bind 3 seats with an empty seat', kind: 'bind', n: N2, pc: 3, ro: R3 },
    { name: 'bind 6 seats with int32 extremes', kind: 'bind', n: N3, pc: 6, ro: R6 },
    { name: 'bind: one roster int moved -> another match', kind: 'bind', n: N1, pc: 2, ro: R2.slice(0, 3).concat([R2[3] + 1]) },
    { name: 'bind: uppercase nonce -> null', kind: 'bind', n: N1.toUpperCase(), pc: 2, ro: R2 },
    { name: 'bind: roster length off -> null', kind: 'bind', n: N1, pc: 3, ro: R2 },
    { name: 'check: 1V1 record with its block', kind: 'check', d: ok2 },
    { name: 'check: 3-seat record with its block', kind: 'check', d: ok3 },
    { name: 'check: 6-seat record (34 ints) with its block', kind: 'check', d: ok6 },
    { name: 'check: version 1 record, no block', kind: 'check', d: tamper(ok2.slice(0, SP.tailStart(2)), 1, 1) },
    { name: 'check: block behind another self-describing block', kind: 'check', d: rec(SP, 2, N1, 2, R2, 1, otherBlock.concat(SP.tail(N1))) },
    { name: 'check: block of an unknown version', kind: 'check', d: tamper(ok2, SP.tailStart(2), (SP.TAIL_MAGIC | (2 << 8) | (SP.TAIL_LEN << 16))) },
    { name: 'check: block cut short', kind: 'check', d: ok2.slice(0, ok2.length - 1) },
    { name: 'check: copied block, another roster (an outside account seated itself)', kind: 'check', d: tamper(ok2, SP.rosterStart(2) + 2, 999) },
    { name: 'check: copied block, another seed', kind: 'check', d: tamper(ok2, 4, ok2[4] + 1) },
    { name: 'check: copied block, another matchHash', kind: 'check', d: tamper(ok2, 3, ok2[3] ^ 1) },
    { name: 'check: own n with a roster it was never bound to', kind: 'check', d: rec(SP, 2, N2, 2, R2, 0).slice(0, SP.tailStart(2)).concat(SP.tail(N1)) },
    { name: 'check: seat count out of range', kind: 'check', d: tamper(ok2, 8, 9) },
    { name: 'check: too short to hold its roster', kind: 'check', d: ok6.slice(0, 20) },
  ];
}
function replay(SP, c) {
  if (c.kind === 'hash') return SP.hash32(c.s);
  if (c.kind === 'derive') return SP.derive(c.h);
  if (c.kind === 'bind') return { m: SP.bind(c.n, c.pc, c.ro, sha), tail: SP.tail(c.n) };
  if (c.kind === 'check') return { state: SP.check(c.d, sha), n: SP.nonceOf(c.d) };
  throw new Error('unknown case kind ' + c.kind);
}
function build(SP) {
  return { about: 'golden cases of start-proof.js (O462); generated by tools/gen-start-proof-fixtures.js -- do not edit by hand', rulesVer: SP.RULES_VER,
    cases: cases(SP).map((c) => { const { name, kind } = c, inp = Object.assign({}, c); delete inp.name; delete inp.kind; return { name, kind, in: inp, out: replay(SP, c) }; }) };
}
const canonHash = (text) => crypto.createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex').slice(0, 16);
function render(doc) {
  return '{\n  "about": ' + JSON.stringify(doc.about) + ',\n  "rulesVer": ' + JSON.stringify(doc.rulesVer) + ',\n  "cases": [\n'
    + doc.cases.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]\n}\n';
}
function main() {
  const SP = require(path.join(__dirname, '..', 'start-proof.js'));
  const text = render(build(SP));
  const check = process.argv.indexOf('--check') >= 0;
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  if (check) {
    if (cur !== text) { console.log('[start-proof-fixtures] DRIFT: ' + path.relative(process.cwd(), FILE) + ' is not what start-proof.js gives today'); process.exit(1); }
    console.log('[start-proof-fixtures] up to date (' + build(SP).cases.length + ' cases, hash ' + canonHash(text) + ')');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, text);
  console.log('[start-proof-fixtures] wrote ' + build(SP).cases.length + ' cases -> FIXTURES_HASH \'' + canonHash(text) + '\'' + (SP.FIXTURES_HASH === canonHash(text) ? ' (matches start-proof.js)' : ' (set it in start-proof.js)'));
}

module.exports = { FILE, sha, cases, replay, build, render, canonHash };
if (require.main === module) main();
