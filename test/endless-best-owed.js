'use strict';
// cloud audit Q319: an endless BEST write of the settle that failed (Steam down, a 5xx, a network error) was logged and forfeited --
//   the match processed all the same, the board kept the best before it, a later run between the two went up as a "new best" over
//   it, and the composite rows read from these boards missed it too. Now such a write waits in the O480 backlog (PENDING_WRITES_FILE,
//   ew = { <board>: { v, ts, bd?, tm?, t, n } }: the packed best, the row's details -- ts / build / the team as pids --, the first
//   failure, the tries). These boards keep a best, not a balance: the waiting value is laid over his row read next run only where
//   it is higher (a row as high or higher ends the wait), every reader of the board takes it as his row in that run (the settle's
//   "is it a new best", the chain rule, the composites), the write goes out with the higher one, a write of his that lands at or
//   above it ends the wait, one that fails waits instead (the higher of the two), and a quiet run writes it on its own.
// Over the REAL validate.js main() against an offline board stub whose endless boards carry over from run to run (each landed
//   ForceUpdate applied, details included; a delete removes the row), and which can fail a player's n-th write to a board in a run
//   (answered with a status or thrown, Steam keeping it or not):
//   [1] units: prunePendingWrites (ew past the fuse, malformed, kept)
//   [2] the failures, each against the same runs with nothing failing (a deep run fails, two quiet runs, a shallower run): casual
//       duo (500) / competitive duo (503) / classic duo (thrown) -- the honest player ends with the same row (details too: the team
//       block rebuilt from pids) and the same composite row; the season twin and this week's cup board (season 1) the same way
//   [3] the run right after the failure: the waiting value is written with it and a shallower run of that run is not written over
//       it; the retry fails again (tries counted, the first failure kept) and the shallower run still is not written; a deeper run
//       while it waits supersedes it (landed, or failed too: the deeper one waits instead)
//   [4] never twice, never lower: Steam kept the failed write (found on the board, not written again); a waiting value under his
//       row (an older job version ran meanwhile) leaves the row alone
//   [5] the chain rule reads the waiting depth: a resume from it settles after one level of time, not the whole span
//   [6] a seedcap correction of the run that waits: the wait ends, his older row stays (not deleted), the convicted run never lands
//   [7] the fuse past 7 days, a board no longer written (season turned, week closed), a player no run can name (waits), a dry run
//       (writes nothing, keeps it), a quiet run writes it alone
//   [8] mutants: no backlog (the code before) / not laid over the rows / laid without the max / no quiet retry / no seedcap cancel /
//       no team block
//   [9] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/settle-write-owed.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_LB_SOLO', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD',
  'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'START_CONFIRM_MS',
  'LP_LAST_HOLD_MS', 'PAGE_CAP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const S0_NOW = '2026-10-01T12:00:00Z', S1_NOW = '2026-12-10T12:00:00Z', WEEK = v.cupWeekId(Date.parse(S1_NOW));
// the endless best boards the world keeps (every other board the job may create reads empty and is not followed)
const EN = 15, EN3 = 11, EN4 = 12, COMP2 = 16, COMP3 = 13, COMP4 = 17, CLS2 = 20, CLS3 = 21, CLS4 = 22, OV_COMP = 30, OV_CAS = 31, OV_CLS = 32, EN_S1 = 23, COMP2_S1 = 24, COMP2_W = 25;
const BEST = { [EN]: 'endless_board', [EN3]: 'endless_board_trio', [EN4]: 'endless_board_quad', [COMP2]: 'endless_comp_duo', [COMP3]: 'endless_comp_trio', [COMP4]: 'endless_comp_quad',
  [CLS2]: 'endless_classic_duo', [CLS3]: 'endless_classic_trio', [CLS4]: 'endless_classic_quad', [OV_COMP]: 'endless_comp_overall', [OV_CAS]: 'endless_board_overall', [OV_CLS]: 'endless_classic_overall',
  [EN_S1]: 'endless_board_s1', [COMP2_S1]: 'endless_comp_duo_s1', [COMP2_W]: v.cupWeekBoardName('endless_comp_duo', WEEK) };
