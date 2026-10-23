'use strict';
// ============================================================
// endless-rating.js - O103 endless competitive rating (client knife 5.1a, 2026-10-15): run history -> rating ladders -> tier cuts
// ============================================================
// The companion repo's KNIFE_51_SEASON_BOARDS_PLAN (sections 0b / 2.1) in cron terms: every settled COMPETITIVE endless segment
// enters / raises its run in a per-(player, family, season) history (endless-solo.json `hist`); players with >= MIN_RUNS runs get
// a rating row (W_BEST x deepest + W_AVG x mean of the last WINDOW runs, 0.01-depth units) on endless_rating_{solo,duo,trio,quad}
// (+ season twins); a carrier row on endless_tiercut publishes, once per UTC day, the lowest score of each tier (prior floors
// blending into the live percentile as the field grows). The client only reads: its own rating row + the carrier.
//   [1] history: first segment enters a run, later ones raise it in place, window of 10 in first-seen order, ids pushed out guard
//       a late segment, best never drops
//   [2] conviction: the run leaves the history, best is recomputed from the window
//   [3] score: below MIN_RUNS none; weights; details [best, mean x 100, runs, 0]
//   [4] plan: new / changed rows written, current rows untouched, unqualified rows deleted, touched sids without history ignored
//   [5] cuts: no players = prior; <= 20 pure prior; >= 200 pure percentile; blend in between; monotone (one depth apart); tierOf
//   [6] carrier: encode / decode round trip, due on a new day / season / empty, history prune keeps two seasons
//   [7] wiring pins: provisioning, both lanes feed the history (EA only), correction removes the run, every exit path runs the
//       lane, PT_MODE guard, summary row, details shape kept off the ladder-write pin
//   [8] end to end over the REAL validate.js main() (offline board stub, settle-free tick): stale / unqualified / foreign rows on
//       the solo board are rewritten / deleted, the carrier is published from the resulting field (season 0, N = 25, blended
//       cuts; duo..quad = prior); a second tick with everything current writes nothing; the next UTC day republishes
//   [9] end to end settle: a duo competitive segment ten minutes old enters both writers' duo history; its next segment raises
//       the same run in place (still one run, nobody rated)
//  [10] mutation self-checks: the weights / MIN_RUNS pinned by [3] go red when changed
// Usage: node test/endless-rating.js
// ============================================================
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD',
  'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const R = v.RATING;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P = (sid) => v.pid(sid);

// ---- [1] history ----
console.log('-- [1] run history --');
{
  const st = { hist: {} };
  const pA = P(SID(1));
  const h = v.ratingHistUpsert(st, pA, 'solo', 0, 11, 5, 1000);
  eq('[1] first segment enters the run (depth reached, first-seen stamp) and sets best', [h.runs, h.best], [[[11, 5, 1000]], [11, 5]]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 10, 2000);
  eq('[1] a later segment raises the run in place (no second run, first-seen kept)', [h.runs, h.best], [[[11, 10, 1000]], [11, 10]]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 7, 3000);
  eq('[1] a shallower sighting never lowers the run', h.runs[0][1], 10);
  for (let i = 0; i < 12; i++) v.ratingHistUpsert(st, pA, 'solo', 0, 100 + i, i + 1, 4000 + i);
  eq('[1] window keeps the last 10 runs in first-seen order; best stays the deepest ever (run 100+11 = 12)', [h.runs.length, h.runs[0][0], h.runs[9][0], h.best], [10, 102, 111, [111, 12]]);
  eq('[1] ids pushed out of the window are remembered (run 11, 100, 101)', h.old, [11, 100, 101]);
  v.ratingHistUpsert(st, pA, 'solo', 0, 11, 30, 9000);
  eq('[1] a late segment of a run that left the window does not re-enter it, but can still raise best', [h.runs.length, h.runs.some(r => r[0] === 11), h.best], [10, false, [11, 30]]);
  v.ratingHistUpsert(st, pA, 'duo', 0, 11, 3, 9500);
  v.ratingHistUpsert(st, pA, 'solo', 1, 11, 3, 9600);
  eq('[1] family and season are separate entries', Object.keys(st.hist).sort(), [pA + '|duo|0', pA + '|solo|0', pA + '|solo|1'].sort());
  eq('[1] run id = fnv32 of the chain key (stable, 32-bit unsigned)', [v.ratingRunId('a|0|7'), v.ratingRunId('a|0|7') === v.fnv32('a|0|7'), v.fnv32('') === 0x811c9dc5], [v.fnv32('a|0|7'), true, true]);
  eq('[1] family of a seat count: 1 solo / 2 duo / 3 trio / 4 quad', [1, 2, 3, 4].map(v.ratingFamOf), ['solo', 'duo', 'trio', 'quad']);
  eq('[1] a depth-0 run (died on the first level) still counts as a run', v.ratingHistUpsert({ hist: {} }, pA, 'solo', 0, 5, 0, 1).runs, [[5, 0, 1]]);
}

