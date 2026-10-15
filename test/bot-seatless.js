'use strict';
// Q148 (cloud audit 2026-10, review of Q123): a bot match (type 11) seats bots, and a bot seat is an empty roster entry,
// like a friends' room (test/private-seatless.js, Q123). Every honest bot-match record names its writer at his own human
// seat (the host builds the seat table once at launch: humans first, then the bots), and the bot lane's own check -- each
// writer at a human seat naming himself (sanityFlags 'self-seat') -- flags the GROUP such a record sits in. So an outside
// account copying a bot match's key and roster from a bot seat stalled it: a result of its own left two disagreeing groups
// on the key while its rows stayed up (the players never earned the match's XP), and a copy of the players' real result
// joined their group and had it flagged with them (each player flagged once, no XP; one account did that to a one-player
// bot match too). A type-11 record whose roster leaves its writer's own seat empty is now dropped with the friends'-room
// ones ahead of start registration and grouping (validate.js seatlessPrivate / dropSeatlessPrivate), and nobody is flagged.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/private-seatless.js), plus the pure helpers.
//   [1] units: seatlessPrivate on type 11 (auto tier and a tier nibble; own seat empty / named / naming someone else),
//       dropSeatlessPrivate counts bot-match drops apart (nBot; RUN.seatlessBot feeds the summary row, [2]-[4]) from
//       friends'-room ones (n)
//   [2] B2: two players and two bots; two outside accounts start from the bot seats before the first look, then write a
//       result of their own there a minute in, the players' real result twelve minutes in: the players settle, the outside
//       accounts earn nothing, nobody is flagged; mutant (bot matches back out of the drop) -> the players get nothing
//   [3] B2c: two players and two bots; an outside account starts from a bot seat and copies the real result there: the
//       players settle, nobody is flagged; mutant -> the copy joins their group and the cloud audit Q109 per-record sanity
//       split drops just it (self-seat, a roster reason: nobody flagged), so the players still settle with the same XP
//       (before Q109 the whole group was flagged and got nothing; [2] is the mutant that still proves the Q148 drop)
//   [4] B1L: one player and three bots (the lone lane); the same copy: the player settles (lone lane), nobody is flagged;
//       mutant -> the same Q109 drop of the copy: the player still settles with the same XP, nobody flagged
//   [5] honest bot matches (two players starts first / one player / a tier nibble / the result seen first): settle,
//       nothing dropped, nobody flagged
//   [6] wiring pins: the bot term in seatlessPrivate, the Q148 log line and summary row, the friends'-room count unchanged
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
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
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
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

