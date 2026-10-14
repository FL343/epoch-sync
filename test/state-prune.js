'use strict';
// Q144 (cloud audit 2026-10, found by the Q130 review, section 6): what the job remembers about keys whose records are gone.
// Any account that owns the game writes ledger rows for keys it makes up, one per shard row, new ones every run. Before,
//   the job kept the note of a matchmade key (pending['~' + key], Q127) a day, an endless / friends'-room / bot entry 30
//   days and the processed key list for good: one account writing 50 made-up keys a run grew starts.json about 1.3 MB
//   (notes) or 2.4 MB a day (endless entries), a pair of accounts processed.json 7200 keys a day, and a state file
//   over 100 MB stops the job's commit. Now a note and an endless / friends'-room / bot entry go once they are
//   STARTS_MATURITY_MS old and no record of their key was on the shards on a complete read; the processed list keeps at
//   most PROCESSED_CAP keys, dropping the oldest ones that were off the shards on two complete reads
//   PROCESSED_PRUNE_WAIT_MS apart down to PROCESSED_KEEP.
//   [0] wiring pins (main builds the seen keys before any gate and passes them; the prune runs after loadStarts; the
//       summary rows)
//   [1] reconcileStarts notes: gone + mature -> dropped; seen, young, incomplete read, a registered entry, no seen set
//       (direct caller) -> kept; a processed key's note and a day-old note go as before; a contested note still voids
//   [2] reconcileStarts endless / friends' room / bot entries: gone + mature -> dropped (cleaned); seen, young, incomplete
//       read -> kept; a matchmade entry keeps its own end (the verdict at maturity), nothing new
//   [3] pruneProcessed: under the cap nothing; over it the first complete read arms, the drop waits, keys seen at the arm
//       or at the drop stay, an incomplete read drops nothing, a changed front re-arms
//   [4] main(): one account, 50 made-up ranked 1V1 starts a run -> the notes stop at the ones under two hours old; a key
//       still on a shard (a start, or only a confession) keeps its note; an incomplete read drops nothing, the next complete
//       one does; an honest 1V1 in the same runs settles once
//   [5] main(): 50 made-up solo endless starts a run -> the entries stop the same way; an endless start still on its shard
//       keeps its entry (and its first-seen time); friends' room and bot starts of two accounts the same
//   [6] main(): the processed list past a small cap: armed, waits, an incomplete read drops nothing, then the oldest go; a
//       processed key still on a shard is kept and its match does not settle again; the summary row
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/team-loss-side.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'PROCESSED_CAP', 'PROCESSED_KEEP', 'PROCESSED_PRUNE_WAIT_MS',
  'ENDLESS_PENDING_TTL_MS'];
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-prune-'));
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
      // pin the season clock (the points writes read below go to that season's board otherwise)
      SEASON_NOW: '2026-10-01T00:00:00Z',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (the job clock is Date.now(), so every stored
//   instant moves back instead: start sightings, key notes and the prune candidate, absent-seat stamps, the busy marks)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
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

const X = SID(441), Y = SID(442), Z = SID(443), P1 = SID(444), P2 = SID(445);
const ALL = [X, Y, Z, P1, P2];
// recs: [{ sid, d, shard? }] spread over distinct shard rows (one account = one entry per shard; shard: an explicit index)
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) {
    if (r.shard != null) { boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); continue; }
    used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d });
  }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state the first run starts from
