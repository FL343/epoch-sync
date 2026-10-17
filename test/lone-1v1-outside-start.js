'use strict';
// Q254 (cloud audit 2026-10): an account that is not in a ranked 1V1 could make the Q184 verdict pay nobody. The key's note
//   turns to "result read" once a start was seen before the result (one in s, or one past its writer's room: only n), and
//   neither says whose start it was. An outside account copied the key off the winner's public start and wrote a start of
//   its own that a run read before the result; when the winner's own start was then first read in the run that read his
//   result too, it was late and left out: s was empty (the outside start past its room) or held only the outside id, and
//   lone1v1Claim returned null -- the honest winner of a match whose loser wrote nothing lost his win. Now the winner's late
//   start (a ranked 1V1, his table seating him where he writes from, his result read in the same run) is remembered in the
//   note's lo (keepLateOwn, at most LONE1V1_LATE_CAP) for the lone verdict only -- it still votes nowhere -- and the claim
//   reads only the starts of the two accounts the winner's table seats.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/lone-1v1-win.js).
//   [1] units: keepLateOwn (kept; the same id twice; the cap; a quick 1V1; a 2V2; no result of his this run; a table that
//       does not seat him there), lone1v1Claim with lo and outside ids (paid / not paid, each condition)
//   [2] the n path: the outside account holds SEEN_PER_WRITER remembered starts, its copy of the winner's start is read
//       first (n only), the winner's start is first read with his result -> the winner is paid, the silent seat counted,
//       nobody flagged, the winner's late start still votes nowhere; mutants (no lo kept / lo not read) -> paid nobody
//   [3] the s path: the outside start in the room (its id in s), from the silent seat's seat and from the winner's -> paid;
//       mutant (every id in s read, the code before Q254) -> paid nobody
//   [4] controls, as before: a lone winner whose start and result were first read together with no outside start (paid,
//       nothing kept late); the silent seat's own start read before the result (no verdict: his own word that he played);
//       the outside account also wrote a result (no verdict); an outside start read before the result together with the
//       winner's (it votes: the roster registers, the start-orphan verdict gives the winner the consolation only)
//   [5] wiring pins
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lone-1v1-outside-'));
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
// a 1V1 the winner W (seat 0) wrote alone against L (seat 1): his start, ten minutes later his result, the verdict two hours on
//   extra: rows that stay on the shards the whole time (earlier matches); opt.res / opt.start: replace his records
const W1 = 1;   // v1settle(…, winner): seat 0 wins with [7000, 4000]
function lone(h, w, l, extra, opt) {
  opt = opt || {};
  const ro = [w, l];
  const st = { sid: w, d: opt.start || v1start(h, 0, ro) };
  const re = { sid: w, d: opt.res || v1settle(h, 0, ro, 0) };
  const more = opt.more || [];
  const ex = extra || [];
  return [[0, ex.concat([st], more)], [10 * MIN, ex.concat([st, re], more)], [2 * HOUR, ex.concat([st, re], more), opt.env]];
}
const stepsOf = (...parts) => [].concat(...parts);
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-lone-1v1-outside-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

console.log('=== an outside start no longer keeps a lone ranked 1V1 winner from his pay (Q254) ===');

// the winner W (seat 0) beats the silent L (seat 1); an outside account writes a copy of a start of the key
const Wn = O[6], L = M, prior = O[7];
const ro = [Wn, L];
// L already counted once by another opponent: the next claim is at the gate (paid at once)
const filesAt = (extraStarts) => { const f = atGate([L, Wn, X, Y], L, prior); if (extraStarts) f.STARTS_FILE = extraStarts; return f; };
// the outside account's room spent on another key (SEEN_PER_WRITER ids): its next starts are not remembered (n only)
const roomFull = (sid) => ({ ['~999_1234_2']: { t0: Date.now(), s: Array.from({ length: v.SEEN_PER_WRITER }, (_, i) => v.pid(sid) + '@1#f' + i), r: 0, c: 0 } });
// run 1: only the outside start is read (the winner's start not up yet, or its shard missed); run 2, ten minutes on: his
//   start and his result are first read together; run 3, two hours on: the verdict. withdrawn: the outside account takes
//   its start down after run 1 (kept up and in s, it contests the key when the result is read: [3c])
const outside = (h, xs, more, withdrawn) => { const x = withdrawn ? [] : [xs];
  return [[0, [xs].concat(more || [])], [10 * MIN, x.concat([{ sid: Wn, d: v1start(h, 0, ro) }, { sid: Wn, d: v1settle(h, 0, ro, 0) }], more || [])],
    [2 * HOUR, x.concat([{ sid: Wn, d: v1start(h, 0, ro) }, { sid: Wn, d: v1settle(h, 0, ro, 0) }], more || [])]]; };
