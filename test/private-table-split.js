'use strict';
// Q220 (cloud audit 2026-10): a friends' room (type 10) or bot match (type 11) held by results on two tables past the Q200
// maturity settles each table on a key of its own (test/private-majority-table.js has the shapes). This file holds the
// split up across runs and across the rest of the job -- what a split key needs from the parts of main() that never
// heard of it:
//   [0] wiring pins (the split keys among the keys seen this run, ahead of the processed-list prune; the unmatched box's
//       match index on the match hash a moved record keeps)
//   [1] units: a moved record is a copy of its details (the read row is untouched), its key the table's split key, its
//       first match hash kept however often it moves
//   [2] sticky across runs: a table written after the split settles on a key of its own, once; the tables paid before
//       are never paid again, a day later either (the Q200 note gone); runs that only move the key again stay quiet
//   [3] the processed list past its cap (PROCESSED_CAP 0): a split key whose records are on the shards is never dropped
//       (dropped, the key would split again and pay again); a one-writer friends' room table keeps its entry from run
//       to run (let go as a key off the shards, it would be made again every run)
//   [4] the unmatched box (knife-7): a host-drop confession of the players' host first read in the run that splits the
//       key is corroborated by the moved records (their match hash, not the split key's letter)
//   [5] the seedcap veto (O124, SEEDCAP_ENFORCE): a veto seedcap.js wrote for the original key -- on an outside
//       account's over-cap result -- stops and flags nobody on the players' table, two tables or one; control: an honest
//       room with a veto on its key is still vetoed and flagged
//   [6] the Q121 leave wait: a player of the room who wrote his start and no result does not hold the room's table for
//       a fresh hour after the split -- its entry keeps the original entry's sighting of his start; only the
//       absent-seat hold of his seat is left
//   [7] Q214 README residual 8 (a modded member plus an alt at another real player's seat): in a bot match the honest
//       human is paid on the lone lane; in a two-human friends' room he is a one-writer table and gets nothing (left
//       open: telling him from an outside account needs a guard-signed roster) -- pinned so a change shows here
//   [8] the Q220 review (F1): a table first written after the split starts its own clock -- two bot matches split a day
//       before; a fresh account writes a lone result on each key from a new table every round: his tables' entries start
//       now, he settles no match in the run that first reads them (the first draft gave them the original key's
//       day-old t0: a match a key every round, back to back), nor more than a fresh account who opens bot matches of his
//       own at the same time
// End-to-end over the REAL validate.js main() against an offline stateful board stub (same harness as
// test/private-majority-table.js, plus initial state files and extra boards). State isolation is structural (every
// *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
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
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  "  if (/GetLeaderboardEntries/.test(u) && process.env.STUB_FAIL_ID && new RegExp('leaderboardid=' + process.env.STUB_FAIL_ID + '(&|$)').test(u)) return { ok: false, status: 403, text: async () => '{}' };",
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'private-contest-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) -- every test
      //   runs before each production reconcile, so a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every stored
