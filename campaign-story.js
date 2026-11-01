'use strict';
// ============================================================
// campaign-story.js - Vegas campaign STORY mode clear attestation: decode + verify + boundary plan
// ============================================================
// Companion knife 5d (O603, 2026-11-01). The game client's guard sidecar witnesses one story run at a time (55 levels in the
//   original story order: W1 L1..18, the W2 L0 boat level, W2 L1..18, W3 L1..18; failing a level is a free retry of the same
//   level; continuing a saved run starts from the guard's own signed checkpoint, not from the game's editable save file).
//   Only a full clear (W3 L18 passed) produces a record: signed with the build's attestation key, written to the
//   client-writable per-difficulty box `campaign_story_box_d<dif>` (one row per account, only when it beats the account's
//   local best). This module is the cron's read side; boundary checks are fail-closed, rejections land on the offense ledger:
//     B1 signature + registered key (unknown key / layout version -> pending) + row owner == embedded steamId + box dif
//     B2 passes must be exactly 55 ('notclear'); any fast / skip / incons count > 0 -> reject
//     B3 pace: elapsed >= 54 x 40s (the boat level ends when the boat is caught, it is exempt), elapsed <= (55 + fails) x 600s,
//        wall clock agrees (lastAtMin - runT0 minutes >= floor(elapsed/60) - 1; the guard's run clock only moves forward
//        when a run continues on another machine)
//     B4 upper bound: score <= sum over the 55 story levels of CAP(dif, world, level) (gr-caps.json storyRing; byte-locked
//        with the companion repo's generated table). A failed attempt's money is not kept (the retry starts from the last
//        pass), so the clear score is bounded by the 55 passed levels -- not passes + 1 like the Gold Rush lane.
//     B5 lower bound: far below the summed minimum level values -> 'lowscore' signal only (shop spending is legal)
//     B6 caps: fails <= 100000, dif 1..3, runT0 inside [2026-11-01, now + 1d]
//     B7 one clear per run: (account, dif, runT0) settles its first record only; a later different record for the same run can
//        only come from an old checkpoint played again -> dropped ('dup-run'), never an offense (architecture rule 10)
//   Settlement: best-only per difficulty ladder `campaign_story_d<dif>` (score = clear score, details =
//   [elapsedSec, fails, keyId, flags, resumes | rowResumes << 16, runT0]). Dev-key records (keyId 0) verify but only settle on
//   *_test boards. Zero XP / zero points: the only thing at stake is the ladder.
// Byte-locked with the companion repo's test/lib/story-record.js (JS reference encoder) + native story_record.h (the only
//   production encoder); its ledger-schema-lockstep section 28c cross-checks this decoder + boundary plan on shared fixtures.
// Record int32[] v1 (32): [0] 0xBF|ver<<8 [1] keyId [2] dif [3] passes [4] score [5] elapsedSec [6] sidLo [7] sidHi
//   [8] firstAtMin [9] lastAtMin [10] flags=fast|skip<<8|incons<<16 [11] fails [12] runT0 [13] resumes|rowResumes<<16
//   [14] 0 [15] 0 [16..31] sig (over [0..15] LE)
// The Gold Rush lane's verifier (campaign-endless.js) is deliberately not refactored into a shared one before the content
//   freeze: this module repeats its ~25-line verify flow so the live lane's code stays byte-identical.
// ============================================================
const crypto = require('crypto');
const CE = require('./campaign-endless.js');

const ST_MAGIC = 0xBF, ST_VER = 1, BASE_LEN = 16, SIG_INTS = 16, RING_STORY = 55, BOAT_LEVELS = 1;
const MIN_PASS_SEC = 40, MAX_CREDIT_SEC = 600, MAX_FAILS = 100000;
const RUN_T0_FLOOR = 1793491200;   // 2026-11-01T00:00Z: no story run record can predate this lane
const LOWSCORE_FRAC = 0.2;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// offense ledger reason codes: the Gold Rush table plus the story-only reasons
const REASON_CODE = Object.assign({}, CE.REASON_CODE, { notclear: 50, fails: 51, 'dup-run': 52 });   // 'dup-run' is never an offense
const OFFENSE_MAGIC = CE.OFFENSE_MAGIC;   // details: [magic, tMin, dif, reasonCode, passes, score]

