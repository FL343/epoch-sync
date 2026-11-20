'use strict';
// seedcap versioned-core tripwires: per-channel package windows -> which compiled world core answers a run,
// the package-switch overlap (previous core consulted too, cap = max), disk fallbacks, cap merging, and the
// workflow wiring pins (every seedcap job names its channel + hands the artifact directory over).
// Offline by design: no CLI is executed here (selection/merge are pure; resolve takes an exists() stub).
const fs = require('fs');
const path = require('path');

process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.STATE_SALT = process.env.STATE_SALT || 'seedcap-test-salt';
process.env.SC_STATE_FILE = path.join(require('os').tmpdir(), 'seedcap-cores-test-' + process.pid + '.json');

const sc = require('../seedcap.js');

let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m + (d ? ' (' + d + ')' : '')); } };
const T = (iso) => Date.parse(iso);
const H = 3600 * 1000, D = 24 * H;

const live = { v: 1, channels: {
  playtest: [
    { buildNum: 2026090703, core: 'aaaaaaaaaaaa', liveAt: '2026-09-07T00:00:00.000Z', gateAt: null },
    { buildNum: 2026092101, core: 'bbbbbbbbbbbb', liveAt: '2026-09-21T10:00:00.000Z', gateAt: '2026-09-21T12:00:00.000Z' },
  ],
  demo: [
    { buildNum: 2026090703, core: 'aaaaaaaaaaaa', liveAt: '2026-09-07T00:00:00.000Z', gateAt: null },
    { buildNum: 2026092102, core: 'bbbbbbbbbbbb', liveAt: '2026-09-21T10:30:00.000Z', gateAt: null },
  ],
  ea: [ { buildNum: null, core: null, liveAt: '2026-07-11T00:00:00.000Z', gateAt: null } ],
  same: [
    { buildNum: 1, core: 'aaaaaaaaaaaa', liveAt: '2026-09-01T00:00:00.000Z', gateAt: null },
    { buildNum: 2, core: 'aaaaaaaaaaaa', liveAt: '2026-09-10T00:00:00.000Z', gateAt: null },
  ],
} };

// ---- [1] window selection ----
{
  let s = sc.selectCores(live, 'playtest', T('2026-09-10T00:00:00Z'));
  ok('inside the first window: its core, no overlap', s.primary === 'aaaaaaaaaaaa' && s.extra.length === 0 && s.why === 'window');
  s = sc.selectCores(live, 'playtest', T('2026-09-21T10:00:00Z') + 60000);
  ok('just after the switch: new core primary + previous core in overlap', s.primary === 'bbbbbbbbbbbb' && s.extra.join() === 'aaaaaaaaaaaa' && s.why === 'overlap');
  s = sc.selectCores(live, 'playtest', T('2026-09-21T12:00:00Z') + sc.OVERLAP_GRACE_MS - 1000);
  ok('gated window: overlap still open 1s before gateAt + grace', s.extra.length === 1);
  s = sc.selectCores(live, 'playtest', T('2026-09-21T12:00:00Z') + sc.OVERLAP_GRACE_MS + 1000);
  ok('gated window: overlap closed after gateAt + grace', s.primary === 'bbbbbbbbbbbb' && s.extra.length === 0);
  s = sc.selectCores(live, 'demo', T('2026-09-21T10:30:00Z') + 6 * D);
  ok('ungated window: overlap runs on (6 days in)', s.extra.length === 1);
  s = sc.selectCores(live, 'demo', T('2026-09-21T10:30:00Z') + sc.OVERLAP_MAX_MS + 1000);
  ok('ungated window: overlap hard-capped at OVERLAP_MAX', s.extra.length === 0);
  s = sc.selectCores(live, 'playtest', T('2026-09-01T00:00:00Z'));
  ok('before the first window: root CLI', s.primary === null && s.why === 'before-first-window');
  s = sc.selectCores(live, 'nope', Date.now());
  ok('unknown channel: root CLI', s.primary === null && s.extra.length === 0 && s.why === 'no-window');
  s = sc.selectCores(null, 'playtest', Date.now());
  ok('no live.json: root CLI', s.primary === null && s.why === 'no-window');
  s = sc.selectCores(live, 'ea', Date.now());
  ok('window without a core (pre-core package): root CLI as primary', s.primary === null && s.extra.length === 0);
  s = sc.selectCores(live, 'same', T('2026-09-10T00:00:00Z') + H);
  ok('same core across a switch: nothing extra to consult', s.primary === 'aaaaaaaaaaaa' && s.extra.length === 0);
  // unsorted input + junk rows
  const messy = { channels: { x: [live.channels.playtest[1], { liveAt: 'garbage', core: 'zz' }, null, live.channels.playtest[0]] } };
  s = sc.selectCores(messy, 'x', T('2026-09-21T10:00:00Z') + 60000);
  ok('unsorted windows + junk rows tolerated', s.primary === 'bbbbbbbbbbbb' && s.extra.join() === 'aaaaaaaaaaaa');
  ok('overlap constants: grace 12h, cap 7d', sc.OVERLAP_GRACE_MS === 12 * H && sc.OVERLAP_MAX_MS === 7 * D);
}

