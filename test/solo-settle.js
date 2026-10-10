'use strict';
// O93 solo competitive endless settle (knife 3.3a, 2026-09-06): the pure half of the pc=1 lane in validate.js --
//   chain rules (checkpoint continuation / save-point resume once / replay & after-final rejects / wait window),
//   structural sanity on a verified segment, milestone CP once per run, resume debit constant, the single-attester
//   start registration, the board surface (playtest plan + names) and the save-box header reader.
const path = require('path');
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));
const { COMP, ENDLESS_COMP_LB, SAVE_BOX_LB, SOLO_FILE, soloSanity, soloChainPlan, soloMilestones, soloAdvance, soloRunKey, soloStartAttested,
  reconcileStarts, ptBoardPlan, decodeRoster, endlessRequiredMs, ENDLESS, pid, soloMsSlot } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const SID = '76561198000000001';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// verified-field shape produced by attest.verifySoloRecord (only the fields the lane reads)
function seg(o) {
  return Object.assign({ startDepth: 0, endDepth: 5, score: 4000, durationSec: 300, dispCode: 0, continuesUsed: 0, tokensCp: 0,
    seasonId: 1, flags: 0, runSeed: 777, keyName: '2026090601' }, o || {});
}

console.log('=== O93 solo competitive settle (pure lane) ===');

console.log('-- constants (companion-repo lockstep re-pins the client-shared subset) --');
eq('COMP pinned (resumeCp / milestones / ckpt / wait / ttl)', [COMP.RESUME_CP, COMP.MILESTONES, COMP.CKPT_EVERY, COMP.CHAIN_WAIT_MS, COMP.RUN_TTL_MS],
  [20, [[10, 40], [20, 80], [30, 150]], 5, 7 * 86400000, 45 * 86400000]);
eq('board / state names', [ENDLESS_COMP_LB, SAVE_BOX_LB, SOLO_FILE], ['endless_comp_solo', 'endless_save_box_solo', 'endless-solo.json']);
eq('segment flag bits + quit disp (attest.js)', [A.SEG_SUSPENDED, A.SEG_FINAL, A.SEG_RESUMED, A.DISP_FINISHED, A.DISP_USER_QUIT], [1, 2, 4, 0, 5]);
eq('casual solo lane names + bits (client knife 3.7a, O218; companion boardNameFor(base,1) / casualSaveBoardName / attest_record.h SEG_CASUAL / ENDLESS.LIVES)', [v.ENDLESS_LB_SOLO, v.SAVE_BOX_LB_CASUAL, A.SEG_CASUAL, v.CASUAL_LIVES], ['endless_board_solo', 'endless_save_box_casual', 16, 3]);
eq('save box header decode (plaintext only)', A.saveBoxHead([0xBA | (1 << 8), 3, 1, 2026090601, 7, 9, 9, 9, 9, 9, 9, 9, 9]),
  { ver: 1, seasonId: 3, flags: 1, consumed: true, keyId: 2026090601, nonce: 7 });
eq('save box header: wrong magic -> null', A.saveBoxHead([0xB1, 3, 1, 1, 1]), null);
eq('run key = pid|season|runSeed', soloRunKey('p1', 2, 777), 'p1|2|777');

console.log('-- sanity bounds (verified segment) --');
eq('clean segment -> no flags', soloSanity(seg()), []);
assert('span > CKPT_EVERY -> span', soloSanity(seg({ startDepth: 0, endDepth: 6 })).indexOf('span') >= 0);
assert('continue nibble set -> cont (one life, never a continue)', soloSanity(seg({ continuesUsed: 1 })).indexOf('cont') >= 0);
assert('tokens -> tokens', soloSanity(seg({ tokensCp: 1 })).indexOf('tokens') >= 0);
assert('unknown flag bit -> flags', soloSanity(seg({ flags: 8 })).indexOf('flags') >= 0);
// O218 casual solo (client knife 3.7a): the CASUAL bit is legal, its seat-0 continue nibble is legal, a suspended casual segment is not
eq('casual segment -> clean', soloSanity(seg({ flags: A.SEG_CASUAL })), []);
eq('casual segment with 2 continues (seat-0 nibble) -> clean', soloSanity(seg({ flags: A.SEG_CASUAL, continuesUsed: 2 })), []);
assert('casual continue on another seat -> cont', soloSanity(seg({ flags: A.SEG_CASUAL, continuesUsed: 1 << 4 })).indexOf('cont') >= 0);
assert('casual + SUSPENDED -> flags (casual saves are checkpoint rows, the run continues)', soloSanity(seg({ flags: A.SEG_CASUAL | A.SEG_SUSPENDED })).indexOf('flags') >= 0);
assert('casual + FINAL + user-quit is legal', soloSanity(seg({ flags: A.SEG_CASUAL | A.SEG_FINAL, dispCode: 5 })).length === 0);
assert('casual + RESUMED is legal (token resume)', soloSanity(seg({ flags: A.SEG_CASUAL | A.SEG_RESUMED, startDepth: 5, endDepth: 7 })).length === 0);
// O216 classic (client knife 3.9b N2): CLASSIC bit legal; one life (any continue -> cont); no perks / rerolls (classic-perk); no suspended segment; own goal curve for the score cap
eq('classic lane names + bits + curve (companion classicBoardName(false,1) / classicSaveBoardName / attest_record.h SEG_CLASSIC / ENDLESS.CLASSIC)', [v.ENDLESS_LB_CLASSIC_SOLO, v.SAVE_BOX_LB_CLASSIC, A.SEG_CLASSIC, v.CLASSIC.LIVES, v.CLASSIC.LEVEL_S_SOLO, v.CLASSIC.LEVEL_S_TEAM, v.CLASSIC.XP_MUL, v.CLASSIC.TIEBREAK_DIV],
  ['endless_classic_solo', 'endless_save_box_classic', 32, 1, 60, 40, 0.5, 100000]);
