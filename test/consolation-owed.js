'use strict';
// cloud audit Q315: the consolation XP of a voided match (the flat CONSOLATION_XP, or Q308's disputed-1V1 floor) rides the
//   processed gate -- its key is marked on disk ahead of the write -- and a write that failed was forfeited: the honest writer
//   lost the 50 (or the floor) for good, and the Q308 day slot counted ahead of the write stayed taken. Now what failed is owed
//   on his signals entry (players[pid].cq, validate.js CONSOLE_OWED) and the next run that names the account pays it, never
//   twice: an unsent credit is paid at that run's board value; a write that was sent and failed is paid again only while his
//   row still reads what it found (an absolute write, right whether or not Steam took it), dropped once the row shows it
//   landed, paid on the row it shows (a warning, architecture decision 10) when something else moved the row.
// Over the REAL validate.js main() against an offline board stub whose XP board carries over from run to run (each landed
//   ForceUpdate applied to it) and which can fail XP writes, the XP read, the board listing, or serve a stale XP read:
//   [1] units: owedItem / owedItemXp / owedRefund / owedUnsent (the cap) / consoleOwedTake (named, waiting, expired) /
//       consoleOwedPlan (paid, landed, moved) / consoleOwedRebase / owedTag (no score in the stored entry)
//   [2] the failures, each against the same runs with nothing failing: a disputed 1V1's floor write fails (two floors
//       already today, a second dispute the same day); the flat 50's write fails; the XP read fails; the XP board is missing
//       from the listing; the write throws; it fails two runs in a row -- the honest writer ends with exactly what the
//       runs without a failure pay him, his day slots as they would be
//   [3] never twice: Steam took the write but answered 500; a stale read after a landed write; the same run's settle
//       writes his XP after the failed consolation (re-tagged on that row; Steam had kept it: found landed, the no-re-tag
//       mutant pays it twice); something else moved his row (paid on it, warned)
//   [4] the owed entry ages out unnamed (CONSOLE_OWED_MAX_MS, today's slot handed back); a dry run writes nothing, keeps it
//   [5] mutants: no owed entry (the code before) / no tag check / no re-tag after the settle / no slot hand-back
//   [6] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/dispute-1v1-floor.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'DISPUTE_FLOOR_DAY_CAP', 'CONSOLATION_XP',
  'CONSOLE_OWED_MAX_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() / v.owedTag() address their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// STUB_INJECT, this run only: { post: { sid: [status | 'throw', applied, n] } -- his first n XP-board writes (all when n is
