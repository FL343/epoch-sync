'use strict';
// O463: the reconcile skips its test step when this exact code already passed (Actions cache keyed by tools/code-hash.js),
//   and retests run through tools/run-tests.js. Pins: what the fingerprint covers (code yes, state no), that every root
//   json is classified on purpose, the validate.yml wiring (a red test step can never lead to a settle, a pass is only
//   remembered after green), the nightly audit's real-date run, and the runner's red / green / timeout behaviour.
//   Q362 (2026-11-02): per-file progress across runs (.tests-progress keyed by the same fingerprint, saved even when the
//   step did not finish, the test step's own timeout under the job's, a budget only on runs that resume) + the runner's
//   --done-file / --budget-min, and a simulation that a suite longer than one run still converges.
//   No clock or machine-speed dependence (the timeout / budget cases allow seconds of slack).
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const H = require(path.join(__dirname, '..', 'tools', 'code-hash.js'));

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, '.github', 'workflows');
let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

console.log('-- state / config classification --');
const state = H.stateFiles(ROOT);
{
  for (const f of ['processed.json', 'starts.json', 'demo-starts.json', 'pt-starts.json', 'seedcap.json', 'demo-seedcap.json', 'feedback.json', 'feedback-demo.json', 'sanctions.json', 'demo-sanctions.json', 'campaign-endless.json', '.heartbeat']) {
    T('state (written back by a workflow): ' + f, state.has(f));
  }
  for (const f of ['validate.js', 'attest-keys.json', 'gr-caps.json']) T('not state: ' + f, !state.has(f));
  const rootJson = H.lsFiles(ROOT).split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter((p) => /^[^/]+\.json$/.test(p));
  T('tracked root json found', rootJson.length > 20, String(rootJson.length));
  const neither = rootJson.filter((p) => !state.has(p) && !H.CONFIG_JSON.includes(p));
  const both = rootJson.filter((p) => state.has(p) && H.CONFIG_JSON.includes(p));
  T('every root json is state (a workflow writes it back) or CONFIG_JSON -- classify a new one in tools/code-hash.js', neither.length === 0, neither.join(' '));
  T('no root json is both state and CONFIG_JSON', both.length === 0, both.join(' '));
}

console.log('-- fingerprint covers code, not state --');
{
  const ls = (o) => ['100644 ' + (o.v || 'a1') + ' 0\tvalidate.js', '100644 ' + (o.p || 'b1') + ' 0\tprocessed.json', '100644 ' + (o.k || 'c1') + ' 0\tattest-keys.json',
    '100644 d1 0\ttest/x.js'].concat(o.extra || []).join('\n') + '\n';
  const st = new Set(['processed.json']);
  const base = H.codeHash(ls({}), st, 'v24.0.0');
  T('hex, 40 chars', /^[0-9a-f]{40}$/.test(base), base);
  T('same input -> same fingerprint', H.codeHash(ls({}), st, 'v24.0.0') === base);
  T('a state file changes (every tick) -> same fingerprint', H.codeHash(ls({ p: 'b2' }), st, 'v24.0.0') === base);
  T('validate.js changes -> new fingerprint', H.codeHash(ls({ v: 'a2' }), st, 'v24.0.0') !== base);
  T('a config json changes -> new fingerprint', H.codeHash(ls({ k: 'c2' }), st, 'v24.0.0') !== base);
  T('a test file is added -> new fingerprint', H.codeHash(ls({ extra: ['100644 e1 0\ttest/y.js'] }), st, 'v24.0.0') !== base);
  T('another node version -> new fingerprint', H.codeHash(ls({}), st, 'v24.1.0') !== base);
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'code-hash.js')], { cwd: ROOT, encoding: 'utf8' });
  T('CLI prints one fingerprint and exits 0', r.status === 0 && /^[0-9a-f]{40}\n$/.test(r.stdout), (r.stderr || '').slice(0, 200));
}

