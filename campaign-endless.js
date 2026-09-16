'use strict';
// ============================================================
// campaign-endless.js - Vegas Gold Rush (campaign endless) run attestation: decode + verify + boundary plan
// ============================================================
// The game client's guard sidecar witnesses one Gold Rush run at a time (54-level ring order, >= 40s
//   between passes, per-pass gain cap, anomalies COUNTED into flags instead of dropping the run), signs a
//   run record with the build's attestation key and writes it to the client-writable per-difficulty box
//   `campaign_endless_box_d<dif>` (one row per account, only when the run beats the account's local best).
//   This module is the cron's read side: verify the Ed25519 signature against the registered build keys,
//   then apply the boundary sanity checks (fail-closed, every rejection is a permanent offense entry):
//     B1 signature + registered key (unknown key / layout version -> pending) + row owner == embedded steamId
//     B2 sequence: any fast / skip / incons count > 0 -> reject (a level's 60s timer is the only way it ends)
//     B3 pace: elapsed within [passes x 40s, passes x 600s] and the wall-clock minutes agree
//     B4 upper bound: score <= sum over the first passes+1 ring levels of CAP(dif, world, level) (gr-caps.json,
//        byte-locked with the companion repo's generated table; the end-of-run score includes the failed level)
//     B5 lower bound: far below the summed minimum level values -> 'lowscore' signal only (shop spending is legal)
//     B6 caps: passes <= 100000, dif 1..3, end level valid, runT0 inside [2026-09-01, now + 1d]
//   Settlement: best-only per difficulty ladder `campaign_endless_d<dif>` (score = run score, details =
//   [passes, elapsedMin, keyId, flags, endWorld<<8|endLevel, runT0]); same record (signature) never settles twice.
//   Dev-key records (keyId 0) verify cryptographically but only settle on *_test boards. Zero XP / zero points ride
//   on this lane: the only thing at stake is the ladder itself.
// Byte-locked with the companion repo's test/lib/gr-record.js (JS reference encoder) + native gr_record.h (the
//   only production encoder); its test/gr-record-parity.js cross-checks the guard bytes, its ledger-schema-lockstep
//   cross-checks this decoder + boundary plan against the reference implementation on shared fixtures.
// Record int32[] (29): [0] 0xBB|ver<<8 [1] keyId [2] dif [3] passes [4] score [5] elapsedSec [6] sidLo [7] sidHi
//   [8] firstAtMin [9] lastAtMin [10] flags=fast|skip<<8|incons<<16|quit<<24 [11] endWorld<<8|endLevel [12] runT0
//   [13..28] sig (over [0..12] LE)
// ============================================================
const crypto = require('crypto');

const GR_MAGIC = 0xBB, GR_VER = 1, BASE_LEN = 13, SIG_INTS = 16, RING = 54;
const MIN_PASS_SEC = 40, MAX_CREDIT_SEC = 600, MAX_PASSES = 100000;
const RUN_T0_FLOOR = 1788220800;   // 2026-09-01T00:00Z: no Gold Rush run can predate the feature
const LOWSCORE_FRAC = 0.2;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// offense ledger row (details[2]) reason codes -- stable numbers for the analysis board
const REASON_CODE = { 'bad-sig': 1, 'trailing': 3, 'owner-mismatch': 4, 'dev-key-on-prod': 5, 'magic': 6, 'short': 7,
  'fast': 10, 'skip': 11, 'incons': 12, 'pace-fast': 20, 'pace-slow': 21, 'clock': 22,
  'overcap': 30, 'runt0': 31, 'passes': 32, 'nopass': 33, 'endlevel': 34, 'dif': 35, 'difbox': 36, 'score': 37, 'captable': 38 };
const OFFENSE_MAGIC = 0xC8;   // details: [magic, tMin, dif, reasonCode, passes, score]

