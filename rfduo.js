'use strict';
// ============================================================
// rfduo.js - couch classic duo (two players on one machine, classic mode) run attestation: decode + verify + boundary plan
// ============================================================
// Companion knife D3 (O310, 2026-11-01). The game client's guard sidecar judges one couch classic duo run at a time
//   (every raw event of the embedded classic game goes through the guard's witness; the slot machine reels are rolled by
//   the guard after the bet; the money is the guard's own ledger, not the game's), counts every anomaly into hard flags,
//   signs a run record with the build's attestation key and writes it to the client-writable box `rfduo_box` (one row per
//   account, only when the run beats the account's local best). This module is the cron's read side:
//     B1 signature + registered key (unknown key / layout version -> pending; a key the job policy holds -> key-<why>
//        pending) + mode == classic, players == 2 + nothing but zeros after the signature + row owner == embedded steamId;
//        dev-key records (keyId 0) verify but only settle on the *_test boards
//     B2 any hard flag count > 0 (protocol / ledger / cap / fast / price / slot) -> reject
//     B2b unwitnessed slot spins > 0 (the guard's reel receipt came too late, the game fell back to its own random) ->
//        not ranked, NOT an offense ('unwit' skip)
//     B3 pace: credited seconds >= summed frame-model floor - slack (2s per level + 10s), credited <= (levels + 1) x 600s,
//        frame floor >= 0, wall clock agrees (lastAtMin - runT0 minutes >= floor(credited/60) - 1), runT0 inside
//        [2026-11-01, now + 1d] and not after the first level
//     B4 per-level gains (the last 48 levels) <= that level's cap (rfduo-caps.json capL, by level number with the
//        classic wrap), and no gain past the levels the run played
//     B5 / B6 coins <= summed layout coins, spins <= coins, triple-gold <= spins, |slot net| <= spins x 3500,
//        0 <= biggest level gain <= biggest level cap, final score <= summed level caps + max(0, slot net)
//     B7 passes <= 10000; 0 passes and a final score <= 0 (the original game lets an overbuy go negative) -> not ranked,
//        NOT an offense ('nopass' / 'nonpos' skips)
//     B8 the same record (signature) never settles twice; best-only ladder
//   Rejections are observation-only in v1 (architecture rule 10, first weeks of an experimental board): counted per
//   reason and per hour in the state file (mass-anomaly mail on the shared 24h threshold), never written to an offense
//   board. Settlement: best-only lifetime ladder `rfduo` (score = final money, details = [passes, s1, s2, runT0]).
//   Zero XP / zero points ride on this lane: the only thing at stake is the ladder itself.
// Byte-locked with the companion repo's test/lib/rfduo-record.js (JS reference encoder; its ledger-schema-lockstep
//   section 28d cross-checks this decoder + boundary plan + fork plan on shared signed fixtures) and the guard's
//   native rfduo_record.h (the only production encoder). The verify flow is cloned from campaign-endless.js on purpose
//   (no shared framework before the content freeze: the live lanes' code stays byte-identical).
// Record int32[64] v1:
//   [0] 0xC1 | ver<<8 | mode<<16 | pc<<24 (mode 1 = classic, pc 2) [1] keyId (dev 0) [2] passes [3] score (guard ledger; may be negative)
//   [4] credSec (guard clock, <= 600 per level) [5] sidLo [6] sidHi [7] firstAtMin [8] lastAtMin [9] runT0 (unix s; a resumed run keeps it)
//   [10] hard flags 6 x 4 bits (protocol / ledger / cap / fast / price / slot) | unwitnessed spins << 24
//   [11] endWhy | resumes << 8 | segStart << 16 (endWhy: 1 over / 2 cap / 3 quit / 4 crash settle / 5 save pending)
//   [12] slotNet [13] spins | gold3 << 16 [14] coins | tnt << 16 [15] spend [16] maxGain [17] event digest (FNV-1a)
//   [18] frame-model floor seconds [19] soft signals [20] s1 [21] s2 [22..45] last 48 level gains (two per int, low 16 bits =
//   the earlier level) [46] gain count [47] level number of the first gain [48..63] Ed25519 signature over [0..47] LE
// ============================================================
const crypto = require('crypto');
const CE = require('./campaign-endless.js');

