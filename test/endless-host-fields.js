'use strict';
// Endless sanity on fields every writer copies from the host (Q305, cloud audit 2026-10; found doing Q301). End-to-end over
// the REAL validate.js main() against an offline board stub, the harness of test/absence-grace-endless.js.
// An endless co-op group is never split (sanitySplit), so any reason that fails it used to flag every writer. In a friends'
// room the seat count / seat table, the depth pair, the season, the other seats' continue nibbles, the score vector and a
// classic segment's perk build come to each joiner from the host (start frame, verdict frames, results table) and land in
// his record as they came. One out-of-range value from a modded host held the match (right) and put a forgery flag on every
// honest joiner (wrong). Now a group whose every reason is one of those, with no reason of a writer's own on any record,
// is held as before (not settled, not processed, nothing credited) and flags nobody.
//   [1] unit: endlessHostOnly over each host-copied reason, each writer's own reason, a mix, a hidden own reason, off endless
//   [2] casual duo, the depth pair out of range three ways ([-1,3] / [0,200001] / [8,3]): held, nobody flagged
//   [3] casual duo, the season out of range (4096 / -2): held, nobody flagged
//   [4] casual co-op, five seats claimed (pc 5): held, nobody flagged (the Q294 match-header branch, landed ahead of this one,
//       takes [pc] alone first)
//   [5] casual duo, a continue nibble beyond the seat count: held, nobody flagged
//   [6] casual duo, scores over the depth-scaled cap: held, nobody flagged
//   [7] team competitive segment: a continue in one life / a span past one checkpoint stride: held, nobody flagged
//   [8] team classic segment, a perk build: held, nobody flagged
//   [9] casual trio, the seat table names one account twice (dup-sid): held, nobody flagged (the Q292 seat-or-table branch,
//       landed ahead of this one, takes [dup-sid] alone first)
//   [10] a writer's own reason keeps the whole-group flag: tokens, a negative duration, a host reason plus a negative
//        duration; a negative duration hidden behind a roster reason (sanityFlags stops at the first record reason) is the
//        Q292 branch's (landed ahead of this one: held, nobody flagged; Q306 sets that writer's record aside first)
//   [11] a clean duo still settles (both credited, nobody flagged); the bad group settles once its record is clean
//   [12] the run summary counts the held groups
//   [13] wiring pin + mutation self-check: the Q305 branch removed -> [2] flags both writers again
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-host-'));
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

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// type-7 settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, progress/win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc, endless tail (startDepth, endDepth, continues, tokens [, season, flags, build ...])
//   o: { scores, dur }
function rec7(hash, seat, roster, tail, o) {
  const pc = roster.length, sc = (o && o.scores) || [400, 300, 200, 100, 50, 25];
  const d = [0xB1, 3, 7, hash | 0, 5, seat, 0, 0, pc, (o && o.dur != null) ? o.dur : 900];
  for (let i = 0; i < pc; i++) d.push(sc[i] | 0);
  d.push(0);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  for (const x of tail) d.push(x | 0);
  return d;
}
const CASUAL = [0, 6, 0, 0], COMP = [0, 5, 0, 0, 0, attest.SEG_COMP], CLASSIC = [0, 5, 0, 0, 0, attest.SEG_CLASSIC];
const DUO = [A, B], TRIO = [A, B, C];
const BOARD = { progress: 5, trio: 11, quad: 12, compTrio: 13, classicTrio: 14, duo: 15, compDuo: 16, classicDuo: 17 };
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.classicDuo, name: 'endless_classic_duo', entries: [] });
  return boards;
}
// the writers' records, seat i on shard i (roster may name more seats than write: `writers`)
const rowsOf = (hash, roster, tail, writers, o) => (writers || roster).map((sid) => { const seat = roster.indexOf(sid); return { shard: seat, sid, d: rec7(hash, seat, roster, tail, (o && o[sid]) || (o && o.all)) }; });
// the start attestation was sighted 30 min ago (live runs: always past the depth-scaled pacing floor)
const attested = (hash) => { const s = {}; s[hash + '_5_7'] = { t0: Date.now() - 30 * 60000, mt: 7, roster: {}, settled: [] }; return { STARTS_FILE: s }; };
const heldLine = (r, m) => (r.out.match(new RegExp('::warning::match=' + m + ': sanity-held \\[[^\\]]*\\][^\\n]*')) || [''])[0];
const flagLine = (r, m) => (r.out.match(new RegExp('::warning::match=' + m + ': sanity-flagged \\[[^\\]]*\\][^\\n]*')) || [''])[0];
// the landed branches ahead of Q305's (Q292: every reason the host's seat or table; Q294: every shared reason the host's match header)
const VIA = { Q292: '-- the host\'s seat or table, nobody flagged \\(Q292\\), not settled', Q294: '-- the host\'s match header, nobody flagged \\(Q294\\), not settled' };
const viaLine = (r, m, via) => (r.out.match(new RegExp('::warning::match=' + m + ': sanity \\[[^\\]]*\\] ' + VIA[via] + '[^\\n]*')) || [''])[0];

