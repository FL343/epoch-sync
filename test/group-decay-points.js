'use strict';
// Q160 (cloud audit 2026-10, found while working Q149; reworked after its review): the points plan reads the ranked rating.
// The reduced stakes of the points plan read a rating, and the stored one (mu / sigma) is shared with quick matches and frozen
//   by the repeat-group decay, so whoever writes the results steered the check:
//   - a group playing back to back stayed under RS_THRESHOLD however lopsided it was: two accounts (no game launched) writing
//     every seat of a ranked 2V2 nobody played, beating the same two zero-points accounts back to back, took the full team win
//     every match at grandmaster (+10 / match), the same matches spaced past the decay TTL fell to the compressed gain after three;
//   - a quick match lost between two ranked ones pulled the spread back under it (review of the first draft): grandmaster 1V1,
//     the full +20 every ranked match, back to back or spaced.
//   Now the plan reads a rating only ranked settles move, never held back: rm / rv in the player's skill entry (RANKED RATING),
//   moved at every ranked settle by the same TrueSkill update from those ranked ratings, kept as it is by a quick settle. The
//   stored rating stays decayed and moved by quick matches (matchmaking and the rating board read it). Logged `ranked-rating`
//   (ranked only, when the two disagree), counted in a summary row when the ranked rating turns a match into / out of a mismatch.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/team-loss-side.js):
//   [0] wiring pins: the ranked rating helper, the plan reads it, the settle stores it, the streak memory carries no rating, the row
//   [1] groupDecayPlan: an entry is { r, k, at } only (a stale rating carried by an older draft is dropped at its next plan)
//   [2] ranked 2V2, X / Y (grandmaster) beat two zero-points accounts, every seat writes, six matches back to back: the same
//       points match by match as the same six spaced past the TTL, the ranked-rating line and row, the stored rating still decayed
//       (lower than spaced) and the ranked one equal to spaced play's; mutant (the plan reads the stored rating) -> full stakes
//   [3] ranked 1V1 back to back, X beats a zero-points account (gold): the same points as spaced, the ranked rating equal to
//       spaced play's; ranked mode-1 2V2 (the money decides the winning team) back to back: the same points as spaced, the
//       ranked rating equal to spaced play's (the richer team rated the winner); a pair
//       already far apart on the stored rating, back to back: the ranked-rating line carries no Q160 mark and the row stays 0
//   [4] honest ranked back to back, trading wins (2V2 teams, and a 1V1 pair): no match turns into a mismatch, points as
//       with the Q160 lines off (the same group playing on is not punished when it is even)
//   [5] quick 2V2 back to back (no points): no ranked-rating line, rating writes as with the Q160 lines off, no ranked rating stored
//   [6] ranked 1V1, X (grandmaster) beats a zero-points account, a quick 1V1 between every two ranked ones where the zero-points
//       account wins (back to back, and spaced): from the fourth ranked match on X makes 0, the quick settles leave the ranked
//       rating as it was while the stored one moves; mutant (the plan reads the stored rating) -> +20 every ranked match
//   [7] gold 1V1 pair: ranked, eight quick wins for X (spaced), ranked: the stored ratings are far apart, the ranked ones are
//       not -- the last ranked match is no mismatch with the ranked rating (logged, the row's second number counts it);
//       mutant (the plan reads the stored rating) -> that win compressed
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'group-decay-points-'));
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
  const gr = files.GROUPS_FILE;   // the repeat-group memory ages with the clock too (its TTL is what spaced play crosses)
  if (gr) for (const k of Object.keys(gr)) if (gr[k] && gr[k].at) gr[k].at -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const ratingOf = (r, sid) => posts(r, 6).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
