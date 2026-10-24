'use strict';
// Cloud audit Q68 (R1-A5-04, found in Q59's second review): a result written without the host guard's final summary.
// A joiner the summary does not reach within 12 s judges the seats on their own (client Q59). Whether it gets through differs
// from end to end, so the score vectors could differ: the match stayed unsettled and every writer of it, the honest ones
// included, was flagged -- and a loser who blocked their own guard's link for a dozen seconds at the end got exactly that.
// Since Q68 such a result says so: disp 10 'finished-nosummary' (no layout change; the client writes it on a joiner's
// fallback only, never on the host, never on an endless segment). The job reads it only when the vectors differ:
//   [1] tables: dispName(10), valid class, never a VOID vote, a finish for the lone 1V1 claim
//   [2] nosumVerdict / groupRecords: settle (the receivers agree and, with the 10s that agree with them, are 2+ accounts:
//       a differing 10 is set aside on the agreed scores; the canonical first record is a receiver's even when a 10 was read
//       first), pending (one receiver), host (every record a 10), both held shapes listed in nosumHeld, fork (the receivers
//       disagree), all equal with 10s (plain consistent), endless / malformed / no 10 / a 10 naming a gamble refusal (null),
//       the sub-score winner a set-aside copy claims
//   [3] recordFlag skips a set-aside record (nosumOwn / nosumAside) and nothing else
//   [4] seedcap pickAuditable audits the receivers' vector; a differing 10 never claimed it (not a seat to convict)
//   [5] end to end over the REAL validate.js main() (offline board stub, test/lib/settle-stub.js), one schedule of runs
//       six minutes apart, then one at the start verdict: S settle 3P / TM sub-score 2V2 / EQ all equal / FK fork /
//       P pending 3P / P2 two seats (the Q308 floor of a disputed 1V1) / HS nobody got it / HL the host's own record late /
//       HN seat 0 named by the others only
//   [6] wiring pins
//   [7] the lanes a finish without the summary also takes since the reissue on the new reconcile base: the lone 1V1 claims
//       (Q184 / Q216) and the friends'-room lone result (Q316) take a 10 as the finish it is; the client knife 5.8b signed
//       lane reads a two-voice key held by nosumVerdict ('pending') like a disputed one (enforce settles it on the one usable
//       signed side, record only logs it), and seedcap audits it on that side under enforce
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const SC_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'final-nosummary-'));
process.env.SC_STATE_FILE = path.join(SC_DIR, 'seedcap.json');
const v = require(H.VALIDATE);
const sc = require(path.join(H.ROOT, 'seedcap.js'));
const SCSRC = fs.readFileSync(path.join(H.ROOT, 'seedcap.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
// a section that throws (a table or export the job does not have) fails, and the rest still runs
const section = (name, fn) => { try { fn(); } catch (e) { bad(name + ' threw: ' + (e && e.message)); } };

console.log('=== a result written without the host guard\'s final summary (Q68) ===');
const SID = H.SID, NOS = 10;
// a result in the reconcile's record shape (main: { steamID, shard, d, dispCode, disp, roster })
function mk(sid, seat, ros, sc0, disp, o) {
  o = o || {};
  const d = H.rec(0xB1, o.mt || 1, o.hash || 0x6800, seat, o.rank == null ? seat + 1 : o.rank, false, ros, sc0, disp | 0);
  if (o.tail) for (const x of o.tail) d.push(x);
  return { steamID: sid, shard: 'shard_' + (o.shard | 0), d, dispCode: disp | 0, disp: v.dispName(disp | 0), roster: v.decodeRoster(d) };
}
// the run's consistency vector (main's vecOf, endless tail included)
const vecOf = (r) => {
  const pc = r.d[8] | 0;
  if (pc < 1 || pc > 8 || r.d.length < 10 + pc) return 'BAD(pc=' + pc + ')';
  let x = r.d.slice(10, 10 + pc);
  if (v.isEndlessMt(r.d[2] | 0)) { const at = 11 + 3 * pc; if (r.d.length < at + 4) return 'BAD(tail)'; x = x.concat(r.d.slice(at, at + Math.min(9, r.d.length - at))); }
  return J(x);
};
const quiet = (fn) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return fn(); } finally { console.log = l; console.warn = w; } };
const group = (recs) => quiet(() => v.groupRecords(recs, { vecOf, MAX_SEATS: 8 }));

// ---- [1] tables ----
section('[1]', () => {
  T('[1] disp 10 = finished-nosummary, exported as DISP_NOSUMMARY', v.dispName(10) === 'finished-nosummary' && v.DISP_NOSUMMARY === NOS);
  T('[1] valid class (present and finished: XP, career and points as a finish)', v.dispClassOf(10) === 'valid' && v.dispClassOf(0) === 'valid' && v.dispClassOf(5) === 'abandoner' && v.dispClassOf(9) === 'innocent');
  T('[1] never a VOID vote; 2..9 still are, an unknown code too', !v.isVoidDisp(10) && !v.isVoidDisp(0) && !v.isVoidDisp(1)
    && [2, 3, 4, 5, 6, 7, 8, 9, 11, 99].every((c) => v.isVoidDisp(c)));
  T('[1] a key of finishes with and without the summary is not voided', !v.voidByConsensus([0, 10, 10]).isVoid && v.voidByConsensus([10, 10]).voidVotes === 0
    && v.voidByConsensus([10, 3, 3]).isVoid);
  T('[1] a finish for the lone 1V1 claim (with or without the summary), nothing else', v.isFinishDisp(0) && v.isFinishDisp(10) && !v.isFinishDisp(1) && !v.isFinishDisp(5));
});

