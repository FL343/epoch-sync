'use strict';
// Q237 (cloud audit 2026-10): team competitive endless, a "save & quit" rolled back after its suspended records went up,
// and two or more ends could not take theirs back (or the ABORT never reached them). Those residual records agree, so they
// settle on their own: a save point at the save depth for their writers only, the chain head jumps there. The member whose
// take-back worked is not in that group, and the depths it covered were lost to him for good:
//   - the next checkpoint (segStart is unchanged by the rollback) overlaps the head: B-F2 credits only the depths past it;
//   - the save retried at the same depth, or the run's FINAL on the very next level, ends at the head: chain-back, rejected;
//   - in the run's first stride (segStart 0) the next segment is a second depth-0 segment ('restart', rejected), and every
//     later segment waits for a head nobody reaches (chain-gap): the rest of the run lost for EVERY member, not only him.
// The fix (validate.js, team competitive lane only; solo and team classic untouched): every member's XP floor on the run
// (run.xf / run.xf0 in the chain file); a settling segment credits each writer from max(segment start, his floor), never
// from further than the old rule; a segment at or behind the head still settles for a writer whose floor is below its end
// (catch-up: his progress XP, ladder and milestones only -- the chain is left as it is, nobody flagged); a depth-0 segment
// reaching past the head is the B-F2 overlap one stride earlier.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (the harness of
// test/absence-grace-endless.js): writes are logged, never applied -- every run reads XP 0, so a member's XP total is the sum
// of each run's last progress write; state carries between runs ten minutes apart.
//   [1] units: teamXpFloor / teamXpStarts / teamXpMark / teamRollbackPlan
//   [2] the next checkpoint overlaps the residual save point (A got 8->10 only)
//   [3] the save retried at the same depth (chain-back), then resumed from it
//   [4] the run's FINAL on the next level (chain-back): XP and the ladder depth
//   [5] the first stride: residual [0,3], then [0,5] and [5,10] -- everybody loses the rest of the run today
//   [6] controls: lost ABORT (all records residual) / pure replays / a run already in the chain file before the fix /
//       four seats, two take-backs failed / two seats / a lone residual record
//   [7] wiring pins
//   [8] mutation self-checks
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace-endless.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD'];
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

