'use strict';
// Q418 (cloud audit, mail M825 (3), 2026-11-19): a team competitive / team classic segment whose writers all wrote the same
// depth tail and differ only in the seat scores. A checkpoint segment is written the moment the level-end verdict frame
// lands, from each client's own seat table (the frame carried the team total only; a joiner's table is realigned at the next
// shop), so a joiner one payment behind at that instant writes one teammate's score a little low while the tail is the
// team's. Live: a quad run, segment 10->15, one record 200 short on one seat, the next ten segments agreeing 4 / 4 and
// waiting behind it in chain-gap until CHAIN_WAIT_MS rejected them all -- the whole rest of the run lost for four players.
// The fix: the segment stays held (Q317 / Q291: not settled, nobody flagged), and the run's chain moves past it when the
// shared tail passes what a settle of it checks (roster, seedcap veto, chain plan, reroll / perk chains, the pacing floor,
// one match at a time). Nothing of the segment's own is credited; the key is not processed.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (the harness of
// test/team-comp-ghost-xp.js): writes are logged, never applied -- every run reads XP 0, so a member's XP total is the sum of
// each run's last progress write; state carries between runs ten minutes apart.
//   [1] seatOnlyDispute unit (every shape it takes and refuses)
//   [2] the live shape (quad, [10,15] one seat 200 short on one record): the rest of the run settles, the held segment
//       credits nothing, nobody flagged, passed once
//   [3] what it was: the same run on the old rule (the pass call removed) -- every later segment waits, then is rejected
//   [4] controls held as before: tails differ (the second M825 run's shape), a seat wrote nothing, a resumed segment, a
//       reroll bitmap a settle would reject; a segment whose chain is not there yet passes once its predecessor settles; two
//       held segments next to each other pass in one run (shallowest first)
//   [5] no faster than playing: every segment of a run written at once (a fabricated batch) settles no earlier than the same
//       run with every record agreeing
//   [6] other shapes: team classic trio, team competitive duo (pair dispute), a held save & quit (its save point registered,
//       the resume consumes it), a team classic resume held as before
//   [7] run summary row; wiring pins
//   [8] mutation self-checks
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/team-comp-ghost-xp.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

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
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
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

