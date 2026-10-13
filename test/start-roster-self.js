'use strict';
// Q130 + Q127 / Q138 (cloud audit 2026-10, REVIEW of Q121 / Q127): a matchmade start roster against the players' own lies.
// Q130: a matchmade match seats a Steam account at every seat below its seat count, so a matchmade start record that
//   leaves a seat empty is its writer's own lie: it keeps its seat claim but does not vote; the other players' starts
//   register the roster when it seats every such writer at the seat he wrote from (one other start is then enough); the
//   writer is flagged once per key. Voters who name another table (an alt at another player's seat) are outvoted when
//   one table is plainly the players' (no disputed seat, one seat count, the majority roster seats every voter at his own
//   seat, at least two voters name it word for word and more than name anything else) -- unsplit, nobody flagged. A later
//   start does not split a provisional roster when its writer is seated at his own seat by it, or when it is blank.
// Q127: a matchmade key once split or contested stays held until it voids (a note pending['~' + key], c = 1), whatever
//   is withdrawn later. Q138: a start first read after the key's result (in a run after a start was read, no provisional
//   roster) is left out entirely. START_CONFIRM_MS is four minutes (Q130; five before).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/late-start-roster.js):
//   [1] 1V1 ranked: the loser's start leaves the winner's seat empty, honest result -> registered from the winner's start
//       alone, settles normally, the loser flagged once (once per key and writer), the winner not
//   [2] the same with the winner as the liar, who overwrites his blank start with an honest one before the end -> settles
//       normally, the liar flagged once
//   [3] 4-player ranked FFA: one player's start names an alt at another player's seat (a full roster) -> outvoted,
//       registered unsplit, settles normally, nobody flagged
//   [4] 2V2: both losers name alts at the winners' seats (2 to 2) -> split, held for good, voided at maturity, nobody
//       rated or flagged, the winners no leavers
//   [5] late lie: 1V1, the roster registered and still provisional, the loser rewrites his own start naming an alt at the
//       winner's seat -> no split, confirmed at four minutes, settles normally; [5b] an outside account's blank start read
//       in the provisional time -> no split, settles normally, the outside account flagged once
//   [6] sticky: 1V1, an outside account starts from the winner's seat before the first look (disputed), the real result
//       arrives, the outside row is withdrawn before any settle -> held for good (no points), voided, nobody flagged;
//       [6b] the outside row stays up past maturity (no start roster ever registers): the key voids from its note
//       (contest-void), nobody rated or flagged; the row withdrawn 25 hours later (the note long gone) -> still nothing settles
//   [7] Q138: 1V1, the loser writes no start; after the result is read his alt starts from seat 0 naming {0: alt, 1: loser}
//       -> left out, settles normally
//   [8] counter-cases: honest 1V1 / 4P settle normally (the starts-pending row leaves the notes out, a note goes with its
//       processed key); a cold-reconnect copy of a start read after the result changes nothing; a friends' room with a
//       bot seat is not judged by the blank rule; the Q118 attack (two alts register a roster first with a fake result,
//       the honest starts read the next run) still splits and nothing settles for the alts
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-roster-self-'));
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
//   ros: one steam id per seat ('0' = nobody: an empty seat, a bot seat); sc: the seat scores the record claims (default by seat)
const SC = { 2: [7000, 4000], 3: [6100, 5200, 4800], 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (sc || SC[pc])[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 1V1 ranked (mt 2, two seats): seat 0 wins
const v1settle = (hash, seat, ros) => rec(0xB1, 2, hash, seat, seat === 0 ? 1 : 2, seat === 0, ros);
const v1start = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
// 4-player ranked FFA (mt 2): seat 0 wins, ranks by seat
const ffaSettle = (hash, seat, ros) => rec(0xB1, 2, hash, seat, 1 + seat, seat === 0, ros);
const ffaStart = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
// 2V2 ranked (mt 6): the {0,1} v {2,3} convention, ranks by score inside each team; `winTeam` 0 = seats 0/1 won
const t2rank = (seat, winTeam) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === winTeam ? 1 : 3) + inTeam; };
const t2settle = (hash, seat, ros, winTeam) => rec(0xB1, 6, hash, seat, t2rank(seat, winTeam || 0), ((seat >> 1) & 1) === (winTeam || 0), ros,
  winTeam ? [3900, 4800, 6100, 5200] : null);
