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
// wr = { w, seat }: the shard entry owner (writer) and the record's own seat (d[5]); absent = no writer identity
function mkRec(mt, seed, pc, scores, roster, tail, wr) {
  const d = [0xB1, 3, mt, 1234, seed | 0, wr ? (wr.seat | 0) : 0, 1, 0, pc, 300];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(0);   // disp
  for (let i = 0; i < pc; i++) { const si = sidInts(roster[i] || '0'); d.push(si[0], si[1]); }
  if (tail) {
    d.push(tail.startDepth | 0, tail.endDepth | 0, 0, 0);
    // knife 3.5c2a-A: optional extended team tail (season / flags / build / pick log / reroll bitmap) in record order
    if (tail.seasonId != null || tail.flags != null || tail.build != null || tail.picksLo != null) {
      d.push(tail.seasonId == null ? 0 : (tail.seasonId | 0), tail.flags | 0);
      if (tail.build != null || tail.picksLo != null) d.push(tail.build >>> 0, tail.picksLo | 0, tail.picksHi | 0, tail.rerollLo | 0, tail.rerollHi | 0);
    }
  }
  const r = { d, roster: v.decodeRoster(d) };
  if (wr) r.w = String(wr.w);
  return r;
}
// guard-signed SOLO record (attest layout attVer 5, BASE_LEN 30 + 16 sig ints): the tail sits at fixed offsets (@14..@19), keyId @20,
//   attVer @21, build @25, pick log @26/@27, reroll bitmap @28/@29 -- the ints the team-shaped read would misinterpret (O289)
function mkSolo(seed, score, sid, t, wr) {
  const d = new Array(46).fill(0);
  d[0] = 0xB1; d[1] = 3; d[2] = 7; d[3] = 4321; d[4] = seed | 0; d[5] = 0; d[6] = 1; d[7] = 0; d[8] = 1; d[9] = 300; d[10] = score | 0; d[11] = 0;
  const si = sidInts(sid); d[12] = si[0]; d[13] = si[1];
  d[14] = t.startDepth | 0; d[15] = t.endDepth | 0; d[16] = t.continuesUsed | 0; d[17] = t.tokensCp | 0; d[18] = t.seasonId | 0; d[19] = t.flags | 0;
  d[20] = t.keyId | 0; d[21] = 5; d[22] = 7; d[23] = 11; d[24] = 13;
  d[25] = t.build >>> 0; d[26] = t.picksLo | 0; d[27] = t.picksHi | 0; d[28] = t.rerollLo | 0; d[29] = t.rerollHi | 0;
  const r = { d, roster: v.decodeRoster(d) };
  if (wr) r.w = String(wr.w);
  return r;
}
const SIDA = '76561198000000001', SIDB = '76561198000000002', SIDX = '76561198000000009';

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
  ok('[2] endless line + season (7th field; 2026-09-05)', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 0, endDepth: 9, startBank: 0, seasonId: 1 }, 42) ===
    'E t 42 2 0 9 0 1');
  ok('[2] endless line + season + build + reroll bitmap (9th/10th fields; 2026-09-11)', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 0, endDepth: 9, startBank: 0, seasonId: 1, build: 386, rerollLo: 5, rerollHi: 0 }, 42) ===
    'E t 42 2 0 9 0 1 386 5 0');
  ok('[2] endless line + rerolls without build/season -> explicit -1 season + 0 build sentinels then the bitmap', sc.cliLineOf('t', { entry: 'endless', pc: 1, startDepth: 3, endDepth: 6, startBank: 100, rerollLo: 0, rerollHi: 1 }, 42) ===
    'E t 42 1 3 6 100 -1 0 0 1');
  ok('[2] capParamsOf(7) carries the tail reroll bitmap', (() => { const p = sc.capParamsOf(7, 1, { startDepth: 0, endDepth: 6, seasonId: 1, build: 0, rerollLo: 3, rerollHi: 0 }); return p.rerollLo === 3 && p.rerollHi === 0; })());
  ok('[2] cliSupportsRerolls: V probe answer parsed (rerolls=1 -> true; ERR / nothing -> false)', sc.cliSupportsRerolls(() => ({ map: { p0: { v: 'build=1 rerolls=1' } } })) === true && sc.cliSupportsRerolls(() => ({ map: { p0: { err: 'bad-kind' } } })) === false && sc.cliSupportsRerolls(() => ({ fail: 'exit=2' })) === false);
  ok('[2] endless line legacy tail (seasonId -1 -> omitted)', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 0, endDepth: 9, startBank: 0, seasonId: -1 }, 42) ===
    'E t 42 2 0 9 0');
  ok('[2] capParamsOf carries the tail season (absent -> -1)',
    sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 9, seasonId: 2 }).seasonId === 2 && sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 9 }).seasonId === -1);
  // perk build word (2026-09-07): 8th field, positional after an explicit season; omitted when 0 (pre-perk lines unchanged)
  ok('[2] endless line + season + build (8th field)', sc.cliLineOf('t', { entry: 'endless', pc: 1, startDepth: 0, endDepth: 9, startBank: 0, seasonId: 1, build: 41411 }, 42) ===
    'E t 42 1 0 9 0 1 41411');
  ok('[2] endless line legacy tail + build -> explicit -1 season sentinel keeps the field positional', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 0, endDepth: 9, startBank: 0, seasonId: -1, build: 5 }, 42) ===
    'E t 42 2 0 9 0 -1 5');
  ok('[2] build 0 leaves the line untouched', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 0, endDepth: 9, startBank: 0, seasonId: 1, build: 0 }, 42) === 'E t 42 2 0 9 0 1');
  // knife 3.5c2a-A: p.build = the replayed SEGMENT-START build (a build word without a pick log cannot replay = 0 -- an honest record
  //   always carries the log; the end-of-record word is kept as buildEnd for cores without the builds= token); absent -> 0 / 0
  ok('[2] capParamsOf: build word without a pick log -> start build 0, buildEnd keeps the word; absent -> 0',
    (() => { const a = sc.capParamsOf(7, 1, { startDepth: 0, endDepth: 9, seasonId: 2, build: 386 }), b = sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 9, seasonId: 2 }); return a.build === 0 && a.buildEnd === 386 && b.build === 0 && b.buildEnd === 0; })());
  // classic (nostalgia) segments (2026-09-30): SEG_CLASSIC in the flags word -> classic world; build / bitmap forced to 0
  //   (a classic run has neither by rule, and the signed solo record keeps other words at those tail offsets)
  const pcl = sc.capParamsOf(7, 1, { startDepth: 0, endDepth: 3, seasonId: 0, flags: 32 | 2, build: 2026092701, rerollLo: 123, rerollHi: 456 });
  ok('[2] classic flags -> classic world, garbage build / bitmap words dropped', pcl.classic === true && pcl.build === 0 && pcl.rerollLo === 0 && pcl.rerollHi === 0);
  const pmod = sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 9, seasonId: 1, flags: 8, build: 386, rerollLo: 5, rerollHi: 0 });
  ok('[2] non-classic flags leave the build word (buildEnd) / bitmap untouched', pmod.classic === false && pmod.buildEnd === 386 && pmod.rerollLo === 5);
  ok('[2] classic line = explicit sentinels then 1 (11th field)', sc.cliLineOf('t', Object.assign({}, pcl, { startBank: 0 }), 42) === 'E t 42 1 0 3 0 0 0 0 0 1');
  ok('[2] classic line on a legacy tail keeps the -1 season sentinel', sc.cliLineOf('t', { entry: 'endless', pc: 2, startDepth: 5, endDepth: 6, startBank: 7, seasonId: -1, classic: true }, 42) === 'E t 42 2 5 6 7 -1 0 0 0 1');
  ok('[2] classic capability probe', sc.cliSupportsClassic(() => ({ map: { p0: { v: 'build=1 rerolls=1 classic=1' } } })) === true &&
    sc.cliSupportsClassic(() => ({ map: { p0: { v: 'build=1 rerolls=1' } } })) === false && sc.cliSupportsClassic(() => ({ fail: 'exit=1' })) === false);
  const scsrc = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[2] classic groups deferred when the primary CLI cannot read the flag', /x\.p\.classic\) && !cliSupportsClassic\(runPrimary\)/.test(scsrc));
  ok('[2] overlap cores skip classic lines they cannot read', /if \(!okCl && x\.p && x\.p\.classic\) return;/.test(scsrc));
  // CLI build-support probe (knife 3.5c2a-A): the "V" answer's build=1 token, no cap-rise probe with a hard-coded perk word
  //   (that probe pinned perk id 2's clear-bonus semantics; knife B changes it -> every perk run would have been deferred)
  ok('[2] cliSupportsBuild: V answer build=1 -> true', sc.cliSupportsBuild(() => ({ map: { p0: { v: 'build=1 rerolls=1 classic=1 builds=1 absidx=1' } } })) === true);
  ok('[2] cliSupportsBuild: V answer without build=1 / ERR / failure -> false (defer, never audit with the wrong cap)',
    sc.cliSupportsBuild(() => ({ map: { p0: { v: 'rerolls=1' } } })) === false && sc.cliSupportsBuild(() => ({ fail: 'exit=1' })) === false && sc.cliSupportsBuild(() => ({ map: { p0: { err: 'bad-kind' } } })) === false);
  ok('[2] probe line = V p0 (no cap probe)', (() => { let seen = null; sc.cliSupportsBuild((lines) => { seen = lines; return { map: { p0: { v: 'build=1' } } }; }); return JSON.stringify(seen) === JSON.stringify(['V p0']); })());
  ok('[2] cliSupportsBuilds: V answer builds=1 (per-draw list token)', sc.cliSupportsBuilds(() => ({ map: { p0: { v: 'build=1 rerolls=1 classic=1 builds=1 absidx=1' } } })) === true && sc.cliSupportsBuilds(() => ({ map: { p0: { v: 'build=1 rerolls=1 classic=1' } } })) === false);
  ok('[2] no PROBE_BUILD constant left (source + export)', sc.PROBE_BUILD === undefined && !/PROBE_BUILD/.test(require('fs').readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8')));
  ok('[2] auditPending defers build-carrying groups when the CLI ignores the field (source pin)',
    // probes ride the selected primary core (versioned cores: test/seedcap-cores.js)
    /if \(pending\.some\(x => x\.p && x\.p\.build\) && !cliSupportsBuild\(runPrimary\)\)/.test(require('fs').readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8')));
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
  ok('[4] records without a writer identity prove no seat (fail closed)', e.self.length === 0);
  // self-written seats: writer at its own seat (d[5]) whose roster entry is the writer itself
  const gSelf = { s1: [mkRec(1, 30, 2, [100, 200], [SIDA, SIDB], null, { w: SIDA, seat: 0 }), mkRec(1, 30, 2, [100, 200], [SIDA, SIDB], null, { w: SIDB, seat: 1 })],
    s2: [mkRec(1, 31, 2, [100, 200], [SIDB, SIDA], null, { w: SIDX, seat: 0 })],       // writer X claims the victim sits at X's own seat
    s3: [mkRec(1, 32, 2, [100, 200], [SIDX, SIDB], null, { w: SIDX, seat: 0 })] };     // writer X names itself + a stranger
  const ps = sc.pickAuditable({ audited: {}, chain: {} }, gSelf);
  const selfOf = (m) => ps.find(x => x.m === m).self.join(',');
  ok('[4] both writers at their own seats -> both self-written', selfOf('s1') === '0,1', selfOf('s1'));
  ok('[4] a roster that puts somebody else at the writer\'s seat proves nothing', selfOf('s2') === '');
  ok('[4] a lone writer is self-written only at its own seat', selfOf('s3') === '0', selfOf('s3'));
}

// ---- [5] applyAudit state machine ----
{
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const pend = [
    { m: 'ok1', mt: 1, pc: 2, scores: [100, 200], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 1 },
    { m: 'over1', mt: 1, pc: 2, scores: [100, 99999], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 2 },
    { m: 'err1', mt: 1, pc: 2, scores: [1, 1], p: { entry: 'quick' }, tail: null, roster: {}, runSeed: 3 },
    { m: 'eok', mt: 7, pc: 2, scores: [500, 600], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 8 }, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 4 },
    { m: 'eover', mt: 7, pc: 2, scores: [88888, 1], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 5 }, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 5 },
  ];
  const cli = { m0: { cap: 5000 }, m1: { cap: 5000 }, m2: { err: 'bad-depths' }, m3: { cap: 40000 }, m4: { cap: 40000 } };
  const stats = sc.applyAudit(st, pend, cli, new Set(['eover']), 1000);
  ok('[5] stats ok/over/err', stats.okN === 2 && stats.over === 2 && stats.errN === 1, JSON.stringify(stats));
  ok('[5] over-cap -> veto with seats', st.veto.over1 && st.veto.over1.seats.join(',') === '1' && st.veto.eover.seats.join(',') === '0');
  ok('[5] suspect ledger by pid (over seat only)', !!st.suspects[v.pid(SIDB)] && st.suspects[v.pid(SIDB)].n === 1 && !st.suspects[v.pid(SIDA)] === false && st.suspects[v.pid(SIDA)].n === 1);
  ok('[5] correction queued ONLY for processed endless over-cap', st.corrections.length === 1 && st.corrections[0].m === 'eover' && st.corrections[0].seats.join(',') === '0');
  ok('[5] honest endless extends both (self-written) chains under the per-run key pid:pc:runSeed', st.chain[sc.chainKey(v.pid(SIDA), 2, 4)] && st.chain[sc.chainKey(v.pid(SIDA), 2, 4)].d === 8 && st.chain[sc.chainKey(v.pid(SIDB), 2, 4)].cap === 40000 && st.chain[sc.chainKey(v.pid(SIDB), 2, 4)].t === 1000);
  ok('[5] over-cap endless does NOT extend chain', st.chain[sc.chainKey(v.pid(SIDA), 2, 4)].d === 8 && !st.chain[sc.chainKey(v.pid(SIDA), 2, 5)]);
  ok('[5] no legacy pid:pc key written any more', !st.chain[v.pid(SIDA) + ':2'] && !st.chain[v.pid(SIDB) + ':2']);
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
  ok('[7] playtest REJECT armed (2026-09-18, after the clean 2-week enforce soak; flipping back is a deliberate act)', /SEEDCAP_REJECT: '1'/.test(ptyml));
  ok('[7] demo REJECT armed with its twin', /SEEDCAP_REJECT: '1'/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'demo.yml'), 'utf8')));
  ok('[7] main-app REJECT still off (arms in the EA pre-launch batch with ENFORCE)', !/SEEDCAP_REJECT: '1'/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8')));
  const mainyml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8');
  ok('[7] main-app reconcile still observe-only (flips in the EA pre-launch batch)', /SEEDCAP_ENFORCE: '0'/.test(mainyml));
  ok('[7] state stays ascii-escaped (public-repo discipline)', /\\\\u0080-\\\\uffff|u0080-/.test(scjs.replace(/\n/g, ' ')) || /charCodeAt\(0\)\.toString\(16\)/.test(scjs));
}

