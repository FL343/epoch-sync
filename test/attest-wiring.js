'use strict';
// ============================================================
// attest-wiring.js - knife-7 audit: the unmatched confession WIRING (not just the module).
// ============================================================
// test/attest.js proves reconcileUnmatched in isolation. This proves the piece validate.js
//   actually does around it: building the matchIndex (matchHash -> hostSid) from settle records
//   via decodeRoster (host = roster seat 0), so a real confession correlates to the real host.
//   The audit finding was that attest.js had NO live caller; this locks the caller's contract.
const assert = (label, cond) => { if (cond) console.log('  ok    ' + label); else { console.log('  FAIL  ' + label); process.exitCode = 1; } };
const eq = (label, got, exp) => assert(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp));

const V = require('../validate.js');
const A = require('../attest.js');

// build a settle record (v3) with a roster: host = seat 0, joiner = seat 1
function recWithRoster(matchId, hostSid, joinerSid) {
  const enc = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const h = enc(hostSid), j = enc(joinerSid);
  // [0..8] header (pc=2), [9] dur, [10..11] scores, [12] disp, [13..16] roster(2/seat)
  return { d: [0xB1, 3, 1, A.hash32(matchId), 0, 0, 1, 0, 2, 600, 100, 90, 0, h[0], h[1], j[0], j[1]] };
}
// encode a confession box payload (ring, 6 seats x 5 bits) the way the guard does
function box(matchId, pc, perSeat) {
  let packed = 0; for (let i = 0; i < 6; i++) packed = (packed | ((perSeat[i] | 0) << (i * 5))) >>> 0;
  return [0xB8, 1, 1, A.hash32(matchId) | 0, pc, packed | 0];
}

const HOST = '76561198000000001', JOINER = '76561198000000002';

console.log('== knife-7 unmatched confession wiring ==');
{
  // matchIndex built exactly like validate.js: decodeRoster(rec.d) -> host = seat 0
  const recs = [recWithRoster('m_wire_1', HOST, JOINER)];
  const matchIndex = new Map();
  for (const r of recs) {
    const roster = V.decodeRoster(r.d);
    const host = roster && (roster[0] != null ? roster[0] : roster['0']);
    if (host) matchIndex.set(r.d[3] >>> 0, { hostSid: host });
  }
  eq('decodeRoster puts the host at seat 0', matchIndex.get(A.hash32('m_wire_1') >>> 0).hostSid, HOST);

  // confession written by the HOST -> corroborated, subject = host (never the joiner)
  const collected = [];
  const rows = [{ steamID: HOST, details: box('m_wire_1', 2, [0, 5, 0, 0, 0, 0]) }];
  const r1 = A.reconcileUnmatched(rows, { matchIndex, state: {}, now: 1000, pid: (s) => s, onSignal: (s) => collected.push(s) });
  eq('host-written confession is corroborated', [r1.fresh, r1.corroborated], [1, 1]);
  eq('signal subject is the WRITER (host), never a joiner seat', collected[0].subject, HOST);
  assert('signal never names the joiner as subject (no framing tool)', collected[0].subject !== JOINER);
  eq('signal is review-weight (corroborated) and record-only', [collected[0].weight, collected[0].kind], ['review', 'unmatched-host-drop']);

  // confession written by a NON-host for the same match -> orphan (not corroborated), still accuses writer
  const collected2 = [];
  const rows2 = [{ steamID: JOINER, details: box('m_wire_1', 2, [0, 0, 3, 0, 0, 0]) }];
  const r2 = A.reconcileUnmatched(rows2, { matchIndex, state: {}, now: 1000, pid: (s) => s, onSignal: (s) => collected2.push(s) });
  eq('non-host confession is orphan (weak), subject still the writer', [r2.orphan, collected2[0].subject, collected2[0].weight], [1, JOINER, 'weak']);

  // sticky dedupe across runs: same total -> not fresh; grown total -> fresh again
  const state = {};
  A.reconcileUnmatched(rows, { matchIndex, state, now: 1000, pid: (s) => s });
  const again = A.reconcileUnmatched(rows, { matchIndex, state, now: 2000, pid: (s) => s });
  eq('same total on a later run is deduped (not fresh)', again.fresh, 0);
  const grown = [{ steamID: HOST, details: box('m_wire_1', 2, [0, 9, 0, 0, 0, 0]) }];
  const g = A.reconcileUnmatched(grown, { matchIndex, state, now: 3000, pid: (s) => s });
  eq('a grown total is new information (fresh again)', g.fresh, 1);
}

if (process.exitCode) console.log('\n[attest-wiring] FAIL'); else console.log('\n[attest-wiring] all green');
