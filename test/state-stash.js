'use strict';
// O689 (2026-11-04, user ruling: cloud drafts, verifier pushes): a reconcile run whose state push GitHub refuses three times
//   (`Internal Server Error` / `fatal error in commit_refs`) lost its record of what it settled while its board writes stayed;
//   the next run started from the old state and paid the same matches again on top of the rows already moved -- live on the demo
//   channel 11:05Z / 11:10Z, one account's XP row 141 -> 164 -> 187. tools/state-stash.js keeps the files of a failed push in the
//   Actions cache and the next run starts from them, only when nothing could have moved the branch's state since.
//   [1] pure: metaProblem / decide (every refusal), backoffSeconds (15 / 45 / 90, cut at the job's end, no clock = 5 * n)
//   [2] the CLI in a scratch git repository (the workflow's sequence: restore before the run, out after persist): a failed push
//       keeps the files, the next checkout gets them back; other channels' commits in between do not matter; a commit of this
//       channel's files (even a revert back to the same bytes), a base outside HEAD's history, a modified checkout, a foreign
//       channel's copy, a kept file that is not JSON -> the checkout is left as it is; a successful push after a found copy caches
//       the cleared marker; out without a recorded base keeps nothing; a second failure in a row keeps the newest state on the
//       first base's blobs (the chain)
//   [3] the 11-04 shape over the REAL validate.js (test/lib/settle-stub.js): a quick 1V1 settles (XP rows move), its push fails;
//       the next run from the kept state pays nothing again, the run from the branch state (the code before) pays the match twice
//   [4] mutants: each guard of decide() removed (the branch moved / modified checkout / not JSON / foreign channel) and the
//       rollback of a half-done replace -> [2] catches it
// The workflows wiring it (the steps, their order and conditions) are pinned by test/state-stash-wiring.js.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const TOOL = path.join(__dirname, '..', 'tools', 'state-stash.js');
const S = require(TOOL);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const sha = (c) => c.repeat(40);

console.log('=== state stash (O689) ===');
// ---- [1] pure ----
{
  const meta = (o) => Object.assign({ v: 1, channel: 'demo', base: sha('a'), files: ['demo-x.json', 'demo-y.json'], blobs: { 'demo-x.json': sha('b'), 'demo-y.json': null } }, o || {});
  const ctx = (o) => Object.assign({ channel: 'demo', baseKnown: true, baseIsAncestor: true, touched: [], headBlobs: { 'demo-x.json': sha('b'), 'demo-y.json': null }, dirty: [],
    contents: { 'demo-x.json': '{"a":1}', 'demo-y.json': '[]' } }, o || {});
  T('[1] a clean copy on an unmoved branch is applied', S.decide(meta(), ctx()).apply === true, J(S.decide(meta(), ctx())));
  const no = (label, m, c, re) => { const d = S.decide(m, c); T('[1] ' + label + ' -> not applied (' + d.why + ')', d.apply === false && re.test(d.why), J(d)); };
  no('no metadata', null, ctx(), /no metadata/);
  no('another layout version', meta({ v: 2 }), ctx(), /version/);
  no('another channel\'s copy', meta({ channel: 'playtest' }), ctx(), /channel playtest/);
  no('the cleared marker', meta({ cleared: true }), ctx(), /cleared/);
  no('no base commit', meta({ base: 'HEAD' }), ctx(), /base commit/);
  no('no files', meta({ files: [] }), ctx(), /no files/);
  no('a path in a file name', meta({ files: ['../x.json'], blobs: { '../x.json': null } }), ctx(), /bad file name/);
  no('a dot file', meta({ files: ['.heartbeat.json'], blobs: { '.heartbeat.json': null } }), ctx(), /bad file name/);
  no('a file listed twice', meta({ files: ['demo-x.json', 'demo-x.json'] }), ctx(), /twice/);
  no('a file without its base blob', meta({ blobs: { 'demo-x.json': sha('b') } }), ctx(), /no base blob/);
  no('a malformed base blob', meta({ blobs: { 'demo-x.json': 'zz', 'demo-y.json': null } }), ctx(), /bad base blob/);
  no('base not in the checkout', meta(), ctx({ baseKnown: false, baseIsAncestor: false }), /not in this checkout/);
  no('base not an ancestor of HEAD', meta(), ctx({ baseIsAncestor: false }), /not an ancestor/);
  no('a commit since the base touched the files', meta(), ctx({ touched: [sha('c')] }), /branch moved/);
  no('a file at HEAD is another blob', meta(), ctx({ headBlobs: { 'demo-x.json': sha('d'), 'demo-y.json': null } }), /not the base blob/);
  no('a file new at HEAD (absent at the base)', meta(), ctx({ headBlobs: { 'demo-x.json': sha('b'), 'demo-y.json': sha('e') } }), /not the base blob/);
  no('a HEAD blob not read', meta(), ctx({ headBlobs: { 'demo-x.json': sha('b') } }), /no HEAD blob/);
  no('a modified checkout', meta(), ctx({ dirty: ['demo-x.json'] }), /checkout modified/);
  no('a kept file missing', meta(), ctx({ contents: { 'demo-x.json': '{}' } }), /kept file missing/);
  no('a kept file that is not JSON', meta(), ctx({ contents: { 'demo-x.json': '<<<<<<< HEAD', 'demo-y.json': '[]' } }), /not JSON/);
  // backoff: the plan, the job's end, no clock
  const T0 = 1000000, LIM = 600;
  T('[1] backoff plan 15 / 45 / 90 early in the job', J([1, 2, 3].map((n) => S.backoffSeconds(n, T0 + 60, T0, LIM))) === J([15, 45, 90]));
  T('[1] backoff never past the job\'s end less the reserve (' + S.RESERVE_S + ' s)', S.backoffSeconds(3, T0 + LIM - S.RESERVE_S - 20, T0, LIM) === 20 && S.backoffSeconds(2, T0 + LIM - 10, T0, LIM) === 0);
  T('[1] backoff without a job clock = the old 5 * n', J([1, 2, 3].map((n) => S.backoffSeconds(n, T0, undefined, LIM))) === J([5, 10, 15]) && S.backoffSeconds(1, T0, 'x', LIM) === 5);
  T('[1] the three waits fit a 10-min job after an 8-min run step', [1, 2, 3].reduce((a, n) => a + S.backoffSeconds(n, T0 + 480 + a, T0, LIM), 0) <= LIM - 480 - S.RESERVE_S);
}

