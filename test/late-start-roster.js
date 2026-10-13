'use strict';
// Q118 + Q114 (cloud audit 2026-10): two holes left around a registered start roster.
// Q118: every player learns the match key at START_GAME, minutes before level 1 (where the honest starts are written). A
//   modded player had his alts write starts from the honest players' seats in that gap, naming the alts; a job run that
//   looked once in between registered the alts' roster (first-seen, sticky), the seat gate dropped every honest record
//   and the colluders settled the win (REVIEW-2 A6 2V2 / A8 1V1). The fix: a registered roster stays provisional until
//   START_CONFIRM_MS after the job registered it and a complete read; a start read in that time that names another
//   roster splits the key (no seat gate: the Q75 roster contest holds it), as if the job had seen both on its first look.
// Q114: a settled key is history, but its records stay on the shards; one record written after the settle that does not
//   match the settled group (the key is public) turned the group inconsistent and flagged every player of the match once
//   (review-q80.js T9; again after each SIG_PAIR_WINDOW_MS prune). The fix: nobody is flagged on a settled key.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (the harness of test/seat-gate.js,
//   plus per-board read failures from test/endless-borrowed-key.js), plus the pure helpers.
//   [1] units: START_CONFIRM_MS (default, floor), startSig (what startRosterDisagrees compares), lateStartSplit,
//       registerStartRosters (prov on an unsplit roster only; a later start naming another roster splits, counted once;
//       confirmation after START_CONFIRM_MS on a complete read only, after this run's starts were compared; an entry
//       without prov -- older build -- is final; processed keys untouched; endless keys too)
//   [2] REVIEW-2 A6 (2V2): two alts start at the winners' seats before level 1, the job looks once, the colluding losers
//       name the alts too: the honest starts a minute later split the key, the Q75 contest holds it, nobody rated, the
//       winners are no leavers, nobody flagged (Q114 review: an outside start alone splits a key in the provisional time,
//       so the contest flags nobody); mutant (no later-start check -> the losers take the win)
//       [2b] the honest starts sit on shards unread until past START_CONFIRM_MS: never confirmed on a partial read, split
//       when read; mutant (confirmed on a partial read -> the losers take the win)
//       [2c] the job's next run comes only after START_CONFIRM_MS (a delayed cron): this run's starts are compared before
//       the roster is confirmed; mutant (confirmed first -> the losers take the win)
//   [3] REVIEW-2 A8 (1V1): the loser and one alt start before level 1: split, held; mutant (the loser takes the win)
//   [4] honest controls: a cold-reconnect copy of a start inside the window (no split, confirmed, settles); the first
//       look reads half the starts (no split, settles); an outside account copying the players' roster from a played
//       seat inside the window (no split: dropped by the gate, not flagged since Q124); the summary rows
//   [5] Q114: review-q80.js T9 -- an outside result on a settled 2V2: nobody flagged, also after the flag-memory prune;
//       control: an inconsistent group on an unsettled key still flags its writers; mutant (settled keys flagged again)
//   [6] wiring pins
//   [7] Q127 / Q130: the window is four minutes after registration (five with Q127, four since Q130) -- a losing
//       player's alt writing a start late in the match is dropped by the gate and the real result settles (REVIEW-2 of
//       Q114 + Q118, D1); mutant (ten minutes again -> the loss is undone); D1e (pinned residual): read by the run that
//       would confirm, the start still splits the key, voided, nobody flagged
//   [8] Q124 first step (REVIEW-2 of Q113, D1): the player who picks a 1V1's key and his alt register a roster of their own
//       twenty minutes ahead; the opponent's honest start and result are dropped by the gate and he is flagged by nobody;
//       pinned residual (the rest of Q124): the pair's own result settles; mutant (the seat gate flags again -> he is flagged)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'late-start-roster-'));
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
//   instant moves back instead: start sightings, absent-seat stamps, the writers' busy marks, the flag memory)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;   // .at stays: the players keep playing
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat; sc: the seat scores the record claims (default by seat)
const SC = { 2: [7000, 4000], 4: [6100, 5200, 4800, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (sc || SC[pc])[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 2V2 ranked (mt 6): the {0,1} v {2,3} convention, ranks by score inside each team; `winTeam` 0 = seats 0/1 won
const t2rank = (seat, winTeam) => { const team = (seat >> 1) & 1, inTeam = seat & 1; return (team === winTeam ? 1 : 3) + inTeam; };
const t2settle = (hash, seat, ros, winTeam) => rec(0xB1, 6, hash, seat, t2rank(seat, winTeam || 0), ((seat >> 1) & 1) === (winTeam || 0), ros,
  winTeam ? [3900, 4800, 6100, 5200] : null);
const t2start = (hash, seat, ros) => rec(0xB2, 6, hash, seat, 0, false, ros);
// 1V1 ranked (mt 2, two seats): `winner` = the seat the record says won
const v1settle = (hash, seat, ros, winner) => rec(0xB1, 2, hash, seat, seat === winner ? 1 : 2, seat === winner, ros, winner ? [4000, 7000] : [7000, 4000]);
const v1start = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const P1 = SID(141), P2 = SID(142), P3 = SID(143), P4 = SID(144), X1 = SID(145);
const Q = Array.from({ length: 8 }, (_, i) => SID(151 + i));   // alts and outside accounts
const ALL = [P1, P2, P3, P4, X1].concat(Q);
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
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000, DAY = 86400000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const ptsIn = (rs, sid) => [].concat(...rs.map(r => pointsOf(r, sid)));
const up = (rs, sid) => { const p = ptsIn(rs, sid); return p.length === 1 && p[0] > 2500; };
const none = (rs, sid) => ptsIn(rs, sid).length === 0;
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
const Q75 = /roster contest, not settled \(Q75\)/;
const Q80LINE = /record\(s\) from accounts the start roster does not seat there -- not counted \(Q80\)/;
const LATE = /start-split [^\n]*names another roster[^\n]*\(Q118\)/;
const sumN = (rs, re) => rs.reduce((n, r) => { const m = re.exec(r.summary); return n + (m ? Number(m[1]) : 0); }, 0);
const lateSplitN = (rs) => sumN(rs, /\| start rosters split by a later start \/ confirmed \(Q118\) \| ([0-9]+) \//);
const confirmedN = (rs) => sumN(rs, /\| start rosters split by a later start \/ confirmed \(Q118\) \| [0-9]+ \/ ([0-9]+) \|/);
const lateMismatchN = (rs) => sumN(rs, /\| settled keys with records that disagree, nobody flagged \(Q114\) \| ([0-9]+) \|/);
const offSeatN = (rs) => sumN(rs, /\| records off their start-roster seat, not counted [^|]*\| ([0-9]+) \//);
const W = v.START_CONFIRM_MS;
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-late-start-roster-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};
const LATE_FROM = '  if (!p || !p.prov || p.split) return false;';

console.log('=== a start roster stays provisional for a while; a settled key flags nobody (Q118 / Q114) ===');

// ---- [1] units ----
{
  const once = (env) => spawnSync(process.execPath, ['-e', "process.stdout.write(String(require(process.argv[1]).START_CONFIRM_MS))", VALIDATE],
    { env: Object.assign({}, process.env, env), encoding: 'utf8' }).stdout;
  T('[1] START_CONFIRM_MS: four minutes by default (Q130; five since Q127 before), three at least', W === 240000 && v.START_CONFIRM_MIN_MS === 180000 && once({ START_CONFIRM_MS: '1000' }) === '180000'
    && once({ START_CONFIRM_MS: '900000' }) === '900000', W + ' ' + once({ START_CONFIRM_MS: '1000' }));
  const S = (sid, seat, ros, o) => { o = o || {}; return { steamID: sid, shard: 'shard_1', d: [0xB2, 3, o.mt || 6, o.h || 77, 1, seat, 0, 0, o.pc == null ? 4 : o.pc], roster: Object.assign({}, ros) }; };
  const RO = { 0: P1, 1: P2, 2: P3, 3: P4 }, FO = { 0: Q[0], 1: Q[1], 2: P3, 3: P4 };
  T('[1] startSig: the writer\'s seat does not count', v.startSig(S(P1, 0, RO)) === v.startSig(S(P3, 2, RO)) && /^[0-9a-f]{12}$/.test(v.startSig(S(P1, 0, RO))));
  T('[1] startSig: another account at one seat, another seat count -> another signature', v.startSig(S(P1, 0, RO)) !== v.startSig(S(P1, 0, FO))
    && v.startSig(S(P1, 0, RO)) !== v.startSig(S(P1, 0, RO, { pc: 5 })));
  T('[1] startSig splits exactly where startRosterDisagrees does', [[S(P1, 0, RO), S(P2, 1, RO)], [S(P1, 0, RO), S(Q[0], 0, FO)], [S(P1, 0, RO), S(P2, 1, RO, { pc: 5 })]]
    .every(([a, b]) => v.startRosterDisagrees([a, b]) === (v.startSig(a) !== v.startSig(b))));
  // lateStartSplit
  const p0 = { t0: 1, roster: {}, settled: [] };
  T('[1] lateStartSplit: an entry without prov (older build, or confirmed) is final', v.lateStartSplit(p0, [S(Q[0], 0, FO)], 'k') === false && !p0.split);
  const p1 = { t0: 1, roster: {}, settled: [], split: 1, prov: 'x' };
  T('[1] lateStartSplit: a split entry stays as it is', v.lateStartSplit(p1, [S(Q[0], 0, FO)], 'k') === false && p1.prov === 'x');
  const p2 = { t0: 1, roster: {}, settled: [], prov: v.startSig(S(P1, 0, RO)) };
  T('[1] lateStartSplit: starts naming the same roster (any seat, a copy) change nothing', v.lateStartSplit(p2, [S(P1, 0, RO), S(P1, 0, RO), S(Q[3], 3, RO)], 'k') === false && !p2.split && p2.prov);
  T('[1] lateStartSplit: one start naming another roster splits it, prov dropped', v.lateStartSplit(p2, [S(P2, 1, RO), S(Q[0], 0, FO)], 'k') === true && p2.split === 1 && !('prov' in p2));
  // registerStartRosters: prov, late split, confirmation
  let pend = {};
  const honest = [0, 1, 2, 3].map(s => S([P1, P2, P3, P4][s], s, RO));
  v.registerStartRosters(honest, new Set(), pend, 1000);
  T('[1] an unsplit roster registers provisional (its signature)', pend['77_1_6'] && pend['77_1_6'].prov === v.startSig(honest[0]) && !pend['77_1_6'].split, JSON.stringify(pend));
  const split0 = {};
  v.registerStartRosters(honest.concat([S(Q[0], 4, RO, { pc: 5 })]), new Set(), split0, 1000);
  T('[1] a roster registered split carries no prov', split0['77_1_6'] && split0['77_1_6'].split === 1 && !('prov' in split0['77_1_6']));
  v.registerStartRosters(honest, new Set(), pend, 1000 + W - 1);
  T('[1] before START_CONFIRM_MS: still provisional', !!pend['77_1_6'].prov);
  v.registerStartRosters(honest, new Set(), pend, 1000 + W, false);
  T('[1] at START_CONFIRM_MS on a partial read: still provisional', !!pend['77_1_6'].prov);
  v.registerStartRosters([], new Set(), pend, 1000 + W);
  T('[1] at START_CONFIRM_MS on a complete read: final (no starts of the key read this run is enough)', pend['77_1_6'] && !('prov' in pend['77_1_6']) && !pend['77_1_6'].split);
  v.registerStartRosters(honest.concat([S(Q[0], 0, FO)]), new Set(), pend, 1000 + W + 1);
  T('[1] a confirmed roster: a start naming another roster later splits nothing (the gate drops it)', !pend['77_1_6'].split);
  pend = {};
  v.registerStartRosters(honest, new Set(), pend, 1000);
  v.registerStartRosters(honest.concat([S(Q[0], 0, FO)]), new Set(), pend, 1000 + W + 5 * 60000);
  T('[1] a start naming another roster read in the run that would confirm: compared first -> split', pend['77_1_6'].split === 1 && !('prov' in pend['77_1_6']));
  pend = {};
  v.registerStartRosters(honest, new Set(), pend, 1000);
  v.registerStartRosters([S(Q[0], 0, FO)], new Set(['77_1_6']), pend, 2000);
  T('[1] a processed key: untouched', !pend['77_1_6'].split && pend['77_1_6'].prov);
  pend = { '77_1_6': { t0: 1000, mt: 6, roster: { 0: v.pid(P1), 1: v.pid(P2), 2: v.pid(P3), 3: v.pid(P4) }, settled: [] } };
  v.registerStartRosters([S(Q[0], 0, FO)], new Set(), pend, 2000);
  T('[1] an entry from an older build (no prov) counts as confirmed', !pend['77_1_6'].split);
  // endless (co-op, mt 7): the same
  const EO = { 0: P1, 1: P2 }, EF = { 0: P1, 1: Q[0] };
  pend = {};
  v.registerStartRosters([S(P1, 0, EO, { mt: 7, pc: 2 }), S(P2, 1, EO, { mt: 7, pc: 2 })], new Set(), pend, 1000);
  T('[1] endless: an unsplit roster registers provisional', pend['77_1_7'] && pend['77_1_7'].prov && !pend['77_1_7'].split, JSON.stringify(pend));
  v.registerStartRosters([S(Q[0], 1, EF, { mt: 7, pc: 2 })], new Set(), pend, 1000 + 60000);
  T('[1] endless: a co-op start naming another roster inside the window splits it', pend['77_1_7'].split === 1 && !('prov' in pend['77_1_7']));
}

// ---- [2] REVIEW-2 A6: two alts start at the winners' seats before level 1 ----
// P1 / P2 (seats 0 / 1) beat P3 / P4. Q0 / Q1 are P3 / P4's alts: they start at seats 0 / 1 right after START_GAME naming
//   F = [Q0, Q1, P3, P4]; the job looks once before level 1 (only the alts' two starts, agreeing). At level 1 P1 / P2
//   start naming R, P3 / P4 naming F. At the end P1 / P2 write the real result; P3 / P4 and the alts write F won.
const RR = [P1, P2, P3, P4], FF = [Q[0], Q[1], P3, P4];
const a6 = (h) => {
  const SA = [{ sid: Q[0], d: t2start(h, 0, FF) }, { sid: Q[1], d: t2start(h, 1, FF) }];
  const SR = [{ sid: P1, d: t2start(h, 0, RR) }, { sid: P2, d: t2start(h, 1, RR) }, { sid: P3, d: t2start(h, 2, FF) }, { sid: P4, d: t2start(h, 3, FF) }];
  const RS = [{ sid: P1, d: t2settle(h, 0, RR, 0) }, { sid: P2, d: t2settle(h, 1, RR, 0) }];
  const RF = [0, 1, 2, 3].map(s => ({ sid: FF[s], d: t2settle(h, s, FF, 1) }));
  return { SA, SR, RS, RF, key: keyOf(SA[0].d) };
};
const heldChecks = (tag, rs, key, n) => {
  T(tag + ' ' + n + ' runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T(tag + ' no seat gate (nothing dropped); the Q75 contest holds the key until the start entry matures, nobody rated', !Q80LINE.test(outOf(rs)) && Q75.test(outOf(rs))
    && !processedOf(rs[rs.length - 2]).has(key) && RR.concat(Q.slice(0, 2)).every(s => none(rs, s)), JSON.stringify(RR.concat(Q.slice(0, 2)).map(s => ptsIn(rs, s))));
  T(tag + ' the winners are no leavers at maturity', leavesOf(last(rs), P1) === 0 && leavesOf(last(rs), P2) === 0, JSON.stringify(RR.map(s => leavesOf(last(rs), s))));
};
const stole = (m) => up(m, P3) && up(m, P4) && none(m, P1) && none(m, P2);
{
  const h = 0x9001, { SA, SR, RS, RF, key } = a6(h);
  const S = SA.concat(SR), F = S.concat(RS, RF);
  const steps = [[0, SA], [1 * MIN, S], [12 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]];
  const rs = timeline(steps);
  T('[2] A6: the first look registers the alts\' roster, provisional', pendOf(rs[0], key) && pendOf(rs[0], key).roster[0] === v.pid(Q[0]) && pendOf(rs[0], key).prov && !pendOf(rs[0], key).split,
    JSON.stringify(pendOf(rs[0], key)));
  T('[2] A6: the honest starts a minute later name another roster -> split (logged, counted once)', LATE.test(rs[1].out) && (pendOf(rs[1], key) || {}).split === 1
    && lateSplitN(rs) === 1, rs[1].out.slice(-600));
  heldChecks('[2] A6:', rs, key, 6);
  T('[2] A6: the Q75 contest flags nobody, the honest winners included (Q114 review)', fOf(last(rs), P1) === 0 && fOf(last(rs), P2) === 0,
    JSON.stringify(RR.map(s => fOf(last(rs), s))));
  const script = mutant(LATE_FROM, '  return false;', '[2] A6');
  if (script) try {
    const m = timeline(steps, script);
    T('[2] A6 mutant: no later-start check -> the losers take the win, the winners get nothing', allOk(m, 6) && stole(m), JSON.stringify(RR.map(s => ptsIn(m, s))));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
{
  // [2b] the honest starts sit on shards 40 / 41 that fail every read until past START_CONFIRM_MS
  const h = 0x9002, { SA, SR, RS, RF, key } = a6(h);
  const SRx = SR.map((r, i) => i < 2 ? Object.assign({}, r, { shard: 40 + i }) : r);
  const S = SA.concat(SRx), F = S.concat(RS, RF);
  const fail = { STUB_FAIL: JSON.stringify({ shard_40: 503, shard_41: 503 }) };
  const steps = [[0, SA], [1 * MIN, S, fail], [6 * MIN, S, fail], [6 * MIN, S, fail], [1 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]];
  const rs = timeline(steps);
  T('[2b] A6, the honest starts unread past START_CONFIRM_MS: still provisional after the partial reads', (pendOf(rs[3], key) || {}).prov && !(pendOf(rs[3], key) || {}).split
    && /read shard failed|shard_40/.test(rs[3].out), JSON.stringify(pendOf(rs[3], key)));
  T('[2b] split once the honest starts are read', LATE.test(rs[4].out) && (pendOf(rs[4], key) || {}).split === 1, rs[4].out.slice(-600));
  heldChecks('[2b] A6, unread:', rs, key, 8);
  const script = mutant("  if (readComplete !== false) for (const m of Object.keys(pending)) {", '  for (const m of Object.keys(pending)) {', '[2b]');
  if (script) try {
    const m = timeline(steps, script);
    T('[2b] mutant: confirmed on a partial read -> the losers take the win', allOk(m, 8) && stole(m), JSON.stringify(RR.map(s => ptsIn(m, s))));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
{
  // [2c] the job's next run comes eleven minutes after the first look (a delayed schedule)
  const h = 0x9003, { SA, SR, RS, RF, key } = a6(h);
  const S = SA.concat(SR), F = S.concat(RS, RF);
  const steps = [[0, SA], [11 * MIN, S], [6 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]];
  const rs = timeline(steps);
  T('[2c] A6, next run past START_CONFIRM_MS: the starts read in it are compared first -> split', LATE.test(rs[1].out) && (pendOf(rs[1], key) || {}).split === 1
    && confirmedN(rs) === 0, rs[1].out.slice(-600));
  heldChecks('[2c] A6, delayed run:', rs, key, 6);
  const script = mutant(LATE_FROM, '  if (!p || !p.prov || p.split || Date.now() - (p.t0 || 0) >= START_CONFIRM_MS) return false;', '[2c]');
  if (script) try {
    const m = timeline(steps, script);
    T('[2c] mutant: confirmed before this run\'s starts are compared -> the losers take the win', allOk(m, 6) && stole(m), JSON.stringify(RR.map(s => ptsIn(m, s))));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}

// ---- [3] REVIEW-2 A8 (1V1): the loser P2 and his alt Q2 start before level 1 naming [Q2, P2] ----
{
  const h = 0x9010, R = [P1, P2], F = [Q[2], P2];
  const SE = [{ sid: Q[2], d: v1start(h, 0, F) }, { sid: P2, d: v1start(h, 1, F) }];
  const S = SE.concat([{ sid: P1, d: v1start(h, 0, R) }]);
  const Fin = S.concat([{ sid: P1, d: v1settle(h, 0, R, 0) }, { sid: P2, d: v1settle(h, 1, F, 1) }, { sid: Q[2], d: v1settle(h, 0, F, 1) }]);
  const key = keyOf(SE[0].d);
  const steps = [[0, SE], [1 * MIN, S], [12 * MIN, Fin], [6 * MIN, Fin], [6 * MIN, Fin], [3 * HOUR, Fin]];
  const rs = timeline(steps);
  T('[3] A8: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[3] A8: registered from the loser and his alt, split when P1\'s start arrives', pendOf(rs[0], key) && pendOf(rs[0], key).prov && LATE.test(rs[1].out)
    && (pendOf(rs[1], key) || {}).split === 1, JSON.stringify([pendOf(rs[0], key), pendOf(rs[1], key)]));
  T('[3] A8: no seat gate; held by the Q75 contest until the start entry matures, nobody rated; P1 no leaver', !Q80LINE.test(outOf(rs)) && Q75.test(outOf(rs)) && !processedOf(rs[4]).has(key)
    && [P1, P2, Q[2]].every(s => none(rs, s)) && leavesOf(last(rs), P1) === 0, JSON.stringify([P1, P2, Q[2]].map(s => [ptsIn(rs, s), leavesOf(last(rs), s)])));
  const script = mutant(LATE_FROM, '  return false;', '[3] A8');
  if (script) try {
    const m = timeline(steps, script);
    T('[3] A8 mutant: no later-start check -> P2 takes the win', allOk(m, 6) && up(m, P2) && none(m, P1), JSON.stringify([P1, P2].map(s => ptsIn(m, s))));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}

// ---- [4] honest controls ----
const realStarts = (h) => [0, 1, 2, 3].map(s => ({ sid: RR[s], d: t2start(h, s, RR) }));
const realSettles = (h) => [0, 1, 2, 3].map(s => ({ sid: RR[s], d: t2settle(h, s, RR, 0) }));
const settledHonest = (tag, rs, key, settleRun) => {
  T(tag + ' no split, nothing held', !/start-split /.test(outOf(rs)) && !Q75.test(outOf(rs)) && lateSplitN(rs) === 0, outOf(rs).match(/start-split [^\n]*/g));
  T(tag + ' the real result settles: P1 / P2 win, P3 / P4 lose, nobody convicted', processedOf(rs[settleRun]).has(key) && up(rs, P1) && up(rs, P2)
    && ptsIn(rs, P3).length === 1 && ptsIn(rs, P3)[0] < 2500 && RR.every(s => leavesOf(last(rs), s) === 0), JSON.stringify(RR.map(s => ptsIn(rs, s))));
};
{
  // [4a] P2 cold-reconnects three minutes after the first look (inside the four-minute window) and writes his start again
  //   (the same roster, the same seat)
  const h = 0x9020, S = realStarts(h), copy = { sid: P2, d: t2start(h, 1, RR) }, key = keyOf(S[0].d);
  const S2 = S.concat([copy]), F = S2.concat(realSettles(h));
  const rs = timeline([[0, S], [3 * MIN, S2], [7 * MIN, S2], [3 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]]);
  T('[4a] cold-reconnect copy: seven runs exit 0', allOk(rs, 7), last(rs).out.slice(-800));
  T('[4a] provisional at three minutes, confirmed at ten (counted once)', (pendOf(rs[1], key) || {}).prov && !(pendOf(rs[2], key) || {}).prov && confirmedN(rs) === 1,
    JSON.stringify([pendOf(rs[1], key), pendOf(rs[2], key)]));
  settledHonest('[4a]', rs, key, 3);
  T('[4a] nobody flagged, nothing dropped', RR.every(s => fOf(last(rs), s) === 0) && offSeatN(rs) === 0 && !Q80LINE.test(outOf(rs)));
}
{
  // [4b] the first look reads only P1 / P2's starts (P3 / P4's sit on shards 40 / 41, unread that run)
  const h = 0x9021, S = realStarts(h).map((r, i) => i >= 2 ? Object.assign({}, r, { shard: 38 + i }) : r), key = keyOf(S[0].d);
  const F = S.concat(realSettles(h));
  const fail = { STUB_FAIL: JSON.stringify({ shard_40: 503, shard_41: 503 }) };
  const rs = timeline([[0, S, fail], [6 * MIN, S], [6 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]]);
  T('[4b] half the starts at the first look: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[4b] registered from P1 / P2, provisional', pendOf(rs[0], key) && pendOf(rs[0], key).prov && !pendOf(rs[0], key).split, JSON.stringify(pendOf(rs[0], key)));
  settledHonest('[4b]', rs, key, 2);
}
{
  // [4c] an outside account copies the players' start (the same roster) from P3's seat two minutes after the first look
  const h = 0x9022, S = realStarts(h), key = keyOf(S[0].d), cp = { sid: Q[5], d: t2start(h, 2, RR) };
  const S2 = S.concat([cp]), F = S2.concat(realSettles(h));
  const rs = timeline([[0, S], [2 * MIN, S2], [10 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F]]);
  T('[4c] an outside copy of the roster: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[4c] no split; the copy is dropped by the gate (not counted, nobody flagged: Q124), the players are not flagged either', !/start-split /.test(outOf(rs)) && Q80LINE.test(rs[1].out)
    && fOf(last(rs), Q[5]) === 0 && RR.every(s => fOf(last(rs), s) === 0), JSON.stringify([Q[5]].concat(RR).map(s => fOf(last(rs), s))));
  T('[4c] the real result settles', processedOf(rs[2]).has(key) && up(rs, P1) && up(rs, P2) && none(rs, Q[5]));
}

// ---- [5] Q114: review-q80.js T9 -- a mismatched result written after the key settled ----
{
  const h = 0x9030, S = realStarts(h), key = keyOf(S[0].d), F = S.concat(realSettles(h));
  const fake = { sid: X1, d: t2settle(h, 0, [X1, P2, P3, P4], 1) };   // "seats 2 / 3 won", written from seat 0
  const G = F.concat([fake]);
  // the flag memory is pruned when the job saves its signals, which any flag elsewhere does: two strangers' unrelated
  //   disagreeing pair (key 0x9032) shows up in the run 46 days later
  const other = [{ sid: Q[6], d: v1settle(0x9032, 0, [Q[6], Q[7]], 0) }, { sid: Q[7], d: v1settle(0x9032, 1, [Q[6], Q[7]], 1) }];
  const steps = [[0, S], [12 * MIN, F], [6 * MIN, F], [6 * MIN, F], [3 * HOUR, F], [6 * MIN, G], [6 * MIN, G], [46 * DAY, G.concat(other)], [6 * MIN, G.concat(other)]];
  const rs = timeline(steps);
  T('[5] T9: nine runs exit 0', allOk(rs, 9), last(rs).out.slice(-800));
  T('[5] T9: the key settles as before', processedOf(rs[1]).has(key) && up(rs, P1) && up(rs, P2));
  T('[5] T9: the late record makes the group inconsistent -- logged, counted, nobody flagged', /late-mismatch [^\n]*nobody flagged \(Q114\)/.test(rs[5].out) && lateMismatchN(rs) === 4
    && RR.every(s => fOf(rs[6], s) === 0), JSON.stringify(RR.map(s => fOf(rs[6], s))));
  T('[5] T9: nobody flagged after the flag-memory prune either; pinned cost -- the late writer is not flagged', RR.concat([X1]).every(s => fOf(last(rs), s) === 0),
    JSON.stringify(RR.concat([X1]).map(s => fOf(last(rs), s))));
  T('[5] T9: no rating moves again', ptsIn(rs, P1).length === 1 && ptsIn(rs, X1).length === 0);
  const script = mutant('    if (processed.has(m)) {\n      RUN.lateMismatch', '    if (false) {\n      RUN.lateMismatch', '[5] T9');
  if (script) try {
    const m = timeline(steps, script);
    T('[5] T9 mutant: settled keys flagged again -> each player +1, +1 more after the prune', allOk(m, 9) && RR.every(s => fOf(m[6], s) === 1 && fOf(last(m), s) === 2),
      JSON.stringify(RR.map(s => [fOf(m[6], s), fOf(last(m), s)])));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
{
  // control: an unsettled key whose two records disagree (no start roster) still flags both writers once
  const h = 0x9031, R = [P1, P2];
  const recs = [{ sid: P1, d: v1settle(h, 0, R, 0) }, { sid: P2, d: v1settle(h, 1, R, 1) }];
  const rs = timeline([[0, recs], [6 * MIN, recs]]);
  T('[5] control: an inconsistent group on an unsettled key flags its writers once, as before', allOk(rs, 2) && fOf(last(rs), P1) === 1 && fOf(last(rs), P2) === 1
    && lateMismatchN(rs) === 0 && !processedOf(last(rs)).has(keyOf(recs[0].d)), JSON.stringify([fOf(last(rs), P1), fOf(last(rs), P2)]));
}

// ---- [6] wiring pins ----
{
  const reg = SRC.slice(SRC.indexOf('function registerStartRosters('), SRC.indexOf('// ---- seat gate (cloud audit Q80) ----'));
  T('[6] registerStartRosters: a registered key is compared (lateStartSplit) before it is skipped, processed keys first',
    /if \(processed\.has\(m\)\) continue;\n\s+if \(pending\[m\]\) \{\n\s+if \(isMatchmadeMt\(sg\[m\]\[0\]\.d\[2\] \| 0\)\) noteBlankStarts\(m, sg\[m\]\);[^\n]*\n\s+if \(lateStartSplit\(pending\[m\], sg\[m\], m\)\) \{[^\n]*\}\n\s+continue;\n\s+\}/.test(reg));
  T('[6] registerStartRosters: prov only on an unsplit roster, the signature startRosterDisagrees compares', /\} else pending\[m\]\.prov = startSig\(all\[0\]\);/.test(reg));
  T('[6] registerStartRosters: confirmation after the registration loop, complete reads only, START_CONFIRM_MS from t0',
    reg.indexOf('if (readComplete !== false) for (const m of Object.keys(pending))') > reg.indexOf('lateStartSplit(') && /now - \(p\.t0 \|\| 0\) >= START_CONFIRM_MS\) \{ delete p\.prov;/.test(reg));
  T('[6] startSig hashes pc + rosterCanon (the same pair startRosterDisagrees compares)', /function startSigOf\(pc, ro\) \{\n\s+return crypto\.createHash\('sha256'\)\.update\(\(pc \| 0\) \+ '\|' \+ rosterCanon\(ro\)\)/.test(SRC)
    && /function startSig\(r\) \{ return startSigOf\(r\.d\[8\], r\.roster\); \}/.test(SRC)
    && /const sig = \(r\) => \(r\.d\[8\] \| 0\) \+ '\|' \+ rosterCanon\(r\.roster\);/.test(SRC));
  const main = SRC.slice(SRC.indexOf('const registeredEarly = registerStartRosters('));
  T('[6] main: registration (and the later-start check) runs before the seat gate', main.indexOf('registerStartRosters(') < main.indexOf('applySeatGate('));
  T('[6] main: the inconsistent-group flag loop skips settled keys before recordFlag (Q128: ungated endless keys between)',
    /for \(const \{ m, g \} of inconsistentGroups\) \{[\s\S]{0,700}?if \(processed\.has\(m\)\) \{[\s\S]{0,300}?continue;\n\s+\}\n[\s\S]{0,1600}?if \(recordFlag\(signals, g, m, nowMs\)\)/.test(main));
  T('[6] summary rows', /start rosters split by a later start \/ confirmed \(Q118\)/.test(SRC) && /settled keys with records that disagree, nobody flagged \(Q114\)/.test(SRC));
}

// ---- [7] Q127 / Q130: the provisional window closes four minutes after registration ----
// REVIEW-2 of Q114 + Q118, D1: a 1V1 ranked [P1, P2], P2 losing; his alt Q3 copies the key into a start naming [P1, P2, Q3]
//   (another seat count) from seat 2 late in the match. With the old ten minutes the roster was still provisional when the
//   job read it: the key split, the Q75 contest held the match until it voided, nobody rated or flagged -- the loss undone
//   for free, as often as he liked. Four minutes after registration (five with Q127) the roster is final: the start is one
//   more record off its seat and the real result settles. D1e (pinned residual): the same start read by the run that would
//   confirm (five minutes in) is compared first and still splits it.
{
  const R = [P1, P2], A3 = [P1, P2, Q[3]];
  const startsOf = (h) => [{ sid: P1, d: v1start(h, 0, R) }, { sid: P2, d: v1start(h, 1, R) }];
  const altOf = (h) => ({ sid: Q[3], d: v1start(h, 2, A3) });
  const resultsOf = (h) => [{ sid: P1, d: v1settle(h, 0, R, 0) }, { sid: P2, d: v1settle(h, 1, R, 0) }];
  const d1 = (h) => { const S = startsOf(h), SA = S.concat([altOf(h)]), F = SA.concat(resultsOf(h));
    return [[0, S], [5 * MIN, S], [5 * MIN, SA], [5 * MIN, F], [5 * MIN, F], [3 * HOUR, F]]; };
  const h = 0x9040, key = keyOf(v1start(h, 0, R));
  const rs = timeline(d1(h));
  T('[7] D1: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[7] D1: provisional at registration, final at the run five minutes later (four-minute window)', (pendOf(rs[0], key) || {}).prov && pendOf(rs[1], key) && !('prov' in pendOf(rs[1], key))
    && !pendOf(rs[1], key).split && confirmedN(rs) === 1, JSON.stringify([pendOf(rs[0], key), pendOf(rs[1], key)]));
  T('[7] D1: the alt\'s start ten minutes in is dropped by the gate, no split, no contest', Q80LINE.test(rs[2].out) && !/start-split /.test(outOf(rs)) && !Q75.test(outOf(rs)),
    rs[2].out.slice(-600));
  T('[7] D1: the real result settles -- P1 wins, P2 loses, nobody convicted', processedOf(rs[3]).has(key) && up(rs, P1) && ptsIn(rs, P2).length === 1 && ptsIn(rs, P2)[0] < 2500
    && none(rs, Q[3]) && [P1, P2].every(s => leavesOf(last(rs), s) === 0), JSON.stringify([P1, P2, Q[3]].map(s => ptsIn(rs, s))));
  T('[7] D1: the players are not flagged', [P1, P2].every(s => fOf(last(rs), s) === 0), JSON.stringify([P1, P2].map(s => fOf(last(rs), s))));
  const script = mutant('Number(process.env.START_CONFIRM_MS || 240000)', 'Number(process.env.START_CONFIRM_MS || 600000)', '[7] D1');
  if (script) try {
    const m = timeline(d1(0x9041), script);
    T('[7] D1 mutant: ten minutes again -> the alt\'s start splits the key and P2\'s loss is undone', allOk(m, 6) && LATE.test(m[2].out) && none(m, P1) && none(m, P2),
      JSON.stringify([P1, P2].map(s => ptsIn(m, s))));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
  // D1e: the alt writes before the run five minutes in (the run that would confirm) reads it: compared first, split, held until it voids
  const he = 0x9042, keye = keyOf(v1start(he, 0, R)), Se = startsOf(he), SAe = Se.concat([altOf(he)]), Fe = SAe.concat(resultsOf(he));
  const re = timeline([[0, Se], [5 * MIN, SAe], [5 * MIN, SAe], [5 * MIN, Fe], [5 * MIN, Fe], [3 * HOUR, Fe]]);
  T('[7] D1e (pinned residual): an alt\'s start read by the run that would confirm still splits the key -- held, voided, nobody rated, flagged or convicted',
    allOk(re, 6) && LATE.test(re[1].out) && Q75.test(outOf(re)) && processedOf(last(re)).has(keye) && [P1, P2, Q[3]].every(s => none(re, s) && fOf(last(re), s) === 0)
    && [P1, P2].every(s => leavesOf(last(re), s) === 0), JSON.stringify([P1, P2, Q[3]].map(s => [ptsIn(re, s), fOf(last(re), s)])));
}

// ---- [8] Q124 first step: a record the seat gate drops flags nobody, on a matchmade key too ----
// REVIEW-2 of Q113, D1 (twenty minutes ahead): a 1V1 [V, M], M picks the key (the friends'-room host, the lobby owner).
//   M and his alt A write starts naming [A, M] twenty minutes before level 1: two votes, the roster registers and is
//   confirmed five minutes later. V's honest start and result name [V, M] at seat 0, A's seat: the gate drops them. Until
//   now that flagged V once per match (three friends'-room matches: trust tier 1 for the same invitees). Nobody is flagged
//   now. Pinned residual (the rest of Q124, P3): the pair's own result settles -- M wins against his alt, V's match is lost.
{
  const V = P1, M = P2, A = Q[4], RV = [V, M], RA = [A, M];
  const d1 = (h) => {
    const SE = [{ sid: A, d: v1start(h, 0, RA) }, { sid: M, d: v1start(h, 1, RA) }];
    const S = SE.concat([{ sid: V, d: v1start(h, 0, RV) }]);
    const F = S.concat([{ sid: V, d: v1settle(h, 0, RV, 0) }, { sid: A, d: v1settle(h, 0, RA, 1) }, { sid: M, d: v1settle(h, 1, RA, 1) }]);
    return [[0, SE], [5 * MIN, SE], [15 * MIN, S], [5 * MIN, F], [5 * MIN, F], [3 * HOUR, F]];
  };
  const h = 0x9050, key = keyOf(v1start(h, 0, RV));
  const rs = timeline(d1(h));
  T('[8] six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  T('[8] the pair\'s roster registers and is confirmed before V\'s start', pendOf(rs[1], key) && !('prov' in pendOf(rs[1], key)) && pendOf(rs[1], key).roster[0] === v.pid(A),
    JSON.stringify(pendOf(rs[1], key)));
  T('[8] V\'s start and result are dropped by the gate', Q80LINE.test(rs[2].out) && Q80LINE.test(rs[3].out) && offSeatN(rs) >= 2, String(offSeatN(rs)));
  T('[8] nobody flagged -- V above all (Q124), nobody convicted', [V, M, A].every(s => fOf(last(rs), s) === 0) && [V, M, A].every(s => leavesOf(last(rs), s) === 0),
    JSON.stringify([V, M, A].map(s => [fOf(last(rs), s), leavesOf(last(rs), s)])));
  T('[8] pinned residual (rest of Q124): the pair\'s own result settles, V gets nothing', processedOf(last(rs)).has(key) && up(rs, M) && none(rs, V)
    && ptsIn(rs, A).length === 1 && ptsIn(rs, A)[0] < 2500, JSON.stringify([V, M, A].map(s => ptsIn(rs, s))));
  const script = mutant('  //   clean) and gains nothing by the records (dropped).\n', '  //   clean) and gains nothing by the records (dropped).\n'
    + "  for (const [m, rs] of seatGate.out) { if (isEndlessMt(rs[0].d[2] | 0)) continue; if (recordFlag(signals, rs, m + '|seat', Date.now())) sigDirty = true; for (const r of rs) trustTouched.add(String(r.steamID)); }\n", '[8]');
  if (script) try {
    const m = timeline(d1(0x9051), script);
    T('[8] mutant: the seat gate flags again (the Q113 loop) -> V is flagged for his own honest records', allOk(m, 6) && fOf(last(m), V) === 1, String(fOf(last(m), V)));
  } finally { try { fs.unlinkSync(script); } catch (e) {} }
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (late-start-roster) ===');
process.exit(failN === 0 ? 0 : 1);
