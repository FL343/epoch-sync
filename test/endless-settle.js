'use strict';
// endless co-op settle authority (match type 7): depth tail decode, depth-scaled sanity bounds,
// pacing gate with the start-chain credit rule, canonical per-seat CP debit replay, board key
// packing, matchmade CP earn mirror, and the start-orphan exemption.
const path = require('path');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { ENDLESS, isEndlessMt, endlessTail, endlessGoalBase, endlessGoalFor, endlessCpGain, endlessContinueCost, endlessNib, endlessDebits, packEndlessScore, unpackEndlessScore, endlessRequiredMs, rosterConsensus, recordEndlessSignals, creditCp, sanityFlags, reconcileStarts, decodeRoster, sigPlayer, pairKey, pid } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// full wire-form type-7 settle record: 10 header + 2 scores + disp + 2x2 roster + 4 tail = 21 ints
function mk7(writer, seat, o) {
  o = o || {};
  const mt = o.mt == null ? 7 : o.mt;
  const scores = o.scores || [4000, 3500];
  const d = [0xB1, 3, mt, 222, 9, seat, 0, 0, (o.pc == null ? 2 : o.pc), (o.dur == null ? 1200 : o.dur)];
  for (let i = 0; i < (o.pc == null ? 2 : o.pc); i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [A, B];
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  if (!o.noTail) d.push(o.startDepth | 0, o.endDepth == null ? 6 : o.endDepth | 0, o.cont | 0, o.tokens | 0);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: (o.disp == null ? 0 : o.disp) };
}
const grp = (...rs) => rs;

console.log('=== endless settle authority (type 7) ===');

// -- constants pinned (companion-repo lockstep re-pins the client-shared subset) --
eq('config pinned (levelSecs/frac/depthCap/scoreMult/scale/div)',
  [ENDLESS.MT, ENDLESS.LEVEL_SECONDS, ENDLESS.PACE_FRAC, ENDLESS.DEPTH_CAP, ENDLESS.SCORE_MULT, ENDLESS.BOARD_SCALE, ENDLESS.TIEBREAK_DIV],
  [7, 60, 0.5, 200000, 10, 10000, 1000]);
eq('goal curve pinned', ENDLESS.GOAL, { start: 650, addonStart: 275, growEarly: 250, growLate: 50, earlyLevels: 9 });
eq('cp config pinned', ENDLESS.CP, { base: 10, rankBonus: [10, 5, 0, 0], rankedMult: 2.0 });
eq('continue ladder pinned', ENDLESS.CONTINUE, { base: 20, esc: 1.5 });
eq('isEndlessMt(7/0x17/2)', [isEndlessMt(7), isEndlessMt(0x17), isEndlessMt(2)], [true, true, false]);

// -- goal curve: value-pinned to the classic table (quadratic ramp then near-linear) --
eq('goalBase 1..12 (classic table)', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(endlessGoalBase),
  [650, 1175, 1950, 2975, 4250, 5775, 7550, 9575, 11850, 14375, 16950, 19575]);
eq('late slope: addon grows +50/level after the ramp', (endlessGoalBase(13) - endlessGoalBase(12)) - (endlessGoalBase(12) - endlessGoalBase(11)), 50);
eq('goalFor scales by player count', endlessGoalFor(5, 2), endlessGoalBase(5) * 2);
eq('goalBase clamps depth<1', endlessGoalBase(0), 650);

// -- tail decode --
const clean = mk7(A, 0, { startDepth: 0, endDepth: 6, cont: 0, tokens: 0 });
eq('tail decode', endlessTail(clean.d), { startDepth: 0, endDepth: 6, continuesUsed: 0, tokensCp: 0 });
eq('missing tail -> null', endlessTail(mk7(A, 0, { noTail: true }).d), null);

// -- CP gain mirror (client computeCpGain): base 10 + rank bonus (valid only), ranked x2 --
eq('cp gain probes [valid r0 q, valid r0 rk, valid r1 q, valid r3 q, innocent q, innocent rk, abandoner]',
  [endlessCpGain('valid', 0, false), endlessCpGain('valid', 0, true), endlessCpGain('valid', 1, false), endlessCpGain('valid', 3, false), endlessCpGain('innocent', -1, false), endlessCpGain('innocent', -1, true), endlessCpGain('abandoner', 0, true)],
  [20, 40, 15, 10, 10, 20, 0]);

