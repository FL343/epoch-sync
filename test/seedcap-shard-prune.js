'use strict';
// O784 (2026-11-09, EA gap audit 2 X-01): the audit memory follows the shards, and only a core's first audits count.
// Before: pruneState cut st.audited to the 4000 newest audits by time. The shards never shed a row, so once more than 4000
//   groups sat on them every run read the cut ones again as new (demo: 4000+ re-audits every 10 minutes, the 4000 kept
//   audits all from one minute). Every re-audit counted as an honest audit of the run's primary core, so a new core left its
//   O285 (1) observation window (72 h or 200 honest audits) in its first run, and re-judged every unsigned old match on the
//   shards: the audit's simulation of a core with a 30% cap slip convicted 1,127 accounts within 20 minutes, mostly for old,
//   long settled matches (the same core over 3000 groups: 16 h of observation, nobody convicted for an old match).
// Now:
//   (1) pruneState forgets an audit only when a COMPLETE shard read no longer holds its group; an old honest audit folds
//       into a salted st.seen token; the bound is a byte fuse on the tokens (narrower tokens first, then the oldest go)
//   (2) a run after memory was lost (the old cut state, a salt change, a fuse drop) takes every pick as a re-audit: judged as
//       ever, not counted in the core's honest audits / hourly over-cap rate
// Sections (all through the real seedcap.js: pickAuditable / applyAudit / observationOf / coreAlerts / pruneState):
//   [1] 2 x the old bound on the shards, 3 runs with no new group: runs 2 and 3 audit nothing (and after the fold)
//   [2] a new core with a cap slip: still under observation after its first run; nobody convicted for an old match
//   [3] the old cut state (demo today) read once: the forgotten groups are re-audits, counted nowhere; a new core switched in
//       on that very run stays under observation
//   [4] presence: an incomplete read forgets nothing; a complete one forgets the gone; the veto keeps its audit
//   [5] tokens / salt / the byte fuse (a module copy with a 4 KB fuse)
//   [6] mutation self-checks (in process, no file written): (1) reverted -> [1] and [2] red; (2) reverted -> [3] red
// State isolation is structural (test/lib/settle-stub.js: every *_FILE var redirected, cwd = a temp dir).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
delete process.env.SC_SEEN_MAX_BYTES; delete process.env.SC_FOLD_MIN; delete process.env.SC_AUDITED_KEEP; delete process.env.SC_OBS_H; delete process.env.SC_OBS_N;
process.env.STATE_SALT = 's';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.SC_STATE_FILE = path.join(os.tmpdir(), 'seedcap-shard-prune-' + process.pid + '.json');
const v = require(H.VALIDATE);
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };

const SCSRC = fs.readFileSync(path.join(H.ROOT, 'seedcap.js'), 'utf8');
// compiled as if it sat next to seedcap.js (no file written): its './' requires resolve as the real one's do; env = extra
//   variables in force while its top level runs (its constants read them there)
let mutN = 0;
function scCopy(pairs, env) {
  let src = SCSRC;
  for (const [from, to] of pairs) { if (src.split(from).length !== 2) return null; src = src.replace(from, to); }
  const file = path.join(H.ROOT, '__mut_seedcap_o784_' + process.pid + '_' + (mutN++) + '.js');
  const saved = {};
  for (const k of Object.keys(env || {})) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const m = new module.constructor(file, module);
    m.filename = file;
    m.paths = module.constructor._nodeModulePaths(H.ROOT);
    m._compile(src, file);
    return m.exports;
  } finally { for (const k of Object.keys(saved)) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } }
}
// (1) reverted: the old count bound (4000 newest audits without a live veto), nothing folded, presence ignored
const PRUNE_FROM = 'const pa = pruneAudits(st, tNow, shards);';
const PRUNE_TO = 'const audKeys = Object.keys(st.audited).filter((k) => !st.veto[k]); if (audKeys.length > LEGACY_AUDITED_KEEP) { audKeys.sort((a, b) => (st.audited[a].t | 0) - (st.audited[b].t | 0)); for (const k of audKeys.slice(0, audKeys.length - LEGACY_AUDITED_KEEP)) delete st.audited[k]; } const pa = { gone: 0, folded: 0, goneTok: 0, w: SEEN_W, n: 0, narrowed: 0, dropped: 0 };';
// (2) reverted: a re-audit counts toward its core like a first audit
const RE_FROM = 'if (x.re) st.audited[x.m].re = 1;\n    else coreStat(st, k, t, overSeats.length > 0);';
const RE_TO = 'coreStat(st, k, t, overSeats.length > 0);';

