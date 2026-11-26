'use strict';
// cloud audit Q450 (2026-11-26, mailbox M1075; the run of cloud audit Q418): tools/resettle-once.js reopens team competitive
//   endless segments the lane refused at the chain (`team comp segment chain REJECT (chain-gap)`: COMP.CHAIN_WAIT_MS out) behind
//   a held segment that Q418's pass moved the chain past only afterwards. Only add (architecture decision 10): nothing charged.
//   [1] the list q450: the 10 keys of one run (seed 1606489221), team lane, none in another list, not the run's two keys that
//       settled on 11-18
//   [2] codeReady q450: this tree (Q418's pass) ready, a tree without it not; the exemption hook is not needed (no continue
//       debit in the lane); the validate.js log lines the dry run reads are still printed in those forms (teamLineOf)
//   [3] plan on a synthetic state history: the run's three refused segments reopen, in start order; each check holds the whole
//       run for review -- a listed key that settled at its close (the chain moved), one closed inside the chain window, one
//       with no wait clock before its close, one with no start entry, two team chains of the players, the chain not moved since,
//       no Q418 pass on the run, save points on the run, a segment under the seed still open or refused outside the list, a
//       key listed before
//   [4] holdKeys on a team run: a held segment holds the ones that start no earlier, not the ones before (a tie holds both)
//   [5] apply / undo on the synthetic state: processed, the wait clocks out (kept in the list) and back, the start entries back,
//       resettle.json (lane team, how reopened), a second apply changes nothing
//   [6] end to end with the real validate.js (a git state history, a commit per reconcile run as the job's): the old rule (no
//       Q418 pass) live -> the segments behind the held one refused after the chain window; Q418 live -> the chain passes the
//       held one, the refused stay closed; plan -> dry run (each settles in B, nothing down, nothing closed in B only, the gate
//       takes it) -> apply -> live: each settles once, XP / ladder / CP / chain as with Q418 from the start; undo finds them taken
//   [7] mutants: each check above goes red when the code it pins is taken out
// Every temp file is under os.tmpdir(); nothing is written into the repo.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_COMP_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'COMP_CHAIN_WAIT_MS',
  'SOLO_DONE_CAP', 'COUCH_DUO', 'RESETTLE_FILE', 'APPID', 'LB_PREFIX', 'STATE_SALT', 'SUPPORTER_DLC_APPID', 'CLASSIC_APPID'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const A = require(path.join(ROOT, 'attest.js'));
const TOOL = path.join(ROOT, 'tools', 'resettle-once.js');
const R = require(TOOL);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'resettle-team-'));
const GITC = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
const git = (dir, args, env) => { const r = spawnSync('git', ['-C', dir].concat(GITC, args), { encoding: 'utf8', env: env ? Object.assign({}, process.env, env) : process.env }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout; };
const commitAt = (dir, ms, msg) => { const when = new Date(ms).toISOString(); git(dir, ['commit', '-q', '--allow-empty', '-m', msg || ('state ' + when)], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }); };
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const mutantTool = (tag, from, to) => {
  const src = fs.readFileSync(TOOL, 'utf8');
  if (src.split(from).length !== 2) { bad('[7] mutant anchor not found exactly once: ' + tag); return null; }
  const f = path.join(TMP, 'tool-' + tag + '.js'); fs.writeFileSync(f, src.replace(from, to));
  return require(f);
};

console.log('=== Q450 team competitive re-settlement (tools/resettle-once.js lane team) ===');

// ---- [1] the list ----
{
  const S = R.SETS.q450, keys = Object.keys((S && S.keys) || {});
  T('[1] q450 is a team list of 10 keys, all of seed 1606489221, match type 7, no depths', !!S && S.lane === 'team' && keys.length === 10 && keys.every((m) => /^-?[0-9]+_1606489221_7$/.test(m) && S.keys[m] === null), JSON.stringify(S && { lane: S.lane, n: keys.length }));
  const others = [].concat(...Object.keys(R.SETS).filter((s) => s !== 'q450').map((s) => Object.keys(R.SETS[s].keys)));
  T('[1] none of them in another list, none twice', keys.every((m) => others.indexOf(m) < 0) && new Set(keys).size === keys.length);
  T('[1] the run\'s two keys that settled on 11-18 (0 -> 5, 5 -> 10) are not listed', !('-690400341_1606489221_7' in S.keys) && !('-707177960_1606489221_7' in S.keys));
  T('[1] nor the held segment the chain was passed over (Q418: never settled, not this list\'s)', !('-656845103_1606489221_7' in S.keys));
}

