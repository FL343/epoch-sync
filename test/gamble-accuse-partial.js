'use strict';
// Gamble-frame refusals that name the host, when a run reads only part of the records (cloud audit Q282, from the Q61
// review's section 3.3). Q61's pass (test/gamble-accuse.js) checked "at least 2 writers name him" and "from at least 2
// queue units" before it looked for seats with no record. A run that read the host's record and only some of the
// accusers' (one not written yet, or on a shard the run did not read) took the old path at once: the honest accuser it
// read was flagged, and the strike on the next run (every record read) could not take that back -- recordFlag flags a
// key once. Now those two counts come last: while a roster seat has no record, a short count is held like the strike
// shape (nobody flagged), and only a complete read past the absence grace that still lacks the seat takes the old path.
//   [1] 3P quick FFA, host A forged, B and C name him; the first run reads A and B: held, nobody flagged; the next run
//       reads all three: struck, only A flagged -- the same as one run that reads everything
//   [2] 4P with a premade pair at seats 2-3; the first run reads A and the pair (one queue unit): held; then struck
//   [3] reads that are not complete hold even past the grace; a complete read with every record strikes
//   [4] the seat never writes: past the grace on a complete read the old path flags the writers read, as before; later
//       runs take the old path at once (the stamp stays, no new hold); the record arriving after that is a strike on the
//       host, the earlier flags stay, and the log says so (no "only he is flagged"); the stamp goes with the key
//   [5] every seat wrote and the count is still short: the old path at once, no hold (a premade trio names its host; 2P)
//   [6] the hold does not hold the match: at maturity the start verdict ends the key the same as without the tags
//   [7] mutation self-checks
// Runs the REAL validate.js main() against the offline board stub of test/lib/settle-stub.js.
const fs = require('fs'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

// H.advance plus the Q61 signals clocks (strikes, verdicts, hold stamps)
function advance(state, ms) {
  const files = H.advance(state, ms);
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) if (sg.players[k].at) sg.players[k].at -= ms;
    for (const k of Object.keys(sg.gtac || {})) for (const e of sg.gtac[k]) e.t -= ms;
    for (const k of Object.keys(sg.gtav || {})) sg.gtav[k].t -= ms;
    for (const k of Object.keys(sg.gtah || {})) sg.gtah[k] -= ms;
  }
  return files;
}
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const spOf = (r, sid) => (sigOf(r).players || {})[v.pid(sid)] || {};
const fs3 = (r, sids) => sids.map((s) => fOf(r, s)).join('/');
const strikesOf = (r, sid) => ((sigOf(r).gtac || {})[v.pid(sid)] || []).length;
const stampOf = (r, m) => (sigOf(r).gtah || {})[m] || 0;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;

const A = H.SID(1), B = H.SID(2), C = H.SID(3), D = H.SID(4);
const ALL = [A, B, C, D];
const GT = 0x67740000;
// one settle record (the test/gamble-accuse.js shape): scores = this writer's vector, rank from `ranked`; o.gt = tag
function rec(mt, hash, seat, roster, scores, ranked, o) {
  o = o || {};
  const pc = roster.length;
  const order = ranked.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const rank = 1 + order.findIndex((x) => x[1] === seat);
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (rank === 1 ? 1 : 0), pc, 900].concat(scores, [0]);
  for (const s of roster) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  if (o.gt) d.push(GT | o.gt);
  return d;
}
// the host (seat 0) forwarded a forged gamble frame (+30000 on his own seat): every other seat takes it back and names
//   him, unless o.noTag (an older client: the same vectors, no tag); o.skip seats write nothing
function forged(mt, hash, roster, o) {
  o = o || {};
  const pc = roster.length;
  const base = [6000, 5000, 4000, 3000, 2500, 2000].slice(0, pc);
  const hostTable = base.slice(); hostTable[0] += 30000;
  const out = [];
  roster.forEach((sid, seat) => {
    if (o.skip && o.skip.indexOf(seat) >= 0) return;
    const acc = seat !== 0;
    out.push({ sid, d: rec(mt, hash, seat, roster, acc ? base : hostTable, hostTable, acc && !o.noTag ? { gt: 1 } : {}) });
  });
  return out;
}
const RATING = 6, POINTS = 7, PROGRESS = 5;
const boardsWith = (recs) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: ALL.map((s) => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] }]);
function startOf(mt, roster, ago) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [] };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const GRACE = v.ABSENT_GRACE_MS;
const R3 = [A, B, C], R4 = [A, B, C, D];
const PAIR_MT = 1 | (0b10 << 4);   // quick FFA, a premade pair at seats 2-3
const TRIO_MT = 1 | (2 << 8);      // quick FFA, a premade trio at seats 1-3
const run = (recs, files, env, script) => H.runCron(boardsWith(recs), files, env, script, 'gamble-partial');
const first = (recs, mt, roster, env, script) => run(recs, { STARTS_FILE: { [H.keyOf(recs[0].d)]: startOf(mt, roster, FLOOR + 5 * 60000) } }, env, script);
const INCOMPLETE = { LEDGER_SHARDS: '60' };   // 60 shards expected, 50 listed: no read is complete

