'use strict';
// One save row starts one resumed session (cloud audit R1-A3-02, 2026-10-08): end-to-end over the REAL validate.js main() against
// an offline stateful board stub, several runs with the job clock advanced between them (the harness of test/writer-pacing.js;
// the stub also swaps attest-keys.json for a test sealed key, so real guard-shaped signed solo records settle).
//   [1] the first resumed session's first segment (row tag T) sits on TWO shards (the guard's retry wrote the same bytes again;
//       a client retry / crash resend does the same) and is read again on every later run: it settles ONCE, no reject, no signal
//   [2] a second session from the same row (written back after the tombstone; new matchId = new segment key, same tag) ->
//       save-reused on first sight: not settled, the run is burnt, the row owner gets rv = 1 (record-only, the trust flag counter
//       f is untouched), the step summary counts it
//   [3] that replayed session's later segment -> run-burnt (counted), nothing reaches a board
//   [4] the lever (RESUME_TAG_REQUIRED=1): an untagged token resume (a build before the fix) is refused and counted; off
//       (default) it settles and is counted as "untagged settled"
//   [5] team classic (consensus lane, tag in the 12th tail int): both writers' copies, read again on every run, settle once; a
//       replayed session is save-reused, the run burnt, rv on seat 0 (the host) only
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/writer-pacing.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const ATTEST = path.join(__dirname, '..', 'attest.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// test sealed key (never a production key: the stub hands validate.js this table instead of attest-keys.json)
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('5e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2026100899;
const PUBS = { [String(KEY_ID)]: { pubs: [PUB], sealed: true } };
const STUB = [
  "const fs = require('fs');",
  "const A = require(process.env.STUB_ATTEST); A.loadPubTable = () => JSON.parse(process.env.STUB_PUBS);",
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-replay-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, STUB_ATTEST: ATTEST, STUB_PUBS: JSON.stringify(PUBS),
      GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned season clock (every test runs before each production reconcile)
      RESUME_TAG_REQUIRED: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) if (st[k] && st[k].t0) st[k].t0 -= ms;
  return files;
}

const SID = '76561198000000011';
const lohi = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RUN_SEED = 424242, SEASON = 0;
// guard-shaped signed solo segment (attVer 5, BASE_LEN 30): [21] = attVer | jwt<<8 | resumeTag<<9 (R1-A3-02)
function seg(o) {
  const [lo, hi] = lohi(SID);
  const b = [0xB1, 3, 7, A.hash32(o.matchId + 's' + (o.segIdx | 0)), RUN_SEED, 0, 1, 0, 1,
    300, o.score == null ? 1000 : o.score, 0, lo, hi, o.sd | 0, o.ed | 0, 0, 0, SEASON, o.flags | 0,
    KEY_ID, (5 | (((o.tag | 0) & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  const d = b.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const CAS = A.SEG_CASUAL, RES = A.SEG_RESUMED;
// shards: { shardIndex: [details] } (one entry per shard per account, like the real pool)
function boardsWith(byShard) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: (byShard[i] ? [{ steamID: SID, score: 1, details: byShard[i] }] : []) });
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 8, name: 'cp_bank', entries: [{ steamID: SID, score: 500 }] }, { id: 9, name: v.ENDLESS_LB_SOLO, entries: [] });
  return boards;
}
const writesTo = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const pidA = v.pid(SID);
const runKey = v.soloRunKey(pidA, SEASON, RUN_SEED);
// the run so far: a casual run that reached depth 7 and ended there (FINAL) -- the checkpoint row at 5 is what gets resumed
const seedSolo = () => ({ runs: { [runKey]: { max: 7, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 } }, wait: {}, ms: {} });
const settleLines = (r, m) => r.out.split('\n').filter(l => l.indexOf('solo settle ' + m) >= 0);
const rejectLines = (r, m) => r.out.split('\n').filter(l => l.indexOf('match=' + m) >= 0 && /REJECT/.test(l));
const TAG = 0x51A7E;
const HOUR = 3600000;

console.log('=== R1-A3-02 one row, one resume (real main(), several runs) ===');
const s1 = seg({ matchId: 'resA', segIdx: 0, sd: 5, ed: 8, flags: CAS | RES, tag: TAG });   // session A, first segment (tagged)
const mA = keyOf(s1);
let r;
{
  console.log('-- [1] the same record on two shards, read again on every run: one settle --');
  const boards = boardsWith({ 0: s1, 7: s1 });   // a retry that landed the same bytes on a second shard (a same-shard rewrite is the easy case)
  r = runCron(boards, { SOLO_FILE: seedSolo() });
  T('[1] run 1 exits 0', r.code === 0, r.out.slice(-400));
  T('[1] run 1: first sighting waits for real time (no settle, no reject)', settleLines(r, mA).length === 0 && rejectLines(r, mA).length === 0, r.out.split('\n').filter(l => l.indexOf(mA) >= 0).join(' | '));
  const r2 = runCron(boards, advance(r.state, 2 * HOUR));
  T('[1] run 2: settles once', settleLines(r2, mA).length === 1 && processedOf(r2).has(mA), r2.out.split('\n').filter(l => l.indexOf(mA) >= 0).join(' | '));
  const run2 = (r2.state.SOLO_FILE.runs || {})[runKey] || {};
  T('[1] run 2: the row tag is recorded against this segment key (run.revs)', run2.revs && run2.revs[TAG] === mA && !run2.burnt, JSON.stringify(run2));
  T('[1] run 2: the casual ladder written once (depth 8)', writesTo(r2, 9).length === 1, String(writesTo(r2, 9).length));
  T('[1] run 2: byte-identical copies are not a fork', /\| solo same-key forks \(another signed record under a settled segment key\) \| 0 \|/.test(r2.summary), r2.summary.split('\n').filter(l => /same-key forks/.test(l)).join(''));
  const r3 = runCron(boards, advance(r2.state, 2 * HOUR));
  T('[1] run 3: re-read on both shards -> nothing settles again, no reject', settleLines(r3, mA).length === 0 && rejectLines(r3, mA).length === 0 && writesTo(r3, 9).length === 0);
  const rv3 = ((r3.state.SIGNALS_FILE || {}).players || {})[pidA] || {};
  T('[1] run 3: no replay signal on an honest run', !(rv3.rv > 0) && /\| token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused \| 0 \/ 0 \/ 0 \/ 0 \|/.test(r3.summary), r3.summary.split('\n').filter(l => /token resumes/.test(l)).join(''));
  r = r3;
}
const s2 = seg({ matchId: 'resB', segIdx: 0, sd: 5, ed: 9, flags: CAS | RES, tag: TAG });   // session B: same row written back, new matchId
const mB = keyOf(s2);
{
  console.log('-- [2] a second session from the same row: save-reused, run burnt, owner signal (record-only) --');
  const boards = boardsWith({ 0: s1, 7: s1, 12: s2 });
  const f0 = (((r.state.SIGNALS_FILE || {}).players || {})[pidA] || {}).f | 0;
  const r4 = runCron(boards, advance(r.state, 2 * HOUR));
  T('[2] run 4: rejected on first sight (save-reused), processed, nothing settles', rejectLines(r4, mB).some(l => /save-reused/.test(l)) && settleLines(r4, mB).length === 0 && processedOf(r4).has(mB),
    r4.out.split('\n').filter(l => l.indexOf(mB) >= 0).join(' | '));
  const run4 = (r4.state.SOLO_FILE.runs || {})[runKey] || {};
  T('[2] run 4: the run is burnt', run4.burnt === 1, JSON.stringify(run4));
  T('[2] run 4: no ladder write', writesTo(r4, 9).length === 0);
  const p4 = ((r4.state.SIGNALS_FILE || {}).players || {})[pidA] || {};
  T('[2] run 4: owner signal rv = 1, the trust flag counter f unchanged', p4.rv === 1 && (p4.f | 0) === f0, JSON.stringify(p4));
  T('[2] run 4: step summary counts one replay', /\| token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused \| 1 \/ 0 \/ 0 \/ 0 \|/.test(r4.summary), r4.summary.split('\n').filter(l => /token resumes/.test(l)).join(''));
  const r5 = runCron(boards, advance(r4.state, 2 * HOUR));
  const p5 = ((r5.state.SIGNALS_FILE || {}).players || {})[pidA] || {};
  T('[2] run 5: re-read -> no second count (processed)', p5.rv === 1 && rejectLines(r5, mB).length === 0, JSON.stringify(p5));
  r = r5;
}
{
  console.log('-- [3] the replayed session goes on: run-burnt --');
  const s3 = seg({ matchId: 'resB', segIdx: 1, sd: 9, ed: 10, flags: CAS });
  const m3 = keyOf(s3);
  const r6 = runCron(boardsWith({ 0: s1, 7: s1, 12: s2, 13: s3 }), advance(r.state, 2 * HOUR));
  T('[3] run 6: later segment -> run-burnt, no ladder write, counted', rejectLines(r6, m3).some(l => /run-burnt/.test(l)) && writesTo(r6, 9).length === 0 &&
    /\| token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused \| 0 \/ 1 \/ 0 \/ 0 \|/.test(r6.summary), r6.out.split('\n').filter(l => l.indexOf(m3) >= 0).join(' | '));
  const p6 = ((r6.state.SIGNALS_FILE || {}).players || {})[pidA] || {};
  T('[3] run 6: rv stays 1 (one replay = one count, not one per burnt segment)', p6.rv === 1, JSON.stringify(p6));
}
{
  console.log('-- [4] the pre-fix window lever --');
  const u = seg({ matchId: 'resU', segIdx: 0, sd: 5, ed: 8, flags: CAS | RES, tag: 0 });   // a build before the fix: no tag
  const mU = keyOf(u);
  const boards = boardsWith({ 3: u });
  const on1 = runCron(boards, { SOLO_FILE: seedSolo() }, { RESUME_TAG_REQUIRED: '1' });
  T('[4] lever on: untagged resume refused on first sight, counted', rejectLines(on1, mU).some(l => /resume-untagged/.test(l)) && processedOf(on1).has(mU) &&
    /\| token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused \| 0 \/ 0 \/ 0 \/ 1 \|/.test(on1.summary), on1.out.split('\n').filter(l => l.indexOf(mU) >= 0).join(' | '));
  const off1 = runCron(boards, { SOLO_FILE: seedSolo() });
  const off2 = runCron(boards, advance(off1.state, 2 * HOUR));
  T('[4] lever off (default): untagged resume settles as before, counted as untagged settled', settleLines(off2, mU).length === 1 &&
    /\| token resumes: replays caught \/ burnt-run segments \/ untagged settled \/ untagged refused \| 0 \/ 0 \/ 1 \/ 0 \|/.test(off2.summary), off2.out.split('\n').filter(l => l.indexOf(mU) >= 0 || /token resumes/.test(l)).join(' | '));
}

{
  console.log('-- [5] team classic: the same tagged segment from both writers, re-read every run, then a replayed session --');
  const SB = '76561198000000012', RS2 = 515151, TT = 0x3C0DE;
  const kTeam = v.teamRunKey([SID, SB], 0, RS2);
  const seedTeam = () => ({ runs: { [kTeam]: { max: 5, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 } }, wait: {}, ms: {} });
  // wire-form type-7 record, pc 2: header, scores, disp, roster, then the tail (11 ints) + the 12th int = the resume tag
  const tm = (hash, seat, o) => {
    const d = [0xB1, 3, 7, hash | 0, RS2, seat, 0, 0, 2, 1200, 1000, 900, 0];
    for (const sid of [SID, SB]) { const q = lohi(sid); d.push(q[0], q[1]); }
    d.push(o.sd | 0, o.ed | 0, 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0, o.tag | 0);
    return d;
  };
  const teamBoards = (recs) => {
    const boards = [];
    for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    for (const [shard, sid, d] of recs) boards[shard].entries.push({ steamID: sid, score: 1, details: d });
    boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
      { id: 8, name: 'cp_bank', entries: [] }, { id: 10, name: v.ENDLESS_LB_CLASSIC_DUO, entries: [] });
    return boards;
  };
  const K = A.SEG_CLASSIC;
  const a0 = tm(0x1111, 0, { sd: 4, ed: 6, flags: K | RES, tag: TT }), a1 = tm(0x1111, 1, { sd: 4, ed: 6, flags: K | RES, tag: TT });
  const mTA = keyOf(a0);
  // each writer's copy on its own shard; a client retry rewrites the same bytes on the SAME shard (R1-A2-03 keeps the retry there: a
  //   second copy by one writer on another shard is the pre-existing dup-writer flag, outside this rule)
  const recsA = [[0, SID, a0], [3, SB, a1]];
  const teamSettle = (rr, m) => rr.out.split('\n').filter(l => l.indexOf('endless-classic settle ' + m) >= 0);
  const t1 = runCron(teamBoards(recsA), { SOLO_FILE: seedTeam() });
  T('[5] run 1: first sighting waits (no settle, no reject)', t1.code === 0 && teamSettle(t1, mTA).length === 0 && rejectLines(t1, mTA).length === 0, t1.out.split('\n').filter(l => l.indexOf(mTA) >= 0).join(' | '));
  const t2 = runCron(teamBoards(recsA), advance(t1.state, 2 * HOUR));
  const tr2 = (t2.state.SOLO_FILE.runs || {})[kTeam] || {};
  T('[5] run 2: settles once, tag recorded', teamSettle(t2, mTA).length === 1 && processedOf(t2).has(mTA) && tr2.revs && tr2.revs[TT] === mTA, t2.out.split('\n').filter(l => l.indexOf(mTA) >= 0).join(' | ') + ' ' + JSON.stringify(tr2));
  const t3 = runCron(teamBoards(recsA), advance(t2.state, 2 * HOUR));
  T('[5] run 3: re-read -> nothing again', teamSettle(t3, mTA).length === 0 && rejectLines(t3, mTA).length === 0);
  const b0 = tm(0x2222, 0, { sd: 4, ed: 7, flags: K | RES, tag: TT }), b1 = tm(0x2222, 1, { sd: 4, ed: 7, flags: K | RES, tag: TT });
  const mTB = keyOf(b0);
  const t4 = runCron(teamBoards(recsA.concat([[1, SID, b0], [1, SB, b1]])), advance(t3.state, 2 * HOUR));
  const tr4 = (t4.state.SOLO_FILE.runs || {})[kTeam] || {};
  const pa = ((t4.state.SIGNALS_FILE || {}).players || {})[pidA] || {}, pb = ((t4.state.SIGNALS_FILE || {}).players || {})[v.pid(SB)] || {};
  T('[5] run 4: replayed session -> save-reused, run burnt', rejectLines(t4, mTB).some(l => /save-reused/.test(l)) && tr4.burnt === 1 && teamSettle(t4, mTB).length === 0,
    t4.out.split('\n').filter(l => l.indexOf(mTB) >= 0).join(' | '));
  T('[5] run 4: rv on seat 0 (the host whose box held the row) only', pa.rv === 1 && !(pb.rv > 0), JSON.stringify({ a: pa.rv, b: pb.rv }));
}

