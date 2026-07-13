'use strict';
const fs = require('fs');
const crypto = require('crypto');
const ts = require('./trueskill.js');

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

const pid = (s) => crypto.createHmac('sha256', String(SALT || '')).update(String(s)).digest('hex').slice(0, 16);
const plog = (s) => pid(s).slice(0, 8);

const START_MAGIC = 0xB2;   // start-attestation record (settle records stay 0xB1; lockstep with the client writer)
const DISP_NAME = ['finished', 'peers-gone', 'host-left', 'level-begin-timeout', 'migrate-disband', 'user-quit', 'reconnect-failed'];
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
function reconcileStarts(starts, groups, consistentKeys, processed, pending, leavers, now, maturityMs) {
  const sg = {};
  for (const r of starts) { const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2]; (sg[m] = sg[m] || []).push(r); }
  let registered = 0, convicted = 0, cleaned = 0;
  // 1) register new pending entries (sticky first-seen: shard entries may be overwritten later)
  for (const m of Object.keys(sg)) {
    if (processed.has(m) || pending[m]) continue;
    const bySid = {};   // one vote per distinct writer (a cold-reconnect duplicate collapses)
    for (const r of sg[m]) bySid[String(r.steamID)] = r;
    const att = Object.values(bySid);
    if (att.length < 2) continue;   // a single attestation convicts nobody (mirrors settle consensus)
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
    if (now - (p.t0 || 0) < maturityMs) continue;
    const hit = [];
    for (const seat of Object.keys(p.roster)) {
      const h = p.roster[seat];
      if (p.settled.indexOf(h) >= 0) continue;
      leavers[h] = leavers[h] || { leaves: 0, lastMatch: '' };
      leavers[h].leaves += 1; leavers[h].lastMatch = m;
      hit.push(h.slice(0, 8));
    }
    convicted += hit.length;
    processed.add(m);   // idempotent: a super-late settlement of a convicted key is skipped as stale
    delete pending[m];
    console.log('  start-orphan ' + m + ': started, never settled -> ' + hit.length + ' exit-rate hits (' + hit.join(',') + ')' + (p.settled.length ? ', ' + p.settled.length + ' exempt (wrote a settle record)' : ''));
  }
  return { registered, convicted, cleaned };
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
  MT_ALLOWED: [1, 2, 3, 4],                                      // quick/ranked x brawl/team1; mode2 (5/6) joins when the client gate opens
};
// NOTE (extensibility): SCORE_CAP/DUR_CAP/MIN_START_AGE_MS were derived from the game as it is
// today -- 5 levels per matchmade run, 2-4 players, current item-value scale. A future endless
// mode, level-count change, or economy rework must re-derive them. The client repo pins these
// assumptions in its lockstep test so such a change fails loudly there.
const SID_MIN = 0x0110000100000000n, SID_MAX = SID_MIN + (1n << 32n);   // individual-account steamID64 universe base (hex form)
function sidPlausible(sid) { try { const b = BigInt(sid); return b >= SID_MIN && b <= SID_MAX; } catch (e) { return false; } }
// g = one consistent match group. Returns [] when sane, else short reason slugs.
function sanityFlags(g) {
  const out = [];
  const d0 = g[0].d, mt = d0[2] | 0, base = baseMt(mt), mask = premadeMaskOf(mt), pc = d0[8] | 0;
  if (SANITY.MT_ALLOWED.indexOf(base) < 0) out.push('mt');
  if (base === 3 || base === 4) {
    if (mask !== 0) out.push('team-mask');            // team codes never carry a premade mask
    if (pc !== 4) out.push('pc');                     // team brawl is strictly 2v2 seats
  } else {
    if (pc < 2 || pc > 4) out.push('pc');             // matchmade lobbies are 2..4 players
    for (let k = 0; k < 4; k++) if ((mask >> k) & 1) { if (2 * k + 1 >= pc) { out.push('mask-range'); break; } }
    if (mask > 3) out.push('mask-range');             // pc<=4 -> at most seat pairs (0,1)/(2,3)
  }
  const scores = d0.slice(10, 10 + pc);
  for (const s of scores) if ((s | 0) > SANITY.SCORE_CAP || (s | 0) < SANITY.SCORE_FLOOR) { out.push('score'); break; }
  const writers = new Set(g.map(r => String(r.steamID)));
  if (writers.size < g.length) out.push('dup-writer'); // one account can't hold two seats / write twice
  for (const r of g) {
    const dur = r.d[9] | 0, seat = r.d[5] | 0;
    if (dur < 0 || dur > SANITY.DUR_CAP) { out.push('duration'); break; }
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
      s.rseen[seenKey] = now;
      res.targets.push(target);                // real sid -> trust-tier candidate this run
      res.seen++;
      const dayN = (day.r[rk] | 0);
      if (dayN >= REPORT_DAILY_CAP) { res.capped++; continue; }   // dedup-marked but not counted
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
    const together = team ? ((A.seat >> 1) === (B.seat >> 1))
      : (((mask >> (A.seat >> 1)) & 1) === 1 && (A.seat >> 1) === (B.seat >> 1));
    if (together) e.t += 1;
    if (!isVoid && rankOf) {   // x counts "lexicographically-first pid placed strictly above the other"
      const first = ka < kb ? A : B, second = ka < kb ? B : A;
      if (rankOf[first.steamID] < rankOf[second.steamID]) e.x += 1;
    }
  }
}
async function getJson(url) {
  const r = await fetch(url); const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
const ghWarn = m => console.log('::warning::' + m);
const ghErr = m => console.log('::error::' + m);
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
// pending start-attestation groups awaiting settlement or maturity (see reconcileStarts)
const STARTS_FILE = process.env.STARTS_FILE || 'starts.json';
const STARTS_MATURITY_MS = Number(process.env.STARTS_MATURITY_MS || 2 * 3600 * 1000);   // max match length + reconnect windows, with slack
function loadStarts() { try { return JSON.parse(fs.readFileSync(STARTS_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveStarts(s) { try { fs.writeFileSync(STARTS_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + STARTS_FILE + ' failed: ' + (e && e.message)); } }
const LP_LB = process.env.LP_LB;
const LP_MAX = 9999;
const LEAVER_LP_PENALTY = Number(process.env.LEAVER_LP_PENALTY || 100);   // ranked leaver authoritative LP deduction (pairs the client optimistic -100)
// `rs` = mismatch retention coefficient (fraction of the win/loss component applied to EXPECTED outcomes in a
//   mismatched match) per tier: lower tiers move closer to normal, higher tiers compress hard (protect the top ladder).
const LP_SEG = [
  { min: 0, win: 45, loss: 15, drip: 5, rs: 0.70 },
  { min: 2000, win: 35, loss: 20, drip: 3, rs: 0.50 },
  { min: 4000, win: 28, loss: 25, drip: 2, rs: 0.30 },
  { min: 6000, win: 22, loss: 22, drip: 1, rs: 0.15 },
  { min: 8000, win: 20, loss: 20, drip: 0, rs: 0.05 },
];
function lpSeg(lp) { let s = LP_SEG[0]; for (const x of LP_SEG) if (lp >= x.min) s = x; return s; }
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
// Team codes (3/4/5/6) never carry a mask: the fixed seat convention already encodes grouping.
// FFA codes carry it so the settle pass can apply the premade average-rank LP rule (design line 66)
// with no record-layout change.
function baseMt(mt) { return (mt | 0) & 0xF; }
function premadeMaskOf(mt) { return ((mt | 0) >> 4) & 0xF; }
// visible points move for ranked matches only; quick classes update the hidden rating.
// base 4 (ranked team-brawl) flips on HERE, in the same change that ships the halved team-LP path
// (teamLpPlan below) -- the plan's red line: a type-4 record must never reach the individual
// full-stakes LP path. Base 6 (ranked mode 2) stays false until mode 2 ships its own LP rules (M5).
function appliesLp(mt) { const b = baseMt(mt); return b === 2 || b === 4; }
// team match types: 3/4 = quick/ranked team-brawl (mode 1); 5/6 reserved for mode 2.
function isTeamMt(mt) { const b = baseMt(mt); return b === 3 || b === 4; }
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
// clamp-aware authoritative leaver deduction (never below 0)
function leaverLpPenalty(cur, pen) { return Math.max(0, (cur | 0) - (pen | 0)); }

// ===== mismatch compensation (the matchmaking-fairness layer): compress the strong side's swing, protect/reward the
//   weak side. authoritative -- the client shows a flat optimistic delta (it can't see opponents' ratings); this is the
//   only place the real adjusted delta + UPSET/PROTECTED tag is computed, revealed back to the client via board details. =====
const RS_THRESHOLD = Number(process.env.RS_THRESHOLD || 400);            // pre-match rating spread (display points) that triggers
const RS_UPSET_BONUS = Number(process.env.RS_UPSET_BONUS || 1.0);        // weak side over-performs: 1.0 = full (>1 = super reward)
const RS_STRONG_UPSET_LOSS = Number(process.env.RS_STRONG_UPSET_LOSS || 0.5); // strong side upset: mild penalty (not the strict tier coeff)
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
function reducedStakesPlan(parts, matchType, premadeMask) {
  if (!appliesLp(matchType) || isTeamMt(matchType) || !parts || parts.length < 2) return null;
  const units = [], used = new Set();
  if (premadeMask | 0) {
    const bySeat = {};
    for (const p of parts) bySeat[p.seat | 0] = p;
    for (let pair = 0; pair < 4; pair++) {
      if (!(((premadeMask | 0) >> pair) & 1)) continue;
      const m0 = bySeat[pair * 2], m1 = bySeat[pair * 2 + 1];
      if (m0 && m1) { units.push([m0, m1]); used.add(m0.steamID); used.add(m1.steamID); }
    }
  }
  for (const p of parts) if (!used.has(p.steamID)) units.push([p]);
  const mmrs = parts.map(p => p.mmr | 0);
  const mismatch = Math.max.apply(null, mmrs) - Math.min.apply(null, mmrs) > RS_THRESHOLD;
  if (!mismatch && units.every(u => u.length === 1)) return null;   // fair all-solo match: plain lpDelta path
  const mean = mmrs.reduce((a, b) => a + b, 0) / mmrs.length;
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
//   leaverSeats: consensus-absent seats. Returns { [steamID]: { adjDelta, flag, normalDelta } } or null. =====
function teamLpPlan(parts, matchType, scores, leaverSeats) {
  if (!appliesLp(matchType) || !isTeamMt(matchType)) return null;
  if (!parts || !parts.length || !scores || scores.length < 4) return null;
  const teamOf = s => ((s | 0) >> 1) & 1;
  const aTotal = (scores[0] | 0) + (scores[1] | 0), bTotal = (scores[2] | 0) + (scores[3] | 0);
  const winTeam = bTotal > aTotal ? 1 : 0;   // tie -> team A (mirrors teamRankOf / the client rule)
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
function loadXp() { try { return JSON.parse(fs.readFileSync(XP_FILE, 'utf8')) || {}; } catch (e) { return {}; } }
function saveXp(s) { try { fs.writeFileSync(XP_FILE, JSON.stringify(s, null, 0)); } catch (e) { ghWarn('write ' + XP_FILE + ' failed: ' + (e && e.message)); } }
// per-game point formula -- lockstep mirror of the client config (asserted by the schema-lockstep test).
const XP_CFG = { base: 100, rankBonus: [80, 45, 20, 0], moneyDivisor: 50, moneyBonusCap: 120, rankedMult: 1.25, dailyFirstWin: 150 };
// repeat-leaver discount: gradient + minimum-sample gate in one, via min-denominator smoothing. values tunable on real data.
const LEAVER_XP = { minSample: 20, tiers: [{ maxRate: 0.05, factor: 1.0 }, { maxRate: 0.15, factor: 0.5 }, { maxRate: 1.01, factor: 0.3 }] };
// per-end disposition -> credit class (lockstep mirror of client table): 0,1 valid / 5 abandoner / else innocent.
function dispClassOf(code) { const c = code | 0; return (c === 0 || c === 1) ? 'valid' : (c === 5 ? 'abandoner' : 'innocent'); }
// effective leave rate with min-denominator smoothing -> tier factor. leaves/games cumulative per player; a first leave cannot spike to 100%.
function effectiveLeaverFactor(leaves, games) {
  const total = (leaves | 0) + (games | 0);
  const rate = total > 0 ? (leaves | 0) / Math.max(total, LEAVER_XP.minSample) : 0;
  for (const t of LEAVER_XP.tiers) if (rate <= t.maxRate) return t.factor;
  return LEAVER_XP.tiers[LEAVER_XP.tiers.length - 1].factor;
}
// per-record point gain, mirroring the client per-game formula + credit rules. rank0 = 0-based; factor = repeat-leaver discount.
//   valid = full (rank + money + ranked x + daily-first); innocent = base only; abandoner = 0.
function computeXpGain(cls, rank0, money, isRanked, firstWinToday, factor) {
  if (cls === 'abandoner') return 0;
  let xp = XP_CFG.base;
  if (cls === 'valid') {
    const rb = XP_CFG.rankBonus;
    xp += (rank0 >= 0 && rank0 < rb.length) ? rb[rank0] : 0;
    xp += Math.min(XP_CFG.moneyBonusCap, Math.max(0, Math.floor((money | 0) / XP_CFG.moneyDivisor)));
  }
  if (isRanked) xp = xp * XP_CFG.rankedMult;
  if (cls === 'valid' && firstWinToday) xp += XP_CFG.dailyFirstWin;
  return Math.max(0, Math.round(Math.round(xp) * (factor == null ? 1 : factor)));
}
// credit authoritative points for one consistent match group (mutates the board map + changedXp + state).
//   deduped by seat; leaves come from the leaver state; today = UTC day index for the daily-first bonus.
function creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today) {
  const isRanked = appliesLp(matchType);
  const recBySeat = {};
  for (const r of g) { const s = r.d[5] | 0; if (recBySeat[s] == null) recBySeat[s] = r; }
  for (const seatKey of Object.keys(recBySeat)) {
    const r = recBySeat[seatKey], seat = seatKey | 0, sid = r.steamID, p = pid(sid);
    const cls = dispClassOf(r.dispCode);
    const st = xpState[p] = xpState[p] || { lastWinDay: 0, games: 0 };
    const factor = effectiveLeaverFactor((leavers[p] && leavers[p].leaves) || 0, st.games);
    const rank0 = ((rankOf[sid] || 1) | 0) - 1;   // 0-based for rankBonus index (group rank is 1-based)
    let firstWin = false;
    if (cls === 'valid' && rank0 === 0 && (st.lastWinDay | 0) < today) { firstWin = true; st.lastWinDay = today; }
    const gain = computeXpGain(cls, rank0, scores[seat] | 0, isRanked, firstWin, factor);
    if (gain > 0) { xp[sid] = (xp[sid] | 0) + gain; changedXp[sid] = xp[sid]; }
    if (cls === 'valid') st.games += 1;   // denominator = real finishes (innocent/abandoner don't count; mirrors client window)
    console.log('  xp ' + plog(sid) + ' ' + cls + ' rank' + (rank0 + 1) + (firstWin ? ' dailyWin' : '') + ' x' + factor + ' +' + gain + ' -> ' + (xp[sid] | 0));
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

async function main() {
  const missing = [];
  if (!KEY) missing.push('STEAM_PUBLISHER_KEY');
  if (!APPID) missing.push('APPID');
  if (!PREFIX) missing.push('LB_PREFIX');
  if (!RANKED_LB) missing.push('RANKED_LB');
  if (!LP_LB) missing.push('LP_LB');
  if (!SALT) missing.push('STATE_SALT');
  if (missing.length) { ghErr('missing env: ' + missing.join(', ')); process.exit(1); }
  console.log('reconcile: start (concurrency ' + CONCURRENCY + ')');

  const lr = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (lr.status === 403) { ghErr('403 (key has no access)'); process.exit(1); }
  if (!lr.ok) { ghErr('GetLeaderboardsForGame HTTP ' + lr.status); process.exit(1); }
  const ALLOW_TEST = process.env.ALLOW_TEST === '1';
  const shards = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).filter(x => { const n = String(x.name || x.Name); return n.indexOf(PREFIX) === 0 && (ALLOW_TEST || n.indexOf('test') < 0); });
  console.log('shards: ' + shards.length);

  const recs = [];
  const nonEmpty = shards.filter(s => (s.entries | 0) > 0);
  const shardOut = await mapPool(nonEmpty, CONCURRENCY, async (s) => {
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
      }
    }
    return out;
  });
  const starts = [];
  for (const r of shardOut) {
    if (r.status === 'fulfilled') for (const rec of r.value) (rec.start ? starts : recs).push(rec);
    else ghWarn('read shard failed: ' + (r.reason && r.reason.message || r.reason));
  }
  console.log('records: ' + recs.length + (starts.length ? ' (+' + starts.length + ' start attestations)' : ''));

  const MAX_SEATS = 8;
  const vecOf = r => { const pc = r.d[8] | 0; return (pc < 1 || pc > MAX_SEATS || r.d.length < 10 + pc) ? ('BAD(pc=' + pc + ')') : JSON.stringify(r.d.slice(10, 10 + pc)); };
  const groups = {};
  for (const r of recs) { const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2]; (groups[m] = groups[m] || []).push(r); }
  let consistent = 0, flagged = 0, lone = 0;
  const consistentMatches = [], inconsistentGroups = [];
  for (const m of Object.keys(groups)) {
    const g = groups[m];
    const vecs = g.map(vecOf);
    const same = vecs.every(v => v === vecs[0] && v.indexOf('BAD') !== 0);
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
  console.log('reconciled: ' + Object.keys(groups).length + ' (consistent ' + consistent + ' / lone ' + lone + ' / inconsistent ' + flagged + ')');

  // start/settle cross-check runs BEFORE the early returns: the very scenario it exists for
  // (a match that started and was never settled by anyone) produces no consistent matches at all,
  // so it must still be tracked, judged and persisted on those paths.
  const processed = loadProcessed();
  const leavers = loadLeavers(); let leaverHits = 0;
  const startsPending = loadStarts();
  const consistentKeys = new Set(consistentMatches.map(c => c.m));
  const nowMs = Date.now();
  const startsRes = reconcileStarts(starts, groups, consistentKeys, processed, startsPending, leavers, nowMs, STARTS_MATURITY_MS);
  if (startsRes.registered || startsRes.convicted || startsRes.cleaned || Object.keys(startsPending).length)
    console.log('starts: ' + Object.keys(startsPending).length + ' pending (+' + startsRes.registered + ' new), ' + startsRes.convicted + ' exit-rate hits, ' + startsRes.cleaned + ' cleaned');
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
      if (rres.seen || rres.bad) {
        if (rres.counted) sigDirty = true;
        for (const t of rres.targets) trustTouched.add(t);
        console.log('reports: ' + rres.seen + ' new (' + rres.counted + ' counted, ' + rres.capped + ' over daily cap, ' + rres.bad + ' malformed) of ' + rb.ents.length + ' entries');
      }
    } catch (e) { ghWarn('report box read failed: ' + (e && e.message)); }
  } else if (!repLb) {
    console.log('report board absent (pre-create ' + REPORT_LB + ', client-writable) -- skip');
  }
  // trust board upkeep: recompute tiers for touched players + everyone currently ON the
  // board (decay/deletion). Runs on every exit path (reports/flags arrive with or without
  // settles). Board absent -> logged skip (code can ship before the board exists).
  const maintainTrust = async () => {
    const tLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === TRUST_LB);
    if (!tLb) { console.log('trust board absent (pre-create ' + TRUST_LB + ', trusted-writes) -- skip'); return; }
    try {
      // Always read (never trust the list's entry-count metadata: it lags behind writes --
      // a stale 0 would skip the read and silently starve decay-deletes for the run).
      const existing = {};
      const tb = await readBoardAll(tLb.id || tLb.ID, 'trust board');
      for (const e of tb.ents) existing[String(e.steamID)] = e.score | 0;
      const plan = trustPlan(signals, existing, trustTouched, nowMs);
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
    if (sigDirty) saveSignals(signals, nowMs);
    if (startsRes.convicted) { saveLeavers(leavers); saveProcessed(processed); }
  };

  if (consistentMatches.length === 0) { console.log('no consistent matches'); persistStartsSide(); await maintainTrust(); return; }
  const fresh = consistentMatches.filter(c => !processed.has(c.m));
  console.log(consistentMatches.length + ' consistent, ' + fresh.length + ' fresh (settled ' + (consistentMatches.length - fresh.length) + ')');
  if (fresh.length === 0) { console.log('no fresh matches, skip'); persistStartsSide(); await maintainTrust(); return; }

  const rankedLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === RANKED_LB);
  if (!rankedLb) { ghErr('rating board not found (must be pre-created)'); process.exit(1); }
  const rankedId = rankedLb.id || rankedLb.ID;
  const skill = loadSkill();
  const lpLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === LP_LB);
  const lpId = lpLb ? (lpLb.id || lpLb.ID) : null;
  if (!lpId) ghWarn('points board not found (pre-create with onlytrustedwrites) -> skip points this run');
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
  if (XP_LB && !xpId) ghWarn('xp board not found (pre-create with onlytrustedwrites) -> skip xp this run');
  const xp = {};
  let xpComplete = true;
  if (xpId) {
    const br = await readBoardAll(xpId, 'xp board');
    xpComplete = br.complete;
    for (const e of br.ents) xp[e.steamID] = e.score | 0;
  }
  const xpState = xpId ? loadXp() : {};

  fresh.sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
  // On-demand base values: when a bulk read hit PAGE_CAP the maps are incomplete -- a settling
  // player missing from them may still hold an entry beyond the window, and settling from base 0
  // would silently reset his LP/XP. Fetch exactly the players this run settles (record holders +
  // roster members: leaver LP penalty targets roster sids that wrote no record). A missing entry
  // after the targeted read is a genuine new player (base 0 correct).
  if ((lpId && !lpComplete) || (xpId && !xpComplete)) {
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
    });
    const failed = fetched.filter(x => x.status === 'rejected');
    if (failed.length) { ghErr('on-demand base reads failed (' + failed.length + '/' + need.size + ') -- abort run, do NOT settle from base 0'); process.exit(1); }
    console.log('on-demand base reads: ' + need.size + ' players (bulk window incomplete)');
  }
  const today = Math.floor(Date.now() / 86400000);   // UTC day index (matches client lastWinDay) for the daily-first bonus
  const changed = {}; const changedLp = {}; const changedXp = {}; const reveal = {}; let settled = 0, voided = 0;
  for (const c of fresh) {
    const g = c.g;
    const matchType = g[0].d[2] | 0;   // 2=ranked; visible LP only moves for ranked (quick = MMR only)
    // sanity gate (B5 tier A): a consistent-but-impossible match is flagged, not settled, and NOT
    // marked processed (self-heals if a bound is later loosened). Runs before XP/VOID so garbage
    // never feeds any ledger output or signal stats beyond the flag counter itself.
    const sane = sanityFlags(g);
    if (sane.length) {
      recordFlag(signals, g, c.m, nowMs); sigDirty = true;
      for (const r of g) trustTouched.add(String(r.steamID));   // trust-tier candidates
      ghWarn('match=' + c.m + ': sanity-flagged [' + sane.join(',') + '] -- not settled: ' + g.map(r => plog(r.steamID) + '@' + r.shard).join(' '));
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
    const writerSids = [...new Set(g.map(r => String(r.steamID)))];
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
    // same ordering the client showed optimistically (winning pair {1,2}); falls back to raw score
    // order when a seat is missing (teamRankOf returns null).
    if (isTeamMt(matchType)) {
      const tr = teamRankOf(parts);
      if (tr) { for (const p of parts) rankOf[p.steamID] = tr[p.steamID]; for (const s of sorted) s.rank = tr[s.steamID]; }
    }
    // points are credited for BOTH settled AND consensus-VOID matches -- VOID only gates MMR/LP; an innocent victim
    //   still earns participation points (mirrors the client crediting innocent records). per-record class-driven.
    if (xpId) creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today);
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
    const tsIn = parts.map(p => { const sk = skill[pid(p.steamID)] || ts.DEFAULTS; return { id: p.steamID, rank: rankOf[p.steamID], mu: sk.mu, sigma: sk.sigma }; });
    let tsOut;
    if (isTeamMt(matchType)) {
      // M3: team modes rate as TWO TEAMS (strength = sum mu, binary outcome) -- the ordinal pairwise
      // update would also transfer rating between TEAMMATES (rank 1 vs rank 2), which team play must not.
      const winTeam = ((scores[2] | 0) + (scores[3] | 0)) > ((scores[0] | 0) + (scores[1] | 0)) ? 1 : 0;
      const sides = [[], []];
      for (let i = 0; i < parts.length; i++) sides[(parts[i].seat >> 1) & 1].push(tsIn[i]);
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
      ? teamLpPlan(planIn, matchType, scores, leavers0.map(x => x.seat))
      : reducedStakesPlan(planIn, matchType, premadeMaskOf(matchType));
    for (const r of tsOut) {
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
        const d = (rs && rs.flag === 2) ? d0 : crosslineDelta(cur, d0, wonLike);
        const nv = Math.max(0, Math.min(LP_MAX, cur + d));
        lp[r.id] = nv; changedLp[r.id] = nv;
        if (rs && rs.flag) reveal[r.id] = { matchHash: g[0].d[3] | 0, seed: g[0].d[4] | 0, flag: rs.flag, adjDelta: d, normalDelta: rs.normalDelta };
        lpLine = ' | pts ' + cur + (d >= 0 ? '+' : '') + d + '->' + nv + (rs && rs.flag ? (' [' + (rs.flag === 1 ? 'UPSET' : 'PROTECTED') + ' normal ' + rs.normalDelta + ']') : '')
          + (d !== d0 ? (' [SERIES ' + (wonLike ? 'PROMOTED' : 'RELEGATED') + ' from ' + d0 + ']') : '');
      }
      console.log('  settle ' + c.m + ': ' + plog(r.id) + ' rank' + rankOf[r.id] + ' mu' + r.mu.toFixed(2) + ' sigma' + r.sigma.toFixed(2) + ' -> ' + ts.displayRating(r.mu, r.sigma) + lpLine);
    }
    for (const x of leavers0) {
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
  console.log('settled ' + settled + ', voided ' + voided + ', ' + Object.keys(changed).length + ' players changed, ' + leaverHits + ' leavers');

  if (!APPLY_MMR) { console.log('APPLY_MMR=0 dry-run, nothing written'); return; }
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
    const res = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: xpId, steamid: sid, score: changedXp[sid], scoremethod: 'ForceUpdate', format: 'json' });
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write xp ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok xp ' + plog(sid) + ' = ' + changedXp[sid]);
    return okFlag;
  });
  const rOk = wRating.filter(x => x.status === 'fulfilled' && x.value).length;
  const pOk = wPoints.filter(x => x.status === 'fulfilled' && x.value).length;
  const xOk = wXp.filter(x => x.status === 'fulfilled' && x.value).length;
  saveProcessed(processed);
  saveSkill(skill);
  saveLeavers(leavers);
  saveStarts(startsPending);
  if (sigDirty) saveSignals(signals, nowMs);
  if (xpId) saveXp(xpState);
  await maintainTrust();
  console.log('written: rating ' + rOk + '/' + wRating.length + ', points ' + pOk + '/' + wPoints.length + ', xp ' + xOk + '/' + wXp.length + ', state updated (idempotent)');
}

if (require.main === module) {
  main().catch(e => { ghErr('run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = { isVoidDisp, voidByConsensus, lpDelta, lpSeg, eloDeltas, decodeDetails, encodeDetails, dispName, decodeSid, decodeRoster, detectLeavers, appliesLp, isTeamMt, baseMt, premadeMaskOf, teamRankOf, leaverLpPenalty, dispClassOf, effectiveLeaverFactor, computeXpGain, creditXp, pid, XP_CFG, LEAVER_XP, LP_SEG, reducedStakesPlan, teamLpPlan, RS_MAGIC, readBoardAll, readUserEntry, PAGE_SIZE, PAGE_CAP, boundaryOf, crosslineDelta, BOUNDARY_MARGIN, PROMO_LAND, RELEG_LAND, reconcileStarts, START_MAGIC, STARTS_MATURITY_MS, SANITY, sanityFlags, sidPlausible, pacingDefer, recordFlag, recordMatchSignals, sigDay, sigPlayer, pruneSignals, pairKey, harvestReports, REPORT_MAGIC, REPORT_DAILY_CAP, trustTierOf, trustPlan, verifiedUniqueReporters, TRUST_T, TRUST_LB };
