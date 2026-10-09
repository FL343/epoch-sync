'use strict';
// Team-gamble lone dissent (Q51, cloud audit follow-up to the gamble commit-reveal fix): a mode-2 match where ONE
// writer disagrees (the rank-0 refusal of a seat that judged itself cut from the gamble, or a differing score
// vector) and every other writer agrees used to stay unsettled for everybody, flagging every writer -- a player who
// blocked only the game connection voided the match at will. Now the dissenter alone is struck and flagged; from
// his K-th strike inside the window the match settles from the agreeing records and his seat is a consensus leaver.
//   [1] detector shapes (team2LoneDissent)
//   [2] verdict rule (t2ldVerdict: K, window, same opposing host once, K_HARD)
//   [3] one lone dissent (ranked 2v2, the host's teammate, same vector + rank 0): unsettled, only the dissenter
//       flagged, free strike; at maturity the orphan verdict processes it with no exit-rate hit
//   [4] the same player's second lone dissent (differing vector, his team losing) inside the window: settles from
//       the rest, he is a consensus leaver (-100 points, exit rate), the others are rated
//   [5] honest occasional disconnect: one strike, the next one 31 days later is free again
//   [6] two dissenters: unchanged (nobody settles, every writer flagged, no strike)
//   [7] framed twice by the same opposing host: still free; a different opposing host's match then settles
//   [8] honest agreeing match: unaffected
//   [9] quick 3v3: second strike settles, exit rate only (no points surface)
//   [10] sticky verdicts: a deferred settle verdict settles later without a new strike; a free match stays
//        unsettled after the dissenting record rotates away
//   [11] wiring pins
// Runs the REAL validate.js main() against an offline board stub (test/writer-pacing.js harness).
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

