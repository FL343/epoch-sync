'use strict';
// Q110 (cloud audit 2026-10): an endless co-op seat whose own record does not carry the agreed tail (he left before the
// end and wrote only his start, or reconnected onto results with an all-zero tail) has his continue count written by
// the others alone. The user's call (A14, 2026-10-10): no cap -- such a seat is charged in full and ranks as before; the job
// counts it (run summary, log line, a `uc` row on the accounts whose records carried the count when one seat paid more
// than CONT_OTHERS_WORD_WATCH_CP, the O407 watch item) and keeps every CP balance inside the board's int32 (cpClamp at the
// debit and at the cp_bank write). A group whose consensus roster seats a writer off his own record is held.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (same harness as
// test/endless-own-record.js): writes are logged, never applied, so every check reads the logged score writes.
//   [1] the frame on a real leaver: V wrote his start and left; A and B write V's seat 15 continues, their own 0 --
//       V charged 17,477 in full (A14); logged, counted (seats / CP / over the watch line), the two writers carry `uc`
//   [2] escalation: A and B pack their own seats too (15 each) -- V's rungs 31..45 (3,350,994,649) clamped to
//       -2147483647, no wrap to a positive balance; A and B pay their own full price
//   [3] three settlers with 15 each (all their own word): seat 2's 3,350,994,649 is clamped to -2147483647, no wrap
//   [4] honest quitters: 2 continues from the bottom (50) and 2 continues on rungs 5..6 (253) -- full price, counted,
//       below the watch line (no `uc`)
//   [5] zero-tail writer (a reconnector onto results, or a client writing zero for itself -- review Z1): charged in full
//       and ranks with XP like the others (A14 b); `uc` goes to the accounts whose records carried the count, not to him
//   [6] a settler's own word: 15 continues on his own record cost 17,477, not counted as the others' word
//   [7] the cp_bank write clamps every path (a team competitive resume fee on a balance already at the floor)
//   [8] wiring pins (nothing capped, the watch count, both clamps, the summary rows, the seat check before every lane)
//   [9] mutation self-checks (both clamps / the write clamp / the seat check / the watch count / the `uc` gate removed
//       -> [3] / [7] / [10] / [1] / [5a] go red)
//   [10] review P1: inside the run, two writers re-seat the victim (their rosters put V at seat 0, where A's 15 continues
//        are): held, nobody charged, flagged once; it settles normally once their records name the real roster
//   [11] review P2: outside accounts copy V's record and seat V elsewhere: held, V not charged for W's continues
//   On a tree that also carries Q113 (its endless roster hold runs first and catches every shape this check catches),
//   [10] / [11] / the seat-check mutation assert the shared outcome (held or the outside records dropped, nobody charged,
//   nobody ranks, not processed) and leave the Q110-only details (its log, flags, summary row, settle-after-fix) to the
//   tree without Q113.
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const WITH_Q113 = SRC.indexOf('not settled (Q113)') >= 0;   // Q113's roster hold sits before the Q110 seat check
const HELD_RE = / elsewhere than their own record -- not settled \(Q110\)|not settled \(Q113\)/;
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-continue-cap-'));
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

const SEG_SUSPENDED = 1, SEG_RESUMED = 4, SEG_COMP = 8;
const seg7 = (hash, seat, ros, from, to, flags) => settle7(hash, seat, ros, 0, { startDepth: from, endDepth: to, flags, prog: 12 });

