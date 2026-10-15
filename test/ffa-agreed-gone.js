'use strict';
// Q185 (cloud audit 2026-10, found doing Q174): a matchmade FFA seat seen agreeing on its match (pend.agreed) whose record
//   is gone at the settle takes part in the settle as if his record were still there. Before, the match settled among the
//   records left: a player who wrote his last place, was seen agreeing while the group waited for a late record, then
//   overwrote both of his rows with empty ones kept his points (not convicted: he was seen agreeing) and the honest players
//   around him took the smaller field. Now his seat is put back at the place the agreed scores give him: the ranking, the
//   player count, the rating update and the points plan see the full field, and his own rating and points move by that
//   result. XP / CP stay per record. A seat whose own confession for the match still stands stays out (the confession
//   already charged that leave). Team matches are unchanged (Q183 reads such seats in their points plan only).
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-named-count.js).
//   Every case runs twice on the same timeline: the withdrawn run (the seat's rows blanked after the group saw him agree)
//   and its honest twin (the rows stay); "as if present" = the same points, rating and XP posts for every account.
//   [0] wiring pins: the put-back right after the writers' parts and before the ranking, FFA bases 1 / 2 only, the agreed
//       check, the account check, the standing-confession check, the seat order; the summary row
//   [1] ranked 4P, M (seat 3, last) seen agreeing while O2 is late, then both of his rows blanked -> every account's
//       points and rating posts equal the honest twin (O1 +15 / O2 -4 / M -17, not +3 / -17 / none), M not convicted,
//       the put-back line, the row 1 / 0; mutant (put-back off) -> the old smaller field
//   [2] ranked 4P, the 2nd place withdraws -> the others' points, rating and XP equal the honest twin (XP: the 3rd stays
//       3rd, not moved up a place); mutant (seat order not restored) -> equivalent, see mutate-q185.js
//   [3] ranked 3P, M last withdraws -> as the honest twin (two records left: a settle group)
//   [4] an honest player whose next match overwrote his result row (same shard row) while the group waited -> he gets
//       this match's result (the one his client showed), the others as the honest twin
//   [5] M seen agreeing, then his result blanked and a quit confession of his written for the match -> he stays out (the
//       confession's -100 and exit rate only, not the -17 too), the others as before, the left-out line, the row 0 / 1;
//       mutant (confession check off) -> the -17 on top of the -100
//   [6] M confessed a quit, came back and finished (refunded), seen agreeing, then his result gone -> put back: his final
//       points equal the honest twin's; mutant (refund ignored) -> left out
//   [6b] his quit confession first seen next to his own finished record (no fine), then his result gone -> put back;
//       mutant (a confession without a fine counted as standing) -> left out
//   [7] quick FFA: the hidden rating posts equal the honest twin, no points move
//   [8] ranked team brawl (base 4), a losing seat seen agreeing then blanked -> no put-back (his own points do not move,
//       no line; Q183 reads him in the plan); mutant (guard widened to every base) -> he gets points
//   [9] a seat named by the others only (never wrote) -> not put back (Q69 as before); mutant (agreed check off) -> rated
//   [10] premade pair (mask): the withdrawn member's partner settles in the pair unit as in the honest twin
//   [11] residual pinned: a 1V1 where the loser withdraws leaves one record (a lone group never settles, Q184) -> nobody
//       rated, no put-back line, before and after
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/ffa-named-count.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffa-agreed-gone-'));
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
  const script = path.join(__dirname, '..', '.mutant-ffa-agreed-gone-' + tag + '-' + process.pid + '.js');
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
// one key: its starts and results, seat order (rank / win from the agreed scores)
function keyRecs(mt, h, ros, sc) {
  const S = ros.map((s, i) => ({ sid: s, d: rec(0xB2, mt, h, i, 0, false, ros, sc) }));
  const R = ros.map((s, i) => ({ sid: s, d: rec(0xB1, mt, h, i, placeIn(sc, i), placeIn(sc, i) === 1, ros, sc) }));
  return { S, R, key: keyOf(S[0].d), ros };
}
// the withdrawal timeline: the starts; the results with seat `late` missing (the group waits, seat `w` seen agreeing); then
//   seat w's rows replaced by `instead` (nothing by default) and late's result in. The honest twin keeps w's rows.
function wd(k, w, late, opt) {
  const o = opt || {};
  const keepStart = !!o.keepStart, instead = o.instead || [], extra = o.extra || [];
  const all = k.S.concat(k.R, extra);
  const t5 = k.S.concat(k.R.filter((_, i) => i !== late), extra);
  const gone = k.S.filter((_, i) => keepStart || i !== w).concat(k.R.filter((_, i) => i !== w), instead, extra);
  const tail = o.short ? [] : [[3 * HOUR, null]];
  const mk = (x) => [[0, k.S.concat(o.extra0 || [])], [o.t1 || 5 * MIN, t5], [GRACE, x], [LEAVE, x]].concat(tail.map(([ms]) => [ms, x]));
  return { w: mk(gone), o: mk(all) };
}
const BACK_LINE = (key, sid) => new RegExp('agreed-back ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' record gone but seen agreeing earlier -- settled at his agreed place [0-9] of [0-9], as if his record were still there \\(Q185\\)');
const CONF_LINE = (key, sid) => new RegExp('agreed-back ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' record gone but seen agreeing earlier, his own confession for this match stands -- left out \\(Q185\\)');
const ROW_RE = /\| matchmade FFA seats seen agreeing whose record is gone at the settle: settled at their agreed place \/ left out, their own confession for the match standing \(Q185\) \| (\d+) \/ (\d+) \|/;
const rowSum = (rs) => rs.reduce((a, r) => { const m = ROW_RE.exec(r.summary || ''); return m ? [a[0] + +m[1], a[1] + +m[2]] : [NaN, NaN]; }, [0, 0]);
const ROWS = (rs, want) => JSON.stringify(rowSum(rs)) === JSON.stringify(want);
const PARTS_LOOP = "    for (let seat = 0; seat < pc; seat++) { if (seatToId[seat] != null) parts.push({ steamID: seatToId[seat], seat, score: scores[seat] | 0 }); }\n";
const GUARD_IF = 'if (baseMt(matchType) === 1 || baseMt(matchType) === 2) {\n      let back = 0;\n';
const GUARD = '    ' + GUARD_IF;
const AGREED = "        if (!(pend.agreed && pend.agreed.indexOf(hx) >= 0) || parts.some((p) => String(p.steamID) === String(x.steamID))) continue;\n";
const CONF = '        if (cs && !cs.refunded && (cs.ded > 0 || cs.ex)) {\n';
const PUSH = '        parts.push({ steamID: x.steamID, seat: x.seat, score: scores[x.seat] | 0 });\n';
const SEATS = '      if (back) parts.sort((a, b) => a.seat - b.seat);\n';
const SORTED = '    const sorted = [...parts].sort((a, b) => b.score - a.score);\n';
const OFF = (fn) => withMutant('off', GUARD_IF, 'if (false) {\n      let back = 0;\n', fn);
const W = SID(501), H = SID(502), O = Array.from({ length: 12 }, (_, i) => SID(511 + i)), P = [SID(531), SID(532)], N = SID(541), Jn = [SID(551), SID(552), SID(553)];
ALL.push(W, H, ...O, ...P, N, ...Jn);
const S4 = [6100, 5200, 4800, 3900], S3 = [6100, 5200, 3000], S2 = [6100, 3900];

console.log('=== a matchmade FFA seat seen agreeing whose record is gone settles as if it were there (Q185) ===');

// ---- [0] wiring ----
{
  const at = (a) => SRC.indexOf(a);
  T('[0] the put-back right after the writers\' parts, before the ranking: guard, agreed check, confession check, push, seat order',
    [PARTS_LOOP, GUARD, AGREED, CONF, PUSH, SEATS, SORTED].every((a) => SRC.split(a).length === 2) && at(PARTS_LOOP) + PARTS_LOOP.length === at('    // Q185 (cloud audit')
    && at(PARTS_LOOP) < at(GUARD) && at(GUARD) < at(AGREED) && at(AGREED) < at(CONF) && at(CONF) < at(PUSH) && at(PUSH) < at(SEATS) && at(SEATS) < at(SORTED));
  T('[0] the absent seats from the consensus roster (detectLeavers), his own confession keyed on the match',
    SRC.indexOf('      for (const x of detectLeavers(g)) {\n        const hx = pid(String(x.steamID));\n', at(GUARD)) > 0 && SRC.indexOf("        const cs = confState[hx + '|' + c.m];\n", at(AGREED)) > 0);
  T('[0] the Q185 summary row', /'\| matchmade FFA seats seen agreeing whose record is gone at the settle: settled at their agreed place \/ left out, their own confession for the match standing \(Q185\) \| ' \+ s\('agreedBack', 0\) \+ ' \/ ' \+ s\('agreedConf', 0\) \+ ' \|',/.test(SRC));
}

// ---- [1] ranked 4P, M last withdraws ----
{
  const k = keyRecs(2, 0xF185, [O[0], O[1], O[2], W], S4), t = wd(k, 3, 2), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[1] both runs exit 0, settled', allOk(a, 5) && allOk(b, 5) && processedOf(last(a)).has(k.key) && processedOf(last(b)).has(k.key), last(a).out.slice(-600));
  T('[1] every account\'s points and rating posts equal the honest twin (M last: -17 for him)', sameFor(a, b, sids) && down(a, W) && up(a, O[0]), show(a, sids) + ' vs ' + show(b, sids));
  T('[1] M not convicted, the put-back line, the agreed line kept, the row 1 / 0', leavesOf(last(a), W) === 0 && BACK_LINE(k.key, W).test(outOf(a))
    && /record gone but seen agreeing earlier -- finished, not a leaver/.test(outOf(a)) && ROWS(a, [1, 0]) && ROWS(b, [0, 0]), JSON.stringify(rowSum(a)));
  OFF((script) => {
    const m = timeline(t.w, script);
    const p1 = ptsIn(m, O[1]), q1 = ptsIn(b, O[1]), p2 = ptsIn(m, O[2]), q2 = ptsIn(b, O[2]);
    T('[1] mutant: put-back off -> the old smaller field (M not rated, 2nd gains less, 3rd loses more)', allOk(m, 5) && none(m, W) && p1.length === 1 && q1.length === 1 && p1[0] < q1[0]
      && p2.length === 1 && q2.length === 1 && p2[0] < q2[0] && !BACK_LINE(k.key, W).test(outOf(m)), show(m, sids));
  });
}

// ---- [2] ranked 4P, the 2nd place withdraws: XP of the others as well ----
{
  const k = keyRecs(2, 0xF285, [O[3], W, O[4], O[5]], S4), t = wd(k, 1, 3), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  const xpSame = [O[3], O[4], O[5]].every((s) => xpOf(a, s) === xpOf(b, s) && xpOf(a, s) > 0);
  T('[2] points and rating posts equal the honest twin, the withdrawn 2nd gains as in the twin', allOk(a, 5) && allOk(b, 5) && sameFor(a, b, sids) && up(a, W), show(a, sids) + ' vs ' + show(b, sids));
  T('[2] the present players\' XP equals the twin (the 3rd stays 3rd), the withdrawn one gets none (no record)', xpSame && xpOf(a, W) === 0 && xpOf(b, W) > 0,
    JSON.stringify(sids.map((s) => [xpOf(a, s), xpOf(b, s)])));
  OFF((script) => {
    const m = timeline(t.w, script);
    T('[2] mutant: put-back off -> the 3rd place\'s XP moves up a place', allOk(m, 5) && xpOf(m, O[4]) > xpOf(b, O[4]), JSON.stringify([xpOf(m, O[4]), xpOf(b, O[4])]));
  });
}

// ---- [3] ranked 3P, M last withdraws ----
{
  const k = keyRecs(2, 0xF385, [O[6], O[7], W], S3), t = wd(k, 2, 1), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[3] ranked 3P: every account as the honest twin, the put-back line', allOk(a, 5) && allOk(b, 5) && sameFor(a, b, sids) && down(a, W) && BACK_LINE(k.key, W).test(outOf(a)),
    show(a, sids) + ' vs ' + show(b, sids));
}

// ---- [4] an honest player's result row overwritten by his next match's start while the group waited ----
{
  const k = keyRecs(2, 0xF485, [O[8], H, O[9], O[10]], S4);
  const next = { sid: H, d: rec(0xB2, 2, 0xF486, 0, 0, false, [H, Jn[0], Jn[1], Jn[2]], S4), shard: 1 };   // his start row is shard 0, his result row shard 1
  const t = wd(k, 1, 2, { keepStart: true, instead: [next], short: true }), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[4] the honest 2nd gets this match\'s result (as the twin), the others as the twin, he is not convicted', allOk(a, 4) && allOk(b, 4) && sameFor(a, b, sids) && up(a, H)
    && leavesOf(last(a), H) === 0 && BACK_LINE(k.key, H).test(outOf(a)), show(a, sids) + ' vs ' + show(b, sids) + last(a).out.slice(-500));
  OFF((script) => {
    const m = timeline(t.w, script);
    T('[4] mutant: put-back off -> he gets nothing for the match', allOk(m, 4) && none(m, H), show(m, sids));
  });
}

