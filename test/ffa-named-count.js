'use strict';
// Q174 (cloud audit 2026-10, found doing Q161): a named-only seat placed in the lower half of a matchmade FFA is counted on
//   its account, the way Q161 counts a named-only seat on a losing team. A seat named by the others only (no start, result
//   or confession of its own for the key) is not rated and not convicted (Q69), so a modified client can write its good
//   places only (the result alone, rated like a cold rejoiner) and nothing for its bad ones: it counts only its good places.
//   Now such a seat's account carries the count, with its other signals: `nb` = such matches (the seat placed below the
//   middle on the agreed scores), `nbo` = the different accounts that wrote the match (up to NL_OPP_CAP), next to `wb` =
//   the lower-half places each writer wrote himself (quick or ranked FFA). Only an account that already has signals of its
//   own is counted (a made-up name gets no entry) and the count does not refresh the entry. A count of NL_REPEAT or more
//   matches and different opponents is logged `repeated`; with more lower places unwritten than written (nb > wb) also
//   `more lower places unwritten than written`; both counted in the summary. Nobody is flagged; the settle is unchanged.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/named-loser-count.js).
//   Every case starts from one carried state (the prior): M and V each wrote a 1st place, H three 4th places.
//   [0] wiring pins: the place helpers; the count after the Q161 one and before the rating update, quick and ranked FFA
//       only, never in the playtest channel; the writers' places, the lookup, the count; the summary row
//   [u] the place helpers: ties share a place, the lower half by player count 2..6
//   [p] the prior: wb counted for the writers' lower-half places, nothing else; mutant (writers' places not checked) -> wb
//       for every writer
//   [1] ranked 4P, M (seat 3, last) named by the others only, O0..O2 write -> rated among the three as before; M's nb 1,
//       nbo the three writers, wb 0, his entry not refreshed, the account line, nobody flagged or convicted; another
//       match names G (no signals of his own) last -> not counted, no entry made; the row 1 / 0 / 0 / 1; mutants (count
//       off -> nb 0; an entry made for any name -> G gets one, M's refreshed)
//   [2] three ranked 3P matches, M last, against three pairs -> nb 3, nbo 6, the third line `repeated` and (M wrote no
//       lower place) `more lower places unwritten than written`, the row 3 / 1 / 1 / 0; mutant (opponents not kept) -> not
//       repeated
//   [3] two accounts writing three made-up 3P matches that name V last -> nb 3 but nbo 2: not repeated; three accounts
//       taking turns (two writing each match) -> nbo 3: repeated (three accounts are enough, as in Q161); mutant (the
//       opponents not required) -> repeated with two
//   [4] a named-only seat placed 2nd of 4 and 2nd of 3 (the middle) is not counted; mutant (any place) -> counted
//   [5] quick FFA counted the same (no points move there); mutant (ranked only) -> not counted
//   [6] H, who wrote three 4th places, named-only last in three more against three pairs -> `repeated` but nb 3 not over
//       wb 3: not marked, the row 3 / 1 / 0 / 0; mutant (wb ignored) -> marked
//   [7] honest matches: a ranked 4P everybody writes -> rated, nothing counted, wb for 3rd and 4th; a ranked 2V2 everybody
//       writes -> no wb (Q161's tw / tl only)
//   [8] four 4P matches against four triples -> nbo stops at NL_OPP_CAP (the line shows 8+); mutant (cap off) -> 12
//   [9] a tie at the bottom: the named-only seat shares 3rd of 4 with a writer -> both lower half (nb 1, the writer's wb)
//   [10] the playtest channel (no rating or points move there, nothing to gain by writing only good places): a quick 4P
//       with M last named-only is not counted, no wb; mutant (the playtest guard off) -> counted
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/named-loser-count.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffa-named-count-'));
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
  const script = path.join(__dirname, '..', '.mutant-ffa-named-count-' + tag + '-' + process.pid + '.js');
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
// FFA keys: { mt (1 quick, 2 ranked), h, ros (one account per seat), sc (the agreed seat scores), writers (seats writing a
//   start and a result), resOnly (of them the seats writing the result only, like a cold rejoiner) }
function ffaKeys(cases) {
  const S = [], A = [], keys = [];
  for (const { mt, h, ros, sc, writers, resOnly } of cases) {
    const s = writers.filter((i) => !(resOnly || []).includes(i)).map((i) => ({ sid: ros[i], d: rec(0xB2, mt, h, i, 0, false, ros, sc) }));
    const r = writers.map((i) => ({ sid: ros[i], d: rec(0xB1, mt, h, i, placeIn(sc, i), placeIn(sc, i) === 1, ros, sc) }));
    S.push(...s); A.push(...s, ...r); keys.push(keyOf((s[0] || r[0]).d));
  }
  return { keys, steps: [[0, S], [5 * MIN, A], [GRACE, A], [LEAVE, A], [3 * HOUR, A]] };
}
const sigOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {});
const hasEntry = (r, sid) => !!(((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]);
const COUNT_LINE = (key, sid, place, pc, n, o, wb, rep, unw) => new RegExp('named-ffa-account ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' place ' + place + ' of ' + pc
  + ' -- ' + n + ' such match\\(es\\), ' + o + ' different opponent\\(s\\), lower-half places he wrote ' + wb + (rep ? ', repeated' : '')
  + (unw ? ', more lower places unwritten than written' : '') + '; counted, nobody flagged \\(Q174\\)');
const NONE_LINE = (key, sid) => new RegExp('named-ffa-account ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' place [0-9] of [0-9] -- no signals of his own \\(no record of his this cron kept\\), not counted \\(Q174\\)');
const ROW_RE = /\| named-only FFA seats in the lower half counted on their account \/ of them repeated: 3 or more such matches and different opponents \/ of those more lower places unwritten than written \/ not counted, no signals of his own \(Q174, nobody flagged\) \| (\d+) \/ (\d+) \/ (\d+) \/ (\d+) \|/;
const rowSum = (rs) => rs.reduce((a, r) => { const m = ROW_RE.exec(r.summary || ''); return m ? a.map((x, i) => x + +m[i + 1]) : [NaN, NaN, NaN, NaN]; }, [0, 0, 0, 0]);
const ROWS = (rs, want) => JSON.stringify(rowSum(rs)) === JSON.stringify(want);
const q174Lines = (rs) => outOf(rs).split('\n').filter((l) => /Q174/.test(l)).join('\n');
const GUARD = "    if (!PT_MODE && (baseMt(matchType) === 1 || baseMt(matchType) === 2)) {\n      for (const p of parts) {\n";
const WPLACE = "        if (!ffaLowerHalf(ffaPlaceOf(scores, p.seat), pc)) continue;\n";
const WB = "        if (h) { h.wb = (h.wb | 0) + 1; sigDirty = true; }\n";
const NPLACE = "        if (!ffaLowerHalf(place, pc)) continue;\n";
const LOOKUP = "        const h = signals.players[pid(String(x.steamID))];   // only an account that already has signals, its entry not refreshed\n        if (!h) {\n          RUN.nbNone";
const COUNT = "        h.nb = (h.nb | 0) + 1;\n";
const OPP = "        for (const q of nbOpp) if (o.length < NL_OPP_CAP && o.indexOf(q) < 0) o.push(q);\n";
const REP = "        const rep = h.nb >= NL_REPEAT && o.length >= NL_REPEAT;\n";
const UNW = "        const unw = rep && h.nb > (h.wb | 0);\n";
const Q161_END = "          + (rep ? ', repeated' : '') + (unw ? ', more losses unwritten than written' : '') + '; counted, nobody flagged (Q161)');\n";
const RATE = "    if (!PT_MODE) {\n      const tsIn = ";
const M = SID(401), V = SID(402), H = SID(403), O = Array.from({ length: 12 }, (_, i) => SID(411 + i)), J = Array.from({ length: 6 }, (_, i) => SID(431 + i));
const X = SID(441), Y = SID(442), Z = SID(443), G = Array.from({ length: 4 }, (_, i) => SID(451 + i));
ALL.push(M, V, H, X, Y, Z, ...O, ...J, ...G);
const S4 = [6100, 5200, 4800, 3900], S3 = [6100, 5200, 3000];

console.log('=== a named-only FFA seat in the lower half is counted on its account (Q174) ===');

// ---- [0] wiring ----
{
  const at = (a) => SRC.indexOf(a);
  T('[0] after the Q161 count, before the rating update: the guard, the writers\' places, the lookup, the count',
    [Q161_END, GUARD, WPLACE, WB, NPLACE, LOOKUP, COUNT].every((a) => SRC.split(a).length === 2) && at(Q161_END) < at(GUARD) && at(GUARD) < at(WPLACE) && at(WPLACE) < at(WB)
    && at(WB) < at(NPLACE) && at(NPLACE) < at(LOOKUP) && at(LOOKUP) < at(COUNT) && at(COUNT) < SRC.indexOf(RATE, at(COUNT)) && SRC.split(RATE).length === 2);
  T('[0] the two counts kept apart: Q161\'s lookup line still occurs once (its own test anchors on it)',
    SRC.split("        const h = signals.players[pid(String(x.steamID))];\n        if (!h) {\n").length === 2);
  T('[0] the opponents kept up to the cap, repeated on both, the unwritten mark on wb', [OPP, REP, UNW].every((a) => SRC.split(a).length === 2) && v.NL_OPP_CAP === 8 && v.NL_REPEAT === 3);
  T('[0] the Q174 summary row', /named-only FFA seats in the lower half counted on their account \/ of them repeated: ' \+ NL_REPEAT \+ ' or more such matches and different opponents \/ of those more lower places unwritten than written \/ not counted, no signals of his own \(Q174, nobody flagged\) \| ' \+ s\('nbSeat', 0\) \+ ' \/ ' \+ s\('nbRepeat', 0\) \+ ' \/ ' \+ s\('nbUnwritten', 0\) \+ ' \/ ' \+ s\('nbNone', 0\)/.test(SRC));
}

// ---- [u] the place helpers ----
{
  T('[u] places: 1 + the seats with a higher score, a tie shares the place', v.ffaPlaceOf([6100, 3000, 3000, 2800], 0) === 1 && v.ffaPlaceOf([6100, 3000, 3000, 2800], 1) === 2
    && v.ffaPlaceOf([6100, 3000, 3000, 2800], 2) === 2 && v.ffaPlaceOf([6100, 3000, 3000, 2800], 3) === 4 && v.ffaPlaceOf([0, 0, 0], 2) === 1 && v.ffaPlaceOf([0, 5], 0) === 2);
  const low = (pc) => [1, 2, 3, 4, 5, 6].filter((p) => p <= pc && v.ffaLowerHalf(p, pc)).join(',');
  T('[u] the lower half: 2 of 2; 3 of 3; 3-4 of 4; 4-5 of 5; 4-6 of 6', low(2) === '2' && low(3) === '3' && low(4) === '3,4' && low(5) === '4,5' && low(6) === '4,5,6',
    [2, 3, 4, 5, 6].map(low).join(' | '));
}

// ---- [p] the prior: M and V each a 1st place, H three 4th places ----
const PRIOR = ffaKeys([{ mt: 2, h: 0xF150, ros: [M, J[0], J[1], J[2]], sc: S4, writers: [0, 1, 2, 3] }, { mt: 2, h: 0xF151, ros: [V, J[3], J[4], J[5]], sc: S4, writers: [0, 1, 2, 3] }]
  .concat([0, 1, 2].map((k) => ({ mt: 2, h: 0xF152 + k, ros: [J[0], J[3], J[k + 1 === 3 ? 4 : k + 1], H], sc: S4, writers: [0, 1, 2, 3] }))));
let F0 = null;
{
  const rs = timeline(PRIOR.steps), r = last(rs);
  const hp = ptsIn(rs, H);
  T('[p] runs exit 0, the five rated (points moved: M up, H down)', allOk(rs, 5) && PRIOR.keys.every((k) => processedOf(r).has(k)) && up(rs, M) && hp.length > 0 && hp[hp.length - 1] < 2500,
    JSON.stringify([rs.map((x) => x.code), ptsIn(rs, M), hp]));
  const m = sigOf(r, M), vv = sigOf(r, V), hh = sigOf(r, H);
  T('[p] wb: M and V 0 (1st), H 3 (4th each time), J5 1 (4th once), J3 0 (2nd each time)', !m.wb && !vv.wb && hh.wb === 3 && sigOf(r, J[5]).wb === 1 && !sigOf(r, J[3]).wb, JSON.stringify([m, hh]));
  T('[p] nothing counted, no tw / tl', !/named-ffa-account/.test(outOf(rs)) && ROWS(rs, [0, 0, 0, 0]) && ![M, V, H].some((s) => sigOf(r, s).nb || sigOf(r, s).tw || sigOf(r, s).tl));
  withMutant('wplace', WPLACE, '', (script) => {
    const mr = timeline(PRIOR.steps, script);
    T('[p] mutant: the writers\' places not checked -> M wb 1', allOk(mr, 5) && sigOf(last(mr), M).wb === 1, JSON.stringify(sigOf(last(mr), M)));
  });
  F0 = advance(r.state, 6 * HOUR);
}
const from = (c, script) => timeline(c.steps, script, F0);
const atOf = (sid) => F0.SIGNALS_FILE.players[v.pid(sid)].at;

// ---- [1] one ranked 4P: M (seat 3, last) writes nothing, O0..O2 write; G named alike in another ----
{
  const c = ffaKeys([{ mt: 2, h: 0xF161, ros: [O[0], O[1], O[2], M], sc: S4, writers: [0, 1, 2] }, { mt: 2, h: 0xF16A, ros: [O[3], O[4], O[5], G[0]], sc: S4, writers: [0, 1, 2] }]);
  const rs = from(c), r = last(rs);
  T('[1] runs exit 0, both settled, rated among the writers (O0 up, O2 down), M and G not rated', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k))
    && up(rs, O[0]) && down(rs, O[2]) && none(rs, M) && none(rs, G[0]), r.out.slice(-800));
  const n = sigOf(r, M);
  T('[1] M\'s account: nb 1, nbo the three writers, wb 0, the entry not refreshed', n.nb === 1 && JSON.stringify(n.nbo) === JSON.stringify([O[0], O[1], O[2]].map(v.pid))
    && !n.wb && n.at === atOf(M), JSON.stringify(n));
  T('[1] the account line', COUNT_LINE(c.keys[0], M, 4, 4, 1, 3, 0, false, false).test(outOf(rs)), q174Lines(rs));
  T('[1] G (no signals of his own): the not-counted line, no entry made', NONE_LINE(c.keys[1], G[0]).test(outOf(rs)) && !hasEntry(r, G[0]), q174Lines(rs));
  T('[1] the row adds up to 1 / 0 / 0 / 1', ROWS(rs, [1, 0, 0, 1]), JSON.stringify(rowSum(rs)));
  T('[1] the writers: O2 and O5 (3rd of 4) wb 1, the others none; no nb', [O[2], O[5]].every((s) => sigOf(r, s).wb === 1) && [O[0], O[1], O[3], O[4]].every((s) => !sigOf(r, s).wb)
    && O.slice(0, 6).every((s) => !sigOf(r, s).nb));
  T('[1] nobody flagged, nobody convicted', [O[0], O[1], O[2], M].every((s) => fOf(r, s) === 0) && leavesOf(r, M) === 0, flags(r, [O[0], O[1], O[2], M]));
  withMutant('count', COUNT, '        h.nb = h.nb | 0;\n', (script) => {
    const m = from(c, script);
    T('[1] mutant: the count off -> nb stays 0', allOk(m, 5) && !(sigOf(last(m), M).nb > 0), JSON.stringify(sigOf(last(m), M)));
  });
  withMutant('entry', LOOKUP, "        const h = sigPlayer(signals, pid(String(x.steamID)), nowMs);\n        if (!h) {\n          RUN.nbNone", (script) => {
    const m = from(c, script);
    T('[1] mutant: an entry made for any name -> G gets one, M\'s refreshed', allOk(m, 5) && sigOf(last(m), G[0]).nb === 1 && sigOf(last(m), M).at !== atOf(M),
      JSON.stringify([sigOf(last(m), G[0]), sigOf(last(m), M).at, atOf(M)]));
  });
}

// ---- [2] three ranked 3P matches, M last, against three pairs ----
{
  const c = ffaKeys([0, 1, 2].map((k) => ({ mt: 2, h: 0xF162 + k, ros: [O[2 * k], O[2 * k + 1], M], sc: S3, writers: [0, 1] })));
  const rs = from(c), r = last(rs);
  const n = sigOf(r, M);
  T('[2] runs exit 0, all three settled', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k)) && none(rs, M), r.out.slice(-800));
  T('[2] nb 3, nbo the six writers, wb 0', n.nb === 3 && (n.nbo || []).length === 6 && !n.wb, JSON.stringify(n));
  T('[2] the lines count 1, 2, 3, the third repeated and more lower places unwritten than written; the row 3 / 1 / 1 / 0',
    COUNT_LINE('[0-9_]+', M, 3, 3, 1, 2, 0, false, false).test(outOf(rs)) && COUNT_LINE('[0-9_]+', M, 3, 3, 2, 4, 0, false, false).test(outOf(rs))
    && COUNT_LINE('[0-9_]+', M, 3, 3, 3, 6, 0, true, true).test(outOf(rs)) && ROWS(rs, [3, 1, 1, 0]), q174Lines(rs) + ' ' + JSON.stringify(rowSum(rs)));
  T('[2] nobody flagged', [M].concat(O.slice(0, 6)).every((s) => fOf(r, s) === 0));
  withMutant('opp', OPP, '', (script) => {
    const m = from(c, script);
    T('[2] mutant: opponents not kept -> nb 3 but not repeated', allOk(m, 5) && sigOf(last(m), M).nb === 3 && !/, repeated/.test(q174Lines(m)) && ROWS(m, [3, 0, 0, 0]),
      JSON.stringify(sigOf(last(m), M)));
  });
}