const t2start = (hash, seat, ros) => rec(0xB2, 6, hash, seat, 0, false, ros);
// friends' room (mt 10): seat 0 wins
const pvSettle = (hash, seat, ros) => rec(0xB1, 10, hash, seat, 1 + seat, seat === 0, ros);
const pvStart = (hash, seat, ros) => rec(0xB2, 10, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const asRec = (d, sid) => ({ steamID: sid, d, roster: (() => { const r = {}; for (let s = 0; s < d[8]; s++) { const i = 11 + d[8] + 2 * s; const b = (BigInt(d[i + 1] >>> 0) << 32n) | BigInt(d[i] >>> 0); if (b !== 0n) r[s] = b.toString(); } return r; })() });

const P1 = SID(181), P2 = SID(182), P3 = SID(183), P4 = SID(184), X = SID(185);
const Q = Array.from({ length: 8 }, (_, i) => SID(191 + i));   // alts and outside accounts
const ALL = [P1, P2, P3, P4, X].concat(Q);
// recs: [{ sid, d, shard? }] spread over distinct shard rows (one account = one entry per shard; shard: an explicit index)
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) {
    if (r.shard != null) { boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); continue; }
    used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d });
  }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const up = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] > 2500; };
const down = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] < 2500; };
const rated = (rs, sid) => ptsIn(rs, sid).length === 1;
const none = (rs, sid) => ptsIn(rs, sid).length === 0;
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
const noteOf = (r, key) => (r.state.STARTS_FILE || {})['~' + key];
const pts = (rs, sids) => JSON.stringify(sids.map(s => ptsIn(rs, s)));
const flags = (r, sids) => JSON.stringify(sids.map(s => fOf(r, s)));
const firstProcessed = (rs, key) => rs.findIndex(r => processedOf(r).has(key));
const Q75 = /roster contest, not settled \(Q75\)/;
const LATE = /start-split [^\n]*names another roster[^\n]*\(Q118\)/;
const SPLIT = /start-split /, DISPUTE = /start-dispute /, LEFTOUT = /start-late: /;
const BLANK = (key) => new RegExp('start-blank ' + key + ': 1 start\\(s\\) leave a seat empty');
const OUTVOTED = (key, k, n) => new RegExp('start-outvoted ' + key + ': ' + k + ' of ' + n + ' voters name another roster');
const VOIDED = (key) => new RegExp('start-orphan ' + key + '[^\\n]*-> 0 exit-rate hits');
const pendingRow = (r) => { const m = /\| starts pending \/ exit-rate hits \| ([0-9]+) \//.exec(r.summary); return m ? Number(m[1]) : -1; };
const W = v.START_CONFIRM_MS;
const MATURE = v.STARTS_MATURITY_MS;
const pidRoster = (sids) => { const o = {}; sids.forEach((s, i) => { if (s !== '0') o[i] = v.pid(s); }); return o; };
const sameRoster = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

console.log('=== a matchmade start roster against the players\' own lies (Q130 / Q127 / Q138) ===');
T('[0] START_CONFIRM_MS: four minutes by default, three at least (Q130)', W === 240000 && v.START_CONFIRM_MIN_MS === 180000, String(W));

// ---- [1] 1V1: the loser's start leaves the winner's seat empty ----
{
  const h = 0xA001, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, ['0', P2]) }];
  const F = S.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, S], [5 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]);
  T('[1] four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T('[1] the blank start does not vote: the roster registers from the winner\'s start alone, seating both, provisional, unsplit',
    BLANK(key).test(rs[0].out) && pendOf(rs[0], key) && sameRoster(pendOf(rs[0], key).roster, pidRoster(R)) && pendOf(rs[0], key).prov && !pendOf(rs[0], key).split,
    JSON.stringify(pendOf(rs[0], key)) + ' ' + rs[0].out.slice(-600));
  T('[1] no split, no contest, no note of one', !SPLIT.test(outOf(rs)) && !Q75.test(outOf(rs)) && !(noteOf(rs[0], key) || {}).c);
  T('[1] settles normally: the winner gains, the loser loses, nobody convicted', processedOf(rs[1]).has(key) && up(rs, P1) && down(rs, P2)
    && [P1, P2].every(s => leavesOf(last(rs), s) === 0), pts(rs, [P1, P2]));
  T('[1] the loser is flagged once (once per key and writer, also after the settle), the winner not', fOf(rs[0], P2) === 1 && fOf(last(rs), P2) === 1 && fOf(last(rs), P1) === 0
    && flaggedKeys(rs[0]).indexOf(key + '|blank|' + v.pid(P2)) >= 0 && flaggedKeys(rs[0]).filter(k => k.indexOf(key) === 0).length === 1,
    flags(last(rs), [P1, P2]) + ' ' + JSON.stringify(flaggedKeys(rs[0])));
}

