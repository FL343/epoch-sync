'use strict';
// Q161 (cloud audit 2026-10, found doing Q149): a named-only seat on the losing team is counted on its account.
// Q149 leaves a team match unrated when a seat of the losing team is accounted for by nobody: a seat named by the others
//   only (no start, result or confession of its own for the key) or left blank. Cron cannot tell a loser who dropped
//   before the level-1 start from a modified client that writes nothing on purpose: each loss of such a client unrates the
//   match (the winners gain nothing, its teammates lose nothing), and the same client can write its wins (rated as any win),
//   so it counts only its wins. Now the named-only seat's account carries the count, with its other signals: `nl` = such
//   matches, `nlo` = the different accounts that wrote the win against it (up to NL_OPP_CAP), next to `tw` / `tl` = the
//   team results each writer wrote himself (rated or not). Only an account that already has signals of its own is counted
//   (a made-up name gets no entry: the signals file does not grow per name) and the count does not refresh the entry. A
//   count of NL_REPEAT or more matches and different opponents is logged `repeated`; with more losses unwritten than
//   written (nl > tl) also `more losses unwritten than written`; both counted in the summary. Nobody is flagged; the
//   settle itself is Q149's.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/team-loss-named.js).
//   Every case starts from one carried state (the prior): M and V wrote a won 2V2, H wrote three lost ones.
//   [0] wiring pins: the written-results count before the Q149 branch; the count in it after its line, the no-signals
//       lookup; the constants; the summary row
//   [p] the prior: tw / tl counted for the writers of rated team matches; mutant (tl not counted) -> H tl 0
//   [1] ranked 2V2, M (seat 3) named by the others only, his teammate P writes the loss, O1 / O2 write the win -> unrated
//       (Q149), M's nl 1 and nlo [O1, O2], his entry not refreshed, the account line, nobody flagged, the writers' tw / tl;
//       a second match names G (no signals of his own) on the losing team -> not counted, no entry made; the row 1 / 0 / 0
//       / 1; mutants (count off -> nl 0; the entry made for any name -> G gets one, M's refreshed)
//   [2] three such matches against three pairs of opponents -> nl 3, nlo 6, the third line `repeated` and (M wrote one
//       team result, a win) `more losses unwritten than written`, the row 3 / 1 / 1 / 0; mutant (opponents not kept) -> not
//       repeated
//   [3] one pair of accounts writing three made-up matches that name V on the losing team -> nl 3 but nlo 1: not repeated;
//       mutant (the opponents not required) -> repeated
//   [4] a blank seat and a named-only seat (V, who has signals) on the WINNING team are not counted; mutant (both teams)
//       -> V counted
//   [5] five matches against five pairs -> nlo stops at NL_OPP_CAP (the line shows 8+); mutant (cap off) -> 10
//   [6] a rated match (every losing seat accounted for) counts nothing but tw / tl; an FFA with a named-only seat counts
//       nothing, no tw / tl either
//   [7] H, who wrote three lost team matches, named-only in three more against three pairs -> `repeated` but nl 3 not over
//       tl 3: no `more losses unwritten than written`, the row 3 / 1 / 0 / 0; mutant (tl ignored) -> marked
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'named-loser-count-'));
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
const firstProcessed = (rs, key) => rs.findIndex(r => processedOf(r).has(key));
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-named-loser-count-' + tag + '-' + process.pid + '.js');
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

const nlOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {});
const hasEntry = (r, sid) => !!(((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]);
const COUNT_LINE = (key, sid, n, o, tw, tl, rep, unw) => new RegExp('named-loser-account ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' -- ' + n + ' such match\\(es\\), ' + o
  + ' different opponent\\(s\\), team results he wrote ' + tw + ' won / ' + tl + ' lost' + (rep ? ', repeated' : '') + (unw ? ', more losses unwritten than written' : '')
  + '; counted, nobody flagged \\(Q161\\)');
const NONE_LINE = (key, sid) => new RegExp('named-loser-account ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' -- no signals of his own \\(no record of his this cron kept\\), not counted \\(Q161\\)');
// the row's four numbers added up over every run (the keys of one case settle in different runs)
const ROW_RE = /\| named-only losing seats counted on their account \/ of them repeated: 3 or more such matches and different opponents \/ of those more losses unwritten than written \/ not counted, no signals of his own \(Q161, nobody flagged\) \| (\d+) \/ (\d+) \/ (\d+) \/ (\d+) \|/;
const rowSum = (rs) => rs.reduce((a, r) => { const m = ROW_RE.exec(r.summary || ''); return m ? a.map((x, i) => x + +m[i + 1]) : [NaN, NaN, NaN, NaN]; }, [0, 0, 0, 0]);
const ROWS = (rs, want) => JSON.stringify(rowSum(rs)) === JSON.stringify(want);
const q161Lines = (rs) => outOf(rs).split('\n').filter((l) => /Q161/.test(l)).join('\n');
const COUNT = "        h.nl = (h.nl | 0) + 1;\n";
const OPP = "        for (const q of nlOpp) if (o.length < NL_OPP_CAP && o.indexOf(q) < 0) o.push(q);\n";
const REP = "        const rep = h.nl >= NL_REPEAT && o.length >= NL_REPEAT;\n";
const UNW = "        const unw = rep && h.nl > (h.tl | 0);\n";
const LOSE = "        if (teamOfSeat(x.seat, tszL) !== lossSide.lose) continue;\n";
const LOOKUP = "        const h = signals.players[pid(String(x.steamID))];\n        if (!h) {\n";
const TWTL = "        if (t === lossSide.win) h.tw = (h.tw | 0) + 1; else if (t === lossSide.lose) h.tl = (h.tl | 0) + 1;\n";
const Q149_IF = "    if (noRating && namedLose.length) {\n";
const Q149_LOG = "        + ' of the losing team (team ' + lossSide.lose + ') -- no record, leave or agreement of his own for this match, settled without a rating move (Q149)');\n";
function keysCase(cases) {
  const S = [], A = [], keys = [];
  for (const [mt, h, ros, writers, winTeam] of cases) {
    const s = writers.map(([i, sid]) => ({ sid, d: start(mt, h, i, ros) }));
    const r = writers.filter(([, , k]) => k !== 'left').map(([i, sid]) => ({ sid, d: settle(mt, h, i, ros, winTeam) }));
    S.push(...s); A.push(...s, ...r); keys.push(keyOf(s[0].d));
  }
  return { keys, steps: [[0, S], [5 * MIN, A], [GRACE, A], [LEAVE, A], [3 * HOUR, A]] };
}
const M = SID(301), V = SID(302), H = SID(303), O = Array.from({ length: 10 }, (_, i) => SID(311 + i)), J = Array.from({ length: 6 }, (_, i) => SID(331 + i));
ALL.push(M, V, H, ...O, ...J);

console.log('=== a named-only seat on the losing team is counted on its account (Q161) ===');

// ---- [0] wiring ----
{
  const iTw = SRC.indexOf(TWTL), iIf = SRC.indexOf(Q149_IF), iLog = SRC.indexOf(Q149_LOG), iLook = SRC.indexOf(LOOKUP), iCount = SRC.indexOf(COUNT), iElse = SRC.indexOf('    } else if (noRating) {\n      RUN.noLoser');
  T('[0] the written team results counted before the Q149 branch; in it, after its line: the lookup, then the count, before the Q136 branch',
    [TWTL, Q149_IF, LOOKUP, COUNT].every((a) => SRC.split(a).length === 2) && iTw > 0 && iTw < iIf && iIf < iLog && iLog < iLook && iLook < iCount && iCount < iElse);
  T('[0] only the losing team\'s named-only seats, the opponents kept up to the cap, repeated on both, the unwritten mark on tl',
    [LOSE, OPP, REP, UNW].every((a) => SRC.split(a).length === 2) && v.NL_OPP_CAP === 8 && v.NL_REPEAT === 3);
  T('[0] the Q161 summary row', /named-only losing seats counted on their account \/ of them repeated: ' \+ NL_REPEAT \+ ' or more such matches and different opponents \/ of those more losses unwritten than written \/ not counted, no signals of his own \(Q161, nobody flagged\) \| ' \+ s\('nlSeat', 0\) \+ ' \/ ' \+ s\('nlRepeat', 0\) \+ ' \/ ' \+ s\('nlUnwritten', 0\) \+ ' \/ ' \+ s\('nlNone', 0\)/.test(SRC));
}

// ---- [p] the prior every case starts from: M and V win a rated 2V2, H loses three ----
const PRIOR = keysCase([[6, 0xB150, [M, V, J[0], J[1]], [[0, M], [1, V], [2, J[0]], [3, J[1]]], 0]]
  .concat([0, 1, 2].map((k) => [6, 0xB151 + k, [J[2], J[3], H, J[4]], [[0, J[2]], [1, J[3]], [2, H], [3, J[4]]], 0])));
let F0 = null;
{
  const rs = timeline(PRIOR.steps), r = last(rs);
  T('[p] runs exit 0, the four rated (points moved)', allOk(rs, 5) && PRIOR.keys.every((k) => processedOf(r).has(k)) && up(rs, M) && ptsIn(rs, H).length === 3, r.out.slice(-800));
  const m = nlOf(r, M), vv = nlOf(r, V), hh = nlOf(r, H);
  T('[p] tw / tl: M and V one won, J0 one lost, H three lost, J2 three won', m.tw === 1 && !m.tl && vv.tw === 1 && !vv.tl && nlOf(r, J[0]).tl === 1 && hh.tl === 3 && !hh.tw
    && nlOf(r, J[2]).tw === 3, JSON.stringify([m, hh]));
  T('[p] nothing counted', !/named-loser/.test(outOf(rs)) && ROWS(rs, [0, 0, 0, 0]) && ![M, V, H].some((s) => nlOf(r, s).nl));
  withMutant('tl', TWTL, "        if (t === lossSide.win) h.tw = (h.tw | 0) + 1;\n", (script) => {
    const mr = timeline(PRIOR.steps, script);
    T('[p] mutant: the losses not counted -> H tl 0', allOk(mr, 5) && !nlOf(last(mr), H).tl && nlOf(last(mr), M).tw === 1, JSON.stringify(nlOf(last(mr), H)));
  });
  F0 = advance(r.state, 6 * HOUR);
}
const from = (c, script) => timeline(c.steps, script, F0);
const atOf = (sid) => F0.SIGNALS_FILE.players[v.pid(sid)].at;

// ---- [1] one match: M (seat 3) writes nothing, P (seat 2) writes the loss, O1 / O2 win; G named alike in another ----
{
  const c = keysCase([[6, 0xB161, [O[0], O[1], P1, M], [[0, O[0]], [1, O[1]], [2, P1]], 0], [6, 0xB16A, [O[2], O[3], P2, G[0]], [[0, O[2]], [1, O[3]], [2, P2]], 0]]);
  const rs = from(c), r = last(rs);
  T('[1] runs exit 0, both unrated as Q149 (no points for anybody)', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k))
    && (outOf(rs).match(/named-loser [^\n]*seat 3 \(named by the others only\)[^\n]*\(Q149\)/g) || []).length === 2
    && [O[0], O[1], O[2], O[3], P1, P2, M, G[0]].every((s) => none(rs, s)), r.out.slice(-800));
  const n = nlOf(r, M);
  T('[1] M\'s account: nl 1, nlo the two winners, tw / tl as before (1 / 0), the entry not refreshed', n.nl === 1 && JSON.stringify(n.nlo) === JSON.stringify([v.pid(O[0]), v.pid(O[1])])
    && n.tw === 1 && !n.tl && n.at === atOf(M), JSON.stringify(n));
  T('[1] the account line', COUNT_LINE(c.keys[0], M, 1, 2, 1, 0, false, false).test(outOf(rs)), q161Lines(rs));
  T('[1] G (no signals of his own): the not-counted line, no entry made', NONE_LINE(c.keys[1], G[0]).test(outOf(rs)) && !hasEntry(r, G[0]), q161Lines(rs));
  T('[1] the row adds up to 1 / 0 / 0 / 1', ROWS(rs, [1, 0, 0, 1]), JSON.stringify(rowSum(rs)));
  T('[1] the writers\' own results: O0..O3 tw 1, P1 and P2 tl 1; no nl', [O[0], O[1], O[2], O[3]].every((s) => nlOf(r, s).tw === 1 && !nlOf(r, s).tl)
    && [P1, P2].every((s) => nlOf(r, s).tl === 1 && !nlOf(r, s).tw) && [O[0], O[1], P1, P2].every((s) => !nlOf(r, s).nl));
  T('[1] nobody flagged, nobody convicted', [O[0], O[1], P1, M].every((s) => fOf(r, s) === 0) && leavesOf(r, M) === 0, flags(r, [O[0], O[1], P1, M]));
  withMutant('count', COUNT, '        h.nl = h.nl | 0;\n', (script) => {
    const m = from(c, script);
    T('[1] mutant: the count off -> nl stays 0', allOk(m, 5) && !(nlOf(last(m), M).nl > 0), JSON.stringify(nlOf(last(m), M)));
  });
  withMutant('entry', LOOKUP, "        const h = sigPlayer(signals, pid(String(x.steamID)), nowMs);\n        if (!h) {\n", (script) => {
    const m = from(c, script);
    T('[1] mutant: an entry made for any name -> G gets one, M\'s refreshed', allOk(m, 5) && nlOf(last(m), G[0]).nl === 1 && nlOf(last(m), M).at !== atOf(M),
      JSON.stringify([nlOf(last(m), G[0]), nlOf(last(m), M).at, atOf(M)]));
  });
}

// ---- [2] three matches against three pairs of opponents ----
{
  const c = keysCase([0, 1, 2].map((k) => [6, 0xB162 + k, [O[2 * k], O[2 * k + 1], P1, M], [[0, O[2 * k]], [1, O[2 * k + 1]], [2, P1]], 0]));
  const rs = from(c), r = last(rs);
  const n = nlOf(r, M);
  T('[2] runs exit 0, all three unrated', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k)) && (outOf(rs).match(/named-loser [^\n]*\(Q149\)/g) || []).length === 3, r.out.slice(-800));
  T('[2] nl 3, nlo the six winners, tw / tl 1 / 0', n.nl === 3 && (n.nlo || []).length === 6 && n.tw === 1 && !n.tl, JSON.stringify(n));
  T('[2] the lines count 1, 2, 3, the third repeated and more losses unwritten than written; the row 3 / 1 / 1 / 0',
    COUNT_LINE('[0-9_]+', M, 1, 2, 1, 0, false, false).test(outOf(rs)) && COUNT_LINE('[0-9_]+', M, 2, 4, 1, 0, false, false).test(outOf(rs))
    && COUNT_LINE('[0-9_]+', M, 3, 6, 1, 0, true, true).test(outOf(rs)) && ROWS(rs, [3, 1, 1, 0]), q161Lines(rs) + ' ' + JSON.stringify(rowSum(rs)));
  T('[2] nobody flagged', [M, P1].concat(O.slice(0, 6)).every((s) => fOf(r, s) === 0));
  withMutant('opp', OPP, '', (script) => {
    const m = from(c, script);
    T('[2] mutant: opponents not kept -> nl 3 but not repeated', allOk(m, 5) && nlOf(last(m), M).nl === 3 && !/, repeated/.test(q161Lines(m)) && ROWS(m, [3, 0, 0, 0]),
      JSON.stringify(nlOf(last(m), M)));
  });
}

