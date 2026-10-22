'use strict';
// Team-gamble accusations (Q43, cloud audit follow-up to the gamble commit-reveal fix): a host who takes the reveals,
// sees the roll and never sends a verifiable settle frame (stalls, quits, or drops and lets a teammate re-run the round)
// voids the match, and before this pass nobody was charged -- every refusing writer was flagged alike and a cold
// reconnect is no quit. The client now names the seat it holds responsible (one int after the roster, T2BY_TAG | seat
// bits, only on rank-0 refusals it can attribute). Two writers naming the same account on one key = a strike; two
// strikes with entirely different accusers inside the window = he is judged a leaver (never-forgiven synthetic
// abandon confession: exit rate + ranked points penalty). Struck keys leave the settle / flag paths: only he is flagged,
// and the key matures through the orphan verdict (whoever wrote no settle record takes the exit-rate hit).
//   [1] detector shapes (team2Accusations)
//   [2] verdict rule (t2acVerdict: disjoint accusers, window, same key not twice)
//   [3] the Q43 shape, ranked 2v2: the host left after the reveals, three refusals name him -> unsettled, only he
//       flagged, free strike; at maturity the orphan verdict processes it, his exit-rate hit for leaving
//   [4] his second strike by other people inside the window: judged -- exit rate + -100 points, though he wrote a
//       record himself (never forgiven); the people he voided stay clean; no double exit rate at maturity
//   [5] named again by the same people: still free
//   [6] lone accusations: the lone-dissent pass owns its shape; a two-writer key keeps the old flag path (record only)
//   [7] two colluding accounts naming an honest host on two keys: overlapping accusers never convict
//   [8] honest match: unaffected; [9] quick 3v3: judged, exit rate only (no points surface)
//   [10] sticky: re-runs add no strike / confession / refund; later accusers join the strike
//   [11] wiring pins
//   [12] which accusations count (rework after review): left / unsettled / costly; the losers' free names, the
//        'stall' a client earns by filtering its own traffic, own-side names in a lost match -> record only (nocost)
//   [13]-[16] e2e framing paths: honest host named by two unrelated pairs of losers (2v2, 3v3), the host's teammate
//        named by modded losers, the host named by his own losing teammates (3v3) -> never struck, never judged
//   [17] [18] e2e control: a modded host who settles nobody and claims the win (or the loss) alone -> struck, judged
//   [18b] e2e: the host lost, withheld the winners' settle frame to void it, he and his teammate wrote the loss -> struck, judged
//   [19] a record-only verdict turns into a strike when a late refusal lands; re-runs count it once
//   [20] wiring pins (rework)
//   [21] review 2: a missing record is evidence only after a full read and the grace -- a late record or a shard
//        that failed to read defers the strike (the key stays off the settle / flag paths meanwhile), then not counted
//   [22] review 2: a backed losing side naming a non-host who quit (own team or the winners, 3v3) -> not counted;
//        the losing host who settles only the winners and quits -> still struck, judged
//   [23] review 2 (host-only): unsettled / costly are the host's alone -- a modded host and two accounts naming an
//        honest non-host who wrote a record never strike him
//   [25] cloud audit Q69: 'left' needs the accused's own start attestation -- two accounts naming a host who never
//        played (two keys, disjoint namers) never strike or judge him (control: with his own start, judged); a start
//        read this run counts for a pending entry from an older build; a host whose own record was read before
//        (stored 'nocost') is not struck as 'left' when it rotates off (review 3, shape 1b); mutation self-checks
// A key about to record a new strike while a roster seat has no record waits one grace period (R1-B2-04 hold):
//   runCron follows such a run with the next one a grace period later, like the cron's own next run would.
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
  "const HIDE = JSON.parse(process.env.STUB_HIDE || '[]');   // boards left out of the listing (an incomplete read)",
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
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.filter(b => HIDE.indexOf(b.name) < 0).map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
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

function runCronOnce(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-accuse-'));
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
  const cf = files.CONFESSIONS_FILE || {};
  for (const k of Object.keys(cf)) if (cf[k] && cf[k].t0) cf[k].t0 -= ms;
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.t2ac || {})) for (const e of sg.t2ac[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2av || {})) sg.t2av[k].t -= ms;
    for (const k of Object.keys(sg.t2ah || {})) sg.t2ah[k] -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
}
// One cron run; when it deferred a strike for a seat with no record (the absent-seat hold), the run one grace period
//   later too (the same boards: the record never came). out / posts cover both runs, state is the second run's.
const GRACE_STEP = v.ABSENT_GRACE_MS + 60000;
function runCron(boards, files, env) {
  const r = runCronOnce(boards, files, env);
  if (!/strike deferred/.test(r.out)) return r;
  const r2 = runCronOnce(boards, advance(r.state, GRACE_STEP), env);
  return Object.assign({}, r2, { out: r.out + r2.out, posts: r.posts.concat(r2.posts), first: r });
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
  if (o.tag != null) d.push(o.tag | 0);   // Q43 accusation int (T2BY_TAG | seat bitmask)
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
// an attested start sighted `ago` ms before the run (pid roster, like reconcileStarts registers it); every seated
//   player wrote his own start attestation at level 1 (pend.started, Q69) unless `noStart` lists his sid
function startOf(mt, hash, roster, ago, noStart) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [], started: roster.filter(s => (noStart || []).indexOf(s) < 0).map(s => v.pid(s)) };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const R4 = [A, B, C, D];   // host A; team 0 = A, B; team 1 = C, D
const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const recsOf = (list) => list.map(x => ({ steamID: x.sid, d: x.d, dispCode: x.d[10 + (x.d[8] | 0)] | 0, roster: v.decodeRoster(x.d) }));

const G = '76561198000000007', H = '76561198000000008';
const ALL = [A, B, C, D, E, F, G, H];
const TAG = v.T2BY_TAG;
const acOf = (r, sid) => ((sigOf(r).t2ac || {})[v.pid(sid)] || []);
const t2acIsStrikeOf = (r, m, sid) => { const e = (sigOf(r).t2av || {})[m + '|' + v.pid(sid)]; return !!e && (e.v === 'free' || e.v === 'judge'); };
const avOf = (r, m, sid) => (sigOf(r).t2av || {})[m + '|' + v.pid(sid)];
const confOf = (r, m, sid) => (r.state.CONFESSIONS_FILE || {})[v.pid(sid) + '|' + m];
// the refusal shape: every listed seat writes rank 0 + a tag naming `named` (seat bitmask); same score vector for all
function refusal(mt, hash, roster, accusers, named, extra) {
  const dis = {};
  for (const s of accusers) dis[s] = { rank: 0, tag: TAG | named };
  return match(mt, hash, roster, Object.assign(dis, extra || {}), roster.map((_, i) => i).filter(i => accusers.indexOf(i) < 0 && !(extra && extra[i])));
}

// ---- [1] detector shapes ----
{
  const one = v.team2Accusations(recsOf(refusal(6, 0x100, R4, [1, 2, 3], 1)));
  T('[1] the Q43 shape: three refusals name the host -> one accused, three accusers', one.length === 1 && one[0].sid === A && one[0].accusers.length === 3 && [B, C, D].every(s => one[0].accusers.indexOf(s) >= 0), JSON.stringify(one));
  T('[1] honest match (no tag): none', v.team2Accusations(recsOf(match(6, 0x101, R4))).length === 0);
  T('[1] a tag on a record that does not refuse (rank claim kept): ignored', v.team2Accusations(recsOf(match(6, 0x102, R4, { 1: { tag: TAG | 1 }, 2: { tag: TAG | 1 } }))).length === 0);
  T('[1] a tag naming only the writer himself: ignored', v.team2Accusations(recsOf(refusal(6, 0x103, R4, [1, 2], 0b10, { 2: { rank: 0, tag: TAG | 0b100 } }))).length === 0);
  T('[1] a key one account wrote alone: none', v.team2Accusations(recsOf(refusal(6, 0x104, R4, [1], 1))).length === 0);
  T('[1] team brawl (mode 1, no gamble): none', v.team2Accusations(recsOf(refusal(4, 0x105, R4, [1, 2, 3], 1))).length === 0);
  const badTag = recsOf(refusal(6, 0x106, R4, [1, 2, 3], 1)).map(r => { const d = r.d.slice(); d[d.length - 1] = (TAG | 1) | 0x100; return Object.assign({}, r, { d }); });
  T('[1] a malformed tag (bits outside the seat mask): ignored', v.team2Accusations(badTag).length === 0);
  const big = [5000000, 4000000, 3000000, 2000000];
  T('[1] refusals out of sanity bounds: ignored', v.team2Accusations(recsOf(refusal(6, 0x107, R4, [1, 2, 3], 1, { 1: { rank: 0, tag: TAG | 1, scores: big }, 2: { rank: 0, tag: TAG | 1, scores: big }, 3: { rank: 0, tag: TAG | 1, scores: big } }))).length === 0);
  const moved = recsOf(refusal(6, 0x108, R4, [1, 2, 3], 1)).map(r => (r.steamID === B ? Object.assign({}, r, { steamID: E }) : r));
  const mv = v.team2Accusations(moved);
  T('[1] a writer the others do not name at his seat: his accusation is ignored', mv.length === 1 && mv[0].accusers.length === 2 && mv[0].accusers.indexOf(E) < 0, JSON.stringify(mv));
  // ... even when he rewrites his own roster to sit himself there (his record alone passes the self-seat sanity check)
  const forged = refusal(6, 0x10B, R4, [1, 2, 3], 1).map(x => {
    if (x.sid !== B) return x;
    const d = x.d.slice(), at = 11 + (d[8] | 0) + 2 * 1, p = sidPair(E);
    d[at] = p[0]; d[at + 1] = p[1];
    return { sid: E, d };
  });
  const fg = v.team2Accusations(recsOf(forged));
  T('[1] ... even with his own roster rewritten to seat himself there: ignored (the other writers decide who sat where)', fg.length === 1 && fg[0].accusers.length === 2 && fg[0].accusers.indexOf(E) < 0, JSON.stringify(fg));
  const two = v.team2Accusations(recsOf(refusal(6, 0x109, R4, [1, 3], 1, { 2: { rank: 0, tag: TAG | 0b10 }, 0: { rank: 0, tag: TAG | 0b10 } })));
  T('[1] two accused on one key (some name the old host, some the new one): both listed', two.length === 2 && two.some(x => x.sid === A && x.accusers.length === 2) && two.some(x => x.sid === B && x.accusers.length === 2), JSON.stringify(two));
  const R6 = [A, B, C, D, E, F];
  const six = v.team2Accusations(recsOf(refusal(9, 0x10A, R6, [1, 2, 3, 4, 5], 1)));
  T('[1] ranked 3v3: found', six.length === 1 && six[0].sid === A && six[0].accusers.length === 5);
  T('[1] defaults: two accusers, K 2, window 30 days, disp user-quit, tag 0x74320000', v.T2AC.MIN_ACC === 2 && v.T2AC.K === 2 && v.T2AC.WINDOW_MS === 30 * 86400000 && v.T2AC.DISP === 5 && TAG === 0x74320000);
}

