'use strict';
// Q167 (cloud audit 2026-10, found by the Q160 rework): a ranked team match whose losing team (or part of it) wrote the
//   level-1 start and left. The winners were rated against nobody (the whole losing team gone: the ordinal fallback between
//   the winners, the ranked rating not moving) or against the losers left on the court only (a 2-on-1 they were expected to
//   win), and the mismatch check read the present only: two grandmasters whose two zero-points opponents left took the full
//   team win (+10 points) every match, for ever. Now the losing team's convicted leavers (a confessed leave counts, a Q56
//   excused dissenter does not) stand in at their pre-match ratings in the winners' update (stored and ranked rating), and
//   teamLpPlan reads them in the mismatch of an expected win (absent argument). The present losers keep the update against
//   the winners only; the leavers' stored rating never moves, their ranked rating takes the loss of the full team (Q167
//   rework: else two pairs of zero-points accounts taking turns walked each other's ranked rating up). A losing seat seen
//   agreeing whose record is gone at the settle (Q149: finished) stands in the same way (Q167 rework: write the loss,
//   then overwrite it with an empty record).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/team-loss-side.js):
//   [0] wiring pins (a failure here is a pin, not behaviour)
//   [1] ranked 2V2, two grandmasters (hidden 30 / 2) beat two zero-points accounts (no rating yet) that wrote the start and
//       left: logged, the winners' stored and ranked rating = the update against the two leavers at their pre-match rating,
//       the leavers' stored rating never moves, their ranked rating = their side of that update, the grandmasters take no
//       points (an expected win at grandmaster, compression 0)
//   [2] the same, one loser stays and writes his loss: the winners rated against him and the leaver, he against the
//       winners only (the update before Q167), the leaver's stored rating never moves, his ranked rating takes the loss
//   [3] a leaver on the WINNING team is not a ghost: rated as before (the present winner against the present losers)
//   [4] quick 2V2 (no points, no ranked rating): the stored rating takes the same update; no points write
//   [5] (trees with the Q56 team dissent) ranked 3v3 team-gamble dissent, two refusers and their third teammate agreeing,
//       one refuser due (the leaver), one fresh (excused): only the due one stands in
//   [6] (trees with the Q56 team dissent) the whole other team refuses, both due: the Q56 path, no Q167 line
//   [7] (trees with the Q56 team dissent) the grandmasters' two zero-points opponents both refuse the team gamble, one
//       of them due: the Q56 path rates as before, the due refuser counts toward the mismatch, no points for the grandmasters
//   [8] a grandmaster and a gold friend, their two zero-points opponents leave at the start: the same points as when the
//       two opponents stay and lose (the strong-team factor of the base, whatever it is, written once)
//   [9] the leavers' stored and ranked ratings differ: the mismatch and the winners' ranked update read the ranked one,
//       the winners' stored update the stored one
//   [10] ranked 3v3, the whole winning team gone and one loser gone: the winners' side is empty, nobody stands in (no
//       update against an empty team; with Q62 merged that side is filled with the absent winners' pre-match ratings, and
//       still nobody stands in)
//   [12] (trees with the Q56 team dissent) the whole WINNING team refuses the team gamble, both due: the Q56 path, and
//       nothing of Q167 touches the refusers (they won)
//   [11] one loser writes his loss, the other writes his loss too and then overwrites it with an empty record before the
//       settle (seen agreeing, Q149: not a leaver): he stands in like a leaver, no points for the grandmasters
//   [13] the same write-then-overwrite, every present player level and the overwriting loser a fresh account: the winners
//       take the points of a normal finish; the loser who stayed keeps the present-only reading of a loss (the strong
//       side's mild upset factor is the winners' case only, and a seat seen agreeing is no leave: no teammate shield)
//   [14] ranked 2V2, one loser stays, the other leaves and confesses (an abandon confession counts as his own record):
//       he stands in like a leaver who did not confess, and his leave is counted once
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const tsm = require(path.join(__dirname, '..', 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const HAS_Q56 = /const t2ex = new Set\(/.test(SRC);   // the Q56 team-gamble dissent (excused dissenters) is merged
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
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
function runCron(boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaver-ghost-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) and the
      //   points writes read below would go elsewhere -- every test runs before each production reconcile, so a
      //   date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every stored
//   instant moves back instead), as in test/team-loss-side.js
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  if (sg && sg.t2ld) for (const k of Object.keys(sg.t2ld)) for (const e of sg.t2ld[k]) if (e) e.t -= ms;
  if (sg && sg.t2lv) for (const k of Object.keys(sg.t2lv)) if (sg.t2lv[k]) sg.t2lv[k].t -= ms;
  return files;
}
const RATING = 6, POINTS = 7;
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const writesTo = (rs, boardId, sid) => [].concat(...rs.map(r => posts(r, boardId).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]))));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const skillOf = (r, sid) => ((r.state.SKILL_FILE || {})[v.pid(sid)]) || null;

