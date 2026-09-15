'use strict';
// sanityFlags (B5 tier A): calibration-free structural/physical bounds, flag-don't-settle.
const path = require('path');
const { sanityFlags, sidPlausible, pacingDefer, SANITY, TEAM2 } = require(path.join(__dirname, '..', 'validate.js'));

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

eq('defaults pinned (cap/floor/dur/start-age)', [SANITY.SCORE_CAP, SANITY.SCORE_FLOOR, SANITY.DUR_CAP, SANITY.MIN_START_AGE_MS], [450000, -50000, 7200, 300000]);   // cap 100k -> 450k 2026-09-16 (client knife 3.9 second-stage wheel; NOTE block in validate.js)
eq('team gamble headroom pinned x10 (second-stage wheel top slice)', TEAM2.SCORE_MULT, 10);
eq('mt whitelist pinned', SANITY.MT_ALLOWED, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);   // 5/6 = mode 2; 7 = endless co-op; 8/9 = mode 2 at teamSize 3 (O82 6P matchmaking); 10 = O140 private friend rooms (XP-only); 11 = O156 bot matches (XP-only)

eq('clean 3P quick -> []', sanityFlags(grp(mk(A, 0), mk(B, 1))), []);
eq('clean ranked premade mask (mt=34, pc=4) -> []', sanityFlags(grp(mk(A, 0, { mt: 34, pc: 4 }), mk(B, 1, { mt: 34, pc: 4 }))), []);
eq('clean team (mt=4, pc=4) -> []', sanityFlags(grp(mk(A, 0, { mt: 4, pc: 4 }), mk(B, 1, { mt: 4, pc: 4 }))), []);
eq('shop overdraft score -100 legal', sanityFlags(grp(mk(A, 0, { scores: [-100, 50, 60] }), mk(B, 1, { scores: [-100, 50, 60] }))), []);
// knife 3.9 (2026-09-16): FFA floor unchanged (a wager can only cost 2x a 30% stake); team codes take -SCORE_CAP (all-in double debit)
eq('FFA score below shared floor flagged', sanityFlags(grp(mk(A, 0, { scores: [-60000, 50, 60] }), mk(B, 1, { scores: [-60000, 50, 60] }))), ['score']);
eq('mode-1 team (mt=4, no gamble) keeps the shared floor', sanityFlags(grp(mk(A, 0, { mt: 4, pc: 4, scores: [-120000, 100, 100, 100] }), mk(B, 1, { mt: 4, pc: 4, scores: [-120000, 100, 100, 100] }))), ['score']);
eq('mode-2 team (mt=5) all-in double-debit negative bank legal (>= -SCORE_CAP)', sanityFlags(grp(mk(A, 0, { mt: 5, pc: 4, scores: [-120000, 100, 100, 100] }), mk(B, 1, { mt: 5, pc: 4, scores: [-120000, 100, 100, 100] }))), []);
eq('mode-2 team (mt=5) below -SCORE_CAP flagged', sanityFlags(grp(mk(A, 0, { mt: 5, pc: 4, scores: [-450001, 100, 100, 100] }), mk(B, 1, { mt: 5, pc: 4, scores: [-450001, 100, 100, 100] }))), ['score']);

has('mt=0 (private, never client-reported)', sanityFlags(grp(mk(A, 0, { mt: 0 }), mk(B, 1, { mt: 0 }))), 'mt');
has('mt=12 (unassigned code)', sanityFlags(grp(mk(A, 0, { mt: 12 }), mk(B, 1, { mt: 12 }))), 'mt');   // O140: 10 = private friend rooms (private-xp.js); O156: 11 = bot matches (bot-xp.js)
has('team code carrying mask (3|1<<4)', sanityFlags(grp(mk(A, 0, { mt: 19, pc: 4 }), mk(B, 1, { mt: 19, pc: 4 }))), 'team-mask');
has('team pc!=4', sanityFlags(grp(mk(A, 0, { mt: 3, pc: 3 }), mk(B, 1, { mt: 3, pc: 3 }))), 'pc');
has('ffa pc=1', sanityFlags(grp(mk(A, 0, { pc: 1, scores: [10] }), mk(B, 0, { pc: 1, scores: [10] }))), 'pc');
has('ffa pc=7', sanityFlags(grp(mk(A, 0, { pc: 7, scores: [1, 2, 3, 4, 5, 6, 7] }), mk(B, 1, { pc: 7, scores: [1, 2, 3, 4, 5, 6, 7] }))), 'pc');
eq('ffa pc=5 now legal (O82 6P: 5P fallback composition)', sanityFlags(grp(mk(A, 0, { pc: 5, scores: [1, 2, 3, 4, 5] }), mk(B, 1, { pc: 5, scores: [1, 2, 3, 4, 5] }))), []);
has('mask bit1 with pc=2 (seats 2,3 absent)', sanityFlags(grp(mk(A, 0, { mt: 33, pc: 2 }), mk(B, 1, { mt: 33, pc: 2 }))), 'mask-range');
has('mask>3', sanityFlags(grp(mk(A, 0, { mt: 1 | (5 << 4), pc: 4 }), mk(B, 1, { mt: 1 | (5 << 4), pc: 4 }))), 'mask-range');
// O82 trio field (bits 8..10 = start seat + 1): domain checks
eq('clean 6P ffa + trio seats 0-2 (mt=1|1<<8)', sanityFlags(grp(mk(A, 0, { mt: 1 | (1 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }), mk(B, 1, { mt: 1 | (1 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }))), []);
eq('clean 5P ffa + trio seats 2-4 (trioAt=3)', sanityFlags(grp(mk(A, 0, { mt: 1 | (3 << 8), pc: 5, scores: [1, 2, 3, 4, 5] }), mk(B, 1, { mt: 1 | (3 << 8), pc: 5, scores: [1, 2, 3, 4, 5] }))), []);
eq('clean 6P ffa + pair(0,1) + trio(3-5) coexist', sanityFlags(grp(mk(A, 0, { mt: 1 | (1 << 4) | (4 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }), mk(B, 1, { mt: 1 | (1 << 4) | (4 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }))), []);
has('trio seats past pc (trioAt=5, pc=5)', sanityFlags(grp(mk(A, 0, { mt: 1 | (5 << 8), pc: 5, scores: [1, 2, 3, 4, 5] }), mk(B, 1, { mt: 1 | (5 << 8), pc: 5, scores: [1, 2, 3, 4, 5] }))), 'trio-range');
has('pair(0,1) overlapping trio(0-2) = forged units', sanityFlags(grp(mk(A, 0, { mt: 1 | (1 << 4) | (1 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }), mk(B, 1, { mt: 1 | (1 << 4) | (1 << 8), pc: 6, scores: [1, 2, 3, 4, 5, 6] }))), 'unit-overlap');
has('endless code carrying trio bits', sanityFlags(grp(mk(A, 0, { mt: 7 | (1 << 8), pc: 2, scores: [1, 2] }), mk(B, 1, { mt: 7 | (1 << 8), pc: 2, scores: [1, 2] }))), 'mask');
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
