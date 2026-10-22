'use strict';
// Q64 (cloud audit 2026-10): exit notes (0xBD). A matchmade match that dies on every survivor -- the host is lost and the
//   migration fails (no new host reachable, or nobody joined the elected one), or the host left and nobody is the sole
//   survivor -- sends every client to the menu without a settle record. Before: the start-orphan verdict (reconcileStarts)
//   charged an exit-rate hit to EVERY roster seat that wrote its own start, the honest opponents included (in a matchmade
//   2V2 the host's teammate is always the elected host, so a host team that drops together sent both opponents to the menu
//   with a quit each). Now the client writes an exit note on that path; the verdict skips a roster member whose own note
//   (disp 2 host-left / 3 level-begin-timeout [Q221] / 4 migrate-disband) for the key was read while the key was pending.
//   A key that settles never looks at notes.
// Q221 (cloud audit 2026-10-20): a joiner that waited 60 s for the next-level frame while the host's heartbeat stayed alive
//   goes to the menu without a settle record as well (a modified host that answers heartbeats and never sends the frame sent
//   the whole honest table to the menu, a quit each at maturity, while his own lone record spared him) -> disp 3 joins NOTE_DISP.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (the harness of
//   test/late-start-roster.js), plus direct reconcileStarts units.
//   [1] constants + reconcileStarts units: a noted seat is spared (logged, counted); p.noted is cumulative (the note can
//       rotate off its shard before maturity); roster members only; the note must carry this key; a confession still
//       counts its leave once; a consistent key is never judged here
//   [2] E1 matchmade 2V2 (mt 5): the host and his teammate (the elected host) crash, the opponents write notes
//       (migrate-disband): at maturity the host side has a hit each, the opponents none; summary row; control without notes
//   [3] E2 three-player quick (mt 1): the host crashes, the other two cannot reach each other; notes host-left /
//       migrate-disband: only the host is hit
//   [4] E3 notes with another disp (user-quit 5, eac-kick 8, kicked 7, eac-drop 9, finished 0, reconnect-failed 6) spare nobody
//   [5] E4 the notes are read once, then overwritten before maturity: still spared
//   [6] E5 a settled match (ranked mt 2, one seat dropped and wrote a note): the note changes nothing, the absent seat is a
//       leaver exactly as without it (same exit-rate, same points posts)
//   [7] E6 an outsider's note for the key spares nobody; E7 a roster member's note for another key spares nothing here
//   [8] E8 confession + note of the same player: one exit-rate hit (the confession), not two, not zero
//   [9] E9 trust: a lone settle record (0xB1) of a roster member already exempts him today -- the note opens nothing new
//   [10] mutants: no spare (the honest opponents are hit again); every disp accepted (E3 spared); the key ignored
//        (E7 spared); notes read only in the current run (E4 hit again)
//   [11] wiring pins
//   [12] Q221: E10 three-player quick, the host withholds the next-level frame (heartbeat alive): both joiners write
//        level-begin-timeout notes and are spared, the host's lone record keeps him exempt (no lone record: he is hit);
//        an old client's table (no notes) is hit as before; E11 the same timeout on one half-dead joiner while the other two
//        settle: he is a leaver exactly as without the note; E12 a ranked 1V1 whose joiner's link went bad: the host's lone
//        record and the joiner's note -- nobody hit; mutant (disp 3 dropped from NOTE_DISP): the joiners are hit again
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'LEAVE_CONFIRM_MS'];
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-note-'));
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
      // pin the season clock (test/late-start-roster.js): every test runs before each production reconcile
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (test/late-start-roster.js)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const pointPosts = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && /leaderboardid=7(&|$)/.test(p.body)).map(p => p.body.replace(/&?key=[^&]*/, ''));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2), a confession (0xB5) and an exit note (0xBD) carry zeroed results
  const d = [magic, zero ? 1 : 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : sc[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const start = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB2, mt, h, seat, 0, false, ros) });
const note = (mt, h, ros, seat, disp, sid) => ({ sid: sid || ros[seat], d: rec(0xBD, mt, h, seat, 0, false, ros, null, disp) });
const confess = (mt, h, ros, seat) => ({ sid: ros[seat], d: rec(0xB5, mt, h, seat, 0, false, ros, null, 5) });
const settle = (mt, h, ros, seat, rank, win, sc, disp) => ({ sid: ros[seat], d: rec(0xB1, mt, h, seat, rank, win, ros, sc, disp) });
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

