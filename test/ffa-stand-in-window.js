'use strict';
// Q263 (cloud audit 2026-10, found by the Q227 review): a stand-in (Q227 step two) is not rated, so the players rated
//   against him take a win nobody pays for. Four modified clients alone in a ranked FFA took turns: two wrote a made-up result
//   with themselves on top (seen agreeing, pinned) and blanked their rows at once, the other two wrote their own result and
//   settled with the blanked seats standing in at the bottom; the next match the other way round. At the zero-sum top
//   (grandmaster) that made +27 a 4P match out of nothing, without end. Now a stand-in is used only while none of the players
//   rated at the settle settled with a stand-in in the last STAND_IN_WINDOW_MS (signals.players[pid].sx); otherwise the
//   seats stay out as before Q227.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/ffa-agreed-recant.js).
//   [0] wiring pins: the window and its default, the candidates collected where Q227 pushed the stand-in, the check after
//       the absent-seat loop (so the seats put back count too), the mark right after the settle's signals, the summary row
//   [1] the ring: four accounts at grandmaster, six matches taking turns -> stand-ins in the first match only, nobody gains
//       after it (the sum after six = the sum after one), the held lines and rows; the honest rotation of the same four:
//       zero-sum, no mark; mutant (the check never true) -> stand-ins every match, the sum grows
//   [2] two liars doing Q227 match after match against different honest pairs: each honest pair settles as the honest twin
//       (the 2nd up, not last of 2), the liars' own marks not read; mutant (the stand-ins' marks read too) -> the second
//       honest pair held, its 2nd down
//   [3] the same honest pair again inside the window, with other liars: held -> the posts exactly as with Q227 step two
//       off (as before Q227), the held line and row, the liars not rated, not convicted, no new mark, the honest marks not
//       refreshed; mutant (no mark) -> stood in again
//   [4] the window: the marks 31 days old -> stood in again (the 2nd up); 29 days -> held; STAND_IN_WINDOW_MS read from the
//       env; mutant (the age not read) -> held after 31 days too
//   [5] marks only at a real settle with a stand-in: the honest twin, quick C1 -> no mark; ranked C1 -> all four marked
//       (the stood seats too); mutant (marked at every settle) -> the honest twin marked
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
const LATELY = '        const lately = parts.filter((p) => { const e = signals.players[pid(String(p.steamID))]; return !!(e && e.sx && nowMs - e.sx < STAND_IN_WINDOW_MS); });\n';
const AGE = 'nowMs - e.sx < STAND_IN_WINDOW_MS';
const SORT = '      if (back) parts.sort((a, b) => a.seat - b.seat);\n';
const RMS = '    recordMatchSignals(signals, g, live, rankOf, matchType, false, nowMs);\n';
const SX = '    if (stoodIds.size) { for (const p of parts) sigPlayer(signals, pid(String(p.steamID)), nowMs).sx = nowMs; sigDirty = true; }   // Q263: see STAND_IN_WINDOW_MS\n';
const HELD_RE = /\| of those, left out instead: a player rated at the settle settled with a stand-in in the window \(Q263\) \| (\d+) \|/;
const HELD_LINE = (key, days) => new RegExp('agreed-stood-held ' + key + ': seats? [0-9,]+ left out as before Q227: [^\\n]* settled with a stand-in in the last ' + (days || 30) + ' days \\(Q263\\)');
const nStood = (rs) => (outOf(rs).match(/  agreed-stood [0-9]/g) || []).length;
const nHeld = (rs) => (outOf(rs).match(/  agreed-stood-held [0-9]/g) || []).length;
const sxOf = (r, sid) => sigOf(r, sid).sx || 0;
const sxs = (r, sids) => sids.map((s) => sxOf(r, s) > 0);
const DAY = 86400000, WIN = 30 * DAY;
// carried state with every stand-in mark `ms` older (advance() leaves .sx alone: it is set from the job clock)
function ageSx(state, ms) {
  const f = JSON.parse(JSON.stringify(state)), sg = f.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].sx) sg.players[k].sx -= ms;
  return f;
}
const S4 = [6100, 5200, 4800, 3900], F = [3000, 2900, 6100, 5200];

console.log('=== a stand-in only while nobody rated there settled with one in the window (Q263) ===');