eq('classicGoalAt 1..12 = 650 / 1195 / 2010 / 3095 / 4450 / 6075 / 7970 / 10135 / 12570 / 15275 / 17980 / 20685 (linear +2705 from L10)', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(v.classicGoalAt),
  [650, 1195, 2010, 3095, 4450, 6075, 7970, 10135, 12570, 15275, 17980, 20685]);
eq('classicGoalAt(200) linear', v.classicGoalAt(200), 15275 + 2705 * 190);
eq('classicGoalFor pc 2 = x1 / pc 3 round-half-up / pc 4 = x2', [v.classicGoalFor(2, 2), v.classicGoalFor(2, 3), v.classicGoalFor(2, 4)], [1195, Math.floor((1195 * 3 + 1) / 2), 2390]);
eq('packClassicScore depth-major + bank/1e5 tiebreak (saturates at 9999 -> $999.9M)', [v.packClassicScore(7, 123456), v.packClassicScore(7, 2147483647)], [70001, 79999]);
eq('classic segment -> clean', soloSanity(seg({ flags: A.SEG_CLASSIC, endDepth: 5, score: 4450 })), []);
assert('classic continue -> cont (one life)', soloSanity(seg({ flags: A.SEG_CLASSIC, continuesUsed: 1 })).indexOf('cont') >= 0);
assert('classic + build -> classic-perk', soloSanity(seg({ flags: A.SEG_CLASSIC, build: 135 })).indexOf('classic-perk') >= 0);
assert('classic + reroll bitmap -> classic-perk', soloSanity(seg({ flags: A.SEG_CLASSIC, rerollLo: 1 })).indexOf('classic-perk') >= 0);
assert('classic + SUSPENDED -> flags (classic saves are purchase-cut rows, the run continues)', soloSanity(seg({ flags: A.SEG_CLASSIC | A.SEG_SUSPENDED })).indexOf('flags') >= 0);
assert('classic + casual together -> flags (exclusive rule sets)', soloSanity(seg({ flags: A.SEG_CLASSIC | A.SEG_CASUAL })).indexOf('flags') >= 0);
assert('classic score above classicGoalFor x SCORE_MULT -> score', soloSanity(seg({ flags: A.SEG_CLASSIC, endDepth: 5, score: 4450 * v.ENDLESS.SCORE_MULT + 1 })).indexOf('score') >= 0);
assert('classic score at classicGoalFor x SCORE_MULT is legal (depth 5 line 4450)', soloSanity(seg({ flags: A.SEG_CLASSIC, endDepth: 5, score: 4450 * v.ENDLESS.SCORE_MULT })).length === 0);
assert('classic + FINAL + user-quit is legal', soloSanity(seg({ flags: A.SEG_CLASSIC | A.SEG_FINAL, dispCode: 5 })).length === 0);
assert('classic + RESUMED at a non-checkpoint depth is legal (purchase-cut row)', soloSanity(seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 7, endDepth: 9 })).length === 0);
assert('SUSPENDED|FINAL together -> flags', soloSanity(seg({ flags: A.SEG_SUSPENDED | A.SEG_FINAL })).indexOf('flags') >= 0);
assert('disp outside {finished, user-quit} -> disp', soloSanity(seg({ dispCode: 3 })).indexOf('disp') >= 0);
assert('suspended segment with a quit disp -> disp', soloSanity(seg({ flags: A.SEG_SUSPENDED, dispCode: 5 })).indexOf('disp') >= 0);
assert('final + user-quit is legal', soloSanity(seg({ flags: A.SEG_FINAL, dispCode: 5 })).length === 0);
assert('end < start -> depth', soloSanity(seg({ startDepth: 5, endDepth: 4 })).indexOf('depth') >= 0);
assert('season out of domain -> season', soloSanity(seg({ seasonId: 5000 })).indexOf('season') >= 0);
assert('score above the depth-scaled cap -> score', soloSanity(seg({ score: 99999999 })).indexOf('score') >= 0);
assert('negative duration -> duration', soloSanity(seg({ durationSec: -1 })).indexOf('duration') >= 0);

