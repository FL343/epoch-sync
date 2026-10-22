'use strict';
// Q208 (cloud audit 2026-10): since Q127 a matchmade key contested once stays held until it voids, and Q143 only counts
//   who did it. A free account copied each key off a public start, wrote one start of its own (a player's seat before the
//   job's first look, or one seat more while the registered roster is provisional), let one run read it and wrote the
//   next key over it: every match it read voided two hours later -- 100 four-player ranked matches in two runs, some
//   1,400 a day at Steam's write pace -- and the account lost nothing. Now, ahead of registration, a key whose records
//   carry exactly one complete table (each seat names an account that wrote a record of the key from that seat and told
//   no other story there), or a provisional key's own complete table, notes each other start writer once in a daily
//   ledger (the starts state, CAP_NOTE); a key whose outside writers all hold CONTEST_CAP other keys there goes on with
//   its complete table, their records left out. An honest player is never an outside writer of his own match unless a
//   complete table that does not seat him exists, and then today's rules give him nothing on that key either.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/contest-parties.js):
//   [0] units: completeTables (a complete table, an outside start, an alt at a player's seat, a cheater's table of his
//       own, two tables, a writer with two stories, a bot seat, a settle record's story), capLedger (a day kept, older
//       or malformed entries dropped), capContests in memory (under / past the cap, counted once per key, both of two
//       outsiders past it or nothing, a provisional key's own table, a final roster, a contested note, a processed key,
//       an incomplete read, endless and friends' room keys, no table, two tables) and the ledger's size bound
//   [1] one account at seat 0 of four 4-player ranked keys in one run: three void as before, the fourth settles and rates
//       its four players, the account's records of it left out (contest-cap line), nobody flagged, nobody an exit; [1c] past
//       the cap, a start that leaves a seat empty: left out, its writer flagged nobody since cloud audit Q292 (the joiner's
//       seat table is the host's; before it Q130 flagged him once)
//   [2] the same account over runs: keys 1-3 void, key 4 settles; a day later his ledger is empty again and a fifth key
//       voids; the ledger slot is no key note (survives every pass, no line names it)
//   [3] past the cap, one seat more while the roster is provisional (the Q118 late split): no split, settles; counted once;
//       [3b] a fresh account copying the provisional roster at a player's seat: no contest, not counted, settles
//   [4] architecture decision 10, against the same tree with the cap never lifting (today's rules): (a) an honest 1V1
//       player past the cap whose opponent's alt wrote his seat (Q118): the same for him (nothing, no exit, no flag); the
//       cheater's own table settles (the residual, O462); (b) a key with a player's start missing and an outside account
//       past the cap at his seat: no complete table, the same for everyone; (c) one honest four-player day with a late
//       start, a missing start, a duplicate start: the same for everyone, the ledger never written; (d) the four-player
//       Q118 (a cheater and three alts write a whole table, the three honest players past the cap): the same for them
//   [5] two complete tables (two outside accounts past the cap writing a whole 1V1 table of their own): voids as before,
//       nothing counted
//   [6] a final roster: an outside start after START_CONFIRM_MS is not counted (the seat gate leaves it out)
//   [7] a writer with two stories completes no table: the key voids although the honest player is past the cap
//   [8] mutants: the call off; two tables taken as one; a writer's last story kept; a start naming the provisional roster
//       counted; a key counted every run (mutate-q208.js in the audit folder runs twenty more against this file)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contest-cap-'));
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
//   instant moves back instead: start sightings and key notes, absent-seat stamps, the writers' busy marks, the flag memory)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;   // a note's result sighting (only its truth is read)
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;   // .at stays: the players keep playing
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  if (sg && sg.t2ld) for (const k of Object.keys(sg.t2ld)) for (const e of sg.t2ld[k]) if (e) e.t -= ms;   // team-gamble strikes (Q51 / Q56)
  if (sg && sg.t2lv) for (const k of Object.keys(sg.t2lv)) if (sg.t2lv[k]) sg.t2lv[k].t -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const flaggedKeys = (r) => Object.keys((r.state.SIGNALS_FILE || {}).flagged || {});
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const xpOf = (rs, sid) => {   // the last XP value posted for sid over a run list (the progress board starts empty)
  let lastXp = 0;
  for (const r of rs) for (const p of posts(r, 5)) if (new RegExp('steamid=' + sid + '(&|$)').test(p.body)) lastXp = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
  return lastXp;
};

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : sc[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const MT = 2;   // ranked FFA (matchmade)
const rankOf = (sc, seat) => 1 + sc.filter((x, i) => x > sc[seat] || (x === sc[seat] && i < seat)).length;
const startF = (h, seat, ros, mt) => rec(0xB2, mt || MT, h, seat, 0, false, ros);
const settleF = (h, seat, ros, sc) => rec(0xB1, MT, h, seat, rankOf(sc, seat), rankOf(sc, seat) === 1, ros, sc);
const SC4 = [6100, 5200, 4800, 3900], SC2 = [6100, 3900], SC2R = [3900, 6100];
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const ALL = [];   // every account the points board knows
const acct = (n) => { const s = SID(n); ALL.push(s); return s; };
const quad = (n) => [acct(n), acct(n + 1), acct(n + 2), acct(n + 3)];
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 300000) + MIN;
// advance, and the ledger's minute stamps with it (they are read against Date.now() like every stored instant)
function advanceCap(state, ms) {
  const files = advance(state, ms), c = (files.STARTS_FILE || {})[v.CAP_NOTE];
  if (c && c.a) for (const h of Object.keys(c.a)) if (Array.isArray(c.a[h])) c.a[h] = c.a[h].map((x) => { const i = String(x).indexOf('.'); return i < 0 ? x : (parseInt(x.slice(0, i), 36) - Math.round(ms / MIN)).toString(36) + x.slice(i); });
  return files;
}
function timeline(steps, script, init) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advanceCap(state, ms) : (init ? JSON.parse(JSON.stringify(init)) : null), env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const cxOf = (r, sid) => sigOf(r, sid).cx | 0;
const short = (sid) => v.pid(sid).slice(0, 8);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const capLines = (out, key) => out.split('\n').filter((l) => new RegExp('contest-cap ' + esc(key) + ':').test(l));
const ROW208 = (r, k, c) => new RegExp("\\| matchmade keys whose outside starts were past their writers' daily cap, left out / outside contests counted \\(Q208\\) \\| " + k + ' / ' + c + ' \\|').test(r.summary);
const ptsOf = (rs, sid) => [].concat(...rs.map((r) => pointsOf(r, sid)));
const rated = (rs, sids) => sids.every((s) => ptsOf(rs, s).length === 1);
const unrated = (rs, sids) => sids.every((s) => ptsOf(rs, s).length === 0);
const noFlags = (r, sids) => sids.every((s) => fOf(r, s) === 0);
const noExits = (r, sids) => sids.every((s) => leavesOf(r, s) === 0);
const capOf = (r) => ((r.state.STARTS_FILE || {})[v.CAP_NOTE]) || null;
const ledOf = (r, sid) => (((capOf(r) || {}).a || {})[v.pid(sid)]) || [];
const outcome = (rs, sids) => JSON.stringify(sids.map((s) => ({ p: ptsOf(rs, s), x: xpOf(rs, s), l: leavesOf(last(rs), s), f: fOf(last(rs), s) })));
const stamp = (ago) => (Math.floor(Date.now() / MIN) - ago).toString(36);
// the starts state with each account already holding n other contested keys of the last hour
function capInit(sids, n) {
  const a = {};
  for (const s of sids) a[v.pid(s)] = Array.from({ length: n }, (_, i) => stamp(30 + i) + '.' + ('f0000' + i).slice(-6));
  return { STARTS_FILE: { [v.CAP_NOTE]: { t0: Date.now(), a } } };
}
const BASE_FROM = 'const CONTEST_CAP = 3;', BASE_TO = 'const CONTEST_CAP = 1e9;';   // today's rules: the cap never lifts
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-contest-cap-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const capture = (fn) => { const l0 = console.log, lines = []; console.log = (...a) => lines.push(a.join(' ')); try { fn(); } finally { console.log = l0; } return lines; };

