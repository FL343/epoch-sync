'use strict';
// O903 (2026-11-18): a casual token resume (the gold-bought save item: the guard's checkpoint-snapshot row, solo O218 / couch C3a) from a
//   checkpoint OLDER than the run's last perk draw was a perk_chain prefix reject + a "suspected forgery" flag on an honest player. The row
//   carries the picks of every draw at or before its checkpoint and none after; the run's chain memory (run.pk) carried the dead timeline's
//   longer log, which the resumed log does not extend. Live: one couch casual two-seat run on 11-17 (validate run 44111276653, state commit
//   7b15f1a91): run.max 44 / final / 8 picks, then a resumed 15 -> 15 segment with the first 3 of those picks (its build 41501868 is exactly
//   the replay of those 3) -> REJECT (perk_chain: prefix) + signals / trust flag. Fix (perks.js chainCutOf): such a segment must extend only
//   the first maxDrawsByDepth(resume depth) picks of the previous log -- the cut rerollChain's casualResumeAt makes for the reroll bitmap.
//   [1] unit: chainCutOf -- resumed + casual (solo / couch) = the draws up to the resume depth; every other segment = null (no cut)
//   [2] unit: isPrefix upTo; verifyPerkPicks on the live shape (resumed 15 -> 15 extends the 8-pick log up to its checkpoint -> ok) and the
//       cases that must stay rejected (a pick before the checkpoint changed; the same log on a segment that is not a casual resume;
//       a competitive resume)
//   [3] main(): the live case -- couch casual, two seats, the run memory as the live state had it, the resumed 15 -> 15 segment settles
//       (revived by a casual token resume), nobody flagged, no trust event
//   [4] main(): a solo casual run -- resumed 15 -> 20 with a different pick at depth 20 than the dead timeline, then 20 -> 23 FINAL: both
//       settle, the ladder moves, nobody flagged (before: the resume was flagged and the rest of the resumed run was lost as after-final)
//   [5] main(): a casual resume whose pick BEFORE the checkpoint differs from the run's log -> still perk REJECT (perk_chain) + flagged
//   [6] mutations (each must turn this file red): the cut not applied / applied to every casual segment / one draw too many /
//       applied to a competitive resume
// Usage: node test/casual-resume-perk-chain.js [<epoch-sync root>] [--no-mut]   (root defaults to this checkout; --no-mut = the mutation
//   children). Outside the tree it is the O903 repro: an epoch-sync without the fix exits 1, with it 0.
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), harness from test/couch-casual-settle.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ARGS = process.argv.slice(2);
const NO_MUT = ARGS.indexOf('--no-mut') >= 0;
const ROOT = path.resolve(ARGS.find((a) => !a.startsWith('--')) || path.join(__dirname, '..'));
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const perks = require(path.join(ROOT, 'perks.js'));
const P = perks.load();

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

console.log('=== O903 casual token resume: the perk chain up to the checkpoint (' + path.basename(ROOT) + ') ===');
const hasCut = typeof perks.chainCutOf === 'function';
const CAS = A.SEG_CASUAL, RES = A.SEG_RESUMED, FIN = A.SEG_FINAL, COUCH = A.SEG_COUCH;

// ---- pick logs that replay (the real vendor table + RNG, channel 'ea' like the production job) ----
// the live run (11-17): couch casual two seats, season 0, run seed 759833717, the 8 picks run.pk held
const LIVE = { season: 0, runSeed: 759833717, picks: [1, 3, 3, 2, 2, 2, 2, 5], build3: 41501868 };
const pad = (a) => { const o = a.slice(0, 20); while (o.length < 20) o.push(0); return o; };
const packed = (a) => P.packPicks(pad(a));
function replayBuild(arr, season, runSeed, pc, flags, endDepth) {
  const f = { seasonId: season, runSeed, flags };
  const r = P.replay(P.seasonSeed(season), pad(arr), endDepth, perks.replayOpts(f, pc, 'ea'));
  return r.ok ? (r.build >>> 0) : null;
}
// extend `head` to n picks, each the first choice of `order` that still replays (deterministic)
function grow(head, n, season, runSeed, pc, flags, order) {
  const out = head.slice();
  while (out.length < n) {
    let got = null;
    for (const c of (order || [1, 2, 3, 5])) {
      const t = out.concat([c]);
      if (replayBuild(t, season, runSeed, pc, flags, 5 * t.length) != null) { got = c; break; }
    }
    if (got == null) throw new Error('no replayable choice at draw ' + out.length);
    out.push(got);
  }
  return out;
}
// a different replayable choice at draw k (same head)
function otherAt(log, k, season, runSeed, pc, flags) {
  for (const c of [1, 2, 3, 5]) {
    if (c === log[k]) continue;
    const t = log.slice(0, k).concat([c]);
    if (replayBuild(t, season, runSeed, pc, flags, 5 * t.length) != null) return c;
  }
  throw new Error('no other replayable choice at draw ' + k);
}

