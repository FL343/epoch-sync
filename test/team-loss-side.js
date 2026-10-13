'use strict';
// Q136 (cloud audit 2026-10, found by the Q62 review): the losing team of a team match must be somebody.
// Two accounts (no game launched) wrote one consistent team result for a key nobody played, each from his own seat, both on
//   the winning team, every other seat named after an account that never wrote a word for the key. Q69 keeps those seats
//   named-only (not convicted, not rated), so the settle rated the two writers as a team that beat nobody: a team win each,
//   every match. Now a team match moves ratings only when its losing team counts somebody at this settle -- a writer rated
//   on a losing seat, or a losing seat convicted on his own record (start, result or confession); a seat named by the
//   others only, or one whose record was seen agreeing and is gone (pend.agreed), does not count. Otherwise the key
//   settles with no rating move (no TrueSkill update, no points, no writer seed, no group-decay step), nobody flagged.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/start-roster-self.js):
//   [0] teamLossCounted: mode 2 (rank claims) and mode 1 (money, tie -> team A), 2V2 and 3V3 seats, present and leaver
//       seats on either team
//   [1] ranked 2V2: X / Y (seats 0 / 1) write start + result "we won", seats 2 / 3 named after two accounts that never wrote
//       -> settles (processed) with no points and no rating write for anybody, logged and counted, no repeat-group memory, nobody flagged or
//       convicted; XP still credited (residual, pinned); mutant (the check off) -> both take the win
//   [2] ranked 3V3: three writers on one team, three named-only seats -> the same; mutant -> all three take the win
//   [3] quick 2V2: the same, no rating write; mutant -> rating writes
//   [4] ranked team brawl (mode 1): the writers on the team the money sums make the winner -> the same; mutant -> the win
//   [5] counted: (a) honest 2V2 all four write; (b) one writer per team, the teammates named-only; (c) one loser writes, the
//       other named-only; (d) both losers wrote their start and left (no result, no confession) -> convicted once the match
//       must be over, the winners rated; (e) one loser confessed, the other named-only -> the winners rated
//   [6] not counted: (a) every loser's result seen agreeing while the group waited, then gone (the cost case) -> unrated;
//       (b) a third account writes the loss while the group waits for a named-only seat, then withdraws it -> unrated;
//       mutant (agreed seats counted) -> the winners take the win in both
//   [7] ranked 4-player FFA with two named-only seats: rated as before (one up, one down), no Q136 line
//   [8] writers with no points row yet (first settle this season): the made-up key seeds nobody; control: an honest
//       2V2 of four such accounts seeds and rates all four
//   [9] a made-up key and an honest key settle in the same run: the group-decay memory saved holds the honest players only
//   [10] (trees with the Q56 team dissent) a dissent settle where the due dissenter is gone at the settle and his teammate is
//       excused -> unrated (an excused dissenter does not count); control: the due dissenter still there -> convicted,
//       the winners rated against the absent team (Q56 unchanged)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-loss-side-'));
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
const firstProcessed = (rs, key) => rs.findIndex(r => processedOf(r).has(key));
// mutants: the check off; agreed seats counted (they finished, their record rotated off); on a tree with the Q56 team
//   dissent (HAS_Q56) the leaver seats passed leave out the excused dissenters, and the last mutant counts them
const CHECK_AT = '    const noRating = !!(lossSide && !lossSide.counted);';
const HAS_Q56 = /const t2ex = new Set\(/.test(SRC);
const ALL_LEAVERS = 'leavers0.map((x) => x.seat)', NOT_EXCUSED = 'leavers0.filter((x) => !t2ex.has(pid(String(x.steamID)))).map((x) => x.seat)';
const LEAVERS_ARG = HAS_Q56 ? NOT_EXCUSED : ALL_LEAVERS;
const CALL_AT = 'teamLossCounted(matchType, scores, t2Win, parts.map((p) => p.seat), ' + LEAVERS_ARG + ')';
const AGREED_IN = 'teamLossCounted(matchType, scores, t2Win, parts.map((p) => p.seat), ' + LEAVERS_ARG + '.concat(detectLeavers(g).filter((x) => (pend.agreed || []).indexOf(pid(String(x.steamID))) >= 0).map((x) => x.seat)))';
const EXCUSED_IN = 'teamLossCounted(matchType, scores, t2Win, parts.map((p) => p.seat), ' + ALL_LEAVERS + ')';
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-team-loss-side-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}

