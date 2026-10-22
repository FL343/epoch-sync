'use strict';
// Gamble-frame refusals that name the host (cloud audit Q61, the Q43 review's residual 4): after Q41 a joiner takes a
// gamble-station frame it can prove wrong (slot / roulette / cups) back out of that seat's score, so the match's
// records disagree and it never settles -- and the inconsistent path flagged every writer, the joiners who refused a
// modded host's forged frame as much as the host. The Q61 client appends a self-describing block at the end of its
// record, after the 5.4a char block ([GT_MAGIC | GT_VER << 8 | GT_LEN << 16, seat mask]; the settle-tail rule, Q43's
// fixed-offset T2BY int the one exception), naming the seat that forwarded the refused frame. This pass reads it on
// matchmade FFA / team-brawl codes: when every other seat names that seat (one record per account, all above him on
// the roster, one vector among them, from two queue units or more) the key is a strike on him -- only he is flagged;
// two strikes in 30 days by writers who share nobody make the verdict 'judge', record only.
//   [1] the block reader (gambleTagOf: walks Q43's int, the char block, other blocks) and the unit of a seat (gambleUnitOf)
//   [2] detector shapes (gambleAccusation): the strike shape, and every shape that keeps the old path
//   [3] verdict rule (gtacVerdict)
//   [4] one strike (quick FFA 4P, the host forged his own slot): not settled, only the host flagged; the same records
//       without the tag (an older client) flag every writer as before; at maturity the orphan verdict ends it
//   [5] a second strike by a crew that shares nobody with the first: judged, record only (no leave, no points)
//   [6] the same crew twice: free; two strikes overlapping in one writer: free
//   [7] a seat with no record: held (nobody flagged) until the absence grace, then struck; a late untagged record
//       written the host's way keeps the old path
//   [8] framing shapes that keep the old path: one party names its host; writers below the named seat (the host
//       among them) name a joiner; a 2P match (one writer names: no strike, and since Q289 nobody flagged); ranked team
//       brawl with a team naming the host alone
//   [9] codes outside this pass (true 2v2, friends' room): the tag changes nothing
//   [10] wiring pins, pruneSignals
//   [11] the state stays bounded: strikes kept per account, a verdict goes with its key's flag, a hold with its key
//   [12] mutation self-checks (each key rule removed -> its scenario goes red)
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamble-accuse-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned: ranked points go to 'points' (season boards start later)
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
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
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
    for (const k of Object.keys(sg.gtac || {})) for (const e of sg.gtac[k]) e.t -= ms;
    for (const k of Object.keys(sg.gtav || {})) sg.gtav[k].t -= ms;
    for (const k of Object.keys(sg.gtah || {})) sg.gtah[k] -= ms;
  }
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const spOf = (r, sid) => (sigOf(r).players || {})[v.pid(sid)] || {};
const strikesOf = (r, sid) => ((sigOf(r).gtac || {})[v.pid(sid)] || []).length;
const verdictOf = (r, m) => (sigOf(r).gtav || {})[m] || null;
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const G = '76561198000000007', H = '76561198000000008', I = '76561198000000009';
const ALL = [A, B, C, D, E, F, G, H, I];
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
const T2BY = 0x74320000;
const GTH = 0xDB | (1 << 8) | (1 << 16);   // the Q61 block's head: magic 0xDB, version 1, length 1 (client GTBY_MAGIC / VER / LEN)
// the 5.4a char block the client writes on every settle record (codes 1-4 by seat)
const charBlk = (pc) => { const out = [0xD8 | (1 << 8) | (pc << 16)]; for (let i = 0; i < pc; i += 4) { let w = 0; for (let j = 0; j < 4 && i + j < pc; j++) w |= (1 + ((i + j) & 3)) << (8 * j); out.push(w | 0); } return out; };
// one settle record: scores = this writer's vector; rank from `ranked` (the adopted table, as the client ranks); o.t2 = Q43's
//   int (right after the roster), then the char block (o.noChar: none), then o.gt = the Q61 block (o.gtRaw: raw words instead)
function rec(mt, hash, seat, roster, scores, ranked, o) {
  o = o || {};
  const pc = roster.length;
  const order = ranked.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const rank = o.rank != null ? o.rank : 1 + order.findIndex(x => x[1] === seat);
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (rank === 1 ? 1 : 0), pc, 900].concat(scores, [o.disp | 0]);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  if (o.t2) d.push(T2BY | o.t2);
  if (!o.noChar) d.push(...charBlk(pc));
  if (o.gtRaw) d.push(...o.gtRaw);
  if (o.gt) d.push(GTH, o.gt);
  return d;
}
const BASE4 = [6000, 5000, 4000, 3000];
// a match where `hostSeat` forwarded a forged gamble frame for seat `onSeat` (+`amt` in the host's table): every seat in
//   `acc` takes it back and names hostSeat; `plain` seats write the host's table untagged; `skip` seats write nothing
function forged(mt, hash, roster, o) {
  o = o || {};
  const pc = roster.length, h = o.host | 0, on = o.on == null ? h : o.on, amt = o.amt == null ? 30000 : o.amt;
  const base = o.base || BASE4.slice(0, pc).concat([2500, 2000]).slice(0, pc);
  const hostTable = base.slice(); hostTable[on] += amt;
  const out = [];
  roster.forEach((sid, seat) => {
    if (o.skip && o.skip.indexOf(seat) >= 0) return;
    const accuses = seat !== h && (o.acc ? o.acc.indexOf(seat) >= 0 : true) && !(o.plain && o.plain.indexOf(seat) >= 0);
    const tagBits = (o.tagFor && o.tagFor[seat] != null) ? o.tagFor[seat] : (1 << h);
    const vec = accuses ? (o.vecFor && o.vecFor[seat] ? o.vecFor[seat] : base) : hostTable;
    out.push({ sid, d: rec(mt, hash, seat, roster, vec, hostTable, accuses && !o.noTag ? { gt: tagBits } : {}) });
  });
  return out;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
function startOf(mt, roster, ago) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [] };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const R4 = [A, B, C, D];   // seat 0 = A, the host
const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const recsOf = (list) => list.map(x => ({ steamID: x.sid, d: x.d, dispCode: x.d[10 + (x.d[8] | 0)] | 0, roster: v.decodeRoster(x.d) }));