// ---- [2] disk resolution ----
{
  const dist = path.join('x', 'dist');
  const all = () => true, none = () => false;
  let r = sc.resolveCores({ primary: 'bbbbbbbbbbbb', extra: ['aaaaaaaaaaaa'] }, dist, all);
  ok('both on disk: primary first, then overlap', r.length === 2 && r[0].label === 'bbbbbbbbbbbb' && r[1].label === 'aaaaaaaaaaaa' && r[0].exe === sc.corePathOf(dist, 'bbbbbbbbbbbb'));
  r = sc.resolveCores({ primary: 'bbbbbbbbbbbb', extra: ['aaaaaaaaaaaa'] }, dist, none);
  ok('nothing on disk: root CLI only (never a hard failure)', r.length === 1 && r[0].label === 'root');
  r = sc.resolveCores({ primary: 'bbbbbbbbbbbb', extra: ['aaaaaaaaaaaa'] }, dist, (p) => p.indexOf('bbbbbbbbbbbb') >= 0);
  ok('overlap core missing: dropped, primary stands', r.length === 1 && r[0].label === 'bbbbbbbbbbbb');
  r = sc.resolveCores({ primary: null, extra: [] }, dist, all);
  ok('no selection: root CLI', r.length === 1 && r[0].label === 'root');
  ok('core path = <dist>/cores/<id>/<cli basename>', sc.corePathOf(dist, 'abc') === path.join(dist, 'cores', 'abc', 'seedcap_cli.exe'));
}

// ---- [3] cap merge ----
{
  const a = { m0: { cap: 100 }, m1: { cap: 500 }, m2: { err: 'bad-kind' }, m3: { cap: 50 } };
  const b = { m0: { cap: 300 }, m1: { cap: 400 }, m2: { cap: 999 }, m4: { cap: 1 }, m3: { err: 'x' } };
  sc.mergeCaps(a, b);
  ok('overlap core raises a cap', a.m0.cap === 300 && a.m0.via === 'overlap');
  ok('overlap core never lowers a cap', a.m1.cap === 500 && !a.m1.via);
  ok('primary ERR stays ERR (the group retries on the primary later)', a.m2.err === 'bad-kind' && a.m2.cap == null);
  ok('overlap ERR changes nothing', a.m3.cap === 50);
  ok('groups only the overlap core saw are not invented', a.m4 === undefined);
}

// ---- [4] wiring pins ----
{
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'seedcap.yml'), 'utf8');
  // 2026-11-20: the playtest / demo twin jobs are retired -> one job, ea. "Every job" is still every job, counted by its run
  //   step (an empty SEEDCAP_CHANNEL would read no live.json window and replay on the v1 perk rules); structural lines only.
  const runs = (yml.match(/^ {8}run: node seedcap\.js[ \t]*$/gm) || []).length;
  const chans = (yml.match(/^ {10}SEEDCAP_CHANNEL: (\w+)/gm) || []).map(x => x.trim().split(' ')[1]).sort();
  ok('seedcap.yml: every job names its channel, and the one job left is ea (playtest / demo twins retired)', runs === 1 && chans.length === runs && chans.join() === 'ea', runs + ' job(s): ' + chans.join());
  const clis = (yml.match(/^ {10}SEEDCAP_CLI: \S/gm) || []).length, dists = (yml.match(/^ {10}SEEDCAP_DIST_DIR: \.\/authority-dist[ \t]*$/gm) || []).length;
  ok('seedcap.yml: every job hands the artifact directory over', runs > 0 && clis === runs && dists === runs, clis + '/' + dists + ' of ' + runs);
  const src = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('main(): root CLI existence stays the hard precondition (fallback for every selection miss)', /if \(!fs\.existsSync\(SEEDCAP_CLI\)\)/.test(src));
  ok('auditPending(): capability probes run against the primary core', /cliSupportsRerolls\(runPrimary\)/.test(src) && /cliSupportsBuild\(runPrimary\)/.test(src) && /cliSupportsClassic\(runPrimary\)/.test(src) && /const capsPrimary = \{ builds: cliSupportsBuilds\(runPrimary\), fee: cliSupportsFee\(runPrimary\), rv: cliSupportsRv\(runPrimary\) \};/.test(src) &&
    /if \(pending\.some\(needFee\) && !cliSupportsFee\(runPrimary\)\)/.test(src) && /if \(pending\.some\(needRv\) && !cliSupportsRv\(runPrimary\)\)/.test(src));   // client knife 5.10b: fee= / rv= groups deferred on an older core
  ok('auditPending(): overlap + exact cores probe their own capabilities before being asked', (src.match(/const okRr = cliSupportsRerolls\(run\), okBuild = cliSupportsBuild\(run\), okCl = cliSupportsClassic\(run\), caps = \{ builds: cliSupportsBuilds\(run\), fee: cliSupportsFee\(run\), rv: cliSupportsRv\(run\) \};/g) || []).length === 2 &&
    (src.match(/if \(\(!caps\.fee && needFee\(x\)\) \|\| \(!caps\.rv && needRv\(x\)\)\)/g) || []).length === 2);
  ok('main(): cores come from coresForNow (live.json window) and the audit routine is the shared auditPending', /const cf = coresForNow\(SEEDCAP_DIST_DIR, SEEDCAP_CHANNEL, Date\.now\(\)\);/.test(src) && /function auditPending\(pendingIn, ctx\)/.test(src));
  // knife 3.5c2a-A: a solo record's signing package (keyId = buildNum) -> that window's core, exactly (no overlap max)
  ok('coreForBuildNum: buildNum -> window core (playtest 2026092101 -> bbbb…); unknown -> null', sc.coreForBuildNum(live, 'playtest', 2026092101) === 'bbbbbbbbbbbb' && sc.coreForBuildNum(live, 'playtest', 2026090703) === 'aaaaaaaaaaaa' && sc.coreForBuildNum(live, 'playtest', 999) === null && sc.coreForBuildNum(live, 'ea', 1) === null);
}

console.log('seedcap-cores: ' + pass + ' ok' + (fail ? ', ' + fail + ' FAIL' : ''));
process.exit(fail ? 1 : 0);