// ---- [3] one pair of accounts names V on the losing team in three made-up matches ----
{
  const c = keysCase([0, 1, 2].map((k) => [6, 0xB165 + k, [X, G[k], Y, V], [[0, X], [2, Y]], 0]));
  const rs = from(c), r = last(rs);
  const n = nlOf(r, V);
  T('[3] runs exit 0, all three unrated (Q149)', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k)) && [X, Y].every((s) => none(rs, s)), r.out.slice(-800));
  T('[3] V: nl 3, nlo 1 (only X wrote a win against him): not repeated, not marked, the row 3 / 0 / 0 / 0', n.nl === 3 && (n.nlo || []).length === 1
    && !/, repeated/.test(q161Lines(rs)) && ROWS(rs, [3, 0, 0, 0]), JSON.stringify(n) + ' ' + JSON.stringify(rowSum(rs)));
  T('[3] the winning side\'s made-up seats (G) are not counted, get no entry', G.slice(0, 3).every((s) => !hasEntry(r, s)));
  withMutant('rep', REP, '        const rep = h.nl >= NL_REPEAT;\n', (script) => {
    const m = from(c, script);
    T('[3] mutant: the different opponents not required -> repeated', allOk(m, 5) && /, repeated/.test(q161Lines(m)), q161Lines(m));
  });
}