// ---- [1] chainCutOf ----
{
  T('[1] chainCutOf exported (the fix is in this tree)', hasCut);
  if (hasCut) {
    const cut = (flags, sd) => perks.chainCutOf({ flags, startDepth: sd });
    eq('[1] a casual token resume (solo) at 15 -> the 3 draws up to 15', cut(CAS | RES, 15), 3);
    eq('[1] a couch casual token resume at 15 (the live case, also final) -> 3', cut(CAS | COUCH | RES | FIN, 15), 3);
    eq('[1] resume at 5 / 40 -> 1 / 8; past MAX_DRAWS x DRAW_EVERY -> capped at 20', [cut(CAS | RES, 5), cut(CAS | RES, 40), cut(CAS | RES, 150)], [1, 8, 20]);
    eq('[1] a casual segment that is not a resume -> no cut', [cut(CAS, 15), cut(CAS | COUCH | FIN, 20)], [null, null]);
    eq('[1] a competitive resume (consumes a save written at the save depth) -> no cut', [cut(RES, 15), cut(RES | A.SEG_COMP | COUCH, 15)], [null, null]);
    eq('[1] a classic resume (no picks) -> no cut', cut(A.SEG_CLASSIC | RES, 17), null);
    eq('[1] no fields -> no cut', [perks.chainCutOf(null), perks.chainCutOf({})], [null, null]);
  }
}

// ---- [2] isPrefix upTo + verifyPerkPicks ----
const LIVE8 = packed(LIVE.picks), LIVE3 = packed(LIVE.picks.slice(0, 3));
const liveRun = { pk: { lo: LIVE8.lo, hi: LIVE8.hi } };
const liveRes = (o) => Object.assign({ build: LIVE.build3, picksLo: LIVE3.lo, picksHi: LIVE3.hi, seasonId: LIVE.season, runSeed: LIVE.runSeed,
  startDepth: 15, endDepth: 15, flags: CAS | COUCH | RES | FIN }, o || {});
{
  T('[2] the live build 41501868 = the replay of the first 3 picks of the run\'s 8 (the resumed log is that prefix)',
    replayBuild(LIVE.picks.slice(0, 3), LIVE.season, LIVE.runSeed, 2, CAS | COUCH, 15) === LIVE.build3);
  T('[2] isPrefix without upTo: unchanged (8 picks are not a prefix of their own first 3)', perks.isPrefix(LIVE8.lo, LIVE8.hi, LIVE3.lo, LIVE3.hi) === false
    && perks.isPrefix(LIVE3.lo, LIVE3.hi, LIVE8.lo, LIVE8.hi) === true);
  T('[2] isPrefix upTo 3: the first 3 match -> true; upTo 4 -> false', perks.isPrefix(LIVE8.lo, LIVE8.hi, LIVE3.lo, LIVE3.hi, 3) === true
    && perks.isPrefix(LIVE8.lo, LIVE8.hi, LIVE3.lo, LIVE3.hi, 4) === false);
  const pv = perks.verifyPerkPicks(liveRes(), liveRun, 2, 'ea');
  T('[2] the live resumed 15 -> 15 segment against the live run memory -> ok (was perk_chain prefix)', pv.ok === true && pv.n === 3 && pv.build === LIVE.build3, JSON.stringify(pv));
  const forged = LIVE.picks.slice(0, 2).concat([otherAt(LIVE.picks, 2, LIVE.season, LIVE.runSeed, 2, CAS | COUCH)]);
  const fp = packed(forged);
  const pvF = perks.verifyPerkPicks(liveRes({ build: replayBuild(forged, LIVE.season, LIVE.runSeed, 2, CAS | COUCH, 15), picksLo: fp.lo, picksHi: fp.hi }), liveRun, 2, 'ea');
  eq('[2] the checkpoint draw (depth 15) changed on a resume -> still perk_chain prefix', [pvF.ok, pvF.reason, pvF.why], [false, 'perk_chain', 'prefix']);
  const pvN = perks.verifyPerkPicks(liveRes({ flags: CAS | COUCH | FIN }), liveRun, 2, 'ea');
  eq('[2] the same 3-pick log on a casual segment that is NOT a resume -> still perk_chain prefix', [pvN.ok, pvN.reason], [false, 'perk_chain']);
  const pvC = perks.verifyPerkPicks(liveRes({ flags: RES }), liveRun, 1, 'ea');
  eq('[2] the same log on a competitive resume -> still perk_chain prefix', [pvC.ok, pvC.reason], [false, 'perk_chain']);
  const pvB = perks.verifyPerkPicks(liveRes({ build: (LIVE.build3 + 1) >>> 0 }), liveRun, 2, 'ea');
  T('[2] the chain cut does not touch the build replay: a wrong build on the resume -> perk_forge', pvB.ok === false && pvB.reason === 'perk_forge', JSON.stringify(pvB));
}

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('9d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099111801;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// guard-signed couch casual segment (layout of test/couch-casual-settle.js couchRec, perk + reroll words filled)
function couchRec(sid, id, runSeed, o) {
  const n = o.n || 2;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (let i = 0; i < n; i++) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed | 0, o.conts | 0, 0, o.season | 0, o.flags, o.build >>> 0, o.lo | 0, o.hi | 0, o.rl | 0, o.rh | 0, (o.tag | 0) & A.RESUME_TAG_MASK);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), KEY_ID, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
