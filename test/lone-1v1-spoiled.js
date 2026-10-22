'use strict';
// Q216 (cloud audit 2026-10): a ranked 1V1 whose loser wrote only records the job cannot use. Q184 decides a ranked 1V1
//   the loser wrote NOTHING for; a modded loser who instead writes one bad record got around it, and the honest winner's
//   win was lost all the same:
//     V   no start, a result out of the sanity bounds (a duration past DUR_CAP): never settled, nothing decided
//     U   no start, a result naming his opponent at both seats (or another account at the winner's seat): the roster
//         contest voids the key, nobody consoled, nothing decided
//     S6  a start naming that bad table too, plus such a result: the start-orphan verdict voids it (the winner consoled
//         50 XP), nothing decided
//   Now such a key is decided like Q184's (lone1v1Spoiled, from the starts verdicts and from the voided keys via
//   lone1v1VoidClaims): counted on the loser, nobody flagged, nothing taken from anybody; the winner paid the points of a
//   normal 1V1 win once two different accounts have such claims against him (Q184's gate, cap and queue), and a winner
//   the void already consoled is not consoled twice (x0). A loser whose record disputes the result (says he won, other
//   scores) is not this case: left as it was.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/lone-1v1-win.js).
//   [1] units: lone1v1Spoiled (each shape, each condition), lone1v1VoidClaims (x0, the incomplete read), lone1v1Count x0
//   [2] one loser, three opponents, the three shapes S6 / V / U: counted on him, each winner paid once at the gate, the
//       same points and XP as the silent-loser twin (Q184); mutants (no Q216 = today's main; x0 ignored -> two XP)
//   [3] U2 / U3 / S6c at the gate
//   [4] honest controls and disputes, nothing from Q216: an honest loss; his clean / bad result saying he won (mutant: no
//       dispute check -> paid); a start alone (S6b / S6d, as before); the winner's own record bad; a third writer; a
//       contest void on an incomplete read (mutant: no read check -> claimed); V held on an incomplete read; a confession
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lone-1v1-spoiled-'));
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
const L = SIDQ(2160), C = SIDQ(2161), D = SIDQ(2162);
const O = Array.from({ length: 10 }, (_, i) => SIDQ(2170 + i));
const ALL = [L, C, D].concat(O);
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
const row216 = (r) => { const m = /\| ranked 1V1s whose loser wrote only records the job cannot use \(Q216; counted and paid in the Q184 row below\)[^|]*\| ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? m.slice(1).map(Number) : null; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const LINE = /lone-1v1 [0-9]+_[0-9]+_[0-9]+: /;
const LINE216 = /wrote only records the job cannot use \(Q216\)/;
const stepsOf = (...parts) => [].concat(...parts);
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-lone-1v1-spoiled-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const withMutant = (from, to, tag, fn) => { const s = mutant(from, to, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

// the loser's records that spoil themselves (he sits at seat 1, the winner w at seat 0; the scores are the winner's [7000, 4000])
const VEC = [7000, 4000];
const lost = (h, ro) => rec(0xB1, 2, h, 1, 2, false, ro, VEC);   // his result, on the table ro
const durBad = (d) => d.map((x, i) => i === 9 ? 90000 : x);      // a duration past DUR_CAP
const SHAPES = {
  V: (h, w) => ({ res: [durBad(lost(h, [w, L]))] }),                                    // no start, a result out of the sanity bounds
  U: (h, w) => ({ res: [lost(h, [w, w])] }),                                            // no start, a result naming his opponent twice
  U2: (h, w) => ({ res: [lost(h, [C, L])] }),                                           // no start, a result naming another account at the winner's seat
  U3: (h, w) => ({ res: [durBad(lost(h, [w, w]))] }),                                   // both
  S6: (h, w) => ({ start: [rec(0xB2, 2, h, 1, 0, false, [w, w])], res: [lost(h, [w, w])] }),   // that table in his start too
  S6c: (h, w) => ({ start: [rec(0xB2, 2, h, 1, 0, false, [w, w])], res: [durBad(lost(h, [w, L]))] }),
  Z: () => ({}),                                                                          // nothing (Q184)
};
// one match the winner w (seat 0) won against L: the starts (his own, and the loser's if the shape has one), ten minutes later
//   the results, the verdict two hours on; extra: rows that stay on the shards the whole time (earlier matches)
function match(h, w, shape, extra, opt) {
  opt = opt || {};
  const ro = [w, L], sh = (typeof shape === 'function' ? shape : SHAPES[shape])(h, w);
  const st = [{ sid: w, d: v1start(h, 0, ro) }].concat((sh.start || []).map(d => ({ sid: L, d })));
  const re = [{ sid: w, d: opt.res || v1settle(h, 0, ro, 0) }].concat((sh.res || []).map(d => ({ sid: L, d })));
  const ex = extra || [];
  const more = opt.more || [];
  return { steps: [[opt.gap || 0, ex.concat(st, more)], [10 * MIN, ex.concat(st, re, more)], [2 * HOUR, ex.concat(st, re, more), opt.env]], recs: st.concat(re, more) };
}
const sigEntry2 = () => ({ g: 3, w: 2, v: 0, f: 0, ns: 0, disp: [3, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now() });
const sigOn = (sids) => { const players = {}; for (const s of sids) players[v.pid(s)] = sigEntry2(); return { SIGNALS_FILE: { day: { d: 0, n: {} }, players, pairs: {}, flagged: {}, rep: {}, rseen: {} } }; };
const KEY = (h) => h + '_1234_2';

console.log('=== a ranked 1V1 whose loser wrote only records the job cannot use: counted on him, the winner paid at the gate (Q216) ===');

// ---- [1] units ----
{
  const h = 0x2161, w = O[0], ro = [w, L], key = KEY(h);
  const R = (d, sid) => { const pc = d[8] | 0; return { steamID: sid, d, dispCode: d[10 + pc] | 0, roster: v.decodeRoster(d) }; };
  const S = (d, sid) => ({ start: true, steamID: sid, d, roster: v.decodeRoster(d) });
  const id = (s) => v.pid(String(s.steamID)) + '@' + (s.d[5] | 0) + '#' + v.startSig(s);
  const stW = S(v1start(h, 0, ro), w), resW = R(v1settle(h, 0, ro, 0), w);
  const note = (starts, more) => Object.assign({ t0: 0, s: starts.map(id), r: 1, c: 0 }, more || {});
  const cl = (e, g, strict, pids, cs, seen) => v.lone1v1Spoiled(e, key, g, cs || {}, seen || new Set(), !!strict, pids || null);
  const yes = (label, e, g, strict, pids) => { const c = cl(e, g, strict, pids); T('[1] claim: ' + label, !!c && c.w === w && c.o === L && c.seat === 0 && c.m === key && c.spoiled === 1, JSON.stringify(c)); };
  const no = (label, e, g, strict, pids, cs, seen) => T('[1] no claim: ' + label, cl(e, g, strict, pids, cs, seen) === null);
  const bV = R(durBad(lost(h, ro)), L), bU = R(lost(h, [w, w]), L), bU2 = R(lost(h, [C, L]), L);
  yes('V (no start, a result past the duration bound)', note([stW]), [resW, bV]);
  yes('U (no start, a result naming his opponent twice), contested by the two of them', note([stW], { c: 1, w: [v.pid(w) + 'o', v.pid(L) + 'o'] }), [resW, bU], true);
  yes('U2 (another account at the winner\'s seat)', note([stW], { c: 1, w: [v.pid(w) + 'x', v.pid(L) + 'o'] }), [bU2, resW], true);
  yes('S6 (his start names that table too), the registered roster the winner alone', note([stW, S(rec(0xB2, 2, h, 1, 0, false, [w, w]), L)], { c: 1, w: [v.pid(L) + 'o'] }), [resW, bU], true, [v.pid(w)]);
  yes('his own start read late with his result (Q254 lo)', note([], { lo: [id(stW)] }), [resW, bV]);
  yes('a retry of each record', note([stW, stW]), [resW, bV, R(v1settle(h, 0, ro, 0), w), bV]);
  yes('an outside start in the note of a key nobody voided (Q184 lets it be)', note([stW, S(v1start(h, 1, [D, C]), C)]), [resW, bV]);
  no('his result is a usable one (the usual settle\'s)', note([stW]), [resW, R(lost(h, ro), L)]);
  no('his bad result claims his win (a dispute)', note([stW]), [resW, R(durBad(rec(0xB1, 2, h, 1, 1, true, ro, [4000, 7000])), L)]);
  no('his bad result carries other scores', note([stW]), [resW, R(durBad(rec(0xB1, 2, h, 1, 2, false, ro, [7000, 3999])), L)]);
  no('a third writer', note([stW]), [resW, bV, R(durBad(lost(h, [w, C])), C)]);
  no('only the loser wrote', note([stW]), [bV]);
  no('the winner\'s own result is bad too', note([stW]), [R(durBad(v1settle(h, 0, ro, 0)), w), bV]);
  no('the winner\'s result says he lost', note([stW]), [R(v1settle(h, 0, ro, 1), w), R(durBad(rec(0xB1, 2, h, 1, 1, true, ro, [4000, 7000])), L)]);
  no('no start of the winner\'s read before the result', note([]), [resW, bV]);
  no('a start of the winner\'s naming another table', note([S(v1start(h, 0, [w, C]), w)]), [resW, bV]);
  no('the loser\'s own start on the winner\'s table read before the result', note([stW, S(v1start(h, 1, ro), L)]), [resW, bV]);
  no('a voided key with an outside start in its note', note([stW, S(v1start(h, 1, [D, C]), C)], { c: 1, w: [v.pid(L) + 'o'] }), [resW, bU], true);
  no('a contest whose parties name somebody else', note([stW], { c: 1, w: [v.pid(L) + 'o', v.pid(C) + 'x'] }), [resW, bU], true);
  no('a registered roster naming somebody else', note([stW], { c: 1, w: [v.pid(L) + 'o'] }), [resW, bU], true, [v.pid(w), v.pid(C)]);
  no('he confessed (counted earlier)', note([stW]), [resW, bV], false, null, { [v.pid(L) + '|' + key]: { t0: 1 } });
  no('he confessed (read this run)', note([stW]), [resW, bV], false, null, {}, new Set([v.pid(L) + '|' + key]));
  no('a quick 1V1', note([S(v1start(h, 0, ro).map((x, i) => i === 2 ? 1 : x), w)]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 2 ? 1 : x), w), R(durBad(lost(h, ro)).map((x, i) => i === 2 ? 1 : x), L)]);
  no('party bits on the match type', note([stW]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 2 ? 0x12 : x), w), R(durBad(lost(h, ro)).map((x, i) => i === 2 ? 0x12 : x), L)]);
  no('a peers-gone result of the winner\'s', note([stW]), [R(v1settle(h, 0, ro, 0).map((x, i) => i === 12 ? 1 : x), w), bV]);
  no('no note', null, [resW, bV]);
  // lone1v1VoidClaims: the voided keys, x0, the incomplete read
  const g = { [key]: [resW, bU] }, e = note([stW], { c: 1, w: [v.pid(L) + 'o'] });
  let c = v.lone1v1VoidClaims([{ m: key, pids: [], note: e }], g, [], {}, new Set(), true);
  T('[1] void claims: a contest void -> one claim, not consoled (no x0)', c.length === 1 && c[0].w === w && !c[0].x0, JSON.stringify(c));
  c = v.lone1v1VoidClaims([{ m: key, pids: [v.pid(w)], note: e }], g, [String(w)], {}, new Set(), true);
  T('[1] void claims: a start-orphan void that consoled him -> x0', c.length === 1 && c[0].x0 === 1, JSON.stringify(c));
  c = v.lone1v1VoidClaims([{ m: key, pids: [], note: e }], g, [], {}, new Set(), false);
  T('[1] void claims: an incomplete read -> nothing claimed', c.length === 0);
  T('[1] void claims: no note / another match type -> nothing', v.lone1v1VoidClaims([{ m: key, pids: [] }, { m: h + '_1234_1', pids: [], note: e }], Object.assign({ [h + '_1234_1']: [resW, bU] }, g), [], {}, new Set(), true).length === 0);
  // lone1v1Count: x0 rides the payment and the waiting claim
  const now = 50 * DAY, sid = (h2) => O.find(s => v.pid(s) === h2) || null;
  const sg = sigOn([L]).SIGNALS_FILE;
  let r = v.lone1v1Count([{ m: 'k1', w: O[1], o: L, seat: 0, spoiled: 1, x0: 1 }], sg, now, sid);
  const pl = sg.players[v.pid(L)];
  T('[1] count: a Q216 claim is counted like a Q184 one; consoled at its void -> waits with x', r.counted === 1 && r.queued === 1 && pl.l1 === 1 && pl.l1q[0].x === 1, JSON.stringify(pl));
  r = v.lone1v1Count([{ m: 'k2', w: O[2], o: L, seat: 0 }], sg, now + 1, sid);
  T('[1] count: at the gate both paid; the one consoled at its void with x0, the other without', r.pay.length === 2 && r.pay.find(p => p.sid === O[1]).x0 === 1 && !('x0' in r.pay.find(p => p.sid === O[2])), JSON.stringify(r.pay));
  r = v.lone1v1Count([{ m: 'k3', w: O[3], o: L, seat: 0, spoiled: 1, x0: 1 }], sg, now + 2, sid);
  T('[1] count: past the gate a consoled claim is paid at once with x0', r.pay.length === 1 && r.pay[0].x0 === 1);
}