const paid = (rs) => allOk(rs, 3) && LINE.test(rs[2].out) && /winner paid \(Q184\)/.test(rs[2].out) && ptsIn(rs, Wn).length === 1 && ptsIn(rs, Wn)[0] > 2500
  && !ptsIn(rs, L).length && (sigOf(last(rs), L) || {}).l1 === 2 && fOf(last(rs), L) === 0 && fOf(last(rs), X) === 0;
const unpaid = (rs) => allOk(rs, 3) && !LINE.test(outOf(rs)) && !ptsIn(rs, Wn).length && (sigOf(last(rs), L) || {}).l1 === 1;
const why = (rs) => outOf(rs).split('\n').filter(l => /start-|lone-1v1|contest/.test(l)).join(' | ');
const LO_FROM = '  if (!theirs.length && !(Array.isArray(e.lo) && e.lo.indexOf(own) >= 0)) return null;   // Q254: or his own start, read late with his result';
const KEEP_FROM = '      if (e.r) { late.add(r); if (keepLateOwn(e, r, id, resBy[m])) keptOwn++; continue; }   // Q254: lo, for the lone 1V1 verdict only';
const FILTER_FROM = "  const theirs = e.s.filter((id) => { const h = String(id).split('@')[0]; return h === wp || h === op; });   // Q254: the seated accounts' only";