const MAGIC = 0xC1, VER = 1, BASE_LEN = 48, SIG_INTS = 16, MODE_C = 1, PC = 2, GAINS = 48;
const WHY = Object.freeze({ OVER: 1, CAP: 2, QUIT: 3, CRASH: 4, SAVE: 5 });
const HARD_NAMES = ['proto', 'ledger', 'cap', 'fast', 'price', 'slot'];
const RUN_T0_FLOOR = 1793491200;   // 2026-11-01T00:00Z: no couch classic duo record can predate this lane
const MAX_PASSES = 10000, LEVEL_CREDIT_MAX = 600, SLOT_NET_MAX = 3500;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// signed-base length by header version (null = a version this reader does not know -> pending)
function baseLenOf(ver) { return ver === VER ? BASE_LEN : null; }
function verOf(d) { return Array.isArray(d) && d.length ? (((d[0] | 0) >> 8) & 0xff) : -1; }
function pubKeyObj(pubHex) { return crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubHex, 'hex')]), format: 'der', type: 'spki' }); }

// details int32[] -> fields (no verification); wrong shape -> null
function decodeRfduo(d) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return null;
  if (((d[0] | 0) & 0xff) !== MAGIC) return null;
  const h0 = d[0] >>> 0, hf = d[10] >>> 0, ew = d[11] >>> 0;
  const gainsN = Math.max(0, Math.min(GAINS, d[46] | 0));
  const gains = [];
  for (let i = 0; i < gainsN; i++) { const x = d[22 + (i >> 1)] >>> 0; gains.push(i & 1 ? (x >>> 16) & 0xffff : x & 0xffff); }
  const hard = {}; HARD_NAMES.forEach((n, i) => { hard[n] = (hf >>> (i * 4)) & 15; });
  return {
    ver: (h0 >>> 8) & 0xff, mode: (h0 >>> 16) & 0xff, pc: (h0 >>> 24) & 0xff, keyId: d[1] | 0, keyName: (d[1] | 0) === 0 ? 'dev' : String(d[1] >>> 0),
    passes: d[2] | 0, score: d[3] | 0, credSec: d[4] | 0, steamId: ((BigInt(d[6] >>> 0) << 32n) | BigInt(d[5] >>> 0)).toString(),
    firstAtMin: d[7] | 0, lastAtMin: d[8] | 0, runT0: d[9] | 0, hardBits: hf & 0xffffff, hard, unwit: (hf >>> 24) & 0xff,
    endWhy: ew & 0xff, resumes: (ew >>> 8) & 0xff, segStart: (ew >>> 16) & 0xffff,
    slotNet: d[12] | 0, spins: (d[13] >>> 0) & 0xffff, gold3: (d[13] >>> 16) & 0xffff, coins: (d[14] >>> 0) & 0xffff, tnt: (d[14] >>> 16) & 0xffff,
    spend: d[15] | 0, maxGain: d[16] | 0, digest: d[17] >>> 0, frameSec: d[18] | 0, soft: d[19] >>> 0, s1: d[20] | 0, s2: d[21] | 0,
    gains, gainsFirstD: d[47] | 0, reserved: 0,
  };
}
// signature hex (dedupe key: runT0 is inside the signed bytes, so two runs of one account never share a signature)
function sigHexOf(d) { const bl = baseLenOf(verOf(d)); return bl != null && Array.isArray(d) && d.length >= bl + SIG_INTS ? CE.toBytes(d.slice(bl, bl + SIG_INTS)).toString('hex') : ''; }

