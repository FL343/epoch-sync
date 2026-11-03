'use strict';
// Q373 (cloud audit 2026-11): a group held for an absent seat must not lose its results to shard rotation.
// A consistent group waits for a seat that wrote no result (absence grace 5 min, then the leave wait Q121: up to 60 min from
// the absent player's own start). The players still in the group keep playing meanwhile and each later record of theirs goes
// to their next shard; once every writer's result of the held key is overwritten the job never sees it again: a friends' room
// or a bot match never settles (nobody gets the match's XP), a matchmade one voids at the start verdict (no rating, no points)
// while the absent player's own start still convicts him. Cloud test #483 (three friends' rooms back to back on the three test
// shards, the first one's host killed): the third match's starts overwrote the first match's results 17 minutes into its leave
// wait and that key never settled. Now each run that holds a group keeps the results it read, sealed, on the key's start entry
// (pend.kr / pend.kt), and a later run reads a kept result in place of the one its shard lost.
//   [1] units: keptKeys / keptSeal / keptOpen (no salt, round trip, deterministic blob, another salt, a damaged blob, no
//       plaintext account id or detail bytes in the blob)
//   [2] units: keptKeep (results only -- no start / confession / note / endless / a record read from its kept copy; the first
//       keep time; a changed record re-seals; a stamp from the future restarts the clock; the per-key cap; no keys)
//   [3] units: keptRecords (read only when no result of the key is on the shards: the whole group gone; one result up -- his,
//       a rewrite, another writer's -- reads none, so Q185 / Q136 / Q149 keep their rules for a group only part of which is
//       gone; an incomplete read reads none; a processed key, an expired keep, a blob filed under another pid, a damaged
//       one: dropped; no keys: nothing read and nothing dropped; the shard label)
//   [4] KEPT_REC_MAX_MS from the environment: a value under the floor (absence grace + leave wait + start floor) is raised
//   [5] end to end, a friends' room of three (the #483 shape): seat 0 killed after his start, seats 1 / 2 finish; their
//       results are overwritten during the leave wait -- the key still settles when the wait is over, both get their XP once;
//       the kept copy is gone after the settle; the starts file carries no account id in clear
//   [6] end to end, ranked FFA of three (the leave-confirm quitter): the same overwrite -- the winner rated up, the quitter
//       convicted once, the second place not convicted
//   [7] controls: an honest friends' room (everybody's result up) settles with nothing kept; a held group whose results stay
//       up settles the same with or without the kept copy (the shard's record is the one read)
//   [8] wiring pins (read ahead of the census and every gate, kept at both holds, the processed / starts loads moved once,
//       summary row, exports)
//   [9] mutation self-checks (the kept copy not read -> [5] [6] red; not kept at the holds -> [5] [6] red; read while a
//       result of the key is up -> the copy read next to that record; a record moved to a split key kept as moved -> [10]
//       paid twice)
//   [10] end to end, a friends' room split into tables (Q220, the Q373 review): two tables past the Q200 maturity settle on
//       keys of their own, then a third table writes on the same key with one seat that only started and waits on its split
//       key. Its results stay up: never read from the copy, each finisher paid once (the first draft sealed the moved record
//       with the letter key in its match hash -- 0 once encoded --, read it back every run as key 0_<seed>_<type> and paid
//       it there too). Its results rotate off mid-wait: read back under the raw match hash, split onto the same table key,
//       paid once in the run the wait ends -- the same run as with the results up
// End to end over the REAL validate.js main() against the offline board stub of test/lib/settle-stub.js.
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
process.env.STATE_SALT = 's';   // the child runs' salt, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000;
const SRC = H.SRC;

const K = v.keptKeys('s');
const resOf = (sid, d, shard) => v.resultRecOf(sid, shard == null ? 'shard_1' : shard, d);