// ---- [2] one loser, three opponents, three shapes: counted on him, the winners paid at the gate, the same points as Q184 ----
{
  // S6 vs O0 (the start-orphan void consoles O0; the claim waits), V vs O1 (no verdict took it; at the gate: O1 paid, O0's
  //   waiting claim paid), U vs O2 (a contest void; paid at once); then a quiet hour: nothing more
  const run = (shapes, script) => {
    const m0 = match(0x2171, O[0], shapes[0]), m1 = match(0x2172, O[1], shapes[1], m0.recs), m2 = match(0x2173, O[2], shapes[2], m0.recs.concat(m1.recs));
    const all = m0.recs.concat(m1.recs, m2.recs);
    return timeline(stepsOf(m0.steps, m1.steps, m2.steps, [[HOUR, all]]), script, sigOn([L]));
  };
  const rs = run(['S6', 'V', 'U']);
  const twin = run(['Z', 'Z', 'Z']);   // the same three matches, the loser silent (Q184)
  T('[2] all runs ok', allOk(rs, 10) && allOk(twin, 10), rs.map(r => r.code).join(','));
  T('[2] the S6 match: voided at maturity, O0 consoled there, counted on L, O0 waits', /start-orphan 8561_1234_2: started, never settled/.test(rs[2].out) && JSON.stringify(xpIn(rs.slice(0, 3), O[0])) === '[50]'
    && /lone-1v1 8561_1234_2: [0-9a-f]+ won, [0-9a-f]+ wrote only records the job cannot use \(Q216\) -- counted on him \(1 such match\(es\), 1 different opponent\(s\)\), nobody flagged; payment waits/.test(rs[2].out)
    && !ptsIn(rs.slice(0, 3), O[0]).length, outOf(rs.slice(0, 3)).split('\n').filter(l => /lone-1v1|start-orphan|consolation/.test(l)).join(' | '));
  T('[2] the V match: counted (2 opponents), O1 paid, O0\'s waiting claim paid', /lone-1v1 8562_1234_2: .*Q216\) -- counted on him \(2 such match\(es\), 2 different opponent\(s\)\), nobody flagged; winner paid/.test(rs[5].out)
    && ptsIn(rs.slice(3, 6), O[1]).length === 1 && ptsIn(rs.slice(3, 6), O[0]).length === 1, outOf(rs.slice(3, 6)).split('\n').filter(l => /lone-1v1/.test(l)).join(' | '));
  T('[2] the U match: contest void, counted (3 opponents), O2 paid at once', /contest-void 8563_1234_2/.test(rs[8].out) && /lone-1v1 8563_1234_2: .*Q216\) -- counted on him \(3 such match\(es\), 3 different opponent\(s\)\), nobody flagged; winner paid/.test(rs[8].out)
    && ptsIn(rs.slice(6, 9), O[2]).length === 1, outOf(rs.slice(6, 9)).split('\n').filter(l => /lone-1v1|contest-void/.test(l)).join(' | '));
  T('[2] each winner paid the points the silent-loser match (Q184) pays, once', [0, 1, 2].every(i => JSON.stringify(ptsIn(rs, O[i])) === JSON.stringify(ptsIn(twin, O[i])) && ptsIn(rs, O[i]).length === 1),
    JSON.stringify([0, 1, 2].map(i => [ptsIn(rs, O[i]), ptsIn(twin, O[i])])));
  T('[2] XP: one consolation each, never two (O0 consoled at the void, paid without a second one; O1 / O2 with their payment)',
    [0, 1, 2].every(i => JSON.stringify(xpIn(rs, O[i])) === '[50]'), JSON.stringify([0, 1, 2].map(i => xpIn(rs, O[i]))));
  const sl = sigOf(last(rs), L) || {};
  T('[2] L: three matches, three opponents counted, nothing waits; no points, no leave; flagged only for his out-of-bounds duration (V, as before)',
    sl.l1 === 3 && (sl.l1o || []).length === 3 && !sl.l1q && !ptsIn(rs, L).length && leavesOf(last(rs), L) === 0 && fOf(last(rs), L) === 1, JSON.stringify(sl));
  T('[2] the three winners flagged by nobody, convicted by nobody', [0, 1, 2].every(i => fOf(last(rs), O[i]) === 0 && leavesOf(last(rs), O[i]) === 0), JSON.stringify([0, 1, 2].map(i => fOf(last(rs), O[i]))));
  T('[2] the three keys processed; the quiet hour pays nothing more', ['8561', '8562', '8563'].every(k => processedOf(last(rs)).has(k + '_1234_2')) && !LINE.test(last(rs).out) && !ptsIn([last(rs)], O[0]).length);
  T('[2] the run summary: the claims (Q216 row), and the Q184 row counts them', JSON.stringify(row216(rs[2])) === '[1,0]' && JSON.stringify(row216(rs[5])) === '[1,0]' && JSON.stringify(row216(rs[8])) === '[1,0]'
    && /\| ranked 1V1s only the winner wrote \(Q184\)[^|]*\| 1 \/ 0 \/ 2 \//.test(rs[5].summary), JSON.stringify([row216(rs[2]), row216(rs[5]), row216(rs[8])]));
  withMutant('function lone1v1Spoiled(e, key, g, confState, confSeen, strict, pids) {\n', 'function lone1v1Spoiled(e, key, g, confState, confSeen, strict, pids) {\n  return null;\n', '2', (s) => {
    const m = run(['S6', 'V', 'U'], s);
    T('[2] mutant (no Q216, today\'s main): nothing counted, nobody paid, O0 only consoled', allOk(m, 10) && !(sigOf(last(m), L) || {}).l1 && [0, 1, 2].every(i => !ptsIn(m, O[i]).length)
      && JSON.stringify(xpIn(m, O[0])) === '[50]' && !xpIn(m, O[1]).length && !xpIn(m, O[2]).length);
  });
  withMutant('  for (const p of l1Res.pay) if (!p.x0 && startsRes.consoledSids.indexOf(p.sid) < 0) startsRes.consoledSids.push(p.sid);',
    '  for (const p of l1Res.pay) if (startsRes.consoledSids.indexOf(p.sid) < 0) startsRes.consoledSids.push(p.sid);', '2x', (s) => {
      const m = run(['S6', 'V', 'U'], s);
      T('[2] mutant (x0 not honored): O0 consoled twice', allOk(m, 10) && JSON.stringify(xpIn(m, O[0])) === '[50,50]', JSON.stringify(xpIn(m, O[0])));
    });
}