//   absent) answer `status` (or throw), Steam keeping each when `applied`; read: [sid] -- his XP read fails; stale: { sid:
//   score } -- his XP read shows that score; unlisted: [boardName] -- missing from the board listing }
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
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1];",
  "    const xpw = /SetLeaderboardScore/.test(u) && /leaderboardid=5(&|$)/.test(body);",
  '    if (xpw) seen[sid] = (seen[sid] || 0) + 1;',
  '    const f0 = xpw && INJ.post && INJ.post[sid];',
  '    const f = f0 && (f0[2] == null || seen[sid] <= f0[2]) ? f0 : null;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: f ? !!f[1] : true, failed: f ? f[0] : 0 }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  "    // what Steam keeps is read back by the same run (the settle reads the XP board after the consolation wrote it)",
  "    const keep = (b) => { const bid = (/leaderboardid=([0-9]+)/.exec(b) || [])[1], sc = (/score=(-?[0-9]+)/.exec(b) || [])[1], bd = byId[bid];",
  "      if (!bd || sid == null || sc == null) return; const e = bd.entries.find((x) => String(x.steamID) === sid); if (e) e.score = Number(sc); else bd.entries.push({ steamID: sid, score: Number(sc), detailData: '' }); };",
  "    if (/SetLeaderboardScore/.test(u) && (!f || f[1])) keep(body);",
  "    if (f) { if (f[0] === 'throw') throw new Error('injected network error'); return resp({ error: 'injected' }, f[0]); }",
  '    return resp({ result: { result: 1 } });',
  '  }',
  "  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.filter(b => !(INJ.unlisted || []).includes(b.name)).map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });",
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  "    if (around && b && b.name === 'progress' && (INJ.read || []).includes(around)) return resp({ error: 'injected' }, 503);",
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  "    if (around && b && b.name === 'progress' && INJ.stale && INJ.stale[around] != null) ents = [{ steamID: around, score: INJ.stale[around] }];",
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files, env, inject, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolation-owed-'));
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
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back; .at stays: they play on)
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
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const H = SID(3150), J = SID(3151), K = SID(3152), L = SID(3153);
const ALL = [H, J, K, L];
const MIN = 60000, HOUR = 3600 * 1000;
const HON = [7000, 4000], MOD = [4000, 9000];   // H (seat 0) won 7000 to 4000; J claims 9000 to 4000
// the world: the shard records written so far (they stay up) and the XP board, carried from run to run
function world(script) { return { recs: [], xp: {}, state: null, log: [], script: script || null }; }
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: Object.keys(w.xp).map((s) => ({ steamID: s, score: w.xp[s] })) }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] });
  boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) });
  return boards;
}
function step(w, ms, inject, env) {
  if (w.state && w.state.__failed) return;
  const r = runCron(boardsOf(w), w.state ? advance(w.state, ms) : null, env || null, inject, w.script);
  w.log.push(r);
  if (r.code !== 0) { w.state = { __failed: true }; return; }
  if (!(env && env.APPLY_MMR === '0')) w.state = r.state;
  for (const p of r.posts) {   // the XP board as Steam keeps it: every write that landed (ForceUpdate, absolute)
    if (!/SetLeaderboardScore/.test(p.url) || !/leaderboardid=5(&|$)/.test(p.body) || !p.applied) continue;
    w.xp[/steamid=([0-9]+)/.exec(p.body)[1]] = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
  }
}
let hn = 0;
// a 1V1 of H (seat 0) and `b` (seat 1), quick: the starts, ten minutes on the results (b claims the win when `dispute`, or
//   writes none when `bLeft`), ten more, two hours on (the start verdict voids it); `voidInject` = the failure of the void
//   run; `sameRun`: an honest 1V1 of K and H whose records go up a run ahead of the void run (settled in it)
function match(w, opt) {
  const b = opt.b || J, hsh = 0x3150 + (++hn), two = [H, b];
  w.recs.push({ sid: H, d: rec(0xB2, 1, hsh, 0, 0, false, two, null) }, { sid: b, d: rec(0xB2, 1, hsh, 1, 0, false, two, null) });
  step(w, opt.gap || 0);
  w.recs.push({ sid: H, d: rec(0xB1, 1, hsh, 0, 1, true, two, HON) });
  if (!opt.bLeft) { const sc = opt.dispute ? MOD : HON; w.recs.push({ sid: b, d: rec(0xB1, 1, hsh, 1, sc[1] > sc[0] ? 1 : 2, sc[1] > sc[0], two, sc) }); }
  step(w, 10 * MIN);
  if (opt.sameRun) {   // up a run ahead: a fresh key settles on the run after the one that first reads it
    const h2 = 0x3150 + (++hn), kh = [K, H];
    w.recs.push({ sid: K, d: rec(0xB2, 1, h2, 0, 0, false, kh, null) }, { sid: H, d: rec(0xB2, 1, h2, 1, 0, false, kh, null) });
    w.recs.push({ sid: K, d: rec(0xB1, 1, h2, 0, 2, false, kh, [4000, 7000]) }, { sid: H, d: rec(0xB1, 1, h2, 1, 1, true, kh, [4000, 7000]) });
  }
  step(w, 10 * MIN);
  step(w, 2 * HOUR, opt.voidInject || null, opt.voidEnv || null);
}
const after = (w, n, inject) => { for (let i = 0; i < n; i++) step(w, 5 * MIN, inject || null); };
const sig = (w, s) => ((((w.state || {}).SIGNALS_FILE || {}).players || {})[v.pid(s)]) || {};
const fine = (w) => w.log.length > 0 && w.log.every((r) => r.code === 0);
const outOf = (w) => w.log.map((r) => r.out).join('');
const xpWrites = (w, s) => [].concat(...w.log.map((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && /leaderboardid=5(&|$)/.test(p.body) && new RegExp('steamid=' + s + '(&|$)').test(p.body)).map((p) => Number(/score=(-?[0-9]+)/.exec(p.body)[1]))));
const day = Math.floor(Date.now() / 86400000);
const seedFq = (w, s, n) => { w.state = { SIGNALS_FILE: { day: { d: day, n: {} }, players: { [v.pid(s)]: { g: 0, w: 0, v: 0, f: 0, ns: 0, disp: [0, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now(), fq: day, fqn: n } }, pairs: {}, flagged: {} } }; };
const rowQ315 = (w) => { const r = w.log[w.log.length - 1]; const m = /\| consolation XP writes that failed, owed to a later run [^|]*\(Q315\) \| ([0-9]+) \/ ([0-9]+) \(([0-9]+)\) \/ ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/.exec(r ? r.summary : ''); return m ? m.slice(1).map(Number) : null; };
const rowsQ315 = (w) => w.log.map((r) => { const m = /\| consolation XP writes that failed, owed to a later run [^|]*\(Q315\) \| ([0-9]+) \/ ([0-9]+) \(([0-9]+)\) \/ ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? m.slice(1).map(Number) : null; });
const sumRows = (w) => rowsQ315(w).reduce((a, r) => r ? a.map((x, i) => x + r[i]) : a, [0, 0, 0, 0, 0, 0]);

// mutants: validate.js with one part of the fix put back
const BEFORE = {
  // the code before: a failed write owes nothing (and the read / listing failures leave nothing owed)
  noOwe: ['      } else { owedSent.add(sid); ow.owed++; ghWarn(', '      } else { owedSet(sid, null); owedSent.add(sid); ow.owed++; ghWarn('],
  // no tag check: an owed write is paid again whatever his row reads
  noTag: ["    if (t === cq.s.h1) out.sent = 'landed';", "    if (false) out.sent = 'landed';"],
  // no re-tag once the settle wrote his XP in the same run
  noRebase: ["    if (!owedSent.has(sid) || !(wXp[i] && wXp[i].status === 'fulfilled' && wXp[i].value)) return;", '    return;'],
  // a floor given up keeps its day slot
  noRefund: ['  for (const d of days || []) if (d === day && (p.fq | 0) === day && (p.fqn | 0) > 0) { p.fqn--; n++; }\n', ''],
};
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return null; }
    src = src.replace(from, to);
  }
  const script = path.join(__dirname, '..', '.mutant-consolation-owed-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// ---- [1] units ----
{
  const need = ['owedTag', 'owedItem', 'owedItemXp', 'owedRefund', 'owedUnsent', 'consoleOwedTake', 'consoleOwedPlan', 'consoleOwedRebase'];
  T('[1] exported: CONSOLE_OWED (7 days, 8 unsent) and the helpers', !!v.CONSOLE_OWED && v.CONSOLE_OWED.MAX_MS === 7 * 86400000 && v.CONSOLE_OWED.U_CAP === 8 && need.every((k) => typeof v[k] === 'function'));
  const fl = { cls: 'valid', money: 4000, ranked: false };
  eq('[1] owedItem: the flat one / a floor with what disputeFloorXp needs and its slot\'s day', [v.owedItem(null, 9), v.owedItem(fl, 9), v.owedItem({ cls: 'abandoner', money: 0, ranked: true }, 9)],
    [{ c: 1 }, { cls: 'valid', mo: 4000, rk: 0, d: 9 }, { cls: 'abandoner', mo: 0, rk: 1, d: 9 }]);
  const g = () => 0;
  eq('[1] owedItemXp: the flat 50; the quick floor 225 at 0 XP, the ranked 281; the level boost of the board value it is paid at',
    [v.owedItemXp({ c: 1 }, 0, 0, g), v.owedItemXp(v.owedItem(fl, 9), 0, 0, g), v.owedItemXp(v.owedItem(Object.assign({}, fl, { ranked: true }), 9), 0, 0, g), v.owedItemXp(v.owedItem(fl, 9), 1500, 0, g)],
    [v.CONSOLATION_XP, v.disputeFloorXp(fl, 0, 0, 0), v.disputeFloorXp(Object.assign({}, fl, { ranked: true }), 0, 0, 0), v.disputeFloorXp(fl, 1500, 0, 0)]);
  T('[1] owedItemXp: the floor reads the XP state lazily (a flat item never)', (() => { let n = 0; const gg = () => { n++; return 0; }; v.owedItemXp({ c: 1 }, 0, 0, gg); const a = n; v.owedItemXp(v.owedItem(fl, 9), 0, 0, gg); return a === 0 && n === 1; })());
  const now = Date.UTC(2026, 9, 21, 12), today = Math.floor(now / 86400000);
  const pl = () => ({ fq: today, fqn: 3 });
  { const p = pl(); const n = v.owedRefund(p, [today, today - 1, today], now); eq('[1] owedRefund: today\'s slots only', [n, p.fqn], [2, 1]); }
  { const p = { fq: today - 1, fqn: 3 }; eq('[1] owedRefund: nothing once the counter moved to another day', [v.owedRefund(p, [today], now), p.fqn], [0, 3]); }
  { const p = { fq: today, fqn: 0 }; eq('[1] owedRefund: never below 0', [v.owedRefund(p, [today, today], now), p.fqn], [0, 0]); }
  {
    const p = pl(), s = { a: 50, h0: 'x', h1: 'y', d: [] };
    const o1 = v.owedUnsent(p, null, { c: 1 }, now);
    eq('[1] owedUnsent: a first unsent credit', o1, { t: now, u: [{ c: 1 }] });
    const o2 = v.owedUnsent(p, { t: now - 5, u: [{ c: 1 }], s }, v.owedItem(fl, today), now + 9);
    eq('[1] owedUnsent: appended, the first failure\'s time and the sent write kept', o2, { t: now - 5, u: [{ c: 1 }, { cls: 'valid', mo: 4000, rk: 0, d: today }], s });
    const many = { t: now, u: [v.owedItem(fl, today)].concat(Array.from({ length: 7 }, () => ({ c: 1 }))) };
    const o3 = v.owedUnsent(p, many, { c: 1 }, now);
    eq('[1] owedUnsent: at most 8 unsent -- the oldest given up, its slot of today handed back', [o3.u.length, o3.u[0], p.fqn], [8, { c: 1 }, 2]);
  }
  {
    const hN = v.pid(H), hW = v.pid(J), hE = v.pid(K);
    const sg = { players: { [hN]: { at: now, cq: { t: now - HOUR, u: [{ c: 1 }] } }, [hW]: { at: now, cq: { t: now - HOUR, u: [{ c: 1 }] } },
      [hE]: { at: now, fq: today, fqn: 2, cq: { t: now - 8 * 86400000, u: [v.owedItem(fl, today)], s: { a: 225, h0: 'a', h1: 'b', d: [today] } } }, x: { at: now } } };
    const res = v.consoleOwedTake(sg, now, (h) => h === hN ? H : null);
    eq('[1] consoleOwedTake: named -> paid this run; unnamed -> waiting; past 7 days -> given up, today\'s slots back',
      [[...res.bySid.keys()], res.waiting, res.expired, res.dirty, !!sg.players[hE].cq, sg.players[hE].fqn, !!sg.players[hW].cq], [[H], 1, 1, true, false, 0, true]);
  }
  {
    const h = v.pid(H), xpOf = (it) => it.cls ? 225 : 50;
    const cq = (s, u) => ({ t: now, u: u || [], s });
    const sOf = (c, a, d) => ({ a, h0: v.owedTag(h, c), h1: v.owedTag(h, c + a), d: d || [] });
    eq('[1] consoleOwedPlan: nothing owed, this run\'s credit', v.consoleOwedPlan(h, 100, null, { c: 1 }, xpOf), { add: 50, days: [], sent: null });
    eq('[1] consoleOwedPlan: his row still reads what the sent write found -> paid again (+ the unsent, + this run\'s)',
      v.consoleOwedPlan(h, 100, cq(sOf(100, 225, [today]), [{ c: 1 }]), v.owedItem(fl, today), xpOf), { add: 225 + 50 + 225, days: [today, today], sent: 'paid' });
    eq('[1] consoleOwedPlan: his row shows the sent write landed -> not again (the unsent still paid)',
      v.consoleOwedPlan(h, 325, cq(sOf(100, 225, [today]), [{ c: 1 }]), null, xpOf), { add: 50, days: [], sent: 'landed' });
    eq('[1] consoleOwedPlan: any other row (something wrote his XP since) -> paid on it, marked moved',
      v.consoleOwedPlan(h, 777, cq(sOf(100, 225, [today])), null, xpOf), { add: 225, days: [today], sent: 'moved' });
    const p = { cq: cq(sOf(100, 225)) };
    eq('[1] consoleOwedRebase: found on the row the settle read -> re-tagged on the row it left', [v.consoleOwedRebase(p, h, 100, 400), p.cq.s.h0 === v.owedTag(h, 400), p.cq.s.h1 === v.owedTag(h, 625)], ['moved', true, true]);
    const q = { cq: cq(sOf(100, 225)) };
    eq('[1] consoleOwedRebase: landed (the settle read h1) -> dropped; any other row -> untouched', [v.consoleOwedRebase(q, h, 325, 600), q.cq, v.consoleOwedRebase({ cq: cq(sOf(100, 225)) }, h, 5, 600), v.consoleOwedRebase({}, h, 1, 2)], ['landed', undefined, null, null]);
    T('[1] owedTag: keyed per account and score, 12 hex; the entry holds no score', v.owedTag(h, 100) !== v.owedTag(h, 101) && v.owedTag(h, 100) !== v.owedTag(v.pid(J), 100) && /^[0-9a-f]{12}$/.test(v.owedTag(h, 100))
      && !/\b(100|325)\b/.test(JSON.stringify(cq(sOf(100, 225)))));
  }
}

// ---- [2] the failures: the honest writer ends with what the same runs without the failure pay him ----
const ref1 = (() => { const w = world(); match(w, { dispute: true }); after(w, 3); return w; })();
const refFlat = (() => { const w = world(); match(w, { bLeft: true }); after(w, 3); return w; })();
{
  const ref = world(); seedFq(ref, H, 2); match(ref, { dispute: true }); after(ref, 3); match(ref, { dispute: true, gap: 5 * MIN });
  const w = world(); seedFq(w, H, 2); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } });
  const fqFail = sig(w, H).fqn | 0, owed = !!sig(w, H).cq;
  after(w, 3); const mid = w.xp[H] | 0;
  match(w, { dispute: true, gap: 5 * MIN });
  eq('[2] a disputed 1V1\'s floor write fails (500), two floors already today: owed, its slot kept (3); paid the next run (225); a second dispute that day the flat 50 (the cap, as without the failure)',
    [fine(w), owed, fqFail, mid, w.xp[H] | 0, ref.xp[H] | 0, w.xp[J] | 0, ref.xp[J] | 0, sig(w, H).fqn | 0, sig(ref, H).fqn | 0], [true, true, 3, 225, 275, 275, 450, 450, 3, 3]);
  T('[2] logged: the failed write owed to a later run, then paid with the owed note', /consolation xp write failed for [0-9a-f]{8} \(HTTP 500\) -- owed to a later run \(Q315\)/.test(outOf(w)) && /consolation xp [0-9a-f]{8} \+225 -> 225 \(Q315: \+ 1 owed by an earlier run\)/.test(outOf(w)), outOf(w).slice(-600));
  eq('[2] summary rows across the runs: owed 1 / paid 1 (on a moved row 0) / landed 0 / given up 0 / waiting 0', sumRows(w), [1, 1, 0, 0, 0, 0]);
  T('[2] the owed entry gone once paid', !sig(w, H).cq);
}
{
  const w = world(); match(w, { bLeft: true, voidInject: { post: { [H]: [502, false] } } }); after(w, 3);
  eq('[2] the flat 50 of a lone writer, the write fails (502): paid the next run', [fine(w), w.xp[H] | 0, refFlat.xp[H] | 0, xpWrites(w, H)], [true, 50, 50, [50, 50]]);
}
{
  const w = world(); match(w, { dispute: true, voidInject: { read: [H] } }); after(w, 3);
  eq('[2] his XP read fails (503, every try): owed unsent, paid the next run at its board value', [fine(w), w.xp[H] | 0, ref1.xp[H] | 0, w.xp[J] | 0, ref1.xp[J] | 0], [true, 225, 225, 225, 225]);
  T('[2] logged: the read failure owed to a later run', /consolation xp read failed for [0-9a-f]{8}: [^\n]* -- owed to a later run \(Q315\)/.test(outOf(w)));
}
{
  const w = world(); match(w, { dispute: true, voidInject: { unlisted: ['progress'] } }); after(w, 3);
  eq('[2] the XP board missing from the listing on the void run: both writers owed, paid the next run', [fine(w), w.xp[H] | 0, w.xp[J] | 0], [true, 225, 225]);
  T('[2] logged: the board absent, accounts owed', /xp board absent \(consolation path\) -> 2 account\(s\) owed to a later run \(Q315\)/.test(outOf(w)));
}
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: ['throw', false] } } }); after(w, 3);
  eq('[2] the write throws (a network error): paid the next run', [fine(w), w.xp[H] | 0], [true, 225]);
}
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } });
  const t1 = (sig(w, H).cq || {}).t;
  after(w, 1, { post: { [H]: [503, false] } });
  const c2 = sig(w, H).cq || {};
  after(w, 3);
  eq('[2] it fails two runs in a row: still owed once (the first failure\'s time), then paid once', [fine(w), !!c2.s, c2.t === t1 - 5 * MIN, (c2.s || {}).a, w.xp[H] | 0, xpWrites(w, H)], [true, true, true, 225, 225, [225, 225, 225]]);
}

