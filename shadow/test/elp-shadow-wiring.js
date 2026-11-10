'use strict';
// The elp-shadow workflow wiring (.github/workflows/elp-shadow.yml). Runs in the shadow workflow only, like its siblings.
//   Why: until 2026-11-10 the shadow's tests ran on the daily schedule alone. O781 moved points-plan.js ELP.PRIOR (solo
//   grandmaster 55 -> 42) and a test that had copied the old number stayed red two days before anyone saw it. Now a push
//   to main that changes what the shadow reads runs the workflow at once as a dry run (checks + the computation, no write).
//   [1] on.push: branch main, paths cover points-plan.js / validate.js / attest.js / shadow/** / the workflow itself
//   [2] the schedule and the manual start stay
//   [3] the checks step runs every shadow/test/*.js and stops on the first red
//   [4] every step that commits or pushes is gated off for a push (a push run never writes the history)
//   [5] mutations: a path left out turns [1] red; the write gate removed turns [4] red; no push trigger turns [1] red
const fs = require('fs');
const path = require('path');
const WF = path.join(__dirname, '..', '..', '.github', 'workflows', 'elp-shadow.yml');
const SRC = fs.readFileSync(WF, 'utf8');

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

// the `on:` block (top level, up to the next top-level key), comments dropped
function onBlock(src) {
  const lines = src.split(/\r?\n/), out = [];
  let inOn = false;
  for (const l of lines) {
    if (/^on:\s*$/.test(l)) { inOn = true; continue; }
    if (inOn && /^\S/.test(l) && !/^#/.test(l)) break;
    if (inOn && !/^\s*#/.test(l)) out.push(l);
  }
  return out;
}
// the push trigger: { branches: [..], paths: [..] } or null
function pushOf(src) {
  const on = onBlock(src);
  const i = on.findIndex((l) => /^ {2}push:\s*$/.test(l));
  if (i < 0) return null;
  const res = { branches: [], paths: [] };
  let key = null;
  for (let j = i + 1; j < on.length; j++) {
    const l = on[j];
    if (/^ {2}\S/.test(l)) break;
    let m = l.match(/^ {4}(branches|paths):\s*\[(.*)\]\s*$/);
    if (m) { res[m[1]] = m[2].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean); key = null; continue; }
    m = l.match(/^ {4}(branches|paths):\s*$/);
    if (m) { key = m[1]; continue; }
    m = l.match(/^ {6}-\s*(.+?)\s*$/);
    if (m && key) res[key].push(m[1].replace(/^['"]|['"]$/g, ''));
  }
  return res;
}
// the job's steps: [{ name, body }] in order
function stepsOf(src) {
  const parts = src.split(/\r?\n(?= {6}- (?:name|uses):)/);
  return parts.slice(1).map((p) => ({ name: ((p.match(/^ {6}- name:\s*(.+)$/m) || [])[1] || '').trim(), body: p }));
}
const NEED_PATHS = ['points-plan.js', 'validate.js', 'attest.js', 'shadow/**', '.github/workflows/elp-shadow.yml'];
function checkPush(src) {
  const p = pushOf(src), bad = [];
  if (!p) return ['no push trigger'];
  if (p.branches.join() !== 'main') bad.push('branches ' + JSON.stringify(p.branches));
  for (const x of NEED_PATHS) if (p.paths.indexOf(x) < 0) bad.push('path missing: ' + x);
  return bad;
}
function checkWriteGate(src) {
  const bad = [];
  for (const s of stepsOf(src)) {
    if (!/\bgit\s+(?:-C\s+\S+\s+)?(?:commit|push)\b|\bgit push\b/.test(s.body)) continue;
    if (!/^ {8}if:\s*github\.event_name\s*!=\s*'push'\s*$/m.test(s.body)) bad.push('step "' + s.name + '" writes without the push gate');
  }
  return bad;
}

console.log('-- [1] on.push');
{ const bad = checkPush(SRC); T('[1] push to main on the rules / the reconcile / the shadow / this workflow', bad.length === 0, bad.join('; ')); }

console.log('-- [2] the schedule and the manual start stay');
{ const on = onBlock(SRC).join('\n'); T('[2] schedule + workflow_dispatch', /^ {2}workflow_dispatch:/m.test(on) && /^ {2}schedule:\s*\n\s+- cron: '37 1 \* \* \*'/m.test(on)); }

console.log('-- [3] the checks step');
{
  const s = stepsOf(SRC).find((x) => x.name === 'shadow checks');
  T('[3] runs every shadow/test/*.js, exit on the first red, never gated off', !!s && /for f in shadow\/test\/\*\.js; do .*node "\$f" \|\| exit 1; done/.test(s.body) && !/^ {8}if:/m.test(s.body));
}

console.log('-- [4] a push run never writes');
{
  const bad = checkWriteGate(SRC), writers = stepsOf(SRC).filter((s) => /\bgit push\b/.test(s.body));
  T('[4] every committing / pushing step carries if: github.event_name != \'push\' (' + writers.length + ' step)', writers.length >= 1 && bad.length === 0, bad.join('; '));
}

console.log('-- [5] mutations');
{
  const anchor = "      - 'points-plan.js'\n";
  const noPath = SRC.replace(/\r\n/g, '\n').replace(anchor, '');
  T('[5] a path left out (points-plan.js) turns [1] red', SRC.replace(/\r\n/g, '\n').indexOf(anchor) >= 0 && checkPush(noPath).some((x) => /points-plan\.js/.test(x)));
  const gate = "        if: github.event_name != 'push'\n";
  const noGate = SRC.replace(/\r\n/g, '\n').replace(gate, '');
  T('[5] the write gate removed turns [4] red', SRC.replace(/\r\n/g, '\n').indexOf(gate) >= 0 && checkWriteGate(noGate).length > 0);
  const noPush = SRC.replace(/\r\n/g, '\n').replace(/^ {2}push:\n(?: {4}.*\n)+/m, '');
  T('[5] no push trigger turns [1] red', noPush !== SRC.replace(/\r\n/g, '\n') && checkPush(noPush).length > 0);
}

console.log(failN ? 'elp-shadow-wiring: ' + failN + ' FAIL' : 'elp-shadow-wiring: all ok');
process.exit(failN ? 1 : 0);
