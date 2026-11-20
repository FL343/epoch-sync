'use strict';
// O922 (2026-11-20): a casual co-op save-slot resume does not carry the run seed back (client private-lobby.js `_sv`; only the
//   competitive resume `_cr` restores it), so the resumed session's record carries a NEW runSeed (d[4]) while its pick log still
//   holds the draws made before the save under the OLD seed. Rules v2 choose each draw's candidate set by runSeed, so the whole-log
//   replay under d[4] shows other cards -> perk_forge (launch to 2026-11-19: at least 24 honest resumes rejected, 1 settled).
//   The casual co-op lane now settles such a resume (logged + counted) when the failure depends on the cards shown and the resume
//   is backed by the team's settled depth on this ladder; everything else is rejected as before.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/endless-host-copied.js):
//   [1] resumed duo (start 25), pick log drawn under another seed, team settled 25 (the save point) on this ladder: settles, both credited,
//       resume-loose line, no REJECT, nobody flagged
//   [1b] [1] again with the live seedcap switches on (validate.yml): still settles
//   [2] the same record, nobody settled on this ladder (the host left the saved session with Esc, Q406 shape): settles once the
//       full span has passed (O922 review 1) -- [2b] started 10 min ago: deferred by the chain rule (full span 28 levels = 17.5 min);
//       [2c] [2] again with the live seedcap switches on: still settles
//   [3] the same record, team settled only 20 (< start 25): settles
//   [4] not a resume (start 0), the same mismatching build: rejected (unchanged)
//   [5] resumed + backed, but a malformed log (more picks than the depth allows): rejected (shape checks stay strict)
//   [6] resumed + backed, a log that replays under the record seed: settles on the normal path (no resume-loose line)
//   [7] the run summary counts the tolerated resumes
//   [8] unit truth table of coopResumePerkLoose + class pins (every seed-independent "why" before the replay is a shape why;
//       one call site, on the casual co-op lane) + mutation self-checks (pure and end-to-end)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_DEPTH_CAP', 'ENDLESS_SCORE_MULT'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const PK = require(path.join(ROOT, 'perks.js'));
const P = PK.load();

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(ROOT, 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
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

function runCron(boards, files, script, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-resume-'));
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
      SEASON_NOW: '2026-10-01T00:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
    }, stateEnv, extraEnv || {});
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

const A = '76561198000000001', B = '76561198000000002';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const REC_SEED = 5;   // rec7 writes runSeed 5 at d[4] (the seed of the resumed session)
function rec7(hash, seat, roster, tail) {
  const pc = roster.length, sc = [400, 300];
  const d = [0xB1, 3, 7, hash | 0, REC_SEED, seat, 0, 0, pc, 900];
  for (let i = 0; i < pc; i++) d.push(sc[i] | 0);
  d.push(0);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  for (const x of tail) d.push(x | 0);
  return d;
}
const DUO = [A, B];
const BOARD = { progress: 5, cp: 8, duo: 15 };
// best: { sid: depth } rows already on the casual duo ladder (the chain the resume leans on)
function world(rows, best) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  const ladder = Object.keys(best || {}).map((sid) => ({ steamID: sid, score: v.packEndlessScore(best[sid], 1000) }));
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: BOARD.cp, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: ladder }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] });
  return boards;
}
const attested = (hash, ageMin) => { const s = {}; s[hash + '_5_7'] = { t0: Date.now() - (ageMin || 90) * 60000, mt: 7, roster: { 0: v.pid(A), 1: v.pid(B) }, settled: [] }; return { STARTS_FILE: s }; };
let hashN = 0x9220;
function caseRun(tail, best, script, extraEnv, ageMin) {
  const h = hashN++, m = h + '_5_7';
  const rows = [{ shard: 0, sid: A, d: rec7(h, 0, DUO, tail) }, { shard: 1, sid: B, d: rec7(h, 1, DUO, tail) }];
  return { r: runCron(world(rows, best), attested(h, ageMin), script, extraEnv), m };
}
const credited = (c, sid) => writes(c.r, BOARD.duo, sid).length > 0 && writes(c.r, BOARD.progress, sid).length > 0;
const nobodyFlagged = (c) => flagsOf(c.r, A) === 0 && flagsOf(c.r, B) === 0;
const settledBoth = (c) => processedOf(c.r).has(c.m) && credited(c, A) && credited(c, B);
const rejected = (c) => processedOf(c.r).has(c.m) && !credited(c, A) && !credited(c, B);
const looseLine = (c) => new RegExp('endless perk resume-loose ' + c.m + ': perk_forge: [a-z-]+(@\\d+)? build \\d+ depth 25->28 \\(chain \\d+\\) -- perk build not verified, on to the chain rule \\(O922\\)').test(c.r.out);
const rejectLine = (c) => new RegExp('::warning::match=' + c.m + ': endless perk REJECT \\(perk_forge: [^)]*\\)').test(c.r.out);
const show = (c) => 'processed=' + processedOf(c.r).has(c.m) + ' credited=' + [A, B].filter((s) => credited(c, s)).length + ' flags=' + flagsOf(c.r, A) + '/' + flagsOf(c.r, B) + ' loose=' + looseLine(c) + ' reject=' + rejectLine(c) + ' exit=' + c.r.code;

