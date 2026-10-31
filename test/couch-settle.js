'use strict';
// O606 couch competitive (client knife 5c, 2026-10-31): two local seats on ONE account, the guard judges and signs the segment
//   (attest.js A3), the solo lane settles it (validate.js soloSettleOwner, c.couch) into the duo competitive family (merged by
//   default; COUCH_DUO=split = the couch ladder only) and always into the couch ladder (dual write); the duo rating reads 'duo' +
//   'duoc' while merged. No milestones, no cup. The trial jobs never settle one; a failed check holds the run (never flags) while
//   COUCH_SIG_FLAG is off.
//   [1] attest: verifyCouchRecord verdicts (ok with / without the character block, pc / ledger / block / attVer / key states,
//       trailing, bad signature), couchSettleGate (dev key, a stranger on any seat), couchTail (keyId for the seed-cap core)
//   [2] couchSanity bounds + isCouchRec
//   [3] team block couch bit (written, decoded by teamBlockSids, ladderDetails) + ratingHistView merge / split
//   [4] main(): a saved couch segment settles -- duo + couch rows (team block [P1, P1] + couch bit), XP, chain under teamRunKey,
//       rating history 'duoc', no milestone CP, nobody flagged; the resumed segment pays the resume fee once
//   [5] main(): COUCH_DUO=split -> the couch ladder only
//   [6] main(): PT_MODE -> not settled, not processed, no couch board created
//   [7] main(): a broken signature -> held (not flagged, not processed); COUCH_SIG_FLAG=1 -> flagged
//   [8] main(): a couch kind this reader does not take (three seats) -> waits, nobody flagged
//   [9] wiring pins
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/solo-lane-owner-key.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('6c'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099103101;
const PUBS = { [String(KEY_ID)]: { pubs: [PUB], sealed: true }, dev: { pubs: [PUB], sealed: false } };

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const FLAGS0 = A.SEG_COMP | A.SEG_COUCH;
// a guard-signed couch segment of sid (the layout attest.js A3 documents; the JS reference encoder in the client repo is
//   mvp/test/lib/couch-record.js). o: n, seats, disp, roster, sd, ed, season, flags, tag, chars (false = no block), blkVer, blkLen,
//   keyId, attVer, ledgerVer, seat, trail, tamper (index whose low bit flips after signing)
function couchRec(sid, id, runSeed, o) {
  o = o || {};
  const n = o.n || 2;
  const d = [0xB1, o.ledgerVer == null ? 3 : o.ledgerVer, 7, A.hash32(id), runSeed, o.seat || 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (const s of (o.roster || Array(n).fill(sid))) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed == null ? 5 : o.ed, 0, 0, o.season | 0, o.flags == null ? (FLAGS0 | A.SEG_SUSPENDED) : o.flags, 0, 0, 0, 0, 0, (o.tag | 0) & A.RESUME_TAG_MASK);
  if (o.chars !== false) d.push(0xD8 | (1 << 8) | (n << 16), 2 | (3 << 8));
  d.push(0xE8 | ((o.blkVer || 1) << 8) | ((o.blkLen || 21) << 16), o.keyId == null ? KEY_ID : o.keyId, (o.attVer || 1), 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  if (o.tamper != null) d[o.tamper] ^= 1;
  if (o.trail) d.push(7);
  return d;
}

console.log('=== O606 couch competitive settle (client knife 5c) ===');

// ---- [1] attest ----
{
  const S = SID(6101);
  const d = couchRec(S, 'c1', 4242);
  const r = A.verifyCouchRecord(d, PUBS);
  T('[1] a signed couch segment verifies (with the character block)', r.ok && r.sealed, JSON.stringify(r));
  eq('[1] fields: N / seats / team bank / roster / tail / key', r.ok ? [r.fields.N, r.fields.seats, r.fields.score, r.fields.rosterSids, r.fields.startDepth, r.fields.endDepth, r.fields.flags, r.fields.keyName, r.fields.attVer, r.fields.runSeed] : null,
    [2, [600, 400], 1000, [S, S], 0, 5, FLAGS0 | A.SEG_SUSPENDED, String(KEY_ID), 1, 4242]);
  eq('[1] layout: 53 ints with the character block (51 without)', [d.length, couchRec(S, 'c1', 4242, { chars: false }).length], [53, 51]);
  T('[1] without the character block it verifies too', A.verifyCouchRecord(couchRec(S, 'c1', 4242, { chars: false }), PUBS).ok);
  eq('[1] the 12th tail int is the resume tag', A.verifyCouchRecord(couchRec(S, 'c1', 4242, { tag: 12345 }), PUBS).fields.resumeTag, 12345);
  const rs = (o) => A.verifyCouchRecord(couchRec(S, 'c1', 4242, o), PUBS);
  eq('[1] one seat -> pc (hard)', [rs({ n: 1 }).reason, !!rs({ n: 1 }).pending], ['pc', false]);
  eq('[1] five seats -> pc', rs({ n: 5, seats: [1, 1, 1, 1, 1] }).reason, 'pc');
  eq('[1] a writer seat other than 0 -> pc', rs({ seat: 1 }).reason, 'pc');
  eq('[1] another ledger version -> pending', [rs({ ledgerVer: 4 }).reason, rs({ ledgerVer: 4 }).pending], ['ledger-ver', true]);
  eq('[1] another block version -> pending', [rs({ blkVer: 2 }).reason, rs({ blkVer: 2 }).pending], ['couch-ver', true]);
  eq('[1] an unknown attestation layout -> pending', [rs({ attVer: 9 }).reason, rs({ attVer: 9 }).pending], ['att-ver', true]);
  eq('[1] a key the table does not list -> pending', [rs({ keyId: 1234567 }).reason, rs({ keyId: 1234567 }).pending], ['unknown-key', true]);
  eq('[1] a wrong block length -> len', rs({ blkLen: 20 }).reason, 'len');
  eq('[1] a non-zero int after the signature -> trailing', rs({ trail: true }).reason, 'trailing');
  eq('[1] a flipped tail bit after signing -> bad-sig', rs({ tamper: 20 }).reason, 'bad-sig');
  eq('[1] a flipped seat score after signing -> bad-sig', rs({ tamper: 10 }).reason, 'bad-sig');
  const noBlk = couchRec(S, 'c1', 4242).slice(0, 31);
  eq('[1] no attestation block -> no-block', A.verifyCouchRecord(noBlk.concat([0, 0]), PUBS).reason, 'no-block');
  const held = { [String(KEY_ID)]: { pubs: [], held: [{ pub: PUB, reason: 'channel' }], sealed: true } };
  eq('[1] a key the job policy holds -> pending key-channel', [A.verifyCouchRecord(d, held).reason, A.verifyCouchRecord(d, held).pending], ['key-channel', true]);
  eq('[1] gate: owner on every seat -> settle', A.couchSettleGate(r, { owner: S }), { settle: true });
  eq('[1] gate: a stranger on seat 1 -> owner-mismatch', A.couchSettleGate(A.verifyCouchRecord(couchRec(S, 'c1', 4242, { roster: [S, SID(6199)] }), PUBS), { owner: S }).reason, 'owner-mismatch');
  eq('[1] gate: the row owner is not the roster account -> owner-mismatch', A.couchSettleGate(r, { owner: SID(6199) }).reason, 'owner-mismatch');
  eq('[1] gate: dev key on a production board -> refused; allowed on the test shards', [A.couchSettleGate(A.verifyCouchRecord(couchRec(S, 'c1', 4242, { keyId: 0 }), PUBS), { owner: S }).reason,
    A.couchSettleGate(A.verifyCouchRecord(couchRec(S, 'c1', 4242, { keyId: 0 }), PUBS), { owner: S, allowDevKey: true }).settle], ['dev-key-on-prod', true]);
  const ct = A.couchTail(d);
  eq('[1] couchTail: depths / flags / keyId (exact seed-cap core)', ct ? [ct.startDepth, ct.endDepth, ct.flags, ct.keyId] : null, [0, 5, FLAGS0 | A.SEG_SUSPENDED, KEY_ID]);
  eq('[1] couchTail: same fields as the team endlessTail', ['startDepth', 'endDepth', 'seasonId', 'flags', 'build', 'rerollLo', 'resumeTag'].map((k) => ct[k] === v.endlessTail(d)[k]), [true, true, true, true, true, true, true]);
  eq('[1] couchTail: a team record without the couch bit -> null', A.couchTail(couchRec(S, 'c1', 4242, { flags: A.SEG_COMP })), null);
  eq('[1] constants (client lockstep: attest_record.h / mvp/test/lib/couch-record.js)', [A.SEG_COUCH, A.COUCH_MAGIC, A.COUCH_BLK_VER, A.COUCH_BLK_LEN, A.COUCH_ATT_VER, A.COUCH_TAIL_INTS], [64, 0xE8, 1, 21, 1, 12]);
}

// ---- [2] sanity + recognition ----
{
  const S = SID(6201);
  const f = (o) => Object.assign(A.verifyCouchRecord(couchRec(S, 's2', 99, o), PUBS).fields || {}, {});
  eq('[2] a clean saved segment', v.couchSanity(f()), []);
  eq('[2] final + quit is legal', v.couchSanity(f({ flags: FLAGS0 | A.SEG_FINAL, disp: 5 })), []);
  eq('[2] resumed segment 5 -> 9 is legal', v.couchSanity(f({ flags: FLAGS0 | A.SEG_RESUMED, sd: 5, ed: 9 })), []);
  T('[2] without the competitive bit -> flags', v.couchSanity(f({ flags: A.SEG_COUCH })).indexOf('flags') >= 0);
  T('[2] a casual bit -> flags', v.couchSanity(f({ flags: FLAGS0 | A.SEG_CASUAL })).indexOf('flags') >= 0);
  T('[2] suspended + final -> flags', v.couchSanity(f({ flags: FLAGS0 | A.SEG_SUSPENDED | A.SEG_FINAL })).indexOf('flags') >= 0);
  T('[2] span past the checkpoint cadence -> span', v.couchSanity(f({ sd: 0, ed: 6 })).indexOf('span') >= 0);
  T('[2] a quit on a segment that is not final -> disp', v.couchSanity(f({ disp: 5 })).indexOf('disp') >= 0);
  const cap = v.endlessGoalFor(5, 2) * v.ENDLESS.SCORE_MULT;
  T('[2] a seat above the two-seat line x SCORE_MULT -> score; at the line -> clean', v.couchSanity(f({ seats: [cap + 1, 0] })).indexOf('score') >= 0 && v.couchSanity(f({ seats: [cap, 0] })).length === 0);
  T('[2] three seats -> pc (v1 takes two)', v.couchSanity(f({ n: 3 })).indexOf('pc') >= 0);
  T('[2] isCouchRec: couch yes / team comp no / solo no', v.isCouchRec({ d: couchRec(S, 's2', 99) }) && !v.isCouchRec({ d: couchRec(S, 's2', 99, { flags: A.SEG_COMP }) })
    && !v.isCouchRec({ d: [0xB1, 3, 7, 1, 1, 0, 1, 0, 1, 60, 5, 0, 1, 1, 0, 1, 0, 0, 0, 0] }));
}

// ---- [3] team block + rating view ----
{
  const S = SID(6301);
  const blk = v.teamBlock([S, S], true);
  eq('[3] couch bit = head bit 24, magic / ver / pc in the low bytes', [blk[0] & 0xff, (blk[0] >>> 8) & 0xff, (blk[0] >>> 16) & 0xff, (blk[0] >>> 24) & 0xff, v.TEAM_F_COUCH], [0xD4, 1, 2, 1, 1 << 24]);
  eq('[3] teamBlockSids still decodes a couch row', v.teamBlockSids([5, 0].concat(blk)), [S, S]);
  eq('[3] ladderDetails carries the couch bit only when cc', [(v.ladderDetails({ s: 1, ts: 9, build: 0, team: [S, S], cc: 1 })[2] >>> 24) & 0xff, (v.ladderDetails({ s: 1, ts: 9, build: 0, team: [S, SID(6302)] })[2] >>> 24) & 0xff], [1, 0]);
  const p = v.pid(S);
  const st = { hist: {} };
  for (let i = 0; i < 3; i++) v.ratingHistUpsert(st, p, 'duo', 1, 100 + i, 10 + i, 1000 + i);
  for (let i = 0; i < 3; i++) v.ratingHistUpsert(st, p, 'duoc', 1, 200 + i, 20 + i, 2000 + i);
  const mg = v.ratingHistView(st, p, 'duo', 1, false), sp = v.ratingHistView(st, p, 'duo', 1, true);
  eq('[3] merged view: both families\' runs in time order, best = the deeper', [mg.runs.map((r) => r[0]), mg.best], [[100, 101, 102, 200, 201, 202], [202, 22]]);
  eq('[3] split view: duo only', [sp.runs.map((r) => r[0]), sp.best], [[100, 101, 102], [102, 12]]);
  eq('[3] merged view: rated from the 5th run over both (split: 3 runs, not rated)', [!!v.ratingScoreOf(mg), v.ratingScoreOf(sp)], [true, null]);
  for (let i = 0; i < 8; i++) v.ratingHistUpsert(st, p, 'duoc', 1, 300 + i, 5, 3000 + i);
  eq('[3] merged view keeps the last WINDOW runs', v.ratingHistView(st, p, 'duo', 1, false).runs.length, 10);
  eq('[3] another family is never merged', v.ratingHistView(st, p, 'trio', 1, false), undefined);
  const plan = v.ratingPlan(st, 1, 'duo', {}, [S], { split: false }), planS = v.ratingPlan(st, 1, 'duo', {}, [S], { split: true });
  eq('[3] ratingPlan: merged writes a duo rating row; split (3 duo runs) writes none', [plan.writes.length, planS.writes.length], [1, 0]);
}

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-settle-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  return dir;
}
const TREE = copyTree('fix');
{
  const kf = path.join(TREE, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
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
const decodeHexLE = (h) => { const out = []; for (let i = 0; i + 8 <= h.length; i += 8) out.push(Buffer.from(h.slice(i, i + 8), 'hex').readInt32LE(0)); return out; };
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-settle-run-'));
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
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, path.join(TREE, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
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
const LB = { xp: 5, cp: 8, duo: 16, couch: 18, couchBox: 19 };
function world(recs, pt) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: LB.duo, name: 'endless_comp_duo', entries: [] });
  if (!pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },   // the trial job refuses to run beside these (lock layer 3)
    { id: LB.couch, name: 'endless_comp_couch', entries: [] }, { id: LB.couchBox, name: 'endless_save_box_couch', entries: [] });
  return boards;
}
function timeline(steps, env) {
  const out = []; let state = null;
  for (const [ms, recs, files0] of steps) {
    const files = state ? advance(state, ms) : (files0 || null);
    const r = runCron(world(recs, env && env.PT_MODE === '1'), files, env);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const HOUR = 3600 * 1000;
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };   // the guard's single-shape start (plan §0.2-11)
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
// details ride as percent-encoded bytes (validate.js pctBytes: int32 little-endian)
const detailsOf = (post) => {
  const m = /details=([^&]*)/.exec(post.body);
  if (!m) return null;
  const bytes = Buffer.from(m[1].split('%').filter(Boolean).map((h) => parseInt(h.slice(0, 2), 16)));
  const out = []; for (let i = 0; i + 4 <= bytes.length; i += 4) out.push(bytes.readInt32LE(i)); return out;
};
const cpOf = (r, sid) => { const w = writesTo(r, LB.cp, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const flaggedOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {}).f | 0);
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2500)); return true; };