// ---- [3] made-up matches naming V last: two accounts, then three ----
{
  const c = ffaKeys([0, 1, 2].map((k) => ({ mt: 2, h: 0xF165 + k, ros: [X, Y, V], sc: S3, writers: [0, 1] })));
  const rs = from(c), r = last(rs);
  const n = sigOf(r, V);
  T('[3] two accounts: runs exit 0, V nb 3, nbo 2 -- not repeated, the row 3 / 0 / 0 / 0', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k)) && n.nb === 3
    && (n.nbo || []).length === 2 && !/, repeated/.test(q174Lines(rs)) && ROWS(rs, [3, 0, 0, 0]) && none(rs, V), JSON.stringify(n) + ' ' + JSON.stringify(rowSum(rs)));
  const pairs = [[X, Y], [Y, Z], [Z, X]];
  const c3 = ffaKeys([0, 1, 2].map((k) => ({ mt: 2, h: 0xF168 + k, ros: [pairs[k][0], pairs[k][1], V], sc: S3, writers: [0, 1] })));
  const r3 = from(c3), n3 = sigOf(last(r3), V);
  T('[3] three accounts taking turns: V nb 3, nbo 3 -- repeated and more lower places unwritten than written (counted only: V not rated, not flagged)',
    allOk(r3, 5) && n3.nb === 3 && (n3.nbo || []).length === 3 && COUNT_LINE('[0-9_]+', V, 3, 3, 3, 3, 0, true, true).test(outOf(r3)) && none(r3, V) && fOf(last(r3), V) === 0,
    JSON.stringify(n3) + ' ' + q174Lines(r3));
  withMutant('rep', REP, '        const rep = h.nb >= NL_REPEAT;\n', (script) => {
    const m = from(c, script);
    T('[3] mutant: the different opponents not required -> repeated with two', allOk(m, 5) && /, repeated/.test(q174Lines(m)), q174Lines(m));
  });
}

