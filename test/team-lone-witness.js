'use strict';
// Q302 (cloud audit 2026-10, found doing Q275): a team match that settles on ONE kept record -- a Q109 settle where the
//   second writer's record was dropped (a bad roster seat or field) and counts only as a witness from his start-roster
//   seat -- now counts its absent seats as a two-record group would. Before, detectLeavers needed two records to vote and
//   named nobody: the players who left were not convicted, the losing team kept a seat nobody accounted for and Q149
//   settled the match without a rating move (an honest 2V2 winner whose opponent's teammate left and whose opponent wrote
//   a bad record got no points for the win; the players who left kept theirs). A seat counts when the kept record and the
//   registered start roster name the same account on it; the Q109 / agreed / Q69 filters then apply as for any settle.
//   FFA and bot lanes are unchanged (an FFA player's own numbers do not depend on the leavers; [6]).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-gone.js).
//   Every case runs twice on the same timeline: the bent run (the witness's record dropped by Q109) and its clean twin (the
//   same record clean, two writers kept); "as clean" = the same points and rating posts for every account, the same
//   leaves, XP the same except the dropped writer's (Q109: none for a dropped record).
//   [0] wiring pins: the helper (kept record + start roster, the kept writer's seat skipped), the team-only switch right
//       before leavers0, the filter unchanged after it, ahead of the Q149 count; the FFA put-back loop still on detectLeavers
//   [1] ranked team brawl (base 4) and true 2V2 (base 6), H's team wins, the opponent C's record bent, his teammate D and
//       H's teammate T left (own starts) -> as clean (H +21, T / D -100 and a leave each), the lone-witness line;
//       mutant (switch off = before) -> nobody rated, the named-loser line
//   [2] the same, H's team loses -> as clean (H's loss softened by the abandoned-teammate shield, not more);
//       mutant -> nobody rated (before: H kept his points)
//   [3] the bent record on H's own team (T), both opponents left -> as clean, H's team winning and losing
//   [4] a leaver who never wrote his own start (D) -> named-only as in the clean twin (Q69 line, not convicted, Q149
//       no rating move); mutant (Q69 own-record check off) -> D convicted
//   [5] the kept record names an outside account X on D's seat (the start roster seats D there) -> X not named (no Q69
//       line, no leave), D not convicted, nobody rated (Q149: a blank losing seat), T convicted; mutant (start roster
//       check off) -> X named by the kept record alone
//   [6] ranked FFA (base 2) witness settle -> unchanged: the leaver not convicted, every account as before;
//       mutant (switch widened to every base) -> the leaver convicted
//   [7] ranked 3V3 (base 9), one kept record, four leavers -> as clean, H's team winning and losing
//   [8] quick team brawl (base 3, hidden rating only) -> as clean
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/ffa-agreed-gone.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-lone-witness-'));
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
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

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
function timeline(steps, script, files0, mkBoards) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron((mkBoards || boardsWith)(recs), state ? advance(state, ms) : (files0 || null), env || null, script);
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
const firstProcessed = (rs, key) => rs.findIndex(r => processedOf(r).has(key));
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-team-lone-witness-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const LP_AT = {};   // points a test starts an account at (default 2500)
const ALL = [];
const placeIn = (sc, seat) => 1 + sc.filter((x) => x > sc[seat]).length;
const rOf = (rs, sid) => ratingOf(rs, sid).map((p) => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const sameFor = (a, b, sids) => sids.every((s) => pts(a, [s]) === pts(b, [s]) && JSON.stringify(rOf(a, s)) === JSON.stringify(rOf(b, s)));
const show = (rs, sids) => JSON.stringify(sids.map((s) => [ptsIn(rs, s), rOf(rs, s)]));

const LONE = '    const loneTeam = !!dropSeat && g.length < 2 && isTeamMt(matchType);\n';
const ABS0 = '    const absent0 = loneTeam ? loneWitnessLeavers(g, seatGateRoster(pend)) : detectLeavers(g);\n';
const FILT = '    const leavers0 = absent0.filter((x) => {\n'
  + "      if (dropped(x.steamID)) { console.log('  leaver ' + c.m + ': seat ' + x.seat + ' = ' + plog(x.steamID) + ' wrote a record that sanity dropped -- played, not a leaver (Q109)'); return false; }\n"
  + '      if (!(pend.agreed && pend.agreed.indexOf(pid(String(x.steamID))) >= 0)) return ownOrNamed(x);\n';
const HELP = 'function loneWitnessLeavers(g, gro) {\n  if (!g || g.length !== 1 || !gro) return [];\n  const present = g[0].d[5] | 0, out = [];\n';
const GROCHK = '    if (seat !== present && gro[seat] === pid(sid)) out.push({ seat, steamID: sid });\n';
const Q149 = '    const lossSide = (!PT_MODE && isTeamMt(matchType)) ? teamLossCounted(';
const FFA_LOOP = '      for (const x of detectLeavers(g)) {\n        const hx = pid(String(x.steamID));\n';
const OWN = '      if (!(pend.agreed && pend.agreed.indexOf(pid(String(x.steamID))) >= 0)) return ownOrNamed(x);\n';
const OFF = (fn) => withMutant('off', LONE, '    const loneTeam = false;\n', fn);
const NOGRO = (fn) => withMutant('nogro', GROCHK, '    if (seat !== present) out.push({ seat, steamID: sid });\n', fn);
const WIDE = (fn) => withMutant('wide', LONE, '    const loneTeam = !!dropSeat && g.length < 2;\n', fn);
const NOOWN = (fn) => withMutant('noown', OWN, '      if (!(pend.agreed && pend.agreed.indexOf(pid(String(x.steamID))) >= 0)) return true;\n', fn);

let base = 3021;
const seq = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(SID(base + i)); base += 10; ALL.push(...out); return out; };
const tsz = (mt) => ((mt & 0xF) === 8 || (mt & 0xF) === 9) ? 3 : 2;
// one team key: every seat's start (unless `noStart`), every seat's result; `bent(seat, at)`: that seat's result with an
//   implausible account on roster seat `at` (Q109 drops it: a roster reason, nobody flagged); `rosAt(seat, at, sid)`: that
//   seat's result naming another account on seat `at`
function teamKey(mt, ros, sc) {
  const h = 0xE302 + base;
  const rk = {}, ts = tsz(mt), sum = (t) => sc.reduce((a, x, i) => a + (((i / ts) | 0) === t ? x : 0), 0), wt = sum(1) > sum(0) ? 1 : 0;
  ros.map((s, i) => ({ s, i, w: ((i / ts) | 0) === wt ? 0 : 1 })).sort((x, y) => x.w - y.w || sc[y.i] - sc[x.i] || x.i - y.i).forEach((x, n) => { rk[x.s] = n + 1; });
  if (ros.length === 4) { const r4 = v.teamRankOf(ros.map((s, i) => ({ steamID: s, seat: i, score: sc[i] }))); if (ros.some((s) => r4[s] !== rk[s])) throw new Error('team rank'); }
  const S = ros.map((s, i) => ({ sid: s, d: rec(0xB2, mt, h, i, 0, false, ros, sc) }));
  const resOf = (i, r) => ({ sid: ros[i], d: rec(0xB1, mt, h, i, rk[ros[i]], rk[ros[i]] <= tsz(mt), r, sc) });
  const R = ros.map((_, i) => resOf(i, ros));
  const swap = (i, at, sid) => resOf(i, ros.map((s, j) => (j === at ? sid : s)));
  return { S, R, key: keyOf(S[0].d), ros, bent: (i, at) => swap(i, at, '5'), rosAt: swap };
}
// writers: the seats whose result is in; `alt`: seat -> a replacement result row; `noStart`: seats with no start of their own
function run(k, writers, opt, script) {
  const o = opt || {};
  const S = k.S.filter((_, i) => !(o.noStart || []).includes(i));
  const left = S.concat(writers.map((i) => (o.alt && o.alt[i]) || k.R[i]));
  return timeline([[0, S], [2 * MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left], [3 * HOUR, left]], script);
}
const LONE_LINE = (key) => new RegExp('lone-witness ' + key + ': one record kept beside a dropped witness, absent seat\\(s\\) [0-9,]+ read from that record and the start roster \\(Q302\\)');
const LEAVER_LINE = (key, seat, sid) => new RegExp('leaver ' + key + ': seat ' + seat + ' = ' + v.pid(sid).slice(0, 8) + ' \\(in roster, no record; total [0-9]+\\)');
const Q69_LINE = (key, sid) => new RegExp('leaver ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' named by the others but never wrote his own record for this match -- not a leaver \\(Q69\\)');
const NAMED_LOSER = (key) => new RegExp('named-loser ' + key + ': ');
const leaves = (rs, sids) => JSON.stringify(sids.map((s) => leavesOf(last(rs), s)));
const xps = (rs, sids) => JSON.stringify(sids.map((s) => xpOf(rs, s)));
// as clean: every account's points / rating posts and leaves, XP the same except the dropped writer's (0 in the bent run)
const asClean = (a, b, ros, dropI) => sameFor(a, b, ros) && leaves(a, ros) === leaves(b, ros)
  && ros.every((s, i) => (i === dropI ? xpOf(a, s) === 0 && xpOf(b, s) > 0 : xpOf(a, s) === xpOf(b, s)));
const why = (a, b, ros) => show(a, ros) + ' vs ' + show(b, ros) + ' leaves ' + leaves(a, ros) + '/' + leaves(b, ros) + ' xp ' + xps(a, ros) + '/' + xps(b, ros);
const fine = (rs, k) => allOk(rs, 6) && processedOf(last(rs)).has(k.key);
const WIN4 = [6100, 3900, 4800, 3500], LOSE4 = [3500, 3900, 6100, 4800];

console.log('=== a team match settled on one kept record counts its leavers from the start roster (Q302) ===');

// ---- [0] wiring ----
{
  const at = (a) => SRC.indexOf(a);
  T('[0] the helper: one kept record, a registered start roster, the kept writer\'s seat skipped, a seat only where the record and the roster name the same account',
    [HELP, GROCHK].every((a) => SRC.split(a).length === 2) && at(HELP) < at(GROCHK) && at(GROCHK) - at(HELP) < 400 && at(HELP) > at('function absentRosterSeats(g) {'));
  T('[0] the team-only switch right before leavers0 (Q109 dropped / agreed / Q69 filter unchanged), ahead of the Q149 count',
    [LONE, ABS0, FILT].every((a) => SRC.split(a).length === 2) && at(LONE) + LONE.length === at(ABS0) && at(ABS0) < at(FILT) && at(FILT) - at(ABS0) < 400
    && SRC.split(Q149).length === 2 && at(FILT) < at(Q149) && SRC.split('detectLeavers(g).filter(').length === 1);
  T('[0] the FFA put-back loop (Q185) still reads detectLeavers', SRC.split(FFA_LOOP).length === 2 && at(FFA_LOOP) < at(LONE));
}

// ---- [1] / [2] H's team wins / loses, the opponent's record bent, one leaver each team ----
for (const mt of [4, 6]) for (const [tag, sc, win] of [['[1]', WIN4, true], ['[2]', LOSE4, false]]) {
  const ros = seq(4), [H, Tm, C, D] = ros, k = teamKey(mt, ros, sc);
  const a = run(k, [0, 2], { alt: { 2: k.bent(2, 3) } }), b = run(k, [0, 2]);
  const what = tag + ' base ' + mt + ' H\'s team ' + (win ? 'wins' : 'loses');
  T(what + ': both settled, T and D convicted (leave + -100), the lone-witness line', fine(a, k) && fine(b, k) && LONE_LINE(k.key).test(outOf(a))
    && LEAVER_LINE(k.key, 1, Tm).test(outOf(a)) && LEAVER_LINE(k.key, 3, D).test(outOf(a)) && !NAMED_LOSER(k.key).test(outOf(a)), last(a).out.slice(-800));
  T(what + ': every account as clean (H ' + (win ? 'up' : 'down, shielded') + ')', asClean(a, b, ros, 2) && (win ? up(a, H) : down(a, H)) && ptsIn(a, Tm)[0] === 2400, why(a, b, ros));
  OFF((script) => {
    const m = run(k, [0, 2], { alt: { 2: k.bent(2, 3) } }, script);
    T(what + ': mutant (switch off = before) -> nobody rated, nobody convicted, the named-loser line', allOk(m, 6) && ros.every((s) => none(m, s)) && leaves(m, ros) === '[0,0,0,0]'
      && NAMED_LOSER(k.key).test(outOf(m)), show(m, ros));
  });
}

// ---- [3] the bent record on H's own team, both opponents left ----
for (const [sc, win] of [[WIN4, true], [LOSE4, false]]) {
  const ros = seq(4), [H, Tm, C, D] = ros, k = teamKey(4, ros, sc);
  const a = run(k, [0, 1], { alt: { 1: k.bent(1, 3) } }), b = run(k, [0, 1]);
  T('[3] T (H\'s teammate) bent, C and D left, H\'s team ' + (win ? 'wins' : 'loses') + ': as clean, C and D convicted', fine(a, k) && fine(b, k) && asClean(a, b, ros, 1)
    && LEAVER_LINE(k.key, 2, C).test(outOf(a)) && LEAVER_LINE(k.key, 3, D).test(outOf(a)) && (win ? up(a, H) : down(a, H)), why(a, b, ros));
}

// ---- [4] a leaver with no start of his own stays named-only ----
{
  const ros = seq(4), [H, Tm, C, D] = ros, k = teamKey(4, ros, WIN4);
  const a = run(k, [0, 2], { alt: { 2: k.bent(2, 3) }, noStart: [3] }), b = run(k, [0, 2], { noStart: [3] });
  T('[4] D wrote no start: named-only as in the clean twin (Q69 line, no leave), no rating move (Q149), T convicted', fine(a, k) && fine(b, k) && asClean(a, b, ros, 2)
    && Q69_LINE(k.key, D).test(outOf(a)) && leavesOf(last(a), D) === 0 && leavesOf(last(a), Tm) === 1 && none(a, H) && NAMED_LOSER(k.key).test(outOf(a)), why(a, b, ros));
  NOOWN((script) => {
    const m = run(k, [0, 2], { alt: { 2: k.bent(2, 3) }, noStart: [3] }, script);
    T('[4] mutant (Q69 own-record check off) -> D convicted', allOk(m, 6) && leavesOf(last(m), D) === 1, leaves(m, ros));
  });
}

// ---- [5] the kept record alone cannot name an account the start roster does not seat there ----
{
  const ros = seq(4), [H, Tm, C, D] = ros, k = teamKey(4, ros, WIN4), X = seq(1)[0];
  const alt = { 0: k.rosAt(0, 3, X), 2: k.bent(2, 3) };
  const a = run(k, [0, 2], { alt });
  T('[5] H\'s record names X on D\'s seat: X not named (no Q69 line, no leave), D not convicted, nobody rated (Q149), T convicted', fine(a, k) && !Q69_LINE(k.key, X).test(outOf(a))
    && leavesOf(last(a), X) === 0 && leavesOf(last(a), D) === 0 && leavesOf(last(a), Tm) === 1 && none(a, H) && none(a, X) && NAMED_LOSER(k.key).test(outOf(a)), leaves(a, ros.concat([X])) + show(a, ros));
  NOGRO((script) => {
    const m = run(k, [0, 2], { alt }, script);
    T('[5] mutant (start roster check off) -> X named by the kept record alone (Q69 line)', allOk(m, 6) && Q69_LINE(k.key, X).test(outOf(m)), last(m).out.slice(-800));
  });
}

// ---- [6] FFA unchanged ----
{
  const ros = seq(3), [H, C, Tm] = ros, sc = [6100, 4800, 3900], h = 0xF302 + base;
  const S = ros.map((s, i) => ({ sid: s, d: rec(0xB2, 2, h, i, 0, false, ros, sc) }));
  const R = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, i + 1, i === 0, ros, sc) }));
  const k = { S, R, key: keyOf(S[0].d), ros };
  const Cb = { sid: C, d: rec(0xB1, 2, h, 1, 2, false, [H, C, '5'], sc) };
  const a = run(k, [0, 1], { alt: { 1: Cb } }), b = run(k, [0, 1]);
  let before = null;
  OFF((script) => { before = run(k, [0, 1], { alt: { 1: Cb } }, script); });
  T('[6] ranked FFA witness settle: T not convicted, no lone-witness line, every account\'s posts and leaves as before the change; H and C rated as clean',
    fine(a, k) && fine(b, k) && before && allOk(before, 6) && leavesOf(last(a), Tm) === 0 && !LONE_LINE(k.key).test(outOf(a)) && sameFor(a, before, ros)
    && leaves(a, ros) === leaves(before, ros) && xps(a, ros) === xps(before, ros) && sameFor(a, b, [H, C]), show(a, ros) + ' vs ' + (before ? show(before, ros) : '-'));
  WIDE((script) => {
    const m = run(k, [0, 1], { alt: { 1: Cb } }, script);
    T('[6] mutant (switch on every base) -> T convicted in the FFA', allOk(m, 6) && leavesOf(last(m), Tm) === 1, leaves(m, ros));
  });
}

