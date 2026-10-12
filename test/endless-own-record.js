'use strict';
// Q78 (cloud audit 2026-10): an endless co-op seat is charged (continue debit / team-comp resume fee), seeded (playtest
// starter wallet) or paired (co-op co-presence, which backs report verification) only on that player's OWN record for the
// run. End-to-end over the REAL validate.js main() against an offline stateless board stub (same harness as
// test/absence-grace.js): writes are logged, never applied, so every check reads the logged score writes.
//   [1] the frame: two owned accounts write a consistent 3P co-op settle pair (with / without a start pair) naming V at
//       seat 2 with 15 continues -- V is not charged, not paired; the writers carry `un`; the run summary counts it
//   [2] 4P: a throwaway at seat 2 and V at seat 3, 15 continues each (7.6M on the escalating ladder) -- nobody charged
//   [3] an honest quitter who wrote his start (level 1 began) and pressed continue twice is still charged 20 + 30
//   [4] all three settle, C pressed once: charged 20
//   [5] a named-only seat does not push a real member up the ladder (its nibble is masked out before the replay)
//   [6] playtest channel: the frame seeds V nothing; an honest quitter is seeded 60 and charged 50
//   [7] two frames + four reports against V: no co-op pair, no trust tier for V
//   [8] team competitive chain: the frame charges a named host no resume fee; an honest host pays 20
//   [9] the quitter's start rotates off its shard before the settle: charged where the start is remembered (Q69 tree),
//       a known under-charge on a tree without it (pinned either way)
//   [10] wiring pins
//   [11] mutation self-checks (the own-record gate / the ladder mask / the fee gate removed -> [1] / [5] / [8] go red)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-own-record-'));
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

