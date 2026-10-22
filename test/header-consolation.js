'use strict';
// cloud audit Q297: the 50 consolation XP for an honest joiner whose record fails the sanity check on the host's match header
//   alone. Q294 consoled such a writer only on a key the header HELD (two writers or more, every shared reason a header reason,
//   sanityHeaderHeld). Two shapes of the same modded host's match never get there, and the honest joiner got nothing where the
//   same match on an honest header pays him 50 (found by the review of Q294 -- its own probe ran both shapes on the real main()):
//   - the host sends a bad header and writes no result of his own: one writer is no consistent group, the key is never held,
//     and at the start verdict the joiner's record carried a header reason -> skipped (on an honest header: 50);
//   - the host sends a bad header and writes scores of his own that disagree: two voices (Q291), the key voids, and the
//     consolation took the strict rule -> nobody paid (on an honest header both writers get 50).
//   Now (validate.js reconcileStarts): on every key the verdict voids, a roster member's record whose only reasons are header
//   reasons (SANITY_HEADER_SLUGS) is consoled unless its writer breaks his own fields (a duration past DUR_CAP, a second record
//   of his: sanityWriterFaults + sanityDropFlags, as at the Q294 gate). Convictions are not touched (the host who left without
//   his result is still a leaver, as on an honest header).
// Over the REAL validate.js main() against an offline board stub (the harness of test/host-header-sanity.js):
//   [1] the lone joiner on seven headers (trio bit / team code / party bit on a quick 1V1, a trio bit on a ranked 1V1, a ranked
//       code on the demo job, a team code on a brawl of three, a pair overlapping the trio on a brawl of four): consoled once,
//       nothing else paid, nobody flagged, the seats that wrote no result leavers (as on an honest header); mutant (the rule
//       before) -> the joiner gets nothing
//   [2] two voices that disagree on a bad header (trio bit / team code): both writers consoled, nobody flagged or convicted,
//       as on an honest header; mutant -> nobody paid
//   [3] what still earns nothing: his own duration past DUR_CAP (two guards: dropping both pays him), a second record of his,
//       scores past the cap (not a header reason), a record of an account outside the roster (the seat gate drops it first);
//       mutants (each guard dropped) -> paid
//   [4] what does not move: an honest header (the host left / two voices / two clean records of one writer), a key the
//       header held (Q294) -- the same output under the rule before
//   [5] wiring pins
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/seat-gate.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'header-consolation-'));
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
      // pin the season clock: from a season start on, ranked points go to that season's board (points_s<N>) and the
      //   points writes read below would go elsewhere -- every test runs before each production reconcile, so a
      //   date-dependent red here would stop settlement on that day
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
//   instant moves back instead: start sightings, absent-seat stamps, the writers' busy marks, the flag memory, the dispute keys)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const p = sg.players[k];
    if (p.bz) p.bz -= ms;   // .at stays: the players keep playing
    if (p.pdk) for (const m of Object.keys(p.pdk)) p.pdk[m] -= ms;
  }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const fOf = (r, sid) => sigOf(r, sid).f | 0;
