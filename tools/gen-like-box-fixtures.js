'use strict';
// ============================================================
// gen-like-box-fixtures.js - golden cases of the two likes row layouts (O520, knife 5.4d)
// ============================================================
// Writes fixtures/like-box/cases.json: hand-picked rows of the like_box (client writes, this job reads) and the like_count
// (this job writes, the client reads) layouts, with what like-plan.js gives for them today. The client replays the file
// against its own codec (knife 5.4d L2: src/systems/like-box.js encoder; L3: src/systems/like-dir.js count reader), so a
// layout that moves on one side only turns one of the two suites red. The file also carries the lane's constants the
// client mirrors (box size, the 7-day pair rule of a board like).
//   node tools/gen-like-box-fixtures.js           write the file
//   node tools/gen-like-box-fixtures.js --check   exit 1 when the file is not what a fresh generation gives
// Case kinds:
//   box:     { entries: [{ sid, ref, kind, min }] } -> encodeBox (int32[])
//   unbox:   { det: int32[] } -> decodeBox ({ ver, entries } | null)
// A SteamID is written as its two int32 halves [lo, hi], low then high (the way the box row stores it; the match-sig
// fixtures do the same), never as the 17-digit string: replay() turns [lo, hi] into the decimal string like-plan.js takes
// before encodeBox, and the sid of each entry decodeBox gives back into [lo, hi]. The ints of every row are what they are.
//   count:   { c: { n, sn, s, m, b } } -> countRow ({ score, details })
//   uncount: { score, det } -> decodeCount ({ n, sn, s, m, b } | null)
// ============================================================
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'fixtures', 'like-box', 'cases.json');
const sid = (lo, hi) => [lo | 0, hi | 0];
const H = 17825793;   // the high int32 of an individual account id
const A = sid(39734273, H), B = sid(163191061, H), C = sid(2039734271, H), D = sid(0, H);
const M0 = 29877660;   // a unix minute (2026-10-22)
const MATCH = (sid, ref, dm) => ({ sid, ref, kind: 1, min: M0 + (dm | 0) });
const BOARD = (sid, dm) => ({ sid, ref: 0, kind: 2, min: M0 + (dm | 0) });
const W0 = (ver, n) => (0xDD | (ver << 8) | (n << 16)) | 0;
const CW0 = (ver) => (0xDC | (ver << 8)) | 0;

const CASES = [
  // ---- the box row the client writes ----
  { name: 'empty queue', kind: 'box', entries: [] },
  { name: 'one match like', kind: 'box', entries: [MATCH(B, 1234567, 0)] },
  { name: 'one board like', kind: 'box', entries: [BOARD(B, 0)] },
  { name: 'negative match hash', kind: 'box', entries: [MATCH(C, -2085177983, 3)] },
  { name: 'mixed queue in order', kind: 'box', entries: [MATCH(B, 7, 0), BOARD(C, 1), MATCH(D, -1, 2), BOARD(A, 3)] },
  { name: 'high SteamID halves', kind: 'box', entries: [BOARD(sid(-1, H), 0)] },
  { name: 'full queue (15)', kind: 'box', entries: Array.from({ length: 15 }, (_, i) => (i % 2 ? BOARD(B, i) : MATCH(C, 1000 + i, i))) },
  { name: 'over-full queue keeps the first 15', kind: 'box', entries: Array.from({ length: 17 }, (_, i) => BOARD(D, i)) },
  // ---- the box rows this job reads (good and bad) ----
  { name: 'decode one of each kind', kind: 'unbox', det: [W0(1, 2), -1147483647, 17825792, 1234567, (M0 * 4 + 1) | 0, 1, 17825793, 0, (M0 * 4 + 2) | 0] },
  { name: 'decode an empty row', kind: 'unbox', det: [W0(1, 0)] },
  { name: 'wrong magic', kind: 'unbox', det: [0xDA | (1 << 8), 0, 0, 0, 0] },
  { name: 'wrong magic 0xDB (planned before 2026-10-22, now the Q61 block)', kind: 'unbox', det: [(0xDB | (1 << 8) | (1 << 16)) | 0, 1, 17825792, 5, (M0 * 4 + 1) | 0] },
  { name: 'unknown layout version', kind: 'unbox', det: [W0(2, 1), 1, 17825792, 5, (M0 * 4 + 1) | 0] },
  { name: 'count over the box size', kind: 'unbox', det: [W0(1, 16)].concat(new Array(64).fill(0)) },
  { name: 'row shorter than its count', kind: 'unbox', det: [W0(1, 2), 1, 17825792, 5, (M0 * 4 + 1) | 0] },
  { name: 'extra words after the entries are ignored', kind: 'unbox', det: [W0(1, 1), 1, 17825792, 5, (M0 * 4 + 1) | 0, 99, 98] },
  { name: 'kind 0 and 3 decode as they are (the job rejects them)', kind: 'unbox', det: [W0(1, 2), 1, 17825792, 5, (M0 * 4) | 0, 2, 17825792, 0, (M0 * 4 + 3) | 0] },
  { name: 'not an array', kind: 'unbox', det: null },
  // ---- the like_count row this job writes ----
  { name: 'first like (match)', kind: 'count', c: { n: 1, sn: 0, s: 1, m: 1, b: 0 } },
  { name: 'season 1 counts', kind: 'count', c: { n: 523, sn: 1, s: 40, m: 500, b: 23 } },
  // ---- the like_count rows the client reads ----
  { name: 'read a row', kind: 'uncount', score: 523, det: [CW0(1), 1, 40, 500, 23] },
  { name: 'read a row with a trailing word', kind: 'uncount', score: 7, det: [CW0(1), 2, 1, 3, 4, 0] },
  { name: 'unknown count layout', kind: 'uncount', score: 7, det: [CW0(2), 1, 1, 1, 1] },
  { name: 'short count row', kind: 'uncount', score: 7, det: [CW0(1), 1, 1, 1] },
  { name: 'negative part', kind: 'uncount', score: 7, det: [CW0(1), 1, -1, 1, 1] },
];