// ---- [1] the tag reader, the unit of a seat ----
{ try {
  T('[1] GT_MAGIC / GT_VER / GT_LEN = client result-reporter.js GTBY_MAGIC / VER / LEN (0xDB / 1 / 1)', v.GT_MAGIC === 0xDB && v.GT_VER === 1 && v.GT_LEN === 1);
  T('[1] defaults: 2 writers, 2 queue units, K 2, window 30 days, bases 1-4', v.GTAC.MIN_ACC === 2 && v.GTAC.MIN_UNITS === 2 && v.GTAC.K === 2 && v.GTAC.WINDOW_MS === 30 * 86400000 && JSON.stringify(v.GTAC.BASES) === '[1,2,3,4]');
  const r0 = { d: rec(1, 1, 2, R4, BASE4, BASE4, { gt: 0b0001 }) };
  T('[1] the block after the char block names seat 0', v.gambleTagOf(r0) === 0b0001);
  T('[1] after a T2BY int and the char block', v.gambleTagOf({ d: rec(5, 1, 2, R4, BASE4, BASE4, { t2: 0b0001, gt: 0b0010 }) }) === 0b0010);
  T('[1] no char block (the block right after the roster)', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { noChar: true, gt: 0b0001 }) }) === 0b0001);
  const R6 = [A, B, C, D, E, F], B6 = [6000, 5000, 4000, 3000, 2500, 2000];
  T('[1] 6 seats: past a two-word char block', v.gambleTagOf({ d: rec(1, 1, 5, R6, B6, B6, { gt: 0b000001 }) }) === 0b000001);
  T('[1] its own seat is never named', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gt: 0b0101 }) }) === 0b0001);
  T('[1] seats past the seat count are not named', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gt: 0b110001 }) }) === 0b0001);
  T('[1] no block / a T2BY int alone / the char block alone / another int: nobody', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { noChar: true }) }) === 0
    && v.gambleTagOf({ d: rec(5, 1, 2, R4, BASE4, BASE4, { t2: 1, noChar: true }) }) === 0 && v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4) }) === 0
    && v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4).concat([12345]) }) === 0);
  T('[1] another block before it is skipped by its length', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0xE7 | (1 << 8) | (2 << 16), 11, 22], gt: 0b0001 }) }) === 0b0001);
  T('[1] a version it does not know: nobody (and skipped by its length)', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0xDB | (2 << 8) | (1 << 16), 0b0001] }) }) === 0
    && v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0xDB | (2 << 8) | (2 << 16), 0b0010, 0], gt: 0b0001 }) }) === 0b0001);
  T('[1] a truncated block (head only) / a word of length 0 before it: nobody', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [GTH] }) }) === 0
    && v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0x1234], gt: 0b0001 }) }) === 0);
  T('[1] Q61 v2\'s bare int after the roster (never shipped): nobody', v.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { noChar: true, gtRaw: [0x67740001] }) }) === 0
    && v.gambleTagOf({ d: rec(5, 1, 2, R4, BASE4, BASE4, { t2: 1, noChar: true, gtRaw: [0x67740001] }) }) === 0);
  const pairMt = 1 | (0b10 << 4), trioMt = 1 | (2 << 8);   // pair at seats 2-3 / trio at seats 1-3
  T('[1] units: FFA solo seats apart, a premade pair / trio is one, a team code by team',
    v.gambleUnitOf(1, 1) !== v.gambleUnitOf(1, 2) && v.gambleUnitOf(pairMt, 2) === v.gambleUnitOf(pairMt, 3) && v.gambleUnitOf(pairMt, 1) !== v.gambleUnitOf(pairMt, 2)
    && v.gambleUnitOf(trioMt, 1) === v.gambleUnitOf(trioMt, 3) && v.gambleUnitOf(3, 0) === v.gambleUnitOf(3, 1) && v.gambleUnitOf(3, 1) !== v.gambleUnitOf(3, 2));
} catch (e) { bad('[1] threw: ' + (e && e.message)); } }

