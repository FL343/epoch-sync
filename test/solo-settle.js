'use strict';
// O93 solo competitive endless settle (knife 3.3a, 2026-09-06): the pure half of the pc=1 lane in validate.js --
//   chain rules (checkpoint continuation / save-point resume once / replay & after-final rejects / wait window),
//   structural sanity on a verified segment, milestone CP once per run, resume debit constant, the single-attester
//   start registration, the board surface (playtest plan + names) and the save-box header reader.
const path = require('path');
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));
const { COMP, ENDLESS_COMP_LB, SAVE_BOX_LB, SOLO_FILE, soloSanity, soloChainPlan, soloMilestones, soloAdvance, soloRunKey, soloStartAttested,
  reconcileStarts, ptBoardPlan, decodeRoster, endlessRequiredMs, ENDLESS, pid } = v;

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
  soloAdvance(st, key, seg({ startDepth: 0, endDepth: 5 }), 'm0', plan, T0);
  eq('run memory after seg0', [st.runs[key].max, st.runs[key].seg0, st.runs[key].final || 0], [5, 1, 0]);
  plan = soloChainPlan(st, key, seg({ startDepth: 5, endDepth: 10 }), 'm1', T0);
  eq('checkpoint continuation settles, proven = its startDepth', plan, { ok: true, proven: 5 });
  soloAdvance(st, key, seg({ startDepth: 5, endDepth: 10 }), 'm1', plan, T0);
  eq('replayed depth-0 segment on the same run -> restart (reject)', soloChainPlan(st, key, seg({ startDepth: 0, endDepth: 5 }), 'mX', T0), { ok: false, reason: 'restart' });
  eq('out-of-order later segment waits for its predecessor (chain-gap)', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0), { ok: null, reason: 'chain-gap' });
  assert('wait clock stamped on first sighting', st.wait.m3 && st.wait.m3.t0 === T0);
  eq('still waiting inside the window', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0 + COMP.CHAIN_WAIT_MS - 1), { ok: null, reason: 'chain-gap' });
  eq('window elapsed -> chain-gap reject', soloChainPlan(st, key, seg({ startDepth: 15, endDepth: 20 }), 'm3', T0 + COMP.CHAIN_WAIT_MS + 1), { ok: false, reason: 'chain-gap' });
  eq('a segment behind the chain head -> chain-back', soloChainPlan(st, key, seg({ startDepth: 5, endDepth: 10 }), 'mY', T0), { ok: false, reason: 'chain-back' });
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

console.log('-- milestones (once per run) + resume debit + pacing --');
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

console.log('-- board surface --');
{
  const plan = ptBoardPlan([], { prefix: 'rec_', shards: 1, xpLb: 'xpb', cpLb: 'cpb', endlessLb: 'enb', endlessTrioLb: 'entb', trustLb: 'trb', reportLb: 'rpb', compLb: 'cmp', saveBoxLb: 'sbx' });
  const byName = {}; for (const b of plan.create) byName[b.name] = b.trusted;
  eq('playtest plan provisions the solo ladder (trusted) + save box (client-writable)', [byName.cmp, byName.sbx], [1, 0]);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (solo-settle) ===');
if (failN) process.exit(1);
