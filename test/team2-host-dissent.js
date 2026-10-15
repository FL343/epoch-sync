'use strict';
// Team-gamble HOST charges (Q57, cloud audit follow-up to Q51): after Q51 a modded host who cuts an opponent's game
// connection through the gamble window (Steam online) costs the victim a strike and himself nothing but
// players[host].lh, which nothing read. Now each opposing seat struck in a match whose host wrote one of the agreeing
// records charges that host (signals.t2lh, one entry per match); distinct matches AND distinct victims inside the
// window (the smaller one) feed the trust tier as a third input beside f and vur (TRUST_T.HD1 / HD2).
//   [1] hostDissentCount: distinct matches and distinct victims, window
//   [2] trustTierOf: the third input, alone and stacked; the two-argument call unchanged; the env knobs
//   [3] trustPlan: reads the host charges at the given time (write at the threshold, delete on decay)
//   [4] pass level: who is charged (opposing seats only, host wrote the agreeing side, once per match, team dissent
//       in one entry, no charge without a fresh strike); the records must back the roster host (team2HostOwnsSeat0):
//       [4i] an honest teammate written into seat 0 by three colluders is spared, [4j] a modded host moving his own
//       record to an empty seat is still charged, [4k] his own record at seat 0 is enough, [4l] the helper alone
//   [5] a modded host cutting three different opponents in three matches: tier 1 on the trust board; the victims
//       keep their first, free strike
//   [6] an honest host hit once: charged, never on the trust board
//   [7] one dodger blocking three times in the same honest host's matches: counts once, never on the trust board
//   [8] the charges age out: the host leaves the trust board
//   [9] wiring pins
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-host-'));
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
// carry a run's state into the next run as if `ms` of wall time had passed (the Q57 host charges age too)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.t2lh || {})) for (const e of sg.t2lh[k]) e.t -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
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
const TRUST = 9;
// shards + the ranked boards + the trust board (trust: { sid: tier } already on it)
function boardsWith(recs, sids, trust) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: (sids || [A, B, C, D, E, F]).map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] },
    { id: TRUST, name: 'trust_tier', entries: Object.keys(trust || {}).map(s => ({ steamID: s, score: trust[s] })) });
  return boards;
}
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
const G = '76561198000000007', H = '76561198000000008';
const trustDel = (r) => r.posts.filter(p => /DeleteLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + TRUST + '(&|$)').test(p.body));
const chargesOf = (r, sid) => ((sigOf(r).t2lh || {})[v.pid(sid)] || []);
const lhOf = (r, sid) => (((sigOf(r).players || {})[v.pid(sid)]) || {}).lh | 0;
// one run per match (the earlier match's records already rotated off): start registered, earlier state carried
function runMatch(prev, mt, hash, roster, dis, skip, trust) {
  const recs = match(mt, hash, roster, dis, skip);
  const m = keyOf(recs[0].d);
  const files = prev ? advance(prev.state, 60000) : {};
  files.STARTS_FILE = Object.assign({}, files.STARTS_FILE || {}, { [m]: startOf(mt, hash, roster, FLOOR + 5 * 60000) });
  const r = runCron(boardsWith(recs, [A, B, C, D, E, F, G, H], trust), files);
  r.m = m;
  return r;
}

// ---- [1] hostDissentCount ----
{
  const now = 100 * 86400000, W = v.T2LH.WINDOW_MS;
  const e = (m, ago, vs) => ({ m, t: now - ago, v: vs });
  T('[1] nothing: 0', v.hostDissentCount(undefined, now) === 0 && v.hostDissentCount([], now) === 0);
  T('[1] three matches, three victims: 3', v.hostDissentCount([e('a', 1, ['c']), e('b', 2, ['d']), e('c', 3, ['e'])], now) === 3);
  T('[1] three matches, the same victim: 1', v.hostDissentCount([e('a', 1, ['c']), e('b', 2, ['c']), e('c', 3, ['c'])], now) === 1);
  T('[1] one match, three victims: 1', v.hostDissentCount([e('a', 1, ['c', 'd', 'e'])], now) === 1);
  T('[1] two matches, three victims: 2', v.hostDissentCount([e('a', 1, ['c', 'd']), e('b', 2, ['e'])], now) === 2);
  T('[1] an entry past the window does not count', v.hostDissentCount([e('a', W + 1, ['c']), e('b', 2, ['d']), e('c', 3, ['e'])], now) === 2);
  T('[1] malformed entries are skipped', v.hostDissentCount([null, { m: 'x', t: now }, e('b', 2, ['d'])], now) === 1);
}