// guard-signed solo segment (attVer 5, BASE_LEN 30; layout of test/resume-replay.js seg, perk + reroll words filled)
function soloRec(sid, id, runSeed, o) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1,
    300, o.score == null ? 1000 : o.score, o.disp | 0, lo, hi, o.sd | 0, o.ed | 0, 0, 0, o.season | 0, o.flags | 0,
    KEY_ID, (5 | (((o.tag | 0) & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, o.build >>> 0, o.lo | 0, o.hi | 0, o.rl | 0, o.rh | 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  const d = b.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };   // the guard's single-shape start

function copyTree(root, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o903-' + tag + '-'));
  require(path.join(root, 'test', 'root-listing')).copyRootTree(root, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
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
function runCron(tree, boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o903-run-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1',
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
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
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
  }
  return files;
}
const LB = { xp: 5, cp: 8, casSolo: 25, couchCas: 20, couchCasBox: 21 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 22, name: 'endless_board', entries: [] }, { id: 23, name: 'endless_board_trio', entries: [] },
    { id: 24, name: 'endless_board_quad', entries: [] }, { id: LB.casSolo, name: 'endless_board_solo', entries: [] }, { id: 26, name: 'endless_board_overall', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 18, name: 'endless_comp_couch', entries: [] }, { id: 19, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: LB.couchCasBox, name: 'endless_save_box_casual_couch', entries: [] });
  return boards;
}
// steps: [msSincePrevious, recs]; files0 seeds the first run
function timeline(tree, steps, files0) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const files = state ? advance(state, ms) : files0;
    const r = runCron(tree, world(recs), files);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const HOUR = 3600 * 1000;
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const flaggedOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {}).f | 0);
const trustFl = (r, sid) => ((((r.state.TRUST_FILE || {}).acct || {})[v.pid(sid)] || {}).ev || []).filter((e) => e.s === 'fl').length;
const linesOf = (r, m) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n').slice(0, 1500);
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2500)); return true; };

