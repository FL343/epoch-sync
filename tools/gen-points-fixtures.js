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
//   seed: { prev, display } -> seasonSeedLp (prev null = no row on the previous season's board).
//   leave: { cur } -> the points after the leaver fine (LEAVER_LP_PENALTY).
//   boundary: { lp } -> boundaryOf (the client's series banner reads the same).
//   seat: { mt } -> which seats of the code move points (O716 one queue: the ranked-seat mask in bits 11-16; no mask = the old
//     whole-table rule): { mask, sans: the code without the mask, base, any: anyAppliesLp, seats: seatAppliesLp of seats 0..5 }.
//     A case added here moves no settled delta (no RULES_VER bump): it pins the reading both sides share.
//   endless: { fn, args } -> PP[fn](...args), one O728 endless points function (hiddenOf / teamHiddenOf (O803) / tierOfHidden / skillTierOf / targetOffset /
//     targetLineOf / targetOf / endlessDelta / endlessSettle / endlessSeedLp / elpRowDetails / elpRowOf / elpTableDetails / elpTableOf) at fixed inputs. The
//     endless rules carry their own version (ELP.VER on the published table), not RULES_VER: an endless case that moves bumps ELP.VER.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'points-plan', 'cases.json');
const P = (id, seat, mmr, rank, lp, seeded) => Object.assign({ id, seat, mmr, rank, lp }, seeded ? { seeded: true } : {});
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
  { name: 'series: promotion zone, top half (forced up to min + 10)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 1960), P('b', 1, 1300, 2, 1500), P('c', 2, 1300, 3, 1500), P('d', 3, 1300, 4, 1500)] },
  { name: 'series: relegation zone, bottom half (forced down to min - 15)', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 2600), P('b', 1, 1300, 2, 2600), P('c', 2, 1300, 3, 2600), P('d', 3, 1300, 4, 2050)] },
  { name: 'series: relegation zone, PROTECTED loss keeps its compressed delta', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 1, 2600), P('w', 1, 1300, 2, 2050)] },
  { name: 'series: promotion zone, natural delta already past the line is kept', kind: 'match', mt: 2, parts: [P('a', 0, 1300, 1, 595), P('b', 1, 1300, 2, 400)] },
  { name: 'series: relegation zone, the strong side upset is still forced down (PROTECTED is the weak side only)', kind: 'match', mt: 2, parts: [P('s', 0, 1900, 3, 4100), P('w1', 1, 1300, 1, 1500), P('w2', 2, 1350, 2, 1600)] },
  { name: 'series: a player seeded by this settle skips the clamp', kind: 'match', mt: 2, parts: [P('n', 0, 1720, 1, 2880, true), P('b', 1, 1700, 2, 2500)] },
  { name: 'series: grandmaster line, relegation loss', kind: 'match', mt: 2, parts: [P('a', 0, 2400, 1, 8600), P('b', 1, 2400, 2, 8050)] },
  // ---- the board bounds ----
  { name: 'clamp: the top of the board (9999)', kind: 'match', mt: 2, parts: [P('a', 0, 2600, 1, 9990), P('b', 1, 2600, 2, 9500)] },
  { name: 'clamp: the floor (0)', kind: 'match', mt: 2, parts: [P('a', 0, 1000, 1, 100), P('b', 1, 1000, 2, 3)] },
  // ---- first settle of a season (placement) ----
  { name: 'seed: no previous season, display 900', kind: 'seed', prev: null, display: 900 },
  { name: 'seed: no previous season, display 1000', kind: 'seed', prev: null, display: 1000 },
  { name: 'seed: no previous season, display 1300', kind: 'seed', prev: null, display: 1300 },
  { name: 'seed: no previous season, display 1720 (promotion zone)', kind: 'seed', prev: null, display: 1720 },
  { name: 'seed: no previous season, display 2500 (cap)', kind: 'seed', prev: null, display: 2500 },
  { name: 'seed: previous season bronze 500 (kept)', kind: 'seed', prev: 500, display: 2000 },
  { name: 'seed: previous season silver 1900 (kept)', kind: 'seed', prev: 1900, display: 1000 },
  { name: 'seed: previous season gold 2500 (soft reset)', kind: 'seed', prev: 2500, display: 1000 },
  { name: 'seed: previous season diamond 4500 (soft reset)', kind: 'seed', prev: 4500, display: 1000 },
  { name: 'seed: previous season grandmaster 9000 (soft reset)', kind: 'seed', prev: 9000, display: 1000 },
  { name: 'seed: previous season row at 0', kind: 'seed', prev: 0, display: 2500 },
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
];
// the endless cases (O728): fixed pass lines (not ELP.PRIOR, so retuning the prior moves no case)
function endlessCases() {
  const SOLO = [2, 6, 10, 15, 24, 38, 55], DUO = [3, 10, 16, 24, 38, 61, 88];
  const E = (name, fn, args) => ({ name: 'endless: ' + name, kind: 'endless', fn, args });
  const out = [
    // the hidden skill (depths newest first)
    E('hidden, no run', 'hiddenOf', [[]]),
    E('hidden, 4 runs (placement: null)', 'hiddenOf', [[10, 9, 8, 7]]),
    E('hidden, 4 runs read for a placement target (plain mean)', 'hiddenOf', [[10, 9, 8, 7], 1]),
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
    E('settle, promotion band silver 1950 pass (forced up to 2010)', 'endlessSettle', [1950, true, 600, SOLO, 0]),
    E('settle, promotion band silver 1950 miss', 'endlessSettle', [1950, false, 600, SOLO, 0]),
    E('settle, relegation band gold 2050 miss, skill silver (below master: no forced drop)', 'endlessSettle', [2050, false, 600, SOLO, 0]),
    E('settle, relegation band gold 2050 miss, skill gold (protected: no forced drop)', 'endlessSettle', [2050, false, 1000, SOLO, 0]),
    E('settle, relegation band gold 2010 miss, skill silver, offset -2 (held at the floor)', 'endlessSettle', [2010, false, 600, SOLO, -2]),
    E('settle, gold floor 2000 miss, skill gold (protected: d 0)', 'endlessSettle', [2000, false, 1000, SOLO, -2]),
    E('settle, relegation band gold 2050 pass', 'endlessSettle', [2050, true, 600, SOLO, 0]),
    E('settle, diamond 5850 pass, skill 3700 (the master gate: held at 5879)', 'endlessSettle', [5850, true, 3700, SOLO, 2]),
    E('settle, diamond 5850 pass, skill 3800 (the master gate open)', 'endlessSettle', [5850, true, 3800, SOLO, 2]),
    E('settle, diamond 5950 pass, skill 3800 (forced up into master)', 'endlessSettle', [5950, true, 3800, SOLO, 0]),
    E('settle, master 6050 miss, skill 3000 (master: the strict factor, forced down)', 'endlessSettle', [6050, false, 3000, SOLO, 0]),
    E('settle, master 6100 miss, skill 3000, offset +2 (forced down to 5985)', 'endlessSettle', [6100, false, 3000, SOLO, 2]),
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
    E('seed, platinum 1600 (above the relegation band)', 'endlessSeedLp', [1600, SOLO]),
    E('seed, platinum 2000 (the cap)', 'endlessSeedLp', [2000, SOLO]),
    E('seed, above the grandmaster line (the cap)', 'endlessSeedLp', [9000, SOLO]),
    E('seed, duo silver 1400', 'endlessSeedLp', [1400, DUO]),
    // the family row and the published table
    E('row details, placed silver with two receipts', 'elpRowDetails', [{ n: 7, hidden100: 950, tier: 1, placed: 1 }, [{ mh: -5, delta: 40, flags: 264 }, { mh: 77, delta: -13, flags: 258 }]]),
    E('row details, the window short of 5 runs (hidden -1)', 'elpRowDetails', [{ n: 9, hidden100: null, tier: 3, placed: 1 }, []]),
    E('row read', 'elpRowOf', [[494, 7, 950, 1, 1, 198, 2, -5, 40, 264, 77, -13, 258]]),
    E('row read, hidden -1 = null, a short ring', 'elpRowOf', [[494, 9, -1, 3, 1, 198, 2, 1, 2, 3]]),
    E('row read, another magic = null', 'elpRowOf', [[0xEF | 256, 7, 950, 1, 1, 198, 0]]),
    E('row read, version 2 = null', 'elpRowOf', [[0xEE | 512, 7, 950, 1, 1, 198, 0]]),
    E('row read, the O103 rating row = null', 'elpRowOf', [[12, 850, 6, 0]]),
    E('table details, solo live, the rest prior', 'elpTableDetails', [1, { solo: { N: 30, pass: SOLO }, duo: { N: 4, pass: DUO } }]),
    E('table read', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 100, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
    E('table read, another constant (rulesSame false)', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 120, 2].concat([30], SOLO, [4], DUO, [0], DUO, [0], DUO)]),
    E('table read, a v1 cut table = null', 'elpTableOf', [20261108, [0xEC | 256, 0, 0, 6000, 4000, 2800, 2000, 1400, 800].concat(new Array(21).fill(0))]),
    E('table read, a v3 table = null', 'elpTableOf', [20261201, [0xEC | 768, 1, 1, 1500, 500, 100, 2].concat(new Array(32).fill(0))]),
    E('table read, short = null', 'elpTableOf', [20261201, [0xEC | 512, 1, 1, 1500, 500, 100, 2]]),
  );
  return out;
}

