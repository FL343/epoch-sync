'use strict';
// O759 / O760 shadow, end to end + its independence from the reconcile job. Runs in .github/workflows/elp-shadow.yml only.
//   [1] a made-up season (shadow/fake-state.js, settled by the official functions) through shadow/elp-shadow.js day by
//       day: one history entry a day, a rerun of a day replaces it, EMA continuity, S1 starts from the S0 final
//   [2] privacy: no made-up account id / history key in the history file or the summary; no id-like field names; the
//       scan catches a planted id (self-check)
//   [3] the live-shaped state with no placed player: every family "N 0", shadow = official = the presets
//   [4] O759 on a large made-up season: the gate opens for solo (pool + correlation); without yesterday's state the
//       correlation is unmeasured and the gate stays closed
//   [5] independence: no official file (validate.js / points-plan.js / the other workflows / test/*.js) refers to the
//       shadow; the shadow workflow uses no secret and no Steam, runs neither validate.js nor grants.js, pushes only the
//       history branch, has no step named "test", and the official workflow scans (test/workflow-push-retry.js,
//       test/channel-workflows.js) stay green with it
//   [6] the CLI writes the history + summary files and exits 0
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const F = require(path.join(__dirname, '..', 'fake-state.js'));
const R = require(path.join(__dirname, '..', 'elp-shadow.js'));
const S = require(path.join(__dirname, '..', 'elp-shadow-plan.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-shadow-'));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// run a made-up season through the runner; returns { days, results, ids }
function season(opt, sub) {
  const dir = path.join(W, sub); fs.mkdirSync(dir, { recursive: true });
  const D = F.fakeDays(opt), results = [];
  let hist = null, prev = null;
  for (const x of D) {
    const sf = path.join(dir, 'state-' + x.day + '.json');
    fs.writeFileSync(sf, JSON.stringify(x.state));
    const res = R.run({ state: sf, prev, history: hist, now: x.ms + 3600000 });
    hist = path.join(dir, 'history.json');
    fs.writeFileSync(hist, JSON.stringify(res.hist));
    results.push(res);
    prev = sf;
  }
  const ids = new Set();
  for (const k of Object.keys(D[D.length - 1].state.hist)) { ids.add(k.split('|')[0]); ids.add(k); }
  return { D, results, ids, hist, dir };
}
// any made-up id / history key in a text
function leaks(text, ids) { const out = []; for (const id of ids) if (text.indexOf(id) >= 0) { out.push(id); if (out.length > 3) break; } return out; }

