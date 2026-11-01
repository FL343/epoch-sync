'use strict';
// knife C3a (O278, client 2026-11-01): couch CASUAL endless, 2..4 local seats on ONE account. The guard judges (casual line goalBase(d) x N,
//   3 lives, continues from seat 0 only) and signs the same 0xE8 couch record with SEG_CASUAL instead of SEG_COMP (the tail's continues
//   slot = the seat-0 nibble); the solo lane settles it onto the couch casual ladder pair ONLY (endless_board_couch + season twin; never the
//   online casual boards, the composite, the duo / couch competitive pair) with P1's continue-ladder debits, XP for P1, no milestones /
//   cup / rating history. The trial jobs never settle one; a classic couch run / a 3-4 seat competitive run still waits.
//   [1] attest: 3 / 4 seat casual records verify (56 / 59 ints), fields carry N / continues / flags
//   [2] couchSanity casual branch + isCouchRec
//   [3] main(): a 3-seat casual run (checkpoint segment, then the final one with 2 continues) -- couch casual rows (team block = 3 seats +
//       couch bit), XP, P1 pays the continue ladder (20 + 30), no other board written, no rating history, nobody flagged
//   [4] main(): a token resume from the checkpoint (casual: no resume fee; the resumed session's continue count restarts)
//   [5] main(): PT_MODE -> not settled, not processed, no couch casual board created
//   [6] main(): a classic couch run / a 4-seat competitive run -> waits, nobody flagged
//   [7] wiring pins (own pair only; no rating / milestone / cup on the casual couch branch)
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/couch-settle.js (harness copied from it).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH'];
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
const CAS0 = A.SEG_CASUAL | A.SEG_COUCH;
// a guard-signed casual couch segment of sid (attest.js A3 layout; JS reference = client mvp/test/lib/couch-record.js). o: n, seats, disp,
//   roster, sd, ed, conts (tail continues slot), season, flags, tag, keyId, tamper
function couchRec(sid, id, runSeed, o) {
  o = o || {};
  const n = o.n || 3;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (const s of (o.roster || Array(n).fill(sid))) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed == null ? 5 : o.ed, o.conts | 0, 0, o.season | 0, o.flags == null ? CAS0 : o.flags, 0, 0, 0, 0, 0, (o.tag | 0) & A.RESUME_TAG_MASK);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), o.keyId == null ? KEY_ID : o.keyId, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  if (o.tamper != null) d[o.tamper] ^= 1;
  return d;
}

console.log('=== knife C3a couch casual settle ===');

// ---- [1] attest ----
{
  const S = SID(7101);
  const d3 = couchRec(S, 'k1', 4242, { conts: 2 }), d4 = couchRec(S, 'k1', 4242, { n: 4 });
  const r3 = A.verifyCouchRecord(d3, PUBS), r4 = A.verifyCouchRecord(d4, PUBS);
  T('[1] a signed 3-seat casual couch segment verifies', r3.ok && r3.sealed, JSON.stringify(r3));
  T('[1] a signed 4-seat one verifies', r4.ok && r4.sealed, JSON.stringify(r4));
  eq('[1] lengths: 3 seats 56 ints / 4 seats 59 (<= 64)', [d3.length, d4.length], [56, 59]);
  eq('[1] fields: N / seats / team bank / roster / continues / flags', r3.ok ? [r3.fields.N, r3.fields.seats, r3.fields.score, r3.fields.rosterSids, r3.fields.continuesUsed, r3.fields.flags] : null,
    [3, [600, 400, 300], 1300, [S, S, S], 2, CAS0]);
  eq('[1] gate: the account on every seat -> settle', A.couchSettleGate(r4, { owner: S }), { settle: true });
  eq('[1] gate: a stranger on seat 2 -> owner-mismatch', A.couchSettleGate(A.verifyCouchRecord(couchRec(S, 'k1', 4242, { roster: [S, S, SID(7199)] }), PUBS), { owner: S }).reason, 'owner-mismatch');
  eq('[1] a flipped continues slot after signing -> bad-sig', A.verifyCouchRecord(couchRec(S, 'k1', 4242, { conts: 1, tamper: 10 + 3 + 1 + 6 + 2 }), PUBS).reason, 'bad-sig');
}

