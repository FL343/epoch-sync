'use strict';
// Team-gamble accusations: the honest writers of a key whose accused has no own start read yet (cloud audit Q285 / Q286,
// both left by the Q43 own-evidence rule, A06 / Q69).
//   [1] Q285, ranked 2v2: the host takes the reveals and quits, the three joiners refuse and name him. The first run that
//       reads the key misses the shard holding his start (and no earlier run read it). Before: the accusation pass did
//       not store 'nostart' (right) but left the key on the rank-conflict path, so the three joiners were flagged once
//       each, and the full read that finds his start struck him with their flags already counted (a key is flagged once).
//       Now the key is held that run like a strike waiting for a full read: nobody flagged, then he is struck alone.
//   [2] the same with a host who never wrote a start at all (A06): held on the partial read, then on the full read
//       'nostart' (record only) and the old path flags the writers exactly as before (one run later).
//   [3] Q286 pure: team2AccusedKey asks the same own-start evidence as the accusation pass (t2OwnEvidence); without it
//       (unit use) every seat reads as having started, as before.
//   [4] Q286, ranked 3v3: the host's side won; two of the winners refuse and name a losing seat that dropped before
//       level 1 (no start, no settle). Before: team2AccusedKey said "Q43 charges it", the team-dissent pass stepped
//       aside, the accusation pass only counted the names ('nostart'), and the key fell to the rank-conflict path --
//       the three truthful writers flagged, the two refusers never struck. Now the dissent pass strikes the two, as
//       before Q43. Control: the dropped seat wrote his own start -> the accusation pass strikes him (unchanged).
//   [5] Q286 on a partial read: the dissent pass leaves the key to the accusation pass, which holds it (Q285); the next
//       full read decides as in [4]. Nobody is flagged on the partial read.
//   [6] mutation self-checks (each fix removed -> its scenario goes red) and wiring pins.
// Runs the REAL validate.js main() against an offline board stub (same harness as test/team2-accuse.js).
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
  "const HIDE = JSON.parse(process.env.STUB_HIDE || '[]');   // boards left out of the listing (an incomplete read)",
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
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.filter(b => HIDE.indexOf(b.name) < 0).map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
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

