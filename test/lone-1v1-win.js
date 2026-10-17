'use strict';
// Q184 (cloud audit 2026-10): a ranked 1V1 whose loser wrote nothing. A 1V1 key needs two start votes to register a roster
//   and two writers to settle, so a loser who writes no start, no result and no confession (a modded client, or a side
//   program blanking his rows once he has lost) left the winner's start and result alone: never settled, never judged, the
//   winner's win lost, the loser's loss gone (Q174 R3). Now the job decides such a key at the start maturity
//   (lone1v1Verdicts / lone1v1Claim): counted on the silent seat's account (if it has signals of its own), nobody flagged,
//   the silent seat untouched; the winner is paid the points of a normal 1V1 win (plus the consolation XP) once two
//   different accounts have made such a claim against that account (the claims before wait and are paid then), at most
//   three payments per claimant a week (lone1v1Count).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/late-start-roster.js).
//   [1] units: lone1v1Claim (each condition), lone1v1Count (no signals, waiting, the gate and the waiting claims, the same
//       opponent twice, the weekly cap, the 14-day wait, the opponent cap)
//   [2] a modded player M writes the 1V1s he wins and nothing when he loses: his first win settles (both write), O2 beats
//       him (only O2 writes) -- counted, O2 waits; O3 beats him -- counted, O3 paid and O2 paid; M untouched, nobody
//       flagged, nobody convicted; the summary row; once only (later runs pay nothing more); mutant (no verdict, the
//       code before Q184) -> O2 / O3 never paid, nothing counted
//   [2b-2d] a payment: the series clamp of a normal win, the season seed of a first settle, and the same points the match
//       written by both would have given the winner (a strong winner's mismatch compression included)
//   [3] forgery: one account X writes three 1V1 wins against V: counted on V, never paid (mutant: GATE 1 -> paid); a
//       second account Y joins (pinned, same floor as two colluders settling matches between themselves): Y and X's three
//       waiting claims paid; the weekly cap holds X's next ones; a week later he is paid again
//   [4] honest controls, nothing decided by Q184: the loser wrote his own start (the start-orphan verdict, as before);
//       a peers-gone result; a quick 1V1; a result that says its writer lost (mutant: no win check -> counted); the silent
//       seat has no signals of his own (logged, no entry made); he confessed (mutant: no confession check -> counted); an
//       outside start naming another table (the roster contest voids it, as before; the starts check itself is a unit in
//       [1]); an incomplete read holds the verdict until a full one (mutant: no hold -> decided on the partial read)
//   [5] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lone-1v1-win-'));
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
  const script = path.join(__dirname, '..', '.mutant-lone-1v1-win-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };
const NOVERDICT_FROM = '    if (pending[key] || processed.has(key) || !e || e.c || now - (e.t0 || 0) < maturityMs) continue;';

console.log('=== a ranked 1V1 only its winner wrote: counted on the silent seat, the winner paid (Q184) ===');

// ---- [1] units ----
{
  const L = v.LONE1V1;
  T('[1] LONE1V1: gate 2 opponents, 8 kept, 4 waiting for 14 days, 3 payments a week',
    L.GATE === 2 && L.OPP_CAP === 8 && L.QUEUE_CAP === 4 && L.RETRO_MS === 14 * DAY && L.WEEK_MS === 7 * DAY && L.WEEK_CAP === 3, JSON.stringify(L));
  const ro = [O[0], M], h = 0x8401;
  const R = (d, sid) => { const pc = d[8] | 0; return { steamID: sid || O[0], d, dispCode: d[10 + pc] | 0, roster: v.decodeRoster(d) }; };
  const S = (d, sid) => ({ start: true, steamID: sid || O[0], d, roster: v.decodeRoster(d) });
  const st = S(v1start(h, 0, ro)), res = R(v1settle(h, 0, ro, 0)), key = keyOf(res.d);
  const note = (starts) => ({ t0: 0, s: starts.map(s => v.pid(String(s.steamID)) + '@' + (s.d[5] | 0) + '#' + v.startSig(s)), r: 1, c: 0 });
  const c0 = v.lone1v1Claim(note([st]), key, [res], {}, new Set());
  T('[1] claim: the plain case -> winner, silent seat, the winner\'s seat', c0 && c0.w === O[0] && c0.o === M && c0.seat === 0 && c0.m === key, JSON.stringify(c0));
  T('[1] claim: a copy of his result (a retry) is the same claim', !!v.lone1v1Claim(note([st, st]), key, [res, R(v1settle(h, 0, ro, 0))], {}, new Set()));
  const no = (label, e, g, cs, seen) => T('[1] no claim: ' + label, v.lone1v1Claim(e, key, g, cs || {}, seen || new Set()) === null);
  no('no start read before the result', note([]), [res]);
  no('a contested note', Object.assign(note([st]), { c: 1 }), [res]);
  no('a quick 1V1', note([S(v1start(h, 0, ro).map((x, i) => i === 2 ? 1 : x))]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 2 ? 1 : x))]);
  no('party bits on the match type', note([st]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 2 ? 0x12 : x))]);
  no('three seats', note([st]), [R(rec(0xB1, 2, h, 0, 1, true, [O[0], M, V], [7000, 4000, 3000]))]);
  no('his result says he lost', note([st]), [R(v1settle(h, 0, ro, 1))]);
  no('a tie', note([st]), [R(rec(0xB1, 2, h, 0, 1, true, ro, [5000, 5000]))]);
  no('a peers-gone result', note([st]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 12 ? 1 : x))]);
  no('a result from a seat the record does not give its writer', note([st]), [R(v1settle(h, 0, ro, 0), V)]);
  no('a second writer on the key', note([st]), [res, R(v1settle(h, 1, ro, 0), M)]);
  no('his result names another table', note([st]), [R(v1settle(h, 0, [O[0], V], 0))]);
  // an account writing his start and result from a seat the roster he names gives somebody else
  const ro3 = [V, M], stX = S(v1start(h, 0, ro3), X);
  no('a writer the table he names does not seat (start and result from seat 0, V named there)', note([stX]), [R(v1settle(h, 0, ro3, 0), X)]);
  no('a second result of his naming another table', note([st]), [res, R(v1settle(h, 0, [O[0], V], 0))]);
  no('the silent seat\'s own start read before the result', note([st, S(v1start(h, 1, ro), M)]), [res]);   // (an account the table does not seat: test/lone-1v1-outside-start.js, Q254)
  no('the silent seat confessed (counted earlier)', note([st]), [res], { [v.pid(M) + '|' + key]: { t0: 1 } });
  no('the silent seat confessed (read this run)', note([st]), [res], {}, new Set([v.pid(M) + '|' + key]));
  no('a score past the sanity cap', note([st]), [R(rec(0xB1, 2, h, 0, 1, true, ro, [v.SANITY.SCORE_CAP + 1, 4000]))]);
  // lone1v1Count
  const now = 50 * DAY;
  const cl = (w, l, m) => ({ m: m || ('k_' + w + '_' + l), w, o: l, seat: 0 });
  const sid = (h2) => [O[0], O[1], O[2], O[3], O[4], X, Y].find(s => v.pid(s) === h2) || null;
  let sg = sigFile([M]);
  let r = v.lone1v1Count([cl(O[0], V)], sg, now, sid);
  T('[1] count: no signals of his own -> not counted, no entry made, not paid', r.nosig === 1 && r.counted === 0 && !sg.players[v.pid(V)] && !r.pay.length);
  const at0 = sg.players[v.pid(M)].at;
  r = v.lone1v1Count([cl(O[0], M)], sg, now, sid);
  const pm = sg.players[v.pid(M)];
  T('[1] count: the first claim -> counted on him, waits (l1q), nobody paid, his entry not refreshed', r.counted === 1 && r.queued === 1 && !r.pay.length && pm.l1 === 1
    && pm.l1o.length === 1 && pm.l1q.length === 1 && pm.l1q[0].w === v.pid(O[0]) && pm.at === at0, JSON.stringify(pm));
  r = v.lone1v1Count([cl(O[0], M, 'k2')], sg, now, sid);
  T('[1] count: the same opponent again -> two matches, one opponent, both wait', pm.l1 === 2 && pm.l1o.length === 1 && pm.l1q.length === 2 && !r.pay.length);
  r = v.lone1v1Count([cl(O[1], M)], sg, now + 1, sid);
  T('[1] count: a second opponent -> his claim paid and both waiting claims paid, the queue gone', r.pay.length === 3 && r.pay[0].sid === O[1]
    && r.pay.filter(p => p.sid === O[0]).length === 2 && !('l1q' in pm) && pm.l1o.length === 2, JSON.stringify(r.pay));
  T('[1] count: each payment marks its claimant (l1t)', sg.players[v.pid(O[0])].l1t.length === 2 && sg.players[v.pid(O[1])].l1t.length === 1);
  r = v.lone1v1Count([cl(O[0], M, 'k3'), cl(O[0], M, 'k4')], sg, now + 2, sid);
  T('[1] count: three payments a week -> the fourth not paid (capped), counted all the same', r.pay.length === 1 && r.capped === 1 && pm.l1 === 5, JSON.stringify(r));
  r = v.lone1v1Count([cl(O[0], M, 'k5')], sg, now + 7 * DAY + 3, sid);
  T('[1] count: a week later he is paid again', r.pay.length === 1 && r.capped === 0);
  // a waiting claim whose writer cannot be named stays; past 14 days it is dropped unpaid
  sg = sigFile([V]);
  v.lone1v1Count([cl(Z, V)], sg, now, sid);
  r = v.lone1v1Count([cl(O[2], V)], sg, now + DAY, sid);
  T('[1] count: a waiting claim nobody can name this run waits on (the new claim is paid)', r.pay.length === 1 && r.pay[0].sid === O[2] && sg.players[v.pid(V)].l1q.length === 1);
  r = v.lone1v1Count([], sg, now + 15 * DAY, (h2) => h2 === v.pid(Z) ? Z : null);
  T('[1] count: past 14 days it is dropped, never paid', !r.pay.length && !('l1q' in sg.players[v.pid(V)]) && r.dirty);
  sg = sigFile([V]);
  for (let i = 0; i < 6; i++) v.lone1v1Count([cl(X, V, 'q' + i)], sg, now, sid);
  T('[1] count: at most 4 claims wait', sg.players[v.pid(V)].l1q.length === 4 && sg.players[v.pid(V)].l1 === 6);
  sg = sigFile([V]);
  for (let i = 0; i < 10; i++) v.lone1v1Count([cl(SIDQ(1900 + i), V)], sg, now, () => null);
  T('[1] count: at most 8 opponents kept', sg.players[v.pid(V)].l1o.length === 8 && sg.players[v.pid(V)].l1 === 10);
}