function runCron(boards, files, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-seatless-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    let scriptPath = VALIDATE;
    if (script) { scriptPath = path.join(path.dirname(VALIDATE), '.mutant-bot-seatless-' + process.pid + '.js'); fs.writeFileSync(scriptPath, script); }
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock (see test/seat-gate.js): a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv);
    let r;
    try { r = spawnSync(process.execPath, ['-r', stub, scriptPath], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 }); }
    finally { if (script) { try { fs.unlinkSync(scriptPath); } catch (err) {} } }
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (every stored instant moves back instead)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const P0 = SID(301), P1 = SID(302), P2 = SID(303), X = SID(311), Y = SID(312);
const ALL = [P0, P1, P2, X, Y];
const XP_BOARD = 5;
const xpOf = (rs, sid) => {   // the last XP value posted for sid over a run list (the board starts empty: the value is the total)
  let last = 0;
  for (const r of rs) for (const p of r.posts) if (/SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + XP_BOARD + '(&|$)').test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body)) last = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
  return last;
};
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a bot-match record (result-reporter wire form since knife 3.7d, full-seat form): magic, ver, mt, hash, seed, seat, rank,
//   (progress<<1)|win, pc, dur, scores (every seat, bots too), disp, roster -- ros: one steam id per seat, '0' = a bot seat
//   (the game writes 0 there); mt 11 = auto tier, the tier rides in the high nibble (11 | tier << 4)
function rec(magic, hash, seat, ros, scores, mt) {
  const start = magic === 0xB2, pc = ros.length;
  const rank = start ? 0 : 1 + scores.filter((s) => s > scores[seat]).length;
  const d = [magic, 3, mt == null ? 11 : mt, hash | 0, 4321, seat, rank, start ? 0 : ((6 << 1) | (rank === 1 ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (scores[i] | 0));
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: XP_BOARD, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// a timeline of runs: [[ms since the previous run, records visible in that run], ...] -> every run's result
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const processedHas = (rs, key) => (last(rs).state.PROCESSED_FILE || []).indexOf(key) >= 0;
const Q148LINE = /bot match record\(s\) whose writer is not on his own roster seat -- not counted, nobody flagged \(Q148\)/;
const Q123LINE = /friends' room record\(s\) whose writer is not on his own roster seat -- not counted, nobody flagged \(Q123\)/;
const ROW = /\| bot match records whose writer is not on his own roster seat, not counted \(Q148\) \| ([0-9]+) \|/;
const ROW123 = /\| friends' room records whose writer is not on his own roster seat, not counted \(Q123\) \| ([0-9]+) \|/;
const rowN = (rs, re) => rs.reduce((n, r) => n + Number(((re || ROW).exec(r.summary) || [0, 0])[1]), 0);
const SELF = /self-seat/;
// the mutant: seatlessPrivate back to friends' rooms only (the Q123 form)
const BOT_TERM = '(isPrivateMt(r.d[2] | 0) || isBotMt(r.d[2] | 0)) && ';
const noBot = () => { if (SRC.split(BOT_TERM).length !== 2) return null; return SRC.replace(BOT_TERM, 'isPrivateMt(r.d[2] | 0) && '); };

console.log('=== Q148 bot-match record whose writer is not on his own seat ===');

// ---------- [1] units ----------
{
  const ros = [P0, P1, '0', '0'], sc = [6100, 5200, 4800, 3900];
  const mk = (seat, ro, mt, sid) => { const d = rec(0xB1, 77, seat, ro, sc, mt); return { steamID: sid || (seat === 0 ? P0 : seat === 1 ? P1 : X), shard: 'u', d, roster: v.decodeRoster(d) }; };
  T('[1] seatlessPrivate: a type-11 writer at a bot seat (own seat empty) -> true', v.seatlessPrivate(mk(2, ros)) === true && v.seatlessPrivate(mk(3, ros, null, Y)) === true);
  T('[1] seatlessPrivate: a type-11 writer named at his own human seat -> false', v.seatlessPrivate(mk(0, ros)) === false && v.seatlessPrivate(mk(1, ros)) === false);
  T('[1] seatlessPrivate: a tier nibble (11 | 3 << 4, hard) -> still a bot match', v.seatlessPrivate(mk(2, ros, 11 | (3 << 4))) === true && v.seatlessPrivate(mk(0, ros, 11 | (3 << 4))) === false);
  T('[1] seatlessPrivate: own seat naming someone else -> false (the self-seat sanity check owns it)', v.seatlessPrivate(mk(2, [P0, P1, X, '0'], null, Y)) === false);
  T('[1] seatlessPrivate: a seat past the seat count (own seat absent) -> true', v.seatlessPrivate(mk(5, ros)) === true);
  T('[1] seatlessPrivate: quick / ranked / endless with the own seat empty -> false (their own checks)', [1, 2, 7].every((mt) => v.seatlessPrivate(mk(2, ros, mt)) === false));
  const room = (seat, sid) => { const d = rec(0xB1, 78, seat, [P0, P1, '0'], [3000, 2000, 1000], 10); return { steamID: sid, shard: 'u', d, roster: v.decodeRoster(d) }; };
  const recs = [mk(0, ros), mk(2, ros), mk(3, ros, null, Y), mk(1, ros), room(2, X), room(0, P0)];
  const st = [{ start: true, steamID: X, shard: 'u', d: rec(0xB2, 77, 2, ros, sc), roster: v.decodeRoster(rec(0xB2, 77, 2, ros, sc)) }, { start: true, steamID: P0, shard: 'u', d: rec(0xB2, 77, 0, ros, sc), roster: v.decodeRoster(rec(0xB2, 77, 0, ros, sc)) }];
  const res = v.dropSeatlessPrivate(recs, st, new Set());
  T('[1] dropSeatlessPrivate: bot-match drops counted apart (nBot 3: two settles + one start; n 1: the friends\' room one), order kept',
    res.nBot === 3 && res.n === 1 && recs.length === 3 && recs.map((r) => r.steamID).join(',') === [P0, P1, P0].join(',') && st.length === 1 && st[0].steamID === P0,
    'nBot ' + res.nBot + ' n ' + res.n + ' recs ' + recs.map((r) => r.steamID.slice(-3)) + ' starts ' + st.map((r) => r.steamID.slice(-3)));
  T('[1] dropSeatlessPrivate: the bot-match drops grouped by key', res.out.get(keyOf(mk(0, ros).d)).length === 3 && res.out.get(keyOf(room(0, P0).d)).length === 1);
  const recs2 = [mk(2, ros)];
  const res2 = v.dropSeatlessPrivate(recs2, [], new Set([keyOf(recs2[0].d)]));
  T('[1] dropSeatlessPrivate: a processed bot-match key is left alone', res2.nBot === 0 && res2.n === 0 && recs2.length === 1);
}

// common: four seats, two players and two bots (scores are the full-seat vector, bots too)
const ROS2 = [P0, P1, '0', '0'], SC = [6100, 5200, 4800, 3900];

// ---------- [2] B2: two outside accounts write a result of their own from the two bot seats ----------
function b2(script) {
  const h = 0x6148, fake = [1000, 900, 6100, 5200];
  const starts = [{ sid: P0, d: rec(0xB2, h, 0, ROS2, SC) }, { sid: P1, d: rec(0xB2, h, 1, ROS2, SC) }];
  const xs = [{ sid: X, d: rec(0xB2, h, 2, ROS2, SC) }, { sid: Y, d: rec(0xB2, h, 3, ROS2, SC) }];
  const fakes = [{ sid: X, d: rec(0xB1, h, 2, ROS2, fake) }, { sid: Y, d: rec(0xB1, h, 3, ROS2, fake) }];
  const real = [{ sid: P0, d: rec(0xB1, h, 0, ROS2, SC) }, { sid: P1, d: rec(0xB1, h, 1, ROS2, SC) }];
  const s0 = starts.concat(xs), s1 = s0.concat(fakes), s2 = s1.concat(real);
  const rs = timeline([[0, s0], [MIN, s1], [5 * MIN, s1], [5 * MIN, s1], [MIN, s2], [6 * MIN, s2], [6 * MIN, s2], [3 * HOUR, s2]], script);
  return { rs, key: keyOf(real[0].d) };
}
{
  const { rs, key } = b2();
  T('[2] B2: every run exits 0', allOk(rs, 8), rs.map(r => r.code).join(','));
  const hon = timeline([[0, [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB2, 0x6150, s, ROS2, SC) }))], [12 * MIN, [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB1, 0x6150, s, ROS2, SC) }))], [6 * MIN, [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB1, 0x6150, s, ROS2, SC) }))]]);
  T('[2] B2: the match settles for the players by the real result (processed, the same XP as the same match with nobody writing from a bot seat)',
    processedHas(rs, key) && xpOf(rs, P0) > 0 && xpOf(rs, P1) > 0 && xpOf(rs, P0) === xpOf(hon, P0) && xpOf(rs, P1) === xpOf(hon, P1),
    'P0 ' + xpOf(rs, P0) + ' P1 ' + xpOf(rs, P1) + ' honest ' + xpOf(hon, P0) + '/' + xpOf(hon, P1));
  T('[2] B2: the outside accounts earn nothing', xpOf(rs, X) === 0 && xpOf(rs, Y) === 0, 'X ' + xpOf(rs, X) + ' Y ' + xpOf(rs, Y));
  T('[2] B2: nobody flagged, no self-seat flag', [P0, P1, X, Y].every((s) => fOf(last(rs), s) === 0) && !SELF.test(outOf(rs)), [P0, P1, X, Y].map((s) => fOf(last(rs), s)).join('/'));
  const iSet = rs.findIndex((r) => (r.state.PROCESSED_FILE || []).indexOf(key) >= 0);
  const upTo = rs.slice(0, iSet + 1), after = rs.slice(iSet + 1);
  T('[2] B2: the fake result never meets the real one before the settle (no inconsistent group up to the settle run)', iSet >= 0 && !/inconsistent\/invalid/.test(outOf(upTo)),
    'settled in run ' + iSet + ' ' + (outOf(upTo).match(/[^\n]*inconsistent\/invalid[^\n]*/) || [''])[0]);
  T('[2] B2: after the settle the left-over fake rows are history (Q114 late mismatch, nobody flagged)', after.every((r) => !/inconsistent\/invalid/.test(r.out) || /late-mismatch [^\n]*nobody flagged \(Q114\)/.test(r.out)));
  T('[2] B2: logged and counted (Q148 line, summary row; not the friends\'-room row)', Q148LINE.test(outOf(rs)) && rowN(rs) > 0 && rowN(rs, ROW123) === 0 && !Q123LINE.test(outOf(rs)), 'row ' + rowN(rs) + ' / ' + rowN(rs, ROW123));
  const mut = noBot();
  if (!mut) bad('[2] mutant: the bot term is not found exactly once');
  else {
    const m = b2(mut);
    T('[2] mutant (bot matches back out of the drop): the players get nothing (the two groups disagree)', allOk(m.rs, 8) && xpOf(m.rs, P0) === 0 && xpOf(m.rs, P1) === 0,
      'P0 ' + xpOf(m.rs, P0) + ' P1 ' + xpOf(m.rs, P1) + ' f ' + [P0, P1, X, Y].map((s) => fOf(last(m.rs), s)).join('/'));
  }
}