console.log('=== the losing team of a team match must be somebody (Q136) ===');

// ---- [0] teamLossCounted ----
{
  const f = v.teamLossCounted;
  const sc4 = [6100, 5200, 4800, 3900], sc6 = [6100, 5200, 4400, 4800, 3900, 3500];
  T('[0] 2V2 ranked, team A won by the claims: only team A present -> not counted', JSON.stringify(f(6, sc4, 0, [0, 1], [])) === JSON.stringify({ win: 0, lose: 1, counted: false }));
  T('[0] a writer on a losing seat counts, a convicted leaver on a losing seat counts', f(6, sc4, 0, [0, 2], []).counted && f(6, sc4, 0, [0, 1], [3]).counted && f(6, sc4, 0, [1], [2]).counted);
  T('[0] a leaver on the winning team does not count', !f(6, sc4, 0, [0], [1]).counted);
  T('[0] mode 2 decides by the claims, not the money (team B won holding less)', f(6, sc4, 1, [2, 3], []).lose === 0 && !f(6, sc4, 1, [2, 3], []).counted && f(6, sc4, 1, [0, 3], []).counted);
  T('[0] 3V3 (mt 9): seats 0-2 v 3-5', !f(9, sc6, 0, [0, 1, 2], []).counted && f(9, sc6, 0, [0, 1, 3], []).counted && f(9, sc6, 0, [0], [5]).counted && !f(9, sc6, 0, [0, 2], [1]).counted);
  T('[0] mode 1 (mt 4): the money sums decide, a tie goes to team A', f(4, [100, 200, 900, 50], null, [2, 3], []).win === 1 && !f(4, [100, 200, 900, 50], null, [2, 3], []).counted
    && f(4, [500, 500, 600, 400], null, [0, 1], []).win === 0 && !f(4, [500, 500, 600, 400], null, [0, 1], []).counted && f(4, [500, 500, 600, 400], null, [2], []).counted);
}

// ---- [1]-[4] made-up team results with the losing team named after accounts that never wrote ----
const madeUp = [
  // [tag, mt, hash, writers (seat -> sid), roster, winTeam, scores]
  ['[1] ranked 2V2', 6, 0xB136, [X, Y], [X, Y, G[0], G[1]], 0, null],
  ['[2] ranked 3V3', 9, 0xB137, [X, Y, Z], [X, Y, Z, G[0], G[1], G[2]], 0, null],
  ['[3] quick 2V2', 5, 0xB138, [X, Y], [X, Y, G[0], G[1]], 0, null],
  ['[4] ranked team brawl', 4, 0xB139, [null, null, X, Y], [G[0], G[1], X, Y], 1, [3100, 2600, 6100, 5200]],
];
for (const [tag, mt, h, wr, ros, winTeam, sc] of madeUp) {
  const seats = wr.map((s, i) => [s, i]).filter(([s]) => s);
  const S = seats.map(([s, i]) => ({ sid: s, d: start(mt, h, i, ros) }));
  const R = seats.map(([s, i]) => ({ sid: s, d: settle(mt, h, i, ros, winTeam, sc) }));
  const steps = [[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]];
  const key = keyOf(S[0].d), writers = seats.map(([s]) => s), named = ros.filter((s) => writers.indexOf(s) < 0);
  const ranked = (mt & 0xF) === 4 || (mt & 0xF) === 6 || (mt & 0xF) === 9;
  const rs = timeline(steps);
  const at = firstProcessed(rs, key);
  T(tag + ' four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T(tag + ' settles (processed), logged once, counted in that run\'s summary', at >= 0 && NOLOSER_LINE(key).test(rs[at].out) && ROW(rs[at], 1)
    && (outOf(rs).match(new RegExp('no-loser ' + key, 'g')) || []).length === 1, 'processed at run ' + at + ' ' + (rs[Math.max(0, at)] || rs[0]).out.slice(-900));
  T(tag + ' no points and no rating write for anybody', writers.concat(named).every((s) => none(rs, s) && ratingOf(rs, s).length === 0), pts(rs, writers.concat(named)));
  T(tag + ' the named seats stay named-only (Q69): not convicted, not seeded', named.every((s) => leavesOf(last(rs), s) === 0) && /named by the others but never wrote his own record/.test(outOf(rs))
    && !/ seed /.test(outOf(rs)));
  T(tag + ' nobody flagged', writers.concat(named).every((s) => fOf(last(rs), s) === 0), flags(last(rs), writers.concat(named)));
  T(tag + ' no group-decay step: the writers have no repeat-group memory', writers.every((s) => !(last(rs).state.GROUPS_FILE || {})[v.pid(s)]),
    JSON.stringify(last(rs).state.GROUPS_FILE || {}));
  T(tag + ' XP is still credited to the writers (residual)', writers.every((s) => xpOf(rs, s) > 0), JSON.stringify(writers.map((s) => xpOf(rs, s))));
  withMutant('nocheck' + mt, CHECK_AT, '    const noRating = false;', (script) => {
    const m = timeline(steps, script);
    T(tag + ' mutant: the check off -> ' + (ranked ? 'every writer takes the win' : 'the writers\' rating moves'),
      allOk(m, 4) && (ranked ? writers.every((s) => up(m, s)) : writers.every((s) => ratingOf(m, s).length > 0)), pts(m, writers));
  });
}