// ---- [1] ----
console.log('[1] keptKeys / keptSeal / keptOpen');
{
  const A = H.SID(37301), B = H.SID(37302);
  const d = H.rec(0xB1, 10, 0x37301, 1, 1, true, [A, B], [300, 500]);
  T('no salt: no keys', v.keptKeys('') === null && v.keptKeys(undefined) === null);
  const b = v.keptSeal(resOf(B, d), K);
  const o = v.keptOpen(b, K);
  T('round trip: the writer, the record and its shard come back', !!o && o.s === B && o.l === 'shard_1' && J(v.decodeDetails(o.h)) === J(d), J(o));
  T('the same record seals to the same blob (no churn in the state file)', v.keptSeal(resOf(B, d), K) === b);
  const d2 = d.slice(); d2[11] = 501;
  T('another record seals to another blob, with another IV', v.keptSeal(resOf(B, d2), K) !== b
    && Buffer.from(v.keptSeal(resOf(B, d2), K).slice(3), 'base64').subarray(0, 12).toString('hex') !== Buffer.from(b.slice(3), 'base64').subarray(0, 12).toString('hex'));
  T('another salt does not open it', v.keptOpen(b, v.keptKeys('t')) === null);
  const raw = Buffer.from(b.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  T('a damaged blob does not open', v.keptOpen('v1.' + raw.toString('base64'), K) === null && v.keptOpen('v2.' + b.slice(3), K) === null
    && v.keptOpen('', K) === null && v.keptOpen(null, K) === null && v.keptOpen(b, null) === null && v.keptOpen('v1.AAAA', K) === null);
  const lo = String(H.sidPair(B)[0] >>> 0), hex = v.encodeDetails(d);
  T('the blob holds no account id and no detail bytes in clear', b.indexOf(B) < 0 && b.indexOf(A) < 0 && b.indexOf(lo) < 0
    && Buffer.from(b.slice(3), 'base64').toString('latin1').indexOf(B) < 0 && b.indexOf(hex.slice(0, 24)) < 0);
}

// ---- [2] ----
console.log('[2] keptKeep');
{
  const A = H.SID(37311), B = H.SID(37312), C = H.SID(37313);
  const ros = [A, B, C];
  const rB = resOf(B, H.rec(0xB1, 10, 0x37311, 1, 1, true, ros, [100, 500, 300]));
  const rC = resOf(C, H.rec(0xB1, 10, 0x37311, 2, 2, false, ros, [100, 500, 300]));
  const sA = { start: true, steamID: A, shard: 'shard_0', d: H.rec(0xB2, 10, 0x37311, 0, 0, false, ros) };
  const cA = { confess: true, steamID: A, shard: 'shard_2', d: H.rec(0xB5, 10, 0x37311, 0, 0, false, ros) };
  const nA = { note: true, steamID: A, shard: 'shard_3', d: H.rec(0xBD, 10, 0x37311, 0, 0, false, ros) };
  const pend = {};
  T('two results kept, nothing else', v.keptKeep(pend, [sA, rB, cA, nA, rC], 1000, K) === 2 && Object.keys(pend.kr || {}).sort().join() === [v.pid(B), v.pid(C)].sort().join(), J(pend));
  T('the first keep time is set', pend.kt === 1000);
  const before = J(pend.kr);
  T('kept again unchanged: the same blobs, the time stays', v.keptKeep(pend, [rB, rC], 5000, K) === 2 && J(pend.kr) === before && pend.kt === 1000);
  const rB2 = resOf(B, H.rec(0xB1, 10, 0x37311, 1, 1, true, ros, [100, 510, 300]));
  T('a rewrite of his result re-seals it', v.keptKeep(pend, [rB2], 6000, K) === 1 && J(pend.kr) !== before && v.decodeDetails(v.keptOpen(pend.kr[v.pid(B)], K).h)[11] === 510);
  T('a record read from its kept copy is not kept again', v.keptKeep({}, [resOf(B, rB.d, v.KEPT_TAG + 'shard_1')], 1000, K) === 0);
  const end = resOf(B, H.rec(0xB1, 7, 0x37311, 1, 1, true, ros, [100, 500, 300]));
  T('endless (type 7): not kept', v.isEndlessMt(7) && v.keptKeep({}, [end], 1000, K) === 0);
  T('no keys (no salt): nothing kept', (() => { const p = {}; return v.keptKeep(p, [rB], 1000, null) === 0 && p.kr === undefined; })());
  const fut = { kr: {}, kt: 9e15 };
  v.keptKeep(fut, [rB], 7000, K);
  T('a first keep time from the future restarts the clock', fut.kt === 7000);
  const cap = { kr: {} }; for (let i = 0; i < v.KEPT_REC_CAP; i++) cap.kr['x' + i] = 'v1.x'; cap.kt = 1;
  T('the per-key cap: no new writer past it, a kept one still refreshed', v.keptKeep(cap, [rB], 2, K) === 0 && Object.keys(cap.kr).length === v.KEPT_REC_CAP
    && (() => { cap.kr[v.pid(B)] = 'old'; delete cap.kr.x0; return v.keptKeep(cap, [rB], 3, K) === 1; })());
}

// ---- [3] ----
console.log('[3] keptRecords');
{
  const A = H.SID(37321), B = H.SID(37322), C = H.SID(37323);
  const ros = [A, B, C], m = 0x37321 + '_1234_10';
  const rB = resOf(B, H.rec(0xB1, 10, 0x37321, 1, 1, true, ros, [100, 500, 300]));
  const rC = resOf(C, H.rec(0xB1, 10, 0x37321, 2, 2, false, ros, [100, 500, 300]));
  const fresh = (kt) => { const p = { t0: 0, mt: 10 }; v.keptKeep(p, [rB, rC], kt, K); return p; };
  let pending = { [m]: fresh(1000) };
  let r = v.keptRecords(pending, [], new Set(), 2000, K);
  T('both results gone from the shards: both read from the kept copy', r.recs.length === 2 && r.dropped === 0
    && r.recs.map((x) => x.steamID).sort().join() === [B, C].sort().join(), J(r));
  T('read in the shard read\'s shape (shard label kept:<shard>, roster, disposition)', r.recs.every((x) => x.shard === v.KEPT_TAG + 'shard_1' && x.roster && x.roster[1] === B
    && Object.keys(x.roster).length === 3 && x.dispCode === 0 && x.disp === v.dispName(0) && J(x.d) === J(x.steamID === B ? rB.d : rC.d)), J(r.recs[0]));
  r = v.keptRecords(pending, [resOf(B, rB.d, 'shard_7')], new Set(), 2000, K);
  T('his result for the key on a shard: nothing read from the copy (the shards settle the key)', r.recs.length === 0 && r.dropped === 0 && Object.keys(pending[m].kr).length === 2);
  r = v.keptRecords(pending, [resOf(B, H.rec(0xB1, 10, 0x37321, 1, 1, true, ros, [100, 600, 300]), 'shard_7')], new Set(), 2000, K);
  T('a rewrite of his on a shard: the rewrite is read, not the copy next to it', r.recs.length === 0);
  r = v.keptRecords(pending, [resOf(C, rC.d, 'shard_9')], new Set(), 2000, K);
  T('only part of the group gone (one result still up): nothing read from the copy (Q185 / Q136 rules as before)', r.recs.length === 0);
  r = v.keptRecords(pending, [], new Set(), 2000, K, false);
  T('an incomplete shard read: nothing read, nothing dropped', r.recs.length === 0 && r.dropped === 0 && Object.keys(pending[m].kr).length === 2);
  r = v.keptRecords(pending, [], new Set(), 2000, K, true);
  T('a complete read with the whole group gone: both read', r.recs.length === 2);
  const otherKey = resOf(B, H.rec(0xB1, 10, 0x37399, 1, 1, true, ros, [1, 2, 3]));
  r = v.keptRecords(pending, [otherKey], new Set(), 2000, K);
  T('his result for another key on the shards does not stand in for this one', r.recs.length === 2);
  r = v.keptRecords(pending, [], new Set([m]), 2000, K);
  T('a processed key: the copy is dropped, nothing read', r.recs.length === 0 && r.dropped === 2 && pending[m].kr === undefined && pending[m].kt === undefined);
  pending = { [m]: fresh(1000) };
  r = v.keptRecords(pending, [], new Set(), 1000 + v.KEPT_REC_MAX_MS + 1, K);
  T('past KEPT_REC_MAX_MS: dropped, nothing read', r.recs.length === 0 && r.dropped === 2 && pending[m].kr === undefined);
  pending = { [m]: fresh(1000) };
  r = v.keptRecords(pending, [], new Set(), 1000 + v.KEPT_REC_MAX_MS - 1, K);
  T('just inside KEPT_REC_MAX_MS: read', r.recs.length === 2);
  pending = { [m]: fresh(1000) };
  const kr = pending[m].kr; const hb = v.pid(B), hc = v.pid(C);
  pending[m].kr = { [hb]: kr[hc], [hc]: 'v1.garbage' };   // B's slot holds C's record; C's slot is damaged
  r = v.keptRecords(pending, [], new Set(), 2000, K);
  T('a blob filed under another writer, a damaged blob: dropped, nothing read', r.recs.length === 0 && r.dropped === 2 && pending[m].kr === undefined, J(r));
  pending = { [m]: fresh(1000) };
  r = v.keptRecords(pending, [], new Set(), 2000, null);
  T('no keys (no salt): nothing read, nothing dropped (it waits for a run that can open it)', r.recs.length === 0 && r.dropped === 0 && Object.keys(pending[m].kr).length === 2);
  r = v.keptRecords(pending, [], new Set(), 2000, v.keptKeys('t'));
  T('another salt: the copy is dropped (it cannot be opened), nothing read', r.recs.length === 0 && r.dropped === 2 && pending[m].kr === undefined);
  pending = { [m]: { t0: 0, mt: 10, kr: 'x', kt: 5 }, z: { t0: 0 } };
  r = v.keptRecords(pending, [], new Set(), 6, K);
  T('a malformed copy is dropped; an entry without one is left alone', r.recs.length === 0 && r.dropped === 1 && pending[m].kr === undefined && J(pending.z) === J({ t0: 0 }));
}

// ---- [4] ----
console.log('[4] KEPT_REC_MAX_MS from the environment');
{
  const ev = (val) => {
    const r = spawnSync(process.execPath, ['-e', "process.env.STATE_SALT='s';const v=require(" + J(H.VALIDATE) + ");console.log(JSON.stringify([v.KEPT_REC_MAX_MS,v.LEAVE_CONFIRM_MS,v.ABSENT_GRACE_MS]))"],
      { env: Object.assign({}, process.env, val == null ? {} : { KEPT_REC_MAX_MS: String(val) }), encoding: 'utf8' });
    return JSON.parse((r.stdout || '').trim().split('\n').pop() || '[]');
  };
  const d = ev(null), lo = ev(1), hi = ev(48 * HOUR);
  T('default 24 h', d[0] === 24 * HOUR, J(d));
  T('a value under the floor is raised to absence grace + leave wait + start floor (and the floor is past the leave wait)', lo[0] >= lo[1] + lo[2] && lo[0] < 24 * HOUR, J(lo));
  T('a longer value is taken', hi[0] === 48 * HOUR, J(hi));
}

// ---- end to end harness ----
const PROGRESS = 5, RATING = 6, POINTS = 7;
function boardsOf(recs, prog, seeded) {
  return H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: Object.keys(prog).map((s) => ({ steamID: s, score: prog[s].score, details: prog[s].details || [] })) },
    { id: RATING, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: (seeded || []).map((s) => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] }]);
}
// steps: [[ms since the previous run, records visible]]; every progress write lands
function run(steps, seeded, script) {
  const prog = {}, rs = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, prog, seeded), state ? H.advance(state, ms) : null, null, script || null, 'q373');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, PROGRESS)) prog[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, out: rs.map((r) => r.out).join(''), okAll: rs.length === steps.length && rs.every((r) => r.code === 0) };
}
const xpPosts = (t, sid) => [].concat(...t.rs.map((r) => H.postsOf(r, PROGRESS, sid)));
const ptsPosts = (t, sid) => [].concat(...t.rs.map((r) => H.postsOf(r, POINTS, sid)));
const processedIn = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const keptIn = (r) => { const st = r.state.STARTS_FILE || {}; return Object.keys(st).filter((k) => st[k] && st[k].kr); };
const STEP = 7 * MIN;   // past the 5-minute start age, the 4-minute roster confirmation and the 5-minute absence grace

