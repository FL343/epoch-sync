'use strict';
// cloud audit Q318: the settle's own XP / CP write that failed (Steam down, a 5xx, a network error) was logged and forfeited --
//   the match processed all the same, so no later run paid it: an honest player lost his XP of the match (its daily first win
//   with it: the day is spent in the XP state) or his CP for good (a quick 1V1 win: 450 XP and 20 CP). Now such a write waits in
//   the O480 backlog (PENDING_WRITES_FILE, xw / cw = { b, v, t, n }: the board, the absolute score, the first failure, the tries)
//   like a points write: every reader of that board in the job takes v as his row (the consolation's base, the settle's, the
//   wallet a redeem debits), the next run writes it again (absolute: right whether or not Steam kept the failed one), a write of
//   his that lands supersedes it, and a write this job makes on that board before the retry (a consolation, a redeem debit)
//   moves v to the row it is about to leave, on disk ahead of it.
// Over the REAL validate.js main() against an offline board stub whose XP (progress, 5), CP (cp_bank, 8) and grant (grant_box)
//   boards carry over from run to run (each landed ForceUpdate applied, details included), and which can fail a player's n-th
//   write to a board in a run (answered with a status or thrown, Steam keeping it or not), serve a stale row, or kill the run
//   right after a write (the state on disk as the run left it):
//   [1] units: prunePendingWrites (xw / cw past the fuse, malformed, kept)
//   [2] the failures, each against the same runs with nothing failing: the XP write fails / the CP write fails / both throw /
//       the retry fails too (tries counted, the first failure kept) / a second 1V1 settles on top (one write per board, the
//       career block of both games) -- the honest winner ends with exactly what the runs without a failure give him
//   [3] never twice: Steam took both writes but answered 500 (and the next read is stale); a Q315 consolation of the account
//       builds on the waiting value; a consolation that landed is what the same run's settle builds on, the read behind it; a
//       consolation that Steam kept although it answered 500, then the same run's settle write fails (the owed write found
//       landed, not paid again)
//   [4] the wallet: a quiet run's redeem debits the waiting balance; a run killed right after the debit leaves the next run the
//       debited balance (charged once)
//   [5] the fuse past 7 days (dropped at the save, warned; a run that names him before it still writes it once, like O480's w), a
//       waiting write meant for another board (warned), a player no run can name (waits), a dry run (writes nothing, keeps it)
//   [6] mutants: no backlog (the code before) / the settle reads the board / the consolation reads the board / no run-local
//       row / no re-tag on a failed settle write / the redeem reads the board / no move ahead of the debit / no quiet retry
//   [7] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/consolation-owed.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'DISPUTE_FLOOR_DAY_CAP', 'CONSOLATION_XP',
  'CONSOLE_OWED_MAX_MS', 'REDEEM_LB', 'GRANT_LB', 'LP_LAST_HOLD_MS'];
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
const XP = 5, CP = 8, RD = 10, GT = 11;
// STUB_INJECT, this run only: { post: { <board id>: { <sid>: [o1, o2, ...] } } -- his n-th write to that board this run answers
//   o_n = [status | 'throw', applied] (null or absent: normally), Steam keeping it when `applied`; stale: { <board id>: { <sid>:
//   score } } -- every read of that board shows him at that score; die: [board id, sid, n] -- the run is killed right after his
//   n-th write to that board (Steam kept it) }
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const INJ = JSON.parse(process.env.STUB_INJECT || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'const seen = {};',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  "const hexOf = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };",
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1], bid = (/leaderboardid=([0-9]+)/.exec(body) || [])[1];",
  '    const set = /SetLeaderboardScore/.test(u);',
  "    const k = bid + ':' + sid; if (set) seen[k] = (seen[k] || 0) + 1;",
  '    const list = set && INJ.post && INJ.post[bid] && INJ.post[bid][sid];',
  '    const f = (list && list[seen[k] - 1]) || null;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: f ? !!f[1] : true, failed: f ? f[0] : 0 }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      const id = had ? had.id : nextId++;',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } });',
  '    }',
  "    const keep = () => { const sc = (/score=(-?[0-9]+)/.exec(body) || [])[1], bd = byId[bid]; if (!bd || sid == null || sc == null) return;",
  "      const e = bd.entries.find((x) => String(x.steamID) === sid); if (e) { e.score = Number(sc); e.detailData = hexOf(body); } else bd.entries.push({ steamID: sid, score: Number(sc), detailData: hexOf(body) }); };",
  '    if (set && (!f || f[1])) keep();',
  '    if (set && INJ.die && String(INJ.die[0]) === bid && INJ.die[1] === sid && INJ.die[2] === seen[k]) process.exit(7);',
  "    if (f) { if (f[0] === 'throw') throw new Error('injected network error'); return resp({ error: 'injected' }, f[0]); }",
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const bid = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[bid];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const st = INJ.stale && INJ.stale[bid];',
  '    if (st) ents = ents.map((e) => st[String(e.steamID)] != null ? { steamID: e.steamID, score: st[String(e.steamID)], detailData: e.detailData } : e);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