const SID = (n) => '7656119801' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// start-and-leave records (result-reporter wire form, as in test/team-loss-side.js): magic, ver, mt, hash, seed, seat, rank,
//   (progress<<1)|win, pc, dur, scores, disp, roster
const SC = { 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : SC[pc][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const teamRank = (seat, winTeam) => { const team = ((seat / 2) | 0) & 1; return (team === winTeam ? 1 : 3) + (seat % 2); };
const settle = (mt, hash, seat, ros) => rec(0xB1, mt, hash, seat, teamRank(seat, 0), (((seat / 2) | 0) & 1) === 0, ros);
const start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard); pts: { sid: points }
function boardsWith(recs, pts) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: Object.keys(pts).map(s => ({ steamID: s, score: pts[s] })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const LEAVE = v.LEAVE_CONFIRM_MS + MIN;
// one 2V2 match (seats 0 / 1 = team A wins, 2 / 3 = team B): every seat writes its start, `res` seats write their result
function startLeave(mt, hash, ros, res, pts, skill0) {
  const S = ros.map((s, i) => ({ sid: s, d: start(mt, hash, i, ros) }));
  const R = res.map((i) => ({ sid: ros[i], d: settle(mt, hash, i, ros) }));
  const all = S.concat(R);
  const steps = [[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]];
  const rs = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : { SKILL_FILE: skill0 || {} });
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, key: keyOf(S[0].d), last: rs[rs.length - 1], out: rs.map(r => r.out).join('') };
}
const near = (a, b) => Math.abs(a - b) < 1e-9;
// the update the test expects: tsm.updateTeamMatch of the winners against `losers` ({ id, mu, sigma }); returns { id: { mu, sigma } }
function expect(win, losers) {
  const o = {};
  for (const r of tsm.updateTeamMatch([{ players: win, rank: 1 }, { players: losers, rank: 2 }])) o[r.id] = r;
  return o;
}
const P = (sid, sk) => ({ id: sid, mu: (sk || tsm.DEFAULTS).mu, sigma: (sk || tsm.DEFAULTS).sigma });
const storedIs = (r, sid, e) => { const s = skillOf(r, sid); return !!(s && e && near(s.mu, e.mu) && near(s.sigma, e.sigma)); };
const rankedIs = (r, sid, e) => { const s = skillOf(r, sid); return !!(s && e && Number.isFinite(s.rm) && near(s.rm, e.mu) && near(s.rv, e.sigma)); };
// a leaver: stored rating as it was (`stored`, or the defaults when he had none), ranked rating = `e`
const leaverIs = (r, sid, e, stored) => { const s = skillOf(r, sid), st = stored || tsm.DEFAULTS;
  return !!(s && near(s.mu, st.mu) && near(s.sigma, st.sigma) && e && near(s.rm, e.mu) && near(s.rv, e.sigma)); };
const RANKED_LINE = (key, sid) => new RegExp('leaver-ranked ' + key + ': ' + v.pid(sid).slice(0, 8) + ' ranked rating [0-9]+ -> [0-9]+ \\(the loss of the full team; stored rating unchanged, Q167\\)');
const show = (r, sids) => JSON.stringify(sids.map(s => { const k = skillOf(r, s); return k ? [k.mu, k.sigma, k.rm, k.rv] : null; }));
const GHOST_LINE = (key, n, seats) => new RegExp('leaver-ghost ' + key + ': team 0 rated against team 1 with its ' + n + ' leaver\\(s\\) at their pre-match rating \\(' + seats + '\\)[^\n]*\\(Q167\\)');
// Q62 (rating against a whole absent losing team for any team match) already rates the stored rating there and logs it
const Q62_LINE = (key) => new RegExp('team rating ' + key + ': whole team 1 absent -> rated against its 2 pre-match rating');

console.log('=== a losing-side leaver counts at his pre-match rating for the winners (Q167) ===');

