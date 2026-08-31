'use strict';
// Unit tests for the knife-7 attestation legs (attest.js): solo attested-record verification and
// the unmatched host-drop confession reconcile.
//   A) verifySoloRecord: happy path (signature made with a registered key), fail-closed rejects
//      (tampered base / bad signature / wrong magic / wrong ver / pc != 1 / short / att-ver),
//      unknown key -> pending (soft, key-table push lag), multi-pub rotation (older key still
//      verifies), and soloSettleGate (dev key must never settle on the prod solo board).
//   B) reconcileUnmatched: decode, sticky dedupe (ring re-reads are not new information), growth
//      re-signals, corroboration by host identity, orphan rows, and the TWO invariants that make
//      this a confession rather than an accusation tool:
//        - the signal subject is ALWAYS the writer (never the joiner seats in the payload)
//        - it is a signal (weight review/weak), never a settlement verdict
//   node test/attest.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const crypto = require('crypto');
const A = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

// ---- helpers: build a signed solo record exactly like the guard does ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function keypair(seedHex) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
  return { priv, pub };
}
function buildBase(m) {
  const sid = BigInt(m.steamId || '0');
  return [
    0xB1, 3, 7,
    A.hash32(m.matchId), (m.runSeed | 0), 0, 1, 0, 1,
    (m.durationSec | 0), (m.score | 0), 0,
    Number(sid & 0xFFFFFFFFn) | 0, Number((sid >> 32n) & 0xFFFFFFFFn) | 0,
    (m.startDepth | 0), (m.endDepth | 0), (m.continuesUsed | 0), (m.tokensCp | 0),
    (m.keyId | 0), (1 | ((m.jwtPresent ? 1 : 0) << 8)), (m.jwtHashLo | 0),
  ];
}
function sign(base, priv) {
  const sig = crypto.sign(null, A.toBytes(base), priv);
  const d = base.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}

const SEED_SEALED = 'a'.repeat(64);
const SEED_OLD = 'b'.repeat(64);
const SEED_DEV = 'c'.repeat(64);
const SEED_FOREIGN = 'd'.repeat(64);
const kSealed = keypair(SEED_SEALED), kOld = keypair(SEED_OLD), kDev = keypair(SEED_DEV), kForeign = keypair(SEED_FOREIGN);

const TABLE = {
  '2026083101': { pubs: [kSealed.pub, kOld.pub], sealed: true },   // rotation: newest first
  dev: { pubs: [kDev.pub], sealed: false },
};
const META = { matchId: 'solo_run_1', runSeed: 42424242, score: 555000, durationSec: 1500,
  startDepth: 0, endDepth: 17, continuesUsed: 1, tokensCp: 0, steamId: '76561198000000001', keyId: 2026083101 };

