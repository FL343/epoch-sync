'use strict';
// Unit tests for the abandon-confession pipeline (reconcileConfessions + the dedup hooks):
// immediate ranked penalty (clamp-aware, amount recorded), exit-rate hit, non-ranked = exit-rate
// only, refund + retraction when the confessor later settles the same match, sticky state across
// shard overwrites, maturity finalize, processed-match no-op, self-spam harmlessness, and the
// no-double-count guards on the consensus (detectLeavers-path) and start-orphan verdicts.
//   node test/confession.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const { reconcileConfessions, reconcileStarts, pid, leaverLpPenalty, CONFESS_MAGIC } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const A = '76561198000000001', B = '76561198000000002';
const NOW = 10 * 86400000;
// injected board stub: per-sid score map + write journal
function mkOpts(board, overrides) {
  const writes = [];
  return Object.assign({
    penalty: 100, lpMax: 9999, maturityMs: 2 * 3600 * 1000,
    appliesLpFn: (mt) => ((mt & 0xF) === 2 || (mt & 0xF) === 4),
    seedFor: () => 0,
    readLp: async (sid) => (board[sid] == null ? null : { score: board[sid], details: null }),
    writeLp: async (sid, score) => { board[sid] = score; writes.push([sid, score]); return true; },
    _writes: writes,
  }, overrides || {});
}
const conf = (sid, m, mt, dispCode) => ({ steamID: sid, m, mt, dispCode: dispCode == null ? 5 : dispCode });

