'use strict';
// ============================================================
// endless-rating.js - O728 endless competitive points (user calls 2026-11-08; companion KNIFE_O728_ENDLESS_LP_PLAN), the cron half
// ============================================================
// Replaces the O103 rating (75 % season best + 25 % mean). Every settled COMPETITIVE endless segment enters / raises its run in a
// per-(player, family, season) history (endless-solo.json `hist`, pid-keyed); each run settles ONCE, in start order, by
// points-plan.js ELP (its own golden cases + test/endless-lp.js); the pass-line table (v2) rides the endless_tiercut carrier.
// O825 (2026-11-10, ELP v4): the runs of every family settle onto ONE points value a player a season (the entry pid|all|season:
// lp / placed / seedRun [fam, runId] / n / ring); the row (v2) sits on endless_rating_all (+ season twins); the four per-family
// boards are no longer read or written. Sections [1]-[12] below hold what held before, read on the points entry; [13]-[15] are new.
//   [1] history: a run enters with its flags and run seed, later segments raise it in place, final sticks, the save bit follows the
//       newest segment, a run that left never re-enters
//   [2] when a run settles: final / a newer run / idle 24 h without a save point; a save point waits; start order; an ended season
//       and the split couch history ('duoc') settle nothing
//   [3] placement: four runs of d 0 (a receipt each, no row), the fifth seeds from the hidden skill over the five (SEEDED receipt);
//       the placement targets (silver first, then the skill so far)
//   [4] points: each run = points-plan.js endlessSettle at the points before and the hidden skill of the runs before; receipts
//       keyed by the run seed (SERIES / PROTECT_RS); the line sets a target may have come from, the best for the player taken
//   [5] window + conviction: settled runs past the window go to gone; a conviction refunds a settled run (in the window or gone) as
//       recorded (VOID receipt), takes the placement back when it was the seeding run, removes an unsettled one; no re-entry
//   [6] pass lines: prior with few players, live percentile middles with many, the blend, rising by one; the recorded tables (the
//       one in force at an instant, 14 days kept, due on a new day / season / rules), the v2 carrier codec (v1 = no table), prune
//   [7] wiring pins: provisioning, the three lanes feed the history with flags + run seed (EA only), the team's final ends a dropped
//       member's run, the couch family, the correction, the upkeep on every exit path (before the save), the projection lane
//   [8] end to end over the REAL validate.js main() (offline board stub, settle-free tick): rows rewritten / deleted from the history,
//       an idle run settled and saved, the table published (blend), current on the second tick, republished the next day and at once
//       on a rules change, carrier env / none; season 1 (12-01): the season boards, no rows (placement again), a season-1 table
//   [9] end to end settle: a duo competitive run over two segments (the second final) enters both writers' history and settles as
//       their first placement run (d 0, a receipt keyed by the run seed)
//  [10] mutation self-checks on validate.js copies: each rule of [2]-[5] turns red when changed
//  [11] O803 (ELP v3) the one target of a team run: the lane records the roster by run id (elpTeam), the first settle of the run
//       freezes teamHiddenOf over every member's skill BEFORE the run (settled runs first seen no later than it; placing = the
//       plain mean so far; no entry = null) and the later settlers reuse it -- two seats settled a day apart, with a run of the
//       second seat in between that moves his skill (800 -> 1440), still read the same T (their d differ, their own skill); a placing seat
//       reads the team level for his target but seeds from his own skill; no roster (solo / couch / an older run) = own skill;
//       entries older than TAB_DAYS leave once nobody still carries the run. Mutations: the memo dropped (recomputed at each
//       settle) -> the second seat's T differs -> red; the roster's skills read through the settler's own -> red
//  [12] Q395 / RC2-01 (cloud audit 2026-11-10): a team's two runs settled in ONE pass freeze the same team level (and give every
//       seat the same T and d) as in two passes -- the member reading counts the runs this pass settles that come before the run in
//       his own list; the fixed point of the audit both entry orders, a 400-roster sweep (placing seats inside), two runs at the
//       same instant, the reading itself, one predicate for the loop and the reading (static); mutations: only settled runs counted
//       (the code before) -> red; no cut at the run's place in the list -> red
//  [13] O825 one points value: runs of several families settle onto one entry in start order (first seen, run id, family); a
//       family held back by a save point does not hold the others back; the result does not depend on the key order of the
//       state file (T7: the entries of one player and the players shuffled -> the same state); the placement counts the runs
//       of every family and seeds from the five read on the solo scale; a family never played borrows (its first target is
//       not the silver line); a team run takes the team length factor and the team gate; a conviction refunds onto the one
//       entry whatever the family, the seeding run of any family takes the placement back; the row carries the four skills,
//       computed at the player's last settle pass / conviction and kept (a row moves with its player, never with the table);
//       a state of the older shape (points on the family entries, runs marked 1): no crash, nothing refunded from runs that
//       never paid into these points, the placement starts over, the old fields stay untouched
//  [14] T8 the guard: a throw inside the endless settle (a malformed entry) does not stop the reconcile -- REAL main(): exit 0,
//       a warning, the chain memory of the lane as it was (no run half settled), the later lanes ran; without the guard the
//       run dies (mutation, a copy of validate.js run as the entry module); the row plan has its own guard
//  [15] channels: the playtest / demo twin (PT_MODE) settles no endless points and creates no points board; a rig that redirected
//       the per-family boards (ENDLESS_RATING_LB_SOLO = ..._test) and does not name the one board gets endless_rating_all_test,
//       never the production name
//  [16] the review round: the frozen team level never depends on the walk (a fuzz over key orders; the member reading looks at the
//       runs before the run only, never at his points entry as it is now; the level is read at the run's own first tick, not the
//       first settler's copy); a run started before his placement reads both targets it may have shown; a late segment on a
//       settled run refreshes the row's skills; the placement taken back clears the changes recorded before it; a damaged
//       entry is left alone and reported
// Usage: node test/endless-rating.js
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_RATING_LB', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD',
  'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'ELP_IDLE_MS', 'COUCH_DUO'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));
