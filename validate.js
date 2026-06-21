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
const LP_SEG = [
  { min: 0, win: 45, loss: 15, drip: 5 },
  { min: 2000, win: 35, loss: 20, drip: 3 },
  { min: 4000, win: 28, loss: 25, drip: 2 },
  { min: 6000, win: 22, loss: 22, drip: 1 },
  { min: 8000, win: 20, loss: 20, drip: 0 },
];
function lpSeg(lp) { let s = LP_SEG[0]; for (const x of LP_SEG) if (lp >= x.min) s = x; return s; }
function lpDelta(lp, rank, pc) {
  const seg = lpSeg(lp);
  const p = pc <= 1 ? 0.5 : (pc - 1 - (rank - 1)) / (pc - 1);
  const base = p >= 0.5 ? seg.win * (2 * p - 1) : -seg.loss * (1 - 2 * p);
  return Math.round(base + seg.drip);
}
// visible points only move for ranked matches (matchType 2); quick updates the hidden rating only
function appliesLp(mt) { return (mt | 0) === 2; }
// clamp-aware authoritative leaver deduction (never below 0)
function leaverLpPenalty(cur, pen) { return Math.max(0, (cur | 0) - (pen | 0)); }

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
    const er = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardEntries/v1/?key=' + KEY + '&appid=' + APPID + '&rangestart=1&rangeend=5000&datarequest=RequestGlobal&leaderboardid=' + id + '&format=json');
    if (!er.ok) throw new Error('shard ' + label + ' HTTP ' + er.status);
    const ents = (er.json && er.json.leaderboardEntryInformation && er.json.leaderboardEntryInformation.leaderboardEntries) || [];
    if (ents.length >= 5000) ghWarn('shard ' + label + ' read ' + ents.length + ' entries, may be truncated at rangeend=5000');
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
  const lp = {};
  if (lpId) {
    const lr2 = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardEntries/v1/?key=' + KEY + '&appid=' + APPID + '&rangestart=1&rangeend=5000&datarequest=RequestGlobal&leaderboardid=' + lpId + '&format=json');
    for (const e of ((lr2.json && lr2.json.leaderboardEntryInformation && lr2.json.leaderboardEntryInformation.leaderboardEntries) || [])) lp[e.steamID] = e.score | 0;
  }
  // XP ladder is optional: skip the whole XP path (no board, no state) if XP_LB is unset or the board is missing.
  const xpLb = XP_LB ? ((lr.json && lr.json.response && lr.json.response.leaderboards) || []).find(x => String(x.name || x.Name) === XP_LB) : null;
  const xpId = xpLb ? (xpLb.id || xpLb.ID) : null;
  if (XP_LB && !xpId) ghWarn('xp board not found (pre-create with onlytrustedwrites) -> skip xp this run');
  const xp = {};
  if (xpId) {
    const lr3 = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardEntries/v1/?key=' + KEY + '&appid=' + APPID + '&rangestart=1&rangeend=5000&datarequest=RequestGlobal&leaderboardid=' + xpId + '&format=json');
    for (const e of ((lr3.json && lr3.json.leaderboardEntryInformation && lr3.json.leaderboardEntryInformation.leaderboardEntries) || [])) xp[e.steamID] = e.score | 0;
  }
  const xpState = xpId ? loadXp() : {};

  fresh.sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
  const today = Math.floor(Date.now() / 86400000);   // UTC day index (matches client lastWinDay) for the daily-first bonus
  const changed = {}; const changedLp = {}; const changedXp = {}; let settled = 0, voided = 0;
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
    // points are credited for BOTH settled AND consensus-VOID matches -- VOID only gates MMR/LP; an innocent victim
    //   still earns participation points (mirrors the client crediting innocent records). per-record class-driven.
    if (xpId) creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today);
    if (c.void) { console.log('  VOID ' + c.m + ': consensus -> no MMR/points'); processed.add(c.m); voided++; continue; }
    if (parts.length < 2) { processed.add(c.m); continue; }
    const tsIn = parts.map(p => { const sk = skill[pid(p.steamID)] || ts.DEFAULTS; return { id: p.steamID, rank: rankOf[p.steamID], mu: sk.mu, sigma: sk.sigma }; });
    const tsOut = ts.updateMatch(tsIn);
    for (const r of tsOut) {
      skill[pid(r.id)] = { mu: r.mu, sigma: r.sigma };
      changed[r.id] = { mu: r.mu, sigma: r.sigma };
      let lpLine = '';
      if (lpId && appliesLp(matchType)) {   // quick = MMR only; visible LP ladder is ranked-only
        const cur = lp[r.id] == null ? 0 : lp[r.id];
        const d = lpDelta(cur, rankOf[r.id], parts.length);
        const nv = Math.max(0, Math.min(LP_MAX, cur + d));
        lp[r.id] = nv; changedLp[r.id] = nv;
        lpLine = ' | pts ' + cur + (d >= 0 ? '+' : '') + d + '->' + nv;
      }
      console.log('  settle ' + c.m + ': ' + plog(r.id) + ' rank' + rankOf[r.id] + ' mu' + r.mu.toFixed(2) + ' sigma' + r.sigma.toFixed(2) + ' -> ' + ts.displayRating(r.mu, r.sigma) + lpLine);
    }
    for (const x of detectLeavers(g)) {
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
    const res = await postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', { key: KEY, appid: APPID, leaderboardid: lpId, steamid: sid, score: changedLp[sid], scoremethod: 'ForceUpdate', format: 'json' });
    const okFlag = res.ok && !(res.json && res.json.result && res.json.result.result && res.json.result.result !== 1);
    if (!okFlag) ghWarn('write points ' + plog(sid) + ' failed HTTP ' + res.status + ' ' + String(res.text).slice(0, 140));
    else console.log('  ok points ' + plog(sid) + ' = ' + changedLp[sid]);
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
module.exports = { isVoidDisp, voidByConsensus, lpDelta, eloDeltas, decodeDetails, encodeDetails, dispName, decodeSid, decodeRoster, detectLeavers, appliesLp, leaverLpPenalty, dispClassOf, effectiveLeaverFactor, computeXpGain, creditXp, pid, XP_CFG, LEAVER_XP };
