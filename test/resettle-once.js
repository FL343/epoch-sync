'use strict';
// cloud audit Q413 + O920 / O922 (2026-11-20): tools/resettle-once.js reopens endless keys this job rejected under rules fixed
//   since (a state edit made with the job paused), and validate.js settles a reopened key without continue debits while
//   resettle.json lists it (RESETTLE_FILE, loadResettleFree).
//   [1] the lists: 8 + 24 + 35 endless keys, none twice, the co-op depths; the flag lists (35 + 2); q413 holds the 13 the state
//       showed at 11-19T12:31Z, the 7 the run logs added to 11-19T19:40Z (mailbox M825 / M832), the 15 the state shows from then
//       until O903 reached main (11-20T12:13Z), and not the perk_forge one nor the one refused after O903
//   [2] loadResettleFree: a listed key with cp 'free' before `until` -> in the set; until passed / another version /
//       malformed / not an endless key / no file -> none
//   [3] main(): a casual co-op run with continues -- charged as before without the file; listed -> settled, no CP write,
//       logged, the summary row counts it; until passed -> charged; another key listed -> charged
//   [4] main(): a casual couch run -- the listed segment's 2 continue rungs not charged, the next segment pays rung 3 only
//       (the rung count still moves on); without the file 20 + 30 then rung 3
//   [5] static: every casual continue debit site checks the list first (class-level), and the co-op seat loop
//   [6] plan / apply / undo / status / finish on a synthetic state history: the closing commit, the start entry (at the
//       close / just before / dated at the close), the run's later rejected segments, another owner under the same seed
//       left alone, a run whose chain moved held for review, not processed / history too short, reopen once, --again after
//       an undo, an apply that is repeated changes nothing
//   [7] flags: the Q407 form over many keys (fm cell out, fl events fp 'review', fp + 1 per key, mw 1; f / fx / flagged
//       kept; a second pass changes nothing)
//   [8] the offline Steam of the dry run (tools/resettle-steam.js): reads, pages, writes (ForceUpdate / KeepBest / details),
//       delete, create, the clock, nothing goes out
//   [9] workflowEnv on the real validate.yml (literal values, no secrets); codeReady
//   [10] dry run end to end on a synthetic vault snapshot: the reopened co-op key settles in B without a CP debit, A leaves
//       it closed, no value goes down; the same dry run on a tree without the hook reports the CP going down
//   [11] mutants: each check above goes red when the code it pins is taken out
//   [12] a reopened run's later segments that are still open (cloud audit Q413 review 1: waiting at the chain, or the result read):
//       planned with the run (kind 'unblocked'), listed for the exemption only (nothing of them edited), undo releases / takes
//       them, a run goes whole or not at all, a waiting key with no start entry holds its run; a reopened key's leftover
//       chain-gap clock goes (undo puts it back); the dry-run report gate; flags new in B; mutants
//   [13] end to end, the review's probe shape: old rule live (segment 2 rejected, segment 3 waiting at the chain) -> dry run
//       (0 closed in B only, nothing down) -> apply -> new rule live: settled once each, CP as before, XP / chain as the new
//       rule from the start; the mutant without the still-open step brings the review's finding back
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/couch-casual-settle.js (harness
//   copied from it); every temp file is under os.tmpdir().
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), zlib = require('zlib');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH', 'RESETTLE_FILE', 'APPID', 'LB_PREFIX', 'STATE_SALT', 'SUPPORTER_DLC_APPID', 'CLASSIC_APPID'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const TOOL = path.join(ROOT, 'tools', 'resettle-once.js'), STEAM = path.join(ROOT, 'tools', 'resettle-steam.js');
const R = require(TOOL);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'resettle-once-'));
const git = (dir, args) => { const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'].concat(args), { encoding: 'utf8' }); if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr); return r.stdout; };

console.log('=== Q413 / O920 / O922 one-shot re-settlement ===');

// ---- [1] the lists ----
{
  const n = (s) => Object.keys(R.SETS[s].keys).length;
  eq('[1] o920 8 / o922 24 / q413 35 keys', [n('o920'), n('o922'), n('q413')], [8, 24, 35]);
  const all = [].concat(...Object.keys(R.SETS).map((s) => Object.keys(R.SETS[s].keys)));
  T('[1] every key an endless key (type 7), none twice', all.every((m) => R.KEY_RE.test(m)) && new Set(all).size === all.length);
  T('[1] co-op keys carry their logged depths (o920 all from 0)', Object.values(R.SETS.o920.keys).every((d) => d[0] === 0 && d[1] > 0)
    && Object.values(R.SETS.o922.keys).every((d) => Array.isArray(d) && d[0] > 0 && d[1] >= d[0]));
  eq('[1] flag lists: q413 = its 35 keys, q407 = the two rooms of six', [R.FLAG_SETS.q413.length, R.FLAG_SETS.q407], [35, ['1436293812_1720557369_10', '333666603_1234671714_10']]);
  // the run logs since launch (mailbox M832 ④): 21 solo keys flagged and closed in one run to 11-19T19:40Z, 20 of them
  //   `perk REJECT (perk_chain: prefix)` (Q410's class) -- 13 in the first list + these 7; the 21st was `perk_forge:
  //   picks-count@4`, a replay check Q410 does not touch (reopened, the fixed rule refuses it again): not in this list
  const LOG7 = ['-482154105_1978245727_7', '1955281756_1889606694_7', '-744718111_1092615113_7', '687288248_1875434390_7',
    '1931428710_880539769_7', '-376699473_1538758885_7', '316762177_2127984313_7'];
  T('[1] q413 holds the 7 keys the run logs added (M825 / M832), each in the flag list too', LOG7.every((m) => m in R.SETS.q413.keys && R.FLAG_SETS.q413.includes(m)), LOG7.filter((m) => !(m in R.SETS.q413.keys)).join(' '));
  T('[1] q413 does not hold the perk_forge key (picks-count, not Q410\'s class)', !('2042096731_536923187_7' in R.SETS.q413.keys));
  // the state after the logs were read (11-19T19:40Z) until O903 reached main (11-20T12:13Z): every solo key flagged and closed in one
  //   run (signals fm second = endless-solo done second, trust source fl) -- 12 new runs + 3 later segments of 1955281756_..._7's run.
  //   -1327600002_880919402_7 (flagged 11-20T12:44Z) was judged by the fixed code: not this list's class -- out
  const STATE15 = ['-1763639302_1263948641_7', '-1945114912_731808503_7', '119571435_1872693108_7', '1672300127_885479509_7',
    '306848399_134454718_7', '728021899_1982546866_7', '-1888688969_1321976693_7', '-843680383_464287609_7', '-1448083451_1727966839_7',
    '965906560_1420489742_7', '928483442_1889606694_7', '1003282118_1889606694_7', '413513400_1889606694_7', '-88966206_1729740589_7',
    '-1486860584_1056385758_7'];
  T('[1] q413 holds the 15 keys the state shows until O903 reached main, each in the flag list too', STATE15.every((m) => m in R.SETS.q413.keys && R.FLAG_SETS.q413.includes(m)), STATE15.filter((m) => !(m in R.SETS.q413.keys)).join(' '));
  T('[1] q413 does not hold the key refused after O903 reached main', !('-1327600002_880919402_7' in R.SETS.q413.keys));
}

// ---- [2] loadResettleFree ----
{
  const f = path.join(TMP, 'rs2.json'), now = Date.parse('2026-11-20T00:00:00Z');
  const put = (o) => fs.writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o));
  const K = '1_2_7', K2 = '3_4_7';
  put({ v: 1, until: '2026-11-27T00:00:00Z', keys: { [K]: { cp: 'free' }, [K2]: { cp: 'free', how: 'reopened' }, '5_6_10': { cp: 'free' }, '7_8_7': { how: 'reclosed' } } });
  eq('[2] listed + free + until ahead -> the endless keys marked free', [...v.loadResettleFree(f, now)].sort(), [K, K2].sort());
  T('[2] until passed -> none', v.loadResettleFree(f, Date.parse('2026-11-27T00:00:01Z')).size === 0);
  put({ v: 2, until: '2026-11-27T00:00:00Z', keys: { [K]: { cp: 'free' } } });
  T('[2] another version -> none', v.loadResettleFree(f, now).size === 0);
  put({ v: 1, until: 'soon', keys: { [K]: { cp: 'free' } } });
  T('[2] an unreadable until -> none', v.loadResettleFree(f, now).size === 0);
  put('{ not json');
  T('[2] malformed file -> none', v.loadResettleFree(f, now).size === 0);
  T('[2] no file -> none', v.loadResettleFree(path.join(TMP, 'none.json'), now).size === 0);
  T('[2] RESETTLE_FILE defaults to resettle.json beside validate.js (config, as RECOVER_FILE; not a *_FILE state default)', path.basename(v.RESETTLE_FILE) === 'resettle.json' && path.resolve(path.dirname(v.RESETTLE_FILE)) === path.resolve(ROOT) && fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8').indexOf("process.env.RESETTLE_FILE || '") < 0, v.RESETTLE_FILE);
}

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('6d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099112001;
function copyTree(tag, mutate) {
  const dir = fs.mkdtempSync(path.join(TMP, 'tree-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  if (mutate) { const vf = path.join(dir, 'validate.js'), s = fs.readFileSync(vf, 'utf8'), t = mutate(s); if (t === s) throw new Error('mutant ' + tag + ' changed nothing'); fs.writeFileSync(vf, t); }
  return dir;
}
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
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
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(tree, boards, files, env) {
  const dir = fs.mkdtempSync(path.join(TMP, 'run-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k] && files[k] != null) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1',
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
    for (const k of Object.keys(so.done || {})) if (Array.isArray(so.done[k])) so.done[k][1] -= Math.floor(ms / 1000);
  }
  return files;
}
const LB = { xp: 5, cp: 8, couchCas: 20 };
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function world(recs, cp0) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: cp0 == null ? 1000 : cp0 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 25, name: 'endless_board_solo', entries: [] }, { id: 26, name: 'endless_board_overall', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 18, name: 'endless_comp_couch', entries: [] }, { id: 19, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: 21, name: 'endless_save_box_casual_couch', entries: [] });
  return boards;
}
function timeline(tree, steps, files0, env) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const files = state ? advance(state, ms) : (files0 || null);
    const r = runCron(tree, world(recs), files, env);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
const cpOf = (r, sid) => { const w = writesTo(r, LB.cp, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const linesOf = (r, m) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n').slice(0, 1500);
const HOUR = 3600 * 1000;
const FREE_ROW = /\| reopened keys \(RESETTLE_FILE\): continue debits not charged \/ their CP \(Q413 \/ O920 \/ O922\) \| ([0-9]+) \/ ([0-9]+) \|/;
const rsFile = (keys, until) => ({ v: 1, until: until || '2099-01-01T00:00:00Z', keys: Object.fromEntries(keys.map((m) => [m, { cp: 'free', how: 'reopened' }])) });

// the casual co-op wire form (test/endless-cont-rungs.js): settle = 10 header + pc scores + disp + 2pc roster + 12 tail + char block
const SEED7 = 7;
function settle7(hash, seat, ros, cont, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED7, seat, seat + 1, 0, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth == null ? 5 : (o.endDepth | 0), cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0, 0);
  d.push((0xD8 | (1 << 8) | (pc << 16)) | 0); for (let i = 0; i < pc; i += 4) d.push(0x01010101);
  return d;
}
function start7(hash, seat, ros) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, SEED7, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const nib = (counts) => counts.reduce((a, n, s) => a | ((n & 0xF) << (4 * s)), 0);
const c = (k) => v.endlessContinueCost(k);
// a 2-seat casual co-op run (H seat 0: 1 continue, V seat 1: 1 continue): three runs (first sighting, +10 min, +3 h)
function coop(tree, base, files) {
  const H = SID(8100 + base), V = SID(8200 + base), h = 0x6100 + base, key = h + '_' + SEED7 + '_7', ros = [H, V];
  const recs = [{ sid: H, d: start7(h, 0, ros) }, { sid: V, d: start7(h, 1, ros) }, { sid: H, d: settle7(h, 0, ros, nib([1, 1])) }, { sid: V, d: settle7(h, 1, ros, nib([1, 1])) }];
  const rs = timeline(tree, [[0, recs], [10 * 60000, recs], [3 * HOUR, recs]], files);
  const cpH = rs.map((r) => cpOf(r, H)).filter((x) => x != null), cpV = rs.map((r) => cpOf(r, V)).filter((x) => x != null);
  return { rs, key, H, V, cpH: cpH.length ? cpH[cpH.length - 1] : null, cpV: cpV.length ? cpV[cpV.length - 1] : null, out: rs.map((r) => r.out).join('\n'), summary: rs.map((r) => r.summary).join('\n'), settled: rs.some((r) => procHas(r, key) && /endless settle /.test(r.out)) };
}
const TREE = copyTree('fix');

// ---- [3] co-op ----
function coopChecks(tree, tag) {
  const res = {};
  const plain = coop(tree, 1, null);
  res.plain = plain.settled && plain.cpH === 1000 - c(1) && plain.cpV === 1000 - c(2);
  const free = coop(tree, 2, { RESETTLE_FILE: rsFile([0x6102 + '_' + SEED7 + '_7']) });
  // the summary of each run: the settle run's row carries the counts (the first sighting's row reads 0 / 0)
  const rows = [...free.summary.matchAll(new RegExp(FREE_ROW.source, 'g'))].filter((x) => x[1] !== '0');
  const row = rows.length === 1 ? rows[0] : null;
  res.free = free.settled && free.cpH == null && free.cpV == null && /resettle cp [-0-9_]+: [0-9a-f]{8} seat 0 1 continues \(20\) not charged/.test(free.out);
  res.row = !!row && Number(row[1]) === 2 && Number(row[2]) === c(1) + c(2);
  const late = coop(tree, 3, { RESETTLE_FILE: rsFile([0x6103 + '_' + SEED7 + '_7'], '2026-01-01T00:00:00Z') });
  res.late = late.settled && late.cpH === 1000 - c(1) && late.cpV === 1000 - c(2);
  const other = coop(tree, 4, { RESETTLE_FILE: rsFile(['999_7_7']) });
  res.other = other.settled && other.cpH === 1000 - c(1) && other.cpV === 1000 - c(2);
  res.detail = { plain: [plain.settled, plain.cpH, plain.cpV], free: [free.settled, free.cpH, free.cpV, row && row[0]], late: [late.cpH, late.cpV], other: [other.cpH, other.cpV], tail: plain.rs[plain.rs.length - 1].out.slice(-600), tag };
  return res;
}
const C3 = coopChecks(TREE, 'fix');
T('[3] not listed: settled, H pays rung 1 (' + c(1) + '), V rung 2 (' + c(2) + ')', C3.plain, JSON.stringify(C3.detail));
T('[3] listed (cp free): settled, no CP write for either seat, logged', C3.free, JSON.stringify(C3.detail.free));
T('[3] summary row: 2 debits not charged / their CP', C3.row, JSON.stringify(C3.detail.free));
T('[3] until passed: charged as before', C3.late, JSON.stringify(C3.detail.late));
T('[3] another key listed: this one charged as before', C3.other, JSON.stringify(C3.detail.other));

// ---- [4] couch casual: the listed segment's rungs not charged, the rung count moves on ----
const CAS0 = A.SEG_CASUAL | A.SEG_COUCH;
function couchRec(sid, id, runSeed, o) {
  o = o || {};
  const n = o.n || 2;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (const s of Array(n).fill(sid)) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed == null ? 5 : o.ed, o.conts | 0, 0, 0, o.flags == null ? CAS0 : o.flags, 0, 0, 0, 0, 0, 0);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), KEY_ID, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const startC = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };
function couch(tree, base, listSeg1) {
  const S = SID(8300 + base), RS = 830000 + base;
  const s0 = couchRec(S, 'rs-c0-' + base, RS, { sd: 0, ed: 5 });
  const s1 = couchRec(S, 'rs-c1-' + base, RS, { sd: 5, ed: 10, conts: 2 });
  const s2 = couchRec(S, 'rs-c2-' + base, RS, { sd: 10, ed: 12, conts: 3, flags: CAS0 | A.SEG_FINAL, disp: 5 });
  const st = (d, sh) => ({ sid: S, d: startC(d[3], S, RS), shard: sh });
  const r0 = [st(s0, 0), { sid: S, d: s0, shard: 1 }], r1 = r0.concat([st(s1, 3), { sid: S, d: s1, shard: 4 }]), r2 = r1.concat([st(s2, 6), { sid: S, d: s2, shard: 7 }]);
  const files = listSeg1 ? { RESETTLE_FILE: rsFile([keyOf(s1)]) } : null;
  const rs = timeline(tree, [[0, [st(s0, 0)]], [2 * HOUR, r0], [2 * HOUR, r0.concat([st(s1, 3)])], [2 * HOUR, r1], [2 * HOUR, r1.concat([st(s2, 6)])], [2 * HOUR, r2]], files);
  const cps = rs.map((r) => cpOf(r, S));
  return { rs, S, m1: keyOf(s1), m2: keyOf(s2), cps, ok: rs.length === 6 && rs.every((r) => r.code === 0), out: rs.map((r) => r.out).join('\n') };
}
{
  const plain = couch(TREE, 1, false);
  T('[4] not listed: segment 2 pays rungs 1 + 2 (' + (c(1) + c(2)) + '), segment 3 rung 3 (' + c(3) + ')', plain.ok && plain.cps[3] === 1000 - c(1) - c(2) && plain.cps[5] === 1000 - c(3),
    JSON.stringify(plain.cps) + '\n' + (plain.rs[plain.rs.length - 1] || {}).out);
  const free = couch(TREE, 2, true);
  T('[4] segment 2 listed: settled, its 2 rungs not charged (logged)', free.ok && free.cps[3] == null && procHas(free.rs[3], free.m1) && /resettle cp [-0-9_]+: [0-9a-f]{8} couch casual continues \(rung 1\.\.2\) \(50\) not charged/.test(free.out),
    JSON.stringify(free.cps) + '\n' + linesOf(free.rs[3] || { out: '' }, free.m1));
  T('[4] ... and segment 3 pays rung 3 only (' + c(3) + '): the rung count moved on', free.ok && free.cps[5] === 1000 - c(3), JSON.stringify(free.cps));
}