// one id set per scenario (one account = one entry per shard; the steps reuse the boards)
const ids = (a) => a.map(SID);
const E1P = ids([201, 202, 203, 204]), E1C = ids([205, 206, 207, 208]), E2P = ids([211, 212, 213]), E3P = ids([221, 222, 223, 224]);
const E4P = ids([231, 232, 233, 234]), E5P = ids([241, 242, 243]), E5Q = ids([245, 246, 247]), E6P = ids([251, 252, 253, 254]), E6X = SID(255);
const E7P = ids([261, 262, 263, 264]), E8P = ids([271, 272, 273, 274]), E9P = ids([281, 282, 283, 284]);
const M1P = ids([291, 292, 293, 294]), M2P = ids([295, 296, 297, 298]), M3P = ids([301, 302, 303, 304]), M4P = ids([305, 306, 307, 308]);
const QAP = ids([311, 312, 313]), QBP = ids([314, 315, 316]), QCP = ids([317, 318, 319]), QDP = ids([321, 322, 323]), QDQ = ids([324, 325, 326]);
const QEP = ids([327, 328]), QMP = ids([331, 332, 333]);
const ALL = [].concat(E1P, E1C, E2P, E3P, E4P, E5P, E5Q, E6P, [E6X], E7P, E8P, E9P, M1P, M2P, M3P, M4P, QAP, QBP, QCP, QDP, QDQ, QEP, QMP);
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
function timeline(steps, script) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');
const sumN = (rs, re) => rs.reduce((n, r) => { const m = re.exec(r.summary); return n + (m ? Number(m[1]) : 0); }, 0);
const sparedN = (rs) => sumN(rs, /\| start-orphan seats spared by their own exit note \(Q64\) \| ([0-9]+) \|/);
const SPARED = /start-orphan [^\n]*exit-rate hits[^\n]*spared \(own exit note: [0-9a-f,]+, Q64\)/;
const leaves = (r, P) => P.map(s => leavesOf(r, s));
// an all-absent key: the starts are read, the notes from the second run on, then the verdict past maturity (2 h)
const absentSteps = (S, N, Nlast) => [[0, S], [5 * MIN, S.concat(N)], [10 * MIN, S.concat(N)], [2 * HOUR, S.concat(Nlast == null ? N : Nlast)]];
const mutant = (from, to, tag) => {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant: anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-exit-note-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
};

console.log('=== exit notes: a match that died on every survivor charges no exit-rate to the seats that say so (Q64) ===');