// [lo, hi] <-> the decimal string like-plan.js takes and gives (own BigInt code, not like-plan.js's, so a broken split /
// join there still shows up as a case that no longer replays)
const sidText = (h) => ((BigInt(h[1] >>> 0) << 32n) | BigInt(h[0] >>> 0)).toString();
const sidHalves = (t) => { const b = BigInt(t); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
function replay(LP, c) {
  if (c.kind === 'box') return LP.encodeBox(c.entries.map((e) => Object.assign({}, e, { sid: sidText(e.sid) })));
  if (c.kind === 'unbox') {
    const r = LP.decodeBox(c.det);
    return r && { ver: r.ver, entries: r.entries.map((e) => Object.assign({}, e, { sid: sidHalves(e.sid) })) };
  }
  if (c.kind === 'count') return LP.countRow(c.c);
  if (c.kind === 'uncount') return LP.decodeCount(c.score, c.det);
  throw new Error('unknown case kind ' + c.kind);
}
function consts(LP) {
  const L = LP.LIKE;
  return { BOX_LB: L.BOX_LB, COUNT_LB: L.COUNT_LB, BOX_MAGIC: L.BOX_MAGIC, BOX_VER: L.BOX_VER, COUNT_MAGIC: L.COUNT_MAGIC, COUNT_VER: L.COUNT_VER,
    BOX_MAX: L.BOX_MAX, KIND_MATCH: L.KIND_MATCH, KIND_BOARD: L.KIND_BOARD, PAIR_WEEK_MIN: L.PAIR_WEEK_MIN, ENTRY_TTL_MIN: L.ENTRY_TTL_MIN };
}
function build(LP) {
  return { about: 'golden cases of the like_box / like_count rows (O520 knife 5.4d, like-plan.js); generated by tools/gen-like-box-fixtures.js -- do not edit by hand',
    consts: consts(LP),
    cases: CASES.map((c) => { const { name, kind } = c, inp = Object.assign({}, c); delete inp.name; delete inp.kind; return { name, kind, in: inp, out: replay(LP, c) }; }) };
}
function render(doc) {
  return '{\n  "about": ' + JSON.stringify(doc.about) + ',\n  "consts": ' + JSON.stringify(doc.consts) + ',\n  "cases": [\n'
    + doc.cases.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]\n}\n';
}
function main() {
  const LP = require(path.join(__dirname, '..', 'like-plan.js'));
  const text = render(build(LP));
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  if (process.argv.indexOf('--check') >= 0) {
    if (cur !== text) { console.log('[like-box-fixtures] DRIFT: ' + path.relative(process.cwd(), FILE) + ' is not what like-plan.js gives today'); process.exit(1); }
    console.log('[like-box-fixtures] up to date (' + CASES.length + ' cases)');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, text);
  console.log('[like-box-fixtures] wrote ' + CASES.length + ' cases');
}

module.exports = { CASES, FILE, replay, build, render, consts };
if (require.main === module) main();
