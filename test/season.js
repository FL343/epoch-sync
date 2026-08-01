// ============================================================
// season.js -- seasonal points ladder (2026-08-01): season clock, per-season
// board naming, lazy soft-reset seeding.
// ============================================================
// Covers: seasonAt table lookup (preseason 0 / exact boundary / between rows /
// past the last row), seasonBoardName (id 0 and 1+ shapes), softResetLp landing
// table (per-tier targets, keep-in-place bottom tiers, the min() guard, band
// safety of every landing target), seasonSeedLp priority (previous-season entry
// beats the display seed; absent -> display seed identity), and table-shape
// invariants that future season appends must keep.
// Usage: node test/season.js
// ============================================================
'use strict';
const V = require('../validate.js');
const { SEASONS, seasonAt, seasonBoardName, SOFT_RESET, softResetLp, seasonSeedLp, seedLp, LP_SEG, boundaryOf } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => {
  if (JSON.stringify(got) === JSON.stringify(exp)) ok(label + ' = ' + JSON.stringify(got));
  else bad(label + ' = ' + JSON.stringify(got) + ' (EXPECT ' + JSON.stringify(exp) + ')');
};
const t = (label, cond) => cond ? ok(label) : bad(label);

console.log('=== season clock (table lookup, id 0 = preseason) ===');
eq('table rows', SEASONS.map(s => s.id), [1, 2]);
eq('season 1 opens Dec 1 2026 UTC', SEASONS[0].start, Date.UTC(2026, 11, 1));
eq('season 2 opens Mar 1 2027 UTC', SEASONS[1].start, Date.UTC(2027, 2, 1));
{
  let increasing = true;
  for (let i = 1; i < SEASONS.length; i++) if (SEASONS[i].start <= SEASONS[i - 1].start || SEASONS[i].id !== SEASONS[i - 1].id + 1) increasing = false;
  t('rows strictly increasing (start + contiguous ids)', increasing);
}
eq('before season 1 -> preseason 0', seasonAt(Date.UTC(2026, 7, 1)), 0);
eq('one ms before season 1 -> 0', seasonAt(Date.UTC(2026, 11, 1) - 1), 0);
eq('exact season-1 boundary -> 1', seasonAt(Date.UTC(2026, 11, 1)), 1);
eq('mid season 1 -> 1', seasonAt(Date.UTC(2027, 0, 15)), 1);
eq('exact season-2 boundary -> 2', seasonAt(Date.UTC(2027, 2, 1)), 2);
eq('past the last row stays 2 (append a row to change seasons)', seasonAt(Date.UTC(2028, 0, 1)), 2);

console.log('=== board naming ===');
eq('preseason 0 -> base board', seasonBoardName('x', 0), 'x');
eq('season 1 -> x_s1', seasonBoardName('x', 1), 'x_s1');
eq('season 2 -> x_s2', seasonBoardName('x', 2), 'x_s2');
eq('test-env base derives the same way', seasonBoardName('x_test', 2), 'x_test_s2');

console.log('=== soft reset landing table ===');
eq('one target per tier', SOFT_RESET.length, LP_SEG.length);
eq('targets', SOFT_RESET, [null, null, 1200, 2000, 3000, 4000, 5000]);
eq('bronze 300 keeps', softResetLp(300), 300);
eq('silver 1000 keeps', softResetLp(1000), 1000);
eq('silver top 1999 keeps', softResetLp(1999), 1999);
eq('gold floor 2000 -> 1200', softResetLp(2000), 1200);
eq('gold top 2999 -> 1200', softResetLp(2999), 1200);
eq('platinum 3200 -> 2000', softResetLp(3200), 2000);
eq('diamond 4700 -> 3000', softResetLp(4700), 3000);
eq('diamond top 5999 -> 3000', softResetLp(5999), 3000);
eq('master 6500 -> 4000', softResetLp(6500), 4000);
eq('grandmaster 8500 -> 5000', softResetLp(8500), 5000);
eq('ceiling 9999 -> 5000', softResetLp(9999), 5000);
// the min() guard: a target can never RAISE points (protects against a mis-edited table)
eq('guard: value below its target stays (min)', softResetLp(0), 0);
{
  // every landing target must drop at least one tier and never rise
  let drops = true;
  for (let i = 0; i < LP_SEG.length; i++) {
    const target = SOFT_RESET[i];
    if (target == null) continue;
    if (target >= LP_SEG[i].min) drops = false;
  }
  t('every non-null target lands below its own tier floor', drops);
}

console.log('=== seeding priority (lazy season seed) ===');
eq('previous entry wins: prev 8500 -> 5000 (display ignored)', seasonSeedLp(8500, 2000), 5000);
eq('previous entry wins: prev 1000 keeps in place', seasonSeedLp(1000, 1740), 1000);
eq('prev 0 is still an entry (not null) -> 0', seasonSeedLp(0, 1740), 0);
eq('no previous entry -> display seed identity', seasonSeedLp(null, 1500), seedLp(1500));
eq('no previous entry, weak display -> 0', seasonSeedLp(null, 900), 0);

console.log('=== landing targets vs decisive-series bands (crossline skip is REQUIRED) ===');
// Three targets land exactly on tier floors = inside the relegation band. That is by design
// (the §-table wants "tier start"), and it is exactly why a soft-reset seed settle must skip
// the crossline clamp (seededNow) -- this test documents the dependency so a future edit that
// removes the skip trips over it consciously.
eq('1200 band-free', boundaryOf(1200), null);
eq('5000 band-free', boundaryOf(5000), null);
eq('2000 lands in a relegation band (skip required)', boundaryOf(2000), 'relegation');
eq('3000 lands in a relegation band (skip required)', boundaryOf(3000), 'relegation');
eq('4000 lands in a relegation band (skip required)', boundaryOf(4000), 'relegation');

console.log('');
if (failN) { console.log('FAIL x ' + failN); process.exit(1); }
console.log('ALL PASS (season)');
