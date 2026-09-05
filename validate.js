'use strict';
const fs = require('fs');
const crypto = require('crypto');
const ts = require('./trueskill.js');
const attest = require('./attest.js');   // knife-7: solo attested-record verify + unmatched confession reconcile
const campaign = require('./campaign.js');   // O159 knife-7d: Vegas campaign clear attestation -> exclusive cosmetic grants
const supporters = require('./supporters.js');   // supporter pack: DLC ownership probe -> wall board / grant bit / points bonus

const APPID = Number(process.env.APPID);
const PREFIX = process.env.LB_PREFIX;
const KEY = process.env.STEAM_PUBLISHER_KEY;
const SALT = process.env.STATE_SALT;
const BASE = 'https://partner.steam-api.com';
const RANKED_LB = process.env.RANKED_LB;
const PROCESSED_FILE = process.env.PROCESSED_FILE || 'processed.json';
const K_FACTOR = Number(process.env.K_FACTOR || 32), BASE_MMR = Number(process.env.BASE_MMR || 1000);
const APPLY_MMR = process.env.APPLY_MMR !== '0';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 8));

// ---- playtest channel (PT_MODE=1) ----
// Second-appid job for the pre-release playtest build: the SAME reconcile pipeline pointed at
// the playtest app, with every competitive/monetized authority surface structurally ABSENT.
// The design rule ("lock layer 3"): a board that does not exist cannot be written, so a
// modified playtest client has nowhere to land a forged ranked/redeem claim -- the strongest
// possible lock, enforced here rather than in client UI.
//  * settles quick (base 1/3/5) + co-op endless (7) only. Every ranked base (2/4/6) has no
//    client entry point on this channel (the queue guard refuses ranked wholesale), so a
//    ranked-typed record is forgery by construction: sanity-flagged, never settled.
//  * no rating/points surface: TrueSkill and the visible points ladder are skipped wholesale
//    (skill/groups state untouched). XP/career, the CP wallet and the endless depth boards run
//    same-source as live -- optimistic client values still need their authoritative correction.
//  * redeem channel disabled (its resolver would otherwise auto-create the redeem/grant boards).
//  * board bootstrap: provisions the channel's own boards idempotently each run and FAILS the
//    run if a forbidden board (rating/points/redeem/grant/mirror) exists on this app id.
//  * PT_SEED_CP: one-shot starter wallet for first-seen players. This channel earns CP only
//    during forced quick windows, but the endless continue economy still needs exercising --
//    the flat grant funds a couple of continues without touching the live earn rates.
const PT_MODE = process.env.PT_MODE === '1';
const PT_MT_ALLOWED = [1, 3, 5, 7, 8, 10];   // lockstep: client MATCHTYPE_CODE quick=1(+team offsets 3/5/8), endless=7 (O82: 8 = quick 3V3), private=10 (O140 friend-room XP)
const PT_SEED_CP = Math.max(0, Number(process.env.PT_SEED_CP || 60));
const PT_SHARD_COUNT = Math.max(1, Number(process.env.PT_SHARD_COUNT || 50));   // lockstep: client LEDGER_SHARDS
const PT_MIRROR_LB = 'mirror_box';   // never provisioned on the playtest app (progress does not migrate)

const pid = (s) => crypto.createHmac('sha256', String(SALT || '')).update(String(s)).digest('hex').slice(0, 16);
const plog = (s) => pid(s).slice(0, 8);

const START_MAGIC = 0xB2;   // start-attestation record (settle records stay 0xB1; lockstep with the client writer)
// Abandon-confession record: a voluntarily-leaving (or idle-kicked) client writes a self-signed
// "I left" record on the way out -- same v3 layout with zeroed results, disp slot 5/7 (lockstep
// with the client writer). It makes the leaver penalty authoritative WITHOUT finisher consensus,
// closing the everyone-left hole: a match whose sole survivor writes a lone record never settles,
// so detectLeavers never runs and the leaver's optimistic deduction was silently reverted by
// read-back. Trust surface is zero: identity is the leaderboard entry owner and the content only
// ever hurts that same account (spamming fake confessions just fines yourself into the floor).
// Reconnect forgiveness mirror: if the confessor later writes a settle record for the same match
// (came back and finished), the exact deducted amount is refunded and the exit-rate signal is
// retracted -- the pending entry tracks the amount, never an identity (state stays de-identified).
const CONFESS_MAGIC = 0xB5;
// 'kicked' (7) = removed by the host for in-match inactivity; classed abandoner like user-quit.
// A kicked player never writes a settle record (they leave mid-match), so the code never appears
// in a shard in practice -- it exists for client-side exit-signal classing and table lockstep.
// 'eac-kick' (8) = anti-cheat detected a cheater; the host terminated the match for everyone.
// Innocent finishers each write a settle record with this code (innocent class, VOID >= 2), so the
// group voids by consensus: no rating/points move, detectLeavers never runs (the removed cheater is
// not convicted as a leaver here -- the anti-cheat sanction pipeline handles them), and each writer
// still gets innocent-class credit (base XP / consolation path).
// 'eac-drop' (9) = this client lost anti-cheat protection mid-match and was removed alone (innocent;
// like 'kicked' it never appears in a shard -- the dropped client leaves without writing).
const DISP_NAME = ['finished', 'peers-gone', 'host-left', 'level-begin-timeout', 'migrate-disband', 'user-quit', 'reconnect-failed', 'kicked', 'eac-kick', 'eac-drop'];
const dispName = c => (DISP_NAME[c | 0] || ('disp' + (c | 0)));
const isVoidDisp = c => (c | 0) >= 2;