// ---- [0] wiring pins ----
{
  T('[0] the helper rates the winners against the whole losing team, the present losers against the winners only',
    /function leaverGhostUpdate\(win, here, ghosts\)/.test(SRC) && /\{ players: here\.concat\(ghosts\), rank: 2 \}\]\)\.filter\(\(r\) => winIds\.has\(r\.id\)\)/.test(SRC)
    && /\{ players: here, rank: 2 \}\]\)\.filter\(\(r\) => !winIds\.has\(r\.id\)\)/.test(SRC));
  T('[0] only the losing team\'s leavers stand in' + (HAS_Q56 ? ', a Q56 excused dissenter not' : ''),
    HAS_Q56 ? /if \(teamOfSeat\(x\.seat, _mts\) === 1 - winTeam && !t2ex\.has\(pid\(String\(x\.steamID\)\)\)\) ghostLoss\.push\(x\);/.test(SRC)
      : /if \(teamOfSeat\(x\.seat, _mts\) === 1 - winTeam\) ghostLoss\.push\(x\);/.test(SRC));
  T('[0] the ranked rating takes the same update', /playedOut = leaverGhostUpdate\(sd\[winT\], sd\[1 - winT\], gR\);/.test(SRC));
  T('[0] a losing seat seen agreeing whose record is gone stands in too', /for \(const x of leavers0\.concat\(agreedAbs\)\) if \(teamOfSeat\(x\.seat, _mts\) === 1 - winTeam/.test(SRC)
    && /agreedSeats\.push\(x\.seat\);\n      agreedAbs\.push\(x\);/.test(SRC));
  T('[0] the absent losers\' ranked rating takes their side of the full-team update, the stored one never',
    /\{ players: sd\[1 - winT\]\.concat\(gR\), rank: 2 \}\]\)\) if \(gIds\.has\(o\.id\)\) ghostRanked\.push\(o\);/.test(SRC)
    && /skill\[k\] = Object\.assign\(\{\}, sk, \{ rm: o\.mu, rv: o\.sigma \}\);/.test(SRC));
  T('[0] only with the winners present (a whole absent winning team filled by Q62 does not count)', /if \(sides\[winTeam\]\.length && empty !== winTeam\) \{/.test(SRC));
  T('[0] the points plan reads the leavers in the mismatch of an expected win only', /teamLpPlan\(planIn, matchType, scores, [^\n]*, t2Win, absentIn\)/.test(SRC)
    && /\} else if \(\(mismatch && tAvgMmr > mean\) \|\| \(won && mismatchA && tAvgMmr > meanA\)\) \{/.test(SRC));
}

const X = SID(1), Y = SID(2), Z0 = SID(3), Z1 = SID(4);
const GM = { mu: 30, sigma: 2 };   // display rating 1960 against 1000 for a fresh account: more than the 400 mismatch line
const GMSK = { [v.pid(X)]: { mu: GM.mu, sigma: GM.sigma }, [v.pid(Y)]: { mu: GM.mu, sigma: GM.sigma } };
const GMPTS = { [X]: 8200, [Y]: 8200, [Z0]: 0, [Z1]: 0 };

// ---- [1] ranked 2V2, the whole losing team wrote the start and left ----
{
  const ros = [X, Y, Z0, Z1];
  const m = startLeave(6, 0xE167, ros, [0, 1], GMPTS, GMSK);
  const e = expect([P(X, GM), P(Y, GM)], [P(Z0), P(Z1)]);
  T('[1] five runs exit 0, settled, both losers convicted', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && leavesOf(m.last, Z0) === 1 && leavesOf(m.last, Z1) === 1, m.last.out.slice(-800));
  T('[1] logged (the Q167 line, or the Q62 whole-team line where Q62 already rated the stored rating)', GHOST_LINE(m.key, 2, 'seat 2, seat 3').test(m.out) || Q62_LINE(m.key).test(m.out), m.out.slice(-1200));
  T('[1] the winners\' stored rating = the update against the two leavers at their pre-match rating', storedIs(m.last, X, e[X]) && storedIs(m.last, Y, e[Y]),
    show(m.last, [X, Y]) + ' want ' + JSON.stringify([e[X], e[Y]]));
  T('[1] ... their ranked rating too', rankedIs(m.last, X, e[X]) && rankedIs(m.last, Y, e[Y]), show(m.last, [X, Y]));
  T('[1] the leavers\' stored rating never moves, their ranked rating = their side of that update', leaverIs(m.last, Z0, e[Z0]) && leaverIs(m.last, Z1, e[Z1])
    && writesTo(m.rs, RATING, Z0).length === 0 && writesTo(m.rs, RATING, Z1).length === 0 && RANKED_LINE(m.key, Z0).test(m.out),
    show(m.last, [Z0, Z1]) + ' want ranked ' + JSON.stringify([e[Z0], e[Z1]]));
  T('[1] the grandmasters take no points (an expected win, compressed at the team-average tier: grandmaster, 0)', [X, Y].every(s => writesTo(m.rs, POINTS, s).every(p => p <= 8200)),
    JSON.stringify([X, Y].map(s => writesTo(m.rs, POINTS, s))));
}

// ---- [2] ranked 2V2, one loser stays and writes his loss, the other wrote the start and left ----
{
  const ros = [X, Y, Z0, Z1];
  const m = startLeave(6, 0xE168, ros, [0, 1, 2], GMPTS, GMSK);
  const e = expect([P(X, GM), P(Y, GM)], [P(Z0), P(Z1)]);
  const own = expect([P(X, GM), P(Y, GM)], [P(Z0)]);
  T('[2] five runs exit 0, settled, the one who left convicted', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && leavesOf(m.last, Z1) === 1 && leavesOf(m.last, Z0) === 0, m.last.out.slice(-800));
  T('[2] logged: one leaver stands in', GHOST_LINE(m.key, 1, 'seat 3').test(m.out), m.out.slice(-1200));
  T('[2] the winners rated against the loser who stayed and the leaver', storedIs(m.last, X, e[X]) && storedIs(m.last, Y, e[Y]) && rankedIs(m.last, X, e[X]) && rankedIs(m.last, Y, e[Y]),
    show(m.last, [X, Y]) + ' want ' + JSON.stringify([e[X], e[Y]]));
  T('[2] the loser who stayed rated against the winners only (as before Q167)', storedIs(m.last, Z0, own[Z0]) && rankedIs(m.last, Z0, own[Z0]),
    show(m.last, [Z0]) + ' want ' + JSON.stringify(own[Z0]));
  T('[2] the leaver\'s stored rating never moves, his ranked rating takes the loss of the full team', leaverIs(m.last, Z1, e[Z1]) && writesTo(m.rs, RATING, Z1).length === 0,
    show(m.last, [Z1]) + ' want ranked ' + JSON.stringify(e[Z1]));
}