// ---- [2] the modded player who writes only his wins ----
{
  const h1 = 0x8411, h2 = 0x8412, h3 = 0x8413;
  // match 1: M (seat 1) beats O1, both write -> settles; M has signals from then on
  const r1 = [O[1], M];
  const m1 = [{ sid: O[1], d: v1start(h1, 0, r1) }, { sid: M, d: v1start(h1, 1, r1) }];
  const m1f = m1.concat([{ sid: O[1], d: v1settle(h1, 0, r1, 1) }, { sid: M, d: v1settle(h1, 1, r1, 1) }]);
  const steps = (script) => stepsOf(
    [[0, m1], [10 * MIN, m1f], [10 * MIN, m1f]],
    lone(h2, O[2], M, m1f),                                   // O2 beats M, M writes nothing
    lone(h3, O[3], M, m1f.concat(lone(h2, O[2], M)[2][1])),  // O3 beats M; O2's rows still on the shards
    [[10 * MIN, m1f.concat(lone(h2, O[2], M)[2][1], lone(h3, O[3], M)[2][1])]]);
  const rs = timeline(steps());
  const k2 = keyOf(v1start(h2, 0, [O[2], M])), k3 = keyOf(v1start(h3, 0, [O[3], M]));
  T('[2] ten runs exit 0', allOk(rs, 10), last(rs).out.slice(-1200));
  T('[2] his win settles as usual (both wrote): M up, O1 down', ptsIn(rs, M).length === 1 && ptsIn(rs, M)[0] > 2500 && ptsIn(rs, O[1]).length === 1 && ptsIn(rs, O[1])[0] < 2500,
    JSON.stringify([ptsIn(rs, M), ptsIn(rs, O[1])]));
  T('[2] O2\'s win: counted on M at its verdict, O2 waits (nothing paid yet)', /counted on him \(1 such match\(es\), 1 different opponent\(s\)\), nobody flagged; payment waits/.test(rs[5].out)
    && !ptsIn(rs.slice(0, 8), O[2]).length && processedOf(rs[5]).has(k2), rs[5].out.split('\n').filter(l => /lone-1v1/.test(l)).join(' | '));
  T('[2] O3\'s win: counted (2 matches, 2 opponents), O3 and O2 paid the points of a 1V1 win (2500 -> 2538), one write each',
    /counted on him \(2 such match\(es\), 2 different opponent\(s\)\), nobody flagged; winner paid/.test(rs[8].out)
    && JSON.stringify(ptsIn(rs, O[2])) === '[2538]' && JSON.stringify(ptsIn(rs, O[3])) === '[2538]' && processedOf(rs[8]).has(k3),
    JSON.stringify([ptsIn(rs, O[2]), ptsIn(rs, O[3])]));
  T('[2] ... and the consolation XP of a lone writer', JSON.stringify(xpIn(rs, O[2])) === '[50]' && JSON.stringify(xpIn(rs, O[3])) === '[50]', JSON.stringify([xpIn(rs, O[2]), xpIn(rs, O[3])]));
  const sm = sigOf(last(rs), M);
  T('[2] M: counted 2 / 2 opponents, nothing waiting; no points from those, no exit, nobody flagged', sm && sm.l1 === 2 && sm.l1o.length === 2 && !('l1q' in sm)
    && ptsIn(rs, M).length === 1 && leavesOf(last(rs), M) === 0 && ALL.every(s => fOf(last(rs), s) === 0), JSON.stringify(sm));
  T('[2] summary row: counted 1 / waiting 0 / paid 2 / no signals 0 / capped 0 (2 written)', JSON.stringify(sumRow(rs.slice(8, 9))) === '[1,0,2,0,0,2]', JSON.stringify(sumRow(rs.slice(8, 9))));
  T('[2] once only: the run after pays and counts nothing more', !ptsIn([last(rs)], O[2]).length && !ptsIn([last(rs)], O[3]).length && !LINE.test(last(rs).out) && sigOf(last(rs), M).l1 === 2);
  withMutant(NOVERDICT_FROM, '    if (true) continue;', '2', (s) => {
    const m = timeline(steps(), s);
    T('[2] mutant: no verdict (the code before Q184) -> O2 / O3 never paid, nothing counted, the keys never processed', allOk(m, 10) && !ptsIn(m, O[2]).length && !ptsIn(m, O[3]).length
      && !(sigOf(last(m), M) || {}).l1 && !processedOf(last(m)).has(k2), JSON.stringify([ptsIn(m, O[2]), ptsIn(m, O[3])]));
  });
}

