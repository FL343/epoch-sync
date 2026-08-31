'use strict';
// ============================================================
// attest.js - solo attested-record verification + unmatched confession reconcile (knife-7 leg)
// ============================================================
// Two independent legs, both fed by the main tick (validate.js) with injected dependencies so
// tests need no network:
//
//   A) verifySoloRecord(details, pubTable)
//      Solo (pc=1) endless records are signed by the guard (the sidecar owns the record bytes).
//      There is no cross-end consensus in a single-player run, so the SIGNATURE is the gate:
//      a record whose signature does not verify against a REGISTERED build key is not settled.
//      FAIL-CLOSED by design (unsigned/garbage -> rejected), with ONE deliberate soft state:
//      an unknown keyId returns pending (the key table push can lag a build going live; the
//      record waits instead of being destroyed). Mirrors mvp/test/lib/solo-record.js byte for
//      byte - that file is the JS reference encoder the guard's C++ is parity-tested against.
//
//   B) reconcileUnmatched(rows, opts)
//      The host guard writes a SELF-INCRIMINATING row when its renderer silently dropped joiner
//      events (mvp knife-6 xcheck residual). Trust model = the 0xB5 abandon-confession family:
//      the row's content is against the writer's own interest, so its EXISTENCE is high-trust
//      and forging it is self-harm. Two hard rules, enforced here and asserted by the tests:
//        1. The signal ALWAYS accuses the WRITER (the host). It is NEVER evidence against the
//           joiner seats named in the payload - a malicious host must not gain a framing tool.
//        2. It is a SIGNAL, not a verdict: it feeds trust/moderation review, never an automatic
//           settlement change (evidence standard = causal contradiction, not statistical oddity).
//      Correlation with the match is by matchHash (== the record's d[3], same FNV-1a32), so a
//      row that names matches the writer was never host of is simply not corroborated.
// ============================================================
const crypto = require('crypto');

// ---- shared: FNV-1a 32 (client REPORTER.hash32 / guard fnv1a32 lockstep) ----
function hash32(s) {
  let h = 0x811c9dc5 >>> 0;
  s = String(s == null ? '' : s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h | 0;
}

// ============================================================
// A) solo attested record verification
// ============================================================
const LEDGER_MAGIC = 0xB1, LEDGER_VER = 3, MT_ENDLESS = 7, ATT_VER = 1;
const BASE_LEN = 21, SIG_INTS = 16;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function toBytes(d) {
  const b = Buffer.alloc(d.length * 4);
  for (let i = 0; i < d.length; i++) b.writeInt32LE(d[i] | 0, i * 4);
  return b;
}
function pubKeyObj(pubHex) {
  return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' });
}

// details int32[] + pubTable ({keyName: {pubs:[hex], sealed}}) -> verdict
//   { ok, reason, pending, fields }  (ok=true only when a registered key verifies the signature)
function verifySoloRecord(d, pubTable) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return { ok: false, reason: 'short' };
  if ((d[0] & 0xff) !== LEDGER_MAGIC) return { ok: false, reason: 'magic' };
  if (d[1] !== LEDGER_VER) return { ok: false, reason: 'ver' };
  if (d[2] !== MT_ENDLESS) return { ok: false, reason: 'mt' };
  if (d[8] !== 1) return { ok: false, reason: 'pc' };
  const keyId = d[18] | 0;
  const keyName = keyId === 0 ? 'dev' : String(keyId >>> 0);
  // roster seat 0 = the account the run belongs to (@12 lo, @13 hi). The settle caller MUST bind
  //   this to the leaderboard ROW OWNER (see soloSettleGate opts.owner) - the signature proves "a
  //   guard signed this content", NOT "this account's guard signed for this account". Without the
  //   binding, a sealed-key extractor could sign a record for an arbitrary steamId. (knife-7 audit.)
  const rosterSid = ((BigInt(d[13] >>> 0) << 32n) | BigInt(d[12] >>> 0)).toString();
  const fields = {
    matchHash: d[3] >>> 0, runSeed: d[4] | 0, durationSec: d[9] | 0, score: d[10] | 0,
    startDepth: d[14] | 0, endDepth: d[15] | 0, continuesUsed: d[16] | 0, tokensCp: d[17] | 0,
    keyId, keyName, attVer: d[19] & 0xff, jwtPresent: !!((d[19] >> 8) & 1), jwtHashLo: d[20] >>> 0,
    rosterSid,
  };
  if (fields.attVer !== ATT_VER) return { ok: false, reason: 'att-ver', fields };
  const ent = pubTable && pubTable[keyName];
  // unknown key = the ONLY soft state: a freshly shipped build whose key table push lagged.
  //   The record waits (pending) instead of being rejected; a later run settles it.
  if (!ent || !Array.isArray(ent.pubs) || !ent.pubs.length) return { ok: false, reason: 'unknown-key', pending: true, fields };
  const base = d.slice(0, BASE_LEN);
  const sig = Buffer.alloc(64);
  for (let i = 0; i < SIG_INTS; i++) sig.writeInt32LE(d[BASE_LEN + i] | 0, i * 4);
  const bytes = toBytes(base);
  for (const pub of ent.pubs) {
    try { if (crypto.verify(null, bytes, pubKeyObj(pub), sig)) return { ok: true, fields, sealed: !!ent.sealed }; }
    catch (e) { /* malformed pub entry: try the next */ }
  }
  return { ok: false, reason: 'bad-sig', fields };
}