// ---- [4] a saved couch segment, then the resumed final one ----
{
  const S = SID(6401), RS = 640100, id0 = 'couch-run-s0', id1 = 'couch-run-s1';
  const seg0 = couchRec(S, id0, RS, { sd: 0, ed: 5, flags: FLAGS0 | A.SEG_SUSPENDED });
  const seg1 = couchRec(S, id1, RS, { sd: 5, ed: 7, flags: FLAGS0 | A.SEG_RESUMED | A.SEG_FINAL, seats: [900, 700] });
  const m0 = keyOf(seg0), m1 = keyOf(seg1);
  const st0 = { sid: S, d: start7(seg0[3], S, RS) }, st1 = { sid: S, d: start7(seg1[3], S, RS), shard: 3 };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1]],
    [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1, { sid: S, d: seg1, shard: 4 }]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1, { sid: S, d: seg1, shard: 4 }]]]);
  if (!brk(rs, 5, '[4]')) {
    const r1 = rs[1], r3 = rs[3];
    T('[4] r1: the saved segment settles in the couch lane', /couch settle /.test(r1.out) && procHas(r1, m0), r1.out.split('\n').filter((l) => l.indexOf(m0) >= 0).join('\n').slice(0, 1500));
    const duo = writesTo(r1, LB.duo, S), cou = writesTo(r1, LB.couch, S);
    T('[4] r1: one duo row and one couch row for the account', duo.length === 1 && cou.length === 1, 'duo=' + duo.length + ' couch=' + cou.length);
    const det = duo.length ? detailsOf(duo[0]) : null;
    eq('[4] r1: duo row details = [team bank, build, team block (couch bit) + the account on both seats]', det ? [det[0], (det[2] >>> 24) & 0xff, (det[2] >>> 16) & 0xff, v.teamBlockSids(det)] : null, [1000, 1, 2, [S, S]]);
    T('[4] r1: XP written for the account', writesTo(r1, LB.xp, S).length === 1);
    const hk = Object.keys(((r1.state.SOLO_FILE || {}).hist) || {});
    T('[4] r1: rating history under duoc', hk.some((k) => k.indexOf(v.pid(S) + '|duoc|') === 0) && !hk.some((k) => k.indexOf(v.pid(S) + '|duo|') === 0), JSON.stringify(hk));
    T('[4] r1: the chain is keyed by teamRunKey of the one-account roster', !!((r1.state.SOLO_FILE || {}).runs || {})[v.teamRunKey([S, S], 0, RS)]);
    T('[4] r1: no milestone CP (depth 5 has none anyway) and no cup line; nobody flagged', !/milestone/.test(r1.out.split('\n').filter((l) => l.indexOf(m0) >= 0).join('\n')) && !/weekly best/.test(r1.out) && flaggedOf(r1, S) === 0);
    T('[4] r3: the resumed final segment settles and pays the resume fee once', /couch settle /.test(r3.out) && procHas(r3, m1) && cpOf(r3, S) === 1000 - v.COMP.RESUME_CP,
      'cp=' + cpOf(r3, S) + '\n' + r3.out.split('\n').filter((l) => l.indexOf(m1) >= 0).join('\n').slice(0, 1500));
    T('[4] r3: the duo row moves to depth 7 (team bank 1600)', writesTo(r3, LB.duo, S).length === 1 && (detailsOf(writesTo(r3, LB.duo, S)[0]) || [])[0] === 1600);
    T('[4] r4: nothing settles twice', !/couch settle /.test(rs[4].out) && writesTo(rs[4], LB.duo, S).length === 0 && cpOf(rs[4], S) == null);
  }
}