// ---- [5] M seen agreeing, then his result blanked and a quit confession written: left out ----
{
  const k = keyRecs(2, 0xF585, [O[0], O[1], O[2], W], S4);
  const conf = { sid: W, d: rec(0xB5, 2, 0xF585, 3, 0, false, k.ros, S4, 5) };
  const t = wd(k, 3, 2, { instead: [conf] }), sids = k.ros;
  const a = timeline(t.w);
  // as before = settled among the three others: the same key with M never writing anything (named-only, Q69) rates them so
  const pre = timeline([[0, k.S.slice(0, 3)], [5 * MIN, k.S.slice(0, 3).concat(k.R.slice(0, 2))], [GRACE, k.S.slice(0, 3).concat(k.R.slice(0, 3))],
    [LEAVE, k.S.slice(0, 3).concat(k.R.slice(0, 3))], [3 * HOUR, k.S.slice(0, 3).concat(k.R.slice(0, 3))]]);
  T('[5] runs exit 0; M pays the confession only (-100, one leave), not the -17 too', allOk(a, 5) && JSON.stringify(ptsIn(a, W)) === JSON.stringify([2400]) && leavesOf(last(a), W) === 1,
    JSON.stringify([ptsIn(a, W), leavesOf(last(a), W)]) + last(a).out.slice(-500));
  T('[5] the others as before (rated among the three, as when M never wrote), the left-out line, the row 0 / 1', allOk(pre, 5) && [O[0], O[1], O[2]].every((s) => pts(a, [s]) === pts(pre, [s]))
    && CONF_LINE(k.key, W).test(outOf(a)) && !BACK_LINE(k.key, W).test(outOf(a)) && ROWS(a, [0, 1]), show(a, sids) + ' vs ' + show(pre, sids));
  withMutant('noconf', CONF, '        if (false) {\n', (script) => {
    const m = timeline(t.w, script);
    T('[5] mutant: confession check off -> the -17 on top of the -100', allOk(m, 5) && ptsIn(m, W).length === 2, JSON.stringify(ptsIn(m, W)));
  });
}