// ---------- [3] B2c: an outside account copies the players' real result at a bot seat ----------
function b2c(script) {
  const h = 0x6149;
  const starts = [{ sid: P0, d: rec(0xB2, h, 0, ROS2, SC) }, { sid: P1, d: rec(0xB2, h, 1, ROS2, SC) }];
  const xs = { sid: X, d: rec(0xB2, h, 2, ROS2, SC) };
  const real = [{ sid: P0, d: rec(0xB1, h, 0, ROS2, SC) }, { sid: P1, d: rec(0xB1, h, 1, ROS2, SC) }];
  const copy = { sid: X, d: rec(0xB1, h, 2, ROS2, SC) };
  const before = starts.concat([xs]), after = before.concat(real, [copy]);
  const rs = timeline([[0, before], [MIN, before], [5 * MIN, before], [5 * MIN, before], [MIN, after], [6 * MIN, after], [6 * MIN, after], [3 * HOUR, after]], script);
  return { rs, key: keyOf(real[0].d) };
}
{
  const { rs, key } = b2c();
  T('[3] B2c: every run exits 0', allOk(rs, 8), rs.map(r => r.code).join(','));
  T('[3] B2c: the match settles for the players (processed, both credited)', processedHas(rs, key) && xpOf(rs, P0) > 0 && xpOf(rs, P1) > 0, 'P0 ' + xpOf(rs, P0) + ' P1 ' + xpOf(rs, P1));
  T('[3] B2c: the outside account earns nothing', xpOf(rs, X) === 0, 'X ' + xpOf(rs, X));
  T('[3] B2c: nobody flagged, no self-seat flag', [P0, P1, X].every((s) => fOf(last(rs), s) === 0) && !SELF.test(outOf(rs)), [P0, P1, X].map((s) => fOf(last(rs), s)).join('/'));
  T('[3] B2c: logged and counted', Q148LINE.test(outOf(rs)) && rowN(rs) > 0, 'row ' + rowN(rs));
  const mut = noBot();
  if (mut) {
    const m = b2c(mut);
    // Q109 (per-record sanity split) drops just the copy (self-seat is a roster reason: nobody flagged), so the players settle
    //   as without the copy -- the Q148 drop is the first line here, Q109 the second (before Q109: flagged, nothing)
    T('[3] mutant: the copy joins their group and Q109 drops just it -- the players settle with the same XP, nobody flagged, the copy nothing', allOk(m.rs, 8)
      && xpOf(m.rs, P0) === xpOf(rs, P0) && xpOf(m.rs, P1) === xpOf(rs, P1) && xpOf(m.rs, X) === 0 && [P0, P1, X].every((s) => fOf(last(m.rs), s) === 0)
      && /\[self-seat\] \(roster reason: not flagged\) -- only that record dropped, nobody flagged/.test(outOf(m.rs)),
      'xp ' + xpOf(m.rs, P0) + '/' + xpOf(m.rs, P1) + '/' + xpOf(m.rs, X) + ' f ' + [P0, P1, X].map((s) => fOf(last(m.rs), s)).join('/'));
  }
}