// ---- [2] conviction ----
console.log('-- [2] conviction removes the run --');
{
  const st = { hist: {} };
  const pA = P(SID(1));
  for (let i = 0; i < 6; i++) v.ratingHistUpsert(st, pA, 'solo', 0, 200 + i, [4, 9, 30, 6, 7, 8][i], 100 + i);
  T('[2] removing the deepest run drops it and recomputes best from the window', v.ratingHistRemove(st, pA, 'solo', 0, 202) === true && st.hist[pA + '|solo|0'].runs.length === 5 && JSON.stringify(st.hist[pA + '|solo|0'].best) === JSON.stringify([201, 9]));
  T('[2] removing an unknown run changes nothing', v.ratingHistRemove(st, pA, 'solo', 0, 999) === false && st.hist[pA + '|solo|0'].runs.length === 5);
  T('[2] removing from a missing entry is false', v.ratingHistRemove(st, pA, 'quad', 0, 200) === false);
  const h = st.hist[pA + '|solo|0']; h.old = [777];
  T('[2] an id in `old` is cleared too (a later segment may then re-enter it as a fresh run)', v.ratingHistRemove(st, pA, 'solo', 0, 777) === true && h.old.length === 0);
}

// ---- [3] score ----
console.log('-- [3] score --');
{
  const st = { hist: {} };
  const pA = P(SID(1));
  for (let i = 0; i < 4; i++) v.ratingHistUpsert(st, pA, 'solo', 0, 300 + i, 10, i);
  eq('[3] four runs: not rated', v.ratingScoreOf(st.hist[pA + '|solo|0']), null);
  v.ratingHistUpsert(st, pA, 'solo', 0, 304, 20, 4);
  // best 20, mean (10*4 + 20) / 5 = 12 -> 75 * 20 + 25 * 12 = 1800
  eq('[3] five runs: score = 75 x best + 25 x mean (0.01 depths); details [best, mean x 100, runs, 0]', v.ratingScoreOf(st.hist[pA + '|solo|0']), { score: 1800, best: 20, avg100: 1200, n: 5, details: [20, 1200, 5, 0] });
  v.ratingHistUpsert(st, pA, 'solo', 0, 305, 7, 5);
  eq('[3] mean rounds to the nearest 0.01 depth (6 runs: (40 + 20 + 7) / 6 = 11.1667)', v.ratingScoreOf(st.hist[pA + '|solo|0']).score, Math.round(75 * 20 + 25 * (67 / 6)));
  eq('[3] constants pinned (lockstep with the client RANKED_CONFIG.ENDLESS.RATING)', [R.W_BEST, R.W_AVG, R.MIN_RUNS, R.WINDOW, R.PCT_MIN_PLAYERS, R.TIERS7],
    [75, 25, 5, 10, 50, [[1, 'grandmaster'], [4, 'master'], [10, 'diamond'], [20, 'platinum'], [35, 'gold'], [60, 'silver'], [100, 'bronze']]]);
  eq('[3] board names (season 0 = base; twins _s<N>)', [v.ENDLESS_RATING_LB_SOLO, v.ENDLESS_RATING_LB_DUO, v.ENDLESS_RATING_LB_TRIO, v.ENDLESS_RATING_LB_QUAD, v.ENDLESS_TIERCUT_LB, v.seasonBoardName(v.ENDLESS_RATING_LB_SOLO, 1)],
    ['endless_rating_solo', 'endless_rating_duo', 'endless_rating_trio', 'endless_rating_quad', 'endless_tiercut', 'endless_rating_solo_s1']);
  eq('[3] prior floors per family (depths, grandmaster..silver) + blend bounds', [R.PRIOR.solo, R.PRIOR.duo, R.PRIOR.trio, R.PRIOR.quad, R.N_PRIOR_ONLY, R.N_FULL],
    [[60, 40, 28, 20, 14, 8], [96, 64, 45, 32, 22, 13], [96, 64, 45, 32, 22, 13], [96, 64, 45, 32, 22, 13], 20, 200]);
}