function timeline(steps, script, files0) {
  const out = []; let state = null;
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : (files0 || null), env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000, MAT = v.STARTS_MATURITY_MS;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');
const notesOf = (r) => Object.keys(r.state.STARTS_FILE || {}).filter((k) => k.charAt(0) === '~' && k !== v.PRUNE_NOTE);
const entriesOf = (r) => Object.keys(r.state.STARTS_FILE || {}).filter((k) => k.charAt(0) !== '~');
const ROW_GONE = (r, a, b) => r.summary.indexOf("| starts-state notes / endless, friends' room and bot entries dropped, no record of the key left on the shards (Q144) | " + a + ' / ' + b + ' |') >= 0;
const ROW_PROC = (r, a, b) => r.summary.indexOf('| processed keys remembered / dropped past the cap (Q144) | ' + a + ' / ' + b + ' |') >= 0;
const FAIL_ONE = { STUB_FAIL: JSON.stringify({ shard_49: 503 }) };   // one shard read fails: an incomplete read

console.log('=== what the job remembers about keys whose records are gone (Q144) ===');

// ---- [0] wiring pins ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  pin('main: the seen keys, every record read this run, before any gate',
    "  const seenKeys = new Set(recs.concat(starts).map((r) => r.d[3] + '_' + r.d[4] + '_' + r.d[2]).concat(confessions.map((c) => c.m), notes.map((c) => c.m)));\n");   // Q64: + exit notes
  pin('main: the prune runs on the seen keys and the read state, after loadStarts',
    '  const startsPending = loadStarts();\n  // Q144: past PROCESSED_CAP, the oldest keys off the shards on two complete reads an hour apart are dropped\n  const prunedP = pruneProcessed(processed, startsPending, seenKeys, shardsComplete, Date.now());\n');
  pin('main: reconcileStarts gets the seen keys', 'STARTS_MATURITY_MS, confState, shardsComplete, registeredEarly, seenKeys, noted);');   // Q64: + the exit notes
  pin('reconcileStarts: gone = not seen on a complete read', "  const gone = (m) => !!seenKeys && readComplete !== false && !seenKeys.has(m);\n");
  pin('the summary row: notes / entries dropped', "      '| starts-state notes / endless, friends\\' room and bot entries dropped, no record of the key left on the shards (Q144) | ' + s('noteGone', 0) + ' / ' + s('entryGone', 0) + ' |',\n");
  pin('the summary row: the processed list', "      '| processed keys remembered / dropped past the cap (Q144) | ' + s('processedN', 0) + ' / ' + s('processedPruned', 0) + ' |',\n");
  T('[0] the candidate slot is a note no roster loop reads, skipped by the upkeep loop', v.PRUNE_NOTE.charAt(0) === '~'
    && SRC.indexOf('    if (m === PRUNE_NOTE) continue;') >= 0);
  T('[0] defaults: cap 300000, keep 250000, wait an hour', v.PROCESSED_CAP === 300000 && v.PROCESSED_KEEP === 250000 && v.PROCESSED_PRUNE_WAIT_MS === HOUR);
}

// ---- [1] notes ----
{
  const K = '111_7_2', K2 = '222_7_2';
  const note = (t0, extra) => Object.assign({ t0, s: [], r: 0, c: 0 }, extra || {});
  const run = (pending, now, seen, complete, processed, starts) => v.reconcileStarts(starts || [], {}, new Set(), processed || new Set(), pending, {}, now, MAT, {}, complete, null, seen);
  { const p = { ['~' + K]: note(0) }; run(p, MAT, new Set()); T('[1] gone + two hours old on a complete read -> dropped', !p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, MAT - 1, new Set()); T('[1] gone, under two hours -> kept', !!p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, MAT, new Set([K])); T('[1] a record of the key still on a shard -> kept', !!p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, MAT, new Set(), false); T('[1] an incomplete read -> kept', !!p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, MAT, undefined); T('[1] no seen set (a direct caller, an older main) -> kept, as before', !!p['~' + K]); }
  { const p = { ['~' + K]: note(0), [K]: { t0: 0, mt: 2, roster: { 0: 'a', 1: 'b' }, settled: [], started: [] } }; run(p, MAT, new Set());
    T('[1] a registered matchmade entry for the key -> its note kept (the entry ends at its own verdict)', !!p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, 1, new Set([K]), true, new Set([K])); T('[1] a processed key\'s note goes, as before', !p['~' + K]); }
  { const p = { ['~' + K]: note(0) }; run(p, 24 * HOUR + 1, new Set([K])); T('[1] a day-old note goes, as before', !p['~' + K]); }
  { const p = { ['~' + K2]: note(0, { c: 1 }) }, pr = new Set(); run(p, MAT, new Set(), true, pr);
    T('[1] a contested note with no roster still voids at two hours (processed), then goes', pr.has(K2) && !p['~' + K2]); }
}

