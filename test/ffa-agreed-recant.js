'use strict';
// Q227 (cloud audit 2026-10, found by the Q185 review 2): two accounts in one ranked FFA write a made-up result early with
//   themselves on top. Seen agreeing, they are pinned on it (pend.agv, Q185 review); the honest players write the real
//   result, the records disagree and nothing settles; then the two blank their rows. Not convicted (seen agreeing), not put
//   back (the result read now is not the one they agreed to), so the match settles among the honest ones: the two keep their
//   points, the honest 2nd of 4 takes last of 2 (-17, not +15). Counted here: such a seat on its account (.am), and a writer
//   of the settle first seen agreeing to another result for the match on his (.rc). Nobody is flagged.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-gone.js).
//   [0] wiring pins: the recant count inside the FFA guard, before the absent-seat loop; the .am count right after the Q185
//       review's moved count, only for a pin that is there; the two summary rows
//   [1] ranked 4P (C1): M1 / M2 write the made-up result, then blank their rows -> .am 1 on each, no .rc, the honest
//       players counted nothing, the rows 2 / 0, the agreed-away lines; the settle as with the counts taken out (posts,
//       flags); mutant (.am count off) -> nothing counted
//   [2] ranked 4P: all four seen agreeing to one result, then two of them write another and the other two blank their
//       rows -> .rc 1 on each writer, .am 1 on each blanked seat, the recant lines, the rows 2 / 2; mutant (the recant check
//       never true) -> no .rc
//   [3] the honest twin of [1] (everybody writes the real result) -> nothing counted, the rows 0 / 0
//   [4] quick FFA (C1): counted the same way
//   [5] the deploy: an entry from before the pin (pend.agreed, no pend.agv) -> left out as before, the moved count, no .am;
//       mutant (a missing pin counted) -> .am 1
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffa-agreed-recant-'));
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
  const script = path.join(__dirname, '..', '.mutant-ffa-agreed-recant-' + tag + '-' + process.pid + '.js');
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
const sigOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {});
const sumRow = (rs, re) => rs.reduce((a, r) => { const m = re.exec(r.summary || ''); return m ? a + +m[1] : NaN; }, 0);
const AWAY_RE = /\| of those, seen agreeing to another result \(a pin, not an entry from before the pin\): counted on the account \(Q227, nobody flagged\) \| (\d+) \|/;
const RECANT_RE = /\| matchmade FFA writers at the settle first seen agreeing to another result for the match, counted on the account \(Q227, nobody flagged\) \| (\d+) \|/;
const MOVED_RE = /\| of those seats, left out: the scores or the seat read at the settle are not the ones they were seen agreeing to \(Q185 review\) \| (\d+) \|/;
const AWAY_LINE = (key, sid) => new RegExp('agreed-away ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' seen agreeing to another result for this match -- counted, nobody flagged \\(Q227\\)');
const RECANT_LINE = (key, sid) => new RegExp('recant ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' first seen agreeing to another result for this match -- counted, nobody flagged \\(Q227\\)');
const cnt = (r, sids, f) => JSON.stringify(sids.map((s) => sigOf(r, s)[f] | 0));
const GUARD = '    if (baseMt(matchType) === 1 || baseMt(matchType) === 2) {\n      let back = 0;\n';
const RC_IF = '      if (pend.agv) for (const r of g) {\n';
const RC_CHK = '        if (pend.agv[h] == null || pend.agv[h] === agreedPin(r.d[5])) continue;\n';
const RC_ADD = '        const p = sigPlayer(signals, h, nowMs); p.rc = (p.rc | 0) + 1; sigDirty = true; RUN.recanted = (RUN.recanted | 0) + 1;\n';
const LOOP = '      for (const x of detectLeavers(g)) {\n';
const MOVED = '          RUN.agreedMoved = (RUN.agreedMoved | 0) + 1;\n';
const AM_IF = '          if (pend.agv && pend.agv[hx] != null) {   // Q227: a pin of another result (not an entry from before the pin)\n';
const AM_ADD = '            const p = sigPlayer(signals, hx, nowMs); p.am = (p.am | 0) + 1; sigDirty = true; RUN.agreedAway = (RUN.agreedAway | 0) + 1;\n';
const Hh = SID(701), A = SID(702), M1 = SID(703), M2 = SID(704), Q = [SID(711), SID(712), SID(713), SID(714)];
ALL.push(Hh, A, M1, M2, ...Q);
const S4 = [6100, 5200, 4800, 3900], F = [3000, 2900, 6100, 5200], F2 = [6100, 5200, 3000, 2900];
// C1: Hh / A honest (1st / 2nd), M1 / M2 seen agreeing on F (themselves on top), the honest results disagree, the two blank
//   both rows; `early` = M1 / M2's made-up records alone (pinned on F while the start waits out the pacing floor)
function c1(mt, h, script) {
  const ros = [Hh, A, M1, M2], k = keyRecs(mt, h, ros, S4);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, mt, h, i, placeIn(F, i), placeIn(F, i) === 1, ros, F) }));
  const early = k.S.concat(Rf.slice(2)), clash = k.S.concat(k.R.slice(0, 2), Rf.slice(2)), left = k.S.slice(0, 2).concat(k.R.slice(0, 2));
  const steps = [[0, k.S], [2 * MIN, early], [5 * MIN, clash], [GRACE, left], [LEAVE, left], [3 * HOUR, left]];
  const all = k.S.concat(k.R);
  return { k, ros, steps, twin: [[0, k.S], [2 * MIN, k.S.concat(k.R.slice(2))], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]], run: (sc) => timeline(steps, sc) };
}