console.log('-- validate.yml wiring --');
{
  const src = fs.readFileSync(path.join(WF, 'validate.yml'), 'utf8');
  const steps = src.split(/\n(?=      - (?:name|uses): )/);
  const find = (re) => steps.findIndex((s) => re.test(s));
  const iCode = find(/- name: code hash\n/), iPassed = find(/- name: tests passed before\?\n/), iTest = find(/- name: test\n/);
  const iSave = find(/- name: remember the pass\n/), iRun = find(/- name: run\n/);
  T('steps in order: code hash < tests passed before? < test < remember the pass < run', iCode > 0 && iCode < iPassed && iPassed < iTest && iTest < iSave && iSave < iRun, [iCode, iPassed, iTest, iSave, iRun].join(','));
  const s = (i) => steps[i] || '';
  T('code hash: key from tools/code-hash.js, unique fallback key when hashing fails', /node tools\/code-hash\.js/.test(s(iCode)) && /key=tests-pass-\$\{k:-unhashed-\$GITHUB_RUN_ID\}/.test(s(iCode)));
  T('lookup: actions/cache/restore pinned by sha, lookup-only, same key, a cache outage cannot fail the job',
    /uses: actions\/cache\/restore@[0-9a-f]{40} /.test(s(iPassed)) && /lookup-only: true/.test(s(iPassed)) && /key: \$\{\{ steps\.code\.outputs\.key \}\}/.test(s(iPassed)) && /continue-on-error: true/.test(s(iPassed)));
  T('test step skipped only on a cache hit (and the gate)', /if: steps\.gate\.outputs\.yield != 'true' && steps\.passed\.outputs\.cache-hit != 'true'/.test(s(iTest)));
  T('test step runs the whole suite through tools/run-tests.js; the pass marker only after it', /node tools\/run-tests\.js [^\n]*test\/\*\.js \|\| exit 1\n[\s\S]*echo "::\$t::"\n\s*date -u [^\n]*> \.tests-passed/.test(s(iTest)));
  T('remember: actions/cache/save pinned by sha, same key, skipped on a hit',
    /uses: actions\/cache\/save@[0-9a-f]{40} /.test(s(iSave)) && /key: \$\{\{ steps\.code\.outputs\.key \}\}/.test(s(iSave)) && /steps\.passed\.outputs\.cache-hit != 'true'/.test(s(iSave)));
  const saveIf = (s(iSave).match(/\n\s+if: ([^\n]+)/) || [])[1] || '';
  const runIf = (s(iRun).match(/\n\s+if: ([^\n]+)/) || [])[1] || '';
  const STATUS = /\b(always|failure|cancelled|success)\(\)/;
  T('remember runs only after a green test step (no status function = success() implied)', !!saveIf && !STATUS.test(saveIf), saveIf);
  T('run (settlement) is skipped when the test step is red (no status function in its if)', !!runIf && !STATUS.test(runIf), runIf);
  const restoreSha = (s(iPassed).match(/actions\/cache\/restore@([0-9a-f]{40})/) || [])[1];
  const saveSha = (s(iSave).match(/actions\/cache\/save@([0-9a-f]{40})/) || [])[1];
  T('restore and save pinned to the same actions/cache commit', !!restoreSha && restoreSha === saveSha);
  T('the pass marker is never committed (persist adds named state files only)', !/git add [^\n]*\.tests-passed|git add -A|git add \.(\s|$)/.test(src));

  // Q362: progress per file across runs, so a suite longer than one run cannot hold settlement forever
  const iPart = find(/- name: tests partly passed before\?\n/), iPSave = find(/- name: remember partial progress\n/);
  T('Q362 steps in order: tests passed before? < tests partly passed before? < test < remember partial progress < remember the pass',
    iPassed < iPart && iPart < iTest && iTest < iPSave && iPSave < iSave, [iPassed, iPart, iTest, iPSave, iSave].join(','));
  T('Q362 code hash: the progress prefix carries the same fingerprint (and the same unique fallback when hashing fails)',
    /part=tests-part-\$\{k:-unhashed-\$GITHUB_RUN_ID\}/.test(s(iCode)));
  T('Q362 progress restore: same pinned actions/cache commit, .tests-progress, newest entry for this fingerprint by prefix, cannot fail the job, skipped on a full hit',
    (s(iPart).match(/actions\/cache\/restore@([0-9a-f]{40})/) || [])[1] === restoreSha && /path: \.tests-progress\n/.test(s(iPart)) &&
    /key: \$\{\{ steps\.code\.outputs\.part \}\}-\$\{\{ github\.run_id \}\}\n/.test(s(iPart)) && /restore-keys: \$\{\{ steps\.code\.outputs\.part \}\}-(\n|$)/.test(s(iPart)) &&
    /continue-on-error: true/.test(s(iPart)) && /if: steps\.gate\.outputs\.yield != 'true' && steps\.passed\.outputs\.cache-hit != 'true'/.test(s(iPart)) && !/lookup-only/.test(s(iPart)));
  const jobMin = +((src.match(/\n  reconcile:\n[\s\S]*?\n    timeout-minutes: (\d+)/) || [])[1] || 0);
  const stepMin = +((s(iTest).match(/\n        timeout-minutes: (\d+)/) || [])[1] || 0);
  T('Q362 test step has its own timeout, at least 2 min under the job\'s (so the progress save still runs)', stepMin > 0 && jobMin > 0 && stepMin <= jobMin - 2, stepMin + ' / ' + jobMin);
  T('Q362 test step keeps per-file progress in .tests-progress', /node tools\/run-tests\.js [^\n]*--done-file=\.tests-progress [^\n]*test\/\*\.js \|\| exit 1/.test(s(iTest)));
  const budgetMin = +((s(iTest).match(/--budget-min=(\d+(?:\.\d+)?)/) || [])[1] || 0);
  T('Q362 budget only on a run that resumes earlier progress (matched key), and under the step timeout',
    /PART_FROM: \$\{\{ steps\.part\.outputs\.cache-matched-key \}\}/.test(s(iTest)) && /\[ -n "\$PART_FROM" \] && budget="--budget-min=/.test(s(iTest)) &&
    /node tools\/run-tests\.js [^\n]*\$budget /.test(s(iTest)) && budgetMin > 0 && budgetMin < stepMin, budgetMin + ' / ' + stepMin);
  const pIf = (s(iPSave).match(/\n\s+if: ([^\n]+)/) || [])[1] || '';
  T('Q362 progress save: always (red file / budget / step timeout), only when the test step ran and did not pass, skipped on a full hit',
    /^always\(\) && /.test(pIf) && /steps\.gate\.outputs\.yield != 'true'/.test(pIf) && /steps\.passed\.outputs\.cache-hit != 'true'/.test(pIf) &&
    /steps\.test\.outcome != 'success'/.test(pIf) && /steps\.test\.outcome != 'skipped'/.test(pIf) && /\n        id: test\n/.test(s(iTest)), pIf);
  T('Q362 progress save: same pinned commit, .tests-progress, a key of its own per run under the fingerprint prefix, cannot fail the job',
    (s(iPSave).match(/actions\/cache\/save@([0-9a-f]{40})/) || [])[1] === saveSha && /path: \.tests-progress\n/.test(s(iPSave)) &&
    /key: \$\{\{ steps\.code\.outputs\.part \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}(\n|$)/.test(s(iPSave)) && /continue-on-error: true/.test(s(iPSave)));
  T('Q362 the progress file is never committed either', !/git add [^\n]*\.tests-progress/.test(src));
  T('Q362 the full pass marker still only after the whole suite exited 0 (progress alone never settles)',
    /--done-file=\.tests-progress [^\n]*test\/\*\.js \|\| exit 1\n[\s\S]*echo "::\$t::"\n\s*date -u [^\n]*> \.tests-passed/.test(s(iTest)) && !/\.tests-passed/.test(s(iPSave)) && !/\.tests-progress/.test(s(iSave)));
}

console.log('-- nightly audit reruns the suite on the real date --');
{
  const src = fs.readFileSync(path.join(WF, 'audit.yml'), 'utf8');
  const m = src.match(/- name: test\n([\s\S]*)$/);
  T('audit.yml has a test step', !!m);
  T('it runs after a red audit too (if: always()) and runs the whole suite', !!m && /if: always\(\)/.test(m[1]) && /node tools\/run-tests\.js [^\n]*test\/\*\.js \|\| exit 1/.test(m[1]));
  T('no clock pinned there (SEASON_NOW / TZ / FAKE_NOW): the point is today\'s date', !!m && !/SEASON_NOW|FAKE_NOW|\bTZ:/.test(m[1]));
}

console.log('-- tools/run-tests.js --');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-'));
  try {
    const w = (n, body) => { const p = path.join(dir, n); fs.writeFileSync(p, body); return p; };
    const a = w('a.js', "console.log('alpha out');");
    const b = w('b.js', "console.log('beta out'); process.exit(3);");
    const c = w('c.js', "setTimeout(() => {}, 60000);");
    const run = (files, extra) => cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-tests.js')].concat(extra || [], files), { encoding: 'utf8', timeout: 90000 });
    let r = run([a, a, a], ['--jobs=2']);
    T('all green -> exit 0, one block per file', r.status === 0 && (r.stdout.match(/^== .*a\.js == \(/gm) || []).length === 3 && /3 file\(s\) green/.test(r.stdout), r.stdout.slice(-300));
    r = run([a, b, a], ['--jobs=3']);
    T('one red -> exit 1, the others still run, the red one is named with its exit code',
      r.status === 1 && (r.stdout.match(/alpha out/g) || []).length === 2 && /beta out/.test(r.stdout) && /RED .*b\.js: exit code 3/.test(r.stdout) && /1 of 3 file\(s\) red/.test(r.stdout), r.stdout.slice(-400));
    const t0 = Date.now();
    r = run([c, a], ['--jobs=2', '--timeout-min=0.05']);
    T('a hung file is killed at the per-file timeout and counted red', r.status === 1 && /RED .*c\.js: killed after/.test(r.stdout) && Date.now() - t0 < 45000, r.stdout.slice(-300));
    r = run([]);
    T('no files -> exit 2 (a glob that matched nothing is not a pass)', r.status === 2);

    // Q362: --done-file / --budget-min
    const doneF = path.join(dir, 'done.txt');
    const lines = () => { try { return fs.readFileSync(doneF, 'utf8').split('\n').filter(Boolean); } catch (e) { return null; } };
    const d = w('d.js', "console.log('delta out');");
    r = run([a, b, d], ['--jobs=2', '--done-file=' + doneF]);
    T('done-file missing -> created; passes appended, the red file is not', r.status === 1 && JSON.stringify((lines() || []).slice().sort()) === JSON.stringify([a, d].sort()), String(lines()) + ' / ' + r.stdout.slice(-200));
    r = run([a, b, d], ['--jobs=2', '--done-file=' + doneF]);
    T('next run: the passed files are skipped, only the red one runs again (still red, still exit 1)',
      r.status === 1 && !/alpha out|delta out/.test(r.stdout) && /beta out/.test(r.stdout) && /2 of 3 file\(s\) already passed for this code/.test(r.stdout) && lines().length === 2, r.stdout.slice(-300));
    fs.writeFileSync(doneF, a + '\n' + d + '\n');
    r = run([a, d], ['--jobs=2', '--done-file=' + doneF]);
    T('every file passed before -> exit 0 without running any', r.status === 0 && !/alpha out|delta out/.test(r.stdout) && /0 file\(s\) green/.test(r.stdout) && /2 more passed before/.test(r.stdout), r.stdout.slice(-300));
    fs.writeFileSync(doneF, '');
    const slow = [0, 1, 2, 3].map((i) => w('s' + i + '.js', "setTimeout(() => console.log('slow " + i + "'), 1500);"));
    const t1 = Date.now();
    r = run(slow, ['--jobs=1', '--budget-min=0.01', '--done-file=' + doneF]);
    T('budget: after it no new file starts, the running one finishes and is kept, exit 3 (not a pass)',
      r.status === 3 && /slow 0/.test(r.stdout) && !/slow 1/.test(r.stdout) && JSON.stringify(lines()) === JSON.stringify([slow[0]]) && /not started yet/.test(r.stdout) && Date.now() - t1 < 30000, r.stdout.slice(-300));
    let rounds = 1;
    while (r.status === 3 && rounds < 8) { r = run(slow, ['--jobs=1', '--budget-min=0.01', '--done-file=' + doneF]); rounds++; }
    T('budget: every run moves forward, the suite converges (exit 0) after about one run per file', r.status === 0 && rounds === 4 && lines().length === 4, rounds + ' runs, last exit ' + r.status);
    r = run([b, slow[0]], ['--jobs=1', '--budget-min=0.001', '--done-file=' + path.join(dir, 'done2.txt')]);
    T('a red file wins over a budget stop (exit 1, not 3)', r.status === 1 && /RED .*b\.js/.test(r.stdout), r.stdout.slice(-300));
    // Q362 review: the reconcile runs 4 at a time -- a file finishing past the budget while another still runs must not
    //   start a new one (with --jobs=1 every finish leaves nothing running, so the cases above cannot see this)
    const pdone = path.join(dir, 'done3.txt');
    const par = [w('p0.js', "setTimeout(() => console.log('par 0'), 3000);"), ...[1, 2, 3, 4].map((i) => w('p' + i + '.js', "setTimeout(() => console.log('par " + i + "'), 1000);"))];
    r = run(par, ['--jobs=2', '--budget-min=0.005', '--done-file=' + pdone]);
    const plines = (() => { try { return fs.readFileSync(pdone, 'utf8').split('\n').filter(Boolean); } catch (e) { return []; } })();
    T('budget with several at a time: a finish past the budget while another runs starts nothing new, exit 3',
      r.status === 3 && /par 0/.test(r.stdout) && /par 1/.test(r.stdout) && !/par [234]/.test(r.stdout) && JSON.stringify(plines.slice().sort()) === JSON.stringify([par[0], par[1]].sort()),
      r.status + ' / ' + String(plines) + ' / ' + r.stdout.slice(-300));
    r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'run-tests.js'), '--jobs=2', a, d], { encoding: 'utf8', timeout: 90000 });
    T('without --done-file nothing is written and nothing skipped (the nightly audit path)', r.status === 0 && (r.stdout.match(/alpha out|delta out/g) || []).length === 2 && !/already passed/.test(r.stdout));
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (code-hash)');
process.exit(failN ? 1 : 0);