// ---- [1] constants + reconcileStarts units ----
const seatIn = (writer, roster) => { for (const k of Object.keys(roster || {})) if (roster[k] === writer) return k | 0; return -1; };
const mkStart = (writer, roster, hash) => { const d = []; d[2] = 5; d[3] = (hash == null ? 111 : hash); d[4] = 7; d[5] = seatIn(writer, roster); return { start: true, steamID: writer, d, roster }; };
const KEY = '111_7_5', MAT = 2 * HOUR;
{
  T('[1] NOTE_MAGIC 0xBD (0xB1..0xBC all taken on the client)', v.NOTE_MAGIC === 0xBD);
  T('[1] NOTE_DISP = { host-left, level-begin-timeout, migrate-disband } exactly (Q221 added level-begin-timeout)', v.NOTE_DISP instanceof Set && v.NOTE_DISP.size === 3
    && [...v.NOTE_DISP].map(v.dispName).sort().join(',') === 'host-left,level-begin-timeout,migrate-disband', JSON.stringify([...(v.NOTE_DISP || [])]));
  const [A, B, C, D] = ids([101, 102, 103, 104]), X = SID(109);
  const R4 = { 0: A, 1: B, 2: C, 3: D };
  const pend0 = () => ({ [KEY]: { t0: 0, mt: 5, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(C), 3: v.pid(D) }, settled: [], started: [A, B, C, D].map(v.pid) } });
  const nset = (...xs) => new Set(xs.map(([s, k]) => v.pid(s) + '|' + (k || KEY)));
  // the verdict: noted seats spared, the rest hit
  {
    const pending = pend0(), leavers = {}, processed = new Set();
    const r = v.reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 1, MAT, {}, true, 0, new Set([KEY]), nset([C], [D]));
    T('[1] two noted seats spared, two hit', r.convicted === 2 && (leavers[v.pid(A)] || {}).leaves === 1 && (leavers[v.pid(B)] || {}).leaves === 1 && !leavers[v.pid(C)] && !leavers[v.pid(D)]
      && processed.has(KEY) && !pending[KEY], JSON.stringify(leavers));
  }
  // cumulative: read once while pending, gone at maturity
  {
    const pending = pend0(), leavers = {}, processed = new Set();
    v.reconcileStarts([], {}, new Set(), processed, pending, leavers, HOUR, MAT, {}, true, 0, new Set([KEY]), nset([C]));
    T('[1] p.noted captured while the note is visible (pids only)', JSON.stringify(pending[KEY].noted) === JSON.stringify([v.pid(C)]));
    v.reconcileStarts([], {}, new Set(), processed, pending, leavers, HOUR + 1, MAT, {}, true, 0, new Set([KEY]), nset([C]));
    T('[1] the same note read again: listed once', JSON.stringify(pending[KEY].noted) === JSON.stringify([v.pid(C)]));
    const r = v.reconcileStarts([], {}, new Set(), processed, pending, leavers, MAT + 1, MAT, {}, true, 0, new Set([KEY]), new Set());
    T('[1] the note overwritten before maturity: still spared', r.convicted === 3 && !leavers[v.pid(C)], JSON.stringify(leavers));
  }
  // roster members only; the key must match
  {
    const pending = pend0(), leavers = {};
    v.reconcileStarts([], {}, new Set(), new Set(), pending, leavers, HOUR, MAT, {}, true, 0, new Set([KEY]), nset([X], [A, '111_8_5']));
    T('[1] an outsider\'s note and a note for another key: nothing noted', !('noted' in pending[KEY]), JSON.stringify(pending[KEY]));
  }
  // a confession counts the leave once, the note does not refund it
  {
    const pending = pend0(), leavers = { [v.pid(B)]: { leaves: 1, lastMatch: KEY } };
    const r = v.reconcileStarts([], {}, new Set(), new Set(), pending, leavers, MAT + 1, MAT, { [v.pid(B) + '|' + KEY]: { amt: 0 } }, true, 0, new Set([KEY]), nset([B]));
    T('[1] confession + note: the confession\'s one leave stays, no second', leavers[v.pid(B)].leaves === 1 && r.convicted === 3, JSON.stringify(leavers));
  }
  // a consistent key is the normal pipeline's: no verdict here, notes or not
  {
    const pending = pend0(), leavers = {};
    const r = v.reconcileStarts([], {}, new Set([KEY]), new Set(), pending, leavers, MAT + 1, MAT, {}, true, 0, new Set([KEY]), nset([A], [B], [C], [D]));
    T('[1] consistent key: no verdict, nothing spared, nobody hit', r.convicted === 0 && JSON.stringify(leavers) === '{}' && pending[KEY], JSON.stringify(leavers));
  }
  // an older caller (no 13th argument) behaves exactly as before
  {
    const pending = pend0(), leavers = {};
    const r = v.reconcileStarts([], {}, new Set(), new Set(), pending, leavers, MAT + 1, MAT, {}, true, 0, new Set([KEY]));
    T('[1] no notes argument: every seat with its own start hit as before', r.convicted === 4, String(r.convicted));
  }
  // a seat named by others only (no own start) is not convicted anyway; its note changes nothing
  {
    const pending = pend0(); pending[KEY].started = [A, B, C].map(v.pid);
    const leavers = {};
    const r = v.reconcileStarts([], {}, new Set(), new Set(), pending, leavers, MAT + 1, MAT, {}, true, 0, new Set([KEY]), nset([D]));
    T('[1] a noted seat without its own start: still not convicted (Q69), the other three hit', r.convicted === 3 && !leavers[v.pid(D)], JSON.stringify(leavers));
  }
  // registration from real starts: the note list starts empty
  {
    const pending = {};
    v.reconcileStarts([mkStart(A, R4), mkStart(B, R4)], {}, new Set(), new Set(), pending, {}, 1000, MAT, {}, true, undefined, new Set([KEY]), new Set());
    T('[1] a fresh entry carries no noted list until a note is read', pending[KEY] && !('noted' in pending[KEY]), JSON.stringify(pending[KEY]));
  }
}