// ---- [2b-2d] what a payment is: the points of a normal 1V1 win ----
{
  const pay1 = (w, h, files) => timeline(lone(h, w, M), null, files);
  LP0 = { [O[6]]: 2890 };
  const rb = pay1(O[6], 0x8414, atGate([M], M, O[0]));
  T('[2b] a winner 110 under the platinum line: the series clamp promotes him as a normal win would (2890 -> 3010)', allOk(rb, 3) && JSON.stringify(ptsIn(rb, O[6])) === '[3010]',
    JSON.stringify(ptsIn(rb, O[6])));
  LP0 = { [O[7]]: null };
  const seed = v.seedLp(TS.displayRating(TS.DEFAULTS.mu, TS.DEFAULTS.sigma)), want = seed + v.lpDelta(seed, 1, 2);
  const rc = pay1(O[7], 0x8415, atGate([M], M, O[0]));
  T('[2c] a winner with no points this season: seeded as on his first settle, no series clamp (' + seed + ' -> ' + want + ')', allOk(rc, 3) && JSON.stringify(ptsIn(rc, O[7])) === JSON.stringify([want]),
    JSON.stringify(ptsIn(rc, O[7])));
  // a seed 48 under the gold line (display 1488 -> 1952): a seeded first settle skips the series clamp (1996, not 2010)
  LP0 = { [O[9]]: null };
  const sk9 = { [v.pid(O[9])]: { mu: 18.2, sigma: 2 }, [v.pid(M)]: { mu: 18.2, sigma: 2 } };
  const rc2 = pay1(O[9], 0x8418, Object.assign(atGate([M], M, O[0]), { SKILL_FILE: sk9 }));
  T('[2c] ... a seed 48 under the gold line stays a plain win on that first settle (1952 -> 1996, the clamp would give 2010)',
    allOk(rc2, 3) && v.seedLp(TS.displayRating(18.2, 2)) === 1952 && JSON.stringify(ptsIn(rc2, O[9])) === '[1996]', JSON.stringify(ptsIn(rc2, O[9])));
  LP0 = {};
  // a strong winner against a weak silent seat: the mismatch compression of a normal settle (not the plain 38)
  const skill = { [v.pid(O[8])]: { mu: 45, sigma: 2 }, [v.pid(M)]: { mu: 10, sigma: 2 } };
  const hd = 0x8416, ro = [O[8], M];
  const st2 = [{ sid: O[8], d: v1start(hd, 0, ro) }, { sid: M, d: v1start(hd, 1, ro) }];
  const fin2 = st2.concat([{ sid: O[8], d: v1settle(hd, 0, ro, 0) }, { sid: M, d: v1settle(hd, 1, ro, 0) }]);
  const honest = timeline([[0, st2], [10 * MIN, fin2], [10 * MIN, fin2], [10 * MIN, fin2]], null, Object.assign(sigState([M]), { SKILL_FILE: skill }));
  const silent = timeline(lone(0x8417, O[8], M), null, Object.assign(atGate([M], M, O[0]), { SKILL_FILE: skill }));
  T('[2d] the payment is what the same match written by both would have given the winner (mismatch compression included)', allOk(honest, 4) && allOk(silent, 3)
    && ptsIn(honest, O[8]).length === 1 && JSON.stringify(ptsIn(silent, O[8])) === JSON.stringify(ptsIn(honest, O[8])) && ptsIn(honest, O[8])[0] < 2538,
    JSON.stringify([ptsIn(honest, O[8]), ptsIn(silent, O[8])]));
}