// ---- [5] static ----
const casualDebitSites = (src) => {
  const L = src.split('\n'), out = [];
  for (let i = 0; i < L.length; i++) if (/cp\[sid\] = \(cp\[sid\] == null \? 0 : cp\[sid\]\) - debit;[^\n]*casual continues/.test(L[i])) out.push({ i, guarded: /^\s*else if \(debit > 0\) \{/.test(L[i]) && /^\s*if \(debit > 0 && resettleFree\.has\(m\)\) resettleNoCharge\(/.test(L[i - 1] || '') });
  return out;
};
function staticOk(src) {
  const sites = casualDebitSites(src);
  const loop = /const debit = debits\[seat\];\n\s*if \(resettleFree\.has\(c\.m\)\) \{ resettleNoCharge\(c\.m, sid, debit,[^\n]*continue; \}/.test(src);
  const load = /const resettleFree = loadResettleFree\(RESETTLE_FILE, nowMs\);/.test(src) && src.indexOf('const resettleFree = loadResettleFree') < src.indexOf('const resettleNoCharge');
  return { sites: sites.length, guarded: sites.every((s) => s.guarded), loop, load };
}
{
  const s = staticOk(SRC);
  T('[5] every casual continue debit site (solo, couch) checks the list first (class-level: ' + s.sites + ' sites)', s.sites >= 2 && s.guarded, JSON.stringify(s));
  T('[5] the casual co-op seat loop skips a listed key\'s debit before any charge', s.loop);
  T('[5] the list is read once per run, before the settle loop', s.load);
  T('[5] resettle.json is a config file (tools/code-hash.js CONFIG_JSON), never written by a workflow', require(path.join(ROOT, 'tools', 'code-hash.js')).CONFIG_JSON.indexOf('resettle.json') >= 0
    && !require(path.join(ROOT, 'tools', 'code-hash.js')).stateFiles(ROOT).has('resettle.json'));
}

// ---- [6] plan / apply / undo on a synthetic state history ----
const PA = 'aaaaaaaaaaaaaaaa', PB = 'bbbbbbbbbbbbbbbb', PC = 'cccccccccccccccc';
const K1 = '111_501_7', K9 = '119_509_7', S0 = '100_601_7', S1 = '101_601_7', S2 = '102_601_7', SB = '103_601_7', U1 = '201_602_7', U2 = '202_602_7';
const RKA = PA + '|0|601', RKB = PB + '|0|601', RKC = 'T|' + PC + '+' + PC + '|0|602';
const LISTS = { c: { lane: 'coop', keys: { [K1]: [0, 5], [K9]: [0, 5] } }, s: { lane: 'solo', keys: { [S1]: null, [U1]: null } } };
const T0 = Date.parse('2026-11-18T10:00:00Z');
function histRepo(tag) {
  const dir = path.join(TMP, 'hist-' + tag);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  const st = { processed: [], starts: {}, solo: { runs: {}, done: {}, wait: {} } };
  let n = 0;
  const commit = (fn) => {   // (commit n is dated T0 + n * 10 min: c[k] is commit k + 1)
    fn(st);
    fs.writeFileSync(path.join(dir, 'processed.json'), JSON.stringify(st.processed));
    fs.writeFileSync(path.join(dir, 'starts.json'), JSON.stringify(st.starts));
    fs.writeFileSync(path.join(dir, 'endless-solo.json'), JSON.stringify(st.solo));
    git(dir, ['add', '-A']);
    const when = new Date(T0 + (++n) * 600000).toISOString();
    spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'state ' + n], { env: Object.assign({}, process.env, { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }) });
    return git(dir, ['rev-parse', 'HEAD']).trim();
  };
  const c = {};
  c[0] = commit(() => {});
  c[1] = commit((s) => { s.starts[K1] = { t0: T0 + 1000, mt: 7, roster: { 0: PA, 1: PB }, settled: [] }; s.starts[S1] = { t0: T0 + 2000, mt: 7, roster: {}, settled: [] }; s.solo.runs[RKC] = { max: 5, t: T0 }; });
  c[2] = commit((s) => { s.processed.push(K1); });   // K1 closed (its start entry still there)
  c[3] = commit((s) => { s.processed.push(S0); s.solo.done[S0] = ['k1', 1, PA]; s.solo.runs[RKA] = { max: 5, t: T0 + 3000 }; delete s.starts[K1]; });   // S0 settled
  c[4] = commit((s) => { s.processed.push(S1); s.solo.done[S1] = ['k1', 2, PA]; delete s.starts[S1]; });   // S1 rejected (start went in the same run)
  c[5] = commit((s) => { s.processed.push(S2, SB); s.solo.done[S2] = ['k1', 3, PA]; s.solo.done[SB] = ['k1', 3, PB]; s.solo.runs[RKB] = { max: 5, t: T0 }; });   // S2 rejected; another owner's segment settled
  c[6] = commit((s) => { s.processed.push(U1); s.solo.done[U1] = ['k1', 4, PC]; });   // U1 rejected
  c[7] = commit((s) => { s.processed.push(U2); s.solo.done[U2] = ['k1', 5, PC]; s.solo.runs[RKC] = { max: 10, t: T0 + 9000 }; });   // U2 settled: chain moved
  return { dir, c };
}
function planChecks(TT, tag) {
  const H = histRepo(tag), G = TT.makeGit(H.dir);
  const plan = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS });
  const by = Object.fromEntries(plan.keys.map((k) => [k.m, k]));
  const res = {};
  res.k1 = by[K1] && by[K1].status === 'ok' && by[K1].closed === H.c[2] && by[K1].start.src === 'close' && by[K1].start.e.t0 === T0 + 1000;
  res.k9 = by[K9] && by[K9].status === 'not-processed';
  res.s1 = by[S1] && by[S1].status === 'ok' && by[S1].closed === H.c[4] && by[S1].start.src === 'before' && by[S1].owner === PA && by[S1].run === RKA && JSON.stringify(by[S1].done) === JSON.stringify({ [S1]: ['k1', 2, PA] });
  res.s2 = by[S2] && by[S2].status === 'ok' && !by[S2].listed && by[S2].closed === H.c[5] && by[S2].start.src === 'synth' && by[S2].start.e.t0 === T0 + 6 * 600000 && by[S2].start.e.synth === true;
  res.sb = !by[SB] && !by[S0];
  res.u1 = by[U1] && by[U1].status === 'review' && /chain moved at/.test(by[U1].why) && !by[U2];
  res.counts = JSON.stringify(plan.counts) === JSON.stringify({ ok: 3, refused: 0, review: 1, 'not-processed': 1 });
  // apply in the working tree
  const rsPath = path.join(H.dir, 'resettle.json');
  const ap = TT.applyToDir(H.dir, plan, { now: T0 + 10 * 3600000 });
  const proc = JSON.parse(fs.readFileSync(path.join(H.dir, 'processed.json'), 'utf8'));
  const solo = JSON.parse(fs.readFileSync(path.join(H.dir, 'endless-solo.json'), 'utf8'));
  const starts = JSON.parse(fs.readFileSync(path.join(H.dir, 'starts.json'), 'utf8'));
  const rs = JSON.parse(fs.readFileSync(rsPath, 'utf8'));
  res.apply = JSON.stringify(ap.reopened.sort()) === JSON.stringify([K1, S1, S2].sort()) && [K1, S1, S2].every((m) => proc.indexOf(m) < 0) && [S0, SB, U1, U2].every((m) => proc.indexOf(m) >= 0)
    && !(S1 in solo.done) && !(S2 in solo.done) && (S0 in solo.done) && (SB in solo.done) && (U1 in solo.done)
    && starts[K1].t0 === T0 + 1000 && starts[S1].t0 === T0 + 2000 && starts[S2].synth === true
    && rs.v === 1 && rs.until === '2026-11-25T20:00:00Z' && [K1, S1, S2].every((m) => rs.keys[m] && rs.keys[m].cp === 'free' && rs.keys[m].how === 'reopened')
    && JSON.stringify(rs.keys[S1].done) === JSON.stringify({ [S1]: ['k1', 2, PA] });
  res.free = JSON.stringify([...v.loadResettleFree(rsPath, T0 + 10 * 3600000)].sort()) === JSON.stringify([K1, S1, S2].sort());
  const before = ['processed.json', 'endless-solo.json', 'starts.json', 'resettle.json'].map((f) => fs.readFileSync(path.join(H.dir, f), 'utf8')).join('|');
  const plan2 = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS, dir: H.dir });
  const ap2 = TT.applyToDir(H.dir, plan2, { now: T0 + 11 * 3600000 });
  const after = ['processed.json', 'endless-solo.json', 'starts.json', 'resettle.json'].map((f) => fs.readFileSync(path.join(H.dir, f), 'utf8')).join('|');
  // (the listed keys refused, so their run is not walked: the later segment S2 is not offered again either)
  const refusedAll = (pl) => [K1, S1].every((m) => { const k = pl.keys.find((x) => x.m === m); return k && k.status === 'refused'; }) && !pl.keys.some((k) => k.status === 'ok');
  res.again = ap2.reopened.length === 0 && before === after && refusedAll(plan2);
  git(H.dir, ['add', '-A']); git(H.dir, ['commit', '-q', '-m', 'reopen']);
  const plan3 = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS });
  res.history = refusedAll(plan3);
  // undo: K1 taken by the reconcile meanwhile, S1 / S2 still open
  const p4 = JSON.parse(fs.readFileSync(path.join(H.dir, 'processed.json'), 'utf8')); p4.push(K1); fs.writeFileSync(path.join(H.dir, 'processed.json'), JSON.stringify(p4));
  const un = TT.undoInDir(H.dir, { now: T0 + 12 * 3600000 });
  const proc5 = JSON.parse(fs.readFileSync(path.join(H.dir, 'processed.json'), 'utf8')), solo5 = JSON.parse(fs.readFileSync(path.join(H.dir, 'endless-solo.json'), 'utf8')), rs5 = JSON.parse(fs.readFileSync(rsPath, 'utf8'));
  res.undo = JSON.stringify(un.taken) === JSON.stringify([K1]) && JSON.stringify(un.reclosed.sort()) === JSON.stringify([S1, S2].sort()) && [S1, S2].every((m) => proc5.indexOf(m) >= 0)
    && JSON.stringify(solo5.done[S1]) === JSON.stringify(['k1', 2, PA]) && JSON.stringify(solo5.done[S2]) === JSON.stringify(['k1', 3, PA])
    && rs5.keys[K1].how === 'taken' && rs5.keys[S1].how === 'reclosed' && !rs5.keys[S1].cp && v.loadResettleFree(rsPath, T0 + 12 * 3600000 + 1).size === 0;
  const st = TT.statusOf(H.dir, T0 + 12 * 3600000 + 1);
  res.status = st && st.allClosed && st.expired;
  git(H.dir, ['add', '-A']); git(H.dir, ['commit', '-q', '-m', 'undo']);
  const plan6 = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS, again: true });
  const st6 = Object.fromEntries(plan6.keys.map((k) => [k.m, k.status]));
  res.againFlag = st6[S1] === 'ok' && st6[S2] === 'ok' && st6[K1] === 'refused';
  // a key closed before the oldest commit in reach
  const H2 = path.join(TMP, 'hist-short-' + tag); fs.mkdirSync(H2);
  git(H2, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(H2, 'processed.json'), JSON.stringify([K1])); fs.writeFileSync(path.join(H2, 'starts.json'), '{}'); fs.writeFileSync(path.join(H2, 'endless-solo.json'), '{"runs":{},"done":{}}');
  git(H2, ['add', '-A']); git(H2, ['commit', '-q', '-m', 'one']);
  const plan7 = TT.planKeys(TT.makeGit(H2), 'HEAD', ['c'], { lists: LISTS });
  res.short = plan7.keys.find((k) => k.m === K1).status === 'review';
  res.detail = { counts: plan.counts, keys: plan.keys.map((k) => [k.m, k.status, k.why || '', k.start && k.start.src]), ap, un };
  return res;
}
const P6 = planChecks(R, 'fix');
T('[6] co-op key: closed at its commit, start entry from the close', P6.k1, JSON.stringify(P6.detail.keys));
T('[6] a listed key never processed: not-processed', P6.k9);
T('[6] solo key: its owner\'s run, start entry from just before the close (the run that rejected it dropped it)', P6.s1, JSON.stringify(P6.detail.keys));
T('[6] the run\'s later rejected segment is found; no start entry anywhere -> one dated at its close', P6.s2, JSON.stringify(P6.detail.keys));
T('[6] another owner under the same seed, and the run\'s settled segment, are left alone', P6.sb);
T('[6] a run whose chain moved after its rejected segment: held for review, nothing of it reopened', P6.u1, JSON.stringify(P6.detail.keys));
T('[6] plan counts: 3 ok, 1 review, 1 not processed', P6.counts, JSON.stringify(P6.detail.counts));
T('[6] apply: the 3 keys leave processed, their done entries go, start entries back, resettle.json lists them (cp free, until +7 d)', P6.apply, JSON.stringify(P6.detail.ap));
T('[6] validate.js reads the written list', P6.free);
T('[6] apply again on the same tree: refused, nothing changes (idempotent)', P6.again);
T('[6] once committed, a new plan refuses the keys (reopen once: the history of resettle.json)', P6.history);
T('[6] undo: a key the reconcile took is marked taken; the open ones close again with their done entries; the exemption ends', P6.undo, JSON.stringify(P6.detail.un));
T('[6] status after undo: all closed, expired', P6.status);
T('[6] --again reopens only the keys undo re-closed', P6.againFlag);
T('[6] a key closed before the oldest commit in reach: review', P6.short);