// [5] a friends' room of three, the host (seat 0) killed after his start: seats 1 / 2 finish. Third run on, their results are
//   overwritten (by the next room's starts, as on the three test shards); the host's own start stays up.
const ROOM = (hash, P) => {
  const sc = [100, 500, 300], ros = P;
  const S = [0, 1, 2].map((seat) => ({ sid: P[seat], d: H.rec(0xB2, 10, hash, seat, 0, false, ros, sc) }));
  const R = [1, 2].map((seat) => ({ sid: P[seat], d: H.rec(0xB1, 10, hash, seat, seat, seat === 1, ros, sc) }));
  const N = [1, 2].map((seat) => ({ sid: P[seat], d: H.rec(0xB2, 10, hash + 1, seat - 1, 0, false, [P[1], P[2]], [0, 0]) }));   // the next room's starts
  const up = S.concat(R), lost = [S[0]].concat(N);
  const L = v.LEAVE_CONFIRM_MS;
  const steps = [[0, S], [STEP, up], [STEP, up], [STEP, lost], [STEP, lost], [L - 4 * STEP + MIN, lost], [STEP, lost], [STEP, lost]];
  return { P, key: hash + '_1234_10', steps, settleRun: 5 };
};
// [6] ranked FFA of three (mt 2), P[2] leaves after his start: the winner and the second place finish, then rotate off
const QUIT = (hash, P) => {
  const sc = [9000, 6000, 3000];
  const S = [0, 1, 2].map((s) => ({ sid: P[s], d: H.rec(0xB2, 2, hash, s, 0, false, P, sc) }));
  const R = [0, 1].map((s) => ({ sid: P[s], d: H.rec(0xB1, 2, hash, s, s + 1, s === 0, P, sc) }));
  const N = [0, 1].map((s) => ({ sid: P[s], d: H.rec(0xB2, 2, hash + 1, s, 0, false, [P[0], P[1], H.SID(37399)], [0, 0, 0]) }));
  const up = S.concat(R), lost = [S[2]].concat(N);
  const L = v.LEAVE_CONFIRM_MS;
  const steps = [[0, S], [12 * MIN, up], [6 * MIN, up], [6 * MIN, lost], [L - 23 * MIN, lost], [STEP, lost]];   // (the next match's starts would mature later)
  return { P, key: hash + '_1234_2', steps, settleRun: 4 };
};
const roomPaid = (c, t) => xpPosts(t, c.P[1]).length === 1 && xpPosts(t, c.P[2]).length === 1 && xpPosts(t, c.P[1])[0].score > 0 && xpPosts(t, c.P[2])[0].score > 0;
const quitSettled = (c, t) => ptsPosts(t, c.P[0]).length === 1 && ptsPosts(t, c.P[0])[0].score > 2500 && ptsPosts(t, c.P[2]).length === 1 && ptsPosts(t, c.P[2])[0].score < 2500
  && leavesOf(t.rs[t.rs.length - 1], c.P[2]) === 1 && leavesOf(t.rs[t.rs.length - 1], c.P[0]) + leavesOf(t.rs[t.rs.length - 1], c.P[1]) === 0;

