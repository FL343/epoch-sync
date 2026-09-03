'use strict';
// ============================================================
// campaign.js - Vegas campaign clear attestation: decode + verify + grant plan (O159 knife-7d)
// ============================================================
// The game client's guard sidecar process keeps a per-account work-proof ledger for the
//   single-player campaign (levels must arrive in order, each counted pass needs >= 40s since the
//   previous one) and, when a clear tier is reached, signs a campaign record with the build's
//   attestation key and writes it to the client-writable `campaign_box` leaderboard. This module is
//   the cron's read side: verify the Ed25519 signature against the registered build keys, check the
//   record's internal consistency, and plan the exclusive-cosmetic grant bits:
//     tierBits bit0 (normal clear: lastU>=54 && credited>=54)  -> grant_box bit 6 (campaign banner)
//     tierBits bit1 (expert clear: lastU>=162 && credited>=162) -> grant_box bit 5 (campaign title)
//   Fail-closed by design (unsigned / garbage / tampered -> no grant), with the same soft states as
//   the solo record: unknown keyId or unknown layout version -> pending (key table push lag).
//   Identity binding (knife-7 audit finding 2): the row OWNER must equal the record's embedded
//   steamId - a signature proves "a guard signed these bytes", not "this account's guard did".
//   Dev-key records (keyId 0) verify cryptographically but only settle on *_test boards.
// Byte-locked with mvp/test/lib/campaign-record.js (JS reference encoder) + native/eac-guard/
//   campaign_record.h (the only production encoder); mvp/test/campaign-record-parity.js cross-checks.
// Record int32[] (27): [0] 0xB9|ver<<8 [1] keyId [2] tierBits [3] lastU [4] credited [5] elapsedMin
//   [6] sidLo [7] sidHi [8] firstAtMin [9] lastAtMin [10] flags=fast|skip<<16 [11..26] sig (over [0..10] LE)
// ============================================================
const crypto = require('crypto');

const CAMP_MAGIC = 0xB9, CAMP_VER = 1, BASE_LEN = 11, SIG_INTS = 16;
const U_NORMAL = 54, U_EXPERT = 162;
const BIT_BANNER = 6, BIT_TITLE = 5;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function toBytes(d) { const b = Buffer.alloc(d.length * 4); for (let i = 0; i < d.length; i++) b.writeInt32LE(d[i] | 0, i * 4); return b; }
function pubKeyObj(pubHex) { return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' }); }

// details int32[] -> fields (no verification); wrong shape -> null
function decodeCampaign(d) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return null;
  if (((d[0] | 0) & 0xff) !== CAMP_MAGIC) return null;
  const keyId = d[1] | 0;
  return {
    ver: ((d[0] | 0) >> 8) & 0xff, keyId, keyName: keyId === 0 ? 'dev' : String(keyId >>> 0),
    tierBits: d[2] | 0, lastU: d[3] | 0, credited: d[4] | 0, elapsedMin: d[5] | 0,
    steamId: ((BigInt(d[7] >>> 0) << 32n) | BigInt(d[6] >>> 0)).toString(),
    firstAtMin: d[8] | 0, lastAtMin: d[9] | 0, fast: (d[10] >>> 0) & 0xffff, skip: ((d[10] >>> 0) >>> 16) & 0xffff,
  };
}

// -> { ok, reason, pending, fields, sealed }
function verifyCampaignRecord(d, pubTable) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return { ok: false, reason: 'short' };
  if (((d[0] | 0) & 0xff) !== CAMP_MAGIC) return { ok: false, reason: 'magic' };
  const f = decodeCampaign(d);
  if (f.ver !== CAMP_VER) return { ok: false, reason: 'ver', pending: true, fields: f };
  // sig is ALWAYS the last block; the details buffer is zero-padded -> any non-zero int after it is an
  //   unsigned writable region smuggled past the signature domain: reject.
  for (let i = BASE_LEN + SIG_INTS; i < d.length; i++) if ((d[i] | 0) !== 0) return { ok: false, reason: 'trailing', fields: f };
  const ent = pubTable && pubTable[f.keyName];
  if (!ent || !Array.isArray(ent.pubs) || !ent.pubs.length) return { ok: false, reason: 'unknown-key', pending: true, fields: f };
  const bytes = toBytes(d.slice(0, BASE_LEN));
  const sig = Buffer.alloc(64);
  for (let i = 0; i < SIG_INTS; i++) sig.writeInt32LE(d[BASE_LEN + i] | 0, i * 4);
  let sigOk = false;
  for (const pub of ent.pubs) { try { if (crypto.verify(null, bytes, pubKeyObj(pub), sig)) { sigOk = true; break; } } catch (e) { /* malformed pub: next */ } }
  if (!sigOk) return { ok: false, reason: 'bad-sig', fields: f };
  // content self-consistency (after the signature: a guard logic regression must not mint tiers its own ledger contradicts)
  if (!(f.tierBits >= 1 && f.tierBits <= 3)) return { ok: false, reason: 'tier', fields: f };
  if ((f.tierBits & 1) && !(f.lastU >= U_NORMAL && f.credited >= U_NORMAL)) return { ok: false, reason: 'tier-proof', fields: f };
  if ((f.tierBits & 2) && !(f.lastU >= U_EXPERT && f.credited >= U_EXPERT)) return { ok: false, reason: 'tier-proof', fields: f };
  return { ok: true, fields: f, sealed: !!ent.sealed };
}

// grant bits for a verified record: sealed key (or allowDevKey on a *_test board) + owner binding
function campaignGrantPlan(verdict, opts) {
  if (!verdict || !verdict.ok) return { bits: [], reason: verdict ? verdict.reason : 'none', pending: !!(verdict && verdict.pending) };
  if (!verdict.sealed && !(opts && opts.allowDevKey)) return { bits: [], reason: 'dev-key-on-prod' };
  if (opts && opts.owner != null && String(opts.owner) !== String(verdict.fields.steamId)) return { bits: [], reason: 'owner-mismatch' };
  const bits = [];
  if (verdict.fields.tierBits & 1) bits.push(BIT_BANNER);
  if (verdict.fields.tierBits & 2) bits.push(BIT_TITLE);
  return { bits, reason: null };
}

module.exports = { CAMP_MAGIC, CAMP_VER, BASE_LEN, SIG_INTS, U_NORMAL, U_EXPERT, BIT_BANNER, BIT_TITLE, toBytes, decodeCampaign, verifyCampaignRecord, campaignGrantPlan };