// ---- [5] the losing team counts somebody: rated as before ----
{
  const mt = 6, RR = [P1, P2, P3, P4];
  // (a) honest: all four write
  {
    const h = 0xC136, S = RR.map((s, i) => ({ sid: s, d: start(mt, h, i, RR) })), R = RR.map((s, i) => ({ sid: s, d: settle(mt, h, i, RR, 0) }));
    const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
    T('[5a] honest 2V2: the winners gain, the losers lose, no Q136 line', allOk(rs, 4) && up(rs, P1) && up(rs, P2) && down(rs, P3) && down(rs, P4) && !/no-loser /.test(outOf(rs)) && ROW(rs[1], 0),
      pts(rs, RR));
  }
  // (b) one writer per team, the teammates named-only
  {
    const h = 0xC137, ros = [X, G[0], Y, G[1]];
    const S = [{ sid: X, d: start(mt, h, 0, ros) }, { sid: Y, d: start(mt, h, 2, ros) }];
    const R = [{ sid: X, d: settle(mt, h, 0, ros, 0) }, { sid: Y, d: settle(mt, h, 2, ros, 0) }];
    const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
    T('[5b] one writer per team: the winner gains, the loser loses (shielded), no Q136 line', allOk(rs, 4) && up(rs, X) && down(rs, Y) && !/no-loser /.test(outOf(rs)), pts(rs, [X, Y]));
  }
  // (c) one loser writes, the other is named-only
  {
    const h = 0xC138, ros = [P1, P2, P3, G[0]];
    const S = [0, 1, 2].map((i) => ({ sid: ros[i], d: start(mt, h, i, ros) })), R = [0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, h, i, ros, 0) }));
    const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
    T('[5c] one loser writes: the winners gain, he loses, no Q136 line', allOk(rs, 4) && up(rs, P1) && up(rs, P2) && down(rs, P3) && none(rs, G[0]) && !/no-loser /.test(outOf(rs)),
      pts(rs, ros));
  }
  // (d) both losers wrote their start and left (no result, no confession)
  {
    const h = 0xC139, S = RR.map((s, i) => ({ sid: s, d: start(mt, h, i, RR) })), R = [0, 1].map((i) => ({ sid: RR[i], d: settle(mt, h, i, RR, 0) }));
    const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [LEAVE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
    T('[5d] both losers left after their start: convicted once the match must be over, the winners gain, no Q136 line',
      allOk(rs, 5) && up(rs, P1) && up(rs, P2) && leavesOf(last(rs), P3) === 1 && leavesOf(last(rs), P4) === 1 && !/no-loser /.test(outOf(rs)),
      pts(rs, RR) + ' leaves ' + JSON.stringify([P3, P4].map((s) => leavesOf(last(rs), s))));
  }
  // (e) one loser confessed (his own word that he left), the other is named-only
  {
    const h = 0xC13A, ros = [P1, P2, P3, G[0]];
    const S = [0, 1, 2].map((i) => ({ sid: ros[i], d: start(mt, h, i, ros) })), R = [0, 1].map((i) => ({ sid: ros[i], d: settle(mt, h, i, ros, 0) }));
    const C = [{ sid: P3, d: confess(mt, h, 2, ros) }];
    const all = S.concat(R, C);
    const rs = timeline([[0, S], [5 * MIN, all], [GRACE, all], [3 * HOUR, all]]);
    T('[5e] one loser confessed: the winners gain, no Q136 line', allOk(rs, 4) && up(rs, P1) && up(rs, P2) && !/no-loser /.test(outOf(rs)), pts(rs, ros));
  }
}

