'use strict';
// O463: the reconcile skips its test step when this exact code already passed (Actions cache keyed by tools/code-hash.js),
//   and retests run through tools/run-tests.js. Pins: what the fingerprint covers (code yes, state no), that every root
//   json is classified on purpose, the validate.yml wiring (a red test step can never lead to a settle, a pass is only
//   remembered after green), the nightly audit's real-date run, and the runner's red / green / timeout behaviour.
//   No clock or machine-speed dependence (the timeout case allows seconds of slack).
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
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (code-hash)');
process.exit(failN ? 1 : 0);