console.log('-- chain rules --');
{
  const st = { runs: {}, wait: {} };
  const key = soloRunKey('p1', 1, 777);
  const T0 = 1000000;
  let plan = soloChainPlan(st, key, seg({ startDepth: 0, endDepth: 5 }), 'm0', T0);
  eq('fresh run: depth-0 segment settles, proven 0', plan, { ok: true, proven: 0 });
  soloAdvance(st, key, seg({ startDepth: 0, endDepth: 5, picksLo: 9, picksHi: 0 }), 'm0', plan, T0);
  eq('run memory after seg0', [st.runs[key].max, st.runs[key].seg0, st.runs[key].final || 0], [5, 1, 0]);
  eq('run memory keeps the segment\'s pick log (perk_chain input for the next segment)', st.runs[key].pk, { lo: 9, hi: 0 });
  eq('a pick log that does not extend the remembered one -> perk_chain', v.verifyPerkPicks({ build: 0, picksLo: 10, picksHi: 0, seasonId: 1, endDepth: 10 }, st.runs[key], 1), { ok: false, reason: 'perk_chain', why: 'prefix' });
  plan = soloChainPlan(st, key, seg({ startDepth: 5, endDepth: 10 }), 'm1', T0);
  eq('checkpoint continuation settles, proven = its startDepth', plan, { ok: true, proven: 5 });
  soloAdvance(st, key, seg({ startDepth: 5, endDepth: 10 }), 'm1', plan, T0);
  eq('replayed depth-0 segment on the same run -> restart (reject)', soloChainPlan(st, key, seg({ startDepth: 0, endDepth: 5 }), 'mX', T0), { ok: false, reason: 'restart' });
  eq('out-of-order later segment waits for its predecessor (chain-gap)', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0), { ok: null, reason: 'chain-gap' });
  assert('wait clock stamped on first sighting', st.wait.m3 && st.wait.m3.t0 === T0);
  eq('still waiting inside the window', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0 + COMP.CHAIN_WAIT_MS - 1), { ok: null, reason: 'chain-gap' });
  eq('window elapsed -> chain-gap reject', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0 + COMP.CHAIN_WAIT_MS + 1), { ok: false, reason: 'chain-gap' });
  eq('a segment behind the chain head -> chain-back', soloChainPlan(st, key, seg({ startDepth: 5, endDepth: 10 }), 'mY', T0), { ok: false, reason: 'chain-back' });
  // O216 classic token resume: any proven depth (run.max >= sd), no checkpoint-multiple rule, revives a FINAL run
  {
    const st2 = { runs: {}, wait: {} }, k2 = 'cl';
    const p0 = soloChainPlan(st2, k2, seg({ flags: A.SEG_CLASSIC, startDepth: 0, endDepth: 2 }), 'c0', T0); v.soloAdvance(st2, k2, seg({ flags: A.SEG_CLASSIC, startDepth: 0, endDepth: 2 }), 'c0', p0, T0);
    const p1 = soloChainPlan(st2, k2, seg({ flags: A.SEG_CLASSIC | A.SEG_FINAL, startDepth: 2, endDepth: 3 }), 'c1', T0); v.soloAdvance(st2, k2, seg({ flags: A.SEG_CLASSIC | A.SEG_FINAL, startDepth: 2, endDepth: 3 }), 'c1', p1, T0);
    eq('classic resume at the purchase depth 2 (not a checkpoint multiple) after FINAL -> settle + revive', soloChainPlan(st2, k2, seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 2, endDepth: 4 }), 'c2', T0), { ok: true, proven: 2, revive: true });
    eq('classic resume beyond the proven head -> chain-gap (wait)', soloChainPlan(st2, k2, seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 9, endDepth: 10 }), 'c3', T0), { ok: null, reason: 'chain-gap' });
    eq('casual resume at a non-checkpoint depth still rejects (resume-not-checkpoint)', soloChainPlan(st2, k2, seg({ flags: A.SEG_CASUAL | A.SEG_RESUMED, startDepth: 2, endDepth: 4 }), 'c4', T0), { ok: false, reason: 'resume-not-checkpoint' });
  }
  eq('endlessRequiredMs classic 60s levels (x PACE_FRAC) vs default band floor', [v.endlessRequiredMs({ startDepth: 0, endDepth: 10 }, 0, v.CLASSIC.LEVEL_S_SOLO), v.endlessRequiredMs({ startDepth: 0, endDepth: 10 }, 0)],
    [10 * 60 * 1000 * v.ENDLESS.PACE_FRAC, 10 * v.ENDLESS.LEVEL_SECONDS * 1000 * v.ENDLESS.PACE_FRAC]);
  plan = soloChainPlan(st, key, seg({ startDepth: 10, endDepth: 15 }), 'm2', T0);
  eq('the missing predecessor settles normally', plan, { ok: true, proven: 10 });
  soloAdvance(st, key, seg({ startDepth: 10, endDepth: 15 }), 'm2', plan, T0);
  plan = soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0 + 5000);
  eq('the waiting segment settles once chained', plan, { ok: true, proven: 15 });
  soloAdvance(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', plan, T0 + 5000);
  assert('wait entry cleared on settle', !st.wait.m3);
  // save & quit -> resume once
  const susp = seg({ startDepth: 20, endDepth: 23, flags: A.SEG_SUSPENDED });
  plan = soloChainPlan(st, key, susp, 'm4', T0);
  eq('suspended segment settles like a checkpoint', plan, { ok: true, proven: 20 });
  soloAdvance(st, key, susp, 'm4', plan, T0);
  eq('save point remembered at its end depth', Object.keys(st.runs[key].saves), ['23']);
  const res = seg({ startDepth: 23, endDepth: 25, flags: A.SEG_RESUMED });
  plan = soloChainPlan(st, key, res, 'm5', T0);
  eq('resumed segment consumes the save point', plan, { ok: true, proven: 23, consume: '23' });
  soloAdvance(st, key, res, 'm5', plan, T0);
  eq('save point marked consumed by that segment', st.runs[key].saves['23'].by, 'm5');
  eq('same resumed segment again (idempotent re-sighting) still ok, no second consume', soloChainPlan(st, key, res, 'm5', T0), { ok: true, proven: 23 });
  eq('a DIFFERENT resumed segment from the same save point -> save-reused (one save, one resume)', soloChainPlan(st, key, seg({ startDepth: 23, endDepth: 26, flags: A.SEG_RESUMED }), 'm6', T0), { ok: false, reason: 'save-reused' });
  eq('resumed segment with no save point -> waits (save-orphan)', soloChainPlan(st, key, seg({ startDepth: 30, endDepth: 32, flags: A.SEG_RESUMED }), 'm7', T0), { ok: null, reason: 'save-orphan' });
  const fin = seg({ startDepth: 25, endDepth: 27, flags: A.SEG_FINAL, dispCode: 5 });
  plan = soloChainPlan(st, key, fin, 'm8', T0);
  eq('final (quit) segment settles', plan, { ok: true, proven: 25 });
  soloAdvance(st, key, fin, 'm8', plan, T0);
  eq('nothing follows a final segment -> after-final', soloChainPlan(st, key, seg({ startDepth: 27, endDepth: 30 }), 'm9', T0), { ok: false, reason: 'after-final' });
  eq('run memory final', [st.runs[key].max, st.runs[key].final], [27, 1]);
  // a different run (other runSeed) is independent
  eq('other run key starts fresh', soloChainPlan(st, soloRunKey('p1', 1, 778), seg({ startDepth: 0, endDepth: 3, flags: A.SEG_FINAL }), 'n0', T0), { ok: true, proven: 0 });
}

