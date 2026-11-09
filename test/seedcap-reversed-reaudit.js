'use strict';
// Cloud audit Q374 (2026-11-03, the B143 final review's residual 5): a conviction the O198 replay reversed is not convicted again.
// Before: a match whose conviction the replay reversed (the seat's account keeps it in fpm) had its veto age out
//   (VETO_KEEP_MIN), the count bound then took its audit (AUDITED_KEEP; the demo channel fills it every run -- O784 replaced
//   the bound: now the audit goes only when the group's records leave the shards, so this path needs them to come back) and
//   pickAuditable read the group again. A core that is not the run's primary -- in practice the core of the package that
//   signed a solo record -- still read the score over its cap: applyAudit's `again` (Q367) asked convictedFor, which is
//   false for a reversed match, so the seat was convicted afresh (n + 1, the reject window re-opened from that minute, the
//   offense board + 1, a sev 3 trust event) and, for an already-settled endless match, a correction took its board row.
//   The next replay skipped it (convictedFor false again): the new conviction could not be taken back.
// Now:
//   - applyAudit `cleared`: a self-written over seat whose conviction for this match was reversed, read over on a core that
//     is not this run's primary, is vetoed and not convicted again, and the correction leaves its seat out
//   - the primary itself reading a reversed match over still convicts (a reversal is no lasting pass -- the Q367 review's
//     mutation M2 pinned this), and the match leaves fpm, so a later replay on a fixed core can reverse it again
// Sections:
//   [1] the probe's path on the core of the signing package (exact)  [2] corrections  [3] the primary reading it over
//   [4] what does not clear  [5] mutation self-checks (in process, no file written)
// State isolation is structural (test/lib/settle-stub.js: every *_FILE var redirected, cwd = a temp dir).
const fs = require('fs'), path = require('path'), os = require('os');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.SC_STATE_FILE = path.join(os.tmpdir(), 'seedcap-reversed-reaudit-' + process.pid + '.json');
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
  const file = path.join(H.ROOT, '__mut_seedcap_q374_' + process.pid + '_' + pairs.length + '.js');
  const m = new module.constructor(file, module);
  m.filename = file;
  m.paths = module.constructor._nodeModulePaths(H.ROOT);
  m._compile(src, file);
  return m.exports;
}
const CLEAR_FROM = 'selfOver.filter(s2 => reversedFor(st, x.roster[s2], x.m));';
const CLEAR_TO = '[];';
const PRIMARY_FROM = 'const cleared = (obs || k === primary) ? [] :';
const PRIMARY_TO = 'const cleared = obs ? [] :';
const FPM_FROM = 'if (Array.isArray(su.fpm) && su.fpm.indexOf(x.m) >= 0) su.fpm = su.fpm.filter(mm => mm !== x.m);';
const FPM_TO = '';
const CORR_FROM = 'const corrSeats = overSeats.filter(s2 => cleared.indexOf(s2) < 0);';
const CORR_TO = 'const corrSeats = overSeats;';

const P = H.SID(3741), Q = H.SID(3742);
const st0 = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });
// a pending item the way pendingOfGroup builds one (seat 0 -> P, seat 1 -> Q)
const item = (m, scores, self, extra) => Object.assign({ m, mt: 2, pc: scores.length, scores, self, runSeed: 1234, p: { capMult: 1 },
  roster: Object.fromEntries(scores.map((_, i) => [i, [P, Q][i]])) }, extra || {});
const su = (st, sid) => st.suspects[v.pid(sid)];
const sev3 = (st, sid) => (st.events || []).filter((e) => e.src === 'sc' && e.p === v.pid(sid) && e.sev === 3 && !e.fp).length;
const H1 = 'core1hash001', H2 = 'core2hash002', H3 = 'core3hash003';   // the run primaries (head hashes)
const EXACT = { m0: { cap: 5500, via: 'exact:core1' } };   // the signing package's core (a live.json label) reads 6000 over 5500
const FIXED = { m0: { cap: 9000 } };                      // the fixed primary puts it under