// ---- [4] plan ----
console.log('-- [4] plan --');
{
  const st = { hist: {} };
  const [A, B, C, D] = [SID(1), SID(2), SID(3), SID(4)];
  for (let i = 0; i < 5; i++) { v.ratingHistUpsert(st, P(A), 'solo', 0, 400 + i, 10, i); v.ratingHistUpsert(st, P(B), 'solo', 0, 500 + i, 20, i); }
  for (let i = 0; i < 3; i++) v.ratingHistUpsert(st, P(C), 'solo', 0, 600 + i, 10, i);
  const existing = { [B]: { s: 2000, det: [20, 2000, 5, 0] }, [C]: { s: 1000, det: [10, 1000, 5, 0] }, [D]: { s: 1234, det: [] } };
  const plan = v.ratingPlan(st, 0, 'solo', existing, new Set([A, B, C]));
  eq('[4] A (touched, rated, no row) written; B current; C (3 runs) and D (no history) deleted',
    [plan.writes, plan.deletes.sort()], [[{ sid: A, score: 1000, details: [10, 1000, 5, 0] }], [C, D].sort()]);
  const plan2 = v.ratingPlan(st, 0, 'solo', { [B]: { s: 2000, det: [20, 2000] } }, new Set([SID(9)]));
  eq('[4] a row whose details are short / stale is rewritten once; a touched sid without history is ignored', plan2, { writes: [{ sid: B, score: 2000, details: [20, 2000, 5, 0] }], deletes: [] });
  eq('[4] another season / family sees none of it', v.ratingPlan(st, 1, 'solo', {}, new Set([A])), { writes: [], deletes: [] });
}

// ---- [5] cuts ----
console.log('-- [5] cuts --');
{
  const prior = R.PRIOR.solo;
  eq('[5] nobody rated: cuts = prior x 100, N 0, w 0', v.ratingCutsOf([], prior), { N: 0, w: 0, cuts: [6000, 4000, 2800, 2000, 1400, 800] });
  const few = Array.from({ length: 20 }, (_, i) => 9000 - i * 100);
  eq('[5] 20 rated players: still pure prior (w = 0) whatever they scored', v.ratingCutsOf(few, prior), { N: 20, w: 0, cuts: [6000, 4000, 2800, 2000, 1400, 800] });
  const many = Array.from({ length: 200 }, (_, i) => 20100 - i * 100);   // 20100 .. 200 (rank r -> 20100 - (r-1) * 100)
  const live = [1, 4, 10, 20, 35, 60].map(p => 20100 - (Math.ceil(p / 100 * 200) - 1) * 100);   // the score at rank ceil(p% x N)
  eq('[5] 200 rated players: pure live percentile (w = 1): rank ceil(p% x N) scores', v.ratingCutsOf(many, prior), { N: 200, w: 1, cuts: live });
  eq('[5] percentile ranks: 1% of 200 = rank 2, 4% = 8, 10% = 20, 20% = 40, 35% = 70, 60% = 120', live, [20000, 19400, 18200, 16200, 13200, 8200]);
  const mid = Array.from({ length: 110 }, (_, i) => 11000 - i * 100);
  const w = (110 - 20) / 180;
  const liveMid = [1, 4, 10, 20, 35, 60].map(p => 11000 - (Math.ceil(p / 100 * 110) - 1) * 100);
  const expMid = liveMid.map((l, i) => Math.round((1 - w) * prior[i] * 100 + w * l));
  eq('[5] 110 rated players: w = 0.5, each cut halfway between prior and live', v.ratingCutsOf(mid, prior), { N: 110, w: 0.5, cuts: expMid });
  const flat = Array.from({ length: 200 }, () => 1500);   // everybody at the same score
  eq('[5] monotone repair: with a flat field every live cut is equal -> pushed one depth apart from silver upward', v.ratingCutsOf(flat, prior).cuts, [2000, 1900, 1800, 1700, 1600, 1500]);
  const cuts = [6000, 4000, 2800, 2000, 1400, 800];
  eq('[5] tierOf: first cut the score reaches, top down; below silver = bronze', [6000, 5999, 4000, 2800, 2000, 1400, 800, 799, 0].map(s => v.ratingTierOf(s, cuts)),
    ['grandmaster', 'master', 'master', 'diamond', 'platinum', 'gold', 'silver', 'bronze', 'bronze']);
  eq('[5] tierOf without a table = null (client: "rating pending")', v.ratingTierOf(5000, null), null);
}