// ---- [2] sanity + recognition ----
{
  const S = SID(7201);
  const f = (o) => Object.assign(A.verifyCouchRecord(couchRec(S, 's2', 99, o), PUBS).fields || {}, {});
  eq('[2] a clean 3-seat checkpoint segment', v.couchSanity(f()), []);
  eq('[2] a clean 2-seat / 4-seat segment', [v.couchSanity(f({ n: 2 })), v.couchSanity(f({ n: 4 }))], [[], []]);
  eq('[2] final + quit is legal; resumed 5 -> 9 is legal', [v.couchSanity(f({ flags: CAS0 | A.SEG_FINAL, disp: 5 })), v.couchSanity(f({ flags: CAS0 | A.SEG_RESUMED, sd: 5, ed: 9 }))], [[], []]);
  eq('[2] continues: the seat-0 nibble is legal (up to 15)', v.couchSanity(f({ conts: 15 })), []);
  T('[2] continues on seat 1 -> cont (the guard counts every continue on seat 0, P1 pays)', v.couchSanity(f({ conts: 0x10 })).indexOf('cont') >= 0);
  T('[2] suspended -> flags (a casual save is a checkpoint row)', v.couchSanity(f({ flags: CAS0 | A.SEG_SUSPENDED })).indexOf('flags') >= 0);
  T('[2] classic bit -> flags', v.couchSanity(f({ flags: CAS0 | A.SEG_CLASSIC })).indexOf('flags') >= 0);
  T('[2] casual + competitive -> flags (the competitive branch refuses the casual bit)', v.couchSanity(f({ flags: CAS0 | A.SEG_COMP })).indexOf('flags') >= 0);
  T('[2] span past the checkpoint cadence -> span', v.couchSanity(f({ sd: 0, ed: 6 })).indexOf('span') >= 0);
  T('[2] a quit on a segment that is not final -> disp', v.couchSanity(f({ disp: 5 })).indexOf('disp') >= 0);
  const cap3 = v.endlessGoalFor(5, 3) * v.ENDLESS.SCORE_MULT;
  T('[2] per-seat cap = the N-seat line x SCORE_MULT (3 seats): above -> score, at -> clean', v.couchSanity(f({ seats: [cap3 + 1, 0, 0] })).indexOf('score') >= 0 && v.couchSanity(f({ seats: [cap3, 0, 0] })).length === 0);
  T('[2] the competitive branch is unchanged: 3 competitive seats -> pc', v.couchSanity(f({ flags: A.SEG_COMP | A.SEG_COUCH | A.SEG_FINAL })).indexOf('pc') >= 0);
  T('[2] couchCasualSanity exported', typeof v.couchCasualSanity === 'function' && v.couchCasualSanity(f()).length === 0);
  T('[2] isCouchRec: a casual couch segment yes', v.isCouchRec({ d: couchRec(S, 's2', 99) }) && v.isCouchRec({ d: couchRec(S, 's2', 99, { n: 4 }) }));
}

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-casual-settle-' + tag + '-'));
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
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'couch-casual-run-'));
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
// every endless ladder this run might touch, so "nothing else written" is checkable by id
const LB = { xp: 5, cp: 8, duo: 16, couchComp: 18, couchBox: 19, couchCas: 20, couchCasBox: 21, casDuo: 22, casTrio: 23, casQuad: 24, casSolo: 25, casOverall: 26 };
function world(recs, pt) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: LB.duo, name: 'endless_comp_duo', entries: [] },
    { id: LB.casDuo, name: 'endless_board', entries: [] }, { id: LB.casTrio, name: 'endless_board_trio', entries: [] }, { id: LB.casQuad, name: 'endless_board_quad', entries: [] },
    { id: LB.casSolo, name: 'endless_board_solo', entries: [] }, { id: LB.casOverall, name: 'endless_board_overall', entries: [] });
  if (!pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },   // the trial job refuses to run beside these (lock layer 3)
    { id: LB.couchComp, name: 'endless_comp_couch', entries: [] }, { id: LB.couchBox, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: LB.couchCasBox, name: 'endless_save_box_casual_couch', entries: [] });
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
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };   // the guard's single-shape start
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
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
const linesOf = (r, m) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n').slice(0, 1500);
const OTHER_LADDERS = [LB.duo, LB.couchComp, LB.casDuo, LB.casTrio, LB.casQuad, LB.casSolo, LB.casOverall];