// STUB_INJECT, this run only: { post: { <board id>: { <sid>: [o1, o2, ...] } } } -- his n-th write to that board this run answers
//   o_n = [status | 'throw', applied] (null or absent: normally), Steam keeping it when `applied`
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const INJ = JSON.parse(process.env.STUB_INJECT || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'const seen = {};',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1], bid = (/leaderboardid=([0-9]+)/.exec(body) || [])[1];",
  '    const set = /SetLeaderboardScore/.test(u);',
  "    const k = bid + ':' + sid; if (set) seen[k] = (seen[k] || 0) + 1;",
  '    const f = set && INJ.post && INJ.post[bid] && INJ.post[bid][sid] ? INJ.post[bid][sid][seen[k] - 1] || null : null;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: f ? !!f[1] : true, failed: f ? f[0] : 0 }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: had ? had.id : nextId++ } } });',
  '    }',
  "    if (f) { if (f[0] === 'throw') throw new Error('injected network error'); return resp({ error: 'injected' }, f[0]); }",
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
function runCron(script, boards, files, inject, envExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-best-owed-'));
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
      SEASON_NOW: S0_NOW, STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
      STUB_INJECT: JSON.stringify(inject || {}),
    }, envExtra || {}, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// the chain memories age by the step between runs (a start attestation's first sighting, the pacing clocks, a backlog entry's times)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) { const ew = pw[k] && pw[k].ew; if (ew) for (const b of Object.keys(ew)) if (ew[b] && ew[b].t) ew[b].t -= ms; }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9, MIN = 60000;