const H1 = SID(11), H2 = SID(12), H3 = SID(13), H4 = SID(14);
const GOLD = { mu: 28, sigma: 3 };
const HSK = {}; for (const s of [H1, H2, H3, H4]) HSK[v.pid(s)] = { mu: GOLD.mu, sigma: GOLD.sigma };
const HPTS = { [H1]: 2500, [H2]: 2500, [H3]: 2500, [H4]: 2500 };

// ---- [3] a leaver on the winning team is not a ghost ----
{
  const ros = [H1, H2, H3, H4];
  const m = startLeave(6, 0xE169, ros, [0, 2, 3], HPTS, HSK);
  const e = expect([P(H1, GOLD)], [P(H3, GOLD), P(H4, GOLD)]);
  T('[3] five runs exit 0, settled, the winner who left convicted', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && leavesOf(m.last, H2) === 1, m.last.out.slice(-800));
  T('[3] no Q167 line', !/leaver-ghost /.test(m.out));
  T('[3] rated as before: the present winner against the present losers', storedIs(m.last, H1, e[H1]) && storedIs(m.last, H3, e[H3]) && storedIs(m.last, H4, e[H4])
    && rankedIs(m.last, H1, e[H1]) && rankedIs(m.last, H3, e[H3]), show(m.last, [H1, H3, H4]) + ' want ' + JSON.stringify([e[H1], e[H3], e[H4]]));
}

// ---- [4] quick 2V2: the stored rating takes the same update, no points ----
{
  const ros = [H1, H2, H3, H4];
  const m = startLeave(5, 0xE16A, ros, [0, 1, 2], HPTS, HSK);
  const e = expect([P(H1, GOLD), P(H2, GOLD)], [P(H3, GOLD), P(H4, GOLD)]);
  const own = expect([P(H1, GOLD), P(H2, GOLD)], [P(H3, GOLD)]);
  T('[4] five runs exit 0, settled, the one who left convicted', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && leavesOf(m.last, H4) === 1, m.last.out.slice(-800));
  T('[4] logged: one leaver stands in', GHOST_LINE(m.key, 1, 'seat 3').test(m.out), m.out.slice(-1200));
  T('[4] the winners\' stored rating against the loser who stayed and the leaver, his against the winners only', storedIs(m.last, H1, e[H1]) && storedIs(m.last, H2, e[H2])
    && storedIs(m.last, H3, own[H3]), show(m.last, [H1, H2, H3]));
  T('[4] no points write (quick)', [H1, H2, H3, H4].every(s => writesTo(m.rs, POINTS, s).length === 0));
}

