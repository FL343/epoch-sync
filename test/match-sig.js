'use strict';
// Client knife 5.8a: the guard's match signature block (0xE5) on a lone bot record.
//   [1] attest.verifyMatchSig + matchSigGate: a good block; the soft states (another block version, another ledger version,
//       a key the table does not list, a key the job's policy holds for another channel / retired past the grace / revoked);
//       the broken ones (trailing ints, cut short, a moved score = bad-sig); the original matchHash of a table-split record;
//       the gate: dev key only where allowed, the row owner on the signed seat (a copied record does not count for the
//       copier), the block's own trust (relayed-event trouble / bare level -> verified but not used)
//   [2] botSignedOf: a usable block -> use + the guard's level count; one record of the group without one -> not used;
//       run counters
//   [3] creditXpBot: lone + signed = no discount (150), lone = x0.6 (90) as before, the guard level count caps the levels
//   [4] end to end over the REAL validate.js main() (offline board stub; a copy of this tree with one test signing key):
//       MSIG_BOTS on: signed lone bot match -> 150 XP, the guard's lower level count -> 110, an unsigned one -> 90,
//       a tampered block -> 90 (counted, nobody flagged), the dev key on the production shards -> 90;
//       MSIG_BOTS off: the signed one -> 90, counted in the summary; the summary row and the census name the blocks
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'attest.js'));
const MS = require(path.join(ROOT, 'match-sig.js'));
const G = require(path.join(ROOT, 'tools', 'gen-match-sig-fixtures.js'));
const v = require(path.join(ROOT, 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const HUMAN = '76561198000000041', OTHER = '76561198000000042';
const sp = (s) => { const b = BigInt(s); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a lone bot record as the client writes it: the human on seat 0, three bots (roster 0, 0), six levels, a character block
function botRec(o) {
  o = o || {};
  const sc = o.sc || [9000, 4000, 3000, 2000];
  const pc = sc.length;
  const d = [0xB1, 3, o.mt == null ? 11 : o.mt, o.h == null ? 51001 : o.h, o.seed == null ? 4242 : o.seed, 0, 1, ((o.prog == null ? 6 : o.prog) << 1) | 1, pc, 720];
  for (const s of sc) d.push(s | 0);
  d.push(0);
  d.push(...sp(o.sid || HUMAN));
  for (let i = 1; i < pc; i++) d.push(0, 0);
  d.push((0xD8 | (1 << 8) | (pc << 16)) | 0, 0x01020304);
  return d;
}
const flagsOwn = (levels, extra) => MS.packFlags(Object.assign({ role: MS.ROLE_OWN, seen: 1, levels: levels == null ? 6 : levels }, extra || {}));
const KEY = 2099102301;
function signWith(priv, d, o) {
  o = o || {};
  const h5 = MS.head(o.keyId == null ? KEY : o.keyId, o.flags == null ? flagsOwn() : o.flags, o.xcheck || 0, o.source == null ? d[11 + (d[8] | 0)] : o.source);
  const msg = MS.message(d, h5, o.h0 == null ? null : o.h0);
  const sig = crypto.sign(null, Buffer.from(msg), priv);
  return MS.attach(d, h5.concat(MS.sigInts([...sig])));
}
const sign = (d, o) => signWith(G.privKey(), d, o);
const tamper = (d, i, val) => { const x = d.slice(); x[i] = val | 0; return x; };
const TABLE = { [String(KEY)]: { pubs: [G.PUB_HEX], sealed: true }, dev: { pubs: [G.PUB_HEX], sealed: false } };

console.log('=== client knife 5.8a: guard match signature block on lone bot records ===');
// ---- [1] ----
console.log('[1] verifyMatchSig / matchSigGate');
{
  const good = sign(botRec());
  const vg = A.verifyMatchSig(good, TABLE);
  T('a good block verifies (sealed key)', vg.state === 'ok' && vg.sealed === true && vg.keyName === String(KEY) && vg.levels === 6 && vg.ownerSid === HUMAN && vg.trust.ok, JSON.stringify(vg));
  eq('gate: the row owner on the signed seat -> use', A.matchSigGate(vg, { owner: HUMAN }), { use: true, kind: 'ok', reason: '' });
  eq('gate: another row owner (a copied public record) -> bad owner-mismatch', A.matchSigGate(vg, { owner: OTHER }), { use: false, kind: 'bad', reason: 'owner-mismatch' });
  eq('no block -> none (the record is judged as before)', A.verifyMatchSig(botRec(), TABLE), { state: 'none', reason: 'none' });
  eq('gate of none', A.matchSigGate(A.verifyMatchSig(botRec(), TABLE), { owner: HUMAN }).kind, 'none');
  const devRec = sign(botRec(), { keyId: 0 });
  const vd = A.verifyMatchSig(devRec, TABLE);
  T('the dev key verifies, unsealed', vd.state === 'ok' && vd.sealed === false && vd.keyName === 'dev');
  eq('gate: the dev key on production boards -> bad dev-key-on-prod', A.matchSigGate(vd, { owner: HUMAN }).reason, 'dev-key-on-prod');
  eq('gate: the dev key on the test shards -> use', A.matchSigGate(vd, { owner: HUMAN, allowDevKey: true }).use, true);
  eq('a key the table does not list -> pending unknown-key', [A.verifyMatchSig(good, {}).state, A.verifyMatchSig(good, {}).reason], ['pending', 'unknown-key']);
  {
    const labeled = (info) => ({ [String(KEY)]: { pubs: [G.PUB_HEX], sealed: true, pubInfo: { [G.PUB_HEX]: info } } });
    const NOW = Date.parse('2026-11-20T00:00:00Z');
    const pol = (ch) => ({ channel: ch, nowMs: NOW });
    eq('a demo key read by the ea job -> pending key-channel', A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'demo' }), pol('ea'))).reason, 'key-channel');
    eq('an ea key read by the ea job -> ok', A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'ea' }), pol('ea'))).state, 'ok');
    eq('retired past the 7-day grace -> pending key-retired', A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'ea', retiredAt: '2026-11-01T00:00:00Z' }), pol('ea'))).reason, 'key-retired');
    eq('retired inside the grace -> ok', A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'ea', retiredAt: '2026-11-18T00:00:00Z' }), pol('ea'))).state, 'ok');
    eq('revoked -> pending key-revoked (no grace)', A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'ea', revokedAt: '2026-11-19T00:00:00Z' }), pol('ea'))).reason, 'key-revoked');
    const gp = A.matchSigGate(A.verifyMatchSig(good, A.applyKeyPolicy(labeled({ ch: 'demo' }), pol('ea'))), { owner: HUMAN });
    eq('gate of a held key: pending, not bad', [gp.use, gp.kind], [false, 'pending']);
  }
  const at = MS.find(good).at;
  eq('a block of another version -> pending msig-ver', A.verifyMatchSig(tamper(good, at, (0xE5 | (2 << 8) | (20 << 16))), TABLE).reason, 'msig-ver');
  eq('another ledger version -> pending ledger-ver', A.verifyMatchSig(tamper(good, 1, 4), TABLE).reason, 'ledger-ver');
  eq('a non-zero int after the block -> bad trailing', [A.verifyMatchSig(good.concat([9]), TABLE).state, A.verifyMatchSig(good.concat([9]), TABLE).reason], ['bad', 'trailing']);
  eq('zeros after the block (a padded row) -> ok', A.verifyMatchSig(good.concat([0, 0]), TABLE).state, 'ok');
  eq('the block cut short -> bad short', A.verifyMatchSig(good.slice(0, good.length - 1), TABLE).reason, 'short');
  eq('a moved score -> bad bad-sig', A.verifyMatchSig(tamper(good, 10, 9001), TABLE).reason, 'bad-sig');
  eq('a moved bot score -> bad bad-sig', A.verifyMatchSig(tamper(good, 12, 0), TABLE).reason, 'bad-sig');
  eq('a moved seed -> bad bad-sig', A.verifyMatchSig(tamper(good, 4, 4243), TABLE).reason, 'bad-sig');
  eq('a moved roster -> bad bad-sig', A.verifyMatchSig(tamper(good, 16, 5), TABLE).reason, 'bad-sig');
  eq('a moved level count in the block -> bad bad-sig', A.verifyMatchSig(tamper(good, at + 2, flagsOwn(15)), TABLE).reason, 'bad-sig');
  eq('testimony moved (progress bits, duration, tier bits, character block) -> still ok', A.verifyMatchSig(tamper(tamper(tamper(tamper(good, 7, 1), 9, 1), 2, 11 | (3 << 4)), at - 1, 7), TABLE).state, 'ok');
  {
    const split = tamper(good, 3, 909090);   // a table split moved d[3]; validate keeps the original as r.h0
    eq('a table-split record without the original matchHash -> bad-sig', A.verifyMatchSig(split, TABLE).reason, 'bad-sig');
    eq('a table-split record with h0 = the original -> ok', A.verifyMatchSig(split, TABLE, { h0: good[3] }).state, 'ok');
  }
  {
    const bare = sign(botRec(), { flags: flagsOwn(6, { bare: true }) });
    const vb = A.verifyMatchSig(bare, TABLE);
    eq('a level without its own world: verified, gate untrusted bare', [vb.state, A.matchSigGate(vb, { owner: HUMAN }).kind, A.matchSigGate(vb, { owner: HUMAN }).reason], ['ok', 'untrusted', 'bare']);
    const vx = A.verifyMatchSig(sign(botRec(), { xcheck: MS.packXcheck({ diff: 1 }) }), TABLE);
    eq('relayed-event trouble: untrusted xcheck', A.matchSigGate(vx, { owner: HUMAN }).reason, 'xcheck');
    const vs = A.verifyMatchSig(sign(botRec(), { source: 12345 }), TABLE);
    eq('own core with another source account: untrusted source', A.matchSigGate(vs, { owner: HUMAN }).reason, 'source');
  }
  {
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    eq('a block signed by an unregistered key under a registered key id -> bad-sig', A.verifyMatchSig(signWith(other, botRec()), TABLE).reason, 'bad-sig');
  }
}