// ---- [6] carrier + prune ----
console.log('-- [6] carrier --');
{
  const byFam = { solo: v.ratingCutsOf([], R.PRIOR.solo), duo: { N: 7, cuts: [1, 2, 3, 4, 5, 6] }, trio: v.ratingCutsOf([], R.PRIOR.trio), quad: v.ratingCutsOf([], R.PRIOR.quad) };
  const det = v.tiercutEncode(1, byFam);
  eq('[6] carrier details = 30 ints: magic | version << 8 (O199), season, then N + six cuts per family (solo, duo, trio, quad)', [det.length, det[0], det[1], det.slice(2, 9), det.slice(9, 16)], [30, 0xEC | (1 << 8), 1, [0, 6000, 4000, 2800, 2000, 1400, 800], [7, 1, 2, 3, 4, 5, 6]]);
  const dec = v.tiercutDecode(20261201, det);
  eq('[6] decode round trip (day from the score)', [dec.day, dec.season, dec.byFam.duo, dec.byFam.quad.cuts], [20261201, 1, { N: 7, cuts: [1, 2, 3, 4, 5, 6] }, [9600, 6400, 4500, 3200, 2200, 1300]]);
  eq('[6] decode refuses a short / foreign row', [v.tiercutDecode(1, det.slice(0, 20)), v.tiercutDecode(1, [0x77].concat(det.slice(1))), v.tiercutDecode(1, null)], [null, null, null]);
  // O199 (knife 5.5b-2, architecture decision 9): version 0 rows (written before the version byte) still decode; an unknown version does not
  eq('[6] version 0 row (pre-version carrier) decodes to the same table', JSON.stringify(v.tiercutDecode(20261201, [0xEC].concat(det.slice(1)))), JSON.stringify(dec));
  eq('[6] unknown version 2 -> null (no table)', v.tiercutDecode(20261201, [0xEC | (2 << 8)].concat(det.slice(1))), null);
  eq('[6] due: no row / another day / another season; not when both match', [v.tiercutDue(null, 1, 20261201), v.tiercutDue(dec, 1, 20261202), v.tiercutDue(dec, 2, 20261201), v.tiercutDue(dec, 1, 20261201)], [true, true, true, false]);
  eq('[6] day = UTC calendar day YYYYMMDD', [v.tiercutDay(Date.UTC(2026, 11, 1, 0, 0, 0)), v.tiercutDay(Date.UTC(2026, 11, 1, 23, 59, 59)), v.tiercutDay(Date.UTC(2026, 11, 2))], [20261201, 20261201, 20261202]);
  const st = { hist: { 'a|solo|0': {}, 'b|duo|1': {}, 'c|solo|2': {}, 'd|quad|3': {} } };
  eq('[6] prune keeps the current and the previous season', [v.pruneRatingHist(st, 2), Object.keys(st.hist).sort()], [1, ['b|duo|1', 'c|solo|2', 'd|quad|3']]);
  eq('[6] prune in season 0 keeps everything of season 0', [v.pruneRatingHist({ hist: { 'a|solo|0': {} } }, 0)], [0]);
}

