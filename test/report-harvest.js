'use strict';
// Player reports (report_box) harvest: decode, dedup, directional edges, unique-reporter
// weighting inputs, daily counted cap, malformed/self-report rejection, pruning window.
process.env.REPORT_DAILY_CAP = '3';   // small cap so the anti-bombing path is testable
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const { harvestReports, pruneSignals, sigPlayer, pid, REPORT_MAGIC, REP_KEYS } = require(path.join(__dirname, '..', 'validate.js'));
// Q190: edges are keyed by keyed tokens, never by pid; the per-pid counters players[].ri / .ro are gone -- the received /
// filed counts are the edge sums below. Q209: one edge per (reporter, target) under REP_KEYS.edge(pair token, target lane
// key) -- nothing in the key names the reporter alone, so the sums go over the accounts this test uses.
const OF = REP_KEYS.of;
const EDGE = (r, t) => REP_KEYS.edge(REP_KEYS.pair(r, t), OF(t));
const ALL = ['76561198000000001', '76561198000000002', '76561198000000003', '76561198000000004'];
const n = (s, r, t) => (s.rep[EDGE(r, t)] || { n: 0 }).n;
const received = (s, sid) => ALL.reduce((a, r) => a + (r === sid ? 0 : n(s, r, sid)), 0);
const filed = (s, sid) => ALL.reduce((a, t) => a + (t === sid ? 0 : n(s, sid, t)), 0);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const R1 = '76561198000000001', R2 = '76561198000000002', T1 = '76561198000000003', T2 = '76561198000000004';
const fresh = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} });
const DAY = 86400000;

// mirror the client packing: [0xB3, ver<<8|count, (sidLo,sidHi,reason,matchHash)*n]
function pack(reports) {
  const det = [REPORT_MAGIC, (1 << 8) | reports.length];
  for (const r of reports) {
    const b = BigInt(r.t);
    det.push(Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, r.r | 0, r.m | 0);
  }
  return det;
}

console.log('=== report harvest (record-only) ===');

{ // basic: one reporter, two targets, edges + counters
  const s = fresh();
  const res = harvestReports([{ steamID: R1, d: pack([{ t: T1, r: 2, m: 111 }, { t: T2, r: 1, m: 111 }]) }], s, 1000);
  eq('seen/counted', [res.seen, res.counted, res.capped, res.bad], [2, 2, 0, 0]);
  const e1 = s.rep[EDGE(R1, T1)];
  eq('edge R1>T1 n=1 reason-mask has bit2', [e1.n, (e1.m >> 2) & 1], [1, 1]);
  eq('T1 received 1 (edge sum)', received(s, T1), 1);
  eq('R1 filed 2 (edge sum)', filed(s, R1), 2);
  eq('Q190: no per-pid report counters', Object.keys(s.players).length, 0);
  const blob = JSON.stringify(s);
  eq('Q190: no pid of reporter or target anywhere in the state', [R1, T1, T2].filter(x => blob.includes(pid(x))), []);
  eq('Q209: an edge carries no pair token (its key is built from it), only counts and a stamp', Object.keys(e1), ['n', 'm', 'at']);
  eq('Q209: every report key a keyed token (no reporter key, no separator)', Object.keys(s.rep).concat(Object.keys(s.rseen), s.day.rt).filter(k => !/^[0-9a-f]{16}$/.test(k)), []);
  eq('Q209: the day\'s count = R1\'s two slot tokens', s.day.rt.slice().sort(), [REP_KEYS.slot(0, REP_KEYS.by(R1), 0), REP_KEYS.slot(0, REP_KEYS.by(R1), 1)].sort());
  eq('Q209: no per-reporter daily counter', s.day.r, undefined);
}

{ // idempotent re-upload: same rolling queue harvested twice = no double count
  const s = fresh();
  const ent = { steamID: R1, d: pack([{ t: T1, r: 2, m: 111 }]) };
  harvestReports([ent], s, 1000);
  const res2 = harvestReports([ent], s, 2000);
  eq('re-upload dedup (rseen)', [res2.seen, res2.counted], [0, 0]);
  eq('edge still n=1', s.rep[EDGE(R1, T1)].n, 1);
}