console.log('-- [1] a made-up season, day by day');
const A = season({ days: 17, arrive: 40, seed: 3 }, 'a');
{
  const last = A.results[A.results.length - 1].hist;
  T('[1] one history entry a day (' + last.days.length + ' / ' + A.D.length + ')', last.days.length === A.D.length);
  T('[1] every entry has the four families + their O759 block', last.days.every((e) => PP.ELP_FAMS.every((f) => e.fams[f] && e.gm[f])));
  const seasons = [...new Set(last.days.map((e) => e.season))];
  T('[1] the made-up season crosses S0 -> S1 (seasons ' + seasons.join(',') + ')', seasons.length === 2);
  T('[1] finals kept for both seasons', last.finals['0'] && last.finals['1'] && last.finals['0'].solo.length === 7);
  const firstS1 = last.days.find((e) => e.season === 1), s0Final = last.days.filter((e) => e.season === 0).pop();
  T('[1] S1 starts from the S0 final mixed with the preset (prior ' + firstS1.fams.solo.prior.src + ')', firstS1.fams.solo.prior.src === 's0-final+preset' && near(firstS1.fams.solo.prior.lines[6], Math.sqrt(s0Final.fams.solo.smooth[6] * PP.ELP.PRIOR.solo[6]), 0.01));
  T('[1] S1 day 1 is not smoothed with S0 (no previous day of the season)', firstS1.fams.solo.prevDay === null && firstS1.fams.solo.jump === null);
  // EMA continuity within S0: smooth_t = a raw_t + (1 - a) smooth_{t-1}
  let emaBad = 0, checked = 0;
  for (let i = 1; i < last.days.length; i++) {
    const a = last.days[i], b = last.days[i - 1];
    if (a.season !== b.season) continue;
    for (const f of ['solo', 'duo']) for (let k = 0; k < 7; k++) { checked++; if (!near(a.fams[f].smooth[k], S.SHADOW.EMA_ALPHA * a.fams[f].raw[k] + (1 - S.SHADOW.EMA_ALPHA) * b.fams[f].smooth[k], 0.002)) emaBad++; }
  }
  T('[1] EMA continuity (' + checked + ' line-days)', emaBad === 0 && checked > 50, emaBad + ' off');
  const solo = s0Final.fams.solo;
  T('[1] the made-up S0 has placed solo players (N ' + solo.N + ') and shows the fit', solo.N >= S.SHADOW.SHOW_MIN && solo.fit && solo.emp);
  T('[1] pass lines rise by at least 1 per tier', last.days.every((e) => PP.ELP_FAMS.every((f) => e.fams[f].pass.every((v, k) => !k || v > e.fams[f].pass[k - 1]))));
  // a rerun of the last day replaces its entry
  const lastX = A.D[A.D.length - 1], sf = path.join(A.dir, 'state-' + lastX.day + '.json');
  const again = R.run({ state: sf, prev: null, history: A.hist, now: lastX.ms + 7200000 });
  T('[1] a rerun of a day replaces its entry (still ' + again.hist.days.length + ')', again.hist.days.length === A.D.length && again.hist.days[again.hist.days.length - 1].ms === lastX.ms + 7200000);
}

console.log('-- [2] privacy');
{
  const histText = fs.readFileSync(A.hist, 'utf8'), sumText = A.results.map((r) => r.text).join('\n');
  const l1 = leaks(histText, A.ids), l2 = leaks(sumText, A.ids);
  T('[2] no made-up account id / history key in the history file (' + A.ids.size + ' checked)', l1.length === 0, l1.join(', '));
  T('[2] none in the summaries', l2.length === 0, l2.join(', '));
  T('[2] no id-like field in the history (pid / sid / key / runId / seed / steam)', !/"(pid|sid|key|keys|runId|runIds|seed|seeds|steam\w*)"\s*:/i.test(histText));
  T('[2] no Steam id shape anywhere', !/7656119\d{10}/.test(histText + sumText));
  const planted = sumText + ' ' + [...A.ids][0];
  T('[2] self-check: a planted id is caught', leaks(planted, A.ids).length === 1);
}

console.log('-- [3] the live-shaped state with nobody placed');
{
  const sf = path.join(W, 'empty.json');
  fs.writeFileSync(sf, JSON.stringify({ hist: { 'p0000|solo|0': { best: [1, 2], runs: [[1, 2, 1, 1, 0, 6]], old: [], t: 1, n: 1, ring: [] } }, elpTab: [] }));
  const res = R.run({ state: sf, now: Date.UTC(2026, 10, 18) });
  const e = res.entry;
  T('[3] every family N 0', PP.ELP_FAMS.every((f) => e.fams[f].N === 0));
  T('[3] shadow = official = the presets, diff 0', PP.ELP_FAMS.every((f) => e.fams[f].pass.join() === PP.ELP.PRIOR[f].join() && e.fams[f].official.pass.join() === PP.ELP.PRIOR[f].join() && e.fams[f].diff.every((d) => d === 0)));
  T('[3] the summary says so', (res.text.match(/N 0: no placed players/g) || []).length === 4);
  T('[3] O759 pool 0, gate closed', PP.ELP_FAMS.every((f) => e.gm[f].pool === 0 && !e.gm[f].gate.open));
}

