'use strict';
// Q289 / Q290 (cloud audit 2026-10): a quick / ranked 1V1 whose two writers disagree. Before, the whole-group rule flagged
//   both writers once per key (recordFlag), so a modded loser who wrote a result giving himself the win flagged the honest
//   winner with him, and three such matches against one opponent put the opponent on trust tier 1 (TRUST_T.F1):
//     Q289  a clean result of the loser's that says he won (other scores): both flagged, nothing settles
//     Q290  the same claim on a record of his the job cannot use (V: a duration past DUR_CAP, no start of his): both flagged;
//           U / S6 (a table naming the winner twice) are held by the roster contest / voided before the flag loop -- nobody
//           flagged there, before or now
//   Now (pairDispute1v1 / pairDisputeCount, validate.js): nobody is flagged for the disagreement; a writer whose own record
//   breaks its duration bound is flagged alone (Q292: the seat is the host's, not a bound of the writer's own any more); the
//   dispute is counted on both players (pd / pdo / pdk, record-only). Nothing settles, nothing is paid: a 1V1 with two voices
//   cannot be decided, only no longer flags the honest one (architecture decision 10). Since Q291 / Q292 the rule is chosen by
//   the writers and the tables, not the match type: the other lanes of two (friends' room, endless, bot match) and the host's
//   reshaped broadcasts are in test/two-voice-dispute.js.
// Over the REAL validate.js main() against an offline board stub (the harness of test/lone-1v1-spoiled.js):
//   [1] units: pairDispute1v1 (any match type since Q291, two writers or a table of two, the duration reason, writers, the
//       tables), pairDisputeCount (once per key, distinct opponents, LOOK, the caps)
//   [2] Q289: a clean ranked / quick 1V1 dispute -- nobody flagged, counted once on both, nothing paid; mutant (no Q289 = the
//       old rule) -> both flagged
//   [3] Q290: V with the win claimed -- the loser flagged alone, the winner not; mutant (no duration reason) -> loser free;
//       U / S6 with the win claimed -- held before the loop, nobody flagged, as before
//   [4] one loser, three disputes against one honest winner: the winner stays at f 0 and gets no trust tier; mutant -> tier 1
//   [5] three different opponents: LOOK logged, counted in the summary row, still nobody flagged
//   [6] what the loser writes cannot move the key back under the old rule (a seat count of 3, another account at his own
//       seat in his roster, his record twice)
//   [7] scope: a 3-player brawl keeps the old rule (every writer flagged); a friends' room 1V1 now takes this rule (Q291)
//   [8] an old key main already flagged: no flag removed, nothing paid, counted once
//   [9] two accounts of one owner disputing each other: nothing settles, nothing is paid, nothing to gain
//   [10] wiring pins
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
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pair-dispute-1v1-'));
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
//   instant moves back instead: start sightings, absent-seat stamps, the writers' busy marks, the flag memory, the dispute keys)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const p = sg.players[k];
    if (p.bz) p.bz -= ms;   // .at stays: the players keep playing
    if (p.pdk) for (const m of Object.keys(p.pdk)) p.pdk[m] -= ms;
  }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const fOf = (r, sid) => sigOf(r, sid).f | 0;