console.log('== A) verifySoloRecord ==');
{
  const rec = sign(buildBase(META), kSealed.priv);
  const v = A.verifySoloRecord(rec, TABLE);
  assert('signed with the registered sealed key verifies', v.ok === true);
  eq('decoded endDepth/score/keyName', [v.fields.endDepth, v.fields.score, v.fields.keyName], [17, 555000, '2026083101']);
  assert('sealed flag surfaced', v.sealed === true);
  eq('matchHash matches the client hash32 of the same matchId', v.fields.matchHash, A.hash32('solo_run_1') >>> 0);

  // rotation: a record signed with the PREVIOUS key of the same build id still verifies
  const recOld = sign(buildBase(META), kOld.priv);
  assert('older registered pub of the same keyId still verifies (rotation safety)', A.verifySoloRecord(recOld, TABLE).ok === true);

  // fail-closed family
  const tamper = rec.slice(); tamper[15] = 99;                     // endDepth
  eq('tampered base -> bad-sig', A.verifySoloRecord(tamper, TABLE).reason, 'bad-sig');
  const tamperScore = rec.slice(); tamperScore[10] = 9999999;
  eq('tampered score -> bad-sig', A.verifySoloRecord(tamperScore, TABLE).reason, 'bad-sig');
  const foreign = sign(buildBase(META), kForeign.priv);
  eq('signed with an UNregistered key -> bad-sig', A.verifySoloRecord(foreign, TABLE).reason, 'bad-sig');
  const noSig = buildBase(META);                                    // unsigned (base only)
  eq('unsigned record -> short', A.verifySoloRecord(noSig, TABLE).reason, 'short');
  const badMagic = rec.slice(); badMagic[0] = 0xB2;
  eq('wrong magic -> magic', A.verifySoloRecord(badMagic, TABLE).reason, 'magic');
  const badVer = rec.slice(); badVer[1] = 2;
  eq('wrong ledger ver -> ver', A.verifySoloRecord(badVer, TABLE).reason, 'ver');
  const badMt = rec.slice(); badMt[2] = 1;
  eq('non-endless mt -> mt', A.verifySoloRecord(badMt, TABLE).reason, 'mt');
  const badPc = rec.slice(); badPc[8] = 2;
  eq('pc != 1 -> pc (solo only)', A.verifySoloRecord(badPc, TABLE).reason, 'pc');
  const badAtt = rec.slice(); badAtt[19] = 2;
  {
    // knife-7 second audit P2-4: an unknown attVer is a LAYOUT this cron cannot locate the sig
    //   in -- same rollout-lag family as unknown-key, so it must be pending, never destroyed.
    const va = A.verifySoloRecord(badAtt, TABLE);
    assert('unknown attestation ver -> att-ver + pending (rollout window, not destruction)',
      va.ok === false && va.reason === 'att-ver' && va.pending === true);
  }
  // knife-7 second audit P2-4: the Steam details buffer is fixed-size zero-padded -- zeros after
  //   the sig are normal, a NON-zero tail is an unsigned writable region and must be rejected.
  const padded = rec.concat(new Array(64 - rec.length).fill(0));
  assert('zero padding after sig still verifies (fixed-64 details buffer)', A.verifySoloRecord(padded, TABLE).ok === true);
  const smug = rec.concat([0, 0, 12345]);
  eq('non-zero tail after sig -> trailing (no unsigned writable region)', A.verifySoloRecord(smug, TABLE).reason, 'trailing');

  // unknown key = the ONE soft state (table push lag), not a hard reject
  const future = sign(buildBase(Object.assign({}, META, { keyId: 2099010101 })), kSealed.priv);
  const vf = A.verifySoloRecord(future, TABLE);
  assert('unknown keyId -> not ok but pending (waits for the key table)', vf.ok === false && vf.pending === true && vf.reason === 'unknown-key');

  // dev key: verifies cryptographically, but must not settle on the production solo board
  const devRec = sign(buildBase(Object.assign({}, META, { keyId: 0 })), kDev.priv);
  const vd = A.verifySoloRecord(devRec, TABLE);
  assert('dev-key record verifies cryptographically', vd.ok === true && vd.sealed === false);
  eq('soloSettleGate rejects a dev key on the prod board', A.soloSettleGate(vd, {}).reason, 'dev-key-on-prod');
  assert('soloSettleGate allows a dev key when explicitly on the test board', A.soloSettleGate(vd, { allowDevKey: true }).settle === true);
  assert('soloSettleGate settles a sealed-key record', A.soloSettleGate(v, {}).settle === true);
  assert('soloSettleGate never settles a pending record', A.soloSettleGate(vf, { allowDevKey: true }).settle === false);

  // knife-7 audit finding 2: a valid signature is NOT identity binding. The settle gate must bind
  //   the record's embedded roster steamId to the leaderboard ROW OWNER, else a sealed-key
  //   extractor could sign a record crediting/framing an arbitrary account.
  eq('verifySoloRecord surfaces the embedded roster steamId', v.fields.rosterSid, '76561198000000001');
  assert('soloSettleGate settles when owner == embedded rosterSid', A.soloSettleGate(v, { owner: '76561198000000001' }).settle === true);
  eq('soloSettleGate rejects when owner != embedded rosterSid (no arbitrary-account credit)',
    A.soloSettleGate(v, { owner: '76561198000000999' }).reason, 'owner-mismatch');
}

