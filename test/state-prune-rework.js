'use strict';
// Q144 rework (cloud audit 2026-10, REVIEW of the first draft): three things the first draft left open.
//   1. pruneProcessed drops a key once it was off the shards on two complete reads. A guard-signed solo segment is the one
//      record a modified client cannot make and its owner can write back: once its key was dropped it settled again (its
//      resumed segments while the run's chain memory lives, the whole run once it is gone -- XP again). Now the solo lane
//      remembers every segment it processed after the signature and owner binding verified (endless-solo.json done) and
//      treats a remembered key as processed; an entry goes once no table the job verifies with can verify its key (retired
//      past the grace, revoked), when a written-back segment is held by the key policy instead.
//   2. A key kept on the shards with a fresh roster in every start grew its note's seen-start list by 50 a run for a day
//      (about 478 KB per account; a few accounts writing each other's keys the same). Now one writer holds at most
//      SEEN_PER_WRITER ids across every note; a start past the room counts until the result, is not remembered, and marks
//      the note (n) so the result still closes it.
//   3. `processedN0 = -1` (the run that prunes saves the list whatever it adds): a run that drops as many keys as its own
//      verdicts add and then leaves by the no-consistent-matches exit kept its verdict keys only because of that line.
//   [0] wiring pins
//   [1] pruneSoloDone / soloKeyGone: usable, retired past the grace, revoked, another channel, missing, two tables, fuse
//   [2] screenLateStarts: the room per writer across the notes, the n mark closes the note at the result, an outside
//       writer spends only his own room, remembered ids are not counted twice
//   [3] main(), signed segments (a copy of this tree with a test key): the owner's five segments settle once; forged
//       segments push the processed list past a small cap and the owner's keys go from it; written back they settle
//       nothing (also once the run's chain memory expired) and are counted; the forged keys are still dropped; once the
//       key is retired past the grace the remembered segments are forgotten and a written-back one is held, not settled
//   [4] main(): the pruning run that adds as many verdict keys as it drops, then the no-consistent-matches exit: the
//       verdict keys reach processed.json and nobody is judged twice
//   [5] main(): one key, a fresh roster per start; four accounts writing each other's keys: each account stops at the
//       room; an honest 1V1 in the same runs settles once
//   [6] main(): a loser past his room whose start was read before the result leaves: run by run the same verdict as a
//       loser whose start is remembered (his start left out as late opens no way out)
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/state-prune.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'PROCESSED_CAP', 'PROCESSED_KEEP', 'PROCESSED_PRUNE_WAIT_MS',
  'ENDLESS_PENDING_TTL_MS', 'COMP_RUN_TTL_MS', 'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'SOLO_DONE_CAP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
process.env.SOLO_DONE_CAP = '4';   // the fuse in [1] (this process only; the child runs below use the default)
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
// the per-channel key policy (cloud audit R1-A5-07: a key retired past its grace / revoked stops verifying) is not on every
//   path this rework is cut for (the Q43 chain lacks it): there no key stops verifying, and the done memory only shrinks by its fuse
const KP = typeof v.loadJobPubTable === 'function';
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); T(label + ' = ' + a, a === b, 'EXPECT ' + b); };

// ---- a copy of this tree with one test signing key (the guard-signed solo lane needs a key the job verifies) ----
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'state-prune-rw-tree-'));
// Q225: not the .mutant-*.js files other tests write into the root and delete while the suite runs 4 at a time, nor an
//   entry gone between the listing and its copy (test/root-listing.js)
require('./root-listing').copyRootTree(ROOT, TREE, ['.git', 'test', 'node_modules']);
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function keypair(seedHex) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
  return { priv, pub };
}
const KEY = keypair('4d'.repeat(32)), KEY_ID = 2099020101;
const KF = path.join(TREE, 'attest-keys.json');
const KF0 = fs.readFileSync(KF, 'utf8');
function setTestKey(info) {
  const j = JSON.parse(KF0);
  j.keys[String(KEY_ID)] = Object.assign({ pubs: [KEY.pub], sealed: true, at: '2026-10-01T00:00:00.000Z' }, info ? { pubInfo: { [KEY.pub]: info } } : {});
  fs.writeFileSync(KF, JSON.stringify(j, null, 2));
}
setTestKey(null);   // sealed, unlabeled: accepted on every channel (applyKeyPolicy)
const VALIDATE = path.join(TREE, 'validate.js');
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}');",
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
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-prune-rw-'));
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
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z', RECOVER_FILE: path.join(dir, 'no-recover.json'),
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
  }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SC = { 1: [6100], 2: [6100, 3900] };
function rec(magic, mt, hash, seat, rank, win, ros, disp) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : SC[pc][i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const settle1v1 = (hash, seat, ros) => rec(0xB1, 2, hash, seat, 1 + seat, seat === 0, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// guard-signed solo segment, attVer 3 layout (attest.js LAYOUTS[3]): 25-int base, 16 sig ints
function seg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed | 0, 0, 1, 0, 1, o.dur || 900, o.score || 1000, o.disp | 0, lo, hi, o.sd | 0, o.ed | 0,
    0, 0, o.season | 0, o.flags | 0, KEY_ID, 3, 0, 0, 0];
  if (o.att) { b[21] = o.att; b.push((o.build | 0), 0, 0); if (o.att >= 5) b.push(o.rrLo | 0, o.rrHi | 0); }   // attVer 4: build / pick log @25..27; 5: + reroll bitmap @28/29
  const sig = o.forge ? Buffer.alloc(64, 7) : crypto.sign(null, A.toBytes(b), KEY.priv);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
function boardsWith(recs, pts) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) {
    if (r.shard != null) { boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); continue; }
    used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d });
  }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: (pts || []).map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 21, name: 'endless_comp_solo', entries: [] }, { id: 22, name: 'endless_board_solo', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?, before?], ...]; before() runs ahead of that step (the key table edit in [3])
