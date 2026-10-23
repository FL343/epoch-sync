'use strict';
// ============================================================
// gen-match-sig-fixtures.js - the golden cases of match-sig.js (the guard's match signature block)
// ============================================================
// Writes fixtures/match-sig/cases.json: hand-picked records and what match-sig.js gives for them today, plus blocks signed
// with a fixed test seed (SEED below; never a real key). Both repos replay the file -- this repo's test/match-sig-fixtures.js
// against match-sig.js, the client's against its vendored copy and against its guard's C++ block builder -- so a block
// layout, a message byte or a verdict that moves on one side only turns one of them red.
//   node tools/gen-match-sig-fixtures.js           write the file and print its FIXTURES_HASH
//   node tools/gen-match-sig-fixtures.js --check   exit 1 when the file is not what a fresh generation gives
// Regenerate only with a rules change (RULES_VER + 1 and FIXTURES_HASH in match-sig.js, same change), and read the diff.
// Case kinds:
//   find:    { d } -> find(d)
//   message: { d, blk, h0 } -> message bytes as hex
//   sign:    { d, keyId, flags, xcheck, source, h0 } -> { blk, rec, msg }  (blk signed with SEED; rec = attach(d, blk))
//   trust:   { d } -> trust(d, find(d).at)
//   flags:   { v } -> flagsOf(v)
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'match-sig', 'cases.json');
// fixed test seed (32 bytes, (i * 11 + 5) & 0xff) -- test-only, appears nowhere as a key
const SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff));
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const privKey = () => crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, SEED]), format: 'der', type: 'pkcs8' });
const PUB_HEX = crypto.createPublicKey(privKey()).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const hex = (bytes) => Buffer.from(bytes).toString('hex');

// roster ints the way the client writes them (low then high int32 per seat; a bot / empty seat is 0, 0)
const sid = (lo, hi) => [lo | 0, hi | 0];
const H = 17825793;   // the high int32 of an individual account id
const ME = sid(1194683941, H), OTHER = sid(-2027419035, H), BOT = sid(0, 0);
const charBlock = (pc, codes) => {
  const out = [(0xD8 | (1 << 8) | (pc << 16)) | 0];
  for (let i = 0; i < pc; i += 4) { let w = 0; for (let j = 0; j < 4 && i + j < pc; j++) w |= ((codes[i + j] | 0) & 0xff) << (8 * j); out.push(w | 0); }
  return out;
};
// a result record: head, pc seat scores, disposition, roster, then the extra ints
function rec(mt, h, seed, seat, pc, scores, ro, extra) {
  const d = [0xB1, 3, mt, h | 0, seed | 0, seat, 1, (6 << 1) | 1, pc, 431];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(0);
  return d.concat(ro, extra || []);
}
function tamper(d, i, v) { const o = d.slice(); o[i] = v | 0; return o; }

function signBlock(MS, d, c) {
  const flags = c.flags | 0;
  const h5 = MS.head(c.keyId, flags, c.xcheck, c.source);
  const msg = MS.message(d, h5, c.h0 == null ? null : c.h0);
  const sig = crypto.sign(null, Buffer.from(msg), privKey());
  return { blk: h5.concat(MS.sigInts([...sig])), msg };
}