// ---- [2] nosumVerdict / groupRecords ----
const A = SID(6801), B = SID(6802), C = SID(6803), D = SID(6804);
const R3 = [A, B, C], R4 = [A, B, C, D], R2 = [A, B];
const V = [5200, 3100, 900], W = [5200, 900, 3100], W2 = [4000, 900, 3100], V2 = [5000, 3100, 900];
section('[2] settle', () => {
  const recs = [mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), mk(C, 2, R3, W, NOS)];
  const raw = recs[2].d.slice();
  const ns = v.nosumVerdict(recs, vecOf);
  T('[2] two receivers agree, one 10 differs -> settle, the 10\'s writer set aside', ns && ns.kind === 'settle' && J(ns.set) === J([C]), J(ns && { kind: ns.kind, set: ns.set }));
  const cp = ns.g.find((r) => String(r.steamID) === C);
  T('[2] the set-aside copy carries the agreed scores, remembers its own scores (nosumOwn), the shard record is untouched',
    cp && J(cp.d.slice(10, 13)) === J(V) && cp.nosumOwn === J(W) && J(recs[2].d) === J(raw) && cp !== recs[2]);
  T('[2] the canonical record (first) is one that got the summary', ns.g[0].dispCode === 0);
  // (first review, suggestion 2) the same group read with the 10 first: the canonical record still is a receiver's -- the
  //   settle reads g[0] (match type, seats, seed, scores, roster; the guard signature block a 10 never carries)
  const nsF = v.nosumVerdict([recs[2], recs[0], recs[1]], vecOf);
  T('[2] read with the 10 first, the canonical record is still a receiver\'s (the 10\'s set-aside copy goes behind it)', nsF && nsF.kind === 'settle'
    && nsF.g[0] === recs[0] && nsF.g[0].dispCode === 0 && nsF.g.length === 3 && nsF.g.slice(1).some((r) => r.nosumOwn === J(W)), J(nsF && nsF.g.map((r) => [r.steamID, r.dispCode])));
  const gr = group(recs.slice());
  const cm = gr.consistentMatches[0];
  T('[2] groupRecords: one consistent entry (nosum = the set-aside account), not flagged, counted', gr.consistentMatches.length === 1 && gr.inconsistentGroups.length === 0
    && J(cm.nosum) === J([C]) && !cm.void && gr.flagged === 0 && gr.nosum.settle === 1 && gr.groups[cm.m] === cm.g && cm.g.every((r) => vecOf(r) === J(V)), J({ c: gr.consistentMatches.length, i: gr.inconsistentGroups.length, n: gr.nosum }));
  // a 10 that agrees with the receivers is an agreeing vote: one receiver and one agreeing 10 settle
  const ns2 = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, NOS), mk(C, 2, R3, W, NOS)], vecOf);
  T('[2] one receiver + one 10 that agrees with the receiver = two accounts -> settle (the agreeing 10 is not set aside)', ns2 && ns2.kind === 'settle' && J(ns2.set) === J([C]), J(ns2));
  // the same account twice (cold reconnect) is one voice
  const ns3 = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(A, 0, R3, V, 0, { shard: 1 }), mk(C, 2, R3, W, NOS)], vecOf);
  T('[2] one account twice is one voice -> pending, not settle', ns3 && ns3.kind === 'pending', J(ns3));
});
section('[2] pending / host / fork', () => {
  const p = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, W, NOS), mk(C, 2, R3, W2, NOS)], vecOf);
  T('[2] one receiver, the 10s differ from the receiver -> pending', p && p.kind === 'pending' && J(p.recv) === J([A]) && J(p.nos.slice().sort()) === J([B, C].sort()), J(p));
  const p2 = v.nosumVerdict([mk(A, 0, R2, [4000, 2500], 0), mk(B, 1, R2, [2500, 4000], NOS)], vecOf);
  T('[2] two seats, one receiver -> pending', p2 && p2.kind === 'pending', J(p2));
  const gp = group([mk(A, 0, R3, V, 0), mk(B, 1, R3, W, NOS), mk(C, 2, R3, W2, NOS)]);
  T('[2] groupRecords: a held key is in neither list, nobody flagged', gp.consistentMatches.length === 0 && gp.inconsistentGroups.length === 0 && gp.flagged === 0 && gp.nosum.pending === 1);
  T('[2] groupRecords: the held key is listed in nosumHeld with its records (the client knife 5.8b lane reads it)', gp.nosumHeld.length === 1
    && gp.nosumHeld[0].g === gp.groups[gp.nosumHeld[0].m] && gp.nosumHeld[0].g.length === 3);
  const h = v.nosumVerdict([mk(B, 1, R3, W, NOS), mk(C, 2, R3, W2, NOS)], vecOf);
  T('[2] every record a 10, 3 seats, seat 0 wrote nothing -> host = seat 0', h && h.kind === 'host' && h.host === A && h.why === '', J(h));
  const gh = group([mk(B, 1, R3, W, NOS), mk(C, 2, R3, W2, NOS)]);
  T('[2] groupRecords: the host shape is in neither list, listed for main (nosumHost), nobody flagged here', gh.consistentMatches.length === 0 && gh.inconsistentGroups.length === 0
    && gh.flagged === 0 && gh.nosum.host === 1 && gh.nosumHost.length === 1 && gh.nosumHost[0].host === A && gh.nosumHeld.length === 1);
  const gs = group([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), mk(C, 2, R3, W, NOS)]), gf0 = group([mk(A, 0, R3, V, 0), mk(B, 1, R3, V2, 0), mk(C, 2, R3, W, NOS)]);
  T('[2] groupRecords: a settled key and a fork are not in nosumHeld', gs.nosumHeld.length === 0 && gf0.nosumHeld.length === 0);
  const h2 = v.nosumVerdict([mk(A, 0, R2, [4000, 2500], NOS), mk(B, 1, R2, [2500, 4000], NOS)], vecOf);
  T('[2] two seats, both 10 -> nobody charged (two seats cannot be told apart, decision 10)', h2 && h2.kind === 'host' && h2.host === null && h2.why === 'two seats', J(h2));
  const R3x = [D, B, C];
  const h3 = v.nosumVerdict([mk(B, 1, R3, W, NOS), mk(C, 2, R3x, W2, NOS)], vecOf);
  T('[2] the records name seat 0 differently -> nobody charged', h3 && h3.kind === 'host' && h3.host === null && h3.why === 'seat 0 named differently', J(h3));
  const h4 = v.nosumVerdict([mk(A, 0, R3, V2, NOS), mk(B, 1, R3, W, NOS), mk(C, 2, R3, W2, NOS)], vecOf);
  T('[2] seat 0 wrote a record of the key (a 10 of its own) -> nobody charged', h4 && h4.kind === 'host' && h4.host === null && h4.why === 'seat 0 wrote a record', J(h4));
  const f = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V2, 0), mk(C, 2, R3, W, NOS)], vecOf);
  T('[2] the receivers disagree -> fork, the 10-only writer exempt', f && f.kind === 'fork' && J(f.exempt) === J([C]), J(f));
  const gf = group([mk(A, 0, R3, V, 0), mk(B, 1, R3, V2, 0), mk(C, 2, R3, W, NOS)]);
  const fg = gf.inconsistentGroups[0];
  T('[2] groupRecords: a fork stays inconsistent; only the 10-only writer\'s record is marked nosumAside', gf.inconsistentGroups.length === 1 && gf.flagged === 1
    && fg.g.filter((r) => r.nosumAside).map((r) => r.steamID).join() === C && gf.groups[fg.m] === fg.g);
  const fx = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V2, 0), mk(B, 1, R3, W, NOS, { shard: 1 })], vecOf);
  T('[2] a writer with a receiver\'s record of their own is never exempt in a fork', fx && fx.kind === 'fork' && fx.exempt.length === 0, J(fx));
});
section('[2] unchanged shapes', () => {
  const ge = group([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, NOS), mk(C, 2, R3, V, NOS)]);
  T('[2] all vectors equal (10s included) -> consistent as before, not a nosum shape', ge.consistentMatches.length === 1 && ge.consistentMatches[0].nosum == null
    && ge.nosum.settle === 0 && ge.nosum.pending === 0 && ge.nosum.host === 0 && ge.flagged === 0);
  T('[2] no 10 in the group -> null (the rule as before: inconsistent)', v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, W, 0)], vecOf) === null
    && group([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), mk(C, 2, R3, W, 0)]).flagged === 1);
  const tail = [0, 6, 0, 0];
  T('[2] an endless key -> null (its segment dispositions are their own lane)', v.nosumVerdict([mk(A, 0, R3, V, 0, { mt: 7, tail }), mk(B, 1, R3, W, NOS, { mt: 7, tail })], vecOf) === null);
  const badR = mk(B, 1, R3, W, NOS); badR.d[8] = 2;
  T('[2] another seat count / a malformed vector -> null', v.nosumVerdict([mk(A, 0, R3, V, 0), badR], vecOf) === null);
  // a 10 is written only by a joiner whose own base result was clean (client: no gamble refusal of theirs). A 10 naming a
  //   refusal -- Q43's T2BY_TAG int right after the roster, or Q61's gamble block -- keeps the gamble lanes' rules (null)
  const tagged = (r, words) => { const d = r.d.concat(words); return Object.assign({}, r, { d }); };
  const t2by = tagged(mk(C, 2, R3, W, NOS), [v.T2BY_TAG | 1]);
  T('[2] a 10 naming who voided a team gamble (Q43 T2BY_TAG) -> null (the rule as before)', v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), t2by], vecOf) === null);
  const gtb = tagged(mk(C, 2, R3, W, NOS), [0xDB | (1 << 8) | (1 << 16), 1]);
  T('[2] a 10 carrying the gamble refusal block (Q61) -> null (the rule as before)', v.gambleTagOf(gtb) !== 0
    && v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), gtb], vecOf) === null, 'gambleTagOf ' + v.gambleTagOf(gtb));
  T('[2] the same tags on a receiver\'s record do not stop the settle (a 0 is not the 10 the guard is about)', (() => {
    const x = v.nosumVerdict([tagged(mk(A, 0, R3, V, 0), [v.T2BY_TAG | 4]), mk(B, 1, R3, V, 0), mk(C, 2, R3, W, NOS)], vecOf); return !!x && x.kind === 'settle'; })());
});
section('[2] sub-score winner', () => {
  // 2V2 mode 2 (match type 5): seats 0,1 = team 0, seats 2,3 = team 1; the winner comes from the writers' rank claims
  const TV = [2000, 1500, 1800, 1200], TW = [2000, 1500, 1800, 2600];
  const recs = [mk(A, 0, R4, TV, 0, { mt: 5, rank: 1 }), mk(B, 1, R4, TV, 0, { mt: 5, rank: 2 }), mk(C, 2, R4, TV, 0, { mt: 5, rank: 3 }), mk(D, 3, R4, TW, NOS, { mt: 5, rank: 1 })];
  T('[2] as written, D\'s own winner conflicts with theirs (rank-conflict)', v.team2WinTeamOf(recs) === null);
  const ns = v.nosumVerdict(recs, vecOf);
  const cp = ns && ns.g.find((r) => String(r.steamID) === D);
  T('[2] the set-aside copy claims the agreed winner from its own seat (losing team: rank teamSize + 1)', ns && ns.kind === 'settle' && cp && (cp.d[6] | 0) === 3 && J(cp.d.slice(10, 14)) === J(TV), J(cp && cp.d.slice(0, 14)));
  T('[2] the settled group has one winner and no rank-conflict', v.team2WinTeamOf(ns.g) === 0 && v.sanityFlags(ns.g).indexOf('rank-conflict') < 0, J(v.sanityFlags(ns.g)));
  const mine = [mk(A, 0, R4, TV, 0, { mt: 5, rank: 1 }), mk(B, 1, R4, TV, NOS, { mt: 5, rank: 2 }), mk(C, 2, R4, TV, 0, { mt: 5, rank: 3 }), mk(D, 3, R4, TW, NOS, { mt: 5, rank: 4 })];
  const nm = v.nosumVerdict(mine, vecOf), cm = nm && nm.g.find((r) => String(r.steamID) === D);
  T('[2] the writer\'s own claim already on the agreed side: the copy keeps the winner (rank 3 = losing block), the agreeing 10 unchanged', nm && nm.kind === 'settle' && (cm.d[6] | 0) === 3
    && nm.g.find((r) => String(r.steamID) === B) === mine[1]);
});

