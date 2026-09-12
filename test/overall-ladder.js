'use strict';
// ============================================================
// overall-ladder.js - composite ("overall") competitive endless ladder (client knife 3.5d, 2026-09-10; experimental)
// ============================================================
// One score per player across the team-size ladders: overallScore(bests) = 100 x max(solo depth, M-weighted mean over the
// PLAYED sizes of K * depth). Solo counts double (M) and floors the result (trying a team run can lift you, never pull you
// below your solo depth); team depths are discounted (K) for the extra hooks. Pure function + the cron wiring pins
// (board constant / provisioning / recompute-and-write block).
const fs = require('fs');
const path = require('path');
const V = require('../validate.js');
const assert = (label, cond) => { if (cond) console.log('  ok    ' + label); else { console.log('  FAIL  ' + label); process.exitCode = 1; } };
const eq = (label, got, exp) => assert(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp));

const pack = (depth, bank) => V.packEndlessScore(depth, bank);

console.log('== overallScore (pure) ==');
eq('nothing played -> 0', V.overallScore({}), 0);
eq('solo only: depth 12 -> 1200 (plain depth, K[0] = 1)', V.overallScore({ 1: pack(12, 5000) }), 1200);
eq('duo only: depth 20 -> 20 * 0.9 = 1800', V.overallScore({ 2: pack(20, 9000) }), 1800);
eq('trio only: depth 20 -> 20 * 0.8 = 1600', V.overallScore({ 3: pack(20, 9000) }), 1600);
eq('solo 12 + duo 20: mean(2*12, 0.9*20)/3 = 14 -> 1400 (team run lifts the solo player)', V.overallScore({ 1: pack(12, 1), 2: pack(20, 1) }), 1400);
eq('solo 12 + duo 4: mean = (24 + 3.6)/3 = 9.2 < solo 12 -> floored at 1200 (a weak team run never pulls you below solo)', V.overallScore({ 1: pack(12, 1), 2: pack(4, 1) }), 1200);
eq('solo 10 + duo 10 + trio 10: (20 + 9 + 8)/4 = 9.25 -> floored 1000', V.overallScore({ 1: pack(10, 1), 2: pack(10, 1), 3: pack(10, 1) }), 1000);
eq('duo 10 + trio 30 (no solo): (9 + 24)/2 = 16.5 -> 1650', V.overallScore({ 2: pack(10, 1), 3: pack(30, 1) }), 1650);
eq('zero-depth rows are ignored (packed 0 / depth 0)', V.overallScore({ 1: 0, 2: pack(0, 500) }), 0);
eq('bank does not matter (same depth, different bank -> same score)', [V.overallScore({ 1: pack(7, 100) }), V.overallScore({ 1: pack(7, 99999) })], [700, 700]);

console.log('== overallDominant ==');
eq('solo only -> 1', V.overallDominant({ 1: pack(5, 1) }), 1);
eq('duo 20 (18) beats solo 12 -> 2', V.overallDominant({ 1: pack(12, 1), 2: pack(20, 1) }), 2);
eq('solo 12 beats duo 13 (11.7) -> 1', V.overallDominant({ 1: pack(12, 1), 2: pack(13, 1) }), 1);
eq('tie on discounted depth -> the smaller size', V.overallDominant({ 2: pack(8, 1), 3: pack(9, 1) }), 2);   // 7.2 vs 7.2
eq('nothing -> 0', V.overallDominant({}), 0);

console.log('== constants (client RANKED_CONFIG.ENDLESS.COMP.OVERALL mirrors these; the companion repo pins both sides) ==');
eq('COMP.OVERALL', V.COMP.OVERALL, { K: [1.0, 0.9, 0.8, 0.7], M: [2, 1, 1, 1] });
eq('board name default', V.ENDLESS_COMP_LB_OVERALL, process.env.ENDLESS_COMP_LB_OVERALL || 'endless_comp_overall');

console.log('== wiring pins (validate.js) ==');
const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('provisioned up-front with the solo/team ladders (trusted)', /\[ENDLESS_COMP_LB_OVERALL, true\]\]\) \{/.test(src));
assert('playtest board plan adds the overall ladder (trusted)', /add\(cfg\.compOverallLb, 1\);/.test(src) && /compOverallLb: ENDLESS_COMP_LB_OVERALL,/.test(src));
assert('lifetime board find-or-create + season twin via resolveSeasonBoard', /overallId = await findOrCreateBoard\(ENDLESS_COMP_LB_OVERALL, true\);/.test(src) && /resolveSeasonBoard\(lr, ENDLESS_COMP_LB_OVERALL, seasonId\)/.test(src));
assert('composite candidates = union of the four per-size best maps + this tick changed pools (lifetime + season) -> rollout backfill, not movers only',
  /\[changedComp, compFam\.DUO\.changed \|\| \{\}, compFam\.TRIO\.changed \|\| \{\}, compFam\.QUAD\.changed \|\| \{\}\]/.test(src) && /\[changedCompSeason, compFam\.DUO\.seasonChanged \|\| \{\}, compFam\.TRIO\.seasonChanged \|\| \{\}, compFam\.QUAD\.seasonChanged \|\| \{\}\]/.test(src)
  && /const bestMaps = season \? \[compSeasonBest, compFam\.DUO\.seasonBest \|\| \{\}, compFam\.TRIO\.seasonBest \|\| \{\}, compFam\.QUAD\.seasonBest \|\| \{\}\] : \[compBest, compFam\.DUO\.best \|\| \{\}, compFam\.TRIO\.best \|\| \{\}, compFam\.QUAD\.best \|\| \{\}\];/.test(src)
  && /const famOf = \{ 2: compFam\.DUO, 3: compFam\.TRIO, 4: compFam\.QUAD \};/.test(src) && /4: compFam\.QUAD\.best\[sid\] \| 0 \}/.test(src)
  && /const sids = \[\.\.\.new Set\(\[\.\.\.pools, \.\.\.bestMaps\]\.flatMap\(p => Object\.keys\(p\)\)\)\];/.test(src));
assert('composite board read once per tick; only rows missing or differing (score / dominant build / size) are ForceUpdated; read failure = skip, never wipe',
  /const br = await readBoardAll\(bid, label \+ ' board'\);/.test(src) && /return !c \|\| c\.s !== want\[0\] \|\| \(c\.det\[1\] \| 0\) !== want\[1\] \|\| \(c\.det\[2\] \| 0\) !== want\[2\];/.test(src)
  && /composite rows skipped this tick'\); return; \}/.test(src));
assert('score from the three per-size bests via overallScore; ForceUpdate; details = [score, dominant build, size]',
  /const s = overallScore\(bests\);/.test(src) && /return \[s \| 0, buildOf\(dom, sid, season\) \| 0, dom \| 0\];/.test(src) && /scoremethod: 'ForceUpdate', format: 'json' \}, want\);/.test(src));
assert('bulk reads keep raw details (build at [1]) for the dominant size when it did not change this tick',
  /compDet\[e\.steamID\] = e\.details;/.test(src) && /det\[e\.steamID\] = e\.details;/.test(src) && /const arr = decodeDetails\(det\);/.test(src));

if (process.exitCode) console.log('FAIL (overall-ladder)'); else console.log('ALL PASS (overall-ladder)');
