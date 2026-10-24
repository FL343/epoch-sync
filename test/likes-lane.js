'use strict';
// Likes lane wiring (O520, client knife 5.4d step L1, cloud workbench W79): processLikes in validate.js over the REAL main()
// against an offline board stub (pinned clock), the plan's local reconcile round (gm_ruffle mvp/KNIFE_54D_LIKES_PLAN.md
// section 3, step 3): a finished quick match + like boxes with the plan's positive and negative cases, then a second pass.
// The rules themselves are like-plan.js (test/like-plan.js); this file pins how validate.js feeds and uses them:
//   [1] before the match settles: the likes given in it wait (nothing counted, nothing written); the six negatives of the
//       plan never count (oneself / premade pair / friends' room / a SteamID not in the match / an arbitrary SteamID on a
//       board row / a player this job has not settled yet); the state file holds keyed tokens only
//   [2] the run that settles the match counts the waiting likes (certify, this run's keys) and the board like whose target
//       is known now; like_count gets exactly the two rows that changed, ForceUpdate with the plan's details layout
//   [3] a second pass over the same boxes (the board now shows the rows): nothing counted, nothing written, the state
//       file not rewritten; a second board like of the same pair inside 7 days is refused (week)
//   [4] the settle is untouched: the same runs without any like on the boxes leave every other state file byte for byte
//       the same and post the same board writes (the lane changes no match's settlement and no account's numbers)
//   [5] dry-run (APPLY_MMR=0): no like_count write, no state file
//   [6] privacy: no raw SteamID, no match hash in the clear in any written file; every like token is a 16-hex key; two
//       runs of one voter share no token (the counts per target are public on like_count by design and left out)
//   [7] the boards: provisioned on the main app and by the playtest / demo bootstrap (box client-writable + friends-reads,
//       counts trusted); the main channel counts and writes too; a run that cannot reach the like boards still certifies
//       the keys it settled (the waiting likes count, the rows are written once the boards are back)
//   [8] the audit closure: a target without settled XP is never counted -- not on a board row, not when a waiting like's
//       match settles (one named only by the others' rosters)
//   [9] source pins + mutation self-checks (settle keys not handed over / the early-exit calls gone / the known rule gone)
//   [10] (W79 rework) a like_count read answering 200 with a broken body (not JSON / no entry info) is a failed read, the
//       whole board and a capped read's single reads alike: nothing written (a restored older state would otherwise write a
//       count DOWN), the like still counted into the state; LIKES_STRICT_BODY=0 shows what the strict read prevents
//   [11] (W79 rework) team match: a stranger teammate's like counts, under the pair token (one per pair per 7 days, shared
//       with board likes; a waiting one is checked at its settle), an opponent's every match
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'CONSOLATION_XP', 'REPORT_LB', 'TRUST_LB', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY',
  'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY', 'FB_DIGEST_TO', 'RESEND_API_KEY', 'CHAT_MUTE_LB', 'CHAT_REPORT_LB', 'LIKE_BOX_LB', 'LIKE_COUNT_LB', 'LIKES_STRICT_BODY', 'PAGE_CAP',
  'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC', 'SEASON_NOW'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
for (const k of FILE_VARS) delete process.env[k];
const v = require(VALIDATE);
const LP = require(path.join(__dirname, '..', 'like-plan.js'));
const L = LP.LIKE;

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