// ---- [2] 1V1: the winner leaves the loser's seat empty, then overwrites it with an honest start ----
{
  const h = 0xA002, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S0 = [{ sid: P1, d: v1start(h, 0, [P1, '0']) }, { sid: P2, d: v1start(h, 1, R) }];
  const S1 = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];   // the same shard row, overwritten
  const F = S1.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, S0], [2 * MIN, S1], [3 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]);
  T('[2] five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[2] registered from the loser\'s start alone, seating both, provisional', BLANK(key).test(rs[0].out) && pendOf(rs[0], key)
    && sameRoster(pendOf(rs[0], key).roster, pidRoster(R)) && pendOf(rs[0], key).prov && !pendOf(rs[0], key).split, JSON.stringify(pendOf(rs[0], key)));
  T('[2] the honest overwrite names the registered roster: no split, no contest', !SPLIT.test(outOf(rs)) && !Q75.test(outOf(rs)) && !(pendOf(rs[1], key) || {}).split);
  T('[2] settles normally: the liar (the winner) gains, the loser loses, nobody convicted', processedOf(rs[2]).has(key) && up(rs, P1) && down(rs, P2)
    && [P1, P2].every(s => leavesOf(last(rs), s) === 0), pts(rs, [P1, P2]));
  T('[2] the liar is flagged once, the loser not', fOf(last(rs), P1) === 1 && fOf(last(rs), P2) === 0 && flaggedKeys(last(rs)).indexOf(key + '|blank|' + v.pid(P1)) >= 0,
    flags(last(rs), [P1, P2]));
}