const SC = { 2: [6100, 3000], 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2) carries zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : (sc || SC[pc])[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// team convention: seats 0..1 = team A, 2..3 = team B; rank claims {1, 2} for the winning team by seat order
const teamRank = (seat, winTeam) => { const team = ((seat / 2) | 0) & 1; return (team === winTeam ? 1 : 3) + (seat % 2); };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const X = SID(1601), Y = SID(1602), Z1 = SID(1603), Z2 = SID(1604), P = SID(1605), Q = SID(1606);
const MIN = 60000, HOUR = 3600 * 1000;
// one series: match i is played by `ros` (one account per seat, every seat writes its start and result), winner from win(i)
//   (team modes: the winning team; 1V1: the winning seat); `gap` = time from the previous match's last run to the next start.
//   The points board carries every posted value into the next match (lp0: the points each account starts at).
function series(mt, ros, win, n, gap, lp0, script, files0) {
  const team = ros.length === 4, mtOf = typeof mt === 'function' ? mt : () => mt;
  const cur = {}; for (const s of ros) cur[s] = lp0[s] != null ? lp0[s] : 2500;
  const boards = (recs) => {
    const b = [];
    for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    const used = {};
    for (const r of recs) { used[r.sid] = used[r.sid] || 0; b[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
    b.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
      { id: 7, name: 'points', entries: ros.map(s => ({ steamID: s, score: cur[s] })) }, { id: 8, name: 'cp_bank', entries: [] });
    return b;
  };
  const runs = [], perMatch = [], keys = [];
  let state = null;
  for (let i = 0; i < n; i++) {
    const m = mtOf(i), h = 0xC1600 + i * 7 + (m << 12), w = win(i);
    const S = ros.map((s, seat) => ({ sid: s, d: rec(0xB2, m, h, seat, 0, false, ros) }));
    const R = ros.map((s, seat) => ({ sid: s, d: team ? rec(0xB1, m, h, seat, teamRank(seat, w), (((seat / 2) | 0) & 1) === w, ros)
      : rec(0xB1, m, h, seat, seat === w ? 1 : 2, seat === w, ros, w === 0 ? [6100, 3000] : [3000, 6100]) }));
    keys.push(keyOf(S[0].d));
    const before = Object.assign({}, cur);
    for (const [ms, recs] of [[i === 0 ? 0 : gap, S], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]]) {
      const r = runCron(boards(recs), state ? advance(state, ms) : (files0 || null), null, script);
      runs.push(r); state = r.state;
      if (r.code !== 0) return { runs, perMatch, keys, ok: false };
      for (const s of ros) { const p = pointsOf(r, s); if (p.length) cur[s] = p[p.length - 1]; }
    }
    perMatch.push(ros.map(s => cur[s] - before[s]));
  }
  const settled = keys.every(k => processedOf(runs[runs.length - 1]).has(k));
  return { runs, perMatch, keys, ok: settled, state, out: runs.map(r => r.out).join(''), cur };
}
const mutant = (tag, from, to) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-group-decay-points-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const HELD = 'const rIn = (sid, base) => { const rr = rankedNow ? rankedRatingOf(skill[pid(sid)]) : null; return rr ? Object.assign({}, base, { mu: rr.mu, sigma: rr.sigma }) : base; };';
const HELD_OFF = 'const rIn = (sid, base) => base;';
const ROW = (r) => /\| ranked matches the ranked rating turns into \/ out of a mismatch, quick matches and the repeat-group decay set aside \(Q160\) \| ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary);
const rowSum = (s, k) => s.runs.reduce((a, r) => a + (ROW(r) ? Number(ROW(r)[k || 1]) : 0), 0);
const J = (x) => JSON.stringify(x);
const skOf = (s, sid) => ((s.state || {}).SKILL_FILE || {})[v.pid(sid)] || null;
const muOf = (s, sid) => { const k = skOf(s, sid); return k ? k.mu : null; };
const rmOf = (s, sid) => { const k = skOf(s, sid); return k ? k.rm : null; };
const MARK = /  ranked-rating [^\n]*\(mismatch only with the ranked rating, Q160\)/;

console.log('=== the points plan reads the ranked rating: quick matches and the repeat-group decay set aside (Q160) ===');