// stateless board stub + pinned clock (as test/report-unlinkable.js); every POST is logged
const STUB = [
  "const fs = require('fs');",
  'const FAKE = Number(process.env.FAKE_NOW || 0);',
  'if (FAKE) { const RealDate = Date; class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } } global.Date = FakeDate; }',
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  // read faults (W79 rework): FAULT = { "<board id>": { all | around: 500 | "bad" (200, not JSON) | "noinfo" (200, JSON without the entry info) } }
  "const FAULT = JSON.parse(process.env.FAULT || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t, json: async () => o }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  "    if (/FindOrCreateLeaderboard/.test(u)) { const nm = /name=([^&]+)/.exec(String(init.body || \"\")); if (process.env.FAIL_CREATE && nm && new RegExp(process.env.FAIL_CREATE).test(decodeURIComponent(nm[1]))) return resp({ error: 'down' }, 503); const ex = nm && FX.boards.find(b => b.name === decodeURIComponent(nm[1])); const id = ex ? ex.id : nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }",
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const idS = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[idS];',
  '    let ents = b ? b.entries.slice() : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  "    const f = FAULT[idS] && FAULT[idS][around ? 'around' : 'all'];",
  "    if (f === 500) return resp({ error: 'down' }, 500);",
  "    if (f === 'bad') return { ok: true, status: 200, text: async () => '<html>busy</html>', json: async () => { throw new Error('not json'); } };",
  "    if (f === 'noinfo') return resp({ response: {} });",
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    const re = /rangeend=([0-9]+)/.exec(u);',
  '    if (!around && rs && re) ents = ents.slice(Number(rs[1]) - 1, Number(re[1]));',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
const HELPER = ['stub.js', 'fx.json', 'post.log'];

// files: { name: content } carried into the temp cwd (the state files under their default names). Returns the exit code,
//   output, the POSTs and every file the run left / created or changed.
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'likes-lane-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const before = {};
    for (const [name, body] of Object.entries(files || {})) { fs.writeFileSync(path.join(dir, name), body); before[name] = body; }
    const base = Object.assign({}, process.env);
    for (const k of SCRUB.concat(FILE_VARS)) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's', PT_MODE: '1',
      SEASON_NOW: '2026-11-20T00:00:00Z', FAKE_NOW: String(T0),
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',
    }, env || {});
    for (const k of Object.keys(e)) if (e[k] === null) delete e[k];
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const left = {}, wrote = {};
    for (const name of fs.readdirSync(dir)) {
      if (HELPER.indexOf(name) >= 0) continue;
      const body = fs.readFileSync(path.join(dir, name), 'utf8');
      left[name] = body;
      if (before[name] !== body) wrote[name] = body;
    }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, left, wrote };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const tail = (r) => ' // ' + r.out.slice(-700);

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 20, 9, 0);                     // 2026-11-20 09:00Z
const T1 = T0 + v.STARTS_MATURITY_MS + MIN;                   // past the start maturity: the match settles
const T2 = T1 + 10 * MIN, T3 = T1 + 20 * MIN;
const um = (ms) => Math.floor(ms / MIN);
// players: A B C play a quick match (K1); G H J a premade-pair quick match (K3); M N a friends' room (K4); E plays nothing;
//   F plays nothing (a voter needs no history: decision 2026-10-22)
const S = (n) => '765611980000' + String(n).padStart(5, '0');
const A = S(101), B = S(102), C = S(103), E = S(105), F = S(106), G = S(107), H = S(108), J = S(109), M = S(110), N = S(111);
const RAW_SIDS = [A, B, C, E, F, G, H, J, M, N];
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// ledger record, result-reporter wire form (as test/channel-state-files.js): magic, ver, mt, hash, seed, seat, rank,
//   (progress<<1)|win, pc, dur, scores x pc, disp, roster (lo, hi) x pc. Start records (0xB2) zero every result field.
function rec(magic, mt, hash, seat, sids) {
  const settle = magic === 0xB1, pc = sids.length;
  const d = [magic, settle ? 3 : 1, mt, hash | 0, 1234, seat, settle ? seat + 1 : 0, settle ? ((6 << 1) | (seat === 0 ? 1 : 0)) : 0, pc, settle ? 720 : 0];
  for (let i = 0; i < pc; i++) d.push(settle ? 9000 - 4000 * i : 0);
  d.push(0);
  for (const s of sids) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const K1 = 0x6101, K3 = 0x6103, K4 = 0x6104;
const KEY1 = K1 + '_1234_1';
const MATCHES = [[K1, 1, [A, B, C]], [K3, 1 | (1 << 4), [G, H, J]], [K4, 10, [M, N]]];
const BOX = 60, CNT = 61;
// box rows: { voter: [ entries ] } -> client like-box.js layout (like-plan encodeBox); score = sent count
const ML = (sid, mh, ms) => ({ sid, ref: mh, kind: L.KIND_MATCH, min: um(ms) });
const BL = (sid, ms) => ({ sid, ref: 0, kind: L.KIND_BOARD, min: um(ms) });
function world(boxes, counts, extra, noLikeBoards, matches) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const [mh, mt, sids] of (matches || MATCHES)) sids.forEach((sid, seat) => {
    boards[0].entries.push({ steamID: sid, score: 1, details: rec(0xB2, mt, mh, seat, sids) });   // start attestations
    boards[1 + (mh & 3)].entries.push({ steamID: sid, score: 1, details: rec(0xB1, mt, mh, seat, sids) });   // results: consistent
  });
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] });
  if (!noLikeBoards) {
    boards.push({ id: BOX, name: 'like_box', entries: Object.keys(boxes || {}).map(sid => ({ steamID: sid, score: boxes[sid].length, details: LP.encodeBox(boxes[sid]) })) });
    boards.push({ id: CNT, name: 'like_count', entries: (counts || []).map(c => ({ steamID: c.sid, score: c.score, details: c.details })) });
  }
  return boards.concat(extra || []);
}
// like_count writes of a run: [{ sid, score, details }] (details decoded from the pre-percent-encoded int32-LE bytes)
function cntWrites(r, id) {
  return r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('(^|&)leaderboardid=' + (id || CNT) + '(&|$)').test(p.body)).map(p => {
    const q = {}; for (const kv of p.body.split('&')) { const i = kv.indexOf('='); q[kv.slice(0, i)] = kv.slice(i + 1); }
    const bytes = Buffer.from((q.details || '').split('%').filter(Boolean).map(h => parseInt(h, 16)));
    const det = []; for (let i = 0; i + 4 <= bytes.length; i += 4) det.push(bytes.readInt32LE(i));
    return { sid: q.steamid, score: Number(q.score), method: q.scoremethod, details: det };
  }).sort((a, b) => (a.sid < b.sid ? -1 : 1));
}
const likesOf = (r) => { try { return JSON.parse(r.left['likes.json']); } catch (e) { return null; } };
const K = LP.keys(v.pid);
const cntOf = (st, sid) => (st && st.cnt && st.cnt[K.target(sid)]) || null;
const carry = (r) => { const o = {}; for (const [n, b] of Object.entries(r.left)) o[n] = b; return o; };

// ---- the round ----
const BOX1 = {
  [A]: [ML(B, K1, T0 - 5 * MIN), ML(A, K1, T0 - 5 * MIN), ML(E, K1, T0 - 5 * MIN), BL(E, T0 - 4 * MIN)],   // + / self / not in the match / arbitrary SteamID
  [C]: [ML(A, K1, T0 - 3 * MIN)],                                                                        // +
  [G]: [ML(H, K3, T0 - 3 * MIN)],                                                                        // premade pair
  [M]: [ML(N, K4, T0 - 3 * MIN)],                                                                        // friends' room
  [F]: [BL(B, T0 - 2 * MIN)],                                                                            // board like: B not settled yet
};
console.log('=== likes-lane [1] before the match settles: waiting likes, the negatives never count ===');
const r1 = runCron(world(BOX1), null, {});
const st1 = likesOf(r1);
{
  T('[1] run ok', r1.code === 0, tail(r1));
  T('[1] two match likes wait for the settle, nothing counted', /likes: counted \+0 \(match 0, board 0\), waiting \+2/.test(r1.out), tail(r1));
  T('[1] the negatives: oneself / not in the match / premade pair / friends\' room / unknown players (E on a board row, B not settled yet)',
    /self 1/.test(r1.out) && /notin 1/.test(r1.out) && /premade 1/.test(r1.out) && /notmm 1/.test(r1.out) && /unknown 2/.test(r1.out), (r1.out.match(/likes: [^\n]*/) || [''])[0]);
  T('[1] no like_count write', cntWrites(r1).length === 0);
  T('[1] state file written with the two waiting likes', st1 && Object.keys(st1.pend || {}).length === 2 && !Object.keys(st1.cnt || {}).length, JSON.stringify(st1));
}