// ---- [2] verdict rule ----
{
  const now = 100 * 86400000, W = v.T2AC.WINDOW_MS;
  const s = (m, ago, a) => ({ m, t: now - ago, a });
  T('[2] first strike: free', v.t2acVerdict([], s('x', 0, ['b', 'c']), now) === 'free');
  T('[2] second strike, entirely different accusers: judge', v.t2acVerdict([s('a', 1000, ['b', 'c'])], s('x', 0, ['d', 'e']), now) === 'judge');
  T('[2] second strike sharing one accuser: free', v.t2acVerdict([s('a', 1000, ['b', 'c'])], s('x', 0, ['c', 'e']), now) === 'free');
  T('[2] the earlier strike older than the window: free', v.t2acVerdict([s('a', W + 1000, ['b', 'c'])], s('x', 0, ['d', 'e']), now) === 'free');
  T('[2] a stored strike of the same key is not counted twice', v.t2acVerdict([s('x', 1000, ['b', 'c'])], s('x', 0, ['d', 'e']), now) === 'free');
  T('[2] any one disjoint earlier strike among overlapping ones: judge', v.t2acVerdict([s('a', 3000, ['b', 'c']), s('b', 2000, ['c', 'd']), s('c', 1000, ['f', 'g'])], s('x', 0, ['b', 'e']), now) === 'judge');
}

// ---- [3] the Q43 shape, ranked 2v2: the host left after the reveals ----
let r3;
const m3 = keyOf(t2(6, 0x300, 0, R4));
{
  const recs = refusal(6, 0x300, R4, [1, 2, 3], 1);
  r3 = runCron(boardsWith(recs, ALL), { STARTS_FILE: { [m3]: startOf(6, 0x300, R4, FLOOR + 5 * 60000) } });
  T('[3] run exits 0', r3.code === 0, r3.out.slice(-800));
  T('[3] the first run waits (his seat has no record, grace not over): no strike, nobody flagged, gap stamped', !!r3.first && acOf(r3.first, A).length === 0 && [A, B, C, D].every(s => fOf(r3.first, s) === 0) && !!(sigOf(r3.first).t2ah || {})[m3] && /team2 accusation [^\n]*seat 0 wrote no record -- grace [0-9]+s left, strike deferred/.test(r3.first.out), (r3.first ? r3.first.out : r3.out).slice(-600));
  T('[3] not settled, nothing written', !processedOf(r3).has(m3) && posts(r3, RATING).length === 0 && posts(r3, POINTS).length === 0);
  T('[3] only the accused host is flagged', fOf(r3, A) === 1 && [B, C, D].every(s => fOf(r3, s) === 0), 'f=' + [A, B, C, D].map(s => fOf(r3, s)).join(','));
  T('[3] one strike (three accusers), verdict free', acOf(r3, A).length === 1 && acOf(r3, A)[0].a.length === 3 && avOf(r3, m3, A) && avOf(r3, m3, A).v === 'free');
  T('[3] accusation signal ac on him; no confession, no exit rate yet', ((sigOf(r3).players[v.pid(A)] || {}).ac | 0) === 1 && !confOf(r3, m3, A) && leavesOf(r3, A) === 0);
  T('[3] logged', /team2 accusation .*3 writers name .*verdict free/.test(r3.out));
  T('[3] nobody else is struck', [B, C, D].every(s => acOf(r3, s).length === 0));
  const r3b = runCron(boardsWith(recs, ALL), advance(r3.state, v.STARTS_MATURITY_MS + 60000));
  T('[3] at maturity the orphan verdict processes the key', processedOf(r3b).has(m3), r3b.out.slice(-600));
  T('[3] he left (no settle record): exit-rate hit; the three who stayed: none', leavesOf(r3b, A) === 1 && [B, C, D].every(s => leavesOf(r3b, s) === 0));
  T('[3] still no rating or points, one strike, f unchanged', posts(r3b, RATING).length === 0 && posts(r3b, POINTS).length === 0 && acOf(r3b, A).length === 1 && fOf(r3b, A) === 1 && fOf(r3b, B) === 0);
}

// ---- [4] his second strike by other people inside the window: judged ----
let r4;
const R4b = [A, E, F, G];   // he hosts again; E his teammate, F / G the other team
const m4 = keyOf(t2(6, 0x400, 0, R4b));
{
  // this time he stays and writes the refusal shape himself (no tag: a modded host can write anything)
  const recs = refusal(6, 0x400, R4b, [1, 2, 3], 1, { 0: { rank: 0 } });
  const files = advance(r3.state, 3 * 86400000);
  files.STARTS_FILE = { [m4]: startOf(6, 0x400, R4b, FLOOR + 5 * 60000) };
  r4 = runCron(boardsWith(recs, ALL), files);
  T('[4] run exits 0', r4.code === 0, r4.out.slice(-800));
  T('[4] verdict judge, two strikes', acOf(r4, A).length === 2 && avOf(r4, m4, A) && avOf(r4, m4, A).v === 'judge', JSON.stringify(acOf(r4, A)) + ' ' + JSON.stringify(avOf(r4, m4, A)));
  T('[4] judged a leaver: -100 points, exit rate (carried from [3]\'s first run: none before)', scoreTo(r4, POINTS, A) === 1900 && leavesOf(r4, A) === 1, 'pts=' + scoreTo(r4, POINTS, A) + ' leaves=' + leavesOf(r4, A));
  T('[4] never forgiven although he wrote a record on the key', confOf(r4, m4, A) && confOf(r4, m4, A).nf === 1 && !confOf(r4, m4, A).refunded, JSON.stringify(confOf(r4, m4, A)));
  T('[4] the people he voided: no points, no exit rate, not flagged', [E, F, G].every(s => scoreTo(r4, POINTS, s) == null && leavesOf(r4, s) === 0 && fOf(r4, s) === 0));
  T('[4] the match does not settle', !processedOf(r4).has(m4) && posts(r4, RATING).length === 0);
  T('[4] logged (strike + confession)', /team2 accusation .*verdict judge/.test(r4.out) && /confess .*team-gamble accusation/.test(r4.out));
  const r4b = runCron(boardsWith(recs, ALL), advance(r4.state, v.STARTS_MATURITY_MS + 60000));
  T('[4] at maturity: processed, no second exit-rate hit (he wrote a record; the confession counted it), no refund', processedOf(r4b).has(m4) && leavesOf(r4b, A) === 1 && scoreTo(r4b, POINTS, A) == null, 'leaves=' + leavesOf(r4b, A) + ' pts=' + scoreTo(r4b, POINTS, A));
}

// ---- [5] named again by the same people: still free ----
{
  const recs = refusal(6, 0x500, R4, [1, 2], 1, { 3: { rank: 0 } });   // B, C name him again (D refuses without naming)
  const m = keyOf(recs[0].d);
  const files = advance(r3.state, 86400000);
  files.STARTS_FILE = { [m]: startOf(6, 0x500, R4, FLOOR + 5 * 60000) };
  const r = runCron(boardsWith(recs, ALL), files);
  T('[5] second strike, accusers overlap the first: free', acOf(r, A).length === 2 && avOf(r, m, A).v === 'free' && leavesOf(r, A) === 0 && scoreTo(r, POINTS, A) == null, JSON.stringify(avOf(r, m, A)));
}

