'use strict';
// Endless co-op checks on values every writer copies from the host (Q314, cloud audit 2026-10; found doing Q305 / Q306).
// End-to-end over the REAL validate.js main() against an offline board stub, the harness of test/endless-reroll-vote.js.
// Past sanity, five checks of an endless co-op group read values that reach every joiner only from the host's frames and
// that every record already carries alike: the seat table (team competitive / team classic: a seat with no account is
// written '0' and left off the roster -- "roster incomplete"), the perk build + pick log (team competitive / casual:
// perk replay REJECT) and the casual reroll bitmap (after Q306's vote every honest record carries the host's: reroll
// bitmap sanity REJECT). A modded host sending a value no honest host sends held / rejected the run (right) and put a
// forgery flag on every honest joiner who carried it (wrong): the job cannot tell the host from the copiers. Now the checks
// hold / reject as before and flag nobody.
//   [1] team competitive trio, the seat table leaves seat 2 without an account: held, nobody flagged, nothing credited
//   [2] team classic trio, the same: held, nobody flagged
//   [3] team competitive duo checkpoint, build 4 with no pick log (perk_forge): rejected (processed), nobody flagged
//   [4] casual duo / casual trio, the same build: rejected (processed), nobody flagged
//   [5] casual duo, both writers carry an out-of-reach reroll bitmap: rejected (processed), nobody flagged
//   [6] untouched: casual trio with the same seat table settles; clean team competitive / casual / team classic groups
//       settle; team competitive duo with an out-of-reach bitmap rejected, nobody flagged (as before); tokens keep the
//       whole-group flag (Q305); a writer's own negative duration still flags only him (Q306)
//   [7] the run summary counts the held / rejected groups
//   [8] wiring pins + mutation self-check: a flag put back in a check -> its case flags every writer again
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-copied-'));
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

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
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
// the start attestation was sighted 30 min ago (live runs: always past the depth-scaled pacing floor); roster: a registered
//   start roster (seat -> pid), as the writers' start records leave it
const attested = (hash, roster) => {
  const s = {}; s[hash + '_5_7'] = { t0: Date.now() - 30 * 60000, mt: 7, roster: {}, settled: [] };
  if (roster) roster.forEach((sid, i) => { if (sid !== '0') s[hash + '_5_7'].roster[i] = v.pid(sid); });   // a seat with no account ('0') is not registered
  return { STARTS_FILE: s };
};
const flagSet = (r, ws) => ws.map((s) => flagsOf(r, s)).join('/');
const run = (rows, files, script) => runCron(world(rows), files, null, script);

