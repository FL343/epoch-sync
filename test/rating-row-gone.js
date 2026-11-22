'use strict';
// rating-row-gone.js -- O976: the points rows (endless_rating_all) and accounts that no longer own the app.
//   Live 2026-11-22: the rows owed (version 6, placed players without a row, their ids read off the xp board) of the same accounts
//   came back HTTP 200 with a result other than 1 on every run since the lookup went live (2026-11-21 15:41Z: 7 accounts; 12 after
//   the ELP version 7 cutover settled five more placements) -- each played 3-5 runs inside an hour and was never seen again, one had
//   already been answered 27 on his xp row (a refund). maintainRating took no notice of the code: a warning a write, every run.
//   Now the per-account memory of the composite rows and the classic repack (soloState.ovGone, pid-keyed, OV_GONE_MS) covers these
//   rows: a 27 marks him (a log line, no warning); while the mark is fresh his key is left out of the rows owed and his row is not
//   sent unless he has a record this run; a row that lands clears his mark; any other failure warns with Steam's code; the marks are
//   saved by maintainRating itself (a quiet run saves the chain memory only on its own changes).
//   [1] units: ratingOwedLive (fresh mark out, stale mark in, no memory), ratingWriteCode (27 / 1 / none / garbage)
//   [2] REAL main(), quiet runs, offline board stub: two accounts with a row on the board that differs from the one owed; Steam
//       answers 27 for one -- the other is written, he is marked pid-keyed with a log line and no warning; the next run sends
//       nothing of his and says so; past 7 days he is tried once and marked again; once he owns the app again his row lands
//       and the mark goes; another failure code warns with the code and the answer
//   [3] mutants: marks not read / a 27 not marked / the marks not saved / a landed row not clearing / the code not in the warning
//   [4] wiring pins (the fresh exemption, the owed lookup through ratingOwedLive)
// Usage: node test/rating-row-gone.js
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_LB_SOLO', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD',
  'ENDLESS_RATING_LB', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD', 'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID', 'START_CONFIRM_MS',
  'LP_LAST_HOLD_MS', 'PAGE_CAP', 'CLASSIC_REPACK_CAP', 'CLASSIC_REPACK_EVERY', 'ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const VSRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(VSRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const S0_NOW = '2026-10-01T12:00:00Z';   // pre-season (season 0): the points board is the base name
