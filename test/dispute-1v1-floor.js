'use strict';
// cloud audit Q308: a quick / ranked 1V1 whose two writers disagree (Q289 / Q291: two voices, nobody flagged) is voided at the
//   start verdict, and each writer got the flat CONSOLATION_XP (50). The honest winner lost the win's XP (quick 450 -> 50;
//   ranked 525 -> 50 and his points), the modded loser lost nothing he would have kept. Until a signed result decides such a
//   match (O226 / roadmap 5.8, the user's call), each consoled writer of it is paid the XP of a 1V1's loser instead
//   (validate.js disputeFloorOf / disputeFloorAdmit / disputeFloorXp): the second place of the settle formula, the money the
//   lowest score any record of the two gives his seat, his own records' class, the leaver factor and the level boost as the
//   settle path applies them, never below 50; at most DISPUTE_FLOOR.DAY_CAP (3) a UTC day per account. No win or loss, no
//   points, no rating, no streak, no daily first.
// Over the REAL validate.js main() against an offline board stub (the harness of test/header-consolation.js):
//   [1] units: which keys are a disputed 1V1 (two seats, two accounts, both wrote, the vectors differ, matchmade), the money
//       (the lowest), the class (his own), the ranked tier (base 2 only), the day cap, the XP (225 / 265 / 145, 281 / 331 / 181,
//       the 50, the level boost, the leaver factor)
//   [2] quick, ranked and quick on the demo job: the honest match settles as before; the disputed one pays each the loser's
//       XP once, nothing else moves; the loser gets no more than losing honestly pays; mutant (the rule before) -> 50 each
//   [3] a modded loser's worst: zeroing the winner's score (145, never below 50), a claim of 9000 for himself (225; mutant:
//       money from his own record -> 265), his own record an abandoner's (50); not a dispute: one writer (50), a brawl of
//       three (50; mutant: any table -> paid the floor)
//   [4] the day cap: three a day, the fourth the 50, logged; mutant (no cap) -> the floor again
//   [5] the leaver factor (68 on the full game) and the demo's record-only window (225); the level boost (+5% at level 5)
//   [6] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'DISPUTE_FLOOR_DAY_CAP', 'CONSOLATION_XP'];
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispute-1v1-floor-'));
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