// ---- [2] ----
console.log('[2] botSignedOf');
{
  const r = (d, sid) => ({ d, steamID: sid || HUMAN });
  const one = v.botSignedOf([r(sign(botRec({ prog: 6 }), { flags: flagsOwn(5) }))], TABLE, false);
  eq('a usable block: use, the guard level count', [one.use, one.lv], [true, 5]);
  const two = v.botSignedOf([r(sign(botRec())), r(botRec())], TABLE, false);
  eq('one record of the group without a block: not used', [two.use, two.lv], [false, -1]);
  const copied = v.botSignedOf([r(sign(botRec()), OTHER)], TABLE, false);
  eq('a record copied onto another account\'s row: not used (owner-mismatch)', [copied.use, copied.kinds], [false, ['bad:owner-mismatch']]);
  const dev = v.botSignedOf([r(sign(botRec(), { keyId: 0 }))], TABLE, true);
  eq('the dev key where allowed (test shards): used', dev.use, true);
  const split = { d: tamper(sign(botRec()), 3, 777), steamID: HUMAN, h0: 51001 };
  eq('a table-split record verifies through its original matchHash (r.h0)', v.botSignedOf([split], TABLE, false).use, true);
}

// ---- [3] ----
console.log('[3] creditXpBot signed');
{
  const g = [{ d: botRec(), steamID: HUMAN, dispCode: 0 }];
  const credit = (lone, signed, lv) => { const xp = {}, ch = {}; v.creditXpBot(g, lv == null ? 6 : lv, xp, ch, {}, 20000, null, lone, signed); return xp[HUMAN] | 0; };
  eq('lone, not signed: x0.6 (150 -> 90)', credit(true, false), 90);
  eq('lone, signed: no discount (150)', credit(true, true), 150);
  eq('lone, signed, the guard saw 4 levels: 70 + 40 = 110', credit(true, true, 4), 110);
  eq('lone, signed, the guard saw 1 level: never below the unsigned x0.6 credit (90)', credit(true, true, 1), 90);
  eq('lone, signed, the guard saw 0 levels: still 90', credit(true, true, 0), 90);
  eq('not lone (two humans): signed changes nothing', [credit(false, false), credit(false, true)], [150, 150]);
}