// ---------- [4] B1L: one player and three bots, the same copy (the lone lane) ----------
function b1l(script, withX) {
  const h = 0x614A, ros = [P0, '0', '0', '0'];
  const st = { sid: P0, d: rec(0xB2, h, 0, ros, SC) }, real = { sid: P0, d: rec(0xB1, h, 0, ros, SC) };
  const xs = { sid: X, d: rec(0xB2, h, 1, ros, SC) }, copy = { sid: X, d: rec(0xB1, h, 1, ros, SC) };
  const before = withX ? [st, xs] : [st], after = before.concat(withX ? [real, copy] : [real]);
  const rs = timeline([[0, before], [MIN, before], [5 * MIN, before], [5 * MIN, before], [MIN, after], [6 * MIN, after], [6 * MIN, after], [3 * HOUR, after]], script);
  return { rs, key: keyOf(real.d) };
}
{
  const honest = b1l(null, false);
  const { rs, key } = b1l(null, true);
  T('[4] B1L: every run exits 0', allOk(rs, 8) && allOk(honest.rs, 8), rs.map(r => r.code).join(','));
  T('[4] B1L: the player settles in the lone lane, the same XP as with nobody copying', processedHas(rs, key) && xpOf(rs, P0) > 0 && xpOf(rs, P0) === xpOf(honest.rs, P0) && /lone lane/.test(outOf(rs)),
    'P0 ' + xpOf(rs, P0) + ' honest ' + xpOf(honest.rs, P0));
  T('[4] B1L: the outside account earns nothing, nobody flagged', xpOf(rs, X) === 0 && fOf(last(rs), P0) === 0 && fOf(last(rs), X) === 0 && !SELF.test(outOf(rs)), 'X ' + xpOf(rs, X) + ' f ' + fOf(last(rs), P0) + '/' + fOf(last(rs), X));
  T('[4] B1L: logged and counted', Q148LINE.test(outOf(rs)) && rowN(rs) > 0);
  const mut = noBot();
  if (mut) {
    const m = b1l(mut, true);
    T('[4] mutant: Q109 drops just the copy -- the lone player settles with the same XP, nobody flagged', allOk(m.rs, 8) && xpOf(m.rs, P0) === xpOf(honest.rs, P0) && xpOf(m.rs, X) === 0
      && fOf(last(m.rs), P0) === 0 && fOf(last(m.rs), X) === 0 && /\[self-seat\] \(roster reason: not flagged\) -- only that record dropped, nobody flagged/.test(outOf(m.rs)),
      'xp ' + xpOf(m.rs, P0) + ' honest ' + xpOf(honest.rs, P0) + ' f ' + fOf(last(m.rs), P0) + '/' + fOf(last(m.rs), X));
  }
}