console.log('=== a matchmade FFA seat seen agreeing to another result, and a writer who changed his result, are counted (Q227) ===');

// ---- [0] wiring ----
{
  const at = (a, from) => SRC.indexOf(a, from || 0);
  T('[0] the recant count inside the FFA guard, before the absent-seat loop: a pin that is there and differs from the one his record gives now',
    [GUARD, RC_IF, RC_CHK, RC_ADD].every((a) => SRC.split(a).length === 2) && at(GUARD) + GUARD.length === at(RC_IF) && at(RC_IF) < at(RC_CHK) && at(RC_CHK) < at(RC_ADD)
    && at(RC_ADD) < at(LOOP, at(GUARD)) && at(LOOP, at(GUARD)) - at(RC_ADD) < 400);
  T('[0] the .am count right after the Q185 review\'s moved count, only for a pin that is there',
    [MOVED, AM_IF, AM_ADD].every((a) => SRC.split(a).length === 2) && at(MOVED) + MOVED.length === at(AM_IF) && at(AM_IF) + AM_IF.length === at(AM_ADD));
  T('[0] the two summary rows, after the Q185 review row', /'\| of those, seen agreeing to another result \(a pin, not an entry from before the pin\): counted on the account \(Q227, nobody flagged\) \| ' \+ s\('agreedAway', 0\) \+ ' \|',/.test(SRC)
    && /'\| matchmade FFA writers at the settle first seen agreeing to another result for the match, counted on the account \(Q227, nobody flagged\) \| ' \+ s\('recanted', 0\) \+ ' \|',/.test(SRC)
    && at("s('agreedMoved', 0)") < at("s('agreedAway', 0)") && at("s('agreedAway', 0)") < at("s('recanted', 0)"));
}

// ---- [1] C1, ranked ----
const C1R = c1(2, 0xC227);
const a1 = C1R.run();
{
  const { k, ros } = C1R, r = last(a1);
  T('[1] settled (exit 0), M1 / M2 not convicted', allOk(a1, 6) && processedOf(r).has(k.key) && leavesOf(r, M1) === 0 && leavesOf(r, M2) === 0, r.out.slice(-600));
  T('[1] .am 1 on M1 / M2, none on the honest; no .rc', cnt(r, ros, 'am') === '[0,0,1,1]' && cnt(r, ros, 'rc') === '[0,0,0,0]', JSON.stringify(ros.map((s) => sigOf(r, s))));
  T('[1] the agreed-away lines, the rows 2 / 0, the moved row 2', AWAY_LINE(k.key, M1).test(outOf(a1)) && AWAY_LINE(k.key, M2).test(outOf(a1)) && !/ recant /.test(outOf(a1))
    && sumRow(a1, AWAY_RE) === 2 && sumRow(a1, RECANT_RE) === 0 && sumRow(a1, MOVED_RE) === 2, JSON.stringify([sumRow(a1, AWAY_RE), sumRow(a1, RECANT_RE), sumRow(a1, MOVED_RE)]));
  withMutant('noam', AM_IF, '          if (false) {\n', (script) => {
    const m = C1R.run(script), rm = last(m);
    T('[1] counted only: the posts and the flags as with the count taken out', allOk(m, 6) && JSON.stringify(rm.posts) === JSON.stringify(r.posts) && flags(rm, ros) === flags(r, ros) && flags(r, ros) === '[1,1,1,1]',
      flags(rm, ros) + ' ' + flags(r, ros));
    T('[1] mutant: .am count off -> nothing counted', cnt(rm, ros, 'am') === '[0,0,0,0]' && sumRow(m, AWAY_RE) === 0);
  });
}