// ---- [0] wiring ----
{
  const at = (a, from) => SRC.indexOf(a, from || 0);
  const g = at(GUARD), loop = at(LOOP, g), lat = at(LATELY), srt = at(SORT, g);
  T('[0] the window, 30 days unless STAND_IN_WINDOW_MS', SRC.split(WIN_DEF).length === 2);
  T('[0] the candidates: declared right before the FFA guard, collected where Q227 pushed the stand-in',
    [DECL, CAND, STAND].every((a) => SRC.split(a).length === 2) && at(DECL) + DECL.length === g && at(STAND) + STAND.length === at(CAND) && loop < at(CAND));
  T('[0] the check after the absent-seat loop, before the seats are sorted (the writers and the seats put back read)',
    SRC.split(LATELY).length === 2 && SRC.split(SORT).length === 2 && at(CAND) < lat && lat < srt && srt - lat < 1600);
  T('[0] the mark right after the real settle\'s signals', [RMS, SX].every((a) => SRC.split(a).length === 2) && at(RMS) + RMS.length === at(SX));
  T('[0] the summary row, right after the Q227 stood row', /'\| of those, left out instead: a player rated at the settle settled with a stand-in in the window \(Q263\) \| ' \+ s\('agreedStoodHeld', 0\) \+ ' \|',/.test(SRC)
    && at("s('agreedStood', 0)") < at("s('agreedStoodHeld', 0)") && at("s('agreedStoodHeld', 0)") < at("s('recanted', 0)"));
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
  T('[1] nobody gains after the first match: the sum after six = the sum after one (+27), all four marked', o.ok && o.sums[0] === 27 && o.sums[5] === o.sums[0]
    && JSON.stringify(sxs(r, P)) === '[true,true,true,true]', JSON.stringify([o.sums, o.lp, sxs(r, P)]));
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
  withMutant('standers', LATELY, LATELY.replace('parts.filter(', 'parts.concat(stoodCand).filter('), (script) => {
    const m = twoVictims(script);
    T('[2] mutant: the stand-ins\' marks read too -> the second honest pair held, A2 last of 2 (down)', allOk(m.b, 6) && down(m.b, A2) && nHeld(m.b) === 1, show(m.b, o.wb.ros));
  });
}

// ---- [3] the same honest pair again inside the window, with other liars ----
const H3 = SID(921), A3 = SID(922), L3 = SID(923), L4 = SID(924), L5 = SID(925), L6 = SID(926);
ALL.push(H3, A3, L3, L4, L5, L6);
const w3a = wd2(2, 0xC265, [H3, A3, L3, L4], [2, 3], S4, F), w3b = wd2(2, 0xC266, [H3, A3, L5, L6], [2, 3], S4, F);
const a3 = timeline(w3a.steps);
const st3 = allOk(a3, 6) ? last(a3).state : null;
{
  const b = timeline(w3b.steps, null, advance(st3, 3 * HOUR)), r = last(b);
  T('[3] held: the held line and row, A3 last of 2 (down), L5 / L6 not rated, not convicted, not marked', allOk(b, 6) && processedOf(r).has(w3b.k.key) && HELD_LINE(w3b.k.key).test(outOf(b))
    && sumRow(b, HELD_RE) === 2 && nStood(b) === 0 && down(b, A3) && none(b, L5) && none(b, L6) && rOf(b, L5).length === 0 && leavesOf(r, L5) === 0 && leavesOf(r, L6) === 0
    && JSON.stringify(sxs(r, [L5, L6])) === '[false,false]', show(b, w3b.ros) + r.out.slice(-600));
  T('[3] the honest marks not refreshed by the held settle', sxOf(r, H3) === sxOf(last(a3), H3) && sxOf(r, A3) === sxOf(last(a3), A3) && sxOf(r, H3) > 0);
  withMutant('nostand', STAND, '          if (false) {\n', (script) => {
    const m = timeline(w3b.steps, script, advance(st3, 3 * HOUR));
    T('[3] the held settle exactly as with Q227 step two off (as before Q227)', allOk(m, 6) && JSON.stringify(last(m).posts) === JSON.stringify(r.posts)
      && pts(m, w3b.ros) === pts(b, w3b.ros), show(m, w3b.ros) + ' vs ' + show(b, w3b.ros));
  });
  withMutant('nosx', SX, '', (script) => {
    const ma = timeline(w3a.steps, script), mb = allOk(ma, 6) ? timeline(w3b.steps, script, advance(last(ma).state, 3 * HOUR)) : [];
    T('[3] mutant: no mark -> stood in again, A3 up', allOk(mb, 6) && up(mb, A3) && nStood(mb) === 2 && nHeld(mb) === 0, show(mb, w3b.ros));
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
  withMutant('noage', LATELY, LATELY.replace(AGE, 'true'), (script) => {
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
  T('[5] ranked C1: all four marked with the settle\'s clock (the stood seats too), nobody else', allOk(a3, 6) && JSON.stringify(sxs(last(a3), ros)) === '[true,true,true,true]'
    && new Set(ros.map((s) => sxOf(last(a3), s))).size === 1 && Object.values((last(a3).state.SIGNALS_FILE || {}).players || {}).filter((e) => e.sx).length === 4);
  withMutant('sxall', SX, SX.replace('if (stoodIds.size) {', 'if (true) {'), (script) => {
    const m = timeline(w3a.twin, script);
    T('[5] mutant: marked at every settle -> the honest twin marked', allOk(m, 6) && JSON.stringify(sxs(last(m), ros)) === '[true,true,true,true]');
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (ffa-stand-in-window) ===' : '=== PASS -- 0 fail (ffa-stand-in-window) ===');
process.exit(failN ? 1 : 0);