// ---- [5] / [6] team-gamble dissent (Q56) ----
if (HAS_Q56) {
  const A = SID(21), B = SID(22), C = SID(23), D = SID(24), E = SID(25), F = SID(26), G = SID(27), H = SID(28);
  // mode-2 settle record (test/team2-team-dissent.js): win = team 0, ranks by the winning-block convention; o.rank overrides
  function t2(mt, hash, seat, roster, o) {
    o = o || {};
    const pc = roster.length, ts = pc / 2;
    const scores = roster.map((s, i) => 6000 - 500 * i);
    const myTeam = (seat / ts) | 0, inBlock = seat % ts;
    const rank = o.rank != null ? o.rank : ((myTeam === 0) ? 1 + inBlock : ts + 1 + inBlock);
    const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (myTeam === 0 ? 1 : 0), pc, 900].concat(scores, [0]);
    for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
    return d;
  }
  const match = (mt, hash, roster, dis) => roster.map((sid, seat) => ({ sid, d: t2(mt, hash, seat, roster, (dis || {})[seat]) }));
  const startOf = (mt, roster, ago) => { const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); }); return { t0: Date.now() - ago, mt, roster: ros, settled: [] }; };
  const strikeIn = (m, ago, h, x) => ({ m, t: Date.now() - ago, h: v.pid(h), o: 1, x: x.map(s => v.pid(s)) });
  const FLOOR = v.SANITY.MIN_START_AGE_MS;
  // a group missing a seat's record settles one absent-seat grace later (cloud audit R1-B2-04): follow up with that run
  const runSettle = (boards, files) => {
    const r = runCron(boards, files);
    return (/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS) ? [r, runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000))] : [r];
  };
  const pts = {}; for (const s of [A, B, C, D, E, F, G, H]) pts[s] = 2000;
  // [5] ranked 3v3: E (second strike) and F (first) refuse, their teammate D agrees
  {
    const R6 = [A, B, C, D, E, F];
    const recs = match(9, 0xE16B, R6, { 4: { rank: 0 }, 5: { rank: 0 } });
    const key = keyOf(recs[0].d);
    const rs = runSettle(boardsWith(recs, pts), { STARTS_FILE: { [key]: startOf(9, R6, FLOOR + 5 * MIN) },
      SIGNALS_FILE: { players: {}, flagged: {}, t2ld: { [v.pid(E)]: [strikeIn('earlier', 86400000, G, [G, H])] } } });
    const r = rs[rs.length - 1], out = rs.map(x => x.out).join('');
    const e = expect([P(A), P(B), P(C)], [P(D), P(E)]);
    const own = expect([P(A), P(B), P(C)], [P(D)]);
    T('[5] runs exit 0, settled; E (due) the leaver, F excused', rs.every(x => x.code === 0) && processedOf(r).has(key) && leavesOf(r, E) === 1 && leavesOf(r, F) === 0, out.slice(-800));
    T('[5] logged: E stands in, F (excused) does not', GHOST_LINE(key, 1, 'seat 4').test(out), out.slice(-1200));
    T('[5] the winners rated against D and E, D against the winners only', [A, B, C].every(s => storedIs(r, s, e[s]) && rankedIs(r, s, e[s])) && storedIs(r, D, own[D]),
      show(r, [A, B, C, D]));
    T('[5] E\'s stored rating never moves, his ranked rating takes the loss of the full team; F (excused) never moves', leaverIs(r, E, e[E]) && !skillOf(r, F),
      show(r, [E, F]) + ' want ranked ' + JSON.stringify(e[E]));
  }
  // [6] ranked 2v2, the whole other team refuses, both due: the Q56 whole-team path, unchanged
  {
    const R4 = [A, B, C, D];
    const recs = match(6, 0xE16C, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
    const key = keyOf(recs[0].d);
    const t2ld = { [v.pid(C)]: [strikeIn('earlier', 86400000, G, [G, H])], [v.pid(D)]: [strikeIn('earlier', 86400000, G, [G, H])] };
    const rs = runSettle(boardsWith(recs, pts), { STARTS_FILE: { [key]: startOf(6, R4, FLOOR + 5 * MIN) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld } });
    const r = rs[rs.length - 1], out = rs.map(x => x.out).join('');
    const e = expect([P(A), P(B)], [P(C), P(D)]);
    T('[6] runs exit 0, settled, both refusers the leavers', rs.every(x => x.code === 0) && processedOf(r).has(key) && leavesOf(r, C) === 1 && leavesOf(r, D) === 1, out.slice(-800));
    T('[6] the Q56 line, no Q167 line', /whole team 1 absent -> rated against its 2 pre-match rating/.test(out) && !/leaver-ghost /.test(out), out.slice(-1200));
    T('[6] the winners rated against the absent team (Q56 unchanged)', storedIs(r, A, e[A]) && storedIs(r, B, e[B]) && rankedIs(r, A, e[A]), show(r, [A, B]));
    T('[6] both refusers (due): stored rating never moves, ranked rating takes the loss of that update', leaverIs(r, C, e[C]) && leaverIs(r, D, e[D]),
      show(r, [C, D]) + ' want ranked ' + JSON.stringify([e[C], e[D]]));
  }
  // [7] ranked 2v2, the grandmasters' two zero-points opponents both refuse the team gamble, one of them due: the Q56
  //   whole-team path rates the stored and ranked rating as before; the due refuser (the leaver) counts toward the
  //   mismatch of the expected win, so the grandmasters take no points (before: the present-only reading, +10 each)
  {
    const R4 = [X, Y, Z0, Z1];
    const recs = match(6, 0xE16D, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
    const key = keyOf(recs[0].d);
    const t2ld = { [v.pid(Z0)]: [strikeIn('earlier', 86400000, G, [G, H])] };
    const rs = runSettle(boardsWith(recs, GMPTS), { SKILL_FILE: GMSK, STARTS_FILE: { [key]: startOf(6, R4, FLOOR + 5 * MIN) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld } });
    const r = rs[rs.length - 1], out = rs.map(x => x.out).join('');
    const e = expect([P(X, GM), P(Y, GM)], [P(Z0), P(Z1)]);
    T('[7] runs exit 0, settled; Z0 (due) the leaver, Z1 excused', rs.every(x => x.code === 0) && processedOf(r).has(key) && leavesOf(r, Z0) === 1 && leavesOf(r, Z1) === 0, out.slice(-800));
    T('[7] the Q56 line, no Q167 line', /whole team 1 absent -> rated against its 2 pre-match rating/.test(out) && !/leaver-ghost /.test(out), out.slice(-1200));
    T('[7] the winners rated against both refusers at their pre-match rating (Q56 unchanged)', storedIs(r, X, e[X]) && storedIs(r, Y, e[Y]) && rankedIs(r, X, e[X]) && rankedIs(r, Y, e[Y]),
      show(r, [X, Y]) + ' want ' + JSON.stringify([e[X], e[Y]]));
    T('[7] the grandmasters take no points (the due refuser counts toward the mismatch)', [X, Y].every(s => writesTo(rs, POINTS, s).every(p => p <= 8200)),
      JSON.stringify([X, Y].map(s => writesTo(rs, POINTS, s))));
    T('[7] Z0 (due) takes the ranked loss of that update, Z1 (excused) never moves', leaverIs(r, Z0, e[Z0]) && !skillOf(r, Z1), show(r, [Z0, Z1]));
  }
  // [12] ranked 2v2, the whole WINNING team refuses the team gamble, both due (the host's team says it lost): the Q56 path
  //   rates the present losers against it as before; the refusers won, so no Q167 rating (stored or ranked) touches them
  {
    const R4 = [A, B, C, D];
    const recs = match(6, 0xE16E, R4, { 0: { rank: 3 }, 1: { rank: 4 }, 2: { rank: 0 }, 3: { rank: 0 } });   // A B (host team) say they lost
    const key = keyOf(recs[0].d);
    const t2ld = { [v.pid(C)]: [strikeIn('earlier', 86400000, G, [G, H])], [v.pid(D)]: [strikeIn('earlier', 86400000, G, [G, H])] };
    const rs = runSettle(boardsWith(recs, pts), { STARTS_FILE: { [key]: startOf(6, R4, FLOOR + 5 * MIN) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld } });
    const r = rs[rs.length - 1], out = rs.map(x => x.out).join('');
    T('[12] runs exit 0, settled, both refusers the leavers', rs.every(x => x.code === 0) && processedOf(r).has(key) && leavesOf(r, C) === 1 && leavesOf(r, D) === 1, out.slice(-800));
    T('[12] the Q56 line; no Q167 line of either kind', /whole team 1 absent -> rated against its 2 pre-match rating/.test(out) && !/leaver-ghost /.test(out) && !/leaver-ranked /.test(out), out.slice(-1200));
    T('[12] the refusers (on the winning side) keep no rating row', !skillOf(r, C) && !skillOf(r, D), show(r, [C, D]));
  }
} else console.log('  (no Q56 team dissent on this tree: [5] / [6] / [7] / [12] skipped)');

// runs the cron over `steps` ([ms since the run before, recs]) from `skill0`; returns as startLeave
function runSteps(steps, pts, skill0) {
  const rs = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : { SKILL_FILE: skill0 || {} });
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], out: rs.map(r => r.out).join('') };
}
const finiteSkills = (r) => Object.keys(r.state.SKILL_FILE || {}).every((k) => { const x = r.state.SKILL_FILE[k];
  return ['mu', 'sigma', 'rm', 'rv'].every((f) => x[f] === undefined || Number.isFinite(x[f])); });
