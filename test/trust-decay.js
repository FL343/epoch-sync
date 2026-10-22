'use strict';
// Forgery flags age out of the trust tier (cloud audit Q98 / R1-B2-07): f used to only grow, and a player who keeps
// playing is never pruned, so three honest mishaps (each inconsistent group flags EVERY writer) kept him on tier 1 for
// good; a flagged group whose records stay on the shards also re-flagged everybody each time its 45-day dedup entry
// expired, so one honest mismatch of two casual players reached tier 1 by itself.
//   [1] flagsInWindow: 90-day window, boundary, unstamped flags count as current
//   [2] flagPlayer: one match flags a player once (no `at` refresh on a repeat), lifetime f, newest-first cap
//   [3] stampLegacyFlags: f written without stamps (before this change / by the old code during a rollback) is dated
//       to the run that first sees it, keeps counting 90 days from there, then ages out
//   [4] trustPlan: 3 flags -> tier 1, still 1 on day 89 of steady play, deleted on day 90; 8 -> 2 -> back to 1 -> 0
//   [5] recordFlag: a lingering group re-surfacing after flagged[m] expired adds no flag; an inactive player is still
//       pruned after 90 days (the re-surfacing used to refresh `at`)
//   [6] wiring pins: every write of f goes through flagPlayer; trustPlan reads flagsInWindow; main stamps after load
//   [7] REAL validate.js main() over an offline board stub (test/team2-lone-dissent.js harness):
//       a) one inconsistent group on the shards for 92 days (three runs 46 days apart) -> one flag each, no tier write
//       b) three flagged groups -> tier 1 written; 91 days of play later, no new flag -> every board entry deleted
//       c) a legacy f=3 row (no stamps) on tier 1: the first run stamps and persists it (tier kept), 91 days later deleted
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const DAY = 86400000, W = v.TRUST_F_WINDOW_MS;
const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const fresh = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} });
const recOf = (sid) => ({ steamID: sid, d: [], roster: {}, dispCode: 0 });
const T0 = 1800000000000;
const tierOf = (s, sid, now, onBoard) => {
  const plan = v.trustPlan(s, onBoard ? { [sid]: onBoard } : {}, new Set([sid]), now);
  const w = plan.writes.find(x => x.sid === sid);
  return w ? w.tier : (plan.deletes.indexOf(sid) >= 0 ? 0 : (onBoard || 0));
};
const settle = (s, now, sids) => v.recordMatchSignals(s, sids.map(recOf), sids.map((sid, i) => ({ steamID: sid, seat: i, score: 1000 - i })),
  Object.fromEntries(sids.map((sid, i) => [sid, i + 1])), 1, false, now);

console.log('=== trust decay (Q98: forgery flags count 90 days) ===');

{ // [1]
  T('[1] window is 90 days', W === 90 * DAY, String(W));
  const p = { f: 3, fx: 3, fm: { a: T0, b: T0 + DAY, c: T0 + 2 * DAY } };
  T('[1] all three inside the window', v.flagsInWindow(p, T0 + 2 * DAY) === 3);
  T('[1] 90 days minus 1 ms after the first: still 3', v.flagsInWindow(p, T0 + W - 1) === 3);
  T('[1] exactly 90 days after the first: that one is out (2)', v.flagsInWindow(p, T0 + W) === 2);
  T('[1] 90 days after the last: 0', v.flagsInWindow(p, T0 + 2 * DAY + W) === 0);
  T('[1] unstamped flags (f > fx) count as current', v.flagsInWindow({ f: 5, fx: 3, fm: { a: T0, b: T0, c: T0 } }, T0 + W + 1) === 2);
  T('[1] a legacy row without fm/fx counts f', v.flagsInWindow({ f: 3 }, T0) === 3);
  T('[1] no row / clean row: 0', v.flagsInWindow(undefined, T0) === 0 && v.flagsInWindow({ f: 0 }, T0) === 0);
  T('[1] a garbled stamp does not count', v.flagsInWindow({ f: 1, fx: 1, fm: { a: 'x' } }, T0) === 0);
}