function voidByConsensus(dispCodes) {
  const present = dispCodes.length;
  const voidVotes = dispCodes.filter(isVoidDisp).length;
  return { isVoid: voidVotes * 2 > present, voidVotes, present };
}
function decodeDetails(hex) {
  if (!hex || typeof hex !== 'string') return [];
  const o = [];
  for (let i = 0; i + 8 <= hex.length; i += 8) {
    const le = hex.slice(i, i + 8);
    o.push(parseInt(le.slice(6, 8) + le.slice(4, 6) + le.slice(2, 4) + le.slice(0, 2), 16) | 0);
  }
  return o;
}
function encodeDetails(arr) {
  return arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
}
function decodeSid(lo, hi) { return ((BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0)).toString(); }
function decodeRoster(d) {
  const pc = d[8] | 0, base = 11 + pc, r = {};
  if (pc >= 1 && d.length >= base + 2 * pc) for (let s = 0; s < pc; s++) { const sid = decodeSid(d[base + 2 * s] | 0, d[base + 2 * s + 1] | 0); if (sid !== '0') r[s] = sid; }
  return r;
}
function detectLeavers(g) {
  if (!g || g.length < 2) return [];
  const present = new Set(g.map(r => r.d[5] | 0));
  const votes = {};
  for (const r of g) for (const seatKey of Object.keys(r.roster || {})) {
    const seat = seatKey | 0, sid = r.roster[seatKey];
    (votes[seat] = votes[seat] || {})[sid] = (votes[seat][sid] || 0) + 1;
  }
  const leavers = [];
  for (const seatKey of Object.keys(votes)) {
    const seat = seatKey | 0;
    if (present.has(seat)) continue;
    let best = null, bestN = 0;
    for (const sid of Object.keys(votes[seat])) if (votes[seat][sid] > bestN) { bestN = votes[seat][sid]; best = sid; }
    if (best && bestN * 2 > g.length) leavers.push({ seat, steamID: best });
  }
  return leavers;
}
// ---- start-attestation records (magic 0xB2) ----
// Every client writes a start-type record when level 1 actually begins (same field layout as a
// settle record with all result fields zeroed, so decodeRoster and the composite group key are
// reused verbatim). They close the detection blind spot of a match NOBODY settles: absence-based
// leaver conviction needs a finisher's record as its anchor, so a match where every participant
// quits (or a coordinated dodge) used to vanish without a trace.
//
// Pending state (STARTS_FILE) is required because leaderboard entries carry no timestamp and a
// writer's later matches overwrite his shard entry: the consensus roster is captured (HMAC pids
// only, matching the rest of the state) the first time a start group is seen, and judged once the
// entry is older than STARTS_MATURITY_MS.
//
// Verdict at maturity with no consistent settlement: every consensus-roster member who wrote no
// settle record gets an exit-rate hit (leavers.json -> effectiveLeaverFactor). Deliberately NO LP
// deduction: with zero finisher testimony an all-absent match cannot be told apart from a
// migration-failure / crash cascade, so the harsh ranked penalty stays on the finisher-consensus
// path (detectLeavers). Escalation on top of this signal is trust-graph territory.
// O93: the one-attester exception of reconcileStarts (solo competitive segment start)
function soloStartAttested(att) {
  if (!att || att.length !== 1) return false;
  const r = att[0];
  return isEndlessMt(r.d[2] | 0) && (r.d[8] | 0) === 1 && !!r.roster && String(r.roster[0]) === String(r.steamID);
}
function reconcileStarts(starts, groups, consistentKeys, processed, pending, leavers, now, maturityMs, confState) {
  confState = confState || {};
  const sg = {};
  for (const r of starts) { const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2]; (sg[m] = sg[m] || []).push(r); }
  let registered = 0, convicted = 0, cleaned = 0;
  const consoledSids = [];   // interrupted-match consolation: real sids of still-visible settle writers at verdict time (in-memory only, never persisted -- state stays HMAC-keyed)
  // 1) register new pending entries (sticky first-seen: shard entries may be overwritten later)
  for (const m of Object.keys(sg)) {
    if (processed.has(m) || pending[m]) continue;
    const bySid = {};   // one vote per distinct writer (a cold-reconnect duplicate collapses)
    for (const r of sg[m]) bySid[String(r.steamID)] = r;
    const att = Object.values(bySid);
    // a single attestation convicts nobody (mirrors settle consensus) -- except an O93 solo competitive
    //   segment start (pc=1 endless, 2026-09-06): its ONE guard-written attestation is the segment's
    //   pacing anchor (endless keys are never convicted below), and its roster must name the writer at seat 0.
    if (att.length < 2 && !soloStartAttested(att)) continue;
    const votes = {};
    for (const r of att) for (const seatKey of Object.keys(r.roster || {})) {
      const seat = seatKey | 0, sid = r.roster[seatKey];
      (votes[seat] = votes[seat] || {})[sid] = (votes[seat][sid] || 0) + 1;
    }
    const roster = {}; let n = 0;
    for (const seatKey of Object.keys(votes)) {
      let best = null, bestN = 0;
      for (const sid of Object.keys(votes[seatKey])) if (votes[seatKey][sid] > bestN) { bestN = votes[seatKey][sid]; best = sid; }
      if (best && bestN * 2 > att.length) { roster[seatKey | 0] = pid(best); n++; }   // strict majority per seat
    }
    if (!n) continue;
    pending[m] = { t0: now, mt: sg[m][0].d[2] | 0, roster, settled: [] };
    registered++;
    console.log('  start-pending ' + m + ': ' + att.length + ' attesters, roster ' + n + ' seats');
  }
  // 2) upkeep + maturity verdicts for pending entries
  for (const m of Object.keys(pending)) {
    if (processed.has(m)) { delete pending[m]; cleaned++; continue; }   // settled (or convicted) since
    const p = pending[m];
    // anyone who wrote ANY settle record was present at the end -> exempt. Tracked cumulatively:
    // a lone settle (e.g. the finishing side of a 2P match) can be overwritten before maturity.
    if (groups[m]) for (const r of groups[m]) { const h = pid(r.steamID); if (p.settled.indexOf(h) < 0) p.settled.push(h); }
    if (consistentKeys.has(m)) continue;   // consistent settle group -> the normal pipeline owns this key
    // endless (type 7): never convicted from an orphaned start. Co-op runs are excluded from the
    // exit-rate economy by design (client parity), and a legit endless run outlives the matchmade
    // maturity window many times over -- convicting at 2h would hit players who are still playing.
    // The entry stays as the pacing anchor for its settle and is pruned on its own long TTL.
    // O140: private friend rooms (type 10) join the endless exemption -- members come and go
    // freely by design (no leaver economy on invite-only play), so an orphaned start convicts
    // nobody; the entry stays as the settle's pacing anchor and prunes on the same long TTL.
    if (isEndlessMt(p.mt) || isPrivateMt(p.mt)) {
      if (now - (p.t0 || 0) > ENDLESS.PENDING_TTL_MS) { delete pending[m]; cleaned++; }
      continue;
    }
    if (now - (p.t0 || 0) < maturityMs) continue;
    const hit = [];
    for (const seat of Object.keys(p.roster)) {
      const h = p.roster[seat];
      if (p.settled.indexOf(h) >= 0) continue;
      if (confState[h + '|' + m]) continue;   // confession already counted this leave (no double exit-rate)
      leavers[h] = leavers[h] || { leaves: 0, lastMatch: '' };
      leavers[h].leaves += 1; leavers[h].lastMatch = m;
      hit.push(h.slice(0, 8));
    }
    // interrupted-match consolation: whoever wrote a settle record for this key and is STILL
    // visible on their shard at verdict time gets the flat CONSOLATION_XP credit (caller writes
    // the board -- real sids are only available from the live records; a writer rotated off
    // their shard within the maturity window keeps the exit-rate exemption via p.settled but
    // forfeits the symbolic credit). Structurally-impossible lone records (sanity bounds) and
    // roster outsiders earn nothing.
    if (groups[m]) for (const r of groups[m]) {
      const s = String(r.steamID);
      if (consoledSids.indexOf(s) >= 0) continue;
      const h = pid(s);
      if (!Object.keys(p.roster).some((seat) => p.roster[seat] === h)) continue;   // not on the attested roster
      if (sanityFlags([r]).length) continue;
      consoledSids.push(s);
    }
    convicted += hit.length;
    processed.add(m);   // idempotent: a super-late settlement of a convicted key is skipped as stale
    delete pending[m];
    console.log('  start-orphan ' + m + ': started, never settled -> ' + hit.length + ' exit-rate hits (' + hit.join(',') + ')' + (p.settled.length ? ', ' + p.settled.length + ' exempt (wrote a settle record)' : ''));
  }
  return { registered, convicted, cleaned, consoledSids };
}
// ---- deterministic sanity bounds (B5 tier A: flag-don't-settle) ----
// Catches the case consensus can't: colluding clients writing IDENTICAL impossible records.
// Only calibration-free structural/physical bounds live here (generous by design -- a false
// positive silently unsettles a legit match, so every cap sits far above anything the game
// can produce). Statistical thresholds (win rates, distribution tightening) are deferred
// until real-traffic data exists. A flagged match is NOT settled and NOT marked processed:
// if a bound turns out wrong and is loosened later, still-visible records self-heal.
const SANITY = {
  SCORE_CAP: Number(process.env.SANITY_SCORE_CAP || 100000),     // observed finals 4-16k; theoretical vacuum-everything ~30-50k
  SCORE_FLOOR: Number(process.env.SANITY_SCORE_FLOOR || -50000), // shop overdraft is legal (classic rule) but bounded by shop prices
  DUR_CAP: Number(process.env.SANITY_DUR_CAP || 7200),           // a 5-level match is ~10-25 min; forced settles can be short, garbage is huge
  // minimum REAL time between a match's start attestation being first sighted and its settle
  // group becoming eligible. This is the cron's OWN wall clock (starts.json t0), not any
  // client-reported duration -- a speed hack or a forged durationSec cannot move it. A full
  // match is 8+ min, so legit settles arrive already-aged (worst case one extra run of delay);
  // a fabricated start+settle batch has to sit out the minimum in pending first.
  MIN_START_AGE_MS: Number(process.env.SANITY_MIN_START_AGE_MS || 300000),
  MT_ALLOWED: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],                   // quick/ranked x brawl/team1/mode2 + endless co-op + O82 3V3 (8/9 joined with the 6P matchmaking client gate) + O140 private friend rooms (10, XP-only track)
};
// Mode-2 (base 5/6) score headroom: the mid-run gamble round can at most triple a player's bank
// (max table multiplier x3, bet bounded by own coins), so the generous global cap gets the same
// x3 headroom -- without it a legit vacuum-everything run through the gamble could brush the cap.
// The client repo pins its gamble table's max multiplier against this factor in its lockstep test.
const TEAM2 = { SCORE_MULT: Number(process.env.TEAM2_SCORE_MULT || 3) };
// ===== O140 friend-room XP (match type 10, 2026-09-01) =====
// Invite-only private rooms earn SMALL XP (well below matchmade) so friend-only players still
// progress. XP is the ONLY surface: no TrueSkill/LP/CP/career/leaver conviction/B6 pair signals.
// Anti-farm = three layers (user-directed: TIME is the proof of work):
//   1. structural: the ordinary >=2-consistent-writers settle gate (lone records never pay);
//   2. time-as-work: a claimed lv-level room cannot settle before lv*LEVEL_SECONDS*PACE_FRAC
//      of REAL wall time on this job's own clock (endless pacing family; floor MIN_START_AGE);
//   3. per-UTC-day XP cap (dayCapXp) -- even a wall-clock-honest farm is bounded per day.
//      2026-09-05: 500 -> 25,000 = the 24h theoretical ceiling (fastest honest rate ~92 XP per
//      3-level room at ~5 min per room, 24h non-stop ~= 24-26k): the cap only bites physically
//      impossible rates (multi-boxing / forgery); real anti-farm stays the zero-sum transfer + pacing.
// The WIN half is a zero-sum transfer paid out of the losers' share (winner ~= P+T, last
// place ~= P-T): win-trading between colluding accounts nets zero beyond the day-capped
// participation floor, and an all-tie group transfers nothing.
// Client mirror: rating-store PRIVATE leg (RANKED_CONFIG.XP.PRIVATE) -- value-pinned by the
// companion repo's lockstep test; change either side only together.
const PRIVATE_XP = {
  MT: 10,
  base: 20, perLevel: 9, transferFrac: 0.4, dayCapXp: 25000,
  progMax: 15, defaultLevels: 3,                       // d[7] progress domain (private rooms run 3/6/9 levels)
  LEVEL_SECONDS: 75, PACE_FRAC: 0.5,                   // same physical floor family as ENDLESS
};
function isPrivateMt(mt) { return baseMt(mt) === PRIVATE_XP.MT; }
// NOTE (extensibility): SCORE_CAP/DUR_CAP/MIN_START_AGE_MS were derived from the MATCHMADE game
// -- originally 5 levels per matchmade run, 2-4 players, current item-value scale. A level-count
// change or economy rework must re-derive them. Re-derived 2026-08-26 (O117, 5 -> 6 levels):
// theoretical vacuum-everything ~36-60k << SCORE_CAP 100k, a 6-level run ~12-30 min << DUR_CAP
// 7200s, and a longer match only strengthens the MIN_START_AGE premise -- all three caps stand.
// Mode-2 (5/6) keeps the same duration cap
// (6 rounds + gamble + at most one sudden-death level is the same order of play time) but takes a
// x3 score headroom for the gamble round (TEAM2 above). The client repo pins these assumptions in
// its lockstep test so such a change fails loudly there. Type 7 (endless) deliberately does NOT
// use these caps: its score cap scales with the claimed depth and its time bound is the
// depth-scaled pacing gate (see the ENDLESS block), because both grow without bound by design.
const SID_MIN = 0x0110000100000000n, SID_MAX = SID_MIN + (1n << 32n);   // individual-account steamID64 universe base (hex form)
function sidPlausible(sid) { try { const b = BigInt(sid); return b >= SID_MIN && b <= SID_MAX; } catch (e) { return false; } }
// g = one consistent match group. Returns [] when sane, else short reason slugs.
function sanityFlags(g) {
  const out = [];
  const d0 = g[0].d, mt = d0[2] | 0, base = baseMt(mt), mask = premadeMaskOf(mt), pc = d0[8] | 0, trioAt = premadeTrioAtOf(mt);
  // playtest channel: the allowed set narrows to quick + endless -- a ranked-typed record has
  // no legit writer on this channel (queue guard refuses ranked), so it is flagged as forgery.
  if ((PT_MODE ? PT_MT_ALLOWED : SANITY.MT_ALLOWED).indexOf(base) < 0) out.push('mt');
  let scoreCap = SANITY.SCORE_CAP;
  if (isTeamMt(base)) {
    if (mask !== 0 || trioAt !== 0) out.push('team-mask');   // team codes never carry premade fields (pair mask OR trio)
    if (pc !== 2 * teamSizeOfMt(base)) out.push('pc');       // team modes seat exactly 2x teamSize (2v2=4 / 3v3=6)
    if (isSubScoreMt(base)) {
      scoreCap = SANITY.SCORE_CAP * TEAM2.SCORE_MULT; // gamble-round variance headroom (see TEAM2)
      // sub-score outcome must be derivable: every present writer's rank claim implies the same
      // winner (rank is host-broadcast lockstep fact, exactly like the score vector) -- a conflict
      // is forgery evidence and money must NOT decide as a fallback, so the group is flagged
      // (not settled, not processed) like any other impossible-but-consistent record.
      if (team2WinTeamOf(g) == null) out.push('rank-conflict');
    }
  } else if (base === ENDLESS.MT) {
    // endless co-op: 2 or 3 seats (knife-B 2026-08-13), never a premade mask, well-formed depth tail.
    if (mask !== 0 || trioAt !== 0) out.push('mask');
    if (pc !== 2 && pc !== 3) out.push('pc');
    const t = endlessTail(d0);
    if (!t) out.push('tail');                         // every real writer appends the tail; absence = malformed/forged
    else {
      if (t.startDepth < 0 || t.endDepth < t.startDepth || t.endDepth > ENDLESS.DEPTH_CAP) out.push('depth');
      // per-seat continue nibbles: only the low pc nibbles may be set (the int packing
      // structurally holds 8 seats; a nibble beyond the real seat count is forged). Guarded on
      // a sane pc -- a bad pc is already flagged above and 1<<(4*pc) overflows past pc=7.
      if (pc >= 2 && pc <= 3 && (t.continuesUsed & ~((1 << (4 * pc)) - 1)) !== 0) out.push('cont');
      if (t.tokensCp !== 0) out.push('tokens');                // CP-purchased saves are retired; real clients always write 0
      if (t.seasonId < -1 || t.seasonId > 4095) out.push('season');   // season snapshot domain (absent = -1 legacy; ids are small)
      // score cap scales with the claimed depth (the global matchmade cap has no meaning on an
      // unbounded track); the floor stays shared -- shop overdraft is equally legal here.
      scoreCap = endlessGoalFor(t.endDepth, pc) * ENDLESS.SCORE_MULT;
    }
  } else if (base === PRIVATE_XP.MT) {
    // O140 friend rooms: 2..6 seats, never premade fields (the client's mtCodeOf returns the
    // bare base for entry 'private'). The room may have run mode-2 internally (the flat code
    // carries no team info), so the score cap takes the same gamble headroom as the sub-score
    // codes -- scores only order ranks for the XP-lite formula (money never feeds it), so a
    // generous cap costs nothing.
    if (mask !== 0 || trioAt !== 0) out.push('mask');
    if (pc < 2 || pc > 6) out.push('pc');
    scoreCap = SANITY.SCORE_CAP * TEAM2.SCORE_MULT;
  } else {
    if (pc < 2 || pc > 6) out.push('pc');             // matchmade FFA lobbies are 2..6 players (O82: 5-6P with a trio present)
    for (let k = 0; k < 4; k++) if ((mask >> k) & 1) { if (2 * k + 1 >= pc) { out.push('mask-range'); break; } }
    if (trioAt > 0) {
      if (trioAt + 1 >= pc) out.push('trio-range');   // trio seats (trioAt-1 .. trioAt+1) must all exist
      else for (let k = 0; k < 4; k++) if ((mask >> k) & 1) {
        // a seat can't belong to both a pair and the trio (structurally impossible from an honest host)
        if (2 * k + 1 >= trioAt - 1 && 2 * k <= trioAt + 1) { out.push('unit-overlap'); break; }
      }
    }
  }
  const scores = d0.slice(10, 10 + pc);
  for (const s of scores) if ((s | 0) > scoreCap || (s | 0) < SANITY.SCORE_FLOOR) { out.push('score'); break; }
  const writers = new Set(g.map(r => String(r.steamID)));
  if (writers.size < g.length) out.push('dup-writer'); // one account can't hold two seats / write twice
  for (const r of g) {
    const dur = r.d[9] | 0, seat = r.d[5] | 0;
    // endless sessions legitimately run for hours (and resume across days) -- no duration cap
    // there; real elapsed time is enforced by the pacing gate against this job's own clock.
    if (dur < 0 || (base !== ENDLESS.MT && dur > SANITY.DUR_CAP)) { out.push('duration'); break; }
    if (seat < 0 || seat >= pc) { out.push('seat'); break; }
    const roster = r.roster || {};
    // the writing account is unforgeable (leaderboard entry owner) -- a roster that puts
    // somebody else at the writer's own seat is a forged record, not a disagreement.
    if (roster[seat] != null && String(roster[seat]) !== String(r.steamID)) { out.push('self-seat'); break; }
    const seen = new Set(); let bad = false;
    for (const k of Object.keys(roster)) {
      const sid = String(roster[k]);
      if (!sidPlausible(sid)) { out.push('sid-range'); bad = true; break; }
      if (seen.has(sid)) { out.push('dup-sid'); bad = true; break; }
      seen.add(sid);
    }
    if (bad) break;
  }
  return out;
}
// pacing gate: true = this settle group must wait (its start attestation is younger than the
// physical minimum). No pending entry (pre-attestation build, or start overwritten before ever
// sighted) -> no constraint; that case is recorded as an `ns` signal instead.
function pacingDefer(pendingEntry, now, minMs) { return !!(pendingEntry && (now - (pendingEntry.t0 || 0)) < minMs); }
// ---- B6 signal collection (record now, judge after real-traffic calibration) ----
// Rolling aggregates the future trust layer needs as history from day one: per-player
// settle/win/void/flag/disp counts + score moments, pairwise co-occurrence (who plays with
// whom, premade/team together, who places above whom), and a per-UTC-day settle counter that
// backs the DAILY_CAP rate gate. De-identified (HMAC pids) like every other state file.
// Nothing here punishes anybody -- flagged/rate-limited matches are simply not settled yet.
const SIGNALS_FILE = process.env.SIGNALS_FILE || 'signals.json';
const SIG_PAIR_WINDOW_MS = Number(process.env.SIG_PAIR_WINDOW_MS || 45 * 86400000);
const SIG_PLAYER_WINDOW_MS = Number(process.env.SIG_PLAYER_WINDOW_MS || 90 * 86400000);
const SIG_PAIRS_CAP = Number(process.env.SIG_PAIRS_CAP || 200000);
function loadSignals() { try { const s = JSON.parse(fs.readFileSync(SIGNALS_FILE, 'utf8')) || {}; s.day = s.day || { d: 0, n: {} }; s.players = s.players || {}; s.pairs = s.pairs || {}; s.flagged = s.flagged || {}; s.rep = s.rep || {}; s.rseen = s.rseen || {}; return s; } catch (e) { return { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} }; } }
function pruneSignals(s, now) {
  for (const k of Object.keys(s.pairs)) if (now - (s.pairs[k].at || 0) > SIG_PAIR_WINDOW_MS) delete s.pairs[k];
  for (const k of Object.keys(s.players)) if (now - (s.players[k].at || 0) > SIG_PLAYER_WINDOW_MS) delete s.players[k];
  for (const k of Object.keys(s.flagged)) if (now - (s.flagged[k] || 0) > SIG_PAIR_WINDOW_MS) delete s.flagged[k];
  for (const k of Object.keys(s.rep || {})) if (now - (s.rep[k].at || 0) > SIG_PAIR_WINDOW_MS) delete s.rep[k];
  for (const k of Object.keys(s.rseen || {})) if (now - (s.rseen[k] || 0) > SIG_PAIR_WINDOW_MS) delete s.rseen[k];
  const pk = Object.keys(s.pairs);
  if (pk.length > SIG_PAIRS_CAP) {   // size fuse: same escalation path as skill.json growth -> external storage
    ghWarn('signals pairs ' + pk.length + ' > cap ' + SIG_PAIRS_CAP + ' -- oldest evicted; plan the move to external state storage');
    pk.sort((a, b) => (s.pairs[a].at || 0) - (s.pairs[b].at || 0));
    for (let i = 0; i < pk.length - SIG_PAIRS_CAP; i++) delete s.pairs[pk[i]];
  }
  // rseen shares the fuse (2026-07-19 audit L5): its keys embed an attacker-chosen matchHash, so
  // unlike pairs (bounded by real co-play) it can be grown deliberately -- evict oldest past cap.
  const rk = Object.keys(s.rseen || {});
  if (rk.length > SIG_PAIRS_CAP) {
    ghWarn('signals rseen ' + rk.length + ' > cap ' + SIG_PAIRS_CAP + ' -- oldest evicted; plan the move to external state storage');
    rk.sort((a, b) => (s.rseen[a] || 0) - (s.rseen[b] || 0));
    for (let i = 0; i < rk.length - SIG_PAIRS_CAP; i++) delete s.rseen[rk[i]];
  }
}
function saveSignals(s, now) { try { pruneSignals(s, now); fs.writeFileSync(SIGNALS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + SIGNALS_FILE + ' failed: ' + (e && e.message)); } }
function sigPlayer(s, h, now) { const p = s.players[h] || (s.players[h] = { g: 0, w: 0, v: 0, f: 0, ns: 0, disp: [0, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: 0 }); p.at = now; return p; }
// flag once per match key (flagged groups are not processed, so they re-surface every run
// until their shard entries are overwritten -- the dedup map keeps counters honest).
function recordFlag(s, g, m, now) {
  if (s.flagged[m]) return false;
  s.flagged[m] = now;
  for (const sid of new Set(g.map(r => String(r.steamID)))) sigPlayer(s, pid(sid), now).f += 1;
  return true;
}
function sigDay(s, now) { const d = Math.floor(now / 86400000); if (s.day.d !== d) s.day = { d, n: {} }; return s.day; }
// ---- player reports (client-written report_box board -> directional edges; record-only) ----
// Reporter identity = the leaderboard entry OWNER (Steam-authenticated write), never a payload
// field -- a reporter cannot forge someone else's complaints. Targets/reasons/match keys ARE
// client claims, so everything lands as signals for the future trust layer; nothing punishes.
// Client packs its rolling queue (<=15) into details: [0xB3, ver<<8|count, (sidLo,sidHi,reason,matchHash)*n].
// Re-uploads of the same queue are idempotent here (rseen dedup by reporter|target|reason|matchHash).
// Per-reporter daily counted cap blunts report-bombing: beyond the cap entries are dedup-marked
// but not counted (mirrors the DAILY_CAP record-only philosophy).
const REPORT_MAGIC = 0xB3;
const REPORT_LB = process.env.REPORT_LB || 'report_box';
// knife-7: host self-incrimination box (guard writes when its renderer silently dropped joiner
//   events). Client-writable, record-only, NEVER settles (signal for review, subject = writer).
const UNMATCHED_LB = process.env.UNMATCHED_LB || 'unmatched_box';
const REPORT_REASON_MIN = 1, REPORT_REASON_MAX = 4;
const REPORT_DAILY_CAP = Number(process.env.REPORT_DAILY_CAP || 20);
// entries = [{steamID, d}] (d = decoded details ints). Returns {seen, counted, capped, bad}.
function harvestReports(entries, s, now) {
  const day = sigDay(s, now);
  day.r = day.r || {};
  const res = { seen: 0, counted: 0, capped: 0, bad: 0, targets: [] };
  for (const e of (entries || [])) {
    const rp = String(e.steamID || '');
    const d = e.d || [];
    if (!rp || d[0] !== REPORT_MAGIC || d.length < 2) { res.bad++; continue; }
    const count = d[1] & 0xFF;
    for (let i = 0; i < count; i++) {
      const off = 2 + i * 4;
      if (d.length < off + 4) break;
      const target = decodeSid(d[off] | 0, d[off + 1] | 0);
      const reason = d[off + 2] | 0;
      const mh = d[off + 3] | 0;
      if (target === '0' || target === rp || reason < REPORT_REASON_MIN || reason > REPORT_REASON_MAX) { res.bad++; continue; }
      const rk = pid(rp), tk = pid(target);
      const seenKey = rk + '|' + tk + '|' + reason + '|' + mh;
      if (s.rseen[seenKey]) continue;          // idempotent re-upload of the rolling queue
      res.targets.push(target);                // real sid -> trust-tier candidate this run
      res.seen++;
      const dayN = (day.r[rk] | 0);
      // dedup keys are minted only for COUNTED reports (2026-07-19 audit L5): minting before the
      // cap let an attacker (free 32-bit matchHash per entry) grow rseen without bound while the
      // cap suppressed the count anyway. A capped report is deferred, not destroyed -- it retries
      // a later run/day until it lands under the cap and mints its key then.
      if (dayN >= REPORT_DAILY_CAP) { res.capped++; continue; }
      s.rseen[seenKey] = now;
      day.r[rk] = dayN + 1;
      const ek = rk + '>' + tk;
      const edge = s.rep[ek] || (s.rep[ek] = { n: 0, m: 0, at: 0 });
      edge.n += 1; edge.m |= (1 << reason); edge.at = now;
      const tp = sigPlayer(s, tk, now); tp.ri = (tp.ri | 0) + 1;   // reports received
      const rpp = sigPlayer(s, rk, now); rpp.ro = (rpp.ro | 0) + 1; // reports filed
      res.counted++;
    }
  }
  return res;
}
function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
// ---- trust tier (judgment OUTPUT of recorded signals; still no punishment) ----
// A bare 0-3 tier per player on an open-read Trusted board (trust_tier). The client
// matchmaker consumes it as a SORT-ONLY soft-avoid key (never a filter -- single-pool
// invariant holds). Inputs are deliberately restricted to the high-confidence signals:
//   f   = forgery-flag involvement (inconsistent/sanity-flagged groups; note an
//         inconsistent group flags every writer incl. the honest side, hence the
//         high floors -- repeat involvement is the signal, not one incident)
//   vur = same-match-VERIFIED unique reporters (a rep edge only counts when the
//         reporter/target pair actually co-occurred in a match window (signals.pairs)
//         -- report-bombing from strangers who never played you counts zero)
// Thresholds are conservative pre-traffic placeholders (expected: ~everyone tier 0 at
// launch); recalibrate with real distributions at the B5/B6 judgment pass. The 45/90d
// signal windows make tiers decay on their own (self-healing appeal).
// Board upkeep: entries exist only for tier>=1 (delete on decay to 0) -> the readable
// surface stays a handful of coarse tiers, no counts, no reasons.
const TRUST_LB = process.env.TRUST_LB || 'trust_tier';
const TRUST_T = { F1: 3, F2: 8, VUR1: 4, VUR2: 10 };
function verifiedUniqueReporters(s, tp) {
  let n = 0;
  for (const k of Object.keys(s.rep || {})) {
    const i = k.indexOf('>');
    if (i < 0 || k.slice(i + 1) !== tp) continue;
    if ((s.pairs || {})[pairKey(k.slice(0, i), tp)]) n++;
  }
  return n;
}
function trustTierOf(f, vur) {
  f |= 0; vur |= 0;
  let t = 0;
  t += f >= TRUST_T.F2 ? 2 : (f >= TRUST_T.F1 ? 1 : 0);
  t += vur >= TRUST_T.VUR2 ? 2 : (vur >= TRUST_T.VUR1 ? 1 : 0);
  return Math.min(3, t);
}
// existing = {sid: tier on board}; touched = iterable of real sids seen this run with
// trust-relevant signals. Union both so decayed players get re-evaluated (and deleted
// at 0) without any identity leaving the board itself.
function trustPlan(s, existing, touched, now) {
  const writes = [], deletes = [];
  const all = new Set([...Object.keys(existing || {}), ...touched]);
  for (const sid of all) {
    const p = pid(sid);
    const tier = trustTierOf(((s.players || {})[p] || {}).f | 0, verifiedUniqueReporters(s, p));
    const cur = (existing || {})[sid];
    if (tier > 0 && tier !== (cur | 0)) writes.push({ sid, tier });
    else if (tier === 0 && cur != null) deletes.push(sid);
  }
  return { writes, deletes };
}
// parts = present record-writers (seat+score+steamID); rankOf may be null for VOID groups.
function recordMatchSignals(s, g, parts, rankOf, matchType, isVoid, now) {
  const mask = premadeMaskOf(matchType), team = isTeamMt(matchType);
  const trioAt = premadeTrioAtOf(matchType), tsz = teamSizeOfMt(matchType);
  const inTrio = (seat) => trioAt > 0 && (seat | 0) >= trioAt - 1 && (seat | 0) <= trioAt + 1;
  const dispOf = {}; for (const r of g) dispOf[String(r.steamID)] = r.dispCode | 0;
  for (const p of parts) {
    const h = sigPlayer(s, pid(p.steamID), now);
    const dc = Math.min(6, Math.max(0, dispOf[String(p.steamID)] | 0));
    h.disp[dc] += 1;
    if (isVoid) { h.v += 1; continue; }
    h.g += 1;
    if (rankOf && rankOf[p.steamID] === 1) h.w += 1;
    const sc = p.score | 0;
    h.s1 += sc; h.s2 += sc * sc; if (sc > h.smax) h.smax = sc;
  }
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const A = parts[i], B = parts[j];
    const ka = pid(A.steamID), kb = pid(B.steamID), k = pairKey(ka, kb);
    const e = s.pairs[k] || (s.pairs[k] = { n: 0, t: 0, x: 0, at: 0 });
    e.n += 1; e.at = now;
    const together = team ? (teamOfSeat(A.seat, tsz) === teamOfSeat(B.seat, tsz))
      : ((((mask >> (A.seat >> 1)) & 1) === 1 && (A.seat >> 1) === (B.seat >> 1)) ||
         (inTrio(A.seat) && inTrio(B.seat)));   // O82: trio members co-queue like a pair
    if (together) e.t += 1;
    if (!isVoid && rankOf) {   // x counts "lexicographically-first pid placed strictly above the other"
      const first = ka < kb ? A : B, second = ka < kb ? B : A;
      if (rankOf[first.steamID] < rankOf[second.steamID]) e.x += 1;
    }
  }
}
// Reads retry transient faults (network errors / 5xx) twice with backoff before giving
// up: the storefront occasionally throws a one-off 5xx (observed 2026-07-28: a single
// GetLeaderboardsForGame HTTP 502 failed the whole run) and reads are idempotent, so a
// blip should cost seconds, not a full cycle plus a failure e-mail. 4xx are semantic
// (bad key / missing board) and still surface immediately. Writes (postForm*) keep
// single-shot behavior — a mid-write failure self-heals next run via unprocessed state.
async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    let r, t;
    try {
      r = await fetch(url); t = await r.text();
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise(res => setTimeout(res, 8000 * (attempt + 1))); continue;
    }
    if (r.status >= 500 && attempt < 2) {
      await new Promise(res => setTimeout(res, 8000 * (attempt + 1))); continue;
    }
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    return { status: r.status, ok: r.ok, json: j, text: t };
  }
}
const ghWarn = m => console.log('::warning::' + m);
const ghErr = m => console.log('::error::' + m);
// Board-resolution gate: past the provisioning phase, a provisioned board vanishing from the
// listing (deleted / renamed / post-rebuild generation wobble) must FAIL the run instead of
// silently disabling an authority path -- the soft skip loses that match's points/xp forever
// (the match is still marked processed) or hides a dead collection surface indefinitely. With
// STRICT_BOARDS=1 (set in CI) the run errors out; un-processed matches simply settle on a later
// run once the board is back. Default off keeps the soft skip for local runs and for shipping
// code ahead of a board's creation.
const STRICT_BOARDS = process.env.STRICT_BOARDS === '1';
const strictBoard = m => { if (STRICT_BOARDS) { ghErr(m + ' -- STRICT_BOARDS=1 fails instead of degrading'); process.exit(1); } };
// Per-run counters surfaced as a step summary (numbers only, no identities) -- the at-a-glance
// dashboard for a repo with issues disabled, and the scale-trigger telemetry (duration /
// fresh backlog / page-cap hits) that says when to raise CONCURRENCY or split shard reads.
const RUN = { cap: 0 };
function writeRunSummary() {
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (!p) return;
  try {
    const s = (k, d) => (RUN[k] === undefined ? d : RUN[k]);
    fs.appendFileSync(p, [
      '### reconcile' + (PT_MODE ? ' (playtest)' : ''),
      '| metric | value |',
      '|---|---|',
      '| records / start attestations | ' + s('rec', 0) + ' / ' + s('starts', 0) + ' |',
      '| consistent / fresh | ' + s('consistent', 0) + ' / ' + s('fresh', 0) + ' |',
      '| flagged inconsistent / sanity | ' + s('flagged', 0) + ' / ' + s('sanity', 0) + ' |',
      '| starts pending / exit-rate hits | ' + s('pending', 0) + ' / ' + s('convicted', 0) + ' |',
      '| confessions seen/penalized/refunded | ' + s('confess', '0/0/0') + ' |',
      '| reports seen / counted | ' + s('repSeen', 0) + ' / ' + s('repCounted', 0) + ' |',
      '| trust writes / deletes | ' + s('trustW', 0) + ' / ' + s('trustD', 0) + ' |',
      '| board writes rating/points/xp | ' + s('writes', '0/0 0/0 0/0') + ' |',
      '| endless settles / cp+board writes | ' + s('endless', 0) + ' / ' + s('writesEndless', '0/0 0/0') + ' |',
      '| seedcap veto / reject-window discards | ' + s('seedcapVeto', 0) + ' / ' + s('seedcapReject', 0) + ' |',
      '| page-cap hits | ' + RUN.cap + ' |',
      '| duration | ' + ((Date.now() - (RUN.t0 || Date.now())) / 1000).toFixed(1) + 's |',
      '',
    ].join('\n'));
  } catch (e) {}
}
async function postForm(path, params) {
  const body = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
// detail data is stored as RAW bytes by the API -- a hex string or encodeURIComponent would mangle bytes > 127 (UTF-8),
//   so the int32-LE detail array is appended pre-percent-encoded one byte at a time.
function pctBytes(arr) { const b = Buffer.alloc(arr.length * 4); arr.forEach((n, i) => b.writeInt32LE(n | 0, i * 4)); return Array.from(b).map(x => '%' + x.toString(16).padStart(2, '0')).join(''); }
async function postFormDetails(path, params, detailsArr) {
  let body = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  if (detailsArr && detailsArr.length) body += '&details=' + pctBytes(detailsArr);
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: 'fulfilled', value: await fn(items[i], i) }; }
      catch (e) { out[i] = { status: 'rejected', reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
// ---- board reads (scale-safe) ----
// GetLeaderboardEntries silently caps a single request at 5000 rows; an un-paged read past that
// size drops records / base values WITHOUT any error. All full-board reads go through the cursor
// pagination below; PAGE_CAP bounds a pathological board (raise via env before raising shards).
const PAGE_SIZE = 5000;
const PAGE_CAP = Math.max(1, Number(process.env.PAGE_CAP || 10));   // 10 pages = 50k entries per board
async function readBoardAll(id, label) {
  const ents = [];
  for (let page = 0; page < PAGE_CAP; page++) {
    const start = page * PAGE_SIZE + 1, end = (page + 1) * PAGE_SIZE;
    const er = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardEntries/v1/?key=' + KEY + '&appid=' + APPID + '&rangestart=' + start + '&rangeend=' + end + '&datarequest=RequestGlobal&leaderboardid=' + id + '&format=json');
    if (!er.ok) throw new Error(label + ' HTTP ' + er.status);
    const page0 = (er.json && er.json.leaderboardEntryInformation && er.json.leaderboardEntryInformation.leaderboardEntries) || [];
    for (const e of page0) ents.push(e);
    if (page0.length < PAGE_SIZE) return { ents, complete: true };   // short page = board exhausted
  }
  RUN.cap++;
  ghWarn(label + ' hit PAGE_CAP=' + PAGE_CAP + ' (' + ents.length + ' entries read, board larger) -- raise PAGE_CAP');
  return { ents, complete: false };
}
// Single-player entry read (score + details) -- on-demand base-value fetch for a player who falls
// outside the bulk-read window of a larger-than-cap board. null = the player has no entry at all.
// Without this, settling such a player would use a base of 0 = a silent LP/XP reset.
async function readUserEntry(id, sid, label) {
  const er = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardEntries/v1/?key=' + KEY + '&appid=' + APPID + '&rangestart=0&rangeend=0&datarequest=RequestAroundUser&steamid=' + sid + '&leaderboardid=' + id + '&format=json');
  if (!er.ok) throw new Error(label + ' user read HTTP ' + er.status);
  const ents = (er.json && er.json.leaderboardEntryInformation && er.json.leaderboardEntryInformation.leaderboardEntries) || [];
  for (const e of ents) if (String(e.steamID) === String(sid)) return e;
  return null;
}
function loadProcessed() { try { return new Set(JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'))); } catch (e) { return new Set(); } }
function saveProcessed(set) { try { fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...set], null, 0)); } catch (e) { ghWarn('write ' + PROCESSED_FILE + ' failed: ' + (e && e.message)); } }
const SKILL_FILE = process.env.SKILL_FILE || 'skill.json';
function loadSkill() { try { return JSON.parse(fs.readFileSync(SKILL_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveSkill(s) { try { fs.writeFileSync(SKILL_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + SKILL_FILE + ' failed: ' + (e && e.message)); } }
const LEAVERS_FILE = process.env.LEAVERS_FILE || 'leavers.json';
function loadLeavers() { try { return JSON.parse(fs.readFileSync(LEAVERS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveLeavers(s) { try { fs.writeFileSync(LEAVERS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + LEAVERS_FILE + ' failed: ' + (e && e.message)); } }
// ---- O124 seedcap consult (knife-9) -- seedcap.js OWNS its state file; the reconcile only
// READS it (cross-workflow ownership stays clean: each side writes its own file, the applied-
// correction handshake goes through signals.json which the reconcile owns). Enforcement is
// observe-first: SEEDCAP_ENFORCE gates the over-cap veto + board corrections, SEEDCAP_REJECT
// gates the per-suspect refusal lever; both default OFF (the auditor still records everything).
const SC_STATE_FILE = process.env.SC_STATE_FILE || 'seedcap.json';
const SEEDCAP_ENFORCE = process.env.SEEDCAP_ENFORCE === '1';
const SEEDCAP_REJECT = process.env.SEEDCAP_REJECT === '1';
// The refusal lever is a WINDOW, not a permanent lock (2026-09-05). suspects[pid].n (cumulative
// over-cap convictions, seedcap.js) picks the window that starts at the LATEST conviction (t1,
// minutes since epoch): 1 -> 24h, 2 -> 3 days, 3 -> 7 days, 4+ -> 14 days, hard cap (never
// permanent: a false positive costs at most two weeks, and the veto already blocks every
// over-cap match on its own). Inside the window the flagged account's OWN settlement is
// discarded -- rating / points / XP / CP / endless bests / career stay exactly as before the
// match, as if that seat had never sat there -- while every other seat settles normally.
// Past the window the account settles again with no ops action; the suspect entry and the
// offense board keep the history (ops can still clear early through the review tool).
const SEEDCAP_REJECT_LADDER_MIN = [24 * 60, 3 * 24 * 60, 7 * 24 * 60, 14 * 24 * 60];
function seedcapRejectWindowMin(n) {
  const k = Math.max(1, n | 0);
  return SEEDCAP_REJECT_LADDER_MIN[Math.min(k, SEEDCAP_REJECT_LADDER_MIN.length) - 1];
}
// window end (minutes since epoch) of a suspect entry; null = no entry. t1 = latest conviction
// (t0 fallback for entries written before t1 existed).
function seedcapRejectUntilMin(su) {
  if (!su) return null;
  const t = (su.t1 != null ? su.t1 : su.t0) | 0;
  return t + seedcapRejectWindowMin(su.n);
}
function seedcapRejectActive(su, nowMin) {
  const u = seedcapRejectUntilMin(su);
  return u != null && (nowMin | 0) < u;
}
function loadSeedcap() { try { return JSON.parse(fs.readFileSync(SC_STATE_FILE, 'utf8')) || null; } catch (e) { return null; } }
// pending abandon confessions (see reconcileConfessions): "pid|matchKey" -> {t0, mt, ded, ex, refunded, done}
const CONFESSIONS_FILE = process.env.CONFESSIONS_FILE || 'confessions.json';
const CONFESS_PRUNE_MS = Number(process.env.CONFESS_PRUNE_MS || 48 * 3600 * 1000);
function loadConfessions() { try { return JSON.parse(fs.readFileSync(CONFESSIONS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveConfessions(s, now) {
  for (const k of Object.keys(s)) if (now - (s[k].t0 || 0) > CONFESS_PRUNE_MS) delete s[k];
  try { fs.writeFileSync(CONFESSIONS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + CONFESSIONS_FILE + ' failed: ' + (e && e.message)); }
}
// knife-7 unmatched-confession sticky state (dedupe across runs; the box is a rolling ring so
//   the same event reappears until it ages out -- only a GROWN total is new information).
const UNMATCHED_FILE = process.env.UNMATCHED_FILE || 'unmatched.json';
function loadUnmatched() { try { return JSON.parse(fs.readFileSync(UNMATCHED_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveUnmatched(s) { try { fs.writeFileSync(UNMATCHED_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + UNMATCHED_FILE + ' failed: ' + (e && e.message)); } }
// Process abandon confessions (record-writer identity = penalty target; nothing here can touch a
// third party). Runs BEFORE the no-consistent-matches early returns -- the everyone-left scenario
// this exists for produces no settle groups at all. Dependencies are injected so tests need no fetch.
//   confs: [{steamID, m, mt, dispCode}] from this run's shard read (deduped by state key).
//   groups: this run's settle-record groups (forgiveness probe: confessor wrote a settle record).
//   opts: { penalty, lpMax, maturityMs, appliesLpFn, seedFor(sid) -> base LP for a first-ranked leaver,
//           readLp: async(sid) -> {score, details}|null, writeLp: async(sid, score, details) -> ok }
// Effects per NEW confession on an unprocessed match: exit-rate leaves++ (all matchmade types) and,
// for ranked, an immediate clamp-aware LP deduction (amount recorded for the refund). A later run
// that sees the confessor's own settle record for the same match refunds the deduction and retracts
// the exit signal (first-reconnect forgiveness, client mirror). detectLeavers / start-orphan
// convictions skip confessed (pid|match) keys so nothing double-counts.
async function reconcileConfessions(confs, groups, processed, confState, leavers, now, opts) {
  const res = { seen: 0, penalized: 0, exitHits: 0, refunded: 0, finalized: 0 };
  // absolution probe (2026-07-19 audit H3): "came back and finished" must mean a record inside a
  // CONSISTENT settle group (>=2 distinct writers, identical consistency vectors) whose own disp
  // is non-abandoner. The old any-record probe accepted a lone or divergent 0xB1 -- which any
  // client can upload for its own roster seat with a garbage score vector -- letting a ranked
  // leaver cancel his authoritative -100 (and retract the exit signal) unilaterally. A forged
  // divergent record now just flags the group (existing K1 path) and the penalty stands; the
  // legit reconnect-and-finish case is exactly a consistent group containing the confessor.
  // opts.consistentKeys = this run's consistent-group match keys (caller computes them anyway).
  const ck = opts.consistentKeys || new Set();
  const settleRec = (m, p) => {
    if (!ck.has(m) || !groups[m]) return null;
    const rec = groups[m].find(r => pid(String(r.steamID)) === p);
    return (rec && dispClassOf(rec.dispCode) !== 'abandoner') ? rec : null;
  };
  const settledBy = (m, p) => !!settleRec(m, p);
  const byKey = {};
  for (const c of (confs || [])) { const p = pid(String(c.steamID)); byKey[p + '|' + c.m] = Object.assign({ p }, c); }
  // 1) NEW confessions (visible on shards this run)
  for (const key of Object.keys(byKey)) {
    const c = byKey[key];
    res.seen++;
    if (confState[key]) continue;                                        // upkeep handled below (state is sticky; shard entries get overwritten)
    if (dispClassOf(c.dispCode) !== 'abandoner') continue;               // only self-harm disp codes count
    if (processed.has(c.m)) { confState[key] = { t0: now, mt: c.mt | 0, done: 1 }; continue; }   // consensus path already owned this match
    if (settledBy(c.m, c.p)) { confState[key] = { t0: now, mt: c.mt | 0, done: 1 }; continue; }  // already came back and finished before first sighting
    const st = confState[key] = { t0: now, mt: c.mt | 0, ded: 0, ex: 1 };
    leavers[c.p] = leavers[c.p] || { leaves: 0, lastMatch: '' };
    leavers[c.p].leaves += 1; leavers[c.p].lastMatch = c.m;
    res.exitHits++;
    if (opts.appliesLpFn(c.mt | 0) && opts.readLp) {
      const e = await opts.readLp(String(c.steamID));
      const base = e ? (e.score | 0) : (opts.seedFor ? opts.seedFor(String(c.steamID)) : 0);
      const nv = leaverLpPenalty(base, opts.penalty);
      st.ded = base - nv;
      const okW = await opts.writeLp(String(c.steamID), nv, e && e.details);
      if (okW) res.penalized++; else { st.ded = 0; ghWarn('confession LP write failed ' + plog(String(c.steamID))); }
      console.log('  confess ' + c.m + ': ' + plog(String(c.steamID)) + ' ' + dispName(c.dispCode) + ' pts ' + base + '-' + opts.penalty + '->' + nv + (e ? '' : ' (seeded base)'));
    } else {
      console.log('  confess ' + c.m + ': ' + plog(String(c.steamID)) + ' ' + dispName(c.dispCode) + ' exit-rate only (non-ranked)');
    }
  }
  // 2) upkeep for ALL pending state (incl. confessions whose shard entry was since overwritten):
  //    forgiveness needs the real sid, and it comes from the very thing that triggers it -- the
  //    confessor's own settle record in this run's groups.
  for (const key of Object.keys(confState)) {
    const st = confState[key];
    if (st.done || st.refunded) continue;
    const i = key.indexOf('|');
    const p = key.slice(0, i), m = key.slice(i + 1);
    const rec = settleRec(m, p);   // hardened probe (consistent group + non-abandoner disp); lone/divergent records refund nothing
    if (rec) {
      // came back and finished: refund the exact deducted amount + retract the exit signal
      if (st.ded > 0 && opts.readLp) {
        const sid = String(rec.steamID);
        const e = await opts.readLp(sid);
        const nv = Math.min(opts.lpMax, ((e ? e.score : 0) | 0) + (st.ded | 0));
        const okW = await opts.writeLp(sid, nv, e && e.details);
        if (okW) res.refunded++;
        console.log('  confess-forgive ' + m + ': ' + plog(sid) + ' settled after all, refund +' + st.ded + ' -> ' + nv);
      } else {
        console.log('  confess-forgive ' + m + ': ' + plog(p) + ' settled after all (exit signal retracted)');
      }
      if (st.ex && leavers[p]) { leavers[p].leaves = Math.max(0, (leavers[p].leaves | 0) - 1); st.ex = 0; }
      st.refunded = 1;
      continue;
    }
    if (now - (st.t0 || 0) > opts.maturityMs) { st.done = 1; res.finalized++; }   // forgiveness window closed; penalty stands
  }
  return res;
}
// pending start-attestation groups awaiting settlement or maturity (see reconcileStarts)
const STARTS_FILE = process.env.STARTS_FILE || 'starts.json';
const STARTS_MATURITY_MS = Number(process.env.STARTS_MATURITY_MS || 2 * 3600 * 1000);   // max match length + reconnect windows, with slack
// flat XP credit for the innocent survivor of an interrupted match (the sole player left after
// everyone else quit, who stayed to the forced settle and wrote a lone record). Lone records can
// never settle (consensus needs 2+ writers), so the normal XP pipeline can never pay them -- this
// is the only authoritative credit such a match produces. Flat and small on purpose: score/progress
// claims in a lone record are unverifiable, and forging the credit (a second account to co-attest
// the start, a burned exit-rate on it, a 2h maturity wait) earns far less than honest play.
// Competitive values (LP/MMR) never move here. Client mirrors the same constant (lockstep-pinned).
const CONSOLATION_XP = Number(process.env.CONSOLATION_XP || 50);
function loadStarts() { try { return JSON.parse(fs.readFileSync(STARTS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveStarts(s) { try { fs.writeFileSync(STARTS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + STARTS_FILE + ' failed: ' + (e && e.message)); } }
// ============================================================
// repeat-group rating decay (retention R1): consecutive matches against MOSTLY THE SAME people
// update TrueSkill with a decaying weight x1 / x0.5 / x0.25 / x0 (1st/2nd/3rd/4th+ in a row).
// Why: rematch rooms keep a table together on purpose -- great for retention, but a closed loop
// could farm rating in either direction (win-trade up, or throw down to smurf). The decay seals
// both directions symmetrically while leaving XP/CP/points untouched (real play is not zero-sum).
// Group identity is derived from the cron's own processing history (roster consensus incl.
// leavers), so the client declares nothing and cannot fake "fresh opponents" -- appearing with
// the same people IS the signal. A group counts as "the same" when at least REPEAT_FRAC of a
// player's opponents repeat from their previous match; more than half replaced resets the streak
// (the user's blood-change rule). TTL keeps this a session-scoped memory, not a social graph.
// State updates only on real settles (VOID/endless don't advance or reset a streak).
const GROUP_DECAY = { WEIGHTS: [1, 0.5, 0.25, 0], REPEAT_FRAC: 0.5, TTL_MS: 2 * 3600 * 1000, PRUNE_MS: 48 * 3600 * 1000 };
const GROUPS_FILE = process.env.GROUPS_FILE || 'groups.json';
function loadGroups() { try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveGroups(g, nowMs) {
  for (const p of Object.keys(g)) if (nowMs - (g[p].at || 0) > GROUP_DECAY.PRUNE_MS) delete g[p];
  try { fs.writeFileSync(GROUPS_FILE, JSON.stringify(g, null, 0)); } catch (e) { ghWarn('write ' + GROUPS_FILE + ' failed: ' + (e && e.message)); }
}
// Pure: advance every roster member's streak memory and return their update weight.
// rosterPids = de-identified pids of everyone seated in the match (writers + consensus leavers --
// leavers advance their memory too, so leaving is not a streak-laundering trick). Mutates `groups`.
function groupDecayPlan(groups, rosterPids, nowMs) {
  const out = {};
  const uniq = [...new Set(rosterPids)];
  const prevSnap = {};   // read prev BEFORE writing: two members of one match must not see this match's own write
  for (const p of uniq) prevSnap[p] = groups[p];
  for (const p of uniq) {
    const others = uniq.filter(x => x !== p).sort();
    const prev = prevSnap[p];
    let k = 1;
    if (prev && (nowMs - (prev.at || 0)) <= GROUP_DECAY.TTL_MS && Array.isArray(prev.r) && others.length) {
      const set = new Set(prev.r);
      const overlap = others.filter(x => set.has(x)).length;
      if (overlap / others.length >= GROUP_DECAY.REPEAT_FRAC) k = ((prev.k | 0) || 1) + 1;
    }
    groups[p] = { r: others, k, at: nowMs };
    out[p] = { k, w: GROUP_DECAY.WEIGHTS[Math.min(k - 1, GROUP_DECAY.WEIGHTS.length - 1)] };
  }
  return out;
}
const LP_LB = process.env.LP_LB;
const LP_MAX = 9999;
const LEAVER_LP_PENALTY = Number(process.env.LEAVER_LP_PENALTY || 100);   // ranked leaver authoritative LP deduction (pairs the client optimistic -100)
// `rs` = mismatch retention coefficient (fraction of the win/loss component applied to EXPECTED outcomes in a
//   mismatched match) per tier: lower tiers move closer to normal, higher tiers compress hard (protect the top ladder).
// 7 tiers (2026-07-14): silver/platinum inserted as transition tiers -- narrow bottom (fast first
//   promotion), wide top. The four legacy tier lines (2000/4000/6000/8000) are unchanged, so every
//   promotion-series invariant below still holds: band width 2*120=240 < narrowest span 600, and
//   the largest natural swing (45+5=50) < BOUNDARY_MARGIN. Mirrored by the client ranked-config
//   LP_SEG + rating-store TIERS (lockstep-pinned by the client test suite).
const LP_SEG = [
  { min: 0, win: 45, loss: 15, drip: 5, rs: 0.70 },     // bronze (600 wide)
  { min: 600, win: 40, loss: 17, drip: 4, rs: 0.60 },   // silver
  { min: 2000, win: 35, loss: 20, drip: 3, rs: 0.50 },  // gold
  { min: 3000, win: 31, loss: 22, drip: 2, rs: 0.40 },  // platinum
  { min: 4000, win: 28, loss: 25, drip: 2, rs: 0.30 },  // diamond
  { min: 6000, win: 22, loss: 22, drip: 1, rs: 0.15 },  // master
  { min: 8000, win: 20, loss: 20, drip: 0, rs: 0.05 },  // grandmaster (zero-sum top)
];
function lpSeg(lp) { let s = LP_SEG[0]; for (const x of LP_SEG) if (lp >= x.min) s = x; return s; }
// placement seeding (2026-07-14): a player's FIRST ranked settle starts from a TrueSkill-derived
//   seed instead of 0. Ranked unlock requires ~15 quick matches, so the pre-match display rating is
//   already a real skill signal. seed = clamp((display - BASE) * SLOPE, 0, CAP); CAP lands mid-
//   platinum -- diamond+ must be climbed, and 3200 sits outside both boundary bands (3000+120 /
//   4000-120). New/weak players (display <= 1000) seed 0 = the old everyone-starts-bronze behavior.
//   The client mirrors this formula optimistically on its first ranked game (read-back corrects).
const LP_SEED = { BASE: 1000, SLOPE: 4, CAP: 3200 };
function seedLp(display) { return Math.max(0, Math.min(LP_SEED.CAP, Math.round(((display | 0) - LP_SEED.BASE) * LP_SEED.SLOPE))); }
// ===== seasonal points ladder (2026-08-01). =====
// The season clock is a lookup TABLE, not a formula -- changing seasons means appending a row
// here (and shipping the mirrored client table; the pair is lockstep-pinned by the companion
// repo's schema test). id 0 = preseason (dev period + post-launch warmup): points settle into
// the BASE board. From season 1 on each season settles into its own auto-created board
// `<base>_s<id>`; the previous season's board becomes a free archive. Only visible points and
// the seasonal endless board reset between seasons -- rating (mu/sigma), xp, career counters,
// exit-rate state and the wallet all carry over. The lifetime endless board never resets.
const SEASONS = [
  { id: 1, start: Date.UTC(2026, 11, 1) },   // season 1 opens (preseason before this)
  { id: 2, start: Date.UTC(2027, 2, 1) },    // quarterly boundaries from here on
];
// SEASON_NOW: ISO override of "now" for the season clock (synthetic e2e only; production unset).
const SEASON_NOW_MS = process.env.SEASON_NOW ? Date.parse(process.env.SEASON_NOW) : null;
function seasonNowMs() { return (SEASON_NOW_MS != null && isFinite(SEASON_NOW_MS)) ? SEASON_NOW_MS : Date.now(); }
function seasonAt(nowMs) { let id = 0; for (const s of SEASONS) if (nowMs >= s.start) id = s.id; return id; }
function seasonBoardName(base, id) { return (id | 0) >= 1 ? base + '_s' + (id | 0) : String(base); }
// Soft-reset landing per tier index (design-locked): null = keep in place (bottom tiers),
// else land at the target (min() guards against a mis-edited table ever RAISING points).
const SOFT_RESET = [null, null, 1200, 2000, 3000, 4000, 5000];
function softResetLp(lp) {
  let i = 0; for (let k = 0; k < LP_SEG.length; k++) if ((lp | 0) >= LP_SEG[k].min) i = k;
  const t = SOFT_RESET[i];
  return t == null ? (lp | 0) : Math.min(lp | 0, t | 0);
}
// Lazy season seeding priority: an entry on the IMMEDIATELY previous season's board wins
// (soft reset of last season's finish); absent there = sat the season out (or brand new) ->
// fall back to the display-derived placement seed. Applied at a player's first settle of the
// new season -- no boundary-time bulk migration ever runs.
function seasonSeedLp(prevScore, display) {
  return prevScore != null ? softResetLp(prevScore | 0) : seedLp(display);
}
// Find-or-create a trusted-writes board by name. Idempotent (same name always returns the same
// id) and immune to the listing-generation lag that can hide a fresh board from
// GetLeaderboardsForGame for over an hour -- the canonical bypass for any by-name resolution
// that must not wait out that lag. Returns the id or null (failure -> warn).
async function findOrCreateBoard(name, trusted) {
  const res = await postForm('/ISteamLeaderboards/FindOrCreateLeaderboard/v2/', {
    key: KEY, appid: APPID, name, sortmethod: 'Descending', displaytype: 'Numeric',
    createifnotfound: 1, onlytrustedwrites: (trusted == null || trusted) ? 1 : 0, onlyfriendsreads: 0, format: 'json',
  });
  const lb = (res.json && res.json.result && res.json.result.leaderboard) || (res.json && res.json.leaderboard) || null;
  const id = lb && (lb.leaderBoardID || lb.leaderboardID || lb.id || lb.ID);
  if (res.ok && id) return id;
  ghWarn('board find-or-create failed: ' + name + ' HTTP ' + res.status + ' ' + String(res.text).slice(0, 120));
  return null;
}
// Resolve the season board for `base` from the run's board listing. From season 1 on a missing
// board is auto-created (trusted writes, global reads -- the exact shape the ops tool provisions).
async function resolveSeasonBoard(lr, base, id) {
  const name = seasonBoardName(base, id);
  const found = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === name);
  if (found) return { name, id: found.id || found.ID };
  if ((id | 0) >= 1) {
    const newId = await findOrCreateBoard(name);
    if (newId) { console.log('season board created: ' + name + ' id=' + newId); return { name, id: newId }; }
  }
  return { name, id: null };
}
function lpDelta(lp, rank, pc) {
  const seg = lpSeg(lp);
  const p = pc <= 1 ? 0.5 : (pc - 1 - (rank - 1)) / (pc - 1);
  const base = p >= 0.5 ? seg.win * (2 * p - 1) : -seg.loss * (1 - 2 * p);
  return Math.round(base + seg.drip);
}
// ===== hard promotion/relegation series (user design 2026-07-10). =====
// A player whose pre-match LP sits within BOUNDARY_MARGIN of a tier line is "in series" -- the
// client shows the promotion/relegation-match UI + intro music for exactly that state (lockstep
// mirror of RatingStore.boundaryState). The series rule makes the outcome decisive:
//   promotion match + top-half finish (teams: team won)  -> always crosses UP   (lands min+PROMO_LAND)
//   relegation match + bottom-half finish (teams: lost)  -> always crosses DOWN (lands min-RELEG_LAND)
// Implemented as a clamp on the final per-player delta so it composes with reduced-stakes factors,
// team halving and the premade average-rank rule; a natural delta already past the line is kept.
// The margin (120) exceeds the largest natural swing (~50), so line crossings can ONLY happen in a
// series match -- this clamp adds the reverse guarantee (series win/loss is always decisive).
// PROTECTED ends (flag 2: mismatch weak side / abandoned-teammate shield, design line 7) keep their
// compressed natural loss instead of the forced drop. The leaver -100 penalty path stays independent.
const BOUNDARY_MARGIN = 120, PROMO_LAND = 10, RELEG_LAND = 15;
function boundaryOf(lp) {
  let i = 0; for (let k = 0; k < LP_SEG.length; k++) if (lp >= LP_SEG[k].min) i = k;
  if (i > 0 && lp - LP_SEG[i].min <= BOUNDARY_MARGIN) return 'relegation';
  if (i < LP_SEG.length - 1 && LP_SEG[i + 1].min - lp <= BOUNDARY_MARGIN) return 'promotion';
  return null;
}
function crosslineDelta(lp, delta, won) {
  const b = boundaryOf(lp);
  let i = 0; for (let k = 0; k < LP_SEG.length; k++) if (lp >= LP_SEG[k].min) i = k;
  if (b === 'promotion' && won) return Math.max(delta, LP_SEG[i + 1].min + PROMO_LAND - lp);
  if (b === 'relegation' && !won) return Math.min(delta, LP_SEG[i].min - RELEG_LAND - lp);
  return delta;
}
// matchType layout: base mode code in the low nibble, FFA "premade seat-pair" bitmask in bits 4..7
// (bit k set = seats (2k, 2k+1) queued together as a party). The host derives the mask from the
// mutually-acknowledged party groups at seat time and broadcasts it with the match start payload,
// so every honest end composes the same code -- and since the match group key contains d[2], a
// lone end forging its mask just orphans its own record (and gets convicted absent by the rest).
// Team codes (3/4/5/6/8/9) never carry a mask: the fixed seat convention already encodes grouping.
// FFA codes carry it so the settle pass can apply the premade average-rank LP rule (design line 66)
// with no record-layout change.
// O82 (6P matchmaking): bits 8..10 = FFA premade-TRIO start seat + 1 (0 = none; v>0 = a mutually
// acknowledged 3-man party occupies contiguous seats v-1..v+1). Same trust model as the pair mask
// (host-derived, broadcast, keyed into the match group). Bases 8/9 = quick/ranked mode-2 with
// teamSize 3 (3V3, seats 0-2 vs 3-5) -- the same mirrored-rounds engine as 5/6, wider seating.
function baseMt(mt) { return (mt | 0) & 0xF; }
function premadeMaskOf(mt) { return ((mt | 0) >> 4) & 0xF; }
function premadeTrioAtOf(mt) { return ((mt | 0) >> 8) & 0x7; }
// team layout parameters: bases 8/9 seat two teams of 3 (0-2 vs 3-5); every other team base is 2v2.
function teamSizeOfMt(mt) { const b = baseMt(mt); return (b === 8 || b === 9) ? 3 : 2; }
function teamOfSeat(seat, ts) { return (((seat | 0) / (ts || 2)) | 0) & 1; }
// visible points move for ranked matches only; quick classes update the hidden rating.
// base 6 (ranked mode 2) flips on HERE, in the same change that routes mode-2 groups through the
// halved team-LP path with a sub-score-derived outcome (teamLpPlan winTeamOverride below) -- the
// same red line as base 4: a team code must never reach the individual full-stakes LP path.
// base 4 (ranked team-brawl) flipped HERE earlier, in the same change that shipped the halved team-LP path
// (teamLpPlan below) -- the plan's red line: a type-4 record must never reach the individual
// full-stakes LP path. Base 9 (ranked 3V3) joins in the same change that generalizes every
// team-code consumer to teamSizeOfMt -- same red line, wider seats.
function appliesLp(mt) { const b = baseMt(mt); return b === 2 || b === 4 || b === 6 || b === 9; }
// team match types: 3/4 = quick/ranked team-brawl (mode 1); 5/6 = quick/ranked mode 2 (true 2v2);
// 8/9 = quick/ranked mode 2 at teamSize 3 (O82 6P matchmaking).
function isTeamMt(mt) { const b = baseMt(mt); return b === 3 || b === 4 || b === 5 || b === 6 || b === 8 || b === 9; }
// mode-2 subset: the outcome is a SUB-SCORE race (round points incl. a gamble round), not money --
// a team can win the match holding less gold, so money must never cross-check rank for these codes
// (teamRankOf's money-sum overwrite stays 3/4-only; 5/6/8/9 derive the winner from rank claims below).
function isSubScoreMt(mt) { const b = baseMt(mt); return b === 5 || b === 6 || b === 8 || b === 9; }
// team matches rank by the fixed seat convention instead of raw score order: seats (0,1) = team A,
// (2,3) = team B; the winning pair (higher seat-pair total, tie -> team A) takes ranks {1,2} ordered
// by own score (tie -> lower seat), the losing pair takes {3,4}. Derived from the consistent score
// vector only -- never from the self-reported rank field. Returns null unless all 4 seats are
// present (e.g. leaver matches fall back to raw score order). Mirrors the client's results ordering.
function teamRankOf(parts) {
  if (!parts || parts.length !== 4) return null;
  let a = 0, b = 0;
  for (const p of parts) { if (((p.seat | 0) >> 1) === 0) a += p.score | 0; else b += p.score | 0; }
  const winTeam = b > a ? 1 : 0;
  const order = [...parts].sort((x, y) => {
    const tx = (((x.seat | 0) >> 1) === winTeam) ? 0 : 1;
    const ty = (((y.seat | 0) >> 1) === winTeam) ? 0 : 1;
    if (tx !== ty) return tx - ty;
    if ((y.score | 0) !== (x.score | 0)) return (y.score | 0) - (x.score | 0);
    return (x.seat | 0) - (y.seat | 0);
  });
  const rankOf = {};
  for (let i = 0; i < order.length; i++) rankOf[order[i].steamID] = i + 1;
  return rankOf;
}
// ---- mode-2 (base 5/6/8/9) outcome derivation: rank claims, never money ----
// The record layout has no sub-score field, so the winner is derived from the writers' own rank
// claims: seats 0..ts-1 = team A, ts..2ts-1 = team B (ts = teamSizeOfMt), and a claimed
// rank <= ts means "my team won" under the fixed {1..ts}v{ts+1..2ts} convention. Rank is
// host-broadcast lockstep fact exactly like the score vector, so every honest end implies the
// same winner; unanimity is required and a conflict (or an out-of-domain claim) returns null ->
// the group is sanity-flagged, not settled (see sanityFlags). With only one team's writers
// present their agreed claim decides -- the same trust level as the score vector itself (what
// present writers agree on), and the absent side is already in the leaver-conviction pipeline.
function team2WinTeamOf(g) {
  const ts = teamSizeOfMt(g[0].d[2] | 0);
  let win = null;
  for (const r of g) {
    const seat = r.d[5] | 0, rank = r.d[6] | 0;
    if (rank < 1 || rank > 2 * ts) return null;
    const w = (rank <= ts) ? teamOfSeat(seat, ts) : (teamOfSeat(seat, ts) ^ 1);
    if (win == null) win = w;
    else if (win !== w) return null;
  }
  return win;
}
// rank assignment for a derived mode-2 outcome: the winning team takes the {1..ts} block, the
// losing team {ts+1..2ts}, ordered inside each block by own score (tie -> lower seat) -- the
// client's display convention. Fixed block offsets (not dense present-only ranks) so absent
// seats keep the convention: a lone present winner stays rank 1 and the losing side stays in the
// bottom block (careerWon and rank bonuses never collapse to money order).
function team2RankOf(parts, winTeam, ts) {
  if (winTeam == null || !parts || !parts.length) return null;
  ts = ts || 2;
  const rankOf = {};
  for (const b of [0, 1]) {   // b: 0 = winning block, 1 = losing block
    const members = parts
      .filter(p => (teamOfSeat(p.seat, ts) === (winTeam | 0)) === (b === 0))
      .sort((x, y) => ((y.score | 0) !== (x.score | 0)) ? (y.score | 0) - (x.score | 0) : (x.seat | 0) - (y.seat | 0));
    for (let i = 0; i < members.length; i++) rankOf[members[i].steamID] = b * ts + i + 1;
  }
  return rankOf;
}
// clamp-aware authoritative leaver deduction (never below 0)
function leaverLpPenalty(cur, pen) { return Math.max(0, (cur | 0) - (pen | 0)); }

// ===== mismatch compensation (the matchmaking-fairness layer): compress the strong side's swing, protect/reward the
//   weak side. authoritative -- the client shows a flat optimistic delta (it can't see opponents' ratings); this is the
//   only place the real adjusted delta + UPSET/PROTECTED tag is computed, revealed back to the client via board details. =====
const RS_THRESHOLD = Number(process.env.RS_THRESHOLD || 400);            // pre-match rating spread (display points) that triggers
const RS_UPSET_BONUS = Number(process.env.RS_UPSET_BONUS || 1.0);        // weak side over-performs: 1.0 = full (>1 = super reward)
const RS_STRONG_UPSET_LOSS = Number(process.env.RS_STRONG_UPSET_LOSS || 0.5); // strong side upset: mild penalty (not the strict tier coeff)
// O82 solo-tilt (design 2026-08-12, conservative until B5/B6 calibration): in an FFA that
// contains a live 3-man premade, a solo's LOSS is compressed x0.6 (escort shield, PROTECTED
// reveal on a real net loss) and the trio's WIN is compressed x0.7 (convoy tax, no reveal --
// same precedent as the strong-side compression). Composed with the mismatch factor by min()
// (strongest protection wins, factors never stack multiplicatively).
const RS_SOLO_VS_TRIO = Number(process.env.RS_SOLO_VS_TRIO || 0.6);
const RS_TRIO_WIN = Number(process.env.RS_TRIO_WIN || 0.7);
const RS_MAGIC = 0xC5;                                                   // reveal-details marker; flags: 0 none / 1 upset / 2 protected
// pure: parts = [{ steamID, seat, mmr (pre-match display rating), rank (1-based), lp (current) }]. returns null if
//   not applicable, else { [steamID]: { adjDelta, flag, normalDelta } }. Drip is never discounted (only the
//   win/loss component is scaled).
// M3 (PARTY_MODES §5.3, design line 66): FFA settles in UNITS -- a premade seat-pair (both members present)
//   is one unit: average rank interpolates the win/loss component, average LP picks the tier, and BOTH members
//   get the same delta (the premade "debt": queuing together taxes the good rank into the pair average).
//   Mismatch compensation then applies per unit (pair average rating vs the match mean). Solo players are
//   1-man units == the original per-player formula, bit for bit. A pair whose partner is absent (leaver)
//   falls back to solo. With no live pair and no mismatch this returns null (caller's plain lpDelta path).
function reducedStakesPlan(parts, matchType, premadeMask, premadeTrioAt) {
  if (!appliesLp(matchType) || isTeamMt(matchType) || !parts || parts.length < 2) return null;
  const units = [], used = new Set();
  const bySeat = {};
  for (const p of parts) bySeat[p.seat | 0] = p;
  // O82: trio unit first (all three members present, else each falls back to solo -- the same
  // conservative absent-partner rule as pairs). trioAt = start seat + 1 (contiguous seats).
  if (premadeTrioAt | 0) {
    const s0 = (premadeTrioAt | 0) - 1;
    const m = [bySeat[s0], bySeat[s0 + 1], bySeat[s0 + 2]];
    if (m[0] && m[1] && m[2]) { units.push(m); for (const p of m) used.add(p.steamID); }
  }
  if (premadeMask | 0) {
    for (let pair = 0; pair < 4; pair++) {
      if (!(((premadeMask | 0) >> pair) & 1)) continue;
      const m0 = bySeat[pair * 2], m1 = bySeat[pair * 2 + 1];
      if (m0 && m1 && !used.has(m0.steamID) && !used.has(m1.steamID)) { units.push([m0, m1]); used.add(m0.steamID); used.add(m1.steamID); }
    }
  }
  for (const p of parts) if (!used.has(p.steamID)) units.push([p]);
  const mmrs = parts.map(p => p.mmr | 0);
  const mismatch = Math.max.apply(null, mmrs) - Math.min.apply(null, mmrs) > RS_THRESHOLD;
  if (!mismatch && units.every(u => u.length === 1)) return null;   // fair all-solo match: plain lpDelta path
  const mean = mmrs.reduce((a, b) => a + b, 0) / mmrs.length;
  const trioLive = units.some(u => u.length === 3);   // O82 solo-tilt applies only against a LIVE trio
  const pc = parts.length, out = {};
  for (const u of units) {
    const uRank = u.reduce((s, p) => s + (p.rank | 0), 0) / u.length;
    const uLp = u.reduce((s, p) => s + (p.lp | 0), 0) / u.length;
    const uMmr = u.reduce((s, p) => s + (p.mmr | 0), 0) / u.length;
    const seg = lpSeg(uLp);
    const prog = pc <= 1 ? 0.5 : (pc - 1 - (uRank - 1)) / (pc - 1);
    const base = prog >= 0.5 ? seg.win * (2 * prog - 1) : -seg.loss * (1 - 2 * prog);
    const normalDelta = Math.round(base + seg.drip);
    let factor = 1, flag = 0;
    if (mismatch && uMmr < mean) {                             // weak side
      if (base > 0) { factor = RS_UPSET_BONUS; flag = 1; }     //   placed up = upset (full/super, not compressed)
      else { factor = seg.rs; if (normalDelta < 0) flag = 2; } //   placed down = protected (loss compressed; reveal only on a real net loss)
    } else if (mismatch && uMmr > mean) {                      // strong side (no client reveal)
      if (base >= 0) factor = seg.rs;                           //   won as expected = gain compressed
      else factor = RS_STRONG_UPSET_LOSS;                       //   lost an upset = mild penalty
    }
    // O82 solo-tilt (min-composed, see RS_SOLO_VS_TRIO note): solo losing vs a live trio gets the
    // escort shield (PROTECTED reveal on a real net loss); the trio's winning delta takes the
    // convoy tax silently (strong-side precedent).
    if (trioLive && u.length === 1 && base < 0) {
      factor = Math.min(factor, RS_SOLO_VS_TRIO);
      if (flag === 0 && normalDelta < 0) flag = 2;
    } else if (trioLive && u.length === 3 && base > 0) {
      factor = Math.min(factor, RS_TRIO_WIN);
    }
    const adjDelta = Math.round(base * factor + seg.drip);
    // won = top-half finish at the unit's (average) rank -- the same sign line the base uses;
    // consumed by the series clamp (crosslineDelta) at settle time.
    for (const p of u) out[p.steamID] = { adjDelta, flag, normalDelta, won: prog >= 0.5 };
  }
  return out;
}

// ===== M3 (PARTY_MODES §5.2 + §6 line 118 + §7): team-brawl visible-LP planner (match types 3/4; only 4
//   actually applies LP). Binary team outcome from the frozen score vector -- a leaver's score still counts
//   for his team's total. The win/loss component uses the TEAM-average tier (design: "team LP first, then
//   halve"), is scaled by mismatch compensation at TEAM granularity (team-average rating vs the match mean,
//   coefficient = team-average tier's rs), then HALVED per member; drip is added per member at full value
//   from his OWN tier (design line 76: the halving only ever touches the win/loss component).
//   §7 abandoned-teammate shield: a present member whose teammate was convicted absent gets his loss
//   compressed by his own tier's rs (min with any mismatch factor) and a PROTECTED reveal on a real net loss.
//   parts: [{ steamID, seat, mmr, lp }] (present ends only); scores: full 4-seat frozen vector;
//   leaverSeats: consensus-absent seats. winTeamOverride (mode-2 only): the sub-score-derived
//   outcome from team2WinTeamOf -- money must never decide a base-5/6 match, so the caller passes
//   the claims-derived winner and the money comparison below stays a 3/4-only fallback.
//   Returns { [steamID]: { adjDelta, flag, normalDelta } } or null. =====
function teamLpPlan(parts, matchType, scores, leaverSeats, winTeamOverride) {
  if (!appliesLp(matchType) || !isTeamMt(matchType)) return null;
  const ts = teamSizeOfMt(matchType);
  if (!parts || !parts.length || !scores || scores.length < 2 * ts) return null;
  const teamOf = s => teamOfSeat(s, ts);
  let aTotal = 0, bTotal = 0;
  for (let s = 0; s < 2 * ts; s++) { if (teamOfSeat(s, ts) === 0) aTotal += scores[s] | 0; else bTotal += scores[s] | 0; }
  const winTeam = (winTeamOverride == null)
    ? (bTotal > aTotal ? 1 : 0)              // tie -> team A (mirrors teamRankOf / the client rule)
    : (winTeamOverride | 0);
  // team aggregates over PRESENT members (an absent leaver has no record: not averaged in)
  const agg = [{ n: 0, lp: 0, mmr: 0 }, { n: 0, lp: 0, mmr: 0 }];
  for (const p of parts) { const t = teamOf(p.seat); agg[t].n++; agg[t].lp += p.lp | 0; agg[t].mmr += p.mmr | 0; }
  const mmrs = parts.map(p => p.mmr | 0);
  const mismatch = mmrs.length >= 2 && (Math.max.apply(null, mmrs) - Math.min.apply(null, mmrs) > RS_THRESHOLD);
  const mean = mmrs.reduce((a, b) => a + b, 0) / (mmrs.length || 1);
  const shielded = new Set();
  for (const s of (leaverSeats || [])) for (const p of parts) {
    if (teamOf(p.seat) === teamOf(s) && (p.seat | 0) !== (s | 0)) shielded.add(p.steamID);
  }
  const out = {};
  for (const p of parts) {
    const t = teamOf(p.seat), won = t === winTeam;
    const tAvgLp = agg[t].n ? agg[t].lp / agg[t].n : (p.lp | 0);
    const tAvgMmr = agg[t].n ? agg[t].mmr / agg[t].n : (p.mmr | 0);
    const tSeg = lpSeg(tAvgLp), ownSeg = lpSeg(p.lp | 0);
    const base = won ? tSeg.win : -tSeg.loss;
    let factor = 1, flag = 0, protectedLoss = false;
    if (mismatch && tAvgMmr < mean) {                          // weak team
      if (won) { factor = RS_UPSET_BONUS; flag = 1; }
      else { factor = tSeg.rs; protectedLoss = true; }
    } else if (mismatch && tAvgMmr > mean) {                   // strong team
      factor = won ? tSeg.rs : RS_STRONG_UPSET_LOSS;
    }
    if (!won && shielded.has(p.steamID)) { factor = Math.min(factor, ownSeg.rs); protectedLoss = true; }
    const normalDelta = Math.round(base / 2 + ownSeg.drip);
    const adjDelta = Math.round(base * factor / 2 + ownSeg.drip);
    if (protectedLoss && normalDelta < 0 && flag === 0) flag = 2;
    out[p.steamID] = { adjDelta, flag, normalDelta, won };   // won feeds the series clamp at settle
  }
  return out;
}

// ===== authoritative XP ladder: client optimistic value = display only, this job = truth. =====
const XP_LB = process.env.XP_LB;   // optional: unset -> skip XP entirely (a live run is unaffected before board/secret exist)
const XP_FILE = process.env.XP_FILE || 'xp.json';
// supporter pack state (HMAC pid keyed): ownership probe cache + wall/opt-out bookkeeping (supporters.js header).
const SUPPORTERS_FILE = process.env.SUPPORTERS_FILE || 'supporters.json';
function loadSupporters() { try { return JSON.parse(fs.readFileSync(SUPPORTERS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveSupporters(s) { try { fs.writeFileSync(SUPPORTERS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + SUPPORTERS_FILE + ' failed: ' + (e && e.message)); } }
const SUPPORTER_WALL_LB = process.env.SUPPORTER_WALL_LB || supporters.SUPPORTER.WALL_LB;
const SUPPORTER_OPTOUT_LB = process.env.SUPPORTER_OPTOUT_LB || supporters.SUPPORTER.OPTOUT_LB;
function loadXp() { try { return JSON.parse(fs.readFileSync(XP_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveXp(s) { try { fs.writeFileSync(XP_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + XP_FILE + ' failed: ' + (e && e.message)); } }
// per-game point formula -- lockstep mirror of the client config (asserted by the schema-lockstep test).
// boosts = permanent account-level point multiplier milestones ([level, +pct], ascending; the
// highest tier at-or-below the player's level applies -- tiers are absolute, not additive).
// curve = the level-cost function (mirror of the client progression curve): the first fastLevels
// of every century cost fastCost, the rest normalCost, all scaled by (1 + centuryGrowth * century).
// progressLevels 5 -> 6 (O117 2026-08-26: matchmade level count is now 6). progressFullAt = 5
// stays below the denominator on purpose -- (a) transition safety: full-progress records written
// by pre-O117 clients carry progress=5 and must not be docked 5/6 regardless of which side
// (client build / this cron) goes live first; (b) permanent semantics: reaching level 5 of 6
// before every opponent left is near-full content, and the discount compensates for missing
// content rather than punishing anyone. Client mirror: RANKED_CONFIG.XP.PROGRESS_FULL_AT.
const XP_CFG = {
  base: 100, rankBonus: [80, 45, 20, 0], moneyDivisor: 50, moneyBonusCap: 120, rankedMult: 1.25, dailyFirstWin: 150, progressLevels: 6, progressFullAt: 5,
  boosts: [[5, 5], [12, 10], [25, 15], [40, 20], [60, 25], [90, 30]],
  curve: { fastLevels: 10, fastCost: 300, normalCost: 700, centuryGrowth: 0.1 },
};
// ---- permanent level-derived boost (client optimistic mirror; THIS side is the truth) ----
// The player's level is derived from their own cumulative points ON THIS BOARD, taken BEFORE the
// current match credits (no intra-match feedback loop; a milestone crossed by this game's gain
// starts paying from the next game). Zero new state: level is a pure function of the board value.
function xpLevelCost(level) {
  const L = Math.max(0, level | 0), c = XP_CFG.curve;
  const base = (L % 100) < c.fastLevels ? c.fastCost : c.normalCost;
  return Math.max(1, Math.round(base * (1 + c.centuryGrowth * Math.floor(L / 100))));
}
function xpLevelOf(totalXp) {
  let level = 0, rem = Math.max(0, totalXp | 0), guard = 0;
  while (guard++ < 100000) { const need = xpLevelCost(level); if (rem < need) break; rem -= need; level++; }
  return level;
}
// supporter (optional) = the pack's permanent +10% on top of the level tier -- one shared multiplier
//   expression (supporters.xpMult) so the client's optimistic mirror rounds identically.
function xpBoostMult(level, supporter) {
  let pct = 0;
  for (const b of XP_CFG.boosts) if ((level | 0) >= b[0]) pct = b[1];
  return supporters.xpMult(pct, !!supporter);
}
// ---- match-progress discount (early-settled matches award partial points) ----
// A matchmade record carries "levels reached" in the high bits of d[7] (bit 0 stays the legacy
// win flag; nobody consumes it -- ranks derive from the score vector). A match that ends early
// because every opponent left settles at progress/levelCount of the full award.
// Deliberately NOT part of the consistency vector: a forced settle can catch honest ends one
// level-transition apart (one still in the shop after level N, one already entering N+1), and
// vector membership would flag that innocent skew as forgery. Instead the settle takes the MIN
// of the writers' in-domain values: a lone forger cannot inflate anyone's award (min wins), and
// deflating hurts the forger's own award along with everyone else's. Out-of-domain values are
// ignored rather than flagged (garbage earns no leverage); all-zero (legacy records) = full.
function xpProgressFrac(prog) {
  const n = prog | 0;
  return (n <= 0 || n >= (XP_CFG.progressFullAt || XP_CFG.progressLevels)) ? 1 : n / XP_CFG.progressLevels;
}
function matchProgressOf(g) {
  let prog = 0;
  for (const r of g) {
    const p = ((r.d[7] | 0) >> 1);
    if (p >= 1 && p <= XP_CFG.progressLevels && (prog === 0 || p < prog)) prog = p;
  }
  return prog;
}
// ---- authoritative career win/loss counters (groundwork for player stat cards) ----
// The client keeps optimistic local games/wins/losses; the truth accumulates HERE from settled
// records (mirror of the client recordGame rules: valid + innocent count a game, only valid
// counts a win or loss; a team-mode win = the winning pair = team rank <= 2; an absent leaver
// writes no record and counts nothing). Published to the client as xp_ladder DETAIL bytes
// [CAREER_MAGIC, ver, games, wins, losses] alongside every XP write -- boot read-back overwrites
// the optimistic counters the same way the XP score itself does.
const CAREER_MAGIC = 0xCA, CAREER_VER = 1;
function careerWon(matchType, rank) { return isTeamMt(matchType) ? ((rank | 0) <= teamSizeOfMt(matchType)) : ((rank | 0) === 1); }
// repeat-leaver discount: gradient + minimum-sample gate in one, via min-denominator smoothing. values tunable on real data.
const LEAVER_XP = { minSample: 20, tiers: [{ maxRate: 0.05, factor: 1.0 }, { maxRate: 0.15, factor: 0.5 }, { maxRate: 1.01, factor: 0.3 }] };
// per-end disposition -> credit class (lockstep mirror of client table): 0,1 valid / 5,7 abandoner / else innocent.
function dispClassOf(code) { const c = code | 0; return (c === 0 || c === 1) ? 'valid' : ((c === 5 || c === 7) ? 'abandoner' : 'innocent'); }
// effective leave rate with min-denominator smoothing -> tier factor. leaves/games cumulative per player; a first leave cannot spike to 100%.
function effectiveLeaverFactor(leaves, games) {
  const total = (leaves | 0) + (games | 0);
  const rate = total > 0 ? (leaves | 0) / Math.max(total, LEAVER_XP.minSample) : 0;
  for (const t of LEAVER_XP.tiers) if (rate <= t.maxRate) return t.factor;
  return LEAVER_XP.tiers[LEAVER_XP.tiers.length - 1].factor;
}
// per-record point gain, mirroring the client per-game formula + credit rules. rank0 = 0-based; factor = repeat-leaver discount.
//   valid = full (rank + money + ranked x + daily-first); innocent = base only; abandoner = 0.
//   boostMult = permanent level boost, applied as the LAST step inside the per-game formula
//   (covers the daily-first bonus too) so the inner round matches the client expression exactly;
//   the outer round(round(xp) * factor) leaver/progress expression is unchanged.
function computeXpGain(cls, rank0, money, isRanked, firstWinToday, factor, boostMult) {
  if (cls === 'abandoner') return 0;
  let xp = XP_CFG.base;
  if (cls === 'valid') {
    const rb = XP_CFG.rankBonus;
    xp += (rank0 >= 0 && rank0 < rb.length) ? rb[rank0] : 0;
    xp += Math.min(XP_CFG.moneyBonusCap, Math.max(0, Math.floor((money | 0) / XP_CFG.moneyDivisor)));
  }
  if (isRanked) xp = xp * XP_CFG.rankedMult;
  if (cls === 'valid' && firstWinToday) xp += XP_CFG.dailyFirstWin;
  xp = xp * (boostMult == null ? 1 : boostMult);
  return Math.max(0, Math.round(Math.round(xp) * (factor == null ? 1 : factor)));
}
// credit authoritative points for one consistent match group (mutates the board map + changedXp + state).
//   deduped by seat; leaves come from the leaver state; today = UTC day index for the daily-first bonus.
//   progFrac (optional, default 1) = match-progress discount, multiplied INTO the leaver factor so both
//   repos share the exact rounding expression round(round(xp) * (leaverFactor * progFrac)).
//   careerDet (optional map) receives per-sid cumulative career detail arrays for the board write.
function creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today, progFrac, careerDet, spSet) {
  const isRanked = appliesLp(matchType);
  const pf = (progFrac == null ? 1 : progFrac);
  const recBySeat = {};
  for (const r of g) { const s = r.d[5] | 0; if (recBySeat[s] == null) recBySeat[s] = r; }
  for (const seatKey of Object.keys(recBySeat)) {
    const r = recBySeat[seatKey], seat = seatKey | 0, sid = r.steamID, p = pid(sid);
    const cls = dispClassOf(r.dispCode);
    const st = xpState[p] = xpState[p] || { lastWinDay: 0, games: 0 };
    const factor = effectiveLeaverFactor((leavers[p] && leavers[p].leaves) || 0, st.games);
    const rank0 = ((rankOf[sid] || 1) | 0) - 1;   // 0-based for rankBonus index (group rank is 1-based)
    let firstWin = false;
    // daily-first qualification (2026-07-19 audit M7) = the same "won" predicate as the career
    // counters (careerWon: FFA rank 1 / team modes winning pair rank<=2). The old rank0===0 check
    // excluded the rank-2 member of a winning pair while the client grants both winners (results.js
    // team win = team outcome) -- one predicate, three consumers (career wins, first-win, client
    // opts.win) now agree. FFA behavior unchanged (careerWon === rank 1 there).
    if (cls === 'valid' && careerWon(matchType, rankOf[sid]) && (st.lastWinDay | 0) < today) { firstWin = true; st.lastWinDay = today; }
    const bm = xpBoostMult(xpLevelOf(xp[sid] | 0), !!(spSet && spSet.has(String(sid))));   // pre-credit board value -> level -> permanent boost (+ supporter pack)
    const gain = computeXpGain(cls, rank0, scores[seat] | 0, isRanked, firstWin, factor * pf, bm);
    if (gain > 0) { xp[sid] = (xp[sid] | 0) + gain; changedXp[sid] = xp[sid]; }
    if (cls === 'valid') st.games += 1;   // denominator = real finishes (innocent/abandoner don't count; mirrors client window)
    // career counters (client recordGame mirror): a leaver writes no record -> counts nothing here,
    // which is exactly the client's abandoner branch (nothing credited). Cumulative in state, so the
    // detail write always carries the latest totals even across multiple settles in one run.
    if (cls === 'valid' || cls === 'innocent') st.cg = (st.cg | 0) + 1;
    if (cls === 'valid') { if (careerWon(matchType, rankOf[sid])) st.cw = (st.cw | 0) + 1; else st.cl = (st.cl | 0) + 1; }
    if (careerDet && cls !== 'abandoner') careerDet[sid] = [CAREER_MAGIC, CAREER_VER, st.cg | 0, st.cw | 0, st.cl | 0];
    console.log('  xp ' + plog(sid) + ' ' + cls + ' rank' + (rank0 + 1) + (firstWin ? ' dailyWin' : '') + ' x' + factor + (pf !== 1 ? ' prog x' + pf : '') + (bm !== 1 ? ' boost x' + bm : '') + ' +' + gain + ' -> ' + (xp[sid] | 0) + ' career ' + (st.cg | 0) + 'g/' + (st.cw | 0) + 'w/' + (st.cl | 0) + 'l');
  }
}
// ===== endless progress XP (match type 7) -- 2026-09-05 =====
// Co-op endless runs now earn points by DEPTH PROGRESS: gain = round(perDepth * (endDepth - startDepth)
// * boostMult). A resumed session only pays for its own new levels (the start depth is part of the
// host-broadcast lockstep tail), so replaying a saved segment earns nothing extra. No rank, money,
// daily-first or leaver terms (co-op has no outcome), no career counters, and no day cap: the
// depth-scaled pacing gate already pins the rate (one level per LEVEL_SECONDS*PACE_FRAC of real time,
// ~860 points/hour at most). perDepth == PRIVATE_XP.perLevel on purpose (one endless level ~= one
// friend-room level; a 20-level run ~= one matchmade game). Client mirror: RANKED_CONFIG.XP.ENDLESS +
// rating-store computeGameXpEndless -- value-pinned by the companion repo's lockstep test.
const ENDLESS_XP = { perDepth: 9 };
function computeXpEndless(startDepth, endDepth, boostMult) {
  const delta = Math.max(0, (endDepth | 0) - (startDepth | 0));
  return Math.max(0, Math.round(ENDLESS_XP.perDepth * delta * (boostMult == null ? 1 : boostMult)));
}
// credit for one settled type-7 group: every record WRITER (seat-deduped) except abandoners; valid and
// innocent earn the same (no outcome to gate on). xpState is touched only for the pre-credit level read.
function creditXpEndless(g, tail, xp, changedXp, spSet) {
  const recBySeat = {};
  for (const r of g) { const s = r.d[5] | 0; if (recBySeat[s] == null) recBySeat[s] = r; }
  for (const seatKey of Object.keys(recBySeat).map(k => k | 0).sort((a, b) => a - b)) {
    const r = recBySeat[seatKey], sid = r.steamID;
    const cls = dispClassOf(r.dispCode);
    if (cls === 'abandoner') continue;
    const bm = xpBoostMult(xpLevelOf(xp[sid] | 0), !!(spSet && spSet.has(String(sid))));
    const gain = computeXpEndless(tail.startDepth, tail.endDepth, bm);
    if (gain > 0) { xp[sid] = (xp[sid] | 0) + gain; changedXp[sid] = xp[sid]; }
    console.log('  xp-endless ' + plog(sid) + ' ' + cls + ' depth ' + (tail.startDepth | 0) + '->' + (tail.endDepth | 0)
      + (bm !== 1 ? ' boost x' + bm : '') + ' +' + gain + ' -> ' + (xp[sid] | 0));
  }
}
// ===== O93 solo competitive endless (knife 3.3a, 2026-09-06) =====
// A pc=1 endless record is a guard-built, Ed25519-signed SEGMENT of one competitive run (attest.js
//   verifySoloRecord, layout attVer 3). The guard cuts a segment every CKPT_EVERY passed levels, at
//   "save & quit" (flags SUSPENDED, dispCode finished) and at run over / quit (flags FINAL, dispCode 5
//   for a quit). A segment that starts from a consumed save row carries RESUMED. Segments of one run
//   share (season, runSeed) and chain end-to-start; the cron settles each segment on its own (ladder =
//   deepest depth with the bank as tiebreak, depth-progress XP, milestone CP once per run, RESUME_CP
//   debit once per consumed save) under these rules:
//   - a segment settles only when its predecessor settled ending exactly at its startDepth (or its
//     startDepth is 0): the pacing gate credits the chained depth; an unchained claim waits up to
//     CHAIN_WAIT_MS for the predecessor and is then rejected;
//   - a RESUMED segment needs a settled SUSPENDED segment of the same run ending at its startDepth,
//     and that save point resumes ONCE (a replay of the same signed save row is rejected);
//   - nothing follows a FINAL segment; a second depth-0 segment on the same run is a replay.
//   Consensus: none (one seat). Authority = the signature (guard = local authority server, owner-bound
//   to the row writer) + this job's own wall clock (pacing) + the chain memory (endless-solo.json).
//   The seed-cap auditor still audits the score vector (pc=1 chain keyed like any endless run).
const ENDLESS_COMP_LB = process.env.ENDLESS_COMP_LB || 'endless_comp_solo';   // lifetime ladder (+ season twins via resolveSeasonBoard)
const SAVE_BOX_LB = process.env.SAVE_BOX_LB || 'endless_save_box_solo';        // client-writable, guard-signed save rows; cron only prunes past seasons
const SOLO_FILE = process.env.SOLO_FILE || 'endless-solo.json';
const COMP = {
  RESUME_CP: Number(process.env.COMP_RESUME_CP || 20),                       // lockstep: client RANKED_CONFIG.ENDLESS.COMP.RESUME_CP
  MILESTONES: [[10, 40], [20, 80], [30, 150]],                                // lockstep: ENDLESS.COMP.MILESTONES (depth -> CP, once per run)
  CKPT_EVERY: 5,                                                              // lockstep: ENDLESS.CHECKPOINT_EVERY (guard segment cadence = max span)
  CHAIN_WAIT_MS: Number(process.env.COMP_CHAIN_WAIT_MS || 7 * 86400000),      // unchained segment waits this long for its predecessor, then rejects
  RUN_TTL_MS: Number(process.env.COMP_RUN_TTL_MS || 45 * 86400000),           // run chain memory (saves included) pruned after
};
function loadSolo() { try { const st = JSON.parse(fs.readFileSync(SOLO_FILE, 'utf8')) || {}; st.runs = st.runs || {}; st.wait = st.wait || {}; return st; } catch (e) { return { runs: {}, wait: {} }; } }
function pruneSolo(st, nowMs) {
  for (const k of Object.keys(st.runs)) if (nowMs - (st.runs[k].t || 0) > COMP.RUN_TTL_MS) delete st.runs[k];
  for (const m of Object.keys(st.wait)) if (nowMs - (st.wait[m].t0 || 0) > COMP.CHAIN_WAIT_MS + 86400000) delete st.wait[m];
}
function saveSolo(st, nowMs) { pruneSolo(st, nowMs); try { fs.writeFileSync(SOLO_FILE, JSON.stringify(st, null, 0)); } catch (e) { ghWarn('write ' + SOLO_FILE + ' failed: ' + (e && e.message)); } }
function soloRunKey(p, seasonId, runSeed) { return p + '|' + (seasonId | 0) + '|' + (runSeed | 0); }
// structural bounds on a VERIFIED segment (flag-don't-settle; the signature already proves a guard wrote it)
function soloSanity(f) {
  const out = [];
  if ((f.startDepth | 0) < 0 || (f.endDepth | 0) < (f.startDepth | 0) || (f.endDepth | 0) > ENDLESS.DEPTH_CAP) out.push('depth');
  if ((f.endDepth | 0) - (f.startDepth | 0) > COMP.CKPT_EVERY) out.push('span');
  if ((f.continuesUsed | 0) !== 0) out.push('cont');        // competitive = one life, never a continue
  if ((f.tokensCp | 0) !== 0) out.push('tokens');
  if ((f.seasonId | 0) < 0 || (f.seasonId | 0) > 4095) out.push('season');
  const fl = f.flags | 0;
  if ((fl & ~(attest.SEG_SUSPENDED | attest.SEG_FINAL | attest.SEG_RESUMED)) !== 0 || ((fl & attest.SEG_SUSPENDED) && (fl & attest.SEG_FINAL))) out.push('flags');
  if ((f.dispCode | 0) !== attest.DISP_FINISHED && (f.dispCode | 0) !== attest.DISP_USER_QUIT) out.push('disp');
  if ((fl & attest.SEG_SUSPENDED) && (f.dispCode | 0) !== attest.DISP_FINISHED) out.push('disp');
  const cap = endlessGoalFor(Math.max(1, f.endDepth | 0), 1) * ENDLESS.SCORE_MULT;
  if ((f.score | 0) > cap || (f.score | 0) < SANITY.SCORE_FLOOR) out.push('score');
  if ((f.durationSec | 0) < 0) out.push('duration');
  return out;
}
// chain verdict for one segment. Mutates only st.wait (first-sighting clock of an unchained claim).
//   { ok: true, proven, consume? }  settle (proven = depth credited to the pacing gate; consume = save point used)
//   { ok: false, reason }           reject (processed, no credit)      { ok: null, reason }  wait
function soloChainPlan(st, key, f, m, nowMs) {
  const run = st.runs[key];
  const waitOr = (reason) => {
    const w = st.wait[m] || (st.wait[m] = { t0: nowMs });
    return (nowMs - (w.t0 || 0) > COMP.CHAIN_WAIT_MS) ? { ok: false, reason } : { ok: null, reason };
  };
  if (run && run.final) return { ok: false, reason: 'after-final' };
  const sd = f.startDepth | 0, fl = f.flags | 0;
  if (sd === 0) {
    if (run && ((run.max | 0) > 0 || run.seg0)) return { ok: false, reason: 'restart' };   // a second depth-0 segment on the same run = replay
    return { ok: true, proven: 0 };
  }
  if (fl & attest.SEG_RESUMED) {
    const sv = run && run.saves && run.saves[String(sd)];
    if (!sv) return waitOr('save-orphan');
    if (sv.by) return sv.by === m ? { ok: true, proven: sd } : { ok: false, reason: 'save-reused' };
    return { ok: true, proven: sd, consume: String(sd) };
  }
  if (!run) return waitOr('chain-gap');
  if ((run.max | 0) === sd) return { ok: true, proven: sd };
  if ((run.max | 0) > sd) return { ok: false, reason: 'chain-back' };
  return waitOr('chain-gap');
}
// milestones newly crossed by this segment (once per run: bitmap on the run memory). Mutates run.ms only.
function soloMilestones(run, endDepth) {
  const out = [];
  for (let i = 0; i < COMP.MILESTONES.length; i++) {
    const d = COMP.MILESTONES[i][0], cpv = COMP.MILESTONES[i][1];
    if ((endDepth | 0) >= d && !((run.ms | 0) & (1 << i))) { run.ms = (run.ms | 0) | (1 << i); out.push([d, cpv]); }
  }
  return out;
}
// apply a settled segment to the run memory (max depth, save points, consumption, terminal flag)
function soloAdvance(st, key, f, m, plan, nowMs) {
  const run = st.runs[key] || (st.runs[key] = { max: 0, ms: 0, saves: {}, t: nowMs });
  run.t = nowMs; run.saves = run.saves || {};
  if ((f.startDepth | 0) === 0) run.seg0 = 1;
  if (plan.consume) { run.saves[plan.consume] = run.saves[plan.consume] || {}; run.saves[plan.consume].by = m; }
  if ((f.endDepth | 0) > (run.max | 0)) run.max = f.endDepth | 0;
  if ((f.flags | 0) & attest.SEG_SUSPENDED) run.saves[String(f.endDepth | 0)] = { t: nowMs };
  if ((f.flags | 0) & attest.SEG_FINAL) run.final = 1;
  delete st.wait[m];
  return run;
}
// ===== O140 private friend-room XP credit (match type 10) =====
// Levels-played reader for private groups (domain 1..15 -- rooms run 3/6/9 levels, wider than
// the matchmade 1..6 window): min-of-writers, same anti-inflation stance as matchProgressOf
// (a lone forger can only DEFLATE everyone's award including his own).
function privateProgressOf(g) {
  let prog = 0;
  for (const r of g) {
    const p = ((r.d[7] | 0) >> 1);
    if (p >= 1 && p <= PRIVATE_XP.progMax && (prog === 0 || p < prog)) prog = p;
  }
  return prog;
}
// XP-lite credit for one consistent private group. Formula (client mirror, lockstep-pinned):
//   P = base + perLevel*lv;  T = round(P * transferFrac)
//   valid:    gain = max(0, round((P + t_i) * boostMult))
//             t_i  = round(T * (avgRank - rank_i) * 2 / (N - 1))   (N = distinct writer seats)
//   innocent: gain = round(base * boostMult)     abandoner: 0
// The transfer sums to ~0 across writers (winners are paid BY the losers' share -- collusive
// win-trading nets zero; ties transfer nothing since avgRank == every rank). No money bonus,
// no daily-first-win, no leaver factor, no career counters -- deliberately narrow.
// Day cap: per-UTC-day credited private XP <= dayCapXp (state pvDay/pvXp per pid).
function creditXpPrivate(g, rankOf, lv, xp, changedXp, xpState, today, spSet) {
  const recBySeat = {};
  for (const r of g) { const s = r.d[5] | 0; if (recBySeat[s] == null) recBySeat[s] = r; }
  const seats = Object.keys(recBySeat).map(k => k | 0).sort((a, b) => a - b);
  const N = seats.length;
  let avgR = 0;
  for (const s of seats) avgR += ((rankOf[recBySeat[s].steamID] || 1) | 0);
  avgR = N > 0 ? avgR / N : 1;
  const P = PRIVATE_XP.base + PRIVATE_XP.perLevel * lv;
  const T = Math.round(P * PRIVATE_XP.transferFrac);
  for (const s of seats) {
    const r = recBySeat[s], sid = r.steamID, p = pid(sid);
    const cls = dispClassOf(r.dispCode);
    if (cls === 'abandoner') continue;
    const st = xpState[p] = xpState[p] || { lastWinDay: 0, games: 0 };
    const bm = xpBoostMult(xpLevelOf(xp[sid] | 0), !!(spSet && spSet.has(String(sid))));   // pre-credit board value (same rule as creditXp, + supporter pack)
    let gain;
    if (cls === 'valid') {
      const t = (N >= 2) ? Math.round(T * (avgR - ((rankOf[sid] || 1) | 0)) * 2 / (N - 1)) : 0;
      gain = Math.max(0, Math.round((P + t) * bm));
    } else {
      gain = Math.max(0, Math.round(PRIVATE_XP.base * bm));
    }
    if ((st.pvDay | 0) !== today) { st.pvDay = today; st.pvXp = 0; }
    const room = Math.max(0, PRIVATE_XP.dayCapXp - (st.pvXp | 0));
    const credited = Math.min(gain, room);
    st.pvXp = (st.pvXp | 0) + credited;
    if (credited > 0) { xp[sid] = (xp[sid] | 0) + credited; changedXp[sid] = xp[sid]; }
    console.log('  xp-private ' + plog(sid) + ' ' + cls + ' rank' + ((rankOf[sid] || 1) | 0) + ' lv' + lv
      + (bm !== 1 ? ' boost x' + bm : '') + ' +' + credited
      + (credited < gain ? ' (day-capped from ' + gain + ')' : '') + ' -> ' + (xp[sid] | 0));
  }
}

// ===== endless co-op authority (match type 7): depth board + CP wallet + progress XP; never rating/LP. =====
// Type-7 records are a 2-3 player PvE track. Their settle path (a) writes the personal-best
// depth board, (b) debits the CP wallet for continues spent and (c) since 2026-09-05 credits
// depth-progress points (creditXpEndless) -- TrueSkill, LP and leaver conviction are skipped by
// construction. The record layout is the
// standard v3 record with a 4-int tail appended after the roster:
//   [11+3pc ..) = [startDepth, endDepth, continuesUsed, tokensCp, seasonId?]   (lockstep with the client writer;
//   seasonId = 5th int added 2026-09-05: the run's season snapshot -- the endless world is a pure
//   function of (seasonId, depth, candidate(runSeed, depth)), so the seed-cap auditor replays the
//   exact boards; records without it decode as seasonId -1 = pre-season-seed legacy world)
// The one genuinely new defense is the depth-scaled pacing gate (endlessRequiredMs below): a
// claimed depth gain cannot settle before the corresponding REAL time has passed on this job's
// own clock. Consensus residual: always-2P co-op has no honest majority (same acknowledged
// residual as ranked 2P) -- colluding pairs are bounded by the structural checks + pacing only.
const CP_LB = process.env.CP_LB || 'cp_bank';
const ENDLESS_LB = process.env.ENDLESS_LB || 'endless_board';
// trio ladder (knife-B/C 2026-08-13): 3-seat runs rank on their own board -- three diggers
// structurally outscore two, a mixed board would be dominated. The board exists in production
// (knife-C); while unresolved (listing wobble) pc=3 groups are left pending (boards are the
// debit target AND the chain memory -- settling without them would silently drop the run,
// same rule as the duo gate).
const ENDLESS_LB_TRIO = process.env.ENDLESS_LB_TRIO || 'endless_board_trio';
const ENDLESS = {
  MT: 7,
  // Physical floor per level. The level timer is 75s (lockstep with the client config; O114
  // 2026-08-26 global pacing slowdown raised it from the original 60), but a fully-cleared
  // level ends early and the between-level screens can be declined in seconds, so the
  // ENFORCED floor is deliberately half the timer. Generosity is free here: pacing only
  // DEFERS a settle (plain log, never a flag), so a legit speedrun merely settles a few minutes
  // later while a fabricated deep run still has to sit out most of the real play time.
  // Rollout note: raising the floor ahead of clients is safe in both directions -- records from
  // 60s-era clients still accrue real wall time well above 75*0.5 per depth.
  LEVEL_SECONDS: 75,
  PACE_FRAC: Number(process.env.ENDLESS_PACE_FRAC || 0.5),
  DEPTH_CAP: Number(process.env.ENDLESS_DEPTH_CAP || 200000),   // structural domain; keeps packed board keys far inside int32
  SCORE_MULT: Number(process.env.ENDLESS_SCORE_MULT || 10),     // per-seat score cap = team goal at endDepth x this
  BOARD_SCALE: 10000, TIEBREAK_DIV: 1000,                       // packed board key: depth major, team score minor
  PENDING_TTL_MS: Number(process.env.ENDLESS_PENDING_TTL_MS || 30 * 86400000),
  // goal curve + economy constants: lockstep mirrors of the client config (value-pinned by the
  // companion repo's schema-lockstep suite; change either side only together).
  GOAL: { start: 650, addonStart: 275, growEarly: 250, growLate: 50, earlyLevels: 9 },
  CP: { base: 10, rankBonus: [10, 5, 0, 0], rankedMult: 2.0 },
  CONTINUE: { base: 20, esc: 1.5 },
};
// ---- redeem channel (client-written want bitmaps -> wallet debit -> trusted entitlement bitmap) ----
// The redeem box carries per-player "want" bitmaps (details [0xCE|ver<<8, tMin, w0, w1], entry
// owner = Steam-authenticated claimant, so nobody can spend anyone else's wallet). The grant box
// is the trusted entitlement bitmap this job writes ([0xCF|ver<<8, tMin, w0, w1]). Idempotency
// needs no state file: an entitlement bit, once set, is skipped forever -- stale or replayed
// wants are harmless, and a want the wallet cannot cover stays on the box and auto-completes
// when the balance catches up (client optimism leads authority by a few minutes by design).
// Debit atomicity: the grant write goes FIRST and the wallet debit only follows a successful
// grant write. grant-ok + debit-fail undercharges once and cannot loop (the set bit blocks
// re-processing); grant-fail defers the item wholesale to a later run.
// Catalog is value-locked with the client registry (companion lockstep suite): bit -> price,
// plus an optional points-ladder floor gate (met on THIS season's ladder or any archived one).
const REDEEM_LB = process.env.REDEEM_LB || 'redeem_box';
const GRANT_LB = process.env.GRANT_LB || 'grant_box';
// O159 knife-7d: campaign clear attestation box (client-writable; the game's guard sidecar writes signed
//   records). Dev/e2e guards write campaign_box_test; dev-key records settle ONLY on a *_test board.
const CAMPAIGN_LB = process.env.CAMPAIGN_LB || 'campaign_box';
const REDEEM_MAGIC = 0xCE, GRANT_MAGIC = 0xCF, GRANT_VER = 1;
const GRANT_WORDS = 2;
const REDEEM_CATALOG = {
  0: { cp: 3000, gateLp: 2000 },
  1: { cp: 1500 },
  2: { cp: 1500 },
  3: { cp: 1000 },
  4: { cp: 800 },
};
function decodeRedeemWant(d) {
  if (!d || ((d[0] | 0) & 0xff) !== REDEEM_MAGIC || d.length < 4) return null;
  return [d[2] | 0, d[3] | 0];
}
function decodeGrantMask(d) {
  if (!d || ((d[0] | 0) & 0xff) !== GRANT_MAGIC || d.length < 4) return null;
  return [d[2] | 0, d[3] | 0];
}
function grantBit(words, bit) { return ((words[(bit / 32) | 0] | 0) >>> (bit & 31)) & 1; }
function setGrantBit(words, bit) { words[(bit / 32) | 0] = (words[(bit / 32) | 0] | 0) | (1 << (bit & 31)); }
function popcountWords(words) { let n = 0; for (let i = 0; i < words.length; i++) { let w = words[i] | 0; while (w) { n += w & 1; w >>>= 1; } } return n; }
// Pure plan: pick grantable bits in ascending order while funds last. A cheaper later item may
// still land when an earlier one is unaffordable (deterministic greedy; matches the client's
// per-item optimistic debits). gateOkByBit carries pre-resolved ladder-gate verdicts.
function redeemPlan(want, granted, balance, gateOkByBit) {
  const bits = [];
  let bal = balance | 0;
  for (let bit = 0; bit < GRANT_WORDS * 32; bit++) {
    if (!grantBit(want, bit) || grantBit(granted, bit)) continue;
    const it = REDEEM_CATALOG[bit];
    if (!it) continue;                                   // unknown bit (newer client) -> defer
    if (it.gateLp && !(gateOkByBit && gateOkByBit[bit])) continue;
    if (bal < (it.cp | 0)) continue;
    bits.push(bit); bal -= it.cp | 0;
  }
  return { bits, balance: bal };
}
function isEndlessMt(mt) { return baseMt(mt) === ENDLESS.MT; }
// depth tail decode; null = malformed (missing tail). Start attestations never carry a tail.
function endlessTail(d) {
  const pc = d[8] | 0, at = 11 + 3 * pc;
  if (!d || d.length < at + 4) return null;
  return { startDepth: d[at] | 0, endDepth: d[at + 1] | 0, continuesUsed: d[at + 2] | 0, tokensCp: d[at + 3] | 0,
    seasonId: d.length >= at + 5 ? (d[at + 4] | 0) : -1 };
}
// zero-tail abstention (2026-07-19 audit M3): a cold reconnector who lands straight on results
// never saw a verdict frame -- his GAME.endless is all zeros, so his record carries a legitimate
// all-zero depth tail while his score slice matches everyone (the strict byte-equal vector used
// to flag that honest skew as forgery and the run never settled). Consistency for an endless
// group therefore splits: scores must match EVERY writer; an all-zero tail is "no claim";
// non-zero tails must match each other. Returns { same, canonIdx } -- canonIdx = a record
// carrying the agreed non-zero tail (caller rotates it to g[0] so the sanity depth-scaled score
// cap, the settle's tail read and the log all see the canonical view), 0 when every writer
// abstained (settles at depth 0: no board entry, no debits -- same outcome as never playing).
// Zero buys a cheater nothing: with >=1 honest writer the run settles on the real tail incl.
// the abstainer's own continue debits, and a fabricated NON-zero tail still flags the group.
function endlessAbstention(g, maxSeats) {
  const sv = g.map(r => { const pc = r.d[8] | 0; return (pc >= 1 && pc <= (maxSeats | 0) && r.d.length >= 10 + pc) ? JSON.stringify(r.d.slice(10, 10 + pc)) : 'BAD'; });
  if (!sv.every(v => v === sv[0] && v !== 'BAD')) return { same: false, canonIdx: 0 };
  // tail = 4 legacy ints (+ seasonId when the writers carry it); zero-tail abstention keys on the FIRST FOUR
  //   (a cold reconnector's seasonId is a real snapshot, not a claim about the run)
  const tv = g.map(r => { const pc = r.d[8] | 0, at = 11 + 3 * pc; return r.d.length >= at + 4 ? JSON.stringify(r.d.slice(at, r.d.length >= at + 5 ? at + 5 : at + 4)) : 'BAD'; });
  if (tv.some(t => t === 'BAD')) return { same: false, canonIdx: 0 };
  const isZero = (t) => { const a = JSON.parse(t); return a[0] === 0 && a[1] === 0 && a[2] === 0 && a[3] === 0; };
  const ZERO = '__zero__';
  for (let i = 0; i < tv.length; i++) if (isZero(tv[i])) tv[i] = ZERO;
  const nz = tv.filter(t => t !== ZERO);
  if (!nz.every(t => t === nz[0])) return { same: false, canonIdx: 0 };
  return { same: true, canonIdx: Math.max(0, tv.findIndex(t => t !== ZERO)) };
}
// cumulative team goal line (client curve mirror): quadratic ramp for the early levels, then
// near-linear. Used as the depth-scaled score cap -- the global matchmade cap has no meaning here.
function endlessGoalBase(depth) {
  const G = ENDLESS.GOAL, dd = Math.max(1, depth | 0);
  let goal = G.start, addon = G.addonStart;
  for (let n = 2; n <= dd; n++) { addon += ((n - 1) <= G.earlyLevels) ? G.growEarly : G.growLate; goal += addon; }
  return goal;
}
function endlessGoalFor(depth, pcnt) { return endlessGoalBase(depth) * Math.max(1, pcnt | 0); }
// per-game CP gain (client formula mirror): flat base + rank bonus (full-credit records only),
// ranked multiplier; innocent participation earns the base, an abandoner earns nothing. No
// leaver factor and no daily bonus -- deliberately simple so both repos stay value-identical.
function endlessCpGain(cls, rank0, isRanked) {
  if (cls === 'abandoner') return 0;
  let cp = ENDLESS.CP.base;
  const rb = ENDLESS.CP.rankBonus;
  if (cls === 'valid' && rank0 >= 0 && rank0 < rb.length) cp += rb[rank0];
  if (isRanked) cp = cp * ENDLESS.CP.rankedMult;
  return Math.max(0, Math.round(cp));
}
// price of the n-th continue (1-based) within one session -- an escalating ladder shared by the
// whole team (whoever pays, the price climbs). Mirror of the client function.
function endlessContinueCost(n) {
  const k = Math.max(1, n | 0);
  return Math.max(0, Math.round(ENDLESS.CONTINUE.base * Math.pow(ENDLESS.CONTINUE.esc, k - 1)));
}
// continuesUsed wire format: per-seat counts packed as nibbles (bits 4s..4s+3 = seat s; the
// int32 structurally holds 8 seats, production uses 2-3 -- knife-B 2026-08-13).
const endlessNib = (packed, seat) => ((packed | 0) >> (4 * (seat | 0))) & 0xF;
// canonical per-seat debit replay. The wire carries per-seat COUNTS, not press order, so the
// ladder is replayed seat-ascending (seat 0 takes rungs 1..n0, seat 1 the next n1, ...). Exact
// whenever a single wallet paid (the common case); an interleaved group can differ from true
// press order by a few CP -- the client's optimistic deduction is reconciled by read-back either
// way. Replays all 8 structural seats: sanity pins nibbles beyond the real seat count to zero,
// so the extra slots stay 0 and the settle loop only reads the first pc entries.
function endlessDebits(contPacked) {
  const out = [0, 0, 0, 0, 0, 0, 0, 0];
  let rung = 1;
  for (let seat = 0; seat < 8; seat++) for (let i = 0, n = endlessNib(contPacked, seat); i < n; i++) out[seat] += endlessContinueCost(rung++);
  return out;
}
// board key packing: depth is the primary rank, team score the tiebreak (saturating -- ties above
// ~10M team score share a rank). Monotone in (depth, score) lexicographic order, so a plain
// "write when greater" keeps each entry the player's true personal best.
function packEndlessScore(depth, teamScore) {
  const tb = Math.max(0, Math.min(ENDLESS.BOARD_SCALE - 1, Math.round((teamScore | 0) / ENDLESS.TIEBREAK_DIV)));
  return (depth | 0) * ENDLESS.BOARD_SCALE + tb;
}
function unpackEndlessScore(score) { const s = score | 0; return { depth: Math.floor(s / ENDLESS.BOARD_SCALE), tiebreak: s % ENDLESS.BOARD_SCALE }; }
// Depth-scaled pacing: the minimum REAL time (this job's own clock, anchored at the first
// sighting of the match's start attestation -- or of the settle itself when no attestation was
// ever sighted) before a claimed depth gain may settle. startDepth is only credited up to the
// deepest END depth either roster player has previously SETTLED (the chain rule; the board
// itself is that memory): a resume nobody on the board can vouch for simply earns no time
// credit and waits out the full span. Induction consequence: reaching depth D requires >=
// D * LEVEL_SECONDS * PACE_FRAC of wall time across the chain no matter how records are forged,
// while a legit crash-orphaned save (its run never settled) just settles a little later.
function endlessRequiredMs(tail, chainMax) {
  const proven = Math.min(tail.startDepth | 0, Math.max(0, chainMax | 0));
  return Math.max(0, (tail.endDepth | 0) - proven) * ENDLESS.LEVEL_SECONDS * 1000 * ENDLESS.PACE_FRAC;
}
// consensus roster (seat -> sid): detectLeavers' per-seat strict-majority vote, but returning
// every agreed seat rather than only the absent ones. CP debits target the ROSTER -- writing no
// record must not dodge a debit the whole lobby witnessed.
function rosterConsensus(g) {
  const votes = {};
  for (const r of g) for (const seatKey of Object.keys(r.roster || {})) {
    const seat = seatKey | 0, sid = r.roster[seatKey];
    (votes[seat] = votes[seat] || {})[sid] = (votes[seat][sid] || 0) + 1;
  }
  const out = {};
  for (const seatKey of Object.keys(votes)) {
    let best = null, bestN = 0;
    for (const sid of Object.keys(votes[seatKey])) if (votes[seatKey][sid] > bestN) { bestN = votes[seatKey][sid]; best = sid; }
    if (best && bestN * 2 > g.length) out[seatKey | 0] = best;
  }
  return out;
}
// B6 signals, endless flavor: pair co-occurrence is real shared-match history (it backs report
// verification), but win counters and score moments stay matchmade-only -- endless scores live on
// another scale and would smear that calibration data. `e` = endless settles participated in.
// Recorded for BOTH roster members (a debited player may have written no record, and the nightly
// trusted-board closure audit requires every board identity to exist in state).
function recordEndlessSignals(s, rosterSids, now) {
  for (const sid of rosterSids) { const h = sigPlayer(s, pid(sid), now); h.e = (h.e | 0) + 1; }
  for (let i = 0; i < rosterSids.length; i++) for (let j = i + 1; j < rosterSids.length; j++) {
    const k = pairKey(pid(rosterSids[i]), pid(rosterSids[j]));
    const e = s.pairs[k] || (s.pairs[k] = { n: 0, t: 0, x: 0, at: 0 });
    e.n += 1; e.t += 1; e.at = now;   // co-op partners are by definition together
  }
}
// authoritative CP earn for one consistent MATCHMADE group (settled or consensus-VOID -- innocent
// participation earns like XP does). Endless records are the SPEND side and never pass through
// here; their debits happen on the endless settle branch.
function creditCp(g, matchType, rankOf, cp, changedCp) {
  const isRanked = appliesLp(matchType);
  const recBySeat = {};
  for (const r of g) { const s = r.d[5] | 0; if (recBySeat[s] == null) recBySeat[s] = r; }
  for (const seatKey of Object.keys(recBySeat)) {
    const r = recBySeat[seatKey], sid = r.steamID;
    const cls = dispClassOf(r.dispCode);
    const rank0 = ((rankOf[sid] || 1) | 0) - 1;
    const gain = endlessCpGain(cls, rank0, isRanked);
    if (gain > 0) { cp[sid] = (cp[sid] == null ? 0 : cp[sid]) + gain; changedCp[sid] = cp[sid]; }
    console.log('  cp ' + plog(sid) + ' ' + cls + ' +' + gain + ' -> ' + (cp[sid] | 0));
  }
}

function eloDeltas(parts, mmr) {
  const delta = {}; for (const p of parts) delta[p.steamID] = 0;
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    const a = parts[i], b = parts[j];
    const ea = 1 / (1 + Math.pow(10, ((mmr[b.steamID]) - (mmr[a.steamID])) / 400));
    const sa = a.rank < b.rank ? 1 : (a.rank > b.rank ? 0 : 0.5);
    delta[a.steamID] += K_FACTOR * (sa - ea);
    delta[b.steamID] += K_FACTOR * ((1 - sa) - (1 - ea));
  }
  return delta;
}

// One-shot starter wallet (playtest channel): a first-seen participant gets a flat CP baseline
// before any earn/debit applies. "First seen" == no wallet-board entry (cp[sid] == null after the
// complete/on-demand base reads); once written the entry exists forever (a zero or negative
// balance keeps its entry), so the grant structurally cannot repeat. Returns seeded count.
function ptSeedCp(cp, changedCp, sids) {
  let n = 0;
  for (const sid0 of sids) {
    const sid = String(sid0);
    if (cp[sid] != null) continue;
    cp[sid] = PT_SEED_CP; changedCp[sid] = PT_SEED_CP; n++;
    console.log('  pt starter cp ' + plog(sid) + ' = +' + PT_SEED_CP);
  }
  return n;
}
// Playtest board provisioning plan (pure -- executed by the PT bootstrap in main()).
// names = board names currently listed on the app; cfg carries the channel's board names.
// Returns { create: [{name, trusted}], forbidden: [present names that must NOT exist] }.
// The create set is the channel's whole surface: client-written record shards + the report/
// card/gate boards, and the trusted authority boards the channel DOES keep (xp/cp/endless).
// The forbidden set is lock layer 3: rating, points (incl. its per-season archives), redeem,
// grant and mirror boards must never exist on this app id -- their presence means someone
// provisioned an authority surface the channel promised not to have, so the run refuses.
function ptBoardPlan(names, cfg) {
  const have = new Set(names.map(String));
  const create = [];
  const add = (name, trusted) => { if (name && !have.has(name)) create.push({ name, trusted: trusted ? 1 : 0 }); };
  for (let i = 0; i < (cfg.shards | 0); i++) add(cfg.prefix + i, 0);   // client-written record shards
  add(cfg.xpLb, 1); add(cfg.cpLb, 1); add(cfg.endlessLb, 1); add(cfg.endlessTrioLb, 1);
  add(cfg.compLb, 1); add(cfg.saveBoxLb, 0);   // O93 solo competitive ladder (trusted) + guard-signed save rows (client-writable)
  add('version_gate', 1);   // authoritative-version gate (ops-written, client read-only)
  add('gate_window', 1);    // queue-gate forced window / emergency stop (ops-written, client read-only)
  add('pt_master', 1);      // playtest master switch: an active window closes the whole playtest
                            //   (clients fail-open: no entry / expired window = playtest open)
  add(cfg.trustLb, 1); add(cfg.reportLb, 0);
  add('card_box', 0);       // cosmetic claim rows (client-writable, zero authority)
  add(UNMATCHED_LB, 0);     // knife-7 host self-incrimination box (client-writable, record-only)
  const forbidden = [];
  for (const n0 of names) {
    const n = String(n0);
    if (cfg.rankedLb && n === cfg.rankedLb) forbidden.push(n);
    else if (cfg.lpLb && (n === cfg.lpLb || n.indexOf(cfg.lpLb + '_s') === 0)) forbidden.push(n);
    else if (n === cfg.redeemLb || n === cfg.grantLb || n === cfg.mirrorLb) forbidden.push(n);
  }
  return { create, forbidden };
}

async function main() {
  const missing = [];
  if (!KEY) missing.push('STEAM_PUBLISHER_KEY');
  if (!APPID) missing.push('APPID');
  if (!PREFIX) missing.push('LB_PREFIX');
  // the playtest channel has no rating/points surface at all -- those envs are only consulted
  // for the forbidden-board tripwire there (optional), never required.
  if (!RANKED_LB && !PT_MODE) missing.push('RANKED_LB');
  if (!LP_LB && !PT_MODE) missing.push('LP_LB');
  if (!SALT) missing.push('STATE_SALT');
  if (missing.length) { ghErr('missing env: ' + missing.join(', ')); process.exit(1); }
  RUN.t0 = Date.now();
  console.log('reconcile: start (concurrency ' + CONCURRENCY + ')');

  const lr = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (lr.status === 403) { ghErr('403 (key has no access)'); process.exit(1); }
  if (!lr.ok) { ghErr('GetLeaderboardsForGame HTTP ' + lr.status); process.exit(1); }
  // playtest bootstrap: provision the channel's own boards (idempotent -- find-or-create by
  // name is listing-lag immune) and enforce the forbidden set BEFORE anything settles. A
  // forbidden board present is a provisioning error severe enough to stop the whole run: the
  // channel's lock story is "the surface does not exist", not "the surface is unused".
  if (PT_MODE) {
    const ptNames = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).map(x => String(x.name || x.Name));
    const ptPlan = ptBoardPlan(ptNames, {
      prefix: PREFIX, shards: PT_SHARD_COUNT, xpLb: XP_LB, cpLb: CP_LB,
      endlessLb: ENDLESS_LB, endlessTrioLb: ENDLESS_LB_TRIO, trustLb: TRUST_LB, reportLb: REPORT_LB,
      compLb: ENDLESS_COMP_LB, saveBoxLb: SAVE_BOX_LB,
      rankedLb: RANKED_LB, lpLb: LP_LB, redeemLb: REDEEM_LB, grantLb: GRANT_LB, mirrorLb: PT_MIRROR_LB,
    });
    if (ptPlan.forbidden.length) { ghErr('playtest channel: forbidden board(s) exist on this app: ' + ptPlan.forbidden.join(', ') + ' -- refusing to run (lock layer 3)'); process.exit(1); }
    for (const b of ptPlan.create) {
      const id = await findOrCreateBoard(b.name, b.trusted);
      if (!id) { ghErr('playtest bootstrap: board create failed: ' + b.name); process.exit(1); }
      console.log('pt bootstrap: provisioned ' + b.name + (b.trusted ? ' (trusted)' : ' (client-writable)'));
    }
  }
  // seasonal points target (see SEASONS): resolved once per run; the previous season's board
  // (if any) is the lazy soft-reset source and is never created, only found.
  // Playtest channel: no points surface at all -- nothing resolved, nothing auto-created.
  const seasonId = seasonAt(seasonNowMs());
  const lpCur = PT_MODE ? { name: null, id: null } : await resolveSeasonBoard(lr, LP_LB, seasonId);
  const lpBoardId = lpCur.id;
  const prevLpLb = (!PT_MODE && seasonId >= 1)
    ? ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === seasonBoardName(LP_LB, seasonId - 1))
    : null;
  const prevLpId = prevLpLb ? (prevLpLb.id || prevLpLb.ID) : null;
  if (seasonId > 0 && !PT_MODE) console.log('season ' + seasonId + ': points -> ' + lpCur.name + (prevLpId ? (' (soft-reset source ' + seasonBoardName(LP_LB, seasonId - 1) + ')') : ' (no previous-season board)'));
  const ALLOW_TEST = process.env.ALLOW_TEST === '1';
  const shards = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).filter(x => { const n = String(x.name || x.Name); return n.indexOf(PREFIX) === 0 && (ALLOW_TEST || n.indexOf('test') < 0); });
  console.log('shards: ' + shards.length);

  const recs = [];
  // Read EVERY shard every run. The listing's per-board `entries` count is eventually
  // consistent with a lag of minutes-to-HOURS for fresh writes (and sticks stale for days
  // after deletes) -- gating shard reads on it left cold shards unsettled for hours: the
  // playtest channel's first real match (2026-08-21) sat on shards whose count still read
  // 0 while direct entry reads returned the records, so back-to-back runs logged
  // "records: 0" against live data. 50 paged reads cost single-digit seconds under the
  // worker pool; the count is not worth trusting for anything.
  const shardOut = await mapPool(shards, CONCURRENCY, async (s) => {
    const id = s.id || s.ID;
    const label = 's' + String(s.name || s.Name).replace(PREFIX, '');
    const { ents } = await readBoardAll(id, 'shard ' + label);   // paged; cap-hit is warned inside
    const out = [];
    for (const e of ents) {
      const d = decodeDetails(e.detailData);
      if (d[0] === 0xB1 && d.length >= 10) {
        const pc = d[8] | 0;
        const dispCode = (d.length > 10 + pc && pc >= 1) ? (d[10 + pc] | 0) : 0;
        const roster = decodeRoster(d);
        out.push({ steamID: e.steamID, shard: label, d, dispCode, disp: dispName(dispCode), roster });
      } else if (d[0] === START_MAGIC && d.length >= 10) {
        // start attestation: same layout with zeroed result fields -> roster decodes identically
        out.push({ start: true, steamID: e.steamID, shard: label, d, roster: decodeRoster(d) });
      } else if (d[0] === CONFESS_MAGIC && d.length >= 10) {
        // abandon confession: writer identity is the penalty target; disp slot at the v3 offset
        const pc = d[8] | 0;
        const dispCode = (d.length > 10 + pc && pc >= 1) ? (d[10 + pc] | 0) : 0;
        out.push({ confess: true, steamID: e.steamID, shard: label, m: d[3] + '_' + d[4] + '_' + d[2], mt: d[2] | 0, dispCode });
      }
    }
    return out;
  });
  const starts = [], confessions = [];
  for (const r of shardOut) {
    if (r.status === 'fulfilled') for (const rec of r.value) (rec.start ? starts : (rec.confess ? confessions : recs)).push(rec);
    else ghWarn('read shard failed: ' + (r.reason && r.reason.message || r.reason));
  }
  console.log('records: ' + recs.length + (starts.length ? ' (+' + starts.length + ' start attestations)' : '') + (confessions.length ? ' (+' + confessions.length + ' abandon confessions)' : ''));
  RUN.rec = recs.length; RUN.starts = starts.length;

  const MAX_SEATS = 8;
  // consistency vector: the per-seat score slice, plus (endless only) the 4-int depth tail --
  // all of it is host-broadcast lockstep fact, so every honest end must agree byte for byte.
  // A type-7 record without its tail is malformed by construction (every real writer appends it).
  const vecOf = r => {
    const pc = r.d[8] | 0;
    if (pc < 1 || pc > MAX_SEATS || r.d.length < 10 + pc) return 'BAD(pc=' + pc + ')';
    let v = r.d.slice(10, 10 + pc);
    if (isEndlessMt(r.d[2] | 0)) {
      const at = 11 + 3 * pc;
      if (r.d.length < at + 4) return 'BAD(tail)';
      // 5-int tail when present (seasonId is host-broadcast lockstep fact too); 4-int legacy records compare as before
      v = v.concat(r.d.slice(at, r.d.length >= at + 5 ? at + 5 : at + 4));
    }
    return JSON.stringify(v);
  };
  const groups = {};
  for (const r of recs) { const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2]; (groups[m] = groups[m] || []).push(r); }
  let consistent = 0, flagged = 0, lone = 0, soloN = 0;
  const consistentMatches = [], inconsistentGroups = [];
  for (const m of Object.keys(groups)) {
    const g = groups[m];
    // O93 solo competitive segment (pc=1 endless, guard-signed): one seat = no consensus lane. It enters
    //   the settle loop as its own entry; the loop verifies the signature + owner binding (soloSettle).
    if (g.length === 1 && isEndlessMt(g[0].d[2] | 0) && (g[0].d[8] | 0) === 1) {
      soloN++;
      consistentMatches.push({ m, g, void: false, solo: true });
      console.log('  match=' + m + ': solo segment ' + plog(g[0].steamID) + ' (attested; verified at settle)');
      continue;
    }
    const vecs = g.map(vecOf);
    let same = vecs.every(v => v === vecs[0] && v.indexOf('BAD') !== 0);
    // M3 (2026-07-19 audit): endless groups get a second chance under zero-tail abstention --
    // scores identical + non-zero tails identical + all-zero tails abstaining. The canonical
    // (non-zero-tail) record is rotated to g[0]: sanity's depth-scaled score cap, the settle's
    // endlessTail(g[0]) read and the board write all key off g[0] by convention.
    if (!same && g.length >= 2 && isEndlessMt(g[0].d[2] | 0)) {
      const ab = endlessAbstention(g, MAX_SEATS);
      if (ab.same) {
        same = true;
        if (ab.canonIdx > 0) { const c0 = g[ab.canonIdx]; g.splice(ab.canonIdx, 1); g.unshift(c0); }
        console.log('  match=' + m + ': endless zero-tail abstention -> canonical tail from ' + plog(g[0].steamID));
      }
    }
    if (g.length < 2) { lone++; console.log('  match=' + m + ': lone(' + g.length + ')'); }
    else if (same) {
      consistent++;
      const cons = voidByConsensus(g.map(r => r.dispCode));
      consistentMatches.push({ m, g, void: cons.isVoid });
      console.log('  match=' + m + ': ' + g.length + ' consistent ok disp=[' + g.map(r => r.disp).join(',') + ']'
        + (cons.isVoid ? ' -> consensus VOID, not settled (' + cons.voidVotes + '/' + cons.present + ')'
          : (cons.voidVotes ? ' (VOID votes ' + cons.voidVotes + '/' + cons.present + ' below majority -> settled)' : '')));
    }
    else { flagged++; inconsistentGroups.push({ m, g }); ghWarn('match=' + m + ': ' + g.length + ' inconsistent/invalid (suspected forgery): ' + g.map((r, i) => plog(r.steamID) + '@' + r.shard + '=' + vecs[i]).join('  ')); }
  }
  console.log('reconciled: ' + Object.keys(groups).length + ' (consistent ' + consistent + ' / lone ' + lone + ' / inconsistent ' + flagged + (soloN ? ' / solo ' + soloN : '') + ')');
  RUN.flagged = flagged;

  // start/settle cross-check runs BEFORE the early returns: the very scenario it exists for
  // (a match that started and was never settled by anyone) produces no consistent matches at all,
  // so it must still be tracked, judged and persisted on those paths.
  const processed = loadProcessed();
  const leavers = loadLeavers(); let leaverHits = 0;
  const startsPending = loadStarts();
  const confState = loadConfessions();   // loaded before starts so the orphan verdict can skip confessed keys
  const consistentKeys = new Set(consistentMatches.map(c => c.m));
  const nowMs = Date.now();
  const startsRes = reconcileStarts(starts, groups, consistentKeys, processed, startsPending, leavers, nowMs, STARTS_MATURITY_MS, confState);
  if (startsRes.registered || startsRes.convicted || startsRes.cleaned || Object.keys(startsPending).length)
    console.log('starts: ' + Object.keys(startsPending).length + ' pending (+' + startsRes.registered + ' new), ' + startsRes.convicted + ' exit-rate hits, ' + startsRes.cleaned + ' cleaned');
  RUN.pending = Object.keys(startsPending).length; RUN.convicted = startsRes.convicted;
  // interrupted-match consolation: the matured-orphan verdict just identified survivors who stayed
  // to the forced settle of a match nobody could ever settle (lone records). Pay the flat credit
  // inline (same pre-early-return pattern as the confession LP writes -- the everyone-left scenario
  // produces no consistent settle groups, so the main XP pipeline never runs on this path). The
  // write preserves the entry's existing details verbatim (career 0xCA payload must survive).
  // One-shot by design (rides the processed gate); a failed write is logged and forfeited.
  let consoledN = 0;
  if (startsRes.consoledSids && startsRes.consoledSids.length && XP_LB) {
    const xpLb0 = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === XP_LB);
    const xpId0 = xpLb0 ? (xpLb0.id || xpLb0.ID) : null;
    if (!xpId0) ghWarn('xp board absent (consolation path) -> ' + startsRes.consoledSids.length + ' credits forfeited');
    else for (const sid of startsRes.consoledSids) {
      try {
        const e = await readUserEntry(xpId0, sid, 'xp');
        const next = (e ? (e.score | 0) : 0) + CONSOLATION_XP;
        const det = e ? decodeDetails(e.detailData) : null;
        if (!APPLY_MMR) { console.log('  (dry-run) consolation xp ' + plog(sid) + ' = ' + next); consoledN++; continue; }
        const r = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: xpId0, steamid: sid, score: next, scoremethod: 'ForceUpdate', format: 'json' }, (det && det.length) ? det : null);
        if (r.ok && !(r.json && r.json.result && r.json.result.result && r.json.result.result !== 1)) { consoledN++; console.log('  consolation xp ' + plog(sid) + ' +' + CONSOLATION_XP + ' -> ' + next); }
        else ghWarn('consolation xp write failed for ' + plog(sid));
      } catch (err) { ghWarn('consolation xp error for ' + plog(sid) + ': ' + (err && err.message)); }
    }
  } else if (startsRes.consoledSids && startsRes.consoledSids.length && !XP_LB) {
    console.log('  consolation: XP_LB unset -> ' + startsRes.consoledSids.length + ' credits skipped');
  }
  RUN.consoled = consoledN;
  // abandon confessions: immediate authoritative leaver penalty without finisher consensus.
  // Runs before the early returns (the everyone-left scenario produces no settle groups at all).
  let confRes = { seen: 0, penalized: 0, exitHits: 0, refunded: 0, finalized: 0 };
  if (confessions.length || Object.keys(confState).length) {
    const lpId0 = lpBoardId;   // season-resolved (see top of main)
    // playtest: no points surface by design -- confessions still record exit-rate signals, the
    // LP deduction half is structurally absent (readLp/writeLp run with a null board id).
    if (!lpId0 && !PT_MODE) strictBoard('points board absent (confession path)');
    const skill0 = loadSkill();   // read-only here (first-ranked leaver seeding base)
    confRes = await reconcileConfessions(confessions, groups, processed, confState, leavers, nowMs, {
      penalty: LEAVER_LP_PENALTY, lpMax: LP_MAX, maturityMs: STARTS_MATURITY_MS,
      appliesLpFn: appliesLp,
      consistentKeys,   // absolution probe only trusts consistent settle groups (a lone/divergent 0xB1 cancels nothing)
      seedFor: (sid) => { const sk = skill0[pid(sid)] || ts.DEFAULTS; return seedLp(ts.displayRating(sk.mu, sk.sigma)); },
      readLp: lpId0 ? (async (sid) => {
        const e = await readUserEntry(lpId0, sid, 'points');
        if (e) return { score: e.score | 0, details: decodeDetails(e.detailData) };
        // lazy season-seed parity with the settle path: absent from the current season board ->
        // a previous-season entry soft-resets into the penalty base; none -> null (seedFor applies).
        if (prevLpId) {
          const pe = await readUserEntry(prevLpId, sid, 'prev points');
          if (pe) return { score: softResetLp(pe.score | 0), details: null };
        }
        return null;
      }) : null,
      writeLp: async (sid, score, details) => {
        if (!APPLY_MMR) { console.log('  (dry-run) confession pts ' + plog(sid) + ' = ' + score); return true; }
        // preserve an unread mismatch reveal exactly like the settle-path points write does
        const detailsArr = (details && details.length >= 6 && (details[0] & 0xff) === RS_MAGIC) ? details.slice(0, 6) : null;
        const r = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: lpId0, steamid: sid, score, scoremethod: 'ForceUpdate', format: 'json' }, detailsArr);
        return r.ok && !(r.json && r.json.result && r.json.result.result && r.json.result.result !== 1);
      },
    });
    if (confRes.seen || confRes.refunded || confRes.finalized)
      console.log('confessions: ' + confRes.seen + ' seen, ' + confRes.penalized + ' penalized, ' + confRes.exitHits + ' exit-rate hits, ' + confRes.refunded + ' refunded, ' + confRes.finalized + ' finalized');
  }
  RUN.confess = confRes.seen + '/' + confRes.penalized + '/' + confRes.refunded;
  // B6 signal collection state + forgery-flag counters for the inconsistent groups seen this run
  // (they are never processed, so they re-surface every run -- recordFlag dedups by match key).
  const signals = loadSignals();
  let sigDirty = false;
  // trust-tier candidates seen this run (real sids; signals stay HMAC-keyed -- the only
  // place real ids persist is the trust board itself, which is the public artifact anyway)
  const trustTouched = new Set();
  for (const { m, g } of inconsistentGroups) {
    if (recordFlag(signals, g, m, nowMs)) sigDirty = true;
    for (const r of g) trustTouched.add(String(r.steamID));
  }
  // player reports: harvest the client-written report box into directional edges (record-only).
  // Runs before the no-consistent-matches early returns -- reports arrive with or without settles.
  const repLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === REPORT_LB);
  if (repLb && (repLb.entries | 0) > 0) {
    try {
      const rb = await readBoardAll(repLb.id || repLb.ID, 'report box');
      const rres = harvestReports(rb.ents.map(e => ({ steamID: e.steamID, d: decodeDetails(e.detailData) })), signals, nowMs);
      RUN.repSeen = rres.seen; RUN.repCounted = rres.counted;
      if (rres.seen || rres.bad) {
        if (rres.counted) sigDirty = true;
        for (const t of rres.targets) trustTouched.add(t);
        console.log('reports: ' + rres.seen + ' new (' + rres.counted + ' counted, ' + rres.capped + ' over daily cap, ' + rres.bad + ' malformed) of ' + rb.ents.length + ' entries');
      }
    } catch (e) { ghWarn('report box read failed: ' + (e && e.message)); }
  } else if (!repLb) {
    strictBoard('report board absent');
    console.log('report board absent (pre-create ' + REPORT_LB + ', client-writable) -- skip');
  }
  // knife-7: unmatched confession box -- the host guard's self-incriminating "I silently dropped
  //   joiner events" rows. RECORD-ONLY: this NEVER touches settlement (the two hard rules are in
  //   attest.reconcileUnmatched -- the signal accuses ONLY the writer/host, never the joiner seats
  //   in the payload, and it is a review signal, not a verdict). Wrapped so a read failure can't
  //   affect the settle path. Correlate by matchHash (== record d[3]); host = roster seat 0.
  const umLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === UNMATCHED_LB);
  if (umLb && (umLb.entries | 0) > 0) {
    try {
      const ub = await readBoardAll(umLb.id || umLb.ID, 'unmatched box');
      const matchIndex = new Map();
      for (const r of recs) {
        const roster = decodeRoster(r.d);
        const host = roster && (roster[0] != null ? roster[0] : roster['0']);
        if (host) matchIndex.set(r.d[3] >>> 0, { hostSid: host });
      }
      const umState = loadUnmatched();
      const collected = [];
      const ures = attest.reconcileUnmatched(
        ub.ents.map(e => ({ steamID: e.steamID, details: decodeDetails(e.detailData) })),
        { matchIndex, state: umState, now: nowMs, pid, onSignal: (s) => collected.push(s) }
      );
      attest.pruneUnmatchedState(umState, nowMs);
      saveUnmatched(umState);
      RUN.umSeen = ures.seen; RUN.umFresh = ures.fresh; RUN.umCorrob = ures.corroborated;
      if (ures.fresh) {
        console.log('unmatched: ' + ures.fresh + ' fresh host-drop signals (' + ures.corroborated + ' corroborated, ' +
          ures.orphan + ' orphan) of ' + ub.ents.length + ' rows [record-only, never settles]');
        for (const s of collected) console.log('  unmatched-signal host=' + String(s.subject).slice(0, 8) +
          ' match=' + (s.matchHash >>> 0).toString(16) + ' total=' + s.total + ' pc=' + s.pc + ' weight=' + s.weight);
      }
    } catch (e) { ghWarn('unmatched box read failed: ' + (e && e.message)); }
  } else if (!umLb) {
    console.log('unmatched box absent (pre-create ' + UNMATCHED_LB + ', client-writable) -- skip');
  }
  // trust board upkeep: recompute tiers for touched players + everyone currently ON the
  // board (decay/deletion). Runs on every exit path (reports/flags arrive with or without
  // settles). Board absent -> logged skip (code can ship before the board exists).
  const maintainTrust = async () => {
    const tLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === TRUST_LB);
    if (!tLb) { strictBoard('trust board absent'); console.log('trust board absent (pre-create ' + TRUST_LB + ', trusted-writes) -- skip'); return; }
    try {
      // Always read (never trust the list's entry-count metadata: it lags behind writes --
      // a stale 0 would skip the read and silently starve decay-deletes for the run).
      const existing = {};
      const tb = await readBoardAll(tLb.id || tLb.ID, 'trust board');
      for (const e of tb.ents) existing[String(e.steamID)] = e.score | 0;
      const plan = trustPlan(signals, existing, trustTouched, nowMs);
      RUN.trustW = plan.writes.length; RUN.trustD = plan.deletes.length;
      if (!plan.writes.length && !plan.deletes.length) return;
      console.log('trust: ' + plan.writes.length + ' tier writes [' + plan.writes.map(w => plog(w.sid) + '=' + w.tier).join(' ') + '], ' +
                  plan.deletes.length + ' decayed deletes [' + plan.deletes.map(plog).join(' ') + ']');
      if (!APPLY_MMR) { console.log('trust: dry-run, board untouched'); return; }
      const tId = tLb.id || tLb.ID;
      for (const w of plan.writes) {
        const r = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: tId, steamid: w.sid, score: w.tier, scoremethod: 'ForceUpdate', format: 'json' });
        if (!r.ok) ghWarn('trust write failed ' + plog(w.sid) + ': HTTP ' + r.status);
      }
      for (const sid of plan.deletes) {
        const r = await postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: tId, steamid: sid, format: 'json' });
        if (!r.ok) ghWarn('trust delete failed ' + plog(sid) + ': HTTP ' + r.status);
      }
    } catch (e) { ghWarn('trust board upkeep failed: ' + (e && e.message)); }
  };
  const persistStartsSide = () => {
    if (!APPLY_MMR) { console.log('APPLY_MMR=0 dry-run, nothing written'); return; }
    saveStarts(startsPending);
    saveConfessions(confState, nowMs);
    if (sigDirty) saveSignals(signals, nowMs);
    if (startsRes.convicted || confRes.exitHits || confRes.refunded) { saveLeavers(leavers); }
    if (startsRes.convicted) { saveProcessed(processed); }
  };
  // ladder-floor gate for gated catalog items: met on THIS season's ladder, else on any
  // archived season ladder (found-only -- never creates archives; a soft-reset can park a
  // qualifying player below the floor, the archive keeps his proof).
  const ladderGateOk = async (sid, minLp) => {
    try {
      if (lpBoardId) {
        const e = await readUserEntry(lpBoardId, sid, 'ladder gate');
        if (e && (e.score | 0) >= minLp) return true;
      }
      for (let s = seasonId - 1; s >= 0; s--) {
        const alb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === seasonBoardName(LP_LB, s));
        if (!alb) continue;
        const e = await readUserEntry(alb.id || alb.ID, sid, 'ladder gate s' + s);
        if (e && (e.score | 0) >= minLp) return true;
      }
    } catch (e) { ghWarn('ladder gate read failed ' + plog(sid) + ': ' + (e && e.message)); }
    return false;
  };
  // redeem channel: settle client want-bitmaps into wallet debits + entitlement bits. Runs on
  // every exit path (wants arrive with or without settles, same rationale as reports/trust).
  // cpVals = in-memory post-settle balances on the main path (fresh -- avoids the read-lag on
  // just-written scores); null on the settle-free paths -> targeted reads per claimant.
  const processRedeems = async (cpVals) => {
    // playtest channel: the redeem/entitlement surface does not exist (lock layer 3) and this
    // resolver would otherwise CREATE its boards via find-or-create -- hard-disabled first.
    if (PT_MODE) return;
    const list = (lr.json && lr.json.response && lr.json.response.leaderboards) || [];
    // Freshly created boards lag the listing for a long time -> resolve by name via
    // find-or-create (idempotent: same name always returns the same id) so this phase can
    // never soft-skip (or STRICT-fail) on listing lag alone.
    const resolveBoxBoard = async (name, trustedFlag) => {
      const found = list.find(x => String(x.name || x.Name) === name);
      if (found) return found.id || found.ID;
      const res = await postForm('/ISteamLeaderboards/FindOrCreateLeaderboard/v2/', {
        key: KEY, appid: APPID, name, sortmethod: 'Descending', displaytype: 'Numeric',
        createifnotfound: 1, onlytrustedwrites: trustedFlag ? 1 : 0, onlyfriendsreads: 0, format: 'json',
      });
      const lb = (res.json && res.json.result && res.json.result.leaderboard) || (res.json && res.json.leaderboard) || null;
      const id = lb && (lb.leaderBoardID || lb.leaderboardID || lb.id || lb.ID);
      if (res.ok && id) { console.log('box board resolved via find-or-create: ' + name + ' id=' + id); return id; }
      return null;
    };
    const rdId0 = await resolveBoxBoard(REDEEM_LB, false);
    const gtId0 = await resolveBoxBoard(GRANT_LB, true);
    if (!rdId0 || !gtId0) {
      strictBoard('redeem/grant board absent');
      console.log('redeem boards absent (pre-create ' + REDEEM_LB + ' client-writable + ' + GRANT_LB + ' trusted) -- skip');
      return;
    }
    const rdLb = { id: rdId0 }, gtLb = { id: gtId0 };
    const cpLbF = list.find(x => String(x.name || x.Name) === CP_LB);
    const cpIdF = cpLbF ? (cpLbF.id || cpLbF.ID) : null;
    if (!cpIdF) { strictBoard('wallet board absent (redeem path)'); console.log('wallet board absent -- redeem skip'); return; }
    try {
      // Always read (trust-board lesson: the listing's entry-count metadata lags -- a stale 0
      // would starve fresh wants for the run).
      const rb = await readBoardAll(rdLb.id || rdLb.ID, 'redeem box');
      const wants = rb.ents
        .map(e => ({ sid: String(e.steamID), want: decodeRedeemWant(decodeDetails(e.detailData)) }))
        .filter(x => x.want && ((x.want[0] | 0) !== 0 || (x.want[1] | 0) !== 0));
      if (!wants.length) return;
      const gb = await readBoardAll(gtLb.id || gtLb.ID, 'grant box');
      const grantedBy = {};
      for (const e of gb.ents) {
        const m = decodeGrantMask(decodeDetails(e.detailData));
        if (m) grantedBy[String(e.steamID)] = m;
      }
      let nBits = 0, nPlayers = 0;
      for (const w of wants) {
        const granted = grantedBy[w.sid] || [0, 0];
        let anyNew = false;
        for (let bit = 0; bit < GRANT_WORDS * 32; bit++) {
          if (grantBit(w.want, bit) && !grantBit(granted, bit) && REDEEM_CATALOG[bit]) { anyNew = true; break; }
        }
        if (!anyNew) continue;
        let bal;
        if (cpVals && cpVals[w.sid] != null) bal = cpVals[w.sid] | 0;
        else { const e = await readUserEntry(cpIdF, w.sid, 'wallet'); bal = e ? (e.score | 0) : 0; }
        const gateOkByBit = {};
        for (const bitStr of Object.keys(REDEEM_CATALOG)) {
          const bit = bitStr | 0, it = REDEEM_CATALOG[bit];
          if (!it.gateLp || !grantBit(w.want, bit) || grantBit(granted, bit)) continue;
          gateOkByBit[bit] = await ladderGateOk(w.sid, it.gateLp | 0);
        }
        const plan = redeemPlan(w.want, granted, bal, gateOkByBit);
        if (!plan.bits.length) { console.log('  redeem ' + plog(w.sid) + ': wants pending, nothing grantable (funds/gate)'); continue; }
        if (!APPLY_MMR) { console.log('  redeem ' + plog(w.sid) + ': dry-run, would grant bits [' + plan.bits.join(' ') + '] debit -' + (bal - plan.balance)); continue; }
        const newMask = granted.slice();
        while (newMask.length < GRANT_WORDS) newMask.push(0);
        for (const b of plan.bits) setGrantBit(newMask, b);
        const det = [(GRANT_MAGIC | (GRANT_VER << 8)) | 0, Math.floor(nowMs / 60000) | 0, newMask[0] | 0, newMask[1] | 0];
        const gw = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: gtLb.id || gtLb.ID, steamid: w.sid, score: popcountWords(newMask), scoremethod: 'ForceUpdate', format: 'json' }, det);
        const gOk = gw.ok && !(gw.json && gw.json.result && gw.json.result.result && gw.json.result.result !== 1);
        if (!gOk) { ghWarn('grant write failed ' + plog(w.sid) + ': HTTP ' + gw.status + ' (deferred, no debit)'); continue; }
        grantedBy[w.sid] = newMask;
        nBits += plan.bits.length; nPlayers++;
        const dw = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: cpIdF, steamid: w.sid, score: plan.balance, scoremethod: 'ForceUpdate', format: 'json' });
        const dOk = dw.ok && !(dw.json && dw.json.result && dw.json.result.result && dw.json.result.result !== 1);
        if (!dOk) ghWarn('wallet debit failed ' + plog(w.sid) + ': HTTP ' + dw.status + ' (bits granted -- one-shot undercharge, cannot loop)');
        else if (cpVals) cpVals[w.sid] = plan.balance;
        console.log('  redeem ' + plog(w.sid) + ': granted bits [' + plan.bits.join(' ') + '] debit -' + (bal - plan.balance) + ' -> ' + plan.balance + (dOk ? '' : ' (debit failed)'));
      }
      if (nPlayers) { RUN.redeems = nPlayers + 'p/' + nBits + 'b'; console.log('redeems: ' + nBits + ' bits across ' + nPlayers + ' players'); }
    } catch (e) { ghWarn('redeem channel failed: ' + (e && e.message)); }
  };
  // O159 knife-7d: campaign clear attestation -> exclusive cosmetics. The guard sidecar wrote a signed record
  //   (campaign.js layout) to CAMPAIGN_LB; verify (registered build key, owner binding, internal tier proof)
  //   and OR the grant bits (6 banner / 5 title) into grant_box. Idempotent (bits already set -> skip); no
  //   wallet debit (not a purchase). Runs on every exit path like redeems. playtest: the campaign is not
  //   shipped there (lock layer) -> hard-disabled so this never creates boards on that appid.
  const processCampaignGrants = async () => {
    if (PT_MODE) return;
    const list = (lr.json && lr.json.response && lr.json.response.leaderboards) || [];
    const byName = (name) => { const f = list.find(x => String(x.name || x.Name) === name); return f ? (f.id || f.ID) : null; };
    try {
      let cbId = byName(CAMPAIGN_LB);
      if (!cbId) cbId = await findOrCreateBoard(CAMPAIGN_LB, false);   // client-writable (guard writes as the user)
      const gtId = byName(GRANT_LB) || await findOrCreateBoard(GRANT_LB, true);
      if (!cbId || !gtId) { console.log('campaign/grant board absent -- skip'); return; }
      const cb = await readBoardAll(cbId, 'campaign box');
      if (!cb.ents.length) return;
      const pubTable = attest.loadPubTable(require('path').join(__dirname, 'attest-keys.json')) || {};
      const allowDevKey = /_test$/.test(CAMPAIGN_LB);
      const gb = await readBoardAll(gtId, 'grant box');
      const grantedBy = {};
      for (const e of gb.ents) { const m = decodeGrantMask(decodeDetails(e.detailData)); if (m) grantedBy[String(e.steamID)] = m; }
      let nBits = 0, nPlayers = 0, nPend = 0, nRej = 0;
      for (const e of cb.ents) {
        const sid = String(e.steamID);
        const v = campaign.verifyCampaignRecord(decodeDetails(e.detailData), pubTable);
        const plan = campaign.campaignGrantPlan(v, { owner: sid, allowDevKey });
        if (!plan.bits.length) { if (plan.pending) nPend++; else { nRej++; console.log('  campaign ' + plog(sid) + ': rejected (' + plan.reason + ')'); } continue; }
        const granted = grantedBy[sid] || [0, 0];
        const newBits = plan.bits.filter(b => !grantBit(granted, b));
        if (!newBits.length) continue;
        if (!APPLY_MMR) { console.log('  campaign ' + plog(sid) + ': dry-run, would grant bits [' + newBits.join(' ') + ']'); continue; }
        const newMask = granted.slice();
        while (newMask.length < GRANT_WORDS) newMask.push(0);
        for (const b of newBits) setGrantBit(newMask, b);
        const det = [(GRANT_MAGIC | (GRANT_VER << 8)) | 0, Math.floor(nowMs / 60000) | 0, newMask[0] | 0, newMask[1] | 0];
        const gw = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: gtId, steamid: sid, score: popcountWords(newMask), scoremethod: 'ForceUpdate', format: 'json' }, det);
        const gOk = gw.ok && !(gw.json && gw.json.result && gw.json.result.result && gw.json.result.result !== 1);
        if (!gOk) { ghWarn('campaign grant write failed ' + plog(sid) + ': HTTP ' + gw.status + ' (deferred)'); continue; }
        grantedBy[sid] = newMask;
        nBits += newBits.length; nPlayers++;
        console.log('  campaign ' + plog(sid) + ': granted bits [' + newBits.join(' ') + '] tier=' + v.fields.tierBits + ' lastU=' + v.fields.lastU + ' credited=' + v.fields.credited + ' key=' + v.fields.keyName);
      }
      if (nPlayers || nPend || nRej) { RUN.campaign = nPlayers + 'p/' + nBits + 'b' + (nPend ? '/' + nPend + 'pend' : '') + (nRej ? '/' + nRej + 'rej' : ''); console.log('campaign grants: ' + nBits + ' bits across ' + nPlayers + ' players (pending ' + nPend + ', rejected ' + nRej + ')'); }
    } catch (e) { ghWarn('campaign channel failed: ' + (e && e.message)); }
  };
  // Supporter pack (supporters.js header): probe DLC ownership for known players (capped per run, cached in
  //   state), then reconcile the wall board (respecting the client-writable opt-out board), OR the grant bit
  //   and return the set of owner sids for this run's points credit. Every write is idempotent; failures are
  //   warned and retried next tick. Playtest: the DLC belongs to the main app -> hard-disabled there.
  //   xpMap = the already-read xp board (sid -> points) or null (early-exit paths read it here: the wall
  //   must not wait for a fresh match on a quiet day). extraSids = this run's record writers/rosters.
  const processSupporters = async (xpMap, extraSids) => {
    const spSet = new Set();
    if (PT_MODE) return spSet;
    const S = supporters.SUPPORTER;
    if (!S.DLC_APPID) { if (!processSupporters._warned) { processSupporters._warned = true; console.log('supporters: SUPPORTER_DLC_APPID unset -> channel off'); } return spSet; }
    try {
      const st = loadSupporters();
      const list = (lr.json && lr.json.response && lr.json.response.leaderboards) || [];
      const byName = (name) => { const f = list.find(x => String(x.name || x.Name) === name); return f ? (f.id || f.ID) : null; };
      // candidate sids: everyone on the points board (= ever finished a game) + this run's writers
      let known = xpMap;
      if (!known) {
        const xpId0 = XP_LB ? byName(XP_LB) : null;
        known = {};
        if (xpId0) { const br = await readBoardAll(xpId0, 'xp board (supporters)'); for (const e of br.ents) known[e.steamID] = 1; }
      }
      const cands = Object.keys(known).concat((extraSids || []).map(String));
      const plan = supporters.checkPlan(st, cands, pid, nowMs);
      let nOwn = 0, nProbe = plan.length, nFail = 0;
      if (plan.length) {
        const res = await mapPool(plan, 8, async (sid) => {
          const r = await getJson(BASE + '/ISteamUser/CheckAppOwnership/v2/?key=' + KEY + '&steamid=' + sid + '&appid=' + S.DLC_APPID + '&format=json');
          if (!r.ok || !r.json) throw new Error('HTTP ' + r.status);
          return supporters.ownsFromResponse(r.json, sid);
        });
        res.forEach((o, i) => { if (o.status === 'fulfilled') supporters.applyProbe(st, pid(plan[i]), o.value, nowMs); else nFail++; });
      }
      // owner set for this run (points bonus) -- any candidate whose state says owner
      const owners = [];
      for (const sid of new Set(cands)) { const e = st[pid(sid)]; if (e && e.o) { spSet.add(String(sid)); owners.push(sid); } }
      nOwn = owners.length;
      if (owners.length) {
        const wallId = byName(SUPPORTER_WALL_LB) || await findOrCreateBoard(SUPPORTER_WALL_LB, true);
        const optId = byName(SUPPORTER_OPTOUT_LB) || await findOrCreateBoard(SUPPORTER_OPTOUT_LB, false);
        const gtId = byName(GRANT_LB) || await findOrCreateBoard(GRANT_LB, true);
        const optOut = new Set();
        if (optId) { const ob = await readBoardAll(optId, 'supporter opt-out'); for (const e of ob.ents) if ((e.score | 0) === 1) optOut.add(String(e.steamID)); }
        const grantedBy = {};
        if (gtId) { const gb = await readBoardAll(gtId, 'grant box'); for (const e of gb.ents) { const m = decodeGrantMask(decodeDetails(e.detailData)); if (m) grantedBy[String(e.steamID)] = m; } }
        let nWall = 0, nDel = 0, nGrant = 0;
        for (const sid of owners) {
          const e = st[pid(sid)];
          const act = supporters.wallAction(e, optOut.has(String(sid)));
          if (wallId && act && APPLY_MMR) {
            if (act === 'write') {
              const w = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: wallId, steamid: sid, score: supporters.wallScore(e.f), scoremethod: 'ForceUpdate', format: 'json' });
              const okW = w.ok && !(w.json && w.json.result && w.json.result.result && w.json.result.result !== 1);
              if (okW) { e.w = 1; e.x = 0; nWall++; } else ghWarn('supporter wall write failed ' + plog(sid) + ': HTTP ' + w.status);
            } else {
              const d = await postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: wallId, steamid: sid, format: 'json' });
              if (d.ok) { e.w = 0; e.x = 1; nDel++; } else ghWarn('supporter wall delete failed ' + plog(sid) + ': HTTP ' + d.status);
            }
          }
          if (gtId && APPLY_MMR) {
            const granted = grantedBy[String(sid)] || [0, 0];
            if (!grantBit(granted, S.GRANT_BIT)) {
              const newMask = granted.slice();
              while (newMask.length < GRANT_WORDS) newMask.push(0);
              setGrantBit(newMask, S.GRANT_BIT);
              const det = [(GRANT_MAGIC | (GRANT_VER << 8)) | 0, Math.floor(nowMs / 60000) | 0, newMask[0] | 0, newMask[1] | 0];
              const gw = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: gtId, steamid: sid, score: popcountWords(newMask), scoremethod: 'ForceUpdate', format: 'json' }, det);
              const gOk = gw.ok && !(gw.json && gw.json.result && gw.json.result.result && gw.json.result.result !== 1);
              if (gOk) { grantedBy[String(sid)] = newMask; nGrant++; } else ghWarn('supporter grant write failed ' + plog(sid) + ': HTTP ' + gw.status + ' (deferred)');
            }
          }
        }
        console.log('supporters: owners ' + nOwn + ' (probed ' + nProbe + ', failed ' + nFail + ') wall +' + nWall + ' -' + nDel + ' grant +' + nGrant + (APPLY_MMR ? '' : ' [dry-run]'));
        RUN.supporters = nOwn + 'o/' + nProbe + 'p' + (nWall ? '/+' + nWall + 'w' : '') + (nDel ? '/-' + nDel + 'w' : '') + (nGrant ? '/+' + nGrant + 'g' : '');
      } else if (nProbe) {
        console.log('supporters: probed ' + nProbe + ' (failed ' + nFail + '), owners 0');
        RUN.supporters = '0o/' + nProbe + 'p';
      }
      saveSupporters(st);
    } catch (e) { ghWarn('supporter channel failed: ' + (e && e.message)); }
    return spSet;
  };

  RUN.consistent = consistentMatches.length;
  if (consistentMatches.length === 0) { console.log('no consistent matches'); persistStartsSide(); await maintainTrust(); await processRedeems(null); await processCampaignGrants(); await processSupporters(null, []); writeRunSummary(); return; }
  const fresh = consistentMatches.filter(c => !processed.has(c.m));
  RUN.fresh = fresh.length;
  console.log(consistentMatches.length + ' consistent, ' + fresh.length + ' fresh (settled ' + (consistentMatches.length - fresh.length) + ')');
  if (fresh.length === 0) { console.log('no fresh matches, skip'); persistStartsSide(); await maintainTrust(); await processRedeems(null); await processCampaignGrants(); await processSupporters(null, []); writeRunSummary(); return; }

  // playtest channel: no rating board exists (and must not -- lock layer 3); the TrueSkill
  // update block below is skipped wholesale, so the id is never consulted.
  const rankedLb = PT_MODE ? null : ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === RANKED_LB);
  if (!rankedLb && !PT_MODE) { ghErr('rating board not found (must be pre-created)'); process.exit(1); }
  const rankedId = rankedLb ? (rankedLb.id || rankedLb.ID) : null;
  const skill = loadSkill();
  const groupMem = loadGroups(); let groupsDirty = false;   // repeat-group decay memory (see GROUP_DECAY)
  const lpId = lpBoardId;   // season-resolved once at the top of main (auto-created from season 1 on)
  if (!lpId && !PT_MODE) { strictBoard('points board not found'); ghWarn('points board not found (pre-create with onlytrustedwrites) -> skip points this run'); }
  const lp = {}, lpDet = {};   // lpDet = existing detail bytes per player, so an unread reveal survives a later normal-match LP update
  let lpComplete = true;
  if (lpId) {
    const br = await readBoardAll(lpId, 'points board');
    lpComplete = br.complete;
    for (const e of br.ents) { lp[e.steamID] = e.score | 0; lpDet[e.steamID] = decodeDetails(e.detailData); }
  }
  // XP ladder is optional: skip the whole XP path (no board, no state) if XP_LB is unset or the board is missing.
  const xpLb = XP_LB ? ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === XP_LB) : null;
  const xpId = xpLb ? (xpLb.id || xpLb.ID) : null;
  if (XP_LB && !xpId) { strictBoard('xp board not found'); ghWarn('xp board not found (pre-create with onlytrustedwrites) -> skip xp this run'); }
  const xp = {};
  let xpComplete = true;
  if (xpId) {
    const br = await readBoardAll(xpId, 'xp board');
    xpComplete = br.complete;
    for (const e of br.ents) xp[e.steamID] = e.score | 0;
  }
  const xpState = xpId ? loadXp() : {};
  // supporter pack owners for this run's points credit (probe + wall + grant bit happen here too)
  const spSids = [];
  for (const c of fresh) for (const r of c.g) { spSids.push(String(r.steamID)); for (const rs of Object.values(r.roster || {})) if (rs) spSids.push(String(rs)); }   // roster = {seat: sid} (decodeRoster)
  const spSet = await processSupporters(xp, spSids);
  // CP wallet + endless depth board (both optional like XP: absent = warn-skip locally, hard
  // fail under STRICT_BOARDS in CI). The endless settle branch refuses to settle while either is
  // missing -- settling without the debit would let read-back resurrect spent CP.
  const cpLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === CP_LB);
  const cpId = cpLb ? (cpLb.id || cpLb.ID) : null;
  if (!cpId) { strictBoard('cp board not found'); ghWarn('cp board not found (pre-create ' + CP_LB + ', trusted-writes) -> skip cp this run'); }
  const cp = {};
  let cpComplete = true;
  if (cpId) {
    const br = await readBoardAll(cpId, 'cp board');
    cpComplete = br.complete;
    for (const e of br.ents) cp[e.steamID] = e.score | 0;
  }
  const enLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === ENDLESS_LB);
  const enId = enLb ? (enLb.id || enLb.ID) : null;
  if (!enId) { strictBoard('endless board not found'); ghWarn('endless board not found (pre-create ' + ENDLESS_LB + ', trusted-writes) -> skip endless this run'); }
  const endlessBest = {};   // sid -> packed personal best (also the chain-rule memory)
  let enComplete = true;
  if (enId) {
    const br = await readBoardAll(enId, 'endless board');
    enComplete = br.complete;
    for (const e of br.ents) endlessBest[e.steamID] = e.score | 0;
  }
  // seasonal endless board (season >= 1): per-season depth ladder, double-written next to the
  // lifetime board. The LIFETIME board stays the chain memory and pacing anchor and never resets.
  const enSeason = seasonId >= 1 ? await resolveSeasonBoard(lr, ENDLESS_LB, seasonId) : { name: null, id: null };
  const enSeasonId = enSeason.id;
  if (seasonId >= 1 && enId && !enSeasonId) { strictBoard('seasonal endless board not found'); ghWarn('seasonal endless board unresolved -> endless groups left pending'); }
  const endlessSeasonBest = {};
  let enSeasonComplete = true;
  if (enSeasonId) {
    const br = await readBoardAll(enSeasonId, 'seasonal endless board');
    enSeasonComplete = br.complete;
    for (const e of br.ents) endlessSeasonBest[e.steamID] = e.score | 0;
  }
  // trio endless board (knife-C 2026-08-13: board exists in production). The board is brand
  // new, so the listing can hide it for over an hour -- fall back to FindOrCreate by name
  // (idempotent, listing-lag immune; season boards use the same bypass). Strict stays as the
  // belt for the fallback's own HTTP failure -- a missing board leaves trio groups pending
  // either way, strict just makes it loud.
  const enTrioLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === ENDLESS_LB_TRIO);
  let enTrioId = enTrioLb ? (enTrioLb.id || enTrioLb.ID) : null;
  if (!enTrioId) enTrioId = await findOrCreateBoard(ENDLESS_LB_TRIO);
  if (!enTrioId) { strictBoard('trio endless board not found'); ghWarn('trio endless board not found (pre-create ' + ENDLESS_LB_TRIO + ', trusted-writes) -> trio endless groups left pending'); }
  const endlessTrioBest = {};
  let enTrioComplete = true;
  if (enTrioId) {
    const br = await readBoardAll(enTrioId, 'trio endless board');
    enTrioComplete = br.complete;
    for (const e of br.ents) endlessTrioBest[e.steamID] = e.score | 0;
  }
  const enTrioSeason = (seasonId >= 1 && enTrioId) ? await resolveSeasonBoard(lr, ENDLESS_LB_TRIO, seasonId) : { name: null, id: null };
  const enTrioSeasonId = enTrioSeason.id;
  if (seasonId >= 1 && enTrioId && !enTrioSeasonId) { strictBoard('seasonal trio endless board not found'); ghWarn('seasonal trio endless board unresolved -> trio endless groups left pending'); }
  const endlessTrioSeasonBest = {};
  let enTrioSeasonComplete = true;
  if (enTrioSeasonId) {
    const br = await readBoardAll(enTrioSeasonId, 'seasonal trio endless board');
    enTrioSeasonComplete = br.complete;
    for (const e of br.ents) endlessTrioSeasonBest[e.steamID] = e.score | 0;
  }

  // O93 solo competitive ladder (knife 3.3a): lifetime + seasonal (trusted) and the client-writable save
  //   box (guard-signed rows; the cron only prunes past-season rows). Find-or-create like the trio ladder.
  const lbListAll = (lr.json && lr.json.response && lr.json.response.leaderboards) || [];
  const byNameLb = (name) => { const f = lbListAll.find(x => String(x.name || x.Name) === name); return f ? (f.id || f.ID) : null; };
  let compId = byNameLb(ENDLESS_COMP_LB);
  if (!compId) compId = await findOrCreateBoard(ENDLESS_COMP_LB, true);
  if (!compId) { strictBoard('solo comp board not found'); ghWarn('solo comp board not found (' + ENDLESS_COMP_LB + ') -> solo segments left pending'); }
  const compBest = {};
  if (compId) { const br = await readBoardAll(compId, 'solo comp board'); for (const e of br.ents) compBest[e.steamID] = e.score | 0; }
  const compSeason = (seasonId >= 1 && compId) ? await resolveSeasonBoard(lr, ENDLESS_COMP_LB, seasonId) : { name: null, id: null };
  const compSeasonId = compSeason.id;
  if (seasonId >= 1 && compId && !compSeasonId) { strictBoard('seasonal solo comp board not found'); ghWarn('seasonal solo comp board unresolved -> solo segments left pending'); }
  const compSeasonBest = {};
  if (compSeasonId) { const br = await readBoardAll(compSeasonId, 'seasonal solo comp board'); for (const e of br.ents) compSeasonBest[e.steamID] = e.score | 0; }
  let saveBoxId = byNameLb(SAVE_BOX_LB);
  if (!saveBoxId) saveBoxId = await findOrCreateBoard(SAVE_BOX_LB, false);
  if (!saveBoxId) ghWarn('save box board not found (' + SAVE_BOX_LB + ', client-writable) -> guard saves fail until it exists');

  fresh.sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
  // On-demand base values: when a bulk read hit PAGE_CAP the maps are incomplete -- a settling
  // player missing from them may still hold an entry beyond the window, and settling from base 0
  // would silently reset his LP/XP. Fetch exactly the players this run settles (record holders +
  // roster members: leaver LP penalty targets roster sids that wrote no record). A missing entry
  // after the targeted read is a genuine new player (base 0 correct).
  if ((lpId && !lpComplete) || (xpId && !xpComplete) || (cpId && !cpComplete) || (enId && !enComplete) || (enSeasonId && !enSeasonComplete) || (enTrioId && !enTrioComplete) || (enTrioSeasonId && !enTrioSeasonComplete)) {
    const need = new Set();
    for (const c of fresh) for (const r of c.g) {
      need.add(String(r.steamID));
      for (const sid of Object.values(r.roster || {})) need.add(String(sid));
    }
    const fetched = await mapPool([...need], CONCURRENCY, async (sid) => {
      if (lpId && !lpComplete && lp[sid] == null) {
        const e = await readUserEntry(lpId, sid, 'points');
        if (e) { lp[sid] = e.score | 0; lpDet[sid] = decodeDetails(e.detailData); }
      }
      if (xpId && !xpComplete && xp[sid] == null) {
        const e = await readUserEntry(xpId, sid, 'xp');
        if (e) xp[sid] = e.score | 0;
      }
      if (cpId && !cpComplete && cp[sid] == null) {
        const e = await readUserEntry(cpId, sid, 'cp');
        if (e) cp[sid] = e.score | 0;
      }
      if (enId && !enComplete && endlessBest[sid] == null) {
        const e = await readUserEntry(enId, sid, 'endless');
        if (e) endlessBest[sid] = e.score | 0;
      }
      if (enSeasonId && !enSeasonComplete && endlessSeasonBest[sid] == null) {
        const e = await readUserEntry(enSeasonId, sid, 'seasonal endless');
        if (e) endlessSeasonBest[sid] = e.score | 0;
      }
      if (enTrioId && !enTrioComplete && endlessTrioBest[sid] == null) {
        const e = await readUserEntry(enTrioId, sid, 'trio endless');
        if (e) endlessTrioBest[sid] = e.score | 0;
      }
      if (enTrioSeasonId && !enTrioSeasonComplete && endlessTrioSeasonBest[sid] == null) {
        const e = await readUserEntry(enTrioSeasonId, sid, 'seasonal trio endless');
        if (e) endlessTrioSeasonBest[sid] = e.score | 0;
      }
    });
    const failed = fetched.filter(x => x.status === 'rejected');
    if (failed.length) { ghErr('on-demand base reads failed (' + failed.length + '/' + need.size + ') -- abort run, do NOT settle from base 0'); process.exit(1); }
    console.log('on-demand base reads: ' + need.size + ' players (bulk window incomplete)');
  }
  const today = Math.floor(Date.now() / 86400000);   // UTC day index (matches client lastWinDay) for the daily-first bonus
  const changed = {}; const changedLp = {}; const changedXp = {}; const changedCp = {}; const changedEndless = {}; const changedEndlessSeason = {}; const changedEndlessTrio = {}; const changedEndlessTrioSeason = {}; const reveal = {}; const careerDet = {}; let settled = 0, voided = 0, settledEndless = 0, settledPrivate = 0, settledSolo = 0;
  const changedComp = {}, changedCompSeason = {};   // O93 solo competitive ladder write pools
  const seedcap = (SEEDCAP_ENFORCE || SEEDCAP_REJECT) ? loadSeedcap() : null;   // O124 knife-9
  // reject-window discard (see the SEEDCAP_REJECT block below): every per-account output the
  // settle loop can produce, captured before the group settles and put back afterwards. The
  // list is the complete set of per-sid write pools + in-memory state the write phase reads;
  // a new per-player output added to the loop must be added here too (test pins the names).
  const scCloneOf = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const scSnapshotOf = (sid) => {
    const p = pid(sid);
    return { sid, skill: scCloneOf(skill[p]), xpState: scCloneOf(xpState[p]),
      lp: lp[sid], xp: xp[sid], cp: cp[sid],
      endlessBest: endlessBest[sid], endlessSeasonBest: endlessSeasonBest[sid],
      endlessTrioBest: endlessTrioBest[sid], endlessTrioSeasonBest: endlessTrioSeasonBest[sid],
      changed: changed[sid], changedLp: changedLp[sid], changedXp: changedXp[sid], changedCp: changedCp[sid],
      changedEndless: changedEndless[sid], changedEndlessSeason: changedEndlessSeason[sid],
      changedEndlessTrio: changedEndlessTrio[sid], changedEndlessTrioSeason: changedEndlessTrioSeason[sid],
      compBest: compBest[sid], compSeasonBest: compSeasonBest[sid], changedComp: changedComp[sid], changedCompSeason: changedCompSeason[sid],   // O93 solo ladder pools
      careerDet: careerDet[sid], reveal: reveal[sid] };
  };
  const scPut = (map, key, val) => { if (val === undefined) delete map[key]; else map[key] = val; };
  const scRestore = (pend) => {
    for (const sn of pend.snaps) {
      const p = pid(sn.sid);
      scPut(skill, p, sn.skill); scPut(xpState, p, sn.xpState);
      scPut(lp, sn.sid, sn.lp); scPut(xp, sn.sid, sn.xp); scPut(cp, sn.sid, sn.cp);
      scPut(endlessBest, sn.sid, sn.endlessBest); scPut(endlessSeasonBest, sn.sid, sn.endlessSeasonBest);
      scPut(endlessTrioBest, sn.sid, sn.endlessTrioBest); scPut(endlessTrioSeasonBest, sn.sid, sn.endlessTrioSeasonBest);
      scPut(changed, sn.sid, sn.changed); scPut(changedLp, sn.sid, sn.changedLp); scPut(changedXp, sn.sid, sn.changedXp); scPut(changedCp, sn.sid, sn.changedCp);
      scPut(changedEndless, sn.sid, sn.changedEndless); scPut(changedEndlessSeason, sn.sid, sn.changedEndlessSeason);
      scPut(changedEndlessTrio, sn.sid, sn.changedEndlessTrio); scPut(changedEndlessTrioSeason, sn.sid, sn.changedEndlessTrioSeason);
      scPut(compBest, sn.sid, sn.compBest); scPut(compSeasonBest, sn.sid, sn.compSeasonBest); scPut(changedComp, sn.sid, sn.changedComp); scPut(changedCompSeason, sn.sid, sn.changedCompSeason);
      scPut(careerDet, sn.sid, sn.careerDet); scPut(reveal, sn.sid, sn.reveal);
      console.log('  seedcap reject ' + pend.m + ': ' + plog(sn.sid) + ' settlement discarded (state restored)');
    }
  };
  let scPendingRestore = null;
  // ===== O93 solo competitive segment settle (COMP block above) =====
  const soloState = loadSolo();
  const soloPub = attest.loadPubTable(require('path').join(__dirname, 'attest-keys.json')) || {};
  const soloAllowDev = /_test$/.test(ENDLESS_COMP_LB);   // dev-key records only ever land on a *_test ladder
  const soloSettle = async (c) => {
    const r = c.g[0], sid = String(r.steamID), p = pid(sid), m = c.m;
    const v = attest.verifySoloRecord(r.d, soloPub);
    const gate = attest.soloSettleGate(v, { owner: sid, allowDevKey: soloAllowDev });
    if (!gate.settle) {
      if (gate.pending) { console.log('  solo ' + m + ': ' + plog(sid) + ' pending (' + gate.reason + ')'); return false; }
      recordFlag(signals, c.g, m, nowMs); sigDirty = true; trustTouched.add(sid);
      RUN.soloRej = (RUN.soloRej | 0) + 1;
      ghWarn('match=' + m + ': solo segment ' + plog(sid) + ' REJECTED (' + gate.reason + ') -- not settled');
      processed.add(m);   // a bad signature / foreign owner never heals
      return false;
    }
    const f = v.fields;
    const sane = soloSanity(f);
    if (sane.length) {
      recordFlag(signals, c.g, m, nowMs); sigDirty = true; trustTouched.add(sid); RUN.sanity = (RUN.sanity | 0) + 1;
      ghWarn('match=' + m + ': solo segment sanity-flagged [' + sane.join(',') + '] ' + plog(sid) + ' -- not settled');
      return false;
    }
    if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[m]) {
      recordFlag(signals, c.g, m, nowMs); sigDirty = true; RUN.seedcapVeto = (RUN.seedcapVeto | 0) + 1;
      ghWarn('match=' + m + ': solo segment seedcap over-cap veto -- not settled');
      return false;
    }
    if (SEEDCAP_REJECT && seedcap && seedcap.suspects && seedcapRejectActive(seedcap.suspects[p], Math.floor(nowMs / 60000))) {
      RUN.seedcapReject = (RUN.seedcapReject | 0) + 1;
      ghWarn('match=' + m + ': solo segment ' + plog(sid) + ' inside seedcap reject window -- own settlement discarded');
      processed.add(m);
      return false;
    }
    if (!cpId || !compId || (seasonId >= 1 && !compSeasonId)) { console.log('  solo ' + m + ': cp/comp/seasonal board unresolved -- left pending'); return false; }
    const key = soloRunKey(p, f.seasonId, f.runSeed);
    const plan = soloChainPlan(soloState, key, f, m, nowMs);
    if (plan.ok === null) { console.log('  solo ' + m + ': ' + plog(sid) + ' depth ' + f.startDepth + '->' + f.endDepth + ' waiting for its chain (' + plan.reason + ')'); return false; }
    if (plan.ok === false) {
      RUN.soloRej = (RUN.soloRej | 0) + 1;
      ghWarn('match=' + m + ': solo segment ' + plog(sid) + ' chain REJECT (' + plan.reason + ') depth ' + f.startDepth + '->' + f.endDepth);
      processed.add(m);
      return false;
    }
    // pacing: the segment's own start attestation (single guard attester) or its first sighting
    let pend = startsPending[m];
    if (!pend) { pend = startsPending[m] = { t0: nowMs, mt: r.d[2] | 0, roster: {}, settled: [], synth: true }; sigPlayer(signals, p, nowMs).ns += 1; sigDirty = true; }
    const reqMs = endlessRequiredMs({ startDepth: f.startDepth, endDepth: f.endDepth }, plan.proven);
    if (nowMs - (pend.t0 || 0) < reqMs) {
      console.log('  solo-pacing ' + m + ': depth ' + f.startDepth + '->' + f.endDepth + ' (proven ' + plan.proven + ') needs ' + Math.round(reqMs / 1000) + 's real time, seen ' + Math.round((nowMs - (pend.t0 || 0)) / 1000) + 's -- deferred');
      return false;
    }
    // ---- settle ----
    const day = sigDay(signals, nowMs); day.n[p] = (day.n[p] || 0) + 1;
    recordEndlessSignals(signals, [sid], nowMs); sigDirty = true;
    if (PT_MODE) ptSeedCp(cp, changedCp, [sid]);
    const run = soloAdvance(soloState, key, f, m, plan, nowMs);
    if (plan.consume) {
      cp[sid] = (cp[sid] == null ? 0 : cp[sid]) - COMP.RESUME_CP; changedCp[sid] = cp[sid];
      console.log('  solo cp ' + m + ': ' + plog(sid) + ' -' + COMP.RESUME_CP + ' resume (save@' + plan.consume + ') -> ' + cp[sid]);
    }
    for (const ms of soloMilestones(run, f.endDepth)) {
      cp[sid] = (cp[sid] == null ? 0 : cp[sid]) + ms[1]; changedCp[sid] = cp[sid];
      console.log('  solo cp ' + m + ': ' + plog(sid) + ' +' + ms[1] + ' milestone depth ' + ms[0] + ' -> ' + cp[sid]);
    }
    if ((f.endDepth | 0) > 0) {
      const packed = packEndlessScore(f.endDepth, f.score);
      if (compBest[sid] == null || packed > compBest[sid]) { compBest[sid] = packed; changedComp[sid] = { s: packed, ts: f.score | 0 }; console.log('  solo best ' + m + ': ' + plog(sid) + ' depth ' + f.endDepth + ' bank ' + f.score + ' -> board ' + packed); }
      if (compSeasonId && (f.seasonId | 0) === (seasonId | 0) && (compSeasonBest[sid] == null || packed > compSeasonBest[sid])) { compSeasonBest[sid] = packed; changedCompSeason[sid] = { s: packed, ts: f.score | 0 }; console.log('  solo season best ' + m + ': ' + plog(sid) + ' depth ' + f.endDepth + ' -> board ' + packed); }
    }
    if (xpId) creditXpEndless(c.g, { startDepth: f.startDepth, endDepth: f.endDepth }, xp, changedXp, spSet);
    console.log('  solo settle ' + m + ': ' + plog(sid) + ' depth ' + f.startDepth + '->' + f.endDepth + ' bank ' + f.score + ' flags ' + f.flags + ((f.dispCode | 0) === attest.DISP_USER_QUIT ? ' (quit)' : '') + ' key=' + f.keyName + (v.sealed ? '' : ' [dev]'));
    processed.add(m);
    return true;
  };
  for (const c of fresh) {
    if (scPendingRestore) { scRestore(scPendingRestore); scPendingRestore = null; }
    if (c.solo) { if (await soloSettle(c)) settledSolo++; continue; }
    const g = c.g;
    const matchType = g[0].d[2] | 0;   // 2=ranked; visible LP only moves for ranked (quick = MMR only)
    // sanity gate (B5 tier A): a consistent-but-impossible match is flagged, not settled, and NOT
    // marked processed (self-heals if a bound is later loosened). Runs before XP/VOID so garbage
    // never feeds any ledger output or signal stats beyond the flag counter itself.
    const sane = sanityFlags(g);
    if (sane.length) {
      recordFlag(signals, g, c.m, nowMs); sigDirty = true;
      for (const r of g) trustTouched.add(String(r.steamID));   // trust-tier candidates
      RUN.sanity = (RUN.sanity | 0) + 1;
      ghWarn('match=' + c.m + ': sanity-flagged [' + sane.join(',') + '] -- not settled: ' + g.map(r => plog(r.steamID) + '@' + r.shard).join(' '));
      continue;
    }
    const writerSids = [...new Set(g.map(r => String(r.steamID)))];
    // O124 seedcap veto (knife-9): the seed-replay auditor proved the AGREED score vector
    // exceeds this seed's mathematical cap (causal impossibility, every uncertain branch
    // maxed) -> same flag-don't-settle shape as sanityFlags: not settled, not processed,
    // self-heals if the auditor ever clears a false positive.
    if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[c.m]) {
      recordFlag(signals, g, c.m, nowMs); sigDirty = true;
      RUN.seedcapVeto = (RUN.seedcapVeto | 0) + 1;
      ghWarn('match=' + c.m + ': seedcap over-cap veto (seats ' + ((seedcap.veto[c.m].seats || []).join(',') || '?') + ') -- not settled');
      continue;
    }
    // O124 suspect refusal (optional lever, default off), window form (2026-09-05): a writer
    // whose reject window is still open gets its OWN settlement discarded -- the group settles
    // for everyone else exactly as usual (rank order, TrueSkill inputs, XP, CP, boards), then
    // the flagged account's state is restored to its pre-match snapshot before anything is
    // written (scPendingRestore, applied at the top of the next iteration / after the loop).
    // Roster-only suspects (no record = leaver) are not touched: they earn nothing here anyway
    // and their penalties must stand. Nothing is deferred: the match is processed.
    if (SEEDCAP_REJECT && seedcap && seedcap.suspects) {
      const nowMin = Math.floor(nowMs / 60000);
      const dropSids = writerSids.filter(sid => seedcapRejectActive(seedcap.suspects[pid(sid)], nowMin));
      if (dropSids.length) {
        scPendingRestore = { m: c.m, sids: dropSids, snaps: dropSids.map(scSnapshotOf) };
        RUN.seedcapReject = (RUN.seedcapReject | 0) + dropSids.length;
        for (const sid of dropSids) {
          const su = seedcap.suspects[pid(sid)];
          const left = seedcapRejectUntilMin(su) - nowMin;
          ghWarn('match=' + c.m + ': seedcap suspect ' + plog(sid) + ' inside reject window (n=' + (su.n | 0) + ', ' + Math.ceil(left / 60) + 'h left) -- own settlement discarded, other seats settle');
        }
      }
    }
    // ===== endless (type 7): own settle authority -- depth board + CP debit, nothing else. =====
    // TrueSkill/XP/LP/leaver conviction never see a type-7 group (PvE track, zero career
    // spillover -- mirrors the client's own isolation). Sits before the generic pacing gate:
    // endless uses its depth-scaled bound instead of the flat matchmade minimum.
    if (isEndlessMt(matchType)) {
      // knife-B (2026-08-13): 2 or 3 seats. Trio runs rank on their own ladder (3 diggers
      // structurally outscore 2 -- a mixed board would be dominated), so every board-shaped
      // dependency (gate / chain memory read / best map / write pool) picks the pc-matched pair.
      const pc7 = g[0].d[8] | 0;                 // sanity pinned to 2..3 above
      const useTrio = pc7 >= 3;
      const bId = useTrio ? enTrioId : enId;
      const bSeasonId = useTrio ? enTrioSeasonId : enSeasonId;
      const bBest = useTrio ? endlessTrioBest : endlessBest;
      const bSeasonBest = useTrio ? endlessTrioSeasonBest : endlessSeasonBest;
      const bChanged = useTrio ? changedEndlessTrio : changedEndless;
      const bSeasonChanged = useTrio ? changedEndlessTrioSeason : changedEndlessSeason;
      // boards are the debit target AND the chain memory -- without both, settling would mark
      // the group processed while silently dropping the debit (read-back would resurrect spent
      // CP). Leave the group fresh; it settles whole once the boards resolve.
      if (!cpId || !bId || (seasonId >= 1 && !bSeasonId)) { console.log('  endless ' + c.m + ': cp/' + (useTrio ? 'trio' : 'endless') + '/seasonal board unresolved -- left pending'); continue; }
      const t = endlessTail(g[0].d);   // presence + domains guaranteed by the sanity gate above
      const roster0 = rosterConsensus(g);
      const rosterSids = Object.values(roster0).map(String);
      // chain rule: startDepth credit only up to the deepest end depth any roster player has
      // settled ON THIS LADDER. Client saves are per-seat-count slots (knife-C) -- a resume
      // never crosses seat counts, so the chain memory is per-board (knife-B's cross-ladder
      // max is retired with the mixed-resume semantics it served; legacy mixed resumes only
      // pace slower, never flag).
      let chainMax = 0;
      for (const sid of rosterSids) {
        if (bBest[sid] != null) chainMax = Math.max(chainMax, unpackEndlessScore(bBest[sid]).depth);
      }
      let pend7 = startsPending[c.m];
      if (!pend7) {
        // no attestation ever sighted (job outage / failed client write): the settle's own first
        // sighting starts the clock -- identical wall-time cost for a fabricator (an attestation
        // is free to write), mercy for the legit edge. Recorded as an ns signal like elsewhere.
        pend7 = startsPending[c.m] = { t0: nowMs, mt: matchType, roster: {}, settled: [], synth: true };
        for (const sid of writerSids) sigPlayer(signals, pid(sid), nowMs).ns += 1;
        sigDirty = true;
      }
      const reqMs = endlessRequiredMs(t, chainMax);
      if (nowMs - (pend7.t0 || 0) < reqMs) {
        console.log('  endless-pacing ' + c.m + ': depth ' + t.startDepth + '->' + t.endDepth + ' (chain ' + chainMax + ') needs ' + Math.round(reqMs / 1000) + 's real time, seen ' + Math.round((nowMs - (pend7.t0 || 0)) / 1000) + 's -- deferred');
        continue;
      }
      const day7 = sigDay(signals, nowMs);
      for (const sid of writerSids) day7.n[pid(sid)] = (day7.n[pid(sid)] || 0) + 1;
      recordEndlessSignals(signals, rosterSids.length ? rosterSids : writerSids, nowMs);
      sigDirty = true;
      // playtest starter wallet: seed BEFORE the debit replay so a first run with continues
      // debits from the starter baseline, not into synthetic debt. Roster included: a debit
      // targets consensus-roster seats whether or not they wrote a record.
      if (PT_MODE) ptSeedCp(cp, changedCp, [...new Set(rosterSids.concat(writerSids))]);
      // CP debit per seat (canonical nibble replay). Targets the consensus ROSTER -- writing no
      // record does not dodge a debit both ends witnessed. Debt is kept (no clamp): clamping
      // would forgive a forged continue, and a legit balance can only dip negative transiently
      // when the funding matchmade record settles a run later.
      const debits = endlessDebits(t.continuesUsed);
      for (let seat = 0; seat < pc7; seat++) {
        const sid = roster0[seat] != null ? String(roster0[seat]) : null;
        if (!sid || !debits[seat]) continue;
        const cur = cp[sid] == null ? 0 : cp[sid];
        cp[sid] = cur - debits[seat]; changedCp[sid] = cp[sid];
        console.log('  endless cp ' + c.m + ': seat ' + seat + ' ' + plog(sid) + ' -' + debits[seat] + ' (' + endlessNib(t.continuesUsed, seat) + ' continues) -> ' + cp[sid]);
      }
      // personal-best board write for RECORD WRITERS only (abandoning the run earns no credit);
      // packed key is lex-monotone in (depth, team score), so "greater = improved" suffices.
      let teamScore = 0;
      for (let i = 0; i < pc7; i++) teamScore += g[0].d[10 + i] | 0;
      if ((t.endDepth | 0) > 0) {
        const packed = packEndlessScore(t.endDepth, teamScore);
        for (const sid of writerSids) {
          if (bBest[sid] == null || packed > bBest[sid]) {
            bBest[sid] = packed; bChanged[sid] = { s: packed, ts: teamScore };
            console.log('  endless best' + (useTrio ? ' (trio)' : '') + ' ' + c.m + ': ' + plog(sid) + ' depth ' + t.endDepth + ' team ' + teamScore + ' -> board ' + packed);
          }
          // seasonal double-write: same improved-best rule against the season board's own base
          // (fresh each season = the per-season "dig it again" ladder).
          if (bSeasonId && (bSeasonBest[sid] == null || packed > bSeasonBest[sid])) {
            bSeasonBest[sid] = packed; bSeasonChanged[sid] = { s: packed, ts: teamScore };
            console.log('  endless season best' + (useTrio ? ' (trio)' : '') + ' ' + c.m + ': ' + plog(sid) + ' depth ' + t.endDepth + ' -> board ' + packed);
          }
        }
      }
      // progress XP (2026-09-05): writers only, depth gain of THIS session; the pacing gate above already
      //   made the claimed gain cost real time, so the rate is bounded without a day cap.
      if (xpId) creditXpEndless(g, t, xp, changedXp, spSet);
      console.log('  endless settle ' + c.m + ': pc ' + pc7 + ' depth ' + t.startDepth + '->' + t.endDepth + ' team ' + teamScore + (c.void ? ' (void disp majority -- settled anyway: co-op has no outcome to void)' : ''));
      processed.add(c.m); settledEndless++;
      continue;
    }
    // pacing gate (replaces the removed per-day cap -- short queue times make any per-day
    // number guessable-wrong): a match cannot settle before it could physically have been
    // PLAYED. Not a flag, not suspicion -- just "come back when the time has actually passed";
    // legit matches arrive already-aged, so this defers at most one run in edge timing.
    const pend = startsPending[c.m];
    if (pacingDefer(pend, nowMs, SANITY.MIN_START_AGE_MS)) {
      console.log('  pacing ' + c.m + ': start attested ' + Math.round((nowMs - (pend.t0 || 0)) / 1000) + 's ago < ' + Math.round(SANITY.MIN_START_AGE_MS / 1000) + 's -- deferred');
      continue;
    }
    // per-UTC-day settle counts are recorded as a pure SIGNAL (no gate): the future judgment
    // layer marks "suspiciously many matches per day" against real-traffic baselines. VOID
    // matches count too -- they still credit innocent-participation XP.
    const day = sigDay(signals, nowMs);
    for (const sid of writerSids) day.n[pid(sid)] = (day.n[pid(sid)] || 0) + 1;
    sigDirty = true;
    const seatToId = {};
    for (const r of g) seatToId[r.d[5] | 0] = r.steamID;
    const pc = g[0].d[8] | 0, scores = g[0].d.slice(10, 10 + pc);
    const parts = [];
    for (let seat = 0; seat < pc; seat++) { if (seatToId[seat] != null) parts.push({ steamID: seatToId[seat], seat, score: scores[seat] | 0 }); }
    const sorted = [...parts].sort((a, b) => b.score - a.score);
    let rank = 1; const rankOf = {};
    for (let i = 0; i < sorted.length; i++) { if (i > 0 && sorted[i].score < sorted[i - 1].score) rank = i + 1; sorted[i].rank = rank; rankOf[sorted[i].steamID] = rank; }
    // team modes: overwrite with the team-convention ranks BEFORE XP/TrueSkill so both consume the
    // same ordering the client showed optimistically (winning pair {1,2}); mode 1 falls back to raw
    // score order when a seat is missing (teamRankOf returns null). Mode 2 (base 5/6) derives the
    // winner from the writers' rank claims, never money (sanity already rejected any conflict, so
    // t2Win is non-null on every group that reaches here).
    const t2Win = isSubScoreMt(matchType) ? team2WinTeamOf(g) : null;
    if (isTeamMt(matchType)) {
      const tr = isSubScoreMt(matchType) ? team2RankOf(parts, t2Win, teamSizeOfMt(matchType)) : teamRankOf(parts);
      if (tr) { for (const p of parts) rankOf[p.steamID] = tr[p.steamID]; for (const s of sorted) s.rank = tr[s.steamID]; }
    }
    // ===== O140 private friend rooms (type 10): XP-only settle, then done. =====
    // Placed AFTER the rank derivation (the XP-lite formula consumes rankOf) and BEFORE every
    // competitive surface: creditXp/creditCp/B6 recordMatchSignals/TrueSkill/LP/leaver loop
    // are all skipped by construction (the endless-branch pattern, narrower still).
    // Time-as-work: private DOES write start attestations (reconcileStarts exempts type 10
    // from conviction, keeps t0); a missing/failed attestation falls back to the settle's own
    // first sighting (synth pend -- identical wall-time cost for a fabricator, endless family).
    // The generic MIN_START_AGE pacing gate above already deferred us past the 5-min floor;
    // here the requirement scales with the claimed level count (a 9-level room waits longer).
    // Known benign skew: a private group deferred HERE (not by the generic gate) recounts the
    // day.n signal next run -- advisory signal only, at most one extra tick for lv>8 rooms.
    if (isPrivateMt(matchType)) {
      let pendP = startsPending[c.m];
      if (!pendP) {
        pendP = startsPending[c.m] = { t0: nowMs, mt: matchType, roster: {}, settled: [], synth: true };
        for (const sid of writerSids) sigPlayer(signals, pid(sid), nowMs).ns += 1;
        sigDirty = true;
      }
      const lvP = privateProgressOf(g) || PRIVATE_XP.defaultLevels;
      const reqMsP = Math.max(SANITY.MIN_START_AGE_MS, lvP * PRIVATE_XP.LEVEL_SECONDS * 1000 * PRIVATE_XP.PACE_FRAC);
      if (nowMs - (pendP.t0 || 0) < reqMsP) {
        console.log('  private-pacing ' + c.m + ': lv ' + lvP + ' needs ' + Math.round(reqMsP / 1000) + 's real time, seen ' + Math.round((nowMs - (pendP.t0 || 0)) / 1000) + 's -- deferred');
        continue;
      }
      if (xpId) creditXpPrivate(g, rankOf, lvP, xp, changedXp, xpState, today, spSet);
      console.log('  private settle ' + c.m + ': ' + g.length + ' writers, lv ' + lvP + (c.void ? ' (void majority -- XP by class only, nothing else to void)' : ''));
      processed.add(c.m); settledPrivate++;
      continue;
    }
    // points are credited for BOTH settled AND consensus-VOID matches -- VOID only gates MMR/LP; an innocent victim
    //   still earns participation points (mirrors the client crediting innocent records). per-record class-driven.
    //   Early-settled matches (everyone else left) award progress/levelCount of the points (min-of-writers, see matchProgressOf).
    const prog = matchProgressOf(g);
    const progFrac = xpProgressFrac(prog);
    if (progFrac !== 1) console.log('  progress ' + c.m + ': ' + prog + '/' + XP_CFG.progressLevels + ' levels -> points x' + progFrac);
    if (xpId) creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today, progFrac, careerDet, spSet);
    // CP (the endless-economy wallet) earns from matchmade records on the same credit classes.
    // Playtest starter wallet first: writers only (a leaver whose first-ever appearance is the
    // leave itself earns the baseline on their first finished game instead).
    if (PT_MODE && cpId) ptSeedCp(cp, changedCp, writerSids);
    if (cpId) creditCp(g, matchType, rankOf, cp, changedCp);
    if (c.void) {
      recordMatchSignals(signals, g, parts, null, matchType, true, nowMs); sigDirty = true;   // co-presence + void counters (dodge-ring history)
      console.log('  VOID ' + c.m + ': consensus -> no MMR/points'); processed.add(c.m); voided++; continue;
    }
    if (parts.length < 2) { processed.add(c.m); continue; }
    // B6 collection for a real settle: per-player counters + pairwise co-occurrence.
    recordMatchSignals(signals, g, parts, rankOf, matchType, false, nowMs);
    // settled with no start attestation ever sighted: legit for pre-attestation builds, so it is
    // a recorded signal (per-writer ns counter), not a flag -- once every live build attests,
    // a high ns rate becomes a cheap fabrication tell for the judgment layer.
    if (!pend) for (const sid of writerSids) sigPlayer(signals, pid(sid), nowMs).ns += 1;
    const leavers0 = detectLeavers(g);   // consensus-absent seats: LP penalty below + §7 teammate shield input
    // ===== playtest channel: no rating/points surface (lock layer 3) -- the TrueSkill update,
    // placement seeding, group-decay memory and every points write are skipped wholesale, so
    // skill.json/groups.json stay untouched and the changed/changedLp pools stay empty. The
    // leaver loop below still runs (exit-rate is a channel-neutral signal); its LP half
    // self-gates on the absent points board. =====
    if (!PT_MODE) {
      const tsIn = parts.map(p => { const sk = skill[pid(p.steamID)] || ts.DEFAULTS; return { id: p.steamID, rank: rankOf[p.steamID], mu: sk.mu, sigma: sk.sigma }; });
      // placement seeding: first ranked settle -> seed the lp map itself (recorded in changedLp so a
      //   bare seed persists), so the plan below, the settle write and the leaver penalty all read one
      //   consistent base. Leavers seed too (their first ranked appearance may be the leave itself --
      //   the -100 then applies to the seeded base, not to 0).
      // seed-settle exemption: players seeded THIS settle skip the promotion/relegation series clamp below -- the seed
      //   already lands their LP at the display-derived position, and applying crossline in the same
      //   settle could force a boundary crossing on a player's very first ranked game (silent demote/
      //   promote before placement has calibrated). Mirrors client results.js (_firstRankedBefore gate);
      //   lp==null before seeding == the client's !lpSeeded flag (2026-07-19 audit L3: the client gate
      //   moved off rankedGamesPlayed===0 -- a VOID first match now seeds NEITHER end, keeping the
      //   crossline skip aligned settle for settle), so both ends skip the same settle.
      const seededNow = new Set();
      if (lpId && appliesLp(matchType)) {
        // lazy season seed (first settle this season): previous-season entry soft-resets in, else
        // display-derived placement seed (seasonSeedLp priority). A prev-board read FAILURE aborts
        // the run -- seeding blind would silently discard last season's finish (same "never settle
        // from base 0" discipline as the on-demand reads). Absent entry = null = legit fallback.
        const seedOne = async (sid, mu, sigma, tag) => {
          let prevE = null;
          if (prevLpId) {
            try { prevE = await readUserEntry(prevLpId, sid, 'prev points'); }
            catch (err) { ghErr('prev-season base read failed for ' + plog(sid) + ' -- abort run, do NOT seed blind: ' + (err && err.message)); process.exit(1); }
          }
          const disp = ts.displayRating(mu, sigma);
          lp[sid] = seasonSeedLp(prevE ? (prevE.score | 0) : null, disp);
          changedLp[sid] = lp[sid]; seededNow.add(sid);
          console.log('  seed ' + c.m + ': ' + plog(sid) + ' ' + tag +
            (prevE ? (', soft-reset from ' + (prevE.score | 0)) : (', display ' + disp)) + ' -> pts ' + lp[sid]);
        };
        for (const t of tsIn) if (lp[t.id] == null) await seedOne(t.id, t.mu, t.sigma, 'first settle this season');
        for (const x of leavers0) {
          if (lp[x.steamID] == null) {
            const sk = skill[pid(x.steamID)] || ts.DEFAULTS;
            await seedOne(x.steamID, sk.mu, sk.sigma, 'leaver, first settle this season');
          }
        }
      }
      // repeat-group decay: advance streak memory for the WHOLE consensus roster (writers + leavers)
      //   and fetch each rated player's update weight. Applied to the TrueSkill delta below;
      //   points/XP/CP untouched (real play is not zero-sum -- only rating farming is sealed).
      const gPlan = groupDecayPlan(groupMem,
        parts.map(p => pid(p.steamID)).concat(leavers0.map(x => pid(x.steamID))), nowMs);
      groupsDirty = true;
      let tsOut;
      if (isTeamMt(matchType)) {
        // M3: team modes rate as TWO TEAMS (strength = sum mu, binary outcome) -- the ordinal pairwise
        // update would also transfer rating between TEAMMATES (rank 1 vs rank 2), which team play must not.
        // Mode 2: the binary outcome comes from the sub-score-derived winner, never the money sums.
        // money fallback only ever fires for mode 1 (3/4, always 4 seats) -- sub-score codes
        // (5/6/8/9) carry a sanity-guaranteed non-null t2Win, so the 2+2 sum stays correct.
        const winTeam = (t2Win != null) ? t2Win
          : (((scores[2] | 0) + (scores[3] | 0)) > ((scores[0] | 0) + (scores[1] | 0)) ? 1 : 0);
        const sides = [[], []];
        const _mts = teamSizeOfMt(matchType);
        for (let i = 0; i < parts.length; i++) sides[teamOfSeat(parts[i].seat, _mts)].push(tsIn[i]);
        tsOut = (sides[0].length && sides[1].length)
          ? ts.updateTeamMatch([{ players: sides[winTeam], rank: 1 }, { players: sides[1 - winTeam], rank: 2 }])
          : ts.updateMatch(tsIn);   // one side fully absent -> degenerate: ordinal fallback among the present
      } else {
        tsOut = ts.updateMatch(tsIn);
      }
      // visible-LP plan uses PRE-match ratings (tsIn) + current LP -> per-player adjusted delta + reveal flag.
      //   team matches: halved team-LP path (teamLpPlan); FFA: per-unit plan (premade pairs from the
      //   matchType mask settle at their average rank -- design line 66; solos = original formula).
      const planIn = tsIn.map((t, i) => ({ steamID: t.id, seat: parts[i].seat | 0, mmr: ts.displayRating(t.mu, t.sigma), rank: t.rank, lp: (lp[t.id] == null ? 0 : lp[t.id]) }));
      const rsPlan = isTeamMt(matchType)
        ? teamLpPlan(planIn, matchType, scores, leavers0.map(x => x.seat), t2Win)
        : reducedStakesPlan(planIn, matchType, premadeMaskOf(matchType), premadeTrioAtOf(matchType));
      for (const r of tsOut) {
        // repeat-group decay: blend the update toward the pre-match rating by the streak weight
        //   (w=1 full, w=0 frozen). Blending sigma the same way keeps a frozen player's uncertainty
        //   frozen too (a x0 match teaches the ladder nothing about them).
        const gp = gPlan[pid(r.id)];
        if (gp && gp.w < 1) {
          const pre = tsIn.find(t => t.id === r.id);
          if (pre) {
            r.mu = pre.mu + (r.mu - pre.mu) * gp.w;
            r.sigma = pre.sigma + (r.sigma - pre.sigma) * gp.w;
          }
          console.log('  group-decay ' + c.m + ': ' + plog(r.id) + ' repeat-group streak ' + gp.k + ' -> rating weight x' + gp.w);
        }
        skill[pid(r.id)] = { mu: r.mu, sigma: r.sigma };
        changed[r.id] = { mu: r.mu, sigma: r.sigma };
        let lpLine = '';
        if (lpId && appliesLp(matchType)) {   // quick = MMR only; visible LP ladder is ranked-only
          const cur = lp[r.id] == null ? 0 : lp[r.id];
          const rs = rsPlan && rsPlan[r.id];
          const d0 = rs ? rs.adjDelta : lpDelta(cur, rankOf[r.id], parts.length);
          // promotion/relegation series clamp: decisive line crossing for the boundary-zone match.
          //   won: plan-supplied (unit average rank / team outcome), else top-half at own rank.
          //   PROTECTED (flag 2) keeps its compressed natural loss -- no forced drop.
          const wonLike = rs ? !!rs.won : ((rankOf[r.id] | 0) <= (parts.length + 1) / 2);
          // PROTECTED (flag 2) keeps natural loss; a seed settle (first ranked) skips the series clamp too.
          const d = ((rs && rs.flag === 2) || seededNow.has(r.id)) ? d0 : crosslineDelta(cur, d0, wonLike);
          const nv = Math.max(0, Math.min(LP_MAX, cur + d));
          lp[r.id] = nv; changedLp[r.id] = nv;
          if (rs && rs.flag) reveal[r.id] = { matchHash: g[0].d[3] | 0, seed: g[0].d[4] | 0, flag: rs.flag, adjDelta: d, normalDelta: rs.normalDelta };
          lpLine = ' | pts ' + cur + (d >= 0 ? '+' : '') + d + '->' + nv + (rs && rs.flag ? (' [' + (rs.flag === 1 ? 'UPSET' : 'PROTECTED') + ' normal ' + rs.normalDelta + ']') : '')
            + (d !== d0 ? (' [SERIES ' + (wonLike ? 'PROMOTED' : 'RELEGATED') + ' from ' + d0 + ']') : '');
        }
        console.log('  settle ' + c.m + ': ' + plog(r.id) + ' rank' + rankOf[r.id] + ' mu' + r.mu.toFixed(2) + ' sigma' + r.sigma.toFixed(2) + ' -> ' + ts.displayRating(r.mu, r.sigma) + lpLine);
      }
    }
    for (const x of leavers0) {
      // a confession already counted this exact (player, match) leave -- exit-rate AND the LP hit
      // (immediate at quit time); the consensus conviction would double both. Shield input
      // (leaverSeats for teamLpPlan) is unaffected: leavers0 itself still lists the seat.
      if (confState[pid(x.steamID) + '|' + c.m]) {
        console.log('  leaver ' + c.m + ': seat ' + x.seat + ' = ' + plog(x.steamID) + ' already confessed -- consensus conviction skipped');
        continue;
      }
      leavers[pid(x.steamID)] = leavers[pid(x.steamID)] || { leaves: 0, lastMatch: '' };
      leavers[pid(x.steamID)].leaves += 1; leavers[pid(x.steamID)].lastMatch = c.m; leaverHits++;
      console.log('  leaver ' + c.m + ': seat ' + x.seat + ' = ' + plog(x.steamID) + ' (in roster, no record; total ' + leavers[pid(x.steamID)].leaves + ')');
      // authoritative ranked leaver penalty: deduct LEAVER_LP_PENALTY from the points board so a client optimistic deduction survives read-back
      //   (would otherwise be reverted). Ranked-only; consensus-detected leaver only (single side can't frame); once/match (processed).
      if (lpId && appliesLp(matchType)) {
        const cur = lp[x.steamID] == null ? 0 : lp[x.steamID];
        const nv = leaverLpPenalty(cur, LEAVER_LP_PENALTY);
        if (nv !== cur) { lp[x.steamID] = nv; changedLp[x.steamID] = nv; }
        console.log('  leaver LP ' + c.m + ': ' + plog(x.steamID) + ' pts ' + cur + '-' + LEAVER_LP_PENALTY + '->' + nv);
      }
    }
    processed.add(c.m); settled++;
  }
  if (scPendingRestore) { scRestore(scPendingRestore); scPendingRestore = null; }
  console.log('settled ' + settled + ' (+' + settledEndless + ' endless, +' + settledPrivate + ' private, +' + settledSolo + ' solo), voided ' + voided + ', ' + Object.keys(changed).length + ' players changed, ' + leaverHits + ' leavers');
  RUN.endless = settledEndless; RUN.solo = settledSolo;

  if (!APPLY_MMR) { console.log('APPLY_MMR=0 dry-run, nothing written'); return; }

  // ---- O124 seedcap corrections (knife-9): already-settled over-cap ENDLESS matches. ----
  // The auditor only QUEUES (seedcap.json corrections[]); the reconcile stays the sole writer
  // of game boards and applies here "next tick" -- delete the flagged seats' endless board
  // entries iff they still carry exactly the flagged match's packed score (an honest later
  // improvement is never touched). Applied ids land in signals.seedcapApplied so the auditor
  // prunes its queue; unactionable ids (records rotated off the shards) are marked too so the
  // queue can never wedge. CP needs no reversal (endless settle only DEBITS; gains are matchmade).
  if (SEEDCAP_ENFORCE && seedcap && Array.isArray(seedcap.corrections) && seedcap.corrections.length) {
    signals.seedcapApplied = signals.seedcapApplied || [];
    const scApplied = new Set(signals.seedcapApplied);
    for (const cor of seedcap.corrections) {
      if (!cor || !cor.id || scApplied.has(cor.id)) continue;
      const cg = groups[cor.m];
      const markApplied = () => { signals.seedcapApplied.push(cor.id); scApplied.add(cor.id); sigDirty = true; };
      if (!cg || !cg.length) { ghWarn('seedcap correction ' + cor.id + ': match records gone -- dropped'); markApplied(); continue; }
      const mtC = cg[0].d[2] | 0;
      if (!isEndlessMt(mtC)) { markApplied(); continue; }
      const pcC = cg[0].d[8] | 0;
      const tC = endlessTail(cg[0].d);
      let teamScoreC = 0;
      for (let i = 0; i < pcC; i++) teamScoreC += cg[0].d[10 + i] | 0;
      const packedC = packEndlessScore(tC.endDepth, teamScoreC);
      const rosterC = rosterConsensus(cg);
      const useTrioC = pcC >= 3;
      const targets = pcC === 1 ? [   // O93 solo competitive segment: its ladder pair
        [compId, compBest, 'solo-comp'], [compSeasonId, compSeasonBest, 'solo-comp-season'],
      ] : [
        [useTrioC ? enTrioId : enId, useTrioC ? endlessTrioBest : endlessBest, useTrioC ? 'endless-trio' : 'endless'],
        [useTrioC ? enTrioSeasonId : enSeasonId, useTrioC ? endlessTrioSeasonBest : endlessSeasonBest, 'endless-season'],
      ];
      for (const seat of (cor.seats || [])) {
        const sidC = rosterC[seat] != null ? String(rosterC[seat]) : null;
        if (!sidC) continue;
        for (const [bidC, bestMapC, labelC] of targets) {
          if (!bidC || !bestMapC || bestMapC[sidC] == null || bestMapC[sidC] !== packedC) continue;
          const resC = await postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: bidC, steamid: sidC, format: 'json' });
          if (resC.ok) { delete bestMapC[sidC]; console.log('  seedcap correction ' + cor.id + ': deleted ' + labelC + ' entry ' + plog(sidC) + ' (packed ' + packedC + ')'); }
          else ghWarn('seedcap correction ' + cor.id + ': delete ' + labelC + ' ' + plog(sidC) + ' HTTP ' + resC.status);
        }
      }
      markApplied();
      RUN.seedcapFix = (RUN.seedcapFix | 0) + 1;
    }
    if (signals.seedcapApplied.length > 400) signals.seedcapApplied = signals.seedcapApplied.slice(-400);
  }
  const wRating = await mapPool(Object.keys(changed), CONCURRENCY, async (sid) => {
    const mu = changed[sid].mu, sigma = changed[sid].sigma;
    const disp = ts.displayRating(mu, sigma);
    const res = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: rankedId, steamid: sid, score: disp, scoremethod: 'ForceUpdate', format: 'json' });
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write rating ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok rating ' + plog(sid) + ' = ' + disp + ' (mu=' + mu.toFixed(2) + ' sigma=' + sigma.toFixed(2) + ')');
    return okFlag;
  });
  const wPoints = await mapPool(Object.keys(changedLp), CONCURRENCY, async (sid) => {
    // reveal details: this run's flagged outcome if any, else preserve an existing unread reveal (don't clobber it with a normal-match LP write).
    const rv = reveal[sid];
    const prev = lpDet[sid];
    const detailsArr = rv ? [RS_MAGIC, rv.matchHash, rv.seed, rv.flag, rv.adjDelta, rv.normalDelta]
      : (prev && prev.length >= 6 && (prev[0] & 0xff) === RS_MAGIC ? prev.slice(0, 6) : null);
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: lpId, steamid: sid, score: changedLp[sid], scoremethod: 'ForceUpdate', format: 'json' }, detailsArr);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write points ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok points ' + plog(sid) + ' = ' + changedLp[sid] + (rv ? (' [reveal ' + (rv.flag === 1 ? 'UPSET' : 'PROTECTED') + ']') : ''));
    return okFlag;
  });
  const wXp = await mapPool(Object.keys(changedXp), CONCURRENCY, async (sid) => {
    // career details ride every XP write ([CAREER_MAGIC, ver, games, wins, losses] -- the client's
    // authoritative W/L read-back surface). A sid whose XP changed always has fresh career totals.
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: xpId, steamid: sid, score: changedXp[sid], scoremethod: 'ForceUpdate', format: 'json' }, careerDet[sid] || null);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write xp ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok xp ' + plog(sid) + ' = ' + changedXp[sid] + (careerDet[sid] ? (' career ' + careerDet[sid][2] + 'g/' + careerDet[sid][3] + 'w/' + careerDet[sid][4] + 'l') : ''));
    return okFlag;
  });
  const wCp = await mapPool(Object.keys(changedCp), CONCURRENCY, async (sid) => {
    const res = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: cpId, steamid: sid, score: changedCp[sid], scoremethod: 'ForceUpdate', format: 'json' });
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write cp ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok cp ' + plog(sid) + ' = ' + changedCp[sid]);
    return okFlag;
  });
  // details carry the exact best-run team score (the packed tiebreak is /1000-saturated).
  const wEndless = await mapPool(Object.keys(changedEndless), CONCURRENCY, async (sid) => {
    const w = changedEndless[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: enId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write endless ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok endless ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  const wEndlessSeason = await mapPool(Object.keys(changedEndlessSeason), CONCURRENCY, async (sid) => {
    const w = changedEndlessSeason[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: enSeasonId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write seasonal endless ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok endless season ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  // trio ladder writes (knife-B): the settle gate guarantees these maps only fill when the trio
  // boards resolved, so the ids are non-null whenever the pools are non-empty.
  const wEndlessTrio = await mapPool(Object.keys(changedEndlessTrio), CONCURRENCY, async (sid) => {
    const w = changedEndlessTrio[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: enTrioId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write trio endless ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok endless trio ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  const wEndlessTrioSeason = await mapPool(Object.keys(changedEndlessTrioSeason), CONCURRENCY, async (sid) => {
    const w = changedEndlessTrioSeason[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: enTrioSeasonId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write seasonal trio endless ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok endless trio season ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  const rOk = wRating.filter(x => x.status === 'fulfilled' && x.value).length;
  const pOk = wPoints.filter(x => x.status === 'fulfilled' && x.value).length;
  const xOk = wXp.filter(x => x.status === 'fulfilled' && x.value).length;
  const cOk = wCp.filter(x => x.status === 'fulfilled' && x.value).length;
  const eOk = wEndless.filter(x => x.status === 'fulfilled' && x.value).length;
  const esOk = wEndlessSeason.filter(x => x.status === 'fulfilled' && x.value).length;
  const etOk = wEndlessTrio.filter(x => x.status === 'fulfilled' && x.value).length;
  const etsOk = wEndlessTrioSeason.filter(x => x.status === 'fulfilled' && x.value).length;
  // O93 solo competitive ladder writes (details = exact bank; packed tiebreak is /1000-saturated)
  const wComp = await mapPool(Object.keys(changedComp), CONCURRENCY, async (sid) => {
    const w = changedComp[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: compId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write solo comp ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok solo comp ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  const wCompSeason = await mapPool(Object.keys(changedCompSeason), CONCURRENCY, async (sid) => {
    const w = changedCompSeason[sid];
    const res = await postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: compSeasonId, steamid: sid, score: w.s, scoremethod: 'ForceUpdate', format: 'json' }, [w.ts | 0]);
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write seasonal solo comp ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok solo comp season ' + plog(sid) + ' = ' + w.s);
    return okFlag;
  });
  const cmOk = wComp.filter(x => x.status === 'fulfilled' && x.value).length;
  const cmsOk = wCompSeason.filter(x => x.status === 'fulfilled' && x.value).length;
  if (Object.keys(changedComp).length || Object.keys(changedCompSeason).length) console.log('solo comp writes: ' + cmOk + '/' + Object.keys(changedComp).length + ' lifetime, ' + cmsOk + '/' + Object.keys(changedCompSeason).length + ' season');
  // save box past-season prune: a row whose plaintext header season is behind the current season can never
  //   be resumed (the client refuses; a resumed segment would chain into a season that no longer exists), so
  //   the publisher key deletes it and a stale row never shows as a save. Capped per run; nothing else
  //   in the cron touches the box (rows are written and consumed by the guard only).
  if (saveBoxId && seasonId >= 1) {
    try {
      const sb = await readBoardAll(saveBoxId, 'save box');
      let nDel = 0;
      for (const e of sb.ents) {
        const h = attest.saveBoxHead(decodeDetails(e.detailData));
        if (!h || (h.seasonId | 0) >= (seasonId | 0)) continue;
        if (nDel >= 50) break;
        const dr = await postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: saveBoxId, steamid: String(e.steamID), format: 'json' });
        if (dr.ok) { nDel++; console.log('  save box: pruned past-season row ' + plog(String(e.steamID)) + ' (season ' + h.seasonId + ')'); }
        else ghWarn('save box prune ' + plog(String(e.steamID)) + ' HTTP ' + dr.status);
      }
      if (nDel) RUN.saveBoxPruned = nDel;
    } catch (e) { ghWarn('save box prune failed: ' + (e && e.message)); }
  }
  saveProcessed(processed);
  saveSkill(skill);
  if (groupsDirty) saveGroups(groupMem, nowMs);
  saveLeavers(leavers);
  saveStarts(startsPending);
  saveSolo(soloState, nowMs);
  saveConfessions(confState, nowMs);
  if (sigDirty) saveSignals(signals, nowMs);
  if (xpId) saveXp(xpState);
  await maintainTrust();
  // redeem channel last: wallet debits base on the in-memory post-settle balances just written
  // above (passing the map avoids re-reading scores that global reads may still serve stale).
  await processRedeems(cp);
  await processCampaignGrants();
  console.log('written: rating ' + rOk + '/' + wRating.length + ', points ' + pOk + '/' + wPoints.length + ', xp ' + xOk + '/' + wXp.length + ', cp ' + cOk + '/' + wCp.length + ', endless ' + eOk + '/' + wEndless.length + (wEndlessSeason.length ? (' (+season ' + esOk + '/' + wEndlessSeason.length + ')') : '') + (wEndlessTrio.length ? (' (+trio ' + etOk + '/' + wEndlessTrio.length + ')') : '') + (wEndlessTrioSeason.length ? (' (+trio-season ' + etsOk + '/' + wEndlessTrioSeason.length + ')') : '') + ', state updated (idempotent)');
  RUN.writes = rOk + '/' + wRating.length + ' ' + pOk + '/' + wPoints.length + ' ' + xOk + '/' + wXp.length;
  RUN.writesEndless = cOk + '/' + wCp.length + ' ' + eOk + '/' + wEndless.length + (wEndlessSeason.length ? ('+' + esOk + '/' + wEndlessSeason.length) : '') + (wEndlessTrio.length ? ('+t' + etOk + '/' + wEndlessTrio.length) : '');
  writeRunSummary();
}

if (require.main === module) {
  main().catch(e => { ghErr('run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = { SUPPORTER: supporters.SUPPORTER, SUPPORTERS_FILE, isVoidDisp, voidByConsensus, premadeTrioAtOf, teamSizeOfMt, teamOfSeat, RS_SOLO_VS_TRIO, RS_TRIO_WIN, lpDelta, lpSeg, eloDeltas, decodeDetails, encodeDetails, dispName, decodeSid, decodeRoster, detectLeavers, appliesLp, isTeamMt, isSubScoreMt, team2WinTeamOf, team2RankOf, TEAM2, baseMt, premadeMaskOf, teamRankOf, leaverLpPenalty, dispClassOf, effectiveLeaverFactor, computeXpGain, creditXp, xpProgressFrac, matchProgressOf, careerWon, xpLevelCost, xpLevelOf, xpBoostMult, CAREER_MAGIC, CAREER_VER, pid, XP_CFG, LEAVER_XP, LP_SEG, LP_SEED, seedLp, reducedStakesPlan, teamLpPlan, RS_MAGIC, readBoardAll, readUserEntry, PAGE_SIZE, PAGE_CAP, boundaryOf, crosslineDelta, BOUNDARY_MARGIN, PROMO_LAND, RELEG_LAND, reconcileStarts, START_MAGIC, STARTS_MATURITY_MS, CONSOLATION_XP, CONFESS_MAGIC, reconcileConfessions, SANITY, sanityFlags, sidPlausible, pacingDefer, recordFlag, recordMatchSignals, sigDay, sigPlayer, pruneSignals, pairKey, harvestReports, REPORT_MAGIC, REPORT_DAILY_CAP, trustTierOf, trustPlan, verifiedUniqueReporters, TRUST_T, TRUST_LB, getJson, BASE, REPORT_LB, ENDLESS, isEndlessMt, endlessTail, endlessAbstention, endlessGoalBase, endlessGoalFor, endlessCpGain, endlessContinueCost, endlessNib, endlessDebits, packEndlessScore, unpackEndlessScore, endlessRequiredMs, rosterConsensus, recordEndlessSignals, creditCp, CP_LB, ENDLESS_LB, ENDLESS_LB_TRIO, groupDecayPlan, GROUP_DECAY, SEASONS, seasonAt, seasonBoardName, SOFT_RESET, softResetLp, seasonSeedLp, seasonNowMs, resolveSeasonBoard, REDEEM_LB, GRANT_LB, REDEEM_MAGIC, GRANT_MAGIC, GRANT_WORDS, REDEEM_CATALOG, decodeRedeemWant, decodeGrantMask, grantBit, setGrantBit, popcountWords, redeemPlan, postForm, postFormDetails, findOrCreateBoard, ghWarn, ghErr, PT_MODE, PT_MT_ALLOWED, PT_SEED_CP, PT_SHARD_COUNT, PT_MIRROR_LB, ptSeedCp, ptBoardPlan, PRIVATE_XP, isPrivateMt, privateProgressOf, creditXpPrivate, ENDLESS_XP, computeXpEndless, creditXpEndless, CAMPAIGN_LB, SEEDCAP_REJECT_LADDER_MIN, seedcapRejectWindowMin, seedcapRejectUntilMin, seedcapRejectActive,
  ENDLESS_COMP_LB, SAVE_BOX_LB, SOLO_FILE, COMP, soloSanity, soloChainPlan, soloMilestones, soloAdvance, soloRunKey, soloStartAttested, loadSolo, saveSolo };
