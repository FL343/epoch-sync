'use strict';
// Q263 (cloud audit 2026-10, found by the Q227 review): a stand-in (Q227 step two) is not rated, so the players rated
//   against him take a win nobody pays for. Four modified clients alone in a ranked FFA took turns: two wrote a made-up result
//   with themselves on top (seen agreeing, pinned) and blanked their rows at once, the other two wrote their own result and
//   settled with the blanked seats standing in at the bottom; the next match the other way round. At the zero-sum top
//   (grandmaster) that made +27 a 4P match out of nothing, without end. Now a stand-in is used only while none of the players
//   rated at the settle settled with a stand-in in the last STAND_IN_WINDOW_MS; otherwise the seats stay out as before
//   Q227. (Q264 below reads it per player and per stand-in; the sections here run on that.)
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-recant.js).
//   [0] wiring pins: the window and its default, the candidates collected where Q227 pushed the stand-in, the check after
//       the absent-seat loop (so the seats put back count too), the mark right after the settle's signals, the summary row
//   [1] the ring: four accounts at grandmaster, six matches taking turns -> stand-ins in the first match only, nobody gains
//       after it (the sum after six = the sum after one), the held lines and rows; the honest rotation of the same four:
//       zero-sum, no mark; mutant (the check never true) -> stand-ins every match, the sum grows
//   [2] two liars doing Q227 match after match against different honest pairs: each honest pair settles as the honest twin
//       (the 2nd up, not last of 2), the liars' own marks not read; mutant (the stand-ins' marks read too) -> the second
//       honest pair held, its 2nd down
//   [3] the same honest pair again inside the window, with the same two liars: held -> the posts exactly as with Q227 step
//       two off (as before Q227), the held line and row, the liars not rated, not convicted, no mark refreshed; mutant (no
//       mark) -> stood in again. With two other liars (Q264): settled as the honest twin (the 2nd up); with one of the
//       same and one other: held; mutant (any stand-in read, not these) / (the settlers marked as the stand-ins) -> held
//   [4] the window: the marks 31 days old -> stood in again (the 2nd up); 29 days -> held; STAND_IN_WINDOW_MS read from the
//       env; mutant (the age not read) -> held after 31 days too
//   [5] marks only at a real settle with a stand-in: the honest twin, quick C1 -> no mark; ranked C1 -> the stood seats
//       marked (sx), the two rated paired with each of them (sxw), all with the settle's clock, nobody else; mutant (marked
//       at every settle) -> the honest twin marked
// Q264 (cloud audit 2026-10, found by the Q263 review): the check above read the whole match, so one marked player rated
//   there kept the stand-ins out for everybody (an honest player protected once, or a marked third account the two who
//   withdrew brought along), and an honest player met by other liars in the window got nothing again. It is read per player
//   and per stand-in now: a player who stood in himself in the window (sx) or settled with one of these stand-ins in it
//   (sxw) settles as before Q227 himself (as if the stand-ins were not there), the others with the stand-ins; the seats stay
//   out only when every player rated there is such a one.
//   [6] a marked honest player next to a fresh one, the same two liars again: the fresh one settles as the honest twin, the
//       marked one exactly as with Q227 step two off (points, ranked and stored rating, XP, career, win count, the
//       repeat-group step); the own line and row; mutant (the whole match read, as Q263) -> the fresh one held (down);
//       mutant (no own settle) -> the marked one as the twin; mutant (his decay step with the stand-ins) -> his rating moves
//       (Q264 review: his stored and ranked rating compared in the state, where no board write shows the ranked one;
//       mutant (his ranked rating with the stand-ins) -> another ranked rating)
//   [7] marks: the fresh one paired with the stand-ins and they marked, with the settle's clock, the marked one's marks
//       not refreshed; mutant (every one marked) -> refreshed
//   [8] a marked account the liars bring along, writing his real place in a 6P match: the three honest players settle as
//       the honest twin, he as with Q227 step two off; mutant (the whole match read) -> held, the honest 2nd / 3rd lower
//   [9] a marked account placed right behind a fresh one (the farming a per-match "anybody fresh" rule would open): he takes
//       last of 2 as before Q227 (down); mutant (no own settle) -> up; his stand-in mark 31 days old -> up; mutant (that
//       age not read) -> down
//   [10] a convicted leaver's late-result shadow: the gain of his marked party mate is read without the stand-ins (as with
//       Q227 step two off); mutant (read with them) -> another gain
//   Not here: a ring of six accounts in 4P matches giving each settler fresh stand-ins (+81 against Q263's +54) is a probe
//   in the Q264 delivery (cloud audit fixes/Q264-stood-taint), not a test.
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/ffa-agreed-recant.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'STAND_IN_WINDOW_MS', 'SIG_PLAYER_WINDOW_MS'];
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffa-stand-in-window-'));
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
  const script = path.join(__dirname, '..', '.mutant-ffa-stand-in-window-' + tag + '-' + process.pid + '.js');
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
const STOOD_RE = /\| of those, at a ranked settle with no confession of their own standing: stood in for the players there at the place read now, not rated themselves \(Q227\) \| (\d+) \|/;
const STOOD_LINE = (key, sid) => new RegExp('agreed-stood ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' stands in at place [0-9] of [0-9] read now for the players there, his own rating and points unchanged \\(Q227\\)');
function wd2(mt, h, ros, Ls, truth, fake, extra) {
  const k = keyRecs(mt, h, ros, truth), Hs = ros.map((_, i) => i).filter((i) => Ls.indexOf(i) < 0);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, mt, h, i, placeIn(fake, i), placeIn(fake, i) === 1, ros, fake) }));
  const pick = (xs, is) => is.map((i) => xs[i]);
  const early = k.S.concat(pick(Rf, Ls)), clash = k.S.concat(pick(k.R, Hs), pick(Rf, Ls));
  const left = pick(k.S, Hs).concat(pick(k.R, Hs), extra || []), all = k.S.concat(k.R);
  return { k, ros, steps: [[0, k.S], [2 * MIN, early], [5 * MIN, clash], [GRACE, left], [LEAVE, left], [3 * HOUR, left]],
    twin: [[0, k.S], [2 * MIN, k.S.concat(pick(k.R, Ls))], [5 * MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]] };
}
const GUARD = '    if (baseMt(matchType) === 1 || baseMt(matchType) === 2) {\n      let back = 0;\n';
const LOOP = '      for (const x of detectLeavers(g)) {\n';
const STAND = "          if (baseMt(matchType) === 2 && !PT_MODE && pend.agv && pend.agv[hx] != null && !(cx && !cx.refunded && (cx.ded > 0 || cx.ex))) {\n";
const WIN_DEF = 'const STAND_IN_WINDOW_MS = Number(process.env.STAND_IN_WINDOW_MS || 30 * 86400000);\n';
const DECL = '    const stoodCand = [];   // Q227: the seats that would stand in (see Q263 at the end of this block)\n';
const CAND = '            stoodCand.push(x);   // Q263: stands in only if no player rated here settled with a stand-in lately (after this loop)\n';
const CANDH = '        const candH = new Map(stoodCand.map((x) => [pid(String(x.steamID)), x.seat]));\n';
const LATELY = '        const lately = parts.map((p) => [p, why(p)]).filter((y) => y[1]);\n';
const DAYS = "        const days = ' in the last ' + Math.round(STAND_IN_WINDOW_MS / 86400000) + ' days';\n";
const AGE_SX = "          if (e.sx && nowMs - e.sx < STAND_IN_WINDOW_MS) return 'stood in himself';\n";
const AGE_W = 'nowMs - y[1] < STAND_IN_WINDOW_MS && candH.has(y[0])';
const SORT = '      if (back) parts.sort((a, b) => a.seat - b.seat);\n';
const RMS = '    recordMatchSignals(signals, g, live, rankOf, matchType, false, nowMs);\n';
const SX = '    if (stoodIds.size) {   // Q263 / Q264 (see STAND_IN_WINDOW_MS): a stand-in marked, a player rated with them paired with each of them\n';
const SX_SKIP = '        if (stoodOwn.has(String(p.steamID))) continue;\n';
const SX_STOOD = '        if (p.stood) e.sx = nowMs;\n';
const SX_PAIR = '        else e.sxw = (e.sxw || []).filter((y) => nowMs - y[1] < STAND_IN_WINDOW_MS && sh.indexOf(y[0]) < 0).concat(sh.map((h) => [h, nowMs]));\n';
const OWN_DECL = '    const stoodOwn = new Set();   // Q264: the players rated here who settle as before Q227 (see STAND_IN_WINDOW_MS)\n';
const HELD_IF = '        if (lately.length && lately.length === parts.length) {\n';
const OWN_ADD = '            stoodOwn.add(String(p.steamID)); RUN.agreedStoodOwn = (RUN.agreedStoodOwn | 0) + 1;\n';
const WFIX = "    for (const p of live) if (stoodOwn.has(String(p.steamID)) && rankNo[p.steamID] === 1 && rankOf[p.steamID] !== 1) signals.players[pid(String(p.steamID))].w += 1;   // Q264: his win as before Q227\n";
const GOWN = '      if (gOwn) for (const p of live) if (stoodOwn.has(String(p.steamID))) { const k = pid(p.steamID); gPlan[k] = gOwn[k]; groupMem[k] = gShadow[k]; }\n';
const G2 = '            lateSh[x.steamID].g = lateSh[x.steamID].g.filter((y) => !stoodOwn.has(y[0])).concat(g2.filter((y) => stoodOwn.has(y[0])));\n';
const RANKED_OWN = '          if (stoodOwn.size) playedOut = ownUpdate(playedOut, asPlayed);   // Q264: his ranked rating as before Q227 too\n';   // Q264 review
const HELD_RE = /\| of those, left out instead: every player rated at the settle stood in or settled with one of them in the window \(Q263 \/ Q264\) \| (\d+) \|/;
const HELD_LINE = (key, days) => new RegExp('agreed-stood-held ' + key + ': seats? [0-9,]+ left out as before Q227: [^\\n]* (stood in himself|settled with seats? [0-9,]+ standing in) in the last ' + (days || 30) + ' days \\(Q263 / Q264\\)');
const nStood = (rs) => (outOf(rs).match(/  agreed-stood [0-9]/g) || []).length;
const nHeld = (rs) => (outOf(rs).match(/  agreed-stood-held [0-9]/g) || []).length;
const nOwn = (rs) => (outOf(rs).match(/  agreed-stood-own [0-9]/g) || []).length;
const sxOf = (r, sid) => sigOf(r, sid).sx || 0;   // stood in himself (Q264: a stand-in only)
const swOf = (r, sid) => sigOf(r, sid).sxw || [];   // [[stand-in pid, when], ...] he settled with (Q264)
const sxs = (r, sids) => sids.map((s) => sxOf(r, s) > 0 || swOf(r, s).length > 0);   // any mark
const marks = (r, sid) => JSON.stringify([sxOf(r, sid), swOf(r, sid)]);
const DAY = 86400000, WIN = 30 * DAY;
// carried state with every stand-in mark `ms` older (advance() leaves .sx / .sxw alone: they are set from the job clock)
function ageSx(state, ms) {
  const f = JSON.parse(JSON.stringify(state)), sg = f.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const e = sg.players[k];
    if (e.sx) e.sx -= ms;
    if (e.sxw) for (const y of e.sxw) y[1] -= ms;
  }
  return f;
}
const S4 = [6100, 5200, 4800, 3900], F = [3000, 2900, 6100, 5200];

