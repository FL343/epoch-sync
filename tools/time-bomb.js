#!/usr/bin/env node
'use strict';
// ============================================================
// time-bomb.js - run the test suite with the clock moved forward and report the suites that pass today but fail on a
//   later date (W117, 2026-10-29)
// ============================================================
// Why: a test written against a fixed calendar date goes red on that date with nobody touching the code, and so far it was
//   luck whether anyone saw it early (October 2026 alone: one suite red from 10-24, one pinned to 10-27, three red from 11-03,
//   one red from 12-01). This runs the suite at +3 / +14 / +35 days every night with fake-clock.js preloaded.
//   REPORT ONLY: once it has run it always exits 0 (2 = bad arguments), it never blocks anything.
//
// Steps
//   1. one full run at each offset (--days, default 3,14,35);
//   2. every suite that failed at some offset is run alone with the real clock: failing today too = an ordinary red that the
//      normal CI already reports ("nowRed"), not a time bomb;
//   3. the rest are run alone again at each failing offset, smallest first: the first offset where it fails again is reported
//      ("bombs": suite, days, from = the date that offset stands for); failing only in the full run = "flaky".
//   4. a confirmed one is run once more at a small control offset (--control-hours, default 1 hour): failing there too = the
//      suite compares Node's clock with a clock the preload cannot move (file times, git commit times, other programs), not a
//      date written into a test -> "clockMix", not a bomb. (A real date that falls within that hour is red tomorrow anyway.)
//      Suites whose own window is longer than the control offset (e.g. "files older than 2 days are cleaned up") still look
//      like bombs: register them in --known with the reason.
//   A suite in --known (until a real date) is listed under "known" instead of "bombs".
// Two ways to do a full run
//   --runner "<command>"  the repository's own full-suite command, run through the shell in --cwd with the clock variables
//                         set. Its output must end with a "[test:all] N/M ..." summary line ("test:all" runner format;
//                         the failed suites are the names after "): " on the summary line, or the "  FAIL  <name>.js" lines).
//   (no --runner)         every *.js directly inside --suites, one node process per file, --jobs at a time.
//   Single-suite runs (steps 2-4) are always "node <suites>/<file>" in --cwd, --jobs suites at a time in BOTH ways (each
//   suite's own runs one after another). They do not go through --runner, so a box-wide lock wrapped around the runner does
//   not cover them: on a shared machine pass --jobs 1 (one extra node process next to whatever holds the lock).
// Output
//   progress lines "time-bomb: ..." and at the end ONE line "[time-bomb] {json}" (the maintainer's session-start CI check
//   reads it back from the run log); with --out <file> the same JSON is also written there (the state file).
//   json = { v, label, sha, at, today, days, runs:[{days,done,failed,secs,why}], bombs:[{suite,days,from}],
//            nowRed:[], flaky:[{suite,days}], clockMix:[{suite,days}], known:[{suite,days,from,why,until}], broken:[] }
// Options
//   --suites <dir> (required)  --cwd <dir> (default: current directory)  --days 3,14,35
//   --jobs N (single-suite runs at the same time, and suites at a time in a full run without --runner; default CPUs-1, 1..8)
//   --timeout-min N (one suite alone, default 15; a full runner run gets N*8)  --known <json>  --label <name>  --sha <commit>
//   --out <file>  --max-suspects N (default 60: more failures than this = the run is broken, not 60 time bombs)
//   --control-hours N (default 1; 0 = no control run)
// --known file: { "<suite>.js": { "why": "...", "until": "YYYY-MM-DD" } } - compared with the REAL date.
// Node built-ins only, English only: the public reconciliation repo carries a byte copy (tools/time-bomb.js).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DAY = 86400000;
const MARK = '[time-bomb] ';
const PRELOAD = path.join(__dirname, 'fake-clock.js');
const TAIL_BYTES = 512 * 1024;

