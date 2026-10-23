'use strict';
// Golden cases of match-sig.js (the guard's match signature block 0xE5): the block layout, the signed message and the
// structural trust verdict live in one self-contained module that this job requires and the client runs as a comment-stripped
// copy (its guard builds the same bytes in C++ and replays the same cases), so a byte that moves on one side only turns red.
//   [1] fixtures/match-sig/cases.json is what tools/gen-match-sig-fixtures.js generates from match-sig.js today
//   [2] FIXTURES_HASH in match-sig.js is the file's canonical hash; the file's rulesVer is RULES_VER; seed / pub agree
//   [3] every case replays to its out; every signed case verifies with the fixture public key
//   [4] coverage: every kind; ok / bad / none / unknown among the finds; trust ok and not ok
//   [5] the module loads the way the client loads it: comments stripped, new Function('window', src) -> window.MATCH_SIG
//   [6] the module stays self-contained: no require, no process, no clock, no block comment, ASCII-only code
//   [7] properties over random records: a signed record verifies; moving any signed field breaks it; moving testimony
//       (disposition, rank claim, progress bits, duration, tier bits, the character block) does not; dropping the block = none;
//       the largest record (8 seats, refusal tag, character block, refusal block) still fits a row with the block
//   [8] mutation: a copy with another domain string fails cases (the replay really compares)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const MS = require(path.join(ROOT, 'match-sig.js'));
const G = require(path.join(ROOT, 'tools', 'gen-match-sig-fixtures.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const pubObj = (hex) => crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
const verifies = (M, rec, h0, pub) => {
  const f = M.find(rec);
  if (f.state !== 'ok') return false;
  const blk = rec.slice(f.at, f.at + M.BLOCK_INTS);
  const msg = M.message(rec, blk, h0 == null ? null : h0);
  return !!msg && crypto.verify(null, Buffer.from(msg), pubObj(pub), Buffer.from(M.sigBytes(blk)));
};

const text = fs.readFileSync(G.FILE, 'utf8');
const doc = JSON.parse(text);

console.log('=== match-sig golden cases ===');
// [1]
T('[1] the case file is what the generator gives today (node tools/gen-match-sig-fixtures.js to regenerate)', G.render(G.build(MS)) === text);
// [2]
T('[2] FIXTURES_HASH = canonical hash of the case file', MS.FIXTURES_HASH === G.canonHash(text), MS.FIXTURES_HASH + ' vs ' + G.canonHash(text));
T('[2] the case file carries RULES_VER', doc.rulesVer === MS.RULES_VER && Number.isInteger(MS.RULES_VER) && MS.RULES_VER >= 1, doc.rulesVer + ' vs ' + MS.RULES_VER);
T('[2] the case file names the fixed test seed and its public key', doc.seed === G.SEED.toString('hex') && doc.pub === G.PUB_HEX);
// [3]
const replayAll = (M) => doc.cases.map((c) => J(G.replay(M, Object.assign({ kind: c.kind }, c.in))));
const want = doc.cases.map((c) => J(c.out));
{
  const got = replayAll(MS), off = [];
  got.forEach((g, i) => { if (g !== want[i]) off.push(doc.cases[i].name); });
  T('[3] every case replays to its out (' + doc.cases.length + ' cases)', !off.length, off.slice(0, 5).join(' | '));
  const signs = doc.cases.filter((c) => c.kind === 'sign');
  const unver = signs.filter((c) => !verifies(MS, c.out.rec, c.in.h0, doc.pub)).map((c) => c.name);
  T('[3] every signed record verifies with the fixture public key (' + signs.length + ')', signs.length >= 4 && !unver.length, unver.join(' | '));
}
// [4]
{
  const kinds = new Set(doc.cases.map((c) => c.kind));
  T('[4] all five kinds present', ['find', 'message', 'sign', 'trust', 'flags'].every((k) => kinds.has(k)), [...kinds].join(','));
  const states = new Set(doc.cases.filter((c) => c.kind === 'find').map((c) => c.out.state));
  T('[4] ok, bad, none and unknown all appear among the finds', ['ok', 'bad', 'none', 'unknown'].every((s) => states.has(s)), [...states].join(','));
  const whys = new Set(doc.cases.filter((c) => c.kind === 'find' && c.out.state === 'bad').map((c) => c.out.why));
  T('[4] trailing, short and len all appear among the bad finds', ['trailing', 'short', 'len'].every((w) => whys.has(w)), [...whys].join(','));
  const tr = doc.cases.filter((c) => c.kind === 'trust');
  T('[4] trust ok and every refusal reason appear', tr.some((c) => c.out.ok) && ['xcheck', 'migrated', 'bare', 'seen', 'role', 'source'].every((w) => tr.some((c) => c.out.why === w)));
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
const SRC = fs.readFileSync(path.join(ROOT, 'match-sig.js'), 'utf8');
const code = strip(SRC);
{
  const win = {};
  let err = null;
  try { new Function('window', code)(win); } catch (e) { err = e; }
  T('[5] the stripped copy loads with new Function(\'window\', src) onto window.MATCH_SIG', !err && win.MATCH_SIG && typeof win.MATCH_SIG.find === 'function', err && err.message);
  if (win.MATCH_SIG) T('[5] the stripped copy replays every case to its out', J(replayAll(win.MATCH_SIG)) === J(want));
  if (win.MATCH_SIG) T('[5] the stripped copy carries the same RULES_VER and FIXTURES_HASH', win.MATCH_SIG.RULES_VER === MS.RULES_VER && win.MATCH_SIG.FIXTURES_HASH === MS.FIXTURES_HASH);
}
// [6]
T('[6] no require, no process, no clock in the module code', !/\brequire\s*\(|\bprocess\b|\bDate\b|\bperformance\b/.test(code));
T('[6] no block comment in the module (the client copy strips // lines only)', !/\/\*/.test(SRC));
T('[6] ASCII-only module code', !/[^\x00-\x7f]/.test(code));
// [7] properties (seeded, deterministic)
{
  let seed = 20261023;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
  const i32 = () => ((rnd(65536) << 16) | rnd(65536)) | 0;
  let okN = 0, okBad = 0, moveN = 0, moveBad = 0, keepN = 0, keepBad = 0, noneN = 0, noneBad = 0;
  for (let it = 0; it < 200; it++) {
    const pc = 2 + rnd(MS.MAX_SEATS - 1), seat = rnd(pc), mt = [1, 2, 10, 11][rnd(4)] | (rnd(5) << 4);
    const d = [0xB1, 3, mt, i32(), i32(), seat, 1 + rnd(pc), rnd(64), pc, rnd(4000)];
    for (let i = 0; i < pc; i++) d.push(i32());
    d.push(rnd(3));
    for (let i = 0; i < 2 * pc; i++) d.push(rnd(3) === 0 ? 0 : i32());
    const cb = [(0xD8 | (1 << 8) | (pc << 16)) | 0];
    for (let i = 0; i < pc; i += 4) cb.push(i32());
    const base = d.concat(cb);
    const lo = base[11 + pc + 2 * seat];
    const c = { keyId: rnd(2) ? 0 : 2026102700 + rnd(99), flags: MS.packFlags({ role: 1, seen: 1 << seat, levels: rnd(7) }), xcheck: 0, source: lo, h0: null };
    const s = G.signBlock(MS, base, c);
    const rec = MS.attach(base, s.blk);
    if (rec && verifies(MS, rec, null, doc.pub)) okN++; else okBad++;
    if (!rec) continue;
    const at = MS.find(rec).at;
    const signed = [1, 2, 3, 4, 5, 8, 10 + rnd(pc), 11 + pc + rnd(2 * pc), at + rnd(MS.HEAD_INTS), at + MS.HEAD_INTS + rnd(MS.SIG_INTS)];
    const pick = signed[rnd(signed.length)];
    const moved = rec.slice(); moved[pick] = (moved[pick] + (pick === 2 ? 1 : 1 + rnd(1000))) | 0;
    if (!verifies(MS, moved, null, doc.pub)) moveN++; else moveBad++;
    const testimony = [6, 7, 9, 10 + pc, at - 1];
    const kept = rec.slice(); const tp = testimony[rnd(testimony.length)]; kept[tp] = (kept[tp] + 1) | 0;
    kept[2] = ((kept[2] & 0xf) | (rnd(16) << 4)) | 0;
    if (verifies(MS, kept, null, doc.pub)) keepN++; else keepBad++;
    if (MS.find(base).state === 'none') noneN++; else noneBad++;
  }
  T('[7] a signed record verifies (' + okN + ' records)', okBad === 0, okBad + ' did not');
  T('[7] any signed field moved -> no longer verifies (' + moveN + ')', moveBad === 0, moveBad + ' still verified');
  T('[7] testimony moved (rank, progress, duration, disposition, character block, tier bits) -> still verifies (' + keepN + ')', keepBad === 0, keepBad + ' broke');
  T('[7] no block -> none (' + noneN + ')', noneBad === 0, noneBad + ' not none');
  const big = MS.rosterEnd(MS.MAX_SEATS) + 1 + (1 + Math.ceil(MS.MAX_SEATS / 4)) + 2 + MS.BLOCK_INTS;
  const six = MS.rosterEnd(6) + 1 + (1 + Math.ceil(6 / 4)) + 2 + MS.BLOCK_INTS;
  T('[7] a 6-seat record with every tail block and the signature block fits a row (' + six + ' <= ' + MS.MAX_DETAILS + ')', six <= MS.MAX_DETAILS);
  if (big > MS.MAX_DETAILS) ok('[7] an 8-seat record with every tail would not fit (' + big + ') -> attach refuses it, the writer uploads without the block');
  T('[7] attach refuses a record that would overflow a row', MS.attach(new Array(MS.MAX_DETAILS - MS.BLOCK_INTS + 1).fill(0).map((x, i) => i === 0 ? 0xB1 : (i === 8 ? 2 : x)), new Array(MS.BLOCK_INTS).fill(0).map((x, i) => i === 0 ? MS.headWord() : 0)) === null);
}
// [8] mutation
{
  const mut = code.replace("'GMT-MSIG'", "'GMT-MSIX'");
  if (mut === code) bad('[8] mutation target (the domain string) not found');
  else {
    const w = {}; new Function('window', mut)(w);
    const red = replayAll(w.MATCH_SIG).filter((x, i) => x !== want[i]).length;
    T('[8] a copy with another domain string fails ' + red + ' case(s)', red > 0);
  }
}

console.log(failN ? ('match-sig-fixtures: ' + failN + ' FAIL') : 'match-sig-fixtures: all ok');
process.exit(failN ? 1 : 0);
