'use strict';
// Q277 (cloud audit, found by the Q265 review): the one-match-at-a-time writer pacing (R1-A2-07 / R1-A2-01) and the
//   per-day settle signal read the match's writers only (pacedSids: the records kept and the ones sanity dropped, Q109).
//   A matchmade FFA seat seen agreeing whose record is gone at the settle takes part as if his record were there (Q185 puts
//   him back at his agreed place, Q265 rates him) -- but he did not queue: one account in N parallel ranked FFAs (each with
//   its own other writers) blanked his rows once each group had seen him agree, and all N settled in one run with him put
//   back first in each (points 2500 -> 2597 at once), where with his records there they drain one floor apart; the day
//   signal did not count them either. Now the gate reads those seats too (the absent seats of the consensus roster that
//   are in pend.agreed) and queues them with the writers; the day signal counts them.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-gone.js).
//   [0] wiring pins: FFA bases 1 / 2 only, detectLeavers (g) intersect pend.agreed, the writers not twice, the gate and the
//       day count read the joined list, the queue line; no counter / state touched on the way (pure: deferral only)
//   [1] L in three parallel ranked 4P FFAs, first in each, every group sees him agree, then he blanks all three results ->
//       one settles per floor, his points move one match at a time, exactly as when his records stay (the twin); the
//       queue line; mutant (the seats seen agreeing left out of the gate) -> all three settle in one run (+97 at once)
//   [2] the per-day settle signal counts L once per match, as the twin; mutant (day count on the writers only) -> 0
//   [3] honest single match: the winner's result row gone after the group saw him agree -> he settles in the same run as
//       his honest twin (no new delay: nobody else holds his queue), at his agreed place, not convicted, never flagged
//   [4] the same three parallel matches, L's rows kept but each match's 4th seat late: no change from before (the
//       writers' own queue), and no queue line (nobody gone)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffa-agreed-paced-'));
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
  const script = path.join(__dirname, '..', '.mutant-ffa-agreed-paced-' + tag + '-' + process.pid + '.js');
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
const MOVED_RE = /\| of those seats, left out: the scores or the seat read at the settle are not the ones they were seen agreeing to \(Q185 review\) \| (\d+) \|/;
const movedSum = (rs) => rs.reduce((a, r) => { const m = MOVED_RE.exec(r.summary || ''); return m ? a + +m[1] : NaN; }, 0);
const MOVED_LINE = (key, sid) => new RegExp('agreed-back ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' record gone, but the result read now is not the one he was seen agreeing to -- left out \\(Q185 review\\)');
const L = SID(701), Q = Array.from({ length: 9 }, (_, i) => SID(711 + i)), H = SID(731), HO = [SID(741), SID(742), SID(743)];
ALL.push(L, ...Q, H, ...HO);
const S4 = [6100, 5200, 4800, 3900];
const pick = (xs, is) => is.map((i) => xs[i]);
const ks = [0, 1, 2].map((i) => keyRecs(2, 0xE3A0 + i, [L, Q[3 * i], Q[3 * i + 1], Q[3 * i + 2]], S4));
const KS = ks.map((k) => k.key);
const S = [].concat(...ks.map((k) => k.S)), R = [].concat(...ks.map((k) => k.R)), Rnl = [].concat(...ks.map((k) => pick(k.R, [1, 2, 3])));
const tail = (recs) => [[GRACE, recs], [5 * MIN, recs], [5 * MIN, recs], [5 * MIN, recs], [LEAVE, recs], [3 * HOUR, recs]];
// the withdrawn timeline: starts; every result in (every group sees L agree, the starts are younger than the floor, nothing
//   settles yet); then L's three results blanked. The twin keeps them.
const STEPS_W = [[0, S], [MIN, S.concat(R)], [MIN, S.concat(Rnl)]].concat(tail(S.concat(Rnl)));
const STEPS_T = [[0, S], [MIN, S.concat(R)], [MIN, S.concat(R)]].concat(tail(S.concat(R)));
const N_RUNS = STEPS_W.length;
// per run: how many of the three were settled by then, and L's point writes in that run
const perRun = (rs) => rs.map((r) => KS.filter((k) => processedOf(r).has(k)).length + ':' + pointsOf(r, L).length).join(' ');
const maxNew = (rs) => { let prev = 0, m = 0; for (const r of rs) { const n = KS.filter((k) => processedOf(r).has(k)).length; m = Math.max(m, n - prev); prev = n; } return m; };
const dayN = (r, sid) => (((r.state.SIGNALS_FILE || {}).day || {}).n || {})[v.pid(sid)] | 0;
const QUEUE_LINE = new RegExp('writer-pacing [0-9_]+: queued with ' + v.pid(L).slice(0, 8) + '[^\\n]*\\(seen agreeing, record gone; Q277\\)');
const GATE_FROM = 'const pacedAll = goneIds.length ? pacedSids.concat(goneIds) : pacedSids;';
const DAY_FROM = 'for (const sid of pacedAll) day.n[pid(sid)] = (day.n[pid(sid)] || 0) + 1;';

console.log('=== a matchmade FFA seat seen agreeing whose record is gone queues with the writers (Q277) ===');

// ---- [0] wiring ----
{
  const gate = SRC.indexOf('let pend = startsPending[c.m];');
  const g0 = SRC.indexOf('const goneIds = (baseMt(matchType) === 1 || baseMt(matchType) === 2)', gate);
  T('[0] the seats: FFA bases 1 / 2, the consensus roster\'s absent seats (detectLeavers) that are in pend.agreed, not already a writer',
    gate > 0 && g0 > gate && /const goneIds = \(baseMt\(matchType\) === 1 \|\| baseMt\(matchType\) === 2\)\n\s+\? \[\.\.\.new Set\(detectLeavers\(g\)\.map\(\(x\) => String\(x\.steamID\)\)\)\]\.filter\(\(s\) => agreed\.indexOf\(pid\(s\)\) >= 0 && pacedSids\.indexOf\(s\) < 0\) : \[\];/.test(SRC)
    && SRC.indexOf('const agreed = pend.agreed || (pend.agreed = []);', gate) > gate && SRC.indexOf('const agreed = pend.agreed || (pend.agreed = []);', gate) < g0);
  T('[0] the gate and the day count read the joined list; the queue line', SRC.indexOf(GATE_FROM, g0) > g0
    && /writerPaced\(c\.m, pacedAll, pend\.t0, SANITY\.MIN_START_AGE_MS\)\) \{\n\s+if \(goneIds\.length\) console\.log\('  writer-pacing ' \+ c\.m \+ ': queued with ' \+ goneIds\.map\(plog\)\.join\(', '\) \+ ' \(seen agreeing, record gone; Q277\)'\);\n\s+continue;\n\s+\}/.test(SRC)
    && SRC.indexOf(DAY_FROM, g0) > g0);
  const seg = SRC.slice(g0, SRC.indexOf(GATE_FROM, g0) + GATE_FROM.length);
  T('[0] pure on the way: no counter, no state, no signal written while picking the seats', !/RUN\.|sigDirty|startsPending\[|signals\.|\+\+|\.push\(/.test(seg), seg);
  T('[0] the pacing helpers still the only writers of the busy marks', /function writerClaim\(/.test(SRC) && typeof v.writerClaim === 'function');
}

// ---- [1] three parallel matches, L blanks his three results ----
const a1 = timeline(STEPS_W), b1 = timeline(STEPS_T);
{
  T('[1] both timelines exit 0, all three settled', allOk(a1, N_RUNS) && allOk(b1, N_RUNS) && KS.every((k) => processedOf(last(a1)).has(k)) && KS.every((k) => processedOf(last(b1)).has(k)), last(a1).out.slice(-600));
  T('[1] one match per floor, L\'s points one match at a time, exactly as the twin', maxNew(a1) === 1 && perRun(a1) === perRun(b1) && pts(a1, [L]) === pts(b1, [L]) && ptsIn(a1, L).length === 3,
    perRun(a1) + ' vs ' + perRun(b1) + ' | ' + pts(a1, [L]) + ' vs ' + pts(b1, [L]));
  T('[1] the others\' points as the twin; L put back in each, not convicted', sameFor(a1, b1, Q) && (outOf(a1).match(/agreed-back [0-9_]+: seat 0 = /g) || []).length === 3 && leavesOf(last(a1), L) === 0,
    show(a1, Q) + ' vs ' + show(b1, Q));
  T('[1] the queue line names L', QUEUE_LINE.test(outOf(a1)) && !QUEUE_LINE.test(outOf(b1)));
  T('[1] nobody flagged for it', flags(last(a1), [L, ...Q]) === flags(last(b1), [L, ...Q]), flags(last(a1), [L, ...Q]) + ' vs ' + flags(last(b1), [L, ...Q]));
  withMutant('gate', GATE_FROM, 'const pacedAll = pacedSids;', (script) => {
    const m = timeline(STEPS_W, script);
    T('[1] mutant: the seats seen agreeing left out of the gate -> all three settle in one run, L +97 at once', allOk(m, N_RUNS) && maxNew(m) === 3 && ptsIn(m, L).length === 1, perRun(m) + ' | ' + pts(m, [L]));
  });
}

// ---- [2] the per-day settle signal ----
{
  T('[2] the day signal counts L once per match, as the twin', dayN(last(a1), L) === 3 && dayN(last(b1), L) === 3 && Q.every((s) => dayN(last(a1), s) === dayN(last(b1), s)),
    JSON.stringify([dayN(last(a1), L), dayN(last(b1), L)]));
  withMutant('day', DAY_FROM, 'for (const sid of pacedSids) day.n[pid(sid)] = (day.n[pid(sid)] || 0) + 1;', (script) => {
    const m = timeline(STEPS_W, script);
    T('[2] mutant: day count on the writers only -> L counted 0', allOk(m, N_RUNS) && dayN(last(m), L) === 0, String(dayN(last(m), L)));
  });
}

// ---- [3] honest single match: no new delay ----
{
  const k = keyRecs(2, 0xE3B0, [H, HO[0], HO[1], HO[2]], S4);
  const steps = (x) => [[0, k.S], [MIN, k.S.concat(k.R)], [MIN, x]].concat(tail(x));
  const gone = k.S.concat(k.R.slice(1));
  const a = timeline(steps(gone)), b = timeline(steps(k.S.concat(k.R)));
  T('[3] honest winner, his result row gone after the group saw him agree: settles in the same run as his honest twin, at his agreed place',
    allOk(a, N_RUNS) && allOk(b, N_RUNS) && firstProcessed(a, k.key) >= 0 && firstProcessed(a, k.key) === firstProcessed(b, k.key) && sameFor(a, b, [H, ...HO]) && up(a, H),
    firstProcessed(a, k.key) + ' vs ' + firstProcessed(b, k.key) + ' | ' + show(a, [H, ...HO]));
  T('[3] not convicted, never flagged, counted once in the day signal', leavesOf(last(a), H) === 0 && fOf(last(a), H) === 0 && dayN(last(a), H) === 1, JSON.stringify([leavesOf(last(a), H), fOf(last(a), H), dayN(last(a), H)]));
}

// ---- [4] L's rows kept, each match's 4th seat late: as before ----
{
  const late = [].concat(...ks.map((k) => pick(k.R, [0, 1, 2])));
  const steps = [[0, S], [MIN, S.concat(late)], [MIN, S.concat(late)], [GRACE, S.concat(R)]].concat(tail(S.concat(R)).slice(1));
  const a = timeline(steps);
  withMutant('gate4', GATE_FROM, 'const pacedAll = pacedSids;', (script) => {
    const m = timeline(steps, script);
    T('[4] L\'s rows kept, the 4th seats late: the same runs as before Q277, no queue line', allOk(a, steps.length) && allOk(m, steps.length) && perRun(a) === perRun(m) && pts(a, [L, ...Q]) === pts(m, [L, ...Q]) && !QUEUE_LINE.test(outOf(a)),
      perRun(a) + ' vs ' + perRun(m));
  });
}

console.log(failN ? ('FAIL x' + failN) : 'ALL OK (ffa-agreed-paced)');
process.exit(failN ? 1 : 0);