{ // [2]
  const s = fresh(), h = v.pid(A);
  T('[2] first flag for a match: true', v.flagPlayer(s, h, 'm1', T0) === true);
  const p = s.players[h];
  T('[2] f=1, fx=1, fm={m1:T0}, at=T0', p.f === 1 && p.fx === 1 && JSON.stringify(p.fm) === JSON.stringify({ m1: T0 }) && p.at === T0, JSON.stringify(p));
  T('[2] the same match again: false, nothing moves (no at refresh)', v.flagPlayer(s, h, 'm1', T0 + 50 * DAY) === false && p.f === 1 && p.fm.m1 === T0 && p.at === T0, JSON.stringify(p));
  v.flagPlayer(s, h, 'm2', T0 + DAY);
  T('[2] another match: f=2', p.f === 2 && p.fx === 2 && p.fm.m2 === T0 + DAY);
  const s2 = fresh(), h2 = v.pid(B);
  const N = v.SIG_FLAG_KEYS_CAP + 5;
  for (let i = 0; i < N; i++) v.flagPlayer(s2, h2, 'k' + i, T0 + i * 60000);
  const p2 = s2.players[h2], ks = Object.keys(p2.fm);
  T('[2] cap: ' + v.SIG_FLAG_KEYS_CAP + ' stamps kept, lifetime f = ' + N, ks.length === v.SIG_FLAG_KEYS_CAP && p2.f === N && p2.fx === N, ks.length + ' / f=' + p2.f);
  T('[2] cap keeps the newest (k0..k4 evicted)', !('k0' in p2.fm) && !('k4' in p2.fm) && ('k5' in p2.fm) && (('k' + (N - 1)) in p2.fm));
  T('[2] cap >= the highest floor', v.SIG_FLAG_KEYS_CAP >= v.TRUST_T.F2);
}

{ // [3]
  const s = fresh(), h = v.pid(A);
  s.players[h] = { g: 4, w: 1, v: 0, f: 3, ns: 0, at: T0 };   // written before this change
  T('[3] legacy row: stamped -> true', v.stampLegacyFlags(s, T0 + DAY) === true);
  const p = s.players[h];
  T('[3] three ~ stamps at the run time, fx=3, f and at untouched', JSON.stringify(p.fm) === JSON.stringify({ '~0': T0 + DAY, '~1': T0 + DAY, '~2': T0 + DAY }) && p.fx === 3 && p.f === 3 && p.at === T0, JSON.stringify(p));
  T('[3] second pass: nothing to do', v.stampLegacyFlags(s, T0 + 2 * DAY) === false);
  T('[3] tier 1 kept until 90 days after the stamping run', tierOf(s, A, T0 + DAY + W - 1, 1) === 1);
  T('[3] ... and 0 from then on', tierOf(s, A, T0 + DAY + W, 1) === 0);
  p.f = 5;   // rollback: the old code added two flags without stamps
  T('[3] after a rollback the two new flags count right away', v.flagsInWindow(p, T0 + DAY + W) === 2);
  T('[3] the next new-code run dates them (~3, ~4)', v.stampLegacyFlags(s, T0 + 100 * DAY) === true && p.fm['~3'] === T0 + 100 * DAY && p.fm['~4'] === T0 + 100 * DAY && p.fx === 5);
  v.flagPlayer(s, h, 'm9', T0 + 101 * DAY);
  T('[3] a real flag after that: f=6, keyed by its match', p.f === 6 && p.fx === 6 && p.fm.m9 === T0 + 101 * DAY);
  const s2 = fresh(); s2.players[v.pid(B)] = { f: 2, at: T0 };
  T('[3] flagPlayer on a legacy row stamps the old ones too', v.flagPlayer(s2, v.pid(B), 'mx', T0 + 5 * DAY) && Object.keys(s2.players[v.pid(B)].fm).sort().join() === 'mx,~0,~1' && s2.players[v.pid(B)].fx === 3);
  const s3 = fresh(); s3.players[v.pid(C)] = { f: 0, at: T0 };
  T('[3] a clean row is left alone', v.stampLegacyFlags(s3, T0) === false && !('fm' in s3.players[v.pid(C)]));
}