// ---- [1] units ----
{
  T('[1] keepLateOwn / LONE1V1_LATE_CAP exported, the cap is 2', typeof v.keepLateOwn === 'function' && v.LONE1V1_LATE_CAP === 2, typeof v.keepLateOwn + ' ' + v.LONE1V1_LATE_CAP);
  const h = 0x8541;
  const S = (d, sid) => ({ start: true, steamID: sid, d, roster: v.decodeRoster(d) });
  const R = (d, sid) => { const pc = d[8] | 0; return { steamID: sid, d, dispCode: d[10 + pc] | 0, roster: v.decodeRoster(d) }; };
  const idOf = (s) => v.pid(String(s.steamID)) + '@' + (s.d[5] | 0) + '#' + v.startSig(s);
  const st = S(v1start(h, 0, ro), Wn), res = R(v1settle(h, 0, ro, 0), Wn), key = keyOf(res.d);
  const resW = new Set([v.pid(Wn)]);
  if (typeof v.keepLateOwn === 'function') {
    const e = { t0: 0, s: [], r: 1, c: 0 };
    T('[1] keep: his late start, his result read this run -> noted in lo', v.keepLateOwn(e, st, idOf(st), resW) === true && JSON.stringify(e.lo) === JSON.stringify([idOf(st)]), JSON.stringify(e));
    T('[1] keep: the same id again -> not twice', v.keepLateOwn(e, st, idOf(st), resW) === false && e.lo.length === 1);
    const st2 = S(v1start(h, 1, [X, Wn]), Wn), st3 = S(v1start(h, 0, [Wn, Y]), Wn);
    T('[1] keep: a second id of his (another seat / table) -> kept up to the cap', v.keepLateOwn(e, st2, idOf(st2), resW) === true && e.lo.length === 2);
    T('[1] keep: past LONE1V1_LATE_CAP -> not kept', v.keepLateOwn(e, st3, idOf(st3), resW) === false && e.lo.length === 2);
    const no = (label, s, rw) => { const e2 = { t0: 0, s: [], r: 1, c: 0 }; T('[1] not kept: ' + label, v.keepLateOwn(e2, s, idOf(s), rw) === false && !(e2.lo && e2.lo.length)); };
    no('a quick 1V1 (match type 1)', S(v1start(h, 0, ro).map((x, i) => i === 2 ? 1 : x), Wn), resW);
    no('party bits on the match type', S(v1start(h, 0, ro).map((x, i) => i === 2 ? 0x12 : x), Wn), resW);
    no('a ranked 2V2', S(t2start(h, 0, [Wn, X, Y, Z]), Wn), resW);
    no('no result of his read this run', st, new Set([v.pid(X)]));
    no('no result of the key read this run', st, undefined);
    no('his table does not seat him where he writes from', S(v1start(h, 0, [V, L]), Wn), resW);
    no('an outside account\'s copy (the table seats somebody else there)', S(v1start(h, 1, ro), X), new Set([v.pid(X)]));
  } else bad('[1] keepLateOwn missing (the code before Q254)');
  const own = idOf(st), outS1 = idOf(S(v1start(h, 1, ro), X)), outS0 = idOf(S(v1start(h, 0, ro), Y)), lsil = idOf(S(v1start(h, 1, ro), L));
  const claim = (s, lo, g) => v.lone1v1Claim(Object.assign({ t0: 0, s, r: 1, c: 0 }, lo ? { lo } : {}), key, g || [res], {}, new Set());
  const yes = (label, s, lo) => { const c = claim(s, lo); T('[1] claim: ' + label, !!c && c.w === Wn && c.o === L && c.seat === 0, JSON.stringify(c)); };
  const nope = (label, s, lo, g) => T('[1] no claim: ' + label, claim(s, lo, g) === null);
  yes('his start in s (Q184 as before)', [own]);
  yes('s empty, his own start read late with his result (lo)', [], [own]);
  yes('only an outside account\'s start in s, his own late (lo)', [outS1], [own]);
  yes('an outside start from his own seat in s, his own late (lo)', [outS0], [own]);
  yes('his start and an outside one in s', [own, outS1]);
  nope('s empty, nothing in lo', []);
  nope('only an outside start in s, nothing in lo', [outS1]);
  nope('s empty, lo holds another of his ids (another table)', [], [idOf(S(v1start(h, 0, [Wn, Y]), Wn))]);
  nope('the silent seat\'s own start read before the result', [own, lsil]);
  nope('the silent seat\'s own start in s, his own late (lo)', [lsil], [own]);
  nope('a start of his from the other seat in s', [idOf(S(v1start(h, 1, [L, Wn]), Wn))], [own]);
  T('[1] no claim: a contested note (lo does not lift it)', v.lone1v1Claim({ t0: 0, s: [], lo: [own], r: 1, c: 1 }, key, [res], {}, new Set()) === null);
  nope('an outside account\'s result on the key', [], [own], [res, R(v1settle(h, 1, ro, 1), X)]);
}