// ---- [0] wiring pins ----
{
  T('[0] the ranked rating lives in the skill entry (rm / rv)', /function rankedRatingOf\(sk\) \{ return \(sk && Number\.isFinite\(sk\.rm\) && Number\.isFinite\(sk\.rv\)\) \? \{ mu: sk\.rm, sigma: sk\.rv \} : null; \}/.test(SRC));
  T('[0] the points plan reads it at a ranked settle', SRC.split(HELD).length === 2 && /const rankedNow = !!\(lpId && appliesLp\(matchType\)\);/.test(SRC)
    && /const asPlayed = tsIn\.map\(\(t\) => rIn\(t\.id, t\)\);/.test(SRC) && /mmr: ts\.displayRating\(asPlayed\[i\]\.mu, asPlayed\[i\]\.sigma\)/.test(SRC));
  T('[0] the settle stores it (moved at a ranked settle, kept at a quick one)', /if \(po\) \{ ent\.rm = po\.mu; ent\.rv = po\.sigma; \}\n\s*else if \(prevR\) \{ ent\.rm = prevR\.mu; ent\.rv = prevR\.sigma; \}\n\s*skill\[pid\(r\.id\)\] = ent;/.test(SRC));
  T('[0] the streak memory carries no rating', !/prev\.sm|ge\.sm|g\.sm/.test(SRC));
  T('[0] summary row', SRC.indexOf("'| ranked matches the ranked rating turns into / out of a mismatch, quick matches and the repeat-group decay set aside (Q160) | ' + s('heldMismatch', 0) + ' / ' + s('heldMismatchOff', 0) + ' |'") >= 0);
}

// ---- [1] groupDecayPlan: an entry is { r, k, at } only ----
{
  const T0 = 1000000000000;
  const mem = {};
  v.groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0);
  T('[1] a fresh entry is { r, k, at }', J(Object.keys(mem.a).sort()) === J(['at', 'k', 'r']), J(mem.a));
  mem.a.sm = 27.5; mem.a.ss = 6.1;   // what the first draft of this fix kept in the streak memory
  const p2 = v.groupDecayPlan(mem, ['a', 'b', 'c', 'd'], T0 + MIN);
  T('[1] the same four again (k 2): a stale rating is dropped, the plan carries the weight only', p2.a.k === 2 && J(Object.keys(mem.a).sort()) === J(['at', 'k', 'r'])
    && J(Object.keys(p2.a).sort()) === J(['k', 'w']), J([mem.a, p2.a]));
}

// ---- [2] ranked 2V2 back to back, every seat written, X / Y (grandmaster) beat two zero-points accounts ----
const GM = { [X]: 8200, [Y]: 8200, [Z1]: 0, [Z2]: 0 };
{
  const ros = [X, Y, Z1, Z2], win = () => 0;
  const tight = series(6, ros, win, 6, MIN, GM), spaced = series(6, ros, win, 6, 3 * HOUR, GM);
  T('[2] both series settle every match', tight.ok && spaced.ok, (tight.out || '').slice(-600));
  T('[2] back to back: the same points match by match as spaced past the TTL', J(tight.perMatch) === J(spaced.perMatch), 'tight ' + J(tight.perMatch) + ' spaced ' + J(spaced.perMatch));
  T('[2] the ranked rating turns the mismatch: ranked-rating line, the row counts it', MARK.test(tight.out) && rowSum(tight) >= 1
    && !/  ranked-rating /.test(spaced.out) && rowSum(spaced) === 0, 'row ' + rowSum(tight) + '/' + rowSum(spaced));
  T('[2] the stored rating stays decayed (X back to back below X spaced)', muOf(tight, X) != null && muOf(spaced, X) != null && muOf(tight, X) < muOf(spaced, X) - 0.5,
    muOf(tight, X) + ' / ' + muOf(spaced, X));
  T('[2] the ranked rating is the one spaced play has (X above his stored rating, Z1 below)', rmOf(tight, X) > muOf(tight, X) + 0.5 && rmOf(tight, Z1) < muOf(tight, Z1) - 0.5
    && Math.abs(rmOf(tight, X) - muOf(spaced, X)) < 1e-9 && Math.abs(rmOf(tight, Z1) - muOf(spaced, Z1)) < 1e-9 && rmOf(spaced, X) === muOf(spaced, X),
    J([skOf(tight, X), skOf(tight, Z1), muOf(spaced, X), muOf(spaced, Z1)]));
  withMutant('bare', HELD, HELD_OFF, (script) => {
    const m = series(6, ros, win, 6, MIN, GM, script);
    const x = m.perMatch.map(p => p[0]);
    T('[2] mutant (the plan reads the stored rating): the full team win every match back to back', m.ok && x.length === 6 && x.every(d => d === x[0]) && J(m.perMatch) !== J(spaced.perMatch),
      J(m.perMatch));
  });
}