// the scenarios, on a tree (the mutation children run them on a mutated copy)
function scenarios(tree, only) {
  // ---- [3] the live case: couch casual two seats, run memory as the live state had it, resumed 15 -> 15 ----
  if (!only || only === 3) {
    const S = SID(9031), RS = LIVE.runSeed;
    const key = v.teamRunKey([S, S], LIVE.season, RS);
    const seed = { SOLO_FILE: { runs: { [key]: { max: 44, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1, k: 1, pk: { lo: LIVE8.lo, hi: LIVE8.hi }, rr: { lo: 1049, hi: 0 } } }, wait: {}, ms: {} } };
    const segR = couchRec(S, 'o903-live-r0', RS, { sd: 15, ed: 15, season: LIVE.season, flags: CAS | COUCH | RES | FIN, build: LIVE.build3, lo: LIVE3.lo, hi: LIVE3.hi, rl: 1 | 8 | 16, tag: 0x903, seats: [300, 200] });
    const m = keyOf(segR), stR = { sid: S, d: start7(segR[3], S, RS) };
    const rs = timeline(tree, [[0, [stR]], [2 * HOUR, [stR, { sid: S, d: segR, shard: 1 }]], [2 * HOUR, [stR, { sid: S, d: segR, shard: 1 }]]], seed);
    if (!brk(rs, 3, '[3]')) {
      const r1 = rs[1];
      T('[3] the resumed 15 -> 15 segment settles in the couch lane, revived by a casual token resume', /couch settle .* couch pc 2 casual .*revived by a casual token resume/.test(r1.out) && procHas(r1, m), linesOf(r1, m));
      T('[3] no perk REJECT for it', !/perk REJECT/.test(linesOf(r1, m)), linesOf(r1, m));
      T('[3] nobody flagged: signals f = 0, no trust fl event', flaggedOf(r1, S) === 0 && trustFl(r1, S) === 0, 'f=' + flaggedOf(r1, S) + ' fl=' + trustFl(r1, S));
      const run = ((r1.state.SOLO_FILE || {}).runs || {})[key] || {};
      T('[3] the run memory follows the resumed timeline: pk = its 3 picks, the row tag recorded, max stays 44', run.pk && run.pk.lo === LIVE3.lo && run.pk.hi === LIVE3.hi && run.revs && run.revs[0x903] === m && run.max === 44,
        JSON.stringify(run));
      T('[3] the next run: nothing settles twice, still nobody flagged', !/couch settle /.test(linesOf(rs[2], m)) && flaggedOf(rs[2], S) === 0);
    }
  }
  // ---- [4] solo casual: resumed 15 -> 20 with a different pick at 20, then 20 -> 23 FINAL ----
  if (!only || only === 4) {
    const S = SID(9041), RS = 904100, SEA = 0;
    const dead = grow([], 4, SEA, RS, 1, CAS, [1, 2, 3, 5]);   // the dead timeline: draws at 5, 10, 15, 20
    const alt = dead.slice(0, 3).concat([otherAt(dead, 3, SEA, RS, 1, CAS)]);   // the resumed timeline chooses differently at 20
    const pd = packed(dead), pa = packed(alt);
    const bA = replayBuild(alt, SEA, RS, 1, CAS, 20);
    const key = v.soloRunKey(v.pid(S), SEA, RS);
    const seed = { SOLO_FILE: { runs: { [key]: { max: 20, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1, k: 1, pk: { lo: pd.lo, hi: pd.hi } } }, wait: {}, ms: {} } };
    const segR = soloRec(S, 'o903-solo-r0', RS, { sd: 15, ed: 20, flags: CAS | RES, build: bA, lo: pa.lo, hi: pa.hi, tag: 0x904, score: 3000 });
    const segF = soloRec(S, 'o903-solo-r1', RS, { sd: 20, ed: 23, flags: CAS | FIN, build: bA, lo: pa.lo, hi: pa.hi, score: 4000 });
    const mR = keyOf(segR), mF = keyOf(segF);
    const stR = { sid: S, d: start7(segR[3], S, RS) }, stF = { sid: S, d: start7(segF[3], S, RS), shard: 3 };
    const r0 = [stR], r1 = [stR, { sid: S, d: segR, shard: 1 }], r2 = r1.concat([stF]), r3 = r2.concat([{ sid: S, d: segF, shard: 4 }]);
    const rs = timeline(tree, [[0, r0], [2 * HOUR, r1], [2 * HOUR, r2], [2 * HOUR, r3]], seed);
    if (!brk(rs, 4, '[4]')) {
      T('[4] the solo casual resume 15 -> 20 settles (revived), no perk REJECT', /solo settle .* casual depth 15->20 .*revived by a casual token resume/.test(rs[1].out) && procHas(rs[1], mR)
        && !/perk REJECT/.test(linesOf(rs[1], mR)), linesOf(rs[1], mR));
      T('[4] the resumed run\'s next segment 20 -> 23 FINAL settles too (not after-final)', /solo settle .* casual depth 20->23/.test(rs[3].out) && procHas(rs[3], mF) && !/after-final|REJECT/.test(linesOf(rs[3], mF)),
        linesOf(rs[3], mF));
      T('[4] the casual solo ladder written for the resumed timeline', writesTo(rs[3], LB.casSolo, S).length === 1, 'n=' + writesTo(rs[3], LB.casSolo, S).length);
      T('[4] nobody flagged', flaggedOf(rs[3], S) === 0 && trustFl(rs[3], S) === 0, 'f=' + flaggedOf(rs[3], S) + ' fl=' + trustFl(rs[3], S));
    }
  }
  // ---- [5] a casual resume whose pick BEFORE the checkpoint differs -> still rejected + flagged ----
  if (!only || only === 5) {
    const S = SID(9051), RS = 905100, SEA = 0;
    const dead = grow([], 4, SEA, RS, 1, CAS, [1, 2, 3, 5]);
    const bent = dead.slice(0, 1).concat([otherAt(dead, 1, SEA, RS, 1, CAS)]);   // draw at depth 10 rewritten
    const bent3 = grow(bent, 3, SEA, RS, 1, CAS, [1, 2, 3, 5]);
    const pd = packed(dead), pb = packed(bent3);
    const key = v.soloRunKey(v.pid(S), SEA, RS);
    const seed = { SOLO_FILE: { runs: { [key]: { max: 20, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1, k: 1, pk: { lo: pd.lo, hi: pd.hi } } }, wait: {}, ms: {} } };
    const segR = soloRec(S, 'o903-bent-r0', RS, { sd: 15, ed: 17, flags: CAS | RES | FIN, build: replayBuild(bent3, SEA, RS, 1, CAS, 17), lo: pb.lo, hi: pb.hi, tag: 0x905, score: 2000 });
    const m = keyOf(segR), stR = { sid: S, d: start7(segR[3], S, RS) };
    const rs = timeline(tree, [[0, [stR]], [2 * HOUR, [stR, { sid: S, d: segR, shard: 1 }]]], seed);
    if (!brk(rs, 2, '[5]')) {
      T('[5] a pick before the checkpoint rewritten -> perk REJECT (perk_chain: prefix), not settled', /perk REJECT \(perk_chain: prefix\)/.test(linesOf(rs[1], m)) && !/solo settle /.test(linesOf(rs[1], m)), linesOf(rs[1], m));
      T('[5] ... and flagged as before', flaggedOf(rs[1], S) === 1 && trustFl(rs[1], S) === 1, 'f=' + flaggedOf(rs[1], S) + ' fl=' + trustFl(rs[1], S));
    }
  }
}

