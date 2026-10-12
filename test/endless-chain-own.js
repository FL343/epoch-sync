'use strict';
// Q111 (cloud audit 2026-10): the endless co-op pacing gate credits a resume (startDepth) only up to the best depth of
// roster seats that wrote their OWN record for the run (Q78's own set). A deep player the writers merely name lends
// nothing, so a claimed resume at his depth waits out the whole span like any other unproven run.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (same harness as
// test/endless-own-record.js): writes are logged, never applied.
//   [1] the frame: A and B (start pair + settle pair) claim a 3P resume 29 -> 30 naming V (trio best depth 30) at seat 2;
//       V wrote nothing for the run -- the settle waits the full 30 levels (deferred 10 min in, settled 3 h in)
//   [2] the honest resume: the deep player wrote his start (and settles too / quit before the settle) -- chain credit
//       stays, the run settles 10 min in
//   [3] wiring pin
//   [4] mutation self-check (the chain loop back on every named seat -> [1] settles 10 min in)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/absence-grace.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
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
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-chain-own-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      // pin the season clock: from a season start on the endless boards are season-derived; every test runs before each
      //   production reconcile, so a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
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
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  return files;
}

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 7;
// result-reporter wire forms (endless co-op, match type 7): settle = 10 header + pc scores + disp + 2pc roster + 11 tail;
//   start (0xB2) = 10 header + pc zero scores + disp + 2pc roster
function settle7(hash, seat, ros, cont, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, seat + 1, o.prog == null ? 0 : o.prog, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth | 0, cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0);
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

// recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard); trioBest: { sid: depth }
function world(recs, trioBest) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  const trio = Object.keys(trioBest || {}).map(s => ({ steamID: s, score: v.packEndlessScore(trioBest[s], 900) }));
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: trio }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
// three runs: first sighting, 10 minutes later, 3 hours later
function play(recs, trioBest, script) {
  const r1 = runCron(world(recs, trioBest), null, null, script);
  const r2 = runCron(world(recs, trioBest), advance(r1.state, 10 * 60000), null, script);
  const r3 = runCron(world(recs, trioBest), advance(r2.state, 3 * 3600000), null, script);
  const runs = [r1, r2, r3];
  return { runs, all: runs.map(r => r.out).join('\n'), codes: runs.map(r => r.code) };
}
// the run's settle lands as a trio-board write for its writers; returns the index (0..2) of the cron run that did it, -1 = never
const settledAt = (p, sid) => p.runs.findIndex(r => r.posts.some(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=12(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
const allZero = (p) => p.codes.every(c => c === 0);
const SPAN = (lv) => Math.round(lv * v.ENDLESS.LEVEL_SECONDS * v.ENDLESS.PACE_FRAC);

console.log('=== endless co-op resume credit only from seats with their own record (Q111) ===');

function frame(script, base) {
  const A = SID(base + 1), B = SID(base + 2), V = SID(base + 3);
  const ros = [A, B, V], h = 0x7900 + base;
  const o = { startDepth: 29, endDepth: 30 };
  const recs = [{ sid: A, d: start7(h, 0, ros) }, { sid: B, d: start7(h, 1, ros) },
    { sid: A, d: settle7(h, 0, ros, 0, o) }, { sid: B, d: settle7(h, 1, ros, 0, o) }];
  return { p: play(recs, { [V]: 30 }, script), A, B, V };
}

// ---- [1] the frame ----
{
  const { p, A, B } = frame(null, 10);
  T('[1] all runs exit 0', allZero(p), p.runs[2].out.slice(-800));
  T('[1] 10 minutes in: deferred on the full span (chain 0, needs ' + SPAN(30) + 's)', new RegExp('endless-pacing [^\\n]*depth 29->30 \\(chain 0\\) needs ' + SPAN(30) + 's').test(p.runs[1].out), (p.runs[1].out.match(/endless-pacing[^\n]*/g) || []).join(' | '));
  T('[1] settled only 3 h in (not 10 min in)', settledAt(p, A) === 2 && settledAt(p, B) === 2, JSON.stringify([settledAt(p, A), settledAt(p, B)]));
}

// ---- [2] the honest resume ----
for (const quit of [false, true]) {
  const tag = quit ? '[2b] deep player wrote his start, then quit' : '[2a] deep player wrote his start and settles';
  const base = quit ? 30 : 20;
  const D = SID(base + 1), A = SID(base + 2), B = SID(base + 3);
  const ros = [D, A, B], h = 0x7900 + base;
  const o = { startDepth: 29, endDepth: 30 };
  const recs = [{ sid: D, d: start7(h, 0, ros) }, { sid: A, d: start7(h, 1, ros) }, { sid: B, d: start7(h, 2, ros) },
    { sid: A, d: settle7(h, 1, ros, 0, o) }, { sid: B, d: settle7(h, 2, ros, 0, o) }];
  if (!quit) recs.push({ sid: D, d: settle7(h, 0, ros, 0, o) });
  const p = play(recs, { [D]: 30 });
  T(tag + ': all runs exit 0', allZero(p), p.runs[2].out.slice(-800));
  T(tag + ': chain credit kept, settled 10 min in', settledAt(p, A) === 1, JSON.stringify(settledAt(p, A)) + ' ' + (p.all.match(/endless-pacing[^\n]*/g) || []).join(' | '));
}

// ---- [3] wiring pin ----
{
  T('[3] the chain loop reads the own-record roster', /for \(const sid of ownRosterSids\) \{\s*if \(bBest\[sid\] != null\) chainMax/.test(SRC) && !/for \(const sid of rosterSids\) \{\s*if \(bBest\[sid\] != null\) chainMax/.test(SRC));
}

// ---- [4] mutation self-check ----
console.log('-- [4] mutation self-check --');
{
  const from = 'for (const sid of ownRosterSids) {\n        if (bBest[sid] != null) chainMax';
  if (SRC.split(from).length !== 2) bad('[4] anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-endless-chain-own-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, from.replace('ownRosterSids', 'rosterSids')));
      const { p, A } = frame(script, 40);
      T('[4] chain loop back on every named seat -> the frame settles 10 min in', settledAt(p, A) === 1, JSON.stringify(settledAt(p, A)));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
