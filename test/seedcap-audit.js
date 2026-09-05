'use strict';
// seedcap audit tripwires (O124 / knife-9): mt->cap-param mapping, CLI line
// protocol, endless chain carry bound, auditable-group picking (consistency /
// widest-tail), the audit state machine (over-cap -> veto/suspects/corrections;
// ok -> chain extend; ERR -> fail-open remember), pruning bounds, and wiring
// pins (workflow yml + validate.js consult + single-writer ownership).
// Offline by design: the CLI is exercised elsewhere (the private repo's parity
// suite drives the real exe against a JS reference and 77 real honest matches);
// here the CLI results are synthetic inputs to the state machine.
const fs = require('fs');
const path = require('path');

process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.STATE_SALT = process.env.STATE_SALT || 'seedcap-test-salt';
process.env.SC_STATE_FILE = path.join(require('os').tmpdir(), 'seedcap-test-' + process.pid + '.json');

const sc = require('../seedcap.js');
const v = require('../validate.js');

let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m + (d ? ' (' + d + ')' : '')); } };

// ---- synthetic record builder (schema v3 + endless tail; mirrors result-reporter) ----
function sidInts(sid) { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }
function mkRec(mt, seed, pc, scores, roster, tail) {
  const d = [0xB1, 3, mt, 1234, seed | 0, 0, 1, 0, pc, 300];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(0);   // disp
  for (let i = 0; i < pc; i++) { const si = sidInts(roster[i] || '0'); d.push(si[0], si[1]); }
  if (tail) d.push(tail.startDepth | 0, tail.endDepth | 0, 0, 0);
  return { d, roster: v.decodeRoster(d) };
}
const SIDA = '76561198000000001', SIDB = '76561198000000002';

// ---- [1] mt -> cap params mapping ----
{
  const cases = [
    [1, 'quick', false, false, 0], [2, 'ranked', false, false, 0],
    [3, 'quick', true, false, 2], [4, 'ranked', true, false, 2],
    [5, 'quick', false, true, 2], [6, 'ranked', false, true, 2],
    [8, 'quick', false, true, 3], [9, 'ranked', false, true, 3],
  ];
  let good = true;
  for (const [base, entry, isTeam, team2, ts] of cases) {
    const pc = ts ? ts * 2 : 2;
    const p = sc.capParamsOf(base, pc, null);
    if (p.entry !== entry || !!p.isTeam !== isTeam || !!p.team2 !== team2 || (p.ts | 0) !== ts) { good = false; console.log('  base=' + base + ' got ' + JSON.stringify(p)); }
    if (ts && p.teams.join('') !== Array.from({ length: pc }, (_, s) => v.teamOfSeat(s, ts)).join('')) good = false;
  }
  ok('[1] classic base codes 1-6,8,9 map to entry/isTeam/team2/ts/teams', good);
  const pe = sc.capParamsOf(7, 2, { startDepth: 5, endDepth: 11 });
  ok('[1] endless (7) maps tail through', pe.entry === 'endless' && pe.startDepth === 5 && pe.endDepth === 11);
  const hiBits = sc.capParamsOf(0x101, 2, null);   // premade/trio bits above the base nibble
  ok('[1] high mt bits do not disturb the base mapping', hiBits.entry === 'quick' && !hiBits.team2);
}

// ---- [2] CLI line protocol ----
{
  ok('[2] classic line', sc.cliLineOf('t', { entry: 'ranked', pc: 6, ts: 3, isTeam: false, team2: true, levels: 6, teams: [0, 0, 0, 1, 1, 1] }, -5) ===
    'C t -5 ranked 6 3 0 1 6 000111');
  ok('[2] ffa line (no teams -> dash)', sc.cliLineOf('t', { entry: 'quick', pc: 2, ts: 0, levels: 6, teams: [] }, 7) ===
    'C t 7 quick 2 0 0 0 6 -');
  ok('[2] endless line', sc.cliLineOf('t', { entry: 'endless', pc: 3, startDepth: 4, endDepth: 9, startBank: 12345.6 }, 42) ===
    'E t 42 3 4 9 12346');
}