// the probe's steps: (1) convicted on core1 (then the primary), (2) a fixed core2 replay reverses it, (3) the veto ages out and
//   the count bound takes the audit (real pruneState), (4) read again with core2 the primary and the record on its signing core
function reversedThenPruned(S, x, processed) {
  const st = st0();
  quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: H1 }));
  quiet(() => S.applyReplay(st, [x], FIXED, H2, 1100));
  const afterReplay = { n: su(st, P).n, fp: su(st, P).fp | 0, ne: v.seedcapNEff(su(st, P)) };
  // O784: the count bound is gone; an audit is forgotten once a complete shard read no longer holds the group (here its records
  //   leave the shards after the veto aged out, and come back for step (4))
  let t = 1000 + S.VETO_KEEP_MIN + 10;
  quiet(() => S.pruneState(st, new Set(), t, { keys: { [x.m]: [] }, complete: true }));
  t += 10;
  quiet(() => S.pruneState(st, new Set(), t, { keys: {}, complete: true }));
  const gone = !S.knownAudit(st, x.m) && !st.veto[x.m];
  return { st, t, afterReplay, gone, processed: processed || new Set() };
}

console.log('=== Q374: a conviction the replay reversed is not convicted again ===');

// ---- [1] the probe's path, read again on the core of the signing package ----
function exactPath(S) {
  const x = item('mq', [6000, 100], [0, 1]);
  const R = reversedThenPruned(S, x);
  const st = R.st;
  const ev0 = sev3(st, P), cv0 = su(st, P).cv.length;
  logs.length = 0;
  const r = quiet(() => S.applyAudit(st, [x], EXACT, R.processed, R.t + 10, { primary: H2 }));
  const s = su(st, P);
  const after = { n: s.n, fp: s.fp | 0, ne: v.seedcapNEff(s), cv: s.cv.length - cv0, ev: sev3(st, P) - ev0, veto: !!st.veto.mq, k: st.audited.mq && st.audited.mq.k,
    off: r.flags[0] ? r.flags[0].offenders.length : -1, unatt: r.flags[0] ? r.flags[0].unattributed.length : -1, active: v.seedcapRejectActive(s, R.t + 11),
    log: logs.some((l) => /m=mq seat\(s\) 0 over on core core1 \(not the primary\) for a match the replay reversed/.test(l)),
    q367log: logs.some((l) => /already convicted for this match/.test(l)) };
  // the next runs' replays on core2, as main() runs them (replayCandidates first): the signed record answers on core1 again
  //   through auditPending (exact) and is marked replayed on core2 -- a second run finds no candidate
  const cand1 = S.replayCandidates(st, { mq: [1] }, H2, R.t + 20).ms.indexOf('mq') >= 0;
  if (cand1) quiet(() => S.applyReplay(st, [x], EXACT, H2, R.t + 20));
  const cand2 = S.replayCandidates(st, { mq: [1] }, H2, R.t + 30).ms.indexOf('mq') >= 0;
  if (cand2) quiet(() => S.applyReplay(st, [x], FIXED, H2, R.t + 30));
  const end = { cand1, cand2, n: s.n, fp: s.fp | 0, ne: v.seedcapNEff(s), active: v.seedcapRejectActive(s, R.t + 31) };
  return { R, after, end };
}
const E = exactPath(sc);
T('[1] steps 1-3 as the probe: reversed (n 1, fp 1, effective 0), then the veto and the audit both gone',
  J(E.R.afterReplay) === J({ n: 1, fp: 1, ne: 0 }) && E.R.gone, J({ afterReplay: E.R.afterReplay, gone: E.R.gone }));
T('[1] read again over on the signing core (not the primary): not convicted (n 1, effective 0, no cv, no sev 3 event, no offender, no reject window)',
  E.after.n === 1 && E.after.ne === 0 && E.after.cv === 0 && E.after.ev === 0 && E.after.off === 0 && E.after.active === false, J(E.after));
T('[1] ... the match is still vetoed and audited on that core, the seat is not "unattributed", logged as Q374 (not as Q367)',
  E.after.veto && E.after.k === 'core1' && E.after.unatt === 0 && E.after.log && !E.after.q367log, J(E.after));
T('[1] the next runs\' replays change nothing (one candidate run, then none; effective 0, no window)', E.end.cand1 && !E.end.cand2 && E.end.n === 1 && E.end.ne === 0 && E.end.active === false, J(E.end));

// ---- [2] corrections: a match settled in the gap ----
function corrPath(S, scores, self) {
  const x = item('mc', scores, self, { p: { capMult: 1, entry: 'endless' } });
  const R = reversedThenPruned(S, x);
  const st = R.st;
  const corr0 = st.corrections.length;
  quiet(() => S.applyAudit(st, [x], EXACT, new Set(['mc']), R.t + 10, { primary: H2 }));
  return { corr0, corr: st.corrections.slice(corr0), nP: su(st, P).n, nQ: su(st, Q) ? su(st, Q).n : 0, veto: st.veto.mc };
}
const C1 = corrPath(sc, [6000, 100], [0, 1]);
T('[2] a settled endless match whose only over seat is cleared: no correction (the seat keeps its board row), still vetoed',
  C1.corr0 === 0 && C1.corr.length === 0 && C1.nP === 1 && !!C1.veto && J(C1.veto.seats) === J([0]), J(C1));