// ---- the honest resume, built with the real perk module ----
// a duo that saved at passed 25 (draws at 5 / 10 / 15 / 20 / 25, made under the ORIGINAL seed), resumed (new seed d[4] = 5),
//   passed 3 more and lost its lives: start 25, end 28, no draw after the resume. Its build is the original seed's replay.
const SEASON = 0, START = 25, END = 28;
const opts = (seed) => PK.replayOpts({ seasonId: SEASON, runSeed: seed, flags: 0 }, 2, 'ea');
const picks = [1, 2, 3, 1, 2]; while (picks.length < 20) picks.push(0);
const pk = P.packPicks(picks);
let ORIG = 0, buildOrig = 0;
for (let s = 101; s < 5000; s++) {
  const ra = P.replay(P.seasonSeed(SEASON), picks, END, opts(s)), rb = P.replay(P.seasonSeed(SEASON), picks, END, opts(REC_SEED));
  if (ra.ok && (!rb.ok || (rb.build >>> 0) !== (ra.build >>> 0))) { ORIG = s; buildOrig = ra.build >>> 0; break; }
}
const buildSame = (P.replay(P.seasonSeed(SEASON), picks, END, opts(REC_SEED)).build >>> 0);
// tail: [startDepth, endDepth, continues, tokens, season, flags, build, picksLo, picksHi, rerollLo, rerollHi]
const TAIL = (sd, ed, build, lo, hi) => [sd, ed, 0, 0, SEASON, 0, build | 0, lo | 0, hi | 0, 0, 0];
console.log('-- precondition --');
const pv0 = PK.verifyPerkPicks({ build: buildOrig, picksLo: pk.lo, picksHi: pk.hi, seasonId: SEASON, endDepth: END, runSeed: REC_SEED }, null, 2, 'ea');
T('[0] the honest resumed log (drawn under seed ' + ORIG + ') fails the whole-log replay under the record seed: ' + (pv0.reason + ': ' + pv0.why), ORIG > 0 && !pv0.ok && pv0.reason === 'perk_forge' && PK.rulesVerOf({ seasonId: SEASON, flags: 0 }, 'ea') >= 2);

