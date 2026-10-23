'use strict';
// The endless affix reroll bitmap is read off one record (Q306 b, cloud audit 2026-10; found doing Q305). End-to-end over the
// REAL validate.js main() against an offline board stub, the harness of test/endless-own-fields.js.
// The bitmap (tail ints 10-11) sits outside the consistency vector, and the classic perk sanity, the casual co-op bitmap check
// (flags every writer) and the team competitive chain read g[0]'s -- the first record read. A modified joiner whose record
// landed on an early shard put his own bitmap in for the run: an out-of-reach one flagged every honest teammate. Now, when the
// writers disagree, the reachable bitmap the most writers name is read (a tie keeps the first record's: what settled before
// settles on the same bitmap); nobody is flagged and nothing is held for it.
//   [1] unit: endlessRerollCanon (agree / the most votes / a tie keeps the first record's / the first out of reach /
//       none reachable / classic / one writer two bitmaps / abstention)
//   [2] casual trio, C's out-of-reach bitmap on the first shard: all three settle, nobody flagged; casual duo, the first
//       record's out of reach: both settle; neither reachable: rejected as before (both flagged)
//   [3] the run summary counts the group
//   [4] wiring pin + mutation self-check: the vote removed -> [2] flags all three again
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-rr-'));
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
const BOARD = { progress: 5, cp: 8, trio: 11, quad: 12, compTrio: 13, classicTrio: 14, duo: 15, compDuo: 16, classicDuo: 17 };
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: BOARD.cp, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.classicDuo, name: 'endless_classic_duo', entries: [] });
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

// ---- [1] unit: endlessRerollCanon ----
console.log('-- [1] unit: endlessRerollCanon --');
{
  const RR = (lo, hi) => [0, 6, 0, 0, 0, 0, 0, 0, 0, lo, hi || 0];   // end depth 6: bits 0 and 1 reachable (targets 3 and 6), bit 2 (4) not
  const grp = (bits, extra) => { const rs = TRIO.map((sid, seat) => row(0x3110, TRIO, { sid, seat, tail: RR(bits[seat]) })); return G(rs.concat(extra || [])); };
  const duo = (a, b) => G(DUO.map((sid, seat) => row(0x3111, DUO, { sid, seat, tail: RR(seat ? b : a) })));
  T('[1] the writers agree -> null', v.endlessRerollCanon(grp([1, 1, 1])) === null);
  T('[1] one record -> null', v.endlessRerollCanon(G([row(0x3110, TRIO, { sid: A, seat: 0, tail: RR(4) })])) === null);
  let g = grp([4, 0, 0]);
  let c = v.endlessRerollCanon(g);
  T('[1] trio, A (first) names 4 (out of reach), B and C 0: 0:0 moves to the front', c && c.canon === '0:0' && c.moved && c.minority === 1 && String(g[0].steamID) === B && v.endlessTail(g[0].d).rerollLo === 0, JSON.stringify(c));
  g = grp([2, 1, 1]); c = v.endlessRerollCanon(g);
  T('[1] trio, A (first) names 2, B and C 1 (all reachable): the most votes win, 0:1 first', c && c.canon === '0:1' && c.moved && String(g[0].steamID) === B, JSON.stringify(c));
  g = grp([0, 0, 4]); c = v.endlessRerollCanon(g);
  T('[1] trio, C names 4: the first record\'s already, nothing moved', c && c.canon === '0:0' && !c.moved && String(g[0].steamID) === A);
  g = duo(1, 0); c = v.endlessRerollCanon(g);
  T('[1] duo, two reachable bitmaps (a tie): the first record\'s kept, as before', c && c.canon === '0:1' && !c.moved && String(g[0].steamID) === A, JSON.stringify(c));
  g = duo(4, 0); c = v.endlessRerollCanon(g);
  T('[1] duo, the first record\'s out of reach: the other one read', c && c.canon === '0:0' && c.moved && String(g[0].steamID) === B, JSON.stringify(c));
  g = duo(4, 8); c = v.endlessRerollCanon(g);
  T('[1] duo, none reachable: nothing moved (the lanes reject as before)', c && c.canon === null && !c.moved && String(g[0].steamID) === A, JSON.stringify(c));
  const CL = (lo) => [0, 5, 0, 0, 0, attest.SEG_CLASSIC, 0, 0, 0, lo, 0];
  g = G(DUO.map((sid, seat) => row(0x3113, DUO, { sid, seat, tail: CL(seat ? 0 : 1) }))); c = v.endlessRerollCanon(g);
  T('[1] classic duo, the first record names bit 0: classic reaches none, the other (0) read', c && c.canon === '0:0' && c.moved && String(g[0].steamID) === B, JSON.stringify(c));
  g = grp([0, 0, 1], [row(0x3110, TRIO, { sid: C, seat: 2, shard: 9, tail: RR(0) })]); c = v.endlessRerollCanon(g);
  T('[1] trio, C\'s two copies name two bitmaps: C votes for neither, A and B carry it', c && c.canon === '0:0' && c.minority === 0 && !c.moved);
  const abst = G([row(0x3112, TRIO, { sid: A, seat: 0, tail: [0, 0, 0, 0] }), row(0x3112, TRIO, { sid: B, seat: 1, tail: RR(1) }), row(0x3112, TRIO, { sid: C, seat: 2, tail: RR(1) })]);
  T('[1] a zero-tail abstention casts no vote -> null', v.endlessRerollCanon(abst) === null);
}

