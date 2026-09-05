'use strict';
// Channel workflow twins: the playtest and demo channels run the SAME reconcile/feedback/sanctions/
// seedcap pipelines against their own app id with disjoint state files. Each twin is a hand-copied
// block, so this test pins every twin to its template: same env keys (only the app-id secret, the
// state-file names and the digest tag may differ), state files prefixed with the channel prefix,
// every produced state file persisted, no cron collision between the 5-minute-class workflows.
// A twin that drifts (a new env var added to one channel only, a state file produced but never
// persisted, two jobs on the same schedule minute) fails here instead of silently in production.
const fs = require('fs');
const path = require('path');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const WF = path.join(__dirname, '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');

// Parse the `env:` block of one job (first `env:` after the job header) into {key: value}.
function jobEnv(src, jobName) {
  const start = src.indexOf('\n  ' + jobName + ':\n');
  if (start < 0) return null;
  const nextJob = src.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const body = nextJob < 0 ? src.slice(start) : src.slice(start, start + 1 + nextJob);
  const envIdx = body.indexOf('        env:\n');
  if (envIdx < 0) return null;
  const out = {};
  for (const line of body.slice(envIdx + 13).split('\n')) {
    if (!/^          [A-Z_]+:/.test(line)) { if (/^        run:/.test(line)) break; continue; }
    const m = line.match(/^          ([A-Z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
// Persisted state files of one job (the `for f in ...` list or the single `--porcelain -- <file>`).
function persisted(src, jobName) {
  const start = src.indexOf('\n  ' + jobName + ':\n');
  const nextJob = src.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/);
  const jobBody = nextJob < 0 ? src.slice(start) : src.slice(start, start + 1 + nextJob);
  const pIdx = jobBody.indexOf('- name: persist');
  if (pIdx < 0) return [];
  const body = jobBody.slice(pIdx);   // only the persist step (the test step has its own `for f in test/...` loop)
  const list = body.match(/for f in ([^;]+); do/);
  if (list) return list[1].trim().split(/\s+/);
  const single = body.match(/--porcelain -- ([a-z-]+\.json)/);
  return single ? [single[1]] : [];
}
const SECRET = (name) => '${{ secrets.' + name + ' }}';

// ---- 1) reconcile twins: playtest.yml (template) vs demo.yml ----
console.log('-- reconcile twins --');
{
  const pt = read('playtest.yml'), dm = read('demo.yml');
  const ePt = jobEnv(pt, 'playtest'), eDm = jobEnv(dm, 'demo');
  T('playtest job env parsed', !!ePt && Object.keys(ePt).length > 10);
  T('demo job env parsed', !!eDm && Object.keys(eDm).length > 10);
  if (ePt && eDm) {
    const kPt = Object.keys(ePt).sort(), kDm = Object.keys(eDm).sort();
    T('same env key set', JSON.stringify(kPt) === JSON.stringify(kDm), 'pt=' + kPt.join(',') + ' dm=' + kDm.join(','));
    T('APPID secrets: PLAYTEST_APPID / DEMO_APPID', ePt.APPID === SECRET('PLAYTEST_APPID') && eDm.APPID === SECRET('DEMO_APPID'));
    T('both PT_MODE=1 (restricted channel semantics)', ePt.PT_MODE === "'1'" && eDm.PT_MODE === "'1'");
    for (const k of kPt) {
      if (k === 'APPID') continue;
      if (/_FILE$/.test(k)) {
        T('state file ' + k + ' prefixed per channel', /^pt-/.test(ePt[k]) && /^demo-/.test(eDm[k]), ePt[k] + ' / ' + eDm[k]);
        T('state file ' + k + ' same stem', ePt[k].replace(/^pt-/, '') === eDm[k].replace(/^demo-/, ''));
      } else {
        T('env ' + k + ' identical across twins', ePt[k] === eDm[k], ePt[k] + ' / ' + eDm[k]);
      }
    }
    // every produced (persisted-class) state file is persisted; rating-side files are deliberately not
    const NOT_PERSISTED = new Set(['SC_STATE_FILE', 'SKILL_FILE', 'GROUPS_FILE']);
    for (const [name, env, src] of [['playtest', ePt, pt], ['demo', eDm, dm]]) {
      const produced = Object.keys(env).filter(k => /_FILE$/.test(k) && !NOT_PERSISTED.has(k)).map(k => env[k]).sort();
      const persist = persisted(src, name).sort();
      T(name + ': persisted list == produced state files', JSON.stringify(produced) === JSON.stringify(persist), 'produced=' + produced.join(',') + ' persist=' + persist.join(','));
    }
  }
  T('demo.yml has its own concurrency group', /group: demo\n/.test(dm));
  T('demo.yml runs the playtest + channel test set', /for f in test\/playtest-\*\.js test\/channel-\*\.js/.test(dm));
}

// ---- 2) feedback / sanctions / seedcap twins ----
console.log('-- twin jobs in feedback / sanctions / seedcap --');
for (const [file, tmpl, ptJob, dmJob] of [
  ['feedback.yml', 'feedback', 'playtest-feedback', 'demo-feedback'],
  ['sanctions.yml', 'sanctions', 'playtest-sanctions', 'demo-sanctions'],
  ['seedcap.yml', 'seedcap', 'playtest-seedcap', 'demo-seedcap'],
]) {
  const src = read(file);
  const eT = jobEnv(src, tmpl), ePt = jobEnv(src, ptJob), eDm = jobEnv(src, dmJob);
  T(file + ': ' + ptJob + ' + ' + dmJob + ' present', !!ePt && !!eDm);
  if (!ePt || !eDm) continue;
  T(file + ': twins APPID = PLAYTEST_APPID / DEMO_APPID', ePt.APPID === SECRET('PLAYTEST_APPID') && eDm.APPID === SECRET('DEMO_APPID'));
  T(file + ': twins share the same env key set', JSON.stringify(Object.keys(ePt).sort()) === JSON.stringify(Object.keys(eDm).sort()));
  T(file + ': twin digest tags [playtest] / [demo]', ePt.FB_DIGEST_TAG === "'[playtest] '" && eDm.FB_DIGEST_TAG === "'[demo] '");
  for (const k of Object.keys(ePt)) {
    if (k === 'APPID' || k === 'FB_DIGEST_TAG') continue;
    if (/_FILE$/.test(k)) {
      const okPrefix = (/^pt-|^feedback-playtest/.test(ePt[k])) && (/^demo-|^feedback-demo/.test(eDm[k]));
      T(file + ': ' + k + ' per-channel state file', okPrefix, ePt[k] + ' / ' + eDm[k]);
    } else {
      T(file + ': ' + k + ' identical across twins', ePt[k] === eDm[k]);
      // the twins must not gain a knob the template job lacks (and vice versa), except the channel-only ones
      if (eT && !(k in eT) && !['FB_DIGEST_TAG', 'SN_STATE_FILE', 'FB_STATE_FILE'].includes(k)) bad(file + ': twin env ' + k + ' missing from template job ' + tmpl);
    }
  }
  // platform bans never on the twins (double-ban guard)
  T(file + ': twins carry no BAN_APPIDS', !('BAN_APPIDS' in ePt) && !('BAN_APPIDS' in eDm));
  T(file + ': demo twin serialized after the playtest twin (needs)', new RegExp(dmJob + ':[\\s\\S]{0,200}needs: ' + ptJob).test(src) || new RegExp(dmJob + ':\\n\\s+needs: ' + ptJob).test(src));
  // each twin persists exactly its own state file
  const pPt = persisted(src, ptJob), pDm = persisted(src, dmJob);
  T(file + ': ' + ptJob + ' persists one pt/playtest file', pPt.length === 1 && /pt-|playtest/.test(pPt[0]), pPt.join(','));
  T(file + ': ' + dmJob + ' persists one demo file', pDm.length === 1 && /demo/.test(pDm[0]), pDm.join(','));
}

// ---- 3) schedule minutes: 5-minute-class workflows on distinct offsets ----
console.log('-- schedule offsets --');
{
  const offsets = {};
  for (const f of fs.readdirSync(WF).filter(x => /\.ya?ml$/.test(x))) {
    const m = read(f).match(/- cron:\s*'([^']+)'/);
    if (!m) continue;
    const mm = m[1].split(' ')[0];
    const five = mm.match(/^(\*|(\d+)-59)\/5$/);
    if (!five) continue;
    const off = five[2] == null ? 0 : (+five[2]) % 5;
    (offsets[off] = offsets[off] || []).push(f);
  }
  for (const [off, files] of Object.entries(offsets)) {
    T('5-minute schedule offset ' + off + ' used by exactly one workflow (' + files.join(',') + ')', files.length === 1);
  }
  T('demo.yml on its own offset (1-59/5)', /- cron: '1-59\/5 \* \* \* \*'/.test(read('demo.yml')));
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (channel-workflows)');
process.exit(failN ? 1 : 0);