// -> { ok, reason, pending, fields, sealed }   (same flow as campaign-endless.js verifyGrRecord)
function verifyRfduoRecord(d, pubTable) {
  if (!Array.isArray(d) || d.length < BASE_LEN + SIG_INTS) return { ok: false, reason: 'short' };
  if (((d[0] | 0) & 0xff) !== MAGIC) return { ok: false, reason: 'magic' };
  const bl = baseLenOf(verOf(d));
  if (bl == null) return { ok: false, reason: 'ver', pending: true, fields: decodeRfduo(d) };
  const f = decodeRfduo(d);
  for (let i = bl + SIG_INTS; i < d.length; i++) if ((d[i] | 0) !== 0) return { ok: false, reason: 'trailing', fields: f };
  const ent = pubTable && pubTable[f.keyName];
  const held = (ent && Array.isArray(ent.held)) ? ent.held : [];   // keys the job's key policy holds (attest.applyKeyPolicy)
  if (!ent || !Array.isArray(ent.pubs) || !(ent.pubs.length || held.length)) return { ok: false, reason: 'unknown-key', pending: true, fields: f };
  const bytes = CE.toBytes(d.slice(0, bl));
  const sig = Buffer.alloc(64);
  for (let i = 0; i < SIG_INTS; i++) sig.writeInt32LE(d[bl + i] | 0, i * 4);
  let sigOk = false;
  for (const pub of ent.pubs) { try { if (crypto.verify(null, bytes, pubKeyObj(pub), sig)) { sigOk = true; break; } } catch (e) { /* malformed pub: next */ } }
  if (!sigOk) {
    // a held key's signature: pending (soft), never bad-sig
    for (const h of held) { try { if (crypto.verify(null, bytes, pubKeyObj(h.pub), sig)) return { ok: false, reason: 'key-' + h.reason, pending: true, fields: f }; } catch (e) { /* malformed pub: next */ } }
    return { ok: false, reason: 'bad-sig', fields: f };
  }
  return { ok: true, fields: f, sealed: !!ent.sealed };
}

// level number d (1-based, unbounded) -> classic level 1..total (after the last level the game wraps to wrapTo)
const levelOf = (caps, d) => (d <= caps.total ? d : caps.wrapTo + ((d - caps.total - 1) % (caps.total - caps.wrapTo + 1)));
// Boundary sanity (B2..B7) on decoded fields against rfduo-caps.json. -> { ok, reason, skip, cap }
//   skip = not ranked and not an offense. Pure; mirrored by the companion repo's reference implementation.
function boundaryPlan(f, caps, opts) {
  const o = opts || {};
  if (!f) return { ok: false, reason: 'nofields' };
  if (f.mode !== MODE_C || f.pc !== PC) return { ok: false, reason: 'mode' };
  if (!(f.passes >= 0 && f.passes <= MAX_PASSES)) return { ok: false, reason: 'passes' };
  if (f.passes === 0) return { ok: false, reason: 'nopass', skip: true };
  if (f.hardBits !== 0) return { ok: false, reason: 'flag-' + HARD_NAMES.find(n => f.hard[n] > 0) };   // B2
  if (f.unwit > 0) return { ok: false, reason: 'unwit', skip: true };                                    // B2b a late reel receipt: not ranked, not an offense
  if (!(f.endWhy >= 1 && f.endWhy <= 5)) return { ok: false, reason: 'endwhy' };
  if (f.score <= 0) return { ok: false, reason: 'nonpos', skip: true };                                  // an overbuy can end negative: not ranked, not an offense
  const levels = f.passes + (f.endWhy === WHY.OVER ? 1 : 0);
  // B3 pace: credited >= frame floor - slack (2s per level + 10s), <= (levels + 1) x 600, wall clock, runT0 window
  if (f.credSec + 2 * levels + 10 < f.frameSec) return { ok: false, reason: 'pace-fast' };
  if (f.credSec > (levels + 1) * LEVEL_CREDIT_MAX) return { ok: false, reason: 'pace-slow' };
  if (f.frameSec < 0) return { ok: false, reason: 'pace-fast' };
  if (f.runT0 < (o.minRunT0 != null ? o.minRunT0 : RUN_T0_FLOOR)) return { ok: false, reason: 'runt0' };
  if (o.nowSec != null && f.runT0 > o.nowSec + 86400) return { ok: false, reason: 'runt0' };
  const t0Min = Math.floor((f.runT0 | 0) / 60);
  if (f.firstAtMin && t0Min > f.firstAtMin) return { ok: false, reason: 'runt0' };
  if ((f.lastAtMin - t0Min) < Math.floor(f.credSec / 60) - 1) return { ok: false, reason: 'clock' };
  if (!caps) return { ok: true, reason: null };
  // B4 per-level gains <= that level's cap (by level number, with the wrap)
  for (let i = 0; i < f.gains.length; i++) { const d = f.gainsFirstD + i; if (d < 1 || f.gains[i] > caps.capL[levelOf(caps, d) - 1]) return { ok: false, reason: 'overcap-level' }; }
  if (f.gains.length && f.gainsFirstD + f.gains.length - 1 > levels) return { ok: false, reason: 'gains' };
  // B5 / B6 run totals: coins / slot / biggest level / final score
  let capSum = 0, coinSum = 0, maxL = 0;
  for (let d = 1; d <= levels + 1; d++) { const l = levelOf(caps, d); capSum += caps.capL[l - 1]; coinSum += caps.coinsL[l - 1]; if (caps.capL[l - 1] > maxL) maxL = caps.capL[l - 1]; }
  if (f.coins > coinSum) return { ok: false, reason: 'coins' };
  if (f.spins > f.coins) return { ok: false, reason: 'spins' };
  if (f.gold3 > f.spins) return { ok: false, reason: 'gold3' };
  if (Math.abs(f.slotNet) > f.spins * SLOT_NET_MAX) return { ok: false, reason: 'slotnet' };
  if (f.maxGain > maxL || f.maxGain < 0) return { ok: false, reason: 'maxgain' };
  if (f.score > capSum + Math.max(0, f.slotNet)) return { ok: false, reason: 'overcap', cap: capSum };
  return { ok: true, reason: null, cap: capSum };
}