// ---- [2] the CLI in a scratch repository ----
const gitIn = (dir, args) => cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'].concat(args),
  { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function cli(dir, args, env, tool) {
  const out = path.join(dir, '..', path.basename(dir) + '-out'), genv = path.join(dir, '..', path.basename(dir) + '-env');
  fs.writeFileSync(out, ''); fs.writeFileSync(genv, '');
  const e = Object.assign({}, process.env, { GITHUB_OUTPUT: out, GITHUB_ENV: genv, GITHUB_RUN_ID: '777' }, env || {});
  for (const k of Object.keys(env || {})) if (env[k] == null) delete e[k];
  const r = cp.spawnSync(process.execPath, [tool || TOOL].concat(args), { cwd: dir, env: e, encoding: 'utf8' });
  const kv = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { code: r.status, log: (r.stdout || '') + (r.stderr || ''), out: kv(out), env: kv(genv) };
}
const W = (dir, f, o) => fs.writeFileSync(path.join(dir, f), typeof o === 'string' ? o : J(o));
const R = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return null; } };
const FILES = ['demo-processed.json', 'demo-xp.json'];
// a channel whose branch holds state S0 at C0; a run checks it out, settles (S1) and its push fails -> the kept copy (cache)
function scenario(tool) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-stash-'));
  const dir = path.join(root, 'repo'); fs.mkdirSync(dir);
  gitIn(dir, ['init', '-q']);
  W(dir, 'demo-processed.json', ['m1']); W(dir, 'demo-xp.json', { a: 141 }); W(dir, 'pt-xp.json', { z: 1 }); W(dir, 'validate.js', '// code');
  gitIn(dir, ['add', '-A']); gitIn(dir, ['commit', '-q', '-m', 'S0']);
  const C0 = gitIn(dir, ['rev-parse', 'HEAD']);
  const cache = path.join(root, 'cache');   // what actions/cache keeps between the runs
  const s = {
    root, dir, C0, cache,
    // the workflow's run N: restore (nothing kept yet), the run writes S1, persist fails, out keeps it
    failedRun(next) {
      const r1 = cli(dir, ['restore', 'demo'], null, tool);
      W(dir, 'demo-processed.json', next.processed); W(dir, 'demo-xp.json', next.xp);
      const r2 = cli(dir, ['out', 'demo', 'failure', r1.out.found || 'none'].concat(FILES), { STASH_BASE: r1.env.STASH_BASE }, tool);
      if (r2.out.write === '1') { fs.rmSync(cache, { recursive: true, force: true }); fs.cpSync(path.join(dir, '.state-stash'), cache, { recursive: true }); }
      return { r1, r2 };
    },
    // the next job: a fresh checkout of the branch tip (no local commit, no local file), the cache restored, then the tool
    nextCheckout() { gitIn(dir, ['checkout', '-q', '-f', 'HEAD']); gitIn(dir, ['clean', '-qfdx']); if (fs.existsSync(cache)) fs.cpSync(cache, path.join(dir, '.state-stash'), { recursive: true }); },
    restore() { return cli(dir, ['restore', 'demo'], null, tool); },
    commit(f, o, msg) { W(dir, f, o); gitIn(dir, ['add', '--', f]); gitIn(dir, ['commit', '-q', '-m', msg || ('touch ' + f)]); },
    done() { fs.rmSync(root, { recursive: true, force: true }); },
  };
  return s;
}
const S1 = { processed: ['m1', 'm2'], xp: { a: 164 } };
const isS1 = (dir) => R(dir, 'demo-processed.json') === J(S1.processed) && R(dir, 'demo-xp.json') === J(S1.xp);
const isS0 = (dir) => R(dir, 'demo-processed.json') === J(['m1']) && R(dir, 'demo-xp.json') === J({ a: 141 });
// every case of [2] as a function of the tool under test: -> [label, pass]
function cases(tool) {
  const res = [];
  const add = (label, pass, detail) => res.push([label, !!pass, detail || '']);
  { // kept and applied; the next job records its own base
    const s = scenario(tool);
    const f = s.failedRun(S1);
    add('restore with nothing cached: found=none, STASH_BASE = HEAD', f.r1.out.found === 'none' && f.r1.env.STASH_BASE === s.C0, J(f.r1));
    add('a failed push keeps the files (write=1, base C0, both files)', f.r2.out.write === '1' && (() => { const m = JSON.parse(R(s.cache, 'meta.json')); return m.base === s.C0 && J(m.files) === J(FILES) && m.channel === 'demo'; })(), f.r2.log);
    s.nextCheckout();
    const r = s.restore();
    add('the next checkout gets the kept state back (applied=1)', r.out.applied === '1' && r.out.found === 'stash' && isS1(s.dir), r.log);
    add('the kept directory is removed after the restore', !fs.existsSync(path.join(s.dir, '.state-stash')));
    add('an untouched file of another channel stays as it was', R(s.dir, 'pt-xp.json') === J({ z: 1 }));
    s.done();
  }
  { // other channels' commits and a code push in between do not matter
    const s = scenario(tool); s.failedRun(S1);
    s.commit('pt-xp.json', { z: 2 }, 'state: playtest'); s.commit('validate.js', '// code 2', 'code push');
    s.nextCheckout(); const r = s.restore();
    add('commits of other files since the base: still applied', r.out.applied === '1' && isS1(s.dir), r.log);
    s.done();
  }
  { // this channel's state moved on the branch (a later run pushed, a fallback pushed back)
    const s = scenario(tool); s.failedRun(S1);
    s.commit('demo-processed.json', ['m1', 'm9'], 'state: demo');
    s.nextCheckout(); const r = s.restore();
    add('a commit of this channel\'s files since the base: not applied, the branch state stays', r.out.applied === '0' && R(s.dir, 'demo-processed.json') === J(['m1', 'm9']) && /branch moved/.test(r.log), r.log);
    s.done();
  }
  { // a revert back to the very same bytes is still "moved"
    const s = scenario(tool); s.failedRun(S1);
    s.commit('demo-xp.json', { a: 999 }, 'manual'); s.commit('demo-xp.json', { a: 141 }, 'manual revert');
    s.nextCheckout(); const r = s.restore();
    add('a revert to the same bytes since the base: not applied', r.out.applied === '0' && isS0(s.dir) && /branch moved/.test(r.log), r.log);
    s.done();
  }
  { // history rewritten: the base is not in HEAD's history any more
    const s = scenario(tool); s.failedRun(S1);
    gitIn(s.dir, ['checkout', '-q', '--orphan', 'rewritten']); gitIn(s.dir, ['commit', '-q', '-m', 'compacted']);
    gitIn(s.dir, ['branch', '-q', '-D', 'main']); gitIn(s.dir, ['reflog', 'expire', '--expire=now', '--all']); gitIn(s.dir, ['gc', '-q', '--prune=now']);
    s.nextCheckout(); const r = s.restore();
    add('a base outside HEAD\'s history (rewritten): not applied', r.out.applied === '0' && isS0(s.dir) && /not in this checkout|not an ancestor|branch moved/.test(r.log), r.log);
    s.done();
  }
  { // the checkout was modified before the restore
    const s = scenario(tool); s.failedRun(S1);
    s.nextCheckout(); W(s.dir, 'demo-xp.json', { a: 5 }); const r = s.restore();
    add('a modified checkout: not applied, left as it is', r.out.applied === '0' && R(s.dir, 'demo-xp.json') === J({ a: 5 }) && /checkout modified/.test(r.log), r.log);
    s.done();
  }
  { // a kept file that is not JSON
    const s = scenario(tool); s.failedRun(S1);
    fs.writeFileSync(path.join(s.cache, 'files', 'demo-xp.json'), '{"a":16');
    s.nextCheckout(); const r = s.restore();
    add('a kept file that is not JSON: not applied, nothing half replaced', r.out.applied === '0' && isS0(s.dir) && /not JSON/.test(r.log), r.log);
    s.done();
  }
  { // a rename that fails half way (the third target is in the way): the replaced files go back, a new one is removed again
    const s = scenario(tool); s.failedRun(S1);
    const m = JSON.parse(R(s.cache, 'meta.json'));
    m.files = ['demo-new.json', 'demo-processed.json', 'demo-zz.json']; m.blobs = { 'demo-new.json': null, 'demo-processed.json': m.blobs['demo-processed.json'], 'demo-zz.json': null };
    W(s.cache, 'meta.json', m); W(path.join(s.cache, 'files'), 'demo-new.json', { n: 1 }); W(path.join(s.cache, 'files'), 'demo-zz.json', { z: 1 });
    s.nextCheckout(); fs.mkdirSync(path.join(s.dir, 'demo-zz.json'));   // an empty directory: git does not see it, the rename fails on it
    const r = s.restore();
    const left = fs.readdirSync(s.dir).filter((f) => /state-stash-tmp$/.test(f));
    add('a rename failing half way: not applied, the replaced file back, the new one removed, no temp file left', r.out.applied === '0' && isS0(s.dir) && !fs.existsSync(path.join(s.dir, 'demo-new.json')) && left.length === 0 && /putting the checkout back/.test(r.log) && r.code === 0, r.log + ' left=' + left.join(','));
    s.done();
  }
  { // a foreign channel's copy (the cache key is per channel; the metadata says so too)
    const s = scenario(tool); s.failedRun(S1);
    const m = JSON.parse(R(s.cache, 'meta.json')); m.channel = 'playtest'; W(s.cache, 'meta.json', m);
    s.nextCheckout(); const r = s.restore();
    add('another channel\'s copy: not applied', r.out.applied === '0' && isS0(s.dir) && /channel playtest/.test(r.log), r.log);
    s.done();
  }
  { // pushed after a found copy -> the cleared marker; the next restore finds it and does nothing
    const s = scenario(tool); s.failedRun(S1);
    s.nextCheckout(); const r = s.restore();
    s.commit('demo-processed.json', S1.processed, 'state: demo (pushed)');
    const o = cli(s.dir, ['out', 'demo', 'success', r.out.found].concat(FILES), { STASH_BASE: r.env.STASH_BASE }, tool);
    const m = (() => { try { return JSON.parse(R(path.join(s.dir, '.state-stash'), 'meta.json')); } catch (e) { return null; } })();
    add('a push after a found copy caches the cleared marker (write=1)', o.out.write === '1' && m && m.cleared === true && m.channel === 'demo', o.log);
    fs.rmSync(s.cache, { recursive: true, force: true }); fs.cpSync(path.join(s.dir, '.state-stash'), s.cache, { recursive: true });
    s.nextCheckout(); const r2 = s.restore();
    add('the next restore finds the marker: found=tomb, nothing applied', r2.out.found === 'tomb' && r2.out.applied === '0', r2.log);
    const o2 = cli(s.dir, ['out', 'demo', 'success', r2.out.found].concat(FILES), { STASH_BASE: r2.env.STASH_BASE }, tool);
    add('a push after the marker caches nothing (write=0)', o2.out.write === '0');
    const o3 = cli(s.dir, ['out', 'demo', 'success', 'none'].concat(FILES), { STASH_BASE: r2.env.STASH_BASE }, tool);
    add('a push with nothing found caches nothing (write=0)', o3.out.write === '0');
    s.done();
  }
  { // out without a recorded base keeps nothing (a copy the next run could never check)
    const s = scenario(tool);
    const o = cli(s.dir, ['out', 'demo', 'failure', 'none'].concat(FILES), { STASH_BASE: null }, tool);
    add('a failed push without STASH_BASE keeps nothing (write=0, warned)', o.out.write === '0' && /no base commit recorded/.test(o.log), o.log);
    s.done();
  }
  { // two failures in a row: the second run applied the first copy, its own push fails -> its copy names the same blobs
    const s = scenario(tool); s.failedRun(S1);
    s.commit('pt-xp.json', { z: 3 }, 'state: playtest');   // the branch tip moved (another channel)
    s.nextCheckout();
    const S2 = { processed: ['m1', 'm2', 'm3'], xp: { a: 200 } };
    const f2 = s.failedRun(S2);
    add('second failure: the run started from the first copy', f2.r1.out.applied === '1', f2.r1.log);
    s.nextCheckout(); const r = s.restore();
    add('the third run gets the newest state (both runs\' settles kept)', r.out.applied === '1' && R(s.dir, 'demo-processed.json') === J(S2.processed) && R(s.dir, 'demo-xp.json') === J(S2.xp), r.log);
    s.done();
  }
  return res;
}
for (const [label, pass, detail] of cases(TOOL)) T('[2] ' + label, pass, detail);

