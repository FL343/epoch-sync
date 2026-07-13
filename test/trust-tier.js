'use strict';
// Trust tier (judgment output of recorded signals; sort-only soft-avoid, no punishment):
// tier matrix, same-match-verified unique reporters, board plan (write/delete/no-op),
// harvest targets plumbing.
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const { trustTierOf, trustPlan, verifiedUniqueReporters, TRUST_T, harvestReports, pairKey, pid, REPORT_MAGIC } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', T = '76561198000000009';
const fresh = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} });

console.log('=== trust tier (sort-only soft-avoid) ===');

{ // tier matrix: floors and combination cap
  eq('clean player', trustTierOf(0, 0), 0);
  eq('below floors (f=2, vur=3)', trustTierOf(TRUST_T.F1 - 1, TRUST_T.VUR1 - 1), 0);
  eq('f floor -> 1', trustTierOf(TRUST_T.F1, 0), 1);
  eq('f heavy -> 2', trustTierOf(TRUST_T.F2, 0), 2);
  eq('vur floor -> 1', trustTierOf(0, TRUST_T.VUR1), 1);
  eq('vur heavy -> 2', trustTierOf(0, TRUST_T.VUR2), 2);
  eq('both floors -> 2', trustTierOf(TRUST_T.F1, TRUST_T.VUR1), 2);
  eq('both heavy caps at 3', trustTierOf(TRUST_T.F2, TRUST_T.VUR2), 3);
}

{ // verified unique reporters: co-presence required (report-bombing by strangers = 0)
  const s = fresh();
  const tp = pid(T);
  // A and B reported T; only A ever played with T (pairs co-presence)
  s.rep[pid(A) + '>' + tp] = { n: 3, m: 4, at: 1 };
  s.rep[pid(B) + '>' + tp] = { n: 5, m: 4, at: 1 };
  s.pairs[pairKey(pid(A), tp)] = { n: 2, t: 0, x: 1, at: 1 };
  eq('vur counts only co-present reporters', verifiedUniqueReporters(s, tp), 1);
  s.pairs[pairKey(pid(B), tp)] = { n: 1, t: 0, x: 0, at: 1 };
  eq('vur grows when second reporter verified', verifiedUniqueReporters(s, tp), 2);
  eq('repeat reports from one verified reporter still count once', verifiedUniqueReporters(s, tp), 2);
}

{ // trustPlan: writes on tier change, deletes on decay, no-ops otherwise
  const s = fresh();
  const tp = pid(T);
  s.players[tp] = { f: TRUST_T.F1, at: 1 };          // tier 1 via flags
  const plan1 = trustPlan(s, {}, new Set([T]), 1000);
  eq('new tier-1 player -> write', plan1, { writes: [{ sid: T, tier: 1 }], deletes: [] });
  const plan2 = trustPlan(s, { [T]: 1 }, new Set([T]), 1000);
  eq('unchanged tier -> no-op', plan2, { writes: [], deletes: [] });
  s.players[tp].f = TRUST_T.F2;                       // escalates to 2
  const plan3 = trustPlan(s, { [T]: 1 }, new Set(), 1000);
  eq('escalation via existing-entry recompute (not touched this run)', plan3, { writes: [{ sid: T, tier: 2 }], deletes: [] });
  s.players[tp].f = 0;                                // signals decayed/pruned
  const plan4 = trustPlan(s, { [T]: 2 }, new Set(), 1000);
  eq('decay to 0 -> delete board entry', plan4, { writes: [], deletes: [T] });
  const plan5 = trustPlan(s, {}, new Set([A]), 1000);
  eq('clean touched player -> nothing', plan5, { writes: [], deletes: [] });
}

{ // harvest returns real target sids for trust candidacy
  const s = fresh();
  const det = [REPORT_MAGIC, (1 << 8) | 1];
  const b = BigInt(T);
  det.push(Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, 2, 77);
  const res = harvestReports([{ steamID: A, d: det }], s, 1000);
  eq('harvest targets = [T]', res.targets, [T]);
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== trust-tier: ALL PASS ===');
process.exit(failN ? 1 : 0);