// ---- [6] seen agreeing, then gone: not counted ----
{
  const mt = 6, RR = [P1, P2, P3, P4];
  // (a) the cost case: P2's result is late, so the first settle look waits; the losers' results, seen agreeing then, are
  //     gone by the next look (their next match overwrote their shard rows)
  const ha = 0xD136, Sa = RR.map((s, i) => ({ sid: s, d: start(mt, ha, i, RR) })), Ra = RR.map((s, i) => ({ sid: s, d: settle(mt, ha, i, RR, 0) }));
  const stepsA = [[0, Sa], [5 * MIN, Sa.concat([Ra[0], Ra[2], Ra[3]])], [GRACE - 2 * MIN, Sa.slice(0, 2).concat(Ra.slice(0, 2))], [GRACE, Sa.slice(0, 2).concat(Ra.slice(0, 2))], [3 * HOUR, Sa.slice(0, 2).concat(Ra.slice(0, 2))]];
  const keyA = keyOf(Sa[0].d);
  // (b) a third account: Z writes the loss at seat 2 while the group waits for the named-only seat 3, then withdraws it
  const hb = 0xD137, ros = [X, Y, Z, G[0]];
  const Sb = [0, 1, 2].map((i) => ({ sid: ros[i], d: start(mt, hb, i, ros) })), Rb = [0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, hb, i, ros, 0) }));
  const stepsB = [[0, Sb], [5 * MIN, Sb.concat(Rb)], [GRACE, Sb.slice(0, 2).concat(Rb.slice(0, 2))], [3 * HOUR, Sb.slice(0, 2).concat(Rb.slice(0, 2))]];
  const keyB = keyOf(Sb[0].d);
  const rsA = timeline(stepsA), rsB = timeline(stepsB);
  T('[6a] runs exit 0', allOk(rsA, 5), last(rsA).out.slice(-800));
  T('[6a] the first look waits (P2\'s result missing), the losers seen agreeing', /absent-hold /.test(rsA[1].out) && !processedOf(rsA[1]).has(keyA), rsA[1].out.slice(-600));
  T('[6a] the losers gone at the settle: not leavers, not counted -> settled unrated (the cost case), logged',
    firstProcessed(rsA, keyA) >= 0 && NOLOSER_LINE(keyA).test(outOf(rsA)) && RR.every((s) => none(rsA, s)) && /record gone but seen agreeing earlier/.test(outOf(rsA))
    && RR.every((s) => leavesOf(last(rsA), s) === 0), pts(rsA, RR) + ' ' + outOf(rsA).slice(-900));
  T('[6b] runs exit 0', allOk(rsB, 4), last(rsB).out.slice(-800));
  T('[6b] Z seen agreeing while the named-only seat holds the group, then withdrawn: settled unrated, Z not convicted, nobody flagged',
    /absent-hold /.test(rsB[1].out) && firstProcessed(rsB, keyB) >= 0 && NOLOSER_LINE(keyB).test(outOf(rsB)) && [X, Y, Z].every((s) => none(rsB, s))
    && leavesOf(last(rsB), Z) === 0 && [X, Y, Z].every((s) => fOf(last(rsB), s) === 0), pts(rsB, [X, Y, Z]) + ' ' + flags(last(rsB), [X, Y, Z]));
  withMutant('agreed', CALL_AT, AGREED_IN, (script) => {
    const mA = timeline(stepsA, script), mB = timeline(stepsB, script);
    T('[6] mutant: seats seen agreeing counted -> the winners take the win in both', allOk(mA, 5) && allOk(mB, 4) && up(mA, P1) && up(mA, P2) && up(mB, X) && up(mB, Y),
      pts(mA, [P1, P2]) + ' ' + pts(mB, [X, Y]));
  });
}

// ---- [7] FFA is not a team match: rated as before ----
{
  const h = 0xE136, ros = [X, Y, G[0], G[1]];
  const S = [0, 1].map((i) => ({ sid: ros[i], d: ffaStart(h, i, ros) })), R = [0, 1].map((i) => ({ sid: ros[i], d: ffaSettle(h, i, ros) }));
  const rs = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]]);
  T('[7] ranked 4-player FFA with two named-only seats: one up, one down, no Q136 line', allOk(rs, 4) && up(rs, X) && down(rs, Y) && !/no-loser /.test(outOf(rs)), pts(rs, [X, Y]));
}

