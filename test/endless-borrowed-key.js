'use strict';
// Q113 (cloud audit 2026-10): two outside accounts copy the key of a run the victim really played -- his two-player run
// in progress, his solo run (one guard-written start registers it), his result waiting for a partner -- and write a
// consistent co-op settle pair naming him. His own start made him "own" (Q78), so he paid the forged continues: -16,477
// CP on a three-seat roster, -7.6M on four, his partner's continues moved onto him, co-op pairs he never had
// (review-q78.js H1a / H1b / H2 / H3a / H3b). The fix: an endless start roster gates like a matchmade one (Q80) once all
// its start writers tell one story; the rest is caught at settle -- a co-op group whose records name another roster than
// a start read this run, or than a named player's own remembered word, is held (not settled, not processed); a roster
// seat pays, is seeded and is paired only when his own records name this roster with him at this seat.
// End-to-end over the REAL validate.js main() against an offline stateless board stub (same harness as
// test/endless-own-record.js): writes are logged, never applied, state carries between runs.
//   [1] units: rosterCanon, testimonyOf, recTestimony, the endless split checks (startRosterSplit / startRosterDisagrees
//       through registerStartRosters), noteTestimony (first seen, two stories, cap),
//       endlessRosterHold (every reason), endlessTestified, registerStartRosters / seatGateRoster on endless keys, an
//       endless key not registered on a partial read
//   [2] the review paths: H1a (two-player run in progress, three-seat forgery), H1c (the real result still settles),
//       H1b (four seats), H2 (a solo run's key), H3a (a result waiting alone, the victim moved to seat 1), H3b (both
//       settled, the forgers name themselves): nobody charged or paired by the forgery, the real charge stands
//   [2b] review-q110.js P2 / P4 (the Q110 review asked for them as regressions): P2 = H3a run past the absence grace -- V
//       does not pay the continues W pressed before he left (V's result waits alone); P4 -- V's trio best does not lift the start of a
//       pair that borrows the key of the trio run he is playing (Q111's lane): the forgery never settles
//   [2c] the Q113 review's N1: a player in the run writes a solo-shaped start on each key a run before his teammates'
//       starts are read (he knows the keys ahead, so a roster that waits for confirmation is confirmed by then); their
//       records are dropped by the seat gate but nobody is flagged for it (three runs, no trust tier)
//   [3] outside starts before the job's first look (the roster is split, nothing gated): [3a] at the forged roster's
//       seats -- held while they are there, the real result settles once they are gone; [3b] at seats 2 / 3 of a four-seat
//       roster; [3c] co-op starts on a solo run's key; [3d] the victim's start has rotated off -- his remembered word holds
//       the group (also when outside starts tied the players at every seat); [3e] the testimony list is full -- the start
//       read this run still holds it; [3f] three outside accounts outvote a two-player run -- no gate, the players'
//       records are not dropped, the real result settles; [3g] an entry from before this fix (own start remembered, no
//       testimony): the victim is not charged; [3h] a record shard unread at the first look (the players' starts on it,
//       outside starts read): the key waits for a full read -- solo and co-op -- so the outsiders never register a roster
//       that drops the players' records
//   [4] honest controls: a leaver with his start (and a cold-reconnect copy) pays 50; both settle, 15 continues pay
//       17,477; a leaver whose start rotated off pays on his remembered word; a team competitive host pays the resume
//       fee; pinned cost: an outside start on an honest run holds it while it stays on its shard, then it settles
//   [5] wiring pins
//   [6] mutation self-checks (gate excludes endless again / no endless split check / a tied key registers nothing /
//       hold removed / remembered word not checked / this run's starts not checked / own word not required / testimony not
//       remembered / endless keys register on a partial read / off-seat writers flagged by the seat gate again, Q124)
//   [7] Q128 (REVIEW-2 of Q113, A5 / A5b): an outside settle that disagrees on an endless key without a seat gate (split at
//       registration, split by a later start inside the provisional window, never registered) flags nobody; control: a gated
//       key whose own players disagree still flags both; wiring; mutant (the endless skip removed -> V and W flagged again)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/endless-own-record.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB'];
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
  "const FAIL = JSON.parse(process.env.STUB_FAIL || '{}');",   // { boardName: httpStatus }: every entry read of it fails
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-borrowed-key-'));
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
      // pin the season clock: from a season start on the endless boards are season-derived; every test runs before each
      //   production reconcile, so a date-dependent red here would stop settlement on that day
      SEASON_NOW: '2026-10-01T00:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead)
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

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 7;
const keyOf = (h) => (h | 0) + '_' + SEED + '_7';
// result-reporter wire forms (endless co-op, match type 7): settle = 10 header + pc scores + disp + 2pc roster + 11 tail;
//   start (0xB2) = 10 header + pc zero scores + disp + 2pc roster (a solo run's start: pc 1, the player at seat 0)
function settle7(hash, seat, ros, cont, o) {
  o = o || {};
  const pc = ros.length;
  const d = [0xB1, 3, 7, hash | 0, SEED, seat, seat + 1, o.prog == null ? 0 : o.prog, pc, 600];
  for (let i = 0; i < pc; i++) d.push([400, 300, 200, 100][i]);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth | 0, cont | 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0);
  return d;
}
function start7(hash, seat, ros) {
  const pc = ros.length;
  const d = [0xB2, 1, 7, hash | 0, SEED, seat, 0, 0, pc, 0];
  for (let i = 0; i < pc; i++) d.push(0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const SEG_SUSPENDED = 1, SEG_RESUMED = 4, SEG_COMP = 8;
const seg7 = (hash, seat, ros, from, to, flags) => settle7(hash, seat, ros, 0, { startDepth: from, endDepth: to, flags, prog: 12 });
const starts = (h, ros, seats) => (seats || ros.map((s, i) => i)).map(i => ({ sid: ros[i], d: start7(h, i, ros) }));
const settles = (h, ros, cont, seats, o) => (seats || ros.map((s, i) => i)).map(i => ({ sid: ros[i], d: settle7(h, i, ros, cont, o) }));

const CP0 = 1000;
// recs: [{ sid, d, shard? }] spread over distinct shard rows (one account = one entry per shard; shard: an explicit index); cpHolders start at CP0
function world(recs, cpHolders, o) {
  o = o || {};
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) {
    if (r.shard != null) { boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); continue; }
    used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d });
  }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: (cpHolders || []).map(s => ({ steamID: s, score: CP0 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: Object.keys(o.trio || {}).map(s => ({ steamID: s, score: o.trio[s] * 10000 + 1 })) },
    { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
// steps: [recs, recs, ...] what the shards hold at each run, ten minutes apart (o.gaps overrides per step);
//   o.files seeds the first run's state, o.script runs a mutant, o.trio seeds trio bests ({ sid: depth }), o.env[i] adds env to step i
function timeline(steps, cpHolders, o) {
  o = o || {};
  const runs = [];
  let state = null;
  steps.forEach((recs, i) => {
    const files = state ? advance(state, (o.gaps && o.gaps[i]) || 10 * 60000) : o.files;
    const r = runCron(world(recs, cpHolders, o), files, (o.env && o.env[i]) || null, o.script);
    runs.push(r); state = r.state;
  });
  const last = runs[runs.length - 1];
  return { runs, last, all: runs.map(r => r.out).join('\n'), posts: [].concat(...runs.map(r => r.posts)), summary: runs.map(r => r.summary).join('\n'), codes: runs.map(r => r.code) };
}
const allZero = (p) => p.codes.every(c => c === 0);
const cpWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=8(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const lastCp = (p, sid) => { const w = cpWrites(p, sid); if (!w.length) return null; const m = /score=(-?[0-9]+)/.exec(w[w.length - 1].body); return m ? Number(m[1]) : null; };
const trioWrites = (p, sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=12(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
const minCp = (p, sid) => cpWrites(p, sid).reduce((a, w) => { const m = /score=(-?[0-9]+)/.exec(w.body); return m ? Math.min(a, Number(m[1])) : a; }, CP0);
const sig = (p) => p.last.state.SIGNALS_FILE || {};
const pairsWith = (p, sid, others) => others.filter(x => (sig(p).pairs || {})[v.pairKey(v.pid(x), v.pid(sid))]).length;
const flagsOf = (p, sid) => (((sig(p).players || {})[v.pid(sid)]) || {}).f | 0;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const pendOf = (r, h) => (r.state.STARTS_FILE || {})[keyOf(h)];
const sumOf = (p, re) => { let n = 0, x; const g = new RegExp(re.source, 'g'); while ((x = g.exec(p.summary))) n += Number(x[1]); return n; };
const heldN = (p) => sumOf(p, /\| endless co-op groups held \(records disagree on the roster, Q113\) \| ([0-9]+) \|/);
const offSeatN = (p) => sumOf(p, /\| records off their start-roster seat, not counted [^|]*\| ([0-9]+) \//);
const settledLine = (p, h, pc, from, to) => new RegExp('endless settle ' + keyOf(h) + ': pc ' + pc + ' depth ' + from + '->' + to).test(p.all);
const heldLine = (p, h, why) => new RegExp('match=' + keyOf(h) + ': endless co-op records disagree -- ' + why).test(p.all);
const R4 = (n) => [n, n + 1, n + 2, n + 3].map(SID);

console.log('=== endless co-op: a borrowed key charges nobody (Q113) ===');

// ---- [1] units ----
{
  const [V, W, A, B] = R4(100);
  const ro2 = { 0: V, 1: W }, ro3 = { 0: A, 1: B, 2: V };
  const rec = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
  T('[1] rosterCanon: seat order, not key order', v.rosterCanon({ 1: W, 0: V }) === v.rosterCanon(ro2) && v.rosterCanon({ 0: W, 1: V }) !== v.rosterCanon(ro2));
  const t = v.testimonyOf(2, 0, ro2);
  T('[1] testimonyOf: 12 hex, differs by seat count / seat / roster', /^[0-9a-f]{12}$/.test(t) && t !== v.testimonyOf(3, 0, ro2) && t !== v.testimonyOf(2, 1, ro2) && t !== v.testimonyOf(2, 0, { 0: V, 1: A }));
  T('[1] recTestimony: a start and a settle of the same seat say the same', v.recTestimony(rec(V, start7(1, 0, [V, W]))) === t && v.recTestimony(rec(V, settle7(1, 0, [V, W], 0xF0))) === t);
  const sV = rec(V, start7(1, 0, [V, W])), sW = rec(W, start7(1, 1, [V, W]));
  // an endless key goes through the matchmade split checks with every writer voting (no dispute filter): split unless
  //   every start writer tells one story -- one seat count, one roster, each writer at his own seat in it
  const regSplit = (att) => { const pe = {}; v.registerStartRosters(att, new Set(), pe, 5); const ks = Object.keys(pe); return ks.length ? pe[ks[0]].split === 1 : null; };
  T('[1] endless split checks: nothing -> no entry; one story (with a cold-reconnect copy) -> not split',
    regSplit([]) === null && regSplit([sV, sW]) === false && regSplit([sV, sW, rec(V, start7(1, 0, [V, W]))]) === false);
  T('[1] endless split checks: another seat count / another roster / a writer off his own seat -> split',
    regSplit([sV, sW, rec(A, start7(1, 0, [A, B, V]))]) === true && regSplit([sV, rec(W, start7(1, 1, [V, A]))]) === true
    && regSplit([sV, rec(A, start7(1, 1, [V, W]))]) === true);
  T('[1] endless split checks: no dispute filter (both claimants of seat 0 vote, so the key still registers, split)',
    regSplit([sV, sW, rec(A, start7(1, 0, [A, W]))]) === true);
  const p = {};
  v.noteTestimony(p, [sV]); const t1 = (p.tst || {})[v.pid(V)];
  v.noteTestimony(p, [sV]);
  T('[1] noteTestimony: first seen, kept on the same story', t1 === t && p.tst[v.pid(V)] === t);
  v.noteTestimony(p, [rec(V, start7(1, 1, [W, V]))]); const t2 = p.tst[v.pid(V)];
  v.noteTestimony(p, [sV]);
  T('[1] noteTestimony: two stories -> x, and x stays', t2 === 'x' && p.tst[v.pid(V)] === 'x');
  const q = { tst: [] };
  v.noteTestimony(q, Array.from({ length: 20 }, (x, i) => rec(SID(900 + i), start7(1, 0, [SID(900 + i)]))));
  T('[1] noteTestimony: a malformed list is replaced; capped like the own-start list', !Array.isArray(q.tst) && Object.keys(q.tst).length === v.OWN_START_CAP);
  v.noteTestimony(undefined, [sV]); v.noteTestimony({}, []);
  ok('[1] noteTestimony: no entry / no records -> no throw');
  const gH = [rec(V, settle7(1, 0, [V, W], 0)), rec(W, settle7(1, 1, [V, W], 0))];
  T('[1] endlessRosterHold: an honest group, its own starts, its own remembered word -> settle',
    v.endlessRosterHold(gH, ro2, [sV, sW], { tst: { [v.pid(V)]: t, [v.pid(A)]: 'x' } }) === null && v.endlessRosterHold(gH, ro2, [], undefined) === null);
  T('[1] endlessRosterHold: the records name different rosters', /different rosters/.test(v.endlessRosterHold([gH[0], rec(W, settle7(1, 1, [V, W, A], 0))], ro2, [], null) || ''));
  T('[1] endlessRosterHold: one account at two seats', /two seats/.test(v.endlessRosterHold([rec(V, settle7(1, 0, [V, V], 0))], { 0: V, 1: V }, [], null) || ''));
  T('[1] endlessRosterHold: a writer off the seat he wrote from', /not at the seat/.test(v.endlessRosterHold([rec(A, settle7(1, 0, [V, W], 0)), rec(B, settle7(1, 1, [V, W], 0))], ro2, [], null) || ''));
  const gF = [rec(A, settle7(1, 0, [A, B, V], 0xF00)), rec(B, settle7(1, 1, [A, B, V], 0xF00))];
  T('[1] endlessRosterHold: a start read this run tells another story', /start record names another/.test(v.endlessRosterHold(gF, ro3, [sV], null) || ''));
  T('[1] endlessRosterHold: a named player remembered telling another story (or two)', /seat 2 .* wrote another roster/.test(v.endlessRosterHold(gF, ro3, [], { tst: { [v.pid(V)]: t } }) || '')
    && /seat 2 /.test(v.endlessRosterHold(gF, ro3, [], { tst: { [v.pid(V)]: 'x' } }) || ''));
  const has = (set, sid) => set.has(v.pid(sid));
  const s0 = v.endlessTestified({}, [], ro3, 3, [A, B]);
  T('[1] endlessTestified: the writers; nothing from V -> not V', has(s0, A) && has(s0, B) && !has(s0, V));
  T('[1] endlessTestified: V\'s word for this roster and seat (remembered or read now) -> V',
    has(v.endlessTestified({ tst: { [v.pid(V)]: v.testimonyOf(3, 2, ro3) } }, [], ro3, 3, [A, B]), V)
    && has(v.endlessTestified(null, [rec(V, start7(1, 2, [A, B, V]))], ro3, 3, [A, B]), V));
  T('[1] endlessTestified: V told another story, or two -> not V',
    !has(v.endlessTestified(null, [sV], ro3, 3, [A, B]), V)
    && !has(v.endlessTestified({ tst: { [v.pid(V)]: v.testimonyOf(3, 2, ro3) } }, [sV], ro3, 3, [A, B]), V)
    && !has(v.endlessTestified({ tst: { [v.pid(V)]: 'x' } }, [], ro3, 3, [A, B]), V));
  let pend = {};
  T('[1] registerStartRosters: one story -> registered, not split, gated', v.registerStartRosters([sV, sW], new Set(), pend, 5) === 1 && !('split' in pend['1_7_7'])
    && JSON.stringify(v.seatGateRoster(pend['1_7_7'])) === JSON.stringify({ 0: v.pid(V), 1: v.pid(W) }), JSON.stringify(pend));
  pend = {};
  T('[1] registerStartRosters: one outside co-op start on the key -> registered split, no gate', v.registerStartRosters([sV, sW, rec(A, start7(1, 0, [A, B, V]))], new Set(), pend, 5) === 1
    && pend['1_7_7'].split === 1 && pend['1_7_7'].roster[0] === v.pid(V) && v.seatGateRoster(pend['1_7_7']) === null, JSON.stringify(pend));
  pend = {};
  T('[1] registerStartRosters: outside starts tying the players at every seat -> an empty entry, split (it remembers their word)',
    v.registerStartRosters([sV, sW, rec(A, start7(1, 0, [A, B, V])), rec(B, start7(1, 1, [A, B, V]))], new Set(), pend, 5) === 1
    && pend['1_7_7'].split === 1 && Object.keys(pend['1_7_7'].roster).length === 0 && v.seatGateRoster(pend['1_7_7']) === null, JSON.stringify(pend));
  pend = {};
  const mm = (sid, seat, ros) => ({ steamID: sid, d: [0xB2, 3, 6, 1, 7, seat], roster: ros });
  const RA = { 0: SID(111), 1: SID(112) }, RB = { 0: SID(113), 1: SID(114) };
  T('[1] registerStartRosters: a matchmade tie still registers nothing (unchanged)',
    v.registerStartRosters([mm(SID(111), 0, RA), mm(SID(112), 1, RA), mm(SID(113), 0, RB), mm(SID(114), 1, RB)], new Set(), pend, 5) === 0 && !pend['1_7_6'], JSON.stringify(pend));
  pend = {};
  T('[1] a partial read: an endless key is not registered (next full read), a matchmade key still is',
    v.registerStartRosters([sV, sW], new Set(), pend, 5, false) === 0 && !pend['1_7_7']
    && v.registerStartRosters([mm(SID(111), 0, RA), mm(SID(112), 1, RA)], new Set(), pend, 5, false) === 1 && !!pend['1_7_6']
    && v.registerStartRosters([sV, sW], new Set(), pend, 5, true) === 1 && !!pend['1_7_7'], JSON.stringify(pend));
  pend = {};
  const solo = rec(V, start7(1, 0, [V]));
  T('[1] a solo run\'s start: registered with its player at seat 0, so only his records count',
    v.registerStartRosters([solo], new Set(), pend, 5) === 1 && !('split' in pend['1_7_7']) && v.seatedOnRoster(pend['1_7_7'], rec(V, settle7(1, 0, [V], 0)))
    && !v.seatedOnRoster(pend['1_7_7'], gF[0]) && !v.seatedOnRoster(pend['1_7_7'], gF[1]), JSON.stringify(pend));
}

// ---- [2] the review paths ----
{
  // H1a / H1c: V and W play a two-player run (both starts read); A and B copy its key into a three-seat result naming V
  const [V, W, A, B] = R4(200), h = 0x1201;
  const S = starts(h, [V, W]), F = settles(h, [A, B, V], 0xF00, [0, 1]), R = settles(h, [V, W], 0, null, { endDepth: 3 });
  const p = timeline([S, S.concat(F), S.concat(F), S.concat(F), S.concat(F, R), S.concat(F, R)], [V, W]);
  const beforeReal = { posts: [].concat(...p.runs.slice(0, 4).map(r => r.posts)) };
  T('[2] H1a all runs exit 0', allZero(p), p.last.out.slice(-800));
  // flags read when the real result settles (run 5): a later run that still reads the forged rows beside a processed key
  //   flags every writer as an inconsistent group -- that is not endless-specific and not this fix (QUEUE Q114)
  const at5 = { last: p.runs[4] };
  T('[2] H1a the forged records are dropped by the seat gate (nobody flagged for it: an endless key flags no one there, Q113 review)', offSeatN(p) > 0 && flagsOf(at5, A) === 0 && flagsOf(at5, B) === 0, offSeatN(p) + ' ' + flagsOf(at5, A));
  T('[2] H1a V is not charged', cpWrites(beforeReal, V).length === 0 && minCp(p, V) === CP0, JSON.stringify(cpWrites(p, V)));
  T('[2] H1a V not paired with A or B; V and W not flagged', pairsWith(p, V, [A, B]) === 0 && flagsOf(at5, V) === 0 && flagsOf(at5, W) === 0);
  T('[2] H1c the real result still settles (depth 0 -> 3)', settledLine(p, h, 2, 0, 3), (p.all.match(/endless [^\n]*/g) || []).join(' | '));
}
{
  const [V, W, A, B] = R4(210), h = 0x1202;
  const S = starts(h, [V, W]), F = settles(h, [A, B, W, V], 0xFF00, [0, 1]);
  const p = timeline([S, S.concat(F), S.concat(F), S.concat(F)], [V, W]);
  T('[2] H1b four seats: neither W nor V charged (7.6M on the ladder)', allZero(p) && cpWrites(p, V).length === 0 && cpWrites(p, W).length === 0, JSON.stringify(cpWrites(p, V)));
  T('[2] H1b nobody paired with A / B', pairsWith(p, V, [A, B]) === 0 && pairsWith(p, W, [A, B]) === 0);
}
{
  const [V, A, B] = R4(220), h = 0x1203;
  const S = starts(h, [V]), F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([S, S.concat(F), S.concat(F), S.concat(F)], [V]);
  T('[2] H2 a solo run\'s key: registered on its one start', /start-pending 4611_7_7: 1 attesters, roster 1 seats/.test(p.runs[0].out), p.runs[0].out.slice(-600));
  T('[2] H2 V not charged, not paired; the forgery is dropped', allZero(p) && cpWrites(p, V).length === 0 && pairsWith(p, V, [A, B]) === 0 && offSeatN(p) > 0);
}
{
  // H3a: W pressed continue 15 times and left without his result; V's result waits alone; A and B copy it with V at seat 1
  const [V, W, A, B] = R4(230), h = 0x1204;
  const S = starts(h, [V, W]), Rv = settles(h, [V, W], 0xF0, [0], { endDepth: 2 });
  const F = [{ sid: A, d: settle7(h, 0, [A, V], 0xF0, { endDepth: 2 }) }, { sid: B, d: settle7(h, 0, [B, V], 0xF0, { endDepth: 2 }) }];
  const p = timeline([S.concat(Rv), S.concat(Rv), S.concat(Rv, F), S.concat(Rv, F), S.concat(Rv, F)], [V, W]);
  T('[2] H3a W\'s continues are not moved onto V; nobody charged', allZero(p) && cpWrites(p, V).length === 0 && cpWrites(p, W).length === 0, JSON.stringify(cpWrites(p, V)));
}
{
  // H3b: both settle (W 15 continues); A and B copy the key naming themselves
  const [V, W, A, B] = R4(240), h = 0x1205;
  const S = starts(h, [V, W]), R = settles(h, [V, W], 0xF0, null, { endDepth: 2 }), F = settles(h, [A, B], 0xF0, null, { endDepth: 2 });
  const p = timeline([S.concat(R, F), S.concat(R, F), S.concat(R, F), S.concat(R, F)], [V, W]);
  T('[2] H3b the real result settles and W pays his own 15 continues (1000 -> -16477)', allZero(p) && settledLine(p, h, 2, 0, 2) && lastCp(p, W) === CP0 - 17477, JSON.stringify(cpWrites(p, W)));
  T('[2] H3b V not charged; nobody paired with A / B', cpWrites(p, V).every(w => !/score=-/.test(w.body)) && minCp(p, V) === CP0 && pairsWith(p, V, [A, B]) === 0 && pairsWith(p, W, [A, B]) === 0);
}

// ---- [2b] review-q110.js P2 / P4 (regressions the Q110 review asked for) ----
{
  // P2: W pressed continue 15 times and left with his start only; V settles honestly ([V, W], seat 1 = 15); A and B copy
  //   V's record, each at seat 0, with V moved to seat 1 -- seat 1's majority would be V and V would pay W's 17,477 as his
  //   own word. Run past the absence grace: the copies are dropped every run and V's result waits alone (a two-player
  //   co-op result settles on two writers), so nobody pays W's continues on V's word.
  const [V, W, A, B] = R4(250), h = 0x1206;
  const S = starts(h, [V, W]), Rv = settles(h, [V, W], 0xF0, [0], { endDepth: 16 });
  const F = [{ sid: A, d: settle7(h, 0, [A, V], 0xF0, { endDepth: 16 }) }, { sid: B, d: settle7(h, 0, [B, V], 0xF0, { endDepth: 16 }) }];
  const st = S.concat(Rv, F);
  const p = timeline([st, st, st, st], [V, W, A, B], { gaps: [0, 10 * 60000, 4 * 3600000, 10 * 60000] });
  T('[2b] P2 all runs exit 0; the copies are dropped by the seat gate', allZero(p) && offSeatN(p) > 0, p.last.out.slice(-800));
  T('[2b] P2 V never pays W\'s continues', minCp(p, V) === CP0 && cpWrites(p, V).every(w => !/score=-/.test(w.body)), JSON.stringify(cpWrites(p, V)));
  T('[2b] P2 past the grace V\'s result still waits alone; W is not charged on V\'s word', !settledLine(p, h, 2, 0, 16) && cpWrites(p, W).length === 0
    && new RegExp('match=' + keyOf(h) + ': lone\\(1\\)').test(p.last.out), JSON.stringify(cpWrites(p, W)) + ' ' + (p.all.match(/endless [^\n]*/g) || []).slice(-4).join(' | '));
  T('[2b] P2 A / B paired with nobody, not charged', pairsWith(p, V, [A, B]) === 0 && pairsWith(p, W, [A, B]) === 0 && cpWrites(p, A).length === 0 && cpWrites(p, B).length === 0);
}
{
  // P4: V's trio best is 30 and he is playing a three-seat run with X and Y (their three starts are on the key); A and B
  //   copy the key into a trio pair naming V, claiming a continue from 29 to 30. Before Q113 V's start made him "own" and
  //   his 30 lifted the pair's start: it settled ten minutes in. Now the seat gate drops the pair (V and X sit at seats 0
  //   and 1): nothing settles from it and A / B never reach the trio board.
  const [V, X, Y, A] = R4(260), B = SID(264), h = 0x1207;
  const S = starts(h, [V, X, Y]), F = settles(h, [A, B, V], 0, [0, 1], { startDepth: 29, endDepth: 30 });
  const p = timeline([S, S.concat(F), S.concat(F), S.concat(F), S.concat(F)], [V, X, Y], { trio: { [V]: 30 } });
  T('[2b] P4 all runs exit 0; the pair is dropped by the seat gate', allZero(p) && offSeatN(p) > 0, p.last.out.slice(-800));
  T('[2b] P4 nothing settles from the borrowed key; A / B never reach the trio board',
    !settledLine(p, h, 3, 29, 30) && trioWrites(p, A).length === 0 && trioWrites(p, B).length === 0 && !processedOf(p.last).has(keyOf(h)),
    (p.all.match(/endless[^\n]*/g) || []).slice(-4).join(' | '));
  T('[2b] P4 V not charged, not paired with A / B', cpWrites(p, V).length === 0 && pairsWith(p, V, [A, B]) === 0);
}

// ---- [2c] Q113 review N1: a player in the run registers a roster of his own first ----
function soloFirst(script) {
  const [M, V, W] = R4(270), hs = [0x1271, 0x1272, 0x1273];
  const solo = hs.map(h => ({ sid: M, d: start7(h, 0, [M]) }));
  const honest = [].concat(...hs.map(h => starts(h, [M, V, W]).concat(settles(h, [M, V, W], 0x200, null, { endDepth: 4 }))));
  // M's solo starts are read on a run of their own, a run before his teammates' (he knows the keys ahead): a roster that
  //   has to wait for confirmation (Q118) is confirmed by then, so the honest starts that follow sit off it either way
  const p = timeline([solo, solo, solo.concat(honest), solo.concat(honest), solo.concat(honest)], [M, V, W], { script });
  return { p, M, V, W, hs };
}
{
  // M hosts three casual runs with V and W. M picks each key and writes a solo-shaped start on it (M alone at seat 0)
  //   before his teammates' starts are read, so each key registers that roster and V's and W's honest records sit off it:
  //   the seat gate drops them. Before the review fix they were flagged once per key (trust tier 1 after three runs); now an
  //   endless key flags nobody there. Nobody is charged and the runs do not settle (as when a player writes a result of his
  //   own that disagrees).
  const { p, M, V, W, hs } = soloFirst();
  const trustW = (sid) => p.posts.filter(x => /SetLeaderboardScore/.test(x.url) && /leaderboardid=9(&|$)/.test(x.body) && new RegExp('steamid=' + sid + '(&|$)').test(x.body));
  T('[2c] N1 all runs exit 0; each key registered on M\'s solo start; V\'s and W\'s records dropped by the seat gate',
    allZero(p) && hs.every(h => /roster 1 seats/.test((p.runs[0].out.match(new RegExp('start-pending ' + keyOf(h) + '[^\n]*')) || [''])[0])) && offSeatN(p) > 0, p.runs[0].out.slice(-600));
  T('[2c] N1 V and W are not flagged for it over three runs; no trust tier written for them',
    flagsOf(p, V) === 0 && flagsOf(p, W) === 0 && trustW(V).length === 0 && trustW(W).length === 0, flagsOf(p, V) + ' ' + flagsOf(p, W) + ' ' + JSON.stringify(trustW(V)));
  T('[2c] N1 nobody charged; the runs do not settle', cpWrites(p, V).length === 0 && cpWrites(p, W).length === 0 && cpWrites(p, M).length === 0
    && hs.every(h => !settledLine(p, h, 3, 0, 4)), JSON.stringify(cpWrites(p, W)));
}

// ---- [3] outside starts before the job's first look ----
function preemptA(script) {
  const [V, W, A, B] = R4(300), h = 0x1301;
  const S = starts(h, [V, W]), P = starts(h, [A, B, V], [0, 1]), F = settles(h, [A, B, V], 0xF00, [0, 1]), R = settles(h, [V, W], 0, null, { endDepth: 3 });
  const p = timeline([S.concat(P), S.concat(P, F), S.concat(P, F), S.concat(P, F), S.concat(R), S.concat(R)], [V, W], { script });
  return { p, V, W, A, B, h };
}
{
  const { p, V, W, A, B, h } = preemptA();
  T('[3a] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3a] the roster is split (no seat gate), logged as left to the settle checks', /start-split 4865_7_7: [^\n]*the endless settle checks decide \(Q113\)/.test(p.runs[0].out), p.runs[0].out.slice(-600));
  T('[3a] the forged group is held while the outside rows stand (a start names another roster)', heldLine(p, h, 'a start record names another roster or seat') && heldN(p) >= 3, String(heldN(p)));
  T('[3a] V not charged, not paired; nobody flagged by the hold', cpWrites({ posts: [].concat(...p.runs.slice(0, 4).map(r => r.posts)) }, V).length === 0 && pairsWith(p, V, [A, B]) === 0 && flagsOf(p, V) === 0 && flagsOf(p, W) === 0);
  T('[3a] the outside rows gone, the real result settles (depth 0 -> 3)', settledLine(p, h, 2, 0, 3) && processedOf(p.last).has(keyOf(h)));
}
{
  const [V, W, A, B] = R4(310), h = 0x1302;
  const S = starts(h, [V, W]), P = starts(h, [V, W, A, B], [2, 3]), F = settles(h, [V, W, A, B], 0xFF, [2, 3]);
  const p = timeline([S.concat(P), S.concat(P, F), S.concat(P, F), S.concat(P, F)], [V, W]);
  T('[3b] seats 2 / 3 of a four-seat roster: held, neither V nor W charged', allZero(p) && heldLine(p, h, 'a start record names another roster or seat') && cpWrites(p, V).length === 0 && cpWrites(p, W).length === 0, JSON.stringify(cpWrites(p, V)));
  T('[3b] not processed while held', !processedOf(p.last).has(keyOf(h)));
}
{
  const [V, A, B] = R4(320), h = 0x1303;
  const S = starts(h, [V]), P = starts(h, [A, B, V], [0, 1]), F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([S.concat(P), S.concat(P, F), S.concat(P, F), S.concat(P, F)], [V]);
  T('[3c] co-op starts on a solo run\'s key: split, held, V not charged', allZero(p) && pendOf(p.runs[0], h) && pendOf(p.runs[0], h).split === 1
    && heldLine(p, h, 'a start record names another roster or seat') && cpWrites(p, V).length === 0, JSON.stringify(pendOf(p.runs[0], h)));
}
function remembered(script) {
  // V's and W's starts (and A's outside one) are read once, then rotate off; A and B then write the forgery
  const [V, W, A, B] = R4(330), h = 0x1304;
  const S = starts(h, [V, W]), P = starts(h, [A, B, V], [0]), F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([S.concat(P), F, F, F], [V, W], { script });
  return { p, V, W, A, B, h };
}
{
  const { p, V, h } = remembered();
  T('[3d] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3d] the pending entry remembers what V\'s start said', (pendOf(p.runs[0], h).tst || {})[v.pid(V)] === v.testimonyOf(2, 0, { 0: V, 1: SID(331) }), JSON.stringify(pendOf(p.runs[0], h)));
  T('[3d] his start gone, his remembered word holds the forged group; not processed, V not charged',
    heldLine(p, h, 'seat 2 [0-9a-f]+ wrote another roster or seat for this key') && !processedOf(p.last).has(keyOf(h)) && cpWrites(p, V).length === 0, (p.all.match(/[^\n]*Q113[^\n]*/g) || []).join(' | '));
}
function tiedRemembered(script) {
  // the outside starts tie the players at every seat (no majority anywhere), then every start rotates off
  const [V, W, A, B] = R4(370), h = 0x1308;
  const S = starts(h, [V, W]), P = starts(h, [A, B, V], [0, 1]), F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([S.concat(P), F, F, F], [V, W], { script });
  return { p, V, h };
}
{
  const { p, V, h } = tiedRemembered();
  const e = pendOf(p.runs[0], h) || {};
  T('[3d] a tie at every seat still keeps an entry: V\'s word remembered, the forged group held after his start is gone', allZero(p)
    && !!e.roster && Object.keys(e.roster).length === 0 && !!(e.tst || {})[v.pid(V)]
    && heldLine(p, h, 'seat 2 [0-9a-f]+ wrote another roster or seat for this key') && !processedOf(p.last).has(keyOf(h)) && cpWrites(p, V).length === 0,
    JSON.stringify(e));
}
function fullList(script) {
  // the testimony list of the key is already full (sixteen outside starts were read first): V's word is not remembered,
  //   but his start is still on its shard this run
  const [V, W, A, B] = R4(340), h = 0x1305;
  const tst = {};
  for (let i = 0; i < v.OWN_START_CAP; i++) tst[v.pid(SID(950 + i))] = v.testimonyOf(3, 0, { 0: SID(950 + i) });
  const files = { STARTS_FILE: { [keyOf(h)]: { t0: Date.now() - 60000, mt: 7, roster: { 0: v.pid(A), 1: v.pid(B), 2: v.pid(V) }, settled: [], split: 1, tst } } };
  const S = starts(h, [V, W]), F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([S.concat(F), S.concat(F), S.concat(F)], [V, W], { files, script });
  return { p, V, h };
}
{
  const { p, V, h } = fullList();
  T('[3e] a full testimony list: V\'s word not remembered', !((pendOf(p.last, h) || {}).tst || {})[v.pid(V)]);
  T('[3e] his start read this run still holds the forged group; not processed, V not charged', allZero(p) && heldLine(p, h, 'a start record names another roster or seat')
    && !processedOf(p.last).has(keyOf(h)) && cpWrites(p, V).length === 0);
}
function outvoted(script) {
  // three outside accounts start on a two-player run's key before the first look and outvote it 3 to 2 at every seat
  const [V, W, A, B] = R4(350), C = SID(354), h = 0x1306;
  const S = starts(h, [V, W]), P = starts(h, [A, B, V], [0, 1]).concat([{ sid: C, d: start7(h, 2, [A, B, V]) }]);
  const F = settles(h, [A, B, V], 0xF00, [0, 1]), R = settles(h, [V, W], 0, null, { endDepth: 3 });
  const p = timeline([S.concat(P), S.concat(P, F), S.concat(P, F), S.concat(R), S.concat(R)], [V, W], { script });
  return { p, V, W, h };
}
{
  const { p, V, W, h } = outvoted();
  T('[3f] all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3f] the outvoted roster is split: no seat gate, nothing dropped, the players not flagged', (pendOf(p.runs[0], h) || {}).split === 1 && offSeatN(p) === 0 && flagsOf(p, V) === 0 && flagsOf(p, W) === 0,
    JSON.stringify(pendOf(p.runs[0], h)) + ' offSeat=' + offSeatN(p));
  T('[3f] V not charged; the real result settles', cpWrites({ posts: [].concat(...p.runs.slice(0, 3).map(r => r.posts)) }, V).length === 0 && settledLine(p, h, 2, 0, 3));
}
function beforeFix(script) {
  // an entry from before this fix: V's own start remembered (Q69), no testimony, no roster; his start long gone
  const [V, W, A, B] = R4(360), h = 0x1307;
  const files = { STARTS_FILE: { [keyOf(h)]: { t0: Date.now() - 60000, mt: 7, roster: {}, settled: [], synth: true, started: [v.pid(V)] } } };
  const F = settles(h, [A, B, V], 0xF00, [0, 1]);
  const p = timeline([F, F, F], [V, W], { files, script });
  return { p, V, A, B, h };
}
{
  const { p, V, A, B } = beforeFix();
  T('[3g] an entry from before the fix: V (own start remembered, never said this roster) not charged, not paired', allZero(p) && cpWrites(p, V).length === 0 && pairsWith(p, V, [A, B]) === 0, JSON.stringify(cpWrites(p, V)));
  T('[3g] logged as named only', /seat 2 [0-9a-f]+ 15 continues \(17477\) not charged -- never wrote an own record for this run \(Q78\)/.test(p.all));
}

function partialRead(script, coop) {
  // the players' starts sit on shards 7 / 8, unread at the first look (503 every time); the outsiders' starts are read.
  //   Solo: A writes a solo start for V's solo key naming himself at seat 0 (one start registers a solo key). Co-op: A and
  //   B write a two-seat start naming themselves. Registered then, the outsiders' roster would gate the players out.
  const [V, W, A, B] = R4(coop ? 390 : 380), h = coop ? 0x130a : 0x1309;
  const ros = coop ? [V, W] : [V];
  const S = ros.map((s, i) => ({ sid: s, d: start7(h, i, ros), shard: 7 + i }));
  const P = coop ? starts(h, [A, B]) : [{ sid: A, d: start7(h, 0, [A]) }];
  const R = coop ? settles(h, [V, W], 0, null, { endDepth: 3 }).map((r, i) => Object.assign(r, { shard: 20 + i })) : [];
  const fail = { STUB_FAIL: JSON.stringify(coop ? { shard_7: 503, shard_8: 503 } : { shard_7: 503 }) };
  const steps = coop ? [S.concat(P), S.concat(P), S.concat(P, R), S.concat(R), S.concat(R)] : [S.concat(P), S.concat(P)];
  const p = timeline(steps, ros, { script, env: [fail] });
  return { p, V, W, A, h };
}
{
  const { p, V, h } = partialRead();
  T('[3h] solo: all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3h] solo: the first look reads only the outside start -- the key waits for a full read', /read shard failed/.test(p.runs[0].out) && !pendOf(p.runs[0], h)
    && /start-wait: 1 endless key\(s\) not registered/.test(p.runs[0].out), p.runs[0].out.slice(-600));
  T('[3h] solo: the full read registers the key split (two stories), V\'s start not dropped, V not flagged', (pendOf(p.last, h) || {}).split === 1 && offSeatN(p) === 0 && flagsOf(p, V) === 0,
    JSON.stringify(pendOf(p.last, h)) + ' offSeat=' + offSeatN(p));
}
{
  const { p, V, W, h } = partialRead(null, true);
  T('[3h] co-op: all runs exit 0', allZero(p), p.last.out.slice(-800));
  T('[3h] co-op: no roster from the outsiders\' starts alone; the full read ties every seat (empty, split); nothing dropped, nobody flagged',
    !pendOf(p.runs[0], h) && (pendOf(p.runs[1], h) || {}).split === 1 && Object.keys((pendOf(p.runs[1], h) || {}).roster || {}).length === 0
    && offSeatN(p) === 0 && flagsOf(p, V) === 0 && flagsOf(p, W) === 0, JSON.stringify(pendOf(p.runs[1], h)) + ' offSeat=' + offSeatN(p));
  T('[3h] co-op: held while the outside starts stand, the real result settles once they are gone', heldLine(p, h, 'a start record names another roster or seat') && settledLine(p, h, 2, 0, 3));
}

// ---- [4] honest controls ----
{
  const [A, B, C] = R4(400), h = 0x1401;
  const ros = [A, B, C];
  const S = starts(h, ros).concat([{ sid: C, d: start7(h, 2, ros) }]), R = settles(h, ros, 0x200, [0, 1]);
  const p = timeline([S, S.concat(R), S.concat(R)], [C]);
  T('[4] an honest leaver with his start (and a cold-reconnect copy): not split, gated, charged 20 + 30 (1000 -> 950)', allZero(p) && !('split' in (pendOf(p.runs[0], h) || {}))
    && lastCp(p, C) === CP0 - 50 && pairsWith(p, C, [A, B]) === 2 && heldN(p) === 0, JSON.stringify(cpWrites(p, C)));
}
{
  const [V, W] = R4(410), h = 0x1402;
  const S = starts(h, [V, W]), R = settles(h, [V, W], 0xF0, null, { endDepth: 2 });
  const p = timeline([S, S.concat(R), S.concat(R)], [V, W]);
  T('[4] both settle, W pressed continue 15 times: W pays 17,477', allZero(p) && lastCp(p, W) === CP0 - 17477, JSON.stringify(cpWrites(p, W)));
}
function rotatedLeaver(script) {
  const [A, B, C] = R4(420), h = 0x1403;
  const ros = [A, B, C], S = starts(h, ros), R = settles(h, ros, 0x200, [0, 1]);
  const p = timeline([S, starts(h, ros, [0, 1]).concat(R), starts(h, ros, [0, 1]).concat(R)], [C], { script });
  return { p, C, h };
}
{
  const { p, C, h } = rotatedLeaver();
  T('[4] a leaver whose start rotated off before the settle: charged on his remembered word (1000 -> 950)', allZero(p) && lastCp(p, C) === CP0 - 50
    && ((pendOf(p.runs[0], h) || {}).tst || {})[v.pid(C)] === v.testimonyOf(3, 2, { 0: SID(420), 1: SID(421), 2: C }), JSON.stringify(cpWrites(p, C)));
}
{
  // team competitive chain: an honest host writes both segments' starts and results and pays the resume fee
  const [H, D, E] = R4(430), ros = [H, D, E], h0 = 0x1404, h1 = 0x1405;
  const segA = ros.map((s, i) => ({ sid: s, d: seg7(h0, i, ros, 0, 3, SEG_COMP | SEG_SUSPENDED) })).concat(starts(h0, ros));
  const segB = ros.map((s, i) => ({ sid: s, d: seg7(h1, i, ros, 3, 4, SEG_COMP | SEG_RESUMED) })).concat(starts(h1, ros));
  const p = timeline([segA, segA, segA.concat(segB), segA.concat(segB)], [H]);
  T('[4] team competitive: both segments settle, the host pays the resume fee (1000 -> 980)', allZero(p) && (p.all.match(/endless-comp settle /g) || []).length === 2 && lastCp(p, H) === CP0 - 20,
    JSON.stringify(cpWrites(p, H)) + ' ' + (p.all.match(/endless-comp[^\n]*/g) || []).join(' | '));
}
{
  // pinned cost: one outside start on an honest run before the first look splits its roster; the run is held while that
  //   row stands (nobody charged, nobody flagged), and settles once it is gone
  const [A, B, C, X] = R4(440), h = 0x1406;
  const ros = [A, B, C], S = starts(h, ros), P = [{ sid: X, d: start7(h, 2, [A, B, X]) }], R = settles(h, ros, 0x200, [0, 1]);
  const p = timeline([S.concat(P), S.concat(P, R), S.concat(P, R), S.concat(R), S.concat(R)], [C]);
  const held = { posts: [].concat(...p.runs.slice(0, 3).map(r => r.posts)) };
  T('[4] cost: an outside start holds an honest run while it stands (nobody charged or flagged)', allZero(p) && heldLine(p, h, 'a start record names another roster or seat')
    && cpWrites(held, C).length === 0 && flagsOf(p, A) === 0 && flagsOf(p, C) === 0);
  T('[4] cost: the row gone, the run settles and the leaver pays (1000 -> 950)', lastCp(p, C) === CP0 - 50 && processedOf(p.last).has(keyOf(h)), JSON.stringify(cpWrites(p, C)));
}

// ---- [5] wiring pins ----
{
  const iH = SRC.indexOf('const holdWhy = endlessRosterHold(g, roster0, keyStarts, startsPending[c.m]);');
  const iO = SRC.indexOf('const ownE = endlessOwnSet(startsPending[c.m], c.m, recs, starts);');
  T('[5] the hold runs on every endless route, before any charge, seed or pair', iH > 0 && iO > iH && SRC.indexOf('if (isEndlessMt(matchType)) {') < iH);
  T('[5] a held group is counted, warned and skipped (not processed)', /if \(holdWhy\) \{\s*RUN\.endlessHeld = \(RUN\.endlessHeld \| 0\) \+ 1;\s*ghWarn\([^;]+;\s*continue;\s*\}/.test(SRC));
  T('[5] the own set keeps only seats that said so themselves', /const saidSo = endlessTestified\(startsPending\[c\.m\], keyStarts, roster0, g\[0\]\.d\[8\] \| 0, writerSids\);\s*for \(const h of Array\.from\(ownE\)\) if \(!saidSo\.has\(h\)\) ownE\.delete\(h\);\s*const isOwnE = /.test(SRC));
  T('[5] the seat gate no longer skips endless keys', /function seatGateRoster\(p\) \{\s*if \(!p \|\| p\.synth \|\| p\.split \|\| !p\.roster\) return null;/.test(SRC));
  // Q130: the outvoted exemption (a majority roster registering unsplit over a dissent) is for matchmade keys only, so an
  //   endless key still splits on any disagreement
  T('[5] endless registration splits on any disagreement, a tie included', SRC.indexOf('    const seatsSplit = !n || startRosterSplit(att, votes, roster);') > 0
    && SRC.indexOf('    const outvoted = mm && !seatsSplit && startRosterDisagrees(all) ? outvotedStarts(att, t, disputedN) : null;') > 0
    && SRC.indexOf('    } else if (seatsSplit || startRosterDisagrees(all)) {') > 0 && SRC.indexOf('    const mm = isMatchmadeMt(sg[m][0].d[2] | 0);') > 0
    && SRC.indexOf('function isMatchmadeMt(mt) { const b = baseMt(mt); return b === 1 || b === 2 || isTeamMt(mt); }') > 0 && !v.isTeamMt(7) && v.baseMt(7) === 7
    && SRC.indexOf('if (!n && !isEndlessMt(sg[m][0].d[2] | 0)) continue;') > 0);
  T('[5] endless keys skip the dispute filter (every writer votes) and the blank-seat rule (Q130, matchmade only)',
    /let all = att;[^\n]*\n\s*const mm = isMatchmadeMt\(sg\[m\]\[0\]\.d\[2\] \| 0\);\n\s*const blank = mm \? all\.filter\(blankSeatStart\) : \[\];[^\n]*\n\s*if \(blank\.length\) \{[^\n]*\}\n\s*let disputedN = 0;\n\s*if \(!isEndlessMt\(sg\[m\]\[0\]\.d\[2\] \| 0\)\) \{\s*const claim = \{\};/.test(SRC));
  T('[5] testimony remembered for endless keys in the start upkeep', /if \(isEndlessMt\(p\.mt\)\) noteTestimony\(p, \(sg\[m\] \|\| \[\]\)\.concat\(groups\[m\] \|\| \[\]\)\);/.test(SRC));
  T('[5] no fallback to every writer for the casual pair', !/ownRosterSids\.length \? ownRosterSids : writerSids/.test(SRC));
  T('[5] run summary row', /s\('endlessHeld', 0\)/.test(SRC));
  T('[5] endless keys wait for a full read (main passes shardsComplete, reconcileStarts its readComplete)',
    /if \(readComplete === false && isEndlessMt\(sg\[m\]\[0\]\.d\[2\] \| 0\)\) \{ waiting\+\+; continue; \}/.test(SRC)
    && /registerStartRosters\(starts, processed, startsPending, Date\.now\(\), shardsComplete\)/.test(SRC)
    && /registerStartRosters\(starts, processed, pending, now, readComplete\)/.test(SRC));
  T('[5] exports', ['rosterCanon', 'startRosterDisagrees', 'testimonyOf', 'recTestimony', 'noteTestimony', 'endlessRosterHold', 'endlessTestified'].every(f => typeof v[f] === 'function'));
}

// ---- [6] mutation self-checks ----
console.log('-- [6] mutation self-checks --');
{
  const h1 = () => {
    // H1a / H1c with the forged rows left standing: the gate is what lets the real result settle beside them
    const [V, W, A, B] = R4(600), h = 0x1601;
    const S = starts(h, [V, W]), F = settles(h, [A, B, V], 0xF00, [0, 1]), R = settles(h, [V, W], 0, null, { endDepth: 3 });
    return { V, W, h, steps: [S, S.concat(F), S.concat(F, R), S.concat(F, R)] };
  };
  const mutants = [
    ['endless keys excluded from the seat gate again', '  if (!p || p.synth || p.split || !p.roster) return null;', '  if (!p || p.synth || p.split || !p.roster || isEndlessMt(p.mt | 0)) return null;', (script) => {
      const x = h1(); const p = timeline(x.steps, [x.V, x.W], { script });
      return !settledLine(p, x.h, 2, 0, 3);
    }],
    ['no endless split check', '    } else if (seatsSplit || startRosterDisagrees(all)) {', '    } else if (!isEndlessMt(pending[m].mt) && (seatsSplit || startRosterDisagrees(all))) {', (script) => {
      const x = outvoted(script);
      return !settledLine(x.p, x.h, 2, 0, 3) || offSeatN(x.p) > 0;
    }],
    ['a tied endless key registers nothing again', 'if (!n && !isEndlessMt(sg[m][0].d[2] | 0)) continue;', 'if (!n) continue;', (script) => {
      const x = tiedRemembered(script);
      return processedOf(x.p.last).has(keyOf(x.h));
    }],
    ['hold removed', 'if (holdWhy) {', 'if (false) {', (script) => {
      const x = preemptA(script);
      return !settledLine(x.p, x.h, 2, 0, 3);
    }],
    ['a named player\'s remembered word not checked', "if (tst[h] != null && tst[h] !== testimonyOf(pc, s, roster0)) return", 'if (false) return', (script) => {
      const x = remembered(script);
      return processedOf(x.p.last).has(keyOf(x.h));
    }],
    ['this run\'s starts not checked', 'for (const r of keyStarts) if (recTestimony(r) !== testimonyOf(pc, r.d[5], roster0)) return', 'for (const r of []) return', (script) => {
      const x = fullList(script);
      return processedOf(x.p.last).has(keyOf(x.h));
    }],
    ['own word not required', 'for (const h of Array.from(ownE)) if (!saidSo.has(h)) ownE.delete(h);', '', (script) => {
      const x = beforeFix(script);
      return cpWrites(x.p, x.V).length > 0;
    }],
    ['endless keys register on a partial read', '    if (readComplete === false && isEndlessMt(sg[m][0].d[2] | 0)) { waiting++; continue; }   // Q113: next full read', '', (script) => {
      const x = partialRead(script);
      return !!pendOf(x.p.runs[0], x.h) || offSeatN(x.p) > 0 || flagsOf(x.p, x.V) > 0;
    }],
    ['testimony not remembered', 'if (isEndlessMt(p.mt)) noteTestimony(p, (sg[m] || []).concat(groups[m] || []));', '', (script) => {
      const x = rotatedLeaver(script);
      return lastCp(x.p, x.C) !== CP0 - 50;
    }],
    ['off-seat writers flagged by the seat gate again (the Q80 loop, endless keys too)', '  //   clean) and gains nothing by the records (dropped).\n',
      '  //   clean) and gains nothing by the records (dropped).\n'
        + "  for (const [m, rs] of seatGate.out) { if (recordFlag(signals, rs, m + '|seat', Date.now())) sigDirty = true; for (const r of rs) trustTouched.add(String(r.steamID)); }\n", (script) => {
      const x = soloFirst(script);
      return flagsOf(x.p, x.V) > 0 || flagsOf(x.p, x.W) > 0;
    }],
  ];
  for (const [label, from, to, check] of mutants) {
    if (SRC.split(from).length !== 2) { bad('[6] ' + label + ': anchor not found exactly once'); continue; }
    const script = path.join(__dirname, '..', '.mutant-endless-borrowed-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, to));
      T('[6] ' + label + ' -> the scenario goes red', check(script));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

// ---- [7] Q128: an endless key without a seat gate -- records that disagree flag nobody ----
// REVIEW-2 of Q113, A5 / A5b: an outside account X copies the key of V and W's two-player run into a start naming [V, X]
//   (the roster splits: no seat gate), then writes a settle of his own whose scores do not match theirs. The group turned
//   inconsistent and V and W were flagged once each (the run does not settle while his record stays). Now nobody is
//   flagged on an endless key the gate does not cover; on a gated key a player's own disagreeing result still flags both.
const xSettle = (h, ros, seat, sc) => { const d = settle7(h, seat, ros, 0, { endDepth: 3 }); d[10 + seat] = sc; return d; };
function ungatedA5(script, late) {
  const [V, W, X] = R4(700), h = late ? 0x1702 : 0x1701, S = starts(h, [V, W]);
  const PX = [{ sid: X, d: start7(h, 1, [V, X]) }];
  const F = settles(h, [V, W], 0, null, { endDepth: 3 }).concat([{ sid: X, d: xSettle(h, [V, X], 1, 999) }]);
  // A5: X's start is read with theirs (split at registration); A5b: a run later, inside the provisional window (Q118)
  const steps = late ? [S, S.concat(PX), S.concat(PX, F), S.concat(PX, F), S.concat(PX, F)] : [S.concat(PX), S.concat(PX, F), S.concat(PX, F), S.concat(PX, F)];
  const p = timeline(steps, [V, W], { script, gaps: late ? [0, 4 * 60000] : null });
  return { p, V, W, X, h };
}
const seatGateRosterOf = (p, h) => v.seatGateRoster(pendOf(p.last, h));
const ungatedN = (p) => sumOf(p, /\| endless keys without a seat gate whose records disagree, nobody flagged \(Q128\) \| ([0-9]+) \|/);
for (const late of [false, true]) {
  const tag = late ? '[7] A5b' : '[7] A5';
  const { p, V, W, X, h } = ungatedA5(null, late);
  T(tag + ' all runs exit 0; the roster split ' + (late ? 'by X\'s later start (Q118)' : 'at registration'), allZero(p)
    && (late ? /start-split [^\n]*names another roster[^\n]*\(Q118\)/.test(p.runs[1].out) : /start-split [^\n]*the endless settle checks decide \(Q113\)/.test(p.runs[0].out))
    && (pendOf(p.last, h) || {}).split === 1, p.runs[late ? 1 : 0].out.slice(-600));
  T(tag + ' the disagreeing group is logged and counted, nobody flagged (V, W, X)', /ungated-mismatch [^\n]*nobody flagged \(Q128\)/.test(p.all) && ungatedN(p) > 0
    && [V, W, X].every(s => flagsOf(p, s) === 0), JSON.stringify([V, W, X].map(s => flagsOf(p, s))));
  T(tag + ' nothing settles while X\'s record stays, nobody charged', !processedOf(p.last).has(keyOf(h)) && [V, W, X].every(s => cpWrites(p, s).length === 0));
}
{
  // [7c] no start read at all (the key never registered): the same outside settle, the same answer
  const [V, W, X] = R4(710), h = 0x1711;
  const F = settles(h, [V, W], 0, null, { endDepth: 3 }).concat([{ sid: X, d: xSettle(h, [V, X], 1, 999) }]);
  const p = timeline([F, F, F], [V, W]);
  T('[7c] no roster registered: the disagreeing group flags nobody', allZero(p) && !seatGateRosterOf(p, h) && [V, W, X].every(s => flagsOf(p, s) === 0) && ungatedN(p) > 0,
    JSON.stringify([V, W, X].map(s => flagsOf(p, s))) + ' ' + JSON.stringify(pendOf(p.last, h)));
}
{
  // [7d] control: a gated key (V and W's starts agree) where W writes a result of his own that disagrees: both flagged once
  const [V, W] = R4(720), h = 0x1721, S = starts(h, [V, W]);
  const F = [{ sid: V, d: settle7(h, 0, [V, W], 0, { endDepth: 3 }) }, { sid: W, d: xSettle(h, [V, W], 1, 999) }];
  const p = timeline([S, S.concat(F), S.concat(F)], [V, W]);
  T('[7d] control: a gated key whose players disagree still flags both once, nothing settles', allZero(p) && !!seatGateRosterOf(p, h)
    && flagsOf(p, V) === 1 && flagsOf(p, W) === 1 && ungatedN(p) === 0 && !processedOf(p.last).has(keyOf(h)),
    JSON.stringify([flagsOf(p, V), flagsOf(p, W)]) + ' ' + JSON.stringify(pendOf(p.last, h)));
}
{
  T('[7] wiring: after the settled-key skip, before recordFlag; summary row', /RUN\.lateMismatch = [\s\S]{0,300}?continue;\n\s+\}\n[\s\S]{0,900}?if \(isEndlessMt\(g\[0\]\.d\[2\] \| 0\) && !seatGateRoster\(startsPending\[m\]\)\) \{[\s\S]{0,300}?continue;\n\s+\}\n(?:[\s\S]{0,400}?const pd1 = pairDispute1v1\(g\);[\s\S]{0,1600}?continue;\n\s+\}\n)?\s+if \(recordFlag\(signals, g, m, nowMs\)\)/.test(SRC)
    && /'\| endless keys without a seat gate whose records disagree, nobody flagged \(Q128\) \| ' \+ s\('endlessUngated', 0\)/.test(SRC));
  const from = 'if (isEndlessMt(g[0].d[2] | 0) && !seatGateRoster(startsPending[m])) {';
  if (SRC.split(from).length !== 2) bad('[7] mutant: anchor not found exactly once');
  else {
    const script = path.join(__dirname, '..', '.mutant-endless-borrowed-q128-' + process.pid + '.js');
    try {
      fs.writeFileSync(script, SRC.replace(from, 'if (false) {'));
      const x = ungatedA5(script, false);
      T('[7] mutant: the endless skip removed -> V and W flagged again', flagsOf(x.p, x.V) === 1 && flagsOf(x.p, x.W) === 1, JSON.stringify([flagsOf(x.p, x.V), flagsOf(x.p, x.W)]));
    } finally { try { fs.unlinkSync(script); } catch (e) {} }
  }
}

if (failN) { console.log('FAIL x' + failN); process.exit(1); }
console.log('ALL OK');
