'use strict';
// Unit tests for the repeat-group rating decay (retention R1): groupDecayPlan streak/weight
// semantics -- x1/x0.5/x0.25/x0 for 1st/2nd/3rd/4th+ consecutive matches against mostly the
// same people, reset when more than half of a player's opponents are replaced, TTL-scoped.
//   node test/group-decay.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const { groupDecayPlan, GROUP_DECAY } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const T0 = 1000000000000;
const wOf = (plan, p) => plan[p] && plan[p].w;
const kOf = (plan, p) => plan[p] && plan[p].k;

console.log('=== constants ===');
eq('weights ladder x1/x0.5/x0.25/x0', GROUP_DECAY.WEIGHTS, [1, 0.5, 0.25, 0]);
assert('reset rule = replaced MORE than half (repeat >= 0.5 keeps streak)', GROUP_DECAY.REPEAT_FRAC === 0.5);

console.log('=== fresh group -> full weight ===');
{
  const mem = {};
  const p1 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  eq('all four w=1', [wOf(p1, 'a'), wOf(p1, 'b'), wOf(p1, 'c'), wOf(p1, 'd')], [1, 1, 1, 1]);
  eq('all four streak k=1', [kOf(p1, 'a'), kOf(p1, 'd')], [1, 1]);
}

console.log('=== same four, back-to-back: x0.5 -> x0.25 -> x0 -> stays x0 ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  const p2 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 60e3);
  eq('2nd match w=0.5', wOf(p2, 'a'), 0.5);
  const p3 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 120e3);
  eq('3rd match w=0.25', wOf(p3, 'a'), 0.25);
  const p4 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 180e3);
  eq('4th match w=0', wOf(p4, 'a'), 0);
  const p5 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 240e3);
  eq('5th match still w=0 (k keeps counting)', [wOf(p5, 'a'), kOf(p5, 'a')], [0, 5]);
}

console.log('=== blood change: more than half replaced resets ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 60e3);       // a at k=2
  // a keeps only b (1 of 3 others repeat = 0.33 < 0.5) -> reset
  const p = groupDecayPlan(mem, ['a', 'b', 'x', 'y'], T0 + 120e3);
  eq('a reset to k=1 w=1 (2 of 3 opponents new)', [kOf(p, 'a'), wOf(p, 'a')], [1, 1]);
  eq('newcomer x is fresh w=1', wOf(p, 'x'), 1);
}

console.log('=== half repeat keeps the streak (>=0.5 rule) ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  // a sees b,c repeat + x new: 2/3 = 0.67 >= 0.5 -> streak continues
  const p = groupDecayPlan(mem, ['a', 'b', 'c', 'x'], T0 + 60e3);
  eq('a continues k=2 w=0.5 (2 of 3 repeat)', [kOf(p, 'a'), wOf(p, 'a')], [2, 0.5]);
  eq('x fresh w=1', wOf(p, 'x'), 1);
}

console.log('=== 2P pair semantics ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b'], T0);
  const p2 = groupDecayPlan(mem, ['a', 'b'], T0 + 60e3);
  eq('same opponent again w=0.5', wOf(p2, 'a'), 0.5);
  const p3 = groupDecayPlan(mem, ['a', 'z'], T0 + 120e3);
  eq('new opponent resets w=1', wOf(p3, 'a'), 1);
}

console.log('=== TTL: session-scoped memory ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  const p = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + GROUP_DECAY.TTL_MS + 1);
  eq('past TTL the same four are a fresh group', [kOf(p, 'a'), wOf(p, 'a')], [1, 1]);
}

console.log('=== asymmetric memories (per-player, not per-table) ===');
{
  const mem = {};
  groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  // e replaces d: a/b/c continue (2/3 repeat), e fresh, and d (absent) keeps his old memory
  const p = groupDecayPlan(mem, ['a', 'b', 'c', 'e'], T0 + 60e3);
  eq('a/b/c decayed, e full', [wOf(p, 'a'), wOf(p, 'b'), wOf(p, 'c'), wOf(p, 'e')], [0.5, 0.5, 0.5, 1]);
  // d returns next match with a,b,c: his memory still says {a,b,c} -> 3/3 repeat -> k=2
  const p2 = groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + 120e3);
  eq('returning d continues his own streak (k=2)', kOf(p2, 'd'), 2);
}

console.log('=== leaver in roster still advances (leaving is not streak laundering) ===');
{
  const mem = {};
  // same call shape as the settle site: writers + consensus leavers concatenated
  groupDecayPlan(mem, ['a', 'b', 'c', 'lv'], T0);
  const p = groupDecayPlan(mem, ['a', 'b', 'c', 'lv'], T0 + 60e3);
  eq('leaver pid decays like everyone (k=2)', kOf(p, 'lv'), 2);
}

console.log('=== duplicate pids collapse (defensive) ===');
{
  const mem = {};
  const p = groupDecayPlan(mem, ['a', 'a', 'b'], T0);
  eq('dup pid counted once', mem.a.r, ['b']);
  eq('weights still returned', [wOf(p, 'a'), wOf(p, 'b')], [1, 1]);
}

console.log(failN ? ('=== FAIL -- ' + failN + ' fail (group decay) ===') : '=== PASS -- 0 fail (group decay) ===');
process.exit(failN ? 1 : 0);