console.log('-- [4] O759 on a large made-up season');
{
  const L = season({ days: 13, arrive: 250, seed: 7, families: { solo: 1 } }, 'l');
  const e = L.results[L.results.length - 1].entry.gm.solo;
  T('[4] solo grandmaster pool ' + e.pool + ', full window ' + e.effective + ', correlation ' + e.corr + ' over ' + e.pairs + ': the gate would open', e.gate.open && e.effective >= S.SHADOW.GM_POOL_MIN && e.corr >= S.SHADOW.GM_CORR_MIN);
  T('[4] the distribution is shown (pool >= 5) and the runs of the last day counted', e.gap && e.ifOn && e.ifOn.runs > 0 && e.ifOn.plus + e.ifOn.minus + e.ifOn.zero === e.ifOn.runs);
  const lastX = L.D[L.D.length - 1], sf = path.join(L.dir, 'state-' + lastX.day + '.json');
  const noPrev = R.run({ state: sf, prev: null, history: null, now: lastX.ms + 3600000 }).entry.gm.solo;
  T('[4] without yesterday\'s state: correlation unmeasured, gate closed', noPrev.corr === null && !noPrev.gate.open && noPrev.gate.pool);
  const leak = leaks(L.results.map((r) => r.text).join('\n') + fs.readFileSync(L.hist, 'utf8'), L.ids);
  T('[4] no id in the large season output either', leak.length === 0, leak.join(', '));
}

