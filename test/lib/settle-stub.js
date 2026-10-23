'use strict';
// test/lib/settle-stub.js -- the offline board stub of the end-to-end tests, shared by the O480 tests (test/receipt-ring.js,
// test/cron-pulse.js, test/pending-writes.js). Same harness as test/group-decay-points.js: the REAL validate.js main() runs in
// a child process against a fetch stub (boards from a fixture, every POST logged), state isolated structurally (every *_FILE
// var of validate.js redirected into a temp dir, cwd = that dir). Not a test file itself (run-tests takes test/*.js only).
// Extras over the copies in older tests: STUB_FAIL_POST = { boardName: httpStatus } fails every write to that board (the
// pending-writes tests), and a POST to a board created on the fly is answered with a fresh id the listing does not show.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const VALIDATE = path.join(ROOT, 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), (m) => m[1])));
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'RS_THRESHOLD', 'RS_UPSET_BONUS', 'RS_STRONG_UPSET_LOSS',
  'RS_SOLO_VS_TRIO', 'RS_TRIO_WIN', 'LEAVER_LP_PENALTY', 'CRON_PULSE_LB', 'TIERCUT_CARRIER_SID', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'LP_LAST_HOLD_MS'];
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}');",
  "const FAIL_POST = JSON.parse(process.env.STUB_FAIL_POST || '{}');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      const id = had ? had.id : nextId++;',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } });',
  '    }',
  '    const lid = (/leaderboardid=([0-9]+)/.exec(body) || [])[1];',
  '    const b = lid ? byId[lid] : null;',
  "    if (b && FAIL_POST[b.name]) return resp({ error: 'injected' }, FAIL_POST[b.name]);",
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  "    if (b && FAIL[b.name]) return resp({ error: 'injected' }, FAIL[b.name]);",
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
const hexLE = (arr) => arr.map((n) => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
// the details a POST carried (percent-encoded int32 LE bytes, see validate.js pctBytes), or null
function postDetails(body) {
  const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(String(body));
  if (!m) return null;
  const bytes = m[1].split('%').filter(Boolean).map((h) => parseInt(h, 16));
  const out = [];
  for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(Buffer.from(bytes.slice(i, i + 4)).readInt32LE(0));
  return out;
}

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { <FILE var>: content } carried state
function runCron(boards, files, env, script, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), (tag || 'settle-stub') + '-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map((b) => ({ id: b.id, name: b.name, entries: (b.entries || []).map((e) => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // preseason: points on the base board (a season start would move them to points_s<N>)
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (see test/group-decay-points.js advance)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (st[k] && st[k].pl) st[k].pl -= ms;   // Q316: when a lone friends'-room claim was first seen
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  if (sg && sg.stall) { sg.stall.from -= ms; sg.stall.at -= ms; }   // O348 (5) (knife 5.5b-1): the cron-stall marker
  const gr = files.GROUPS_FILE;
  if (gr) for (const k of Object.keys(gr)) if (gr[k] && gr[k].at) gr[k].at -= ms;
  const cf = files.CONFESSIONS_FILE;
  if (cf) for (const k of Object.keys(cf)) if (cf[k] && cf[k].t0) cf[k].t0 -= ms;
  const pw = files.PENDING_WRITES_FILE;   // O480 points-row backlog: queued receipts [mh, change, set, clear, t], a failed write's w.t,
  if (pw) for (const k of Object.keys(pw)) {   //   the last write's l.t (O481)
    if (pw[k] && Array.isArray(pw[k].rc)) for (const x of pw[k].rc) if (Array.isArray(x)) x[4] -= ms;
    if (pw[k] && pw[k].w && pw[k].w.t) pw[k].w.t -= ms;
    if (pw[k] && pw[k].l && pw[k].l.t) pw[k].l.t -= ms;
  }
  return files;
}
const setPosts = (r, boardId) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const postsOf = (r, boardId, sid) => setPosts(r, boardId).filter((p) => new RegExp('steamid=' + sid + '(&|$)').test(p.body))
  .map((p) => ({ score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: postDetails(p.body) }));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2) carries zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : (sc[i] | 0));
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// 50 record shards (one record per account per shard, in order) + the given boards
function shardBoards(recs, extra) {
  const b = [];
  for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; b[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  return b.concat(extra || []);
}

module.exports = { ROOT, VALIDATE, SRC, FILE_VARS, SCRUB, runCron, advance, setPosts, postsOf, postDetails, hexLE, SID, sidPair, rec, keyOf, shardBoards };