function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-lone-'));
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
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
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
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
}
// With the absent-seat hold in (cloud audit R1-B2-04, merged before or after this), a group missing a seat's
//   record -- the dissenter's seat once a settle verdict leaves it out -- settles one grace period later: follow up
//   with that run. Without the hold the first run settles and no follow-up happens.
function runSettle(boards, files) {
  const r = runCron(boards, files);
  return (/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS) ? runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000)) : r;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const scoreTo = (r, boardId, sid) => { const p = posts(r, boardId).filter(x => new RegExp('steamid=' + sid + '(&|$)').test(x.body)); return p.length ? Number(/score=(-?[0-9]+)/.exec(p[p.length - 1].body)[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const strikesOf = (r, sid) => ((sigOf(r).t2ld || {})[v.pid(sid)] || []).length;
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
// mode-2 settle record. roster: sids by seat (seat 0 = host); win: winning team (0 = seats < ts); ranks by the
//   winning-block convention; o.rank / o.scores override for the dissenting writer
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
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs, sids) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: (sids || [A, B, C, D, E, F]).map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// one match's records: every roster seat writes, `dis` (seat -> overrides) changes some, `skip` drops seats
function match(mt, hash, roster, dis, skip) {
  const out = [];
  roster.forEach((sid, seat) => { if (skip && skip.indexOf(seat) >= 0) return; out.push({ sid, d: t2(mt, hash, seat, roster, (dis || {})[seat]) }); });
  return out;
}
// an attested start sighted `ago` ms before the run (pid roster, like reconcileStarts registers it)
function startOf(mt, hash, roster, ago) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [] };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const R4 = [A, B, C, D];   // host A; team 0 = A, B; team 1 = C, D
const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const recsOf = (list) => list.map(x => ({ steamID: x.sid, d: x.d, dispCode: x.d[10 + (x.d[8] | 0)] | 0, roster: v.decodeRoster(x.d) }));

// ---- [1] detector shapes ----
{
  const ld0 = v.team2LoneDissent(recsOf(match(6, 0x100, R4, { 2: { rank: 0 } })), vecOf);
  T('[1] rank-0 refusal, same vector: the dissenter is found', ld0 && ld0.sid === C && ld0.seat === 2 && ld0.rest.length === 3 && ld0.win === 0);
  T('[1] host on the other team -> opposing', ld0 && ld0.host === A && ld0.opp === 1);
  const ld1 = v.team2LoneDissent(recsOf(match(6, 0x101, R4, { 3: { rank: 0, scores: [6000, 5500, 5000, 3000] } })), vecOf);
  T('[1] differing vector: found', ld1 && ld1.sid === D);
  const ld2 = v.team2LoneDissent(recsOf(match(6, 0x102, R4, { 1: { rank: 3 } })), vecOf);
  T('[1] in-domain conflicting winner claim: found, own-side host', ld2 && ld2.sid === B && ld2.opp === 0);
  const ld3 = v.team2LoneDissent(recsOf(match(6, 0x103, R4, { 0: { rank: 0 } })), vecOf);
  T('[1] the host himself dissenting: found, counted as own-side', ld3 && ld3.sid === A && ld3.opp === 0);
  T('[1] two dissenters: none', v.team2LoneDissent(recsOf(match(6, 0x104, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  T('[1] everyone agrees: none', v.team2LoneDissent(recsOf(match(6, 0x105, R4)), vecOf) === null);
  T('[1] one against one (only two writers): none', v.team2LoneDissent(recsOf(match(6, 0x106, R4, { 2: { rank: 0 } }, [1, 3])), vecOf) === null);
  T('[1] the agreeing side votes void (host left): none', v.team2LoneDissent(recsOf(match(6, 0x107, R4, { 0: { disp: 3 }, 1: { disp: 3 }, 3: { disp: 3 }, 2: { rank: 0 } })), vecOf) === null);
  const outsider = recsOf(match(6, 0x108, R4, { 2: { rank: 0 } })).map(r => (r.steamID === C ? Object.assign({}, r, { steamID: E }) : r));
  T('[1] a dissenting writer the others do not name at that seat: none', v.team2LoneDissent(outsider, vecOf) === null);
  const seatClash = recsOf(match(6, 0x109, R4, { 2: { rank: 0 } })).map(r => (r.steamID === C ? Object.assign({}, r, { d: r.d.slice(0, 5).concat([1], r.d.slice(6)) }) : r));
  T('[1] a dissenter claiming an agreeing writer\'s seat: none', v.team2LoneDissent(seatClash, vecOf) === null);
  T('[1] team brawl (mode 1, no gamble): none', v.team2LoneDissent(recsOf(match(4, 0x10A, R4, { 2: { rank: 0 } })), vecOf) === null);
  const R6 = [A, B, C, D, E, F];
  const ld6 = v.team2LoneDissent(recsOf(match(9, 0x10B, R6, { 5: { rank: 0 } })), vecOf);
  T('[1] ranked 3v3: found, opposing host', ld6 && ld6.sid === F && ld6.opp === 1);
  const ld6b = v.team2LoneDissent(recsOf(match(9, 0x10C, R6, { 2: { rank: 0 } })), vecOf);
  T('[1] ranked 3v3 seat 2 is the host\'s team', ld6b && ld6b.sid === C && ld6b.opp === 0);
  const dup = recsOf(match(6, 0x10D, R4, { 2: { rank: 0 } })); dup.push(Object.assign({}, dup[0]));
  T('[1] an agreeing writer with two records: none (the dup-writer sanity flag owns it)', v.team2LoneDissent(dup, vecOf) === null);
  const dupX = recsOf(match(6, 0x10E, R4, { 2: { rank: 0 } })); dupX.push(Object.assign({}, dupX[2]));
  const ldx = v.team2LoneDissent(dupX, vecOf);
  T('[1] the dissenter with two records: found', ldx && ldx.sid === C && ldx.recs.length === 2);
  const dupS = recsOf(match(6, 0x10F, R4, { 2: { rank: 0 } })); dupS.push(Object.assign({}, dupS[2], { d: dupS[2].d.slice(0, 5).concat([3], dupS[2].d.slice(6)) }));
  T('[1] the dissenter writing two records at different seats: none (forged shape, old path)', v.team2LoneDissent(dupS, vecOf) === null);
  const big = [5000000, 4000000, 3000000, 2000000];   // over the gamble score cap: the agreeing side is not settleable on its own
  T('[1] the agreeing side itself out of sanity bounds: none', v.team2LoneDissent(recsOf(match(6, 0x110, R4, { 0: { scores: big }, 1: { scores: big }, 3: { scores: big }, 2: { rank: 0 } })), vecOf) === null);
}

// ---- [2] verdict rule ----
{
  const now = 100 * 86400000, K = v.T2LD.K, W = v.T2LD.WINDOW_MS;
  T('[2] defaults: K 2, K_HARD 4, window 30 days', K === 2 && v.T2LD.K_HARD === 4 && W === 30 * 86400000);
  const s = (m, ago, h, o) => ({ m, t: now - ago, h: h || '', o: o | 0 });
  T('[2] first strike: free', v.t2ldVerdict([], s('x', 0, 'H', 1), now) === 'free');
  T('[2] first own-side strike: free', v.t2ldVerdict([], s('x', 0), now) === 'free');
  T('[2] second own-side strike inside the window: settle', v.t2ldVerdict([s('a', 86400000)], s('x', 0), now) === 'settle');
  T('[2] the previous strike older than the window does not count', v.t2ldVerdict([s('a', W + 1000)], s('x', 0), now) === 'free');
  T('[2] two opposing strikes, same host: free', v.t2ldVerdict([s('a', 1000, 'H', 1)], s('x', 0, 'H', 1), now) === 'free');
  T('[2] two opposing strikes, different hosts: settle', v.t2ldVerdict([s('a', 1000, 'H', 1)], s('x', 0, 'G', 1), now) === 'settle');
  T('[2] opposing + own-side: settle', v.t2ldVerdict([s('a', 1000, 'H', 1)], s('x', 0), now) === 'settle');
  T('[2] third under the same opposing host: still free', v.t2ldVerdict([s('a', 2000, 'H', 1), s('b', 1000, 'H', 1)], s('x', 0, 'H', 1), now) === 'free');
  T('[2] fourth under the same opposing host: settle (K_HARD)', v.t2ldVerdict([s('a', 3000, 'H', 1), s('b', 2000, 'H', 1), s('c', 1000, 'H', 1)], s('x', 0, 'H', 1), now) === 'settle');
  T('[2] a stored strike of the same match is not counted twice', v.t2ldVerdict([s('x', 1000)], s('x', 0), now) === 'free');
  // settle verdict rewrites the key's record set (the absolution probe must not see the dissenting record)
  const g = recsOf(match(6, 0x120, R4, { 1: { rank: 0 } }));
  const m = keyOf(g[0].d), gr = { groups: { [m]: g }, consistentMatches: [{ m, g, void: false }], inconsistentGroups: [] };
  const sg = { players: {}, flagged: {}, t2ld: { [v.pid(B)]: [{ m: 'old', t: now - 1000, h: '', o: 0 }] } };
  const res = v.applyTeam2LoneDissent(gr, sg, new Set(), now, vecOf);
  T('[2] pass: settle verdict replaces the group by the agreeing records', res.settle === 1 && gr.consistentMatches.length === 1 && gr.consistentMatches[0].g.length === 3 && !gr.consistentMatches[0].g.some(r => r.steamID === B));
  T('[2] pass: the key\'s record set no longer holds the dissenting record', !gr.groups[m].some(r => r.steamID === B));
  T('[2] pass: a settle verdict does not flag anyone', !sg.flagged[m]);
  // a match whose verdict was stored for one dissenter, now seen with a DIFFERENT lone dissenter (the first one's
  //   record rotated away, a late record arrived): no new strike and never a conviction
  const g2 = recsOf(match(6, 0x121, R4, { 3: { rank: 0 } }));
  const m2 = keyOf(g2[0].d), gr2 = { groups: { [m2]: g2 }, consistentMatches: [{ m: m2, g: g2, void: false }], inconsistentGroups: [] };
  const sg2 = { players: {}, flagged: {}, t2ld: {}, t2lv: { [m2]: { p: v.pid(B), t: now - 1000, v: 'settle' } } };
  const res2 = v.applyTeam2LoneDissent(gr2, sg2, new Set(), now, vecOf);
  T('[2] pass: a different later dissenter is never convicted by the stored verdict', res2.settle === 0 && res2.free === 1 && gr2.consistentMatches.length === 0);
  T('[2] pass: ... and gets no strike', !sg2.t2ld[v.pid(D)] && sg2.t2lv[m2].p === v.pid(B));
}

// ---- [3] one lone dissent, ranked 2v2, the host's teammate (the colluding-premade shape), same vector + rank 0 ----
let r3;
{
  const recs = match(6, 0x300, R4, { 1: { rank: 0 } });
  const m = keyOf(recs[0].d);
  r3 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x300, R4, FLOOR + 5 * 60000) } });
  T('[3] run exits 0', r3.code === 0, r3.out.slice(-800));
  T('[3] not settled', !processedOf(r3).has(m) && posts(r3, RATING).length === 0 && posts(r3, POINTS).length === 0);
  T('[3] only the dissenter is flagged', fOf(r3, B) === 1 && fOf(r3, A) === 0 && fOf(r3, C) === 0 && fOf(r3, D) === 0, 'f=' + [A, B, C, D].map(s => fOf(r3, s)).join(','));
  T('[3] one strike, verdict free', strikesOf(r3, B) === 1 && (sigOf(r3).t2lv || {})[m] && sigOf(r3).t2lv[m].v === 'free');
  T('[3] lone-dissent signal ld on the dissenter; no lh on his own host', ((sigOf(r3).players[v.pid(B)] || {}).ld | 0) === 1 && ((sigOf(r3).players[v.pid(A)] || {}).lh | 0) === 0);
  T('[3] logged', /team2 lone dissent .*verdict free/.test(r3.out));
  const r3b = runCron(boardsWith(recs), advance(r3.state, v.STARTS_MATURITY_MS + 60000));
  T('[3] at maturity the orphan verdict processes it', processedOf(r3b).has(m), r3b.out.slice(-600));
  T('[3] nobody gets an exit-rate hit (everyone wrote a record)', [A, B, C, D].every(s => leavesOf(r3b, s) === 0));
  T('[3] no rating or points ever written', posts(r3b, RATING).length === 0 && posts(r3b, POINTS).length === 0);
  T('[3] the dissenter earns no consolation', posts(r3b, PROGRESS).every(p => !/steamid=76561198000000002(&|$)/.test(p.body)));
  T('[3] still one strike, f unchanged', strikesOf(r3b, B) === 1 && fOf(r3b, B) === 1 && fOf(r3b, A) === 0);
}

// ---- [4] the same player's second lone dissent inside the window settles, he is the leaver ----
{
  // C / D win this time; B (losing side) refuses again, with a differing vector
  const recs = match(6, 0x400, R4, { 0: { win: 1 }, 1: { win: 1, rank: 0, scores: [6000, 5500, 5200, 4500] }, 2: { win: 1 }, 3: { win: 1 } });
  const m = keyOf(recs[0].d);
  const files = advance(r3.state, 3 * 86400000);   // three days later
  files.STARTS_FILE = { [m]: startOf(6, 0x400, R4, FLOOR + 5 * 60000) };
  files.PROCESSED_FILE = [];
  const r = runSettle(boardsWith(recs), files);
  T('[4] run exits 0', r.code === 0, r.out.slice(-800));
  T('[4] verdict settle, two strikes', strikesOf(r, B) === 2 && sigOf(r).t2lv[m].v === 'settle', 'strikes=' + strikesOf(r, B) + ' v=' + JSON.stringify(sigOf(r).t2lv[m]));
  T('[4] the match settles from the agreeing records', processedOf(r).has(m));
  T('[4] the dissenter is a consensus leaver: -100 points, exit rate', scoreTo(r, POINTS, B) === 1900 && leavesOf(r, B) === 1, 'pts=' + scoreTo(r, POINTS, B) + ' leaves=' + leavesOf(r, B));
  T('[4] the three agreeing writers are rated, the dissenter is not', [A, C, D].every(s => scoreTo(r, RATING, s) != null) && scoreTo(r, RATING, B) == null);
  T('[4] the outcome is the agreeing side\'s: C and D gain, his teammate A does not', scoreTo(r, POINTS, C) > 2000 && scoreTo(r, POINTS, D) > 2000 && scoreTo(r, POINTS, A) <= 2000, [A, C, D].map(s => scoreTo(r, POINTS, s)).join(','));
  T('[4] nobody else is flagged for it', fOf(r, A) === 0 && fOf(r, C) === 0 && fOf(r, D) === 0);
  T('[4] leaver line logged', /leaver .* seat 1 = /.test(r.out));
}

// ---- [5] honest occasional disconnect: strikes a month apart never convict ----
{
  const recs = match(6, 0x500, R4, { 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const r1 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x500, R4, FLOOR + 5 * 60000) } });
  T('[5] first disconnect: free', sigOf(r1).t2lv[m].v === 'free' && leavesOf(r1, D) === 0 && scoreTo(r1, POINTS, D) == null);
  const recs2 = match(6, 0x501, R4, { 3: { rank: 0 } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r1.state, 31 * 86400000);
  f2.STARTS_FILE = { [m2]: startOf(6, 0x501, R4, FLOOR + 5 * 60000) };
  const r2 = runCron(boardsWith(recs2), f2);
  T('[5] the next one 31 days later: free again', sigOf(r2).t2lv[m2] && sigOf(r2).t2lv[m2].v === 'free', r2.out.slice(-400));
  T('[5] never a leaver, no points written', leavesOf(r2, D) === 0 && scoreTo(r2, POINTS, D) == null && !processedOf(r2).has(m2));
  T('[5] the expired strike is pruned', strikesOf(r2, D) === 1);
}