const tag = (s) => ({ [A]: 'A', [B]: 'B', [C]: 'C' })[s] || s;
const ENDLESS_BOARDS = [BOARD.duo, BOARD.trio, BOARD.compTrio, BOARD.compDuo, BOARD.classicDuo, BOARD.classicTrio];
const credited = (r, sid) => ENDLESS_BOARDS.some((b) => writes(r, b, sid).length > 0) && writes(r, BOARD.progress, sid).length > 0;
const noWrite = (r, ws) => ws.every((s) => !ENDLESS_BOARDS.some((b) => writes(r, b, s).length > 0) && writes(r, BOARD.progress, s).length === 0);
const warnOf = (r, m) => (r.out.match(new RegExp('::warning::match=' + m + ': [^\\n]*', 'g')) || []).join(' || ');
// tails: [startDepth, endDepth, continues, tokens, season, flags, build, picksLo, picksHi, rerollLo, rerollHi]
const CAS = (build, rrLo) => [0, 6, 0, 0, 0, 0, build | 0, 0, 0, rrLo | 0, 0];
const CMP = (build, rrLo) => [0, 5, 0, 0, 0, attest.SEG_COMP, build | 0, 0, 0, rrLo | 0, 0];
const CLS = [0, 5, 0, 0, 0, attest.SEG_CLASSIC, 0, 0, 0, 0, 0];
// a three-seat run whose seat table leaves seat 2 without an account: what a modded host's start frame can send, and what
//   every joiner then writes ('0' at seat 2, result-reporter)
const HOLE = [A, B, '0'];
// build 4 = one perk in slot 0 with an empty pick log: structurally valid, never replays (perk_forge build-without-picks);
//   reroll bit 2 (lo 4) = target depth 9, out of reach of a segment ending at depth 5 / 6 (reroll-ahead)
const X = (sid, seat, tail, o) => ({ sid, seat, tail, o });
let hashN = 0x3140;
// one group in one cron run; every writer copies the same values (an honest joiner copies the host's frames)
function caseRun(roster, xs, script) {
  const h = hashN++, m = h + '_5_7';
  const r = run(xs.map((x) => row(h, roster, x)), attested(h, roster), script);
  const ws = Array.from(new Set(xs.map((x) => x.sid)));
  return { r, m, ws, h, roster, xs };
}
const flagged0 = (c) => flagSet(c.r, c.ws) === c.ws.map(() => '0').join('/') && !flaggedKey(c.r, c.m);
const show = (c) => 'flags ' + c.ws.map((s) => tag(s) + '=' + flagsOf(c.r, s)).join(' ') + ' processed=' + processedOf(c.r).has(c.m) + ' credited=' + (c.ws.filter((s) => credited(c.r, s)).map(tag).join('') || '-') + ' ' + warnOf(c.r, c.m).slice(0, 300);
const held = (c) => !processedOf(c.r).has(c.m) && noWrite(c.r, c.ws);
const rejected = (c) => processedOf(c.r).has(c.m) && noWrite(c.r, c.ws);

// ---- [1] / [2] the seat table ----
console.log('-- [1] [2] the seat table leaves a seat without an account --');
const c1 = caseRun(HOLE, [X(A, 0, CMP(0, 0)), X(B, 1, CMP(0, 0))]);
T('[1] team competitive trio, seat 2 without an account: held (not processed, nothing credited), nobody flagged', held(c1) && flagged0(c1)
  && new RegExp('::warning::match=' + c1.m + ': team comp segment roster incomplete \\(2/3\\) -- not settled, nobody flagged \\(Q314\\)').test(c1.r.out), show(c1));
const c2 = caseRun(HOLE, [X(A, 0, CLS), X(B, 1, CLS)]);
T('[2] team classic trio, the same: held, nobody flagged', held(c2) && flagged0(c2)
  && new RegExp('::warning::match=' + c2.m + ': team classic segment roster incomplete \\(2/3\\) -- not settled, nobody flagged \\(Q314\\)').test(c2.r.out), show(c2));

// ---- [3] / [4] the perk build ----
console.log('-- [3] [4] a perk build with no pick log --');
const c3 = caseRun(DUO, [X(A, 0, CMP(4, 0)), X(B, 1, CMP(4, 0))]);
T('[3] team competitive duo checkpoint, build 4 with no pick log: rejected (processed, nothing credited), nobody flagged', rejected(c3) && flagged0(c3)
  && new RegExp('::warning::match=' + c3.m + ': team comp segment perk REJECT \\(perk_forge: build-without-picks\\)[^\\n]*-- nobody flagged \\(Q314\\)').test(c3.r.out), show(c3));
const c4 = caseRun(DUO, [X(A, 0, CAS(4, 0)), X(B, 1, CAS(4, 0))]);
T('[4] casual duo, the same build: rejected, nobody flagged', rejected(c4) && flagged0(c4)
  && new RegExp('::warning::match=' + c4.m + ': endless perk REJECT \\(perk_forge: build-without-picks\\)[^\\n]*-- nobody flagged \\(Q314\\)').test(c4.r.out), show(c4));
const c4b = caseRun(TRIO, [X(A, 0, CAS(4, 0)), X(B, 1, CAS(4, 0)), X(C, 2, CAS(4, 0))]);
T('[4] casual trio, the same build: rejected, nobody flagged', rejected(c4b) && flagged0(c4b) && /nobody flagged \(Q314\)/.test(warnOf(c4b.r, c4b.m)), show(c4b));