// ---- [2] trustTierOf ----
{
  const HD1 = v.TRUST_T.HD1, HD2 = v.TRUST_T.HD2;
  T('[2] defaults: HD1 3, HD2 8', HD1 === 3 && HD2 === 8);
  T('[2] two-argument call unchanged', v.trustTierOf(0, 0) === 0 && v.trustTierOf(v.TRUST_T.F1, 0) === 1 && v.trustTierOf(v.TRUST_T.F2, v.TRUST_T.VUR2) === 3);
  T('[2] below the floor: 0', v.trustTierOf(0, 0, HD1 - 1) === 0);
  T('[2] at the floor: 1', v.trustTierOf(0, 0, HD1) === 1);
  T('[2] heavy: 2', v.trustTierOf(0, 0, HD2) === 2);
  T('[2] stacks with f', v.trustTierOf(v.TRUST_T.F1, 0, HD1) === 2);
  T('[2] caps at 3', v.trustTierOf(v.TRUST_T.F2, 0, HD2) === 3);
  const knob = spawnSync(process.execPath, ['-e', "process.env.STATE_SALT = 's'; const x = require(process.argv[1]); console.log(JSON.stringify([x.TRUST_T.HD1, x.TRUST_T.HD2, x.T2LH.WINDOW_MS]))", VALIDATE],
    { env: Object.assign({}, process.env, { TRUST_HD1: '4', TRUST_HD2: '9', T2LH_WINDOW_MS: '86400000' }), encoding: 'utf8' });
  T('[2] env TRUST_HD1 / TRUST_HD2 / T2LH_WINDOW_MS move the defaults', String(knob.stdout).trim() === '[4,9,86400000]', String(knob.stderr).slice(-300));
}

// ---- [3] trustPlan ----
{
  const now = 100 * 86400000, pA = v.pid(A);
  const s = { players: {}, rep: {}, pairs: {}, t2lh: { [pA]: [{ m: 'a', t: now - 1000, v: ['c'] }, { m: 'b', t: now - 2000, v: ['d'] }, { m: 'c', t: now - 3000, v: ['e'] }] } };
  const p1 = v.trustPlan(s, {}, new Set([A]), now);
  T('[3] three charges: tier 1 written', p1.writes.length === 1 && p1.writes[0].sid === A && p1.writes[0].tier === 1 && !p1.deletes.length);
  const p2 = v.trustPlan(s, { [A]: 1 }, new Set(), now + v.T2LH.WINDOW_MS);
  T('[3] the window passed: deleted from the board', !p2.writes.length && p2.deletes.length === 1 && p2.deletes[0] === A);
  const p3 = v.trustPlan({ players: {}, rep: {}, pairs: {} }, {}, new Set([A]), now);
  T('[3] no charges at all: nothing', !p3.writes.length && !p3.deletes.length);
}