// Full settle decision for one box row: signature verdict + sealed/dev-key gate + owner binding + boundary.
//   -> { ok, reason, pending, skip, fields, cap }
function settlePlan(verdict, opts) {
  const o = opts || {};
  if (!verdict || !verdict.ok) return { ok: false, reason: verdict ? verdict.reason : 'none', pending: !!(verdict && verdict.pending), skip: false, fields: verdict && verdict.fields };
  const f = verdict.fields;
  if (!verdict.sealed && !o.allowDevKey) return { ok: false, reason: 'dev-key-on-prod', pending: false, skip: false, fields: f };
  if (o.owner != null && String(o.owner) !== String(f.steamId)) return { ok: false, reason: 'owner-mismatch', pending: false, skip: false, fields: f };
  const bp = boundaryPlan(f, o.caps, o);
  return { ok: bp.ok, reason: bp.reason, pending: false, skip: !!bp.skip, fields: f, cap: bp.cap };
}

// ladder row details for a settled run (clients read [0] = passes for the "N levels" column)
function ladderDetails(f) { return [f.passes | 0, f.s1 | 0, f.s2 | 0, f.runT0 | 0]; }

// Fork rule: one (account, runT0, resumes) segment ends in one record content; a second, different content = an old save
//   row written back and played again -> the later record is dropped ('fork'), never an offense (architecture rule 10).
//   forks = state map key -> {fp, t}. -> { fork, key, fp, first }
function forkKeyOf(pidSid, f) { return f ? (String(pidSid) + ':' + (f.runT0 | 0) + ':' + (f.resumes | 0)) : null; }
function forkFpOf(f) { return [f.passes | 0, f.score | 0, f.credSec | 0, f.endWhy | 0, f.hardBits | 0, f.digest >>> 0].join(':'); }
function forkPlan(forks, pidSid, f) {
  const key = forkKeyOf(pidSid, f);
  if (!key) return { fork: false, key: null, fp: null, first: false };
  const fp = forkFpOf(f);
  const seen = forks && forks[key];
  return { fork: !!(seen && seen.fp !== fp), key, fp, first: !seen };
}

// shared with the Gold Rush lane: the 24h mass-anomaly mail decision and the 48h reject-hour pruning
const mailDecision = CE.mailDecision, pruneRejects = CE.pruneRejects;

module.exports = { MAGIC, VER, BASE_LEN, SIG_INTS, MODE_C, PC, GAINS, WHY, HARD_NAMES, RUN_T0_FLOOR, MAX_PASSES, LEVEL_CREDIT_MAX, SLOT_NET_MAX,
  baseLenOf, verOf, decodeRfduo, sigHexOf, verifyRfduoRecord, levelOf, boundaryPlan, settlePlan, ladderDetails, forkKeyOf, forkFpOf, forkPlan, mailDecision, pruneRejects };