const C2 = corrPath(sc, [6000, 7000], [0]);
T('[2] another over seat not cleared (not self-written): the correction takes that seat only',
  C2.corr.length === 1 && J(C2.corr[0].seats) === J([1]) && C2.nP === 1 && C2.nQ === 0 && J(C2.veto.seats) === J([0, 1]), J(C2));
{
  // a second self-written over seat whose account was never reversed (first read before the replay put it under: still over
  //   on core2 too, so the replay left it) -- convicted as before, corrected as before
  const st = st0();
  const x = item('md', [6000, 9500], [0, 1], { p: { capMult: 1, entry: 'endless' } });
  quiet(() => sc.applyAudit(st, [x], { m0: { cap: 5500 } }, new Set(), 1000, { primary: H1 }));
  quiet(() => sc.applyReplay(st, [x], FIXED, H2, 1100));
  const nQ0 = su(st, Q).n, neQ0 = v.seedcapNEff(su(st, Q));
  delete st.veto.md; delete st.audited.md;   // the veto aged out, the audit pruned (as [1])
  quiet(() => sc.applyAudit(st, [x], EXACT, new Set(['md']), 50000, { primary: H2 }));
  const corr = st.corrections.find((c) => c.m === 'md');
  T('[2] the other self seat (still over on the fixed core, never reversed) stands convicted -- not convicted twice (Q367) -- and is corrected; P is not',
    nQ0 === 1 && neQ0 === 1 && su(st, Q).n === 1 && su(st, P).n === 1 && v.seedcapNEff(su(st, P)) === 0 && !!corr && J(corr.seats) === J([1]),
    J({ nQ0, neQ0, nQ: su(st, Q).n, nP: su(st, P).n, corr }));
}

// ---- [3] the primary itself reads a reversed match over: convicted, and a later fixed core can reverse it again ----
function primaryPath(S) {
  const x = item('mp', [6000, 100], [0, 1]);
  const R = reversedThenPruned(S, x);
  const st = R.st, s = su(st, P);
  const ev0 = sev3(st, P);
  quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, R.processed, R.t + 10, { primary: H3 }));   // core3 the primary, over
  const conv = { n: s.n, fp: s.fp | 0, ne: v.seedcapNEff(s), fpm: (s.fpm || []).indexOf('mp') >= 0, ev: sev3(st, P) - ev0, active: v.seedcapRejectActive(s, R.t + 11) };
  // the same primary reads it again while it stands: the Q367 guard (no third conviction)
  delete st.audited.mp;
  quiet(() => S.applyAudit(st, [x], { m0: { cap: 5500 } }, R.processed, R.t + 20, { primary: H3 }));
  const third = s.n;
  // a fixed core reverses it again (the audit on core3 is a replay candidate for any other primary)
  const cand = S.replayCandidates(st, { mp: [1] }, H2, R.t + 30).ms.indexOf('mp') >= 0;
  quiet(() => S.applyReplay(st, [x], FIXED, H2, R.t + 30));
  const rev = { n: s.n, fp: s.fp | 0, ne: v.seedcapNEff(s), fpm: (s.fpm || []).indexOf('mp') >= 0, active: v.seedcapRejectActive(s, R.t + 31) };
  return { conv, third, cand, rev };
}
const PP = primaryPath(sc);
T('[3] the primary reading it over convicts (n 2, effective 1, a sev 3 event, the window open) -- a reversal is no lasting pass',
  PP.conv.n === 2 && PP.conv.ne === 1 && PP.conv.ev === 1 && PP.conv.active === true, J(PP.conv));
T('[3] ... the match leaves fpm (the conviction stands again)', PP.conv.fpm === false, J(PP.conv));
T('[3] the primary reading it once more: the Q367 guard, no third conviction (n 2)', PP.third === 2, J(PP.third));
T('[3] a fixed core\'s replay reverses it again: fp 2, effective 0, back in fpm, no window',
  PP.cand && PP.rev.n === 2 && PP.rev.fp === 2 && PP.rev.ne === 0 && PP.rev.fpm === true && PP.rev.active === false, J({ cand: PP.cand, rev: PP.rev }));

