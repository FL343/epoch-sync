'use strict';
// O689 wiring: the three reconcile workflows keep a failed push's state for the next run (tools/state-stash.js; the tool itself
// is pinned by test/state-stash.js). What must hold in every one of validate.yml (channel reconcile) / playtest.yml / demo.yml:
//   [1] the job clock: JOB_T0 goes to $GITHUB_ENV before the checkout (demo / playtest: a `clock` step first; validate: the gate
//       step), so the push backoff can see how much of the job is left
//   [2] the restore: `kept state` (actions/cache/restore, path .state-stash, key state-stash-<ch>-<run id>, restore-keys
//       state-stash-<ch>-) then `apply kept state` (id stash, `node tools/state-stash.js restore <ch>`, continue-on-error),
//       right before the run step and after every test step; the run step is skipped on halt=1 only (and keeps the yield gate);
//       on validate both restore steps keep the yield gate too
//   [3] persist: writes the list of its state files to $RUNNER_TEMP/state-files before it commits; four tries; the backoff asks
//       the tool (`node tools/state-stash.js backoff "$n" || echo 5`); JOB_LIMIT_S = the job's timeout-minutes * 60, and the
//       reserve the tool leaves is less than the job's limit
//   [4] after persist: `keep state` (id keep) runs when persist failed or succeeded (never when it was skipped), continue-on-error,
//       `node tools/state-stash.js out <ch> "$PERSIST_OUTCOME" "$STASH_FOUND" $(cat "$RUNNER_TEMP/state-files" ...)` with
//       PERSIST_OUTCOME = steps.persist.outcome and STASH_FOUND = steps.stash.outputs.found; then `cache kept state`
//       (actions/cache/save, same pinned action as the restore, path .state-stash, key state-stash-<ch>-<run id>-<attempt>)
//       when keep wrote write=1
//   [5] channels: each workflow names one channel the tool knows, the three are different, and no key prefix is the prefix of
//       another channel's (a restore by prefix must never pick another channel's copy)
//   [6] demo / playtest: no step before the run step has an env block (test/channel-workflows.js reads the first env block of
//       the job as the run step's env -- a new block in front would make it compare the wrong keys)
//   [7] mutation proof: each rule above, broken in a copy of a real workflow, is caught
const fs = require('fs');
const path = require('path');
const S = require(path.join(__dirname, '..', 'tools', 'state-stash.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const WF = path.join(__dirname, '..', '.github', 'workflows');
const SPECS = [
  { file: 'validate.yml', job: 'reconcile', ch: 'reconcile', gated: true },
  { file: 'playtest.yml', job: 'playtest', ch: 'playtest', gated: false },
  { file: 'demo.yml', job: 'demo', ch: 'demo', gated: false },
];
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// one job's steps: [{ text, name, id, ifc, uses, run, env }] (6-space `- ` items under `steps:`)
function stepsOf(src, job) {
  const start = src.indexOf('\n  ' + job + ':\n');
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const nextJob = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const body = nextJob < 0 ? rest : rest.slice(0, nextJob + 1);
  const si = body.indexOf('\n    steps:\n');
  if (si < 0) return null;
  const parts = body.slice(si + 12).split(/\n(?=      - )/);
  return parts.filter((p) => /^      - /.test(p)).map((text) => {
    const f = (re) => { const m = re.exec(text); return m ? m[1].trim() : ''; };
    let run = f(/\n        run: ([^|\n][^\n]*)/) || f(/^      - run: ([^\n]*)/);
    const block = /\n        run: \|\n([\s\S]*)$/.exec(text);
    if (block) run = block[1];
    return { text, name: f(/^      - name: ([^\n]*)/), id: f(/\n        id: ([^\n]*)/), ifc: f(/\n        if: ([^\n]*)/), uses: f(/(?:^      - |\n        )uses: ([^\n]*)/),
      run, env: /\n        env:\n/.test(text), coe: /\n        continue-on-error: true\n/.test(text + '\n') };
  });
}
const jobTimeout = (src, job) => {
  const start = src.indexOf('\n  ' + job + ':\n');
  const m = /\n    timeout-minutes: (\d+)\n/.exec(src.slice(start));
  return m ? Number(m[1]) : NaN;
};

// one workflow source + its spec -> list of violations (strings); [] = wired as it must be
function check(src, spec) {
  const v = [];
  const st = stepsOf(src, spec.job);
  if (!st || !st.length) return ['no steps for job ' + spec.job];
  const idx = (name) => st.findIndex((s) => s.name === name);
  const at = (name) => st[idx(name)];
  const ch = spec.ch, gate = "steps.gate.outputs.yield != 'true'";
  const iCheckout = st.findIndex((s) => /^actions\/checkout@/.test(s.uses));
  const iRun = idx('run'), iPersist = idx('persist'), iKept = idx('kept state'), iApply = idx('apply kept state'), iKeep = idx('keep state'), iSave = idx('cache kept state');
  // [1]
  const clockAt = st.findIndex((s) => /echo "JOB_T0=\$\(date \+%s\)" >> "\$GITHUB_ENV"/.test(s.run));
  if (clockAt < 0) v.push('[1] JOB_T0 is not written to $GITHUB_ENV');
  else if (!(clockAt < iCheckout)) v.push('[1] JOB_T0 is written after the checkout');
  if (!spec.gated && clockAt !== 0) v.push('[1] the clock step is not the first step');
  if (spec.gated && clockAt >= 0 && st[clockAt].name !== 'gate') v.push('[1] JOB_T0 is not written by the gate step');
  // [2]
  if (iKept < 0 || iApply < 0) v.push('[2] restore steps missing');
  else {
    const k = st[iKept], a = st[iApply];
    if (!(iKept + 1 === iApply && iApply + 1 === iRun)) v.push('[2] kept state / apply kept state are not the two steps right before run');
    const lastTest = Math.max(...st.map((s, i) => (/^test$|^remember /.test(s.name) ? i : -1)));
    if (!(lastTest < iKept)) v.push('[2] the restore comes before a test step');
    if (!/^actions\/cache\/restore@[0-9a-f]{40} # v\S+$/.test(k.uses)) v.push('[2] kept state is not a pinned actions/cache/restore');
    if (!k.coe) v.push('[2] kept state without continue-on-error');
    if (!new RegExp('\\n          path: \\.state-stash\\n').test(k.text)) v.push('[2] kept state path is not .state-stash');
    if (!new RegExp('\\n          key: state-stash-' + esc(ch) + '-\\$\\{\\{ github\\.run_id \\}\\}\\n').test(k.text + '\n')) v.push('[2] kept state key is not state-stash-' + ch + '-<run id>');
    if (!new RegExp('\\n          restore-keys: state-stash-' + esc(ch) + '-\\n').test(k.text + '\n')) v.push('[2] kept state restore-keys is not state-stash-' + ch + '-');
    if (a.id !== 'stash') v.push('[2] apply kept state id is not stash');
    if (a.run !== 'node tools/state-stash.js restore ' + ch) v.push('[2] apply kept state does not run the tool for ' + ch + ' (' + a.run + ')');
    if (!a.coe) v.push('[2] apply kept state without continue-on-error (a crash of the tool would stop the settlement)');
    if (spec.gated) { if (k.ifc !== gate || a.ifc !== gate) v.push('[2] the restore steps do not keep the yield gate'); }
    else if (k.ifc || a.ifc) v.push('[2] the restore steps carry a condition');
  }
  if (iRun < 0) v.push('[2] no run step');
  else {
    const want = (spec.gated ? gate + ' && ' : '') + "steps.stash.outputs.halt != '1'";
    if (st[iRun].ifc !== want) v.push('[2] run step condition is not "' + want + '" (' + st[iRun].ifc + ')');
  }
  // [3]
  if (iPersist < 0) v.push('[3] no persist step');
  else {
    const p = st[iPersist];
    const limit = /\n          JOB_LIMIT_S: '(\d+)'\n/.exec(p.text);
    const jt = jobTimeout(src, spec.job);
    if (!limit) v.push('[3] persist has no JOB_LIMIT_S');
    else if (Number(limit[1]) !== jt * 60) v.push('[3] JOB_LIMIT_S ' + limit[1] + ' is not the job timeout ' + jt + ' min');
    if (!(S.RESERVE_S > 0 && S.RESERVE_S < jt * 60)) v.push('[3] the reserve does not fit the job');
    const iList = p.run.indexOf('printf \'%s\\n\' $state_files > "$RUNNER_TEMP/state-files"');
    const iFor = p.run.indexOf('for f in '), iCommit = p.run.indexOf('git commit');
    if (iList < 0) v.push('[3] persist does not write $RUNNER_TEMP/state-files');
    else if (!(iFor >= 0 && iFor < iList && iList < iCommit)) v.push('[3] the state-files list is not written between the file loop and the commit');
    if (!/\n\s*if \[ "\$n" -ge 4 \]; then [^\n]*state push failed after \$n tries[^\n]*; exit 1; fi\n/.test(p.run)) v.push('[3] the push loop does not stop after 4 tries');
    if (!/\n\s*sleep "\$\(node tools\/state-stash\.js backoff "\$n" \|\| echo 5\)"\n/.test(p.run)) v.push('[3] the push backoff does not ask the tool');
    if (/sleep \$\(\(5 \* n\)\)/.test(p.run)) v.push('[3] the old fixed backoff is still there');
  }
  // [4]
  if (iKeep < 0 || iSave < 0) v.push('[4] keep steps missing');
  else {
    const k = st[iKeep], c = st[iSave];
    if (!(iPersist + 1 === iKeep && iKeep + 1 === iSave)) v.push('[4] keep state / cache kept state are not the two steps right after persist');
    if (k.id !== 'keep') v.push('[4] keep state id is not keep');
    if (k.ifc !== "always() && (steps.persist.outcome == 'failure' || steps.persist.outcome == 'success')") v.push('[4] keep state condition (' + k.ifc + ')');
    if (!k.coe) v.push('[4] keep state without continue-on-error');
    if (!/\n          PERSIST_OUTCOME: \$\{\{ steps\.persist\.outcome \}\}\n/.test(k.text) || !/\n          STASH_FOUND: \$\{\{ steps\.stash\.outputs\.found \}\}\n/.test(k.text)) v.push('[4] keep state env');
    if (k.run !== 'node tools/state-stash.js out ' + ch + ' "$PERSIST_OUTCOME" "$STASH_FOUND" $(cat "$RUNNER_TEMP/state-files" 2>/dev/null)') v.push('[4] keep state command (' + k.run + ')');
    if (c.ifc !== "always() && steps.keep.outputs.write == '1'") v.push('[4] cache kept state condition (' + c.ifc + ')');
    if (!c.coe) v.push('[4] cache kept state without continue-on-error');
    const kept = iKept >= 0 ? st[iKept].uses.replace(/^actions\/cache\/restore@/, '') : '';
    if (c.uses !== 'actions/cache/save@' + kept) v.push('[4] cache kept state is not the save of the same pinned action as the restore');
    if (!/\n          path: \.state-stash\n/.test(c.text)) v.push('[4] cache kept state path');
    if (!new RegExp('\\n          key: state-stash-' + esc(ch) + '-\\$\\{\\{ github\\.run_id \\}\\}-\\$\\{\\{ github\\.run_attempt \\}\\}\\n').test(c.text + '\n')) v.push('[4] cache kept state key is not state-stash-' + ch + '-<run id>-<attempt>');
  }
  // [6]
  if (!spec.gated && iRun >= 0 && st.slice(0, iRun).some((s) => s.env)) v.push('[6] a step before run has an env block');
  return v;
}

// ---- [1]-[4], [6] the real workflows ----
const SRC = {};
for (const spec of SPECS) {
  let src = '';
  try { src = fs.readFileSync(path.join(WF, spec.file), 'utf8'); } catch (e) {}
  SRC[spec.file] = src;
  T(spec.file + ' readable', !!src);
  if (!src) continue;
  const v = check(src, spec);
  T(spec.file + ' (' + spec.ch + '): wired as pinned', v.length === 0, v.join(' | '));
}
// ---- [5] channels ----
{
  const chs = SPECS.map((s) => s.ch);
  T('[5] every channel is one the tool knows', chs.every((c) => S.CHANNELS.indexOf(c) >= 0), chs.join(','));
  T('[5] the three channels differ', new Set(chs).size === chs.length);
  const pre = chs.map((c) => 'state-stash-' + c + '-');
  T('[5] no key prefix is the prefix of another channel\'s', pre.every((a, i) => pre.every((b, j) => i === j || b.indexOf(a) !== 0)));
  T('[5] .state-stash is the tool\'s directory', S.DIR === '.state-stash');
}
// ---- [7] mutation proof ----
{
  const MUT = [
    ['validate.yml', 'the job clock dropped', (s) => s.replace(/\n {10}# O689: the job's start[^\n]*\n {10}echo "JOB_T0=[^\n]*/, ''), /\[1\]/],
    ['demo.yml', 'the clock moved after the checkout', (s) => s.replace(/(\n      # O689: the job's start[^\n]*\n      - name: clock\n        run: [^\n]*)(\n      - uses: actions\/checkout@[^\n]*\n        with:\n          #[^\n]*\n          #[^\n]*\n          #[^\n]*\n          ref: [^\n]*\n          fetch-depth: 0)/, '$2$1'), /\[1\]/],
    ['playtest.yml', 'the restore steps dropped', (s) => s.replace(/\n      - name: kept state\n[\s\S]*?(?=\n      - name: run\n)/, ''), /\[2\] restore steps missing/],
    ['demo.yml', 'the restore moved after the run', (s) => s.replace(/(\n      # O689: a run whose state push failed[\s\S]*?)(\n      - name: run\n[\s\S]*?\n        run: node validate\.js)/, '$2$1'), /\[2\]/],
    ['validate.yml', 'the restore before the tests', (s) => { const m = /\n      # O689: a run whose state push failed[\s\S]*?(?=\n      - name: run\n)/.exec(s); return s.replace(m[0], '').replace('\n      - name: test\n', m[0] + '\n      - name: test\n'); }, /\[2\]/],
    ['demo.yml', 'the restore key of another channel', (s) => s.replace('restore-keys: state-stash-demo-', 'restore-keys: state-stash-playtest-'), /restore-keys/],
    ['playtest.yml', 'the tool crash stops the run (no continue-on-error)', (s) => s.replace(/(\n        # a crash of the tool[^\n]*\n[^\n]*\n)        continue-on-error: true\n/, '$1'), /continue-on-error/],
    ['validate.yml', 'the restore without the yield gate', (s) => s.replace(/(\n      - name: apply kept state\n        id: stash\n)        if: [^\n]*\n/, '$1'), /yield gate/],
    ['demo.yml', 'the run ignores halt', (s) => s.replace("        if: steps.stash.outputs.halt != '1'\n", ''), /run step condition/],
    ['validate.yml', 'the run loses the yield gate', (s) => s.replace("        if: steps.gate.outputs.yield != 'true' && steps.stash.outputs.halt != '1'", "        if: steps.stash.outputs.halt != '1'"), /run step condition/],
    ['demo.yml', 'JOB_LIMIT_S not the job timeout', (s) => s.replace("JOB_LIMIT_S: '600'", "JOB_LIMIT_S: '900'"), /JOB_LIMIT_S/],
    ['playtest.yml', 'the state-files list dropped', (s) => s.replace(/\n {10}printf '%s\\n' \$state_files > "\$RUNNER_TEMP\/state-files"/, ''), /state-files/],
    ['validate.yml', 'three tries again', (s) => s.replace(/(state push failed[\s\S]{0,40}?)?if \[ "\$n" -ge 4 \]; then echo "::error::state push failed/, 'if [ "$n" -ge 3 ]; then echo "::error::state push failed'), /4 tries/],
    ['demo.yml', 'the old fixed backoff', (s) => s.replace('sleep "$(node tools/state-stash.js backoff "$n" || echo 5)"', 'sleep $((5 * n))'), /backoff/],
    ['playtest.yml', 'keep state after a skipped persist too', (s) => s.replace("if: always() && (steps.persist.outcome == 'failure' || steps.persist.outcome == 'success')", 'if: always()'), /keep state condition/],
    ['validate.yml', 'keep state without the found copy', (s) => s.replace('"$PERSIST_OUTCOME" "$STASH_FOUND"', '"$PERSIST_OUTCOME" none'), /keep state command/],
    ['demo.yml', 'the save key without the attempt (a re-run cannot save)', (s) => s.replace('key: state-stash-demo-${{ github.run_id }}-${{ github.run_attempt }}', 'key: state-stash-demo-${{ github.run_id }}'), /cache kept state key/],
    ['playtest.yml', 'the save on another action version', (s) => s.replace(/(\n      - name: cache kept state\n[\s\S]*?uses: actions\/cache\/save@)[0-9a-f]{40}/, '$1' + 'f'.repeat(40)), /same pinned action/],
    ['validate.yml', 'the save without a condition', (s) => s.replace("        if: always() && steps.keep.outputs.write == '1'\n", ''), /cache kept state condition/],
    ['demo.yml', 'an env block before the run step', (s) => s.replace('        run: node tools/state-stash.js restore demo\n', '        env:\n          X_FILE: x.json\n        run: node tools/state-stash.js restore demo\n'), /\[6\]/],
  ];
  for (const [file, name, mut, want] of MUT) {
    const spec = SPECS.find((s) => s.file === file);
    const src = SRC[file] || '';
    const m = mut(src);
    T('[7] mutant site present: ' + file + ' ' + name, m !== src);
    const v = check(m, spec);
    T('[7] mutant (' + file + ': ' + name + ') is caught', v.some((x) => want.test(x)), v.join(' | ') || 'no violation');
  }
}

console.log(failN ? failN + ' FAIL' : 'all ok');
process.exit(failN ? 1 : 0);