// one bad group, one run: held, nothing written, nobody flagged, the Q305 line names the reasons
function heldCase(tag, hash, roster, tail, why, writers, o, script, via) {
  const m = hash + '_5_7', ws = writers || roster;
  const r = runCron(world(rowsOf(hash, roster, tail, ws, o)), attested(hash), null, script);
  const hl = via ? viaLine(r, m, via) : heldLine(r, m);
  const res = {
    r, m,
    held: r.code === 0 && !processedOf(r).has(m) && writes(r, BOARD.progress).length === 0 && r.posts.filter(p => /SetLeaderboardScore/.test(p.url)).length === 0,
    noFlag: ws.every((sid) => flagsOf(r, sid) === 0) && !flaggedKey(r, m),
    line: via ? new RegExp('sanity \\[' + why.join(',') + '\\] ' + VIA[via]).test(hl) && !heldLine(r, m) && !flagLine(r, m)
      : new RegExp('sanity-held \\[' + why.join(',') + '\\] on fields every endless writer copies from the host -- not settled, nobody flagged \\(Q305\\)').test(hl) && !flagLine(r, m),
    noLeave: ws.every((sid) => leavesOf(r, sid) === 0),
  };
  T(tag + ': held (not settled, not processed, nothing written)', res.held, r.out.slice(-500));
  T(tag + ': nobody flagged', res.noFlag, 'f ' + ws.map((s) => flagsOf(r, s)).join('/') + ' key=' + flaggedKey(r, m));
  T(tag + ': the ' + (via || 'Q305') + ' line names [' + why.join(',') + ']', res.line, hl || heldLine(r, m) || flagLine(r, m) || r.out.slice(-400));
  T(tag + ': no leaver', res.noLeave);
  return res;
}
// one bad group, one run: the old rule (held, every writer flagged once)
function flaggedCase(tag, hash, roster, tail, writers, o) {
  const m = hash + '_5_7', ws = writers || roster;
  const r = runCron(world(rowsOf(hash, roster, tail, ws, o)), attested(hash));
  T(tag + ': held, every writer flagged once (as before)', r.code === 0 && !processedOf(r).has(m) && writes(r, BOARD.progress).length === 0 &&
    ws.every((sid) => flagsOf(r, sid) === 1) && flaggedKey(r, m) && !!flagLine(r, m) && !heldLine(r, m), 'f ' + ws.map((s) => flagsOf(r, s)).join('/') + ' ' + (flagLine(r, m) || heldLine(r, m) || r.out.slice(-400)));
  return r;
}