// ---- [4] a blank seat and a named-only seat on the winning team ----
{
  // seat 1 (winning team) = V named by the others only, seat 3 (losing team) blank: unrated by the blank seat, nothing to count
  const c = keysCase([[6, 0xB168, [P1, V, P3, '0'], [[0, P1], [2, P3]], 0]]);
  const rs = from(c), r = last(rs);
  T('[4] unrated (seat 3 blank), nothing counted: V is on the winning team, seat 3 has no account', allOk(rs, 5) && /named-loser [^\n]*seat 3 \(no account on the roster\)/.test(outOf(rs))
    && !nlOf(r, V).nl && !/named-loser-account /.test(outOf(rs)) && ROWS(rs, [0, 0, 0, 0]), r.out.slice(-800));
  withMutant('lose', LOSE, '', (script) => {
    const m = from(c, script);
    T('[4] mutant: both teams counted -> V counted', allOk(m, 5) && nlOf(last(m), V).nl === 1, JSON.stringify(nlOf(last(m), V)));
  });
}

// ---- [5] five matches against five pairs: the opponents stop at the cap ----
{
  const c = keysCase([0, 1, 2, 3, 4].map((k) => [6, 0xB170 + k, [O[2 * k], O[2 * k + 1], P1, M], [[0, O[2 * k]], [1, O[2 * k + 1]], [2, P1]], 0]));
  const rs = from(c), r = last(rs);
  const n = nlOf(r, M);
  T('[5] nl 5, nlo stops at 8, the line shows 8+', allOk(rs, 5) && n.nl === 5 && (n.nlo || []).length === 8 && COUNT_LINE('[0-9_]+', M, 5, '8\\+', 1, 0, true, true).test(outOf(rs)),
    JSON.stringify(n));
  withMutant('cap', OPP, OPP.replace('o.length < NL_OPP_CAP && ', ''), (script) => {
    const m = from(c, script);
    T('[5] mutant: the cap off -> nlo 10', allOk(m, 5) && (nlOf(last(m), M).nlo || []).length === 10, JSON.stringify(nlOf(last(m), M)));
  });
}

