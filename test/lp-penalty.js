'use strict';
const path = require('path');
const { appliesLp, leaverLpPenalty } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

console.log('=== appliesLp (visible LP ladder is ranked-only) ===');
eq('ranked (matchType 2) -> moves LP', appliesLp(2), true);
eq('quick (matchType 1) -> MMR only, no LP', appliesLp(1), false);
eq('private/custom (matchType 0) -> no LP', appliesLp(0), false);

console.log('=== leaverLpPenalty (clamp-aware authoritative deduction) ===');
eq('2000 - 100 -> 1900', leaverLpPenalty(2000, 100), 1900);
eq('clamp: 50 - 100 -> 0 (never negative)', leaverLpPenalty(50, 100), 0);
eq('clamp: 0 - 100 -> 0', leaverLpPenalty(0, 100), 0);
eq('exact: 100 - 100 -> 0', leaverLpPenalty(100, 100), 0);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
