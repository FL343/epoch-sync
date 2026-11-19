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
//   [7] the season clock: by default the official one (validate.js seasonAt); with no next season scheduled (the official
//       table since O844) the runner stays in one season, keeps one final, the preset prior and an unbroken EMA chain;
//       every read of the official clock in shadow/*.js is the default of a clock the caller can replace
// The season table of [1] is MADE UP here (FAKE_S1), never the official one: O844 (2026-11-18) left season 1 without a
//   date, and [1], which had walked the official table across 2026-12-01, went red the day that landed on main.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const F = require(path.join(__dirname, '..', 'fake-state.js'));
const R = require(path.join(__dirname, '..', 'elp-shadow.js'));
const S = require(path.join(__dirname, '..', 'elp-shadow-plan.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));
const V = require(path.join(ROOT, 'validate.js'));

// the made-up season table: season 1 opens 2026-12-01 00:00 UTC (the instant the official table had until O844), day 15
//   of the 17 made-up days of [1]
const FAKE_S1 = Date.UTC(2026, 11, 1), fakeSeasonAt = (ms) => (ms >= FAKE_S1 ? 1 : 0);

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const W = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-shadow-'));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// run a made-up season through the runner; returns { days, results, ids }. clock: the season table of both the made-up
//   history and the runner (ms -> season id); none = the official one
function season(opt, sub, clock) {
  const dir = path.join(W, sub); fs.mkdirSync(dir, { recursive: true });
  const D = F.fakeDays(Object.assign({}, opt, clock ? { seasonAt: clock } : null)), results = [];
  let hist = null, prev = null;
  for (const x of D) {
    const sf = path.join(dir, 'state-' + x.day + '.json');
    fs.writeFileSync(sf, JSON.stringify(x.state));
    const res = R.run({ state: sf, prev, history: hist, now: x.ms + 3600000, seasonAt: clock });
    hist = path.join(dir, 'history.json');
    fs.writeFileSync(hist, JSON.stringify(res.hist));
    results.push(res);
    prev = sf;
  }
  const ids = new Set(), last = D[D.length - 1].state;
  for (const f of ['hist', 'runs', 'ms']) for (const k of Object.keys(last[f] || {})) { ids.add(k.split('|')[0]); ids.add(k); }
  return { D, results, ids, hist, dir };
}
// any made-up id / pid-keyed key in a text, or any token shaped like a salted pid (16 hex with a letter)
const PID_SHAPE = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{16}\b/;
function leaks(text, ids) {
  const out = []; for (const id of ids) if (text.indexOf(id) >= 0) { out.push(id); if (out.length > 3) break; }
  const m = text.match(PID_SHAPE); if (m && out.indexOf(m[0]) < 0) out.push('shape:' + m[0]);
  return out;
}

console.log('-- [1] a made-up season, day by day');
const A = season({ days: 17, arrive: 40, seed: 3 }, 'a', fakeSeasonAt);
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
  const again = R.run({ state: sf, prev: null, history: A.hist, now: lastX.ms + 7200000, seasonAt: fakeSeasonAt });
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
  T('[2] self-check: a planted id is caught', leaks(planted, A.ids).length >= 1);
  T('[2] self-check: a real-shaped key nobody listed is caught by its shape', leaks('{"x":{"9f123b68bebca458|0|SOLO":1}}', new Set()).length === 1);
  // mutation: the 2026-11-08 slip -- the state's "ms" (an object keyed by salted pids in the real file) copied into the entry
  const src = fs.readFileSync(path.join(__dirname, '..', 'elp-shadow.js'), 'utf8'), anchor = 'season: s, prevState: !!prevSt,';
  if (src.indexOf(anchor) < 0) T('[2] mutation anchor present', false, anchor);
  else {
    const Module = require('module'), m = new Module(path.join(__dirname, '..', 'elp-shadow.js'), module);
    m.filename = path.join(__dirname, '..', 'elp-shadow.js'); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
    m._compile(src.replace(anchor, 'season: s, stateMs: st.ms || null, prevState: !!prevSt,'), m.filename);
    const lastX = A.D[A.D.length - 1], sf = path.join(A.dir, 'state-' + lastX.day + '.json');
    const mut = m.exports.run({ state: sf, now: lastX.ms + 3600000, seasonAt: fakeSeasonAt });
    T('[2] mutation: copying the state\'s pid-keyed "ms" into the entry is caught', leaks(m.exports.histText(mut.hist), A.ids).length > 0);
  }
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
  // arrive 450: room over the gate. With 350 the three-run placement (ELP version 6) left the effective pool at exactly
  //   GM_POOL_MIN (20; 28 under five runs) -- one more change of the settle rules and this check would have been red for no reason
  const L = season({ days: 13, arrive: 450, seed: 7, families: { solo: 1 } }, 'l');
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
  T('[5] runs once a day (not on the 5-minute grid) + by hand (+ a dry run on a push of the code it reads: elp-shadow-wiring.js)', /- cron: '\d+ \d+ \* \* \*'/.test(y) && /workflow_dispatch:/.test(y));
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

console.log('-- [7] the season clock');
{
  const x5 = A.D[5], sf5 = path.join(A.dir, 'state-' + x5.day + '.json'), now5 = x5.ms + 3600000;
  T('[7] no clock passed: the runner uses the official one (season ' + V.seasonAt(now5) + ')', R.run({ state: sf5, now: now5 }).entry.season === V.seasonAt(now5));
  T('[7] a clock passed is the one the runner uses', R.run({ state: sf5, now: now5, seasonAt: () => 5 }).entry.season === 5);
  const f5 = F.fakeDays({ days: 2, arrive: 10, seed: 1, seasonAt: () => 5 }), k5 = Object.keys(f5[1].state.hist);
  T('[7] ... and the one the made-up history is settled in (' + k5.length + ' entries, all of season 5)', k5.length > 0 && k5.every((k) => k.endsWith('|5')) && f5.every((x) => x.season === 5));
  const f0 = F.fakeDays({ days: 1, arrive: 10, seed: 1 });
  T('[7] no clock passed: the made-up history follows the official one', f0[0].season === V.seasonAt(F.EA_START));

  // no next season scheduled (the official table since O844): the same 17 days, the clock never leaves season 0
  const NS = season({ days: 17, arrive: 40, seed: 3 }, 'n', () => 0), last = NS.results[NS.results.length - 1].hist;
  T('[7] no next season: one history entry a day, all of season 0', last.days.length === NS.D.length && last.days.every((e) => e.season === 0));
  T('[7] no next season: one final kept (season 0), seven lines a family', Object.keys(last.finals).join() === '0' && PP.ELP_FAMS.every((f) => last.finals['0'][f].length === 7 && last.finals['0'][f].every((v) => isFinite(v) && v > 0)));
  T('[7] no next season: the prior stays the preset every day', last.days.every((e) => PP.ELP_FAMS.every((f) => e.fams[f].prior.src === 'preset' && e.fams[f].prior.lines.join() === PP.ELP.PRIOR[f].join())));
  T('[7] no next season: every day after the first is smoothed with the day before (no restart)', last.days.every((e, i) => PP.ELP_FAMS.every((f) => e.fams[f].prevDay === (i ? last.days[i - 1].day : null))));
  let emaBad = 0, checked = 0;
  for (let i = 1; i < last.days.length; i++) for (const f of ['solo', 'duo']) for (let k = 0; k < 7; k++) { checked++; if (!near(last.days[i].fams[f].smooth[k], S.SHADOW.EMA_ALPHA * last.days[i].fams[f].raw[k] + (1 - S.SHADOW.EMA_ALPHA) * last.days[i - 1].fams[f].smooth[k], 0.002)) emaBad++; }
  T('[7] no next season: EMA continuity over all ' + (last.days.length - 1) + ' day pairs (' + checked + ' line-days)', emaBad === 0 && checked === (last.days.length - 1) * 14, emaBad + ' off');
  const nMid = last.days[13].fams.solo.N, nEnd = last.days[last.days.length - 1].fams.solo.N;
  T('[7] no next season: the placed players keep counting past the day the made-up table changes season (N ' + nMid + ' -> ' + nEnd + ')', nEnd > nMid && nMid >= S.SHADOW.SHOW_MIN);
  T('[7] no next season: pass lines rise by at least 1 per tier, the summary renders', last.days.every((e) => PP.ELP_FAMS.every((f) => e.fams[f].pass.every((v, k) => !k || v > e.fams[f].pass[k - 1]))) && NS.results.every((r) => /season 0\. SHADOW ONLY/.test(r.text)));

  // every read of the official clock in the shadow's own code (shadow/*.js, not the tests) is the default of a clock the
  //   caller can replace: a made-up history that has to cross a season never depends on the dates of the official table
  const clockScan = (src) => { const all = (src.match(/V\.seasonAt/g) || []).length, dflt = (src.match(/[A-Za-z]\.seasonAt \|\| V\.seasonAt/g) || []).length; return { all, dflt, ok: all === dflt }; };
  const own = fs.readdirSync(path.join(__dirname, '..')).filter((f) => f.endsWith('.js'));
  const reads = own.map((f) => [f, clockScan(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))]).filter(([, c]) => c.all > 0);
  T('[7] every read of the official clock in shadow/*.js is a replaceable default (' + reads.map(([f, c]) => f + ' ' + c.dflt + '/' + c.all).join(', ') + ')', reads.length === 2 && reads.every(([, c]) => c.ok));
  // mutation: the runner reading the official clock directly (the state before this fix)
  const src = fs.readFileSync(path.join(__dirname, '..', 'elp-shadow.js'), 'utf8'), anchor = 's = (opt.seasonAt || V.seasonAt)(nowMs),';
  if (src.indexOf(anchor) < 0) T('[7] mutation anchor present', false, anchor);
  else {
    const Module = require('module'), m = new Module(path.join(__dirname, '..', 'elp-shadow.js'), module), mutSrc = src.replace(anchor, 's = V.seasonAt(nowMs),');
    m.filename = path.join(__dirname, '..', 'elp-shadow.js'); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
    m._compile(mutSrc, m.filename);
    const mut = m.exports.run({ state: sf5, now: now5, seasonAt: () => 5 }).entry;
    T('[7] mutation: a runner that reads the official clock directly is caught (the scan red; a passed clock ignored: season ' + mut.season + ')',
      !clockScan(mutSrc).ok && mut.season === V.seasonAt(now5) && mut.season !== 5);
  }
}

fs.rmSync(W, { recursive: true, force: true });
console.log(failN ? ('elp-shadow-run: ' + failN + ' FAIL') : 'elp-shadow-run: all ok');
process.exit(failN ? 1 : 0);