const H = SID(2910), J = SID(2911), P = SID(2912), X = SID(2913), Y = SID(2914), Z = SID(2915);
const ALL = [H, J, P, X, Y, Z];
const XP_SEED = {};   // sid -> his XP board value before the runs
function boardsWith(recs, pt) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: Object.keys(XP_SEED).map((s) => ({ steamID: s, score: XP_SEED[s] })) }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] });
  // the demo / playtest jobs refuse to run while a rating or points board exists on their app (lock layer 3)
  if (!pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state before the first run; scripts: one per run (or one)
function timeline(steps, script, files0) {
  const out = []; let state = null;
  steps.forEach(([ms, recs, env], i) => {
    if (out.length && out[out.length - 1].code !== 0) return;
    const sc = Array.isArray(script) ? script[i] : script;
    const r = runCron(boardsWith(recs, !!(env && env.PT_MODE)), state ? advance(state, ms) : (files0 || null), env || null, sc);
    out.push(r); state = r.state;
  });
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');

const leavesOf = (r, sid) => ((((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves) | 0;
const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d), dispCode: 0, shard: 's' });
const two = [H, J], three = [H, J, X];


// mutants: validate.js with one part of the fix put back
const CAPTURE = '    const fl = consoledSids.length > c0 ? disputeFloorOf(p, groups[m]) : null;\n';
const BEFORE = {
  off: [CAPTURE, '    const fl = null;\n'],   // the rule before Q308: the flat 50
  ownMoney: ['    for (const r of both) { const x = ', '    for (const r of recs) { const x = '],   // each player's money from his own records
  noCap: ['    if ((p.fqn | 0) >= DISPUTE_FLOOR.DAY_CAP) { res.capped.push(s); continue; }\n', ''],   // no day cap
  anyTable: ['  if (seats.length !== 2) return null;\n', ''],   // any table (a brawl of three)
};
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return null; }
    src = src.replace(from, to);
  }
  const script = path.join(__dirname, '..', '.mutant-dispute-1v1-floor-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

let hn = 0;
// one match: ws = [[sid, seat, table, pc, writesStart, writesResult, scores, disp?]] -- each result claims its own scores
//   (rank by score); opt.env = the job's env (PT_MODE + DEMO_APPID: the demo job); opt.files0 = the state before the first run;
//   opt.extra: more result records. Runs: the starts; ten minutes later the results; ten more; two hours on (the void).
function play(mt, ws, opt, script) {
  opt = opt || {};
  const hsh = 0x3080 + (++hn);
  const st = ws.filter(w => w[4]).map(([sid, seat, ros, pc]) => ({ sid, d: rec(0xB2, mt, hsh, seat, 0, false, ros, null, pc) }));
  const re = ws.filter(w => w[5] !== false).map(([sid, seat, ros, pc, , , own, disp]) => {
    const sc = own.slice(0, pc), top = Math.max(...sc);
    const rank = 1 + sc.filter((x) => x > sc[seat]).length;
    const d = rec(0xB1, mt, hsh, seat, rank, sc[seat] === top, ros, sc, pc);
    if (disp != null) d[10 + pc] = disp;
    return { sid, d };
  });
  const all = st.concat(re).concat(opt.extra || []);
  const env = opt.env || null;
  const steps = [[0, st, env], [10 * MIN, all, env], [10 * MIN, all, env], [2 * HOUR, all, env]];
  const rs = timeline(steps, script, opt.files0 || null);
  return { rs, key: hsh + '_1234_' + mt };
}
function sum(p, sids) {
  const rs = p.rs, r = last(rs), o = { ok: allOk(rs, 4) };
  for (const s of sids) o[s] = { f: fOf(r, s), xp: of2(rs, 5, s), other: of2(rs, 6, s).length + of2(rs, 7, s).length + of2(rs, 8, s).length, lv: leavesOf(r, s), pd: pdOf(r, s) };
  o.processed = processedOf(r).has(p.key);
  return o;
}
const of2 = (rs, board, sid) => [].concat(...rs.map(r => of(r, board, sid)));
const XPs = (o, sids) => sids.map((s) => o[s].xp);
const quiet = (o, sids) => sids.every((s) => o[s].f === 0 && o[s].lv === 0 && o[s].other === 0);   // no flag, no leave, no rating / points / CP
const rowQ308 = (r) => { const m = /\| voided disputed 1V1s: writers paid the loser's XP instead of the flat [0-9]+ \(Q308\)[^|]*\| ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary); return m ? [+m[1], +m[2]] : null; };
const demoEnv = { PT_MODE: '1', DEMO_APPID: '1' };   // APPID '1' = DEMO_APPID: the demo channel (KEY_CHANNEL demo)
const isoIn = (ms) => new Date(Date.now() + ms).toISOString().replace(/\.[0-9]+Z$/, 'Z');
const HON = [7000, 4000], MOD = [4000, 9000];   // H won 7000 to 4000; J (seat 1) claims 9000 to 4000
const honestWs = (mt) => [[H, 0, two, 2, true, true, HON], [J, 1, two, 2, true, true, HON]];
const disputeWs = (jScores, jDisp) => [[H, 0, two, 2, true, true, HON], [J, 1, two, 2, true, true, jScores || MOD, jDisp]];

// ---- [1] units ----
{
  const DF = v.DISPUTE_FLOOR;
  T('[1] exported: DISPUTE_FLOOR (DAY_CAP 3), disputeFloorOf / disputeFloorAdmit / disputeFloorXp', !!DF && DF.DAY_CAP === 3 && ['disputeFloorOf', 'disputeFloorAdmit', 'disputeFloorXp'].every((k) => typeof v[k] === 'function'));
  if (DF) {
    const P = (mt, ros) => ({ mt, roster: Object.fromEntries(ros.map((s, i) => [i, s == null ? '0' : v.pid(s)])) });
    const res = (sid, mt, seat, ros, sc, disp) => { const d = rec(0xB1, mt, 0x3001, seat, 1, false, ros, sc, ros.length); if (disp != null) d[10 + ros.length] = disp; return Object.assign(R(sid, d), { dispCode: disp | 0 }); };
    const fo = (p, g) => { const x = v.disputeFloorOf(p, g); return x ? Object.fromEntries([...x].map(([s, f]) => [s === H ? 'H' : s === J ? 'J' : s, [f.cls, f.money, f.ranked]])) : null; };
    const g1 = (mt, jsc, jd) => [res(H, mt, 0, two, HON), res(J, mt, 1, two, jsc || MOD, jd)];
    eq('[1] floor: quick dispute -> each the lowest score any record gives his seat (H 4000 from J\'s, J 4000 from H\'s)', fo(P(1, two), g1(1)), { H: ['valid', 4000, false], J: ['valid', 4000, false] });
    eq('[1] floor: ranked (2) -> the ranked tier; a trio bit on it the same', [fo(P(2, two), g1(2)), fo(P(0x102, two), g1(0x102))], [{ H: ['valid', 4000, true], J: ['valid', 4000, true] }, { H: ['valid', 4000, true], J: ['valid', 4000, true] }]);
    eq('[1] floor: a team code on a two-seat table (the host\'s broadcast, Q292) -> the quick tier, even a ranked team code (4)', [fo(P(3, two), g1(3)), fo(P(4, two), g1(4))], [{ H: ['valid', 4000, false], J: ['valid', 4000, false] }, { H: ['valid', 4000, false], J: ['valid', 4000, false] }]);
    eq('[1] floor: J zeroes H\'s score -> H money 0 (the money-less tier), never J\'s own 9000 for J', fo(P(1, two), g1(1, [0, 9000])), { H: ['valid', 0, false], J: ['valid', 4000, false] });
    eq('[1] floor: the class is the player\'s own records\' (J\'s own abandoner record makes only J one)', fo(P(1, two), g1(1, MOD, 5)), { H: ['valid', 4000, false], J: ['abandoner', 4000, false] });
    const z = res(Z, 1, 0, [Z, J], [0, 0]);
    eq('[1] floor: a record of an account outside the roster counts for nothing', fo(P(1, two), g1(1).concat([z])), { H: ['valid', 4000, false], J: ['valid', 4000, false] });
    eq('[1] not a disputed 1V1: the same vector / one writer / three seats / an empty seat / one account twice / no record',
      [fo(P(1, two), [res(H, 1, 0, two, HON), res(J, 1, 1, two, HON)]), fo(P(1, two), [res(H, 1, 0, two, HON)]), fo(P(1, three), g1(1)),
        fo(P(1, [H, null]), g1(1)), fo({ mt: 1, roster: { 0: v.pid(H), 1: v.pid(H) } }, g1(1)), fo(P(1, two), [])], [null, null, null, null, null, null]);
    eq('[1] not matchmade: a friends\' room (10), an endless run (7), a bot match (11)', [10, 7, 11].map((mt) => fo(P(mt, two), g1(mt))), [null, null, null]);
    // admission: DAY_CAP a UTC day per account
    const sg = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {} }, t = Date.UTC(2026, 9, 21, 12);
    const fl = { m: 'k', cls: 'valid', money: 4000, ranked: false };
    const runs = [0, 1, 2, 3].map((i) => { const a = v.disputeFloorAdmit({ [H]: fl, [J]: fl }, sg, t + i * 60000); return [a.admitted.size, a.capped.length, a.dirty]; });
    const next = v.disputeFloorAdmit({ [H]: fl }, sg, t + 86400000);
    const ph = sg.players[v.pid(H)];
    eq('[1] admit: 3 a day per account, then capped; the next UTC day counts again', [runs, next.admitted.size, ph.fq, ph.fqn], [[[2, 0, true], [2, 0, true], [2, 0, true], [0, 2, true]], 1, Math.floor((t + 86400000) / 86400000), 1]);
    eq('[1] admit: nothing to pay -> nothing touched', [v.disputeFloorAdmit({}, { players: {} }, t).dirty, v.disputeFloorAdmit(undefined, { players: {} }, t).admitted.size], [false, 0]);
    // the XP: the 1V1 loser's
    const xpOf = (cls, money, ranked, board, leaves, games) => v.disputeFloorXp({ cls, money, ranked }, board || 0, leaves || 0, games || 0);
    eq('[1] XP: quick 145 + money / 50 (cap 120): 4000 -> 225, 9000 -> 265, 0 -> 145; ranked x1.25: 281 / 331 / 181',
      [xpOf('valid', 4000, false), xpOf('valid', 9000, false), xpOf('valid', 0, false), xpOf('valid', 4000, true), xpOf('valid', 9000, true), xpOf('valid', 0, true)], [225, 265, 145, 281, 331, 181]);
    eq('[1] XP: an abandoner\'s own record 0 -> the 50; an innocent one the base (100 / 125)', [xpOf('abandoner', 4000, false), xpOf('innocent', 4000, false), xpOf('innocent', 4000, true)], [50, 100, 125]);
    const lv5 = v.xpBoostMult(v.xpLevelOf(1500), false, 0);
    eq('[1] XP: the level boost of the board value (1500 = level 5, +5%), never the supporter or a streak', [lv5, xpOf('valid', 4000, false, 1500)], [1.05, Math.round(225 * 1.05)]);
    eq('[1] XP: the leaver factor (30 leaves, 0 games: x0.3) -- 225 -> 68; the money-less tier under it -> the 50', [xpOf('valid', 4000, false, 0, 30, 0), xpOf('valid', 0, false, 0, 30, 0)], [68, 50]);
  }
}

// ---- [2] the real main(): a 1V1 the loser disputes, quick / ranked / quick on the demo job ----
for (const [name, mt, env, want, honest] of [['quick (1)', 1, null, 225, [450, 225]], ['ranked (2)', 2, null, 281, [525, 281]], ['quick on the demo job', 1, demoEnv, 225, [450, 225]]]) {
  const tag = '[2] ' + name;
  const hon = sum(play(mt, honestWs(mt), { env }), [H, J]);
  eq(tag + ': the honest match settles as before (H the winner\'s, J the loser\'s)', [hon.ok, XPs(hon, [H, J]).map((x) => x[0])], [true, honest]);
  const p = play(mt, disputeWs(), { env });
  const now = sum(p, [H, J]);
  T(tag + ': J claims the win -> voided as before, each paid the 1V1 loser\'s XP ' + want + ' once, nothing else moves (no flag, no leave, no rating / points / CP)',
    now.ok && now.processed && JSON.stringify(XPs(now, [H, J])) === JSON.stringify([[want], [want]]) && quiet(now, [H, J]) && now[H].pd === 1 && now[J].pd === 1, JSON.stringify(now));
  T(tag + ': J gets no more than losing honestly pays him (' + honest[1] + ')', now.ok && now[J].xp[0] <= honest[1], JSON.stringify(now[J]));
  eq(tag + ': the summary row (paid the floor / capped) and the log', [rowQ308(last(p.rs)), /consolation xp [^\n]*\+[0-9]+ -> [0-9]+ \(Q308: a disputed (quick|ranked) 1V1, the loser's XP, money 4000\)/.test(last(p.rs).out)], [[2, 0], true]);
  withMutant(['off'], tag, (sc) => {
    const old = sum(play(mt, disputeWs(), { env }, sc), [H, J]);
    eq(tag + ' before Q308: the flat 50 each', [old.ok, old.processed, XPs(old, [H, J])], [true, true, [[50], [50]]]);
  });
}

// ---- [3] what a modded loser can do with it ----
{
  const z = sum(play(1, disputeWs([0, 9000])), [H, J]);
  eq('[3] J zeroes H\'s score and claims 9000: H the money-less tier 145 (never below 50), J 225 (H\'s record gives him 4000)', [z.ok, XPs(z, [H, J])], [true, [[145], [225]]]);
  withMutant(['ownMoney'], '[3]', (sc) => {
    const m = sum(play(1, disputeWs([0, 9000]), null, sc), [H, J]);
    eq('[3] mutant (each paid from his own record): J 265, more than his honest loss', [m.ok, XPs(m, [H, J])], [true, [[265], [265]]]);
  });
  const a = sum(play(1, disputeWs(MOD, 5)), [H, J]);
  eq('[3] J\'s own record says he left (abandoner): J the 50 as before, H still 225', [a.ok, XPs(a, [H, J])], [true, [[225], [50]]]);
  const lone = sum(play(1, [[H, 0, two, 2, true, true, HON], [J, 1, two, 2, true, false, HON]]), [H, J]);
  eq('[3] J left without a result (one writer): not a dispute -- H the 50 as before, J a leaver', [lone.ok, XPs(lone, [H, J]), lone[J].lv], [true, [[50], []], 1]);
  const ffa = [[H, 0, three, 3, true, true, [7000, 5000, 4000]], [J, 1, three, 3, true, true, [4000, 9000, 4000]], [X, 2, three, 3, true, true, [7000, 5000, 4000]]];
  const b3 = sum(play(1, ffa), [H, J, X]);
  eq('[3] a brawl of three that disagrees: the 50 each as before (no place in it is "the loser\'s")', [b3.ok, XPs(b3, [H, J, X])], [true, [[50], [50], [50]]]);
  const ffa2 = ffa.slice(0, 2).concat([[X, 2, three, 3, true, false, [7000, 5000, 4000]]]);   // X started, wrote no result
  const b2 = sum(play(1, ffa2), [H, J, X]);
  eq('[3] a brawl of three, two results that disagree, the third seat gone: the 50 each as before', [b2.ok, XPs(b2, [H, J, X]), b2[X].lv], [true, [[50], [50], []], 1]);
  withMutant(['anyTable'], '[3]', (sc) => {
    const m = sum(play(1, ffa2, null, sc), [H, J, X]);
    T('[3] mutant (any table): that brawl paid the floor', m.ok && m[H].xp[0] > 50 && m[J].xp[0] > 50, JSON.stringify(XPs(m, [H, J, X])));
  });
}

// ---- [4] the day cap (on the signals, before the writes) ----
{
  const day = Math.floor(Date.now() / 86400000);
  const sig0 = { day: { d: day, n: {} }, players: {}, pairs: {}, flagged: {} };
  sig0.players[v.pid(H)] = { g: 0, w: 0, v: 0, f: 0, ns: 0, disp: [0, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now(), fq: day, fqn: 3 };
  sig0.players[v.pid(J)] = { g: 0, w: 0, v: 0, f: 0, ns: 0, disp: [0, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: Date.now(), fq: day, fqn: 2 };
  const p = play(1, disputeWs(), { files0: { SIGNALS_FILE: sig0 } });
  const o = sum(p, [H, J]);
  if (Math.floor(Date.now() / 86400000) !== day) ok('[4] skipped: the UTC day turned during the runs');
  else {
    const pj = sigOf(last(p.rs), J), ph = sigOf(last(p.rs), H);
    eq('[4] H already paid 3 floors today -> the flat 50; J (2) -> 225, now at 3', [o.ok, XPs(o, [H, J]), ph.fqn, pj.fqn, rowQ308(last(p.rs))], [true, [[50], [225]], 3, 3, [1, 1]]);
    T('[4] the capped writer is logged', /consolation: [^\n]* past 3 disputed-1V1 floors today -- the flat 50 \(Q308\)/.test(last(p.rs).out));
    withMutant(['noCap'], '[4]', (sc) => {
      const m = sum(play(1, disputeWs(), { files0: { SIGNALS_FILE: sig0 } }, sc), [H, J]);
      eq('[4] mutant (no cap): H the floor a 4th time', [m.ok, XPs(m, [H, J])], [true, [[225], [225]]]);
    });
  }
}

// ---- [5] the leaver factor and the demo's record-only window; the level boost ----
{
  const lv = { LEAVERS_FILE: { [v.pid(H)]: { leaves: 30, lastMatch: '' } } };
  const ea = sum(play(1, disputeWs(), { files0: lv }), [H, J]);
  eq('[5] H left 30 matches (x0.3): 68 on the full game, as a lost match would pay him', [ea.ok, XPs(ea, [H, J])], [true, [[68], [225]]]);
  const demo = sum(play(1, disputeWs(), { files0: lv, env: Object.assign({ LEAVER_XP_RECORD_ONLY_UNTIL: isoIn(7 * 86400000) }, demoEnv) }), [H, J]);
  eq('[5] the same on the demo job inside its record-only window: 225 (leaves counted, XP not discounted)', [demo.ok, XPs(demo, [H, J])], [true, [[225], [225]]]);
  XP_SEED[H] = 1500;
  const lb = sum(play(1, disputeWs()), [H, J]);
  delete XP_SEED[H];
  eq('[5] H at 1500 XP (level 5, +5%): 1500 + 236; J 225', [lb.ok, XPs(lb, [H, J])], [true, [[1500 + Math.round(225 * 1.05)], [225]]]);
}

// ---- [6] wiring pins ----
{
  const vb = (/function reconcileStarts\([\s\S]*?\n\}/.exec(SRC) || [''])[0];
  T('[6] reconcileStarts: the floor taken right after the consolation loop, for this key\'s consoled writers only; returned',
    /\n    const c0 = consoledSids\.length;[^\n]*\n    const ownFault = /.test(vb)
    && vb.indexOf('      consoledSids.push(s);\n    }\n') > 0 && /consoledSids\.push\(s\);\n    \}\n(    \/\/[^\n]*\n)*    const fl = consoledSids\.length > c0 \? disputeFloorOf\(p, groups\[m\]\) : null;\n    if \(fl\) for \(const s of consoledSids\.slice\(c0\)\) if \(fl\.has\(s\)\) consoleFloor\[s\] = Object\.assign\(\{ m \}, fl\.get\(s\)\);\n/.test(vb)
    && /return \{ registered, convicted, cleaned, held, consoledSids, consoleFloor, voided, skEv \};/.test(vb));
  const mb = SRC.slice(SRC.indexOf('  let consoledN = 0;\n'), SRC.indexOf('  RUN.consoled = consoledN;'));
  T('[6] main: admitted ahead of the writes, the signals on disk first (APPLY_MMR), the floor XP in the payment, counted',
    /const floorRes = XP_LB \? disputeFloorAdmit\(startsRes\.consoleFloor, signals, nowMs\) : /.test(mb) && /if \(floorRes\.dirty\) \{ sigDirty = true; if \(APPLY_MMR\) saveSignals\(signals, nowMs\); \}/.test(mb)
    && mb.indexOf('saveSignals(signals, nowMs)') < mb.indexOf('readUserEntry(xpId0, sid, ')
    // Q315: the floor rides the owed-credit plan -- the admitted writer's item is the floor, its XP disputeFloorXp at the row read
    && /const item = consoled\.indexOf\(sid\) >= 0 \? owedItem\(fl, fday\) : null;/.test(mb) && /plan = consoleOwedPlan\(h, c, cq0, item, \(it\) => owedItemXp\(it, c, leaves, /.test(mb)
    && /function owedItemXp\(it, boardXp, leaves, gamesOf\) \{\n  return \(it && it\.cls\) \? disputeFloorXp\(\{ cls: it\.cls, money: it\.mo \| 0, ranked: !!it\.rk \}, boardXp, leaves, gamesOf\(\)\) : CONSOLATION_XP;/.test(SRC)
    && /const next = c \+ plan\.add;/.test(mb)
    && /RUN\.consoled = consoledN; RUN\.disputeFloor = floorN;/.test(SRC));
  T('[6] the payment writes the XP board only (no rating / points / CP write in the consolation loop)', !/LP_LB|lpBoardId|CP_LB|ratingId/.test(mb));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (dispute-1v1-floor) ===');
process.exit(failN === 0 ? 0 : 1);