// ---- [3] a 3-seat casual run: checkpoint segment, then the final one with 2 continues ----
{
  const S = SID(7301), RS = 730100, id0 = 'cas-run-s0', id1 = 'cas-run-s1';
  const seg0 = couchRec(S, id0, RS, { sd: 0, ed: 5 });
  const seg1 = couchRec(S, id1, RS, { sd: 5, ed: 8, conts: 2, flags: CAS0 | A.SEG_FINAL, disp: 5, seats: [1500, 1200, 900] });
  const m0 = keyOf(seg0), m1 = keyOf(seg1);
  const st0 = { sid: S, d: start7(seg0[3], S, RS) }, st1 = { sid: S, d: start7(seg1[3], S, RS), shard: 3 };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1]],
    [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1, { sid: S, d: seg1, shard: 4 }]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }, st1, { sid: S, d: seg1, shard: 4 }]]]);
  if (!brk(rs, 5, '[3]')) {
    const r1 = rs[1], r3 = rs[3];
    T('[3] r1: the checkpoint segment settles in the couch lane (casual)', /couch settle .* couch pc 3 casual/.test(r1.out) && procHas(r1, m0), linesOf(r1, m0));
    const cas = writesTo(r1, LB.couchCas, S);
    T('[3] r1: one couch casual row for the account', cas.length === 1, 'n=' + cas.length);
    const det = cas.length ? detailsOf(cas[0]) : null;
    eq('[3] r1: details = [team bank, build, team block: 3 seats + couch bit, the account on every seat]', det ? [det[0], (det[2] >>> 24) & 0xff, (det[2] >>> 16) & 0xff, v.teamBlockSids(det)] : null, [1300, 1, 3, [S, S, S]]);
    T('[3] r1: no other endless ladder written (online casual / composite / duo / couch competitive)', OTHER_LADDERS.every((id) => writesTo(r1, id).length === 0),
      OTHER_LADDERS.map((id) => id + ':' + writesTo(r1, id).length).join(' '));
    T('[3] r1: XP written for the account', writesTo(r1, LB.xp, S).length === 1);
    const hk = Object.keys(((r1.state.SOLO_FILE || {}).hist) || {});
    T('[3] r1: no rating history (casual has none)', !hk.some((k) => k.indexOf(v.pid(S) + '|') === 0), JSON.stringify(hk));
    T('[3] r1: the chain is keyed by teamRunKey of the one-account roster', !!((r1.state.SOLO_FILE || {}).runs || {})[v.teamRunKey([S, S, S], 0, RS)]);
    T('[3] r1: no CP move (no continues yet), nobody flagged', cpOf(r1, S) == null && flaggedOf(r1, S) === 0);
    T('[3] r3: the final segment settles; P1 pays the continue ladder 20 + 30', /couch settle .* couch pc 3 casual/.test(r3.out) && procHas(r3, m1) && cpOf(r3, S) === 1000 - 50,
      'cp=' + cpOf(r3, S) + '\n' + linesOf(r3, m1));
    T('[3] r3: the couch casual row moves to depth 8 (team bank 3600)', writesTo(r3, LB.couchCas, S).length === 1 && (detailsOf(writesTo(r3, LB.couchCas, S)[0]) || [])[0] === 3600);
    T('[3] r3: still no other ladder, no milestone / cup line', OTHER_LADDERS.every((id) => writesTo(r3, id).length === 0) && !/milestone|weekly best/.test(linesOf(r3, m1)));
    T('[3] r4: nothing settles twice', !/couch settle /.test(rs[4].out) && writesTo(rs[4], LB.couchCas, S).length === 0 && cpOf(rs[4], S) == null);
  }
}

// ---- [4] token resume from the checkpoint: no resume fee; the resumed session's continue count restarts ----
{
  const S = SID(7401), RS = 740100;
  const seg0 = couchRec(S, 'cas-rs-s0', RS, { n: 2, sd: 0, ed: 5 });
  const seg1 = couchRec(S, 'cas-rs-s1', RS, { n: 2, sd: 5, ed: 6, conts: 0, flags: CAS0 | A.SEG_FINAL });
  const segR = couchRec(S, 'cas-rs-r0', RS, { n: 2, sd: 5, ed: 7, conts: 1, flags: CAS0 | A.SEG_RESUMED | A.SEG_FINAL, tag: 777, seats: [2000, 1600] });
  const st0 = { sid: S, d: start7(seg0[3], S, RS) }, st1 = { sid: S, d: start7(seg1[3], S, RS), shard: 3 }, stR = { sid: S, d: start7(segR[3], S, RS), shard: 6 };
  const base = [st0, { sid: S, d: seg0, shard: 1 }, st1, { sid: S, d: seg1, shard: 4 }];
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg0, shard: 1 }]], [2 * HOUR, base], [2 * HOUR, base.concat([stR])], [2 * HOUR, base.concat([stR, { sid: S, d: segR, shard: 7 }])]]);
  if (!brk(rs, 5, '[4]')) {
    const r4 = rs[4];
    T('[4] the resumed segment settles (casual token resume, no resume fee): P1 pays only its first continue rung (20)', procHas(r4, keyOf(segR)) && cpOf(r4, S) === 1000 - 20,
      'cp=' + cpOf(r4, S) + '\n' + linesOf(r4, keyOf(segR)));
    T('[4] the row moves to depth 7', writesTo(r4, LB.couchCas, S).length === 1);
  }
}

