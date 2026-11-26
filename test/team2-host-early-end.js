'use strict';
// cloud audit Q436 (W374 section 7; the raw records read by the local job 11-24, mailbox M1008 / M1014): since 11-20 the
//   team-gamble lone dissent pass (Q51) struck honest players in quick / ranked 2V2 / 3V3 keys of two more shapes than Q435's.
//   A (six keys): the opening host left behind by a host migration (the promote step closes his connection, the client reads
//   it as a voluntary loss -- the Q414 client cause, two of the six with nobody leaving first) writes a 'peers-gone' result of
//   the 1-3 levels he saw while the others play the match out with a new host; his record is the one that differs, so he was
//   the lone dissenter of his own match: struck, flagged, the key unsettled, his second strike in 30 days a leave (182117ac,
//   undone by hand, A90). Now earlyEndVerdict (Q414) takes the team codes too when the early writer is the opening host and
//   the finishers name one winner: the key settles on the finishers, he is an excused absent seat (the O886 cap, shared),
//   owed the consolation.
//   C (two keys): a refusal (rank 0) naming only seats of its writer's own team (Q43's T2BY_TAG), his table the others' cell by
//   cell. Now t2OwnNameVerdict reads it as the agreed winner from his seat: settled as played, nobody struck or flagged.
//   [1] units: earlyEndVerdict on the team shapes and every team shape it must leave alone; t2OwnNameVerdict likewise
//   [2] groupRecords: both shapes become consistent entries (A: the finishers, early named, counted as team; C: in place,
//       the copy at his place), nothing in the flag lane
//   [3] the real validate.js main() on the offline board stub, shape A: quick 3V3 / quick 2V2 settle when the finishers land,
//       nobody flagged or struck, the host excused and owed the 50; ranked with a strike already in the window: no leave, no
//       fine, no second strike; past the excuse cap (review round 1): held while the team-code hold is on (T2LD_HOLD_LONE
//       unset = on: no leave, no fine, no excuse spent, nothing owed, the finishers settled -- with or without a strike of
//       his in the window), convicted as a leave with it off (Q414's rule); never struck; the control (the team branch off
//       = main before this) strikes and flags the host and never rates anyone (the repro)
//   [4] main(), shape C: settled in the same run as the key without the refusal, every seat paid the same, nobody flagged or
//       struck (quick 2V2 host naming his teammate; ranked 3V3 joiner naming his own host, a strike already in the window);
//       a refusal naming the other team's seat or nobody: the old rule (struck, free, flagged)
//   [5] seedcap: shape A audited on the finishers' vector (their seats the claimants), shape C on the one vector
//   [6] mutants: each guard goes red on the case it guards (C's seats-distinct guard is backed by sanity's self-seat, so
//       its mutant takes both; two of C's guards have no case of their own: the others' >= 2 accounts (one account's two
//       records sit on one seat: the seats-distinct guard) and the majority void (the others all finished: no void code))
const fs = require('fs'), path = require('path');
for (const k of ['EAC_EXCUSE_CAP', 'EAC_EXCUSE_WINDOW_MS', 'EAC_EXCUSE_FINE', 'PT_MODE', 'APPLY_MMR', 'ABSENT_GRACE_MS', 'STARTS_MATURITY_MS', 'GITHUB_STEP_SUMMARY', 'T2LD_K', 'T2LD_WINDOW_MS', 'T2LD_HOLD_LONE']) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs, so v.pid() addresses their state rows
const H = require('./lib/settle-stub.js');
const v = require(path.join(H.ROOT, 'validate.js'));
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const P = [4360, 4361, 4362, 4363, 4364, 4365].map(H.SID);   // seat 0 (the opening host) .. 5; 3V3: seats 0-2 one team, 3-5 the other
const OUT = H.SID(4369);
const FIN = [9200, 8100, 7400, 6900, 6300, 5800];   // the finished table (the host's team wins unless o.win)
const ESC = [3100, 2800, 2500, 2600, 2200, 1900];   // the old host's own table when the others moved on (level 2)
const T2BY = 0x74320000, GTB = 0xDB | (1 << 8) | (1 << 16);   // Q43 naming int / Q61 gamble block header (validate T2BY_TAG / GT_*)
const rosOf = (mt) => ((v.teamSizeOfMt(mt) === 2) ? P.slice(0, 4) : P);
// a result record as the client writes it: rank by team (the winning team 1..ts, the other ts+1..2ts), 6 levels, disp, roster
function resD(mt, hash, seat, o) {
  o = o || {};
  const ros = o.ros || rosOf(mt), ts = ros.length / 2, win = o.win | 0, myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = H.rec(0xB1, mt, hash, seat, rank, myTeam === win && rank > 0, ros, o.sc || FIN.slice(0, ros.length), o.disp | 0);
  if (o.lv != null) d[7] = (o.lv << 1) | (d[7] & 1);
  d[9] = o.dur || 780;
  if (o.tag != null) d.push(T2BY | o.tag);
  if (o.gt != null) d.push(GTB, o.gt);
  if (o.lift != null) d.push(0xE6 | (1 << 8) | (2 << 16), o.lift, 500);   // a Q339 block (validate ORPH_MAGIC / ORPH_VER): one seat (o.lift: mask | host << 8)
  return d;
}
// shape A: the old host's own record -- peers-gone after two levels, his own table, the rank his table gave him
const earlyD = (mt, hash, o) => resD(mt, hash, (o && o.seat != null) ? o.seat : 0, Object.assign({ disp: 1, lv: 2, dur: 300, sc: ESC.slice(0, rosOf(mt).length), rank: 1 }, o || {}));
function parsed(sid, d, shard) { const pc = d[8] | 0; return { steamID: sid, shard: shard | 0, d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; }
// shape A key: the host's early record, everyone else's finished one (o.fin[seat] / o.e: overrides)
const keyA = (mt, hash, o) => {
  o = o || {};
  const ros = o.ros || rosOf(mt);
  return ros.map((sid, seat) => parsed(sid, seat === 0 ? earlyD(mt, hash, Object.assign({ ros }, o.e || {})) : resD(mt, hash, seat, Object.assign({ ros, win: o.win }, (o.fin && o.fin[seat]) || {})), seat));
};
// shape C key: everyone's finished record, seat o.ref (default 0) a refusal naming o.tag (default: his own team's first other seat)
const keyC = (mt, hash, o) => {
  o = o || {};
  const ros = o.ros || rosOf(mt), ts = ros.length / 2, ref = o.ref == null ? 0 : o.ref;
  const mate = (ref % ts === 0) ? ref + 1 : ref - (ref % ts);
  const tag = o.tag === undefined ? (1 << mate) : o.tag;
  return ros.map((sid, seat) => parsed(sid, resD(mt, hash, seat, Object.assign({ ros, win: o.win }, seat === ref ? Object.assign({ rank: 0 }, tag == null ? {} : { tag }, o.r || {}) : {}, (o.fin && o.fin[seat]) || {})), seat));
};
const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
const vecOf = (r) => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));

// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const mutants = [];
function mutant(file, from, to, tag) {   // from / to: one replacement, or arrays of them (a guard backed by another one)
  let src = fs.readFileSync(path.join(H.ROOT, file), 'utf8');
  const fr = [].concat(from), tt = [].concat(to);
  for (let i = 0; i < fr.length; i++) {
    if (src.split(fr[i]).length !== 2) { T(tag + ' mutant anchor found exactly once', false, fr[i].slice(0, 90)); return null; }
    src = src.replace(fr[i], tt[i]);
  }
  const out = path.join(H.ROOT, '.mutant-t2-host-early-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '-' + path.basename(file));
  fs.writeFileSync(out, src);
  mutants.push(out);
  return out;
}

const EXTRA = (ros) => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: 7, name: 'points', entries: ros.map((s) => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
// the live order: starts; shape A: the host's early record four minutes in; everyone else's ten minutes later; later runs.
//   o.kind 'A' | 'C' | 'ctl' (everyone a finished claim); o.seed: state files of the first run; o.script: a mutant of the job;
//   o.env: the child runs' environment (T2LD_HOLD_LONE '0' pins Q51's own second-strike verdict where Q443's hold is in)
function play(mt, hash, o) {
  o = o || {};
  const ros = o.ros || rosOf(mt);
  const st = ros.map((sid, seat) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, null) }));
  const g = o.kind === 'A' ? keyA(mt, hash, o.k) : (o.kind === 'C' ? keyC(mt, hash, o.k) : ros.map((sid, seat) => parsed(sid, resD(mt, hash, seat, Object.assign({ ros }, (o.k && { win: o.k.win }) || {})), seat)));
  const recs = g.map((r) => ({ sid: r.steamID, d: r.d }));
  const early = o.kind === 'A' ? [recs[0]] : [];
  const steps = [[0, st], [4 * MIN, st.concat(early)], [10 * MIN, st.concat(recs)], [10 * MIN, null], [30 * MIN, null], [2 * HOUR, null], [10 * MIN, null]];
  const runs = [];
  let state = o.seed ? JSON.parse(J(o.seed)) : null, prev = null, first = true;
  for (const [ms, recs0] of steps) {
    const rr = recs0 || prev;
    prev = rr;
    const files = state ? ((first && o.seed) ? state : H.advance(state, ms)) : null;
    first = false;
    const r = H.runCron(H.shardBoards(rr, EXTRA(ros)), files, o.env || null, o.script || null, 't2-host-early');
    runs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { runs, ros, key: H.keyOf(recs[0].d), ok: runs.every((r) => r.code === 0) && runs.length === steps.length };
}
const last = (m) => m.runs[m.runs.length - 1];
const sgOf = (r) => r.state.SIGNALS_FILE || {};
const flaggedOf = (r, key) => !!((sgOf(r).flagged || {})[key]);
const fOf = (r, sid) => (((sgOf(r).players || {})[v.pid(sid)]) || {}).f | 0;
const procOf = (r, key) => { const p = r.state.PROCESSED_FILE; return Array.isArray(p) ? p.indexOf(key) >= 0 : !!(p && (p[key] || (Array.isArray(p.keys) && p.keys.indexOf(key) >= 0))); };
const xpAll = (m, sid) => m.runs.reduce((a, r) => a.concat(H.postsOf(r, 5, sid).map((x) => x.score)), []);
const ratingN = (m, sid) => m.runs.reduce((a, r) => a + H.postsOf(r, 6, sid).length, 0);
const ptsAll = (m, sid) => m.runs.reduce((a, r) => a.concat(H.postsOf(r, 7, sid).map((x) => x.score)), []);
const ptsLast = (m, sid) => { const x = ptsAll(m, sid); return x.length ? x[x.length - 1] : null; };
const settledAt = (m) => m.runs.findIndex((r) => procOf(r, m.key));
const strikesOf = (r, sid, key) => ((sgOf(r).t2ld || {})[v.pid(sid)] || []).filter((e) => !key || e.m === key).length;
const lvOf = (m, sid) => ((last(m).state.LEAVERS_FILE || {})[v.pid(sid)]) || null;
const leavesOf = (m, sid) => Math.max(...m.runs.map((r) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0));
const edOf = (m, sid) => { const e = lvOf(m, sid); return e && Array.isArray(e.ed) ? e.ed.length : 0; };
const cqAt = (r, sid) => (((sgOf(r).players || {})[v.pid(sid)]) || {}).cq || null;
const samePay = (m, c) => m.ros.every((sid) => xpAll(m, sid).length === 1 && J(xpAll(m, sid)) === J(xpAll(c, sid)) && ratingN(m, sid) === ratingN(c, sid) && J(ptsAll(m, sid)) === J(ptsAll(c, sid)));
const payStr = (m, c) => J(m.ros.map((sid) => [xpAll(m, sid), xpAll(c, sid), ratingN(m, sid), ratingN(c, sid), ptsAll(m, sid), ptsAll(c, sid)]));
const nowS = () => Math.floor(Date.now() / 1000);
// a strike of his already in the window (another match, another opposing host): the old rule's second strike = a leave
const prior = (sid, mt) => ({ SIGNALS_FILE: { players: {}, t2ld: { [v.pid(sid)]: [{ m: '111_222_' + mt, t: Date.now() - 5 * DAY, h: v.pid(H.SID(4399)), o: 1, x: [v.pid(H.SID(4399))] }] } } });
// review of Q436 round 1: his excuse list full (2 in 7 days), with or without a strike of his in the window; the held cell
const capSeed = (withStrike) => Object.assign({ LEAVERS_FILE: { [v.pid(P[0])]: { leaves: 0, lastMatch: '', ed: [nowS() - 2 * 86400, nowS() - 86400] } } }, withStrike ? prior(P[0], 9) : {});
const heldOk = (m, withStrike) => m.ok && settledAt(m) === 2 && leavesOf(m, P[0]) === 0 && edOf(m, P[0]) === 2 && ptsAll(m, P[0]).length === 0 && xpAll(m, P[0]).length === 0
  && !m.runs.some((r) => cqAt(r, P[0])) && strikesOf(last(m), P[0], m.key) === 0 && strikesOf(last(m), P[0]) === (withStrike ? 1 : 0) && !m.runs.some((r) => flaggedOf(r, m.key))
  && P.slice(1).every((sid) => ptsAll(m, sid).length === 1) && /\(Q414\)[^|]*\| 1 \/ 0 \/ 0 \/ 0 \|/.test(m.runs[2].summary) && /\(Q436\)[^|]*\| 1 \/ 0 \/ 1 \|/.test(m.runs[2].summary)
  && /past 2 excuses in the window -- held while the team-code hold is on, no conviction, no excuse spent \(Q436\)/.test(m.runs[2].out);