const intsOfHex = (hex) => { const out = []; for (let i = 0; i + 8 <= String(hex || '').length; i += 8) out.push(Buffer.from(hex.slice(i, i + 8), 'hex').readInt32LE(0)); return out; };
function runCron(boards, files, env, inject, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-write-owed-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_INJECT: JSON.stringify(inject || {}),
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const p = sg.players[k];
    if (p.bz) p.bz -= ms;
    if (p.pdk) for (const m of Object.keys(p.pdk)) p.pdk[m] -= ms;
    if (p.cq && p.cq.t) p.cq.t -= ms;
  }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) for (const f of ['w', 'l', 'xw', 'cw']) if (pw[k] && pw[k][f] && pw[k][f].t) pw[k][f].t -= ms;
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const H = SID(3180), J = SID(3181), K = SID(3182), U = SID(3189), U2 = SID(3188);
const MIN = 60000, HOUR = 3600000;
const HON = [7000, 4000];   // seat 0 won 7000 to 4000, both write it
// the world: the shard records written so far (they stay up) and the trusted boards as Steam keeps them (score + details),
//   carried from run to run; redeem wants (client-written) as seeded
function world(script, seed) {
  const w = { recs: [], b: { [XP]: {}, [CP]: {}, [GT]: {} }, want: {}, state: null, log: [], script: script || null };
  for (const bid of Object.keys((seed && seed.b) || {})) Object.assign(w.b[bid], seed.b[bid]);
  if (seed && seed.files) w.state = JSON.parse(JSON.stringify(seed.files));
  return w;
}
const xpOf = (w, s) => ((w.b[XP][s] || {}).score) | 0, cpOf = (w, s) => ((w.b[CP][s] || {}).score) | 0;
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, detailData: hexLE(r.d) }); }
  const rows = (bid) => Object.keys(w.b[bid]).map((s) => ({ steamID: s, score: w.b[bid][s].score | 0, detailData: w.b[bid][s].hex || '' }));
  boards.push({ id: XP, name: 'progress', entries: rows(XP) }, { id: CP, name: 'cp_bank', entries: rows(CP) }, { id: 9, name: 'trust_tier', entries: [] },
    { id: RD, name: 'redeem_box', entries: Object.keys(w.want).map((s) => ({ steamID: s, score: 1, detailData: hexLE([v.REDEEM_MAGIC, 0, w.want[s], 0]) })) },
    { id: GT, name: 'grant_box', entries: rows(GT) });
  boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [H, J, K].map(s => ({ steamID: s, score: 2500 })) });
  return boards;
}
const bodyHex = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };
function step(w, ms, inject, env) {
  if (w.state && w.state.__failed) return;
  const r = runCron(boardsOf(w), w.state ? advance(w.state, ms) : null, env || null, inject, w.script);
  w.log.push(r);
  const killed = r.code === 7 && inject && inject.die;
  if (r.code !== 0 && !killed) { w.state = { __failed: true }; return; }
  if (!(env && env.APPLY_MMR === '0')) w.state = r.state;
  for (const p of r.posts) {   // the boards as Steam keeps them: every write that landed (ForceUpdate, absolute; details replaced)
    if (!/SetLeaderboardScore/.test(p.url) || !p.applied) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1];
    if (!w.b[bid]) continue;
    w.b[bid][/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
  }
}
let hn = 0;
const newHash = () => 0x3180 + (++hn);
// an honest quick 1V1 (mt 1) of a (seat 0, the winner) and b: the starts, ten minutes on both results -- it settles on that run
//   (rs: the injection of each of the two runs)
function honest(w, a, b, rs, gap) {
  const hsh = newHash(), two = [a, b];
  w.recs.push({ sid: a, d: rec(0xB2, 1, hsh, 0, 0, false, two, null) }, { sid: b, d: rec(0xB2, 1, hsh, 1, 0, false, two, null) });
  step(w, gap == null ? 5 * MIN : gap, (rs || [])[0] || null);
  w.recs.push({ sid: a, d: rec(0xB1, 1, hsh, 0, 1, true, two, HON) }, { sid: b, d: rec(0xB1, 1, hsh, 1, 2, false, two, HON) });
  step(w, 10 * MIN, (rs || [])[1] || null);
}
// the records of an honest 1V1 of a and b put up at once (they settle on the run after the one that first reads them)
function honestUp(w, a, b) {
  const hsh = newHash(), two = [a, b];
  w.recs.push({ sid: a, d: rec(0xB2, 1, hsh, 0, 0, false, two, null) }, { sid: b, d: rec(0xB2, 1, hsh, 1, 0, false, two, null) },
    { sid: a, d: rec(0xB1, 1, hsh, 0, 1, true, two, HON) }, { sid: b, d: rec(0xB1, 1, hsh, 1, 2, false, two, HON) });
}
// a 1V1 of a and b where b writes no result (a is the lone writer): the starts, ten minutes on a's result, ten more, two hours
//   on -- the start verdict voids it and consoles a with the flat 50 (Q315's loop). rs: the injection of each of the four
//   runs; up: put more records up ahead of the void run
function lone(w, a, b, rs, up) {
  const hsh = newHash(), two = [a, b];
  w.recs.push({ sid: a, d: rec(0xB2, 1, hsh, 0, 0, false, two, null) }, { sid: b, d: rec(0xB2, 1, hsh, 1, 0, false, two, null) });
  step(w, 5 * MIN, (rs || [])[0] || null);
  w.recs.push({ sid: a, d: rec(0xB1, 1, hsh, 0, 1, true, two, HON) });
  step(w, 10 * MIN, (rs || [])[1] || null);
  if (up) up();
  step(w, 10 * MIN, (rs || [])[2] || null);
  step(w, 2 * HOUR, (rs || [])[3] || null);
}
const after = (w, n, inject) => { for (let i = 0; i < n; i++) step(w, 5 * MIN, inject || null); };
const fine = (w) => w.log.length > 0 && w.log.every((r) => r.code === 0);
const outOf = (w) => w.log.map((r) => r.out).join('');
const writesOf = (w, bid, s) => [].concat(...w.log.map((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + bid + '(&|$)').test(p.body) && new RegExp('steamid=' + s + '(&|$)').test(p.body)).map((p) => Number(/score=(-?[0-9]+)/.exec(p.body)[1]))));
const pend = (w, s) => ((((w.state || {}).PENDING_WRITES_FILE) || {})[v.pid(s)]) || {};
const careerOf = (w, s) => { const d = intsOfHex((w.b[XP][s] || {}).hex); return d[0] === v.CAREER_MAGIC ? [d[2], d[3], d[4]] : null; };
const rowsQ318 = (w) => w.log.map((r) => { const m = /\| settle XP \/ CP writes that failed, waiting for a later run \/ waiting writes that landed \(Q318\) \| ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? m.slice(1).map(Number) : null; });
const sumQ318 = (w) => rowsQ318(w).reduce((a, r) => r ? [a[0] + r[0], a[1] + r[1]] : a, [0, 0]);
const FAIL = (st, kept) => [st, !!kept];   // one write's outcome
const inj = (bid, s, outs) => ({ post: { [bid]: { [s]: outs } } });
const merge = (...xs) => { const o = { post: {} }; for (const x of xs) { for (const b of Object.keys(x.post || {})) o.post[b] = Object.assign(o.post[b] || {}, x.post[b]); for (const k of Object.keys(x)) if (k !== 'post') o[k] = x[k]; } return o; };

