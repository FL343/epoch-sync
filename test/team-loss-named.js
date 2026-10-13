'use strict';
// Q149 (cloud audit 2026-10, found by the Q136 review): a losing seat named by the others only leaves a team match unrated.
// Q136 moves no rating when nobody on the losing team counts. It still rated a team match whose losing team had a writer
//   AND a seat named after an account that never wrote a word for the key (Q69 named-only): the named-only seat counted as
//   a teammate who left (§7 shield), so the loser lost only the shielded share. Two accounts on opposite teams (no game
//   launched), each with a made-up teammate, traded wins: the winner took the full team win, the loser lost a point or two,
//   both climbed every two matches, without end at the zero-sum top (grandmaster: +10 / -0) and with no rating spread to
//   trip the reduced stakes (they trade wins). A third account writing the loss at the points floor, his teammate made up,
//   paid nothing while the two winners took a win every match. Now a named-only seat on the losing team leaves the match
//   unrated as Q136 does (no TrueSkill update, no points, no writer seed, no group-decay step, nobody flagged; XP / CP /
//   career still credited), logged `named-loser` and counted in its own summary row. A named-only seat on the winning team
//   changes nothing; FFA is not a team match.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/team-loss-side.js):
//   [0] wiring pins: the Q149 filter (losing team, team size of the match type), the summary row
//   [1] ranked 2V2, X (seat 0) and Y (seat 2) each with a made-up teammate, X's team wins -> unrated, named-loser line and
//       row, the named seats named-only (not convicted, not seeded), nobody flagged, no group memory, XP still credited;
//       mutant (the Q149 flip off) -> X gains, Y loses
//   [2] ranked 3V3, three winners write, one loser writes, his two teammates made up (seats 4 / 5) -> unrated; mutant
//       (team size 2 in the filter) -> rated
//   [3] quick 2V2 as [1] -> no rating write; mutant -> rating writes
//   [4] ranked team brawl (mode 1, the money sums decide) as [1] -> unrated; mutant -> rated
//   [5] the floor feeder: X / Y win, Z writes the loss at 0 points, his teammate made up -> unrated; mutant -> X / Y gain
//   [6] a named-only seat on the WINNING team (the losers both write) -> rated as before, no named-loser line; mutants (the
//       filter on the winning team / on either team) -> unrated
//   [7] a 3V3 losing team with a writer, a player convicted on his start and a named-only seat -> unrated; control: the
//       third loser wrote his start and left too -> rated, both leavers convicted; mutant (convicted leavers taken for
//       named-only) -> the control unrated
//   [8] nobody on the losing team counts (the Q136 case, the losers made up): the Q136 line, not the Q149 one; mutant
//       (the Q149 filter run on an uncounted side) -> the Q149 line
//   [9] ranked 4-player FFA with two named-only seats: rated as before, no named-loser line
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/team-loss-side.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-loss-named-'));
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
//   ros: one steam id per seat ('0' = nobody); sc: the seat scores the record claims (default by player count)
const SC = { 4: [6100, 5200, 4800, 3900], 6: [6100, 5200, 4400, 4800, 3900, 3500] };
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2) and a confession (0xB5) carry zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : (sc || SC[pc])[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// team convention: seats 0..ts-1 = team A, ts..2ts-1 = team B; rank claims {1..ts} for the winning team by seat order
const tsOf = (mt) => ((mt & 0xF) === 8 || (mt & 0xF) === 9) ? 3 : 2;
const teamRank = (mt, seat, winTeam) => { const ts = tsOf(mt), team = ((seat / ts) | 0) & 1; return (team === winTeam ? 1 : 1 + ts) + (seat % ts); };
const settle = (mt, hash, seat, ros, winTeam, sc) => rec(0xB1, mt, hash, seat, teamRank(mt, seat, winTeam), (((seat / tsOf(mt)) | 0) & 1) === winTeam, ros, sc);
const start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const confess = (mt, hash, seat, ros) => rec(0xB5, mt, hash, seat, 0, false, ros, null, 5);   // disp 5 = user-quit
const refuse = (mt, hash, seat, ros) => rec(0xB1, mt, hash, seat, 0, false, ros);   // the client's rank-0 team-gamble refusal
const ffaSettle = (hash, seat, ros) => rec(0xB1, 2, hash, seat, 1 + seat, seat === 0, ros);
const ffaStart = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const P1 = SID(281), P2 = SID(282), P3 = SID(283), P4 = SID(284), P5 = SID(285), P6 = SID(286);
const X = SID(287), Y = SID(288), Z = SID(289);
const G = Array.from({ length: 6 }, (_, i) => SID(291 + i));   // accounts named in a made-up roster that never write
const ALL = [P1, P2, P3, P4, P5, P6, X, Y, Z].concat(G);
const LP_AT = {};   // points a test starts an account at (default 2500)
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
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: LP_AT[s] != null ? LP_AT[s] : 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state the first run starts from
function timeline(steps, script, files0) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : (files0 || null), env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}

