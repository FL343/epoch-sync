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
    for (const p of u) out[p.steamID] = { adjDelta, flag, normalDelta };
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
    out[p.steamID] = { adjDelta, flag, normalDelta };
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
      }
    }
    return out;
  });
  for (const r of shardOut) {
    if (r.status === 'fulfilled') for (const rec of r.value) recs.push(rec);
    else ghWarn('read shard failed: ' + (r.reason && r.reason.message || r.reason));
  }
  console.log('records: ' + recs.length);

  const MAX_SEATS = 8;
  const vecOf = r => { const pc = r.d[8] | 0; return (pc < 1 || pc > MAX_SEATS || r.d.length < 10 + pc) ? ('BAD(pc=' + pc + ')') : JSON.stringify(r.d.slice(10, 10 + pc)); };
  const groups = {};
  for (const r of recs) { const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2]; (groups[m] = groups[m] || []).push(r); }
  let consistent = 0, flagged = 0, lone = 0;
  const consistentMatches = [];
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
    else { flagged++; ghWarn('match=' + m + ': ' + g.length + ' inconsistent/invalid (suspected forgery): ' + g.map((r, i) => plog(r.steamID) + '@' + r.shard + '=' + vecs[i]).join('  ')); }
  }
  console.log('reconciled: ' + Object.keys(groups).length + ' (consistent ' + consistent + ' / lone ' + lone + ' / inconsistent ' + flagged + ')');

  if (consistentMatches.length === 0) { console.log('no consistent matches'); return; }
  const processed = loadProcessed();
  const fresh = consistentMatches.filter(c => !processed.has(c.m));
  console.log(consistentMatches.length + ' consistent, ' + fresh.length + ' fresh (settled ' + (consistentMatches.length - fresh.length) + ')');
  if (fresh.length === 0) { console.log('no fresh matches, skip'); return; }

  const rankedLb = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === RANKED_LB);
  if (!rankedLb) { ghErr('rating board not found (must be pre-created)'); process.exit(1); }
  const rankedId = rankedLb.id || rankedLb.ID;
  const skill = loadSkill();
  const leavers = loadLeavers(); let leaverHits = 0;
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
    if (c.void) { console.log('  VOID ' + c.m + ': consensus -> no MMR/points'); processed.add(c.m); voided++; continue; }
    if (parts.length < 2) { processed.add(c.m); continue; }
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
        const d = rs ? rs.adjDelta : lpDelta(cur, rankOf[r.id], parts.length);
        const nv = Math.max(0, Math.min(LP_MAX, cur + d));
        lp[r.id] = nv; changedLp[r.id] = nv;
        if (rs && rs.flag) reveal[r.id] = { matchHash: g[0].d[3] | 0, seed: g[0].d[4] | 0, flag: rs.flag, adjDelta: d, normalDelta: rs.normalDelta };
        lpLine = ' | pts ' + cur + (d >= 0 ? '+' : '') + d + '->' + nv + (rs && rs.flag ? (' [' + (rs.flag === 1 ? 'UPSET' : 'PROTECTED') + ' normal ' + rs.normalDelta + ']') : '');
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
  if (xpId) saveXp(xpState);
  console.log('written: rating ' + rOk + '/' + wRating.length + ', points ' + pOk + '/' + wPoints.length + ', xp ' + xOk + '/' + wXp.length + ', state updated (idempotent)');
}

if (require.main === module) {
  main().catch(e => { ghErr('run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = { isVoidDisp, voidByConsensus, lpDelta, lpSeg, eloDeltas, decodeDetails, encodeDetails, dispName, decodeSid, decodeRoster, detectLeavers, appliesLp, isTeamMt, baseMt, premadeMaskOf, teamRankOf, leaverLpPenalty, dispClassOf, effectiveLeaverFactor, computeXpGain, creditXp, pid, XP_CFG, LEAVER_XP, LP_SEG, reducedStakesPlan, teamLpPlan, RS_MAGIC, readBoardAll, readUserEntry, PAGE_SIZE, PAGE_CAP };