// ---- [3] endless chain carry bound ----
{
  const st = { chain: {} };
  ok('[3] fresh session -> 0', sc.chainStartBank(st, [v.pid(SIDA)], 2, 0) === 0);
  const fb = sc.chainStartBank(st, [v.pid(SIDA)], 2, 10);
  ok('[3] no chain -> generous legacy bound (goalFor x SCORE_MULT)', fb === Math.round(v.endlessGoalFor(10, 2) * v.ENDLESS.SCORE_MULT), String(fb));
  st.chain[v.pid(SIDA) + ':2'] = { d: 10, cap: 5000 };
  ok('[3] audited chain wins when deep enough', sc.chainStartBank(st, [v.pid(SIDA)], 2, 10) === 5000);
  ok('[3] chain shallower than resume depth -> fallback', sc.chainStartBank(st, [v.pid(SIDA)], 2, 12) === Math.round(v.endlessGoalFor(12, 2) * v.ENDLESS.SCORE_MULT));
  st.chain[v.pid(SIDB) + ':2'] = { d: 10, cap: 9000 };
  ok('[3] max across roster pids', sc.chainStartBank(st, [v.pid(SIDA), v.pid(SIDB)], 2, 10) === 9000);
  ok('[3] chain is per seat-count bucket', sc.chainStartBank(st, [v.pid(SIDA)], 3, 10) === Math.round(v.endlessGoalFor(10, 3) * v.ENDLESS.SCORE_MULT));
}

// ---- [4] pickAuditable ----
{
  const st = { audited: { done_1_1: { c: 1, t: 1 } }, chain: {} };
  const gOk = [mkRec(1, 7, 2, [100, 200], [SIDA, SIDB]), mkRec(1, 7, 2, [100, 200], [SIDA, SIDB])];
  const gBadVec = [mkRec(1, 8, 2, [100, 200], [SIDA, SIDB]), mkRec(1, 8, 2, [100, 999], [SIDA, SIDB])];
  const gEndless = [mkRec(7, 9, 2, [500, 600], [SIDA, SIDB], { startDepth: 0, endDepth: 6 }),
    mkRec(7, 9, 2, [500, 600], [SIDA, SIDB], { startDepth: 0, endDepth: 8 })];
  const groups = { m1: gOk, m2: gBadVec, m3: gEndless, done_1_1: gOk, m5: [mkRec(0, 1, 2, [1, 1], [SIDA, SIDB])] };
  const pend = sc.pickAuditable(st, groups);
  const keys = pend.map(x => x.m).sort().join(',');
  ok('[4] picks consistent, skips inconsistent/audited/bad-mt', keys === 'm1,m3', keys);
  const e = pend.find(x => x.m === 'm3');
  ok('[4] endless widest tail wins (fail-open on range)', e.tail.endDepth === 8);
  ok('[4] endless gets a startBank', typeof e.p.startBank === 'number');
  ok('[4] roster consensus threads through', e.roster[0] === SIDA && e.roster[1] === SIDB);
}

