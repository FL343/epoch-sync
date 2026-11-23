'use strict';
// ============================================================
// gen-points-fixtures.js - the golden cases of points-plan.js (O480)
// ============================================================
// Writes fixtures/points-plan/cases.json: hand-picked match situations (the INPUTS below) and what points-plan.js settles
// for them today (the outputs). Both repos replay the file -- this repo's test/points-plan-fixtures.js against points-plan.js,
// the client's against its vendored copy -- so a number that moves on one side only turns one of them red.
//   node tools/gen-points-fixtures.js           write the file and print its FIXTURES_HASH
//   node tools/gen-points-fixtures.js --check   exit 1 when the file is not what a fresh generation gives
// Regenerate only with a rules change (RULES_VER + 1 and FIXTURES_HASH in points-plan.js, same change), and read the diff:
// every output that moves is a settled delta that moves for players.
// Case kinds:
//   match: one ranked settle. parts = the rated players (seat, mmr = the rating the plan reads, rank = the settle's place among
//     them, lp = points before the match -- the seed for a player seeded by this settle, seeded = true then); team (team codes
//     only) = { scores, leaverSeats, winTeam, absent, finished } as the settle passes them. out = per player the plan row (or
//     null) and the points line (settleLine: d0 / d / won / nv). O716: a mixed table (a ranked-seat mask on the code) rates
//     every seat in the plan (the mismatch reads the whole table, D11; a quick team member at his row or his unwritten
//     placement seed, D8) and settles its ranked seats only: a quick seat's out is null (no points line).
//   seed: { prev, display, hasPrev } -> seasonSeedLp (prev null = no row on the previous season's board; hasPrev = the season
//     has a previous one, season 1 and later -- O786: a player with no row then soft-resets his display seed; absent = preseason).
//   leave: { cur } -> the points after the leaver fine (LEAVER_LP_PENALTY).
//   boundary: { lp } -> boundaryOf (the client's series banner reads the same).
//   seat: { mt } -> which seats of the code move points (O716 one queue: the ranked-seat mask in bits 11-16; no mask = the old
//     whole-table rule): { mask, sans: the code without the mask, base, any: anyAppliesLp, seats: seatAppliesLp of seats 0..5 }.
//     A case added here moves no settled delta (no RULES_VER bump): it pins the reading both sides share.
//   endless: { fn, args } -> PP[fn](...args), one O728 endless points function (hiddenOf / teamHiddenOf (O803) / elpIsTeam / elpConvert / elpHiddenFor (O825) / elpSeedHidden (version 6) /
//     tierOfHidden / skillTierOf / targetOffset / targetLineOf / targetOf / endlessDelta / endlessSettle / endlessSeedLp / elpRowDetails / elpRowOf /
//     elpTableDetails / elpTableOf) at fixed inputs. The endless rules carry their own version (ELP.VER on the published table), not RULES_VER: an endless
//     case that moves bumps ELP.VER. O825 (ELP v4): the cases of version 3 keep their inputs and their values (endlessDelta's result gained the field team,
//     false for them; fixtures/points-plan/elp-v3-solo.json freezes them, test/endless-lp.js [11]); the row cases moved to the v2 layout.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'points-plan', 'cases.json');
const P = (id, seat, mmr, rank, lp, seeded) => Object.assign({ id, seat, mmr, rank, lp }, seeded ? { seeded: true } : {});
// O717: a part in a placement match of the season (settleLine mode.placing); seeded too = the seed settle of a placement
const PL = (id, seat, mmr, rank, lp, seeded) => Object.assign(P(id, seat, mmr, rank, lp, seeded), { placing: true });
// O717: a points row's details carrying a receipt ring of these flags, newest first (the reveal slot empty)
const RING = (...flags) => [0, 0, 0, 0, 0, 0, 0xC6, flags.length].concat(...flags.map((f, i) => [7100 + i, 10 + i, f | (2 << 8)]));
const ffa = (b, mask, trioAt) => (b | ((mask | 0) << 4) | ((trioAt | 0) << 8));
const seats = (mt, ranked) => (mt | ((ranked | 0) << 11));   // O716: the ranked-seat mask (RANKED_SEAT_SHIFT)

