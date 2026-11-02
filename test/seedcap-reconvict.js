'use strict';
// Cloud audit Q367 (2026-11-02, split out of the Q250 draft): one over-cap match, one conviction.
// Before: pruneState trimmed st.audited to AUDITED_KEEP by age, vetoed keys included. The demo channel audits more than
//   4000 keys per two runs, so a vetoed key's audit went within ~20 minutes and pickAuditable read the group again:
//   applyAudit wrote a fresh veto clock (the 30-day hold never ran out -- the match's honest seats never settled) and, for
//   a self-written over seat, convicted the same match again (n++, a new cv entry, the reject window re-opened and longer,
//   the offense board count +1). Already-settled over-cap matches the same. A fixed core's O198 replay then reversed the
//   match once, so an honest account kept the extra convictions and their window.
// Now:
//   - the count bound skips audits of keys with a live veto (they stay while the veto does; VETO_KEEP_MIN still ends it)
//   - applyAudit `again`: a self-written over seat whose account already stands convicted for this match is vetoed, not
//     convicted again (a reversed conviction -- fpm -- is not standing)
// Sections:
//   [1] applyAudit `again`  [2] pruneState  [3] the churn the demo state showed (real records through pickAuditable /
//   pendingOfGroup)  [4] a fixed core's replay takes the whole conviction back  [5] mutation self-checks (in process)
// State isolation is structural (test/lib/settle-stub.js: every *_FILE var redirected, cwd = a temp dir).
const fs = require('fs'), path = require('path'), os = require('os');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.SC_STATE_FILE = path.join(os.tmpdir(), 'seedcap-reconvict-' + process.pid + '.json');
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
function scMutant(pairs) {
  let src = SCSRC;
  for (const [from, to] of pairs) { if (src.split(from).length !== 2) return null; src = src.replace(from, to); }
  const file = path.join(H.ROOT, '__mut_seedcap_q367_' + process.pid + '_' + pairs.length + '.js');
  const m = new module.constructor(file, module);
  m.filename = file;
  m.paths = module.constructor._nodeModulePaths(H.ROOT);
  m._compile(src, file);
  return m.exports;
}
const PRUNE_FROM = 'const audKeys = Object.keys(st.audited).filter((k) => !st.veto[k]);';
const PRUNE_TO = 'const audKeys = Object.keys(st.audited);';
const AGAIN_FROM = 'const blamed = obs ? [] : selfOver.filter(s2 => again.indexOf(s2) < 0);';
const AGAIN_TO = 'const blamed = obs ? [] : selfOver;';

const P = H.SID(3671), Q = H.SID(3672);
const st0 = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });
// a pending item the way pendingOfGroup builds one (seat 0 -> P, seat 1 -> Q)
const item = (m, scores, self, extra) => Object.assign({ m, mt: 2, pc: scores.length, scores, self, runSeed: 1234, p: { capMult: 1 },
  roster: Object.fromEntries(scores.map((_, i) => [i, [P, Q][i]])) }, extra || {});
const convicted = (m) => ({ n: 1, t0: 0, t1: 0, t1e: 0, ms: [m], cv: [[m, 0]] });
const PRI = 'pricore00001';
const su = (st, sid) => st.suspects[v.pid(sid)];

console.log('=== Q367: one over-cap match, one conviction ===');