console.log('-- milestones (bitmap per player x season x ladder family) + resume debit + pacing --');
{
  const st = { runs: {}, wait: {}, ms: {} };
  const a = soloMsSlot(st, 'p1', 1, 'SOLO', 1000);
  eq('slot: fresh bitmap', [a.ms, a.t], [0, 1000]);
  eq('first run crosses 10', soloMilestones(a, 12), [[10, 40]]);
  eq('a NEW run in the same season on the same ladder re-earns nothing (slot is not per run)', soloMilestones(soloMsSlot(st, 'p1', 1, 'SOLO', 2000), 12), []);
  eq('another ladder family = its own bitmap', soloMilestones(soloMsSlot(st, 'p1', 1, 'DUO', 2000), 12), [[10, 40]]);
  eq('next season = fresh bitmap', soloMilestones(soloMsSlot(st, 'p1', 2, 'SOLO', 2000), 12), [[10, 40]]);
  eq('slot keys = pid|season|family', Object.keys(st.ms).sort(), ['p1|1|DUO', 'p1|1|SOLO', 'p1|2|SOLO']);
  assert('slot touch refreshes t (TTL pacing)', st.ms['p1|1|SOLO'].t === 2000);
  assert('loadSolo shape carries ms', JSON.stringify(Object.keys(v.loadSolo())).indexOf('ms') >= 0);
}
{
  const run = { max: 0, ms: 0, saves: {} };
  eq('depth 12 crosses 10', soloMilestones(run, 12), [[10, 40]]);
  eq('depth 12 again -> nothing (bitmap)', soloMilestones(run, 12), []);
  eq('depth 25 crosses 20 only', soloMilestones(run, 25), [[20, 80]]);
  eq('depth 35 crosses 30', soloMilestones(run, 35), [[30, 150]]);
  eq('bitmap = all three', run.ms, 7);
  const run2 = { ms: 0 };
  eq('a deep first segment crosses several at once', soloMilestones(run2, 31), [[10, 40], [20, 80], [30, 150]]);
  eq('pacing credits the proven chain depth only', [endlessRequiredMs({ startDepth: 5, endDepth: 10 }, 5), endlessRequiredMs({ startDepth: 5, endDepth: 10 }, 0)],
    [5 * ENDLESS.LEVEL_SECONDS * 1000 * ENDLESS.PACE_FRAC, 10 * ENDLESS.LEVEL_SECONDS * 1000 * ENDLESS.PACE_FRAC]);
}

console.log('-- single-attester start registration --');
{
  const p = sidPair(SID);
  const startSolo = { start: true, steamID: SID, shard: 's1', d: [0xB2, 1, 7, 4242, 777, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]] };
  startSolo.roster = decodeRoster(startSolo.d);
  eq('solo start roster = seat 0 writer', startSolo.roster, { 0: SID });
  assert('solo pc=1 endless start with self at seat 0 -> attested', soloStartAttested([startSolo]) === true);
  const other = sidPair('76561198000000002');
  const startForeign = { start: true, steamID: SID, d: [0xB2, 1, 7, 4243, 777, 0, 0, 0, 1, 0, 0, 0, other[0], other[1]] };
  startForeign.roster = decodeRoster(startForeign.d);
  assert('roster naming someone else -> not attested', soloStartAttested([startForeign]) === false);
  const startCoop = { start: true, steamID: SID, d: [0xB2, 1, 7, 4244, 777, 0, 0, 0, 2, 0, 0, 0, 0, p[0], p[1], other[0], other[1]] };
  startCoop.roster = decodeRoster(startCoop.d);
  assert('pc=2 single attester -> not attested (co-op keeps the 2+ rule)', soloStartAttested([startCoop]) === false);
  assert('two attesters -> handled by the normal path, not this exception', soloStartAttested([startSolo, startSolo]) === false);
  const pending = {}, leavers = {};
  const res = reconcileStarts([startSolo, startCoop], {}, new Set(), new Set(), pending, leavers, 5000, 7200000, {});
  const mSolo = '4242_777_7', mCoop = '4244_777_7';
  eq('reconcileStarts registers the solo start (pacing anchor t0 = now)', [res.registered, pending[mSolo] && pending[mSolo].t0, pending[mSolo] && pending[mSolo].mt], [1, 5000, 7]);
  assert('co-op single attester still not registered', !pending[mCoop]);
  assert('no conviction from the endless key', res.convicted === 0 && Object.keys(leavers).length === 0);
}