const PP = require(path.join(__dirname, '..', 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const R = v.RATING, ELP = PP.ELP, F = attest.SEG_FINAL, SUS = attest.SEG_SUSPENDED;
const SOLO = ELP.PRIOR.solo;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (sid) => v.pid(sid);
const H = (st, p, fam, s) => st.hist[v.ratingHistKey(p, fam == null ? 'solo' : fam, s == null ? 0 : s)];   // a family entry (the runs)
const C = (st, p, s) => st.hist[v.elpAllKey(p, s == null ? 0 : s)];   // O825: the points entry (lp / placed / n / ring / seedRun)
const DAY = 86400000;
// a player's runs (depths, all final), first seen one minute apart from t0, run ids 100.., run seeds 500..
function played(st, p, depths, t0, fam, s) { depths.forEach((d, i) => v.ratingHistUpsert(st, p, fam || 'solo', s || 0, 100 + i, d, t0 + i * 60000, F, 500 + i)); }

// ---- [1] history ----
console.log('-- [1] run history --');
{
  const st = { hist: {} };
  const pA = P(SID(1));
  const h = v.ratingHistUpsert(st, pA, 'solo', 0, 11, 5, 1000, 0, -7);
  eq('[1] first segment enters the run: [runId, depth, firstSeen, settled 0, d 0, T 0, lastSeen, flags 0, run seed]', h.runs, [[11, 5, 1000, 0, 0, 0, 1000, 0, -7]]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 10, 2000, SUS, -7);
  eq('[1] a later segment raises it in place; a save-point segment sets the save bit', [h.runs.length, h.runs[0][1], h.runs[0][2], h.runs[0][6], h.runs[0][7]], [1, 10, 1000, 2000, 2]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 7, 3000, attest.SEG_RESUMED, -7);
  eq('[1] a shallower resumed segment never lowers the run; the newest segment without a save clears the save bit', [h.runs[0][1], h.runs[0][7]], [10, 0]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 12, 4000, F, -7);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 12, 5000, SUS, -7);
  eq('[1] the final bit sticks (a stray save after it changes nothing)', h.runs[0][7], 1);
  eq('[1] best kept for the logs', h.best, [11, 12]);
  h.old.push(99); (h.gone = []).push([98, 4, 3]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 99, 3, 6000, F, 1); v.ratingHistUpsert(st, pA, 'solo', 0, 98, 3, 6000, F, 1);
  eq('[1] a run that left (old / gone) never re-enters', h.runs.map((r) => r[0]), [11]);
  v.ratingHistUpsert(st, pA, 'solo', 1, 11, 2, 7000, 0, 1); v.ratingHistUpsert(st, pA, 'duo', 0, 11, 2, 7000, 0, 1);
  eq('[1] families and seasons are separate entries', Object.keys(st.hist).sort(), [pA + '|duo|0', pA + '|solo|0', pA + '|solo|1']);
}

// ---- [2] when a run settles ----
console.log('-- [2] when a run settles --');
{
  const now = 100 * DAY;
  const st = { hist: {} }, p = P(SID(2));
  v.ratingHistUpsert(st, p, 'solo', 0, 1, 6, now - 60000, 0, 9);
  eq('[2] a run with no final segment, seen a minute ago, waits', v.elpSettleAll(st, 0, now).length, 0);
  v.ratingHistUpsert(st, p, 'solo', 0, 1, 7, now - 30000, F, 9);
  const d1 = v.elpSettleAll(st, 0, now);
  eq('[2] its final segment settles it (at the deepest depth)', [d1.length, H(st, p).runs[0][3], H(st, p).runs[0][1]], [1, 2, 7]);   // settled mark 2 = onto the one points value
  eq('[2] a settled run never settles again', v.elpSettleAll(st, 0, now + DAY).length, 0);
  v.ratingHistUpsert(st, p, 'solo', 0, 2, 4, now - R.IDLE_MS - 1, 0, 10);
  eq('[2] no segment for 24 h and no save point: settles at the depth reached (a crash / a killed process)', [v.elpSettleAll(st, 0, now).length, H(st, p).runs[1][3], H(st, p).runs[1][1]], [1, 2, 4]);
  v.ratingHistUpsert(st, p, 'solo', 0, 3, 8, now - 3 * DAY, SUS, 11);
  eq('[2] idle 3 days with a save point open: waits (it may still be resumed)', v.elpSettleAll(st, 0, now).length, 0);
  v.ratingHistUpsert(st, p, 'solo', 0, 4, 1, now, 0, 12);
  const d2 = v.elpSettleAll(st, 0, now);
  eq('[2] a newer run starts: the saved run settles at its depth (starting another gives the save up), the newer one waits', [d2.length, d2[0] && d2[0].runId, H(st, p).runs[3][3]], [1, 3, 0]);
  const s2 = { hist: {} }, q = P(SID(3));
  played(s2, q, [3, 9, 1], now - DAY);
  eq('[2] several runs settle in first-seen order', v.elpSettleAll(s2, 0, now).map((x) => x.runId), [100, 101, 102]);
  const s3 = { hist: {} };
  played(s3, q, [5, 5], now - DAY, 'solo', 0); played(s3, q, [5], now - DAY, 'duoc', 1); played(s3, q, [5], now - DAY, 'solo', 1);
  eq('[2] only the current season settles; the split couch history (duoc) settles nothing', v.elpSettleAll(s3, 1, now).map((x) => x.k.split('|').slice(1).join('|')), ['solo|1']);
}

// ---- [3] placement ----
console.log('-- [3] placement --');
{
  const now = 100 * DAY;
  const st = { hist: {} }, p = P(SID(4));
  const depths = [4, 12, 7, 9, 30];
  played(st, p, depths.slice(0, 4), now - DAY);
  const d4 = v.elpSettleAll(st, 0, now), h = C(st, p);
  eq('[3] four placement runs: d 0 each, not placed, no row', [d4.map((x) => x.d), h.placed | 0, h.n, v.ratingScoreOf(st, p, 0)], [[0, 0, 0, 0], 0, 4, null]);
  eq('[3] placement targets: the first from the silver line, the next from the plain mean of the runs so far',
    d4.map((x) => x.T), [PP.targetOf(0, SOLO, 500, null, true), PP.targetOf(0, SOLO, 501, 400, true), PP.targetOf(0, SOLO, 502, 800, true), PP.targetOf(0, SOLO, 503, 767, true)]);
  eq('[3] each placement run leaves a receipt of 0 keyed by its run seed', h.ring.map((e) => [e.mh, e.delta]), [[503, 0], [502, 0], [501, 0], [500, 0]]);
  v.ratingHistUpsert(st, p, 'solo', 0, 104, 30, now - DAY + 4 * 60000, F, 504);
  const d5 = v.elpSettleAll(st, 0, now);
  const seed = PP.endlessSeedLp(PP.hiddenOf([30, 9, 7, 12, 4]), SOLO);
  eq('[3] the fifth seeds the points from the hidden skill over all five (this run included)', [d5[0].seeded, h.placed, h.lp, d5[0].d, h.seedRun], [true, 1, seed, seed, ['solo', 104]]);
  const top = h.ring[0];
  T('[3] its receipt carries the seed as the change and SEEDED', top.mh === 504 && top.delta === seed && (top.flags & PP.RECEIPT_F.SEEDED) !== 0, JSON.stringify(top));
  const row = v.ratingScoreOf(st, p, 0), back = PP.elpRowOf(row.details);
  eq('[3] the row now: score = the points, details = points-plan.js elpRowDetails v2 (n, tier, placed, the four skills: solo his own, the families never played read his solo runs on their scale, ring)', [row.score, back.n, back.h.solo, back.h.duo, back.h.quad, back.tier, back.placed, back.ring.length],
    [seed, 5, PP.hiddenOf([30, 9, 7, 12, 4]), PP.elpHiddenFor('duo', [30, 9, 7, 12, 4].map((d) => ['solo', d]), ELP.PRIOR), PP.elpHiddenFor('quad', [30, 9, 7, 12, 4].map((d) => ['solo', d]), ELP.PRIOR), PP.lpTierIdx(seed), true, 5]);
}

// ---- [4] points ----
console.log('-- [4] points --');
{
  const now = 100 * DAY;
  const st = { hist: {} }, p = P(SID(5));
  played(st, p, [10, 10, 10, 10, 10], now - 2 * DAY);
  v.elpSettleAll(st, 0, now);
  const h = C(st, p);
  let lp = h.lp, before = [10, 10, 10, 10, 10];
  const plan = [[0, 14], [1, 2], [2, 25], [3, 9], [4, 11]];   // [index, depth]
  let okAll = true, why = '';
  for (const [i, depth] of plan) {
    const id = 200 + i, seed = 900 + i * 7;
    v.ratingHistUpsert(st, p, 'solo', 0, id, depth, now - DAY + i * 60000, F, seed);
    const x = v.elpSettleAll(st, 0, now)[0];
    const Hb = PP.hiddenOf(before), Tg = PP.targetOf(lp, SOLO, seed, Hb, false), want = PP.endlessSettle(lp, depth >= Tg, Hb, SOLO, PP.targetOffset(seed));
    const rc = h.ring[0];
    const flags = (want.protect ? ELP.PROTECT_RS : 0) | (want.clamped ? PP.RECEIPT_F.SERIES : 0);
    if (!(x.d === want.nv - lp && x.T === Tg && h.lp === want.nv && rc.mh === seed && rc.delta === x.d && (rc.flags & 0xff) === flags)) { okAll = false; why = JSON.stringify([i, x, want, rc]); }
    lp = h.lp; before = [depth].concat(before);
  }
  T('[4] five rated runs: each = endlessSettle(points before, pass = depth >= target, the hidden skill of the runs BEFORE it, the prior lines, the seed offset), receipt keyed by the run seed', okAll, why);
  // the series clamp and the protection reach the receipt
  const s2 = { hist: {} }, q = P(SID(6));
  played(s2, q, [10, 10, 10, 10, 10], now - 2 * DAY); v.elpSettleAll(s2, 0, now);
  const hq = C(s2, q); hq.lp = 2050;
  v.ratingHistUpsert(s2, q, 'solo', 0, 300, 0, now - DAY, F, 4242); v.elpSettleAll(s2, 0, now);
  T('[4] a miss in the relegation band with the skill at the gold line: protected (no forced drop), RS bits = PROTECT_RS', hq.lp >= 2000 && (hq.ring[0].flags & PP.RECEIPT_F.RS) === ELP.PROTECT_RS, JSON.stringify([hq.lp, hq.ring[0]]));
  const s3 = { hist: {} }, r = P(SID(7));
  played(s3, r, [3, 3, 3, 3, 3], now - 2 * DAY); v.elpSettleAll(s3, 0, now);
  const hr = C(s3, r); hr.lp = 2050;
  v.ratingHistUpsert(s3, r, 'solo', 0, 300, 0, now - DAY, F, 4242); v.elpSettleAll(s3, 0, now);
  T('[4] the same miss with the skill at bronze: below master the floor holds too (>= 2000, PROTECT_RS)', hr.lp >= 2000 && (hr.ring[0].flags & PP.RECEIPT_F.RS) === ELP.PROTECT_RS, JSON.stringify([hr.lp, hr.ring[0]]));
  hr.lp = 6100;
  v.ratingHistUpsert(s3, r, 'solo', 0, 301, 0, now - DAY + 60000, F, 4243); v.elpSettleAll(s3, 0, now);
  T('[4] at master the same miss drops to diamond (the strict factor, the series clamp)', hr.lp <= 5985 && PP.lpTierIdx(hr.lp) === 4, JSON.stringify([hr.lp, hr.ring[0]]));
  // the line sets: the run first seen under a table, a looser table now (or the reverse): the better for the player
  const strict = [3, 8, 14, 20, 30, 45, 60], loose = [2, 5, 8, 12, 20, 30, 45];
  const mk = (tabs) => { const s = { hist: {}, elpTab: tabs }; played(s, P(SID(8)), [8, 8, 8, 8, 8], now - 10 * DAY); return s; };
  const tabAt = (ms, pass) => ({ day: 1, season: 0, ms, key: v.elpTableKey(), byFam: { solo: { N: 300, pass } } });
  let differed = 0;
  for (const [label, tabs] of [['strict then, loose now', [tabAt(now - 20 * DAY, strict), tabAt(now - DAY / 2, loose)]], ['loose then, strict now', [tabAt(now - 20 * DAY, loose), tabAt(now - DAY / 2, strict)]]]) {
    const s = mk(tabs); v.elpSettleAll(s, 0, now - DAY);   // placed under the first table
    const hh = C(s, P(SID(8))), lp0 = hh.lp;
    v.ratingHistUpsert(s, P(SID(8)), 'solo', 0, 400, 9, now - DAY, F, 77);
    v.elpSettleAll(s, 0, now);
    const each = [strict, loose].map((ls) => PP.endlessSettle(lp0, 9 >= PP.targetOf(lp0, ls, 77, 800, false), 800, ls, PP.targetOffset(77)).nv);
    if (each[0] !== each[1]) differed++;
    T('[4] ' + label + ': the run takes the line set that leaves the most points (' + each.join(' / ') + ')', hh.lp === Math.max.apply(null, each), JSON.stringify([hh.lp, each]));
  }
  T('[4] (the two line sets gave different points in at least one of the two)', differed >= 1);
  T('[4] elpRunRk (the receipt key, lockstep with the client): the run seed | 0, the season left out', v.elpRunRk(1, 4294967295) === -1 && v.elpRunRk(0, -5) === -5 && v.elpRunRk(3, 2147483648) === -2147483648 && v.elpRunRk(0, 77) === 77);
  T('[4] elpCandidates: in force a day before the first sighting, at it, now (distinct)', JSON.stringify(v.elpCandidates({ elpTab: [tabAt(10, strict), tabAt(20 * DAY, loose)] }, 'solo', 0, 20 * DAY + 5, 30 * DAY)) === JSON.stringify([strict, loose])
    && JSON.stringify(v.elpCandidates({}, 'duo', 0, 5, 6)) === JSON.stringify([ELP.PRIOR.duo]));
}

// ---- [5] window + conviction ----
console.log('-- [5] window + conviction --');
{
  const now = 100 * DAY;
  const st = { hist: {} }, p = P(SID(9));
  played(st, p, [8, 8, 8, 8, 8, 12, 12, 2, 12, 12, 12, 12, 12], now - DAY);
  v.elpSettleAll(st, 0, now);
  const h = H(st, p), c = C(st, p);
  eq('[5] 13 settled runs: the window keeps 10, the 3 oldest go to gone with their d and run seed (and to old)', [h.runs.length, h.gone.map((g) => g[0]), h.gone.map((g) => g[2]), h.old], [10, [100, 101, 102], [500, 501, 502], [100, 101, 102]]);
  // conviction of a rated run in the window
  const r7 = h.runs.find((r) => r[0] === 107), d7 = r7[4], lp0 = c.lp;
  T('[5] (the convicted run moved points)', d7 !== 0, String(d7));
  T('[5] a conviction removes a settled run and refunds its points as recorded (its receipt, keyed by its seed: VOID, net change 0)', v.ratingHistRemove(st, p, 'solo', 0, 107) && c.lp === Math.max(0, lp0 - d7) && c.ring[0].mh === 507 && c.ring[0].delta === 0 && (c.ring[0].flags & PP.RECEIPT_F.VOID) !== 0 && c.n === 12 && !h.runs.some((r) => r[0] === 107),
    JSON.stringify([c.lp, lp0, d7, c.ring[0]]));
  const lp1 = c.lp, g = h.gone.find((x) => x[0] === 101);
  T('[5] a run out of the window (gone, a placement run of d 0): removed, nothing to refund, VOID receipt', v.ratingHistRemove(st, p, 'solo', 0, 101) && c.lp === lp1 && !h.gone.some((x) => x[0] === 101) && c.ring[0].mh === 501 && g[1] === 0 && g[3] === 1);
  v.ratingHistUpsert(st, p, 'solo', 0, 107, 30, now, F, 507);
  T('[5] the convicted run never comes back', !h.runs.some((r) => r[0] === 107));
  // the seeding run
  const s2 = { hist: {} }, q = P(SID(10));
  played(s2, q, [9, 9, 9, 9, 9, 9], now - DAY); v.elpSettleAll(s2, 0, now);
  const hq = C(s2, q);
  T('[5] convicting the seeding run takes the placement back (no row), VOID receipt of the seed', hq.seedRun[0] === 'solo' && hq.seedRun[1] === 104 && v.ratingHistRemove(s2, q, 'solo', 0, 104) && !hq.placed && hq.lp == null && hq.seedRun === null && v.ratingScoreOf(s2, q, 0) === null && hq.ring[0].mh === 504 && (hq.ring[0].flags & PP.RECEIPT_F.VOID) !== 0);
  v.ratingHistUpsert(s2, q, 'solo', 0, 120, 9, now, F, 620); v.elpSettleAll(s2, 0, now + 1);
  T('[5] ... and the next settled run seeds again (5 runs settled again)', hq.placed === 1 && hq.seedRun[1] === 120 && hq.n === 6, JSON.stringify([hq.placed, hq.seedRun, hq.n]));
  const s3 = { hist: {} }, r = P(SID(11));
  v.ratingHistUpsert(s3, r, 'solo', 0, 1, 5, now, 0, 3);
  T('[5] an unsettled convicted run: removed, no receipt', v.ratingHistRemove(s3, r, 'solo', 0, 1) && H(s3, r).runs.length === 0 && !C(s3, r));
  T('[5] no history / unknown run: false', !v.ratingHistRemove(s3, P(SID(12)), 'solo', 0, 1) && !v.ratingHistRemove(s3, r, 'solo', 0, 999));
  // the team's final for a member who stopped writing
  const s4 = { hist: {} }, m = P(SID(13));
  v.ratingHistUpsert(s4, m, 'duo', 0, 77, 6, now - 60000, 0, 8);
  T('[5] ratingHistFinal: marks an existing run final once; unknown run / no history = false', v.ratingHistFinal(s4, m, 'duo', 0, 77) && !v.ratingHistFinal(s4, m, 'duo', 0, 77) && !v.ratingHistFinal(s4, m, 'duo', 0, 78) && !v.ratingHistFinal(s4, P(SID(14)), 'duo', 0, 77)
    && v.elpSettleAll(s4, 0, now).length === 1 && H(s4, m, 'duo').runs[0][1] === 6);
}

// ---- [6] pass lines + tables ----
console.log('-- [6] pass lines + tables --');
{
  eq('[6] no placed players = the prior', v.elpLinesOf([], SOLO).pass, SOLO);
  const few = []; for (let i = 0; i < 20; i++) few.push(5000);
  eq('[6] 20 placed players = still the prior (w 0)', [v.elpLinesOf(few, SOLO).pass, v.elpLinesOf(few, SOLO).w], [SOLO, 0]);
  const many = []; for (let i = 0; i < 200; i++) many.push((i + 1) * 100);   // skills 1..200 levels
  const L = v.elpLinesOf(many, SOLO);
  // top 1 % = rank 2 (199), 4 % = 8 (193), 10 % = 20 (181), 20 % = 40 (161), 35 % = 70 (131), 60 % = 120 (81)
  eq('[6] 200 placed players = the live lines (w 1): each tier the middle of its span (grandmaster: its cut + half the master span)', [L.w, L.pass], [1, [41, 106, 146, 171, 187, 196, 202]]);
  const mid = []; for (let i = 0; i < 110; i++) mid.push(4000);
  const B = v.elpLinesOf(mid, SOLO);
  eq('[6] 110 players (all at 40): the blend w = 0.5 of the prior and the live middles (bronze 20, the rest 40)', [B.w, B.pass], [0.5, SOLO.map((x, k) => Math.round(0.5 * x + 0.5 * (k === 0 ? 20 : 40)))]);
  T('[6] the lines rise by one at least and start at 1 (a flat field)', (() => { const z = v.elpLinesOf(new Array(250).fill(0), SOLO).pass; return z.every((x, k) => x >= (k ? z[k - 1] + 1 : 1)); })());
  const now = 50 * DAY;
  const st = {};
  T('[6] due with no table; recorded; not due the same day / season / rules', v.tiercutDue(st, 0, 20261001) && (v.elpTabRecord(st, 0, 20261001, now, { solo: { N: 3, pass: SOLO } }), !v.tiercutDue(st, 0, 20261001)));
  T('[6] due on another day, another season, other rules (the key)', v.tiercutDue(st, 0, 20261002) && v.tiercutDue(st, 1, 20261001) && (() => { const t = v.elpTabNewest(st); const k = t.key; t.key = 'x'; const due = v.tiercutDue(st, 0, 20261001); t.key = k; return due; })());
  v.elpTabRecord(st, 0, 20261002, now + DAY, { solo: { N: 4, pass: [1, 2, 3, 4, 5, 6, 7] } });
  eq('[6] the table in force at an instant: the newest at or before it (the prior before any)', [v.elpLinesAt(st, 'solo', 0, now - 1), v.elpLinesAt(st, 'solo', 0, now + 5), v.elpLinesAt(st, 'solo', 0, now + DAY), v.elpLinesAt(st, 'duo', 0, now + DAY), v.elpLinesAt(st, 'solo', 1, now + DAY)],
    [SOLO, SOLO, [1, 2, 3, 4, 5, 6, 7], ELP.PRIOR.duo, SOLO]);
  v.elpTabRecord(st, 0, 20261020, now + 20 * DAY, {});
  eq('[6] tables older than 14 days leave the chain memory', st.elpTab.map((t) => t.day), [20261020]);
  const det = v.tiercutEncode(1, { solo: { N: 7, pass: SOLO } });
  eq('[6] carrier v2 = points-plan.js elpTableDetails (39 ints, magic | 2 << 8); decode round trip; v1 / foreign / short = no table', [det.length, det[0], v.tiercutDecode(20261201, det).byFam.solo, v.tiercutDecode(1, [0xEC | 256].concat(det.slice(1))), v.tiercutDecode(1, det.slice(0, 20)), R.TC_VERS],
    [39, 0xEC | (2 << 8), { N: 7, pass: SOLO }, null, null, [0, 1, 2]]);
  T('[6] the version registry reading (architecture decision 9): TC_VER 2 = points-plan.js ELP.TC_VER, TC_MAGIC = ELP.TC_MAGIC; v0 / v1 rows are taken (read as no table, never an error)',
    R.TC_VER === ELP.TC_VER && R.TC_MAGIC === ELP.TC_MAGIC && v.tiercutDecode(1, [0xEC].concat(new Array(29).fill(0))) === null && v.tiercutDecode(1, [0xEC | 256].concat(new Array(29).fill(0))) === null);
  T('[6] O825 the points row versions (architecture decision 9): this job writes ROW_VER 2 only; a v1 row (the per-family row before O825) is taken as no row, never an error; the readers list says so',
    JSON.stringify(R.ROW_VERS) === '[1,2]' && ELP.ROW_VER === 2 && R.ROW_VERS.indexOf(ELP.ROW_VER) >= 0 && PP.elpRowOf([0xEE | 256, 6, 950, 1, 1, 198, 0]) === null && PP.elpRowOf(PP.elpRowDetails({ n: 6, tier: 1, placed: 1, h: { solo: 950 } }, [])).h.solo === 950
    && (PP.elpRowDetails({ n: 1, tier: 0, placed: 1 }, [])[0] >>> 8) === 2);
  eq('[6] day = UTC calendar day YYYYMMDD', [v.tiercutDay(Date.UTC(2026, 11, 1, 0, 0, 0)), v.tiercutDay(Date.UTC(2026, 11, 1, 23, 59, 59)), v.tiercutDay(Date.UTC(2026, 11, 2))], [20261201, 20261201, 20261202]);
  const sp = { hist: { 'a|solo|0': {}, 'b|duo|1': {}, 'c|solo|2': {}, 'd|quad|3': {} } };
  eq('[6] prune keeps the current and the previous season', [v.pruneRatingHist(sp, 2), Object.keys(sp.hist).sort()], [1, ['b|duo|1', 'c|solo|2', 'd|quad|3']]);
  const hs = { hist: {} }; played(hs, 'pa', [9, 9, 9, 9, 9], 0); played(hs, 'pb', [9, 9], 0); played(hs, 'pc', [4, 4, 4, 4, 4], 0, 'duo'); v.elpSettleAll(hs, 0, DAY);
  eq('[6] elpHiddensOf: the players with MIN_RUNS settled runs of the family this season, over their own runs', [v.elpHiddensOf(hs, 'solo', 0), v.elpHiddensOf(hs, 'duo', 0), v.elpHiddensOf(hs, 'trio', 0)], [{ pa: 900 }, { pc: 400 }, {}]);
  eq('[6] tier names of points values (grants / logs)', [0, 599, 600, 2000, 3999, 4000, 6000, 8000, 9999].map((x) => v.ratingTierOf(x)), ['bronze', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'grandmaster']);
}

// ---- [7] wiring pins ----
console.log('-- [7] wiring pins --');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
{
  T('[7] the one points board + carrier provisioned up-front on the EA app (trusted), after the classic surface', /\[SAVE_BOX_LB_CLASSIC_QUAD, false\],[^\n]*\n\s*\[ENDLESS_RATING_LB, true\], \[ENDLESS_TIERCUT_LB, true\],[^\n]*\n\s*\[ENDLESS_LB_OVERALL, true\], \[ENDLESS_LB_CLASSIC_OVERALL, true\],[^\n]*\n\s*\[ENDLESS_CUP_LB, true\], \[ENDLESS_CUP_HONOR_LB, true\]\]\) \{/.test(SRC));
  T('[7] the playtest / demo board plan does NOT provision the rating surface (EA only)', !/ratingLb|ENDLESS_RATING_LB|ENDLESS_TIERCUT_LB/.test(SRC.slice(SRC.indexOf('function ptBoardPlan('), SRC.indexOf('return { create, forbidden };'))));
  T('[7] solo competitive lane feeds the history with the segment flags and the run seed (EA only)', /if \(!PT_MODE\) \{ ratingHistUpsert\(soloState, p, 'solo', f\.seasonId, ratingRunId\(key\), f\.endDepth, nowMs, f\.flags, f\.runSeed\); ratingTouched\.add\(sid\); \}/.test(SRC));
  T('[7] team competitive lane feeds the history per writer (run seed = d[4] of the group)', /if \(!PT_MODE\) \{ ratingHistUpsert\(soloState, pid\(sid\), fam\.low, t\.seasonId, ratingRunId\(key\), f\.endDepth, nowMs, f\.flags, g\[0\]\.d\[4\] \| 0\); ratingTouched\.add\(sid\); \}/.test(SRC));
  T('[7] team lane: the team\'s final segment ends the run of a roster member who stopped writing (and touches him)', /if \(!PT_MODE && \(\(f\.flags \| 0\) & attest\.SEG_FINAL\)\) for \(const sidR of rosterSids\) \{ if \(writerSids\.indexOf\(sidR\) >= 0\) continue; if \(ratingHistFinal\(soloState, pid\(sidR\), fam\.low, t\.seasonId, ratingRunId\(key\)\)\) ratingTouched\.add\(sidR\); \}/.test(SRC));
  const lane = SRC.slice(SRC.indexOf("if ((t.flags | 0) & attest.SEG_COMP) {"), SRC.indexOf('// casual co-op: a shared perk build'));
  T('[7] team lane: the history write sits behind the reject-window skip (inside the writer loop, after the `continue`)', lane.indexOf('inside seedcap reject window -- outputs skipped') < lane.indexOf('ratingHistUpsert(soloState, pid(sid), fam.low'));
  T('[7] casual / classic lanes never feed the history (only three upsert sites, all competitive: solo / team / couch)', (SRC.match(/ratingHistUpsert\(soloState,/g) || []).length === 3);
  T('[7] O803: the team lane records the roster by run id (every roster seat, pid-keyed, the family and the season), once per settled segment, EA only; no other lane does',
    /if \(!PT_MODE\) elpTeamNote\(soloState, ratingRunId\(key\), rosterSids\.map\(\(x\) => pid\(String\(x\)\)\), fam\.low, t\.seasonId, nowMs\);/.test(lane) && (SRC.match(/elpTeamNote\(soloState,/g) || []).length === 1);
  T('[7] O803 / O825: the settle reads the team level into the target only (targetOf th) and the own skill of the run\'s family into the points line (endlessSettle H, fam), placing included; the seed reads the five on the solo scale',
    /const t = pointsPlan\.targetOf\(cur, tb\[fam\], seed, th, false\), sl = pointsPlan\.endlessSettle\(cur, depth >= t, H, tb\[fam\], off, fam\);/.test(SRC) && /const ths = teamH !== undefined \? \[teamH\] : \(\(H == null && before\.length\) \? \[H, pointsPlan\.elpHiddenFor\(fam, before, tb, 1\)\] : \[H\]\);/.test(SRC)
    && /const ph = pointsPlan\.elpHiddenFor\(fam, before, tb, 1\); return pointsPlan\.targetOf\(0, tb\[fam\], seed, teamH === undefined \? ph : teamH, true\);/.test(SRC)
    && /pointsPlan\.endlessSeedLp\(pointsPlan\.elpHiddenFor\('solo', five, tb\), tb\.solo\)/.test(SRC));
  T('[7] O803 / O825: the table key carries ELP.VER (4) and the two team constants: the pass-line table is re-recorded and republished on the first run under the new rules', /function elpTableKey\(\) \{ return JSON\.stringify\(\[ELP\.VER, /.test(SRC) && ELP.VER === 4 && v.elpTableKey().startsWith('[4,') && v.elpTableKey().endsWith(',1300,110]'));
  T('[7] couch competitive lane feeds the duo history while merged (couchRatingFam), with flags and run seed', /if \(!PT_MODE\) \{ ratingHistUpsert\(soloState, p, couchRatingFam\(\), f\.seasonId, ratingRunId\(key\), f\.endDepth, nowMs, f\.flags, f\.runSeed\); ratingTouched\.add\(sid\); \}/.test(SRC) && /function couchRatingFam\(\) \{ return COUCH_DUO_SPLIT \? 'duoc' : 'duo'; \}/.test(SRC));
  T('[7] seedcap correction takes the convicted run out of the flagged seats (solo: runSeed key; team: roster set key; couch: the couch family)',
    /ratingHistRemove\(soloState, pid\(sidC\), famR, tC\.seasonId, ratingRunId\(keyR \|\| soloRunKey\(pid\(sidC\), tC\.seasonId, cg\[0\]\.d\[4\] \| 0\)\)\)/.test(SRC) && /teamRunKey\(Object\.values\(rosterC\)\.map\(String\), tC\.seasonId, cg\[0\]\.d\[4\] \| 0\)/.test(SRC) && /couchCor \? couchRatingFam\(\)/.test(SRC));
  T('[7] every exit path: the upkeep (settle + table) before the projection; the settle-free returns save when it changed',
    (SRC.match(/const st0 = loadSolo\(\); const elpCh = await elpUpkeep\(st0\); await maintainRating\(st0, new Set\(\)\); if \(\(await maintainCup\(st0, null\) \|\| elpCh\) && APPLY_MMR\) saveSolo\(st0, nowMs\);/g) || []).length === 2);
  T('[7] main path: upkeep, then prune, then the state save, then the projection beside trust',
    /\n  await elpUpkeep\(soloState\);[^\n]*\n  \{ const nPr = pruneRatingHist\(soloState, seasonId\);[^\n]*\n[^\n]*\n  saveSettled\(true\);\n  await maintainRating\(soloState, ratingTouched\);[^\n]*\n  await maintainTrust\(\);/.test(SRC));
  const up = SRC.slice(SRC.indexOf('const elpUpkeep = async (st) => {'), SRC.indexOf('const maintainRating = async (st, touched) => {'));
  T('[7] upkeep: EA only; settles the current season; records the table when due, with the bans', /if \(PT_MODE \|\| !st\) return false;/.test(up) && /elpSettleAll\(st, seasonId, nowMs\)/.test(up) && /if \(tiercutDue\(st, seasonId, day\)\) \{/.test(up) && /await banSetOnce\(\)/.test(up) && /elpTabRecord\(st, seasonId, day, nowMs, byFam\)/.test(up));
  const laneSrc = SRC.slice(SRC.indexOf('const maintainRating = async (st, touched) => {'), SRC.indexOf('const persistStartsSide = () => {'));
  T('[7] projection: EA only (PT_MODE returns first); a read failure skips the board and never deletes', /^\s*if \(PT_MODE\) return;/m.test(laneSrc) && /skipped this run, nothing deleted/.test(laneSrc));
  T('[7] projection: season >= 1 resolves the twin, season 0 the base board; ForceUpdate rows with the points details; DeleteLeaderboardScore',
    /seasonId >= 1 \? \(await resolveSeasonBoard\(lr, ENDLESS_RATING_LB, seasonId\)\)\.id : \(byName0\(ENDLESS_RATING_LB\) \|\| await findOrCreateBoard\(ENDLESS_RATING_LB, true\)\)/.test(laneSrc) && /scoremethod: 'ForceUpdate', format: 'json' \}, w\.details\);/.test(laneSrc) && /DeleteLeaderboardScore/.test(laneSrc));
  T('[7] table: the newest recorded one, published when the carrier row differs; carrier = env, else the row on the board, else version_gate',
    /const tab = elpTabNewest\(st\);/.test(laneSrc) && /let carrier = TIERCUT_CARRIER_SID \|\| carrierOnBoard;/.test(laneSrc) && /byName0\('version_gate'\)/.test(laneSrc) && /published\.day === \(tab\.day \| 0\) && sameInts\(published\.det, detTc\)/.test(laneSrc));
  T('[7] summary row present (runs settled / rows / table)', /endless points \(O728\): runs settled \/ rows written \/ deleted \/ pass-line table/.test(SRC) && /s\('elpSettled', 0\)/.test(SRC));
  T('[7] rating writes do not look like endless ladder writes (board-build-details pin counts [w.ts | 0, w.build | 0] writes only)', !/w\.details\]\);/.test(SRC));
  T('[7] loadSolo initialises hist (an older state file reads as empty history)', /st\.hist = st\.hist \|\| \{\}; return st;/.test(SRC) && /\{ runs: \{\}, wait: \{\}, ms: \{\}, held: \{\}, hist: \{\} \}/.test(SRC));
  T('[7] the O103 rating code is gone (75 / 25 weights, the cut table, the merged couch view)', !/W_BEST|W_AVG|ratingCutsOf|ratingHistView/.test(SRC));
  T('[7] O825: the projection writes ONE board (ENDLESS_RATING_LB = endless_rating_all); the four per-family names appear only where they are declared, listed (RATING_FAMS) and exported (solo also where the one board\'s default follows a redirected rig) -- nothing resolves, reads or writes them',
    v.ENDLESS_RATING_LB === 'endless_rating_all' && /const name = seasonBoardName\(ENDLESS_RATING_LB, seasonId\);/.test(laneSrc) && !/RATING_FAMS/.test(laneSrc)
    && Object.entries({ SOLO: 6, DUO: 4, TRIO: 4, QUAD: 4 }).every(([f, n]) => (SRC.match(new RegExp('ENDLESS_RATING_LB_' + f + '\\b', 'g')) || []).length === n));
  T('[7] O825: the upkeep runs under the guard (the three parts of the chain memory restored on a throw, a warning, false); the row plan has its own', /try \{ keep = JSON\.stringify\(/.test(up) && /it never runs without its way back/.test(up) && /try \{ return await elpUpkeepRun\(st\); \}\n\s*catch \(e\) \{\n\s*const back = JSON\.parse\(keep\);/.test(up) && /st\.hist = back\[0\];/.test(up) && /the lane is skipped this run/.test(up)
    && /\} catch \(e\) \{ ghWarn\('rating: the row plan threw/.test(laneSrc));
  T('[7] O825: one order for the settle loop and the member reading (elpPassOrder over elpPendingSettles; no second copy of the condition)', /const order = elpPassOrder\(st, p, seasonNow \| 0, nowMs\);/.test(v.elpSettleAll.toString()) && /elpPassOrder\(st, p, s, nowMs\)/.test(v.elpMemberHiddenBefore.toString()) && !/elpAllOf|placed/.test(v.elpMemberHiddenBefore.toString())
    && /elpPendingSettles\(h, nowMs\)/.test(v.elpPassOrder.toString()) && ![v.elpSettleAll, v.elpPassOrder, v.elpMemberHiddenBefore, v.elpRunsBefore, v.elpMergeByStart].some((f) => /IDLE_MS|\[7\]/.test(f.toString())));
}

// ---- e2e harness (test/team-comp-ghost-xp.js shape: offline stateless board stub, every *_FILE redirected into a temp cwd) ----
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const nm = /name=([^&]+)/.exec(String(init.body || \'\')); const have = nm ? FX.boards.find(b => b.name === decodeURIComponent(nm[1])) : null; const id = have ? have.id : nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files, env, validatePath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rating-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T12:00:00Z',   // pre-season (season 0): rating boards are the base names; day 20261001
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const sumPath = path.join(dir, 'summary.md');
    if (e.GITHUB_STEP_SUMMARY === 'auto') e.GITHUB_STEP_SUMMARY = sumPath;   // [14]: the run summary, read back below
    const r = spawnSync(process.execPath, ['-r', stub, validatePath || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    let summary = ''; try { summary = fs.readFileSync(sumPath, 'utf8'); } catch (err) {}
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// stored instants move back instead of waiting (pacing / maturity)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  return files;
}
const BOARD = { progress: 5, cp: 8, compDuo: 16, compTrio: 13, compQuad: 17, rSolo: 30, rDuo: 31, rTrio: 32, rQuad: 33, rAll: 34, tiercut: 41, vgate: 40 };
const CARRIER = SID(777);
function world(rows, extraRating, tiercutRows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of (rows || [])) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: BOARD.cp, name: 'cp_bank', entries: [SID(1), SID(2)].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compQuad, name: 'endless_comp_quad', entries: [] },
    { id: BOARD.rAll, name: 'endless_rating_all', entries: (extraRating && extraRating.all) || [] },
    { id: BOARD.rSolo, name: 'endless_rating_solo', entries: (extraRating && extraRating.solo) || [] }, { id: BOARD.rDuo, name: 'endless_rating_duo', entries: [] },
    { id: BOARD.rTrio, name: 'endless_rating_trio', entries: [] }, { id: BOARD.rQuad, name: 'endless_rating_quad', entries: [] },
    { id: BOARD.tiercut, name: 'endless_tiercut', entries: tiercutRows || [] },
    { id: BOARD.vgate, name: 'version_gate', entries: [{ steamID: CARRIER, score: 2026100101 }] });
  return boards;
}
const postsTo = (r, boardId, kind) => r.posts.filter(x => new RegExp(kind || 'SetLeaderboardScore').test(x.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(x.body));
const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };

// ---- [8] e2e: settle-free tick -- the upkeep settles an idle run, the projection rewrites / deletes rows, the table ----
console.log('-- [8] e2e: points rows + the pass-line table on a settle-free tick --');
{
  const T0 = Date.now() - 3 * DAY;
  const hist = {};
  const placed = [], exp = {};
  for (let i = 0; i < 25; i++) { const sid = SID(100 + i); played({ hist }, P(sid), [i + 3, i + 3, i + 3, i + 3, i + 13], T0); placed.push(sid); }
  const sidIdle = SID(150);
  played({ hist }, P(sidIdle), [9, 9, 9, 9, 9, 9], T0);
  for (const sid of [SID(200), SID(201)]) played({ hist }, P(sid), [9, 9, 9], T0);
  v.elpSettleAll({ hist }, 0, T0 + DAY);
  // the idle one: a seventh run, last seen 25 h ago, never final, no save point
  v.ratingHistUpsert({ hist }, P(sidIdle), 'solo', 0, 777, 2, Date.now() - 25 * 3600000, 0, 4321);
  for (const sid of placed) exp[sid] = v.ratingScoreOf({ hist }, P(sid), 0);
  const after = JSON.parse(JSON.stringify({ hist }));
  v.elpSettleAll(after, 0, Date.now());
  exp[sidIdle] = v.ratingScoreOf(after, P(sidIdle), 0);
  const stale = placed.concat([sidIdle]).map((sid) => ({ steamID: sid, score: 1, details: [0, 0, 0, 0] }))
    .concat([SID(200), SID(201)].map((sid) => ({ steamID: sid, score: 500, details: [9, 900, 3, 0] })))   // not placed (three runs): deleted
    .concat([{ steamID: SID(300), score: 777, details: [] }]);   // no history: deleted
  const solo = { runs: {}, wait: {}, ms: {}, held: {}, hist };
  // the same stale rows sit on the old solo board too: the job must not touch them there (O825: that board is no longer read or written)
  const r1 = runCron(world([], { all: stale, solo: stale }), { SOLO_FILE: solo });
  T('[8] run exits 0 (no fresh matches)', r1.code === 0, r1.out.slice(-600));
  const w1 = postsTo(r1, BOARD.rAll);
  const wrote = {}; for (const w of w1) wrote[field(w, 'steamid')] = { s: Number(field(w, 'score')), det: detailsOf(w) };
  T('[8] 26 placed players rewritten: score = points, details = the points row (ForceUpdate)', w1.length === 26 && placed.concat([sidIdle]).every((sid) => wrote[sid] && wrote[sid].s === exp[sid].score && JSON.stringify(wrote[sid].det) === JSON.stringify(exp[sid].details)) && w1.every((w) => field(w, 'scoremethod') === 'ForceUpdate'),
    'writes=' + w1.length + ' sample=' + JSON.stringify(wrote[sidIdle]) + ' exp=' + JSON.stringify(exp[sidIdle]));
  const hI = ((r1.state.SOLO_FILE || {}).hist || {})[P(sidIdle) + '|solo|0'], cI = ((r1.state.SOLO_FILE || {}).hist || {})[P(sidIdle) + '|all|0'];
  T('[8] the idle run (25 h, no save point) settled on the settle-free tick and the chain memory was saved', !!hI && !!cI && hI.runs.some((r) => r[0] === 777 && r[3] === 2) && cI.ring[0].mh === 4321 && /endless points solo /.test(r1.out), JSON.stringify(hI && hI.runs.slice(-2)));
  eq('[8] the three rows of no placed player deleted (two with three runs, one without history)', postsTo(r1, BOARD.rAll, 'DeleteLeaderboardScore').map((w) => field(w, 'steamid')).sort(), [SID(200), SID(201), SID(300)].sort());
  T('[8] O825: the four per-family boards are left alone -- nothing written, nothing deleted (the stale rows on the old solo board stay)', [BOARD.rSolo, BOARD.rDuo, BOARD.rTrio, BOARD.rQuad].every((id) => postsTo(r1, id).length === 0 && postsTo(r1, id, 'DeleteLeaderboardScore').length === 0)
    && !/provisioned endless_rating_(solo|duo|trio|quad)/.test(r1.out));
  const tc1 = postsTo(r1, BOARD.tiercut);
  T('[8] table published once, under the version_gate carrier account, score = UTC day of the (pinned) clock', tc1.length === 1 && field(tc1[0], 'steamid') === CARRIER && Number(field(tc1[0], 'score')) === 20261001, JSON.stringify(tc1.map((w) => w.body)));
  if (tc1.length) {
    const dec = v.tiercutDecode(Number(field(tc1[0], 'score')), detailsOf(tc1[0]));
    const hs = Object.values(v.elpHiddensOf(after, 'solo', 0));
    const want = v.elpLinesOf(hs, SOLO);
    T('[8] v2 table: solo = the blend over the 26 placed (w = 6/180), duo..quad = the prior with N 0; the rules constants ride along', !!dec && dec.season === 0 && dec.rulesSame && dec.byFam.solo.N === 26 && JSON.stringify(dec.byFam.solo.pass) === JSON.stringify(want.pass) && Math.abs(want.w - 6 / 180) < 1e-9
      && dec.byFam.duo.N === 0 && JSON.stringify(dec.byFam.duo.pass) === JSON.stringify(ELP.PRIOR.duo) && JSON.stringify(dec.byFam.quad.pass) === JSON.stringify(ELP.PRIOR.quad), JSON.stringify(dec));
    const tabs = (r1.state.SOLO_FILE || {}).elpTab || [];
    T('[8] the table is recorded in the chain memory (the settle reads the one in force)', tabs.length === 1 && tabs[0].day === 20261001 && tabs[0].season === 0 && JSON.stringify(tabs[0].byFam.solo.pass) === JSON.stringify(dec.byFam.solo.pass));
    T('[8] the summary line reports the field (numbers only: placed players, median points, median skill a family)', /rating summary \{"rated":26,"p50":\d+,"p50hidden100":\{"solo":\d+,"duo":\d+,"trio":\d+,"quad":\d+\}\}/.test(r1.out) && !new RegExp(SID(100)).test(r1.out.split('rating summary')[1] || ''));
    const current = placed.concat([sidIdle]).map((sid) => ({ steamID: sid, score: exp[sid].score, details: exp[sid].details }));
    const carrierRow = [{ steamID: CARRIER, score: 20261001, details: detailsOf(tc1[0]) }];
    const r2 = runCron(world([], { all: current }, carrierRow), { SOLO_FILE: r1.state.SOLO_FILE });
    T('[8] second tick, everything current: zero rating writes / deletes, table not republished (same day, same rules)', r2.code === 0 && postsTo(r2, BOARD.rAll).length === 0 && postsTo(r2, BOARD.rAll, 'DeleteLeaderboardScore').length === 0 && postsTo(r2, BOARD.tiercut).length === 0 && ((r2.state.SOLO_FILE || {}).elpTab || []).length === 1,
      r2.out.split('\n').filter((l) => /tiercut|rating|endless points/.test(l)).join(' | '));
    const r3 = runCron(world([], { all: current }, carrierRow), { SOLO_FILE: r1.state.SOLO_FILE }, { SEASON_NOW: '2026-10-02T00:00:01Z' });
    const tc3 = postsTo(r3, BOARD.tiercut);
    T('[8] next UTC day: recorded and republished (score 20261002) under the SAME account as the row on the board; rows untouched', r3.code === 0 && tc3.length === 1 && Number(field(tc3[0], 'score')) === 20261002 && field(tc3[0], 'steamid') === CARRIER && postsTo(r3, BOARD.rAll).length === 0 && ((r3.state.SOLO_FILE || {}).elpTab || []).length === 2, JSON.stringify(tc3.map((w) => w.body)));
    // a rules change (the recorded table was made under other rules) the same day: recorded again at once; the board row (an older
    //   prior's lines) differs -> republished the same day
    const s6 = JSON.parse(JSON.stringify(r1.state.SOLO_FILE)); s6.elpTab[0].key = 'old rules';
    const oldDet = detailsOf(tc1[0]).slice(); oldDet[8] += 1;
    const r6 = runCron(world([], { all: current }, [{ steamID: CARRIER, score: 20261001, details: oldDet }]), { SOLO_FILE: s6 });
    const tc6 = postsTo(r6, BOARD.tiercut), tabs6 = (r6.state.SOLO_FILE || {}).elpTab || [];
    T('[8] rules changed the same day: a new table recorded at once, the carrier row (other lines) republished the same day', r6.code === 0 && tc6.length === 1 && Number(field(tc6[0], 'score')) === 20261001 && tabs6.length === 2 && tabs6[1].key === v.elpTableKey(), JSON.stringify([tc6.length, tabs6.map((t) => t.key.slice(0, 12))]));
    const r4 = runCron(world([], { all: current }, []), { SOLO_FILE: r1.state.SOLO_FILE }, { TIERCUT_CARRIER_SID: SID(555) });
    const tc4 = postsTo(r4, BOARD.tiercut);
    T('[8] TIERCUT_CARRIER_SID pins the carrier account (an empty carrier board: published)', tc4.length === 1 && field(tc4[0], 'steamid') === SID(555));
    const noVg = world([], { all: current }, []).filter((b) => b.name !== 'version_gate');
    const r5 = runCron(noVg, { SOLO_FILE: r1.state.SOLO_FILE });
    T('[8] no carrier account available (no version_gate row, env unset): not published, run green, rows maintained', r5.code === 0 && postsTo(r5, BOARD.tiercut).length === 0 && /no carrier account/.test(r5.out));
    // season 1 (S1 opens 2026-12-01): the season boards, nobody placed yet (placement again), a season-1 table of the prior
    const r7 = runCron(world([], { all: current }, carrierRow), { SOLO_FILE: r1.state.SOLO_FILE }, { SEASON_NOW: '2026-12-01T00:10:00Z' });
    const tc7 = postsTo(r7, BOARD.tiercut), dec7 = tc7.length ? v.tiercutDecode(Number(field(tc7[0], 'score')), detailsOf(tc7[0])) : null;
    T('[8] season 1: the season-1 points board is resolved, the season-0 rows are not touched, no row written (nobody placed in season 1)', r7.code === 0 && /season board created: endless_rating_all_s1 /.test(r7.out) && !/season board created: endless_rating_(solo|duo|trio|quad)_s1/.test(r7.out) && postsTo(r7, BOARD.rAll).length === 0 && postsTo(r7, BOARD.rAll, 'DeleteLeaderboardScore').length === 0
      && Array.from(r7.out.matchAll(/season board created: endless_rating_[a-z]+_s1 id=(\d+)/g)).map((mm) => mm[1]).every((id) => postsTo(r7, id).length === 0 && postsTo(r7, id, 'DeleteLeaderboardScore').length === 0),
      r7.out.split('\n').filter((l) => /rating|tiercut/.test(l)).join(' | '));
    T('[8] season 1: a season-1 table of the prior lines (N 0) published on day 20261201', !!dec7 && dec7.season === 1 && dec7.day === 20261201 && dec7.byFam.solo.N === 0 && JSON.stringify(dec7.byFam.solo.pass) === JSON.stringify(SOLO), JSON.stringify(dec7));
  }
}

// ---- [9] e2e settle: a duo competitive run over two segments, the second final ----
console.log('-- [9] e2e: a settled duo run -> history -> placement run 1 --');
{
  const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const SEED = 9;
  function rec7(hash, seat, ros, sd, ed, flags) {
    const pc = ros.length;
    const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, pc, 900];
    for (let i = 0; i < pc; i++) d.push([400, 300][i]);
    d.push(0);
    for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
    d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
    return d;
  }
  function start7(hash, seat, ros) {
    const pc = ros.length;
    const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
    for (let i = 0; i < pc; i++) d.push(0);
    d.push(0);
    for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
    return d;
  }
  const seg = (hash, ros, sd, ed, fl) => ros.map((sid, i) => ({ sid, d: start7(hash, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(hash, i, ros, sd, ed, attest.SEG_COMP | (fl | 0)) })));
  const ros = [SID(1), SID(2)];
  const rows1 = seg(0x4a01, ros, 0, 5);
  const r1 = runCron(world(rows1), null);
  T('[9] first sighting: paced (nothing settled yet), run green', r1.code === 0 && /endless-comp-pacing/.test(r1.out), r1.out.slice(-400));
  const r2 = runCron(world(rows1), advance(r1.state, 10 * 60000));
  const key = v.teamRunKey(ros, 0, SEED), rid = v.ratingRunId(key);
  const hA = ((r2.state.SOLO_FILE || {}).hist || {})[P(SID(1)) + '|duo|0'], hB = ((r2.state.SOLO_FILE || {}).hist || {})[P(SID(2)) + '|duo|0'];
  T('[9] ten minutes later the segment settles: both writers get the duo run at depth 5 with the run seed, not final, not settled', r2.code === 0 && /endless-comp settle/.test(r2.out) && hA && hB && hA.runs.length === 1 && hA.runs[0][0] === rid && hA.runs[0][1] === 5 && hA.runs[0][8] === SEED && hA.runs[0][7] === 0 && hA.runs[0][3] === 0 && hB.runs[0][1] === 5,
    JSON.stringify([hA, hB]) + ' ' + r2.out.split('\n').filter((l) => /endless-comp|rating/.test(l)).join(' | '));
  T('[9] the history has no steamID (pid-keyed, like the chain memory)', !JSON.stringify((r2.state.SOLO_FILE || {}).hist).includes(SID(1)));
  const rows2 = rows1.concat(seg(0x4a02, ros, 5, 10, F));
  const r3 = runCron(world(rows2), advance(r2.state, 10 * 60000));
  const r4 = runCron(world(rows2), advance(r3.state, 10 * 60000));
  const hA4 = ((r4.state.SOLO_FILE || {}).hist || {})[P(SID(1)) + '|duo|0'], hB4 = ((r4.state.SOLO_FILE || {}).hist || {})[P(SID(2)) + '|duo|0'], cA4 = ((r4.state.SOLO_FILE || {}).hist || {})[P(SID(1)) + '|all|0'];
  T('[9] the final segment (5 -> 10) raises the same run and ends it: settled for both as placement run 1 (d 0, a target), a receipt of 0 keyed by the run seed',
    r3.code === 0 && r4.code === 0 && hA4 && hB4 && cA4 && hA4.runs.length === 1 && hA4.runs[0][1] === 10 && hA4.runs[0][3] === 2 && hA4.runs[0][4] === 0 && hA4.runs[0][5] >= 1 && cA4.n === 1 && !cA4.placed
      && cA4.ring.length === 1 && cA4.ring[0].mh === SEED && cA4.ring[0].delta === 0 && hB4.runs[0][3] === 2,
    JSON.stringify([hA4, hB4, cA4]) + ' ' + r4.out.split('\n').filter((l) => /endless-comp|endless points/.test(l)).join(' | '));
  T('[9] nobody placed after one run -> no row written (the points board, the old duo board)', postsTo(r4, BOARD.rAll).length === 0 && postsTo(r4, BOARD.rDuo).length === 0);
  const tm2 = ((r2.state.SOLO_FILE || {}).elpTeam || {})[String(rid)], tm4 = ((r4.state.SOLO_FILE || {}).elpTeam || {})[String(rid)];
  T('[9] O803: the lane recorded the run\'s roster by run id (both pids, duo, season 0) on the first segment, and the settle froze the team level (nobody with a skill: null, has) -- the entry rides the chain memory',
    !!tm2 && JSON.stringify(tm2.r) === JSON.stringify([P(SID(1)), P(SID(2))].sort()) && tm2.fam === 'duo' && tm2.s === 0 && !tm2.has && !!tm4 && tm4.has === 1 && tm4.h === null && /team level none/.test(r4.out), JSON.stringify([tm2, tm4]));
  T('[9] O803: the roster entry has no steamID either', !JSON.stringify((r4.state.SOLO_FILE || {}).elpTeam).includes(SID(1)));
}

// ---- [11] O803: the one target of a team run (the frozen team level) ----
console.log('-- [11] O803 team runs: the roster by run id, the frozen team level, one T for every seat --');
// the pair: A (placed, five duo runs at 20 = skill 2000) and B (placed, five at 8 = 800) share run RID at depth 14; the team level
//   1400 gives T = targetOf(.., 1400); A settles first, B a day later after two deep runs of his own (his skill moves to 1440)
const DUO = ELP.PRIOR.duo;
function teamWorld(m) {
  const now = 100 * DAY, st = { hist: {} };
  const play = (p, depths, t0) => depths.forEach((d, i) => m.ratingHistUpsert(st, p, 'duo', 0, 100 + i, d, t0 + i * 60000, F, 500 + i));
  play('A', [20, 20, 20, 20, 20], now - 5 * DAY); play('B', [8, 8, 8, 8, 8], now - 5 * DAY);
  m.elpSettleAll(st, 0, now - 4 * DAY);
  return { st, now };
}
// A's record first (t1), B's record of the same run a day later (t3), B's two own runs (t2) in between
function teamScenario(m, opts) {
  const { st, now } = teamWorld(m), RID = 9001, t1 = now - 3 * DAY, t2 = now - 2 * DAY, t3 = now - DAY;
  m.ratingHistUpsert(st, 'A', 'duo', 0, RID, 14, t1, F, 777);
  if (!(opts && opts.noNote)) m.elpTeamNote(st, RID, ['A', 'B'], 'duo', 0, t1);
  const d1 = m.elpSettleAll(st, 0, t1 + 60000);
  m.ratingHistUpsert(st, 'B', 'duo', 0, 300, 40, t2, F, 900); m.ratingHistUpsert(st, 'B', 'duo', 0, 301, 40, t2 + 60000, F, 901);
  const d2 = m.elpSettleAll(st, 0, t2 + 120000);
  m.ratingHistUpsert(st, 'B', 'duo', 0, RID, 14, t3, F, 777);
  if (!(opts && opts.noNote)) m.elpTeamNote(st, RID, ['A', 'B'], 'duo', 0, t3);
  const d3 = m.elpSettleAll(st, 0, now);
  return { st, RID, a: d1.find((x) => x.runId === RID && x.k === 'A|duo|0'), b: d3.find((x) => x.runId === RID && x.k === 'B|duo|0'), mid: d2, now };
}
{
  const sc = teamScenario(v), { st, RID, a, b } = sc;
  const Tw = PP.targetOf(0, DUO, 777, 1400, false);
  T('[11] A settles first: his target = targetOf(.., teamHiddenOf([2000, 800]) = 1400) = ' + Tw + ' (own skill would give ' + PP.targetOf(0, DUO, 777, 2000, false) + '); the team level is frozen in the entry (h 1400, has)',
    !!a && a.T === Tw && a.teamH === 1400 && st.elpTeam && st.elpTeam[String(RID)] && st.elpTeam[String(RID)].h === 1400 && st.elpTeam[String(RID)].has === 1, JSON.stringify([a, st.elpTeam]));
  const hB2 = PP.hiddenOf([40, 40, 8, 8, 8, 8, 8]), th2 = PP.teamHiddenOf([2000, hB2]);
  T('[11] in between B settles two runs of his own (40 / 40): his skill moves 800 -> ' + hB2 + ' (their targets read his own skill: no roster)', sc.mid.length === 2 && sc.mid.every((x) => x.teamH === undefined) && hB2 === 1440 && st.hist['B|duo|0'].runs.filter((r) => r[3]).length === 8, JSON.stringify(sc.mid));
  T('[11] B settles the shared run a day later: the SAME target ' + Tw + ' (the frozen level, not teamHiddenOf([2000, ' + hB2 + ']) = ' + th2 + ' -> ' + PP.targetOf(0, DUO, 777, th2, false) + ')', !!b && b.T === Tw && b.teamH === 1400 && b.T === a.T && PP.targetOf(0, DUO, 777, th2, false) !== Tw, JSON.stringify(b));
  const hA = st.hist['A|duo|0'], hB = st.hist['B|duo|0'], rA = hA.runs.find((r) => r[0] === RID), rB = hB.runs.find((r) => r[0] === RID), cA = st.hist['A|all|0'], cB = st.hist['B|all|0'];
  T('[11] both passed (14 >= ' + Tw + '): their d differ (own tier / own skill: A ' + rA[4] + ', B ' + rB[4] + ') and keep one sign; receipts keyed by the run seed 777 for both', a.pass && b.pass && rA[4] > 0 && rB[4] > 0 && rA[4] !== rB[4] && rA[5] === Tw && rB[5] === Tw
    && cA.ring.some((e) => e.mh === 777 && e.delta === rA[4]) && cB.ring.some((e) => e.mh === 777 && e.delta === rB[4]), JSON.stringify([rA, rB]));
  // a miss for both: the same run at depth 5 (below T) with another seed -> both lose, by different amounts
  {
    const { st: s2, now: n2 } = teamWorld(v), RID2 = 9002, t = n2 - DAY;
    v.ratingHistUpsert(s2, 'A', 'duo', 0, RID2, 5, t, F, 778); v.ratingHistUpsert(s2, 'B', 'duo', 0, RID2, 5, t, F, 778); v.elpTeamNote(s2, RID2, ['A', 'B'], 'duo', 0, t);
    const dd = v.elpSettleAll(s2, 0, n2), xa = dd.find((x) => x.k === 'A|duo|0'), xb = dd.find((x) => x.k === 'B|duo|0');
    T('[11] the same run missed by the team (depth 5 < T ' + xa.T + '): both lose (A ' + xa.d + ' / B ' + xb.d + '), one T, different d', xa.T === xb.T && xa.T === PP.targetOf(0, DUO, 778, 1400, false) && !xa.pass && !xb.pass && xa.d < 0 && xb.d < 0 && xa.d !== xb.d, JSON.stringify([xa, xb]));
  }
  // a placing seat: C has no duo run yet, D is placed at 2000; the team level = teamHiddenOf([null, 2000]) = 2000 -> C's target reads it,
  //   C's seed (fifth run) reads his own skill
  {
    const now = 100 * DAY, s3 = { hist: {} };
    [20, 20, 20, 20, 20].forEach((d, i) => v.ratingHistUpsert(s3, 'D', 'duo', 0, 100 + i, d, now - 5 * DAY + i * 60000, F, 500 + i)); v.elpSettleAll(s3, 0, now - 4 * DAY);
    const t = now - DAY;
    v.ratingHistUpsert(s3, 'C', 'duo', 0, 9003, 18, t, F, 779); v.ratingHistUpsert(s3, 'D', 'duo', 0, 9003, 18, t, F, 779); v.elpTeamNote(s3, 9003, ['C', 'D'], 'duo', 0, t);
    const dd = v.elpSettleAll(s3, 0, now), xc = dd.find((x) => x.k === 'C|duo|0'), xd = dd.find((x) => x.k === 'D|duo|0');
    T('[11] a placing seat (no duo run yet) beside a placed one: the team level is the placed seat\'s (' + xc.teamH + '), both read T ' + xc.T + ' (not the silver line ' + PP.targetOf(0, DUO, 779, null, true) + '); the placing seat moves no points (d 0)',
      xc.teamH === 2000 && xc.T === xd.T && xc.T === PP.targetOf(0, DUO, 779, 2000, true) && xc.d === 0 && !s3.hist['C|all|0'].placed, JSON.stringify([xc, xd]));
    // C plays four more team runs with D (deep, 30): the fifth seeds from C's OWN skill over his five runs, not from the team level
    let d5 = [];   // one settle per run (as the job sees them): each run's team level reads the runs settled before it
    for (let i = 0; i < 4; i++) { const rid = 9010 + i, tt = now - DAY + (i + 1) * 3600000; v.ratingHistUpsert(s3, 'C', 'duo', 0, rid, 30, tt, F, 800 + i); v.ratingHistUpsert(s3, 'D', 'duo', 0, rid, 30, tt, F, 800 + i); v.elpTeamNote(s3, rid, ['C', 'D'], 'duo', 0, tt); d5 = v.elpSettleAll(s3, 0, tt + 1); }
    const hc = s3.hist['C|all|0'], last = d5.filter((x) => x.k === 'C|duo|0').pop(), five = [30, 30, 30, 30, 18].map((d) => ['duo', d]);
    T('[11] the placing seat\'s fifth run seeds from his own five depths read on the solo scale (elpHiddenFor(solo, five duo runs) = ' + PP.elpHiddenFor('solo', five, ELP.PRIOR) + '; O825), while its target read the team level ' + last.teamH,
      last && last.seeded && hc.placed === 1 && hc.lp === Math.max.apply(null, v.elpCandidateTabs(s3, 0, now, now + DAY).map((tb) => PP.endlessSeedLp(PP.elpHiddenFor('solo', five, tb), tb.solo))) && hc.seedRun[0] === 'duo' && last.teamH === PP.teamHiddenOf([PP.hiddenOf([30, 30, 30, 18], 1), PP.hiddenOf([30, 30, 30, 18, 20, 20, 20, 20, 20])]), JSON.stringify([last, hc.lp]));
  }
  // nobody with a skill: two new seats -> the team level is null (frozen as null) and the target is the silver line
  {
    const now = 100 * DAY, s4 = { hist: {} }, t = now - DAY;
    v.ratingHistUpsert(s4, 'E', 'duo', 0, 9020, 9, t, F, 790); v.ratingHistUpsert(s4, 'F', 'duo', 0, 9020, 9, t, F, 790); v.elpTeamNote(s4, 9020, ['E', 'F'], 'duo', 0, t);
    const dd = v.elpSettleAll(s4, 0, now);
    T('[11] two seats without a run yet: the team level is null (frozen with has), both read the silver line + the offset', dd.length === 2 && dd.every((x) => x.teamH === null && x.T === PP.targetOf(0, DUO, 790, null, true)) && s4.elpTeam['9020'].has === 1 && s4.elpTeam['9020'].h === null, JSON.stringify([dd, s4.elpTeam]));
  }
  // no roster recorded = own skill (solo, the couch pair, a run that entered before the rule)
  {
    const { st: s5, now: n5 } = teamWorld(v), t = n5 - DAY;
    v.ratingHistUpsert(s5, 'A', 'duo', 0, 9030, 14, t, F, 791); v.ratingHistUpsert(s5, 'B', 'duo', 0, 9030, 14, t, F, 791);
    const dd = v.elpSettleAll(s5, 0, n5), xa = dd.find((x) => x.k === 'A|duo|0'), xb = dd.find((x) => x.k === 'B|duo|0');
    T('[11] no roster recorded for the run: each seat reads his own skill, as before (A ' + xa.T + ' / B ' + xb.T + '), teamH undefined', xa.teamH === undefined && xb.teamH === undefined && xa.T === PP.targetOf(0, DUO, 791, 2000, false) && xb.T === PP.targetOf(0, DUO, 791, 800, false) && xa.T !== xb.T, JSON.stringify([xa, xb]));
    T('[11] elpTeamNote records team families only, two seats or more, sorted pids; a second note refreshes at and keeps the roster', v.elpTeamNote(s5, 1, ['x'], 'duo', 0, 5) === null && v.elpTeamNote(s5, 1, ['x', 'y'], 'solo', 0, 5) === null && v.elpTeamNote(s5, 1, ['x', 'y'], 'duoc', 0, 5) === null
      && JSON.stringify(v.elpTeamNote(s5, 2, ['y', 'x'], 'trio', 1, 5)) === JSON.stringify({ r: ['x', 'y'], fam: 'trio', s: 1, at: 5, t0: 5 }) && v.elpTeamNote(s5, 2, ['y', 'x'], 'trio', 1, 9).at === 9 && s5.elpTeam['2'].t0 === 5 && JSON.stringify(s5.elpTeam['2'].r) === JSON.stringify(['x', 'y']));
  }
  // the member reading: settled runs first seen no later than the run, the run itself left out; placed / placing / none
  {
    const s6 = { hist: {} }, t0 = 1000;
    [5, 6, 7, 8, 9].forEach((d, i) => v.ratingHistUpsert(s6, 'G', 'duo', 0, 100 + i, d, t0 + i, F, 500 + i)); v.elpSettleAll(s6, 0, t0 + 10);
    v.ratingHistUpsert(s6, 'G', 'duo', 0, 200, 50, t0 + 20, F, 600); v.elpSettleAll(s6, 0, t0 + 30);
    T('[11] elpMemberHiddenBefore: the settled runs first seen no later than the run (the run itself left out; later runs do not count): five or more = hiddenOf, fewer = their plain mean -- whatever his placement is NOW (O825 review: the reading looks at those runs only)',
      v.elpMemberHiddenBefore(s6, 'G', 'duo', 0, 999, t0 + 15) === PP.hiddenOf([9, 8, 7, 6, 5]) && v.elpMemberHiddenBefore(s6, 'G', 'duo', 0, 200, t0 + 20) === PP.hiddenOf([9, 8, 7, 6, 5]) && v.elpMemberHiddenBefore(s6, 'G', 'duo', 0, 999, t0 + 25) === PP.hiddenOf([50, 9, 8, 7, 6, 5])
      && v.elpMemberHiddenBefore(s6, 'G', 'duo', 0, 999, t0 + 3) === 650 && PP.hiddenOf([8, 7, 6, 5], 1) === 650);   // four runs before the run: their plain mean, though he is placed by now
    const s7 = { hist: {} };
    [5, 6].forEach((d, i) => v.ratingHistUpsert(s7, 'K', 'duo', 0, 100 + i, d, t0 + i, F, 500 + i)); v.elpSettleAll(s7, 0, t0 + 10);
    T('[11] elpMemberHiddenBefore: placing -> the plain mean of the runs so far (minRuns 1); none settled yet -> null; no entry -> null',
      v.elpMemberHiddenBefore(s7, 'K', 'duo', 0, 999, t0 + 15) === 550 && v.elpMemberHiddenBefore(s7, 'K', 'duo', 0, 999, t0 - 1) === null && v.elpMemberHiddenBefore(s7, 'Z', 'duo', 0, 999, t0 + 15) === null);
  }
  // expiry
  {
    const now = 100 * DAY, s8 = { hist: {} };
    v.elpTeamNote(s8, 1, ['a', 'b'], 'duo', 0, now - (R.TAB_DAYS + 1) * DAY);   // old, nobody carries it
    v.elpTeamNote(s8, 2, ['a', 'b'], 'duo', 0, now - (R.TAB_DAYS + 1) * DAY); v.ratingHistUpsert(s8, 'b', 'duo', 0, 2, 3, now - (R.TAB_DAYS + 1) * DAY, SUS, 7);   // old, b still carries it (a save point open)
    v.elpTeamNote(s8, 3, ['a', 'b'], 'duo', 0, now - DAY);   // fresh
    v.elpTeamNote(s8, 4, ['a', 'b'], 'duo', 1, now - (R.TAB_DAYS + 1) * DAY); v.ratingHistUpsert(s8, 'b', 'duo', 1, 4, 3, now - (R.TAB_DAYS + 1) * DAY, SUS, 7);   // old, another season (never settles)
    v.elpSettleAll(s8, 0, now);
    eq('[11] expiry at the end of elpSettleAll: older than TAB_DAYS and nobody of the current season still carries the run -> gone; still carried -> kept; fresh -> kept; an ended season\'s -> gone', Object.keys(s8.elpTeam).sort(), ['2', '3']);
    T('[11] elpTeamTrim on a state without the field / an empty pending set', v.elpTeamTrim({}, now) === 0 && v.elpTeamTrim({ elpTeam: { 9: { at: 0 } } }, now) === 1);
  }
  // mutations (the loader of [10])
  {
    const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
    const mutant = (pairs) => {
      let m = SRC;
      for (const [good, badS] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); m = m.split(good).join(badS); }
      m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rating-o803-'));
      const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
      try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
    };
    const sameT = (m) => { const r = teamScenario(m); return !!r.a && !!r.b && r.a.T === r.b.T && r.a.T === PP.targetOf(0, DUO, 777, 1400, false); };
    T('[11] baseline holds: both seats read the frozen team level', sameT(v));
    // the memo: between the two seats' settles, late segments raise two of B's runs from BEFORE the shared run (8 -> 40: his skill then
    //   reads 1867, not 800) -- the frozen level keeps the target A already settled against
    const memoT = (m) => { const { st, now } = teamWorld(m), RID = 9001, t1 = now - 3 * DAY, t3 = now - DAY;
      m.ratingHistUpsert(st, 'A', 'duo', 0, RID, 14, t1, F, 777); m.elpTeamNote(st, RID, ['A', 'B'], 'duo', 0, t1); const a = m.elpSettleAll(st, 0, t1 + 60000).find((x) => x.runId === RID);
      m.ratingHistUpsert(st, 'B', 'duo', 0, 100, 40, t1 + 120000, F, 500); m.ratingHistUpsert(st, 'B', 'duo', 0, 101, 40, t1 + 120000, F, 501);
      m.ratingHistUpsert(st, 'B', 'duo', 0, RID, 14, t3, F, 777); m.elpTeamNote(st, RID, ['A', 'B'], 'duo', 0, t3); const b = m.elpSettleAll(st, 0, now).find((x) => x.runId === RID);
      return !!a && !!b && a.T === b.T && b.teamH === 1400 && PP.hiddenOf([8, 8, 8, 40, 40]) === 1867 && PP.targetOf(0, DUO, 777, PP.teamHiddenOf([2000, 1867]), false) !== a.T; };
    T('[11] the frozen level holds when a member\'s earlier runs move between the two seats\' settles (late segments raise two of them)', memoT(v));
    let red = false;
    try { red = !memoT(mutant([['  if (tm.has) return tm.h;', '']])); } catch (e) { red = /anchor missing/.test(e.message) ? (bad('[11] ' + e.message), false) : true; }
    T('[11] mutation "the memo dropped (the team level recomputed at every settle)" turns the second seat\'s T red (his raised runs would move it)', red);
    let red2 = false;
    try { red2 = !sameT(mutant([['tm.h = pointsPlan.teamHiddenOf(tm.r.map((p) => elpMemberHiddenBefore(st, p, fam, s, r[0] >>> 0, at, nowMs)));', 'tm.h = elpMemberHiddenBefore(st, tm.r[0], fam, s, r[0] >>> 0, at, nowMs);']])); } catch (e) { red2 = /anchor missing/.test(e.message) ? (bad('[11] ' + e.message), false) : true; }
    T('[11] mutation "the team level read from one seat" turns the target red', red2);
    let red3 = false;
    try { red3 = !sameT(mutant([['const ths = teamH !== undefined ? [teamH] : ', 'const ths = false ? [teamH] : ']])); } catch (e) { red3 = /anchor missing/.test(e.message) ? (bad('[11] ' + e.message), false) : true; }
    T('[11] mutation "the target reads the own skill again" turns it red', red3);
  }
}

// ---- [12] Q395 / RC2-01: a team's two runs settled in one pass freeze the same team level as in two passes ----
console.log('-- [12] Q395: two runs of a team in one settle pass = in two passes --');
{
  // the cloud audit's case (archive/CLOUD_AUDIT_RC2_2026-11 RC2-01, the fixed point): X and Y five duo runs at 14-16 each, then the
  //   team run A (depth 2) and right after it B (depth 12). Two passes: A settles alone, B next time. One pass: both at once, the
  //   entries walked one by one -- before the fix B's level was frozen while the later entry still held A unsettled (1459, not 1450).
  //   order = which member's entry the pass walks first (the entries keep the order they entered the chain memory)
  const now = 100 * DAY;
  function pairWorld(m, order, depths) {
    const st = { hist: {} };
    for (const p of order) (depths[p] || []).forEach((d, i) => m.ratingHistUpsert(st, p, 'duo', 0, (p === order[0] ? 100 : 200) + i, d, now - 10 * DAY + i * 60000, F, (p === order[0] ? 500 : 600) + i));
    m.elpSettleAll(st, 0, now - 9 * DAY);
    return st;
  }
  const ing = (m, st, members, rid, d, seed, t, flags) => { for (const p of members) m.ratingHistUpsert(st, p, 'duo', 0, rid, d, t, flags == null ? F : flags, seed); m.elpTeamNote(st, rid, members.slice(), 'duo', 0, t); };
  // two runs A then B of the roster; split = A settles in a pass of its own; returns { sameT, lvlB, Tb, d (per member) }
  function twoRuns(m, order, depths, run, split) {
    const st = pairWorld(m, order, depths), tA = now - 600000, tB = split === 'tie' ? tA : now - 120000;
    ing(m, st, order, 7001, run.dA, run.sA, tA);
    if (split === true) m.elpSettleAll(st, 0, tA + 1000);
    ing(m, st, order, 9001, run.dB, run.sB, tB);
    const o = m.elpSettleAll(st, 0, now), b = o.filter((x) => x.runId === 9001), a = o.filter((x) => x.runId === 7001);
    return { st, a, b, lvlB: b.length ? b[0].teamH : undefined, Tb: b.length ? b[0].T : undefined, oneT: new Set(b.map((x) => x.T)).size === 1,
      d: order.map((p) => (st.hist[v.ratingHistKey(p, 'duo', 0)].runs.find((r) => r[0] === 9001) || [])[4]) };
  }
  const FIX = { X: [14, 15, 16, 15, 14], Y: [14, 15, 16, 15, 14] }, RUN = { dA: 2, sA: 4242, dB: 12, sB: 5151 };
  for (const order of [['X', 'Y'], ['Y', 'X']]) {
    const two = twoRuns(v, order, FIX, RUN, true), one = twoRuns(v, order, FIX, RUN, false);
    const want = PP.teamHiddenOf(order.map((p) => PP.hiddenOf([2].concat(FIX[p].slice().reverse()))));
    T('[12] fixed point, entries ' + order.join(' then ') + ': one pass freezes B\'s team level ' + one.lvlB + ' = two passes ' + two.lvlB + ' = every member\'s skill with A counted (' + want + '); one T ' + one.Tb + ', the same d',
      one.lvlB === two.lvlB && one.lvlB === want && one.Tb === two.Tb && one.oneT && two.oneT && JSON.stringify(one.d) === JSON.stringify(two.d), JSON.stringify([one.lvlB, two.lvlB, want, one.d, two.d]));
  }
  // a sweep: duo / trio, histories of 0..8 runs (placing seats included, the fifth run placing inside the pass), both entry orders
  let s0 = 20261110;
  const rnd = () => { s0 = (Math.imul(s0, 1103515245) + 12345) >>> 0; return s0 / 4294967296; };
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  function sweep(m, n) {
    let diff = 0, first = null;
    for (let t = 0; t < n; t++) {
      const size = ri(2, 3), names = ['M0', 'M1', 'M2'].slice(0, size), depths = {};
      for (const p of names) depths[p] = Array.from({ length: ri(0, 8) }, () => ri(1, 30));
      const run = { dA: ri(0, 30), sA: ri(1, 2 ** 31 - 1), dB: ri(0, 30), sB: ri(1, 2 ** 31 - 1) };
      const order = rnd() < 0.5 ? names : names.slice().reverse();
      const multi = (mm, sp) => { const st = { hist: {} }; for (const p of order) (depths[p] || []).forEach((d, i) => mm.ratingHistUpsert(st, p, 'duo', 0, 100 * (1 + names.indexOf(p)) + i, d, now - 10 * DAY + i * 60000, F, 500 + 100 * names.indexOf(p) + i)); mm.elpSettleAll(st, 0, now - 9 * DAY);
        const tA = now - 600000, tB = now - 120000; ing(mm, st, order, 7001, run.dA, run.sA, tA); if (sp) mm.elpSettleAll(st, 0, tA + 1000); ing(mm, st, order, 9001, run.dB, run.sB, tB);
        const o = mm.elpSettleAll(st, 0, now).filter((x) => x.runId === 9001);
        return JSON.stringify({ h: o.length ? o[0].teamH : 'none', T: o.map((x) => x.T), d: order.map((p) => (st.hist[mm.ratingHistKey(p, 'duo', 0)].runs.find((r) => r[0] === 9001) || [])[4]) }); };
      const a = multi(m, true), b = multi(m, false);
      if (a !== b) { diff++; if (!first) first = { depths, run, order, two: a, one: b }; }
    }
    return { diff, first };
  }
  { const r = sweep(v, 400); T('[12] sweep 400 rosters (duo / trio, 0..8 runs each, both entry orders): one pass = two passes for B\'s level, every T and every d (' + r.diff + ' differ)', r.diff === 0, JSON.stringify(r.first)); }
  // two runs first seen in the same pass (the same instant): A's level counts nothing of B (it came after A in every list)
  {
    const one = twoRuns(v, ['X', 'Y'], FIX, RUN, 'tie'), wantA = PP.teamHiddenOf(['X', 'Y'].map((p) => PP.hiddenOf(FIX[p].slice().reverse())));
    T('[12] A and B first seen at the same instant: A\'s level is the skill before A (' + wantA + '), B\'s counts A', one.a.length === 2 && one.a[0].teamH === wantA && one.lvlB === PP.teamHiddenOf(['X', 'Y'].map((p) => PP.hiddenOf([2].concat(FIX[p].slice().reverse())))), JSON.stringify([one.a.map((x) => x.teamH), one.lvlB]));
  }
  // the reading itself: a member's run the pass will settle counts before the next run of his list; one that waits does not
  {
    const st = { hist: {} }, t0 = now - DAY;
    [8, 10, 12, 14, 16].forEach((d, i) => v.ratingHistUpsert(st, 'Q', 'duo', 0, 100 + i, d, t0 + i, F, 500 + i)); v.elpSettleAll(st, 0, t0 + 10);
    v.ratingHistUpsert(st, 'Q', 'duo', 0, 300, 20, t0 + 20, F, 700);   // final, not settled yet: this pass settles it
    v.ratingHistUpsert(st, 'Q', 'duo', 0, 301, 40, t0 + 30, SUS, 701);   // a save point open: waits
    const before300 = v.elpMemberHiddenBefore(st, 'Q', 'duo', 0, 300, t0 + 20, now), before301 = v.elpMemberHiddenBefore(st, 'Q', 'duo', 0, 301, t0 + 30, now), after = v.elpMemberHiddenBefore(st, 'Q', 'duo', 0, 999, t0 + 40, now);
    const w5 = PP.hiddenOf([16, 14, 12, 10, 8]), w6 = PP.hiddenOf([20, 16, 14, 12, 10, 8]), w7 = PP.hiddenOf([40, 20, 16, 14, 12, 10, 8]);
    T('[12] elpMemberHiddenBefore: the run itself never counts (' + before300 + '); a final run the pass settles counts before the next run (' + before301 + '); a run with a save point open does not (' + after + ', not ' + w7 + ')',
      w5 !== w6 && w6 !== w7 && before300 === w5 && before301 === w6 && after === w6, JSON.stringify([before300, before301, after, w5, w6, w7]));
    T('[12] elpRunReady / elpPendingSettles: final or a newer run or idle without a save; the pass\'s prefix stops at the first that waits',
      v.elpRunReady(st.hist['Q|duo|0'], 5, now) && !v.elpRunReady(st.hist['Q|duo|0'], 6, now) && JSON.stringify([...v.elpPendingSettles(st.hist['Q|duo|0'], now)]) === '[5]'
      && v.elpRunReady({ runs: [[1, 3, 0, 0, 0, 0, 0, 0, 1]] }, 0, R.IDLE_MS) && !v.elpRunReady({ runs: [[1, 3, 0, 0, 0, 0, 0, 2, 1]] }, 0, R.IDLE_MS) && !v.elpRunReady({ runs: [[1, 3, 0, 0, 0, 0, 0, 0, 1]] }, 0, R.IDLE_MS - 1));
  }
  // static: the settle loop and the reading share one predicate (they must not drift)
  {
    const sa = v.elpSettleAll.toString(), ps = v.elpPendingSettles.toString();
    T('[12] the settle loop and the member reading both decide through elpPendingSettles -> elpRunReady (no second copy of the condition)', /elpPassOrder\(/.test(sa) && /elpPendingSettles\(h, nowMs\)/.test(v.elpPassOrder.toString()) && /if \(!elpRunReady\(h, i, nowMs\)\) break;/.test(ps) && !/IDLE_MS/.test(sa) && !/IDLE_MS/.test(ps));
  }
  // mutations (the loader of [11])
  {
    const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
    const mutant = (pairs) => {
      let m = SRC;
      for (const [good, badS] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); m = m.split(good).join(badS); }
      m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rating-q395-'));
      const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
      try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
    };
    const fixedPointSame = (m) => ['XY', 'YX'].every((o) => { const ord = o.split(''); const a = twoRuns(m, ord, FIX, RUN, true), b = twoRuns(m, ord, FIX, RUN, false); return a.lvlB === b.lvlB && a.Tb === b.Tb; });
    let red = false;
    try { const mm = mutant([['    const ok = j != null && (ix < 0 || j < ix);', '    const ok = false;']]); red = !fixedPointSame(mm) && sweep(mm, 200).diff > 0; } catch (e) { red = /anchor missing/.test(e.message) ? (bad('[12] ' + e.message), false) : true; }
    T('[12] mutation "only the runs settled already count" (the code before the fix) turns the fixed point and the sweep red', red);
    let red2 = false;
    try { const mm = mutant([['    const ok = j != null && (ix < 0 || j < ix);', '    const ok = j != null;']]); const one = twoRuns(mm, ['X', 'Y'], FIX, RUN, 'tie'); red2 = one.a[0].teamH !== PP.teamHiddenOf(['X', 'Y'].map((p) => PP.hiddenOf(FIX[p].slice().reverse()))); } catch (e) { red2 = /anchor missing/.test(e.message) ? (bad('[12] ' + e.message), false) : true; }
    T('[12] mutation "no cut at the run\'s place in the list" counts B inside A\'s level when both came at the same instant -> red', red2);
  }
}

// ---- [10] mutation self-checks (validate.js copies loaded in-process; main() only runs as the entry module) ----
console.log('-- [10] mutation self-checks --');
{
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
  const mutant = (pairs) => {
    let m = SRC;
    for (const [good, badS] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); m = m.split(good).join(badS); }
    m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rating-mut-'));
    const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
    try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  };
  const now = 100 * DAY;
  const scen = {
    finalSettles: (m) => { const st = { hist: {} }; m.ratingHistUpsert(st, 'x', 'solo', 0, 1, 5, now - 60000, F, 1); return m.elpSettleAll(st, 0, now).length === 1; },
    saveWaits: (m) => { const st = { hist: {} }; m.ratingHistUpsert(st, 'x', 'solo', 0, 1, 5, now - 3 * DAY, SUS, 1); return m.elpSettleAll(st, 0, now).length === 0; },
    newerSettles: (m) => { const st = { hist: {} }; m.ratingHistUpsert(st, 'x', 'solo', 0, 1, 5, now - 60000, 0, 1); m.ratingHistUpsert(st, 'x', 'solo', 0, 2, 5, now, 0, 2); return m.elpSettleAll(st, 0, now).length === 1; },
    bestCandidate: (m) => {
      const strict = [3, 8, 14, 20, 30, 45, 60], loose = [2, 5, 8, 12, 20, 30, 45];
      const st = { hist: {}, elpTab: [{ day: 1, season: 0, ms: now - 20 * DAY, key: m.elpTableKey(), byFam: { solo: { N: 300, pass: strict } } }, { day: 2, season: 0, ms: now - DAY / 2, key: m.elpTableKey(), byFam: { solo: { N: 300, pass: loose } } }] };
      [8, 8, 8, 8, 8].forEach((d, i) => m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, d, now - 10 * DAY + i, F, 500 + i)); m.elpSettleAll(st, 0, now - DAY);
      const lp0 = st.hist['x|all|0'].lp; m.ratingHistUpsert(st, 'x', 'solo', 0, 400, 9, now - DAY, F, 77); m.elpSettleAll(st, 0, now);
      const each = [strict, loose].map((ls) => PP.endlessSettle(lp0, 9 >= PP.targetOf(lp0, ls, 77, 800, false), 800, ls, PP.targetOffset(77)).nv);
      return st.hist['x|all|0'].lp === Math.max.apply(null, each);
    },
    seedOverFive: (m) => { const st = { hist: {} }; [4, 12, 7, 9, 30].forEach((d, i) => m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, d, now - DAY + i, F, 500 + i)); m.elpSettleAll(st, 0, now); return st.hist['x|all|0'].lp === PP.endlessSeedLp(PP.hiddenOf([30, 9, 7, 12, 4]), SOLO); },
    skillBefore: (m) => {
      // nine runs 12..28 (skill 2000 = diamond); a platinum player misses with a 0: the skill of the runs before (diamond) protects
      //   and halves the loss; counting the run itself (1900 = platinum) would not
      const st = { hist: {} }; [12, 14, 16, 18, 20, 22, 24, 26, 28].forEach((d, i) => m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, d, now - 2 * DAY + i, F, 500 + i)); m.elpSettleAll(st, 0, now);
      const h = st.hist['x|all|0']; h.lp = 3500; m.ratingHistUpsert(st, 'x', 'solo', 0, 200, 0, now - DAY, F, 900); m.elpSettleAll(st, 0, now);
      return h.lp === PP.endlessSettle(3500, false, 2000, SOLO, PP.targetOffset(900)).nv && PP.endlessSettle(3500, false, 2000, SOLO, PP.targetOffset(900)).nv !== PP.endlessSettle(3500, false, 1900, SOLO, PP.targetOffset(900)).nv;
    },
    receiptBySeed: (m) => { const st = { hist: {} }; m.ratingHistUpsert(st, 'x', 'solo', 0, 1, 5, now - 60000, F, 4321); m.elpSettleAll(st, 0, now); return st.hist['x|all|0'].ring[0].mh === 4321; },
    refund: (m) => {
      const st = { hist: {} }; [10, 10, 10, 10, 10, 30].forEach((d, i) => m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, d, now - DAY + i, F, 500 + i)); m.elpSettleAll(st, 0, now);
      const h = st.hist['x|solo|0'], c = st.hist['x|all|0'], lp0 = c.lp, d = h.runs[5][4]; m.ratingHistRemove(st, 'x', 'solo', 0, 105); return d !== 0 && c.lp === lp0 - d;
    },
    unplace: (m) => { const st = { hist: {} }; [10, 10, 10, 10, 10].forEach((d, i) => m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, d, now - DAY + i, F, 500 + i)); m.elpSettleAll(st, 0, now); m.ratingHistRemove(st, 'x', 'solo', 0, 104); return !st.hist['x|all|0'].placed; },
    goneRefund: (m) => {
      // 16 runs: the 6 oldest leave the window, run 105 (the first rated one) among them; its conviction still refunds its points
      const st = { hist: {} }; for (let i = 0; i < 16; i++) m.ratingHistUpsert(st, 'x', 'solo', 0, 100 + i, 10, now - DAY + i, F, 500 + i); m.elpSettleAll(st, 0, now);
      const h = st.hist['x|solo|0'], c = st.hist['x|all|0'], g = (h.gone || []).find((x) => x[0] === 105), lp0 = c.lp;
      const dd = g ? g[1] : null; m.ratingHistRemove(st, 'x', 'solo', 0, 105);
      return dd != null && dd !== 0 && c.lp === lp0 - dd;
    },
    liveLines: (m) => { const many = []; for (let i = 0; i < 200; i++) many.push((i + 1) * 100); return JSON.stringify(m.elpLinesOf(many, SOLO).pass) === JSON.stringify([41, 106, 146, 171, 187, 196, 202]); },
  };
  const cases = [
    ['a final run waits', 'finalSettles', [['return !!(((r[7] | 0) & 1) || newer ||', 'return !!(newer ||']]],   // elpRunReady (Q395: the one predicate)
    ['an open save point settles at idle', 'saveWaits', [['(idle && !((r[7] | 0) & 2))', 'idle']]],
    ['a newer run does not settle the one before', 'newerSettles', [['((r[7] | 0) & 1) || newer || (idle', '((r[7] | 0) & 1) || (idle']]],
    ['the worst line set taken', 'bestCandidate', [['if (!best || sl.nv > best.sl.nv) best = { sl, t };', 'if (!best || sl.nv < best.sl.nv) best = { sl, t };']]],
    ['the seed without the fifth run', 'seedOverFive', [['const five = [[fam, depth]].concat(elpSettledRuns(st, p, s));', 'const five = elpSettledRuns(st, p, s);']]],
    ['the skill counts the run being settled', 'skillBefore', [['      const H = pointsPlan.elpHiddenFor(fam, before, tb);', '      const H = pointsPlan.elpHiddenFor(fam, [[fam, depth]].concat(before), tb);']]],
    ['receipts keyed by the run id', 'receiptBySeed', [['c.ring = receiptPush(c.ring || [], elpRunRk(s, r[8]), d, flags, 0xff);', 'c.ring = receiptPush(c.ring || [], r[0] | 0, d, flags, 0xff);']]],
    ['a conviction keeps the points', 'refund', [['const nv = Math.max(0, Math.min(LP_MAX, (c.lp | 0) - d));', 'const nv = c.lp | 0;']]],
    ['a convicted seeding run keeps the placement', 'unplace', [['if (c.placed && Array.isArray(c.seedRun) && c.seedRun[0] === fam && (c.seedRun[1] >>> 0) === runId) {', 'if (false) {']]],
    ['runs out of the window forgotten (no refund)', 'goneRefund', [['(h.gone = h.gone || []).push(g[3] === 2 ? [g[0] >>> 0, g[4] | 0, g[8] | 0, 1] : [g[0] >>> 0, g[4] | 0, g[8] | 0]);', '']]],
    ['the live lines never used', 'liveLines', [['out.push(Math.round((1 - w) * pr + w * (N ? lv : pr)));', 'out.push(pr);']]],
  ];
  for (const k of Object.keys(scen)) T('[10] baseline holds: ' + k, scen[k](v));
  for (const [name, sk, pairs] of cases) {
    let red = false;
    try { red = !scen[sk](mutant(pairs)); } catch (e) { red = /anchor missing/.test(e.message) ? (bad('[10] ' + e.message), false) : true; }
    T('[10] mutation "' + name + '" turns ' + sk + ' red', red);
  }
}

