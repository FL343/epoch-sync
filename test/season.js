// ============================================================
// season.js -- seasonal points ladder (2026-08-01): season clock, per-season
// board naming, lazy soft-reset seeding.
// ============================================================
// Covers: seasonAt table lookup (preseason 0 / exact boundary / between rows /
// past the last row), seasonBoardName (id 0 and 1+ shapes), softResetLp landing
// table (per-tier targets: one tier down, 60 under the line -- O786 2026-11-09; the min() guard, band
// safety of every landing target), seasonSeedLp priority (previous-season entry
// beats the display seed; absent -> the display seed, soft-reset from season 1 on), and table-shape
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
eq('O844: season 1 is not scheduled -- its row starts at SEASON_UNSCHEDULED (2099-01-01 UTC)', [SEASONS[0].start, V.SEASON_UNSCHEDULED], [Date.UTC(2099, 0, 1), Date.UTC(2099, 0, 1)]);
eq('season 2 follows a quarter later (2099-04-01 UTC)', SEASONS[1].start, Date.UTC(2099, 3, 1));
eq('O844: no season turn on 2026-12-01, nor on any day a job will see -- season 0 on 2026-12-01, 2027-03-01, 2030, 2060 and one ms before the placeholder', [Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 2), Date.UTC(2027, 2, 1), Date.UTC(2030, 0, 1), Date.UTC(2060, 0, 1), V.SEASON_UNSCHEDULED - 1].map(seasonAt), [0, 0, 0, 0, 0, 0]);
t('O844: every row of the table is unscheduled (a row with a real date must come with the client table, the lockstep and a version gate)', SEASONS.every((s) => s.start >= V.SEASON_UNSCHEDULED));
{
  // mutation: season 1 back on its old date -> the two O844 checks above turn red (a copy of validate.js, loaded in-process)
  const fs = require('fs'), path = require('path'), os = require('os');
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/'), GOOD = '{ id: 1, start: SEASON_UNSCHEDULED },';
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  let red = false;
  if (src.indexOf(GOOD) < 0) bad('O844 mutation anchor missing: ' + GOOD);
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-o844-')), p = path.join(dir, 'validate.js');
    fs.writeFileSync(p, src.split(GOOD).join('{ id: 1, start: Date.UTC(2026, 11, 1) },').replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT)));
    try { const m = require(p); red = m.seasonAt(Date.UTC(2026, 11, 2)) === 1 && !m.SEASONS.every((s) => s.start >= m.SEASON_UNSCHEDULED); }
    finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }
  t('O844 mutation: season 1 back on 2026-12-01 turns both checks red (the season would turn by itself on that day)', red);
}
{
  let increasing = true;
  for (let i = 1; i < SEASONS.length; i++) if (SEASONS[i].start <= SEASONS[i - 1].start || SEASONS[i].id !== SEASONS[i - 1].id + 1) increasing = false;
  t('rows strictly increasing (start + contiguous ids)', increasing);
}
eq('before season 1 -> preseason 0', seasonAt(Date.UTC(2026, 7, 1)), 0);
eq('one ms before season 1 -> 0', seasonAt(Date.UTC(2099, 0, 1) - 1), 0);
eq('exact season-1 boundary -> 1', seasonAt(Date.UTC(2099, 0, 1)), 1);
eq('mid season 1 -> 1', seasonAt(Date.UTC(2099, 1, 15)), 1);
eq('exact season-2 boundary -> 2', seasonAt(Date.UTC(2099, 3, 1)), 2);
eq('past the last row stays 2 (append a row to change seasons)', seasonAt(Date.UTC(2100, 1, 1)), 2);

console.log('=== board naming ===');
eq('preseason 0 -> base board', seasonBoardName('x', 0), 'x');
eq('season 1 -> x_s1', seasonBoardName('x', 1), 'x_s1');
eq('season 2 -> x_s2', seasonBoardName('x', 2), 'x_s2');
eq('test-env base derives the same way', seasonBoardName('x_test', 2), 'x_test_s2');

console.log('=== soft reset landing table ===');
eq('one target per tier', SOFT_RESET.length, LP_SEG.length);
// O786 (user calls 2026-11-09, A72 + "reveal at most diamond"): one tier down, 60 under the line of the tier finished in (the
//   promotion band of the tier below); bronze kept but never above the silver landing; grandmaster with master (diamond)
eq('targets', SOFT_RESET, [540, 540, 1940, 2940, 3940, 5940, 5940]);
eq('bronze 300 keeps', softResetLp(300), 300);
eq('bronze 590 -> 540 (never above the silver landing)', softResetLp(590), 540);
eq('silver 1000 -> 540', softResetLp(1000), 540);
eq('silver top 1999 -> 540', softResetLp(1999), 540);
eq('gold floor 2000 -> 1940', softResetLp(2000), 1940);
eq('gold top 2999 -> 1940', softResetLp(2999), 1940);
eq('platinum 3200 -> 2940', softResetLp(3200), 2940);
eq('diamond 4700 -> 3940', softResetLp(4700), 3940);
eq('diamond top 5999 -> 3940', softResetLp(5999), 3940);
eq('master 6500 -> 5940', softResetLp(6500), 5940);
eq('grandmaster 8500 -> 5940 (reveal at most diamond)', softResetLp(8500), 5940);
eq('ceiling 9999 -> 5940', softResetLp(9999), 5940);
// the min() guard: a target can never RAISE points (protects against a mis-edited table)
eq('guard: value below its target stays (min)', softResetLp(0), 0);
{
  // every landing target must drop at least one tier and never rise
  let drops = true;
  for (let i = 0; i < LP_SEG.length; i++) {
    const target = SOFT_RESET[i];
    if (target == null || i === 0) continue;   // bronze: kept (the target only caps it under the silver landing)
    if (target >= LP_SEG[i].min) drops = false;
  }
  t('every target past bronze lands below its own tier floor', drops);
}

console.log('=== seeding priority (lazy season seed) ===');
eq('previous entry wins: prev 8500 -> 5940 (display ignored)', seasonSeedLp(8500, 2000, true), 5940);
eq('previous entry wins: prev 1000 -> 540', seasonSeedLp(1000, 1740, true), 540);
eq('prev 0 is still an entry (not null) -> 0', seasonSeedLp(0, 1740, true), 0);
eq('preseason, no previous entry -> display seed identity', seasonSeedLp(null, 1500, false), seedLp(1500));
eq('season 1+, no previous entry -> the display seed soft-reset (O786 one ruler)', seasonSeedLp(null, 1900, true), softResetLp(seedLp(1900)));
eq('no previous entry, weak display -> 0', seasonSeedLp(null, 900, true), 0);

console.log('=== landing targets vs decisive-series bands (crossline skip is REQUIRED) ===');
// O786: every landing past bronze sits in the PROMOTION band of the tier below (the first match of the season is a promotion
// match, A72); none in a relegation band any more (the old 2000 / 3000 / 4000 landings were, and a first-match loss dropped a
// tier). The seeded settle still skips the clamp (seededNow) until the placement-match rules (O717) say otherwise.
for (const x of [540, 1940, 2940, 3940, 5940]) eq(x + ' lands in a promotion band', boundaryOf(x), 'promotion');

console.log('');
if (failN) { console.log('FAIL x ' + failN); process.exit(1); }
console.log('ALL PASS (season)');
