'use strict';
// cloud audit Q334 (R2-B2-01): the settle's state was saved after its board writes. A run killed in between (the step's time
//   limit, a request that hung, a throw after the writes) left Steam holding the new rows while the processed list on disk did not
//   know the matches, and the next run settled them again on top of those rows: a winner's points twice, a loser's taken twice,
//   XP (with the daily first win) twice, CP twice -- once more for every run that died at the same place. Now every write of the
//   settle is laid into the backlog first (PENDING_WRITES_FILE, a: 1, the absolute value the way a failed write waits), the
//   backlog, the processed list and the rest of the settle's state go to disk before the first write (saveSettled), and every
//   request gives up after REQUEST_TIMEOUT_MS. A run that dies leaves the matches processed and the writes waiting; the next run
//   sends the same absolute values again: a late write, never a second one.
// Over the REAL validate.js main() against an offline board stub whose trusted boards (rating, points, XP, CP, the endless bests
//   and their composite) carry over from run to run (each landed ForceUpdate applied, details included), and which can kill the
//   run right before or right after its n-th board write (Steam never took it / took it), or leave a write unanswered:
//   [1] the reference: a ranked 1V1 and an endless co-op settle in the same run, then a fresh co-op of two others settles
//   [2] killed right before the first write to each board (rating / points / XP / CP / endless best / composite), then the runs
//       go on: every row as in the reference, value by value (details too); the next run says it sent writes laid ahead
//   [3] killed right after the first write to each board (Steam took it): the same
//   [4] killed before every single write of the settle in turn: the same, every time
//   [5] killed at the same place run after run (three runs die before their first write): the same once one run gets through
//   [6] a write that never answers: the run gives up on it after REQUEST_TIMEOUT_MS and ends; the next run writes it: the same
//   [7] the 7-day fuse in settling runs: a player whose every write fails (rating, points, XP, CP, endless best) and whom every
//       settling run can name keeps his first-failure time while he waits; the first settling run past 7 days does not send them
//       again, its save drops them, one warning each (as on main); nothing of his is written after
//   [8] mutants: no checkpoint before the writes / no request time limit / no fuse check where the backlog is folded into the
//       settle's writes -> red
//   [9] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/settle-write-owed.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_LB_SOLO', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD',
  'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'START_CONFIRM_MS',
  'LP_LAST_HOLD_MS', 'PAGE_CAP', 'SIG_PAIR_WINDOW_MS', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'CONSOLATION_XP', 'CONSOLE_OWED_MAX_MS', 'REDEEM_LB', 'GRANT_LB', 'REQUEST_TIMEOUT_MS',
  'MSIG_BOTS', 'MSIG_PAIR', 'CRON_PULSE_LB'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// the boards the world keeps from run to run (every other board the job may create reads empty and is not followed)
const XP = 5, RATING = 6, POINTS = 7, CP = 8;
const KEPT = { [XP]: 'progress', [RATING]: 'rating', [POINTS]: 'points', [CP]: 'cp_bank', 15: 'endless_board', 11: 'endless_board_trio', 12: 'endless_board_quad',
  16: 'endless_comp_duo', 13: 'endless_comp_trio', 17: 'endless_comp_quad', 20: 'endless_classic_duo', 21: 'endless_classic_trio', 22: 'endless_classic_quad',
  30: 'endless_comp_overall', 31: 'endless_board_overall', 32: 'endless_classic_overall' };