const pdOf = (r, sid) => sigOf(r, sid).pd | 0;
const pdoOf = (r, sid) => (sigOf(r, sid).pdo || []).slice().sort();
const flaggedOf = (r) => Object.keys((r.state.SIGNALS_FILE || {}).flagged || {});
const of = (r, board, sid) => posts(r, board).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const paidIn = (rs, sid) => [].concat(...rs.map(r => of(r, 5, sid).concat(of(r, 6, sid), of(r, 7, sid), of(r, 8, sid))));   // XP, rating, points, CP
const trustIn = (rs, sid) => [].concat(...rs.map(r => of(r, 9, sid)));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat (null = an empty seat); sc: the seat scores the record claims (default by seat)
const SC = { 2: [7000, 4000], 3: [7000, 5000, 4000] };
function rec(magic, mt, hash, seat, rank, win, ros, sc, pcOver) {
  const start = magic === 0xB2, pc = pcOver || ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (sc || SC[pc] || SC[2])[i] | 0);
  d.push(0);
  for (const s of ros) { const p = s == null ? [0, 0] : sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 1V1 (two seats): `winner` = the seat the record says won; mt 2 ranked, 1 quick
const v1settle = (mt, hash, seat, ros, winner) => rec(0xB1, mt, hash, seat, seat === winner ? 1 : 2, seat === winner, ros, winner ? [4000, 7000] : [7000, 4000]);
const v1start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const durBad = (d) => d.map((x, i) => i === 9 ? 90000 : x);   // a duration past DUR_CAP
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const W = SID(2890), L = SID(2891), X = SID(2892), Y = SID(2893), Z = SID(2894);
const O = Array.from({ length: 6 }, (_, i) => SID(2900 + i));
const ALL = [W, L, X, Y, Z].concat(O);
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 9, name: 'trust_tier', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state before the first run; scripts: one per run (or one)
function timeline(steps, script, files0) {
  const out = []; let state = null;
  steps.forEach(([ms, recs, env], i) => {
    if (out.length && out[out.length - 1].code !== 0) return;
    const sc = Array.isArray(script) ? script[i] : script;
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : (files0 || null), env || null, sc);
    out.push(r); state = r.state;
  });
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');
const row289 = (r) => { const m = /\| keys of two voices \(a 1V1, a friends' room \/ endless run \/ bot match of two\) whose writers disagree, nobody flagged for it \(Q289 \/ Q291\) [^|]*\| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? m.slice(1).map(Number) : null; };
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-pair-dispute-1v1-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };
// the old rule: the Q289 branch off (every writer of a disagreeing 1V1 flagged, as on main before this fix)
const OLD = ['    const pd1 = pairDispute1v1(g);\n', '    const pd1 = null;\n'];

// one 1V1 W (seat 0) won against `lo` (seat 1): both starts, ten minutes later both results (W's honest one, `loRes` the
//   loser's), two hours on the same rows. opt.noLoStart: the loser wrote no start (V / U); opt.loStart: his start's details
function match(mt, h, w, lo, loRes, opt) {
  opt = opt || {};
  const ro = [w, lo];
  const st = [{ sid: w, d: v1start(mt, h, 0, ro) }];
  if (opt.loStart) st.push({ sid: lo, d: opt.loStart });
  else if (!opt.noLoStart) st.push({ sid: lo, d: v1start(mt, h, 1, ro) });
  const re = [{ sid: w, d: v1settle(mt, h, 0, ro, 0) }].concat((Array.isArray(loRes[0]) ? loRes : [loRes]).map(d => ({ sid: lo, d })));
  return { st, re, key: keyOf(re[0].d) };
}
// the runs: the starts; ten minutes later the results; ten more minutes (the same rows); two hours on, past STARTS_MATURITY_MS:
//   a key that never settled is voided at the start verdict (a VOID receipt, the consolation XP to every writer of a result),
//   as any disputed matchmade key is, before and after this fix
const stepsOf = (ms) => { const st = [].concat(...ms.map(m => m.st)), all = [].concat(...ms.map(m => m.st.concat(m.re))); return [[0, st], [10 * MIN, all], [10 * MIN, all], [2 * HOUR, all]]; };
const claim = (mt, h, w, lo) => v1settle(mt, h, 1, [w, lo], 1);   // the loser's clean result saying he won

// ---- [1] units ----
{
  const PD = v.PAIR_DISPUTE;
  T('[1] exported', typeof v.pairDispute1v1 === 'function' && typeof v.pairDisputeCount === 'function' && !!PD);
  if (PD) {   // (without the fix the units are skipped, the runs below still show what it changes)
  T('[1] PAIR_DISPUTE: 8 opponents kept, keys kept > the shard count (50 + 14), LOOK 3, own reason the duration only (Q292: the seat is the host\'s)',
    PD.OPP_CAP === 8 && PD.KEYS_CAP === 64 && PD.LOOK === 3 && JSON.stringify(PD.OWN) === '["duration"]', JSON.stringify(PD));
  // a record as main() hands it to the flag loop: details, writer, decoded roster (seat -> sid)
  const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
  const h = 0x2890;
  const dispute = (mt) => [R(W, v1settle(mt, h, 0, [W, L], 0)), R(L, v1settle(mt, h, 1, [W, L], 1))];
  const res = (g) => { const x = v.pairDispute1v1(g); return x && { own: x.own.map(o => o.sid + ':' + o.why.join(',')), rest: x.rest.map(o => o.sid).sort(), pair: x.pair && x.pair.slice().sort() }; };
  const WL = [W, L].sort();
  eq('[1] ranked (2) and quick (1) dispute: a pair, nobody own', [res(dispute(2)), res(dispute(1))], [{ own: [], rest: WL, pair: WL }, { own: [], rest: WL, pair: WL }]);
  eq('[1] Q291 / Q292: every other match type (team 3 / 6, endless 7, friends\' room 10, bot 11, quick and ranked with a party bit, 0) with two voices: a pair, nobody own',
    [3, 6, 7, 10, 11, 0x11, 0x12, 0].map(mt => res(dispute(mt))), [3, 6, 7, 10, 11, 0x11, 0x12, 0].map(() => ({ own: [], rest: WL, pair: WL })));
  eq('[1] empty / missing group: null', [v.pairDispute1v1([]), v.pairDispute1v1(null)], [null, null]);
  // no table of two seating its writer: two writers are still two voices (Q292: the seat count and the table are the host's);
  //   a pair when every table that seats its own writer names both, none when no record seats its writer
  const three = [R(W, rec(0xB1, 2, h, 0, 1, true, [W, L, X])), R(L, rec(0xB1, 2, h, 1, 1, true, [W, L, X], [4000, 7000, 5000]))];
  const notSelf = [R(W, v1settle(2, h, 0, [L, W], 0)), R(L, v1settle(2, h, 1, [L, W], 1))];
  eq('[1] two writers, no table of two (three-seat records naming both; nobody at his own seat): two voices -- a pair / no pair, nobody flagged',
    [res(three), res(notSelf)], [{ own: [], rest: WL, pair: WL }, { own: [], rest: WL, pair: null }]);
  const three3 = three.concat([R(X, rec(0xB1, 2, h, 2, 1, true, [W, L, X], [4000, 5000, 7000]))]);
  eq('[1] three writers on three-seat tables: three voices, not this rule (the old rule)', res(three3), null);
  eq('[1] one writer\'s own records disagreeing with each other: not two voices, not this rule',
    res([R(L, v1settle(2, h, 1, [W, L], 1)), R(L, v1settle(2, h, 1, [W, L], 0))]), null);
  const g1 = [R(W, v1settle(2, h, 0, [W, L], 0)), R(L, rec(0xB1, 2, h, 1, 1, true, [W, L, X], [4000, 7000, 5000]))];
  eq('[1] the loser\'s record says three seats: two voices, a pair (his seat count cannot move the key back)', res(g1), { own: [], rest: WL, pair: WL });
  eq('[1] V: his duration past DUR_CAP -> flagged alone, no pair', res([R(W, v1settle(2, h, 0, [W, L], 0)), R(L, durBad(v1settle(2, h, 1, [W, L], 1)))]), { own: [L + ':duration'], rest: [W], pair: null });
  const seatBad = v1settle(2, h, 1, [W, L], 1); seatBad[5] = 5;
  eq('[1] Q292: his seat outside his own seat count (the host hands the joiner his seat) -> nobody flagged, a pair', res([R(W, v1settle(2, h, 0, [W, L], 0)), R(L, seatBad)]), { own: [], rest: WL, pair: WL });
  eq('[1] roster reasons flag nobody (another account at his seat; a name twice): a pair',
    [res([R(W, v1settle(2, h, 0, [W, L], 0)), R(L, v1settle(2, h, 1, [W, X], 1))]), res([R(W, v1settle(2, h, 0, [W, L], 0)), R(L, v1settle(2, h, 1, [W, W], 1))])],
    [{ own: [], rest: WL, pair: WL }, { own: [], rest: WL, pair: WL }]);
  eq('[1] his record twice (two claims): one writer, a pair', res(dispute(2).concat([R(L, v1settle(2, h, 1, [W, L], 0).map((x, i) => i === 10 ? 6999 : x))])), { own: [], rest: WL, pair: WL });
  eq('[1] a third writer: nobody flagged, no pair', res(dispute(2).concat([R(X, v1settle(2, h, 1, [W, X], 1))])), { own: [], rest: [W, L, X].sort(), pair: null });
  eq('[1] a writer not on the anchor\'s table (the other seat empty on it): no pair',
    [res([R(W, v1settle(2, h, 0, [W, null], 0)), R(L, v1settle(2, h, 1, [W, L], 1))]), res([R(W, v1settle(2, h, 0, [W, L], 0)), R(X, v1settle(2, h, 1, [W, X], 1))]).pair],
    [{ own: [], rest: WL, pair: null }, null]);
  eq('[1] the winner\'s own record bad (duration): he is flagged alone, the loser not', res([R(W, durBad(v1settle(2, h, 0, [W, L], 0))), R(L, v1settle(2, h, 1, [W, L], 1))]), { own: [W + ':duration'], rest: [L], pair: null });

  // pairDisputeCount
  const sig = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} });
  const s = sig(), t = 1e12;
  const c1 = v.pairDisputeCount(s, [W, L], 'k1', t), c2 = v.pairDisputeCount(s, [W, L], 'k1', t + 1);
  const pw = s.players[v.pid(W)], pl = s.players[v.pid(L)];
  eq('[1] count: both once per key; the same key again counts nobody', [c1.n, c2.n, pw.pd, pl.pd, pw.pdo, pl.pdo, Object.keys(pw.pdk), pw.f | 0, pl.f | 0],
    [2, 0, 1, 1, [v.pid(L)], [v.pid(W)], ['k1'], 0, 0]);
  const s2 = sig(), looks = [];
  for (let i = 0; i < 10; i++) looks.push(v.pairDisputeCount(s2, [W, O[i % 6] || X], 'm' + i, t + i).look.slice());
  const pw2 = s2.players[v.pid(W)];
  eq('[1] count: LOOK when an account first reaches 3 different opponents, once; repeats of an opponent count pd, not pdo',
    [looks.map(x => x.length), looks[2], pw2.pd, pw2.pdo.length], [[0, 0, 1, 0, 0, 0, 0, 0, 0, 0], [W], 10, 6]);
  const s3 = sig();
  for (let i = 0; i < 12; i++) v.pairDisputeCount(s3, [W, SID(3000 + i)], 'n' + i, t + i);
  for (let i = 0; i < 70; i++) v.pairDisputeCount(s3, [W, L], 'q' + i, t + 100 + i);
  const pw3 = s3.players[v.pid(W)], ks = Object.keys(pw3.pdk);
  eq('[1] count: at most OPP_CAP opponents and KEYS_CAP keys (the oldest go)', [pw3.pdo.length, ks.length, ks.indexOf('n0') < 0, ks.indexOf('q69') >= 0, pw3.pd], [8, 64, true, true, 82]);
  }
}