console.log('-- [1]..[6] end-to-end --');
const c1 = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), { [A]: START, [B]: START });   // the session before the save settled to 25
T('[1] resumed duo, team settled 25 (the save point) on this ladder: settles, both credited, resume-loose line, no REJECT, nobody flagged', settledBoth(c1) && looseLine(c1) && !rejectLine(c1) && nobodyFlagged(c1), show(c1));
// the live job runs with the seedcap switches on (validate.yml SEEDCAP_ENFORCE / SEEDCAP_REJECT = 1): the tolerated group must still settle
const c1b = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), { [A]: START, [B]: START }, null, { SEEDCAP_ENFORCE: '1', SEEDCAP_REJECT: '1' });
T('[1b] the same as [1] with the live seedcap switches on (SEEDCAP_ENFORCE / SEEDCAP_REJECT = 1): still settles, both credited', settledBoth(c1b) && looseLine(c1b) && !rejectLine(c1b) && nobodyFlagged(c1b), show(c1b));
const c2 = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), {});
T('[2] the same record, nobody settled on this ladder: settles after the full span, resume-loose line, no REJECT, nobody flagged', settledBoth(c2) && looseLine(c2) && !rejectLine(c2) && nobodyFlagged(c2), show(c2));
const c2b = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), {}, null, null, 10);
const paced = (c) => !processedOf(c.r).has(c.m) && !credited(c, A) && !rejectLine(c) && new RegExp('endless-pacing ' + c.m + ': depth 25->28 \\(chain 0\\) needs 1050s').test(c.r.out);
T('[2b] the same record, nobody settled, started 10 min ago: deferred by the chain rule (full span 28 x 37.5 s), not rejected, not settled', paced(c2b), show(c2b));
const c2c = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), {}, null, { SEEDCAP_ENFORCE: '1', SEEDCAP_REJECT: '1' });
T('[2c] the same as [2] with the live seedcap switches on (SEEDCAP_ENFORCE / SEEDCAP_REJECT = 1): still settles, both credited', settledBoth(c2c) && looseLine(c2c) && !rejectLine(c2c) && nobodyFlagged(c2c), show(c2c));
const c3 = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), { [A]: 20, [B]: 20 });
T('[3] the same record, team settled only 20 (< start 25): settles', settledBoth(c3) && looseLine(c3) && !rejectLine(c3), show(c3));
const c4 = caseRun(TAIL(0, END, buildOrig, pk.lo, pk.hi), { [A]: 30, [B]: 30 });
T('[4] not a resume (start 0), the same mismatching build: rejected (unchanged)', rejected(c4) && rejectLine(c4) && !looseLine(c4), show(c4));
const many = [1, 2, 3, 1, 2, 3, 1]; while (many.length < 20) many.push(0);
const pkMany = P.packPicks(many);
const c5 = caseRun(TAIL(START, END, buildOrig, pkMany.lo, pkMany.hi), { [A]: 30, [B]: 30 });
T('[5] resumed + backed, 7 picks at end depth 28 (malformed, picks-count): rejected (shape checks stay strict)', rejected(c5) && new RegExp('::warning::match=' + c5.m + ': endless perk REJECT \\(perk_forge: picks-count').test(c5.r.out), show(c5));
const c6 = caseRun(TAIL(START, END, buildSame, pk.lo, pk.hi), { [A]: START, [B]: START });
T('[6] resumed + backed, a log that replays under the record seed: settles on the normal path (no resume-loose line)', settledBoth(c6) && !looseLine(c6) && !rejectLine(c6), show(c6));

console.log('-- [7] run summary --');
const sumRow = (c) => (c.r.summary.split('\n').find((l) => l.indexOf('(O922)') >= 0) || '(no O922 row, ' + c.r.summary.length + ' chars)');
T('[7] the summary counts the tolerated resume when it settles (1 in [1], 0 in [4], 0 in the deferred [2b])', /\| co-op resumes settled without a perk replay \(O922\) \| 1 \|/.test(c1.r.summary) && /\| co-op resumes settled without a perk replay \(O922\) \| 0 \|/.test(c4.r.summary) && /\| co-op resumes settled without a perk replay \(O922\) \| 0 \|/.test(c2b.r.summary),
  '[1] ' + sumRow(c1) + ' / [4] ' + sumRow(c4) + ' / [2b] ' + sumRow(c2b));

console.log('-- [8] unit + class pins + mutations --');
const L = v.coopResumePerkLoose, F = (why) => ({ ok: false, reason: 'perk_forge', why });
T('[8] truth table: card-dependent failure on a resume -> tolerated; start 0 / shape / perk_chain / ok -> not',
  L(F('build-mismatch'), 25) && L(F('pick-range@2'), 25) && L(F('build-mismatch'), 1) && !L(F('build-mismatch'), 0)
  && !L(F('picks-count@7'), 25) && !L(F('picks-shape'), 25) && !L(F('build-shape'), 25) && !L(F('build-without-picks'), 25)
  && !L({ ok: false, reason: 'perk_chain', why: 'prefix' }, 25) && !L({ ok: true }, 25) && !L(null, 25));