// ---- [3] 4-player ranked FFA: P4's start names an alt at P2's seat ----
{
  const h = 0xA003, R4 = [P1, P2, P3, P4], L4 = [P1, Q[0], P3, P4], key = keyOf(ffaStart(h, 0, R4));
  const S = [0, 1, 2].map(s => ({ sid: R4[s], d: ffaStart(h, s, R4) })).concat([{ sid: P4, d: ffaStart(h, 3, L4) }]);
  const F = S.concat([0, 1, 2, 3].map(s => ({ sid: R4[s], d: ffaSettle(h, s, R4) })));
  const rs = timeline([[0, S], [5 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]);
  T('[3] four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T('[3] outvoted: 1 of 4 voters names another roster, the players\' roster registers unsplit (its signature provisional)',
    OUTVOTED(key, 1, 4).test(rs[0].out) && pendOf(rs[0], key) && sameRoster(pendOf(rs[0], key).roster, pidRoster(R4)) && !pendOf(rs[0], key).split
    && pendOf(rs[0], key).prov === v.startSig(asRec(ffaStart(h, 0, R4), P1)), JSON.stringify(pendOf(rs[0], key)) + ' ' + rs[0].out.slice(-600));
  T('[3] no split, no contest, no note of one', !SPLIT.test(outOf(rs)) && !Q75.test(outOf(rs)) && !(noteOf(rs[0], key) || {}).c);
  T('[3] settles normally: P1 wins, everyone rated once, the alt gets nothing, nobody convicted', processedOf(rs[1]).has(key) && up(rs, P1)
    && R4.every(s => rated(rs, s)) && none(rs, Q[0]) && R4.every(s => leavesOf(last(rs), s) === 0), pts(rs, R4.concat([Q[0]])));
  T('[3] nobody flagged, the outvoted player included', R4.concat([Q[0]]).every(s => fOf(last(rs), s) === 0), flags(last(rs), R4.concat([Q[0]])));
}

// ---- [4] 2V2: both losers name alts at the winners' seats (2 to 2) ----
{
  const h = 0xA004, RR = [P1, P2, P3, P4], FF = [Q[0], Q[1], P3, P4], key = keyOf(t2start(h, 0, RR));
  const S = [{ sid: P1, d: t2start(h, 0, RR) }, { sid: P2, d: t2start(h, 1, RR) }, { sid: P3, d: t2start(h, 2, FF) }, { sid: P4, d: t2start(h, 3, FF) }];
  const F = S.concat([0, 1].map(s => ({ sid: RR[s], d: t2settle(h, s, RR, 0) })), [2, 3].map(s => ({ sid: RR[s], d: t2settle(h, s, FF, 1) })));
  const rs = timeline([[0, S], [5 * MIN, F], [5 * MIN, F], [6 * MIN, F], [MATURE, F]]);
  const who = RR.concat([Q[0], Q[1]]);
  T('[4] five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[4] split (a tie is not outvoted), the note marks the contest', SPLIT.test(rs[0].out) && !/start-outvoted /.test(outOf(rs)) && (pendOf(rs[0], key) || {}).split === 1
    && (noteOf(rs[0], key) || {}).c === 1, JSON.stringify([pendOf(rs[0], key), noteOf(rs[0], key)]));
  T('[4] held for good: the Q75 contest in every run before maturity, not processed, nobody rated', [1, 2, 3].every(i => Q75.test(rs[i].out) && !processedOf(rs[i]).has(key))
    && who.every(s => none(rs, s)), pts(rs, who));
  T('[4] voided at maturity, the winners no leavers, nobody convicted', VOIDED(key).test(last(rs).out) && processedOf(last(rs)).has(key) && RR.every(s => leavesOf(last(rs), s) === 0),
    JSON.stringify(RR.map(s => leavesOf(last(rs), s))));
  T('[4] nobody flagged', who.every(s => fOf(last(rs), s) === 0), flags(last(rs), who));
}

// ---- [5] late lie: the loser rewrites his own start while the roster is provisional ----
{
  const h = 0xA005, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const L = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, [Q[2], P2]) }];   // the same shard row, overwritten
  const F = L.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, S], [2 * MIN, L], [2 * MIN, L], [1 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]);
  T('[5] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[5] the lie is read while the roster is provisional; he is seated at his own seat by it: no split', (pendOf(rs[1], key) || {}).prov && !(pendOf(rs[1], key) || {}).split
    && !SPLIT.test(outOf(rs)) && !Q75.test(outOf(rs)) && !(noteOf(rs[1], key) || {}).c, JSON.stringify(pendOf(rs[1], key)));
  T('[5] confirmed at four minutes (Q130 window)', pendOf(rs[2], key) && !('prov' in pendOf(rs[2], key)) && !pendOf(rs[2], key).split, JSON.stringify(pendOf(rs[2], key)));
  T('[5] settles normally: P1 gains, P2 loses, the alt gets nothing, nobody convicted', processedOf(rs[3]).has(key) && up(rs, P1) && down(rs, P2) && none(rs, Q[2])
    && [P1, P2].every(s => leavesOf(last(rs), s) === 0), pts(rs, [P1, P2, Q[2]]));
  T('[5] nobody flagged', [P1, P2, Q[2]].every(s => fOf(last(rs), s) === 0), flags(last(rs), [P1, P2, Q[2]]));
}
{
  // [5b] an outside account writes a blank start (P1's seat empty, itself at P2's) from seat 1 while the roster is provisional
  const h = 0xA015, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const SX = S.concat([{ sid: X, d: v1start(h, 1, ['0', X]) }]);
  const F = SX.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, S], [2 * MIN, SX], [3 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]);
  T('[5b] five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[5b] a blank start read in the provisional time splits nothing', (pendOf(rs[0], key) || {}).prov && !SPLIT.test(outOf(rs)) && !Q75.test(outOf(rs))
    && !(pendOf(rs[1], key) || {}).split, JSON.stringify(pendOf(rs[1], key)) + ' ' + rs[1].out.slice(-600));
  T('[5b] settles normally: P1 gains, P2 loses, the outside account gets nothing', processedOf(rs[2]).has(key) && up(rs, P1) && down(rs, P2) && none(rs, X)
    && [P1, P2].every(s => leavesOf(last(rs), s) === 0), pts(rs, [P1, P2, X]));
  T('[5b] the outside account is flagged once, the players not', fOf(last(rs), X) === 1 && fOf(last(rs), P1) === 0 && fOf(last(rs), P2) === 0, flags(last(rs), [P1, P2, X]));
}

