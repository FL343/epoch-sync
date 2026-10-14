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
// Usage: node tools/run-tests.js [--jobs=N] [--timeout-min=M] test/*.js
//   --jobs         parallel files (default: the machine's CPU count, at most 8)
//   --timeout-min  a single file running longer than this is killed and counted red (default 8)
// ============================================================
const os = require('os'), cp = require('child_process');

const args = process.argv.slice(2);
const opt = (name, def) => { const a = args.find((x) => x.startsWith('--' + name + '=')); return a ? Number(a.split('=')[1]) : def; };
const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const JOBS = Math.max(1, Math.min(opt('jobs', Math.min(cpus, 8)) | 0, 32));
const TIMEOUT_MS = Math.max(0.05, opt('timeout-min', 8)) * 60000;
const files = args.filter((x) => !x.startsWith('--'));
if (!files.length) { console.error('run-tests: no test files given'); process.exit(2); }

const t0 = Date.now();
const failed = [];
let next = 0, running = 0;

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
      }
      process.stdout.write(out);
      resolve();
    });
  });
}

function pump() {
  return new Promise((done) => {
    const step = () => {
      if (next >= files.length && running === 0) return done();
      while (running < JOBS && next < files.length) {
        running++;
        runOne(files[next++]).then(() => { running--; step(); });
      }
    };
    step();
  });
}

pump().then(() => {
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (failed.length) {
    console.log('run-tests: ' + failed.length + ' of ' + files.length + ' file(s) red in ' + secs + ' s (' + JOBS + ' at a time): ' + failed.join(' '));
    process.exit(1);
  }
  console.log('run-tests: ' + files.length + ' file(s) green in ' + secs + ' s (' + JOBS + ' at a time)');
});