const heldStr = (m) => J({ lv: lvOf(m, P[0]), pts: ptsAll(m, P[0]), xp: xpAll(m, P[0]), s: strikesOf(last(m), P[0]), row: (m.runs[2] ? m.runs[2].summary.split('\n').filter((l) => /Q41[4]|Q436/.test(l)).map((l) => l.slice(-24)) : null) });

console.log('=== a 2V2 / 3V3 opening host left behind by a migration, and a lone refusal naming its own team, are no lone dissenters (Q436) ===');
try {
  // ---- [1] units ----
  {
    const g = keyA(8, 0x4360);
    const x = v.earlyEndVerdict(g, vecOf);
    T('[1] A, the live shape (quick 3V3): early = the opening host at seat 0 after 2 of 6 levels, g = the five finishers (same objects), team 1',
      !!x && x.kind === 'early' && x.team === 1 && x.early.sid === P[0] && x.early.seat === 0 && x.early.levels === 2 && x.early.fLevels === 6 && x.early.n === 1
      && x.g.length === 5 && x.g.every((r, i) => r === g[i + 1]) && J(x.fin) === J(P.slice(1)), J(x && x.early));
    T('[1] A: ranked 3V3 (9), quick 3V3 with ranked seats (O716 mask), quick / ranked 2V2 (5 / 6): the same',
      [9, 8 | (0x38 << 11), 5, 6].every((mt, i) => { const y = v.earlyEndVerdict(keyA(mt, 0x4361 + i), vecOf); return !!y && y.team === 1 && y.g.length === rosOf(mt).length - 1; }));
    T('[1] A: his team lost on the finishers\' table (o.win 1), his record claiming a win: the same (his claim is never read)', !!v.earlyEndVerdict(keyA(8, 0x4365, { win: 1 }), vecOf));
    T('[1] A: a seedcap record shape (w, no steamID / dispCode): the same', !!v.earlyEndVerdict(keyA(8, 0x4366).map(asSc)));
    T('[1] A: the free-for-all shape unchanged (team 0)', (() => { const ros = P.slice(0, 3); const y = v.earlyEndVerdict(ros.map((sid, s) => parsed(sid, s === 0 ? earlyD(1, 0x4367, { ros, sc: ESC.slice(0, 3) }) : resD(1, 0x4367, s, { ros, rank: s + 1, sc: [0, 9000, 8000] }), s)), vecOf); return !!y && y.team === 0; })());
    const noA = (label, grp) => { const z = v.earlyEndVerdict(grp, vecOf); T('[1] A left alone: ' + label, z === null, J(z && z.early)); };
    noA('the early writer a joiner (seat 1): a refusal / host-left lane', keyA(8, 0x4370).map((r, i) => (i === 0 ? parsed(P[0], resD(8, 0x4370, 0, {}), 0) : i === 1 ? parsed(P[1], earlyD(8, 0x4370, { seat: 1 }), 1) : r)));
    noA('the finishers do not name one winner', keyA(8, 0x4371, { fin: { 5: { rank: 1 } } }));
    noA('a finisher refuses (rank 0)', keyA(8, 0x4372, { fin: { 4: { rank: 0 } } }));
    noA('a team brawl code (3)', keyA(3, 0x4373));
    noA('a team brawl code (4)', keyA(4, 0x4374));
    noA('his record names a seat (Q43 T2BY_TAG)', keyA(8, 0x4375, { e: { rank: 0, tag: 8 } }));
    noA('a finisher\'s record carries a Q61 gamble block', keyA(8, 0x4376, { fin: { 2: { gt: 1 } } }));
    noA('a 3V3 code written with four seats', keyA(8, 0x4377, { ros: P.slice(0, 4) }));
    noA('his record as many levels as theirs', keyA(8, 0x4378, { e: { lv: 6 } }));
    noA('his record host-left (2), not peers-gone', keyA(8, 0x4379, { e: { disp: 2 } }));
    noA('the finishers disagree on the scores', keyA(8, 0x437A, { fin: { 3: { sc: FIN.map((s, i) => (i === 3 ? s + 1 : s)) } } }));
    noA('the host also wrote a finished record', keyA(8, 0x437B).concat([parsed(P[0], resD(8, 0x437B, 0, {}), 7)]));

    // t2OwnNameVerdict
    const c = keyC(5, 0x4380);
    const y = v.t2OwnNameVerdict(c);
    T('[1] C, the live 2V2 shape: the opening host refuses naming seat 1 (his teammate), his table the others\' -- a copy claiming the winner from his seat (rank 1), the rest the same objects',
      !!y && y.sid === P[0] && y.seat === 0 && J(y.named) === J([1]) && y.win === 0 && y.n === 1 && y.g[0] !== c[0] && y.g[0].d[6] === 1 && y.g[0].t2OwnName === 0 && c[0].d[6] === 0
      && J(y.g[0].d.slice(7)) === J(c[0].d.slice(7)) && y.g.every((r, i) => i === 0 || r === c[i]) && v.team2WinTeamOf(y.g) === 0, J(y && { seat: y.seat, named: y.named, r: y.g[0].d[6] }));
    const y2 = v.t2OwnNameVerdict(keyC(8, 0x4381, { ref: 1 }));
    T('[1] C, the live 3V3 shape: a joiner of the host\'s team refuses naming his own host (seat 0) -- read the same', !!y2 && y2.seat === 1 && J(y2.named) === J([0]) && y2.g[1].d[6] === 1);
    const y3 = v.t2OwnNameVerdict(keyC(9, 0x4382, { ref: 4, win: 0, tag: (1 << 3) | (1 << 5) }));
    T('[1] C: ranked 3V3, a joiner of the losing team naming both his teammates -- the copy claims rank ts + 1', !!y3 && y3.seat === 4 && J(y3.named) === J([3, 5]) && y3.g[4].d[6] === 4 && v.team2WinTeamOf(y3.g) === 0);
    T('[1] C: 2V2 (6) and the O716 mask: the same', !!v.t2OwnNameVerdict(keyC(6, 0x4383)) && !!v.t2OwnNameVerdict(keyC(5 | (0x0C << 11), 0x4384)));
    const noC = (label, grp) => { const z = v.t2OwnNameVerdict(grp); T('[1] C left alone: ' + label, z === null, J(z && { seat: z.seat, named: z.named })); };
    noC('the refusal names a seat of the other team', keyC(5, 0x4390, { tag: 1 << 2 }));
    noC('the refusal names his teammate and an opponent', keyC(8, 0x4391, { tag: (1 << 1) | (1 << 3) }));
    noC('the refusal names nobody (t2-forfeit: Q51\'s own case)', keyC(5, 0x4392, { tag: null }));
    noC('the refusal names his own seat', keyC(5, 0x4393, { tag: 1 | 2 }));
    noC('the mask names a seat past the seat count', keyC(5, 0x4394, { tag: (1 << 1) | (1 << 4) }));
    noC('his table differs from the others\'', keyC(5, 0x4395, { r: { sc: [9300, 8100, 7400, 6900] } }));
    noC('his levels differ', keyC(5, 0x4396, { r: { lv: 4 } }));
    noC('his refusal written early (migrate-disband 4): Q435\'s lane', keyC(5, 0x4397, { r: { disp: 4 } }));
    noC('two refusers', keyC(8, 0x4398, { fin: { 4: { rank: 0 } } }));
    noC('a second record of his claiming a rank (Q76 both sides; it names his teammate too)', keyC(5, 0x4399).concat([parsed(P[0], resD(5, 0x4399, 0, { tag: 2 }), 5)]));
    noC('the others do not agree on the winner', keyC(8, 0x439A, { fin: { 5: { rank: 1 } } }));
    noC('the others\' tables differ', keyC(8, 0x439B, { fin: { 5: { sc: FIN.map((s, i) => (i === 5 ? s + 1 : s)) } } }));
    noC('a record carries a Q61 gamble block', keyC(8, 0x439C, { fin: { 2: { gt: 1 } } }));
    noC('his record from another seat than the roster gives him', keyC(5, 0x439D).map((r, i) => (i === 0 ? parsed(P[0], resD(5, 0x439D, 1, { rank: 0, tag: 2 }), 0) : r)));
    noC('a finished claim of another account at his seat (two voices)', keyC(5, 0x439E).concat([parsed(OUT, resD(5, 0x439E, 0, {}), 5)]));
    noC('a team brawl code (3)', keyC(3, 0x439F));
    noC('quick FFA (1)', keyC(1, 0x43A0, { ros: P.slice(0, 4) }));
    noC('a finisher reconnect-failed (6)', keyC(5, 0x43A1, { fin: { 2: { disp: 6 } } }));
  }

  // ---- [2] groupRecords ----
  {
    const g = keyA(8, 0x43B0), m = H.keyOf(g[0].d);
    const gr = v.groupRecords(g.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
    const ent = gr.consistentMatches.find((c) => c.m === m);
    T('[2] A: a consistent entry of the five finishers\' records, early named, nothing in the flag lane, counted as a team key',
      !!ent && ent.g.length === 5 && ent.g.every((r) => r.steamID !== P[0]) && ent.early && ent.early.sid === P[0] && !ent.void && gr.inconsistentGroups.length === 0
      && gr.flagged === 0 && gr.early.settle === 1 && gr.early.team === 1 && gr.groups[m] === ent.g, J(ent && { n: ent.g.length, early: ent.early, e: gr.early }));
    const c = keyC(5, 0x43B1), mc = H.keyOf(c[0].d);
    const grc = v.groupRecords(c.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
    const ec = grc.consistentMatches.find((x) => x.m === mc);
    T('[2] C: a consistent entry of four records in place, his copy claiming rank 1, counted, nothing in the flag lane',
      !!ec && ec.g.length === 4 && ec.g[0].d[6] === 1 && ec.g[0].t2OwnName === 0 && grc.groups[mc] === ec.g && grc.groups[mc].t2OwnName === 1 && grc.ownName.n === 1
      && grc.inconsistentGroups.length === 0 && grc.flagged === 0, J(ec && { n: ec.g.length, r: ec.g[0].d[6], on: grc.ownName }));
    const cn = keyC(5, 0x43B2, { tag: 1 << 2 }), mn = H.keyOf(cn[0].d);
    const grn = v.groupRecords(cn.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] C naming the other team: not read (the rank-0 record kept, the lone dissent pass\'s)', grn.ownName.n === 0 && grn.groups[mn].some((r) => r.d[6] === 0));
  }

  // ---- [3] main(), shape A ----
  const a8 = play(8, 0x43C0, { kind: 'A' });
  {
    const r3 = a8.runs[2], r4 = a8.runs[3];
    T('[3] all runs exit 0', a8.ok, a8.runs.map((r) => r.code).join(','));
    T('[3] quick 3V3: the early record alone (run 2): nobody flagged or struck, not settled', !flaggedOf(a8.runs[1], a8.key) && !procOf(a8.runs[1], a8.key) && strikesOf(a8.runs[1], P[0]) === 0);
    T('[3] quick 3V3: the finishers land (run 3): settled at once -- the five rated, the host not; nobody flagged, nobody struck, no lone dissent verdict',
      procOf(r3, a8.key) && P.slice(1).every((sid) => H.postsOf(r3, 6, sid).length === 1) && H.postsOf(r3, 6, P[0]).length === 0 && !flaggedOf(r3, a8.key)
      && P.every((sid) => fOf(r3, sid) === 0 && strikesOf(last(a8), sid) === 0) && !((sgOf(last(a8)).t2lv || {})[a8.key]),
      r3.out.split('\n').filter((l) => /43c0|Q436|Q414|lone dissent|leaver/i.test(l)).join(' | ').slice(-900));
    T('[3] quick 3V3: the host -- no leave, one excuse listed, the 50 owed then paid once', leavesOf(a8, P[0]) === 0 && edOf(a8, P[0]) === 1 && !!cqAt(r3, P[0])
      && J(H.postsOf(r4, 5, P[0]).map((x) => x.score)) === J([v.CONSOLATION_XP]) && xpAll(a8, P[0]).length === 1 && !cqAt(last(a8), P[0]), J({ lv: lvOf(a8, P[0]), xp: xpAll(a8, P[0]) }));
    T('[3] quick 3V3: the finishers\' XP once each', P.slice(1).every((sid) => xpAll(a8, sid).length === 1 && xpAll(a8, sid)[0] > v.CONSOLATION_XP), J(P.map((sid) => xpAll(a8, sid))));
    T('[3] quick 3V3: the log line and the summary row (set aside 1 / excused 1 / capped 0 / owed 1; of those team 1 / own-name 0 / held 0)',
      /his record set aside, the rest consistent, nobody flagged \(Q436: the opening host of a 2V2 \/ 3V3, not a lone dissenter\)/.test(r3.out)
      && /\(Q414\)[^|]*\| 1 \/ 1 \/ 0 \/ 1 \|/.test(r3.summary) && /\(Q436\)[^|]*\| 1 \/ 0 \/ 0 \|/.test(r3.summary) && /an early end set aside: 1 \(2V2 \/ 3V3: 1\)/.test(r3.out)
      && !a8.runs.some((r) => new RegExp('team2 lone dissent ' + a8.key).test(r.out)), (r3.summary.split('\n').find((l) => /Q436/.test(l)) || '').slice(-80));
    const a5 = play(5, 0x43C1, { kind: 'A' });
    T('[3] quick 2V2: the same (settled when the finishers land, nobody flagged or struck, the host excused)', a5.ok && settledAt(a5) === 2 && !a5.runs.some((r) => flaggedOf(r, a5.key))
      && strikesOf(last(a5), P[0]) === 0 && leavesOf(a5, P[0]) === 0 && edOf(a5, P[0]) === 1 && P.slice(1, 4).every((sid) => ratingN(a5, sid) === 1), J({ at: settledAt(a5), lv: lvOf(a5, P[0]) }));
    // ranked, a strike already in the window: the old rule's second strike (own-side host) = a leave and the fine
    const a9 = play(9, 0x43C2, { kind: 'A', seed: prior(P[0], 9) });
    T('[3] ranked 3V3, his strike already in the window: settled, no leave, no fine, no second strike, the five finishers\' points written',
      a9.ok && settledAt(a9) === 2 && leavesOf(a9, P[0]) === 0 && ptsAll(a9, P[0]).length === 0 && strikesOf(last(a9), P[0]) === 1 && strikesOf(last(a9), P[0], a9.key) === 0
      && P.slice(1).every((sid) => ptsAll(a9, sid).length === 1) && !a9.runs.some((r) => flaggedOf(r, a9.key)), J({ lv: lvOf(a9, P[0]), pts: P.map((sid) => ptsAll(a9, sid)) }));
    // past the excuse cap (shared with O886 / Q414; review of Q436 round 1): held while the team-code hold is on -- never
    //   heavier than the old rule (it struck him, the Q443 hold settles his second strike with him excused); with the hold
    //   off (restored with the Q442 fix) convicted as a leave, as any absent seat. Never struck or flagged either way.
    const heldA = play(9, 0x43C4, { kind: 'A', seed: capSeed(false) });
    T('[3] ranked 3V3 past the cap (2 listed in 7 days), no strike of his in the window, the hold on: held -- no leave, no fine, no excuse spent, nothing owed, never struck or flagged, the finishers settled',
      heldOk(heldA, false), heldStr(heldA));
    const heldB = play(9, 0x43C5, { kind: 'A', seed: capSeed(true) });
    T('[3] ranked 3V3 past the cap with a strike of his in the window, the hold on: held the same (no second strike either)', heldOk(heldB, true), heldStr(heldB));
    const capped = play(9, 0x43C3, { kind: 'A', seed: capSeed(false), env: { T2LD_HOLD_LONE: '0' } });
    T('[3] ranked 3V3 past the cap (2 listed in 7 days), the hold off (T2LD_HOLD_LONE=0): convicted as a leave (the fine), nothing owed, never struck or flagged, the finishers settled',
      capped.ok && settledAt(capped) === 2 && leavesOf(capped, P[0]) === 1 && edOf(capped, P[0]) === 2 && ptsAll(capped, P[0]).length === 1 && ptsAll(capped, P[0])[0] < 2000
      && !capped.runs.some((r) => cqAt(r, P[0])) && strikesOf(last(capped), P[0]) === 0 && !capped.runs.some((r) => flaggedOf(r, capped.key))
      && /\(Q414\)[^|]*\| 1 \/ 0 \/ 1 \/ 0 \|/.test(capped.runs[2].summary) && /\(Q436\)[^|]*\| 1 \/ 0 \/ 0 \|/.test(capped.runs[2].summary), J({ lv: lvOf(capped, P[0]), pts: ptsAll(capped, P[0]) }));
    const cappedB = play(9, 0x43C6, { kind: 'A', seed: capSeed(true), env: { T2LD_HOLD_LONE: '0' } });
    T('[3] ranked 3V3 past the cap with a strike of his in the window, the hold off: convicted as a leave the same, no second strike', cappedB.ok && settledAt(cappedB) === 2 && leavesOf(cappedB, P[0]) === 1
      && ptsAll(cappedB, P[0]).length === 1 && ptsAll(cappedB, P[0])[0] < 2000 && strikesOf(last(cappedB), P[0]) === 1 && strikesOf(last(cappedB), P[0], cappedB.key) === 0, J({ lv: lvOf(cappedB, P[0]), pts: ptsAll(cappedB, P[0]) }));
  }

  // ---- [4] main(), shape C ----
  {
    const ctl5 = play(5, 0x43D0, { kind: 'ctl' }), c5 = play(5, 0x43D1, { kind: 'C' });
    T('[4] all runs exit 0', ctl5.ok && c5.ok, [ctl5, c5].map((m) => m.runs.map((r) => r.code).join(',')).join(' / '));
    T('[4] quick 2V2, the host naming his teammate: settled in the same run as the key without the refusal, every seat paid the same',
      settledAt(c5) === settledAt(ctl5) && settledAt(c5) >= 2 && samePay(c5, ctl5), 'at=' + settledAt(c5) + '/' + settledAt(ctl5) + ' ' + payStr(c5, ctl5));
    T('[4] quick 2V2: nobody flagged or struck, no lone dissent verdict, the log line and the summary row',
      !c5.runs.some((r) => flaggedOf(r, c5.key)) && c5.ros.every((sid) => fOf(last(c5), sid) === 0 && strikesOf(last(c5), sid) === 0) && !((sgOf(last(c5)).t2lv || {})[c5.key])
      && /seat 0 = \S+ refused the team gamble \(1 record\(s\)\) naming only his own team's seat\(s\) 1, his table the others' cell by cell -- read as the agreed winner \(team 0\), not a dissenter, nobody flagged \(Q436\)/.test(c5.runs[2].out)
      && /\(Q436\)[^|]*\| 0 \/ 1 \/ 0 \|/.test(c5.runs[2].summary) && /a lone refusal naming its own team read as agreed: 1/.test(c5.runs[2].out), (c5.runs[2].summary.split('\n').find((l) => /Q436/.test(l)) || '').slice(-80));
    const ctl9 = play(9, 0x43D2, { kind: 'ctl', k: { win: 1 } }), c9 = play(9, 0x43D3, { kind: 'C', k: { ref: 1, win: 1 }, seed: prior(P[1], 9) });
    T('[4] ranked 3V3, a joiner of the losing host team naming his own host, his strike already in the window: no leave, no second strike, every seat\'s points as without the refusal',
      ctl9.ok && c9.ok && settledAt(c9) === settledAt(ctl9) && leavesOf(c9, P[1]) === 0 && strikesOf(last(c9), P[1]) === 1 && strikesOf(last(c9), P[1], c9.key) === 0
      && P.every((sid) => ptsLast(c9, sid) === ptsLast(ctl9, sid) && ptsLast(c9, sid) != null), J(P.map((sid) => [ptsLast(c9, sid), ptsLast(ctl9, sid)])));
    // the old rule where the names do not clear him
    for (const [what, k, hash] of [['naming the other team\'s seat', { tag: 1 << 2 }, 0x43D4], ['naming nobody', { tag: null }, 0x43D5]]) {
      const m = play(5, hash, { kind: 'C', k });
      T('[4] a refusal ' + what + ': the old rule -- struck, verdict free, flagged, the key never rated', m.ok && strikesOf(last(m), P[0], m.key) === 1
        && ((sgOf(last(m)).t2lv || {})[m.key] || {}).v === 'free' && fOf(last(m), P[0]) === 1 && m.ros.every((sid) => ratingN(m, sid) === 0)
        && /\(Q436\)[^|]*\| 0 \/ 0 \/ 0 \|/.test(m.runs[2].summary), J({ s: strikesOf(last(m), P[0], m.key), f: fOf(last(m), P[0]) }));
    }
  }

  // ---- [5] seedcap ----
  {
    const g = keyA(8, 0x43E0).map(asSc), m = H.keyOf(g[0].d);
    const x = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g);
    T('[5] A: pendingOfGroup audits the finishers\' vector, only their seats claimants', !!x && J(x.scores) === J(FIN) && J(x.self) === J([1, 2, 3, 4, 5]), J(x && { s: x.scores, self: x.self }));
    const p1 = sc.pickAuditable({ audited: {}, chain: {} }, { [m]: g });
    T('[5] A: picked, marked ee', p1.length === 1 && p1[0].ee === 1);
    const lone = { audited: { [m]: { c: 50000, s: 3100, o: 0, t: 1, k: 'root' } }, chain: {} };
    const p2 = sc.pickAuditable(lone, { [m]: g });
    T('[5] A: audited earlier on the early record alone -> taken again once, a re-audit on the finishers\' vector', p2.length === 1 && p2[0].ee === 1 && p2[0].re === 1 && J(p2[0].scores) === J(FIN));
    const c = keyC(5, 0x43E1).map(asSc), mc = H.keyOf(c[0].d);
    const y = sc.pendingOfGroup({ audited: {}, chain: {} }, mc, c);
    T('[5] C: the one vector audited, every seat a claimant', !!y && J(y.scores) === J(FIN.slice(0, 4)) && J(y.self) === J([0, 1, 2, 3]), J(y && { s: y.scores, self: y.self }));
  }

  // ---- [6] mutants ----
  {
    const unitsA = [
      ['[6b] the opening host only', "if (team && (eSeat !== 0 || team2WinTeamOf(fin) == null)) return null;", "if (team && team2WinTeamOf(fin) == null) return null;",
        () => keyA(8, 0x43F0).map((r, i) => (i === 0 ? parsed(P[0], resD(8, 0x43F0, 0, {}), 0) : i === 1 ? parsed(P[1], earlyD(8, 0x43F0, { seat: 1 }), 1) : r))],
      ['[6c] one winner the finishers name', "if (team && (eSeat !== 0 || team2WinTeamOf(fin) == null)) return null;", "if (team && eSeat !== 0) return null;", () => keyA(8, 0x43F1, { fin: { 5: { rank: 1 } } })],
      ['[6d] the seat count of the code', "  if (team && pc !== 2 * teamSizeOfMt(mt)) return null;\n", '', () => keyA(8, 0x43F2, { ros: P.slice(0, 4) })],
      ['[6e] only the 2V2 / 3V3 codes', 'if (isEndlessMt(mt) || isBotMt(mt) || (isTeamMt(mt) && !team) || pc < 3 || pc > 6) return null;', 'if (isEndlessMt(mt) || isBotMt(mt) || pc < 3 || pc > 6) return null;', () => keyA(3, 0x43F3)],
    ];
    for (const [tag, from, to, grp] of unitsA) {
      const s = mutant('validate.js', from, to, tag);
      if (!s) continue;
      const mv = require(s);
      T(tag + ' mutant: the unit case in [1] goes red (taken as the shape)', v.earlyEndVerdict(grp(), vecOf) === null && !!mv.earlyEndVerdict(grp(), vecOf));
    }
    const unitsC = [
      ['[6f] every named seat on his team', 'if (teamOfSeat(s, ts) !== teamOfSeat(seat, ts)) return null; named.add(s);', 'named.add(s);', () => keyC(5, 0x43F4, { tag: 1 << 2 })],
      ['[6g] a name at all', 'if (!m || (m & (1 << seat)) || (m >> pc)) return null;', 'if ((m & (1 << seat)) || (m >> pc)) return null;', () => keyC(5, 0x43F5, { tag: null })],
      ['[6h] not his own seat', 'if (!m || (m & (1 << seat)) || (m >> pc)) return null;', 'if (!m || (m >> pc)) return null;', () => keyC(5, 0x43F6, { tag: 1 | 2 })],
      ['[6i] his table the others\'', 'if ((r.d[5] | 0) !== seat || vk(r) !== v0 || lv(r) !== l0 || !fin(r)) return null;', 'if ((r.d[5] | 0) !== seat || lv(r) !== l0 || !fin(r)) return null;', () => keyC(5, 0x43F7, { r: { sc: [9300, 8100, 7400, 6900] } })],
      ['[6j] finished', 'if ((r.d[5] | 0) !== seat || vk(r) !== v0 || lv(r) !== l0 || !fin(r)) return null;', 'if ((r.d[5] | 0) !== seat || vk(r) !== v0 || lv(r) !== l0) return null;', () => keyC(5, 0x43F8, { r: { disp: 4 } })],
      // a second refusal sits among the others: their winner (and sanity's rank-conflict) is gone too -- two guards, both off
      ['[6k] one refuser', ['if (refusers.length !== 1) return null;', '  if (win == null || sanityFlags(rest).length) return null;\n'], ['if (refusers.length < 1) return null;', ''],
        () => keyC(8, 0x43F9, { fin: { 4: { rank: 0 } } })],
      ['[6l] no claim of his beside it', 'if (!mine.every(refused) || new Set(rest.map(who)).size < 2 || !rest.every(fin)) return null;', 'if (new Set(rest.map(who)).size < 2 || !rest.every(fin)) return null;',
        () => keyC(5, 0x43FA).concat([parsed(P[0], resD(5, 0x43FA, 0, { tag: 2 }), 5)])],
      // the others' winner: sanity's rank-conflict reads the same, so both off
      ['[6m] the others name one winner', '  if (win == null || sanityFlags(rest).length) return null;\n', '', () => keyC(8, 0x43FB, { fin: { 5: { rank: 1 } } })],
      ['[6n] no gamble block', '|| !who(r) || gambleTagOf(r) || liftOrphanBlockOf(r)) return null;\n  const refusers', '|| !who(r) || liftOrphanBlockOf(r)) return null;\n  const refusers', () => keyC(8, 0x43FC, { fin: { 2: { gt: 1 } } })],
      ['[6t] no lift block (Q339) in the key', "|| !who(r) || gambleTagOf(r) || liftOrphanBlockOf(r)) return null;\n  const refusers", "|| !who(r) || gambleTagOf(r)) return null;\n  const refusers",
        () => keyC(5, 0x4405).map((r, i) => (i === 2 ? parsed(P[2], resD(5, 0x4405, 2, { lift: 2 | (1 << 8) }), 2) : r))],
      // two of the others on one seat: sanity's self-seat reads the same, so both off
      ['[6u] the others on distinct seats', ['if (new Set(taken).size !== taken.length || voidByConsensus', '  if (win == null || sanityFlags(rest).length) return null;\n'], ['if (false || voidByConsensus', '  if (win == null) return null;\n'],
        () => keyC(5, 0x4406).map((r, i) => (i === 3 ? parsed(P[3], resD(5, 0x4406, 2, {}), 3) : r))],
      ['[6o] the seat the others name him at', 'if ((r.d[5] | 0) !== seat || vk(r) !== v0 || lv(r) !== l0 || !fin(r)) return null;', 'if (vk(r) !== v0 || lv(r) !== l0 || !fin(r)) return null;',
        () => keyC(5, 0x43FD).map((r, i) => (i === 0 ? parsed(P[0], resD(5, 0x43FD, 1, { rank: 0, tag: 2 }), 0) : r))],
    ];
    for (const [tag, from, to, grp] of unitsC) {
      const s = mutant('validate.js', from, to, tag);
      if (!s) continue;
      const mv = require(s);
      T(tag + ' mutant: the unit case in [1] goes red (taken as the shape)', v.t2OwnNameVerdict(grp()) === null && !!mv.t2OwnNameVerdict(grp()));
    }
    const cp = mutant('validate.js', "const g2 = g.map((r) => { if (who(r) !== sid) return r; const d = r.d.slice(); d[6] = rank;", "const g2 = g.map((r) => { if (who(r) !== sid) return r; const d = r.d.slice();", '[6p]');
    if (cp) { const mv = require(cp); const z = mv.t2OwnNameVerdict(keyC(5, 0x4400)); T('[6p] mutant (the copy keeps rank 0): [1] goes red -- no winner to settle on', !!z && mv.team2WinTeamOf(z.g) === null && v.team2WinTeamOf(v.t2OwnNameVerdict(keyC(5, 0x4400)).g) === 0); }
    // every record of his is copied (a refusal written twice: two shards)
    const two = () => keyC(5, 0x4407).concat([parsed(P[0], resD(5, 0x4407, 0, { rank: 0, tag: 2 }), 5)]);
    const hisRanks = (z) => (z ? z.g.filter((r) => r.steamID === P[0]).map((r) => r.d[6]) : null);
    const cv = mutant('validate.js', 'const g2 = g.map((r) => { if (who(r) !== sid) return r;', 'let _f = 0; const g2 = g.map((r) => { if (who(r) !== sid || _f++) return r;', '[6v]');
    if (cv) { const mv = require(cv); T('[6v] mutant (only his first record copied): [1] goes red -- his second refusal left at rank 0', J(hisRanks(v.t2OwnNameVerdict(two()))) === '[1,1]' && J(hisRanks(mv.t2OwnNameVerdict(two()))) === '[1,0]', J([hisRanks(v.t2OwnNameVerdict(two())), hisRanks(mv.t2OwnNameVerdict(two()))])); }
    // the real main() under mutants: the repro of both shapes (main before this = each branch off)
    const offA = mutant('validate.js', "  if (team && pc !== 2 * teamSizeOfMt(mt)) return null;\n", "  if (team) return null;\n", '[6a]');
    if (offA) {
      const m = play(8, 0x4401, { kind: 'A', script: offA });
      T('[6a] mutant (the team codes off = main before this): [3] goes red -- the host struck as the lone dissenter of his own match (own-side host, verdict free), flagged, nobody rated (the 11-21..11-23 keys)',
        m.ok && strikesOf(last(m), P[0], m.key) === 1 && ((sgOf(last(m)).t2lv || {})[m.key] || {}).v === 'free' && fOf(last(m), P[0]) === 1 && P.every((sid) => ratingN(m, sid) === 0)
        && /team2 lone dissent .*own-side host\) -> strike, verdict free/.test(m.runs.map((r) => r.out).join('\n')), J({ s: strikesOf(last(m), P[0], m.key), f: fOf(last(m), P[0]) }));
      const m2 = play(9, 0x4402, { kind: 'A', script: offA, seed: prior(P[0], 9), env: { T2LD_HOLD_LONE: '0' } });   // Q443's hold (when in) off: the rule the live keys met
      T('[6a] mutant, ranked with his strike in the window: [3] goes red -- the second strike settles the key and judges him a leaver (the fine; 182117ac\'s shape)',
        m2.ok && leavesOf(m2, P[0]) === 1 && ptsAll(m2, P[0]).length === 1 && ptsAll(m2, P[0])[0] < 2000 && strikesOf(last(m2), P[0], m2.key) === 1, J({ lv: lvOf(m2, P[0]), pts: ptsAll(m2, P[0]) }));
    }
    const offC = mutant('validate.js', '    const on = t2OwnNameVerdict(g);\n', '    const on = null;\n', '[6q]');
    if (offC) {
      const m = play(5, 0x4403, { kind: 'C', script: offC });
      T('[6q] mutant (the own-team name not read): [4] goes red -- struck, free, flagged, nobody rated', m.ok && strikesOf(last(m), P[0], m.key) === 1 && fOf(last(m), P[0]) === 1 && m.ros.every((sid) => ratingN(m, sid) === 0));
    }
    // the past-cap hold (review of Q436 round 1) gone: [3]'s two held cells convict him (the fine) while the hold is on
    const noHold = mutant('validate.js', "const edHeld = new Set((c.early && isSubScoreMt(matchType) && T2_EARLY_HOLD) ? edPlan.capped.filter((y) => y.by === 'early').map((y) => y.h) : []);", 'const edHeld = new Set();', '[6s]');
    if (noHold) {
      for (const ws of [false, true]) {
        const m = play(9, ws ? 0x4409 : 0x4408, { kind: 'A', script: noHold, seed: capSeed(ws) });
        T('[6s] mutant (the past-cap hold gone), ' + (ws ? 'a strike of his in the window' : 'no strike of his') + ': [3] goes red -- convicted as a leave (the fine) with the hold on',
          m.ok && !heldOk(m, ws) && leavesOf(m, P[0]) === 1 && ptsAll(m, P[0]).length === 1 && ptsAll(m, P[0])[0] < 2000, heldStr(m));
      }
    }
    const cnt = mutant('validate.js', 'consistent++; early.settle++; if (ee.team) early.team++;', 'consistent++; early.settle++;', '[6r]');
    if (cnt) { const mv = require(cnt); const gr = mv.groupRecords(keyA(8, 0x4404), { vecOf, MAX_SEATS: 8, starts: {} }); T('[6r] mutant (the team key not counted): [2] goes red', gr.early.settle === 1 && gr.early.team === 0); }
  }
} finally {
  for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} }
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (team2-host-early-end) ===' : '=== PASS -- 0 fail (team2-host-early-end) ===');
process.exit(failN ? 1 : 0);