// ---- [6] sticky: an outside start from the winner's seat before the first look, withdrawn before any settle ----
{
  const h = 0xA006, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const SX = S.concat([{ sid: X, d: v1start(h, 0, [X, P2]) }]);
  const res = [{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }];
  const FX = SX.concat(res), F = S.concat(res);
  const rs = timeline([[0, SX], [5 * MIN, FX], [5 * MIN, F], [6 * MIN, F], [6 * MIN, F], [MATURE, F]]);
  T('[6] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[6] the first look sees seat 0 disputed: the note marks the contest', DISPUTE.test(rs[0].out) && (noteOf(rs[0], key) || {}).c === 1, JSON.stringify(noteOf(rs[0], key)));
  T('[6] held for good after the outside row is withdrawn: the Q75 contest in every run before maturity, nobody rated',
    [1, 2, 3, 4].every(i => Q75.test(rs[i].out) && !processedOf(rs[i]).has(key)) && [P1, P2, X].every(s => none(rs, s)), pts(rs, [P1, P2, X]));
  T('[6] voided at maturity, nobody convicted', VOIDED(key).test(last(rs).out) && processedOf(last(rs)).has(key) && [P1, P2].every(s => leavesOf(last(rs), s) === 0),
    JSON.stringify([P1, P2].map(s => leavesOf(last(rs), s))));
  T('[6] nobody flagged', [P1, P2, X].every(s => fOf(last(rs), s) === 0), flags(last(rs), [P1, P2, X]));
}

{
  // [6b] the same, but the outside row stays up: no start roster registers (seat 0 claimed twice), so no start entry voids
  //   the key -- its note does, at the same age; the row withdrawn after the note is gone settles nothing
  const h = 0xA016, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const SX = S.concat([{ sid: X, d: v1start(h, 0, [X, P2]) }]);
  const res = [{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }];
  const FX = SX.concat(res), F = S.concat(res);
  const rs = timeline([[0, SX], [5 * MIN, FX], [6 * MIN, FX], [MATURE, FX], [25 * HOUR, F], [6 * MIN, F], [6 * MIN, F]]);
  const VOID = new RegExp('contest-void ' + key + ': [^\\n]*no start roster -- void, nobody rated \\(Q127\\)');
  T('[6b] seven runs exit 0', allOk(rs, 7), last(rs).out.slice(-800));
  T('[6b] disputed at the first look, no start roster ever registers; held by the Q75 contest before maturity', DISPUTE.test(rs[0].out) && (noteOf(rs[0], key) || {}).c === 1
    && [0, 1, 2, 3].every(i => !pendOf(rs[i], key)) && [1, 2].every(i => Q75.test(rs[i].out) && !processedOf(rs[i]).has(key)), JSON.stringify([pendOf(rs[2], key), noteOf(rs[2], key)]));
  T('[6b] at maturity the key voids from its note (contest-void): processed, nobody rated', VOID.test(rs[3].out) && processedOf(rs[3]).has(key) && !VOID.test(outOf(rs.slice(0, 3)))
    && [P1, P2, X].every(s => none(rs.slice(0, 4), s)), rs[3].out.slice(-600));
  T('[6b] the outside row withdrawn 25 hours later: still nothing settles, no points move', [4, 5, 6].every(i => processedOf(rs[i]).has(key) && !new RegExp('settle ' + key).test(rs[i].out))
    && [P1, P2, X].every(s => none(rs, s)), pts(rs, [P1, P2, X]));
  T('[6b] nobody flagged or convicted', [P1, P2, X].every(s => fOf(last(rs), s) === 0) && [P1, P2].every(s => leavesOf(last(rs), s) === 0),
    flags(last(rs), [P1, P2, X]));
}

