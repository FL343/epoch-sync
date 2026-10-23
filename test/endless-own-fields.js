'use strict';
// An endless writer's own fields (Q306, cloud audit 2026-10; found doing Q305). End-to-end over the REAL validate.js main()
// against an offline board stub, the harness of test/endless-host-fields.js.
// An endless co-op group is never split (sanitySplit), so ONE record's own reason (a negative duration, a seat outside the
// seat count, one account writing the key twice, a disposition on a checkpoint cut) held the run and flagged every writer:
// a modified joiner breaking his own record took the honest teammates' segment and put a forgery flag on each. Now that
// record is set aside (endlessRecordSplit): its writer alone is flagged, and only for what an honest client cannot write
// (duration, two different records); the rest settles on the run's agreed values when two writers are left (or one plus
// the dropped record at its registered start-roster seat), else the run is held as before. (The affix reroll bitmap, read
// off g[0] only: test/endless-reroll-vote.js.)
//   [1] unit: endlessRecordSplit over clean / Q305 / whole-group shapes, each own reason, each hold reason
//   [2] casual duo, B's duration negative, no start roster: held, only B flagged
//   [3] the same with a registered start roster: A settles (the dropped record is the second witness), only B flagged
//   [4] casual trio, C's duration negative: A and B settle (trio board), only C flagged, C no absent seat, C still pays
//   [5] one account's two copies: byte-identical -> counted once, settles, nobody flagged; different -> only he is flagged
//   [6] a seat outside the seat count (the host's start frame gives it, Q307): set aside unflagged; trio -> held by the
//       Q113 roster check (his word on his seat disagrees), duo -> held (one writer left); nobody flagged either way
//   [7] team competitive checkpoint, C's disposition host-left: A and B settle, nobody flagged
//   [8] a reason on the agreed fields too (season 4096 + B's negative duration): held, only B flagged
//   [9] whole-group reasons keep the old rule (tokens: both flagged)
//   [10] run summary rows
//   [11] wiring pins + mutation self-check (the split call / the absent-seat exclusion removed)
//   (v3 restack, epoch-sync main 2d1ebfe, knife 5.5b-1 S1 69331bf: a flagged writer also gets a row on the trust_ledger
//   mirror board -- friends-only reads, not a result board. [2] / [8] "nothing written" counts every other write, and
//   pins that the mirror names the flagged writer B alone; [6] (nobody flagged) still counts every write; [11] checks the
//   narrowed count still catches a result write and a mirror row for the honest A)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_DEPTH_CAP', 'ENDLESS_SCORE_MULT'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub (writes logged, not applied)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-own-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const sumPath = path.join(dir, 'summary.md');
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock (pre-season: no season twin boards needed)
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    let summary = ''; try { summary = fs.readFileSync(sumPath, 'utf8'); } catch (err) {}
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const writes = (r, boardId, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(p.body)));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const flagsOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const flaggedKey = (r, m) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[m]);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const anyWrite = (r, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && !/leaderboardid=10[0-4][0-9](&|$)/.test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body));

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// type-7 settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, progress/win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc, endless tail (startDepth, endDepth, continues, tokens [, season, flags, build,
//   picksLo, picksHi, rerollLo, rerollHi, resumeTag])
//   o: { scores, dur, disp }
function rec7(hash, seat, roster, tail, o) {
  const pc = roster.length, sc = (o && o.scores) || [400, 300, 200, 100, 50, 25];
  const d = [0xB1, 3, 7, hash | 0, 5, seat, 0, 0, pc, (o && o.dur != null) ? o.dur : 900];
  for (let i = 0; i < pc; i++) d.push(sc[i] | 0);
  d.push((o && o.disp) | 0);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  for (const x of tail) d.push(x | 0);
  return d;
}
const CASUAL = [0, 6, 0, 0], COMP = [0, 5, 0, 0, 0, attest.SEG_COMP];
const DUO = [A, B], TRIO = [A, B, C];
const BOARD = { progress: 5, cp: 8, trio: 11, quad: 12, compTrio: 13, classicTrio: 14, duo: 15, compDuo: 16, classicDuo: 17, trustLedger: 18 };
// O198 v1 (knife 5.5b-1): the trust_ledger mirror (validate.js TRUST_LEDGER_LB) is listed so its writes land on a known id
const onMirror = (p) => new RegExp('leaderboardid=' + BOARD.trustLedger + '(&|$)').test(p.body);
// every write except the mirror's; and the mirror rows' SteamIDs
const resultWrites = (posts) => posts.filter(p => /SetLeaderboardScore/.test(p.url) && !onMirror(p));
const mirrorSids = (posts) => posts.filter(p => /SetLeaderboardScore/.test(p.url) && onMirror(p)).map(p => (/steamid=([0-9]+)/.exec(p.body) || [])[1]);
const mirrorOnly = (posts, sid) => mirrorSids(posts).every(s => s === sid);
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: BOARD.cp, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.classicDuo, name: 'endless_classic_duo', entries: [] },
    { id: BOARD.trustLedger, name: 'trust_ledger', entries: [] });
  return boards;
}
// explicit rows: { sid, seat, shard (default = seat), roster, tail, o }
const row = (hash, roster, x) => ({ shard: x.shard != null ? x.shard : x.seat, sid: x.sid, d: rec7(hash, x.seat, x.roster || roster, x.tail, x.o) });
// the writers' records, seat i on shard i; o: { [sid]: rec7 o } (one writer's own fields)
const rowsOf = (hash, roster, tail, o, writers) => (writers || roster).map((sid) => row(hash, roster, { sid, seat: roster.indexOf(sid), tail, o: o && o[sid] }));
// the start attestation was sighted 30 min ago (live runs: always past the depth-scaled pacing floor); roster: a registered
//   start roster (seat -> pid), as the writers' start records leave it
const attested = (hash, roster) => {
  const s = {}; s[hash + '_5_7'] = { t0: Date.now() - 30 * 60000, mt: 7, roster: {}, settled: [] };
  if (roster) roster.forEach((sid, i) => { s[hash + '_5_7'].roster[i] = v.pid(sid); });
  return { STARTS_FILE: s };
};
const q306Line = (r, m) => (r.out.match(new RegExp('::warning::match=' + m + ': endless sanity \\[[^\\]]*\\][^\\n]*\\(Q306\\)')) || [''])[0];
const anyQ305 = (r, m) => new RegExp('::warning::match=' + m + ': sanity-(held|flagged)').test(r.out);
const flagSet = (r, ws) => ws.map((s) => flagsOf(r, s)).join('/');
const run = (rows, files, script) => runCron(world(rows), files, null, script);
// unit groups: the records as the job reads them
const G = (rows) => rows.map((x) => { const pc = x.d[8] | 0; return { steamID: x.sid, shard: 'shard_' + x.shard, d: x.d, dispCode: x.d[10 + pc] | 0, roster: v.decodeRoster(x.d) }; });