function timeline(steps, files0, pts) {
  const out = []; let state = null;
  for (const [ms, recs, env, before] of steps) {
    if (before) before();
    const r = runCron(boardsWith(recs, pts), state ? advance(state, ms) : (files0 || null), env || null);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const brk = (rs, n, tag) => { if (allOk(rs, n)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };
const ptsPosts = (rs, sid) => [].concat(...rs.map((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && /leaderboardid=7(&|$)/.test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body))));
const seenPer = (r) => { const c = {}; for (const [k, e] of Object.entries(r.state.STARTS_FILE || {})) if (k.charAt(0) === '~' && e && Array.isArray(e.s)) for (const x of e.s) { const w = x.split('@')[0]; c[w] = (c[w] | 0) + 1; } return c; };

console.log('=== Q144 rework: signed solo segments written back, the remembered-start room, the pruning run\'s verdict keys ===');

// ---- [0] wiring pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('the solo lane checks the done memory first', "    if (soloState.done && soloState.done[m]) {\n      processed.add(m); RUN.soloReplay = (RUN.soloReplay | 0) + 1;");
  if (KP) pin('the done memory is pruned with both tables the lane verifies with', 'const soloDonePruned = pruneSoloDone(soloState, [soloPub, soloPubRec]);');
  else pin('the done memory is pruned with the table the lane verifies with (no per-channel key policy on this path)', 'const soloDonePruned = pruneSoloDone(soloState, [soloPub]);');
  pin('soloDone = processed + remembered, after the signature verified', '    const f = v.fields;\n    const soloDone = () => { processed.add(m); soloDoneNote(soloState, m, f.keyName, nowMs); };');
  const a = SRC.indexOf('    const soloDone = () => {'), b = SRC.indexOf('  for (const c of fresh) {', a);
  const body = SRC.slice(a, b);
  T('[0] every processed.add after the signature is soloDone (five: chain, reroll, perk, seedcap window, settle)', (body.match(/soloDone\(\);/g) || []).length === 5 && !/processed\.add\(m\)/.test(body.replace('processed.add(m); soloDoneNote', '')), (body.match(/soloDone\(\);/g) || []).length + ' soloDone() calls');
  pin('the room per writer', "      if ((perW[w] | 0) >= SEEN_PER_WRITER) { e.n = 1; over.add(w); continue; }");
  pin('the n mark closes the note at the result', "settled.has(m) && (e.s.length || e.n) && !(pending[m] && pending[m].prov)) e.r = now;");
  pin('the pruning run saves the list whatever it adds', '    processedN0 = -1;');
  pin('summary row (done / replay)', "'| signed solo segments remembered while their key verifies / written back after they left the processed list (Q144) | ' + s('soloDone', 0) + ' / ' + s('soloReplay', 0) + ' |',");
  pin('summary row (room)', "'| accounts whose remembered starts across the notes are at the room (Q144) | ' + s('seenCapped', 0) + ' |',");
  eq('[0] SEEN_PER_WRITER / SOLO_DONE_CAP default', [/const SEEN_PER_WRITER = 64;/.test(SRC), /const SOLO_DONE_CAP = Number\(process\.env\.SOLO_DONE_CAP \|\| 200000\);/.test(SRC)], [true, true]);
}

// ---- [1] pruneSoloDone / soloKeyGone ----
{
  const tbl = (ent) => ({ k1: ent });
  const usable = { pubs: ['aa'], held: [] }, retired = { pubs: [], held: [{ pub: 'aa', reason: 'retired' }] }, revoked = { pubs: [], held: [{ pub: 'aa', reason: 'revoked' }] };
  const chan = { pubs: [], held: [{ pub: 'aa', reason: 'channel' }] }, mixed = { pubs: [], held: [{ pub: 'aa', reason: 'retired' }, { pub: 'bb', reason: 'channel' }] };
  eq('[1] usable key -> kept', v.soloKeyGone('k1', [tbl(usable)]), false);
  eq('[1] retired past the grace -> gone', v.soloKeyGone('k1', [tbl(retired)]), true);
  eq('[1] revoked -> gone', v.soloKeyGone('k1', [tbl(revoked)]), true);
  eq('[1] held for another channel -> kept (a label slip a table fix undoes)', v.soloKeyGone('k1', [tbl(chan)]), false);
  eq('[1] one pub retired, one held for another channel -> kept', v.soloKeyGone('k1', [tbl(mixed)]), false);
  eq('[1] one pub usable, an older one retired -> kept', v.soloKeyGone('k1', [tbl({ pubs: ['bb'], held: [{ pub: 'aa', reason: 'retired' }] })]), false);
  eq('[1] missing from the table (a lost push) -> kept', v.soloKeyGone('k2', [tbl(retired)]), false);
  eq('[1] no table at all -> kept', [v.soloKeyGone('k1', []), v.soloKeyGone('k1', [{}])], [false, false]);
  eq('[1] retired in the job table, usable in the recovery table -> kept', v.soloKeyGone('k1', [tbl(retired), tbl(usable)]), false);
  eq('[1] retired in both tables -> gone', v.soloKeyGone('k1', [tbl(retired), tbl(revoked)]), true);
  const st = { done: { a: ['k1', 10], b: ['k2', 11], c: ['k1', 12], d: ['dev', 13] } };
  eq('[1] pruneSoloDone drops the entries of a gone key only', [v.pruneSoloDone(st, [{ k1: retired, k2: usable, dev: { pubs: ['dd'], sealed: false } }]), Object.keys(st.done).sort()], [{ gone: 2, fuse: 0 }, ['b', 'd']]);
  eq('[1] no done map -> nothing', v.pruneSoloDone({}, [tbl(retired)]), { gone: 0, fuse: 0 });
  const big = { done: {} };
  for (let i = 0; i < 7; i++) big.done['m' + i] = ['k2', 100 - i];   // m6 the oldest
  const r = v.pruneSoloDone(big, [{ k2: usable }]);
  eq('[1] past the fuse (4 here) the oldest go', [r, Object.keys(big.done).sort()], [{ gone: 0, fuse: 3 }, ['m0', 'm1', 'm2', 'm3']]);
  eq('[1] soloDoneNote = [key name, seconds]', (() => { const s = {}; v.soloDoneNote(s, 'x', 2026100901, 5000); return s; })(), { done: { x: ['2026100901', 5] } });
}

// ---- [2] screenLateStarts: the room per writer ----
{
  // rows as screenLateStarts reads them: the writer is the account on the record's own seat
  const sr = (mt, hash, seat, ros) => ({ steamID: ros[seat], d: start(mt, hash, seat, ros) });
  const ss = (hash, seat, ros) => ({ steamID: ros[seat], d: settle1v1(hash, seat, ros) });
  const W = SID(611), O = SID(612), H = SID(613);
  const pend = {};
  // W already holds 64 ids across 64 notes
  for (let i = 0; i < 64; i++) pend['~' + (300000 + i) + '_1234_2'] = { t0: 1, s: [v.pid(W) + '@0#s' + i], r: 0, c: 0 };
  const k1 = sr(2, 0x6100, 0, [W, H]), k1h = sr(2, 0x6100, 1, [W, H]);
  const starts = [k1, k1h];
  const late = v.screenLateStarts(starts, [], pend, new Set(), 1000, true);
  const e = pend['~' + keyOf(k1.d)];
  eq('[2] W at the room: his new start counts this run (not late), is not remembered, marks the note; H\'s is remembered', [late, starts.length, e.s.length, e.s[0].split('@')[0] === v.pid(H), e.n], [0, 2, 1, true, 1]);
  // the result read next run: the note closes; W's start (never remembered) is now late, H's is not
  const s2 = [k1, k1h];
  const l2 = v.screenLateStarts(s2, [ss(0x6100, 1, [W, H])], pend, new Set(), 2000, true);
  eq('[2] at the result the note closes; W\'s start read after it is late, H\'s remembered one is not', [l2, s2.length, s2[0] === k1h, e.r], [1, 1, true, 2000]);
  // only W's start was seen before the result (H wrote none): without the n mark the note would never close
  const pend2 = {};
  for (let i = 0; i < 64; i++) pend2['~' + (310000 + i) + '_1234_2'] = { t0: 1, s: [v.pid(W) + '@0#s' + i], r: 0, c: 0 };
  const k2 = sr(2, 0x6200, 0, [W, H]);
  v.screenLateStarts([k2], [], pend2, new Set(), 1000, true);
  const e2 = pend2['~' + keyOf(k2.d)];
  eq('[2] only the over-room start seen: no id remembered, the note is marked', [e2.s.length, e2.n], [0, 1]);
  const k2b = sr(2, 0x6200, 0, [W, O]);   // W, after the result, a start naming another roster
  const s3 = [k2b];
  const l3 = v.screenLateStarts(s3, [ss(0x6200, 1, [W, H])], pend2, new Set(), 3000, true);
  eq('[2] ... the result still closes the note: W\'s start written after it is late', [l3, s3.length, e2.r], [1, 0, 3000]);
  // an outside writer O fills a note of H's key: O's ids count against O's room only
  const pend3 = {};
  for (let i = 0; i < 64; i++) pend3['~' + (320000 + i) + '_1234_2'] = { t0: 1, s: [v.pid(O) + '@0#s' + i], r: 0, c: 0 };
  const hk = sr(2, 0x6300, 0, [H, SID(614)]), ok_ = sr(2, 0x6300, 0, [O, SID(615)]);
  v.screenLateStarts([ok_, hk], [], pend3, new Set(), 1000, true);
  const e3 = pend3['~' + keyOf(hk.d)];
  eq('[2] an outside writer at his room does not take H\'s: H\'s start is remembered, O\'s is not', [e3.s.length, e3.s[0].split('@')[0] === v.pid(H), e3.n], [1, true, 1]);
  // a remembered id read again is not counted twice; an account under the room keeps adding
  const pend4 = {};
  for (let i = 0; i < 63; i++) pend4['~' + (330000 + i) + '_1234_2'] = { t0: 1, s: [v.pid(W) + '@0#s' + i], r: 0, c: 0 };
  const a1 = sr(2, 0x6400, 0, [W, H]), a2 = sr(2, 0x6401, 0, [W, H]);
  v.screenLateStarts([a1, a2], [], pend4, new Set(), 1000, true);
  v.screenLateStarts([a1, a2], [], pend4, new Set(), 2000, true);
  eq('[2] at 63 one more fits, the next does not; read again nothing changes', [pend4['~' + keyOf(a1.d)].s.length, pend4['~' + keyOf(a2.d)].s.length, pend4['~' + keyOf(a2.d)].n | 0], [1, 0, 1]);
  // a prune candidate (no s list) counts nothing
  const pend5 = { [v.PRUNE_NOTE]: { t0: 1, n: 3, a: 'x', b: 'y', v: [] } };
  const a5 = sr(2, 0x6500, 0, [W, H]);
  v.screenLateStarts([a5], [], pend5, new Set(), 1000, true);
  eq('[2] the processed-prune candidate is no note', pend5['~' + keyOf(a5.d)].s.length, 1);
}

// ---- [3] main(): guard-signed segments written back after their keys left the processed list ----
{
  const P = SID(621), Zf = SID(622);
  const S_ = A.SEG_SUSPENDED, R_ = A.SEG_RESUMED, C_ = A.SEG_CASUAL, F_ = A.SEG_FINAL;
  const segs = {
    A: { sid: P, id: 'rw-run1-a', runSeed: 101, sd: 0, ed: 5, flags: S_ },
    B: { sid: P, id: 'rw-run1-b', runSeed: 101, sd: 5, ed: 9, flags: R_ },
    C0: { sid: P, id: 'rw-run2-c0', runSeed: 202, sd: 0, ed: 5, flags: C_ },
    C1: { sid: P, id: 'rw-run2-c1', runSeed: 202, sd: 5, ed: 7, flags: C_ | F_, disp: 5 },
    C2: { sid: P, id: 'rw-run2-c2', runSeed: 202, sd: 5, ed: 10, flags: C_ | R_ },
  };
  const D = {}; for (const n of Object.keys(segs)) D[n] = seg(segs[n]);
  const K = (n) => keyOf(D[n]);
  const row = (n, shard) => ({ sid: P, d: D[n], shard });
  const back = () => [row('B', 2), row('C2', 4), row('A', 0), row('C0', 1)];
  for (const [tag, runTtl] of [['chain memory alive', 0], ['chain memory expired', HOUR]]) {
    let fz = 0;
    const forged = () => Array.from({ length: 50 }, () => ({ sid: Zf, d: seg({ sid: Zf, id: 'rw-forge-' + tag + (++fz), runSeed: 999, sd: 0, ed: 1, forge: true }) }));
    const CAP = Object.assign({ PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR) }, runTtl ? { COMP_RUN_TTL_MS: String(runTtl) } : {});
    const pace = runTtl ? 5 * MIN : HOUR;
    const all = [row('A', 0), row('C0', 1), row('B', 2), row('C1', 3), row('C2', 4)];
    const steps = [
      [0, [row('A', 0), row('C0', 1)], CAP], [pace, [row('A', 0), row('C0', 1)], CAP],
      [pace, all.slice(0, 4), CAP], [pace, all.slice(0, 4), CAP], [pace, all, CAP], [pace, all, CAP],
      [HOUR, forged(), CAP], [HOUR, forged(), CAP], [HOUR, forged(), CAP], [HOUR, forged(), CAP],
      [runTtl ? 2 * runTtl : HOUR, back(), CAP], [HOUR, back(), CAP], [HOUR, back(), CAP],
    ];
    const rs = timeline(steps);
    if (brk(rs, steps.length, '[3] ' + tag)) continue;
    const settles = (from, to) => [].concat(...rs.slice(from, to).map((r) => r.out.split('\n').filter((l) => /solo settle /.test(l))));
    const first = settles(0, 6);
    T('[3] ' + tag + ': the owner\'s five segments settle once each', ['A', 'B', 'C0', 'C1', 'C2'].every((n) => first.filter((l) => l.indexOf('solo settle ' + K(n)) >= 0).length === 1), first.length + ' settle lines');
    const gone = ['A', 'B', 'C0', 'C1', 'C2'].filter((n) => (rs[9].state.PROCESSED_FILE || []).indexOf(K(n)) < 0);
    T('[3] ' + tag + ': the forged flood pushed the owner\'s keys out of the processed list (the case the rework covers)', gone.length === 5, 'gone: ' + gone.join(','));
    T('[3] ' + tag + ': the done memory holds the five', ['A', 'B', 'C0', 'C1', 'C2'].every((n) => ((rs[9].state.SOLO_FILE || {}).done || {})[K(n)]), JSON.stringify(Object.keys((rs[9].state.SOLO_FILE || {}).done || {}).length));
    const again = settles(10, 13);
    T('[3] ' + tag + ': written back, none of them settles again', again.length === 0, again.join(' | '));
    const xpAgain = [].concat(...rs.slice(10).map((r) => r.out.match(/xp-endless [^\n]*/g) || []));
    T('[3] ' + tag + ': no XP a second time', xpAgain.length === 0, xpAgain.join(' | '));
    T('[3] ' + tag + ': each written-back segment is logged once and is back in the processed list', ['A', 'B', 'C0', 'C2'].every((n) => rs[10].out.indexOf('solo ' + K(n) + ': ') >= 0 && rs[10].out.indexOf('processed before (key ' + KEY_ID + ')') >= 0 && (rs[12].state.PROCESSED_FILE || []).indexOf(K(n)) >= 0)
      && rs.slice(11).every((r) => !/processed before \(key/.test(r.out)));
    T('[3] ' + tag + ': summary row counts the four written back', rs[10].summary.indexOf(' (Q144) | 5 / 4 |') >= 0, (rs[10].summary.match(/signed solo segments[^\n]*/) || [''])[0]);
    T('[3] ' + tag + ': no flag, no signal for the owner\'s own records written back', !((rs[12].state.SIGNALS_FILE || {}).flagged || {})[K('B')] && rs.slice(10).every((r) => !/REJECT/.test(r.out.split('\n').filter((l) => l.indexOf(K('A')) >= 0 || l.indexOf(K('B')) >= 0).join('\n'))));
    const procN = rs.map((r) => (r.state.PROCESSED_FILE || []).length);
    T('[3] ' + tag + ': the forged keys are still dropped past the cap (armed on one read, dropped on the next an hour on)', Math.max(...procN.slice(6, 10)) > 60 && procN[9] < procN[8] && procN[11] <= 60, JSON.stringify(procN));
  }
  // the key retired past the grace: the remembered segments are forgotten, a written-back one is held (pending), never settled
  {
    let fz = 0;
    const forged = () => Array.from({ length: 50 }, () => ({ sid: Zf, d: seg({ sid: Zf, id: 'rw-forge-ret' + (++fz), runSeed: 998, sd: 0, ed: 1, forge: true }) }));
    const CAP = { PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR) };
    const all = [row('A', 0), row('C0', 1), row('B', 2), row('C1', 3), row('C2', 4)];
    const iso = (ms) => new Date(Date.now() + ms).toISOString();
    const filler = () => forged().slice(0, 1);   // a fresh key: a run without one stops at 'no fresh matches' before the solo lane
    const steps = [
      [0, [row('A', 0), row('C0', 1)], CAP, () => setTestKey({ ch: 'ea' })], [HOUR, [row('A', 0), row('C0', 1)], CAP],
      [HOUR, all.slice(0, 4), CAP], [HOUR, all.slice(0, 4), CAP], [HOUR, all, CAP], [HOUR, all, CAP],
      [HOUR, forged(), CAP], [HOUR, forged(), CAP], [HOUR, forged(), CAP], [HOUR, forged(), CAP],
      [HOUR, filler(), CAP, () => setTestKey({ ch: 'ea', retiredAt: iso(-6 * 86400000) })],   // retired 6 days ago: inside the grace
      [HOUR, filler(), CAP, () => setTestKey({ ch: 'ea', retiredAt: iso(-8 * 86400000) })],   // 8 days ago: past it
      [HOUR, back(), CAP], [HOUR, back(), CAP],
    ];
    const rs = timeline(steps);
    try { if (!brk(rs, steps.length, '[3] retired key')) {
      const doneN = rs.map((r) => Object.keys((r.state.SOLO_FILE || {}).done || {}).length);
      const again = [].concat(...rs.slice(12).map((r) => r.out.split('\n').filter((l) => /solo settle /.test(l))));
      if (KP) {
        T('[3] retired key: inside the grace the five stay, past it they are forgotten (logged)', doneN[10] === 5 && doneN[11] === 0 && /5 processed segment\(s\) forgotten, their key verifies no more/.test(rs[11].out), JSON.stringify(doneN));
        const held = rs[12].out.split('\n').filter((l) => /pending \(key-retired\)/.test(l));
        T('[3] retired key: written back they are held by the key policy (pending), none settles, none is processed', again.length === 0 && held.length === 4
          && ['A', 'B', 'C0', 'C2'].every((n) => (rs[13].state.PROCESSED_FILE || []).indexOf(K(n)) < 0), again.length + ' settles, ' + held.length + ' held');
      } else {
        // no key policy on this path: the retire label is not read, the key verifies, the five stay remembered
        T('[3] retired label, no key policy: the five stay remembered', doneN[11] === 5 && doneN[13] === 5 && !/forgotten, their key verifies no more/.test(rs[11].out), JSON.stringify(doneN));
        T('[3] retired label, no key policy: written back, none settles (remembered)', again.length === 0 && (rs[12].out.match(/processed before \(key/g) || []).length === 4, again.length + ' settles');
      }
    } } finally { setTestKey(null); }
  }
}

// ---- [3b] main(): a REJECTED signed segment is remembered too -- the verdict it got can change once its run's chain memory
//      is gone (45 days), and a seedcap window ends ----
{
  const S_ = A.SEG_SUSPENDED;
  const flood = (tag) => { let fz = 0; return () => Array.from({ length: 50 }, () => ({ sid: SID(659), d: seg({ sid: SID(659), id: 'rw-fl-' + tag + (++fz), runSeed: 997, sd: 0, ed: 1, forge: true }) })); };
  function timelineMut(steps, files0) {
    const out = []; let state = null;
    for (const [ms, recs, env, mut] of steps) {
      let files = state ? advance(state, ms) : (files0 || {});
      if (mut) files = mut(files);
      const r = runCron(boardsWith(recs), files, env || null);
      out.push(r); state = r.state;
      if (r.code !== 0) break;
    }
    return out;
  }
  // a second depth-0 segment on a run: chain REJECT (restart); written back after the flood and the run's chain memory
  //   expired, the same segment met no run any more -- it settled as a new run
  {
    const Q = SID(651);
    const s0 = seg({ sid: Q, id: 'rw-rst-a', runSeed: 303, sd: 0, ed: 5, flags: S_ }), s0b = seg({ sid: Q, id: 'rw-rst-b', runSeed: 303, sd: 0, ed: 5, flags: S_ });
    const r0 = { sid: Q, d: s0, shard: 0 }, r0b = { sid: Q, d: s0b, shard: 1 };
    const fl = flood('rst');
    const CAP = { PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR), COMP_RUN_TTL_MS: String(HOUR) };
    const steps = [
      [0, [r0], CAP], [5 * MIN, [r0, r0b], CAP],
      [5 * MIN, fl(), CAP], [5 * MIN, fl(), CAP], [HOUR, fl(), CAP], [HOUR, fl(), CAP],
      [3 * HOUR, [r0b], CAP], [HOUR, [r0b], CAP],
    ];
    const rs = timelineMut(steps);
    if (!brk(rs, steps.length, '[3b] restart')) {
      T('[3b] restart: the first segment settles, the second depth-0 one is a chain REJECT', /chain REJECT \(restart\)/.test(rs[1].out) && /solo settle /.test(rs[0].out + rs[1].out), rs.slice(0, 2).map((r) => (r.out.match(/[^\n]*solo [^\n]*/g) || []).join(' / ')).join(' || '));
      T('[3b] restart: the flood pushed its key out of the processed list', (rs[5].state.PROCESSED_FILE || []).indexOf(keyOf(s0b)) < 0 && ((rs[5].state.SOLO_FILE || {}).done || {})[keyOf(s0b)], '');
      const again = [].concat(...rs.slice(6).map((r) => r.out.split('\n').filter((l) => /solo settle /.test(l))));
      T('[3b] restart: written back once its run is forgotten, it does not settle as a new run', again.length === 0 && /processed before \(key/.test(rs[6].out), again.join(' | '));
    }
  }
  // inside a seedcap reject window the segment's own settlement is discarded; written back after the window (and its run's
  //   chain memory), it settled
  {
    const Q = SID(655), nowMin = Math.floor(Date.now() / 60000);
    const w0 = seg({ sid: Q, id: 'rw-sc-a', runSeed: 404, sd: 0, ed: 5, flags: S_ });
    const r0 = { sid: Q, d: w0, shard: 0 };
    const fl = flood('sc');
    const CAP = { PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR), COMP_RUN_TTL_MS: String(HOUR), SEEDCAP_REJECT: '1' };
    const sc = (t1) => (f) => Object.assign(f, { SC_STATE_FILE: { suspects: { [v.pid(Q)]: { n: 1, t1 } } } });
    const steps = [
      [0, [r0], CAP, sc(nowMin)],
      [5 * MIN, fl(), CAP], [5 * MIN, fl(), CAP], [HOUR, fl(), CAP], [HOUR, fl(), CAP],
      [3 * HOUR, [r0], CAP, sc(nowMin - 3 * 1440)], [HOUR, [r0], CAP, sc(nowMin - 3 * 1440)],
    ];
    const rs = timelineMut(steps);
    if (!brk(rs, steps.length, '[3b] seedcap window')) {
      T('[3b] seedcap window: inside it the segment is discarded', /inside seedcap reject window -- own settlement discarded/.test(rs[0].out) && !/solo settle /.test(rs[0].out), '');
      T('[3b] seedcap window: the flood pushed its key out of the processed list', (rs[4].state.PROCESSED_FILE || []).indexOf(keyOf(w0)) < 0 && ((rs[4].state.SOLO_FILE || {}).done || {})[keyOf(w0)], '');
      const again = [].concat(...rs.slice(5).map((r) => r.out.split('\n').filter((l) => /solo settle /.test(l))));
      T('[3b] seedcap window: written back after the window, it does not settle', again.length === 0 && /processed before \(key/.test(rs[5].out), again.join(' | '));
    }
  }
}

// ---- [3c] main(): a perk / reroll REJECT written back after the flood is judged once (no second REJECT, no second count) ----
{
  const S_ = A.SEG_SUSPENDED;
  let fz = 0;
  const fl = () => Array.from({ length: 50 }, () => ({ sid: SID(669), d: seg({ sid: SID(669), id: 'rw-fl-pr' + (++fz), runSeed: 996, sd: 0, ed: 1, forge: true }) }));
  const pk = seg({ sid: SID(661), id: 'rw-perk-a', runSeed: 505, sd: 0, ed: 5, flags: S_, att: 4, build: 1 });   // a build word with no pick log: perk_forge
  const rr = seg({ sid: SID(662), id: 'rw-rr-a', runSeed: 606, sd: 0, ed: 5, flags: S_, att: 5, rrHi: 1 << 30 });   // a reroll bit far past the depth: reroll-ahead
  const both = () => [{ sid: SID(661), d: pk, shard: 0 }, { sid: SID(662), d: rr, shard: 1 }];
  const CAP = { PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR) };
  const steps = [[0, both(), CAP], [5 * MIN, fl(), CAP], [5 * MIN, fl(), CAP], [HOUR, fl(), CAP], [HOUR, fl(), CAP], [HOUR, both(), CAP]];
  const rs = timeline(steps);
  if (!brk(rs, steps.length, '[3c] perk / reroll')) {
    T('[3c] perk / reroll: both are rejected once', /perk REJECT/.test(rs[0].out) && /reroll chain REJECT/.test(rs[0].out), (rs[0].out.match(/[^\n]*REJECT[^\n]*/g) || []).join(' | '));
    T('[3c] perk / reroll: the flood pushed both keys out of the processed list', [pk, rr].every((d) => (rs[4].state.PROCESSED_FILE || []).indexOf(keyOf(d)) < 0 && ((rs[4].state.SOLO_FILE || {}).done || {})[keyOf(d)]), '');
    T('[3c] perk / reroll: written back, neither is judged again', !/REJECT/.test(rs[5].out) && (rs[5].out.match(/processed before \(key/g) || []).length === 2, (rs[5].out.match(/[^\n]*(REJECT|processed before)[^\n]*/g) || []).join(' | '));
  }
}

// ---- [4] main(): the pruning run adds as many verdict keys as it drops (processedN0 = -1) ----
{
  const now = Date.now();
  const ps = [SID(641), SID(642), SID(643), SID(644), SID(645), SID(646)];
  const st0 = {}, recs = [], keys = [];
  for (let i = 0; i < 3; i++) {
    const a = ps[2 * i], b = ps[2 * i + 1], M = 0x7E40 + i;
    const s0 = start(2, M, 0, [a, b]), s1 = start(2, M, 1, [a, b]);
    keys.push(keyOf(s0));
    st0[keyOf(s0)] = { t0: now - 90 * MIN, mt: 2, roster: { 0: v.pid(a), 1: v.pid(b) }, settled: [], started: [v.pid(a), v.pid(b)] };
    st0['~' + keyOf(s0)] = { t0: now - 90 * MIN, s: [], r: 0, c: 0 };
    recs.push({ sid: a, d: s0, shard: 20 + i }, { sid: b, d: s1, shard: 20 + i });
  }
  const proc0 = Array.from({ length: 51 }, (_, i) => (910000 + i) + '_1234_2');
  const CAP = { PROCESSED_CAP: '50', PROCESSED_KEEP: '48', PROCESSED_PRUNE_WAIT_MS: String(HOUR) };
  const rs = timeline([[0, recs, CAP], [HOUR, recs, CAP], [5 * MIN, recs, CAP], [2 * HOUR + 5 * MIN, recs, CAP], [5 * MIN, recs, CAP]], { STARTS_FILE: st0, PROCESSED_FILE: proc0 }, ps);
  if (!brk(rs, 5, '[4]')) {
    const procN = rs.map((r) => (r.state.PROCESSED_FILE || []).length);
    const lost = keys.filter((k) => (rs[1].state.PROCESSED_FILE || []).indexOf(k) < 0);
    const hits = rs.map((r) => Number((/\nstarts: [^\n]*?([0-9]+) exit-rate hits/.exec('\n' + r.out) || [])[1] || 0));
    const pts = ps.map((sid) => ptsPosts(rs, sid).length);
    T('[4] the pruning run drops 3 and its 3 verdicts add 3 (the case)', /processed: 3 oldest key\(s\)/.test(rs[1].out) && hits[1] === 6, 'hits ' + JSON.stringify(hits) + ', processed ' + JSON.stringify(procN));
    T('[4] its verdict keys reach processed.json', lost.length === 0 && procN[1] === 51, lost.length + ' missing, sizes ' + JSON.stringify(procN));
    T('[4] nobody is judged twice', hits.reduce((x, y) => x + y, 0) === 6 && pts.every((n) => n <= 1), 'hits ' + JSON.stringify(hits) + ' points writes ' + JSON.stringify(pts));
  }
}

// ---- [5] main(): one key with a fresh roster per start, four accounts writing each other's keys; an honest 1V1 beside ----
{
  const X = SID(651), H1 = SID(652), H2 = SID(653);
  const K1 = 0x51C0001;
  let r0 = 40000;
  const HM = 0x7E50, HS = [start(2, HM, 0, [H1, H2]), start(2, HM, 1, [H1, H2])], HR = [settle1v1(HM, 0, [H1, H2]), settle1v1(HM, 1, [H1, H2])];
  const honest = (res) => [{ sid: H1, d: HS[0], shard: 48 }, { sid: H2, d: HS[1], shard: 48 }].concat(res ? [{ sid: H1, d: HR[0], shard: 49 }, { sid: H2, d: HR[1], shard: 49 }] : []);
  const fresh = () => Array.from({ length: 40 }, () => ({ sid: X, d: start(2, K1, 0, [X, SID(++r0)]) }));
  const steps = [[0, fresh().concat(honest(false))], [5 * MIN, fresh().concat(honest(false))]];
  for (let i = 0; i < 3; i++) steps.push([20 * MIN, fresh().concat(honest(true))]);
  const rs = timeline(steps, null, [H1, H2]);
  if (!brk(rs, 5, '[5] one key')) {
    const n = rs.map((r) => (((r.state.STARTS_FILE || {})['~' + K1 + '_1234_2'] || {}).s || []).length);
    T('[5] one key, a fresh roster per start: the note stops at the room', n[1] === 64 && n[4] === 64, JSON.stringify(n));
    T('[5] ... the room is logged and counted', /start-seen-room: 1 account\(s\) hold 64 remembered starts/.test(rs[2].out) && rs[2].summary.indexOf('at the room (Q144) | 1 |') >= 0);
    T('[5] ... the honest 1V1 beside settles once', ptsPosts(rs, H1).length === 1 && ptsPosts(rs, H2).length === 1, ptsPosts(rs, H1).length + '/' + ptsPosts(rs, H2).length);
  }
  const W = [SID(661), SID(662), SID(663), SID(664)];
  const K0 = 0x51D0000;
  let r1 = 50000;
  const batch = (t) => [].concat(...W.map((sid, a) => Array.from({ length: 50 }, (_, j) => ({ sid, d: start(2, K0 + ((a + t) % 4) * 50 + j, 0, [sid, SID(++r1)]) }))));
  const st2 = [[0, batch(0)]];
  for (let t = 1; t < 4; t++) st2.push([5 * MIN, batch(t)]);
  const r2 = timeline(st2);
  if (!brk(r2, 4, '[5] four accounts')) {
    const per = W.map((s) => seenPer(r2[3])[v.pid(s)] | 0), per1 = W.map((s) => seenPer(r2[1])[v.pid(s)] | 0);
    T('[5] four accounts writing each other\'s keys: each stops at the room', per.every((x) => x === 64) && per1.every((x) => x === 64), JSON.stringify(per1) + ' -> ' + JSON.stringify(per));
  }
}

// ---- [6] main(): a loser past his room, his start read before the result, then he leaves -- the same verdict as a fresh loser ----
//   REVIEW of the first draft section 9: past the room a start is seen but not remembered, so read again after the result it
//   is left out as late. It was read before, maybe registered: check this opens no way out (the match not counted, his seat
//   not judged a leaver) -- the whole verdict, run by run, is compared with a loser whose start is remembered.
{
  const H = SID(682), Wl = SID(681);
  const M = 0x7E60, ros = [H, Wl];
  const sh = start(2, M, 0, ros), sw = start(2, M, 1, ros), rh = settle1v1(M, 0, ros);
  const filled = () => { const st = {}; const t0 = Date.now(); for (let i = 0; i < 64; i++) st['~' + (950000 + i) + '_1234_2'] = { t0, s: [v.pid(Wl) + '@0#x' + i], r: 0, c: 0 }; return { STARTS_FILE: st }; };
  const steps = () => [[0, [{ sid: H, d: sh }, { sid: Wl, d: sw }]], [5 * MIN, [{ sid: H, d: sh }, { sid: Wl, d: sw }, { sid: H, d: rh }]],
    [5 * MIN, [{ sid: H, d: sh }, { sid: Wl, d: sw }, { sid: H, d: rh }]], [2 * HOUR + 5 * MIN, [{ sid: H, d: sh }, { sid: Wl, d: sw }, { sid: H, d: rh }]],
    [5 * MIN, [{ sid: H, d: sh }, { sid: Wl, d: sw }, { sid: H, d: rh }]]];
  const verdict = (rs) => ({
    hits: rs.map((r) => Number((/\nstarts: [^\n]*?([0-9]+) exit-rate hits/.exec('\n' + r.out) || [])[1] || 0)),
    posts: [].concat(...rs.map((r, i) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url)).map((p) => i + ':' + ((/leaderboardid=([0-9]+)/.exec(p.body) || [])[1]) + ':'
      + ((/steamid=([0-9]+)/.exec(p.body) || [])[1]) + ':' + ((/(?:^|&)score=(-?[0-9]+)/.exec(p.body) || [])[1])))).sort(),
    processed: rs.map((r) => (r.state.PROCESSED_FILE || []).indexOf(keyOf(sh)) >= 0),
    orphan: rs.map((r) => (r.out.match(/start-orphan [^\n]*/g) || []).join(' | ')),
  });
  const a = timeline(steps(), filled(), ros), b = timeline(steps(), null, ros);
  if (!brk(a, 5, '[6] past the room') && !brk(b, 5, '[6] fresh')) {
    T('[6] the loser is past his room: his start seen, not remembered (logged), left out as late once the result is read',
      /start-seen-room: 1 account/.test(a[0].out) && a.slice(1).some((r) => /start-late: 1 start/.test(r.out)) && !b.some((r) => /start-late/.test(r.out)),
      a.map((r) => (r.out.match(/start-(?:seen-room|late)[^\n]*/g) || []).join(' / ')).join(' || '));
    const va = verdict(a), vb = verdict(b);
    T('[6] the loser is judged a leaver (an exit-rate hit on his seat, the winner exempt) and the key processed', vb.hits[3] === 1 && vb.orphan[3].indexOf('(' + v.pid(Wl).slice(0, 8) + ')') >= 0 && /1 exempt/.test(vb.orphan[3]) && vb.processed[4], JSON.stringify(vb));
    eq('[6] ... the same verdict past the room as fresh (exit-rate hits and who per run, the boards posted, processed)', va, vb);
  }
}

try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (state-prune-rework) ===' : '=== PASS -- 0 fail (state-prune-rework) ===');
process.exit(failN ? 1 : 0);
