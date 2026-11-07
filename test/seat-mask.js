'use strict';
// O716 one queue for quick + ranked: the ranked-seat mask in bits 11-16 of the match type.
//   [1] helpers: no mask = the old whole-table rule (2/4/6/9 all-ranked, 1/3/5/8 all-quick); a mask = per seat
//   [2] old match types are untouched by mtSansSeats (the party / trio bits below bit 11 stay)
//   [3] validate.js compares no raw match type to a number (a mixed table carries the mask; compare mtSansSeats / baseMt):
//       neither a record's d[2] nor a pending entry's mt (pending[m].mt is the start record's d[2], mask and all)
//   [4] mutation: a raw comparison put back is caught by [3] (one of each form)
//   [5] sanityFlags, three mask checks (each a header reason, Q294): (a) a mask on the demo / playtest job -> 'mt';
//       (b) a mask on a code that never carries one (endless / friends' room / bot / the old ranked codes) -> 'seat-mask';
//       (c) a bit past the seats -> 'seat-mask-range'; a clean mixed table on every quick family base passes on the live job
//   [6] mutation: each check taken out (validate.js with it removed) stops flagging its case
//   [7] the three reasons are header reasons (a modded host's mask holds the match and flags no joiner)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const PP = require('../points-plan.js');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('  ok    ' + name); }

ok('[1] no mask: the old whole-table rule', () => {
  for (const mt of [2, 4, 6, 9, 2 | (3 << 4), 9 | (1 << 8)]) { assert.strictEqual(PP.anyAppliesLp(mt), true); for (let s = 0; s < 6; s++) assert.strictEqual(PP.seatAppliesLp(mt, s), true); }
  for (const mt of [1, 3, 5, 8, 7, 10, 11, 1 | (3 << 4)]) { assert.strictEqual(PP.anyAppliesLp(mt), false); for (let s = 0; s < 6; s++) assert.strictEqual(PP.seatAppliesLp(mt, s), false); }
});
ok('[1] a mask: per seat, on a quick family base', () => {
  const mt = 1 | (0b000101 << PP.RANKED_SEAT_SHIFT);   // seats 0 and 2 ranked, 1 and 3 quick
  assert.strictEqual(PP.rankedSeatMaskOf(mt), 0b000101);
  assert.deepStrictEqual([0, 1, 2, 3].map(s => PP.seatAppliesLp(mt, s)), [true, false, true, false]);
  assert.strictEqual(PP.anyAppliesLp(mt), true);
  assert.strictEqual(PP.appliesLp(mt), false);   // the whole-table rule alone would miss the ranked seats
});
ok('[1] the mask is six bits (seats 0..5): a bit above 16 is not a seat', () => {
  assert.strictEqual(PP.RANKED_SEAT_SHIFT, 11);
  assert.strictEqual(PP.rankedSeatMaskOf(1 | (0x7F << 11)), 0x3F);
  assert.strictEqual(PP.rankedSeatMaskOf(1 | (1 << 17)), 0);
  assert.strictEqual(PP.rankedSeatMaskOf('2'), 0);
});
ok('[2] mtSansSeats keeps the party / trio bits, drops only the mask', () => {
  const base = 3 | (0b0011 << 4) | (2 << 8);
  assert.strictEqual(PP.mtSansSeats(base), base);
  assert.strictEqual(PP.mtSansSeats(base | (0b110000 << PP.RANKED_SEAT_SHIFT)), base);
  assert.strictEqual(PP.baseMt(base | (0b1 << PP.RANKED_SEAT_SHIFT)), 3);
  for (const mt of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 2 | (5 << 4), 1 | (1 << 4) | (3 << 8)]) assert.strictEqual(PP.mtSansSeats(mt), mt);
});
const RAW = [
  /\(\s*[A-Za-z_$][\w$.]*\.d\[2\]\s*\|\s*0\s*\)\s*(?:!==|===|!=|==)\s*(?:\d|[A-Z_]+\.MT\b)/g,   // (r.d[2] | 0) !== 2
  /\(\s*(?:[A-Za-z_$][\w$]*\.)?mt\s*\|\s*0\s*\)\s*(?:!==|===|!=|==)\s*(?:\d|[A-Z_]+\.MT\b)/g,   // (p.mt | 0) !== QUIT_LONE.MT
];
function rawCompares(src) { const out = []; for (const re of RAW) out.push(...(src.match(re) || [])); return out; }
const VFILE = path.join(__dirname, '..', 'validate.js');
const VSRC = fs.readFileSync(VFILE, 'utf8');
ok('[3] validate.js compares no raw match type to a number', () => {
  const hits = rawCompares(VSRC);
  assert.deepStrictEqual(hits, [], 'compare mtSansSeats(d[2]) or baseMt(d[2]) instead: ' + hits.join(' | '));
});
ok('[4] mutation: a raw comparison put back is caught (a record\'s d[2], a pending entry\'s mt)', () => {
  for (const [from, to] of [['mtSansSeats(r0.d[2]) !== 2', '(r0.d[2] | 0) !== 2'], ['mtSansSeats(p.mt) !== QUIT_LONE.MT || consistentKeys', '(p.mt | 0) !== QUIT_LONE.MT || consistentKeys']]) {
    assert.strictEqual(VSRC.split(from).length, 2, 'anchor once: ' + from);
    assert.strictEqual(rawCompares(VSRC.replace(from, to)).length, 1, from);
  }
});