// ---- [7] Q138: the loser writes no start; his alt starts from seat 0 once the result is read ----
{
  const h = 0xA007, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }];
  const F = S.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const A = F.concat([{ sid: Q[4], d: v1start(h, 0, [Q[4], P2]) }]);
  const rs = timeline([[0, S], [5 * MIN, F], [1 * MIN, A], [5 * MIN, A], [5 * MIN, A], [3 * HOUR, A]]);
  T('[7] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[7] the result is read in a run after a start was (noted), no roster registered (one vote)', (noteOf(rs[1], key) || {}).r > 0 && !(pendOf(rs[0], key)),
    JSON.stringify([pendOf(rs[0], key), noteOf(rs[1], key)]));
  T('[7] the alt\'s start, first read after the result, is left out: no dispute, no contest, no split', LEFTOUT.test(rs[2].out) && !DISPUTE.test(outOf(rs))
    && !Q75.test(outOf(rs)) && !SPLIT.test(outOf(rs)) && !(noteOf(rs[2], key) || {}).c, rs[2].out.slice(-600));
  T('[7] settles normally: P1 gains, P2 loses, the alt gets nothing, nobody convicted', firstProcessed(rs, key) >= 2 && up(rs, P1) && down(rs, P2) && none(rs, Q[4])
    && [P1, P2].every(s => leavesOf(last(rs), s) === 0), pts(rs, [P1, P2, Q[4]]));
  T('[7] nobody flagged', [P1, P2, Q[4]].every(s => fOf(last(rs), s) === 0), flags(last(rs), [P1, P2, Q[4]]));
}