// ---- the world: matchmade 2-seat groups, each written by its seat 0 (a self-written seat, so a verdict can convict) ----
function sidInts(sid) { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }
function groupRec(i) {
  const a = H.SID(100000 + 2 * i), b = H.SID(100001 + 2 * i);
  const d = [0xB1, 3, 1, 700000 + i, 4242, 0, 1, 0, 2, 300, 500, 100, 0].concat(sidInts(a), sidInts(b));
  return { m: d[3] + '_' + d[4] + '_' + d[2], g: [{ d, roster: v.decodeRoster(d), w: a }] };
}
const recMemo = [];
function shardsOf(lo, hi) { const g = {}; for (let i = lo; i < hi; i++) { const r = recMemo[i] || (recMemo[i] = groupRec(i)); g[r.m] = r.g; } return g; }
const OLD = 2 * sc.LEGACY_AUDITED_KEEP;   // groups on the shards: twice the old bound (demo today holds more than that)
const slipOf = (m) => crypto.createHash('md5').update(m).digest().readUInt32LE(0) / 4294967296 < 0.3;   // the bad core misses 30%
const HONEST = () => 1000, SLIP = (m) => (slipOf(m) ? 400 : 1000);   // seat 0 scores 500: over a 400 cap
const st0 = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });
// one seedcap run as main() runs it (no CLI: capOf answers per group), the state pruned against this run's shard read
function run(S, st, groups, t, primary, capOf, complete) {
  const loss = S.auditLossOf(st);
  const picked = S.takeSkips(st, S.pickAuditable(st, groups, { re: !!loss }), t).pending;
  const map = {};
  picked.forEach((x, i) => { map['m' + i] = { cap: capOf(x.m) }; });
  const obsOf = S.observationOf(st, null, 'demo', t);
  const obsBefore = obsOf(primary);
  const r = quiet(() => S.applyAudit(st, picked, map, new Set(Object.keys(groups)), t, { primary, obsOf }));
  const alerts = S.coreAlerts(st, t).map((a) => a.k);
  const pa = S.pruneState(st, new Set(), t, { keys: groups, complete: complete !== false });
  return { audited: picked.length, re: picked.filter((x) => x.re).length, over: r.over, obsBefore, obsAfter: S.observationOf(st, null, 'demo', t + 10)(primary),
    convicted: Object.keys(st.suspects).length, alerts, loss, pa };
}
const nOf = (st, k) => (st.cores && st.cores[k]) ? st.cores[k].n | 0 : 0;
const T0 = 29900000;   // minutes

console.log('=== O784: the audit memory follows the shards; only first audits count ===');

// ---- [1] no new group, three runs: nothing read again ----
function noNewGroup(S) {
  const st = st0(), groups = shardsOf(0, OLD);
  const r = [];
  for (let i = 0; i < 3; i++) r.push(run(S, st, groups, T0 + 10 * i, 'coreA', HONEST));
  // a day on (past the fold): the audits now live as tokens -- still nothing read again
  const late = run(S, st, groups, T0 + sc.FOLD_MIN + 60, 'coreA', HONEST);
  return { a: r.map((x) => x.audited), late: late.audited, folded: late.pa.folded, full: Object.keys(st.audited).length, tokens: late.pa.n, nA: nOf(st, 'coreA') };
}
const NN = noNewGroup(sc);
T('[1] ' + OLD + ' groups on the shards (2 x the old bound), no new group: run 1 audits them all, runs 2 and 3 audit nothing',
  J(NN.a) === J([OLD, 0, 0]), J(NN.a));
T('[1] a day later every audit folded into a token, still nothing read again; the core counted each group once',
  NN.late === 0 && NN.folded === OLD && NN.full === 0 && NN.tokens === OLD && NN.nA === OLD, J(NN));