// Production gate for the solo board: a sealed (shipped) build key is required, AND the record
//   must belong to the account that wrote the row.
//   - opts.owner: the leaderboard ROW OWNER's raw steamId (Steam-authenticated). REQUIRED when
//     O93 wires settlement -- the embedded roster steamId (verdict.fields.rosterSid) must equal it,
//     else a sealed-key extractor could sign a record crediting/framing an arbitrary account. A
//     valid signature is NOT identity binding (knife-7 audit finding 2). Omitting owner leaves the
//     record verified-but-unbound (used only by tests / the *_test board where framing is moot).
//   - dev-key records verify cryptographically but must NEVER settle onto the real solo board
//     (dev machines sign with a fixed, committed key) -- accepted only on the *_test board.
function soloSettleGate(verdict, opts) {
  if (!verdict || !verdict.ok) return { settle: false, reason: verdict ? verdict.reason : 'none', pending: !!(verdict && verdict.pending) };
  if (!verdict.sealed && !(opts && opts.allowDevKey)) return { settle: false, reason: 'dev-key-on-prod' };
  if (opts && opts.owner != null && String(opts.owner) !== String(verdict.fields && verdict.fields.rosterSid))
    return { settle: false, reason: 'owner-mismatch' };
  return { settle: true };
}

// ============================================================
// B) unmatched confession reconcile
// ============================================================
const CONFESS_MAGIC = 0xB8, CONFESS_VER = 1, CONFESS_MAX_SEATS = 6, SEAT_BITS = 5, SEAT_CAP = 31;

// unmatched_box details -> { ver, events:[{matchHash, pc, perSeat[6], total}] } | null
function decodeUnmatched(d) {
  if (!Array.isArray(d) || d.length < 3 || (d[0] & 0xff) !== CONFESS_MAGIC) return null;
  const ver = d[1] | 0, count = d[2] | 0;
  if (ver !== CONFESS_VER || count < 0 || count > 64) return null;
  const events = [];
  let at = 3;
  for (let i = 0; i < count && at + 3 <= d.length; i++) {
    const matchHash = d[at] >>> 0, pc = d[at + 1] | 0, packed = d[at + 2] >>> 0; at += 3;
    const perSeat = [];
    let total = 0;
    for (let s = 0; s < CONFESS_MAX_SEATS; s++) { const v = (packed >>> (s * SEAT_BITS)) & SEAT_CAP; perSeat.push(v); total += v; }
    events.push({ matchHash, pc, perSeat, total });
  }
  return { ver, count, events };
}

// rows: [{steamID, details}] read from the unmatched_box board this run.
// opts: { matchIndex: Map/obj matchHash -> {hostSid, seats:[sid]} built from this run's records,
//         state: sticky {key -> {t0, total, done}} (dedupe across runs), now, pid(sid)->hashed id,
//         onSignal(sig) -> void  (feeds trust/moderation; NEVER settlement) }
// Returns { seen, fresh, corroborated, orphan, signals:[...] }.
function reconcileUnmatched(rows, opts) {
  const o = opts || {};
  const state = o.state || {};
  const now = o.now || 0;
  const idOf = o.pid || ((s) => String(s));
  const res = { seen: 0, fresh: 0, corroborated: 0, orphan: 0, signals: [] };
  for (const row of (rows || [])) {
    const dec = decodeUnmatched(row.details);
    if (!dec) continue;
    const writer = String(row.steamID);
    for (const ev of dec.events) {
      res.seen++;
      if (ev.total <= 0) continue;
      const key = idOf(writer) + '|' + (ev.matchHash >>> 0).toString(16);
      const prev = state[key];
      // sticky dedupe: the box is a rolling ring, so the SAME event reappears every run until it
      //   ages out. Only a GROWN total is new information (the guard re-writes as the tally grows).
      if (prev && (prev.total | 0) >= ev.total) continue;
      const known = o.matchIndex ? (o.matchIndex.get ? o.matchIndex.get(ev.matchHash >>> 0) : o.matchIndex[ev.matchHash >>> 0]) : null;
      // corroboration: the writer must actually have been the HOST of that match this run's
      //   records describe. An uncorroborated row is kept as a weak signal but flagged orphan -
      //   it can be a match whose records aged out, or a fabricated hash (which harms nobody:
      //   the accusation lands on the writer either way).
      const corroborated = !!(known && known.hostSid && String(known.hostSid) === writer);
      state[key] = { t0: (prev && prev.t0) || now, total: ev.total, corroborated: corroborated ? 1 : 0 };
      res.fresh++;
      if (corroborated) res.corroborated++; else res.orphan++;
      const signal = {
        // RULE 1: the subject is ALWAYS the writer (host). perSeat is context for review only -
        //   it is deliberately NOT emitted as per-seat suspicion (no framing tool for a bad host).
        subject: idOf(writer),
        matchHash: ev.matchHash >>> 0,
        total: ev.total,
        perSeat: ev.perSeat.slice(),
        pc: ev.pc,
        corroborated,
        // RULE 2: signal, never a verdict. Consumers must not settle on this alone.
        kind: 'unmatched-host-drop',
        weight: corroborated ? 'review' : 'weak',
      };
      res.signals.push(signal);
      if (typeof o.onSignal === 'function') o.onSignal(signal);
    }
  }
  return res;
}

// prune sticky state (ring entries age out of the box; keep state bounded)
function pruneUnmatchedState(state, now, ttlMs) {
  const ttl = ttlMs || 30 * 86400000;
  let n = 0;
  for (const k of Object.keys(state || {})) if (now - ((state[k] && state[k].t0) || 0) > ttl) { delete state[k]; n++; }
  return n;
}

module.exports = {
  hash32,
  // A
  LEDGER_MAGIC, LEDGER_VER, MT_ENDLESS, ATT_VER, BASE_LEN, SIG_INTS,
  verifySoloRecord, soloSettleGate, toBytes,
  // B
  CONFESS_MAGIC, CONFESS_VER, CONFESS_MAX_SEATS,
  decodeUnmatched, reconcileUnmatched, pruneUnmatchedState,
};