// ---- [5] split ----
{
  const S = SID(6501), RS = 650100, seg = couchRec(S, 'couch-split', RS, { sd: 0, ed: 5, flags: FLAGS0 | A.SEG_FINAL });
  const st0 = { sid: S, d: start7(seg[3], S, RS) };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]], { COUCH_DUO: 'split' });
  if (!brk(rs, 2, '[5]')) T('[5] split: the couch ladder only (no duo row)', writesTo(rs[1], LB.couch, S).length === 1 && writesTo(rs[1], LB.duo, S).length === 0 && procHas(rs[1], keyOf(seg)),
    'couch=' + writesTo(rs[1], LB.couch, S).length + ' duo=' + writesTo(rs[1], LB.duo, S).length);
}

// ---- [6] trial channel ----
{
  const S = SID(6601), RS = 660100, seg = couchRec(S, 'couch-pt', RS, { sd: 0, ed: 5, flags: FLAGS0 | A.SEG_FINAL });
  const st0 = { sid: S, d: start7(seg[3], S, RS) };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]], { PT_MODE: '1', PT_SHARD_COUNT: '50' });
  if (!brk(rs, 2, '[6]')) T('[6] trial job: not settled, not processed, no couch board touched', /couch segment on the trial channel/.test(rs[1].out) && !procHas(rs[1], keyOf(seg))
    && !rs[1].posts.some((x) => /FindOrCreateLeaderboard/.test(x.url) && /endless_comp_couch|endless_save_box_couch/.test(x.body)) && writesTo(rs[1], LB.couch, S).length === 0,
    rs[1].out.split('\n').filter((l) => /couch/.test(l)).join('\n').slice(0, 1200));
}