// ---- [4] a named-only seat in the upper half or the middle ----
{
  const c = ffaKeys([{ mt: 2, h: 0xF16B, ros: [O[0], V, O[1], O[2]], sc: S4, writers: [0, 2, 3] }, { mt: 2, h: 0xF16C, ros: [O[3], V, O[4]], sc: S3, writers: [0, 2] }]);
  const rs = from(c), r = last(rs);
  T('[4] V placed 2nd of 4 and 2nd of 3: not counted, no line, the row 0 / 0 / 0 / 0', allOk(rs, 5) && c.keys.every((k) => processedOf(r).has(k)) && !sigOf(r, V).nb
    && !/named-ffa-account/.test(outOf(rs)) && ROWS(rs, [0, 0, 0, 0]), q174Lines(rs));
  withMutant('nplace', NPLACE, '', (script) => {
    const m = from(c, script);
    T('[4] mutant: any place counted -> V nb 2', allOk(m, 5) && sigOf(last(m), V).nb === 2, JSON.stringify(sigOf(last(m), V)));
  });
}

// ---- [5] quick FFA counted the same ----
{
  const c = ffaKeys([{ mt: 1, h: 0xF16D, ros: [O[6], O[7], O[8], M], sc: S4, writers: [0, 1, 2] }]);
  const rs = from(c), r = last(rs);
  T('[5] quick 4P, M last named-only: settled, no points for anybody, M nb 1, nbo 3', allOk(rs, 5) && processedOf(r).has(c.keys[0]) && [O[6], O[7], O[8], M].every((s) => none(rs, s))
    && sigOf(r, M).nb === 1 && (sigOf(r, M).nbo || []).length === 3 && sigOf(r, O[8]).wb === 1, JSON.stringify(sigOf(r, M)) + r.out.slice(-600));
  withMutant('ranked', GUARD, GUARD.replace('(baseMt(matchType) === 1 || baseMt(matchType) === 2)', 'baseMt(matchType) === 2'), (script) => {
    const m = from(c, script);
    T('[5] mutant: ranked only -> not counted', allOk(m, 5) && !sigOf(last(m), M).nb, JSON.stringify(sigOf(last(m), M)));
  });
}

