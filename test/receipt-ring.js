'use strict';
// O480 R1 (pseudo-realtime ladder): points receipts on the player's own points-board row.
// lp row details = [the RS reveal slot: 6 ints, or six zeros] + [0xC6, n, (matchHash, delta, flags) x n <= 8], newest first:
// what each recent match did to the player's points (delta = net change on this board; flags = why: reveal flag, leaver fine,
// series clamp, seeded, void, first receipt under new rules; bits 8..23 = RULES_VER). The client reads it to confirm, correct or
// roll back the points it showed at the match end (R2). Codec in points-plan.js; every writer of the points board goes through
// validate.js lpWriteDetails, so neither the reveal nor the ring is ever dropped by a write that does not concern it.
//   [1] codec: empty / reveal-only / full rows decode, lpDetails lays out 6 + 2 + 3n ints, malformed rows stay safe
//   [2] receiptPush: newest first, same key nets (fine, refund, settle on one entry; a settle replaces the flags, a refund
//       clears LEAVE), capacity 8 drops the oldest, version bits, RULES on the first receipt after a rules change
//   [3] lpWriteDetails: the reveal slot is kept unless this run has a new one, events apply in order
//   [4] an old client's reveal parser reads the new details exactly as before (a reveal at [0..5]; zeros = none)
// Over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js):
//   [5] fair ranked 1V1: both rows carry one receipt (the record's matchHash, the delta the row moved by, no flag)
//   [6] mismatch, the weak side wins: its receipt carries the UPSET flag and its reveal slot the reveal (as before)
//   [7] a first settle of the season seeds a player with no row: SEEDED, delta counted from the seed
//   [8] the series clamp forces a promotion: SERIES
//   [9] a convicted leaver of a ranked FFA: a LEAVE receipt with the fine
//   [10] a consensus VOID writes nobody's row (the invariant the void / contest tests pin): every account of it gets a VOID
//        receipt (delta 0) queued in the backlog (PENDING_WRITES_FILE), and his next points write carries it behind its own
//   [11] a ranked match that never settles (start-orphan verdict, a run with no fresh match): no write, VOID receipts queued
//   [12] a confession fine at first sight: a LEAVE receipt on the confessor's row
//   [13] a full ring with an unread reveal and entries of an older RULES_VER: the new receipt first, the oldest dropped, the
//        reveal kept, RULES set; [14] rows written before O480 (reveal only / no details) keep the reveal and gain a ring
//   [15] every points-board POST goes through writeLpRow; [16] the backlog ages out after RECEIPT_HOLD_MS (6 h: the client
//        has rolled the match back by itself) and holds at most 8 per account
const path = require('path');
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
const F = PP.RECEIPT_F, VER = PP.RULES_VER, VBITS = (VER & 0xffff) << 8;
const low = (e) => e.flags & 0xff;