// ---- [6] M confessed a quit, came back and finished (refunded), seen agreeing, then his result gone: put back ----
{
  const k = keyRecs(2, 0xF685, [O[3], O[4], O[5], W], S4);
  const conf = { sid: W, d: rec(0xB5, 2, 0xF685, 3, 0, false, k.ros, S4, 5) };
  const t = wd(k, 3, 2, { keepStart: true, extra0: [conf], extra: [conf] }), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  const fin = (rs, s) => { const p = ptsIn(rs, s); return p[p.length - 1]; };
  T('[6] runs exit 0; the twin: fined, refunded, settled', allOk(a, 5) && allOk(b, 5) && /confess-forgive/.test(outOf(b)) && /confess-forgive/.test(outOf(a)), last(a).out.slice(-500));
  T('[6] put back: his final points and everybody\'s equal the twin', sids.every((s) => fin(a, s) === fin(b, s)) && fin(a, W) < 2500 && BACK_LINE(k.key, W).test(outOf(a)),
    show(a, sids) + ' vs ' + show(b, sids));
  withMutant('norefund', CONF, '        if (cs && (cs.ded > 0 || cs.ex)) {\n', (script) => {
    const m = timeline(t.w, script);
    T('[6] mutant: the refund ignored -> left out (no settle post after the refund)', allOk(m, 5) && ptsIn(m, W).length === ptsIn(a, W).length - 1 && fin(m, W) !== fin(b, W), show(m, sids));
  });
}