// ---- [3] never twice ----
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, true] } } }); after(w, 3);
  eq('[3] Steam took the write but answered 500: not paid again (his row shows it)', [fine(w), w.xp[H] | 0, xpWrites(w, H)], [true, 225, [225]]);
  T('[3] logged: found landed after all', /consolation: [0-9a-f]{8} a write owed since an earlier run landed after all -- not paid again \(Q315\)/.test(outOf(w)));
  eq('[3] summary rows: owed 1 / paid 0 (0) / landed 1', sumRows(w).slice(0, 4), [1, 0, 0, 1]);
}
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, true] } } });
  after(w, 1, { stale: { [H]: 0 } }); const x1 = w.xp[H] | 0, owed1 = !!sig(w, H).cq;
  after(w, 3);
  eq('[3] a stale read after the write landed (his row still shows 0): the same absolute 225 again, never 450', [fine(w), x1, owed1, w.xp[H] | 0, xpWrites(w, H)], [true, 225, false, 225, [225, 225]]);
}
{
  const ref = world(); match(ref, { dispute: true, sameRun: true }); after(ref, 3);
  const w = world(); match(w, { dispute: true, sameRun: true, voidInject: { post: { [H]: [500, false, 1] } } });
  const re = /consolation: [0-9a-f]{8} owed write re-tagged on the row the settle left \(Q315\)/.test(outOf(w));
  after(w, 3);
  eq('[3] the consolation write fails, the same run\'s settle writes his XP: re-tagged on that row, paid the next run', [fine(w), re, w.xp[H] | 0, ref.xp[H] | 0], [true, true, ref.xp[H] | 0, ref.xp[H] | 0]);
  T('[3] (the settle did write his XP in the void run)', ref.xp[H] > 225 && (w.log[3].posts.filter((p) => /leaderboardid=5(&|$)/.test(p.body) && new RegExp('steamid=' + H).test(p.body)).length === 2), JSON.stringify(xpWrites(w, H)));
  T('[3] (no "row moved" warning: the re-tag kept the owed write on the row the settle left)', !/XP row moved since an owed write failed/.test(outOf(w)));
  const k = world(); match(k, { dispute: true, sameRun: true, voidInject: { post: { [H]: [500, true, 1] } } });
  const kl = /consolation: [0-9a-f]{8} owed write found landed by the settle's read \(Q315\)/.test(outOf(k));
  after(k, 3);
  eq('[3] the write answers 500 but Steam kept it, the same run\'s settle reads it back and writes on top: found landed, never paid again', [fine(k), kl, k.xp[H] | 0, !!sig(k, H).cq], [true, true, ref.xp[H] | 0, false]);
  withMutant(['noRebase'], '[3]', (m) => {
    const x = world(m); match(x, { dispute: true, sameRun: true, voidInject: { post: { [H]: [500, true, 1] } } }); after(x, 3);
    eq('[3] mutant (no re-tag): the next run takes the settle\'s row for a moved one and pays the 225 twice', [fine(x), (x.xp[H] | 0) - (ref.xp[H] | 0)], [true, 225]);
  });
}
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } });
  const fq1 = sig(w, H).fqn | 0;
  w.xp[H] = 1000;   // something wrote his XP row since without this job re-tagging the owed write (a hand restore, a run killed mid-way)
  after(w, 3);
  eq('[3] his row moved since the failed write: paid once on the row it shows (architecture decision 10), the floor slot kept', [fine(w), w.xp[H] | 0, xpWrites(w, H), fq1, sig(w, H).fqn | 0, !!sig(w, H).cq], [true, 1225, [225, 1225], 1, 1, false]);
  T('[3] logged (a warning): the row moved, paid on it', /::warning::consolation: [0-9a-f]{8} XP row moved since an owed write failed -- paid on the row it shows now \(Q315\)/.test(outOf(w)), outOf(w).slice(-800));
  eq('[3] summary rows: paid 1, of them on a moved row 1', sumRows(w).slice(0, 3), [1, 1, 1]);
}