console.log('=== an outside account may hold up only a few matchmade keys a day (Q208) ===');

// ---- [0] units ----
{
  const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
  const P = [SID(3000), SID(3001), SID(3002), SID(3003)], O = SID(3009), O2 = SID(3007), O3 = SID(3006), A = SID(3008);
  const H0 = SID(3010), H1 = SID(3011), X1 = SID(3012), X2 = SID(3013);
  const h = 0x3000, hon = P.map((s, i) => R(s, startF(h, i, P))), key = keyOf(hon[0].d);
  const OS = () => R(O, startF(h, 0, [O, P[1], P[2], P[3]]));
  const t1 = v.completeTables(hon);
  T('[0] completeTables: four players\' starts make one table of four writers',
    t1.length === 1 && t1[0].pc === 4 && t1[0].sig === v.startSig(hon[0]) && t1[0].writers.size === 4 && P.every((s) => t1[0].writers.has(v.pid(s))));
  const t2 = v.completeTables(hon.concat([OS()]));
  T('[0] an outside start at a player\'s seat: the players\' table only', t2.length === 1 && t2[0].sig === v.startSig(hon[0]) && !t2[0].writers.has(v.pid(O)));
  const alt = [P[0], A, P[2], P[3]];
  T('[0] a player naming an alt at another player\'s seat and the alt (Q118): no complete table',
    v.completeTables([R(P[0], startF(h, 0, alt)), R(A, startF(h, 1, alt)), hon[1], hon[2], hon[3]]).length === 0);
  const t4 = v.completeTables([R(H0, startF(h, 0, [H0, H1])), R(A, startF(h, 0, [A, H1])), R(H1, startF(h, 1, [A, H1]))]);
  T('[0] a 1V1 opponent and his alt writing a table of their own: their table only (the player\'s own is missing his opponent)',
    t4.length === 1 && t4[0].writers.has(v.pid(A)) && t4[0].writers.has(v.pid(H1)) && !t4[0].writers.has(v.pid(H0)));
  T('[0] two outside accounts writing a whole 1V1 table next to the players\' own: two complete tables',
    v.completeTables([R(H0, startF(h, 0, [H0, H1])), R(H1, startF(h, 1, [H0, H1])), R(X1, startF(h, 0, [X1, X2])), R(X2, startF(h, 1, [X1, X2]))]).length === 2);
  T('[0] a writer telling two stories completes no table',
    v.completeTables([R(H0, startF(h, 0, [H0, H1])), R(H1, startF(h, 1, [H0, H1])), R(H1, startF(h, 1, [A, H1])), R(A, startF(h, 0, [A, H1]))]).length === 0);
  T('[0] a settle record from the seat completes the table; one naming another roster is a second story',
    v.completeTables([hon[0], hon[1], hon[2], R(P[3], settleF(h, 3, P, SC4))]).length === 1
    && v.completeTables(hon.concat([R(P[3], settleF(h, 3, [P[0], P[1], P[2], A], SC4))])).length === 0);
  const bot = [P[0], P[1], P[2], '0'];
  T('[0] a seat nobody holds (a bot seat): no complete table', v.completeTables([0, 1, 2].map((i) => R(P[i], startF(h, i, bot)))).length === 0);
  // capLedger
  const st = (ago, k) => stamp(ago) + '.' + k;
  const pend0 = { [v.CAP_NOTE]: { t0: 0, a: { aa: [st(10, 'abcdef'), st(24 * 60 + 1, 'abcde0'), 'junk', st(5, 'XYZ123')], bb: [st(24 * 60 + 5, '123456')], cc: 'x' } } };
  const led0 = v.capLedger(pend0, Date.now());
  T('[0] capLedger: entries of the last day kept, older or malformed ones dropped, an empty list gone',
    JSON.stringify(led0) === JSON.stringify({ aa: [st(10, 'abcdef')] }), JSON.stringify(led0));
  T('[0] capLedger: no slot or a broken one reads as empty',
    JSON.stringify(v.capLedger({}, Date.now())) === '{}' && JSON.stringify(v.capLedger({ [v.CAP_NOTE]: { a: [1] } }, Date.now())) === '{}' && JSON.stringify(v.capLedger({ [v.CAP_NOTE]: 3 }, Date.now())) === '{}');
  // capContests in memory
  const go = (starts, recs, pend, processed, rc) => { let res; const lines = capture(() => { res = v.capContests(starts, recs, pend, processed || new Set(), Date.now(), rc); }); return Object.assign(res, { lines }); };
  const preCap = (pend, sid, n) => { const a = ((pend[v.CAP_NOTE] = pend[v.CAP_NOTE] || { t0: Date.now(), a: {} }).a); a[v.pid(sid)] = Array.from({ length: n }, (_, i) => st(30 + i, ('e0000' + i).slice(-6))); return pend; };
  const ledLen = (pend, sid) => ((((pend[v.CAP_NOTE] || {}).a) || {})[v.pid(sid)] || []).length;
  const ORS = () => R(O, settleF(h, 0, [O, P[1], P[2], P[3]], SC4));
  {
    const pend = {}, s = hon.concat([OS()]), r = [], x = go(s, r, pend);
    T('[0] capContests under the cap: counted once, nothing left out', x.counted === 1 && x.dropped === 0 && x.keys === 0 && s.length === 5 && ledLen(pend, O) === 1 && !x.lines.length, JSON.stringify(x));
  }
  {
    const pend = preCap({}, O, 3), s = hon.concat([OS()]), r = P.map((p, i) => R(p, settleF(h, i, P, SC4))).concat([ORS()]), x = go(s, r, pend);
    T('[0] capContests past the cap: his start and settle left out, the players\' kept, one line, the key in his ledger',
      x.counted === 1 && x.dropped === 2 && x.keys === 1 && s.length === 4 && r.length === 4 && s.concat(r).every((q) => q.steamID !== O) && ledLen(pend, O) === 4
      && x.lines.length === 1 && x.lines[0].indexOf('  contest-cap ' + key + ': 2 record(s) of outside account(s) past 3 contested keys a day') === 0 && new RegExp(': ' + short(O) + '@0s ' + short(O) + '@0$').test(x.lines[0]), JSON.stringify(x));
    const s2 = hon.concat([OS()]), x2 = go(s2, [], pend);
    T('[0] the same key read again: not counted twice, still left out', x2.counted === 0 && x2.dropped === 1 && ledLen(pend, O) === 4, JSON.stringify(x2));
    const s3 = [R(H0, startF(h + 1, 0, [H0, H1])), R(H1, startF(h + 1, 1, [H0, H1])), R(O, startF(h + 1, 0, [O, H1]))], x3 = go(s3, [], pend);
    const k3 = require('crypto').createHash('sha256').update(keyOf(s3[0].d)).digest('hex').slice(0, 6), l3 = pend[v.CAP_NOTE].a[v.pid(O)];
    T('[0] a fifth key: left out, his list kept at CONTEST_CAP + 1 keys, the newest last', x3.counted === 1 && x3.dropped === 1 && l3.length === 4 && l3[3].slice(-6) === k3,
      JSON.stringify([x3, l3]));
  }
  {
    const pend = preCap({}, O, 3), O2S = R(O2, startF(h, 4, P.concat([O2]))), s = hon.concat([OS(), O2S]), x = go(s, [], pend);
    T('[0] two outside writers, one under the cap: nobody left out, both counted', x.counted === 2 && x.dropped === 0 && s.length === 6 && ledLen(pend, O) === 4 && ledLen(pend, O2) === 1, JSON.stringify(x));
  }
  {
    const reg = {}; P.forEach((s, i) => { reg[i] = v.pid(s); });
    const pend = preCap({ [key]: { prov: v.startSig(hon[0]), roster: reg, mt: MT, t0: Date.now() } }, O, 3);
    const O5 = R(O, startF(h, 4, P.concat([O]))), copy = R(O3, startF(h, 0, P)), s = hon.concat([O5, copy]), x = go(s, [], pend);
    T('[0] a provisional key: an outside start naming another roster left out past the cap; a start naming the roster itself is no contest and not counted',
      x.counted === 1 && x.dropped === 1 && s.length === 5 && s.indexOf(copy) >= 0 && ledLen(pend, O3) === 0, JSON.stringify(x));
  }
  {
    const reg = {}; P.forEach((s, i) => { reg[i] = v.pid(s); });
    const a = go(hon.concat([OS()]), [], preCap({ [key]: { roster: reg, mt: MT, t0: Date.now() } }, O, 3));
    const b = go(hon.concat([OS()]), [], preCap({ ['~' + key]: { t0: Date.now(), s: [], r: 0, c: 1 } }, O, 3));
    const c = go(hon.concat([OS()]), [], preCap({}, O, 3), new Set([key]));
    const pd = preCap({}, O, 3), before = JSON.stringify(pd), d = go(hon.concat([OS()]), [], pd, null, false);
    T('[0] nothing counted or left out on a final roster, a contested key, a processed key; an incomplete read leaves the ledger as it was',
      [a, b, c, d].every((x) => x.counted === 0 && x.dropped === 0) && JSON.stringify(pd) === before, JSON.stringify([a, b, c, d]));
  }
  {
    const e7 = P.map((s, i) => R(s, startF(h, i, P, 7))).concat([R(O, startF(h, 0, [O, P[1], P[2], P[3]], 7))]);
    const e10 = P.map((s, i) => R(s, startF(h, i, P, 10))).concat([R(O, startF(h, 0, [O, P[1], P[2], P[3]], 10))]);
    const x7 = go(e7, [], preCap({}, O, 3)), x10 = go(e10, [], preCap({}, O, 3));
    T('[0] endless and friends\' room keys keep their own rules: nothing counted or left out', x7.counted + x7.dropped + x10.counted + x10.dropped === 0 && e7.length === 5 && e10.length === 5);
  }
  {
    const miss = go(hon.slice(0, 3).concat([R(O, startF(h, 3, [P[0], P[1], P[2], O]))]), [], preCap({}, O, 3));
    const two = go([R(H0, startF(h, 0, [H0, H1])), R(H1, startF(h, 1, [H0, H1])), R(X1, startF(h, 0, [X1, X2])), R(X2, startF(h, 1, [X1, X2]))], [], preCap(preCap({}, X1, 3), X2, 3));
    T('[0] no complete table (a player\'s start missing) or two of them: nothing counted or left out', miss.counted + miss.dropped + two.counted + two.dropped === 0, JSON.stringify([miss, two]));
  }
  {
    const a = {};
    for (let i = 0; i < 1000; i++) a[('0000000' + i).slice(-8) + 'aaaaaaaa'] = [st(5, 'a00001')];
    for (let i = 0; i < 30; i++) a[('0000000' + i).slice(-8) + 'bbbbbbbb'] = [st(9, 'b00001'), st(8, 'b00002'), st(7, 'b00003')];
    const pend = { [v.CAP_NOTE]: { t0: 0, a } };
    go([], [], pend);
    const kept = Object.keys(pend[v.CAP_NOTE].a);
    const gone = { [v.CAP_NOTE]: { t0: 0, a: { aa: [st(24 * 60 + 5, 'abcdef')] } } };
    go([], [], gone);
    T('[0] the ledger keeps at most CONTEST_CAP_ACCOUNTS accounts, those with the most keys first; an empty ledger leaves no slot',
      v.CONTEST_CAP_ACCOUNTS === 1024 && kept.length === 1024 && kept.filter((k) => /b{8}$/.test(k)).length === 30 && !(v.CAP_NOTE in gone), kept.length);
  }
}