const EN = 15, OV_CAS = 31;
// STUB_INJECT, this run only: { cut: n } -- the run is killed right before its n-th board write (Steam never sees it); { die: n } --
//   killed right after it (Steam kept it); { hang: n } -- the n-th board write never answers (until the job gives up on it);
//   { fail: [sid, ...] } -- every board write of those players answers 503 (Steam keeps none)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const INJ = JSON.parse(process.env.STUB_INJECT || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nW = 0, nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  "const log = (o) => fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(o) + '\\n');",
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  '      log({ url: u, body, applied: true });',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      const id = had ? had.id : nextId++;',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } });',
  '    }',
  '    if (/SetLeaderboardScore/.test(u)) {',
  '      nW++;',
  '      if (INJ.cut === nW) process.exit(7);',
  '      if (INJ.hang === nW) {',
  "        log({ url: u, body, applied: false, hung: true });",
  '        return new Promise((res, rej) => {',   // a socket that stays open: the process lives on until the job gives up on it
  '          const keep = setInterval(() => {}, 1000), s = init.signal;',
  "          if (s) s.addEventListener('abort', () => { clearInterval(keep); rej(s.reason || new Error('aborted')); });",
  '        });',
  '      }',
  '    }',
  "    if (INJ.fail && /SetLeaderboardScore/.test(u) && INJ.fail.indexOf((/steamid=([0-9]+)/.exec(body) || [])[1]) >= 0) { log({ url: u, body, applied: false, failed: 503 }); return resp({ error: 'injected' }, 503); }",
  '    log({ url: u, body, applied: true });',
  '    if (INJ.die != null && INJ.die === nW && /SetLeaderboardScore/.test(u)) process.exit(7);',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const bid = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[bid];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(script, boards, files, inject, envExtra, timeoutMs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-write-ahead-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json'); fs.writeFileSync(fxPath, JSON.stringify({ boards }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T12:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
      STUB_INJECT: JSON.stringify(inject || {}),
    }, envExtra || {}, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: timeoutMs || 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { const p = sg.players[k]; if (p.bz) p.bz -= ms; if (p.pdk) for (const m of Object.keys(p.pdk)) p.pdk[m] -= ms; }
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) {
    for (const f of ['w', 'l', 'xw', 'cw', 'rw']) if (pw[k] && pw[k][f] && pw[k][f].t) pw[k][f].t -= ms;
    const ew = pw[k] && pw[k].ew; if (ew) for (const b of Object.keys(ew)) if (ew[b] && ew[b].t) ew[b].t -= ms;
  }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a 1V1 record (version 3): magic 0xB2 = the start, 0xB1 = the result
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// an endless co-op (mt 7) result and its start
const ESEED = 9;
function rec7(hash, seat, ros, ed, sc) {
  const d = [0xB1, 3, 7, hash | 0, ESEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push(sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(0, ed | 0, 0, 0, 0, 0);
  return d;
}
function start7(hash, seat, ros) {
  const d = [0xB2, 1, 7, hash | 0, ESEED, seat, 0, 0, ros.length, 0];
  for (let i = 0; i < ros.length; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const P = SID(3340), Q = SID(3341), A = SID(3342), B = SID(3343), C = SID(3344), D = SID(3345);
const MIN = 60000;
function world(script) {
  const w = { recs: [], b: {}, state: null, log: [], script: script || null };
  for (const id of Object.keys(KEPT)) w.b[id] = {};
  w.b[POINTS][P] = { score: 2500, hex: '' }; w.b[POINTS][Q] = { score: 2400, hex: '' };
  return w;
}
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, detailData: hexLE(r.d) }); }
  boards.push({ id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] }, { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
  for (const id of Object.keys(KEPT)) boards.push({ id: Number(id), name: KEPT[id], entries: Object.keys(w.b[id]).map((s) => ({ steamID: s, score: w.b[id][s].score | 0, detailData: w.b[id][s].hex || '' })) });
  return boards;
}
const bodyHex = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };
const isSet = (p) => /SetLeaderboardScore/.test(p.url);
// one run: the state on disk as the run left it goes to the next run (a killed run too: the persist step keeps what is on disk)
function step(w, ms, inject, timeoutMs) {
  if (w.state && w.state.__failed) return null;
  const r = runCron(w.script, boardsOf(w), w.state ? advance(w.state, ms) : null, inject, inject && inject.hang ? { REQUEST_TIMEOUT_MS: '1500' } : null, timeoutMs);
  w.log.push(r);
  const killed = r.code === 7 && inject && (inject.cut || inject.die);
  if (r.code !== 0 && !killed) { w.state = { __failed: true }; return r; }
  w.state = r.state;
  for (const p of r.posts) {   // the boards as Steam keeps them: every write that landed (ForceUpdate, absolute; details replaced)
    if (!p.applied || !isSet(p)) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1], sid = (/steamid=([0-9]+)/.exec(p.body) || [])[1];
    if (w.b[bid]) w.b[bid][sid] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
  }
  return r;
}
// the course: a ranked 1V1 of P (the winner) and Q starts; an endless casual co-op of A and B goes up whole (sighted); ten minutes
//   on the 1V1's results go up and both settle in that run (SETTLE, `inj`; `again`: the injection of the runs right after it);
//   then a casual co-op of C and D goes up and settles a run later (a settling run: the composites are rebuilt), one quiet run
const SETTLE = 1;
function course(script, inj, again, timeoutMs) {
  const w = world(script), two = [P, Q], ab = [A, B], cd = [C, D];
  w.recs.push({ sid: P, d: rec(0xB2, 2, 0x3341, 0, 0, false, two, null) }, { sid: Q, d: rec(0xB2, 2, 0x3341, 1, 0, false, two, null) },
    { sid: A, d: start7(0x3342, 0, ab) }, { sid: B, d: start7(0x3342, 1, ab) }, { sid: A, d: rec7(0x3342, 0, ab, 5, [400, 300]) }, { sid: B, d: rec7(0x3342, 1, ab, 5, [400, 300]) });
  step(w, 5 * MIN);
  w.recs.push({ sid: P, d: rec(0xB1, 2, 0x3341, 0, 1, true, two, [7000, 4000]) }, { sid: Q, d: rec(0xB1, 2, 0x3341, 1, 2, false, two, [7000, 4000]) });
  step(w, 10 * MIN, inj || null, timeoutMs);
  for (const a of (again || [])) step(w, 5 * MIN, a);
  w.recs.push({ sid: C, d: start7(0x3344, 0, cd) }, { sid: D, d: start7(0x3344, 1, cd) }, { sid: C, d: rec7(0x3344, 0, cd, 3, [200, 150]) }, { sid: D, d: rec7(0x3344, 1, cd, 3, [200, 150]) });
  step(w, 5 * MIN);
  step(w, 10 * MIN);
  step(w, 5 * MIN);
  return w;
}
const runsOk = (w) => !(w.state && w.state.__failed) && w.log.every((r) => r.code === 0 || r.code === 7);
const outOf = (w) => w.log.map((r) => r.out).join('\n');
// every kept row (score + details), by board name
const rows = (w) => { const o = {}; for (const id of Object.keys(KEPT)) { const b = w.b[id]; o[KEPT[id]] = Object.keys(b).sort().map((s) => [s.slice(-4), b[s].score, b[s].hex]); } return o; };
const score = (w, bid, s) => (w.b[bid][s] ? w.b[bid][s].score : null);
const diff = (a, b) => { const x = rows(a), y = rows(b), out = []; for (const k of Object.keys(x)) if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(k + ': ' + JSON.stringify(x[k]).slice(0, 300) + ' vs ' + JSON.stringify(y[k]).slice(0, 300)); return out.join(' | '); };
const same = (a, b) => JSON.stringify(rows(a)) === JSON.stringify(rows(b));