function rec7(hash, seat, ros, sd, ed, flags, sc, season) {
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push(sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, season | 0, flags | 0);
  return d;
}
function start7(hash, seat, ros) {
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, ros.length, 0];
  for (let i = 0; i < ros.length; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const SEG_COMP = 8, SEG_CLASSIC = 32;
function world(opt) {
  const w = { recs: [], b: {}, state: null, log: [], hn: 0x5190, script: (opt && opt.script) || null, env: (opt && opt.env) || {}, files: (opt && opt.files) || null };
  for (const id of Object.keys(BEST)) w.b[id] = {};
  for (const id of Object.keys((opt && opt.rows) || {})) Object.assign(w.b[id], opt.rows[id]);
  return w;
}
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, detailData: hexLE(r.d) }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [SID(1), SID(2)].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
  for (const id of Object.keys(BEST)) boards.push({ id: Number(id), name: BEST[id], entries: Object.keys(w.b[id]).map((s) => ({ steamID: s, score: w.b[id][s].score | 0, detailData: w.b[id][s].hex || '' })) });
  return boards;
}
const bodyHex = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };
function step(w, ms, inject, envExtra) {
  if (w.state && w.state.__failed) return null;
  const files = w.state ? advance(w.state, ms) : w.files;
  const r = runCron(w.script, boardsOf(w), files, inject, Object.assign({}, w.env, envExtra || {}));
  w.log.push(r);
  if (r.code !== 0) { w.state = { __failed: true }; return r; }
  if (!(envExtra && envExtra.APPLY_MMR === '0')) w.state = r.state;
  for (const p of r.posts) {
    if (!p.applied) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1], sid = (/steamid=([0-9]+)/.exec(p.body) || [])[1];
    if (!w.b[bid]) continue;
    if (/SetLeaderboardScore/.test(p.url)) w.b[bid][sid] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
    else if (/DeleteLeaderboardScore/.test(p.url)) delete w.b[bid][sid];
  }
  return r;
}
const A = SID(1), B = SID(2), ROS = [A, B];
// one co-op run of A and B (seat 0 = A) from depth sd to ed, both writing it: the starts and results go up together, the first run
//   sights it (paced; injSight), the next one -- `gap` later (default 10 minutes) -- settles it (injSettle). Returns its match key.
function run(w, flags, ed, sc, injSettle, o) {
  o = o || {};
  const h = ++w.hn;
  w.recs.push({ sid: A, d: start7(h, 0, ROS) }, { sid: B, d: start7(h, 1, ROS) }, { sid: A, d: rec7(h, 0, ROS, o.sd | 0, ed, flags, sc, o.season) }, { sid: B, d: rec7(h, 1, ROS, o.sd | 0, ed, flags, sc, o.season) });
  step(w, 5 * MIN, o.injSight || null, o.env);
  step(w, o.gap || 10 * MIN, injSettle || null, o.env);
  return h + '_' + SEED + '_7';
}
const quiet = (w, n, inject, env) => { for (let i = 0; i < n; i++) step(w, 5 * MIN, inject || null, env); };
const fine = (w) => !(w.state && w.state.__failed) && w.log.every((r) => r.code === 0);
const row = (w, bid, s) => (w.b[bid][s] ? w.b[bid][s].score : null);
const hexOf = (w, bid, s) => (w.b[bid][s] ? w.b[bid][s].hex : null);
const pend = (w, s) => ((w.state && w.state.PENDING_WRITES_FILE) || {})[v.pid(s)] || {};
const ewOf = (w, s, name) => (pend(w, s).ew || {})[name] || null;
const outOf = (w) => w.log.map((r) => r.out).join('\n');
const writesOf = (r, bid, s) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + bid + '(&|$)').test(p.body) && p.body.indexOf('steamid=' + s) >= 0).map((p) => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const allWrites = (w, bid, s) => w.log.reduce((a, r) => a.concat(writesOf(r, bid, s)), []);
const rowsQ319 = (w) => w.log.map((r) => { const m = /\| endless best writes that failed, waiting for a later run \/ waiting writes that landed or were found on the board \/ dropped, board no longer written \(Q319\) \| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? m.slice(1).map(Number) : null; });
const sumQ319 = (w) => rowsQ319(w).reduce((a, r) => r ? [a[0] + r[0], a[1] + r[1], a[2] + r[2]] : a, [0, 0, 0]);
const FAIL = (st, kept) => [st, !!kept];   // one write's outcome
const inj = (bid, s, outs) => ({ post: { [bid]: { [s]: outs } } });
const merge = (...xs) => { const o = { post: {} }; for (const x of xs) for (const b of Object.keys(x.post || {})) o.post[b] = Object.assign(o.post[b] || {}, x.post[b]); return o; };
const P5 = v.packEndlessScore(5, 700), P3 = v.packEndlessScore(3, 350), P7 = v.packEndlessScore(7, 900), P2 = v.packEndlessScore(2, 150), P6 = v.packEndlessScore(6, 800);
const DEEP = [400, 300], SHALLOW = [200, 150], DEEPER = [500, 400], LOW = [100, 50], RES = [450, 350];
const C5 = v.packClassicScore(5, 4800), C3 = v.packClassicScore(3, 2400), CDEEP = [2600, 2200], CSHALLOW = [1300, 1100];
// the standard course: a deep run whose settle runs `injDeep`, two quiet runs (`injQuiet` on the first), then a shallower run
function course(w, flags, injDeep, injQuiet, o) {
  o = o || {};
  const cls = flags & SEG_CLASSIC;
  run(w, flags, 5, cls ? CDEEP : DEEP, injDeep, { season: o.season, env: o.env });
  quiet(w, 1, injQuiet || null, o.env); quiet(w, 1, null, o.env);
  run(w, flags, 3, cls ? CSHALLOW : SHALLOW, null, { season: o.season, env: o.env });
  return w;
}

// mutants: validate.js with one part of the fix put back
const BEFORE = {
  // the code before: a failed write waits for nothing
  noQueue: ['    RUN.ebQueued = (RUN.ebQueued | 0) + 1;\n    if (was && (was.v | 0) >= (w.s | 0)) {', '    return;\n    if (was && (was.v | 0) >= (w.s | 0)) {'],
  // the settle's rows are not overlaid: the waiting write is neither laid nor written with this run
  noLay: ['        ebLay(k, d, sid, row);\n', '        void row;\n'],
  // laid without the max: the waiting value stands over a higher row and is written over it
  noMax: ['    if (row != null && (row | 0) >= (was.v | 0)) {\n      RUN.ebDone = (RUN.ebDone | 0) + 1;', '    if (false) {\n      RUN.ebDone = (RUN.ebDone | 0) + 1;'],
  // the quiet exits do not retry
  noQuietRetry: ['await ebRetry(); await lpRetry();', 'await lpRetry();'],
  // a seedcap correction of the waiting run goes on as before
  noCancel: ['          if (dC && ebCancel(dC, sidC, packedC)) {', '          if (false) {'],
  // the team is not kept with the waiting write
  noTeam: ["    if (Array.isArray(w.team) && w.team.length) nw.tm = w.team.map((s) => pid(String(s)));\n", ''],
};
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    const n = src.split(from).length - 1;
    if (n < 1 || (n > 1 && k !== 'noQuietRetry')) { bad(tag + ' mutant ' + k + ': anchor found ' + n + ' times'); return null; }
    src = src.split(from).join(to);
  }
  const script = path.join(__dirname, '..', '.mutant-endless-best-owed-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// ---- [1] units ----
{
  const now = 9e12, D7 = 7 * 86400000;
  const s = { a: { ew: { endless_board: { v: 50001, ts: 700, t: now - D7 - 1, n: 3 }, endless_comp_duo: { v: 30000, ts: 350, t: now - 5, n: 1 } } },
    b: { ew: { endless_board: { v: 'x', t: now } } }, c: { ew: [1, 2] }, d: { ew: { endless_board: { v: 9, t: now - 1000, n: 1 } }, rc: [[2, 0, 32, 0, now - 1000]] } };
  const r = v.prunePendingWrites(s, now);
  eq('[1] prunePendingWrites: an endless best write waiting past 7 days dropped, a malformed one (no score) too, a recent one kept, a non-map ew removed; counted with the failed writes',
    [r.writes, s], [2, { a: { ew: { endless_comp_duo: { v: 30000, ts: 350, t: now - 5, n: 1 } } }, d: { ew: { endless_board: { v: 9, t: now - 1000, n: 1 } }, rc: [[2, 0, 32, 0, now - 1000]] } }]);
}

// ---- [2] the failures: the honest player ends with what the same runs without the failure give him ----
const refCas = course(world(), 0), refComp = course(world(), SEG_COMP), refCls = course(world(), SEG_CLASSIC);
T('[2] (the references: A and B end at depth 5 on the casual / competitive duo boards, 50000-class on the classic duo board)',
  [refCas, refComp, refCls].every(fine) && row(refCas, EN, A) === P5 && row(refComp, COMP2, A) === P5 && row(refCls, CLS2, A) === C5 && row(refCas, EN, B) === P5,
  JSON.stringify([row(refCas, EN, A), row(refComp, COMP2, A), row(refCls, CLS2, A)]));
for (const [tag, flags, bid, ov, out, ref, want] of [
  ['casual duo (endless_board), 500', 0, EN, OV_CAS, FAIL(500), refCas, P5],
  ['competitive duo (endless_comp_duo), 503', SEG_COMP, COMP2, OV_COMP, FAIL(503), refComp, P5],
  ['classic duo (endless_classic_duo), thrown', SEG_CLASSIC, CLS2, OV_CLS, FAIL('throw'), refCls, C5],
]) {
  const w = world();
  run(w, flags, 5, flags & SEG_CLASSIC ? CDEEP : DEEP, inj(bid, A, [out]));
  const p1 = ewOf(w, A, BEST[bid]), mid = row(w, bid, A), stateText = JSON.stringify(w.state || {});
  quiet(w, 1); quiet(w, 1); run(w, flags, 3, flags & SEG_CLASSIC ? CSHALLOW : SHALLOW);
  const cls = !!(flags & SEG_CLASSIC);
  eq('[2] ' + tag + ' fails: the match processed, the best waits (ew, try 1, the team as pids), the next run writes it; A as without the failure (row, details, composite)',
    [fine(w), mid, p1 && p1.v, p1 && p1.ts, p1 && p1.n, p1 && Array.isArray(p1.tm) && p1.tm.join(','), p1 && (p1.bd != null), row(w, bid, A), hexOf(w, bid, A) === hexOf(ref, bid, A), row(w, ov, A) === row(ref, ov, A) && row(w, ov, A) != null, !ewOf(w, A, BEST[bid])],
    [true, null, want, cls ? 4800 : 700, 1, [v.pid(A), v.pid(B)].join(','), !cls, want, true, true, true]);
  T('[2] ' + tag + ': no SteamID in the state files', stateText.indexOf(A) < 0 && stateText.indexOf(B) < 0);
  T('[2] ' + tag + ': logged -- the failed write waits, then lands', /endless best write of [0-9a-f]{8} on [a-z_0-9]+ failed -- [0-9]+ waits for the next run \(try 1, Q319\)/.test(outOf(w)) && /endless best write of [0-9a-f]{8} on [a-z_0-9]+ that failed before \(1 tries\) landed: [0-9]+ \(Q319\)/.test(outOf(w)), outOf(w).slice(-900));
  eq('[2] ' + tag + ': B (his write landed) as without the failure', row(w, bid, B), row(ref, bid, B));
}
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); quiet(w, 2); run(w, 0, 3, SHALLOW);
  eq('[2] summary rows across the runs (queued / landed or found / dropped)', sumQ319(w), [1, 1, 0]);
}
{   // season 1 (S1 = 2026-12-01), the cup open: a competitive duo run writes the lifetime, season and this week's boards; all three fail
  const env = { SEASON_NOW: S1_NOW };
  const ref = world({ env }); course(ref, SEG_COMP, null, null, { season: 1, env });
  const w = world({ env });
  course(w, SEG_COMP, merge(inj(COMP2, A, [FAIL(500)]), inj(COMP2_S1, A, [FAIL(502)]), inj(COMP2_W, A, [FAIL('throw')])), null, { season: 1, env });
  const p = w.log[1] && w.log[1].state.PENDING_WRITES_FILE && w.log[1].state.PENDING_WRITES_FILE[v.pid(A)];
  eq('[2] season 1 + cup week: the lifetime, season and weekly writes fail -- three waits, written the next run; A as without the failure on all three',
    [fine(w), p && Object.keys(p.ew || {}).sort(), [COMP2, COMP2_S1, COMP2_W].map((b) => row(w, b, A)), [COMP2, COMP2_S1, COMP2_W].map((b) => row(ref, b, A)), [COMP2, COMP2_S1, COMP2_W].every((b) => hexOf(w, b, A) === hexOf(ref, b, A)), pend(w, A).ew || null],
    [true, [BEST[COMP2], BEST[COMP2_S1], BEST[COMP2_W]].sort(), [P5, P5, P5], [P5, P5, P5], true, null]);
  T('[2] season 1 + cup week: the board list covers every board the job writes a best to (no self-check warning)', !/missing from the Q319 board list/.test(outOf(w)), outOf(w).slice(-600));
  const wc = world({ env }); run(wc, 0, 5, DEEP, inj(EN_S1, A, [FAIL(500)]), { env }); quiet(wc, 1, null, env);
  eq('[2] season 1: the casual season twin fails, written the next run', [fine(wc), row(wc, EN_S1, A), row(wc, EN, A)], [true, P5, P5]);
}

