'use strict';
// Same-tick segment ordering (2026-09-09): endless segments of one run that land in the same cron tick must be
//   visited predecessor-first (checkpoint [0,5] -> save [5,5] -> resumed [5,7]) because the chain memory is
//   updated synchronously inside the settle loop. Pins: the comparator, the endless/non-endless split (non-endless
//   prefix keeps key order), the solo lane, the wiring (fresh.sort uses it), and an end-to-end chain replay proving
//   a resumed segment whose predecessor arrived in the same tick settles that tick instead of waiting.
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));
const { segStartOf, freshOrder, soloChainPlan, soloAdvance, teamRunKey, decodeRoster, COMP } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const SA = '76561198000000001', SB = '76561198000000002';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-7 record: 10 header + pc scores + disp + 2*pc roster + tail (start, end, cont, tokens, season, flags)
function mk7(writer, seat, o) {
  o = o || {};
  const pc = o.pc == null ? 2 : o.pc;
  const d = [0xB1, 3, o.mt == null ? 7 : o.mt, 222, 9, seat, 0, 0, pc, 1200];
  for (let i = 0; i < pc; i++) d.push(4000 - 500 * i);
  d.push(0);
  const ros = o.rosterSids || [SA, SB].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  if (!o.noTail) d.push(o.startDepth | 0, o.endDepth | 0, 0, 0, 1, o.flags | 0);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: 0 };
}
// a non-endless (quick, mt 1) record: 10 header + 2 scores + disp + roster; no tail at all
function mk1(writer, seat) {
  const d = [0xB1, 3, 1, 222, 9, seat, 0, 0, 2, 900, 3000, 2500, 0];
  for (const sid of [SA, SB]) { const p = sidPair(sid); d.push(p[0], p[1]); }
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: 0 };
}
const grp = (m, ...rs) => ({ m, g: rs, void: false });

console.log('=== same-tick segment ordering ===');

console.log('-- [1] segStartOf --');
eq('non-endless group -> -1', segStartOf(grp('q1', mk1(SA, 0), mk1(SB, 1))), -1);
eq('endless checkpoint [0,5] -> 0', segStartOf(grp('m1s0', mk7(SA, 0, { startDepth: 0, endDepth: 5 }), mk7(SB, 1, { startDepth: 0, endDepth: 5 }))), 0);
eq('endless resumed [5,7] -> 5', segStartOf(grp('m2s0', mk7(SA, 0, { startDepth: 5, endDepth: 7, flags: A.SEG_COMP | A.SEG_RESUMED }))), 5);
eq('endless with no tail (older writer) -> 0', segStartOf(grp('m3', mk7(SA, 0, { noTail: true }))), 0);
eq('solo lane (pc=1) reads the same tail', segStartOf({ m: 's1', g: [mk7(SA, 0, { pc: 1, rosterSids: [SA], startDepth: 10, endDepth: 15 })], solo: true }), 10);
eq('empty / malformed group -> -1', [segStartOf(null), segStartOf({ m: 'x', g: [] }), segStartOf({ m: 'y', g: [{ steamID: SA }] })], [-1, -1, -1]);

