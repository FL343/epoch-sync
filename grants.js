'use strict';
// Steam inventory keepsakes granter (trophy / prestige layer). Own workflow (grants.yml), never inside the
// reconcile tick: it reads the trusted boards the reconcile job writes, decides which keepsake items each
// recently active player has earned, and grants them through IInventoryService. Items are display-only
// keepsakes on the player's Steam profile (never tradable, never marketable, no in-game effect).
//
// Read-only on this repo: no state file, no commit, no push -- every decision is recomputed from Steam each
// run, and every write is idempotent:
//   - rule items (playtime lamps) go through AddPromoItem WITHOUT an itemdefid and WITHOUT a requestid: Steam
//     checks the promo rules itself and grants each promo item once per account. A fixed requestid would make
//     Steam replay the first answer forever (a player who only had the first lamp then would never get the next).
//   - result / purchase items go through AddItem only when GetInventory shows the player does not hold them yet,
//     each with a deterministic requestid (HMAC of player + item): a rerun after a crash cannot grant twice.
//
// Candidates: the progress-mirror board row a client writes at boot and after every match carries the snapshot
//   minute (details[1]); the job only looks at players whose mirror row moved inside the run's window:
//     fast  (dispatched every 5 minutes, best effort)  window 20 min, result items only (ranks / levels)
//     daily (scheduled once a day)                      window 48 h, everything (+ the promo sweep + purchases)
//     full  (the daily run on the 1st of the month)     every mirror row
//   The mirror row is client-written: it only decides WHEN a player is looked at, never WHAT he gets --
//   eligibility comes from the trusted boards and from Steam's own license records.
//
// How many per run: several players at a time (CONCURRENCY) until the run's time budget is spent (RUN_BUDGET_MS,
//   inside the job's 15 minutes) or the ceiling is reached (MAX_PLAYERS_PER_RUN). Whoever is left is looked at by a
//   later run -- which only holds if the later run does not cut at the same place: a fast run keeps newest first
//   (the players who just finished a match), a daily / full run walks a ring of per-player HMAC positions from a
//   start point that moves by the golden ratio every day (daily) / every month (full). The arcs of consecutive runs
//   then cover the whole ring within a few runs (three-gap theorem), with no state file: the players a run did not
//   reach are first in line a few runs later. (Newest first in every mode used to cut at the same 400 players each
//   time: the players who stopped playing never got their playtime lamps or purchase badges.)
//
// Item catalog: the companion repo generates the item definitions (ids below are pinned against it by a
// lockstep test there). Game ids and dates come from the environment, as everywhere in this public repo:
//   APPID                 the game (required)
//   CLASSIC_APPID         the older game whose owners get the classic badge (unset = that item off)
//   GRANTS_LAUNCH_AT      launch moment, ISO (unset = the first-weeks badge off). Also the automatic opening: from this
//                         moment on every candidate is granted (no flag to flip on launch day); before it only GRANTS_ALLOW
//   GRANTS_EA_END         end of early access, ISO (unset = still early access: the veteran badge is open)
//   GRANTS_LIVE           '1' = every candidate now (manual override); otherwise only the GRANTS_ALLOW list until GRANTS_LAUNCH_AT
//   GRANTS_DRY            '1' = plan and log, never write
//   GRANTS_SIDS           comma-separated account ids to look at INSTEAD of the mirror board (smoke tests / a manual
//                         backfill); the GRANTS_LIVE / GRANTS_ALLOW gate still applies
// Logs carry counts and HMAC pseudonyms only (pid), never a raw account id.
const crypto = require('crypto');
const path = require('path');
const pp = require('./points-plan.js');