// ---- [2] the n path: the outside account's room is spent, its copy only sets n ----
{
  const h = 0x8551, xs = { sid: X, d: v1start(h, 1, ro) };
  const steps = outside(h, xs);
  const rs = timeline(steps, null, filesAt(roomFull(X)));
  T('[2] run 1: the outside copy is past its writer\'s room (not remembered, n set)', allOk(rs, 3) && /start-seen-room: 1 account\(s\)/.test(rs[0].out)
    && ((rs[0].state.STARTS_FILE || {})['~' + keyOf(xs.d)] || {}).n === 1 && !((rs[0].state.STARTS_FILE || {})['~' + keyOf(xs.d)] || {}).s.length, why(rs));
  T('[2] run 2: the winner\'s start is late, noted for the lone verdict only, no roster registered',
    /start-late: 2 start\(s\)/.test(rs[1].out) && /start-late-own: 1 late ranked 1V1 start/.test(rs[1].out) && !/start-pending /.test(rs[1].out)
    && JSON.stringify(((rs[1].state.STARTS_FILE || {})['~' + keyOf(xs.d)] || {}).lo) === JSON.stringify([v.pid(Wn) + '@0#' + v.startSig({ d: v1start(h, 0, ro), roster: v.decodeRoster(v1start(h, 0, ro)) })]), why(rs));
  T('[2] run 3: the winner is paid the points of his win, the silent seat counted, nobody flagged', paid(rs), why(rs) + ' pts ' + JSON.stringify(ptsIn(rs, Wn)));
  T('[2] once: the key is processed, the note gone', processedOf(last(rs)).has(keyOf(xs.d)) && !((last(rs).state.STARTS_FILE || {})['~' + keyOf(xs.d)]));
  withMutant(KEEP_FROM, '      if (e.r) { late.add(r); continue; }', '2keep', (s) => {
    const m = timeline(steps, s, filesAt(roomFull(X)));
    T('[2] mutant: the late start not kept (the code before Q254) -> paid nobody', unpaid(m), why(m));
  });
  withMutant(LO_FROM, '  if (!theirs.length) return null;', '2lo', (s) => {
    const m = timeline(steps, s, filesAt(roomFull(X)));
    T('[2] mutant: lo not read -> paid nobody', unpaid(m), why(m));
  });
}

// ---- [3] the s path: the outside start in its room, read once (its id in s), then taken down ----
{
  const h = 0x8561, xs = { sid: X, d: v1start(h, 1, ro) };
  const steps = outside(h, xs, null, true);
  const rs = timeline(steps, null, filesAt());
  T('[3] the outside copy from the silent seat\'s seat in s, the winner\'s start late -> the winner is paid', paid(rs)
    && JSON.stringify(((rs[0].state.STARTS_FILE || {})['~' + keyOf(xs.d)] || {}).s) === JSON.stringify([v.pid(X) + '@1#' + v.startSig({ d: xs.d, roster: v.decodeRoster(xs.d) })]), why(rs));
  withMutant(FILTER_FROM, '  const theirs = e.s;', '3filter', (s) => {
    const m = timeline(steps, s, filesAt());
    T('[3] mutant: every id in s read (the code before Q254) -> paid nobody', unpaid(m), why(m));
  });
  const h2 = 0x8562, xs2 = { sid: Y, d: v1start(h2, 0, ro) };
  const r2 = timeline(outside(h2, xs2, null, true), null, filesAt());
  T('[3b] the outside copy from the winner\'s own seat, read once (no dispute: his start is late, it votes nowhere) -> the winner is paid', paid(r2), why(r2));
  // (c) kept up, the outside start in s contests the key when the result is read (Q75 / Q127): void, nobody rated -- as
  //     before; a key with no complete table is not under the Q208 cap; the start-proof plan's (O462)
  const h3 = 0x8563, r3 = timeline(outside(h3, { sid: X, d: v1start(h3, 1, ro) }), null, filesAt());
  T('[3c] the outside start kept up: contested and voided as before, nothing from Q184', allOk(r3, 3) && /contest-void [0-9_]+: contested since/.test(r3[2].out)
    && !LINE.test(outOf(r3)) && !ptsIn(r3, Wn).length && (sigOf(last(r3), L) || {}).l1 === 1, why(r3));
}