function parseArgs(argv) {
  const o = { days: [3, 14, 35], jobs: Math.max(1, Math.min(8, os.cpus().length - 1)), timeoutMin: 15, maxSuspects: 60, controlHours: 1, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    const take = () => { i++; if (v === undefined) throw new Error(a + ' needs a value'); return v; };
    if (a === '--suites') o.suites = take();
    else if (a === '--cwd') o.cwd = take();
    else if (a === '--runner') o.runner = take();
    else if (a === '--days') o.days = take().split(',').map(Number);
    else if (a === '--jobs') o.jobs = Number(take());
    else if (a === '--timeout-min') o.timeoutMin = Number(take());
    else if (a === '--max-suspects') o.maxSuspects = Number(take());
    else if (a === '--control-hours') o.controlHours = Number(take());
    else if (a === '--known') o.known = take();
    else if (a === '--label') o.label = take();
    else if (a === '--sha') o.sha = take();
    else if (a === '--out') o.out = take();
    else throw new Error('unknown option ' + a);
  }
  if (!o.suites) throw new Error('--suites <dir> is required');
  if (!o.days.length || o.days.some((d) => !Number.isInteger(d) || d <= 0)) throw new Error('--days must be positive whole days, e.g. 3,14,35');
  o.days = Array.from(new Set(o.days)).sort((a, b) => a - b);
  if (!(o.jobs >= 1)) throw new Error('--jobs must be >= 1');
  if (!(o.timeoutMin > 0)) throw new Error('--timeout-min must be > 0');
  if (!(o.controlHours >= 0) || o.controlHours >= 24 * o.days[0]) throw new Error('--control-hours must be >= 0 and below the smallest --days');
  o.cwd = path.resolve(o.cwd);
  o.suites = path.resolve(o.cwd, o.suites);
  return o;
}

// environment for a child: the fake clock preloaded (forward slashes: NODE_OPTIONS treats a backslash inside quotes as an escape)
function clockEnv(base, days) {
  const env = Object.assign({}, base);
  delete env.FAKE_CLOCK_DAYS;
  const req = '--require "' + PRELOAD.replace(/\\/g, '/') + '"';
  const rest = String(env.NODE_OPTIONS || '').split(req).join('').trim();
  if (days) { env.FAKE_CLOCK_DAYS = String(days); env.NODE_OPTIONS = (rest ? rest + ' ' : '') + req; }
  else if (rest) env.NODE_OPTIONS = rest; else delete env.NODE_OPTIONS;
  return env;
}

// run a command; resolves { code, timedOut, text } (text = the last TAIL_BYTES of stdout + stderr)
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    let child, text = '', timedOut = false;
    const keep = (d) => { text += d.toString('utf8'); if (text.length > TAIL_BYTES * 2) text = text.slice(-TAIL_BYTES); };
    try { child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: !!opts.shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ code: null, timedOut: false, text: String(e.message) }); return; }
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch (e) {} }, opts.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, timedOut, text: text + '\n' + e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: timedOut ? null : code, timedOut, text: text.slice(-TAIL_BYTES) }); });
  });
}

// output of a "test:all" style runner -> { done, failed[] }. The summary words are matched as \u escapes so this file stays
//   free of Han characters (it is published): \u5168\u7eff = "all green", \u7eff = "green", \u7ea2 = "red".
function parseRunnerOutput(text) {
  const t = String(text || '').replace(/\r/g, '');
  const red = t.match(/^\[test:all\] \d+\/\d+ \u7eff, \d+ \u7ea2 \([^)]*\): (.*)$/m);
  if (red) return { done: true, failed: red[1].trim().split(/\s+/).filter(Boolean) };
  if (/^\[test:all\] (\d+)\/\1 \u5168\u7eff/m.test(t)) return { done: true, failed: [] };
  const fails = [];
  for (const m of t.matchAll(/^ {2}FAIL {2}(\S+\.js)$/mg)) if (!fails.includes(m[1])) fails.push(m[1]);
  return { done: false, failed: fails };
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } }
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

function suiteFiles(dir) { return fs.readdirSync(dir).filter((f) => f.endsWith('.js') && fs.statSync(path.join(dir, f)).isFile()).sort(); }

function runSuite(o, file, days) {
  return run(process.execPath, [path.join(o.suites, file)], { cwd: o.cwd, env: clockEnv(process.env, days), timeoutMs: o.timeoutMin * 60000 })
    .then((r) => ({ ok: r.code === 0, timedOut: r.timedOut }));
}

async function fullRun(o, days) {
  const t0 = Date.now();
  if (o.runner) {
    const r = await run(o.runner, [], { cwd: o.cwd, env: clockEnv(process.env, days), shell: true, timeoutMs: o.timeoutMin * 8 * 60000 });
    const p = parseRunnerOutput(r.text);
    const why = p.done ? '' : (r.timedOut ? 'runner timed out' : 'runner ended without its summary line (exit ' + r.code + ')');
    return { days, done: p.done, failed: p.failed, secs: Math.round((Date.now() - t0) / 1000), why };
  }
  const files = suiteFiles(o.suites);
  const res = await pool(files, o.jobs, (f) => runSuite(o, f, days));
  return { days, done: true, failed: files.filter((f, i) => !res[i].ok), secs: Math.round((Date.now() - t0) / 1000), why: '' };
}