// ---- [5] applyAudit state machine ----
{
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const pend = [
    { m: 'ok1', mt: 1, pc: 2, scores: [100, 200], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, runSeed: 1 },
    { m: 'over1', mt: 1, pc: 2, scores: [100, 99999], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, runSeed: 2 },
    { m: 'err1', mt: 1, pc: 2, scores: [1, 1], p: { entry: 'quick' }, tail: null, roster: {}, runSeed: 3 },
    { m: 'eok', mt: 7, pc: 2, scores: [500, 600], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 8 }, roster: { 0: SIDA, 1: SIDB }, runSeed: 4 },
    { m: 'eover', mt: 7, pc: 2, scores: [88888, 1], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 5 }, roster: { 0: SIDA, 1: SIDB }, runSeed: 5 },
  ];
  const cli = { m0: { cap: 5000 }, m1: { cap: 5000 }, m2: { err: 'bad-depths' }, m3: { cap: 40000 }, m4: { cap: 40000 } };
  const stats = sc.applyAudit(st, pend, cli, new Set(['eover']), 1000);
  ok('[5] stats ok/over/err', stats.okN === 2 && stats.over === 2 && stats.errN === 1, JSON.stringify(stats));
  ok('[5] over-cap -> veto with seats', st.veto.over1 && st.veto.over1.seats.join(',') === '1' && st.veto.eover.seats.join(',') === '0');
  ok('[5] suspect ledger by pid (over seat only)', !!st.suspects[v.pid(SIDB)] && st.suspects[v.pid(SIDB)].n === 1 && !st.suspects[v.pid(SIDA)] === false && st.suspects[v.pid(SIDA)].n === 1);
  ok('[5] correction queued ONLY for processed endless over-cap', st.corrections.length === 1 && st.corrections[0].m === 'eover' && st.corrections[0].seats.join(',') === '0');
  ok('[5] honest endless extends both chains', st.chain[v.pid(SIDA) + ':2'] && st.chain[v.pid(SIDA) + ':2'].d === 8 && st.chain[v.pid(SIDB) + ':2'].cap === 40000);
  ok('[5] over-cap endless does NOT extend chain', st.chain[v.pid(SIDA) + ':2'].d === 8);
  ok('[5] ERR remembered fail-open (audited, no veto/suspect)', st.audited.err1 && st.audited.err1.e === 'bad-depths' && !st.veto.err1);
  ok('[5] all audited recorded', Object.keys(st.audited).length === 5);
  // idempotence: a re-run must not double-count (audited gate lives in pickAuditable)
  const pend2 = sc.pickAuditable(st, { over1: [mkRec(1, 2, 2, [100, 99999], [SIDA, SIDB])] });
  ok('[5] re-run picks nothing (audited gate)', pend2.length === 0);
}

// ---- [6] pruneState bounds ----
{
  const st = { audited: {}, chain: {}, suspects: {}, veto: { old: { t: 0 }, fresh: { t: 999999 } }, corrections: [{ id: 'a', m: 'x' }, { id: 'b', m: 'y' }] };
  for (let i = 0; i < sc.AUDITED_KEEP + 50; i++) st.audited['m' + i] = { t: i };
  sc.pruneState(st, new Set(['a']), 999999 + 1);
  ok('[6] audited bounded to AUDITED_KEEP, oldest dropped', Object.keys(st.audited).length === sc.AUDITED_KEEP && !st.audited.m0 && !!st.audited['m' + (sc.AUDITED_KEEP + 49)]);
  ok('[6] veto expires after VETO_KEEP_MIN, fresh kept', !st.veto.old && !!st.veto.fresh);
  ok('[6] applied corrections pruned, pending kept', st.corrections.length === 1 && st.corrections[0].id === 'b');
}

