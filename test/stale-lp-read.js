'use strict';
// O481 (an O480 follow-up): a read of the points board from a copy behind this job's own last write no longer costs a match.
// Steam answers each read from one of several copies of a board, and one can be minutes behind a write (the O480 R1 end-to-end
// run saw a write still unread after two minutes). The settle read such an older row, counted from it, and its ForceUpdate wrote
// over the newer one: the points of the match in between and its receipt were gone. Now the job keeps its last write of each
// player in the points-row backlog (PENDING_WRITES_FILE, l = board, score, details, time) for LP_LAST_HOLD_MS (30 min); a read
// without that write's newest receipt, or no row at all, takes the write instead, counted and logged ([stale-read]).
//   [1] the row from before his last match (a lagging copy): the next settle counts from the kept write, both receipts on his
//       row, one [stale-read] (the opponent's row is current and taken as read); the backlog keeps the new write
//   [1b] the same with the hold off (LP_LAST_HOLD_MS=0 -- what the job did before O481): the first match's points and receipt lost
//   [2] no row at all on a complete read: the kept write, not a first-settle seed
//   [3] current rows: the points and rating writes byte for byte what they are with the hold off (the normal path unchanged)
//   [4] a kept write older than 30 min is not used
//   [5] a confession fine reads through it (lpRowOf): the fine comes off the kept write
//   [6] a newer row carrying the kept write's receipt further down its ring is taken as read
//   [7] a failed write waiting for its retry (w) still comes first; [7b] its retry landing in a quiet run is the kept write then;
//       [7c] a confession fine reads it first too (lpRowOf)
//   [8] a kept write for another board (the season turned) is not used
//   [9] an incomplete bulk read: the player's on-demand read is checked the same way
//   [10] a run that dies right after a confession refund landed leaves that refund as his last write on disk (the confession
//       checkpoint saves the backlog): the next settle builds on it, whether its read shows the refund or a copy behind it
//   [12] a write Steam took although nothing says it landed (answered failed, or cut off before an answer) drops the kept write:
//       the next read takes his row as it is, as before O481, not the older kept write (the refund of a player who came back,
//       then his settle). A confession write cut off ends the run before that reaches the disk: the next run refunds once.
//       [12e] a run killed the moment a refund's marker is on disk: the refund is his kept write there already (the
//       checkpoint saves the backlog first), so the next settle counts from it
//       [12f] a lone-1V1 payment (made once: its marker is on disk before it) that merges into his kept write's receipt (the
//       fine of that match), and a run killed the moment the board took it: the payment took the kept write away first, on
//       disk, so the next settle counts from his row as it is; [12g] a run killed once the payment is answered and saved: a
//       read behind it takes the payment
//   [11] pure: lpReadStale, lpLastLive, the prune of l
const path = require('path'), fs = require('fs'), os = require('os');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const clone = (o) => JSON.parse(J(o));

const MIN = 60000;
const POINTS = 7, RATING = 6;
const boardsOf = (recs, pts, fill) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: (fill || []).concat(Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] }))) },
  { id: 8, name: 'cp_bank', entries: [] }]);