// ---- [4] aging out, dry run ----
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } });
  w.recs = w.recs.filter((r) => r.sid !== H);   // H's records gone from the shards: no run can name him
  const env = { CONSOLE_OWED_MAX_MS: String(30 * MIN) };
  step(w, 5 * MIN, null, env); const waiting = rowQ315(w), still = !!sig(w, H).cq;
  step(w, 30 * MIN, null, env);
  eq('[4] unnamed: waiting while young; past CONSOLE_OWED_MAX_MS given up, today\'s slot back', [fine(w), still, (waiting || [])[5], !!sig(w, H).cq, (rowQ315(w) || [])[4], sig(w, H).fqn | 0, w.xp[H] | 0], [true, true, 1, false, 1, 0, 0]);
  T('[4] logged: given up unnamed', /consolation: [0-9a-f]{8} owed since a write failed [0-9]+h ago, never named since -- given up \(Q315\)/.test(outOf(w)));
  withMutant(['noRefund'], '[4]', (m) => {
    const x = world(m); match(x, { dispute: true, voidInject: { post: { [H]: [500, false] } } }); x.recs = x.recs.filter((r) => r.sid !== H);
    step(x, 5 * MIN, null, env); step(x, 30 * MIN, null, env);
    eq('[4] mutant (no hand-back): the slot stays taken', [fine(x), !!sig(x, H).cq, sig(x, H).fqn | 0], [true, false, 1]);
  });
}
{
  const w = world(); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } });
  step(w, 5 * MIN, null, { APPLY_MMR: '0' });
  const dry = w.log[w.log.length - 1];
  eq('[4] a dry run: logs the payment with the owed note, writes nothing, keeps it owed', [dry.code, /\(dry-run\) consolation xp [0-9a-f]{8} = 225 \(Q315: \+ 1 owed by an earlier run\)/.test(dry.out), xpWrites({ log: [dry] }, H).length, !!sig(w, H).cq], [0, true, 0, true]);
  after(w, 1);
  eq('[4] ... and the next live run pays it', [fine(w), w.xp[H] | 0], [true, 225]);
}