// ---- [2] endless / friends' room / bot entries ----
{
  const run = (pending, now, seen, complete) => v.reconcileStarts([], {}, new Set(), new Set(), pending, {}, now, MAT, {}, complete, null, seen);
  for (const [tag, mt] of [['endless', 7], ['friends\' room', v.PRIVATE_XP.MT], ['bot match', v.BOT_XP.MT]]) {
    const K = '333_9_' + mt, ent = () => ({ [K]: { t0: 0, mt, roster: { 0: 'a' }, settled: [], started: [] } });
    { const p = ent(), r = run(p, MAT, new Set()); T('[2] ' + tag + ': gone + two hours old -> dropped (cleaned)', !p[K] && r.cleaned === 1); }
    { const p = ent(); run(p, MAT - 1, new Set()); T('[2] ' + tag + ': gone, under two hours -> kept', !!p[K]); }
    { const p = ent(); run(p, 20 * 86400000, new Set([K])); T('[2] ' + tag + ': a record still on a shard -> kept (its first-seen time too)', !!p[K] && p[K].t0 === 0); }
    { const p = ent(); run(p, MAT, new Set(), false); T('[2] ' + tag + ': an incomplete read -> kept', !!p[K]); }
    { const p = ent(); run(p, 30 * 86400000 + 1, new Set([K])); T('[2] ' + tag + ': past the 30-day TTL goes, as before', !p[K]); }
  }
  { const K = '444_9_2', p = { [K]: { t0: 0, mt: 2, roster: { 0: v.pid(X), 1: v.pid(Y) }, settled: [], started: [v.pid(X)] } }, lv = {}, pr = new Set();
    const r = v.reconcileStarts([], {}, new Set(), pr, p, lv, MAT, MAT, {}, true, null, new Set());
    T('[2] a matchmade entry, gone: its own verdict at maturity, as before (X wrote his start -> an exit, processed)', r.convicted === 1 && pr.has(K) && (lv[v.pid(X)] || {}).leaves === 1); }
}