// ---- [3] the run right after the failure ----
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); const k3 = run(w, 0, 3, SHALLOW);
  eq('[3] the next run (the shallower run\'s sighting) writes the waiting best; the shallower run is not written over it', [fine(w), allWrites(w, EN, A), row(w, EN, A), !ewOf(w, A, BEST[EN])], [true, [P5, P5], P5, true]);
  T('[3] logged: laid over the row read, written with the run', /endless best write of [0-9a-f]{8} on endless_board waits since an earlier run \(1 tries\): 50001 over the row \(none\), written with this run \(Q319\)/.test(outOf(w)), outOf(w).slice(-600));
  void k3;
}
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)]));
  const t1 = ewOf(w, A, BEST[EN]).t;
  run(w, 0, 3, SHALLOW, null, { injSight: inj(EN, A, [FAIL(503)]) });
  const after2 = w.log[2].state.PENDING_WRITES_FILE[v.pid(A)].ew.endless_board;
  eq('[3] the retry fails again: try 2, the first failure kept (aged by the step), the shallower run not written; then it lands',
    [fine(w), after2.n, after2.v, after2.t, allWrites(w, EN, A), row(w, EN, A)], [true, 2, P5, t1 - 5 * MIN, [P5, P5, P5], P5]);
}
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); run(w, 0, 7, DEEPER, null, { injSight: inj(EN, A, [FAIL(500)]) });
  const ref = world(); run(ref, 0, 5, DEEP); run(ref, 0, 7, DEEPER);
  eq('[3] a deeper run while it waits supersedes it: the deeper one written, the wait over; as without the failure',
    [fine(w), row(w, EN, A), row(ref, EN, A), hexOf(w, EN, A) === hexOf(ref, EN, A), pend(w, A).ew || null], [true, P7, P7, true, null]);
}
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); run(w, 0, 7, DEEPER, inj(EN, A, [FAIL(500)]), { injSight: inj(EN, A, [FAIL(500)]) });
  const p = ewOf(w, A, BEST[EN]);
  quiet(w, 1);
  eq('[3] the deeper run\'s write fails too: the deeper one waits (try 3, team score of that run), written the next run',
    [fine(w), p && p.v, p && p.ts, p && p.n, row(w, EN, A), pend(w, A).ew || null], [true, P7, 900, 3, P7, null]);
}