// apply only what the dry run saw settle; a run whole or not at all
function holdChecks(TT, tag) {
  const H = histRepo('hold-' + tag), G = TT.makeGit(H.dir), res = {};
  const st = (pl) => Object.fromEntries(pl.keys.map((k) => [k.m, k.status]));
  const p1 = TT.holdKeys(TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS }), new Map([[S1, 'skipped by hand (--skip)']]));
  const s1 = st(p1);
  res.skipRun = s1[S1] === 'refused' && s1[S2] === 'refused' && s1[K1] === 'ok' && p1.counts.ok === 1 && p1.runs.find((r) => r.rk === RKA).status === 'held';
  const p2 = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS });
  const rep = { keys: [{ m: K1, result: 'settled (tick 1)' }, { m: S1, result: 'settled (tick 2)' }, { m: S2, result: 'records gone from the shards -- cannot be settled' }] };
  const sk = TT.dryVerdicts(rep, p2);
  TT.holdKeys(p2, sk);
  const s2 = st(p2);
  res.dry = sk.size === 1 && sk.has(S2) && s2[K1] === 'ok' && s2[S1] === 'refused' && s2[S2] === 'refused' && /its run holds 102_601_7/.test(p2.keys.find((k) => k.m === S1).why);
  const p3 = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS });
  const sk3 = TT.dryVerdicts({ keys: [{ m: K1, result: 'refused again: endless perk REJECT (x)' }] }, p3);
  res.missing = sk3.size === 3 && /not in the dry run/.test(sk3.get(S1)) && /refused again/.test(sk3.get(K1));
  return res;
}
const H6 = holdChecks(R, 'fix');
T('[6] --skip a solo key: its whole run stays closed (no hole), the co-op key still reopens', H6.skipRun);
T('[6] apply --from-dry: a key the dry run did not see settle is held, with its run', H6.dry);
T('[6] ... a key missing from the dry run, or refused again in it, is held too', H6.missing);
{
  const out = spawnSync(process.execPath, [TOOL, 'apply', '--set', 'o920', '--yes'], { cwd: ROOT, encoding: 'utf8' });
  T('[6] apply without --from-dry is refused before anything is read (exit 2)', out.status === 2 && /apply needs --from-dry/.test(out.stderr), (out.stdout || '') + (out.stderr || ''));
}

// ---- [7] flags ----
function flagChecks(TT) {
  const dir = fs.mkdtempSync(path.join(TMP, 'flags-'));
  const K = '5_6_7', Z = '9_9_7', N = '8_8_7';
  fs.writeFileSync(path.join(dir, 'signals.json'), JSON.stringify({ players: { [PA]: { f: 2, fx: 2, fm: { [K]: 1, [Z]: 2 } }, [PB]: { f: 1, fm: { [K]: 1 } } }, flagged: { [K]: 5 } }));
  fs.writeFileSync(path.join(dir, 'trust.json'), JSON.stringify({ acct: { [PA]: { fp: 0, ev: [{ s: 'fl', m: K, t: 1 }, { s: 'fl', m: Z, t: 2 }] }, [PB]: { fp: 2, ev: [{ s: 'fl', m: K, fp: 'review' }] }, [PC]: { ev: [{ s: 'fl', m: K, t: 3 }] } } }));
  const r = TT.flagsInDir(dir, [K, N]);
  r.write();
  const sg = JSON.parse(fs.readFileSync(path.join(dir, 'signals.json'), 'utf8')), tr = JSON.parse(fs.readFileSync(path.join(dir, 'trust.json'), 'utf8'));
  const res = {};
  res.cells = !(K in sg.players[PA].fm) && (Z in sg.players[PA].fm) && !(K in sg.players[PB].fm) && sg.players[PA].f === 2 && sg.players[PA].fx === 2 && sg.flagged[K] === 5;
  res.events = tr.acct[PA].ev[0].fp === 'review' && !tr.acct[PA].ev[1].fp && tr.acct[PA].fp === 1 && tr.acct[PA].mw === 1 && tr.acct[PB].fp === 2 && !tr.acct[PB].mw
    && tr.acct[PC].ev[0].fp === 'review' && tr.acct[PC].fp === 1;
  res.none = r.rows.some((x) => x.m === N && x.p === null);
  const r2 = TT.flagsInDir(dir, [K]);
  res.twice = r2.rows.length === 1 && r2.rows[0].p === null;
  return res;
}
const F7 = flagChecks(R);
T('[7] fm cells of the key go (other keys stay), f / fx / flagged kept', F7.cells);
T('[7] the key\'s fl events marked fp review, fp + 1 and mw 1 once per account; an already marked event untouched; an account with events only', F7.events);
T('[7] a key with no flag on file is reported, nothing written for it', F7.none);
T('[7] a second pass finds nothing (idempotent)', F7.twice);

// ---- [8] the offline Steam ----
{
  const dir = fs.mkdtempSync(path.join(TMP, 'steam-'));
  const fx = path.join(dir, 'fx.json'), lg = path.join(dir, 'log.jsonl');
  fs.writeFileSync(fx, JSON.stringify({ nextId: 500, boards: [{ id: 7, name: 'b', trusted: true, entries: { 11: { score: 5, h: '05000000' }, 12: { score: 9, h: '' }, 13: { score: 1, h: '' } } }] }));
  fs.writeFileSync(lg, '');
  const script = path.join(dir, 's.js');
  fs.writeFileSync(script, [
    "const B = 'https://partner.steam-api.com/ISteamLeaderboards/';",
    'const get = async (u) => (await fetch(B + u)).text().then(JSON.parse);',
    "const post = async (u, body) => (await fetch(B + u, { method: 'POST', body })).text().then(JSON.parse);",
    '(async () => {',
    '  const out = {};',
    "  out.list = (await get('GetLeaderboardsForGame/v2/?appid=1')).response.leaderboards.map((b) => [b.id, b.name, b.entries]);",
    "  out.p1 = (await get('GetLeaderboardEntries/v1/?rangestart=1&rangeend=2&datarequest=RequestGlobal&leaderboardid=7')).leaderboardEntryInformation.leaderboardEntries.map((e) => [e.rank, e.steamID, e.score, e.detailData]);",
    "  out.p2 = (await get('GetLeaderboardEntries/v1/?rangestart=3&rangeend=4&datarequest=RequestGlobal&leaderboardid=7')).leaderboardEntryInformation.leaderboardEntries.map((e) => e.steamID);",
    "  out.me = (await get('GetLeaderboardEntries/v1/?rangestart=0&rangeend=0&datarequest=RequestAroundUser&steamid=13&leaderboardid=7')).leaderboardEntryInformation.leaderboardEntries.map((e) => e.steamID);",
    "  out.keep = (await post('SetLeaderboardScore/v1/', 'leaderboardid=7&steamid=12&score=3&scoremethod=KeepBest')).result.score_changed;",
    "  out.force = (await post('SetLeaderboardScore/v1/', 'leaderboardid=7&steamid=12&score=3&scoremethod=ForceUpdate&details=%01%00%00%00')).result.score_changed;",
    "  out.del = (await post('DeleteLeaderboardScore/v1/', 'leaderboardid=7&steamid=13')).result.result;",
    "  out.create = (await post('FindOrCreateLeaderboard/v2/', 'name=nb&onlytrustedwrites=1')).result.leaderboard.leaderBoardID;",
    "  out.own = (await fetch('https://partner.steam-api.com/ISteamUser/CheckAppOwnership/v4/?steamid=1')).status;",
    "  out.other = (await fetch('https://example.invalid/x')).status;",
    "  try { require('https').request('https://example.invalid'); out.https = 'went out'; } catch (e) { out.https = 'refused'; }",
    '  out.now = Date.now(); out.newDate = new Date().getTime();',
    '  console.log(JSON.stringify(out));',
    '})();',
  ].join('\n'));
  const r = spawnSync(process.execPath, ['-r', STEAM, script], { encoding: 'utf8', env: Object.assign({}, process.env, { RESETTLE_FX: fx, RESETTLE_LOG: lg, RESETTLE_NOW_MS: String(Date.parse('2026-11-20T00:00:00Z')) }) });
  let o = {}; try { o = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) {}
  const st = JSON.parse(fs.readFileSync(fx, 'utf8')), logs = fs.readFileSync(lg, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  eq('[8] listing', o.list, [[7, 'b', 3]]);
  eq('[8] global pages in score order (rank, details hex)', [o.p1, o.p2], [[[1, '12', 9, ''], [2, '11', 5, '05000000']], ['13']]);
  eq('[8] around one account', o.me, ['13']);
  T('[8] KeepBest with a lower score: unchanged; ForceUpdate: written with its details (hex)', o.keep === false && o.force === true && st.boards[0].entries['12'].score === 3 && st.boards[0].entries['12'].h === '01000000');
  T('[8] delete / create (a new board in the file, id from nextId)', o.del === 1 && !st.boards[0].entries['13'] && o.create === 500 && st.boards.some((b) => b.name === 'nb' && b.trusted));
  T('[8] ownership probe 503, any other address refused, https refused', o.own === 503 && o.other === 599 && o.https === 'refused', JSON.stringify(o));
  T('[8] the clock reads RESETTLE_NOW_MS (Date.now and new Date())', Math.abs(o.now - Date.parse('2026-11-20T00:00:00Z')) < 60000 && Math.abs(o.newDate - o.now) < 1000);
  T('[8] every write logged with what it replaced', logs.some((l) => l.op === 'set' && l.sid === '12' && l.was === 9) && logs.some((l) => l.op === 'keep') && logs.some((l) => l.op === 'del' && l.was === 1) && logs.some((l) => l.op === 'create') && logs.some((l) => l.op === 'blocked'));
}

// ---- [9] workflowEnv / codeReady ----
{
  const env = R.workflowEnv(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8'));
  T('[9] the reconcile step\'s literal env (seedcap enforce, couch merge, trust file)', env.SEEDCAP_ENFORCE === '1' && env.COUCH_DUO === 'merge' && env.TRUST_FILE === 'trust.json' && env.STRICT_BOARDS === '1', JSON.stringify(env));
  T('[9] no secret in it', !('STEAM_PUBLISHER_KEY' in env) && !('STATE_SALT' in env) && !('APPID' in env) && Object.values(env).every((x) => !/\$\{\{/.test(x)));
  T('[9] codeReady: this tree has the hook and Q417 (o920)', R.codeReady(ROOT, 'o920').ok && R.codeReady(ROOT, 'o920').hook);
  const t = fs.mkdtempSync(path.join(TMP, 'ready-'));
  fs.writeFileSync(path.join(t, 'validate.js'), SRC.replace('function loadResettleFree(', 'function loadResettleFreeX('));
  T('[9] codeReady: without the hook nothing is ready', !R.codeReady(t, 'o920').ok && !R.codeReady(t, 'o920').hook);
  // --env-stdin: the secrets come from stdin (the vault's tier3-env JSON), only the listed names; without it the dry run stops first
  const cli = (args, input) => { const e = Object.assign({}, process.env); for (const k of ['APPID', 'STATE_SALT', 'LB_PREFIX', 'XP_LB']) delete e[k];
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'resettle-once.js')].concat(args), { cwd: ROOT, env: e, input: input || '', encoding: 'utf8' }); return (r.stdout || '') + (r.stderr || ''); };
  const noSnap = path.join(TMP, 'no-snapshot');
  const o1 = cli(['dry-run', '--snap', noSnap, '--set', 'o920']);
  const o2 = cli(['dry-run', '--snap', noSnap, '--set', 'o920', '--env-stdin'], JSON.stringify({ env: { APPID: '4999999', STATE_SALT: 'x', STEAM_PUBLISHER_KEY: 'never' } }));
  T('[9] dry-run --env-stdin takes the job\'s secrets from stdin (without it: refused before reading anything)', /APPID is not set/.test(o1) && /no manifest\.json for appid 4999999/.test(o2) && !/never/.test(o2), o1.slice(0, 300) + '\n' + o2.slice(0, 300));
}

// ---- [10] dry run end to end on a synthetic snapshot ----
function initCode(tag, mutate) {
  const dir = fs.mkdtempSync(path.join(TMP, 'code-' + tag + '-'));
  const files = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter((f) => f && !f.startsWith('test/') && !/^[^/]+\.json$/.test(f) || /^(attest-keys|recover-shards|gr-caps|rfduo-caps|confirmed-errors|feedback-mod|feedback-wordlist|campaign-endless|classic|chat-mute)\.json$/.test(f));
  for (const f of files) { const s = path.join(ROOT, f); if (!fs.existsSync(s)) continue; fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(s, path.join(dir, f)); }
  for (const f of ['tools/resettle-once.js', 'tools/resettle-steam.js']) { fs.mkdirSync(path.join(dir, 'tools'), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); }
  if (mutate) { const vf = path.join(dir, 'validate.js'), s = fs.readFileSync(vf, 'utf8'), t = mutate(s); if (t === s) throw new Error('mutant ' + tag + ' changed nothing'); fs.writeFileSync(vf, t); }
  git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'code']);
  return dir;
}
function dryChecks(code, tag, depths, TT) {
  TT = TT || R;
  // 1. a real run sees the starts; its state = the commit before the close
  const H = SID(8401), V = SID(8402), h = 0x7400, key = h + '_' + SEED7 + '_7', ros = [H, V];
  const starts = [{ sid: H, d: start7(h, 0, ros) }, { sid: V, d: start7(h, 1, ros) }];
  const settles = [{ sid: H, d: settle7(h, 0, ros, nib([1, 1])) }, { sid: V, d: settle7(h, 1, ros, nib([1, 1])) }];
  const r0 = runCron(TREE, world(starts), null);
  const st = r0.state;
  if (!st.STARTS_FILE || !st.STARTS_FILE[key]) return { err: 'no start entry: ' + r0.out.slice(-800) };
  const repo = path.join(TMP, 'dry-state-' + tag); fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  const nameOf = (k) => (k === 'PROCESSED_FILE' ? 'processed.json' : k === 'STARTS_FILE' ? 'starts.json' : k === 'SOLO_FILE' ? 'endless-solo.json' : k === 'SIGNALS_FILE' ? 'signals.json' : null);
  const put = (files) => { for (const k of Object.keys(files)) { const n = nameOf(k); if (n) fs.writeFileSync(path.join(repo, n), JSON.stringify(files[k])); } };
  st.PROCESSED_FILE = st.PROCESSED_FILE || []; st.SOLO_FILE = st.SOLO_FILE || { runs: {}, done: {} };
  put(st); git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'seen']);
  st.PROCESSED_FILE = st.PROCESSED_FILE.concat([key]);   // the key closed (the rule since fixed)
  put(st); git(repo, ['add', '-A']); git(repo, ['commit', '-q', '-m', 'closed']);
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  // 2. the snapshot: boards with the records + the state of that commit
  const snap = path.join(TMP, 'snap-' + tag);
  fs.mkdirSync(path.join(snap, 'boards', '1'), { recursive: true }); fs.mkdirSync(path.join(snap, 'cron'));
  const boards = world(starts.concat(settles), 1000);
  const man = { schema: 1, at: new Date(Date.now() + 3600000).toISOString(), appids: { 1: { boards: [] } }, cron: { head } };
  for (const b of boards) {
    const rows = b.entries.map((e, i) => JSON.stringify({ sid: e.steamID, score: e.score | 0, rank: i + 1, ugc: null, d: e.details ? hexLE(e.details) : null })).join('\n');
    fs.writeFileSync(path.join(snap, 'boards', '1', b.name + '.jsonl.gz'), zlib.gzipSync(Buffer.from(rows ? rows + '\n' : '')));
    man.appids[1].boards.push({ name: b.name, id: b.id, file: 'boards/1/' + b.name + '.jsonl.gz', complete: true, onlytrustedwrites: true, sortmethod: 'Descending' });
  }
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(man));
  for (const f of ['processed.json', 'starts.json', 'endless-solo.json', 'signals.json']) if (fs.existsSync(path.join(repo, f))) fs.copyFileSync(path.join(repo, f), path.join(snap, 'cron', f));
  // 3. the dry run
  Object.assign(process.env, { APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's' });
  const lines = [];
  let res = null;
  try {
    res = TT.dryRun({ snap, code, repo, sets: ['t'], lists: { t: { lane: 'coop', keys: { [key]: depths || [0, 5] } } }, ticks: 2, work: path.join(TMP, 'work-' + tag), log: (s) => lines.push(s),
      envExtra: { STRICT_BOARDS: '0', SEEDCAP_ENFORCE: '0', SEEDCAP_REJECT: '0', SEASON_NOW: '2026-10-01T00:00:00Z', RECOVER_FILE: path.join(TMP, 'no-recover.json'), CONCURRENCY: '1' } });
  } catch (e) { return { err: String(e && e.stack || e) + '\n' + lines.join('\n').slice(-2000) }; }
  finally { for (const k of ['APPID', 'LB_PREFIX', 'RANKED_LB', 'LP_LB', 'XP_LB']) delete process.env[k]; process.env.STATE_SALT = 's'; }
  const row = res.rows.find((x) => x.m === key);
  const cpDiff = res.diff.filter((d) => d.board === 'cp_bank'), xpDiff = res.diff.filter((d) => d.board === 'progress');
  const report = fs.readFileSync(path.join(res.work, 'report.txt'), 'utf8');
  return { key, row, cpDiff, xpDiff, down: res.down, onlyB: res.onlyB, report, sids: [H, V], tail: lines.join('\n').slice(-1500) };
}
const CODE = initCode('fix');
const D10 = dryChecks(CODE, 'fix');
if (D10.err) bad('[10] dry run did not complete: ' + D10.err);
else {
  T('[10] the key\'s records found on the snapshot (2 writers, 2 starts); B settles it in tick 1', D10.row && D10.row.writers.length === 2 && D10.row.starts === 2 && /^settled \(tick 1\)/.test(D10.row.result), JSON.stringify(D10.row) + '\n' + D10.report);
  T('[10] XP rows move for both players in B only; no CP row differs (not charged); nothing goes down', D10.xpDiff.length === 2 && D10.xpDiff.every((d) => d.b > (d.a || 0)) && D10.cpDiff.length === 0 && D10.down === 0 && D10.onlyB.length === 0, D10.report);
  T('[10] the report names accounts by pid only (no Steam ID)', D10.sids.every((s) => D10.report.indexOf(s) < 0) && /settled \(tick 1\)/.test(D10.report));
}
// a co-op key settles as the session its rejection logged: the list says 0->6, the record agrees on 0->5 -> not this list's settle,
//   held (review suggestion 1: a record rewritten after the rejection)
const depthOff = (TT, tag) => {
  const d = dryChecks(CODE, tag, [0, 6], TT);
  if (d.err) return { err: d.err };
  const sk = TT.dryVerdicts({ keys: [d.row] }, { keys: [{ m: d.key, status: 'ok' }] });
  return { d, held: /^settled at depth 0->5, not the listed 0->6 \(tick 1\)/.test(d.row.result) && /dry run: settled at depth 0->5/.test(sk.get(d.key) || '') };
};
{
  const r = depthOff(R, 'depth');
  T('[10] a co-op key settling at other depths than its list: reported, and apply holds it', !r.err && r.held, r.err || (r.d.row && r.d.row.result));
}

