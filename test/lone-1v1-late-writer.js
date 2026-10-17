'use strict';
// Q261 (cloud audit 2026-10): a quick or ranked 1V1 where the loser wrote a start and no result, and the winner's start was
//   first read in the run that read his result too (a stalled or partly read run in between): the loser's start was in the
//   key's note (s) before the result, so the winner's start was late and left out (Q127 / Q138) -- one vote, no roster, no
//   start-orphan verdict: the honest winner got not even the consolation XP and the loser, who started and wrote no
//   result, no exit. Q184 stays out (the loser wrote a start of his own). Now lateWriterRoster registers, in that run, the
//   roster the run that read both starts on time would have registered (the loser's own start naming the table, the
//   winner's late start and his results from his seat naming it too), and the start-orphan verdict decides it as on time.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/lone-1v1-outside-start.js).
//   [1] units: lateWriterRoster (registers; quick and ranked; either seat; each condition that keeps it out)
//   [2] ranked: the Q261 timing ends as the on-time control (the winner 50 XP, the loser one exit, no points, nobody
//       flagged, processed once); mutants (the hook out = the code before Q261; the loser's start not noted as his own)
//   [3] a quick 1V1 likewise, and the result writer at seat 1
//   [4] the loser kept whole as on time: his own result arriving later settles both as before (the same points as the code
//       before Q261), his abandon confession counts once (as on time), his exit note spares him (as on time)
//   [5] not bridged, as before: the loser's result read in the same run as the winner's (settles as two results), the
//       mirror timing (the result writer's start on time, the other's late: Q184 pays as before), an outside start
//       contesting the key (void as before)
//   [6] wiring pins
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lone-1v1-late-writer-'));
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
const scoreOf = (p) => Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
const forSid = (sid) => (p) => new RegExp('steamid=' + sid + '(&|$)').test(p.body);