console.log('=== points receipts on the points-board row (O480) ===');
// ---- [1] codec ----
{
  T('[1] no details: no reveal, empty ring', J(PP.lpDetailsOf([])) === J({ rs: null, ring: [] }) && J(PP.lpDetailsOf(null)) === J({ rs: null, ring: [] }));
  const rs = [0xC5, 77, 1234, 2, -5, -12];
  T('[1] a reveal-only row (written before O480): the reveal, an empty ring', J(PP.lpDetailsOf(rs)) === J({ rs, ring: [] }));
  const full = PP.lpDetails(rs, [{ mh: 9, delta: -5, flags: 2 | VBITS }, { mh: -8, delta: 40, flags: VBITS }]);
  T('[1] lpDetails lays out 6 + 2 + 3n ints', full.length === 6 + 2 + 6 && full[6] === 0xC6 && full[7] === 2 && J(full.slice(8)) === J([9, -5, 2 | VBITS, -8, 40, VBITS]));
  T('[1] round trip', J(PP.lpDetailsOf(full)) === J({ rs, ring: [{ mh: 9, delta: -5, flags: 2 | VBITS }, { mh: -8, delta: 40, flags: VBITS }] }));
  T('[1] no reveal: six zeros head the ring', J(PP.lpDetails(null, []).slice(0, 8)) === J([0, 0, 0, 0, 0, 0, 0xC6, 0]));
  T('[1] a ring claiming more entries than it carries reads what is there', PP.lpDetailsOf(full.slice(0, 12)).ring.length === 1 && PP.lpDetailsOf([0, 0, 0, 0, 0, 0, 0xC6, 99]).ring.length === 0);
  T('[1] at most RECEIPT_CAP (8) entries, 32 ints with the reveal slot', PP.RECEIPT_CAP === 8 && PP.lpDetails(rs, new Array(12).fill(0).map((_, i) => ({ mh: i, delta: 1, flags: 0 }))).length === 32);
}
// ---- [2] receiptPush ----
{
  let r = PP.receiptPush([], 100, 30, 0, 0xff);
  T('[2] first receipt: delta, version bits, no RULES on an empty ring', J(r) === J([{ mh: 100, delta: 30, flags: VBITS }]));
  r = PP.receiptPush(r, 200, -100, F.LEAVE, 0);
  T('[2] newest first', r.length === 2 && r[0].mh === 200 && r[1].mh === 100 && low(r[0]) === F.LEAVE);
  r = PP.receiptPush(r, 200, 100, 0, F.LEAVE);
  T('[2] same key nets: the refund cancels the fine on one entry, LEAVE cleared', r.length === 2 && r[0].mh === 200 && r[0].delta === 0 && low(r[0]) === 0);
  r = PP.receiptPush(r, 200, 17, 1 | F.SERIES, 0xff);
  T('[2] ... and the match\'s settle adds up there with its own flags', r.length === 2 && r[0].delta === 17 && low(r[0]) === (1 | F.SERIES));
  r = PP.receiptPush(r, 100, 0, F.VOID, 0);
  T('[2] an event on an older key moves it to the front, flags OR-ed, delta kept', r[0].mh === 100 && r[0].delta === 30 && low(r[0]) === F.VOID && r[1].mh === 200);
  let big = [];
  for (let i = 1; i <= 9; i++) big = PP.receiptPush(big, i, i, 0, 0xff);
  T('[2] capacity 8: the ninth push drops the oldest', big.length === 8 && big[0].mh === 9 && big[7].mh === 2);
  const old = [{ mh: 5, delta: 1, flags: (0 << 8) | 0 }];
  const nr = PP.receiptPush(old, 6, 2, 0, 0xff);
  T('[2] RULES on the first receipt after a rules change (the entry after it carries another version)', (low(nr[0]) & F.RULES) === F.RULES && PP.receiptVer(nr[0].flags) === VER);
  T('[2] ... not on the next one', (low(PP.receiptPush(nr, 7, 1, 0, 0xff)[0]) & F.RULES) === 0);
  T('[2] receiptOf finds a key on a row', PP.receiptOf(PP.lpDetails(null, nr), 6).delta === 2 && PP.receiptOf(PP.lpDetails(null, nr), 4) === null);
}
// ---- [3] lpWriteDetails ----
{
  const rs = [0xC5, 1, 2, 1, 30, 30];
  const prev = PP.lpDetails(rs, [{ mh: 3, delta: -10, flags: VBITS }]);
  const d1 = v.lpWriteDetails(prev, null, [{ mh: 4, change: 20, set: 0, clear: 0xff }]);
  T('[3] no new reveal: the unread one kept, the event on top of the ring', J(d1.slice(0, 6)) === J(rs) && J(PP.lpDetailsOf(d1).ring.map((e) => [e.mh, e.delta])) === J([[4, 20], [3, -10]]));
  const d2 = v.lpWriteDetails(prev, { matchHash: 4, seed: 9, flag: 2, adjDelta: -3, normalDelta: -9 }, []);
  T('[3] a new reveal replaces the slot, the ring stays', J(d2.slice(0, 6)) === J([0xC5, 4, 9, 2, -3, -9]) && PP.lpDetailsOf(d2).ring.length === 1);
  const d3 = v.lpWriteDetails([], null, [{ mh: 1, change: -100, set: F.LEAVE, clear: 0 }, { mh: 1, change: 100, set: 0, clear: F.LEAVE }, { mh: 1, change: 12, set: 0, clear: 0xff }]);
  T('[3] events apply in order (fine, refund, settle -> one entry +12)', J(PP.lpDetailsOf(d3).ring.map((e) => [e.mh, e.delta, low(e)])) === J([[1, 12, 0]]));
  T('[3] mhOfKey reads the matchHash of a key (negative too)', v.mhOfKey('-12345_77_2') === -12345 && v.mhOfKey('9_1_6') === 9);
}
// ---- [4] the client's reveal parser (rating-store.js _parseRsDetails) on the new layout ----
{
  const parse = (d) => { if (!Array.isArray(d) || d.length < 6 || (d[0] & 0xff) !== 0xC5) return null; const flag = d[3] | 0; if (flag !== 1 && flag !== 2) return null; return { matchKey: (d[1] | 0) + '_' + (d[2] | 0), flag, adjDelta: d[4] | 0, normalDelta: d[5] | 0 }; };
  const withRs = PP.lpDetails([0xC5, 41, 7, 1, 22, 22], [{ mh: 41, delta: 22, flags: 1 | VBITS }]);
  T('[4] a reveal at [0..5] reads as before', J(parse(withRs)) === J({ matchKey: '41_7', flag: 1, adjDelta: 22, normalDelta: 22 }));
  T('[4] six zeros read as no reveal', parse(PP.lpDetails(null, [{ mh: 41, delta: 5, flags: VBITS }])) === null);
}