// ---- [2] detector shapes ----
const shape = (list) => v.gambleAccusation(recsOf(list), vecOf);
{ try {
  const s0 = shape(forged(1, 0x200, R4));
  T('[2] host A forged his own slot, B C D name him: strike shape on seat 0, nobody absent', s0 && !s0.why && s0.h === 0 && s0.host.steamID === A && s0.acc.length === 3 && s0.absent.length === 0, JSON.stringify(s0 && s0.why));
  const s1 = shape(forged(1, 0x201, R4, { on: 3 }));
  T('[2] the forged win on another seat (a friend\'s): the same strike shape', s1 && !s1.why && s1.h === 0);
  const s2 = shape(forged(2, 0x202, R4, { amt: -20000, on: 2 }));
  T('[2] ranked, a forged loss for a joiner: strike shape', s2 && !s2.why && s2.h === 0);
  const s3 = shape(forged(3, 0x203, R4));
  T('[2] quick team brawl: strike shape (the host\'s teammate and the other team name him)', s3 && !s3.why);
  const R3 = [A, B, C];
  T('[2] 3P: strike shape with two writers', (() => { const s = shape(forged(1, 0x204, R3)); return s && !s.why && s.acc.length === 2; })());
  const mig = shape(forged(1, 0x205, R4, { host: 1, skip: [0] }));
  T('[2] migrated host (seat 0 gone, seat 1 hosting): strike shape on seat 1, seat 0 absent', mig && !mig.why && mig.h === 1 && JSON.stringify(mig.absent) === '[0]');
  const hold = shape(forged(1, 0x206, R4, { skip: [3] }));
  T('[2] a seat with no record: strike shape with it absent (the pass holds)', hold && !hold.why && JSON.stringify(hold.absent) === '[3]');
  T('[2] no record names anybody: not this pass\'s', shape(forged(1, 0x207, R4, { noTag: true })) === null);
  const why = (s) => (s && s.why) || '';
  T('[2] one writer agrees with the host untagged: old path', /records name nobody/.test(why(shape(forged(1, 0x208, R4, { plain: [3] })))));
  T('[2] the host wrote no record: old path', /every record names somebody/.test(why(shape(forged(1, 0x209, R4, { skip: [0], tagFor: { 1: 1, 2: 1, 3: 1 } })))));
  T('[2] one writer names him (the others gone): old path', /one writer names him/.test(why(shape(forged(1, 0x20A, R4, { skip: [2, 3] })))));
  T('[2] the writers name different seats: old path', /different seats/.test(why(shape(forged(1, 0x20B, R4, { tagFor: { 1: 0b0001, 2: 0b0001, 3: 0b0010 } })))));
  const below = forged(1, 0x20C, R4, { host: 2, tagFor: { 0: 0b0100, 1: 0b0100, 3: 0b0100 } });
  T('[2] writers below the named seat name him (a modded host and a friend name a joiner): old path', /not above the named seat/.test(why(shape(below))));
  T('[2] the writers who name him disagree among themselves: old path', /disagree among themselves/.test(why(shape(forged(1, 0x20D, R4, { vecFor: { 3: [6000, 5000, 4000, 2999] } })))));
  const pairMt = 1 | (0b10 << 4);
  T('[2] FFA: only the premade pair at seats 2-3 names him (seat 1 gone): old path', /queued as 1 unit/.test(why(shape(forged(pairMt, 0x20E, R4, { skip: [1] })))));
  T('[2] FFA: the pair and the solo seat 1 name him: strike shape', (() => { const s = shape(forged(pairMt, 0x20F, R4)); return s && !s.why; })());
  T('[2] team brawl: only the other team names him (his teammate gone): old path', /queued as 1 unit/.test(why(shape(forged(4, 0x210, R4, { skip: [1] })))));
  const big = [500000, 400000, 300000, 200000];
  T('[2] the writers who name him out of sanity bounds: old path', /sanity/.test(why(shape(forged(1, 0x211, R4, { base: big })))));
  const dupL = forged(1, 0x212, R4); dupL.push({ sid: B, d: rec(1, 0x212, 1, R4, [36000, 5000, 4000, 3000], [36000, 5000, 4000, 3000]) });
  T('[2] a writer\'s second record (untagged, the host\'s table) after his first: the first counts', (() => { const s = shape(dupL); return s && !s.why; })());
  T('[2] true 2v2 / friends\' room / bot match / endless codes: not this pass\'s',
    [5, 6, 8, 10, 11].every(mt => shape(forged(mt, 0x213, mt === 8 ? [A, B, C, D, E, F] : R4)) === null));
} catch (e) { bad('[2] threw: ' + (e && e.message)); } }

// ---- [3] verdict rule ----
{ try {
  const now = 100 * 86400000, W = v.GTAC.WINDOW_MS;
  const s = (m, ago, a) => ({ m, t: now - ago, a: a.map(x => v.pid(x)) });
  T('[3] first strike: free', v.gtacVerdict([], s('x', 0, [B, C]), now) === 'free');
  T('[3] a second strike by writers who share nobody, inside the window: judge', v.gtacVerdict([s('a', 86400000, [B, C])], s('x', 0, [D, E]), now) === 'judge');
  T('[3] ... sharing one writer: free', v.gtacVerdict([s('a', 86400000, [B, C])], s('x', 0, [C, E]), now) === 'free');
  T('[3] ... older than the window: free', v.gtacVerdict([s('a', W + 1000, [B, C])], s('x', 0, [D, E]), now) === 'free');
  T('[3] the same key stored before is not counted twice', v.gtacVerdict([s('x', 1000, [B, C])], s('x', 0, [D, E]), now) === 'free');
  T('[3] one of three earlier strikes shares nobody with this one: judge', v.gtacVerdict([s('a', 3000, [D, B]), s('b', 2000, [C, E]), s('c', 1000, [F, G])], s('x', 0, [D, E]), now) === 'judge');
} catch (e) { bad('[3] threw: ' + (e && e.message)); } }