console.log('-- O218 casual solo chain (client knife 3.7a): token resume from a proven checkpoint, after FINAL, no save point, ladder restart --');
{
  const st = { runs: {}, wait: {} };
  const key = soloRunKey('p1', 1, 778);
  const T0 = 2000000;
  const C = A.SEG_CASUAL;
  let plan = soloChainPlan(st, key, seg({ flags: C, startDepth: 0, endDepth: 5, continuesUsed: 1 }), 'c0', T0);
  eq('casual fresh run: depth-0 segment settles', plan, { ok: true, proven: 0 });
  soloAdvance(st, key, seg({ flags: C, startDepth: 0, endDepth: 5 }), 'c0', plan, T0);
  plan = soloChainPlan(st, key, seg({ flags: C | A.SEG_FINAL, startDepth: 5, endDepth: 7, dispCode: 0 }), 'c1', T0);
  eq('casual checkpoint continuation [5,7] FINAL (run over at 7)', plan, { ok: true, proven: 5 });
  soloAdvance(st, key, seg({ flags: C | A.SEG_FINAL, startDepth: 5, endDepth: 7 }), 'c1', plan, T0);
  eq('run is final', st.runs[key].final, 1);
  plan = soloChainPlan(st, key, seg({ flags: C | A.SEG_RESUMED, startDepth: 5, endDepth: 9 }), 'c2', T0 + 1000);
  eq('casual token resume from the proven checkpoint 5 AFTER final -> settles, revive, no consume', plan, { ok: true, proven: 5, revive: true });
  const run = soloAdvance(st, key, seg({ flags: C | A.SEG_RESUMED, startDepth: 5, endDepth: 9, continuesUsed: 0 }), 'c2', plan, T0 + 1000);
  eq('revive clears final + the continue ladder restarts (contN 0)', [run.final, run.contN | 0, run.max], [0, 0, 9]);
  eq('casual resume at a non-checkpoint depth -> reject', soloChainPlan(st, key, seg({ flags: C | A.SEG_RESUMED, startDepth: 7, endDepth: 8 }), 'c3', T0 + 2000), { ok: false, reason: 'resume-not-checkpoint' });
  eq('casual resume beyond the proven depth -> waits for its chain', soloChainPlan(st, key, seg({ flags: C | A.SEG_RESUMED, startDepth: 15, endDepth: 16 }), 'c4', T0 + 2000).ok, null);
  eq('competitive resume without a save point still waits (save-orphan) -- the casual rule is flag-gated', soloChainPlan(st, key, seg({ startDepth: 5, endDepth: 6, flags: A.SEG_RESUMED }), 'c5', T0 + 2000).reason, 'save-orphan');
  eq('competitive segment after a FINAL run still rejects (after-final)', soloChainPlan({ runs: { k: { max: 7, final: 1, saves: {} } }, wait: {} }, 'k', seg({ startDepth: 7, endDepth: 8 }), 'c6', T0), { ok: false, reason: 'after-final' });
}