// ---- [8] offense mirror + anomaly mail (2026-09-01) ----
{
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  st.suspects[v.pid(SIDB)] = { n: 5, t0: 1, ms: [] };   // prior offenses: plan must mirror the ABSOLUTE ledger, not this run's count
  const pend = [
    { m: 'ov1', mt: 1, pc: 2, scores: [100, 7777], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 11 },
    { m: 'ov2', mt: 7, pc: 2, scores: [8888, 1], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 3 }, roster: { 0: SIDB, 1: SIDA }, self: [0, 1], runSeed: 12 },
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
  const pend9 = [{ m: 'w1', mt: 1, pc: 2, scores: [100, 7777], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [0, 1], runSeed: 21 }];
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

// ---- [10] conviction needs a self-written seat (2026-09-30): a roster is self-reported, the shard entry owner is not ----
{
  // one fake over-cap record written by X that names a stranger (SIDB) at seat 1: vetoed, nobody but a writer convicted
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const groups = {
    frame: [mkRec(1, 41, 2, [100, 999999], [SIDX, SIDB], null, { w: SIDX, seat: 0 })],
    frameOwnSeat: [mkRec(1, 42, 2, [999999, 1], [SIDB, SIDX], null, { w: SIDX, seat: 0 })],   // X claims the stranger sits at X's own seat
    selfOver: [mkRec(1, 43, 2, [999999, 1], [SIDX, SIDB], null, { w: SIDX, seat: 0 })],       // X's own seat over-cap -> X convicted
    team: [mkRec(1, 44, 2, [100, 999999], [SIDA, SIDB], null, { w: SIDA, seat: 0 }), mkRec(1, 44, 2, [100, 999999], [SIDA, SIDB], null, { w: SIDB, seat: 1 })],
  };
  const pend = sc.pickAuditable(st, groups);
  const cli = {}; pend.forEach((x, i) => { cli['m' + i] = { cap: 5000 }; });
  const stats = sc.applyAudit(st, pend, cli, new Set(), 4000);
  const fOf = (m) => stats.flags.find(f => f.m === m);
  ok('[10] every over-cap group still vetoed (no settlement gain either way)', ['frame', 'frameOwnSeat', 'selfOver', 'team'].every(m => st.veto[m]), Object.keys(st.veto).join(','));
  ok('[10] framing a stranger convicts nobody', fOf('frame').offenders.length === 0 && fOf('frame').unattributed.length === 1 && fOf('frame').unattributed[0].seat === 1);
  ok('[10] a stranger placed at the writer\'s own seat is not convicted', fOf('frameOwnSeat').offenders.length === 0 && fOf('frameOwnSeat').unattributed[0].seat === 0);
  ok('[10] a writer over cap at its own seat IS convicted', fOf('selfOver').offenders.length === 1 && fOf('selfOver').offenders[0].sid === SIDX);
  ok('[10] consensus team group: the over-cap seat wrote its own record -> convicted', fOf('team').offenders.length === 1 && fOf('team').offenders[0].sid === SIDB);
  // suspect ledger: X (selfOver) and SIDB (team, self-written) only; SIDB is NOT charged for the two frame attempts
  ok('[10] suspect ledger holds only self-written convictions', st.suspects[v.pid(SIDX)] && st.suspects[v.pid(SIDX)].n === 1 &&
    st.suspects[v.pid(SIDB)] && st.suspects[v.pid(SIDB)].n === 1 && !st.suspects[v.pid(SIDA)], JSON.stringify(Object.keys(st.suspects).length));
  const plan = sc.offensePlanOf(st, stats.flags);
  ok('[10] offense board plan names only convicted writers', Object.keys(plan).sort().join(',') === [SIDB, SIDX].sort().join(','));
  const text = sc.alertMailText(['x'], [fOf('frame')], { veto: 1, suspects: 0 }, []);
  ok('[10] ops mail shows the unattributed over-cap seat without a sid', /seat1=999999 \(not self-written: vetoed, nobody convicted\)/.test(text) && text.indexOf(SIDB) < 0);
  // mutation self-check: the same inputs without writer identities convict nobody at all (fail closed)
  const st0 = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const bare = {}; for (const m of Object.keys(groups)) bare[m] = groups[m].map(r => ({ d: r.d, roster: r.roster }));
  const pend0 = sc.pickAuditable(st0, bare);
  const cli0 = {}; pend0.forEach((x, i) => { cli0['m' + i] = { cap: 5000 }; });
  sc.applyAudit(st0, pend0, cli0, new Set(), 4000);
  ok('[10] no writer identity -> no conviction (fail closed), vetoes unchanged', Object.keys(st0.suspects).length === 0 && Object.keys(st0.veto).length === 4);
  const scsrc10 = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[10] shard read carries the entry owner into every group record', /push\(\{ d, roster: v\.decodeRoster\(d\), w: String\(e\.steamID \|\| ''\) \}\)/.test(scsrc10));
}


// ---- [11] O289 (knife 3.5c2a-A): a guard-signed solo record is read through its own layout ----
{
  const t = { startDepth: 5, endDepth: 10, continuesUsed: 0, tokensCp: 0, seasonId: 2, flags: 2, keyId: 2026093001, build: 386, picksLo: 0, picksHi: 0, rerollLo: 5, rerollHi: 0 };
  const r = mkSolo(99, 8000, SIDA, t, { w: SIDA });
  const team = v.endlessTail(r.d), solo = sc.tailOf(r.d);
  ok('[11] team-shaped read of a solo record takes keyId/attVer/opHash words as build/picks/bitmap (the bug)', team.build === 2026093001 && team.picksLo === 5 && team.rerollLo === 11);
  ok('[11] tailOf(pc=1) = attest.soloTail: build/picks/bitmap from @25..@29, keyId @20, same first six fields', solo.build === 386 && solo.picksLo === 0 && solo.rerollLo === 5 && solo.rerollHi === 0 && solo.keyId === 2026093001 && solo.attVer === 5 &&
    solo.startDepth === team.startDepth && solo.endDepth === team.endDepth && solo.seasonId === team.seasonId && solo.flags === team.flags);
  ok('[11] tailOf(pc>=2) = the client team tail', sc.tailOf(mkRec(7, 9, 2, [1, 2], [SIDA, SIDB], { startDepth: 0, endDepth: 6 }).d).endDepth === 6);
  ok('[11] a pc=1 record that is not a solo layout (magic/mt) falls back to the team read', (() => { const d = r.d.slice(); d[2] = 1; return sc.tailOf(d).startDepth === 5; })());
  const st = { audited: {}, chain: {} };
  const pend = sc.pickAuditable(st, { solo1: [r] });
  ok('[11] pickAuditable: solo group carries keyId (exact core routing) + build from the solo layout', pend.length === 1 && pend[0].keyId === 2026093001 && pend[0].p.keyId === 2026093001 && pend[0].p.rerollLo === 5);
  ok('[11] pickAuditable: pc>=2 groups carry keyId 0 (client-written)', sc.pickAuditable(st, { c: [mkRec(7, 9, 2, [1, 2], [SIDA, SIDB], { startDepth: 0, endDepth: 6 })] })[0].keyId === 0);
}

// ---- [12] segment-start build (knife 3.5c2a-A): the cap uses the build in effect at the segment start, replayed from the pick log ----
{
  const perks = require('../perks.js');
  const P = perks.load();
  // honest solo log over season 1: choose card 1 at every draw; n draws -> build after each draw
  const honest = (season, n, mode) => {
    const s = P.seasonSeed(season);
    let build = 0, skipBank = 0, seen = 0;
    const arr = P.emptyPicks();
    const after = [];
    for (let k = 0; k < n; k++) {
      const cards = P.candidates(s, P.depthOfDraw(k), build, k, skipBank, { mode: mode || 'solo', contractsSeen: seen });
      if (P.hasContract(cards)) seen++;
      arr[k] = 1; build = P.applyPick(build, cards, 1); skipBank = 0; after.push(build >>> 0);
    }
    const pk = P.packPicks(arr);
    return { build: build >>> 0, picksLo: pk.lo, picksHi: pk.hi, seasonId: season, after };
  };
  const h = honest(1, 2, 'solo');
  const bA = perks.buildAt(Object.assign({ startDepth: 5 }, h), 5, 1), bB = perks.buildAt(Object.assign({}, h), 10, 1), b0 = perks.buildAt(Object.assign({}, h), 0, 1);
  ok('[12] perks.buildAt: depth 0 -> 0 / depth 5 -> build after draw 1 / depth 10 -> build after draw 2 (== end build)', b0.ok && b0.build === 0 && bA.ok && bA.build === h.after[0] && bB.ok && bB.build === h.after[1] && bB.build === h.build && h.after[0] !== h.after[1]);
  const p1 = sc.capParamsOf(7, 1, { startDepth: 5, endDepth: 10, seasonId: 1, flags: 2, build: h.build, picksLo: h.picksLo, picksHi: h.picksHi, rerollLo: 0, rerollHi: 0 });
  ok('[12] solo segment [5,10]: p.build = SEGMENT-START build (after draw 1), not the end build; buildEnd keeps the end build; no per-draw list', p1.build === h.after[0] && p1.buildEnd === h.build && p1.builds === null && !p1.replayErr);
  const hc = honest(1, 2, 'coop');
  const p2 = sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 12, seasonId: 1, flags: 0, build: hc.build, picksLo: hc.picksLo, picksHi: hc.picksHi });
  ok('[12] co-op session record (pc 2, no COMP flag): builds = per-draw list [after draw 1, after draw 2], p.build = start build 0, buildEnd = end build', JSON.stringify(p2.builds) === JSON.stringify(hc.after) && p2.build === 0 && p2.buildEnd === hc.build);
  const p3 = sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 12, seasonId: 1, flags: 8, build: hc.build, picksLo: hc.picksLo, picksHi: hc.picksHi });
  ok('[12] team COMPETITIVE segment (flags COMP): no per-draw list (segment lane, start build)', p3.builds === null && p3.build === 0);
  const forged = sc.capParamsOf(7, 1, { startDepth: 5, endDepth: 10, seasonId: 1, flags: 2, build: h.build, picksLo: 4, picksHi: 0 });   // choice 4 without a skip bank = pick-4-nobank
  ok('[12] a pick log that does not replay -> replayErr (perk_forge), no cap params trusted', /perk_forge/.test(String(forged.replayErr)));
  const st = { audited: {}, chain: {} };
  const rF = mkSolo(77, 100, SIDA, { startDepth: 5, endDepth: 10, seasonId: 1, flags: 2, keyId: 1, build: h.build, picksLo: 4, picksHi: 0 }, { w: SIDA });
  const pend = sc.pickAuditable(st, { forged: [rF] });
  ok('[12] pickAuditable marks the group skip (not capped)', pend.length === 1 && /^perk-replay:perk_forge/.test(pend[0].skip || ''));
  const tk = sc.takeSkips(st, pend, 4242);
  ok('[12] takeSkips: skipped group remembered as audited-with-error once (fail-open), removed from the list', tk.pending.length === 0 && tk.skipped.length === 1 && st.audited.forged && /perk-replay/.test(st.audited.forged.e) && st.audited.forged.t === 4242);
  ok('[12] classic segments never replay (build / list forced 0 / null)', (() => { const pc = sc.capParamsOf(7, 1, { startDepth: 0, endDepth: 3, seasonId: 1, flags: 32, build: 386, picksLo: 4, picksHi: 0 }); return pc.classic === true && pc.build === 0 && pc.builds === null && !pc.replayErr; })());
  ok('[12] no build / no picks -> build 0, no replay (legacy records untouched)', (() => { const pc = sc.capParamsOf(7, 2, { startDepth: 0, endDepth: 6, seasonId: -1 }); return pc.build === 0 && pc.builds === null && !pc.replayErr; })());
}

