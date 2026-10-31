'use strict';
// Q346 (cloud audit 2026-10-31): matches first seen together settle in their players' own order.
//   A cron stall (or a schedule that slips past two of one player's matches) shows several of one player's matches in one
//   run with the same start sighting (t0); freshOrderPaced then fell back to the key order (a hash), and the points (0 floor,
//   placement / series), the rating and the win streak followed the hash, not the order they were played (W162 lr03).
//   freshSeqPlan orders such a class by the players' own shard rotation (result-reporter.js nextShard: +1 per record),
//   and seqStartMs gives the class's streak events strictly increasing minutes in that order.
//   [1] two matches of one player: his shard order wins over the key order
//   [2] the shard ring wraps; a pair at exactly half the ring (or on one shard) orders nothing
//   [3] start > result > confession / note when one player has several records of one match
//   [4] players disagreeing (a cycle) break at the key-first group; pairs of other players still hold
//   [5] classes stay apart (other t0 = other class); endless groups and a class of one are never touched
//   [6] confessions / notes order a match the same way a result does; labels that are not s<n> order nothing
//   [7] lag / seqStartMs: the longest chain after a match, in minutes before t0; only that t0 moves
//   [8] freshOrderPaced with the plan: a class takes its rank, t0 still first, endless after, no plan = old order
//   [9] the streak (the real streak-plan.js) of three wins seen together: 1, 2, 3 in play order, not in key order
//   [10] wiring pins in validate.js
//   [11] mutation self-checks
//   [12] Q346 rework (review 2026-10-31): a class's minutes are worked out once and kept on the start entries (sq) -- a match
//        held this run (an exit wait) settles later at its kept minute, not back at t0 after the class's later wins; kept
//        values are never rewritten, a new group never sorts before a kept one it follows, a held match's early streak
//        events take the kept minute; mutation self-checks
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const v = require(path.join(ROOT, 'validate.js'));
const SP = require(path.join(ROOT, 'streak-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const T = (label, cond) => { if (cond) ok(label); else bad(label); };

const N = 50;
const P = '76561198000000001', Q = '76561198000000002', R = '76561198000000003', X = '76561198000000009';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a quick (mt 1) record of match key mh_9_1, written by `who` on shard `shard`
function rec(who, mh, shard, seat) {
  const d = [0xB1, 3, 1, mh, 9, seat | 0, 0, 0, 2, 900, 3000, 2500, 0];
  for (const sid of [P, Q]) { const p = sidPair(sid); d.push(p[0], p[1]); }
  return { steamID: who, shard, d, dispCode: 0 };
}
// an endless (mt 7) record, segment [sd, ed]
function rec7(who, mh, shard, sd, ed) {
  const d = [0xB1, 3, 7, mh, 9, 0, 0, 0, 2, 1200, 4000, 3500, 0];
  for (const sid of [P, Q]) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, 1, 0);
  return { steamID: who, shard, d, dispCode: 0 };
}
const key = (mh) => mh + '_9_1';
const grp = (mh, ...rs) => ({ m: key(mh), g: rs });
const plan = (groups, t0, extra) => v.freshSeqPlan(groups, (m) => (typeof t0 === 'function' ? t0(m) : t0), extra || [], N);
const orderOf = (groups, seq) => groups.filter((c) => seq.cls.has(c.m)).slice().sort((a, b) => seq.rank.get(a.m) - seq.rank.get(b.m)).map((c) => c.m);
const T0 = 1700000000000;

function checks(fp, label) {
  // returns { name: bool } for the scenarios the mutants must break (used by [11])
  const out = {};
  { const a = grp(900, rec(P, 900, 's10')), b = grp(500, rec(P, 500, 's11')); const s = fp([a, b], T0); out.shard = JSON.stringify(orderOf([a, b], s)) === JSON.stringify([key(900), key(500)]); }
  { const a = grp(900, rec(P, 900, 's49')), b = grp(500, rec(P, 500, 's1')); const s = fp([a, b], T0);
    const c = grp(500, rec(P, 500, 's49')), d = grp(900, rec(P, 900, 's1')); const s2 = fp([c, d], T0);
    out.wrap = JSON.stringify(orderOf([a, b], s)) === JSON.stringify([key(900), key(500)]) && JSON.stringify(orderOf([c, d], s2)) === JSON.stringify([key(500), key(900)]); }
  { const a = grp(900, rec(P, 900, 's10')), b = grp(500, rec(P, 500, 's35')); const s = fp([a, b], T0); out.half = s.pairs === 0 && JSON.stringify(orderOf([a, b], s)) === JSON.stringify([key(500), key(900)]); }
  { const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22')); const s = fp([c, a, b], T0); out.lag = s.lag.get(key(900)) === 2 && s.lag.get(key(500)) === 1 && s.lag.get(key(700)) === 0; }
  { const a = grp(900, rec(P, 900, 's30')), b = grp(500, rec(P, 500, 's31')); const s = fp([a, b], (m) => (m === key(900) ? T0 : T0 + 60000)); out.classes = s.classes === 0 && !s.cls.has(key(900)); }
  return out;
}

// [12] the scenarios (mod = validate.js or a mutant): returns { name: bool }
//   held: he lost 900, then won 500 and 700 (shards 20 / 21 / 22); a stall shows all three in one run (t0 = T0), 900 waits
//   for an exit confirmation and settles alone a later run; then he wins 100 an hour later -> its streak must be 3 (2 wins
//   after the loss + this one), as when each match settles in its own run. Worked out again, 900 sat at T0 beside 700 and
//   (losses first on a tie) broke the 500 win: 2.
function checksKept(mod) {
  const out = {};
  const ent = () => ({ t0: T0, mt: 1, roster: {}, settled: [] });
  const plan2 = (groups, pending, extra) => mod.freshSeqPlan(groups, (m) => (pending[m] && pending[m].t0) || T0, extra || [], N, (m) => mod.seqKeptLag(pending, m, (pending[m] && pending[m].t0) || T0));
  const nowMin = Math.floor(T0 / 60000) + 90;
  {
    const pending = { [key(900)]: ent(), [key(500)]: ent(), [key(700)]: ent() };
    const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22'));
    const s1 = plan2([a, b, c], pending);
    const stored = mod.seqKeep(pending, s1);
    out.store = stored === 3 && [900, 500, 700].map((m) => pending[key(m)].sq).join() === '2,1,0';
    let st = SP.blank();
    const put = (seq, m, k) => { const r = SP.apply(st, Math.floor(mod.seqStartMs(seq, key(m), T0) / 60000), m, k, nowMin); st = r.st; return r.at; };
    put(s1, 500, 1); put(s1, 700, 1);   // run 1 settles the two wins; 900 is held
    delete pending[key(500)]; delete pending[key(700)];   // settled = processed, their entries go
    const s2 = plan2([a], pending);   // run 2: 900 alone (its exit confirmed)
    put(s2, 900, 2);
    const r = SP.apply(st, Math.floor(T0 / 60000) + 60, 100, 1, nowMin);   // an hour later, a normal win
    out.kept = r.at === 3;
    // the same with a stranger's match of the same t0 fresh beside it (a class of two in run 2)
    const pend2 = { [key(900)]: Object.assign(ent(), { sq: 2 }), [key(990)]: ent() };
    const s3 = plan2([a, grp(990, rec(X, 990, 's5'))], pend2);
    out.kept2 = s3.lag.get(key(900)) === 2 && mod.seqStartMs(s3, key(900), T0) === T0 - 2 * 60000 && !s3.keep.has(key(900)) && s3.keep.get(key(990)) === 0;
  }
  { // written once: a kept value stays, a second call writes nothing, no entry = nothing made, another t0 = not ours
    const pending = { [key(900)]: Object.assign(ent(), { sq: 5 }), [key(500)]: ent(), [key(800)]: Object.assign(ent(), { t0: T0 - 60000 }) };
    const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22'));
    const t0Of = (m) => T0;
    const s = mod.freshSeqPlan([a, b, c, grp(800, rec(P, 800, 's23'))], t0Of, [], N, (m) => mod.seqKeptLag(pending, m, T0));
    const n1 = mod.seqKeep(pending, s), n2 = mod.seqKeep(pending, s);
    out.once = pending[key(900)].sq === 5 && pending[key(500)].sq != null && n2 === 0 && !(key(700) in pending) && pending[key(800)].sq == null && n1 === 1;
  }
  { // a new group after a kept one (its result came in later): never before it, at worst the same minute (the old tie)
    const pending = { [key(900)]: Object.assign(ent(), { sq: 0 }), [key(950)]: ent(), [key(970)]: ent() };
    const s = plan2([grp(900, rec(P, 900, 's20')), grp(950, rec(P, 950, 's21')), grp(970, rec(P, 970, 's22'))], pending);
    const mn = (m) => mod.seqStartMs(s, key(m), T0);
    // and a new one before a kept one goes before it
    const pb = { [key(850)]: ent(), [key(900)]: Object.assign(ent(), { sq: 2 }) };
    const sb = plan2([grp(850, rec(P, 850, 's19')), grp(900, rec(P, 900, 's20'))], pb);
    out.ceil = mn(900) <= mn(950) && mn(950) <= mn(970) && mn(900) === T0 && sb.lag.get(key(850)) === 3;
  }
  { // a kept match not fresh this run (still waiting): its early streak events still move to the kept minute
    const pending = { [key(400)]: Object.assign(ent(), { sq: 2 }), [key(410)]: ent() };
    const s = plan2([], pending);
    const n = mod.seqAddKept(pending, s);
    out.late = n === 1 && mod.seqStartMs(s, key(400), T0) === T0 - 2 * 60000 && mod.seqStartMs(s, key(410), T0) === T0;
  }
  { // what reads as a kept value
    const rd = (sq, t0) => mod.seqKeptLag({ m: { t0: t0 == null ? T0 : t0, sq } }, 'm', T0);
    out.range = rd(0) === 0 && rd(mod.SEQ_KEPT_MAX) === mod.SEQ_KEPT_MAX && [-1, 1.5, mod.SEQ_KEPT_MAX + 1, '2', null, undefined].every((x) => rd(x) === null) && rd(2, T0 + 60000) === null &&
      mod.seqKeptLag({}, 'm', T0) === null && mod.seqKeptLag(null, 'm', T0) === null;
  }
  return out;
}

console.log('=== Q346 fresh class order (freshSeqPlan / seqStartMs) ===');

console.log('-- [1] his shard order over the key order --');
{
  // he played 900 first (shard 10), then 500 (shard 11); the key order puts 500 first
  const a = grp(900, rec(P, 900, 's10'), rec(Q, 900, 's3')), b = grp(500, rec(P, 500, 's11'), rec(Q, 500, 's4'));
  const s = plan([b, a], T0);
  eq('order', orderOf([a, b], s), [key(900), key(500)]);
  eq('one class, two pairs (P and Q agree), both groups moved, no cycle', [s.classes, s.pairs, s.moved, s.cycles], [1, 1, 2, 0]);
  eq('ranks / lag', [s.rank.get(key(900)), s.rank.get(key(500)), s.lag.get(key(900)), s.lag.get(key(500))], [0, 1, 1, 0]);
  const s2 = plan([b, a], T0, []);
  T('the plan does not depend on the order the groups come in', JSON.stringify(orderOf([a, b], s2)) === JSON.stringify(orderOf([a, b], plan([a, b], T0))));
  // already in key order: nothing moves
  const c = grp(500, rec(P, 500, 's10')), d = grp(900, rec(P, 900, 's11'));
  const s3 = plan([c, d], T0);
  eq('already in the key order: nothing moved, lag 1 / 0', [orderOf([c, d], s3), s3.moved, s3.lag.get(key(500)), s3.lag.get(key(900))], [[key(500), key(900)], 0, 1, 0]);
}

console.log('-- [2] the ring wraps; half the ring and one shard order nothing --');
{
  const a = grp(900, rec(P, 900, 's49')), b = grp(500, rec(P, 500, 's1'));
  eq('s49 then s1 (2 ahead across the wrap): 900 first', orderOf([a, b], plan([a, b], T0)), [key(900), key(500)]);
  const c = grp(900, rec(P, 900, 's1')), d = grp(500, rec(P, 500, 's49'));
  eq('s1 then s49 (48 ahead = 2 behind): 500 first', orderOf([c, d], plan([c, d], T0)), [key(500), key(900)]);
  const c2 = grp(500, rec(P, 500, 's49')), d2 = grp(900, rec(P, 900, 's1'));
  eq('the key-first group on the high shard: s49 then s1, 500 first', orderOf([c2, d2], plan([c2, d2], T0)), [key(500), key(900)]);
  const e = grp(900, rec(P, 900, 's10')), f = grp(500, rec(P, 500, 's35'));
  const se = plan([e, f], T0);
  eq('exactly half the ring (25): no pair, key order', [orderOf([e, f], se), se.pairs, se.moved], [[key(500), key(900)], 0, 0]);
  const g = grp(900, rec(P, 900, 's7')), h = grp(500, rec(P, 500, 's7'));
  const sg = plan([g, h], T0);
  eq('the same shard (a re-upload): no pair, key order', [orderOf([g, h], sg), sg.pairs], [[key(500), key(900)], 0]);
  const i = grp(900, rec(P, 900, 's24')), j = grp(500, rec(P, 500, 's48'));
  eq('24 ahead (just under half): 900 first', orderOf([i, j], plan([i, j], T0)), [key(900), key(500)]);
  const k = grp(900, rec(P, 900, 's60')), l = grp(500, rec(P, 500, 's2'));
  eq('a shard index past the ring (s60) orders nothing', plan([k, l], T0).pairs, 0);
}

console.log('-- [3] start > result > confession / note --');
{
  // match 900: start on s3, result on s10 (an outbox re-upload); match 500: result on s4.
  // by the start, 900 is first (3 -> 4 is 1 ahead); by the result, 500 would be first (4 -> 10 is 6 ahead)
  const a = grp(900, rec(P, 900, 's10')), b = grp(500, rec(P, 500, 's4'));
  eq('result alone: 500 first', orderOf([a, b], plan([a, b], T0)), [key(500), key(900)]);
  eq('his start of 900 (s3) wins over his result (s10): 900 first', orderOf([a, b], plan([a, b], T0, [{ steamID: P, m: key(900), shard: 's3', start: true }])), [key(900), key(500)]);
  eq('a confession does not override his result', orderOf([a, b], plan([a, b], T0, [{ steamID: P, m: key(900), shard: 's3', confess: true }])), [key(500), key(900)]);
}

console.log('-- [4] a cycle breaks at the key-first group --');
{
  // P: 500 (s1) then 900 (s2); Q: 900 (s1) then 500 (s2) -- no honest client writes this; R orders 700 after both
  const a = grp(500, rec(P, 500, 's1'), rec(Q, 500, 's2')), b = grp(900, rec(P, 900, 's2'), rec(Q, 900, 's1')), c = grp(700, rec(R, 700, 's9'));
  const extra = [{ steamID: R, m: key(500), shard: 's7', start: true }, { steamID: R, m: key(900), shard: 's8', start: true }];
  const s = plan([a, b, c], T0, extra);
  eq('one cycle, broken at 500 (key-first); R puts 700 last', [orderOf([a, b, c], s), s.cycles], [[key(500), key(900), key(700)], 1]);
  T('the plan is a total order of the class (ranks 0..2, each once)', JSON.stringify([...[a, b, c].map((x) => s.rank.get(x.m))].sort()) === JSON.stringify([0, 1, 2]));
}

console.log('-- [5] classes stay apart; endless and single groups are not touched --');
{
  const t0 = { [key(900)]: T0, [key(500)]: T0, [key(300)]: T0 + 60000, [key(100)]: T0 + 60000, [key(200)]: T0 + 120000 };
  const a = grp(900, rec(P, 900, 's10')), b = grp(500, rec(P, 500, 's11')), c = grp(300, rec(P, 300, 's12')), d = grp(100, rec(P, 100, 's13')), e = grp(200, rec(P, 200, 's9'));
  const s = plan([a, b, c, d, e], (m) => t0[m]);
  eq('two classes of two; the lone group at its own t0 is not in the plan', [s.classes, s.cls.has(key(200)), s.cls.get(key(900)) === s.cls.get(key(500)), s.cls.get(key(300)) === s.cls.get(key(100)), s.cls.get(key(900)) === s.cls.get(key(300))], [2, false, true, true, false]);
  eq('each class in his order; no pair across classes', [orderOf([a, b], s), orderOf([c, d], s), s.pairs], [[key(900), key(500)], [key(300), key(100)], 2]);
  const e1 = { m: '900_9_7', g: [rec7(P, 900, 's10', 5, 7)] }, e2 = { m: '500_9_7', g: [rec7(P, 500, 's11', 0, 5)] };
  const se = v.freshSeqPlan([e1, e2], () => T0, [], N);
  eq('endless groups: not in the plan', [se.classes, se.cls.size], [0, 0]);
  const mix = v.freshSeqPlan([e1, a, b], () => T0, [], N);
  eq('endless beside a class: only the non-endless are planned', [mix.cls.has(e1.m), orderOf([a, b], mix)], [false, [key(900), key(500)]]);
  eq('no groups / null: an empty plan', [v.freshSeqPlan([], () => T0, [], N).classes, v.freshSeqPlan(null, () => T0, null, N).classes], [0, 0]);
}

console.log('-- [6] confessions / notes; labels that are not s<n> --');
{
  // he left 900 (confession on s5) and finished 500 (result on s6): 900 first
  const a = grp(900, rec(Q, 900, 's20')), b = grp(500, rec(P, 500, 's6'), rec(Q, 500, 's21'));
  eq('his confession orders like a result', orderOf([a, b], plan([a, b], T0, [{ steamID: P, m: key(900), shard: 's5', confess: true }])), [key(900), key(500)]);
  eq('an exit note too', orderOf([a, b], plan([a, b], T0, [{ steamID: P, m: key(900), shard: 's5', note: true }])), [key(900), key(500)]);
  const c = grp(900, rec(P, 900, 'r:lb_rec_3')), d = grp(500, rec(P, 500, 's6'));
  eq('a recovered record (r:<board>) orders nothing', plan([c, d], T0).pairs, 0);
  const e = grp(900, rec(P, 900, 'x:s5')), f = grp(500, rec(P, 500, 's6'));
  eq('a label with a prefix orders nothing', plan([e, f], T0).pairs, 0);
  eq('an extra record of a match not in the class is ignored', plan([d, f], T0, [{ steamID: P, m: key(123), shard: 's1', start: true }]).pairs, 0);
}

console.log('-- [7] lag / seqStartMs --');
{
  const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22')), d = grp(300, rec(X, 300, 's1'));
  const s = plan([c, a, d, b], T0);
  eq('chain 900 -> 500 -> 700: lag 2 / 1 / 0; a stranger\'s match 0', [900, 500, 700, 300].map((m) => s.lag.get(key(m))), [2, 1, 0, 0]);
  eq('seqStartMs: t0 minus lag minutes', [900, 500, 700, 300].map((m) => (T0 - v.seqStartMs(s, key(m), T0)) / 60000), [2, 1, 0, 0]);
  T('his three starts are strictly increasing minutes in play order, all at or before t0', v.seqStartMs(s, key(900), T0) < v.seqStartMs(s, key(500), T0) && v.seqStartMs(s, key(500), T0) < v.seqStartMs(s, key(700), T0) && v.seqStartMs(s, key(700), T0) === T0);
  eq('another t passes through (a stamp of its own)', v.seqStartMs(s, key(900), T0 + 5), T0 + 5);
  eq('a key not in the plan passes through', v.seqStartMs(s, key(111), T0), T0);
  eq('no plan passes through', [v.seqStartMs(null, key(900), T0), v.seqStartMs(undefined, key(900), 42)], [T0, 42]);
  // diamond: 900 -> 500, 900 -> 700 (two players), 500 and 700 unordered: lag 900 = 1, not 2
  const e = grp(900, rec(P, 900, 's1'), rec(Q, 900, 's1')), f = grp(500, rec(P, 500, 's2')), g = grp(700, rec(Q, 700, 's2'));
  const sd = plan([e, f, g], T0);
  eq('two branches: lag is the longest chain, not the count', [sd.lag.get(key(900)), sd.lag.get(key(500)), sd.lag.get(key(700))], [1, 0, 0]);
}

console.log('-- [8] freshOrderPaced with the plan --');
{
  const t0 = { [key(900)]: T0, [key(500)]: T0, [key(300)]: T0 - 60000 };
  const a = grp(900, rec(P, 900, 's10')), b = grp(500, rec(P, 500, 's11')), c = grp(300, rec(P, 300, 's40'));
  const e1 = { m: '100_9_7', g: [rec7(P, 100, 's12', 0, 5)] };
  const t0Of = (m) => t0[m] || T0;
  const s = v.freshSeqPlan([a, b, c, e1], t0Of, [], N);
  eq('older t0 first, then the class in his order, endless after', [b, e1, a, c].sort(v.freshOrderPaced(t0Of, s)).map((x) => x.m), [key(300), key(900), key(500), '100_9_7']);
  eq('no plan: the old order (key breaks the tie)', [b, e1, a, c].sort(v.freshOrderPaced(t0Of)).map((x) => x.m), [key(300), key(500), key(900), '100_9_7']);
  // a group the plan does not know (e.g. added after it was made) falls back to the key order against its class
  const z = grp(800, rec(P, 800, 's1'));
  T('a group the plan does not know compares by key (no throw)', [a, z].sort(v.freshOrderPaced(t0Of, s)).map((x) => x.m).join() === [key(800), key(900)].join());
}

console.log('-- [9] the streak of three wins first seen together --');
{
  // he won 900, then 500, then 700 (shards 20, 21, 22); the cron first sees all three in one run (t0 = the same minute)
  const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22'));
  const s = plan([a, b, c], T0);
  const nowMin = Math.floor(T0 / 60000) + 1;
  // the win's bonus is apply's `at` = his streak right after this match among the matches in so far: the settle order
  //   (the fresh sort) and the minutes both count; the cron settles the class in the sort's order
  const replay = (settle, minuteOf) => {
    let st = SP.blank(); const at = {};
    for (const m of settle) { const r = SP.apply(st, minuteOf(key(m)), m, 1, nowMin); st = r.st; at[m] = r.at; }
    return [at[900], at[500], at[700]];
  };
  const oneMin = () => Math.floor(T0 / 60000), seqMin = (m) => Math.floor(v.seqStartMs(s, m, T0) / 60000);
  const keyOrder = [a, b, c].sort(v.freshOrderPaced(() => T0)).map((x) => parseInt(x.m, 10));
  const seqOrder = [a, b, c].sort(v.freshOrderPaced(() => T0, s)).map((x) => parseInt(x.m, 10));
  eq('the sorts: key order 500 / 700 / 900, his order 900 / 500 / 700', [keyOrder, seqOrder], [[500, 700, 900], [900, 500, 700]]);
  eq('the old way (key order, one minute): 900 / 500 / 700 get 3 / 1 / 2', replay(keyOrder, oneMin), [3, 1, 2]);
  eq('Q346 (his order, his minutes): 1 / 2 / 3', replay(seqOrder, seqMin), [1, 2, 3]);
  eq('his order with one minute is not enough (the tie still goes by hash)', replay(seqOrder, oneMin), [1, 1, 2]);
  eq('his minutes in the key order are not enough either', replay(keyOrder, seqMin), [1, 1, 2]);
}

console.log('-- [12] minutes kept across runs (Q346 rework) --');
{
  const r = checksKept(v);
  T('a class\'s first plan stores every member\'s minutes (held ones too): 2 / 1 / 0', r.store);
  T('the held loss settles later at its kept minute: the next win is streak 3 (each match in its own run gives 3)', r.kept);
  T('kept beside a new class member of the same t0: read back, not stored again', r.kept2);
  T('stored once: a kept value is never rewritten; no entry = nothing made; another t0 = not stored', r.once);
  T('a new group after a kept one: never before it (at worst the same minute); before a kept one: before it', r.ceil);
  T('a kept match still waiting: its early streak events take the kept minute', r.late);
  T('only 0..SEQ_KEPT_MAX integers on the same t0 read as kept', r.range);
  // the reviewer's scenario without the store (the first-round patch): the held loss back at T0 -> 2
  const pending = { [key(900)]: { t0: T0 }, [key(500)]: { t0: T0 }, [key(700)]: { t0: T0 } };
  const a = grp(900, rec(P, 900, 's20')), b = grp(500, rec(P, 500, 's21')), c = grp(700, rec(P, 700, 's22'));
  const nowMin = Math.floor(T0 / 60000) + 90;
  const s1 = v.freshSeqPlan([a, b, c], () => T0, [], N);
  let st = SP.blank();
  for (const [m, k, sq] of [[500, 1, s1], [700, 1, s1], [900, 2, v.freshSeqPlan([a], () => T0, [], N)]]) st = SP.apply(st, Math.floor(v.seqStartMs(sq, key(m), T0) / 60000), m, k, nowMin).st;
  eq('without the store (worked out again: the first-round patch) the next win is only', SP.apply(st, Math.floor(T0 / 60000) + 60, 100, 1, nowMin).at, 2);
  T('(that scenario\'s entries had no sq)', Object.values(pending).every((e) => e.sq == null));
}

console.log('-- [10] wiring --');
{
  T('freshSeqPlan / seqStartMs exported', typeof v.freshSeqPlan === 'function' && typeof v.seqStartMs === 'function');
  T('the plan is made from the fresh list with the sort\'s own t0 and this run\'s starts / confessions / notes',
    /\n  const freshT0 = \(m\) => \(startsPending\[m\] && startsPending\[m\]\.t0\) \|\| \(qllT\.get\(m\)\) \|\| nowMs;/.test(SRC) &&
    /\n  const seq = freshSeqPlan\(fresh, freshT0, starts\.map\(\(s\) => \(\{ steamID: s\.steamID, m: s\.d\[3\] \+ '_' \+ s\.d\[4\] \+ '_' \+ s\.d\[2\], shard: s\.shard, start: true \}\)\)\.concat\(confessions, notes\), LEDGER_SHARDS,\n    \(m\) => seqKeptLag\(startsPending, m, freshT0\(m\)\)\);/.test(SRC));
  const iSeq = SRC.indexOf('\n  const seq = freshSeqPlan('), iNoFresh = SRC.indexOf("if (fresh.length === 0) { console.log('no fresh matches, skip')"), iSort = SRC.indexOf('\n  fresh.sort(freshOrderPaced(freshT0, seq));');
  T('made before the no-fresh exit (its streak events are filed there) and before the sort', iSeq > 0 && iNoFresh > iSeq && iSort > iSeq);
  T('the one sort of the fresh list takes the plan', iSort > 0 && (SRC.match(/\n\s*fresh\.sort\(/g) || []).length === 1);
  T('the early streak events (absences, breaks, pardons) take the class minutes',
    /if \(V54B3_STREAK\) \{\s*const byMh = new Map\(\);\s*for \(const \[m, L\] of seq\.lag\) if \(L > 0\) byMh\.set\(mhOfKey\(m\), m\);\s*for \(const ev of streakEarly\) \{ const m = byMh\.get\(ev\.mh \| 0\); if \(m != null\) ev\.t0 = seqStartMs\(seq, m, ev\.t0\); \}/.test(SRC));
  T('creditXp (the settle loop) takes the class minute', /\{ t0: seqStartMs\(seq, c\.m, pend\.t0 \|\| nowMs\), nowMs, absentSeats:/.test(SRC));
  T('creditXp (a quit-lone match) takes the class minute', /\{ t0: seqStartMs\(seq, c\.m, L\.t \|\| nowMs\), nowMs, absentSeats: new Set\(\) \}/.test(SRC));
  T('streakAbsence (a convicted absent seat) takes the class minute', /streakAbsence\(xpState, pid\(x\.steamID\), seqStartMs\(seq, c\.m, pend\.t0 \|\| nowMs\), /.test(SRC));
  T('no creditXp / streakAbsence call left on a bare start', !/creditXp\([^;]*\{ t0: (pend\.t0|L\.t) \|\| nowMs/.test(SRC) && !/streakAbsence\(xpState, pid\(x\.steamID\), pend\.t0 \|\| nowMs/.test(SRC));
  T('the run summary shows it', /RUN\.seqOrder = seq\.classes \+ ' \/ ' \+ seq\.moved \+ ' \/ ' \+ seq\.cycles;/.test(SRC) && /s\('seqOrder', '0 \/ 0 \/ 0'\)/.test(SRC));
  T('the shard count is the ledger\'s', /\nconst LEDGER_SHARDS = /.test(SRC));
  // Q346 rework: kept minutes read into the plan, stored right after it, held matches added before the early streak events
  T('the plan reads the kept minutes off the start entries', /LEDGER_SHARDS,\s*\(m\) => seqKeptLag\(startsPending, m, freshT0\(m\)\)\);/.test(SRC));
  const iKeep = SRC.indexOf('const seqStored = seqKeep(startsPending, seq), seqLate = seqAddKept(startsPending, seq);'), iEarly = SRC.indexOf('\n  if (V54B3_STREAK) {\n    const byMh = new Map();');
  T('stored and the held ones added right after the plan, before the early streak events and the no-fresh exit', iKeep > iSeq && iEarly > iKeep && iNoFresh > iKeep);
  const iSave = SRC.indexOf('\n  const saveSettled = (checkpoint) => {'), iSaveEnd = SRC.indexOf('\n  };', iSave);
  const saveBody = iSave > 0 && iSaveEnd > iSave ? SRC.slice(iSave, iSaveEnd) : '';
  T('the settle\'s save stores them again, before the starts file (an entry the settle made, no start record)',
    /\n    seqKeep\(startsPending, seq\);[^\n]*\n    saveStarts\(startsPending\);/.test(saveBody));
}

console.log('-- [11] mutation self-checks --');
{
  const base = checks((g, t0, x) => plan(g, t0, x));
  T('[11] the scenarios hold on this validate.js', Object.values(base).every(Boolean));
  const mutants = [
    ['his shard order ignored (pairs dropped)', 'if (!adj[from].has(to)) { adj[from].add(to); indeg[to]++; out.pairs++; }', 'if (false) { adj[from].add(to); indeg[to]++; out.pairs++; }', 'shard'],
    ['no wrap (raw difference)', 'const d = ((e[y][1].s - e[x][1].s) % N + N) % N;', 'const d = Math.abs(e[y][1].s - e[x][1].s);', 'wrap'],
    ['half the ring treated as ahead', 'if (d === 0 || d * 2 === N) continue;', 'if (d === 0) continue;', 'half'],
    ['lag counted as one step', 'if (rk[w] > r && lag[w] + 1 > lag[v]) lag[v] = lag[w] + 1;', 'if (rk[w] > r) lag[v] = 1;', 'lag'],
    ['classes of one t0 merged', "if (list.length < 2) { const L = list.length ? keptOf(list[0].m) : null;", "if (list.length < 1) { const L = list.length ? keptOf(list[0].m) : null;", 'classes'],
  ];
  for (const [label, from, to, which] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(ROOT, '.mutant-fresh-seq-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      delete require.cache[require.resolve(script)];
      const mv = require(script);
      const r = checks((g, t0, x) => mv.freshSeqPlan(g, (m) => (typeof t0 === 'function' ? t0(m) : t0), x || [], N));
      T('[11] ' + label + ' -> "' + which + '" goes red', r[which] === false);
    } catch (e) { bad('[11] ' + label + ': ' + (e && e.message || e)); }
    finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log('-- [12] mutation self-checks (kept minutes) --');
{
  const base = checksKept(v);
  T('[12] the scenarios hold on this validate.js', Object.values(base).every(Boolean));
  const mutants = [
    ['a held match alone works its minute out again', 'const L = list.length ? keptOf(list[0].m) : null;', 'const L = null;', 'kept'],
    ['a class works kept members out again', 'fixed = list.map((c) => keptOf(c.m));', 'fixed = list.map(() => null);', 'kept2'],
    ['nothing stored', 'e.sq = L; n++;', 'n++;', 'store'],
    ['a kept value rewritten', "e.t0 && Number(e.t0) === Number(seq.t0.get(m)) && e.sq == null) { e.sq = L; n++; }", "e.t0 && Number(e.t0) === Number(seq.t0.get(m))) { e.sq = L; n++; }", 'once'],
    ['no ceiling below a kept group', 'const cv = fixed[v] != null ? fixed[v] : (lag[v] = Math.max(0, Math.min(lag[v], ceil[v])));', 'const cv = fixed[v] != null ? fixed[v] : lag[v];', 'ceil'],
    ['a waiting kept match not added', 'if (L) { seq.lag.set(m, L); seq.t0.set(m, e.t0); n++; }', 'if (false) { seq.lag.set(m, L); seq.t0.set(m, e.t0); n++; }', 'late'],
    ['any t0 reads as kept', 'if (!e || typeof e !== \'object\' || !e.t0 || Number(e.t0) !== Number(t0)) return null;', 'if (!e || typeof e !== \'object\' || !e.t0) return null;', 'range'],
  ];
  for (const [label, from, to, which] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[12] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(ROOT, '.mutant-fresh-seq-k-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      delete require.cache[require.resolve(script)];
      const r = checksKept(require(script));
      T('[12] ' + label + ' -> "' + which + '" goes red', r[which] === false);
    } catch (e) { bad('[12] ' + label + ': ' + (e && e.message || e)); }
    finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (fresh-seq-order)') : 'ALL OK (fresh-seq-order)');
process.exit(failN ? 1 : 0);