// ---- [1] applyAudit `again` ----
function againChecks(S) {
  const out = {};
  const st = st0(); st.suspects[v.pid(P)] = convicted('x');
  logs.length = 0;
  const r = quiet(() => S.applyAudit(st, [item('x', [6000, 100], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI }));
  out.standing = { veto: !!st.veto.x, n: su(st, P).n, cv: su(st, P).cv.length, off: r.flags[0] ? r.flags[0].offenders.length : -1,
    unatt: r.flags[0] ? r.flags[0].unattributed.length : -1, log: logs.some((l) => /m=x seat\(s\) 0 already convicted for this match/.test(l)) };
  const st2 = st0(); st2.suspects[v.pid(P)] = Object.assign(convicted('x'), { fp: 1, fpm: ['x'] });
  quiet(() => S.applyAudit(st2, [item('x', [6000, 100], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI }));
  out.reversed = su(st2, P).n;
  const st3 = st0(); st3.suspects[v.pid(P)] = convicted('other');
  quiet(() => S.applyAudit(st3, [item('x', [6000, 100], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI }));
  out.otherMatch = su(st3, P).n;
  const st4 = st0();
  quiet(() => S.applyAudit(st4, [item('x', [6000, 7000], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI }));
  quiet(() => S.applyAudit(st4, [item('x', [6000, 7000], [0, 1])], { m0: { cap: 5500 } }, new Set(), 70, { primary: PRI }));
  out.twoSeats = [su(st4, P).n, su(st4, Q).n];
  return out;
}
const A1 = againChecks(sc);
T('[1] a match the account already stands convicted for: vetoed again, not convicted again (n 1, one cv, no offender, not "unattributed", logged)',
  A1.standing.veto && A1.standing.n === 1 && A1.standing.cv === 1 && A1.standing.off === 0 && A1.standing.unatt === 0 && A1.standing.log, J(A1.standing));
T('[1] a reversed conviction for the match (fpm) is not standing: convicted again (n 2)', A1.reversed === 2, J(A1.reversed));
T('[1] a standing conviction for ANOTHER match does not shield this one: convicted (n 2)', A1.otherMatch === 2, J(A1.otherMatch));
T('[1] two self-written over seats audited twice: each account convicted once', J(A1.twoSeats) === J([1, 1]), J(A1.twoSeats));
{
  const st = st0();
  quiet(() => sc.applyAudit(st, [item('x', [6000, 100], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI, obsOf: () => true }));
  T('[1] an observed core still convicts nobody (unchanged)', !!st.veto.x && !su(st, P));
  const st2 = st0();
  quiet(() => sc.applyAudit(st2, [item('x', [6000, 100], [0, 1])], { m0: { cap: 5500 } }, new Set(), 50, { primary: PRI }));
  T('[1] a first verdict convicts as before (n 1, the veto written)', su(st2, P).n === 1 && J(st2.veto.x.seats) === J([0]));
}

// ---- [2] pruneState ----
{
  const st = st0();
  st.veto.vv = { t: 150, seats: [0] }; st.audited.vv = { t: -1 };
  for (let i = 0; i < sc.AUDITED_KEEP + 20; i++) st.audited['a' + i] = { t: i };
  sc.pruneState(st, new Set(), 200);
  T('[2] the count bound takes AUDITED_KEEP of the others, never a vetoed key\'s audit (even the oldest)',
    !!st.audited.vv && Object.keys(st.audited).length === sc.AUDITED_KEEP + 1 && !st.audited.a19 && !!st.audited.a20, Object.keys(st.audited).length);
  T('[2] the veto itself stays bounded by its age as before', !!st.veto.vv);
  const st2 = st0();
  st2.veto.old = { t: 0, seats: [0] }; st2.audited.old = { t: -1 };
  for (let i = 0; i < sc.AUDITED_KEEP + 5; i++) st2.audited['a' + i] = { t: i };
  sc.pruneState(st2, new Set(), sc.VETO_KEEP_MIN + 1);
  T('[2] a veto past VETO_KEEP_MIN still goes (same run keeps its audit: the bound ran first)', !st2.veto.old && !!st2.audited.old);
  sc.pruneState(st2, new Set(), sc.VETO_KEEP_MIN + 2);
  T('[2] ... and on the next run its audit joins the bound again (oldest goes)', !st2.audited.old && Object.keys(st2.audited).length === sc.AUDITED_KEEP);
}

// ---- [3] the churn the demo state showed (real records: pickAuditable / pendingOfGroup) ----
function matchRecs(hash, ros, scores) {
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat + 1, seat === 0, ros, scores) }));
  return { R, key: hash + '_1234_2' };
}
const groupOf = (mm) => ({ [mm.key]: mm.R.map((x) => ({ d: x.d.slice(), roster: v.decodeRoster(x.d), w: x.sid })) });
function churn(S, processedKey) {
  const mm = matchRecs(0x3670a, [P, Q], [6000, 5000]);
  const groups = groupOf(mm);
  const st = st0();
  const processed = new Set(processedKey ? [mm.key] : []);
  const first = S.pickAuditable(st, groups);
  quiet(() => S.applyAudit(st, first, { m0: { cap: 5500 } }, processed, 100, { primary: PRI }));
  const t1 = st.veto[mm.key] && st.veto[mm.key].t;
  let again = [];
  for (let round = 0; round < 3; round++) {   // three busy demo intervals: AUDITED_KEEP newer audits each time
    for (let i = 0; i < S.AUDITED_KEEP + 10; i++) st.audited['busy' + round + '_' + i] = { t: 200 + round * 10000 + i };
    S.pruneState(st, new Set(), 300 + round * 20);
    const a = S.pickAuditable(st, groups);
    again = again.concat(a);
    if (a.length) quiet(() => S.applyAudit(st, a, { m0: { cap: 5500 } }, processed, 400 + round * 20, { primary: PRI }));
  }
  const s = su(st, P);
  return { first: first.length, self: first[0] && first[0].self, again: again.length, n: s && s.n, cv: s && s.cv.length, t1, t2: st.veto[mm.key] && st.veto[mm.key].t, st, key: mm.key };
}
const CH = churn(sc);
T('[3] the first audit: self seats [0,1], seat 0 over -> veto, P convicted once', CH.first === 1 && J(CH.self) === J([0, 1]) && CH.n === 1, J({ first: CH.first, self: CH.self, n: CH.n }));
T('[3] three busy intervals later: the vetoed key is not read again (n stays 1, one cv, the veto clock stays)',
  CH.again === 0 && CH.n === 1 && CH.cv === 1 && CH.t2 === CH.t1, J({ again: CH.again, n: CH.n, t1: CH.t1, t2: CH.t2 }));
const CHP = churn(sc, true);
T('[3] the same for an already-settled over-cap match (settled first, audited after)', CHP.again === 0 && CHP.n === 1 && CHP.t2 === CHP.t1, J({ again: CHP.again, n: CHP.n }));

// ---- [4] a fixed core's O198 replay takes the whole conviction back ----
function replayAfterReread(S) {
  const st = st0();
  const x = item('mq', [6000, 100], [0, 1]);
  quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: 'core1' }));
  delete st.audited.mq;   // read again anyway (an audit lost some other way): the guard still holds
  quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1020, { primary: 'core1' }));
  const s = su(st, P);
  const nBefore = s.n;
  st.audited.mq = { c: 5500, o: 1, k: 'core1', t: 1020 };
  quiet(() => S.applyReplay(st, [x], { m0: { cap: 9000 } }, 'core2', 1100));
  return { nBefore, nEff: v.seedcapNEff(s), active: v.seedcapRejectActive(s, 1200) };
}
const RP = replayAfterReread(sc);
T('[4] re-read anyway: still one conviction; the fixed core\'s replay reverses it -> effective n 0, no reject window',
  RP.nBefore === 1 && RP.nEff === 0 && RP.active === false, J(RP));