// ---- [3] pruneProcessed ----
{
  const keys = (n, p) => Array.from({ length: n }, (_, i) => (p || 'k') + i);
  const env0 = [v.PROCESSED_CAP, v.PROCESSED_KEEP];
  T('[3] cap / keep read from the environment of the run (defaults here)', env0[0] === 300000 && env0[1] === 250000);
  // the function reads the module constants; drive it through a child with a small cap
  const child = (body) => {
    const r = spawnSync(process.execPath, ['-e', "process.env.STATE_SALT='s';process.env.PROCESSED_CAP='10';process.env.PROCESSED_KEEP='6';process.env.PROCESSED_PRUNE_WAIT_MS='3600000';"
      + "const v=require(" + JSON.stringify(VALIDATE) + ");const H=3600000;const keys=(n,p)=>Array.from({length:n},(_,i)=>(p||'k')+i);" + body], { encoding: 'utf8', timeout: 60000 });
    try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) { return { err: (r.stdout || '') + (r.stderr || '') }; }
  };
  const a = child("const P=new Set(keys(10)),pend={'~#processed-prune':{t0:0,n:1,a:'x',b:'x',v:[]}};const r=v.pruneProcessed(P,pend,new Set(),true,0);console.log(JSON.stringify({r,size:P.size,c:pend['~#processed-prune']||null}))");
  T('[3] at the cap: nothing dropped, a stale candidate removed', a.r && a.r.dropped === 0 && a.size === 10 && a.c === null, JSON.stringify(a));
  const b = child("const P=new Set(keys(14)),pend={};const r=v.pruneProcessed(P,pend,new Set(['k2']),true,0);console.log(JSON.stringify({r,size:P.size,c:pend['~#processed-prune']}))");
  T('[3] over the cap, first complete read: armed (the 8 oldest off the shards to bring it to 6, k2 on a shard skipped), nothing dropped',
    b.r && b.r.dropped === 0 && b.r.armed === 8 && b.size === 14 && b.c && b.c.n === 9 && b.c.a === 'k0' && b.c.b === 'k8' && JSON.stringify(b.c.v) === '["k2"]', JSON.stringify(b));
  const pre = "const P=new Set(keys(14)),pend={};v.pruneProcessed(P,pend,new Set(['k2']),true,0);";
  const c = child(pre + "const r=v.pruneProcessed(P,pend,new Set(),true,H-1);console.log(JSON.stringify({r,size:P.size,c:!!pend['~#processed-prune']}))");
  T('[3] the next read under an hour later: nothing dropped, still armed', c.r && c.r.dropped === 0 && c.size === 14 && c.c === true, JSON.stringify(c));
  const d = child(pre + "const r=v.pruneProcessed(P,pend,new Set(['k5']),true,H);console.log(JSON.stringify({r,size:P.size,left:[...P],c:!!pend['~#processed-prune']}))");
  T('[3] an hour later, complete: the oldest go, k2 (on a shard at the arm) and k5 (on a shard now) stay, the candidate is spent',
    d.r && d.r.dropped === 7 && d.r.kept === 2 && d.size === 7 && JSON.stringify(d.left) === '["k2","k5","k9","k10","k11","k12","k13"]' && d.c === false, JSON.stringify(d));
  const e = child(pre + "const r=v.pruneProcessed(P,pend,new Set(),false,2*H);console.log(JSON.stringify({r,size:P.size,c:!!pend['~#processed-prune']}))");
  T('[3] an incomplete read, past the wait: nothing dropped, the candidate kept for the next complete read', e.r && e.r.dropped === 0 && e.size === 14 && e.c === true, JSON.stringify(e));
  const f = child(pre + "P.delete('k0');const r=v.pruneProcessed(P,pend,new Set(),true,H);const c=pend['~#processed-prune'];console.log(JSON.stringify({r,size:P.size,a:c&&c.a,t0:c&&c.t0}))");
  T('[3] the front of the list changed since the arm: nothing dropped, armed again from now', f.r && f.r.dropped === 0 && f.size === 13 && f.a === 'k1' && f.t0 === 3600000, JSON.stringify(f));
  const g = child("const P=new Set(keys(14)),pend={};const r=v.pruneProcessed(P,pend,null,true,0);console.log(JSON.stringify({r,size:P.size,c:!!pend['~#processed-prune']}))");
  T('[3] no seen set: nothing armed or dropped', g.r && g.r.dropped === 0 && g.r.armed === 0 && g.c === false, JSON.stringify(g));
}