// mutants: validate.js with one part of the fix put back
const BEFORE = {
  // the code before: the settle's state goes to disk after the writes only
  noCheckpoint: ['  saveSettled(true);\n', ''],
  // no time limit on a request
  noTimeout: ['const reqSignal = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS);', 'const reqSignal = () => undefined;'],
  // the first draft: a waiting write past the fuse folded into the settle's writes all the same (laid ahead afresh)
  noFuseFold: ['    if (!w || aheadLive(w)) return false;\n', '    if (!w || true) return false;\n'],
};
let mutN = 0;
function mutant(key, tag) {
  const [from, to] = BEFORE[key];
  const n = SRC.split(from).length - 1;
  if (n !== 1) { bad(tag + ' mutant ' + key + ': anchor found ' + n + ' times'); return null; }
  const script = path.join(__dirname, '..', '.mutant-settle-write-ahead-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
const withMutant = (key, tag, fn) => { const s = mutant(key, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// ---- [1] the reference ----
const ref = course(null);
const setW = ref.log[SETTLE] ? ref.log[SETTLE].posts.filter(isSet) : [];
const boardOf = (p) => (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1];
{
  T('[1] all runs exit 0', ref.log.length === 5 && ref.log.every((r) => r.code === 0), ref.log.map((r) => r.code).join(','));
  T('[1] the 1V1 settles in the settle run: P\'s points up, Q\'s down, both rated, both with XP; P with CP',
    score(ref, POINTS, P) > 2500 && score(ref, POINTS, Q) < 2400 && score(ref, RATING, P) != null && score(ref, RATING, Q) != null && score(ref, XP, P) > 0 && score(ref, XP, Q) > 0 && score(ref, CP, P) > 0,
    JSON.stringify(rows(ref)).slice(0, 800) + ' ' + outOf(ref).slice(-1500));
  T('[1] the co-op settles in the same run: A and B on the endless board and the composite', score(ref, EN, A) > 0 && score(ref, EN, B) > 0 && score(ref, OV_CAS, A) > 0 && score(ref, OV_CAS, B) > 0,
    JSON.stringify(rows(ref)).slice(0, 800));
  const firstOf = {};
  setW.forEach((p, i) => { const b = boardOf(p); if (firstOf[b] == null) firstOf[b] = i + 1; });
  T('[1] the settle run writes the six boards (rating, points, XP, CP, endless best, composite)', [RATING, POINTS, XP, CP, EN, OV_CAS].every((b) => firstOf[b] != null), JSON.stringify(firstOf));
  T('[1] the settle run lays its writes ahead, on disk before the first one', /write-ahead: [0-9]+ write\(s\) of this run on disk before the first one goes out \(Q334\)/.test(ref.log[SETTLE] ? ref.log[SETTLE].out : ''));
  T('[1] nothing waits at the end, nothing laid ahead is left open', !Object.keys((ref.state && ref.state.PENDING_WRITES_FILE) || {}).some((k) => { const e = ref.state.PENDING_WRITES_FILE[k]; return e.w || e.xw || e.cw || e.rw || e.ew; }),
    JSON.stringify((ref.state || {}).PENDING_WRITES_FILE));
  ref.firstOf = firstOf;
}
const NAMES = { [RATING]: 'rating', [POINTS]: 'points', [XP]: 'XP', [CP]: 'CP', [EN]: 'endless best', [OV_CAS]: 'composite' };

// ---- [2] / [3] killed right before / right after the first write to each board ----
for (const bid of [RATING, POINTS, XP, CP, EN, OV_CAS]) {
  const n = ref.firstOf[bid];
  if (!n) { bad('[2] no write to ' + NAMES[bid] + ' in the reference'); continue; }
  const w = course(null, { cut: n });
  T('[2] killed right before the first ' + NAMES[bid] + ' write (write ' + n + ' of ' + setW.length + '): the run died, the others exit 0', w.log[SETTLE].code === 7 && runsOk(w) && w.log.filter((r) => r.code === 7).length === 1,
    w.log.map((r) => r.code).join(','));
  T('[2] ... every row as in the reference (score and details)', same(w, ref), diff(w, ref));
  if (bid !== OV_CAS) T('[2] ... the next run sends the writes laid ahead', /laid ahead by a run that ended before its outcome was known/.test(w.log[SETTLE + 1].out), w.log[SETTLE + 1].out.slice(-1200));
  const x = course(null, { die: n });
  T('[3] killed right after the first ' + NAMES[bid] + ' write (Steam took it): every row as in the reference', x.log[SETTLE].code === 7 && runsOk(x) && same(x, ref), diff(x, ref));
}

// ---- [4] killed before every single write of the settle in turn ----
{
  const off = [];
  for (let n = 1; n <= setW.length; n++) {
    const w = course(null, { cut: n });
    if (!(w.log[SETTLE].code === 7 && runsOk(w) && same(w, ref))) off.push(n + ' (' + NAMES[boardOf(setW[n - 1])] + '): ' + diff(w, ref).slice(0, 300));
  }
  T('[4] killed before each of the ' + setW.length + ' writes of the settle in turn: every row as in the reference every time', setW.length > 6 && off.length === 0, off.join(' || '));
}

// ---- [5] killed at the same place run after run ----
{
  const w = course(null, { cut: 1 }, [{ cut: 1 }, { cut: 1 }]);
  T('[5] the settle run and the two after it die before their first write, then the runs go on: every row as in the reference',
    w.log.slice(SETTLE, SETTLE + 3).every((r) => r.code === 7) && runsOk(w) && same(w, ref), diff(w, ref) + ' ' + w.log.map((r) => r.code).join(','));
  T('[5] (the points of the 1V1 counted once: P 2500 + his win, as in the reference)', score(w, POINTS, P) === score(ref, POINTS, P) && score(w, XP, P) === score(ref, XP, P) && score(w, CP, P) === score(ref, CP, P),
    [score(w, POINTS, P), score(ref, POINTS, P), score(w, XP, P), score(ref, XP, P)].join(','));
}

// ---- [6] a write that never answers ----
{
  const n = ref.firstOf[POINTS];
  const w = course(null, { hang: n });
  const r = w.log[SETTLE];
  T('[6] the points write hangs: the run gives up on it after REQUEST_TIMEOUT_MS and ends (exit 0)', r && r.code === 0 && !r.timedOut, r ? (r.code + ' ' + r.out.slice(-800)) : 'no run');
  T('[6] ... it waits for the next run, which writes it: every row as in the reference', runsOk(w) && same(w, ref), diff(w, ref));
}

// ---- [7] the 7-day fuse in settling runs ----
//   H wins a ranked 1V1 against J and plays an endless co-op with K; every board write of H fails from that settle on (Steam keeps
//   none). Every other day two other players put up an endless co-op: one run sights it, the next settles it -- a settling run
//   that names H (his records stay up). Within 7 days H's five writes wait with their first failure's time, tried at every run;
//   the settling run just past 7 days does not send them again and its save drops them, one warning each, as on main; nothing of
//   his is written after. `again`: H's second ranked 1V1 (against L) settles in that very run, his writes failing still.
const DAY = 86400000;
const KINDS = [['w', 'points', POINTS], ['xw', 'xp', XP], ['cw', 'cp', CP], ['rw', 'rating', RATING], ['ew', 'endless best', EN]];
const H = SID(3350), J = SID(3351), K = SID(3352), L = SID(3353);
function fuseCourse(script, again) {
  const w = world(script), FAIL = { fail: [H] };
  w.seen = [];   // per run: the test's clock right after it (a stored instant t is the age now - t)
  const go = (ms) => { step(w, ms, FAIL); w.seen.push(Date.now()); };
  const hj = [H, J], hk = [H, K], hl = [H, L];
  w.recs.push({ sid: H, d: rec(0xB2, 2, 0x3350, 0, 0, false, hj, null) }, { sid: J, d: rec(0xB2, 2, 0x3350, 1, 0, false, hj, null) },
    { sid: H, d: start7(0x3351, 0, hk) }, { sid: K, d: start7(0x3351, 1, hk) }, { sid: H, d: rec7(0x3351, 0, hk, 5, [400, 300]) }, { sid: K, d: rec7(0x3351, 1, hk, 5, [400, 300]) });
  go(5 * MIN);
  w.recs.push({ sid: H, d: rec(0xB1, 2, 0x3350, 0, 1, true, hj, [7000, 4000]) }, { sid: J, d: rec(0xB1, 2, 0x3350, 1, 2, false, hj, [7000, 4000]) });
  go(10 * MIN);   // the settle: H's five writes fail
  w.at = { settle: w.log.length - 1 };
  let n = 0;
  const coop = (sight, gap, h1, h2) => {   // another pair's co-op, sighted `sight` after the run before, settled `gap` later
    const a = SID(3360 + 2 * n), b = SID(3361 + 2 * n), ab = [a, b], hh = 0x3360 + (n++);
    w.recs.push({ sid: a, d: start7(hh, 0, ab) }, { sid: b, d: start7(hh, 1, ab) }, { sid: a, d: rec7(hh, 0, ab, 3, [200, 150]) }, { sid: b, d: rec7(hh, 1, ab, 3, [200, 150]) });
    if (h1) h1();
    go(sight);
    if (h2) h2();
    go(gap);
  };
  coop(2 * DAY, 10 * MIN); coop(2 * DAY, 10 * MIN); coop(2 * DAY, 10 * MIN);   // ~2 / 4 / 6 days
  coop(DAY - 50 * MIN, 30 * MIN,   // sighted at ~6 d 23 h 40 m (+ the runs' own few seconds), settled at ~7 d 0 h 10 m
    again ? () => w.recs.push({ sid: H, d: rec(0xB2, 2, 0x3353, 0, 0, false, hl, null) }, { sid: L, d: rec(0xB2, 2, 0x3353, 1, 0, false, hl, null) }) : null,
    again ? () => w.recs.push({ sid: H, d: rec(0xB1, 2, 0x3353, 0, 1, true, hl, [7000, 4000]) }, { sid: L, d: rec(0xB1, 2, 0x3353, 1, 2, false, hl, [7000, 4000]) }) : null);
  w.at.past = w.log.length - 1;
  coop(2 * DAY, 10 * MIN);   // ~9 days
  return w;
}
const hk8 = v.pid(H).slice(0, 8);
const pendH = (w, i) => { const pw = (w.log[i] && w.log[i].state && w.log[i].state.PENDING_WRITES_FILE) || {}; return pw[v.pid(H)] || {}; };
const entH = (w, i, f) => { const e = pendH(w, i); return f === 'ew' ? ((e.ew || {}).endless_board || null) : (e[f] || null); };
const ageH = (w, i, f) => { const e = entH(w, i, f); return e ? (w.seen[i] - Number(e.t)) / DAY : null; };
const writesH = (w, i, bid) => w.log[i].posts.filter((p) => isSet(p) && (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1] === String(bid) && (/steamid=([0-9]+)/.exec(p.body) || [])[1] === H).length;
const dropRe = (name) => new RegExp('::warning::' + name + ' write of ' + hk8 + (name === 'endless best' ? ' on endless_board' : '') + ' dropped after [0-9]+ failed tries over 7 days', 'g');
const restartRe = (name) => new RegExp('::warning::' + name + ' write of ' + hk8 + ' waited past 7 days', 'g');
const fuseW = fuseCourse(null);
{
  const w = fuseW, S0 = w.at.settle, PX = w.at.past, END = w.log.length - 1;
  T('[7] all runs exit 0 (' + w.log.length + ' runs)', runsOk(w) && w.log.every((r) => r.code === 0), w.log.map((r) => r.code).join(','));
  for (const [f, name, bid] of KINDS) {
    T('[7] ' + name + ': the settle\'s write of H fails and waits', !!entH(w, S0, f) && writesH(w, S0, bid) >= 1, JSON.stringify(pendH(w, S0)));
    const a = ageH(w, PX - 1, f), e = entH(w, PX - 1, f), tried = w.log.slice(S0 + 1, PX).reduce((x, r, j) => x + writesH(w, S0 + 1 + j, bid), 0);
    T('[7] ' + name + ': the run before the fuse, it still waits with its first failure\'s time (age ' + (a == null ? '-' : a.toFixed(3)) + ' d), tried at the runs since (' + tried + ' writes, ' + (e ? e.n | 0 : '-') + ' tries)',
      a != null && a > 6.95 && a < 7 && tried >= 6 && (e.n | 0) >= 6, JSON.stringify(e));
    const drops = w.log.map((r) => (r.out.match(dropRe(name)) || []).length);
    T('[7] ' + name + ': the first settling run past 7 days drops it at its save, one warning (and no run before it)', drops[PX] === 1 && drops.reduce((x, y) => x + y, 0) === 1 && !entH(w, PX, f),
      'warnings per run ' + drops.join(',') + ' ' + w.log[PX].out.slice(-1500));
    T('[7] ' + name + ': that run does not send it again, no run after it writes H\'s row, nothing of his waits at the end',
      w.log.slice(PX).every((r, j) => writesH(w, PX + j, bid) === 0) && !entH(w, END, f), w.log.slice(PX).map((r, j) => writesH(w, PX + j, bid)).join(','));
  }
  T('[7] the run past 7 days says it does not send them (five lines)', (w.log[PX].out.match(new RegExp('write of ' + hk8 + ' waits past the 7-day fuse \\([0-9]+ tries, value -?[0-9]+\\): not sent again', 'g')) || []).length === 5, w.log[PX].out.slice(-1500));
  T('[7] no write of H is started afresh (no restart warning), nothing of H waits at the end', !/waited past 7 days/.test(outOf(w)) && !Object.keys(pendH(w, END)).some((f) => ['w', 'xw', 'cw', 'rw', 'ew'].includes(f)), JSON.stringify(pendH(w, END)));
  T('[7] H\'s composite row is not written after it either', w.log.slice(PX).every((r, j) => writesH(w, PX + j, OV_CAS) === 0));
}
{
  const w = fuseCourse(null, true), PX = w.at.past, END = w.log.length - 1;
  const old = entH(w, PX - 1, 'w'), nw = entH(w, PX, 'w');
  T('[7] again: H\'s second 1V1 settles past 7 days on top of the waiting points (base kept: ' + (old && old.v) + ' -> ' + (nw && nw.v) + '), its write starts the fuse again, warned',
    runsOk(w) && old && nw && nw.v > old.v && (nw.n | 0) === 1 && ageH(w, PX, 'w') < 0.01 && (w.log[PX].out.match(restartRe('points')) || []).length === 1 && !(w.log[PX].out.match(dropRe('points')) || []).length,
    JSON.stringify([old, nw]) + ' ' + w.log[PX].out.slice(-1500));
  for (const [f, name] of [['xw', 'xp'], ['cw', 'cp'], ['rw', 'rating']]) {
    const o = entH(w, PX - 1, f), x = entH(w, PX, f);
    T('[7] again: ' + name + ' the same (' + (o && o.v) + ' -> ' + (x && x.v) + ', fuse again, warned)', o && x && (x.n | 0) === 1 && ageH(w, PX, f) < 0.01 && (w.log[PX].out.match(restartRe(name)) || []).length === 1,
      JSON.stringify([o, x]));
  }
  T('[7] again: his endless best (no new co-op) is dropped as before, warned once', (w.log[PX].out.match(dropRe('endless best')) || []).length === 1 && !entH(w, PX, 'ew'));
  T('[7] again: the new writes wait at the end (within their fuse), still failing', ['w', 'xw', 'cw', 'rw'].every((f) => !!entH(w, END, f) && ageH(w, END, f) > 1.9 && ageH(w, END, f) < 2.1), JSON.stringify(pendH(w, END)));
}

// ---- [8] mutants ----
withMutant('noCheckpoint', '[8]', (m) => {
  const w = course(m, { cut: ref.firstOf[XP] });
  T('[8] mutant (no checkpoint before the writes): killed before the first XP write, the 1V1 settles again -- P\'s points counted twice',
    runsOk(w) && score(w, POINTS, P) > score(ref, POINTS, P), [score(w, POINTS, P), score(ref, POINTS, P)].join(' vs '));
});
withMutant('noTimeout', '[8]', (m) => {
  const w = course(m, { hang: ref.firstOf[POINTS] }, undefined, 15000);
  const r = w.log[SETTLE];
  T('[8] mutant (no request time limit): the hung write holds the run until it is killed from outside', !!(r && (r.timedOut || r.code !== 0)), r ? String(r.code) : 'no run');
});
withMutant('noFuseFold', '[8]', (m) => {
  const w = fuseCourse(m), END = w.log.length - 1;
  const drops = KINDS.map(([f, name]) => (outOf(w).match(dropRe(name)) || []).length);
  T('[8] mutant (no fuse check where the backlog is folded into the settle): H\'s five writes start afresh past 7 days -- never dropped, never warned, still waiting and written at the end',
    runsOk(w) && drops.every((x) => x === 0) && KINDS.every(([f, , bid]) => !!entH(w, END, f) && writesH(w, END, bid) >= 1), 'drop warnings ' + drops.join(',') + ' ' + JSON.stringify(pendH(w, END)));
});

// ---- [9] wiring pins ----
{
  const iDry = SRC.indexOf("  if (!APPLY_MMR) { console.log('APPLY_MMR=0 dry-run, nothing written'); return; }"), iSettle = SRC.indexOf('  saveSettled(true);\n');
  const iRating = SRC.indexOf('  const wRating = await mapPool(ratingSids, '), iEnd = SRC.indexOf('  saveSettled(false);');
  T('[9] the settle\'s state goes to disk after the dry-run return and before the first board write', iDry > 0 && iSettle > iDry && iRating > iSettle && iEnd > iRating);
  const body = SRC.slice(SRC.indexOf('  const saveSettled = (checkpoint) => {'), SRC.indexOf('\n  };', SRC.indexOf('  const saveSettled = (checkpoint) => {')));
  T('[9] saveSettled keeps the backlog, the processed list, the skill / groups / leavers / starts / solo / confessions / signals / XP state',
    ['savePendingWrites(lpBacklog, nowMs, !checkpoint);', 'saveProcessed(processed);', 'saveSkill(skill);', 'saveGroups(groupMem, nowMs);', 'saveLeavers(leavers);', 'saveStarts(startsPending);',
      'saveSolo(soloState, nowMs);', 'saveConfessions(confState, nowMs, confLive);', 'saveSignals(signals, nowMs);', 'saveXp(xpState);'].every((s) => body.indexOf(s) > 0));
  const lays = ["  for (const sid of ratingSids) rowLayAhead('rw', sid, ratingWriteOf(sid).disp);", '  if (lpBoardId) for (const sid of Object.keys(changedLp)) lpPlanned[sid] = lpLayAhead(sid, changedLp[sid], lpDet[sid], reveal[sid]);',
    "  for (const sid of Object.keys(changedXp)) rowLayAhead('xw', sid, changedXp[sid] | 0);", "  for (const sid of Object.keys(changedCp)) rowLayAhead('cw', sid, cpClamp(changedCp[sid]));",
    '  for (const d of ebBoards) for (const sid of Object.keys(d.pool || {})) ebLayAhead(d.name, sid, d.pool[sid]);'];
  T('[9] every write pool of the settle is laid ahead before the state goes to disk', lays.every((s) => { const i = SRC.indexOf(s); return i > iDry && i < iSettle; }), lays.filter((s) => !(SRC.indexOf(s) > iDry && SRC.indexOf(s) < iSettle)).join(' | '));
  T('[9] the rating rows and the trust board run right after it (their touched sets live in this run only)', /\n  saveSettled\(true\);\n  await maintainRating\(soloState, ratingTouched\);[^\n]*\n  await maintainTrust\(\);/.test(SRC));
  T('[9] every request carries the time limit (getJson, postForm, postFormDetails)', (SRC.match(/signal: reqSignal\(\)/g) || []).length >= 3
    && /const REQUEST_TIMEOUT_MS = Math\.max\(1000, Number\(process\.env\.REQUEST_TIMEOUT_MS \|\| 30000\)\);/.test(SRC));
  const folds = ["if (pw && changedLp[sid] == null && !pastFuse('points', sid, pw)) changedLp[sid] = pw.v | 0;", "if (w && changedXp[sid] == null && !pastFuse('xp', sid, w)) changedXp[sid] = xp[sid] | 0;",
    "if (w && changedCp[sid] == null && !pastFuse('cp', sid, w)) changedCp[sid] = cp[sid] | 0;", "    if (changed[sid] || pastFuse('rating', sid, rowWaiting('rw', sid))) continue;", "    if (pastFuse('endless best', sid, was)) return;"];
  T('[9] every place the backlog is folded into the settle\'s writes leaves out a write past the fuse (points, XP, CP, rating, endless best)', folds.every((x) => SRC.split(x).length === 2) && (SRC.match(/pastFuse\('/g) || []).length === 5,
    folds.filter((x) => SRC.split(x).length !== 2).join(' | '));
  T('[9] the backlog header documents rw and the a marker', /\/\/   rw: \{ b, v, t, n \} -- the same for a rating row of the settle \(cloud audit Q334\)/.test(SRC) && /\/\/   a: 1 on a w \/ xw \/ cw \/ rw \/ ew entry -- written ahead \(cloud audit Q334\)/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (settle-write-ahead) ===');
process.exit(failN === 0 ? 0 : 1);