function runCron(boards, files, script, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-only-chain-'));
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
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock (pre-season: no season twin boards needed)
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
    }, stateEnv, extraEnv || {});
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
const SEED = 9;
const keyOf = (h) => (h | 0) + '_' + SEED + '_7';
const { SEG_SUSPENDED, SEG_FINAL, SEG_RESUMED, SEG_COMP, SEG_CLASSIC, SEG_CASUAL, SEG_COUCH } = attest;
const SCORES = [49325, 30000, 20000, 10000];
// result-reporter wire form (endless, match type 7): 10 header + pc scores + disp + 2pc roster + the 11-int tail a live
//   writer carries (startDepth, endDepth, continues, tokens, season, flags, build, picksLo, picksHi, rerollLo, rerollHi);
//   o = { scores, dur, tail: {i: value} } overrides one writer's own record
function rec7(hash, seat, ros, sd, ed, flags, o) {
  const pc = ros.length, sc = (o && o.scores) || SCORES.slice(0, pc);
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, pc, (o && o.dur != null) ? o.dur : 475];
  for (let i = 0; i < pc; i++) d.push(sc[i] | 0);
  d.push((o && o.disp) | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  const tail = [sd | 0, ed | 0, 0, 0, 0, flags | 0, 0, 0, 0, 0, 0];
  if (o && o.tail) for (const i of Object.keys(o.tail)) tail[i | 0] = o.tail[i] | 0;
  return d.concat(tail);
}
function start7(hash, seat, ros) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// one segment key: every member's start, then the settle record of every writer (default: all); odd = { seat: overrides }
//   for that seat's own record; base = the lane flag (SEG_COMP by default)
function seg(hash, ros, sd, ed, flags, odd, writers, base) {
  const w = writers || ros, lane = base == null ? SEG_COMP : base;
  return ros.map((sid, i) => ({ sid, d: start7(hash, i, ros) }))
    .concat(ros.map((sid, i) => ({ sid, d: rec7(hash, i, ros, sd, ed, lane | (flags | 0), odd && odd[i]) })).filter((r) => w.indexOf(r.sid) >= 0));
}
// seat 3's own record writes seat 2's money 200 short (the live M825 shape)
const SHORT = { 3: { scores: [49325, 30000, 19800, 10000], dur: 480 } };
const BOARD = { progress: 5, cp: 8, duo: 15, trio: 11, quad: 12, compDuo: 16, compTrio: 13, compQuad: 17, classicDuo: 18, classicTrio: 19, classicQuad: 20 };
const CP0 = 1000;
function world(rows, cpHolders) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of rows) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: BOARD.cp, name: 'cp_bank', entries: (cpHolders || []).map(s => ({ steamID: s, score: CP0 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compQuad, name: 'endless_comp_quad', entries: [] },
    { id: BOARD.classicDuo, name: 'endless_classic_duo', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] }, { id: BOARD.classicQuad, name: 'endless_classic_quad', entries: [] });
  return boards;
}
// steps: what the shards hold at each run (each list carries everything still on the boards), ten minutes apart
function timeline(steps, cpHolders, script, env) {
  const runs = [];
  let state = null;
  steps.forEach((rows) => {
    const r = runCron(world(rows, cpHolders), state ? advance(state, 10 * 60000) : null, script, env);
    runs.push(r); state = r.state;
  });
  return { runs, last: runs[runs.length - 1], all: runs.map(r => r.out).join('\n'), codes: runs.map(r => r.code) };
}
// a run played the usual way: segment i lands at step i+1 and stays; `extra` more steps at the end
const played = (segs, extra) => { const out = []; let acc = []; for (const s of segs) { acc = acc.concat(s); out.push(acc); } for (let i = 0; i < (extra | 0); i++) out.push(acc); return out; };
const allZero = (p) => p.codes.every(c => c === 0);
const writesIn = (r, boardId, sid) => r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const scoreOf = (w) => { const m = /score=(-?[0-9]+)/.exec(w.body); return m ? Number(m[1]) : null; };
const xpOf = (p, sid) => p.runs.reduce((a, r) => { const w = writesIn(r, BOARD.progress, sid); return a + (w.length ? scoreOf(w[w.length - 1]) : 0); }, 0);
const ladderOf = (p, boardId, sid) => p.runs.reduce((a, r) => writesIn(r, boardId, sid).reduce((b, w) => Math.max(b, Math.floor(scoreOf(w) / 10000)), a), 0);
const runOf = (p, ros, season) => ((p.last.state.SOLO_FILE || {}).runs || {})[v.teamRunKey(ros, season | 0, SEED)] || null;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const flagsOf = (p, sid) => ((((p.last.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const XP = (depths) => 9 * depths;   // ENDLESS_XP.perDepth, no boost at these levels
const lines = (p, re) => (p.all.match(re) || []).length;
const settledAt = (p, m) => p.runs.findIndex((r) => processedOf(r).has(m));   // first run (0-based) that processed the key, -1 never
// the run that passed the held segment writes "1 / 0" in the Q418 row; every run after it "0 / 0" (a later run finds run.so)
const summaryAfterPass = (p) => { const rows = p.runs.map((r) => (r.summary.match(/\(Q418\) \| ([0-9]+) \/ ([0-9]+) \|/) || []).slice(1).join('/')); const i = rows.indexOf('1/0'); return i >= 0 && rows.slice(i + 1).every((x) => x === '0/0') && i < rows.length - 1; };
const QUAD = (n) => [SID(n), SID(n + 1), SID(n + 2), SID(n + 3)];
const PASS_RE = /seat-only [^\n]*differ only in the seat scores -- the run's chain moves past it/g;

// ---- [1] unit ----
console.log('-- [1] seatOnlyDispute --');
{
  T('[1] exported', typeof v.seatOnlyDispute === 'function' && v.SEAT_ONLY_TAIL_MAX === 11);
  const ros = QUAD(1);
  const recs = (sd, ed, flags, odd, writers, base) => seg(0x1001, ros, sd, ed, flags, odd, writers, base).filter((r) => r.d[0] === 0xB1).map((r) => ({ steamID: r.sid, d: r.d, roster: Object.fromEntries(ros.map((s, i) => [i, s])) }));
  const so = v.seatOnlyDispute(recs(10, 15, 0, SHORT));
  T('[1] the live shape: team competitive, four writers, one seat short on one record -> taken', so && so.lane === 'comp' && so.pc === 4 && so.writers.length === 4 && so.t.startDepth === 10 && so.t.endDepth === 15, JSON.stringify(so && { lane: so.lane, pc: so.pc }));
  T('[1] every record agrees (a consistent group) -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, null)) === null);
  T('[1] the depth tail differs ([10,14] on one record, the second M825 run) -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, { 3: { scores: [1, 2, 3, 4], tail: { 1: 14 } } })) === null);
  for (const [i, nm] of [[2, 'continues'], [4, 'season'], [5, 'flags'], [6, 'perk build'], [7, 'pick log lo'], [8, 'pick log hi'], [9, 'reroll bitmap lo'], [10, 'reroll bitmap hi']]) {
    T('[1] one record\'s ' + nm + ' differs (tail int ' + (i + 1) + ') -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, { 3: { scores: [49325, 30000, 19800, 10000], tail: { [i]: i === 5 ? (SEG_COMP | SEG_FINAL) : 1 } } })) === null);
  }
  const twelve = recs(10, 15, 0, SHORT).map((r, i) => Object.assign({}, r, { d: r.d.concat([i === 0 ? 77 : 0]) }));
  T('[1] the 12th tail int (a resume tag, outside the vector) may differ', !!v.seatOnlyDispute(twelve));
  T('[1] a seat wrote nothing (three of four) -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, SHORT, ros.slice(1))) === null);
  T('[1] a resumed segment -> not this shape (consumes a save point, owes the host\'s fee)', v.seatOnlyDispute(recs(10, 15, SEG_RESUMED, SHORT)) === null);
  T('[1] a suspended (save & quit) segment -> taken (its save point is the chain\'s)', !!v.seatOnlyDispute(recs(10, 12, SEG_SUSPENDED, SHORT)));
  T('[1] the run\'s FINAL segment -> taken', !!v.seatOnlyDispute(recs(10, 12, SEG_FINAL, SHORT)));
  T('[1] team classic -> taken as classic', (v.seatOnlyDispute(recs(10, 15, 0, SHORT, null, SEG_CLASSIC)) || {}).lane === 'classic');
  T('[1] casual co-op (no chain) -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, SHORT, null, 0)) === null && v.seatOnlyDispute(recs(10, 15, 0, SHORT, null, SEG_CASUAL)) === null);
  T('[1] competitive and classic at once / couch -> not this shape', v.seatOnlyDispute(recs(10, 15, 0, SHORT, null, SEG_COMP | SEG_CLASSIC)) === null && v.seatOnlyDispute(recs(10, 15, SEG_COUCH, SHORT)) === null);
  T('[1] an all-zero tail (a cold rejoiner\'s abstention on every record) -> not this shape', v.seatOnlyDispute(recs(0, 0, 0, SHORT).map((r) => { const d = r.d.slice(); const at = 11 + 12; for (let i = at; i < d.length; i++) d[i] = 0; return Object.assign({}, r, { d }); })) === null);
  T('[1] a writer\'s own negative duration -> not this shape (Q317 flags him alone)', v.seatOnlyDispute(recs(10, 15, 0, { 3: { scores: [49325, 30000, 19800, 10000], dur: -5 } })) === null);
  const two = recs(10, 15, 0, SHORT);
  T('[1] a writer\'s two different records -> not this shape; two copies of one record -> taken',
    v.seatOnlyDispute(two.concat([Object.assign({}, two[3], { d: rec7(0x1001, 3, ros, 10, 15, SEG_COMP, { scores: [1, 1, 1, 1] }) })])) === null
    && !!v.seatOnlyDispute(two.concat([Object.assign({}, two[3])])));
  T('[1] a seat count that differs between records -> not this shape', v.seatOnlyDispute(two.slice(0, 3).concat([{ steamID: ros[3], d: rec7(0x1001, 3, ros.concat([SID(99)]), 10, 15, SEG_COMP), roster: two[3].roster }])) === null);
  const duo = seg(0x1002, ros.slice(0, 2), 5, 10, 0, { 1: { scores: [49325, 29900] } }).filter((r) => r.d[0] === 0xB1).map((r) => ({ steamID: r.sid, d: r.d, roster: { 0: ros[0], 1: ros[1] } }));
  T('[1] a duo (two voices) -> taken', (v.seatOnlyDispute(duo) || {}).pc === 2);
  T('[1] a short tail (no flags int) / a non-endless record / nothing -> not this shape',
    v.seatOnlyDispute(two.map((r) => Object.assign({}, r, { d: r.d.slice(0, 11 + 12 + 5) }))) === null
    && v.seatOnlyDispute(two.map((r) => Object.assign({}, r, { d: [r.d[0], r.d[1], 1].concat(r.d.slice(3)) }))) === null
    && v.seatOnlyDispute([]) === null && v.seatOnlyDispute(null) === null);
}

// ---- [2] the live shape ----
// quad competitive run: [0,5] [5,10] agree; [10,15] seat 3's own record writes seat 2 200 short; [15,20] [20,25] agree, [25,27] FINAL
console.log('-- [2] the live shape: a quad run, [10,15] one seat 200 short on one record --');
function caseLive(script, env, extra) {
  const ros = QUAD(10), h = 0x2400;
  const segs = [seg(h, ros, 0, 5), seg(h + 1, ros, 5, 10), seg(h + 2, ros, 10, 15, 0, SHORT), seg(h + 3, ros, 15, 20), seg(h + 4, ros, 20, 25), seg(h + 5, ros, 25, 27, SEG_FINAL)];
  const p = timeline(played(segs, extra == null ? 2 : extra), ros, script, env);
  return { p, ros, m: [0, 1, 2, 3, 4, 5].map((i) => keyOf(h + i)) };
}
const c2 = caseLive();
{
  const { p, ros, m } = c2;
  T('[2] every run exits 0', allZero(p), p.codes.join(','));
  T('[2] the five agreeing segments settle; the held one is never processed', [0, 1, 3, 4, 5].every((i) => processedOf(p.last).has(m[i])) && !processedOf(p.last).has(m[2]),
    m.map((k) => processedOf(p.last).has(k) ? 1 : 0).join(''));
  T('[2] the held segment is never settled (no settle / catch-up line for it), Q317 holds it on every run that reads it', !new RegExp('endless-comp (settle|catch-up) ' + m[2]).test(p.all) && lines(p, new RegExp('endless-dispute ' + m[2] + '[^\\n]*\\(Q317\\)', 'g')) === p.runs.length - 2);
  T('[2] the chain moved past it exactly once (Q418 line)', lines(p, PASS_RE) === 1, (p.all.match(/seat-only [^\n]*/g) || []).join(' | '));
  const run = runOf(p, ros);
  T('[2] chain head 27, FINAL, the held key remembered as passed', run && run.max === 27 && run.final === 1 && Array.isArray(run.so) && run.so.indexOf(m[2]) >= 0, JSON.stringify(run && { max: run.max, final: run.final, so: run.so }));
  T('[2] XP: 0->10 and 15->27 for every member (the held 10->15 not credited) = ' + XP(22), ros.every((s) => xpOf(p, s) === XP(22)), ros.map((s) => xpOf(p, s)).join(','));
  T('[2] the XP floors never cover the held depths for anyone who did not get them (each floor = 27 after the FINAL, set by the later settles only)',
    run && ros.every((s) => ((run.xf || {})[v.pid(s)] | 0) === 27));
  T('[2] ladder depth 27 for all four on the quad competitive board', ros.every((s) => ladderOf(p, BOARD.compQuad, s) === 27), ros.map((s) => ladderOf(p, BOARD.compQuad, s)).join(','));
  T('[2] nobody flagged', ros.every((s) => flagsOf(p, s) === 0), ros.map((s) => flagsOf(p, s)).join(','));
  T('[2] no chain reject, no waiting segment left', !/team comp segment chain REJECT/.test(p.all) && Object.keys((p.last.state.SOLO_FILE || {}).wait || {}).length === 0);
  T('[2] run summary: one pass; on every later run nothing passed and nothing held for a check (the pass is remembered)', summaryAfterPass(p), p.runs.map((r) => (r.summary.match(/\(Q418\) \| [^\n]*/) || ['-'])[0]).join(' ; '));
}

// ---- [3] what it was ----
console.log('-- [3] the old rule: every later segment waits, then is rejected --');
const PASS_CALL = "  for (const so of seatOnlyCands) { const r418 = seatOnlyPass(so); if (r418 !== 'passed' && r418 !== 'done') RUN.seatOnlyHeld = (RUN.seatOnlyHeld | 0) + 1; }\n";
// from / to: one anchor and its replacement, or arrays of them (every anchor must be found exactly once)
function withMutant(from, to, fn) {
  const fr = Array.isArray(from) ? from : [from], tt = Array.isArray(to) ? to : [to];
  if (fr.some((a) => SRC.split(a).length !== 2)) return { anchor: false };
  const script = path.join(__dirname, '..', '.mutant-seat-only-chain-' + process.pid + '.js');
  try { fs.writeFileSync(script, fr.reduce((acc, a, i) => acc.replace(a, tt[i]), SRC)); return { anchor: true, out: fn(script) }; }
  finally { try { fs.unlinkSync(script); } catch (e) {} }
}
{
  const old = withMutant(PASS_CALL, '', (s) => caseLive(s, { COMP_CHAIN_WAIT_MS: String(45 * 60000) }, 6));
  T('[3] anchor found', old.anchor);
  if (old.anchor) {
    const { p, m } = old.out;
    T('[3] old rule: the segments behind the held one wait in chain-gap, then are rejected (chain wait shortened to 45 min here)',
      /waiting for its chain \(chain-gap\)/.test(p.all) && [3, 4, 5].every((i) => new RegExp('team comp segment chain REJECT \\(chain-gap\\) depth').test(p.all) && processedOf(p.last).has(m[i])) && !new RegExp('endless-comp settle ' + m[3]).test(p.all));
    T('[3] old rule: the four members get 0->10 only = ' + XP(10) + ', ladder 10', c2.ros.every((s) => xpOf(p, s) === XP(10) && ladderOf(p, BOARD.compQuad, s) === 10), c2.ros.map((s) => xpOf(p, s)).join(','));
  }
  const now = caseLive(null, { COMP_CHAIN_WAIT_MS: String(45 * 60000) }, 6);
  T('[3] the fix under the same short chain wait: nothing rejected, XP ' + XP(22), !/chain REJECT/.test(now.p.all) && c2.ros.every((s) => xpOf(now.p, s) === XP(22)));
}

// ---- [4] controls: held as before ----
console.log('-- [4] controls --');
function caseShape(h, odd, flags, writers, script) {
  const ros = QUAD(h & 0xff), segs = [seg(h, ros, 0, 5), seg(h + 1, ros, 5, 10), seg(h + 2, ros, 10, 15, flags, odd, writers), seg(h + 3, ros, 15, 20)];
  const p = timeline(played(segs, 2), ros, script);
  return { p, ros, m: [0, 1, 2, 3].map((i) => keyOf(h + i)) };
}
{
  const a = caseShape(0x2520, { 3: { scores: [1, 2, 3, 4], tail: { 1: 14 } } });
  T('[4] tails differ (one record [10,14], the second M825 run): held, nothing passed, the next segment waits', lines(a.p, PASS_RE) === 0 && !processedOf(a.p.last).has(a.m[3]) && /15->20 waiting for its chain \(chain-gap\)/.test(a.p.all) && a.ros.every((s) => flagsOf(a.p, s) === 0));
  const b = caseShape(0x2530, { 2: { scores: [49325, 30000, 19800, 10000] } }, 0, QUAD(0x30).slice(0, 3));
  T('[4] a seat wrote nothing for the held segment: held as before, nothing passed', lines(b.p, PASS_RE) === 0 && !processedOf(b.p.last).has(b.m[3]));
  // a resumed segment: [0,5] [5,8 suspended] [8,13 resumed, one seat short] [13,18]
  const ros = QUAD(0x40), h = 0x2540;
  const segs = [seg(h, ros, 0, 5), seg(h + 1, ros, 5, 8, SEG_SUSPENDED), seg(h + 2, ros, 8, 13, SEG_RESUMED, SHORT), seg(h + 3, ros, 13, 18)];
  const c = timeline(played(segs, 2), ros);
  T('[4] a resumed segment differing on a seat: held as before (the save point stays unconsumed), nothing passed',
    lines(c, PASS_RE) === 0 && !processedOf(c.last).has(keyOf(h + 3)) && ((((runOf(c, ros) || {}).saves || {})['8'] || {}).by == null));
  // the held segment and its predecessor land together: the pass waits for the chain, then passes
  const ros2 = QUAD(0x50), h2 = 0x2550;
  const s0 = seg(h2, ros2, 0, 5), s1 = seg(h2 + 1, ros2, 5, 10), s2 = seg(h2 + 2, ros2, 10, 15, 0, SHORT), s3 = seg(h2 + 3, ros2, 15, 20);
  const d = timeline([s0, s0.concat(s1, s2), s0.concat(s1, s2), s0.concat(s1, s2, s3), s0.concat(s1, s2, s3), s0.concat(s1, s2, s3)], ros2);
  T('[4] the held segment seen before its predecessor settled: waits (chain-gap) and passes once the chain reaches it',
    /seat-only [^\n]*waiting \(chain-gap\)/.test(d.all) && lines(d, PASS_RE) === 1 && processedOf(d.last).has(keyOf(h2 + 3)), (d.all.match(/seat-only [^\n]*/g) || []).join(' | '));
  // a reroll bit at a target the segment could not have asked about: held, nothing passed (the reroll chain a settle checks)
  const e = caseShape(0x2560, { 0: { scores: SCORES, tail: { 9: 1 << 10 } }, 1: { scores: SCORES, tail: { 9: 1 << 10 } }, 2: { scores: SCORES, tail: { 9: 1 << 10 } }, 3: { scores: [49325, 30000, 19800, 10000], tail: { 9: 1 << 10 } } });
  T('[4] a reroll bitmap a settle would reject: not passed', lines(e.p, PASS_RE) === 0 && /seat-only [^\n]*reroll chain \(reroll-ahead\)/.test(e.p.all) && !processedOf(e.p.last).has(e.m[3]));
}

// two held segments next to each other land in one run (the deeper one first on the shards, under the smaller key):
//   both pass in the next run, shallowest first, and the segment behind them settles in that same run
function caseTwoHeld(script) {
  const ros = QUAD(0xB0), h = 0x2B00;
  const s0 = seg(h + 10, ros, 0, 5), s1 = seg(h + 11, ros, 5, 10), s2 = seg(h + 12, ros, 10, 15, 0, SHORT), s3 = seg(h + 1, ros, 15, 20, 0, { 1: { scores: [49325, 29900, 20000, 10000] } }), s4 = seg(h + 14, ros, 20, 25);
  const late = s0.concat(s1, s3, s2, s4);
  const p = timeline([s0, s0.concat(s1), s0.concat(s1), late, late, late], ros, script);
  return { p, ros, m: [keyOf(h + 12), keyOf(h + 1), keyOf(h + 14)] };
}
{
  const c = caseTwoHeld();
  const passRuns = c.p.runs.map((r, i) => ((r.out.match(PASS_RE) || []).length ? i + ':' + (r.out.match(PASS_RE) || []).length : null)).filter(Boolean);
  T('[4] two held segments next to each other: both pass in one run, the segment behind them settles in that run', allZero(c.p) && passRuns.length === 1 && /:2$/.test(passRuns[0])
    && settledAt(c.p, c.m[2]) === Number(passRuns[0].split(':')[0]) && (runOf(c.p, c.ros) || {}).max === 25, passRuns.join(',') + ' settled ' + settledAt(c.p, c.m[2]));
}

// ---- [5] no faster than playing ----
console.log('-- [5] a whole run written at once --');
function caseBatch(odd, script) {
  const ros = QUAD(0x60), h = 0x2600, segs = [];
  for (let i = 0; i < 9; i++) segs.push(seg(h + i, ros, 5 * i, 5 * i + 5, 0, i === 2 ? odd : null));
  const all = [].concat(...segs);
  const p = timeline([all, all, all, all, all, all], ros, script);
  return { p, ros, m: segs.map((s, i) => keyOf(h + i)) };
}
{
  const fix = caseBatch(SHORT), ctl = caseBatch(null);
  const at = (c) => c.m.map((k) => settledAt(c.p, k));
  const af = at(fix), ac = at(ctl);
  T('[5] every agreeing segment settles no earlier than with every record agreeing (no depth faster than playing it)',
    af.every((x, i) => i === 2 || (x >= 0 && x >= ac[i])) && ac[8] >= 0, 'fix ' + af.join(',') + ' / all agree ' + ac.join(','));
  T('[5] and the run still settles to the end (head 45)', (runOf(fix.p, fix.ros) || {}).max === 45, JSON.stringify((runOf(fix.p, fix.ros) || {}).max));
}

// ---- [6] other shapes ----
console.log('-- [6] team classic trio, competitive duo, a held save & quit, a classic resume --');
{
  const ros = QUAD(0x70).slice(0, 3), h = 0x2700;
  const odd = { 2: { scores: [49325, 29800, 20000] } };
  const segs = [seg(h, ros, 0, 5, 0, null, null, SEG_CLASSIC), seg(h + 1, ros, 5, 10, 0, odd, null, SEG_CLASSIC), seg(h + 2, ros, 10, 15, 0, null, null, SEG_CLASSIC)];
  const p = timeline(played(segs, 2), ros);
  T('[6] team classic trio: the held [5,10] passes, [10,15] settles; XP 0->5 and 10->15 at x0.5 (2 x round(45 x 0.5) = 46)', allZero(p) && lines(p, PASS_RE) === 1 && processedOf(p.last).has(keyOf(h + 2)) && !processedOf(p.last).has(keyOf(h + 1))
    && ros.every((s) => xpOf(p, s) === 2 * Math.round(XP(5) * 0.5)), ros.map((s) => xpOf(p, s)).join(','));
  const ros2 = QUAD(0x80).slice(0, 2), h2 = 0x2800;
  const segs2 = [seg(h2, ros2, 0, 5), seg(h2 + 1, ros2, 5, 10, 0, { 1: { scores: [49125, 30000] } }), seg(h2 + 2, ros2, 10, 15)];
  const q = timeline(played(segs2, 2), ros2);
  T('[6] competitive duo (two voices, Q291 holds it): passes, the next segment settles, nobody flagged', allZero(q) && lines(q, PASS_RE) === 1 && /pair-dispute/.test(q.all) && processedOf(q.last).has(keyOf(h2 + 2))
    && ros2.every((s) => flagsOf(q, s) === 0 && ladderOf(q, BOARD.compDuo, s) === 15), ros2.map((s) => ladderOf(q, BOARD.compDuo, s)).join(','));
  // a held save & quit: its save point is registered by the pass, the resume consumes it (the host pays the fee in the settle)
  const r = caseSave();
  T('[6] a held save & quit [5,8]: the pass registers the save point, the resumed [8,12] consumes it and settles (host fee once)',
    allZero(r.p) && lines(r.p, PASS_RE) === 1 && processedOf(r.p.last).has(keyOf(0x2902)) && ((((runOf(r.p, r.ros) || {}).saves || {})['8'] || {}).by === keyOf(0x2902))
    && lines(r.p, /endless-comp cp [^\n]*resume \(save@8\)/g) === 1 && r.ros.every((s) => flagsOf(r.p, s) === 0), (r.p.all.match(/(seat-only|save-orphan|resume)[^\n]*/g) || []).join(' | '));
}

function caseSave(script) {
  const ros = QUAD(0x90), h = 0x2900;
  const p = timeline(played([seg(h, ros, 0, 5), seg(h + 1, ros, 5, 8, SEG_SUSPENDED, SHORT), seg(h + 2, ros, 8, 12, SEG_RESUMED)], 2), ros, script);
  return { p, ros };
}
// a team classic trio: [0,5], a resumed [5,9] whose records differ on a seat, [9,12] -- the resume stays held (not this shape)
function caseClassicResume(script) {
  const ros = QUAD(0xA0).slice(0, 3), h = 0x2A00;
  const p = timeline(played([seg(h, ros, 0, 5, 0, null, null, SEG_CLASSIC), seg(h + 1, ros, 5, 9, SEG_RESUMED, { 2: { scores: [49325, 29800, 20000] } }, null, SEG_CLASSIC),
    seg(h + 2, ros, 9, 12, 0, null, null, SEG_CLASSIC)], 2), ros, script);
  return { p, ros, m: [0, 1, 2].map((i) => keyOf(h + i)) };
}
{
  const c = caseClassicResume();
  T('[6] a team classic resumed segment differing on a seat: held as before, the next segment waits', allZero(c.p) && lines(c.p, PASS_RE) === 0 && !processedOf(c.p.last).has(c.m[2]) && /9->12 waiting for its chain \(chain-gap\)/.test(c.p.all));
}

// ---- [7] wiring ----
console.log('-- [7] wiring --');
{
  const iCollect = SRC.indexOf('{ const so = seatGateRoster(startsPending[m]) ? seatOnlyDispute(g) : null; if (so) seatOnlyCands.push(Object.assign({ m, g }, so)); }');
  const iQ114 = SRC.indexOf("console.log('  late-mismatch ' + m");
  const iQ317 = SRC.indexOf('const ed = seatGateRoster(startsPending[m]) ? endlessDispute(g, vecOf) : null;');
  T('[7] candidates collected in the flag loop after the settled-key skip (Q114) and ahead of the Q317 / Q291 holds', iQ114 > 0 && iCollect > iQ114 && iQ317 > iCollect);
  const iPass = SRC.indexOf(PASS_CALL), iLoop = SRC.indexOf('  for (const c of fresh) {\n    if (scPendingRestore)'), iSolo = SRC.indexOf('  const soloState = loadSolo();'), iPaced = SRC.indexOf('  const writerPaced = (m, wSids, t0, reqMs) => {');
  T('[7] the pass runs once per run, after the chain memory and the one-match rule are set up, right before the settle loop', iPass > iSolo && iPass > iPaced && iLoop > iPass && iLoop - iPass < 400 && SRC.split(PASS_CALL).length === 2);
  const body = SRC.slice(SRC.indexOf('  const seatOnlyPass = (so) => {'), iPass);
  T('[7] the pass writes nothing but the chain (no processed, credit, signal or flag)', body.length > 0 && !/processed\.add|creditXp|creditCareer|recordFlag|recordEndlessSignals|cp\[|changedCp|\.best\[|ratingHist|teamXpMark|sigDay/.test(body));
  T('[7] the pass checks what a settle checks: roster hold, seedcap veto, chain plan, reroll + perk chains, pacing, one match at a time, then soloAdvance',
    ['endlessRosterHold(', 'seedcap.veto[so.m]', 'soloChainPlan(soloState, key, f, m, nowMs)', 'rerollChain(f, run0)', 'perks.verifyPerkPicks(f, run0, pc, PERK_CH)', 'endlessRequiredMs(f, plan.proven', 'writerPaced(m, so.writers, pend.t0, req)', 'soloAdvance(soloState, key, f, m, plan, nowMs)']
      .every((s, i, a) => body.indexOf(s) > 0 && (i === 0 || body.indexOf(s) > body.indexOf(a[i - 1]))));
  T('[7] summary row present', /\(Q418\) \| ' \+ s\('seatOnlyPass', 0\) \+ ' \/ ' \+ s\('seatOnlyHeld', 0\)/.test(SRC));
}

// ---- [8] mutation self-checks ----
console.log('-- [8] mutation self-checks --');
{
  const mutants = [
    ['no pass (the old rule)', PASS_CALL, '', (s) => { const c = caseLive(s, null, 2); return !processedOf(c.p.last).has(c.m[3]); }],
    ['the tail not compared', "    if (tail0 == null) tail0 = tl; else if (tl !== tail0) return null;\n", '    if (tail0 == null) tail0 = tl;\n',
      (s) => lines(caseShape(0x2520, { 3: { scores: [1, 2, 3, 4], tail: { 1: 14 } } }, 0, null, s).p, PASS_RE) !== 0],
    ['a resumed segment passes', '  if (fl & (attest.SEG_RESUMED | attest.SEG_COUCH | attest.SEG_CASUAL)) return null;\n', '  if (fl & (attest.SEG_COUCH | attest.SEG_CASUAL)) return null;\n',
      (s) => { const c = caseClassicResume(s); return lines(c.p, PASS_RE) !== 0 || processedOf(c.p.last).has(c.m[2]); }],
    ['a competitive resume passes (both guards off: the shape and the chain plan\'s consume)',
      ['  if (fl & (attest.SEG_RESUMED | attest.SEG_COUCH | attest.SEG_CASUAL)) return null;\n', '    if (plan.ok !== true || plan.consume) {'],
      ['  if (fl & (attest.SEG_COUCH | attest.SEG_CASUAL)) return null;\n', '    if (plan.ok !== true) {'],
      (s) => { const ros = QUAD(0x40), h = 0x2540; const c = timeline(played([seg(h, ros, 0, 5), seg(h + 1, ros, 5, 8, SEG_SUSPENDED), seg(h + 2, ros, 8, 13, SEG_RESUMED, SHORT), seg(h + 3, ros, 13, 18)], 2), ros, s);
        return lines(c, PASS_RE) !== 0 || processedOf(c.last).has(keyOf(h + 3)); }],
    ['no one-match-at-a-time turn', '    if (writerPaced(m, so.writers, pend.t0, req)) return \'writer\';\n', '',
      (s) => { const f = caseBatch(SHORT, s), c = caseBatch(null); return f.m.some((k, i) => i !== 2 && settledAt(f.p, k) >= 0 && settledAt(f.p, k) < settledAt(c.p, k)); }],
    ['passed again on every run', '    if (run0 && Array.isArray(run0.so) && run0.so.indexOf(m) >= 0) return \'done\';\n', '', (s) => !summaryAfterPass(caseLive(s, null, 2).p)],
    ['the pass also credits XP', "    run.so = (Array.isArray(run.so) ? run.so : []).concat([m]).slice(-32);\n",
      "    run.so = (Array.isArray(run.so) ? run.so : []).concat([m]).slice(-32);\n    if (xpId) creditXpEndless(g, { startDepth: f.startDepth | 0, endDepth: f.endDepth | 0 }, xp, changedXp, spSet);\n",
      (s) => { const c = caseLive(s, null, 2); return !c.ros.every((x) => xpOf(c.p, x) === XP(22)); }],
    ['held segments not taken shallowest first', "  seatOnlyCands.sort((a, b) => ((a.t.startDepth | 0) - (b.t.startDepth | 0)) || ((a.t.endDepth | 0) - (b.t.endDepth | 0)) || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));\n",
      "  seatOnlyCands.sort((a, b) => ((b.t.startDepth | 0) - (a.t.startDepth | 0)));\n",
      (s) => { const c = caseTwoHeld(s); return c.p.runs.every((r) => (r.out.match(PASS_RE) || []).length < 2); }],
    ['no reroll chain', "      if (rr) { console.log(tag + ': reroll chain (' + rr + ') -- not passed (Q418)'); return 'reroll'; }\n", '',
      (s) => lines(caseShape(0x2560, { 0: { scores: SCORES, tail: { 9: 1 << 10 } }, 1: { scores: SCORES, tail: { 9: 1 << 10 } }, 2: { scores: SCORES, tail: { 9: 1 << 10 } }, 3: { scores: [49325, 30000, 19800, 10000], tail: { 9: 1 << 10 } } }, 0, null, s).p, PASS_RE) !== 0],
  ];
  for (const [label, from, to, check] of mutants) {
    const r = withMutant(from, to, check);
    if (!r.anchor) { bad('[8] ' + label + ': anchor not found exactly once'); continue; }
    T('[8] ' + label + ' -> red', r.out === true);
  }
}

console.log(failN ? ('FAIL x' + failN + ' (seat-only-chain)') : 'ALL OK (seat-only-chain)');
process.exit(failN ? 1 : 0);