// ---- [6b] his quit confession first seen next to his own finished record (no fine), then his result gone: put back ----
{
  const k = keyRecs(2, 0xF68B, [O[6], O[7], O[8], W], S4);
  const conf = { sid: W, d: rec(0xB5, 2, 0xF68B, 3, 0, false, k.ros, S4, 5) };
  const t = wd(k, 3, 2, { keepStart: true, extra: [conf] }), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[6b] no fine (came back and finished before the confession was first seen); put back: everybody as the twin', allOk(a, 5) && allOk(b, 5) && sameFor(a, b, sids)
    && down(a, W) && !/confess [^\n]*pts 2500-100/.test(outOf(a)) && BACK_LINE(k.key, W).test(outOf(a)), show(a, sids) + ' vs ' + show(b, sids) + last(a).out.slice(-400));
  withMutant('nofine', CONF, '        if (cs && !cs.refunded) {\n', (script) => {
    const m = timeline(t.w, script);
    T('[6b] mutant: a confession without a fine counted as standing -> left out', allOk(m, 5) && none(m, W), show(m, sids));
  });
}

// ---- [7] quick FFA: the hidden rating ----
{
  const k = keyRecs(1, 0xF785, [O[6], O[7], O[8], W], S4), t = wd(k, 3, 2), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[7] quick 4P: rating posts equal the honest twin, no points move, the put-back line', allOk(a, 5) && allOk(b, 5) && sameFor(a, b, sids) && rOf(a, W).length === 1
    && sids.every((s) => none(a, s)) && BACK_LINE(k.key, W).test(outOf(a)), show(a, sids) + ' vs ' + show(b, sids));
}