// ---- [5] the casual reroll bitmap ----
console.log('-- [5] the casual reroll bitmap out of reach on every record --');
const c5 = caseRun(DUO, [X(A, 0, CAS(0, 4)), X(B, 1, CAS(0, 4))]);
T('[5] casual duo, both carry bitmap 4: rejected (processed, nothing credited), nobody flagged', rejected(c5) && flagged0(c5)
  && new RegExp('::warning::match=' + c5.m + ': endless reroll bitmap sanity REJECT \\(reroll-ahead\\) depth 0->6 -- nobody flagged \\(Q314\\)').test(c5.r.out), show(c5));

// ---- [6] untouched ----
console.log('-- [6] untouched --');
const c6a = caseRun(HOLE, [X(A, 0, CAS(0, 0)), X(B, 1, CAS(0, 0))]);
T('[6] casual trio with the same seat table: settles as before (A and B credited), nobody flagged', processedOf(c6a.r).has(c6a.m) && credited(c6a.r, A) && credited(c6a.r, B) && flagged0(c6a), show(c6a));
for (const [label, roster, xs] of [
  ['clean team competitive trio', TRIO, [X(A, 0, CMP(0, 0)), X(B, 1, CMP(0, 0)), X(C, 2, CMP(0, 0))]],
  ['clean casual duo', DUO, [X(A, 0, CAS(0, 0)), X(B, 1, CAS(0, 0))]],
  ['clean team classic trio', TRIO, [X(A, 0, CLS), X(B, 1, CLS), X(C, 2, CLS)]],
]) {
  const c = caseRun(roster, xs);
  T('[6] ' + label + ': settles, every writer credited, nobody flagged', processedOf(c.r).has(c.m) && c.ws.every((s) => credited(c.r, s)) && flagged0(c), show(c));
}
const c6c = caseRun(DUO, [X(A, 0, CMP(0, 4)), X(B, 1, CMP(0, 4))]);
T('[6] team competitive duo, both carry bitmap 4: rejected by the segment chain, nobody flagged (as before)', rejected(c6c) && flagged0(c6c) && /team comp segment reroll chain REJECT \(reroll-ahead\)/.test(warnOf(c6c.r, c6c.m)), show(c6c));
const c6d = caseRun(DUO, [X(A, 0, [0, 6, 0, 1]), X(B, 1, [0, 6, 0, 1])]);
T('[6] tokens on every record keep the whole-group flag (Q305): held, both flagged', !processedOf(c6d.r).has(c6d.m) && flagSet(c6d.r, DUO) === '1/1' && /sanity-flagged \[tokens\]/.test(warnOf(c6d.r, c6d.m)), show(c6d));
const c6e = caseRun(TRIO, [X(A, 0, CAS(0, 0)), X(B, 1, CAS(0, 0)), X(C, 2, CAS(0, 0), { dur: -1 })]);
T('[6] casual trio, C\'s own negative duration: A and B settle, only C flagged (Q306)', processedOf(c6e.r).has(c6e.m) && credited(c6e.r, A) && credited(c6e.r, B) && flagSet(c6e.r, TRIO) === '0/0/1', show(c6e));

// ---- [7] run summary ----
console.log('-- [7] run summary --');
{
  const rowQ = (r) => (r.summary.match(/\| endless co-op checks on values every writer copies from the host, nobody flagged \(Q314\)[^\n|]*\| ([0-9]+) \/ ([0-9]+) \|/) || []).slice(1).join('/');
  const rowP = (r) => (r.summary.match(/\| perk replay rejects \| ([0-9]+) \|/) || []).slice(1).join('/');
  T('[7] [1] counts the short seat table (1 / 0)', rowQ(c1.r) === '1/0', rowQ(c1.r));
  T('[7] [2] counts the short seat table (1 / 0)', rowQ(c2.r) === '1/0', rowQ(c2.r));
  T('[7] [5] counts the out-of-reach bitmap (0 / 1)', rowQ(c5.r) === '0/1', rowQ(c5.r));
  T('[7] [3] / [4] stay on the perk replay row (1 each), the Q314 row 0 / 0', rowP(c3.r) === '1' && rowP(c4.r) === '1' && rowQ(c3.r) === '0/0' && rowQ(c4.r) === '0/0', [rowP(c3.r), rowP(c4.r), rowQ(c3.r), rowQ(c4.r)].join(' '));
  T('[7] a clean run counts nothing', rowQ(c6a.r) === '0/0', rowQ(c6a.r));
}