const lastPts = (m, sid) => { const w = writesTo(m.rs, POINTS, sid); return w.length ? w[w.length - 1] : null; };

// ---- [8] grandmaster + gold friend, both zero-points opponents leave: the same points as a normal finish ----
{
  const F = SID(31), GOLDF = { mu: 28, sigma: 3 };   // display 1760, points 2500 (gold): the team average sits in diamond
  const sk0 = { [v.pid(X)]: { mu: GM.mu, sigma: GM.sigma }, [v.pid(F)]: { mu: GOLDF.mu, sigma: GOLDF.sigma } };
  const pts = { [X]: 8200, [F]: 2500, [Z0]: 0, [Z1]: 0 };
  const ros = [X, F, Z0, Z1];
  const left = startLeave(6, 0xE170, ros, [0, 1], pts, sk0);
  const full = startLeave(6, 0xE171, ros, [0, 1, 2, 3], pts, sk0);
  T('[8] both settle (exit 0 every run)', left.rs.every(r => r.code === 0) && full.rs.every(r => r.code === 0) && processedOf(left.last).has(left.key) && processedOf(full.last).has(full.key),
    left.last.out.slice(-600) + full.last.out.slice(-600));
  const pl = [X, F].map(s => lastPts(left, s)), pf = [X, F].map(s => lastPts(full, s));
  T('[8] the grandmaster and his gold friend take the points of the normal finish', pl[0] != null && pl[0] === pf[0] && pl[1] === pf[1],
    'opponents left ' + JSON.stringify(pl) + ' / opponents stayed ' + JSON.stringify(pf));
  T('[8] ... a compressed win, not the full one (the friend below +' + (Math.round(28 / 2) + 3) + ')', pl[1] != null && pl[1] - 2500 > 0 && pl[1] - 2500 < Math.round(28 / 2) + 3, JSON.stringify(pl));
}

