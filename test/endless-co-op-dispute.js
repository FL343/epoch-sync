'use strict';
// An endless co-op run of three writers or more whose records disagree (Q317, cloud audit 2026-10; found doing Q314).
// End-to-end over the REAL validate.js main() against an offline board stub, the harness of test/endless-host-copied.js.
// Every value the records of an endless key are compared on (vecOf: the score table, the depth tail, the perk build and
// pick log) is the host's broadcast an honest joiner copies as it came, and the run's outcome is the team's. One modified
// joiner writing his own build in a casual or team competitive run of three turned the group inconsistent, and the
// inconsistent-group rule flagged every writer: both honest teammates took a forgery flag with him (probe-q314.js E1 /
// E3). Now a gated endless run of three writers or more whose records disagree flags nobody for the disagreement and
// still does not settle (no majority settle: user question A42); a writer's own negative duration still flags him alone.
//   [1] casual trio, only C writes build 4: held, nothing credited, nobody flagged, the log names the split (2 of 3)
//   [2] team competitive trio, the same; [3] team classic trio, only C writes another score table; [4] casual quad split
//       two and two; [5] casual trio, three different builds; [6] C's own negative duration too: only C flagged;
//       [7] C wrote two different records: he votes for no value, nobody flagged
//   [8] untouched: a casual run of two (the rules after it), an ungated key (Q128), a settled key (Q114), a clean trio
//       settles, a three-seat quick match whose records disagree flags every writer (not endless: user question A42)
//   [9] run summary row; [10] a second run on the carried state flags nobody; [11] flags written by the old rule stay,
//       nothing is added; [12] endlessDispute unit; [13] wiring pins + mutation self-check
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-dispute-'));
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

const tag = (s) => ({ [A]: 'A', [B]: 'B', [C]: 'C', [D]: 'D' })[s] || s;
const QUAD = [A, B, C, D];
const ENDLESS_BOARDS = [BOARD.duo, BOARD.trio, BOARD.quad, BOARD.compTrio, BOARD.compDuo, BOARD.classicDuo, BOARD.classicTrio];
const credited = (r, sid) => ENDLESS_BOARDS.some((b) => writes(r, b, sid).length > 0) && writes(r, BOARD.progress, sid).length > 0;
const noWrite = (r, ws) => ws.every((s) => !ENDLESS_BOARDS.some((b) => writes(r, b, s).length > 0) && writes(r, BOARD.progress, s).length === 0);
const plog = (s) => v.pid(s).slice(0, 8);
// tails: [startDepth, endDepth, continues, tokens, season, flags, build, picksLo, picksHi, rerollLo, rerollHi]
const CAS = (build) => [0, 6, 0, 0, 0, 0, build | 0, 0, 0, 0, 0];
const CMP = (build) => [0, 5, 0, 0, 0, attest.SEG_COMP, build | 0, 0, 0, 0, 0];
const CLS = [0, 5, 0, 0, 0, attest.SEG_CLASSIC, 0, 0, 0, 0, 0];
// build 4 = one perk in slot 0 with an empty pick log; any value other than the host's makes the records disagree
const X = (sid, seat, tail, o, shard) => ({ sid, seat, tail, o, shard });
let hashN = 0x3170;
// one group in one cron run; files: carried state (default: the writers' start attestation, roster registered)
function caseRun(roster, xs, o) {
  o = o || {};
  const h = o.h != null ? o.h : hashN++, m = h + '_5_7';
  const files = o.files || (o.ungated ? attested(h, null) : attested(h, roster));
  if (o.processed) files.PROCESSED_FILE = [m];
  const r = run(xs.map((x) => row(h, roster, x)), files, o.script);
  const ws = Array.from(new Set(xs.map((x) => x.sid)));
  return { r, m, ws, h, roster, xs };
}
const flags = (c) => c.ws.map((s) => flagsOf(c.r, s)).join('/');
const zeros = (c) => c.ws.map(() => '0').join('/');
const flagged0 = (c) => flags(c) === zeros(c) && !flaggedKey(c.r, c.m);
const disputeLine = (c) => (c.r.out.match(new RegExp('  endless-dispute ' + c.m + ': [^\\n]*')) || [''])[0];
const show = (c) => 'flags ' + c.ws.map((s) => tag(s) + '=' + flagsOf(c.r, s)).join(' ') + ' processed=' + processedOf(c.r).has(c.m) + ' credited=' + (c.ws.filter((s) => credited(c.r, s)).map(tag).join('') || '-') + ' | ' + (disputeLine(c) || '(no Q317 line)').slice(0, 260);
const held = (c) => !processedOf(c.r).has(c.m) && noWrite(c.r, c.ws);
const splitIs = (c, most, n, apart) => disputeLine(c).indexOf('largest agreeing set ' + most + ' of ' + n + (apart.length ? ', apart: ' + apart.map(plog).join(', ') : '') + ' (Q317)') > 0;