// ---- [8] counter-cases ----
const quiet = (rs) => ![BLANK('[0-9_]+'), /start-outvoted /, LEFTOUT, SPLIT, DISPUTE, Q75].some(re => re.test(outOf(rs)));
{
  // [8a] honest 1V1
  const h = 0xA008, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const F = S.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, S], [5 * MIN, F], [5 * MIN, F], [5 * MIN, F]]);
  T('[8a] honest 1V1: four runs exit 0, nothing blank / outvoted / left out / split / disputed / held', allOk(rs, 4) && quiet(rs), outOf(rs).slice(-800));
  T('[8a] settles normally, nobody flagged or convicted', processedOf(rs[1]).has(key) && up(rs, P1) && down(rs, P2) && [P1, P2].every(s => fOf(last(rs), s) === 0 && leavesOf(last(rs), s) === 0),
    pts(rs, [P1, P2]) + ' ' + flags(last(rs), [P1, P2]));
  T('[8a] the starts-pending row counts the key, not its note', noteOf(rs[0], key) && pendOf(rs[0], key) && pendingRow(rs[0]) === 1, String(pendingRow(rs[0])));
  T('[8a] the note goes with its processed key', !noteOf(last(rs), key) && !pendOf(last(rs), key), JSON.stringify(Object.keys(last(rs).state.STARTS_FILE || {})));
}
{
  // [8b] honest 4-player FFA
  const h = 0xA009, R4 = [P1, P2, P3, P4], key = keyOf(ffaStart(h, 0, R4));
  const S = [0, 1, 2, 3].map(s => ({ sid: R4[s], d: ffaStart(h, s, R4) }));
  const F = S.concat([0, 1, 2, 3].map(s => ({ sid: R4[s], d: ffaSettle(h, s, R4) })));
  const rs = timeline([[0, S], [5 * MIN, F], [5 * MIN, F]]);
  T('[8b] honest 4P: three runs exit 0, nothing blank / outvoted / left out / split / disputed / held', allOk(rs, 3) && quiet(rs), outOf(rs).slice(-800));
  T('[8b] settles normally, everyone rated once, nobody flagged or convicted', processedOf(rs[1]).has(key) && up(rs, P1) && R4.every(s => rated(rs, s) && fOf(last(rs), s) === 0
    && leavesOf(last(rs), s) === 0), pts(rs, R4) + ' ' + flags(last(rs), R4));
}
{
  // [8c] P2 cold-reconnects after the result is read (the roster confirmed, the settle still paced) and writes his start
  //   again: the same roster, the same seat, another shard
  const h = 0xA00C, R = [P1, P2], key = keyOf(v1start(h, 0, R));
  const S = [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const F = S.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const D = F.concat([{ sid: P2, d: v1start(h, 1, R), shard: 40 }]);
  const rs = timeline([[0, S], [4 * MIN, S], [MIN / 2, F], [1 * MIN, D], [5 * MIN, D]]);
  T('[8c] cold-reconnect copy after the result: five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[8c] the result is noted before the copy is read, the key not settled yet', (noteOf(rs[2], key) || {}).r > 0 && !processedOf(rs[2]).has(key),
    JSON.stringify(noteOf(rs[2], key)));
  T('[8c] the copy is the same entry: nothing left out, split or held', quiet(rs), outOf(rs).match(/start-(late|split|dispute)[^\n]*/g));
  T('[8c] settles normally once the copy is read, nobody flagged or convicted', processedOf(rs[3]).has(key) && up(rs, P1) && down(rs, P2)
    && [P1, P2].every(s => fOf(last(rs), s) === 0 && leavesOf(last(rs), s) === 0), pts(rs, [P1, P2]));
}
{
  // [8d] a friends' room with a bot seat: every start leaves the bot seat empty
  const h = 0xA00D, ros = [P1, P2, '0'], key = keyOf(pvStart(h, 0, ros));
  const S = [0, 1].map(s => ({ sid: ros[s], d: pvStart(h, s, ros) }));
  const F = S.concat([0, 1].map(s => ({ sid: ros[s], d: pvSettle(h, s, ros) })));
  const rs = timeline([[0, S], [6 * MIN, S], [6 * MIN, F], [6 * MIN, F], [6 * MIN, F]]);
  T('[8d] friends\' room with a bot: five runs exit 0, nothing blank / split / held, no note', allOk(rs, 5) && quiet(rs) && rs.every(r => !noteOf(r, key)),
    outOf(rs).slice(-800));
  T('[8d] the room roster registers and the room settles: both players credited, nobody flagged', pendOf(rs[0], key) && sameRoster(pendOf(rs[0], key).roster, pidRoster(ros))
    && processedOf(last(rs)).has(key) && xpOf(rs, P1) > 0 && xpOf(rs, P2) > 0 && [P1, P2].every(s => fOf(last(rs), s) === 0),
    'xp ' + xpOf(rs, P1) + '/' + xpOf(rs, P2) + ' ' + flags(last(rs), [P1, P2]));
}
{
  // [8e] Q118: two alts start at both seats right after START_GAME and write a result of their own; the job looks once;
  //   the honest starts are read the next run, the real result after that
  const h = 0xA00E, R = [P1, P2], A = [Q[5], Q[6]], key = keyOf(v1start(h, 0, R));
  const SA = [{ sid: Q[5], d: v1start(h, 0, A) }, { sid: Q[6], d: v1start(h, 1, A) }, { sid: Q[5], d: v1settle(h, 0, A) }, { sid: Q[6], d: v1settle(h, 1, A) }];
  const S = SA.concat([{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }]);
  const F = S.concat([{ sid: P1, d: v1settle(h, 0, R) }, { sid: P2, d: v1settle(h, 1, R) }]);
  const rs = timeline([[0, SA], [1 * MIN, S], [5 * MIN, F], [6 * MIN, F], [6 * MIN, F], [MATURE, F]]);
  const who = [P1, P2].concat(A);
  T('[8e] Q118 attack: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[8e] the alts\' roster registers first, provisional', pendOf(rs[0], key) && sameRoster(pendOf(rs[0], key).roster, pidRoster(A)) && pendOf(rs[0], key).prov,
    JSON.stringify(pendOf(rs[0], key)));
  T('[8e] the honest starts read the next run are not left out and split the key (the note marks the contest)', !LEFTOUT.test(outOf(rs)) && LATE.test(rs[1].out)
    && (pendOf(rs[1], key) || {}).split === 1 && (noteOf(rs[1], key) || {}).c === 1, rs[1].out.slice(-600));
  T('[8e] held until it voids: nothing settles for the alts, nobody rated', [2, 3, 4].every(i => Q75.test(rs[i].out) && !processedOf(rs[i]).has(key)) && who.every(s => none(rs, s)),
    pts(rs, who));
  T('[8e] voided at maturity, the players no leavers, nobody flagged', VOIDED(key).test(last(rs).out) && [P1, P2].every(s => leavesOf(last(rs), s) === 0)
    && who.every(s => fOf(last(rs), s) === 0), flags(last(rs), who));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (start-roster-self) ===');
process.exit(failN === 0 ? 0 : 1);