// the out of one case, from a points-plan module (this repo's file, or the client's vendored copy)
function replay(PP, c) {
  if (c.kind === 'seed') return PP.seasonSeedLp(c.prev, c.display);
  if (c.kind === 'leave') return PP.leaverLpPenalty(c.cur, PP.LEAVER_LP_PENALTY);
  if (c.kind === 'boundary') return PP.boundaryOf(c.lp);
  if (c.kind === 'seat') return { mask: PP.rankedSeatMaskOf(c.mt), sans: PP.mtSansSeats(c.mt), base: PP.baseMt(c.mt), any: PP.anyAppliesLp(c.mt), seats: [0, 1, 2, 3, 4, 5].map((s) => PP.seatAppliesLp(c.mt, s)) };
  if (c.kind === 'endless') return PP[c.fn].apply(null, c.args);   // O728: one endless points function at fixed inputs
  if (c.kind !== 'match') throw new Error('unknown case kind ' + c.kind);
  const parts = c.parts.map((p) => ({ steamID: p.id, seat: p.seat, mmr: p.mmr, rank: p.rank, lp: p.lp }));
  const plan = PP.matchPlan(parts, c.mt, c.team || null);
  const out = {};
  for (const p of c.parts) {
    if (!PP.seatAppliesLp(c.mt, p.seat)) { out[p.id] = null; continue; }   // O716: a quick seat of a mixed table settles no points
    const row = (plan && plan[p.id]) || null;
    const line = PP.settleLine(p.lp, row, p.rank, parts.length, !!p.seeded);
    out[p.id] = { plan: row, d0: line.d0, d: line.d, won: line.won, nv: line.nv };
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
