'use strict';
// O1018 (2026-11-24): tools/fallback-guard.js + its validate.yml step. A fallback (GitLab tier 2 branch `fallback-state` / Cloud Run
// tier 3 bucket) newer than this branch's last state commit was never handed back -> the run must not settle (it would apply
// those matches' points / XP / CP a second time); older = a leftover, warned; unreadable = settle as usual (fail-open).
//   [1] decide(): the verdict table
//   [2] stateFilesOf(): the real validate.yml persist list
//   [3] the command line end to end: a throwaway repo (copy of the tool + a workflow + state commits at set times), a bare
//       "mirror" repo with / without a fallback-state branch, a local status page -- exit 1 only for a pending fallback
//   [4] the validate.yml step: name, place (after the tests, before kept state / run), the yield gate, env, no continue-on-error,
//       a step timeout above the tool's own network timeouts
//   [5] mutation proof: the newer-than check removed / handedBack ignored / the step moved after the run -> caught
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http'), Module = require('module');

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'fallback-guard.js');
const G = require(TOOL);
const H = 3600000;

(async () => {
  // ---- [1] decide ----
  {
    const M = 1795400000000;
    const d = (o) => G.decide(Object.assign({ mainTs: M, gl: null, vault: null }, o));
    T('[1a] nothing anywhere -> settle', !d({}).block && d({}).current.length === 0 && d({}).unreadable.length === 0);
    T('[1b] mirror branch newer than the last state commit -> block, named', d({ gl: { sha: 'a'.repeat(40), ts: M + H } }).block && /aaaaaaaaaaaa/.test(d({ gl: { sha: 'a'.repeat(40), ts: M + H } }).current[0]));
    T('[1c] mirror branch older -> leftover, settle', !d({ gl: { sha: 'b'.repeat(40), ts: M - H } }).block && d({ gl: { sha: 'b'.repeat(40), ts: M - H } }).leftovers.length === 1);
    T('[1d] tier-3 bucket fallback newer, not handed back -> block', d({ vault: { ts: M + 60000, handedBack: false, head: 'h' } }).block);
    T('[1e] tier-3 bucket fallback handed back -> settle, not even a leftover', !d({ vault: { ts: M + H, handedBack: true } }).block && d({ vault: { ts: M + H, handedBack: true } }).leftovers.length === 0);
    T('[1f] tier-3 bucket fallback older -> leftover', !d({ vault: { ts: M - H, handedBack: false } }).block && d({ vault: { ts: M - H } }).leftovers.length === 1);
    T('[1g] unreadable mirror / status -> settle, listed as unreadable (fail-open)', (() => { const x = d({ gl: { error: 'x' }, vault: { error: 'y' } }); return !x.block && x.unreadable.length === 2; })());
    T('[1h] no state commit on this branch -> cannot compare -> settle, unreadable', (() => { const x = d({ mainTs: null, gl: { sha: 'c'.repeat(40), ts: M + H } }); return !x.block && x.unreadable.length >= 1; })());
    T('[1i] same second as the last state commit -> not newer -> settle (a handback commit is made after the fallback one)', !d({ gl: { sha: 'd'.repeat(40), ts: M } }).block);
    T('[1j] one source pending is enough (the other unreadable)', d({ gl: { error: 'x' }, vault: { ts: M + 1000, handedBack: false } }).block);
  }

  // ---- [2] the real persist list ----
  {
    const files = G.stateFilesOf(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8'));
    T('[2a] validate.yml persist list read: processed.json / skill.json / xp.json among >= 10', files.length >= 10 && ['processed.json', 'skill.json', 'xp.json'].every((f) => files.includes(f)), files.join(' '));
  }

  // ---- [3] the command line end to end ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbguard-test-'));
  const git = (cwd, args, env) => { const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }, env || {}) }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout.trim(); };
  const at = (sec) => ({ GIT_AUTHOR_DATE: sec + ' +0000', GIT_COMMITTER_DATE: sec + ' +0000' });
  const T0 = 1795400000;   // the branch's last state commit
  const repo = path.join(tmp, 'repo'), mirror = path.join(tmp, 'mirror.git');
  let status = { fallback: null };
  const srv = http.createServer((req, res) => { const b = JSON.stringify(status); res.writeHead(200, { 'content-type': 'application/json' }); res.end(b); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const VAULT = 'http://127.0.0.1:' + srv.address().port;
  try {
    fs.mkdirSync(path.join(repo, 'tools'), { recursive: true }); fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
    fs.copyFileSync(TOOL, path.join(repo, 'tools', 'fallback-guard.js'));
    fs.writeFileSync(path.join(repo, '.github', 'workflows', 'validate.yml'), 'jobs:\n  x:\n    steps:\n      - name: persist\n        run: |\n          for f in processed.json skill.json; do\n            [ -f "$f" ] && echo "$f"\n          done\n');
    git(tmp, ['init', '-q', '-b', 'main', repo]);
    for (const k of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) git(repo, ['config', k[0], k[1]]);
    git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'code'], at(T0 - 7200));
    fs.writeFileSync(path.join(repo, 'processed.json'), '[1]'); git(repo, ['add', 'processed.json']); git(repo, ['commit', '-q', '-m', 'state: update reconciliation state'], at(T0));
    fs.writeFileSync(path.join(repo, 'README.md'), 'later code commit, not state'); git(repo, ['add', 'README.md']); git(repo, ['commit', '-q', '-m', 'docs'], at(T0 + 600));
    git(tmp, ['clone', '-q', '--bare', repo, mirror]);
    // async: the status page is served from THIS process -- a spawnSync would block its event loop and the tool would time out
    const run = (env) => new Promise((resolve) => { const ch = cp.spawn(process.execPath, [path.join(repo, 'tools', 'fallback-guard.js')], { cwd: repo, env: Object.assign({}, process.env, { MIRROR_URL: mirror, MIRROR_SSH_KEY: '', MIRROR_KNOWN_HOSTS: '', VAULT_URL: VAULT }, env || {}) }); let out = '', err = ''; ch.stdout.on('data', (c) => { out += c; }); ch.stderr.on('data', (c) => { err += c; }); ch.on('close', (code) => resolve({ status: code, stdout: out, stderr: err })); });
    // a fallback-state branch on the mirror at a given time (branched off main, like tier 2)
    const work = path.join(tmp, 'work');
    git(tmp, ['clone', '-q', mirror, work]);
    for (const k of [['user.name', 'fb'], ['user.email', 'fb@fb'], ['commit.gpgsign', 'false']]) git(work, ['config', k[0], k[1]]);
    const pushFallback = (sec) => { git(work, ['checkout', '-q', '-B', 'fallback-state', 'origin/main']); fs.writeFileSync(path.join(work, 'processed.json'), '[1,2,' + sec + ']'); git(work, ['commit', '-q', '-am', 'state: fallback reconciliation'], at(sec)); git(work, ['push', '-q', '-f', 'origin', 'fallback-state']); };
    const dropFallback = () => git(work, ['push', '-q', 'origin', '--delete', 'fallback-state']);

    let r = await run();
    T('[3a] no branch, no tier-3 fallback -> exit 0, "nothing pending"', r.status === 0 && /nothing pending/.test(r.stdout), r.stdout + r.stderr);
    T('[3b] the baseline is the last STATE commit, not the later docs commit', r.stdout.includes('last state commit ' + new Date(T0 * 1000).toISOString()), r.stdout);
    pushFallback(T0 + 3600);
    r = await run();
    T('[3c] mirror fallback-state newer -> exit 1 + ::error:: naming the branch', r.status === 1 && /::error::fallback guard: fallback state that was never handed back: mirror fallback-state @/.test(r.stdout), r.stdout + r.stderr);
    T('[3d] the probe leaves no ref behind in the checkout', !git(repo, ['for-each-ref', 'refs/fallback-guard']).length);
    pushFallback(T0 - 3600);
    r = await run();
    T('[3e] mirror fallback-state older (leftover) -> exit 0 + leftover warning', r.status === 0 && /::warning::fallback guard: leftover from an earlier incident/.test(r.stdout), r.stdout + r.stderr);
    dropFallback();
    status = { fallback: { ts: (T0 + 120) * 1000, at: 'x', handedBack: false, head: 'f'.repeat(40) } };
    r = await run();
    T('[3f] tier-3 bucket fallback newer, not handed back -> exit 1', r.status === 1 && /tier-3 bucket fallback head ffffffffffff/.test(r.stdout), r.stdout + r.stderr);
    status = { fallback: { ts: (T0 + 120) * 1000, handedBack: true } };
    r = await run();
    T('[3g] tier-3 handed back -> exit 0', r.status === 0 && /tier 3 handed back/.test(r.stdout), r.stdout + r.stderr);
    status = { other: 1 };
    r = await run({ MIRROR_URL: path.join(tmp, 'nope.git') });
    T('[3h] mirror unreachable + status page without the field -> exit 0 with two warnings (fail-open)', r.status === 0 && (r.stdout.match(/::warning::fallback guard: .*not checked/g) || []).length === 2, r.stdout + r.stderr);
    r = await run({ MIRROR_URL: '', VAULT_URL: '' });
    T('[3i] secrets unset -> exit 0 (warned)', r.status === 0 && /MIRROR_URL unset/.test(r.stdout) && /VAULT_URL unset/.test(r.stdout), r.stdout);
  } finally { srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {} }

  // ---- [4] the validate.yml step ----
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
  const stepCheck = (src) => {
    const i = src.indexOf('\n      - name: fallback guard\n'); if (i < 0) return 'no fallback guard step';
    const end = src.indexOf('\n      - ', i + 1), step = src.slice(i, end < 0 ? undefined : end);
    const pos = (n) => src.indexOf('\n      - name: ' + n + '\n');
    if (!(pos('remember the pass') >= 0 && pos('remember the pass') < i)) return 'not after the test steps';
    if (!(pos('kept state') > i && pos('run') > i)) return 'not before kept state / run';
    if (!/\n        if: steps\.gate\.outputs\.yield != 'true'\n/.test(step)) return 'no yield gate condition (or an always())';
    if (/continue-on-error/.test(step)) return 'continue-on-error would let the run settle anyway';
    for (const k of ['MIRROR_URL', 'MIRROR_SSH_KEY', 'MIRROR_KNOWN_HOSTS', 'VAULT_URL']) if (!new RegExp('\\n          ' + k + ': \\$\\{\\{ secrets\\.' + k + ' \\}\\}').test(step)) return 'env ' + k + ' missing';
    if (!/\n        run: node tools\/fallback-guard\.js\n?/.test(step + '\n')) return 'does not run the tool';
    const tm = Number((step.match(/\n        timeout-minutes: (\d+)/) || [])[1]);
    if (!(tm * 60 > 30 + 90 + 15)) return 'step timeout not above the tool\'s own network timeouts (a timeout would block the settlement)';
    // the run step stays skipped after a failed guard: no always() on it
    const rs = src.slice(pos('run'), src.indexOf('\n      - name: ', pos('run') + 1));
    if (/always\(\)/.test(rs.split('\n').slice(0, 8).join('\n'))) return 'run step has always() -- a failed guard would not stop it';
    return null;
  };
  T('[4a] validate.yml: fallback guard step after the tests, before kept state / run, gated, env, no continue-on-error, timeout', stepCheck(wf) === null, stepCheck(wf));
  const src = fs.readFileSync(TOOL, 'utf8');
  T('[4b] the tool exits 0 on its own crash (fail-open) and 1 only from the block branch', /process\.exit\(0\); \}\);\s*$/.test(src) && /if \(v\.block\) \{[\s\S]*?return 1;/.test(src));

  // ---- [5] mutation proof ----
  const load = (s) => { const m = new Module(TOOL, module); m.filename = TOOL; m.paths = Module._nodeModulePaths(path.dirname(TOOL)); m._compile(s, TOOL); return m.exports; };
  const M = 1795400000000;
  {
    const cut = "(ts > mainTs ? out.current : out.leftovers)";
    const X = load(src.replace(cut, '(false ? out.current : out.leftovers)'));
    T('[5a] (mutation) the newer-than check removed -> a pending mirror fallback no longer blocks', src.includes(cut) && !X.decide({ mainTs: M, gl: { sha: 'a', ts: M + H }, vault: null }).block);
    const cut2 = "else if (vault && !vault.handedBack)";
    const Y = load(src.replace(cut2, 'else if (vault)'));
    T('[5b] (mutation) handedBack ignored -> a handed-back tier-3 fallback would block forever', src.includes(cut2) && Y.decide({ mainTs: M, gl: null, vault: { ts: M + H, handedBack: true } }).block);
    const moved = wf.replace(/\n      - name: fallback guard\n[\s\S]*?(?=\n      # O689: a run whose state push failed)/, '');
    const withAfter = moved.replace('\n      - name: persist\n', wf.match(/\n      - name: fallback guard\n[\s\S]*?run: node tools\/fallback-guard\.js/)[0] + '\n      - name: persist\n');
    T('[5c] (mutation) the step moved after the run -> caught', stepCheck(withAfter) !== null && stepCheck(moved) !== null);
    T('[5d] (mutation) continue-on-error added -> caught', stepCheck(wf.replace("      - name: fallback guard\n        if: steps.gate.outputs.yield != 'true'\n", "      - name: fallback guard\n        if: steps.gate.outputs.yield != 'true'\n        continue-on-error: true\n")) !== null);
  }

  console.log(failN ? '[fallback-guard] ' + failN + ' FAIL' : '[fallback-guard] all green');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