{ // [4]
  const s = fresh();
  for (let k = 0; k < 3; k++) v.recordFlag(s, [recOf(A), recOf(C)], 'm4_' + k, T0 + k * 3600000);
  T('[4] 3 flags -> tier 1', tierOf(s, A, T0 + DAY, 0) === 1);
  for (let d = 1; d <= 91; d++) { const now = T0 + d * DAY; if (d % 7 === 0) settle(s, now, [A, B]); v.pruneSignals(s, now); }
  T('[4] steady play: day 89 still tier 1', tierOf(s, A, T0 + 89 * DAY, 1) === 1);
  T('[4] 90 days after the last flag: deleted from the board', tierOf(s, A, T0 + 2 * 3600000 + W, 1) === 0);
  T('[4] the lifetime count stays (f=3, record-only history)', s.players[v.pid(A)].f === 3);
  const s2 = fresh();
  for (let k = 0; k < 8; k++) v.recordFlag(s2, [recOf(B), recOf(C)], 'm4b_' + k, T0 + k * 10 * DAY);   // days 0..70
  T('[4] 8 flags inside 90 days -> tier 2', tierOf(s2, B, T0 + 71 * DAY, 0) === 2);
  T('[4] day 95: the first is out (7) -> tier 1', tierOf(s2, B, T0 + 95 * DAY, 2) === 1);
  T('[4] day 141: two left -> 0', tierOf(s2, B, T0 + 141 * DAY, 1) === 0);
}

{ // [5]
  const s = fresh(), g = [recOf(A), recOf(B)];
  for (let d = 0; d <= 100; d++) {
    const now = T0 + d * DAY;
    v.recordFlag(s, g, 'linger', now);
    if (d % 7 === 3) settle(s, now, [A, C]);
    v.pruneSignals(s, now);
  }
  T('[5] the group re-surfaced past its 45-day dedup twice, still one flag', (s.players[v.pid(A)] || {}).f === 1 && (s.players[v.pid(B)] || {}).f === 1);
  T('[5] tier 0 at day 100', tierOf(s, A, T0 + 100 * DAY, 0) === 0);
  const s2 = fresh();
  let gone91 = null;
  for (let d = 0; d <= 100; d++) {
    const now = T0 + d * DAY; v.recordFlag(s2, g, 'linger', now); v.pruneSignals(s2, now);
    if (d === 91) gone91 = !s2.players[v.pid(A)] && !s2.players[v.pid(B)];
  }
  T('[5] nobody plays: the re-surfacing group does not keep them alive (pruned on day 91)', gone91 === true);
  T('[5] ... the next re-surfacing makes a one-flag row again, never more', (s2.players[v.pid(A)] || {}).f === 1 && tierOf(s2, A, T0 + 100 * DAY, 0) === 0, JSON.stringify(s2.players[v.pid(A)]));
}