const dateAt = (nowMs, days) => new Date(nowMs + days * DAY).toISOString().slice(0, 10);

// the full runs -> what to check alone (pure; exported for the tripwire)
function suspectsOf(runs) {
  const at = new Map();
  for (const r of runs) for (const f of r.failed) { if (!at.has(f)) at.set(f, []); at.get(f).push(r.days); }
  for (const ds of at.values()) ds.sort((a, b) => a - b);
  return at;
}

async function main(argv) {
  if (Date.fakeClockDays !== undefined) throw new Error('fake-clock.js is preloaded into time-bomb.js itself - unset NODE_OPTIONS / FAKE_CLOCK_DAYS');
  const o = parseArgs(argv);
  const nowMs = Date.now();
  let known = {};
  if (o.known) { try { known = JSON.parse(fs.readFileSync(path.resolve(o.cwd, o.known), 'utf8')) || {}; } catch (e) { throw new Error('--known ' + o.known + ': ' + e.message); } }
  const state = { v: 1, label: o.label || path.basename(o.cwd), sha: o.sha || '', at: new Date(nowMs).toISOString(), today: dateAt(nowMs, 0),
    days: o.days, runs: [], bombs: [], nowRed: [], flaky: [], clockMix: [], known: [], broken: [] };
  for (const d of o.days) {
    console.log('time-bomb: full run at +' + d + ' days (' + dateAt(nowMs, d) + ') ...');
    const r = await fullRun(o, d);
    console.log('time-bomb: +' + d + ' ' + (r.done ? r.failed.length + ' failed' : 'NOT FINISHED (' + r.why + ')') + ' in ' + r.secs + 's' + (r.failed.length ? ': ' + r.failed.join(' ') : ''));
    state.runs.push(r);
    if (!r.done) state.broken.push('+' + d + ': ' + r.why);
  }
  const at = suspectsOf(state.runs);
  if (at.size > o.maxSuspects) {
    state.broken.push(at.size + ' suites failed (more than ' + o.maxSuspects + '): the run is broken, not checked one by one');
  } else {
    const list = Array.from(at.keys()).sort();
    const verdicts = await pool(list, o.jobs, async (f) => {
      if (!(await runSuite(o, f, 0)).ok) return { f, now: true };
      for (const d of at.get(f)) {
        if ((await runSuite(o, f, d)).ok) continue;
        if (o.controlHours && !(await runSuite(o, f, o.controlHours / 24)).ok) return { f, clock: d };
        return { f, days: d };
      }
      return { f, flaky: at.get(f)[0] };
    });
    for (const v of verdicts) {
      if (v.now) { state.nowRed.push(v.f); continue; }
      if (v.flaky) { state.flaky.push({ suite: v.f, days: v.flaky }); continue; }
      if (v.clock) { state.clockMix.push({ suite: v.f, days: v.clock }); continue; }
      const k = known[v.f];
      const entry = { suite: v.f, days: v.days, from: dateAt(nowMs, v.days) };
      if (k && typeof k.until === 'string' && state.today <= k.until) state.known.push(Object.assign(entry, { why: String(k.why || ''), until: k.until }));
      else state.bombs.push(entry);
    }
  }
  for (const b of state.bombs) console.log('time-bomb: BOMB ' + b.suite + ' passes today, fails at +' + b.days + ' days (' + b.from + ')');
  for (const k of state.known) console.log('time-bomb: known ' + k.suite + ' fails at +' + k.days + ' (' + k.why + ', until ' + k.until + ')');
  if (state.nowRed.length) console.log('time-bomb: red today as well (not a time bomb): ' + state.nowRed.join(' '));
  if (state.flaky.length) console.log('time-bomb: failed only in the full run (flaky?): ' + state.flaky.map((x) => x.suite + ' +' + x.days).join(' '));
  if (state.clockMix.length) console.log('time-bomb: fails ' + o.controlHours + 'h ahead as well (compares the moved clock with file / git / other clocks, not a date bomb): ' + state.clockMix.map((x) => x.suite).join(' '));
  const line = JSON.stringify(state);
  if (o.out) fs.writeFileSync(path.resolve(o.cwd, o.out), line + '\n');
  console.log(MARK + line);
  return state;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0), (e) => { console.error('time-bomb: ' + (e && e.message || e)); process.exit(2); });
}
module.exports = { parseArgs, clockEnv, parseRunnerOutput, suspectsOf, dateAt, main, MARK, PRELOAD };