// ---- [3] recordFlag ----
section('[3]', () => {
  const now = Date.UTC(2026, 9, 16);
  const s = { players: {}, flagged: {} };
  const recs = [mk(A, 0, R3, V, 0), mk(B, 1, R3, V2, 0), mk(C, 2, R3, W, NOS)];
  const gf = group(recs);
  const fg = gf.inconsistentGroups[0];
  T('[3] a fork flags the receivers only', v.recordFlag(s, fg.g, fg.m, now) === true && (s.players[v.pid(A)] || {}).f === 1 && (s.players[v.pid(B)] || {}).f === 1 && !s.players[v.pid(C)]);
  T('[3] once per key', v.recordFlag(s, fg.g, fg.m, now) === false && s.players[v.pid(A)].f === 1);
  const s2 = { players: {}, flagged: {} };
  const ns = v.nosumVerdict([mk(A, 0, R3, V, 0), mk(B, 1, R3, V, 0), mk(C, 2, R3, W, NOS)], vecOf);
  T('[3] a settled group\'s whole-group flag (sanity, veto) skips the set-aside copy', v.recordFlag(s2, ns.g, 'k1', now) === true && !s2.players[v.pid(C)]
    && s2.players[v.pid(A)].f === 1 && s2.players[v.pid(B)].f === 1);
  const s3 = { players: {}, flagged: {} };
  T('[3] a group of set-aside records only flags nobody and leaves the key unmarked', v.recordFlag(s3, ns.g.filter((r) => r.nosumOwn != null), 'k2', now) === false
    && !s3.flagged.k2 && !Object.keys(s3.players).length);
  const s4 = { players: {}, flagged: {} };
  T('[3] a writer\'s other record of the key still flags them', v.recordFlag(s4, [Object.assign({}, mk(C, 2, R3, W, NOS), { nosumAside: true }), mk(C, 2, R3, V, 0, { shard: 1 })], 'k3', now) === true
    && s4.players[v.pid(C)].f === 1);
  const s5 = { players: {}, flagged: {} };
  T('[3] a plain record (the host charge: { steamID }) flags its writer', v.recordFlag(s5, [{ steamID: A }], 'k4', now) === true && s5.players[v.pid(A)].f === 1);
});