// ---- [11] mutants ----
const mutantTool = (tag, from, to) => {
  const src = fs.readFileSync(TOOL, 'utf8');
  if (src.split(from).length !== 2) { bad('[11] mutant anchor not found exactly once: ' + tag); return null; }
  const f = path.join(TMP, 'tool-' + tag + '.js'); fs.writeFileSync(f, src.replace(from, to));
  return require(f);
};
{
  const M1 = mutantTool('chain', "          if (i > g.from && !same(rP[g.rk], rC[g.rk])) {", "          if (false) {");
  if (M1) { const r = planChecks(M1, 'm-chain'); T('[11] mutant: no chain-move check -> [6] goes red (a run with a settle after its reject reopened)', !r.u1); }
  const M2 = mutantTool('owner', "            if (!m.endsWith('_' + g.seed + '_7') || doneOwner(x, dC[x]) !== g.owner) continue;", "            if (!m.endsWith('_' + g.seed + '_7')) continue;");
  if (M2) { const r = planChecks(M2, 'm-owner'); T('[11] mutant: no owner filter -> [6] goes red (another owner\'s segment under the seed taken)', !r.sb); }
  const M3 = mutantTool('once', "    if (!r) return null;\n    if (o.again", "    return null;\n    if (o.again");
  if (M3) { const r = planChecks(M3, 'm-once'); T('[11] mutant: no reopen-once guard -> [6] goes red', !r.history || !r.again); }
  const M4 = mutantTool('flags', "      if (a && ev.length) { for (const e of ev) e.fp = 'review'; a.fp = (a.fp | 0) + 1; a.mw = 1; }", '');
  if (M4) T('[11] mutant: flags leave the trust events -> [7] goes red', !flagChecks(M4).events);
  const M6 = mutantTool('hold', "    for (const x of r.keys) if (!held.has(x)) held.set(x, x === m ? why : 'its run holds ' + m + ' (' + why + ')');", "    held.set(m, why);");
  if (M6) { const r = holdChecks(M6, 'm-hold'); T('[11] mutant: a held key leaves its run open -> [6] goes red (a run reopened with a hole)', !r.skipRun && !r.dry); }
  const M7 = mutantTool('dry', "    else if (!/^settled \\(tick [0-9]+\\)$/.test(String(r.result))) skip.set", "    else if (false) skip.set");
  if (M7) { const r = holdChecks(M7, 'm-dry'); T('[11] mutant: the dry run\'s verdict ignored -> [6] goes red', !r.dry && !r.missing); }
  const M5 = mutantTool('start', "  if (a && a[m] && typeof a[m] === 'object') return { src: 'close', e: a[m] };", '');
  if (M5) { const r = planChecks(M5, 'm-start'); T('[11] mutant: the start entry at the close not read -> [6] goes red', !r.k1); }
  // validate.js: the co-op seat loop hook / the couch hook / the class-level static pin
  const noLoop = (s) => s.replace(/\n\s*if \(resettleFree\.has\(c\.m\)\) \{ resettleNoCharge\(c\.m, sid, debit,[^\n]*continue; \}[^\n]*/, '');
  const T1 = copyTree('m-loop', noLoop);
  const c1 = coopChecks(T1, 'm-loop');
  T('[11] mutant: the co-op seat loop hook out -> [3] goes red (a listed key charged)', !c1.free && !!staticOk(noLoop(SRC)) && !staticOk(noLoop(SRC)).loop);
  const noCouch = (s) => s.replace("if (debit > 0 && resettleFree.has(m)) resettleNoCharge(m, sid, debit, 'couch casual continues", "if (false) resettleNoCharge(m, sid, debit, 'couch casual continues");
  const T2 = copyTree('m-couch', noCouch);
  const f2 = couch(T2, 3, true);
  T('[11] mutant: the couch hook out -> [4] goes red (the listed segment pays 20 + 30)', f2.ok && f2.cps[3] === 1000 - c(1) - c(2), JSON.stringify(f2.cps));
  const noSolo = (s) => s.replace("      if (debit > 0 && resettleFree.has(m)) resettleNoCharge(m, sid, debit, 'solo casual continues (rung ' + (prev + 1) + '..' + n + ')');   // Q413: a reopened key pays nothing\n      else if (debit > 0) {", '      if (debit > 0) {');
  T('[11] mutant: the solo hook out -> [5] goes red (class-level static pin)', noSolo(SRC) !== SRC && !staticOk(noSolo(SRC)).guarded);
  const noRead = (s) => s.replace('const resettleFree = loadResettleFree(RESETTLE_FILE, nowMs);', 'const resettleFree = new Set();');
  T('[11] mutant: the list never read -> [5] goes red', !staticOk(noRead(SRC)).load);
  // the dry run on a tree without the co-op hook reports the CP going down
  const CODE2 = initCode('m-dry', noLoop);
  const d2 = dryChecks(CODE2, 'm-dry');
  T('[11] mutant: the dry run of a tree without the co-op hook reports the CP rows going down -> [10] goes red', !d2.err && d2.cpDiff.length === 2 && d2.down === 2 && /A VALUE WENT DOWN/.test(d2.report), d2.err || d2.report);
  const M13 = mutantTool('depth', "          if (depths && (!dm || Number(dm[1]) !== depths[0] || Number(dm[2]) !== depths[1])) return", "          if (false) return");
  if (M13) { const r = depthOff(M13, 'm-depth'); T('[11] mutant: the co-op depths not compared -> [10] goes red (a rewritten record taken as the listed session)', !r.err && !r.held, r.err); }
}

// ---- [12] a reopened run's later segments that are still open (cloud audit Q413 review 1) ----
// The run of S1 / S2 (owner PA, seed 601) at HEAD: S3 waits at the chain (wait entry, PA's result read), S6 has PA's result read
//   (no wait yet), S4 only a start of PA's, S5 is PB's waiting key under the same seed. S2's rejection left its wait entry behind.
const S3 = '104_601_7', S4 = '105_601_7', S5 = '106_601_7', S6 = '107_601_7', S7 = '108_601_7';
function unblockRepo(tag, extra) {
  const H = histRepo('unb-' + tag);
  const st = { processed: JSON.parse(fs.readFileSync(path.join(H.dir, 'processed.json'), 'utf8')), starts: JSON.parse(fs.readFileSync(path.join(H.dir, 'starts.json'), 'utf8')), solo: JSON.parse(fs.readFileSync(path.join(H.dir, 'endless-solo.json'), 'utf8')) };
  st.solo.wait = st.solo.wait || {};
  st.starts[S3] = { t0: T0 + 8 * 600000, mt: 7, roster: { 0: PA }, settled: [PA] }; st.solo.wait[S3] = { t0: T0 + 9 * 600000 };
  st.starts[S6] = { t0: T0 + 8 * 600000, mt: 7, roster: { 0: PA }, settled: [PA] };
  st.starts[S4] = { t0: T0 + 8 * 600000, mt: 7, roster: { 0: PA }, settled: [] };
  st.starts[S5] = { t0: T0 + 8 * 600000, mt: 7, roster: { 0: PB }, settled: [PB] }; st.solo.wait[S5] = { t0: T0 + 9 * 600000 };
  st.solo.wait[S2] = { t0: T0 + 3 * 600000 };   // the chain-gap clock S2's rejection left behind
  if (extra) extra(st);
  fs.writeFileSync(path.join(H.dir, 'processed.json'), JSON.stringify(st.processed));
  fs.writeFileSync(path.join(H.dir, 'starts.json'), JSON.stringify(st.starts));
  fs.writeFileSync(path.join(H.dir, 'endless-solo.json'), JSON.stringify(st.solo));
  git(H.dir, ['add', '-A']); git(H.dir, ['commit', '-q', '-m', 'state 9']);
  return H;
}
function unblockChecks(TT, tag) {
  const res = {};
  const H = unblockRepo(tag), G = TT.makeGit(H.dir);
  const plan = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS });
  const by = Object.fromEntries(plan.keys.map((k) => [k.m, k]));
  const runA = plan.runs.find((r) => r.rk === RKA) || {};
  res.found = !!(by[S3] && by[S3].status === 'ok' && by[S3].kind === 'unblocked' && by[S3].run === RKA && by[S3].waitT0 === T0 + 9 * 600000
    && by[S6] && by[S6].status === 'ok' && by[S6].kind === 'unblocked' && by[S6].waitT0 == null && by[S6].wrote === true);
  res.left = !by[S4] && !by[S5];
  res.run = runA.status === 'ok' && JSON.stringify(runA.keys.slice().sort()) === JSON.stringify([S1, S2, S3, S6].sort());
  const lines = []; TT.printPlan(plan, (s) => lines.push(s));
  res.print = lines.some((l) => l.indexOf(S3) >= 0 && /still open: waiting at the chain since 2026-11-18T11:30:00Z -- joins the run, exemption only/.test(l)) && lines.some((l) => /run aaaaaaaa\|0\|601: ok, 4 segment\(s\) \(2 still open, exemption only\)/.test(l));
  // apply: S1 / S2 reopened (S2's leftover chain-gap clock goes, kept in the list); S3 / S6 listed for the exemption, nothing of them edited
  const snap = (f) => fs.readFileSync(path.join(H.dir, f), 'utf8');
  const st0 = JSON.parse(snap('starts.json')), so0 = JSON.parse(snap('endless-solo.json'));
  const ap = TT.applyToDir(H.dir, plan, { now: T0 + 10 * 3600000 });
  const proc = JSON.parse(snap('processed.json')), so = JSON.parse(snap('endless-solo.json')), stx = JSON.parse(snap('starts.json')), rs = JSON.parse(snap('resettle.json'));
  res.apply = JSON.stringify(ap.reopened.slice().sort()) === JSON.stringify([K1, S1, S2].sort()) && JSON.stringify(ap.unblocked.slice().sort()) === JSON.stringify([S3, S6].sort()) && ap.skipped.length === 0
    && [S3, S6].every((m) => rs.keys[m] && rs.keys[m].cp === 'free' && rs.keys[m].how === 'unblocked' && rs.keys[m].behind === S1 && proc.indexOf(m) < 0)
    && rs.keys[S3].waiting === '2026-11-18T11:30:00Z' && rs.keys[S6].waiting === null
    && JSON.stringify(so.wait[S3]) === JSON.stringify(so0.wait[S3]) && JSON.stringify(stx[S3]) === JSON.stringify(st0[S3]) && JSON.stringify(stx[S6]) === JSON.stringify(st0[S6]);
  res.free = [S1, S2, S3, S6].every((m) => v.loadResettleFree(path.join(H.dir, 'resettle.json'), T0 + 10 * 3600000).has(m));
  res.wait = !(S2 in so.wait) && JSON.stringify(rs.keys[S2].wait) === JSON.stringify({ t0: T0 + 3 * 600000 }) && (S5 in so.wait);
  // undo: S3 taken by the reconcile meanwhile, S6 still open -> released (exemption gone, left open); S2 re-closed with its clock back
  const p4 = JSON.parse(snap('processed.json')); p4.push(S3); fs.writeFileSync(path.join(H.dir, 'processed.json'), JSON.stringify(p4));
  const un = TT.undoInDir(H.dir, { now: T0 + 12 * 3600000 });
  const proc5 = JSON.parse(snap('processed.json')), so5 = JSON.parse(snap('endless-solo.json')), rs5 = JSON.parse(snap('resettle.json'));
  res.undo = JSON.stringify(un.taken) === JSON.stringify([S3]) && JSON.stringify(un.released) === JSON.stringify([S6]) && JSON.stringify(un.reclosed.slice().sort()) === JSON.stringify([K1, S1, S2].sort())
    && rs5.keys[S3].how === 'taken' && rs5.keys[S6].how === 'released' && !rs5.keys[S6].cp && proc5.indexOf(S6) < 0
    && JSON.stringify(so5.wait[S2]) === JSON.stringify({ t0: T0 + 3 * 600000 });
  const stt = TT.statusOf(H.dir, T0 + 12 * 3600000 + 1);
  res.status = !!stt && /closed \(settled or rejected/.test((stt.rows.find((r) => r.m === S3) || {}).state || '') && /open, exemption ended/.test((stt.rows.find((r) => r.m === S6) || {}).state || '') && stt.expired;
  git(H.dir, ['add', '-A']); git(H.dir, ['commit', '-q', '-m', 'undo']);
  const again = TT.planKeys(G, 'HEAD', ['c', 's'], { lists: LISTS, again: true });
  const ag = Object.fromEntries(again.keys.map((k) => [k.m, k.status]));
  res.again = ag[S1] === 'ok' && ag[S2] === 'ok' && ag[S6] === 'ok' && !(S3 in ag);   // (S3 is processed now: no longer a still-open segment)
  // the dry run did not see S3 settle: the whole run is held
  const p2 = TT.planKeys(TT.makeGit(unblockRepo(tag + '-d').dir), 'HEAD', ['c', 's'], { lists: LISTS });
  TT.holdKeys(p2, TT.dryVerdicts({ keys: [K1, S1, S2, S6].map((m) => ({ m, result: 'settled (tick 1)' })).concat([{ m: S3, result: 'waiting: solo ' + S3 + ': waiting for its chain (chain-gap)' }]) }, p2));
  const s2 = Object.fromEntries(p2.keys.map((k) => [k.m, k.status]));
  res.dryHold = s2[K1] === 'ok' && [S1, S2, S3, S6].every((m) => s2[m] === 'refused');
  // a waiting key under the seed with no start entry: whose? the run is held for review
  const p3 = TT.planKeys(TT.makeGit(unblockRepo(tag + '-n', (st) => { st.solo.wait[S7] = { t0: T0 }; }).dir), 'HEAD', ['c', 's'], { lists: LISTS });
  const r3 = p3.runs.find((r) => r.rk === RKA) || {};
  res.orphan = r3.status === 'review' && /no start entry to tell whose it is \(108_601_7\)/.test(r3.why || '') && p3.keys.filter((k) => [S1, S2].indexOf(k.m) >= 0).every((k) => k.status === 'review');
  // one segment of the run that cannot be reopened (here: S6 listed before) holds the run whole
  const p5 = TT.planKeys(TT.makeGit(unblockRepo(tag + '-l').dir), 'HEAD', ['c', 's'], { lists: LISTS, listed: new Map([[S6, { how: 'unblocked', at: '2026-11-19T00:00:00Z' }]]) });
  const r5 = p5.runs.find((r) => r.rk === RKA) || {};
  res.whole = r5.status === 'review' && /segment 107_601_7 is refused/.test(r5.why || '') && p5.keys.filter((k) => [S1, S2, S3].indexOf(k.m) >= 0).every((k) => k.status === 'review') && !p5.keys.some((k) => k.lane === 'solo' && k.status === 'ok');
  res.detail = { keys: plan.keys.map((k) => [k.m, k.status, k.kind || '', k.why || '']), ap, un, lines: lines.join('\n'), r3: r3.why, r5: r5.why };
  return res;
}
const U12 = unblockChecks(R, 'fix');
T('[12] plan: the run\'s still-open later segments join it (one waiting at the chain, one with its result read)', U12.found, JSON.stringify(U12.detail.keys));
T('[12] ... a start without the owner\'s result, and another owner\'s waiting key under the seed, left alone', U12.left, JSON.stringify(U12.detail.keys));
T('[12] the run: 4 segments, ok', U12.run);
T('[12] plan output names them (still open, exemption only)', U12.print, U12.detail.lines);
T('[12] apply: listed for the exemption (how unblocked), nothing of them edited (wait clock, start entry, processed)', U12.apply, JSON.stringify(U12.detail.ap));
T('[12] validate.js reads all four of the run as free', U12.free);
T('[12] apply: a reopened key\'s leftover chain-gap clock goes (kept in the list); another key\'s stays', U12.wait);
T('[12] undo: the one the reconcile took is taken, the open one released (exemption gone, left open), the clock back', U12.undo, JSON.stringify(U12.detail.un));
T('[12] status: taken -> closed, released -> open with the exemption ended', U12.status);
T('[12] --again after undo takes a released one back too', U12.again);
T('[12] the dry run did not see a still-open segment settle: its whole run held', U12.dryHold);
T('[12] a waiting key under the seed with no start entry: the run held for review', U12.orphan, U12.detail.r3);
T('[12] one segment of a run that cannot be reopened holds the whole run', U12.whole, U12.detail.r5);
// the report gate
{
  const now = Date.parse('2026-11-21T00:00:00Z');
  const ok0 = { v: 2, snapshot: '2026-11-20T20:00:00Z', down: 0, onlyB: [], unblockedB: ['1_2_7'], flagsOther: [], exit: { A: [0, 0], B: [0, 0] } };
  const g = (x) => R.reportGate(Object.assign({}, ok0, x), now);
  T('[12] gate: a clean report (a planned still-open segment closed in B) passes', g({}).refuse.length === 0 && g({}).warn.length === 0, JSON.stringify(g({})));
  T('[12] gate: refused on a value down / a key closed in B only outside the plan / a new flag outside the plan / a run not exiting 0 / an older report',
    /go down/.test(g({ down: 1 }).refuse.join()) && /closed in B only/.test(g({ onlyB: ['3_4_7'] }).refuse.join()) && /new forgery flags/.test(g({ flagsOther: [{ m: '3_4_7', p: 'aaaaaaaa' }] }).refuse.join())
    && /did not exit 0/.test(g({ exit: { A: [0], B: [0, 1] } }).refuse.join()) && /not a report of this version/.test(R.reportGate({ down: 0, onlyB: [], snapshot: ok0.snapshot }, now).refuse.join()));
  T('[12] gate: a snapshot older than a day warns', /hours old/.test(g({ snapshot: '2026-11-19T20:00:00Z' }).warn.join()) && g({ snapshot: '2026-11-19T20:00:00Z' }).refuse.length === 0);
  const pl = { keys: [{ m: '1_2_7', status: 'ok' }] };
  T('[12] dryVerdicts: a planned key that settled but got a new forgery flag in B is held', /new forgery flag/.test(R.dryVerdicts({ keys: [{ m: '1_2_7', result: 'settled (tick 1)', flagB: 'aaaaaaaa' }] }, pl).get('1_2_7') || ''));
  const fd = fs.mkdtempSync(path.join(TMP, 'fc-'));
  fs.writeFileSync(path.join(fd, 'signals.json'), JSON.stringify({ players: { [PA]: { fm: { '1_2_7': 1 } }, [PB]: { f: 2 } } }));
  fs.writeFileSync(path.join(fd, 'trust.json'), JSON.stringify({ acct: { [PC]: { ev: [{ s: 'fl', m: '3_4_7' }, { s: 'rp', m: '5_6_7' }] } } }));
  eq('[12] flagCells: fm cells and fl events, pid|key', [...R.flagCells(fd)].sort(), [PA + '|1_2_7', PC + '|3_4_7']);
}
// mutants
{
  const M8 = mutantTool('unblocked', "        if (!wrote && !waits) continue;   // no result of the owner's read yet: the same in both timelines", '        continue;');
  if (M8) { const r = unblockChecks(M8, 'm-unb'); T('[12] mutant: no still-open segments in the plan -> [12] goes red', !r.found && !r.run && !r.apply); }
  const M9 = mutantTool('whole', "        if (bad) { g.status = 'review';", "        if (false) { g.status = 'review';");
  if (M9) { const r = unblockChecks(M9, 'm-whole'); T('[12] mutant: no whole-run rule -> [12] goes red (a run reopened around a segment it cannot reopen)', !r.whole); }
  const M10 = mutantTool('wait', '    if (wait) delete solo.wait[k.m];', '');
  if (M10) { const r = unblockChecks(M10, 'm-wait'); T('[12] mutant: the leftover clock kept -> [12] goes red', !r.wait); }
  const M11 = mutantTool('gate', "    if ((rep.onlyB || []).length) refuse.push(", "    if (false) refuse.push(");
  if (M11) T('[12] mutant: the gate ignores keys closed in B only -> [12] goes red', M11.reportGate({ v: 2, snapshot: new Date().toISOString(), down: 0, onlyB: ['3_4_7'], flagsOther: [], exit: { A: [0], B: [0] } }).refuse.length === 0);
}