// ---- [3] forgery ----
{
  const fake = (h, w, l) => { const ro = [w, l]; return [{ sid: w, d: v1start(h, 0, ro) }, { sid: w, d: v1settle(h, 0, ro, 0) }]; };
  const fakes = [0x8421, 0x8422, 0x8423];
  const sX = fakes.map(h => fake(h, X, V)[0]), fX = [].concat(...fakes.map(h => fake(h, X, V)));
  const s3 = (script) => [[0, sX], [10 * MIN, fX], [2 * HOUR, fX]];
  const rs = timeline(s3(), null, sigState([V]));
  const sv = sigOf(last(rs), V);
  T('[3] one account X writes three 1V1 wins against V: counted on V (3, 1 opponent, 3 waiting), X never paid, nobody flagged',
    allOk(rs, 3) && sv && sv.l1 === 3 && sv.l1o.length === 1 && sv.l1q.length === 3 && !ptsIn(rs, X).length && !xpIn(rs, X).length && ALL.every(s => fOf(last(rs), s) === 0),
    JSON.stringify(sv));
  withMutant('const LONE1V1 = { GATE: 2,', 'const LONE1V1 = { GATE: 1,', '3', (s) => {
    const m = timeline(s3(), s, sigState([V]));
    T('[3] mutant: GATE 1 -> one account alone is paid for fake 1V1s', allOk(m, 3) && ptsIn(m, X).length === 1, JSON.stringify(ptsIn(m, X)));
  });
  // a second account Y: the gate is two accounts -- the floor two colluders settling matches between themselves already had
  const fY = fake(0x8424, Y, V);
  const sY = stepsOf(s3(), [[10 * MIN, fX.concat([fY[0]])], [10 * MIN, fX.concat(fY)], [2 * HOUR, fX.concat(fY)]]);
  const ry = timeline(sY, null, sigState([V]));
  T('[3] pinned: a second account Y -> Y paid, and X\'s three waiting claims paid in one write (2500 -> 2614)', allOk(ry, 6) && JSON.stringify(ptsIn(ry, Y)) === '[2538]'
    && JSON.stringify(ptsIn(ry, X)) === '[2614]' && !('l1q' in sigOf(last(ry), V)) && sigOf(last(ry), X).l1t.length === 3, JSON.stringify([ptsIn(ry, X), ptsIn(ry, Y)]));
  const more = [0x8425, 0x8426];
  const fX2 = [].concat(...more.map(h => fake(h, X, V)));
  const sCap = stepsOf(sY, [[10 * MIN, fX2.filter((r, i) => i % 2 === 0)], [10 * MIN, fX2], [2 * HOUR, fX2]]);
  const rc = timeline(sCap, null, sigState([V]));
  T('[3] weekly cap: X\'s next two claims that week are counted, not paid', allOk(rc, 9) && JSON.stringify(ptsIn(rc, X)) === '[2614]' && sigOf(last(rc), V).l1 === 6
    && (outOf(rc.slice(8)).match(/already paid 3 time\(s\) in 7 days -- this one not paid/g) || []).length === 2, JSON.stringify(ptsIn(rc, X)));
  const f7 = fake(0x8427, X, V);
  const sWeek = stepsOf(sCap, [[7 * DAY, f7.slice(0, 1)], [10 * MIN, f7], [2 * HOUR, f7]]);
  const rw = timeline(sWeek, null, sigState([V]));
  T('[3] a week later X is paid again', allOk(rw, 12) && ptsIn(rw, X).length === 2, JSON.stringify(ptsIn(rw, X)));
}