// -- continue ladder + canonical per-seat debit replay --
eq('continue ladder 1..5', [1, 2, 3, 4, 5].map(endlessContinueCost), [20, 30, 45, 68, 101]);
eq('nib decode', [endlessNib(0x21, 0), endlessNib(0x21, 1)], [1, 2]);
eq('debits: single payer seat0 x2', endlessDebits(2), [50, 0]);
eq('debits: single payer seat1 x2', endlessDebits(2 << 4), [0, 50]);
eq('debits: seat0 x2 + seat1 x1 (seat-ascending rungs)', endlessDebits(2 | (1 << 4)), [50, 45]);
eq('debits sum == full ladder regardless of split', endlessDebits(1 | (2 << 4))[0] + endlessDebits(1 | (2 << 4))[1], 20 + 30 + 45);
eq('debits: none', endlessDebits(0), [0, 0]);

// -- board key packing: lex-monotone in (depth, team score), tiebreak saturates --
eq('pack(5, 3210000)/unpack', unpackEndlessScore(packEndlessScore(5, 3210000)), { depth: 5, tiebreak: 3210 });
eq('tiebreak saturation keeps depth dominance', packEndlessScore(5, 999999999) < packEndlessScore(6, 0), true);
eq('negative team score clamps tiebreak to 0', unpackEndlessScore(packEndlessScore(3, -500)).tiebreak, 0);
eq('depth cap fits int32 with headroom', packEndlessScore(ENDLESS.DEPTH_CAP, 999999999) <= 2147483647, true);

// -- pacing: depth-scaled minimum real time, start credit only up to the proven chain --
eq('fresh 0->10 needs 10 levels x 30s', endlessRequiredMs({ startDepth: 0, endDepth: 10 }, 0), 10 * 30000);
eq('resume 8->10 with chain 8: only the gain is owed', endlessRequiredMs({ startDepth: 8, endDepth: 10 }, 8), 2 * 30000);
eq('resume 8->10 with NO chain: full span owed (no time credit for an unproven start)', endlessRequiredMs({ startDepth: 8, endDepth: 10 }, 0), 10 * 30000);
eq('chain deeper than claim credits only startDepth', endlessRequiredMs({ startDepth: 8, endDepth: 10 }, 20), 2 * 30000);
eq('no gain -> no wait', endlessRequiredMs({ startDepth: 5, endDepth: 5 }, 5), 0);

// -- sanity branch (flag-don't-settle) --
const pair = (o) => grp(mk7(A, 0, o), mk7(B, 1, o));
eq('clean endless record -> []', sanityFlags(pair({ startDepth: 0, endDepth: 6 })), []);
eq('clean resumed record (deep scores under depth-scaled cap) -> []', sanityFlags(pair({ startDepth: 15, endDepth: 22, scores: [60000, 55000] })), []);
has('premade mask forged onto endless (0x17)', sanityFlags(pair({ mt: 0x17 })), 'mask');
has('pc=3 on a 2P co-op track', sanityFlags(grp(mk7(A, 0, { pc: 3, scores: [1, 2, 3], rosterSids: [A, B, C] }), mk7(B, 1, { pc: 3, scores: [1, 2, 3], rosterSids: [A, B, C] }))), 'pc');
has('missing tail', sanityFlags(pair({ noTail: true })), 'tail');
has('depth inversion (end < start)', sanityFlags(pair({ startDepth: 9, endDepth: 3 })), 'depth');
has('depth over structural cap', sanityFlags(pair({ startDepth: 0, endDepth: 300000 })), 'depth');
has('continues in nonexistent seat nibbles', sanityFlags(pair({ cont: 1 << 8 })), 'cont');
has('tokensCp nonzero (retired channel = tamper tell)', sanityFlags(pair({ tokens: 1 })), 'tokens');
has('score over depth-scaled cap (13k at depth 1)', sanityFlags(pair({ startDepth: 0, endDepth: 1, scores: [14000, 100] })), 'score');
not('same 14k score is fine at depth 6 (cap scales)', sanityFlags(pair({ startDepth: 0, endDepth: 6, scores: [14000, 100] })), 'score');
has('score under shared floor', sanityFlags(pair({ scores: [-60000, 100] })), 'score');
not('marathon session duration is legal for endless', sanityFlags(pair({ dur: 90000 })), 'duration');
has('negative duration still garbage', sanityFlags(pair({ dur: -5 })), 'duration');
has('dup writer still applies', sanityFlags(grp(mk7(A, 0, {}), mk7(A, 1, {}))), 'dup-writer');