// ================= end to end =================
const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN, LEAVE = v.LEAVE_CONFIRM_MS + MIN, MATURE = v.STARTS_MATURITY_MS + MIN;
const RATING = 6, POINTS = 7;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
// steps: [[ms since the previous run, records]]; pts: { sid: { score, details } } carried run to run (each points write lands);
//   files0: the state files of the first run (default: skill0 alone)
function run(steps, pts0, skill0, files0) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs] of steps) {
    const r = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || (skill0 ? { SKILL_FILE: skill0 } : null)), null, null, 'receipt-ring');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// a ranked match (mt) on seats ros: every seat writes its start (unless noStart), `res` = the seats writing a result
//   (disp per seat, default finished); scores descending by seat = ranks by seat; sc overrides the scores
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) })).filter((x, seat) => !(o.noStart || []).includes(seat));
  const R = res.map((seat) => ({ sid: ros[seat], d: H.rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, (o.disp || {})[seat] | 0) }));
  return { S, R, all: S.concat(R), key: ros.length ? (hash + '_1234_' + mt) : '', mh: hash | 0 };
}
const writes = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, POINTS, sid)));
const lastRing = (m, sid) => { const w = writes(m, sid); return w.length ? PP.lpDetailsOf(w[w.length - 1].details).ring : null; };
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const SETTLE = (mm) => [[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [6 * MIN, mm.all]];

const A = H.SID(4811), B = H.SID(4812), C = H.SID(4813), D = H.SID(4814), E = H.SID(4815), F2 = H.SID(4816);
// ---- [5] fair ranked 1V1 ----
{
  const mm = match(2, 0x48A01, [A, B], [0, 1]);
  const m = run(SETTLE(mm), { [A]: { score: 2500 }, [B]: { score: 2400 } });
  T('[5] settled', m.okAll && settled(m, mm.key), m.out.slice(-600));
  for (const [sid, nm, cur] of [[A, 'A', 2500], [B, 'B', 2400]]) {
    const w = writes(m, sid), rg = lastRing(m, sid);
    T('[5] ' + nm + ': one points write, one receipt (matchHash, the delta the row moved by, no flag, this RULES_VER)', w.length === 1 && rg && rg.length === 1
      && rg[0].mh === mm.mh && rg[0].delta === w[0].score - cur && low(rg[0]) === 0 && PP.receiptVer(rg[0].flags) === VER, J(w));
    T('[5] ' + nm + ': no reveal (six zeros), 11 ints in all', w.length === 1 && J(w[0].details.slice(0, 6)) === J([0, 0, 0, 0, 0, 0]) && w[0].details.length === 11);
  }
  T('[5] logged', /receipts: 2 written on 2 points row\(s\)/.test(m.out), m.out.slice(-400));
}
// ---- [6] mismatch, the weak side wins ----
{
  const sk = { [v.pid(C)]: { mu: 40, sigma: 2, rm: 40, rv: 2 } };   // display 2360 against 1000: a mismatch
  const mm = match(2, 0x48A02, [C, D], [0, 1], { sc: [3000, 6000] });   // D (seat 1, weak) wins
  const m = run(SETTLE(mm), { [C]: { score: 4500 }, [D]: { score: 1500 } }, sk);
  const rd = lastRing(m, D), wd = writes(m, D);
  T('[6] the weak winner: UPSET (1) on his receipt, the reveal in its slot (as before)', settled(m, mm.key) && rd && low(rd[0]) === 1 && wd[0].details[0] === 0xC5 && wd[0].details[3] === 1
    && wd[0].details[1] === mm.mh && rd[0].delta === wd[0].score - 1500, J(wd));
  const rc = lastRing(m, C);
  T('[6] the strong loser: no flag (no reveal for the strong side)', rc && low(rc[0]) === 0 && writes(m, C)[0].details[0] === 0, J(writes(m, C)));
}
// ---- [7] seeded first settle ----
{
  const mm = match(2, 0x48A03, [E, F2], [0, 1]);
  const m = run(SETTLE(mm), { [F2]: { score: 1700 } }, { [v.pid(E)]: { mu: 30, sigma: 3 } });   // E: no row, display 1840 -> seed 3360 capped 3200
  const re = lastRing(m, E), we = writes(m, E);
  T('[7] a player seeded by this settle: SEEDED, delta counted from the seed', settled(m, mm.key) && re && (low(re[0]) & F.SEEDED) === F.SEEDED
    && re[0].delta === we[0].score - PP.seedLp(1840) && PP.seedLp(1840) === 3200, J(we));
  T('[7] the other player: no SEEDED', (low(lastRing(m, F2)[0]) & F.SEEDED) === 0);
}
const G = H.SID(4817), Hh = H.SID(4818), I = H.SID(4819);
// ---- [8] series clamp ----
{
  const mm = match(2, 0x48A04, [G, Hh], [0, 1]);
  const m = run(SETTLE(mm), { [G]: { score: 1960 }, [Hh]: { score: 1500 } });
  const rg = lastRing(m, G), wg = writes(m, G);
  T('[8] a promotion forced by the series clamp: SERIES, delta to min + 10', settled(m, mm.key) && wg[0].score === 2010 && rg[0].delta === 50 && (low(rg[0]) & F.SERIES) === F.SERIES, J(wg));
}
// ---- [9] a convicted leaver ----
{
  const mm = match(2, 0x48A05, [G, Hh, I], [0, 1]);   // I writes his start and leaves
  const m = run([[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [LEAVE, mm.all], [3 * HOUR, mm.all]], { [G]: { score: 2500 }, [Hh]: { score: 2400 }, [I]: { score: 1500 } });
  const ri = lastRing(m, I), wi = writes(m, I);
  T('[9] the leaver: LEAVE receipt with the fine (-' + PP.LEAVER_LP_PENALTY + ')', settled(m, mm.key) && wi.length === 1 && wi[0].score === 1500 - PP.LEAVER_LP_PENALTY
    && ri[0].mh === mm.mh && ri[0].delta === -PP.LEAVER_LP_PENALTY && low(ri[0]) === F.LEAVE, J(wi) + ' ' + m.out.slice(-500));
  T('[9] the two who finished: a settle receipt each', [G, Hh].every((s) => { const r = lastRing(m, s); return r && r[0].mh === mm.mh && (low(r[0]) & F.LEAVE) === 0; }));
}
const J1 = H.SID(4821), K1 = H.SID(4822), M1 = H.SID(4823), N1 = H.SID(4824), O1 = H.SID(4825), P1 = H.SID(4826), Q1 = H.SID(4827);
// the backlog entry (PENDING_WRITES_FILE) of an account after a run: its queued receipts [mh, change, set, clear, t]
const queuedOf = (r, sid) => { const e = ((r.state.PENDING_WRITES_FILE || {})[v.pid(sid)]) || {}; return Array.isArray(e.rc) ? e.rc : []; };
// ---- [10] consensus VOID: no points write (a void writes nobody's row), the receipts wait for each player's next write ----
{
  const mm = match(2, 0x48A06, [J1, K1, M1], [0, 1, 2], { disp: { 0: 2, 1: 2, 2: 2 } });   // host-left x3: void
  const m = run(SETTLE(mm), { [J1]: { score: 2600 }, [K1]: { score: 700 } });   // M1 has no row
  T('[10] processed as a consensus VOID', settled(m, mm.key) && /consensus -> no MMR\/points/.test(m.out), m.out.slice(-500));
  T('[10] no points write for anybody (the void invariant)', [J1, K1, M1].every((s) => writes(m, s).length === 0), J([J1, K1, M1].map((s) => writes(m, s))));
  T('[10] every account of it has a VOID receipt queued (delta 0)', [J1, K1, M1].every((s) => { const q = queuedOf(m.last, s); return q.length === 1 && q[0][0] === mm.mh && q[0][1] === 0 && q[0][2] === F.VOID; }),
    J([J1, K1, M1].map((s) => queuedOf(m.last, s))));
  // J1's next ranked match: the settle write carries the queued VOID receipt behind its own
  const m2 = match(2, 0x48A0B, [J1, K1], [0, 1]);
  const n = run(SETTLE(m2), m.pts, null, H.advance(m.last.state, 10 * MIN));
  const rj = lastRing(n, J1);
  T('[10] the next settle of J1 carries it: [that match, the void] (newest first), the void still delta 0 / VOID', settled(n, m2.key) && rj && rj.length === 2
    && rj[0].mh === m2.mh && rj[1].mh === mm.mh && rj[1].delta === 0 && low(rj[1]) === F.VOID, J(writes(n, J1)));
  T('[10] ... and leaves the backlog', queuedOf(n.last, J1).length === 0 && queuedOf(n.last, K1).length === 0 && queuedOf(n.last, M1).length === 1, J(n.last.state.PENDING_WRITES_FILE));
}
// ---- [11] a ranked match that never settles: the verdict run writes no points, the receipts are queued ----
{
  const mm = match(2, 0x48A07, [N1, O1], [0]);   // both start, only N1 writes a result: no consistent group
  const m = run([[0, mm.S], [5 * MIN, mm.all], [MATURE, mm.all]], { [N1]: { score: 3100 }, [O1]: { score: 3300 } });
  T('[11] the start-orphan verdict processes the key in a run with no fresh match', settled(m, mm.key) && /no (consistent|fresh) match/.test(m.last.out) && /start-orphan /.test(m.last.out), m.last.out.slice(-600));
  T('[11] no points write', writes(m, N1).length === 0 && writes(m, O1).length === 0);
  T('[11] a VOID receipt queued for both (the early-exit path saves the backlog)', [N1, O1].every((s) => { const q = queuedOf(m.last, s); return q.length === 1 && q[0][0] === mm.mh && q[0][2] === F.VOID; })
    && /receipts: 2 queued for their player's next points write/.test(m.last.out), J(m.last.state.PENDING_WRITES_FILE));
}
// ---- [16] the backlog ages out and is capped ----
{
  const now = 5e12, H6 = 6 * 3600 * 1000;
  const s = { a: { rc: [[1, 0, 32, 0, now - H6 - 1], [2, 0, 32, 0, now - 1000]] }, b: { rc: [[3, 0, 32, 0, now - H6 - 5]] }, c: { rc: [] }, d: {} };
  const dropped = v.prunePendingWrites(s, now).receipts;
  T('[16] past RECEIPT_HOLD_MS (6 h) a queued receipt is dropped, an empty entry goes', dropped === 2 && J(s) === J({ a: { rc: [[2, 0, 32, 0, now - 1000]] } }), J(s));
  const many = { a: { rc: new Array(11).fill(0).map((_, i) => [i, 0, 32, 0, now]) } };
  v.prunePendingWrites(many, now);
  T('[16] at most 8 queued per account (the newest kept)', many.a.rc.length === 8 && many.a.rc[0][0] === 3 && many.a.rc[7][0] === 10);
}
// ---- [12] a confession fine ----
{
  const mm = match(2, 0x48A08, [P1, Q1], [0]);
  const conf = { sid: Q1, d: H.rec(0xB5, 2, 0x48A08, 1, 0, false, [P1, Q1], [6000, 5000], 5) };   // Q1 quits (user-quit)
  const m = run([[0, mm.S], [5 * MIN, mm.S.concat([conf])]], { [P1]: { score: 2500 }, [Q1]: { score: 2200 } });
  const r = lastRing(m, Q1), w = writes(m, Q1);
  T('[12] the confessor: fined at first sight, a LEAVE receipt with the fine', w.length === 1 && w[0].score === 2200 - PP.LEAVER_LP_PENALTY && r && r[0].mh === mm.mh
    && r[0].delta === -PP.LEAVER_LP_PENALTY && low(r[0]) === F.LEAVE, J(w) + ' ' + m.out.slice(-500));
}
const R1 = H.SID(4831), S1 = H.SID(4832), T1 = H.SID(4833), U1 = H.SID(4834);
// ---- [13] a full ring, an unread reveal, entries of an older RULES_VER ----
{
  const reveal = [0xC5, 31337, 77, 2, -4, -11];
  const ring8 = []; for (let i = 0; i < 8; i++) ring8.push({ mh: 5000 + i, delta: i, flags: 0 });   // version 0: before any O480 rules
  const mm = match(2, 0x48A09, [R1, S1], [0, 1]);
  const m = run(SETTLE(mm), { [R1]: { score: 2500, details: PP.lpDetails(reveal, ring8) }, [S1]: { score: 2400 } });
  const w = writes(m, R1), rg = lastRing(m, R1);
  T('[13] the new receipt first, the oldest dropped (8 kept)', w.length === 1 && rg.length === 8 && rg[0].mh === mm.mh && rg[1].mh === 5000 && rg[7].mh === 5006, J(rg));
  T('[13] the unread reveal kept in its slot', w.length === 1 && J(w[0].details.slice(0, 6)) === J(reveal));
  T('[13] RULES set: the entry after it was written under another RULES_VER', (low(rg[0]) & F.RULES) === F.RULES);
}
// ---- [14] rows written before O480 ----
{
  const reveal = [0xC5, 4242, 7, 1, 30, 30];
  const mm = match(2, 0x48A0A, [T1, U1], [0, 1]);
  const m = run(SETTLE(mm), { [T1]: { score: 2500, details: reveal }, [U1]: { score: 2400 } });
  const wt = writes(m, T1), wu = writes(m, U1);
  T('[14] a reveal-only row: the reveal kept, a ring of one appended', wt.length === 1 && J(wt[0].details.slice(0, 6)) === J(reveal) && PP.lpDetailsOf(wt[0].details).ring.length === 1, J(wt));
  T('[14] a row without details: six zeros, a ring of one', wu.length === 1 && J(wu[0].details.slice(0, 6)) === J([0, 0, 0, 0, 0, 0]) && PP.lpDetailsOf(wu[0].details).ring.length === 1, J(wu));
}
// ---- wiring pins: every points-board write goes through lpWriteDetails (writeLpRow) ----
{
  const n = (H.SRC.match(/leaderboardid: lpBoardId, steamid: String\(sid\), score, scoremethod: 'ForceUpdate', format: 'json' \}, det\);/g) || []).length;
  const direct = (H.SRC.match(/leaderboardid: (lpId|lpId0|lpBoardId),[^\n]*SetLeaderboardScore|SetLeaderboardScore[^\n]*leaderboardid: (lpId|lpId0|lpBoardId), /g) || []).length;
  T('[15] one points-board POST in the file, inside writeLpRow (no writer bypasses the receipts)', n === 1 && direct === 1, n + ' / ' + direct);
}

console.log(failN ? ('receipt-ring: ' + failN + ' FAIL') : 'receipt-ring: all ok');
process.exit(failN ? 1 : 0);