// ---- e2e scenarios ----
const four = (h, pl) => ({ h, key: keyOf(startF(h, 0, pl)), pl, S: pl.map((s, i) => ({ sid: s, d: startF(h, i, pl) })), R: pl.map((s, i) => ({ sid: s, d: settleF(h, i, pl, SC4) })) });
const cat = (...a) => [].concat(...a);
// [1] one account, four keys in one run
const O1 = acct(2090);
const K1 = [0, 1, 2, 3].map((k) => four(0x2080 + k, quad(2000 + 10 * k)));
const OS1 = K1.map((g) => ({ sid: O1, d: startF(g.h, 0, [O1, g.pl[1], g.pl[2], g.pl[3]]) }));
const S1 = cat(...K1.map((g) => g.S)), R1 = cat(...K1.map((g) => g.R));
const steps1 = [[0, S1.concat(OS1)], [5 * MIN, S1], [5 * MIN, S1.concat(R1)], [GRACE, S1.concat(R1)], [3 * HOUR, S1.concat(R1)]];
// [1c] past the cap, a start that leaves a seat empty at a player's seat (Q130 flagged its writer; Q292: nobody)
const O1c = acct(2095), K1c = four(0x2095, quad(2050)), OS1c = { sid: O1c, d: startF(K1c.h, 0, [O1c, K1c.pl[1], K1c.pl[2], '0']) };
const steps1c = [[0, K1c.S.concat([OS1c])], [5 * MIN, K1c.S], [5 * MIN, K1c.S.concat(K1c.R)], [GRACE, K1c.S.concat(K1c.R)], [3 * HOUR, K1c.S.concat(K1c.R)]];
// [2] the same account over runs, then a day later
const O2 = acct(2190);
const K2 = [0, 1, 2, 3, 4].map((k) => four(0x2180 + k, quad(2100 + 10 * k)));
const OS2 = K2.map((g) => ({ sid: O2, d: startF(g.h, 0, [O2, g.pl[1], g.pl[2], g.pl[3]]) }));
const steps2 = (() => {
  const S = (n) => cat(...K2.slice(0, n).map((g) => g.S)), R = (n) => cat(...K2.slice(0, n).map((g) => g.R));
  return [[0, S(1).concat([OS2[0]])], [5 * MIN, S(2).concat([OS2[1]])], [5 * MIN, S(3).concat([OS2[2]], R(1))], [5 * MIN, S(4).concat([OS2[3]], R(2))],
    [5 * MIN, S(4).concat(R(3))], [GRACE, S(4).concat(R(4))], [3 * HOUR, S(4).concat(R(4))],
    [25 * HOUR, S(5).concat([OS2[4]], R(4))], [5 * MIN, S(5).concat(R(4))], [5 * MIN, S(5).concat(R(5))], [3 * HOUR, S(5).concat(R(5))]];
})();
// [3] past the cap, one seat more while the roster is provisional; [3b] a fresh account copying the roster at a player's seat then
const O3 = acct(2290), K3 = four(0x2280, quad(2200)), OS3 = { sid: O3, d: startF(K3.h, 4, K3.pl.concat([O3])) };
const steps3 = [[0, K3.S], [2 * MIN, K3.S.concat([OS3])], [MIN, K3.S.concat([OS3])], [5 * MIN, K3.S], [5 * MIN, K3.S.concat(K3.R)], [GRACE, K3.S.concat(K3.R)], [3 * HOUR, K3.S.concat(K3.R)]];
const O3b = acct(2291), K3b = four(0x2281, quad(2210)), OS3b = { sid: O3b, d: startF(K3b.h, 0, K3b.pl) };
const steps3b = [[0, K3b.S], [2 * MIN, K3b.S.concat([OS3b])], [6 * MIN, K3b.S.concat(K3b.R)], [GRACE, K3b.S.concat(K3b.R)], [3 * HOUR, K3b.S.concat(K3b.R)]];
// [4a] Q118: the honest 1V1 player past the cap, his opponent's alt at his seat
const H0 = acct(2300), H1 = acct(2301), AL = acct(2302), h4a = 0x2300, real = [H0, H1], fake = [AL, H1];
const S4a = [{ sid: H0, d: startF(h4a, 0, real) }, { sid: AL, d: startF(h4a, 0, fake) }, { sid: H1, d: startF(h4a, 1, fake) }];
const R4a = [{ sid: H0, d: settleF(h4a, 0, real, SC2) }, { sid: AL, d: settleF(h4a, 0, fake, SC2R) }, { sid: H1, d: settleF(h4a, 1, fake, SC2R) }];
const steps4a = [[0, S4a], [5 * MIN, S4a.concat(R4a)], [GRACE, S4a.concat(R4a)], [3 * HOUR, S4a.concat(R4a)]];
// [4d] the four-player Q118: a cheater and three alts write a whole table, the three honest players (all past the cap) outside it
const C4 = acct(2350), AL4 = [acct(2351), acct(2352), acct(2353)], HH = [acct(2354), acct(2355), acct(2356)], h4d = 0x2350;
const real4 = HH.concat([C4]), fake4 = AL4.concat([C4]);
const S4d = HH.map((s, i) => ({ sid: s, d: startF(h4d, i, real4) })).concat(AL4.map((s, i) => ({ sid: s, d: startF(h4d, i, fake4) })), [{ sid: C4, d: startF(h4d, 3, fake4) }]);
const R4d = HH.map((s, i) => ({ sid: s, d: settleF(h4d, i, real4, SC4) })).concat(AL4.map((s, i) => ({ sid: s, d: settleF(h4d, i, fake4, [3900, 4800, 5200, 6100]) })), [{ sid: C4, d: settleF(h4d, 3, fake4, [3900, 4800, 5200, 6100]) }]);
const steps4d = [[0, S4d], [5 * MIN, S4d.concat(R4d)], [GRACE, S4d.concat(R4d)], [3 * HOUR, S4d.concat(R4d)]];
// [4b] a player's start missing, an outside account past the cap at his seat
const O4 = acct(2490), K4 = four(0x2480, quad(2400)), OS4 = { sid: O4, d: startF(K4.h, 3, [K4.pl[0], K4.pl[1], K4.pl[2], O4]) };
const steps4b = [[0, K4.S.slice(0, 3).concat([OS4])], [5 * MIN, K4.S.slice(0, 3)], [5 * MIN, K4.S.slice(0, 3).concat(K4.R)], [GRACE, K4.S.slice(0, 3).concat(K4.R)], [3 * HOUR, K4.S.slice(0, 3).concat(K4.R)]];
// [4c] one honest four-player day: five matches, a late start (key 1), a missing start (key 2), a duplicate start (key 3)
const Q5 = quad(2500), K5 = [0, 1, 2, 3, 4].map((k) => four(0x2580 + k, Q5));
const steps4c = (() => {
  const at = [];   // [minute written, record]
  K5.forEach((g, j) => {
    g.S.forEach((r, i) => { if (j === 2 && i === 3) return; at.push([15 * j + (j === 1 && i === 2 ? 2 : 0), r]); });
    if (j === 3) at.push([15 * j, g.S[1]]);
    g.R.forEach((r) => at.push([15 * j + 12, r]));
  });
  const ts = [0, 2, 15, 17, 30, 32, 45, 47, 60, 62, 75, 75 + GRACE / MIN, 75 + GRACE / MIN + 180];
  return ts.map((t, i) => [i ? (t - ts[i - 1]) * MIN : 0, at.filter((x) => x[0] <= t).map((x) => x[1])]);
})();
// [5] two complete tables: the players' and two outside accounts' (both past the cap)
const W5 = acct(2600), L5 = acct(2601), X1 = acct(2602), X2 = acct(2603), h5 = 0x2600;
const S5 = [{ sid: W5, d: startF(h5, 0, [W5, L5]) }, { sid: L5, d: startF(h5, 1, [W5, L5]) }], F5 = [{ sid: X1, d: startF(h5, 0, [X1, X2]) }, { sid: X2, d: startF(h5, 1, [X1, X2]) }];
const R5 = [{ sid: W5, d: settleF(h5, 0, [W5, L5], SC2) }, { sid: L5, d: settleF(h5, 1, [W5, L5], SC2) }];
const steps5 = [[0, S5.concat(F5)], [5 * MIN, S5], [5 * MIN, S5.concat(R5)], [GRACE, S5.concat(R5)], [3 * HOUR, S5.concat(R5)]];
// [6] a final roster: an outside start read after START_CONFIRM_MS
const O6 = acct(2790), K6 = four(0x2780, quad(2700)), OS6 = { sid: O6, d: startF(K6.h, 0, [O6, K6.pl[1], K6.pl[2], K6.pl[3]]) };
const steps6 = [[0, K6.S], [5 * MIN, K6.S], [5 * MIN, K6.S.concat([OS6])], [5 * MIN, K6.S.concat([OS6], K6.R)], [GRACE, K6.S.concat(K6.R)], [3 * HOUR, K6.S.concat(K6.R)]];
// [7] the opponent writes his own seat twice (two rosters), his alt the player's seat; the player is past the cap
const G0 = acct(2800), G1 = acct(2801), GA = acct(2802), h7 = 0x2800, real7 = [G0, G1], fake7 = [GA, G1];
const S7 = [{ sid: G0, d: startF(h7, 0, real7) }, { sid: GA, d: startF(h7, 0, fake7) }, { sid: G1, d: startF(h7, 1, real7) }, { sid: G1, d: startF(h7, 1, fake7) }];
const R7 = [{ sid: G0, d: settleF(h7, 0, real7, SC2) }, { sid: GA, d: settleF(h7, 0, fake7, SC2R) }, { sid: G1, d: settleF(h7, 1, fake7, SC2R) }];
const steps7 = [[0, S7], [5 * MIN, S7.concat(R7)], [GRACE, S7.concat(R7)], [3 * HOUR, S7.concat(R7)]];

