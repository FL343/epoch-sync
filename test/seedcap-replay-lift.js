'use strict';
// W265 (2026-11-11; AFTER_EA line 467, round-2 audit B2-2 "AFTER_EA candidate" 4): the O198 replay lifts the veto.
// Before: a later primary core re-audited a match another core had put over its cap (replayCandidates: 14 days, o 1) and,
//   when the new cap covered a convicted self-written seat, reversed that conviction -- but left the match's veto in
//   place ("the veto stands"). The reconcile holds a vetoed key whole (validate.js main path: not settled, not processed,
//   the honest opponents included), and a core inside its observation window vetoes while convicting nobody. So a match a
//   core vetoed by its own miscount sat out VETO_KEEP_MIN (30 days) even after the fixed core said every score was
//   possible; a regular's 50-shard rotation writes over his records in far less, and then the match never settles.
// Now: applyReplay deletes the veto when the new cap covers EVERY seat of the match (convicted or not, self-written or
//   not); one seat still over keeps it exactly as before. The reconcile then settles the match on its next tick (the
//   veto's own "self-heals when the veto goes" path, test/seedcap-veto-flag.js [1]).
// Sections:
//   [1] applyReplay (real seedcap.js, pure): (a) the observation shape -- veto, nobody convicted -> lifted;
//       (b) the conviction shape -> reversed and lifted; (c) a seat that is not self-written still over -> the veto stays
//       (the self seat still reversed); (d) an error / a missing answer / no cap -> the veto stays; (e) the private gamble
//       headroom (capMult) counts as in the audit; (f) no veto left (aged out) -> nothing to lift; (g) an item without
//       scores -> no lift; (h) the log lines
//   [2] end to end: real records -> real pickAuditable / applyAudit on an observed core -> real validate.js holds the
//       match -> real replayCandidates / pendingOfGroup / applyReplay on a fixed core -> the next validate runs settle it
//       once (processed, one points write each), nobody flagged; a fixed core that still finds a seat over -> still held
//   [3] main() wiring pins (the replay result carries `lifted`, the replay summary line counts it)
//   [4] mutation self-checks (in process): no lift -> [1a] [1b] [2] red; lift whatever the other seats -> [1c] red;
//       only the self seats checked -> [1c] red; capMult ignored -> [1e] red; the empty-scores guard out -> [1g] red
// State isolation is structural (test/lib/settle-stub.js: every *_FILE var redirected, cwd = a temp dir).
const fs = require('fs'), path = require('path'), os = require('os');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.SC_STATE_FILE = path.join(os.tmpdir(), 'seedcap-replay-lift-' + process.pid + '.json');
const v = require(H.VALIDATE);
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const logs = [];
const quiet = (fn) => { const l = console.log; console.log = (...a) => logs.push(a.join(' ')); try { return fn(); } finally { console.log = l; } };

const SCSRC = fs.readFileSync(path.join(H.ROOT, 'seedcap.js'), 'utf8');
// compiled as if it sat next to seedcap.js (no file written): its './' requires resolve as the real one's do
let mutN = 0;
function scMutant(pairs) {
  let src = SCSRC;
  for (const [from, to] of pairs) { if (src.split(from).length !== 2) return null; src = src.replace(from, to); }
  const file = path.join(H.ROOT, '__mut_seedcap_w265_' + process.pid + '_' + (mutN++) + '.js');
  const m = new module.constructor(file, module);
  m.filename = file;
  m.paths = module.constructor._nodeModulePaths(H.ROOT);
  m._compile(src, file);
  return m.exports;
}

const P = H.SID(2651), Q = H.SID(2652);
const st0 = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });
// a pending item the way pendingOfGroup builds one (seat 0 -> P, seat 1 -> Q)
const item = (m, scores, self, extra) => Object.assign({ m, mt: 2, pc: scores.length, scores, self, runSeed: 1234, p: { capMult: 1 },
  roster: Object.fromEntries(scores.map((_, i) => [i, [P, Q][i]])) }, extra || {});