// ---- [4] end to end ----
console.log('[4] end to end (validate.js main(), offline boards, a test signing key)');
{
  const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sig-tree-'));
  require('./root-listing').copyRootTree(ROOT, TREE, ['.git', 'test', 'node_modules']);
  const kf = path.join(TREE, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY)] = { pubs: [G.PUB_HEX], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  j.keys.dev = { pubs: [G.PUB_HEX], sealed: false };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  const SCRIPT = path.join(TREE, 'validate.js');
  const PROGRESS = 5;
  const MIN = 60000;
  const boardsOf = (recs) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
  // two runs: the first sees the lone record (a synthetic first sighting starts its time floor), the second is past the floor
  function settle(recs, env) {
    const r1 = H.runCron(boardsOf(recs), null, env || null, SCRIPT, 'msig');
    const r2 = H.runCron(boardsOf(recs), H.advance(r1.state, 10 * MIN), env || null, SCRIPT, 'msig');
    const xp = {};
    for (const r of [r1, r2]) for (const p of H.setPosts(r, PROGRESS)) xp[/steamid=([0-9]+)/.exec(p.body)[1]] = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
    return { r1, r2, xp, out: r1.out + r2.out, code: Math.max(r1.code | 0, r2.code | 0) };
  }
  const P1 = '76561198000000051', P2 = '76561198000000052', P3 = '76561198000000053', P4 = '76561198000000054', P5 = '76561198000000055';
  const recOf = (sid, h, o) => ({ sid, d: (o && o.unsigned) ? botRec({ sid, h }) : sign(botRec({ sid, h }), o) });
  try {
    const on = { MSIG_BOTS: '1' };
    const recs = [
      recOf(P1, 61001),                                   // signed, six levels
      recOf(P2, 61002, { flags: flagsOwn(4) }),           // signed, the guard saw four levels
      recOf(P3, 61003, { unsigned: true }),               // no block
      { sid: P4, d: tamper(sign(botRec({ sid: P4, h: 61004 })), 10, 9999) },   // a moved score under the block
      recOf(P5, 61005, { keyId: 0 }),                     // the dev key on the production shards
    ];
    const a = settle(recs, on);
    T('both runs exit 0', a.code === 0, a.out.slice(-600));
    eq('MSIG_BOTS on: signed 150 / guard saw 4 levels 110 / unsigned 90 / tampered 90 / dev key on production 90',
      [a.xp[P1], a.xp[P2], a.xp[P3], a.xp[P4], a.xp[P5]], [150, 110, 90, 90, 90]);
    T('the settle log names the signed lane', /bots settle [^\n]*\(signed x1\.0\)/.test(a.out) && /xp-bots [^\n]* lone signed /.test(a.out), a.out.match(/bots settle[^\n]*/g));
    T('the tampered block is counted, nobody flagged for it', /\[msig bad:bad-sig\]/.test(a.out) && !/flag[^\n]*bad-sig/i.test(a.out));
    T('the dev key on production is counted as such', /\[msig bad:dev-key-on-prod\]/.test(a.out));
    T('summary row: 4 with a block / 2 usable / 0 untrusted / 2 broken / 0 pending -- 2 at x1.0', /guard match signature blocks on lone bot records[^|]*\| 4 \/ 2 \/ 0 \/ 2 \/ 0 -- 2 \|/.test(a.r2.summary), (a.r2.summary.match(/guard match signature[^\n]*/) || [''])[0]);
    T('first run census names the blocks (msig 1:4)', /persist census[^\n]*msig 1:4/.test(a.r1.out), (a.r1.out.match(/persist census[^\n]*/) || [''])[0]);
    const off = settle(recs.slice(0, 1), null);
    eq('MSIG_BOTS off: the signed one is paid x0.6 as before (90)', off.xp[P1], 90);
    T('MSIG_BOTS off: counted (1 usable, 0 credited) and the row says so', /guard match signature blocks on lone bot records[^|]*\(MSIG_BOTS off: counted only\) \| 1 \/ 1 \/ 0 \/ 0 \/ 0 -- 0 \|/.test(off.r2.summary), (off.r2.summary.match(/guard match signature[^\n]*/) || [''])[0]);
  } finally { try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {} }
}

console.log(failN ? ('match-sig: ' + failN + ' FAIL') : 'match-sig: all ok');
process.exit(failN ? 1 : 0);