console.log('=== likes-lane [2] the run that settles the match counts ===');
const r2 = runCron(world(BOX1), carry(r1), { FAKE_NOW: String(T1) });
const st2 = likesOf(r2);
const w2 = cntWrites(r2);
{
  T('[2] run ok, the match settled', r2.code === 0 && JSON.parse(r2.left['processed.json'] || '[]').indexOf(KEY1) >= 0, tail(r2));
  T('[2] counted 3: the two waiting match likes (certified this run) + the board like (B known now)', /likes: counted \+3 \(match 2, board 1\)/.test(r2.out), (r2.out.match(/likes: [^\n]*/) || [''])[0]);
  T('[2] keys certified 2: the two quick matches settled this run (K1, the premade K3); the friends\' room is no matchmade key', /keys certified 2/.test(r2.out) && JSON.parse(r2.left['processed.json'] || '[]').indexOf(K4 + '_1234_10') >= 0 &&
    Object.keys(st2.ok || {}).length === 2 && st2.ok[K.key(KEY1)] !== undefined && st2.ok[K.key(K3 + '_1234_' + (1 | (1 << 4)))] !== undefined && st2.ok[K.key(K4 + '_1234_10')] === undefined, JSON.stringify(st2.ok));
  T('[2] state: B 2 (match 1, board 1), A 1 (match 1); nothing waits', JSON.stringify(cntOf(st2, B)) === JSON.stringify({ n: 2, s: 2, sn: 0, m: 1, b: 1 }) && JSON.stringify(cntOf(st2, A)) === JSON.stringify({ n: 1, s: 1, sn: 0, m: 1, b: 0 }) &&
    !Object.keys(st2.pend || {}).length && Object.keys(st2.cnt).length === 2, JSON.stringify(st2 && st2.cnt));
  T('[2] like_count: exactly A and B written, ForceUpdate, score = lifetime, details [0xDC | ver, season, season count, match part, board part]',
    w2.length === 2 && w2.every(w => w.method === 'ForceUpdate') && JSON.stringify(w2.map(w => [w.sid, w.score, w.details])) ===
    JSON.stringify([[A, 1, [L.COUNT_MAGIC | (L.COUNT_VER << 8), 0, 1, 1, 0]], [B, 2, [L.COUNT_MAGIC | (L.COUNT_VER << 8), 0, 2, 1, 1]]].sort((a, b) => (a[0] < b[0] ? -1 : 1))), JSON.stringify(w2));
  T('[2] the count rows decode with the client reader (like-plan decodeCount)', w2.every(w => { const c = LP.decodeCount(w.score, w.details); return c && c.n === w.score; }));
}

{
  // the voters dropped their entries before the settle (the client keeps them 30 min, a like may wait 2 days): the waiting
  //   likes still count at the settle and their rows are still written (the targets named from this run's records)
  const r2e = runCron(world({}), carry(r1), { FAKE_NOW: String(T1) });
  T('[2] boxes emptied before the settle: the two waiting likes count anyway and A / B are written', r2e.code === 0 && /likes: counted \+2 \(match 2, board 0\)/.test(r2e.out) &&
    JSON.stringify(cntWrites(r2e).map(w => [w.sid, w.score])) === JSON.stringify([[A, 1], [B, 1]]), JSON.stringify(cntWrites(r2e)) + (r2e.out.match(/likes: [^\n]*/) || [''])[0]);
}

console.log('=== likes-lane [3] a second pass over the same boxes ===');
const counts2 = w2.map(w => ({ sid: w.sid, score: w.score, details: w.details }));
const BOX3 = Object.assign({}, BOX1, { [F]: [BL(B, T0 - 2 * MIN), BL(B, T2 - MIN)] });   // F likes B again (a new click) 2h later
const r3 = runCron(world(BOX3, counts2), carry(r2), { FAKE_NOW: String(T2) });
{
  T('[3] run ok (the no-fresh-match exit: the match is processed)', r3.code === 0 && /no fresh matches/.test(r3.out), tail(r3));
  T('[3] nothing counted, the second board like of the pair inside 7 days refused (week), the old entries taken already (dup)', !/likes: counted \+[1-9]/.test(r3.out) && /week 1/.test(r3.out) && /dup /.test(r3.out), (r3.out.match(/likes: [^\n]*/) || [''])[0] + tail(r3));
  T('[3] no like_count write (the board shows the state)', cntWrites(r3).length === 0, JSON.stringify(cntWrites(r3)));
  const r3b = runCron(world(BOX1, counts2), carry(r2), { FAKE_NOW: String(T2) });
  T('[3] the same boxes again: likes.json not rewritten (idempotent, unchanged text)', r3b.code === 0 && r3b.wrote['likes.json'] === undefined && cntWrites(r3b).length === 0, Object.keys(r3b.wrote).join(',') + tail(r3b));
}

