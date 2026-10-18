'use strict';
// ============================================================
// team-block.js - O207 (client knife 5.1b, 2026-10-18): the team block on team-ladder rows
// ============================================================
// Every team-ladder row (casual / competitive / classic, 2-4 seats) carries the roster of the run that set it after its two ints:
// [teamScore, build, TEAM_MAGIC | ver << 8 | pc << 16, lo0, hi0, lo1, hi1, ...] (seat order, non-writers included). The client groups
// rows into one frame per team (src/util/lb-team-group.js; lockstep pinned in the companion repo, ledger-schema-lockstep section 33).
// [0] / [1] keep their meaning (a shipped client reads only those). Behind the knife 5.1b rollout gate: EA job now, playtest / demo
// jobs once V51B_PT flips (Next Fest keeps the trial's live behaviour).
//   [1] teamBlock: layout (magic / version / seat count), steamID lo / hi round trip, seat order kept, out-of-range rosters -> []
//   [2] ladderDetails: no roster -> the two ints; a roster -> two ints + block; [0] / [1] unchanged
//   [3] e2e over the REAL main(): a duo competitive segment settles; both writers' rows on endless_comp_duo carry the block naming
//       both seats in seat order
//   [4] e2e PT_MODE (gate closed): the same settle writes the two ints only
// ============================================================
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const V = require('../validate.js');
const attest = require('../attest.js');
let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const eq = (label, got, exp) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(exp), 'EXPECT ' + JSON.stringify(exp));
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidOf = (lo, hi) => ((BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0)).toString();
const decode = (d) => {   // the client's reading (lb-team-group.js decodeTeam), restated
  if (!Array.isArray(d) || d.length < 3) return null;
  const h = d[2] | 0;
  if ((h & 0xff) !== V.TEAM_MAGIC || ((h >>> 8) & 0xff) !== V.TEAM_VER) return null;
  const pc = (h >>> 16) & 0xff;
  if (pc < 2 || pc > 4 || d.length < 3 + 2 * pc) return null;
  const out = [];
  for (let i = 0; i < pc; i++) out.push(sidOf(d[3 + 2 * i], d[4 + 2 * i]));
  return out;
};

console.log('-- [1] teamBlock --');
{
  const ros = ['76561199842505137', SID(2), '76561197960265729'];
  const b = V.teamBlock(ros);
  eq('[1] magic / version / seat count in the head int', [b[0] & 0xff, (b[0] >>> 8) & 0xff, (b[0] >>> 16) & 0xff], [0xD4, 1, 3]);
  T('[1] constants', V.TEAM_MAGIC === 0xD4 && V.TEAM_VER === 1);
  eq('[1] 1 + 2 x seats ints, every one a signed int32', [b.length, b.every(x => x === (x | 0))], [7, true]);
  eq('[1] seat order and steamIDs round trip (high bit of lo set included)', decode([0, 0].concat(b)), ros);
  eq('[1] numbers are fine as input', decode([0, 0].concat(V.teamBlock([76561198000000002n.toString(), SID(3)]))), [SID(2), SID(3)]);
  eq('[1] one seat / five seats / nothing -> no block', [V.teamBlock([SID(1)]), V.teamBlock([1, 2, 3, 4, 5].map(SID)), V.teamBlock(null)], [[], [], []]);
}

console.log('-- [2] ladderDetails --');
{
  eq('[2] no roster -> [team score, build] (solo ladders, old pools)', V.ladderDetails({ s: 5, ts: 4321, build: 0x0102 }), [4321, 0x0102]);
  eq('[2] classic entry (no build) -> [bank, 0]', V.ladderDetails({ s: 5, ts: 2600000 }), [2600000, 0]);
  const d = V.ladderDetails({ s: 5, ts: 4321, build: 0x0102, team: [SID(1), SID(2)] });
  eq('[2] team entry -> [team score, build] + block (this process = EA job, gate open)', [d.slice(0, 2), d.length, decode(d)], [[4321, 0x0102], 7, [SID(1), SID(2)]]);
}