// ---- [4] seedcap pickAuditable ----
section('[4]', () => {
  const st = { audited: {}, chain: {} };
  const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
  const groups = {
    s: [mk(A, 0, R3, V, 0, { hash: 0x6841 }), mk(B, 1, R3, V, 0, { hash: 0x6841 }), mk(C, 2, R3, W, NOS, { hash: 0x6841 })].map(asSc),
    h: [mk(B, 1, R3, W, NOS, { hash: 0x6842 }), mk(C, 2, R3, W2, NOS, { hash: 0x6842 })].map(asSc),
    e: [mk(A, 0, R3, V, 0, { hash: 0x6843 }), mk(B, 1, R3, V, NOS, { hash: 0x6843 }), mk(C, 2, R3, V, NOS, { hash: 0x6843 })].map(asSc),
    f: [mk(A, 0, R3, V, 0, { hash: 0x6844 }), mk(B, 1, R3, V2, 0, { hash: 0x6844 }), mk(C, 2, R3, W, NOS, { hash: 0x6844 })].map(asSc),
    p: [mk(A, 0, R3, V, 0, { hash: 0x6845 }), mk(B, 1, R3, W, NOS, { hash: 0x6845 }), mk(C, 2, R3, W2, NOS, { hash: 0x6845 })].map(asSc),
  };
  const pend = sc.pickAuditable(st, groups);
  const by = {}; for (const x of pend) by[x.m] = x;
  T('[4] the settle shape is audited on the receivers\' scores; the writer of the differing 10 is no claimant', by.s && J(by.s.scores) === J(V) && J(by.s.self) === J([0, 1]), J(by.s && { sc: by.s.scores, self: by.s.self }));
  T('[4] every record a 10 and they differ: skipped (nothing agreed to audit)', !by.h);
  T('[4] all equal, 10s included: audited, every writer a claimant', by.e && J(by.e.scores) === J(V) && J(by.e.self) === J([0, 1, 2]), J(by.e && by.e.self));
  T('[4] the receivers disagree: skipped (the reconcile\'s flag lane)', !by.f);
  T('[4] one receiver: their vector audited, only their seat a claimant', by.p && J(by.p.scores) === J(V) && J(by.p.self) === J([0]), J(by.p && by.p.self));
});

