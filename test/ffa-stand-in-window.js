'use strict';
// Q263 (cloud audit 2026-10, found by the Q227 review): a stand-in (Q227 step two) is not rated, so the players rated
//   against him take a win nobody pays for. Four modified clients alone in a ranked FFA took turns: two wrote a made-up result
//   with themselves on top (seen agreeing, pinned) and blanked their rows at once, the other two wrote their own result and
//   settled with the blanked seats standing in at the bottom; the next match the other way round. At the zero-sum top
//   (grandmaster) that made +27 a 4P match out of nothing, without end. Now a stand-in is used only while none of the players
//   rated at the settle settled with a stand-in in the last STAND_IN_WINDOW_MS; otherwise the seats stay out as before
//   Q227. (Q264 below reads it per player and per stand-in, and Q265 rates a seat that already stood in for a player there;
//   the sections here run on that.)
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-recant.js).
//   [0] wiring pins: the window and its default, the candidates collected where Q227 pushed the stand-in, the Q265 step and
//       the check after the absent-seat loop (so the seats put back count too), the mark right after the settle's signals,
//       the summary rows
//   [1] the ring: four accounts at grandmaster, six matches taking turns -> stand-ins in the first match only, then the two
//       who stood in held out when they settle (Q263) and rated when they withdraw again (Q265); nobody gains after the first
//       match (the sum never above its +27); the honest rotation of the same four: zero-sum, no mark; mutant (no rating, as
//       Q264) -> held every match after the first; mutant (neither check) -> stand-ins every match, the sum grows
//   [2] two liars doing Q227 match after match against different honest pairs: each honest pair settles as the honest twin
//       (the 2nd up, not last of 2), the liars' own marks not read; mutant (the stand-ins' marks read too) -> the second
//       honest pair held, its 2nd down
//   [3] the same honest pair again inside the window, with the same two liars (Q265): the two rated at their place read now
//       -> every points and rating write of the four exactly the honest twin's (the two: no XP, no record of theirs), the
//       rated lines and row, not convicted, the marks refreshed; mutant (no rating, as Q264) -> held, the 2nd down; mutant
//       (no mark) -> stood in again. With two other liars (Q264): settled as the honest twin (the 2nd up); with one of the
//       same and one other: the same one rated (as before Q227 himself next to the other: he stood in), the other stood in,
//       the pair as the honest twin; mutant (any stand-in read, not these) / (the settlers marked as the stand-ins) -> held
//   [4] the window: the marks 31 days old -> stood in again (the 2nd up); 29 days -> rated (the 2nd up); STAND_IN_WINDOW_MS
//       read from the env; mutant (the age not read by the Q264 check) -> held after 31 days; mutant (the age not read by the
//       Q265 step) -> rated after 31 days; a rated settle 15 days ago, the first meeting 35 days ago -> rated again; mutant
//       (a rated settle marks nobody) -> stood in
//   [5] marks only at a real settle with a stand-in: the honest twin, quick C1 -> no mark; ranked C1 -> the stood seats
//       marked (sx), the two rated paired with each of them (sxw), all with the settle's clock, nobody else; mutant (marked
//       at every settle) -> the honest twin marked
// Q264 (cloud audit 2026-10, found by the Q263 review): the check above read the whole match, so one marked player rated
//   there kept the stand-ins out for everybody (an honest player protected once, or a marked third account the two who
//   withdrew brought along), and an honest player met by other liars in the window got nothing again. It is read per player
//   and per stand-in now: a player who stood in himself in the window (sx) or settled with one of these stand-ins in it
//   (sxw) settles as before Q227 himself (as if the stand-ins were not there), the others with the stand-ins; the seats stay
//   out only when every player rated there is such a one. (Since Q265 a player meets "one of these stand-ins" no more: that
//   seat is rated; the sections below mark the player who settles as before Q227 by his own stand-in at C1.)
//   [6] a liar who stood in at C1 settles next to an honest player while two other liars withdraw: the honest one settles
//       as the honest twin, the liar exactly as with Q227 step two off (points, ranked and stored rating, XP, career, win
//       count, the repeat-group step); the own line and row; mutant (the whole match read, as Q263) -> the honest one held
//       (down); mutant (no own settle) -> the liar as the twin; mutant (his decay step with the stand-ins) -> his rating
//       moves more (Q264 review: his stored and ranked rating compared in the state, where no board write shows the ranked
//       one; mutant (his ranked rating with the stand-ins) -> another ranked rating)
//   [7] marks: the honest one paired with the stand-ins and they marked, with the settle's clock, the liar's marks not
//       refreshed; mutant (every one marked) -> refreshed
//   [8] a marked account the liars bring along, writing his real place in a 6P match: the three honest players settle as
//       the honest twin, he as with Q227 step two off; mutant (the whole match read) -> held, the honest 2nd / 3rd lower
//   [9] a marked account placed right behind a fresh one (the farming a per-match "anybody fresh" rule would open): he takes
//       last of 2 as before Q227 (down); mutant (no own settle) -> up; his stand-in mark 31 days old -> up; mutant (that
//       age not read) -> down
//   [10] a convicted leaver's late-result shadow: the gain of his marked party mate (stood in at C1) is read without the
//       stand-ins (as with Q227 step two off); mutant (read with them) -> another gain
//   Not here: a ring of six accounts in 4P matches giving each settler fresh stand-ins (+81 against Q263's +54) is a probe
//   in the Q264 delivery (cloud audit fixes/Q264-stood-taint), not a test.
// Q265 (cloud audit 2026-10, left by Q264): a player who settled with a stand-in settled as before Q227 when the same account
//   withdrew against him again in the window (the honest 2nd of 4 took last of 2 again), and in the ledger that is the same
//   as the two who settled with the stand-ins settling with them again. Such a seat is rated now instead, at the place the
//   scores read now give him, as a seat put back (Q185): the player settles as in the result he wrote, and the seat pays its
//   place ([3] / [4] above).
//   [11] the fixed old account with a new one each match, the same two withdrawing every time: +27 in the first match
//       (they stood in), after it each match moves the points sum exactly as the same match played honestly from the same
//       state (the two rated); mutant (no rating, as Q264) -> the second match makes more than played honestly
//   [12] (Q265 review) the pairing carried by a seat put back: the same two withdraw against the same honest player again,
//       his row gone after he was seen agreeing (put back, Q185), the two who write met neither of them -> the two rated at
//       their place read now (for him alone), all five exactly the honest twin's; mutant (only the writers read) -> the
//       two stand in, he settles as before Q227 (another gain)
// Q275 (cloud audit 2026-10, the cost the Q265 delivery named): an honest player whose own row was overwritten while the group
//   waited (Q185 review F1) and the players left all rewrote the result with him last stood in at the rewritten place the
//   first time (unchanged), and the second time inside the window Q265 rated him there (gold -17, grandmaster -20; before
//   Q265 unchanged). The step is skipped now when every player rated at the settle is a writer of it first seen agreeing to
//   another result for the match (recanted, Q227): an honest player never changes his result, so a match with one of them
//   rated keeps the step; the seats then go to the Q263 / Q264 check as before Q265.
//   [13] the honest player framed twice by the same three -> the second time not rated (no points or rating write of his,
//       the unrated and held lines and rows), the three exactly as with the Q265 step off; mutant (no gate) -> rated at 4 of 4
//       (down); mutant (no recant collected) -> the same. One of the three who settle with the honest 2nd recanted (he wrote
//       the made-up result with the two who withdraw, then the real one) -> the two rated, the honest 2nd exactly the honest
//       twin's; mutant (any recant, not every) -> held, the 2nd down. Every writer recanted but a seat put back (Q185, his
//       pin the result read now) is rated there -> the two rated (for him); mutant (the writers only read) -> not rated. A
//       group whose settlers recant on purpose every match (the fixed old account with a new one) -> the points sums
//       exactly those with the Q265 step off (Q264: the patch gives back no more than that)
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
// from / to: one replacement, or from = [[from, to], ...] (to unused) for several in one mutant
function mutant(tag, from, to) {
  let src = SRC;
  for (const [f, t] of Array.isArray(from) ? from : [[from, to]]) {
    if (src.split(f).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
    src = src.replace(f, () => t);
  }
  const script = path.join(__dirname, '..', '.mutant-ffa-stand-in-window-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, src);
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
const RATED_IDS = '    const ratedIds = parts.filter((p) => p.rated).map((p) => String(p.steamID));   // Q265: the seats rated where they would have stood in\n';
const SX = '    if (stoodIds.size || ratedIds.length) {   // Q263 / Q264 / Q265 (see STAND_IN_WINDOW_MS): a stand-in (or a seat rated instead) marked, a player rated with them paired with each of them\n';
const SX_SKIP = '        if (stoodOwn.has(String(p.steamID)) && !p.rated) continue;\n';
const SX_STOOD = '        if (p.stood || p.rated) e.sx = nowMs;\n';
const SX_PAIR = '        else e.sxw = (e.sxw || []).filter((y) => nowMs - y[1] < STAND_IN_WINDOW_MS && sh.indexOf(y[0]) < 0).concat(sh.map((h) => [h, nowMs]));\n';
const OWN_DECL = '    const stoodOwn = new Set();   // Q264: the players rated here who settle as before Q227 (see STAND_IN_WINDOW_MS)\n';
const HELD_IF = '        if (lately.length && lately.length === parts.length) {\n';
const OWN_ADD = '            stoodOwn.add(String(p.steamID)); RUN.agreedStoodOwn = (RUN.agreedStoodOwn | 0) + 1;\n';
const WFIX = "    for (const p of live) if (stoodOwn.has(String(p.steamID)) && rankNo[p.steamID] === 1 && rankOf[p.steamID] !== 1) signals.players[pid(String(p.steamID))].w += 1;   // Q264: his win as before Q227\n";
const GOWN = '      if (gOwn) for (const p of live) if (stoodOwn.has(String(p.steamID))) { const k = pid(p.steamID); gPlan[k] = gOwn[k]; groupMem[k] = gShadow[k]; }\n';
const G2 = '            lateSh[x.steamID].g = lateSh[x.steamID].g.filter((y) => !stoodOwn.has(y[0])).concat(g2.filter((y) => stoodOwn.has(y[0])));\n';
const RANKED_OWN = '          if (stoodOwn.size) playedOut = ownUpdate(playedOut, asPlayed);   // Q264: his ranked rating as before Q227 too\n';   // Q264 review
const BACK = '        back++; RUN.agreedBack = (RUN.agreedBack | 0) + 1;\n';   // Q185: a seat put back
const RATE_AGE = 'y[0] === h && nowMs - y[1] < STAND_IN_WINDOW_MS';   // Q265: the step (the age of the pairing read)
const RATE_LOOP = '        for (const x of stoodCand.splice(0)) {\n';
const RATE_IF = '          if (!by.length) { stoodCand.push(x); continue; }\n';
const RATE_PUSH = '          parts.push({ steamID: x.steamID, seat: x.seat, score: scores[x.seat] | 0, rated: true });\n';
const RATE_OFF = ['norate', RATE_IF, '          if (true) { stoodCand.push(x); continue; }\n'];   // nobody rated: Q264
const RATED_RE = /\| of those, rated instead at the place read now, as a seat put back: a player rated at the settle settled with him standing in in the window \(Q265\) \| (\d+) \|/;
const RATED_LINE = (key, sid, place, pc, by, days) => new RegExp('agreed-stood-rated ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' rated at place ' + place + ' of ' + pc
  + ' read now, as a seat put back: he stood in for ' + by + ' in the last ' + (days || 30) + ' days \\(Q265\\)');
const RECANT_DECL = '    const recanted = new Set();   // Q275: the writers of this settle first seen agreeing to another result for this match\n';
const RECANT_ADD = '        recanted.add(String(r.steamID));\n';
const ALL_RECANT = 'const allRecant = rated0.every((p) => recanted.has(String(p.steamID)));   // Q275';
const RECANT_IF = '          if (allRecant) {\n';
const RC_ADD = '        const p = sigPlayer(signals, h, nowMs); p.rc = (p.rc | 0) + 1; sigDirty = true; RUN.recanted = (RUN.recanted | 0) + 1;\n';
const NOGATE = ['nogate', ALL_RECANT, 'const allRecant = false;'];   // as Q265
const RECANT_LINE_RE = (key, sid) => new RegExp('  recant ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' first seen agreeing to another result for this match -- counted, nobody flagged \\(Q227\\)', 'g');
const UNRATED_RE = /\| seats Q265 would rate, passed on to the Q263 \/ Q264 checks instead: every player rated at the settle first agreed to another result for the match \(Q275\) \| (\d+) \|/;
const UNRATED_LINE = (key, sid, by) => new RegExp('agreed-stood-unrated ' + key + ': seat [0-9] = ' + v.pid(sid).slice(0, 8) + ' stood in for ' + by
  + ' in the last 30 days, not rated at the place read now: every player rated here first agreed to another result for this match \\(Q275\\)');
const HELD_RE = /\| of those, left out instead: every player rated at the settle stood in or settled with one of them in the window \(Q263 \/ Q264\) \| (\d+) \|/;
const HELD_LINE = (key, days) => new RegExp('agreed-stood-held ' + key + ': seats? [0-9,]+ left out as before Q227: [^\\n]* (stood in himself|settled with seats? [0-9,]+ standing in) in the last ' + (days || 30) + ' days \\(Q263 / Q264\\)');
const nStood = (rs) => (outOf(rs).match(/  agreed-stood [0-9]/g) || []).length;
const nHeld = (rs) => (outOf(rs).match(/  agreed-stood-held [0-9]/g) || []).length;
const nOwn = (rs) => (outOf(rs).match(/  agreed-stood-own [0-9]/g) || []).length;
const nRated = (rs) => (outOf(rs).match(/  agreed-stood-rated [0-9]/g) || []).length;
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
const from3 = () => advance(st3, 3 * HOUR);   // after C1 of [3] (st3 below)

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
  T('[0] Q265: the step after the absent-seat loop (the writers and the seats put back read), before the Q263 / Q264 check: the age of the pairing read, a seat not rated left a candidate',
    [BACK, RATE_AGE, RATE_LOOP, RATE_IF, RATE_PUSH].every((a) => SRC.split(a).length === 2) && at(CAND) < at(BACK) && at(BACK) < at(RATE_AGE) && at(RATE_AGE) < at(RATE_LOOP)
    && at(RATE_LOOP) < at(RATE_IF) && at(RATE_IF) + RATE_IF.length === at(RECANT_IF) && at(RECANT_IF) < at(RATE_PUSH) && at(RATE_PUSH) - at(RECANT_IF) < 600 && at(RATE_PUSH) < cnd
    && cnd - at(RATE_AGE) < 2400, String(cnd - at(RATE_AGE)));
  T('[0] Q275: the recant set declared with the candidates, filled where Q227 counts a recant, read over the players rated here (with the seats put back) in the Q265 step, a seat it passes on left a candidate',
    [RECANT_DECL, RECANT_ADD, ALL_RECANT, RECANT_IF, RC_ADD].every((a) => SRC.split(a).length === 2) && at(RECANT_DECL) + RECANT_DECL.length === at(DECL) && g < at(RECANT_ADD)
    && at(RECANT_ADD) + RECANT_ADD.length === at(RC_ADD) && at(RC_ADD) < loop && at(BACK) < at(ALL_RECANT) && at(ALL_RECANT) < at(RATE_AGE) && at(ALL_RECANT) - at('const rated0 = parts.slice(),') < 200
    && SRC.indexOf('stoodCand.push(x); RUN.agreedStoodRecant = (RUN.agreedStoodRecant | 0) + 1;\n', at(RECANT_IF)) === at(RECANT_IF) + RECANT_IF.length + 12);
  T('[0] the mark right after the real settle\'s signals (and the Q264 win fix): a seat rated instead marked as one who stood in, not the players who settled as before Q227',
    [RMS, WFIX, RATED_IDS, SX, SX_SKIP, SX_STOOD, SX_PAIR].every((a) => SRC.split(a).length === 2) && at(RMS) + RMS.length === at(WFIX) && at(WFIX) + WFIX.length === at(RATED_IDS)
    && at(RATED_IDS) + RATED_IDS.length === at(SX) && at(SX) < at(SX_SKIP) && at(SX_SKIP) < at(SX_STOOD) && at(SX_STOOD) + SX_STOOD.length === at(SX_PAIR) && at(SX_PAIR) - at(SX) < 700,
    String(at(SX_PAIR) - at(SX)));
  T('[0] Q264: the own decay step and the late-result shadow pinned', [GOWN, G2].every((a) => SRC.split(a).length === 2));
  T('[0] the summary rows, right after the Q227 stood row: held (Q263 / Q264), rated (Q265), passed on (Q275), own (Q264)', /'\| of those, left out instead: every player rated at the settle stood in or settled with one of them in the window \(Q263 \/ Q264\) \| ' \+ s\('agreedStoodHeld', 0\) \+ ' \|',/.test(SRC)
    && /'\| of those, rated instead at the place read now, as a seat put back: a player rated at the settle settled with him standing in in the window \(Q265\) \| ' \+ s\('agreedStoodRated', 0\) \+ ' \|',/.test(SRC)
    && /'\| seats Q265 would rate, passed on to the Q263 \/ Q264 checks instead: every player rated at the settle first agreed to another result for the match \(Q275\) \| ' \+ s\('agreedStoodRecant', 0\) \+ ' \|',/.test(SRC)
    && at("s('agreedStood', 0)") < at("s('agreedStoodHeld', 0)") && at("s('agreedStoodHeld', 0)") < at("s('agreedStoodRated', 0)") && at("s('agreedStoodRated', 0)") < at("s('agreedStoodRecant', 0)")
    && at("s('agreedStoodRecant', 0)") < at("s('agreedStoodOwn', 0)")
    && at("s('agreedStoodOwn', 0)") < at("s('recanted', 0)"));
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
  T('[1] the ring: stand-ins in the first match only, then the two who stood in held out when they settle (Q263) and rated when they withdraw again (Q265), every match settled',
    o.ok && nStood(o.rs) === 2 && nHeld(o.rs) === 3 && nRated(o.rs) === 4 && sumRow(o.rs, STOOD_RE) === 2 && sumRow(o.rs, HELD_RE) === 6 && sumRow(o.rs, RATED_RE) === 4,
    JSON.stringify([o.ok, nStood(o.rs), nHeld(o.rs), nRated(o.rs), o.sums]) + (o.ok ? '' : last(o.rs).out.slice(-800)));
  T('[1] nobody gains after the first match: the sum never above its +27, all four marked (the two who stood in, the two paired with them)',
    o.ok && o.sums[0] === 27 && o.sums.every((x) => x <= 27) && JSON.stringify(sxs(r, P)) === '[true,true,true,true]'
    && sxOf(r, P[2]) > 0 && sxOf(r, P[3]) > 0 && swOf(r, P[0]).length === 2 && swOf(r, P[1]).length === 2, JSON.stringify([o.sums, o.lp, sxs(r, P)]));
  const hn = ring(6, true);
  T('[1] the honest rotation of the same four: zero-sum, no stand-in, no mark', hn.ok && hn.sums.every((x) => x === 0) && nStood(hn.rs) === 0 && nHeld(hn.rs) === 0
    && nRated(hn.rs) === 0 && JSON.stringify(sxs(last(hn.rs), P)) === '[false,false,false,false]', JSON.stringify([hn.ok, hn.sums]));
  withMutant(RATE_OFF[0], RATE_OFF[1], RATE_OFF[2], (script) => {
    const m = ring(6, false, script);
    T('[1] mutant: nobody rated (as Q264) -> held every match after the first, the sum still +27', m.ok && nStood(m.rs) === 2 && nHeld(m.rs) === 5 && nRated(m.rs) === 0
      && m.sums[5] === 27 && m.sums.every((x) => x <= 27), JSON.stringify([m.ok, nStood(m.rs), nHeld(m.rs), m.sums]));
  });
  withMutant('nocheck', LATELY, '        const lately = [];\n', (script) => {
    const m = ring(6, false, script);
    T('[1] mutant: the Q263 check never true -> stand-ins in the first two matches, rated after: +54, no more', m.ok && nStood(m.rs) === 4 && nRated(m.rs) === 8 && nHeld(m.rs) === 0
      && m.sums[1] === 54 && m.sums.every((x) => x <= 54), JSON.stringify([m.ok, nStood(m.rs), nRated(m.rs), m.sums]));
  });
  withMutant('nocheck-norate', [[LATELY, '        const lately = [];\n'], [RATE_OFF[1], RATE_OFF[2]]], null, (script) => {
    const m = ring(6, false, script);
    T('[1] mutant: neither check -> stand-ins every match, the sum grows', m.ok && nStood(m.rs) === 12 && nHeld(m.rs) === 0 && nRated(m.rs) === 0 && m.sums[5] >= 5 * m.sums[0]
      && m.sums[0] === 27, JSON.stringify([m.ok, nStood(m.rs), m.sums]));
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
{   // Q265: the same two withdrawing again
  const b = timeline(w3b.steps, null, from3()), r = last(b), tw = timeline(w3b.twin, null, from3()), q = [H3, A3, L3, L4], by = 'seat 0 = [0-9a-f]{8}, seat 1 = [0-9a-f]{8}';
  T('[3] the same two again: rated at their place read now (3rd and 4th of 4), the rated lines and row, not convicted', allOk(b, 6) && processedOf(r).has(w3b.k.key)
    && RATED_LINE(w3b.k.key, L3, 3, 4, by).test(outOf(b)) && RATED_LINE(w3b.k.key, L4, 4, 4, by).test(outOf(b)) && nRated(b) === 2 && nStood(b) === 0 && nHeld(b) === 0
    && nOwn(b) === 0 && sumRow(b, RATED_RE) === 2 && sumRow(b, STOOD_RE) === 0 && leavesOf(r, L3) === 0 && leavesOf(r, L4) === 0, outOf(b).slice(-900));
  T('[3] ... every points and rating write of the four exactly the honest twin\'s (A3 2nd of 4: up, L3 / L4 down), the pair\'s XP the twin\'s, none for the two (no record of theirs)',
    allOk(tw, 6) && sameFor(b, tw, q) && up(b, A3) && down(b, L3) && down(b, L4) && xps(b, [H3, A3]) === xps(tw, [H3, A3]) && xpOf(b, L3) === 0 && xpOf(b, L4) === 0
    && xpOf(tw, L3) > 0, show(b, q) + ' vs ' + show(tw, q) + ' xp ' + xps(b, q) + ' vs ' + xps(tw, q));
  const t = sxOf(r, L3);
  T('[3] the marks refreshed: L3 / L4 marked again, H3 / A3 paired with them again, all with this settle\'s clock', t > sxOf(last(a3), L3) && sxOf(r, L4) === t
    && [H3, A3].every((s) => sxOf(r, s) === 0 && JSON.stringify(swOf(r, s)) === JSON.stringify([[v.pid(L3), t], [v.pid(L4), t]])), JSON.stringify(q.map((s) => marks(r, s))));
  withMutant(RATE_OFF[0], RATE_OFF[1], RATE_OFF[2], (script) => {
    const m = timeline(w3b.steps, script, from3());
    T('[3] mutant: nobody rated (as Q264) -> held, A3 last of 2 (down), L3 / L4 not rated', allOk(m, 6) && nHeld(m) === 1 && nRated(m) === 0 && HELD_LINE(w3b.k.key).test(outOf(m))
      && /left out as before Q227: seat 0 = [0-9a-f]{8} settled with seats 2,3 standing in, seat 1 = [0-9a-f]{8} settled with seats 2,3 standing in in the last 30 days/.test(outOf(m))
      && down(m, A3) && none(m, L3) && none(m, L4), show(m, q));
  });
  withMutant('nosx', SX, '    if (false) {\n', (script) => {
    const ma = timeline(w3a.steps, script), mb = allOk(ma, 6) ? timeline(w3b.steps, script, advance(last(ma).state, 3 * HOUR)) : [];
    T('[3] mutant: no mark -> stood in again, A3 up, L3 / L4 not rated', allOk(mb, 6) && up(mb, A3) && nStood(mb) === 2 && nRated(mb) === 0 && nHeld(mb) === 0 && none(mb, L3),
      show(mb, w3b.ros));
  });
}
{   // Q263: the two who stood in writing their own result while two others withdraw: held, exactly as before Q227
  const wh = wd2(2, 0xC26F, [L3, L4, L5, L6], [2, 3], S4, F), b = timeline(wh.steps, null, from3()), r = last(b);
  T('[3] the two who stood in settle while two others withdraw: held (both stood in themselves), L3 1st of 2, L5 / L6 not rated, no mark refreshed', allOk(b, 6)
    && processedOf(r).has(wh.k.key) && nHeld(b) === 1 && nStood(b) === 0 && nRated(b) === 0 && HELD_LINE(wh.k.key).test(outOf(b))
    && /left out as before Q227: seat 0 = [0-9a-f]{8} stood in himself, seat 1 = [0-9a-f]{8} stood in himself in the last 30 days/.test(outOf(b)) && sumRow(b, HELD_RE) === 2
    && up(b, L3) && down(b, L4) && none(b, L5) && none(b, L6) && [L3, L4, L5, L6].every((s) => marks(r, s) === marks(last(a3), s)), show(b, wh.ros) + outOf(b).slice(-600));
  withMutant(NOSTAND[0], NOSTAND[1], NOSTAND[2], (script) => {
    const m = timeline(wh.steps, script, from3());
    T('[3] the held settle exactly as with Q227 step two off (as before Q227)', allOk(m, 6) && JSON.stringify(last(m).posts) === JSON.stringify(r.posts)
      && pts(m, wh.ros) === pts(b, wh.ros), show(m, wh.ros) + ' vs ' + show(b, wh.ros));
  });
}
{   // Q264: the same honest pair met again in the window by two other liars, and by one of the same and one other
  const w3c = wd2(2, 0xC268, [H3, A3, L5, L6], [2, 3], S4, F), w3d = wd2(2, 0xC269, [H3, A3, L3, L5], [2, 3], S4, F);
  const c = timeline(w3c.steps, null, from3()), tc = timeline(w3c.twin, null, from3());
  T('[3] two other liars (Q264): both stood in, the pair settles as the honest twin (A3 2nd of 4: up), paired with them too', allOk(c, 6) && allOk(tc, 6) && nStood(c) === 2 && nHeld(c) === 0
    && nOwn(c) === 0 && nRated(c) === 0 && sameFor(c, tc, [H3, A3]) && up(c, A3) && swOf(last(c), A3).length === 4 && sxOf(last(c), L5) > 0, show(c, w3c.ros) + ' vs ' + show(tc, w3c.ros));
  const d = timeline(w3d.steps, null, from3()), td = timeline(w3d.twin, null, from3());
  T('[3] one of the same liars and one other (Q265): the same one rated (settling as before Q227 himself: he stood in), the other stood in, the pair as the honest twin (A3 up)',
    allOk(d, 6) && allOk(td, 6) && nRated(d) === 1 && nStood(d) === 1 && nHeld(d) === 0 && nOwn(d) === 1 && RATED_LINE(w3d.k.key, L3, 3, 4, 'seat 0 = [0-9a-f]{8}, seat 1 = [0-9a-f]{8}').test(outOf(d))
    && OWN_LINE(w3d.k.key, L3, 'stood in himself').test(outOf(d)) && sameFor(d, td, [H3, A3]) && up(d, A3) && down(d, L3) && none(d, L5) && swOf(last(d), A3).length === 3,
    show(d, w3d.ros) + ' vs ' + show(td, w3d.ros) + outOf(d).slice(-900));
  withMutant('nopair', AGE_W, 'nowMs - y[1] < STAND_IN_WINDOW_MS', (script) => {
    const m = timeline(w3c.steps, script, from3());
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
  const old = run(WIN + DAY), young = run(WIN - DAY), by = 'seat 0 = [0-9a-f]{8}, seat 1 = [0-9a-f]{8}';
  T('[4] the marks 31 days old: stood in again, A3 2nd of 4 (up)', allOk(old, 6) && nStood(old) === 2 && nHeld(old) === 0 && nRated(old) === 0 && up(old, A3), show(old, w3b.ros));
  T('[4] the marks 29 days old: rated (Q265), A3 up, L3 down', allOk(young, 6) && nRated(young) === 2 && nStood(young) === 0 && nHeld(young) === 0 && up(young, A3)
    && down(young, L3), show(young, w3b.ros));
  const e1 = run(2 * DAY, { STAND_IN_WINDOW_MS: String(DAY) }), e2 = run(2 * DAY), e3 = run(2 * DAY, { STAND_IN_WINDOW_MS: String(3 * DAY) });
  T('[4] STAND_IN_WINDOW_MS from the env: one day -> marks 2 days old stood in again; 3 days -> rated, the line says 3 days; unset -> rated, 30 days', allOk(e1, 6)
    && nStood(e1) === 2 && nRated(e1) === 0 && allOk(e3, 6) && nRated(e3) === 2 && RATED_LINE(w3b.k.key, L3, 3, 4, by, 3).test(outOf(e3)) && allOk(e2, 6) && nRated(e2) === 2
    && RATED_LINE(w3b.k.key, L3, 3, 4, by).test(outOf(e2)), JSON.stringify([nStood(e1), nRated(e3), nRated(e2)]));
  withMutant('noage', AGE_W, 'true && candH.has(y[0])', (script) => {
    const m = run(WIN + DAY, null, script);
    T('[4] mutant: the age not read by the Q264 check -> held after 31 days', allOk(m, 6) && nHeld(m) === 1 && nRated(m) === 0 && down(m, A3), show(m, w3b.ros));
  });
  withMutant('norateage', RATE_AGE, 'y[0] === h', (script) => {
    const m = run(WIN + DAY, null, script);
    T('[4] mutant: the age not read by the Q265 step -> rated after 31 days', allOk(m, 6) && nRated(m) === 2 && nStood(m) === 0, show(m, w3b.ros));
  });
  // a rated settle marks them again: rated 15 days ago, the first meeting (C1) 35 days ago
  const w3e = wd2(2, 0xC26E, [H3, A3, L3, L4], [2, 3], S4, F), third = (ra, script) => timeline(w3e.steps, script, advance(ageSx(last(ra).state, 15 * DAY), 3 * HOUR));
  const ra = run(20 * DAY), re = allOk(ra, 6) ? third(ra) : [];
  T('[4] rated 15 days ago, the first meeting 35 days ago: rated again (the rated settle marked them)', allOk(ra, 6) && nRated(ra) === 2 && allOk(re, 6) && nRated(re) === 2
    && nStood(re) === 0 && up(re, A3), show(re, w3e.ros));
  withMutant('noratedmark', RATED_IDS, '    const ratedIds = [];\n', (script) => {
    const ma = run(20 * DAY, null, script), me = allOk(ma, 6) ? third(ma, script) : [];
    T('[4] mutant: a rated settle marks nobody -> stood in at the third meeting', allOk(ma, 6) && nRated(ma) === 2 && allOk(me, 6) && nStood(me) === 2 && nRated(me) === 0,
      show(me, w3e.ros));
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
  T('[5] ranked C1: the stood seats marked, the two who settled paired with each of them, all with the settle\'s clock, nobody else', allOk(a3, 6) && t5 > 0 && sxOf(r5, L4) === t5
    && [H3, A3].every((s) => sxOf(r5, s) === 0 && JSON.stringify(swOf(r5, s)) === JSON.stringify([[v.pid(L3), t5], [v.pid(L4), t5]]))
    && swOf(r5, L3).length === 0 && pl5.filter((e) => e.sx).length === 2 && pl5.filter((e) => e.sxw).length === 2, JSON.stringify([H3, A3, L3, L4].map((s) => marks(r5, s))));
  withMutant('sxall', SX, '    for (const p of parts) sigPlayer(signals, pid(String(p.steamID)), nowMs).sx = nowMs;\n' + SX, (script) => {
    const m = timeline(w3a.twin, script);
    T('[5] mutant: marked at every settle -> the honest twin marked', allOk(m, 6) && JSON.stringify(sxs(last(m), ros)) === '[true,true,true,true]');
  });
}

// ======== Q264: read per player ========

// ---- [6] a marked player (he stood in at C1) next to one he played with there; two other liars withdraw ----
const w6 = wd2(2, 0xC26A, [L5, L3, H3, L6], [0, 3], S4, [6100, 3000, 2900, 5200]);   // L5 1st (stands in above L3), L3 2nd, H3 3rd, L6 4th
const b6 = timeline(w6.steps, null, from3());
{
  const r = last(b6), tw = timeline(w6.twin, null, from3());
  const m = { nostand: [], permatch: [], noown: [], nogown: [] };   // stays empty where a mutant anchor is missing (a fail, not a crash)
  for (const mu of [NOSTAND, PERMATCH, NOOWN, ['nogown', GOWN, '']]) withMutant(mu[0], mu[1], mu[2], (script) => { m[mu[0]] = timeline(w6.steps, script, from3()); });
  T('[6] settled with the stand-ins, L3 settling as before Q227: the own line and row, both liars stood in, nobody rated', allOk(b6, 6) && processedOf(r).has(w6.k.key)
    && nStood(b6) === 2 && nHeld(b6) === 0 && nRated(b6) === 0 && nOwn(b6) === 1 && OWN_LINE(w6.k.key, L3, 'stood in himself').test(outOf(b6)) && sumRow(b6, OWN_RE) === 1,
    outOf(b6).slice(-900));
  T('[6] H3 (paired with L3 / L4 at C1, not with these two) as the honest twin (3rd of 4, not last of 2)', allOk(tw, 6) && sameFor(b6, tw, [H3]) && xps(b6, [H3]) === xps(tw, [H3]),
    show(b6, [H3]) + ' vs ' + show(tw, [H3]));
  const n = m.nostand;
  T('[6] the marked L3 exactly as with Q227 step two off: every write of his, his win count and his repeat-group memory', allOk(n, 6) && writesOf(b6, L3) === writesOf(n, L3)
    && sigCore(r, L3) === sigCore(last(n), L3) && grpOf(r, L3) === grpOf(last(n), L3) && writesOf(b6, L3) !== '[]', writesOf(b6, L3) + ' vs ' + writesOf(n, L3));
  T('[6] ... which here is not his twin result (1st of 2 there, 2nd of 4 here: points, rating, XP and the win all differ)', allOk(tw, 6) && pts(b6, [L3]) !== pts(tw, [L3])
    && JSON.stringify(rOf(b6, L3)) !== JSON.stringify(rOf(tw, L3)) && xpOf(b6, L3) !== xpOf(tw, L3) && sigOf(r, L3).w === sigOf(last(tw), L3).w + 1, show(b6, [L3]) + ' vs ' + show(tw, [L3]));
  T('[6] mutant: the whole match read (Q263) -> held, H3 lower (last of 2)', allOk(m.permatch, 6) && nHeld(m.permatch) === 1 && ptsIn(m.permatch, H3)[0] < ptsIn(b6, H3)[0], show(m.permatch, [H3]));
  T('[6] mutant: nobody settles as before -> L3 as his twin', allOk(m.noown, 6) && sameFor(m.noown, tw, [L3]) && pts(m.noown, [L3]) !== pts(b6, [L3]), show(m.noown, [L3]));
  const streak2 = new RegExp('group-decay [^\\n]*' + v.pid(L3).slice(0, 8) + ' repeat-group streak 2');
  T('[6] his repeat-group step on the roster without the stand-ins (H3 again: streak 2); mutant (with them: a new group) -> his rating moves otherwise, his points the same',
    streak2.test(outOf(b6)) && allOk(m.nogown, 6) && !streak2.test(outOf(m.nogown)) && pts(m.nogown, [L3]) === pts(b6, [L3])
    && JSON.stringify(rOf(m.nogown, L3)) !== JSON.stringify(rOf(b6, L3)), show(m.nogown, [L3]) + ' vs ' + show(b6, [L3]));
  // Q264 review: his ranked rating (rm / rv, read by the points plan of his later matches) as with Q227 step two off too;
  //   it is in the state only, no board write shows it, so the writes compared above cannot catch it
  T('[6] review: the marked L3\'s stored and ranked rating in the state exactly as with Q227 step two off', allOk(n, 6) && skOf(r, L3) === skOf(last(n), L3)
    && skOf(r, L3) !== 'null', skOf(r, L3) + ' vs ' + skOf(last(n), L3));
  withMutant('noranked', RANKED_OWN, '', (script) => {
    const mr = timeline(w6.steps, script, from3());
    // O480 (added after Q264 was written): his rating-board row now publishes the ranked rating in its details (0xCB), so
    //   that one value moves with it; the row's score and every other write of his stay the same
    const noRating = (rs) => JSON.stringify(JSON.parse(writesOf(rs, L3)).map((b) => b.replace(/&details=%cb[^&]*$/, '&details=%cb')));
    const ratingRow = (rs) => JSON.parse(writesOf(rs, L3)).filter((b) => /&details=%cb/.test(b)).join();
    T('[6] review mutant: his ranked rating read with the stand-ins -> another ranked rating (and the one his rating row publishes), every other write of his the same',
      allOk(mr, 6) && skOf(last(mr), L3) !== skOf(r, L3) && ratingRow(b6) !== '' && ratingRow(mr) !== ratingRow(b6) && noRating(mr) === noRating(b6),
      skOf(last(mr), L3) + ' vs ' + skOf(r, L3));
  });
}

// ---- [7] marks: the players who settled with the stand-ins, not the one who settled as before ----
{
  const r = last(b6), at = sxOf(r, L5);
  T('[7] L5 / L6 marked, H3 paired with them too (his pairing with L3 / L4 kept), all with the settle\'s clock, L3\'s marks as after C1', at > 0 && sxOf(r, L6) === at
    && sxOf(r, H3) === 0 && JSON.stringify(swOf(r, H3)) === JSON.stringify(swOf(last(a3), H3).concat([[v.pid(L5), at], [v.pid(L6), at]])) && swOf(last(a3), H3).length === 2
    && marks(r, L3) === marks(last(a3), L3) && sxOf(r, L3) > 0 && sxOf(r, L3) < at, JSON.stringify([marks(r, L3), marks(last(a3), L3), marks(r, H3), at]));
  withMutant('sxown', SX_SKIP, '', (script) => {
    const m = timeline(w6.steps, script, from3());
    T('[7] mutant: every one marked -> L3 paired with the two (his marks changed)', allOk(m, 6) && marks(last(m), L3) !== marks(last(a3), L3) && swOf(last(m), L3).length === 2
      && swOf(last(m), L3)[0][1] === sxOf(last(m), L5));
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
  const mt = 2 | (1 << 4), h = 0xC26D, ros = [X10, L3, H11, H12, L5, L6];   // seats 0-1 a party: X10 (leaves) + L3 (stood in at C1)
  const truth = [3900, 4800, 6100, 3500, 5200, 4400], fake = [2000, 1900, 1800, 1700, 6100, 5200];
  const k = keyRecs(mt, h, ros, truth), pick = (xs, is) => is.map((i) => xs[i]);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, mt, h, i, placeIn(fake, i), placeIn(fake, i) === 1, ros, fake) }));
  const Ls = [4, 5], Ws = [1, 2, 3], St = [0, 1, 2, 3];   // X10 writes the start only
  const left = pick(k.S, St).concat(pick(k.R, Ws));
  const steps = [[0, k.S], [2 * MIN, k.S.concat(pick(Rf, Ls))], [5 * MIN, k.S.concat(pick(k.R, Ws), pick(Rf, Ls))], [GRACE, left], [LEAVE, left], [3 * HOUR, left]];
  const cvG = (rs) => { const e = ((last(rs).state.CONFESSIONS_FILE || {})[v.pid(X10) + '|' + k.key]) || {}; return e.cv ? e.g | 0 : null; };
  const b = timeline(steps, null, from3());
  T('[10] settled with the stand-ins, X10 convicted, L3 settling as before Q227', allOk(b, 6) && processedOf(last(b)).has(k.key) && nStood(b) === 2 && nOwn(b) === 1 && leavesOf(last(b), X10) === 1
    && cvG(b) != null, outOf(b).slice(-900));
  withMutant(NOSTAND[0], NOSTAND[1], NOSTAND[2], (script) => {
    const n = timeline(steps, script, from3());
    T('[10] L3\'s gain by the leave as with Q227 step two off', allOk(n, 6) && cvG(n) === cvG(b) && writesOf(b, L3) === writesOf(n, L3), JSON.stringify([cvG(b), cvG(n)]));
  });
  withMutant('nog2', G2, '', (script) => {
    const m = timeline(steps, script, from3());
    T('[10] mutant: his gain read with the stand-ins -> another gain', allOk(m, 6) && cvG(m) !== cvG(b), JSON.stringify([cvG(b), cvG(m)]));
  });
}

// ======== Q265: a seat that stood in for a player there is rated ========

// ---- [11] the fixed old account with a new one each match, the same two withdrawing every time ----
const Q0 = SID(961), Q2 = SID(962), Q3 = SID(963), QN = [SID(964), SID(965), SID(966)];
ALL.push(Q0, Q2, Q3, ...QN);
// each match after the first also played honestly from the same state (everybody keeps his rows): its change of the sum in twinD;
//   recant (Q275): the two who settle write the made-up result with the two who withdraw first (seen agreeing), then their own
function fixedNew(script, recant) {
  const who = [Q0, Q2, Q3].concat(QN), pick = (xs, is) => is.map((j) => xs[j]);
  for (const s of who) LP_AT[s] = 8500;   // grandmaster (Q160: rs 0, an expected result in a mismatch moves nothing)
  let state = null; const sums = [], twinD = [], all = [];
  for (let i = 0; i < QN.length; i++) {
    const ros = [Q0, QN[i], Q2, Q3], G = [6100, 5200, 3000, 2900], Fk = [3000, 2900, 6100, 5200], h = 0xE2A0 + i, k = keyRecs(2, h, ros, G);
    const Rf = ros.map((s, j) => ({ sid: s, d: rec(0xB1, 2, h, j, placeIn(Fk, j), placeIn(Fk, j) === 1, ros, Fk) }));
    const left = pick(k.S, [0, 1]).concat(pick(k.R, [0, 1])), both = k.S.concat(k.R), files = state ? advance(state, 3 * HOUR) : null;
    if (i > 0) {
      const tw = timeline([[0, k.S], [2 * MIN, k.S.concat(pick(k.R, [2, 3]))], [5 * MIN, both], [MIN, both], [GRACE, both], [LEAVE, both], [3 * HOUR, both]], script, files);
      if (!allOk(tw, 7)) return { ok: false, rs: all.concat(tw), sums, twinD };
      twinD.push(ros.reduce((a, s) => { const p = ptsIn(tw, s); return a + (p.length ? p[p.length - 1] - LP_AT[s] : 0); }, 0));
    }
    const rs = timeline([[0, k.S], [2 * MIN, k.S.concat(pick(Rf, recant ? [0, 1, 2, 3] : [2, 3]))], [5 * MIN, pick(k.S, [0, 1])], [MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left]], script, files);
    all.push(...rs);
    if (!allOk(rs, 7)) return { ok: false, rs: all, sums, twinD };
    for (const s of ros) { const p = ptsIn(rs, s); if (p.length) LP_AT[s] = p[p.length - 1]; }
    state = last(rs).state; sums.push(who.reduce((a, s) => a + LP_AT[s] - 8500, 0));
  }
  return { ok: true, rs: all, sums, twinD, moved: sums.slice(1).map((x, i) => x - sums[i]) };
}
{
  const o = fixedNew();
  T('[11] the fixed old account with a new one each match, the same two withdrawing every time: +27 in the first match (they stood in), the two rated after',
    o.ok && o.sums[0] === 27 && nStood(o.rs) === 2 && nRated(o.rs) === 4 && nOwn(o.rs) === 0 && nHeld(o.rs) === 0 && none(o.rs.slice(0, 7), Q2) && ptsIn(o.rs, Q2).length === 2,
    JSON.stringify([o.ok, nStood(o.rs), nRated(o.rs), nOwn(o.rs), o.sums]) + (o.ok ? '' : last(o.rs).out.slice(-800)));
  T('[11] ... and each match after the first moves the points sum exactly as the same match played honestly (nothing out of the withdrawal)', o.ok
    && JSON.stringify(o.moved) === JSON.stringify(o.twinD), JSON.stringify([o.moved, o.twinD]));
  withMutant(RATE_OFF[0], RATE_OFF[1], RATE_OFF[2], (script) => {
    const m = fixedNew(script);
    T('[11] mutant: nobody rated (as Q264) -> the old one settles as before Q227 next to each new one: the second match makes more than played honestly, the sum ends higher',
      m.ok && nStood(m.rs) === 6 && nOwn(m.rs) === 2 && m.moved[0] > m.twinD[0] && m.sums[2] > o.sums[2], JSON.stringify([m.ok, nStood(m.rs), nOwn(m.rs), m.sums, m.moved, m.twinD]));
  });
}

// ---- [12] (Q265 review) the pairing carried by a seat put back (Q185), not by a writer ----
// C1 as [3]: H13 / A13 honest, L13 / L14 withdraw and stand in (H13 paired with them). C2, inside the window, 5P: the two
//   write a made-up result with themselves on top (seen agreeing), then blank their rows; H13 and two fresh honest players
//   write the real one (seen agreeing); then H13's row is gone (overwritten by a later record of his): he is put back at his
//   agreed place, and the two who write met neither L13 nor L14.
const H13 = SID(971), A13 = SID(972), L13 = SID(973), L14 = SID(974), B13 = SID(975), C13 = SID(976);
ALL.push(H13, A13, L13, L14, B13, C13);
{
  const c1 = timeline(wd2(2, 0xC2C1, [H13, A13, L13, L14], [2, 3], S4, F).steps);
  const ros = [H13, B13, C13, L13, L14], T5 = [5200, 6100, 4800, 3000, 2900], F5 = [3000, 2900, 2800, 6100, 5200], h = 0xC2C2, k = keyRecs(2, h, ros, T5);
  const pick = (xs, is) => is.map((i) => xs[i]), all = k.S.concat(k.R), gone = k.S.concat(pick(k.R, [1, 2]));
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F5, i), placeIn(F5, i) === 1, ros, F5) }));
  const steps = [[0, k.S], [MIN, k.S.concat(pick(Rf, [3, 4]))], [MIN, k.S.concat(pick(k.R, [0, 1, 2]))], [MIN, gone], [GRACE, gone], [LEAVE, gone], [3 * HOUR, gone]];
  const twin = [[0, k.S], [MIN, all], [MIN, all], [MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]];
  const from = () => advance(last(c1).state, 3 * HOUR);
  const BACKED = new RegExp('agreed-back ' + k.key + ': seat 0 = ' + v.pid(H13).slice(0, 8) + ' record gone but seen agreeing earlier -- settled at his agreed place 2 of 5, as if his record were still there \\(Q185\\)');
  const b = allOk(c1, 6) && nStood(c1) === 2 ? timeline(steps, null, from()) : [], tw = allOk(c1, 6) ? timeline(twin, null, from()) : [], r = b.length ? last(b) : null;
  T('[12] put back (Q185) and the two rated at their place read now (4th and 5th of 5) for him alone, nobody held or settling as before Q227', allOk(b, 7) && processedOf(r).has(k.key)
    && BACKED.test(outOf(b)) && RATED_LINE(k.key, L13, 4, 5, 'seat 0 = [0-9a-f]{8}').test(outOf(b)) && RATED_LINE(k.key, L14, 5, 5, 'seat 0 = [0-9a-f]{8}').test(outOf(b))
    && nRated(b) === 2 && nStood(b) === 0 && nHeld(b) === 0 && nOwn(b) === 0 && leavesOf(r, L13) === 0 && leavesOf(r, L14) === 0, (r ? outOf(b) : outOf(c1)).slice(-900));
  T('[12] ... every points and rating write of the five exactly the honest twin\'s (all five wrote the real result)', allOk(tw, 7) && sameFor(b, tw, ros) && ptsIn(b, L13).length === 1,
    show(b, ros) + ' vs ' + show(tw, ros));
  T('[12] ... the marks: L13 / L14 marked again, H13 (put back) and the two who wrote paired with them, all with this settle\'s clock', !!r && sxOf(r, L13) > 0 && sxOf(r, L14) === sxOf(r, L13)
    && [H13, B13, C13].every((s) => sxOf(r, s) === 0 && JSON.stringify(swOf(r, s)) === JSON.stringify([[v.pid(L13), sxOf(r, L13)], [v.pid(L14), sxOf(r, L13)]])),
    r ? JSON.stringify(ros.map((s) => marks(r, s))) : '');
  withMutant('writersonly', 'const rated0 = parts.slice(),', 'const rated0 = parts.filter((p) => g.some((x) => String(x.steamID) === String(p.steamID))),', (script) => {
    const m = timeline(steps, script, from());
    T('[12] mutant: only the writers read -> the two stand in, H13 settles as before Q227 (another gain than the honest twin\'s)', allOk(m, 7) && nRated(m) === 0 && nStood(m) === 2
      && nOwn(m) === 1 && OWN_LINE(k.key, H13).test(outOf(m)) && none(m, L13) && pts(m, [H13]) !== pts(tw, [H13]), show(m, ros) + ' vs ' + show(tw, ros));
  });
}

// ======== Q275: Q265 skipped when every player rated here changed his result ========

// ---- [13] the honest player framed twice; a recant next to an honest one; a seat put back; a group recanting on purpose ----
const X13 = SID(981), C13a = SID(982), C13b = SID(983), C13c = SID(984);
ALL.push(X13, C13a, C13b, C13c);
// X13 honest, 1st; all four write the real result and are seen agreeing (pinned), then X13's row is overwritten (a later
//   record of his) and the three rewrite it with him last
function framed(h) {
  const ros = [X13, C13a, C13b, C13c], T4 = [6100, 5200, 4800, 3900], F4x = [3000, 6100, 5200, 4800], k = keyRecs(2, h, ros, T4);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F4x, i), placeIn(F4x, i) === 1, ros, F4x) }));
  const re = k.S.concat(Rf.slice(1));
  return { k, ros, steps: [[0, k.S], [2 * MIN, k.S.concat(k.R)], [MIN, re], [GRACE, re], [LEAVE, re], [3 * HOUR, re]] };
}
{
  const f1 = framed(0xC2D1), f2 = framed(0xC2D2);
  const a = timeline(f1.steps), from = () => advance(last(a).state, 3 * HOUR);
  T('[13] the first time: X13 stands in at 4 of 4 (no points or rating of his), the three settle', allOk(a, 6) && processedOf(last(a)).has(f1.k.key) && nStood(a) === 1
    && STOOD_LINE(f1.k.key, X13).test(outOf(a)) && none(a, X13) && rOf(a, X13).length === 0, outOf(a).slice(-900));
  const by = 'seat 1 = [0-9a-f]{8}, seat 2 = [0-9a-f]{8}, seat 3 = [0-9a-f]{8}';
  const b = allOk(a, 6) ? timeline(f2.steps, null, from()) : [], r = b.length ? last(b) : null;
  T('[13] the second time inside the window, the three all recanted: X13 not rated (no points or rating of his), the unrated and held lines, the row', allOk(b, 6) && processedOf(r).has(f2.k.key)
    && none(b, X13) && rOf(b, X13).length === 0 && nRated(b) === 0 && nStood(b) === 0 && nHeld(b) === 1 && UNRATED_LINE(f2.k.key, X13, by).test(outOf(b)) && HELD_LINE(f2.k.key).test(outOf(b))
    && sumRow(b, UNRATED_RE) === 1 && sumRow(b, RATED_RE) === 0 && leavesOf(r, X13) === 0, outOf(b).slice(-900));
  withMutant(RATE_OFF[0], RATE_OFF[1], RATE_OFF[2], (script) => {
    const m = allOk(a, 6) ? timeline(f2.steps, script, from()) : [];
    T('[13] ... the three exactly as with the Q265 step off (Q264)', allOk(m, 6) && sameFor(b, m, f2.ros) && nHeld(m) === 1, show(b, f2.ros) + ' vs ' + show(m, f2.ros));
  });
  withMutant(NOGATE[0], NOGATE[1], NOGATE[2], (script) => {
    const m = allOk(a, 6) ? timeline(f2.steps, script, from()) : [];
    T('[13] mutant: no gate (as Q265) -> X13 rated at 4 of 4 (down)', allOk(m, 6) && nRated(m) === 1 && RATED_LINE(f2.k.key, X13, 4, 4, by).test(outOf(m)) && down(m, X13), show(m, f2.ros));
  });
  withMutant('norc', RECANT_ADD, '', (script) => {
    const m = allOk(a, 6) ? timeline(f2.steps, script, from()) : [];
    T('[13] mutant: no recant collected -> X13 rated (down)', allOk(m, 6) && nRated(m) === 1 && down(m, X13), show(m, f2.ros));
  });
}
// L13r (true 1st) writes the made-up result with L13p / L13q (they on top) first, then the real one with H13r (true 2nd); the two blank
const L13r = SID(985), H13r = SID(986), L13p = SID(987), L13q = SID(988);
ALL.push(L13r, H13r, L13p, L13q);
function joined(h) {
  const ros = [L13r, H13r, L13p, L13q], k = keyRecs(2, h, ros, S4), pick = (xs, is) => is.map((i) => xs[i]);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F, i), placeIn(F, i) === 1, ros, F) }));
  const left = pick(k.S, [0, 1]).concat(pick(k.R, [0, 1])), all = k.S.concat(k.R);
  return { k, ros, steps: [[0, k.S], [2 * MIN, k.S.concat(pick(Rf, [0, 2, 3]))], [5 * MIN, pick(k.S, [0, 1])], [MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left]],
    twin: [[0, k.S], [2 * MIN, k.S.concat(pick(k.R, [0, 2, 3]))], [5 * MIN, all], [MIN, all], [GRACE, all], [LEAVE, all], [3 * HOUR, all]] };
}
{
  const j1 = joined(0xC2D3), j2 = joined(0xC2D4);
  const a = timeline(j1.steps), from = () => advance(last(a).state, 3 * HOUR);
  T('[13] a recant next to an honest one, the first time: the two stand in, H13r 2nd of 4 (up)', allOk(a, 7) && nStood(a) === 2 && up(a, H13r) && none(a, L13p), outOf(a).slice(-900));
  const b = allOk(a, 7) ? timeline(j2.steps, null, from()) : [], tw = allOk(a, 7) ? timeline(j2.twin, null, from()) : [];
  T('[13] ... the second time: L13r recanted, H13r did not -> the two rated (3rd, 4th), H13r exactly the honest twin\'s (2nd: up)', allOk(b, 7) && allOk(tw, 7) && nRated(b) === 2
    && sumRow(b, UNRATED_RE) === 0 && sameFor(b, tw, [H13r]) && up(b, H13r) && down(b, L13p) && down(b, L13q), show(b, j2.ros) + ' vs twin ' + show(tw, j2.ros));
  withMutant('g1', ALL_RECANT, 'const allRecant = rated0.some((p) => recanted.has(String(p.steamID)));', (script) => {
    const m = allOk(a, 7) ? timeline(j2.steps, script, from()) : [];
    T('[13] mutant: any recant, not every -> the two not rated, held, H13r 2nd of 2 (down)', allOk(m, 7) && nRated(m) === 0 && nHeld(m) === 1 && down(m, H13r), show(m, j2.ros));
  });
}
// C1 as [3]: H13s / A13s honest, L13s / L13t withdraw (H13s paired with them). C2, 5P: W13a / W13b write the made-up result with the
//   two (all four seen agreeing on it), then the real one with H13s (he is pinned on it); H13s's row goes (put back, Q185)
const H13s = SID(989), A13s = SID(990), L13s = SID(991), L13t = SID(992), W13a = SID(993), W13b = SID(994);
ALL.push(H13s, A13s, L13s, L13t, W13a, W13b);
{
  const c1 = timeline(wd2(2, 0xC2D5, [H13s, A13s, L13s, L13t], [2, 3], S4, F).steps);
  const ros = [H13s, W13a, W13b, L13s, L13t], T5 = [5200, 6100, 4800, 3000, 2900], F5 = [3000, 2900, 2800, 6100, 5200], h = 0xC2D6, k = keyRecs(2, h, ros, T5);
  const pick = (xs, is) => is.map((i) => xs[i]), gone = k.S.concat(pick(k.R, [1, 2]));
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F5, i), placeIn(F5, i) === 1, ros, F5) }));
  const steps = [[0, k.S], [MIN, k.S.concat(pick(Rf, [1, 2, 3, 4]))], [MIN, k.S.concat(pick(k.R, [0, 1, 2]))], [MIN, gone], [GRACE, gone], [LEAVE, gone], [3 * HOUR, gone]];
  const from = () => advance(last(c1).state, 3 * HOUR);
  const b = allOk(c1, 6) && nStood(c1) === 2 ? timeline(steps, null, from()) : [], o = outOf(b);
  T('[13] every writer recanted, a seat put back (pinned on the result read now): the two rated at 4th / 5th of 5 for him, nothing passed on', allOk(b, 7) && /agreed-back [^\n]*\(Q185\)/.test(o)
    && (o.match(/  recant [0-9]/g) || []).length === 2 && RATED_LINE(k.key, L13s, 4, 5, 'seat 0 = [0-9a-f]{8}').test(o) && RATED_LINE(k.key, L13t, 5, 5, 'seat 0 = [0-9a-f]{8}').test(o)
    && nRated(b) === 2 && sumRow(b, UNRATED_RE) === 0, (b.length ? o : outOf(c1)).slice(-900));
  withMutant('writers', ALL_RECANT, 'const allRecant = rated0.filter((p) => g.some((x) => String(x.steamID) === String(p.steamID))).every((p) => recanted.has(String(p.steamID)));', (script) => {
    const m = allOk(c1, 6) ? timeline(steps, script, from()) : [];
    T('[13] mutant: the writers only read -> the two not rated', allOk(m, 7) && nRated(m) === 0 && sumRow(m, UNRATED_RE) === 2, outOf(m).slice(-600));
  });
}
{
  const o = fixedNew(undefined, true);
  withMutant(RATE_OFF[0], RATE_OFF[1], RATE_OFF[2], (script) => {
    const m = fixedNew(script, true);
    T('[13] the fixed old account with a new one each match, the two who settle recanting every match: the sums exactly those with the Q265 step off (Q264), passed on every match after the first',
      o.ok && m.ok && JSON.stringify(o.sums) === JSON.stringify(m.sums) && nRated(o.rs) === 0 && (outOf(o.rs).match(/  agreed-stood-unrated [0-9]/g) || []).length === 4,
      JSON.stringify([o.ok, m.ok, o.sums, m.sums, nRated(o.rs)]));
  });
}


