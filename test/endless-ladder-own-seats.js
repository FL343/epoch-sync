'use strict';
// Q201 (cloud audit 2026-10): the endless co-op continue debit replays the packed per-seat counts seat-ascending on one
// escalating ladder (endlessDebits: rung k costs 20 * 1.5^(k-1)). Q78 left a seat that only the writers name off that
// ladder; a seat the agreed roster leaves EMPTY (sid 0, which decodeRoster skips) kept its nibble: a modified host could
// put 15 continues on an empty seat in front of a real member and his one continue cost rung 16 (8,758) instead of rung 1
// (20). Now every seat that is not an own-record roster seat is masked before the replay; an empty seat that carried
// continues is logged and counted (run summary), nobody flagged.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (same harness as
// test/endless-continue-cap.js): writes are logged, never applied, so every check reads the logged score writes.
//   [1] the empty seat in front of the victim, who stayed and settled (his own record carries the host's counts):
//       V pays rung 1 (20), not rung 16; the empty seat logged and counted once; nobody flagged
//   [2] the same with a four-seat run where V left before the end (start only, charged on the others' word, A14):
//       V pays 20 (still on the others' word, counted there too), the writers pay nothing
//   [3] the empty seat behind the victim: nothing moves (V pays 20 either way), the seat still logged
//   [4] honest controls, untouched: a full roster (rungs as before), an empty seat with 0 continues (no log, no count),
//       a named-only seat (Q78: its own log line, not the Q201 one)
//   [5] wiring pins (the mask covers all 8 seats, the own-record rule unchanged, the summary row)
//   [6] mutation self-checks (the old roster-only mask -> [1] red; the count removed -> [1] red; own seats masked too ->
//       [4] red)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB'];
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-ladder-own-seats-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      // pin the season clock: from a season start on the endless boards are season-derived; every test runs before each
      //   production reconcile, so a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  return files;
}

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 7;
// result-reporter wire forms (endless co-op, match type 7): settle = 10 header + pc scores + disp + 2pc roster + 11 tail;
//   start (0xB2) = 10 header + pc zero scores + disp + 2pc roster
function settle7(hash, seat, ros, cont, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, seat + 1, o.prog == null ? 0 : o.prog, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth | 0, cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0);
  return d;
}
function start7(hash, seat, ros) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}

// recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard); cpStart: { sid: score }
function world(recs, cpStart) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: Object.keys(cpStart || {}).map(s => ({ steamID: s, score: cpStart[s] })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
// three runs: first sighting, 10 minutes later, 3 hours later
function play(recs, cpStart, script) {
  const r1 = runCron(world(recs, cpStart), null, null, script);
  const r2 = runCron(world(recs, cpStart), advance(r1.state, 10 * 60000), null, script);
  const r3 = runCron(world(recs, cpStart), advance(r2.state, 3 * 3600000), null, script);
  const runs = [r1, r2, r3];
  return { runs, last: r3, all: runs.map(r => r.out).join('\n'), posts: [].concat(...runs.map(r => r.posts)), summary: runs.map(r => r.summary).join('\n'), codes: runs.map(r => r.code) };
}

const cpWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=8(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const lastCp = (p, sid) => { const w = cpWrites(p, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const sig = (p) => p.last.state.SIGNALS_FILE || {};
const playerRow = (p, sid) => (sig(p).players || {})[v.pid(sid)];
const allZero = (p) => p.codes.every(c => c === 0);
const sumRow = (p, re) => { let a = 0, x; const g = new RegExp(re.source, 'g'); while ((x = g.exec(p.summary))) a += Number(x[1]); return a; };
const EMPTY_ROW = /\| endless seats empty on the agreed roster that carried continues, left off the price ladder \(Q201\) \| ([0-9]+) \|/;
const OTHERS_ROW = /\| endless seats charged on the others' word only \(in full, A14\): seats \/ CP \/ over 300 CP \/ balances clamped to int32 \| ([0-9]+) \//;
const Q201_LOG = / is empty on the agreed roster but carries [0-9]+ continues -- left off the price ladder, nobody charged \(Q201\)/;
const processed = (p, key) => (p.last.state.PROCESSED_FILE || []).indexOf(key) >= 0;
const noFlags = (p, sids) => sids.every(s => { const r = playerRow(p, s) || {}; return (r.f | 0) === 0 && (r.uc | 0) === 0; });
const DEPTH = { endDepth: 5 };   // a run that reached level 5: board and XP writes happen (depth 0 writes neither)
const ladder = (from, n) => { let s = 0; for (let k = from; k < from + n; k++) s += v.endlessContinueCost(k); return s; };
const CP0 = 100000, E = '0';   // E = the empty seat (steamId '' on the client -> '0' on the wire)
const showCp = (p) => (p.all.match(/endless (cp|settle)[^\n]*/g) || []).join(' | ');

console.log('=== endless co-op: an empty roster seat stays off the continue price ladder (Q201) ===');

// one run: ros = the host's seat table (E for an empty seat); every listed player wrote his start; `settlers` (seat
//   indexes) wrote the settle record carrying `cont` (the host's packed counts, adopted as sent)
function run(base, ros, cont, settlers, script) {
  const h = 0x7D00 + base, key = h + '_' + SEED + '_7';
  const recs = [];
  ros.forEach((s, i) => { if (s !== E) recs.push({ sid: s, d: start7(h, i, ros) }); });
  for (const i of settlers) recs.push({ sid: ros[i], d: settle7(h, i, ros, cont, DEPTH) });
  const cps = {}; for (const s of ros) if (s !== E) cps[s] = CP0;
  return { p: play(recs, cps, script), key };
}
const nib = (counts) => counts.reduce((a, n, s) => a | ((n & 0xF) << (4 * s)), 0);

// ---- [1] empty seat in front of a member who stayed and settled ----
const A1 = SID(11), V1 = SID(12);
function case1(script) { return run(10, [A1, E, V1], nib([0, 15, 1]), [0, 2], script); }
{
  const { p, key } = case1();
  T('[1] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[1] V pays rung 1 (20), not rung 16 (' + ladder(16, 1) + ')', lastCp(p, V1) === CP0 - 20, showCp(p));
  T('[1] A pays nothing (his own seat is 0)', cpWrites(p, A1).length === 0);
  T('[1] settled and processed as usual', processed(p, key) && /endless settle /.test(p.all), JSON.stringify(p.last.state.PROCESSED_FILE));
  T('[1] the empty seat logged once with its count', p.all.split('\n').filter(l => Q201_LOG.test(l)).length === 1 && /seat 1 is empty on the agreed roster but carries 15 continues/.test(p.all), showCp(p));
  T('[1] run summary counts it once', sumRow(p, EMPTY_ROW) === 1, String(sumRow(p, EMPTY_ROW)));
  T('[1] nobody flagged (f / uc stay 0)', noFlags(p, [A1, V1]));
}

// ---- [2] four seats, V left before the end (start only): charged on the others' word ----
const A2 = SID(21), B2 = SID(22), V2 = SID(23);
{
  const { p, key } = run(20, [A2, B2, E, V2], nib([0, 0, 15, 1]), [0, 1]);
  T('[2] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[2] V pays rung 1 (20), not rung 16', lastCp(p, V2) === CP0 - 20, showCp(p));
  T('[2] still on the others\' word (A14 count unchanged: 1 seat)', sumRow(p, OTHERS_ROW) === 1, String(sumRow(p, OTHERS_ROW)));
  T('[2] the writers pay nothing', cpWrites(p, A2).length === 0 && cpWrites(p, B2).length === 0);
  T('[2] processed, the empty seat counted once', processed(p, key) && sumRow(p, EMPTY_ROW) === 1, String(sumRow(p, EMPTY_ROW)));
}

// ---- [3] the empty seat behind the member: nothing moves ----
const A3 = SID(31), V3 = SID(32);
{
  const { p } = run(30, [A3, V3, E], nib([0, 1, 15]), [0, 1]);
  T('[3] V pays rung 1 (20)', lastCp(p, V3) === CP0 - 20, showCp(p));
  T('[3] the empty seat still logged and counted', Q201_LOG.test(p.all) && sumRow(p, EMPTY_ROW) === 1);
}

// ---- [4] honest controls ----
const A4 = SID(41), B4 = SID(42), V4 = SID(43);
function case4a(script) { return run(40, [A4, B4, V4], nib([2, 1, 3]), [0, 1, 2], script); }
{
  const { p } = case4a();
  T('[4a] full roster: A rungs 1..2, B rung 3, V rungs 4..6 (as before)', lastCp(p, A4) === CP0 - ladder(1, 2) && lastCp(p, B4) === CP0 - ladder(3, 1) && lastCp(p, V4) === CP0 - ladder(4, 3), showCp(p));
  T('[4a] no Q201 log, summary 0', !Q201_LOG.test(p.all) && sumRow(p, EMPTY_ROW) === 0);
}
const A5 = SID(51), V5 = SID(52);
{
  const { p, key } = run(50, [A5, E, V5], nib([1, 0, 2]), [0, 2]);
  T('[4b] an empty seat with 0 continues: A rung 1, V rungs 2..3', lastCp(p, A5) === CP0 - ladder(1, 1) && lastCp(p, V5) === CP0 - ladder(2, 2), showCp(p));
  T('[4b] no Q201 log, summary 0, processed', !Q201_LOG.test(p.all) && sumRow(p, EMPTY_ROW) === 0 && processed(p, key));
}
const A6 = SID(61), N6 = SID(62), V6 = SID(63);
{
  // N is named at seat 1 but never wrote a record for the run (Q78): masked by the own-record rule, its own log line
  const h = 0x7D00 + 60, ros = [A6, N6, V6];
  const recs = [{ sid: A6, d: start7(h, 0, ros) }, { sid: V6, d: start7(h, 2, ros) }, { sid: A6, d: settle7(h, 0, ros, nib([0, 15, 1]), DEPTH) }, { sid: V6, d: settle7(h, 2, ros, nib([0, 15, 1]), DEPTH) }];
  const p = play(recs, { [A6]: CP0, [N6]: CP0, [V6]: CP0 });
  T('[4c] named-only seat (Q78): V pays rung 1, N nothing', lastCp(p, V6) === CP0 - 20 && cpWrites(p, N6).length === 0, showCp(p));
  T('[4c] the Q78 line, not the Q201 one', /not charged -- never wrote an own record for this run \(Q78\)/.test(p.all) && !Q201_LOG.test(p.all) && sumRow(p, EMPTY_ROW) === 0);
}

// ---- [5] wiring pins ----
{
  T('[5] the mask runs over all 8 structural seats', /for \(let seat = 0; seat < 8; seat\+\+\) \{\n\s+const sid = roster0\[seat\];\n\s+if \(sid != null && isOwnE\(sid\)\) continue;/.test(SRC));
  T('[5] every other seat is masked before the replay', (() => { const i = SRC.indexOf('contOwn &= ~(0xF << (4 * seat));'), j = SRC.indexOf('const debits = endlessDebits(contOwn);'); return i > 0 && j > i; })());
  T('[5] the old roster-only mask is gone', SRC.indexOf('for (const seatKey of Object.keys(roster0)) if (!isOwnE(roster0[seatKey])) contOwn') < 0);
  T('[5] run summary row', /s\('endlessEmptySeatCont', 0\)/.test(SRC));
}

// ---- [6] mutation self-checks ----
console.log('-- [6] mutation self-checks --');
{
  const loopFrom = SRC.slice(SRC.indexOf('      for (let seat = 0; seat < 8; seat++) {\n        const sid = roster0[seat];'), SRC.indexOf('contOwn &= ~(0xF << (4 * seat));\n      }') + 'contOwn &= ~(0xF << (4 * seat));\n      }'.length);
  const mutants = [
    ['the old roster-only mask', [[loopFrom, '      for (const seatKey of Object.keys(roster0)) if (!isOwnE(roster0[seatKey])) contOwn &= ~(0xF << (4 * (seatKey | 0)));']],
      (script) => lastCp(case1(script).p, V1) !== CP0 - 20],
    ['the count removed', [['RUN.endlessEmptySeatCont = (RUN.endlessEmptySeatCont | 0) + 1;', '']], (script) => sumRow(case1(script).p, EMPTY_ROW) !== 1],
    ['own seats masked too', [['if (sid != null && isOwnE(sid)) continue;', 'if (false) continue;']], (script) => lastCp(case4a(script).p, V4) !== CP0 - ladder(4, 3)],
  ];
  for (const [label, edits, check] of mutants) {
    if (edits.some(([from]) => !from || SRC.split(from).length !== 2)) { bad('[6] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-ladder-own-seats-' + process.pid + '.js');
    try {
      let src = SRC; for (const [from, to] of edits) src = src.split(from).join(to);
      fs.writeFileSync(script, src);
      T('[6] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