// ---- [7] wiring pins ----
{
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'seedcap.yml'), 'utf8');
  ok('[7] seedcap.yml windows runner (MSVC CLI)', /runs-on: windows-latest/.test(yml));
  ok('[7] seedcap.yml fetches the artifact repo via deploy key', /gmt-authority-dist/.test(yml) && /SEEDCAP_DIST_KEY/.test(yml));
  // main + playtest twin + demo twin (third app id, 2026-09-05): every channel job keeps its own state file
  const SC_JOBS = 3;
  ok('[7] seedcap.yml has main + playtest + demo twins with isolated state', /SC_STATE_FILE: seedcap\.json/.test(yml) && /SC_STATE_FILE: pt-seedcap\.json/.test(yml) && /SC_STATE_FILE: demo-seedcap\.json/.test(yml));
  ok('[7] seedcap.yml persists ONLY its own state files', /git add -- seedcap\.json/.test(yml) && /git add -- pt-seedcap\.json/.test(yml) && /git add -- demo-seedcap\.json/.test(yml) && !/git add -- [^\n]*processed/.test(yml));
  ok('[7] seedcap.yml 3-retry rebase persist (one per job)', (yml.match(/until git pull --rebase/g) || []).length === SC_JOBS);
  const vjs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  ok('[7] validate consults veto under SEEDCAP_ENFORCE (flag-dont-settle shape)', /SEEDCAP_ENFORCE && seedcap && seedcap\.veto/.test(vjs));
  ok('[7] validate suspect refusal under SEEDCAP_REJECT', /SEEDCAP_REJECT && seedcap && seedcap\.suspects/.test(vjs));
  ok('[7] validate applies corrections via DeleteLeaderboardScore + signals.seedcapApplied handshake', /seedcapApplied/.test(vjs) && /seedcap correction/.test(vjs));
  ok('[7] validate never writes the seedcap state (single-writer)', vjs.indexOf('saveSeedcap') < 0 && vjs.indexOf('writeFileSync(SC_STATE_FILE') < 0);
  const scjs = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[7] seedcap.js never writes reconcile-owned files', scjs.indexOf('writeFileSync(PROCESSED_FILE') < 0 && scjs.indexOf('writeFileSync(SIGNALS_FILE') < 0);
  // 2026-09-01: the auditor now writes exactly ONE board -- the PRESERVE-class offense
  // mirror -- and still never touches a game board (settlement stays the reconcile's).
  ok('[7] seedcap.js never deletes board entries', scjs.indexOf('DeleteLeaderboardScore') < 0);
  ok('[7] seedcap.js single board write = the offense mirror', (scjs.match(/SetLeaderboardScore/g) || []).length === 1 &&
    (scjs.match(/findOrCreateBoard\(/g) || []).length === 1 && /findOrCreateBoard\(OFFENSE_LB\)/.test(scjs));
  ok('[7] seedcap.yml carries the mail channel on every job',
    (yml.match(/RESEND_API_KEY: \$\{\{ secrets\.RESEND_API_KEY \}\}/g) || []).length === SC_JOBS &&
    (yml.match(/FB_DIGEST_TO: \$\{\{ secrets\.FB_DIGEST_TO \}\}/g) || []).length === SC_JOBS);
  ok('[7] playtest / demo seedcap jobs tag their mail', /FB_DIGEST_TAG: '\[playtest\] '/.test(yml) && /FB_DIGEST_TAG: '\[demo\] '/.test(yml));
  const ptyml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'playtest.yml'), 'utf8');
  ok('[7] playtest reconcile ENFORCE armed (2026-09-01; flipping back is a deliberate act)', /SEEDCAP_ENFORCE: '1'/.test(ptyml));
  ok('[7] playtest REJECT not armed yet (2-week enforce soak first)', !/SEEDCAP_REJECT: '1'/.test(ptyml));
  const mainyml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8');
  ok('[7] main-app reconcile still observe-only (flips in the EA pre-launch batch)', /SEEDCAP_ENFORCE: '0'/.test(mainyml));
  ok('[7] state stays ascii-escaped (public-repo discipline)', /\\\\u0080-\\\\uffff|u0080-/.test(scjs.replace(/\n/g, ' ')) || /charCodeAt\(0\)\.toString\(16\)/.test(scjs));
}