// ---- [2] E1 matchmade 2V2 (quick, mt 5): host H + teammate T (elected) crash, opponents O1 / O2 go to the menu ----
const e1 = (P, withNotes, disp) => {
  const h = 0x9601, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = withNotes ? [note(5, h, P, 2, disp == null ? 4 : disp), note(5, h, P, 3, disp == null ? 4 : disp)] : [];
  return { key: keyOf(S[0].d), steps: absentSteps(S, N) };
};
{
  const { key, steps } = e1(E1P, true);
  const rs = timeline(steps);
  T('[2] E1: four runs exit 0', allOk(rs, 4), last(rs).out.slice(-800));
  T('[2] E1: the notes are read (records line) and kept as pids', /\(\+2 exit notes\)/.test(rs[1].out) && Array.isArray(((rs[2].state.STARTS_FILE || {})[key] || {}).noted)
    && rs[2].state.STARTS_FILE[key].noted.length === 2 && rs[2].state.STARTS_FILE[key].noted.every(x => /^[0-9a-f]{16}$/.test(x)), JSON.stringify((rs[2].state.STARTS_FILE || {})[key]));
  T('[2] E1: at maturity the host side has a hit each, the opponents none', JSON.stringify(leaves(last(rs), E1P)) === '[1,1,0,0]' && processedOf(last(rs)).has(key),
    JSON.stringify(leaves(last(rs), E1P)));
  T('[2] E1: logged and counted (summary row 2)', SPARED.test(last(rs).out) && sparedN(rs) === 2 && / 2 exit-rate hits /.test(last(rs).out), last(rs).out.split('\n').filter(l => /start-orphan/.test(l)).join(' | '));
  T('[2] E1: nobody flagged, no points posted', E1P.every(s => fOf(last(rs), s) === 0) && rs.every(r => pointPosts(r).length === 0));
  const c = timeline(e1(E1C, false).steps);
  T('[2] E1 control (an old client, no notes): all four hit as before', allOk(c, 4) && JSON.stringify(leaves(last(c), E1C)) === '[1,1,1,1]' && sparedN(c) === 0,
    JSON.stringify(leaves(last(c), E1C)));
}

// ---- [3] E2 three-player quick (mt 1): the host crashes, seats 1 / 2 cannot reach each other ----
{
  const P = E2P, h = 0x9602, S = [0, 1, 2].map(s => start(1, h, P, s));
  const N = [note(1, h, P, 1, 4), note(1, h, P, 2, 2)];   // the elected host: nobody joined (migrate-disband); seat 2: host-left
  const rs = timeline(absentSteps(S, N));
  T('[3] E2: only the host is hit', allOk(rs, 4) && JSON.stringify(leaves(last(rs), P)) === '[1,0,0]' && sparedN(rs) === 2, JSON.stringify(leaves(last(rs), P)));
}

// ---- [4] E3 notes with a disp outside NOTE_DISP spare nobody ----
{
  const P = E3P, h = 0x9603, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = [note(5, h, P, 0, 5), note(5, h, P, 1, 8), note(5, h, P, 2, 7), note(5, h, P, 3, 9)];
  const rs = timeline(absentSteps(S, N));
  T('[4] E3: user-quit / eac-kick / kicked / eac-drop notes: all four hit', allOk(rs, 4) && JSON.stringify(leaves(last(rs), P)) === '[1,1,1,1]' && sparedN(rs) === 0,
    JSON.stringify(leaves(last(rs), P)));
  const S0 = [0, 1, 2, 3].map(s => start(5, h + 1, P, s));
  const rs0 = timeline(absentSteps(S0, [note(5, h + 1, P, 2, 0), note(5, h + 1, P, 3, 6)]));
  T('[4] E3: notes with disp finished (0) / reconnect-failed (6) spare nobody either', allOk(rs0, 4) && JSON.stringify(leaves(last(rs0), P)) === '[1,1,1,1]',
    JSON.stringify(leaves(last(rs0), P)));
}