// ---- [5] mutants of the core ----
withMutant(['noOwe'], '[5]', (m) => {
  const w = world(m); match(w, { dispute: true, voidInject: { post: { [H]: [500, false] } } }); after(w, 3);
  eq('[5] mutant (owe nothing, the code before): H ends at 0 instead of 225', [fine(w), w.xp[H] | 0], [true, 0]);
});
withMutant(['noTag'], '[5]', (m) => {
  const w = world(m); match(w, { dispute: true, voidInject: { post: { [H]: [500, true] } } }); after(w, 3);
  eq('[5] mutant (no tag check): Steam had taken it, paid twice (450)', [fine(w), w.xp[H] | 0], [true, 450]);
});

// ---- [6] wiring pins ----
{
  const mb = SRC.slice(SRC.indexOf('  let consoledN = 0;\n'), SRC.indexOf('  RUN.consoled = consoledN;'));
  T('[6] main: the owed entries taken ahead of the loop, named through this run\'s records / starts (sidByPid)',
    /const owedRes = XP_LB \? consoleOwedTake\(signals, nowMs, \(h\) => sidByPid\.get\(h\) \|\| null\) : /.test(mb) && /const paySids = consoled\.concat\(\[\.\.\.owedRes\.bySid\.keys\(\)\]/.test(mb));
  const iSave = mb.indexOf('owedSet(sid, sent); saveSignals(signals, nowMs);'), iPost = mb.indexOf("postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/'");
  T('[6] main: every write put on the entry and on disk before it is sent; off it (and the disk) once it landed', iSave > 0 && iSave < iPost
    && /if \(!why\) \{\n        owedSet\(sid, null\); saveSignals\(signals, nowMs\);/.test(mb) && /\} else \{ owedSent\.add\(sid\); ow\.owed\+\+; ghWarn\('consolation xp write failed for '/.test(mb));
  T('[6] main: the sent write tagged on the row read and on the row meant (HMAC, no score stored)', /s: \{ a: plan\.add, h0: owedTag\(h, c\), h1: owedTag\(h, next\), d: plan\.days \}/.test(mb));
  const iBase = SRC.indexOf('  for (const sid of owedSent) owedXpBase[sid] = xp[sid] | 0;\n'), iOnDemand = SRC.indexOf("console.log('on-demand base reads: '"), iChanged = SRC.indexOf('  const changed = {}; const changedLp = {}; const changedXp = {};');
  T('[6] main: the settle\'s base of an owed account taken after the on-demand reads, before any credit', iBase > iOnDemand && iBase < iChanged && iOnDemand > 0);
  const iWxp = SRC.indexOf('  const wXp = await mapPool(Object.keys(changedXp), '), iRe = SRC.indexOf('consoleOwedRebase(signals.players[h], h, owedXpBase[sid] | 0, changedXp[sid] | 0)'), iWcp = SRC.indexOf('  const wCp = await mapPool(Object.keys(changedCp), ');
  T('[6] main: re-tagged after the settle\'s XP writes, only for those that landed', iWxp > 0 && iRe > iWxp && iRe < iWcp && SRC.indexOf("if (!owedSent.has(sid) || !(wXp[i] && wXp[i].status === 'fulfilled' && wXp[i].value)) return;") > iWxp);
  T('[6] the summary row and the RUN counters', /'\| consolation XP writes that failed, owed to a later run /.test(SRC) && /RUN\.owedPaid = ow\.paid; RUN\.owedLanded = ow\.landed; RUN\.owedMoved = ow\.moved; RUN\.owedNew = ow\.owed; RUN\.owedExpired = owedRes\.expired; RUN\.owedWaiting = owedRes\.waiting;/.test(SRC));
  T('[6] the loop still writes the XP board only (no rating / points / CP)', !/LP_LB|lpBoardId|CP_LB|ratingId/.test(mb));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (consolation-owed) ===');
process.exit(failN === 0 ? 0 : 1);