const GRANTS = Object.freeze({
  // playtime lamps (rule items, Steam judges playtime): listed only for the lockstep test and the log
  LAMP_IDS: [101, 102, 103, 104, 105],
  FIRST_WEEKS: 201, CLASSIC: 202, EA_VETERAN: 203,
  // the four top tiers of the points ladder: the same tier lines the reconcile job settles on (points-plan LP_SEG,
  //   bronze..grandmaster; the client tiers are lockstep-pinned to it in the companion repo)
  RANK_TIERS: ['platinum', 'diamond', 'master', 'grandmaster'].map((t, i) => [t, pp.LP_SEG[3 + i].min]),
  RANK_VERSUS_BASE: 401,      // 401..404 = ranked platinum..grandmaster
  RANK_ENDLESS_BASE: 405,     // 405..408 = competitive endless platinum..grandmaster
  LEVEL_ITEMS: [[411, 50], [412, 100], [413, 200]],
  PURCHASE_WAIT_MS: 14 * 24 * 3600 * 1000,      // the refund window: a purchase item waits until it is over
  FIRST_WEEKS_MS: 14 * 24 * 3600 * 1000,        // the first-weeks badge covers licenses granted before launch + 14 days
  MIRROR_LB: 'mirror_box',
  WINDOW_MIN: { fast: 20, daily: 48 * 60 },
  RUN_BUDGET_MS: 11 * 60 * 1000,                // stop starting players after this (the job times out at 15 minutes)
  CONCURRENCY: 6,                               // players looked at at the same time
  MAX_PLAYERS_PER_RUN: 4000,                    // ceiling on Steam calls per run (about 4 per player); the rest is
                                                //   picked up by later runs (ringOrder), grants tolerate delay
});
const GOLDEN = (Math.sqrt(5) - 1) / 2;
const ENDLESS_TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];

// ---- pure helpers ----

// The highest points a player held over the receipts still on his row: the row keeps the current points and
//   the n newest point moves (newest first), so the points right after each of those matches are
//   current - (the moves after it). Points moved by a void entry are 0, so it never shifts the walk.
function lpPeakOf(score, ring) {
  let cur = score | 0, peak = cur;
  for (const e of (ring || [])) { cur -= (e.delta | 0); if (cur > peak) peak = cur; }
  return peak;
}
// versus rank items reached at a given peak
function versusRankItems(peak) {
  const out = [];
  GRANTS.RANK_TIERS.forEach(([, min], i) => { if ((peak | 0) >= min) out.push(GRANTS.RANK_VERSUS_BASE + i); });
  return out;
}
// endless rank items for the best tier key over the families (null = unrated)
function endlessRankItems(tier) {
  const at = ENDLESS_TIER_ORDER.indexOf(tier);
  const out = [];
  GRANTS.RANK_TIERS.forEach(([t], i) => { if (at >= 0 && at >= ENDLESS_TIER_ORDER.indexOf(t)) out.push(GRANTS.RANK_ENDLESS_BASE + i); });
  return out;
}
// O728: the endless tier a points row reached -- the tier of the highest points over the receipts still on the row (as the versus
//   peak); score / det = the row's score and decoded details; a row of another layout (the O103 rating rows) = null (unrated)
function endlessTierOf(score, det) {
  const row = pp.elpRowOf(det);
  if (!row || !row.placed) return null;
  return ENDLESS_TIER_ORDER[pp.lpTierIdx(lpPeakOf(score | 0, row.ring))];
}
function bestTier(tiers) {
  let best = null;
  for (const t of tiers || []) if (t && (best == null || ENDLESS_TIER_ORDER.indexOf(t) > ENDLESS_TIER_ORDER.indexOf(best))) best = t;
  return best;
}
function levelItems(level) { return GRANTS.LEVEL_ITEMS.filter(([, lv]) => (level | 0) >= lv).map(([id]) => id); }

