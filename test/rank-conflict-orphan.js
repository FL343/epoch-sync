'use strict';
// Team-gamble rank conflict held for good -> the start orphan verdict (cloud audit Q66, follow-up of the Q43 second
// review). A mode-2 group whose records agree on the score vector but not on the winner (the client's rank-0 refusal)
// is consistent, yet the sanity gate holds it ('rank-conflict') every run and it never settles. When no dissent pass
// (Q51 lone / Q56 team) takes the shape -- more refusers than agreeing writers, refusers on both teams -- the key used
// to count as "owned by the normal pipeline" in reconcileStarts and was skipped forever: whoever really quit mid-match
// kept a clean exit rate, whoever stayed never got the interrupted-match consolation. Now such a key matures like an
// inconsistent group: exit rate for the roster seats with no record, consolation for the sane writers, processed.
//   [1] ranked 3v3, a winner (not the host) quits, the three losers refuse: held before maturity, judged after
//   [2] quick 2v2, one refuser on each team, everybody wrote: nobody convicted, the two agreeing writers consoled
//   [3] controls that stay held: a void-consensus group (its VOID path convicts nobody), a group with another sanity
//       flag beside the conflict (self-healing hold), an incomplete shard read (verdict waits)
//   [4] reconcileStarts contract: a key a dissent pass settled (groups[m] narrowed to the agreeing side) stays owned
//   [5] wiring pins
//   [6] mutation self-checks (the exception removed / the void exclusion removed -> [1] / [3] go red)
// Runs the REAL validate.js main() against an offline board stub (test/team2-lone-dissent.js harness).
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
  'const fail = process.env.STUB_FAIL ? JSON.parse(process.env.STUB_FAIL) : {};',
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
  '    if (b && fail[b.name]) { const t = "{}"; return { ok: false, status: fail[b.name], text: async () => t }; }',
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-conflict-orphan-'));
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
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned: ranked points go to 'points' (season boards start later)
    }, stateEnv, env || {});
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
  for (const k of Object.keys(st)) {
    if (!st[k]) continue;
    for (const f of ['t0', 'absentAt']) if (st[k][f]) st[k][f] -= ms;
    if (st[k].started && typeof st[k].started === 'object' && !Array.isArray(st[k].started)) for (const h of Object.keys(st[k].started)) if (typeof st[k].started[h] === 'number') st[k].started[h] -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const scoreTo = (r, boardId, sid) => { const p = posts(r, boardId).filter(x => new RegExp('steamid=' + sid + '(&|$)').test(x.body)); return p.length ? Number(/score=(-?[0-9]+)/.exec(p[p.length - 1].body)[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const pendingOf = (r, m) => (r.state.STARTS_FILE || {})[m];

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
// mode-2 settle record (team2-lone-dissent.js layout). roster: sids by seat (seat 0 = host); win: winning team; ranks
//   by the winning-block convention; o.rank / o.scores / o.disp override
function t2(mt, hash, seat, roster, o) {
  o = o || {};
  const pc = roster.length, ts = pc / 2, win = o.win == null ? 0 : o.win;
  const scores = o.scores || roster.map((s, i) => 6000 - 500 * i);
  const myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (myTeam === win ? 1 : 0), pc, 900].concat(scores, [o.disp | 0]);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// the start attestation every player writes at level 1: same layout, result fields zeroed
function startRec(mt, hash, seat, roster) {
  const d = t2(mt, hash, seat, roster, { rank: 0, scores: roster.map(() => 0) });
  d[0] = v.START_MAGIC; d[7] = 0; d[9] = 0;
  return d;
}
const keyOf = (mt, hash) => hash + '_4321_' + mt;
// one match on the shards: every roster seat's start (shard 0), then the settle records of `write` (seat -> overrides)
function boardsFor(mt, hash, roster, write) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  roster.forEach((sid, seat) => { boards[0].entries.push({ steamID: sid, score: 1, details: startRec(mt, hash, seat, roster) }); });
  for (const seat of Object.keys(write)) boards[1].entries.push({ steamID: roster[seat], score: 1, details: t2(mt, hash, seat | 0, roster, write[seat]) });
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: roster.map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const MAT = v.STARTS_MATURITY_MS, MIN = 60000;
// run 1 sights the starts (and the records); run 2 is one maturity window later, records still up
function twoRuns(boards, script, env2) {
  const r1 = runCron(boards, {}, null, script);
  const r2 = runCron(boards, advance(r1.state, MAT + MIN), env2, script);
  return { r1, r2 };
}
const R6 = [A, B, C, D, E, F];   // host A; team 0 = A, B, C; team 1 = D, E, F
const R4 = [A, B, C, D];         // host A; team 0 = A, B; team 1 = C, D
// [1]'s world: ranked 3v3, team 0 wins, C (not the host) quits mid-match, D E F refuse (rank 0, same score vector)
const W1 = (o) => boardsFor(9, 0x6601, R6, Object.assign({ 0: {}, 1: {}, 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } }, o || {}));
const verdict1 = (x) => leavesOf(x.r2, C) === 1 && processedOf(x.r2).has(keyOf(9, 0x6601));

// ---- [1] ranked 3v3: more refusers than agreeing writers ----
console.log('-- [1] ranked 3v3, a winner quits, the three losers refuse --');
{
  const m = keyOf(9, 0x6601);
  const x = twoRuns(W1());
  T('[1] run 1: the group is consistent but held for the rank conflict', x.r1.code === 0 && new RegExp('match=' + m + ': sanity-flagged \\[rank-conflict\\]').test(x.r1.out), x.r1.out.slice(-600));
  T('[1] run 1: no dissent pass takes this shape (3 refusers, 2 agreeing writers)', !/team2 (lone|team) dissent /.test(x.r1.out));
  T('[1] run 1: not processed, start entry pending, nobody convicted yet', !processedOf(x.r1).has(m) && !!pendingOf(x.r1, m) && leavesOf(x.r1, C) === 0);
  T('[1] run 1: every writer flagged once (unchanged)', [A, B, D, E, F].every(s => fOf(x.r1, s) === 1) && fOf(x.r1, C) === 0);
  T('[1] run 2 (matured): the orphan verdict runs on the key', x.r2.code === 0 && new RegExp('start-orphan ' + m + ': started, never settled -> 1 exit-rate hits').test(x.r2.out), x.r2.out.slice(-800));
  T('[1] run 2: the player who quit gets the exit-rate hit, nobody else', leavesOf(x.r2, C) === 1 && [A, B, D, E, F].every(s => leavesOf(x.r2, s) === 0));
  T('[1] run 2: the two sane writers get the consolation credit', scoreTo(x.r2, PROGRESS, A) === v.CONSOLATION_XP && scoreTo(x.r2, PROGRESS, B) === v.CONSOLATION_XP);
  T('[1] run 2: the refusal records earn nothing (a lone rank-0 record is not sane), the quitter neither', [C, D, E, F].every(s => scoreTo(x.r2, PROGRESS, s) === null));
  T('[1] run 2: processed, pending entry gone, no points or rating moved', processedOf(x.r2).has(m) && !pendingOf(x.r2, m) && posts(x.r2, POINTS).length === 0 && posts(x.r2, RATING).length === 0);
  T('[1] run 2: the flag counters do not move again', [A, B, D, E, F].every(s => fOf(x.r2, s) === 1));
  const r3 = runCron(W1(), advance(x.r2.state, 10 * MIN));
  T('[1] run 3: a processed key stays done (no second hit, no second credit, no new flag)', leavesOf(r3, C) === 1 && posts(r3, PROGRESS).length === 0 && !new RegExp('match=' + m + ': sanity-flagged').test(r3.out));
}

// ---- [2] quick 2v2: one refuser on each team, everybody wrote ----
console.log('-- [2] quick 2v2, refusers on both teams --');
{
  const m = keyOf(5, 0x6602);
  const boards = boardsFor(5, 0x6602, R4, { 0: {}, 1: { rank: 0 }, 2: { rank: 0 }, 3: {} });
  const x = twoRuns(boards);
  T('[2] run 1: held for the rank conflict, no dissent pass takes a cross-team refusal', new RegExp('match=' + m + ': sanity-flagged \\[rank-conflict\\]').test(x.r1.out) && !/team2 (lone|team) dissent /.test(x.r1.out) && !processedOf(x.r1).has(m));
  T('[2] run 2: judged with nobody to convict', new RegExp('start-orphan ' + m + ': started, never settled -> 0 exit-rate hits').test(x.r2.out) && R4.every(s => leavesOf(x.r2, s) === 0), x.r2.out.slice(-800));
  T('[2] run 2: the agreeing writers (one per team) consoled, the refusers not', scoreTo(x.r2, PROGRESS, A) === v.CONSOLATION_XP && scoreTo(x.r2, PROGRESS, D) === v.CONSOLATION_XP && scoreTo(x.r2, PROGRESS, B) === null && scoreTo(x.r2, PROGRESS, C) === null);
  T('[2] run 2: processed', processedOf(x.r2).has(m) && !pendingOf(x.r2, m));
}

// ---- [3] controls that stay held ----
console.log('-- [3] controls: void consensus, another flag beside the conflict, incomplete read --');
{
  const m = keyOf(9, 0x6601);
  const vd = { disp: 3 };   // host-left (void) on every record
  const xv = twoRuns(W1({ 0: vd, 1: vd, 3: { rank: 0, disp: 3 }, 4: { rank: 0, disp: 3 }, 5: { rank: 0, disp: 3 } }));
  T('[3] void consensus + rank conflict: still held after maturity (nobody convicted, not processed)', leavesOf(xv.r2, C) === 0 && !processedOf(xv.r2).has(m) && !!pendingOf(xv.r2, m) && posts(xv.r2, PROGRESS).length === 0, xv.r2.out.slice(-600));
  const big = [5000000, 4000000, 3000000, 2000000, 1000000, 900000];   // over the gamble score cap
  const xb = twoRuns(W1({ 0: { scores: big }, 1: { scores: big }, 3: { rank: 0, scores: big }, 4: { rank: 0, scores: big }, 5: { rank: 0, scores: big } }));
  T('[3] another sanity flag beside the conflict: still held (self-healing hold kept)', new RegExp('match=' + m + ': sanity-flagged \\[[a-z-]+,rank-conflict\\]|match=' + m + ': sanity-flagged \\[rank-conflict,[a-z-]+').test(xb.r1.out) && leavesOf(xb.r2, C) === 0 && !processedOf(xb.r2).has(m), xb.r1.out.slice(-600));
  const xi = twoRuns(W1(), null, { STUB_FAIL: JSON.stringify({ shard_7: 503 }) });
  T('[3] matured but a shard unread this run: the verdict waits (held), then lands on the next full read', leavesOf(xi.r2, C) === 0 && !processedOf(xi.r2).has(m) && /matured verdict\(s\) held/.test(xi.r2.out)
    && leavesOf(runCron(W1(), advance(xi.r2.state, 10 * MIN)), C) === 1, xi.r2.out.slice(-600));
}

// ---- [4] reconcileStarts contract ----
console.log('-- [4] reconcileStarts: which record set decides --');
{
  const recsOf = (mt, hash, roster, write) => Object.keys(write).map(seat => { const d = t2(mt, hash, seat | 0, roster, write[seat]); return { steamID: roster[seat], d, dispCode: d[10 + (d[8] | 0)] | 0, roster: v.decodeRoster(d) }; });
  const m = keyOf(9, 0x6604);
  const full = recsOf(9, 0x6604, R6, { 0: {}, 1: {}, 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } });
  const agreeing = full.filter(r => (r.d[6] | 0) !== 0);
  const pend = () => { const p = {}; const ro = {}; R6.forEach((s, i) => { ro[i] = v.pid(s); }); p[m] = { t0: 0, mt: 9, roster: ro, settled: [], started: R6.map(s => v.pid(s)) }; return p; };   // started: every seat wrote his own start (Q69 convicts only on it; ignored before)
  const run = (g, keys, complete) => { const pending = pend(), leavers = {}, processed = new Set(); const groups = {}; groups[m] = g; const res = v.reconcileStarts([], groups, keys, processed, pending, leavers, MAT + MIN, MAT, {}, complete); return { res, leavers, processed, pending }; };
  const a = run(full, new Set([m]));
  T('[4] consistent key held for the rank conflict only: judged (C hit, A B consoled)', a.res.convicted === 1 && ((a.leavers[v.pid(C)] || {}).leaves | 0) === 1 && a.processed.has(m) && a.res.consoledSids.slice().sort().join() === [A, B].join());
  const b = run(agreeing.concat(full.filter(r => r.steamID === D).map(r => Object.assign({}, r, { d: t2(9, 0x6604, 3, R6, {}) }))), new Set([m]));
  T('[4] a key a dissent pass settled (groups[m] = the agreeing side, sane): still owned by the settle loop', b.res.convicted === 0 && !b.processed.has(m) && !!b.pending[m]);
  const c = run(full, new Set());
  T('[4] the same records as an inconsistent key: judged exactly the same way', c.res.convicted === a.res.convicted && c.res.consoledSids.slice().sort().join() === a.res.consoledSids.slice().sort().join());
  const d = run(full, new Set([m]), false);
  T('[4] incomplete read: held, nobody hit', d.res.held === 1 && d.res.convicted === 0 && !d.processed.has(m));
  const brawl = recsOf(4, 0x6605, R4, { 0: {}, 1: {}, 2: { rank: 0 }, 3: {} });
  const mb = keyOf(4, 0x6605), pb = {}; pb[mb] = { t0: 0, mt: 4, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C), 3: v.pid(D) }, settled: [] };
  const gb = {}; gb[mb] = brawl;
  const rb = v.reconcileStarts([], gb, new Set([mb]), new Set(), pb, {}, MAT + MIN, MAT, {}, true);
  T('[4] not a sub-score (team gamble) code: owned by the settle loop as before', rb.convicted === 0 && !!pb[mb]);
}