{
  // a capped read of the count board (PAGE_CAP): the players of this run not on the pages read are read one by one -- A's row
  //   (right) is left alone, B (no row) written; nothing written blind
  const filler = Array.from({ length: 5000 }, (_, i) => ({ sid: String(76561197900000000n + BigInt(i)), score: 9, details: [0] }));
  const capped = filler.concat([{ sid: A, score: 1, details: LP.countRow(cntOf(st2, A)).details }]);
  const rc = runCron(world(BOX1, capped), carry(r2), { FAKE_NOW: String(T2), PAGE_CAP: '1' });
  T('[3] capped count-board read: A (beyond the page) read on its own and left alone, B written, the filler rows neither adopted nor written', rc.code === 0 && /like count board hit PAGE_CAP/.test(rc.out) &&
    JSON.stringify(cntWrites(rc).map(w => w.sid)) === JSON.stringify([B]) && Object.keys((likesOf(rc) || {}).cnt || {}).length === 2, JSON.stringify(cntWrites(rc).map(w => w.sid)) + tail(rc));
}

console.log('=== likes-lane [4] the settle is untouched by the lane ===');
{
  const n1 = runCron(world({}), null, {});
  const n2 = runCron(world({}), carry(n1), { FAKE_NOW: String(T1) });
  const others = (r) => { const o = {}; for (const [n, b] of Object.entries(r.left)) if (n !== 'likes.json') o[n] = b; return o; };
  const diff = (a, b) => Array.from(new Set(Object.keys(a).concat(Object.keys(b)))).filter(n => a[n] !== b[n]);
  const nst = (() => { try { return JSON.parse(n2.left['likes.json']); } catch (e) { return null; } })();
  T('[4] without likes: both runs ok; no likes.json before a settle, after it only the two settled keys (a like may still come for them)', n1.code === 0 && n2.code === 0 && n1.left['likes.json'] === undefined &&
    nst && Object.keys(nst.ok || {}).length === 2 && ['cnt', 'mt', 'bt', 'pr', 'pend'].every(m => !Object.keys(nst[m] || {}).length), JSON.stringify(nst) + tail(n2));
  T('[4] every other state file byte for byte the same with and without likes (run 1)', diff(others(r1), others(n1)).length === 0, diff(others(r1), others(n1)).join(','));
  T('[4] every other state file byte for byte the same with and without likes (run 2, the settle)', diff(others(r2), others(n2)).length === 0, diff(others(r2), others(n2)).join(','));
  const nonLike = (r) => r.posts.filter(p => !new RegExp('(^|&)leaderboardid=' + CNT + '(&|$)').test(p.body)).map(p => p.url + ' ' + p.body);
  T('[4] the same board writes apart from like_count (run 2)', JSON.stringify(nonLike(r2)) === JSON.stringify(nonLike(n2)), nonLike(r2).length + ' vs ' + nonLike(n2).length);
  T('[4] the settle wrote XP for all three players of the match in both (the fixture reaches the settle)', Object.keys(JSON.parse(n2.left['xp.json'] || '{}')).length >= 3);
}

console.log('=== likes-lane [5] dry-run ===');
{
  const d2 = runCron(world(BOX1), carry(r1), { FAKE_NOW: String(T1), APPLY_MMR: '0' });
  T('[5] APPLY_MMR=0: the lane runs and says so, no like_count write, likes.json as run 1 left it', d2.code === 0 && /likes: counted \+3[^\n]*would write 2[^\n]*\[dry-run\]/.test(d2.out) && cntWrites(d2).length === 0 && d2.left['likes.json'] === r1.left['likes.json'],
    (d2.out.match(/likes: [^\n]*/) || [''])[0]);
}

console.log('=== likes-lane [6] privacy ===');
{
  const RAW_SID = /7656119\d{10}/;
  const hits = [];
  for (const [tag, r] of [['r1', r1], ['r2', r2], ['r3', r3]]) {
    for (const [f, t] of Object.entries(r.wrote)) if (RAW_SID.test(t)) hits.push(tag + ' ' + f + ': raw SteamID');
    if (RAW_SID.test(r.out)) hits.push(tag + ' log: raw SteamID');
  }
  T('[6] no raw SteamID in any written file or in the log', hits.length === 0, hits.join(' | '));
  const lt = (r2.left['likes.json'] || '') + (r1.left['likes.json'] || '');
  T('[6] likes.json: no match hash / match key in the clear', [K1, K3, K4].every(k => lt.indexOf(String(k)) < 0 && lt.indexOf(k + '_1234') < 0) && RAW_SIDS.every(s => lt.indexOf(s) < 0));
  const st = st2 || {};
  const hex16 = (k) => /^[0-9a-f]{16}$/.test(k);
  const mapKeys = ['cnt', 'mt', 'bt', 'pr', 'pend', 'ok'].flatMap(m => Object.keys(st[m] || {}));
  T('[6] every map key is a 16-hex keyed token, the day slots too, waiting likes hold tokens and numbers only', mapKeys.length > 0 && mapKeys.every(hex16) && ((st.day && st.day.s) || []).every(hex16) &&
    Object.values(st1.pend || {}).every(p => hex16(p.k) && hex16(p.t) && Number.isInteger(p.at) && Number.isInteger(p.w)), JSON.stringify(st).slice(0, 300));
  // one voter, two runs, two targets: no token in common (cnt = per target, public on like_count anyway)
  const BOX6 = Object.assign({}, BOX1, { [F]: [BL(B, T0 - 2 * MIN), BL(A, T3 - MIN)] });
  const r6 = runCron(world(BOX6, counts2), carry(r2), { FAKE_NOW: String(T3) });
  const st6 = likesOf(r6);
  const touched = (a, b) => {
    const out = new Set();
    for (const m of ['mt', 'bt', 'pr', 'pend', 'ok']) for (const k of Object.keys((b && b[m]) || {})) if (!a || !a[m] || JSON.stringify(a[m][k]) !== JSON.stringify(b[m][k])) out.add(k);
    const da = new Set(((a && a.day && a.day.s) || [])); for (const k of ((b && b.day && b.day.s) || [])) if (!da.has(k)) out.add(k);
    return out;
  };
  const t2 = touched(st1, st2), t6 = touched(st2, st6);
  T('[6] the voter\'s second board like (another target, a later run) counted (not a vacuous pass)', r6.code === 0 && /likes: counted \+1 \(match 0, board 1\)/.test(r6.out) && JSON.stringify(cntOf(st6, A)) === JSON.stringify({ n: 2, s: 2, sn: 0, m: 1, b: 1 }), (r6.out.match(/likes: [^\n]*/) || [''])[0]);
  const both = Array.from(t2).filter(k => t6.has(k));
  T('[6] no token written by run 2 is written or changed again by the later run (nothing ties the voter\'s two likes)', t2.size > 0 && t6.size > 0 && both.length === 0, t2.size + ' / ' + t6.size + ' ' + both.join(','));
  const sorted = (o) => { const ks = Object.keys(o || {}); return JSON.stringify(ks) === JSON.stringify(ks.slice().sort()); };
  T('[6] the token maps are written in key order', ['cnt', 'mt', 'bt', 'pr', 'ok'].every(m => sorted(st6[m])));
}