// ---- [4] one strike, quick FFA 4P ----
let r4;
{ try {
  const recs = forged(1, 0x400, R4);
  const m = keyOf(recs[0].d);
  r4 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } });
  T('[4] run exits 0', r4.code === 0, r4.out.slice(-800));
  T('[4] not settled, nothing written', !processedOf(r4).has(m) && posts(r4, RATING).length === 0 && posts(r4, PROGRESS).length === 0);
  T('[4] only the host is flagged', fOf(r4, A) === 1 && [B, C, D].every(s => fOf(r4, s) === 0), 'f=' + R4.map(s => fOf(r4, s)).join(','));
  T('[4] one strike on him, verdict free; gs on his signals, no gx', strikesOf(r4, A) === 1 && verdictOf(r4, m) && verdictOf(r4, m).v === 'free' && (spOf(r4, A).gs | 0) === 1 && (spOf(r4, A).gx | 0) === 0);
  T('[4] the strike remembers the three writers', JSON.stringify(sigOf(r4).gtac[v.pid(A)][0].a) === JSON.stringify([B, C, D].map(x => v.pid(x)).sort()));
  T('[4] record only: ga 1 on each writer who named him, none on him', [B, C, D].every(s => (spOf(r4, s).ga | 0) === 1) && (spOf(r4, A).ga | 0) === 0);
  T('[4] logged', /gamble accusation .*: 3 writers \(seat 1,2,3\) name seat 0 = .* -> strike, verdict free; only he is flagged/.test(r4.out) && /gamble accusations: 1 strikes \(0 judged, record only\), 0 deferred, 0 not counted/.test(r4.out));
  T('[4] run summary row', /\| gamble-frame refusals naming the host \(Q61\)[^|]*\| 1 \/ 0 \/ 0 \/ 0 \|/.test(r4.summary), r4.summary.split('\n').filter(l => /Q61/.test(l)).join(' '));
  const again = runCron(boardsWith(recs), advance(r4.state, 60000));
  T('[4] the next run: no new strike, nobody else flagged, no second ga', strikesOf(again, A) === 1 && fOf(again, A) === 1 && [B, C, D].every(s => fOf(again, s) === 0 && (spOf(again, s).ga | 0) === 1) && (spOf(again, A).gs | 0) === 1 && !/-> strike/.test(again.out));
  const mature = runCron(boardsWith(recs), advance(r4.state, v.STARTS_MATURITY_MS + 60000));
  T('[4] at maturity the orphan verdict ends it, no exit-rate hit (everyone wrote a record)', processedOf(mature).has(m) && R4.every(s => leavesOf(mature, s) === 0), mature.out.slice(-600));
  T('[4] ... nothing rated, flags unchanged', posts(mature, RATING).length === 0 && fOf(mature, A) === 1 && [B, C, D].every(s => fOf(mature, s) === 0));
  // the same records from an older client (no tag): every writer flagged, nobody struck (the old path, unchanged)
  const old = forged(1, 0x401, R4, { noTag: true });
  const mo = keyOf(old[0].d);
  const ro = runCron(boardsWith(old), { STARTS_FILE: { [mo]: startOf(1, R4, FLOOR + 5 * 60000) } });
  T('[4] control: the same match without the tag flags every writer, no strike', R4.every(s => fOf(ro, s) === 1) && !Object.keys(sigOf(ro).gtac || {}).length && !/gamble accusation/.test(ro.out));
} catch (e) { bad('[4] threw: ' + (e && e.message)); } }

// ---- [5] a second strike by a crew that shares nobody: judged, record only ----
let r5;
{ try {
  const RX = [A, E, F, G];   // A hosts again; E F G share nobody with B C D
  const recs = forged(2, 0x500, RX);
  const m = keyOf(recs[0].d);
  const files = advance(r4.state, 3 * 86400000);
  files.STARTS_FILE = { [m]: startOf(2, RX, FLOOR + 5 * 60000) };
  files.PROCESSED_FILE = [];
  r5 = runCron(boardsWith(recs), files);
  T('[5] run exits 0', r5.code === 0, r5.out.slice(-800));
  T('[5] verdict judge, two strikes, gx 1', verdictOf(r5, m) && verdictOf(r5, m).v === 'judge' && strikesOf(r5, A) === 2 && (spOf(r5, A).gx | 0) === 1, JSON.stringify(verdictOf(r5, m)));
  T('[5] record only: not settled, no leave, no points or rating written', !processedOf(r5).has(m) && leavesOf(r5, A) === 0 && posts(r5, POINTS).length === 0 && posts(r5, RATING).length === 0);
  T('[5] only the host is flagged (twice now)', fOf(r5, A) === 2 && [E, F, G].every(s => fOf(r5, s) === 0));
  T('[5] logged as judged', /-> strike, verdict judge \(record only\)/.test(r5.out));
} catch (e) { bad('[5] threw: ' + (e && e.message)); } }

// ---- [6] the same crew twice / overlapping crews: free ----
{ try {
  const recs1 = forged(1, 0x600, [H, B, C, D]);
  const recs2 = forged(1, 0x601, [H, B, C, D]);
  const m1 = keyOf(recs1[0].d), m2 = keyOf(recs2[0].d);
  const r1 = runCron(boardsWith(recs1.concat(recs2)), { STARTS_FILE: { [m1]: startOf(1, [H, B, C, D], FLOOR + 20 * 60000), [m2]: startOf(1, [H, B, C, D], FLOOR + 10 * 60000) } });
  T('[6] the same three writers twice: two strikes, both free', strikesOf(r1, H) === 2 && verdictOf(r1, m1).v === 'free' && verdictOf(r1, m2).v === 'free' && (spOf(r1, H).gx | 0) === 0, JSON.stringify([verdictOf(r1, m1), verdictOf(r1, m2)]));
  const recs3 = forged(1, 0x602, [H, D, E, F]);   // shares D with the earlier crew
  const m3 = keyOf(recs3[0].d);
  const f3 = advance(r1.state, 86400000);
  f3.STARTS_FILE = Object.assign({}, f3.STARTS_FILE, { [m3]: startOf(1, [H, D, E, F], FLOOR + 5 * 60000) });
  const r3 = runCron(boardsWith(recs3), f3);
  T('[6] a third crew sharing one writer with both earlier ones: free', verdictOf(r3, m3) && verdictOf(r3, m3).v === 'free' && (spOf(r3, H).gx | 0) === 0, JSON.stringify(verdictOf(r3, m3)));
} catch (e) { bad('[6] threw: ' + (e && e.message)); } }