const CASES = [
  // ---- solo FFA, fair (no plan: the plain lpDelta at each own place) ----
  { name: 'ffa2 fair bronze', kind: 'match', mt: 2, parts: [P('a', 0, 1000, 1, 300), P('b', 1, 1100, 2, 320)] },
  { name: 'ffa3 fair silver', kind: 'match', mt: 2, parts: [P('a', 0, 1200, 1, 900), P('b', 1, 1250, 2, 1500), P('c', 2, 1100, 3, 900)] },
  { name: 'ffa4 fair gold', kind: 'match', mt: 2, parts: [P('a', 0, 1500, 1, 2200), P('b', 1, 1450, 2, 2500), P('c', 2, 1600, 3, 2800), P('d', 3, 1550, 4, 2400)] },
  { name: 'ffa5 fair platinum and diamond', kind: 'match', mt: 2, parts: [P('a', 0, 1700, 1, 3400), P('b', 1, 1750, 2, 4500), P('c', 2, 1800, 3, 3600), P('d', 3, 1650, 4, 5200), P('e', 4, 1720, 5, 3300)] },
  { name: 'ffa6 fair master and grandmaster', kind: 'match', mt: 2, parts: [P('a', 0, 2000, 1, 6500), P('b', 1, 2100, 2, 8300), P('c', 2, 2050, 3, 7000), P('d', 3, 1990, 4, 9000), P('e', 4, 2200, 5, 6200), P('f', 5, 2150, 6, 8800)] },
  { name: 'ffa4 fair, a tie for second (competition ranking 1 2 2 4)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 1000), P('b', 1, 1350, 2, 1100), P('c', 2, 1250, 2, 1200), P('d', 3, 1300, 4, 900)] },
  { name: 'ffa2 spread exactly at the threshold (400: no mismatch)', kind: 'match', mt: 2, parts: [P('a', 0, 1400, 1, 2500), P('b', 1, 1000, 2, 2500)] },
  // ---- mismatch (rating spread over the threshold) ----
  { name: 'ffa2 spread 401, the weak side wins (UPSET, full)', kind: 'match', mt: 2, parts: [P('s', 0, 1401, 2, 2500), P('w', 1, 1000, 1, 2500)] },
  { name: 'ffa2 mismatch, the weak side loses (PROTECTED, strong gain compressed)', kind: 'match', mt: 2, parts: [P('s', 0, 1800, 1, 300), P('w', 1, 1000, 2, 300)] },
  { name: 'ffa4 mismatch across tiers', kind: 'match', mt: 2, parts: [P('a', 0, 2100, 1, 4300), P('b', 1, 1300, 2, 1300), P('c', 2, 1900, 3, 3500), P('d', 3, 1200, 4, 800)] },
  { name: 'ffa6 mismatch, grandmasters win as expected (rs 0: drip only)', kind: 'match', mt: 2, parts: [P('a', 0, 2600, 1, 8500), P('b', 1, 2550, 2, 8200), P('c', 2, 1500, 3, 2100), P('d', 3, 1400, 4, 1900), P('e', 4, 1450, 5, 2300), P('f', 5, 1350, 6, 1700)] },
  { name: 'ffa3 mismatch, the strong side is upset (mild loss)', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 3, 4500), P('w1', 1, 1300, 1, 1500), P('w2', 2, 1350, 2, 1600)] },
  // ---- premade units (party bits of the code) ----
  { name: 'ffa4 pair seats 0-1, both present (unit average rank)', kind: 'match', mt: ffa(2, 1, 0), parts: [P('p0', 0, 1300, 1, 1000), P('p1', 1, 1300, 4, 1000), P('c', 2, 1300, 2, 1000), P('d', 3, 1300, 3, 1000)] },
  { name: 'ffa4 pair seats 2-3 at different tiers (unit average points pick the tier)', kind: 'match', mt: ffa(2, 2, 0), parts: [P('a', 0, 1400, 2, 2400), P('b', 1, 1450, 4, 2600), P('p2', 2, 1420, 1, 1500), P('p3', 3, 1430, 3, 3100)] },
  { name: 'ffa4 pair seats 0-1, the partner left (solo fallback)', kind: 'match', mt: ffa(2, 1, 0), parts: [P('p0', 0, 1300, 1, 1000), P('c', 2, 1300, 2, 1000), P('d', 3, 1300, 3, 1000)] },
  { name: 'ffa6 trio seats 0-2 wins (convoy tax), solos lose (escort shield)', kind: 'match', mt: ffa(2, 0, 1), parts: [P('t0', 0, 1500, 1, 2300), P('t1', 1, 1500, 2, 2300), P('t2', 2, 1500, 3, 2300), P('s3', 3, 1500, 4, 2300), P('s4', 4, 1500, 5, 2300), P('s5', 5, 1500, 6, 2300)] },
  { name: 'ffa6 trio seats 3-5 and a pair seats 0-1, with a mismatch', kind: 'match', mt: ffa(2, 1, 4), parts: [P('p0', 0, 1300, 2, 1100), P('p1', 1, 1350, 5, 1200), P('s2', 2, 1800, 1, 3200), P('t3', 3, 1400, 3, 2000), P('t4', 4, 1420, 4, 2100), P('t5', 5, 1380, 6, 1900)] },
  { name: 'ffa6 trio seats 1-3 with one member gone (solos)', kind: 'match', mt: ffa(2, 0, 2), parts: [P('a', 0, 1500, 1, 2300), P('t1', 1, 1500, 2, 2300), P('t2', 2, 1500, 3, 2300), P('s4', 4, 1500, 4, 2300), P('s5', 5, 1500, 5, 2300)] },
  // ---- team codes ----
  { name: 'team 2v2 ranked brawl (mt 4), team A wins on money', kind: 'match', mt: 4, parts: [P('a0', 0, 1500, 1, 2300), P('a1', 1, 1500, 2, 2600), P('b2', 2, 1500, 3, 2400), P('b3', 3, 1500, 4, 2200)],
    team: { scores: [900, 700, 800, 500], leaverSeats: [], winTeam: null } },
  { name: 'team 2v2 ranked mode 2 (mt 6), the sub-score winner B holds less money', kind: 'match', mt: 6, parts: [P('a0', 0, 1500, 3, 1000), P('a1', 1, 1500, 4, 1100), P('b2', 2, 1500, 1, 900), P('b3', 3, 1500, 2, 1200)],
    team: { scores: [100, 40, 95, 60], leaverSeats: [], winTeam: 1 } },
  { name: 'team 3v3 ranked (mt 9), fair', kind: 'match', mt: 9, parts: [P('a0', 0, 1600, 1, 3100), P('a1', 1, 1600, 2, 3300), P('a2', 2, 1600, 3, 2900), P('b3', 3, 1600, 4, 3000), P('b4', 4, 1600, 5, 3200), P('b5', 5, 1600, 6, 3400)],
    team: { scores: [500, 400, 300, 200, 250, 150], leaverSeats: [], winTeam: 0 } },
  { name: 'team 2v2 (mt 6), a loser\'s teammate left (abandoned-teammate shield)', kind: 'match', mt: 6, parts: [P('a0', 0, 1500, 1, 4200), P('a1', 1, 1500, 2, 4300), P('b2', 2, 1500, 3, 4100)],
    team: { scores: [500, 400, 300, 0], leaverSeats: [3], winTeam: 0 } },
  { name: 'team 2v2 (mt 6) mismatch, the weak team wins (UPSET), the strong team loses mildly', kind: 'match', mt: 6, parts: [P('a0', 0, 1100, 1, 1500), P('a1', 1, 1150, 2, 1400), P('b2', 2, 1900, 3, 4500), P('b3', 3, 1850, 4, 4700)],
    team: { scores: [300, 250, 200, 180], leaverSeats: [], winTeam: 0 } },
  { name: 'team 2v2 (mt 6) expected win while the weak team left at the start (Q167 absent rows)', kind: 'match', mt: 6, parts: [P('a0', 0, 2600, 1, 8500), P('a1', 1, 2550, 2, 8400)],
    team: { scores: [500, 450, 0, 0], leaverSeats: [2, 3], winTeam: 0, absent: [{ seat: 2, mmr: 1000, lp: 0 }, { seat: 3, mmr: 1000, lp: 0 }] } },
  { name: 'team 3v3 (mt 9) with a finished seat whose record is gone (Q183)', kind: 'match', mt: 9, parts: [P('a0', 0, 1600, 1, 3100), P('a1', 1, 1600, 2, 3300), P('b3', 3, 1600, 4, 3000), P('b4', 4, 1600, 5, 3200), P('b5', 5, 1600, 6, 3400)],
    team: { scores: [500, 400, 300, 200, 250, 150], leaverSeats: [], winTeam: 0, finished: [{ seat: 2, mmr: 1600, lp: 2900 }] } },
  { name: 'team 2v2 (mt 6) shielded loser, the leaver had more points (Q183 full-team reading)', kind: 'match', mt: 6, parts: [P('a0', 0, 1500, 1, 2100), P('a1', 1, 1500, 2, 2200), P('b2', 2, 1500, 3, 1900)],
    team: { scores: [400, 300, 200, 0], leaverSeats: [3], winTeam: 0, absent: [{ seat: 3, mmr: 1700, lp: 4100 }] } },
  // ---- the promotion / relegation series ----
  { name: 'series: promotion zone, top half (forced up to min + 150, O785)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 1960), P('b', 1, 1300, 2, 1500), P('c', 2, 1300, 3, 1500), P('d', 3, 1300, 4, 1500)] },
  { name: 'series: relegation zone, bottom half (forced down to min - 150, O785)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 2600), P('b', 1, 1300, 2, 2600), P('c', 2, 1300, 3, 2600), P('d', 3, 1300, 4, 2050)] },
  { name: 'series: relegation zone, PROTECTED loss keeps its compressed delta', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 1, 2600), P('w', 1, 1300, 2, 2050)] },
  { name: 'series: promotion zone, natural delta already past the line is kept', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 595), P('b', 1, 1300, 2, 400)] },
  { name: 'series: relegation zone, the strong side upset is still forced down (PROTECTED is the weak side only)', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 3, 4100), P('w1', 1, 1300, 1, 1500), P('w2', 2, 1350, 2, 1600)] },
  { name: 'series: a player seeded by this settle skips the clamp', kind: 'match', mt: 2, parts: [P('n', 0, 1720, 1, 2880, true), P('b', 1, 1700, 2, 2500)] },
  { name: 'series: grandmaster line, relegation loss', kind: 'match', mt: 2, parts: [P('a', 0, 2400, 1, 8600), P('b', 1, 2400, 2, 8050)] },
  // ---- O717 placement matches of a season (settleLine mode.placing: the promotion series as ever, no relegation series, under master) ----
  { name: 'placement: relegation zone, bottom half (no relegation series: the natural delta)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 2600), P('b', 1, 1300, 2, 2600), P('c', 2, 1300, 3, 2600), PL('d', 3, 1300, 4, 2050)] },
  { name: 'placement: promotion zone, top half (the promotion series as ever: up to min + 150)', kind: 'match', mt: 2, parts: [PL('a', 0, 1300, 1, 1960), P('b', 1, 1300, 2, 1500), P('c', 2, 1300, 3, 1500), P('d', 3, 1300, 4, 1500)] },
  { name: 'placement: diamond promotion zone, top half (held at 5999: the reveal is at most diamond)', kind: 'match', mt: 2, parts: [PL('a', 0, 1300, 1, 5900), P('b', 1, 1300, 2, 4500), P('c', 2, 1300, 3, 4500), P('d', 3, 1300, 4, 4500)] },
  { name: 'placement: the same match as his sixth (placed: promoted to master)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 5900), P('b', 1, 1300, 2, 4500), P('c', 2, 1300, 3, 4500), P('d', 3, 1300, 4, 4500)] },
  { name: 'placement: diamond 5990, a natural win past the master line (held at 5999)', kind: 'match', mt: 2, parts: [PL('a', 0, 1300, 1, 5990), P('b', 1, 1300, 2, 4500)] },
  { name: 'placement: the seed settle of a placement (seeded wins: no clamp, no cap)', kind: 'match', mt: 2, parts: [PL('n', 0, 1720, 1, 2880, true), P('b', 1, 1700, 2, 2500)] },
  { name: 'placement: relegation zone, a PROTECTED loss keeps its compressed delta', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 1, 2600), PL('w', 1, 1300, 2, 2050)] },
  { name: 'placement: team 2v2 (mt 6), losers in the relegation zone keep the natural team delta (b3 placed: forced down), winners in the promotion zone go up', kind: 'match', mt: 6,
    parts: [PL('a0', 0, 1500, 1, 1950), PL('a1', 1, 1500, 2, 1920), PL('b2', 2, 1500, 3, 2050), P('b3', 3, 1500, 4, 2060)], team: { scores: [300, 250, 200, 180], leaverSeats: [], winTeam: 0 } },
  { name: 'placement: already over the cap (out of reach from a season turn): a win holds his points, a loss in the band is natural', kind: 'match', mt: 2, parts: [PL('a', 0, 1300, 1, 6100), PL('b', 1, 1300, 2, 6100)] },
  // ---- O717 placementOf: the settled matches of a season on a row's receipt ring ----
  //   (PLACEMENT_TARGET 3 since 2026-11-18, was 5: the cases below sit around 3; the parameter case keeps a 5)
  { name: 'placementOf: two entries, the first seeded (2, placing)', kind: 'placement', det: RING(0, 16), target: 0 },
  { name: 'placementOf: three entries (placed at the target)', kind: 'placement', det: RING(0, 0, 16), target: 0 },
  { name: 'placementOf: five entries (placed, past the target)', kind: 'placement', det: RING(0, 0, 0, 0, 16), target: 0 },
  { name: 'placementOf: a void and a leaver fine do not count (4 entries, 2: placing)', kind: 'placement', det: RING(32, 4, 0, 16), target: 0 },
  { name: 'placementOf: the first match a leave (SEEDED + LEAVE does not count: 2, placing)', kind: 'placement', det: RING(0, 0, 16 | 4), target: 0 },
  { name: 'placementOf: a full ring whose seed entry was pushed out (placed, n null)', kind: 'placement', det: RING(32, 32, 32, 32, 0, 0, 0, 0), target: 0 },
  { name: 'placementOf: a full ring still holding the seed entry (2 settled, placing)', kind: 'placement', det: RING(32, 32, 32, 32, 32, 32, 0, 16), target: 0 },
  { name: 'placementOf: a row with no ring (before O480: placed, ring false)', kind: 'placement', det: [], target: 0 },
  { name: 'placementOf: a row with the reveal slot only (placed, ring false)', kind: 'placement', det: [0xC5, 1, 2, 3, 4, 5], target: 0 },
  { name: 'placementOf: the target as a parameter (5: four settled are still placing)', kind: 'placement', det: RING(0, 0, 0, 16), target: 5 },
  { name: 'placementOf: the seed match only (1)', kind: 'placement', det: RING(16), target: 0 },
  // ---- the board bounds ----
  { name: 'clamp: the top of the board (9999)', kind: 'match', mt: 2, parts: [P('a', 0, 2600, 1, 9990), P('b', 1, 2600, 2, 9500)] },
  { name: 'clamp: the floor (0)', kind: 'match', mt: 2, parts: [P('a', 0, 1000, 1, 100), P('b', 1, 1000, 2, 3)] },
  // ---- first settle of a season (placement) ----
  { name: 'seed: no previous season, display 900', kind: 'seed', prev: null, display: 900 },
  { name: 'seed: no previous season, display 1000', kind: 'seed', prev: null, display: 1000 },
  { name: 'seed: no previous season, display 1300', kind: 'seed', prev: null, display: 1300 },
  { name: 'seed: no previous season, display 1720 (promotion zone)', kind: 'seed', prev: null, display: 1720 },
  { name: 'seed: no previous season, display 2500 (cap)', kind: 'seed', prev: null, display: 2500 },
  { name: 'seed: previous season bronze 500 (kept)', kind: 'seed', prev: 500, display: 2000, hasPrev: true },
  { name: 'seed: previous season bronze 590 (kept, but not above the silver landing 540)', kind: 'seed', prev: 590, display: 2000, hasPrev: true },
  { name: 'seed: previous season silver 1900 (one tier down: bronze 540)', kind: 'seed', prev: 1900, display: 1000, hasPrev: true },
  { name: 'seed: previous season gold 2500 (one tier down: silver 1940)', kind: 'seed', prev: 2500, display: 1000, hasPrev: true },
  { name: 'seed: previous season diamond 4500 (one tier down: platinum 3940)', kind: 'seed', prev: 4500, display: 1000, hasPrev: true },
  { name: 'seed: previous season master 7000 (one tier down: diamond 5940)', kind: 'seed', prev: 7000, display: 1000, hasPrev: true },
  { name: 'seed: previous season grandmaster 9000 (reveal at most diamond: 5940)', kind: 'seed', prev: 9000, display: 1000, hasPrev: true },
  { name: 'seed: previous season row at 0', kind: 'seed', prev: 0, display: 2500, hasPrev: true },
  { name: 'seed: season 1, no previous row, display 1650 (O786 same ruler: the display seed 1600 soft-resets to 540)', kind: 'seed', prev: null, display: 1650, hasPrev: true },
  { name: 'seed: season 1, no previous row, display 1900 (seed 2600 -> 1940)', kind: 'seed', prev: null, display: 1900, hasPrev: true },
  { name: 'seed: season 1, no previous row, display 2500 (seed cap 3200 -> 2940)', kind: 'seed', prev: null, display: 2500, hasPrev: true },
  { name: 'seed: season 1, no previous row, display 1000 (seed 0 stays 0)', kind: 'seed', prev: null, display: 1000, hasPrev: true },
  // ---- the leaver fine ----
  { name: 'leave: 250 points', kind: 'leave', cur: 250 },
  { name: 'leave: 60 points (floor)', kind: 'leave', cur: 60 },
  { name: 'leave: 0 points', kind: 'leave', cur: 0 },
  { name: 'leave: grandmaster 8050 (no series rule on a leave)', kind: 'leave', cur: 8050 },
  // ---- the series banner ----
  { name: 'boundary: 1880 (promotion)', kind: 'boundary', lp: 1880 },
  { name: 'boundary: 1879 (none)', kind: 'boundary', lp: 1879 },
  { name: 'boundary: 2120 (relegation)', kind: 'boundary', lp: 2120 },
  { name: 'boundary: 0 (none at the floor)', kind: 'boundary', lp: 0 },
  { name: 'boundary: 8100 (relegation at the grandmaster line)', kind: 'boundary', lp: 8100 },
  { name: 'boundary: 9999 (none at the top)', kind: 'boundary', lp: 9999 },
  // ---- O716 one queue: which seats move points (the ranked-seat mask) ----
  { name: 'seat: quick brawl (1), no mask = no seat', kind: 'seat', mt: 1 },
  { name: 'seat: old ranked brawl (2), no mask = every seat', kind: 'seat', mt: 2 },
  { name: 'seat: old ranked brawl with a pair (2 | pair 0), no mask = every seat', kind: 'seat', mt: ffa(2, 1, 0) },
  { name: 'seat: old ranked 3V3 (9), no mask = every seat', kind: 'seat', mt: 9 },
  { name: 'seat: quick team brawl (3), no mask = no seat', kind: 'seat', mt: 3 },
  { name: 'seat: quick brawl of four, seats 0 and 2 ranked', kind: 'seat', mt: seats(1, 0b000101) },
  { name: 'seat: quick brawl, a ranked pair at seats 0-1 (pair bit 0)', kind: 'seat', mt: seats(ffa(1, 1, 0), 0b000011) },
  { name: 'seat: quick brawl of six, a ranked trio at seats 3-5 (trio bits)', kind: 'seat', mt: seats(ffa(1, 0, 4), 0b111000) },
  { name: 'seat: quick 2V2 (5), one ranked seat a side', kind: 'seat', mt: seats(5, 0b000101) },
  { name: 'seat: quick 3V3 (8), every seat ranked', kind: 'seat', mt: seats(8, 0b111111) },
  { name: 'seat: a 1V1, seat 1 ranked', kind: 'seat', mt: seats(1, 0b000010) },
  // ---- O716 mixed tables (part B): the plan over every seat, the points lines of the ranked seats only ----
  { name: 'mixed ffa4 fair: seats 0 and 2 ranked (no plan: each ranked seat at its own place of four)', kind: 'match', mt: seats(1, 0b0101),
    parts: [P('a', 0, 1300, 1, 1000), P('q1', 1, 1310, 2, 0), P('c', 2, 1290, 3, 1200), P('q3', 3, 1300, 4, 900)] },
  { name: 'mixed ffa4 mismatch: a strong quick seat, the ranked seats read the whole table (D11)', kind: 'match', mt: seats(1, 0b1010),
    parts: [P('q0', 0, 2100, 1, 0), P('b', 1, 1300, 2, 1500), P('q2', 2, 1350, 3, 0), P('d', 3, 1250, 4, 1400)] },
  { name: 'mixed ffa4 with a quick premade pair (seats 2-3) and two ranked solos', kind: 'match', mt: seats(ffa(1, 2, 0), 0b0011),
    parts: [P('a', 0, 1400, 2, 2400), P('b', 1, 1450, 4, 2600), P('q2', 2, 1420, 1, 0), P('q3', 3, 1430, 3, 0)] },
  { name: 'mixed ffa3: a ranked seat seeded by this settle among two quick seats', kind: 'match', mt: seats(1, 0b001),
    parts: [P('n', 0, 1720, 1, 2880, true), P('q1', 1, 1700, 2, 0), P('q2', 2, 1650, 3, 0)] },
  { name: 'mixed team brawl (3): one ranked, one quick a side; the quick members at their row / placement seed (D8)', kind: 'match', mt: seats(3, 0b0101),
    parts: [P('a0', 0, 1500, 1, 1000), P('q1', 1, 2360, 2, 3200), P('a2', 2, 1500, 3, 1000), P('q3', 3, 1500, 4, 500)],
    team: { scores: [900, 700, 600, 500], leaverSeats: [], winTeam: null } },
  { name: 'mixed 2V2 (5): a ranked pair against a quick pair, the quick pair wins on the sub-score', kind: 'match', mt: seats(5, 0b0011),
    parts: [P('a0', 0, 1600, 3, 2300), P('a1', 1, 1600, 4, 2600), P('q2', 2, 1500, 1, 0), P('q3', 3, 1500, 2, 0)],
    team: { scores: [100, 40, 95, 60], leaverSeats: [], winTeam: 1 } },
  { name: 'mixed 3V3 (8): one ranked member a side, a quick member of the losing side left (shield)', kind: 'match', mt: seats(8, 0b001001),
    parts: [P('a0', 0, 1600, 1, 3100), P('q1', 1, 1600, 2, 3000), P('q2', 2, 1600, 3, 2900), P('a3', 3, 1600, 4, 3000), P('q4', 4, 1600, 5, 3200)],
    team: { scores: [500, 400, 300, 200, 250, 0], leaverSeats: [5], winTeam: 0 } },
  // ---- O728 endless competitive points: the per-run target, the pass / miss points, the placement seed, the row and the table ----
  ...endlessCases(),
  // ---- O991 version 8 (the grow phase): kind elpLevel8 ----
  ...level8Cases(),
];
// the endless cases (O728): fixed pass lines (not ELP.PRIOR, so retuning the prior moves no case)
function endlessCases() {
  const SOLO = [2, 6, 10, 15, 24, 38, 55], DUO = [3, 10, 16, 24, 38, 61, 88], TRIO = [3, 11, 18, 27, 40, 60, 85], QUAD = [4, 12, 20, 30, 44, 66, 90];
  const LINES = { solo: SOLO, duo: DUO, trio: TRIO, quad: QUAD };
  const E = (name, fn, args) => ({ name: 'endless: ' + name, kind: 'endless', fn, args });
  const out = [
    // the hidden skill (depths newest first)
    E('hidden, no run', 'hiddenOf', [[]]),
    E('hidden, 4 runs (version 6: trimmed from three runs on -- the two middle ones)', 'hiddenOf', [[10, 9, 8, 7]]),
    E('hidden, 3 runs = the middle one', 'hiddenOf', [[10, 4, 8]]),
    E('hidden, 2 runs = null', 'hiddenOf', [[10, 9]]),
    E('hidden, 4 runs counted as version 5 did (the last argument 5) = null', 'hiddenOf', [[10, 9, 8, 7], null, 5]),
    E('hidden, 4 runs read for a placement target as version 5 did (plain mean)', 'hiddenOf', [[10, 9, 8, 7], 1, 5]),
    E('hidden, 4 runs read for a placement target (version 6: three runs or more = the trimmed mean)', 'hiddenOf', [[10, 9, 8, 7], 1]),
    E('hidden, 2 runs read for a placement target (plain mean)', 'hiddenOf', [[10, 7], 1]),
    E('hidden, 1 run read for a placement target', 'hiddenOf', [[0], 1]),
    E('hidden, 5 runs (the highest and the lowest leave)', 'hiddenOf', [[30, 9, 8, 7, 0]]),
    E('hidden, 12 runs (the newest 10 count)', 'hiddenOf', [[5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 90, 90]]),
    E('hidden, a rounding mean (x100 to the nearest)', 'hiddenOf', [[3, 4, 4, 5, 9, 1]]),
    E('hidden, a negative depth counts as 0', 'hiddenOf', [[-3, 2, 2, 2, 2]]),
    // O803: the team's usual level (the one target of a team run): the equal-weight mean of the seats that have a skill
    E('team level, no seat', 'teamHiddenOf', [[]]),
    E('team level, one seat without a skill = null', 'teamHiddenOf', [[null]]),
    E('team level, nobody with a skill (three seats) = null', 'teamHiddenOf', [[null, null, null]]),
    E('team level, one seat = its own skill', 'teamHiddenOf', [[1200]]),
    E('team level, two seats 1200 / 800 = 1000', 'teamHiddenOf', [[1200, 800]]),
    E('team level, a seat without a skill leaves (1200 / null / 801 = 1001, rounded)', 'teamHiddenOf', [[1200, null, 801]]),
    E('team level, two seats at 0 = 0', 'teamHiddenOf', [[0, 0]]),
    E('team level, four seats, order free (950 / 1200 / 400 / 1050 = 900)', 'teamHiddenOf', [[950, 1200, 400, 1050]]),
    E('team level, a half rounds up (300 / 301 = 301)', 'teamHiddenOf', [[300, 301]]),
    // the tier of a hidden skill (nearest line, the lower tier on a tie)
    E('skill tier, 950 = gold (line 10 nearer than 6)', 'tierOfHidden', [950, SOLO]),
    E('skill tier, 400 = bronze (a tie between 2 and 6)', 'tierOfHidden', [400, SOLO]),
    E('skill tier, 0 = bronze', 'tierOfHidden', [0, SOLO]),
    E('skill tier, 9000 = grandmaster', 'tierOfHidden', [9000, SOLO]),
    E('skill tier, duo lines, 2000 = platinum', 'tierOfHidden', [2000, DUO]),
    E('skill tier, no skill = null', 'tierOfHidden', [null, SOLO]),
    // the gate's tier reading: master and grandmaster only on reaching their own line
    E('gate tier, 3400 = diamond (nearer the master line, not on it)', 'skillTierOf', [3400, SOLO]),
    E('gate tier, 3800 = master', 'skillTierOf', [3800, SOLO]),
    E('gate tier, 5000 = master (nearer the grandmaster line, not on it)', 'skillTierOf', [5000, SOLO]),
    E('gate tier, 5500 = grandmaster', 'skillTierOf', [5500, SOLO]),
    E('gate tier, 1200 = gold (below master: the nearest line)', 'skillTierOf', [1200, SOLO]),
    E('gate tier, no skill = null', 'skillTierOf', [null, DUO]),
  ];
  // the target offset of a run seed (signed and unsigned of the same bits read the same)
  for (const s of [0, 1, 2, 3, 4, 5, 6, 7, 123456789, -1, 4294967295, -2147483648]) out.push(E('offset of seed ' + s, 'targetOffset', [s]));
  out.push(
    E('target, skill 1000, seed 7 (the points do not move it)', 'targetOf', [300, SOLO, 7, 1000, false]),
    E('target, skill 1000, seed 7, grandmaster points', 'targetOf', [9000, SOLO, 7, 1000, false]),
    E('target, skill 150, seed 1 (offset -2: the floor 1)', 'targetOf', [300, SOLO, 1, 150, false]),
    E('target, skill 1849, seed 123456789 (rounding)', 'targetOf', [1000, SOLO, 123456789, 1849, false]),
    E('target, skill 2400, seed -1', 'targetOf', [2500, SOLO, -1, 2400, false]),
    E('target, skill 6000, seed 2', 'targetOf', [9000, SOLO, 2, 6000, false]),
    E('target, duo skill 4000, seed 5', 'targetOf', [4500, DUO, 5, 4000, false]),
    E('target, placement first run (no skill: the silver line)', 'targetOf', [0, SOLO, 7, null, true]),
    E('target, placement with a skill of 2400 so far', 'targetOf', [0, SOLO, 7, 2400, true]),
    E('target, placement with a skill of 50 so far', 'targetOf', [0, SOLO, 4, 50, true]),
    E('target line, skill 1849 (the dial middle)', 'targetLineOf', [1000, SOLO, 1849, false]),
    E('target line, skill 150 (the line under the floor of 1)', 'targetLineOf', [300, SOLO, 150, false]),
    E('target line, no skill yet (the silver line)', 'targetLineOf', [0, DUO, null, true]),
  );
  // the points before the clamp: every tier, pass / miss, skill one tier below / the same / one tier above, offsets -2 / 0 / +2
  const LPS = [300, 1000, 2500, 3500, 5000, 7000, 9000];
  for (let t = 0; t < 7; t++) {
    for (const isPass of [true, false]) for (const sk of ['below', 'same', 'above']) for (const o of [-2, 0, 2]) {
      const k = sk === 'below' ? t - 1 : sk === 'above' ? t + 1 : t;
      if (k < 0 || k > 6) continue;
      out.push(E('delta, lp ' + LPS[t] + ' ' + (isPass ? 'pass' : 'miss') + ', skill ' + sk + ', offset ' + o, 'endlessDelta', [LPS[t], isPass, SOLO[k] * 100, SOLO, o]));
    }
  }
  out.push(
    E('delta, the largest swing (bronze pass, skill above, offset +2)', 'endlessDelta', [0, true, 5500, SOLO, 2]),
    E('delta, a miss floored at -1 (bronze, skill grandmaster, offset +2)', 'endlessDelta', [0, false, 5500, SOLO, 2]),
    E('delta, an offset out of range reads as +2', 'endlessDelta', [1000, true, 600, SOLO, 9]),
    E('delta, no skill (fewer than 5 runs in the window): neutral', 'endlessDelta', [4500, false, null, SOLO, 0]),
    // the points line (series clamp, demotion protection, the board bounds)
    E('settle, gold 2500 pass', 'endlessSettle', [2500, true, 1000, SOLO, 0]),
    E('settle, gold 2500 miss, skill gold (protection holds but moves nothing)', 'endlessSettle', [2500, false, 1000, SOLO, 0]),
    E('settle, promotion band silver 1950 pass (forced up to 2150)', 'endlessSettle', [1950, true, 600, SOLO, 0]),
    E('settle, promotion band silver 1950 miss', 'endlessSettle', [1950, false, 600, SOLO, 0]),
    E('settle, relegation band gold 2050 miss, skill silver (rated above his skill: forced down to 1850, O785)', 'endlessSettle', [2050, false, 600, SOLO, 0]),
    E('settle, relegation band gold 2050 miss, skill gold (protected: no forced drop)', 'endlessSettle', [2050, false, 1000, SOLO, 0]),
    E('settle, relegation band gold 2010 miss, skill silver, offset -2 (forced down to 1850; held at the floor before O785)', 'endlessSettle', [2010, false, 600, SOLO, -2]),
    E('settle, gold floor 2000 miss, skill gold (protected: d 0)', 'endlessSettle', [2000, false, 1000, SOLO, -2]),
    E('settle, relegation band gold 2050 pass', 'endlessSettle', [2050, true, 600, SOLO, 0]),
    E('settle, diamond 5850 pass, skill 3700 (the master gate: held at 5879)', 'endlessSettle', [5850, true, 3700, SOLO, 2]),
    E('settle, diamond 5850 pass, skill 3800 (the master gate open)', 'endlessSettle', [5850, true, 3800, SOLO, 2]),
    E('settle, diamond 5950 pass, skill 3800 (forced up into master)', 'endlessSettle', [5950, true, 3800, SOLO, 0]),
    E('settle, master 6050 miss, skill 3000 (master: the strict factor, forced down)', 'endlessSettle', [6050, false, 3000, SOLO, 0]),
    E('settle, master 6100 miss, skill 3000, offset +2 (forced down to 5850)', 'endlessSettle', [6100, false, 3000, SOLO, 2]),
    E('settle, master 6500 pass, skill 3000 (master: a pass still gains, smaller)', 'endlessSettle', [6500, true, 3000, SOLO, 0]),
    E('settle, master 7850 pass, skill 5000 (the grandmaster gate: held at 7879)', 'endlessSettle', [7850, true, 5000, SOLO, 2]),
    E('settle, master 7950 pass, skill 5500 (forced up into grandmaster)', 'endlessSettle', [7950, true, 5500, SOLO, -2]),
    E('settle, grandmaster line 8050 miss, skill grandmaster (protected)', 'endlessSettle', [8050, false, 5500, SOLO, 0]),
    E('settle, grandmaster line 8050 miss, skill master (dropped to master)', 'endlessSettle', [8050, false, 3800, SOLO, 0]),
    E('settle, grandmaster 9000 pass and miss are equal and opposite (zero-sum)', 'endlessDelta', [9000, true, 5500, SOLO, 0]),
    E('settle, the top 9990 pass (9999)', 'endlessSettle', [9990, true, 5500, SOLO, 2]),
    E('settle, the floor 5 miss (0)', 'endlessSettle', [5, false, 0, SOLO, -2]),
    E('settle, bronze 590 pass, skill gold (a crossing in the promotion band)', 'endlessSettle', [590, true, 1000, SOLO, 2]),
    E('settle, platinum 3500 pass, skill diamond, offset +2 (the swing cap)', 'endlessSettle', [3500, true, 2400, SOLO, 2]),
    E('settle, duo lines, platinum 3100 miss, skill diamond (protected)', 'endlessSettle', [3100, false, 3800, DUO, 0]),
    // the placement seed
    E('seed, no skill', 'endlessSeedLp', [null, SOLO]),
    E('seed, below the bronze line', 'endlessSeedLp', [100, SOLO]),
    E('seed, bronze between 2 and 6', 'endlessSeedLp', [400, SOLO]),
    E('seed, near the silver line (bronze promotion band avoided)', 'endlessSeedLp', [590, SOLO]),
    E('seed, silver 950 (near the gold line: kept below the band)', 'endlessSeedLp', [950, SOLO]),
    E('seed, exactly the gold line (kept above the relegation band)', 'endlessSeedLp', [1000, SOLO]),
    E('seed, gold 1250', 'endlessSeedLp', [1250, SOLO]),
    E('seed, 13.9 levels (gold, just under the cap)', 'endlessSeedLp', [1390, SOLO]),
    E('seed, 14.0 levels = the cap (version 6: 2800, the top of gold under the promotion band)', 'endlessSeedLp', [1400, SOLO]),
    E('seed, platinum 1600 (the cap: a placement never hands out platinum)', 'endlessSeedLp', [1600, SOLO]),
    E('seed, platinum 2000 (the cap)', 'endlessSeedLp', [2000, SOLO]),
    E('seed, above the grandmaster line (the cap)', 'endlessSeedLp', [9000, SOLO]),
    E('seed, duo silver 1400', 'endlessSeedLp', [1400, DUO]),
    // the family row and the published table
    E('row details, placed silver with two receipts (solo and duo skills, no trio / quad run)', 'elpRowDetails', [{ n: 7, tier: 1, placed: 1, h: { solo: 950, duo: 1480, trio: null, quad: null } }, [{ mh: -5, delta: 40, flags: 264 }, { mh: 77, delta: -13, flags: 258 }]]),
    E('row details, no skill in any family yet (four times -1)', 'elpRowDetails', [{ n: 9, tier: 3, placed: 1 }, []]),
    E('row details, a skill of 0 is a skill (0, not -1)', 'elpRowDetails', [{ n: 5, tier: 0, placed: 1, h: { solo: 0, duo: 0, trio: 0, quad: 0 } }, []]),
    E('row read', 'elpRowOf', [[0xEE | 512, 7, 1, 1, 950, 1480, -1, -1, 198, 2, -5, 40, 264, 77, -13, 258]]),
    E('row read, no skill = null four times, a short ring', 'elpRowOf', [[0xEE | 512, 9, 3, 1, -1, -1, -1, -1, 198, 2, 1, 2, 3]]),
    E('row read, another magic = null', 'elpRowOf', [[0xEF | 512, 7, 1, 1, 950, 1480, -1, -1, 198, 0]]),
    E('row read, the version 1 per-family row = null', 'elpRowOf', [[0xEE | 256, 7, 950, 1, 1, 198, 2, -5, 40, 264, 77, -13, 258]]),
    E('row read, a version 3 row cut short before its levels = null', 'elpRowOf', [[0xEE | 768, 7, 1, 1, 950, 1480, -1, -1, 198, 0]]),
    E('row read, short of the header = null', 'elpRowOf', [[0xEE | 512, 7, 1, 1, 950, 1480, -1, -1, 198]]),
    E('row read, the O103 rating row = null', 'elpRowOf', [[12, 850, 6, 0]]),
    E('table details, solo live, the rest prior', 'elpTableDetails', [1, { solo: { N: 30, pass: SOLO }, duo: { N: 4, pass: DUO } }]),
    E('table read', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 100, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
    E('table read, another constant (rulesSame false)', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 120, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
    E('table read, a v1 cut table = null', 'elpTableOf', [20261108, [0xEC | 256, 0, 0, 6000, 4000, 2800, 2000, 1400, 800].concat(new Array(21).fill(0))]),
    E('table read, a v3 table = null', 'elpTableOf', [20261201, [0xEC | 768, 1, 1, 1500, 500, 100, 2].concat(new Array(32).fill(0))]),
    E('table read, short = null', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 100, 2]]),
  );
  out.push(...onePointsCases(E, SOLO, DUO, TRIO, QUAD, LINES));
  out.push(...levelCases(E, SOLO, DUO));
  return out;
}