// ---- [9] the leavers' stored and ranked ratings differ ----
{
  const HIGH = { mu: 30, sigma: 2 }, LOWR = { mu: 15, sigma: 2 };   // stored display 1960 (level with the grandmasters), ranked 1360
  const sk0 = Object.assign({}, GMSK);
  for (const z of [Z0, Z1]) sk0[v.pid(z)] = { mu: HIGH.mu, sigma: HIGH.sigma, rm: LOWR.mu, rv: LOWR.sigma };
  const m = startLeave(6, 0xE172, [X, Y, Z0, Z1], [0, 1], GMPTS, sk0);
  const eS = expect([P(X, GM), P(Y, GM)], [P(Z0, HIGH), P(Z1, HIGH)]);
  const eR = expect([P(X, GM), P(Y, GM)], [P(Z0, LOWR), P(Z1, LOWR)]);
  T('[9] five runs exit 0, settled, both leavers convicted', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(m.key)
    && leavesOf(m.last, Z0) === 1 && leavesOf(m.last, Z1) === 1, m.last.out.slice(-800));
  T('[9] the winners\' stored rating against the leavers\' stored rating, their ranked rating against the ranked one',
    storedIs(m.last, X, eS[X]) && storedIs(m.last, Y, eS[Y]) && rankedIs(m.last, X, eR[X]) && rankedIs(m.last, Y, eR[Y]),
    show(m.last, [X, Y]) + ' want stored ' + JSON.stringify([eS[X].mu, eS[X].sigma]) + ' ranked ' + JSON.stringify([eR[X].mu, eR[X].sigma]));
  T('[9] the leavers: stored rating as it was, ranked rating = their side of the ranked update', leaverIs(m.last, Z0, eR[Z0], HIGH) && leaverIs(m.last, Z1, eR[Z1], HIGH),
    show(m.last, [Z0, Z1]));
  T('[9] the mismatch reads the leavers\' ranked rating: no points for the grandmasters (their stored one would give the full win)',
    [X, Y].every(s => writesTo(m.rs, POINTS, s).every(p => p <= 8200)), JSON.stringify([X, Y].map(s => writesTo(m.rs, POINTS, s))));
}

// ---- [10] the whole winning team gone, one loser gone (ranked 3v3: a lone record does not settle) ----
{
  const ros = [H1, H2, H3, SID(15), SID(16), SID(17)];
  const L3 = ros[3], L4 = ros[4], L5 = ros[5];
  const sk0 = {}; for (const s0 of ros) sk0[v.pid(s0)] = { mu: GOLD.mu, sigma: GOLD.sigma };
  const pts = {}; for (const s0 of ros) pts[s0] = 2500;
  SC[6] = [6100, 5800, 5200, 4800, 4300, 3900];
  const r3 = (seat) => rec(0xB1, 9, 0xE173, seat, 4 + (seat % 3), false, ros);   // team 1 (seats 3-5) lost
  const S = ros.map((sid, i) => ({ sid, d: start(9, 0xE173, i, ros) }));
  const all = S.concat([3, 4].map((i) => ({ sid: ros[i], d: r3(i) })));
  const key = keyOf(S[0].d);
  const m = runSteps([[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]], pts, sk0);
  T('[10] every run exits 0, settled', m.rs.length === 5 && m.rs.every(r => r.code === 0) && processedOf(m.last).has(key), m.out.slice(-1200));
  T('[10] nobody stands in (the winners\' side is empty): no Q167 line, the loser who left has no ranked loss',
    !/leaver-ghost /.test(m.out) && !/leaver-ranked /.test(m.out) && !Number.isFinite((skillOf(m.last, L5) || {}).rm), m.out.slice(-1200));
  T('[10] every rating finite (no update against an empty team)', finiteSkills(m.last) && Number.isFinite((skillOf(m.last, L3) || {}).mu),
    JSON.stringify([L3, L4].map((x) => skillOf(m.last, x))));
}

// ---- [11] write the loss, then overwrite it with an empty record before the settle ----
{
  const HIGH = { mu: 30, sigma: 2 };   // the loser who stays reads level with the grandmasters: no mismatch among the present
  const sk0 = Object.assign({}, GMSK, { [v.pid(Z0)]: { mu: HIGH.mu, sigma: HIGH.sigma } });
  const mt = 6, hash = 0xE174, ros = [X, Y, Z0, Z1];
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const R = ros.map((sid, i) => ({ sid, d: settle(mt, hash, i, ros) }));
  const W = R.map((r) => (r.sid === Z1 ? { sid: Z1, d: [0] } : r));   // Z1's result overwritten in place (same shard row)
  const key = keyOf(S[0].d);
  const m = runSteps([[0, S], [MIN, S.concat(R)], [v.SANITY.MIN_START_AGE_MS, S.concat(W)], [GRACE, S.concat(W)], [LEAVE, S.concat(W)], [3 * HOUR, S.concat(W)]], GMPTS, sk0);
  const e = expect([P(X, GM), P(Y, GM)], [P(Z0, HIGH), P(Z1)]);
  T('[11] every run exits 0, settled; Z1 seen agreeing, not convicted', m.rs.every(r => r.code === 0) && processedOf(m.last).has(key) && leavesOf(m.last, Z1) === 0
    && /record gone but seen agreeing earlier/.test(m.out), m.out.slice(-1200));
  T('[11] Z1 stands in: logged, the winners rated against Z0 and Z1', GHOST_LINE(key, 1, 'seat 3').test(m.out) && storedIs(m.last, X, e[X]) && rankedIs(m.last, X, e[X]),
    show(m.last, [X, Y]) + ' want ' + JSON.stringify(e[X]) + '\n' + m.out.slice(-1200));
  T('[11] Z1: stored rating never moves, ranked rating takes the loss of the full team', leaverIs(m.last, Z1, e[Z1]), show(m.last, [Z1]));
  T('[11] no points for the grandmasters (Z1 counts toward the mismatch)', [X, Y].every(s => writesTo(m.rs, POINTS, s).every(p => p <= 8200)),
    JSON.stringify([X, Y].map(s => writesTo(m.rs, POINTS, s))));
}