// ---- [7] a seat with no record: held, then struck; a late untagged record keeps the old path ----
{ try {
  const recs = forged(1, 0x700, R4, { skip: [3] });
  const m = keyOf(recs[0].d);
  const r1 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } });
  T('[7] first run: held, nobody flagged, no strike', R4.every(s => fOf(r1, s) === 0) && !strikesOf(r1, A) && /seat\(s\) 3 wrote no record -- grace \d+s left, strike deferred/.test(r1.out), r1.out.slice(-600));
  T('[7] ... the hold stamped', (sigOf(r1).gtah || {})[m] > 0);
  const r2 = runCron(boardsWith(recs), advance(r1.state, v.ABSENT_GRACE_MS + 60000));
  T('[7] past the grace: struck, only the host flagged', strikesOf(r2, A) === 1 && fOf(r2, A) === 1 && [B, C, D].every(s => fOf(r2, s) === 0) && /\(seat 3 wrote no record\) -> strike/.test(r2.out), r2.out.slice(-600));
  T('[7] ... the hold cleared', !(sigOf(r2).gtah || {})[m]);
  const late = forged(1, 0x701, R4, { skip: [3] });
  const ml = keyOf(late[0].d);
  const l1 = runCron(boardsWith(late), { STARTS_FILE: { [ml]: startOf(1, R4, FLOOR + 5 * 60000) } });
  const withD = late.concat(forged(1, 0x701, R4, { plain: [3] }).filter(x => x.sid === D));
  const l2 = runCron(boardsWith(withD), advance(l1.state, 60000));
  T('[7] the absent seat\'s record comes in untagged, the host\'s way: no strike, every writer flagged (old path)', !strikesOf(l2, A) && R4.every(s => fOf(l2, s) === 1) && /not counted \(2 records name nobody\)/.test(l2.out), l2.out.slice(-600));
  // a read that is not complete (10 of 60 shards missing from the listing) never strikes for an absent seat, even past the grace
  const rd1 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } }, { LEDGER_SHARDS: '60' });
  const rd2 = runCron(boardsWith(recs), advance(rd1.state, v.ABSENT_GRACE_MS + 60000), { LEDGER_SHARDS: '60' });
  T('[7] an incomplete read holds, even past the grace: nobody flagged, no strike',
    [rd1, rd2].every(r => R4.every(s => fOf(r, s) === 0) && !strikesOf(r, A) && /wrote no record -- not every record shard was read this run, strike deferred/.test(r.out)), rd2.out.slice(-600));
} catch (e) { bad('[7] threw: ' + (e && e.message)); } }

// ---- [8] framing shapes keep the old path ----
{ try {
  const pairMt = 1 | (0b10 << 4);   // a premade pair at seats 2-3
  const p = forged(pairMt, 0x800, [A, B, C, D], { skip: [1] });
  const mp = keyOf(p[0].d);
  const rp = runCron(boardsWith(p), { STARTS_FILE: { [mp]: startOf(pairMt, R4, FLOOR + 5 * 60000) } });
  const rp2 = runCron(boardsWith(p), advance(rp.state, v.ABSENT_GRACE_MS + 60000));
  T('[8] one premade pair names its host (the third seat gone): never a strike, every writer flagged', !strikesOf(rp2, A) && [A, C, D].every(s => fOf(rp2, s) === 1), rp2.out.slice(-500));
  const below = forged(1, 0x801, R4, { host: 2, tagFor: { 0: 0b0100, 1: 0b0100, 3: 0b0100 } });
  const mb = keyOf(below[0].d);
  const rb = runCron(boardsWith(below), { STARTS_FILE: { [mb]: startOf(1, R4, FLOOR + 5 * 60000) } });
  T('[8] the host and two others name a joiner at seat 2 (writers below him): no strike, every writer flagged', !strikesOf(rb, C) && R4.every(s => fOf(rb, s) === 1) && /not counted \(a writer at seat 0 \(not above the named seat\) names him\)/.test(rb.out));
  const two = forged(1, 0x802, [A, B]);
  const m2 = keyOf(two[0].d);
  const r2 = runCron(boardsWith(two), { STARTS_FILE: { [m2]: startOf(1, [A, B], FLOOR + 5 * 60000) } });
  // a quick 1V1: one voice against the other cannot be judged -- no strike (one writer is not enough), and since Q289 nobody
  // flagged for the disagreement either (a dispute counted on both, test/pair-dispute-1v1.js)
  T('[8] 2P: one writer names the host: no strike, nobody flagged (Q289), the dispute counted on both', !strikesOf(r2, A) && fOf(r2, A) === 0 && fOf(r2, B) === 0 && /not counted \(one writer names him\)/.test(r2.out) && new RegExp('pair-dispute ' + m2 + ': ').test(r2.out) && [A, B].every(s => (((sigOf(r2).players || {})[v.pid(s)] || {}).pd | 0) === 1), r2.out.slice(-600));
  const tb = forged(4, 0x803, R4, { skip: [1] });
  const mt = keyOf(tb[0].d);
  const rt = runCron(boardsWith(tb), { STARTS_FILE: { [mt]: startOf(4, R4, FLOOR + 5 * 60000) } });
  const rt2 = runCron(boardsWith(tb), advance(rt.state, v.ABSENT_GRACE_MS + 60000));
  T('[8] ranked team brawl, only the other team names the host: no strike, every writer flagged', !strikesOf(rt2, A) && [A, C, D].every(s => fOf(rt2, s) === 1), rt2.out.slice(-500));
} catch (e) { bad('[8] threw: ' + (e && e.message)); } }