// ---- [4] main(): made-up matchmade starts every run, notes ----
{
  let h = 0x14400;
  const fresh = () => Array.from({ length: 50 }, () => ({ sid: X, d: start(2, ++h, 0, [X, Y]) }));
  const KY = start(2, 0x1F4FF, 0, [Y, X]);   // Y's lone start for a key nobody settles, left on its shard every run
  // Y's lone start for another key, then (from run 2 on) only his confession for it: the key stays on the shards through it
  const KC = start(2, 0x1F4CC, 0, [Y, X]), KCq = rec(0xB5, 2, 0x1F4CC, 0, 0, false, [Y, X], 5);
  const HM = 0x1F4EE, HS = [start(2, HM, 0, [P1, P2]), start(2, HM, 1, [P1, P2])], HR = [settle1v1(HM, 0, [P1, P2]), settle1v1(HM, 1, [P1, P2])];
  const hon = (withResult) => [{ sid: P1, d: HS[0] }, { sid: P2, d: HS[1] }].concat(withResult ? [{ sid: P1, d: HR[0] }, { sid: P2, d: HR[1] }] : []);
  const step = (env, withResult) => [30 * MIN, fresh().concat([{ sid: Y, d: KY }, { sid: Y, d: KCq }], hon(withResult)), env];
  const steps = [[0, fresh().concat([{ sid: Y, d: KY }, { sid: Y, d: KC }], hon(false))], step(null, true), step(null, true), step(null, true), step(null, true), step(null, true)];
  const rs = timeline(steps);
  T('[4] six runs half an hour apart exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  const n = rs.map((r) => notesOf(r).length);
  // run k keeps the notes of the runs whose keys are under two hours old (runs k-3..k) + Y's two keys
  // (run 2 also still holds the honest key's note: it settles in that run, its note goes at the next run's upkeep)
  T('[4] the made-up notes stop at four runs\' worth (50 a run, under two hours old) + Y\'s key still on its shard', JSON.stringify(n) === JSON.stringify([53, 103, 152, 202, 202, 202]), JSON.stringify(n));
  T('[4] the run two hours after the first drops its 50 and says so in the summary', ROW_GONE(rs[4], 50, 0) && ROW_GONE(rs[5], 50, 0) && ROW_GONE(rs[3], 0, 0), rs[4].summary.split('\n').filter((l) => /Q144/.test(l)).join(' | '));
  T('[4] Y\'s key (still on a shard) keeps its note two and a half hours on', notesOf(last(rs)).indexOf('~' + keyOf(KY)) >= 0);
  T('[4] the key on the shards only through Y\'s confession keeps its note too', notesOf(last(rs)).indexOf('~' + keyOf(KC)) >= 0);
  T('[4] the honest 1V1 settles once (each player one points write), its note gone with it', [].concat(...rs.map((r) => pointsOf(r, P1))).length === 1
    && [].concat(...rs.map((r) => pointsOf(r, P2))).length === 1 && notesOf(last(rs)).indexOf('~' + keyOf(HS[0])) < 0);
  // an incomplete read at the run that would drop: nothing goes; the next complete read drops them (the unread shard held
  //   one of that run's 50 new keys, which never gets a note)
  const st2 = steps.slice(0, 4).concat([step(FAIL_ONE, true), step(null, true)]);
  const rf = timeline(st2);
  const nf = rf.map((r) => notesOf(r).length);
  T('[4] an incomplete read at that run drops nothing; the next complete one drops the two runs\' worth that are old enough', allOk(rf, 6)
    && nf[4] > nf[3] && ROW_GONE(rf[4], 0, 0) && ROW_GONE(rf[5], 100, 0) && nf[5] === 201, JSON.stringify(nf) + ' ' + rf[5].summary.split('\n').filter((l) => /Q144/.test(l)).join(' | '));
}

// ---- [5] main(): made-up endless, friends' room and bot starts ----
{
  let h = 0x24400;
  const fresh = () => Array.from({ length: 50 }, () => ({ sid: X, d: start(7, ++h, 0, [X]) }));
  const KZ = start(7, 0x2F4FF, 0, [Z]);   // Z's solo endless start, left on its shard every run
  const steps = [[0, fresh().concat([{ sid: Z, d: KZ }])]];
  for (let i = 0; i < 5; i++) steps.push([30 * MIN, fresh().concat([{ sid: Z, d: KZ }])]);
  const rs = timeline(steps);
  T('[5] endless: six runs exit 0', allOk(rs, 6), last(rs).out.slice(-800));
  const n = rs.map((r) => entriesOf(r).length);
  T('[5] endless: the made-up entries stop at four runs\' worth + Z\'s', JSON.stringify(n) === JSON.stringify([51, 101, 151, 201, 201, 201]), JSON.stringify(n));
  T('[5] endless: counted in the summary', ROW_GONE(rs[4], 0, 50) && ROW_GONE(rs[5], 0, 50));
  const kz = (last(rs).state.STARTS_FILE || {})[keyOf(KZ)];
  T('[5] endless: Z\'s entry (start still on its shard) kept, first seen two and a half hours ago', !!kz && Math.abs(Date.now() - kz.t0 - 150 * MIN) < 10 * MIN, JSON.stringify(kz));
  for (const [tag, mt] of [['friends\' room', v.PRIVATE_XP.MT], ['bot match', v.BOT_XP.MT]]) {
    let hh = 0x34400 + mt * 0x100;
    const two = () => { const o = []; for (let i = 0; i < 25; i++) { const k = ++hh; o.push({ sid: X, d: start(mt, k, 0, [X, Y]) }, { sid: Y, d: start(mt, k, 1, [X, Y]) }); } return o; };
    const st = [[0, two()]];
    for (let i = 0; i < 4; i++) st.push([30 * MIN, two()]);
    const rr = timeline(st);
    const nn = rr.map((r) => entriesOf(r).length);
    T('[5] ' + tag + ': two accounts, 25 made-up keys a run -> the entries stop at four runs\' worth', allOk(rr, 5) && JSON.stringify(nn) === JSON.stringify([25, 50, 75, 100, 100]) && ROW_GONE(rr[4], 0, 25),
      JSON.stringify(nn) + ' ' + last(rr).out.slice(-400));
  }
}

// ---- [6] main(): the processed list past a small cap ----
{
  const CAP = { PROCESSED_CAP: '60', PROCESSED_KEEP: '40', PROCESSED_PRUNE_WAIT_MS: String(HOUR) };
  // an honest ranked 1V1 that settled long ago, its records still on the shards
  const HK = 0x544EE, HS = [start(2, HK, 0, [P1, P2]), start(2, HK, 1, [P1, P2])], HR = [settle1v1(HK, 0, [P1, P2]), settle1v1(HK, 1, [P1, P2])];
  const hon = [{ sid: P1, d: HS[0] }, { sid: P2, d: HS[1] }, { sid: P1, d: HR[0] }, { sid: P2, d: HR[1] }];
  const old = Array.from({ length: 100 }, (_, i) => (90000 + i) + '_1234_2');
  const list = old.slice(0, 3).concat([keyOf(HS[0])], old.slice(3));   // 101 keys, the honest one fourth oldest
  const LK = old[5];   // an old key whose start shows up again at the drop
  const files0 = { PROCESSED_FILE: list };
  const env = (x) => Object.assign({}, CAP, x || {});
  const lkRow = { sid: Z, d: start(2, 90005, 0, [Z, X]) };
  const steps = [[0, hon, env()], [30 * MIN, hon, env()], [30 * MIN, hon, env(FAIL_ONE)], [30 * MIN, hon.concat([lkRow]), env()], [30 * MIN, hon, env()]];
  const rs = timeline(steps, null, files0);
  const proc = (r) => r.state.PROCESSED_FILE || [];
  T('[6] five runs exit 0', allOk(rs, 5), last(rs).out.slice(-800));
  T('[6] run 1: armed (61 keys to go once they are still off in 60 min), nothing dropped', proc(rs[0]).length === 101
    && /processed: 101 keys > cap 60 -- the oldest 61 off the shards go if they are still off in 60 min \(Q144\)/.test(rs[0].out), rs[0].out.split('\n').filter((l) => /processed:/.test(l)).join(' | '));
  T('[6] run 2 (half an hour on) and run 3 (an incomplete read, an hour on): nothing dropped', proc(rs[1]).length === 101 && proc(rs[2]).length === 101 && ROW_PROC(rs[2], 101, 0));
  const left = proc(rs[3]);
  T('[6] run 4 (complete, an hour and a half on): the 60 oldest off the shards go; the honest key and the old key read again stay',
    left.length === 41 && left[0] === keyOf(HS[0]) && left[1] === LK && left.slice(2).join(',') === old.slice(61).join(',')
    && ROW_PROC(rs[3], 41, 60) && /processed: 60 oldest key\(s\) off the shards on two complete reads dropped, 2 still on a shard kept -- 41 remembered \(cap 60, Q144\)/.test(rs[3].out),
    left.length + ' ' + JSON.stringify(left.slice(0, 3)) + ' ' + rs[3].summary.split('\n').filter((l) => /processed keys/.test(l)).join(''));
  T('[6] run 5: under the cap, nothing more', proc(rs[4]).length === 41 && ROW_PROC(rs[4], 41, 0));
  T('[6] the honest match never settles again (no points write in any run)', [].concat(...rs.map((r) => pointsOf(r, P1).concat(pointsOf(r, P2)))).length === 0);
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (state-prune) ===' : '=== PASS -- 0 fail (state-prune) ===');
process.exit(failN ? 1 : 0);