console.log('=== a stand-in only while nobody rated there settled with one in the window (Q263), read per player (Q264) ===');

// ---- [0] wiring ----
{
  const at = (a, from) => SRC.indexOf(a, from || 0);
  const g = at(GUARD), loop = at(LOOP, g), lat = at(LATELY), srt = at(SORT, g), cnd = at(CANDH);
  T('[0] the window, 30 days unless STAND_IN_WINDOW_MS', SRC.split(WIN_DEF).length === 2);
  T('[0] the candidates (and the Q264 own set): declared right before the FFA guard, collected where Q227 pushed the stand-in',
    [DECL, OWN_DECL, CAND, STAND].every((a) => SRC.split(a).length === 2) && at(DECL) + DECL.length === at(OWN_DECL) && at(OWN_DECL) + OWN_DECL.length === g
    && at(STAND) + STAND.length === at(CAND) && loop < at(CAND));
  T('[0] the check after the absent-seat loop, before the seats are sorted (the writers and the seats put back read); held only when every one is marked (Q264)',
    [CANDH, LATELY, DAYS, HELD_IF, OWN_ADD, SORT, AGE_SX].every((a) => SRC.split(a).length === 2) && at(CAND) < cnd && cnd < at(AGE_SX) && at(AGE_SX) < lat
    && lat - cnd < 1000 && at(LATELY) + LATELY.length === at(DAYS) && at(DAYS) + DAYS.length === at(HELD_IF) && at(HELD_IF) < at(OWN_ADD) && at(OWN_ADD) < srt
    && srt - lat < 2400 && SRC.split(AGE_W).length === 2 && cnd < at(AGE_W) && at(AGE_W) < lat);
  T('[0] the mark right after the real settle\'s signals (and the Q264 win fix), not on the players who settled as before Q227',
    [RMS, WFIX, SX, SX_SKIP, SX_STOOD, SX_PAIR].every((a) => SRC.split(a).length === 2) && at(RMS) + RMS.length === at(WFIX) && at(WFIX) + WFIX.length === at(SX)
    && at(SX) < at(SX_SKIP) && at(SX_SKIP) < at(SX_STOOD) && at(SX_STOOD) + SX_STOOD.length === at(SX_PAIR) && at(SX_PAIR) - at(SX) < 600);
  T('[0] Q264: the own decay step and the late-result shadow pinned', [GOWN, G2].every((a) => SRC.split(a).length === 2));
  T('[0] the summary row, right after the Q227 stood row', /'\| of those, left out instead: every player rated at the settle stood in or settled with one of them in the window \(Q263 \/ Q264\) \| ' \+ s\('agreedStoodHeld', 0\) \+ ' \|',/.test(SRC)
    && at("s('agreedStood', 0)") < at("s('agreedStoodHeld', 0)") && at("s('agreedStoodHeld', 0)") < at("s('agreedStoodOwn', 0)") && at("s('agreedStoodOwn', 0)") < at("s('recanted', 0)"));
}