// ---- [3] ranked 1V1 back to back, X (gold) beats a zero-points account ----
{
  const ros = [X, Z1], win = () => 0, lp0 = { [X]: 2500, [Z1]: 0 };
  const tight = series(2, ros, win, 6, MIN, lp0), spaced = series(2, ros, win, 6, 3 * HOUR, lp0);
  T('[3] 1V1 back to back: the same points as spaced', tight.ok && spaced.ok && J(tight.perMatch) === J(spaced.perMatch), 'tight ' + J(tight.perMatch) + ' spaced ' + J(spaced.perMatch));
  T('[3] 1V1: the ranked rating is the one spaced play has', Math.abs(rmOf(tight, X) - muOf(spaced, X)) < 1e-9 && Math.abs(rmOf(tight, Z1) - muOf(spaced, Z1)) < 1e-9
    && Math.abs(skOf(tight, X).rv - skOf(spaced, X).sigma) < 1e-9, J([skOf(tight, X), skOf(tight, Z1), skOf(spaced, X), skOf(spaced, Z1)]));
}
{
  const ros = [X, Y, Z1, Z2], win = () => 0;
  const tight = series(4, ros, win, 6, MIN, GM), spaced = series(4, ros, win, 6, 3 * HOUR, GM);
  T('[3] ranked mode-1 2V2 (money decides the winning team) back to back: the same points as spaced', tight.ok && spaced.ok && J(tight.perMatch) === J(spaced.perMatch)
    && rowSum(tight) >= 1, 'tight ' + J(tight.perMatch) + ' spaced ' + J(spaced.perMatch) + ' row ' + rowSum(tight));
  T('[3] mode-1 2V2: the ranked rating is the one spaced play has (the richer team rated the winner)', Math.abs(rmOf(tight, X) - muOf(spaced, X)) < 1e-9
    && Math.abs(rmOf(tight, Z1) - muOf(spaced, Z1)) < 1e-9 && rmOf(tight, X) > 25 && rmOf(tight, Z1) < 25, J([skOf(tight, X), skOf(tight, Z1), skOf(spaced, X), skOf(spaced, Z1)]));
}
{
  const ros = [X, Z1], win = () => 0, lp0 = { [X]: 2500, [Z1]: 2500 };
  const files0 = { SKILL_FILE: { [v.pid(X)]: { mu: 35, sigma: 3 }, [v.pid(Z1)]: { mu: 15, sigma: 3 } } };   // display 2040 / 1240: a mismatch already
  const s = series(2, ros, win, 4, MIN, lp0, null, files0);
  T('[3] already far apart on the stored rating: ranked-rating line without the Q160 mark, the row stays 0', s.ok && /  ranked-rating /.test(s.out)
    && !/mismatch only with the ranked rating/.test(s.out) && rowSum(s) === 0 && rowSum(s, 2) === 0, 'row ' + rowSum(s) + ' ' + ((s.out || '').match(/  ranked-rating [^\n]*/g) || []).join(' | '));
}

// ---- [4] honest ranked 2V2 back to back, the teams trade wins ----
{
  const ros = [P, Q, Z1, Z2], win = (i) => i % 2, lp0 = { [P]: 2500, [Q]: 2500, [Z1]: 2500, [Z2]: 2500 };
  const s = series(6, ros, win, 6, MIN, lp0);
  T('[4] even group back to back: no match turns into a mismatch', s.ok && rowSum(s) === 0 && !/mismatch only with the ranked rating/.test(s.out), 'row ' + rowSum(s));
  withMutant('off', HELD, HELD_OFF, (script) => {
    const m = series(6, ros, win, 6, MIN, lp0, script);
    T('[4] points as with the Q160 lines off', m.ok && J(m.perMatch) === J(s.perMatch), J(s.perMatch) + ' / ' + J(m.perMatch));
  });
}
{
  const ros = [P, Q], win = (i) => i % 2, lp0 = { [P]: 2500, [Q]: 2500 };
  const s = series(2, ros, win, 12, MIN, lp0);
  T('[4] 1V1 pair trading wins, twelve back to back: no match turns into a mismatch', s.ok && rowSum(s) === 0 && !/mismatch only with the ranked rating/.test(s.out), 'row ' + rowSum(s));
  withMutant('off1', HELD, HELD_OFF, (script) => {
    const m = series(2, ros, win, 12, MIN, lp0, script);
    T('[4] 1V1: points as with the Q160 lines off', m.ok && J(m.perMatch) === J(s.perMatch), J(s.perMatch) + ' / ' + J(m.perMatch));
  });
}