console.log('=== likes-lane [7] the boards on every channel ===');
{
  const created = (r) => r.posts.filter(p => /FindOrCreateLeaderboard/.test(p.url)).map(p => { const q = {}; for (const kv of p.body.split('&')) { const i = kv.indexOf('='); q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } return q; });
  const pt = runCron(world({}, null, null, true), null, {});
  const ptB = created(pt).find(q => q.name === 'like_box'), ptC = created(pt).find(q => q.name === 'like_count');
  T('[7] playtest / demo bootstrap provisions like_box (client-writable, friends-reads) and like_count (trusted, public)', pt.code === 0 && ptB && ptB.onlytrustedwrites === '0' && ptB.onlyfriendsreads === '1' && ptC && ptC.onlytrustedwrites === '1' && ptC.onlyfriendsreads === '0' && /pt bootstrap: provisioned like_box \(client-writable\) \(friends-reads\)/.test(pt.out), JSON.stringify([ptB, ptC]) + tail(pt));
  const mainEnv = { PT_MODE: null, RANKED_LB: 'rating', LP_LB: 'points' };
  const mainExtra = [{ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }];
  const m0 = runCron(world({}, null, mainExtra, true), null, mainEnv);
  const mB = created(m0).find(q => q.name === 'like_box'), mC = created(m0).find(q => q.name === 'like_count');
  T('[7] main app: like boards provisioned up front (box client-writable + friends-reads, counts trusted)', m0.code === 0 && mB && mB.onlytrustedwrites === '0' && mB.onlyfriendsreads === '1' && mC && mC.onlytrustedwrites === '1' && /like boards: provisioned like_box/.test(m0.out), JSON.stringify([mB, mC]) + tail(m0));
  const m1 = runCron(world(BOX1, null, mainExtra), null, mainEnv);
  const m2 = runCron(world(BOX1, null, mainExtra), carry(m1), Object.assign({ FAKE_NOW: String(T1) }, mainEnv));
  T('[7] main channel: the same round counts the same three likes and writes the same two rows', m2.code === 0 && /likes: counted \+3 \(match 2, board 1\)/.test(m2.out) && JSON.stringify(cntWrites(m2)) === JSON.stringify(w2), (m2.out.match(/likes: [^\n]*/) || [''])[0] + tail(m2));
  T('[7] main channel: the board ids are taken from the listing (no find-or-create when the boards exist)', !created(m2).some(q => /^like_/.test(q.name)));
  // the like boards cannot be found or made in the run that settles the match (Steam refuses the find-or-create): the run
  //   goes on (no strictBoard in the lane: pinned in [9]), the settled keys are certified anyway -- the two waiting likes count into the state, nothing
  //   is read or written on the missing boards -- and the next run, the boards back, writes the same two rows as the healthy
  //   round (the waiting likes are not left to run out because one run could not reach the boards)
  const mU = runCron(world(BOX1, null, mainExtra, true), carry(m1), Object.assign({ FAKE_NOW: String(T1), FAIL_CREATE: '^like_' }, mainEnv));
  const stU = likesOf(mU);
  T('[7] like boards unavailable in the settle run: run ok, the match settled, keys certified, the two waiting likes counted into the state, nothing written',
    mU.code === 0 && /likes: boards unavailable \(box=false count=false\)/.test(mU.out) && /likes: counted \+2 \(match 2, board 0\), keys certified 2/.test(mU.out) &&
    JSON.parse(mU.left['processed.json'] || '[]').indexOf(KEY1) >= 0 && cntWrites(mU).length === 0 && JSON.stringify(cntOf(stU, A)) === JSON.stringify({ n: 1, s: 1, sn: 0, m: 1, b: 0 }) && cntOf(stU, B) && cntOf(stU, B).m === 1,
    (mU.out.match(/likes: [^\n]*/g) || []).join(' | ') + tail(mU));
  const mV = runCron(world(BOX1, null, mainExtra), carry(mU), Object.assign({ FAKE_NOW: String(T2) }, mainEnv));
  T('[7] ... the boards back next run: the board like counts and A / B get the same rows as the healthy round', mV.code === 0 && /likes: counted \+1 \(match 0, board 1\)/.test(mV.out) && JSON.stringify(cntWrites(mV)) === JSON.stringify(w2),
    JSON.stringify(cntWrites(mV)) + ' ' + (mV.out.match(/likes: [^\n]*/) || [''])[0] + tail(mV));
}