// ---- [13] chain per run (knife 3.5c2a-A): pid:pc:runSeed keys, self-written seats only, legacy fallback + pruning ----
{
  const A = v.pid(SIDA), B = v.pid(SIDB);
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  st.chain[sc.chainKey(A, 2, 77)] = { d: 10, cap: 5000, t: 100 };
  ok('[13] chainStartBank reads THIS run\'s chain', sc.chainStartBank(st, [A], 2, 10, 77) === 5000);
  ok('[13] another run of the same account does not inherit it (static bound)', sc.chainStartBank(st, [A], 2, 10, 78) === Math.round(v.endlessGoalFor(10, 2) * v.ENDLESS.SCORE_MULT));
  st.chain[A + ':2'] = { d: 10, cap: 9000 };   // legacy account-wide key (pre-knife audits)
  ok('[13] legacy pid:pc key = transitional read-only fallback (only when this run has no chain of its own)', sc.chainStartBank(st, [A], 2, 10, 78) === 9000 && sc.chainStartBank(st, [A], 2, 10, 77) === 5000);
  // applyAudit: only self-written seats extend; roster seat 1 (B) did not write -> no chain for B
  const pend = [{ m: 'eok2', mt: 7, pc: 2, scores: [500, 600], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 8 }, roster: { 0: SIDA, 1: SIDB }, self: [0], runSeed: 91 }];
  sc.applyAudit(st, pend, { m0: { cap: 40000 } }, new Set(), 2000);
  ok('[13] honest audit extends only the self-written seat\'s run chain', st.chain[sc.chainKey(A, 2, 91)] && st.chain[sc.chainKey(A, 2, 91)].d === 8 && !st.chain[sc.chainKey(B, 2, 91)]);
  ok('[13] a forged deep record can only lift the chain of the run it forges (pid:pc key never written)', Object.keys(st.chain).filter(k => k.split(':').length === 2).length === 1);
  // pruning: first run stamps chainLegacyT; after CHAIN_LEGACY_KEEP_MIN the legacy keys go; per-run entries expire after CHAIN_KEEP_MIN
  sc.pruneState(st, new Set(), 3000);
  ok('[13] prune: legacy keys kept on first sight, chainLegacyT stamped', st.chain[A + ':2'] && st.chainLegacyT === 3000);
  sc.pruneState(st, new Set(), 3000 + sc.CHAIN_LEGACY_KEEP_MIN + 1);
  ok('[13] prune: legacy keys gone after CHAIN_LEGACY_KEEP_MIN, per-run keys kept', !st.chain[A + ':2'] && !st.chainLegacyT && st.chain[sc.chainKey(A, 2, 91)]);
  sc.pruneState(st, new Set(), 2000 + sc.CHAIN_KEEP_MIN + 1);
  ok('[13] prune: per-run entries expire after CHAIN_KEEP_MIN (t stamped at write)', !st.chain[sc.chainKey(A, 2, 91)] && !st.chain[sc.chainKey(A, 2, 77)]);
}