// ---- [5] / [6] sanityFlags (a child per job: PT_MODE is read at load) ----
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT;
// two writers (seats 0 and 1) of one key: d = [magic, ver, mt, hash, seed, seat, rank, prog, pc, dur, ...scores, disp]
function flagsIn(file, ptMode, cases) {
  const script = [
    'const v=require(' + JSON.stringify(file) + ');',
    'const cs=' + JSON.stringify(cases) + ';',
    'const out=cs.map(function(c){var ro={};for(var i=0;i<c.pc;i++)ro[i]="7656119800000000"+(i+1);',
    'return v.sanityFlags([0,1].map(function(s){var d=[0xB1,3,c.mt,111,7,s,s+1,1,c.pc,600];for(var i=0;i<c.pc;i++)d.push(100*(i+1));',
    'd.push(0);return{steamID:ro[s],d:d,roster:ro,dispCode:0};}));});',
    'console.log(JSON.stringify(out));',
  ].join('');
  const env = Object.assign({}, process.env);
  delete env.PT_MODE;
  if (ptMode) env.PT_MODE = '1';
  const txt = cp.execFileSync(process.execPath, ['-e', script], { env, cwd: path.dirname(file) }).toString().trim();
  return JSON.parse(txt.split('\n').pop());
}
const CLEAN = [
  ['brawl of three, seat 1 ranked', { mt: 1 | S(0b010), pc: 3 }],
  ['brawl of six, every seat ranked', { mt: 1 | S(0b111111), pc: 6 }],
  ['brawl of four with a ranked pair (party bit 0)', { mt: 1 | (1 << 4) | S(0b0011), pc: 4 }],
  ['team brawl (3), seats 0 and 3 ranked', { mt: 3 | S(0b1001), pc: 4 }],
  ['2V2 (5), one ranked seat a side', { mt: 5 | S(0b0101), pc: 4 }],
  ['3V3 (8), the ranked trio', { mt: 8 | S(0b000111), pc: 6 }],
];
const BAD = {
  // [5b] a code that never carries a mask
  endless: ['endless (7) with a mask', { mt: 7 | S(0b01), pc: 2 }, 'seat-mask'],
  friends: ['a friends\' room (10) with a mask', { mt: 10 | S(0b01), pc: 2 }, 'seat-mask'],
  bot: ['a bot match (11) with a mask', { mt: 11 | S(0b01), pc: 2 }, 'seat-mask'],
  ranked2: ['the old ranked brawl code (2) with a mask', { mt: 2 | S(0b01), pc: 2 }, 'seat-mask'],
  ranked4: ['the old ranked team brawl code (4) with a mask', { mt: 4 | S(0b0011), pc: 4 }, 'seat-mask'],
  ranked6: ['the old ranked 2V2 code (6) with a mask', { mt: 6 | S(0b0001), pc: 4 }, 'seat-mask'],
  ranked9: ['the old ranked 3V3 code (9) with a mask', { mt: 9 | S(0b000111), pc: 6 }, 'seat-mask'],
  // [5c] a bit past the seats
  past2: ['a 1V1 with seat 2 ranked', { mt: 1 | S(0b100), pc: 2 }, 'seat-mask-range'],
  past3: ['a brawl of three with seat 5 ranked', { mt: 1 | S(0b100001), pc: 3 }, 'seat-mask-range'],
  past4: ['a 2V2 with seat 4 ranked', { mt: 5 | S(0b10000), pc: 4 }, 'seat-mask-range'],
};
const BAD_LIST = Object.keys(BAD).map(k => BAD[k][1]);
const live = flagsIn(VFILE, false, CLEAN.map(c => c[1]).concat(BAD_LIST));
const demo = flagsIn(VFILE, true, CLEAN.map(c => c[1]).concat([{ mt: 1, pc: 3 }]).concat(BAD_LIST));
ok('[5] a clean mixed table on every quick family base passes (live job)', () => {
  CLEAN.forEach((c, i) => assert.deepStrictEqual(live[i], [], c[0] + ': ' + JSON.stringify(live[i])));
});
ok('[5a] the demo / playtest job: any mask -> \'mt\' (no ranked entry there); a maskless quick record passes', () => {
  CLEAN.forEach((c, i) => assert.ok(demo[i].indexOf('mt') >= 0, c[0] + ': ' + JSON.stringify(demo[i])));
  assert.deepStrictEqual(demo[CLEAN.length], []);
  Object.keys(BAD).forEach((k, i) => assert.strictEqual(demo[CLEAN.length + 1 + i].filter(f => f === 'mt').length, 1, BAD[k][0] + ': one \'mt\''));
});
ok('[5b] [5c] a mask on a code that never carries one / a bit past the seats', () => {
  Object.keys(BAD).forEach((k, i) => {
    const got = live[CLEAN.length + i];
    assert.ok(got.indexOf(BAD[k][2]) >= 0, BAD[k][0] + ' -> ' + BAD[k][2] + ' (got ' + JSON.stringify(got) + ')');
  });
  // a maskless record of each of these codes is not touched by the new checks
  const plain = flagsIn(VFILE, false, [{ mt: 2, pc: 2 }, { mt: 4, pc: 4 }, { mt: 6, pc: 4 }, { mt: 9, pc: 6 }, { mt: 1, pc: 2 }]);
  plain.forEach((f, i) => assert.ok(f.indexOf('seat-mask') < 0 && f.indexOf('seat-mask-range') < 0, 'maskless #' + i + ': ' + JSON.stringify(f)));
});
const MUT = {
  pt: ["    if (PT_MODE && out.indexOf('mt') < 0) out.push('mt');\n", ''],
  base: ["    if (SEAT_MASK_BASES.indexOf(base) < 0) out.push('seat-mask');\n", ''],
  range: ["    if ((seatMask >> Math.max(0, Math.min(pc, 6))) !== 0) out.push('seat-mask-range');\n", ''],
};
function withMutant(key, fn) {
  const [from, to] = MUT[key];
  assert.strictEqual(VSRC.split(from).length, 2, 'mutant ' + key + ': anchor once');
  const file = path.join(__dirname, '..', '.mutant-seat-mask-' + process.pid + '-' + key + '.js');
  fs.writeFileSync(file, VSRC.replace(from, to));
  try { fn(file); } finally { try { fs.unlinkSync(file); } catch (e) {} }
}
ok('[6] mutation: the demo-job check taken out -> a mixed quick record passes the demo job', () => {
  withMutant('pt', (f) => { const got = flagsIn(f, true, [CLEAN[0][1]]); assert.ok(got[0].indexOf('mt') < 0, JSON.stringify(got)); });
});
ok('[6] mutation: the base check taken out -> a mask on the old ranked code / endless passes', () => {
  withMutant('base', (f) => { const got = flagsIn(f, false, [BAD.ranked2[1], BAD.endless[1]]); for (const g of got) assert.ok(g.indexOf('seat-mask') < 0, JSON.stringify(got)); });
});
ok('[6] mutation: the range check taken out -> a bit past the seats passes', () => {
  withMutant('range', (f) => { const got = flagsIn(f, false, [BAD.past2[1], BAD.past4[1]]); for (const g of got) assert.deepStrictEqual(g, [], JSON.stringify(got)); });
});
ok('[7] the mask reasons are header reasons (Q294: held, no joiner flagged)', () => {
  const v = require(VFILE);
  for (const s of ['mt', 'seat-mask', 'seat-mask-range']) assert.ok(v.SANITY_HEADER_SLUGS.indexOf(s) >= 0, s);
});
console.log('seat-mask: ' + n + ' ok');