// ---- [8] writers with no points row yet (first settle this season): an unrated key seeds nobody ----
{
  const mt = 6, NX = SID(297), NY = SID(298), RR = [SID(301), SID(302), SID(303), SID(304)];   // none of them on the points board
  const hf = 0xF136, ros = [NX, NY, G[0], G[1]];
  const Sf = [0, 1].map((i) => ({ sid: ros[i], d: start(mt, hf, i, ros) })), Rf = [0, 1].map((i) => ({ sid: ros[i], d: settle(mt, hf, i, ros, 0) }));
  const hh = 0xF137, Sh = RR.map((s, i) => ({ sid: s, d: start(mt, hh, i, RR) })), Rh = RR.map((s, i) => ({ sid: s, d: settle(mt, hh, i, RR, 0) }));
  const rf = timeline([[0, Sf], [5 * MIN, Sf.concat(Rf)], [GRACE, Sf.concat(Rf)], [3 * HOUR, Sf.concat(Rf)]]);
  const rh = timeline([[0, Sh], [5 * MIN, Sh.concat(Rh)], [GRACE, Sh.concat(Rh)], [3 * HOUR, Sh.concat(Rh)]]);
  T('[8] made-up 2V2 by two accounts with no points row: settled unrated, no seed line, no points for either',
    allOk(rf, 4) && NOLOSER_LINE(keyOf(Sf[0].d)).test(outOf(rf)) && !/ seed /.test(outOf(rf)) && none(rf, NX) && none(rf, NY), pts(rf, [NX, NY]) + ' ' + outOf(rf).slice(-600));
  T('[8] control: an honest 2V2 of four such accounts seeds all four and rates them', allOk(rh, 4) && (outOf(rh).match(/  seed [^\n]*first settle this season/g) || []).length === 4
    && RR.every((s) => ptsIn(rh, s).length >= 1) && !/no-loser /.test(outOf(rh)), pts(rh, RR));
}

// ---- [9] a made-up key and an honest key settle in the same run: only the honest group is remembered ----
{
  const mt = 6, RR = [P1, P2, P3, P4];
  const hf = 0xF138, ros = [X, Y, G[0], G[1]];
  const Sf = [0, 1].map((i) => ({ sid: ros[i], d: start(mt, hf, i, ros) })), Rf = [0, 1].map((i) => ({ sid: ros[i], d: settle(mt, hf, i, ros, 0) }));
  const hh = 0xF139, Sh = RR.map((s, i) => ({ sid: s, d: start(mt, hh, i, RR) })), Rh = RR.map((s, i) => ({ sid: s, d: settle(mt, hh, i, RR, 0) }));
  const S = Sf.concat(Sh), all = S.concat(Rf, Rh);   // P4's result is late, so both keys wait out the absent-seat grace and settle together
  const rs = timeline([[0, S], [5 * MIN, S.concat(Rf, Rh.slice(0, 3))], [GRACE, all], [3 * HOUR, all]]);
  const at = firstProcessed(rs, keyOf(Sf[0].d)), gm = (rs[Math.max(0, at)] || rs[0]).state.GROUPS_FILE || {};
  T('[9] both keys settle in one run: the made-up one unrated, the honest one rated', allOk(rs, 4) && at >= 0 && at === firstProcessed(rs, keyOf(Sh[0].d))
    && NOLOSER_LINE(keyOf(Sf[0].d)).test(rs[at].out) && none(rs, X) && none(rs, Y) && up(rs, P1) && down(rs, P3), 'at ' + at + ' ' + pts(rs, [X, Y, P1, P3]));
  T('[9] the group-decay memory saved that run holds the honest players only', RR.every((s) => gm[v.pid(s)]) && [X, Y].every((s) => !gm[v.pid(s)]), JSON.stringify(gm));
}