// ---------- [5] honest bot matches ----------
{
  const h = 0x614B;
  const starts = [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB2, h, s, ROS2, SC) }));
  const real = [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB1, h, s, ROS2, SC) }));
  const rs = timeline([[0, starts], [6 * MIN, starts], [6 * MIN, starts.concat(real)], [6 * MIN, starts.concat(real)]]);
  T('[5] two players and two bots, starts first: settles, both credited, nothing dropped, nobody flagged',
    allOk(rs, 4) && processedHas(rs, keyOf(real[0].d)) && [P0, P1].every((s) => xpOf(rs, s) > 0 && fOf(last(rs), s) === 0) && rowN(rs) === 0 && !Q148LINE.test(outOf(rs)),
    'xp ' + [P0, P1].map((s) => xpOf(rs, s)).join('/') + ' row ' + rowN(rs));
  const h2 = 0x614C, ros2 = [P0, P1, P2, '0'], mt = 11 | (3 << 4);
  const st2 = [0, 1, 2].map((s) => ({ sid: ros2[s], d: rec(0xB2, h2, s, ros2, SC, mt) }));
  const real2 = [0, 1, 2].map((s) => ({ sid: ros2[s], d: rec(0xB1, h2, s, ros2, SC, mt) }));
  const rs2 = timeline([[0, st2], [6 * MIN, st2], [6 * MIN, st2.concat(real2)], [6 * MIN, st2.concat(real2)]]);
  T('[5] three players and a bot, the hard tier (11 | 3 << 4): settles, all three credited, nothing dropped',
    allOk(rs2, 4) && processedHas(rs2, keyOf(real2[0].d)) && [P0, P1, P2].every((s) => xpOf(rs2, s) > 0 && fOf(last(rs2), s) === 0) && rowN(rs2) === 0,
    'xp ' + [P0, P1, P2].map((s) => xpOf(rs2, s)).join('/') + ' row ' + rowN(rs2));
  const h3 = 0x614D;
  const real3 = [0, 1].map((s) => ({ sid: ROS2[s], d: rec(0xB1, h3, s, ROS2, SC) }));
  const rs3 = timeline([[0, real3], [6 * MIN, real3], [6 * MIN, real3]]);
  T('[5] two players and two bots, the result seen first (no start read): settles, nothing dropped',
    allOk(rs3, 3) && processedHas(rs3, keyOf(real3[0].d)) && xpOf(rs3, P0) > 0 && xpOf(rs3, P1) > 0 && rowN(rs3) === 0,
    'xp ' + xpOf(rs3, P0) + '/' + xpOf(rs3, P1) + ' row ' + rowN(rs3));
}