// ---- [2] all four seen agreeing, then two write another result and two blank their rows ----
{
  const ros = [Q[0], Q[1], Q[2], Q[3]], h = 0xD227, k = keyRecs(2, h, ros, S4);
  const R2 = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F2, i), placeIn(F2, i) === 1, ros, F2) }));
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F, i), placeIn(F, i) === 1, ros, F) }));
  const left = k.S.slice(0, 2).concat(R2.slice(0, 2));
  const steps = [[0, k.S], [2 * MIN, k.S.concat(Rf)], [5 * MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left]];
  const a = timeline(steps), r = last(a);
  T('[2] settled, .rc 1 on the two who wrote another result, .am 1 on the two who blanked their rows', allOk(a, 6) && processedOf(r).has(k.key)
    && cnt(r, ros, 'rc') === '[1,1,0,0]' && cnt(r, ros, 'am') === '[0,0,1,1]', JSON.stringify(ros.map((s) => sigOf(r, s))) + r.out.slice(-500));
  T('[2] the recant and agreed-away lines, the rows 2 / 2', RECANT_LINE(k.key, Q[0]).test(outOf(a)) && RECANT_LINE(k.key, Q[1]).test(outOf(a)) && AWAY_LINE(k.key, Q[2]).test(outOf(a))
    && sumRow(a, AWAY_RE) === 2 && sumRow(a, RECANT_RE) === 2, JSON.stringify([sumRow(a, AWAY_RE), sumRow(a, RECANT_RE)]));
  withMutant('norc', RC_CHK, '        if (true) continue;\n', (script) => {
    const m = timeline(steps, script);
    T('[2] mutant: the recant check never true -> no .rc', allOk(m, 6) && cnt(last(m), ros, 'rc') === '[0,0,0,0]' && sumRow(m, RECANT_RE) === 0);
  });
}

// ---- [3] the honest twin of [1] ----
{
  const { k, ros } = C1R, b = timeline(C1R.twin), r = last(b);
  T('[3] the honest twin: settled, nothing counted, the rows 0 / 0, nobody flagged', allOk(b, 6) && processedOf(r).has(k.key) && cnt(r, ros, 'am') === '[0,0,0,0]' && cnt(r, ros, 'rc') === '[0,0,0,0]'
    && sumRow(b, AWAY_RE) === 0 && sumRow(b, RECANT_RE) === 0 && flags(r, ros) === '[0,0,0,0]', JSON.stringify(ros.map((s) => sigOf(r, s))));
}

// ---- [4] C1, quick ----
{
  const q = c1(1, 0xC228), a = q.run(), r = last(a);
  T('[4] quick: counted the same way (.am 1 on M1 / M2), no points move', allOk(a, 6) && processedOf(r).has(q.k.key) && cnt(r, q.ros, 'am') === '[0,0,1,1]' && sumRow(a, AWAY_RE) === 2
    && q.ros.every((s) => none(a, s)), JSON.stringify(q.ros.map((s) => sigOf(r, s))));
}

// ---- [5] the deploy: an entry from before the pin ----
{
  const run = (script) => {
    const head = timeline(C1R.steps.slice(0, 3), script);
    const st = JSON.parse(JSON.stringify(last(head).state));
    let had = 0;
    for (const e of Object.values(st.STARTS_FILE || {})) if (e && e.agv) { had++; delete e.agv; }
    const tail = timeline([[0, C1R.steps[3][1]]].concat(C1R.steps.slice(4)), script, advance(st, C1R.steps[3][0]));
    return { rs: head.concat(tail), had };
  };
  const o = run(), r = last(o.rs);
  T('[5] an entry from before the pin: M1 / M2 left out as before, the moved row 2, no .am, the away row 0', o.had === 1 && allOk(o.rs, 6) && processedOf(r).has(C1R.k.key)
    && sumRow(o.rs, MOVED_RE) === 2 && cnt(r, C1R.ros, 'am') === '[0,0,0,0]' && sumRow(o.rs, AWAY_RE) === 0, JSON.stringify([o.had, sumRow(o.rs, MOVED_RE)]) + r.out.slice(-400));
  withMutant('nopinok', AM_IF, '          {\n', (script) => {
    const m = run(script);
    T('[5] mutant: a missing pin counted -> .am 1', m.had === 1 && allOk(m.rs, 6) && cnt(last(m.rs), C1R.ros, 'am') === '[0,0,1,1]');
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-agreed-recant) ===' : '=== PASS -- 0 fail (ffa-agreed-recant) ===');
process.exit(failN ? 1 : 0);