// ---- [7] broken signature ----
{
  const S = SID(6701), RS = 670100, seg = couchRec(S, 'couch-bad', RS, { sd: 0, ed: 5, flags: FLAGS0 | A.SEG_FINAL, tamper: 10 });
  const st0 = { sid: S, d: start7(seg[3], S, RS) };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]]);
  if (!brk(rs, 3, '[7]')) T('[7] bad signature: held + warned once, not flagged, not processed, nothing written', /failed its check \(bad-sig\) -- held, not flagged/.test(rs[1].out) && /still fails its check/.test(rs[2].out)
    && flaggedOf(rs[2], S) === 0 && !procHas(rs[2], keyOf(seg)) && writesTo(rs[1], LB.duo, S).length === 0 && writesTo(rs[1], LB.couch, S).length === 0);
  const rf = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]], { COUCH_SIG_FLAG: '1' });
  if (!brk(rf, 2, '[7f]')) T('[7] COUCH_SIG_FLAG=1: judged like a solo segment (flagged, key stays open)', flaggedOf(rf[1], S) === 1 && !procHas(rf[1], keyOf(seg)) && /REJECTED \(bad-sig\)/.test(rf[1].out));
}

// ---- [8] a couch kind this reader does not take ----
{
  const S = SID(6801), RS = 680100, seg = couchRec(S, 'couch-trio', RS, { n: 3, sd: 0, ed: 5, flags: FLAGS0 | A.SEG_FINAL });
  const st0 = { sid: S, d: start7(seg[3], S, RS) };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]]);
  if (!brk(rs, 2, '[8]')) T('[8] three seats: waits (not settled, not processed, nobody flagged)', /couch kind this job does not settle yet/.test(rs[1].out) && !procHas(rs[1], keyOf(seg)) && flaggedOf(rs[1], S) === 0);
}

// ---- [9] wiring pins ----
{
  const pin = (label, s) => T('[9] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('the couch entry is a solo-lane entry (every solo-only exclusion applies)', "      consistentMatches.push({ m, g: couches, void: false, solo: true, couch: true });");
  pin('the couch lane draws from the co-op pool', 'perks.verifyPerkPicks(f, soloState.runs[key], cc ? 2 : 1, PERK_CH)');
  pin('a couch run writes the duo pair while merged and the couch pair always', 'for (const F of (COUCH_DUO_SPLIT ? [couchComp] : [compFam.DUO, couchComp])) {');
  pin('the couch career reads its character block', '{ segmented: true, forced: !cc }');
  const SC = fs.readFileSync(path.join(ROOT, 'seedcap.js'), 'utf8');
  T('[9] seedcap: a couch over-cap convicts nobody until SC_COUCH_CONVICT', SC.indexOf('const obs = obsCore || couchHold;') >= 0 && SC.indexOf('const blamed = obs ? [] : selfOver;') >= 0);
}

try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