// ---- [14] CLI line builds= token + exact core by keyId (knife 3.5c2a-A) ----
{
  const p = { entry: 'endless', pc: 2, startDepth: 0, endDepth: 22, startBank: 0, seasonId: 1, build: 0, builds: [7, 9], buildEnd: 9 };
  ok('[14] core reads builds= -> positional start build + per-draw list token', sc.cliLineOf('t', p, 42, { builds: true }) === 'E t 42 2 0 22 0 1 builds=7,9');
  ok('[14] core without builds= -> END-of-record build in the positional field (pre-knife line, no regression)', sc.cliLineOf('t', p, 42, { builds: false }) === 'E t 42 2 0 22 0 1 9' && sc.cliLineOf('t', p, 42) === 'E t 42 2 0 22 0 1 9');
  ok('[14] segment record (no list): positional start build as before', sc.cliLineOf('t', { entry: 'endless', pc: 1, startDepth: 5, endDepth: 10, startBank: 100, seasonId: 1, build: 386, builds: null, buildEnd: 999 }, 42, { builds: true }) === 'E t 42 1 5 10 100 1 386');
  ok('[14] classic line unchanged (sentinels then 1; list never present)', sc.cliLineOf('t', { entry: 'endless', pc: 1, startDepth: 0, endDepth: 3, startBank: 0, seasonId: 0, build: 0, builds: null, classic: true }, 42, { builds: true }) === 'E t 42 1 0 3 0 0 0 0 0 1');
  const live = { v: 1, channels: { demo: [ { buildNum: 2026090703, core: 'aaaaaaaaaaaa', liveAt: '2026-09-07T00:00:00.000Z', gateAt: null }, { buildNum: 2026093001, core: 'bbbbbbbbbbbb', liveAt: '2026-09-29T17:29:39.201Z', gateAt: null }, { buildNum: 2026070100, core: null, liveAt: '2026-07-01T00:00:00.000Z', gateAt: null } ] } };
  ok('[14] coreForBuildNum: registered package -> its core; unknown / pre-core package -> null', sc.coreForBuildNum(live, 'demo', 2026093001) === 'bbbbbbbbbbbb' && sc.coreForBuildNum(live, 'demo', 2026090703) === 'aaaaaaaaaaaa' && sc.coreForBuildNum(live, 'demo', 2026070100) === null && sc.coreForBuildNum(live, 'demo', 1) === null && sc.coreForBuildNum(live, 'nope', 2026093001) === null && sc.coreForBuildNum(null, 'demo', 2026093001) === null);
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  ok('[14] auditPending routes solo records to the core of the package that signed them (keyId -> live window -> disk), exact verdict replaces window/overlap', /const c = coreForBuildNum\(live, channel, x\.keyId\);/.test(src) && /res\.map\[k\] = Object\.assign\(\{\}, r3\.map\[k\], \{ via: 'exact:' \+ ex\.label \}\)/.test(src) && /if \(!\(x\.keyId > 0\) \|\| !live \|\| !channel\) return;/.test(src));
  ok('[14] main(): readGroups -> takeSkips(pickAuditable) -> auditPending -> applyAudit (shared with tools/seedcap-reaudit.js)', /const picked = takeSkips\(st, pickAuditable\(st, groups\), nowMin\(\)\);/.test(src) && /audited = auditPending\(picked\.pending, \{ cores, live: cf\.live, channel: SEEDCAP_CHANNEL, distDir: SEEDCAP_DIST_DIR \}\);/.test(src) && /stats = applyAudit\(st, audited\.pending, audited\.map, processed, nowMin\(\)\);/.test(src));
  ok('[14] reaudit tool exists, is read-only (no saveState / writeOffense / sendAlertMail) and shares the audit routine', (() => { let t = ''; try { t = require('fs').readFileSync(path.join(__dirname, '..', 'tools', 'seedcap-reaudit.js'), 'utf8'); } catch (e) { return false; } return /sc\.readGroups\(\)/.test(t) && /sc\.auditPending\(/.test(t) && /sc\.applyAudit\(/.test(t) && !/saveState\(/.test(t) && !/writeOffense\(/.test(t) && !/sendAlertMail\(/.test(t); })());
}
try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (e) {}
console.log(fail ? '\n[seedcap-audit] FAIL ' + fail + ' (pass ' + pass + ')' : '\n[seedcap-audit] all green (' + pass + ')');
process.exit(fail ? 1 : 0);