const noKeyNote = (rs) => !/[^\n]*#contest-cap/.test(outOf(rs).replace(/\(Q208\)/g, ''));
{
  const rs = timeline(steps1), n = steps1.length, out = outOf(rs), sorted = K1.map((g) => g.key).sort(), lifted = K1.find((g) => g.key === sorted[3]);
  T('[1] runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T('[1] the first three keys he read void as before, the fourth settles and rates its four players',
    rated(rs, lifted.pl) && K1.filter((g) => g !== lifted).every((g) => unrated(rs, g.pl)) && K1.every((g) => processedOf(last(rs)).has(g.key)), JSON.stringify(K1.map((g) => ptsOf(rs, g.pl[0]))));
  T('[1] one contest-cap line, for that key, naming his start',
    capLines(out, lifted.key).length === 1 && capLines(rs[0].out, lifted.key)[0].indexOf(short(O1) + '@0s') > 0 && K1.every((g) => g === lifted || !capLines(out, g.key).length), JSON.stringify(capLines(out, lifted.key)));
  T('[1] nobody flagged, nobody an exit; he counted contested three times (Q143 cx 3), his ledger four keys',
    noFlags(last(rs), cat(...K1.map((g) => g.pl), [O1])) && noExits(last(rs), cat(...K1.map((g) => g.pl), [O1])) && cxOf(last(rs), O1) === 3 && ledOf(last(rs), O1).length === 4,
    JSON.stringify([cxOf(last(rs), O1), ledOf(last(rs), O1)]));
  T('[1] the summary row counts 1 key left out / 4 contests in that run, 0 / 0 after', ROW208(rs[0], 1, 4) && rs.slice(1).every((r) => ROW208(r, 0, 0)));
}
{
  const rs = timeline(steps1c, null, capInit([O1c], 3));
  T('[1c] past the cap, a start leaving a seat empty at a player\'s seat: left out, the key settles, its writer not flagged (Q292; Q130 flagged him once), the players not',
    allOk(rs, steps1c.length) && rated(rs, K1c.pl) && capLines(outOf(rs), K1c.key).length === 1 && fOf(last(rs), O1c) === 0
    && flaggedKeys(last(rs)).indexOf(K1c.key + '|blank|' + v.pid(O1c)) < 0 && noFlags(last(rs), K1c.pl) && noExits(last(rs), K1c.pl)
    && /start-blank [^\n]* wrote a start that leaves a seat empty -- it does not vote, nobody flagged/.test(outOf(rs)), outOf(rs).slice(-900));
}
{
  const rs = timeline(steps2), n = steps2.length, out = outOf(rs);
  T('[2] runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T('[2] over runs: keys 1-3 void, key 4 settles (left out in the run that read it)',
    K2.slice(0, 3).every((g) => unrated(rs, g.pl)) && rated(rs, K2[3].pl) && capLines(rs[3].out, K2[3].key).length === 1 && capLines(out, K2[3].key).length === 1,
    JSON.stringify(K2.map((g) => ptsOf(rs, g.pl[0]))));
  T('[2] the ledger lives through the maturity pass (four keys) and no line takes it for a key',
    ledOf(rs[6], O2).length === 4 && noKeyNote(rs), JSON.stringify(ledOf(rs[6], O2)));
  T('[2] a day later his ledger is down to the new key, which voids as before',
    ledOf(rs[7], O2).length === 1 && unrated(rs, K2[4].pl) && processedOf(last(rs)).has(K2[4].key) && !capLines(out, K2[4].key).length, JSON.stringify(ledOf(rs[7], O2)));
  T('[2] nobody flagged, nobody an exit', noFlags(last(rs), cat(...K2.map((g) => g.pl), [O2])) && noExits(last(rs), cat(...K2.map((g) => g.pl), [O2])));
}
{
  const rs = timeline(steps3, null, capInit([O3], 3)), n = steps3.length, out = outOf(rs);
  T('[3] runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T('[3] past the cap, one seat more while provisional: no split, settles, his start left out in both runs that read it',
    !/start-split /.test(out) && rated(rs, K3.pl) && capLines(rs[1].out, K3.key).length === 1 && capLines(rs[2].out, K3.key).length === 1, out.slice(-1200));
  T('[3] counted once (1 / 1, then 1 / 0), his ledger four keys, nobody flagged', ROW208(rs[1], 1, 1) && ROW208(rs[2], 1, 0) && ledOf(last(rs), O3).length === 4
    && noFlags(last(rs), K3.pl.concat([O3])) && noExits(last(rs), K3.pl), JSON.stringify(ledOf(last(rs), O3)));
  const rb = timeline(steps3b);
  T('[3b] a fresh account copying the roster at a player\'s seat while provisional: no contest, not counted, settles',
    allOk(rb, steps3b.length) && rated(rb, K3b.pl) && rb.every((r) => !capOf(r)) && !/start-split /.test(outOf(rb)), outOf(rb).slice(-900));
}
{
  const init = capInit([H0], 3), rs = timeline(steps4a, null, init), base = mutant('base4a', BASE_FROM, BASE_TO);
  const bs = base ? timeline(steps4a, base, init) : [];
  if (base) try { fs.unlinkSync(base); } catch (e) {}
  T('[4a] runs exit 0 (this tree and today\'s rules)', allOk(rs, steps4a.length) && allOk(bs, steps4a.length), last(rs).out.slice(-800));
  T('[4a] the honest player past the cap whose opponent\'s alt wrote his seat: the same as today -- nothing, no exit, no flag',
    outcome(rs, [H0]) === outcome(bs, [H0]) && unrated(rs, [H0]) && noExits(last(rs), [H0]) && noFlags(last(rs), [H0]), outcome(rs, [H0]) + ' vs ' + outcome(bs, [H0]));
  T('[4a] the residual (roadmap O462): the cheater\'s own table settles here, voids under today\'s rules; his records named in the contest-cap line',
    rated(rs, [H1, AL]) && unrated(bs, [H1, AL]) && capLines(outOf(rs), keyOf(S4a[0].d)).length >= 1 && capLines(outOf(rs), keyOf(S4a[0].d))[0].indexOf(short(H0)) > 0,
    JSON.stringify([ptsOf(rs, H1), ptsOf(rs, AL), ptsOf(bs, H1), ptsOf(bs, AL), capLines(outOf(rs), keyOf(S4a[0].d))]));
}
{
  const init = capInit(HH, 3), rs = timeline(steps4d, null, init), base = mutant('base4d', BASE_FROM, BASE_TO);
  const bs = base ? timeline(steps4d, base, init) : [];
  if (base) try { fs.unlinkSync(base); } catch (e) {}
  T('[4d] the four-player Q118 (three honest players past the cap outside the cheater\'s whole table): the same for them as today -- nothing, no exit, no flag',
    allOk(rs, steps4d.length) && allOk(bs, steps4d.length) && outcome(rs, HH) === outcome(bs, HH) && unrated(rs, HH) && noExits(last(rs), HH) && noFlags(last(rs), HH),
    outcome(rs, HH) + ' vs ' + outcome(bs, HH));
  T('[4d] the residual: the cheater\'s table settles here, voids under today\'s rules', rated(rs, fake4) && unrated(bs, fake4), JSON.stringify([ptsOf(rs, C4), ptsOf(bs, C4)]));
}
{
  const init = capInit([O4], 3), rs = timeline(steps4b, null, init), base = mutant('base4b', BASE_FROM, BASE_TO);
  const bs = base ? timeline(steps4b, base, init) : [];
  if (base) try { fs.unlinkSync(base); } catch (e) {}
  const who = K4.pl.concat([O4]);
  T('[4b] a player\'s start missing, an outside account past the cap at his seat: no complete table, the same for everyone as today, nothing counted',
    allOk(rs, steps4b.length) && allOk(bs, steps4b.length) && outcome(rs, who) === outcome(bs, who) && !capLines(outOf(rs), K4.key).length && ledOf(last(rs), O4).length === 3,
    outcome(rs, who) + ' vs ' + outcome(bs, who));
}
{
  const rs = timeline(steps4c), base = mutant('base4c', BASE_FROM, BASE_TO);
  const bs = base ? timeline(steps4c, base) : [];
  if (base) try { fs.unlinkSync(base); } catch (e) {}
  T('[4c] one honest four-player day (a late, a missing, a duplicate start): the same for everyone as today, the ledger never written',
    allOk(rs, steps4c.length) && allOk(bs, steps4c.length) && outcome(rs, Q5) === outcome(bs, Q5) && rs.every((r) => !capOf(r)) && !/contest-cap /.test(outOf(rs))
    && ptsOf(rs, Q5[0]).length >= 4, outcome(rs, Q5) + ' vs ' + outcome(bs, Q5));
}
{
  const rs = timeline(steps5, null, capInit([X1, X2], 3)), out = outOf(rs);
  T('[5] two complete tables (two outside accounts past the cap): voids as before, nothing counted, nobody flagged',
    allOk(rs, steps5.length) && unrated(rs, [W5, L5, X1, X2]) && processedOf(last(rs)).has(keyOf(S5[0].d)) && !capLines(out, keyOf(S5[0].d)).length
    && ledOf(last(rs), X1).length === 3 && ledOf(last(rs), X2).length === 3 && noFlags(last(rs), [W5, L5]) && noExits(last(rs), [W5, L5]), out.slice(-900));
}
{
  const rs = timeline(steps6);
  T('[6] a final roster: an outside start after START_CONFIRM_MS is not counted (the seat gate leaves it out), the key settles',
    allOk(rs, steps6.length) && rated(rs, K6.pl) && rs.every((r) => !capOf(r)) && !/contest-cap /.test(outOf(rs)), outOf(rs).slice(-900));
}
{
  const rs = timeline(steps7, null, capInit([G0], 3));
  T('[7] a writer with two stories completes no table: voids although the honest player is past the cap, nobody counted',
    allOk(rs, steps7.length) && unrated(rs, [G0, G1, GA]) && !/contest-cap /.test(outOf(rs)) && ledOf(last(rs), G0).length === 3 && noExits(last(rs), [G0]) && noFlags(last(rs), [G0]), outOf(rs).slice(-900));
}

