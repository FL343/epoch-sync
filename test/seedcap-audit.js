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
  ok('[7] seedcap.yml has main + playtest twin with isolated state', /SC_STATE_FILE: seedcap\.json/.test(yml) && /SC_STATE_FILE: pt-seedcap\.json/.test(yml));
  ok('[7] seedcap.yml persists ONLY its own state files', /git add -- seedcap\.json/.test(yml) && /git add -- pt-seedcap\.json/.test(yml) && !/git add -- [^\n]*processed/.test(yml));
  ok('[7] seedcap.yml 3-retry rebase persist', (yml.match(/until git pull --rebase/g) || []).length === 2);
  const vjs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  ok('[7] validate consults veto under SEEDCAP_ENFORCE (flag-dont-settle shape)', /SEEDCAP_ENFORCE && seedcap && seedcap\.veto/.test(vjs));
  ok('[7] validate suspect refusal under SEEDCAP_REJECT', /SEEDCAP_REJECT && seedcap && seedcap\.suspects/.test(vjs));
  ok('[7] validate applies corrections via DeleteLeaderboardScore + signals.seedcapApplied handshake', /seedcapApplied/.test(vjs) && /seedcap correction/.test(vjs));
  ok('[7] validate never writes the seedcap state (single-writer)', vjs.indexOf('saveSeedcap') < 0 && vjs.indexOf('writeFileSync(SC_STATE_FILE') < 0);
  const scjs = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[7] seedcap.js never writes reconcile-owned files', scjs.indexOf('writeFileSync(PROCESSED_FILE') < 0 && scjs.indexOf('writeFileSync(SIGNALS_FILE') < 0);
  ok('[7] seedcap.js never posts board writes (no SetLeaderboardScore/Delete)', scjs.indexOf('SetLeaderboardScore') < 0 && scjs.indexOf('DeleteLeaderboardScore') < 0);
  ok('[7] state stays ascii-escaped (public-repo discipline)', /\\\\u0080-\\\\uffff|u0080-/.test(scjs.replace(/\n/g, ' ')) || /charCodeAt\(0\)\.toString\(16\)/.test(scjs));
}

try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (e) {}
console.log(fail ? '\n[seedcap-audit] FAIL ' + fail + ' (pass ' + pass + ')' : '\n[seedcap-audit] all green (' + pass + ')');
process.exit(fail ? 1 : 0);