// ---- [1] unit: endlessRecordSplit ----
console.log('-- [1] unit: endlessRecordSplit --');
{
  const split = (rows, gro) => v.endlessRecordSplit(G(rows), gro || null);
  const groDuo = { 0: v.pid(A), 1: v.pid(B) };
  T('[1] the own reasons are a negative duration and two different records', JSON.stringify(v.SANITY_ENDLESS_OWN_SLUGS) === JSON.stringify(['duration', 'dup-writer']));
  T('[1] a clean group -> null', split(rowsOf(0x3100, DUO, CASUAL)) === null);
  T('[1] a Q305 group (depth, every writer) -> null', split(rowsOf(0x3100, DUO, [-1, 3, 0, 0])) === null);
  T('[1] tokens (the whole-group rule) -> null', split(rowsOf(0x3100, DUO, [0, 6, 0, 1])) === null);
  T('[1] segment flags (the whole-group rule) -> null', split(rowsOf(0x3100, DUO, [0, 5, 0, 0, 0, 64])) === null);
  T('[1] off endless (a 2v2 group) -> null', v.endlessRecordSplit(G([A, B].map((sid, seat) => { const d = rec7(0x3101, seat, DUO, [], { dur: seat ? -1 : 900 }); d[2] = 3; return { sid, shard: seat, d }; })), null) === null);
  let s = split(rowsOf(0x3100, DUO, CASUAL, { [B]: { dur: -1 } }));
  T('[1] duo, B -1: B dropped and flagged, held (one writer left, no start roster)', s && s.hold === 'fewer than two writers left' && JSON.stringify(s.flagSids) === JSON.stringify([B]) && s.drop.length === 1 && s.drop[0].sid === B && s.drop[0].own, JSON.stringify(s && { h: s.hold, f: s.flagSids }));
  s = split(rowsOf(0x3100, DUO, CASUAL, { [B]: { dur: -1 } }), groDuo);
  T('[1] duo, B -1, B at his start-roster seat: settles with A (the dropped record is the second witness)', s && s.hold === null && s.keep.length === 1 && String(s.keep[0].steamID) === A && JSON.stringify(s.flagSids) === JSON.stringify([B]), JSON.stringify(s && { h: s.hold, f: s.flagSids }));
  s = split(rowsOf(0x3100, DUO, CASUAL, { [B]: { dur: -1 } }), { 0: v.pid(A), 1: v.pid(C) });
  T('[1] duo, B -1, the start roster names someone else at B\'s seat: held', s && s.hold === 'fewer than two writers left');
  s = split(rowsOf(0x3100, TRIO, CASUAL, { [C]: { dur: -1 } }));
  T('[1] trio, C -1: A and B settle, only C flagged', s && s.hold === null && s.keep.map((r) => String(r.steamID)).join() === [A, B].join() && JSON.stringify(s.flagSids) === JSON.stringify([C]));
  const dupSame = rowsOf(0x3100, DUO, CASUAL); dupSame.push(Object.assign({}, dupSame[1], { shard: 7 }));
  s = split(dupSame);
  T('[1] B\'s byte-identical copy on a second shard: counted once, nothing dropped, settles', s && s.hold === null && s.dedup === 1 && s.drop.length === 0 && s.keep.length === 2 && s.flagSids.length === 0);
  const dupDiff = rowsOf(0x3100, TRIO, CASUAL); dupDiff.push(row(0x3100, TRIO, { sid: B, seat: 1, shard: 7, tail: CASUAL, o: { dur: 901 } }));
  s = split(dupDiff);
  T('[1] trio, B writes two different records: only B dropped and flagged [dup-writer], A and C settle', s && s.hold === null && s.drop.length === 1 && s.drop[0].sid === B && s.drop[0].why.indexOf('dup-writer') >= 0 && JSON.stringify(s.flagSids) === JSON.stringify([B]) && s.keep.length === 2);
  const seatOob = rowsOf(0x3100, TRIO, CASUAL); seatOob[2] = row(0x3100, TRIO, { sid: C, seat: 5, shard: 2, tail: CASUAL });
  s = split(seatOob);
  T('[1] trio, C at seat 5 of 3: dropped, nobody flagged (the host gives the seat), A and B settle', s && s.hold === null && s.drop[0].sid === C && !s.drop[0].own && s.flagSids.length === 0 && s.drop[0].why.indexOf('seat') >= 0);
  const seatDuo = rowsOf(0x3100, DUO, CASUAL); seatDuo[1] = row(0x3100, DUO, { sid: B, seat: 5, shard: 1, tail: CASUAL });
  s = split(seatDuo, groDuo);
  T('[1] duo, B at seat 5 of 2 (Q307): held, nobody flagged (a seat outside the start roster is no witness)', s && s.hold === 'fewer than two writers left' && s.flagSids.length === 0);
  const compCut = rowsOf(0x3100, TRIO, COMP, { [C]: { disp: 2 } });
  s = split(compCut);
  T('[1] comp checkpoint, C host-left: dropped, nobody flagged, A and B settle', s && s.hold === null && s.drop[0].sid === C && s.drop[0].why.join() === 'disp' && s.flagSids.length === 0);
  T('[1] comp final segment, C host-left: no reason, null', split(rowsOf(0x3100, TRIO, [0, 5, 0, 0, 0, attest.SEG_COMP | attest.SEG_FINAL], { [C]: { disp: 2 } })) === null);
  s = split(rowsOf(0x3100, DUO, [0, 6, 0, 0, 4096, 0], { [B]: { dur: -1 } }), groDuo);
  T('[1] season 4096 + B -1: held on the agreed field, only B flagged', s && /^a reason on the agreed fields too \(season\)$/.test(s.hold) && JSON.stringify(s.flagSids) === JSON.stringify([B]), JSON.stringify(s && s.hold));
  const zt = rowsOf(0x3100, TRIO, [0, 0, 0, 0]); zt[2] = row(0x3100, TRIO, { sid: C, seat: 2, tail: CASUAL, o: { dur: -1 } });
  s = split(zt);
  T('[1] only the dropped record carries the run\'s tail (the others abstain): held, only C flagged', s && s.hold === 'only a dropped record carries the agreed tail' && JSON.stringify(s.flagSids) === JSON.stringify([C]));
  const otherRo = rowsOf(0x3100, TRIO, CASUAL); otherRo[2] = row(0x3100, TRIO, { sid: C, seat: 2, roster: [A, D, C], tail: CASUAL, o: { dur: -1 } });
  s = split(otherRo);
  T('[1] the dropped record names another roster: held (Q113), only C flagged', s && s.hold === 'a dropped record names another roster' && JSON.stringify(s.flagSids) === JSON.stringify([C]));
  const CR = (tag) => [0, 5, 0, 0, 0, attest.SEG_CLASSIC | attest.SEG_RESUMED, 0, 0, 0, 0, 0, tag];
  const tags = rowsOf(0x3100, TRIO, CR(5)); tags[2] = row(0x3100, TRIO, { sid: C, seat: 2, tail: CR(7), o: { dur: -1 } });
  s = split(tags);
  T('[1] team classic resume: a tag only the dropped record carries: held (R1-A3-02), only C flagged', s && s.hold === 'a dropped record carries a resume tag the others do not' && JSON.stringify(s.flagSids) === JSON.stringify([C]), JSON.stringify(s && s.hold));
  const tags2 = rowsOf(0x3100, TRIO, CR(5)); tags2[2] = row(0x3100, TRIO, { sid: C, seat: 2, tail: CR(5), o: { dur: -1 } });
  s = split(tags2);
  T('[1] team classic resume: the dropped record\'s tag is the others\' too: settles', s && s.hold === null);
  const lead = rowsOf(0x3100, TRIO, [0, 0, 0, 0]); lead[0] = row(0x3100, TRIO, { sid: A, seat: 0, tail: CASUAL }); lead[2] = row(0x3100, TRIO, { sid: C, seat: 2, tail: CASUAL, o: { dur: -1 } });
  s = split([lead[2], lead[1], lead[0]]);
  T('[1] the canonical record is first in the kept set (C first on the shards, B abstains)', s && s.hold === null && String(s.keep[0].steamID) === A, s && s.keep.map((r) => r.steamID).join());
}