// ---- [4] what does not clear ----
{
  // a reversal of ANOTHER match does not clear this one
  const st = st0();
  st.suspects[v.pid(P)] = { n: 1, t0: 0, t1: 0, t1e: 0, ms: ['other'], cv: [['other', 0]], fp: 1, fpm: ['other'] };
  quiet(() => sc.applyAudit(st, [item('mx', [6000, 100], [0, 1])], EXACT, new Set(), 50, { primary: H2 }));
  T('[4] a reversal for another match does not clear this one: convicted on the signing core (n 2)', su(st, P).n === 2 && v.seedcapNEff(su(st, P)) === 1, J(su(st, P)));
  // a first verdict on the signing core convicts as before
  const st2 = st0();
  quiet(() => sc.applyAudit(st2, [item('my', [6000, 100], [0, 1])], EXACT, new Set(), 50, { primary: H2 }));
  T('[4] a first verdict on the signing core convicts as before (n 1)', su(st2, P).n === 1 && J(st2.veto.my.seats) === J([0]), J(su(st2, P)));
  // an overlap verdict files under the primary (coreOfVerdict): the primary's own reading -> convicted
  const x = item('mo', [6000, 100], [0, 1]);
  const R = reversedThenPruned(sc, x);
  quiet(() => sc.applyAudit(R.st, [x], { m0: { cap: 5500, via: 'overlap' } }, R.processed, R.t + 10, { primary: H2 }));
  T('[4] an overlap verdict (the primary and the overlap cores together) over: convicted (n 2)', su(R.st, P).n === 2, J(su(R.st, P)));
  // an observed core / a couch hold: nobody convicted (unchanged), the reversal stays
  const R2 = reversedThenPruned(sc, item('mb', [6000, 100], [0, 1]));
  quiet(() => sc.applyAudit(R2.st, [item('mb', [6000, 100], [0, 1])], EXACT, R2.processed, R2.t + 10, { primary: H2, obsOf: () => true }));
  T('[4] an observed core convicts nobody (unchanged), the reversal stays (fpm)', su(R2.st, P).n === 1 && (su(R2.st, P).fpm || []).indexOf('mb') >= 0 && !!R2.st.veto.mb);
  T('[4] reversedFor: only the account\'s own reversed match keys', sc.reversedFor(R2.st, P, 'mb') === true && sc.reversedFor(R2.st, P, 'zz') === false && sc.reversedFor(R2.st, Q, 'mb') === false);
}

// ---- [5] mutation self-checks ----
{
  const mA = scMutant([[CLEAR_FROM, CLEAR_TO]]);
  const a = mA ? exactPath(mA) : null;
  T('[5] mutant (nothing cleared = before the fix): convicted again, effective 1, window open, and the replays cannot take it back -> caught by [1]',
    !!a && a.after.n === 2 && a.after.ne === 1 && a.after.active === true && a.end.ne === 1 && a.end.active === true, a ? J({ after: a.after, end: a.end }) : 'mutant did not apply');
  const ca = mA ? corrPath(mA, [6000, 100], [0, 1]) : null;
  T('[5] ... and a settled endless match gets a correction on the honest seat -> caught by [2]', !!ca && ca.corr.length === 1 && J(ca.corr[0].seats) === J([0]), ca ? J(ca.corr) : '');
  const mB = scMutant([[PRIMARY_FROM, PRIMARY_TO]]);
  const b = mB ? primaryPath(mB) : null;
  T('[5] mutant (cleared on the primary too): a reversal becomes a lasting pass -- the primary over convicts nobody -> caught by [3]',
    !!b && b.conv.n === 1 && b.conv.ne === 0, b ? J(b.conv) : 'mutant did not apply');
  const mC = scMutant([[FPM_FROM, FPM_TO]]);
  const c = mC ? primaryPath(mC) : null;
  T('[5] mutant (a fresh conviction stays in fpm): the guard is blind to it and a later replay cannot reverse it -> caught by [3]',
    !!c && c.conv.fpm === true && (c.third === 3 || c.rev.ne >= 1), c ? J({ conv: c.conv, third: c.third, rev: c.rev }) : 'mutant did not apply');
  const mD = scMutant([[CORR_FROM, CORR_TO]]);
  const d = mD ? corrPath(mD, [6000, 100], [0, 1]) : null;
  T('[5] mutant (the correction takes every over seat): the cleared seat loses its board row -> caught by [2]', !!d && d.corr.length === 1 && J(d.corr[0].seats) === J([0]), d ? J(d.corr) : 'mutant did not apply');
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (err) {}
console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== seedcap-reversed-reaudit: ALL PASS ===');
process.exit(failN ? 1 : 0);