// ---- [6] two dissenters: unchanged ----
{
  const recs = match(6, 0x600, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x600, R4, FLOOR + 5 * 60000) } });
  T('[6] not settled, every writer flagged, no strike', !processedOf(r).has(m) && [A, B, C, D].every(s => fOf(r, s) === 1) && strikesOf(r, C) === 0 && strikesOf(r, D) === 0, 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
}

// ---- [7] framed twice by the same opposing host; a different opposing host then settles ----
{
  const ms = [0x700, 0x701].map(h => match(6, h, R4, { 2: { rank: 0 } }));
  const starts = {}; for (const [i, h] of [0x700, 0x701].entries()) starts[keyOf(ms[i][0].d)] = startOf(6, h, R4, FLOOR + (20 - 10 * i) * 60000);
  const r1 = runCron(boardsWith([].concat(...ms)), { STARTS_FILE: starts });
  const vs = [0x700, 0x701].map(h => (sigOf(r1).t2lv || {})[keyOf(t2(6, h, 0, R4))]);
  T('[7] two strikes under host A: both free', vs.every(x => x && x.v === 'free') && strikesOf(r1, C) === 2 && leavesOf(r1, C) === 0, JSON.stringify(vs));
  const RE = [E, B, C, D];   // host E this time, still on the other team
  const recs3 = match(6, 0x702, RE, { 2: { rank: 0 } });
  const m3 = keyOf(recs3[0].d);
  const f3 = advance(r1.state, 86400000);
  f3.STARTS_FILE = { [m3]: startOf(6, 0x702, RE, FLOOR + 5 * 60000) };
  const r3x = runSettle(boardsWith(recs3), f3);
  T('[7] a different opposing host: settle, he is the leaver', sigOf(r3x).t2lv[m3].v === 'settle' && processedOf(r3x).has(m3) && leavesOf(r3x, C) === 1);
}