// ---- [8] ranked team brawl (base 4): unchanged, no put-back ----
{
  const k = keyRecs(4, 0xF885, [O[9], O[10], O[11], W], S4), t = wd(k, 3, 1), sids = k.ros;
  const a = timeline(t.w);
  T('[8] team brawl: settled, the withdrawn loser\'s own points do not move, no put-back line', allOk(a, 5) && processedOf(last(a)).has(k.key) && none(a, W) && up(a, O[9])
    && !/agreed-back/.test(outOf(a)) && ROWS(a, [0, 0]), show(a, sids) + last(a).out.slice(-500));
  withMutant('wide', GUARD_IF, 'if (true) {\n      let back = 0;\n', (script) => {
    const m = timeline(t.w, script);
    T('[8] mutant: the guard widened to every base -> his points move', allOk(m, 5) && !none(m, W), show(m, sids));
  });
}

// ---- [9] a seat named by the others only is not put back ----
{
  const k = keyRecs(2, 0xF985, [O[0], O[1], O[2], N], S4);
  const A = k.S.slice(0, 3).concat(k.R.slice(0, 3));
  const steps = [[0, k.S.slice(0, 3)], [5 * MIN, A], [GRACE, A], [LEAVE, A], [3 * HOUR, A]];
  const a = timeline(steps);
  T('[9] named-only (never wrote): not rated, not put back, the Q69 line', allOk(a, 5) && none(a, N) && up(a, O[0]) && !/agreed-back/.test(outOf(a))
    && /named by the others but never wrote his own record for this match -- not a leaver \(Q69\)/.test(outOf(a)), last(a).out.slice(-500));
  withMutant('noagree', AGREED, "        if (parts.some((p) => String(p.steamID) === String(x.steamID))) continue;\n", (script) => {
    const m = timeline(steps, script);
    T('[9] mutant: agreed check off -> the named-only seat is rated', allOk(m, 5) && !none(m, N), show(m, k.ros));
  });
}

// ---- [10] premade pair: the partner settles in the pair unit ----
{
  const mt = 2 | (1 << 4);   // pair mask bit 0: seats 0 and 1 queued together
  const k = keyRecs(mt, 0xFA85, [P[0], P[1], O[3], O[4]], S4), t = wd(k, 1, 3), sids = k.ros;
  const a = timeline(t.w), b = timeline(t.o);
  T('[10] pair 1st + 2nd, the 2nd withdraws: the pair\'s points equal the honest twin (one delta for the pair)', allOk(a, 5) && allOk(b, 5) && sameFor(a, b, sids)
    && pts(a, [P[0]]) === pts(a, [P[1]]), show(a, sids) + ' vs ' + show(b, sids));
  OFF((script) => {
    const m = timeline(t.w, script);
    T('[10] mutant: put-back off -> the partner settles alone (another delta)', allOk(m, 5) && none(m, P[1]) && pts(m, [P[0]]) !== pts(b, [P[0]]), show(m, sids));
  });
}

// ---- [11] residual: a 1V1 whose loser withdraws leaves a lone record (Q184) ----
{
  const k = keyRecs(2, 0xFB85, [H, W], S2);
  const A = k.S.concat(k.R), gone = [k.S[0], k.R[0]];
  const steps = [[0, k.S], [1 * MIN, A], [5 * MIN, gone], [GRACE, gone], [LEAVE, gone]];
  const a = timeline(steps);
  T('[11] 1V1 withdrawn after the group was seen (pacing): one record left, a lone group, nobody rated, no put-back line', allOk(a, 5) && none(a, H) && none(a, W)
    && /lone\(1\)/.test(outOf(a)) && !/agreed-back/.test(outOf(a)), last(a).out.slice(-500));
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-agreed-gone) ===' : '=== PASS -- 0 fail (ffa-agreed-gone) ===');
process.exit(failN ? 1 : 0);