{ // [6]
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const fp = /\nfunction flagPlayer\(s, h, m, now\) \{[\s\S]*?\n\}\n/.exec(SRC);
  T('[6] flagPlayer found', !!fp);
  const rest = fp ? SRC.replace(fp[0], '\n') : SRC;
  const writes = rest.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.f\s*(\+\+|--|[-+*|]?=(?!=))/.test(l.replace(/\/\/.*$/, '')));
  T('[6] no other write of a player\'s f (every flag goes through flagPlayer)', writes.length === 0, writes.map(([n, l]) => n + ': ' + l.trim()).join(' | '));
  T('[6] trustPlan judges flagsInWindow, not the lifetime f', /trustTierOf\(flagsInWindow\(\(s\.players \|\| \{\}\)\[p\], now\), verifiedUniqueReporters\(s, sid, idx\),\s*hostDissentCount\(\(s\.t2lh \|\| \{\}\)\[p\], now/.test(SRC));
  //   (Q57 restack: the tier line takes a third argument, the team-gamble host charges; the first two stay pinned as they were;
  //   Q190 restack: the reporters count takes the SteamID and the run's index, as test/report-keys.js [8] pins it)
  // Q98 rework 2: B022's Q166 prunes the flagged map right after `let sigDirty = false;` (its own pin, test/flag-prune.js
  //   [0]); the stamp follows it. What matters here: right after loading the signals file, nothing between that could
  //   flag a player (only sigDirty and the Q166 prune, which drops map entries and counts nobody).
  const iLoad = SRC.indexOf('const signals = loadSignals();');
  const iStamp = SRC.indexOf('if (stampLegacyFlags(signals, Date.now())) sigDirty = true;');
  const between = iLoad >= 0 && iStamp > iLoad ? SRC.slice(iLoad + 'const signals = loadSignals();'.length, iStamp).split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean) : null;
  T('[6] main stamps right after loading the signals file (only the Q166 prune between) and marks it dirty',
    !!between && between.every((l) => l === 'let sigDirty = false;' || /\bprunedF\b/.test(l)) && between.includes('let sigDirty = false;'),
    JSON.stringify(between));
}