// ---- [13] O825: one points value over the four families ----
console.log('-- [13] O825: one points value a player a season --');
// a copy of validate.js with edits, loaded in-process (the loader of [10]) -- or its path, to run as the entry module ([14])
function mutantOf(pairs, asPath) {
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
  let m = SRC;
  for (const [good, badS] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); m = m.split(good).join(badS); }
  m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rating-o825-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
  if (asPath) return { path: p, done: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
  try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const redBy = (label, pairs, holds) => { let red = false; try { red = !holds(mutantOf(pairs)); } catch (e) { red = /anchor missing/.test(e.message) ? (bad(label + ': ' + e.message), false) : true; } return red; };
const LN = ELP.PRIOR, MIN = 60000;
const canon = (o) => JSON.stringify(o, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((r, kk) => { r[kk] = x[kk]; return r; }, {}) : x);
// a player placed by five solo runs at depth 10 (ids 100.., seeds 500..), settled
function soloPlaced(m, p, t0, st) { st = st || { hist: {} }; [10, 10, 10, 10, 10].forEach((d, i) => m.ratingHistUpsert(st, p, 'solo', 0, 100 + i, d, t0 + i * MIN, F, 500 + i)); m.elpSettleAll(st, 0, t0 + DAY); return st; }
// (a)-(c) a duo run then a solo run of one placed player, first seen a minute apart, settled in ONE pass: start order, one chain of points
function crossScenario(m) {
  const now = 100 * DAY, st = soloPlaced(m, 'X', now - 5 * DAY);
  const lp0 = st.hist['X|all|0'].lp;
  m.ratingHistUpsert(st, 'X', 'solo', 0, 301, 12, now - DAY + MIN, F, 9302);   // the solo run enters the file FIRST but started second
  m.ratingHistUpsert(st, 'X', 'duo', 0, 300, 20, now - DAY, F, 9301);
  const out = m.elpSettleAll(st, 0, now);
  return { st, lp0, out, now };
}
function crossHolds(m) {
  const { st, lp0, out } = crossScenario(m), c = st.hist['X|all|0'];
  const solo5 = [10, 10, 10, 10, 10].map((d) => ['solo', d]);
  const hDuo = PP.elpHiddenFor('duo', solo5, LN), tDuo = PP.targetOf(lp0, LN.duo, 9301, hDuo, false), sDuo = PP.endlessSettle(lp0, 20 >= tDuo, hDuo, LN.duo, PP.targetOffset(9301), 'duo');
  const hSolo = PP.hiddenOf([10, 10, 10, 10, 10]), tSolo = PP.targetOf(sDuo.nv, LN.solo, 9302, hSolo, false), sSolo = PP.endlessSettle(sDuo.nv, 12 >= tSolo, hSolo, LN.solo, PP.targetOffset(9302), 'solo');
  return out.length === 2 && out[0].runId === 300 && out[1].runId === 301 && out[0].T === tDuo && out[0].d === sDuo.nv - lp0 && out[1].T === tSolo && out[1].d === sSolo.nv - sDuo.nv && c.lp === sSolo.nv && c.n === 7
    && c.ring[0].mh === 9302 && c.ring[1].mh === 9301 && st.hist['X|duo|0'].runs[0][3] === 2 && st.hist['X|solo|0'].runs[5][3] === 2 && st.hist['X|duo|0'].lp === undefined;
}
// (d) a family held back by a save point does not hold the other families back; the late run reads the runs first seen no later than it
function stuckScenario(m) {
  const now = 100 * DAY, st = { hist: {} };
  [16, 16, 16, 16, 16].forEach((d, i) => m.ratingHistUpsert(st, 'Y', 'duo', 0, 100 + i, d, now - 9 * DAY + i * MIN, F, 500 + i)); m.elpSettleAll(st, 0, now - 8 * DAY);
  m.ratingHistUpsert(st, 'Y', 'solo', 0, 200, 9, now - 6 * DAY, SUS, 9200);                                    // a solo run, its save point open
  [40, 40, 40].forEach((d, i) => m.ratingHistUpsert(st, 'Y', 'duo', 0, 300 + i, d, now - 5 * DAY + i * MIN, F, 9300 + i));   // three deep duo runs after it
  const first = m.elpSettleAll(st, 0, now - 4 * DAY), lpMid = st.hist['Y|all|0'].lp;
  m.ratingHistUpsert(st, 'Y', 'solo', 0, 200, 11, now - 3 * DAY, F, 9200);                                      // resumed and finished
  const second = m.elpSettleAll(st, 0, now - 2 * DAY);
  return { st, first, second, lpMid };
}
function stuckHolds(m) {
  const { st, first, second, lpMid } = stuckScenario(m);
  const duo5 = [16, 16, 16, 16, 16].map((d) => ['duo', d]), hSolo = PP.elpHiddenFor('solo', duo5, LN);   // the five duo runs before it; not the three deep ones after
  const T = PP.targetOf(lpMid, LN.solo, 9200, hSolo, false), sl = PP.endlessSettle(lpMid, 11 >= T, hSolo, LN.solo, PP.targetOffset(9200), 'solo');
  const later = PP.elpHiddenFor('solo', [40, 40, 40, 16, 16, 16, 16, 16].map((d) => ['duo', d]), LN);
  return first.length === 3 && first.every((x) => x.k === 'Y|duo|0') && st.hist['Y|solo|0'].runs[0][3] === 2 && second.length === 1 && second[0].runId === 200 && second[0].T === T && st.hist['Y|all|0'].lp === sl.nv
    && later !== hSolo && PP.targetOf(lpMid, LN.solo, 9200, later, false) !== T;
}
// (e) T7: one pass over three players, four families, ties, a shared team run and a waiting run -- whatever the key order of the file
function shuffleWorld(m, order) {
  const now = 100 * DAY, t = now - DAY, st = { hist: {} };
  const ops = [
    ['P1', 'solo', 11, 7, t, 811], ['P1', 'duo', 12, 14, t, 812], ['P1', 'quad', 13, 20, t + MIN, 813], ['P1', 'trio', 14, 18, t + MIN, 814], ['P1', 'solo', 15, 9, t + 2 * MIN, 815], ['P1', 'solo', 16, 30, t + 3 * MIN, 816],
    ['P2', 'duo', 21, 22, t - MIN, 821], ['P2', 'duo', 12, 14, t, 812], ['P2', 'solo', 23, 5, t, 823], ['P2', 'trio', 24, 26, t + MIN, 824], ['P2', 'solo', 25, 6, t + 2 * MIN, 825], ['P2', 'duo', 26, 19, t + 3 * MIN, 826],
    ['P3', 'quad', 31, 12, t, 831], ['P3', 'solo', 35, 4, t + MIN, 835], ['P3', 'quad', 33, 15, t + 2 * MIN, 833], ['P3', 'trio', 34, 9, t + 2 * MIN, 834], ['P3', 'solo', 32, 8, t + 3 * MIN, 832, SUS],   // P3's newest solo run left a save point: it waits
  ];
  for (const [p, fam, id, d, at, seed, fl] of ops) m.ratingHistUpsert(st, p, fam, 0, id, d, at, fl == null ? F : fl, seed);
  m.elpTeamNote(st, 12, ['P1', 'P2'], 'duo', 0, t);
  const keys = order(Object.keys(st.hist)), hist = {};
  for (const k of keys) hist[k] = st.hist[k];
  st.hist = hist;
  const out = m.elpSettleAll(st, 0, now);
  return { st, out: out.map((x) => [x.k, x.runId, x.d, x.T, x.teamH === undefined ? 'own' : x.teamH]).sort() };
}
function shuffleDiffs(m) {
  let seed = 825;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const base = shuffleWorld(m, (k) => k), want = canon([base.st.hist, base.st.elpTeam, base.out]);
  let diff = 0;
  const orders = [(k) => k.slice().reverse(), (k) => k.slice().sort(), (k) => k.slice().sort().reverse()];
  for (let i = 0; i < 20; i++) orders.push((k) => { const a = k.slice(); for (let j = a.length - 1; j > 0; j--) { const x = Math.floor(rnd() * (j + 1)); [a[j], a[x]] = [a[x], a[j]]; } return a; });
  for (const o of orders) { const r = shuffleWorld(m, o); if (canon([r.st.hist, r.st.elpTeam, r.out]) !== want) diff++; }
  return { diff, n: orders.length, base };
}
// (k) a team run where one seat never played the family: the team level reads his solo runs on the duo scale
function teamBorrowHolds(m) {
  const now = 100 * DAY, st = soloPlaced(m, 'M', now - 5 * DAY);
  [24, 24, 24, 24, 24].forEach((d, i) => m.ratingHistUpsert(st, 'N', 'duo', 0, 100 + i, d, now - 5 * DAY + i * MIN, F, 600 + i)); m.elpSettleAll(st, 0, now - 4 * DAY);
  const t = now - DAY;
  m.ratingHistUpsert(st, 'M', 'duo', 0, 9100, 18, t, F, 9101); m.ratingHistUpsert(st, 'N', 'duo', 0, 9100, 18, t, F, 9101); m.elpTeamNote(st, 9100, ['M', 'N'], 'duo', 0, t);
  const out = m.elpSettleAll(st, 0, now), hM = PP.elpHiddenFor('duo', [10, 10, 10, 10, 10].map((d) => ['solo', d]), LN), lvl = PP.teamHiddenOf([hM, 2400]);
  return hM === 1600 && lvl === 2000 && out.length === 2 && out.every((x) => x.teamH === lvl && x.T === PP.targetOf(0, LN.duo, 9101, lvl, false)) && st.elpTeam['9100'].h === lvl;
}
// the rows after a table change: 30 solo players placed under the prior, their rows current; a new table moves the duo lines.
//   Returns { before: writes with the rows current, after: writes once the table moved, next: writes after one player settles a
//   run, moved: his row's duo skill changed with the new lines }
function rowsStableDetail(m) {
  const now = 100 * DAY, st = { hist: {}, elpTab: [] }, sids = [];
  for (let i = 0; i < 30; i++) { const sid = SID(3000 + i); sids.push(sid); [10, 12, 14, 9, 11].forEach((d, j) => m.ratingHistUpsert(st, P(sid), 'solo', 0, 100 + j, d + (i % 5), now - 5 * DAY + j * MIN, F, 500 + j)); }
  m.elpSettleAll(st, 0, now - 4 * DAY);
  const rows = {}; for (const sid of sids) { const w = m.ratingScoreOf(st, P(sid), 0, now - 4 * DAY); rows[sid] = { s: w.score, det: w.details }; }
  const before = m.ratingPlan(st, 0, rows, new Set(sids), now - 4 * DAY).writes.length;
  const byFam = {}; for (const f of PP.ELP_FAMS) byFam[f] = { N: 300, w: 1, pass: ELP.PRIOR[f].slice() };
  byFam.duo = { N: 300, w: 1, pass: [4, 12, 20, 30, 40, 50, 60] };
  m.elpTabRecord(st, 0, 20261002, now - 3 * DAY, byFam);
  const after = m.ratingPlan(st, 0, rows, new Set(sids), now).writes.length;
  m.ratingHistUpsert(st, P(sids[0]), 'solo', 0, 200, 12, now - DAY, F, 900); m.elpSettleAll(st, 0, now);
  const pl = m.ratingPlan(st, 0, rows, new Set(sids), now), w0 = pl.writes.find((w) => w.sid === sids[0]);
  const was = PP.elpRowOf(rows[sids[0]].det).h.duo, is = w0 ? PP.elpRowOf(w0.details).h.duo : null;
  return { before, after, next: pl.writes.length, was, is, want: PP.elpHiddenFor('duo', m.elpSettledRuns(st, P(sids[0]), 0), m.elpLinesByFam(st, 0, now)) };
}
const rowsStable = (m) => { const r = rowsStableDetail(m); return r.before === 0 && r.after === 0 && r.next === 1 && r.is === r.want && r.is !== r.was; };
// (i) a chain memory of the older shape: the points on the family entry, its runs marked 1, no points entry
function legacyWorld() {
  const now = 100 * DAY, t0 = now - 5 * DAY, runs = [];
  [9, 9, 9, 9, 9, 14].forEach((d, i) => runs.push([100 + i, d, t0 + i * MIN, 1, i < 4 ? 0 : (i === 4 ? 1900 : 57), 6, t0 + i * MIN, 1, 500 + i]));
  const ring = [{ mh: 505, delta: 57, flags: 256 }, { mh: 504, delta: 1900, flags: 256 | PP.RECEIPT_F.SEEDED }];
  return { now, st: { hist: { 'L|solo|0': { best: [105, 14], runs, old: [], gone: [[90, 33, 490]], t: t0, lp: 1957, placed: 1, n: 6, ring, seedRun: 104 } } } };
}
function legacyHolds(m) {
  const { now, st } = legacyWorld(), was = JSON.stringify(st.hist['L|solo|0']);
  const idle = m.elpSettleAll(st, 0, now).length === 0 && !st.hist['L|all|0'] && m.ratingScoreOf(st, 'L', 0) === null && JSON.stringify(st.hist['L|solo|0']) === was;
  m.ratingHistUpsert(st, 'L', 'solo', 0, 700, 11, now - MIN, F, 9700);
  const x = m.elpSettleAll(st, 0, now)[0], c = st.hist['L|all|0'], h = st.hist['L|solo|0'];
  const Tw = PP.targetOf(0, LN.solo, 9700, PP.elpHiddenFor('solo', [14, 9, 9, 9, 9, 9].map((d) => ['solo', d]), LN, 1), true);
  const first = !!x && x.d === 0 && !x.seeded && x.T === Tw && Tw !== PP.targetOf(0, LN.solo, 9700, null, true) && c.n === 1 && !c.placed && c.lp === null && h.lp === 1957 && h.placed === 1 && h.n === 6 && h.seedRun === 104 && h.ring.length === 2;
  const ringWas = JSON.stringify(c.ring);
  const conv = m.ratingHistRemove(st, 'L', 'solo', 0, 105) && !h.runs.some((r) => r[0] === 105) && c.n === 1 && c.lp === null && JSON.stringify(c.ring) === ringWas && h.lp === 1957;
  const gone = m.ratingHistRemove(st, 'L', 'solo', 0, 90) && c.n === 1 && JSON.stringify(c.ring) === ringWas;
  return { idle, first, conv, gone, all: idle && first && conv && gone };
}
{
  const now = 100 * DAY;
  // (a)-(c)
  const cs = crossScenario(v), c = cs.st.hist['X|all|0'];
  T('[13] a duo run and a solo run of one player settle in one pass in START order (the duo run first seen a minute earlier, though its entry is the later key) onto ONE chain of points: ' + cs.lp0 + ' -> ' + (cs.lp0 + cs.out[0].d) + ' -> ' + c.lp + '; n 7, both receipts on the one ring; the family entries carry no points', crossHolds(v), JSON.stringify([cs.out, c]));
  const solo5 = [10, 10, 10, 10, 10].map((d) => ['solo', d]);
  T('[13] the first duo run of a solo player: its target reads his solo runs on the duo scale (skill ' + PP.elpHiddenFor('duo', solo5, LN) + ' -> T ' + cs.out[0].T + '), not the silver line (' + PP.targetOf(cs.lp0, LN.duo, 9301, null, false) + ')', cs.out[0].T === PP.targetOf(cs.lp0, LN.duo, 9301, 1600, false) && cs.out[0].T !== PP.targetOf(cs.lp0, LN.duo, 9301, null, false));
  { const hD = 1600, t = cs.out[0].T, team = PP.endlessSettle(cs.lp0, 20 >= t, hD, LN.duo, PP.targetOffset(9301), 'duo'), solo = PP.endlessSettle(cs.lp0, 20 >= t, hD, LN.duo, PP.targetOffset(9301));
    T('[13] the duo run takes the team length factor (d ' + cs.out[0].d + ' = endlessSettle(.., duo); the same run read as solo would give ' + solo.d + ')', cs.out[0].d === team.d && team.plan.team === true && team.d !== solo.d, JSON.stringify([team.d, solo.d])); }
  // the team gate reaches the settle: a diamond player on the duo master line is held at 5879 on a duo run, promoted on a solo one
  {
    const st = { hist: {} }, m = LN.duo[5];
    [m, m, m, m, m].forEach((d, i) => v.ratingHistUpsert(st, 'G', 'duo', 0, 100 + i, d, now - 5 * DAY + i * MIN, F, 500 + i)); v.elpSettleAll(st, 0, now - 4 * DAY);
    st.hist['G|all|0'].lp = 5850; v.ratingHistUpsert(st, 'G', 'duo', 0, 200, 60, now - DAY, F, 9200); v.elpSettleAll(st, 0, now);
    const s2 = { hist: {} }, ms = LN.solo[5];
    [ms, ms, ms, ms, ms].forEach((d, i) => v.ratingHistUpsert(s2, 'G', 'solo', 0, 100 + i, d, now - 5 * DAY + i * MIN, F, 500 + i)); v.elpSettleAll(s2, 0, now - 4 * DAY);
    s2.hist['G|all|0'].lp = 5850; v.ratingHistUpsert(s2, 'G', 'solo', 0, 200, 60, now - DAY, F, 9200); v.elpSettleAll(s2, 0, now);
    T('[13] the team gate reaches the settle: a duo-only player whose skill sits ON the duo master line stops at 5879 (the gate asks the line x 1.10); a solo-only player on the solo master line goes on (' + s2.hist['G|all|0'].lp + ')', st.hist['G|all|0'].lp === 5879 && s2.hist['G|all|0'].lp > 5879, JSON.stringify([st.hist['G|all|0'].lp, s2.hist['G|all|0'].lp]));
  }
  // (l) the pass order itself
  {
    const st = { hist: {} }, t = now - DAY;
    v.ratingHistUpsert(st, 'O', 'quad', 0, 5, 3, t, F, 1); v.ratingHistUpsert(st, 'O', 'solo', 0, 9, 3, t, F, 2); v.ratingHistUpsert(st, 'O', 'duo', 0, 7, 3, t, F, 3); v.ratingHistUpsert(st, 'O', 'trio', 0, 2, 3, t - 1, F, 4);
    v.ratingHistUpsert(st, 'O', 'solo', 0, 1, 3, t + 1, F, 5); v.ratingHistUpsert(st, 'O', 'duoc', 0, 99, 3, t - 5, F, 6);
    eq('[13] elpPassOrder: first seen, then the lower run id, never the key order; a family lists its own runs in its own order (solo 9 before solo 1); the split couch family is not in it', v.elpPassOrder(st, 'O', 0, now).map((o) => o.fam + ' ' + o.r[0]), ['trio 2', 'quad 5', 'duo 7', 'solo 9', 'solo 1']);
    const s2 = { hist: {} }; v.ratingHistUpsert(s2, 'O', 'duo', 0, 7, 3, t, F, 3); v.ratingHistUpsert(s2, 'O', 'solo', 0, 7, 3, t, F, 2);
    eq('[13] the same instant and the same run id in two families: the earlier family (solo) first', v.elpPassOrder(s2, 'O', 0, now).map((o) => o.fam), ['solo', 'duo']);
    eq('[13] elpSettledRuns: every settled run, newest first, as [family, depth]', (v.elpSettleAll(st, 0, now), v.elpSettledRuns(st, 'O', 0)), [['solo', 3], ['solo', 3], ['duo', 3], ['quad', 3], ['trio', 3]]);
  }
  // (d)
  { const s = stuckScenario(v);
    T('[13] a solo run with its save point open waits; the three duo runs started after it settle meanwhile (a family held back does not hold the others back)', s.first.length === 3 && s.first.every((x) => x.k === 'Y|duo|0'), JSON.stringify(s.first));
    T('[13] ... and once it is finished it settles onto the points as they stand then, its target read from the runs first seen no later than it (the five duo runs at 16, not the three at 40 that came after): T ' + (s.second[0] && s.second[0].T), stuckHolds(v), JSON.stringify(s.second)); }
  // (e) T7
  { const r = shuffleDiffs(v);
    T('[13] T7: the same pass over ' + r.n + ' key orders of the state file (reversed, sorted, 20 shuffles; 3 players, 4 families, ties, a shared team run, a waiting run): the same chain memory and the same settles every time (' + r.diff + ' differ)', r.diff === 0 && r.base.out.length === 16);
    T('[13] T7 (the world is not trivial): the waiting run stays unsettled, the team run froze one level for both seats, three points entries', r.base.st.hist['P3|solo|0'].runs[1][3] === 0 && r.base.st.hist['P3|solo|0'].runs[0][3] === 2 && r.base.st.elpTeam['12'].has === 1 && ['P1', 'P2', 'P3'].every((p) => !!r.base.st.hist[p + '|all|0'])
      && new Set(r.base.out.filter((x) => x[1] === 12).map((x) => x[3])).size === 1, JSON.stringify(r.base.out)); }
  // (f) the placement over the families
  {
    const st = { hist: {} }, t = now - DAY, plan = [['solo', 10], ['duo', 16], ['quad', 16], ['trio', 16], ['duo', 24]], T4 = [], seen = [];
    let d5 = null;
    plan.forEach(([fam, d], i) => { v.ratingHistUpsert(st, 'Z', fam, 0, 400 + i, d, t + i * MIN, F, 9400 + i); const x = v.elpSettleAll(st, 0, t + i * MIN + 1)[0]; T4.push(x.T); if (i === 4) d5 = x;
      seen.push(PP.targetOf(0, LN[fam], 9400 + i, PP.elpHiddenFor(fam, plan.slice(0, i).reverse(), LN, 1), true)); });
    const cz = st.hist['Z|all|0'], five = plan.slice().reverse(), seedLp = PP.endlessSeedLp(PP.elpHiddenFor('solo', five, LN), LN.solo);
    eq('[13] the placement counts the runs of every family: five runs of four families, the targets from the runs so far read on each run\'s family scale (the first: the silver line)', T4, seen);
    T('[13] ... the fifth (a duo run) seeds from the five read on the SOLO scale: ' + JSON.stringify(five) + ' -> skill ' + PP.elpHiddenFor('solo', five, LN) + ' -> ' + seedLp + ' points; one row from now on', d5.seeded && cz.placed === 1 && cz.lp === seedLp && cz.n === 5 && cz.seedRun[0] === 'duo' && cz.seedRun[1] === 404
      && T4[0] === PP.targetOf(0, LN.solo, 9400, null, true) && v.ratingScoreOf(st, 'Z', 0).score === seedLp, JSON.stringify([d5, cz]));
    // (h) the row and the plan
    const row = v.ratingScoreOf(st, 'Z', 0), back = PP.elpRowOf(row.details);
    eq('[13] the row v2: the points, n 5, the tier, the four skills = elpHiddenFor of each family over every settled run (newest first)', [row.score, back.n, back.tier, back.placed, back.h, back.ring.length],
      [seedLp, 5, PP.lpTierIdx(seedLp), true, { solo: PP.elpHiddenFor('solo', five, LN), duo: PP.elpHiddenFor('duo', five, LN), trio: PP.elpHiddenFor('trio', five, LN), quad: PP.elpHiddenFor('quad', five, LN) }, 5]);
    const sidZ = SID(900), sidQ = SID(901), stP = { hist: {} };
    plan.forEach(([fam, d], i) => v.ratingHistUpsert(stP, P(sidZ), fam, 0, 400 + i, d, t + i * MIN, F, 9400 + i)); v.ratingHistUpsert(stP, P(sidQ), 'duo', 0, 1, 5, t, F, 7); v.elpSettleAll(stP, 0, now);
    const rowZ = v.ratingScoreOf(stP, P(sidZ), 0);
    const pl = v.ratingPlan(stP, 0, { [sidQ]: { s: 5, det: [1] }, [SID(902)]: { s: 9, det: [] } }, new Set([sidZ]), now);
    T('[13] ratingPlan (one board): the placed player written with his row, a row of a player not placed / without history deleted; a current row is left alone', pl.writes.length === 1 && pl.writes[0].sid === sidZ && pl.writes[0].score === rowZ.score && JSON.stringify(pl.writes[0].details) === JSON.stringify(rowZ.details)
      && JSON.stringify(pl.deletes.sort()) === JSON.stringify([sidQ, SID(902)].sort()) && v.ratingPlan(stP, 0, { [sidZ]: { s: rowZ.score, det: rowZ.details } }, new Set([sidZ]), now).writes.length === 0, JSON.stringify(pl));
    // (g) a conviction refunds onto the one entry, whatever the family; the seeding run of any family takes the placement back
    v.ratingHistUpsert(st, 'Z', 'quad', 0, 410, 40, t + 10 * MIN, F, 9410); v.elpSettleAll(st, 0, now);
    const dq = st.hist['Z|quad|0'].runs.find((r) => r[0] === 410)[4], lpq = cz.lp;
    T('[13] a convicted quad run gives its points back on the one entry (VOID receipt keyed by its seed, n - 1); naming another family finds nothing', dq > 0 && !v.ratingHistRemove(st, 'Z', 'solo', 0, 410) && cz.lp === lpq && v.ratingHistRemove(st, 'Z', 'quad', 0, 410) && cz.lp === lpq - dq && cz.n === 5 && cz.ring[0].mh === 9410 && (cz.ring[0].flags & PP.RECEIPT_F.VOID) !== 0, JSON.stringify([dq, lpq, cz]));
    T('[13] the seeding run was a duo run: convicting it takes the placement back (no row); the same run id under another family does not', !v.ratingHistRemove(st, 'Z', 'trio', 0, 404) && cz.placed === 1 && v.ratingHistRemove(st, 'Z', 'duo', 0, 404) && !cz.placed && cz.lp === null && cz.seedRun === null && v.ratingScoreOf(st, 'Z', 0) === null);
    v.ratingHistUpsert(st, 'Z', 'solo', 0, 420, 10, t + 20 * MIN, F, 9420); const again = v.elpSettleAll(st, 0, now + 1)[0];
    T('[13] ... and the next settled run (a solo one) seeds again', again.seeded && cz.placed === 1 && cz.seedRun[0] === 'solo' && cz.seedRun[1] === 420, JSON.stringify([again, cz.seedRun]));
  }
  // the row moves with its player only: the four skills are kept on the entry, a new table does not rewrite the rows
  T('[13] a row moves with its player, never with the table: 30 placed solo players, then a table whose DUO lines moved -- no row to write (their duo / trio / quad skills are borrowed solo runs read through the lines: read fresh, all 30 rows would move); the next settle of a player writes his row under the new lines', rowsStable(v), JSON.stringify(rowsStableDetail(v)));
  // (k)
  T('[13] O803 over O825: a seat who never played duo beside a duo player: the team level reads his solo runs on the duo scale (1600 with 2400 -> 2000), one target for both', teamBorrowHolds(v));
  // (i) the older shape
  { const r = legacyHolds(v);
    T('[13] a chain memory of the older shape (points on the family entry, runs marked 1): nothing settles, no points entry appears, no row, the entry byte for byte as it was', r.idle);
    T('[13] ... his next run is placement run 1 of the one points value (d 0); its target reads his older runs (not the silver line); the old fields stay where they were', r.first);
    T('[13] ... a conviction of a run the older job settled removes the run and refunds nothing here (its d never entered these points): no receipt, n unchanged -- in the window and in gone', r.conv && r.gone); }
  // mutations
  T('[13] baseline holds for the mutations below', crossHolds(v) && stuckHolds(v) && shuffleDiffs(v).diff === 0 && teamBorrowHolds(v) && legacyHolds(v).all && rowsStable(v));
  T('[13] mutation "the row\'s skills read fresh at every projection" turns the row check red (a table change rewrites all 30 rows)', redBy('[13] fresh skills', [['  const hs = (Array.isArray(c.h) && c.h.length === pointsPlan.ELP_FAMS.length) ? c.h : elpSkillsOf(', '  const hs = (c.h === 0) ? c.h : elpSkillsOf(']], rowsStable));
  T('[13] mutation "a conviction leaves the kept skills as they were" is caught: the removed run still counts in his row', redBy('[13] stale skills', [['  if (hit && c) c.h = elpSkillsOf(st, p, seasonId, Infinity);', '']], (m) => {
    // five runs at 10, then two at 40 (the trimmed mean keeps one of them: 1600); one of the two convicted -> 1000
    const st = soloPlaced(m, 'W', 100 * DAY - 5 * DAY); m.ratingHistUpsert(st, 'W', 'solo', 0, 300, 40, 100 * DAY - DAY, F, 9300); m.ratingHistUpsert(st, 'W', 'solo', 0, 301, 40, 100 * DAY - DAY + MIN, F, 9301); m.elpSettleAll(st, 0, 100 * DAY);
    const h0 = m.ratingScoreOf(st, 'W', 0).h.solo; m.ratingHistRemove(st, 'W', 'solo', 0, 300);
    return h0 === 1600 && PP.hiddenOf([40, 40, 10, 10, 10, 10, 10]) === 1600 && m.ratingScoreOf(st, 'W', 0).h.solo === 1000 && PP.hiddenOf([40, 10, 10, 10, 10, 10]) === 1000; }));
  const CMP = '      if (fa < fb || (fa === fb && (a[0] >>> 0) < (b[0] >>> 0))) pick = i;';
  T('[13] mutation "the families one after the other (no start order across them)" turns the cross-family chain red (the solo run would settle before the duo run that started first)', redBy('[13] families in turn', [[CMP, '']], crossHolds));
  T('[13] mutation "the entries walked in the key order of the file, each in turn" (the walk before O825) turns T7 red',
    redBy('[13] key order', [[CMP, ''], ['  for (const fam of pointsPlan.ELP_FAMS) { const h = st && st.hist && st.hist[ratingHistKey(p, fam, s)]; if (elpEntryOk(h)) out.push({ fam, h }); }\n  return out;',
      "  for (const k of Object.keys((st && st.hist) || {})) for (const fam of pointsPlan.ELP_FAMS) { const h = st.hist[k]; if (k === ratingHistKey(p, fam, s) && elpEntryOk(h)) out.push({ fam, h }); }\n  return out;"]], (m) => shuffleDiffs(m).diff === 0));
  T('[13] mutation "a run that may not settle yet holds every family back" turns the waiting-run check red', redBy('[13] one family holds all',
    [['  return elpMergeByStart(elpFamEntries(st, p, s).map(({ fam, h }) => { const soon = elpPendingSettles(h, nowMs); return { fam, h, runs: h.runs.filter((x, i) => soon.has(i)) }; }));',
      '  const fe = elpFamEntries(st, p, s); if (fe.some(({ h }) => h.runs.some((x, i) => !x[3] && !elpRunReady(h, i, nowMs)))) return [];\n  return elpMergeByStart(fe.map(({ fam, h }) => { const soon = elpPendingSettles(h, nowMs); return { fam, h, runs: h.runs.filter((x, i) => soon.has(i)) }; }));']], stuckHolds));
  T('[13] mutation "the late run reads every settled run (the ones started after it too)" turns the waiting-run check red', redBy('[13] later runs counted', [["    if ((f === fam && (x[0] >>> 0) === rid) || (x[2] || 0) > at) return false;", "    if (f === fam && (x[0] >>> 0) === rid) return false;"]], stuckHolds));
  T('[13] mutation "the runs before a run = his runs of that family only" turns the first-duo-run target and the team level red', redBy('[13] own family only', [["    if ((f === fam && (x[0] >>> 0) === rid) || (x[2] || 0) > at) return false;", "    if (f !== fam || (x[0] >>> 0) === rid || (x[2] || 0) > at) return false;"]], (m) => crossHolds(m) || teamBorrowHolds(m)));
  T('[13] mutation "the points line does not take the family" turns the cross-family chain red (no team length factor)', redBy('[13] no fam', [['sl = pointsPlan.endlessSettle(cur, depth >= t, H, tb[fam], off, fam);', 'sl = pointsPlan.endlessSettle(cur, depth >= t, H, tb[fam], off);']], crossHolds));
  T('[13] mutation "a run the older job settled is refunded from the one points value" turns the older-shape check red', redBy('[13] legacy refund', [['if (r[3] === 2) d = r[4] | 0;', 'if (r[3]) d = r[4] | 0;']], (m) => legacyHolds(m).conv));
  T('[13] mutation "the points kept on the family entry" (a second entry a family) turns the cross-family chain red', redBy('[13] points per family', [["  const k = elpAllKey(p, seasonId);\n  let c = st && st.hist ? st.hist[k] : null;", "  const k = elpAllKey(p, seasonId) + (make === true ? '' : '');\n  let c = null;"]], crossHolds));
}

// ---- [14] T8: a throw inside the endless settle never stops the reconcile (REAL main()) ----
console.log('-- [14] T8: the guard around the endless settle --');
{
  const T0 = Date.now() - 3 * DAY, hist = {}, sidV = SID(600), sidBad = SID(601);
  played({ hist }, P(sidV), [9, 9, 9, 9, 9], T0); v.elpSettleAll({ hist }, 0, T0 + DAY);
  v.ratingHistUpsert({ hist }, P(sidV), 'solo', 0, 777, 12, Date.now() - 25 * 3600000, 0, 4321);   // idle 25 h: this pass settles it -- before the walk reaches the broken entry
  const rowV = v.ratingScoreOf({ hist }, P(sidV), 0);
  const good = JSON.parse(JSON.stringify(hist));
  // an entry the shape check lets through and the settle throws on: eleven final runs (all settle, in memory) and an `old` that is no
  //   list -- the window trim at the END of the pass throws on it, after every run of every player was settled in memory
  hist['zz|solo|0'] = { best: [0, 0], runs: Array.from({ length: 11 }, (x, i) => [900 + i, 5, T0 + i * 60000, 0, 0, 0, T0 + i * 60000, 1, 800 + i]), old: 7, t: 0 };
  const solo = { runs: {}, wait: {}, ms: {}, held: {}, hist, elpTeam: { 5: { r: ['a', 'b'], fam: 'duo', s: 0, at: Date.now() } } };
  const rows = [{ steamID: sidV, score: rowV.score, details: rowV.details }];
  const r1 = runCron(world([], { all: rows }), { SOLO_FILE: solo }, { GITHUB_STEP_SUMMARY: 'auto' });
  const h1 = ((r1.state.SOLO_FILE || {}).hist || {});
  T('[14] the settle throws (a damaged entry the shape check cannot see): the run still exits 0, with a warning that the lane is skipped', r1.code === 0 && /::warning::endless points: the settle threw \(.*\) -- the lane is skipped this run/.test(r1.out), r1.out.slice(-700));
  T('[14] the chain memory of the lane is as it was: the good player\'s run (settled in memory before the throw) is NOT half settled -- still unsettled, his points and receipts untouched, the roster entry kept, no table recorded',
    JSON.stringify(h1[P(sidV) + '|solo|0']) === JSON.stringify(solo.hist[P(sidV) + '|solo|0']) && JSON.stringify(h1[P(sidV) + '|all|0']) === JSON.stringify(solo.hist[P(sidV) + '|all|0']) && h1[P(sidV) + '|solo|0'].runs[5][3] === 0
    && JSON.stringify((r1.state.SOLO_FILE || {}).elpTeam) === JSON.stringify(solo.elpTeam) && !((r1.state.SOLO_FILE || {}).elpTab || []).length && !/endless points solo .*run 309 /.test(r1.out.split('the settle threw')[1] || ''), JSON.stringify(h1[P(sidV) + '|solo|0']));
  T('[14] the lanes after it ran: the row of the good player is left as it is (current), nothing deleted, the run summary is written and names the thrown settle', postsTo(r1, BOARD.rAll).length === 0 && postsTo(r1, BOARD.rAll, 'DeleteLeaderboardScore').length === 0
    && /SETTLE THREW, lane skipped/.test(r1.summary || '') && /endless points \(O728\)/.test(r1.summary || ''), (r1.summary || '').split('\n').filter((l) => /endless points/.test(l)).join(' | '));
  // the same state with the entry repaired: the lane settles the run and the row moves
  const r2 = runCron(world([], { all: rows }), { SOLO_FILE: Object.assign({}, solo, { hist: good }) });
  const h2 = ((r2.state.SOLO_FILE || {}).hist || {});
  T('[14] (the same tick without the malformed entry settles the run, writes the row and records the table: the guard hides nothing)', r2.code === 0 && !/the settle threw/.test(r2.out) && h2[P(sidV) + '|solo|0'].runs[5][3] === 2 && postsTo(r2, BOARD.rAll).length === 1 && ((r2.state.SOLO_FILE || {}).elpTab || []).length === 1);
  // the row plan's own guard: a placed player whose family entry is malformed, with a row on the board
  const hist3 = JSON.parse(JSON.stringify(good));
  hist3[P(sidBad) + '|all|0'] = { lp: 2500, placed: 1, seedRun: ['solo', 1], n: 5, ring: 5, h: [1000, null, null, null], t: 0 };   // a ring that is no list: the row cannot be built
  const r3 = runCron(world([], { all: rows.concat([{ steamID: sidBad, score: 2500, details: [1] }]) }), { SOLO_FILE: Object.assign({}, solo, { hist: hist3 }) });
  T('[14] a throw while planning the rows (a damaged points entry): warned, the rows skipped, nothing written or deleted, the run exits 0 and the table lane still answers', r3.code === 0 && /::warning::rating: the row plan threw/.test(r3.out) && postsTo(r3, BOARD.rAll).length === 0 && postsTo(r3, BOARD.rAll, 'DeleteLeaderboardScore').length === 0 && /tiercut: /.test(r3.out), r3.out.slice(-500));
  // mutation: without the guard the reconcile dies on the same state
  let red = false, mu = null;
  try {
    mu = mutantOf([['    try { return await elpUpkeepRun(st); }\n    catch (e) {', '    if (st) return await elpUpkeepRun(st);\n    try { }\n    catch (e) {']], true);
    const rm = runCron(world([], { all: rows }), { SOLO_FILE: solo }, null, mu.path);
    red = rm.code !== 0 && !/the lane is skipped this run/.test(rm.out);
  } catch (e) { red = /anchor missing/.test(e.message) ? (bad('[14] ' + e.message), false) : true; } finally { if (mu) mu.done(); }
  T('[14] mutation "no guard around the endless settle": the same state stops the whole reconcile (exit != 0) -- red', red);
}

// ---- [15] channels: the playtest / demo twin settles no endless points and creates no points board ----
console.log('-- [15] PT_MODE: no endless points, no points board --');
{
  const hist = {}, sid = SID(700);
  played({ hist }, P(sid), [9, 9, 9, 9, 9, 9], Date.now() - 3 * DAY);   // six final runs, none settled: an EA tick would settle them all
  const solo = { runs: {}, wait: {}, ms: {}, held: {}, hist };
  const noAll = world([], {}).filter((b) => !/^endless_rating_/.test(b.name) && b.name !== 'endless_tiercut');
  const named = (r, nm) => r.posts.filter((x) => /FindOrCreateLeaderboard/.test(x.url) && new RegExp('name=' + nm + '(&|$)').test(x.body)).length;
  const ea = runCron(noAll, { SOLO_FILE: solo });
  T('[15] the EA job on an app without the boards: provisions endless_rating_all (trusted) and the table carrier, none of the four per-family boards, and settles the six runs', ea.code === 0 && named(ea, 'endless_rating_all') >= 1 && named(ea, 'endless_tiercut') >= 1
    && ['solo', 'duo', 'trio', 'quad'].every((f) => named(ea, 'endless_rating_' + f) === 0) && /provisioned endless_rating_all \(trusted\)/.test(ea.out) && ((ea.state.SOLO_FILE || {}).hist || {})[P(sid) + '|all|0'].n === 6, ea.out.slice(-500));
  // a rig written before O825: it redirects the four per-family boards to _test names and does not know ENDLESS_RATING_LB
  const OLD_RIG = { ENDLESS_RATING_LB_SOLO: 'endless_rating_solo_test', ENDLESS_RATING_LB_DUO: 'endless_rating_duo_test', ENDLESS_RATING_LB_TRIO: 'endless_rating_trio_test', ENDLESS_RATING_LB_QUAD: 'endless_rating_quad_test' };
  const rig = runCron(noAll, { SOLO_FILE: solo }, OLD_RIG);
  T('[15] a rig that redirects the per-family boards to _test and does not name the one board: the points rows go to endless_rating_all_test -- the production name is neither created nor written', rig.code === 0 && named(rig, 'endless_rating_all_test') >= 1 && named(rig, 'endless_rating_all') === 0
    && /provisioned endless_rating_all_test \(trusted\)/.test(rig.out) && ((rig.state.SOLO_FILE || {}).hist || {})[P(sid) + '|all|0'].placed === 1, rig.out.split('\n').filter((l) => /endless_rating/.test(l)).join(' | '));
  const rig2 = runCron(noAll, { SOLO_FILE: solo }, Object.assign({ ENDLESS_RATING_LB: 'my_points' }, OLD_RIG));
  T('[15] ... and a rig that names the one board gets that name', rig2.code === 0 && named(rig2, 'my_points') >= 1 && named(rig2, 'endless_rating_all[a-z_]*') === 0);
  { let red = false, mu = null;
    try { mu = mutantOf([["process.env.ENDLESS_RATING_LB || ('endless_rating_all' + ((/^endless_rating_solo(_[A-Za-z0-9_]+)$/.exec(ENDLESS_RATING_LB_SOLO) || [])[1] || ''));", "process.env.ENDLESS_RATING_LB || 'endless_rating_all';"]], true);
      const rm = runCron(noAll, { SOLO_FILE: solo }, OLD_RIG, mu.path); red = named(rm, 'endless_rating_all') >= 1 && named(rm, 'endless_rating_all_test') === 0; }
    catch (e) { red = /anchor missing/.test(e.message) ? (bad('[15] ' + e.message), false) : true; } finally { if (mu) mu.done(); }
    T('[15] mutation "the one board always defaults to the production name": the old rig would create and write endless_rating_all -- red', red); }
  for (const [label, env] of [['playtest', { PT_MODE: '1' }], ['demo', { PT_MODE: '1', DEMO_APPID: '1' }]]) {
    const pt = runCron(noAll.filter((b) => b.name !== 'rating' && b.name !== 'points'), { SOLO_FILE: solo }, env);   // the trial channels refuse an app that holds the ranked boards
    const hp = ((pt.state.SOLO_FILE || {}).hist || {});
    T('[15] the ' + label + ' twin (PT_MODE) on the same state: exits 0, creates no points board and no table carrier, settles nothing (no points entry, the runs untouched), writes no row',
      pt.code === 0 && named(pt, 'endless_rating_[a-z0-9_]*') === 0 && named(pt, 'endless_tiercut') === 0 && !/endless points /.test(pt.out) && !/rating summary|tiercut/.test(pt.out)
      && !hp[P(sid) + '|all|0'] && (!hp[P(sid) + '|solo|0'] || hp[P(sid) + '|solo|0'].runs.every((r) => r[3] === 0)), pt.out.slice(-600));
  }
}

// ---- [16] the review round (fresh-eye review 2026-11-10): the frozen team level never depends on the walk; small hardenings ----
console.log('-- [16] O825 review round --');
{
  const now = 100 * DAY;
  // (a) random histories under six key orders: 4 players, 4 families, shared team runs, many first-seen ties, save points, two passes
  function fuzzDiffs(m, seed0, iters) {
    let seed = seed0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const ri = (n) => Math.floor(rnd() * n);
    const FM = ['solo', 'duo', 'trio', 'quad'], SIZE = { solo: 1, duo: 2, trio: 3, quad: 4 }, PL = ['p0', 'p1', 'p2', 'p3'], HR = 3600000, t0 = Date.UTC(2026, 10, 20);
    const canonSt = (st) => { const o = {}; for (const k of Object.keys(st.hist).sort()) { const h = st.hist[k]; if (h.runs && !h.runs.length && !(h.gone || []).length && k.indexOf('|all|') < 0) continue; o[k] = h; } return canon([o, st.elpTeam || {}]); };
    let diff = 0;
    for (let it = 0; it < iters; it++) {
      const ev = []; let id = 1000, at = t0;
      for (let i = 0, N = 6 + ri(20); i < N; i++) { if (rnd() < 0.4) at += ri(3) * HR; const fam = FM[ri(4)]; ev.push({ at, pl: PL.slice().sort(() => rnd() - 0.5).slice(0, SIZE[fam]), fam, id: id++, depth: 3 + ri(40), fl: rnd() < 0.15 ? SUS : F }); }
      const keys = []; for (const p of PL) for (const f of FM) keys.push(m.ratingHistKey(p, f, 0));
      const res = [];
      for (let o = 0; o < 6; o++) {
        const order = o === 0 ? keys.slice() : o === 1 ? keys.slice().reverse() : keys.slice().sort(() => rnd() - 0.5);
        const st = { hist: {} };
        for (const k of order) st.hist[k] = { best: [0, 0], runs: [], old: [], t: 0 };
        for (const e of ev) { for (const p of e.pl) m.ratingHistUpsert(st, p, e.fam, 0, e.id, e.depth, e.at, e.fl, e.id); if (e.pl.length > 1) m.elpTeamNote(st, e.id, e.pl, e.fam, 0, e.at); }
        m.elpSettleAll(st, 0, ev[Math.floor(ev.length / 2)].at + 1); m.elpSettleAll(st, 0, ev[ev.length - 1].at + 30 * HR);
        res.push(canonSt(st));
      }
      if (res.some((x) => x !== res[0])) diff++;
    }
    return diff;
  }
  T('[16] T7 fuzz: 240 random histories (4 players, 4 families, shared team runs, first-seen ties, save points, two passes) under 6 key orders each -- the same chain memory every time', fuzzDiffs(v, 1, 80) + fuzzDiffs(v, 7, 80) + fuzzDiffs(v, 13, 80) === 0);
  T('[16] mutation "the member reading switches on his points entry as it is NOW" (placed by later runs of another family -> the default reading; not yet -> the plain mean) makes the frozen team level depend on the walk -- the fuzz turns red',
    redBy('[16] placed switch', [["  return b.runs.length ? pointsPlan.elpHiddenFor(fam, b.runs, elpLinesByFam(st, s, firstSeen), 1) : null;\n}", "  const cNow = elpAllOf(st, p, s);\n  if (cNow && cNow.placed) return pointsPlan.elpHiddenFor(fam, b.runs, elpLinesByFam(st, s, firstSeen));\n  return b.runs.length ? pointsPlan.elpHiddenFor(fam, b.runs, elpLinesByFam(st, s, firstSeen), 1) : null;\n}"]], (m) => fuzzDiffs(m, 1, 80) + fuzzDiffs(m, 7, 80) === 0));
  // (b) the members' copies of a team run first seen at different ticks: the level is read at the run's own first tick, whoever settles first
  function lateCopy(m, aFirst) {
    const st = { hist: {} }, HR = 3600000, t0 = now - 20 * HR, ps = aFirst ? ['A', 'B'] : ['B', 'A'];
    for (const p of ps) st.hist[m.ratingHistKey(p, 'solo', 0)] = { best: [0, 0], runs: [], old: [], t: 0 };
    for (const p of ps) st.hist[m.ratingHistKey(p, 'duo', 0)] = { best: [0, 0], runs: [], old: [], t: 0 };
    for (let i = 0; i < 5; i++) { m.ratingHistUpsert(st, 'A', 'solo', 0, 100 + i, 10, t0 - 10 * HR + i, F, 100 + i); m.ratingHistUpsert(st, 'B', 'solo', 0, 200 + i, 10, t0 - 10 * HR + i, F, 200 + i); }
    m.elpSettleAll(st, 0, t0 - 5 * HR);
    m.ratingHistUpsert(st, 'A', 'duo', 0, 999, 20, t0 + HR, 0, 999); m.elpTeamNote(st, 999, ['A', 'B'], 'duo', 0, t0 + HR);          // A's copy: the lane sees the run
    m.ratingHistUpsert(st, 'B', 'solo', 0, 300, 60, t0 + 2 * HR, F, 300); m.ratingHistUpsert(st, 'B', 'solo', 0, 301, 60, t0 + 3 * HR, F, 301);   // B plays two deep solo runs meanwhile
    m.elpSettleAll(st, 0, t0 + 4 * HR);
    m.ratingHistUpsert(st, 'B', 'duo', 0, 999, 20, t0 + 5 * HR, F, 999); m.elpTeamNote(st, 999, ['A', 'B'], 'duo', 0, t0 + 5 * HR); m.ratingHistFinal(st, 'A', 'duo', 0, 999);   // B's records arrive late
    const out = m.elpSettleAll(st, 0, t0 + 6 * HR);
    return { h: st.elpTeam['999'].h, t0: st.elpTeam['999'].t0 === t0 + HR, at: st.elpTeam['999'].at === t0 + 5 * HR, T: out.filter((x) => x.runId === 999).map((x) => x.T), first: out[0] && out[0].k.slice(0, 1) };
  }
  const lateSame = (m) => { const a = lateCopy(m, true), b = lateCopy(m, false); return a.first === 'A' && b.first === 'B' && a.h === b.h && JSON.stringify(a.T) === JSON.stringify(b.T) && a.T.length === 2 && a.T[0] === a.T[1]; };
  { const a = lateCopy(v, true), b = lateCopy(v, false), want = PP.teamHiddenOf([1600, 1600]);
    T('[16] a team run whose two copies were first seen four hours apart (one seat\'s records came late; he played two deep solo runs meanwhile): the level is read at the run\'s own first tick (' + want + ': both seats as they stood then), the same whoever settles first (A first ' + a.h + ' / B first ' + b.h + '), one target ' + a.T[0],
      lateSame(v) && a.h === want && a.t0 && a.at && b.t0, JSON.stringify([a, b])); }
  T('[16] mutation "the level read at the first settler\'s copy" turns it red (B first: his two deep runs count)', redBy('[16] first settler', [['  const at = tm.t0 || (r[2] ? r[2] : nowMs);', '  const at = (r[2] ? r[2] : nowMs);']], lateSame));
  T('[16] an entry noted before t0 existed still freezes (the first settler\'s copy, as before)', (() => { const st = { hist: {} }, t = now - DAY; v.ratingHistUpsert(st, 'E', 'duo', 0, 9, 9, t, F, 9); v.ratingHistUpsert(st, 'F', 'duo', 0, 9, 9, t, F, 9); st.elpTeam = { 9: { r: ['E', 'F'], fam: 'duo', s: 0, at: t } }; const o = v.elpSettleAll(st, 0, now); return o.length === 2 && st.elpTeam['9'].has === 1 && o[0].T === o[1].T; })());
  // (c) a run started before his placement and settled after it: the target reads both ways, the better one for him
  function heldTarget(m) {
    const st = { hist: {} }, t = now - 9 * DAY;
    let seed = 9500; while (PP.targetOffset(seed) !== 0) seed++;
    [3, 3].forEach((d, i) => m.ratingHistUpsert(st, 'Q', 'duo', 0, 100 + i, d, t + i * MIN, F, 500 + i)); m.elpSettleAll(st, 0, t + DAY);
    m.ratingHistUpsert(st, 'Q', 'solo', 0, 200, 4, t + 2 * DAY, SUS, seed);                                                      // a solo run, its save point open: two runs before it
    [3, 3, 3].forEach((d, i) => m.ratingHistUpsert(st, 'Q', 'duo', 0, 300 + i, d, t + 3 * DAY + i * MIN, F, 600 + i)); m.elpSettleAll(st, 0, t + 4 * DAY);   // three more duo runs: placed
    const c = st.hist['Q|all|0'], lp0 = c.lp;
    m.ratingHistUpsert(st, 'Q', 'solo', 0, 200, 4, t + 5 * DAY, F, seed);
    const x = m.elpSettleAll(st, 0, t + 6 * DAY)[0];
    const hp = PP.elpHiddenFor('solo', [['duo', 3], ['duo', 3]], LN, 1), tStart = PP.targetOf(lp0, LN.solo, seed, hp, false), tSilver = PP.targetOf(lp0, LN.solo, seed, null, false);
    return { placed: c.placed === 1 && c.n === 6, x, hp, tStart, tSilver, lp0, want: PP.endlessSettle(lp0, 4 >= tStart, null, LN.solo, 0, 'solo').nv, lp: c.lp };
  }
  const heldOk = (m) => { const r = heldTarget(m); return r.placed && r.tStart <= 4 && r.tSilver > 4 && r.x.T === r.tStart && r.x.pass === true && r.lp === r.want && r.lp > r.lp0; };
  { const r = heldTarget(v);
    T('[16] a solo run started after two (duo) runs, held by its save point while three more duo runs placed him, finished at depth 4: its target is the one the dial showed at its start (the plain mean of the two runs before it, read on the solo scale: ' + r.tStart + '), not the silver line (' + r.tSilver + ') -- it passes (+' + (r.lp - r.lp0) + ')', heldOk(v), JSON.stringify(r)); }
  T('[16] mutation "a placed player\'s target under MIN_RUNS values reads the silver line only" turns it red (the run would miss)', redBy('[16] one reading', [["((H == null && before.length) ? [H, pointsPlan.elpHiddenFor(fam, before, tb, 1)] : [H])", "[H]"]], heldOk));
  // (d) a late segment raises a run that is settled already: the skills kept for his row follow
  function lateRaise(m) {
    const st = soloPlaced(m, 'U', now - 5 * DAY);
    m.ratingHistUpsert(st, 'U', 'solo', 0, 299, 40, now - 3 * DAY, F, 9299);   // a deep run, so that the raised one stays inside the trimmed mean
    m.ratingHistUpsert(st, 'U', 'solo', 0, 300, 5, now - 2 * DAY, 0, 9300); m.elpSettleAll(st, 0, now);   // idle two days, no save point: settled at depth 5
    const lp1 = st.hist['U|all|0'].lp, h1 = m.ratingScoreOf(st, 'U', 0).h.solo;
    m.ratingHistUpsert(st, 'U', 'solo', 0, 300, 45, now + MIN, F, 9300);   // the client came back: the run went on to 45
    const row = m.ratingScoreOf(st, 'U', 0);
    return { h1, h2: row.h.solo, want: PP.hiddenOf([45, 40, 10, 10, 10, 10, 10]), was: PP.hiddenOf([5, 40, 10, 10, 10, 10, 10]), lpSame: st.hist['U|all|0'].lp === lp1 && st.hist['U|solo|0'].runs[6][3] === 2 && st.hist['U|solo|0'].runs[6][1] === 45 };
  }
  const raiseOk = (m) => { const r = lateRaise(m); return r.h1 === r.was && r.h2 === r.want && r.want !== r.was && r.lpSame; };
  T('[16] a late segment raises a run settled already (idle settle at 5, then the client came back: 45): the points stay as settled, the skills kept for his row are read again (' + lateRaise(v).h1 + ' -> ' + lateRaise(v).h2 + ')', raiseOk(v), JSON.stringify(lateRaise(v)));
  T('[16] mutation "the kept skills ignore a raised settled run" turns it red', redBy('[16] stale after a raise', [['      if (r[3] && ELP.PRIOR[fam]) { const c = elpAllOf(st, p, seasonId); if (c) c.h = elpSkillsOf(st, p, seasonId, nowMs); }', '']], raiseOk));
  // (e) the placement taken back clears the changes recorded before it: a later conviction of one of those runs refunds nothing
  function twiceConvicted(m) {
    const st = { hist: {} }, t = now - 3 * DAY;
    [10, 10, 10, 10, 10, 30, 30].forEach((d, i) => m.ratingHistUpsert(st, 'V', i === 6 ? 'duo' : 'solo', 0, 100 + i, d, t + i * MIN, F, 500 + i)); m.elpSettleAll(st, 0, t + DAY);
    const c = st.hist['V|all|0'], d5 = st.hist['V|solo|0'].runs[5][4], d6 = st.hist['V|duo|0'].runs[0][4];
    m.ratingHistRemove(st, 'V', 'solo', 0, 104);                                              // the seeding run convicted: placement taken back
    m.ratingHistUpsert(st, 'V', 'solo', 0, 120, 10, t + 2 * DAY, F, 620); m.elpSettleAll(st, 0, t + 2 * DAY + 1);   // the next run seeds again
    const lpNew = c.lp, placed = c.placed;
    const hit1 = m.ratingHistRemove(st, 'V', 'solo', 0, 105), lpA = c.lp, hit2 = m.ratingHistRemove(st, 'V', 'duo', 0, 106), lpB = c.lp;
    return { d5, d6, placed, lpNew, lpA, lpB, hit1, hit2, voids: c.ring.filter((e) => (e.flags & PP.RECEIPT_F.VOID) && (e.mh === 505 || e.mh === 506)).map((e) => e.delta) };
  }
  const twiceOk = (m) => { const r = twiceConvicted(m); return r.d5 > 0 && r.d6 > 0 && r.placed === 1 && r.hit1 && r.hit2 && r.lpA === r.lpNew && r.lpB === r.lpNew; };
  { const r = twiceConvicted(v);
    T('[16] after the seeding run was convicted and the next run seeded again (' + r.lpNew + '), convicting two runs settled before that (a solo one +' + r.d5 + ', a duo one +' + r.d6 + ') takes nothing from the new points: those changes left with the old placement', twiceOk(v), JSON.stringify(r)); }
  T('[16] mutation "the changes recorded before a placement was taken back stay refundable" turns it red (the new points would pay for the old ones)', redBy('[16] double refund', [["      for (const e of elpFamEntries(st, p, seasonId)) { for (const r of e.h.runs) if (r[3] === 2) r[4] = 0; for (const g of (e.h.gone || [])) if (Array.isArray(g) && g[3]) g[1] = 0; } }", "    }"]], twiceOk));
  // (f) a damaged entry is left alone: nobody else waits for it
  function damaged(m) {
    const st = soloPlaced(m, 'OKP', now - 5 * DAY);
    st.hist['BADP|solo|0'] = { best: [0, 0], runs: [null, 7], old: [], t: 0 };
    st.hist['BADP|duo|0'] = { best: [0, 0], runs: [[1, 9, now - DAY, 0, 0, 0, now - DAY, 1, 77]], old: [], t: 0 };
    m.ratingHistUpsert(st, 'OKP', 'solo', 0, 300, 12, now - DAY, F, 9300);
    const out = m.elpSettleAll(st, 0, now);
    const lines = m.elpHiddensOf(st, 'solo', 0);
    const up = m.ratingHistUpsert(st, 'BADP', 'solo', 0, 5, 8, now, F, 78);   // his next segment: the entry is repaired on the way in (no throw)
    return { n: out.length, bad: out.bad, okSettled: st.hist['OKP|solo|0'].runs[5][3] === 2, badDuo: st.hist['BADP|duo|0'].runs[0][3] === 2, badKept: JSON.stringify(st.hist['BADP|solo|0'].runs.slice(0, 1)) !== '[null]' && up.runs.length === 1 && up.runs[0][0] === 5, lines: Object.keys(lines) };
  }
  { const r = damaged(v);
    T('[16] a damaged history entry (a run that is no list) is left alone and reported: the other players settle, his other family settles, the pass lines skip it; his next segment repairs the entry on the way in', r.n === 2 && JSON.stringify(r.bad) === '["BADP|solo|0"]' && r.okSettled && r.badDuo && r.badKept && JSON.stringify(r.lines) === '["OKP"]', JSON.stringify(r)); }
  T('[16] mutation "any entry with a runs list is read" throws on the damaged one (the lane would stop for everyone until the guard)', (() => { let threw = false; try { const m = mutantOf([['const elpEntryOk = (h) => !!h && Array.isArray(h.runs) && h.runs.every(Array.isArray);', 'const elpEntryOk = (h) => !!h && Array.isArray(h.runs);']]); damaged(m); } catch (e) { threw = !/anchor missing/.test(e.message); if (!threw) bad('[16] ' + e.message); } return threw; })());
}

if (failN) { console.log('FAIL (endless-rating) ' + failN); process.exit(1); } else console.log('ALL PASS (endless-rating)');