// ---- [5] end to end ----
const MIN = 60000, HOUR = 3600000;
const XPB = 5, RATING = 6;
const cases = [];
let hashN = 0x6850, sidN = 6810;
// starts: which seats wrote their own start (default all); res: [seat, scores, disp, rank]; late: results read from run 3 on
function addCase(name, pc, mt, starts, res, late) {
  const ros = []; for (let i = 0; i < pc; i++) ros.push(SID(sidN++));
  const hash = hashN++;
  const S = (starts || ros.map((_, i) => i)).map((seat) => ({ sid: ros[seat], d: H.rec(0xB2, mt, hash, seat, 0, false, ros, ros.map(() => 0)) }));
  const R = (x) => ({ sid: ros[x[0]], d: H.rec(0xB1, mt, hash, x[0], x[3] == null ? x[0] + 1 : x[3], false, ros, x[1], x[2] | 0) });
  const c = { name, ros, mt, key: H.keyOf(S[0].d), S, R: res.map(R), late: (late || []).map(R) };
  cases.push(c);
  return c;
}
const cS = addCase('S', 3, 1, null, [[0, V, 0], [1, V, 0], [2, W, NOS, 2]]);
const TV = [2000, 1500, 1800, 1200], TW = [2000, 1500, 1800, 2600];
const cTM = addCase('TM', 4, 5, null, [[0, TV, 0, 1], [1, TV, 0, 2], [2, TV, 0, 3], [3, TW, NOS, 1]]);
const cEQ = addCase('EQ', 3, 1, null, [[0, V, 0], [1, V, NOS], [2, V, NOS]]);
const cFK = addCase('FK', 3, 1, null, [[0, V, 0], [1, V2, 0], [2, W, NOS]]);
const cP = addCase('P', 3, 1, null, [[0, V, 0], [1, W, NOS], [2, W2, NOS]]);
const cP2 = addCase('P2', 2, 1, null, [[0, [4000, 2500], 0], [1, [2500, 4000], NOS]]);
const cHS = addCase('HS', 3, 1, null, [[1, W, NOS], [2, W2, NOS]]);
const cHL = addCase('HL', 3, 1, null, [[1, W, NOS], [2, W2, NOS]], [[0, W, 0]]);
const cHN = addCase('HN', 3, 1, [1, 2], [[1, W, NOS], [2, W2, NOS]]);

