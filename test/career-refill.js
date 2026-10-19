'use strict';
// 5.4a S0 (2026-10-19): every xp_ladder write carries the full career block.
// Only the matchmade creditXp fills careerDet; a run where a player only settled a friend-room / bot /
// endless game used to write the xp row without details -> Steam replaced the details array -> the 0xCA
// career block vanished from the board (live: 20 of 32 demo players with career games had lost it).
// Pins: careerBlockOf (state -> block), fillCareerDetails (refill from cumulative state, never overwrites
// a block creditXp already built), the three non-matchmade credit paths leave careerDet empty (so the
// refill is what saves the block), and the write phase calls the refill before the xp write (source pin).
//   node test/career-refill.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { careerBlockOf, fillCareerDetails, creditXpPrivate, creditXpBot, creditXpEndless, creditXp, CAREER_MAGIC, CAREER_VER, pid } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';

console.log('=== careerBlockOf ===');
eq('no state -> null', careerBlockOf(null), null);
eq('state without career counters -> null', careerBlockOf({ lastWinDay: 0, games: 0, pvDay: 5, pvXp: 40 }), null);
eq('games only (innocent) -> block', careerBlockOf({ cg: 3 }), [CAREER_MAGIC, CAREER_VER, 3, 0, 0]);
eq('full counters -> block', careerBlockOf({ cg: 12, cw: 5, cl: 6 }), [0xCA, 1, 12, 5, 6]);

console.log('=== fillCareerDetails ===');
{
  const xpState = {};
  xpState[pid(A)] = { cg: 10, cw: 4, cl: 5 };   // has played matchmade before
  xpState[pid(B)] = { pvDay: 1, pvXp: 30 };     // only ever friend rooms -> nothing to publish
  // C has no state at all
  const careerDet = {};
  careerDet[C] = [0xCA, 1, 1, 1, 0];             // built by creditXp this run (must not be touched)
  const changedXp = { [A]: 500, [B]: 120, [C]: 900 };
  const n = fillCareerDetails(changedXp, careerDet, xpState);
  eq('refilled count', n, 1);
  eq('A (xp changed via a non-matchmade path) gets its cumulative block', careerDet[A], [0xCA, 1, 10, 4, 5]);
  eq('B (no career counters) stays without details', careerDet[B], undefined);
  eq('C (creditXp block this run) untouched', careerDet[C], [0xCA, 1, 1, 1, 0]);
  eq('sids whose xp did not change are not added', Object.keys(careerDet).sort(), [A, C].sort());
}

console.log('=== the non-matchmade credit paths never fill careerDet (the refill is what saves the block) ===');
{
  // the credit functions take no careerDet argument at all -- pin the signatures so a future change
  // that starts passing one is noticed (and this test's premise re-checked).
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const sig = (name) => { const m = src.match(new RegExp('function ' + name + '\\(([^)]*)\\)')); return m ? m[1] : ''; };
  assert('creditXpPrivate has no careerDet parameter', !/careerDet/.test(sig('creditXpPrivate')));
  assert('creditXpBot has no careerDet parameter', !/careerDet/.test(sig('creditXpBot')));
  assert('creditXpEndless has no careerDet parameter', !/careerDet/.test(sig('creditXpEndless')));
  assert('creditXp (matchmade) still fills careerDet', /careerDet/.test(sig('creditXp')));
}

console.log('=== write phase: refill runs before the xp write, the write sends careerDet (source pin) ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const CALL = 'careerRefilled = fillCareerDetails(changedXp, careerDet, xpState)';   // the call site, not the definition
  const iFill = src.indexOf(CALL);
  const iWrite = src.indexOf('const wXp = await mapPool(Object.keys(changedXp)');
  assert('refill call present in the run', iFill > 0);
  assert('xp write loop present', iWrite > 0);
  assert('refill precedes the xp write loop', iFill > 0 && iWrite > 0 && iFill < iWrite);
  const writeBody = iWrite > 0 ? src.slice(iWrite, iWrite + 1200) : '';
  assert('xp write passes careerDet[sid] as details', /leaderboardid: xpId,[^\n]*careerDet\[sid\]/.test(writeBody));
  // mutation self-proof: the same checks on a copy with the refill call removed must go red
  const mutated = src.replace(CALL, 'careerRefilled = 0');
  const mFill = mutated.indexOf(CALL);
  assert('mutation self-proof: removing the refill call is detected', mFill < 0 && !(mFill > 0 && mFill < mutated.indexOf('const wXp = await mapPool(Object.keys(changedXp)')));
}

console.log('=== end to end: friend-room credit then refill keeps the block ===');
{
  const xp = {}; const changedXp = {}; const xpState = {}; const careerDet = {};
  xpState[pid(A)] = { lastWinDay: 0, games: 4, cg: 4, cw: 2, cl: 2 };
  xp[A] = 1000; xp[B] = 800;
  // a minimal consistent friend-room group (2 writers) -- shape per test/private-xp.js mk10
  const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const mk = (writer, seat) => {
    const d = [0xB1, 3, 10, 222, 9, seat, 0, (6 << 1), 2, 900, 4000, 3500, 0];
    for (const s of [A, B]) d.push(...sidPair(s));
    return { steamID: writer, d, dispCode: 0 };
  };
  const g = [mk(A, 0), mk(B, 1)];
  const rankOf = { [A]: 1, [B]: 2 };
  try {
    creditXpPrivate(g, rankOf, 6, xp, changedXp, xpState, 20000, new Set());
  } catch (e) { bad('creditXpPrivate threw: ' + e.message); }
  assert('friend-room credit changed A xp', changedXp[A] > 1000);
  eq('friend-room credit did not build a career block', careerDet[A], undefined);
  fillCareerDetails(changedXp, careerDet, xpState);
  eq('after refill A is written with its career block', careerDet[A], [0xCA, 1, 4, 2, 2]);
  eq('B (no career yet) still writes without details', careerDet[B], undefined);
}

if (failN) { console.log('\ncareer-refill: ' + failN + ' FAIL'); process.exit(1); }
console.log('\ncareer-refill: all ok');