const TREE = copyTree(ROOT, 'fix');
try { scenarios(TREE); } finally { try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {} }

// ---- [6] mutations: each must turn this file red ----
if (!NO_MUT) {
  const PERKS_SRC = fs.readFileSync(path.join(ROOT, 'perks.js'), 'utf8');
  const MUTS = [
    ['the cut not applied (the perk chain compares the whole previous log again)', 'lo, hi, chainCutOf(f))) return', 'lo, hi)) return'],
    ['the cut applied to every casual segment (resumed or not)', 'if (!(fl & A.SEG_RESUMED) || !(fl & A.SEG_CASUAL)) return null;', 'if (!(fl & A.SEG_CASUAL)) return null;'],
    ['one draw too many kept (the checkpoint\'s next draw)', 'return load().maxDrawsByDepth((f && f.startDepth) | 0);', 'return load().maxDrawsByDepth(((f && f.startDepth) | 0) + 5);'],
    ['the cut applied to a competitive resume too', 'if (!(fl & A.SEG_RESUMED) || !(fl & A.SEG_CASUAL)) return null;', 'if (!(fl & A.SEG_RESUMED)) return null;'],
  ];
  for (const [label, from, to] of MUTS) {
    const n = PERKS_SRC.split(from).length - 1;
    if (n !== 1) { bad('[6] mutation anchor for "' + label + '" occurs ' + n + ' times in perks.js (want 1)'); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'o903-mut-'));
    try {
      require(path.join(ROOT, 'test', 'root-listing')).copyRootTree(ROOT, dir, ['.git', 'node_modules']);
      fs.copyFileSync(__filename, path.join(dir, 'test', path.basename(__filename)));   // run as the repro from outside the tree: the child is this same file
      fs.writeFileSync(path.join(dir, 'perks.js'), PERKS_SRC.replace(from, () => to));
      const r = spawnSync(process.execPath, [path.join(dir, 'test', path.basename(__filename)), dir, '--no-mut'], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      const fails = ((r.stdout || '').match(/^ {2}FAIL {2}.*$/gm) || []);
      T('[6] mutation "' + label + '" -> red (' + fails.length + ' FAIL)', r.status === 1 && fails.length > 0, 'exit ' + r.status + '\n' + (r.stdout || '').slice(-1200) + (r.stderr || '').slice(-600));
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }
}

console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