// CheckAppOwnership (v4) -> the license start (ms) when the player bought it himself and kept it; else null.
//   Not his own (family sharing: ownersteamid is the lender), not permanent (free weekend, family share, site
//   license), cancelled by the user, or a site license -> null. Shared with the reconcile job's classic-owner lane
//   (ownership.js: one predicate, one test vector set).
const { ownLicenseMs } = require('./ownership.js');
// purchase items earned: license start + the refund window passed; first-weeks badge before launch + 14 days;
//   veteran badge while early access lasts (licenses before its end); classic badge for the older game.
function purchaseItems(mainMs, classicMs, nowMs, cfg) {
  const out = [];
  const settled = (ms) => ms != null && ms <= nowMs - GRANTS.PURCHASE_WAIT_MS;
  if (settled(mainMs)) {
    if (cfg.launchMs != null && mainMs < cfg.launchMs + GRANTS.FIRST_WEEKS_MS) out.push(GRANTS.FIRST_WEEKS);
    if (cfg.eaEndMs == null || mainMs < cfg.eaEndMs) out.push(GRANTS.EA_VETERAN);
  }
  if (cfg.classicAppid && settled(classicMs)) out.push(GRANTS.CLASSIC);
  return out.sort((x, y) => x - y);
}
// deterministic AddItem request id: low 64 bits of HMAC(salt, 'grant:' + sid + ':' + itemdefid), never 0
function requestIdOf(salt, sid, itemdefid) {
  const h = crypto.createHmac('sha256', String(salt || '')).update('grant:' + sid + ':' + itemdefid).digest();
  const v = h.readBigUInt64BE(0);
  return (v === 0n ? 1n : v).toString();
}
// candidate account ids from the mirror board entries: moved inside the window (null window = all), newest first
function candidatesOf(mirrorEnts, nowMs, windowMin, decodeDetails) {
  const lo = windowMin == null ? -Infinity : Math.floor(nowMs / 60000) - windowMin;
  const rows = [];
  for (const e of mirrorEnts || []) {
    const det = decodeDetails(e.detailData);
    const tMin = det.length > 1 ? det[1] | 0 : 0;
    if (tMin >= lo && /^\d{17}$/.test(String(e.steamID))) rows.push({ sid: String(e.steamID), tMin });
  }
  rows.sort((a, b) => b.tMin - a.tMin || (a.sid < b.sid ? -1 : 1));
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.sid) ? false : (seen.add(r.sid), true))).map((r) => r.sid);
}
// a player's fixed place on the ring, in [0, 1): HMAC(salt, sid), so it is stable from run to run and not guessable
function ringPos(salt, sid) {
  const h = crypto.createHmac('sha256', String(salt || '')).update('ring:' + sid).digest();
  return Number(h.readBigUInt64BE(0) >> 11n) / 2 ** 53;
}
// the order a daily / full run looks at its candidates: around the ring, from start point frac(step * golden ratio),
//   step = the UTC day (daily) or month (full) number. A run cut short covers one arc; consecutive steps put the
//   start points so evenly around the ring that a few runs cover all of it.
function ringOrder(sids, salt, step) {
  const start = (step * GOLDEN) % 1;
  const rows = sids.map((sid) => ({ sid, k: (ringPos(salt, sid) - start + 1) % 1 }));
  rows.sort((a, b) => a.k - b.k || (a.sid < b.sid ? -1 : 1));
  return rows.map((r) => r.sid);
}
function ringStepOf(mode, nowMs) {
  const d = new Date(nowMs);
  return mode === 'full' ? d.getUTCFullYear() * 12 + d.getUTCMonth() : Math.floor(nowMs / 86400000);
}
// the run mode from the trigger: dispatched with mode, else the schedule -> daily, full on the 1st (UTC)
function modeOf(input, nowMs) {
  if (input === 'fast' || input === 'daily' || input === 'full') return input;
  return new Date(nowMs).getUTCDate() === 1 ? 'full' : 'daily';
}
// the items a player still needs: earned minus held
function missingItems(earned, held) {
  const h = new Set((held || []).map(Number));
  return [...new Set(earned)].filter((id) => !h.has(id)).sort((a, b) => a - b);
}