console.log('=== likes-lane [8] the audit closure: only players with settled XP are counted ===');
{
  // a waiting like whose target is in the match's roster but never wrote a result (named only by the others): the match
  //   settles without him -> no XP for him -> the waiting like is dropped unminted, not counted
  const AU = require(path.join(__dirname, '..', 'audit.js'));
  const st = {};
  const recs = [{ steamID: A, d: rec(0xB1, 1, K1, 0, [A, B, C]) }, { steamID: C, d: rec(0xB1, 1, K1, 2, [A, B, C]) }];
  const ctx = { kh: v.pid, now: um(T0), season: 0, match: LP.matchIndex(recs), known: (s) => s !== B };
  LP.harvest(st, [{ voterSid: A, det: LP.encodeBox([ML(B, K1, T0)]) }], ctx);
  const c = LP.certify(st, [KEY1], Object.assign({}, ctx, { sidOfTarget: (tk) => [A, B, C].find(s => K.target(s) === tk) || null }));
  T('[8] certify: the waiting like of a target without settled XP is dropped, nothing counted, no token minted', c.unknown === 1 && c.resolved.length === 0 && !Object.keys(st.cnt).length && !Object.keys(st.mt).length && !Object.keys(st.pend).length, JSON.stringify(c));
  const st8 = {}; LP.certify(st8, [KEY1], ctx);
  const h8 = LP.harvest(st8, [{ voterSid: A, det: LP.encodeBox([ML(B, K1, T0)]) }], ctx);
  T('[8] harvest after the settle: the same like is refused (unknown), nothing minted -- it may count once he is known', h8.why.unknown === 1 && !h8.counted.length && !Object.keys(st8.mt).length);
  const h8b = LP.harvest(st8, [{ voterSid: A, det: LP.encodeBox([ML(B, K1, T0)]) }], Object.assign({}, ctx, { known: () => true }));
  T('[8] ... and does count once he is known (the entry still queued)', h8b.counted.length === 1);
  T('[8] audit.js holds like_count to that closure (xp.json among the state sources)', AU.LIKE_TRUSTED.some(w => w[0] === v.LIKE_COUNT_LB) && /Object\.keys\(state\.xp \|\| \{\}\)/.test(fs.readFileSync(path.join(__dirname, '..', 'audit.js'), 'utf8')));
  T('[8] validate.js: known = has settled XP (the main path\'s in-memory XP state after the settle, the file elsewhere)', /const known = \(sid\) => !!xs\[pid\(String\(sid\)\)\];/.test(SRC) && /await processLikes\(likeKeys, xpId \? xpState : null\);/.test(SRC));
}