console.log('-- cloud audit R1-A3-02: one save row (resume tag) starts ONE resumed session per run (casual / classic; competitive keeps its save-point rule) --');
{
  // The save box is a client-writable board: the original (pre-tombstone) row bytes can be written back and the guard accepts the row
  //   again. The resumed session's first segment carries the row's tag (attest [21] bits 9..31); a second session from the same tag is
  //   rejected and the run settles nothing more (the replayed timeline could otherwise buy a fresh row and revive the run again).
  const T0 = 3000000;
  for (const [label, FL, sd] of [['classic', A.SEG_CLASSIC, 4], ['casual', A.SEG_CASUAL, 5]]) {
    const st = { runs: {}, wait: {} };
    const key = soloRunKey('p9', 1, 991);
    const go = (f, m, t) => { const p = soloChainPlan(st, key, seg(f), m, t || T0); if (p.ok) soloAdvance(st, key, seg(f), m, p, t || T0); return p; };
    go({ flags: FL, startDepth: 0, endDepth: sd }, label + '-s0');
    go({ flags: FL | A.SEG_FINAL, startDepth: sd, endDepth: sd + 2 }, label + '-s1');   // run over at sd+2
    const TAG = 0x2A5F1;
    let p = go({ flags: FL | A.SEG_RESUMED | A.SEG_FINAL, startDepth: sd, endDepth: sd + 3, resumeTag: TAG }, label + '-r1');
    eq(label + ': first resume from the row (tag) -> settles, revives, records the tag', [p.ok, p.revive, p.rtags, st.runs[key].revs], [true, true, [TAG], { [TAG]: label + '-r1' }]);
    eq(label + ': the SAME segment again (guard retry / re-read shard) -> still ok (idempotent)', soloChainPlan(st, key, seg({ flags: FL | A.SEG_RESUMED | A.SEG_FINAL, startDepth: sd, endDepth: sd + 3, resumeTag: TAG }), label + '-r1', T0).ok, true);
    eq(label + ': a SECOND session from the same row (written back after the tombstone) -> save-reused', soloChainPlan(st, key, seg({ flags: FL | A.SEG_RESUMED, startDepth: sd, endDepth: sd + 4, resumeTag: TAG }), label + '-r2', T0 + 1000), { ok: false, reason: 'save-reused' });
    eq(label + ': the run is burnt -- a fresh row bought in the replayed timeline revives nothing', soloChainPlan(st, key, seg({ flags: FL | A.SEG_RESUMED, startDepth: sd, endDepth: sd + 5, resumeTag: 0x77 }), label + '-r3', T0 + 2000), { ok: false, reason: 'run-burnt' });
    eq(label + ': ... nor any later segment of the run', soloChainPlan(st, key, seg({ flags: FL, startDepth: sd + 3, endDepth: sd + 5 }), label + '-c4', T0 + 2000).reason, 'run-burnt');
  }
  {
    // a token bought AGAIN before the next checkpoint legitimately writes a second row at the same checkpoint (new nonce = new tag)
    const st = { runs: {}, wait: {} }, key = soloRunKey('p9', 1, 992), C = A.SEG_CASUAL;
    const go = (f, m) => { const p = soloChainPlan(st, key, seg(f), m, T0); if (p.ok) soloAdvance(st, key, seg(f), m, p, T0); return p; };
    go({ flags: C, startDepth: 0, endDepth: 5 }, 'k0'); go({ flags: C | A.SEG_FINAL, startDepth: 5, endDepth: 7 }, 'k1');
    go({ flags: C | A.SEG_RESUMED | A.SEG_FINAL, startDepth: 5, endDepth: 8, resumeTag: 0x111 }, 'k2');
    eq('casual: a second row at the same checkpoint (its own tag) -> settles + revives', go({ flags: C | A.SEG_RESUMED, startDepth: 5, endDepth: 9, resumeTag: 0x222 }, 'k3'), { ok: true, proven: 5, revive: true, rtags: [0x222] });
    eq('casual: both tags remembered, run not burnt', [Object.keys(st.runs[key].revs).length, !!st.runs[key].burnt], [2, false]);
  }
  {
    // records from builds before the fix carry no tag (0): accepted exactly as before while the lever is off (the default; the cutover
    //   is the version gate + RESUME_TAG_REQUIRED, see the README). requireTag pinned off here so a flipped job env cannot redden this.
    const st = { runs: {}, wait: {} }, key = soloRunKey('p9', 1, 993), K = A.SEG_CLASSIC;
    const go = (f, m) => { const p = soloChainPlan(st, key, seg(f), m, T0, { requireTag: false }); if (p.ok) soloAdvance(st, key, seg(f), m, p, T0); return p; };
    go({ flags: K, startDepth: 0, endDepth: 4 }, 'o0'); go({ flags: K | A.SEG_FINAL, startDepth: 4, endDepth: 6 }, 'o1');
    eq('untagged resume (older build) -> as before, no rtags', go({ flags: K | A.SEG_RESUMED | A.SEG_FINAL, startDepth: 4, endDepth: 7 }, 'o2'), { ok: true, proven: 4, revive: true });
    eq('untagged second resume (older build) -> as before (not provable)', go({ flags: K | A.SEG_RESUMED, startDepth: 4, endDepth: 8 }, 'o3'), { ok: true, proven: 4, revive: true });
  }
  {
    // RESUME_TAG_REQUIRED (the pre-fix window lever, default off): on = an untagged casual / classic resume is refused; nothing else moves
    for (const [label, FL, sd] of [['classic', A.SEG_CLASSIC, 4], ['casual', A.SEG_CASUAL, 5]]) {
      const st = { runs: {}, wait: {} }, key = soloRunKey('p9', 1, 994);
      const go = (f, m, o) => { const p = soloChainPlan(st, key, seg(f), m, T0, o); if (p.ok) soloAdvance(st, key, seg(f), m, p, T0); return p; };
      go({ flags: FL, startDepth: 0, endDepth: sd }, 'u0', { requireTag: true }); go({ flags: FL | A.SEG_FINAL, startDepth: sd, endDepth: sd + 2 }, 'u1', { requireTag: true });
      eq(label + ' lever on: fresh segments unaffected (the chain above settled)', st.runs[key].max, sd + 2);
      eq(label + ' lever on: untagged resume -> resume-untagged (run not burnt, no tag recorded)', [go({ flags: FL | A.SEG_RESUMED, startDepth: sd, endDepth: sd + 3 }, 'u2', { requireTag: true }), !!st.runs[key].burnt, st.runs[key].revs || null], [{ ok: false, reason: 'resume-untagged' }, false, null]);
      eq(label + ' lever on: a tagged resume still settles', go({ flags: FL | A.SEG_RESUMED, startDepth: sd, endDepth: sd + 3, resumeTag: 0x31 }, 'u3', { requireTag: true }).rtags, [0x31]);
    }
    const stc = { runs: { kc: { max: 10, ms: 0, saves: { 10: { t: T0 } }, t: T0 } }, wait: {} };
    eq('lever on: competitive untagged resume unaffected (its save-point rule)', soloChainPlan(stc, 'kc', seg({ flags: A.SEG_RESUMED, startDepth: 10, endDepth: 12 }), 'uq', T0, { requireTag: true }), { ok: true, proven: 10, consume: '10' });
    const stt = { runs: { tk: { max: 5, ms: 0, saves: {}, t: T0, final: 1 } }, wait: {} };
    eq('lever on: team classic with every writer\'s tag 0 -> resume-untagged', soloChainPlan(stt, 'tk', seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 3, endDepth: 6, resumeTags: [0, 0] }), 'ut', T0, { requireTag: true }).reason, 'resume-untagged');
    eq('lever on: team classic with one writer\'s tag -> settles', soloChainPlan(stt, 'tk', seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 3, endDepth: 6, resumeTags: [0, 0x41] }), 'ut2', T0, { requireTag: true }).rtags, [0x41]);
    eq('lever off (explicit): untagged resume as before', soloChainPlan(stt, 'tk', seg({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 3, endDepth: 6 }), 'ut3', T0, { requireTag: false }), { ok: true, proven: 3, revive: true });
  }
  {
    // competitive keeps its own rule (a save point resumes once, saves[sd].by) and is never burnt by the tag rule
    const st = { runs: { kc: { max: 10, ms: 0, saves: { 10: { t: T0 } }, t: T0 } }, wait: {} };
    const p1 = soloChainPlan(st, 'kc', seg({ flags: A.SEG_RESUMED, startDepth: 10, endDepth: 12, resumeTag: 0x5 }), 'q1', T0);
    soloAdvance(st, 'kc', seg({ flags: A.SEG_RESUMED, startDepth: 10, endDepth: 12 }), 'q1', p1, T0);
    eq('competitive: second resume of the save point -> save-reused (saves[].by), run not burnt', [soloChainPlan(st, 'kc', seg({ flags: A.SEG_RESUMED, startDepth: 10, endDepth: 13, resumeTag: 0x5 }), 'q2', T0), !!st.runs.kc.burnt], [{ ok: false, reason: 'save-reused' }, false]);
  }
  // team lane: every writer's tag counts (the tag is outside the consensus vector; a cold rejoiner writes 0)
  {
    const st = { runs: {}, wait: {} }, key = 'T|x+y|0|5', K = A.SEG_CLASSIC;
    const go = (f, m) => { const p = soloChainPlan(st, key, seg(f), m, T0); if (p.ok) soloAdvance(st, key, seg(f), m, p, T0); return p; };
    go({ flags: K, startDepth: 0, endDepth: 3 }, 't0'); go({ flags: K | A.SEG_FINAL, startDepth: 3, endDepth: 5 }, 't1');
    eq('team classic: writers [0, tag] -> settles with the tag', go({ flags: K | A.SEG_RESUMED | A.SEG_FINAL, startDepth: 3, endDepth: 6, resumeTags: [0, 0x9] }, 't2').rtags, [0x9]);
    eq('team classic: a replay where only ONE writer still reports the tag -> save-reused', soloChainPlan(st, key, seg({ flags: K | A.SEG_RESUMED, startDepth: 3, endDepth: 7, resumeTags: [0x9, 0] }), 't3', T0), { ok: false, reason: 'save-reused' });
  }
  // wiring: the solo lane hands the verified fields (fields.resumeTag) to the planner; the team classic lane passes every writer's tag
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  assert('team classic settle passes every writer\'s resume tag to the planner', /resumeTags: g\.map\(r => \{ const tr = endlessTail\(r\.d\); return tr \? tr\.resumeTag : 0; \}\)/.test(src));
  assert('the solo settle plans on the verified fields (resumeTag comes from attest.verifySoloRecord)', /const f = v\.fields;/.test(src) && /resumeTag: \(d\[21\] >>> RESUME_TAG_SHIFT\) & RESUME_TAG_MASK/.test(require('fs').readFileSync(path.join(__dirname, '..', 'attest.js'), 'utf8')));
  assert('soloAdvance records the tags of a settled resume (run.revs)', /run\.revs\[t\] = m/.test(src));
  assert('lever reads its own env, default off', /const RESUME_TAG_REQUIRED = process\.env\.RESUME_TAG_REQUIRED === '1';/.test(src) && /: RESUME_TAG_REQUIRED;/.test(src));
  assert('both rejects feed the counter + row-owner signal (solo: the account; team classic: seat 0)', /noteResumeRule\(plan\.reason, casual \|\| classic, sid\);/.test(src) && /noteResumeRule\(plan\.reason, true, rosterSids\[0\]\);/.test(src));
  const nrr = /const noteResumeRule = [\s\S]*?\n  \};/.exec(src);
  assert('the signal is record-only (rv on the owner, never recordFlag / the trust flag counter)', !!nrr && /sp\.rv = \(sp\.rv \| 0\) \+ 1/.test(nrr[0]) && !/recordFlag|\.f \+=/.test(nrr[0]));
  assert('settled untagged resumes counted on both lanes (the lever\'s flip signal)', (src.match(/if \(untaggedResume\(f\)\) RUN\.resumeUntagged = /g) || []).length === 2);
  assert('step summary row carries the four counts', /token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused/.test(src) && /s\('resumeReplay', 0\)/.test(src) && /s\('resumeUntaggedRej', 0\)/.test(src));
  eq('endlessTail reads the optional 12th int (absent = 0)', [v.endlessTail([0xB1, 3, 7, 1, 2, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 0, 0, 1, 32, 0, 0, 0, 0, 0]).resumeTag, v.endlessTail([0xB1, 3, 7, 1, 2, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3, 6, 0, 0, 1, 32, 0, 0, 0, 0, 0, 0x9]).resumeTag], [0, 0x9]);
}