// ---- [4] honest controls ----
{
  const ro = [O[5], M];
  const one = (h, opt, files, script) => timeline(lone(h, O[5], M, [], opt), script, files === undefined ? sigState([M, O[5]]) : files);
  // (a) the loser wrote his own start: a roster registers, the start-orphan verdict judges it as before
  const ha = 0x8431;
  const ra = one(ha, { more: [{ sid: M, d: v1start(ha, 1, ro) }] });
  T('[4a] the loser wrote his own start: the start-orphan verdict as before (his exit, the winner\'s consolation), nothing from Q184',
    allOk(ra, 3) && leavesOf(last(ra), M) === 1 && JSON.stringify(xpIn(ra, O[5])) === '[50]' && !ptsIn(ra, O[5]).length && !LINE.test(outOf(ra)) && !(sigOf(last(ra), M) || {}).l1,
    outOf(ra).split('\n').filter(l => /start-orphan|lone-1v1/.test(l)).join(' | '));
  const nothing = (label, rs, key) => T(label, allOk(rs, 3) && !LINE.test(outOf(rs)) && !ptsIn(rs, O[5]).length && !(sigOf(last(rs), M) || {}).l1 && !processedOf(last(rs)).has(key),
    outOf(rs).split('\n').filter(l => /lone-1v1/.test(l)).join(' | '));
  const hb = 0x8432;
  nothing('[4b] a peers-gone result: nothing decided', one(hb, { res: v1settle(hb, 0, ro, 0).map((x, i) => i === 12 ? 1 : x) }), keyOf(v1start(hb, 0, ro)));
  const hc = 0x8433, q1 = (d) => d.map((x, i) => i === 2 ? 1 : x);
  nothing('[4c] a quick 1V1: nothing decided', one(hc, { start: q1(v1start(hc, 0, ro)), res: q1(v1settle(hc, 0, ro, 0)) }), keyOf(q1(v1start(hc, 0, ro))));
  const hd = 0x8434, lost = { res: v1settle(hd, 0, ro, 1) };
  nothing('[4d] his result says he lost: nothing decided', one(hd, lost), keyOf(v1start(hd, 0, ro)));
  withMutant('  if (!((r0.d[10 + seat] | 0) > (r0.d[11 - seat] | 0))) return null;', '', '4d', (s) => {
    const m = one(0x8435, { res: v1settle(0x8435, 0, ro, 1) }, undefined, s);
    T('[4d] mutant: no win check -> a loss is counted on the account that won', allOk(m, 3) && (sigOf(last(m), M) || {}).l1 === 1);
  });
  const he = 0x8436, re = one(he, {}, sigState([O[5]]));
  T('[4e] the silent seat has no signals of his own: logged, not counted, no entry made, not paid', allOk(re, 3) && /no signals of his own, not counted, not paid \(Q184\)/.test(re[2].out)
    && !sigOf(last(re), M) && !ptsIn(re, O[5]).length && processedOf(last(re)).has(keyOf(v1start(he, 0, ro))) && JSON.stringify(sumRow(re)) === '[0,0,0,1,0,0]', JSON.stringify(sumRow(re)));
  const hf = 0x8437, conf = (h) => { const d = rec(0xB2, 2, h, 1, 0, false, ro); d[0] = 0xB5; d[12] = 5; return d; };
  nothing('[4f] he confessed (left the match and said so): nothing decided by Q184', one(hf, { more: [{ sid: M, d: conf(hf) }] }), keyOf(v1start(hf, 0, ro)));
  withMutant("  if ((confState && confState[op + '|' + key]) || (confSeen && confSeen.has(op + '|' + key))) return null;", '', '4f', (s) => {
    const m = one(0x8438, { more: [{ sid: M, d: conf(0x8438) }] }, undefined, s);
    T('[4f] mutant: no confession check -> his own word counted again', allOk(m, 3) && (sigOf(last(m), M) || {}).l1 === 1);
  });
  // an outside start from the other seat naming another table: the roster contest takes the key as before (Q75 / Q127)
  const hg = 0x8439, rg = one(hg, { more: [{ sid: Y, d: v1start(hg, 1, [X, Y]) }] });
  T('[4g] an outside start naming another table read before the result: contested and voided as before, nothing from Q184',
    allOk(rg, 3) && /contest-void [0-9_]+: contested since/.test(rg[2].out) && !LINE.test(outOf(rg)) && !(sigOf(last(rg), M) || {}).l1 && !ptsIn(rg, O[5]).length,
    outOf(rg).split('\n').filter(l => /contest|lone-1v1/.test(l)).join(' | '));
  // (h) the verdict run reads a shard incompletely: held, decided on the next full read
  const hh = 0x843b, fail = { STUB_FAIL: JSON.stringify({ shard_49: 500 }) };
  const sh = stepsOf(lone(hh, O[5], M, [], { env: fail }), [[5 * MIN, lone(hh, O[5], M)[2][1]]]);
  const rh = timeline(sh, null, sigState([M, O[5]]));
  T('[4h] an incomplete read holds the verdict; the next full read decides it', allOk(rh, 4) && /lone-1v1: 1 matured verdict\(s\) held \(incomplete shard read\)/.test(rh[2].out)
    && !LINE.test(rh[2].out) && LINE.test(rh[3].out) && sigOf(last(rh), M).l1 === 1, rh[2].out.split('\n').filter(l => /lone-1v1|shard/.test(l)).slice(0, 4).join(' | '));
  withMutant("    if (readComplete === false) { held += 1; continue; }   // his opponent's row may sit on the unread shard", '', '4h', (s) => {
    const m = timeline(sh, s, sigState([M, O[5]]));
    T('[4h] mutant: no hold -> decided on the partial read', allOk(m, 4) && LINE.test(m[2].out));
  });
}