// ---- [7] wiring pins ----
console.log('-- [7] wiring pins --');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
{
  T('[7] rating boards + carrier provisioned up-front on the EA app (trusted), after the classic surface', /\[SAVE_BOX_LB_CLASSIC_QUAD, false\],[^\n]*\n\s*\[ENDLESS_RATING_LB_SOLO, true\], \[ENDLESS_RATING_LB_DUO, true\], \[ENDLESS_RATING_LB_TRIO, true\], \[ENDLESS_RATING_LB_QUAD, true\], \[ENDLESS_TIERCUT_LB, true\],\n\s*\[ENDLESS_LB_OVERALL, true\], \[ENDLESS_LB_CLASSIC_OVERALL, true\],[^\n]*\n\s*\[ENDLESS_CUP_LB, true\], \[ENDLESS_CUP_HONOR_LB, true\]\]\) \{/.test(SRC));   // O276 (knife 5.1b): casual / classic composites; O180 (knife 5.1c-1): cup carrier + honor board at the tail
  T('[7] the playtest / demo board plan does NOT provision the rating surface (EA only)', !/ratingLb|ENDLESS_RATING_LB|ENDLESS_TIERCUT_LB/.test(SRC.slice(SRC.indexOf('function ptBoardPlan('), SRC.indexOf('return { create, forbidden };'))));
  T('[7] solo competitive lane feeds the history (EA only, after the ladder block, inside the competitive branch)', /if \(!PT_MODE\) \{ ratingHistUpsert\(soloState, p, 'solo', f\.seasonId, ratingRunId\(key\), f\.endDepth, nowMs\); ratingTouched\.add\(sid\); \}/.test(SRC));
  T('[7] team competitive lane feeds the history per writer (fam.low = duo / trio / quad; inside the writer loop, after the ladder block)', /if \(!PT_MODE\) \{ ratingHistUpsert\(soloState, pid\(sid\), fam\.low, t\.seasonId, ratingRunId\(key\), f\.endDepth, nowMs\); ratingTouched\.add\(sid\); \}/.test(SRC));
  const lane = SRC.slice(SRC.indexOf("if ((t.flags | 0) & attest.SEG_COMP) {"), SRC.indexOf('// casual co-op: a shared perk build'));
  T('[7] team lane: the history write sits behind the reject-window skip (inside the writer loop, after the `continue`)', lane.indexOf('inside seedcap reject window -- outputs skipped') < lane.indexOf('ratingHistUpsert(soloState, pid(sid), fam.low'));
  T('[7] casual / classic lanes never feed the history (only two upsert sites, both competitive)', (SRC.match(/ratingHistUpsert\(soloState,/g) || []).length === 2);
  T('[7] seedcap correction removes the convicted run from the flagged seats (solo: runSeed key; team: roster set key) and marks them touched',
    /ratingHistRemove\(soloState, pid\(sidC\), famR, tC\.seasonId, ratingRunId\(keyR \|\| soloRunKey\(pid\(sidC\), tC\.seasonId, cg\[0\]\.d\[4\] \| 0\)\)\)/.test(SRC) && /teamRunKey\(Object\.values\(rosterC\)\.map\(String\), tC\.seasonId, cg\[0\]\.d\[4\] \| 0\)/.test(SRC));
  T('[7] the lane runs on every exit path (two settle-free returns + the main path beside trust, after the state save)', (SRC.match(/const st0 = loadSolo\(\); await maintainRating\(st0, new Set\(\)\);/g) || []).length === 2 && /if \(xpId\) saveXp\(xpState\);\n  await maintainRating\(soloState, ratingTouched\);[^\n]*\n(  if \(await maintainCup\(soloState, cupCounts\)\)[^\n]*\n)?  await maintainTrust\(\);/.test(SRC));   // O180: the settle-free paths share one loaded chain memory with the cup upkeep
  const laneSrc = SRC.slice(SRC.indexOf('const maintainRating = async (st, touched) => {'), SRC.indexOf('const persistStartsSide = () => {'));
  T('[7] lane: EA only (PT_MODE returns first); a read failure skips the family and never deletes; cuts not published when a family was skipped',
    /^\s*if \(PT_MODE\) return;/m.test(laneSrc) && /skipped this run, nothing deleted/.test(laneSrc) && /skipped this run -> cuts not published'\); return; \}/.test(laneSrc));
  T('[7] lane: season >= 1 resolves the twin via resolveSeasonBoard, season 0 the base board; rows written with ForceUpdate + 4-int details; deletes via DeleteLeaderboardScore',
    /seasonId >= 1 \? \(await resolveSeasonBoard\(lr, base, seasonId\)\)\.id : \(byName0\(base\) \|\| await findOrCreateBoard\(base, true\)\)/.test(laneSrc) && /scoremethod: 'ForceUpdate', format: 'json' \}, w\.details\);/.test(laneSrc) && /DeleteLeaderboardScore/.test(laneSrc));
  T('[7] lane: carrier = TIERCUT_CARRIER_SID, else the row already on the carrier board, else the version_gate carrier; published only when due (day / season)',
    /let carrier = TIERCUT_CARRIER_SID \|\| carrierOnBoard;/.test(laneSrc) && /byName0\('version_gate'\)/.test(laneSrc) && /if \(!tiercutDue\(published, seasonId, day\)\)/.test(laneSrc));
  T('[7] history pruned in the main-path tail before the chain memory is saved; summary row present', SRC.indexOf('pruneRatingHist(soloState, seasonId);') > 0 && SRC.indexOf('pruneRatingHist(soloState, seasonId);') < SRC.lastIndexOf('saveSolo(soloState, nowMs);') && /endless rating rows written \/ deleted \/ tier cuts \(O103\)/.test(SRC));
  T('[7] rating writes do not look like endless ladder writes (board-build-details pin counts [w.ts | 0, w.build | 0] writes only)', !/w\.details\]\);/.test(SRC));
  T('[7] loadSolo initialises hist (an older state file reads as empty history)', /st\.hist = st\.hist \|\| \{\}; return st;/.test(SRC) && /\{ runs: \{\}, wait: \{\}, ms: \{\}, held: \{\}, hist: \{\} \}/.test(SRC));
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
function runCron(boards, files, env) {
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
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
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
const BOARD = { progress: 5, cp: 8, compDuo: 16, compTrio: 13, compQuad: 17, rSolo: 30, rDuo: 31, rTrio: 32, rQuad: 33, tiercut: 41, vgate: 40 };
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
    { id: BOARD.rSolo, name: 'endless_rating_solo', entries: (extraRating && extraRating.solo) || [] }, { id: BOARD.rDuo, name: 'endless_rating_duo', entries: [] },
    { id: BOARD.rTrio, name: 'endless_rating_trio', entries: [] }, { id: BOARD.rQuad, name: 'endless_rating_quad', entries: [] },
    { id: BOARD.tiercut, name: 'endless_tiercut', entries: tiercutRows || [] },
    { id: BOARD.vgate, name: 'version_gate', entries: [{ steamID: CARRIER, score: 2026100101 }] });
  return boards;
}
const postsTo = (r, boardId, kind) => r.posts.filter(x => new RegExp(kind || 'SetLeaderboardScore').test(x.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(x.body));
const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };

// ---- [8] e2e: settle-free tick maintains the ladder + publishes the cuts ----
console.log('-- [8] e2e: ladder upkeep + carrier on a settle-free tick --');
{
  // 25 rated solo players (depth i+3 x 5 runs, best = deepest), 2 with three runs, 1 foreign row without history
  const hist = {};
  const rated = [], expScore = {};
  for (let i = 0; i < 25; i++) {
    const sid = SID(100 + i), st = { hist };
    for (let k = 0; k < 5; k++) v.ratingHistUpsert(st, P(sid), 'solo', 0, 1000 + i * 10 + k, i + 3 + (k === 4 ? 10 : 0), 1700000000000 + k);
    rated.push(sid); expScore[sid] = v.ratingScoreOf(hist[P(sid) + '|solo|0']);
  }
  for (const sid of [SID(200), SID(201)]) for (let k = 0; k < 3; k++) v.ratingHistUpsert({ hist }, P(sid), 'solo', 0, 2000 + k, 9, 1700000000000 + k);
  const stale = rated.map(sid => ({ steamID: sid, score: 1, details: [0, 0, 0, 0] }))   // every rated player has a stale row -> rewritten
    .concat([SID(200), SID(201)].map(sid => ({ steamID: sid, score: 500, details: [9, 900, 3, 0] })))   // three runs -> deleted
    .concat([{ steamID: SID(300), score: 777, details: [] }]);   // no history -> deleted
  const solo = { runs: {}, wait: {}, ms: {}, held: {}, hist };
  const r1 = runCron(world([], { solo: stale }), { SOLO_FILE: solo });
  T('[8] run exits 0 (no fresh matches)', r1.code === 0, r1.out.slice(-600));
  const w1 = postsTo(r1, BOARD.rSolo);
  const wrote = {}; for (const w of w1) wrote[field(w, 'steamid')] = { s: Number(field(w, 'score')), det: detailsOf(w) };
  T('[8] all 25 rated players rewritten with score + [best, mean x 100, runs, 0] details (ForceUpdate)', w1.length === 25 && rated.every(sid => wrote[sid] && wrote[sid].s === expScore[sid].score && JSON.stringify(wrote[sid].det) === JSON.stringify(expScore[sid].details)) && w1.every(w => field(w, 'scoremethod') === 'ForceUpdate'),
    'writes=' + w1.length + ' sample=' + JSON.stringify(wrote[rated[0]]) + ' exp=' + JSON.stringify(expScore[rated[0]]));
  const d1 = postsTo(r1, BOARD.rSolo, 'DeleteLeaderboardScore').map(w => field(w, 'steamid')).sort();
  eq('[8] the three unqualified rows deleted (two with three runs, one without history)', d1, [SID(200), SID(201), SID(300)].sort());
  T('[8] duo / trio / quad boards read, nothing written (no history)', [BOARD.rDuo, BOARD.rTrio, BOARD.rQuad].every(id => postsTo(r1, id).length === 0 && postsTo(r1, id, 'DeleteLeaderboardScore').length === 0));
  const tc1 = postsTo(r1, BOARD.tiercut);
  T('[8] carrier published once, under the version_gate carrier account, score = UTC day of the (pinned) clock', tc1.length === 1 && field(tc1[0], 'steamid') === CARRIER && Number(field(tc1[0], 'score')) === 20261001, JSON.stringify(tc1.map(w => w.body)));
  if (tc1.length) {
    const dec = v.tiercutDecode(Number(field(tc1[0], 'score')), detailsOf(tc1[0]));
    const scores = rated.map(sid => expScore[sid].score);
    const expSolo = v.ratingCutsOf(scores, R.PRIOR.solo);
    T('[8] solo cuts = blend of prior and the 25 live scores (w = 5/180); duo..quad = pure prior (N 0)', !!dec && dec.season === 0 && dec.byFam.solo.N === 25 && JSON.stringify(dec.byFam.solo.cuts) === JSON.stringify(expSolo.cuts) && Math.abs(expSolo.w - 5 / 180) < 1e-9
      && dec.byFam.duo.N === 0 && JSON.stringify(dec.byFam.duo.cuts) === JSON.stringify(R.PRIOR.duo.map(x => x * 100)) && JSON.stringify(dec.byFam.quad.cuts) === JSON.stringify(R.PRIOR.quad.map(x => x * 100)), JSON.stringify(dec));
    T('[8] the summary line reports the field (numbers only)', /rating summary \{"fam":"solo","rated":25,/.test(r1.out) && !new RegExp(SID(100)).test(r1.out.split('rating summary')[1] || ''));
    // second tick: every row current, carrier of the day on the board -> nothing written
    const current = rated.map(sid => ({ steamID: sid, score: expScore[sid].score, details: expScore[sid].details }));
    const carrierRow = [{ steamID: CARRIER, score: 20261001, details: detailsOf(tc1[0]) }];
    const r2 = runCron(world([], { solo: current }, carrierRow), { SOLO_FILE: solo });
    T('[8] second tick, everything current: zero rating writes / deletes, carrier not republished (same day, same season)', r2.code === 0 && postsTo(r2, BOARD.rSolo).length === 0 && postsTo(r2, BOARD.rSolo, 'DeleteLeaderboardScore').length === 0 && postsTo(r2, BOARD.tiercut).length === 0 && /tiercut/.test(r2.out) === false || /current 20261001/.test(r2.out) || postsTo(r2, BOARD.tiercut).length === 0,
      'posts=' + r2.posts.filter(x => /leaderboardid=(30|41)/.test(x.body)).length);
    T('[8] second tick: no SetLeaderboardScore to the solo rating board and none to the carrier', postsTo(r2, BOARD.rSolo).length === 0 && postsTo(r2, BOARD.tiercut).length === 0);
    // next UTC day: republished, rows still untouched
    const r3 = runCron(world([], { solo: current }, carrierRow), { SOLO_FILE: solo }, { SEASON_NOW: '2026-10-02T00:00:01Z' });
    const tc3 = postsTo(r3, BOARD.tiercut);
    T('[8] next UTC day: carrier republished (score 20261002) under the SAME account as the row on the board; rows untouched', r3.code === 0 && tc3.length === 1 && Number(field(tc3[0], 'score')) === 20261002 && field(tc3[0], 'steamid') === CARRIER && postsTo(r3, BOARD.rSolo).length === 0, JSON.stringify(tc3.map(w => w.body)));
    // the carrier can be pinned by env
    const r4 = runCron(world([], { solo: current }, []), { SOLO_FILE: solo }, { TIERCUT_CARRIER_SID: SID(555) });
    const tc4 = postsTo(r4, BOARD.tiercut);
    T('[8] TIERCUT_CARRIER_SID pins the carrier account', tc4.length === 1 && field(tc4[0], 'steamid') === SID(555));
    // no carrier anywhere: not published, run still green
    const noVg = world([], { solo: current }, []).filter(b => b.name !== 'version_gate');
    const r5 = runCron(noVg, { SOLO_FILE: solo });
    T('[8] no carrier account available (no version_gate row, env unset): cuts not published, run green, rows maintained', r5.code === 0 && postsTo(r5, BOARD.tiercut).length === 0 && /no carrier account/.test(r5.out));
  }
}

// ---- [9] e2e settle: a duo competitive segment enters the history ----
console.log('-- [9] e2e: settled duo segment -> history --');
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
  const seg = (hash, ros, sd, ed) => ros.map((sid, i) => ({ sid, d: start7(hash, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(hash, i, ros, sd, ed, attest.SEG_COMP) })));
  const ros = [SID(1), SID(2)];
  const rows1 = seg(0x4a01, ros, 0, 5);
  const r1 = runCron(world(rows1), null);
  T('[9] first sighting: paced (nothing settled yet), run green', r1.code === 0 && /endless-comp-pacing/.test(r1.out), r1.out.slice(-400));
  const r2 = runCron(world(rows1), advance(r1.state, 10 * 60000));
  const key = v.teamRunKey(ros, 0, SEED), rid = v.ratingRunId(key);
  const hA = ((r2.state.SOLO_FILE || {}).hist || {})[P(SID(1)) + '|duo|0'], hB = ((r2.state.SOLO_FILE || {}).hist || {})[P(SID(2)) + '|duo|0'];
  T('[9] ten minutes later the segment settles and both writers get a duo run at depth 5 (run id = hash of the roster-set chain key)', r2.code === 0 && /endless-comp settle/.test(r2.out) && hA && hB && hA.runs.length === 1 && hA.runs[0][0] === rid && hA.runs[0][1] === 5 && JSON.stringify(hA.best) === JSON.stringify([rid, 5]) && hB.runs[0][1] === 5,
    JSON.stringify([hA, hB]) + ' ' + r2.out.split('\n').filter(l => /endless-comp|rating/.test(l)).join(' | '));
  T('[9] the duo rating board was read for the touched writers; nobody rated (one run) -> no write', /rating summary \{"fam":"duo","rated":0/.test(r2.out) && postsTo(r2, BOARD.rDuo).length === 0);
  T('[9] the history has no steamID (pid-keyed, like the chain memory)', !JSON.stringify((r2.state.SOLO_FILE || {}).hist).includes(SID(1)));
  const rows2 = rows1.concat(seg(0x4a02, ros, 5, 10));
  const r3 = runCron(world(rows2), advance(r2.state, 10 * 60000));   // the next segment's first sighting (paced)
  const r4 = runCron(world(rows2), advance(r3.state, 10 * 60000));
  const hA4 = ((r4.state.SOLO_FILE || {}).hist || {})[P(SID(1)) + '|duo|0'];
  T('[9] the next segment of the same run (5 -> 10) raises the run in place: still one run, depth 10, best 10', r3.code === 0 && r4.code === 0 && hA4 && hA4.runs.length === 1 && hA4.runs[0][1] === 10 && hA4.best[1] === 10, JSON.stringify(hA4) + ' ' + r4.out.split('\n').filter(l => /endless-comp/.test(l)).join(' | '));
}

// ---- [10] mutation self-checks ----
console.log('-- [10] mutation self-checks --');
{
  const st = { hist: {} }, pA = P(SID(1));
  for (let i = 0; i < 5; i++) v.ratingHistUpsert(st, pA, 'solo', 0, 300 + i, i === 4 ? 20 : 10, i);
  const h = st.hist[pA + '|solo|0'];
  const wb = R.W_BEST, wa = R.W_AVG, mr = R.MIN_RUNS;
  R.W_BEST = 70; R.W_AVG = 30;
  T('[10] changing the weights changes the score the [3] fixture pins (1800 -> ' + v.ratingScoreOf(h).score + ')', v.ratingScoreOf(h).score !== 1800);
  R.W_BEST = wb; R.W_AVG = wa;
  R.MIN_RUNS = 6;
  T('[10] raising MIN_RUNS un-rates the five-run fixture', v.ratingScoreOf(h) === null);
  R.MIN_RUNS = mr;
  T('[10] restored', v.ratingScoreOf(h).score === 1800);
}

if (failN) { console.log('FAIL (endless-rating) ' + failN); process.exit(1); } else console.log('ALL PASS (endless-rating)');