const BOARD = { progress: 5, rAll: 34, ban: 55 };
// the offline board stub of test/classic-repack-gone.js, plus STUB_CODE = { steamID: result } (a SetLeaderboardScore of his answered
//   HTTP 200 { result: { result: code } }); STUB_GONE = the accounts answered 27 (no longer own the app; nothing kept)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const GONE = JSON.parse(process.env.STUB_GONE || '[]');",
  "const CODE = JSON.parse(process.env.STUB_CODE || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1];",
  '    const set = /SetLeaderboardScore/.test(u);',
  '    const code = set ? (GONE.indexOf(sid) >= 0 ? 27 : (CODE[sid] || 1)) : 1;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, code }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: had ? had.id : nextId++ } } });',
  '    }',
  '    return resp({ result: { result: code } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const bid = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[bid];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(script, boards, files, stub) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rating-row-gone-'));
  try {
    const stubPath = path.join(dir, 'stub.js'); fs.writeFileSync(stubPath, STUB);
    const fxPath = path.join(dir, 'fx.json'); fs.writeFileSync(fxPath, JSON.stringify({ boards }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: S0_NOW, STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      STUB_GONE: JSON.stringify((stub && stub.gone) || []), STUB_CODE: JSON.stringify((stub && stub.code) || {}),
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stubPath, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const DAY = 86400000;
const sA = SID(9761), sG = SID(9762);
const P = (sid) => v.pid(sid);
// the chain memory: two placed players (the one-points entry of season 0), no runs of any family
const all0 = (lp, ringMh) => ({ lp, placed: 1, seedRun: 0, n: 3, ring: [{ mh: ringMh, delta: lp, flags: 528 }, { mh: ringMh + 1, delta: 0, flags: 512 }, { mh: ringMh + 2, delta: 0, flags: 512 }], t: 0, h: [500, null, null, null], ht: 0 });
const solo0 = () => ({ runs: {}, wait: {}, ms: {}, held: {}, hist: { [P(sA) + '|all|0']: all0(1500, 4101), [P(sG) + '|all|0']: all0(75, 4201) } });
// the rows owed by that memory, and a board whose rows differ from them by one point (so each run plans the two writes)
const WANT = (() => { const st = solo0(); return { [sA]: v.ratingScoreOf(st, P(sA), 0), [sG]: v.ratingScoreOf(st, P(sG), 0) }; })();
function boards() {
  const b = [];
  for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  b.push({ id: BOARD.progress, name: 'progress', entries: [sA, sG].map((sid) => ({ steamID: sid, score: 10 })) });
  b.push({ id: BOARD.rAll, name: 'endless_rating_all', entries: [sA, sG].map((sid) => ({ steamID: sid, score: WANT[sid].score + 1, detailData: hexLE(WANT[sid].details) })) });
  b.push({ id: BOARD.ban, name: 'ban_board', entries: [] });
  return b;
}
const rowPosts = (r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + BOARD.rAll + '(&|$)').test(p.body));
const sentTo = (r) => rowPosts(r).map((p) => (/steamid=([0-9]+)/.exec(p.body) || [])[1]).sort();
const ovGoneOf = (r) => ((r.state.SOLO_FILE || {}).ovGone) || {};
const ageGone = (state, ms) => { const f = JSON.parse(JSON.stringify(state)); const g = f.SOLO_FILE && f.SOLO_FILE.ovGone; if (g) for (const k of Object.keys(g)) g[k] -= ms; return f; };
const warnsOf = (r) => r.out.split('\n').filter((l) => /##\[warning\]rating write failed|rating write failed/.test(l));

// [1] units
{
  const now = Date.parse('2026-11-22T08:00:00Z');
  const owed = new Set(['a', 'b', 'c', 'd']);
  eq('[1] ratingOwedLive: a fresh mark out, a mark past the week back in, an unmarked key in', Array.from(v.ratingOwedLive(owed, { b: now - 3600000, c: now - 8 * DAY, d: now - v.OV_GONE_MS }, now)).sort(), ['a', 'c', 'd']);
  eq('[1] ratingOwedLive: no memory = every key owed', Array.from(v.ratingOwedLive(owed, null, now)).sort(), ['a', 'b', 'c', 'd']);
  eq('[1] ratingWriteCode: 27 / 1 / an answer without a result / no answer / garbage', [v.ratingWriteCode({ json: { result: { result: 27 } } }), v.ratingWriteCode({ json: { result: { result: 1 } } }), v.ratingWriteCode({ json: { result: {} } }), v.ratingWriteCode(null), v.ratingWriteCode({ json: { result: { result: 'x' } } })], [27, 1, null, null, null]);
}

// [2] REAL main(), quiet runs
function scenario(script) {
  const out = {};
  const r1 = runCron(script, boards(), { SOLO_FILE: solo0() }, { gone: [sG] });
  out.r1 = r1;
  out.first = r1.code === 0 && JSON.stringify(sentTo(r1)) === JSON.stringify([sA, sG].sort()) && typeof ovGoneOf(r1)[P(sG)] === 'number' && !(P(sA) in ovGoneOf(r1))
    && warnsOf(r1).length === 0 && new RegExp('rating ' + P(sG).slice(0, 8) + ': result 27 \\(no longer owns the app\\)').test(r1.out);
  const r2 = runCron(script, boards(), { SOLO_FILE: r1.state.SOLO_FILE }, { gone: [sG] });
  out.r2 = r2;
  out.held = r2.code === 0 && JSON.stringify(sentTo(r2)) === JSON.stringify([sA]) && /rating: 1 row\(s\) of accounts that no longer own the app not sent/.test(r2.out) && warnsOf(r2).length === 0;
  const r3 = runCron(script, boards(), ageGone(r2.state, 8 * DAY), { gone: [sG] });
  out.r3 = r3;
  out.week = r3.code === 0 && JSON.stringify(sentTo(r3)) === JSON.stringify([sA, sG].sort()) && (Date.now() - ovGoneOf(r3)[P(sG)]) < 10 * 60000 && warnsOf(r3).length === 0;
  const r3b = runCron(script, boards(), { SOLO_FILE: r3.state.SOLO_FILE }, { gone: [sG] });
  out.r3b = r3b;
  out.marksSaved = r3b.code === 0 && JSON.stringify(sentTo(r3b)) === JSON.stringify([sA]);
  const r4 = runCron(script, boards(), ageGone(r3.state, 8 * DAY), {});
  out.r4 = r4;
  out.back = r4.code === 0 && JSON.stringify(sentTo(r4)) === JSON.stringify([sA, sG].sort()) && !(P(sG) in ovGoneOf(r4)) && warnsOf(r4).length === 0;
  const r5 = runCron(script, boards(), { SOLO_FILE: solo0() }, { code: { [sG]: 2 } });
  out.r5 = r5;
  out.other = r5.code === 0 && warnsOf(r5).length === 1 && new RegExp('rating write failed ' + P(sG).slice(0, 8) + ': HTTP 200 result 2 ').test(warnsOf(r5)[0]) && !(P(sG) in ovGoneOf(r5));
  return out;
}
const lines = (r) => r.out.split('\n').filter((l) => /rating/.test(l)).join(' | ').slice(0, 700);
const S = scenario();
T('[2] a write answered 27: the other row is written, he is marked pid-keyed with a log line and no warning', S.first, lines(S.r1) + ' ovGone=' + JSON.stringify(ovGoneOf(S.r1)));
T('[2] the next quiet run sends nothing of his (the row he is owed is held, said in a line), the other row as before', S.held, lines(S.r2));
T('[2] past 7 days he is tried once and marked again', S.week, lines(S.r3) + ' ovGone=' + JSON.stringify(ovGoneOf(S.r3)));
T('[2] the new mark is saved by the run that set it (a quiet run whose own upkeep changed nothing): the run after it holds his row again', S.marksSaved, lines(S.r3b));
T('[2] once he owns the app again his row lands and the mark goes', S.back, lines(S.r4) + ' ovGone=' + JSON.stringify(ovGoneOf(S.r4)));
T('[2] another failure warns with Steam\'s code and the answer, and marks nobody', S.other, warnsOf(S.r5).join(' | '));

// [3] mutants (each a copy of validate.js beside it, so its requires resolve)
let mutN = 0;
const MUT = [
  ['the marks not read (every row sent)', "const held = plan.writes.filter((w) => appGone(gone, pid(w.sid), nowMs) && !fresh.has(w.sid));", 'const held = [];', (s) => !s.held],
  ['a 27 not marked', "else if (code === 27) { gone[p] = nowMs; goneCh = true;", 'else if (code === 27) { goneCh = true;', (s) => !s.held || !s.first],
  ['the marks not saved by the run that set them', "            if (goneCh) saveSolo(st, nowMs);   // O976", '            if (false) saveSolo(st, nowMs);   // O976', (s) => !s.marksSaved],
  ['a landed row not clearing the mark', "if (Object.prototype.hasOwnProperty.call(gone, p)) { delete gone[p]; goneCh = true; }", '', (s) => !s.back],
  ['the code not in the warning', "': HTTP ' + r.status + (code != null ? ' result ' + code : '')", "': HTTP ' + r.status", (s) => !s.other],
];
for (const [label, from, to, red] of MUT) {
  const src = VSRC.split(from);
  if (src.length !== 2) { T('[3] mutant anchor found once: ' + label, false, 'found ' + (src.length - 1)); continue; }
  const mp = path.join(__dirname, '..', '.mutant-rating-row-gone-' + process.pid + '-' + (++mutN) + '.js');
  try { fs.writeFileSync(mp, src.join(to)); T('[3] mutant "' + label + '" turns [2] red', red(scenario(mp))); }
  finally { try { fs.unlinkSync(mp); } catch (e) {} }
}

// [4] wiring pins
{
  const lane = VSRC.slice(VSRC.indexOf('const maintainRating = async (st, touched) => {'), VSRC.indexOf('const persistStartsSide = () => {'));
  T('[4] maintainRating: the owed lookup goes through ratingOwedLive with the chain memory\'s marks; a marked row is held only without a record of his this run',
    /const fresh = new Set\(touched \|\| \[\]\), gone = st\.ovGone \|\| \(st\.ovGone = \{\}\);/.test(lane) && /const owed = ratingOwedLive\(owedAll, gone, nowMs\)/.test(lane) && /appGone\(gone, pid\(w\.sid\), nowMs\) && !fresh\.has\(w\.sid\)/.test(lane));
  T('[4] the marks share the window of the composite rows / classic repack (OV_GONE_MS, one week)', v.OV_GONE_MS === 7 * DAY);
}
console.log(failN ? ('FAILED ' + failN) : 'ALL OK');
process.exit(failN ? 1 : 0);