// ---- [4] pass level ----
{
  const now = 100 * 86400000, pA = v.pid(A), pC = v.pid(C), pD = v.pid(D);
  const pass = (g, sg) => {
    const m = keyOf(g[0].d), gr = { groups: { [m]: g }, consistentMatches: [], inconsistentGroups: [{ m, g }] };
    const res = v.applyTeam2LoneDissent(gr, sg, new Set(), now, vecOf);
    return { m, gr, res };
  };
  const fresh = () => ({ players: {}, flagged: {}, t2ld: {} });
  const ch = (sx) => ((sx.t2lh || {})[pA] || []);   // the host's charges (none: empty)
  // a) an opposing seat drops out: the host is charged, touched
  const g = recsOf(match(6, 0x400, R4, { 2: { rank: 0 } }));
  const sa = fresh(); const a = pass(g, sa);
  T('[4a] opposing lone dissent: one charge on the host', ch(sa).length === 1 && ch(sa)[0].m === a.m && ch(sa)[0].v.join() === pC && a.res.hosts === 1 && a.res.hostsAt === 0);
  T('[4a] the host is a trust candidate this run; lh still counts', a.res.touched.indexOf(A) >= 0 && (sa.players[pA] || {}).lh === 1 && !(sa.players[pA] || {}).f);
  // b) the same records again: sticky verdict, no second charge
  const b = pass(g, sa);
  T('[4b] rerun: no second charge', ch(sa).length === 1 && ch(sa)[0].v.length === 1 && b.res.hosts === 0);
  // c) own side: the host's teammate drops out -- the host is not charged
  const sc = fresh(); pass(recsOf(match(6, 0x401, R4, { 1: { rank: 0 } })), sc);
  T('[4c] own-side dissent: no charge', !(sc.t2lh || {})[pA] && (sc.t2ld[v.pid(B)] || []).length === 1);
  // d) the host wrote nothing: not charged here (the absent-seat / orphan verdicts judge him)
  const sd = fresh(); pass(recsOf(match(6, 0x402, R4, { 2: { rank: 0 } }, [0])), sd);
  T('[4d] host record missing: the victim struck, the host not charged', (sd.t2ld[pC] || []).length === 1 && !(sd.t2lh || {})[pA]);
  // e) the whole opposing team refuses (Q56 shape): one entry with both, counts once
  const se = fresh(); const e = pass(recsOf(match(6, 0x403, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), se);
  T('[4e] team dissent: one entry, both victims, count 1', ch(se).length === 1 && ch(se)[0].v.slice().sort().join() === [pC, pD].sort().join() && v.hostDissentCount(ch(se), now) === 1 && e.res.hosts === 1);
  // f) a refusal landing a run later beside a stored one joins the same entry
  const sf = fresh(); const gf = recsOf(match(6, 0x404, R4, { 2: { rank: 0 }, 3: { rank: 0 } }));
  pass(gf.filter(r => r.steamID !== D), sf);
  pass(gf, sf);
  T('[4f] a late teammate joins the entry', ch(sf).length === 1 && ch(sf)[0].v.slice().sort().join() === [pC, pD].sort().join());
  // g) a wholly different dissenter later (Q51: no strike) charges nobody
  const sg = fresh(); const gg = recsOf(match(6, 0x405, R4, { 3: { rank: 0 } }));
  sg.t2lv = { [keyOf(gg[0].d)]: { p: pC, t: now - 1000, v: 'free' } };
  pass(gg, sg);
  T('[4g] no fresh strike: no charge', !(sg.t2lh || {})[pA] && !(sg.t2ld[pD] || []).length);
  // h) the third distinct charge reaches the threshold
  const sh = fresh();
  sh.t2lh = { [pA]: [{ m: 'x1', t: now - 5000, v: [v.pid(E)] }, { m: 'x2', t: now - 4000, v: [v.pid(F)] }] };
  const h = pass(g, sh);
  T('[4h] third distinct charge: at the threshold', h.res.hosts === 1 && h.res.hostsAt === 1 && v.hostDissentCount(ch(sh), now) === 3);
  // i) 3v3: three colluders (A = the true host, B, F) write a fake roster naming the honest teammate C at seat 0 and A
  //    at the absent E's seat; C writes the true one; the opposing D is cut and refuses. The consensus names C the
  //    host and the agreeing side holds his record, so the first draft charged him (three such matches put him on the
  //    trust board). C's own record sits at seat 2 and D's own record names A at seat 0: nobody is charged
  const real = [A, B, C, D, E, F], fake = [C, B, E, D, A, F];
  const one = (sid, roster, o, mt, hash) => ({ sid, d: t2(mt || 9, hash || 0x406, roster.indexOf(sid), roster, o) });
  const si = fresh(); const i = pass(recsOf([one(A, fake), one(B, fake), one(F, fake), one(C, real), one(D, real, { rank: 0 })]), si);
  T('[4i] framed teammate: the dissent is still struck', (si.t2ld[pD] || []).length === 1 && i.res.free === 1, JSON.stringify(i.res));
  T('[4i] framed teammate: nobody charged', !Object.keys(si.t2lh || {}).length && i.res.hosts === 0, JSON.stringify(si.t2lh));
  // j) the other way round: the modded host A moves his own record to the absent E's seat (his roster swaps the two);
  //    every other record names A at seat 0 -> charged all the same
  const sj = fresh(); const j = pass(recsOf([one(A, [E, B, C, D, A, F]), one(B, real), one(C, real), one(F, real), one(D, real, { rank: 0 })]), sj);
  T('[4j] host record moved to an empty seat: still charged', ch(sj).length === 1 && ch(sj)[0].v.join() === pD && j.res.hosts === 1 && (sj.t2ld[pD] || []).length === 1, JSON.stringify(j.res));
  // k) his own record at seat 0 is enough: a teammate's roster naming somebody else at seat 0 shields nobody
  const sk = fresh(); const k = pass(recsOf([one(A, R4, null, 6, 0x407), one(B, [G, B, C, D], null, 6, 0x407), one(D, R4, null, 6, 0x407), one(C, R4, { rank: 0 }, 6, 0x407)]), sk);
  T('[4k] host record at seat 0, a contrary teammate roster: charged', ch(sk).length === 1 && ch(sk)[0].v.join() === pC && k.res.hosts === 1, JSON.stringify(k.res));
  // l) team2HostOwnsSeat0 alone (only seat, roster seat 0 and the writer are read)
  const rec = (sid, seat, r0) => ({ steamID: sid, d: [0xB1, 3, 6, 1, 1, seat], roster: r0 === undefined ? {} : { 0: r0 } });
  const own0 = v.team2HostOwnsSeat0;
  T('[4l] no roster host, or the host wrote nothing: not charged', !own0({ host: null, rest: [rec(A, 0, A)], ds: [] }) && !own0({ host: A, rest: [rec(B, 1, A), rec(D, 3, A)], ds: [{ recs: [rec(C, 2, A)] }] }));
  T('[4l] his own record at seat 0: charged, whatever the others name', own0({ host: A, rest: [rec(A, 0, A), rec(B, 1, G)], ds: [{ recs: [rec(C, 2, G)] }] }));
  T('[4l] his own record elsewhere: charged only when every other record naming seat 0 names him',
    own0({ host: A, rest: [rec(A, 4, E), rec(B, 1, A)], ds: [{ recs: [rec(C, 2, A)] }] }) &&
    !own0({ host: A, rest: [rec(A, 4, E), rec(B, 1, A)], ds: [{ recs: [rec(C, 2, B)] }] }) &&
    !own0({ host: A, rest: [rec(A, 4, E), rec(B, 1, G)], ds: [{ recs: [rec(C, 2, A)] }] }));
  T('[4l] a record without a seat-0 entry neither backs nor blocks', own0({ host: A, rest: [rec(A, 4, E), rec(B, 1, A), rec(F, 5)], ds: [{ recs: [rec(C, 2, A)] }] }));
}

// ---- [5] a modded host cuts three different opponents in three matches ----
let r5;
{
  const sum = path.join(os.tmpdir(), 'team2-host-sum-' + process.pid + '.md');
  try { fs.unlinkSync(sum); } catch (e) {}
  const r1 = runMatch(null, 6, 0x500, [A, B, C, D], { 2: { rank: 0 } });
  T('[5] run 1 exits 0', r1.code === 0, r1.out.slice(-800));
  T('[5] run 1: victim C struck (free, not a leaver), the host charged once, no trust write', strikesOf(r1, C) === 1 && leavesOf(r1, C) === 0 && chargesOf(r1, A).length === 1 && posts(r1, TRUST).length === 0);
  T('[5] run 1: logged', /team2 dissent host .*charged for 1 opposing seat\(s\) -> 1 in window/.test(r1.out) && /team2 dissent hosts: 1 charges, 0 at the trust threshold/.test(r1.out));
  const r2 = runMatch(r1, 6, 0x501, [A, B, E, F], { 2: { rank: 0 } });
  T('[5] run 2: victim E struck once, two charges, still no trust write', strikesOf(r2, E) === 1 && chargesOf(r2, A).length === 2 && posts(r2, TRUST).length === 0);
  r5 = runMatch(r2, 6, 0x502, [A, B, G, H], { 3: { rank: 0 } });
  T('[5] run 3: the host reaches the threshold: tier 1 on the trust board', scoreTo(r5, TRUST, A) === 1, r5.out.slice(-800));
  T('[5] run 3: only the host is written to the trust board', posts(r5, TRUST).length === 1);
  T('[5] the victims each keep one free strike, none is a leaver', [C, E, H].every(s => strikesOf(r5, s) === 1 && leavesOf(r5, s) === 0 && fOf(r5, s) === 1));
  T('[5] the host is not flagged, no strike on him', fOf(r5, A) === 0 && strikesOf(r5, A) === 0 && lhOf(r5, A) === 3);
  T('[5] logged at the threshold', /-> 3 in window \(trust threshold\)/.test(r5.out) && /trust: 1 tier writes/.test(r5.out));
  const r5s = runCron(boardsWith([], [A, B, C, D, E, F, G, H], { [A]: 1 }), advance(r5.state, 60000), { GITHUB_STEP_SUMMARY: sum });
  const md = fs.existsSync(sum) ? fs.readFileSync(sum, 'utf8') : '';
  T('[5] step summary row present', /\| team-gamble host charges \/ at trust threshold \| 0\/0 \|/.test(md), md.slice(0, 400));
  T('[5] a quiet run after (the board holds tier 1): nothing written or deleted', posts(r5s, TRUST).length === 0 && trustDel(r5s).length === 0, r5s.out.slice(-600));
  try { fs.unlinkSync(sum); } catch (e) {}
}

// ---- [6] an honest host hit once ----
{
  const r = runMatch(null, 6, 0x600, [A, B, C, D], { 3: { rank: 0 } });
  T('[6] charged once, not on the trust board', chargesOf(r, A).length === 1 && posts(r, TRUST).length === 0 && fOf(r, A) === 0, r.out.slice(-600));
}

// ---- [7] one dodger blocking three times in the same honest host's matches ----
{
  let r = null;
  for (let i = 0; i < 3; i++) r = runMatch(r, 6, 0x700 + i, [A, B, C, D], { 2: { rank: 0 } });
  T('[7] three entries, one victim: counts once, the host never on the trust board', chargesOf(r, A).length === 3 && v.hostDissentCount(chargesOf(r, A), Date.now()) === 1 && scoreTo(r, TRUST, A) == null, r.out.slice(-600));
  T('[7] the dodger himself reaches tier 1 through his three flags (as before Q57)', scoreTo(r, TRUST, C) === 1 && fOf(r, C) === 3);
  T('[7] the dodger: three strikes against one opposing host, still free (Q51)', strikesOf(r, C) === 3 && leavesOf(r, C) === 0);
}

// ---- [8] the charges age out ----
{
  const files = advance(r5.state, v.T2LH.WINDOW_MS + 60000);
  const r = runCron(boardsWith([], [A, B, C, D, E, F, G, H], { [A]: 1 }), files);
  T('[8] past the window: the host is deleted from the trust board', trustDel(r).some(p => new RegExp('steamid=' + A + '(&|$)').test(p.body)) && posts(r, TRUST).length === 0, r.out.slice(-600));
  const sp = JSON.parse(JSON.stringify(files.SIGNALS_FILE)); const at = Date.now();
  v.pruneSignals(sp, at);
  T('[8] pruneSignals drops the aged charges (saved with the next dirty run)', !((sp.t2lh || {})[v.pid(A)]) && Object.keys(files.SIGNALS_FILE.t2lh || {}).length === 1);
}

// ---- [9] wiring pins ----
{
  T('[9] exports', typeof v.hostDissentCount === 'function' && v.T2LH && v.T2LH.WINDOW_MS === 30 * 86400000);
  const plan = SRC.slice(SRC.indexOf('function trustPlan'), SRC.indexOf('function recordMatchSignals'));
  T('[9] trustPlan feeds the host charges at the given time', /hostDissentCount\(\(s\.t2lh \|\| \{\}\)\[p\], now/.test(plan));
  const prune = SRC.slice(SRC.indexOf('function pruneSignals'), SRC.indexOf('function saveSignals'));
  T('[9] pruneSignals ages s.t2lh', /s\.t2lh/.test(prune) && /T2LH\.WINDOW_MS/.test(prune));
  const passSrc = SRC.slice(SRC.indexOf('function applyTeam2LoneDissent'), SRC.indexOf('function leaverLpPenalty'));
  T('[9] the pass charges only fresh opposing seats with the records backing the host', /fresh\.filter\(d => d\.opp\)/.test(passSrc) && /vic\.length && team2HostOwnsSeat0\(td\)/.test(passSrc) && /res\.touched\.push\(td\.host\)/.test(passSrc));
  T('[9] main counts it in the run summary', /RUN\.t2lh = t2ldRes\.hosts/.test(SRC));
}

if (failN) { console.log('team2-host-dissent: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-host-dissent: all passed');