// ---- [2] a new core with a cap slip: the observation window holds ----
function coreSwitch(S) {
  const st = st0();
  let hi = OLD, t = T0;
  for (let i = 0; i < 2; i++, t += 10) run(S, st, shardsOf(0, hi), t, 'coreA', HONEST);   // the old core settles the old groups
  const b = [];
  for (let i = 0; i < 6; i++, t += 10) { hi += 3; b.push(run(S, st, shardsOf(0, hi), t, 'coreB', SLIP)); }   // 3 new groups a run
  return { b, nB: nOf(st, 'coreB'), convicted: Object.keys(st.suspects).length, vetoOld: Object.keys(st.veto).filter((m) => +m.split('_')[0] < 700000 + OLD).length };
}
const CS = coreSwitch(sc);
T('[2] the slipping core reads only the new groups (3 a run), never the ' + OLD + ' old ones', CS.b.every((x) => x.audited === 3) && CS.nB === 18 && CS.vetoOld === 0, J({ a: CS.b.map((x) => x.audited), nB: CS.nB, vetoOld: CS.vetoOld }));
T('[2] after its first run (and its sixth) the new core is still under observation; nobody convicted',
  CS.b[0].obsAfter === true && CS.b[5].obsAfter === true && CS.convicted === 0, J({ obs: CS.b.map((x) => x.obsAfter), convicted: CS.convicted }));
T('[2] its over-cap share is not diluted by old matches: the rate alert names it once new over-cap groups pile up',
  CS.b.some((x) => x.alerts.indexOf('coreB') >= 0), J(CS.b.map((x) => x.alerts)));

// ---- [3] the old cut state (demo today): read once as re-audits ----
function legacyCut(S, switchCore) {
  const st = st0(), groups = shardsOf(0, OLD + 1000);
  // the state as the old bound left it: the newest 4000 audits, all from one minute, no st.seen
  for (let i = OLD + 1000 - S.LEGACY_AUDITED_KEEP; i < OLD + 1000; i++) st.audited[recMemo[i].m] = { c: 1000, s: 500, o: 0, t: T0 - 10, k: 'coreA' };
  st.cores = { coreA: { t0: T0 - 5000, n: 100000, o: 0, h: {} } };
  const nA0 = nOf(st, 'coreA');
  const r1 = run(S, st, groups, T0, switchCore ? 'coreB' : 'coreA', switchCore ? SLIP : HONEST);
  const r2 = run(S, st, groups, T0 + 10, switchCore ? 'coreB' : 'coreA', switchCore ? SLIP : HONEST);
  return { r1, r2, dA: nOf(st, 'coreA') - nA0, nB: nOf(st, 'coreB'), hasSeen: !!st.seen, convicted: Object.keys(st.suspects).length };
}
const LC = legacyCut(sc, false);
T('[3] the cut state is told apart (no st.seen, ' + sc.LEGACY_AUDITED_KEEP + ' audits): its first run reads the forgotten groups once, every pick a re-audit',
  LC.r1.loss === 'legacy-cut' && LC.r1.audited === OLD + 1000 - sc.LEGACY_AUDITED_KEEP && LC.r1.re === LC.r1.audited && LC.hasSeen, J({ loss: LC.r1.loss, a: LC.r1.audited, re: LC.r1.re }));
T('[3] ... counted nowhere (the core\'s honest audits unchanged), and the next run reads nothing and is not a re-audit run',
  LC.dA === 0 && LC.r2.audited === 0 && LC.r2.loss === null, J({ dA: LC.dA, r2: LC.r2.audited, loss2: LC.r2.loss }));
const LS = legacyCut(sc, true);
T('[3] a new core with a cap slip switched in on that very run: still under observation after it, nobody convicted',
  LS.r1.obsAfter === true && LS.r2.obsAfter === true && LS.nB === 0 && LS.convicted === 0, J({ obs: [LS.r1.obsAfter, LS.r2.obsAfter], nB: LS.nB, convicted: LS.convicted }));