const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const LEAVE = v.LEAVE_CONFIRM_MS + MIN;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const up = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] > 2500; };
const down = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] < 2500; };
const none = (rs, sid) => ptsIn(rs, sid).length === 0;
const ratingOf = (rs, sid) => [].concat(...rs.map(r => posts(r, 6).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body))));
const pts = (rs, sids) => JSON.stringify(sids.map(s => ptsIn(rs, s)));
const flags = (r, sids) => JSON.stringify(sids.map(s => fOf(r, s)));
const NOLOSER_LINE = (key) => new RegExp('no-loser ' + key + ': nobody on the losing team[^\n]*\\(Q136\\)');
const ROW = (r, n) => new RegExp('\\| team matches with nobody on the losing team, settled without a rating move \\(Q136\\) \\| ' + n + ' \\|').test(r.summary);
const NAMED_LINE = (key) => new RegExp('named-loser ' + key + ': seat [^\n]*named by the others only[^\n]*\\(Q149\\)');
const NROW = (r, n) => new RegExp('\\| team matches with a losing seat named by the others only, settled without a rating move \\(Q149\\) \\| ' + n + ' \\|').test(r.summary);
const firstProcessed = (rs, key) => rs.findIndex(r => processedOf(r).has(key));
const FLIP = '    if (namedLose.length) lossSide.counted = false;\n';
const FILTER = 'namedOnly.filter((x) => teamOfSeat(x.seat, teamSizeOfMt(matchType)) === lossSide.lose)';
const GATE = '(lossSide && lossSide.counted) ? ' + FILTER;
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-team-loss-named-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
// one key: writers [[seat, sid, 'win' | 'loss' | 'left']] on roster ros; 'left' = start only, convicted once the match must be over
function keyCase(mt, h, ros, writers, winTeam, sc) {
  const S = writers.map(([i, s]) => ({ sid: s, d: start(mt, h, i, ros) }));
  const R = writers.filter(([, , k]) => k !== 'left').map(([i, s]) => ({ sid: s, d: settle(mt, h, i, ros, winTeam, sc) }));
  const all = S.concat(R);
  return { key: keyOf(S[0].d), steps: [[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]] };
}

console.log('=== a losing seat named by the others only leaves a team match unrated (Q149) ===');