const CP0 = 1000;
// recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard); cpHolders start at CP0
function world(recs, cpHolders, o) {
  o = o || {};
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: (cpHolders || []).map(s => ({ steamID: s, score: CP0 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: o.reports || [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] });
  if (!o.pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const PT_ENV = { PT_MODE: '1', APPID: '5049450' };
// three runs: first sighting, 10 minutes later, 3 hours later (recs2: what the shards hold from run 2 on)
function play(recs, cpHolders, o) {
  o = o || {};
  const out = [];
  const r1 = runCron(world(recs, cpHolders, o), o.files, o.env, o.script); out.push(r1);
  const r2 = runCron(world(o.recs2 || recs, cpHolders, o), advance(r1.state, 10 * 60000), o.env, o.script); out.push(r2);
  const r3 = runCron(world(o.recs2 || recs, cpHolders, o), advance(r2.state, 3 * 3600000), o.env, o.script); out.push(r3);
  return { runs: out, last: r3, all: out.map(r => r.out).join('\n'), posts: [].concat(...out.map(r => r.posts)), summary: out.map(r => r.summary).join('\n'), codes: out.map(r => r.code) };
}
const cpWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=8(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const lastCp = (p, sid) => { const w = cpWrites(p, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const trustWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=9(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body) && !/score=0(&|$)/.test(x.body));
const sig = (p) => p.last.state.SIGNALS_FILE || {};
const pairsWith = (p, sid, others) => others.filter(o => (sig(p).pairs || {})[v.pairKey(v.pid(o), v.pid(sid))]).length;
const playerRow = (p, sid) => (sig(p).players || {})[v.pid(sid)];
const summaryRow = (p) => { const m = /\| endless seats named by others only \/ CP not charged \| ([0-9]+) \/ ([0-9]+) \|/g; let a = 0, b = 0, x; while ((x = m.exec(p.summary))) { a += Number(x[1]); b += Number(x[2]); } return [a, b]; };
const allZero = (p) => p.codes.every(c => c === 0);

console.log('=== endless co-op charges / pairs only seats with their own record (Q78) ===');

// ---- [1] the frame ----
for (const withStarts of [false, true]) {
  const tag = withStarts ? '[1b] with a start pair' : '[1a] no start record at all';
  const A = SID(withStarts ? 111 : 101), B = SID(withStarts ? 112 : 102), V = SID(withStarts ? 113 : 103);
  const ros = [A, B, V], h = withStarts ? 0x7802 : 0x7801;
  const recs = [{ sid: A, d: settle7(h, 0, ros, 0xF00) }, { sid: B, d: settle7(h, 1, ros, 0xF00) }];
  if (withStarts) recs.push({ sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) });
  const p = play(recs, [V]);
  T(tag + ': all runs exit 0', allZero(p), p.last.out.slice(-800));
  T(tag + ': the run settles (the trio board is written for the writers)', /endless [^\n]*settle/.test(p.all) || p.posts.some(x => /leaderboardid=12(&|$)/.test(x.body)), p.all.slice(-1200));
  T(tag + ': V is not charged (no cp write for him)', cpWrites(p, V).length === 0, JSON.stringify(cpWrites(p, V)));
  T(tag + ': logged as named-only, not charged', /seat 2 [0-9a-f]+ 15 continues \(17477\) not charged -- never wrote an own record for this run \(Q78\)/.test(p.all));
  T(tag + ': V not paired with either writer', pairsWith(p, V, [A, B]) === 0);
  T(tag + ': the writers are still paired with each other', pairsWith(p, A, [B]) === 1);
  T(tag + ': V gets no signal row from it', !playerRow(p, V));
  T(tag + ': each writer carries the un signal once', ((playerRow(p, A) || {}).un | 0) === 1 && ((playerRow(p, B) || {}).un | 0) === 1, JSON.stringify([playerRow(p, A), playerRow(p, B)]));
  T(tag + ': run summary counts 1 seat / 17477 CP', JSON.stringify(summaryRow(p)) === JSON.stringify([1, 17477]), JSON.stringify(summaryRow(p)));
}

// ---- [2] 4P: two named-only seats at the top of the ladder ----
{
  const A = SID(121), B = SID(122), W = SID(123), V = SID(124);
  const ros = [A, B, W, V], h = 0x7803;
  const p = play([{ sid: A, d: settle7(h, 0, ros, 0xFF00) }, { sid: B, d: settle7(h, 1, ros, 0xFF00) }], [V]);
  T('[2] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[2] V (seat 3, 7.6M on the ladder) not charged', cpWrites(p, V).length === 0, JSON.stringify(cpWrites(p, V)));
  T('[2] the throwaway at seat 2 not charged', cpWrites(p, W).length === 0);
  T('[2] both logged with the full-ladder amount', /seat 3 [0-9a-f]+ 15 continues \(7652528\) not charged/.test(p.all) && /seat 2 [0-9a-f]+ 15 continues \(17477\) not charged/.test(p.all));
  T('[2] run summary counts 2 seats / 7670005 CP', JSON.stringify(summaryRow(p)) === JSON.stringify([2, 7670005]), JSON.stringify(summaryRow(p)));
}

// ---- [3] honest quitter: wrote his start, pressed continue twice, left ----
{
  const A = SID(131), B = SID(132), C = SID(133);
  const ros = [A, B, C], h = 0x7804;
  const p = play([{ sid: A, d: settle7(h, 0, ros, 0x200) }, { sid: B, d: settle7(h, 1, ros, 0x200) },
    { sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) }, { sid: C, d: start7(h, 2, ros) }], [C]);
  T('[3] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3] C charged 20 + 30 (1000 -> 950)', lastCp(p, C) === CP0 - 50, JSON.stringify(cpWrites(p, C)));
  T('[3] C paired with both writers (he was in the run)', pairsWith(p, C, [A, B]) === 2);
  T('[3] no named-only line, no un on the writers', !/\(Q78\)/.test(p.all) && ((playerRow(p, A) || {}).un | 0) === 0);
  T('[3] run summary counts nothing', JSON.stringify(summaryRow(p)) === JSON.stringify([0, 0]), JSON.stringify(summaryRow(p)));
}

// ---- [4] all three settle, C pressed once ----
{
  const A = SID(141), B = SID(142), C = SID(143);
  const ros = [A, B, C], h = 0x7805;
  const p = play([0, 1, 2].map(s => ({ sid: ros[s], d: settle7(h, s, ros, 0x100) })), [C]);
  T('[4] C charged 20 (1000 -> 980)', lastCp(p, C) === CP0 - 20, JSON.stringify(cpWrites(p, C)));
}

// ---- [5] a named-only seat does not push a real member up the ladder ----
{
  const A = SID(151), B = SID(152), W = SID(153), C = SID(154);
  const ros = [A, B, W, C], h = 0x7806;
  const p = play([{ sid: A, d: settle7(h, 0, ros, 0x1F00) }, { sid: B, d: settle7(h, 1, ros, 0x1F00) },
    { sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) }, { sid: C, d: start7(h, 3, ros) }], [C]);
  T('[5] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[5] C (own start, 1 continue after 15 forged ones at seat 2) charged the first rung 20, not rung 16', lastCp(p, C) === CP0 - 20, JSON.stringify(cpWrites(p, C)));
  T('[5] the forged seat is not charged', cpWrites(p, W).length === 0);
}

// ---- [6] playtest channel ----
{
  const A = SID(161), B = SID(162), V = SID(163);
  const ros = [A, B, V], h = 0x7807;
  const p = play([{ sid: A, d: settle7(h, 0, ros, 0xF00) }, { sid: B, d: settle7(h, 1, ros, 0xF00) }], [], { pt: true, env: PT_ENV });
  T('[6] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[6] the frame seeds V nothing and charges him nothing', cpWrites(p, V).length === 0, JSON.stringify(cpWrites(p, V)));
  T('[6] the writers are still seeded (their own records)', /pt starter cp [0-9a-f]+ = \+60/.test(p.all));
  const C1 = SID(164), C2 = SID(165), C = SID(166);
  const ros2 = [C1, C2, C], h2 = 0x7808;
  const q = play([{ sid: C1, d: settle7(h2, 0, ros2, 0x200) }, { sid: C2, d: settle7(h2, 1, ros2, 0x200) },
    { sid: C1, d: start7(h2, 0, ros2) }, { sid: C2, d: start7(h2, 1, ros2) }, { sid: C, d: start7(h2, 2, ros2) }], [], { pt: true, env: PT_ENV });
  T('[6] an honest quitter on the channel: seeded 60, charged 50 (-> 10)', lastCp(q, C) === 60 - 50, JSON.stringify(cpWrites(q, C)));
}

// ---- [7] two frames + four reports: no co-op pair, no trust tier ----
{
  const V = SID(171), ring = [SID(172), SID(173), SID(174), SID(175)];
  const r1 = [ring[0], ring[1], V], r2 = [ring[2], ring[3], V];
  const recs = [{ sid: ring[0], d: settle7(0x7809, 0, r1, 0) }, { sid: ring[1], d: settle7(0x7809, 1, r1, 0) },
    { sid: ring[2], d: settle7(0x780A, 0, r2, 0) }, { sid: ring[3], d: settle7(0x780A, 1, r2, 0) }];
  const vp = sidPair(V);
  const reports = ring.map(s => ({ steamID: s, score: 1, details: [0xB3, 1, vp[0], vp[1], 1, 77] }));
  const p = play(recs, [], { reports });
  T('[7] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[7] V paired with none of the four', pairsWith(p, V, ring) === 0);
  T('[7] no trust tier written for V', trustWrites(p, V).length === 0, JSON.stringify(trustWrites(p, V)));
}

// ---- [8] team competitive chain: the resume fee lands on the host only when he wrote his own record ----
function compChain(ros, writers, startsBy, base, script) {
  const h0 = base, h1 = base + 1;
  const segA = [], segB = [];
  for (const s of writers) segA.push({ sid: s, d: seg7(h0, ros.indexOf(s), ros, 0, 3, SEG_COMP | SEG_SUSPENDED) });
  for (const s of startsBy) segA.push({ sid: s, d: start7(h0, ros.indexOf(s), ros) });
  for (const s of writers) segB.push({ sid: s, d: seg7(h1, ros.indexOf(s), ros, 3, 4, SEG_COMP | SEG_RESUMED) });
  for (const s of startsBy) segB.push({ sid: s, d: start7(h1, ros.indexOf(s), ros) });
  const a1 = runCron(world(segA, [ros[0]]), null, null, script);
  const a2 = runCron(world(segA, [ros[0]]), advance(a1.state, 10 * 60000), null, script);
  const b1 = runCron(world(segA.concat(segB), [ros[0]]), advance(a2.state, 10 * 60000), null, script);
  const b2 = runCron(world(segA.concat(segB), [ros[0]]), advance(b1.state, 10 * 60000), null, script);
  const runs = [a1, a2, b1, b2];
  return { runs, last: b2, all: runs.map(r => r.out).join('\n'), posts: [].concat(...runs.map(r => r.posts)), summary: runs.map(r => r.summary).join('\n'), codes: runs.map(r => r.code) };
}
{
  const V = SID(181), A = SID(182), B = SID(183);
  const p = compChain([V, A, B], [A, B], [A, B], 0x7810);
  T('[8] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[8] both segments settle', (p.all.match(/endless-comp settle /g) || []).length === 2, (p.all.match(/endless-comp[^\n]*/g) || []).join(' | '));
  T('[8] the named host pays no resume fee', cpWrites(p, V).length === 0, JSON.stringify(cpWrites(p, V)));
  T('[8] logged', /host [0-9a-f]+ resume fee 20 not charged -- never wrote an own record for this run \(Q78\)/.test(p.all));
  const H = SID(184), D = SID(185), E = SID(186);
  const q = compChain([H, D, E], [H, D, E], [H, D, E], 0x7812);
  T('[8] an honest host pays the resume fee (1000 -> 980)', lastCp(q, H) === CP0 - 20, JSON.stringify(cpWrites(q, H)));
}

// ---- [9] the quitter's start rotates off its shard before the settle ----
{
  const A = SID(191), B = SID(192), C = SID(193);
  const ros = [A, B, C], h = 0x7814;
  const starts = [{ sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) }];
  const settles = [{ sid: A, d: settle7(h, 0, ros, 0x200) }, { sid: B, d: settle7(h, 1, ros, 0x200) }];
  const p = play(starts.concat([{ sid: C, d: start7(h, 2, ros) }]), [C], { recs2: starts.concat(settles) });
  const remembered = /function noteOwnStarts\(/.test(SRC);
  T('[9] all runs exit 0', allZero(p), p.last.out.slice(-800));
  if (remembered) T('[9] C charged on his remembered own start (1000 -> 950)', lastCp(p, C) === CP0 - 50, JSON.stringify(cpWrites(p, C)));
  else T('[9] no own-start memory on this tree: C goes uncharged (known residual, fixed by the Q69 cumulative start list)', cpWrites(p, C).length === 0, JSON.stringify(cpWrites(p, C)));
}

// ---- [10] wiring pins ----
{
  T('[10] own set built from the cumulative pending entry + this run\'s records and starts', /const ownE = endlessOwnSet\(startsPending\[c\.m\], c\.m, recs, starts\);/.test(SRC));
  T('[10] the own set reads both cumulative lists', /pend\.started[\s\S]{0,120}pend\.settled/.test(SRC.slice(SRC.indexOf('function endlessOwnSet('), SRC.indexOf('function endlessOwnSet(') + 1200)));
  T('[10] every endless signal call takes the own-record roster', (SRC.match(/recordEndlessSignals\(signals, ownRosterSids/g) || []).length === 3 && !/recordEndlessSignals\(signals, rosterSids/.test(SRC));
  T('[10] the ladder replay runs on the masked nibbles', /const debits = endlessDebits\(contOwn\);/.test(SRC) && /if \(!isOwnE\(roster0\[seatKey\]\)\) contOwn &= ~\(0xF << \(4 \* \(seatKey \| 0\)\)\);/.test(SRC));
  T('[10] the resume fee is gated on the host\'s own record', /if \(isOwnE\(host\)\) \{\s*cp\[host\] =/.test(SRC));
  T('[10] run summary row', /s\('endlessNamedOnly', 0\) \+ ' \/ ' \+ s\('endlessNamedOnlyCp', 0\)/.test(SRC));
}

// ---- [11] mutation self-checks ----
console.log('-- [11] mutation self-checks --');
{
  const frame = (script) => {
    const A = SID(201), B = SID(202), V = SID(203);
    const ros = [A, B, V], h = 0x7820;
    const p = play([{ sid: A, d: settle7(h, 0, ros, 0xF00) }, { sid: B, d: settle7(h, 1, ros, 0xF00) }], [V], { script });
    return cpWrites(p, V).length > 0 && pairsWith(p, V, [A, B]) > 0;
  };
  const ladder = (script) => {
    const A = SID(211), B = SID(212), W = SID(213), C = SID(214);
    const ros = [A, B, W, C], h = 0x7822;
    const p = play([{ sid: A, d: settle7(h, 0, ros, 0x1F00) }, { sid: B, d: settle7(h, 1, ros, 0x1F00) },
      { sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) }, { sid: C, d: start7(h, 3, ros) }], [C], { script });
    const c = lastCp(p, C);
    return c != null && c < CP0 - 20;
  };
  const fee = (script) => {
    const V = SID(221), A = SID(222), B = SID(223);
    const p = compChain([V, A, B], [A, B], [A, B], 0x7824, script);
    return cpWrites(p, V).length > 0;
  };
  const mutants = [
    ['own-record gate removed', 'const isOwnE = (sid) => ownE.has(pid(String(sid)));', 'const isOwnE = (sid) => true;', frame],
    ['ladder mask removed', 'if (!isOwnE(roster0[seatKey])) contOwn &= ~(0xF << (4 * (seatKey | 0)));', 'if (false) contOwn = 0;', ladder],
    ['resume fee gate removed', 'if (isOwnE(host)) {', 'if (true) {', fee],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-own-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[11] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
