'use strict';
// O462 (2026-10-21): the start-proof step in validate.js (applyStartProof), in memory, both modes.
//   A matchmade start record (version 2) carries the host's random n in a block after its roster; the match id and the seed
//   are cut from sha256(n + seat count + roster) (start-proof.js). A start whose block binds its matchHash and seed and seats
//   its writer at the seat he writes from proves the key's table T; on a proven key the records of accounts T does not seat
//   count nowhere, a seated account's start naming another table or seat is left out, the note keeps only T's ids, a
//   provisional roster that is not T becomes T, and a contest made only by accounts off T is withdrawn. Observe mode (the
//   default until START_PROOF_GATE=1) counts all that and changes nothing.
//   [1] proofState: ok / none / bad (a copied block at another seat, a block of another roster, a cut block)
//   [2] observe: an outside start and result on a proven 1V1 are counted (pf), nothing dropped, no note written
//   [3] enforce: the outside start and result dropped; the players' records kept; the note keeps pt
//   [4] enforce: a seated account's start naming another table (pr) or another seat (ps) dropped, his result kept; a seated
//       start without the block (none) or with a broken one (bad) on the same table kept
//   [5] a later run with no ok start: the note's pt proves the key; an outside start dropped, an honest unblocked start kept
//   [6] note repairs: s / lo keep T's ids only; n goes when every writer that set it is off T, stays when one is on T or the
//       room overflowed; a provisional roster that is not T becomes T (t0 kept, started filtered); a contest whose parties
//       are all off T is withdrawn, not when one party is on T, w is empty or full
//   [7] no proof (version 1 starts only), a processed key, a friends' room key: nothing changes, nothing counted as proven
//   [8] fork: the note's pt names another table than this run's ok start -> today's rules, nothing dropped
//   [9] with screenLateStarts after it: the note's s holds the players' ids only; a writer past his room is remembered (nw)
//   [10] mutants: the off-table check off; the note's pt ignored; observe that changes records -- each turns a case red
const fs = require('fs'), path = require('path'), crypto = require('crypto'), Module = require('module');
for (const k of ['START_PROOF_GATE', 'PT_MODE', 'GITHUB_STEP_SUMMARY']) delete process.env[k];
process.env.STATE_SALT = 's';
const VPATH = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VPATH, 'utf8');
function load(src) { const m = new Module(VPATH, module); m.filename = VPATH; m.paths = Module._nodeModulePaths(path.dirname(VPATH)); m._compile(src, VPATH); return m.exports; }
const v = require(VPATH);
const SP = v.startProof;
const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const enc = (sid) => { const b = BigInt(String(sid)); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SID = (k) => String(76561198000000000n + BigInt(k));
const W = SID(11), L = SID(22), O = SID(99), O2 = SID(98), X = SID(33), Y = SID(44);
const N1 = '0123456789abcdef0123456789abcdef';
const roInts = (sids) => [].concat(...sids.map(enc));
// the host's commitment for a table (sids by seat) -> { mh, seed }
function commit(n, sids) { const m = SP.bind(n, sids.length, roInts(sids), sha); return { mh: SP.hash32(m.matchId), seed: m.runSeed }; }
// a start record as validate.js reads it: { d, steamID, roster, start, shard }
function start(key, sids, seat, writer, tail) {
  const pc = sids.length, d = [0xB2, tail ? 2 : 1, key.mt, key.mh, key.seed, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  const out = d.concat(roInts(sids), tail || []);
  return { d: out, steamID: writer, roster: v.decodeRoster(out), start: true, shard: 'lbtest_pool' };
}
function result(key, sids, seat, writer) {
  const pc = sids.length, d = [0xB1, 3, key.mt, key.mh, key.seed, seat, 1, 1, pc, 60];
  for (let i = 0; i < pc; i++) d.push(100 * (i + 1));
  d.push(0);
  const out = d.concat(roInts(sids));
  return { d: out, steamID: writer, roster: v.decodeRoster(out), shard: 'lbtest_pool' };
}
const keyStr = (k) => k.mh + '_' + k.seed + '_' + k.mt;
const P = (sid) => v.pid(String(sid));
const quiet = (fn) => { const o = console.log; console.log = () => {}; try { return fn(); } finally { console.log = o; } };

console.log('=== O462 start-proof step (validate.js applyStartProof) ===');
const K = Object.assign({ mt: 2 }, commit(N1, [W, L]));   // a ranked 1V1, table [W, L]
const M = keyStr(K);
const tailN = SP.tail(N1);
// [1]
{
  T('[1] the winner\'s own start with its block: ok', v.proofState(start(K, [W, L], 0, W, tailN)) === 'ok');
  T('[1] the loser\'s own start with the same block: ok', v.proofState(start(K, [W, L], 1, L, tailN)) === 'ok');
  T('[1] a start without the block: none', v.proofState(start(K, [W, L], 1, L, null)) === 'none');
  T('[1] the block copied by an outside account at the loser\'s seat (roster names L there): bad', v.proofState(start(K, [W, L], 1, O, tailN)) === 'bad');
  T('[1] the block copied onto another roster (O seated): bad', v.proofState(start(K, [W, O], 1, O, tailN)) === 'bad');
  T('[1] a cut block: none', v.proofState(start(K, [W, L], 0, W, tailN.slice(0, 3))) === 'none');
}
// [2] observe
{
  const starts = [start(K, [W, L], 0, W, tailN), start(K, [W, O], 1, O, null)];
  const recs = [result(K, [W, L], 0, W), result(K, [W, O], 1, O)];
  const pending = {}, before = J({ starts, recs });
  const r = quiet(() => v.applyStartProof(starts, recs, pending, new Set(), 1000, false));
  T('[2] observe: proven, the outside start and result counted (pf 2)', r.mode === 'observe' && r.proven === 1 && r.ok === 1 && r.none === 1 && r.pf === 2, J(r));
  T('[2] observe: records unchanged, no note written', J({ starts, recs }) === before && J(pending) === '{}');
}
// [3] enforce
{
  const starts = [start(K, [W, L], 0, W, tailN), start(K, [W, L], 1, L, tailN), start(K, [W, O], 1, O, null)];
  const recs = [result(K, [W, L], 0, W), result(K, [W, O], 1, O)];
  const pending = {};
  const r = quiet(() => v.applyStartProof(starts, recs, pending, new Set(), 1000, true));
  T('[3] enforce: the outside start and result dropped, the players\' kept', starts.length === 2 && starts.every((x) => x.steamID !== O) && recs.length === 1 && recs[0].steamID === W, J(r));
  const pt = pending['~' + M] && pending['~' + M].pt;
  T('[3] enforce: the note keeps pt (seat count, roster canon of pids, n\'s first 8)', pt && pt.pc === 2 && pt.c === '0:' + P(W) + ',1:' + P(L) && pt.n === N1.slice(0, 8), J(pt));
}
// [4] seated accounts' own starts
{
  const starts = [
    start(K, [W, L], 0, W, tailN),
    start(K, [W, X], 1, L, null),        // L names another table (pr)
    start(K, [W, L], 0, L, null),        // L writes from W's seat (ps)
    start(K, [W, L], 1, L, null),        // L without the block (none): kept
    start(K, [W, L], 1, L, SP.tail('f'.repeat(32))),   // L with a block of another n (bad): kept
  ];
  const recs = [result(K, [W, X], 1, L)];
  const r = quiet(() => v.applyStartProof(starts, recs, {}, new Set(), 1000, true));
  T('[4] pr and ps counted and dropped', r.pr === 1 && r.ps === 1 && r.pf === 0, J(r));
  T('[4] the seated none / bad starts on the table kept, the winner\'s kept', starts.length === 3 && starts.filter((x) => x.steamID === L).length === 2, J(starts.map((x) => x.d[5] + ':' + x.steamID.slice(-2))));
  T('[4] his result kept (a missing start convicts nobody)', recs.length === 1);
}
// [5] pt carries the proof to a later run
{
  const pending = { ['~' + M]: { t0: 1, s: [], r: 0, c: 0, pt: { pc: 2, c: '0:' + P(W) + ',1:' + P(L), n: N1.slice(0, 8) } } };
  const starts = [start(K, [W, O], 1, O, null), start(K, [W, L], 1, L, null)];
  const r = quiet(() => v.applyStartProof(starts, [], pending, new Set(), 2000, true));
  T('[5] no ok start this run: the note proves the key, the outside start dropped, the honest unblocked one kept', r.proven === 1 && r.ok === 0 && r.pf === 1 && starts.length === 1 && starts[0].steamID === L, J(r));
}
// [6] note repairs
{
  const own = v.startSeenId(start(K, [W, L], 0, W, null)), ownL = v.startSeenId(start(K, [W, L], 1, L, null));
  const outS = v.startSeenId(start(K, [W, O], 1, O, null)), outLo = v.startSeenId(start(K, [O, O2], 0, O, null));
  const mk = (extra) => Object.assign({ t0: 5, s: [own, outS], r: 0, c: 0, lo: [outLo, ownL] }, extra);
  const run = (note, p, observe) => { const pending = { ['~' + M]: note }; if (p) pending[M] = p; const r = quiet(() => v.applyStartProof([start(K, [W, L], 0, W, tailN)], [], pending, new Set(), 9000, !observe)); return { r, pending }; };
  {
    const { r, pending } = run(mk({}));
    const e = pending['~' + M];
    T('[6] s and lo keep T\'s ids only', J(e.s) === J([own]) && J(e.lo) === J([ownL]) && r.scrub === 1, J(e));
  }
  {
    const { pending } = run(mk({ n: 1, nw: [P(O), P(O2)] }));
    T('[6] n set by accounts off T only: cleared (with nw)', !pending['~' + M].n && !pending['~' + M].nw);
    const b = run(mk({ n: 1, nw: [P(O), P(L)] })).pending['~' + M];
    T('[6] n with a writer on T: stays', b.n === 1);
    const c = run(mk({ n: 1, nwx: 1 })).pending['~' + M];
    T('[6] n after the writers overflowed (nwx): stays', c.n === 1);
  }
  {
    const outSig = v.startSig(start(K, [W, O], 0, W, null));
    const p = { t0: 77, mt: 2, roster: { 0: P(W), 1: P(O) }, settled: [], prov: outSig, started: [P(W), P(O)] };
    const { r, pending } = run(mk({}), p);
    const q = pending[M], Tsig = v.proofTable(2, '0:' + P(W) + ',1:' + P(L)).sig;
    T('[6] a provisional roster that is not T becomes T (t0 kept, started filtered)', r.reseat === 1 && q.prov === Tsig && q.roster[1] === P(L) && q.t0 === 77 && J(q.started) === J([P(W)]), J(q));
    T('[6] the proven table\'s sig is the one startSig gives an honest start', Tsig === v.startSig(start(K, [W, L], 1, L, null)));
    const fin = run(mk({}), { t0: 77, mt: 2, roster: { 0: P(W), 1: P(O) }, settled: [] }).pending[M];
    T('[6] a final roster is left as it is', fin.roster[1] === P(O) && !fin.prov);
    const split = run(mk({}), { t0: 77, mt: 2, roster: { 0: P(W) }, settled: [], split: 1, prov: outSig }).pending[M];
    T('[6] a split entry is left as it is', split.split === 1 && split.prov === outSig);
  }
  {
    const a = run(mk({ c: 1, w: [P(O) + 'x', P(O2) + 'o'] }));
    T('[6] a contest by accounts off T only: withdrawn', a.pending['~' + M].c === 0 && a.r.uncontest === 1);
    T('[6] a contest with a party on T: stays', run(mk({ c: 1, w: [P(O) + 'x', P(L) + 'o'] })).pending['~' + M].c === 1);
    T('[6] a contest with no parties noted: stays', run(mk({ c: 1 })).pending['~' + M].c === 1);
    T('[6] a contest whose parties are full (CONTEST_PARTY_CAP): stays', run(mk({ c: 1, w: Array.from({ length: 8 }, (_, i) => P(SID(500 + i)) + 'x') })).pending['~' + M].c === 1);
    const o = run(mk({ c: 1, w: [P(O) + 'x'], n: 1, nw: [P(O)] }), null, true);
    T('[6] observe: every repair counted, none made', o.r.uncontest === 1 && o.r.scrub === 1 && o.r.unroom === 1 && o.pending['~' + M].c === 1 && o.pending['~' + M].n === 1 && o.pending['~' + M].s.length === 2 && !o.pending['~' + M].pt, J(o.r));
  }
}
// [7] no proof / processed / friends' room
{
  const K1 = { mt: 2, mh: 12345, seed: 678 }, M1 = keyStr(K1);
  const s1 = [start(K1, [W, L], 0, W, null), start(K1, [W, O], 1, O, null)];
  const r1 = quiet(() => v.applyStartProof(s1, [], {}, new Set(), 1, true));
  T('[7] version 1 starts only: nothing proven, nothing dropped', r1.proven === 0 && r1.pf === 0 && s1.length === 2, J(r1));
  const s2 = [start(K, [W, L], 0, W, tailN), start(K, [W, O], 1, O, null)];
  const r2 = quiet(() => v.applyStartProof(s2, [], {}, new Set([M]), 1, true));
  T('[7] a processed key: skipped', r2.keys === 0 && s2.length === 2);
  const KP = Object.assign({}, K, { mt: 10 });
  const s3 = [start(KP, [W, L], 0, W, tailN), start(KP, [W, O], 1, O, null)];
  const r3 = quiet(() => v.applyStartProof(s3, [], {}, new Set(), 1, true));
  T('[7] a friends\' room key: not looked at', r3.keys === 0 && s3.length === 2);
  T('[7] (unused key)', !!M1);
}
// [8] fork
{
  const pending = { ['~' + M]: { t0: 1, s: [], r: 0, c: 0, pt: { pc: 2, c: '0:' + P(W) + ',1:' + P(X), n: 'deadbeef' } } };
  const starts = [start(K, [W, L], 0, W, tailN), start(K, [W, O], 1, O, null)];
  const r = quiet(() => v.applyStartProof(starts, [], pending, new Set(), 1, true));
  T('[8] the note\'s table differs from this run\'s proven one: fork, today\'s rules (nothing dropped, pt unchanged)', r.fork === 1 && r.proven === 0 && starts.length === 2 && pending['~' + M].pt.c.indexOf(P(X)) > 0, J(r));
}
// [9] with screenLateStarts after it
{
  const starts = [start(K, [W, L], 0, W, tailN), start(K, [W, L], 1, L, tailN), start(K, [W, O], 1, O, null)];
  const pending = {};
  quiet(() => { v.applyStartProof(starts, [], pending, new Set(), 1000, true); v.screenLateStarts(starts, [], pending, new Set(), 1000, true); });
  const s = pending['~' + M].s;
  T('[9] the note\'s s holds the two players\' ids only', s.length === 2 && s.every((id) => id.indexOf(P(O)) !== 0), J(s));
  // a writer past his room (Q144): remembered in nw
  const K2 = Object.assign({ mt: 1 }, commit(N1, [O, X])), M2 = keyStr(K2);
  const pend2 = {};
  for (let i = 0; i < 64; i++) pend2['~k' + i] = { t0: 1, s: [P(O) + '@0#aaaaaaaaaaaa'], r: 0, c: 0 };
  quiet(() => v.screenLateStarts([start(K2, [O, X], 0, O, null)], [], pend2, new Set(), 1000, true));
  T('[9] a start past its writer\'s room: n set, its writer remembered (nw)', pend2['~' + M2].n === 1 && J(pend2['~' + M2].nw) === J([P(O)]), J(pend2['~' + M2]));
}
// [10] mutants
{
  // an outside start is also caught by the table / seat checks; the off-table rule is what drops an outside RESULT
  const runCase3 = (vv) => { const recs = [result(K, [W, L], 0, W), result(K, [W, O], 1, O)]; quiet(() => vv.applyStartProof([start(K, [W, L], 0, W, tailN)], recs, {}, new Set(), 1000, true)); return recs.length; };
  const m1 = SRC.replace("for (const r of byKey[m].r) if (!T.pids.has(pid(String(r.steamID))))", 'for (const r of byKey[m].r) if (false)');
  T('[10] mutant: the off-table check on results off -> the outside result stays', m1 !== SRC && runCase3(load(m1)) === 2 && runCase3(v) === 1);
  const m2 = SRC.replace("} else if (pt) { T = proofTable(pt.pc, pt.c); T.n8 = pt.n; }", '}');
  const case5 = (vv) => { const pending = { ['~' + M]: { t0: 1, s: [], r: 0, c: 0, pt: { pc: 2, c: '0:' + P(W) + ',1:' + P(L), n: N1.slice(0, 8) } } }; const starts = [start(K, [W, O], 1, O, null)]; quiet(() => vv.applyStartProof(starts, [], pending, new Set(), 2000, true)); return starts.length; };
  T('[10] mutant: the note\'s pt ignored -> [5] keeps the outside start', m2 !== SRC && case5(load(m2)) === 1 && case5(v) === 0);
  const m3 = SRC.replace('if (on && drop.size) {', 'if (drop.size) {');
  const obs = (vv) => { const starts = [start(K, [W, L], 0, W, tailN), start(K, [W, O], 1, O, null)]; quiet(() => vv.applyStartProof(starts, [], {}, new Set(), 1000, false)); return starts.length; };
  T('[10] mutant: observe that drops -> [2] sees records change', m3 !== SRC && obs(load(m3)) === 1 && obs(v) === 2);
}

console.log(failN ? ('start-proof-step: ' + failN + ' FAIL') : 'start-proof-step: all ok');
process.exit(failN ? 1 : 0);