function cases(MS) {
  const bots4 = rec(11, -1406723877, 1234567, 0, 4, [8215, 4210, 6600, 3900], [].concat(ME, BOT, BOT, BOT), charBlock(4, [1, 2, 3, 4]));
  const bots6 = rec(11 | (2 << 4), 556677, 2147483647, 0, 6, [-50, 0, 2147483647, -2147483648, 12, 13], [].concat(ME, BOT, BOT, BOT, BOT, BOT), charBlock(6, [1, 1, 2, 2, 3, 3]));
  const q1v1 = rec(1, 99, 7, 1, 2, [3000, 4500], [].concat(OTHER, ME), charBlock(2, [2, 3]));
  const gtby = [(0xDB | (1 << 8) | (1 << 16)) | 0, 1];
  const q1v1Db = q1v1.concat(gtby);
  const team2 = rec(5, 1717, 8080, 2, 4, [10, 20, 30, 40], [].concat(OTHER, OTHER, ME, OTHER), [(0x74320000 | 0x1) | 0].concat(charBlock(4, [1, 2, 3, 4])));
  const own = (pc, levels) => MS.packFlags({ role: MS.ROLE_OWN, seen: 1 << 0, levels });
  const ownSeat = (seat, levels) => MS.packFlags({ role: MS.ROLE_OWN, seen: 1 << seat, levels });
  const signCases = [
    { name: 'sign: bot match 1+3, dev key, 6 levels', d: bots4, keyId: 0, flags: own(4, 6), xcheck: 0, source: ME[0] },
    { name: 'sign: bot match 1+5, sealed key, tier bits in d[2], int32 extremes', d: bots6, keyId: 2026102701, flags: own(6, 3), xcheck: 0, source: ME[0] },
    { name: 'sign: bot match 1+3, original matchHash differs from d[3] (table split)', d: tamper(bots4, 3, 424242), keyId: 0, flags: own(4, 6), xcheck: 0, source: ME[0], h0: bots4[3] },
    { name: 'sign: 1V1 after a refusal block (0xDB), writer on seat 1', d: q1v1Db, keyId: 2026102701, flags: ownSeat(1, 6) | (1 << 8), xcheck: 0, source: ME[0] },
    { name: 'sign: 2V2 with the team refusal tag', d: team2, keyId: 7, flags: MS.packFlags({ role: MS.ROLE_RELAY, seen: (1 << 2) | 1, levels: 5 }), xcheck: 0, source: OTHER[0] },
  ];
  const built = signCases.map((c) => Object.assign({}, c, signBlock(MS, c.d, c)));
  const okBots = MS.attach(bots4, built[0].blk);
  const okSplit = MS.attach(built[2].d, built[2].blk);
  const okQ = MS.attach(q1v1Db, built[3].blk);
  const okT2 = MS.attach(team2, built[4].blk);
  const blkAt = (r) => MS.find(r).at;
  const withFlags = (r, f) => tamper(r, blkAt(r) + 2, f);
  return [
    ...signCases.map((c) => ({ name: c.name, kind: 'sign', d: c.d, keyId: c.keyId, flags: c.flags, xcheck: c.xcheck, source: c.source, h0: c.h0 == null ? null : c.h0 })),
    { name: 'find: bot record with its block', kind: 'find', d: okBots },
    { name: 'find: 1V1 block after the refusal block', kind: 'find', d: okQ },
    { name: 'find: 2V2 block after the refusal tag and the character block', kind: 'find', d: okT2 },
    { name: 'find: no block', kind: 'find', d: bots4 },
    { name: 'find: block followed by zeros (padded row)', kind: 'find', d: okBots.concat([0, 0]) },
    { name: 'find: block followed by a non-zero int', kind: 'find', d: okBots.concat([0, 5]) },
    { name: 'find: block before the character block (not last)', kind: 'find', d: bots4.slice(0, 23).concat(built[0].blk, charBlock(4, [1, 2, 3, 4])) },
    { name: 'find: block cut short', kind: 'find', d: okBots.slice(0, okBots.length - 1) },
    { name: 'find: block of another version', kind: 'find', d: tamper(okBots, blkAt(okBots), (0xE5 | (2 << 8) | (20 << 16))) },
    { name: 'find: block with another length', kind: 'find', d: tamper(okBots, blkAt(okBots), (0xE5 | (1 << 8) | (19 << 16))) },
    { name: 'find: endless record never carries it', kind: 'find', d: tamper(okBots, 2, 7) },
    { name: 'find: seat count out of range', kind: 'find', d: tamper(okBots, 8, 9) },
    { name: 'find: not a result record (start record)', kind: 'find', d: tamper(okBots, 0, 0xB2) },
    { name: 'message: tier bits and the high bits of d[2] are not signed', kind: 'message', d: tamper(bots4, 2, 11 | (4 << 4)), blk: built[0].blk.slice(0, 5), h0: null },
    { name: 'message: original matchHash given', kind: 'message', d: bots4, blk: built[0].blk.slice(0, 5), h0: 777 },
    { name: 'message: 6 seats', kind: 'message', d: bots6, blk: built[1].blk.slice(0, 5), h0: null },
    { name: 'trust: own core, own account, world on every level', kind: 'trust', d: okBots },
    { name: 'trust: table split record (block itself unchanged)', kind: 'trust', d: okSplit },
    { name: 'trust: relayed summary from another seat', kind: 'trust', d: okT2 },
    { name: 'trust: relayed summary claiming the writer as source', kind: 'trust', d: tamper(okT2, blkAt(okT2) + 4, ME[0]) },
    { name: 'trust: own core but another source', kind: 'trust', d: tamper(okBots, blkAt(okBots) + 4, OTHER[0]) },
    { name: 'trust: xcheck not zero', kind: 'trust', d: tamper(okBots, blkAt(okBots) + 3, MS.packXcheck({ miss: 1 })) },
    { name: 'trust: host changed', kind: 'trust', d: withFlags(okBots, own(4, 6) | MS.F_MIGRATED) },
    { name: 'trust: a level without its own world', kind: 'trust', d: withFlags(okBots, own(4, 6) | MS.F_BARE) },
    { name: 'trust: own seat not seen', kind: 'trust', d: withFlags(okBots, MS.packFlags({ role: MS.ROLE_OWN, seen: 2, levels: 6 })) },
    { name: 'trust: role 0', kind: 'trust', d: withFlags(okBots, MS.packFlags({ role: 0, seen: 1, levels: 6 })) },
    { name: 'flags: decode a full word', kind: 'flags', v: MS.packFlags({ role: 2, migrated: true, bare: true, seen: 0xA5, levels: 15 }) },
    { name: 'flags: levels capped at 15', kind: 'flags', v: MS.packFlags({ role: 1, seen: 1, levels: 99 }) },
  ];
}
function replay(MS, c) {
  if (c.kind === 'find') return MS.find(c.d);
  if (c.kind === 'message') { const m = MS.message(c.d, c.blk, c.h0); return m ? hex(m) : null; }
  if (c.kind === 'sign') { const s = signBlock(MS, c.d, c); return { blk: s.blk, rec: MS.attach(c.d, s.blk), msg: hex(s.msg) }; }
  if (c.kind === 'trust') { const f = MS.find(c.d); return f.state === 'ok' ? MS.trust(c.d, f.at) : { find: f.state }; }
  if (c.kind === 'flags') return MS.flagsOf(c.v);
  throw new Error('unknown case kind ' + c.kind);
}
function build(MS) {
  return { about: 'golden cases of match-sig.js; generated by tools/gen-match-sig-fixtures.js -- do not edit by hand', rulesVer: MS.RULES_VER,
    seed: SEED.toString('hex'), pub: PUB_HEX,
    cases: cases(MS).map((c) => { const { name, kind } = c, inp = Object.assign({}, c); delete inp.name; delete inp.kind; return { name, kind, in: inp, out: replay(MS, c) }; }) };
}
const canonHash = (text) => crypto.createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex').slice(0, 16);
function render(doc) {
  return '{\n  "about": ' + JSON.stringify(doc.about) + ',\n  "rulesVer": ' + JSON.stringify(doc.rulesVer) + ',\n  "seed": ' + JSON.stringify(doc.seed)
    + ',\n  "pub": ' + JSON.stringify(doc.pub) + ',\n  "cases": [\n' + doc.cases.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]\n}\n';
}
function main() {
  const MS = require(path.join(__dirname, '..', 'match-sig.js'));
  const text = render(build(MS));
  const check = process.argv.indexOf('--check') >= 0;
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  if (check) {
    if (cur !== text) { console.log('[match-sig-fixtures] DRIFT: ' + path.relative(process.cwd(), FILE) + ' is not what match-sig.js gives today'); process.exit(1); }
    console.log('[match-sig-fixtures] up to date (' + build(MS).cases.length + ' cases, hash ' + canonHash(text) + ')');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, text);
  console.log('[match-sig-fixtures] wrote ' + build(MS).cases.length + ' cases -> FIXTURES_HASH \'' + canonHash(text) + '\'' + (MS.FIXTURES_HASH === canonHash(text) ? ' (matches match-sig.js)' : ' (set it in match-sig.js)'));
}

module.exports = { FILE, SEED, PUB_HEX, privKey, cases, replay, build, render, canonHash, signBlock };
if (require.main === module) main();