// ---- e2e harness (test/endless-rating.js shape) ----
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_PACE_FRAC', 'CP_LB', 'TRUST_LB', 'REPORT_LB',
  'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD',
  'ENDLESS_TIERCUT_LB', 'TIERCUT_CARRIER_SID'];
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
  "    if (/FindOrCreateLeaderboard/.test(u)) { const nm = /name=([^&]+)/.exec(String(init.body || '')); const have = nm ? FX.boards.find(b => b.name === decodeURIComponent(nm[1])) : null; const id = have ? have.id : nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }",
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
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-block-'));
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
      SEASON_NOW: '2026-10-01T12:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
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
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9;
function rec7(hash, seat, ros, sd, ed, flags) {
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, ros.length, 900];
  for (let i = 0; i < ros.length; i++) d.push([400, 300][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(sd | 0, ed | 0, 0, 0, 0, flags | 0);
  return d;
}
function start7(hash, seat, ros) {
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, ros.length, 0];
  for (let i = 0; i < ros.length; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const COMP_DUO = 16;
function world(rows, pt) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of rows) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] },
    { id: 8, name: 'cp_bank', entries: [SID(1), SID(2)].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 15, name: 'endless_board', entries: [] }, { id: 11, name: 'endless_board_trio', entries: [] }, { id: 12, name: 'endless_board_quad', entries: [] },
    { id: COMP_DUO, name: 'endless_comp_duo', entries: [] }, { id: 13, name: 'endless_comp_trio', entries: [] }, { id: 17, name: 'endless_comp_quad', entries: [] },
    { id: 40, name: 'version_gate', entries: [{ steamID: SID(777), score: 2026100101 }] });
  if (!pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const field = (w, name) => { const m = new RegExp('(?:^|&)' + name + '=([^&]*)').exec(w.body); return m ? decodeURIComponent(m[1]) : null; };
const detailsOf = (w) => { const m = /details=((?:%[0-9a-f]{2})+)/.exec(w.body); if (!m) return []; const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16)); const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)); return out; };
const writesTo = (r, id) => { const o = {}; for (const w of r.posts) if (/SetLeaderboardScore/.test(w.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(w.body)) o[field(w, 'steamid')] = detailsOf(w); return o; };
const ros = [SID(1), SID(2)];
const rows = ros.map((sid, i) => ({ sid, d: start7(0x4a01, i, ros) })).concat(ros.map((sid, i) => ({ sid, d: rec7(0x4a01, i, ros, 0, 5, attest.SEG_COMP) })));
function settle(pt) {
  const env = pt ? { PT_MODE: '1', DEMO_APPID: '2', APPID: '2', PT_SHARD_COUNT: '50' } : {};
  const r1 = runCron(world(rows, pt), null, env);
  const r2 = runCron(world(rows, pt), advance(r1.state, 10 * 60000), env);
  return { r1, r2 };
}

console.log('-- [3] e2e: duo competitive settle on the EA job writes the block --');
{
  const { r1, r2 } = settle(false);
  const w = writesTo(r2, COMP_DUO);
  T('[3] first sighting paced, then settled', r1.code === 0 && r2.code === 0 && /endless-comp settle/.test(r2.out), r2.out.split('\n').filter(l => /endless-comp|FAIL|Error/.test(l)).slice(-8).join(' | '));
  T('[3] both writers\' duo rows written', !!(w[SID(1)] && w[SID(2)]), JSON.stringify(w));
  if (w[SID(1)] && w[SID(2)]) {
    eq('[3] [0] = team score (400 + 300), [1] = build (0 here) unchanged', w[SID(1)].slice(0, 2), [700, 0]);
    eq('[3] the block names both seats in seat order, on both rows', [decode(w[SID(1)]), decode(w[SID(2)])], [ros, ros]);
  }
}

console.log('-- [4] e2e PT_MODE (gate closed): the same settle writes the two ints only --');
{
  const { r2 } = settle(true);
  const w = writesTo(r2, COMP_DUO);
  T('[4] settled in PT_MODE', r2.code === 0 && /endless-comp settle/.test(r2.out), r2.out.split('\n').slice(-12).join(' | '));
  eq('[4] rows carry [team score, build] only (the trial is unchanged through Next Fest)', [w[SID(1)], w[SID(2)]], [[700, 0], [700, 0]]);
}

if (failN) { console.log('FAIL (team-block) ' + failN); process.exit(1); } else console.log('ALL PASS (team-block)');
