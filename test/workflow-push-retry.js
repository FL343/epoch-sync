'use strict';
// Every state push in every workflow must sit inside the bounded retry loop
//   until git pull --rebase origin "${GITHUB_REF_NAME}" && git push; do ... exit 1 ... done
// The dispatcher starts every channel's workflow within the same few seconds and they all push
// state commits to the same branch, so a bare `git pull --rebase; git push` loses its push
// whenever a sibling lands in between. For the reconcile job a lost state commit is not cosmetic:
// the boards were already written ("current value + delta"), so the next run re-settles the same
// matches and every LP / XP / CP delta lands twice. The only push allowed outside the loop is the
// best-effort replica push (it targets $MIRROR_URL and must never fail a production run).
const fs = require('fs');
const path = require('path');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const LOOP_HEAD = /^\s*until git pull --rebase origin "\$\{GITHUB_REF_NAME\}" && git push; do\s*$/;
const REPLICA = /git push --force --quiet "\$MIRROR_URL" /;

// Pure: one workflow source -> list of violations ({ line, why }).
function scanPushes(src) {
  const lines = String(src).split('\n');
  const out = [];
  lines.forEach((L, i) => {
    if (!/\bgit push\b/.test(L) || /^\s*#/.test(L)) return;
    if (REPLICA.test(L)) return;
    if (!LOOP_HEAD.test(L)) { out.push({ line: i + 1, why: 'push outside the retry loop' }); return; }
    // the loop body must be bounded and fail loudly: a counter, an exit 1 once it reaches its cap, and a backoff
    const body = [];
    for (let k = i + 1; k < lines.length && k <= i + 6; k++) { if (/^\s*done\s*$/.test(lines[k])) break; body.push(lines[k]); }
    const b = body.join('\n');
    if (!/n=\$\(\(n\+1\)\)/.test(b)) out.push({ line: i + 1, why: 'retry loop without a counter' });
    if (!/if \[ "\$n" -ge \d+ \]; then [^\n]*exit 1; fi/.test(b)) out.push({ line: i + 1, why: 'retry loop without a bounded exit 1' });
    if (!/sleep /.test(b)) out.push({ line: i + 1, why: 'retry loop without a backoff' });
  });
  return out;
}

// ---- [1] the scanner itself (mutation proof: every bad shape must be caught) ----
{
  const good = [
    '          n=0',
    '          until git pull --rebase origin "${GITHUB_REF_NAME}" && git push; do',
    '            n=$((n+1))',
    '            if [ "$n" -ge 3 ]; then echo "::error::x"; exit 1; fi',
    '            sleep $((5 * n))',
    '          done',
  ].join('\n');
  T('[1] canonical retry loop passes', scanPushes(good).length === 0, JSON.stringify(scanPushes(good)));
  const bare = [
    '          git pull --rebase origin "${GITHUB_REF_NAME}" || { echo "::error::x"; exit 1; }',
    '          git push',
  ].join('\n');
  T('[1] bare push (the 2026-10 reconcile shape) is caught', scanPushes(bare).length === 1);
  const unbounded = good.replace(/\n\s*if \[ "\$n" -ge 3 \][^\n]*/, '');
  T('[1] loop without a bounded exit is caught', scanPushes(unbounded).some(v => /bounded exit/.test(v.why)));
  const noSleep = good.replace(/\n\s*sleep [^\n]*/, '');
  T('[1] loop without a backoff is caught', scanPushes(noSleep).some(v => /backoff/.test(v.why)));
  const pushOnly = '          until git push; do\n            n=$((n+1))\n            if [ "$n" -ge 3 ]; then exit 1; fi\n            sleep 5\n          done';
  T('[1] retry loop without the rebase is caught', scanPushes(pushOnly).length === 1);
  T('[1] replica push is exempt', scanPushes('          git push --force --quiet "$MIRROR_URL" HEAD:main \\').length === 0);
  T('[1] comment lines are ignored', scanPushes('          # git push happens below').length === 0);
}

// ---- [2] every real workflow ----
{
  const WF = path.join(__dirname, '..', '.github', 'workflows');
  const files = fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f)).sort();
  T('[2] workflows found', files.length >= 8, files.join(','));
  let loops = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(WF, f), 'utf8');
    const v = scanPushes(src);
    loops += src.split('\n').filter(L => LOOP_HEAD.test(L)).length;
    T('[2] ' + f + ': every push retries (bounded, loud)', v.length === 0, v.map(x => 'L' + x.line + ' ' + x.why).join('; '));
  }
  // the reconcile job persists state and (every 14 days) a heartbeat: both pushes must be in the loop
  const vy = fs.readFileSync(path.join(WF, 'validate.yml'), 'utf8');
  T('[2] validate.yml: persist + heartbeat both retry', vy.split('\n').filter(L => LOOP_HEAD.test(L)).length === 2);
  T('[2] retry loops in total >= 13 (no persist step silently dropped)', loops >= 13, 'loops=' + loops);
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (workflow-push-retry)');
process.exit(failN ? 1 : 0);