// ---- [1] the ring: four accounts alone in ranked FFA, taking turns ----
const P = [SID(901), SID(902), SID(903), SID(904)];
ALL.push(...P);
function ringMatch(i, honest) {
  const pick = (xs, is) => is.map((j) => xs[j]);
  const Wr = i % 2 === 0 ? [0, 1] : [2, 3], Bl = i % 2 === 0 ? [2, 3] : [0, 1];
  const G = [0, 0, 0, 0]; G[Wr[0]] = 6100; G[Wr[1]] = 5200; G[Bl[0]] = 3000; G[Bl[1]] = 2900;   // what the writers write last (themselves on top)
  const Fk = [0, 0, 0, 0]; Fk[Bl[0]] = 6100; Fk[Bl[1]] = 5200; Fk[Wr[0]] = 3000; Fk[Wr[1]] = 2900;   // the made-up early one (the blankers on top)
  const h = 0xE263 + i, k = keyRecs(2, h, P, G);
  const Rf = P.map((s, j) => ({ sid: s, d: rec(0xB1, 2, h, j, placeIn(Fk, j), placeIn(Fk, j) === 1, P, Fk) }));
  if (honest) return [[0, k.S], [2 * MIN, k.S.concat(pick(k.R, Wr))], [5 * MIN, k.S.concat(k.R)], [GRACE, k.S.concat(k.R)], [LEAVE, k.S.concat(k.R)], [3 * HOUR, k.S.concat(k.R)]];
  const left = pick(k.S, Wr).concat(pick(k.R, Wr));
  return [[0, k.S], [2 * MIN, k.S.concat(pick(Rf, Bl))], [5 * MIN, pick(k.S, Wr)], [MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left]];
}
function ring(n, honest, script) {
  for (const s of P) LP_AT[s] = 8500;   // grandmaster: zero-sum (+20 / -20, Q160)
  let state = null; const sums = []; const all = [];
  for (let i = 0; i < n; i++) {
    const rs = timeline(ringMatch(i, honest), script, state ? advance(state, 3 * HOUR) : null);
    all.push(...rs);
    if (!allOk(rs, honest ? 6 : 7)) return { ok: false, rs: all, sums };
    for (const s of P) { const p = ptsIn(rs, s); if (p.length) LP_AT[s] = p[p.length - 1]; }
    state = last(rs).state; sums.push(P.reduce((a, s) => a + LP_AT[s] - 8500, 0));
  }
  return { ok: true, rs: all, sums, state, lp: P.map((s) => LP_AT[s]) };
}
{
  const o = ring(6, false), r = last(o.rs);
  T('[1] the ring: stand-ins in the first match only (2 stood, then 5 matches held), every match settled', o.ok && nStood(o.rs) === 2 && nHeld(o.rs) === 5
    && sumRow(o.rs, HELD_RE) === 10 && sumRow(o.rs, STOOD_RE) === 2, JSON.stringify([o.ok, nStood(o.rs), nHeld(o.rs), o.sums]) + (o.ok ? '' : last(o.rs).out.slice(-800)));
  T('[1] nobody gains after the first match: the sum after six = the sum after one (+27), all four marked (the two who stood in, the two paired with them)',
    o.ok && o.sums[0] === 27 && o.sums[5] === o.sums[0] && JSON.stringify(sxs(r, P)) === '[true,true,true,true]'
    && sxOf(r, P[2]) > 0 && sxOf(r, P[3]) > 0 && swOf(r, P[0]).length === 2 && swOf(r, P[1]).length === 2, JSON.stringify([o.sums, o.lp, sxs(r, P)]));
  const hn = ring(6, true);
  T('[1] the honest rotation of the same four: zero-sum, no stand-in, no mark', hn.ok && hn.sums.every((x) => x === 0) && nStood(hn.rs) === 0 && nHeld(hn.rs) === 0
    && JSON.stringify(sxs(last(hn.rs), P)) === '[false,false,false,false]', JSON.stringify([hn.ok, hn.sums]));
  withMutant('nocheck', LATELY, '        const lately = [];\n', (script) => {
    const m = ring(6, false, script);
    T('[1] mutant: the check never true -> stand-ins every match, the sum grows', m.ok && nStood(m.rs) === 12 && nHeld(m.rs) === 0 && m.sums[5] >= 5 * m.sums[0] && m.sums[0] === 27,
      JSON.stringify([m.ok, nStood(m.rs), m.sums]));
  });
}