// ---- [4] never twice, never lower ----
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500, true)]));
  const p = ewOf(w, A, BEST[EN]);
  quiet(w, 2); run(w, 0, 3, SHALLOW);
  eq('[4] Steam kept the write that answered 500: it waits, the next run finds it on the board and does not write it again', [fine(w), p && p.v, allWrites(w, EN, A), row(w, EN, A), pend(w, A).ew || null], [true, P5, [P5], P5, null]);
  T('[4] logged: found on the board', /endless best write of [0-9a-f]{8} on endless_board found on the board: row 50001 \(Q319\)/.test(outOf(w)), outOf(w).slice(-600));
}
{
  const now = Date.now();
  const files = { PENDING_WRITES_FILE: { [v.pid(A)]: { ew: { endless_board: { v: P5, ts: 700, bd: 0, tm: [v.pid(A), v.pid(B)], t: now, n: 2 } } } } };
  const mk = (script) => { const w = world({ script, files, rows: { [EN]: { [A]: { score: P7, hex: '' } } } }); run(w, 0, 3, SHALLOW); return w; };
  const w = mk(null);
  eq('[4] a waiting value under his row (an older job ran meanwhile and wrote a deeper run): the row stays, the wait ends', [fine(w), row(w, EN, A), allWrites(w, EN, A), pend(w, A).ew || null], [true, P7, [], null]);
  withMutant(['noMax'], '[4]', (m) => eq('[4] mutant (laid without the max): the waiting 5 written over his depth-7 row', row(mk(m), EN, A), P5));
}