{ // same pair different reason / different match = distinct reports
  const s = fresh();
  harvestReports([{ steamID: R1, d: pack([{ t: T1, r: 2, m: 111 }]) }], s, 1000);
  harvestReports([{ steamID: R1, d: pack([{ t: T1, r: 3, m: 111 }, { t: T1, r: 2, m: 222 }]) }], s, 2000);
  const e = s.rep[EDGE(R1, T1)];
  eq('edge n=3 (reason/match distinct)', e.n, 3);
  eq('reason mask bits 2+3', [(e.m >> 2) & 1, (e.m >> 3) & 1], [1, 1]);
}

{ // daily counted cap (3): beyond = dedup-marked but not counted
  const s = fresh();
  const reports = [];
  for (let i = 0; i < 5; i++) reports.push({ t: T1, r: 1, m: 1000 + i });
  const res = harvestReports([{ steamID: R1, d: pack(reports) }], s, 1000);
  eq('cap: 5 seen, 3 counted, 2 capped', [res.seen, res.counted, res.capped], [5, 3, 2]);
  eq('T1 received respects cap', received(s, T1), 3);
  // next UTC day: counter resets
  const res2 = harvestReports([{ steamID: R1, d: pack([{ t: T2, r: 1, m: 9 }]) }], s, 1000 + DAY);
  eq('next day counted again', res2.counted, 1);
  eq('Q209: the new day holds only its own slot', s.day.rt, [REP_KEYS.slot(1, REP_KEYS.by(R1), 0)]);
}

{ // rejects: self-report, bad reason, bad magic, short payload
  const s = fresh();
  const res = harvestReports([
    { steamID: R1, d: pack([{ t: R1, r: 1, m: 1 }]) },        // self
    { steamID: R1, d: pack([{ t: T1, r: 9, m: 1 }]) },        // bad reason
    { steamID: R2, d: [0x77, 1] },                            // bad magic
    { steamID: R2, d: [REPORT_MAGIC] },                       // short
  ], s, 1000);
  eq('all rejected', [res.seen, res.counted, res.bad], [0, 0, 4]);
  eq('no edges', Object.keys(s.rep).length, 0);
}

{ // unique-reporter weighting input: two reporters on one target = two directional edges
  const s = fresh();
  harvestReports([
    { steamID: R1, d: pack([{ t: T1, r: 2, m: 5 }]) },
    { steamID: R2, d: pack([{ t: T1, r: 2, m: 5 }]) },
  ], s, 1000);
  eq('distinct reporters = distinct edges', [Object.keys(s.rep).length, n(s, R1, T1), n(s, R2, T1)], [2, 1, 1]);
  eq('T1 received 2', received(s, T1), 2);
}

{ // pruning: rep edges + rseen fall out of the 45d window
  const s = fresh();
  harvestReports([{ steamID: R1, d: pack([{ t: T1, r: 1, m: 7 }]) }], s, 1000);
  pruneSignals(s, 1000 + 46 * DAY);
  eq('rep pruned after window', Object.keys(s.rep).length, 0);
  eq('rseen pruned after window', Object.keys(s.rseen).length, 0);
}

console.log('=== L5 (2026-07-19 audit): rseen mint-after-cap + size fuse ===');
{ // capped entries mint NO dedup key (attacker-chosen matchHash can't grow rseen past the cap)
  const s = fresh();
  const reports = [];
  for (let i = 0; i < 5; i++) reports.push({ t: T1, r: 1, m: 2000 + i });
  harvestReports([{ steamID: R1, d: pack(reports) }], s, 1000);
  eq('only counted reports minted rseen keys (3 of 5)', Object.keys(s.rseen).length, 3);
  // deferred, not destroyed: next UTC day the same queue re-upload counts the 2 capped ones
  const res2 = harvestReports([{ steamID: R1, d: pack(reports) }], s, 1000 + DAY);
  eq('capped reports retry next day and count', [res2.seen, res2.counted], [2, 2]);
  eq('now all 5 minted', Object.keys(s.rseen).length, 5);
}
{ // size fuse: rseen beyond SIG_PAIRS_CAP evicts oldest (mirror of the pairs fuse)
  const s = fresh();
  const CAP = 200000;   // SIG_PAIRS_CAP default
  for (let i = 0; i < CAP + 10; i++) s.rseen['k' + i] = 1000 + i;   // oldest = lowest ts
  pruneSignals(s, 2000);   // within window (no age pruning), only the fuse fires
  eq('rseen fuse: evicted down to cap', Object.keys(s.rseen).length, CAP);
  eq('oldest evicted first', [s.rseen['k0'], s.rseen['k9'], !!s.rseen['k10']], [undefined, undefined, true]);
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== report-harvest: ALL PASS ===');
process.exit(failN ? 1 : 0);
