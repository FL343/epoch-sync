'use strict';
// A whole team absent from an ordinary team match (Q62, cloud audit 2026-10; found while doing Q56). Every member of one
// team left mid-match and none of them wrote a settle record; the other team's records agree and settle the match (the
// absent members are convicted as leavers as before). The hidden rating (TrueSkill) used to fall back to the ORDINAL
// update among the present players (`ts.updateMatch`): the two (or three) members of the present team were rated as if
// they had played against each other -- rank 1 up, rank 2 down -- so one of the winners LOST rating. Now the present team
// is rated as a team against the absent team's PRE-match ratings (Q56 did this for the team-gamble dissent settle only):
// both / all three move the same way, in the direction of the team outcome the team LP plan already uses, and the absent
// ratings never move. Hidden rating only; points, XP and the leaver penalty are unchanged.
//   [1] ranked team brawl (mode 1), the losing-on-money team gone: both winners gain the same rating; LP both won
//   [2] ranked team brawl, the absent team was ahead on money: both present players lose the same rating (LP: both lost)
//   [3] ranked 2v2 (mode 2), the other team gone: both winners gain the same rating
//   [4] ranked 3v3, the other team gone: all three winners gain the same rating
//   [5] quick team brawl (rating only, no points): both winners gain
//   [6] one absent member only (not a whole team): the normal team update, no whole-team line
//   [7] absent stored ratings and the rating board never move (with Q167 merged their ranked rating takes the loss of the
//       full team); the absent members are still convicted as leavers once
//   [8] wiring pin + mutation self-check (the old dissent-only condition back -> [2] goes red; with Q167 in, [1] is no
//       witness: the absent team lost, so Q167's losing-side leaver stand-in rates the winners against it anyway)
// Runs the REAL validate.js main() against an offline board stub (test/team2-team-dissent.js harness).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
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
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
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

function runCron(boards, files, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-absent-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0', PT_MODE: '', APPLY_MMR: '',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned: ranked points go to 'points' (season boards start later)
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg) for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  return files;
}
// a group missing seats waits out the absent-seat grace (R1-B2-04) when that hold is in: follow up with the next run
function runSettle(boards, files, script) {
  const r = runCron(boards, files, script);
  return (/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS) ? runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000), script) : r;
}

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
// team settle record. roster: sids by seat (team 0 = seats < ts); win: winning team; ranks by the winning-block
//   convention (mode 2 derives its winner from these claims; mode 1 from the money vector)
function rec(mt, hash, seat, roster, scores, win) {
  const pc = roster.length, ts = pc / 2;
  const myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = (myTeam === win) ? 1 + inBlock : ts + 1 + inBlock;
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (myTeam === win ? 1 : 0), pc, 900].concat(scores, [0]);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (mt, hash) => hash + '_4321_' + mt;
function boardsWith(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  rows.forEach((r, i) => boards[i].entries.push({ steamID: r.sid, score: 1, details: r.d }));
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: [A, B, C, D, E, F].map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// the attested start, sighted 90 min ago (past the start floor and any "the match must be over" wait; pid roster, as
//   reconcileStarts registers it); every seated player wrote his own start record at level 1 (`started`: read by the Q69
//   cron patch, which convicts a leave only on the player's own record)
function startOf(mt, hash, roster) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  const st = {}; st[keyOf(mt, hash)] = { t0: Date.now() - 90 * 60000, mt, roster: ros, settled: [], started: roster.map((s) => v.pid(s)) };
  return { STARTS_FILE: st };
}
// one match: `present` seats write, the others never do
function play(mt, hash, roster, scores, win, present, script) {
  const rows = present.map((seat) => ({ sid: roster[seat], d: rec(mt, hash, seat, roster, scores, win) }));
  return runSettle(boardsWith(rows), startOf(mt, hash, roster), script);
}
const skillOf = (r, sid) => ((r.state.SKILL_FILE || {})[v.pid(sid)]) || null;
const MU0 = require(path.join(__dirname, '..', 'trueskill.js')).DEFAULTS.mu;
const dMu = (r, sid) => { const s = skillOf(r, sid); return s ? s.mu - MU0 : null; };
const lpTo = (r, sid) => { const p = r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + POINTS + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body)); return p.length ? Number(/score=(-?[0-9]+)/.exec(p[p.length - 1].body)[1]) : null; };
const same = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;
const R4 = [A, B, C, D], R6 = [A, B, C, D, E, F];
const fmt = (r, sids) => sids.map((s) => (dMu(r, s) == null ? 'none' : dMu(r, s).toFixed(3))).join(' / ');

// ---- [1] ranked team brawl, the other team gone ----
console.log('-- [1] ranked team brawl (mode 1), the losing-on-money team gone --');
{
  const r = play(4, 0x6201, R4, [6000, 5000, 1000, 800], 0, [0, 1]);
  T('[1] settled, the whole-team line logged', r.code === 0 && new Set(r.state.PROCESSED_FILE || []).has(keyOf(4, 0x6201)) && /team rating [^\n]*whole team 1 absent -> rated against its 2 pre-match rating/.test(r.out), r.out.slice(-500));
  T('[1] both present winners gain, by the same amount', dMu(r, A) > 0 && dMu(r, B) > 0 && same(dMu(r, A), dMu(r, B)), fmt(r, [A, B]));
  T('[1] points: both counted as a win (team LP plan, unchanged)', lpTo(r, A) > 2000 && lpTo(r, B) > 2000, lpTo(r, A) + ' / ' + lpTo(r, B));
}