// ---- [5] E4 the notes read once, then overwritten before maturity ----
const e4 = (P) => {
  const h = 0x9604, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = [note(5, h, P, 2, 4), note(5, h, P, 3, 4)];
  return [[0, S], [5 * MIN, S.concat(N)], [10 * MIN, S], [2 * HOUR, S]];
};
{
  const rs = timeline(e4(E4P));
  T('[5] E4: notes gone from the shards at maturity: the opponents still spared', allOk(rs, 4) && JSON.stringify(leaves(last(rs), E4P)) === '[1,1,0,0]', JSON.stringify(leaves(last(rs), E4P)));
}

// ---- [6] E5 a settled match: the note is ignored, the dropped seat is a leaver exactly as without it ----
const e5 = (P, withNote, disp) => {
  const h = 0x9605, SC3 = [9000, 6000, 3000], S = [0, 1, 2].map(s => start(2, h, P, s));
  const R = [settle(2, h, P, 0, 1, true, SC3), settle(2, h, P, 1, 2, false, SC3)];
  const N = withNote ? [note(2, h, P, 2, disp == null ? 4 : disp)] : [];
  const F = S.concat(R, N);
  return { key: keyOf(S[0].d), steps: [[0, S], [12 * MIN, F], [6 * MIN, F], [6 * MIN, F], [v.LEAVE_CONFIRM_MS - 23 * MIN, F], [3 * HOUR, F]] };
};
{
  const a = e5(E5P, true), b = e5(E5Q, false);
  const ra = timeline(a.steps), rb = timeline(b.steps);
  const norm = (rs, P, Q) => rs.map(r => pointPosts(r).map(x => { let y = x; P.forEach((s, i) => { y = y.split(s).join('P' + i); }); return y; }).join(';')).join('|');
  T('[6] E5: both settle (consistent group), six runs exit 0', allOk(ra, 6) && allOk(rb, 6) && processedOf(last(ra)).has(a.key) && processedOf(last(rb)).has(b.key));
  T('[6] E5: the dropped seat is a leaver with or without his note (same exit-rate)', leavesOf(last(ra), E5P[2]) === 1 && leavesOf(last(rb), E5Q[2]) === 1
    && leavesOf(last(ra), E5P[0]) === 0 && leavesOf(last(ra), E5P[1]) === 0, JSON.stringify([leaves(last(ra), E5P), leaves(last(rb), E5Q)]));
  T('[6] E5: the same points posts, run by run (the note changes no rating)', norm(ra, E5P) === norm(rb, E5Q) && ra.some(r => pointPosts(r).length > 0), norm(ra, E5P) + ' vs ' + norm(rb, E5Q));
  T('[6] E5: nothing spared, nobody flagged', sparedN(ra) === 0 && !/Q64\)/.test(outOf(ra)) && E5P.every(s => fOf(last(ra), s) === 0));
}

// ---- [7] E6 an outsider's note; E7 a note for another key ----
{
  const P = E6P, h = 0x9606, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = [note(5, h, P, 2, 4, E6X), note(5, h, P, 3, 4, E6X)];   // an outside account copies the public key and notes seats 2 / 3
  const rs = timeline(absentSteps(S, N));
  T('[7] E6: an outsider\'s notes spare nobody', allOk(rs, 4) && JSON.stringify(leaves(last(rs), P)) === '[1,1,1,1]' && sparedN(rs) === 0 && leavesOf(last(rs), E6X) === 0,
    JSON.stringify(leaves(last(rs), P)));
}
const e7 = (P) => {
  const h = 0x9607, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = [note(5, h + 1, P, 2, 4), note(5, h + 1, P, 3, 4)];   // the seats' notes name another match (another hash)
  return absentSteps(S, N);
};
{
  const rs = timeline(e7(E7P));
  T('[7] E7: notes for another key spare nothing here', allOk(rs, 4) && JSON.stringify(leaves(last(rs), E7P)) === '[1,1,1,1]' && sparedN(rs) === 0, JSON.stringify(leaves(last(rs), E7P)));
}

