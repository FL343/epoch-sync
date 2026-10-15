'use strict';
// Q109 (cloud audit R1-X12): a sanity bound that sits on ONE record's own fields (duration, seat, roster, an account writing
// the key twice) drops that record and flags only its writer; the rest of the match settles. The dropped writer keeps his
// consensus seat in the ranking (breaking your own record is no way out of a loss), earns nothing from the match (XP / CP
// read the records) and is never an absent seat or a leaver (he wrote one). Reasons read off the shared consensus fields
// (type, seat count, scores, rank claims, premade fields) and every endless group keep the whole-group rule.
//   [1] unit: sanitySplit / recordSanityFlags (who is dropped, what falls back to the whole-group rule)
//   [2] ranked FFA 3P, one record's duration out of bounds: the other two settle, only he is flagged, he is ranked 3rd and
//       loses the same points as with a clean record; the other two get exactly the clean-record points; no XP for him
//   [3] the same with a seat out of range / a roster naming someone else at his seat / a second record of his
//   [4] 1v1: one record bad -> one writer left: not settled, not processed, only the bad writer flagged
//   [5] a shared-field reason (score over the cap) keeps the old rule: nobody settles, everyone flagged
//   [6] team 2v2: the dropped writer is rated with his team, his teammate's and the opponents' points are unchanged
//   [7] private room 3P / bot match with two humans: the rest settles, no XP for the dropped writer
//   [8] wiring pins
// End-to-end over the REAL validate.js main() against an offline stateful board stub (the harness of test/leaver-own-record.js).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanity-per-record-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned season clock (points go to the lifetime board; see test/leaver-own-record.js)
      // the absent-seat grace longer than the one start floor between the two runs: a dropped writer counted as an absent
      //   seat would hold the match past run 2 (pins the absent-hold half of the fix, not only the leaver half)
      ABSENT_GRACE_MS: '900000',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    let summary = ''; try { summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'); } catch (err) {}
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const postsTo = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const scoreWrittenFor = (r, boardId, sid) => { const w = postsTo(r, boardId).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)); return w.length ? Number(/score=(-?[0-9]+)/.exec(w[w.length - 1].body)[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const flagsOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const POINTS = 7, XP = 5;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(mt, hash, seat, ros, scores, o) {
  o = o || {};
  const pc = scores.length;
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const rank = order.indexOf(seat) + 1;
  const d = [0xB1, 3, mt, hash | 0, 1234, o.seat != null ? o.seat : seat, o.rank != null ? o.rank : rank, (6 << 1) | (rank === 1 ? 1 : 0), pc, o.dur != null ? o.dur : 720];
  for (const s of scores) d.push(s | 0);
  d.push(o.disp | 0);
  for (const s of (o.ros || ros)) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: XP, name: 'progress', entries: [A, B, C, D].map(s => ({ steamID: s, score: 1000 })) }, { id: 6, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: [A, B, C, D].map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
function twoRuns(recs) {
  const r1 = runCron(boardsWith(recs));
  const r2 = runCron(boardsWith(recs), advance(r1.state, FLOOR + 1000));
  return { r1, r2 };
}

console.log('=== one bad record drops that record, not the match (Q109) ===');

// ---- [1] unit ----
if (typeof v.sanitySplit !== 'function') bad('[1] sanitySplit is not exported (pre-Q109 tree) -- unit cases skipped');
else {
  const ros = [A, B, C], sc = [9000, 6000, 3000];
  const R = (sid, seat, o) => ({ steamID: sid, d: rec(2, 1, seat, ros, sc, o), roster: v.decodeRoster(rec(2, 1, seat, ros, sc, o)), dispCode: 0 });
  const g = [R(A, 0), R(B, 1), R(C, 2, { dur: 90000 })];
  const sp = v.sanitySplit(g);
  T('[1] duration on C: sanityFlags unchanged (old callers see the same reason)', JSON.stringify(v.sanityFlags(g)) === '["duration"]', JSON.stringify(v.sanityFlags(g)));
  T('[1] duration on C: only C dropped, why = duration', sp.drop.length === 1 && sp.drop[0].sid === C && JSON.stringify(sp.drop[0].why) === '["duration"]', JSON.stringify(sp.drop.map(x => [x.sid, x.why])));
  T('[1] duration on C: keep = A, B', sp.keep.map(r => r.steamID).join() === [A, B].join());
  const g2 = [R(A, 0), R(B, 1, { seat: 5 }), R(C, 2, { ros: [A, B, A] })];
  const sp2 = v.sanitySplit(g2);
  T('[1] two bad records (seat on B, self-seat + dup-sid on C): both dropped with every reason', sp2.drop.length === 2
    && JSON.stringify(sp2.drop.map(x => [x.sid, x.why])) === JSON.stringify([[B, ['seat']], [C, ['self-seat', 'dup-sid']]]), JSON.stringify(sp2.drop.map(x => [x.sid, x.why])));
  const g3 = [R(A, 0), R(B, 1), R(C, 2), R(C, 2)];
  T('[1] same account twice: that account dropped (dup-writer)', JSON.stringify(v.sanitySplit(g3).drop.map(x => [x.sid, x.why, x.recs.length])) === JSON.stringify([[C, ['dup-writer'], 2]]));
  const g4 = [R(A, 0), R(B, 1), R(C, 2, { ros: ['123', B, C] })];
  T('[1] implausible sid in one roster: that writer dropped (sid-range)', JSON.stringify(v.sanitySplit(g4).drop.map(x => [x.sid, x.why])) === JSON.stringify([[C, ['sid-range']]]), JSON.stringify(v.sanitySplit(g4).drop.map(x => [x.sid, x.why])));
  // shared-field reasons keep the whole-group rule
  const hi = [99999999, 6000, 3000];
  const gS = [A, B, C].map((s, i) => ({ steamID: s, d: rec(2, 1, i, ros, hi), roster: v.decodeRoster(rec(2, 1, i, ros, hi)), dispCode: 0 }));
  gS[2].d[9] = 90000;
  const spS = v.sanitySplit(gS);
  T('[1] score over the cap (shared) + a bad duration: whole-group rule (nothing dropped)', spS.drop.length === 0 && spS.flags.indexOf('score') >= 0, JSON.stringify(spS));
  T('[1] clean group: nothing dropped, no flags', (() => { const s = v.sanitySplit([R(A, 0), R(B, 1), R(C, 2)]); return s.drop.length === 0 && s.flags.length === 0; })());
  // endless keeps the whole-group rule (writers-only outputs + chain reads every writer's tail)
  const e = (sid, seat, dur) => { const d = [0xB1, 3, 7, 9, 99, seat, 1, 0, 2, dur, 100, 100, 0]; for (const s of [A, B]) { const p = sidPair(s); d.push(p[0], p[1]); } d.push(0, 3, 0, 0, 1, 0); return { steamID: sid, d, roster: v.decodeRoster(d), dispCode: 0 }; };
  const gE = [e(A, 0, 600), e(B, 1, -5)];
  T('[1] endless with one negative duration: flagged as before, nothing dropped', v.sanityFlags(gE).indexOf('duration') >= 0 && v.sanitySplit(gE).drop.length === 0, JSON.stringify(v.sanityFlags(gE)));
  // bot lane: a writer at a seat his roster leaves empty
  const rb = (sid, seat, ros2) => { const d = rec(11, 2, seat, ros2, [500, 400, 300]); return { steamID: sid, d, roster: v.decodeRoster(d), dispCode: 0 }; };
  const gB = [rb(A, 0, [A, B, '0']), rb(B, 1, [A, '0', '0'])];
  T('[1] bot lane: writer at a seat his own roster leaves empty -> that writer dropped (self-seat)', JSON.stringify(v.sanitySplit(gB).drop.map(x => [x.sid, x.why])) === JSON.stringify([[B, ['self-seat']]]), JSON.stringify(v.sanityFlags(gB)) + ' ' + JSON.stringify(v.sanitySplit(gB).drop.map(x => [x.sid, x.why])));
  // a shared reason read off one record (the bot lane's 'nobot' reads g[0]'s roster) keeps the whole-group rule even when
  //   dropping that record would clear it
  const gN = [rb(B, 1, [A, B, D]), rb(A, 0, [A, B, '0'])];
  gN[0].d[9] = 90000;
  T('[1] bot lane: nobot (shared, read off the first record) + a bad duration on that record -> whole-group rule', JSON.stringify(v.sanityFlags(gN)) === '["nobot","duration"]' && v.sanitySplit(gN).drop.length === 0, JSON.stringify(v.sanityFlags(gN)) + ' ' + JSON.stringify(v.sanitySplit(gN).drop.map(x => x.sid)));
  // what is left must pass the full check on its own: here the kept record alone reads as 'nobot'
  const gK = [rb(A, 0, [A, B, '0']), rb(B, 1, [A, B, D])];
  gK[0].d[9] = 90000;
  T('[1] bot lane: the record left after the drop fails a shared check on its own -> whole-group rule', JSON.stringify(v.sanityFlags(gK)) === '["duration"]' && v.sanitySplit(gK).drop.length === 0 && JSON.stringify(v.sanityFlags([gK[1]])) === '["nobot"]',
    JSON.stringify(v.sanityFlags(gK)) + ' ' + JSON.stringify(v.sanitySplit(gK).drop.map(x => x.sid)) + ' ' + JSON.stringify(v.sanityFlags([gK[1]])));
  // the per-record half covers every per-record reason sanityFlags can return
  T('[1] SANITY_RECORD_SLUGS pinned', JSON.stringify(v.SANITY_RECORD_SLUGS) === JSON.stringify(['duration', 'seat', 'self-seat', 'sid-range', 'dup-sid', 'dup-writer']));
}

// ---- [2] ranked FFA 3P: C's duration out of bounds ----
const SC3 = [9000, 6000, 3000], ROS3 = [A, B, C];
const clean3 = (h) => [{ sid: A, d: rec(2, h, 0, ROS3, SC3) }, { sid: B, d: rec(2, h, 1, ROS3, SC3) }, { sid: C, d: rec(2, h, 2, ROS3, SC3) }];
const ref = twoRuns(clean3(0x10901)).r2;
T('[2] reference: the clean match settles', ref.code === 0 && processedOf(ref).has(keyOf(rec(2, 0x10901, 0, ROS3, SC3))), ref.out.slice(-600));
const refPts = [A, B, C].map(s => scoreWrittenFor(ref, POINTS, s));
const refXp = [A, B, C].map(s => scoreWrittenFor(ref, XP, s));
T('[2] reference: all three get points and XP', refPts.every(x => x != null) && refXp.every(x => x != null), JSON.stringify({ refPts, refXp }));
function badCase(tag, h, mutC, extra) {
  const recs = clean3(h);
  mutC(recs);
  if (extra) recs.push(...extra(h));
  const { r1, r2 } = twoRuns(recs);
  const key = keyOf(rec(2, h, 0, ROS3, SC3));
  T(tag + ': both runs exit 0', r1.code === 0 && r2.code === 0, r2.out.slice(-800));
  T(tag + ': the match settles (processed)', processedOf(r2).has(key), r2.out.slice(-1200));
  T(tag + ': only C is flagged', flagsOf(r2, C) === 1 && flagsOf(r2, A) === 0 && flagsOf(r2, B) === 0, 'f A/B/C = ' + [A, B, C].map(s => flagsOf(r2, s)).join('/'));
  const pts = [A, B, C].map(s => scoreWrittenFor(r2, POINTS, s));
  T(tag + ': A and B get exactly the clean-match points', pts[0] === refPts[0] && pts[1] === refPts[1], JSON.stringify({ pts, refPts }));
  T(tag + ': C is still ranked 3rd and loses the clean-match points (no dodge)', pts[2] === refPts[2] && refPts[2] < 2500, JSON.stringify({ pts, refPts }));
  const xp = [A, B, C].map(s => scoreWrittenFor(r2, XP, s));
  T(tag + ': A and B get their XP, C none', xp[0] === refXp[0] && xp[1] === refXp[1] && xp[2] == null, JSON.stringify({ xp, refXp }));
  T(tag + ': C is no leaver', leavesOf(r2, C) === 0 && !/leaver LP /.test(r2.out), 'leaves=' + leavesOf(r2, C));
  T(tag + ': logged (dropped, consensus seat 2, not a leaver)', /only that record dropped and its writer flagged/.test(r2.out) && /consensus seat 2/.test(r2.out) && /sanity dropped -- played, not a leaver \(Q109\)/.test(r2.out));
  T(tag + ': summary row counts it', /\| sanity on one record only: dropped, rest settles \/ too few writers left \(Q109\) \| 1 \/ 0 \|/.test(r2.summary), r2.summary.split('\n').filter(l => /Q109|sanity/.test(l)).join(' / '));
  return r2;
}
badCase('[2] duration 90000 on C', 0x10902, (recs) => { recs[2].d[9] = 90000; });

// ---- [3] the other per-record reasons ----
badCase('[3a] C seat out of range', 0x10903, (recs) => { recs[2].d[5] = 5; });
badCase('[3b] C roster names A at his seat', 0x10904, (recs) => { recs[2].d = rec(2, 0x10904, 2, ROS3, SC3, { ros: [A, B, A] }); });
badCase('[3c] C writes the key twice', 0x10905, () => {}, (h) => [{ sid: C, d: rec(2, h, 2, ROS3, SC3, { dur: 721 }) }]);

// ---- [4] 1v1: one writer left ----
{
  const h = 0x10906, ros = [A, B], sc = [5000, 4000];
  const { r2 } = twoRuns([{ sid: A, d: rec(2, h, 0, ros, sc) }, { sid: B, d: rec(2, h, 1, ros, sc, { dur: 90000 }) }]);
  T('[4] 1v1 with B bad: not settled, not processed', r2.code === 0 && !processedOf(r2).has(keyOf(rec(2, h, 0, ros, sc))), r2.out.slice(-600));
  T('[4] only B flagged (A was flagged too before Q109)', flagsOf(r2, B) === 1 && flagsOf(r2, A) === 0, 'f A/B = ' + flagsOf(r2, A) + '/' + flagsOf(r2, B));
  T('[4] no points written for anyone', postsTo(r2, POINTS).length === 0);
  T('[4] logged + summary', /fewer than two writers left, not settled \(Q109\)/.test(r2.out) && /\(Q109\) \| 0 \/ 1 \|/.test(r2.summary));
}

// ---- [5] a shared-field reason keeps the whole-group rule ----
{
  const h = 0x10907, hi = [999999, 6000, 3000];
  const { r2 } = twoRuns([A, B, C].map((s, i) => ({ sid: s, d: rec(2, h, i, ROS3, hi) })));
  T('[5] score over the cap: not processed, all three flagged', !processedOf(r2).has(keyOf(rec(2, h, 0, ROS3, hi))) && [A, B, C].every(s => flagsOf(r2, s) === 1), 'f = ' + [A, B, C].map(s => flagsOf(r2, s)).join('/'));
  T('[5] the old log line', /sanity-flagged \[score\] -- not settled/.test(r2.out));
}

// ---- [6] team 2v2 (mt 4): seats 0,1 vs 2,3; D (seat 3) has a bad duration ----
{
  const ros = [A, B, C, D], sc = [4000, 3000, 2000, 1000];
  const mk = (h, badD) => [A, B, C, D].map((s, i) => ({ sid: s, d: rec(4, h, i, ros, sc, (badD && s === D) ? { dur: 90000 } : {}) }));
  const r0 = twoRuns(mk(0x10908, false)).r2, r1 = twoRuns(mk(0x10909, true)).r2;
  const p0 = [A, B, C, D].map(s => scoreWrittenFor(r0, POINTS, s)), p1 = [A, B, C, D].map(s => scoreWrittenFor(r1, POINTS, s));
  T('[6] team: clean reference settles with points for all four', processedOf(r0).has(keyOf(rec(4, 0x10908, 0, ros, sc))) && p0.every(x => x != null), JSON.stringify(p0) + r0.out.slice(-400));
  T('[6] team: D dropped -> the match settles, every point write equals the clean one (D rated with his team)', processedOf(r1).has(keyOf(rec(4, 0x10909, 0, ros, sc))) && JSON.stringify(p1) === JSON.stringify(p0), JSON.stringify({ p0, p1 }));
  T('[6] team: only D flagged, no leaver', flagsOf(r1, D) === 1 && [A, B, C].every(s => flagsOf(r1, s) === 0) && leavesOf(r1, D) === 0);
}

// ---- [7] XP-only lanes ----
{
  // private room 3P (mt 10)
  const h = 0x1090A, mkP = (badC) => [A, B, C].map((s, i) => ({ sid: s, d: rec(10, h, i, ROS3, SC3, (badC && s === C) ? { dur: 90000 } : {}) }));
  const { r2 } = twoRuns(mkP(true));
  const xp = [A, B, C].map(s => scoreWrittenFor(r2, XP, s));
  T('[7a] private: settles, A and B get XP, C none, only C flagged', processedOf(r2).has(keyOf(rec(10, h, 0, ROS3, SC3))) && xp[0] > 1000 && xp[1] > 1000 && xp[2] == null
    && flagsOf(r2, C) === 1 && flagsOf(r2, A) === 0 && flagsOf(r2, B) === 0, JSON.stringify(xp) + ' f=' + [A, B, C].map(s => flagsOf(r2, s)).join('/') + r2.out.slice(-500));
  T('[7a] private: the winner is still ranked 1st of the three (rank 1 log line)', /xp-private .* valid rank1 /.test(r2.out));
  // bot match: two humans + one bot (mt 11), B's duration bad -> A settles on the corroborated vector at the full rate
  const hb = 0x1090B, rosB = [A, B, '0'], scB = [500, 400, 300];
  const mkB = (badB, hh) => [{ sid: A, d: rec(11, hh, 0, rosB, scB) }, { sid: B, d: rec(11, hh, 1, rosB, scB, badB ? { dur: 90000 } : {}) }];
  const b0 = twoRuns(mkB(false, hb)).r2, b1 = twoRuns(mkB(true, hb + 1)).r2;
  const xa0 = scoreWrittenFor(b0, XP, A), xa1 = scoreWrittenFor(b1, XP, A);
  T('[7b] bots: settles, A gets the same XP as with a clean B, B none, only B flagged', processedOf(b1).has(keyOf(rec(11, hb + 1, 0, rosB, scB))) && xa0 != null && xa1 === xa0
    && scoreWrittenFor(b1, XP, B) == null && flagsOf(b1, B) === 1 && flagsOf(b1, A) === 0, JSON.stringify({ xa0, xa1, xb: scoreWrittenFor(b1, XP, B) }) + b1.out.slice(-500));
}

// ---- [9] the dropped record's disposition vote goes with it ----
{
  // A and C both say VOID (disp >= 2), B finished: with C's vote the void majority holds (2 of 3); C's record is dropped
  //   (bad duration), so the vote is 1 of 2 -- no majority, the match is rated
  const h = 0x1090C;
  const recs = [{ sid: A, d: rec(2, h, 0, ROS3, SC3, { disp: 2 }) }, { sid: B, d: rec(2, h, 1, ROS3, SC3) }, { sid: C, d: rec(2, h, 2, ROS3, SC3, { disp: 2, dur: 90000 }) }];
  const { r2 } = twoRuns(recs);
  T('[9] processed, not voided by the dropped vote, A and B rated', processedOf(r2).has(keyOf(rec(2, h, 0, ROS3, SC3))) && !/VOID 0*[0-9]+_1234_2: consensus/.test(r2.out)
    && scoreWrittenFor(r2, POINTS, A) != null && scoreWrittenFor(r2, POINTS, B) != null, r2.out.split('\n').filter(l => /VOID|settle /.test(l)).join(' | '));
}

// ---- [10] a dropped writer never takes a kept writer's seat ----
{
  // 4P FFA: B's record claims seat 2 (his roster puts him there), while A and D (the majority) seat C at 2 and B at 1;
  //   C's record is dropped (bad duration). C's consensus seat is taken by B's record -> C is not ranked, B keeps seat 2
  const h = 0x1090D, ros = [A, B, C, D], sc = [4000, 3000, 2000, 1000];
  const recs = [{ sid: A, d: rec(2, h, 0, ros, sc) }, { sid: B, d: rec(2, h, 2, [A, C, B, D], sc) }, { sid: C, d: rec(2, h, 2, ros, sc, { dur: 90000 }) }, { sid: D, d: rec(2, h, 3, ros, sc) }];
  const { r2 } = twoRuns(recs);
  T('[10] settles; B is rated (not displaced by C), C is not, only C flagged', processedOf(r2).has(keyOf(rec(2, h, 0, ros, sc))) && scoreWrittenFor(r2, POINTS, B) != null && scoreWrittenFor(r2, POINTS, C) == null
    && flagsOf(r2, C) === 1 && [A, B, D].every(s => flagsOf(r2, s) === 0) && leavesOf(r2, C) === 0, JSON.stringify([A, B, C, D].map(s => scoreWrittenFor(r2, POINTS, s))) + r2.out.slice(-600));
}

// ---- [11] a dropped writer inside a seedcap reject window still has his own settlement discarded ----
{
  // C tops the match, his record is dropped (bad duration) and he sits in an open seedcap reject window: ranked at his seat
  //   like any writer, so the reject-window discard must cover him too (his win must not land); A and B settle as usual
  const h = 0x1090E, sc = [3000, 6000, 9000];
  const recs = [{ sid: A, d: rec(2, h, 0, ROS3, sc) }, { sid: B, d: rec(2, h, 1, ROS3, sc) }, { sid: C, d: rec(2, h, 2, ROS3, sc, { dur: 90000 }) }];
  const sus = { suspects: { [v.pid(C)]: { n: 1, t0: Math.floor(Date.now() / 60000) } } };
  const env = { SEEDCAP_REJECT: '1' };
  const r1 = runCron(boardsWith(recs), { SC_STATE_FILE: sus }, env);
  const r2 = runCron(boardsWith(recs), Object.assign(advance(r1.state, FLOOR + 1000), { SC_STATE_FILE: sus }), env);
  T('[11] settles; A and B get points, C (the winner, in a reject window) gets none', processedOf(r2).has(keyOf(rec(2, h, 0, ROS3, sc))) && scoreWrittenFor(r2, POINTS, A) != null
    && scoreWrittenFor(r2, POINTS, B) != null && scoreWrittenFor(r2, POINTS, C) == null && /seedcap suspect .* inside reject window/.test(r2.out),
    JSON.stringify([A, B, C].map(s => scoreWrittenFor(r2, POINTS, s))) + r2.out.slice(-600));
}

// ---- [8] wiring pins ----
{
  T('[8] the settle loop splits before falling back', /const sp = sanitySplit\(g\);\n\s+if \(!sp\.drop\.length\) \{\n\s+recordFlag\(signals, g, c\.m, nowMs\);/.test(SRC));
  T('[8] only the dropped writers are flagged on the split path', /if \(recordFlag\(signals, sp\.drop\.map\(x => \(\{ steamID: x\.sid \}\)\), c\.m, nowMs\)\) sigDirty = true;/.test(SRC));
  T('[8] absent-seat hold skips a dropped writer', /const absentNow = absentRosterSeats\(g\)\.filter\(\(x\) => agreed\.indexOf\(pid\(String\(x\.steamID\)\)\) < 0\);\n\s+if \(dropSeat\) for \(let i = absentNow\.length - 1; i >= 0; i--\) if \(dropped\(absentNow\[i\]\.steamID\)\) absentNow\.splice\(i, 1\);/.test(SRC));
  T('[8] the leaver filter skips a dropped writer first', /const leavers0 = detectLeavers\(g\)\.filter\(\(x\) => \{\n\s+if \(dropped\(x\.steamID\)\)/.test(SRC));
  T('[8] a dropped writer is ranked at his consensus seat', /if \(dropSeat\) for \(const \[sid, seat\] of dropSeat\) if \(seat >= 0 && seatToId\[seat\] == null\) seatToId\[seat\] = sid;/.test(SRC));
  T('[8] exports', typeof v.sanitySplit === 'function' && typeof v.recordSanityFlags === 'function');
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (sanity-per-record) ===');
process.exit(failN === 0 ? 0 : 1);