// class pin: every "why" verifyPerkPicks returns before it replays, and every "why" the vendor replay returns before its walk, is a
//   shape why (they do not depend on the run seed) -- a new structural check must be classified here
const pkSrc = fs.readFileSync(path.join(ROOT, 'perks.js'), 'utf8');
const vpBody = pkSrc.slice(pkSrc.indexOf('function verifyPerkPicks'), pkSrc.indexOf('P.replay(', pkSrc.indexOf('function verifyPerkPicks')));
const venSrc = fs.readFileSync(path.join(ROOT, 'perks-vendor', 'perks.js'), 'utf8');
const rpStart = venSrc.indexOf('function replay(');
const rpPre = venSrc.slice(rpStart, venSrc.indexOf('_walkV2(', rpStart));
// verifyPerkPicks: its perk_forge whys (perk_chain is never tolerated); the vendor replay prelude: every why (all perk_forge there)
const pre = Array.from(new Set(Array.from(vpBody.matchAll(/reason: 'perk_forge', why: '([a-z-]+)'/g), (m) => m[1]).concat(Array.from(rpPre.matchAll(/why: '([a-z-]+)'/g), (m) => m[1]))));
T('[8] every seed-independent why before the replay is a shape why (' + pre.join(', ') + ')', pre.length >= 4 && pre.every((w) => v.PERK_SHAPE_WHY.indexOf(w) >= 0) && v.PERK_SHAPE_WHY.every((w) => pre.indexOf(w) >= 0));
const calls = SRC.split('coopResumePerkLoose(').length - 1;
const callAt = SRC.indexOf('coopResumePerkLoose(pvC, t.startDepth)');
const lane0 = SRC.indexOf("ghWarn('match=' + c.m + ': endless reroll bitmap sanity REJECT ("), lane1 = SRC.indexOf('// chain rule: startDepth credit only up to the deepest end depth');
T('[8] one call site (+ the definition), on the casual co-op lane between its reroll check and its chain rule', calls === 2 && callAt > lane0 && callAt < lane1 && lane0 > 0);

const ROOTP = ROOT.replace(/\\/g, '/');
function mutant(good, badS) {
  if (SRC.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80));
  const m = SRC.split(good).join(badS).replace(/require\('\.\//g, "require('" + ROOTP + '/').replace(/__dirname/g, JSON.stringify(ROOTP));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-resume-mut-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, m);
  return { path: p, mod: () => { delete require.cache[p]; return require(p); }, done: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}
// control: an unchanged copy loads the same way and keeps the truth table
{
  const mu = mutant('function coopResumePerkLoose(', 'function coopResumePerkLoose(');
  let okC = false; try { const M = mu.mod(); okC = M.coopResumePerkLoose(F('build-mismatch'), 25) && !M.coopResumePerkLoose(F('build-mismatch'), 0); } catch (e) { okC = false; } finally { mu.done(); }
  T('[8] mutation control: an unchanged copy loads and keeps the truth table', okC);
}
const pure = [
  ['the resume test dropped (a fresh run tolerated)', 'if ((startDepth | 0) <= 0) return false;', '', (M) => M.coopResumePerkLoose(F('build-mismatch'), 0)],
  ['the shape guard dropped (a malformed log tolerated)', "return PERK_SHAPE_WHY.indexOf(String(pv.why || '').split('@')[0]) < 0;", 'return true;', (M) => M.coopResumePerkLoose(F('picks-count@7'), 25)],
  ['the "@" suffix not cut (a shape why with a position slips through)', "String(pv.why || '').split('@')[0]", "String(pv.why || '')", (M) => M.coopResumePerkLoose(F('picks-count@7'), 25)],
];
for (const [name, good, badS, isRed] of pure) {
  const mu = mutant(good, badS);
  let red = false; try { red = !!isRed(mu.mod()); } catch (e) { red = true; } finally { mu.done(); }
  T('[8] mutation "' + name + '" is caught', red);
}
{
  const mu = mutant('if (!pvC.ok && coopResumePerkLoose(pvC, t.startDepth)) {', 'if (false) {');
  let red = false; try { const c = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), { [A]: START, [B]: START }, mu.path); red = rejected(c) && rejectLine(c); } finally { mu.done(); }
  T('[8] mutation "the lane does not ask coopResumePerkLoose" is caught end-to-end ([1] rejected again)', red);
}

{
  const mu = mutant('const reqMs = endlessRequiredMs(t, chainMax);', 'const reqMs = endlessRequiredMs(t, t.startDepth);');
  let red = false; try { const c = caseRun(TAIL(START, END, buildOrig, pk.lo, pk.hi), {}, mu.path, null, 10); red = !paced(c); } finally { mu.done(); }
  T('[8] mutation "the lane credits the claimed start of an unbacked resume (no full span)" is caught end-to-end ([2b] settles at once)', red);
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (coop-resume-perk-loose) ===' : '=== PASS -- 0 fail (coop-resume-perk-loose) ===');
process.exit(failN ? 1 : 0);