// ---- [9] codes outside this pass: the tag changes nothing ----
// (true 2v2 / 3V3 already have Q51's lone dissent: the host who alone writes his forged table is struck there, alone)
{ try {
  for (const mt of [5, 6, 10]) {
    const recs = forged(mt, 0x900 + mt, R4);
    const m = keyOf(recs[0].d);
    const files = { STARTS_FILE: { [m]: startOf(mt, R4, FLOOR + 5 * 60000) } };
    const r = runCron(boardsWith(recs), files);
    const ro = runCron(boardsWith(forged(mt, 0x900 + mt, R4, { noTag: true })), files);
    const fs1 = R4.map(s => fOf(r, s)).join(','), fs0 = R4.map(s => fOf(ro, s)).join(',');
    T('[9] code ' + mt + ': no strike, the same flags and the same settle as the same records without the tag (' + fs0 + ')',
      r.code === 0 && ro.code === 0 && !Object.keys(sigOf(r).gtac || {}).length && !/gamble accusation/.test(r.out)
      && fs1 === fs0 && processedOf(r).has(m) === processedOf(ro).has(m), 'tag ' + fs1 + ' / no tag ' + fs0 + ' -- ' + r.out.slice(-400));
  }
} catch (e) { bad('[9] threw: ' + (e && e.message)); } }

// ---- [10] wiring pins ----
{ try {
  const iPass = SRC.indexOf('applyGambleAccusations(gr, signals, processed, nowMs, vecOf, { complete: shardsComplete, graceMs: ABSENT_GRACE_MS })');
  const iFlag = SRC.indexOf('for (const { m, g } of inconsistentGroups) {');
  const iNow = SRC.indexOf('const nowMs = Date.now();'), iSig = SRC.indexOf('const signals = loadSignals();');
  const iTouched = SRC.indexOf('const trustTouched = new Set();');
  const iRun = SRC.indexOf('RUN.gtac = gtacRes.strikes', iPass);
  const between = SRC.slice(SRC.indexOf('\n', iRun) + 1, iFlag).split('\n').map(l => l.trim()).filter(Boolean);
  T('[10] the pass runs after signals load, nowMs and trustTouched, right before the inconsistent flag loop (nothing but comments between)',
    iPass > 0 && iSig < iPass && iNow < iPass && iTouched < iPass && iRun > iPass && iRun < iFlag && between.every(l => l.indexOf('//') === 0), JSON.stringify(between));
  T('[10] exports', v.GT_MAGIC === 0xDB && typeof v.gambleTagOf === 'function' && typeof v.gambleAccusation === 'function' && typeof v.gtacVerdict === 'function' && typeof v.applyGambleAccusations === 'function' && typeof v.oneRecordPerAccount === 'function' && typeof v.gambleUnitOf === 'function');
  const pr = SRC.slice(SRC.indexOf('function pruneSignals'), SRC.indexOf('function saveSignals'));
  T('[10] strikes, verdicts and holds age out in pruneSignals', /s\.gtac/.test(pr) && /s\.gtav/.test(pr) && /s\.gtah/.test(pr));
  const now = 100 * 86400000, many = Array.from({ length: 20 }, (_, i) => ({ m: 'k' + i, t: now - 1000 + i, a: [] }));
  const sg = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: { b: now - 1000, a: now - 1000 }, rep: {}, rseen: {},
    gtac: { x: [{ m: 'a', t: now - v.GTAC.WINDOW_MS - 1000, a: [] }], y: [{ m: 'b', t: now - 1000, a: [] }], z: many },
    gtav: { a: { p: 'x', t: now - 46 * 86400000, v: 'free' }, b: { p: 'y', t: now - 1000, v: 'free' }, c: { p: 'y', t: now - 1000, v: 'free' } },
    gtah: { c: now - 46 * 86400000, d: now - 1000 } };
  v.pruneSignals(sg, now);
  T('[10] pruneSignals: strikes past their window go, the live ones stay', !sg.gtac.x && sg.gtac.y);
  T('[10] pruneSignals: at most ' + v.GTAC.LIST_CAP + ' strikes kept per account, the newest', sg.gtac.z.length === v.GTAC.LIST_CAP && sg.gtac.z[0].m === 'k4' && sg.gtac.z[15].m === 'k19');
  T('[10] pruneSignals: a verdict stays while its key\'s flag does, goes with it (or past 45 days)', sg.gtav.b && !sg.gtav.c && !sg.gtav.a);
  T('[10] pruneSignals: a hold stamp past 45 days goes (backstop)', !sg.gtah.c && sg.gtah.d);
} catch (e) { bad('[10] threw: ' + (e && e.message)); } }