// ---- [3] the 11-04 shape over the real validate.js ----
{
  const A = H.SID(6891), B = H.SID(6892), MIN = 60000;
  const ros = [A, B], hash = 0x68901, sc = [6000, 3000];
  const St = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc) }));
  const Rs = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat + 1, seat === 0, ros, sc) }));
  const boards = (xp, recs) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: Object.keys(xp).map((s) => ({ steamID: s, score: xp[s] })) },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
  const xpAfter = (r, xp) => { const o = Object.assign({}, xp); for (const s of ros) { const p = H.postsOf(r, 5, s); if (p.length) o[s] = p[p.length - 1].score; } return o; };
  // runs before the settle (the starts are seen first), then the settling run: its state = what the failed push held
  const xp0 = { [A]: 141, [B]: 500 };
  const r0 = H.runCron(boards(xp0, St), null, null, null, 'state-stash');
  const state0 = H.advance(r0.state, 5 * MIN);
  const r1 = H.runCron(boards(xp0, St.concat(Rs)), state0, null, null, 'state-stash');
  const xp1 = xpAfter(r1, xp0);
  T('[3] run N settles the match: A\'s XP row moves (' + xp0[A] + ' -> ' + xp1[A] + ')', r1.code === 0 && xp1[A] > xp0[A] && xp1[B] > xp0[B], r1.out.slice(-400));
  // the git layer between run N and run N+1: branch = state0 (C0), run N's state = r1.state, its push fails
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'state-stash-e2e-'));
  const dir = path.join(root, 'repo'); fs.mkdirSync(dir); gitIn(dir, ['init', '-q']);
  const names = Object.keys(r1.state).sort();
  const fname = (k) => 'demo-' + k.toLowerCase().replace(/_file$/, '').replace(/_/g, '-') + '.json';
  for (const k of names) if (state0[k] !== undefined) W(dir, fname(k), state0[k]);
  W(dir, 'validate.js', '// code'); gitIn(dir, ['add', '-A']); gitIn(dir, ['commit', '-q', '-m', 'S0']);
  const rr = cli(dir, ['restore', 'demo']);
  for (const k of names) W(dir, fname(k), r1.state[k]);
  const out = cli(dir, ['out', 'demo', 'failure', rr.out.found].concat(names.map(fname)), { STASH_BASE: rr.env.STASH_BASE });
  T('[3] run N\'s failed push keeps its ' + names.length + ' state files', out.out.write === '1', out.log);
  const cache = path.join(root, 'cache'); fs.cpSync(path.join(dir, '.state-stash'), cache, { recursive: true });
  gitIn(dir, ['checkout', '-q', '-f', 'HEAD']); gitIn(dir, ['clean', '-qfdx']); fs.cpSync(cache, path.join(dir, '.state-stash'), { recursive: true });
  const back = cli(dir, ['restore', 'demo']);
  const stateK = {};
  for (const k of names) { const c = R(dir, fname(k)); if (c != null) stateK[k] = JSON.parse(c); }
  const sameState = names.every((k) => J(stateK[k]) === J(r1.state[k])) && Object.keys(stateK).length === names.length;
  T('[3] run N+1 restores run N\'s state', back.out.applied === '1' && sameState, back.log);
  fs.rmSync(root, { recursive: true, force: true });
  // run N+1, five minutes later, the boards as run N left them: from the kept state vs from the branch state (the code before)
  const kept = H.runCron(boards(xp1, St.concat(Rs)), H.advance(stateK, 5 * MIN), null, null, 'state-stash');
  const old = H.runCron(boards(xp1, St.concat(Rs)), H.advance(r0.state, 10 * MIN), null, null, 'state-stash');
  const xpKept = xpAfter(kept, xp1), xpOld = xpAfter(old, xp1);
  T('[3] from the kept state: the match is not paid again (A ' + xpKept[A] + ', B ' + xpKept[B] + ')', kept.code === 0 && xpKept[A] === xp1[A] && xpKept[B] === xp1[B], J(xpKept));
  T('[3] mutant = no kept state (the code before): paid twice (A ' + xp1[A] + ' -> ' + xpOld[A] + ', the 141 -> 164 -> 187 shape)',
    old.code === 0 && xpOld[A] - xp1[A] === xp1[A] - xp0[A] && xpOld[B] - xp1[B] === xp1[B] - xp0[B], J(xpOld));
}