// ---- [6] H wrote three 4th places: three named-only ones more are repeated, not marked ----
{
  const c = ffaKeys([0, 1, 2].map((k) => ({ mt: 2, h: 0xF178 + k, ros: [O[2 * k], O[2 * k + 1], H], sc: S3, writers: [0, 1] })));
  const rs = from(c), r = last(rs);
  const n = sigOf(r, H);
  T('[6] runs exit 0, nb 3, nbo 6, wb 3', allOk(rs, 5) && n.nb === 3 && (n.nbo || []).length === 6 && n.wb === 3, JSON.stringify(n));
  T('[6] the third line repeated, not more lower places unwritten than written; the row 3 / 1 / 0 / 0', COUNT_LINE('[0-9_]+', H, 3, 3, 3, 6, 3, true, false).test(outOf(rs))
    && !/unwritten than written/.test(q174Lines(rs)) && ROWS(rs, [3, 1, 0, 0]), q174Lines(rs) + ' ' + JSON.stringify(rowSum(rs)));
  withMutant('unw', UNW, '        const unw = rep;\n', (script) => {
    const m = from(c, script);
    T('[6] mutant: wb ignored -> marked', allOk(m, 5) && /more lower places unwritten than written/.test(q174Lines(m)) && ROWS(m, [3, 1, 1, 0]), q174Lines(m));
  });
}