const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   a start (0xB2), a confession (0xB5) and an exit note (0xBD) carry zeroed results (as test/exit-note.js)
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, zero ? 1 : 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : sc[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// a 1V1 (mt 2 ranked / 1 quick) on table ros (seat -> account); `won` = the seat the result says won ([7000, 4000] or [4000, 7000])
const SC = (won) => won ? [4000, 7000] : [7000, 4000];
const startOf = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
const resultOf = (mt, h, ros, seat, won) => ({ sid: ros[seat], d: rec(0xB1, mt, h, seat, seat === won ? 1 : 2, seat === won, ros, SC(won)) });
const confessOf = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB5, mt, h, seat, 0, false, ros, null, 5) });
const noteOf = (mt, h, ros, seat, disp) => ({ sid: ros[seat], d: rec(0xBD, mt, h, seat, 0, false, ros, null, disp) });
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const SIDQ = (n) => '7656119800' + String(n).padStart(7, '0');
const Wn = SIDQ(2611), L = SIDQ(2612), X = SIDQ(2613), P = SIDQ(2614);
const ALL = [Wn, L, X, P];
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// each account's own history (a signals entry as a settled match leaves it); L already counted once by another opponent
//   (P), so a Q184 claim against him is at the gate
const sigEntry = () => ({ g: 3, w: 2, v: 0, f: 0, ns: 0, disp: [3, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now() });
function files0() {
  const players = {};
  for (const s of ALL) players[v.pid(s)] = sigEntry();
  Object.assign(players[v.pid(L)], { l1: 1, l1o: [v.pid(P)] });
  return { SIGNALS_FILE: { day: { d: 0, n: {} }, players, pairs: {}, flagged: {}, rep: {}, rseen: {} } };
}
// steps: [[ms since the previous run, recs], ...]
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : files0(), null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const why = (rs) => outOf(rs).split('\n').filter(l => /start-|lone-1v1|contest|settle |consolation|confess|FAIL|Error/.test(l)).join(' | ');
// what a timeline left for the two players: the points / XP writes, the exits, the flags, the key processed
function outcome(rs, key) {
  const ps = [].concat(...rs.map(r => posts(r, 7))), xs = [].concat(...rs.map(r => posts(r, 5)));
  return {
    wPts: ps.filter(forSid(Wn)).map(scoreOf), lPts: ps.filter(forSid(L)).map(scoreOf),
    wXp: xs.filter(forSid(Wn)).map(scoreOf), lXp: xs.filter(forSid(L)).map(scoreOf),
    wLeaves: leavesOf(last(rs), Wn), lLeaves: leavesOf(last(rs), L), wF: fOf(last(rs), Wn), lF: fOf(last(rs), L),
    done: processedOf(last(rs)).has(key), l1: (((last(rs).state.SIGNALS_FILE || {}).players || {})[v.pid(L)] || {}).l1 | 0,
  };
}
const J = (o) => JSON.stringify(o);
const VALIDATE_SRC = SRC;
const mutant = (from, to, tag) => {
  if (VALIDATE_SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-lone-1v1-late-writer-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, VALIDATE_SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };
const HOOK = "    if (e.r === now) { const p = lateWriterRoster(e, m, (sg[m] || []).filter((r) => late.has(r)), resOf[m], pending, processed, now, readComplete); if (p) { pending[m] = p; bridged.push(m); } }   // Q261";
const ro = [Wn, L];   // the winner at seat 0, the loser at seat 1

// the two timings of one match: run 1 the loser's start (and, on time, the winner's), ten minutes on the winner's result
//   (and, late, his start), two hours on the verdict. extra2 / extra3: more rows from run 2 / run 3 on
function onTime(mt, h, tab, ws, extra2, extra3) {
  const LS = startOf(mt, h, tab, 1 - ws), WS = startOf(mt, h, tab, ws), WR = resultOf(mt, h, tab, ws, ws);
  return [[0, [LS, WS]], [10 * MIN, [LS, WS, WR].concat(extra2 || [])], [2 * HOUR, [LS, WS, WR].concat(extra2 || [], extra3 || [])]];
}
function lateWinner(mt, h, tab, ws, extra2, extra3) {
  const LS = startOf(mt, h, tab, 1 - ws), WS = startOf(mt, h, tab, ws), WR = resultOf(mt, h, tab, ws, ws);
  return [[0, [LS]], [10 * MIN, [LS, WS, WR].concat(extra2 || [])], [2 * HOUR, [LS, WS, WR].concat(extra2 || [], extra3 || [])]];
}

console.log('=== a 1V1 whose winner\'s start was first read with his result ends as if both starts were on time (Q261) ===');

// ---- [1] units ----
{
  T('[1] lateWriterRoster exported', typeof v.lateWriterRoster === 'function', typeof v.lateWriterRoster);
  if (typeof v.lateWriterRoster === 'function') {
    const h = 0x2611, NOW = 5000000;
    const S = (x) => ({ start: true, steamID: x.sid, d: x.d, roster: v.decodeRoster(x.d) });
    const R = (x) => ({ steamID: x.sid, d: x.d, dispCode: 0, roster: v.decodeRoster(x.d) });
    const idOf = (s) => v.pid(String(s.steamID)) + '@' + (s.d[5] | 0) + '#' + v.startSig(s);
    const ws = S(startOf(2, h, ro, 0)), ls = S(startOf(2, h, ro, 1)), wr = R(resultOf(2, h, ro, 0, 0)), key = keyOf(ws.d);
    const note = (o) => Object.assign({ t0: NOW - 10 * MIN, s: [idOf(ls)], r: NOW, c: 0 }, o || {});
    const call = (o) => {
      o = o || {};
      const e = o.e || note(), pend = o.pending || {}, proc = o.processed || new Set();
      return v.lateWriterRoster(e, o.key || key, o.late || [ws], o.results || [wr], pend, proc, o.now || NOW, o.rc);
    };
    const p = call();
    T('[1] registers the roster the on-time run would: both seats, provisional on the table, the loser\'s own start noted, t0 = this run',
      !!p && J(p) === J({ t0: NOW, mt: 2, roster: { 0: v.pid(Wn), 1: v.pid(L) }, settled: [], prov: v.startSig(ws), started: [v.pid(L)] }), J(p));
    // a quick 1V1, and the result writer at seat 1
    const q = (x) => Object.assign({}, x, { d: x.d.map((y, i) => i === 2 ? 1 : y) });
    const qws = S(q(startOf(2, h, ro, 0))), qls = S(q(startOf(2, h, ro, 1))), qwr = R(q(resultOf(2, h, ro, 0, 0)));
    const pq = call({ e: note({ s: [idOf(qls)] }), key: keyOf(qws.d), late: [qws], results: [qwr] });
    T('[1] a quick 1V1 likewise (match type 1)', !!pq && pq.mt === 1 && pq.prov === v.startSig(qws), J(pq));
    const sw = [L, Wn], s1 = S(startOf(2, h, sw, 1)), s0 = S(startOf(2, h, sw, 0)), r1 = R(resultOf(2, h, sw, 1, 1));
    const p1 = call({ e: note({ s: [idOf(s0)] }), late: [s1], results: [r1] });
    T('[1] the result writer at seat 1', !!p1 && J(p1.roster) === J({ 0: v.pid(L), 1: v.pid(Wn) }) && J(p1.started) === J([v.pid(L)]), J(p1));
    T('[1] the late starts may hold others: the qualifying one is used', !!call({ late: [S(startOf(2, h, [X, L], 0)), ws] }));
    const no = (label, o) => T('[1] not registered: ' + label, call(o) === null);
    no('the result was read in an earlier run (r is not this run)', { e: note({ r: NOW - 5 * MIN }) });
    no('the result not read at all (r 0)', { e: note({ r: 0 }) });
    no('an incomplete read', { rc: false });
    no('a contested note', { e: note({ c: 1 }) });
    no('a start past its writer\'s room was seen (n)', { e: note({ n: 1 }) });
    no('no start read before the result (s empty)', { e: note({ s: [] }) });
    no('two starts read before the result', { e: note({ s: [idOf(ls), idOf(S(Object.assign(startOf(2, h, ro, 0), { sid: X })))] }) });
    no('the start read before was the result writer\'s own', { e: note({ s: [idOf(ws)] }) });
    no('the loser\'s start named another table', { e: note({ s: [idOf(S(startOf(2, h, [P, L], 1)))] }) });
    no('an outside account\'s start from the loser\'s seat (not the account the table seats there)', { e: note({ s: [idOf(S(Object.assign(startOf(2, h, ro, 1), { sid: X })))] }) });
    no('an entry already registered', { pending: { [key]: { t0: 0, mt: 2, roster: {}, settled: [] } } });
    no('the key already processed', { processed: new Set([key]) });
    no('no result read this run', { results: [] });
    no('the loser\'s result read this run too', { results: [wr, R(resultOf(2, h, ro, 1, 0))] });
    no('an outside account\'s result', { results: [wr, R(Object.assign(resultOf(2, h, ro, 1, 0), { sid: X }))] });
    no('his result from the other seat', { results: [R(Object.assign(resultOf(2, h, [L, Wn], 0, 0), { sid: Wn }))] });
    no('his result naming another table', { results: [R(resultOf(2, h, [Wn, P], 0, 0))] });
    no('no late start', { late: [] });
    no('the late start\'s table seats somebody else where its writer writes from', { late: [S(Object.assign(startOf(2, h, ro, 0), { sid: X }))] });
    no('the late start leaves the other seat empty', { late: [S({ sid: Wn, d: startOf(2, h, ro, 0).d.slice(0, 13).concat(sidPair(Wn), [0, 0]) })] });
    const tw = (mt, pc) => { const ros = pc === 4 ? [Wn, L, X, P] : ro, d = (x) => Object.assign({}, x, { d: x.d.map((y, i) => i === 2 ? mt : y) });
      const a = S(d(startOf(2, h, ros, 0))), b = S(d(startOf(2, h, ros, 1))), c = R(d(resultOf(2, h, ros, 0, 0)));
      return { e: note({ s: [idOf(b)] }), key: keyOf(a.d), late: [a], results: [c] }; };
    no('party bits on the match type', tw(0x12, 2));
    no('a ranked 2V2', tw(6, 4));
    no('a friends\' room 1V1 (match type 10)', tw(10, 2));
    no('a bot match (match type 11)', tw(11, 2));
    no('an endless run (match type 7)', tw(7, 2));
  }
}

// ---- [2] ranked: the Q261 timing ends as the on-time control ----
{
  const h = 0x2621, key = keyOf(startOf(2, h, ro, 0).d);
  const want = { wPts: [], lPts: [], wXp: [50], lXp: [], wLeaves: 0, lLeaves: 1, wF: 0, lF: 0, done: true, l1: 1 };
  const ct = timeline(onTime(2, h, ro, 0));
  T('[2] on-time control: the winner 50 XP, the loser one exit, no points, nobody flagged', allOk(ct, 3) && J(outcome(ct, key)) === J(want), J(outcome(ct, key)) + ' | ' + why(ct));
  const rs = timeline(lateWinner(2, h, ro, 0));
  T('[2] the winner\'s start first read with his result: the same as on time', allOk(rs, 3) && J(outcome(rs, key)) === J(want), J(outcome(rs, key)) + ' | ' + why(rs));
  T('[2] run 2 registers from the loser\'s start and the winner\'s late one (logged, counted in the summary)', allOk(rs, 3)
    && /start-late: 1 start\(s\)/.test(rs[1].out) && new RegExp('start-late-1v1: 1 1V1\\(s\\) .* \\(Q261\\): ' + key).test(rs[1].out)
    && /\| 1V1s registered from the result writer's late start and the other seat's own start read before it \(Q261\) \| 1 \|/.test(rs[1].summary), why(rs));
  T('[2] run 3: the start-orphan verdict, the winner exempt, the late start still counts nowhere (no vote, no lone verdict)', allOk(rs, 3)
    && /start-orphan [0-9_]+: started, never settled -> 1 exit-rate hits/.test(rs[2].out) && !/lone-1v1 [0-9_]+: /.test(outOf(rs)) && !/start-pending /.test(outOf(rs)), why(rs));
  T('[2] once: processed, its entry gone', allOk(rs, 3) && processedOf(last(rs)).has(key) && !((last(rs).state.STARTS_FILE || {})[key]), J(Object.keys(last(rs).state.STARTS_FILE || {})));
  withMutant(HOOK, '', '2before', (s) => {
    const m = timeline(lateWinner(2, h, ro, 0), s);
    const o = outcome(m, key);
    T('[2] mutant: the hook out (the code before Q261) -> nobody settled: no XP, no exit (the bug)', allOk(m, 3) && !o.wXp.length && !o.lLeaves && !o.done, J(o));
  });
  // the loser takes his start down once it was read (before the result): on time it was noted as his own at registration;
  //   here the note's s is the job's record of it, so it convicts the same
  const hw = 0x2622, kw = keyOf(startOf(2, hw, ro, 0).d), LSw = startOf(2, hw, ro, 1), WSw = startOf(2, hw, ro, 0), WRw = resultOf(2, hw, ro, 0, 0);
  const ctw = outcome(timeline([[0, [LSw, WSw]], [10 * MIN, [WSw, WRw]], [2 * HOUR, [WSw, WRw]]]), kw);
  const lw = [[0, [LSw]], [10 * MIN, [WSw, WRw]], [2 * HOUR, [WSw, WRw]]];
  const rw = outcome(timeline(lw), kw);
  T('[2] the loser\'s start taken down after it was read: as on time (one exit)', J(rw) === J(ctw) && ctw.lLeaves === 1 && J(ctw.wXp) === '[50]', J(rw) + ' vs ' + J(ctw));
  withMutant('settled: [], prov: sig, started: [lp] };', 'settled: [], prov: sig, started: [] };', '2started', (s) => {
    const o = outcome(timeline(lw, s), kw);
    T('[2] mutant: the loser\'s start in s not noted as his own -> his start taken down, no exit (his own start is what convicts, Q69)', !o.lLeaves && J(o.wXp) === '[50]', J(o));
  });
}

// ---- [3] a quick 1V1; the result writer at seat 1 ----
{
  const h = 0x2631, key = keyOf(startOf(1, h, ro, 0).d);
  const ct = outcome(timeline(onTime(1, h, ro, 0)), key), rs = timeline(lateWinner(1, h, ro, 0));
  T('[3] quick 1V1: the late timing ends as on time (the winner 50 XP, the loser one exit)', J(outcome(rs, key)) === J(ct) && J(ct.wXp) === '[50]' && ct.lLeaves === 1, J(outcome(rs, key)) + ' vs ' + J(ct) + ' | ' + why(rs));
  const h2 = 0x2632, sw = [L, Wn], key2 = keyOf(startOf(2, h2, sw, 0).d);
  const ct2 = outcome(timeline(onTime(2, h2, sw, 1)), key2), rs2 = timeline(lateWinner(2, h2, sw, 1));
  T('[3] ranked, the winner at seat 1: as on time', J(outcome(rs2, key2)) === J(ct2) && J(ct2.wXp) === '[50]' && ct2.lLeaves === 1, J(outcome(rs2, key2)) + ' vs ' + J(ct2) + ' | ' + why(rs2));
}

// ---- [4] the loser kept whole as on time ----
{
  // (a) his own result arrives half an hour later (a slow upload): both settle as before -- the same points as the code
  //     before Q261, no exit, no consolation
  const h = 0x2641, key = keyOf(startOf(2, h, ro, 0).d), LR = resultOf(2, h, ro, 1, 0);
  const late = [[0, [startOf(2, h, ro, 1)]], [10 * MIN, [startOf(2, h, ro, 1), startOf(2, h, ro, 0), resultOf(2, h, ro, 0, 0)]],
    [30 * MIN, [startOf(2, h, ro, 1), startOf(2, h, ro, 0), resultOf(2, h, ro, 0, 0), LR]], [2 * HOUR, [startOf(2, h, ro, 1), startOf(2, h, ro, 0), resultOf(2, h, ro, 0, 0), LR]]];
  const rs = timeline(late), o = outcome(rs, key);
  T('[4a] the loser\'s result half an hour later: the match settles, the winner up, the loser down, no exit, no consolation',
    allOk(rs, 4) && o.done && o.wPts.length === 1 && o.wPts[0] > 2500 && o.lPts.length === 1 && o.lPts[0] < 2500 && !o.lLeaves && !o.wXp.includes(50), J(o) + ' | ' + why(rs));
  withMutant(HOOK, '', '4abefore', (s) => {
    const m = outcome(timeline(late, s), key);
    T('[4a] the same points and exits as the code before Q261', J([m.wPts, m.lPts, m.lLeaves, m.wLeaves, m.done]) === J([o.wPts, o.lPts, o.lLeaves, o.wLeaves, o.done]), J(m) + ' vs ' + J(o));
  });
  // (b) his abandon confession: counted once, as on time
  const hb = 0x2642, kb = keyOf(startOf(2, hb, ro, 0).d), cf = [confessOf(2, hb, ro, 1)];
  const cb = outcome(timeline(onTime(2, hb, ro, 0, cf)), kb), rb = timeline(lateWinner(2, hb, ro, 0, cf));
  T('[4b] his abandon confession: as on time (one exit, his confession\'s; not two)', J(outcome(rb, kb)) === J(cb) && cb.lLeaves === 1, J(outcome(rb, kb)) + ' vs ' + J(cb) + ' | ' + why(rb));
  // (c) his exit note (the match died on him: migrate-disband): spared, as on time
  const hc = 0x2643, kc = keyOf(startOf(2, hc, ro, 0).d), nt = [noteOf(2, hc, ro, 1, 4)];
  const cc = outcome(timeline(onTime(2, hc, ro, 0, nt)), kc), rc = timeline(lateWinner(2, hc, ro, 0, nt));
  T('[4c] his exit note: spared, as on time (no exit; the winner 50 XP)', J(outcome(rc, kc)) === J(cc) && cc.lLeaves === 0 && J(cc.wXp) === '[50]', J(outcome(rc, kc)) + ' vs ' + J(cc) + ' | ' + why(rc));
}

// ---- [5] not bridged, as before ----
{
  // (a) the loser's result read in the same run as the winner's and his late start: two results, settled as before
  const ha = 0x2651, ka = keyOf(startOf(2, ha, ro, 0).d);
  const both = [startOf(2, ha, ro, 1), startOf(2, ha, ro, 0), resultOf(2, ha, ro, 0, 0), resultOf(2, ha, ro, 1, 0)];
  const sa = [[0, [startOf(2, ha, ro, 1)]], [10 * MIN, both], [2 * HOUR, both]];
  const ra = timeline(sa), oa = outcome(ra, ka);
  T('[5a] both results read with the winner\'s late start: not bridged, settled by the two results', allOk(ra, 3) && !/start-late-1v1/.test(outOf(ra)) && oa.done && oa.wPts.length === 1 && oa.lPts.length === 1 && !oa.lLeaves, J(oa) + ' | ' + why(ra));
  withMutant(HOOK, '', '5abefore', (s) => { const m = outcome(timeline(sa, s), ka); T('[5a] the same as the code before Q261', J(m) === J(oa), J(m) + ' vs ' + J(oa)); });
  // (b) the mirror timing: the winner's start on time, the loser's first read with the winner's result (no result of the
  //     loser): Q184 pays the winner the points of his win (L is at the gate) -- as before, not bridged
  const hb = 0x2652, kb = keyOf(startOf(2, hb, ro, 0).d);
  const sb = [[0, [startOf(2, hb, ro, 0)]], [10 * MIN, [startOf(2, hb, ro, 0), startOf(2, hb, ro, 1), resultOf(2, hb, ro, 0, 0)]], [2 * HOUR, [startOf(2, hb, ro, 0), startOf(2, hb, ro, 1), resultOf(2, hb, ro, 0, 0)]]];
  const rb = timeline(sb), ob = outcome(rb, kb);
  T('[5b] the mirror timing: not bridged, Q184 pays the winner as before (points, no exit for the silent seat)', allOk(rb, 3) && !/start-late-1v1/.test(outOf(rb)) && /lone-1v1 [0-9_]+: /.test(outOf(rb))
    && ob.wPts.length === 1 && ob.wPts[0] > 2500 && !ob.lPts.length && !ob.lLeaves, J(ob) + ' | ' + why(rb));
  withMutant(HOOK, '', '5bbefore', (s) => { const m = outcome(timeline(sb, s), kb); T('[5b] the same as the code before Q261', J(m) === J(ob), J(m) + ' vs ' + J(ob)); });
  // (c) an outside start kept up next to the loser's before the result: contested, void as before (nobody settled)
  const hc = 0x2653, kc = keyOf(startOf(2, hc, ro, 0).d), xs = { sid: X, d: startOf(2, hc, ro, 1).d };
  const sc = [[0, [startOf(2, hc, ro, 1), xs]], [10 * MIN, [startOf(2, hc, ro, 1), xs, startOf(2, hc, ro, 0), resultOf(2, hc, ro, 0, 0)]], [2 * HOUR, [startOf(2, hc, ro, 1), xs, startOf(2, hc, ro, 0), resultOf(2, hc, ro, 0, 0)]]];
  const rc = timeline(sc), oc = outcome(rc, kc);
  T('[5c] an outside start from the loser\'s seat: contested, not bridged', allOk(rc, 3) && !/start-late-1v1/.test(outOf(rc)), why(rc));
  withMutant(HOOK, '', '5cbefore', (s) => { const m = outcome(timeline(sc, s), kc); T('[5c] the same as the code before Q261', J(m) === J(oc), J(m) + ' vs ' + J(oc)); });
}

// ---- [6] wiring pins ----
{
  const at = SRC.indexOf(HOOK), fn = SRC.indexOf('function screenLateStarts('), loopEnd = SRC.indexOf('      e.s.push(id); perW[w] = (perW[w] | 0) + 1;\n    }\n' + HOOK + '\n  }\n');
  T('[6] the hook sits in screenLateStarts, right after a key\'s starts are screened', SRC.split(HOOK).length === 2 && at > fn && loopEnd > fn && loopEnd < at
    && at < SRC.indexOf('// ---- an outside account may hold up only a few matches a day'));
  T('[6] screenLateStarts runs before registerStartRosters / reconcileStarts in main', SRC.indexOf('  screenLateStarts(starts, recs, startsPending') > 0
    && SRC.indexOf('  screenLateStarts(starts, recs, startsPending') < SRC.indexOf('const startsRes = reconcileStarts('));
  T('[6] the results collected per key from this run\'s records', /const resOf = \{\}, bridged = \[\];/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (lone-1v1-late-writer) ===');
process.exit(failN === 0 ? 0 : 1);
