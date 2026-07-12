'use strict';
// sanityFlags (B5 tier A): calibration-free structural/physical bounds, flag-don't-settle.
const path = require('path');
const { sanityFlags, sidPlausible, pacingDefer, SANITY } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
// build one record: seat/scores/etc.; roster defaults to each sid at its seat
function mk(writer, seat, opts) {
  const o = opts || {};
  const pc = o.pc == null ? 3 : o.pc, mt = o.mt == null ? 1 : o.mt;
  const scores = o.scores || [100, 200, 300, 400].slice(0, pc);
  const d = [0xB1, 3, mt, 111, 7, seat, 1, 1, pc, (o.dur == null ? 600 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(0);
  const roster = o.roster !== undefined ? o.roster : (() => { const r = {}; [A, B, C, '76561198000000004'].slice(0, pc).forEach((s, i) => r[i] = s); return r; })();
  return { steamID: writer, d, roster, dispCode: 0 };
}
const grp = (...rs) => rs;

console.log('=== sanityFlags (B5 tier A) ===');

eq('defaults pinned (cap/floor/dur/start-age)', [SANITY.SCORE_CAP, SANITY.SCORE_FLOOR, SANITY.DUR_CAP, SANITY.MIN_START_AGE_MS], [100000, -50000, 7200, 300000]);
eq('mt whitelist pinned', SANITY.MT_ALLOWED, [1, 2, 3, 4]);

eq('clean 3P quick -> []', sanityFlags(grp(mk(A, 0), mk(B, 1))), []);
eq('clean ranked premade mask (mt=34, pc=4) -> []', sanityFlags(grp(mk(A, 0, { mt: 34, pc: 4 }), mk(B, 1, { mt: 34, pc: 4 }))), []);
eq('clean team (mt=4, pc=4) -> []', sanityFlags(grp(mk(A, 0, { mt: 4, pc: 4 }), mk(B, 1, { mt: 4, pc: 4 }))), []);
eq('shop overdraft score -100 legal', sanityFlags(grp(mk(A, 0, { scores: [-100, 50, 60] }), mk(B, 1, { scores: [-100, 50, 60] }))), []);

has('mt=0 (private, never client-reported)', sanityFlags(grp(mk(A, 0, { mt: 0 }), mk(B, 1, { mt: 0 }))), 'mt');
has('mt=5 (mode2 not open yet)', sanityFlags(grp(mk(A, 0, { mt: 5 }), mk(B, 1, { mt: 5 }))), 'mt');
has('team code carrying mask (3|1<<4)', sanityFlags(grp(mk(A, 0, { mt: 19, pc: 4 }), mk(B, 1, { mt: 19, pc: 4 }))), 'team-mask');
has('team pc!=4', sanityFlags(grp(mk(A, 0, { mt: 3, pc: 3 }), mk(B, 1, { mt: 3, pc: 3 }))), 'pc');
has('ffa pc=1', sanityFlags(grp(mk(A, 0, { pc: 1, scores: [10] }), mk(B, 0, { pc: 1, scores: [10] }))), 'pc');
has('ffa pc=5', sanityFlags(grp(mk(A, 0, { pc: 5, scores: [1, 2, 3, 4, 5] }), mk(B, 1, { pc: 5, scores: [1, 2, 3, 4, 5] }))), 'pc');
has('mask bit1 with pc=2 (seats 2,3 absent)', sanityFlags(grp(mk(A, 0, { mt: 33, pc: 2 }), mk(B, 1, { mt: 33, pc: 2 }))), 'mask-range');
has('mask>3', sanityFlags(grp(mk(A, 0, { mt: 1 | (5 << 4), pc: 4 }), mk(B, 1, { mt: 1 | (5 << 4), pc: 4 }))), 'mask-range');
has('score above cap', sanityFlags(grp(mk(A, 0, { scores: [999999, 1, 2] }), mk(B, 1, { scores: [999999, 1, 2] }))), 'score');
has('score below floor', sanityFlags(grp(mk(A, 0, { scores: [-60000, 1, 2] }), mk(B, 1, { scores: [-60000, 1, 2] }))), 'score');
has('duration negative', sanityFlags(grp(mk(A, 0, { dur: -5 }), mk(B, 1))), 'duration');
has('duration absurd', sanityFlags(grp(mk(A, 0, { dur: 90000 }), mk(B, 1))), 'duration');
has('same account writing twice', sanityFlags(grp(mk(A, 0), mk(A, 1))), 'dup-writer');
has('seat out of range', sanityFlags(grp(mk(A, 5), mk(B, 1))), 'seat');
has('roster puts someone else at writer seat', sanityFlags(grp(mk(A, 0, { roster: { 0: B, 1: B } }), mk(B, 1))), 'self-seat');
eq('roster sentinel at own seat tolerated (cold-start race)', sanityFlags(grp(mk(A, 0, { roster: { 1: B, 2: C } }), mk(B, 1))), []);
has('implausible sid in roster', sanityFlags(grp(mk(A, 0, { roster: { 0: A, 1: '123' } }), mk(B, 1))), 'sid-range');
has('same sid on two seats', sanityFlags(grp(mk(A, 0, { roster: { 0: A, 1: A } }), mk(B, 1))), 'dup-sid');

eq('sidPlausible bounds', [sidPlausible(A), sidPlausible('123'), sidPlausible('0'), sidPlausible('99999999999999999999')], [true, false, false, false]);

// pacing gate: settle eligibility needs the start attestation's first sighting to be old enough.
// Clock = cron's own observation time (starts.json t0), immune to client speed hacks / forged
// durationSec. No pending entry -> no constraint (pre-attestation builds; recorded as ns signal).
eq('pacing: no start attestation -> no constraint', pacingDefer(undefined, 1000000, 300000), false);
eq('pacing: fresh attestation -> defer', pacingDefer({ t0: 900000 }, 1000000, 300000), true);
eq('pacing: aged attestation -> eligible', pacingDefer({ t0: 600000 }, 1000000, 300000), false);
eq('pacing: exact boundary -> eligible', pacingDefer({ t0: 700000 }, 1000000, 300000), false);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (sanity-bounds) ===');
process.exit(failN === 0 ? 0 : 1);