// ---- [5] the chain rule reads the waiting depth ----
{
  // the deep run's writes (both seats) and their retries keep failing; a resume of the pair from depth 5 to 6 settles one level of time
  //   (37.5 s) after its sighting -- the chain vouches for depth 5 from the waiting writes -- instead of waiting the whole span from 0
  const both = () => merge(inj(EN, A, [FAIL(500)]), inj(EN, B, [FAIL(500)]));
  const mk = (script) => {
    const w = world({ script });
    run(w, 0, 5, DEEP, both());
    run(w, 0, 6, RES, null, { sd: 5, gap: MIN, injSight: both() });
    return w;
  };
  const w = mk(null);
  eq('[5] a resume from the waiting depth settles after one level of time (chain 5, no row of depth 5 on the board): A and B at depth 6', [fine(w), row(w, EN, A), row(w, EN, B)], [true, P6, P6]);
  withMutant(['noLay'], '[5]', (m) => { const x = mk(m); eq('[5] mutant (not laid): the chain does not see depth 5, the resume is not settled at that run', [fine(x), row(x, EN, A) === P6, row(x, EN, B) === P6], [true, false, false]); });
}

// ---- [6] a seedcap correction of the run that waits ----
{
  const LOW1 = [60, 40], P1 = v.packEndlessScore(1, 100), SC = { SEEDCAP_ENFORCE: '1' };
  // the correction is applied in a run that processes a match (here a later depth-1 run of the two); `quietFirst` = a quiet run retries
  //   the waiting write before that
  const mk = (script, quietFirst, injDeep) => {
    const w = world({ script });
    run(w, 0, 2, LOW);   // his older row: depth 2
    const key = run(w, 0, 5, DEEP, injDeep === undefined ? inj(EN, A, [FAIL(500)]) : injDeep);
    w.state.SC_STATE_FILE = { corrections: [{ id: 'cq319', m: key, seats: [0, 1] }] };
    if (quietFirst) quiet(w, 1, null, SC);
    run(w, 0, 1, LOW1, null, { env: SC });
    quiet(w, 1, null, SC);
    return w;
  };
  const w = mk(null, false);
  const dels = (x, s) => x.log.reduce((a, r) => a + r.posts.filter((p) => /DeleteLeaderboardScore/.test(p.url) && p.body.indexOf('leaderboardid=' + EN + '&') >= 0 && p.body.indexOf('steamid=' + s) >= 0).length, 0);
  eq('[6] the waiting run convicted while it waits: the wait ends, A keeps his depth-2 row (never deleted, the convicted run never written), B\'s convicted row deleted as before',
    [fine(w), row(w, EN, A), dels(w, A), pend(w, A).ew || null, allWrites(w, EN, A), dels(w, B), row(w, EN, B)], [true, P2, 0, null, [P2, P5], 1, P1]);
  T('[6] logged: the run never reached the board, his row stays', /seedcap correction cq319: [a-z-]+ [0-9a-f]{8}[^\n]* -- the run never reached the board, his row there stays/.test(outOf(w)) && /endless best write of [0-9a-f]{8}[^\n]*\(50001\) dropped: a seedcap correction of that run \(Q319\)/.test(outOf(w)));
  withMutant(['noCancel'], '[6]', (m) => eq('[6] mutant (no seedcap cancel): A\'s depth-2 row deleted (the laid run looked like his row)', [row(mk(m, false), EN, A) !== P2], [true]));
  // a quiet run retries first: the run lands, the correction deletes it -- as without the failure (the write landed, the correction deleted it)
  const q = mk(null, true), ref = mk(null, true, null);
  eq('[6] a quiet run wrote the waiting run first: the correction deletes it, A as without the failure (no row on the casual duo board)', [fine(q), fine(ref), row(q, EN, A), row(ref, EN, A), pend(q, A).ew || null], [true, true, P1, P1, null]);
}

