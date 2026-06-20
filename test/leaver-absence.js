'use strict';
const path = require('path');
const { detectLeavers, decodeSid, decodeRoster } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const mkRec = (seat, roster, steamID) => { const d = []; d[5] = seat; return { d, roster, steamID: steamID || ('w' + seat) }; };
const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', X = '76561198000099999';
const sortLv = (lv) => lv.slice().sort((a, b) => a.seat - b.seat);

console.log('=== detectLeavers ===');

{
  const g = [mkRec(0, { 0: A, 1: B, 2: C }, A), mkRec(1, { 0: A, 1: B, 2: C }, B)];
  eq('3P seat2 absent -> [{seat2, C}]', sortLv(detectLeavers(g)), [{ seat: 2, steamID: C }]);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: C }, A), mkRec(1, { 0: A, 1: B, 2: C }, B), mkRec(2, { 0: A, 1: B, 2: C }, C)];
  eq('3P all present -> []', detectLeavers(g), []);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: C }, A)];
  eq('lone (1 present) -> [] (no co-sign)', detectLeavers(g), []);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: X }, A), mkRec(1, { 0: A, 1: B, 2: C }, B)];
  eq('frame defense: seat2 roster split (C vs X) -> []', detectLeavers(g), []);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: C, 3: D }, A), mkRec(1, { 0: A, 1: B, 2: C, 3: D }, B)];
  eq('4P seat2+seat3 absent -> [{2,C},{3,D}]', sortLv(detectLeavers(g)), [{ seat: 2, steamID: C }, { seat: 3, steamID: D }]);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: C, 3: D }, A), mkRec(1, { 0: A, 1: B, 2: C, 3: D }, B), mkRec(2, { 0: A, 1: B, 2: C, 3: D }, C)];
  eq('4P seat3 absent (3 finishers agree) -> [{3,D}]', sortLv(detectLeavers(g)), [{ seat: 3, steamID: D }]);
}
{
  const g = [mkRec(0, { 0: A, 1: B, 2: C, 3: D }, A), mkRec(1, { 0: A, 1: B, 2: C, 3: D }, B), mkRec(2, { 0: A, 1: B, 2: C, 3: X }, C)];
  eq('4P seat3 absent, 2 say D / 1 says X -> majority D', sortLv(detectLeavers(g)), [{ seat: 3, steamID: D }]);
}
{
  const g = [mkRec(0, {}, A), mkRec(1, {}, B)];
  eq('empty roster -> [] (backward compat)', detectLeavers(g), []);
}
{
  const g = [mkRec(0, { 0: A, 1: B }, A), mkRec(1, { 0: A, 1: B }, B)];
  eq('absent seat not in roster -> no leaver', detectLeavers(g), []);
}

console.log('-- decodeSid / decodeRoster round-trip --');
{
  const sid = '76561198012345678';
  const b = BigInt(sid); const lo = Number(b & 0xFFFFFFFFn) | 0, hi = Number((b >> 32n) & 0xFFFFFFFFn) | 0;
  eq('decodeSid round-trip (signed |0)', decodeSid(lo, hi), sid);
}
{
  const enc = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const pc = 3;
  const d = [0xB1, 3, 1, 123, 7, 0, 1, 1, pc, 9, 11, 22, 33, 0];
  for (const sid of [A, B, '0']) { const p = enc(sid); d.push(p[0], p[1]); }
  eq('decodeRoster v3 (seat2 sentinel 0 skipped) -> {0:A,1:B}', decodeRoster(d), { 0: A, 1: B });
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