// ---- [2] end to end ----
console.log('-- [2] the reroll bitmap --');
const r11 = (() => {
  const RR = (lo) => [0, 6, 0, 0, 0, 0, 0, 0, 0, lo, 0];
  const h = 0x312A, m = h + '_5_7';
  // C's record lands on shard 0 (read first), A on 1, B on 2
  const rows = [row(h, TRIO, { sid: C, seat: 2, shard: 0, tail: RR(4) }), row(h, TRIO, { sid: A, seat: 0, shard: 1, tail: RR(0) }), row(h, TRIO, { sid: B, seat: 1, shard: 2, tail: RR(0) })];
  const r = run(rows, attested(h, TRIO));
  T('[2] trio, C\'s out-of-reach bitmap read first: 0:0 read, all three settle, nobody flagged', processedOf(r).has(m) && TRIO.every((s) => writes(r, BOARD.trio, s).length === 1) && flagSet(r, TRIO) === '0/0/0' && !/reroll bitmap sanity REJECT/.test(r.out)
    && new RegExp('::warning::match=' + m + ': the endless writers name 2 affix reroll bitmaps -- the reachable 0:0 read \\(its record moved first\\), nobody flagged \\(Q306\\)').test(r.out), flagSet(r, TRIO) + ' ' + r.out.slice(-600));
  const h2 = 0x312B, m2 = h2 + '_5_7';
  const rows2 = [row(h2, DUO, { sid: A, seat: 0, tail: RR(4) }), row(h2, DUO, { sid: B, seat: 1, tail: RR(0) })];
  const r2 = run(rows2, attested(h2, DUO));
  T('[2] duo, the first record\'s out of reach: the other one read, both settle, nobody flagged', processedOf(r2).has(m2) && DUO.every((s) => writes(r2, BOARD.duo, s).length === 1) && flagSet(r2, DUO) === '0/0' && !/reroll bitmap sanity REJECT/.test(r2.out),
    flagSet(r2, DUO) + ' ' + r2.out.slice(-400));
  const h3 = 0x312C, m3 = h3 + '_5_7';
  const r3 = run([row(h3, DUO, { sid: A, seat: 0, tail: RR(4) }), row(h3, DUO, { sid: B, seat: 1, tail: RR(8) })], attested(h3, DUO));
  T('[2] duo, neither reachable: rejected as before (both flagged, processed)', processedOf(r3).has(m3) && flagSet(r3, DUO) === '1/1' && /reroll bitmap sanity REJECT/.test(r3.out) && /none reachable, the first record's read as before \(Q306\)/.test(r3.out),
    flagSet(r3, DUO) + ' ' + r3.out.slice(-400));
  return { r, r2, h, rows };
})();

// ---- [3] run summary ----
console.log('-- [3] run summary --');
{
  const row2 = (r) => (r.summary.match(/\| endless writers naming different affix reroll bitmaps[^\n]*\| ([0-9]+) \|/) || []).slice(1).join('/');
  T('[3] [2] counts the trio naming two bitmaps', row2(r11.r) === '1', row2(r11.r));
}

// ---- [4] wiring + mutation self-check ----
console.log('-- [4] mutation self-check --');
{
  T('[4] wiring: the vote right after endDrop, ahead of the split, once',
    /\n\s*let endDrop = null;\n\s*const rc = endlessRerollCanon\(g\);[^\n]*\n\s*if \(rc\) \{\n(?:[^\n]*\n){3}\s*\}\n\s*const es = endlessRecordSplit\(g, seatGateRoster/.test(SRC) && SRC.split('endlessRerollCanon(g);').length === 2);
  const from = 'const rc = endlessRerollCanon(g);';
  if (SRC.split(from).length !== 2) bad('[4] anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-endless-rr-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, 'const rc = null;'));
      const m = r11.h + '_5_7';
      const r = runCron(world(r11.rows), attested(r11.h, TRIO), null, script);
      T('[4] the vote removed -> [2] flags all three again (and marks the run processed, as before)', processedOf(r).has(m) && flagSet(r, TRIO) === '1/1/1' && /reroll bitmap sanity REJECT/.test(r.out) && TRIO.every((s) => writes(r, BOARD.trio, s).length === 0),
        flagSet(r, TRIO) + ' processed=' + processedOf(r).has(m));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-reroll-vote)') : 'ALL OK (endless-reroll-vote)');
process.exit(failN ? 1 : 0);