//   instant moves back instead: start sightings and notes, absent-seat stamps and the writers' busy marks)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const xpOf = (r, sid) => posts(r, 5).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat, '0' = a bot seat; sc: the per-seat scores this writer reports (the consistency vector)
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, h, ros, seat, sid) => ({ sid: sid || ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
// a friends' room ranks by score (rank 1 = the top score); a bot match reads its ranks from the vector (rank field 0)
const settle = (mt, h, ros, seat, sc, sid) => {
  const rk = v.isBotMt(mt) ? 0 : 1 + sc.filter((x, i) => x > sc[seat] && ros[i] !== '0').length;
  return { sid: sid || ros[seat], d: rec(0xB1, mt, h, seat, rk, rk === 1, ros, sc) };
};
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const MIN = 60000, HOUR = 3600 * 1000, DAY = 24 * HOUR;
const MAT = v.STARTS_MATURITY_MS;

const S2 = [701, 702].map(SID), SX = [703, 704].map(SID), SY = [705, 706].map(SID);
const R2 = [711, 712].map(SID), RX = [713, 714].map(SID), RZ = SID(715);
const U2 = [721, 722].map(SID), UX = [723, 724].map(SID);
const V2 = [731, 732].map(SID), VX = SID(733);
const W2 = [741, 742].map(SID), WX = SID(743);
const N2 = [751, 752].map(SID);
const G3 = [761, 762, 763].map(SID), GX = [764, 765].map(SID);
const BM = SID(771), BH = SID(772), BA = SID(773);
const FM = SID(781), FH = SID(782), FA = SID(783);
const K1 = [801, 802, 803].map(SID), K2 = [811, 812, 813].map(SID), NA = SID(821), NC = SID(831);
const NB = SID(822), ND = SID(832), Q2 = [841, 842].map(SID), QX = [843, 844].map(SID), QZ = SID(845);
const ALL = [].concat(S2, SX, SY, R2, RX, [RZ], U2, UX, V2, [VX], W2, [WX], N2, G3, GX, [BM, BH, BA, FM, FH, FA], K1, K2, [NA, NC, NB, ND], Q2, QX, [QZ]);
function boardsWith(recs, extra) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards.concat(extra || []);
}
// a timeline of runs: [[ms since the previous run, records visible in that run, extra env, extra boards], ...] -> every
//   run's result; `init`: the state files of the first run
function timeline(steps, script, init) {
  const out = []; let state = null;
  for (const [ms, recs, env, extra] of steps) {
    const r = runCron(boardsWith(recs, extra), state ? advance(state, ms) : (init || null), env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const pendOf = (r, key) => (r.state.STARTS_FILE || {})[key];
const xpIn = (rs, sid) => [].concat(...rs.map(r => xpOf(r, sid)));
const paidOnlyIn = (rs, sid, i) => rs.every((r, j) => (j === i) === (xpOf(r, sid).length > 0)) && xpOf(rs[i], sid).every(x => x > 0);
const neverPaid = (rs, sid) => xpIn(rs, sid).length === 0;
const nobodyHurt = (rs, sids) => sids.every(s => rs.every(r => leavesOf(r, s) === 0 && fOf(r, s) === 0));
const HELD = /roster contest, not settled \(Q75\)/;
const ANYSPLIT = /table-split [^\n]*\(Q220\)/;
// "<tables>/<writers per table, sorted>/<results left out>" of the first split of `key`
const SPLIT = (r, key) => {
  const m = new RegExp('table-split ' + key + ": results on ([0-9]+) tables past the hold's maturity -- each table settles on a key of its own \\((.*?)\\), (nothing left out|([0-9]+) result\\(s\\) from writers not on one table of their own left out, nobody flagged: [^\\n]*) \\(Q220\\)").exec(r.out);
  return m ? [m[1], Array.from(m[2].matchAll(/t[0-9]+_[0-9]+_[0-9]+ ([0-9]+) writer\(s\)/g), x => x[1]).sort().join(','), m[4] || '0'].join('/') : '';
};
// "<writers>/<results left out>" of a split into one table
const ONE = (r, key) => {
  const m = new RegExp('table-split ' + key + ": one table left past the hold's maturity -- it settles on a key of its own \\(t[0-9]+_[0-9]+_[0-9]+ ([0-9]+) writer\\(s\\)\\), (nothing left out|([0-9]+) result\\(s\\) from writers not on one table of their own left out, nobody flagged: [^\\n]*) \\(Q220\\)").exec(r.out);
  return m ? m[1] + '/' + (m[3] || '0') : '';
};
const TROW = (r, a, b, c) => new RegExp("\\| friends' room / bot match keys held past maturity by results on two tables: two tables or more, each on a key of its own / one table, on a key of its own, the others' results left out / no writer on one table, still held \\(Q214, Q220\\) \\| " + a + ' / ' + b + ' / ' + c + ' \\|').test(r.summary);
const lines = (r, re) => (r.out.match(re || /[^\n]*(Q220|Q200|Q75|private settle|bots settle|absent-hold|leave-wait|lone\()[^\n]*/g) || []).join(' | ');
// the key a table of the scenario settles on: the record's own table (as applyTableSplit reads it)
const kOf = (key, x) => v.splitKey(key, v.recTable({ steamID: x.sid, d: x.d, roster: v.decodeRoster(x.d) }));
const markOf = (k) => (typeof v.splitMark === 'function' ? v.splitMark(k) : '(no splitMark)');   // (a tree without it: its checks fail, not the file)
const lone = (rs, k) => new RegExp('bots settle ' + k + ': 1 writer[^\\n]*\\(lone lane x0\\.6\\)').test(outOf(rs));

const SPLITLINE = (r, key) => new RegExp('table-split ' + key + ': results on [0-9]+ tables').test(r.out);
const AGAIN = (r, key) => new RegExp('table-split ' + key + ': split before').test(r.out);
const paidOnce = (rs, sid) => xpIn(rs, sid).length === 1 && xpIn(rs, sid)[0] > 0;
const paidRun = (rs, sid) => rs.findIndex(r => xpOf(r, sid).length > 0);
const xpTable = (rs, sids) => JSON.stringify(sids.map(x => rs.map(r => xpOf(r, x))));

// ---- scenarios (each a list of timeline steps; the mutation script reruns them) ----
// the players' starts and the outside starts before the job's first look, the results twelve minutes in (the hold and its
//   note begin there), then a minute before maturity, two minutes after it (the split), then the steps of each scenario
const heldSteps = (S, R, env, extra) => [[0, S, env, extra], [12 * MIN, S.concat(R), env, extra], [MAT - 2 * MIN, S.concat(R), env, extra], [3 * MIN, S.concat(R), env, extra]];
const STICKY = () => {   // [2] two players; SX a two-seat table of their own; ten minutes after the split SY write a third one
  const h = 0xA401, ros = [S2[0], S2[1]], xr = [SX[0], SX[1]], yr = [SY[0], SY[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, sc), settle(10, h, xr, 1, sc)];
  const Y = [start(10, h, yr, 0), start(10, h, yr, 1), settle(10, h, yr, 0, sc), settle(10, h, yr, 1, sc)];
  const late = S.concat(R, Y);
  return { key: keyOf(S[0].d), honest: S2, outside: SX, late: SY, hrec: R[0], xrec: R[2], yrec: Y[2],
    steps: heldSteps(S, R).concat([[10 * MIN, late], [10 * MIN, late], [HOUR, late], [DAY, late]]) };
};
const PRUNE = () => {   // [3] two players; RX a two-seat table of their own; RZ a one-seat table of his own; the processed list
  //   over its cap (0) from the first run, the prune armed and its wait one minute
  const h = 0xA402, ros = [R2[0], R2[1]], xr = [RX[0], RX[1]], zr = [RZ], sc = [6100, 5200];
  const env = { PROCESSED_CAP: '0', PROCESSED_KEEP: '0', PROCESSED_PRUNE_WAIT_MS: String(MIN) };
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1), start(10, h, zr, 0)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, sc), settle(10, h, xr, 1, sc), settle(10, h, zr, 0, [6100])];
  const all = S.concat(R);
  return { key: keyOf(S[0].d), honest: R2, outside: RX, lone1: RZ, hrec: R[0], xrec: R[2], zrec: R[4],
    steps: heldSteps(S, R, env).concat([[5 * MIN, all, env], [5 * MIN, all, env], [5 * MIN, all, env], [HOUR, all, env]]) };
};
const UNM = () => {   // [4] two players; UX write a start and a result from seats 2 / 3 of a four-seat table naming them; the
  //   players' host (seat 0) has a host-drop confession of the match on the unmatched box, first read in the run that splits
  const h = 0xA403, ros = [U2[0], U2[1]], xr = ros.concat(UX), sc = [6100, 5200], xsc = [900, 800, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2), start(10, h, xr, 3)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, xsc), settle(10, h, xr, 3, xsc)];
  const box = [{ id: 9, name: 'unmatched_box', entries: [{ steamID: U2[0], score: 1, details: [0xB8, 1, 1, h, 2, 1 << 5] }] }];
  const st = heldSteps(S, R); st[3][3] = box;
  return { key: keyOf(S[0].d), honest: U2, outside: UX, hrec: R[0], xrec: R[2], steps: st };
};
const SCV = (key, seats) => ({ SC_STATE_FILE: { veto: { [key]: { t: 0, seats } }, suspects: {}, audited: {} } });
const ENF = { SEEDCAP_ENFORCE: '1' };
const VETO2 = () => {   // [5] two players; VX writes a start and an over-cap result from seat 2 of a three-seat table naming them,
  //   and seedcap.js vetoed the key on it
  const h = 0xA404, ros = [V2[0], V2[1]], xr = [V2[0], V2[1], VX], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 2)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 2, [900, 800, 99000])];
  const all = S.concat(R), key = keyOf(S[0].d);
  return { key, honest: V2, outside: [VX], hrec: R[0], xrec: R[2], init: SCV(key, [2]), steps: heldSteps(S, R, ENF).concat([[6 * MIN, all, ENF], [HOUR, all, ENF]]) };
};
const VETO1 = () => {   // [5] WX copies the players' start and writes an over-cap result from seat 1 (W2[1]'s seat); the key vetoed
  const h = 0xA405, ros = [W2[0], W2[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 1, WX)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, ros, 1, [900, 99000], WX)];
  const all = S.concat(R), key = keyOf(S[0].d);
  return { key, honest: W2, outside: [WX], hrec: R[0], init: SCV(key, [1]), steps: heldSteps(S, R, ENF).concat([[6 * MIN, all, ENF], [HOUR, all, ENF]]) };
};
const VCTL = () => {   // [5] control: an honest two-player friends' room whose key seedcap.js vetoed
  const h = 0xA406, ros = [N2[0], N2[1]], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc)];
  const all = S.concat(R), key = keyOf(S[0].d);
  return { key, honest: N2, init: SCV(key, [0, 1]), steps: [[0, S, ENF], [12 * MIN, all, ENF], [6 * MIN, all, ENF], [HOUR, all, ENF]] };
};
const LEAVE = () => {   // [6] three players, G3[2] wrote his start and no result; GX write a start and a result from seats 3 / 4 of a
  //   five-seat table naming the three
  const h = 0xA407, ros = G3.slice(), xr = ros.concat(GX), sc = [6100, 5200, 4800], xsc = [900, 800, 700, 6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, ros, 2), start(10, h, xr, 3), start(10, h, xr, 4)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 3, xsc), settle(10, h, xr, 4, xsc)];
  const all = S.concat(R);
  return { key: keyOf(S[0].d), honest: [G3[0], G3[1]], gone: G3[2], outside: GX, hrec: R[0], xrec: R[2],
    steps: heldSteps(S, R).concat([[6 * MIN, all], [HOUR, all]]) };
};
// Q214 README residual 8 (review-q114.js S4): the modded member (seat 0) and his alt write their start and a made-up result
//   on the roster with the alt at the honest player's seat 1; the honest player writes his on the real roster
const RES8 = (mt, h, M, H, A, tail) => {
  const ros = [M, H].concat(tail), alt = [M, A].concat(tail), sc = [6100, 5200].concat(tail.map((x, i) => 1000 - 100 * i));
  const fake = [900, 6100].concat(tail.map((x, i) => 800 - 100 * i));
  const S = [start(mt, h, alt, 0), start(mt, h, alt, 1), start(mt, h, ros, 1)];
  const R = [settle(mt, h, alt, 0, fake), settle(mt, h, alt, 1, fake), settle(mt, h, ros, 1, sc)];
  const all = S.concat(R);
  return { key: keyOf(S[0].d), honest: [H], outside: [M, A], hrec: R[2], xrec: R[0], steps: heldSteps(S, R).concat([[6 * MIN, all], [HOUR, all]]) };
};
const RES8B = () => RES8(11, 0xA408, BM, BH, BA, ['0', '0']);
const RES8F = () => RES8(10, 0xA409, FM, FH, FA, []);
// the Q220 review's F1 (review-q220.js): two bot matches held by two tables (two humans on [A, B, bot], an outside account
//   at the bot seat naming the three) and split; a day later NA writes a lone result (himself and bots) on each key from a
//   new table every round (another seat or seat count; his result of the round before off the shards), three rounds
//   five minutes apart; NC writes the same lone results on two keys of his own from the first round on
const LATE = () => {
  const one = (h, K) => {
    const ros = [K[0], K[1], '0'], xr = [K[0], K[1], K[2]], sc = [6100, 5200, 3000];
    return { S: [start(11, h, ros, 0), start(11, h, ros, 1), start(11, h, xr, 2)], R: [settle(11, h, ros, 0, sc), settle(11, h, ros, 1, sc), settle(11, h, xr, 2, sc)] };
  };
  const a = one(0xA40A, K1), b = one(0xA40B, K2), S = a.S.concat(b.S), R = a.R.concat(b.R), all = S.concat(R);
  const tables = [[[NA, '0'], 0], [['0', NA], 1], [[NA, '0', '0'], 0]];
  const late = tables.map(([ros, seat]) => [0xA40A, 0xA40B].map(h => settle(11, h, ros, seat, ros.map((x, j) => (j === seat ? 6100 : 3000 - 100 * j)))));
  const own = [0xA40C, 0xA40D].map(h => settle(11, h, [NC, '0'], 0, [6100, 3000]));
  return { keys: [keyOf(a.S[0].d), keyOf(b.S[0].d)], honest: [K1[0], K1[1], K2[0], K2[1]], outside: [K1[2], K2[2]], late, lk: late[0].map(x => kOf(keyOf(x.d), x)),
    steps: heldSteps(S, R).concat([[DAY, all], [DAY, all.concat(late[0], own)], [5 * MIN, all.concat(late[1], own)], [5 * MIN, all.concat(late[2], own)], [5 * MIN, all.concat(late[2], own)]]) };
};