// ---- [7] fuse, boards no longer written, unnamed, dry run, quiet retry ----
{
  const now = Date.now(), U = SID(99);
  const files = { PENDING_WRITES_FILE: {
    [v.pid(U)]: { ew: { endless_board: { v: 40001, ts: 1, t: now - 7 * 86400000 - MIN, n: 4 }, endless_board_trio: { v: 30001, ts: 1, t: now, n: 1 } } },
    [v.pid(B)]: { ew: { endless_board_s3: { v: 20001, ts: 1, t: now, n: 1 }, endless_comp_duo_w202601: { v: 20001, ts: 1, t: now, n: 1 } } } } };
  const w = world({ files }); run(w, 0, 5, DEEP);
  const out = outOf(w);
  T('[7] past 7 days, no run names him: dropped at the save, warned', /::warning::endless best write of [0-9a-f]{8} on endless_board dropped after 4 failed tries over 7 days \(value 40001, Q319\)/.test(out) && !ewOf(w, U, 'endless_board'), out.slice(-900));
  eq('[7] a player no run can name (no record, no row): waits', [fine(w), (ewOf(w, U, 'endless_board_trio') || {}).v], [true, 30001]);
  T('[7] a season board no longer written (season 3 in season 0) and a closed week: dropped, warned, nothing written',
    /endless best write of [0-9a-f]{8} on endless_board_s3 dropped: no longer a board this job writes \(value 20001, 1 tries, Q319\)/.test(out)
    && /endless best write of [0-9a-f]{8} on endless_comp_duo_w202601 dropped: no longer a board this job writes/.test(out) && !pend(w, B).ew, out.slice(-900));
  eq('[7] summary: 2 dropped, board no longer written', sumQ319(w)[2], 2);
}
{
  const w = world(); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)]));
  const dry = step(w, 5 * MIN, null, { APPLY_MMR: '0' });
  eq('[7] a dry run: writes nothing, keeps it waiting', [dry.code, writesOf(dry, EN, A).length, (ewOf(w, A, 'endless_board') || {}).v], [0, 0, P5]);
  quiet(w, 1);
  eq('[7] ... and the next live run (a quiet one) writes it', [fine(w), row(w, EN, A), pend(w, A).ew || null], [true, P5, null]);
}
{
  const ref = world(); run(ref, 0, 5, DEEP); quiet(ref, 1);
  const mk = (script) => { const w = world({ script }); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); quiet(w, 1); return w; };
  const w = mk(null);
  eq('[7] a quiet run writes the waiting best alone (read his row, then write), details as without the failure (the team block rebuilt)', [fine(w), row(w, EN, A), hexOf(w, EN, A) === hexOf(ref, EN, A), pend(w, A).ew || null], [true, P5, true, null]);
  T('[7] the rebuilt details carry the team block (TEAM_MAGIC, 2 seats)', (() => { const d = v.decodeDetails(hexOf(w, EN, A)); return d.length >= 7 && ((d[2] & 0xff) === 0xD4) && (((d[2] >>> 16) & 0xff) === 2); })(), hexOf(w, EN, A));
  withMutant(['noQuietRetry'], '[7]', (m) => { const x = mk(m); eq('[7] mutant (no quiet retry): only a quiet run follows, his best still waits off the board', [fine(x), row(x, EN, A), (ewOf(x, A, 'endless_board') || {}).v], [true, null, P5]); });
  withMutant(['noTeam'], '[7]', (m) => { const x = mk(m); eq('[7] mutant (no team kept): the retry\'s row has no team block', [fine(x), row(x, EN, A), hexOf(x, EN, A) === hexOf(ref, EN, A)], [true, P5, false]); });
}