function toBytes(d) { const b = Buffer.alloc(d.length * 4); for (let i = 0; i < d.length; i++) b.writeInt32LE(d[i] | 0, i * 4); return b; }
function pubKeyObj(pubHex) { return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' }); }
function ringAt(idx) { const i = ((idx | 0) % RING + RING) % RING; return { world: Math.floor(i / 18) + 1, level: (i % 18) + 1 }; }

// details int32[] -> fields (no verification); wrong shape -> null
function decodeGr(d) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return null;
  if (((d[0] | 0) & 0xff) !== GR_MAGIC) return null;
  const keyId = d[1] | 0;
  const fl = d[10] >>> 0;
  return {
    ver: ((d[0] | 0) >> 8) & 0xff, keyId, keyName: keyId === 0 ? 'dev' : String(keyId >>> 0),
    dif: d[2] | 0, passes: d[3] | 0, score: d[4] | 0, elapsedSec: d[5] | 0,
    steamId: ((BigInt(d[7] >>> 0) << 32n) | BigInt(d[6] >>> 0)).toString(),
    firstAtMin: d[8] | 0, lastAtMin: d[9] | 0,
    fast: fl & 0xff, skip: (fl >>> 8) & 0xff, incons: (fl >>> 16) & 0xff, quit: (fl >>> 24) & 0xff,
    endWorld: ((d[11] >>> 0) >>> 8) & 0xff, endLevel: (d[11] >>> 0) & 0xff, runT0: d[12] | 0,
  };
}
// signature hex (dedupe key: runT0 is inside the signed bytes, so two runs of one account never share a signature)
function sigHexOf(d) { return Array.isArray(d) && d.length >= BASE_LEN + SIG_INTS ? toBytes(d.slice(BASE_LEN, BASE_LEN + SIG_INTS)).toString('hex') : ''; }

// -> { ok, reason, pending, fields, sealed }
function verifyGrRecord(d, pubTable) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return { ok: false, reason: 'short' };
  if (((d[0] | 0) & 0xff) !== GR_MAGIC) return { ok: false, reason: 'magic' };
  const f = decodeGr(d);
  if (f.ver !== GR_VER) return { ok: false, reason: 'ver', pending: true, fields: f };
  for (let i = BASE_LEN + SIG_INTS; i < d.length; i++) if ((d[i] | 0) !== 0) return { ok: false, reason: 'trailing', fields: f };
  const ent = pubTable && pubTable[f.keyName];
  if (!ent || !Array.isArray(ent.pubs) || !ent.pubs.length) return { ok: false, reason: 'unknown-key', pending: true, fields: f };
  const bytes = toBytes(d.slice(0, BASE_LEN));
  const sig = Buffer.alloc(64);
  for (let i = 0; i < SIG_INTS; i++) sig.writeInt32LE(d[BASE_LEN + i] | 0, i * 4);
  let sigOk = false;
  for (const pub of ent.pubs) { try { if (crypto.verify(null, bytes, pubKeyObj(pub), sig)) { sigOk = true; break; } } catch (e) { /* malformed pub: next */ } }
  if (!sigOk) return { ok: false, reason: 'bad-sig', fields: f };
  return { ok: true, fields: f, sealed: !!ent.sealed };
}

// Boundary sanity (B2..B6) on decoded fields against the cap table {ring:[key], levels:{key:{cap:[d1,d2,d3], minLV:[...]}}}.
//   -> { ok, reason, flags[], cap }   (pure; mirrored by the companion repo's reference implementation)
function boundaryPlan(f, caps, opts) {
  const o = opts || {};
  const flags = [];
  if (!f) return { ok: false, reason: 'nofields', flags };
  if (!(f.dif >= 1 && f.dif <= 3)) return { ok: false, reason: 'dif', flags };
  if (!(f.passes >= 0 && f.passes <= MAX_PASSES)) return { ok: false, reason: 'passes', flags };
  if (f.passes === 0) return { ok: false, reason: 'nopass', flags };
  if (!(f.endWorld >= 1 && f.endWorld <= 3 && f.endLevel >= 1 && f.endLevel <= 18)) return { ok: false, reason: 'endlevel', flags };
  if (f.fast > 0 || f.skip > 0 || f.incons > 0) return { ok: false, reason: f.fast > 0 ? 'fast' : (f.skip > 0 ? 'skip' : 'incons'), flags };
  const MIN = o.minPassSec || MIN_PASS_SEC, MAX = o.maxCreditSec || MAX_CREDIT_SEC;
  if (f.elapsedSec < f.passes * MIN) return { ok: false, reason: 'pace-fast', flags };
  if (f.elapsedSec > f.passes * MAX) return { ok: false, reason: 'pace-slow', flags };
  if (f.passes > 1 && (f.lastAtMin - f.firstAtMin) < Math.floor(f.elapsedSec / 60) - 1) return { ok: false, reason: 'clock', flags };
  const t0Min = Math.floor((f.runT0 | 0) / 60);
  if (f.runT0 < (o.minRunT0 != null ? o.minRunT0 : RUN_T0_FLOOR)) return { ok: false, reason: 'runt0', flags };
  if (o.nowSec != null && f.runT0 > o.nowSec + 86400) return { ok: false, reason: 'runt0', flags };
  if (f.passes > 0 && f.firstAtMin && t0Min > f.firstAtMin) return { ok: false, reason: 'runt0', flags };
  if (f.score < 0 || f.score > 0x7fffffff) return { ok: false, reason: 'score', flags };
  if (caps && caps.levels && caps.ring) {
    let cap = 0, low = 0;
    const n = Math.min(f.passes + 1, MAX_PASSES);
    for (let i = 0; i < n; i++) {
      const k = caps.ring[i % caps.ring.length];
      const e = caps.levels[k];
      if (!e) return { ok: false, reason: 'captable', flags };
      cap += e.cap[f.dif - 1] | 0;
      if (i < f.passes) low += e.minLV[f.dif - 1] | 0;
    }
    if (f.score > cap) return { ok: false, reason: 'overcap', flags, cap };
    if (f.score < Math.floor(low * LOWSCORE_FRAC)) flags.push('lowscore');
    return { ok: true, reason: null, flags, cap };
  }
  return { ok: true, reason: null, flags };
}