// O942 (ELP v7): the level -- a run ends at its target, the target follows a per-family level (a staircase), the tiers read the
//   smoothed level, the placement walks PLACE steps with a miss floored at its depth, R1 / R2, the team line (the highest), lambda
//   (points grow with the line), the v3 row with the four level states, the table version passed in
function levelCases(E, SOLO, DUO) {
  const S = (L, Lm, s, last, run) => ({ L, Lm, s, last, run });
  return [
    E('level state, a valid one', 'elpLevelOf', [S(950, 900, 3, 1, 2)]),
    E('level state, L under L_MIN = null', 'elpLevelOf', [S(99, 900, 3, 1, 2)]),
    E('level state, s past S_MAX = null', 'elpLevelOf', [S(950, 900, 7, 1, 2)]),
    E('level state, last 2 = null', 'elpLevelOf', [S(950, 900, 3, 2, 2)]),
    E('level state, run past RUN_CAP = null', 'elpLevelOf', [S(950, 900, 3, 1, 16)]),
    E('level state, a fraction = null', 'elpLevelOf', [S(950.5, 900, 3, 1, 2)]),
    E('level start, no skill = the silver line', 'elpLevelInit', [null, SOLO]),
    E('level start, skill 10.00 levels = 9.90 (TARGET_Q)', 'elpLevelInit', [1000, SOLO]),
    E('level start, skill 0.50 = L_MIN', 'elpLevelInit', [50, SOLO]),
    E('level start, no skill and no lines = L_MIN', 'elpLevelInit', [null, null]),
    E('line of a level, 6.50 rounds to 7', 'elpLineOfL', [650]),
    E('line of a level, 1.49 = 1', 'elpLineOfL', [149]),
    E('target of a level, run seed 7 (offset from the seed)', 'elpTargetOfL', [1250, 7]),
    E('target of a level, low level and a negative offset stays >= 1', 'elpTargetOfL', [100, 3]),
    E('team line, the highest of the roster', 'elpTeamLine', [[600, null, 1200, 950]]),
    E('team line, nobody with a level = null', 'elpTeamLine', [[null, null]]),
    E('team line, no roster = null', 'elpTeamLine', [[]]),
    E('step, the first pass (s 2: x1.25)', 'elpLevelStep', [S(600, 600, 2, -1, 0), { pass: true, depth: 6, T: 6 }]),
    E('step, the second pass in a row (bigger steps: s 2 -> 1)', 'elpLevelStep', [S(750, 645, 2, 1, 1), { pass: true, depth: 8, T: 8 }]),
    E('step, a reversal (a miss after a pass: smaller steps, s + 1)', 'elpLevelStep', [S(938, 733, 1, 1, 2), { pass: false, depth: 7, T: 9 }]),
    E('step, a long streak keeps s at S_MIN and run at RUN_CAP', 'elpLevelStep', [S(5000, 4000, 1, 1, 15), { pass: true, depth: 50, T: 50 }]),
    E('step, a miss at L_MIN stays at L_MIN', 'elpLevelStep', [S(100, 120, 4, 0, 3), { pass: false, depth: 0, T: 1 }]),
    E('step, R1: a quit miss leaves the level', 'elpLevelStep', [S(1200, 1100, 3, 1, 1), { pass: false, depth: 4, T: 12, quit: true }]),
    E('step, R1 does not hold for a pass (a quit after the target is a pass)', 'elpLevelStep', [S(1200, 1100, 3, 1, 1), { pass: true, depth: 12, T: 12, quit: true }]),
    E('step, R2: no level passed, target 12, Lm 11 (leaves the level)', 'elpLevelStep', [S(1200, 1100, 3, 1, 1), { pass: false, depth: 0, T: 12 }]),
    E('step, R2 not for a target of 2 (moves)', 'elpLevelStep', [S(250, 600, 3, 1, 1), { pass: false, depth: 0, T: 2 }]),
    E('step, R2 not under Lm 5 (a new player moves)', 'elpLevelStep', [S(450, 450, 3, 1, 1), { pass: false, depth: 0, T: 4 }]),
    E('step, R2 not once a level was passed (moves)', 'elpLevelStep', [S(1200, 1100, 3, 1, 1), { pass: false, depth: 1, T: 12 }]),
    E('step, placement 0 pass (x1.8)', 'elpLevelStep', [S(600, 600, 2, -1, 0), { pass: true, depth: 6, T: 6, placing: 0 }]),
    E('step, placement 0 miss far under (/1.8)', 'elpLevelStep', [S(600, 600, 2, -1, 0), { pass: false, depth: 1, T: 6, placing: 0 }]),
    E('step, placement 1 miss near the target (floored at depth x1.15)', 'elpLevelStep', [S(1080, 1080, 2, -1, 0), { pass: false, depth: 9, T: 11, placing: 1 }]),
    E('step, placement 2 (the last) pass starts the staircase', 'elpLevelStep', [S(720, 720, 2, -1, 0), { pass: true, depth: 7, T: 7, placing: 2 }]),
    E('step, placement quit still moves (R1 is for points runs)', 'elpLevelStep', [S(600, 600, 2, -1, 0), { pass: false, depth: 0, T: 6, quit: true, placing: 0 }]),
    E('step, an invalid state = null', 'elpLevelStep', [S(50, 600, 2, -1, 0), { pass: true, depth: 6, T: 6 }]),
    E('seed of a level, solo 12.90', 'elpLevelSeed', [1290, SOLO, SOLO]),
    E('seed of a level, duo 20.00 read on the solo scale', 'elpLevelSeed', [2000, DUO, SOLO]),
    E('seed of a level, past the cap', 'elpLevelSeed', [3000, SOLO, SOLO]),
    E('lambda, line 0 = LO', 'elpPropK', [0]),
    E('lambda, line 2 = LO 250', 'elpPropK', [2]),
    E('lambda, line 5 = 500', 'elpPropK', [5]),
    E('lambda, line 10 = 1000', 'elpPropK', [10]),
    E('lambda, line 17 = 1700', 'elpPropK', [17]),
    E('lambda, line 25 = HI 2000', 'elpPropK', [25]),
    E('delta v7, gold 2500 pass, Lm 10, line 10', 'endlessDeltaLv', [2500, true, 1000, SOLO, 0, 'solo', 10]),
    E('delta v7, gold 2500 miss, Lm 10, line 10', 'endlessDeltaLv', [2500, false, 1000, SOLO, 0, 'solo', 10]),
    E('delta v7, gold 2500 pass, Lm 10, line 5 (half)', 'endlessDeltaLv', [2500, true, 1000, SOLO, 0, 'solo', 5]),
    E('delta v7, platinum 3500 pass, Lm 24, line 25 (lambda 2: the swing cap)', 'endlessDeltaLv', [3500, true, 2400, SOLO, 2, 'solo', 25]),
    E('delta v7, gold 2500 duo pass, Lm 16, line 16 (team length factor)', 'endlessDeltaLv', [2500, true, 1600, DUO, 0, 'duo', 16]),
    E('settle v7, gold 2500 pass, Lm 10, line 10', 'endlessSettleLv', [2500, true, 1000, SOLO, 0, 'solo', 10]),
    E('settle v7, relegation band gold 2050 miss, Lm silver (forced down)', 'endlessSettleLv', [2050, false, 600, SOLO, 0, 'solo', 6]),
    E('settle v7, diamond 5850 pass, Lm 37 (the master gate held)', 'endlessSettleLv', [5850, true, 3700, SOLO, 2, 'solo', 37]),
    E('settle v7, diamond 5850 pass, Lm 38 (the master gate open)', 'endlessSettleLv', [5850, true, 3800, SOLO, 2, 'solo', 38]),
    E('row details v3, a solo level and a duo level', 'elpRowDetails', [{ n: 7, tier: 2, placed: 1, h: { solo: 950, duo: 1480, trio: null, quad: null }, lv: { solo: S(940, 905, 3, 1, 2), duo: S(1500, 1420, 6, 0, 1) } }, [{ mh: -5, delta: 40, flags: 264 }]]),
    E('row details, levels all invalid = a v2 row', 'elpRowDetails', [{ n: 7, tier: 2, placed: 1, h: { solo: 950 }, lv: { solo: S(50, 905, 3, 1, 2) } }, []]),
    E('row read v3', 'elpRowOf', [[0xEE | 768, 7, 2, 1, 950, 1480, -1, -1, 940, 905, 3 | (2 << 4) | (2 << 6), 1500, 1420, 6 | (1 << 4) | (1 << 6), -1, -1, -1, -1, -1, -1, 198, 1, -5, 40, 264]]),
    E('row read v3, a level that is not a state reads as none', 'elpRowOf', [[0xEE | 768, 7, 2, 1, 950, -1, -1, -1, 50, 905, 3, -1, -1, -1, -1, -1, -1, -1, -1, -1, 198, 0]]),
    E('table details, version 6 passed (version 6 priors for the missing families)', 'elpTableDetails', [1, { solo: { N: 30, pass: SOLO } }, 6]),
    E('table details, version 7 (version 7 priors for the missing families)', 'elpTableDetails', [1, { solo: { N: 30, pass: SOLO } }, 7]),
    E('table read, version 6 (rulesSame for a version 7 copy; a version 8 copy reads version 8 tables only)', 'elpTableOf', [20261201, [0xEC | 512, 1, 6, 1500, 500, 100, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
    E('table read, version 5 (rulesSame false)', 'elpTableOf', [20261201, [0xEC | 512, 1, 5, 1500, 500, 100, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
  ];
}

// O991 (ELP v8, kind elpLevel8): the grow phase -- the version 8 level state, the target floor T_MIN, the steps on the part past
//   GROW_END (Lm, reversals, the floor), R1 / R2 (a death in the grow phase leaves the level), the placement steps + the miss floor,
//   the first level from a version 7 one (the conversion + the cap of the newest runs), the team line, lambda on REF 2000, the gates
//   (103 % solo, 104 % team), the delta / the points line, the v4 row with the version 8 states, the version 8 table, the milestones. Fixed lines
//   (written out, not ELP8.PRIOR: retuning the prior moves no case). The run seeds: 2 -> offset 0, 4 -> +1, 19 -> +2, 6 -> -1, 1 -> -2.
//   in = { fn, args } -> PP[fn](...args), exactly as the endless kind.
function level8Cases() {
  const E = (name, fn, args) => ({ name: 'elp8: ' + name, kind: 'elpLevel8', fn, args });
  const S = (L, Lm, s, last, run) => ({ L, Lm, s, last, run });
  const SOLO8 = [22, 24, 26, 28, 31, 34, 40], DUO8 = [25, 29, 32, 35, 38, 43, 48], QUAD8 = [27, 31, 35, 38, 42, 47, 51];
  const SOLO7 = [2, 6, 10, 16, 25, 35, 45];
  const st = (L, Lm, s, last, run) => (s | ((last + 1) << 4) | (run << 6));
  return [
    // the state
    E('state, a valid one', 'elpLevelOf8', [S(2400, 2350, 3, 1, 2)]),
    E('state, L under T_MIN x 100 = null', 'elpLevelOf8', [S(1999, 2350, 3, 1, 2)]),
    E('state, Lm under T_MIN x 100 = null', 'elpLevelOf8', [S(2400, 1999, 3, 1, 2)]),
    E('state, s past S_MAX = null', 'elpLevelOf8', [S(2400, 2350, 7, 1, 2)]),
    E('state, run past RUN_CAP = null', 'elpLevelOf8', [S(2400, 2350, 3, 1, 16)]),
    E('state, a version 7 level (1000) is not a version 8 one', 'elpLevelOf8', [S(1000, 950, 3, 1, 2)]),
    // the line and the target
    E('line, 24.50 rounds to 25', 'elpLineOfL8', [2450]),
    E('line, never under T_MIN (1500 -> 20)', 'elpLineOfL8', [1500]),
    E('target, level 24, offset 0', 'elpTargetOfL8', [2400, 2]),
    E('target, level 31, offset +2', 'elpTargetOfL8', [3100, 19]),
    E('target, level 20, offset -2 stays at T_MIN', 'elpTargetOfL8', [2000, 1]),
    E('target, level 21, offset -1 = T_MIN', 'elpTargetOfL8', [2100, 6]),
    E('target of a state, level 26, offset +1', 'elpLevelTarget8', [S(2600, 2500, 2, -1, 0), 4]),
    E('target of a state that is not one = null', 'elpLevelTarget8', [S(900, 900, 2, -1, 0), 4]),
    E('team line, the highest of the roster (version 8 levels)', 'elpTeamLine', [[2400, null, 3100, 2650]]),
    // the steps (on the part past GROW_END)
    E('step, the first pass (s 2: the part past 15 x1.25)', 'elpLevelStep8', [S(2400, 2400, 2, -1, 0), { pass: true, depth: 24, T: 24 }]),
    E('step, the second pass in a row (bigger steps: s 2 -> 1)', 'elpLevelStep8', [S(2625, 2468, 2, 1, 1), { pass: true, depth: 26, T: 26 }]),
    E('step, a reversal (a miss after a pass: smaller steps, s + 1)', 'elpLevelStep8', [S(2900, 2600, 1, 1, 2), { pass: false, depth: 22, T: 29 }]),
    E('step, a long streak keeps s at S_MIN and run at RUN_CAP', 'elpLevelStep8', [S(5000, 4500, 1, 1, 15), { pass: true, depth: 50, T: 50 }]),
    E('step, a miss at the floor stays at T_MIN x 100 (Lm follows the floored level)', 'elpLevelStep8', [S(2000, 2600, 1, 0, 3), { pass: false, depth: 17, T: 20 }]),
    E('step, R1: a quit miss leaves the level', 'elpLevelStep8', [S(2800, 2700, 3, 1, 1), { pass: false, depth: 18, T: 28, quit: true }]),
    E('step, R1 does not hold for a pass', 'elpLevelStep8', [S(2800, 2700, 3, 1, 1), { pass: true, depth: 28, T: 28, quit: true }]),
    E('step, R2: a death in the grow phase (15 levels passed) leaves the level', 'elpLevelStep8', [S(2800, 2700, 3, 1, 1), { pass: false, depth: 15, T: 28 }]),
    E('step, R2: no level passed leaves the level', 'elpLevelStep8', [S(2800, 2700, 3, 1, 1), { pass: false, depth: 0, T: 28 }]),
    E('step, R2 not once level 16 was passed (moves)', 'elpLevelStep8', [S(2800, 2700, 3, 1, 1), { pass: false, depth: 16, T: 28 }]),
    E('step, R2 for a deep target too (T 40, 15 passed)', 'elpLevelStep8', [S(4000, 3900, 4, 1, 1), { pass: false, depth: 15, T: 40 }]),
    E('step, placement 0 pass (the part past 15 x1.8)', 'elpLevelStep8', [S(2400, 2400, 2, -1, 0), { pass: true, depth: 24, T: 24, placing: 0 }]),
    E('step, placement 0 miss far under (/1.8, floored at T_MIN)', 'elpLevelStep8', [S(2400, 2400, 2, -1, 0), { pass: false, depth: 10, T: 24, placing: 0 }]),
    E('step, placement 1 miss near the target (floored at 15 + its depth past 15 x1.15)', 'elpLevelStep8', [S(3120, 3120, 2, -1, 0), { pass: false, depth: 28, T: 31, placing: 1 }]),
    E('step, placement 2 (the last) pass starts the staircase', 'elpLevelStep8', [S(2580, 2580, 4, 0, 1), { pass: true, depth: 26, T: 26, placing: 2 }]),
    E('step, a placement quit in the grow phase still moves (R1 / R2 are for points runs)', 'elpLevelStep8', [S(2400, 2400, 2, -1, 0), { pass: false, depth: 3, T: 24, quit: true, placing: 0 }]),
    E('step, an invalid state = null', 'elpLevelStep8', [S(1000, 1000, 2, -1, 0), { pass: true, depth: 24, T: 24 }]),
    // the first version 8 level (plan section 3.2)
    E('init, no version 7 level = the silver line (solo 24)', 'elpLevelInit8', [null, [], SOLO7, SOLO8]),
    E('init, no version 7 level = the silver line (duo 29)', 'elpLevelInit8', [null, [9, 12], SOLO7, DUO8]),
    E('init, no lines = T_MIN', 'elpLevelInit8', [null, [], null, null]),
    E('init, a version 7 level on the gold line reads the version 8 gold line (L), Lm between silver and gold', 'elpLevelInit8', [S(1000, 950, 3, 1, 2), [10, 9, 12], SOLO7, SOLO8]),
    E('init, the cap: the deepest of the newest runs x1.15 read on the version 8 scale', 'elpLevelInit8', [S(2500, 2400, 3, 1, 2), [10, 9, 12], SOLO7, DUO8]),
    E('init, only the newest CONV_RUNS runs count for the cap', 'elpLevelInit8', [S(2500, 2400, 3, 1, 2), [5, 6, 4, 40], SOLO7, SOLO8]),
    E('init, no run for the cap: the converted level', 'elpLevelInit8', [S(2500, 2400, 3, 1, 2), [], SOLO7, SOLO8]),
    E('init, a version 7 level under the bronze line keeps its ratio, floored at T_MIN', 'elpLevelInit8', [S(100, 100, 1, 0, 2), [1], SOLO7, SOLO8]),
    E('init, a level past the grandmaster line keeps its ratio', 'elpLevelInit8', [S(5000, 4800, 1, 1, 5), [52, 50, 55], SOLO7, SOLO8]),
    E('init, no lines: the version 7 values as they are, floored', 'elpLevelInit8', [S(2500, 2400, 3, 1, 2), [30], null, null]),
    E('init, a version 7 state that is not one = the silver line', 'elpLevelInit8', [S(99, 900, 3, 1, 2), [10], SOLO7, SOLO8]),
    // the placement seed
    E('seed, solo 26.00 (the gold line)', 'elpLevelSeed8', [2600, SOLO8, SOLO8]),
    E('seed, duo 29.00 read on the solo scale (silver)', 'elpLevelSeed8', [2900, DUO8, SOLO8]),
    E('seed, past the cap', 'elpLevelSeed8', [4500, SOLO8, SOLO8]),
    // lambda
    E('lambda, line 0 = LO 500', 'elpPropK8', [0]),
    E('lambda, line 10 = LO 500', 'elpPropK8', [10]),
    E('lambda, line 20 = 1000', 'elpPropK8', [20]),
    E('lambda, line 26 = 1300', 'elpPropK8', [26]),
    E('lambda, line 40 = HI 2000', 'elpPropK8', [40]),
    E('lambda, line 55 = HI 2000', 'elpPropK8', [55]),
    // the gates (103 % solo, 104 % team)
    E('gate, solo Lm 35.01 = diamond (the master line 34 x1.03 = 35.02)', 'skillTierOf8', [3501, SOLO8, 'solo']),
    E('gate, solo Lm 35.02 = master', 'skillTierOf8', [3502, SOLO8, 'solo']),
    E('gate, solo Lm 41.20 = grandmaster (40 x1.03)', 'skillTierOf8', [4120, SOLO8, 'solo']),
    E('gate, solo Lm 41.19 = master', 'skillTierOf8', [4119, SOLO8, 'solo']),
    E('gate, duo Lm 44.71 = diamond (43 x1.04 = 44.72)', 'skillTierOf8', [4471, DUO8, 'duo']),
    E('gate, duo Lm 44.72 = master', 'skillTierOf8', [4472, DUO8, 'duo']),
    E('gate, quad Lm 53.04 = grandmaster (51 x1.04)', 'skillTierOf8', [5304, QUAD8, 'quad']),
    E('gate, below master the nearest line (no gate)', 'skillTierOf8', [2900, SOLO8, 'solo']),
    E('gate, no level = null', 'skillTierOf8', [null, SOLO8, 'solo']),
    // the points of one run
    E('delta, gold 2500 pass, Lm 26, line 26 (lambda 1.3)', 'endlessDeltaLv8', [2500, true, 2600, SOLO8, 0, 'solo', 26]),
    E('delta, gold 2500 miss, Lm 26, line 26', 'endlessDeltaLv8', [2500, false, 2600, SOLO8, 0, 'solo', 26]),
    E('delta, gold 2500 pass, Lm 26, line 20 (lambda 1)', 'endlessDeltaLv8', [2500, true, 2600, SOLO8, 0, 'solo', 20]),
    E('delta, silver 1000 pass, Lm 31 (rated too low), offset +2', 'endlessDeltaLv8', [1000, true, 3100, SOLO8, 2, 'solo', 31]),
    E('delta, platinum 3500 pass at line 40 (lambda 2: the swing cap)', 'endlessDeltaLv8', [3500, true, 3400, SOLO8, 2, 'solo', 40]),
    E('delta, duo gold 2500 pass, Lm 32, line 32 (team length factor)', 'endlessDeltaLv8', [2500, true, 3200, DUO8, 0, 'duo', 32]),
    E('delta, duo gold 2500 miss, Lm 32, line 32 (team length factor)', 'endlessDeltaLv8', [2500, false, 3200, DUO8, 0, 'duo', 32]),
    E('settle, gold 2500 pass, Lm 26, line 26', 'endlessSettleLv8', [2500, true, 2600, SOLO8, 0, 'solo', 26]),
    E('settle, relegation band gold 2050 miss, Lm silver (forced down)', 'endlessSettleLv8', [2050, false, 2400, SOLO8, 0, 'solo', 24]),
    E('settle, diamond 5850 pass, Lm 35.01 (the master gate held)', 'endlessSettleLv8', [5850, true, 3501, SOLO8, 2, 'solo', 35]),
    E('settle, diamond 5850 pass, Lm 35.02 (the master gate open)', 'endlessSettleLv8', [5850, true, 3502, SOLO8, 2, 'solo', 35]),
    E('settle, duo diamond 5850 pass, Lm 44.71 (the team gate held)', 'endlessSettleLv8', [5850, true, 4471, DUO8, 2, 'duo', 45]),
    E('settle, duo diamond 5850 pass, Lm 44.72 (the team gate open)', 'endlessSettleLv8', [5850, true, 4472, DUO8, 2, 'duo', 45]),
    E('settle, master 6050 miss, Lm diamond (forced down)', 'endlessSettleLv8', [6050, false, 3100, SOLO8, 0, 'solo', 31]),
    // the v4 row
    E('row details v4, a solo version 7 level and a duo version 8 level', 'elpRowDetails', [{ n: 7, tier: 2, placed: 1, h: { solo: 950, duo: 1480, trio: null, quad: null }, lv: { solo: S(940, 905, 3, 1, 2) }, lv8: { duo: S(2600, 2550, 3, 0, 1) } }, [{ mh: -5, delta: 40, flags: 264 }]]),
    E('row details v4, version 8 levels only (the version 7 part -1)', 'elpRowDetails', [{ n: 4, tier: 1, placed: 1, h: { solo: 2100 }, lv8: { solo: S(2400, 2400, 2, -1, 0), quad: S(3000, 2950, 4, 1, 3) } }, []]),
    E('row details, version 8 levels all invalid and a version 7 one = v3', 'elpRowDetails', [{ n: 7, tier: 2, placed: 1, h: { solo: 950 }, lv: { solo: S(940, 905, 3, 1, 2) }, lv8: { solo: S(1000, 905, 3, 1, 2) } }, []]),
    E('row details, nothing valid = v2', 'elpRowDetails', [{ n: 7, tier: 2, placed: 1, h: { solo: 950 }, lv8: { solo: S(1999, 2000, 3, 1, 2) } }, []]),
    E('row read v4', 'elpRowOf', [[0xEE | 1024, 7, 2, 1, 950, 1480, -1, -1, 940, 905, st(940, 905, 3, 1, 2), -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 2600, 2550, st(2600, 2550, 3, 0, 1), -1, -1, -1, -1, -1, -1, 198, 1, -5, 40, 264]]),
    E('row read v4, a version 8 state under the floor reads as none', 'elpRowOf', [[0xEE | 1024, 4, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1500, 1500, st(1500, 1500, 2, -1, 0), -1, -1, -1, -1, -1, -1, -1, -1, -1, 198, 0]]),
    E('row read v4 cut short before its version 8 levels = null', 'elpRowOf', [[0xEE | 1024, 7, 2, 1, 950, -1, -1, -1, 940, 905, st(940, 905, 3, 1, 2), -1, -1, -1, -1, -1, -1, -1, -1, -1, 198, 0]]),
    E('row read v3 (a version 7 row: lv8 every family null)', 'elpRowOf', [[0xEE | 768, 7, 2, 1, 950, 1480, -1, -1, 940, 905, st(940, 905, 3, 1, 2), -1, -1, -1, -1, -1, -1, -1, -1, -1, 198, 0]]),
    E('row read v2 (lv and lv8 every family null)', 'elpRowOf', [[0xEE | 512, 7, 1, 1, 950, 1480, -1, -1, 198, 0]]),
    E('row read v5 = null (a layout this copy does not know)', 'elpRowOf', [[0xEE | 1280, 7, 2, 1, 950, 1480, -1, -1].concat(new Array(24).fill(-1), [198, 0])]),
    // the table and the milestones
    E('table details, version 8 (version 8 priors for the missing families)', 'elpTableDetails', [1, { solo: { N: 30, pass: SOLO8 } }, 8]),
    E('table read, version 8 (rulesSame)', 'elpTableOf', [20261201, [0xEC | 512, 1, 8, 1500, 500, 100, 2].concat([30], SOLO8, [4], DUO8, [0], DUO8, [0], QUAD8)]),
    E('table read, version 7 (rulesSame false: the version 7 scale)', 'elpTableOf', [20261201, [0xEC | 512, 1, 7, 1500, 500, 100, 2].concat([30], SOLO7, [4], SOLO7, [0], SOLO7, [0], SOLO7)]),
    E('milestones, solo', 'elpMilestones8', ['solo']),
    E('milestones, duo', 'elpMilestones8', ['duo']),
    E('milestones, trio', 'elpMilestones8', ['trio']),
    E('milestones, quad', 'elpMilestones8', ['quad']),
    E('milestones, a family without its own list (duoc) = solo', 'elpMilestones8', ['duoc']),
  ];
}

// O825 (ELP v4): one points value over the four families -- the family test, a depth read on another family's scale, the hidden
//   skill with the borrowed runs, the team gate, the team length factor, and the calls that name solo (= the calls that name none)
function onePointsCases(E, SOLO, DUO, TRIO, QUAD, LINES) {
  const out = [
    E('team family: solo is not', 'elpIsTeam', ['solo']),
    E('team family: duo', 'elpIsTeam', ['duo']),
    E('team family: trio', 'elpIsTeam', ['trio']),
    E('team family: quad', 'elpIsTeam', ['quad']),
    E('team family: the split couch family duoc is not', 'elpIsTeam', ['duoc']),
    E('team family: none given is not', 'elpIsTeam', []),
    // a depth x 100 on another family's scale
    E('convert, on the gold line (solo 10 -> duo 16)', 'elpConvert', [1000, SOLO, DUO]),
    E('convert, half way gold to platinum (solo 12.5 -> duo 20)', 'elpConvert', [1250, SOLO, DUO]),
    E('convert, back (duo 20 -> solo 12.5)', 'elpConvert', [2000, DUO, SOLO]),
    E('convert, under the bronze line keeps its ratio (solo 1 -> duo 1.5)', 'elpConvert', [100, SOLO, DUO]),
    E('convert, depth 0 stays 0', 'elpConvert', [0, SOLO, DUO]),
    E('convert, on the bronze line (solo 2 -> duo 3)', 'elpConvert', [200, SOLO, DUO]),
    E('convert, on the grandmaster line (solo 55 -> duo 88)', 'elpConvert', [5500, SOLO, DUO]),
    E('convert, over the grandmaster line keeps its ratio (solo 60 -> duo 96)', 'elpConvert', [6000, SOLO, DUO]),
    E('convert, a rounding step (solo 7.33 -> duo 12)', 'elpConvert', [733, SOLO, DUO]),
    E('convert, the same table = the depth itself', 'elpConvert', [1234, SOLO, SOLO]),
    E('convert, duo -> quad between diamond and master', 'elpConvert', [5000, DUO, QUAD]),
    E('convert, trio -> solo under silver', 'elpConvert', [700, TRIO, SOLO]),
    E('convert, a negative depth reads as 0', 'elpConvert', [-300, SOLO, DUO]),
    E('convert, no table to read from = unchanged', 'elpConvert', [500, null, DUO]),
    E('convert, a short table to read onto = unchanged', 'elpConvert', [500, SOLO, [3, 10]]),
    // the hidden skill of a family over the runs of every family (newest first)
    E('hidden for, no run', 'elpHiddenFor', ['solo', [], LINES]),
    E('hidden for, five solo runs = hiddenOf of them', 'elpHiddenFor', ['solo', [['solo', 30], ['solo', 9], ['solo', 8], ['solo', 7], ['solo', 0]], LINES]),
    E('hidden for, five solo runs among duo runs (the duo runs do not count)', 'elpHiddenFor', ['solo', [['duo', 40], ['solo', 30], ['solo', 9], ['duo', 40], ['solo', 8], ['solo', 7], ['solo', 0], ['duo', 40]], LINES]),
    E('hidden for, twelve solo runs (the newest 10 count)', 'elpHiddenFor', ['solo', [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 90, 90].map((d) => ['solo', d]), LINES]),
    E('hidden for, duo with two own runs: the newest solo run fills up to three, read on the duo scale', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15], ['solo', 24], ['duo', 14], ['solo', 2], ['solo', 2]], LINES]),
    E('hidden for, the same counted as version 5 did: the three newest solo runs fill up to five', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15], ['solo', 24], ['duo', 14], ['solo', 2], ['solo', 2]], LINES, null, 5]),
    E('hidden for, duo never played: the three newest solo runs read on the duo scale (the middle one)', 'elpHiddenFor', ['duo', [['solo', 10], ['solo', 15], ['solo', 24], ['solo', 6], ['solo', 12], ['solo', 55]], LINES]),
    E('hidden for, quad never played: the three newest runs of the other families fill', 'elpHiddenFor', ['quad', [['trio', 18], ['duo', 16], ['solo', 10], ['solo', 15], ['duo', 24]], LINES]),
    E('hidden for, three runs in all = the middle one on the duo scale', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15]], LINES]),
    E('hidden for, two runs in all = null', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20]], LINES]),
    E('hidden for, three runs in all counted as version 5 did = null', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15]], LINES, null, 5]),
    E('hidden for, three runs in all read for a placement target (version 6: the middle one)', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15]], LINES, 1]),
    E('hidden for, three runs in all read for a placement target as version 5 did (plain mean on the duo scale)', 'elpHiddenFor', ['duo', [['solo', 10], ['duo', 20], ['solo', 15]], LINES, 1, 5]),
    E('hidden for, four own runs = the two middle ones', 'elpHiddenFor', ['solo', [['solo', 10], ['solo', 9], ['solo', 8], ['solo', 7]], LINES]),
    E('hidden for, four own runs counted as version 5 did = null', 'elpHiddenFor', ['solo', [['solo', 10], ['solo', 9], ['solo', 8], ['solo', 7]], LINES, null, 5]),
    E('hidden for, four own runs read for a placement target = hiddenOf(.., 1)', 'elpHiddenFor', ['solo', [['solo', 10], ['solo', 9], ['solo', 8], ['solo', 7]], LINES, 1]),
    E('hidden for, one run of another family read for a placement target', 'elpHiddenFor', ['trio', [['solo', 10]], LINES, 1]),
    E('hidden for, a run of a family without lines (duoc) is left out', 'elpHiddenFor', ['duo', [['duoc', 50], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10]], LINES]),
    E('hidden for, no lines for the family itself: its own runs only', 'elpHiddenFor', ['duo', [['duo', 20], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10]], { solo: SOLO }, 1]),
    E('hidden for, a negative depth counts as 0', 'elpHiddenFor', ['solo', [['solo', -3], ['solo', 2], ['solo', 2], ['solo', 2], ['solo', 2]], LINES]),
    // version 6: the seed reading (the lowest run left out, the rest averaged; every run on the solo scale)
    E('seed skill, no run', 'elpSeedHidden', [[], LINES]),
    E('seed skill, one run = itself', 'elpSeedHidden', [[['solo', 7]], LINES]),
    E('seed skill, two runs = the better one', 'elpSeedHidden', [[['solo', 7], ['solo', 3]], LINES]),
    E('seed skill, three solo runs = the mean of the better two', 'elpSeedHidden', [[['solo', 10], ['solo', 4], ['solo', 8]], LINES]),
    E('seed skill, four runs = the mean of the best three', 'elpSeedHidden', [[['solo', 12], ['solo', 10], ['solo', 4], ['solo', 8]], LINES]),
    E('seed skill, a team run read on the solo scale', 'elpSeedHidden', [[['duo', 16], ['solo', 4], ['solo', 8]], LINES]),
    E('seed skill, three team runs of three families', 'elpSeedHidden', [[['quad', 24], ['trio', 10], ['duo', 3]], LINES]),
    E('seed skill, a zero run is the one left out', 'elpSeedHidden', [[['solo', 0], ['solo', 25], ['solo', 40]], LINES]),
    E('seed skill, twelve runs (the newest 10 count)', 'elpSeedHidden', [[5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 90, 90].map((d) => ['solo', d]), LINES]),
    E('seed skill, a run of a family without lines (duoc) is left out', 'elpSeedHidden', [[['duoc', 50], ['solo', 10], ['solo', 6]], LINES]),
    E('seed skill, a negative depth counts as 0', 'elpSeedHidden', [[['solo', -3], ['solo', 2], ['solo', 4]], LINES]),
    // the gate of a team family: the line x TEAM_GATE / 100
    E('team gate, duo 6100 = diamond (on the master line 61, short of 67.1)', 'skillTierOf', [6100, DUO, 'duo']),
    E('team gate, duo 6709 = diamond', 'skillTierOf', [6709, DUO, 'duo']),
    E('team gate, duo 6710 = master', 'skillTierOf', [6710, DUO, 'duo']),
    E('team gate, quad 9679 = master (nearest the grandmaster line, short of 96.8)', 'skillTierOf', [9679, DUO, 'quad']),
    E('team gate, trio 9680 = grandmaster', 'skillTierOf', [9680, DUO, 'trio']),
    E('team gate, duo 2400 = platinum (below master: the nearest line, no gate)', 'skillTierOf', [2400, DUO, 'duo']),
    E('team gate, the same skill named solo = master (the line itself)', 'skillTierOf', [6100, DUO, 'solo']),
    E('team gate, no skill = null', 'skillTierOf', [null, DUO, 'duo']),
  ];
  // the team length factor: every tier, pass / miss, the skill at the tier, offset 0 -- below master it moves, from master up it does not
  const LPS = [300, 1000, 2500, 3500, 5000, 7000, 9000];
  for (let t = 0; t < 7; t++) for (const isPass of [true, false]) out.push(E('team delta, duo, lp ' + LPS[t] + ' ' + (isPass ? 'pass' : 'miss'), 'endlessDelta', [LPS[t], isPass, DUO[t] * 100, DUO, 0, 'duo']));
  out.push(
    E('team delta, trio, gold 2500 pass, skill above, offset +2', 'endlessDelta', [2500, true, 2700, TRIO, 2, 'trio']),
    E('team delta, quad, gold 2500 miss, skill above, offset -2', 'endlessDelta', [2500, false, 3000, QUAD, -2, 'quad']),
    E('team delta, duo, platinum 3500 pass at the swing cap (the factor cannot pass it)', 'endlessDelta', [3500, true, 3800, DUO, 2, 'duo']),
    E('team delta, duo, bronze 0 miss, skill grandmaster, offset +2 (floored at -1)', 'endlessDelta', [0, false, 8800, DUO, 2, 'duo']),
    E('team delta, duo, no skill yet: neutral gap, the factor still applies', 'endlessDelta', [1000, true, null, DUO, 0, 'duo']),
    E('delta, the family named solo = none named (gold 2500 pass)', 'endlessDelta', [2500, true, 1000, SOLO, 0, 'solo']),
    E('delta, the split couch family duoc is not a team family', 'endlessDelta', [2500, true, 1600, DUO, 0, 'duoc']),
    // the points line of a team run
    E('team settle, duo, gold 2500 pass', 'endlessSettle', [2500, true, 1600, DUO, 0, 'duo']),
    E('team settle, duo, gold 2500 miss (the smaller loss)', 'endlessSettle', [2500, false, 1600, DUO, 0, 'duo']),
    E('team settle, duo, promotion band silver 1950 pass (forced up)', 'endlessSettle', [1950, true, 1000, DUO, 0, 'duo']),
    E('team settle, duo, relegation band gold 2010 miss, offset -2 (held at the floor)', 'endlessSettle', [2010, false, 1000, DUO, -2, 'duo']),
    E('team settle, duo, diamond 5850 pass, skill 6100 (on the master line: the team gate holds at 5879)', 'endlessSettle', [5850, true, 6100, DUO, 2, 'duo']),
    E('team settle, the same run named solo (the gate open)', 'endlessSettle', [5850, true, 6100, DUO, 2, 'solo']),
    E('team settle, duo, diamond 5850 pass, skill 6710 (the team gate open)', 'endlessSettle', [5850, true, 6710, DUO, 2, 'duo']),
    E('team settle, duo, diamond 5950 pass, skill 6710 (forced up into master)', 'endlessSettle', [5950, true, 6710, DUO, 0, 'duo']),
    E('team settle, quad, master 7850 pass, skill 9000 (the team grandmaster gate: held at 7879)', 'endlessSettle', [7850, true, 9000, DUO, 2, 'quad']),
    E('team settle, quad, master 7950 pass, skill 9680 (forced up into grandmaster)', 'endlessSettle', [7950, true, 9680, DUO, -2, 'quad']),
    E('team settle, duo, master 6500 pass (master and up: no length factor)', 'endlessSettle', [6500, true, 6710, DUO, 0, 'duo']),
    E('team settle, duo, master 6050 miss, skill 6100 (the team gate reads diamond; the nearest line still protects)', 'endlessSettle', [6050, false, 6100, DUO, 0, 'duo']),
    E('team settle, trio, the floor 5 miss (0)', 'endlessSettle', [5, false, 0, TRIO, -2, 'trio']),
    E('settle, the family named solo = none named (diamond 5850 pass, skill 3800)', 'endlessSettle', [5850, true, 3800, SOLO, 2, 'solo']),
  );
  return out;
}