// ---- [8] honest agreeing match: unaffected ----
{
  const recs = match(6, 0x800, R4);
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x800, R4, FLOOR + 5 * 60000) } });
  T('[8] settles, nobody struck or flagged', processedOf(r).has(m) && Object.keys(sigOf(r).t2ld || {}).length === 0 && [A, B, C, D].every(s => fOf(r, s) === 0) && [A, B, C, D].every(s => leavesOf(r, s) === 0));
  T('[8] all four rated', [A, B, C, D].every(s => scoreTo(r, RATING, s) != null));
}

// ---- [9] quick 3v3 (dissenter on the host's team): second strike settles, exit rate only ----
{
  const R6 = [A, B, C, D, E, F];
  const recs1 = match(8, 0x900, R6, { 2: { rank: 0 } });
  const m1 = keyOf(recs1[0].d);
  const r1 = runCron(boardsWith(recs1), { STARTS_FILE: { [m1]: startOf(8, 0x900, R6, FLOOR + 5 * 60000) } });
  T('[9] first: free', sigOf(r1).t2lv[m1].v === 'free' && fOf(r1, C) === 1 && fOf(r1, F) === 0);
  const recs2 = match(8, 0x901, R6, { 2: { rank: 0, scores: [1, 2, 3, 4, 5, 6] } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r1.state, 86400000);
  f2.STARTS_FILE = { [m2]: startOf(8, 0x901, R6, FLOOR + 5 * 60000) };
  const r2 = runSettle(boardsWith(recs2), f2);
  T('[9] second: settles, exit rate for the dissenter', processedOf(r2).has(m2) && leavesOf(r2, C) === 1, r2.out.slice(-500));
  T('[9] quick: no points surface at all', posts(r2, POINTS).length === 0);
  T('[9] the five agreeing writers are rated', [A, B, D, E, F].every(s => scoreTo(r2, RATING, s) != null) && scoreTo(r2, RATING, C) == null);
}

// ---- [10] sticky verdicts ----
{
  // deferred settle: second strike first sighted before the pacing floor
  const recs = match(6, 0xA00, R4, { 1: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const prior = { players: {}, flagged: {}, t2ld: { [v.pid(B)]: [{ m: 'earlier', t: Date.now() - 86400000, h: '', o: 0 }] } };
  const r1 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0xA00, R4, 60000) }, SIGNALS_FILE: prior });
  T('[10] settle verdict decided, settle deferred by the pacing floor', sigOf(r1).t2lv[m].v === 'settle' && !processedOf(r1).has(m) && strikesOf(r1, B) === 2, 'out=' + r1.out.slice(-300));
  const r2 = runSettle(boardsWith(recs), advance(r1.state, FLOOR + 60000));
  T('[10] next run: settles, no new strike', processedOf(r2).has(m) && strikesOf(r2, B) === 2 && leavesOf(r2, B) === 1);
  // free match whose dissenting record rotates away before maturity stays unsettled
  const recsF = match(6, 0xA01, R4, { 2: { rank: 0 } });
  const mF = keyOf(recsF[0].d);
  const s1 = runCron(boardsWith(recsF), { STARTS_FILE: { [mF]: startOf(6, 0xA01, R4, FLOOR + 5 * 60000) } });
  T('[10] free verdict', sigOf(s1).t2lv[mF].v === 'free');
  const s2 = runCron(boardsWith(recsF.filter(x => x.sid !== C)), advance(s1.state, 60000));
  T('[10] the dissenting record gone: the rest still does not settle', !processedOf(s2).has(mF) && posts(s2, RATING).length === 0 && leavesOf(s2, C) === 0, s2.out.slice(-400));
}