// one cron run of `validate` (the real file, or a mutant copy beside it) over `boards`; hide = board names left out of
//   the listing (an incomplete read)
function runCronOnce(boards, files, hide, validate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-accuse-hold-'));
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
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, STUB_HIDE: JSON.stringify(hide || []), GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned: ranked points go to 'points' (season boards start later)
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, validate || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (test/team2-accuse.js advance)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  const cf = files.CONFESSIONS_FILE || {};
  for (const k of Object.keys(cf)) if (cf[k] && cf[k].t0) cf[k].t0 -= ms;
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (st[k] && st[k].r) st[k].r -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.t2ac || {})) for (const e of sg.t2ac[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2av || {})) sg.t2av[k].t -= ms;
    for (const k of Object.keys(sg.t2ah || {})) sg.t2ah[k] -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
}
// a run (6 minutes after the last), and -- when it deferred a strike for a seat with no record (the absent-seat
//   grace) -- the run a grace period later, on the same boards (test/team2-accuse.js runCron)
const GRACE_STEP = v.ABSENT_GRACE_MS + 60000;
function runCron(boards, files, hide, validate) {
  const r = runCronOnce(boards, files, hide, validate);
  if (!/strike deferred/.test(r.out)) return r;
  const r2 = runCronOnce(boards, advance(r.state, GRACE_STEP), hide, validate);
  return Object.assign({}, r2, { out: r.out + r2.out, first: r });
}
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const acOf = (r, sid) => ((sigOf(r).t2ac || {})[v.pid(sid)] || []);
const avOf = (r, m, sid) => (sigOf(r).t2av || {})[m + '|' + v.pid(sid)];
const ldOf = (r, sid) => ((sigOf(r).t2ld || {})[v.pid(sid)] || []);
const lvOf = (r, m) => (sigOf(r).t2lv || {})[m];
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const ALL = [A, B, C, D, E, F];
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const TAG = v.T2BY_TAG;
const FLOOR = v.SANITY.MIN_START_AGE_MS;
// mode-2 settle record (test/team2-accuse.js t2): roster by seat (seat 0 = host), team 0 wins unless o.win; o.rank /
//   o.tag for a refusal (rank claim 0 + the client Q43 name int after the roster)
function t2(mt, hash, seat, roster, o) {
  o = o || {};
  const pc = roster.length, ts = pc / 2, win = o.win == null ? 0 : o.win;
  const scores = roster.map((s, i) => 6000 - 500 * i);
  const myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (myTeam === win ? 1 : 0), pc, 900].concat(scores, [0]);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  if (o.tag != null) d.push(o.tag | 0);
  return d;
}
// start attestation (magic 0xB2): the settle layout with the result fields zeroed
function startRec(mt, hash, seat, roster) {
  const pc = roster.length;
  const d = [0xB2, 3, mt, hash | 0, 4321, seat, 0, 0, pc, 0].concat(roster.map(() => 0), [0]);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// 50 shards; each entry { sid, d, shard } lands on shard_<shard>; plus the stat boards
function boards(entries) {
  const out = [];
  for (let i = 0; i < 50; i++) out.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const x of entries) out[x.shard].entries.push({ steamID: x.sid, score: 1, details: x.d });
  out.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return out;
}
// an attested start sighted `ago` ms before the run (pid roster), its own starts noted for `started` (Q69)
function pendOf(mt, hash, roster, ago, started) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [], started: started.map(s => v.pid(s)) };
}
// a mutant copy of validate.js beside it (it requires its siblings): [from, to] pairs, each anchor exactly once
function mutant(tag, pairs) {
  let src = SRC;
  for (const [from, to] of pairs) {
    if (src.split(from).length !== 2) return null;
    src = src.replace(from, to);
  }
  const file = path.join(__dirname, '..', '.mutant-t2ac-hold-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(file, src);
  return file;
}

// ---- [1] [2] Q285: the accused host's start sits on a shard the first run did not read ----
const R4 = [A, B, C, D];   // host A; team 0 = A, B; team 1 = C, D
function q285(hash, aStart, validate) {
  // the host A took the reveals and quit (no settle record); B C D refuse naming seat 0. Settle records on shards 0-3,
  //   the starts on 10-13 (A's on shard 10, when he wrote one); the first run misses shard 10 (or, with no start of A,
  //   an empty shard 40), and no earlier run read the key
  const recs = R4.map((sid, seat) => ({ sid, d: t2(6, hash, seat, R4, { rank: 0, tag: TAG | 1 }), shard: seat })).filter(x => x.sid !== A);
  const starts = R4.map((sid, seat) => ({ sid, d: startRec(6, hash, seat, R4), shard: 10 + seat })).filter(x => aStart || x.sid !== A);
  const bd = boards(recs.concat(starts));
  const r1 = runCronOnce(bd, {}, [aStart ? 'shard_10' : 'shard_40'], validate);
  const r2 = runCron(bd, advance(r1.state, 6 * 60000), [], validate);
  const r3 = runCron(bd, advance(r2.state, 6 * 60000), [], validate);
  return { r1, r2, r3, m: keyOf(recs[0].d) };
}
{
  const x = q285(0x2850, true);
  T('[1] runs exit 0', x.r1.code === 0 && x.r2.code === 0 && x.r3.code === 0, x.r1.out.slice(-600));
  T('[1] partial first read: the key is held -- B C D not flagged, nothing stored for A, logged', [A, B, C, D].every(s => fOf(x.r1, s) === 0) && !avOf(x.r1, x.m, A)
    && /team2 accusation [^\n]*3 writers name [^\n]*-- no own start of his read, not every record shard was read this run, deferred \(Q285\)/.test(x.r1.out)
    && /team2 accusations: [^\n]*1 deferred/.test(x.r1.out), 'f=' + [A, B, C, D].map(s => fOf(x.r1, s)).join(',') + ' ' + x.r1.out.slice(-500));
  T('[1] the full read finds his start: A struck (left, free), flagged alone; B C D stay clean', avOf(x.r3, x.m, A) && avOf(x.r3, x.m, A).v === 'free' && acOf(x.r3, A).length === 1
    && fOf(x.r3, A) === 1 && [B, C, D].every(s => fOf(x.r3, s) === 0), JSON.stringify(avOf(x.r3, x.m, A)) + ' f=' + [A, B, C, D].map(s => fOf(x.r3, s)).join(',') + ' ' + x.r2.out.slice(-500));
  T('[1] the joiners are struck by nobody', [B, C, D].every(s => acOf(x.r3, s).length === 0 && ldOf(x.r3, s).length === 0));
  const y = q285(0x2852, false);
  T('[2] A06 control runs exit 0', y.r1.code === 0 && y.r2.code === 0 && y.r3.code === 0, y.r1.out.slice(-600));
  T('[2] A06: held on the partial read (nobody flagged), nothing stored', [A, B, C, D].every(s => fOf(y.r1, s) === 0) && !avOf(y.r1, y.m, A) && /deferred \(Q285\)/.test(y.r1.out));
  T('[2] A06: the full read stores nostart (record only), A never struck; the writers flagged as before (old path)', avOf(y.r3, y.m, A) && avOf(y.r3, y.m, A).v === 'nostart'
    && acOf(y.r3, A).length === 0 && fOf(y.r3, A) === 0 && [B, C, D].every(s => fOf(y.r3, s) === 1), JSON.stringify(avOf(y.r3, y.m, A)) + ' f=' + [A, B, C, D].map(s => fOf(y.r3, s)).join(','));
}

// ---- [3] Q286 pure: one own-start evidence for both passes ----
const R6 = [A, B, C, D, E, F];   // host A; team 0 = A, B, C (the winners below); team 1 = D, E, F
// the host's side won; B and C (winners) refuse and name seat 5 (F, a loser who wrote nothing); A, D, E write the result
const q286recs = (hash) => R6.map((sid, seat) => ({ sid, d: t2(9, hash, seat, R6, (seat === 1 || seat === 2) ? { rank: 0, tag: TAG | (1 << 5) } : null), shard: seat })).filter(x => x.sid !== F);
{
  const recs = q286recs(0x2860).map(x => ({ steamID: x.sid, d: x.d, dispCode: 0, roster: v.decodeRoster(x.d) }));
  const m = keyOf(recs[0].d);
  const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
  T('[3] the shape: a team dissent (B, C on the winning side)', (() => { const td = v.team2Dissent(recs, vecOf); return td && td.ds.map(d => d.sid).join() === [B, C].join(); })());
  const evNo = { starts: { [m]: pendOf(9, 0x2860, R6, 0, [A, B, C, D, E]) }, startRecs: [] };
  const evYes = { starts: { [m]: pendOf(9, 0x2860, R6, 0, [A, B, C, D, E, F]) }, startRecs: [] };
  const evRead = { starts: { [m]: pendOf(9, 0x2860, R6, 0, [A, B, C, D, E]) }, startRecs: [{ steamID: F, d: startRec(9, 0x2860, 5, R6) }] };
  T('[3] t2OwnEvidence: pend.started, or a start read this run; nobody else', v.t2OwnEvidence(evNo)(m)(A) === true && v.t2OwnEvidence(evNo)(m)(F) === false
    && v.t2OwnEvidence(evYes)(m)(F) === true && v.t2OwnEvidence(evRead)(m)(F) === true && v.t2OwnEvidence(evRead)('x_y_9')(F) === false && v.t2OwnEvidence(null)(m)(A) === false);
  T('[3] team2AccusedKey without own evidence (unit use): Q43\'s, as before', v.team2AccusedKey(recs, {}, m) === true);
  T('[3] ... with the evidence and F never started: not Q43\'s (the Q43 pass would only count it: nostart)', v.team2AccusedKey(recs, {}, m, v.t2OwnEvidence(evNo)(m)) === false
    && v.team2Accusations(recs, v.t2OwnEvidence(evNo)(m)).every(e => !e.strike && e.nc === 'nostart'));
  T('[3] ... F wrote his own start (noted, or read this run): Q43\'s (it strikes him: left)', v.team2AccusedKey(recs, {}, m, v.t2OwnEvidence(evYes)(m)) === true && v.team2AccusedKey(recs, {}, m, v.t2OwnEvidence(evRead)(m)) === true);
  // the two passes agree: the dissent pass steps aside exactly when the accusation pass strikes
  for (const [label, ev] of [['no start', evNo], ['noted start', evYes], ['start read this run', evRead]]) {
    const own = v.t2OwnEvidence(ev)(m);
    T('[3] agree (' + label + '): team2AccusedKey === the accusation pass strikes', v.team2AccusedKey(recs, {}, m, own) === v.team2Accusations(recs, own).some(e => e.strike));
  }
}

// ---- [4] [5] Q286 e2e, ranked 3v3 ----
function q286(hash, fStarted, hide, validate) {
  const recs = q286recs(hash);
  const m = keyOf(recs[0].d);
  const started = fStarted ? R6 : [A, B, C, D, E];
  const r1 = runCron(boards(recs), { STARTS_FILE: { [m]: pendOf(9, hash, R6, FLOOR + 5 * 60000, started) } }, hide, validate);
  const r2 = runCron(boards(recs), advance(r1.state, 6 * 60000), [], validate);
  return { r1, r2, m };
}
{
  const x = q286(0x2862, false, []);
  T('[4] runs exit 0', x.r1.code === 0 && x.r2.code === 0, x.r1.out.slice(-600));
  T('[4] the team-dissent pass decides: B and C struck (own side, free), verdict stored', ldOf(x.r1, B).length === 1 && ldOf(x.r1, C).length === 1 && lvOf(x.r1, x.m) && lvOf(x.r1, x.m).v === 'free',
    JSON.stringify(lvOf(x.r1, x.m)) + ' ' + x.r1.out.slice(-600));
  T('[4] the three truthful writers (A, D, E) are not flagged; B and C are', [A, D, E].every(s => fOf(x.r2, s) === 0) && [B, C].every(s => fOf(x.r2, s) === 1),
    'f=' + R6.map(s => fOf(x.r2, s)).join(','));
  T('[4] the accusation pass leaves the key (no verdict stored for F, nobody struck)', !avOf(x.r2, x.m, F) && R6.every(s => acOf(x.r2, s).length === 0));
  const c = q286(0x2864, true, []);
  T('[4] control: F wrote his own start -> the accusation pass strikes him (left), the dissent pass steps aside (unchanged)', avOf(c.r2, c.m, F) && avOf(c.r2, c.m, F).v === 'free'
    && !lvOf(c.r2, c.m) && [B, C].every(s => ldOf(c.r2, s).length === 0) && [A, B, C, D, E].every(s => fOf(c.r2, s) === 0) && fOf(c.r2, F) === 1,
    JSON.stringify(avOf(c.r2, c.m, F)) + ' f=' + R6.map(s => fOf(c.r2, s)).join(','));
  const p = q286(0x2866, false, ['shard_40']);
  T('[5] partial read: the dissent pass leaves the key to the accusation pass, which holds it -- nobody flagged, no verdict', !lvOf(p.r1, p.m) && !avOf(p.r1, p.m, F)
    && R6.every(s => fOf(p.r1, s) === 0) && /deferred \(Q285\)/.test(p.r1.out), 'f=' + R6.map(s => fOf(p.r1, s)).join(',') + ' ' + p.r1.out.slice(-500));
  T('[5] the next full read decides as in [4]: B, C struck; A, D, E clean', ldOf(p.r2, B).length === 1 && ldOf(p.r2, C).length === 1 && [A, D, E].every(s => fOf(p.r2, s) === 0),
    'f=' + R6.map(s => fOf(p.r2, s)).join(','));
}

// ---- [6] mutation self-checks + pins ----
{
  const HOLD = "if (!heldKeys.has(m)) {\n            heldKeys.add(m); res.held++;";
  const mutants = [
    ['Q285 hold removed (the partial read leaves the key on the old path)', [[HOLD, 'if (false) {\n            heldKeys.add(m); res.held++;']],
      (file) => { const x = q285(0x2870, true, file); return [B, C, D].some(s => fOf(x.r1, s) === 1); }],
    ['Q286: team2AccusedKey ignores the own evidence', [['if (team2Accusations(g, own).some(e => e.strike)) return true;', 'if (team2Accusations(g).some(e => e.strike)) return true;']],
      (file) => { const x = q286(0x2872, false, [], file); return [A, D, E].some(s => fOf(x.r2, s) === 1); }],
    ['Q286: main does not hand the dissent pass the evidence', [["applyTeam2LoneDissent(gr, signals, processed, Date.now(), vecOf, { complete: shardsComplete, starts: startsPending, startRecs: starts })", 'applyTeam2LoneDissent(gr, signals, processed, Date.now(), vecOf)']],
      (file) => { const x = q286(0x2874, false, [], file); return [A, D, E].some(s => fOf(x.r2, s) === 1); }],
    ['Q286 + Q285: the partial-read hold removed', [[HOLD, 'if (false) {\n            heldKeys.add(m); res.held++;']],
      (file) => { const x = q286(0x2876, false, ['shard_40'], file); return [A, D, E].some(s => fOf(x.r1, s) === 1); }],
  ];
  mutants.forEach(([label, pairs, check], i) => {
    const file = mutant(i, pairs);
    if (!file) { bad('[6] mutant ' + label + ': anchor not found exactly once'); return; }
    try { T('[6] mutant: ' + label + ' -> its scenario goes red', check(file)); }
    finally { try { fs.unlinkSync(file); } catch (e) {} }
  });
  const ap = SRC.slice(SRC.indexOf('function applyTeam2Accusations'), SRC.indexOf('// clamp-aware authoritative leaver deduction'));
  const ld = SRC.slice(SRC.indexOf('function applyTeam2LoneDissent'), SRC.indexOf('function leaverLpPenalty'));
  T('[6] pins: both passes read own evidence through t2OwnEvidence; the dissent pass only on a full read', /const ownOf = hold \? t2OwnEvidence\(hold\) : null;/.test(ap) && /const own = ownOf \? ownOf\(m\) : null;/.test(ap)
    && /const ownOf = \(ev && ev\.complete !== false\) \? t2OwnEvidence\(ev\) : null;/.test(ld) && /team2AccusedKey\(g, signals, m, ownOf \? ownOf\(m\) : undefined\)/.test(ld));
  T('[6] pins: the main path hands both passes the same starts', /applyTeam2LoneDissent\(gr, signals, processed, Date\.now\(\), vecOf, \{ complete: shardsComplete, starts: startsPending, startRecs: starts \}\)/.test(SRC)
    && /applyTeam2Accusations\(gr, signals, processed, Date\.now\(\), \{ complete: shardsComplete, graceMs: ABSENT_GRACE_MS, starts: startsPending, startRecs: starts/.test(SRC));
  T('[6] pins: a held key leaves the settle / flag paths (shared with the strike hold)', /const keep = \(c\) => processed\.has\(c\.m\) \|\| t2lv\[c\.m\] \|\| \(!struck\.has\(c\.m\) && !heldKeys\.has\(c\.m\)\);/.test(ap));
  T('[6] exports', typeof v.t2OwnEvidence === 'function' && v.team2AccusedKey.length === 4 && v.applyTeam2LoneDissent.length === 6);
}

if (failN) { console.log('team2-accuse-hold: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-accuse-hold: all passed');