// ---- [2]..[8] end to end ----
console.log('-- [2] duo, B\'s duration negative, no start roster --');
const rDuo = (() => {
  const h = 0x3120, m = h + '_5_7';
  const r = run(rowsOf(h, DUO, CASUAL, { [B]: { dur: -1 } }), attested(h));
  const ln = q306Line(r, m);
  T('[2] held: not processed, nothing written', r.code === 0 && !processedOf(r).has(m) && resultWrites(r.posts).length === 0, r.out.slice(-400));
  T('[2] the trust-ledger mirror names B alone (A has no row)', mirrorOnly(r.posts, B), mirrorSids(r.posts).join(','));
  T('[2] only B flagged (A 0, B 1)', flagSet(r, DUO) === '0/1', flagSet(r, DUO));
  T('[2] the Q306 line says why', /only that record|not settled \(Q306\)/.test(ln) && /fewer than two writers left, not settled \(Q306\)/.test(ln) && !anyQ305(r, m), ln || r.out.slice(-400));
  return { r, m, h };
})();
console.log('-- [3] the same, with a registered start roster --');
{
  const h = 0x3121, m = h + '_5_7';
  const r = run(rowsOf(h, DUO, [0, 6, 1 << 4, 0], { [B]: { dur: -1 } }), attested(h, DUO));
  const ln = q306Line(r, m);
  T('[3] settles: processed', r.code === 0 && processedOf(r).has(m), r.out.slice(-600));
  T('[3] A credited (progress + duo board), B written nowhere but the CP bank', writes(r, BOARD.progress, A).length === 1 && writes(r, BOARD.duo, A).length === 1 && writes(r, BOARD.progress, B).length === 0 && writes(r, BOARD.duo, B).length === 0,
    'A ' + writes(r, BOARD.progress, A).length + '/' + writes(r, BOARD.duo, A).length + ' B ' + writes(r, BOARD.progress, B).length + '/' + writes(r, BOARD.duo, B).length);
  T('[3] B still pays the continue the run names him for (CP bank)', writes(r, BOARD.cp, B).length === 1 && /  cp-[^\n]*|continue/.test(r.out), r.out.match(/[^\n]*(cp|continue)[^\n]*/gi) && r.out.match(/[^\n]*(cp|continue)[^\n]*/gi).slice(0, 6).join(' || '));
  T('[3] only B flagged', flagSet(r, DUO) === '0/1', flagSet(r, DUO));
  T('[3] the Q306 line: set aside, one writer settles with the witness', /only that record set aside, only [^ ]+ flagged, the other 1 writer\(s\) go on to settle with a dropped record at its start-roster seat as witness \(Q306\)/.test(ln), ln || r.out.slice(-400));
}
console.log('-- [4] trio, C\'s duration negative --');
const rTrio = (() => {
  const h = 0x3122, m = h + '_5_7';
  const r = run(rowsOf(h, TRIO, [0, 6, 1 << 8, 0], { [C]: { dur: -1 } }), attested(h, TRIO));
  T('[4] settles: A and B on the trio board and progress, C on neither', processedOf(r).has(m) && [A, B].every((s) => writes(r, BOARD.trio, s).length === 1 && writes(r, BOARD.progress, s).length === 1) && writes(r, BOARD.trio, C).length === 0 && writes(r, BOARD.progress, C).length === 0,
    r.out.slice(-600));
  T('[4] only C flagged', flagSet(r, TRIO) === '0/0/1', flagSet(r, TRIO));
  T('[4] C is no absent seat (no grace wait, no leaver)', !/absent|grace/i.test((r.out.match(new RegExp('[^\\n]*' + m + '[^\\n]*', 'g')) || []).join('\n')) && TRIO.every((s) => leavesOf(r, s) === 0), (r.out.match(new RegExp('[^\\n]*' + m + '[^\\n]*', 'g')) || []).join(' || '));
  T('[4] C still pays his continue (CP bank)', writes(r, BOARD.cp, C).length === 1, 'cp writes C ' + writes(r, BOARD.cp, C).length);
  return { r, m };
})();
console.log('-- [5] one account\'s two copies --');
{
  const h = 0x3123, m = h + '_5_7';
  const rows = rowsOf(h, DUO, CASUAL); rows.push(Object.assign({}, rows[1], { shard: 7 }));
  const r = run(rows, attested(h, DUO));
  T('[5] byte-identical copies: counted once, settles, nobody flagged', processedOf(r).has(m) && DUO.every((s) => writes(r, BOARD.duo, s).length === 1) && flagSet(r, DUO) === '0/0' && /1 identical copy\(ies\) of one record counted once/.test(q306Line(r, m)),
    flagSet(r, DUO) + ' ' + (q306Line(r, m) || r.out.slice(-400)));
  const h2 = 0x3124, m2 = h2 + '_5_7';
  const rows2 = rowsOf(h2, TRIO, CASUAL); rows2.push(row(h2, TRIO, { sid: B, seat: 1, shard: 7, tail: CASUAL, o: { dur: 901 } }));
  const r2 = run(rows2, attested(h2, TRIO));
  T('[5] two different records of B: only B flagged, A and C settle', processedOf(r2).has(m2) && flagSet(r2, TRIO) === '0/1/0' && [A, C].every((s) => writes(r2, BOARD.trio, s).length === 1) && writes(r2, BOARD.trio, B).length === 0,
    flagSet(r2, TRIO) + ' ' + (q306Line(r2, m2) || r2.out.slice(-400)));
}
console.log('-- [6] a seat outside the seat count (Q307) --');
{
  const h = 0x3125, m = h + '_5_7';
  const rows = rowsOf(h, TRIO, CASUAL); rows[2] = row(h, TRIO, { sid: C, seat: 5, shard: 2, tail: CASUAL });
  const r = run(rows, attested(h));
  // C's record is set aside unflagged; his record's word on his seat disagrees with the roster, so the Q113 roster hold
  //   keeps the run unsettled (a record naming another seat may be the victim's word on a copied key)
  T('[6] trio, C at seat 5: set aside unflagged, then held by the Q113 roster check, nothing written, nobody flagged', !processedOf(r).has(m) && r.posts.filter(p => /SetLeaderboardScore/.test(p.url)).length === 0 && flagSet(r, TRIO) === '0/0/0' && !flaggedKey(r, m)
    && /\(not his own field: not flagged\) -- only that record set aside, nobody flagged/.test(q306Line(r, m)) && new RegExp('::warning::match=' + m + ': endless co-op records disagree -- seat 2 [^ ]+ wrote another roster or seat for this key -- not settled \\(Q113\\)').test(r.out),
    flagSet(r, TRIO) + ' ' + (q306Line(r, m) || r.out.slice(-400)));
  const h2 = 0x3126, m2 = h2 + '_5_7';
  const rows2 = rowsOf(h2, DUO, CASUAL); rows2[1] = row(h2, DUO, { sid: B, seat: 5, shard: 1, tail: CASUAL });
  const r2 = run(rows2, attested(h2));
  T('[6] duo, B at seat 5 (the Q307 shape): held, nobody flagged', !processedOf(r2).has(m2) && flagSet(r2, DUO) === '0/0' && !flaggedKey(r2, m2) && /nobody flagged; fewer than two writers left/.test(q306Line(r2, m2)),
    flagSet(r2, DUO) + ' ' + (q306Line(r2, m2) || r2.out.slice(-400)));
}
console.log('-- [7] team competitive checkpoint, C host-left --');
{
  const h = 0x3127, m = h + '_5_7';
  const r = run(rowsOf(h, TRIO, COMP, { [C]: { disp: 2 } }), attested(h, TRIO));
  T('[7] A and B settle on the competitive trio board, nobody flagged', processedOf(r).has(m) && [A, B].every((s) => writes(r, BOARD.compTrio, s).length === 1) && flagSet(r, TRIO) === '0/0/0',
    flagSet(r, TRIO) + ' ' + (q306Line(r, m) || r.out.slice(-600)));
}
console.log('-- [8] a reason on the agreed fields too --');
{
  const h = 0x3128, m = h + '_5_7';
  const r = run(rowsOf(h, DUO, [0, 6, 0, 0, 4096, 0], { [B]: { dur: -1 } }), attested(h, DUO));
  T('[8] season 4096 + B -1: held, nothing written, only B flagged', !processedOf(r).has(m) && resultWrites(r.posts).length === 0 && mirrorOnly(r.posts, B) && flagSet(r, DUO) === '0/1' && /a reason on the agreed fields too \(season\), not settled \(Q306\)/.test(q306Line(r, m)),
    flagSet(r, DUO) + ' ' + (q306Line(r, m) || r.out.slice(-400)) + ' mirror ' + mirrorSids(r.posts).join(','));
}
console.log('-- [9] whole-group reasons --');
{
  const h = 0x3129, m = h + '_5_7';
  const r = run(rowsOf(h, DUO, [0, 6, 0, 1]), attested(h, DUO));
  T('[9] tokens: held, both flagged (as before)', !processedOf(r).has(m) && flagSet(r, DUO) === '1/1' && /sanity-flagged/.test(r.out) && !q306Line(r, m), flagSet(r, DUO));
}
// ---- [10] run summary ----
console.log('-- [10] run summary --');
{
  const row1 = (r) => (r.summary.match(/\| endless sanity on one record only[^\n]*\| ([0-9]+) \/ ([0-9]+) \|/) || []).slice(1).join('/');
  T('[10] [2] counts one held', row1(rDuo.r) === '0/1', row1(rDuo.r));
  T('[10] [4] counts one set aside', row1(rTrio.r) === '1/0', row1(rTrio.r));
}