// ---- Steam calls (publisher key in the header, never in a URL that could reach a log) ----
const BASE = 'https://partner.steam-api.com';
// Retries wait 1 s, 2 s, 4 s (several players at a time can get throttled): reads on 429 / 5xx / a network error,
//   writes only on 429 (throttled = not processed; a 5xx write is left to the next run, which recomputes it).
const RETRIES = 3;
function api(fetchImpl, key, sleep) {
  const headers = { 'x-webapi-key': key };
  const wait = sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const backoff = (attempt) => wait(1000 * 2 ** attempt);
  async function get(p, q) {
    const qs = Object.keys(q).map((k) => k + '=' + encodeURIComponent(q[k])).join('&');
    for (let attempt = 0; ; attempt++) {
      let r, t;
      try { r = await fetchImpl(BASE + p + '?' + qs, { headers }); t = await r.text(); }
      catch (e) { if (attempt >= RETRIES) throw e; await backoff(attempt); continue; }
      if ((r.status >= 500 || r.status === 429) && attempt < RETRIES) { await backoff(attempt); continue; }
      let j = null; try { j = JSON.parse(t); } catch (e) {}
      return { status: r.status, ok: r.ok, json: j };
    }
  }
  async function post(p, input) {
    const body = 'input_json=' + encodeURIComponent(JSON.stringify(input));
    for (let attempt = 0; ; attempt++) {
      const r = await fetchImpl(BASE + p, { method: 'POST', headers: Object.assign({ 'content-type': 'application/x-www-form-urlencoded' }, headers), body });
      const t = await r.text();
      if (r.status === 429 && attempt < RETRIES) { await backoff(attempt); continue; }
      let j = null; try { j = JSON.parse(t); } catch (e) {}
      return { status: r.status, ok: r.ok, json: j };
    }
  }
  const itemsOf = (res) => { try { const a = JSON.parse((res.json && res.json.response && res.json.response.item_json) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  return {
    async boards(appid) { const r = await get('/ISteamLeaderboards/GetLeaderboardsForGame/v2/', { appid }); return (r.json && r.json.response && r.json.response.leaderboards) || []; },
    async entries(appid, id, sid) {
      const q = sid ? { appid, leaderboardid: id, rangestart: 0, rangeend: 0, datarequest: 'RequestAroundUser', steamid: sid }
        : { appid, leaderboardid: id, rangestart: 1, rangeend: 5000, datarequest: 'RequestGlobal' };
      const out = [];
      for (let page = 0; page < 40; page++) {
        if (!sid) { q.rangestart = page * 5000 + 1; q.rangeend = (page + 1) * 5000; }
        const r = await get('/ISteamLeaderboards/GetLeaderboardEntries/v1/', q);
        if (!r.ok) throw new Error('board read HTTP ' + r.status);
        const ents = (r.json && r.json.leaderboardEntryInformation && r.json.leaderboardEntryInformation.leaderboardEntries) || [];
        for (const e of ents) if (!sid || String(e.steamID) === String(sid)) out.push(e);
        if (sid || ents.length < 5000) break;
      }
      return out;
    },
    async ownership(appid, sid) { const r = await get('/ISteamUser/CheckAppOwnership/v4/', { appid, steamid: sid }); if (!r.ok) throw new Error('ownership HTTP ' + r.status); return r.json; },
    async held(appid, sid) {
      const r = await get('/IInventoryService/GetInventory/v1/', { appid, steamid: sid });
      if (!r.ok) throw new Error('inventory HTTP ' + r.status);
      return itemsOf(r).map((x) => Number(x.itemdefid)).filter((n) => n > 0);
    },
    async promo(appid, sid) { const r = await post('/IInventoryService/AddPromoItem/v1/', { appid, steamid: sid, notify: true }); return { ok: r.ok, status: r.status, granted: itemsOf(r).map((x) => Number(x.itemdefid)) }; },
    async add(appid, sid, itemdefid, requestid) {
      const r = await post('/IInventoryService/AddItem/v1/', { appid, itemdefid: [itemdefid], steamid: sid, notify: true, requestid });
      return { ok: r.ok, status: r.status, granted: itemsOf(r).map((x) => Number(x.itemdefid)) };
    },
  };
}

// ---- one run ----
async function run(opts) {
  const v = opts.v;                       // validate.js exports (pure helpers: decodeDetails, xpLevelOf, rating tiers, seasons, pid)
  const env = opts.env, nowMs = opts.nowMs, log = opts.log || console.log;
  const appid = Number(env.APPID);
  if (!appid || !env.STEAM_PUBLISHER_KEY) throw new Error('APPID / STEAM_PUBLISHER_KEY missing');
  const cfg = {
    classicAppid: Number(env.CLASSIC_APPID) || 0,
    launchMs: env.GRANTS_LAUNCH_AT ? Date.parse(env.GRANTS_LAUNCH_AT) : null,
    eaEndMs: env.GRANTS_EA_END ? Date.parse(env.GRANTS_EA_END) : null,
  };
  if (cfg.launchMs != null && !isFinite(cfg.launchMs)) throw new Error('GRANTS_LAUNCH_AT is not a date');
  if (cfg.eaEndMs != null && !isFinite(cfg.eaEndMs)) throw new Error('GRANTS_EA_END is not a date');
  const live = env.GRANTS_LIVE === '1' || (cfg.launchMs != null && nowMs >= cfg.launchMs), dry = env.GRANTS_DRY === '1';
  const allow = new Set(String(env.GRANTS_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean));
  const mode = modeOf(opts.mode, nowMs);
  const A = api(opts.fetch, env.STEAM_PUBLISHER_KEY, opts.sleep);
  const clock = opts.clock || Date.now, t0 = clock();
  const budgetMs = opts.budgetMs != null ? opts.budgetMs : GRANTS.RUN_BUDGET_MS;
  const pid = (s) => v.pid(s);
  const stat = { mode, live, candidates: 0, looked: 0, cut: 0, promoCalls: 0, promoGranted: 0, ownershipCalls: 0, inventoryCalls: 0, granted: {}, wouldGrant: {}, errors: {} };
  const err = (k) => { stat.errors[k] = (stat.errors[k] | 0) + 1; };

  const boards = await A.boards(appid);
  const idOf = (name) => { const b = boards.find((x) => String(x.name || x.Name) === name); return b ? (b.id || b.ID) : null; };
  const window = mode === 'full' ? null : GRANTS.WINDOW_MIN[mode];
  let cands;
  const only = String(env.GRANTS_SIDS || '').split(',').map((s) => s.trim()).filter((s) => /^\d{17}$/.test(s));
  if (only.length) cands = [...new Set(only)];
  else {
    const mirrorId = idOf(GRANTS.MIRROR_LB);
    if (!mirrorId) { log('grants: mirror board missing -- nothing to scan'); return stat; }
    cands = candidatesOf(await A.entries(appid, mirrorId), nowMs, window, v.decodeDetails);
    if (mode !== 'fast') cands = ringOrder(cands, env.STATE_SALT, ringStepOf(mode, nowMs));
  }
  if (!live) cands = cands.filter((s) => allow.has(s));
  stat.candidates = cands.length;
  cands = cands.slice(0, GRANTS.MAX_PLAYERS_PER_RUN);

  // result sources: this season's points board (+ last season's, its final receipts still count), the level
  //   board, the four endless points boards (O728: the same scale and tiers as the versus points; this season's + last season's)
  const seasonId = v.seasonAt(nowMs);
  const lpIds = [];
  if (env.LP_LB) for (let s = seasonId; s >= Math.max(0, seasonId - 1); s--) { const id = idOf(v.seasonBoardName(env.LP_LB, s)); if (id) lpIds.push(id); }
  const xpId = env.XP_LB ? idOf(env.XP_LB) : null;
  const famIds = [];
  for (const [fam, name] of v.RATING_FAMS) for (let s = seasonId; s >= Math.max(0, seasonId - 1); s--) { const id = idOf(v.seasonBoardName(name, s)); if (id) famIds.push([fam, id]); }
  const bulk = cands.length > 40;          // a big run reads whole boards once; a small one reads the players' own rows
  const rowsOf = async (id) => {
    if (!id) return new Map();
    const m = new Map();
    if (bulk) { for (const e of await A.entries(appid, id)) m.set(String(e.steamID), e); }
    else { for (const sid of cands) { const e = (await A.entries(appid, id, sid))[0]; if (e) m.set(sid, e); } }
    return m;
  };
  const lpRows = []; for (const id of lpIds) lpRows.push(await rowsOf(id));
  const xpRows = await rowsOf(xpId);
  const famRows = []; for (const [fam, id] of famIds) famRows.push([fam, await rowsOf(id)]);

  const one = async (sid) => {
    try {
      const earned = [];
      // ranked points tiers
      let peak = null;
      for (const rows of lpRows) {
        const e = rows.get(sid);
        if (e) { const p = lpPeakOf(e.score | 0, pp.lpDetailsOf(v.decodeDetails(e.detailData)).ring); if (peak == null || p > peak) peak = p; }
      }
      if (peak != null) earned.push(...versusRankItems(peak));
      // competitive endless tiers (best family)
      {
        const tiers = famRows.map(([, rows]) => { const e = rows.get(sid); return e ? endlessTierOf(e.score | 0, v.decodeDetails(e.detailData)) : null; });
        earned.push(...endlessRankItems(bestTier(tiers)));
      }
      // level
      const xe = xpRows.get(sid);
      if (xe) earned.push(...levelItems(v.xpLevelOf(xe.score | 0)));
      // the daily runs: Steam's own promo sweep (playtime lamps) + purchase items
      if (mode !== 'fast') {
        if (!dry) {
          const r = await A.promo(appid, sid); stat.promoCalls++;
          if (r.ok) stat.promoGranted += r.granted.length; else err('promo ' + r.status);
        } else stat.promoCalls++;
        stat.ownershipCalls++;
        const mainMs = ownLicenseMs(await A.ownership(appid, sid), sid);
        let classicMs = null;
        if (cfg.classicAppid) { stat.ownershipCalls++; classicMs = ownLicenseMs(await A.ownership(cfg.classicAppid, sid), sid); }
        earned.push(...purchaseItems(mainMs, classicMs, nowMs, cfg));
      }
      if (!earned.length) return;
      stat.inventoryCalls++;
      const need = missingItems(earned, await A.held(appid, sid));
      for (const id of need) {
        if (dry) { stat.wouldGrant[id] = (stat.wouldGrant[id] | 0) + 1; continue; }
        const r = await A.add(appid, sid, id, requestIdOf(env.STATE_SALT, sid, id));
        if (r.ok) stat.granted[id] = (stat.granted[id] | 0) + 1;
        else { err('add ' + id + ' ' + r.status); log('grants: add ' + id + ' failed for ' + pid(sid) + ' HTTP ' + r.status); }
      }
      if (need.length) log('grants: ' + pid(sid) + ' ' + (dry ? 'would get ' : 'got ') + need.join(','));
    } catch (e) { err('player'); log('grants: ' + pid(sid) + ' skipped (' + String(e && e.message).replace(/\d{17}/g, '<id>') + ')'); }
  };
  // several players at a time; a player is only started while the time budget lasts (the ones in flight finish)
  let next = 0;
  const worker = async () => {
    while (next < cands.length && clock() - t0 < budgetMs) { const sid = cands[next++]; stat.looked++; await one(sid); }
  };
  const nWorkers = Math.max(1, Math.min(opts.concurrency || GRANTS.CONCURRENCY, cands.length));
  await Promise.all(Array.from({ length: nWorkers }, worker));
  stat.cut = stat.candidates - stat.looked;
  if (stat.cut) log('grants: ' + stat.cut + ' of ' + stat.candidates + ' candidates left for later runs (time budget / ceiling)');
  log('grants summary ' + JSON.stringify(stat));
  return stat;
}

module.exports = { GRANTS, ENDLESS_TIER_ORDER, lpPeakOf, versusRankItems, endlessRankItems, endlessTierOf, bestTier, levelItems, ownLicenseMs,
  purchaseItems, requestIdOf, candidatesOf, ringPos, ringOrder, ringStepOf, modeOf, missingItems, api, run };

if (require.main === module) {
  const v = require(path.join(__dirname, 'validate.js'));
  run({ v, env: process.env, nowMs: Date.now(), mode: process.env.GRANTS_MODE || '', fetch: (u, o) => fetch(u, o) })
    .then((stat) => { if (Object.keys(stat.errors).length) process.exitCode = 0; })
    .catch((e) => { console.error('grants failed: ' + String(e && e.message).replace(/\d{17}/g, '<id>')); process.exit(1); });
}