console.log('-- board surface --');
{
  const plan = ptBoardPlan([], { prefix: 'rec_', shards: 1, xpLb: 'xpb', cpLb: 'cpb', endlessLb: 'enb', endlessTrioLb: 'entb', trustLb: 'trb', reportLb: 'rpb', compLb: 'cmp', saveBoxLb: 'sbx',
    compDuoLb: 'cmp2', saveBoxDuoLb: 'sbx2', compTrioLb: 'cmp3', saveBoxTrioLb: 'sbx3', endlessSoloLb: 'ens', saveBoxCasualLb: 'sbxc' });
  const byName = {}; for (const b of plan.create) byName[b.name] = b.trusted;
  eq('playtest plan provisions the solo ladder (trusted) + save box (client-writable)', [byName.cmp, byName.sbx], [1, 0]);
  eq('playtest plan provisions the team ladders (trusted) + their save boxes (client-writable)', [byName.cmp2, byName.sbx2, byName.cmp3, byName.sbx3], [1, 0, 1, 0]);
  eq('playtest plan provisions the casual solo ladder (trusted) + casual save box (client-writable) [O218]', [byName.ens, byName.sbxc], [1, 0]);
}

console.log('-- wiring pins --');
{
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  assert('main app provisions the solo ladder + save box up-front (before the fresh-match early returns)',
    /for \(const \[nm, trusted\] of \[\[ENDLESS_COMP_LB, true\], \[SAVE_BOX_LB, false\], \[ENDLESS_COMP_LB_DUO, true\], \[SAVE_BOX_LB_DUO, false\], \[ENDLESS_COMP_LB_TRIO, true\], \[SAVE_BOX_LB_TRIO, false\], \[ENDLESS_COMP_LB_QUAD, true\], \[SAVE_BOX_LB_QUAD, false\], \[ENDLESS_COMP_LB_OVERALL, true\], \[ENDLESS_LB_SOLO, true\], \[SAVE_BOX_LB_CASUAL, false\],/.test(src) && src.indexOf('solo boards: provisioned') < src.indexOf('no consistent matches'));   // + overall ladder (knife 3.5d) + quad family (client knife 3.7a) + classic surface continues the list (client knife 3.9b N3)
  assert('solo segments enter the settle loop as their own consistent entries (every pc=1 record of the group; audit B-F10)', /consistentMatches\.push\(\{ m, g: solos, void: false, solo: true \}\)/.test(src) && /if \(c\.solo\) \{ if \(await soloSettle\(c\)\) settledSolo\+\+; continue; \}/.test(src));
  assert('solo settle verifies the signature and binds the row owner (first verifying candidate wins)', /attest\.soloSettleGate\(cv, \{ owner: String\(cand\.steamID\), allowDevKey: soloAllowDev \}\)/.test(src) && /if \(!v \|\| cg\.settle \|\| cg\.pending\) \{ r = cand;/.test(src));
  assert('audit B-F9: inside the seedcap reject window the chain still advances, only the outputs are discarded', /inside seedcap reject window -- own settlement discarded \(chain advanced to/.test(src) && (src.match(/soloAdvance\(soloState, key, f, m, plan, nowMs\);/g) || []).length >= 2);
  assert('audit B-F4: solo ladder paging joins the on-demand base-read rule', /compComplete = br\.complete !== false/.test(src) && /readUserEntry\(compId, sid, 'solo comp'\)/.test(src) && /\|\| \(compId && !compComplete\) \|\| \(compSeasonId && !compSeasonComplete\)/.test(src));
  assert('a save point is consumed once and the resume debit rides the consume', /if \(plan\.consume\) \{[\s\S]{0,120}COMP\.RESUME_CP/.test(src));
  // perk replay (2026-09-07): every endless lane verifies the tail's pick log against its build (solo + team comp with the
  //   run's chain memory, casual co-op without), rejects are processed like chain rejects, and the memory keeps the log
  assert('perk replay wired into the solo lane (chain memory) + team comp lane + casual lane; rejects processed',
    /perks\.verifyPerkPicks\(f, soloState\.runs\[key\], 1\)/.test(src) && /perks\.verifyPerkPicks\(f, soloState\.runs\[key\], pc7\)/.test(src)
    && /perks\.verifyPerkPicks\(\{ build: t\.build >>> 0, picksLo: t\.picksLo \| 0, picksHi: t\.picksHi \| 0, seasonId: t\.seasonId \| 0, endDepth: t\.endDepth \| 0 \}, null, pc7\)/.test(src)
    && (src.match(/perk REJECT \(/g) || []).length === 3 && /run\.pk = \{ lo: f\.picksLo \| 0, hi: f\.picksHi \| 0 \}/.test(src));
}
console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (solo-settle) ===');
if (failN) process.exit(1);