function verOf(d) { return Array.isArray(d) && d.length ? (((d[0] | 0) >> 8) & 0xff) : -1; }
function baseLenOf(ver) { return ver === ST_VER ? BASE_LEN : null; }
function pubKeyObj(pubHex) { return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' }); }

// details int32[] -> fields (no verification); wrong shape -> null
function decodeStory(d) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return null;
  if (((d[0] | 0) & 0xff) !== ST_MAGIC) return null;
  const keyId = d[1] | 0;
  const fl = d[10] >>> 0, rs = d[13] >>> 0;
  return {
    ver: verOf(d), keyId, keyName: keyId === 0 ? 'dev' : String(keyId >>> 0),
    dif: d[2] | 0, passes: d[3] | 0, score: d[4] | 0, elapsedSec: d[5] | 0,
    steamId: ((BigInt(d[7] >>> 0) << 32n) | BigInt(d[6] >>> 0)).toString(),
    firstAtMin: d[8] | 0, lastAtMin: d[9] | 0,
    fast: fl & 0xff, skip: (fl >>> 8) & 0xff, incons: (fl >>> 16) & 0xff,
    fails: d[11] | 0, runT0: d[12] | 0, resumes: rs & 0xffff, rowResumes: (rs >>> 16) & 0xffff,
  };
}
// signature hex (dedupe key: runT0 is inside the signed bytes)
function sigHexOf(d) { const bl = baseLenOf(verOf(d)); return bl != null && d.length >= bl + SIG_INTS ? CE.toBytes(d.slice(bl, bl + SIG_INTS)).toString('hex') : ''; }

// -> { ok, reason, pending, fields, sealed }   (same flow as campaign-endless.js verifyGrRecord)
function verifyStoryRecord(d, pubTable) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return { ok: false, reason: 'short' };
  if (((d[0] | 0) & 0xff) !== ST_MAGIC) return { ok: false, reason: 'magic' };
  const bl = baseLenOf(verOf(d));
  if (bl == null) return { ok: false, reason: 'ver', pending: true, fields: decodeStory(d) };
  const f = decodeStory(d);
  for (let i = bl + SIG_INTS; i < d.length; i++) if ((d[i] | 0) !== 0) return { ok: false, reason: 'trailing', fields: f };
  const ent = pubTable && pubTable[f.keyName];
  const held = (ent && Array.isArray(ent.held)) ? ent.held : [];
  if (!ent || !Array.isArray(ent.pubs) || !(ent.pubs.length || held.length)) return { ok: false, reason: 'unknown-key', pending: true, fields: f };
  const bytes = CE.toBytes(d.slice(0, bl));
  const sig = Buffer.alloc(64);
  for (let i = 0; i < SIG_INTS; i++) sig.writeInt32LE(d[bl + i] | 0, i * 4);
  let sigOk = false;
  for (const pub of ent.pubs) { try { if (crypto.verify(null, bytes, pubKeyObj(pub), sig)) { sigOk = true; break; } } catch (e) { /* malformed pub: next */ } }
  if (!sigOk) {
    for (const h of held) { try { if (crypto.verify(null, bytes, pubKeyObj(h.pub), sig)) return { ok: false, reason: 'key-' + h.reason, pending: true, fields: f }; } catch (e) { /* malformed pub: next */ } }
    return { ok: false, reason: 'bad-sig', fields: f };
  }
  return { ok: true, fields: f, sealed: !!ent.sealed };
}