// Full settle decision for one box row: signature verdict + sealed/dev-key gate + owner binding + box difficulty + boundary.
//   -> { ok, reason, pending, flags, fields }
function settlePlan(verdict, opts) {
  const o = opts || {};
  if (!verdict || !verdict.ok) return { ok: false, reason: verdict ? verdict.reason : 'none', pending: !!(verdict && verdict.pending), fields: verdict && verdict.fields, flags: [] };
  const f = verdict.fields;
  if (!verdict.sealed && !o.allowDevKey) return { ok: false, reason: 'dev-key-on-prod', fields: f, flags: [] };
  if (o.owner != null && String(o.owner) !== String(f.steamId)) return { ok: false, reason: 'owner-mismatch', fields: f, flags: [] };
  if (o.boxDif != null && (o.boxDif | 0) !== f.dif) return { ok: false, reason: 'difbox', fields: f, flags: [] };
  const bp = boundaryPlan(f, o.caps, o);
  return { ok: bp.ok, reason: bp.reason, fields: f, flags: bp.flags, cap: bp.cap };
}

// ladder row details for a settled run
function ladderDetails(f) { return [f.passes | 0, Math.floor((f.elapsedSec | 0) / 60), f.keyId | 0, ((f.fast | 0) | ((f.skip | 0) << 8) | ((f.incons | 0) << 16) | ((f.quit | 0) << 24)) | 0, (((f.endWorld | 0) << 8) | (f.endLevel | 0)) | 0, f.runT0 | 0]; }
// offense ledger row: score = cumulative count (absolute -> a dropped write self-heals), details = latest offense
function offenseDetails(tMin, f, reason) { return [OFFENSE_MAGIC, tMin | 0, (f && f.dif) | 0, REASON_CODE[reason] || 99, (f && f.passes) | 0, (f && f.score) | 0]; }

// Mass-anomaly mail decision on an hourly reject histogram {hourBucket: n}: rejects within the trailing 24h >= min
//   and no mail in the last 24h -> send. Pure (unit-tested).
function mailDecision(rejects, nowHour, lastMailHour, minRejects) {
  let n = 0;
  for (const h of Object.keys(rejects || {})) { const hh = h | 0; if (hh > nowHour - 24 && hh <= nowHour) n += rejects[h] | 0; }
  const due = n >= (minRejects | 0 || 5) && !(lastMailHour && nowHour - lastMailHour < 24);
  return { send: due, n };
}
function pruneRejects(rejects, nowHour) { const out = {}; for (const h of Object.keys(rejects || {})) if ((h | 0) > nowHour - 48) out[h] = rejects[h] | 0; return out; }

module.exports = { GR_MAGIC, GR_VER, BASE_LEN, SIG_INTS, RING, MIN_PASS_SEC, MAX_CREDIT_SEC, MAX_PASSES, RUN_T0_FLOOR, LOWSCORE_FRAC, REASON_CODE, OFFENSE_MAGIC,
  toBytes, ringAt, decodeGr, sigHexOf, verifyGrRecord, boundaryPlan, settlePlan, ladderDetails, offenseDetails, mailDecision, pruneRejects };
