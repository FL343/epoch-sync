'use strict';
// B6 signal collection: per-player counters, pairwise co-occurrence, flag dedup, day counter, pruning.
process.env.SIG_PAIRS_CAP = '5';   // small fuse so the eviction path is testable (read at require time)
const path = require('path');
const { recordMatchSignals, recordFlag, sigDay, sigPlayer, pruneSignals, pairKey, pid } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const fresh = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {} });
const recOf = (sid, dispCode) => ({ steamID: sid, d: [], roster: {}, dispCode: dispCode | 0 });
const HOUR = 3600000, DAY = 86400000;

console.log('=== signals collection (B6 record-only) ===');

{ // settled 3P ffa: counters + score moments + canonical pairs + placement direction
  const s = fresh();
  const parts = [{ steamID: A, seat: 0, score: 500 }, { steamID: B, seat: 1, score: 300 }, { steamID: C, seat: 2, score: 300 }];
  const rankOf = { [A]: 1, [B]: 2, [C]: 2 };
  recordMatchSignals(s, [recOf(A, 0), recOf(B, 0), recOf(C, 1)], parts, rankOf, 1, false, 1000);
  const pa = s.players[pid(A)], pb = s.players[pid(B)];
  eq('A: g=1 w=1 v=0', [pa.g, pa.w, pa.v], [1, 1, 0]);
  eq('B: g=1 w=0', [pb.g, pb.w], [1, 0]);
  eq('A disp[0]=1 (finished)', pa.disp[0], 1);
  eq('C disp[1]=1 (peers-gone)', s.players[pid(C)].disp[1], 1);
  eq('A score moments s1/s2/smax', [pa.s1, pa.s2, pa.smax], [500, 250000, 500]);
  eq('3 canonical pairs', Object.keys(s.pairs).length, 3);
  const eAB = s.pairs[pairKey(pid(A), pid(B))];
  eq('pair AB: n=1 t=0', [eAB.n, eAB.t], [1, 0]);
  // x counts "lex-first pid strictly above": verify against actual pid order
  const firstIsA = pid(A) < pid(B);
  eq('pair AB placement direction x', eAB.x, firstIsA ? 1 : 0);   // A(rank1) above B(rank2)
  const eBC = s.pairs[pairKey(pid(B), pid(C))];
  eq('pair BC tie -> x=0', eBC.x, 0);
}
{ // premade mask pair (seats 0,1 with mask bit0) -> t counted for that pair only
  const s = fresh();
  const parts = [{ steamID: A, seat: 0, score: 9 }, { steamID: B, seat: 1, score: 8 }, { steamID: C, seat: 2, score: 7 }];
  recordMatchSignals(s, [recOf(A, 0), recOf(B, 0), recOf(C, 0)], parts, { [A]: 1, [B]: 2, [C]: 3 }, 1 | (1 << 4), false, 1000);
  eq('premade pair t=1', s.pairs[pairKey(pid(A), pid(B))].t, 1);
  eq('outsider pair t=0', s.pairs[pairKey(pid(A), pid(C))].t, 0);
}
{ // team match (mt=4): same-side seats 0,1 together
  const s = fresh();
  const parts = [{ steamID: A, seat: 0, score: 9 }, { steamID: B, seat: 1, score: 8 }, { steamID: C, seat: 2, score: 7 }];
  recordMatchSignals(s, [recOf(A, 0), recOf(B, 0), recOf(C, 0)], parts, { [A]: 1, [B]: 2, [C]: 3 }, 4, false, 1000);
  eq('teammates t=1', s.pairs[pairKey(pid(A), pid(B))].t, 1);
  eq('opponents t=0', s.pairs[pairKey(pid(A), pid(C))].t, 0);
}
{ // VOID: v++ only, co-presence n++ recorded, no g/w/score/x
  const s = fresh();
  const parts = [{ steamID: A, seat: 0, score: 100 }, { steamID: B, seat: 1, score: 50 }];
  recordMatchSignals(s, [recOf(A, 2), recOf(B, 2)], parts, null, 2, true, 1000);
  const pa = s.players[pid(A)];
  eq('VOID: v=1 g=0 w=0 s1=0', [pa.v, pa.g, pa.w, pa.s1], [1, 0, 0, 0]);
  eq('VOID disp[2]=1 (host-left)', pa.disp[2], 1);
  const e = s.pairs[pairKey(pid(A), pid(B))];
  eq('VOID pair n=1 x=0', [e.n, e.x], [1, 0]);
}
{ // flag dedup by match key; one hit per distinct writer
  const s = fresh();
  const g = [recOf(A, 0), recOf(A, 0), recOf(B, 0)];   // duplicate writer collapses
  eq('first flag recorded', recordFlag(s, g, 'm1', 1000), true);
  eq('same key again -> dedup', recordFlag(s, g, 'm1', 2000), false);
  eq('A flagged once', s.players[pid(A)].f, 1);
  eq('B flagged once', s.players[pid(B)].f, 1);
  eq('other key counts again', recordFlag(s, g, 'm2', 3000), true);
  eq('A f=2', s.players[pid(A)].f, 2);
}
{ // day counter rollover
  const s = fresh();
  const d1 = sigDay(s, 5 * DAY + HOUR);
  d1.n[pid(A)] = 47;
  eq('same day keeps counts', sigDay(s, 5 * DAY + 2 * HOUR).n[pid(A)], 47);
  const d2 = sigDay(s, 6 * DAY + HOUR);
  eq('new UTC day resets', [d2.d, Object.keys(d2.n).length], [6, 0]);
}
{ // pruning: age windows + pair-count fuse (cap=5 via env)
  const s = fresh();
  const now = 100 * DAY;
  sigPlayer(s, 'old_player', now - 91 * DAY);
  sigPlayer(s, 'live_player', now - HOUR);
  s.pairs['a|b'] = { n: 1, t: 0, x: 0, at: now - 46 * DAY };
  s.pairs['c|d'] = { n: 1, t: 0, x: 0, at: now - HOUR };
  s.flagged['mOld'] = now - 46 * DAY; s.flagged['mNew'] = now - HOUR;
  pruneSignals(s, now);
  eq('stale player pruned, live kept', [s.players.old_player === undefined, !!s.players.live_player], [true, true]);
  eq('stale pair pruned, live kept', [s.pairs['a|b'] === undefined, !!s.pairs['c|d']], [true, true]);
  eq('stale flag key pruned', [s.flagged.mOld === undefined, !!s.flagged.mNew], [true, true]);
  for (let i = 0; i < 8; i++) s.pairs['p' + i + '|q' + i] = { n: 1, t: 0, x: 0, at: now - i * HOUR };
  pruneSignals(s, now);
  const left = Object.keys(s.pairs);
  eq('fuse: capped at 5 pairs', left.length, 5);
  if (left.indexOf('p7|q7') < 0 && left.indexOf('p0|q0') >= 0) ok('fuse evicted oldest first');
  else bad('fuse eviction order wrong: ' + JSON.stringify(left));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (signals-collect) ===');
process.exit(failN === 0 ? 0 : 1);