// ---- [2] codeReady + the log forms the dry run reads ----
{
  const t = fs.mkdtempSync(path.join(TMP, 'cr-'));
  const V = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
  fs.writeFileSync(path.join(t, 'validate.js'), V);
  T('[2] codeReady: this tree has Q418\'s pass (q450 ready)', R.codeReady(t, 'q450').ok && R.codeReady(t, 'q450').fix);
  fs.writeFileSync(path.join(t, 'validate.js'), V.replace(/function loadResettleFree\(/g, 'function loadResettleFreeX(').replace(/resettleFree\.has\(c\.m\)/g, 'false'));
  T('[2] codeReady: q450 does not need the exemption hook (the lane has no continue debit)', R.codeReady(t, 'q450').ok && !R.codeReady(t, 'q450').hook && !R.codeReady(t, 'o920').ok);
  fs.writeFileSync(path.join(t, 'validate.js'), V.replace(/run\.so = \(Array\.isArray\(run\.so\) \? run\.so : \[\]\)\.concat\(\[m\]\)/g, 'run.sx = []'));
  T('[2] codeReady: without Q418\'s pass q450 is not ready', !R.codeReady(t, 'q450').ok);
  // the lines the dry run reads (tools/resettle-once.js outcome + teamLineOf): validate.js's own forms
  T('[2] validate.js prints the team settle line as `endless-comp settle <m>: pc `', V.indexOf("console.log('  endless-comp settle ' + c.m + ': pc ' + pc7") >= 0);
  T('[2] validate.js prints the resume fee as `endless-comp cp <m>: host <pid8> -<fee> resume (save@`', V.indexOf("console.log('  endless-comp cp ' + c.m + ': host ' + plog(host) + ' -' + COMP.RESUME_CP + ' resume (save@'") >= 0);
  T('[2] validate.js prints a catch-up as `endless-comp catch-up <m>: pc `', V.indexOf("console.log('  endless-comp catch-up ' + c.m + ': pc '") >= 0);
  T('[2] validate.js reads the chain window from COMP_CHAIN_WAIT_MS, 7 days by default (the plan reads the same)', /CHAIN_WAIT_MS: Number\(process\.env\.COMP_CHAIN_WAIT_MS \|\| 7 \* 86400000\)/.test(V));
  const m = '-5_77_7';
  eq('[2] teamLineOf: the fee / a fee not charged / a catch-up / a milestone / a settle / another key',
    [R.teamLineOf('  endless-comp cp ' + m + ': host 0a1b2c3d -50 resume (save@15) -> 950', m), R.teamLineOf('  endless-comp cp ' + m + ': host 0a1b2c3d resume fee 50 not charged -- he wrote no result', m),
      R.teamLineOf('  endless-comp catch-up ' + m + ': pc 4 depth 15->20 at the head 20', m), R.teamLineOf('  endless-comp cp ' + m + ': 0a1b2c3d +30 milestone depth 20 (quad) -> 30', m),
      R.teamLineOf('  endless-comp settle ' + m + ': pc 4 depth 15->20', m), R.teamLineOf('  endless-comp cp -55_77_7: host 0a1b2c3d -50 resume (save@15) -> 950', m)],
    ['fee', null, 'catch-up', null, null, null]);
}

// ---- [3]-[5] a synthetic state history (state files only, a commit per reconcile run) ----
const SEED = '424242';
const PIDS = ['aa00000000000001', 'bb00000000000002', 'cc00000000000003', 'dd00000000000004'];
const RK = 'T|' + PIDS.slice().sort().join('+') + '|0|' + SEED;
const KX = (n) => '-' + n + '_' + SEED + '_7';
const K0 = KX(9), KS = KX(10), K1 = KX(11), K2 = KX(12), K3 = KX(13), K4 = KX(14);
const LIST = { t: { lane: 'team', fix: 'test', why: 'test', keys: { [K1]: null, [K2]: null, [K3]: null } } };
const T0 = Date.parse('2026-11-18T18:00:00Z'), W = 7 * DAY;
const startE = (t0, o) => Object.assign({ t0, mt: 7, roster: { 0: PIDS[0], 1: PIDS[1], 2: PIDS[2], 3: PIDS[3] }, settled: PIDS.slice(), started: PIDS.slice(), tst: {} }, o || {});
// knobs: settleAt (the chain moves at that key's close), early (closed inside the window), noWait, noStart, twoChains, headMax,
//   noSo, saves, openK4 / leftK4, listed (resettle.json names it), tie (K2 and K3 first seen in one pass)
function synth(tag, o) {
  o = o || {};
  const dir = fs.mkdtempSync(path.join(TMP, 'syn-' + tag + '-'));
  git(dir, ['init', '-q', '-b', 'main']);
  const S = { proc: [K0], solo: { runs: { [RK]: { max: 10, ms: 0, saves: {}, seg0: 1, pk: { lo: 10, hi: 0 }, rr: { lo: 13, hi: 0 }, xf0: 0, xf: Object.fromEntries(PIDS.map((p) => [p, 10])) } }, wait: {}, done: {}, ms: {}, hist: {} }, starts: {} };
  if (o.twoChains) S.solo.runs['T|' + PIDS.slice().sort().join('+') + '|1|' + SEED] = { max: 5 };
  const put = () => {
    fs.writeFileSync(path.join(dir, 'processed.json'), JSON.stringify(S.proc));
    fs.writeFileSync(path.join(dir, 'endless-solo.json'), JSON.stringify(S.solo));
    fs.writeFileSync(path.join(dir, 'starts.json'), JSON.stringify(S.starts));
    git(dir, ['add', '-A']);
  };
  const t1 = T0 + 20 * MIN, t2 = T0 + 25 * MIN, t3 = o.tie ? t2 : T0 + 30 * MIN;
  S.starts[KS] = startE(T0);
  if (o.noStart !== K1) S.starts[K1] = startE(T0 + 10 * MIN);
  S.starts[K2] = startE(T0 + 15 * MIN);
  S.starts[K3] = startE(o.tie ? T0 + 15 * MIN : T0 + 20 * MIN);
  put(); commitAt(dir, T0, 'starts');
  // each refused segment first seen waiting at the chain (its wait clock), one reconcile run each
  for (const [k, t] of [[K1, t1], [K2, t2], [K3, t3]]) { if (o.noWait !== k) S.solo.wait[k] = { t0: t }; put(); commitAt(dir, t + 30000, 'wait ' + k); }
  // the refusals, one run each, as the job: the key into the processed list, the wait clock kept
  for (const [k, t] of [[K1, t1], [K2, t2], [K3, t3]]) {
    S.proc.push(k);
    if (o.settleAt === k) { S.solo.runs[RK].max = 15; delete S.solo.wait[k]; }
    put(); commitAt(dir, (o.early === k ? t + W - HOUR : t + W + MIN) + (k === K3 && o.tie ? 1000 : 0), 'close ' + k);
  }
  // later: Q418's pass moves the chain past the held segment; the start entries of the closed keys are pruned
  const rH = S.solo.runs[RK];
  if (!o.noSo) rH.so = [KS];
  rH.max = o.headMax != null ? o.headMax : 15;
  if (o.saves) rH.saves = { 15: { t: T0 } };
  for (const k of [K1, K2, K3]) delete S.starts[k];
  if (o.openK4) S.starts[K4] = startE(T0 + 40 * MIN);
  if (o.leftK4) { S.solo.wait[K4] = { t0: T0 + 40 * MIN }; S.proc.push(K4); }
  put(); commitAt(dir, T0 + W + 3 * HOUR, 'Q418 pass');
  if (o.listed) { fs.writeFileSync(path.join(dir, 'resettle.json'), JSON.stringify({ v: 1, until: '2026-11-20T00:00:00Z', keys: { [o.listed]: { cp: 'free', how: 'reopened' } } })); git(dir, ['add', '-A']); commitAt(dir, T0 + W + 4 * HOUR, 'listed'); }
  return dir;
}
const planOf = (TT, dir, list) => TT.planKeys(TT.makeGit(dir), 'HEAD', ['t'], { lists: list || LIST, chainWaitMs: W, dir });
const st = (p) => p.keys.map((k) => k.m + ' ' + k.status + (k.why ? ' (' + k.why + ')' : '')).join('; ') + ' | runs ' + JSON.stringify(p.runs.map((r) => [r.status, r.why]));
const allReview = (p) => p.keys.length === 3 && p.keys.every((k) => k.status !== 'ok') && p.runs.length === 1 && p.runs[0].status === 'review';
// the cases each check must hold (also run against the mutants in [7])
const CASES = [
  ['settled', 'a listed key that settled at its close (the chain moved)', { settleAt: K1 }, /chain moved at its close/],
  ['early', 'a key closed inside the chain window', { early: K2 }, /inside the chain window/],
  ['nowait', 'a key with no wait clock before its close', { noWait: K3 }, /no chain wait clock/],
  ['nostart', 'a key with no start entry at its close or before', { noStart: K1 }, /no start entry naming the team/],
  ['two', 'two team chains of the players under the seed', { twoChains: true }, /2 team chains/],
  ['head', 'the chain not moved since the refusals', { headMax: 10 }, /has not moved past 10/],
  ['noso', 'no Q418 pass on the run', { noSo: true }, /no held segment passed/],
  ['saves', 'save points on the run (a resumed segment would be charged)', { saves: true }, /save points/],
  ['open', 'a segment under the seed still open outside the list', { openK4: true }, /still open outside the list/],
  ['left', 'a segment under the seed refused at the chain, not in the list', { leftK4: true }, /refused at the chain is not in the list/],
  ['listed', 'a key listed in resettle.json before', { listed: K2 }, /listed in resettle\.json before/],
];
const caseDirs = {};
function caseChecks(TT, tagPrefix) {
  const res = {};
  for (const [tag, label, o, why] of CASES) {
    const dir = caseDirs[tag] || (caseDirs[tag] = synth(tag, o));
    const p = planOf(TT, dir);
    res[tag] = { held: allReview(p) && why.test(st(p)), label, detail: st(p) };
  }
  return res;
}
let base;
{
  const dir = synth('base');
  const p = planOf(R, dir);
  base = { dir, p };
  T('[3] plan: the run\'s three refused segments reopen (ok), in start order, the run ok and marked prefix', p.keys.length === 3 && p.keys.every((k) => k.status === 'ok' && k.lane === 'team' && k.run === RK)
    && p.runs.length === 1 && p.runs[0].status === 'ok' && p.runs[0].prefix === true && JSON.stringify(p.runs[0].keys) === JSON.stringify([K1, K2, K3]), st(p));
  T('[3] plan: each start entry from its closing commit, its wait clock read from the commit before the close', p.keys.every((k) => k.start.src === 'close' && k.start.e.started.length === 4 && Number.isFinite(k.waitT0)), JSON.stringify(p.keys.map((k) => [k.start.src, k.waitT0])));
  T('[3] plan: the team named by pid, the head at the close 10', p.keys.every((k) => JSON.stringify(k.team) === JSON.stringify(PIDS.slice().sort()) && k.headAtClose === 10));
  const res = caseChecks(R);
  for (const tag of Object.keys(res)) T('[3] held for review: ' + res[tag].label, res[tag].held, res[tag].detail);
  // the list in the wrong order is still planned in start order
  const p2 = planOf(R, dir, { t: { lane: 'team', fix: 'test', why: 'test', keys: { [K3]: null, [K1]: null, [K2]: null } } });
  T('[3] a list in another order is planned in start order', JSON.stringify(p2.runs[0].keys) === JSON.stringify([K1, K2, K3]), JSON.stringify(p2.runs[0].keys));
  const lines = []; R.printPlan(p, (s) => lines.push(s));
  T('[3] printPlan: the team by pid8, the wait clock, the run in chain order', /team aa000000\+bb000000\+cc000000\+dd000000 \(waited at the chain from 2026-11-18T18:20:00Z\)/.test(lines.join('\n')) && /team: in chain order/.test(lines.join('\n')), lines.join('\n'));
}

// ---- [4] holdKeys on a team run ----
const holdCase = (TT, dir, skipM) => { const p = planOf(TT, dir); TT.holdKeys(p, new Map([[skipM, 'test hold']])); return p; };
const statuses = (p) => p.keys.map((k) => k.status).join(',');
{
  const p = holdCase(R, base.dir, K2);
  T('[4] holding the second segment holds it and the third, not the first; the run partly held', statuses(p) === 'ok,refused,refused' && p.runs[0].status === 'part' && /chains on/.test(p.keys[2].why), st(p));
  const p1 = holdCase(R, base.dir, K1);
  T('[4] holding the first holds the whole run', statuses(p1) === 'refused,refused,refused' && p1.runs[0].status === 'held', st(p1));
  const p3 = holdCase(R, base.dir, K3);
  T('[4] holding the last holds only it', statuses(p3) === 'ok,ok,refused', st(p3));
  const tie = synth('tie', { tie: true });
  const pt = holdCase(R, tie, K3);
  T('[4] two segments first seen in one pass (a tie): holding one holds both', statuses(pt) === 'ok,refused,refused', st(pt));
  // a solo / couch run still goes whole (the old rule): a run without prefix
  const fake = { keys: [{ m: 'a', status: 'ok' }, { m: 'b', status: 'ok' }], runs: [{ rk: 'x', keys: ['a', 'b'], status: 'ok' }], counts: {} };
  R.holdKeys(fake, new Map([['b', 'x']]));
  T('[4] a solo / couch run (no prefix) is still held whole', fake.keys.every((k) => k.status === 'refused'));
}

// ---- [5] apply / undo ----
{
  const dir = synth('apply');
  const p = planOf(R, dir);
  const proc0 = JSON.parse(fs.readFileSync(path.join(dir, 'processed.json'), 'utf8')), solo0 = JSON.parse(fs.readFileSync(path.join(dir, 'endless-solo.json'), 'utf8'));
  const now = T0 + W + 5 * HOUR;
  const ap = R.applyToDir(dir, p, { now });
  const proc = JSON.parse(fs.readFileSync(path.join(dir, 'processed.json'), 'utf8')), solo = JSON.parse(fs.readFileSync(path.join(dir, 'endless-solo.json'), 'utf8'));
  const starts = JSON.parse(fs.readFileSync(path.join(dir, 'starts.json'), 'utf8')), rs = JSON.parse(fs.readFileSync(path.join(dir, 'resettle.json'), 'utf8'));
  eq('[5] apply: the three reopened', ap.reopened, [K1, K2, K3]);
  T('[5] apply: out of the processed list, the key before them (settled) and the held one untouched', JSON.stringify(proc) === JSON.stringify([K0]) && proc0.length === 4, JSON.stringify(proc));
  T('[5] apply: their wait clocks out of the state, kept in the list', [K1, K2, K3].every((k) => !(k in solo.wait) && rs.keys[k].wait && rs.keys[k].wait.t0 === solo0.wait[k].t0), JSON.stringify(solo.wait));
  T('[5] apply: the start entries back as at the close', [K1, K2, K3].every((k) => starts[k] && starts[k].t0 === p.keys.find((x) => x.m === k).start.e.t0 && rs.keys[k].start === 'close') && !!starts[KS], JSON.stringify(Object.keys(starts)));
  T('[5] apply: the chain memory otherwise as it was (the run, done, the held segment)', JSON.stringify(solo.runs) === JSON.stringify(solo0.runs) && JSON.stringify(solo.done) === JSON.stringify(solo0.done));
  T('[5] apply: resettle.json -- lane team, how reopened, the close, until a week on', [K1, K2, K3].every((k) => rs.keys[k].lane === 'team' && rs.keys[k].how === 'reopened' && rs.keys[k].set === 't' && /^[0-9a-f]{12}$/.test(rs.keys[k].closed)) && Date.parse(rs.until) === Math.floor((now + 7 * DAY) / 1000) * 1000, JSON.stringify(rs).slice(0, 400));
  const ap2 = R.applyToDir(dir, p, { now: now + MIN });
  T('[5] a second apply changes nothing', ap2.reopened.length === 0 && ap2.skipped.length === 3, JSON.stringify(ap2));
  const un = R.undoInDir(dir, { now: now + HOUR });
  const procU = JSON.parse(fs.readFileSync(path.join(dir, 'processed.json'), 'utf8')), soloU = JSON.parse(fs.readFileSync(path.join(dir, 'endless-solo.json'), 'utf8'));
  T('[5] undo: re-closed, the wait clocks back', JSON.stringify(un.reclosed) === JSON.stringify([K1, K2, K3]) && [K1, K2, K3].every((k) => procU.indexOf(k) >= 0 && soloU.wait[k] && soloU.wait[k].t0 === solo0.wait[k].t0), JSON.stringify(un));
}

// ---- [6] end to end with the real validate.js ----
const hexLE = (arr) => arr.map((n) => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const ROS = [SID(4501), SID(4502), SID(4503), SID(4504)];
const RSEED = 450450, SC = [49325, 30000, 20000, 10000];
// one team competitive record (the shape of cloud audit Q418's repro: 4 seats, seat scores, roster pairs, the segment tail)
function rec7(magic, hash, seat, sd, ed, flags, sc, dur, seed) {
  const pc = ROS.length, start = magic === 0xB2;
  const d = [magic, start ? 1 : 3, 7, hash | 0, seed || RSEED, seat, 0, 0, pc, start ? 0 : dur];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i]);
  d.push(0);
  for (const s of ROS) { const p = sidPair(s); d.push(p[0], p[1]); }
  return start ? d : d.concat([sd, ed, 0, 0, 0, A.SEG_COMP | flags, 0, 0, 0, 0, 0]);
}
// a segment: the four start records + the four results (short: the seat-3 copy writes seat 2's score 200 lower = Q418's shape)
function seg(i, hash, sd, ed, flags, short, seed) {
  return ROS.map((sid, s) => ({ sid, d: rec7(0xB2, hash, s, 0, 0, 0, null, 0, seed), shard: 2 * i }))
    .concat(ROS.map((sid, s) => ({ sid, d: rec7(0xB1, hash, s, sd, ed, flags | 0, (short && s === 3) ? SC.map((x, j) => (j === 2 ? x - 200 : x)) : SC, (short && s === 3) ? 480 : 475, seed), shard: 2 * i + 1 })));
}
const H0 = -450100;
const SEGS = [seg(0, H0, 0, 5), seg(1, H0 - 1, 5, 10), seg(2, H0 - 2, 10, 15, 0, true), seg(3, H0 - 3, 15, 20), seg(4, H0 - 4, 20, 25), seg(5, H0 - 5, 25, 27, A.SEG_FINAL)];
const KEY6 = (i) => (H0 - i) + '_' + RSEED + '_7';
// the reconcile does its settle passes (Q418's among them) only in a run with a fresh match to settle ('no fresh matches, skip'):
//   the players start another run (another seed) when Q418 goes live, in both histories alike
const SW = 12, OTHER = seg(6, H0 - 100, 0, 5, 0, false, RSEED + 10);
const REFUSED = [KEY6(3), KEY6(4), KEY6(5)];
const LIST6 = { t: { lane: 'team', fix: 'test', why: 'test', keys: Object.fromEntries(REFUSED.map((m) => [m, null])) } };
// the old rule = the code before Q418: no pass over a held segment whose writers differ only in the seat scores
const OLD_RULE = (s) => s.replace('  for (const so of seatOnlyCands) { const r418 = seatOnlyPass(so);', "  if (process.env.RESETTLE_TEST_OLD_RULE !== '1') for (const so of seatOnlyCands) { const r418 = seatOnlyPass(so);");
const CHAIN_WAIT = 45 * MIN;
function liveRepo(tag) {
  const dir = fs.mkdtempSync(path.join(TMP, 'live-' + tag + '-'));
  const files = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter((f) => f && !f.startsWith('test/') && (!/^[^/]+\.json$/.test(f) || /^(attest-keys|recover-shards|gr-caps|rfduo-caps|confirmed-errors|feedback-mod|feedback-wordlist|campaign-endless|classic|chat-mute)\.json$/.test(f)));
  for (const f of files) { const s = path.join(ROOT, f); if (!fs.existsSync(s)) continue; fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(s, path.join(dir, f)); }
  for (const f of ['tools/resettle-once.js', 'tools/resettle-steam.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const vf = path.join(dir, 'validate.js'), s0 = fs.readFileSync(vf, 'utf8'), s1 = OLD_RULE(s0);
  if (s1 === s0) throw new Error('[6] the old-rule anchor is gone from validate.js (the Q418 pass loop over seatOnlyCands)');
  fs.writeFileSync(vf, s1);
  fs.writeFileSync(path.join(dir, 'processed.json'), '[]'); fs.writeFileSync(path.join(dir, 'starts.json'), '{}');
  fs.writeFileSync(path.join(dir, 'endless-solo.json'), JSON.stringify({ runs: {}, done: {}, wait: {} }));
  git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'code']);
  return dir;
}
const ENVX = { STRICT_BOARDS: '0', SEEDCAP_ENFORCE: '0', SEEDCAP_REJECT: '0', SEASON_NOW: '2026-10-01T00:00:00Z', RECOVER_FILE: path.join(TMP, 'no-recover.json'), CONCURRENCY: '1', RESUME_TAG_REQUIRED: '0', COMP_CHAIN_WAIT_MS: String(CHAIN_WAIT) };
const SEC = { APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's' };
const BOARDS = { xp: 5, cp: 8, quad: 17 };
function world() {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, trusted: true, asc: false, entries: {} });   // every shard (LEDGER_SHARDS 50): a partial read registers no endless start roster (Q113)
  const named = [[BOARDS.xp, 'progress'], [BOARDS.cp, 'cp_bank'], [9, 'trust_tier'], [10, 'report_box'], [11, 'endless_board'], [12, 'endless_board_trio'], [13, 'endless_board_quad'],
    [14, 'endless_comp_trio'], [16, 'endless_comp_duo'], [BOARDS.quad, 'endless_comp_quad'], [15, 'endless_comp'], [25, 'endless_board_solo'], [26, 'endless_board_overall'], [6, 'rating'], [7, 'points']];
  for (const [id, name] of named) boards.push({ id, name, trusted: true, asc: false, entries: name === 'cp_bank' ? Object.fromEntries(ROS.map((s) => [s, { score: 1000, h: '' }])) : {} });
  return { nextId: 99000, boards };
}
function writeRows(fxPath, recs) { const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); for (const r of recs) { const b = fx.boards.find((x) => x.name === 'shard_' + r.shard); b.entries[String(r.sid)] = { score: 1, h: hexLE(r.d) }; } fs.writeFileSync(fxPath, JSON.stringify(fx)); }
function liveTick(dir, fxPath, nowMs, oldRule) {
  const env = Object.assign({ PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8' }, SEC, ENVX, { STEAM_PUBLISHER_KEY: 'offline', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: path.join(dir, '.summary.md'),
    RESETTLE_FX: fxPath, RESETTLE_LOG: path.join(dir, '.writes.jsonl'), RESETTLE_NOW_MS: String(nowMs), RESETTLE_TEST_OLD_RULE: oldRule ? '1' : '0' });
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'tools', 'resettle-steam.js'), 'validate.js'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 180000 });
  git(dir, ['add', '-A', '--', 'processed.json', 'starts.json', 'endless-solo.json']);
  commitAt(dir, nowMs);
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const T6 = Date.parse('2026-11-18T12:00:00Z');
// one segment every 10 minutes (its starts and results at once), a reconcile run 1 minute after each write, then empty runs; oldTicks
//   = how many runs go by under the old rule before Q418 is live (null: Q418 from the start)
function live6(tag, oldTicks) {
  const dir = liveRepo(tag), fxPath = path.join(dir, '.fx.json');
  fs.writeFileSync(fxPath, JSON.stringify(world()));
  const outs = [];
  const N = 6 + 9;   // 6 writes, then 9 empty runs (the chain window is 45 min)
  let n = 0;
  for (; n < N; n++) {
    if (n < SEGS.length) writeRows(fxPath, SEGS[n]);
    if (n === SW) writeRows(fxPath, OTHER);
    const r = liveTick(dir, fxPath, T6 + n * 10 * MIN + MIN, oldTicks != null && n < oldTicks);
    outs.push(r.out);
    if (r.code !== 0) return { err: 'run ' + n + ': exit ' + r.code + '\n' + r.out.slice(-1500) };
  }
  return { dir, fxPath, out: outs.join('\n'), endT: T6 + (N - 1) * 10 * MIN + MIN };
}
const fxRow = (fxPath, name, sid) => { const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); const b = fx.boards.find((x) => x.name === name); return b && b.entries[String(sid)] ? b.entries[String(sid)].score : null; };
const soloAt = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'endless-solo.json'), 'utf8'));
const procAt = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'processed.json'), 'utf8'));
const runOf6 = (dir) => { const so = soloAt(dir); const k = Object.keys(so.runs || {}).find((x) => x.startsWith('T|') && x.endsWith('|' + RSEED)); return k ? so.runs[k] : null; };
const values = (fxPath) => ROS.map((s) => [fxRow(fxPath, 'progress', s), fxRow(fxPath, 'cp_bank', s), fxRow(fxPath, 'endless_comp_quad', s)]);
function snapOf(dir, fxPath, atMs, tag) {
  const snap = path.join(TMP, 'snap6-' + tag); fs.mkdirSync(path.join(snap, 'boards', '1'), { recursive: true }); fs.mkdirSync(path.join(snap, 'cron'));
  const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
  const man = { schema: 1, at: new Date(atMs).toISOString(), appids: { 1: { boards: [] } }, cron: { head: git(dir, ['rev-parse', 'HEAD']).trim() } };
  for (const b of fx.boards) {
    const rows = Object.keys(b.entries).map((sid, i) => JSON.stringify({ sid, score: b.entries[sid].score, rank: i + 1, ugc: null, d: b.entries[sid].h || null })).join('\n');
    fs.writeFileSync(path.join(snap, 'boards', '1', b.name + '.jsonl.gz'), zlib.gzipSync(Buffer.from(rows ? rows + '\n' : '')));
    man.appids[1].boards.push({ name: b.name, id: b.id, file: 'boards/1/' + b.name + '.jsonl.gz', complete: true, onlytrustedwrites: true, sortmethod: 'Descending' });
  }
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(man));
  for (const f of fs.readdirSync(dir)) if (/\.json$/.test(f)) fs.copyFileSync(path.join(dir, f), path.join(snap, 'cron', f));   // (a temp dir: the state the live runs wrote)
  return snap;
}
function dry6(TT, live, atMs, tag) {
  Object.assign(process.env, SEC);
  const lines = [];
  try {
    const r = TT.dryRun({ snap: snapOf(live.dir, live.fxPath, atMs, tag), code: live.dir, repo: live.dir, sets: ['t'], lists: LIST6, ticks: 4, work: path.join(TMP, 'work6-' + tag), log: (s) => lines.push(s), envExtra: Object.assign({}, ENVX, { RESETTLE_TEST_OLD_RULE: '0' }) });
    return Object.assign(r, { report: fs.readFileSync(path.join(r.work, 'report.txt'), 'utf8'), rep: JSON.parse(fs.readFileSync(path.join(r.work, 'report.json'), 'utf8')) });
  } catch (e) { return { err: String(e && e.stack || e) + '\n' + lines.join('\n').slice(-2000) }; }
  finally { for (const k of ['APPID', 'LB_PREFIX', 'RANKED_LB', 'LP_LB', 'XP_LB']) delete process.env[k]; process.env.STATE_SALT = 's'; }
}
let at6 = null;
{
  // the old rule for the first 12 runs (the three behind the held segment refused after 45 min), then Q418 live; and the baseline
  const OLD = live6('old', SW), BASE = live6('base', null);
  if (OLD.err || BASE.err) bad('[6] the live runs did not complete: ' + (OLD.err || BASE.err));
  else {
    const proc = procAt(OLD.dir), run = runOf6(OLD.dir) || {}, baseRun = runOf6(BASE.dir) || {};
    const rej = (OLD.out.match(/team comp segment chain REJECT \(chain-gap\)/g) || []).length;
    T('[6] old rule live: [0,5] [5,10] settled, the held [10,15] open, the three behind it refused at the chain (chain-gap), wait clocks kept',
      proc.indexOf(KEY6(0)) >= 0 && proc.indexOf(KEY6(1)) >= 0 && proc.indexOf(KEY6(2)) < 0 && REFUSED.every((m) => proc.indexOf(m) >= 0 && !!(soloAt(OLD.dir).wait || {})[m]) && rej === 3,
      JSON.stringify({ proc, rej, wait: Object.keys(soloAt(OLD.dir).wait || {}) }) + '\n' + OLD.out.split('\n').filter((l) => REFUSED.some((m) => l.indexOf(m) >= 0)).slice(-8).join('\n'));
    T('[6] then Q418 live: the chain passes the held segment (head 15, run.so), the refused stay closed -- the bug state', (run.max | 0) === 15 && Array.isArray(run.so) && run.so.indexOf(KEY6(2)) >= 0 && /the run's chain moves past it/.test(OLD.out), JSON.stringify(run) + '\n' + OLD.out.split('\n').filter((l) => l.indexOf(KEY6(2)) >= 0 || /seat-only|Q418/.test(l)).slice(-12).join('\n'));
    T('[6] the baseline (Q418 from the start): all five settle past the held one, chain 27', (baseRun.max | 0) === 27 && [0, 1, 3, 4, 5].every((i) => procAt(BASE.dir).indexOf(KEY6(i)) >= 0), JSON.stringify(baseRun));
    const vOld = values(OLD.fxPath), vBase = values(BASE.fxPath);
    T('[6] ... the bug cost them XP and the ladder (the baseline has more)', vOld.every((v, i) => (v[0] | 0) < (vBase[i][0] | 0) && (v[2] | 0) < (vBase[i][2] | 0)), JSON.stringify({ vOld, vBase }));
    const G6 = R.makeGit(OLD.dir);
    const pl = R.planKeys(G6, 'HEAD', ['t'], { lists: LIST6, chainWaitMs: CHAIN_WAIT });
    T('[6] plan on the live history: the three ok, in chain order', pl.keys.length === 3 && pl.keys.every((k) => k.status === 'ok') && JSON.stringify(pl.runs[0].keys) === JSON.stringify(REFUSED), st(pl));
    at6 = OLD.endT + 30 * MIN;
    const D = dry6(R, OLD, at6, 'fix');
    if (D.err) bad('[6] the dry run did not complete: ' + D.err);
    else {
      const row = (m) => D.rows.find((x) => x.m === m) || {};
      T('[6] dry run: each settles in B; 0 closed in B only; no value down; no new flag; every run exit 0',
        REFUSED.every((m) => /^settled \(tick [0-9]+\)$/.test(row(m).result)) && D.onlyB.length === 0 && D.down === 0 && D.flagsOther.length === 0 && D.exitBad === 0 && /no board value goes down/.test(D.report), D.report);
      T('[6] ... XP and the ladder go up in B, cp_bank does not go down', D.diff.some((d) => d.board === 'progress' && d.b > (d.a || 0)) && D.diff.some((d) => d.board === 'endless_comp_quad' && d.b > (d.a || 0)) && !D.diff.some((d) => d.board === 'cp_bank' && d.down), D.report);
      T('[6] ... the gate takes the report', R.reportGate(D.rep, at6).refuse.length === 0, JSON.stringify(R.reportGate(D.rep, at6)));
      // mutant (before anything is applied): the dry run's settle line without the team lane's -- none of the three counts as
      //   settled, so apply would reopen none of them
      const MO = mutantTool('outcome', "const settled = new RegExp('(endless|endless-comp|solo|couch) settle '", "const settled = new RegExp('(endless|solo|couch) settle '");
      if (MO) {
        const Dm = dry6(MO, OLD, at6, 'm-outcome');
        const skipM = Dm.err ? null : R.dryVerdicts(Dm.rep, pl);
        T('[7] mutant: the dry run without the team settle line sees none of the three settle (apply would reopen none) -> [6] goes red', !Dm.err && REFUSED.every((m) => skipM.has(m)), Dm.err ? Dm.err.slice(0, 300) : JSON.stringify(Dm.rows.map((x) => [x.m, x.result])));
      }
      // apply as the CLI does (plan at HEAD + the dry run's verdicts), commit, then Q418 live
      const plan = R.holdKeys(R.planKeys(G6, 'HEAD', ['t'], { lists: LIST6, dir: OLD.dir, chainWaitMs: CHAIN_WAIT }), R.dryVerdicts(D.rep, pl));
      const nowLive = at6 + 2 * MIN;
      const ap = R.applyToDir(OLD.dir, plan, { now: nowLive });
      git(OLD.dir, ['add', '-A', '--', 'processed.json', 'starts.json', 'endless-solo.json', 'resettle.json']); commitAt(OLD.dir, nowLive, 'resettle');
      eq('[6] apply: the three reopened', ap.reopened, REFUSED);
      const outs = [];
      for (let k = 1; k <= 4; k++) { const r = liveTick(OLD.dir, OLD.fxPath, nowLive + k * 5 * MIN, false); outs.push(r.out); if (r.code) break; }
      const aOut = outs.join('\n');
      const cnt = (m) => aOut.split('\n').filter((l) => l.indexOf('endless-comp settle ' + m + ':') >= 0).length;
      const vNow = values(OLD.fxPath), runNow = runOf6(OLD.dir) || {};
      T('[6] live after: each of the three settles once, nothing else of the run settles again', REFUSED.every((m) => cnt(m) === 1) && cnt(KEY6(0)) === 0 && cnt(KEY6(1)) === 0 && cnt(KEY6(2)) === 0,
        JSON.stringify(REFUSED.map(cnt)) + '\n' + aOut.split('\n').filter((l) => /endless-comp|REJECT/.test(l)).join('\n').slice(0, 2000));
      T('[6] live after: XP, ladder, CP and the chain as with Q418 from the start (nobody lower than before)', JSON.stringify(vNow) === JSON.stringify(vBase) && (runNow.max | 0) === 27 && vNow.every((v, i) => (v[1] | 0) >= (vOld[i][1] | 0)),
        JSON.stringify({ vNow, vBase, vOld, chain: runNow.max }));
      T('[6] live after: the held segment still not settled (Q418\'s rule), nobody charged a resume fee', procAt(OLD.dir).indexOf(KEY6(2)) < 0 && !/endless-comp cp [^\n]*resume \(save@/.test(aOut));
      const un = R.undoInDir(OLD.dir, { now: nowLive + HOUR });
      T('[6] undo afterwards finds the three taken by the reconcile', un.reclosed.length === 0 && JSON.stringify(un.taken.slice().sort()) === JSON.stringify(REFUSED.slice().sort()), JSON.stringify(un));
    }
  }
}

// ---- [7] mutants ----
{
  const M = (tag, from, to) => mutantTool(tag, from, to);
  const caseOf = (TT, tag) => caseChecks(TT)[tag];
  const pins = [
    ['settled', "      if (!same((st0.runs || {})[rk], (st.runs || {})[rk])) { review('the chain moved at its close", "      if (false) { review('the chain moved at its close"],
    ['early', '      if (!(cl.t + 1000 - Number(w0.t0) > waitMs)) {', '      if (false) {'],
    ['nowait', "      if (!w0 || typeof w0 !== 'object' || !Number.isFinite(Number(w0.t0))) { review(", "      if (false) { review("],
    ['nostart', "      if (k.start.src === 'synth' || team.length < 2) { review(", "      if (false) { review("],
    ['head', "      else if (!((rH.max | 0) > hi)) g.why", "      else if (false) g.why"],
    ['noso', "      else if (!passed.size) g.why", "      else if (false) g.why"],
    ['saves', "      else if (rH.saves && typeof rH.saves === 'object' && Object.keys(rH.saves).length) g.why", "      else if (false) g.why"],
    ['open', "      else if (openK.length) g.why", "      else if (false) g.why"],
    ['left', "      else if (leftK.length) g.why", "      else if (false) g.why"],
  ];
  for (const [tag, from, to] of pins) {
    const MT = M('p-' + tag, from, to);
    if (!MT) continue;
    let c = null;
    try { c = caseOf(MT, tag); } catch (e) { c = { held: false, detail: 'threw: ' + e.message }; }
    T('[7] mutant: without its check, "' + CASES.find((x) => x[0] === tag)[1] + '" is no longer held -> [3] goes red', !c.held, c.detail);
  }
  // a key that cannot be reopened holds the whole run (the case of a key closed inside the chain window would leave the other two ok)
  const MB = M('bad', '      if (bad) g.why = ', '      if (false) g.why = ');
  if (MB) { const p = planOf(MB, caseDirs.early); T('[7] mutant: without the whole-run rule a listed key closed inside the chain window leaves the rest of its run reopened -> [3] goes red', p.keys.filter((k) => k.status === 'ok').length === 2, st(p)); }
  // the prefix hold: without it a held segment holds the whole run (the first is lost)
  const MP = M('prefix', '    if (r.prefix) {', '    if (false) {');
  if (MP) { const p = holdCase(MP, base.dir, K2); T('[7] mutant: without the prefix hold, holding the second segment also holds the first -> [4] goes red', statuses(p) === 'refused,refused,refused', st(p)); }
  // the start order: without the sort the list order is kept
  const MS = M('order', '      g.keys.sort((a, b) => (t0Of(a) - t0Of(b)) || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));', '');
  if (MS) { const p = planOf(MS, base.dir, { t: { lane: 'team', fix: 'test', why: 'test', keys: { [K3]: null, [K1]: null, [K2]: null } } }); T('[7] mutant: without the start order a list in another order stays in it -> [3] goes red', JSON.stringify(p.runs[0].keys) !== JSON.stringify([K1, K2, K3]), JSON.stringify(p.runs[0].keys)); }
  // (the dry run's settle-line mutant runs in [6], before the apply)
  const MF = M('fee', "  if (new RegExp('endless-comp cp ' + esc + ': host \\\\S+ -[0-9]+ resume').test(l)) return 'fee';", '');
  if (MF) T('[7] mutant: without the fee line, a settle that charged the host the resume fee counts as settled -> [2] goes red', MF.teamLineOf('  endless-comp cp -5_77_7: host 0a1b2c3d -50 resume (save@15) -> 950', '-5_77_7') !== 'fee');
  const MC = M('ready', "  return { ok: (set === 'q407' || set === 'q450' || hook) && !!ready[set], hook, fix: !!ready[set] };", "  return { ok: (set === 'q407' || hook) && !!ready[set], hook, fix: !!ready[set] };");
  if (MC) {
    const t = fs.mkdtempSync(path.join(TMP, 'cr-m-'));
    fs.writeFileSync(path.join(t, 'validate.js'), fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8').replace(/function loadResettleFree\(/g, 'function loadResettleFreeX('));
    T('[7] mutant: q450 asking for the hook -> [2] goes red (a tree without it would refuse the list)', !MC.codeReady(t, 'q450').ok);
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