// ---- [2] Q289: a clean dispute ----
for (const [mt, name] of [[2, 'ranked'], [1, 'quick']]) {
  const m = match(mt, 0x2892 + mt, W, L, claim(mt, 0x2892 + mt, W, L));
  const steps = stepsOf([m]);
  const rs = timeline(steps);
  const tag = '[2] ' + name + ' (' + mt + ')';
  if (!allOk(rs, 4)) { bad(tag + ': runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500)); continue; }
  eq(tag + ': nobody flagged (winner, loser) on any run, the key never in the flag memory', [rs.map(r => fOf(r, W) + fOf(r, L)), rs.some(r => flaggedOf(r).indexOf(m.key) >= 0)], [[0, 0, 0, 0], false]);
  eq(tag + ': counted once on both, each the other\'s opponent', [pdOf(last(rs), W), pdOf(last(rs), L), pdoOf(last(rs), W), pdoOf(last(rs), L)], [1, 1, [v.pid(L)], [v.pid(W)]]);
  T(tag + ': logged on each run it is read, "(already)" once counted', /pair-dispute [^\n]*: 2 records of two voices disagree -- nobody flagged for the disagreement, counted on both players \(Q289 \/ Q291\)/.test(rs[1].out)
    && /counted on both players \(already\) \(Q289 \/ Q291\)/.test(rs[2].out));
  eq(tag + ': summary row (disputes / flagged alone / LOOK)', [row289(rs[1]), row289(rs[2])], [[1, 0, 0], [1, 0, 0]]);
  withMutant(OLD[0], OLD[1], tag, (sc) => {
    const ms = timeline(steps, sc);
    T(tag + ' mutant: the old rule -> the honest winner flagged with the loser (Q289)', allOk(ms, 4) && fOf(last(ms), W) === 1 && fOf(last(ms), L) === 1,
      JSON.stringify([fOf(last(ms), W), fOf(last(ms), L)]));
    T(tag + ': never settled, voided at the start verdict as before -- the same consolation XP for both as under the old rule ([50] each), no points, no trust write',
      allOk(ms, 4) && processedOf(last(rs)).has(m.key) && JSON.stringify([paidIn(rs, W), paidIn(rs, L)]) === JSON.stringify([paidIn(ms, W), paidIn(ms, L)])
      && JSON.stringify(paidIn(rs, W)) === '[50]' && JSON.stringify(paidIn(rs, L)) === '[50]' && trustIn(rs, W).length + trustIn(rs, L).length === 0
      && /start-orphan [^\n]*: started, never settled/.test(rs[3].out) && (mt !== 2 || /receipt [^\n]*: never settled -> VOID receipt/.test(rs[3].out)), JSON.stringify([paidIn(rs, W), paidIn(rs, L), paidIn(ms, W), paidIn(ms, L)]));
  });
  if (mt === 2) withMutant('    if (old && hasKey(old.pdk, m)) continue;\n', '    if (false) continue;\n', tag + 'twice', (sc) => {
    const ms = timeline(steps, sc);
    T(tag + ' mutant: no per-key memory -> counted on every run before the void (2)', allOk(ms, 4) && pdOf(last(ms), W) === 2, String(pdOf(last(ms), W)));
  });
}

// ---- [3] Q290: a record of his the job cannot use, with the win claimed ----
{
  const h = 0x2895;
  const m = match(2, h, W, L, durBad(claim(2, h, W, L)), { noLoStart: true });   // V, no start of his
  const steps = stepsOf([m]);
  const rs = timeline(steps);
  if (!allOk(rs, 4)) bad('[3] V: runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500));
  else {
    eq('[3] V + win claimed: the loser flagged alone (his duration), the winner not', [fOf(last(rs), W), fOf(last(rs), L)], [0, 1]);
    eq('[3] V: no dispute counted (one writer left after his own record)', [pdOf(last(rs), W), pdOf(last(rs), L)], [0, 0]);
    T('[3] V: logged "flagged alone", summary row', /records of two voices disagree -- nobody flagged for the disagreement, [0-9a-f]+[^\n]*\(duration on his own record\) flagged alone \(Q289 \/ Q291\)/.test(rs[1].out)
      && JSON.stringify(row289(rs[1])) === '[1,1,0]', JSON.stringify(row289(rs[1])) + ' ' + (/pair-dispute [^\n]*/.exec(rs[1].out) || [''])[0]);
    withMutant(OLD[0], OLD[1], '3V', (sc) => {
      const ms = timeline(steps, sc);
      T('[3] V mutant: the old rule -> the honest winner flagged too (Q290)', allOk(ms, 4) && fOf(last(ms), W) === 1 && fOf(last(ms), L) === 1, JSON.stringify([fOf(last(ms), W), fOf(last(ms), L)]));
      T('[3] V: paid as under the old rule (the start verdict is not this rule\'s)', allOk(ms, 4) && JSON.stringify([paidIn(rs, W), paidIn(rs, L)]) === JSON.stringify([paidIn(ms, W), paidIn(ms, L)]),
        JSON.stringify([paidIn(rs, W), paidIn(rs, L), paidIn(ms, W), paidIn(ms, L)]));
    });
    withMutant("OWN: ['duration'] }", 'OWN: [] }', '3own', (sc) => {
      const ms = timeline(steps, sc);
      T('[3] V mutant: no duration reason -> the loser goes free of the flag his own record earns', allOk(ms, 4) && fOf(last(ms), L) === 0 && fOf(last(ms), W) === 0, JSON.stringify([fOf(last(ms), W), fOf(last(ms), L)]));
    });
  }
  // U / S6 with the win claimed: a table naming the winner twice (and in S6 a start of his on it)
  for (const [tag, loRes, opt] of [['U', claim(2, h + 1, W, W), { noLoStart: true }], ['S6', claim(2, h + 2, W, W), { loStart: v1start(2, h + 2, 1, [W, W]) }]]) {
    const hh = tag === 'U' ? h + 1 : h + 2;
    const mm = match(2, hh, W, L, loRes, opt);
    const ss = stepsOf([mm]);
    const a = timeline(ss);
    let b = null;
    withMutant(OLD[0], OLD[1], '3' + tag, (sc) => { b = timeline(ss, sc); });
    T('[3] ' + tag + ' + win claimed: the winner not flagged, now and under the old rule (held before the flag loop)', allOk(a, 4) && b && allOk(b, 4)
      && fOf(last(a), W) === 0 && fOf(last(b), W) === 0 && fOf(last(a), L) === fOf(last(b), L) && JSON.stringify(paidIn(a, W)) === JSON.stringify(paidIn(b, W)),
      JSON.stringify([fOf(last(a), W), fOf(last(a), L), b && fOf(last(b), W), b && fOf(last(b), L)]));
  }
}

// ---- [4] one loser, three disputes against one honest winner ----
{
  const ms3 = [0x28a1, 0x28a2, 0x28a3].map(h => match(2, h, W, L, claim(2, h, W, L)));
  const steps = stepsOf(ms3);
  const rs = timeline(steps);
  if (!allOk(rs, 4)) bad('[4] runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500));
  else {
    eq('[4] three disputes: the winner f 0, no trust tier for anybody; counted 3 on each, one opponent', [fOf(last(rs), W), fOf(last(rs), L), trustIn(rs, W), trustIn(rs, L), pdOf(last(rs), W), pdoOf(last(rs), W)],
      [0, 0, [], [], 3, [v.pid(L)]]);
    withMutant(OLD[0], OLD[1], '4', (sc) => {
      const m = timeline(steps, sc);
      T('[4] mutant: the old rule -> the honest winner on trust tier 1 (Q289)', allOk(m, 4) && fOf(last(m), W) === 3 && trustIn(m, W).indexOf(1) >= 0, JSON.stringify([fOf(last(m), W), trustIn(m, W)]));
    });
  }
}

// ---- [5] three different opponents: LOOK ----
{
  const ms3 = [[0x28b1, O[0]], [0x28b2, O[1]], [0x28b3, O[2]]].map(([h, lo]) => match(1, h, W, lo, claim(1, h, W, lo)));
  const rs = timeline(stepsOf(ms3));
  if (!allOk(rs, 4)) bad('[5] runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500));
  else {
    eq('[5] three opponents: nobody flagged, W counted 3 against 3', [fOf(last(rs), W)].concat(O.slice(0, 3).map(s => fOf(last(rs), s)), [pdOf(last(rs), W), pdoOf(last(rs), W).length]), [0, 0, 0, 0, 3, 3]);
    T('[5] LOOK logged once (no Steam id in the line), summary row', (outOf(rs).match(/has now disputed results of two with 3 different opponents -- record only, nobody flagged \(Q289 \/ Q291\)/g) || []).length === 1
      && JSON.stringify(row289(rs[1])) === '[3,0,1]' && JSON.stringify(row289(rs[2])) === '[3,0,0]' && !/pair-dispute: 7656/.test(outOf(rs)),
      JSON.stringify([row289(rs[1]), row289(rs[2])]));
  }
}

// ---- [6] what the loser writes cannot move the key back under the old rule ----
{
  const h = 0x28c0;
  const shapes = [
    ['a seat count of 3 in his record', rec(0xB1, 2, h, 1, 1, true, [W, L, X], [4000, 7000, 5000])],
    ['another account at his own seat in his roster', claim(2, h + 1, W, X)],
    ['his record twice, two claims', [claim(2, h + 2, W, L), v1settle(2, h + 2, 1, [W, L], 1).map((x, i) => i === 11 ? 6999 : x)]],
  ];
  shapes.forEach(([name, loRes], i) => {
    const m = match(2, h + i, W, L, loRes);
    const steps = stepsOf([m]).slice(0, 3);
    const rs = timeline(steps);
    let old = null;
    withMutant(OLD[0], OLD[1], '6' + i, (sc) => { old = timeline(steps, sc); });
    T('[6] ' + name + ': reaches the dispute rule, the winner not flagged (under the old rule he was)', allOk(rs, 3) && old && allOk(old, 3)
      && fOf(last(rs), W) === 0 && pdOf(last(rs), W) === 1 && fOf(last(old), W) === 1,
      JSON.stringify([rs.map(r => r.code), fOf(last(rs), W), fOf(last(rs), L), pdOf(last(rs), W), old && fOf(last(old), W)]) + ' ' + (/(pair-dispute|roster contest|seat gate)[^\n]*/.exec(outOf(rs)) || [''])[0]);
  });
}

// ---- [7] scope: other keys keep their rules ----
{
  // a quick 3-player brawl, one dissenter: every writer flagged, as before (Q109; majority rule = a question of its own)
  const h = 0x28d0, ro = [X, Y, Z];
  const r3 = (sid, seat, sc) => ({ sid, d: rec(0xB1, 1, h, seat, 1 + seat, seat === 0, ro, sc) });
  const st = ro.map((s, i) => ({ sid: s, d: rec(0xB2, 1, h, i, 0, false, ro) }));
  const re = [r3(X, 0), r3(Y, 1), r3(Z, 2, [4000, 5000, 7000])];
  const rs = timeline([[0, st], [10 * MIN, st.concat(re)]]);
  eq('[7] 3-player quick brawl with one dissenter: every writer flagged once, as before', allOk(rs, 2) && ro.map(s => fOf(last(rs), s)), [1, 1, 1]);
  // a friends' room (10) with two writers who disagree: Q291 -- two voices, nobody flagged, counted on both (was: both flagged)
  const m10 = match(10, 0x28d1, W, L, claim(10, 0x28d1, W, L));
  const r10 = timeline(stepsOf([m10]).slice(0, 2));
  eq('[7] friends\' room 1V1 dispute (Q291): nobody flagged, counted on both', allOk(r10, 2) && [fOf(last(r10), W), fOf(last(r10), L), pdOf(last(r10), W)], [0, 0, 1]);
  withMutant(OLD[0], OLD[1], '7room', (sc) => {
    const o10 = timeline(stepsOf([m10]).slice(0, 2), sc);
    eq('[7] friends\' room 1V1 dispute, the old rule: both flagged', allOk(o10, 2) && [fOf(last(o10), W), fOf(last(o10), L)], [1, 1]);
  });
}

// ---- [8] an old key main already flagged ----
{
  const h = 0x28e0;
  const m = match(2, h, W, L, claim(2, h, W, L));
  const steps = stepsOf([m]);
  withMutant(OLD[0], OLD[1], '8', (sc) => {
    const rs = timeline(steps, [sc, sc, null, null]);
    const allOld = timeline(steps, sc);
    T('[8] two runs of the old rule flag both; the new rule then keeps the flag (no key judged again) and counts the dispute once',
      allOk(rs, 4) && fOf(rs[1], W) === 1 && fOf(rs[1], L) === 1 && fOf(rs[2], W) === 1 && fOf(rs[2], L) === 1 && fOf(last(rs), W) === 1 && fOf(last(rs), L) === 1
      && pdOf(last(rs), W) === 1 && pdOf(last(rs), L) === 1 && flaggedOf(rs[2]).indexOf(m.key) >= 0, JSON.stringify(rs.map(r => [fOf(r, W), fOf(r, L), pdOf(r, W)])));
    T('[8] paid as under the old rule all the way (the void\'s consolation XP), no trust write', allOk(allOld, 4) && JSON.stringify([paidIn(rs, W), paidIn(rs, L)]) === JSON.stringify([paidIn(allOld, W), paidIn(allOld, L)])
      && JSON.stringify(trustIn(rs, W)) === JSON.stringify(trustIn(allOld, W)), JSON.stringify([paidIn(rs, W), paidIn(allOld, W)]));
  });
}

// ---- [9] two accounts of one owner disputing each other ----
{
  const ms5 = [0x28f1, 0x28f2, 0x28f3, 0x28f4, 0x28f5].map((h, i) => (i % 2 ? match(2, h, Y, X, claim(2, h, Y, X)) : match(2, h, X, Y, claim(2, h, X, Y))));
  const steps = stepsOf(ms5);
  const rs = timeline(steps);
  let old = null;
  withMutant(OLD[0], OLD[1], '9', (sc) => { old = timeline(steps, sc); });
  T('[9] five disputes between two accounts: no rating, points or CP; the void\'s consolation XP the same as under the old rule; no trust write',
    allOk(rs, 4) && old && allOk(old, 4) && [X, Y].every(s => paidIn(rs, s).every(x => x % 50 === 0) && JSON.stringify(paidIn(rs, s)) === JSON.stringify(paidIn(old, s))
      && of(last(rs), 6, s).length + of(last(rs), 7, s).length + of(last(rs), 8, s).length === 0) && trustIn(rs, X).length + trustIn(rs, Y).length === 0,
    JSON.stringify([paidIn(rs, X), paidIn(rs, Y), old && paidIn(old, X)]));
  eq('[9] neither flagged now (the old rule flagged both 5 times), 5 disputes counted, one opponent', [fOf(last(rs), X), fOf(last(rs), Y), old && fOf(last(old), X), pdOf(last(rs), X), pdoOf(last(rs), X).length], [0, 0, 5, 5, 1]);
}

// ---- [10] wiring pins ----
{
  const loop = SRC.slice(SRC.indexOf('for (const { m, g } of inconsistentGroups) {'));
  T('[10] the flag loop: settled keys (Q114), then ungated endless keys (Q128), then the 1V1 dispute, before recordFlag',
    /if \(processed\.has\(m\)\) \{[\s\S]{0,300}?continue;\n\s+\}\n[\s\S]{0,900}?if \(isEndlessMt\(g\[0\]\.d\[2\] \| 0\) && !seatGateRoster\(startsPending\[m\]\)\) \{[\s\S]{0,300}?continue;\n\s+\}\n[\s\S]{0,400}?const pd1 = pairDispute1v1\(g\);\n\s+if \(pd1\) \{[\s\S]{0,1600}?\n\s+continue;\n\s+\}\n\s+if \(recordFlag\(signals, g, m, nowMs\)\) sigDirty = true;/.test(loop));
  const blk = loop.slice(loop.indexOf('const pd1 = pairDispute1v1(g);'), loop.indexOf('if (recordFlag(signals, g, m, nowMs)) sigDirty = true;'));
  T('[10] the dispute branch: only the own-field writers reach recordFlag, the count dirties the signals, no other write',
    (blk.match(/recordFlag\(/g) || []).length === 1 && /recordFlag\(signals, \[\]\.concat\(\.\.\.pd1\.own\.map\(\(x\) => x\.recs\)\), m, nowMs\)/.test(blk)
    && /if \(cnt\.n\) sigDirty = true;/.test(blk) && !/creditXp|writeLp|postForm|processed\.add|flagPlayer/.test(blk));
  T('[10] pairDispute1v1 reads its own-field reasons from recordSanityFlags on the base match type, any match type (Q291 / Q292)',
    !/if \(mt !== 1 && mt !== 2\) return null;/.test(SRC) && /const base = baseMt\(g\[0\]\.d\[2\] \| 0\);/.test(SRC)
    && /recordSanityFlags\(r, base, r\.d\[8\] \| 0\)\) if \(PAIR_DISPUTE\.OWN\.indexOf\(f\) >= 0/.test(SRC));
  T('[10] summary row', /'\| keys of two voices \(a 1V1, a friends\\' room \/ endless run \/ bot match of two\) whose writers disagree, nobody flagged for it \(Q289 \/ Q291\) \/ [\s\S]{0,200}?' \+ PAIR_DISPUTE\.LOOK \+ ' different dispute opponents \(record only\) \| ' \+ s\('pairDispute', 0\) \+ ' \/ ' \+ s\('pairDisputeOwn', 0\) \+ ' \/ ' \+ s\('pairDisputeLook', 0\)/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (pair-dispute-1v1) ===');
process.exit(failN === 0 ? 0 : 1);
