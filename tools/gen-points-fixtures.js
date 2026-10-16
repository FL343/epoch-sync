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
//     null) and the points line (settleLine: d0 / d / won / nv).
//   seed: { prev, display } -> seasonSeedLp (prev null = no row on the previous season's board).
//   leave: { cur } -> the points after the leaver fine (LEAVER_LP_PENALTY).
//   boundary: { lp } -> boundaryOf (the client's series banner reads the same).
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'fixtures', 'points-plan', 'cases.json');
const P = (id, seat, mmr, rank, lp, seeded) => Object.assign({ id, seat, mmr, rank, lp }, seeded ? { seeded: true } : {});
const ffa = (b, mask, trioAt) => (b | ((mask | 0) << 4) | ((trioAt | 0) << 8));

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
];

// the out of one case, from a points-plan module (this repo's file, or the client's vendored copy)
function replay(PP, c) {
  if (c.kind === 'seed') return PP.seasonSeedLp(c.prev, c.display);
  if (c.kind === 'leave') return PP.leaverLpPenalty(c.cur, PP.LEAVER_LP_PENALTY);
  if (c.kind === 'boundary') return PP.boundaryOf(c.lp);
  if (c.kind !== 'match') throw new Error('unknown case kind ' + c.kind);
  const parts = c.parts.map((p) => ({ steamID: p.id, seat: p.seat, mmr: p.mmr, rank: p.rank, lp: p.lp }));
  const plan = PP.matchPlan(parts, c.mt, c.team || null);
  const out = {};
  for (const p of c.parts) {
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