// ---- [0] wiring ----
T('[0] the Q149 filter takes the named-only seats of the losing team, by the team size of the match type', SRC.split(GATE + ' : [];').length === 2 && SRC.split(FLIP).length === 2);
T('[0] the Q149 summary row', /team matches with a losing seat named by the others only, settled without a rating move \(Q149\) \| ' \+ s\('namedLoser', 0\)/.test(SRC));

// ---- [1]-[4] two accounts on opposite teams, each with made-up teammates ----
const trade = [
  // [tag, mt, hash, roster, writers, winTeam, scores, ranked]
  ['[1] ranked 2V2', 6, 0xB149, [X, G[0], Y, G[1]], [[0, X], [2, Y]], 0, null, true],
  ['[3] quick 2V2', 5, 0xB14A, [X, G[0], Y, G[1]], [[0, X], [2, Y]], 0, null, false],
  ['[4] ranked team brawl', 4, 0xB14B, [X, G[0], Y, G[1]], [[0, X], [2, Y]], 1, [3100, 2600, 6100, 5200], true],
];
for (const [tag, mt, h, ros, wr, winTeam, sc, ranked] of trade) {
  const c = keyCase(mt, h, ros, wr, winTeam, sc);
  const writers = wr.map(([, s]) => s), named = ros.filter((s) => writers.indexOf(s) < 0);
  const rs = timeline(c.steps);
  const at = firstProcessed(rs, c.key);
  T(tag + ' runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T(tag + ' settles unrated: the named-loser line once, counted in that run\'s summary, no Q136 line', at >= 0 && NAMED_LINE(c.key).test(rs[at].out) && NROW(rs[at], 1)
    && (outOf(rs).match(new RegExp('named-loser ' + c.key, 'g')) || []).length === 1 && !/no-loser /.test(outOf(rs)), 'processed at run ' + at + ' ' + (rs[Math.max(0, at)] || rs[0]).out.slice(-900));
  T(tag + ' no points and no rating write for anybody', writers.concat(named).every((s) => none(rs, s) && ratingOf(rs, s).length === 0), pts(rs, writers.concat(named)));
  T(tag + ' the named seats stay named-only (Q69): not convicted, not seeded', named.every((s) => leavesOf(last(rs), s) === 0) && /named by the others but never wrote his own record/.test(outOf(rs))
    && !/ seed /.test(outOf(rs)));
  T(tag + ' nobody flagged, no repeat-group memory', writers.concat(named).every((s) => fOf(last(rs), s) === 0) && writers.every((s) => !(last(rs).state.GROUPS_FILE || {})[v.pid(s)]),
    flags(last(rs), writers.concat(named)));
  T(tag + ' XP still credited to both writers', writers.every((s) => xpOf(rs, s) > 0), JSON.stringify(writers.map((s) => xpOf(rs, s))));
  withMutant('flip' + mt, FLIP, '', (script) => {
    const m = timeline(c.steps, script);
    const w = winTeam === 0 ? X : Y, l = winTeam === 0 ? Y : X;
    T(tag + ' mutant: the Q149 flip off -> ' + (ranked ? 'the winner gains, the loser loses' : 'both ratings move'),
      allOk(m, 5) && (ranked ? (up(m, w) && down(m, l)) : (ratingOf(m, X).length > 0 && ratingOf(m, Y).length > 0)), pts(m, [X, Y]));
  });
}

// ---- [2] ranked 3V3: three winners write, one loser writes, his two teammates (seats 4 / 5) made up ----
{
  const ros = [P1, P2, P3, Y, G[0], G[1]];
  const c = keyCase(9, 0xB14C, ros, [[0, P1], [1, P2], [2, P3], [3, Y]], 0, null);
  const rs = timeline(c.steps);
  T('[2] ranked 3V3, one loser writes, seats 4 / 5 made up: unrated, named-loser line', allOk(rs, 5) && NAMED_LINE(c.key).test(outOf(rs)) && [P1, P2, P3, Y].every((s) => none(rs, s)),
    pts(rs, [P1, P2, P3, Y]) + ' ' + last(rs).out.slice(-600));
  withMutant('ts2', FILTER, 'namedOnly.filter((x) => teamOfSeat(x.seat, 2) === lossSide.lose)', (script) => {
    const m = timeline(c.steps, script);
    T('[2] mutant: team size 2 in the filter (seats 4 / 5 read as team A) -> rated', allOk(m, 5) && up(m, P1) && down(m, Y), pts(m, [P1, Y]));
  });
}

// ---- [5] the floor feeder ----
{
  LP_AT[Z] = 0;
  const ros = [X, Y, Z, G[2]];
  const c = keyCase(6, 0xB14D, ros, [[0, X], [1, Y], [2, Z]], 0, null);
  const rs = timeline(c.steps);
  T('[5] floor feeder (Z at 0 points writes the loss, his teammate made up): unrated, nobody\'s points move', allOk(rs, 5) && NAMED_LINE(c.key).test(outOf(rs)) && [X, Y, Z].every((s) => none(rs, s)),
    pts(rs, [X, Y, Z]));
  withMutant('flipF', FLIP, '', (script) => {
    const m = timeline(c.steps, script);
    T('[5] mutant: the Q149 flip off -> X / Y take the win, Z stays at the floor', allOk(m, 5) && up(m, X) && up(m, Y) && ptsIn(m, Z).every((p) => p === 0), pts(m, [X, Y, Z]));
  });
  delete LP_AT[Z];
}

// ---- [6] a named-only seat on the WINNING team ----
{
  const ros = [P1, G[3], P3, P4];
  const c = keyCase(6, 0xB14E, ros, [[0, P1], [2, P3], [3, P4]], 0, null);
  const rs = timeline(c.steps);
  T('[6] named-only seat on the winning team, both losers write: rated as before, no named-loser / no-loser line', allOk(rs, 5) && up(rs, P1) && down(rs, P3) && down(rs, P4)
    && !/named-loser |no-loser /.test(outOf(rs)) && NROW(rs[1], 0), pts(rs, [P1, P3, P4]));
  withMutant('winside', FILTER, 'namedOnly.filter((x) => teamOfSeat(x.seat, teamSizeOfMt(matchType)) === lossSide.win)', (script) => {
    const m = timeline(c.steps, script);
    T('[6] mutant: the filter on the winning team -> unrated', allOk(m, 5) && none(m, P1) && none(m, P3), pts(m, [P1, P3, P4]));
  });
  withMutant('anyside', FILTER, 'namedOnly.slice()', (script) => {
    const m = timeline(c.steps, script);
    T('[6] mutant: the filter on either team -> unrated', allOk(m, 5) && none(m, P1) && none(m, P3), pts(m, [P1, P3, P4]));
  });
}

// ---- [7] a 3V3 losing team with a writer, a convicted leaver and a named-only seat; control without the named-only seat ----
{
  const ros = [P1, P2, X, P4, P5, G[4]];
  const c = keyCase(9, 0xB14F, ros, [[0, P1], [1, P2], [2, X], [3, P4], [4, P5, 'left']], 0, null);
  const rs = timeline(c.steps);
  T('[7] losers: P4 writes, P5 left after his start, seat 5 made up: unrated (named-loser), P5 still convicted', allOk(rs, 5) && NAMED_LINE(c.key).test(outOf(rs))
    && [P1, P2, X, P4].every((s) => none(rs, s)) && leavesOf(last(rs), P5) === 1, pts(rs, [P1, P2, X, P4]) + ' leaves ' + leavesOf(last(rs), P5));
  const ros2 = [P1, P2, X, P4, P5, P6];
  const c2 = keyCase(9, 0xB150, ros2, [[0, P1], [1, P2], [2, X], [3, P4], [4, P5, 'left'], [5, P6, 'left']], 0, null);
  const rs2 = timeline(c2.steps);
  T('[7] control: P5 and P6 both left after their start -> rated, both convicted, no named-loser line', allOk(rs2, 5) && up(rs2, P1) && down(rs2, P4)
    && leavesOf(last(rs2), P5) === 1 && leavesOf(last(rs2), P6) === 1 && !/named-loser |no-loser /.test(outOf(rs2)), pts(rs2, [P1, P4]));
  withMutant('leavers', FILTER, 'leavers0.filter((x) => teamOfSeat(x.seat, teamSizeOfMt(matchType)) === lossSide.lose)', (script) => {
    const m = timeline(c2.steps, script);
    T('[7] mutant: convicted leavers taken for named-only -> the control unrated', allOk(m, 5) && none(m, P1) && none(m, P4), pts(m, [P1, P4]));
  });
}

// ---- [8] nobody on the losing team counts: the Q136 line, not the Q149 one ----
{
  const ros = [X, Y, G[0], G[1]];
  const c = keyCase(6, 0xB151, ros, [[0, X], [1, Y]], 0, null);
  const rs = timeline(c.steps);
  T('[8] the Q136 case (both losers made up): the Q136 line and row, no Q149 line', allOk(rs, 5) && NOLOSER_LINE(c.key).test(outOf(rs)) && !/named-loser /.test(outOf(rs))
    && rs.some((r) => ROW(r, 1)) && rs.every((r) => !NROW(r, 1)) && none(rs, X) && none(rs, Y), last(rs).out.slice(-600));
  withMutant('gate', GATE, 'lossSide ? ' + FILTER, (script) => {
    const m = timeline(c.steps, script);
    T('[8] mutant: the Q149 filter run on an uncounted side -> the Q149 line instead', allOk(m, 5) && NAMED_LINE(c.key).test(outOf(m)) && !/no-loser /.test(outOf(m)), last(m).out.slice(-600));
  });
}

// ---- [9] FFA is not a team match ----
{
  const h = 0xB152, ros = [X, Y, G[0], G[1]];
  const S = [0, 1].map((i) => ({ sid: ros[i], d: ffaStart(h, i, ros) })), R = [0, 1].map((i) => ({ sid: ros[i], d: ffaSettle(h, i, ros) }));
  const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
  T('[9] ranked 4-player FFA with two named-only seats: one up, one down, no named-loser line', allOk(rs, 4) && up(rs, X) && down(rs, Y) && !/named-loser |no-loser /.test(outOf(rs)), pts(rs, [X, Y]));
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (team-loss-named) ===' : '=== PASS -- 0 fail (team-loss-named) ===');
process.exit(failN ? 1 : 0);