const CP0 = 1000, FLOOR = -2147483647, WATCH = 300;   // CONT_OTHERS_WORD_WATCH_CP: counting only (O407), nothing is capped
// zero-tail settle (a cold reconnector who landed on results): same scores and roster, all-zero tail
function zero7(hash, seat, ros) { const d = settle7(hash, seat, ros, 0); const at = 11 + 3 * ros.length; for (let i = at; i < d.length; i++) d[i] = 0; return d; }
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
const summaryRow = (p) => { const m = /\| endless seats charged on the others' word only \(in full, A14\): seats \/ CP \/ over 300 CP \/ balances clamped to int32 \| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/g; let a = 0, b = 0, c = 0, d = 0, x; while ((x = m.exec(p.summary))) { a += Number(x[1]); b += Number(x[2]); c += Number(x[3]); d += Number(x[4]); } return [a, b, c, d]; };
const allZero = (p) => p.codes.every(c => c === 0);
const disputeRow = (p) => { const m = /\| endless groups held: a writer seated elsewhere than his own record \(Q110\) \| ([0-9]+) \|/g; let a = 0, x; while ((x = m.exec(p.summary))) a += Number(x[1]); return a; };
// score writes to a board id (trio casual ladder = 12, progress XP = 5)
const boardWrites = (p, id, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const DEPTH = { endDepth: 5 };   // a run that reached level 5: board and XP writes happen (depth 0 writes neither)
const ladder = (from, n) => { let s = 0; for (let k = from; k < from + n; k++) s += v.endlessContinueCost(k); return s; };

console.log('=== endless co-op: others\' word charged in full and counted (A14), CP balances inside int32, off-seat writers held (Q110) ===');

// a 3P run: everyone wrote his start; `settlers` wrote the settle with `cont`; `zeros` wrote a zero-tail settle
function trio(base, cont, settlers, zeros, cpStart, script, o) {
  const A = SID(base + 1), B = SID(base + 2), V = SID(base + 3);
  const ros = [A, B, V], h = 0x7A00 + base;
  const recs = ros.map((s, i) => ({ sid: s, d: start7(h, i, ros) }));
  for (const i of settlers) recs.push({ sid: ros[i], d: settle7(h, i, ros, cont, o) });
  for (const i of (zeros || [])) recs.push({ sid: ros[i], d: zero7(h, i, ros) });
  const cps = {}; for (const s of ros) cps[s] = CP0;
  return { p: play(recs, Object.assign(cps, cpStart ? cpStart(ros) : {}), script), A, B, V };
}

// ---- [1] the frame on a real leaver ----
const ucOf = (p, s) => ((playerRow(p, s) || {}).uc | 0);
{
  const { p, A, B, V } = trio(10, 0xF00, [0, 1]);
  T('[1] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[1] V charged 17,477 in full (1000 -> ' + (CP0 - 17477) + '; A14: no cap)', lastCp(p, V) === CP0 - 17477, JSON.stringify(cpWrites(p, V).map(x => x.body.replace(/.*score=/, ''))));
  T('[1] logged', /seat 2 [0-9a-f]+ 15 continues \(17477\) on the others' word only -- charged in full \(Q110, A14\)/.test(p.all), (p.all.match(/endless cp[^\n]*/g) || []).join(' | '));
  T('[1] the writers pay nothing (their own seats are 0)', cpWrites(p, A).length === 0 && cpWrites(p, B).length === 0);
  T('[1] each writer carries the uc signal once (one seat over the watch line)', ucOf(p, A) === 1 && ucOf(p, B) === 1, JSON.stringify([playerRow(p, A), playerRow(p, B)]));
  T('[1] V carries no uc', ucOf(p, V) === 0);
  T('[1] uc touches no trust input (f stays 0)', [A, B, V].every(s => ((playerRow(p, s) || {}).f | 0) === 0));
  T('[1] run summary counts 1 seat / 17477 CP / 1 over the watch line / 0 clamped', JSON.stringify(summaryRow(p)) === JSON.stringify([1, 17477, 1, 0]), JSON.stringify(summaryRow(p)));
}

// ---- [2] escalation by packing the writers' own seats ----
{
  const { p, A, B, V } = trio(20, 0xFFF, [0, 1]);
  T('[2] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[2] V (rungs 31..45: ' + ladder(31, 15) + ') clamped to ' + FLOOR + ', no wrap to a positive balance', lastCp(p, V) === FLOOR, JSON.stringify(cpWrites(p, V).map(x => x.body.replace(/.*score=/, ''))));
  T('[2] A pays his own word in full (rungs 1..15)', lastCp(p, A) === CP0 - ladder(1, 15), JSON.stringify(lastCp(p, A)));
  T('[2] B pays his own word in full (rungs 16..30)', lastCp(p, B) === CP0 - ladder(16, 15), JSON.stringify(lastCp(p, B)));
  T('[2] run summary counts V on the others\' word (over the watch line) and the clamp', (() => { const r = summaryRow(p); return r[0] === 1 && r[1] === ladder(31, 15) && r[2] === 1 && r[3] >= 1; })(), JSON.stringify(summaryRow(p)));
}

// ---- [3] three settlers, 15 each: seat 2 beyond int32 ----
{
  const { p, A, V } = trio(30, 0xFFF, [0, 1, 2]);
  T('[3] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3] seat 2 (' + ladder(31, 15) + ') clamped to ' + FLOOR + ', no wrap to a positive balance', lastCp(p, V) === FLOOR, JSON.stringify(cpWrites(p, V).map(x => x.body.replace(/.*score=/, ''))));
  T('[3] every cp write stays inside int32', p.posts.filter(x => /leaderboardid=8(&|$)/.test(x.body)).every(x => { const m = /score=(-?[0-9]+)/.exec(x.body); const n = m ? Number(m[1]) : NaN; return n >= FLOOR && n <= 2147483647; }));
  T('[3] warned', /seat 2 [0-9a-f]+ balance -?[0-9]+ outside int32 -> clamped to -2147483647 \(Q110\)/.test(p.all));
  T('[3] nothing capped (all their own word), A pays rungs 1..15', summaryRow(p)[0] === 0 && lastCp(p, A) === CP0 - ladder(1, 15), JSON.stringify([summaryRow(p), lastCp(p, A)]));
  T('[3] run summary counts the clamp', summaryRow(p)[3] >= 1, JSON.stringify(summaryRow(p)));
}

// ---- [4] honest quitters pay in full ----
{
  const a = trio(40, 0x200, [0, 1]);
  T('[4a] V wrote his start, 2 continues from the bottom: charged 50', lastCp(a.p, a.V) === CP0 - 50, JSON.stringify(lastCp(a.p, a.V)));
  const b = trio(50, 0x222, [0, 1]);
  T('[4b] V wrote his start, 2 continues on rungs 5..6: charged ' + ladder(5, 2) + ' in full', lastCp(b.p, b.V) === CP0 - ladder(5, 2), JSON.stringify(lastCp(b.p, b.V)));
  T('[4] counted, below the watch line (' + WATCH + ' CP)', JSON.stringify(summaryRow(a.p)) === JSON.stringify([1, 50, 0, 0]) && JSON.stringify(summaryRow(b.p)) === JSON.stringify([1, ladder(5, 2), 0, 0]),
    JSON.stringify([summaryRow(a.p), summaryRow(b.p)]));
  T('[4] nobody carries uc (no seat over the watch line)', [a.A, a.B, a.V, b.A, b.B, b.V].every(s => ucOf(s === a.A || s === a.B || s === a.V ? a.p : b.p, s) === 0));
}

// ---- [5] zero-tail writer (a reconnector onto results; review Z1: the same record a client writing zero for itself sends) ----
{
  const a = trio(60, 0xF00, [0, 1], [2], null, null, DEPTH);
  T('[5a] all runs exit 0', allZero(a.p), a.p.last.out.slice(-800));
  T('[5a] V (all-zero tail) charged 17,477 in full', lastCp(a.p, a.V) === CP0 - 17477, JSON.stringify(lastCp(a.p, a.V)));
  T('[5a] V ranks and earns XP like the others (A14 b)', [a.A, a.B, a.V].every(s => boardWrites(a.p, 12, s).length === 1 && boardWrites(a.p, 5, s).length === 1),
    JSON.stringify([a.A, a.B, a.V].map(s => [boardWrites(a.p, 12, s).length, boardWrites(a.p, 5, s).length])));
  T('[5a] logged as the others\' word', /seat 2 [0-9a-f]+ 15 continues \(17477\) on the others' word only -- charged in full \(Q110, A14\)/.test(a.p.all));
  T('[5a] uc goes to A and B (their records carried the count), not to V', ucOf(a.p, a.A) === 1 && ucOf(a.p, a.B) === 1 && ucOf(a.p, a.V) === 0,
    JSON.stringify([a.A, a.B, a.V].map(s => ucOf(a.p, s))));
  T('[5a] no capped-seat line left', !/no board credit \(Q110\)/.test(a.p.all));
  const b = trio(70, 0x200, [0, 1], [2], null, null, DEPTH);
  T('[5b] V (all-zero tail) with 2 continues: charged 50, ranks, earns XP', lastCp(b.p, b.V) === CP0 - 50 && boardWrites(b.p, 12, b.V).length === 1 && boardWrites(b.p, 5, b.V).length === 1,
    JSON.stringify([lastCp(b.p, b.V), boardWrites(b.p, 12, b.V).length, boardWrites(b.p, 5, b.V).length]));
  // review Z1 by seat: A pressed 15 continues himself and wrote a zero tail; B and C settled honestly
  const z = trio(75, 0x00F, [1, 2], [0], null, null, DEPTH);
  T('[5c] A (own 15, zero tail) pays all 17,477 (the zero tail buys nothing), ranks, earns XP', lastCp(z.p, z.A) === CP0 - 17477 && boardWrites(z.p, 12, z.A).length === 1 && boardWrites(z.p, 5, z.A).length === 1,
    JSON.stringify([lastCp(z.p, z.A), boardWrites(z.p, 12, z.A).length, boardWrites(z.p, 5, z.A).length]));
  T('[5c] B and V rank, pay nothing', boardWrites(z.p, 12, z.B).length === 1 && boardWrites(z.p, 12, z.V).length === 1 && cpWrites(z.p, z.B).length === 0 && cpWrites(z.p, z.V).length === 0);
}

// ---- [6] a settler's own word ----
{
  const { p, V } = trio(80, 0xF00, [0, 1, 2]);
  T('[6] V settled with 15 continues on his own record: charged 17,477', lastCp(p, V) === CP0 - 17477, JSON.stringify(lastCp(p, V)));
  T('[6] not counted as the others\' word', !/on the others' word only/.test(p.all) && summaryRow(p)[0] === 0, JSON.stringify(summaryRow(p)));
}

// ---- [7] the cp_bank write clamps every path ----
function compChain(base, hostCp, script) {
  const H = SID(base + 1), D = SID(base + 2), E = SID(base + 3);
  const ros = [H, D, E], h0 = 0x7A80 + base, h1 = h0 + 1;
  const segA = [], segB = [];
  for (const s of ros) segA.push({ sid: s, d: seg7(h0, ros.indexOf(s), ros, 0, 3, SEG_COMP | SEG_SUSPENDED) }, { sid: s, d: start7(h0, ros.indexOf(s), ros) });
  for (const s of ros) segB.push({ sid: s, d: seg7(h1, ros.indexOf(s), ros, 3, 4, SEG_COMP | SEG_RESUMED) }, { sid: s, d: start7(h1, ros.indexOf(s), ros) });
  const cps = { [H]: hostCp };
  const a1 = runCron(world(segA, cps), null, null, script);
  const a2 = runCron(world(segA, cps), advance(a1.state, 10 * 60000), null, script);
  const b1 = runCron(world(segA.concat(segB), cps), advance(a2.state, 10 * 60000), null, script);
  const b2 = runCron(world(segA.concat(segB), cps), advance(b1.state, 10 * 60000), null, script);
  const runs = [a1, a2, b1, b2];
  return { p: { runs, last: b2, all: runs.map(r => r.out).join('\n'), posts: [].concat(...runs.map(r => r.posts)), summary: runs.map(r => r.summary).join('\n'), codes: runs.map(r => r.code) }, H };
}
{
  const { p, H } = compChain(90, FLOOR);
  T('[7] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[7] the resume fee is taken (logged)', /host [0-9a-f]+ -20 resume/.test(p.all), (p.all.match(/endless-comp cp[^\n]*/g) || []).join(' | '));
  T('[7] the host at the floor is written at the floor, not below int32', lastCp(p, H) === FLOOR, JSON.stringify(cpWrites(p, H).map(x => x.body.replace(/.*score=/, ''))));
  T('[7] warned at the write', /write cp [0-9a-f]+: -2147483667 outside int32 -> clamped to -2147483647 \(Q110\)/.test(p.all));
}

// ---- [10] review P1: inside the run, two writers re-seat the victim ----
//   A, B, V really played (all three starts name [A, B, V]); A pressed 15 continues himself (seat 0). V settles honestly.
//   A and B copy V's scores and tail but write the roster [V, B, A] (each at the seat that roster gives him, so every record
//   passes the self-seat sanity check): the per-seat majority seats V at 0, where A's 15 continues are.
function reseat(base, fixed, script) {
  const A = SID(base + 1), B = SID(base + 2), V = SID(base + 3);
  const real = [A, B, V], fake = [V, B, A], h = 0x7B00 + base;
  const recs = real.map((s, i) => ({ sid: s, d: start7(h, i, real) }));
  recs.push({ sid: V, d: settle7(h, 2, real, 0x00F, DEPTH) });
  if (fixed) recs.push({ sid: A, d: settle7(h, 0, real, 0x00F, DEPTH) }, { sid: B, d: settle7(h, 1, real, 0x00F, DEPTH) });
  else recs.push({ sid: A, d: settle7(h, 2, fake, 0x00F, DEPTH) }, { sid: B, d: settle7(h, 1, fake, 0x00F, DEPTH) });
  const cps = {}; for (const s of real) cps[s] = CP0;
  return { recs, cps, A, B, V, key: h + '_' + SEED + '_7' };
}
{
  const w = reseat(140);
  const p = play(w.recs, w.cps);
  T('[10] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[10] V is not charged A\'s 15 continues', cpWrites(p, w.V).length === 0, JSON.stringify(cpWrites(p, w.V).map(x => x.body.replace(/.*score=/, ''))));
  T('[10] nobody is charged, nobody ranks (the group is held)', [w.A, w.B, w.V].every(s => cpWrites(p, s).length === 0 && boardWrites(p, 12, s).length === 0 && boardWrites(p, 5, s).length === 0));
  T('[10] not processed', !((p.last.state.PROCESSED_FILE || []).indexOf(w.key) >= 0), JSON.stringify(p.last.state.PROCESSED_FILE));
  T('[10] held, logged', HELD_RE.test(p.all));
  if (WITH_Q113) ok('[10] (tree with Q113: its roster hold runs first; the Q110 log / flags / summary / settle-after-fix are checked without Q113)');
  else {
    const lines = p.all.split('\n').filter(l => / elsewhere than their own record -- not settled \(Q110\)/.test(l));
    T('[10] logged every run, warned once', lines.length === 3 && lines.filter(l => /^::warning::/.test(l)).length === 1, JSON.stringify(lines));
    T('[10] the log names V and his own seat', lines.length > 0 && new RegExp(v.pidLog ? '.' : '.').test(lines[0]) && /\(own record: seat 2\)/.test(lines[0]), lines[0]);
    T('[10] every writer flagged once (like an inconsistent group)', [w.A, w.B, w.V].every(s => ((playerRow(p, s) || {}).f | 0) === 1), JSON.stringify([w.A, w.B, w.V].map(s => (playerRow(p, s) || {}).f)));
    T('[10] run summary counts the held group each run', disputeRow(p) === 3, String(disputeRow(p)));
    // the odd records are replaced by records naming the real roster: the same key settles on the next run as usual
    const f = reseat(140, true);
    const r4 = runCron(world(f.recs, f.cps), advance(p.last.state, 10 * 60000));
    T('[10] once the records agree the key settles: A pays his own 15 (17,477), V nothing',
      r4.code === 0 && (() => { const q = { posts: r4.posts }; return lastCp(q, f.A) === CP0 - 17477 && cpWrites(q, f.V).length === 0; })(),
      (r4.out.match(/endless (cp|settle)[^\n]*/g) || []).join(' | '));
  }
}

// ---- [11] review P2: outside accounts copy the victim's record and seat him elsewhere ----
//   V and W really played a duo; W pressed 15 continues and left (start only); V settled honestly. X and Y (never in the
//   run) copy V's scores and tail, each at seat 0 of a roster naming V at seat 1, where W's 15 continues are.
function outside(base, script) {
  const V = SID(base + 1), W = SID(base + 2), X = SID(base + 3), Y = SID(base + 4);
  const real = [V, W], h = 0x7C00 + base;
  const recs = real.map((s, i) => ({ sid: s, d: start7(h, i, real) }));
  recs.push({ sid: V, d: settle7(h, 0, real, 0xF0, DEPTH) });
  recs.push({ sid: X, d: settle7(h, 0, [X, V], 0xF0, DEPTH) }, { sid: Y, d: settle7(h, 0, [Y, V], 0xF0, DEPTH) });
  const cps = { [V]: CP0, [W]: CP0, [X]: CP0, [Y]: CP0 };
  return { p: play(recs, cps, script), V, W, X, Y };
}
{
  const { p, V, X, Y } = outside(150);
  T('[11] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[11] V is not charged W\'s 15 continues', cpWrites(p, V).length === 0, JSON.stringify(cpWrites(p, V).map(x => x.body.replace(/.*score=/, ''))));
  // with Q113 the outside records are dropped before grouping (its start-roster gate, logged "not counted (Q80)") or held
  T('[11] held, logged', WITH_Q113 ? (HELD_RE.test(p.all) || /not counted \(Q80\)/.test(p.all)) : /consensus roster seats [^\n]*\(own record: seat 0\)[^\n]* elsewhere than their own record -- not settled \(Q110\)/.test(p.all));
  T('[11] the outside accounts get nothing', [X, Y].every(s => boardWrites(p, 11, s).length === 0 && boardWrites(p, 5, s).length === 0));
}

// ---- [8] wiring pins ----
{
  T('[8] nothing capped: every seat pays its replayed debit (A14)', /const debit = debits\[seat\];/.test(SRC) && !/CONT_UNATTESTED_CP_MAX|cappedSids/.test(SRC));
  T('[8] a seat whose own record does not carry the agreed tail is counted', /const attestE = endlessAttested\(g\);/.test(SRC) && /if \(!attestE\.has\(pid\(sid\)\)\) \{/.test(SRC) && /if \(debit > CONT_OTHERS_WORD_WATCH_CP\) \{/.test(SRC));
  T('[8] uc only on the accounts whose records carried the count', /if \(othersWordBig\) \{ for \(const sid of writerSids\) if \(attestE\.has\(pid\(sid\)\)\) \{/.test(SRC));
  T('[8] the debit keeps the balance inside int32', /const next = cpClamp\(cur - debit\);/.test(SRC));
  T('[8] the cp_bank write sends the clamped score', /const score = cpClamp\(changedCp\[sid\]\);/.test(SRC) && /leaderboardid: cpId, steamid: sid, score, scoremethod/.test(SRC));
  T('[8] run summary rows', /s\('endlessOthersWord', 0\) \+ ' \/ ' \+ s\('endlessOthersWordCp', 0\) \+ ' \/ ' \+ s\('endlessOthersWordBig', 0\) \+ ' \/ ' \+ s\('cpClamped', 0\)/.test(SRC) && /s\('endlessSeatDispute', 0\)/.test(SRC));
  T('[8] the seat check runs before every endless lane (classic / competitive / casual)', (() => { const i = SRC.indexOf("const offSeat = g.filter((r) => String(roster0[r.d[5] | 0]) !== String(r.steamID));"), j = SRC.indexOf('if (isClassicSeg) {'), k = SRC.indexOf('if ((t.flags | 0) & attest.SEG_COMP) {'); return i > 0 && j > i && k > i; })());
  T('[8] every writer earns the run\'s XP (no seat filtered out)', /if \(xpId\) creditXpEndless\(g, t, xp, changedXp, spSet\);/.test(SRC));
}

// ---- [9] mutation self-checks ----
console.log('-- [9] mutation self-checks --');
{
  const wrap = (script) => { const r = trio(120, 0xFFF, [0, 1, 2], null, null, script); const c = lastCp(r.p, r.V); return c == null || c < FLOOR || c > 0; };
  const write = (script) => { const r = compChain(130, FLOOR, script); return lastCp(r.p, r.H) !== FLOOR; };
  const swap = (script) => { const w = reseat(160); const p = play(w.recs, w.cps, script); return cpWrites(p, w.V).length > 0; };
  const uncounted = (script) => { const r = trio(110, 0xF00, [0, 1], null, null, script); return summaryRow(r.p)[0] !== 1 || ucOf(r.p, r.A) !== 1; };
  const ucVictim = (script) => { const r = trio(170, 0xF00, [0, 1], [2], null, script, DEPTH); return ucOf(r.p, r.V) !== 0; };
  const mutants = [
    ['both clamps removed', [['const next = cpClamp(cur - debit);', 'const next = cur - debit;'], ['const score = cpClamp(changedCp[sid]);', 'const score = changedCp[sid];']], wrap],
    ['write clamp removed', [['const score = cpClamp(changedCp[sid]);', 'const score = changedCp[sid];']], write],
    ['seat check removed', [['const offSeat = g.filter((r) => String(roster0[r.d[5] | 0]) !== String(r.steamID));', 'const offSeat = [];']], swap],
    ['watch count removed', [['if (!attestE.has(pid(sid))) {', 'if (false) {']], uncounted],
    ['uc gate removed (every writer)', [['for (const sid of writerSids) if (attestE.has(pid(sid))) {', 'for (const sid of writerSids) if (true) {']], ucVictim],
  ];
  for (const [label, edits, check] of mutants) {
    if (WITH_Q113 && label === 'seat check removed') { ok('[9] ' + label + ': skipped on a tree with Q113 (its roster hold catches the swap first)'); continue; }
    if (edits.some(([from]) => SRC.split(from).length !== 2)) { bad('[9] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-continue-cap-' + process.pid + '.js');
    try {
      let src = SRC; for (const [from, to] of edits) src = src.replace(from, to);
      fs.writeFileSync(script, src);
      T('[9] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