// ---- [4] presence ----
{
  const st = st0(), g = shardsOf(0, 10);
  run(sc, st, g, T0, 'coreA', HONEST);
  const g5 = shardsOf(0, 5);
  sc.pruneState(st, new Set(), T0 + 10, { keys: g5, complete: false });
  T('[4] an incomplete shard read forgets nothing', Object.keys(g).every((m) => sc.knownAudit(st, m)));
  sc.pruneState(st, new Set(), T0 + 20);
  T('[4] no shard read at all (presence unknown) forgets nothing', Object.keys(g).every((m) => sc.knownAudit(st, m)));
  const pa = sc.pruneState(st, new Set(), T0 + 30, { keys: new Set(Object.keys(g5)), complete: true });
  T('[4] a complete read (a Set works too) forgets exactly the gone groups', pa.gone === 5 && Object.keys(g5).every((m) => sc.knownAudit(st, m)) && Object.keys(shardsOf(5, 10)).every((m) => !sc.knownAudit(st, m)), J(pa));
  // gone tokens too: fold, then the group leaves
  const pf = sc.pruneState(st, new Set(), T0 + sc.FOLD_MIN + 40, { keys: g5, complete: true });
  const pg = sc.pruneState(st, new Set(), T0 + sc.FOLD_MIN + 50, { keys: shardsOf(0, 2), complete: true });
  T('[4] a folded group is forgotten as a token once it leaves', pf.folded === 5 && pg.goneTok === 3 && pg.n === 2 && sc.knownAudit(st, recMemo[1].m) && !sc.knownAudit(st, recMemo[2].m), J({ pf, pg }));
  const sv = st0();
  sv.audited.vm = { c: 1, s: 9, o: 1, t: T0, k: 'coreA' }; sv.veto.vm = { t: T0, seats: [0] };
  sc.pruneState(sv, new Set(), T0 + sc.REPLAY_DAYS * 1440 + 10, { keys: {}, complete: true });
  T('[4] a live veto keeps its full audit, gone or old', !!sv.audited.vm && sv.audited.vm.o === 1);
  const sr = st0();
  sr.audited.rm = { c: 1, s: 9, o: 1, t: T0, k: 'coreA' };
  sc.pruneState(sr, new Set(), T0 + sc.FOLD_MIN + 10, { keys: { rm: [] }, complete: true });
  const cand = sc.replayCandidates(sr, { rm: [1] }, 'coreB', T0 + sc.FOLD_MIN + 20).ms;
  sc.pruneState(sr, new Set(), T0 + sc.REPLAY_DAYS * 1440 + 10, { keys: { rm: [] }, complete: true });
  T('[4] an over-cap audit stays in full while it is an O198 replay candidate (then folds, still remembered)',
    J(cand) === J(['rm']) && !sr.audited.rm && sc.knownAudit(sr, 'rm'), J({ cand, full: !!sr.audited.rm }));
}

// ---- [5] tokens / salt / the byte fuse ----
{
  const tk = sc.seenToken('123_456_7');
  T('[5] a token is ' + sc.SEEN_W + ' url-safe chars; a narrower one is its prefix; salted (not a plain hash of the key)',
    /^[A-Za-z0-9_-]+$/.test(tk) && tk.length === sc.SEEN_W && sc.seenToken('123_456_7', 5) === tk.slice(0, 5) &&
    tk !== crypto.createHash('sha256').update('seedcap seen v1 123_456_7').digest('base64url').slice(0, sc.SEEN_W), tk);
  const st = st0();
  run(sc, st, shardsOf(0, 3), T0, 'coreA', HONEST);
  sc.pruneState(st, new Set(), T0 + sc.FOLD_MIN + 10, { keys: shardsOf(0, 3), complete: true });
  const other = scCopy([], { STATE_SALT: 'another salt' });
  T('[5] tokens written under another salt mean nothing: the run reads as one after memory was lost',
    sc.auditLossOf(st) === null && !!other && other.auditLossOf(st) === 'seen-salt' && !other.knownAudit(st, recMemo[0].m) && sc.knownAudit(st, recMemo[0].m));
  T('[5] the old cut state needs the old bound reached; a small or fresh state is not a lossy one',
    sc.auditLossOf(st0()) === null && sc.auditLossOf({ audited: { a: {} } }) === null);
  // a 4 KB fuse: 1000 tokens of 8 chars narrow to 5, then the oldest go
  const F = scCopy([], { SC_SEEN_MAX_BYTES: '4096' });
  const fs1 = st0(), all = shardsOf(0, 1000);
  for (const m of Object.keys(all)) fs1.audited[m] = { c: 1, s: 1, o: 0, t: T0 };
  const p1 = F.pruneState(fs1, new Set(), T0 + F.FOLD_MIN + 10, { keys: all, complete: true });
  const keepN = Math.floor(4096 / F.SEEN_W_MIN);
  const ms = Object.keys(all);
  T('[5] the fuse narrows the tokens down to ' + F.SEEN_W_MIN + ' chars, then drops the oldest (and says so for the next run)',
    p1.w === F.SEEN_W_MIN && p1.narrowed === F.SEEN_W - F.SEEN_W_MIN && p1.n === keepN && p1.dropped === 1000 - keepN && fs1.seen.h.length <= 4096 &&
    F.auditLossOf(fs1) === 'fuse-drop' && !F.knownAudit(fs1, ms[0]) && F.knownAudit(fs1, ms[999]), J(p1));
  const p2 = F.pruneState(fs1, new Set(), T0 + F.FOLD_MIN + 20, { keys: shardsOf(0, 0), complete: true });
  T('[5] ... a prune that drops nothing clears the mark', p2.dropped === 0 && F.auditLossOf(fs1) === null, J(p2));
  const big = sc.pruneState(st0(), new Set(), T0, { keys: {}, complete: true });
  T('[5] the default fuse holds a million groups at full width', sc.SEEN_MAX_BYTES >= 1000000 * sc.SEEN_W && big.w === sc.SEEN_W, J({ max: sc.SEEN_MAX_BYTES }));
}