// ---- [6] lone accusations ----
{
  // the lone-dissent shape: one refusal names the host, the other three agree -> Q51 decides it, no strike here
  const recs = match(6, 0x600, R4, { 2: { rank: 0, tag: TAG | 1 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs, ALL), { STARTS_FILE: { [m]: startOf(6, 0x600, R4, FLOOR + 5 * 60000) } });
  T('[6] lone-dissent shape: the lone-dissent pass owns it (dissenter struck there), no accusation strike or lone counter here, host not flagged', (sigOf(r).t2lv || {})[m] && acOf(r, A).length === 0 && !avOf(r, m, A) && ((sigOf(r).players[v.pid(A)] || {}).al | 0) === 0 && fOf(r, A) === 0 && fOf(r, C) === 1, 'ac=' + JSON.stringify(acOf(r, A)) + ' f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
  // a key with two writers, one naming the host (Q51 needs three writers): record-only counter, old flag path
  const recs2 = refusal(6, 0x601, R4, [2], 1, { 3: { rank: 0 } });
  const m2 = keyOf(recs2[0].d);
  const r2 = runCron(boardsWith(recs2, ALL), { STARTS_FILE: { [m2]: startOf(6, 0x601, R4, FLOOR + 5 * 60000) } });
  T('[6] two writers, one names him: no strike, record-only counter al', acOf(r2, A).length === 0 && avOf(r2, m2, A) && avOf(r2, m2, A).v === 'lone' && ((sigOf(r2).players[v.pid(A)] || {}).al | 0) === 1);
  T('[6] ... and the old flag path (both writers flagged, he is not)', fOf(r2, C) === 1 && fOf(r2, D) === 1 && fOf(r2, A) === 0, 'f=' + [A, B, C, D].map(s => fOf(r2, s)).join(','));
}

// ---- [7] two colluding accounts naming an honest host on two keys ----
{
  const RX = [H, B, C, D];   // honest host H; colluders C, D on the other team, B honest
  const k1 = refusal(6, 0x700, RX, [2, 3], 1);
  const k2 = refusal(6, 0x701, RX, [2, 3], 1);
  const starts = {}; for (const [i, h] of [0x700, 0x701].entries()) starts[keyOf(t2(6, h, 0, RX))] = startOf(6, h, RX, FLOOR + (20 - 10 * i) * 60000);
  const r = runCron(boardsWith(k1.concat(k2), ALL), { STARTS_FILE: starts });
  T('[7] two strikes, same two accusers: both free, no penalty', acOf(r, H).length === 2 && [0x700, 0x701].every(h => avOf(r, keyOf(t2(6, h, 0, RX)), H).v === 'free') && leavesOf(r, H) === 0 && scoreTo(r, POINTS, H) == null);
}

// ---- [8] honest match: unaffected ----
{
  const recs = match(6, 0x800, R4);
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs, ALL), { STARTS_FILE: { [m]: startOf(6, 0x800, R4, FLOOR + 5 * 60000) } });
  T('[8] settles, nobody struck or flagged', processedOf(r).has(m) && Object.keys(sigOf(r).t2ac || {}).length === 0 && Object.keys(sigOf(r).t2av || {}).length === 0 && [A, B, C, D].every(s => fOf(r, s) === 0));
  T('[8] all four rated', [A, B, C, D].every(s => scoreTo(r, RATING, s) != null));
}

// ---- [9] quick 3v3: judged, exit rate only ----
{
  const R6 = [A, B, C, D, E, F];
  const recs1 = refusal(8, 0x900, R6, [1, 2], 1, { 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } });
  const m1 = keyOf(recs1[0].d);
  const r1 = runCron(boardsWith(recs1, ALL), { STARTS_FILE: { [m1]: startOf(8, 0x900, R6, FLOOR + 5 * 60000) } });
  T('[9] first: free strike', avOf(r1, m1, A) && avOf(r1, m1, A).v === 'free' && fOf(r1, A) === 1 && fOf(r1, B) === 0);
  const recs2 = refusal(8, 0x901, R6, [4, 5], 1, { 1: { rank: 0 }, 2: { rank: 0 }, 3: { rank: 0 } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r1.state, 86400000);
  f2.STARTS_FILE = { [m2]: startOf(8, 0x901, R6, FLOOR + 5 * 60000) };
  const r2 = runCron(boardsWith(recs2, ALL), f2);
  T('[9] second, different accusers: judged, exit rate for him', avOf(r2, m2, A).v === 'judge' && leavesOf(r2, A) === 1, r2.out.slice(-500));
  T('[9] quick: no points surface at all', posts(r2, POINTS).length === 0);
}

// ---- [10] sticky ----
{
  const recs = refusal(6, 0x400, R4b, [1, 2, 3], 1, { 0: { rank: 0 } });
  const r = runCron(boardsWith(recs, ALL), advance(r4.state, 60000));
  T('[10] re-run of the judged key: no new strike, no second penalty, no refund', acOf(r, A).length === 2 && leavesOf(r, A) === 1 && scoreTo(r, POINTS, A) == null && !confOf(r, m4, A).refunded, 'ac=' + acOf(r, A).length + ' leaves=' + leavesOf(r, A));
  // later accusers on a stored strike join its accuser set
  const early = refusal(6, 0xA00, R4, [1, 2], 1, { 3: { rank: 0 } });
  const m = keyOf(early[0].d);
  const s1 = runCron(boardsWith(early, ALL), { STARTS_FILE: { [m]: startOf(6, 0xA00, R4, FLOOR + 5 * 60000) } });
  const late = refusal(6, 0xA00, R4, [1, 2, 3], 1);
  const s2 = runCron(boardsWith(late, ALL), advance(s1.state, 60000));
  T('[10] a later record joins the stored strike (2 -> 3 accusers), still one strike', acOf(s1, A).length === 1 && acOf(s1, A)[0].a.length === 2 && acOf(s2, A).length === 1 && acOf(s2, A)[0].a.length === 3);
  T('[10] the key stays out of the flag path on later runs (nobody else flagged)', [B, C, D].every(s => fOf(s2, s) === 0) && fOf(s2, A) === 1);
}