const pdOf = (r, sid) => sigOf(r, sid).pd | 0;
const pdoOf = (r, sid) => (sigOf(r, sid).pdo || []).slice().sort();
const flaggedOf = (r) => Object.keys((r.state.SIGNALS_FILE || {}).flagged || {});
const of = (r, board, sid) => posts(r, board).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const paidIn = (rs, sid) => [].concat(...rs.map(r => of(r, 5, sid).concat(of(r, 6, sid), of(r, 7, sid), of(r, 8, sid))));   // XP, rating, points, CP
const trustIn = (rs, sid) => [].concat(...rs.map(r => of(r, 9, sid)));

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat (null = an empty seat); sc: the seat scores the record claims (default by seat)
const SC = { 2: [7000, 4000], 3: [7000, 5000, 4000] };
function rec(magic, mt, hash, seat, rank, win, ros, sc, pcOver) {
  const start = magic === 0xB2, pc = pcOver || ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : (sc || SC[pc] || SC[2])[i] | 0);
  d.push(0);
  for (const s of ros) { const p = s == null ? [0, 0] : sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// 1V1 (two seats): `winner` = the seat the record says won; mt 2 ranked, 1 quick
const v1settle = (mt, hash, seat, ros, winner) => rec(0xB1, mt, hash, seat, seat === winner ? 1 : 2, seat === winner, ros, winner ? [4000, 7000] : [7000, 4000]);
const v1start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const durBad = (d) => d.map((x, i) => i === 9 ? 90000 : x);   // a duration past DUR_CAP
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const H = SID(2910), J = SID(2911), P = SID(2912), X = SID(2913), Y = SID(2914), Z = SID(2915);
const ALL = [H, J, P, X, Y, Z];
function boardsWith(recs, pt) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] });
  // the demo / playtest jobs refuse to run while a rating or points board exists on their app (lock layer 3)
  if (!pt) boards.push({ id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state before the first run; scripts: one per run (or one)
function timeline(steps, script, files0) {
  const out = []; let state = null;
  steps.forEach(([ms, recs, env], i) => {
    if (out.length && out[out.length - 1].code !== 0) return;
    const sc = Array.isArray(script) ? script[i] : script;
    const r = runCron(boardsWith(recs, !!(env && env.PT_MODE)), state ? advance(state, ms) : (files0 || null), env || null, sc);
    out.push(r); state = r.state;
  });
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');

const leavesOf = (r, sid) => ((((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves) | 0;
const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d), dispCode: 0, shard: 's' });
const two = [H, J], three = [H, J, X];

// mutants: validate.js with one part of the fix put back
const RULE = '      if (rf.length && !(!ownFault.has(s) && rf.every((f) => SANITY_HEADER_SLUGS.indexOf(f) >= 0))) continue;\n';
const BEFORE = {
  held: [RULE, '      if (rf.length && !(hdr && !ownFault.has(s) && rf.every((f) => SANITY_HEADER_SLUGS.indexOf(f) >= 0))) continue;\n'],   // Q294: a held key only
  own: [RULE, '      if (rf.length && !(rf.every((f) => SANITY_HEADER_SLUGS.indexOf(f) >= 0))) continue;\n'],   // his own fields not asked
  any: [RULE, '      if (rf.length && !(!ownFault.has(s))) continue;\n'],   // any reason passes
  loose: [RULE, ''],   // every roster member's record passes
};
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return null; }
    src = src.replace(from, to);
  }
  const script = path.join(__dirname, '..', '.mutant-header-consolation-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

let hn = 0;
// one match: ws = [[sid, seat, table, pc, writesStart, writesResult, scores?]] -- a result's scores default to one vector all
//   agree on (rank by score); opt.mut(sid, d) rewrites a writer's result (his own fields); opt.extra: more records (the
//   results' run on); opt.env = the job's env (PT_MODE: the demo job).
//   Runs: the starts; ten minutes later the results; ten more; two hours on (past STARTS_MATURITY_MS).
function play(mt, ws, opt, script) {
  opt = opt || {};
  const hsh = 0x2970 + (++hn);
  const st = ws.filter(w => w[4]).map(([sid, seat, ros, pc]) => ({ sid, d: rec(0xB2, mt, hsh, seat, 0, false, ros, null, pc) }));
  const re = ws.filter(w => w[5] !== false).map(([sid, seat, ros, pc, , , own]) => {
    const sc = (own || [7000, 5000, 4000, 3000]).slice(0, pc), top = Math.max(...sc);
    const rank = 1 + sc.filter((x) => x > sc[seat]).length;
    const d = rec(0xB1, mt, hsh, seat, rank, sc[seat] === top, ros, sc, pc);
    return { sid, d: opt.mut ? opt.mut(sid, d) : d };
  });
  const all = st.concat(re).concat((opt.extra || []).map((f) => f(hsh)));
  const env = opt.env || null;
  const steps = [[0, st, env], [10 * MIN, all, env], [10 * MIN, all, env], [2 * HOUR, all, env]];
  const rs = timeline(steps, script);
  return { rs, key: hsh + '_1234_' + mt };
}
function sum(p, sids) {
  const rs = p.rs, r = last(rs), o = { ok: allOk(rs, 4) };
  for (const s of sids) o[s] = { f: fOf(r, s), xp: paidIn(rs, s), lv: leavesOf(r, s) };
  o.processed = processedOf(r).has(p.key);
  o.verdict = (new RegExp('  start-orphan ' + p.key + ': started, never settled[^\\n]*').exec(outOf(rs)) || [''])[0].trim();
  return o;
}
const J50 = (o, s) => JSON.stringify(o[s].xp) === '[50]';
const none = (o, s) => o[s].xp.length === 0;

// ---- [1] the lone joiner: the host sends a bad header and writes no result ----
const LONE = [
  ['a quick 1V1 with a trio bit (0x101)', 0x101, null],
  ['a quick 1V1 with a team code (3)', 3, null],
  ['a quick 1V1 with a party bit past the seats (0x21)', 0x21, null],
  ['a ranked 1V1 with a trio bit (0x102)', 0x102, null],
  ['a ranked 1V1 code (2) on the demo job', 2, { PT_MODE: '1' }],
];
for (const [name, mt, env] of LONE) {
  const tag = '[1] ' + name + ', the host wrote his start and no result';
  const ws = [[H, 0, two, 2, true, false], [J, 1, two, 2, true, true]];
  const now = sum(play(mt, ws, { env }), [H, J]);
  T(tag + ': voided, J consoled once (50 XP, nothing else), nobody flagged, the host a leaver',
    now.ok && now.processed && J50(now, J) && none(now, H) && now[J].f === 0 && now[H].f === 0 && now[J].lv === 0 && now[H].lv === 1, JSON.stringify(now));
  withMutant(['held'], tag, (sc) => {
    const old = sum(play(mt, ws, { env }, sc), [H, J]);
    T(tag + ' mutant (the rule before): J gets nothing, the rest the same', old.ok && old.processed && none(old, J) && old[H].lv === 1 && old[J].f === 0, JSON.stringify(old));
  });
}
{
  const tag = '[1] a quick brawl of three with a team code (3), only J wrote a result (H and X their starts)';
  const ws = [[H, 0, three, 3, true, false], [J, 1, three, 3, true, true], [X, 2, three, 3, true, false]];
  const now = sum(play(3, ws), [H, J, X]);
  T(tag + ': J consoled, nobody flagged, H and X leavers (as on an honest header)',
    now.ok && now.processed && J50(now, J) && none(now, H) && none(now, X) && [H, J, X].every((s) => now[s].f === 0) && now[H].lv === 1 && now[X].lv === 1 && now[J].lv === 0, JSON.stringify(now));
  withMutant(['held'], tag, (sc) => {
    const old = sum(play(3, ws, null, sc), [H, J, X]);
    T(tag + ' mutant (the rule before): J gets nothing', old.ok && old.processed && none(old, J), JSON.stringify(old));
  });
  const ctl = sum(play(1, ws), [H, J, X]);
  T(tag + ' control (mt 1, an honest header): the same outcome', ctl.ok && ctl.processed && J50(ctl, J) && none(ctl, H) && ctl[H].lv === 1 && ctl[X].lv === 1, JSON.stringify(ctl));
}
{
  const four = [H, J, X, Y];
  const tag = '[1] a quick brawl of four with a pair overlapping the trio (0x111), only J wrote a result';
  const ws = [[H, 0, four, 4, true, false], [J, 1, four, 4, true, true], [X, 2, four, 4, true, false], [Y, 3, four, 4, true, false]];
  const now = sum(play(0x111, ws), [H, J, X, Y]);
  T(tag + ': J consoled, nobody flagged, the three others leavers (as on an honest header)',
    now.ok && now.processed && J50(now, J) && [H, X, Y].every((s) => none(now, s) && now[s].lv === 1) && [H, J, X, Y].every((s) => now[s].f === 0), JSON.stringify(now));
  withMutant(['held'], tag, (sc) => {
    const old = sum(play(0x111, ws, null, sc), [H, J, X, Y]);
    T(tag + ' mutant (the rule before): J gets nothing', old.ok && old.processed && none(old, J), JSON.stringify(old));
  });
}

// ---- [2] two voices that disagree on a bad header ----
for (const [name, mt] of [['a trio bit (0x101)', 0x101], ['a team code (3)', 3]]) {
  const tag = '[2] a quick 1V1 with ' + name + ', the host\'s scores disagree with the joiner\'s';
  const ws = [[H, 0, two, 2, true, true, [9000, 4000]], [J, 1, two, 2, true, true, [4000, 7000]]];
  const now = sum(play(mt, ws), [H, J]);
  T(tag + ': voided, both consoled once, nobody flagged or convicted', now.ok && now.processed && J50(now, J) && J50(now, H) && [H, J].every((s) => now[s].f === 0 && now[s].lv === 0), JSON.stringify(now));
  withMutant(['held'], tag, (sc) => {
    const old = sum(play(mt, ws, null, sc), [H, J]);
    T(tag + ' mutant (the rule before): nobody paid', old.ok && old.processed && none(old, J) && none(old, H), JSON.stringify(old));
  });
  const ctl = sum(play(1, ws), [H, J]);
  T(tag + ' control (mt 1, an honest header): both consoled the same', ctl.ok && ctl.processed && J50(ctl, J) && J50(ctl, H) && [H, J].every((s) => ctl[s].f === 0 && ctl[s].lv === 0), JSON.stringify(ctl));
}

// ---- [3] what still earns nothing ----
{
  const ws = [[H, 0, two, 2, true, false], [J, 1, two, 2, true, true]];
  const tag = '[3] a quick 1V1 with a trio bit (0x101), the lone joiner\'s own duration past DUR_CAP';
  const opt = { mut: (sid, d) => sid === J ? durBad(d) : d };
  const now = sum(play(0x101, ws, opt), [H, J]);
  T(tag + ': not consoled', now.ok && now.processed && none(now, J) && now[H].lv === 1, JSON.stringify(now));
  // two guards hold it (his record's own reason 'duration' and his own-fault entry): dropping either alone keeps it out
  for (const k of ['own', 'any']) withMutant([k], tag, (sc) => {
    const old = sum(play(0x101, ws, opt, sc), [H, J]);
    T(tag + ' mutant (' + k + '): still not consoled', old.ok && old.processed && none(old, J), JSON.stringify(old));
  });
  withMutant(['loose'], tag, (sc) => {
    const old = sum(play(0x101, ws, opt, sc), [H, J]);
    T(tag + ' mutant (every record passes): consoled', old.ok && old.processed && J50(old, J), JSON.stringify(old));
  });
  const tag2 = '[3] a quick 1V1 with a trio bit (0x101), the lone joiner wrote two results';
  const opt2 = { extra: [(hsh) => ({ sid: J, d: rec(0xB1, 0x101, hsh, 1, 2, false, two, [7000, 4000], 2) })] };
  const now2 = sum(play(0x101, ws, opt2), [H, J]);
  T(tag2 + ': not consoled (a second record is his own field, as at the Q294 gate)', now2.ok && now2.processed && none(now2, J), JSON.stringify(now2));
  withMutant(['own'], tag2, (sc) => {
    const old = sum(play(0x101, ws, opt2, sc), [H, J]);
    T(tag2 + ' mutant (his own fields not asked): consoled', old.ok && old.processed && J50(old, J), JSON.stringify(old));
  });
  const tag3 = '[3] a quick 1V1 with a trio bit (0x101), the lone joiner\'s scores past the cap';
  const ws3 = [[H, 0, two, 2, true, false], [J, 1, two, 2, true, true, [999999, 999999]]];
  const now3 = sum(play(0x101, ws3), [H, J]);
  T(tag3 + ': not consoled (scores are not a header reason)', now3.ok && now3.processed && none(now3, J), JSON.stringify(now3));
  withMutant(['any'], tag3, (sc) => {
    const old = sum(play(0x101, ws3, null, sc), [H, J]);
    T(tag3 + ' mutant (any reason passes): consoled', old.ok && old.processed && J50(old, J), JSON.stringify(old));
  });
  const tag4 = '[3] a quick 1V1 with a trio bit (0x101), an account outside the roster wrote a result on the key';
  const opt4 = { extra: [(hsh) => ({ sid: Z, d: rec(0xB1, 0x101, hsh, 1, 1, true, [H, Z], [4000, 7000], 2) })] };
  const now4 = sum(play(0x101, ws, opt4), [H, J, Z]);
  // (the seat gate drops his record before the verdict -- Q80 / Q124 -- and the verdict's roster check stands behind it)
  T(tag4 + ': the outsider is not consoled, J is', now4.ok && now4.processed && none(now4, Z) && J50(now4, J) && now4[Z].f === 0, JSON.stringify(now4));
}

// ---- [4] what does not move: the same output under the rule before ----
{
  const same = (tag, mt, ws, opt, sids) => {
    const now = sum(play(mt, ws, opt), sids);
    withMutant(['held'], tag, (sc) => {
      const old = sum(play(mt, ws, opt, sc), sids);
      const strip = (o) => JSON.stringify(Object.assign({}, o, { verdict: o.verdict.replace(/^start-orphan [0-9]+_1234_[0-9]+/, 'start-orphan KEY') }));
      T(tag + ': the same as under the rule before ' + JSON.stringify(sids.map((s) => now[s])), now.ok && old.ok && strip(now) === strip(old), strip(now) + ' / ' + strip(old));
    });
    return now;
  };
  const a = same('[4] a quick 1V1 on an honest header, the host left', 1, [[H, 0, two, 2, true, false], [J, 1, two, 2, true, true]], null, [H, J]);
  T('[4] ... J consoled, the host a leaver', J50(a, J) && a[H].lv === 1);
  const b = same('[4] a quick 1V1 on an honest header, the host left, J wrote two clean results', 1, [[H, 0, two, 2, true, false], [J, 1, two, 2, true, true]],
    { extra: [(hsh) => ({ sid: J, d: rec(0xB1, 1, hsh, 1, 2, false, two, [7000, 4000], 2) })] }, [H, J]);
  T('[4] ... J still consoled (his clean records pass whatever else he wrote)', J50(b, J));
  same('[4] a quick 1V1 on an honest header, two voices', 1, [[H, 0, two, 2, true, true, [9000, 4000]], [J, 1, two, 2, true, true, [4000, 7000]]], null, [H, J]);
  const d = same('[4] a quick brawl of three with a team code (3), the host wrote no result (a key the header held, Q294)', 3,
    [[H, 0, three, 3, true, false], [J, 1, three, 3, true, true], [X, 2, three, 3, true, true]], null, [H, J, X]);
  T('[4] ... J and X consoled, the host spared', J50(d, J) && J50(d, X) && d[H].lv === 0 && /Q294/.test(d.verdict), JSON.stringify(d));
  same('[4] an honest quick 1V1, both wrote', 1, [[H, 0, two, 2, true, true], [J, 1, two, 2, true, true]], null, [H, J]);
}

// ---- [5] wiring pins ----
{
  const vb = (/function reconcileStarts\([\s\S]*?\n\}/.exec(SRC) || [''])[0];
  T('[5] reconcileStarts: own faults from the whole group (sanityWriterFaults + sanityDropFlags), asked on every voided key',
    /\n    const ownFault = groups\[m\] \? new Set\(sanityWriterFaults\(groups\[m\]\)\.filter\(sanityDropFlags\)\.map\(\(x\) => x\.sid\)\) : null;\n    if \(groups\[m\]\) for \(const r of groups\[m\]\) \{\n/.test(vb));
  T('[5] the consolation: roster check, then a sane record or header reasons only from a writer with no own fault (no held-key condition)',
    vb.split(RULE).length === 2 && vb.indexOf('// not on the attested roster\n      const rf = sanityFlags([r]);\n' + RULE + '      consoledSids.push(s);\n') > 0 && !/hdrOwn/.test(vb));
  T('[5] convictions untouched: the Q294 spare still asks the held mark', /\n      if \(hdr\) \{ hdrSpared\.push\(h\.slice\(0, 8\)\); continue; \}/.test(vb) && /\n    const hdr = p\.hh === 1;   \/\/ Q294\n/.test(vb));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (header-consolation) ===');
process.exit(failN === 0 ? 0 : 1);