// ---- [7] honest matches: everybody writes ----
{
  const c = ffaKeys([{ mt: 2, h: 0xF17B, ros: [O[0], O[1], O[2], O[3]], sc: S4, writers: [0, 1, 2, 3] }]);
  const rs = from(c), r = last(rs);
  T('[7] a ranked 4P everybody writes: rated, nothing counted, wb 1 for 3rd and 4th only', allOk(rs, 5) && up(rs, O[0]) && down(rs, O[3]) && !/named-ffa-account/.test(outOf(rs))
    && ROWS(rs, [0, 0, 0, 0]) && [O[2], O[3]].every((s) => sigOf(r, s).wb === 1) && [O[0], O[1]].every((s) => !sigOf(r, s).wb) && O.slice(0, 4).every((s) => !sigOf(r, s).nb), q174Lines(rs));
  const ros2 = [O[4], O[5], O[6], O[7]], mt2 = 6, h2 = 0xF17C;
  const S = ros2.map((s, i) => ({ sid: s, d: rec(0xB2, mt2, h2, i, 0, false, ros2) }));
  const R = ros2.map((s, i) => ({ sid: s, d: rec(0xB1, mt2, h2, i, i < 2 ? 1 + i : 3 + (i - 2), i < 2, ros2, S4) }));
  const t = timeline([[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [LEAVE, S.concat(R)], [3 * HOUR, S.concat(R)]], null, F0);
  T('[7] a ranked 2V2 everybody writes: rated, no wb (tw / tl only)', allOk(t, 5) && up(t, O[4]) && down(t, O[6]) && ros2.every((s) => !sigOf(last(t), s).wb)
    && sigOf(last(t), O[6]).tl === 1 && sigOf(last(t), O[4]).tw === 1, JSON.stringify(ros2.map((s) => sigOf(last(t), s))));
}

// ---- [8] four 4P matches against four triples: the opponents stop at the cap ----
{
  const c = ffaKeys([0, 1, 2, 3].map((k) => ({ mt: 2, h: 0xF180 + k, ros: [O[3 * k], O[3 * k + 1], O[3 * k + 2], M], sc: S4, writers: [0, 1, 2] })));
  const rs = from(c), r = last(rs);
  const n = sigOf(r, M);
  T('[8] nb 4, nbo stops at 8, the line shows 8+', allOk(rs, 5) && n.nb === 4 && (n.nbo || []).length === 8 && COUNT_LINE('[0-9_]+', M, 4, 4, 4, '8\\+', 0, true, true).test(outOf(rs)),
    JSON.stringify(n));
  withMutant('cap', OPP, OPP.replace('o.length < NL_OPP_CAP && ', ''), (script) => {
    const m = from(c, script);
    T('[8] mutant: the cap off -> nbo 12', allOk(m, 5) && (sigOf(last(m), M).nbo || []).length === 12, JSON.stringify(sigOf(last(m), M)));
  });
}

// ---- [9] a tie at the bottom ----
{
  const c = ffaKeys([{ mt: 2, h: 0xF185, ros: [O[9], O[10], O[11], V], sc: [6100, 5200, 3000, 3000], writers: [0, 1, 2] }]);
  const rs = from(c), r = last(rs);
  T('[9] V shares 3rd of 4 with O11: V nb 1 (place 3 of 4), O11 wb 1', allOk(rs, 5) && sigOf(r, V).nb === 1 && sigOf(r, O[11]).wb === 1
    && COUNT_LINE(c.keys[0], V, 3, 4, 1, 3, 0, false, false).test(outOf(rs)), q174Lines(rs));
}

// ---- [10] the playtest channel (no rating or points there): not counted ----
{
  const c = ffaKeys([{ mt: 1, h: 0xF186, ros: [O[0], O[1], O[2], M], sc: S4, writers: [0, 1, 2] }]);
  const PT = { PT_MODE: '1', APPID: '5049450' };
  // the playtest channel refuses to run with a rating or points board on the app (lock layer 3): the same boards without them
  const ptTimeline = (script) => {
    const out = []; let state = null;
    for (const [ms, recs] of c.steps) {
      const r = runCron(boardsWith(recs).filter((b) => b.name !== 'rating' && b.name !== 'points'), state ? advance(state, ms) : F0, PT, script);
      out.push(r); state = r.state;
      if (r.code !== 0) break;
    }
    return out;
  };
  const rs = ptTimeline(null), r = last(rs);
  T('[10] playtest quick 4P, M last named-only: settled, nothing counted, no line, no wb, the row 0 / 0 / 0 / 0', allOk(rs, 5) && processedOf(r).has(c.keys[0])
    && !/named-ffa-account/.test(outOf(rs)) && ROWS(rs, [0, 0, 0, 0]) && (sigOf(r, M).nb | 0) === 0 && !sigOf(r, O[2]).wb, q174Lines(rs) + r.out.slice(-600));
  withMutant('pt', GUARD, GUARD.replace('!PT_MODE && ', ''), (script) => {
    const m = ptTimeline(script);
    T('[10] mutant: the playtest guard off -> counted', allOk(m, 5) && sigOf(last(m), M).nb === 1 && sigOf(last(m), O[2]).wb === 1, JSON.stringify(sigOf(last(m), M)) + last(m).out.slice(-400));
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-named-count) ===' : '=== PASS -- 0 fail (ffa-named-count) ===');
process.exit(failN ? 1 : 0);