// ---- [1] .. [7] gated endless runs of three writers or more whose records disagree ----
console.log('-- [1]..[7] an endless run of three writers or more whose records disagree --');
const c1 = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4))]);
T('[1] casual trio, only C writes build 4: held (not processed, nothing credited), nobody flagged, the key not marked', held(c1) && flagged0(c1), show(c1));
T('[1] the log line: 3 records of a run of 3 writers, nobody flagged, not settled, largest agreeing set 2 of 3, apart: C (Q317)',
  /records of a run of 3 writers disagree -- nobody flagged for the disagreement, not settled; /.test(disputeLine(c1)) && splitIs(c1, 2, 3, [C]) && !/flagged alone/.test(disputeLine(c1)), disputeLine(c1));
T('[1] the inconsistent-group warning stays (the records are still shown)', new RegExp('::warning::match=' + c1.m + ': 3 inconsistent/invalid').test(c1.r.out));
const c2 = caseRun(TRIO, [X(A, 0, CMP(0)), X(B, 1, CMP(0)), X(C, 2, CMP(4))]);
T('[2] team competitive trio, only C writes build 4: held, nobody flagged, 2 of 3 apart C', held(c2) && flagged0(c2) && splitIs(c2, 2, 3, [C]), show(c2));
const c3 = caseRun(TRIO, [X(A, 0, CLS), X(B, 1, CLS), X(C, 2, CLS, { scores: [900, 300, 200] })]);
T('[3] team classic trio, only C writes another score table: held, nobody flagged, 2 of 3 apart C', held(c3) && flagged0(c3) && splitIs(c3, 2, 3, [C]), show(c3));
const c4 = caseRun(QUAD, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4)), X(D, 3, CAS(4))]);
T('[4] casual quad split two and two: held, nobody flagged, largest agreeing set 2 of 4', held(c4) && flagged0(c4) && /largest agreeing set 2 of 4, apart: [0-9a-f]{8}, [0-9a-f]{8} \(Q317\)/.test(disputeLine(c4)), show(c4));
const c5 = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(4)), X(C, 2, CAS(8))]);
T('[5] casual trio, three different builds: held, nobody flagged, largest agreeing set 1 of 3', held(c5) && flagged0(c5) && /largest agreeing set 1 of 3, apart: /.test(disputeLine(c5)), show(c5));
const c6 = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4), { dur: -1 })]);
T('[6] casual trio, C writes build 4 with a negative duration: held, only C flagged (his own record), A / B 0',
  held(c6) && flags(c6) === '0/0/1' && flaggedKey(c6.r, c6.m) && new RegExp(plog(C) + ' \\(negative duration on his own record\\) flagged alone').test(disputeLine(c6)), show(c6));
const c7 = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(0), null, 2), X(C, 2, CAS(4), null, 3)]);
T('[7] casual trio, C wrote two different records: held, nobody flagged, C votes for no value (2 of 3 apart C)', held(c7) && flagged0(c7) && splitIs(c7, 2, 3, [C]) && /4 records of a run of 3 writers/.test(disputeLine(c7)), show(c7));

// ---- [8] untouched ----
console.log('-- [8] untouched --');
const c8a = caseRun(DUO, [X(A, 0, CAS(0)), X(B, 1, CAS(4))]);
T('[8] casual run of two whose records disagree: not this rule (no Q317 line), held, nothing credited (the rules after it decide the flags)', !disputeLine(c8a) && held(c8a), show(c8a));
const c8b = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4))], { ungated: true });
T('[8] ungated casual trio: the Q128 skip answers (ungated-mismatch), not this rule, nobody flagged',
  !disputeLine(c8b) && new RegExp('ungated-mismatch ' + c8b.m + ': [^\\n]*nobody flagged \\(Q128\\)').test(c8b.r.out) && flagged0(c8b) && noWrite(c8b.r, c8b.ws), show(c8b));