// whole-job scenarios, true = the rule holds (shared by the sections below and the mutation checks)
// [1] the host and one accuser read first, the other accuser one minute later
function partialThenFull(script) {
  const full = forged(1, 0x2801, R3), m = H.keyOf(full[0].d);
  const r1 = first(forged(1, 0x2801, R3, { skip: [2] }), 1, R3, null, script);
  const r2 = run(full, advance(r1.state, 60000), null, script);
  return { m, r1, r2 };
}
// [4] the third seat never writes; past the grace; one more run; then its record after all; then the key off the shards
function neverThenLate(script) {
  const part = forged(1, 0x2804, R3, { skip: [2] }), full = forged(1, 0x2804, R3), m = H.keyOf(full[0].d);
  const r1 = first(part, 1, R3, null, script);
  const r2 = run(part, advance(r1.state, GRACE + 60000), null, script);
  const r3 = run(part, advance(r2.state, 60000), null, script);
  const r4 = run(full, advance(r3.state, 60000), null, script);
  const r5 = run([], advance(r4.state, 60000), null, script);
  return { m, r1, r2, r3, r4, r5 };
}

// ---- [1] 3P: the first run reads two of three records ----
{ try {
  const full = forged(1, 0x2800, R3), m0 = H.keyOf(full[0].d);
  const c = first(full, 1, R3);
  T('[1] control: every record in one run -> struck, only the host flagged (1/0/0)', c.code === 0 && fs3(c, R3) === '1/0/0' && strikesOf(c, A) === 1, fs3(c, R3) + ' ' + c.out.slice(-500));
  const { m, r1, r2 } = partialThenFull();
  T('[1] run 1 (A and B read): held, nobody flagged, no strike', r1.code === 0 && fs3(r1, R3) === '0/0/0' && !strikesOf(r1, A), fs3(r1, R3) + ' ' + r1.out.slice(-600));
  T('[1] ... logged as not counted yet, seat 2 with no record, the grace left', new RegExp('gamble accusation ' + m + ': not counted yet \\(one writer names him\\), seat\\(s\\) 2 wrote no record -- grace \\d+s left, nobody flagged yet \\(Q282\\)').test(r1.out), r1.out.slice(-600));
  T('[1] ... counted as held, the hold stamped', /gamble accusations: 0 strikes \(0 judged, record only\), 1 deferred, 0 not counted/.test(r1.out) && stampOf(r1, m) > 0);
  T('[1] run 2 (all read): struck, only the host flagged (1/0/0) -- the same as one read', fs3(r2, R3) === '1/0/0' && strikesOf(r2, A) === 1 && /-> strike, verdict free; only he is flagged/.test(r2.out), fs3(r2, R3) + ' ' + r2.out.slice(-600));
  T('[1] ... the hold stamp cleared, ga 1 on B and C', !stampOf(r2, m) && (spOf(r2, B).ga | 0) === 1 && (spOf(r2, C).ga | 0) === 1);
  T('[1] ... nothing settled', !processedOf(r2).has(m) && !processedOf(c).has(m0));
} catch (e) { bad('[1] threw: ' + (e && e.stack)); } }

// ---- [2] 4P with a premade pair: the first run reads the host and the pair (one queue unit) ----
{ try {
  const full = forged(PAIR_MT, 0x2802, R4), m = H.keyOf(full[0].d);
  const r1 = first(forged(PAIR_MT, 0x2802, R4, { skip: [1] }), PAIR_MT, R4);
  T('[2] run 1 (A, C, D read): held, nobody flagged', r1.code === 0 && fs3(r1, R4) === '0/0/0/0' && !strikesOf(r1, A)
    && /not counted yet \(the writers who name him queued as 1 unit\), seat\(s\) 1 wrote no record -- grace \d+s left/.test(r1.out), fs3(r1, R4) + ' ' + r1.out.slice(-600));
  const r2 = run(full, advance(r1.state, 60000));
  T('[2] run 2 (all read): struck, only the host flagged (1/0/0/0)', fs3(r2, R4) === '1/0/0/0' && strikesOf(r2, A) === 1 && !stampOf(r2, m), fs3(r2, R4) + ' ' + r2.out.slice(-600));
} catch (e) { bad('[2] threw: ' + (e && e.stack)); } }