// ---- [8] E8 confession + note of the same player ----
{
  const P = E8P, h = 0x9608, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const N = [confess(5, h, P, 2), note(5, h, P, 2, 4), note(5, h, P, 3, 4)];
  const rs = timeline(absentSteps(S, N));
  T('[8] E8: the confessor has one hit (his confession), the noted opponent none, the host side one each', allOk(rs, 4) && JSON.stringify(leaves(last(rs), P)) === '[1,1,1,0]',
    JSON.stringify(leaves(last(rs), P)));
}

// ---- [9] E9 trust: a lone settle record already exempts its writer today ----
{
  const P = E9P, h = 0x9609, S = [0, 1, 2, 3].map(s => start(5, h, P, s));
  const L = [settle(5, h, P, 2, 3, false, [0, 0, 0, 0], 4)];   // seat 2 writes a lone result (all zero, migrate-disband) instead of a note
  const rs = timeline(absentSteps(S, L));
  T('[9] E9: a lone 0xB1 of seat 2 already spares him (and earns the consolation) -- the note opens nothing new', allOk(rs, 4) && leavesOf(last(rs), P[2]) === 0
    && leavesOf(last(rs), P[3]) === 1 && /1 exempt \(wrote a settle record\)/.test(last(rs).out), JSON.stringify(leaves(last(rs), P)) + ' ' + last(rs).out.split('\n').filter(l => /start-orphan/.test(l)).join(' | '));
}

// ---- [10] mutants ----
{
  const s1 = mutant("      if (Array.isArray(p.noted) && p.noted.indexOf(h) >= 0) { spared.push(h.slice(0, 8)); continue; }", '', '[10a]');
  if (s1) try {
    const m = timeline(e1(M1P, true).steps, s1);
    T('[10] mutant (no spare): the honest opponents are hit again', allOk(m, 4) && JSON.stringify(leaves(last(m), M1P)) === '[1,1,1,1]', JSON.stringify(leaves(last(m), M1P)));
  } finally { try { fs.unlinkSync(s1); } catch (e) {} }
  const s2 = mutant('notes.filter((n) => NOTE_DISP.has(n.dispCode | 0))', 'notes', '[10b]');
  if (s2) try {
    const m = timeline(e1(M2P, true, 5).steps, s2);
    T('[10] mutant (every disp accepted): user-quit notes spare the opponents -> the disp filter is what holds E3', allOk(m, 4) && JSON.stringify(leaves(last(m), M2P)) === '[1,1,0,0]',
      JSON.stringify(leaves(last(m), M2P)));
  } finally { try { fs.unlinkSync(s2); } catch (e) {} }
  const s3 = mutant("if (notedSet.has(h + '|' + m) && ", "if ([...notedSet].some((x) => x.indexOf(h + '|') === 0) && ", '[10c]');
  if (s3) try {
    const m = timeline(e7(M3P), s3);
    T('[10] mutant (the key ignored): a note for another match spares here -> the key check is what holds E7', allOk(m, 4) && JSON.stringify(leaves(last(m), M3P)) === '[1,1,0,0]',
      JSON.stringify(leaves(last(m), M3P)));
  } finally { try { fs.unlinkSync(s3); } catch (e) {} }
  const s4 = mutant('      if (Array.isArray(p.noted) && p.noted.indexOf(h) >= 0) { spared.push', "      if (notedSet && notedSet.has(h + '|' + m)) { spared.push", '[10d]');
  if (s4) try {
    const m = timeline(e4(M4P), s4);
    T('[10] mutant (only notes read in the maturity run count): the overwritten notes no longer spare -> p.noted is what holds E4', allOk(m, 4) && JSON.stringify(leaves(last(m), M4P)) === '[1,1,1,1]',
      JSON.stringify(leaves(last(m), M4P)));
  } finally { try { fs.unlinkSync(s4); } catch (e) {} }
}