{
  console.log('-- [6] residual watch: two different signed records under one segment key (a replay that reused the session id) --');
  // a modified client can hand the guard the first session's matchId again, so the replayed first segment carries the SAME key; when
  //   both copies are on the board before the cron reads either, the first verified copy settles and the other is dropped -- the
  //   rule cannot tell which session was the replay. Counted (step summary) so the rate can be read after launch.
  const fa = seg({ matchId: 'resF', segIdx: 0, sd: 5, ed: 8, flags: CAS | RES, tag: 0x7F00F, score: 1000 });
  const fb = seg({ matchId: 'resF', segIdx: 0, sd: 5, ed: 10, flags: CAS | RES, tag: 0x7F00F, score: 2600 });
  const mF = keyOf(fa);
  T('[6] both copies share the segment key', keyOf(fb) === mF);
  const boards = boardsWith({ 4: fa, 9: fb });
  const g1 = runCron(boards, { SOLO_FILE: seedSolo() });
  const g2 = runCron(boards, advance(g1.state, 2 * HOUR));
  T('[6] one of them settles, once', settleLines(g2, mF).length === 1 && processedOf(g2).has(mF), g2.out.split('\n').filter(l => l.indexOf(mF) >= 0).join(' | '));
  T('[6] counted as a same-key fork (record-only: no reject, no signal)', /\| solo same-key forks \(another signed record under a settled segment key\) \| 1 \|/.test(g2.summary) && !((((g2.state.SIGNALS_FILE || {}).players || {})[pidA] || {}).rv > 0),
    g2.summary.split('\n').filter(l => /same-key forks/.test(l)).join(''));
  const g3 = runCron(boards, advance(g2.state, 2 * HOUR));
  T('[6] re-read -> not counted again (processed)', /\| solo same-key forks \(another signed record under a settled segment key\) \| 0 \|/.test(g3.summary) && settleLines(g3, mF).length === 0);
}

console.log(failN ? '=== FAIL — ' + failN + ' (resume-replay) ===' : '=== PASS — 0 fail (resume-replay) ===');
process.exit(failN ? 1 : 0);