// ---- [11] wiring pins ----
{
  const iQ51 = SRC.indexOf('applyTeam2LoneDissent(gr, signals, processed, Date.now(), vecOf)');
  const iPass = SRC.indexOf('applyTeam2Accusations(gr, signals, processed, Date.now(), { complete: shardsComplete, graceMs: ABSENT_GRACE_MS, starts: startsPending, startRecs: starts');   // + contested (Q75)
  const iKeys = SRC.indexOf('const consistentKeys = new Set(consistentMatches.map(c => c.m));');
  const iConf = SRC.indexOf('confRes = await reconcileConfessions(confessions,');
  const iFlag = SRC.indexOf('for (const { m, g } of inconsistentGroups) {');
  T('[11] the pass runs after the lone-dissent pass, before the consistent-key set, the confessions and the inconsistent flag loop', iQ51 > 0 && iPass > iQ51 && iPass < iKeys && iPass < iConf && iPass < iFlag);
  T('[11] judged confessions join the shard confessions', /for \(const c of t2acRes\.confess\) confessions\.push\(c\);/.test(SRC));
  const rc = SRC.slice(SRC.indexOf('async function reconcileConfessions'), SRC.indexOf('// pending start-attestation groups'));
  T('[11] never-forgiven confessions: no pre-sighting pardon, no upkeep refund', /if \(!c\.nf && settledBy\(c\.m, c\.p\)\)/.test(rc) && /if \(st\.done \|\| st\.refunded \|\| st\.nf\) continue;/.test(rc) && /if \(c\.nf\) \{ st\.nf = 1;/.test(rc));
  T('[11] exports', typeof v.team2Accusations === 'function' && typeof v.t2acVerdict === 'function' && typeof v.applyTeam2Accusations === 'function' && !!v.T2AC && v.T2BY_TAG === 0x74320000);
  const ps = SRC.slice(SRC.indexOf('function pruneSignals'), SRC.indexOf('function saveSignals'));
  T('[11] strikes and verdicts age out in pruneSignals', /s\.t2ac/.test(ps) && /s\.t2av/.test(ps));
  T('[11] run summary row', /team-gamble accusation strikes \/ judged as leaver/.test(SRC));
}

// ---- [12] which accusations count (team2Accusations: why / strike) ----
// The names are the refusers' own word. Refusing a match your team lost costs nothing, and an unmodified client earns
// the 'stall' ground just by filtering the settle frame out of its own traffic; so the names count only when the
// accused wrote nothing (left), nobody at all got a settle (unsettled), or an accuser threw away a win (costly).
{
  const why = (recs, sid) => { const e = v.team2Accusations(recsOf(recs)).find(x => x.sid === sid); return e ? (e.why || '-') + (e.strike ? '!' : '') : 'none'; };
  const R6 = [A, B, C, D, E, F];
  T('[12] the host left (no record): left, strike', why(refusal(6, 0xC00, R4, [1, 2, 3], 1), A) === 'left!');
  T('[12] honest host and his teammate claim the win, the losers name him (stall by filtering, or modded): not counted',
    why(match(6, 0xC01, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === '-');
  // his team lost, he and his teammate write it, the winners name him: either a modded host who withheld their settle
  //   frame to void his loss, or winners who threw away a win to frame him -- the win his own claim confirms
  T('[12] his team lost and he and his teammate write it, the winners name him: costly, strike (they gave up the win)',
    why(match(6, 0xC02, R4, { 0: { win: 1 }, 1: { win: 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === 'costly!');
  T('[12] ranked 3v3, the three losers name the honest host: not counted',
    why(match(9, 0xC03, R6, { 3: { rank: 0, tag: TAG | 1 }, 4: { rank: 0, tag: TAG | 1 }, 5: { rank: 0, tag: TAG | 1 } }), A) === '-');
  T('[12] modded losers name the host\'s teammate: not counted',
    why(match(6, 0xC04, R4, { 2: { rank: 0, tag: TAG | 0b10 }, 3: { rank: 0, tag: TAG | 0b10 } }), B) === '-');
  T('[12] 3v3, the host\'s team lost and his two teammates name him: not counted (they gave up nothing)',
    why(match(9, 0xC05, R6, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { win: 1 }, 4: { win: 1 }, 5: { win: 1 } }), A) === '-');
  T('[12] control: the host settles nobody and claims the win alone, his teammate and both opponents name him: costly, strike',
    why(match(6, 0xC06, R4, { 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === 'costly!');
  T('[12] control: ... claims the LOSS alone instead (the opponents gave up a win): costly, strike',
    why(match(6, 0xC07, R4, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === 'costly!');
  T('[12] ... claims the loss alone and one opponent never wrote: still costly (the other opponent gave up the win)',
    why(match(6, 0xC08, R4, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 } }, [3]), A) === 'costly!');
  T('[12] the host refuses too and nobody claims at all: unsettled, strike',
    why(refusal(6, 0xC09, R4, [1, 2, 3], 1, { 0: { rank: 0 } }), A) === 'unsettled!');
  T('[12] ... nobody claims but one seat never wrote: not counted',
    why(refusal(6, 0xC0A, R4, [1, 2], 1, { 0: { rank: 0 } }), A) === '-');
  T('[12] the host refuses, his teammate saw the loss and claims it, the opponents (winners) name him: costly, strike',
    why(match(6, 0xC0B, R4, { 0: { rank: 0 }, 1: { win: 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === 'costly!');
  // a modded host withholds the frame from one opponent only; he and his teammate (the losers) name that opponent
  const ind = match(6, 0xC0C, R4, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 2: { rank: 0, tag: TAG | 1 }, 3: { win: 1 } });
  T('[12] induced refusal: a modded host and his teammate (losers) name the opponent he cut: not counted', why(ind, C) === '-');
  T('[12] ... and the opponent naming the host: a counting shape, but one name is no strike', why(ind, A) === 'costly' && v.team2Accusations(recsOf(ind)).find(x => x.sid === A).accusers.length === 1);
  // review 2 (host-only): the claims say the framers' team won (they threw the win away) -- but C wrote a record and is
  //   not the host, so he never withheld a frame; before, a colluder on C's team writing that claim made it free
  T('[12] ... the same when the claims say the framers\' team won: not counted (he wrote a record, not the host)',
    why(match(6, 0xC0D, R4, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 2: { rank: 0, tag: TAG | 1 } }), C) === '-');
  // nobody settled: the modded host and his teammate name an opponent, the two opponents name the host -> only the host
  const both = refusal(6, 0xC0E, R4, [], 0, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  T('[12] nobody settled, two names each way: the host an unsettled strike, the opponent he named not counted', why(both, A) === 'unsettled!' && why(both, C) === '-');
  T('[12] the claims conflict (host says won, his teammate says lost), the opponents name him: not counted',
    why(match(6, 0xC0F, R4, { 1: { win: 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === '-');
  // the host's record comes first: reading only his claim would seat the namers on the winning side
  T('[12] ... the other way round (host says lost, his teammate says won): still not counted',
    why(match(6, 0xC12, R4, { 0: { win: 1 }, 1: { win: 0 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), A) === '-');
  T('[12] an outsider\'s claim counts for nothing (not seated there by the others): it cannot make the claims conflict', (() => {
    const recs = match(6, 0xC10, R4, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
    // E writes the opposite claim for seat 1 (B's seat), his own roster rewritten to sit himself there so his record
    //   alone passes the self-seat check; the other writers still seat B there
    const d = t2(6, 0xC10, 1, R4, { win: 0 }), at = 11 + (d[8] | 0) + 2 * 1, p = sidPair(E);
    d[at] = p[0]; d[at + 1] = p[1];
    recs.push({ sid: E, d });
    return why(recs, A) === 'costly!';
  })());
  T('[12] a lone name is never a strike, whatever the shape', why(refusal(6, 0xC11, R4, [1], 1, { 2: { rank: 0 }, 3: { rank: 0 } }), A) === 'left');
}

// ---- [13] e2e, framing path 1: two unrelated pairs of losers name the same honest host (2v2) ----
const I = '76561198000000009', J = '76561198000000010', K = '76561198000000011', L = '76561198000000012';
const ALL2 = ALL.concat([I, J, K, L]);
// two keys run a day apart; recsFor(hash, roster) -> records; returns the second run
function twoRuns(mt, recs1, roster1, h1, recs2, roster2, h2) {
  const m1 = keyOf(t2(mt, h1, 0, roster1)), m2 = keyOf(t2(mt, h2, 0, roster2));
  const r1 = runCron(boardsWith(recs1, ALL2), { STARTS_FILE: { [m1]: startOf(mt, h1, roster1, FLOOR + 5 * 60000) } });
  const f2 = advance(r1.state, 86400000);
  f2.STARTS_FILE = Object.assign(f2.STARTS_FILE || {}, { [m2]: startOf(mt, h2, roster2, FLOOR + 5 * 60000) });
  const r2 = runCron(boardsWith(recs1.concat(recs2), ALL2), f2);
  return { r1, r2, m1, m2 };
}
const anOf = (r, sid) => ((sigOf(r).players[v.pid(sid)] || {}).an | 0);
// a key a dissent pass decided (Q51 lone dissent; Q56 team dissent once it reads the names this pass does not count, Q63):
//   this pass leaves it alone. On Q51 + Q43 alone none of these shapes is a dissent; stacked with Q56 the record-only
//   keys may go there instead of the old path, and the expectations below accept either
const owns = (r, m) => !!((sigOf(r).t2lv || {})[m]);
const nocostOr = (r, m, sid) => owns(r, m) || (!!avOf(r, m, sid) && avOf(r, m, sid).v === 'nocost');
{
  const RA = [A, B, C, D], RB = [A, E, F, G];
  const losers = (h, R) => match(6, h, R, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const { r1, r2, m1, m2 } = twoRuns(6, losers(0xD00, RA), RA, 0xD00, losers(0xD01, RB), RB, 0xD01);
  T('[13] runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-600));
  const free2 = [m1, m2].filter(m => !owns(r2, m)).length;   // keys left to this pass (2 on Q51 + Q43)
  T('[13] no strike on the honest host, both keys record-only (nocost)', acOf(r2, A).length === 0 && nocostOr(r2, m1, A) && nocostOr(r2, m2, A));
  T('[13] not judged: no confession, no -100, no exit rate', !confOf(r2, m1, A) && !confOf(r2, m2, A) && scoreTo(r2, POINTS, A) == null && leavesOf(r2, A) === 0);
  T('[13] record-only counter an = 2 (one per key), ac = 0', anOf(r2, A) === free2 && ((sigOf(r2).players[v.pid(A)] || {}).ac | 0) === 0, 'an=' + anOf(r2, A) + ' keys=' + free2);
  T('[13] logged as not counted', owns(r1, m1) || /team2 accusation .*2 writers name .*not counted/.test(r1.out));
  T('[13] the keys stay on their old path (unsettled) -- the dissent passes own this shape', [m1, m2].every(m => owns(r2, m) || !processedOf(r2).has(m)));
  T('[13] the losers who refused are no longer exempt from the flag (old path)', owns(r2, m1) || owns(r2, m2) || [C, D, F, G].every(s => fOf(r2, s) >= 1), 'f=' + [C, D, F, G].map(s => fOf(r2, s)).join(','));
}

// ---- [14] e2e, framing path 1 in ranked 3v3 ----
{
  const RA = [A, B, C, D, E, F], RB = [A, G, H, I, J, K];
  const losers = (h, R) => match(9, h, R, { 3: { rank: 0, tag: TAG | 1 }, 4: { rank: 0, tag: TAG | 1 }, 5: { rank: 0, tag: TAG | 1 } });
  const { r2, m2 } = twoRuns(9, losers(0xD10, RA), RA, 0xD10, losers(0xD11, RB), RB, 0xD11);
  T('[14] 3v3: no strike, not judged, nocost', r2.code === 0 && acOf(r2, A).length === 0 && nocostOr(r2, m2, A) && scoreTo(r2, POINTS, A) == null && leavesOf(r2, A) === 0, r2.out.slice(-400));
}

// ---- [15] e2e, framing path 2: modded losers name the host's teammate ----
{
  const RA = [A, B, C, D], RB = [E, B, F, G];   // B sits at seat 1 both times
  const losers = (h, R) => match(6, h, R, { 2: { rank: 0, tag: TAG | 0b10 }, 3: { rank: 0, tag: TAG | 0b10 } });
  const { r2, m2 } = twoRuns(6, losers(0xD20, RA), RA, 0xD20, losers(0xD21, RB), RB, 0xD21);
  T('[15] the teammate named twice by disjoint pairs: no strike, not judged', r2.code === 0 && acOf(r2, B).length === 0 && nocostOr(r2, m2, B) && scoreTo(r2, POINTS, B) == null && leavesOf(r2, B) === 0, r2.out.slice(-400));
}

// ---- [16] e2e, framing path 3: 3v3, the host's team lost and his two (modded) teammates name him ----
{
  const RA = [A, B, C, D, E, F], RB = [A, G, H, I, J, K];
  const mates = (h, R) => match(9, h, R, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { win: 1 }, 4: { win: 1 }, 5: { win: 1 } });
  const { r2, m2 } = twoRuns(9, mates(0xD30, RA), RA, 0xD30, mates(0xD31, RB), RB, 0xD31);
  T('[16] own losing teammates name him twice: no strike, not judged', r2.code === 0 && acOf(r2, A).length === 0 && nocostOr(r2, m2, A) && scoreTo(r2, POINTS, A) == null && leavesOf(r2, A) === 0, r2.out.slice(-400));
}

// ---- [17] e2e, control: a modded host settles nobody and claims the win alone ----
{
  const RA = [A, B, C, D], RB = [A, E, F, G];
  const cut = (h, R) => match(6, h, R, { 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const { r1, r2, m1, m2 } = twoRuns(6, cut(0xD40, RA), RA, 0xD40, cut(0xD41, RB), RB, 0xD41);
  T('[17] first key: costly strike, verdict free, only he flagged', avOf(r1, m1, A) && avOf(r1, m1, A).v === 'free' && fOf(r1, A) === 1 && [B, C, D].every(s => fOf(r1, s) === 0) && /writers name .*\(costly\) -> strike/.test(r1.out), r1.out.slice(-600));
  T('[17] second key, different people: judged -- -100 points, exit rate, never forgiven', avOf(r2, m2, A) && avOf(r2, m2, A).v === 'judge' && scoreTo(r2, POINTS, A) === 1900 && leavesOf(r2, A) === 1 && confOf(r2, m2, A) && confOf(r2, m2, A).nf === 1, 'pts=' + scoreTo(r2, POINTS, A) + ' leaves=' + leavesOf(r2, A));
  T('[17] the people he voided: untouched', [E, F, G].every(s => scoreTo(r2, POINTS, s) == null && leavesOf(r2, s) === 0 && fOf(r2, s) === 0));
}

// ---- [18] e2e, control: ... claims the LOSS alone instead ----
{
  const recs = match(6, 0xD50, R4, { 0: { win: 1 }, 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs, ALL2), { STARTS_FILE: { [m]: startOf(6, 0xD50, R4, FLOOR + 5 * 60000) } });
  T('[18] costly strike, only he flagged', r.code === 0 && avOf(r, m, A) && avOf(r, m, A).v === 'free' && acOf(r, A).length === 1 && fOf(r, A) === 1 && [B, C, D].every(s => fOf(r, s) === 0), r.out.slice(-500));
}

// ---- [18b] e2e: the host lost, withheld the opponents' settle frame (match voided), he and his teammate wrote the loss ----
{
  const RA = [A, B, C, D], RB = [A, E, F, G];
  const lost = (h, R) => match(6, h, R, { 0: { win: 1 }, 1: { win: 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const { r1, r2, m1, m2 } = twoRuns(6, lost(0xD70, RA), RA, 0xD70, lost(0xD71, RB), RB, 0xD71);
  T('[18b] first key: costly strike, free; only he flagged (the winners he voided and his teammate clean)', avOf(r1, m1, A) && avOf(r1, m1, A).v === 'free' && fOf(r1, A) === 1 && [B, C, D].every(s => fOf(r1, s) === 0), r1.out.slice(-500));
  T('[18b] second key, different winners: judged (-100, exit rate)', avOf(r2, m2, A) && avOf(r2, m2, A).v === 'judge' && scoreTo(r2, POINTS, A) === 1900 && leavesOf(r2, A) === 1, 'pts=' + scoreTo(r2, POINTS, A));
}

// ---- [19] a record-only verdict turns into a strike when a late refusal lands ----
{
  // first run: he claims the win alone, the two opponents name him, his teammate has not written yet -> not counted
  const early = match(6, 0xD60, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }, [1]);
  const m = keyOf(early[0].d);
  const s1 = runCron(boardsWith(early, ALL2), { STARTS_FILE: { [m]: startOf(6, 0xD60, R4, FLOOR + 5 * 60000) } });
  const late = match(6, 0xD60, R4, { 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const s2 = runCron(boardsWith(late, ALL2), advance(s1.state, 60000));
  T('[19] first run: nocost, an 1, no strike', avOf(s1, m, A) && avOf(s1, m, A).v === 'nocost' && anOf(s1, A) === 1 && acOf(s1, A).length === 0);
  T('[19] his teammate\'s refusal lands: strike (costly), an stays 1', avOf(s2, m, A) && avOf(s2, m, A).v === 'free' && acOf(s2, A).length === 1 && acOf(s2, A)[0].a.length === 3 && anOf(s2, A) === 1, JSON.stringify(avOf(s2, m, A)));
  // the old flag path ran on the first run (A, C, D flagged once, as before Q43); the strike adds nothing on top and
  //   the late refuser is not flagged
  T('[19] ... the key leaves the flag path: no second flag, the late refuser clean', fOf(s2, A) === 1 && fOf(s2, B) === 0 && fOf(s2, C) === 1 && fOf(s2, D) === 1, 'f=' + [A, B, C, D].map(s => fOf(s2, s)).join(','));
  // re-running a nocost key does not count it twice
  const s3 = runCron(boardsWith(match(6, 0xD61, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), ALL2), {});
  const m3 = keyOf(t2(6, 0xD61, 0, R4));
  const s4 = runCron(boardsWith(match(6, 0xD61, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } }), ALL2), advance(s3.state, 60000));
  T('[19] a nocost key seen again: still one an', owns(s4, m3) || (avOf(s4, m3, A) && avOf(s4, m3, A).v === 'nocost' && anOf(s4, A) === 1));
}

// ---- [20] wiring pins (rework) ----
{
  const ap = SRC.slice(SRC.indexOf('function applyTeam2Accusations'), SRC.indexOf('// clamp-aware authoritative leaver deduction'));
  T('[20] the pass strikes only on e.strike; record-only verdicts are lone / nocost', /if \(!e\.strike\) \{/.test(ap) && /'lone' : 'nocost'/.test(ap));
  T('[20] the struck-key set reads strike verdicts only (free / judge)', /function t2acIsStrike\(e\) \{ return !!e && \(e\.v === 'free' \|\| e\.v === 'judge'\); \}/.test(SRC) && /if \(t2acIsStrike\(signals\.t2av\[k\]\)\) struck\.add/.test(ap));
  T('[20] summary value carries the record-only counts', /RUN\.t2ac = t2acRes\.strikes \+ '\/' \+ t2acRes\.judged \+ \(\(t2acRes\.lone \|\| t2acRes\.nocost\)/.test(SRC));
}

// ---- [21] review 2: a missing record waits for a full read and the grace ----
// boards with one account's records moved off shard_0 onto shard `to` (so hiding that shard hides only his records)
function boardsMoved(recs, sid, to) {
  const b = boardsWith(recs, ALL2);
  const s0 = b[0], dst = b[to];
  for (let i = s0.entries.length - 1; i >= 0; i--) if (s0.entries[i].steamID === sid) dst.entries.push(s0.entries.splice(i, 1)[0]);
  return b;
}
const deferredOf = (r) => (r.out.match(/strike deferred/g) || []).length;
{
  // honest host A and B won; the losers C, D refuse and name him (free names); A's record lands a minute late
  const recs = match(6, 0xE00, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const m = keyOf(recs[0].d), early = recs.filter(x => x.sid !== A);
  const s1 = runCronOnce(boardsWith(early, ALL2), { STARTS_FILE: { [m]: startOf(6, 0xE00, R4, FLOOR + 5 * 60000) } });
  T('[21] late record, first run: strike deferred, no strike, nobody flagged, not settled', s1.code === 0 && deferredOf(s1) === 1 && acOf(s1, A).length === 0 && !avOf(s1, m, A) && [A, B, C, D].every(s => fOf(s1, s) === 0) && !processedOf(s1).has(m) && /seat 0 wrote no record -- grace [0-9]+s left/.test(s1.out), s1.out.slice(-600));
  T('[21] ... the gap is stamped in signals.t2ah', Number((sigOf(s1).t2ah || {})[m]) > 0);
  const s2 = runCronOnce(boardsWith(recs, ALL2), advance(s1.state, 60000));
  T('[21] his record lands a minute later: not counted (the losers name the host who wrote a record), no strike, never judged', s2.code === 0 && nocostOr(s2, m, A) && acOf(s2, A).length === 0 && !confOf(s2, m, A) && leavesOf(s2, A) === 0 && scoreTo(s2, POINTS, A) == null && deferredOf(s2) === 0, s2.out.slice(-600));
  // ... and ends exactly like a match whose records were all there on the first run (the old path, as before Q43)
  const ref = runCronOnce(boardsWith(recs, ALL2), { STARTS_FILE: { [m]: startOf(6, 0xE00, R4, FLOOR + 5 * 60000) } });
  T('[21] ... flags and verdict the same as with his record on time', [A, B, C, D].every(x => fOf(s2, x) === fOf(ref, x)) && JSON.stringify(avOf(s2, m, A) || null) .replace(/"t":-?[0-9]+/, '') === JSON.stringify(avOf(ref, m, A) || null).replace(/"t":-?[0-9]+/, '') && processedOf(s2).has(m) === processedOf(ref).has(m), 'f=' + [A, B, C, D].map(x => fOf(s2, x) + '/' + fOf(ref, x)).join(','));
  // the same, two keys a day apart with different losers: the third draft struck him on each and judged him
  const RB = [A, E, F, G];
  const recs2 = match(6, 0xE01, RB, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const m2 = keyOf(recs2[0].d);
  const f3 = advance(s2.state, 86400000);
  f3.STARTS_FILE = Object.assign(f3.STARTS_FILE || {}, { [m2]: startOf(6, 0xE01, RB, FLOOR + 5 * 60000) });
  const s3 = runCronOnce(boardsWith(recs.concat(recs2.filter(x => x.sid !== A)), ALL2), f3);
  const s4 = runCronOnce(boardsWith(recs.concat(recs2), ALL2), advance(s3.state, 60000));
  T('[21] late again on a second key, other losers: deferred, then not counted -- never struck, never judged', deferredOf(s3) === 1 && acOf(s4, A).length === 0 && !confOf(s4, m2, A) && leavesOf(s4, A) === 0 && scoreTo(s4, POINTS, A) == null && nocostOr(s4, m2, A), s4.out.slice(-500));
}
{
  // the same shape, A's record on a shard this run cannot read (left out of the listing)
  const recs = match(6, 0xE10, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const m = keyOf(recs[0].d);
  const hide = { STUB_HIDE: JSON.stringify(['shard_7']) };
  const t1 = runCronOnce(boardsMoved(recs, A, 7), { STARTS_FILE: { [m]: startOf(6, 0xE10, R4, FLOOR + 5 * 60000) } }, hide);
  T('[21] his shard unread: strike deferred (incomplete read), nothing struck or flagged', t1.code === 0 && /seat 0 wrote no record -- not every record shard was read this run, strike deferred/.test(t1.out) && acOf(t1, A).length === 0 && [A, B, C, D].every(s => fOf(t1, s) === 0) && !processedOf(t1).has(m), t1.out.slice(-600));
  const t2 = runCronOnce(boardsMoved(recs, A, 7), advance(t1.state, GRACE_STEP), hide);
  T('[21] ... grace over, the shard still unread: still deferred', /not every record shard was read this run, strike deferred/.test(t2.out) && acOf(t2, A).length === 0 && !avOf(t2, m, A), t2.out.slice(-500));
  const t3 = runCronOnce(boardsMoved(recs, A, 7), advance(t2.state, 60000));
  T('[21] ... the next complete read finds his record: not counted, no strike', t3.code === 0 && deferredOf(t3) === 0 && nocostOr(t3, m, A) && acOf(t3, A).length === 0 && !confOf(t3, m, A), t3.out.slice(-500));
  // the hold only waits: a seat that really wrote nothing is struck once a complete read still lacks it after the grace
  const gone = recs.filter(x => x.sid !== A);
  const u1 = runCronOnce(boardsWith(gone, ALL2), { STARTS_FILE: { [m]: startOf(6, 0xE10, R4, FLOOR + 5 * 60000) } }, hide);
  const u2 = runCronOnce(boardsWith(gone, ALL2), advance(u1.state, GRACE_STEP), hide);
  const u3 = runCronOnce(boardsWith(gone, ALL2), advance(u2.state, 60000));
  T('[21] he really left: held while the read is incomplete, struck on the first complete read after the grace', acOf(u1, A).length === 0 && acOf(u2, A).length === 0 && acOf(u3, A).length === 1 && avOf(u3, m, A) && avOf(u3, m, A).v === 'free' && fOf(u3, A) === 1 && [B, C, D].every(s => fOf(u3, s) === 0), u3.out.slice(-500));
  // a seat already seen agreeing on this match (pend.agreed: rotated off its shard) is not absent: no wait
  const st = startOf(6, 0xE11, R4, FLOOR + 5 * 60000); st.agreed = [v.pid(A)];
  const rot = refusal(6, 0xE11, R4, [1, 2, 3], 1);
  const w1 = runCronOnce(boardsWith(rot, ALL2), { STARTS_FILE: { [keyOf(rot[0].d)]: st } });
  T('[21] a seat already seen agreeing (rotated off his shard) does not hold the key', deferredOf(w1) === 0, w1.out.slice(-400));
}

// ---- [22] review 2: a backed losing side naming a non-host who quit ----
{
  const R6 = [A, B, C, D, E, F];   // host A; team 0 = A, B, C; team 1 = D, E, F
  const acc = (recs, sid) => v.team2Accusations(recsOf(recs)).find(x => x.sid === sid);
  // team 0 won (A, B, C claim it); F (a loser, not the host) quit; his teammates D, E refuse and name him
  const own = match(9, 0xF00, R6, { 3: { rank: 0, tag: TAG | 0b100000 }, 4: { rank: 0, tag: TAG | 0b100000 } }, [5]);
  T('[22] 3v3, the losers name their own non-host teammate who quit: not counted (nc quit)', (() => { const e = acc(own, F); return e && !e.strike && e.why === '' && e.nc === 'quit'; })(), JSON.stringify(acc(own, F)));
  // team 0 won; C (a winner, not the host) quit after the frame; A, B claim it; the losers D, E, F name C
  const opp = match(9, 0xF01, R6, { 3: { rank: 0, tag: TAG | 0b100 }, 4: { rank: 0, tag: TAG | 0b100 }, 5: { rank: 0, tag: TAG | 0b100 } }, [2]);
  T('[22] 3v3, the losers name a winner (not the host) who quit: not counted (nc quit)', (() => { const e = acc(opp, C); return e && !e.strike && e.nc === 'quit'; })(), JSON.stringify(acc(opp, C)));
  // e2e: two keys, different losers each time, naming the same quitting non-host -> never struck or judged
  const RB = [G, H, C, I, J, K];   // C at seat 2 again
  const opp2 = match(9, 0xF02, RB, { 3: { rank: 0, tag: TAG | 0b100 }, 4: { rank: 0, tag: TAG | 0b100 }, 5: { rank: 0, tag: TAG | 0b100 } }, [2]);
  const { r2, m2 } = twoRuns(9, opp, R6, 0xF01, opp2, RB, 0xF02);
  T('[22] e2e: named twice by disjoint losing sides: no strike, not judged, no -100 (Q56 / the old path own the refusers)', r2.code === 0 && acOf(r2, C).length === 0 && nocostOr(r2, m2, C) && scoreTo(r2, POINTS, C) == null && !confOf(r2, m2, C), r2.out.slice(-500));
  T('[22] ... logged as the losing side naming a non-host who left', owns(r2, m2) || /not counted \(the losing side names a non-host who left; record only\)/.test(r2.out));
  // the same shape with only one claimer (not backed): one colluding claim cannot buy the exemption -> left
  const thin = match(9, 0xF03, R6, { 1: { rank: 0 }, 2: { rank: 0 }, 3: { rank: 0, tag: TAG | 0b100000 }, 4: { rank: 0, tag: TAG | 0b100000 } }, [5]);
  T('[22] ... one claimer only (not backed): the quitter is still left (strike)', (() => { const e = acc(thin, F); return e && e.strike && e.why === 'left'; })(), JSON.stringify(acc(thin, F)));
  // residual (pinned): 2v2, a winner (not the host) quit and only his teammate wrote the win -> the losers' names count
  T('[22] residual: 2v2, a winner quit, his teammate alone claims the win, the losers name the quitter: left, strike',
    (() => { const e = acc(match(6, 0xF04, R4, { 0: { rank: 0, tag: TAG | 0b1000 }, 1: { rank: 0, tag: TAG | 0b1000 }, 2: { win: 1 } }, [3]), D); return e && e.strike && e.why === 'left'; })());
  // control: the losing modded host settles only the winners and quits; his honest teammates name him -> left, judged
  const RA = [A, B, C, D, E, F], RC = [A, G, H, I, J, K];
  const quit = (h, R) => match(9, h, R, { 1: { rank: 0, tag: TAG | 1 }, 2: { rank: 0, tag: TAG | 1 }, 3: { win: 1 }, 4: { win: 1 }, 5: { win: 1 } }, [0]);
  T('[22] control, pure: the losing host who settled the winners and quit, named by his teammates: left, strike', (() => { const e = acc(quit(0xF10, RA), A); return e && e.strike && e.why === 'left'; })());
  const q = twoRuns(9, quit(0xF10, RA), RA, 0xF10, quit(0xF11, RC), RC, 0xF11);
  T('[22] control e2e: first key a free strike (after the grace), second key with other teammates judged', avOf(q.r1, q.m1, A) && avOf(q.r1, q.m1, A).v === 'free' && avOf(q.r2, q.m2, A) && avOf(q.r2, q.m2, A).v === 'judge' && leavesOf(q.r2, A) >= 1 && confOf(q.r2, q.m2, A) && confOf(q.r2, q.m2, A).nf === 1, q.r2.out.slice(-500));
}

// ---- [23] review 2 (host-only): a modded host and two accounts cannot strike an honest non-host who finished ----
{
  // V (honest, seat 2) finished and wrote his claim; the modded host A and his teammate B wrote nothing usable and name V
  const acc = (recs, sid) => v.team2Accusations(recsOf(recs)).find(x => x.sid === sid);
  const why = (recs, sid) => { const e = acc(recs, sid); return e ? (e.why || '-') + (e.strike ? '!' : '') : 'none'; };
  const unset = refusal(6, 0xF20, R4, [], 0, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 2: { rank: 0 }, 3: { rank: 0 } });
  T('[23] nobody claimed, the host and his teammate name an opponent who wrote: not counted (nc host)', (() => { const e = acc(unset, C); return e && !e.strike && e.nc === 'host'; })(), JSON.stringify(acc(unset, C)));
  const thrown = match(6, 0xF21, R4, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 3: { rank: 0 } });
  T('[23] the claims say the namers won (they threw the win away), the named opponent wrote: not counted (nc host)', (() => { const e = acc(thrown, C); return e && !e.strike && e.nc === 'host'; })(), JSON.stringify(acc(thrown, C)));
  const RB = [E, F, C, G];   // C at seat 2 again, another modded host
  const thrown2 = match(6, 0xF22, RB, { 0: { rank: 0, tag: TAG | 0b100 }, 1: { rank: 0, tag: TAG | 0b100 }, 3: { rank: 0 } });
  const { r2, m2 } = twoRuns(6, thrown, R4, 0xF21, thrown2, RB, 0xF22);
  T('[23] e2e: two such keys with disjoint namers: the honest non-host never struck or judged', r2.code === 0 && acOf(r2, C).length === 0 && !confOf(r2, m2, C) && scoreTo(r2, POINTS, C) == null && leavesOf(r2, C) === 0, r2.out.slice(-500));
  T('[23] ... logged as not the host', owns(r2, m2) || /not counted \(he wrote a record and is not the host; record only\)/.test(r2.out));
  // residual (pinned): the roster is the writers' majority (rosterConsensus), so colluders who are most of a key's
  //   writers decide who sat at seat 0. 2v2: the modded host H and two accounts X, Y swap the honest V into seat 0 in
  //   their own three records (H writes himself at V's seat); V's own record (the truth) is outvoted and unseated.
  //   X and Y refuse and name seat 0 -> V reads as the host, nobody claimed, everyone wrote: unsettled, strike. The
  //   same floor as the rest of the ledger (a writer majority can write any result; Q51 strikes the lone honest
  //   dissenter); judging V still takes two keys with disjoint namers (H plus four accounts)
  const TRUE = [A, B, C, D], LIE = [C, B, A, D];   // A = H (modded host), B = X, C = V (honest), D = Y
  const relabel = [
    { sid: A, d: t2(6, 0xF30, 2, LIE, { rank: 0 }) },
    { sid: B, d: t2(6, 0xF30, 1, LIE, { rank: 0, tag: TAG | 1 }) },
    { sid: D, d: t2(6, 0xF30, 3, LIE, { rank: 0, tag: TAG | 1 }) },
    { sid: C, d: t2(6, 0xF30, 2, TRUE, { win: 1 }) },
  ];
  T('[23] residual: a colluding writer majority relabels seat 0 (2v2: host + two accounts): the honest V reads as the host, unsettled strike', why(relabel, C) === 'unsettled!', why(relabel, C));
}

// ---- [24] review 3: one account, one testimony -- extra copies of a record add no roster votes ----
{
  // 2v2: the honest host A and his teammate C (V) won and wrote it; the modded losers B and D refuse, name seat 0 and
  //   seat V there in their own records (LIE: V at 0, A at 1), each copying it onto more shards (one row per shard).
  //   Counted per record, the lying rows outvote the true ones seat by seat: V reads as the host who settled nobody
  //   (his and A's claims sit at seats the "roster" gives to others) -> unsettled strike, twice -> judged. Counted
  //   once per account it is two against two: no seat-0 majority, nobody accused.
  const acc = (recs, sid) => v.team2Accusations(recsOf(recs)).find(x => x.sid === sid);
  const dup = (h, R, n) => {   // R = [host, V, X, Y]
    const LIE = [R[1], R[0], R[2], R[3]];
    const out = [{ sid: R[0], d: t2(6, h, 0, R, { win: 0 }) }, { sid: R[1], d: t2(6, h, 1, R, { win: 0 }) }];
    for (let k = 0; k < n; k++) out.push({ sid: R[2], d: t2(6, h, 2, LIE, { rank: 0, tag: TAG | 1 }) }, { sid: R[3], d: t2(6, h, 3, LIE, { rank: 0, tag: TAG | 1 }) });
    return out;
  };
  const RA = [A, C, B, D], RB = [E, C, F, G];   // V = C both times, other hosts and namers
  T('[24] control: one record each, V is not accused', !acc(dup(0xF40, RA, 1), C));
  T('[24] three copies each: V still not accused (one vote per account)', !acc(dup(0xF41, RA, 3), C), JSON.stringify(acc(dup(0xF41, RA, 3), C)));
  T('[24] ... and the namers\' doctored seat 0 names nobody else either', v.team2Accusations(recsOf(dup(0xF41, RA, 3))).length === 0);
  const { r2, m2 } = twoRuns(6, dup(0xF42, RA, 3), RA, 0xF42, dup(0xF43, RB, 3), RB, 0xF43);
  T('[24] e2e: two such keys with disjoint namers: the honest V never struck or judged', r2.code === 0 && acOf(r2, C).length === 0 && !confOf(r2, m2, C) && scoreTo(r2, POINTS, C) == null && leavesOf(r2, C) === 0, r2.out.slice(-500));
  // a real leaver's accomplice cannot hide him by copying a record either: control stays struck
  const left = (h, R) => refusal(6, h, R, [1, 2, 3], 1).concat([{ sid: R[1], d: t2(6, h, 1, [R[1], R[0], R[2], R[3]], { rank: 0 }) }]);
  T('[24] control: the host left, his teammate copies a doctored record: still a left strike', (() => { const e = acc(left(0xF44, [A, B, C, D]), A); return e && e.strike && e.why === 'left'; })(), JSON.stringify(acc(left(0xF44, [A, B, C, D]), A)));
  // the honest host's own record rotates off his shard a day later (he kept playing): still no strike. Today this rests
  //   on a side effect -- the hold takes the key off the consistent list, the start attestation (hours old) matures it
  //   through the orphan verdict on the same run, and he is exempt there as a writer seen before. A change to that order
  //   (Q66 / Q56) must keep this green.
  const R = [A, B, C, D], h = 0xF45, m = keyOf(t2(6, h, 0, R));
  const recs = match(6, h, R, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const q1 = runCron(boardsWith(recs, ALL2), { STARTS_FILE: { [m]: startOf(6, h, R, FLOOR + 5 * 60000) } });
  const q2 = runCron(boardsWith(recs.filter(x => x.sid !== A), ALL2), advance(q1.state, 86400000));
  T('[24] the honest host\'s record rotates off a day later: no strike, no -100, the key processed', q1.code === 0 && q2.code === 0 && acOf(q2, A).length === 0 && !t2acIsStrikeOf(q2, m, A) && scoreTo(q2, POINTS, A) == null && leavesOf(q2, A) === 0 && processedOf(q2).has(m), q2.out.slice(-500));
  // the hold counts accounts too: a loser's extra copy that claims the absent seat cannot make the gap disappear and
  //   skip the wait (counted per record, seat 0 reads present, nothing is held, and the honest host whose record lands
  //   a minute late is struck on the first run as a leaver)
  {
    const hh = 0xF46, mm = keyOf(t2(6, hh, 0, R4));
    const all = match(6, hh, R4, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
    const fake = { sid: D, d: t2(6, hh, 0, R4, { rank: 0, tag: TAG | 1 }) };   // D's second row (another shard), claiming seat 0
    const w1 = runCronOnce(boardsWith(all.filter(x => x.sid !== A).concat([fake]), ALL2), { STARTS_FILE: { [mm]: startOf(6, hh, R4, FLOOR + 5 * 60000) } });
    T('[24] a copy claiming the absent host\'s seat: still deferred on the first run, no strike', w1.code === 0 && deferredOf(w1) === 1 && acOf(w1, A).length === 0 && !avOf(w1, mm, A), w1.out.slice(-600));
    const w2 = runCronOnce(boardsWith(all.concat([fake]), ALL2), advance(w1.state, 60000));
    T('[24] ... his record lands a minute later: no strike, never judged', w2.code === 0 && acOf(w2, A).length === 0 && !t2acIsStrikeOf(w2, mm, A) && !confOf(w2, mm, A) && leavesOf(w2, A) === 0, w2.out.slice(-600));
  }
  const ta = SRC.slice(SRC.indexOf('function team2Accusations'), SRC.indexOf('function t2acVerdict'));
  const ap = SRC.slice(SRC.indexOf('function applyTeam2Accusations'), SRC.indexOf('// clamp-aware authoritative leaver deduction'));
  T('[24] pins: the detector and the pass (hold included) read one record per account', /^function team2Accusations\(g, own\) \{\n {2}g = firstPerAccount\(g\);/m.test(ta) && /const g = firstPerAccount\(gr\.groups\[m\]\);/.test(ap));
}

// ---- [25] cloud audit Q69: a leave needs the accused's own start attestation ----
{
  // the host A never played: C and D make up a 2v2 key, write refusals naming seat 0 and start records of their own
  //   (the pending entry registers, but only C and D wrote a start: A and his "teammate" B are names in their roster)
  const recs = refusal(6, 0xF50, R4, [2, 3], 1);
  const acc = (own) => v.team2Accusations(recsOf(recs), own).find(x => x.sid === A);
  T('[25] detector: no own start -> not counted (nc nostart), host field set', (() => { const e = acc(sid => sid !== A && sid !== B); return e && !e.strike && e.why === '' && e.nc === 'nostart' && e.host === true; })(), JSON.stringify(acc(sid => sid !== A && sid !== B)));
  T('[25] detector: with his own start -> left strike (as before)', (() => { const e = acc(() => true); return e && e.strike && e.why === 'left'; })());
  T('[25] detector: no own-evidence callback (unit use) -> left strike (as before)', (() => { const e = acc(); return e && e.strike && e.why === 'left'; })());
  // e2e: two such keys a day apart with disjoint namers (C, D then F, G) -- before Q69 a free strike, then judged
  const RA = [A, B, C, D], RB = [A, E, F, G];
  const frame = (h, R, noStart) => {
    const m1 = keyOf(t2(6, h, 0, R)), m2 = keyOf(t2(6, h + 1, 0, RB));
    const r1 = runCron(boardsWith(refusal(6, h, R, [2, 3], 1), ALL2), { STARTS_FILE: { [m1]: startOf(6, h, R, FLOOR + 5 * 60000, noStart ? [A, B] : [B]) } });
    const f2 = advance(r1.state, 86400000);
    f2.STARTS_FILE = Object.assign(f2.STARTS_FILE || {}, { [m2]: startOf(6, h + 1, RB, FLOOR + 5 * 60000, noStart ? [A, E] : [E]) });
    const r2 = runCron(boardsWith(refusal(6, h, R, [2, 3], 1).concat(refusal(6, h + 1, RB, [2, 3], 1)), ALL2), f2);
    const r3 = runCron(boardsWith(refusal(6, h, R, [2, 3], 1).concat(refusal(6, h + 1, RB, [2, 3], 1)), ALL2), advance(r2.state, v.STARTS_MATURITY_MS + 60000));
    return { r1, r2, r3, m1, m2 };
  };
  const fr = frame(0xF52, RA, true);
  T('[25] e2e frame runs exit 0', fr.r1.code === 0 && fr.r2.code === 0 && fr.r3.code === 0, fr.r2.out.slice(-600));
  T('[25] e2e frame: A never struck, never judged -- no confession, no -100, no exit rate (through maturity)', acOf(fr.r3, A).length === 0 && !confOf(fr.r3, fr.m1, A) && !confOf(fr.r3, fr.m2, A)
    && scoreTo(fr.r2, POINTS, A) == null && scoreTo(fr.r3, POINTS, A) == null && leavesOf(fr.r3, A) === 0, 'ac=' + acOf(fr.r3, A).length + ' leaves=' + leavesOf(fr.r3, A));
  T('[25] e2e frame: his "teammates" B / E (never played, not named) untouched too', [B, E].every(s => leavesOf(fr.r3, s) === 0 && scoreTo(fr.r3, POINTS, s) == null));
  T('[25] e2e frame: record-only nostart on both keys, no signal row for A, the namers carry un', avOf(fr.r2, fr.m1, A) && avOf(fr.r2, fr.m1, A).v === 'nostart' && avOf(fr.r2, fr.m2, A) && avOf(fr.r2, fr.m2, A).v === 'nostart'
    && !(sigOf(fr.r2).players || {})[v.pid(A)] && [C, D, F, G].every(s => (((sigOf(fr.r2).players || {})[v.pid(s)] || {}).un | 0) >= 1), JSON.stringify(avOf(fr.r2, fr.m1, A)));
  T('[25] e2e frame: logged', /team2 accusation [^\n]*not counted \(he never wrote his own record for this match, Q69; record only\)/.test(fr.r1.out + fr.r2.out));
  const ctl = frame(0xF54, RA, false);
  // (two exit-rate hits by the second run: the first key matured through the orphan verdict -- he wrote his start and no
  //   settle record -- and the judge confession on the second)
  T('[25] control: the same keys with his own start -> struck, then judged (-100, exit rate)', acOf(ctl.r2, A).length === 2 && avOf(ctl.r2, ctl.m2, A) && avOf(ctl.r2, ctl.m2, A).v === 'judge' && scoreTo(ctl.r2, POINTS, A) === 1900 && leavesOf(ctl.r2, A) === 2,
    JSON.stringify(acOf(ctl.r2, A)) + ' pts=' + scoreTo(ctl.r2, POINTS, A) + ' leaves=' + leavesOf(ctl.r2, A));
  // pure pass: a pending entry from an older build (no `started`) -- a start of his read this run counts
  const m = keyOf(t2(6, 0xF56, 0, R4));
  const leftRecs = recsOf(refusal(6, 0xF56, R4, [1, 2, 3], 1));
  const startD = (seat) => { const d = [0xB2, 3, 6, 0xF56, 4321, seat, 0, 0, 4, 0, 0, 0, 0, 0, 0]; for (const sid of R4) { const p = sidPair(sid); d.push(p[0], p[1]); } return d; };
  const pass = (mod, startRecs, prevAv) => {
    const now = Date.now(), legacy = startOf(6, 0xF56, R4, FLOOR + 5 * 60000); delete legacy.started;
    const sig = { players: {}, flagged: {}, t2ah: { [m]: now - 3600000 }, t2av: prevAv ? { [m + '|' + v.pid(A)]: Object.assign({ t: now - 60000 }, prevAv) } : {} };
    const gr = { groups: { [m]: leftRecs.slice() }, consistentMatches: [], inconsistentGroups: [{ m, g: leftRecs }] };
    const res = mod.applyTeam2Accusations(gr, sig, new Set(), now, { complete: true, graceMs: v.ABSENT_GRACE_MS, starts: { [m]: legacy }, startRecs });
    return { res, av: sig.t2av[m + '|' + v.pid(A)], sig };
  };
  const aStart = [{ steamID: A, d: startD(0) }];
  T('[25] older pending entry, his start read this run: left strike', (() => { const x = pass(v, aStart); return x.res.strikes === 1 && x.av && x.av.v === 'free'; })());
  T('[25] older pending entry, no start of his read: not counted (nostart)', (() => { const x = pass(v, [{ steamID: B, d: startD(1) }]); return x.res.strikes === 0 && x.res.nostart === 1 && x.av && x.av.v === 'nostart'; })());
  T('[25] a later run that reads his start turns a stored nostart into a strike', (() => { const x = pass(v, aStart, { v: 'nostart' }); return x.res.strikes === 1 && x.av && x.av.v === 'free'; })());
  T('[25] an incomplete read stores no nostart (his start may sit on the unread shard)', (() => {
    const now = Date.now(), legacy = startOf(6, 0xF56, R4, FLOOR + 5 * 60000); delete legacy.started;
    const sig = { players: {}, flagged: {}, t2ah: {}, t2av: {} };
    const res = v.applyTeam2Accusations({ groups: { [m]: leftRecs.slice() }, consistentMatches: [], inconsistentGroups: [] }, sig, new Set(), now, { complete: false, graceMs: v.ABSENT_GRACE_MS, starts: { [m]: legacy }, startRecs: [] });
    return res.nostart === 0 && !sig.t2av[m + '|' + v.pid(A)];
  })());
  // review 3, shape 1b: his own record was read here before (stored nocost), it rotated off -> 'left' is not a strike
  T('[25] 1b: a stored nocost on the host keeps a later left from striking him, logged once', (() => {
    const x = pass(v, aStart, { v: 'nocost' });
    return x.res.strikes === 0 && x.av.v === 'nocost' && x.av.r === 1 && !(x.sig.t2ac || {})[v.pid(A)];
  })());
  const RC = [A, B, C, D], h = 0xF58, mr = keyOf(t2(6, h, 0, RC));
  const both = match(6, h, RC, { 2: { rank: 0, tag: TAG | 1 }, 3: { rank: 0, tag: TAG | 1 } });
  const q1 = runCron(boardsWith(both, ALL2), { STARTS_FILE: { [mr]: startOf(6, h, RC, FLOOR + 5 * 60000) } });
  const q2 = runCron(boardsWith(both.filter(x => x.sid !== A), ALL2), advance(q1.state, 10 * 60000));   // rotated off before the entry matures
  // (stacked with Q56 the team-dissent pass may own this key instead: then no strike either, and nothing to log here)
  T('[25] 1b e2e: nocost while his record stands, then it rotates off: no strike, no -100, no exit rate', q1.code === 0 && q2.code === 0 && nocostOr(q1, mr, A)
    && acOf(q2, A).length === 0 && nocostOr(q2, mr, A) && scoreTo(q2, POINTS, A) == null && leavesOf(q2, A) === 0, JSON.stringify(avOf(q2, mr, A)) + ' ' + q2.out.slice(-400));
  T('[25] 1b e2e: logged', owns(q2, mr) || /team2 accusation [^\n]*\(left\) -> not counted \(his own record for this match was read before, Q69\)/.test(q2.out));
  // mutation self-checks: each guard removed -> its scenario strikes A again
  const mutants = [
    ['own-start gate removed', "if (own && !own(sid)) nc = 'nostart';", "if (false) nc = 'nostart';", (mod) => { const x = pass(mod, [{ steamID: B, d: startD(1) }]); return x.res.strikes === 1; }],
    ['start records of this run ignored', "if (hold) for (const r of hold.startRecs || [])", "if (false) for (const r of hold.startRecs || [])", (mod) => { const x = pass(mod, aStart); return x.res.strikes === 0; }],
    ['1b rule removed', "if (!t2acIsStrike(prev) && e.host && e.why === 'left' && prev && prev.v === 'nocost') {", "if (false) {", (mod) => { const x = pass(mod, aStart, { v: 'nocost' }); return x.res.strikes === 1; }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[25] mutant ' + label + ': anchor not found exactly once'); continue; }
    const file = path.join(__dirname, '..', '.mutant-t2ac-q69-' + process.pid + '.js');
    try {
      fs.writeFileSync(file, SRC.replace(from, to));
      delete require.cache[require.resolve(file)];
      T('[25] mutant: ' + label + ' -> its scenario goes red', check(require(file)));
    } finally { try { fs.unlinkSync(file); } catch (e) {} delete require.cache[file]; }
  }
  const ap = SRC.slice(SRC.indexOf('function applyTeam2Accusations'), SRC.indexOf('// clamp-aware authoritative leaver deduction'));
  T('[25] pins: the pass asks own evidence; the main path hands it this run\'s starts', /const acc = team2Accusations\(g, own\);/.test(ap)
    && /starts: startsPending, startRecs: starts(, contested: rcRes\.contested)? \}\)/.test(SRC) && /RUN\.unattested = \(RUN\.unattested \| 0\) \+ t2acRes\.nostart;/.test(SRC));
}

// ---- [20b] wiring pins (review 2) ----
{
  const ap = SRC.slice(SRC.indexOf('function applyTeam2Accusations'), SRC.indexOf('// clamp-aware authoritative leaver deduction'));
  T('[20b] the hold: a new strike with an absent seat (minus pend.agreed) goes through absenceHold with the run\'s read state and grace', /absentRosterSeats\(g\)\.filter\(x => agreed\.indexOf\(pid\(String\(x\.steamID\)\)\) < 0\)/.test(ap) && /absenceHold\(absent, st, now, hold\.complete, hold\.graceMs\)/.test(ap) && /heldKeys\.add\(m\); res\.held\+\+;/.test(ap));
  T('[20b] a held key leaves the settle / flag paths this run', /const keep = \(c\) => processed\.has\(c\.m\) \|\| t2lv\[c\.m\] \|\| \(!struck\.has\(c\.m\) && !heldKeys\.has\(c\.m\)\);/.test(ap));
  const ps = SRC.slice(SRC.indexOf('function pruneSignals'), SRC.indexOf('function saveSignals'));
  T('[20b] gap stamps (t2ah) age out in pruneSignals', /s\.t2ah/.test(ps));
  const ta = SRC.slice(SRC.indexOf('function team2Accusations'), SRC.indexOf('function t2acVerdict'));
  T('[20b] unsettled / costly are the host\'s (roster seat 0) alone; a backed losing side naming a non-host who quit does not count', /host = seatOf\[sid\] === 0/.test(ta) && /else if \(!host\) nc = 'host';/.test(ta) && /if \(backed && !host && accusers\.every\(x => teamOf\(x\) !== W\)\) nc = 'quit';/.test(ta) && /const backed = W != null && new Set\(claims\.map\(r => String\(r\.steamID\)\)\)\.size >= 2;/.test(ta));
  T('[20b] the run summary reports deferred strikes', /t2acRes\.held \? ' \(' \+ t2acRes\.held \+ ' deferred\)' : ''/.test(SRC));
}

if (failN) { console.log('team2-accuse: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-accuse: all passed');