const extra = () => [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
const allS = [].concat(...cases.map((c) => c.S)), allR = [].concat(...cases.map((c) => c.R)), allL = [].concat(...cases.map((c) => c.late));
const schedule = [[0, allS], [6 * MIN, allS.concat(allR)], [6 * MIN, allS.concat(allR)], [6 * MIN, allS.concat(allR, allL)], [6 * MIN, allS.concat(allR, allL)],
  [6 * MIN, allS.concat(allR, allL)], [2 * HOUR, allS.concat(allR, allL)]];
const rs = [];
section('[5] runs', () => {
  let state = null;
  for (const [ms, recs] of schedule) {
    const r = H.runCron(H.shardBoards(recs, extra()), state ? H.advance(state, ms) : null, null, null, 'final-nosummary');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
});
const last = rs[rs.length - 1];
const processedOf = (r) => new Set((r && r.state.PROCESSED_FILE) || []);
const fOf = (r, sid) => ((((r && r.state.SIGNALS_FILE) || {}).players || {})[v.pid(sid)] || {}).f | 0;
const leavesOf = (r, sid) => (((r && r.state.LEAVERS_FILE) || {})[v.pid(sid)] || {}).leaves | 0;
const xpPosts = (r, sid) => H.postsOf(r, XPB, sid);
const ratingOf = (c, sid) => { const w = [].concat(...rs.map((r) => H.postsOf(r, RATING, sid))); return w.length === 1 ? w[0].score : null; };
const allOut = () => rs.map((r) => r.out).join('');
const noFlags = (c) => c.ros.every((s) => fOf(last, s) === 0);
section('[5]', () => {
  T('[5] seven runs exit 0', rs.length === schedule.length && rs.every((r) => r.code === 0), last && last.out.slice(-1500));
  // S: settles on the receivers' scores; the set-aside writer ranked last by them (their own judgement had them second)
  const r0 = ratingOf(cS, cS.ros[0]), r1 = ratingOf(cS, cS.ros[1]), r2 = ratingOf(cS, cS.ros[2]);
  T('[5] S: settled, nobody flagged, one rating write each', processedOf(last).has(cS.key) && noFlags(cS) && r0 != null && r1 != null && r2 != null, J({ r0, r1, r2 }));
  T('[5] S: ranked on the agreed scores (seat 0 > seat 1 > seat 2, not their own order)', r0 > r1 && r1 > r2, J({ r0, r1, r2 }));
  // the same match with every writer agreeing (EQ, same scores and seats): the set-aside writer is credited as if they had agreed
  const xpOf = (c) => c.ros.map((s) => J([].concat(...rs.map((r) => xpPosts(r, s).map((p) => p.score)))));
  const rtOf = (c) => c.ros.map((s) => ratingOf(c, s));
  T('[5] S: XP and rating per seat exactly as the agreeing match EQ (the set-aside writer present, finished, ranked last)', J(xpOf(cS)) === J(xpOf(cEQ)) && J(rtOf(cS)) === J(rtOf(cEQ))
    && xpOf(cS).every((x) => /^\[[1-9][0-9]*\]$/.test(x)), J({ S: [xpOf(cS), rtOf(cS)], EQ: [xpOf(cEQ), rtOf(cEQ)] }));
  T('[5] S: the settle line says so', /consistent on the scores of the writers who got the final summary, 1 own judgement\(s\) without it set aside, nobody flagged \(Q68\)/.test(allOut()));
  // TM: the sub-score winner from the agreeing claims, no rank-conflict
  const t = cTM.ros.map((s) => ratingOf(cTM, s));
  T('[5] TM: settled, nobody flagged, the winning pair (seats 0,1) up, D on the losing side', processedOf(last).has(cTM.key) && noFlags(cTM) && t.every((x) => x != null)
    && Math.min(t[0], t[1]) > Math.max(t[2], t[3]), J(t));
  T('[5] TM: no rank-conflict on the key', !new RegExp(cTM.key + '[^\\n]*rank-conflict').test(allOut()));
  // EQ: all equal, 10s included: as before
  T('[5] EQ: settled, nobody flagged', processedOf(last).has(cEQ.key) && noFlags(cEQ));
  // FK: the receivers disagree: as before (unsettled until the start verdict voids it), minus the 10-only writer
  const pre = rs[rs.length - 2];
  T('[5] FK: not settled, the receivers flagged once, the 10-only writer not', pre && !processedOf(pre).has(cFK.key) && fOf(last, cFK.ros[0]) === 1 && fOf(last, cFK.ros[1]) === 1
    && fOf(last, cFK.ros[2]) === 0 && rs.slice(1).every((r) => fOf(r, cFK.ros[2]) === 0), J(cFK.ros.map((s) => fOf(last, s))));
  // P / P2: held, nobody flagged; at the start verdict processed, every writer consoled once, no exit rate
  // (P2 is a two-seat matchmade key whose two writers' vectors differ: since Q308 each is consoled with the loser's XP of a
  //   1V1 -- the lowest money any record gives his seat, never below 50 -- instead of the flat 50, as for any disputed 1V1)
  const floorP2 = cP2.ros.map((s) => xpPosts(last, s).map((p) => p.score));
  for (const c of [cP, cP2]) {
    T('[5] ' + c.name + ': held before the verdict, nobody flagged', pre && !processedOf(pre).has(c.key) && c.ros.every((s) => fOf(pre, s) === 0));
    const cons = c.ros.map((s) => xpPosts(last, s).map((p) => p.score));
    const want = c === cP2 ? (x) => x.length === 1 && x[0] > v.CONSOLATION_XP && J(x) === J(floorP2[0]) : (x) => J(x) === J([v.CONSOLATION_XP]);
    T('[5] ' + c.name + ': at the verdict processed, every writer consoled once (' + (c === cP2 ? 'the Q308 floor, both the same: the lower money of the two is 2500' : '+50') + '), nobody flagged or charged an exit', processedOf(last).has(c.key) && noFlags(c)
      && cons.every(want) && c.ros.every((s) => leavesOf(last, s) === 0) && c.ros.every((s) => [].concat(...rs.slice(0, -1).map((r) => xpPosts(r, s))).length === 0),
      J({ cons, leaves: c.ros.map((s) => leavesOf(last, s)) }));
  }
  // HS: nobody got it -- nobody flagged until the verdict, then the opening host alone (and that host's exit, as before)
  T('[5] HS: held, nobody flagged before the verdict', pre && !processedOf(pre).has(cHS.key) && cHS.ros.every((s) => fOf(pre, s) === 0), J(cHS.ros.map((s) => fOf(pre, s))));
  T('[5] HS: at the verdict the opening host is flagged once, the writers are not', processedOf(last).has(cHS.key) && fOf(last, cHS.ros[0]) === 1 && fOf(last, cHS.ros[1]) === 0 && fOf(last, cHS.ros[2]) === 0,
    J(cHS.ros.map((s) => fOf(last, s))));
  T('[5] HS: the host\'s exit rate as before (own start, no record); the writers consoled, not charged', leavesOf(last, cHS.ros[0]) === 1 && leavesOf(last, cHS.ros[1]) === 0
    && J(xpPosts(last, cHS.ros[1]).map((p) => p.score)) === J([v.CONSOLATION_XP]) && J(xpPosts(last, cHS.ros[2]).map((p) => p.score)) === J([v.CONSOLATION_XP]));
  T('[5] HS: the flag line names the host', new RegExp('no-summary ' + cHS.key + ': nobody got the final summary -- the opening host [^\\n]* flagged at the start verdict \\(Q68\\)').test(last.out));
  // HL: the host's own record arrives late: it settles the key with the agreeing 10, nobody is ever flagged
  T('[5] HL: settled once that record is read, nobody ever flagged', processedOf(last).has(cHL.key) && rs.every((r) => cHL.ros.every((s) => fOf(r, s) === 0)), J(rs.map((r) => cHL.ros.map((s) => fOf(r, s)))));
  T('[5] HL: no exit rate for anyone', cHL.ros.every((s) => leavesOf(last, s) === 0));
  // HN: seat 0 named by the others only (no start of their own): nobody flagged or charged (Q69)
  T('[5] HN: at the verdict nobody flagged, seat 0 not charged an exit (named by the others only)', processedOf(last).has(cHN.key) && noFlags(cHN) && cHN.ros.every((s) => leavesOf(last, s) === 0),
    J({ f: cHN.ros.map((s) => fOf(last, s)), l: cHN.ros.map((s) => leavesOf(last, s)) }));
  T('[5] HN: the verdict line says nobody is charged', new RegExp('no-summary ' + cHN.key + ': nobody got the final summary, seat 0 not charged').test(last.out));
  // the run summary row: run 1 sees S + TM settle-shaped, P + P2 held, HS + HL + HN nobody-got-it; from run 3 HL settles
  const row = (r) => (/\| keys with a result written without the host guard's final summary \(Q68\)[^|]*\| ([0-9]+ \/ [0-9]+ \/ [0-9]+) \|/.exec(r.summary) || [])[1];
  T('[5] the run summary counts the shapes (run 1: 2 / 2 / 3, run 4: 3 / 2 / 2)', rs[1] && row(rs[1]) === '2 / 2 / 3' && rs[4] && row(rs[4]) === '3 / 2 / 2', J(rs.map(row)));
});

// ---- [6] wiring ----
section('[6]', () => {
  const S0 = H.SRC;
  T('[6] the table: name, isVoidDisp excludes 10, valid class', /'eac-drop', 'finished-nosummary'\];\nconst DISP_NOSUMMARY = 10;/.test(S0)
    && /const isVoidDisp = c => \(c \| 0\) >= 2 && \(c \| 0\) !== DISP_NOSUMMARY;/.test(S0)
    && /\(c === 0 \|\| c === 1 \|\| c === DISP_NOSUMMARY\) \? 'valid'/.test(S0));
  T('[6] groupRecords asks nosumVerdict only for a group whose vectors differ', /else \{\n\s*const ns = nosumVerdict\(g, vecOf\);   \/\/ Q68/.test(S0));
  T('[6] recordFlag skips the set-aside records', /const who = new Set\(g\.filter\(r => r\.nosumOwn == null && !r\.nosumAside\)\.map\(r => String\(r\.steamID\)\)\);/.test(S0));
  T('[6] the host charge only at the start verdict, on a start roster seating them at 0 with their own start, never contested, no record / confession of theirs',
    /for \(const vk of \(startsRes\.voided \|\| \[\]\)\) \{\n\s*const host = nosumHostOf\.get\(vk\.m\), p = vk\.p;/.test(S0)
    && /if \(!ro \|\| ro\[0\] !== hp \|\| !hasOwnStart\(p, hp\) \|\| \(vk\.note && vk\.note\.c\) \|\| \(p\.settled \|\| \[\]\)\.indexOf\(hp\) >= 0 \|\| confState\[hp \+ '\|' \+ vk\.m\]/.test(S0)
    && /voided\.push\(\{ m, pids: Object\.keys\(p\.roster\)\.map\(\(seat\) => p\.roster\[seat\]\), note: pending\['~' \+ m\] \|\| null, p \}\);/.test(S0));
  T('[6] the lone 1V1 claim takes a finish with or without the summary', /!isFinishDisp\(r\.dispCode\)\) return null;/.test(S0));
  T('[6] the signals histogram keeps its 7 slots (10 counts as a finish)', /const dc = dc0 === DISP_NOSUMMARY \? 0 : Math\.min\(6, Math\.max\(0, dc0\)\);/.test(S0));
  T('[6] seedcap convicts only the claimants of the audited scores', /self: selfSeatsOf\(claimed, roster\)/.test(SCSRC) && /const claimed = all\.filter\(r => vecOf\(r\.d\) === vecOf\(d0\)\);/.test(SCSRC)
    && /const vg = g\.filter\(r => !nos\(r\.d\)\);\n\s*if \(vg\.length && vg\.length < g\.length && /.test(SCSRC));
  T('[6] the lone 1V1 claims and the friends\' room lone result take a finish with or without the summary (three call sites)', (S0.match(/!isFinishDisp\(r\.dispCode\)/g) || []).length === 3);
  T('[6] the signed 1V1 lane walks the disputed keys and the keys held by nosumVerdict', /for \(const list of \[gr\.inconsistentGroups, gr\.nosumHeld \|\| \[\]\]\) for \(let i = list\.length - 1; i >= 0; i--\) \{/.test(S0)
    && /\n    list\.splice\(i, 1\);\n    gr\.consistentMatches\.push\(\{ m, g: g2,/.test(S0));
  T('[6] a 10 naming a gamble refusal keeps the gamble lanes\' rules', /for \(const r of nos\) \{ const i = 11 \+ 3 \* pc; if \(\(r\.d\.length > i && \(\(r\.d\[i\] \| 0\) & ~0x3F\) === T2BY_TAG\) \|\| gambleTagOf\(r\)\) return null; \}/.test(S0));
});

// ---- [7] the lanes a finish without the summary also takes (reissue on the new reconcile base) ----
section('[7] lone claims', () => {
  const w = SID(6890), o = SID(6891), h = 0x6890, ro = [w, o], key = h + '_1234_2';
  const Rr = (d, sid) => { const pc = d[8] | 0; return { steamID: sid, shard: 'shard_0', d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; };
  const st = { start: true, steamID: w, d: H.rec(0xB2, 2, h, 0, 0, false, ro, null), roster: null };
  st.roster = v.decodeRoster(st.d);
  const note = { t0: 0, s: [v.pid(w) + '@0#' + v.startSig(st)], r: 1, c: 0 };
  const won = (disp) => Rr(H.rec(0xB1, 2, h, 0, 1, true, ro, [7000, 4000], disp), w);
  // Q184: a ranked 1V1 only its winner wrote -- his finish without the summary is his own word as much as a 0
  const c10 = v.lone1v1Claim(note, key, [won(NOS)], {}, new Set()), c0 = v.lone1v1Claim(note, key, [won(0)], {}, new Set());
  T('[7] Q184: the winner\'s lone result written without the summary claims as a 0 does', !!c10 && !!c0 && J(c10) === J(c0), J({ c10, c0 }));
  T('[7] Q184: a peers-gone lone result still claims nothing', v.lone1v1Claim(note, key, [won(1)], {}, new Set()) === null);
  // Q216: the loser wrote only a record the job cannot use (a duration past the bound) -- the winner's 10 still claims
  const bV = (() => { const d = H.rec(0xB1, 2, h, 1, 2, false, ro, [7000, 4000], 0); d[9] = 90000; return Rr(d, o); })();
  const s10 = v.lone1v1Spoiled(note, key, [won(NOS), bV], {}, new Set(), false, null), s0 = v.lone1v1Spoiled(note, key, [won(0), bV], {}, new Set(), false, null);
  T('[7] Q216: the winner\'s result written without the summary beside the loser\'s spoiled record claims as a 0 does', !!s10 && !!s0 && J(s10) === J(s0) && s10.spoiled === 1, J({ s10, s0 }));
  // Q316: a friends' room only one player wrote a result for
  const A2 = SID(6892), B2 = SID(6893), KEY2 = (0x31699 | 0) + '_1234_10';
  const pv = (disp) => { const d = H.rec(0xB1, 10, 0x31699, 1, 1, true, [A2, B2], [500, 300], disp); return { steamID: B2, shard: 's0', d, dispCode: disp | 0, disp: v.dispName(disp | 0), roster: v.decodeRoster(d) }; };
  const ent = { t0: 1, mt: 10, roster: { 0: v.pid(A2), 1: v.pid(B2) }, settled: [v.pid(B2)], started: [v.pid(A2), v.pid(B2)] };
  const pvec = (r) => J(r.d.slice(10, 10 + (r.d[8] | 0)));
  const pl = (disp) => v.privateLoneClaim(ent, KEY2, [pv(disp)], {}, new Set(), {}, new Set(), pvec);
  T('[7] Q316: a friends\' room lone result written without the summary claims as a 0 does; peers-gone still does not', !!pl(NOS) && J(pl(NOS)) === J(pl(0)) && pl(1) === null, J({ a: pl(NOS), b: pl(0) }));
});
section('[7] signed 1V1 lane', () => {
  const MS = require(path.join(H.ROOT, 'match-sig.js'));
  const G = require(path.join(H.ROOT, 'tools', 'gen-match-sig-fixtures.js'));
  const crypto = require('crypto');
  const KEY = 2099102302;
  const TABLE = { [String(KEY)]: { pubs: [G.PUB_HEX], sealed: true }, dev: { pubs: [G.PUB_HEX], sealed: false } };
  const HO = SID(6895), JO = SID(6896), HON = [7000, 4000], LIE = [4000, 9000];
  const res1 = (seat, sc, disp) => { const rank = 1 + sc.filter((x) => x > sc[seat]).length; return H.rec(0xB1, 1, 0x6895, seat, rank, rank === 1, [HO, JO], sc, disp | 0); };
  const signed = (d) => {
    const h5 = MS.head(KEY, MS.packFlags({ role: 1, seen: 3 }), 0, H.sidPair(HO)[0]);
    const sig = crypto.sign(null, Buffer.from(MS.message(d, h5, null)), G.privKey());
    return MS.attach(d, h5.concat(MS.sigInts([...sig])));
  };
  const Rr = (sid, d) => { const pc = d[8] | 0; return { steamID: sid, shard: 'shard_0', d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; };
  const hostOk = Rr(HO, signed(res1(0, HON, 0)));
  const ctx = (mode) => ({ mode, pubTable: TABLE, allowDevKey: false, processed: new Set(), contested: new Map(), signals: { players: {}, flagged: {} }, now: Date.UTC(2026, 9, 23) });
  // the joiner judged without the host guard's summary (10, no block: the client asks its guard on a 'finished' record only)
  const g10 = group([hostOk, Rr(JO, res1(1, LIE, NOS))]);
  T('[7] a two-voice 1V1 with the joiner\'s 10 is held by nosumVerdict (pending) and listed in nosumHeld', g10.nosum.pending === 1 && g10.nosumHeld.length === 1
    && g10.inconsistentGroups.length === 0 && g10.consistentMatches.length === 0);
  const rec10 = quiet(() => v.applySignedPair(g10, ctx('record')));
  T('[7] record: counted as one signed side and logged, nothing moves', rec10.one === 1 && rec10.would === 1 && rec10.moved === 0 && g10.nosumHeld.length === 1 && g10.consistentMatches.length === 0, J(rec10));
  const cx10 = ctx('enforce'), e10 = group([hostOk, Rr(JO, res1(1, LIE, NOS))]), r10 = quiet(() => v.applySignedPair(e10, cx10));
  // the same match with the joiner's lie written as a plain finish (today's shape): the lane settles it the same way
  const e0 = group([hostOk, Rr(JO, res1(1, LIE, 0))]), r0 = quiet(() => v.applySignedPair(e0, ctx('enforce')));
  const strip = (c) => c && J({ m: c.m, void: c.void, sp: c.signedPair, g: c.g.map((r) => [r.steamID, r.d, r.dispCode, !!r.signedSynth]) });
  T('[7] enforce: settled on the host\'s signed table, the key leaves nosumHeld', r10.moved === 1 && e10.nosumHeld.length === 0 && e10.consistentMatches.length === 1
    && e10.consistentMatches[0].signedPair.a === HO && e10.consistentMatches[0].signedPair.o === JO, J(r10));
  T('[7] enforce: exactly the settle a plain disputed key of the same match gets (the joiner re-seated on the signed table)', r0.moved === 1 && e0.inconsistentGroups.length === 0
    && strip(e10.consistentMatches[0]) === strip(e0.consistentMatches[0]), strip(e10.consistentMatches[0]) + ' vs ' + strip(e0.consistentMatches[0]));
  T('[7] enforce: nobody flagged (no block is not a broken one)', !Object.keys(cx10.signals.players).length && !Object.keys(cx10.signals.flagged).length && r10.dirty === false && r10.oneBad === 0);
  // seedcap: the held two-voice key is audited on the receiver's scores in every mode (only the receiver claimed them)
  const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
  const p2 = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', [hostOk, Rr(JO, res1(1, LIE, NOS))].map(asSc));
  T('[7] seedcap: the held two-voice key is audited on the receiver\'s scores, only the receiver a claimant', p2 && J(p2.scores) === J(HON) && J(p2.self) === J([0]) && p2.w === 2, J(p2 && { s: p2.scores, self: p2.self, w: p2.w }));
});

try { fs.rmSync(SC_DIR, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('final-nosummary: ' + failN + ' FAIL') : 'final-nosummary: all ok');
process.exit(failN ? 1 : 0);