// mutants: validate.js with one part of the fix put back
const BEFORE = {
  // the code before: a failed write waits for nothing
  noQueue: ['    if (!ROW_LB[f]) return false;\n    const b = lpBacklog[k] = lpBacklog[k] || {}, was = b[f];', '    return false;\n    const b = lpBacklog[k] = lpBacklog[k] || {}, was = b[f];'],
  // the settle's read takes the board, not the waiting value
  noSettleBase: ["    for (const sid of rowPendingSids('xw', Object.keys(xp))) { const w = rowWaiting('xw', sid); if (w) { xp[sid] = w.v | 0; xpRetrySids.push(sid); } }", "    for (const sid of rowPendingSids('xw', Object.keys(xp))) { const w = rowWaiting('xw', sid); if (w) { xpRetrySids.push(sid); } }"],
  // the consolation reads the board, not the waiting value
  noConsoleBase: ["      const xwP = rowWaiting('xw', sid);", '      const xwP = null;'],
  // no run-local row: the settle takes its read even when this run's consolation wrote the row seconds before
  noWrote: ['    for (const sid of Object.keys(rowWrote.xw)) xp[sid] = rowWrote.xw[sid];\n', ''],
  // no re-tag of a failed consolation on a settle XP write that failed
  noRebaseFail: ["    if (landed || !owedSent.has(sid) || !rowWaiting('xw', sid)) return;", '    return;'],
  // the redeem reads the board, not the waiting balance
  noRedeemWaiting: ['        else if (cwP) bal = cwP.v | 0;\n', ''],
  // no move of the waiting value ahead of a write of this job on that board
  noAhead: ['    if (!w || !APPLY_MMR) return;\n    w.v = score | 0; backlogDirty = true;', '    return;\n    w.v = score | 0; backlogDirty = true;'],
  // the quiet exits do not retry
  noQuietRetry: ['await lpRetry(); await rowRetry(); persistStartsSide();', 'await lpRetry(); persistStartsSide();'],
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
  const script = path.join(__dirname, '..', '.mutant-settle-write-owed-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// ---- [1] units ----
{
  const now = 9e12, D7 = 7 * 86400000;
  const s = { a: { xw: { b: 'progress', v: 450, t: now - D7 - 1, n: 3 } }, b: { cw: { b: 'cp_bank', v: 20, t: now - 1000, n: 1 } }, c: { xw: { v: 'x', b: 'progress', t: now } },
    d: { cw: { v: 5, t: now } }, e: { xw: { b: 'progress', v: 9, t: now - 5, n: 1 }, cw: { b: 'cp_bank', v: 2, t: now - D7 - 9, n: 2 }, rc: [[2, 0, 32, 0, now - 1000]] } };
  const r = v.prunePendingWrites(s, now);
  eq('[1] prunePendingWrites: an XP / CP write waiting past 7 days dropped, a malformed one (no score, no board) too, a recent one kept; counted with the failed writes',
    [r.writes, r.receipts, s], [4, 0, { b: { cw: { b: 'cp_bank', v: 20, t: now - 1000, n: 1 } }, e: { xw: { b: 'progress', v: 9, t: now - 5, n: 1 }, rc: [[2, 0, 32, 0, now - 1000]] } }]);
}

// ---- [2] the failures: the honest winner ends with what the same runs without the failure give him ----
const ref1 = (() => { const w = world(); honest(w, H, J); after(w, 3); return w; })();
T('[2] (the reference: a quick 1V1 win pays 450 XP and 20 CP, the loser 135 / 10)', fine(ref1) && xpOf(ref1, H) === 450 && cpOf(ref1, H) === 20 && xpOf(ref1, J) > 0, JSON.stringify(ref1.b[XP]));
{
  const w = world(); honest(w, H, J, [null, inj(XP, H, [FAIL(500)])]);
  const p1 = pend(w, H).xw, x1 = xpOf(w, H);
  after(w, 3);
  eq('[2] the settle\'s XP write fails (500): the match processed, 450 waits (xw, try 1), the next run writes it; H as without the failure',
    [fine(w), x1, p1 && p1.b, p1 && p1.v, p1 && p1.n, xpOf(w, H), xpOf(ref1, H), cpOf(w, H), writesOf(w, XP, H), !!pend(w, H).xw, xpOf(w, J) === xpOf(ref1, J)],
    [true, 0, 'progress', 450, 1, 450, 450, 20, [450, 450], false, true]);
  eq('[2] the retry carries his career block, rebuilt from the XP state (1 game, 1 win)', careerOf(w, H), careerOf(ref1, H));
  T('[2] logged: the failed write waits, then lands', /xp write of [0-9a-f]{8} failed -- 450 waits for the next run \(try 1, Q318\)/.test(outOf(w)) && /xp write of [0-9a-f]{8} that failed before \(1 tries\) landed: 450 \(Q318\)/.test(outOf(w)), outOf(w).slice(-600));
  eq('[2] summary rows across the runs: waiting 1 / landed 1', sumQ318(w), [1, 1]);
}
{
  const w = world(); honest(w, H, J, [null, inj(CP, H, [FAIL(503)])]); const p1 = pend(w, H).cw; after(w, 3);
  eq('[2] the settle\'s CP write fails (503): 20 waits (cw), written again; H as without the failure', [fine(w), p1 && p1.b, p1 && p1.v, cpOf(w, H), cpOf(ref1, H), writesOf(w, CP, H), xpOf(w, H)], [true, 'cp_bank', 20, 20, 20, [20, 20], 450]);
}
{
  const w = world(); honest(w, H, J, [null, merge(inj(XP, H, [FAIL('throw')]), inj(CP, H, [FAIL('throw')]))]); after(w, 3);
  eq('[2] both writes throw (a network error): both written the next run', [fine(w), xpOf(w, H), cpOf(w, H)], [true, 450, 20]);
}
{
  const w = world(); honest(w, H, J, [null, inj(XP, H, [FAIL(500)])]); const t1 = pend(w, H).xw.t;
  after(w, 1, inj(XP, H, [FAIL(502)])); const p2 = pend(w, H).xw || {};
  after(w, 3);
  eq('[2] the retry fails too: still waiting (try 2, the first failure\'s time), then lands once', [fine(w), p2.n, p2.t === t1 - 5 * MIN, p2.v, xpOf(w, H), writesOf(w, XP, H)], [true, 2, true, 450, 450, [450, 450, 450]]);
}
{
  const ref = world(); honest(ref, H, J); honest(ref, H, J); after(ref, 2);
  // the first 1V1's writes fail, and so does their retry on the run that reads the second 1V1's starts: the second settles while
  //   450 / 20 still wait
  const F2 = merge(inj(XP, H, [FAIL(500)]), inj(CP, H, [FAIL(500)]));
  const w = world(); honest(w, H, J, [null, F2]); honest(w, H, J, [F2, null]); after(w, 2);
  eq('[2] a second 1V1 of H settles while the first one\'s 450 / 20 still wait: counted from them (one write per board), both games in his career block',
    [fine(w), xpOf(w, H), xpOf(ref, H), cpOf(w, H), cpOf(ref, H), careerOf(w, H), writesOf(w, XP, H), writesOf(w, CP, H), !!pend(w, H).xw], [true, xpOf(ref, H), 765, 40, 40, careerOf(ref, H), [450, 450, 765], [20, 20, 40], false]);
  T('[2] (the reference counts 2 games, 2 wins)', JSON.stringify(careerOf(ref, H)) === JSON.stringify([2, 2, 0]), JSON.stringify(careerOf(ref, H)));
  withMutant(['noSettleBase'], '[2]', (m) => {
    const x = world(m); honest(x, H, J, [null, F2]); honest(x, H, J, [F2, null]); after(x, 2);
    eq('[2] mutant (the settle reads the board): the second 1V1 counts from 0 and writes over the waiting 450', [fine(x), xpOf(x, H)], [true, 315]);
  });
}
withMutant(['noQueue'], '[2]', (m) => {
  const w = world(m); honest(w, H, J, [null, merge(inj(XP, H, [FAIL(500)]), inj(CP, H, [FAIL(500)]))]); after(w, 3);
  eq('[2] mutant (nothing waits, the code before): H ends with 0 XP / 0 CP instead of 450 / 20', [fine(w), xpOf(w, H), cpOf(w, H)], [true, 0, 0]);
});
withMutant(['noQuietRetry'], '[2]', (m) => {
  const w = world(m); honest(w, H, J, [null, inj(XP, H, [FAIL(500)])]); after(w, 3);
  eq('[2] mutant (no quiet retry): only quiet runs follow, his 450 still waits off the board', [fine(w), xpOf(w, H), (pend(w, H).xw || {}).v], [true, 0, 450]);
});

// ---- [3] never twice ----
{
  const w = world(); honest(w, H, J, [null, merge(inj(XP, H, [FAIL(500, true)]), inj(CP, H, [FAIL(500, true)]))]);
  after(w, 1, { stale: { [XP]: { [H]: 0 }, [CP]: { [H]: 0 } } }); after(w, 2);
  eq('[3] Steam took both writes but answered 500, the next read stale (0): the same absolute 450 / 20 again, never 900 / 40',
    [fine(w), xpOf(w, H), cpOf(w, H), writesOf(w, XP, H), writesOf(w, CP, H)], [true, 450, 20, [450, 450], [20, 20]]);
  const x = world(); honest(x, H, J, [null, inj(XP, H, [FAIL(500, true)])]); honest(x, H, J); after(x, 2);
  const ref = world(); honest(ref, H, J); honest(ref, H, J); after(ref, 2);
  eq('[3] ... and a second 1V1 on top of it: 765, not 450 more', [fine(x), xpOf(x, H), xpOf(ref, H)], [true, 765, 765]);
}
{
  // H's 450 waits (every run's first XP write of his fails until the void), then a 1V1 he wrote alone is voided: the consolation
  //   (Q315's loop) builds on the waiting 450, lands, and supersedes it
  const ref = world(); honest(ref, H, J); lone(ref, H, K); after(ref, 1);
  const F = inj(XP, H, [FAIL(500)]);
  const w = world(); honest(w, H, J, [null, F]); lone(w, H, K, [F, F, F, null]);
  const lastX = writesOf({ log: [w.log[w.log.length - 1]] }, XP, H);
  after(w, 1);
  eq('[3] a consolation of the account while his settle XP waits: 450 + 50, one write, the wait superseded', [fine(w), xpOf(w, H), xpOf(ref, H), lastX, !!pend(w, H).xw], [true, 500, 500, [500], false]);
  withMutant(['noConsoleBase'], '[3]', (m) => {
    const x = world(m); honest(x, H, J, [null, F]); lone(x, H, K, [F, F, F, null]); after(x, 1);
    eq('[3] mutant (the consolation reads the board): 0 + 50 lands and takes the wait away -- the 450 is lost', [fine(x), xpOf(x, H)], [true, 50]);
  });
}
{
  // the void run also settles an honest 1V1 of K and H (its records up a run ahead): the consolation writes 50 first, the settle's
  //   read of the XP board does not show it yet (stale: 0) -- the settle builds on the row this run wrote (H lost that 1V1 to K:
  //   225, on the 50 -- 275)
  const up = (w) => () => honestUp(w, K, H);
  const ref = world(); lone(ref, H, J, null, up(ref)); after(ref, 1);
  const w = world(); lone(w, H, J, [null, null, null, { stale: { [XP]: { [H]: 0 } } }], up(w)); after(w, 1);
  eq('[3] a consolation that landed, then the same run\'s settle with the read behind it: built on the 50 this run wrote', [fine(w), xpOf(w, H), xpOf(ref, H)], [true, xpOf(ref, H), 50 + 225]);
  withMutant(['noWrote'], '[3]', (m) => {
    const x = world(m); lone(x, H, J, [null, null, null, { stale: { [XP]: { [H]: 0 } } }], up(x)); after(x, 1);
    eq('[3] mutant (no run-local row): the settle counts from the stale 0 and writes the 50 away', [fine(x), xpOf(x, H)], [true, 225]);
  });
}
{
  // the void run: the consolation's write answers 500 but Steam kept it (its owed entry: found = 0, meant = 50); the settle of the
  //   same run reads 50 and its write fails (not kept): what waits (275) carries the 50 -- the owed write is found landed in it,
  //   not paid again on top
  const up = (w) => () => honestUp(w, K, H);
  const ref = world(); lone(ref, H, J, null, up(ref)); after(ref, 2);
  const VI = inj(XP, H, [FAIL(500, true), FAIL(500, false)]);
  const w = world(); lone(w, H, J, [null, null, null, VI], up(w));
  const landedNote = /consolation: [0-9a-f]{8} owed write found landed by the settle's read \(Q315, Q318\)/.test(outOf(w));
  after(w, 2);
  eq('[3] a consolation Steam kept although it answered 500, then the same run\'s settle write fails: the 275 that waits holds it, paid once',
    [fine(w), landedNote, xpOf(w, H), xpOf(ref, H), !!((((w.state || {}).SIGNALS_FILE || {}).players || {})[v.pid(H)] || {}).cq], [true, true, 275, 275, false]);
  withMutant(['noRebaseFail'], '[3]', (m) => {
    const x = world(m); lone(x, H, J, [null, null, null, VI], up(x)); after(x, 2);
    eq('[3] mutant (no re-tag on the failed settle write): the next run takes the waiting 275 for a moved row and pays the 50 twice', [fine(x), xpOf(x, H)], [true, 325]);
  });
}

// ---- [4] the wallet ----
{
  // H holds 1000 CP; the 1V1's CP write (1020) fails; the next run (no match to settle) finds his want of item 4 (800 CP) and its
  //   own retry fails again: the redeem debits the waiting 1020 -> 220
  const seed = { b: { [CP]: { [H]: { score: 1000 } } } };
  const ref = world(null, seed); honest(ref, H, J); ref.want[H] = 1 << 4; after(ref, 2);
  const w = world(null, seed); honest(w, H, J, [null, inj(CP, H, [FAIL(503)])]); w.want[H] = 1 << 4;
  after(w, 1, inj(CP, H, [FAIL(503)])); after(w, 1);
  eq('[4] a quiet run\'s redeem while his settle CP write waits: debited from 1020, the wait superseded by the debit', [fine(w), cpOf(w, H), cpOf(ref, H), writesOf(w, CP, H).slice(-2), !!pend(w, H).cw, ((w.b[GT][H] || {}).score) | 0], [true, 220, 220, [1020, 220], false, 1]);
  withMutant(['noRedeemWaiting'], '[4]', (m) => {
    const x = world(m, seed); honest(x, H, J, [null, inj(CP, H, [FAIL(503)])]); x.want[H] = 1 << 4; after(x, 1, inj(CP, H, [FAIL(503)])); after(x, 1);
    eq('[4] mutant (the redeem reads the board): debited from the 1000 on the board, his 20 lost', [fine(x), cpOf(x, H)], [true, 200]);
  });
  // the same, the run killed right after Steam took the debit (nothing saved after it): the next run writes the debited balance
  const k = world(null, seed); honest(k, H, J, [null, inj(CP, H, [FAIL(503)])]); k.want[H] = 1 << 4;
  after(k, 1, Object.assign(inj(CP, H, [FAIL(503)]), { die: [CP, H, 2] })); const killed = k.log[k.log.length - 1].code;
  after(k, 2);
  eq('[4] killed right after the debit landed: the waiting value had moved to 220 on disk ahead of it -- charged once', [killed, cpOf(k, H), writesOf(k, CP, H).slice(-2), !!pend(k, H).cw], [7, 220, [220, 220], false]);
  withMutant(['noAhead'], '[4]', (m) => {
    const x = world(m, seed); honest(x, H, J, [null, inj(CP, H, [FAIL(503)])]); x.want[H] = 1 << 4;
    after(x, 1, Object.assign(inj(CP, H, [FAIL(503)]), { die: [CP, H, 2] })); after(x, 2);
    eq('[4] mutant (no move ahead of the debit): the next run writes the 1020 back over the debit', [cpOf(x, H)], [1020]);
  });
}

// ---- [5] the fuse, another board, unnamed, dry run ----
{
  const now = Date.now();
  const files = { PENDING_WRITES_FILE: { [v.pid(H)]: { xw: { b: 'progress', v: 450, t: now - 7 * 86400000 - 60000, n: 4 } }, [v.pid(J)]: { xw: { b: 'progress_old', v: 99, t: now, n: 1 } },
    [v.pid(U)]: { cw: { b: 'cp_bank', v: 30, t: now, n: 1 } }, [v.pid(U2)]: { cw: { b: 'cp_bank', v: 40, t: now - 7 * 86400000 - 60000, n: 2 } } } };
  const w = world(null, { files }); honest(w, H, J, null, 0); after(w, 1);
  const out = outOf(w);
  T('[5] past 7 days, no run names him: dropped at the save with a warning, nothing written', /::warning::cp write of [0-9a-f]{8} dropped after 2 failed tries over 7 days \(value 40, Q318\)/.test(out) && !pend(w, U2).cw && cpOf(w, U2) === 0, out.slice(-800));
  // like the points write (O480): the fuse is the save's; a run that names him before it still writes it, once
  eq('[5] past 7 days, a run names him first: written once, then his new 1V1 on it', [fine(w), writesOf(w, XP, H), !!pend(w, H).xw], [true, [450, 900], false]);
  T('[5] meant for another board: dropped with a warning, nothing written', /xp write of [0-9a-f]{8} for board progress_old dropped: this job writes progress \(value 99, 1 tries, Q318\)/.test(out) && !pend(w, J).xw && xpOf(w, J) === xpOf(ref1, J), out.slice(-800));
  eq('[5] a player no run can name (no record, no row): waits', [fine(w), (pend(w, U).cw || {}).v, cpOf(w, U)], [true, 30, 0]);
}
{
  const w = world(); honest(w, H, J, [null, inj(XP, H, [FAIL(500)])]);
  step(w, 5 * MIN, null, { APPLY_MMR: '0' });
  const dry = w.log[w.log.length - 1];
  eq('[5] a dry run: writes nothing, keeps it waiting', [dry.code, writesOf({ log: [dry] }, XP, H).length, (pend(w, H).xw || {}).v], [0, 0, 450]);
  after(w, 1);
  eq('[5] ... and the next live run writes it', [fine(w), xpOf(w, H)], [true, 450]);
}

// ---- [7] wiring pins ----
{
  const mb = SRC.slice(SRC.indexOf('  let consoledN = 0;\n'), SRC.indexOf('  RUN.consoled = consoledN;'));
  const iSave = mb.indexOf('owedSet(sid, sent); saveSignals(signals, nowMs);'), iAhead = mb.indexOf("rowAhead('xw', sid, next);"), iPost = mb.indexOf("postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/'");
  T('[7] consolation: the waiting value moved after the owed entry is on disk, before the write; superseded once it landed', iSave > 0 && iAhead > iSave && iPost > iAhead
    && /owedSet\(sid, null\); saveSignals\(signals, nowMs\);[^\n]*\n        rowLanded\('xw', sid, next\);/.test(mb));
  T('[7] consolation: a waiting value is the base (no read), its details the career block from the XP state', /e = xwP \? null : await readUserEntry\(xpId0, sid, 'xp'\);\n        c = xwP \? \(xwP\.v \| 0\) :/.test(mb) && /const det = xwP \? careerBlockOf\(/.test(mb));
  T('[7] the quiet exits retry after the points backlog and before the state is saved', (SRC.match(/await lpRetry\(\); await rowRetry\(\); persistStartsSide\(\);/g) || []).length === 2);
  const iWcp = SRC.indexOf('  const wCp = await mapPool(Object.keys(changedCp), '), iCw = SRC.indexOf("Object.keys(changedCp).forEach((sid, i) => rowAfterWrite('cw', sid, cpClamp(changedCp[sid])"),
    iSaveB = SRC.indexOf('  if (backlogDirty) savePendingWrites(lpBacklog, nowMs, true);', iCw), iProc = SRC.indexOf('  saveProcessed(processed);\n  saveSkill(skill);');
  T('[7] settle: the XP / CP outcomes go to the backlog, saved before the processed keys', iWcp > 0 && iCw > iWcp && iSaveB > iCw && iProc > iSaveB);
  const iRetryX = SRC.indexOf("  for (const sid of xpRetrySids) if (rowWaiting('xw', sid) && changedXp[sid] == null) changedXp[sid] = xp[sid] | 0;"), iFill = SRC.indexOf('  const careerRefilled = fillCareerDetails(changedXp, careerDet, xpState);');
  T('[7] settle: the retries join this run\'s writes before the career blocks are filled', iRetryX > 0 && iFill > iRetryX);
  T('[7] redeem: the waiting balance read, the debit moved ahead and superseding', /const cwP = rowWaiting\('cw', w\.sid\);/.test(SRC) && /rowAhead\('cw', w\.sid, plan\.balance\);[^\n]*\n        const dw = await postForm\(/.test(SRC) && /else \{ if \(cpVals\) cpVals\[w\.sid\] = plan\.balance; rowLanded\('cw', w\.sid, plan\.balance\); \}/.test(SRC));
  T('[7] the summary row and the RUN counters', /'\| settle XP \/ CP writes that failed, waiting for a later run \/ waiting writes that landed \(Q318\) \| ' \+ s\('rowQueued', 0\) \+ ' \/ ' \+ s\('rowRetried', 0\)/.test(SRC)
    && /RUN\.rowQueued = \(RUN\.rowQueued \| 0\) \+ 1;/.test(SRC) && /RUN\.rowRetried = \(RUN\.rowRetried \| 0\) \+ 1;/.test(SRC));
  T('[7] the backlog header documents xw / cw', /\/\/   xw \/ cw: \{ b, v, t, n \} -- an XP \/ CP write of the settle that failed \(cloud audit Q318;/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (settle-write-owed) ===');
process.exit(failN === 0 ? 0 : 1);