// ---- [13] write the loss, then overwrite it: the loser who stayed keeps the present-only reading ----
{
  const HIGH = { mu: 30, sigma: 2 };   // X, Y and Z0 level (no spread among the present); Z1 fresh (1000: a spread with him)
  const sk0 = {}; for (const s0 of [X, Y, Z0]) sk0[v.pid(s0)] = { mu: HIGH.mu, sigma: HIGH.sigma };
  const pts = { [X]: 2500, [Y]: 2500, [Z0]: 2500, [Z1]: 2500 };   // gold: win 35, loss 20, drip 3, rs .5
  const mt = 6, hash = 0xE175, ros = [X, Y, Z0, Z1];
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const R = ros.map((sid, i) => ({ sid, d: settle(mt, hash, i, ros) }));
  const W = R.map((r) => (r.sid === Z1 ? { sid: Z1, d: [0] } : r));
  const key = keyOf(S[0].d);
  const steps = (late) => [[0, S], [MIN, S.concat(R)], [v.SANITY.MIN_START_AGE_MS, S.concat(late)], [GRACE, S.concat(late)], [LEAVE, S.concat(late)], [3 * HOUR, S.concat(late)]];
  const m = runSteps(steps(W), pts, sk0);
  const n = runSteps(steps(R), pts, sk0);   // the normal finish: Z1 keeps his record
  T('[13] every run exits 0, settled; Z1 seen agreeing, stands in', m.rs.every(r => r.code === 0) && n.rs.every(r => r.code === 0) && processedOf(m.last).has(key)
    && leavesOf(m.last, Z1) === 0 && GHOST_LINE(key, 1, 'seat 3').test(m.out), m.out.slice(-1200));
  T('[13] the winners take the points of the normal finish (an expected win, compressed)', [X, Y].every(s => lastPts(m, s) != null && lastPts(m, s) === lastPts(n, s) && lastPts(m, s) < 2500 + 21),
    JSON.stringify([X, Y].map(s => [lastPts(m, s), lastPts(n, s)])));
  T('[13] the loser who stayed takes the plain loss (no mild strong-side factor: that is the winners\' case only)', lastPts(m, Z0) === 2500 + Math.round(-20 / 2 + 3),
    JSON.stringify([lastPts(m, Z0), lastPts(n, Z0)]));
}

// ---- [14] a confessed leaver stands in ----
{
  const ros = [X, Y, Z0, Z1], mt = 6, hash = 0xE176;
  const confess = (seat) => { const d = start(mt, hash, seat, ros); d[0] = 0xB5; d[10 + ros.length] = 5; return d; };   // 5 = user-quit
  const S = ros.map((sid, i) => ({ sid, d: start(mt, hash, i, ros) }));
  const all = S.concat([0, 1, 2].map((i) => ({ sid: ros[i], d: settle(mt, hash, i, ros) })), [{ sid: Z1, d: confess(3) }]);
  const key = keyOf(S[0].d);
  const m = runSteps([[0, S], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]], GMPTS, GMSK);
  const e = expect([P(X, GM), P(Y, GM)], [P(Z0), P(Z1)]);
  T('[14] every run exits 0, settled; the confession read, the leave counted once', m.rs.every(r => r.code === 0) && processedOf(m.last).has(key)
    && /abandon confession/.test(m.out) && leavesOf(m.last, Z1) === 1 && leavesOf(m.last, Z0) === 0, m.out.slice(-1200));
  T('[14] Z1 stands in: logged, the winners rated against Z0 and Z1', GHOST_LINE(key, 1, 'seat 3').test(m.out) && storedIs(m.last, X, e[X]) && rankedIs(m.last, X, e[X]),
    show(m.last, [X, Y]) + ' want ' + JSON.stringify(e[X]) + '\n' + m.out.slice(-1200));
  T('[14] Z1: stored rating never moves, ranked rating takes the loss of the full team', leaverIs(m.last, Z1, e[Z1]), show(m.last, [Z1]));
}

console.log(failN ? 'leaver-ghost: ' + failN + ' FAIL' : 'leaver-ghost: all ok');
process.exit(failN ? 1 : 0);