const c8c = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4))], { processed: true });
T('[8] a settled key: the Q114 skip answers (late-mismatch), not this rule, nobody flagged',
  !disputeLine(c8c) && new RegExp('late-mismatch ' + c8c.m + ': [^\\n]*nobody flagged \\(Q114\\)').test(c8c.r.out) && flagged0(c8c), show(c8c));
const c8d = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(0))]);
T('[8] clean casual trio: settles, every writer credited, nobody flagged, no Q317 line', processedOf(c8d.r).has(c8d.m) && c8d.ws.every((s) => credited(c8d.r, s)) && flagged0(c8d) && !disputeLine(c8d), show(c8d));
// a three-seat quick match (mt 1, not endless) whose records disagree -- C claims the win: every writer flagged as before
let c8e;
{
  const h = hashN++, m = h + '_5_1', SCQ = [9000, 6000, 3000];
  const recQ = (seat, sc) => { const d = [0xB1, 3, 1, h, 5, seat, 1 + seat, (6 << 1) | (seat === 0 ? 1 : 0), 3, 720]; for (const x of sc) d.push(x); d.push(0); for (const s of TRIO) { const p = sidPair(s); d.push(p[0], p[1]); } return d; };
  const st = {}; st[m] = { t0: Date.now() - 30 * 60000, mt: 1, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C) }, settled: [] };
  const r = run([{ shard: 0, sid: A, d: recQ(0, SCQ) }, { shard: 1, sid: B, d: recQ(1, SCQ) }, { shard: 2, sid: C, d: recQ(2, [3000, 6000, 9000]) }], { STARTS_FILE: st });
  c8e = { r, m, ws: TRIO };
  T('[8] three-seat quick match whose records disagree (not endless): every writer flagged as before, no Q317 line', flags(c8e) === '1/1/1' && !disputeLine(c8e) && !processedOf(r).has(m), show(c8e));
}

// ---- [9] run summary ----
console.log('-- [9] run summary --');
{
  const rowE = (r) => (r.summary.match(/\| endless runs of three writers or more whose records disagree, nobody flagged for it, not settled \(Q317\)[^\n|]*\| ([0-9]+) \/ ([0-9]+) \|/) || []).slice(1).join('/');
  T('[9] [1] counts the run (1 / 0)', rowE(c1.r) === '1/0', rowE(c1.r));
  T('[9] [6] counts the run and the own-field flag (1 / 1)', rowE(c6.r) === '1/1', rowE(c6.r));
  T('[9] a clean run, a run of two and an ungated key count nothing here (0 / 0)', rowE(c8d.r) === '0/0' && rowE(c8a.r) === '0/0' && rowE(c8b.r) === '0/0', [rowE(c8d.r), rowE(c8a.r), rowE(c8b.r)].join(' '));
}