// ---- [1] unit ----
console.log('-- [1] unit: endlessHostOnly --');
{
  const g = (roster, tail, o) => rowsOf(0x3050, roster, tail, null, o).map((x) => ({ steamID: x.sid, d: x.d, roster: v.decodeRoster(x.d) }));
  const hostOnly = (grp) => v.endlessHostOnly(grp, v.sanityFlags(grp));
  T('[1] the set is the ten host-copied reasons', JSON.stringify(v.SANITY_ENDLESS_HOST_SLUGS) === JSON.stringify(['pc', 'depth', 'span', 'season', 'cont', 'score', 'classic-perk', 'self-seat', 'sid-range', 'dup-sid']));
  T('[1] a clean group: false (nothing to hold)', v.sanityFlags(g(DUO, CASUAL)).length === 0 && !hostOnly(g(DUO, CASUAL)));
  const host = [
    ['depth (start -1)', g(DUO, [-1, 3, 0, 0]), 'depth'], ['depth (end past the cap)', g(DUO, [0, 200001, 0, 0]), 'depth'], ['depth (end before start)', g(DUO, [8, 3, 0, 0]), 'depth'],
    ['season 4096', g(DUO, [0, 6, 0, 0, 4096, 0]), 'season'], ['season -2', g(DUO, [0, 6, 0, 0, -2, 0]), 'season'],
    ['pc 5', g([A, B, C, D, E], CASUAL), 'pc'], ['cont beyond pc', g(DUO, [0, 6, 1 << 12, 0]), 'cont'],
    ['score over the cap', g(DUO, CASUAL, { all: { scores: [200000, 100] } }), 'score'],
    ['comp: a continue in one life', g(DUO, [0, 5, 1, 0, 0, attest.SEG_COMP]), 'cont'], ['comp: span past a stride', g(DUO, [0, 20, 0, 0, 0, attest.SEG_COMP]), 'span'],
    ['classic: a perk build', g(DUO, [0, 5, 0, 0, 0, attest.SEG_CLASSIC, 1]), 'classic-perk'],
    ['roster names A twice', g([A, B, A], CASUAL).slice(0, 2), 'dup-sid'],
  ];
  for (const [label, grp, why] of host) T('[1] ' + label + ': [' + why + '] -> true', v.sanityFlags(grp).indexOf(why) >= 0 && hostOnly(grp), JSON.stringify(v.sanityFlags(grp)));
  const own = [
    ['tokens', g(DUO, [0, 6, 0, 1]), 'tokens'], ['no tail', g(DUO, []), 'tail'], ['segment flags', g(DUO, [0, 5, 0, 0, 0, 64]), 'flags'],
    ['a negative duration', g(DUO, CASUAL, { [B]: { dur: -1 } }), 'duration'],
    ['season 4096 + a negative duration', g(DUO, [0, 6, 0, 0, 4096, 0], { [B]: { dur: -1 } }), 'duration'],
  ];
  for (const [label, grp, why] of own) T('[1] ' + label + ': [' + why + '] -> false', v.sanityFlags(grp).indexOf(why) >= 0 && !hostOnly(grp), JSON.stringify(v.sanityFlags(grp)));
  const hidden = g([A, B, A], CASUAL, { [B]: { dur: -1 } }).slice(0, 2);
  T('[1] a negative duration behind a roster reason: sanityFlags sees [dup-sid] only, the re-read finds the duration -> false',
    JSON.stringify(v.sanityFlags(hidden)) === '["dup-sid"]' && !hostOnly(hidden), JSON.stringify(v.sanityFlags(hidden)));
  const dupW = g(DUO, [0, 6, 0, 0, 4096, 0]); dupW.push(Object.assign({}, dupW[1]));
  T('[1] one account writing twice next to a season reason -> false', v.sanityFlags(dupW).indexOf('dup-writer') >= 0 && !hostOnly(dupW));
  // off endless: a 2v2 record with the wrong seat count (pc) keeps the old rule
  const t2 = [A, B].map((sid, seat) => { const d = rec7(0x3051, seat, [A, B], []); d[2] = 3; return { steamID: sid, d, roster: v.decodeRoster(d) }; });
  T('[1] off endless (a 2v2 group, [pc]) -> false', v.sanityFlags(t2).indexOf('pc') >= 0 && !v.endlessHostOnly(t2, v.sanityFlags(t2)), JSON.stringify(v.sanityFlags(t2)));
}

// ---- [2]..[9] host-copied reasons, end to end ----
console.log('-- [2] the depth pair --');
const d2 = heldCase('[2] [-1,3]', 0x3052, DUO, [-1, 3, 0, 0], ['depth']);
heldCase('[2] [0,200001]', 0x3053, DUO, [0, 200001, 0, 0], ['depth']);
heldCase('[2] [8,3]', 0x3054, DUO, [8, 3, 0, 0], ['depth']);
console.log('-- [3] the season --');
heldCase('[3] season 4096', 0x3055, DUO, [0, 6, 0, 0, 4096, 0], ['season']);
heldCase('[3] season -2', 0x3056, DUO, [0, 6, 0, 0, -2, 0], ['season']);
console.log('-- [4] five seats claimed --');
heldCase('[4] pc 5, two writers', 0x3057, [A, B, C, D, E], CASUAL, ['pc'], DUO, null, null, 'Q294');
console.log('-- [5] a continue nibble beyond the seat count --');
heldCase('[5] seat 3 nibble in a duo', 0x3058, DUO, [0, 6, 1 << 12, 0], ['cont']);
console.log('-- [6] scores over the cap --');
heldCase('[6] 200000 at depth 6', 0x3059, DUO, CASUAL, ['score'], null, { all: { scores: [200000, 100] } });
console.log('-- [7] team competitive segment --');
heldCase('[7] a continue in one life', 0x305A, DUO, [0, 5, 1, 0, 0, attest.SEG_COMP], ['cont']);
heldCase('[7] a span past one stride', 0x305B, DUO, [0, 20, 0, 0, 0, attest.SEG_COMP], ['span']);
console.log('-- [8] team classic segment --');
heldCase('[8] a perk build', 0x305C, DUO, [0, 5, 0, 0, 0, attest.SEG_CLASSIC, 1], ['classic-perk']);
console.log('-- [9] the seat table names one account twice --');
heldCase('[9] trio table [A, B, A], A and B write', 0x305D, [A, B, A], CASUAL, ['dup-sid'], DUO, null, null, 'Q292');