// ---- [7] the real main() ----
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC7 = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC7.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
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
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-decay-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0', SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// `ms` of casual play between two runs: every stored timestamp moves back by ms; both players settled something
//   lately (a settle refreshes at); other players' settles made a run in between save the file (every save prunes)
function between(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const sg = files.SIGNALS_FILE, now = Date.now();
  if (sg) {
    for (const p of Object.values(sg.players || {})) { for (const k of Object.keys(p.fm || {})) p.fm[k] -= ms; if (p.bz) p.bz -= ms; p.at = now - DAY; }
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
    for (const k of Object.keys(sg.pairs || {})) sg.pairs[k].at -= ms;
    v.pruneSignals(sg, now);
  }
  for (const pk of Object.values(files.STARTS_FILE || {})) { if (pk && pk.t0) pk.t0 -= ms; }
  return files;
}
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a friends'-room 3P settle record (type 10); each seat's copy disagrees on its own score (seat s adds 1 to seat s's score).
//   Three writers who disagree are flagged once each. Two voices no longer are -- a quick / ranked 1V1 (this fixture first,
//   Q289, test/pair-dispute-1v1.js), a friends' room of two (this fixture next, Q291, test/two-voice-dispute.js) -- so this
//   fixture is a friends' room of three now; the flag bookkeeping it tests is the same
function mm(hash, seat) {
  const sc = [9000, 4000, 3000]; if (seat) sc[seat] += 1;
  const d = [0xB1, 3, 10, hash | 0, 1234, seat, seat + 1, (6 << 1) | (seat === 0 ? 1 : 0), 3, 720].concat(sc, [0]);
  for (const s of [A, B, C]) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
function boardsWith(recs, trust) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [{ steamID: A, score: 2000 }, { steamID: B, score: 2000 }, { steamID: C, score: 2000 }] }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 9, name: 'trust_tier', entries: Object.keys(trust || {}).map(sid => ({ steamID: sid, score: trust[sid] })) });
  return boards;
}
const flaggedTrio = (hash) => [{ sid: A, d: mm(hash, 0) }, { sid: B, d: mm(hash, 1) }, { sid: C, d: mm(hash, 2) }];
const trustWrites = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=9(&|$)/.test(p.body)).map(p => /steamid=([0-9]+)/.exec(p.body)[1] + '=' + /score=(-?[0-9]+)/.exec(p.body)[1]).sort();
const trustDeletes = (r) => r.posts.filter(p => /DeleteLeaderboardScore/.test(p.url) && /leaderboardid=9(&|$)/.test(p.body)).map(p => /steamid=([0-9]+)/.exec(p.body)[1]).sort();
const rowOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {});
const ABC = [A, B, C].sort().join(' ');
{ // [7a]
  const recs = flaggedTrio(0x7A01);
  const r1 = runCron(boardsWith(recs), {});
  const r2 = runCron(boardsWith(recs), between(r1.state, 46 * DAY));
  const r3 = runCron(boardsWith(recs), between(r2.state, 46 * DAY));
  T('[7a] three runs exit 0', r1.code === 0 && r2.code === 0 && r3.code === 0, [r1.code, r2.code, r3.code].join('/') + ' ' + r3.out.slice(-300));
  T('[7a] first run: one flag each, keyed by the match', [A, B, C].every((s) => rowOf(r1, s).f === 1) && Object.keys(rowOf(r1, A).fm || {}).length === 1);
  T('[7a] 92 days of the same records on the shards: still one flag each', [A, B, C].every((s) => rowOf(r3, s).f === 1), [A, B, C].map((s) => rowOf(r3, s).f).join('/'));
  T('[7a] no trust write on any run', trustWrites(r1).length + trustWrites(r2).length + trustWrites(r3).length === 0, trustWrites(r3).join(' '));
}
{ // [7b]
  const recs = [].concat(flaggedTrio(0x7B01), flaggedTrio(0x7B02), flaggedTrio(0x7B03));
  const r1 = runCron(boardsWith(recs), {});
  T('[7b] three flagged matches -> tier 1 written for all three', trustWrites(r1).join(' ') === [A + '=1', B + '=1', C + '=1'].sort().join(' '), trustWrites(r1).join(' ') + ' ' + r1.out.slice(-300));
  const r2 = runCron(boardsWith([], { [A]: 1, [B]: 1, [C]: 1 }), between(r1.state, 89 * DAY));
  T('[7b] day 89, still playing: nothing changes', r2.code === 0 && trustWrites(r2).length === 0 && trustDeletes(r2).length === 0, trustDeletes(r2).join(' '));
  const r3 = runCron(boardsWith([], { [A]: 1, [B]: 1, [C]: 1 }), between(r1.state, 91 * DAY));
  T('[7b] day 91, still playing, no new flag: every entry deleted', r3.code === 0 && trustDeletes(r3).join(' ') === ABC, 'deletes [' + trustDeletes(r3).join(' ') + '] ' + r3.out.slice(-300));
  T('[7b] the lifetime count is kept (f=3)', rowOf(r3, A).f === 3);
}
{ // [7c]
  const legacy = { day: { d: 0, n: {} }, players: { [v.pid(A)]: { g: 9, w: 3, v: 0, f: 3, ns: 0, disp: [9, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now() - DAY } }, pairs: {}, flagged: {}, rep: {}, rseen: {} };
  const r1 = runCron(boardsWith([], { [A]: 1 }), { SIGNALS_FILE: legacy });
  const p = rowOf(r1, A);
  T('[7c] a legacy f=3 row: the run stamps it and writes the file (fx=3, three ~ keys)', r1.code === 0 && p.fx === 3 && Object.keys(p.fm || {}).sort().join() === '~0,~1,~2', JSON.stringify(p) + ' ' + r1.out.slice(-300));
  T('[7c] ... and keeps tier 1 (no write, no delete)', trustWrites(r1).length === 0 && trustDeletes(r1).length === 0);
  const r2 = runCron(boardsWith([], { [A]: 1 }), between(r1.state, 91 * DAY));
  T('[7c] 91 days later, still playing: deleted', r2.code === 0 && trustDeletes(r2).join(' ') === A, trustDeletes(r2).join(' '));
}

console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== trust-decay: ALL PASS ===');
process.exit(failN ? 1 : 0);