// the out of one case, from a points-plan module (this repo's file, or the client's vendored copy)
function replay(PP, c) {
  if (c.kind === 'seed') return PP.seasonSeedLp(c.prev, c.display, c.hasPrev === true);
  if (c.kind === 'leave') return PP.leaverLpPenalty(c.cur, PP.LEAVER_LP_PENALTY);
  if (c.kind === 'boundary') return PP.boundaryOf(c.lp);
  if (c.kind === 'seat') return { mask: PP.rankedSeatMaskOf(c.mt), sans: PP.mtSansSeats(c.mt), base: PP.baseMt(c.mt), any: PP.anyAppliesLp(c.mt), seats: [0, 1, 2, 3, 4, 5].map((s) => PP.seatAppliesLp(c.mt, s)) };
  if (c.kind === 'endless') return PP[c.fn].apply(null, c.args);   // O728: one endless points function at fixed inputs
  if (c.kind === 'elpLevel8') return PP[c.fn].apply(null, c.args);   // O991: one version 8 level function at fixed inputs (in = { fn, args }, as endless)
  if (c.kind === 'placement') return PP.placementOf(c.det, c.target);   // O717: the settled matches of a season on a row's ring
  if (c.kind !== 'match') throw new Error('unknown case kind ' + c.kind);
  const parts = c.parts.map((p) => ({ steamID: p.id, seat: p.seat, mmr: p.mmr, rank: p.rank, lp: p.lp }));
  const plan = PP.matchPlan(parts, c.mt, c.team || null);
  const out = {};
  for (const p of c.parts) {
    if (!PP.seatAppliesLp(c.mt, p.seat)) { out[p.id] = null; continue; }   // O716: a quick seat of a mixed table settles no points
    const row = (plan && plan[p.id]) || null;
    // O717: a placing part passes the mode object (and its out names what the series clamp / the placement cap did); the other
    //   parts keep the boolean form of the calls written before O717 (both forms stay pinned)
    const line = PP.settleLine(p.lp, row, p.rank, parts.length, p.placing ? { seeded: !!p.seeded, placing: true } : !!p.seeded);
    out[p.id] = { plan: row, d0: line.d0, d: line.d, won: line.won, nv: line.nv };
    if (p.placing) { out[p.id].clamped = line.clamped; out[p.id].capped = line.capped; }
  }
  return out;
}
function build(PP) {
  return { about: 'golden cases of points-plan.js (O480); generated by tools/gen-points-fixtures.js -- do not edit by hand', rulesVer: PP.RULES_VER,
    cases: CASES.map((c) => { const { name, kind } = c, inp = Object.assign({}, c); delete inp.name; delete inp.kind; return { name, kind, in: inp, out: replay(PP, c) }; }) };
}
const canonHash = (text) => crypto.createHash('sha256').update(JSON.stringify(JSON.parse(text))).digest('hex').slice(0, 16);
// one case per line: readable diffs when a rules change regenerates the file
function render(doc) {
  return '{\n  "about": ' + JSON.stringify(doc.about) + ',\n  "rulesVer": ' + JSON.stringify(doc.rulesVer) + ',\n  "cases": [\n'
    + doc.cases.map((c) => '    ' + JSON.stringify(c)).join(',\n') + '\n  ]\n}\n';
}

function main() {
  const PP = require(path.join(__dirname, '..', 'points-plan.js'));
  const text = render(build(PP));
  const check = process.argv.indexOf('--check') >= 0;
  const cur = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null;
  if (check) {
    if (cur !== text) { console.log('[points-fixtures] DRIFT: ' + path.relative(process.cwd(), FILE) + ' is not what points-plan.js gives today'); process.exit(1); }
    console.log('[points-fixtures] up to date (' + CASES.length + ' cases, hash ' + canonHash(text) + ')');
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, text);
  console.log('[points-fixtures] wrote ' + CASES.length + ' cases -> FIXTURES_HASH \'' + canonHash(text) + '\'' + (PP.FIXTURES_HASH === canonHash(text) ? ' (matches points-plan.js)' : ' (set it in points-plan.js)'));
}

module.exports = { CASES, FILE, replay, build, render, canonHash };
if (require.main === module) main();