// ---- [8] offense mirror + anomaly mail (2026-09-01) ----
{
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  st.suspects[v.pid(SIDB)] = { n: 5, t0: 1, ms: [] };   // prior offenses: plan must mirror the ABSOLUTE ledger, not this run's count
  const pend = [
    { m: 'ov1', mt: 1, pc: 2, scores: [100, 7777], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, runSeed: 11 },
    { m: 'ov2', mt: 7, pc: 2, scores: [8888, 1], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 3 }, roster: { 0: SIDB, 1: SIDA }, runSeed: 12 },
  ];
  const stats = sc.applyAudit(st, pend, { m0: { cap: 5000 }, m1: { cap: 6000 } }, new Set(), 2000);
  ok('[8] flags carry sid-resolved offenders + match cap/seed/mt', stats.flags.length === 2 &&
    stats.flags[0].offenders[0].sid === SIDB && stats.flags[0].offenders[0].score === 7777 && stats.flags[0].cap === 5000 &&
    stats.flags[1].offenders[0].sid === SIDB && stats.flags[1].mt === 7 && stats.flags[1].runSeed === 12);
  ok('[8] flags never persist (sids stay out of the public state)', JSON.stringify(st).indexOf(SIDB) < 0);
  const plan = sc.offensePlanOf(st, stats.flags);
  ok('[8] plan score = suspects[pid].n absolute (prior 5 + 2 this run -> 7; idempotent rewrite)',
    plan[SIDB] && plan[SIDB].score === 7 && Object.keys(plan).length === 1);
  ok('[8] alert thresholds pinned (3 over/run mass floor, 5 suspect floor; env-overridable)',
    sc.SC_MAIL_MIN_OVER === 3 && sc.SC_MAIL_SUS_MIN === 5);
  ok('[8] plan details = [magic,t,seed,mt,cap,claimed] of the LATEST offense',
    plan[SIDB].details.join(',') === [sc.OFFENSE_MAGIC, 2000, 12, 7, 6000, 8888].join(','));
  ok('[8] offense magic stays clear of the known details namespace', sc.OFFENSE_MAGIC === 0xC7);
  ok('[8] board name default + PRESERVE-class intent', sc.OFFENSE_LB === 'seedcap_offense');
  ok('[8] below both thresholds -> silent', sc.mailDecision(sc.SC_MAIL_MIN_OVER - 1, sc.SC_MAIL_SUS_MIN - 1, 0).send === false);
  ok('[8] mass over-cap in one run -> mail', sc.mailDecision(sc.SC_MAIL_MIN_OVER, 0, 0).send === true);
  const d1 = sc.mailDecision(0, sc.SC_MAIL_SUS_MIN, 0);
  ok('[8] suspect floor crossed -> mail once, watermark advances', d1.send && d1.mailedSus === sc.SC_MAIL_SUS_MIN);
  ok('[8] same suspect total again -> silent (watermark)', sc.mailDecision(0, sc.SC_MAIL_SUS_MIN, d1.mailedSus).send === false);
  ok('[8] growth past watermark -> mail again', sc.mailDecision(0, sc.SC_MAIL_SUS_MIN + 1, d1.mailedSus).send === true);
  const scjs2 = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[8] unconfigured mail returns false BEFORE any fetch (watermark stays put)', /if \(!to \|\| !apiKey\) return false/.test(scjs2));
  ok('[8] watermark advances only on a delivered mail', /md\.send && await sendAlertMail[\s\S]{0,200}st\.mailSus = md\.mailedSus/.test(scjs2));
  // comments and the mail-body advice string may NAME the switches; code must never READ them
  ok('[8] offense write is unconditional on the enforce switches (analysis record from observation on)',
    scjs2.indexOf('process.env.SEEDCAP_ENFORCE') < 0 && scjs2.indexOf('process.env.SEEDCAP_REJECT') < 0);
}