// ---- [3] reads that are not complete ----
{ try {
  const part = forged(1, 0x2803, R3, { skip: [2] }), full = forged(1, 0x2803, R3), m = H.keyOf(full[0].d);
  const r1 = first(part, 1, R3, INCOMPLETE);
  const r2 = run(part, advance(r1.state, GRACE + 60000), INCOMPLETE);
  T('[3] runs that are not complete hold, even past the grace: nobody flagged, no strike',
    [r1, r2].every((r) => r.code === 0 && fs3(r, R3) === '0/0/0' && !strikesOf(r, A) && /not counted yet \(one writer names him\), seat\(s\) 2 wrote no record -- not every record shard was read this run/.test(r.out)),
    fs3(r2, R3) + ' ' + r2.out.slice(-600));
  T('[3] ... the stamp kept from the first sighting', stampOf(r2, m) > 0 && stampOf(r2, m) === stampOf(r1, m) - (GRACE + 60000));
  const r3 = run(full, advance(r2.state, 60000));
  T('[3] a complete read with every record: struck, only the host flagged', fs3(r3, R3) === '1/0/0' && strikesOf(r3, A) === 1, fs3(r3, R3) + ' ' + r3.out.slice(-600));
} catch (e) { bad('[3] threw: ' + (e && e.stack)); } }

// ---- [4] the seat never writes (or writes too late) ----
{ try {
  const { m, r1, r2, r3, r4, r5 } = neverThenLate();
  T('[4] run 1: held, nobody flagged', fs3(r1, R3) === '0/0/0' && /nobody flagged yet \(Q282\)/.test(r1.out));
  T('[4] past the grace on a complete read: the old path -- the writers read are flagged (A and B), no strike',
    fs3(r2, R3) === '1/1/0' && !strikesOf(r2, A) && new RegExp('gamble accusation ' + m + ': not counted \\(one writer names him; seat\\(s\\) 2 still wrote no record past the grace\\)').test(r2.out),
    fs3(r2, R3) + ' ' + r2.out.slice(-600));
  // the old code, the same records, one complete read: the same two flags
  const old = first(forged(1, 0x2804, R3, { skip: [2], noTag: true }), 1, R3);
  T('[4] ... the same flags as the same records without the tag (the old path, nothing held)', fs3(old, R3) === fs3(r2, R3) && !/gamble accusation/.test(old.out), fs3(old, R3));
  T('[4] one more run: the old path at once (no new hold, the stamp kept), no second flag',
    fs3(r3, R3) === '1/1/0' && !/not counted yet/.test(r3.out) && /still wrote no record past the grace/.test(r3.out) && stampOf(r3, m) > 0 && stampOf(r3, m) === stampOf(r2, m) - 60000,
    fs3(r3, R3) + ' ' + r3.out.slice(-600));
  T('[4] the record arrives after all: a strike on the host (gs 1), the flags of the earlier run stay',
    strikesOf(r4, A) === 1 && (spOf(r4, A).gs | 0) === 1 && fs3(r4, R3) === '1/1/0' && !stampOf(r4, m), fs3(r4, R3) + ' ' + r4.out.slice(-600));
  T('[4] ... logged as flagged on an earlier run, not "only he is flagged"',
    /-> strike, verdict free; the key was flagged on an earlier run \(its writers then\), nobody flagged again/.test(r4.out) && !/only he is flagged/.test(r4.out), r4.out.slice(-600));
  T('[4] the key off the shards on a complete read: no stamp left, no flag added', !stampOf(r5, m) && fs3(r5, R3) === '1/1/0');
} catch (e) { bad('[4] threw: ' + (e && e.stack)); } }

// ---- [5] every seat wrote: a short count takes the old path at once ----
{ try {
  const trio = forged(TRIO_MT, 0x2805, R4);
  const rt = first(trio, TRIO_MT, R4);
  T('[5] 4P, a premade trio names its host, every seat wrote: no hold, no strike, every writer flagged in the first run',
    rt.code === 0 && fs3(rt, R4) === '1/1/1/1' && !strikesOf(rt, A) && !/not counted yet/.test(rt.out) && /not counted \(the writers who name him queued as 1 unit\) -- /.test(rt.out),
    fs3(rt, R4) + ' ' + rt.out.slice(-600));
  const two = forged(1, 0x2806, [A, B]);
  const r2p = first(two, 1, [A, B]);
  // the flags of a 2P key are the flag loop's (Q289: a quick / ranked 1V1 flags nobody for the disagreement); this pass only must not hold it
  T('[5] 2P, both wrote: no hold, the old path at once', r2p.code === 0 && !strikesOf(r2p, A) && !/not counted yet/.test(r2p.out) && /not counted \(one writer names him\) -- /.test(r2p.out) && !stampOf(r2p, H.keyOf(two[0].d)),
    r2p.out.slice(-600));
} catch (e) { bad('[5] threw: ' + (e && e.stack)); } }