// Boundary sanity (B2..B6) on decoded fields against the cap table {storyRing:[key], levels:{key:{cap:[d1,d2,d3], minLV:[...]}}}.
//   -> { ok, reason, flags[], cap }   (pure; mirrored by the companion repo's reference implementation)
function storyBoundaryPlan(f, caps, opts) {
  const o = opts || {};
  const flags = [];
  if (!f) return { ok: false, reason: 'nofields', flags };
  if (!(f.dif >= 1 && f.dif <= 3)) return { ok: false, reason: 'dif', flags };
  if (f.passes !== RING_STORY) return { ok: false, reason: 'notclear', flags };
  if (!(f.fails >= 0 && f.fails <= MAX_FAILS)) return { ok: false, reason: 'fails', flags };
  if (f.fast > 0 || f.skip > 0 || f.incons > 0) return { ok: false, reason: f.fast > 0 ? 'fast' : (f.skip > 0 ? 'skip' : 'incons'), flags };
  const MIN = o.minPassSec || MIN_PASS_SEC, MAX = o.maxCreditSec || MAX_CREDIT_SEC;
  if (f.elapsedSec < (f.passes - BOAT_LEVELS) * MIN) return { ok: false, reason: 'pace-fast', flags };
  if (f.elapsedSec > (f.passes + f.fails) * MAX) return { ok: false, reason: 'pace-slow', flags };
  const t0Min = Math.floor((f.runT0 | 0) / 60);
  if (f.runT0 < (o.minRunT0 != null ? o.minRunT0 : RUN_T0_FLOOR)) return { ok: false, reason: 'runt0', flags };
  if (o.nowSec != null && f.runT0 > o.nowSec + 86400) return { ok: false, reason: 'runt0', flags };
  if (f.firstAtMin && t0Min > f.firstAtMin) return { ok: false, reason: 'runt0', flags };
  if ((f.lastAtMin - t0Min) < Math.floor(f.elapsedSec / 60) - 1) return { ok: false, reason: 'clock', flags };
  if (f.score < 0 || f.score > 0x7fffffff) return { ok: false, reason: 'score', flags };
  if (caps && caps.levels && Array.isArray(caps.storyRing)) {
    if (caps.storyRing.length !== RING_STORY) return { ok: false, reason: 'captable', flags };
    let cap = 0, low = 0;
    for (const k of caps.storyRing) {
      const e = caps.levels[k];
      if (!e) return { ok: false, reason: 'captable', flags };
      cap += e.cap[f.dif - 1] | 0;
      low += e.minLV[f.dif - 1] | 0;
    }
    if (f.score > cap) return { ok: false, reason: 'overcap', flags, cap };
    if (f.score < Math.floor(low * LOWSCORE_FRAC)) flags.push('lowscore');
    return { ok: true, reason: null, flags, cap };
  }
  return { ok: false, reason: 'captable', flags };   // no story cap table = no settlement (fail-closed; the Gold Rush lane is unaffected)
}

// Full settle decision for one box row: signature verdict + sealed/dev-key gate + owner binding + box difficulty + boundary.
//   -> { ok, reason, pending, flags, fields }
function storySettlePlan(verdict, opts) {
  const o = opts || {};
  if (!verdict || !verdict.ok) return { ok: false, reason: verdict ? verdict.reason : 'none', pending: !!(verdict && verdict.pending), fields: verdict && verdict.fields, flags: [] };
  const f = verdict.fields;
  if (!verdict.sealed && !o.allowDevKey) return { ok: false, reason: 'dev-key-on-prod', fields: f, flags: [] };
  if (o.owner != null && String(o.owner) !== String(f.steamId)) return { ok: false, reason: 'owner-mismatch', fields: f, flags: [] };
  if (o.boxDif != null && (o.boxDif | 0) !== f.dif) return { ok: false, reason: 'difbox', fields: f, flags: [] };
  const bp = storyBoundaryPlan(f, o.caps, o);
  return { ok: bp.ok, reason: bp.reason, fields: f, flags: bp.flags, cap: bp.cap };
}

// B7 one clear per run. runs = state map key -> {sig, t}; key = account pseudonym + dif + runT0. -> { dup, key, first }
function runKeyOf(pidSid, f) { return String(pidSid) + ':' + (f.dif | 0) + ':' + (f.runT0 | 0); }
function runPlan(runs, pidSid, f, sig) {
  const key = runKeyOf(pidSid, f);
  const seen = runs && runs[key];
  return { dup: !!(seen && seen.sig !== sig), key, first: !seen };
}

// ladder row details for a settled clear (clients read [0] = elapsed seconds for the time column)
function storyLadderDetails(f) {
  return [f.elapsedSec | 0, f.fails | 0, f.keyId | 0, ((f.fast | 0) | ((f.skip | 0) << 8) | ((f.incons | 0) << 16)) | 0,
    (((f.resumes | 0) & 0xffff) | (((f.rowResumes | 0) & 0xffff) << 16)) | 0, f.runT0 | 0];
}
function offenseDetails(tMin, f, reason) { return [OFFENSE_MAGIC, tMin | 0, (f && f.dif) | 0, REASON_CODE[reason] || 99, (f && f.passes) | 0, (f && f.score) | 0]; }

module.exports = { ST_MAGIC, ST_VER, BASE_LEN, SIG_INTS, RING_STORY, BOAT_LEVELS, MIN_PASS_SEC, MAX_CREDIT_SEC, MAX_FAILS, RUN_T0_FLOOR, LOWSCORE_FRAC, REASON_CODE, OFFENSE_MAGIC,
  baseLenOf, decodeStory, sigHexOf, verifyStoryRecord, storyBoundaryPlan, storySettlePlan, runKeyOf, runPlan, storyLadderDetails, offenseDetails };