// ---- [4] mutants: each guard of decide() (and the half-done rollback) removed -> a case of [2] goes red ----
{
  const SRC = fs.readFileSync(TOOL, 'utf8');
  const MUT = [
    ['the branch-moved check', "if (ctx.touched && ctx.touched.length) return", 'if (false) return', /commit of this channel|revert to the same bytes/],
    ['the modified-checkout check', "if (ctx.dirty && ctx.dirty.length) return", 'if (false) return', /modified checkout/],
    ['the JSON check', "try { JSON.parse(c); } catch (e) { return { apply: false, why: 'kept file not JSON: ' + f }; }", '', /not JSON/],
    ['the channel check', "if (meta.channel !== channel) return 'copy of channel ' + meta.channel;", '', /another channel/],
    ['the rollback of a new file', "for (const f of fresh) fs.rmSync(f, { force: true });", '', /rename failing half way/],
  ];
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-stash-mut-'));
  try {
    for (const [name, from, to, expectRed] of MUT) {
      T('[4] mutant site present: ' + name, SRC.indexOf(from) >= 0);
      const f = path.join(tdir, 'tools'); fs.mkdirSync(f, { recursive: true });
      const mt = path.join(f, 'state-stash.js'); fs.writeFileSync(mt, SRC.replace(from, to));
      const red = cases(mt).filter(([, pass]) => !pass).map(([l]) => l);
      T('[4] mutant (' + name + ' removed) is caught by [2]: ' + red.join(' | '), red.length > 0 && red.every((l) => expectRed.test(l)), J(red));
    }
  } finally { fs.rmSync(tdir, { recursive: true, force: true }); }
}

console.log(failN ? '\n' + failN + ' FAIL' : '\nall ok');
process.exit(failN ? 1 : 0);