console.log('-- [2] freshOrder --');
{
  // the resumed segment's matchId sorts BEFORE its predecessors by key -- the exact case the key order got wrong
  const chk = grp('zz-run1-s0', mk7(SA, 0, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }), mk7(SB, 1, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }));
  const sav = grp('zz-run1-s1', mk7(SA, 0, { startDepth: 5, endDepth: 5, flags: A.SEG_COMP | A.SEG_SUSPENDED }), mk7(SB, 1, { startDepth: 5, endDepth: 5, flags: A.SEG_COMP | A.SEG_SUSPENDED }));
  const res = grp('aa-run2-s0', mk7(SA, 0, { startDepth: 5, endDepth: 7, flags: A.SEG_COMP | A.SEG_RESUMED }), mk7(SB, 1, { startDepth: 5, endDepth: 7, flags: A.SEG_COMP | A.SEG_RESUMED }));
  const q1 = grp('mm-quick', mk1(SA, 0), mk1(SB, 1)), q2 = grp('ab-quick', mk1(SA, 0), mk1(SB, 1));
  const sorted = [res, q1, sav, chk, q2].sort(freshOrder).map(c => c.m);
  eq('non-endless keep key order in front; endless by startDepth, endDepth, resumed-last', sorted, ['ab-quick', 'mm-quick', 'zz-run1-s0', 'zz-run1-s1', 'aa-run2-s0']);
  assert('comparator is antisymmetric on the endless pair', freshOrder(chk, res) < 0 && freshOrder(res, chk) > 0);
  assert('same startDepth: the save [5,5] precedes the resumed [5,7] despite the key order (aa- < zz-)', freshOrder(sav, res) < 0 && freshOrder(res, sav) > 0);
  // a resume that died on its first level is a [5,5] too -- the RESUMED flag alone puts it after the save it consumes
  const resDead = grp('aa-run2-s0', mk7(SA, 0, { startDepth: 5, endDepth: 5, flags: A.SEG_COMP | A.SEG_RESUMED | A.SEG_FINAL }));
  assert('same [5,5]: suspended save before the resumed-and-final segment', freshOrder(sav, resDead) < 0 && freshOrder(resDead, sav) > 0);
  assert('two plain segments at one depth fall back to key order', freshOrder(grp('b', mk7(SA, 0, { startDepth: 5, endDepth: 10 })), grp('a', mk7(SA, 0, { startDepth: 5, endDepth: 10 }))) > 0);
  assert('equal groups compare 0', freshOrder(chk, chk) === 0);
  eq('segOrderOf shape', v.segOrderOf(res), { sd: 5, ed: 7, rs: 1 });
  eq('segOrderOf non-endless -> null', v.segOrderOf(q1), null);
  // legacy order was pure key order: the resumed segment came first -> chain-gap wait. Pin that the new order differs on this input.
  const legacy = [res, q1, sav, chk, q2].sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0)).map(c => c.m);
  assert('legacy key order visited the resumed segment first (the defect)', legacy[0] === 'aa-run2-s0');
}

console.log('-- [3] chain replay: predecessor + resumed in one tick --');
{
  const now = 1700000000000;
  const key = teamRunKey([SA, SB], 1, 9);
  const seg = (m, sd, ed, flags) => ({ m, f: { startDepth: sd, endDepth: ed, flags, seasonId: 1 } });
  const chk = seg('zz-run1-s0', 0, 5, A.SEG_COMP), sav = seg('zz-run1-s1', 5, 5, A.SEG_COMP | A.SEG_SUSPENDED), res = seg('aa-run2-s0', 5, 7, A.SEG_COMP | A.SEG_RESUMED);
  const replay = (order) => {
    const st = { runs: {}, wait: {}, ms: {} };
    const out = [];
    for (const s of order) {
      const plan = soloChainPlan(st, key, s.f, s.m, now);
      out.push(s.m + ':' + (plan.ok === null ? 'wait(' + plan.reason + ')' : plan.ok ? 'ok' : 'REJECT(' + plan.reason + ')'));
      if (plan.ok) soloAdvance(st, key, s.f, s.m, plan, now);
    }
    return out;
  };
  const byKey = [chk, sav, res].map(s => ({ m: s.m, g: [mk7(SA, 0, { startDepth: s.f.startDepth, endDepth: s.f.endDepth, flags: s.f.flags })], f: s.f }));
  const legacyOrder = byKey.slice().sort((a, b) => (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
  const newOrder = byKey.slice().sort(freshOrder);
  eq('legacy key order: resumed segment waits (save-orphan) though its save landed in the same tick', replay(legacyOrder), ['aa-run2-s0:wait(save-orphan)', 'zz-run1-s0:ok', 'zz-run1-s1:ok']);
  eq('startDepth order: all three settle in one tick (checkpoint -> save -> resumed consumes the save)', replay(newOrder), ['zz-run1-s0:ok', 'zz-run1-s1:ok', 'aa-run2-s0:ok']);
}

console.log('-- [4] wiring --');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  assert('fresh.sort(freshOrder) is the one sort of the fresh list', /\n  fresh\.sort\(freshOrder\);/.test(src) && !/fresh\.sort\(\(a, b\) =>/.test(src));
  assert('freshOrder / segStartOf / segOrderOf exported', typeof v.freshOrder === 'function' && typeof v.segStartOf === 'function' && typeof v.segOrderOf === 'function');
  assert('COMP.CHAIN_WAIT_MS is what a mis-ordered tick used to burn', (COMP.CHAIN_WAIT_MS | 0) > 0);
}

console.log(failN ? ('FAILED ' + failN) : 'ALL OK');
process.exit(failN ? 1 : 0);