// ---- [11] wiring + mutation self-check ----
console.log('-- [11] mutation self-check --');
{
  T('[11] wiring: the split right after the match type (the reroll bitmap vote may sit between), once',
    /const matchType = g\[0\]\.d\[2\] \| 0;[^\n]*\n(\s*\/\/[^\n]*\n)*\s*let endDrop = null;\n(?:[^\n]*\n){0,8}?\s*const es = endlessRecordSplit\(g, seatGateRoster\(startsPending\[c\.m\]\)\);/.test(SRC)
    && SRC.split('endlessRecordSplit(g, seatGateRoster').length === 2);
  T('[11] wiring: the absent-seat exclusion sits right after the absent list', /const absentE = absentRosterSeats\(g\)\.filter\([^\n]*\n\s*if \(endDrop\) for \([^\n]*endDropped\(absentE\[i\]\.steamID\)\) absentE\.splice\(i, 1\);/.test(SRC));
  const mutants = [
    ['the split call removed -> [4] flags all three again', 'const es = endlessRecordSplit(g, seatGateRoster(startsPending[c.m]));', 'const es = null;',
      (r, m) => !processedOf(r).has(m) && flagSet(r, TRIO) === '1/1/1', 0x3140],
    ['the absent-seat exclusion removed -> [4] waits for C (not settled this run)', 'if (endDrop) for (let i = absentE.length - 1; i >= 0; i--) if (endDropped(absentE[i].steamID)) absentE.splice(i, 1);', '',
      (r, m) => !processedOf(r).has(m) && flagSet(r, TRIO) === '0/0/1', 0x3141],
  ];
  // the narrowed count of [2] / [8] still catches what it must: a result write, a mirror row for the honest A
  const resultPost = { url: 'https://x/ISteamLeaderboards/SetLeaderboardScore/v1/', body: 'leaderboardid=' + BOARD.duo + '&steamid=' + A + '&score=1' };
  const mirrorA = { url: 'https://x/ISteamLeaderboards/SetLeaderboardScore/v1/', body: 'leaderboardid=' + BOARD.trustLedger + '&steamid=' + A + '&score=0' };
  const mirrorB = { url: 'https://x/ISteamLeaderboards/SetLeaderboardScore/v1/', body: 'leaderboardid=' + BOARD.trustLedger + '&steamid=' + B + '&score=0' };
  T('[11] a result write next to the mirror row is still counted', resultWrites(rDuo.r.posts.concat([mirrorB, resultPost])).length === 1);
  T('[11] a mirror row for the honest A is caught', !mirrorOnly(rDuo.r.posts.concat([mirrorA]), B) && mirrorOnly([mirrorB], B));
  for (const [label, from, to, check, h] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[11] anchor not found exactly once: ' + from.slice(0, 60)); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-own-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      const m = h + '_5_7';
      const r = runCron(world(rowsOf(h, TRIO, [0, 6, 1 << 8, 0], { [C]: { dur: -1 } })), attested(h, TRIO), null, script);
      T('[11] ' + label, check(r, m), flagSet(r, TRIO) + ' processed=' + processedOf(r).has(m));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-own-fields)') : 'ALL OK (endless-own-fields)');
process.exit(failN ? 1 : 0);
