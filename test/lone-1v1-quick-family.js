'use strict';
// Q446 (cloud audit 2026-11, from the local M1022 read of the O989 cron path): the lone 1V1 verdicts Q184 (the loser wrote
//   nothing), Q216 (he wrote only records the job cannot use) and Q254 (the winner's own start read late with his result)
//   tested the match type for the old ranked 1V1 code 2. Since O716 (2026-11-07, clients 0.5.0 on) every matchmade 1V1 is
//   written as the quick family base 1 plus the ranked-seat mask (bits 11-16): none of the three let a new record in, and an
//   honest winner whose loser went silent got nothing at all -- not even the consolation XP a loser who wrote his own start
//   leaves him (the start-orphan verdict). Now lone1v1Mt takes the old ranked code and the quick family base 1 with any seat
//   mask (no party bits); the rules (gate of two opponents, weekly cap, the silent seat only counted) are Q184's; a quick
//   family claim pays the consolation XP only -- no points, no receipt, whichever seat came in through ranked: the owner's
//   ruling O716 D12 (2026-11-07: before EA only the XP is made up, the mixed 1V1 by the quick rules, the points added later
//   not paid back). A quick family key is decided at LONE1V1.QUICK_WAIT_MS (3 hours), past the last upload of a loser's
//   game (its outbox re-sends a result for 2 hours from the match's end): before Q446 such a late loser still settled the
//   match in full for both, and the verdict must not close the key under him.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/lone-1v1-win.js).
//   [1] units: lone1v1Mt / lone1v1PaysPoints (each code), lone1v1Claim / lone1v1Spoiled / keepLateOwn / lone1v1VoidClaims
//       on quick family records (each mask; party bits, three seats, a mask on the old ranked code still out)
//   [2] the modded player M who writes only the 1V1s he wins, on the one queue (both seats ranked): his win settles as usual;
//       O2 beats him (only O2 writes) -- counted, waits; O3 beats him -- counted, O3 and O2 paid the consolation XP, no
//       points, nobody flagged; the summary rows; once only; mutants: the code before Q446 (exact code 2) -> nothing; a
//       quick family claim paid points -> points written
//   [3] the other masks (only the winner's seat ranked / only the loser's / none): the consolation XP only
//   [4] the old ranked code and a quick family claim for the same winner in one run: points for the ranked one only, one
//       consolation; a claim queued before O480 (no match key) pays points as before
//   [5] Q216 on the one queue: the loser's S6 / V / U records -> counted, each winner the consolation XP only (the silent
//       twin's), nobody paid points
//   [6] Q254 on the one queue: an outside start read before the result, the winner's own start late -> paid the
//       consolation XP; mutant (no lo for the quick family) -> paid nobody
//   [7] honest controls on the one queue, as before: the loser wrote his own start (start-orphan: his exit, the winner's
//       consolation, nothing from Q184); he confessed; a peers-gone result; a result saying its writer lost
//   [8] wiring pins
//   [9] the late loser: his start and result first read 2 h 20 min after the winner's start -> the match settles in full for
//       both, as before Q446 (no lone verdict at the start maturity); mutant (no QUICK_WAIT_MS) -> the verdict at 2 hours
//       closes the key under him: the winner the consolation alone, the loser nothing
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/lone-1v1-win.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS'];
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
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}');",   // { boardName: httpStatus }: every entry read of it fails
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
  "    if (b && FAIL[b.name]) return resp({ error: 'injected' }, FAIL[b.name]);",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lone-1v1-quick-'));
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
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) and the
      //   points writes read below would go elsewhere -- every test runs before each production reconcile, so a
      //   date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every stored
//   instant moves back instead: start sightings, absent-seat stamps, the writers' busy marks, the flag memory)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;   // .at stays: the players keep playing
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat; sc: the seat scores the record claims (default by seat)
const SC = { 2: [7000, 4000], 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (sc || SC[pc])[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 2V2 ranked (mt 6): the {0,1} v {2,3} convention, ranks by score inside each team; `winTeam` 0 = seats 0/1 won
const t2rank = (seat, winTeam) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === winTeam ? 1 : 3) + inTeam; };
const t2settle = (hash, seat, ros, winTeam) => rec(0xB1, 6, hash, seat, t2rank(seat, winTeam || 0), ((seat >> 1) & 1) === (winTeam || 0), ros,
  winTeam ? [3900, 4800, 6100, 5200] : null);
const t2start = (hash, seat, ros) => rec(0xB2, 6, hash, seat, 0, false, ros);
// 1V1 ranked (mt 2, two seats): `winner` = the seat the record says won
const v1settle = (hash, seat, ros, winner) => rec(0xB1, 2, hash, seat, seat === winner ? 1 : 2, seat === winner, ros, winner ? [4000, 7000] : [7000, 4000]);
const v1start = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);