// ---- [5] wiring pins ----
{
  const at = (re) => { const m = re.exec(SRC); return m ? m.index : -1; };
  const iVer = at(/const l1Res = lone1v1Count\(lone1v1Verdicts\(startsPending, groups, processed, nowMs, STARTS_MATURITY_MS, confState, confSeen, shardsComplete\)/);
  const iMarks = at(/\n  saveEarlyMarks\(startsRes\.convicted > 0\);/), iSig = at(/\n  if \(APPLY_MMR && l1Res\.pay\.length\) saveSignals\(signals, nowMs\);/);
  const iCons = at(/\n  if \(startsRes\.consoledSids && startsRes\.consoledSids\.length && XP_LB\) \{/), iPay = at(/\n  else if \(l1Res\.pay\.length\) \{/);
  T('[5] main: the verdicts after reconcileStarts, then the early marks and the signals, then the consolation, then the points',
    iVer > at(/const startsRes = reconcileStarts\(/) && iMarks > iVer && iSig > iMarks && iCons > iSig && iPay > iCons, JSON.stringify([iVer, iMarks, iSig, iCons, iPay]));
  T('[5] main: the paid winners join the consolation list', /for \(const p of l1Res\.pay\) if \(startsRes\.consoledSids\.indexOf\(p\.sid\) < 0\) startsRes\.consoledSids\.push\(p\.sid\);/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (lone-1v1-win) ===');
process.exit(failN === 0 ? 0 : 1);