// ---- [11] wiring pins ----
{
  const main = SRC.slice(SRC.indexOf('async function main() {'));
  T('[11] the shard reader decodes 0xBD into notes (disp at the v3 offset), apart from results, starts and confessions',
    /\} else if \(d\[0\] === NOTE_MAGIC && d\.length >= 10\) \{[\s\S]{0,300}?const dispCode = \(d\.length > 10 \+ pc && pc >= 1\) \? \(d\[10 \+ pc\] \| 0\) : 0;\s*out\.push\(\{ note: true, steamID: e\.steamID/.test(main)
    && /\(rec\.start \? starts : \(rec\.confess \? confessions : \(rec\.note \? notes : recs\)\)\)\.push\(rec\)/.test(main));
  const code = main.replace(/\/\/[^\n]*/g, '');   // line comments out
  const noteLines = code.split('\n').filter(l => /\bnotes\b/.test(l)).map(l => l.trim());
  T('[11] the notes array is touched on five lines only (declared, routed, logged, seen keys, the noted set) -- never a settle group or a hold',
    noteLines.length === 5 && noteLines.every(l => !/leaveConfirmHold|groupRecords|absenceHold|recs\.concat\(notes|recs\.push/.test(l)), JSON.stringify(noteLines));
  T('[11] notes reach one consumer only: the reconcileStarts call, filtered by NOTE_DISP', (code.match(/\bnoted\b/g) || []).length === 2
    && /const noted = new Set\(notes\.filter\(\(n\) => NOTE_DISP\.has\(n\.dispCode \| 0\)\)\.map\(\(n\) => pid\(String\(n\.steamID\)\) \+ '\|' \+ n\.m\)\);\n\s+const startsRes = reconcileStarts\([^\n]*, seenKeys, noted(?:, heldKeys)?\);/.test(main),   // Q294: + the held keys after it
    String((main.match(/\bnoted\b/g) || []).length));
  T('[11] notes count as a key seen on the shards (Q144)', /\.concat\(confessions\.map\(\(c\) => c\.m\), notes\.map\(\(c\) => c\.m\)\)/.test(main));
  const rs = SRC.slice(SRC.indexOf('function reconcileStarts('), SRC.indexOf('function reconcileStarts(') + 9000);
  const iSettled = rs.indexOf("if (p.settled.indexOf(h) >= 0) continue;"), iOwn = rs.indexOf('if (!hasOwnStart(p, h)) continue;'),
    iConf = rs.indexOf("if (confState[h + '|' + m]) continue;"), iNote = rs.indexOf('if (Array.isArray(p.noted) && p.noted.indexOf(h) >= 0)'), iHit = rs.indexOf('leavers[h].leaves += 1;');
  T('[11] verdict order: settled, own start, confession, note, then the hit', iSettled > 0 && iSettled < iOwn && iOwn < iConf && iConf < iNote && iNote < iHit, [iSettled, iOwn, iConf, iNote, iHit].join(','));
  T('[11] p.noted is gathered before the consistent-key exit (a pending key keeps its notes whatever happens next)',
    rs.indexOf("if (notedSet && notedSet.size) for (const seat of Object.keys(p.roster))") > 0
    && rs.indexOf("if (notedSet && notedSet.size) for (const seat of Object.keys(p.roster))") < rs.indexOf('if (consistentKeys.has(m)) continue;'));
  T('[11] the summary row', /'\| start-orphan seats spared by their own exit note \(Q64\) \| ' \+ s\('exitNoteSpared', 0\) \+ ' \|'/.test(SRC));
}

// ---- [12] Q221: the host keeps the heartbeat alive and never sends the next-level frame ----
// E10 three-player quick (mt 1): host H (seat 0) withholds LEVEL_BEGIN; joiners J1 / J2 wait 60 s, go to the menu and write
//   level-begin-timeout notes (3). H writes a lone result (the match "finished" for him alone) or nothing.
const e10 = (P, notes, hostLone) => {
  const h = 0x9621, S = [0, 1, 2].map(s => start(1, h, P, s));
  const N = notes ? [note(1, h, P, 1, 3), note(1, h, P, 2, 3)] : [];
  const L = hostLone ? [settle(1, h, P, 0, 1, true, [4200, 0, 0], 1)] : [];   // peers-gone: he "finished" with the table gone
  return absentSteps(S, N.concat(L));
};
{
  const rs = timeline(e10(QAP, true, true));
  T('[12] E10: the joiners\' level-begin-timeout notes spare both, the host\'s lone record keeps him exempt -- nobody hit', allOk(rs, 4)
    && JSON.stringify(leaves(last(rs), QAP)) === '[0,0,0]' && sparedN(rs) === 2 && /1 exempt \(wrote a settle record\)/.test(last(rs).out),
    JSON.stringify(leaves(last(rs), QAP)) + ' ' + last(rs).out.split('\n').filter(l => /start-orphan/.test(l)).join(' | '));
  const rb = timeline(e10(QBP, true, false));
  T('[12] E10: a host that writes nothing at all is hit once, the joiners are spared', allOk(rb, 4) && JSON.stringify(leaves(last(rb), QBP)) === '[1,0,0]' && sparedN(rb) === 2,
    JSON.stringify(leaves(last(rb), QBP)));
  const rc = timeline(e10(QCP, false, true));
  T('[12] E10 control (an old client, no notes): both honest joiners hit, the host exempt -- the bug as it was', allOk(rc, 4) && JSON.stringify(leaves(last(rc), QCP)) === '[0,1,1]' && sparedN(rc) === 0,
    JSON.stringify(leaves(last(rc), QCP)));
  T('[12] E10: nobody flagged, no points posted', QAP.concat(QBP).every(s => fOf(last(rs), s) === 0 && fOf(last(rb), s) === 0) && rs.concat(rb).every(r => pointPosts(r).length === 0));
}
// E11 one half-dead joiner: the host and the other joiner play on and settle; seat 2 timed out and wrote a level-begin-timeout note
{
  const a = e5(QDP, true, 3), b = e5(QDQ, false);
  const ra = timeline(a.steps), rb = timeline(b.steps);
  const norm = (rs, P) => rs.map(r => pointPosts(r).map(x => { let y = x; P.forEach((s, i) => { y = y.split(s).join('P' + i); }); return y; }).join(';')).join('|');
  T('[12] E11: the match settles, the timed-out seat is a leaver with or without his note (same exit-rate, same points posts)', allOk(ra, 6) && allOk(rb, 6)
    && processedOf(last(ra)).has(a.key) && leavesOf(last(ra), QDP[2]) === 1 && leavesOf(last(rb), QDQ[2]) === 1 && leavesOf(last(ra), QDP[0]) === 0 && leavesOf(last(ra), QDP[1]) === 0
    && norm(ra, QDP) === norm(rb, QDQ) && ra.some(r => pointPosts(r).length > 0) && sparedN(ra) === 0, JSON.stringify([leaves(last(ra), QDP), leaves(last(rb), QDQ)]));
}
// E12 ranked 1V1 (mt 2): the joiner's link went bad (heartbeat answered, frames lost); the host plays on alone and writes a lone result
{
  const P = QEP, h = 0x9622, S = [0, 1].map(s => start(2, h, P, s));
  const N = [note(2, h, P, 1, 3), settle(2, h, P, 0, 1, true, [5100, 900], 1)];
  const rs = timeline(absentSteps(S, N));
  T('[12] E12: ranked 1V1, the joiner\'s note and the host\'s lone record -- nobody hit, no points posted', allOk(rs, 4) && JSON.stringify(leaves(last(rs), P)) === '[0,0]'
    && sparedN(rs) === 1 && rs.every(r => pointPosts(r).length === 0), JSON.stringify(leaves(last(rs), P)) + ' ' + last(rs).out.split('\n').filter(l => /start-orphan|lone/.test(l)).join(' | '));
}
{
  const s5 = mutant('const NOTE_DISP = new Set([2, 3, 4]);', 'const NOTE_DISP = new Set([2, 4]);', '[12m]');
  if (s5) try {
    const m = timeline(e10(QMP, true, true), s5);
    T('[12] mutant (level-begin-timeout dropped from NOTE_DISP, the code before Q221): both honest joiners hit again', allOk(m, 4) && JSON.stringify(leaves(last(m), QMP)) === '[0,1,1]',
      JSON.stringify(leaves(last(m), QMP)));
  } finally { try { fs.unlinkSync(s5); } catch (e) {} }
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (exit-note) ===');
process.exit(failN === 0 ? 0 : 1);