// ---- [8] mutants: the code before / not laid ----
withMutant(['noQueue'], '[8]', (m) => {
  const w = course(world({ script: m }), 0, inj(EN, A, [FAIL(500)]));
  eq('[8] mutant (nothing waits, the code before): A ends at depth 3 instead of 5', [fine(w), row(w, EN, A)], [true, P3]);
});
withMutant(['noLay'], '[8]', (m) => {
  const w = world({ script: m }); run(w, 0, 5, DEEP, inj(EN, A, [FAIL(500)])); run(w, 0, 3, SHALLOW, null, { injSight: inj(EN, A, [FAIL(500)]) });
  eq('[8] mutant (not laid over the rows): the shallower run is written as A\'s new best', [fine(w), row(w, EN, A)], [true, P3]);
});

// ---- [9] wiring pins ----
{
  const iDemand = SRC.indexOf("    console.log('on-demand base reads: ' + need.size + ' players (bulk window incomplete)');"), iWeek = SRC.indexOf('  const cupWeekPut = (f, sid, packed, w) => {'),
    iLay = SRC.indexOf('        ebLay(k, d, sid, row);'), iLoop = SRC.indexOf('  for (const c of fresh) {', iLay);
  T('[9] the waiting writes are laid after every best board is read (on-demand reads, this week\'s boards) and before anything settles', iDemand > 0 && iWeek > iDemand && iLay > iWeek && iLoop > iLay);
  // every best pool the write phase sends has its outcome accounted
  const pools = ['changedEndless', 'changedEndlessSeason', 'changedEndlessTrio', 'changedEndlessTrioSeason', 'changedEndlessQuad', 'changedEndlessQuadSeason', 'changedEndlessSolo', 'changedEndlessSoloSeason', 'changedEndlessClassicSolo', 'changedComp', 'changedCompSeason'];
  const missing = pools.filter((p) => !new RegExp('ebAfterPool\\((?:seasonBoardName\\([^)]*\\)|[^,()]+), ' + p + ', w[A-Za-z]+\\)').test(SRC));
  T('[9] every single-board best pool goes through ebAfterPool after its write', missing.length === 0, missing.join(', '));
  T('[9] the family loops (classic, competitive lifetime + season, weekly) account every write, an unresolved board waits', /ebAfterPool\(F\.name, F\.changed, wF\);/.test(SRC) && /ebAfterPool\(lbName, pool, wr\);/.test(SRC) && /ebAfterPool\(lbName, pool, null\); continue; \}/.test(SRC)
    && /ebAfterPool\(name, pool, wr\);/.test(SRC) && /ebAfterPool\(name, pool, null\); continue; \}/.test(SRC));
  const iLastPool = SRC.indexOf('    ebAfterPool(name, pool, wr);   // Q319'), iSave = SRC.indexOf('  if (backlogDirty) savePendingWrites(lpBacklog, nowMs, true);   // Q319', iLastPool), iProc = SRC.indexOf('  saveProcessed(processed);\n  saveSkill(skill);');
  T('[9] the backlog is saved after the last best pool, before the processed keys', iLastPool > 0 && iSave > iLastPool && iProc > iSave);
  T('[9] the quiet exits retry the waiting bests ahead of the points / XP / CP retries', (SRC.match(/await ebRetry\(\); await lpRetry\(\); await rowRetry\(\); persistStartsSide\(\);/g) || []).length === 2);
  T('[9] the seedcap correction asks before it deletes', /if \(dC && ebCancel\(dC, sidC, packedC\)\) \{[^\n]*continue; \}\n          if \(!bidC \|\| !bestMapC/.test(SRC));
  T('[9] the summary row and the RUN counters', /endless best writes that failed, waiting for a later run \/ waiting writes that landed or were found on the board \/ dropped, board no longer written \(Q319\) \| ' \+ s\('ebQueued', 0\)/.test(SRC)
    && /RUN\.ebQueued = \(RUN\.ebQueued \| 0\) \+ 1;/.test(SRC) && /RUN\.ebDone = \(RUN\.ebDone \| 0\) \+ 1;/.test(SRC) && /RUN\.ebDropped = \(RUN\.ebDropped \| 0\) \+ 1;/.test(SRC));
  T('[9] the backlog header documents ew', /\/\/   ew: \{ \[board\]: \{ v, ts, bd\?, tm\?, t, n \} \} -- an endless BEST write that failed \(cloud audit Q319;/.test(SRC));
  T('[9] the team is kept as pids, never SteamIDs', /nw\.tm = w\.team\.map\(\(s\) => pid\(String\(s\)\)\);/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (endless-best-owed) ===');
process.exit(failN === 0 ? 0 : 1);