// ---- [2] two liars doing Q227 against different honest pairs, one match after another ----
const L1 = SID(911), L2 = SID(912), H1 = SID(913), A1 = SID(914), H2 = SID(915), A2 = SID(916);
ALL.push(L1, L2, H1, A1, H2, A2);
function twoVictims(script) {
  const wa = wd2(2, 0xC263, [H1, A1, L1, L2], [2, 3], S4, F), wb = wd2(2, 0xC264, [H2, A2, L1, L2], [2, 3], S4, F);
  const a = timeline(wa.steps, script), b = allOk(a, 6) ? timeline(wb.steps, script, advance(last(a).state, 3 * HOUR)) : [];
  return { wa, wb, a, b };
}
{
  const o = twoVictims(), ta = timeline(o.wa.twin);
  T('[2] the first honest pair as its honest twin (A1 2nd of 4: up), the liars stood in and marked', allOk(o.a, 6) && sameFor(o.a, ta, [H1, A1]) && up(o.a, A1)
    && nStood(o.a) === 2 && JSON.stringify(sxs(last(o.a), [H1, A1, L1, L2])) === '[true,true,true,true]', show(o.a, o.wa.ros) + ' vs ' + show(ta, o.wa.ros));
  T('[2] the second honest pair too (A2 2nd of 4: up): the liars\' own marks not read', allOk(o.b, 6) && up(o.b, A2) && up(o.b, H2) && nStood(o.b) === 2 && nHeld(o.b) === 0
    && none(o.b, L1) && none(o.b, L2), show(o.b, o.wb.ros) + last(o.b).out.slice(-500));
  withMutant('standers', LATELY, LATELY.replace('parts.map(', 'parts.concat(stoodCand).map('), (script) => {
    const m = twoVictims(script);
    T('[2] mutant: the stand-ins\' marks read too -> the second honest pair held, A2 last of 2 (down)', allOk(m.b, 6) && down(m.b, A2) && nHeld(m.b) === 1, show(m.b, o.wb.ros));
  });
}