function runCron(boards, files, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-comp-ghost-'));
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
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock (pre-season: no season twin boards needed)
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  return files;
}

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9;
const keyOf = (h) => (h | 0) + '_' + SEED + '_7';
const { SEG_SUSPENDED, SEG_FINAL, SEG_RESUMED, SEG_COMP } = attest;
// result-reporter wire forms (endless, match type 7): settle = 10 header + pc scores + disp + 2pc roster + tail
//   (startDepth, endDepth, continues, tokens, season, flags); start (0xB2) = 10 header + pc zero scores + disp + 2pc roster
function rec7(hash, seat, ros, sd, ed, flags, disp) {
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, pc, 900];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
  return d;
}
function start7(hash, seat, ros) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// one segment key: every member's start (written when the segment began), the settle records of `writers` (default: all)
function seg(hash, ros, sd, ed, flags, writers, disp) {
  const w = writers || ros;
  return ros.map((sid, i) => ({ sid, d: start7(hash, i, ros) }))
    .concat(ros.map((sid, i) => ({ sid, d: rec7(hash, i, ros, sd, ed, SEG_COMP | (flags | 0), disp) })).filter((r) => w.indexOf(r.sid) >= 0));
}
const BOARD = { progress: 5, cp: 8, duo: 15, trio: 11, quad: 12, compDuo: 16, compTrio: 13, compQuad: 17 };
const CP0 = 1000;
// rows: [{ sid, d }] spread one row per (shard, account), like the real boards; 50 shards = the full live set
function world(rows, cpHolders) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of rows) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: BOARD.cp, name: 'cp_bank', entries: (cpHolders || []).map(s => ({ steamID: s, score: CP0 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.compQuad, name: 'endless_comp_quad', entries: [] });
  return boards;
}
// steps: what the shards hold at each run (each list carries everything still on the boards), ten minutes apart;
//   files seeds the first run's state; script runs a mutant
function timeline(steps, cpHolders, files, script) {
  const runs = [];
  let state = null;
  steps.forEach((rows) => {
    const r = runCron(world(rows, cpHolders), state ? advance(state, 10 * 60000) : files, script);
    runs.push(r); state = r.state;
  });
  return { runs, last: runs[runs.length - 1], all: runs.map(r => r.out).join('\n'), codes: runs.map(r => r.code) };
}
const allZero = (p) => p.codes.every(c => c === 0);
const writesIn = (r, boardId, sid) => r.posts.filter(x => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const scoreOf = (w) => { const m = /score=(-?[0-9]+)/.exec(w.body); return m ? Number(m[1]) : null; };
// the stub never applies a write: each run starts from 0 XP, so a member's total is the sum of every run's last XP write
const xpOf = (p, sid) => p.runs.reduce((a, r) => { const w = writesIn(r, BOARD.progress, sid); return a + (w.length ? scoreOf(w[w.length - 1]) : 0); }, 0);
// deepest ladder depth written for him on a board (packed depth * 10000 + tiebreak)
const ladderOf = (p, boardId, sid) => p.runs.reduce((a, r) => writesIn(r, boardId, sid).reduce((b, w) => Math.max(b, Math.floor(scoreOf(w) / 10000)), a), 0);
const cpGainOf = (p, sid) => p.runs.reduce((a, r) => { const w = writesIn(r, BOARD.cp, sid); return a + (w.length ? scoreOf(w[w.length - 1]) - CP0 : 0); }, 0);
const runOf = (p, ros) => ((p.last.state.SOLO_FILE || {}).runs || {})[v.teamRunKey(ros, 0, SEED)] || null;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const flagsOf = (p, sid) => ((((p.last.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const XP = (depths) => 9 * depths;   // ENDLESS_XP.perDepth, no boost at these levels
const has = (name) => typeof v[name] === 'function';
const lines = (p, re) => (p.all.match(re) || []).length;

// ---- [1] units ----
console.log('-- [1] units --');
{
  const [A, B, C] = [SID(1), SID(2), SID(3)], pA = v.pid(A), pB = v.pid(B);
  T('[1] helpers exported', has('teamXpFloor') && has('teamXpStarts') && has('teamXpMark') && has('teamRollbackPlan'));
  if (has('teamXpFloor') && has('teamXpStarts') && has('teamXpMark') && has('teamRollbackPlan')) {
    const r = (sid) => ({ steamID: sid, d: [] });
    T('[1] no run yet: floor 0', v.teamXpFloor(undefined, pA) === 0 && v.teamXpFloor(null, pA) === 0);
    T('[1] a run from before the fix (no map): the floor is its head (the old rule\'s own start, nothing credited twice)', v.teamXpFloor({ max: 8 }, pA) === 8);
    T('[1] a member in the map: his own floor; a member not in it: the run\'s default floor', v.teamXpFloor({ max: 8, xf0: 0, xf: { [pB]: 8 } }, pB) === 8 && v.teamXpFloor({ max: 8, xf0: 0, xf: { [pB]: 8 } }, pA) === 0);
    const run = { max: 8, xf0: 0, xf: { [pA]: 5, [pB]: 8 } };
    const st = v.teamXpStarts(run, [r(A), r(B), r(C), r(A)], { startDepth: 5, endDepth: 10 }, 8);
    T('[1] starts: each writer from max(segment start, his floor), never past the old start max(start, proven)', st[A] === 5 && st[B] === 8 && st[C] === 5 && Object.keys(st).length === 3, JSON.stringify(st));
    const st2 = v.teamXpStarts({ max: 10, xf0: 0, xf: { [pA]: 10 } }, [r(A)], { startDepth: 8, endDepth: 12 }, 8);
    T('[1] starts: a floor past the proven depth does not move the start past the old rule (resume from a save behind the head)', st2[A] === 8, JSON.stringify(st2));
    T('[1] starts: a new run (no entry) -> the segment start', v.teamXpStarts(undefined, [r(A)], { startDepth: 0, endDepth: 5 }, 0)[A] === 0);
    const m1 = { max: 10 };
    v.teamXpMark(m1, [r(A), r(B)], { startDepth: 5, endDepth: 10 }, 8);
    T('[1] mark: the first touch keeps the pre-settle head as the default floor; writers reach the segment end', m1.xf0 === 8 && m1.xf[pA] === 10 && m1.xf[pB] === 10 && v.teamXpFloor(m1, v.pid(C)) === 8, JSON.stringify(m1));
    const m2 = { max: 10, xf0: 0, xf: { [pA]: 10 } };
    v.teamXpMark(m2, [r(A)], { startDepth: 5, endDepth: 8 }, 10);
    T('[1] mark: a floor never moves down; an existing default floor is kept', m2.xf[pA] === 10 && m2.xf0 === 0);
    const head8 = { max: 8, xf0: 0, xf: { [pA]: 5, [pB]: 8, [v.pid(C)]: 8 } };
    const cb = { ok: false, reason: 'chain-back' };
    const pl = v.teamRollbackPlan(head8, [r(A), r(B), r(C)], { startDepth: 5, endDepth: 8 }, cb);
    T('[1] chain-back with a writer behind -> catch-up for him only (proven = head)', pl.ok === true && pl.proven === 8 && JSON.stringify(pl.catchUp) === JSON.stringify([A]), JSON.stringify(pl));
    T('[1] chain-back, nobody behind -> the reject stands', v.teamRollbackPlan(head8, [r(B), r(C)], { startDepth: 5, endDepth: 8 }, cb) === cb);
    T('[1] chain-back on a run from before the fix (no map) -> the reject stands', v.teamRollbackPlan({ max: 8 }, [r(A), r(B)], { startDepth: 5, endDepth: 8 }, cb) === cb);
    const head3 = { max: 3, seg0: 1, xf0: 0, xf: { [pB]: 3 } }, rs = { ok: false, reason: 'restart' };
    const z = v.teamRollbackPlan(head3, [r(A), r(B)], { startDepth: 0, endDepth: 5 }, rs);
    T('[1] a second depth-0 segment past the head -> the B-F2 overlap (proven = head, overlap 0)', z.ok === true && z.proven === 3 && z.overlap === 0 && !z.catchUp, JSON.stringify(z));
    const z2 = v.teamRollbackPlan(head3, [r(A), r(B)], { startDepth: 0, endDepth: 3 }, rs);
    T('[1] a second depth-0 segment at the head with a writer behind -> catch-up', z2.ok === true && z2.proven === 3 && JSON.stringify(z2.catchUp) === JSON.stringify([A]), JSON.stringify(z2));
    T('[1] a second depth-0 segment at the head, nobody behind -> restart stands', v.teamRollbackPlan(head3, [r(B)], { startDepth: 0, endDepth: 3 }, rs) === rs);
    for (const why of ['chain-gap', 'save-orphan', 'save-reused', 'after-final', 'run-burnt']) {
      const o = { ok: false, reason: why };
      T('[1] any other reject is left alone (' + why + ')', v.teamRollbackPlan(head8, [r(A)], { startDepth: 5, endDepth: 8 }, o) === o);
    }
    const okp = { ok: true, proven: 8, overlap: 5 }, wait = { ok: null, reason: 'chain-gap' };
    T('[1] a settling or waiting plan is left alone', v.teamRollbackPlan(head8, [r(A)], { startDepth: 5, endDepth: 10 }, okp) === okp && v.teamRollbackPlan(head8, [r(A)], { startDepth: 9, endDepth: 10 }, wait) === wait);
    T('[1] the solo chain planner itself is unchanged (a depth-0 replay stays a restart, the retry stays chain-back)',
      v.soloChainPlan({ runs: { k: { max: 3, seg0: 1, saves: {} } }, wait: {} }, 'k', { startDepth: 0, endDepth: 5, flags: SEG_COMP }, 'm', 1).reason === 'restart'
      && v.soloChainPlan({ runs: { k: { max: 8, saves: {} } }, wait: {} }, 'k', { startDepth: 5, endDepth: 8, flags: SEG_COMP | SEG_SUSPENDED }, 'm', 1).reason === 'chain-back');
  }
}

// trio: A (host, his take-back worked), B and C (could not take theirs back)
const TRIO = (n) => [SID(n), SID(n + 1), SID(n + 2)];

// ---- [2] the next checkpoint overlaps the residual save point ----
console.log('-- [2] the next checkpoint overlaps the residual save point --');
function caseOverlap(script) {
  const ros = TRIO(10), [A, B, C] = ros;
  const S0 = seg(0x2370, ros, 0, 5), G = seg(0x2371, ros, 5, 8, SEG_SUSPENDED, [B, C]), S2 = seg(0x2372, ros, 5, 10);
  const p = timeline([S0, S0, S0.concat(G), S0.concat(G), S0.concat(G, S2), S0.concat(G, S2)], [A], null, script);
  return { p, ros, A, B, C, m: [keyOf(0x2370), keyOf(0x2371), keyOf(0x2372)] };
}
const c2 = caseOverlap();
{
  const { p, ros, A, B, C, m } = c2;
  T('[2] every run exits 0, all three keys processed', allZero(p) && m.every((k) => processedOf(p.last).has(k)), p.codes.join(','));
  T('[2] the residual group settled first, for B and C only (the save point at 8)', /endless-comp settle [^\n]*0x2371|endless-comp settle [0-9]+_9_7: pc 3 depth 5->8/.test(p.all) && (runOf(p, ros) || {}).saves && runOf(p, ros).saves['8'] != null, (p.all.match(/endless-comp[^\n]*/g) || []).join(' | '));
  T('[2] the next checkpoint [5,10] overlapped the head 8', /depth 5->10 [^\n]*proven 8 \(overlap from 5\)/.test(p.all));
  T('[2] A (his take-back worked) gets XP for every depth he played: 0->10 = ' + XP(10), xpOf(p, A) === XP(10), 'A=' + xpOf(p, A));
  T('[2] B and C: 0->10 once, nothing twice', xpOf(p, B) === XP(10) && xpOf(p, C) === XP(10), 'B=' + xpOf(p, B) + ' C=' + xpOf(p, C));
  T('[2] ladder depth 10 for all three', [A, B, C].every((s) => ladderOf(p, BOARD.compTrio, s) === 10), [A, B, C].map((s) => ladderOf(p, BOARD.compTrio, s)).join(','));
  T('[2] chain head 10; nobody flagged', (runOf(p, ros) || {}).max === 10 && [A, B, C].every((s) => flagsOf(p, s) === 0));
}

// ---- [3] the save retried at the same depth, then resumed ----
console.log('-- [3] the save retried at the same depth, then resumed --');
function caseRetry(script) {
  const ros = TRIO(20), [A, B, C] = ros;
  const S0 = seg(0x2380, ros, 0, 5), G = seg(0x2381, ros, 5, 8, SEG_SUSPENDED, [B, C]), R = seg(0x2382, ros, 5, 8, SEG_SUSPENDED), Z = seg(0x2383, ros, 8, 10, SEG_RESUMED);
  const p = timeline([S0, S0, S0.concat(G), S0.concat(G), S0.concat(G, R), S0.concat(G, R), S0.concat(G, R, Z), S0.concat(G, R, Z)], [A], null, script);
  return { p, ros, A, B, C, m: [keyOf(0x2380), keyOf(0x2381), keyOf(0x2382), keyOf(0x2383)] };
}
const c3 = caseRetry();
{
  const { p, ros, A, B, C, m } = c3;
  T('[3] every run exits 0, all four keys processed', allZero(p) && m.every((k) => processedOf(p.last).has(k)), p.codes.join(','));
  T('[3] the retried save [5,8] is caught up for A (no chain-back reject)', /endless-comp catch-up [^\n]*depth 5->8/.test(p.all) && !/team comp segment chain REJECT \(chain-back\)/.test(p.all), (p.all.match(/(endless-comp (settle|catch-up)|chain REJECT)[^\n]*/g) || []).join(' | '));
  T('[3] A gets 0->10 = ' + XP(10) + '; B and C 0->10 once', xpOf(p, A) === XP(10) && xpOf(p, B) === XP(10) && xpOf(p, C) === XP(10), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[3] the resume consumed the save point once, the host paid the fee once (-20; the depth-10 milestone +40 lands in the same settle)', lines(p, /endless-comp cp [^\n]*resume \(save@8\)/g) === 1 && cpGainOf(p, A) === 40 - 20, 'cp ' + cpGainOf(p, A));
  T('[3] chain head 10, the save point consumed by the resume', (runOf(p, ros) || {}).max === 10 && (((runOf(p, ros) || {}).saves || {})['8'] || {}).by === m[3]);
  T('[3] ladder depth 10 for all three; nobody flagged', [A, B, C].every((s) => ladderOf(p, BOARD.compTrio, s) === 10 && flagsOf(p, s) === 0));
}

// ---- [4] the run's FINAL on the next level ----
console.log('-- [4] the run\'s FINAL on the next level --');
function caseFinal(script) {
  const ros = TRIO(30), [A, B, C] = ros;
  const S0 = seg(0x2390, ros, 0, 5), G = seg(0x2391, ros, 5, 8, SEG_SUSPENDED, [B, C]), F = seg(0x2392, ros, 5, 8, SEG_FINAL);
  const p = timeline([S0, S0, S0.concat(G), S0.concat(G), S0.concat(G, F), S0.concat(G, F)], [A], null, script);
  return { p, ros, A, B, C, m: [keyOf(0x2390), keyOf(0x2391), keyOf(0x2392)] };
}
const c4 = caseFinal();
{
  const { p, ros, A, B, C, m } = c4;
  T('[4] every run exits 0, all three keys processed', allZero(p) && m.every((k) => processedOf(p.last).has(k)), p.codes.join(','));
  T('[4] A gets 0->8 = ' + XP(8) + ' (today 0->5); B and C 0->8 once', xpOf(p, A) === XP(8) && xpOf(p, B) === XP(8) && xpOf(p, C) === XP(8), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[4] A\'s ladder reaches depth 8 like his teammates\' (today 5)', [A, B, C].every((s) => ladderOf(p, BOARD.compTrio, s) === 8), [A, B, C].map((s) => ladderOf(p, BOARD.compTrio, s)).join(','));
  T('[4] the catch-up leaves the chain as it is (head 8, the save point unconsumed, no FINAL mark -- as today)', (runOf(p, ros) || {}).max === 8 && !((runOf(p, ros) || {}).final) && (((runOf(p, ros) || {}).saves || {})['8'] || {}).by == null);
  T('[4] nobody flagged, no CP moved', [A, B, C].every((s) => flagsOf(p, s) === 0 && cpGainOf(p, s) === 0));
}

// ---- [5] the first stride ----
console.log('-- [5] the first stride: residual [0,3], then [0,5] and [5,10] --');
function caseFirstStride(script) {
  const ros = TRIO(40), [A, B, C] = ros;
  const G = seg(0x23A1, ros, 0, 3, SEG_SUSPENDED, [B, C]), S1 = seg(0x23A2, ros, 0, 5), S2 = seg(0x23A3, ros, 5, 10);
  const p = timeline([G, G, G.concat(S1), G.concat(S1), G.concat(S1, S2), G.concat(S1, S2)], [A, B, C], null, script);
  return { p, ros, A, B, C, m: [keyOf(0x23A1), keyOf(0x23A2), keyOf(0x23A3)] };
}
const c5 = caseFirstStride();
{
  const { p, ros, A, B, C, m } = c5;
  T('[5] every run exits 0, all three keys processed (today [5,10] waits for a head of 5 that never comes)', allZero(p) && m.every((k) => processedOf(p.last).has(k)), p.codes.join(',') + ' ' + m.map((k) => processedOf(p.last).has(k) ? 1 : 0).join(''));
  T('[5] [0,5] settles as an overlap of the residual head 3 (no restart reject)', /depth 0->5 [^\n]*proven 3 \(overlap from 0\)/.test(p.all) && !/chain REJECT \(restart\)/.test(p.all), (p.all.match(/(endless-comp (settle|catch-up)|chain REJECT)[^\n]*/g) || []).join(' | '));
  T('[5] all three get 0->10 = ' + XP(10) + ', nothing twice', [A, B, C].every((s) => xpOf(p, s) === XP(10)), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[5] ladder depth 10 and the depth-10 milestone (+40 CP) for all three', [A, B, C].every((s) => ladderOf(p, BOARD.compTrio, s) === 10 && cpGainOf(p, s) === 40), [A, B, C].map((s) => ladderOf(p, BOARD.compTrio, s) + '/' + cpGainOf(p, s)).join(','));
  T('[5] chain head 10; nobody flagged', (runOf(p, ros) || {}).max === 10 && [A, B, C].every((s) => flagsOf(p, s) === 0));
}

// ---- [6] controls ----
console.log('-- [6] controls --');
{
  // lost ABORT: nobody took his record back -- the residual group is all three; everybody already had the depths
  const ros = TRIO(50), [A, B, C] = ros;
  const S0 = seg(0x23B0, ros, 0, 5), G = seg(0x23B1, ros, 5, 8, SEG_SUSPENDED), S2 = seg(0x23B2, ros, 5, 10), R = seg(0x23B3, ros, 5, 8, SEG_SUSPENDED);
  const p = timeline([S0, S0, S0.concat(G), S0.concat(G), S0.concat(G, S2, R), S0.concat(G, S2, R)], [A]);
  T('[6] lost ABORT: all three get 0->10 once (the overlap credits 8->10, the late retry [5,8] is no catch-up)', allZero(p) && [A, B, C].every((s) => xpOf(p, s) === XP(10)), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[6] lost ABORT: the retried save behind the head is still rejected (chain-back), no catch-up line', /team comp segment chain REJECT \(chain-back\) depth 5->8/.test(p.all) && !/endless-comp catch-up/.test(p.all));
}
{
  // pure replays of settled segments: nothing twice, still rejected
  const ros = TRIO(60), [A, B, C] = ros;
  const S0 = seg(0x23C0, ros, 0, 5), S1 = seg(0x23C1, ros, 5, 10), X0 = seg(0x23C2, ros, 0, 5), X1 = seg(0x23C3, ros, 5, 10), X2 = seg(0x23C4, ros, 7, 9);
  const p = timeline([S0, S0, S0.concat(S1), S0.concat(S1), S0.concat(S1, X0, X1, X2), S0.concat(S1, X0, X1, X2)], [A]);
  T('[6] replays: each member 0->10 once', allZero(p) && [A, B, C].every((s) => xpOf(p, s) === XP(10)), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[6] replays: the depth-0 replay is a restart, the others chain-back -- all rejected, no catch-up',
    /chain REJECT \(restart\) depth 0->5/.test(p.all) && lines(p, /chain REJECT \(chain-back\)/g) === 2 && !/endless-comp catch-up/.test(p.all) && (runOf(p, ros) || {}).max === 10);
}
{
  // a run already in the chain file before the fix (its residual save point settled under the old rule; no XP floors stored):
  //   the old rule holds for it -- the continuation credits from the head for everybody, nobody is credited twice
  const ros = TRIO(70), [A, B, C] = ros;
  const key = v.teamRunKey(ros, 0, SEED);
  const runs = {}; runs[key] = { max: 8, ms: 0, saves: { 8: { t: Date.now() - 3600000 } }, t: Date.now() - 3600000, seg0: 1 };
  const proc = [keyOf(0x23D0), keyOf(0x23D1)];
  const S2 = seg(0x23D2, ros, 5, 10), R = seg(0x23D3, ros, 5, 8, SEG_SUSPENDED);
  const p = timeline([S2, S2.concat(R), S2.concat(R)], [A], { SOLO_FILE: { runs, wait: {}, ms: {}, held: {} }, PROCESSED_FILE: proc });
  T('[6] old run: the continuation credits 8->10 to each (as before the fix)', allZero(p) && [A, B, C].every((s) => xpOf(p, s) === XP(2)), [A, B, C].map((s) => xpOf(p, s)).join(','));
  T('[6] old run: the late retry [5,8] stays a chain-back reject (no floors known: the head is everybody\'s floor)', /chain REJECT \(chain-back\) depth 5->8/.test(p.all) && !/endless-comp catch-up/.test(p.all));
  const run = runOf(p, ros) || {};
  T('[6] old run: the first touch stores the pre-settle head as the default floor', run.xf0 === 8 && run.xf && run.xf[v.pid(A)] === 10, JSON.stringify({ xf0: run.xf0, xf: run.xf }));
}
// a run from before the fix whose first touch under it misses C's record (absent past the grace): C keeps the old head as his
//   floor, so a later segment behind the head pays him nothing (he may have been credited up to that head under the old rule)
function caseLegacyAbsent(script) {
  const ros = TRIO(75), [A, B, C] = ros;
  const key = v.teamRunKey(ros, 0, SEED);
  const runs = {}; runs[key] = { max: 8, ms: 0, saves: {}, t: Date.now() - 3600000, seg0: 1 };
  const S2 = seg(0x23D6, ros, 5, 10, 0, [A, B]), R = seg(0x23D7, ros, 5, 8, SEG_SUSPENDED);
  const p = timeline([S2, S2, S2.concat(R), S2.concat(R)], [A], { SOLO_FILE: { runs, wait: {}, ms: {}, held: {} }, PROCESSED_FILE: [keyOf(0x23D4), keyOf(0x23D5)] }, script);
  return { p, ros, A, B, C };
}
{
  const { p, ros, A, B, C } = caseLegacyAbsent();
  T('[6] old run, C absent on the first touch: A and B 8->10, C nothing; the later [5,8] is no catch-up for C', allZero(p) && xpOf(p, A) === XP(2) && xpOf(p, B) === XP(2) && xpOf(p, C) === 0
    && /chain REJECT \(chain-back\) depth 5->8/.test(p.all) && !/endless-comp catch-up/.test(p.all), [A, B, C].map((s) => xpOf(p, s)).join(',') + ' ' + (p.all.match(/(endless-comp (settle|catch-up)|chain REJECT|absent-hold)[^\n]*/g) || []).join(' | '));
  T('[6] old run, C absent: his floor is the old head 8 (the run\'s default floor)', has('teamXpFloor') && v.teamXpFloor(runOf(p, ros), v.pid(C)) === 8 && (runOf(p, ros) || {}).xf0 === 8);
}
{
  // four seats, two take-backs failed (C, D): A and B both lost the depths today
  const ros = [SID(80), SID(81), SID(82), SID(83)], [A, B, C, D] = ros;
  const S0 = seg(0x23E0, ros, 0, 5), G = seg(0x23E1, ros, 5, 8, SEG_SUSPENDED, [C, D]), S2 = seg(0x23E2, ros, 5, 10);
  const p = timeline([S0, S0, S0.concat(G), S0.concat(G), S0.concat(G, S2), S0.concat(G, S2)], [A]);
  T('[6] quad: every member 0->10 once', allZero(p) && ros.every((s) => xpOf(p, s) === XP(10)), ros.map((s) => xpOf(p, s)).join(','));
  T('[6] quad: ladder depth 10 for all four', ros.every((s) => ladderOf(p, BOARD.compQuad, s) === 10), ros.map((s) => ladderOf(p, BOARD.compQuad, s)).join(','));
}
{
  // two seats: a residual group needs both records (a lost ABORT) -- nothing changes there; one residual record never settles
  const ros = [SID(90), SID(91)], [A, B] = ros;
  const S0 = seg(0x23F0, ros, 0, 5), G1 = seg(0x23F1, ros, 5, 8, SEG_SUSPENDED, [B]), S2 = seg(0x23F2, ros, 5, 10);
  const p = timeline([S0, S0, S0.concat(G1), S0.concat(G1), S0.concat(G1, S2), S0.concat(G1, S2)], [A]);
  T('[6] duo, a lone residual record: never settles, the run goes on, both 0->10', allZero(p) && !processedOf(p.last).has(keyOf(0x23F1)) && xpOf(p, A) === XP(10) && xpOf(p, B) === XP(10), [A, B].map((s) => xpOf(p, s)).join(','));
}
{
  // the overlap never lets a writer with a floor of his own credit a depth twice (B and C reached 8 on the residual group)
  const { p, B, C } = c2;
  const xpLines = (sid) => (p.all.match(new RegExp('xp-endless ' + v.pid(sid).slice(0, 8).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*', 'g')) || []);
  T('[6] [2] again: B\'s and C\'s XP lines read 0->5, 5->8, 8->10', [B, C].every((s) => xpLines(s).map((l) => (/depth ([0-9]+->[0-9]+)/.exec(l) || [])[1]).join(',') === '0->5,5->8,8->10'),
    [B, C].map((s) => xpLines(s).join(' / ')).join(' || '));
}

// ---- [7] wiring pins ----
console.log('-- [7] wiring pins --');
{
  const iLane = SRC.indexOf('if ((t.flags | 0) & attest.SEG_COMP) {');
  const lane = SRC.slice(iLane, SRC.indexOf('processed.add(c.m); settledEndlessComp++;', iLane));
  const iPlan = lane.indexOf('const plan0 = soloChainPlan(soloState, key, f, c.m, nowMs);');
  const iRb = lane.indexOf('const plan = teamRollbackPlan(runT0, g, f, plan0);');
  const iRej = lane.indexOf('if (plan.ok === false) {');
  T('[7] the lane reads the run before planning and reworks only a reject (teamRollbackPlan right after the planner)', lane.indexOf('const runT0 = soloState.runs[key], headT0 = runT0 ? (runT0.max | 0) : 0;') >= 0
    && iPlan > 0 && iPlan < iRb && iRb < iRej, [iPlan, iRb, iRej].join(','));
  { // Q314: a perk reject flags nobody at all now (the build / pick log is a copy of the host's frames on every record); a catch-up still is not counted
    const pb = lane.match(/if \(!pvT\.ok\) \{[^\n]*\n[\s\S]*?\n {10}continue;\n {8}\}/);
    T('[7] a catch-up flags nobody when its perk chain does not line up (today\'s chain-back flags nobody either; since Q314 no perk reject in the lane flags anyone)', !!pb && /if \(!catchUp\) RUN\.perkRej = \(RUN\.perkRej \| 0\) \+ 1;/.test(pb[0]) && /processed\.add\(c\.m\);/.test(pb[0]) && !/recordFlag|flagPlayer/.test(pb[0]));
  }
  const iFrom = lane.indexOf('const xpFrom = teamXpStarts(runT0, g, f, plan.proven);'), iAdv = lane.indexOf('soloAdvance(soloState, key, f, c.m, plan, nowMs);');
  T('[7] XP starts are read before the head moves; a catch-up never advances the chain', iFrom > 0 && iFrom < iAdv && /if \(!catchUp\) \{[^\n]*\n[\s\S]*?soloAdvance\(soloState, key, f, c\.m, plan, nowMs\);\n {8}\}/.test(lane));
  T('[7] ladder / milestones of a catch-up go to the writers behind only', /for \(const sid of writerSids\) \{\n {10}if \(catchUp && !catchUp\.has\(sid\)\) continue;/.test(lane));
  T('[7] XP from each writer\'s own start; floors marked after every settle', /creditXpEndless\(catchUp \? g\.filter\(\(r\) => catchUp\.has\(String\(r\.steamID\)\)\) : g, \{ startDepth: f\.startDepth \| 0, endDepth: f\.endDepth \| 0, startOf: \(sid\) => xpFrom\[String\(sid\)\] \}, xp, changedXp, spSet\)/.test(lane)
    && lane.indexOf('teamXpMark(soloState.runs[key], g, f, headT0);') > lane.indexOf('creditXpEndless('));
  T('[7] creditXpEndless takes a per-writer start from the tail (one signature for every lane)', /const sd = \(typeof tail\.startOf === 'function' && tail\.startOf\(sid\) != null\) \? \(tail\.startOf\(sid\) \| 0\) : \(tail\.startDepth \| 0\);/.test(SRC)
    && /computeXpEndless\(sd, tail\.endDepth, bm\)/.test(SRC));
  T('[7] the team classic and solo lanes are untouched (old XP start rule, no rollback plan)', /creditXpEndless\(g, \{ startDepth: Math\.max\(f\.startDepth \| 0, plan\.proven \| 0\), endDepth: f\.endDepth \| 0 \}, xp, changedXp, spSet, CLASSIC\.XP_MUL\)/.test(SRC)
    && (SRC.match(/teamRollbackPlan\(/g) || []).length === 2 && (SRC.match(/teamXpMark\(/g) || []).length === 2);
}

// ---- [8] mutation self-checks ----
console.log('-- [8] mutation self-checks --');
{
  const mutants = [
    ['XP back to the head-based start (B-F2 only)', 'startOf: (sid) => xpFrom[String(sid)] }', 'startOf: () => Math.max(f.startDepth | 0, plan.proven | 0) }', (s) => xpOf(caseOverlap(s).p, SID(10)) !== XP(10)],
    ['no catch-up (a chain-back stays a reject)', "if ((plan.reason === 'chain-back' || plan.reason === 'restart') && behind.length)", 'if (false)', (s) => xpOf(caseRetry(s).p, SID(20)) !== XP(10)],
    ['no depth-0 overlap', "if (plan.reason === 'restart' && sd === 0 && ed > head)", 'if (false)', (s) => xpOf(caseFirstStride(s).p, SID(41)) !== XP(10)],
    ['floors never marked', 'teamXpMark(soloState.runs[key], g, f, headT0);', '', (s) => xpOf(caseOverlap(s).p, SID(10)) !== XP(10)],
    ['catch-up credits every writer from the segment start (floors ignored)', 'filter((r) => catchUp.has(String(r.steamID))) : g, { startDepth: f.startDepth | 0, endDepth: f.endDepth | 0, startOf: (sid) => xpFrom[String(sid)] }',
      'filter(() => true) : g, { startDepth: f.startDepth | 0, endDepth: f.endDepth | 0 }', (s) => xpOf(caseFinal(s).p, SID(31)) !== XP(8)],
    ['a run from before the fix gets floor 0 for everybody', 'if (run.xf0 == null) run.xf0 = prevMax | 0;', 'if (run.xf0 == null) run.xf0 = 0;',
      (s) => { const { p, C } = caseLegacyAbsent(s); return xpOf(p, C) !== 0 || /endless-comp catch-up/.test(p.all); }],
    ['catch-up ladder for every writer', 'if (catchUp && !catchUp.has(sid)) continue;', '', (s) => { const p = caseFinal(s).p; return writesIn(p.runs[5], BOARD.compTrio, SID(31)).length + writesIn(p.runs[4], BOARD.compTrio, SID(31)).length > 0; }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[8] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-team-comp-ghost-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[8] ' + label + ' -> red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (team-comp-ghost-xp)') : 'ALL OK (team-comp-ghost-xp)');
process.exit(failN ? 1 : 0);