console.log('-- [5] independence from the reconcile job');
{
  const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const REF = /elp-shadow|sim-bootstrap|fake-state|shadow\/test|shadow\/elp/;   // the shadow's own names ("shadow pool" of the trust ledger is something else)
  T('[5] validate.js / points-plan.js do not refer to the shadow', !REF.test(rd('validate.js')) && !REF.test(rd('points-plan.js')));
  const wfs = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
  const others = wfs.filter((f) => f !== 'elp-shadow.yml' && REF.test(rd('.github/workflows/' + f)));
  T('[5] no other workflow refers to the shadow', others.length === 0, others.join(','));
  const tests = fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.js') && REF.test(rd('test/' + f)));
  T('[5] no reconcile test (test/*.js) refers to the shadow (its tests live in shadow/test, run by elp-shadow.yml only)', tests.length === 0, tests.join(','));
  const y = rd('.github/workflows/elp-shadow.yml');
  T('[5] the shadow workflow uses no secret and nothing Steam', !/secrets\./.test(y) && !/steam/i.test(y.replace(/^\s*#.*$/gm, '')));
  T('[5] it runs neither validate.js nor grants.js nor any test/*.js', !/node\s+(validate|grants|sanctions|seedcap|feedback|audit)\.js/.test(y) && !/for f in test\//.test(y) && !/tools\/run-tests/.test(y));
  T('[5] no step named "test" (test/channel-workflows.js would take it for a reconcile suite)', !/- name: test\n/.test(y));
  const pushes = y.split('\n').filter((L2) => /\bgit push\b/.test(L2) && !/^\s*#/.test(L2));
  T('[5] the only push is the retry loop on the history branch', pushes.length === 1 && /GITHUB_REF_NAME=shadow\/elp\n\s*n=0\n\s*until git pull --rebase origin "\$\{GITHUB_REF_NAME\}" && git push; do/.test(y));
  T('[5] runs once a day (not on the 5-minute grid) + by hand', /- cron: '\d+ \d+ \* \* \*'/.test(y) && /workflow_dispatch:/.test(y));
  // least privilege + no share of the reconcile jobs' queue / machines
  const perms = (y.match(/\npermissions:\n((?:  .*\n)+)/) || [])[1] || '';
  T('[5] permissions: contents: write only (the default token pushes the history branch; nothing else)', perms.trim() === 'contents: write');
  const runsOn = (y.match(/runs-on:\s*(.+)/g) || []).map((x) => x.replace(/runs-on:\s*/, '').trim());
  T('[5] GitHub-hosted runner only (' + runsOn.join(',') + ')', runsOn.length > 0 && runsOn.every((x) => /^(ubuntu|windows|macos)-[\w.]+$/.test(x)));
  const groups = wfs.map((f) => [f, (rd('.github/workflows/' + f).match(/\n\s+group:\s*(\S+)/) || [])[1]]).filter(([, g]) => g === 'elp-shadow');
  T('[5] its own concurrency group, never cancelling a run in progress', groups.length === 1 && groups[0][0] === 'elp-shadow.yml' && /cancel-in-progress: false/.test(y));
  const minute = +(y.match(/- cron: '(\d+) /) || [])[1];
  const recon = ['validate.yml', 'playtest.yml', 'demo.yml'].map((f) => { const m = rd('.github/workflows/' + f).match(/- cron: '(\*|(\d+)-59)\/5 /); return m ? (m[2] == null ? 0 : +m[2] % 5) : -1; });
  T('[5] the daily minute :' + minute + ' is off the reconcile ticks (offsets ' + recon.join(',') + ')', isFinite(minute) && recon.every((o) => o >= 0 && o !== minute % 5));
  T('[5] self-check: the scans catch a planted reference / a step named "test" / a second push',
    REF.test("const S = require('./shadow/elp-shadow-plan.js');") && /- name: test\n/.test(y.replace('- name: shadow checks', '- name: test')) &&
    (y + '\n          git push origin HEAD:main\n').split('\n').filter((L2) => /\bgit push\b/.test(L2) && !/^\s*#/.test(L2)).length === 2);
  for (const t of ['test/workflow-push-retry.js', 'test/channel-workflows.js']) {
    const r = cp.spawnSync(process.execPath, [path.join(ROOT, t)], { cwd: ROOT, encoding: 'utf8' });
    T('[5] ' + t + ' stays green with the shadow workflow', r.status === 0, (r.stdout || '').split('\n').filter((x) => /FAIL/.test(x)).slice(0, 3).join(' | '));
  }
}

console.log('-- [6] the CLI');
{
  const sf = path.join(A.dir, 'state-' + A.D[5].day + '.json'), out = path.join(W, 'cli.json'), md = path.join(W, 'cli.md');
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'shadow', 'elp-shadow.js'), '--state', sf, '--out', out, '--md', md, '--now', String(A.D[5].ms + 3600000)], { cwd: ROOT, encoding: 'utf8' });
  T('[6] exit 0, history + summary written, summary printed', r.status === 0 && fs.existsSync(out) && fs.existsSync(md) && /SHADOW ONLY/.test(r.stdout), (r.stderr || '').slice(0, 200));
  const txt = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '', back = (() => { try { return JSON.parse(txt); } catch (e) { return null; } })();
  T('[6] the history file parses back, one line per day', back && back.v === 1 && back.days.length === 1 && txt.split('\n').filter((l) => /^\{"day":/.test(l)).length === 1);
  const r2 = cp.spawnSync(process.execPath, [path.join(ROOT, 'shadow', 'elp-shadow.js'), '--state', path.join(A.dir, 'state-' + A.D[6].day + '.json'), '--history', out, '--out', out, '--now', String(A.D[6].ms + 3600000)], { cwd: ROOT, encoding: 'utf8' });
  const txt2 = fs.readFileSync(out, 'utf8'), back2 = JSON.parse(txt2);
  T('[6] the next day reads it and adds one line', r2.status === 0 && back2.days.length === 2 && txt2.split('\n').filter((l) => /^\{"day":/.test(l)).length === 2 && back2.days[1].fams.solo.prevDay === back2.days[0].day);
  T('[6] the first (empty) history of the branch is read as a start', R.run({ state: path.join(A.dir, 'state-' + A.D[6].day + '.json'), history: (() => { const f = path.join(W, 'h0.json'); fs.writeFileSync(f, '{\n "v": 1,\n "days": [],\n "finals": {}\n}\n'); return f; })(), now: A.D[6].ms + 3600000 }).hist.days.length === 1);
  const bad = cp.spawnSync(process.execPath, [path.join(ROOT, 'shadow', 'elp-shadow.js'), '--state', path.join(W, 'missing.json')], { cwd: ROOT, encoding: 'utf8' });
  T('[6] an unreadable state file fails loudly (exit != 0)', bad.status !== 0);
}

fs.rmSync(W, { recursive: true, force: true });
console.log(failN ? ('elp-shadow-run: ' + failN + ' FAIL') : 'elp-shadow-run: all ok');
process.exit(failN ? 1 : 0);
