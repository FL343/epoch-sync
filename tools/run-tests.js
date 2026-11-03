#!/usr/bin/env node
'use strict';
// ============================================================
// tools/run-tests.js -- run test files a few at a time; one output block per file; exit 1 when any failed (O463).
// ============================================================
// Why: the reconcile's pre-settlement suite (test/*.js, one node process per file) grew to 3+ min sequentially; the
//   files are independent (each works in its own mkdtemp dir), so N at a time on the runner's cores cuts it to about a
//   third (2026-10-14: 250 s -> 74 s at 4 on a dev box, all green). Every file still runs to the end: a red run lists
//   every failing file, not just the first. Output of a file is printed in one piece when it finishes, headed like the
//   old loop ("== test/x.js =="), so the run log stays readable. The caller keeps ::stop-commands:: around this.
// Q362 (2026-11-02, second-round audit B2-1 leftover 1): the reconcile job is 10 min for tests + settlement together and
//   the suite keeps growing; once one full pass outgrows the job, every run is killed inside the test step, the pass is
//   never remembered, the next run starts the suite from the top again -> no settlement ever, and nothing recovers by
//   itself. So a pass is now also remembered per file: --done-file lists the files that already passed for this exact
//   code (the caller keys it by tools/code-hash.js), they are not run again, and each file that passes is appended the
//   moment it finishes. --budget-min stops launching new files after that long (running ones still finish) and exits
//   3: the next run picks up the rest. Every run that gets that far moves forward, so a suite of any length converges
//   in a few runs. Exit 0 still means every file passed (now or before, for this code); a red file is never written to
//   the done-file, so red code still never settles.
// Usage: node tools/run-tests.js [--jobs=N] [--timeout-min=M] [--done-file=F] [--budget-min=B] test/*.js
//   --jobs         parallel files (default: the machine's CPU count, at most 8)
//   --timeout-min  a single file running longer than this is killed and counted red (default 8)
//   --done-file    files listed here (one per line, as given on the command line) count as passed and are skipped;
//                  each file that passes now is appended. Created empty when missing.
//   --budget-min   after this many minutes no new file starts; files not started yet are left for the next run (exit 3)
// Exit: 0 every file green · 1 any file red (reds win over a budget stop) · 2 no files given · 3 budget stop, nothing red
// ============================================================
const os = require('os'), cp = require('child_process'), fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, def) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? Number(a.split('=')[1]) : def; };
const optStr = (name) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : ''; };
const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const JOBS = Math.max(1, Math.min(opt('jobs', Math.min(cpus, 8)) | 0, 32));
const TIMEOUT_MS = Math.max(0.05, opt('timeout-min', 8)) * 60000;
const BUDGET = opt('budget-min', 0);
const BUDGET_MS = BUDGET > 0 ? BUDGET * 60000 : Infinity;
const DONE_FILE = optStr('done-file');
const given = args.filter((x) => !x.startsWith('--'));
if (!given.length) { console.error('run-tests: no test files given'); process.exit(2); }

let done = new Set();
if (DONE_FILE) {
  try { done = new Set(fs.readFileSync(DONE_FILE, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean)); }
  catch (e) { if (e.code !== 'ENOENT') { console.error('run-tests: cannot read ' + DONE_FILE + ': ' + e.message + ' (running every file)'); } }
  // the caller saves this file whether or not the run got far: make sure it exists
  try { fs.appendFileSync(DONE_FILE, ''); } catch (e) { console.error('run-tests: cannot write ' + DONE_FILE + ': ' + e.message); }
}
const files = given.filter((f) => !done.has(f));
if (DONE_FILE) console.log('run-tests: ' + (given.length - files.length) + ' of ' + given.length + ' file(s) already passed for this code (' + DONE_FILE + '), ' + files.length + ' to run');

const t0 = Date.now();
const failed = [];
let next = 0, running = 0, passedNow = 0;

function runOne(file) {
  return new Promise((resolve) => {
    const start = Date.now();
    const chunks = [];
    const child = cp.spawn(process.execPath, [file], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => chunks.push(d));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.on('error', (e) => chunks.push(Buffer.from('\nspawn error: ' + e.message + '\n')));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const secs = ((Date.now() - start) / 1000).toFixed(1);
      const ok = code === 0 && !timedOut;
      let out = '== ' + file + ' == (' + secs + ' s)\n' + Buffer.concat(chunks).toString('utf8');
      if (!out.endsWith('\n')) out += '\n';
      if (!ok) {
        failed.push(file);
        out += 'RED ' + file + ': ' + (timedOut ? 'killed after ' + TIMEOUT_MS / 60000 + ' min' : signal ? 'signal ' + signal : 'exit code ' + code) + '\n';
      } else {
        passedNow++;
        // appended the moment it passes: a run killed later (step / job timeout) keeps what it already proved
        if (DONE_FILE) { try { fs.appendFileSync(DONE_FILE, file + '\n'); } catch (e) { out += 'run-tests: cannot record the pass in ' + DONE_FILE + ': ' + e.message + '\n'; } }
      }
      process.stdout.write(out);
      resolve();
    });
  });
}

function pump() {
  return new Promise((finish) => {
    const step = () => {
      const overBudget = Date.now() - t0 >= BUDGET_MS;
      if ((next >= files.length || overBudget) && running === 0) return finish();
      while (!overBudget && running < JOBS && next < files.length) {
        running++;
        runOne(files[next++]).then(() => { running--; step(); });
      }
    };
    step();
  });
}

pump().then(() => {
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const left = files.length - next;
  if (failed.length) {
    console.log('run-tests: ' + failed.length + ' of ' + files.length + ' file(s) red in ' + secs + ' s (' + JOBS + ' at a time): ' + failed.join(' ') +
      (left ? ' (and ' + left + ' not started: budget)' : ''));
    process.exit(1);
  }
  if (left) {
    console.log('run-tests: budget of ' + BUDGET + ' min reached after ' + secs + ' s: ' + passedNow + ' file(s) green now, ' + left + ' not started yet' +
      (DONE_FILE ? ' -- the passes are kept in ' + DONE_FILE + ', the next run starts with the rest' : '') + '; not a pass yet');
    process.exit(3);
  }
  console.log('run-tests: ' + files.length + ' file(s) green in ' + secs + ' s (' + JOBS + ' at a time)' +
    (given.length > files.length ? ', ' + (given.length - files.length) + ' more passed before for this code' : ''));
});