// ---- [10] (trees with the Q56 team dissent) a team-gamble dissent settle: an excused dissenter does not count ----
//   X / Y (seats 0 / 1, X hosting) win; P5 (seat 2) and P6 (seat 3) both write the rank-0 refusal. P5 is due (his second
//   strike in the window, the first one under an unrelated host), so the match settles from X / Y; P6 (first strike) is
//   excused. (a) P5 wrote no start and his refusal is gone by the settle (withdrawn): named by the others only (Q69, not
//   convicted), P6 excused (never convicted) -- nobody on the losing team pays -> settled unrated. (b) control: P5's
//   refusal still up at the settle -> he is convicted, the winners are rated against the losers' pre-match ratings (Q56).
//   mutant: excused dissenters counted -> (a) rates the winners
if (HAS_Q56) {
  const mt = 6, RR = [X, Y, P5, P6];
  const prior = { SIGNALS_FILE: { players: {}, flagged: {}, t2ld: { [v.pid(P5)]: [{ m: 'earlier', t: Date.now() - 86400000, h: v.pid(G[4]), o: 1, x: [v.pid(G[4]), v.pid(G[5])] }] } } };
  const caseOf = (h, keepP5) => {
    const S = [0, 1, 3].map((i) => ({ sid: RR[i], d: start(mt, h, i, RR) }));   // P5 writes no start
    const R = [0, 1].map((i) => ({ sid: RR[i], d: settle(mt, h, i, RR, 0) }));
    const D5 = { sid: P5, d: refuse(mt, h, 2, RR) }, D6 = { sid: P6, d: refuse(mt, h, 3, RR) };
    const after = S.concat(R, [D6], keepP5 ? [D5] : []);
    return { key: keyOf(S[0].d), steps: [[0, S], [5 * MIN, S.concat(R, [D5, D6])], [GRACE, after], [3 * HOUR, after]] };
  };
  const a = caseOf(0xF13A, false), b = caseOf(0xF13B, true);
  const lv = (rs, key) => (((last(rs).state.SIGNALS_FILE || {}).t2lv || {})[key]) || {};
  const ra = timeline(a.steps, null, prior), rb = timeline(b.steps, null, prior);
  T('[10a] runs exit 0', allOk(ra, 4), last(ra).out.slice(-800));
  T('[10a] the dissent verdict settles (P5 due), P6 excused', lv(ra, a.key).v === 'settle' && (lv(ra, a.key).ex || []).indexOf(v.pid(P6)) >= 0
    && /team2 team dissent [^\n]*2 dissenters -> match verdict settle/.test(outOf(ra)), JSON.stringify(lv(ra, a.key)));
  T('[10a] P5 gone at the settle (named only), P6 excused: nobody on the losing team counts -> settled unrated, logged',
    firstProcessed(ra, a.key) >= 0 && NOLOSER_LINE(a.key).test(outOf(ra)) && RR.every((s) => none(ra, s) && ratingOf(ra, s).length === 0)
    && /leaver [^\n]*seat 2 = [^\n]*named by the others but never wrote his own record/.test(outOf(ra)) && /leaver [^\n]*seat 3 = [^\n]*excused, no conviction/.test(outOf(ra)),
    pts(ra, RR) + ' ' + outOf(ra).slice(-900));
  T('[10a] neither loser convicted (P5: named only, pre-existing Q69; P6: excused)', leavesOf(last(ra), P5) === 0 && leavesOf(last(ra), P6) === 0);
  T('[10b] control runs exit 0', allOk(rb, 4), last(rb).out.slice(-800));
  T('[10b] control: P5\'s refusal still up -> convicted, the winners rated against the absent team (Q56), no Q136 line',
    firstProcessed(rb, b.key) >= 0 && !/no-loser /.test(outOf(rb)) && up(rb, X) && up(rb, Y) && leavesOf(last(rb), P5) === 1 && leavesOf(last(rb), P6) === 0
    && /whole team 1 absent -> rated against its 2 pre-match rating/.test(outOf(rb)), pts(rb, RR) + ' ' + outOf(rb).slice(-900));
  withMutant('excused', CALL_AT, EXCUSED_IN, (script) => {
    const m = timeline(a.steps, script, prior);
    T('[10] mutant: excused dissenters counted -> the winners take the win in (a)', allOk(m, 4) && up(m, X) && up(m, Y), pts(m, [X, Y]));
  });
} else console.log('  skip  [10] this tree has no Q56 team dissent');

console.log(failN ? '=== FAIL -- ' + failN + ' fail (team-loss-side) ===' : '=== PASS -- 0 fail (team-loss-side) ===');
process.exit(failN ? 1 : 0);