console.log('[5] end to end: a friends\' room whose results rotate off during the leave wait');
{
  const c = ROOM(0x37350, [37351, 37352, 37353].map(H.SID)), t = run(c.steps);
  T('runs ok', t.okAll, t.out.slice(-1500));
  T('the group is held (absence grace, then the leave wait) and its results kept', /absent-hold/.test(t.rs[1].out) && /leave-wait/.test(t.rs[2].out)
    && keptIn(t.rs[2]).indexOf(c.key) >= 0, t.rs[2].out.slice(-800));
  T('the results rotated off: read from the kept copy, the key still waits', /kept records: 2 read in place of a rotated-off result/.test(t.rs[3].out)
    && /leave-wait/.test(t.rs[3].out) && !processedIn(t.rs[3], c.key), t.rs[3].out.slice(-800));
  T('the wait over: the key settles, both finishers paid once', processedIn(t.rs[c.settleRun], c.key) && roomPaid(c, t),
    J(c.P.map((s) => xpPosts(t, s).map((p) => p.score))) + ' ' + t.rs[c.settleRun].out.slice(-800));
  T('the killed host gets nothing', xpPosts(t, c.P[0]).length === 0);
  T('after the settle the kept copy is gone', keptIn(t.rs[t.rs.length - 1]).length === 0 && /dropped \(settled \/ expired\)/.test(t.out));
  const st = J(t.rs[2].state.STARTS_FILE || {});
  T('the starts file holds no account id in clear', c.P.every((s) => st.indexOf(s) < 0 && st.indexOf(String(H.sidPair(s)[0] >>> 0)) < 0), st.slice(0, 400));
  T('summary row', /\| results of a held group kept by the job \/ read from that copy, their shard row overwritten by a newer record \(Q373\) \| [1-9][0-9]* \/ 0 \|/.test(t.rs[2].summary)
    && /\(Q373\) \| [0-9]+ \/ 2 \|/.test(t.rs[3].summary), (t.rs[3].summary.match(/[^\n]*Q373[^\n]*/) || [''])[0]);
}