// ---- [2] the absent team was ahead on money ----
console.log('-- [2] ranked team brawl, the absent team ahead on money --');
{
  const r = play(4, 0x6202, R4, [1000, 800, 6000, 5000], 1, [0, 1]);
  T('[2] both present players lose, by the same amount, matching their points loss', dMu(r, A) < 0 && dMu(r, B) < 0 && same(dMu(r, A), dMu(r, B)) && lpTo(r, A) < 2000 && lpTo(r, B) < 2000,
    fmt(r, [A, B]) + ' lp ' + lpTo(r, A) + ' / ' + lpTo(r, B));
}

// ---- [3] ranked 2v2 (mode 2) ----
console.log('-- [3] ranked 2v2 (mode 2), the other team gone --');
{
  const r = play(6, 0x6203, R4, [5000, 4000, 4500, 4200], 0, [0, 1]);
  T('[3] both winners gain, by the same amount', dMu(r, A) > 0 && dMu(r, B) > 0 && same(dMu(r, A), dMu(r, B)), fmt(r, [A, B]) + ' ' + r.out.slice(-300));
}

// ---- [4] ranked 3v3 ----
console.log('-- [4] ranked 3v3, the other team gone --');
{
  const r = play(9, 0x6204, R6, [5000, 4000, 3000, 4500, 4200, 4100], 0, [0, 1, 2]);
  T('[4] all three winners gain, by the same amount', [A, B, C].every((s) => dMu(r, s) > 0) && same(dMu(r, A), dMu(r, B)) && same(dMu(r, B), dMu(r, C)), fmt(r, [A, B, C]) + ' ' + r.out.slice(-300));
  T('[4] logged against three pre-match ratings', /whole team 1 absent -> rated against its 3 pre-match rating/.test(r.out));
}

// ---- [5] quick team brawl ----
console.log('-- [5] quick team brawl (rating only) --');
{
  const r = play(3, 0x6205, R4, [6000, 5000, 1000, 800], 0, [0, 1]);
  T('[5] both winners gain, by the same amount; no points written', dMu(r, A) > 0 && dMu(r, B) > 0 && same(dMu(r, A), dMu(r, B)) && lpTo(r, A) == null, fmt(r, [A, B]));
}

// ---- [6] one absent member only ----
console.log('-- [6] one member absent (not a whole team) --');
{
  const r = play(4, 0x6206, R4, [6000, 5000, 1000, 800], 0, [0, 1, 2]);
  T('[6] the normal team update (2 vs 1 present), no whole-team line', r.code === 0 && !/whole team \d absent/.test(r.out) && dMu(r, A) > 0 && dMu(r, B) > 0 && dMu(r, C) < 0, fmt(r, [A, B, C]));
}

// ---- [7] absent players ----
console.log('-- [7] the absent team --');
{
  const r = play(4, 0x6207, R4, [6000, 5000, 1000, 800], 0, [0, 1]);
  // Q167 (cloud audit; its rework): the absent losers' ranked rating takes the loss of the full team (a lower ranked rating
  //   only feeds the mismatch reading of the points plan), so a skill row is written for them next to the untouched
  //   pre-match stored rating. Without Q167 no row is written at all.
  const SIG0 = require(path.join(__dirname, '..', 'trueskill.js')).DEFAULTS.sigma;
  const HAS_Q167 = /ghostRanked\.push\(o\)/.test(fs.readFileSync(VALIDATE, 'utf8'));
  const still = (sid) => { const s = skillOf(r, sid); return s === null || (s.mu === MU0 && s.sigma === SIG0); };
  const onBoard = (sid) => r.posts.some(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + RATING + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
  T('[7] absent stored ratings never move, nothing on the rating board for them', still(C) && still(D) && !onBoard(C) && !onBoard(D),
    JSON.stringify([skillOf(r, C), skillOf(r, D)]));
  T('[7] ' + (HAS_Q167 ? 'their ranked rating takes the loss of the full team (Q167)' : 'no skill row written for them (no Q167)'),
    HAS_Q167 ? [C, D].every((sid) => { const s = skillOf(r, sid); return s && Number.isFinite(s.rm) && s.rm < MU0 && Number.isFinite(s.rv); })
      : skillOf(r, C) === null && skillOf(r, D) === null, JSON.stringify([skillOf(r, C), skillOf(r, D)]));
  const lv = (sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
  T('[7] the absent members are still convicted as leavers, once each', lv(C) === 1 && lv(D) === 1 && lv(A) === 0 && lv(B) === 0);
}

// ---- [8] wiring pin + mutation ----
console.log('-- [8] wiring + mutation --');
{
  T('[8] the whole-team rating applies to every team match with an empty side (no dissent-only condition)', /const ghost = \(empty >= 0\)\s*\n\s*\? leavers0\.filter\(x => teamOfSeat\(x\.seat, _mts\) === empty\)/.test(SRC));
  const from = 'const ghost = (empty >= 0)', to = 'const ghost = (empty >= 0 && Array.isArray(c.t2ex))';
  if (SRC.split(from).length !== 2) bad('[8] anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-team-absent-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      // [2]'s match (the absent team won): no losing-side leaver for Q167 to stand in, so the mutant falls back to the
      //   ordinal update between the two present losers (rank 3 over rank 4)
      const r = play(4, 0x6281, R4, [1000, 800, 6000, 5000], 1, [0, 1], script);
      T('[8] the old dissent-only condition back -> rating moves between the present players again (red)', dMu(r, A) > 0 && dMu(r, B) < 0, fmt(r, [A, B]));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (team-absent-rating)') : 'ALL OK (team-absent-rating)');
process.exit(failN ? 1 : 0);