// ---- [13] end to end, the review's shape (review/probe-solo.js, default): a casual couch run of three segments; the old rule
//   rejects the second (perk lane), the third then waits at the chain (wait entry, refused after 7 days). The tool's dry run on
//   the live boards + state, apply, and the new rule live: each segment settles once, no continue charged, the run ends where
//   the new rule from the start ends it. The state history is real git (a commit per reconcile run, as the job's).
const OLD_RULE = (s) => s.replace("const pv = perks.verifyPerkPicks(f, soloState.runs[key], cc ? 2 : 1, PERK_CH);",
  "const pv = (process.env.RESETTLE_TEST_OLD_RULE === '1' && (f.startDepth | 0) === 5) ? { ok: false, reason: 'perk_chain', why: 'prefix (test: the old rule)' } : perks.verifyPerkPicks(f, soloState.runs[key], cc ? 2 : 1, PERK_CH);")
  .replace("? lateResume('perk_chain') : null;   // Q425", "? (process.env.RESETTLE_TEST_OLD_RULE === '1' ? null : lateResume('perk_chain')) : null;   // Q425 (the old rule had no wait)");
function liveRepo(tag) {
  const dir = fs.mkdtempSync(path.join(TMP, 'live-' + tag + '-'));
  const files = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter((f) => f && !f.startsWith('test/') && (!/^[^/]+\.json$/.test(f) || /^(attest-keys|recover-shards|gr-caps|rfduo-caps|confirmed-errors|feedback-mod|feedback-wordlist|campaign-endless|classic|chat-mute)\.json$/.test(f)));
  for (const f of files) { const s = path.join(ROOT, f); if (!fs.existsSync(s)) continue; fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(s, path.join(dir, f)); }
  for (const f of ['tools/resettle-once.js', 'tools/resettle-steam.js']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const vf = path.join(dir, 'validate.js'), s0 = fs.readFileSync(vf, 'utf8'), s1 = OLD_RULE(s0);
  if (s1 === s0) throw new Error('[13] the old-rule anchor is gone from validate.js (perk lane, verifyPerkPicks)');
  if (s1.indexOf('(the old rule had no wait)') < 0) throw new Error('[13] the Q425 anchor is gone from validate.js (perk lane, lateResume) -- the simulated old rule would wait, not reject');   // Q425 review P3-c
  fs.writeFileSync(vf, s1);
  const kf = path.join(dir, 'attest-keys.json'), j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' }; fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  fs.writeFileSync(path.join(dir, 'processed.json'), '[]'); fs.writeFileSync(path.join(dir, 'starts.json'), '{}');
  fs.writeFileSync(path.join(dir, 'endless-solo.json'), JSON.stringify({ runs: {}, done: {}, wait: {} }));
  git(dir, ['init', '-q', '-b', 'main']); git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', 'code']);
  return dir;
}
const ENVX = { STRICT_BOARDS: '0', SEEDCAP_ENFORCE: '0', SEEDCAP_REJECT: '0', SEASON_NOW: '2026-10-01T00:00:00Z', RECOVER_FILE: path.join(TMP, 'no-recover.json'), CONCURRENCY: '1', RESUME_TAG_REQUIRED: '0' };
const SEC = { APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's' };
const toFx = (boards) => ({ nextId: 99000, boards: boards.map((b) => ({ id: b.id, name: b.name, trusted: true, asc: false, entries: Object.fromEntries((b.entries || []).map((e) => [String(e.steamID), { score: e.score | 0, h: e.details ? hexLE(e.details) : '' }])) })) });
function writeRows(fxPath, recs) { const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); for (const r of recs) { const b = fx.boards.find((x) => x.name === 'shard_' + r.shard); b.entries[String(r.sid)] = { score: 1, h: hexLE(r.d) }; } fs.writeFileSync(fxPath, JSON.stringify(fx)); }
function liveTick(dir, fxPath, nowMs, oldRule) {
  const base = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LANG: 'C.UTF-8' };
  const env = Object.assign(base, SEC, ENVX, { STEAM_PUBLISHER_KEY: 'offline', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: path.join(dir, '.summary.md'),
    RESETTLE_FX: fxPath, RESETTLE_LOG: path.join(dir, '.writes.jsonl'), RESETTLE_NOW_MS: String(nowMs), RESETTLE_TEST_OLD_RULE: oldRule ? '1' : '0' });
  const r = spawnSync(process.execPath, ['-r', path.join(dir, 'tools', 'resettle-steam.js'), 'validate.js'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 180000 });
  git(dir, ['add', '-A', '--', 'processed.json', 'starts.json', 'endless-solo.json']);
  const when = new Date(nowMs).toISOString();
  spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'state ' + when], { env: Object.assign({}, process.env, { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const S13 = SID(8601), RS13 = 860001;
const e0 = couchRec(S13, 'pr-c0', RS13, { sd: 0, ed: 5 });
const e1 = couchRec(S13, 'pr-c1', RS13, { sd: 5, ed: 10, conts: 2 });
const e2 = couchRec(S13, 'pr-c2', RS13, { sd: 10, ed: 12, conts: 3, flags: CAS0 | A.SEG_FINAL, disp: 5 });
const n0 = keyOf(e0), n1 = keyOf(e1), n2 = keyOf(e2);
const T13 = Date.parse('2026-11-17T12:00:00Z');
// the player's writes: [hours after T13, rows]; a reconcile run a minute after each, and one more
const W13 = [[0, [{ sid: S13, d: startC(e0[3], S13, RS13), shard: 0 }]], [2, [{ sid: S13, d: e0, shard: 1 }]], [2.1, [{ sid: S13, d: startC(e1[3], S13, RS13), shard: 3 }]], [4.1, [{ sid: S13, d: e1, shard: 4 }]],
  [4.2, [{ sid: S13, d: startC(e2[3], S13, RS13), shard: 6 }]], [6.2, [{ sid: S13, d: e2, shard: 7 }]], [6.4, []]];
function live13(tag, oldRule) {
  const dir = liveRepo(tag), fxPath = path.join(dir, '.fx.json');
  fs.writeFileSync(fxPath, JSON.stringify(toFx(world([], 1000))));
  const outs = [];
  for (const [h, rows] of W13) {
    if (rows.length) writeRows(fxPath, rows);
    const r = liveTick(dir, fxPath, T13 + Math.round(h * HOUR) + 60000, oldRule);
    outs.push(r.out);
    if (r.code !== 0) return { err: 'tick ' + h + ' h: exit ' + r.code + '\n' + r.out.slice(-1500) };
  }
  return { dir, fxPath, out: outs.join('\n') };
}
const fxRow = (fxPath, name, sid) => { const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8')); const b = fx.boards.find((x) => x.name === name); return b && b.entries[String(sid)] ? b.entries[String(sid)].score : null; };
const soloAt = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'endless-solo.json'), 'utf8'));
const chainOf = (dir) => { const so = soloAt(dir); const k = Object.keys(so.runs || {}).find((x) => x.endsWith('|' + RS13)); return k ? so.runs[k].max : null; };
function snapOf(dir, fxPath, atMs, tag) {
  const snap = path.join(TMP, 'snap13-' + tag); fs.mkdirSync(path.join(snap, 'boards', '1'), { recursive: true }); fs.mkdirSync(path.join(snap, 'cron'));
  const fx = JSON.parse(fs.readFileSync(fxPath, 'utf8'));
  const man = { schema: 1, at: new Date(atMs).toISOString(), appids: { 1: { boards: [] } }, cron: { head: git(dir, ['rev-parse', 'HEAD']).trim() } };
  for (const b of fx.boards) {
    const rows = Object.keys(b.entries).map((sid, i) => JSON.stringify({ sid, score: b.entries[sid].score, rank: i + 1, ugc: null, d: b.entries[sid].h || null })).join('\n');
    fs.writeFileSync(path.join(snap, 'boards', '1', b.name + '.jsonl.gz'), zlib.gzipSync(Buffer.from(rows ? rows + '\n' : '')));
    man.appids[1].boards.push({ name: b.name, id: b.id, file: 'boards/1/' + b.name + '.jsonl.gz', complete: true, onlytrustedwrites: true, sortmethod: 'Descending' });
  }
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(man));
  for (const f of fs.readdirSync(dir)) if (/\.json$/.test(f)) fs.copyFileSync(path.join(dir, f), path.join(snap, 'cron', f));
  return snap;
}
const LISTS13 = { p: { lane: 'solo', fix: 'test', why: 'test', keys: { [n1]: null } } };
function dry13(TT, live, tag) {
  Object.assign(process.env, SEC);
  const lines = [];
  try {
    const r = TT.dryRun({ snap: snapOf(live.dir, live.fxPath, T13 + 8 * HOUR, tag), code: live.dir, repo: live.dir, sets: ['p'], lists: LISTS13, ticks: 3, work: path.join(TMP, 'work13-' + tag), log: (s) => lines.push(s), envExtra: Object.assign({}, ENVX, { RESETTLE_TEST_OLD_RULE: '0' }) });
    return Object.assign(r, { report: fs.readFileSync(path.join(r.work, 'report.txt'), 'utf8'), rep: JSON.parse(fs.readFileSync(path.join(r.work, 'report.json'), 'utf8')) });
  } catch (e) { return { err: String(e && e.stack || e) + '\n' + lines.join('\n').slice(-2000) }; }
  finally { for (const k of ['APPID', 'LB_PREFIX', 'RANKED_LB', 'LP_LB', 'XP_LB']) delete process.env[k]; process.env.STATE_SALT = 's'; }
}
{
  const OLD13 = live13('old', true), BASE13 = live13('base', false);
  if (OLD13.err || BASE13.err) bad('[13] the live runs did not complete: ' + (OLD13.err || BASE13.err));
  else {
    const so = soloAt(OLD13.dir), proc0 = JSON.parse(fs.readFileSync(path.join(OLD13.dir, 'processed.json'), 'utf8'));
    T('[13] old rule live: segment 1 settled, segment 2 rejected (perk lane), segment 3 waits at the chain (not processed, wait entry)',
      proc0.indexOf(n0) >= 0 && proc0.indexOf(n1) >= 0 && proc0.indexOf(n2) < 0 && !!(so.wait || {})[n2] && /perk REJECT \(perk_chain: prefix \(test: the old rule\)\)/.test(OLD13.out) && chainOf(OLD13.dir) === 5,
      JSON.stringify({ proc0, wait: Object.keys(so.wait || {}), chain: chainOf(OLD13.dir) }) + '\n' + OLD13.out.split('\n').filter((l) => l.indexOf(n1) >= 0 || l.indexOf(n2) >= 0).join('\n').slice(0, 1500));
    const oldCp = fxRow(OLD13.fxPath, 'cp_bank', S13), baseXp = fxRow(BASE13.fxPath, 'progress', S13), baseCp = fxRow(BASE13.fxPath, 'cp_bank', S13), baseChain = chainOf(BASE13.dir);
    T('[13] new rule from the start (the baseline): all three settle, chain 12, segments 2 and 3 pay their continues', baseChain === 12 && baseCp != null && oldCp != null && baseCp < oldCp, JSON.stringify({ baseChain, baseCp, oldCp }));
    const G13 = R.makeGit(OLD13.dir);
    const pl = R.planKeys(G13, 'HEAD', ['p'], { lists: LISTS13 });
    const k2 = pl.keys.find((k) => k.m === n2) || {};
    T('[13] plan: segment 2 reopened, segment 3 joins its run (still open, waiting at the chain)', (pl.keys.find((k) => k.m === n1) || {}).status === 'ok' && k2.status === 'ok' && k2.kind === 'unblocked' && !!k2.waitT0, JSON.stringify(pl.keys.map((k) => [k.m, k.status, k.kind || '', k.why || ''])));
    const D = dry13(R, OLD13, 'fix');
    if (D.err) bad('[13] the dry run did not complete: ' + D.err);
    else {
      const row = (m) => D.rows.find((x) => x.m === m) || {};
      T('[13] dry run: both settle in B; segment 3 closed in B as planned; 0 closed in B only; no value down; no new flag; every run exit 0',
        /^settled \(tick [0-9]+\)$/.test(row(n1).result) && /^settled \(tick [0-9]+\)$/.test(row(n2).result) && JSON.stringify(D.unblockedB) === JSON.stringify([n2]) && D.onlyB.length === 0 && D.down === 0 && D.flagsOther.length === 0 && D.exitBad === 0
        && /1 still-open later segment\(s\) of a reopened run closed in B \(planned, exempt\), 0 closed in B only \(should be none\)/.test(D.report) && /no board value goes down/.test(D.report),
        D.report);
      T('[13] ... the cp_bank row does not differ (nothing charged in B), XP goes up', !D.diff.some((d) => d.board === 'cp_bank') && D.diff.some((d) => d.board === 'progress' && d.b > (d.a || 0)), D.report);
      T('[13] ... the gate takes the report', R.reportGate(D.rep, T13 + 8 * HOUR).refuse.length === 0, JSON.stringify(R.reportGate(D.rep, T13 + 8 * HOUR)));
      // mutant (before anything is applied): the tool without the still-open step -- the review's finding comes back (segment 3
      //   closed in B only, the CP row down, the gate refuses the report)
      const M12 = mutantTool('unb13', "        if (!wrote && !waits) continue;   // no result of the owner's read yet: the same in both timelines", '        continue;');
      if (M12) {
        const Dm = dry13(M12, OLD13, 'm-unb');
        T('[13] mutant: no still-open segments in the plan -> the dry run has segment 3 closed in B only and the CP row down, the gate refuses',
          !Dm.err && JSON.stringify(Dm.onlyB) === JSON.stringify([n2]) && Dm.down >= 1 && /A VALUE WENT DOWN/.test(Dm.report) && R.reportGate(Dm.rep, T13 + 8 * HOUR).refuse.length === 2, Dm.err || Dm.report);
      }
      // apply in the live repo (as the CLI: plan at HEAD + the dry run's verdicts), commit, then the new rule live
      const plan = R.holdKeys(R.planKeys(G13, 'HEAD', ['p'], { lists: LISTS13, dir: OLD13.dir }), R.dryVerdicts(D.rep, pl));
      const nowLive = T13 + 8 * HOUR + 120000;
      const ap = R.applyToDir(OLD13.dir, plan, { now: nowLive });
      git(OLD13.dir, ['add', '-A', '--', 'processed.json', 'starts.json', 'endless-solo.json', 'resettle.json']); git(OLD13.dir, ['commit', '-q', '-m', 'resettle']);
      const outs = [];
      for (let k = 1; k <= 3; k++) { const r = liveTick(OLD13.dir, OLD13.fxPath, nowLive + k * 5 * 60000, false); outs.push(r.out); if (r.code) break; }
      const aOut = outs.join('\n');
      const cnt = (m) => aOut.split('\n').filter((l) => new RegExp('(solo|couch) settle ' + m + ':').test(l)).length;
      T('[13] apply: segment 2 reopened, segment 3 listed for the exemption', JSON.stringify(ap.reopened) === JSON.stringify([n1]) && JSON.stringify(ap.unblocked) === JSON.stringify([n2]), JSON.stringify(ap));
      T('[13] live after: segments 2 and 3 settle once each, nothing charged (CP as before), XP and chain as the new rule from the start',
        cnt(n0) === 0 && cnt(n1) === 1 && cnt(n2) === 1 && fxRow(OLD13.fxPath, 'cp_bank', S13) === oldCp && fxRow(OLD13.fxPath, 'progress', S13) === baseXp && chainOf(OLD13.dir) === baseChain
        && /resettle cp [-0-9_]+: [0-9a-f]{8} couch casual continues \(rung 3\.\.3\)/.test(aOut),
        JSON.stringify({ counts: [cnt(n0), cnt(n1), cnt(n2)], cp: fxRow(OLD13.fxPath, 'cp_bank', S13), oldCp, xp: fxRow(OLD13.fxPath, 'progress', S13), baseXp, chain: chainOf(OLD13.dir) }) + '\n' + aOut.split('\n').filter((l) => /resettle|settle|REJECT/.test(l)).join('\n').slice(0, 2000));
      const pl2 = R.planKeys(G13, 'HEAD', ['p'], { lists: LISTS13, dir: OLD13.dir });
      const un = R.undoInDir(OLD13.dir, { now: nowLive + HOUR });
      T('[13] a second plan refuses; undo finds both taken by the reconcile', pl2.keys.every((k) => k.status === 'refused') && un.reclosed.length === 0 && JSON.stringify(un.taken.slice().sort()) === JSON.stringify([n1, n2].sort()), JSON.stringify({ pl2: pl2.keys.map((k) => [k.m, k.status]), un }));
    }
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