console.log('[6] end to end: ranked FFA, the quitter\'s match rotates off during the leave wait');
{
  const c = QUIT(0x37360, [37361, 37362, 37363].map(H.SID)), t = run(c.steps, c.P);
  T('runs ok', t.okAll, t.out.slice(-1500));
  T('read from the kept copy while it waits', /kept records: 2 read in place/.test(t.rs[3].out) && /leave-wait/.test(t.rs[3].out));
  T('the wait over: settled, the winner rated up, the quitter convicted once, the second place not',
    processedIn(t.rs[c.settleRun], c.key) && quitSettled(c, t), J(c.P.map((s) => [ptsPosts(t, s).map((p) => p.score), leavesOf(t.rs[t.rs.length - 1], s)])) + ' ' + t.rs[c.settleRun].out.slice(-600));
}

console.log('[7] controls');
{
  const P = [37371, 37372, 37373].map(H.SID), sc = [500, 300, 100], h = 0x37370;
  const S = [0, 1, 2].map((s) => ({ sid: P[s], d: H.rec(0xB2, 10, h, s, 0, false, P, sc) }));
  const R = [0, 1, 2].map((s) => ({ sid: P[s], d: H.rec(0xB1, 10, h, s, s + 1, s === 0, P, sc) }));
  const t = run([[0, S.concat(R)], [STEP, S.concat(R)], [STEP, S.concat(R)]]);
  T('an honest room: settles, nothing ever kept, no kept line', t.okAll && processedIn(t.rs[1], h + '_1234_10') && t.rs.every((r) => keptIn(r).length === 0)
    && !/kept records:/.test(t.out), t.out.slice(-800));
  const c = ROOM(0x37380, [37381, 37382, 37383].map(H.SID));
  const up = c.steps[1][1];
  const stay = c.steps.map(([ms]) => [ms, ms === 0 ? c.steps[0][1] : up]);
  const ta = run(stay);
  const script = path.join(__dirname, '..', '.mutant-kept-held-' + process.pid + '-ctl.js');
  let tb = null;
  try {
    fs.writeFileSync(script, SRC.split('keptKeep(pend, g.concat(dropRecs), nowMs, keptKeys(SALT))').join('0'));
    tb = run(stay, null, script);
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
  const xp = (t) => J(c.P.map((s) => xpPosts(t, s).map((p) => p.score)));
  T('a held room whose results stay up: never read from the copy, the same pay with or without it', ta.okAll && tb.okAll && !/kept records: [1-9]/.test(ta.out)
    && roomPaid(c, ta) && xp(ta) === xp(tb), xp(ta) + ' vs ' + xp(tb));
}

// [10] a friends' room split into tables (Q220): P and an outside pair PX each wrote a two-seat table on one key; held past
//   the Q200 maturity, the key splits (each table settles on a key of its own). Ten minutes on, a third table Y writes on the
//   same key, Y[2] only his start: Y's table waits for his seat on its split key (absence grace, then the leave wait).
//   lost: from that many runs into Y's wait, every record of the key is off the shards but Y[2]'s start.
const SPLIT3 = (hash, P, PX, Y, lost) => {
  const ros = [P[0], P[1]], xr = [PX[0], PX[1]], sc = [6100, 5200], ysc = [6100, 5200, 100];
  const st = (r, s) => ({ sid: r[s], d: H.rec(0xB2, 10, hash, s, 0, false, r, []) });
  const re = (r, s, v) => ({ sid: r[s], d: H.rec(0xB1, 10, hash, s, s + 1, s === 0, r, v) });
  const S = [st(ros, 0), st(ros, 1), st(xr, 0), st(xr, 1)], R = [re(ros, 0, sc), re(ros, 1, sc), re(xr, 0, sc), re(xr, 1, sc)];
  const YS = [0, 1, 2].map((s) => st(Y, s)), YR = [re(Y, 0, ysc), re(Y, 1, ysc)];
  const up = S.concat(R), late = up.concat(YS, YR), gone = [YS[2]];
  const steps = [[0, S], [12 * MIN, up], [v.STARTS_MATURITY_MS - 2 * MIN, up], [3 * MIN, up], [10 * MIN, late]];
  for (let i = 1; i <= 15; i++) steps.push([5 * MIN, lost && i > lost ? gone : late]);
  return { P, PX, Y, key: hash + '_1234_10', steps };
};
const paidRunsOf = (t, sid) => t.rs.map((r, i) => (H.postsOf(r, PROGRESS, sid).length ? i : -1)).filter((i) => i >= 0);
const splitPaidOnce = (c, t) => [c.Y[0], c.Y[1]].every((s) => xpPosts(t, s).length === 1 && xpPosts(t, s)[0].score > 0);

console.log('[10] end to end: a friends\' room split into tables, its third table waiting for a seat');
const split10 = {};
{
  const P = [37401, 37402].map(H.SID), PX = [37403, 37404].map(H.SID), Y = [37405, 37406, 37407].map(H.SID);
  const cb = SPLIT3(0x37400, P, PX, Y, 0), tb = run(cb.steps);
  T('runs ok (results up)', tb.okAll, tb.out.slice(-1500));
  const yRun = paidRunsOf(tb, Y[0])[0];
  T('the first two tables split and paid once each', /table-split [^\n]*\(Q220\)/.test(tb.out) && [].concat(P, PX).every((s) => xpPosts(tb, s).length === 1),
    J([].concat(P, PX).map((s) => paidRunsOf(tb, s))));
  T('the third table waits on its split key (kept there), its results up: never read from the copy', keptIn(tb.rs[6]).some((k) => /^t[0-9]+_1234_10$/.test(k))
    && !/kept records: [1-9][0-9]* read/.test(tb.out), (tb.out.match(/[^\n]*kept records:[^\n]*/g) || []).join(' | ').slice(0, 600));
  T('its finishers paid once, both in the run its wait ends, on its split key (no key 0_<seed>_<type>)', splitPaidOnce(cb, tb) && yRun >= 15
    && paidRunsOf(tb, Y[1])[0] === yRun && /private settle t[0-9]+_1234_10: 2 writers/.test(tb.rs[yRun].out) && !/settle 0_1234_10/.test(tb.out),
    J(Y.map((s) => paidRunsOf(tb, s))) + ' ' + (tb.out.match(/[^\n]*private settle[^\n]*/g) || []).join(' | '));
  T('the seat that only started gets nothing', xpPosts(tb, Y[2]).length === 0);
  const cc = SPLIT3(0x37410, [37411, 37412].map(H.SID), [37413, 37414].map(H.SID), [37415, 37416, 37417].map(H.SID), 3), tc = run(cc.steps);
  T('runs ok (results rotate off mid-wait)', tc.okAll, tc.out.slice(-1500));
  const wk = (r) => ((/leave-wait (t[0-9]+_1234_10): seat 2 wrote a start but no result yet/.exec(r.out) || [])[1] || '');
  T('read back from the copy under the raw match hash, split onto the same table key, still waiting there',
    tc.rs[9].out.indexOf('kept records: 2 read in place of a rotated-off result of a held group (' + cc.key + ')') >= 0
    && wk(tc.rs[7]) !== '' && wk(tc.rs[9]) === wk(tc.rs[7]) && !processedIn(tc.rs[9], wk(tc.rs[7])), wk(tc.rs[7]) + ' / ' + wk(tc.rs[9]) + ' ' + tc.rs[9].out.slice(-900));
  T('its finishers paid once, in the run its wait ends -- the same run as with the results up -- on its split key', splitPaidOnce(cc, tc)
    && paidRunsOf(tc, cc.Y[0])[0] === yRun && paidRunsOf(tc, cc.Y[1])[0] === yRun && /private settle t[0-9]+_1234_10: 2 writers/.test(tc.rs[yRun].out)
    && !/settle 0_1234_10/.test(tc.out), J(cc.Y.map((s) => paidRunsOf(tc, s))) + ' vs ' + yRun + ' ' + (tc.out.match(/[^\n]*private settle[^\n]*/g) || []).join(' | '));
  T('after the settle the kept copy is gone', keptIn(tc.rs[tc.rs.length - 1]).length === 0);
  split10.yRun = yRun;
}

// ---- [8] wiring pins ----
console.log('[8] wiring pins');
{
  const iRead = SRC.indexOf('    const kr = keptRecords(startsPending, recs, processed, Date.now(), keptKeys(SALT), shardsComplete);');
  const iLog = SRC.indexOf("  console.log('records: ' + recs.length");
  const iCensus = SRC.indexOf('  { const pc0 = persistCensus(recs, processed);');
  const iSeat = SRC.indexOf('  const seatGate = applySeatGate(recs, starts, startsPending, processed);');
  T('the kept copy is read after the shard read, ahead of the records count, the census and the seat gate', iRead > 0 && iLog > iRead && iCensus > iLog && iSeat > iRead,
    [iRead, iLog, iCensus, iSeat].join(' '));
  T('the processed keys and the start entries load once, ahead of the kept read', SRC.split('  const processed = loadProcessed();\n').length === 2
    && SRC.split('  const startsPending = loadStarts();\n').length === 2 && SRC.indexOf('  const processed = loadProcessed();\n') < iRead
    && SRC.indexOf('  const startsPending = loadStarts();\n') < iRead);
  const iAbs = SRC.indexOf('    if (absHold.hold) {'), iLc = SRC.indexOf('    if (lcHold.hold) {');
  const keepLine = '      RUN.keptKeep = (RUN.keptKeep | 0) + keptKeep(pend, g.concat(dropRecs), nowMs, keptKeys(SALT));';
  T('kept at both holds, first thing in each', SRC.split(keepLine).length === 3 && SRC.indexOf(keepLine, iAbs) > iAbs && SRC.indexOf(keepLine, iAbs) < iLc
    && SRC.indexOf(keepLine, iLc) > iLc && SRC.indexOf(keepLine, iLc) - iLc < 120);
  T('the shard read builds its settle record with the same helper', /if \(d\[0\] === SETTLE_MAGIC && d\.length >= 10\) \{\n\s+out\.push\(resultRecOf\(e\.steamID, label, d\)\);/.test(SRC));
  T('exports', ['resultRecOf', 'keptKeys', 'keptSeal', 'keptOpen', 'keptKeep', 'keptRecords'].every((f) => typeof v[f] === 'function') && v.KEPT_TAG === 'kept:' && v.SETTLE_MAGIC === 0xB1);
}

// ---- [9] mutation self-checks ----
console.log('[9] mutation self-checks');
{
  const mutants = [
    ['kept copy not read', '    for (const r of kr.recs) recs.push(r);\n', '    void kr;\n', (script) => {
      const a = ROOM(0x37390, [37391, 37392, 37393].map(H.SID)), ta = run(a.steps, null, script);
      const b = QUIT(0x373A0, [37394, 37395, 37396].map(H.SID)), tb = run(b.steps, b.P, script);
      return ta.okAll && !roomPaid(a, ta) && tb.okAll && !quitSettled(b, tb);
    }, 1],
    ['not kept at the holds', 'keptKeep(pend, g.concat(dropRecs), nowMs, keptKeys(SALT))', '0', (script) => {
      const a = ROOM(0x373B0, [37397, 37398, 37388].map(H.SID)), ta = run(a.steps, null, script);
      const b = QUIT(0x373C0, [37384, 37385, 37386].map(H.SID)), tb = run(b.steps, b.P, script);
      return ta.okAll && !roomPaid(a, ta) && tb.okAll && !quitSettled(b, tb);
    }, 2],
    ['read while a result of the key is up', "      if (complete === false || up.has(d[3] + '_' + d[4] + '_' + d[2])) continue;", '      if (complete === false) continue;', (script) => {
      const r = spawnSync(process.execPath, ['-e', "process.env.STATE_SALT='s';const v=require(" + J(script) + ");const H=require(" + J(path.join(__dirname, 'lib', 'settle-stub.js')) + ");"
        + "const K=v.keptKeys('s');const A=H.SID(1),B=H.SID(2);const d=H.rec(0xB1,10,77,1,1,true,[A,B],[1,2]);const p={t0:0,mt:10};v.keptKeep(p,[v.resultRecOf(B,'shard_1',d)],1,K);"
        + "console.log(v.keptRecords({m:p},[v.resultRecOf(B,'shard_4',d)],new Set(),2,K).recs.length)"], { encoding: 'utf8' });
      return (r.stdout || '').trim() === '1';
    }, 1],
    ['a record moved to a split key kept as moved', '    kr[h] = keptSeal(r.h0 !== undefined ? Object.assign({}, r, { d: Object.assign(r.d.slice(), { 3: r.h0 }) }) : r, keys);\n',
      '    kr[h] = keptSeal(r, keys);\n', (script) => {
        const c = SPLIT3(0x37420, [37421, 37422].map(H.SID), [37423, 37424].map(H.SID), [37425, 37426, 37427].map(H.SID), 0), t = run(c.steps, null, script);
        return t.okAll && !splitPaidOnce(c, t) && xpPosts(t, c.Y[0]).length === 2;
      }, 1],
  ];
  for (const [label, from, to, check, n] of mutants) {
    if (SRC.split(from).length !== n + 1) { bad('[9] ' + label + ': anchor not found ' + n + ' time(s)'); continue; }
    const script = path.join(__dirname, '..', '.mutant-kept-held-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.split(from).join(to));
      T('[9] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (kept-held-records) ===' : '=== PASS -- 0 fail (kept-held-records) ===');
process.exit(failN ? 1 : 0);