// ---- [5] mutation self-checks ----
{
  // (a) the `again` guard out: [1] turns red
  const mA = scMutant([[AGAIN_FROM, AGAIN_TO]]);
  const a = mA ? againChecks(mA) : null;
  T('[5] mutant (no `again` guard): the standing match convicts again -> caught by [1]', !!a && a.standing.n === 2, a ? J(a.standing) : 'mutant did not apply');
  const rpA = mA ? replayAfterReread(mA) : null;
  T('[5] ... and the replay leaves a conviction and its window (the review probe\'s result) -> caught by [4]', !!rpA && rpA.nEff === 1 && rpA.active === true, J(rpA));
  // (b) the count bound takes vetoed keys' audits again: [3] turns red (the group read again, the veto clock refreshed)
  const mB = scMutant([[PRUNE_FROM, PRUNE_TO]]);
  const chB = mB ? churn(mB) : null;
  T('[5] mutant (the count bound takes a vetoed key\'s audit): read again, the veto clock refreshed -> caught by [3]',
    !!chB && chB.again === 3 && chB.t2 !== chB.t1, chB ? J({ again: chB.again, t1: chB.t1, t2: chB.t2 }) : 'mutant did not apply');
  T('[5] (b) keeps one conviction through the `again` guard', !!chB && chB.n === 1 && chB.cv === 1, chB ? J({ n: chB.n }) : '');
  // (c) both out = today's main: the same match convicted on every re-read (the demo churn)
  const mBC = scMutant([[PRUNE_FROM, PRUNE_TO], [AGAIN_FROM, AGAIN_TO]]);
  const chBC = mBC ? churn(mBC) : null;
  T('[5] mutant (both out = before the fix): the same match convicted four times in four reads', !!chBC && chBC.n === 4 && chBC.cv === 4, chBC ? J({ n: chBC.n }) : 'mutant did not apply');
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (err) {}
console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== seedcap-reconvict: ALL PASS ===');
process.exit(failN ? 1 : 0);