// ---- [3] the same honest pair again inside the window, with the same two liars (and with others: Q264) ----
const H3 = SID(921), A3 = SID(922), L3 = SID(923), L4 = SID(924), L5 = SID(925), L6 = SID(926);
ALL.push(H3, A3, L3, L4, L5, L6);
const w3a = wd2(2, 0xC265, [H3, A3, L3, L4], [2, 3], S4, F), w3b = wd2(2, 0xC266, [H3, A3, L3, L4], [2, 3], S4, F);
const a3 = timeline(w3a.steps);
const st3 = allOk(a3, 6) ? last(a3).state : null;
{
  const b = timeline(w3b.steps, null, advance(st3, 3 * HOUR)), r = last(b);
  T('[3] held: the held line and row, A3 last of 2 (down), L3 / L4 not rated, not convicted', allOk(b, 6) && processedOf(r).has(w3b.k.key) && HELD_LINE(w3b.k.key).test(outOf(b))
    && /left out as before Q227: seat 0 = [0-9a-f]{8} settled with seats 2,3 standing in, seat 1 = [0-9a-f]{8} settled with seats 2,3 standing in in the last 30 days/.test(outOf(b))
    && sumRow(b, HELD_RE) === 2 && nStood(b) === 0 && down(b, A3) && none(b, L3) && none(b, L4) && rOf(b, L3).length === 0 && leavesOf(r, L3) === 0 && leavesOf(r, L4) === 0,
    show(b, w3b.ros) + r.out.slice(-600));
  T('[3] no mark refreshed by the held settle', [H3, A3, L3, L4].every((s) => marks(r, s) === marks(last(a3), s)) && swOf(r, H3).length === 2 && sxOf(r, L3) > 0);
  withMutant('nostand', STAND, '          if (false) {\n', (script) => {
    const m = timeline(w3b.steps, script, advance(st3, 3 * HOUR));
    T('[3] the held settle exactly as with Q227 step two off (as before Q227)', allOk(m, 6) && JSON.stringify(last(m).posts) === JSON.stringify(r.posts)
      && pts(m, w3b.ros) === pts(b, w3b.ros), show(m, w3b.ros) + ' vs ' + show(b, w3b.ros));
  });
  withMutant('nosx', SX, '    if (false) {\n', (script) => {
    const ma = timeline(w3a.steps, script), mb = allOk(ma, 6) ? timeline(w3b.steps, script, advance(last(ma).state, 3 * HOUR)) : [];
    T('[3] mutant: no mark -> stood in again, A3 up', allOk(mb, 6) && up(mb, A3) && nStood(mb) === 2 && nHeld(mb) === 0, show(mb, w3b.ros));
  });
}
{   // Q264: the same honest pair met again in the window by two other liars, and by one of the same and one other
  const w3c = wd2(2, 0xC268, [H3, A3, L5, L6], [2, 3], S4, F), w3d = wd2(2, 0xC269, [H3, A3, L3, L5], [2, 3], S4, F);
  const c = timeline(w3c.steps, null, advance(st3, 3 * HOUR)), tc = timeline(w3c.twin, null, advance(st3, 3 * HOUR));
  T('[3] two other liars: both stood in, the pair settles as the honest twin (A3 2nd of 4: up), paired with them too', allOk(c, 6) && allOk(tc, 6) && nStood(c) === 2 && nHeld(c) === 0
    && nOwn(c) === 0 && sameFor(c, tc, [H3, A3]) && up(c, A3) && swOf(last(c), A3).length === 4 && sxOf(last(c), L5) > 0, show(c, w3c.ros) + ' vs ' + show(tc, w3c.ros));
  const d = timeline(w3d.steps, null, advance(st3, 3 * HOUR));
  T('[3] one of the same liars and one other: held, A3 down, the reason names the seat of the same one only', allOk(d, 6) && nHeld(d) === 1 && nStood(d) === 0 && down(d, A3)
    && /seat 1 = [0-9a-f]{8} settled with seat 2 standing in in the last 30 days/.test(outOf(d)), show(d, w3d.ros) + last(d).out.slice(-600));
  withMutant('nopair', AGE_W, 'nowMs - y[1] < STAND_IN_WINDOW_MS', (script) => {
    const m = timeline(w3c.steps, script, advance(st3, 3 * HOUR));
    T('[3] mutant: any stand-in he settled with read, not these -> held, A3 down', allOk(m, 6) && nHeld(m) === 1 && down(m, A3), show(m, w3c.ros));
  });
  withMutant('settlersx', SX_STOOD, '        if (true) e.sx = nowMs;\n', (script) => {
    const ma = timeline(w3a.steps, script), mc = allOk(ma, 6) ? timeline(w3c.steps, script, advance(last(ma).state, 3 * HOUR)) : [];
    T('[3] mutant: the settlers marked as the stand-ins (as Q263) -> held, A3 down', allOk(mc, 6) && nHeld(mc) === 1 && down(mc, A3), show(mc, w3c.ros));
  });
}

// ---- [4] the window ----
{
  const run = (agedMs, env, script) => timeline(w3b.steps.map((s) => [s[0], s[1], env || null]), script, advance(ageSx(st3, agedMs), 3 * HOUR));
  const old = run(WIN + DAY), young = run(WIN - DAY);
  T('[4] the marks 31 days old: stood in again, A3 2nd of 4 (up)', allOk(old, 6) && nStood(old) === 2 && nHeld(old) === 0 && up(old, A3), show(old, w3b.ros));
  T('[4] the marks 29 days old: held, A3 down', allOk(young, 6) && nStood(young) === 0 && nHeld(young) === 1 && down(young, A3), show(young, w3b.ros));
  const e1 = run(2 * DAY, { STAND_IN_WINDOW_MS: String(DAY) }), e2 = run(2 * DAY);
  T('[4] STAND_IN_WINDOW_MS from the env: one day -> marks 2 days old stood in again; 30 days -> held', allOk(e1, 6) && nStood(e1) === 2 && allOk(e2, 6) && nHeld(e2) === 1
    && HELD_LINE(w3b.k.key).test(outOf(e2)), JSON.stringify([nStood(e1), nHeld(e2)]));
  withMutant('noage', AGE_W, 'true && candH.has(y[0])', (script) => {
    const m = run(WIN + DAY, null, script);
    T('[4] mutant: the age not read -> held after 31 days too', allOk(m, 6) && nHeld(m) === 1 && down(m, A3), show(m, w3b.ros));
  });
}