// ---- [11] the state stays bounded (Q166: a key written for one run must not leave entries behind) ----
const quiet = (fn) => { const l = console.log; console.log = () => {}; try { return fn(); } finally { console.log = l; } };
{ try {
  const sg0 = () => ({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} });
  const now = 200 * 86400000;
  const grOf = (lists) => ({ inconsistentGroups: lists.map(l => ({ m: keyOf(l[0].d), g: recsOf(l) })) });
  // one account named in 20 keys by one crew in one run: 16 strikes kept, every one counted once
  const sg = sg0();
  const keys = Array.from({ length: 20 }, (_, i) => forged(1, 0xB00 + i, R4));
  const r1 = quiet(() => v.applyGambleAccusations(grOf(keys), sg, new Set(), now, vecOf, { complete: true, graceMs: v.ABSENT_GRACE_MS }));
  T('[11] 20 strikes on one account in one run: 20 counted, ' + v.GTAC.LIST_CAP + ' kept, the newest', r1.strikes === 20 && sg.gtac[v.pid(A)].length === v.GTAC.LIST_CAP
    && (sg.players[v.pid(A)].gs | 0) === 20 && [B, C, D].every(x => (sg.players[v.pid(x)].ga | 0) === 20));
  // the same key seen again after its verdict left with its flag: struck (flag rebuilt), not counted twice
  //   (keys[0] is the run's last strike, so still among the 16 kept)
  const k0 = keyOf(keys[0][0].d);
  delete sg.flagged[k0]; v.pruneSignals(sg, now + 1000);
  T('[11] ... its flag gone, the verdict goes at the prune', !sg.gtav[k0] && Object.keys(sg.gtav).length === 19);
  const r2 = quiet(() => v.applyGambleAccusations(grOf([keys[0]]), sg, new Set(), now + 2000, vecOf, { complete: true, graceMs: v.ABSENT_GRACE_MS }));
  T('[11] ... the key back on the shards: struck again (verdict back), no second count, no second entry', r2.strikes === 1 && sg.gtav[k0]
    && (sg.players[v.pid(A)].gs | 0) === 20 && (sg.players[v.pid(B)].ga | 0) === 20 && sg.gtac[v.pid(A)].filter(e => e.m === k0).length === 1);
  // a hold stamp lives while its key is held: kept on a read that is not complete, dropped on a complete read without it
  const sh = sg0();
  const held = forged(1, 0xC00, R4, { skip: [3] }), mh = keyOf(held[0].d);
  quiet(() => v.applyGambleAccusations(grOf([held]), sh, new Set(), now, vecOf, { complete: true, graceMs: v.ABSENT_GRACE_MS }));
  const stamped = sh.gtah[mh] === now;
  quiet(() => v.applyGambleAccusations(grOf([]), sh, new Set(), now + 60000, vecOf, { complete: false, graceMs: v.ABSENT_GRACE_MS }));
  const keptIncomplete = sh.gtah[mh] === now;
  quiet(() => v.applyGambleAccusations(grOf([held]), sh, new Set(), now + 120000, vecOf, { complete: true, graceMs: v.ABSENT_GRACE_MS }));
  const keptHeld = sh.gtah[mh] === now;
  const r3 = quiet(() => v.applyGambleAccusations(grOf([]), sh, new Set(), now + 180000, vecOf, { complete: true, graceMs: v.ABSENT_GRACE_MS }));
  T('[11] a hold stamp: set, kept on an incomplete read, kept while held, dropped on a complete read without the key', stamped && keptIncomplete && keptHeld && !(mh in sh.gtah) && r3.dirty,
    JSON.stringify({ stamped, keptIncomplete, keptHeld, gtah: sh.gtah }));
} catch (e) { bad('[11] threw: ' + (e && e.message)); } }