// ---- [10] a writer's own reason keeps the whole-group flag ----
console.log('-- [10] a writer\'s own reason --');
flaggedCase('[10] tokens', 0x3060, DUO, [0, 6, 0, 1]);
flaggedCase('[10] B\'s duration negative', 0x3061, DUO, CASUAL, null, { [B]: { dur: -1 } });
flaggedCase('[10] season 4096 + B\'s duration negative', 0x3062, DUO, [0, 6, 0, 0, 4096, 0], null, { [B]: { dur: -1 } });
// (sanityFlags stops at the roster reason, so the landed Q292 branch takes the group before the whole-group rule: nobody flagged)
heldCase('[10] B\'s negative duration behind the roster reason', 0x3063, [A, B, A], CASUAL, ['dup-sid'], DUO, { [B]: { dur: -1 } }, null, 'Q292');

// ---- [11] a clean group settles; the held group settles once clean ----
console.log('-- [11] clean groups --');
{
  const h = 0x3070, m = h + '_5_7';
  const r = runCron(world(rowsOf(h, DUO, CASUAL)), attested(h));
  T('[11] a clean duo settles: both credited, nobody flagged', processedOf(r).has(m) && DUO.every((sid) => writes(r, BOARD.progress, sid).length === 1 && writes(r, BOARD.duo, sid).length === 1 && flagsOf(r, sid) === 0) && !heldLine(r, m),
    r.out.slice(-400));
  const r2 = runCron(world(rowsOf(0x3052, DUO, CASUAL)), d2.r.state);
  T('[11] the held [2] group, written again clean: settles on the next run (nothing was marked processed)', processedOf(r2).has(d2.m) && DUO.every((sid) => writes(r2, BOARD.duo, sid).length === 1 && flagsOf(r2, sid) === 0),
    r2.out.slice(-400));
}

// ---- [12] run summary ----
console.log('-- [12] run summary --');
T('[12] the summary counts the held group', /\| endless sanity on fields copied from the host only: held, nobody flagged \(Q305\) \| 1 \|/.test(d2.r.summary) && /\| flagged inconsistent \/ sanity \| 0 \/ 0 \|/.test(d2.r.summary),
  (d2.r.summary.match(/[^\n]*(Q305|flagged inconsistent)[^\n]*/g) || []).join(' || '));

// ---- [13] mutation self-check ----
console.log('-- [13] mutation self-check --');
{
  T('[13] wiring: the Q305 check opens the whole-group branch (nothing dropped), ahead of its flag, once',
    /const sp = sanitySplit\(g\);\n(\s+\/\/[^\n]*\n)*(\s+if \(!sp\.drop\.length && sane\.every\(\(f\) => SANITY_HOST_SLUGS\.indexOf\(f\) >= 0\)\) \{\n[^\n]*\n[^\n]*\n\s+continue;\n\s+\}\n)?(\s+\/\/ Q294:[^\n]*\n(\s+\/\/[^\n]*\n)*\s+const hh = sanityHeaderHeld\(g, sane, sp\);\n\s+if \(hh\) \{\n(        [^\n]*\n)+?\s+continue;\n\s+\}\n)?\s+if \(!sp\.drop\.length\) \{\n\s+if \(endlessHostOnly\(g, sane\)\) \{[^\n]*\n\s+RUN\.sanityEndHost = \(RUN\.sanityEndHost \| 0\) \+ 1;\n[^\n]*\n\s+continue;\n\s+\}\n\s+recordFlag\(signals, g, c\.m, nowMs\);/.test(SRC) && SRC.split('endlessHostOnly(g, sane)').length === 2);
  const from = 'if (endlessHostOnly(g, sane)) {';
  if (SRC.split(from).length !== 2) bad('[13] anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-endless-host-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, 'if (false) {'));
      const h = 0x3080, m = h + '_5_7';
      const r = runCron(world(rowsOf(h, DUO, [-1, 3, 0, 0])), attested(h), null, script);
      T('[13] the Q305 branch removed -> [-1,3] flags both writers again', !processedOf(r).has(m) && DUO.every((sid) => flagsOf(r, sid) === 1) && !!flagLine(r, m), 'f ' + DUO.map((s) => flagsOf(r, s)).join('/'));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-host-fields)') : 'ALL OK (endless-host-fields)');
process.exit(failN ? 1 : 0);