(async () => {
  console.log('=== magic + immediate ranked penalty ===');
  eq('CONFESS_MAGIC pinned 0xB5 (0xB4 reserved by the mirror plan)', CONFESS_MAGIC, 0xB5);
  {
    const board = { [A]: 2000 }, st = {}, leavers = {}, opts = mkOpts(board);
    const r = await reconcileConfessions([conf(A, 'm1_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    eq('ranked confession: -100 applied immediately', board[A], 1900);
    eq('deducted amount recorded for the refund', st[pid(A) + '|m1_1_2'].ded, 100);
    eq('exit-rate leaves++', leavers[pid(A)].leaves, 1);
    eq('result counters', [r.seen, r.penalized, r.exitHits], [1, 1, 1]);
  }
  {
    const board = { [A]: 60 }, st = {}, leavers = {};
    await reconcileConfessions([conf(A, 'm2_1_2', 2)], {}, new Set(), st, leavers, NOW, mkOpts(board));
    eq('clamp at floor: 60 -> 0, ded records the REAL 60', [board[A], st[pid(A) + '|m2_1_2'].ded], [0, 60]);
    eq('clamp matches leaverLpPenalty', board[A], leaverLpPenalty(60, 100));
  }
  {
    const board = {}, st = {}, leavers = {};
    await reconcileConfessions([conf(A, 'm3_1_2', 2)], {}, new Set(), st, leavers, NOW, mkOpts(board, { seedFor: () => 2000 }));
    eq('first-ranked leaver: seeded base then deducted (2000 -> 1900)', board[A], 1900);
  }
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const r = await reconcileConfessions([conf(A, 'm4_1_1', 1)], {}, new Set(), st, leavers, NOW, mkOpts(board));
    eq('quick (mt=1) confession: exit-rate only, LP untouched', [board[A], leavers[pid(A)].leaves, r.penalized], [2000, 1, 0]);
  }
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const r = await reconcileConfessions([conf(A, 'm5_1_2', 2, 0)], {}, new Set(), st, leavers, NOW, mkOpts(board));
    eq('non-abandoner disp (finished) ignored', [board[A], r.exitHits], [2000, 0]);
  }
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const r = await reconcileConfessions([conf(A, 'm6_1_2', 2, 7)], {}, new Set(), st, leavers, NOW, mkOpts(board));
    eq('kicked (disp 7) counts like user-quit', [board[A], r.exitHits], [1900, 1]);
  }

  console.log('=== idempotency + sticky state ===');
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const opts = mkOpts(board);
    await reconcileConfessions([conf(A, 'm7_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    await reconcileConfessions([conf(A, 'm7_1_2', 2)], {}, new Set(), st, leavers, NOW + 60000, opts);
    eq('same confession re-seen (shard still visible): no double deduction', board[A], 1900);
    eq('no double exit-rate', leavers[pid(A)].leaves, 1);
  }
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    await reconcileConfessions([conf(A, 'm8_1_2', 2)], {}, new Set(), st, leavers, NOW, mkOpts(board));
    // shard entry overwritten (confs empty), match matures with no settle -> finalize, penalty stands
    const r2 = await reconcileConfessions([], {}, new Set(), st, leavers, NOW + 3 * 3600 * 1000, mkOpts(board));
    eq('maturity finalize (no settle record ever): penalty stands', [board[A], r2.finalized], [1900, 1]);
    const r3 = await reconcileConfessions([], {}, new Set(), st, leavers, NOW + 4 * 3600 * 1000, mkOpts(board));
    eq('finalized entry inert on later runs', r3.finalized, 0);
  }
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const r = await reconcileConfessions([conf(A, 'm9_1_2', 2)], {}, new Set(['m9_1_2']), st, leavers, NOW, mkOpts(board));
    eq('already-processed match: registered done, nothing applied (consensus path owned it)', [board[A], r.exitHits, st[pid(A) + '|m9_1_2'].done], [2000, 0, 1]);
  }

  console.log('=== reconnect forgiveness (refund + retraction) ===');
  // H3 hardening (2026-07-19 audit): absolution requires the confessor's record inside a
  // CONSISTENT settle group (opts.consistentKeys) with a non-abandoner disp -- fixtures pass
  // the key set the caller computes for real; negative cases below pin the lone/divergent deny.
  {
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const opts = mkOpts(board, { consistentKeys: new Set(['mA_1_2']) });
    await reconcileConfessions([conf(A, 'mA_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    eq('penalized first', board[A], 1900);
    // later run: his own settle record for the same match appears in a CONSISTENT group (came back and finished)
    const groups = { 'mA_1_2': [{ steamID: A, d: [], dispCode: 0 }, { steamID: B, d: [], dispCode: 0 }] };
    const r2 = await reconcileConfessions([conf(A, 'mA_1_2', 2)], groups, new Set(), st, leavers, NOW + 600000, opts);
    eq('refund: exact deducted amount returned', [board[A], r2.refunded], [2000, 1]);
    eq('exit signal retracted', leavers[pid(A)].leaves, 0);
    const r3 = await reconcileConfessions([conf(A, 'mA_1_2', 2)], groups, new Set(), st, leavers, NOW + 700000, opts);
    eq('refund is once-only', [board[A], r3.refunded], [2000, 0]);
  }
  {
    // clamp-aware refund: base 60 -> 0 (ded 60); refund returns exactly 60, not the nominal 100
    const board = { [A]: 60 }, st = {}, leavers = {};
    const opts = mkOpts(board, { consistentKeys: new Set(['mB_1_2']) });
    await reconcileConfessions([conf(A, 'mB_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    await reconcileConfessions([], { 'mB_1_2': [{ steamID: A, d: [], dispCode: 0 }, { steamID: B, d: [], dispCode: 0 }] }, new Set(), st, leavers, NOW + 600000, opts);
    eq('clamped deduction refunds the REAL amount (60), no free LP', board[A], 60);
  }
  {
    // settle record already visible at FIRST sighting (fast reconnect+finish before cron ever saw the confession)
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const groups = { 'mC_1_2': [{ steamID: A, d: [], dispCode: 0 }, { steamID: B, d: [], dispCode: 0 }] };
    const r = await reconcileConfessions([conf(A, 'mC_1_2', 2)], groups, new Set(), st, leavers, NOW,
      mkOpts(board, { consistentKeys: new Set(['mC_1_2']) }));
    eq('settled-before-first-sighting: nothing applied at all', [board[A], r.exitHits, r.penalized], [2000, 0, 0]);
  }

  console.log('=== H3: lone/divergent/abandoner records buy NO absolution ===');
  {
    // lone 0xB1 (any client can upload one for its own seat): match key NOT in consistentKeys
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const opts = mkOpts(board);   // no consistentKeys at all
    await reconcileConfessions([conf(A, 'mD_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    eq('penalized', board[A], 1900);
    const loneGroups = { 'mD_1_2': [{ steamID: A, d: [], dispCode: 0 }] };
    const r2 = await reconcileConfessions([conf(A, 'mD_1_2', 2)], loneGroups, new Set(), st, leavers, NOW + 600000, opts);
    eq('lone garbage record: NO refund, penalty stands', [board[A], r2.refunded], [1900, 0]);
    eq('exit signal NOT retracted', leavers[pid(A)].leaves, 1);
  }
  {
    // record exists but the group is divergent (flagged, not in consistentKeys) -> deny
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const opts = mkOpts(board, { consistentKeys: new Set() });
    await reconcileConfessions([conf(A, 'mE_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    const divGroups = { 'mE_1_2': [{ steamID: A, d: [], dispCode: 0 }, { steamID: B, d: [], dispCode: 0 }] };
    const r2 = await reconcileConfessions([], divGroups, new Set(), st, leavers, NOW + 600000, opts);
    eq('divergent (flagged) group: NO refund', [board[A], r2.refunded], [1900, 0]);
  }
  {
    // consistent group but the confessor's OWN record is abandoner-disp (came back, quit again) -> deny
    const board = { [A]: 2000 }, st = {}, leavers = {};
    const opts = mkOpts(board, { consistentKeys: new Set(['mF_1_2']) });
    await reconcileConfessions([conf(A, 'mF_1_2', 2)], {}, new Set(), st, leavers, NOW, opts);
    const gr = { 'mF_1_2': [{ steamID: A, d: [], dispCode: 5 }, { steamID: B, d: [], dispCode: 0 }] };
    const r2 = await reconcileConfessions([], gr, new Set(), st, leavers, NOW + 600000, opts);
    eq('own record abandoner-disp in a consistent group: NO refund (LP3 mirror)', [board[A], r2.refunded], [1900, 0]);
  }

  console.log('=== self-spam is pure self-harm ===');
  {
    const board = { [A]: 150 }, st = {}, leavers = {};
    const opts = mkOpts(board);
    const spam = [conf(A, 's1_1_2', 2), conf(A, 's2_1_2', 2), conf(A, 's3_1_2', 2)];
    await reconcileConfessions(spam, {}, new Set(), st, leavers, NOW, opts);
    eq('fake-match confession spam only fines the spammer to the floor', board[A], 0);
    eq('and inflates only HIS exit rate', leavers[pid(A)].leaves, 3);
    eq('nobody else touched', board[B], undefined);
  }

  console.log('=== no-double-count guards on the other conviction paths ===');
  {
    // start-orphan verdict skips a confessed key
    const st = { [pid(A) + '|o1_7_2']: { t0: 0, mt: 2, ded: 100, ex: 1 } };
    const pending = { 'o1_7_2': { t0: 0, mt: 2, roster: { 0: pid(A), 1: pid(B) }, settled: [] } };
    const leavers = {}, processedSet = new Set();
    reconcileStarts([], {}, new Set(), processedSet, pending, leavers, 3 * 3600 * 1000, 2 * 3600 * 1000, st);
    eq('orphan verdict: confessed player skipped, the other roster member still hit', [leavers[pid(A)], leavers[pid(B)].leaves], [undefined, 1]);
  }
  console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (abandon confessions) ===');
  process.exit(failN === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
