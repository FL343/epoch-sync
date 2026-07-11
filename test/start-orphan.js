'use strict';
// reconcileStarts: start-attestation (0xB2) pending tracking + all-absent maturity verdicts.
const path = require('path');
const { reconcileStarts, pid, START_MAGIC } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', X = '76561198000099999';
const HOUR = 3600 * 1000, MAT = 2 * HOUR;
// start record: only the fields reconcileStarts reads (d[2]=mt d[3]=hash d[4]=seed) + roster + writer
const mkStart = (writer, roster, hash, seed, mt) => { const d = []; d[2] = (mt == null ? 2 : mt); d[3] = (hash == null ? 111 : hash); d[4] = (seed == null ? 7 : seed); return { start: true, steamID: writer, d, roster }; };
const mkSettle = (writer) => ({ steamID: writer, d: [] });   // upkeep only reads groups[m][i].steamID
const KEY = '111_7_2';

console.log('=== reconcileStarts (B7 start/settle cross-check) ===');

{ // register: 2 attesters, consistent roster -> pending with de-identified roster; no verdict before maturity
  const pending = {}, leavers = {}, processed = new Set();
  const starts = [mkStart(A, { 0: A, 1: B, 2: C }), mkStart(B, { 0: A, 1: B, 2: C })];
  const r = reconcileStarts(starts, {}, new Set(), processed, pending, leavers, 1000, MAT);
  eq('registered', r.registered, 1);
  eq('pending roster = pids of 3 seats', pending[KEY].roster, { 0: pid(A), 1: pid(B), 2: pid(C) });
  eq('t0 = first-seen now', pending[KEY].t0, 1000);
  eq('no verdict yet (immature)', r.convicted, 0);
  eq('leavers untouched', leavers, {});
}
{ // lone attestation -> ignored (convicts nobody)
  const pending = {};
  reconcileStarts([mkStart(A, { 0: A, 1: B })], {}, new Set(), new Set(), pending, {}, 0, MAT);
  eq('lone start -> no pending', Object.keys(pending).length, 0);
}
{ // duplicate writer (cold reconnect) collapses to one vote -> still lone
  const pending = {};
  reconcileStarts([mkStart(A, { 0: A, 1: B }), mkStart(A, { 0: A, 1: B })], {}, new Set(), new Set(), pending, {}, 0, MAT);
  eq('same-writer duplicate still lone -> no pending', Object.keys(pending).length, 0);
}
{ // per-seat strict majority: 2 attesters split on seat1 (B vs X) -> seat dropped, agreeing seat kept
  const pending = {};
  reconcileStarts([mkStart(A, { 0: A, 1: B }), mkStart(B, { 0: A, 1: X })], {}, new Set(), new Set(), pending, {}, 0, MAT);
  eq('split seat dropped, agreed seat kept', pending[KEY].roster, { 0: pid(A) });
}
{ // maturity verdict: exit-rate hit for every roster member without a settle record; idempotent via processed
  const pending = { [KEY]: { t0: 0, mt: 2, roster: { 0: pid(A), 1: pid(B), 2: pid(C) }, settled: [] } };
  const leavers = {}, processed = new Set();
  const r = reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 1, MAT);
  eq('3 exit-rate hits', r.convicted, 3);
  eq('leaves++ for A', leavers[pid(A)].leaves, 1);
  eq('lastMatch recorded', leavers[pid(A)].lastMatch, KEY);
  eq('key -> processed (idempotent)', processed.has(KEY), true);
  eq('pending entry removed', pending[KEY], undefined);
  const r2 = reconcileStarts([mkStart(A, { 0: A, 1: B, 2: C }), mkStart(B, { 0: A, 1: B, 2: C })], {}, new Set(), processed, pending, leavers, MAT + 2, MAT);
  eq('re-seen starts of a processed key ignored', r2.registered + r2.convicted, 0);
  eq('no double leaves', leavers[pid(A)].leaves, 1);
}
{ // settle-writer exemption (the 2P blind-spot case): lone finisher exempt, quitter convicted
  const pending = { [KEY]: { t0: 0, mt: 2, roster: { 0: pid(A), 1: pid(B) }, settled: [] } };
  const leavers = {}, processed = new Set();
  const groups = { [KEY]: [mkSettle(A)] };   // A finished (lone settle = never settles the match)
  const r = reconcileStarts([], groups, new Set(), processed, pending, leavers, MAT + 1, MAT);
  eq('only the quitter hit', r.convicted, 1);
  eq('finisher A exempt', leavers[pid(A)], undefined);
  eq('quitter B hit', leavers[pid(B)].leaves, 1);
}
{ // settle writers are remembered across runs (shard entry may be overwritten before maturity)
  const pending = { [KEY]: { t0: 0, mt: 2, roster: { 0: pid(A), 1: pid(B) }, settled: [] } };
  const leavers = {}, processed = new Set();
  reconcileStarts([], { [KEY]: [mkSettle(A)] }, new Set(), processed, pending, leavers, HOUR, MAT);   // run 1: A's settle visible, immature
  eq('settled[] captured while visible', pending[KEY].settled, [pid(A)]);
  const r = reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 1, MAT);            // run 2: settle overwritten, matures
  eq('exemption survives overwrite', r.convicted, 1);
  eq('A still exempt', leavers[pid(A)], undefined);
}
{ // a consistent settle group owns the key: no verdict even past maturity; cleaned once processed
  const pending = { [KEY]: { t0: 0, mt: 2, roster: { 0: pid(A), 1: pid(B) }, settled: [] } };
  const leavers = {}, processed = new Set();
  const groups = { [KEY]: [mkSettle(A), mkSettle(B)] };
  const r = reconcileStarts([], groups, new Set([KEY]), processed, pending, leavers, MAT + 1, MAT);
  eq('consistent settle -> no verdict', r.convicted, 0);
  eq('pending kept this run', !!pending[KEY], true);
  processed.add(KEY);   // the normal settle loop marks it
  const r2 = reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 2, MAT);
  eq('cleaned next run', r2.cleaned, 1);
  eq('no late verdict', r2.convicted, 0);
  eq('leavers empty', leavers, {});
}
{ // sticky first-seen: re-seeing a pending key keeps the original t0
  const pending = { [KEY]: { t0: 500, mt: 2, roster: { 0: pid(A) }, settled: [] } };
  reconcileStarts([mkStart(A, { 0: A, 1: B }), mkStart(B, { 0: A, 1: B })], {}, new Set(), new Set(), pending, {}, 9999, MAT);
  eq('t0 unchanged on re-sight', pending[KEY].t0, 500);
}
{ // roster consensus can convict a non-attester (the anchor value: honest starters testify for the whole lobby)
  const pending = {}, leavers = {}, processed = new Set();
  reconcileStarts([mkStart(A, { 0: A, 1: B, 2: C }), mkStart(B, { 0: A, 1: B, 2: C })], {}, new Set(), processed, pending, leavers, 0, MAT);
  const r = reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 1, MAT);
  eq('C (never wrote anything) also hit', leavers[pid(C)].leaves, 1);
  eq('all 3 hit', r.convicted, 3);
}
{ // START_MAGIC pinned (client writer lockstep is asserted from the mvp side test)
  eq('START_MAGIC = 0xB2', START_MAGIC, 0xB2);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (start-orphan) ===');
process.exit(failN === 0 ? 0 : 1);