// ---------- [6] wiring pins ----------
{
  const fn = (SRC.match(/function seatlessPrivate\([\s\S]*?\n}\n/) || [''])[0];
  T('[6] seatlessPrivate drops a bot match too (the bot term inside it, once)', fn.indexOf(BOT_TERM) > 0 && SRC.split(BOT_TERM).length === 2);
  const body = (SRC.match(/function dropSeatlessPrivate\([\s\S]*?\n}\n/) || [''])[0];
  T('[6] the drop counts bot-match records apart and adds them to RUN.seatlessBot, flags nobody',
    /nBot\+\+/.test(body) && /RUN\.seatlessBot = \(RUN\.seatlessBot \| 0\) \+ nBot/.test(body) && /return \{ out, n, nBot \}/.test(body) && !/recordFlag|trustTouched|sigPlayer/.test(body));
  T('[6] the friends\'-room count still feeds RUN.seatless (n only)', SRC.indexOf('  RUN.seatless = dropSeatlessPrivate(recs, starts, processed).n;\n') > 0);
  T('[6] Q148 log line and summary row present', /bot match record\(s\) whose writer is not on his own roster seat -- not counted, nobody flagged \(Q148\)/.test(SRC)
    && /'\| bot match records whose writer is not on his own roster seat, not counted \(Q148\) \| ' \+ s\('seatlessBot', 0\)/.test(SRC));
}

console.log(failN ? ('bot-seatless: ' + failN + ' FAILED') : 'bot-seatless: all ok');
process.exit(failN ? 1 : 0);
