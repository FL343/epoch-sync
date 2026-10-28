'use strict';
// Q120 (cloud audit 2026-10): the endless co-op continue price climbs with the RUN's count (the n-th continue costs
// round(20 x 1.5^(n-1)) whoever pays), but the shared tail carries per-seat counts only and endlessDebits replayed the
// ladder seat-ascending. A modified host at seat 0 waited until an honest member pressed the 1st continue (20 CP on his
// panel), then packed 15 continues on his own seat: the member was replayed onto rung 16 (8,758 CP). Q116 (client) keeps
// the member's own COUNT honest; it does not move his rung.
// Fix: since Q120 a co-op client appends a self-describing block after the 0xD8 character block -- [0xDF | 1 << 8 |
// 1 << 16, mask], bit r-1 = the r-th continue of the run was paid by the WRITER's own seat (his continue book). The job
// finds it by magic (contRungsOf, the walk of match-sig.js find); a seat with a block pays its own rungs, every other seat
// takes the places nobody claimed but never more than the pre-Q120 replay. No block in the group = the old replay, to the
// CP. A block never flags, holds or voids anything (architecture decision 10): one the run cannot hold is set aside.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (harness of
// test/endless-ladder-own-seats.js): writes are logged, never applied, so every check reads the logged score writes.
//   [1] the frame: V paid rung 1 (20), the host packs 15 on his own seat -- V pays 20 whatever the host's block says
//       (rungs 2..16 / no block / rung 1 too / a block the run cannot hold); settled, nobody flagged
//   [2] no block anywhere (every shipped client): the pre-Q120 replay to the CP (V still pays rung 16 there)
//   [3] honest interleaved 3P run (C, A, C, B): every seat pays its true rungs = what its client deducted
//   [4] a seat without a block (cold rejoiner / older client) never pays more than the old replay
//   [5] a zero-tail writer's block is ignored (M3 abstention)
//   [6] masked seats (Q78 named-only / Q201 empty): a block is priced on the charged ladder, never above the old replay
//       when every continue before it was a masked seat's
//   [7] block format: found by magic after the char block / without one / after an unknown block; another version, a
//       zero length, a cut-short block = no block
//   [8] endlessRungClaims / endlessRungDebits units + 4000 random honest and adversarial runs (bounds below)
//   [9] wiring pins (settle prices with the blocks; the consistency compare still reads 9 tail ints; summary row)
//   [10] mutation self-checks (each guard removed -> its scenario goes red)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-cont-rungs-'));
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

// result-reporter wire forms (endless co-op, match type 7): settle = 10 header + pc scores + disp + 2pc roster + 12 tail
//   (+ the 0xD8 character block, knife 5.4a; + the 0xDF rung block, Q120, when the writer is new enough);
//   start (0xB2) = 10 header + pc zero scores + disp + 2pc roster
const CRUNG_HEAD = (0xDF | (1 << 8) | (1 << 16)) | 0;
const charBlock = (pc) => { const out = [(0xD8 | (1 << 8) | (pc << 16)) | 0]; for (let i = 0; i < pc; i += 4) out.push(0x01010101); return out; };
function settle7(hash, seat, ros, cont, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, seat + 1, o.prog == null ? 0 : o.prog, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth == null ? 5 : (o.endDepth | 0), cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0, 0);
  if (o.raw) { for (const x of o.raw) d.push(x | 0); return d; }
  if (o.chars !== false) for (const x of charBlock(pc)) d.push(x);
  if (o.rungs != null) d.push(CRUNG_HEAD, o.rungs | 0);
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
// zero-tail settle (a cold reconnector who landed on results): same scores and roster, all-zero tail
function zero7(hash, seat, ros, rungs) {
  const d = settle7(hash, seat, ros, 0, { endDepth: 0, rungs });
  const at = 11 + 3 * ros.length; for (let i = at; i < at + 12; i++) d[i] = 0;
  return d;
}

const cpWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=8(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const lastCp = (p, sid) => { const w = cpWrites(p, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const sig = (p) => p.last.state.SIGNALS_FILE || {};
const playerRow = (p, sid) => (sig(p).players || {})[v.pid(sid)];
const allZero = (p) => p.codes.every(c => c === 0);
const sumRow = (p, re, k) => { let a = 0, x; const g = new RegExp(re.source, 'g'); while ((x = g.exec(p.summary))) a += Number(x[k || 1]); return a; };
const RUNG_ROW = /\| endless seats priced by their own continue-rung block \/ blocks set aside \/ blocks sharing a rung \(Q120\) \| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/;
const processed = (p, key) => (p.last.state.PROCESSED_FILE || []).indexOf(key) >= 0;
const noFlags = (p, sids) => sids.every(s => { const r = playerRow(p, s) || {}; return (r.f | 0) === 0 && (r.uc | 0) === 0; });
const ladder = (from, n) => { let s = 0; for (let k = from; k < from + n; k++) s += v.endlessContinueCost(k); return s; };
const c = (k) => v.endlessContinueCost(k);
const bits = (...rs) => rs.reduce((m, r) => (m | (1 << (r - 1))) >>> 0, 0) | 0;
const nib = (counts) => counts.reduce((a, n, s) => a | ((n & 0xF) << (4 * s)), 0);
const showCp = (p) => (p.all.match(/endless (cp|settle)[^\n]*/g) || []).join(' | ');
const CP0 = 100000, E = '0';   // E = the empty seat (steamId '' on the client -> '0' on the wire)

console.log('=== endless co-op: each seat pays the continue rungs its own record names (Q120) ===');

// one run: ros = the host's seat table (E for an empty seat); every listed player wrote his start (except `noStart`
//   seat indexes); `settlers` = [{ i, o }] wrote the settle record carrying `cont` (the host's packed counts) with options o
function run(base, ros, cont, settlers, script, noStart) {
  const h = 0x5100 + base, key = h + '_' + SEED + '_7';
  const recs = [];
  ros.forEach((s, i) => { if (s !== E && !(noStart || []).includes(i)) recs.push({ sid: s, d: start7(h, i, ros) }); });
  for (const st of settlers) recs.push({ sid: ros[st.i], d: st.d || settle7(h, st.i, ros, cont, st.o || {}) });
  const cps = {}; for (const s of ros) if (s !== E) cps[s] = CP0;
  return { p: play(recs, cps, script), key, h };
}
const ATTACK = nib([15, 1]);   // host seat 0: 15 continues; V seat 1: 1 continue (Q116 keeps V's own count honest)
const H1 = SID(11), V1 = SID(12);
const frame = (base, hostRungs, vRungs, script) => run(base, [H1, V1], ATTACK, [{ i: 0, o: { rungs: hostRungs } }, { i: 1, o: { rungs: vRungs } }], script);
const HOST_BLOCK = bits(2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);

// ---- [1] the frame ----
{
  const { p, key } = frame(10, HOST_BLOCK, bits(1));
  T('[1] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[1] V pays rung 1 (20), not rung 16 (' + c(16) + ')', lastCp(p, V1) === CP0 - 20, showCp(p));
  T('[1] the host pays the rungs his block names, 2..16 (' + ladder(2, 15) + ')', lastCp(p, H1) === CP0 - ladder(2, 15), showCp(p));
  T('[1] settled and processed as usual; nobody flagged', processed(p, key) && /endless settle /.test(p.all) && noFlags(p, [H1, V1]), JSON.stringify(p.last.state.PROCESSED_FILE));
  T('[1] summary: 2 seats priced by their blocks, none set aside / shared', sumRow(p, RUNG_ROW, 1) === 2 && sumRow(p, RUNG_ROW, 2) === 0 && sumRow(p, RUNG_ROW, 3) === 0, p.summary.match(/\| endless seats priced[^\n]*/g));
  T('[1] log names the replay it replaced', /continue rungs from 2 seat blocks \(Q120\): [0-9]+,20 \(seat order replay [0-9]+,8758\)/.test(p.all), showCp(p));
}
{
  const { p } = frame(20, null, bits(1));
  T('[1] host writes no block: V 20; the host the old replay (' + ladder(1, 15) + ', the places left are dearer)', lastCp(p, V1) === CP0 - 20 && lastCp(p, H1) === CP0 - ladder(1, 15), showCp(p));
}
{
  const { p } = frame(30, bits(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15), bits(1));
  T('[1] host claims rung 1 too: each pays his own claim (V 20, host ' + ladder(1, 15) + '), counted as shared, settled', lastCp(p, V1) === CP0 - 20 && lastCp(p, H1) === CP0 - ladder(1, 15) && sumRow(p, RUNG_ROW, 3) === 1, showCp(p));
}
{
  const { p, key } = frame(40, bits(1), bits(1));
  T('[1] host block the run cannot hold (1 rung for 15 continues): set aside -> host the old replay, V 20; settled, counted',
    lastCp(p, V1) === CP0 - 20 && lastCp(p, H1) === CP0 - ladder(1, 15) && processed(p, key) && sumRow(p, RUNG_ROW, 2) >= 1 && noFlags(p, [H1, V1]), showCp(p));
}
{
  const { p } = frame(50, HOST_BLOCK, bits(17));
  T('[1] V block past the run\'s total (rung 17 of 16): set aside -> V takes the place nobody claimed (rung 1, 20; never above the old rung 16), host by his block',
    lastCp(p, V1) === CP0 - 20 && lastCp(p, H1) === CP0 - ladder(2, 15) && sumRow(p, RUNG_ROW, 2) >= 1, showCp(p));
}

// ---- [2] no block anywhere: the old replay ----
{
  const { p, key } = frame(60, null, null);
  T('[2] no block: the pre-Q120 replay (host ' + ladder(1, 15) + ', V rung 16 = ' + c(16) + '), settled, nothing counted',
    lastCp(p, H1) === CP0 - ladder(1, 15) && lastCp(p, V1) === CP0 - c(16) && processed(p, key) && sumRow(p, RUNG_ROW, 1) === 0 && !/\(Q120\)/.test(p.all), showCp(p));
  const old = run(70, [H1, V1], ATTACK, [{ i: 0, o: { chars: false } }, { i: 1, o: { chars: false } }]);
  T('[2] records from before the char block (12-int tail only): the same replay', lastCp(old.p, H1) === CP0 - ladder(1, 15) && lastCp(old.p, V1) === CP0 - c(16), showCp(old.p));
}

// ---- [3] honest interleaved 3P run: C pays the 1st, A the 2nd, C the 3rd, B the 4th ----
const A3 = SID(31), B3 = SID(32), C3 = SID(33);
const trio = (base, rA, rB, rC, script) => run(base, [A3, B3, C3], nib([1, 1, 2]), [{ i: 0, o: { rungs: rA } }, { i: 1, o: { rungs: rB } }, { i: 2, o: { rungs: rC } }], script);
{
  const { p } = trio(100, bits(2), bits(4), bits(1, 3));
  T('[3] A pays rung 2 (' + c(2) + '), B rung 4 (' + c(4) + '), C rungs 1 + 3 (' + (c(1) + c(3)) + ')',
    lastCp(p, A3) === CP0 - c(2) && lastCp(p, B3) === CP0 - c(4) && lastCp(p, C3) === CP0 - c(1) - c(3), showCp(p));
  const old = trio(110, null, null, null);
  T('[3] the same counts without blocks keep the seat-ascending replay (A ' + c(1) + ', B ' + c(2) + ', C ' + (c(3) + c(4)) + ')',
    lastCp(old.p, A3) === CP0 - c(1) && lastCp(old.p, B3) === CP0 - c(2) && lastCp(old.p, C3) === CP0 - c(3) - c(4), showCp(old.p));
}

// ---- [4] a seat without a block never pays more than the old replay ----
{
  const { p } = trio(120, bits(2), null, bits(1, 3));
  T('[4] B (cold rejoiner, no block): the place left (rung 4, ' + c(4) + ') is dearer than his old replay (rung 2, ' + c(2) + ') -> ' + c(2),
    lastCp(p, B3) === CP0 - c(2) && lastCp(p, A3) === CP0 - c(2) && lastCp(p, C3) === CP0 - c(1) - c(3), showCp(p));
  // an older-client host (no block) paid rung 1; a modified member claims rung 1 for his rung-2 continue: the host keeps
  //   the old replay price (rung 1), the member pays rung 1 too -- nobody pays more than before Q120
  const o = run(130, [H1, V1], nib([1, 1]), [{ i: 0 }, { i: 1, o: { rungs: bits(1) } }]);
  T('[4] older-client host keeps his old price (' + c(1) + ', not ' + c(2) + '); the member who claimed rung 1 pays ' + c(1),
    lastCp(o.p, H1) === CP0 - c(1) && lastCp(o.p, V1) === CP0 - c(1), showCp(o.p));
}

// ---- [5] a zero-tail writer's block is ignored ----
function abstain(base, script) {
  const ros = [H1, V1], h = 0x5100 + base;
  return run(base, ros, nib([1, 1]), [{ i: 0, o: { rungs: bits(1) } }, { i: 1, d: zero7(h, 1, ros, bits(1)) }], script);
}
{
  const { p } = abstain(140);
  T('[5] V landed on results (all-zero tail) yet names rung 1: ignored -> V the place left (rung 2, ' + c(2) + ') on the others\' word, host ' + c(1),
    lastCp(p, V1) === CP0 - c(2) && lastCp(p, H1) === CP0 - c(1) && noFlags(p, [H1]), showCp(p));
}

// ---- [6] masked seats ----
const A6 = SID(61), X6 = SID(62), V6 = SID(63);
function phantom(base, vRungs, script) {
  // X (seat 1) is named on the roster with 1 continue but wrote neither a start nor a settle record (Q78: off the ladder);
  //   honest order: X the 1st continue, V the 2nd (his panel said 30)
  return run(base, [A6, X6, V6], nib([0, 1, 1]), [{ i: 0, o: { rungs: 0 } }, { i: 2, o: { rungs: vRungs } }], script, [1]);
}
{
  const { p } = phantom(150, bits(2));
  T('[6] V names rung 2 behind a named-only seat\'s continue: priced on the charged ladder (rung 1, ' + c(1) + ') = the old replay, X not charged',
    lastCp(p, V6) === CP0 - c(1) && cpWrites(p, X6).length === 0 && cpWrites(p, A6).length === 0, showCp(p));
  const B6 = SID(64);
  const both = run(160, [A6, X6, V6, B6], nib([1, 1, 1, 0]), [{ i: 0, o: { rungs: bits(2) } }, { i: 2, o: { rungs: bits(3) } }, { i: 3, o: { rungs: 0 } }], null, [1]);
  T('[6] everyone named his rungs around a masked continue: A ' + c(1) + ', V ' + c(2) + ' (the old replay\'s total)',
    lastCp(both.p, A6) === CP0 - c(1) && lastCp(both.p, V6) === CP0 - c(2), showCp(both.p));
  const emp = run(170, [A6, E, V6], nib([0, 15, 1]), [{ i: 0, o: { rungs: 0 } }, { i: 2, o: { rungs: bits(1) } }]);
  T('[6] an empty seat packed with 15 after V paid rung 1 (Q201): V 20', lastCp(emp.p, V6) === CP0 - 20, showCp(emp.p));
}

// ---- [7] block format ----
{
  const ros = [H1, V1], pc = 2, h = 0x7777;
  const base = (raw) => settle7(h, 1, ros, ATTACK, { raw });
  const ch = charBlock(pc);
  const cases = [
    ['after the char block', ch.concat([CRUNG_HEAD, 0x5]), 5],
    ['without a char block', [CRUNG_HEAD, 0x5], 5],
    ['after an unknown block', ch.concat([(0xE9 | (1 << 8) | (2 << 16)) | 0, 7, 8, CRUNG_HEAD, 0x5]), 5],
    ['the high bit (rung 32)', ch.concat([CRUNG_HEAD, 0x80000000 | 0]), 0x80000000],
    ['another version', ch.concat([(0xDF | (2 << 8) | (1 << 16)) | 0, 0x5]), null],
    ['another length', ch.concat([(0xDF | (1 << 8) | (2 << 16)) | 0, 0x5, 0]), null],
    ['a zero-length word', ch.concat([(0xDF | (1 << 8)) | 0, 0x5]), null],
    ['cut short', ch.concat([CRUNG_HEAD]), null],
    ['no block', ch, null],
  ];
  for (const [label, raw, want] of cases) T('[7] contRungsOf: ' + label, v.contRungsOf(base(raw)) === want, String(v.contRungsOf(base(raw))));
  const solo = settle7(h, 0, [H1], 1, { rungs: 1 });
  T('[7] contRungsOf: a one-seat record = null (the solo lane never prices by blocks)', v.contRungsOf(solo) === null);
  const mm = settle7(h, 1, ros, 0, {}); mm[2] = 1;
  T('[7] contRungsOf: a matchmade record = null', v.contRungsOf(mm) === null);
}

// ---- [8] units: endlessRungClaims / endlessRungDebits ----
const rec = (sid, d) => ({ steamID: sid, d });
const ros8 = [H1, V1], ro8 = { 0: H1, 1: V1 };
const own = () => true;
{
  const h = 0x8800, cont = ATTACK;
  const mk = (seat, o) => rec(ros8[seat], settle7(h, seat, ros8, cont, o));
  const cl = (g, isOwn) => v.endlessRungClaims(g, ro8, isOwn || own, cont);
  let r = cl([mk(0, { rungs: HOST_BLOCK }), mk(1, { rungs: bits(1) })]);
  T('[8] claims: both blocks kept', r.masks[0] === (HOST_BLOCK >>> 0) && r.masks[1] === 1 && r.bad === 0, JSON.stringify(r));
  r = cl([mk(0, { rungs: bits(1) }), mk(1, { rungs: bits(1) })]);
  T('[8] claims: a block with fewer rungs than the seat\'s count set aside', r.masks[0] === undefined && r.masks[1] === 1 && r.bad === 1, JSON.stringify(r));
  r = cl([mk(1, { rungs: bits(1, 2) })]);
  T('[8] claims: more rungs than the seat\'s count set aside', r.masks[1] === undefined && r.bad === 1, JSON.stringify(r));
  r = cl([mk(1, { rungs: bits(17) })]);
  T('[8] claims: a rung past the run\'s total set aside', r.masks[1] === undefined && r.bad === 1, JSON.stringify(r));
  r = cl([mk(1, { rungs: bits(1) }), mk(1, { rungs: bits(2) })]);
  T('[8] claims: two different blocks for one seat -> neither', r.masks[1] === undefined && r.bad === 1, JSON.stringify(r));
  r = cl([mk(1, { rungs: bits(1) }), mk(1, { rungs: bits(1) })]);
  T('[8] claims: the same block twice -> kept', r.masks[1] === 1 && r.bad === 0, JSON.stringify(r));
  r = v.endlessRungClaims([rec(H1, settle7(h, 1, ros8, cont, { rungs: bits(1) }))], ro8, own, cont);
  T('[8] claims: a block written by someone the roster seats elsewhere set aside', r.masks[1] === undefined && r.bad === 1, JSON.stringify(r));
  r = cl([mk(1, { rungs: bits(1) })], (sid) => String(sid) !== V1);
  T('[8] claims: a block of a seat that is not an own seat of the run set aside', r.masks[1] === undefined && r.bad === 1, JSON.stringify(r));
  r = cl([rec(V1, zero7(h, 1, ros8, bits(1)))]);
  T('[8] claims: a zero-tail record\'s block ignored (not counted as bad)', r.masks[1] === undefined && r.bad === 0, JSON.stringify(r));
  r = cl([mk(0, {}), mk(1, {})]);
  T('[8] claims: no block -> nothing', r.masks.length === 0 && r.bad === 0, JSON.stringify(r));
  const rd = v.endlessRungDebits(ATTACK, ATTACK, []);
  T('[8] debits: no block = endlessDebits to the CP', JSON.stringify(rd.debits) === JSON.stringify(v.endlessDebits(ATTACK)) && rd.priced === 0, JSON.stringify(rd));
  const rd2 = v.endlessRungDebits(nib([1, 1]), nib([1, 1]), [undefined, bits(1)]);
  T('[8] debits: an unblocked seat keeps its old price when another claims its rung', rd2.debits[0] === c(1) && rd2.debits[1] === c(1), JSON.stringify(rd2));
  const rd3 = v.endlessRungDebits(nib([0, 1, 1]), nib([0, 0, 1]), [0, undefined, bits(2)]);
  T('[8] debits: a masked continue goes on the cheapest unclaimed rung (V at place 1)', rd3.debits[2] === c(1), JSON.stringify(rd3));
}
// random runs: pc 2..4, up to 20 continues in a random press order, some seats masked (Q78 / Q201), some own seats without
//   a block (older client / cold rejoiner); honest blocks = the true rungs. Bounds:
//   - nothing masked: a seat with a block pays exactly its true rungs (= what its client deducted)
//   - a seat with a block never pays more than its true rungs (its panel prices)
//   - a seat without a block never pays more than the pre-Q120 replay
//   - a masked seat pays nothing; no block anywhere = the pre-Q120 replay
//   adversarial: one own seat writes any block the claims check accepts -- every honest seat keeps the two bounds above
{
  let seed = 0x5120;
  const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  let fail = null, runs = 0, adv = 0;
  for (let it = 0; it < 4000 && !fail; it++) {
    const pc = 2 + rnd(3), N = 1 + rnd(20);
    const presses = [], counts = new Array(8).fill(0), truth = new Array(8).fill(0);
    for (let k = 0; k < N; k++) { const s = rnd(pc); if (counts[s] >= 15) continue; counts[s]++; presses.push(s); truth[s] = (truth[s] | (1 << (presses.length - 1))) >>> 0; }
    if (!presses.length) continue;
    runs++;
    const masked = [], blocked = [];
    for (let s = 0; s < pc; s++) { masked[s] = rnd(5) === 0; blocked[s] = !masked[s] && rnd(3) !== 0; }
    const contFull = nib(counts);
    let contOwn = contFull; for (let s = 0; s < pc; s++) if (masked[s]) contOwn &= ~(0xF << (4 * s));
    const masks = []; for (let s = 0; s < pc; s++) if (blocked[s]) masks[s] = truth[s];
    const today = v.endlessDebits(contOwn);
    const panel = (s) => { let t = 0; for (let b = 0; b < 32; b++) if ((truth[s] >>> b) & 1) t += c(b + 1); return t; };
    const anyMasked = masked.some(Boolean);
    const check = (deb, honest, label) => {
      for (let s = 0; s < pc && !fail; s++) {
        if (!honest(s)) continue;
        if (masked[s] && deb[s] !== 0) fail = label + ' masked seat charged ' + JSON.stringify({ it, s, deb, counts, masked });
        else if (!masked[s] && blocked[s] && deb[s] > panel(s)) fail = label + ' blocked seat above its panel ' + JSON.stringify({ it, s, deb: deb[s], panel: panel(s), counts, presses, masked, blocked });
        else if (!masked[s] && blocked[s] && !anyMasked && label === 'honest' && deb[s] !== panel(s)) fail = label + ' blocked seat not at its true rungs ' + JSON.stringify({ it, s, deb: deb[s], panel: panel(s) });
        else if (!masked[s] && !blocked[s] && deb[s] > today[s]) fail = label + ' unblocked seat above the old replay ' + JSON.stringify({ it, s, deb: deb[s], today: today[s], counts, presses, masked, blocked });
      }
    };
    check(v.endlessRungDebits(contFull, contOwn, masks).debits, () => true, 'honest');
    if (!fail && JSON.stringify(v.endlessRungDebits(contFull, contOwn, []).debits) !== JSON.stringify(today)) fail = 'no-block run differs from the old replay ' + it;
    // adversarial: seat x (own, blocked or not) writes a random block of its own count within the run's total
    const x = rnd(pc);
    if (!fail && !masked[x] && counts[x]) {
      const tot = presses.length; let m = 0, left = counts[x];
      const pool = []; for (let r = 1; r <= Math.min(32, tot); r++) pool.push(r);
      while (left > 0 && pool.length) { const k = rnd(pool.length); m = (m | (1 << (pool[k] - 1))) >>> 0; pool.splice(k, 1); left--; }
      const am = masks.slice(); am[x] = m;
      const rosR = []; for (let i = 0; i < pc; i++) rosR.push(SID(9000 + i));
      const g = [];
      for (let s = 0; s < pc; s++) if (!masked[s] && am[s] != null) g.push({ steamID: rosR[s], d: settle7(1, s, rosR, contFull, { rungs: am[s] | 0 }) });
      const rc = v.endlessRungClaims(g, Object.assign({}, rosR), () => true, contFull);
      if (rc.masks[x] === (m >>> 0)) { adv++; check(v.endlessRungDebits(contFull, contOwn, rc.masks).debits, (s) => s !== x, 'adversarial'); }
    }
  }
  T('[8] ' + runs + ' random honest runs + ' + adv + ' with a cheating seat: every bound holds', !fail && runs > 3000 && adv > 1000, fail || ('runs ' + runs + ' adv ' + adv));
}

// ---- [9] wiring pins ----
{
  T('[9] the settle prices with the blocks (endlessRungClaims -> endlessRungDebits -> debits)',
    /const debits = endlessDebits\(contOwn\);\n(?:\s*\/\/.*\n)*\s*const rungC = endlessRungClaims\(g, roster0, isOwnE, t\.continuesUsed\);\n\s*const rungD = endlessRungDebits\(t\.continuesUsed, contOwn, rungC\.masks\);/.test(SRC) && /if \(rungD\.priced\) \{[^}]*for \(let seat = 0; seat < 8; seat\+\+\) debits\[seat\] = rungD\.debits\[seat\];/.test(SRC));
  T('[9] the Q78 count of uncharged continues still replays the agreed counts', /const debitsAll = endlessDebits\(t\.continuesUsed\);/.test(SRC));
  T('[9] the consistency vector and the abstention compare 9 tail ints (the block stays out)', SRC.split('Math.min(9, r.d.length - at)').length === 3);
  T('[9] block constants 0xDF / 1 / 1 (client result-reporter.js CRUNG_*)', v.CRUNG_MAGIC === 0xDF && v.CRUNG_VER === 1 && v.CRUNG_LEN === 1);
  T('[9] a block never flags: sanityFlags does not read it', !/sanityFlags[\s\S]{0,4000}contRungsOf/.test(SRC.slice(SRC.indexOf('function sanityFlags'), SRC.indexOf('function sanityFlags') + 4000)));
}

// ---- [10] mutation self-checks ----
console.log('-- [10] mutation self-checks --');
{
  process.setMaxListeners(64);   // each unit mutant is a fresh validate.js module (its exit hooks stay registered)
  const fresh = (script) => { delete require.cache[require.resolve(script)]; return require(script); };
  const e2eFrame = (script) => { const r = frame(200, HOST_BLOCK, bits(1), script); return lastCp(r.p, V1) !== CP0 - 20; };
  const unit = (fn) => (script) => { try { return fn(fresh(script)); } catch (e) { return true; } };
  const h = 0x8900, mk = (seat, o) => rec(ros8[seat], settle7(h, seat, ros8, ATTACK, o));
  const mutants = [
    ['the settle ignores the blocks', [['for (let seat = 0; seat < 8; seat++) debits[seat] = rungD.debits[seat];', '']], e2eFrame],
    ['an unblocked seat not held to the old replay', [['out[s] = Math.min(sum, today[s]);', 'out[s] = sum;']],
      unit((m) => m.endlessRungDebits(nib([1, 1]), nib([1, 1]), [undefined, bits(1)]).debits[0] !== c(1))],
    ['the zero-tail filter removed', [['if (!r || !r.d || !endlessNzTail(r)) continue;', 'if (!r || !r.d) continue;']],
      unit((m) => m.endlessRungClaims([rec(V1, zero7(h, 1, ros8, bits(1)))], ro8, own, ATTACK).masks[1] !== undefined)],
    ['the own-seat check removed', [['|| !(isOwn ? isOwn(sid) : true)', '']],
      unit((m) => m.endlessRungClaims([mk(1, { rungs: bits(1) })], ro8, (sid) => String(sid) !== V1, ATTACK).masks[1] !== undefined)],
    ['the roster-seat check removed', [['|| sid !== String(r.steamID) ', '']],
      unit((m) => m.endlessRungClaims([rec(H1, settle7(h, 1, ros8, ATTACK, { rungs: bits(1) }))], ro8, own, ATTACK).masks[1] !== undefined)],
    ['the count check removed', [['|| rungPop(m) !== endlessNib(contFull, seat) ', '']],
      unit((m) => m.endlessRungClaims([mk(0, { rungs: bits(1) })], ro8, own, ATTACK).masks[0] !== undefined)],
    ['the run-total check removed', [['|| rungTop(m) > total) { bad++; continue; }', ') { bad++; continue; }']],
      unit((m) => m.endlessRungClaims([mk(1, { rungs: bits(17) })], ro8, own, ATTACK).masks[1] !== undefined)],
    ['two blocks for one seat: first wins', [['if (seen[seat] != null) { if (seen[seat] !== m) badAt.add(seat); continue; }', 'if (seen[seat] != null) continue;']],
      unit((m) => m.endlessRungClaims([mk(1, { rungs: bits(1) }), mk(1, { rungs: bits(2) })], ro8, own, ATTACK).masks[1] !== undefined)],
    ['masked continues not moved below the blocks', [['return r - Math.min(P, free); };', 'return r; };']],
      unit((m) => m.endlessRungDebits(nib([0, 1, 1]), nib([0, 0, 1]), [0, undefined, bits(2)]).debits[2] !== c(1))],
    ['the block version not checked', [['if (mg === CRUNG_MAGIC && ver === CRUNG_VER && len === CRUNG_LEN)', 'if (mg === CRUNG_MAGIC && len === CRUNG_LEN)']],
      unit((m) => m.contRungsOf(settle7(h, 1, ros8, ATTACK, { raw: charBlock(2).concat([(0xDF | (2 << 8) | (1 << 16)) | 0, 5]) })) !== null)],
    ['the char block not skipped', [['if (mg === CHAR_MAGIC && len === pc) { i += 1 + Math.ceil(pc / 4); continue; }   // the character block\n    if (!len) return null;\n    if (mg === CRUNG_MAGIC', 'if (!len) return null;\n    if (mg === CRUNG_MAGIC']],
      unit((m) => m.contRungsOf(settle7(h, 1, ros8, ATTACK, { rungs: 5 })) !== 5)],
  ];
  for (const [label, edits, check] of mutants) {
    if (edits.some(([from]) => SRC.split(from).length !== 2)) { bad('[10] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-cont-rungs-' + process.pid + '.js');
    try {
      let src = SRC; for (const [from, to] of edits) src = src.replace(from, to);
      fs.writeFileSync(script, src);
      T('[10] ' + label + ' -> its scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
