'use strict';
// Cloud audit Q339 (after Q65): a key whose records differ only by the lifts a host migration left unchecked.
// Q65 (client) has a survivor take the old host's unchecked lifts back out of a seat when it writes its record (an orphan:
// an amount the new host's table carries and the survivor cannot find on its own side). An honest table can end there too
// (review-q65-honest.js P1: the new host and the survivor both missed the same frame of the old host's seat), so the key's
// vectors differed and the inconsistent path flagged every writer, the honest ones included, and never settled it. Since
// Q339 such a survivor names what it took out in a self-describing block (ORPH_MAGIC 0xE6). This test:
//   [1] liftOrphanBlockOf: the block read from the tail (after the T2BY tag, the char block, other blocks by len), none on a
//       plain record, an endless record or a version the job does not read; 'bad' for words that do not hold together
//   [2] liftOrphanVerdict / groupRecords: settle (P1 3P, the cheat A shape (Q65 repro 1), 4P with two survivors, either order, a 10 among
//       them), hold (a named seat that wrote, its account at another seat, the start roster's account, seen agreeing, a
//       team / friends' room / bot type, below the score floor), null (unexplained, broken, one account, a gamble tag or
//       block, two seats, endless, P1 with the final summary lost) and the Q68 shape it leaves alone (the new host's record and a 10)
//   [3] applyLiftOrphans: a hold leaves the list ahead of the flag loop, nobody flagged, a writer whose own record breaks
//       its own duration bound flagged alone; one signal per key of both outcomes (first sight), the old host's counter on
//       an account that already has signals only; pruneSignals ages the per-key entries out
//   [4] seedcap pendingOfGroup: a settle shape is audited on the lowered scores (every writer a claimant), a hold skipped
//   [5] end to end over the REAL validate.js main(): P1 / CH settled, nobody flagged, XP and rating of the seats present
//       exactly as in the same match agreed on the lowered scores; HD held, nobody flagged, voided at the start verdict with
//       every writer consoled; FG (a block that does not explain the vectors) flagged as before; the summary row; signals
//   [6] wiring pins
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const SC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lift-orphan-'));
process.env.SC_STATE_FILE = path.join(SC_DIR, 'seedcap.json');
const v = require(H.VALIDATE);
const sc = require(path.join(H.ROOT, 'seedcap.js'));
const SCSRC = fs.readFileSync(path.join(H.ROOT, 'seedcap.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
// a section that throws (a function the job does not have) fails, and the rest still runs
const section = (name, fn) => { try { fn(); } catch (e) { bad(name + ' threw: ' + (e && e.message)); } };

console.log('=== a key whose records differ only by the lifts a host migration left unchecked (Q339) ===');
const SID = H.SID, NOS = 10, OM = 0xE6;
// the block: [ORPH_MAGIC | ver << 8 | len << 16, seat mask | old-host mask << 8, amounts in seat order]
function blk(seats, host, o) {
  o = o || {};
  const ks = Object.keys(seats).map(Number).sort((a, b) => a - b);
  let mask = 0; for (const s of ks) mask |= 1 << s;
  const hm = Array.isArray(host) ? host.reduce((a, s) => a | (1 << s), 0) : (1 << host);
  return [OM | ((o.ver || 1) << 8) | ((o.len != null ? o.len : 1 + ks.length) << 16), (o.mask != null ? o.mask : mask) | ((o.hm != null ? o.hm : hm) << 8)].concat(ks.map((s) => seats[s]));
}
// a result in the reconcile's record shape (main: { steamID, shard, d, dispCode, disp, roster }); o.tail = words after the roster
function mk(sid, seat, ros, sc0, disp, o) {
  o = o || {};
  const d = H.rec(0xB1, o.mt || 1, o.hash || 0x3390, seat, o.rank == null ? seat + 1 : o.rank, false, ros, sc0, disp | 0);
  if (o.tail) for (const x of o.tail) d.push(x);
  if (o.dur != null) d[9] = o.dur;
  return { steamID: sid, shard: 'shard_' + (o.shard | 0), d, dispCode: disp | 0, disp: v.dispName(disp | 0), roster: v.decodeRoster(d) };
}
const vecOf = (r) => {
  const pc = r.d[8] | 0;
  if (pc < 1 || pc > 8 || r.d.length < 10 + pc) return 'BAD(pc=' + pc + ')';
  let x = r.d.slice(10, 10 + pc);
  if (v.isEndlessMt(r.d[2] | 0)) { const at = 11 + 3 * pc; if (r.d.length < at + 4) return 'BAD(tail)'; x = x.concat(r.d.slice(at, at + Math.min(9, r.d.length - at))); }
  return J(x);
};
const scoresOf = (r) => r.d.slice(10, 10 + (r.d[8] | 0));
const quiet = (fn) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
const group = (recs, starts) => quiet(() => v.groupRecords(recs, { vecOf, MAX_SEATS: 8, starts: starts || {} }));
const verdict = (g, opts) => v.liftOrphanVerdict(g, opts || {});

// seat 0 = the old host (left the match), seat 1 = the new host, seat 2 (3) = survivor(s)
const O = SID(3390), N = SID(3391), S = SID(3392), S2 = SID(3393), X = SID(3394);
const R3 = [O, N, S], R4 = [O, N, S, S2];
const VH = [5150, 3000, 2000], VL = [5000, 3000, 2000];            // P1: the old host's frame of 150 both missed
const CH = [6000, 3000, 2000], CL = [1000, 3000, 2000];            // the cheat A shape (Q65 repro 1): a forged +5000 for the old host's seat
const VH4 = [5150, 3000, 2000, 1500], VL4 = [5000, 3000, 2000, 1500];

// ---- [1] block reader ----
section('[1]', () => {
  T('[1] the job reads ORPH_MAGIC 0xE6 version 1', v.ORPH_MAGIC === OM && v.ORPH_VER === 1);
  T('[1] a plain record carries no block', v.liftOrphanBlockOf(mk(N, 1, R3, VH, 0)) === null);
  const b = v.liftOrphanBlockOf(mk(S, 2, R3, VL, 0, { tail: blk({ 0: 150 }, 0) }));
  T('[1] the block right after the roster: seat 0 less 150, the old host at seat 0', b && J(b.seats) === J({ 0: 150 }) && b.mask === 1 && b.host === 1, J(b));
  const ch = [v.CHAR_MAGIC | (1 << 8) | (3 << 16), 0x00030201];
  const b2 = v.liftOrphanBlockOf(mk(S, 2, R3, VL, 0, { tail: [v.T2BY_TAG | 0].concat(ch, [0xDB | (1 << 8) | (2 << 16), 7, 9], blk({ 0: 150 }, 0)) }));
  T('[1] after the T2BY tag, the char block (pc seats) and another block by its len', b2 && J(b2.seats) === J({ 0: 150 }), J(b2));
  const b3 = v.liftOrphanBlockOf(mk(S, 3, R4, VL4, 0, { tail: blk({ 0: 150, 2: 7 }, [0]) }));
  T('[1] two seats named, amounts in seat order', b3 && J(b3.seats) === J({ 0: 150, 2: 7 }) && b3.mask === 5, J(b3));
  T('[1] a version the job does not read: no block (the old path)', v.liftOrphanBlockOf(mk(S, 2, R3, VL, 0, { tail: blk({ 0: 150 }, 0, { ver: 2 }) })) === null);
  T('[1] an endless record: no block', v.liftOrphanBlockOf(mk(S, 2, R3, VL, 0, { mt: 7, tail: [0, 6, 0, 0, 0, 0, 0, 0, 0].concat(blk({ 0: 150 }, 0)) })) === null);
  const badOf = (tail) => v.liftOrphanBlockOf(mk(S, 2, R3, VL, 0, { tail }));
  T('[1] broken: a seat outside the table', badOf(blk({ 0: 150 }, 0, { mask: 9 })) === 'bad');
  T('[1] broken: no old host / an old host outside the table', badOf(blk({ 0: 150 }, 0, { hm: 0 })) === 'bad' && badOf(blk({ 0: 150 }, 0, { hm: 8 })) === 'bad');
  T('[1] broken: len and mask disagree', badOf(blk({ 0: 150 }, 0, { len: 3 }).concat([1])) === 'bad');
  T('[1] broken: an amount of 0 or below', badOf(blk({ 0: 0 }, 0)) === 'bad' && badOf(blk({ 0: -5 }, 0)) === 'bad');
  T('[1] broken: the top byte of the head set / the second word\'s top bits set', badOf([blk({ 0: 150 }, 0)[0] | (1 << 24)].concat(blk({ 0: 150 }, 0).slice(1))) === 'bad'
    && badOf([blk({ 0: 150 }, 0)[0], (1 << 16) | 0x101, 150]) === 'bad');
  T('[1] broken: cut short', badOf(blk({ 0: 150 }, 0).slice(0, 2)) === 'bad');
});

// ---- [2] liftOrphanVerdict / groupRecords ----
section('[2] settle', () => {
  const nH = mk(N, 1, R3, VH, 0), sL = mk(S, 2, R3, VL, 0, { tail: blk({ 0: 150 }, 0) });
  const raw = nH.d.slice();
  const lo = verdict([nH, sL]);
  T('[2] P1: settle on the table less the orphan', lo && lo.kind === 'settle' && J(lo.low) === J(VL) && J(lo.high) === J(VH) && J(lo.named) === J({ 0: 150 }) && J(lo.hosts) === J([0]) && J(lo.writers) === J([S]), J(lo && { k: lo.kind, low: lo.low, why: lo.why }));
  const cp = lo.g.find((r) => r.steamID === N);
  T('[2] P1: the new host\'s copy carries the settled scores and remembers its own (liftOrphanOwn), the shard record untouched',
    cp && cp !== nH && J(scoresOf(cp)) === J(VL) && cp.liftOrphanOwn === J(VH) && cp.nosumOwn == null && J(nH.d) === J(raw));
  T('[2] P1: the canonical record (first) is the survivor\'s own, unrewritten', lo.g[0] === sL && lo.g.length === 2);
  const lo2 = verdict([sL, nH]);
  T('[2] P1 read the other way round: the same', lo2 && lo2.kind === 'settle' && lo2.g[0] === sL && J(lo2.low) === J(VL));
  const gr = group([nH, sL]);
  const cm = gr.consistentMatches[0];
  T('[2] groupRecords: one consistent entry carrying the verdict, nobody flagged, counted', gr.consistentMatches.length === 1 && gr.inconsistentGroups.length === 0
    && gr.flagged === 0 && cm.lorph && cm.lorph.kind === 'settle' && !cm.void && gr.lorph.settle === 1 && gr.lorph.hold === 0 && cm.g.every((r) => vecOf(r) === J(VL)) && gr.groups[cm.m] === cm.g,
    J({ c: gr.consistentMatches.length, i: gr.inconsistentGroups.length, f: gr.flagged, l: gr.lorph }));
  // the cheat A shape (Q65 repro 1): the old host forwarded a forged +5000 for his own seat and left; the survivor takes it back out
  const cg = verdict([mk(N, 1, R3, CH, 0), mk(S, 2, R3, CL, 0, { tail: blk({ 0: 5000 }, 0) })]);
  T('[2] cheat A (forged +5000 for the old host\'s seat): settles on the scores without it -- the lift is gone', cg && cg.kind === 'settle' && J(cg.low) === J(CL), J(cg && cg.low));
  // 4P, two survivors: both missed the frame / one of them had it (no orphan on its side)
  const four = verdict([mk(N, 1, R4, VH4, 0), mk(S, 2, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) }), mk(S2, 3, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) })]);
  T('[2] 4P, both survivors name the same orphan: settle', four && four.kind === 'settle' && J(four.low) === J(VL4) && J(four.writers) === J([S, S2]), J(four && four.kind));
  const four2 = verdict([mk(N, 1, R4, VH4, 0), mk(S, 2, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) }), mk(S2, 3, R4, VH4, 0)]);
  T('[2] 4P, one survivor had the frame: settle on the lower score (a departed seat moves nobody present)', four2 && four2.kind === 'settle' && J(four2.low) === J(VL4)
    && four2.g.filter((r) => r.liftOrphanOwn === J(VH4)).length === 2, J(four2 && four2.kind));
  // a 10 among them: one written with the block (its vector already the low one), one without it (set aside the Q68 way)
  const t10 = verdict([mk(N, 1, R4, VH4, 0), mk(S, 2, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) }), mk(S2, 3, R4, VH4, NOS)]);
  const c10 = t10 && t10.g.find((r) => r.steamID === S2);
  T('[2] 4P with a 10 that differs: settle, the 10 set aside (nosumOwn and liftOrphanOwn), the canonical record a 0', t10 && t10.kind === 'settle' && c10 && c10.nosumOwn === J(VH4)
    && c10.liftOrphanOwn === J(VH4) && J(scoresOf(c10)) === J(VL4) && (t10.g[0].dispCode | 0) === 0);
  const t10b = verdict([mk(N, 1, R4, VH4, 0), mk(S, 2, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) }), mk(S2, 3, R4, VL4, NOS, { tail: blk({ 0: 150 }, 0) })]);
  T('[2] 4P with a 10 that names the same orphan: settle, the 10 unrewritten', t10b && t10b.kind === 'settle' && t10b.g.find((r) => r.steamID === S2).nosumOwn == null);
});
section('[2] hold', () => {
  const nH = mk(N, 1, R3, VH, 0), sL = mk(S, 2, R3, VL, 0, { tail: blk({ 0: 150 }, 0) });
  const h1 = verdict([nH, sL, mk(O, 0, R3, VH, 0)]);
  T('[2] the named seat wrote a record (an honest old host\'s cold rejoin): hold', h1 && h1.kind === 'hold' && h1.why === 'seat 0 wrote a record', J(h1 && h1.why));
  const h2 = verdict([nH, sL, mk(O, 1, R3, VH, 0, { shard: 1 })]);
  T('[2] the account at the named seat wrote a record elsewhere: hold', h2 && h2.kind === 'hold' && /account at seat 0 wrote a record/.test(h2.why), J(h2 && h2.why));
  const h3 = verdict([nH, sL], { gate: { 0: v.pid(S), 1: v.pid(N), 2: v.pid(X) } });
  T('[2] the start roster\'s account at the named seat wrote a record: hold', h3 && h3.kind === 'hold' && /start roster's account at seat 0/.test(h3.why), J(h3 && h3.why));
  const h4 = verdict([nH, sL], { agreed: [v.pid(O)] });
  T('[2] the named seat was seen agreeing on the key: hold', h4 && h4.kind === 'hold' && h4.why === 'seat 0 was seen agreeing', J(h4 && h4.why));
  // a modded host's lift for a friend who stayed (seat 2), the survivor at seat 3 names it
  const fr = verdict([mk(N, 1, R4, [5000, 3000, 2150, 1500], 0), mk(S, 2, R4, [5000, 3000, 2150, 1500], 0), mk(S2, 3, R4, [5000, 3000, 2000, 1500], 0, { tail: blk({ 2: 150 }, 0) })]);
  T('[2] a lift for a seat still in the match: hold, settles nothing', fr && fr.kind === 'hold' && fr.why === 'seat 2 wrote a record', J(fr && fr.why));
  for (const [mt, ros, hi, lo0] of [[5, R4, VH4, VL4], [10, R3, VH, VL], [11, R3, VH, VL]]) {
    const t = verdict([mk(N, 1, ros, hi, 0, { mt }), mk(S, 2, ros, lo0, 0, { mt, tail: blk({ 0: 150 }, 0) })]);
    T('[2] match type ' + mt + ': hold (only a matchmade FFA settles this way)', t && t.kind === 'hold' && t.why === 'match type ' + mt, J(t && t.why));
  }
  const fl = verdict([mk(N, 1, R3, VH, 0), mk(S, 2, R3, [5150 - 200000, 3000, 2000], 0, { tail: blk({ 0: 200000 }, 0) })]);
  T('[2] a named lift that would take the seat under the score floor: hold', fl && fl.kind === 'hold' && /below the score floor/.test(fl.why), J(fl && fl.why));
  const gh = group([nH, sL, mk(O, 0, R3, VH, 0)]);
  T('[2] groupRecords: a hold is an inconsistent entry carrying the verdict, counted', gh.inconsistentGroups.length === 1 && gh.inconsistentGroups[0].lorph
    && gh.inconsistentGroups[0].lorph.kind === 'hold' && gh.lorph.hold === 1 && gh.consistentMatches.length === 0);
  const gs = group([nH, sL], { [H.keyOf(nH.d)]: { agreed: [v.pid(O)] } });
  T('[2] groupRecords reads the start state (pend.agreed) for the key', gs.inconsistentGroups.length === 1 && gs.lorph.hold === 1 && gs.inconsistentGroups[0].lorph.why === 'seat 0 was seen agreeing');
});
section('[2] not this pass', () => {
  const nH = mk(N, 1, R3, VH, 0);
  T('[2] a block that does not explain the vectors: null (a forgery stays a forgery)', verdict([nH, mk(S, 2, R3, [5000, 3000, 1900], 0, { tail: blk({ 0: 150 }, 0) })]) === null);
  T('[2] a broken block: null', verdict([nH, mk(S, 2, R3, VL, 0, { tail: blk({ 0: 150 }, 0, { hm: 0 }) })]) === null);
  T('[2] no block: null', verdict([nH, mk(S, 2, R3, VL, 0)]) === null);
  T('[2] one account alone (the same survivor twice): null', verdict([mk(S, 2, R3, VH, 0), mk(S, 2, R3, VL, 0, { shard: 1, tail: blk({ 0: 150 }, 0) })]) === null);
  T('[2] a gamble tag / a gamble block on the key: null (the gamble lanes)', verdict([nH, mk(S, 2, R3, VL, 0, { tail: [v.T2BY_TAG | 1].concat(blk({ 0: 150 }, 0)) })]) === null
    && verdict([nH, mk(S, 2, R3, VL, 0, { tail: [0xDB | (1 << 8) | (1 << 16), 1].concat(blk({ 0: 150 }, 0)) })]) === null);
  T('[2] two seats: null (a survivor that is not the new host needs three)', verdict([mk(N, 1, [O, N], [5150, 3000], 0), mk(O, 0, [O, N], [5000, 3000], 0, { tail: blk({ 0: 150 }, 1) })]) === null);
  T('[2] another seat count: null', verdict([nH, Object.assign(mk(S, 2, R4, VL4, 0, { tail: blk({ 0: 150 }, 0) }))]) === null);
  // a 10 (no summary) carrying the block beside the new host's record -- one account with a summary: Q68's lane (pending)
  const c = group([nH, mk(S, 2, R3, VL, NOS, { tail: blk({ 0: 150 }, 0) })]);
  T('[2] the new host + a 10 carrying the block: Q68 holds it (pending), nobody flagged', c.lorph.settle === 0 && c.lorph.hold === 0 && c.nosum.pending === 1
    && c.flagged === 0 && c.inconsistentGroups.length === 0 && c.consistentMatches.length === 0, J({ l: c.lorph, n: c.nosum }));
  // what the client (B088) writes when the final summary never came on top of P1 (Q65 repro 3 shape): no 10 (an orphan
  //   forbids it), the seat lowered by the orphan AND by the lift the missing summary left open, the block naming the
  //   orphan only -- the block does not explain it: the old path (as before Q339)
  T('[2] P1 with the final summary lost (no 10, the seat lowered twice, the block names one): null (the old path)',
    verdict([nH, mk(S, 2, R3, [VL[0] - 150].concat(VL.slice(1)), 0, { tail: blk({ 0: 150 }, 0) })]) === null);
  const eq = group([nH, mk(S, 2, R3, VH, 0, { tail: blk({ 0: 150 }, 0) })]);
  T('[2] vectors equal, a block on one: plain consistent (the block is only read on a disagreement)', eq.consistentMatches.length === 1 && !eq.consistentMatches[0].lorph && eq.lorph.settle === 0);
});

// ---- [3] applyLiftOrphans ----
section('[3]', () => {
  const now = Date.UTC(2026, 9, 29);
  const nH = mk(N, 1, R3, VH, 0, { hash: 0x3391 }), sL = mk(S, 2, R3, VL, 0, { hash: 0x3391, tail: blk({ 0: 150 }, 0) });
  const hN = mk(N, 1, R3, VH, 0, { hash: 0x3392 }), hS = mk(S, 2, R3, VL, 0, { hash: 0x3392, tail: blk({ 0: 150 }, 0) }), hO = mk(O, 0, R3, VH, 0, { hash: 0x3392, dur: 90000 });
  const gr = group([nH, sL, hN, hS, hO]);
  const mS = H.keyOf(nH.d), mH = H.keyOf(hN.d);
  T('[3] (setup) one settle, one hold', gr.consistentMatches.length === 1 && gr.inconsistentGroups.length === 1);
  const s = { players: {}, flagged: {}, pairs: {} };
  v.sigPlayer(s, v.pid(O), now - 1000);   // the old host already has signals (another match of his)
  const res = quiet(() => v.applyLiftOrphans(gr, s, new Set(), now));
  T('[3] the hold leaves the list (the flag loop never sees it), counted', gr.inconsistentGroups.length === 0 && res.hold === 1 && res.dirty === true, J(res));
  T('[3] nobody flagged for the disagreement; the writer whose own record breaks its own duration bound flagged alone', (s.players[v.pid(O)] || {}).f === 1
    && !((s.players[v.pid(N)] || {}).f) && !((s.players[v.pid(S)] || {}).f) && res.own === 1 && J(res.touched) === J([O]), J({ p: s.players, res }));
  T('[3] one signal per key, both outcomes', s.lorph && s.lorph[mS] && s.lorph[mS].a === 's' && s.lorph[mH] && s.lorph[mH].a === 'h'
    && J(s.lorph[mS].o) === J([v.pid(O)]) && J(s.lorph[mS].w) === J([v.pid(S)]) && s.lorph[mS].s === 1 && s.lorph[mS].t === now, J(s.lorph));
  T('[3] the writer of the block counted on his own account (low), once per key', s.players[v.pid(S)].low === 2 && !(s.players[v.pid(N)] || {}).low);
  T('[3] the old host counted (loh) on an account that already has signals, once per key', s.players[v.pid(O)].loh === 2, J(s.players[v.pid(O)]));
  const s2 = { players: {}, flagged: {}, pairs: {} };
  quiet(() => v.applyLiftOrphans(group([nH, sL]), s2, new Set(), now));
  T('[3] an old host the signals have not seen: no entry made for him', !s2.players[v.pid(O)] && s2.players[v.pid(S)].low === 1);
  const again = quiet(() => v.applyLiftOrphans(group([nH, sL, hN, hS, hO]), s, new Set(), now + 60000));
  T('[3] a later run: no second signal, no second count', s.players[v.pid(S)].low === 2 && s.lorph[mS].t === now && again.hold === 1);
  const s3 = { players: {}, flagged: {}, pairs: {} }, gp = group([nH, sL, hN, hS, hO]);
  const r3 = quiet(() => v.applyLiftOrphans(gp, s3, new Set([mS, mH]), now));
  T('[3] a processed key: left alone (no signal, no flag, stays where it was)', !s3.lorph && r3.hold === 0 && r3.own === 0 && gp.inconsistentGroups.length === 1 && !Object.keys(s3.players).length);
  const s5 = { players: {}, flagged: {}, pairs: {} };
  const p5 = mk(N, 1, R3, [5000, 3000, 2150], 0, { hash: 0x3396 }), g5 = group([p5, mk(S, 2, R3, [5000, 3000, 2000], 0, { hash: 0x3396, tail: blk({ 2: 150 }, 0) })]);
  const r5 = quiet(() => v.applyLiftOrphans(g5, s5, new Set(), now));
  T('[3] a hold of two voices stays in the list for the pair-dispute lane (which flags nobody either), signalled and counted', g5.inconsistentGroups.length === 1 && r5.hold === 1
    && (s5.lorph || {})[H.keyOf(p5.d)] && s5.lorph[H.keyOf(p5.d)].a === 'h' && !Object.keys(s5.players).some((k) => s5.players[k].f) && !!v.pairDispute1v1(g5.inconsistentGroups[0].g), J({ r5, l: s5.lorph }));
  const s4 = { players: {}, flagged: {}, pairs: {}, lorph: { old: { t: now - 46 * 86400000 }, young: { t: now - 86400000 } } };
  v.pruneSignals(s4, now);
  T('[3] pruneSignals: a per-key entry past the pair window goes, a young one stays', !s4.lorph.old && !!s4.lorph.young);
});

// ---- [4] seedcap ----
section('[4]', () => {
  const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
  const st = { audited: {}, chain: {} };
  const p = sc.pendingOfGroup(st, 'k1', [mk(N, 1, R3, VH, 0, { hash: 0x3393 }), mk(S, 2, R3, VL, 0, { hash: 0x3393, tail: blk({ 0: 150 }, 0) })].map(asSc));
  T('[4] a settle shape is audited on the lowered scores, every writer a claimant', p && J(p.scores) === J(VL) && J(p.self) === J([1, 2]), J(p && { s: p.scores, self: p.self }));
  const ph = sc.pendingOfGroup(st, 'k2', [mk(N, 1, R3, VH, 0, { hash: 0x3394 }), mk(S, 2, R3, VL, 0, { hash: 0x3394, tail: blk({ 0: 150 }, 0) }), mk(O, 0, R3, VH, 0, { hash: 0x3394 })].map(asSc));
  T('[4] a hold shape: not audited (no agreed scores)', ph === null, J(ph));
  const pc = sc.pendingOfGroup(st, 'k3', [mk(N, 1, R3, CH, 0, { hash: 0x3395 }), mk(S, 2, R3, CL, 0, { hash: 0x3395, tail: blk({ 0: 5000 }, 0) })].map(asSc));
  T('[4] cheat A: audited on the scores without the forged lift', pc && J(pc.scores) === J(CL));
});

// ---- [5] end to end ----
const MIN = 60000, HOUR = 3600000;
const XPB = 5, RATING = 6;
const cases = [];
let hashN = 0x3398, sidN = 3400;
// res: [seat, scores, disp, tail]
function addCase(name, pc, mt, res) {
  const ros = []; for (let i = 0; i < pc; i++) ros.push(SID(sidN++));
  const hash = hashN++;
  const S0 = ros.map((sid, seat) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, ros.map(() => 0)) }));
  const R = (x) => { const d = H.rec(0xB1, mt, hash, x[0], 1 + x[1].filter((y) => y > x[1][x[0]]).length, false, ros, x[1], x[2] | 0); for (const w of (x[3] || [])) d.push(w); return { sid: ros[x[0]], d }; };
  const c = { name, ros, mt, key: H.keyOf(S0[0].d), S: S0, R: res.map(R) };
  cases.push(c);
  return c;
}
const B0 = () => blk({ 0: 150 }, 0), B5 = () => blk({ 0: 5000 }, 0);
const cP1 = addCase('P1', 3, 1, [[1, VH, 0], [2, VL, 0, B0()]]);
const cP1c = addCase('P1c', 3, 1, [[1, VL, 0], [2, VL, 0]]);              // the same match agreed on the lowered scores
const cP4 = addCase('P4', 4, 1, [[1, VH4, 0], [2, VL4, 0, B0()], [3, VL4, 0, B0()]]);
const cP4c = addCase('P4c', 4, 1, [[1, VL4, 0], [2, VL4, 0], [3, VL4, 0]]);
const cCH = addCase('CH', 3, 1, [[1, CH, 0], [2, CL, 0, B5()]]);
const cCHc = addCase('CHc', 3, 1, [[1, CL, 0], [2, CL, 0]]);
const cHD = addCase('HD', 4, 1, [[1, [5000, 3000, 2150, 1500], 0], [2, [5000, 3000, 2150, 1500], 0], [3, [5000, 3000, 2000, 1500], 0, blk({ 2: 150 }, 0)]]);
const cPD = addCase('PD', 3, 1, [[1, [5000, 3000, 2150], 0], [2, [5000, 3000, 2000], 0, blk({ 2: 150 }, 0)]]);
const cFG = addCase('FG', 4, 1, [[1, VH4, 0], [2, VH4, 0], [3, [5000, 3000, 2000, 1400], 0, B0()]]);
const extra = () => [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
const allS = [].concat(...cases.map((c) => c.S)), allR = [].concat(...cases.map((c) => c.R));
const schedule = [[0, allS], [6 * MIN, allS.concat(allR)], [6 * MIN, allS.concat(allR)], [6 * MIN, allS.concat(allR)], [2 * HOUR, allS.concat(allR)]];
const rs = [];
section('[5] runs', () => {
  let state = null;
  for (const [ms, recs] of schedule) {
    const r = H.runCron(H.shardBoards(recs, extra()), state ? H.advance(state, ms) : null, null, null, 'lift-orphan');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
});
const last = rs[rs.length - 1], pre = rs[rs.length - 2];
if (process.env.LIFT_DEBUG) rs.forEach((r, i) => { console.log('---- run ' + i); console.log(r.out.split('\n').filter((l) => cases.some((c) => l.indexOf(c.key) >= 0)).join('\n')); });
const processedOf = (r) => new Set((r && r.state.PROCESSED_FILE) || []);
const sigOf = (r, sid) => (((r && r.state.SIGNALS_FILE) || {}).players || {})[v.pid(sid)] || {};
const fOf = (r, sid) => sigOf(r, sid).f | 0;
const leavesOf = (r, sid) => (((r && r.state.LEAVERS_FILE) || {})[v.pid(sid)] || {}).leaves | 0;
const allPosts = (board, sid) => [].concat(...rs.map((r) => H.postsOf(r, board, sid).map((p) => p.score)));
const noFlags = (c) => rs.every((r) => c.ros.every((s) => fOf(r, s) === 0));
const flagsOf = (c) => J(rs.map((r) => c.ros.map((s) => fOf(r, s))));
const allOut = () => rs.map((r) => r.out).join('');
section('[5]', () => {
  T('[5] five runs exit 0', rs.length === schedule.length && rs.every((r) => r.code === 0), last && last.out.slice(-1500));
  // P1 (two writers: the new host and the survivor) / P4 (three: two survivors) / CH (the cheat A shape (Q65 repro 1)): settled on the
  //   lowered scores -- every seat present paid exactly as in the same match agreed on them; the old host's seat the same
  for (const [c, ctl] of [[cP1, cP1c], [cP4, cP4c], [cCH, cCHc]]) {
    T('[5] ' + c.name + ': settled, nobody ever flagged', processedOf(last).has(c.key) && processedOf(last).has(ctl.key) && noFlags(c), flagsOf(c));
    const xp = (k) => k.ros.slice(1).map((s) => J(allPosts(XPB, s))), rt = (k) => k.ros.slice(1).map((s) => J(allPosts(RATING, s)));
    T('[5] ' + c.name + ': XP and rating of the seats present exactly as the same match agreed on the lowered scores (' + ctl.name + ')',
      J(xp(c)) === J(xp(ctl)) && J(rt(c)) === J(rt(ctl)) && xp(c).every((x) => /^\[[1-9][0-9]*\]$/.test(x)) && rt(c).every((x) => /^\[-?[0-9]+\]$/.test(x)), J({ c: [xp(c), rt(c)], ctl: [xp(ctl), rt(ctl)] }));
    T('[5] ' + c.name + ': the old host\'s seat as in ' + ctl.name + ' (no record of his: the same exit, no rating, no XP)', leavesOf(last, c.ros[0]) === leavesOf(last, ctl.ros[0])
      && J(allPosts(XPB, c.ros[0])) === J(allPosts(XPB, ctl.ros[0])) && J(allPosts(RATING, c.ros[0])) === J(allPosts(RATING, ctl.ros[0])), J({ l: [leavesOf(last, c.ros[0]), leavesOf(last, ctl.ros[0])] }));
  }
  T('[5] P1: the settle line says so', new RegExp('match=' + cP1.key + ': 2 records differ only by the lifts a host migration left unchecked, named by 1 writer\\(s\\) \\(seat 0 -150\\), every named seat left the match -- consistent on the lowered scores, nobody flagged \\(Q339\\)').test(allOut()));
  // HD: a lift for a seat still in the match (three writers) -- held, nobody flagged; voided at the start verdict, every writer consoled once
  T('[5] HD: held before the verdict, nobody flagged', pre && !processedOf(pre).has(cHD.key) && noFlags(cHD), flagsOf(cHD));
  const cons = (c) => c.ros.slice(1).map((s) => J(allPosts(XPB, s)));
  T('[5] HD: at the verdict processed, every writer consoled once (+50), none charged an exit', processedOf(last).has(cHD.key)
    && cons(cHD).every((x) => x === J([v.CONSOLATION_XP])) && cHD.ros.slice(1).every((s) => leavesOf(last, s) === 0), J({ cons: cons(cHD), l: cHD.ros.map((s) => leavesOf(last, s)) }));
  T('[5] HD: the hold line names why', new RegExp('lift-orphan ' + cHD.key + ': 3 records differ only by the lifts a host migration left unchecked \\(seat 2 wrote a record\\) -- nobody flagged for the disagreement, not settled \\(Q339\\)').test(allOut()));
  // PD: the same with two voices -- Q289 / Q291's lane as before (nobody flagged, the dispute counted on both), plus the signal
  T('[5] PD: two voices held by the pair-dispute lane as before: nobody flagged, the dispute counted on both, consoled at the verdict', pre && !processedOf(pre).has(cPD.key) && noFlags(cPD)
    && sigOf(last, cPD.ros[1]).pd === 1 && sigOf(last, cPD.ros[2]).pd === 1 && processedOf(last).has(cPD.key) && cons(cPD).every((x) => x === J([v.CONSOLATION_XP])), J({ f: flagsOf(cPD), cons: cons(cPD) }));
  // FG: a block that does not explain the vectors -- the old rule (every writer flagged once, not settled)
  T('[5] FG: not settled, every writer flagged once (as before Q339)', pre && !processedOf(pre).has(cFG.key) && cFG.ros.slice(1).every((s) => fOf(last, s) === 1), flagsOf(cFG));
  const row = (r) => (/\| keys whose records differ only by lifts a host migration left unchecked \(Q339\)[^|]*\| ([0-9]+ \/ [0-9]+ \/ [0-9]+) \|/.exec(r.summary) || [])[1];
  T('[5] the run summary row: run 2 settles 3 and holds 2, nobody flagged alone', rs[1] && row(rs[1]) === '3 / 2 / 0', J(rs.map(row)));
  const sg = (last && last.state.SIGNALS_FILE) || {};
  T('[5] one signal per key in the signals file (P1 / P4 / CH settled, HD / PD held, none for FG)', sg.lorph && ['P1', 'P4', 'CH'].every((n) => (sg.lorph[cases.find((c) => c.name === n).key] || {}).a === 's')
    && sg.lorph[cHD.key].a === 'h' && sg.lorph[cPD.key].a === 'h' && !sg.lorph[cFG.key] && sigOf(last, cP4.ros[2]).low === 1 && sigOf(last, cP4.ros[3]).low === 1, J(sg.lorph));
});

// ---- [6] wiring ----
section('[6]', () => {
  const S0 = H.SRC;
  T('[6] groupRecords reads the verdict ahead of the Q68 outcome, with the key\'s start state',
    /const ns = nosumVerdict\(g, vecOf\);   \/\/ Q68\n[^\n]*\n[^\n]*\n\s*const pend0 = opts\.starts \? opts\.starts\[m\] : null;\n\s*const lo = liftOrphanVerdict\(g, \{ agreed: \(pend0 && pend0\.agreed\) \|\| \[\], gate: seatGateRoster\(pend0\) \}\);/.test(S0)
    && /if \(lo && lo\.kind === 'settle'\) \{[\s\S]{0,400}consistentMatches\.push\(\{ m, g, void: cons\.isVoid, lorph: lo \}\);/.test(S0)
    && /\} else if \(lo\) \{\n\s*lorph\.hold\+\+;\n\s*inconsistentGroups\.push\(\{ m, g, lorph: lo \}\);/.test(S0)
    && /\} else if \(ns && ns\.kind === 'settle'\) \{/.test(S0));
  T('[6] main passes the start state and takes the holds out ahead of the flag loop',
    /const gr = groupRecords\(recs, \{ vecOf, MAX_SEATS, starts: startsPending \}\);/.test(S0)
    && /const lorphRes = applyLiftOrphans\(gr, signals, processed, nowMs\);[\s\S]{0,1600}\n  for \(const \{ m, g \} of inconsistentGroups\) \{/.test(S0)
    && S0.indexOf('const trustTouched = new Set();') < S0.indexOf('const lorphRes = applyLiftOrphans(')
    && S0.indexOf('const signals = loadSignals();') < S0.indexOf('const lorphRes = applyLiftOrphans('));
  T('[6] the block is read only when the scores differ (the else branch of groupRecords)', (S0.match(/liftOrphanVerdict\(/g) || []).length === 2);
  T('[6] seedcap audits a settle shape on its lowered scores, before the signed side', /const lo = v\.liftOrphanVerdict\(g, \{\}\);\n\s*if \(lo && lo\.kind === 'settle'\) g = all = lo\.g\.filter\(r => r\.nosumOwn == null\);/.test(SCSRC));
  T('[6] pruneSignals ages the per-key entries out', /for \(const k of Object\.keys\(s\.lorph \|\| \{\}\)\) if \(now - \(\(s\.lorph\[k\] && Number\(s\.lorph\[k\]\.t\)\) \|\| 0\) > SIG_PAIR_WINDOW_MS\) delete s\.lorph\[k\];/.test(S0));
});

try { fs.rmSync(SC_DIR, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('lift-orphan: ' + failN + ' FAIL') : 'lift-orphan: all ok');
process.exit(failN ? 1 : 0);