// ---- [7] 3V3, one kept record, four leavers ----
for (const [sc, win] of [[[6100, 3900, 3000, 4800, 3500, 2000], true], [[3000, 3900, 2000, 6100, 4800, 3500], false]]) {
  const ros = seq(6), k = teamKey(9, ros, sc);
  const a = run(k, [0, 3], { alt: { 3: k.bent(3, 5) } }), b = run(k, [0, 3]);
  T('[7] ranked 3V3, C (seat 3) bent, four leavers, H\'s team ' + (win ? 'wins' : 'loses') + ': as clean, the four convicted', fine(a, k) && fine(b, k) && asClean(a, b, ros, 3)
    && [1, 2, 4, 5].every((i) => leavesOf(last(a), ros[i]) === 1) && (win ? up(a, ros[0]) : down(a, ros[0])), why(a, b, ros));
}

// ---- [8] quick team brawl ----
{
  const ros = seq(4), k = teamKey(3, ros, WIN4);
  const a = run(k, [0, 2], { alt: { 2: k.bent(2, 3) } }), b = run(k, [0, 2]);
  T('[8] quick team brawl: as clean (hidden rating posts), no points move', fine(a, k) && fine(b, k) && asClean(a, b, ros, 2) && rOf(a, ros[0]).length === 1 && ros.every((s) => none(a, s)), why(a, b, ros));
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (team-lone-witness) ===' : '=== PASS -- 0 fail (team-lone-witness) ===');
process.exit(failN ? 1 : 0);