// ---- [6] the hold does not hold the match ----
{ try {
  const tagged = forged(1, 0x2807, R3, { skip: [2] }), plain = forged(1, 0x2807, R3, { skip: [2], noTag: true });
  const m = H.keyOf(tagged[0].d);
  const t1 = first(tagged, 1, R3), p1 = first(plain, 1, R3);
  const tm = run(tagged, advance(t1.state, v.STARTS_MATURITY_MS + 60000)), pm = run(plain, advance(p1.state, v.STARTS_MATURITY_MS + 60000));
  T('[6] held, then at maturity: the start verdict ends the key, the same as the same records without the tag',
    processedOf(tm).has(m) && processedOf(pm).has(m) && R3.every((s) => leavesOf(tm, s) === leavesOf(pm, s)), 'leaves ' + R3.map((s) => leavesOf(tm, s) + ':' + leavesOf(pm, s)).join(',') + ' ' + tm.out.slice(-600));
  T('[6] ... nothing rated, no flags added by the hold (the old path had flagged ' + fs3(p1, R3) + ')', H.setPosts(tm, RATING).length === 0 && fs3(tm, R3) === '0/0/0', fs3(tm, R3));
} catch (e) { bad('[6] threw: ' + (e && e.stack)); } }

// ---- [7] mutation self-checks (each rule removed -> its scenario goes red) ----
console.log('-- [7] mutation self-checks --');
{ try {
  const SRC = H.SRC;
  let nth = 0;
  const writeMutant = (from, to) => { const f = path.join(H.ROOT, '.mutant-gamble-partial-' + process.pid + '-' + (nth++) + '.js'); fs.writeFileSync(f, SRC.replace(from, to)); return f; };
  const heldFirst = (script) => { const { r1, r2 } = partialThenFull(script); return fs3(r1, R3) === '0/0/0' && fs3(r2, R3) === '1/0/0'; };
  const stampKept = (script) => { const { r3 } = neverThenLate(script); return !/not counted yet/.test(r3.out) && fs3(r3, R3) === '1/1/0'; };
  const lateLog = (script) => { const { r4 } = neverThenLate(script); return !/only he is flagged/.test(r4.out) && /nobody flagged again/.test(r4.out); };
  const allWroteOld = (script) => { const t = forged(TRIO_MT, 0x2808, R4); const r = first(t, TRIO_MT, R4, null, script); return fs3(r, R4) === '1/1/1/1' && !/not counted yet/.test(r.out); };
  const mutants = [
    ['no hold for a short count (Q61 as it was)', 'if (ga.why && ga.absent && ga.absent.length && !signals.gtav[m]) {', 'if (false) {', heldFirst],
    ['the stamp dropped past the grace (a new hold every other run)', "      heldNow.add(m);   // the stamp stays while the key keeps a seat with no record", '      // the stamp stays while the key keeps a seat with no record', stampKept],
    ['the strike log ignores an earlier flag', "(firstFlag ? '; only he is flagged'", "(true ? '; only he is flagged'", lateLog],
    ['a short count held with every seat written', "if (acc.length < GTAC.MIN_ACC) return { why: 'one writer names him', absent };\n  const units = new Set(acc.map(r => gambleUnitOf(mt, r.d[5] | 0)));\n  if (units.size < GTAC.MIN_UNITS) return { why: 'the writers who name him queued as ' + units.size + ' unit', absent };",
      "if (acc.length < GTAC.MIN_ACC) return { why: 'one writer names him', absent: [9] };\n  const units = new Set(acc.map(r => gambleUnitOf(mt, r.d[5] | 0)));\n  if (units.size < GTAC.MIN_UNITS) return { why: 'the writers who name him queued as ' + units.size + ' unit', absent: [9] };", allWroteOld],
  ];
  T('[7] every scenario holds on the real job', mutants.every(([, , , check]) => check(H.VALIDATE)));
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[7] ' + label + ': anchor not found exactly once'); continue; }
    const script = writeMutant(from, to);
    try { T('[7] ' + label + ' -> its scenario goes red', !check(script)); }
    finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
} catch (e) { bad('[7] threw: ' + (e && e.stack)); } }

if (failN) { console.log('gamble-accuse-partial: ' + failN + ' FAILED'); process.exit(1); }
console.log('gamble-accuse-partial: all passed');