// ---- [12] mutation self-checks (each key rule removed -> its scenario goes red) ----
console.log('-- [12] mutation self-checks --');
{ try {
  const ROOT = path.join(__dirname, '..');
  let nth = 0;
  const writeMutant = (from, to) => { const f = path.join(ROOT, '.mutant-gamble-accuse-' + process.pid + '-' + (nth++) + '.js'); fs.writeFileSync(f, SRC.replace(from, to)); return f; };
  // whole-job scenarios: true = the rule holds
  const onlyHost = (script) => {
    const recs = forged(1, 0xD00, R4), m = keyOf(recs[0].d);
    const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } }, null, script);
    return r.code === 0 && fOf(r, A) === 1 && [B, C, D].every(x => fOf(r, x) === 0);
  };
  const belowKept = (script) => {
    const recs = forged(1, 0xD01, R4, { host: 2, tagFor: { 0: 0b0100, 1: 0b0100, 3: 0b0100 } }), m = keyOf(recs[0].d);
    const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } }, null, script);
    return r.code === 0 && !strikesOf(r, C) && R4.every(x => fOf(r, x) === 1);
  };
  const oneUnitKept = (script) => {
    const pairMt = 1 | (0b10 << 4), recs = forged(pairMt, 0xD02, R4, { skip: [1] }), m = keyOf(recs[0].d);
    const r1 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(pairMt, R4, FLOOR + 5 * 60000) } }, null, script);
    const r2 = runCron(boardsWith(recs), advance(r1.state, v.ABSENT_GRACE_MS + 60000), null, script);
    return r2.code === 0 && !strikesOf(r2, A) && [A, C, D].every(x => fOf(r2, x) === 1);
  };
  const absentHeld = (script) => {
    const recs = forged(1, 0xD03, R4, { skip: [3] }), m = keyOf(recs[0].d);
    const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } }, null, script);
    return r.code === 0 && R4.every(x => fOf(r, x) === 0) && !strikesOf(r, A);
  };
  const splitKept = (script) => {
    const recs = forged(1, 0xD04, R4, { vecFor: { 3: [6000, 5000, 4000, 2999] } }), m = keyOf(recs[0].d);
    const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(1, R4, FLOOR + 5 * 60000) } }, null, script);
    return r.code === 0 && !strikesOf(r, A) && R4.every(x => fOf(r, x) === 1);
  };
  // pure-function scenarios, on a required copy of the mutant
  const now = 300 * 86400000;
  const viaModule = (fn) => (script) => { const mv = require(script); return fn(mv); };
  const disjointRule = viaModule(mv => mv.gtacVerdict([{ m: 'a', t: now - 1000, a: [B, C].map(x => mv.pid(x)) }], { m: 'x', t: now, a: [C, E].map(x => mv.pid(x)) }, now) === 'free');
  const listCapped = viaModule(mv => {
    const sg = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} };
    const keys = Array.from({ length: 20 }, (_, i) => forged(1, 0xD10 + i, R4));
    quiet(() => mv.applyGambleAccusations({ inconsistentGroups: keys.map(l => ({ m: keyOf(l[0].d), g: recsOf(l) })) }, sg, new Set(), now, vecOf, { complete: true, graceMs: mv.ABSENT_GRACE_MS }));
    return sg.gtac[mv.pid(A)].length === mv.GTAC.LIST_CAP;
  });
  const holdPruned = viaModule(mv => {
    const sh = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} };
    const held = forged(1, 0xD30, R4, { skip: [3] }), mh = keyOf(held[0].d);
    quiet(() => mv.applyGambleAccusations({ inconsistentGroups: [{ m: mh, g: recsOf(held) }] }, sh, new Set(), now, vecOf, { complete: true, graceMs: mv.ABSENT_GRACE_MS }));
    quiet(() => mv.applyGambleAccusations({ inconsistentGroups: [] }, sh, new Set(), now + 60000, vecOf, { complete: true, graceMs: mv.ABSENT_GRACE_MS }));
    return !(mh in sh.gtah);
  });
  const unknownVer = viaModule(mv => mv.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0xDB | (2 << 8) | (1 << 16), 0b0001] }) }) === 0);
  const pastOther = viaModule(mv => mv.gambleTagOf({ d: rec(1, 1, 2, R4, BASE4, BASE4, { gtRaw: [0xE7 | (1 << 8) | (2 << 16), 11, 22], gt: 0b0001 }) }) === 0b0001);
  const verdictWithFlag = viaModule(mv => {
    const sg = { day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {}, gtav: { q: { p: 'y', t: now - 1000, v: 'free' } } };
    mv.pruneSignals(sg, now);
    return !sg.gtav.q;
  });
  const mutants = [
    ['the strike flags every writer (not only the named seat)', 'if (recordFlag(signals, [ga.host], m, now)) res.touched.push(hid);', 'if (recordFlag(signals, g, m, now)) res.touched.push(hid);', onlyHost],
    ['writers below the named seat accepted', "if (s <= h) return { why: 'a writer at seat '", "if (false) return { why: 'a writer at seat '", belowKept],
    ['one queue unit enough', 'if (units.size < GTAC.MIN_UNITS)', 'if (false)', oneUnitKept],
    ['no hold for a seat with no record', '      if (ah.hold) {\n        res.held++; heldNow.add(m);', '      if (false) {\n        res.held++; heldNow.add(m);', absentHeld],
    ['the writers who name him may disagree', "if (!acc.every(r => vecOf(r) === v0)) return { why:", "if (false) return { why:", splitKept],
    ['crews that share a writer counted apart', 'const cand = live.map(setOf).filter(s => s.size && apart(s, c));', 'const cand = live.map(setOf).filter(s => s.size);', disjointRule],
    ['no cap on the strikes kept per account', 'if (list.length > GTAC.LIST_CAP) list.splice(0, list.length - GTAC.LIST_CAP);', '', listCapped],
    ['a hold stamp outlives its key', 'if (o.complete) for (const k of Object.keys(signals.gtah)) if (!heldNow.has(k))', 'if (false) for (const k of Object.keys(signals.gtah)) if (!heldNow.has(k))', holdPruned],
    ['the reader does not skip the char block', '    if (mg === CHAR_MAGIC && len === pc) { i += 1 + Math.ceil(pc / 4); continue; }\n', '', onlyHost],
    ['the reader takes any version', 'if (mg === GT_MAGIC && ver === GT_VER) return', 'if (mg === GT_MAGIC) return', unknownVer],
    ['the reader stops at another block', '    i += 1 + len;\n  }\n  return 0;\n}', '    return 0;\n  }\n  return 0;\n}', pastOther],
    ['a verdict outlives its key\'s flag', 'if (!s.flagged[k] || now - ((s.gtav[k] && s.gtav[k].t) || 0) > SIG_PAIR_WINDOW_MS) delete s.gtav[k];', 'if (now - ((s.gtav[k] && s.gtav[k].t) || 0) > SIG_PAIR_WINDOW_MS) delete s.gtav[k];', verdictWithFlag],
  ];
  T('[12] every scenario holds on the real job', mutants.every(([, , , check]) => check(VALIDATE)));
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[12] ' + label + ': anchor not found exactly once'); continue; }
    const script = writeMutant(from, to);
    try { T('[12] ' + label + ' -> its scenario goes red', !check(script)); }
    finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
} catch (e) { bad('[12] threw: ' + (e && e.message)); } }

if (failN) { console.log('gamble-accuse: ' + failN + ' FAILED'); process.exit(1); }
console.log('gamble-accuse: all passed');