// -- roster consensus (CP debits target the roster, not just writers) --
eq('rosterConsensus 2/2 agreement', rosterConsensus(pair({})), { 0: A, 1: B });
eq('rosterConsensus split vote -> seat dropped', rosterConsensus(grp(mk7(A, 0, {}), mk7(B, 1, { rosterSids: [C, B] }))), { 1: B });

// -- endless signals: participation counter + co-op pair edge (backs report verification + audit closure) --
{
  const s = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} };
  recordEndlessSignals(s, [A, B], 5000);
  const pa = s.players[pid(A)], pb = s.players[pid(B)], pe = s.pairs[pairKey(pid(A), pid(B))];
  eq('both players get e counter (incl. potential non-writers)', [pa && pa.e, pb && pb.e], [1, 1]);
  eq('no matchmade counters polluted (g/w stay 0)', [pa.g | 0, pa.w | 0], [0, 0]);
  eq('pair edge n/t recorded (co-op = together)', [pe && pe.n, pe && pe.t], [1, 1]);
}

// -- matchmade CP earn mirror (creditCp beside creditXp; endless never passes through here) --
{
  const cp = {}, changed = {};
  const gq = [
    { steamID: A, d: [0xB1, 3, 1, 1, 1, 0, 1, 1, 2, 600, 500, 400], dispCode: 0 },
    { steamID: B, d: [0xB1, 3, 1, 1, 1, 1, 0, 2, 2, 600, 500, 400], dispCode: 2 },
  ];
  creditCp(gq, 1, { [A]: 1, [B]: 2 }, cp, changed);
  eq('quick: valid rank1 +20, innocent +10', [cp[A], cp[B]], [20, 10]);
  creditCp(gq, 2, { [A]: 1, [B]: 2 }, cp, changed);
  eq('ranked doubles (accumulates on the wallet)', [cp[A], cp[B]], [20 + 40, 10 + 20]);
  const gAb = [{ steamID: A, d: [0xB1, 3, 2, 1, 1, 0, 0, 2, 2, 600, 0, 0], dispCode: 5 }];
  const cp2 = {}, ch2 = {};
  creditCp(gAb, 2, { [A]: 2 }, cp2, ch2);
  eq('abandoner earns nothing (no wallet entry)', cp2[A] == null, true);
}

// -- start-orphan exemption: a type-7 orphan start never convicts, and is TTL-pruned --
{
  const D = '76561198000000004';
  const leavers = {}, processed = new Set();
  const pending = {
    m7: { t0: 0, mt: 7, roster: { 0: pid(A), 1: pid(B) }, settled: [] },            // mature far past matchmade maturity
    m7old: { t0: -(31 * 86400000), mt: 7, roster: { 0: pid(A) }, settled: [] },     // past the endless TTL
    mq: { t0: 0, mt: 1, roster: { 0: pid(C), 1: pid(D) }, settled: [] },            // matchmade control: convicts
  };
  const res = reconcileStarts([], {}, new Set(), processed, pending, leavers, 8 * 3600 * 1000, 2 * 3600 * 1000);
  eq('type-7 orphan start: entry kept as pacing anchor', !!pending.m7, true);
  eq('type-7 orphan start: zero exit-rate hits on its roster', [leavers[pid(A)], leavers[pid(B)]], [undefined, undefined]);
  eq('matchmade control still convicts both absentees', [res.convicted, leavers[pid(C)] && leavers[pid(C)].leaves], [2, 1]);
  eq('type-7 entry past TTL pruned silently', pending.m7old, undefined);
  eq('type-7 keys never marked processed by the orphan path', processed.has('m7'), false);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (endless-settle) ===');
process.exit(failN === 0 ? 0 : 1);