// ---- [11] wiring pins ----
{
  const iPass = SRC.indexOf('applyTeam2LoneDissent(gr, signals, processed, Date.now(), vecOf)');
  const iGroup = SRC.indexOf('const gr = groupRecords(recs'), iProc = SRC.indexOf('const processed = loadProcessed();');
  const iKeys = SRC.indexOf('const consistentKeys = new Set(consistentMatches.map(c => c.m));');
  const iStarts = SRC.indexOf('const startsRes = reconcileStarts(starts, groups, consistentKeys');
  const iFlag = SRC.indexOf('for (const { m, g } of inconsistentGroups) {');
  T('[11] the pass runs after grouping, before the consistent-key set, the start cross-check and the inconsistent flag loop', iGroup > 0 && iProc > iGroup && iPass > iProc && iPass < iKeys && iKeys < iStarts && iPass < iFlag);
  T('[11] signals load once, before the pass', (SRC.match(/const signals = loadSignals\(\);/g) || []).length === 1 && SRC.indexOf('const signals = loadSignals();') < iPass);
  T('[11] exports', typeof v.team2LoneDissent === 'function' && typeof v.t2ldVerdict === 'function' && typeof v.applyTeam2LoneDissent === 'function' && !!v.T2LD);
  T('[11] strikes age out in pruneSignals', /s\.t2ld/.test(SRC.slice(SRC.indexOf('function pruneSignals'), SRC.indexOf('function saveSignals'))));
}

if (failN) { console.log('team2-lone-dissent: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-lone-dissent: all passed');