// ---- [4] controls ----
{
  // (a) no outside start: his start and result first read together (the job stalled) -- every start kept, as before
  const ha = 0x8571;
  const ra = timeline([[0, [{ sid: Wn, d: v1start(ha, 0, ro) }, { sid: Wn, d: v1settle(ha, 0, ro, 0) }]], [10 * MIN, [{ sid: Wn, d: v1start(ha, 0, ro) }, { sid: Wn, d: v1settle(ha, 0, ro, 0) }]],
    [2 * HOUR, [{ sid: Wn, d: v1start(ha, 0, ro) }, { sid: Wn, d: v1settle(ha, 0, ro, 0) }]]], null, filesAt());
  T('[4a] no outside start, start and result read together: paid as before, nothing kept late', paid(ra) && !/start-late/.test(outOf(ra)), why(ra));
  // (b) the silent seat's own start read before the result, the winner's late: no verdict (his own word that he played)
  const hb = 0x8572, rb = timeline(outside(hb, { sid: L, d: v1start(hb, 1, ro) }), null, filesAt());
  T('[4b] the silent seat\'s own start read first: no lone verdict, nothing paid, not counted (as before)', unpaid(rb), why(rb));
  // (c) the outside account wrote a result too: the claim needs every record of the key to be the winner's
  const hc = 0x8573, rc = timeline(outside(hc, { sid: X, d: v1start(hc, 1, ro) }, [{ sid: X, d: v1settle(hc, 1, ro, 1) }]), null, filesAt());
  T('[4c] the outside account also wrote a result: no lone verdict (as before)', allOk(rc, 3) && !LINE.test(outOf(rc)) && !ptsIn(rc, Wn).length, why(rc));
  // (d) the outside start read before the result together with the winner's: it votes, a roster registers (no lone path;
  //     the start-orphan verdict gives the winner the consolation only, nobody convicted) -- the start-proof plan's (O462)
  const hd = 0x8574, xd = { sid: X, d: v1start(hd, 1, ro) };
  const rd = timeline([[0, [xd, { sid: Wn, d: v1start(hd, 0, ro) }]], [10 * MIN, [xd, { sid: Wn, d: v1start(hd, 0, ro) }, { sid: Wn, d: v1settle(hd, 0, ro, 0) }]],
    [2 * HOUR, [xd, { sid: Wn, d: v1start(hd, 0, ro) }, { sid: Wn, d: v1settle(hd, 0, ro, 0) }]]], null, filesAt());
  T('[4d] an outside start voting with the winner\'s before the result: registered, consolation only, nothing from Q184 (as before)',
    allOk(rd, 3) && /start-pending /.test(rd[0].out) && !LINE.test(outOf(rd)) && !ptsIn(rd, Wn).length && JSON.stringify(xpIn(rd, Wn)) === '[50]' && !leavesOf(last(rd), L), why(rd));
  // (e) both players wrote (start and result), the outside copy past its room read first: the match settles as before
  const he = 0x8575, xe = { sid: X, d: v1start(he, 1, ro) }, both = [{ sid: L, d: v1start(he, 1, ro) }, { sid: L, d: v1settle(he, 1, ro, 0) }];
  const wb = [{ sid: Wn, d: v1start(he, 0, ro) }, { sid: Wn, d: v1settle(he, 0, ro, 0) }].concat(both);
  const re = timeline([[0, [xe]], [10 * MIN, [xe].concat(wb)], [2 * HOUR, [xe].concat(wb)]], null, filesAt(roomFull(X)));
  T('[4e] both players wrote, an outside copy set n first: settled by the two results as before (their late starts in lo feed nothing else)',
    allOk(re, 3) && processedOf(last(re)).has(keyOf(xe.d)) && !LINE.test(outOf(re)) && /settle [0-9_]+: /.test(re[2].out)
    && ptsIn(re, Wn).length === 1 && ptsIn(re, Wn)[0] > 2500 && ptsIn(re, L).length === 1 && ptsIn(re, L)[0] < 2500, why(re));
}

// ---- [5] wiring pins ----
{
  T('[5] screenLateStarts runs before the starts register (reconcileStarts), on this run\'s results',
    /\n  screenLateStarts\(starts, recs, startsPending, processed, Date\.now\(\), shardsComplete\);/.test(SRC)
    && SRC.indexOf('  screenLateStarts(starts, recs, startsPending') < SRC.indexOf('const startsRes = reconcileStarts('));
  T('[5] the late branch notes the winner\'s own start and still leaves it out', SRC.split(KEEP_FROM).length === 2);
  T('[5] the claim reads lo and the seated accounts only', SRC.split(LO_FROM).length === 2 && SRC.split(FILTER_FROM).length === 2);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (lone-1v1-outside-start) ===');
process.exit(failN === 0 ? 0 : 1);