// ---- [5] marks only at a real settle with a stand-in ----
{
  const ros = w3a.ros, tw = timeline(w3a.twin);
  T('[5] the honest twin: settled, no mark', allOk(tw, 6) && processedOf(last(tw)).has(w3a.k.key) && JSON.stringify(sxs(last(tw), ros)) === '[false,false,false,false]');
  const q = wd2(1, 0xC267, [SID(931), SID(932), SID(933), SID(934)], [2, 3], S4, F);
  ALL.push(...q.ros);
  const qa = timeline(q.steps);
  T('[5] quick C1: no stand-in, no mark', allOk(qa, 6) && processedOf(last(qa)).has(q.k.key) && nStood(qa) === 0 && JSON.stringify(sxs(last(qa), q.ros)) === '[false,false,false,false]');
  const r5 = last(a3), t5 = sxOf(r5, L3), pl5 = Object.values((r5.state.SIGNALS_FILE || {}).players || {});
  T('[5] ranked C1: the stood seats marked, the two rated paired with each of them, all with the settle\'s clock, nobody else', allOk(a3, 6) && t5 > 0 && sxOf(r5, L4) === t5
    && [H3, A3].every((s) => sxOf(r5, s) === 0 && JSON.stringify(swOf(r5, s)) === JSON.stringify([[v.pid(L3), t5], [v.pid(L4), t5]]))
    && swOf(r5, L3).length === 0 && pl5.filter((e) => e.sx).length === 2 && pl5.filter((e) => e.sxw).length === 2, JSON.stringify([H3, A3, L3, L4].map((s) => marks(r5, s))));
  withMutant('sxall', SX, '    for (const p of parts) sigPlayer(signals, pid(String(p.steamID)), nowMs).sx = nowMs;\n' + SX, (script) => {
    const m = timeline(w3a.twin, script);
    T('[5] mutant: marked at every settle -> the honest twin marked', allOk(m, 6) && JSON.stringify(sxs(last(m), ros)) === '[true,true,true,true]');
  });
}