const su = (st, sid) => st.suspects[v.pid(sid)];
const C1 = 'core1hash001', C2 = 'core2hash002';

console.log('=== W265: a replay that puts every seat under the cap lifts the veto ===');

// ---- [1] applyReplay ----
function replayCases(S) {
  const out = {};
  // (a) observation shape: core1 inside its observation window vetoes [6000, 100] over 5500, convicts nobody
  {
    const st = st0(), x = item('ma', [6000, 100], [0, 1]);
    quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
    const before = { veto: !!st.veto.ma, sus: !!su(st, P) };
    logs.length = 0;
    const r = quiet(() => S.applyReplay(st, [x], { m0: { cap: 9000 } }, C2, 1100));
    out.a = { before, veto: !!st.veto.ma, lifted: (r.lifted || []).map((l) => [l.m, l.k0, l.k1, l.cap0, l.cap1]), reversed: r.reversed.length, rk: st.audited.ma && st.audited.ma.rk,
      log: logs.some((l) => /seedcap REPLAY m=ma core core1hash001 -> core2hash002: cap 5500 -> 9000, every seat now under the cap \(scores 6000,100\) -- veto lifted \(W265\)/.test(l)) };
  }
  // (b) conviction shape: seat 0 self-written over the cap on core1 (out of observation) -> convicted + veto; core2 covers both
  {
    const st = st0(), x = item('mb', [6000, 100], [0, 1]);
    quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1 }));
    const before = { veto: !!st.veto.mb, n: su(st, P) && su(st, P).n };
    logs.length = 0;
    const r = quiet(() => S.applyReplay(st, [x], { m0: { cap: 9000 } }, C2, 1100));
    out.b = { before, veto: !!st.veto.mb, lifted: (r.lifted || []).length, reversed: r.reversed.length, ne: v.seedcapNEff(su(st, P)), active: v.seedcapRejectActive(su(st, P), 1200),
      revLog: logs.some((l) => /conviction of [0-9a-f]{8} reversed \(n stays 1, effective 0; the veto goes with it, every seat under the cap\)/.test(l)) };
  }
  // (c) seat 1 not self-written (nobody wrote from it) and still over on core2: the veto stays, seat 0's conviction reversed
  {
    const st = st0(), x = item('mc', [6000, 7000], [0]);
    quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1 }));
    logs.length = 0;
    const r = quiet(() => S.applyReplay(st, [x], { m0: { cap: 6500 } }, C2, 1100));
    out.c = { veto: !!st.veto.mc, seats: st.veto.mc && st.veto.mc.seats, lifted: (r.lifted || []).length, reversed: r.reversed.length, ne: v.seedcapNEff(su(st, P)),
      revLog: logs.some((l) => /reversed \(n stays 1, effective 0; the veto stands, another seat still over\)/.test(l)) };
  }
  // (d) no usable answer: an error, no answer at all, a null cap -> nothing lifted
  {
    const res = [];
    for (const ans of [{ m0: { err: 'x' } }, {}, { m0: { cap: null } }]) {
      const st = st0(), x = item('md', [6000, 100], [0, 1]);
      quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
      const r = quiet(() => S.applyReplay(st, [x], ans, C2, 1100));
      res.push(!!st.veto.md && (r.lifted || []).length === 0 && st.audited.md.rk === C2);
    }
    out.d = res;
  }
  // (e) a private match: the gamble headroom (capMult 1.5) as in the audit -- 7000 is under 5000 x 1.5 = 7500
  {
    const st = st0(), x = item('me', [7000, 100], [0, 1], { p: { capMult: 1.5 } });
    quiet(() => S.applyAudit(st, [x], { m0: { cap: 4000 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
    const r = quiet(() => S.applyReplay(st, [x], { m0: { cap: 5000 } }, C2, 1100));
    const st2 = st0();
    quiet(() => S.applyAudit(st2, [x], { m0: { cap: 4000 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
    const r2 = quiet(() => S.applyReplay(st2, [x], { m0: { cap: 4600 } }, C2, 1100));   // 4600 x 1.5 = 6900 < 7000: still over
    out.e = { before: true, lifted: !st.veto.me && (r.lifted || []).length === 1, cap1: r.lifted && r.lifted[0] && r.lifted[0].cap1, held: !!st2.veto.me && (r2.lifted || []).length === 0 };
  }
  // (f) the veto already aged out (pruneState) before the replay: nothing to lift, no entry
  {
    const st = st0(), x = item('mf', [6000, 100], [0, 1]);
    quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
    delete st.veto.mf;
    const r = quiet(() => S.applyReplay(st, [x], { m0: { cap: 9000 } }, C2, 1100));
    out.f = { lifted: (r.lifted || []).length, vetoKeys: Object.keys(st.veto).length };
  }
  // (g) an item without scores (defensive: nothing to judge -> no lift)
  {
    const st = st0(); st.veto.mg = { t: 1000, seats: [0] }; st.audited.mg = { c: 5500, o: 1, k: C1, t: 1000 };
    const r = quiet(() => S.applyReplay(st, [item('mg', [], [])], { m0: { cap: 9000 } }, C2, 1100));
    out.g = { veto: !!st.veto.mg, lifted: (r.lifted || []).length };
  }
  return out;
}
const R1 = replayCases(sc);
T('[1a] observation shape (veto, nobody convicted): the fixed core covers both seats -> the veto is lifted, recorded once with both cores and caps, marked replayed',
  R1.a.before.veto && !R1.a.before.sus && !R1.a.veto && J(R1.a.lifted) === J([['ma', C1, C2, 5500, 9000]]) && R1.a.reversed === 0 && R1.a.rk === C2, J(R1.a));
T('[1a] the lift is logged (both cores, both caps, the scores; pid-free)', R1.a.log, logs.slice(-3).join(' | '));
T('[1b] conviction shape: reversed as before (effective 0, no window) and the veto lifted with it', R1.b.before.veto && R1.b.before.n === 1 && !R1.b.veto && R1.b.lifted === 1 && R1.b.reversed === 1 && R1.b.ne === 0 && R1.b.active === false, J(R1.b));
T('[1b] the reversal line says the veto goes with it', R1.b.revLog);
T('[1c] a seat nobody wrote from still over on the fixed core: the veto stays (same seats), nothing lifted; seat 0\'s conviction still reversed',
  R1.c.veto && J(R1.c.seats) === J([0, 1]) && R1.c.lifted === 0 && R1.c.reversed === 1 && R1.c.ne === 0, J(R1.c));
T('[1c] the reversal line says the veto stands', R1.c.revLog);
T('[1d] an error / no answer / a null cap: the veto stays, nothing lifted (still marked replayed)', J(R1.d) === J([true, true, true]), J(R1.d));
T('[1e] a private match: the gamble headroom counts (7000 under 5000 x 1.5 -> lifted, cap1 7500; 7000 over 4600 x 1.5 -> held)', R1.e.lifted && R1.e.cap1 === 7500 && R1.e.held, J(R1.e));
T('[1f] no veto left to lift: nothing recorded, nothing written', R1.f.lifted === 0 && R1.f.vetoKeys === 0, J(R1.f));
T('[1g] an item without scores: no lift', R1.g.veto && R1.g.lifted === 0, J(R1.g));

// ---- [2] end to end: the reconcile holds the vetoed match, the fixed core's replay lifts it, the reconcile settles it ----
const MIN = 60000, GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const POINTS = 7, XP = 5;
const ENF = { SEEDCAP_ENFORCE: '1' };
const boardsOf = (recs) => H.shardBoards(recs, [{ id: XP, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
function match(hash, ros, sc0) {
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc0) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat + 1, seat === 0, ros, sc0) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_2' };
}
const groupOf = (mm) => ({ [mm.key]: mm.R.map((x) => ({ d: x.d.slice(), roster: v.decodeRoster(x.d), w: x.sid })) });
function timeline(steps, files0) {
  const rs = []; let state = null;
  for (const [ms, recs, mut] of steps) {
    let files = state ? H.advance(state, ms) : JSON.parse(J(files0 || {}));
    if (mut) files = mut(files);
    const r = H.runCron(boardsOf(recs), files, ENF, null, 'seedcap-replay-lift');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
const processed = (r, key) => new Set(r.state.PROCESSED_FILE || []).has(key);
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const vetoLines = (r, key) => r.out.split('\n').filter((l) => l.indexOf('match=' + key + ':') >= 0 && /seedcap over-cap veto/.test(l)).length;
// seedcap's side over real records: audit on an observed core1 (cap 5500), then replay on core2 with the given cap
function seedcapSide(S, mm, cap2) {
  const groups = groupOf(mm);
  const st = st0();
  const picked = S.pickAuditable(st, groups);
  quiet(() => S.applyAudit(st, picked, { m0: { cap: 5500 } }, new Set(), 1000, { primary: C1, obsOf: () => true }));
  const vetoed = JSON.parse(J(st));
  const rc = S.replayCandidates(st, groups, C2, 1100);
  const items = rc.ms.map((m) => S.pendingOfGroup(st, m, groups[m])).filter((x) => x && !x.skip);
  const rp = quiet(() => S.applyReplay(st, items, { m0: { cap: cap2 } }, C2, 1100));
  return { picked: picked.length, vetoed, cand: rc.ms, items: items.length, rp, replayed: JSON.parse(J(st)) };
}
function endToEnd(S, hash, cap2) {
  const P2 = H.SID(2661 + (hash & 0xff) * 2), Q2 = H.SID(2662 + (hash & 0xff) * 2);
  const mm = match(hash, [P2, Q2], [6000, 5000]);
  const side = seedcapSide(S, mm, cap2);
  const held = timeline([[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [6 * MIN, mm.all]], { SC_STATE_FILE: side.vetoed });
  const useReplayed = (files) => { files.SC_STATE_FILE = JSON.parse(J(side.replayed)); return files; };
  const after = held.okAll ? timeline([[10 * MIN, mm.all, useReplayed], [6 * MIN, mm.all]], H.advance(held.last.state, 0)) : null;
  return { P2, Q2, mm, side, held, after };
}
const E = endToEnd(sc, 0x26501, 9000);
{
  const { side, held, after, mm, P2, Q2 } = E;
  T('[2] seedcap over the real records: audited once, vetoed on the observed core, nobody convicted; a replay candidate on core2',
    side.picked === 1 && !!side.vetoed.veto[mm.key] && Object.keys(side.vetoed.suspects).length === 0 && J(side.cand) === J([mm.key]) && side.items === 1, J({ picked: side.picked, cand: side.cand, items: side.items }));
  T('[2] the fixed core\'s replay lifts the veto', !side.replayed.veto[mm.key] && (side.rp.lifted || []).length === 1, J(side.rp));
  T('[2] every reconcile run exits 0', held.okAll && !!after && after.okAll, (held.last || {}).out && held.last.out.slice(-600));
  T('[2] while vetoed: warned, not settled, not processed, no points or XP written', vetoLines(held.last, mm.key) >= 1 && !processed(held.last, mm.key)
    && held.rs.every((r) => H.setPosts(r, POINTS).length === 0 && H.setPosts(r, XP).length === 0), (held.out.match(/[^\n]*seedcap[^\n]*/g) || []).join(' | '));
  if (after && after.okAll) {
    const w = (sid) => [].concat(...after.rs.map((r) => H.postsOf(r, POINTS, sid)));
    T('[2] after the replay: the match settles once (processed, one points write each, no veto line)', processed(after.last, mm.key) && w(P2).length === 1 && w(Q2).length === 1
      && after.rs.every((r) => vetoLines(r, mm.key) === 0), J({ P: w(P2), Q: w(Q2) }) + ' ' + after.out.slice(-500));
    T('[2] nobody flagged at any point', fOf(after.last, P2) === 0 && fOf(after.last, Q2) === 0 && fOf(held.last, P2) === 0 && fOf(held.last, Q2) === 0);
  }
}
const E2 = endToEnd(sc, 0x26502, 5800);   // the fixed core still caps seat 0 (6000) out
T('[2] a fixed core that still finds a seat over: the veto stays, the reconcile keeps holding the match',
  E2.held.okAll && !!E2.after && E2.after.okAll && !!E2.side.replayed.veto[E2.mm.key] && (E2.side.rp.lifted || []).length === 0 && !processed(E2.after.last, E2.mm.key)
  && E2.after.rs.every((r) => H.setPosts(r, POINTS).length === 0), J({ lifted: E2.side.rp.lifted, processed: E2.after && processed(E2.after.last, E2.mm.key) }));

// ---- [3] main() wiring ----
{
  T('[3] main: the replay result starts with an empty lifted list', /let rp = \{ replayed: 0, reversed: \[\], still: 0, lifted: \[\] \};/.test(SCSRC));
  T('[3] main: the replay summary line counts the lifted vetoes', /' still over, ' \+ \(rp\.lifted \? rp\.lifted\.length : 0\) \+ ' veto\(es\) lifted'/.test(SCSRC));
  T('[3] main: applyReplay still runs on the primary over auditPending\'s answers', /rp = applyReplay\(st, ra\.pending, ra\.map, primaryHash, nowMin\(\)\);/.test(SCSRC));
}

// ---- [4] mutation self-checks ----
{
  const LIFT_FROM = '      delete st.veto[x.m];\n';
  const ALL_FROM = 'const allUnder = scores.length > 0 && scores.every(sc0 => (sc0 | 0) <= capEff);';
  const mNoLift = scMutant([[LIFT_FROM, '']]);
  const a = mNoLift ? replayCases(mNoLift) : null;
  T('[4] mutant (the veto never deleted, the pre-W265 code): [1a] / [1b] turn red', !!a && a.a.veto && a.b.veto, a ? J({ a: a.a.veto, b: a.b.veto }) : 'mutant did not apply');
  const e = mNoLift ? endToEnd(mNoLift, 0x26503, 9000) : null;
  T('[4] ... and [2]: the reconcile keeps holding the match after the replay', !!e && e.after && e.after.okAll && !processed(e.after.last, e.mm.key) && !!e.side.replayed.veto[e.mm.key],
    e ? J({ processed: e.after && processed(e.after.last, e.mm.key) }) : 'mutant did not apply');
  const mAny = scMutant([[ALL_FROM, 'const allUnder = true;']]);
  const b = mAny ? replayCases(mAny) : null;
  T('[4] mutant (lift whatever the other seats score): [1c] turns red', !!b && !b.c.veto, b ? J(b.c) : 'mutant did not apply');
  const mSelf = scMutant([[ALL_FROM, 'const allUnder = scores.length > 0 && (x.self || []).map(s2 => scores[s2]).every(sc0 => (sc0 | 0) <= capEff);']]);
  const c = mSelf ? replayCases(mSelf) : null;
  T('[4] mutant (only the self-written seats checked): [1c] turns red (an unattributed seat over the cap no longer holds the match)', !!c && !c.c.veto, c ? J(c.c) : 'mutant did not apply');
  const mMult = scMutant([['const capEff = Math.round(r.cap * ((x.p && x.p.capMult) || 1));\n    const scores', 'const capEff = Math.round(r.cap);\n    const scores']]);
  const d = mMult ? replayCases(mMult) : null;
  T('[4] mutant (capMult ignored on replay): [1e] turns red', !!d && !d.e.lifted, d ? J(d.e) : 'mutant did not apply');
  const mEmpty = scMutant([[ALL_FROM, 'const allUnder = scores.every(sc0 => (sc0 | 0) <= capEff);']]);
  const g = mEmpty ? replayCases(mEmpty) : null;
  T('[4] mutant (the empty-scores guard out): [1g] turns red', !!g && !g.g.veto, g ? J(g.g) : 'mutant did not apply');
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (err) {}
console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== seedcap-replay-lift: ALL PASS ===');
process.exit(failN ? 1 : 0);
