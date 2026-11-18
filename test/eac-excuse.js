'use strict';
// O886 section C (2026-11-18): a seat the anti-cheat took out of a matchmade match is not a leaver.
//   Before: the removed client writes no settle record (client disposition 'eac-drop', innocent there), so here it was an
//   absent roster seat with a start of its own -- convicted like a quit (exit rate, the ranked fine, the streak). [3] below
//   is that old behaviour, kept as the control: records without the new block settle exactly as before.
//   Now: (a) the finishers' settle records carry a tail block [0xEA | ver << 8 | len << 16, seat bitmask] and a strict
//   majority of the writers naming the seat excuses it; (b) the seat's own exit note (0xBD) with disposition 9 excuses it
//   when nobody can witness; both under one cap per account (2 per 7 days, the user's call 2026-11-18); past the cap the
//   seat is convicted as before. An excused seat is treated as a Q56-excused dissenter (t2ex) at every site.
// End-to-end over the REAL validate.js main() against an offline stateful board stub (the harness of
//   test/leaver-own-record.js), plus units on the exported helpers.
//   [1] units: the block reader (tail walk, own seat, version, cut short, endless), the majority, the cap list
//   [2] ranked 3P, both finishers name the removed seat: no exit-rate hit, no points write, the excuse listed, the
//       finishers' own writes identical to the control's, summary row, `ew` on the writers
//   [3] control (old records, no block): convicted as before -- exit rate + 100 points
//   [4] the seat's own note: disposition 9 excuses (also when the note row is overwritten before the settle); any other
//       disposition, an outsider's note and a note for another key excuse nothing
//   [5] the cap: two listed excuses inside the window -> convicted; outside the window -> excused; block and note share it
//   [6] one of two writers names the seat: no majority, convicted; a block of an unknown version: read as no block
//   [7] a confessed quit named by the block: the confession counts, no excuse is spent; a named-only seat (no start of
//       his own): not convicted anyway, no excuse spent
//   [8] quick: no exit-rate hit; the EAC_EXCUSE_FINE knob (0 by default) takes the amount from an excused ranked seat
//   [9] an unseeded excused seat is not seeded (the t2ex sites: the plan's pids join the set before any of them is read)
//   [10] wiring pins + mutants (majority, cap, spend, note disposition, the join into t2ex, the reader switched off =
//        the control's bytes)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/strict-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['EAC_EXCUSE_CAP', 'EAC_EXCUSE_WINDOW_MS', 'EAC_EXCUSE_FINE', 'PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'LEAVE_CONFIRM_MS', 'ABSENT_GRACE_MS', 'STARTS_MATURITY_MS', 'GITHUB_STEP_SUMMARY'];
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eac-excuse-'));
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
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      // pin the season clock (test/leaver-own-record.js): every test runs before each production reconcile
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (test/leaver-own-record.js)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const noKey = (b) => b.replace(/&?key=[^&]*/, '');
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leaverOf = (r, sid) => ((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {};
const leavesOf = (r, sid) => leaverOf(r, sid).leaves | 0;
const edOf = (r, sid) => (leaverOf(r, sid).ed || []).length;
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const writesFor = (r, boardId, sid) => posts(r, boardId).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => noKey(p.body));
const pointsWritesFor = (r, sid) => writesFor(r, 7, sid);
const sumRow = (r) => { const m = /\| absent seats the anti-cheat removed, excused at a settle: [^|]*\| ([0-9]+) \/ ([0-9]+) \/ ([0-9]+) \|/.exec(r.summary || ''); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', X = '76561198000000088', U = '76561198000000066';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// 3P record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster, [tail]
const SC3 = [9000, 6000, 3000];
function rec3(magic, mt, hash, seat, ros, disp, tail) {
  const zero = magic !== 0xB1;   // a start (0xB2), a confession (0xB5) and an exit note (0xBD) carry zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : 1 + seat, zero ? 0 : ((6 << 1) | (seat === 0 ? 1 : 0)), 3, zero ? 0 : 720,
    zero ? 0 : SC3[0], zero ? 0 : SC3[1], zero ? 0 : SC3[2], disp | 0];
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d.concat(tail || []);
}
const ED = (mask, ver, len) => [(v.ED_MAGIC | ((ver == null ? v.ED_VER : ver) << 8) | ((len == null ? v.ED_LEN : len) << 16)) | 0, mask | 0];
const CHARS3 = [(0xD8 | (1 << 8) | (3 << 16)) | 0, 0x00020100];   // the 5.4a char block of a 3P record: header + ceil(3 / 4) words
const settle = (mt, hash, seat, ros, tail) => ({ sid: ros[seat], d: rec3(0xB1, mt, hash, seat, ros, 0, tail) });
const startRec = (mt, hash, seat, ros) => ({ sid: ros[seat], d: rec3(0xB2, mt, hash, seat, ros, 0) });
const note = (mt, hash, seat, ros, disp, sid) => ({ sid: sid || ros[seat], d: rec3(0xBD, mt, hash, seat, ros, disp) });
const confess = (mt, hash, seat, ros) => ({ sid: ros[seat], d: rec3(0xB5, mt, hash, seat, ros, 5) });
const keyOf = (mt, hash) => (hash | 0) + '_1234_' + mt;
function boardsWith(recs, noPoints) {   // recs: [{ sid, d }] spread over distinct shard rows (one account = one entry per shard)
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { const k = r.sid; used[k] = used[k] || 0; boards[used[k]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: [A, B, C, X].filter(s => !(noPoints || []).includes(s)).map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
// run 1 (first sighting, deferred by the start floor), run 2 one floor later (Q121: the absent seat is waited for),
//   run 3 past the leave confirmation: the group settles. recs2 / recs3 default to recs1.
function threeRuns(recs1, o) {
  o = o || {};
  const r1 = runCron(boardsWith(recs1, o.noPoints), o.files, o.env, o.script);
  const r2 = runCron(boardsWith(o.recs2 || recs1, o.noPoints), advance(r1.state, FLOOR + 1000), o.env, o.script);
  const r3 = runCron(boardsWith(o.recs3 || o.recs2 || recs1, o.noPoints), advance(r2.state, v.LEAVE_CONFIRM_MS), o.env, o.script);
  return { r1, r2, r3, allOk: r1.code === 0 && r2.code === 0 && r3.code === 0 };
}
const mutants = [];
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-eac-excuse-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  mutants.push(script);
  return script;
};
const EXCUSED = /removed by the anti-cheat \((named by [0-9] of [0-9] writers|his own exit note)\) -- excused, no conviction \(O886; [0-9] of 2 in the window\)/;
const ROS = [A, B, C];
// the standard table: A and B finished, C (seat 2) wrote his start and nothing else
const table = (mt, h, tailA, tailB, extra) => [settle(mt, h, 0, ROS, tailA), settle(mt, h, 1, ROS, tailB),
  startRec(mt, h, 0, ROS), startRec(mt, h, 1, ROS), startRec(mt, h, 2, ROS)].concat(extra || []);

console.log('=== a seat the anti-cheat removed is excused, not convicted (O886 section C) ===');
try {
  // ---- [1] units ----
  {
    T('[1] constants: block 0xEA v1 len 1; cap 2 per 7 days; fine 0; the note disposition is eac-drop (9)',
      v.ED_MAGIC === 0xEA && v.ED_VER === 1 && v.ED_LEN === 1 && v.EAC_EXCUSE.CAP === 2 && v.EAC_EXCUSE.WINDOW_MS === 7 * 86400000 && v.EAC_EXCUSE.FINE === 0
      && v.EAC_NOTE_DISP === 9 && v.dispName(9) === 'eac-drop' && v.NOTE_DISP.has(9), JSON.stringify(v.EAC_EXCUSE));
    const m = (seat, tail, mt) => v.eacDropMaskOf({ d: rec3(0xB1, mt == null ? 2 : mt, 1, seat, ROS, 0, tail) });
    T('[1] reader: the block right after the roster', m(0, ED(4)) === 4);
    T('[1] reader: after the char block; after an unknown block (walked past by its length)', m(0, CHARS3.concat(ED(4))) === 4 && m(0, [(0xDB | (1 << 8) | (1 << 16)) | 0, 2].concat(ED(6))) === 6, m(0, CHARS3.concat(ED(4))) + '');
    T('[1] reader: a later block stays readable behind it (the 0xE5 signature block comes last)', m(1, ED(4).concat([(0xE5 | (1 << 8) | (2 << 16)) | 0, 7, 8])) === 4);
    T('[1] reader: the writer\'s own seat is never named; bits past the seat count are dropped', m(2, ED(4)) === 0 && m(0, ED(0x3F)) === 6 && m(1, ED(0x3F)) === 5);
    T('[1] reader: no block / another version / a length this version does not have / cut short -> 0',
      m(0, []) === 0 && m(0, ED(4, 2)) === 0 && m(0, ED(4, 1, 2).concat([0])) === 0 && m(0, [ED(4)[0]]) === 0);
    T('[1] reader: an endless record never carries it (its tail is the depth tail)', m(0, ED(4), 7) === 0 && v.isEndlessMt(7));
    const g = (tails) => tails.map((t, i) => ({ steamID: 'w' + (t.sid == null ? i : t.sid), d: rec3(0xB1, 2, 1, t.seat == null ? i : t.seat, ROS, 0, t.tail) }));
    const seats = (tails) => Object.keys(v.eacDropSeats(g(tails))).join(',');
    T('[1] majority: two of two', seats([{ tail: ED(4) }, { tail: ED(4) }]) === '2');
    T('[1] majority: one of two is none (strict)', seats([{ tail: ED(4) }, { tail: [] }]) === '');
    T('[1] majority: two of three', seats([{ tail: ED(4) }, { tail: ED(4) }, { tail: [], seat: 1, sid: 9 }]) === '2');
    T('[1] majority: one account writing twice is one vote', seats([{ tail: ED(4), sid: 1 }, { tail: ED(4), sid: 1 }, { tail: [], sid: 2, seat: 1 }]) === '');
    const now = 1800000000000, L = {};
    T('[1] cap list: empty state reads 0', v.eacExcuseUsed(L, 'p', now) === 0);
    v.noteEacExcuse(L, 'p', now - 8 * 86400000); v.noteEacExcuse(L, 'p', now - 86400000);
    T('[1] cap list: an excuse older than the window does not count', v.eacExcuseUsed(L, 'p', now) === 1, JSON.stringify(L));
    v.noteEacExcuse(L, 'p', now);
    T('[1] cap list: pruned when written (the old one is gone), no leave counted', L.p.ed.length === 2 && v.eacExcuseUsed(L, 'p', now) === 2 && (L.p.leaves | 0) === 0 && !Array.isArray(L.p.w), JSON.stringify(L));
  }

  // ---- [2] both finishers name the removed seat / [3] the control ----
  const H2 = 0x8861;
  const ex = threeRuns(table(2, H2, ED(4), ED(4)));
  const ctl = threeRuns(table(2, H2));
  {
    const r = ex.r3;
    T('[2] three runs exit 0; the match settles on run 3 (after the Q121 wait)', ex.allOk && !processedOf(ex.r2).has(keyOf(2, H2)) && processedOf(r).has(keyOf(2, H2)), r.out.slice(-600));
    T('[2] C: no exit-rate hit', leavesOf(r, C) === 0, 'leaves=' + leavesOf(r, C));
    T('[2] C: no points write at all (2500 stays)', pointsWritesFor(r, C).length === 0, JSON.stringify(pointsWritesFor(r, C)));
    T('[2] C: no rating write, no XP write', writesFor(r, 6, C).length === 0 && writesFor(r, 5, C).length === 0);
    T('[2] logged as excused, named by both writers, 1 of 2 used', EXCUSED.test(r.out) && /named by 2 of 2 writers/.test(r.out) && /1 of 2 in the window/.test(r.out) && !/leaver LP /.test(r.out),
      r.out.split('\n').filter(l => /leaver/.test(l)).join(' | '));
    T('[2] the excuse is listed on his leaver state (one entry, epoch seconds)', edOf(r, C) === 1 && leaverOf(r, C).ed[0] > 1.7e9 && leaverOf(r, C).ed[0] < 3e9, JSON.stringify(leaverOf(r, C)));
    T('[2] summary row: 1 / 0 / 0', JSON.stringify(sumRow(r)) === '[1,0,0]', JSON.stringify(sumRow(r)));
    T('[2] each writer who named him carries ew once (record only)', (sigOf(r, A).ew | 0) === 1 && (sigOf(r, B).ew | 0) === 1 && !(sigOf(r, C).ew | 0), 'A.ew=' + sigOf(r, A).ew + ' B.ew=' + sigOf(r, B).ew);
    for (const [name, sid] of [['A', A], ['B', B]]) for (const [bn, id] of [['points', 7], ['rating', 6], ['XP', 5]])
      T('[2] ' + name + '\'s ' + bn + ' writes are the control\'s byte for byte (the finishers settle as they did)',
        JSON.stringify(writesFor(r, id, sid)) === JSON.stringify(writesFor(ctl.r3, id, sid)) && (id !== 7 || writesFor(r, id, sid).length >= 1), JSON.stringify(writesFor(r, id, sid)) + ' vs ' + JSON.stringify(writesFor(ctl.r3, id, sid)));
  }
  {
    const r = ctl.r3, w = pointsWritesFor(r, C);
    T('[3] control (no block, the records every client before this wrote): C convicted, one exit-rate hit', ctl.allOk && leavesOf(r, C) === 1, 'leaves=' + leavesOf(r, C));
    T('[3] control: C loses 100 points (2500 -> 2400)', w.length === 1 && /score=2400(&|$)/.test(w[0]), JSON.stringify(w));
    T('[3] control: no excuse listed, nothing in the summary row, no ew', edOf(r, C) === 0 && JSON.stringify(sumRow(r)) === '[0,0,0]' && !(sigOf(r, A).ew | 0) && !EXCUSED.test(r.out));
  }

  // ---- [4] the seat's own note ----
  {
    const h = 0x8862, N9 = note(2, h, 2, ROS, 9);
    const a = threeRuns(table(2, h, null, null, [N9]));
    T('[4] his own eac-drop note (nobody named him): excused, counted as a note excuse', a.allOk && leavesOf(a.r3, C) === 0 && pointsWritesFor(a.r3, C).length === 0 && edOf(a.r3, C) === 1
      && /his own exit note\) -- excused/.test(a.r3.out) && JSON.stringify(sumRow(a.r3)) === '[0,1,0]' && !(sigOf(a.r3, A).ew | 0), a.r3.out.split('\n').filter(l => /leaver/.test(l)).join(' | '));
    T('[4] the note is kept on the starts entry from its first sighting (p.nd)', JSON.stringify(((a.r1.state.STARTS_FILE || {})[keyOf(2, h)] || {}).nd) === JSON.stringify([v.pid(C)]), JSON.stringify((a.r1.state.STARTS_FILE || {})[keyOf(2, h)]));
    const b = threeRuns(table(2, h + 1, null, null, [note(2, h + 1, 2, ROS, 9)]), { recs2: table(2, h + 1), recs3: table(2, h + 1) });
    T('[4] the note row overwritten before the settle: still excused (remembered)', b.allOk && leavesOf(b.r3, C) === 0 && edOf(b.r3, C) === 1);
    for (const [disp, nm] of [[2, 'host-left'], [3, 'level-begin-timeout'], [4, 'migrate-disband'], [5, 'user-quit']]) {
      const c = threeRuns(table(2, h + 10 + disp, null, null, [note(2, h + 10 + disp, 2, ROS, disp)]));
      T('[4] a ' + nm + ' note on a key that settles changes nothing (Q64): convicted', c.allOk && leavesOf(c.r3, C) === 1 && edOf(c.r3, C) === 0 && pointsWritesFor(c.r3, C).length === 1, 'leaves=' + leavesOf(c.r3, C));
    }
    const d = threeRuns(table(2, h + 20, null, null, [note(2, h + 20, 2, ROS, 9, X)]));
    T('[4] an outsider\'s eac-drop note for the key excuses nobody and is not kept on the entry', d.allOk && leavesOf(d.r3, C) === 1 && edOf(d.r3, C) === 0 && edOf(d.r3, X) === 0
      && ((d.r1.state.STARTS_FILE || {})[keyOf(2, h + 20)] || {}).nd === undefined, JSON.stringify((d.r1.state.STARTS_FILE || {})[keyOf(2, h + 20)]));
    const e = threeRuns(table(2, h + 21, null, null, [note(2, h + 22, 2, ROS, 9)]));
    T('[4] his eac-drop note for another key excuses nothing here', e.allOk && leavesOf(e.r3, C) === 1 && edOf(e.r3, C) === 0);
  }

  // ---- [5] the cap ----
  {
    const nowS = Math.floor(Date.now() / 1000), day = 86400;
    const withEd = (list) => ({ files: { LEAVERS_FILE: { [v.pid(C)]: { leaves: 0, lastMatch: '', ed: list } } } });
    const a = threeRuns(table(2, 0x8871, ED(4), ED(4)), withEd([nowS - 2 * day, nowS - day]));
    const w = pointsWritesFor(a.r3, C);
    T('[5] two excuses inside 7 days: the third removal is convicted as a leave (exit rate + 100 points)', a.allOk && leavesOf(a.r3, C) === 1 && w.length === 1 && /score=2400(&|$)/.test(w[0]), 'leaves=' + leavesOf(a.r3, C) + ' ' + JSON.stringify(w));
    T('[5] ... logged and counted as past the cap, the list is not grown', /past 2 excuses in the window -- convicted as a leave \(O886\)/.test(a.r3.out) && JSON.stringify(sumRow(a.r3)) === '[0,0,1]' && edOf(a.r3, C) === 2 && !(sigOf(a.r3, A).ew | 0),
      JSON.stringify(sumRow(a.r3)) + ' ed=' + edOf(a.r3, C));
    const b = threeRuns(table(2, 0x8872, ED(4), ED(4)), withEd([nowS - 9 * day, nowS - 8 * day]));
    T('[5] both older than the window: excused again, the old ones pruned', b.allOk && leavesOf(b.r3, C) === 0 && edOf(b.r3, C) === 1, 'ed=' + JSON.stringify(leaverOf(b.r3, C).ed));
    const c = threeRuns(table(2, 0x8873, ED(4), ED(4)), withEd([nowS - day]));
    T('[5] one inside the window: excused, the list holds two', c.allOk && leavesOf(c.r3, C) === 0 && edOf(c.r3, C) === 2 && /2 of 2 in the window/.test(c.r3.out));
    const d = threeRuns(table(2, 0x8874, null, null, [note(2, 0x8874, 2, ROS, 9)]), withEd([nowS - 2 * day, nowS - day]));
    T('[5] the note shares the cap: his own note past it is convicted too', d.allOk && leavesOf(d.r3, C) === 1 && JSON.stringify(sumRow(d.r3)) === '[0,0,1]', 'leaves=' + leavesOf(d.r3, C));
    const e = threeRuns(table(2, 0x8875, ED(4), ED(4)), Object.assign(withEd([nowS - 2 * day, nowS - day]), { env: { EAC_EXCUSE_CAP: '3' } }));
    T('[5] the cap is a job setting (EAC_EXCUSE_CAP=3: the third is excused)', e.allOk && leavesOf(e.r3, C) === 0 && edOf(e.r3, C) === 3);
  }

  // ---- [6] no majority / a version this job does not read ----
  {
    const a = threeRuns(table(2, 0x8881, ED(4), null));
    T('[6] one of two writers names him: no majority, convicted as before', a.allOk && leavesOf(a.r3, C) === 1 && edOf(a.r3, C) === 0 && pointsWritesFor(a.r3, C).length === 1 && !(sigOf(a.r3, A).ew | 0));
    T('[6] ... and the match still settles (the block is in no consistency vector: A carries it, B does not)', processedOf(a.r3).has(keyOf(2, 0x8881)) && !/forg|inconsistent/i.test(a.r3.out.split('\n').filter(l => l.indexOf(keyOf(2, 0x8881)) >= 0).join(' ')));
    const b = threeRuns(table(2, 0x8882, ED(4, 2), ED(4, 2)));
    T('[6] a block of version 2 is read as no block: settles, convicted as before', b.allOk && processedOf(b.r3).has(keyOf(2, 0x8882)) && leavesOf(b.r3, C) === 1 && edOf(b.r3, C) === 0);
  }

  // ---- [7] not his to excuse ----
  {
    const h = 0x8891;
    const a = threeRuns(table(2, h, ED(4), ED(4), [confess(2, h, 2, ROS)]));
    T('[7] a confessed quit named by the block: his confession counts (one exit-rate hit), no excuse spent', a.allOk && leavesOf(a.r3, C) === 1 && edOf(a.r3, C) === 0 && !EXCUSED.test(a.r1.out + a.r2.out + a.r3.out),
      'leaves=' + leavesOf(a.r3, C) + ' ed=' + edOf(a.r3, C));
    const recs = [settle(2, h + 1, 0, ROS, ED(4)), settle(2, h + 1, 1, ROS, ED(4)), startRec(2, h + 1, 0, ROS), startRec(2, h + 1, 1, ROS)];
    const b = threeRuns(recs);
    T('[7] a named-only seat (no start of his own, Q69) named by the block: not convicted anyway, no excuse spent, no ew', b.allOk && leavesOf(b.r3, C) === 0 && edOf(b.r3, C) === 0 && !EXCUSED.test(b.r2.out + b.r3.out)
      && !(sigOf(b.r3, A).ew | 0) && pointsWritesFor(b.r3, C).length === 0 && /not a leaver \(Q69\)/.test(b.r2.out + b.r3.out));
  }

  // ---- [8] quick / the fine knob ----
  {
    const q = threeRuns(table(1, 0x88a1, ED(4), ED(4)));
    const qc = threeRuns(table(1, 0x88a2));
    T('[8] quick: excused -- no exit-rate hit (the control gets one)', q.allOk && qc.allOk && leavesOf(q.r3, C) === 0 && edOf(q.r3, C) === 1 && leavesOf(qc.r3, C) === 1);
    const f = threeRuns(table(2, 0x88a3, ED(4), ED(4)), { env: { EAC_EXCUSE_FINE: '20' } });
    const w = pointsWritesFor(f.r3, C);
    T('[8] EAC_EXCUSE_FINE=20: an excused ranked seat pays 20 (2500 -> 2480), still no exit-rate hit', f.allOk && leavesOf(f.r3, C) === 0 && w.length === 1 && /score=2480(&|$)/.test(w[0]) && /excused LP [^\n]* pts 2500-20->2480/.test(f.r3.out),
      'leaves=' + leavesOf(f.r3, C) + ' ' + JSON.stringify(w));
    const fq = threeRuns(table(1, 0x88a4, ED(4), ED(4)), { env: { EAC_EXCUSE_FINE: '20' } });
    T('[8] ... a quick seat never (no points surface)', fq.allOk && pointsWritesFor(fq.r3, C).length === 0);
  }

  // ---- [9] the t2ex sites: an unseeded excused seat is not seeded ----
  const H9 = 0x88b1;
  {
    const a = threeRuns(table(2, H9, ED(4), ED(4)), { noPoints: [C] });
    const c = threeRuns(table(2, H9), { noPoints: [C] });
    T('[9] control: an unseeded leaver is seeded, then fined (a points write for C)', c.allOk && pointsWritesFor(c.r3, C).length >= 1 && /leaver, first settle this season/.test(c.r3.out), JSON.stringify(pointsWritesFor(c.r3, C)));
    T('[9] excused: no seed, no points row made for him', a.allOk && pointsWritesFor(a.r3, C).length === 0 && !/leaver, first settle this season/.test(a.r3.out) && leavesOf(a.r3, C) === 0, JSON.stringify(pointsWritesFor(a.r3, C)));
  }

  // ---- [10] wiring pins + mutants ----
  {
    const iT2 = SRC.indexOf('const t2ex = new Set(Array.isArray(c.t2ex) ? c.t2ex.map(String) : []);'), iJoin = SRC.indexOf('for (const h of edPlan.ex.keys()) t2ex.add(h);');
    const sites = ['const lossSide = (!PT_MODE && isTeamMt(matchType)) ? teamLossCounted(', 'if (t2ex.has(pid(String(x.steamID)))) continue;   // Q56 excused: this match does not count for him',
      '&& !t2ex.has(pid(String(x.steamID)))) ghostLoss.push(x);', "if (confState[hx + '|' + c.m] || t2ex.has(hx)) continue;   // not convicted below"];
    T('[10] the plan joins t2ex right after the set is made, ahead of every site that reads it (Q136 loss side, the placement seed, the Q167 ghost loss, the late-result shadow)',
      iT2 > 0 && iJoin > iT2 && iJoin - iT2 < 1200 && sites.every((s) => SRC.split(s).length === 2 && SRC.indexOf(s) > iJoin), [iT2, iJoin].concat(sites.map((s) => SRC.indexOf(s))).join(','));
    T('[10] every reader of the local t2ex set is one of those four or the conviction loop (a new one must be decided here)', (SRC.slice(iT2).match(/\bt2ex\.has\(/g) || []).length === 7, String((SRC.slice(iT2).match(/\bt2ex\.has\(/g) || []).length));
    const iSpend = SRC.indexOf('noteEacExcuse(leavers, hx, nowMs);'), iDone = SRC.indexOf('processed.add(c.m); settled++; likeKeys.push(c.m);');
    T('[10] the cap is spent in the conviction loop only (after it the settle cannot be deferred), once', iSpend > iJoin && iSpend < iDone && SRC.split('noteEacExcuse(').length === 3, [iSpend, iDone, SRC.split('noteEacExcuse(').length].join(','));
    T('[10] a confessed or already excused seat is not the plan\'s', SRC.indexOf("eacExcusePlan(g, leavers0, pend, leavers, nowMs, (h) => !!confState[h + '|' + c.m] || confSeen.has(h + '|' + c.m) || t2ex.has(h));") > iT2);

    const MT = [
      ['[10a] majority', 'if (votes[s].length * 2 > seen.size) out[s] = votes[s];', 'if (votes[s].length * 2 >= seen.size) out[s] = votes[s];',
        () => table(2, 0x8881, ED(4), null), null, (m) => leavesOf(m.r3, C) === 0, 'one of two writers excuses'],
      ['[10b] cap', 'if (eacExcuseUsed(leavers, h, now) >= EAC_EXCUSE.CAP) {', 'if (eacExcuseUsed(leavers, h, now) >= 99) {',
        () => table(2, 0x8871, ED(4), ED(4)), 'cap', (m) => leavesOf(m.r3, C) === 0, 'the third removal is excused'],
      ['[10c] note disposition', 'if ((n.dispCode | 0) !== EAC_NOTE_DISP) continue;', 'if ((n.dispCode | 0) === 0) continue;',
        () => table(2, 0x8864, null, null, [note(2, 0x8864, 2, ROS, 2)]), null, (m) => leavesOf(m.r3, C) === 0, 'a host-left note excuses on a key that settles'],
      ['[10d] roster member', "if (!p || !p.roster || !Object.keys(p.roster).some((seat) => p.roster[seat] === h)) continue;\n    if (!Array.isArray(p.nd)) p.nd = [];", "if (!p || !p.roster) continue;\n    if (!Array.isArray(p.nd)) p.nd = [];",
        () => table(2, 0x8876, null, null, [note(2, 0x8876, 2, ROS, 9, X)]), null, (m) => JSON.stringify(((m.r1.state.STARTS_FILE || {})[keyOf(2, 0x8876)] || {}).nd || []) === JSON.stringify([v.pid(X)]), 'an outsider\'s note is kept on the entry'],
      ['[10e] join', 'for (const h of edPlan.ex.keys()) t2ex.add(h);', '',
        () => table(2, H9, ED(4), ED(4)), 'nopts', (m) => pointsWritesFor(m.r3, C).length >= 1, 'an unseeded excused seat is seeded'],
      ['[10f] own seat', '& 0x3F & ~(1 << (d[5] | 0)) & ((1 << pc) - 1)) : 0;\n    k += 1 + len;\n  }\n  return 0;\n}\n// the seats a strict majority', '& 0x3F & ((1 << pc) - 1)) : 0;\n    k += 1 + len;\n  }\n  return 0;\n}\n// the seats a strict majority',
        null, 'unit-own', null, 'a writer names his own seat'],
    ];
    for (const [tag, from, to, recsOf, mode, red, what] of MT) {
      const s = mutant(from, to, tag);
      if (!s) continue;
      if (mode === 'unit-own') {
        const mv = require(s);
        T(tag + ' mutant (' + what + '): the unit in [1] goes red', mv.eacDropMaskOf({ d: rec3(0xB1, 2, 1, 2, ROS, 0, ED(4)) }) === 4);
        continue;
      }
      const nowS = Math.floor(Date.now() / 1000);
      const o = { script: s };
      if (mode === 'cap') o.files = { LEAVERS_FILE: { [v.pid(C)]: { leaves: 0, lastMatch: '', ed: [nowS - 2 * 86400, nowS - 86400] } } };
      if (mode === 'nopts') o.noPoints = [C];
      const m = threeRuns(recsOf(), o);
      T(tag + ' mutant (' + what + '): the case above goes red', m.allOk && !!red(m), 'leaves=' + leavesOf(m.r3, C) + ' ' + JSON.stringify(pointsWritesFor(m.r3, C)) + ' ' + m.r3.out.slice(-300));
    }
    // the spend removed: an account with one excuse listed is excused and the list does not grow
    const s2 = mutant('        noteEacExcuse(leavers, hx, nowMs);\n', '', '[10g]');
    if (s2) {
      const m = threeRuns(table(2, 0x8861, ED(4), ED(4)), { script: s2 });
      T('[10g] mutant (the excuse is not listed): [2]\'s list stays empty', m.allOk && leavesOf(m.r3, C) === 0 && edOf(m.r3, C) === 0);
    }
    // the reader switched off: a job that does not know the block settles the same records exactly as the control ([3])
    const s3 = mutant('if (mg === ED_MAGIC && ver === ED_VER) return', 'if (mg === 0x1ff && ver === ED_VER) return', '[10h]');
    if (s3) {
      const m = threeRuns(table(2, H2, ED(4), ED(4)), { script: s3 });
      const same = [A, B, C].every((sid) => [5, 6, 7].every((id) => JSON.stringify(writesFor(m.r3, id, sid)) === JSON.stringify(writesFor(ctl.r3, id, sid))));
      T('[10h] reader off (a job that does not know the block): the block-carrying records settle byte for byte as the control -- C convicted, same writes for A, B, C',
        m.allOk && same && leavesOf(m.r3, C) === 1 && edOf(m.r3, C) === 0, 'leaves=' + leavesOf(m.r3, C));
    }
  }
} finally {
  for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} }
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (eac-excuse) ===' : '=== PASS -- 0 fail (eac-excuse) ===');
process.exit(failN ? 1 : 0);
