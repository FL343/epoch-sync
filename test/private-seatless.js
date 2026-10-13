'use strict';
// Q123 (cloud audit 2026-10, review 4 of Q75/Q80): a friends' room (type 10) can seat bots, and a bot seat is an empty
// roster entry. While the room's start roster gates nothing -- one outside start before the job's first look splits it,
// or the job sees a result first -- an outside account copying the room's key and roster could write from a bot seat with
// its own seat left empty: the same seat layout as the players' records, no seat named twice, so neither the Q75 contest
// nor its layout hold saw it, and the room's XP went to it (C2: it copied the real scores and joined the players' group;
// C1: two of them wrote a result of their own a minute in and settled it, the players got nothing). Every honest
// friends'-room record names its writer at his own seat, so a type-10 record whose roster leaves its writer's own seat
// empty is now dropped ahead of start registration and grouping (validate.js dropSeatlessPrivate), and nobody is flagged.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as test/seat-gate.js),
// plus the pure helpers.
//   [1] units: seatlessPrivate (type 10, and type 11 since Q148 [test/bot-seatless.js] -- the matchmade lanes keep their
//       own checks, the matchmade cold-start tolerance of test/sanity-bounds.js stands), dropSeatlessPrivate (in place,
//       starts and settles, a processed key left alone)
//   [2] C2: two players and one bot; an outside account starts from the bot seat before the first look (copying the
//       roster), then copies the real result there: the players settle as in an honest room, the outside account earns
//       nothing, nobody is flagged; mutant (the drop removed) -> it takes the third seat's XP
//   [3] C1: two players and two bots; the same start, then two outside accounts write a result of their own from the two
//       bot seats a minute in (they top it), the real result twelve minutes in: the players settle, the outside accounts
//       earn nothing, nobody is flagged; mutant (the drop removed) -> the players lose the match (or it is the outside
//       accounts') and are flagged
//   [4] honest rooms with bots: starts first, and the result seen first (no start read) -- settle, nothing dropped
//   [5] wiring pins: the drop runs ahead of registration and grouping, flags nobody, has its summary row
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-seatless-'));
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
    if (script) { scriptPath = path.join(path.dirname(VALIDATE), '.mutant-private-seatless-' + process.pid + '.js'); fs.writeFileSync(scriptPath, script); }
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
// a friends'-room record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur,
//   scores, disp, roster -- ros: one steam id per seat, '0' = a bot seat (the game writes 0 there)
function rec(magic, hash, seat, ros, scores) {
  const start = magic === 0xB2, pc = ros.length;
  const rank = start ? 0 : 1 + scores.filter((s) => s > scores[seat]).length;
  const d = [magic, 3, 10, hash | 0, 4321, seat, rank, start ? 0 : ((6 << 1) | (rank === 1 ? 1 : 0)), pc, start ? 0 : 720];
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
const Q123LINE = /friends' room record\(s\) whose writer is not on his own roster seat -- not counted, nobody flagged \(Q123\)/;
const ROW = /\| friends' room records whose writer is not on his own roster seat, not counted \(Q123\) \| ([0-9]+) \|/;
const rowN = (rs) => rs.reduce((n, r) => n + Number((ROW.exec(r.summary) || [0, 0])[1]), 0);
const DROP_CALL = '  RUN.seatless = dropSeatlessPrivate(recs, starts, processed).n;\n';
const noDrop = () => { if (SRC.split(DROP_CALL).length !== 2) return null; return SRC.replace(DROP_CALL, '  RUN.seatless = 0;\n'); };

console.log('=== Q123 friends\'-room record whose writer is not on his own seat ===');

// ---------- [1] units ----------
{
  const ros = [P0, P1, '0'];
  const mk = (seat, ro, mt) => { const d = rec(0xB1, 77, seat, ro, [3000, 2000, 1000]); if (mt != null) d[2] = mt; return { steamID: seat === 2 ? X : (seat === 0 ? P0 : P1), shard: 'u', d, roster: v.decodeRoster(d) }; };
  T('[1] seatlessPrivate: a type-10 writer at a bot seat (own seat empty) -> true', v.seatlessPrivate(mk(2, ros)) === true);
  T('[1] seatlessPrivate: a type-10 writer named at his own seat -> false', v.seatlessPrivate(mk(0, ros)) === false && v.seatlessPrivate(mk(1, ros)) === false);
  T('[1] seatlessPrivate: own seat naming someone else -> false (the self-seat sanity check owns it)', v.seatlessPrivate(mk(0, [P1, P1, '0'])) === false);
  T('[1] seatlessPrivate: a seat past the seat count (own seat absent) -> true', v.seatlessPrivate({ steamID: X, d: rec(0xB1, 77, 5, ros, [3000, 2000, 1000]), roster: v.decodeRoster(rec(0xB1, 77, 5, ros, [3000, 2000, 1000])) }) === true);
  T('[1] seatlessPrivate: type 10 with flag bits (base 10) -> still a friends\' room', v.seatlessPrivate(mk(2, ros, 0x1A)) === true);
  T('[1] seatlessPrivate: quick / ranked / endless with the own seat empty -> false (their own checks; a bot match is dropped too since Q148, test/bot-seatless.js)',
    [1, 2, 7].every((mt) => v.seatlessPrivate(mk(2, ros, mt)) === false));
  const sanity = require(path.join(__dirname, '..', 'validate.js')).sanityFlags;
  T('[1] the matchmade cold-start tolerance stands (sanityFlags, own seat empty, quick)',
    JSON.stringify(sanity([{ steamID: P0, d: (() => { const d = rec(0xB1, 77, 0, ['0', P1, P2], [3000, 2000, 1000]); d[2] = 1; return d; })(), roster: { 1: P1, 2: P2 } }, mk(1, [P0, P1, P2], 1)])) === '[]');
  const recs = [mk(0, ros), mk(2, ros), mk(1, ros)];
  const st = [{ start: true, steamID: X, shard: 'u', d: rec(0xB2, 77, 2, ros, [0, 0, 0]), roster: v.decodeRoster(rec(0xB2, 77, 2, ros, [0, 0, 0])) }, { start: true, steamID: P0, shard: 'u', d: rec(0xB2, 77, 0, ros, [0, 0, 0]), roster: v.decodeRoster(rec(0xB2, 77, 0, ros, [0, 0, 0])) }];
  const res = v.dropSeatlessPrivate(recs, st, new Set());
  T('[1] dropSeatlessPrivate: in place, settles and starts, order kept, n counted',
    res.n === 2 && recs.length === 2 && recs[0].steamID === P0 && recs[1].steamID === P1 && st.length === 1 && st[0].steamID === P0 && res.out.get(keyOf(recs[0].d)).length === 2,
    'n=' + res.n + ' recs=' + recs.map(r => r.steamID.slice(-3)) + ' starts=' + st.map(r => r.steamID.slice(-3)));
  const recs2 = [mk(2, ros)];
  const res2 = v.dropSeatlessPrivate(recs2, [], new Set([keyOf(recs2[0].d)]));
  T('[1] dropSeatlessPrivate: a processed key is left alone', res2.n === 0 && recs2.length === 1);
}

// ---------- [2] C2: two players and one bot, an outside account copies the real result at the bot seat ----------
function c2(script) {
  const ros = [P0, P1, '0'], sc = [6100, 5200, 4800], h = 0x5123;
  const starts = [{ sid: P0, d: rec(0xB2, h, 0, ros, sc) }, { sid: P1, d: rec(0xB2, h, 1, ros, sc) }];
  const xs = { sid: X, d: rec(0xB2, h, 2, ros, sc) };
  const real = [{ sid: P0, d: rec(0xB1, h, 0, ros, sc) }, { sid: P1, d: rec(0xB1, h, 1, ros, sc) }];
  const copy = { sid: X, d: rec(0xB1, h, 2, ros, sc) };
  const before = starts.concat([xs]), after = before.concat(real, [copy]);
  const rs = timeline([[0, before], [MIN, before], [5 * MIN, before], [5 * MIN, before], [MIN, after], [6 * MIN, after], [6 * MIN, after], [3 * HOUR, after]], script);
  return { rs, key: keyOf(real[0].d) };
}
{
  const { rs, key } = c2();
  T('[2] C2: every run exits 0', allOk(rs, 8), rs.map(r => r.code).join(','));
  T('[2] C2: the room settles for the players (processed, both credited)', processedHas(rs, key) && xpOf(rs, P0) > 0 && xpOf(rs, P1) > 0, 'P0 ' + xpOf(rs, P0) + ' P1 ' + xpOf(rs, P1));
  T('[2] C2: the outside account earns nothing', xpOf(rs, X) === 0, 'X ' + xpOf(rs, X));
  T('[2] C2: nobody flagged', [P0, P1, X].every((s) => fOf(last(rs), s) === 0), [P0, P1, X].map((s) => fOf(last(rs), s)).join('/'));
  T('[2] C2: its start splits nothing (the room roster registers and gates)', !/start-split /.test(outOf(rs)), (outOf(rs).match(/start-split [^\n]*/) || [''])[0]);
  T('[2] C2: logged and counted (Q123 line, summary row)', Q123LINE.test(outOf(rs)) && rowN(rs) > 0, 'row ' + rowN(rs));
  const mut = noDrop();
  if (!mut) bad('[2] mutant: the drop call is not found exactly once');
  else {
    const m = c2(mut);
    T('[2] mutant (the drop removed): the outside account takes the bot seat\'s XP again', allOk(m.rs, 8) && xpOf(m.rs, X) > 0, 'X ' + xpOf(m.rs, X));
  }
}

// ---------- [3] C1: two players and two bots, two outside accounts write a result of their own from the bot seats ----------
function c1(script) {
  const ros = [P0, P1, '0', '0'], sc = [6100, 5200, 4800, 3900], fake = [1000, 900, 6100, 5200], h = 0x5124;
  const starts = [{ sid: P0, d: rec(0xB2, h, 0, ros, sc) }, { sid: P1, d: rec(0xB2, h, 1, ros, sc) }];
  const xs = { sid: X, d: rec(0xB2, h, 2, ros, sc) };
  const fakes = [{ sid: X, d: rec(0xB1, h, 2, ros, fake) }, { sid: Y, d: rec(0xB1, h, 3, ros, fake) }];
  const real = [{ sid: P0, d: rec(0xB1, h, 0, ros, sc) }, { sid: P1, d: rec(0xB1, h, 1, ros, sc) }];
  const s0 = starts.concat([xs]), s1 = s0.concat(fakes), s2 = s1.concat(real);
  const rs = timeline([[0, s0], [MIN, s1], [5 * MIN, s1], [5 * MIN, s1], [MIN, s2], [6 * MIN, s2], [6 * MIN, s2], [3 * HOUR, s2], [24 * HOUR, s2]], script);
  return { rs, key: keyOf(real[0].d) };
}
{
  const { rs, key } = c1();
  T('[3] C1: every run exits 0', allOk(rs, 9), rs.map(r => r.code).join(','));
  T('[3] C1: the room settles for the players by the real result', processedHas(rs, key) && xpOf(rs, P0) > xpOf(rs, P1) && xpOf(rs, P1) > 0, 'P0 ' + xpOf(rs, P0) + ' P1 ' + xpOf(rs, P1));
  T('[3] C1: the outside accounts earn nothing', xpOf(rs, X) === 0 && xpOf(rs, Y) === 0, 'X ' + xpOf(rs, X) + ' Y ' + xpOf(rs, Y));
  T('[3] C1: nobody flagged', [P0, P1, X, Y].every((s) => fOf(last(rs), s) === 0), [P0, P1, X, Y].map((s) => fOf(last(rs), s)).join('/'));
  const iSet = rs.findIndex((r) => (r.state.PROCESSED_FILE || []).indexOf(key) >= 0);
  const upTo = rs.slice(0, iSet + 1), after = rs.slice(iSet + 1);
  T('[3] C1: the fake result never meets the real one before the settle (no inconsistent group up to the settle run)', iSet >= 0 && !/inconsistent\/invalid/.test(outOf(upTo)),
    'settled in run ' + iSet + ' ' + (outOf(upTo).match(/[^\n]*inconsistent\/invalid[^\n]*/) || [''])[0]);
  T('[3] C1: after the settle the left-over fake rows are history (Q114 late mismatch, nobody flagged)', after.every((r) => !/inconsistent\/invalid/.test(r.out) || /late-mismatch [^\n]*nobody flagged \(Q114\)/.test(r.out)));
  const mut = noDrop();
  if (mut) {
    const m = c1(mut);
    const fooled = xpOf(m.rs, X) > 0 || xpOf(m.rs, Y) > 0 || xpOf(m.rs, P0) === 0 || fOf(last(m.rs), P0) > 0;
    T('[3] mutant (the drop removed): the players lose the match or are flagged, or the outside accounts take it', allOk(m.rs, 9) && fooled,
      'P0 xp ' + xpOf(m.rs, P0) + ' f ' + fOf(last(m.rs), P0) + ' / X xp ' + xpOf(m.rs, X) + ' / Y xp ' + xpOf(m.rs, Y));
  }
}

// ---------- [4] honest rooms with bots ----------
{
  const ros = [P0, P1, P2, '0'], sc = [6100, 5200, 4800, 3900], h = 0x5125;
  const starts = [0, 1, 2].map((s) => ({ sid: ros[s], d: rec(0xB2, h, s, ros, sc) }));
  const real = [0, 1, 2].map((s) => ({ sid: ros[s], d: rec(0xB1, h, s, ros, sc) }));
  const rs = timeline([[0, starts], [6 * MIN, starts], [6 * MIN, starts.concat(real)], [6 * MIN, starts.concat(real)]]);
  T('[4] three players and a bot, starts first: settles, all three credited, nothing dropped, nobody flagged',
    allOk(rs, 4) && processedHas(rs, keyOf(real[0].d)) && [P0, P1, P2].every((s) => xpOf(rs, s) > 0 && fOf(last(rs), s) === 0) && rowN(rs) === 0 && !Q123LINE.test(outOf(rs)),
    'xp ' + [P0, P1, P2].map((s) => xpOf(rs, s)).join('/') + ' row ' + rowN(rs));
  const h2 = 0x5126, ros2 = [P0, P1, '0', '0'];
  const real2 = [0, 1].map((s) => ({ sid: ros2[s], d: rec(0xB1, h2, s, ros2, sc) }));
  const rs2 = timeline([[0, real2], [6 * MIN, real2], [6 * MIN, real2]]);
  T('[4] two players and two bots, the result seen first (no start read): settles, nothing dropped',
    allOk(rs2, 3) && processedHas(rs2, keyOf(real2[0].d)) && xpOf(rs2, P0) > 0 && xpOf(rs2, P1) > 0 && rowN(rs2) === 0,
    'xp ' + xpOf(rs2, P0) + '/' + xpOf(rs2, P1) + ' row ' + rowN(rs2));
}

// ---------- [5] wiring pins ----------
{
  const iDrop = SRC.indexOf(DROP_CALL), iReg = SRC.indexOf('const registeredEarly = registerStartRosters('), iGroup = SRC.indexOf('const gr = groupRecords(recs');
  T('[5] the drop runs once, ahead of start registration and grouping', SRC.split(DROP_CALL).length === 2 && iDrop > 0 && iDrop < iReg && iReg < iGroup, iDrop + ' ' + iReg + ' ' + iGroup);
  const body = (SRC.match(/function dropSeatlessPrivate\([\s\S]*?\n}\n/) || [''])[0];
  T('[5] the drop flags nobody (no recordFlag / trust candidates inside)', body.length > 0 && !/recordFlag|trustTouched|sigPlayer/.test(body));
  T('[5] summary row present', /friends' room records whose writer is not on his own roster seat, not counted \(Q123\)/.test(SRC));
}

console.log(failN ? ('private-seatless: ' + failN + ' FAILED') : 'private-seatless: all ok');
process.exit(failN ? 1 : 0);