// ---- [9] reject window ladder (2026-09-05): per-account discard inside a bounded window, never permanent ----
{
  ok('[9] ladder 24h / 3d / 7d / 14d by conviction count, capped', [1, 2, 3, 4, 9].map(v.seedcapRejectWindowMin).join(',') === '1440,4320,10080,20160,20160');
  ok('[9] ladder table pinned', JSON.stringify(v.SEEDCAP_REJECT_LADDER_MIN) === '[1440,4320,10080,20160]');
  const su1 = { n: 1, t0: 5, t1: 1000, ms: [] };
  ok('[9] active until t1 + window (end exclusive)', v.seedcapRejectActive(su1, 2439) && !v.seedcapRejectActive(su1, 2440));
  ok('[9] t1 (latest conviction) wins over t0', v.seedcapRejectUntilMin(su1) === 2440);
  ok('[9] legacy entry without t1 falls back to t0', v.seedcapRejectUntilMin({ n: 2, t0: 100 }) === 100 + 4320);
  ok('[9] no entry = no window', v.seedcapRejectUntilMin(null) === null && !v.seedcapRejectActive(undefined, 0));
  ok('[9] 4+ convictions never exceed the 14-day cap', v.seedcapRejectUntilMin({ n: 40, t1: 0 }) === 20160);
  const stw = { suspects: {} };
  stw.suspects.aa = { n: 1, t0: 0, t1: 1000, ms: [] };   // until 2440
  stw.suspects.bb = { n: 3, t0: 0, t1: 100, ms: [] };    // until 10180
  stw.suspects.cc = { n: 1, t0: 0, t1: 0, ms: [] };      // until 1440 -> expired at 2000
  const w = sc.rejectWindowsOf(stw, 2000);
  ok('[9] rejectWindowsOf = active only, soonest first, with time left', w.length === 2 && w[0].pid === 'aa' && w[0].leftMin === 440 && w[1].pid === 'bb' && w[1].n === 3);
  const st2 = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  st2.suspects[v.pid(SIDB)] = { n: 1, t0: 1, t1: 1, ms: [] };
  const pend9 = [{ m: 'w1', mt: 1, pc: 2, scores: [100, 7777], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, runSeed: 21 }];
  const stats9 = sc.applyAudit(st2, pend9, { m0: { cap: 5000 } }, new Set(), 3000);
  ok('[9] second conviction: n=2, t1 = new conviction time, flag carries n', st2.suspects[v.pid(SIDB)].n === 2 && st2.suspects[v.pid(SIDB)].t1 === 3000 && stats9.flags[0].offenders[0].n === 2);
  ok('[9] window restarts at the latest conviction (3 days from t=3000)', v.seedcapRejectUntilMin(st2.suspects[v.pid(SIDB)]) === 3000 + 4320);
  const text = sc.alertMailText(['x'], stats9.flags, { veto: 1, suspects: 1 }, sc.rejectWindowsOf(st2, 3000));
  ok('[9] mail carries per-offender n + window and the open-window list', /n=2 window=72h/.test(text) && /reject windows now open/.test(text) && /n=2 until 1970-01-06T02:00:00Z \(72h left\)/.test(text));
  ok('[9] mail with no open window says so', /\(none\)/.test(sc.alertMailText(['x'], [], { veto: 0, suspects: 0 }, [])));
  ok('[9] mail never carries sids outside this run\'s flags (windows are pid-only)', JSON.stringify(w).indexOf(SIDA) < 0 && JSON.stringify(w).indexOf(SIDB) < 0);
  // validate.js wiring: consult the window (not bare membership), discard the account (never skip
  // the match), snapshot every per-sid output pool the loop can produce, flush after the loop.
  const vjs9 = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  ok('[9] validate consults the window, not bare suspect membership', /seedcapRejectActive\(seedcap\.suspects\[pid\(sid\)\], nowMin\)/.test(vjs9));
  const blk = vjs9.slice(vjs9.indexOf('if (SEEDCAP_REJECT && seedcap && seedcap.suspects)'), vjs9.indexOf('// ===== endless (type 7)'));
  ok('[9] reject block discards the account and never skips the match', blk.length > 0 && /own settlement discarded/.test(blk) && !/\bcontinue;/.test(blk));
  const snap = vjs9.slice(vjs9.indexOf('const scSnapshotOf = '), vjs9.indexOf('const scPut = '));
  const rest = vjs9.slice(vjs9.indexOf('const scRestore = '), vjs9.indexOf('let scPendingRestore = null;'));
  const pools = [];
  const declRe = /const (changed\w*|lp|xp|cp|endless\w*Best|careerDet|reveal) = \{\}/g;
  let dm;
  while ((dm = declRe.exec(vjs9))) if (pools.indexOf(dm[1]) < 0) pools.push(dm[1]);
  const notSnapped = pools.filter(p => snap.indexOf(p + ': ' + p + '[sid]') < 0 && snap.indexOf(p + '[sid]') < 0);
  const notRestored = pools.filter(p => rest.indexOf('scPut(' + p + ', sn.sid') < 0);
  ok('[9] snapshot/restore cover every per-sid pool declared in the settle scope (' + pools.length + ')', pools.length >= 12 && notSnapped.length === 0 && notRestored.length === 0, 'snap-missing=' + notSnapped.join(',') + ' restore-missing=' + notRestored.join(','));
  ok('[9] snapshot/restore cover the pid-keyed state too (skill + xpState, deep-cloned)', /scCloneOf\(skill\[p\]\)/.test(snap) && /scCloneOf\(xpState\[p\]\)/.test(snap) && /scPut\(skill, p, sn\.skill\)/.test(rest) && /scPut\(xpState, p, sn\.xpState\)/.test(rest));
  ok('[9] pending restore flushed at loop top AND after the loop', (vjs9.match(/if \(scPendingRestore\) \{ scRestore\(scPendingRestore\); scPendingRestore = null; \}/g) || []).length === 2);
  ok('[9] run summary reports the discards', /seedcap veto \/ reject-window discards/.test(vjs9));
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (e) {}
console.log(fail ? '\n[seedcap-audit] FAIL ' + fail + ' (pass ' + pass + ')' : '\n[seedcap-audit] all green (' + pass + ')');
process.exit(fail ? 1 : 0);