// ---- [5] trial channel ----
{
  const S = SID(7501), RS = 750100, seg = couchRec(S, 'cas-pt', RS, { sd: 0, ed: 5, flags: CAS0 | A.SEG_FINAL });
  const st0 = { sid: S, d: start7(seg[3], S, RS) };
  const rs = timeline([[0, [st0]], [2 * HOUR, [st0, { sid: S, d: seg, shard: 1 }]]], { PT_MODE: '1', PT_SHARD_COUNT: '50' });
  if (!brk(rs, 2, '[5]')) T('[5] trial job: not settled, not processed, no couch casual board touched', /couch segment on the trial channel/.test(rs[1].out) && !procHas(rs[1], keyOf(seg))
    && !rs[1].posts.some((x) => /FindOrCreateLeaderboard/.test(x.url) && /endless_board_couch|endless_save_box_casual_couch/.test(x.body)) && writesTo(rs[1], LB.couchCas, S).length === 0);
}

// ---- [6] couch kinds this reader still does not take ----
{
  const S = SID(7601), RS = 760100;
  const cls = couchRec(S, 'cas-cls', RS, { n: 2, sd: 0, ed: 5, flags: A.SEG_CLASSIC | A.SEG_COUCH | A.SEG_FINAL });
  const comp4 = couchRec(SID(7602), 'cas-c4', RS + 1, { n: 4, sd: 0, ed: 5, flags: A.SEG_COMP | A.SEG_COUCH | A.SEG_FINAL });
  const recs = [{ sid: S, d: start7(cls[3], S, RS) }, { sid: SID(7602), d: start7(comp4[3], SID(7602), RS + 1) }];
  const rs = timeline([[0, recs], [2 * HOUR, recs.concat([{ sid: S, d: cls, shard: 1 }, { sid: SID(7602), d: comp4, shard: 1 }])]]);
  if (!brk(rs, 2, '[6]')) {
    T('[6] a classic couch run waits (not settled, not processed, nobody flagged)', /couch kind this job does not settle yet/.test(linesOf(rs[1], keyOf(cls))) && !procHas(rs[1], keyOf(cls)) && flaggedOf(rs[1], S) === 0);
    T('[6] a 4-seat competitive couch run waits', /couch kind this job does not settle yet/.test(linesOf(rs[1], keyOf(comp4))) && !procHas(rs[1], keyOf(comp4)) && flaggedOf(rs[1], SID(7602)) === 0);
  }
}

// ---- [7] wiring pins ----
{
  const body = SRC.slice(SRC.indexOf('    if (ccCas) {'), SRC.indexOf('    } else if (cc) {'));
  T('[7] the casual couch branch exists before the competitive couch branch', body.length > 200 && SRC.indexOf('    if (ccCas) {') < SRC.indexOf('    } else if (cc) {'));
  T('[7] it writes the couch casual pair only (no duo / online casual / composite)', /couchCas\.changed\[sid\]/.test(body) && /couchCas\.seasonChanged\[sid\]/.test(body)
    && !/compFam|casualLadderOf|couchComp|OVERALL/.test(body));
  T('[7] no rating history / milestones / cup on it', !/ratingHistUpsert|soloMsSlot|soloMilestones|cupWeekPut/.test(body));
  T('[7] the family stays out of compFam / casualLadderOf / the composite', !/compFam\[[^\]]*\]\s*=\s*couchCas|OVERALL_FAMS[^\n]*couchCas/.test(SRC));
  T('[7] the casual couch save box is not season-pruned (casual saves never expire, knife 5.1a)', !/SAVE_BOX_LB_CASUAL_COUCH[^\n]*prune|prune[^\n]*SAVE_BOX_LB_CASUAL_COUCH/i.test(SRC));
}

try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