// ---- [5] wiring pins ----
console.log('-- [5] wiring pins --');
{
  const fn = SRC.slice(SRC.indexOf('function reconcileStarts('), SRC.indexOf('// ---- deterministic sanity bounds'));
  T('[5] the orphan verdict skips a consistent key only when no rank conflict alone holds it', /if \(consistentKeys\.has\(m\) && !rankConflictHeld\(groups\[m\]\)\) continue;/.test(fn));
  const h = SRC.slice(SRC.indexOf('function rankConflictHeld('), SRC.indexOf('// ---- deterministic sanity bounds'));
  T('[5] the helper (between reconcileStarts and the sanity block): sub-score codes only, void consensus excluded, rank conflict as the ONLY sanity flag', h.length > 0 && SRC.indexOf('function rankConflictHeld(') > SRC.indexOf('function reconcileStarts(') && /isSubScoreMt\(/.test(h) && /voidByConsensus\(/.test(h) && /f\.length === 1 && f\[0\] === 'rank-conflict'/.test(h));
  T('[5] the settle loop still flags the group on the same sanity gate', /const sane = sanityFlags\(g\);/.test(SRC) && /if \(team2WinTeamOf\(g\) == null\) out\.push\('rank-conflict'\);/.test(SRC));
}

// ---- [6] mutation self-checks ----
console.log('-- [6] mutation self-checks --');
{
  const mutants = [
    ['the exception removed', 'if (consistentKeys.has(m) && !rankConflictHeld(groups[m])) continue;', 'if (consistentKeys.has(m)) continue;', (script) => !verdict1(twoRuns(W1(), script))],
    ['the void exclusion removed', 'if (voidByConsensus(g.map(r => r.dispCode)).isVoid) return false;', '', (script) => {
      const vd = { disp: 3 };
      const x = twoRuns(W1({ 0: vd, 1: vd, 3: { rank: 0, disp: 3 }, 4: { rank: 0, disp: 3 }, 5: { rank: 0, disp: 3 } }), script);
      return leavesOf(x.r2, C) === 1;   // [3] the void control gets judged
    }],
    ['any sanity flag counts', "return f.length === 1 && f[0] === 'rank-conflict';", "return f.indexOf('rank-conflict') >= 0;", (script) => {
      const big = [5000000, 4000000, 3000000, 2000000, 1000000, 900000];
      const x = twoRuns(W1({ 0: { scores: big }, 1: { scores: big }, 3: { rank: 0, scores: big }, 4: { rank: 0, scores: big }, 5: { rank: 0, scores: big } }), script);
      return leavesOf(x.r2, C) === 1;   // [3] the over-cap control gets judged
    }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[6] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-rank-conflict-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[6] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (rank-conflict-orphan)') : 'ALL OK (rank-conflict-orphan)');
process.exit(failN ? 1 : 0);