// ---- [5] quick 2V2 back to back (no points) ----
{
  const ros = [X, Y, Z1, Z2], win = () => 0;
  const s = series(5, ros, win, 6, MIN, GM);
  const rate = (x) => J(x.runs.map(r => [X, Y, Z1, Z2].map(sid => ratingOf(r, sid))));
  T('[5] quick: no ranked-rating line, no row, no ranked rating stored', s.ok && !/  ranked-rating /.test(s.out) && rowSum(s) === 0 && rowSum(s, 2) === 0
    && ros.every(sid => skOf(s, sid) && !('rm' in skOf(s, sid)) && !('rv' in skOf(s, sid))), J(ros.map(sid => skOf(s, sid))));
  withMutant('quick', HELD, HELD_OFF, (script) => {
    const m = series(5, ros, win, 6, MIN, GM, script);
    T('[5] rating writes as with the Q160 lines off', m.ok && rate(m) === rate(s));
  });
}

// ---- [6] a quick match lost between two ranked ones (review of the first draft) ----
{
  const ros = [X, Z1], lp0 = { [X]: 8200, [Z1]: 0 };
  const mt = (i) => (i % 2 ? 1 : 2), win = (i) => (i % 2 ? 1 : 0);   // even: ranked 1V1 X wins; odd: quick 1V1 Z1 wins
  const tight = series(mt, ros, win, 12, MIN, lp0), spaced = series(mt, ros, win, 12, 3 * HOUR, lp0);
  const xr = (s) => s.perMatch.filter((p, i) => i % 2 === 0).map(p => p[0]);
  T('[6] both series settle every match', tight.ok && spaced.ok, (tight.out || '').slice(-600));
  T('[6] from the fourth ranked match on X makes 0, back to back and spaced', xr(tight).length === 6 && xr(tight).slice(3).every(d => d === 0)
    && xr(spaced).slice(3).every(d => d === 0) && xr(tight)[0] === 20, 'tight ' + J(xr(tight)) + ' spaced ' + J(xr(spaced)));
  T('[6] the quick matches move no points', tight.perMatch.filter((p, i) => i % 2 === 1).every(p => p[0] === 0 && p[1] === 0), J(tight.perMatch));
  {   // the last match is quick: its settle left the ranked rating as it was and moved the stored one
    const sk = skOf(spaced, X), z = skOf(spaced, Z1);
    T('[6] the quick settle keeps the ranked rating, the stored one moves (X stored below his ranked, Z1 above)', sk && z && sk.rm > sk.mu + 0.5 && z.rm < z.mu - 0.5, J([sk, z]));
  }
  withMutant('quick6', HELD, HELD_OFF, (script) => {
    const m = series(mt, ros, win, 12, 3 * HOUR, lp0, script);
    T('[6] mutant (the plan reads the stored rating): +20 every ranked match', m.ok && xr(m).every(d => d === 20), J(xr(m)));
  });
}

// ---- [7] quick matches drive the stored ratings apart, the ranked ones stay close: no mismatch with the ranked rating ----
{
  const ros = [X, Z1], lp0 = { [X]: 2500, [Z1]: 2500 };
  const mt = (i) => ((i === 0 || i === 9) ? 2 : 1), win = () => 0;   // ranked, eight quick X wins, ranked; spaced past the TTL
  const s = series(mt, ros, win, 10, 3 * HOUR, lp0);
  const OFF = /  ranked-rating [^\n]*\(no mismatch with the ranked rating, Q160\)/;
  T('[7] settles every match', s.ok, (s.out || '').slice(-600));
  T('[7] the last ranked match: no mismatch with the ranked rating, the row counts it out', OFF.test(s.out) && rowSum(s, 2) === 1 && rowSum(s) === 0,
    'row ' + rowSum(s) + ' / ' + rowSum(s, 2) + ' ' + ((s.out || '').match(/  ranked-rating [^\n]*/g) || []).join(' | '));
  withMutant('off7', HELD, HELD_OFF, (script) => {
    const m = series(mt, ros, win, 10, 3 * HOUR, lp0, script);
    T('[7] mutant (the plan reads the stored rating): the last ranked win compressed', m.ok && m.perMatch[9][0] < s.perMatch[9][0], J([s.perMatch[9], m.perMatch[9]]));
  });
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (group-decay-points) ===' : '=== PASS -- 0 fail (group-decay-points) ===');
process.exit(failN ? 1 : 0);