// ---- [6] rated matches count nothing but the written results ----
{
  const c = keysCase([[6, 0xB176, [P1, P2, P3, P4], [[0, P1], [1, P2], [2, P3], [3, P4]], 0]]);
  const rs = from(c), r = last(rs);
  T('[6] a rated 2V2 (every seat writes): rated, nothing counted, tw 1 for P1 / P2, tl 1 for P3 / P4', allOk(rs, 5) && up(rs, P1) && down(rs, P3) && !/named-loser/.test(outOf(rs))
    && [P1, P2, P3, P4].every((s) => !nlOf(r, s).nl) && [P1, P2].every((s) => nlOf(r, s).tw === 1 && !nlOf(r, s).tl) && [P3, P4].every((s) => nlOf(r, s).tl === 1 && !nlOf(r, s).tw),
    JSON.stringify([P1, P3].map((s) => nlOf(r, s))));
  const fr = [P1, G[5], P3, P4];
  const S = fr.filter((s) => s !== G[5]).map((s) => ({ sid: s, d: ffaStart(0xB177, fr.indexOf(s), fr) }));
  const R = fr.filter((s) => s !== G[5]).map((s) => ({ sid: s, d: ffaSettle(0xB177, fr.indexOf(s), fr) }));
  const fs2 = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [LEAVE, S.concat(R)], [3 * HOUR, S.concat(R)]], null, F0);
  T('[6] a 4-player FFA with a named-only seat: nothing counted, no tw / tl', allOk(fs2, 5) && !/named-loser/.test(outOf(fs2)) && !nlOf(last(fs2), G[5]).nl
    && [P1, P3, P4].every((s) => !nlOf(last(fs2), s).tw && !nlOf(last(fs2), s).tl), last(fs2).out.slice(-600));
}

// ---- [7] H wrote three lost team matches: three named-only losses more are repeated, not marked ----
{
  const c = keysCase([0, 1, 2].map((k) => [6, 0xB178 + k, [O[2 * k], O[2 * k + 1], P1, H], [[0, O[2 * k]], [1, O[2 * k + 1]], [2, P1]], 0]));
  const rs = from(c), r = last(rs);
  const n = nlOf(r, H);
  T('[7] runs exit 0, nl 3, nlo 6, tl 3', allOk(rs, 5) && n.nl === 3 && (n.nlo || []).length === 6 && n.tl === 3 && !n.tw, JSON.stringify(n));
  T('[7] the third line repeated, not more losses unwritten than written; the row 3 / 1 / 0 / 0', COUNT_LINE('[0-9_]+', H, 3, 6, 0, 3, true, false).test(outOf(rs))
    && !/unwritten than written/.test(q161Lines(rs)) && ROWS(rs, [3, 1, 0, 0]), q161Lines(rs) + ' ' + JSON.stringify(rowSum(rs)));
  withMutant('unw', UNW, '        const unw = rep;\n', (script) => {
    const m = from(c, script);
    T('[7] mutant: tl ignored -> marked', allOk(m, 5) && /more losses unwritten than written/.test(q161Lines(m)) && ROWS(m, [3, 1, 1, 0]), q161Lines(m));
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (named-loser-count) ===' : '=== PASS -- 0 fail (named-loser-count) ===');
process.exit(failN ? 1 : 0);