// ---- [3] the other shapes ----
{
  for (const [tag, shape, n] of [['U2', 'U2', 0x2174], ['U3', 'U3', 0x2175], ['S6c', 'S6c', 0x2176]]) {
    const m = match(n, O[3], shape);
    const rs = timeline(m.steps, null, (() => { const f = sigOn([L]); Object.assign(f.SIGNALS_FILE.players[v.pid(L)], { l1: 1, l1o: [v.pid(O[9])] }); return f; })());
    T('[3] ' + tag + ': counted on L at the gate, O3 paid once, L untouched', allOk(rs, 3) && LINE216.test(rs[2].out) && /winner paid/.test(rs[2].out) && ptsIn(rs, O[3]).length === 1
      && JSON.stringify(xpIn(rs, O[3])) === '[50]' && !ptsIn(rs, L).length && leavesOf(last(rs), L) === 0 && sigOf(last(rs), L).l1 === 2 && fOf(last(rs), O[3]) === 0,
      outOf(rs).split('\n').filter(l => /lone-1v1|contest-void|start-orphan/.test(l)).join(' | '));
  }
}

// ---- [4] honest controls and disputes: nothing from Q216 ----
{
  const gate = () => { const f = sigOn([L]); Object.assign(f.SIGNALS_FILE.players[v.pid(L)], { l1: 1, l1o: [v.pid(O[9])] }); return f; };
  const one = (n, shape, opt) => { const m = match(n, O[4], shape, null, opt); return timeline(m.steps, null, gate()); };
  const nothing = (label, rs, extra) => T(label, allOk(rs, 3) && !LINE.test(outOf(rs)) && !ptsIn(rs, O[4]).length && sigOf(last(rs), L).l1 === 1 && (!extra || extra(rs)),
    outOf(rs).split('\n').filter(l => /lone-1v1|start-orphan|contest-void|settled [1-9]/.test(l)).join(' | '));
  // (a) an honest loss: his start and his result on the winner's table -> the usual settle
  const ra = one(0x2181, (h, w) => ({ start: [v1start(h, 1, [w, L])], res: [lost(h, [w, L])] }));
  T('[4a] an honest loss: settled as usual (both rated), nothing from Q216', allOk(ra, 3) && processedOf(last(ra)).has(KEY(0x2181)) && ptsIn(ra, O[4]).length === 1 && ptsIn(ra, L).length === 1 && !LINE.test(outOf(ra)));
  // (b) his clean result claims his win: the dispute stays where it was
  nothing('[4b] his clean result says he won: not settled, nothing from Q216', one(0x2182, (h, w) => ({ res: [rec(0xB1, 2, h, 1, 1, true, [w, L], [4000, 7000])] })));
  // (c) his bad result claims his win
  nothing('[4c] his bad result (his opponent twice) says he won: voided as before, nothing from Q216', one(0x2183, (h, w) => ({ res: [rec(0xB1, 2, h, 1, 1, true, [w, w], [4000, 7000])] })),
    (rs) => /contest-void 8579_1234_2/.test(rs[2].out));
  withMutant('    if (his.some((r) => JSON.stringify(r.d.slice(10, 12)) !== vec)) continue;   // the loser\'s record disputes the result\n', '', '4c', (s) => {
    const m = timeline(match(0x2184, O[4], (h, w) => ({ res: [rec(0xB1, 2, h, 1, 1, true, [w, w], [4000, 7000])] })).steps, s, gate());
    T('[4c] mutant (no dispute check): the dispute pays the winner', allOk(m, 3) && ptsIn(m, O[4]).length === 1);
  });
  // (d) a start alone (a leave): the start-orphan verdict as before
  nothing('[4d] S6b his start names his opponent twice, no result: the winner consoled, he not convicted, as before', one(0x2185, (h, w) => ({ start: [rec(0xB2, 2, h, 1, 0, false, [w, w])] })),
    (rs) => JSON.stringify(xpIn(rs, O[4])) === '[50]' && leavesOf(last(rs), L) === 0);
  nothing('[4e] S6d his start names another account at the winner\'s seat, no result: he convicted, as before', one(0x2186, (h, w) => ({ start: [rec(0xB2, 2, h, 1, 0, false, [C, L])] })),
    (rs) => leavesOf(last(rs), L) === 1);
  // (f) the winner's own result out of bounds, the loser's clean: the winner's record is the bad one (Q109 S1b)
  nothing('[4f] the winner\'s duration out of bounds, the loser\'s record clean: nothing from Q216', one(0x2187, (h, w) => ({ res: [lost(h, [w, L])] }), { res: durBad(v1settle(0x2187, 0, [O[4], L], 0)) }));
  // (g) a third account wrote a result for the key
  nothing('[4g] a third writer\'s result on the key: nothing from Q216', one(0x2188, (h, w) => ({ res: [durBad(lost(h, [w, L]))] }), { more: [{ sid: C, d: durBad(lost(0x2188, [O[4], C])) }] }));
  // (h) a contest void on an incomplete read: the void stands, nothing claimed, never later
  const fail = { STUB_FAIL: JSON.stringify({ shard_49: 500 }) };
  const rh = one(0x2189, 'U', { env: fail });
  const rh2 = timeline([[HOUR, match(0x2189, O[4], 'U').recs]], null, rh[2].state);
  T('[4h] a contest void on an incomplete read: voided, not claimed (row), not later either', allOk(rh, 3) && /contest-void 8585_1234_2/.test(rh[2].out) && /8585_1234_2: voided on an incomplete shard read -- not claimed \(Q216\)/.test(rh[2].out)
    && JSON.stringify(row216(rh[2])) === '[0,1]' && !LINE216.test(outOf(rh2)) && !ptsIn(rh.concat(rh2), O[4]).length && sigOf(last(rh2), L).l1 === 1, rh[2].out.split('\n').filter(l => /Q216|contest-void/.test(l)).join(' | '));
  withMutant("    if (readComplete === false) { RUN.lone1v1VoidHeld = (RUN.lone1v1VoidHeld | 0) + 1; console.log('  lone-1v1 ' + vk.m + ': voided on an incomplete shard read -- not claimed (Q216)'); continue; }\n", '', '4h', (s) => {
    const m = timeline(match(0x218a, O[4], 'U', null, { env: fail }).steps, s, gate());
    T('[4h] mutant (no read check): claimed on the partial read', allOk(m, 3) && LINE216.test(m[2].out));
  });
  // (i) V on an incomplete read: held like Q184, decided on the next full read
  const ri = timeline(stepsOf(match(0x218b, O[4], 'V', null, { env: fail }).steps, [[5 * MIN, match(0x218b, O[4], 'V').recs]]), null, gate());
  T('[4i] V on an incomplete read: held, decided on the next full read', allOk(ri, 4) && /lone-1v1: 1 matured verdict\(s\) held \(incomplete shard read\)/.test(ri[2].out) && !LINE216.test(ri[2].out)
    && LINE216.test(ri[3].out) && ptsIn(ri, O[4]).length === 1);
  // (j) he confessed (his abandon confession for the key): his own word, its own path
  const conf = (h) => { const d = rec(0xB2, 2, h, 1, 0, false, [O[4], L]); d[0] = 0xB5; d[12] = 5; return d; };
  nothing('[4j] he confessed: nothing from Q216', one(0x218c, (h, w) => ({ res: [durBad(lost(h, [w, L]))] }), { more: [{ sid: L, d: conf(0x218c) }] }));
}

// ---- [5] wiring pins ----
{
  T('[5] the contest void and the start-orphan void carry their note', /voided\.push\(\{ m: key, pids: \[\], note: e \}\);/.test(SRC)
    && /voided\.push\(\{ m, pids: Object\.keys\(p\.roster\)\.map\(\(seat\) => p\.roster\[seat\]\), note: pending\['~' \+ m\] \|\| null \}\);/.test(SRC));
  T('[5] main: the voided keys\' claims join the verdicts\' ahead of the count', /lone1v1Verdicts\(startsPending, groups, processed, nowMs, STARTS_MATURITY_MS, confState, confSeen, shardsComplete\)\n    \.concat\(lone1v1VoidClaims\(startsRes\.voided, groups, startsRes\.consoledSids, confState, confSeen, shardsComplete\)\)/.test(SRC));
  T('[5] lone1v1Verdicts: lone1v1Claim, else lone1v1Spoiled (not strict)', /const c = lone1v1Claim\(e, key, groups\[key\], confState, confSeen\) \|\| lone1v1Spoiled\(e, key, groups\[key\], confState, confSeen, false, null\);/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (lone-1v1-spoiled) ===');
process.exit(failN === 0 ? 0 : 1);