console.log('=== likes-lane [9] source pins + mutation self-checks ===');
{
  T('[9] the two early exits call the lane (no consistent / no fresh matches)', (SRC.match(/await processLikes\(\[\], null\); await processChatMute\(\);/g) || []).length === 2);
  const iLoopEnd = SRC.indexOf("console.log('settled ' + settled + ' (+'"), iCall = SRC.indexOf('await processLikes(likeKeys, xpId ? xpState : null);'), iDry = SRC.indexOf("if (!APPLY_MMR) { console.log('APPLY_MMR=0 dry-run, nothing written'); return; }", iCall);
  T('[9] main path: the lane runs after the settle loop and before the dry-run return', iLoopEnd > 0 && iCall > iLoopEnd && iDry > iCall && !/\n  [a-z]/.test(SRC.slice(iCall + 60, iDry).replace(/\n  \/\/[^\n]*/g, '')));
  T('[9] only a matchmade settle hands its key over (not a void, not endless / friends\' room / bots)', (SRC.match(/likeKeys\.push\(/g) || []).length === 1 && /processed\.add\(c\.m\); settled\+\+; likeKeys\.push\(c\.m\);/.test(SRC));
  T('[9] saveLikes writes publicState only', /JSON\.stringify\(likePlan\.publicState\(st\)\)/.test(SRC.slice(SRC.indexOf('function saveLikes('), SRC.indexOf('function saveLikes(') + 400)));
  T('[9] the lane never stops the run (its own try / catch; no strictBoard / process.exit inside)', (() => { const a = SRC.indexOf('const processLikes = async'), b = SRC.indexOf("ghWarn('likes lane failed: '", a); const body = SRC.slice(a, b); return a > 0 && b > a && !/strictBoard|process\.exit/.test(body); })());
  T('[9] the playtest / demo bootstrap passes the like boards to ptBoardPlan', /likeBoxLb: LIKE_BOX_LB, likeCountLb: LIKE_COUNT_LB/.test(SRC));
  T('[9] the board names (validate.js defaults, spelled out for the local e2e check) = like-plan.js LIKE', v.LIKE_BOX_LB === L.BOX_LB && v.LIKE_COUNT_LB === L.COUNT_LB &&
    /const LIKE_BOX_LB = process\.env\.LIKE_BOX_LB \|\| 'like_box';/.test(SRC) && /const LIKE_COUNT_LB = process\.env\.LIKE_COUNT_LB \|\| 'like_count';/.test(SRC));
  // the state file of each channel is committed by its job (the main job by default name, the twins by their own)
  const wf = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
  const persistOf = (src) => { const m = src.slice(src.indexOf('- name: persist')).match(/for f in ([^;]+); do/); return m ? m[1].trim().split(/\s+/) : []; };
  T('[9] validate.yml persists likes.json (the default name: the main job sets no LIKES_FILE)', persistOf(wf('validate.yml')).indexOf('likes.json') >= 0 && !/LIKES_FILE/.test(wf('validate.yml')) && v.LIKES_FILE === 'likes.json');
  T('[9] playtest.yml names and persists pt-likes.json', /\n {10}LIKES_FILE: pt-likes\.json\n/.test(wf('playtest.yml')) && persistOf(wf('playtest.yml')).indexOf('pt-likes.json') >= 0);
  T('[9] demo.yml names and persists demo-likes.json', /\n {10}LIKES_FILE: demo-likes\.json\n/.test(wf('demo.yml')) && persistOf(wf('demo.yml')).indexOf('demo-likes.json') >= 0);
  const mutate = (tag, from, to, check) => {
    if (SRC.split(from).length !== 2) { T('[9] mutation anchor found once: ' + tag, false); return; }
    const script = path.join(__dirname, '..', '.mutant-likes-lane-' + process.pid + '.js');
    try { fs.writeFileSync(script, SRC.replace(from, to)); check(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
  };
  mutate('settle keys not handed over', 'settled++; likeKeys.push(c.m);', 'settled++;', (script) => {
    const a = runCron(world(BOX1), null, {}, script), b = runCron(world(BOX1), carry(a), { FAKE_NOW: String(T1) }, script);
    T('[9] mutant (settled keys not handed to the lane): the waiting match likes never count -> [2] goes red', b.code === 0 && !/likes: counted \+3/.test(b.out) && /counted \+1 \(match 0, board 1\)/.test(b.out), (b.out.match(/likes: [^\n]*/) || [''])[0]);
  });
  {
    const from = 'await processLikes([], null); await processChatMute();';
    const script = path.join(__dirname, '..', '.mutant-likes-lane-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.split(from).join('await processChatMute();'));
      const BOX6 = Object.assign({}, BOX1, { [F]: [BL(B, T0 - 2 * MIN), BL(A, T3 - MIN)] });
      const x = runCron(world(BOX6, counts2), carry(r2), { FAKE_NOW: String(T3) }, script);
      T('[9] mutant (no lane on the early exits): the later board like on a run without a fresh match is not counted -> [6] goes red', x.code === 0 && /no fresh matches/.test(x.out) && !/likes: counted/.test(x.out), (x.out.match(/likes: [^\n]*/) || [''])[0]);
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
  mutate('known rule gone', 'const known = (sid) => !!xs[pid(String(sid))];', 'const known = (sid) => true;', (script) => {
    const a = runCron(world(BOX1), null, {}, script);
    T('[9] mutant (every SteamID known): the arbitrary SteamID on a board row counts in run 1 -> [1] goes red', a.code === 0 && /likes: counted \+[1-9]/.test(a.out), (a.out.match(/likes: [^\n]*/) || [''])[0]);
  });
}

console.log('=== likes-lane [10] a like_count read with a broken body is a failed read (W79 rework) ===');
{
  // the state was put back to an older copy (run 2's: B 2) while the board still shows B 5 (the row of the lost newer state);
  //   a new board like of B this run makes the state 3. A 200 read with a broken body must not let the run write B DOWN to 3
  //   (the next run would then take the low row as the truth): no row is written, the like is still counted into the state
  const row5 = LP.countRow({ n: 5, s: 5, sn: 0, m: 1, b: 4 });
  const counts5 = [{ sid: A, score: 1, details: LP.countRow(cntOf(st2, A)).details }, { sid: B, score: 5, details: row5.details }];
  const BOX10 = Object.assign({}, BOX1, { [E]: [BL(B, T2 - MIN)] });
  const st3 = { n: 3, s: 3, sn: 0, m: 1, b: 2 };
  for (const f of ['bad', 'noinfo']) {
    const x = runCron(world(BOX10, counts5), carry(r2), { FAKE_NOW: String(T2), FAULT: JSON.stringify({ [CNT]: { all: f } }) });
    T('[10] whole-board read answers 200 + ' + (f === 'bad' ? 'a body that is not JSON' : 'JSON without the entry info (the listing says rows)') + ': read failed, nothing written on like_count, the like counted into the state (B 3)',
      x.code === 0 && /likes: like count read failed \([^)]*malformed body/.test(x.out) && /likes: counted \+1 \(match 0, board 1\)/.test(x.out) && cntWrites(x).length === 0 && JSON.stringify(cntOf(likesOf(x), B)) === JSON.stringify(st3),
      JSON.stringify(cntWrites(x)) + ' ' + (x.out.match(/likes[^\n]*/g) || []).join(' | '));
    if (f === 'bad') {
      const y = runCron(world(BOX10, counts5), carry(x), { FAKE_NOW: String(T3) });
      T('[10] ... the next run reads the board fine: B is never written below the 5 it shows', y.code === 0 && !cntWrites(y).some(w => w.sid === B && w.score < 5), JSON.stringify(cntWrites(y)) + ' ' + (y.out.match(/likes: [^\n]*/) || [''])[0]);
    }
  }
  // a capped read (PAGE_CAP=1, A and B beyond the page): their own reads answer 200 with a broken body -> neither is written
  const filler = Array.from({ length: 5000 }, (_, i) => ({ sid: String(76561197900000000n + BigInt(i)), score: 9, details: [0] }));
  for (const f of ['bad', 'noinfo']) {
    const x = runCron(world(BOX10, filler.concat(counts5)), carry(r2), { FAKE_NOW: String(T2), PAGE_CAP: '1', FAULT: JSON.stringify({ [CNT]: { around: f } }) });
    T('[10] capped read, B\'s own read answers 200 + ' + (f === 'bad' ? 'not JSON' : 'no entry info') + ': B not written (warned), the like counted into the state',
      x.code === 0 && /like count board hit PAGE_CAP/.test(x.out) && /likes: [1-9]\d* like count row read\(s\) failed/.test(x.out) && !cntWrites(x).some(w => w.sid === B) && JSON.stringify(cntOf(likesOf(x), B)) === JSON.stringify(st3),
      JSON.stringify(cntWrites(x)) + ' ' + (x.out.match(/likes[^\n]*/g) || []).join(' | '));
  }
  // the escape hatch, and what it costs: LIKES_STRICT_BODY=0 reads the broken body as an empty board and writes B down to 3
  const z = runCron(world(BOX10, counts5), carry(r2), { FAKE_NOW: String(T2), FAULT: JSON.stringify({ [CNT]: { all: 'bad' } }), LIKES_STRICT_BODY: '0' });
  T('[10] LIKES_STRICT_BODY=0 (the escape hatch): the broken body reads as an empty board -- B written 3 under the 5 it showed (why the read is strict)',
    z.code === 0 && cntWrites(z).some(w => w.sid === B && w.score === 3), JSON.stringify(cntWrites(z)));
  T('[10] source: both like_count reads strict, the other single reads untouched (strict is opt-in)', /readBoardAll\(cntId, 'like count board', \{ strictBody: LIKES_STRICT_BODY, expectEntries: /.test(SRC) &&
    /readUserEntry\(cntId, x, 'like count board', \{ strictBody: LIKES_STRICT_BODY \}\)/.test(SRC) && (SRC.match(/strictBody: LIKES_STRICT_BODY/g) || []).length === 2 && /async function readUserEntry\(id, sid, label, opts\)/.test(SRC) &&
    /if \(opts && opts\.strictBody && /.test(SRC));
}

console.log('=== likes-lane [11] team match: a stranger teammate counts, one per pair per 7 days (W79 rework) ===');
{
  const PPm = require(path.join(__dirname, '..', 'points-plan.js'));
  let mt2 = null;
  for (let x = 0; x < 4096 && mt2 == null; x++) if (PPm.isTeamMt(x) && PPm.teamSizeOfMt(x) === 2 && LP.isMatchmadeMt(x)) mt2 = x;
  const W = S(201), X = S(202), Y = S(203), Z = S(204);   // seats 0 1 = team 0 (W, X), seats 2 3 = team 1 (Y, Z)
  const K5 = 0x6205, K5b = 0x6206;
  const M1 = [[K5, mt2, [W, X, Y, Z]]], M2 = M1.concat([[K5b, mt2, [W, X, Y, Z]]]);
  const nOf = (st, sid) => (cntOf(st, sid) || { n: 0 }).n;
  const BOXT = { [W]: [ML(X, K5, T0 - 5 * MIN)], [Y]: [ML(W, K5, T0 - 5 * MIN)] };   // W -> teammate X, Y -> opponent W
  const t1 = runCron(world(BOXT, null, null, false, M1), null, {});
  const t2 = runCron(world(BOXT, null, null, false, M1), carry(t1), { FAKE_NOW: String(T1) });
  T('[11] team match settles: the stranger teammate\'s like counts (X 1), the opponent\'s too (W 1)', t2.code === 0 && /likes: counted \+2 \(match 2, board 0\)/.test(t2.out) && nOf(likesOf(t2), X) === 1 && nOf(likesOf(t2), W) === 1,
    (t1.out.match(/likes: [^\n]*/) || [''])[0] + ' || ' + (t2.out.match(/likes: [^\n]*/) || [''])[0] + tail(t2));
  const stT = likesOf(t2) || {};
  T('[11] the teammate like took a pair token, the opponent like none', Object.keys(stT.pr || {}).length === 1);
  // the same four an hour later: W likes X again (teammate, waits for the settle), Y likes W again (opponent)
  const BOXT2 = { [W]: [ML(X, K5, T0 - 5 * MIN), ML(X, K5b, T1 + 55 * MIN)], [Y]: [ML(W, K5, T0 - 5 * MIN), ML(W, K5b, T1 + 55 * MIN)] };
  const t3 = runCron(world(BOXT2, null, null, false, M2), carry(t2), { FAKE_NOW: String(T1 + 60 * MIN) });
  const t4 = runCron(world(BOXT2, null, null, false, M2), carry(t3), { FAKE_NOW: String(T1 + 60 * MIN + v.STARTS_MATURITY_MS + MIN) });
  T('[11] second team match within 7 days: the waiting teammate like is dropped by the pair week (X stays 1), the opponent like counts (W 2)',
    t3.code === 0 && t4.code === 0 && /waiting \+2/.test(t3.out) && /keys certified 1/.test(t4.out) && /waiting dropped \(pair week\) 1/.test(t4.out) && nOf(likesOf(t4), X) === 1 && nOf(likesOf(t4), W) === 2,
    (t3.out.match(/likes: [^\n]*/) || [''])[0] + ' || ' + (t4.out.match(/likes: [^\n]*/) || [''])[0] + tail(t4));
  const t5 = runCron(world(Object.assign({}, BOXT2, { [W]: BOXT2[W].concat([BL(X, T1 + 90 * MIN)]) }), null, null, false, M2), carry(t4), { FAKE_NOW: String(T1 + 90 * MIN + v.STARTS_MATURITY_MS) });
  T('[11] a board like of the same pair inside the week: refused by the shared token (week), X stays 1', t5.code === 0 && /week 1/.test(t5.out) && nOf(likesOf(t5), X) === 1, (t5.out.match(/likes: [^\n]*/) || [''])[0] + tail(t5));
}

console.log(failN ? ('FAIL x' + failN + ' (likes-lane)') : 'likes-lane: ALL OK');
process.exit(failN ? 1 : 0);