// ---- [8] wiring + mutation self-check ----
console.log('-- [8] wiring pins + mutation self-check --');
{
  // the check's block: from its `if` (the first after the lane's own anchor) to its `continue;`
  const blk = (lane, anchor) => { const l = SRC.indexOf(lane); const i = l < 0 ? -1 : SRC.indexOf(anchor, l); if (i < 0) return ''; return SRC.slice(i, SRC.indexOf('continue;', i) + 'continue;'.length); };
  const blocks = {
    'team classic seat table': blk('if (isClassicSeg) {', 'if (rosterSids.length !== pc7) {'),
    'team competitive seat table': blk('if ((t.flags | 0) & attest.SEG_COMP) {', 'if (rosterSids.length !== pc7) {'),
    'team competitive perk replay': blk('if ((t.flags | 0) & attest.SEG_COMP) {', 'if (!pvT.ok) {'),
    'casual reroll bitmap': blk('const rcC = rerollChain(', 'if (rcC) {'),
    'casual perk replay': blk('const pvC = perks.verifyPerkPicks(', 'if (!pvC.ok) {'),
  };
  T('[8] the two seat-table blocks are the classic and the competitive lane\'s own', /team classic segment roster incomplete/.test(blocks['team classic seat table']) && /team comp segment roster incomplete/.test(blocks['team competitive seat table']));
  for (const k of Object.keys(blocks)) T('[8] ' + k + ': the check flags nobody (no recordFlag / flagPlayer) and says so', blocks[k].length > 0 && !/recordFlag|flagPlayer|sigDirty/.test(blocks[k]) && /nobody flagged/.test(blocks[k]), blocks[k].slice(0, 200));
  T('[8] the seat-table checks hold (continue, not processed)', !/processed\.add/.test(blocks['team classic seat table']) && !/processed\.add/.test(blocks['team competitive seat table']));
  T('[8] the perk / bitmap checks reject (processed, as before)', /processed\.add\(c\.m\);/.test(blocks['team competitive perk replay']) && /processed\.add\(c\.m\);/.test(blocks['casual reroll bitmap']) && /processed\.add\(c\.m\);/.test(blocks['casual perk replay']));
  const mutants = [
    ['a flag put back in the team competitive seat-table check -> [1] flags both writers again', "RUN.endlessRosterShort = (RUN.endlessRosterShort | 0) + 1;\n          ghWarn('match=' + c.m + ': team comp segment roster incomplete", c1, '1/1'],
    ['a flag put back in the casual perk check -> [4] flags both writers again', "RUN.perkRej = (RUN.perkRej | 0) + 1;\n        ghWarn('match=' + c.m + ': endless perk REJECT (", c4, '1/1'],
    ['a flag put back in the casual bitmap check -> [5] flags both writers again', 'RUN.endlessRrRej = (RUN.endlessRrRej | 0) + 1;', c5, '1/1'],
  ];
  for (const [label, from, c, want] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[8] mutation anchor not found exactly once: ' + label); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-copied-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, 'recordFlag(signals, g, c.m, nowMs); sigDirty = true; ' + from));
      const r = run(c.xs.map((x) => row(c.h, c.roster, x)), attested(c.h, c.roster), script);
      T('[8] ' + label, flagSet(r, c.ws) === want, flagSet(r, c.ws));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-host-copied)') : 'ALL OK (endless-host-copied)');
process.exit(failN ? 1 : 0);