// ---- [10] / [11] carried state ----
console.log('-- [10] [11] carried state --');
{
  const again = caseRun(TRIO, c1.xs, { h: c1.h, files: Object.assign({}, c1.r.state) });
  T('[10] a second run on [1]\'s carried state: still held, still nobody flagged, the line again', held(again) && flagged0(again) && splitIs(again, 2, 3, [C]), show(again));
  // the old rule (the Q317 block switched off) writes its flags first; the new rule on that state keeps them, adds none
  const from = '    if (ed) {\n      RUN.endlessDispute';
  if (SRC.split(from).length !== 2) bad('[11] anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-endless-dispute-old-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, '    if (false) {\n      RUN.endlessDispute'));
      const old = caseRun(TRIO, [X(A, 0, CAS(0)), X(B, 1, CAS(0)), X(C, 2, CAS(4))], { script });
      T('[11] the old rule: every writer flagged once (the bug)', flags(old) === '1/1/1' && flaggedKey(old.r, old.m), show(old));
      const now = caseRun(TRIO, old.xs, { h: old.h, files: Object.assign({}, old.r.state) });
      T('[11] the new rule on the old state: the old flags stay (1 / 1 / 1), nothing added, still held', flags(now) === '1/1/1' && held(now) && splitIs(now, 2, 3, [C]), show(now));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [12] endlessDispute ----
console.log('-- [12] endlessDispute --');
{
  const vec = (r) => JSON.stringify(r.d.slice(10));
  const R = (sid, seat, tail, o, roster) => ({ steamID: sid, d: rec7(0x31ff, seat, roster || TRIO, tail, o) });
  T('[12] null for a run of two', v.endlessDispute([R(A, 0, CAS(0), null, DUO), R(B, 1, CAS(4), null, DUO)], vec) === null);
  T('[12] null for a run of two writers whatever their record count', v.endlessDispute([R(A, 0, CAS(0)), R(A, 0, CAS(4)), R(B, 1, CAS(4))], vec) === null);
  const q = { steamID: A, d: rec7(0x31ff, 0, TRIO, CAS(0)) }; q.d[2] = 1;
  T('[12] null for a key that is not endless', v.endlessDispute([q, Object.assign({}, q, { steamID: B }), Object.assign({}, q, { steamID: C })], vec) === null);
  T('[12] null for an empty group', v.endlessDispute([], vec) === null);
  const e1 = v.endlessDispute([R(A, 0, CAS(0)), R(B, 1, CAS(0)), R(C, 2, CAS(4))], vec);
  T('[12] three writers, C apart: writers 3, own none, most A B, apart C', e1 && e1.writers === 3 && e1.own.length === 0 && e1.most.join() === [A, B].join() && e1.apart.join() === C, JSON.stringify(e1));
  const e2 = v.endlessDispute([R(A, 0, CAS(0)), R(B, 1, CAS(0)), R(C, 2, CAS(4), { dur: -1 })], vec);
  T('[12] C\'s negative duration: own = C (his records)', e2 && e2.own.length === 1 && e2.own[0].sid === C && e2.own[0].recs.length === 1, JSON.stringify(e2 && e2.own.map((x) => x.sid)));
  const e3 = v.endlessDispute([R(A, 0, CAS(0), { dur: 0 }), R(B, 1, CAS(0), { dur: 99999999 }), R(C, 2, CAS(4))], vec);
  T('[12] a zero or a long duration on an endless record is no own-field reason', e3 && e3.own.length === 0, JSON.stringify(e3 && e3.own));
  const bad3 = (r) => (String(r.steamID) === C ? 'BAD(tail)' : vec(r));
  const e4 = v.endlessDispute([R(A, 0, CAS(0)), R(B, 1, CAS(4)), R(C, 2, CAS(8)), R(C, 2, CAS(8))], bad3);
  T('[12] a malformed record votes for no value', e4 && e4.most.length === 1 && e4.apart.length === 2 && e4.apart.indexOf(C) >= 0, JSON.stringify(e4));
  const e5 = v.endlessDispute([R(A, 0, CAS(0)), R(B, 1, CAS(0)), R(C, 2, CAS(0)), R(C, 2, CAS(4))], vec);
  T('[12] a writer whose own records disagree votes for no value (most A B, apart C), and is no own-field case', e5 && e5.most.join() === [A, B].join() && e5.apart.join() === C && e5.own.length === 0, JSON.stringify(e5));
}

// ---- [13] wiring + mutation self-check ----
console.log('-- [13] wiring pins + mutation self-check --');
{
  const loop = SRC.indexOf('for (const { m, g } of inconsistentGroups) {');
  const q114 = SRC.indexOf('if (processed.has(m)) {\n      RUN.lateMismatch', loop);
  const q317 = SRC.indexOf('const ed = seatGateRoster(startsPending[m]) ? endlessDispute(g, vecOf) : null;', loop);
  const q128 = SRC.indexOf('if (isEndlessMt(g[0].d[2] | 0) && !seatGateRoster(startsPending[m])) {', loop);
  const rf = SRC.indexOf('if (recordFlag(signals, g, m, nowMs)) sigDirty = true;', loop);
  T('[13] the flag loop: the Q114 skip, then the Q317 rule, then the Q128 skip, then the whole-group flag', loop > 0 && q114 > loop && q317 > q114 && q128 > q317 && rf > q128 && SRC.split('? endlessDispute(g, vecOf) : null').length === 2, [loop, q114, q317, q128, rf].join(' '));
  const blk = SRC.slice(q317, SRC.indexOf('continue;', q317) + 'continue;'.length);
  T('[13] the Q317 block flags only the own-field writers\' records, logs, counts and goes on (not processed)',
    /if \(recordFlag\(signals, \[\]\.concat\(\.\.\.ed\.own\.map\(\(x\) => x\.recs\)\), m, nowMs\)\) sigDirty = true;/.test(blk) && blk.split('recordFlag(').length === 2 && !/flagPlayer|processed\.add|recordFlag\(signals, g,/.test(blk)
    && /RUN\.endlessDispute = /.test(blk) && /\(Q317\)'\);\n\s+continue;$/.test(blk), blk.slice(0, 200));
  const fn = SRC.slice(SRC.indexOf('function endlessDispute(g, vecOf) {'), SRC.indexOf('\n}\n', SRC.indexOf('function endlessDispute(g, vecOf) {')));
  T('[13] endlessDispute: endless keys only, three writers or more, own = the negative duration alone', /!isEndlessMt\(g\[0\]\.d\[2\] \| 0\)\) return null;/.test(fn) && /if \(bySid\.size < 3\) return null;/.test(fn) && /recordSanityFlags\(r, ENDLESS\.MT, r\.d\[8\] \| 0\)\.indexOf\('duration'\) >= 0/.test(fn), fn.slice(0, 120));
  T('[13] summary row', /'\| endless runs of three writers or more whose records disagree, nobody flagged for it, not settled \(Q317\) \/ of them a writer flagged alone for a negative duration on his own record \| ' \+ s\('endlessDispute', 0\) \+ ' \/ ' \+ s\('endlessDisputeOwn', 0\)/.test(SRC));
  const mutants = [
    ['the Q317 block off -> [1] flags every writer again', '    if (ed) {\n      RUN.endlessDispute', '    if (false) {\n      RUN.endlessDispute', c1, (c) => flags(c) === '1/1/1'],
    ['the own-field flag off -> [6] C no longer flagged', '      if (ed.own.length) {\n        RUN.endlessDisputeOwn', '      if (false) {\n        RUN.endlessDisputeOwn', c6, (c) => flags(c) === '0/0/0'],
    ['the whole group flagged in the block -> [1] flags every writer', "if (recordFlag(signals, [].concat(...ed.own.map((x) => x.recs)), m, nowMs)) sigDirty = true;", 'if (recordFlag(signals, g, m, nowMs)) sigDirty = true;', c6, (c) => flags(c) === '1/1/1'],
    ['two writers enough -> [8] the run of two takes the Q317 line', 'if (bySid.size < 3) return null;', 'if (bySid.size < 2) return null;', c8a, (c) => !!disputeLine(c)],
    ['the seat gate not asked -> [8] the ungated trio takes the Q317 line instead of Q128', 'const ed = seatGateRoster(startsPending[m]) ? endlessDispute(g, vecOf) : null;', 'const ed = endlessDispute(g, vecOf);', c8b, (c) => !!disputeLine(c)],
    ['endless not asked -> [8] the quick trio flags nobody', 'if (!g || !g.length || !isEndlessMt(g[0].d[2] | 0)) return null;', 'if (!g || !g.length) return null;', c8e, (c) => flags(c) === '0/0/0'],
  ];
  for (const [label, from, to, c, isMut] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[13] mutation anchor not found exactly once: ' + label); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-dispute-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      let r;
      if (c === c8e) {
        const h = Number(c.m.split('_')[0]), recs = [];
        for (const e of [[0, A, [9000, 6000, 3000]], [1, B, [9000, 6000, 3000]], [2, C, [3000, 6000, 9000]]]) {
          const d = [0xB1, 3, 1, h, 5, e[0], 1 + e[0], (6 << 1) | (e[0] === 0 ? 1 : 0), 3, 720]; for (const x of e[2]) d.push(x); d.push(0); for (const s of TRIO) { const p = sidPair(s); d.push(p[0], p[1]); }
          recs.push({ shard: e[0], sid: e[1], d });
        }
        const st = {}; st[c.m] = { t0: Date.now() - 30 * 60000, mt: 1, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C) }, settled: [] };
        r = run(recs, { STARTS_FILE: st }, script);
      } else r = run(c.xs.map((x) => row(c.h, c.roster, x)), c === c8b ? attested(c.h, null) : attested(c.h, c.roster), script);
      const mc = { r, m: c.m, ws: c.ws };
      T('[13] mutant: ' + label, isMut(mc), show(mc));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-co-op-dispute)') : 'ALL OK (endless-co-op-dispute)');
process.exit(failN ? 1 : 0);