console.log("=== a friends' room or bot match split into tables (Q220): across runs and the rest of the job ===");

// ---- [0] wiring pins ----
{
  const SEEN = /\n(\s*\/\/[^\n]*\n)*\s+for \(const r of recs\.concat\(starts\)\) \{\n\s+const mt = r\.d\[2\] \| 0;\n\s+if \(!xpOnlyContestMt\(mt\) \|\| isEndlessMt\(mt\)\) continue;\n\s+const t = recTable\(r\);\n\s+if \(t !== null\) seenKeys\.add\(splitKey\(r\.d\[3\] \+ '_' \+ r\.d\[4\] \+ '_' \+ r\.d\[2\], t\)\);\n\s+\}/.exec(SRC);
  const at = (s) => SRC.indexOf(s);
  T('[0] every friends\' room / bot match record on a table of its writer\'s own adds its split key to the keys seen this run',
    !!SEEN && at('const seenKeys = new Set(recs.concat(starts)') >= 0 && at('const seenKeys = new Set(recs.concat(starts)') < SEEN.index, 'no such block after seenKeys');
  T('[0] ... before the processed-list prune, the flag prune and the starts reconcile read them, and before the split moves a record',
    !!SEEN && SEEN.index < at('const prunedP = pruneProcessed(processed, startsPending, seenKeys, shardsComplete, Date.now());')
    && SEEN.index < at('const tableSplit = applyTableSplit(recs, starts, startsPending, processed, Date.now(), shardsComplete);')
    && at('const tableSplit = applyTableSplit(') < at('pruneFlagged(signals, blankSeen(seenKeys)')
    && at('const tableSplit = applyTableSplit(') < at('STARTS_MATURITY_MS, confState, shardsComplete, registeredEarly, seenKeys'));   // (Q64 adds an argument after seenKeys)
  const MARK = /\n(\s*\/\/[^\n]*\n)*\s+for \(const k of \[\.\.\.seenKeys\]\) \{\n\s+const s = String\(k\), mt = Number\(s\.slice\(s\.lastIndexOf\('_'\) \+ 1\)\) \| 0;\n\s+if \(\/\^-\?\[0-9\]\/\.test\(s\) && xpOnlyContestMt\(mt\) && !isEndlessMt\(mt\)\) seenKeys\.add\(splitMark\(s\)\);\n\s+\}/.exec(SRC);
  T('[0] the split mark of every friends\' room / bot match key read this run (any record, confessions too) is among the keys seen (Q220 review 2), after every key is in',
    !!MARK && !!SEEN && SEEN.index < MARK.index, 'no such block after the split keys');
  T('[0] ... before the processed-list prune reads them',
    !!MARK && MARK.index < at('const prunedP = pruneProcessed(processed, startsPending, seenKeys, shardsComplete, Date.now());'));
  T('[0] the unmatched box\'s match index reads a moved record\'s first match hash',
    /matchIndex\.set\(\(r\.h0 !== undefined \? r\.h0 : r\.d\[3\]\) >>> 0, \{ hostSid: host \}\);/.test(SRC) && !/matchIndex\.set\(r\.d\[3\] >>> 0/.test(SRC));
}

// ---- [1] units ----
{
  const h = 0x9A01, A = SID(791), B = SID(792), X = SID(793), Y = SID(794), m = h + '_1234_10';
  const mk = (sid, seat, ros, sc, magic) => { const d = rec(magic || 0xB1, 10, h, seat, 1, true, ros, sc || ros.map(() => 1)); return { steamID: sid, shard: 's0', d, roster: v.decodeRoster(d) }; };
  const recs = [mk(A, 0, [A, B]), mk(B, 1, [A, B]), mk(X, 0, [X, Y]), mk(Y, 1, [X, Y])];
  const starts = [mk(A, 0, [A, B], null, 0xB2), mk(X, 0, [X, Y], null, 0xB2)];
  const rows = recs.concat(starts).map(r => r.d), copies = rows.map(d => d.slice());
  const pending = { ['~' + m]: { t0: 1, mt: 10 } };
  const proc = new Set(), res = v.applyTableSplit(recs, starts, pending, proc, 1 + MAT, true);
  const ka = v.splitKey(m, v.recTable(mk(A, 0, [A, B]))), kx = v.splitKey(m, v.recTable(mk(X, 0, [X, Y])));
  T('[1] a two-table key splits (the precondition of the units below)', res.keys.length === 1 && res.keys[0] === m, JSON.stringify(res));
  T('[1] a moved record is a copy of its details: the read row is untouched', recs.concat(starts).every((r, i) => r.d !== rows[i]) && rows.every((d, i) => JSON.stringify(d) === JSON.stringify(copies[i])));
  T('[1] its key is its table\'s split key; its first match hash kept', recs.concat(starts).every(r => keyOf(r.d) === (String(r.steamID) === A || String(r.steamID) === B ? ka : kx))
    && recs.concat(starts).every(r => r.h0 === (h | 0) && ((r.h0 !== undefined ? r.h0 : r.d[3]) >>> 0) === h));
  T('[1] the split keys: entries of their own, the original key\'s note left as it was', !!pending[ka] && !!pending[kx] && pending[ka].split === 1 && pending['~' + m].t0 === 1);
  T('[1] the split marks the key in the processed list and the note with the time it lent its t0 (Q220 review 2); the original key itself not processed',
    proc.has(markOf(m)) && /^s[0-9]+_1234_10$/.test(markOf(m)) && pending['~' + m].lent === 1 + MAT && !proc.has(m), JSON.stringify([...proc]) + ' ' + JSON.stringify(pending['~' + m]));
  // a run whose two tables are new (no split key of theirs anywhere): each source of "split before" alone, and none
  const lateT0 = (base, note, marked) => {
    const p = {}; if (base) p[m] = base; if (note) p['~' + m] = note;
    const q = new Set(marked ? [markOf(m)] : []);
    const C = SID(795), D = SID(796), E = SID(797), F = SID(798), now = 10 * DAY;
    const r2 = [mk(C, 0, [C, D]), mk(D, 1, [C, D]), mk(E, 0, [E, F]), mk(F, 1, [E, F])];
    const o = v.applyTableSplit(r2, [], p, q, now, true);
    const k = v.splitKey(m, v.recTable(mk(C, 0, [C, D])));
    return { t0: p[k] ? p[k].t0 : null, again: o.again, now };
  };
  const B0 = () => ({ t0: 1, mt: 10 }), N0 = () => ({ t0: 1, mt: 10 });
  const cases = [['the mark alone', lateT0(B0(), N0(), true)], ['the original entry\'s lent alone (the mark pruned)', lateT0(Object.assign(B0(), { lent: 5 }), N0(), false)],
    ['the note\'s lent alone (the mark pruned, the entry gone)', lateT0(null, Object.assign(N0(), { lent: 5 }), false)]];
  T('[1] split before by the mark, or by a lent entry or note, with none of the run\'s tables on a key of its own: tables written since start now (the S4 of the review, at the unit)',
    cases.every(([, c]) => c.again === 1 && c.t0 === c.now), JSON.stringify(cases));
  const c0 = lateT0(B0(), N0(), false);
  T('[1] control: none of them, a first split: t0 from the original entry', c0.again === 0 && c0.t0 === 1, JSON.stringify(c0));
}
// the Q220 review 2's S4 (review2-q220.js): the two bot matches of [8] split; an hour later every result of the first split
//   is off the shards (the writers' rows written over), their starts stay (the original entries and notes stay too); NA and
//   NB each write a lone result on each key from a new table every round (their result of the round before off the shards),
//   two rounds an hour apart then three five minutes apart; NC and ND each write the same lone results on two new keys of
//   their own every round (their earlier keys stay on the shards)
const GONE = () => {
  const one = (h, K) => {
    const ros = [K[0], K[1], '0'], xr = [K[0], K[1], K[2]], sc = [6100, 5200, 3000];
    return { S: [start(11, h, ros, 0), start(11, h, ros, 1), start(11, h, xr, 2)], R: [settle(11, h, ros, 0, sc), settle(11, h, ros, 1, sc), settle(11, h, xr, 2, sc)] };
  };
  const a = one(0xA41A, K1), b = one(0xA41B, K2), S = a.S.concat(b.S), R = a.R.concat(b.R);
  const tables = [[[0, '0'], 0], [['0', 0], 1], [[0, '0', '0'], 0], [['0', '0', 0], 2], [[0, '0', '0', '0'], 0], [['0', 0, '0', '0'], 1]];
  const tab = (i, who) => { const [r, seat] = tables[i % 6]; const ros = r.map(x => (x === 0 ? who : x)); return [ros, seat]; };
  const lone = (who, i) => [0xA41A, 0xA41B].map(h => { const [ros, seat] = tab(i, who); return settle(11, h, ros, seat, ros.map((x, j) => (j === seat ? 6100 : 3000 - 100 * j))); });
  let ck = 0xA500; const own = [];
  const round = (i) => { own.push(settle(11, ck++, [NC, '0'], 0, [6100, 3000]), settle(11, ck++, [NC, '0'], 0, [6100, 3000]), settle(11, ck++, [ND, '0'], 0, [6100, 3000]), settle(11, ck++, [ND, '0'], 0, [6100, 3000]));
    return S.concat(lone(NA, i), lone(NB, i + 3), own); };
  const r0 = round(0);
  return { keys: [keyOf(a.S[0].d), keyOf(b.S[0].d)], honest: [K1[0], K1[1], K2[0], K2[1]], outside: [K1[2], K2[2]],
    steps: heldSteps(S, R).concat([[HOUR, r0], [2 * HOUR, r0], [5 * MIN, round(1)], [5 * MIN, round(2)], [5 * MIN, round(3)]]) };
};
// a friends' room split (two players, QX a two-seat table of their own, QZ a one-seat table of his own), the processed list over
//   its cap (0) and the prune's wait one minute (as [3]); five minutes on QZ's result is off the shards, his start stays (his
//   table's entry is kept from run to run on complete reads past two hours); six hours on every result is off the shards, every
//   start stays (the key's mark is kept: only starts of the key are read)
const KEEP = () => {
  const h = 0xA41C, ros = [Q2[0], Q2[1]], xr = [QX[0], QX[1]], zr = [QZ], sc = [6100, 5200];
  const S = [start(10, h, ros, 0), start(10, h, ros, 1), start(10, h, xr, 0), start(10, h, xr, 1), start(10, h, zr, 0)];
  const R = [settle(10, h, ros, 0, sc), settle(10, h, ros, 1, sc), settle(10, h, xr, 0, sc), settle(10, h, xr, 1, sc), settle(10, h, zr, 0, [6100])];
  const left = S.concat(R.slice(0, 4)), env = { PROCESSED_CAP: '0', PROCESSED_KEEP: '0', PROCESSED_PRUNE_WAIT_MS: String(MIN) };
  return { key: keyOf(S[0].d), honest: Q2, outside: QX, lone1: QZ, hrec: R[0], xrec: R[2], zrec: R[4],
    steps: heldSteps(S, R, env).concat([[5 * MIN, left, env], [3 * HOUR, left, env], [3 * HOUR, left, env], [3 * HOUR, S, env], [3 * HOUR, S, env]]) };
};

// ---- [2]-[7] end to end ----
function scenario(tag, label, mkS, check) {
  const s = mkS(), rs = timeline(s.steps, null, s.init || null);
  for (const k of ['hrec', 'xrec', 'yrec', 'zrec']) if (s[k]) s[k.slice(0, 1) + 'k'] = kOf(s.key, s[k]);
  console.log('  ' + tag + ' ' + label);
  check(s, rs);
}
const keyNever = (rs, s) => rs.every(r => !processedOf(r).has(s.key));
scenario('[2]', 'sticky across runs: a third table written after the split', STICKY, (s, rs) => {
  T('[2] every run exits 0', allOk(rs, 8), outOf(rs).slice(-600));
  T('[2] split past maturity into two keys (2 and 2), both tables paid then', SPLIT(rs[3], s.key) === '2/2,2/0' && s.honest.concat(s.outside).every(x => paidOnlyIn(rs, x, 3)),
    lines(rs[3]) + ' ' + xpTable(rs, s.honest.concat(s.outside)));
  T('[2] the third table, first read ten minutes later, moves to a key of its own (logged once) and settles once',
    new RegExp('table-split ' + s.key + ': split before -- 1 table\\(s\\) written since on a key of their own \\(' + s.yk + ' 2 writer\\(s\\)\\)').test(rs[4].out)
    && s.late.every(x => paidOnce(rs, x)) && processedOf(rs[7]).has(s.yk), lines(rs[4]) + ' ' + xpTable(rs, s.late));
  T('[2] no table paid twice: an hour and a day later (the Q200 note gone) the key still moves, nobody paid again',
    s.honest.concat(s.outside, s.late).every(x => paidOnce(rs, x)) && !pendOf(rs[7], '~' + s.key) && [s.hk, s.xk, s.yk].every(k => processedOf(rs[7]).has(k)),
    xpTable(rs, s.honest.concat(s.outside, s.late)));
  T('[2] the runs that only move it again are quiet: no table-split line after the third table\'s', rs.slice(5).every(r => !ANYSPLIT.test(r.out)) && !SPLITLINE(rs[4], s.key),
    rs.slice(5).map(r => lines(r)).join(' || '));
  T('[2] summary row 0 / 0 / 0 after the split; the original key never processed; nobody counted as a leaver or flagged',
    rs.slice(4).every(r => TROW(r, 0, 0, 0)) && keyNever(rs, s) && nobodyHurt(rs, s.honest.concat(s.outside, s.late)));
});
scenario('[3]', 'the processed list over its cap', PRUNE, (s, rs) => {
  T('[3] every run exits 0', allOk(rs, 8), outOf(rs).slice(-600));
  T('[3] split past maturity into three keys (1, 2 and 2), both two-writer tables paid then, the one-writer table not',
    SPLIT(rs[3], s.key) === '3/1,2,2/0' && s.honest.concat(s.outside).every(x => paidOnlyIn(rs, x, 3)) && neverPaid(rs, s.lone1), lines(rs[3]));
  T('[3] the split keys on the shards are never dropped from the processed list: nothing armed, nothing dropped, nobody paid again',
    !/oldest key\(s\) off the shards|off the shards go if they are still off/.test(outOf(rs)) && rs.slice(3).every(r => processedOf(r).has(s.hk) && processedOf(r).has(s.xk) && processedOf(r).has(markOf(s.key)))
    && s.honest.concat(s.outside).every(x => paidOnce(rs, x)), lines(rs[6], /[^\n]*(processed:|Q220)[^\n]*/g) + ' ' + xpTable(rs, s.honest.concat(s.outside)));
  T('[3] the one-writer table keeps its entry from run to run: no table made again, no table-split line after the split',
    rs.slice(3).every(r => !!pendOf(r, s.zk)) && rs.slice(4).every(r => !ANYSPLIT.test(r.out)), rs.slice(4).map(r => lines(r)).join(' || '));
  T('[3] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside, [s.lone1])));
});
scenario('[4]', 'a host-drop confession of the players\' host, first read in the run that splits', UNM, (s, rs) => {
  T('[4] every run exits 0', allOk(rs, 4), outOf(rs).slice(-600));
  T('[4] the run splits the key (the precondition)', SPLIT(rs[3], s.key) === '2/2,2/0', lines(rs[3]));
  T('[4] the confession is corroborated: the moved records still name the match hash of their host',
    /unmatched: 1 fresh host-drop signals \(1 corroborated, 0 orphan\)/.test(rs[3].out), (rs[3].out.match(/[^\n]*unmatched[^\n]*/g) || []).join(' | '));
  T('[4] a record-only signal: the players paid as before', s.honest.every(x => paidOnlyIn(rs, x, 3)));
});
scenario('[5a]', 'seedcap vetoed the key on an outside account\'s over-cap result, two tables', VETO2, (s, rs) => {
  T('[5a] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[5a] split past maturity into two keys (2 and 1)', SPLIT(rs[3], s.key) === '2/1,2/0', lines(rs[3]));
  T('[5a] the players\' table settles on its key: no veto there, both paid in that run only', !/seedcap over-cap veto/.test(outOf(rs)) && s.honest.every(x => paidOnlyIn(rs, x, 3)),
    (outOf(rs).match(/[^\n]*seedcap[^\n]*/g) || []).join(' | ') + ' ' + xpTable(rs, s.honest));
  T('[5a] nobody flagged or counted as a leaver; his one-writer table nothing', nobodyHurt(rs, s.honest.concat(s.outside)) && s.outside.every(x => neverPaid(rs, x)));
});
scenario('[5b]', 'seedcap vetoed the key on a copy at a player\'s seat, one table', VETO1, (s, rs) => {
  T('[5b] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[5b] past maturity his copy left out, the players\' table on a key of its own', ONE(rs[3], s.key) === '2/1', lines(rs[3]));
  T('[5b] no veto there: both paid in that run only, nobody flagged', !/seedcap over-cap veto/.test(outOf(rs)) && s.honest.every(x => paidOnlyIn(rs, x, 3))
    && nobodyHurt(rs, s.honest.concat(s.outside)) && s.outside.every(x => neverPaid(rs, x)), (outOf(rs).match(/[^\n]*seedcap[^\n]*/g) || []).join(' | '));
});
scenario('[5c]', 'control: an honest room whose key seedcap vetoed', VCTL, (s, rs) => {
  T('[5c] every run exits 0', allOk(rs, 4), outOf(rs).slice(-600));
  T('[5c] still vetoed on its own key: never paid, never processed, both writers flagged once, no table-split line',
    new RegExp('match=' + s.key + ': seedcap over-cap veto \\(seats 0,1\\) -- not settled').test(outOf(rs)) && s.honest.every(x => neverPaid(rs, x)) && keyNever(rs, s)
    && s.honest.every(x => fOf(rs[3], x) === 1) && !ANYSPLIT.test(outOf(rs)), (outOf(rs).match(/[^\n]*seedcap[^\n]*/g) || []).join(' | '));
});
scenario('[6]', 'a player of the room wrote his start and no result', LEAVE, (s, rs) => {
  T('[6] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[6] split past maturity into two keys (2 and 2); the room\'s table holds for the seat with no result',
    SPLIT(rs[3], s.key) === '2/2,2/0' && new RegExp('absent-hold ' + s.hk + ': seat 2 wrote no record').test(rs[3].out), lines(rs[3]));
  T('[6] the two players paid in the next run, past that hold -- not an hour later (his start was first read two hours ago)',
    s.honest.every(x => paidOnlyIn(rs, x, 4)) && !new RegExp('leave-wait ' + s.hk).test(outOf(rs)), lines(rs[4]) + ' ' + xpTable(rs, s.honest));
  T('[6] the outside table past the hold of the room\'s seats on it, once; he nothing', s.outside.every(x => paidOnce(rs, x)) && neverPaid(rs, s.gone), xpTable(rs, s.outside.concat([s.gone])));
  T('[6] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside, [s.gone])));
});
scenario('[7a]', 'residual 8 in a bot match: a modded member and his alt at the honest human\'s seat', RES8B, (s, rs) => {
  T('[7a] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[7a] split past maturity into two keys (1 and 2)', SPLIT(rs[3], s.key) === '2/1,2/0', lines(rs[3]));
  T('[7a] the honest human paid once on the lone lane (Q214: nothing); the two on theirs', lone(rs, s.hk) && s.honest.every(x => paidOnce(rs, x))
    && new RegExp('bots settle ' + s.xk + ': 2 writers').test(outOf(rs)) && s.outside.every(x => paidOnce(rs, x)), xpTable(rs, s.honest.concat(s.outside)));
  T('[7a] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});
scenario('[7b]', 'residual 8 in a two-human friends\' room (left open)', RES8F, (s, rs) => {
  T('[7b] every run exits 0', allOk(rs, 6), outOf(rs).slice(-600));
  T('[7b] split past maturity into two keys (1 and 2)', SPLIT(rs[3], s.key) === '2/1,2/0', lines(rs[3]));
  T('[7b] the honest player is a one-writer friends\' room table: nothing (as with Q214; the README residual), the two paid on theirs',
    new RegExp('match=' + s.hk + ': lone\\(1\\)').test(outOf(rs)) && s.honest.every(x => neverPaid(rs, x)) && s.outside.every(x => paidOnce(rs, x)), xpTable(rs, s.honest.concat(s.outside)));
  T('[7b] nobody counted as a leaver or flagged', nobodyHurt(rs, s.honest.concat(s.outside)));
});

{
  const s = LATE(), rs = timeline(s.steps, null, null), t = Date.now();
  const rooms = (r, sid) => (r.out.match(new RegExp('xp-bots ' + v.pid(sid).slice(0, 8) + ' ', 'g')) || []).length;
  const per = (sid) => rs.slice(5).map(r => rooms(r, sid));
  console.log('  [8] a table first written after the split (the Q220 review, F1)');
  T('[8] every run exits 0', allOk(rs, 9), outOf(rs).slice(-600));
  T('[8] both keys split past maturity into two keys (1 and 2), the two humans of each paid then (the precondition)',
    s.keys.every(k => SPLIT(rs[3], k) === '2/1,2/0') && s.honest.every(x => paidOnlyIn(rs, x, 3)), lines(rs[3]) + ' ' + xpTable(rs, s.honest));
  T('[8] a day later the original keys\' entries are still there, their t0 more than a day back (what the first draft gave a late table)',
    s.keys.every(k => pendOf(rs[5], k) && pendOf(rs[5], k).t0 < t - DAY), JSON.stringify(s.keys.map(k => pendOf(rs[5], k))));
  T('[8] his tables, first read a day after the split, move to keys of their own (logged once each)',
    s.keys.every(k => new RegExp('table-split ' + k + ': split before -- 1 table\\(s\\) written since on a key of their own').test(rs[5].out)) && s.lk.every((k, i) => k !== kOf(s.keys[i], s.late[1][i])), lines(rs[5]));
  T('[8] ... on entries that start now (not the original key\'s day-old t0): no match of his settles in that run (first draft: one a key)',
    s.lk.every(k => pendOf(rs[5], k) && pendOf(rs[5], k).t0 > t - HOUR) && rooms(rs[5], NA) === 0, JSON.stringify(s.lk.map(k => pendOf(rs[5], k))) + ' ' + lines(rs[5]));
  T('[8] in no round does he settle more matches than NC on keys of his own, nor in all (first draft: 2 / 2 / 2 against 0 / 1 / 1)',
    per(NA).slice(0, 3).every((n, i) => n <= per(NC)[i]) && per(NA).reduce((x, y) => x + y, 0) <= per(NC).reduce((x, y) => x + y, 0), 'NA ' + per(NA).join('/') + ' NC ' + per(NC).join('/'));
  T('[8] the humans of both rooms, NA and NC: nobody counted as a leaver or flagged (each outside account\'s own table, a bot match with no bot seat, is sanity-flagged: his alone)',
    nobodyHurt(rs, s.honest.concat([NA, NC])) && s.outside.every(x => fOf(rs[3], x) === 1));
}

{
  const s = GONE(), rs = timeline(s.steps, null, null), t = Date.now();
  const rooms = (r, sid) => (r.out.match(new RegExp('xp-bots ' + v.pid(sid).slice(0, 8) + ' ', 'g')) || []).length;
  const per = (sid) => rs.slice(4).map(r => rooms(r, sid));
  console.log('  [9] every result of the first split off the shards, new tables written each round (the Q220 review 2, S4)');
  T('[9] every run exits 0', allOk(rs, 9), outOf(rs).slice(-600));
  T('[9] both keys split past maturity into two keys (1 and 2), the two humans of each paid then (the precondition)',
    s.keys.every(k => SPLIT(rs[3], k) === '2/1,2/0') && s.honest.every(x => paidOnlyIn(rs, x, 3)), lines(rs[3]) + ' ' + xpTable(rs, s.honest));
  T('[9] the keys marked split in the processed list from the split on, the original entries and notes carrying the time they lent their t0',
    rs.slice(3).every(r => s.keys.every(k => processedOf(r).has(markOf(k)))) && s.keys.every(k => (pendOf(rs[3], k) || {}).lent > 0 && (pendOf(rs[3], '~' + k) || {}).lent > 0),
    JSON.stringify(s.keys.map(k => [pendOf(rs[3], k), pendOf(rs[3], '~' + k)])));
  T('[9] an hour on, with no table of the first split read, the original entries are still there, their t0 hours back (what rework 1 gave every table)',
    s.keys.every(k => pendOf(rs[4], k) && pendOf(rs[4], k).t0 < t - 2 * HOUR), JSON.stringify(s.keys.map(k => pendOf(rs[4], k))));
  T('[9] ... yet their tables move as split before (logged once each), on entries that start now: no match of NA or NB settles in that run (rework 1: one a key each, every round)',
    s.keys.every(k => new RegExp('table-split ' + k + ': split before -- 2 table\\(s\\) written since on a key of their own').test(rs[4].out)) && !s.keys.some(k => SPLIT(rs[4], k))
    && rooms(rs[4], NA) === 0 && rooms(rs[4], NB) === 0, lines(rs[4]));
  T('[9] in no round does NA or NB settle more matches than NC or ND on keys of their own, nor in all',
    [[NA, NC], [NB, ND]].every(([x, c]) => per(x).every((n, i) => n <= per(c)[i]) && per(x).reduce((p, q) => p + q, 0) <= per(c).reduce((p, q) => p + q, 0)),
    'NA ' + per(NA).join('/') + ' NC ' + per(NC).join('/') + ' NB ' + per(NB).join('/') + ' ND ' + per(ND).join('/'));
  T('[9] the humans of both rooms and the four: nobody counted as a leaver; nobody of the rooms flagged',
    nobodyHurt(rs, s.honest) && [NA, NB, NC, ND].every(x => rs.every(r => leavesOf(r, x) === 0)));
}
scenario('[10]', 'a one-seat table\'s result off the shards after the split, his start still on them', KEEP, (s, rs) => {
  T('[10] every run exits 0', allOk(rs, 9), outOf(rs).slice(-600));
  T('[10] split past maturity into three keys (1, 2 and 2), both two-writer tables paid then (the precondition)', SPLIT(rs[3], s.key) === '3/1,2,2/0'
    && s.honest.concat(s.outside).every(x => paidOnlyIn(rs, x, 3)), lines(rs[3]));
  T('[10] his table keeps its entry on complete reads hours on, its t0 as it was: the split keys of the starts on the shards are among the keys seen (a result written again settles on that clock)',
    rs.slice(3).every(r => !!pendOf(r, s.zk)) && pendOf(rs[6], s.zk).t0 === pendOf(rs[3], s.zk).t0 - 6 * HOUR - 5 * MIN && rs.slice(3).every(r => processedOf(r).has(markOf(s.key))),
    JSON.stringify(rs.map(r => pendOf(r, s.zk) || null)));
  T('[10] the processed list over its cap: the key\'s mark and the split keys of the paid tables kept while records of the key are on the shards, results or only starts (Q144 prune)',
    rs.slice(3).every(r => [markOf(s.key), s.hk, s.xk].every(k => processedOf(r).has(k))),
    JSON.stringify(rs.map(r => [markOf(s.key), s.hk, s.xk].map(k => processedOf(r).has(k)))) + ' ' + lines(rs[8], /[^\n]*processed:[^\n]*/g));
  T('[10] nobody counted as a leaver or flagged; nobody paid twice, he never', nobodyHurt(rs, s.honest.concat(s.outside, [s.lone1])) && neverPaid(rs, s.lone1)
    && s.honest.concat(s.outside).every(x => paidOnce(rs, x)));
});

if (failN) { console.log(failN + ' FAILED'); process.exit(1); }
console.log('all ok');