// ---- [14] (Q275 review) one of the three breaks a record of his: Q109 drops it, he stays ranked at his seat ----
// framed() with C13c's records bent: 'ros' = the record names no Steam id at seat 0 (a roster reason, nobody flagged), 'dur' =
//   a duration of -1 (his own field, he is flagged); `twice` = the rewritten one on two shards (Q109 drops both)
function framedD(h, real, fake, twice) {
  const ros = [X13, C13a, C13b, C13c], T4 = [6100, 5200, 4800, 3900], F4x = [3000, 6100, 5200, 4800], k = keyRecs(2, h, ros, T4);
  const bend = (x, how, sc) => ({ sid: x.sid, d: how === 'ros' ? rec(0xB1, 2, h, 3, placeIn(sc, 3), placeIn(sc, 3) === 1, ['5'].concat(ros.slice(1)), sc)
    : how === 'dur' ? x.d.slice(0, 9).concat([-1], x.d.slice(10)) : x.d });
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F4x, i), placeIn(F4x, i) === 1, ros, F4x) }));
  const R = k.R.slice(0, 3).concat([bend(k.R[3], real, T4)]), re = k.S.concat(Rf.slice(1, 3), [bend(Rf[3], fake, F4x)], twice ? [bend(Rf[3], fake, F4x)] : []);
  return { k, ros, steps: [[0, k.S], [2 * MIN, k.S.concat(R)], [MIN, re], [GRACE, re], [LEAVE, re], [3 * HOUR, re]] };
}
const DROP_FILL = '      for (const x of sp.drop) dropRecs.push(...x.recs);   // Q275 review\n';
const DROP_PIN = 'for (const r of g.concat(dropRecs)) { const h = pid(String(r.steamID)); if (agv[h] == null) agv[h] = agreedPin(r.d[5]); } }';
const DROP_RC = '      if (pend.agv) for (const r of g.concat(dropRecs)) {   // Q275 review: the records Q109 dropped too (a writer ranked at his seat)\n';
const ONCE = "        if (recanted.has(String(r.steamID))) continue;   // Q275 review: once per writer (Q109 drops all of a writer's records)\n";
const NODROPPIN = ['nodroppin', DROP_PIN, DROP_PIN.replace('g.concat(dropRecs)', 'g')];
const NODROPRC = ['nodroprc', DROP_RC, DROP_RC.replace('g.concat(dropRecs)', 'g')];
const NODROPFILL = ['nodropfill', DROP_FILL, ''];
{
  const at = (a, from) => SRC.indexOf(a, from || 0);
  const SEAT_DECL = "    let dropSeat = null;   // Q109: dropped writer sid -> consensus seat (-1 = none: not rated, still no leaver; a kept writer's seat is never taken)\n";
  const RECS_DECL = "    const dropRecs = [];   // Q275 review: the records Q109 drops below (in this consistent group: the kept ones' scores)\n";
  const KEEP = '      g = sp.keep;\n';
  T('[0] Q275 review: the records Q109 drops collected next to dropSeat and right where the kept ones are taken, pinned with them, checked for a recant with them, once per writer',
    [SEAT_DECL, RECS_DECL, KEEP, DROP_FILL, DROP_PIN, DROP_RC, ONCE, RECANT_ADD].every((a) => SRC.split(a).length === 2) && at(SEAT_DECL) + SEAT_DECL.length === at(RECS_DECL)
    && at(KEEP) + KEEP.length === at(DROP_FILL) && at(DROP_FILL) < at('const vNow = vecOf(g[0]);') && at('const vNow = vecOf(g[0]);') < at(DROP_PIN)
    && at(GUARD) + GUARD.length === at(DROP_RC) && at(DROP_RC) < at(ONCE) && at(ONCE) + ONCE.length === at(RECANT_ADD)
    && SRC.indexOf("        if (pend.agv[h] == null || pend.agv[h] === agreedPin(r.d[5])) continue;\n" + ONCE) > at(DROP_RC));
}
{
  const by = 'seat 1 = [0-9a-f]{8}, seat 2 = [0-9a-f]{8}, seat 3 = [0-9a-f]{8}';
  const shapes = [['D1', 'none', 'ros', false, 'the rewritten one names no Steam id (a roster reason)', ['nodroprc', 'nodropfill']],
    ['D2', 'none', 'dur', false, 'the rewritten one says a duration of -1 (his own field)', ['nodroprc', 'nodropfill']],
    ['D3', 'ros', 'ros', false, 'both his records name no Steam id (never kept, never on the agreed list)', ['nodroppin', 'nodroprc', 'nodropfill']],
    ['D4', 'ros', 'none', false, 'the real one names no Steam id, the rewritten one clean', ['nodroppin', 'nodropfill']],
    ['D5', 'none', 'dur', true, 'the rewritten one (duration -1) on two shards', ['nodroprc', 'nodropfill']]];
  const MU = { nodroppin: NODROPPIN, nodroprc: NODROPRC, nodropfill: NODROPFILL };
  let n = 0;
  for (const [tag, real, fake, twice, what, reds] of shapes) {
    const f1 = framedD(0xC2E1 + 2 * n, real, fake, twice), f2 = framedD(0xC2E2 + 2 * n, real, fake, twice); n++;
    const a = timeline(f1.steps), from = () => advance(last(a).state, 3 * HOUR);
    const b = allOk(a, 6) ? timeline(f2.steps, null, from()) : [], o = outOf(b);
    T('[14] ' + tag + ', ' + what + ': X13 not rated the second time either, C13c ranked at his seat (Q109) and seen recanting once',
      allOk(a, 6) && nStood(a) === 1 && none(a, X13) && allOk(b, 6) && processedOf(last(b)).has(f2.k.key) && none(b, X13) && rOf(b, X13).length === 0 && nRated(b) === 0
      && UNRATED_LINE(f2.k.key, X13, by).test(o) && /\(Q109\)/.test(o) && ptsIn(b, C13c).length === 1 && (o.match(RECANT_LINE_RE(f2.k.key, C13c)) || []).length === 1,
      show(b, f2.ros) + ' ' + o.slice(-700));
    for (const mu of reds) withMutant(MU[mu][0] + '-' + tag, MU[mu][1], MU[mu][2], (script) => {
      const m = allOk(a, 6) ? timeline(f2.steps, script, from()) : [];
      T('[14] ' + tag + ' mutant (' + mu + ') -> X13 rated at 4 of 4 (down)', allOk(m, 6) && nRated(m) === 1 && down(m, X13), show(m, f2.ros));
    });
    if (twice) withMutant('once-' + tag, ONCE, '', (script) => {
      const m = allOk(a, 6) ? timeline(f2.steps, script, from()) : [];
      T('[14] ' + tag + ' mutant (no once-per-writer) -> C13c counted twice', allOk(m, 6) && (outOf(m).match(RECANT_LINE_RE(f2.k.key, C13c)) || []).length === 2, outOf(m).slice(-500));
    });
  }
}
// the [13] recant next to an honest one, with H13r's real record naming no Steam id at seat 0 (Q109 drops it for a roster
//   reason, nobody flagged; he is ranked at his seat): his record never changes, so he is never seen recanting, and every
//   points and rating write of the four is exactly what it is with the three Q275 review lines off. (Nobody stands in
//   here: with his record dropped the stand-ins are not used; the same on today's main and on the Q264 / Q265 steps.)
const L14r = SID(1001), H14r = SID(1002), L14p = SID(1003), L14q = SID(1004);
ALL.push(L14r, H14r, L14p, L14q);
function joinedBent(h) {
  const ros = [L14r, H14r, L14p, L14q], k = keyRecs(2, h, ros, S4), pick = (xs, is) => is.map((i) => xs[i]);
  const Rf = ros.map((s, i) => ({ sid: s, d: rec(0xB1, 2, h, i, placeIn(F, i), placeIn(F, i) === 1, ros, F) }));
  const left = pick(k.S, [0, 1]).concat([k.R[0], { sid: H14r, d: rec(0xB1, 2, h, 1, placeIn(S4, 1), false, [L14r, H14r, '5', L14q], S4) }]);
  return { k, ros, steps: [[0, k.S], [2 * MIN, k.S.concat(pick(Rf, [0, 2, 3]))], [5 * MIN, pick(k.S, [0, 1])], [MIN, left], [GRACE, left], [LEAVE, left], [3 * HOUR, left]] };
}
{
  const run2 = (script) => {
    const a = timeline(joinedBent(0xC2F1).steps, script), j2 = joinedBent(0xC2F2);
    return { a, j2, b: allOk(a, 7) ? timeline(j2.steps, script, advance(last(a).state, 3 * HOUR)) : [] };
  };
  const bt = run2(), ob = outOf(bt.b), oa = outOf(bt.a), four = [L14r, H14r, L14p, L14q];
  withMutant(NODROPFILL[0] + '-honest', NODROPFILL[1], NODROPFILL[2], (script) => {
    const off = run2(script);
    T('[14] an honest one whose record Q109 drops (a roster reason) next to a recant, twice: ranked at his seat, never seen recanting, every write of the four exactly as with the Q275 review lines off',
      allOk(bt.a, 7) && allOk(bt.b, 7) && allOk(off.b, 7) && /\(Q109\)/.test(oa) && /\(Q109\)/.test(ob) && ptsIn(bt.b, H14r).length === 1
      && (oa.match(RECANT_LINE_RE(joinedBent(0xC2F1).k.key, H14r)) || []).length === 0 && (ob.match(RECANT_LINE_RE(bt.j2.k.key, H14r)) || []).length === 0
      && (ob.match(RECANT_LINE_RE(bt.j2.k.key, L14r)) || []).length === 1 && fOf(last(bt.b), H14r) === 0
      && sameFor(bt.a, off.a, four) && sameFor(bt.b, off.b, four), show(bt.b, bt.j2.ros) + ' vs off ' + show(off.b, bt.j2.ros) + ' ' + ob.slice(-600));
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-stand-in-window) ===' : '=== PASS -- 0 fail (ffa-stand-in-window) ===');
process.exit(failN ? 1 : 0);