// the silent seat's own history: a signals entry as a settled match of his leaves it
const sigEntry = () => ({ g: 3, w: 2, v: 0, f: 0, ns: 0, disp: [3, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now() });
const sigFile = (sids) => { const players = {}; for (const s of sids) players[v.pid(s)] = sigEntry(); return { day: { d: 0, n: {} }, players, pairs: {}, flagged: {}, rep: {}, rseen: {} }; };
const sigState = (sids) => ({ SIGNALS_FILE: sigFile(sids) });
// the silent seat already counted once by another opponent: the next claim is at the gate
const atGate = (sids, sil, prior) => { const f = sigFile(sids); Object.assign(f.players[v.pid(sil)], { l1: 1, l1o: [v.pid(prior)] }); return { SIGNALS_FILE: f }; };
const TS = require(path.join(__dirname, '..', 'trueskill.js'));
// carry state like advance(), plus this item's own clocks (waiting claims, the weekly payments)
function advanceQ(state, ms) {
  const files = advance(state, ms);
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const p = sg.players[k];
    if (Array.isArray(p.l1q)) for (const q of p.l1q) q.t -= ms;
    if (Array.isArray(p.l1t)) p.l1t = p.l1t.map(t => t - ms);
  }
  return files;
}
const SIDQ = (n) => '7656119800' + String(n).padStart(7, '0');
const M = SIDQ(1841), V = SIDQ(1842), X = SIDQ(1843), Y = SIDQ(1844), Z = SIDQ(1845);
const O = Array.from({ length: 12 }, (_, i) => SIDQ(1850 + i));
const ALL = [M, V, X, Y, Z].concat(O);
let LP0 = {};   // points board overrides for a scenario: sid -> points (null = no entry this season)
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.filter(s => LP0[s] !== null).map(s => ({ steamID: s, score: LP0[s] != null ? LP0[s] : 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state before the first run
function timeline(steps, script, files0) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advanceQ(state, ms) : (files0 || null), env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000, DAY = 86400000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const xpIn = (rs, sid) => [].concat(...rs.map(r => posts(r, 5).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]))));
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || null;
const sumRow = (rs) => { const m = /\| ranked 1V1s only the winner wrote \(Q184\)[^|]*\| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \(([0-9]+)\) \|/.exec(last(rs).summary); return m ? m.slice(1).map(Number) : null; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const LINE = /lone-1v1 [0-9]+_[0-9]+_[0-9]+: /;
const xpRow = (r) => { const m = /\| of those paid, 1V1s of the one quick \+ ranked queue[^|]*\| ([0-9]+) \|/.exec(r.summary); return m ? Number(m[1]) : null; };
const XPONLY = /paid the consolation XP only, no points \(a 1V1 of the one quick \+ ranked queue, Q446 \/ O716 D12\)/g;
const stepsOf = (...parts) => [].concat(...parts);
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-lone-1v1-quick-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// the one quick + ranked queue (O716): the quick family base 1, bits 11-16 = the seats that came in through ranked
const MT = { q11: 1 | (3 << 11), q01: 1 | (1 << 11), q10: 1 | (2 << 11), q00: 1 };
// a 1V1 of match type mt: `winner` = the seat the record says won (scores [7000, 4000] when seat 0 won)
const qsettle = (mt, hash, seat, ros, winner) => rec(0xB1, mt, hash, seat, seat === winner ? 1 : 2, seat === winner, ros, winner ? [4000, 7000] : [7000, 4000]);
const qstart = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
// a 1V1 the winner w (seat 0) wrote alone against l (seat 1): his start, ten minutes later his result, the verdict two hours on
function lone(mt, h, w, l, extra, opt) {
  opt = opt || {};
  const ro = [w, l];
  const st = { sid: w, d: opt.start || qstart(mt, h, 0, ro) };
  const re = { sid: w, d: opt.res || qsettle(mt, h, 0, ro, 0) };
  const more = opt.more || [];
  const ex = extra || [];
  return [[0, ex.concat([st], more)], [10 * MIN, ex.concat([st, re], more)], [VERDICT, ex.concat([st, re], more), opt.env]];
}
const VERDICT = 3 * HOUR;   // the verdict run: past LONE1V1.QUICK_WAIT_MS (3 h from the first start) for a quick family key
const MTS_FROM = 'const LONE1V1_MTS = [1, 2];';
const PAYS_FROM = 'function lone1v1PaysPoints(mt) { return mtSansSeats(mt) === 2; }';
const why = (rs) => outOf(rs).split('\n').filter(l => /start-|lone-1v1|contest|consolation/.test(l)).join(' | ');

console.log('=== a 1V1 of the one quick + ranked queue only its winner wrote: the consolation XP, no points (Q446, O716 D12) ===');

// ---- [1] units ----
{
  const tbl = [[2, true, true, 'the old ranked 1V1'], [1, true, false, 'plain quick'], [MT.q11, true, false, 'both seats ranked'], [MT.q01, true, false, 'the winner\'s seat ranked'],
    [MT.q10, true, false, 'the loser\'s seat ranked'], [1 | 0x10, false, false, 'quick + a party bit'], [1 | (1 << 8), false, false, 'quick + a trio seat'], [2 | 0x12, false, false, 'ranked + party bits'],
    [3, false, false, 'quick team brawl'], [5, false, false, 'quick 2V2'], [5 | (3 << 11), false, false, 'quick 2V2 + mask'], [7, false, false, 'endless'], [10, false, false, 'friends\' room'], [11, false, false, 'bot match']];
  const badRows = tbl.filter(([mt, a, b]) => v.lone1v1Mt(mt) !== a || v.lone1v1PaysPoints(mt) !== b);
  T('[1] lone1v1Mt / lone1v1PaysPoints: the old ranked code and the quick family (any seat mask) in, points for the old code only; party bits, teams, endless, rooms, bots out',
    !badRows.length, JSON.stringify(badRows));
  const ro = [O[0], M], h = 0x8601;
  const R = (d, sid) => { const pc = d[8] | 0; return { steamID: sid || O[0], d, dispCode: d[10 + pc] | 0, roster: v.decodeRoster(d) }; };
  const S = (d, sid) => ({ start: true, steamID: sid || O[0], d, roster: v.decodeRoster(d) });
  const note = (starts) => ({ t0: 0, s: starts.map(s => v.pid(String(s.steamID)) + '@' + (s.d[5] | 0) + '#' + v.startSig(s)), r: 1, c: 0 });
  for (const [tag, mt] of [['both seats ranked', MT.q11], ['only the winner\'s seat ranked', MT.q01], ['only the loser\'s seat ranked', MT.q10], ['no seat ranked', MT.q00]]) {
    const st = S(qstart(mt, h, 0, ro)), res = R(qsettle(mt, h, 0, ro, 0)), key = keyOf(res.d);
    const c = v.lone1v1Claim(note([st]), key, [res], {}, new Set());
    T('[1] claim: a 1V1 of the one queue, ' + tag + ' -> the winner, the silent seat, his seat', c && c.w === O[0] && c.o === M && c.seat === 0 && c.m === key, JSON.stringify(c));
  }
  const st = S(qstart(MT.q11, h, 0, ro)), res = R(qsettle(MT.q11, h, 0, ro, 0)), key = keyOf(res.d);
  const no = (label, e, g) => T('[1] no claim: ' + label, v.lone1v1Claim(e, key, g, {}, new Set()) === null);
  no('the one queue + a party bit', note([st]), [R(qsettle(MT.q11 | 0x10, h, 0, ro, 0))]);
  no('the one queue, three seats', note([st]), [R(rec(0xB1, MT.q01, h, 0, 1, true, [O[0], M, V], [7000, 4000, 3000]))]);
  no('the one queue, his result says he lost', note([st]), [R(qsettle(MT.q11, h, 0, ro, 1))]);
  no('the one queue, a peers-gone result', note([st]), [R(qsettle(MT.q11, h, 0, ro, 0).map((x, i) => i === 12 ? 1 : x))]);
  no('a mask on the old ranked code (a header no writer sends: the sanity bound)', note([S(qstart(2 | (1 << 11), h, 0, ro))]), [R(qsettle(2 | (1 << 11), h, 0, ro, 0))]);
  no('the silent seat\'s own start read before the result', note([st, S(qstart(MT.q11, h, 1, ro), M)]), [res]);
  // Q216 on the one queue: the loser's result out of the sanity bounds (a duration past DUR_CAP), his record saying he lost
  const lostQ = (mt, hh, r2) => rec(0xB1, mt, hh, 1, 2, false, r2, [7000, 4000]), durBad = (d) => d.map((x, i) => i === 9 ? 90000 : x);
  const bV = R(durBad(lostQ(MT.q11, h, ro)), M);
  const cs = v.lone1v1Spoiled(note([st]), key, [res, bV], {}, new Set(), false, null);
  T('[1] spoiled: a 1V1 of the one queue whose loser wrote only a result out of bounds -> a claim (Q216)', cs && cs.spoiled === 1 && cs.w === O[0] && cs.o === M, JSON.stringify(cs));
  T('[1] spoiled: ... his record saying he won is a dispute, not a claim', v.lone1v1Spoiled(note([st]), key, [res, R(durBad(rec(0xB1, MT.q11, h, 1, 1, true, ro, [4000, 7000])), M)], {}, new Set(), false, null) === null);
  const vc = v.lone1v1VoidClaims([{ m: key, pids: [], note: note([st]) }, { m: h + '_1234_5', pids: [], note: note([st]) }], { [key]: [res, bV], [h + '_1234_5']: [res, bV] }, [], {}, new Set(), true);
  T('[1] void claims: a voided key of the one queue -> its claim; a 2V2 key -> nothing', vc.length === 1 && vc[0].m === key, JSON.stringify(vc));
  // Q254 on the one queue: the winner's start read late with his result is kept for the lone verdict
  const e = { t0: 0, s: [], r: 1, c: 0 }, id = v.pid(O[0]) + '@0#' + v.startSig(st);
  T('[1] keepLateOwn: a 1V1 of the one queue -> kept in lo', v.keepLateOwn(e, st, id, new Set([v.pid(O[0])])) === true && JSON.stringify(e.lo) === JSON.stringify([id]), JSON.stringify(e));
  const e2 = { t0: 0, s: [], r: 1, c: 0 }, t2 = rec(0xB2, 5, h, 0, 0, false, [O[0], M, V, X]), s2 = S(t2);
  T('[1] keepLateOwn: a quick 2V2 -> not kept', v.keepLateOwn(e2, s2, v.pid(O[0]) + '@0#' + v.startSig(s2), new Set([v.pid(O[0])])) === false && !e2.lo);
  T('[1] lone1v1 claim with lo: paid on the one queue', !!v.lone1v1Claim({ t0: 0, s: [], lo: [id], r: 1, c: 0 }, key, [res], {}, new Set()));
}

// ---- [2] the modded player who writes only the 1V1s he wins, on the one queue (both seats ranked) ----
{
  const mt = MT.q11, h1 = 0x8611, h2 = 0x8612, h3 = 0x8613;
  // match 1: M (seat 1) beats O1, both write -> settles; M has signals from then on
  const r1 = [O[1], M];
  const m1 = [{ sid: O[1], d: qstart(mt, h1, 0, r1) }, { sid: M, d: qstart(mt, h1, 1, r1) }];
  const m1f = m1.concat([{ sid: O[1], d: qsettle(mt, h1, 0, r1, 1) }, { sid: M, d: qsettle(mt, h1, 1, r1, 1) }]);
  const steps = () => stepsOf(
    [[0, m1], [10 * MIN, m1f], [10 * MIN, m1f]],
    lone(mt, h2, O[2], M, m1f),                                       // O2 beats M, M writes nothing
    lone(mt, h3, O[3], M, m1f.concat(lone(mt, h2, O[2], M)[2][1])),   // O3 beats M; O2's rows still on the shards
    [[10 * MIN, m1f.concat(lone(mt, h2, O[2], M)[2][1], lone(mt, h3, O[3], M)[2][1])]]);
  const rs = timeline(steps());
  const k2 = keyOf(qstart(mt, h2, 0, [O[2], M])), k3 = keyOf(qstart(mt, h3, 0, [O[3], M]));
  T('[2] ten runs exit 0', allOk(rs, 10), last(rs).out.slice(-1200));
  T('[2] his win settles as usual (both wrote, both seats ranked): M up, O1 down', ptsIn(rs, M).length === 1 && ptsIn(rs, M)[0] > 2500 && ptsIn(rs, O[1]).length === 1 && ptsIn(rs, O[1])[0] < 2500,
    JSON.stringify([ptsIn(rs, M), ptsIn(rs, O[1])]));
  T('[2] O2\'s win: counted on M at its verdict (the consolation XP only, said so), O2 waits (nothing paid yet)',
    /counted on him \(1 such match\(es\), 1 different opponent\(s\)\), nobody flagged; payment waits for a second opponent's claim \(the consolation XP only: a 1V1 of the one quick \+ ranked queue, Q446 \/ O716 D12\) \(Q184\)/.test(rs[5].out)
    && !xpIn(rs.slice(3, 8), O[2]).length && processedOf(rs[5]).has(k2), why(rs.slice(5, 6)));
  T('[2] O3\'s win: counted (2 matches, 2 opponents), O3 and O2 paid', /counted on him \(2 such match\(es\), 2 different opponent\(s\)\), nobody flagged; winner paid/.test(rs[8].out)
    && processedOf(rs[8]).has(k3), why(rs.slice(8, 9)));
  T('[2] ... the consolation XP of a lone writer each (50), and no points at all (O716 D12)', JSON.stringify(xpIn(rs, O[2])) === '[50]' && JSON.stringify(xpIn(rs, O[3])) === '[50]'
    && !ptsIn(rs, O[2]).length && !ptsIn(rs, O[3]).length && (rs[8].out.match(XPONLY) || []).length === 2,
    JSON.stringify([xpIn(rs, O[2]), xpIn(rs, O[3]), ptsIn(rs, O[2]), ptsIn(rs, O[3])]));
  const sm = sigOf(last(rs), M);
  T('[2] M: counted 2 / 2 opponents, nothing waiting; no points from those, no exit, nobody flagged', sm && sm.l1 === 2 && sm.l1o.length === 2 && !('l1q' in sm)
    && ptsIn(rs, M).length === 1 && leavesOf(last(rs), M) === 0 && ALL.every(s => fOf(last(rs), s) === 0), JSON.stringify(sm));
  T('[2] summary rows: Q184 counted 1 / waiting 0 / paid 2 / no signals 0 / capped 0 (0 points written); Q446 the consolation XP only 2',
    JSON.stringify(sumRow(rs.slice(8, 9))) === '[1,0,2,0,0,0]' && xpRow(rs[8]) === 2 && xpRow(rs[5]) === 0, JSON.stringify([sumRow(rs.slice(8, 9)), xpRow(rs[8])]));
  T('[2] once only: the run after pays and counts nothing more', !xpIn([last(rs)], O[2]).length && !xpIn([last(rs)], O[3]).length && !LINE.test(last(rs).out) && sigOf(last(rs), M).l1 === 2);
  withMutant(MTS_FROM, 'const LONE1V1_MTS = [2];', '2old', (s) => {
    const m = timeline(steps(), s);
    T('[2] mutant: the old ranked code only (the code before Q446) -> O2 / O3 get nothing, nothing counted, the keys never processed', allOk(m, 10)
      && !xpIn(m, O[2]).length && !xpIn(m, O[3]).length && !(sigOf(last(m), M) || {}).l1 && !processedOf(last(m)).has(k2), why(m.slice(8, 9)));
  });
  withMutant(PAYS_FROM, 'function lone1v1PaysPoints(mt) { return true; }', '2pts', (s) => {
    const m = timeline(steps(), s);
    T('[2] mutant: a quick family claim paid like the old ranked code -> points written to O2 / O3 (what D12 rules out)', allOk(m, 10)
      && ptsIn(m, O[2]).length === 1 && ptsIn(m, O[3]).length === 1, JSON.stringify([ptsIn(m, O[2]), ptsIn(m, O[3])]));
  });
}

// ---- [3] the other masks: whichever seat came in through ranked, the consolation XP only ----
{
  for (const [tag, mt, i, h] of [['only the winner\'s seat ranked', MT.q01, 4, 0x8621], ['only the loser\'s seat ranked', MT.q10, 5, 0x8622], ['no seat ranked (plain quick)', MT.q00, 6, 0x8623]]) {
    const rs = timeline(lone(mt, h, O[i], M), null, atGate([M], M, O[0]));
    T('[3] ' + tag + ': at the gate -> the winner paid the consolation XP (50), no points; the silent seat counted, untouched', allOk(rs, 3) && /winner paid \(the consolation XP only/.test(rs[2].out)
      && JSON.stringify(xpIn(rs, O[i])) === '[50]' && !ptsIn(rs, O[i]).length && !ptsIn(rs, M).length && sigOf(last(rs), M).l1 === 2 && leavesOf(last(rs), M) === 0 && xpRow(rs[2]) === 1,
      why(rs) + ' xp ' + JSON.stringify(xpIn(rs, O[i])) + ' pts ' + JSON.stringify(ptsIn(rs, O[i])));
  }
}

// ---- [4] the old ranked code beside a quick family claim, and a claim queued before O480 ----
{
  // O4 beats M (the old ranked code 2) and V (the one queue) in one run, both silent seats at the gate
  const f = sigFile([M, V]);
  Object.assign(f.players[v.pid(M)], { l1: 1, l1o: [v.pid(O[0])] }); Object.assign(f.players[v.pid(V)], { l1: 1, l1o: [v.pid(O[0])] });
  const ha = 0x8631, hb = 0x8632, ra = [O[4], M], rb = [O[4], V];
  const st = [{ sid: O[4], d: qstart(2, ha, 0, ra) }, { sid: O[4], d: qstart(MT.q11, hb, 0, rb) }];
  const re = st.concat([{ sid: O[4], d: qsettle(2, ha, 0, ra, 0) }, { sid: O[4], d: qsettle(MT.q11, hb, 0, rb, 0) }]);
  const rs = timeline([[0, st], [10 * MIN, re], [VERDICT, re]], null, { SIGNALS_FILE: f });
  T('[4] one winner, an old ranked claim and a quick family claim in one run: the points of the ranked win only (2500 -> 2538), one consolation, the XP-only line for the other',
    allOk(rs, 3) && JSON.stringify(ptsIn(rs, O[4])) === '[2538]' && JSON.stringify(xpIn(rs, O[4])) === '[50]' && (rs[2].out.match(XPONLY) || []).length === 1
    && new RegExp('lone-1v1 ' + keyOf(qstart(MT.q11, hb, 0, rb)) + ': [0-9a-f]+ paid the consolation XP only').test(rs[2].out)
    && JSON.stringify(sumRow(rs.slice(2, 3))) === '[2,0,2,0,0,1]' && xpRow(rs[2]) === 1, why(rs) + ' ' + JSON.stringify([ptsIn(rs, O[4]), xpIn(rs, O[4]), sumRow(rs.slice(2, 3))]));
  // a claim queued before O480 carries no match key: it is the old ranked code's and pays points as before; the quick
  //   family claim that brings M to the gate pays its winner the consolation XP only
  const g = sigFile([M]);
  Object.assign(g.players[v.pid(M)], { l1: 1, l1o: [v.pid(O[2])], l1q: [{ w: v.pid(O[2]), t: Date.now() }] });
  const hq = 0x8633, rq = [O[2], O[1]];
  const prior = [{ sid: O[2], d: qstart(MT.q00, hq, 0, rq) }, { sid: O[1], d: qstart(MT.q00, hq, 1, rq) }, { sid: O[2], d: qsettle(MT.q00, hq, 0, rq, 1) }, { sid: O[1], d: qsettle(MT.q00, hq, 1, rq, 1) }];
  const rr = timeline(lone(MT.q11, 0x8634, O[5], M, prior), null, { SIGNALS_FILE: g });
  T('[4] a waiting claim from before O480 (no key) paid as before (points 2500 -> 2538), the new quick family claim the consolation XP only',
    allOk(rr, 3) && JSON.stringify(ptsIn(rr, O[2])) === '[2538]' && !ptsIn(rr, O[5]).length && JSON.stringify(xpIn(rr, O[5])) === '[50]' && !('l1q' in sigOf(last(rr), M)),
    why(rr) + ' ' + JSON.stringify([ptsIn(rr, O[2]), ptsIn(rr, O[5]), xpIn(rr, O[5])]));
}
withMutant("  const l1Pts = l1Res.pay.filter((p) => !p.m || lone1v1PaysPoints(String(p.m).split('_')[2] | 0));",
  "  const l1Pts = l1Res.pay.filter((p) => lone1v1PaysPoints(String(p.m).split('_')[2] | 0));", '4nokey', (s) => {
    const g = sigFile([M]);
    Object.assign(g.players[v.pid(M)], { l1: 1, l1o: [v.pid(O[2])], l1q: [{ w: v.pid(O[2]), t: Date.now() }] });
    const hq = 0x8635, rq = [O[2], O[1]];
    const prior = [{ sid: O[2], d: qstart(MT.q00, hq, 0, rq) }, { sid: O[1], d: qstart(MT.q00, hq, 1, rq) }, { sid: O[2], d: qsettle(MT.q00, hq, 0, rq, 1) }, { sid: O[1], d: qsettle(MT.q00, hq, 1, rq, 1) }];
    const m = timeline(lone(MT.q11, 0x8636, O[5], M, prior), s, { SIGNALS_FILE: g });
    T('[4] mutant: a claim with no key read as the quick family -> the pre-O480 ranked claim loses its points', allOk(m, 3) && !ptsIn(m, O[2]).length, JSON.stringify(ptsIn(m, O[2])));
  });

// ---- [5] Q216 on the one queue: the loser's own records the job cannot use ----
{
  const mt = MT.q11, L = V;
  const VEC = [7000, 4000];
  const lostQ = (h, ro) => rec(0xB1, mt, h, 1, 2, false, ro, VEC);
  const durBad = (d) => d.map((x, i) => i === 9 ? 90000 : x);
  const SHAPES = {
    V: (h, w) => ({ res: [durBad(lostQ(h, [w, L]))] }),                                 // no start, a result out of the sanity bounds
    U: (h, w) => ({ res: [lostQ(h, [w, w])] }),                                         // no start, a result naming his opponent twice
    S6: (h, w) => ({ start: [rec(0xB2, mt, h, 1, 0, false, [w, w])], res: [lostQ(h, [w, w])] }),   // that table in his start too
    Z: () => ({}),                                                                       // nothing (Q184)
  };
  function match(h, w, shape, extra) {
    const ro = [w, L], sh = SHAPES[shape](h, w);
    const st = [{ sid: w, d: qstart(mt, h, 0, ro) }].concat((sh.start || []).map(d => ({ sid: L, d })));
    const re = [{ sid: w, d: qsettle(mt, h, 0, ro, 0) }].concat((sh.res || []).map(d => ({ sid: L, d })));
    const ex = extra || [];
    return { steps: [[0, ex.concat(st)], [10 * MIN, ex.concat(st, re)], [VERDICT, ex.concat(st, re)]], recs: st.concat(re) };
  }
  const run = (shapes, script) => {
    const m0 = match(0x8641, O[7], shapes[0]), m1 = match(0x8642, O[8], shapes[1], m0.recs), m2 = match(0x8643, O[9], shapes[2], m0.recs.concat(m1.recs));
    return timeline(stepsOf(m0.steps, m1.steps, m2.steps, [[HOUR, m0.recs.concat(m1.recs, m2.recs)]]), script, sigState([L]));
  };
  const rs = run(['S6', 'V', 'U']), twin = run(['Z', 'Z', 'Z']);
  T('[5] all runs ok', allOk(rs, 10) && allOk(twin, 10), rs.map(r => r.code).join(','));
  T('[5] the three shapes counted on the loser as Q216 (3 matches, 3 opponents), nobody flagged but his own out-of-bounds duration (V, as before)',
    (outOf(rs).match(/wrote only records the job cannot use \(Q216\) -- counted on him/g) || []).length === 3 && (sigOf(last(rs), L) || {}).l1 === 3 && fOf(last(rs), L) === 1
      && [7, 8, 9].every(i => fOf(last(rs), O[i]) === 0), why(rs));
  T('[5] each winner: the consolation XP once (O7 consoled at the S6 void, not twice), no points -- the same as the silent-loser twin',
    [7, 8, 9].every(i => JSON.stringify(xpIn(rs, O[i])) === '[50]' && JSON.stringify(xpIn(twin, O[i])) === '[50]' && !ptsIn(rs, O[i]).length && !ptsIn(twin, O[i]).length) && !ptsIn(rs, L).length,
    JSON.stringify([7, 8, 9].map(i => [xpIn(rs, O[i]), xpIn(twin, O[i]), ptsIn(rs, O[i])])));
  withMutant("  if (!e || !Array.isArray(e.s) || !g || !g.length || !lone1v1Mt(g[0].d[2])) return null;   // Q446: as lone1v1Claim",
    "  if (!e || !Array.isArray(e.s) || !g || !g.length || mtSansSeats(g[0].d[2]) !== 2) return null;", '5old', (s) => {
      const m = run(['S6', 'V', 'U'], s);
      T('[5] mutant: Q216 on the old ranked code only (before Q446) -> nothing counted, O8 / O9 get nothing', allOk(m, 10) && !(sigOf(last(m), L) || {}).l1 && !xpIn(m, O[8]).length && !xpIn(m, O[9]).length,
        JSON.stringify([xpIn(m, O[8]), xpIn(m, O[9])]));
    });
  withMutant("    if (!vk || !vk.note || !lone1v1Mt(String(vk.m).split('_')[2] | 0)) continue;   // Q446: the quick family's 1V1s too",
    "    if (!vk || !vk.note || (String(vk.m).split('_')[2] | 0) !== 2) continue;", '5void', (s) => {
      const m = run(['S6', 'V', 'U'], s);
      T('[5] mutant: the voided keys of the one queue not claimed (before Q446) -> the U winner (contest void) gets nothing', allOk(m, 10) && !xpIn(m, O[9]).length && (sigOf(last(m), L) || {}).l1 === 1,
        JSON.stringify([xpIn(m, O[9]), (sigOf(last(m), L) || {}).l1]));
    });
}

// ---- [6] Q254 on the one queue: an outside start read before the result, the winner's own start late ----
{
  const mt = MT.q11, Wn = O[10], L = M, ro = [Wn, L];
  const files = () => atGate([L, Wn, X, Y], L, O[11]);
  // run 1: only X's copy of a start of the key is read (from the silent seat's seat), then taken down; run 2: the winner's start
  //   and result first read together; run 3: the verdict
  const steps = (h) => { const xs = { sid: X, d: qstart(mt, h, 1, ro) }, w2 = [{ sid: Wn, d: qstart(mt, h, 0, ro) }, { sid: Wn, d: qsettle(mt, h, 0, ro, 0) }];
    return [[0, [xs]], [10 * MIN, w2], [VERDICT, w2]]; };
  const rs = timeline(steps(0x8651), null, files());
  T('[6] the winner\'s late start kept (lo), the outside id in s read nowhere -> the winner paid the consolation XP, no points; the silent seat counted',
    allOk(rs, 3) && /start-late-own: 1 late/.test(rs[1].out) && /winner paid \(the consolation XP only/.test(rs[2].out) && JSON.stringify(xpIn(rs, Wn)) === '[50]' && !ptsIn(rs, Wn).length
      && (sigOf(last(rs), L) || {}).l1 === 2 && fOf(last(rs), X) === 0, why(rs));
  withMutant('  if (!lone1v1Mt(r.d[2]) || (r.d[8] | 0) !== 2 || !resW) return false;   // Q446: the quick family\'s 1V1s too',
    '  if (mtSansSeats(r.d[2]) !== 2 || (r.d[8] | 0) !== 2 || !resW) return false;', '6old', (s) => {
      const m = timeline(steps(0x8652), s, files());
      T('[6] mutant: the late start of the one queue not kept (before Q446) -> paid nobody', allOk(m, 3) && !LINE.test(outOf(m)) && !xpIn(m, Wn).length && (sigOf(last(m), L) || {}).l1 === 1, why(m));
    });
}

// ---- [7] honest controls on the one queue, as before ----
{
  const mt = MT.q11, ro = [O[5], M];
  const one = (h, opt) => timeline(lone(mt, h, O[5], M, [], opt), null, sigState([M, O[5]]));
  const ha = 0x8661, ra = one(ha, { more: [{ sid: M, d: qstart(mt, ha, 1, ro) }] });
  T('[7a] the loser wrote his own start: the start-orphan verdict as before (his exit, the winner\'s consolation), nothing from Q184',
    allOk(ra, 3) && leavesOf(last(ra), M) === 1 && JSON.stringify(xpIn(ra, O[5])) === '[50]' && !ptsIn(ra, O[5]).length && !LINE.test(outOf(ra)) && !(sigOf(last(ra), M) || {}).l1, why(ra));
  const nothing = (label, rs, key) => T(label, allOk(rs, 3) && !LINE.test(outOf(rs)) && !ptsIn(rs, O[5]).length && !xpIn(rs, O[5]).length && !(sigOf(last(rs), M) || {}).l1 && !processedOf(last(rs)).has(key), why(rs));
  const hb = 0x8662, conf = (h) => { const d = rec(0xB2, mt, h, 1, 0, false, ro); d[0] = 0xB5; d[12] = 5; return d; };
  nothing('[7b] he confessed (left the match and said so): nothing decided by Q184', one(hb, { more: [{ sid: M, d: conf(hb) }] }), keyOf(qstart(mt, hb, 0, ro)));
  const hc = 0x8663;
  nothing('[7c] a peers-gone result: nothing decided', one(hc, { res: qsettle(mt, hc, 0, ro, 0).map((x, i) => i === 12 ? 1 : x) }), keyOf(qstart(mt, hc, 0, ro)));
  const hd = 0x8664;
  nothing('[7d] his result says he lost: nothing decided', one(hd, { res: qsettle(mt, hd, 0, ro, 1) }), keyOf(qstart(mt, hd, 0, ro)));
}

// ---- [8] wiring pins ----
{
  T('[8] the match types: the old ranked 1V1 and the quick family base 1 (any seat mask), points for the old code only',
    SRC.split(MTS_FROM).length === 2 && SRC.split(PAYS_FROM).length === 2 && JSON.stringify(v.LONE1V1_MTS) === '[1,2]');
  T('[8] keepLateOwn / lone1v1Claim / lone1v1Spoiled / lone1v1VoidClaims each test lone1v1Mt', (SRC.match(/lone1v1Mt\(/g) || []).length === 5
    && /function keepLateOwn\(e, r, id, resW\) \{\n  if \(!lone1v1Mt\(r\.d\[2\]\)/.test(SRC) && /const r0 = g\[0\];\n  if \(!lone1v1Mt\(r0\.d\[2\]\)/.test(SRC)
    && /function lone1v1Spoiled\([^)]*\) \{\n  if \([^\n]*!lone1v1Mt\(g\[0\]\.d\[2\]\)\) return null;/.test(SRC) && /if \(!vk \|\| !vk\.note \|\| !lone1v1Mt\(String\(vk\.m\)\.split\('_'\)\[2\] \| 0\)\) continue;/.test(SRC));
  // the class: no other exact test on the old ranked code 2 by its match type -- a new one would leave the one queue's 1V1s out
  //   again (the shape of Q446); the one that stays decides the points (lone1v1PaysPoints)
  const exact = SRC.match(/(mtSansSeats\([^)]*\)|split\('_'\)\[2\] \| 0\)|d\[2\] \| 0\)) (!==|===) 2\b/g) || [];   // (the same pattern as EXACT below)
  T('[8] class: the only exact test on match type 2 (seat mask off) in validate.js is lone1v1PaysPoints', exact.length === 1 && exact[0] === 'mtSansSeats(mt) === 2', JSON.stringify(exact));
  const EXACT = /(mtSansSeats\([^)]*\)|split\('_'\)\[2\] \| 0\)|d\[2\] \| 0\)) (!==|===) 2\b/g;
  const reverted = SRC.replace("  if (!lone1v1Mt(r0.d[2]) || (r0.d[8] | 0) !== 2) return null;", "  if (mtSansSeats(r0.d[2]) !== 2 || (r0.d[8] | 0) !== 2) return null;")
    .replace("    if (!vk || !vk.note || !lone1v1Mt(String(vk.m).split('_')[2] | 0)) continue;", "    if (!vk || !vk.note || (String(vk.m).split('_')[2] | 0) !== 2) continue;");
  T('[8] class wire self-check: the two shapes the code before Q446 had (lone1v1Claim, lone1v1VoidClaims) are both caught', reverted !== SRC && (reverted.match(EXACT) || []).length === 3);
  const at = (re) => { const m = re.exec(SRC); return m ? m.index : -1; };
  const iFilt = at(/\n  const l1Pts = l1Res\.pay\.filter\(\(p\) => !p\.m \|\| lone1v1PaysPoints\(String\(p\.m\)\.split\('_'\)\[2\] \| 0\)\);/);
  const iPay = at(/\n  else if \(l1Pts\.length\) \{/), iLoop = at(/\n    for \(const p of l1Pts\) \{ if \(!bySid\.has\(p\.sid\)\)/), iCons = at(/\n  if \(paySids\.length && XP_LB\) \{/);
  T('[8] main: the consolation (every payment), then the points of the old ranked claims only', iCons > 0 && iFilt > iCons && iPay > iFilt && iLoop > iPay, JSON.stringify([iCons, iFilt, iPay, iLoop]));
}

// ---- [9] the late loser: the quick family waits past his game's last upload ----
{
  const mt = MT.q11, ro = [O[1], M];
  const run = (h, script, lateAt) => {
    const wS = { sid: O[1], d: qstart(mt, h, 0, ro) }, wR = { sid: O[1], d: qsettle(mt, h, 0, ro, 0) };
    const lS = { sid: M, d: qstart(mt, h, 1, ro) }, lR = { sid: M, d: qsettle(mt, h, 1, ro, 0) };
    // the winner's start, his result ten minutes on; runs at 2 h 10 min (the start maturity) and 2 h 20 min; the loser's
    //   start and result first read at lateAt (his game's outbox got through), then two more runs
    const both = [wS, wR, lS, lR], one = [wS, wR];
    return timeline([[0, [wS]], [10 * MIN, one], [2 * HOUR, one], [lateAt, both], [10 * MIN, both], [10 * MIN, both]], script, atGate([M, O[1]], M, O[0]));
  };
  const rs = run(0x8691, null, 10 * MIN);
  T('[9] the start maturity passed, the winner alone so far: not decided yet (the quick family waits QUICK_WAIT_MS)', allOk(rs, 6) && !LINE.test(rs[2].out) && !processedOf(rs[2]).has(keyOf(qstart(mt, 0x8691, 0, ro))), why(rs.slice(2, 3)));
  T('[9] the loser\'s rows come in at 2 h 20 min: the match settles in full for both, as before Q446 (points both ways, the win and the loss XP); nothing from Q184',
    ptsIn(rs, O[1]).length === 1 && ptsIn(rs, O[1])[0] > 2500 && ptsIn(rs, M).length === 1 && ptsIn(rs, M)[0] < 2500 && xpIn(rs, O[1]).length === 1 && xpIn(rs, O[1])[0] > 50
      && xpIn(rs, M).length === 1 && !LINE.test(outOf(rs)) && (sigOf(last(rs), M) || {}).l1 === 1 && leavesOf(last(rs), M) === 0,
    JSON.stringify([ptsIn(rs, O[1]), ptsIn(rs, M), xpIn(rs, O[1]), xpIn(rs, M)]) + ' ' + why(rs));
  withMutant("    if (!lone1v1PaysPoints(String(key).split('_')[2] | 0) && now - (e.t0 || 0) < Math.max(maturityMs, LONE1V1.QUICK_WAIT_MS)) continue;   // Q446: past the loser's last upload\n", '', '9wait', (s) => {
    const m = run(0x8692, s, 10 * MIN);
    T('[9] mutant: no QUICK_WAIT_MS -> the verdict at the start maturity closes the key under the late loser: the winner the consolation alone, the loser nothing',
      allOk(m, 6) && LINE.test(m[2].out) && JSON.stringify(xpIn(m, O[1])) === '[50]' && !ptsIn(m, O[1]).length && !xpIn(m, M).length && !ptsIn(m, M).length,
      JSON.stringify([ptsIn(m, O[1]), xpIn(m, O[1]), xpIn(m, M)]));
  });
  T('[9] QUICK_WAIT_MS covers the outbox: 3 h >= the client\'s 2 h after a 1V1\'s end (up to about 40 min after its first start) + a run', v.LONE1V1.QUICK_WAIT_MS === 3 * HOUR && v.LONE1V1.QUICK_WAIT_MS >= 2 * HOUR + 40 * MIN + 10 * MIN);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (lone-1v1-quick-family) ===');
process.exit(failN === 0 ? 0 : 1);