// ---- [8] mutants ----
withMutant('call', '  capContests(starts, recs, startsPending, processed, Date.now(), shardsComplete);   // Q208: an outside account past its daily cap contests nothing\n', '', (script) => {
  const m = timeline(steps1, script);
  T('[8] mutant: the call off -> [1] all four keys void', allOk(m, steps1.length) && K1.every((g) => unrated(m, g.pl)));
});
withMutant('two', '(tabs.length === 1 ? tabs[0] : null)', '(tabs[0] || null)', (script) => {
  const m = timeline(steps5, script, capInit([X1, X2], 3));
  T('[8] mutant: two tables taken as one -> [5] one of them settles', allOk(m, steps5.length) && !unrated(m, [W5, L5, X1, X2]));
});
withMutant('story', "story[w] = story[w] == null || story[w] === st ? st : 'x';", 'story[w] = st;', (script) => {
  const m = timeline(steps7, script, capInit([G0], 3));
  T('[8] mutant: a writer\'s last story kept -> [7] the alt\'s table settles', allOk(m, steps7.length) && rated(m, [G1, GA]));
});
withMutant('prov', '(p && (startSig(r) === p.prov || blankSeatStart(r)))', 'false', (script) => {
  const m = timeline(steps3b, script);
  T('[8] mutant: a start naming the provisional roster counted -> [3b] a ledger entry for the copier', allOk(m, steps3b.length) && m.some((r) => ledOf(r, O3b).length > 0));
});
withMutant('dedup', "if (!list.some((x) => x.slice(-6) === k)) { list.push(nowMin.toString(36) + '.' + k); res.counted++; }", "{ list.push(nowMin.toString(36) + '.' + k); res.counted++; }", (script) => {
  const m = timeline(steps3, script, capInit([O3], 3));
  T('[8] mutant: a key counted every run -> [3] 1 / 1 in both runs', allOk(m, steps3.length) && ROW208(m[2], 1, 1));
});

console.log(failN ? '=== FAIL -- ' + failN + ' fail (contest-cap) ===' : '=== PASS -- 0 fail (contest-cap) ===');
process.exit(failN ? 1 : 0);