const sidOf = (p) => /steamid=([0-9]+)/.exec(p.body)[1];
// the run of a step with a `hook` ({ sid, nth, how, fresh }): validate.js behind a wrapper around the stub's fetch. The nth points
//   POST of that account this run is taken by the board, then answered 500 (how 'fail': a gateway error after the write) or cut
//   off with no answer (how 'throw': the connection reset once the request is out). With `fresh`, this run's reads of the points
//   board show the writes the board took this run (Steam's current copy; a run's fixture is the board as it was when it began).
//   With kill 'refunded', the run is killed (exit 137) the moment a confession state carrying a refund's marker is on disk.
//   With how 'kill' the run is killed the moment the board took that POST (no answer); with 'killsave' that POST is answered
//   and the run is killed the moment the next state file is on disk.
function hookMain(POINTS) {
  const f0 = global.fetch, X = JSON.parse(process.env.X_HOOK || '{}'), took = {};
  let saved = false;
  if (X.kill === 'refunded' || X.how === 'killsave') {
    const fsm = require('fs'), rn = fsm.renameSync;
    fsm.renameSync = function (from, to) {
      const mark = saved || (X.kill === 'refunded' && String(to) === String(process.env.CONFESSIONS_FILE) && /"refunded":1/.test(fsm.readFileSync(from, 'utf8')));
      const res = rn.apply(fsm, arguments);
      if (mark) process.exit(137);
      return res;
    };
  }
  let n = 0;
  global.fetch = async (url, init) => {
    const u = String(url), b = String((init && init.body) || '');
    if (init && init.method === 'POST' && /SetLeaderboardScore/.test(u) && new RegExp('leaderboardid=' + POINTS + '(&|$)').test(b)) {
      const r = await f0(url, init);
      const sid = (/steamid=([0-9]+)/.exec(b) || [])[1], det = (/(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(b) || [])[1];
      if (r.ok) took[sid] = { score: Number((/score=(-?[0-9]+)/.exec(b) || [])[1]), detailData: det ? det.split('%').join('') : '' };
      if (sid === String(X.sid) && ++n === X.nth) {
        if (X.how === 'kill') process.exit(137);
        if (X.how === 'killsave') { saved = true; return r; }
        if (X.how === 'throw') throw new Error('injected: the connection reset after the write');
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'injected' }) };
      }
      return r;
    }
    if (X.fresh && /GetLeaderboardEntries/.test(u) && new RegExp('leaderboardid=' + POINTS + '(&|$)').test(u)) {
      const r = await f0(url, init);
      const around = /RequestAroundUser/.test(u) ? (/steamid=([0-9]+)/.exec(u) || [])[1] : null;
      if (!r.ok || (!around && !/rangestart=1(&|$)/.test(u))) return r;
      const o = JSON.parse(await r.text()), ents = (o.leaderboardEntryInformation && o.leaderboardEntryInformation.leaderboardEntries) || [];
      for (const sid of Object.keys(took)) {
        if (around && sid !== around) continue;
        const e = ents.find((x) => String(x.steamID) === sid);
        if (e) Object.assign(e, took[sid]); else ents.push(Object.assign({ steamID: sid }, took[sid]));
      }
      const t = JSON.stringify(o);
      return { ok: r.ok, status: r.status, text: async () => t };
    }
    return f0(url, init);
  };
  process.argv[1] = process.env.X_VALIDATE;
  require('module').runMain();
}
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stale-lp-read-hook-')), 'hook.js');
fs.writeFileSync(WRAP, '(' + hookMain.toString() + ')(' + POINTS + ');\n');
process.on('exit', () => { try { fs.rmSync(path.dirname(WRAP), { recursive: true, force: true }); } catch (e) {} });
// steps: [[ms, records, env?, lagging?, fails?, hook?]]. The points board holds every write that landed; a run with `lagging`
//   (sid -> { score, details } or null: no row) reads that copy of those players' rows instead -- a copy of the board behind the
//   writes. A run that exits non-zero ends the sequence unless its step says it fails (its state files are carried on, as the
//   persist step of the workflows commits them after a failed run). A hook's POSTs all land (see hookMain).
function run(steps, pts0, files0, fill) {
  const pts = clone(pts0 || {});
  const rs = [];
  let state = null;
  for (const [ms, recs, env, lag, fails, hook] of steps) {
    const seen = clone(pts);
    if (lag) for (const s of Object.keys(lag)) { if (lag[s]) seen[s] = lag[s]; else delete seen[s]; }
    const e = hook ? Object.assign({}, env || {}, { X_HOOK: J(hook), X_VALIDATE: H.VALIDATE }) : (env || null);
    const r = H.runCron(boardsOf(recs, seen, fill), state ? H.advance(state, ms) : (files0 || null), e, hook ? WRAP : null, 'stale-lp-read');
    rs.push(r); state = r.state;
    r.failing = !!(env && env.STUB_FAIL_POST && JSON.parse(env.STUB_FAIL_POST).points);   // the stub logs every POST: these did not land
    if (!r.failing) for (const p of H.setPosts(r, POINTS)) pts[sidOf(p)] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    r.fails = !!fails;
    if (r.code !== 0 && !fails) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.length === steps.length && rs.every((r) => (r.code === 0) !== r.fails) };
}
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_' + mt, mh: hash | 0 };
}
const writesOf = (r, sid) => [].concat(...r.rs.map((x) => H.postsOf(x, POINTS, sid)));
const landedOf = (r, sid) => [].concat(...r.rs.filter((x) => !x.failing).map((x) => H.postsOf(x, POINTS, sid)));
const ringOf = (det) => PP.lpDetailsOf(det).ring;
const staleN = (out) => (String(out).match(/\[stale-read\] points/g) || []).length;
const lastOf = (r, sid) => { const e = ((r.last.state.PENDING_WRITES_FILE || {})[v.pid(sid)]) || {}; return e.l || null; };
const plog = (sid) => v.pid(sid).slice(0, 8);
const HOLD_OFF = { LP_LAST_HOLD_MS: '0' };

// the first match of a pair: A beats B from 2500 / 2400 -> 2538 / 2383 (each row carries this match's receipt)
function firstMatch(A, B, hash, env) {
  const m1 = match(2, hash, [A, B]);
  return { m1, a: run([[0, m1.S, env], [5 * MIN, m1.all, env]], { [A]: { score: 2500 }, [B]: { score: 2400 } }) };
}
// the second match (A beats B again), its runs reading `lag` for the players it names; `wait` = time after the first match
function secondMatch(first, A, B, hash, lag, env, wait, files) {
  const m2 = match(2, hash, [A, B]);
  const st = files || H.advance(first.a.last.state, wait == null ? 5 * MIN : wait);
  return { m2, b: run([[0, m2.S, env, lag], [5 * MIN, m2.all, env, lag]], first.a.pts, st) };
}