// ---- [6] mutation self-checks ----
{
  const mP = scCopy([[PRUNE_FROM, PRUNE_TO]]);
  const nn = mP ? noNewGroup(mP) : null;
  T('[6] (1) reverted (the old count bound): runs 2 and 3 read ' + (OLD - sc.LEGACY_AUDITED_KEEP) + ' old groups again -> caught by [1]',
    !!nn && nn.a[1] === OLD - sc.LEGACY_AUDITED_KEEP && nn.a[2] === OLD - sc.LEGACY_AUDITED_KEEP, nn ? J(nn.a) : 'mutant did not apply');
  const cs = mP ? coreSwitch(mP) : null;
  T('[6] (1) reverted: the slipping core reads old groups again and vetoes old matches -> caught by [2]',
    !!cs && cs.b[0].audited > 3 && cs.vetoOld > 0, cs ? J({ a0: cs.b[0].audited, vetoOld: cs.vetoOld }) : 'mutant did not apply');
  // (2) is the backstop there: the cut state reads as lossy on every run, so the re-reads count nowhere and the window holds
  T('[6] ... (2) alone still holds the window (every run of the cut state reads as one after memory was lost)',
    !!cs && cs.b[0].obsAfter === true && cs.convicted === 0, cs ? J({ obs0: cs.b[0].obsAfter, convicted: cs.convicted }) : '');
  const mPR = scCopy([[PRUNE_FROM, PRUNE_TO], [RE_FROM, RE_TO]]);
  const cs2 = mPR ? coreSwitch(mPR) : null;
  T('[6] (1) and (2) reverted (the code before O784): the slipping core leaves observation after its first run and convicts for old matches -> caught by [2]',
    !!cs2 && cs2.b[0].obsAfter === false && cs2.vetoOld > 0 && cs2.convicted > 0, cs2 ? J({ obs0: cs2.b[0].obsAfter, vetoOld: cs2.vetoOld, convicted: cs2.convicted }) : 'mutant did not apply');
  const nn2 = mPR ? noNewGroup(mPR) : null;
  T('[6] ... and [1] is red there too', !!nn2 && nn2.a[1] > 0 && nn2.a[2] > 0, nn2 ? J(nn2.a) : '');
  const mR = scCopy([[RE_FROM, RE_TO]]);
  const lc = mR ? legacyCut(mR, false) : null;
  const ls = mR ? legacyCut(mR, true) : null;
  T('[6] (2) reverted (re-audits counted): the migration run fills the core\'s count -> caught by [3]',
    !!lc && lc.dA === OLD + 1000 - sc.LEGACY_AUDITED_KEEP, lc ? J({ dA: lc.dA }) : 'mutant did not apply');
  T('[6] (2) reverted: the slipping core switched in on that run leaves observation at once -> caught by [3]',
    !!ls && ls.r1.obsAfter === false, ls ? J({ obs: [ls.r1.obsAfter, ls.r2.obsAfter], nB: ls.nB }) : 'mutant did not apply');
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (err) {}
console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== seedcap-shard-prune: ALL PASS ===');
process.exit(failN ? 1 : 0);
