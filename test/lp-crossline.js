'use strict';
// hard promotion/relegation series: the boundary-zone match is decisive.
//   - boundaryOf mirrors the client RatingStore.boundaryState (same MARGIN semantics)
//   - crosslineDelta: promotion match won -> forced cross UP (lands next.min+PROMO_LAND unless the
//     natural delta already crossed); relegation match lost -> forced cross DOWN (min-RELEG_LAND);
//     everything else untouched. Composes as a clamp AFTER reduced-stakes / team halving.
//   - plan outputs carry `won` (unit average rank top-half / team outcome) for the settle pass.
const path = require('path');
const { boundaryOf, crosslineDelta, BOUNDARY_MARGIN, PROMO_LAND, RELEG_LAND, LP_SEG,
        reducedStakesPlan, teamLpPlan, lpDelta } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

console.log('=== constants (client lockstep values) ===');
eq('BOUNDARY_MARGIN', BOUNDARY_MARGIN, 120);
eq('PROMO_LAND', PROMO_LAND, 10);
eq('RELEG_LAND', RELEG_LAND, 15);

console.log('=== boundaryOf (mirror of client boundaryState probes) ===');
eq('bronze 0 (lowest tier: no relegation)', boundaryOf(0), null);
eq('bronze 1880 = promotion band edge (2000-120)', boundaryOf(1880), 'promotion');
eq('bronze 1879 = outside', boundaryOf(1879), null);
eq('gold 2120 = relegation band edge (2000+120)', boundaryOf(2120), 'relegation');
eq('gold 2121 = outside', boundaryOf(2121), null);
eq('gold 3880 = promotion band (diamond 4000)', boundaryOf(3880), 'promotion');
eq('grandmaster 8100 = relegation band', boundaryOf(8100), 'relegation');
eq('grandmaster 9990 (top tier: no promotion)', boundaryOf(9990), null);

console.log('=== crosslineDelta: promotion series ===');
// natural swing too small to cross -> forced to next.min+PROMO_LAND
eq('1880 won +50 -> forced +130 (lands 2010)', crosslineDelta(1880, 50, true), 130);
eq('1950 won +20 (2nd place) -> forced +60 (lands 2010)', crosslineDelta(1950, 20, true), 60);
// natural delta already past the line -> natural value kept (no double bump)
eq('1990 won +50 (lands 2040 > 2010) -> keep 50', crosslineDelta(1990, 50, true), 50);
// promotion match LOST -> untouched
eq('1880 lost -5 -> keep -5', crosslineDelta(1880, -5, true && false), -5);
// outside the band -> untouched even on a max win
eq('1700 won +50 -> keep 50 (outside band)', crosslineDelta(1700, 50, true), 50);

console.log('=== crosslineDelta: relegation series ===');
// losing a relegation match always drops below the line
eq('gold 2120 lost -17 -> forced -135 (lands 1985)', crosslineDelta(2120, -17, false), -135);
eq('gold 2005 lost -17 -> forced -20 (lands 1985)', crosslineDelta(2005, -17, false), -20);
// natural delta already below the floor stays (leaver-adjacent big losses)
eq('gold 2010 lost -40 (lands 1970 < 1985) -> keep -40', crosslineDelta(2010, -40, false), -40);
// relegation match WON -> untouched (escape with the natural gain)
eq('gold 2120 won +38 -> keep 38', crosslineDelta(2120, 38, true), 38);
// bottom tier can never be relegated
eq('bronze 100 lost -10 -> keep -10 (no tier below)', crosslineDelta(100, -10, false), -10);
// top tier can never promote
eq('grandmaster 9990 won +20 -> keep 20', crosslineDelta(9990, 20, true), 20);

console.log('=== plan outputs carry won (settle-pass input) ===');
// all-solo mismatch FFA: ranks 1..4, weak winner = UPSET + won:true; rank 4 = won:false
const parts4 = [
  { steamID: 'a', seat: 0, mmr: 500,  rank: 1, lp: 1880 },
  { steamID: 'b', seat: 1, mmr: 2000, rank: 2, lp: 3000 },
  { steamID: 'c', seat: 2, mmr: 2100, rank: 3, lp: 3000 },
  { steamID: 'd', seat: 3, mmr: 2200, rank: 4, lp: 2120 },
];
const plan = reducedStakesPlan(parts4, 2, 0);
eq('rank1 weak upset won=true', plan && plan.a && plan.a.won, true);
eq('rank2 won=true (top half)', plan && plan.b && plan.b.won, true);
eq('rank3 won=false', plan && plan.c && plan.c.won, false);
eq('rank4 won=false', plan && plan.d && plan.d.won, false);
// team plan: winning pair won:true, losing pair won:false
const tparts = [
  { steamID: 'a', seat: 0, mmr: 1000, lp: 2120 },
  { steamID: 'b', seat: 1, mmr: 1000, lp: 3000 },
  { steamID: 'c', seat: 2, mmr: 1000, lp: 1880 },
  { steamID: 'd', seat: 3, mmr: 1000, lp: 3000 },
];
const tplan = teamLpPlan(tparts, 4, [100, 100, 300, 300], []);
eq('team A (lost) won=false', tplan && tplan.a && tplan.a.won, false);
eq('team B (won) won=true', tplan && tplan.c && tplan.c.won, true);

console.log('=== end-to-end shapes: series + plan delta composition ===');
// team member in relegation band, team lost: halved delta then forced cross
const dA = tplan.a.adjDelta;                       // gold-avg loss halved + own drip
const dA2 = crosslineDelta(2120, dA, tplan.a.won);
ok('team relegation member: adj ' + dA + ' -> series ' + dA2 + ' (lands ' + (2120 + dA2) + ')');
if (!(2120 + dA2 < 2000)) bad('team relegation member must land below 2000');
// team member in promotion band, team won: forced cross up
const dC = tplan.c.adjDelta, dC2 = crosslineDelta(1880, dC, tplan.c.won);
if (!(1880 + dC2 >= 2000 + PROMO_LAND)) bad('team promotion member must land at/above 2010');
else ok('team promotion member: adj ' + dC + ' -> series ' + dC2 + ' (lands ' + (1880 + dC2) + ')');
// margin invariant: natural single-match swing never crosses a line from OUTSIDE the band
const maxWin = Math.max.apply(null, LP_SEG.map(s => s.win + s.drip));
if (maxWin < BOUNDARY_MARGIN) ok('margin invariant: max natural gain ' + maxWin + ' < MARGIN ' + BOUNDARY_MARGIN + ' (crossings only happen in-series)');
else bad('margin invariant broken: max natural gain ' + maxWin + ' >= MARGIN ' + BOUNDARY_MARGIN);
// PROTECTED (flag 2) exemption is settle-side (skips the clamp): assert the plan flags a shielded loss
const shieldPlan = teamLpPlan(tparts, 4, [100, 100, 300, 300], [1]);   // seat1 absent -> seat0 shielded
eq('shielded loser flagged PROTECTED (settle skips forced drop)', shieldPlan && shieldPlan.a && shieldPlan.a.flag, 2);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