console.log('== B) reconcileUnmatched ==');
// encode a box payload the way the guard does (ring of events, 6 seats x 5 bits)
function encodeBox(events) {
  const d = [0xB8, 1, events.length];
  for (const e of events) {
    d.push(A.hash32(e.matchId) | 0);
    d.push(e.pc | 0);
    let packed = 0;
    for (let i = 0; i < 6; i++) { let v = (e.perSeat[i] | 0); if (v > 31) v = 31; if (v < 0) v = 0; packed = (packed | (v << (i * 5))) >>> 0; }
    d.push(packed | 0);
  }
  return d;
}
const HOST = '76561198000000010', OTHER = '76561198000000011';
{
  const dec = A.decodeUnmatched(encodeBox([{ matchId: 'm1', pc: 3, perSeat: [0, 2, 1, 0, 0, 0] }]));
  eq('decode perSeat', dec.events[0].perSeat, [0, 2, 1, 0, 0, 0]);
  eq('decode total', dec.events[0].total, 3);
  assert('bad magic -> null', A.decodeUnmatched([0xB1, 1, 0]) === null);
  assert('unknown ver -> null', A.decodeUnmatched([0xB8, 9, 0]) === null);

  const matchIndex = new Map([[A.hash32('m1') >>> 0, { hostSid: HOST, seats: [HOST, OTHER] }]]);
  const state = {};
  const rows = [{ steamID: HOST, details: encodeBox([{ matchId: 'm1', pc: 3, perSeat: [0, 2, 1, 0, 0, 0] }]) }];
  const r1 = A.reconcileUnmatched(rows, { matchIndex, state, now: 1000 });
  eq('first sighting: fresh + corroborated', [r1.fresh, r1.corroborated, r1.orphan], [1, 1, 0]);
  eq('signal subject is the WRITER (host), never a joiner seat', r1.signals[0].subject, String(HOST));
  assert('signal carries perSeat as review context only', Array.isArray(r1.signals[0].perSeat) && r1.signals[0].total === 3);
  eq('signal is a review-weight signal, not a verdict', [r1.signals[0].kind, r1.signals[0].weight], ['unmatched-host-drop', 'review']);

  // ring re-read: the same event reappears every run -> must NOT re-signal
  const r2 = A.reconcileUnmatched(rows, { matchIndex, state, now: 2000 });
  eq('sticky dedupe: unchanged ring entry is not new information', [r2.fresh, r2.signals.length], [0, 0]);

  // the tally grew (host kept dropping): new information -> re-signal
  const rowsGrown = [{ steamID: HOST, details: encodeBox([{ matchId: 'm1', pc: 3, perSeat: [0, 4, 1, 0, 0, 0] }]) }];
  const r3 = A.reconcileUnmatched(rowsGrown, { matchIndex, state, now: 3000 });
  eq('grown tally re-signals with the new total', [r3.fresh, r3.signals[0].total], [1, 5]);

  // a row naming a match this writer did not host: kept as a weak signal, still about the writer
  const stateB = {};
  const rowsOrphan = [{ steamID: OTHER, details: encodeBox([{ matchId: 'm1', pc: 3, perSeat: [3, 0, 0, 0, 0, 0] }]) }];
  const r4 = A.reconcileUnmatched(rowsOrphan, { matchIndex, state: stateB, now: 4000 });
  eq('uncorroborated row -> orphan + weak weight', [r4.orphan, r4.signals[0].weight], [1, 'weak']);
  eq('orphan signal still accuses the writer only', r4.signals[0].subject, String(OTHER));

  // INVARIANT (no framing tool): across every signal produced, the subject is the row's writer -
  //   never any of the seats named in its payload. Checked structurally: pair each signal with the
  //   writer of the row it came from, and assert no signal's subject is a non-writer seat.
  const writersSeen = [String(HOST), String(OTHER)];
  const allSignals = r1.signals.concat(r3.signals, r4.signals);
  assert('every signal subject is one of the row writers', allSignals.every(s => writersSeen.indexOf(String(s.subject)) >= 0));
  // the payload names seat indices (not sids) precisely so a host cannot point at an account:
  assert('signals carry no steamID/sid field for accused seats (payload is seat-indexed only)',
    allSignals.every(s => !('seatSid' in s) && !('accused' in s) && Array.isArray(s.perSeat)));
  eq('subjects are exactly the writers of their own rows', [r1.signals[0].subject, r4.signals[0].subject], [String(HOST), String(OTHER)]);

  // knife-7 second audit P1-4: confessions are written DURING the match (write-on-detect) while
  //   records land at settle -> the first sighting is usually uncorroborated. A stored-orphan
  //   entry must keep re-checking the match index and upgrade ONCE when the records land --
  //   without re-spamming weak signals while it stays orphan.
  const stateC = {};
  const rowsC = [{ steamID: HOST, details: encodeBox([{ matchId: 'm2', pc: 2, perSeat: [0, 3, 0, 0, 0, 0] }]) }];
  const u1 = A.reconcileUnmatched(rowsC, { matchIndex: new Map(), state: stateC, now: 1000 });
  eq('pass 1 (records not settled yet): orphan + weak', [u1.orphan, u1.signals[0].weight], [1, 'weak']);
  const u1b = A.reconcileUnmatched(rowsC, { matchIndex: new Map(), state: stateC, now: 1500 });
  eq('still no records: NO duplicate weak signal', [u1b.fresh, u1b.signals.length], [0, 0]);
  const idx2 = new Map([[A.hash32('m2') >>> 0, { hostSid: HOST }]]);
  const u2 = A.reconcileUnmatched(rowsC, { matchIndex: idx2, state: stateC, now: 2000 });
  assert('records landed: upgrades ONCE to review weight',
    (u2.upgraded | 0) === 1 && u2.signals.length === 1 && u2.signals[0].weight === 'review' && u2.signals[0].upgraded === true);
  const u3 = A.reconcileUnmatched(rowsC, { matchIndex: idx2, state: stateC, now: 3000 });
  eq('after the upgrade: fully sticky, silent', [u3.fresh, (u3.upgraded | 0), u3.signals.length], [0, 0, 0]);
  // a writer who was NOT that match's host stays orphan even after the records land (no upgrade)
  const stateD = {};
  const rowsD = [{ steamID: OTHER, details: encodeBox([{ matchId: 'm2', pc: 2, perSeat: [0, 3, 0, 0, 0, 0] }]) }];
  A.reconcileUnmatched(rowsD, { matchIndex: new Map(), state: stateD, now: 1000 });
  const u4 = A.reconcileUnmatched(rowsD, { matchIndex: idx2, state: stateD, now: 2000 });
  eq('non-host writer never upgrades (host identity is the corroboration)', [(u4.upgraded | 0), u4.signals.length], [0, 0]);

  // knife-7 second audit P2-3: the attest-keys mirror in THIS repo parses and carries the dev key
  const tbl = A.loadPubTable(require('path').join(__dirname, '..', 'attest-keys.json'));
  assert('attest-keys.json mirror loads and has a dev entry (pubs non-empty)',
    !!(tbl && tbl.dev && Array.isArray(tbl.dev.pubs) && tbl.dev.pubs.length && tbl.dev.sealed === false));
  assert('loadPubTable on a missing file -> null (caller degrades to pending, never crashes)',
    A.loadPubTable('no-such-file.json') === null);

  // zero-total events are ignored entirely
  const r5 = A.reconcileUnmatched([{ steamID: HOST, details: encodeBox([{ matchId: 'm9', pc: 2, perSeat: [0, 0, 0, 0, 0, 0] }]) }], { matchIndex, state: {}, now: 5000 });
  eq('zero-total event produces no signal', [r5.fresh, r5.signals.length], [0, 0]);

  // state pruning keeps the sticky map bounded
  const pruneState = { 'x|1': { t0: 0 }, 'y|2': { t0: 100 * 86400000 } };
  A.pruneUnmatchedState(pruneState, 100 * 86400000, 30 * 86400000);
  eq('prune drops aged entries, keeps fresh', Object.keys(pruneState), ['y|2']);
}

console.log(failN ? ('\nFAIL ' + failN) : '\nall green');
process.exit(failN ? 1 : 0);