console.log('=== a lagging read of the points board takes this job\'s last write instead (O481) ===');
// ---- [1] / [1b] ----
{
  const A = H.SID(4811), B = H.SID(4812);
  const f = firstMatch(A, B, 0x4AB01);
  const la = lastOf(f.a, A);
  T('[1] the first match settles: 2538 / 2383, and the backlog keeps A\'s write (board, score, the details it carried)', f.a.okAll && f.a.pts[A].score === 2538 && f.a.pts[B].score === 2383
    && la && la.b === 'points' && la.v === 2538 && J(la.d) === J(f.a.pts[A].details) && Number.isFinite(la.t) && staleN(f.a.out) === 0, J(f.a.last.state.PENDING_WRITES_FILE));
  const lag = { [A]: { score: 2500, details: [] } };   // A's row as it was before the first match
  const s = secondMatch(f, A, B, 0x4AB02, lag);
  const wa = writesOf(s.b, A), wb = writesOf(s.b, B);
  T('[1] the second settle counts from the kept 2538: A ends at 2576 (not 2538 from the copy\'s 2500)', s.b.okAll && wa.length === 1 && wa[0].score === 2576, J(wa) + ' ' + s.b.out.slice(-600));
  T('[1] ... his row carries both receipts (newest first)', wa.length === 1 && J(ringOf(wa[0].details).map((e) => e.mh)) === J([s.m2.mh, f.m1.mh]), wa.length && J(ringOf(wa[0].details)));
  T('[1] one [stale-read] logged and counted (B\'s row was current)', staleN(s.b.out) === 1 && new RegExp('\\[stale-read\\] points ' + plog(A) + ' \\(points board\\): read 2500 without').test(s.b.out)
    && s.b.rs.some((r) => /\[stale-read\], O481\) \| 1 \|/.test(r.summary)), s.b.out.slice(-800));
  T('[1] B as before: 2383 from his current row', wb.length === 1 && wb[0].score < 2383 && J(ringOf(wb[0].details).map((e) => e.mh)) === J([s.m2.mh, f.m1.mh]), J(wb));
  const l2 = lastOf(s.b, A);
  T('[1] the backlog now keeps the new write', l2 && l2.v === 2576 && J(l2.d) === J(wa[0] && wa[0].details), J(l2));
  // [1b] the hold off: what the job did before
  const o = secondMatch(f, A, B, 0x4AB02, lag, HOLD_OFF);
  const oa = writesOf(o.b, A);
  T('[1b] hold off (the job before O481): A written 2538 from the copy\'s 2500, the first match\'s receipt gone -- the loss O481 fixes', o.b.okAll && oa.length === 1 && oa[0].score === 2538
    && J(ringOf(oa[0].details).map((e) => e.mh)) === J([o.m2.mh]) && staleN(o.b.out) === 0 && !lastOf(o.b, A), J(oa) + ' ' + J(o.b.last.state.PENDING_WRITES_FILE));
  T('[1b] ... and B the same as with the hold on', J(writesOf(o.b, B)) === J(wb), J(writesOf(o.b, B)) + ' vs ' + J(wb));
}
// ---- [2] no row at all ----
{
  const A = H.SID(4821), B = H.SID(4822);
  const f = firstMatch(A, B, 0x4AB11);
  const s = secondMatch(f, A, B, 0x4AB12, { [A]: null });
  const wa = writesOf(s.b, A);
  T('[2] A has no row on a complete read: the kept 2538 is his base (2576), no first-settle seed', s.b.okAll && wa.length === 1 && wa[0].score === 2576
    && J(ringOf(wa[0].details).map((e) => e.mh)) === J([s.m2.mh, f.m1.mh]) && !new RegExp('seed [^\\n]*' + plog(A)).test(s.b.out) && staleN(s.b.out) === 1, J(wa) + ' ' + s.b.out.slice(-600));
  const o = secondMatch(f, A, B, 0x4AB12, { [A]: null }, HOLD_OFF);
  T('[2] hold off: he was seeded again as on a first settle this season', o.b.okAll && new RegExp('seed [^\\n]*' + plog(A) + ' first settle this season').test(o.b.out), o.b.out.slice(-600));
}
// ---- [3] current rows: the normal path unchanged ----
{
  const A = H.SID(4831), B = H.SID(4832);
  const fOn = firstMatch(A, B, 0x4AB21), fOff = firstMatch(A, B, 0x4AB21, HOLD_OFF);
  const on = secondMatch(fOn, A, B, 0x4AB22, null), off = secondMatch(fOff, A, B, 0x4AB22, null, HOLD_OFF);
  const bodies = (...runs) => [].concat(...runs.map((r) => [].concat(...r.rs.map((x) => x.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && /leaderboardid=(6|7)(&|$)/.test(p.body)).map((p) => p.body)))));
  const onB = bodies(fOn.a, on.b), offB = bodies(fOff.a, off.b);
  T('[3] every points and rating write of both matches the same, byte for byte (4 points + 4 rating)', fOn.a.okAll && fOff.a.okAll && on.b.okAll && off.b.okAll
    && onB.length === 8 && J(onB) === J(offB), J(onB) + '\n vs ' + J(offB));
  T('[3] no [stale-read]', staleN(fOn.a.out) === 0 && staleN(on.b.out) === 0 && staleN(off.b.out) === 0, on.b.out.slice(-600));
  const strip = (pw) => { const o = clone(pw || {}); for (const k of Object.keys(o)) { delete o[k].l; if (!Object.keys(o[k]).length) delete o[k]; } return o; };
  T('[3] the backlog the same but for the kept writes (l)', J(strip(on.b.last.state.PENDING_WRITES_FILE)) === J(strip(off.b.last.state.PENDING_WRITES_FILE))
    && lastOf(on.b, A) && lastOf(on.b, B) && !lastOf(off.b, A), J(on.b.last.state.PENDING_WRITES_FILE) + ' vs ' + J(off.b.last.state.PENDING_WRITES_FILE));
}
// ---- [4] older than the hold ----
{
  const A = H.SID(4841), B = H.SID(4842);
  const f = firstMatch(A, B, 0x4AB31);
  const s = secondMatch(f, A, B, 0x4AB32, { [A]: { score: 2500, details: [] } }, null, 31 * MIN);
  const wa = writesOf(s.b, A);
  T('[4] a kept write 36 min old at the settle is not used: the copy\'s 2500 is the base, as before (2538)', s.b.okAll && wa.length === 1 && wa[0].score === 2538 && staleN(s.b.out) === 0, J(wa) + ' ' + s.b.out.slice(-500));
}
// ---- [5] a confession fine ----
{
  const A = H.SID(4851), B = H.SID(4852);
  const f = firstMatch(A, B, 0x4AB41);
  const ros = [A, B], hash = 0x4AB42, sc = [6000, 5000];
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc) }));
  const conf = { sid: A, d: H.rec(0xB5, 2, hash, 0, 0, false, ros, sc, 5) };
  const lag = { [A]: { score: 2500, details: [] } };
  const m = run([[0, S.concat([conf]), null, lag]], f.a.pts, H.advance(f.a.last.state, 5 * MIN));
  const wa = writesOf(m, A);
  const ring = wa.length ? ringOf(wa[0].details) : [];
  T('[5] the fine comes off the kept 2538: one write of 2438 (not 2400), the first match\'s receipt kept under the fine\'s', m.okAll && wa.length === 1 && wa[0].score === 2438
    && ring.length === 2 && ring[0].mh === (hash | 0) && (ring[0].flags & PP.RECEIPT_F.LEAVE) && ring[1].mh === f.m1.mh, J(wa) + ' ' + m.out.slice(-600));
  T('[5] one [stale-read] on the confession read', staleN(m.out) === 1 && new RegExp('\\[stale-read\\] points ' + plog(A) + ' \\(points\\)').test(m.out), m.out.slice(-600));
}
// ---- [6] a newer row that carries the kept receipt further down ----
{
  const A = H.SID(4861), B = H.SID(4862);
  const f = firstMatch(A, B, 0x4AB51);
  const cur = PP.lpDetailsOf(f.a.pts[A].details);
  const newer = { score: 2600, details: PP.lpDetails(cur.rs, PP.receiptPush(cur.ring, 999, 62, 0, 0)) };
  const s = secondMatch(f, A, B, 0x4AB52, { [A]: newer });
  const wa = writesOf(s.b, A);
  T('[6] a row written after the kept one (its receipt second in the ring) is taken as read: the base is 2600', s.b.okAll && wa.length === 1 && wa[0].score > 2600
    && J(ringOf(wa[0].details).map((e) => e.mh)) === J([s.m2.mh, 999, f.m1.mh]) && staleN(s.b.out) === 0, J(wa) + ' ' + s.b.out.slice(-500));
}
// ---- [7] a failed write waiting for its retry (w: 2700, a receipt of match 888 on top of the kept 2538's) ----
//   the quiet run before the settle retries it: [7] that retry fails too, so it still waits at the settle; [7b] that retry lands.
//   (The job itself never leaves w next to l: the write that fails drops l, [12]. The seed sets both, so the order shows.)
{
  const A = H.SID(4871), B = H.SID(4872);
  const f = firstMatch(A, B, 0x4AB61);
  const st = H.advance(f.a.last.state, 5 * MIN);
  const k = v.pid(A), cur = PP.lpDetailsOf(f.a.pts[A].details), pw = st.PENDING_WRITES_FILE = st.PENDING_WRITES_FILE || {};
  (pw[k] = pw[k] || {}).w = { b: 'points', v: 2700, d: PP.lpDetails(cur.rs, PP.receiptPush(cur.ring, 888, 162, 0, 0)), t: Date.now() - 2 * MIN, n: 1 };
  const lag = { [A]: { score: 2500, details: [] } };
  const m2 = match(2, 0x4AB62, [A, B]);
  const s = run([[0, m2.S, { STUB_FAIL_POST: J({ points: 500 }) }, lag], [5 * MIN, m2.all, null, lag]], f.a.pts, clone(st));
  const wa = landedOf(s, A);
  T('[7] still waiting at the settle, the 2700 is the base (not the kept 2538, not the copy\'s 2500): 2738, no [stale-read]', s.okAll && wa.length === 1
    && wa[0].score === 2738 && J(ringOf(wa[0].details).map((e) => e.mh)) === J([m2.mh, 888, f.m1.mh]) && staleN(s.out) === 0, J(writesOf(s, A)) + ' ' + s.out.slice(-500));
  const t = run([[0, m2.S, null, lag], [5 * MIN, m2.all, null, lag]], f.a.pts, clone(st));
  const wt = landedOf(t, A);
  T('[7b] its retry landing in the quiet run (2700), the settle\'s lagging read takes that write: 2738, one [stale-read]', t.okAll && wt.length === 2
    && wt[0].score === 2700 && wt[1].score === 2738 && J(ringOf(wt[1].details).map((e) => e.mh)) === J([m2.mh, 888, f.m1.mh]) && staleN(t.out) === 1, J(wt) + ' ' + t.out.slice(-500));
  // [7c] A quits a match before the retry: his fine reads through lpRowOf, which takes the waiting 2700 before the kept 2538 and
  //   the copy's 2500; the fine lands and supersedes the waiting write (the quiet run's retry then has nothing to do)
  const ros3 = [A, B], hash3 = 0x4AB63, sc3 = [6000, 5000];
  const S3 = ros3.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash3, seat, 0, false, ros3, sc3) }));
  const conf3 = { sid: A, d: H.rec(0xB5, 2, hash3, 0, 0, false, ros3, sc3, 5) };
  const c = run([[0, S3.concat([conf3]), null, lag]], f.a.pts, clone(st));
  const wc = landedOf(c, A), ec = (c.last.state.PENDING_WRITES_FILE || {})[k] || {};
  T('[7c] a confession fine while the write waits comes off the waiting 2700: 2600 (not 2438 off the kept write, not 2400 off the copy)', c.okAll && wc.length === 1
    && wc[0].score === 2600 && J(ringOf(wc[0].details).map((e) => e.mh)) === J([hash3 | 0, 888, f.m1.mh]) && staleN(c.out) === 0, J(wc) + ' ' + c.out.slice(-500));
  T('[7c] ... and supersedes it: no w left, the fine is his kept write', !ec.w && ec.l && ec.l.v === 2600, J(ec));
}
// ---- [8] another board ----
{
  const A = H.SID(4881), B = H.SID(4882);
  const f = firstMatch(A, B, 0x4AB71);
  const st = H.advance(f.a.last.state, 5 * MIN);
  const e = (st.PENDING_WRITES_FILE || {})[v.pid(A)];
  T('[8] (the first match\'s write is kept)', !!(e && e.l), J(st.PENDING_WRITES_FILE));
  if (e && e.l) e.l.b = 'points_s0x';
  const s = secondMatch(f, A, B, 0x4AB72, { [A]: { score: 2500, details: [] } }, null, null, st);
  const wa = writesOf(s.b, A);
  T('[8] a kept write of another board is not used: 2538 from the copy, as before', s.b.okAll && wa.length === 1 && wa[0].score === 2538 && staleN(s.b.out) === 0, J(wa));
}
// ---- [9] an incomplete bulk read: the on-demand read ----
{
  const A = H.SID(4891), B = H.SID(4892);
  const f = firstMatch(A, B, 0x4AB81);
  const fill = [];
  for (let i = 0; i < 5000; i++) fill.push({ steamID: H.SID(1000000 + i), score: 1000, details: [] });   // one full page: PAGE_CAP=1 leaves it incomplete
  const m2 = match(2, 0x4AB82, [A, B]);
  const env = { PAGE_CAP: '1' };
  const s = run([[0, m2.S, env, { [A]: null }], [5 * MIN, m2.all, env, { [A]: null }]], f.a.pts, H.advance(f.a.last.state, 5 * MIN), fill);
  const wa = writesOf(s, A);
  T('[9] the bulk read stops at its cap without A; his on-demand read shows no row either: the kept 2538 is his base (2576)', s.okAll && /hit PAGE_CAP=1/.test(s.out)
    && wa.length === 1 && wa[0].score === 2576 && staleN(s.out) === 1 && new RegExp('\\[stale-read\\] points ' + plog(A) + ' \\(points\\): read no row').test(s.out), J(wa) + ' ' + s.out.slice(-600));
}
// ---- [10] a run that dies right after a confession refund landed ----
//   A quits match m3 (run 1: fined 2538 -> 2438), comes back and finishes it (run 2: refunded 2438 -> 2538, then the run exits
//   on a missing report board before the settle -- STRICT_BOARDS, as in test/one-shot-on-failure.js). The refund is the last
//   write of his on the board; the state on disk must say so too (the confession checkpoint saves the backlog), or the next run
//   would take the fine as his last write and the refund's row as a copy behind it (the same match's receipt changed). Run 3
//   settles m3: from the refund, read as current ([10]) or from a copy still showing the fine ([10b]).
{
  const A = H.SID(4911), B = H.SID(4912);
  const f = firstMatch(A, B, 0x4AB91);
  const m3 = match(2, 0x4AB92, [A, B]);
  const conf = { sid: A, d: H.rec(0xB5, 2, 0x4AB92, 0, 0, false, [A, B], [6000, 5000], 5) };
  const STRICT = { STRICT_BOARDS: '1' };
  const seq = (lag3, env) => run([[0, m3.S.concat([conf]), env], [5 * MIN, m3.all.concat([conf]), Object.assign({}, STRICT, env || {}), null, true],
    [5 * MIN, m3.all.concat([conf]), env, lag3]], f.a.pts, H.advance(f.a.last.state, 5 * MIN));
  const s = seq(null);
  const wa = landedOf(s, A);
  T('[10] run 1 fines A (2438), run 2 refunds him (2538) and then exits on the missing report board', s.okAll && s.rs[1].code === 1 && /::error::report board absent/.test(s.rs[1].out)
    && wa.length >= 2 && wa[0].score === 2438 && wa[1].score === 2538, J(wa) + ' ' + s.rs[1].out.slice(-500));
  const l2 = ((s.rs[1].state.PENDING_WRITES_FILE || {})[v.pid(A)] || {}).l;
  T('[10] the backlog on disk after the failed run keeps the refund as his last write', !!l2 && l2.v === 2538 && J(l2.d) === J(wa[1] && wa[1].details), J(s.rs[1].state.PENDING_WRITES_FILE));
  const ref = seq(null, HOLD_OFF);
  const r3 = H.postsOf(s.rs[2], POINTS, A), o3 = H.postsOf(ref.rs[2], POINTS, A);
  T('[10] run 3 settles m3 from the refund, read as current: the write the job makes with the hold off, no [stale-read]', s.okAll && ref.okAll && r3.length === 1
    && J(r3) === J(o3) && staleN(s.rs[2].out) === 0, J(r3) + ' vs ' + J(o3) + ' ' + s.rs[2].out.slice(-500));
  const t = seq({ [A]: { score: wa[0].score, details: wa[0].details } });   // run 3 reads a copy still showing the fine
  const t3 = H.postsOf(t.rs[2], POINTS, A);
  T('[10b] run 3 reads a copy still showing the fine: the refund is taken instead (the same write as [10]), one [stale-read]', t.okAll && t3.length === 1
    && J(t3) === J(r3) && staleN(t.rs[2].out) === 1, J(t3) + ' vs ' + J(r3) + ' ' + t.rs[2].out.slice(-500));
}
// ---- [12] a points write Steam took although nothing says it landed (W70 review, round 1: the must-fix) ----
//   A beats B (2538). In the next match m3 A quits (run 1: fined 2438 -- his kept write, its receipt "m3, -100, left"), comes
//   back and finishes it. His refund merges into the fine's receipt ("m3, 0") and the settle of m3 into that ("m3, +38"): a row
//   that shows one of those writes no longer shows the fine's receipt as it was.
//   [12] run 2 refunds him (2538): the board takes the POST, Steam answers 500 (a gateway error after the write); run 2 then
//        exits on the missing report board (STRICT_BOARDS, as in [10]); run 3 settles m3 from his row as it is. The job marks a
//        refund done whether its write was answered ok or not, so that row is all he has of it: run 3 counts from it (2576), as
//        the job did before O481. The first draft kept the fine, read the refund's row as a copy behind it ([stale-read]) and
//        counted from the fine: 2476, his refund gone. Control: a refund the board did not take is forfeited (2476), as before
//        O481 -- not this patch's to change.
//   [12b] the usual flow, in one run: the refund (answered 500, taken) and the settle of the match he came back to; the settle
//        reads his current row (the refund) and counts from it
//   [12c] run 2 refunds him (answered ok) and settles m3 (2576); the board takes that settle POST but the connection resets before
//        any answer (a settle's write that throws: forfeited, never made again). The next match counts from his row as it is, as
//        before O481 (the first draft took the refund instead: m3's 38 gone)
//   [12d] a refund whose POST the board takes before the connection resets ends the run (no answer, no marker): the cut drops
//        his kept write in the job, but nothing is saved after it, so on disk the fine stays his kept write. The next run
//        refunds again from it -- his row already shows the refund, so it reads as behind the fine and the refund comes once
//        (before O481: twice)
//   [12e] run 2 refunds him (answered ok) and is killed the moment the refund's marker is on disk (its checkpoint, before the
//        settle): the checkpoint saved the backlog first, so the refund is his kept write there and run 3 settles m3 from it
//        (2576), as the job did before O481. The other order (the first draft) left the fine as his kept write next to the
//        marker: run 3 read the refund's row as behind the fine and counted from the fine (2476), his refund gone
{
  const STRICT = { STRICT_BOARDS: '1' };
  // the first match, then run 1 (m3's starts + A's confession: the fine), then more(A, m3, conf, m4, env)
  const quit = (n, more, env0) => {
    const A = H.SID(n + 1), B = H.SID(n + 2);
    const f = firstMatch(A, B, n * 16 + 1, env0);
    const m3 = match(2, n * 16 + 3, [A, B]), m4 = match(2, n * 16 + 4, [A, B]);
    const conf = { sid: A, d: H.rec(0xB5, 2, n * 16 + 3, 0, 0, false, [A, B], [6000, 5000], 5) };
    const s = run([[5 * MIN, m3.S.concat([conf]), env0]].concat(more(A, m3, conf, m4, env0 || {})), f.a.pts, f.a.last.state);
    return { A, B, f, m3, m4, s, w: (i) => H.postsOf(s.rs[i], POINTS, A), lastAfter: (i) => (((s.rs[i] && s.rs[i].state.PENDING_WRITES_FILE) || {})[v.pid(A)] || {}).l || null,
      lastOfB: (i) => (((s.rs[i] && s.rs[i].state.PENDING_WRITES_FILE) || {})[v.pid(B)] || {}).l || null };
  };
  const scores = (ws) => J(ws.map((x) => x.score));
  const dropped = (out, A) => new RegExp('points write of ' + plog(A) + ' not confirmed').test(out);
  // [12]
  const amb = (env0, how) => quit(4931, (A, m3, conf, m4, env) => [
    [5 * MIN, m3.all.concat([conf]), Object.assign({}, STRICT, env, how === 'real' ? { STUB_FAIL_POST: J({ points: 500 }) } : {}), null, true, how === 'real' ? null : { sid: A, nth: 1, how: 'fail' }],
    [5 * MIN, m3.all.concat([conf]), env]], env0);
  const g = amb(null), go = amb(HOLD_OFF);
  T('[12] run 1 fines A (2438); run 2 refunds him (2538, answered 500) and exits on the missing report board', g.s.okAll && scores(g.w(0)) === '[2438]' && scores(g.w(1)) === '[2538]'
    && g.s.rs[1].code === 1 && /::error::report board absent/.test(g.s.rs[1].out) && /settled after all, refund \+100 -> 2538/.test(g.s.rs[1].out), scores(g.w(0)) + ' ' + scores(g.w(1)) + ' ' + g.s.rs[1].out.slice(-500));
  T('[12] ... the answered failure drops his kept write (logged), on disk after the failed run; B keeps his', dropped(g.s.rs[1].out, g.A) && !g.lastAfter(1) && !!g.lastOfB(1), J(g.s.rs[1].state.PENDING_WRITES_FILE));
  T('[12] run 3 settles m3 from his row as it is (the refund): 2576, no [stale-read] -- the write the job makes with the hold off', scores(g.w(2)) === '[2576]' && staleN(g.s.rs[2].out) === 0
    && go.s.okAll && J(g.w(2)) === J(go.w(2)), scores(g.w(2)) + ' vs ' + scores(go.w(2)) + ' ' + g.s.rs[2].out.slice(-600));
  const rl = amb(null, 'real'), rlo = amb(HOLD_OFF, 'real');
  T('[12] control, a refund the board did not take: forfeited as before O481 (run 3 writes 2476, hold on or off)', rl.s.okAll && rlo.s.okAll && scores(rl.w(2)) === '[2476]'
    && J(rl.w(2)) === J(rlo.w(2)), scores(rl.w(2)) + ' vs ' + scores(rlo.w(2)));
  // [12b]
  const one = (env0) => quit(4941, (A, m3, conf, m4, env) => [[5 * MIN, m3.all.concat([conf]), env, null, false, { sid: A, nth: 1, how: 'fail', fresh: true }]], env0);
  const h = one(null), ho = one(HOLD_OFF);
  T('[12b] one run: the refund (2538, answered 500, taken), then the settle of m3 from his current row: 2576, no [stale-read], as with the hold off', h.s.okAll && ho.s.okAll
    && scores(h.w(1)) === '[2538,2576]' && J(h.w(1)) === J(ho.w(1)) && staleN(h.s.rs[1].out) === 0 && dropped(h.s.rs[1].out, h.A), scores(h.w(1)) + ' vs ' + scores(ho.w(1)) + ' ' + h.s.rs[1].out.slice(-600));
  // [12c]
  const cut = (env0) => quit(4951, (A, m3, conf, m4, env) => [
    [5 * MIN, m3.all.concat([conf]), env, null, false, { sid: A, nth: 2, how: 'throw' }], [5 * MIN, m4.S, env], [5 * MIN, m4.all, env]], env0);
  const c = cut(null), co = cut(HOLD_OFF);
  T('[12c] run 2: the refund (2538) and the settle of m3 (2576, taken, cut off before the answer); the cut drops his kept write', c.s.okAll && scores(c.w(1)) === '[2538,2576]'
    && dropped(c.s.rs[1].out, c.A) && !c.lastAfter(1), scores(c.w(1)) + ' ' + J(c.s.rs[1].state.PENDING_WRITES_FILE));
  T('[12c] the next match counts from his row as it is (2576 + its points), no [stale-read] -- the write the job makes with the hold off', co.s.okAll && c.w(3).length === 1
    && c.w(3)[0].score > 2576 && J(c.w(3)) === J(co.w(3)) && staleN(c.s.out) === 0, scores(c.w(3)) + ' vs ' + scores(co.w(3)) + ' ' + c.s.rs[3].out.slice(-600));
  // [12d]
  const twice = (env0) => quit(4961, (A, m3, conf, m4, env) => [
    [5 * MIN, m3.all.concat([conf]), env, null, true, { sid: A, nth: 1, how: 'throw' }], [5 * MIN, m3.all.concat([conf]), env]], env0);
  const d = twice(null), dO = twice(HOLD_OFF);
  T('[12d] run 2: the refund\'s POST taken, then cut off: the cut drops his kept write in the job (logged) and the run ends (exit 1) before any save -- on disk the fine is still his kept write',
    d.s.okAll && scores(d.w(1)) === '[2538]' && d.s.rs[1].code === 1 && /run failed: [^\n]*injected/.test(d.s.rs[1].out) && dropped(d.s.rs[1].out, d.A)
    && d.lastAfter(1) && d.lastAfter(1).v === 2438, scores(d.w(1)) + ' ' + d.s.rs[1].out.slice(-500));
  T('[12d] run 3 refunds again from the kept fine (his row read as behind it, one [stale-read]): 2538, then the settle 2576 -- the refund once', scores(d.w(2)) === '[2538,2576]'
    && staleN(d.s.rs[2].out) === 1, scores(d.w(2)) + ' ' + d.s.rs[2].out.slice(-600));
  T('[12d] ... with the hold off (the job before O481) the refund came twice: 2638, then 2676', dO.s.okAll && scores(dO.w(2)) === '[2638,2676]', scores(dO.w(2)));
  // [12e]
  const killed = (env0) => quit(4971, (A, m3, conf, m4, env) => [
    [5 * MIN, m3.all.concat([conf]), env, null, true, { kill: 'refunded' }], [5 * MIN, m3.all.concat([conf]), env]], env0);
  const k = killed(null), kO = killed(HOLD_OFF);
  const marked = (r, A) => { const c = (r && r.state.CONFESSIONS_FILE) || {}; return Object.keys(c).some((key) => key.indexOf(v.pid(A) + '|') === 0 && c[key].refunded === 1); };
  T('[12e] run 2: the refund (2538, answered ok), killed the moment its marker is on disk: the refund is his kept write there already',
    k.s.okAll && scores(k.w(1)) === '[2538]' && k.s.rs[1].code === 137 && marked(k.s.rs[1], k.A) && !!k.lastAfter(1) && k.lastAfter(1).v === 2538,
    scores(k.w(1)) + ' exit ' + (k.s.rs[1] && k.s.rs[1].code) + ' ' + J(k.s.rs[1] && k.s.rs[1].state.PENDING_WRITES_FILE));
  T('[12e] run 3 settles m3 from the refund: 2576, no [stale-read] -- the write the job makes with the hold off', scores(k.w(2)) === '[2576]'
    && staleN(k.s.rs[2].out) === 0 && kO.s.okAll && marked(kO.s.rs[1], kO.A) && J(k.w(2)) === J(kO.w(2)), scores(k.w(2)) + ' vs ' + scores(kO.w(2)) + ' ' + (k.s.rs[2] ? k.s.rs[2].out.slice(-600) : ''));
}
// ---- [12f] / [12g] a lone-1V1 payment and a run that dies right after it (W70 second draft: the branch "the process dies") ----
//   W beats L in a ranked 1V1 (match m) only W writes (L's game died); he had quit it once and come back (his confession of m).
//   The job was down until 1h50m after the match: the first run back fines the confession (2500 -> 2400, his kept write, its
//   receipt "m, -100, left"); ten minutes on, the start matures and W is paid the win (Q184, L at the gate). The payment merges
//   into the fine's receipt, and it is made once: its marker (the processed key, l1t) is on disk before it is written.
//   [12f] that run is killed the moment the board took the payment (no answer): the payment took his kept write away first, on
//        disk, so the next settle (W beats B) counts from his row as it is -- the write the job makes with the hold off. Kept
//        there, the fine would read that row (the payment's) as a copy behind it and the settle would count from the fine: the
//        payment gone (the patch before this one, and the first draft)
//   [12g] that run is killed once the payment is answered and the backlog saved, and the settle reads a copy still showing the
//        fine: the payment is his kept write on disk and is taken instead -- the write of [12f] (with the hold off the copy is
//        taken as read: the payment gone, as before O481)
{
  const W = H.SID(4981), L = H.SID(4982), B = H.SID(4983), P = H.SID(4984);
  const sigEntry = () => ({ g: 3, w: 2, v: 0, f: 0, ns: 0, disp: [3, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now() });
  const files0 = () => ({ SIGNALS_FILE: { day: { d: 0, n: {} }, players: { [v.pid(L)]: Object.assign(sigEntry(), { l1: 1, l1o: [v.pid(P)] }) }, pairs: {}, flagged: {}, rep: {}, rseen: {} } });
  const hM = 0x4AC01, ros = [W, L], sc = [6000, 5000];
  const mine = [{ sid: W, d: H.rec(0xB2, 2, hM, 0, 0, false, ros, sc) }, { sid: W, d: H.rec(0xB5, 2, hM, 0, 0, false, ros, sc, 5) }, { sid: W, d: H.rec(0xB1, 2, hM, 0, 1, true, ros, sc) }];
  const m4 = match(2, 0x4AC04, [W, B]);
  const pts0 = { [W]: { score: 2500 }, [L]: { score: 2400 }, [B]: { score: 2450 } };
  const lone = (hook, lag, env) => run([[0, mine.slice(0, 1), env], [110 * MIN, mine, env], [10 * MIN, mine, env, null, true, hook],
    [5 * MIN, mine.concat(m4.S), env, lag], [5 * MIN, mine.concat(m4.all), env, lag]], pts0, files0());
  const w = (r, i) => H.postsOf(r.rs[i], POINTS, W);
  const lastAt = (r, i) => (((r.rs[i] && r.rs[i].state.PENDING_WRITES_FILE) || {})[v.pid(W)] || {}).l || null;
  const scores = (ws) => J(ws.map((x) => x.score));
  const k = lone({ sid: W, nth: 1, how: 'kill' }), kO = lone({ sid: W, nth: 1, how: 'kill' }, null, HOLD_OFF);
  const fine = w(k, 1), pay = w(k, 2);
  const payRing = pay.length ? ringOf(pay[0].details) : [];
  T('[12f] run 2 fines W (2400: his kept write, "m, -100, left"); run 3 pays him the win (Q184), merged into that receipt, and is killed the moment the board took it',
    k.okAll && scores(fine) === '[2400]' && pay.length === 1 && pay[0].score > 2400 && k.rs[2].code === 137 && /lone-1v1 [0-9_]+: [0-9a-f]+ won/.test(k.rs[2].out)
    && payRing.length === 1 && payRing[0].mh === (hM | 0) && payRing[0].delta === pay[0].score - 2500 && !(payRing[0].flags & PP.RECEIPT_F.LEAVE),
    scores(fine) + ' ' + J(pay.map((x) => [x.score, ringOf(x.details)])) + ' exit ' + (k.rs[2] && k.rs[2].code) + ' ' + (k.rs[2] ? k.rs[2].out.slice(-700) : ''));
  T('[12f] ... the payment took his kept write away first (logged): none on disk after the killed run', !lastAt(k, 2)
    && new RegExp('points write of ' + plog(W) + ' \\(one-shot\\) would leave a row that reads as behind his last write').test(k.rs[2].out), J(k.rs[2] && k.rs[2].state.PENDING_WRITES_FILE));
  const s5 = w(k, 4), o5 = w(kO, 4);
  T('[12f] the next settle counts from his row as it is (the payment), no [stale-read] -- the write the job makes with the hold off',
    kO.okAll && s5.length === 1 && s5[0].score > pay[0].score && J(s5) === J(o5) && staleN(k.rs[4].out) === 0 && staleN(k.rs[3].out) === 0,
    scores(s5) + ' vs ' + scores(o5) + ' (payment ' + scores(pay) + ') ' + (k.rs[4] ? k.rs[4].out.slice(-700) : ''));
  const g = lone({ sid: W, nth: 1, how: 'killsave' }, { [W]: fine[0] ? { score: fine[0].score, details: fine[0].details } : null });
  const gO = lone({ sid: W, nth: 1, how: 'killsave' }, { [W]: fine[0] ? { score: fine[0].score, details: fine[0].details } : null }, HOLD_OFF);
  T('[12g] run 3 pays him (answered ok) and is killed once the backlog is on disk: the payment is his kept write there', g.okAll && g.rs[2].code === 137
    && scores(w(g, 2)) === scores(pay) && !!lastAt(g, 2) && lastAt(g, 2).v === pay[0].score, scores(w(g, 2)) + ' ' + J(g.rs[2] && g.rs[2].state.PENDING_WRITES_FILE));
  T('[12g] the settle reads a copy still showing the fine and takes the payment instead (one [stale-read]): the write of [12f]', o5.length === 1
    && J(w(g, 4)) === J(o5) && staleN(g.rs[4].out) === 1, scores(w(g, 4)) + ' vs ' + scores(o5) + ' ' + (g.rs[4] ? g.rs[4].out.slice(-700) : ''));
  T('[12g] ... with the hold off the copy is taken as read: counted from the fine, the payment gone (as before O481)', gO.okAll && w(gO, 4).length === 1
    && o5.length === 1 && w(gO, 4)[0].score < o5[0].score && staleN(gO.rs[4].out) === 0, scores(w(gO, 4)) + ' vs ' + scores(o5));
}
// ---- [11] pure ----
{
  const VB = (PP.RULES_VER & 0xffff) << 8;
  const d = (ring) => PP.lpDetails(null, ring);
  const last = { b: 'points', v: 2576, d: d([{ mh: 2, delta: 38, flags: VB }, { mh: 1, delta: 38, flags: VB }]), t: 0 };
  const row = (score, ring) => ({ score, det: d(ring) });
  T('[11] lpReadStale: no kept write -> as read; no row -> behind', v.lpReadStale(row(1, []), null) === false && v.lpReadStale(null, last) === true);
  T('[11] the row of the kept write -> current; without its head receipt -> behind', v.lpReadStale({ score: 2576, det: last.d }, last) === false
    && v.lpReadStale(row(2538, [{ mh: 1, delta: 38, flags: VB }]), last) === true);
  T('[11] the head receipt further down a newer ring -> current', v.lpReadStale(row(2600, [{ mh: 3, delta: 24, flags: VB }, { mh: 2, delta: 38, flags: VB }, { mh: 1, delta: 38, flags: VB }]), last) === false);
  T('[11] the same match with another change or other flags (the row before a merge into it) -> behind', v.lpReadStale(row(2476, [{ mh: 2, delta: -62, flags: VB }, { mh: 1, delta: 38, flags: VB }]), last) === true
    && v.lpReadStale(row(2576, [{ mh: 2, delta: 38, flags: VB | PP.RECEIPT_F.LEAVE }, { mh: 1, delta: 38, flags: VB }]), last) === true);
  const bare = { b: 'points', v: 2000, d: [], t: 0 };
  T('[11] a kept write without receipts orders nothing: no row -> behind, any row -> as read', v.lpReadStale(null, bare) === true && v.lpReadStale(row(1999, []), bare) === false
    && v.lpReadStale(row(5, [{ mh: 1, delta: 5, flags: VB }]), bare) === false);
  const now = 9e12, H30 = v.LP_LAST_HOLD_MS;
  T('[11] LP_LAST_HOLD_MS is 30 min', H30 === 30 * MIN, String(H30));
  T('[11] lpLastLive: within the hold either side of now; past it, malformed -> no', v.lpLastLive({ b: 'points', v: 1, d: [], t: now - H30 }, now) && v.lpLastLive({ b: 'points', v: 1, d: [], t: now + 5 * MIN }, now)
    && !v.lpLastLive({ b: 'points', v: 1, d: [], t: now - H30 - 1 }, now) && !v.lpLastLive({ b: 'points', v: 'x', d: [], t: now }, now)
    && !v.lpLastLive({ b: 'points', v: 1, t: now }, now) && !v.lpLastLive({ v: 1, d: [], t: now }, now) && !v.lpLastLive(null, now));
  const s = { a: { l: { b: 'points', v: 1, d: [], t: now - H30 - 1 } }, b: { l: { b: 'points', v: 2, d: [], t: now - 1000 } }, c: { l: { v: 'x' } },
    e: { rc: [[2, 0, 32, 0, now - 1000]], l: { b: 'points', v: 3, d: [], t: now - H30 - 1 } } };
  const r = v.prunePendingWrites(s, now);
  T('[11] the prune drops a kept write past its hold or malformed, quietly (no receipt or write counted), and the entries left empty',
    r.receipts === 0 && r.writes === 0 && J(s) === J({ b: { l: { b: 'points', v: 2, d: [], t: now - 1000 } }, e: { rc: [[2, 0, 32, 0, now - 1000]] } }), J(s));
}

console.log(failN ? ('stale-lp-read: ' + failN + ' FAIL') : 'stale-lp-read: all ok');
process.exit(failN ? 1 : 0);