// ======== Q264: read per player ========
const OWN_RE = /\| players rated at a settle with stand-ins who settled as before Q227 instead: each stood in or settled with one of them in the window \(Q264\) \| (\d+) \|/;
const OWN_LINE = (key, sid, why) => new RegExp('agreed-stood-own ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' settles as before Q227, as if the stand-ins were not there: he ' + (why || '(stood in himself|settled with seats? [0-9,]+ standing in)') + ' in the last 30 days \\(Q264\\)');
// every points / rating / XP (+ career) write for sid, in order (the board ids are fixed in boardsWith)
const writesOf = (rs, sid) => JSON.stringify([].concat(...rs.map((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map((p) => p.body))));
const sigCore = (r, sid) => { const e = sigOf(r, sid); return JSON.stringify([e.g, e.w, e.v, e.s1, e.s2, e.smax, e.disp]); };
const grpOf = (r, sid) => { const e = ((r.state.GROUPS_FILE || {})[v.pid(sid)]) || {}; return JSON.stringify([e.r, e.k]); };
const skOf = (r, sid) => JSON.stringify(((r.state.SKILL_FILE || {})[v.pid(sid)]) || null);   // Q264 review: his stored and ranked rating as kept in the state
const xps = (rs, sids) => JSON.stringify(sids.map((s) => xpOf(rs, s)));
const PERMATCH = ['permatch', HELD_IF, '        if (lately.length) {\n'];   // Q263: the whole match read
const NOOWN = ['noown', OWN_ADD, '            RUN.agreedStoodOwn = (RUN.agreedStoodOwn | 0) + 1;\n'];   // nobody settles as before: the stand-ins for everybody
const NOSTAND = ['nostand', STAND, '          if (false) {\n'];   // Q227 step two off: today's settle
const from3 = () => advance(st3, 3 * HOUR);

// ---- [6] a marked honest player next to a fresh one; the two liars of his last match again ----
const H7 = SID(941);
ALL.push(H7);
const w6 = wd2(2, 0xC26A, [L3, H3, H7, L4], [0, 3], S4, [6100, 3000, 2900, 5200]);   // L3 1st (stands in above H3), H3 2nd, H7 3rd, L4 4th
const b6 = timeline(w6.steps, null, from3());
{
  const r = last(b6), tw = timeline(w6.twin, null, from3());
  const m = { nostand: [], permatch: [], noown: [], nogown: [] };   // stays empty where a mutant anchor is missing (a fail, not a crash)
  for (const mu of [NOSTAND, PERMATCH, NOOWN, ['nogown', GOWN, '']]) withMutant(mu[0], mu[1], mu[2], (script) => { m[mu[0]] = timeline(w6.steps, script, from3()); });
  T('[6] settled with the stand-ins, H3 settling as before Q227: the own line and row, both liars stood in', allOk(b6, 6) && processedOf(r).has(w6.k.key) && nStood(b6) === 2 && nHeld(b6) === 0
    && nOwn(b6) === 1 && OWN_LINE(w6.k.key, H3, 'settled with seats 0,3 standing in').test(outOf(b6)) && sumRow(b6, OWN_RE) === 1, outOf(b6).slice(-900));
  T('[6] the fresh H7 as the honest twin (3rd of 4, not last of 2)', allOk(tw, 6) && sameFor(b6, tw, [H7]) && xps(b6, [H7]) === xps(tw, [H7]), show(b6, [H7]) + ' vs ' + show(tw, [H7]));
  const n = m.nostand;
  T('[6] the marked H3 exactly as with Q227 step two off: every write of his, his win count and his repeat-group memory', allOk(n, 6) && writesOf(b6, H3) === writesOf(n, H3)
    && sigCore(r, H3) === sigCore(last(n), H3) && grpOf(r, H3) === grpOf(last(n), H3) && writesOf(b6, H3) !== '[]', writesOf(b6, H3) + ' vs ' + writesOf(n, H3));
  T('[6] ... which here is not his twin result (1st of 2 there, 2nd of 4 here: points, rating, XP and the win all differ)', allOk(tw, 6) && pts(b6, [H3]) !== pts(tw, [H3])
    && JSON.stringify(rOf(b6, H3)) !== JSON.stringify(rOf(tw, H3)) && xpOf(b6, H3) !== xpOf(tw, H3) && sigOf(r, H3).w === sigOf(last(tw), H3).w + 1, show(b6, [H3]) + ' vs ' + show(tw, [H3]));
  T('[6] mutant: the whole match read (Q263) -> held, H7 lower (last of 2)', allOk(m.permatch, 6) && nHeld(m.permatch) === 1 && ptsIn(m.permatch, H7)[0] < ptsIn(b6, H7)[0], show(m.permatch, [H7]));
  T('[6] mutant: nobody settles as before -> H3 as his twin', allOk(m.noown, 6) && sameFor(m.noown, tw, [H3]) && pts(m.noown, [H3]) !== pts(b6, [H3]), show(m.noown, [H3]));
  T('[6] mutant: his repeat-group step read with the stand-ins -> his rating moves less, his points the same', allOk(m.nogown, 6) && pts(m.nogown, [H3]) === pts(b6, [H3])
    && JSON.stringify(rOf(m.nogown, H3)) !== JSON.stringify(rOf(b6, H3)) && /group-decay [^\n]*repeat-group streak 2/.test(outOf(m.nogown)), show(m.nogown, [H3]) + ' vs ' + show(b6, [H3]));
  // Q264 review: his ranked rating (rm / rv, read by the points plan of his later matches) as with Q227 step two off too;
  //   it is in the state only, no board write shows it, so the writes compared above cannot catch it
  T('[6] review: the marked H3\'s stored and ranked rating in the state exactly as with Q227 step two off', allOk(n, 6) && skOf(r, H3) === skOf(last(n), H3)
    && skOf(r, H3) !== 'null', skOf(r, H3) + ' vs ' + skOf(last(n), H3));
  withMutant('noranked', RANKED_OWN, '', (script) => {
    const mr = timeline(w6.steps, script, from3());
    T('[6] review mutant: his ranked rating read with the stand-ins -> another ranked rating, every write of his the same', allOk(mr, 6) && skOf(last(mr), H3) !== skOf(r, H3)
      && writesOf(mr, H3) === writesOf(b6, H3), skOf(last(mr), H3) + ' vs ' + skOf(r, H3));
  });
}

// ---- [7] marks: the players who settled with the stand-ins, not the one who settled as before ----
{
  const r = last(b6), at = sxOf(r, L3);
  T('[7] H7 paired with the stand-ins and they marked, with the settle\'s clock, H3\'s marks as after his last match', at > 0 && sxOf(r, L4) === at && sxOf(r, H7) === 0
    && JSON.stringify(swOf(r, H7)) === JSON.stringify([[v.pid(L3), at], [v.pid(L4), at]]) && marks(r, H3) === marks(last(a3), H3) && swOf(r, H3).length === 2
    && swOf(r, H3)[0][1] < at, JSON.stringify([marks(r, H3), marks(last(a3), H3), marks(r, H7), at]));
  withMutant('sxown', SX_SKIP, '', (script) => {
    const m = timeline(w6.steps, script, from3());
    T('[7] mutant: every one marked -> H3\'s marks refreshed', allOk(m, 6) && marks(last(m), H3) !== marks(last(a3), H3) && swOf(last(m), H3)[0][1] === sxOf(last(m), L3));
  });
}

// ---- [8] a marked account the two liars bring along, writing his real place, 6P ----
const H8 = SID(942), H9 = SID(943), H10 = SID(944), L9 = SID(945), L10 = SID(946);
ALL.push(H8, H9, H10, L9, L10);
const S6 = [6100, 5200, 4800, 4400, 3900, 3500], F6 = [3000, 2900, 2800, 2700, 6100, 5200];
const w8 = wd2(2, 0xC26B, [H8, H9, H10, L3, L9, L10], [4, 5], S6, F6);   // L3 (marked: stood in at C1) 4th of 6, honest
{
  const b = timeline(w8.steps, null, from3()), tw = timeline(w8.twin, null, from3()), hon = [H8, H9, H10];
  T('[8] the three honest players as the honest twin, L3 settling as before Q227', allOk(b, 6) && allOk(tw, 6) && sameFor(b, tw, hon) && xps(b, hon) === xps(tw, hon)
    && nStood(b) === 2 && nOwn(b) === 1 && OWN_LINE(w8.k.key, L3, 'stood in himself').test(outOf(b)), show(b, hon) + ' vs ' + show(tw, hon));
  withMutant(NOSTAND[0], NOSTAND[1], NOSTAND[2], (script) => {
    const n = timeline(w8.steps, script, from3());
    T('[8] L3 exactly as with Q227 step two off (as today)', allOk(n, 6) && writesOf(b, L3) === writesOf(n, L3) && writesOf(b, L3) !== '[]' && down(b, L3), writesOf(b, L3) + ' vs ' + writesOf(n, L3));
  });
  withMutant(PERMATCH[0], PERMATCH[1], PERMATCH[2], (script) => {
    const m = timeline(w8.steps, script, from3());
    T('[8] mutant: the whole match read (Q263) -> held, the honest 2nd and 3rd lower', allOk(m, 6) && nHeld(m) === 1 && ptsIn(m, H9)[0] < ptsIn(b, H9)[0] && ptsIn(m, H10)[0] < ptsIn(b, H10)[0], show(m, hon));
  });
}

// ---- [9] a marked account right behind a fresh one, the two liars standing in ----
const F9 = SID(947), C9 = SID(948), D9 = SID(949);
ALL.push(F9, C9, D9);
const w9 = wd2(2, 0xC26C, [F9, L3, C9, D9], [2, 3], S4, F);   // F9 1st, L3 (marked) 2nd
{
  const b = timeline(w9.steps, null, from3());
  T('[9] the marked one takes last of 2 as before Q227 (down), the fresh one 1st of 4 (up)', allOk(b, 6) && down(b, L3) && up(b, F9) && nOwn(b) === 1 && nStood(b) === 2, show(b, [F9, L3]));
  withMutant(NOOWN[0], NOOWN[1], NOOWN[2], (script) => {
    const m = timeline(w9.steps, script, from3());
    T('[9] mutant: nobody settles as before -> the marked one up again (2nd of 4)', allOk(m, 6) && up(m, L3), show(m, [F9, L3]));
  });
  const o9 = timeline(w9.steps, null, advance(ageSx(st3, WIN + DAY), 3 * HOUR));
  T('[9] his stand-in mark 31 days old: settles with the stand-ins (2nd of 4: up)', allOk(o9, 6) && up(o9, L3) && nOwn(o9) === 0 && nStood(o9) === 2, show(o9, [F9, L3]));
  withMutant('noagesx', AGE_SX, AGE_SX.replace('e.sx && nowMs - e.sx < STAND_IN_WINDOW_MS', 'e.sx'), (script) => {
    const m = timeline(w9.steps, script, advance(ageSx(st3, WIN + DAY), 3 * HOUR));
    T('[9] mutant: the age of his stand-in mark not read -> down after 31 days too', allOk(m, 6) && down(m, L3) && nOwn(m) === 1, show(m, [F9, L3]));
  });
}

// ---- [10] a convicted leaver's late-result shadow: his marked party mate's gain read without the stand-ins ----
const H11 = SID(950), H12 = SID(957), X10 = SID(958);
ALL.push(H11, H12, X10);
{
  const mt = 2 | (1 << 4), h = 0xC26D, ros = [X10, A3, H11, H12, L3, L4];   // seats 0-1 a party: X10 (leaves) + A3 (paired with L3 / L4 at C1)
  const truth = [3900, 4800, 6100, 3500, 5200, 4400], fake = [2000, 1900, 1800, 1700, 6100, 5200];
  const k = keyRecs(mt, h, ros, truth), pick = (xs, is) => is.map((i) => xs[i]);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, mt, h, i, placeIn(fake, i), placeIn(fake, i) === 1, ros, fake) }));
  const Ls = [4, 5], Ws = [1, 2, 3], St = [0, 1, 2, 3];   // X10 writes the start only
  const left = pick(k.S, St).concat(pick(k.R, Ws));
  const steps = [[0, k.S], [2 * MIN, k.S.concat(pick(Rf, Ls))], [5 * MIN, k.S.concat(pick(k.R, Ws), pick(Rf, Ls))], [GRACE, left], [LEAVE, left], [3 * HOUR, left]];
  const cvG = (rs) => { const e = ((last(rs).state.CONFESSIONS_FILE || {})[v.pid(X10) + '|' + k.key]) || {}; return e.cv ? e.g | 0 : null; };
  const b = timeline(steps, null, from3());
  T('[10] settled with the stand-ins, X10 convicted, A3 settling as before Q227', allOk(b, 6) && processedOf(last(b)).has(k.key) && nStood(b) === 2 && nOwn(b) === 1 && leavesOf(last(b), X10) === 1
    && cvG(b) != null, outOf(b).slice(-900));
  withMutant(NOSTAND[0], NOSTAND[1], NOSTAND[2], (script) => {
    const n = timeline(steps, script, from3());
    T('[10] A3\'s gain by the leave as with Q227 step two off', allOk(n, 6) && cvG(n) === cvG(b) && writesOf(b, A3) === writesOf(n, A3), JSON.stringify([cvG(b), cvG(n)]));
  });
  withMutant('nog2', G2, '', (script) => {
    const m = timeline(steps, script, from3());
    T('[10] mutant: his gain read with the stand-ins -> another gain', allOk(m, 6) && cvG(m) !== cvG(b), JSON.stringify([cvG(b), cvG(m)]));
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-stand-in-window) ===' : '=== PASS -- 0 fail (ffa-stand-in-window) ===');
process.exit(failN ? 1 : 0);
