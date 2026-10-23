'use strict';
// Q291 / Q292 (cloud audit 2026-10): two voices that disagree, outside a plain quick / ranked 1V1 and through the host's
//   broadcast. Q289 (test/pair-dispute-1v1.js) stopped flagging both writers of a quick / ranked 1V1 whose two records
//   disagree, but chose such a key by its raw match type (1 / 2) and a two-seat record seating its own writer:
//     Q291  a friends' room of two (type 10), a gated endless run of two (7) and a bot match with two humans (11) kept the
//           whole-group rule: a modded player flagged his honest partner once per key (three: trust tier 1)
//     Q292  the honest joiner's match type, seat count, seat index and table are the host's START_GAME broadcast
//           (mvp/src/net/mp.js onStartGame, unchecked): a modded host who lost and claimed the win added a party bit, a
//           trio bit, a third account that never writes, an empty seat or a ranked party bit and the key fell back to the
//           old rule; an out-of-range seat index made the joiner's start leave a seat empty (Q130 flagged him once per key)
//           and his result "break its own bound" (Q109 / Q289 flagged him alone)
//   Now (validate.js): a key is two voices when exactly two accounts wrote for it (or more did and one record seats its
//   writer on a table of at most two accounts), whatever its match type; only the duration is the writer's own fault; a
//   consistent key's out-of-range seat drops the record and flags nobody (SANITY_HOST_SLUGS); a matchmade start that leaves
//   a seat empty votes nowhere and flags nobody. New flags are a subset of the old ones; nothing is paid differently.
// Over the REAL validate.js main() against an offline board stub (the harness of test/pair-dispute-1v1.js):
//   [1] units: pairDisputeTable, pairDispute1v1 on every lane and host reshape, three voices, one account's own records
//   [2] Q291 lanes end to end: a friends' room 1V1, a bot match with two humans and a bot -- nobody flagged, the dispute
//       counted on both, nothing paid differently; mutant (the whole-group rule) -> both flagged. (The gated endless run of
//       two: test/endless-borrowed-key.js [7d] / [7e].)
//   [3] Q292 host reshapes end to end (the host loses and claims the win): party bit, trio bit, a third account that never
//       writes, ranked party bit, a team code, an empty third seat, an out-of-range seat index for the joiner, a seat count
//       of three on the joiner's broadcast only -- the honest joiner never flagged, the host neither, paid as before;
//       mutants (the rules before) -> the joiner flagged
//   [4] what stays: three voices that disagree flag every writer, as before (a friends' room of three, a quick brawl of
//       three, the host's alt on the table writing a record of its own -- a residual, README); a writer whose own
//       duration breaks its bound is flagged alone
//   [5] two accounts of one owner disputing friends' rooms / bot matches: nothing paid, nothing to gain
//   [6] an old key the job before flagged: no flag removed, counted once
//   [7] a consistent 1V1 whose joiner the host gave an out-of-range seat: dropped, nobody flagged (was: the joiner alone);
//       the endless run of two goes the Q306 way (its record set aside, the seat not his own field: nobody flagged, not settled)
//   [8] wiring pins
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'two-voice-dispute-'));
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
function boardsWith(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
    { id: 7, name: 'points', entries: ALL.map(s => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] },
    { id: 9, name: 'trust_tier', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs, env?], ...]; files0: the state before the first run; scripts: one per run (or one)
function timeline(steps, script, files0) {
  const out = []; let state = null;
  steps.forEach(([ms, recs, env], i) => {
    if (out.length && out[out.length - 1].code !== 0) return;
    const sc = Array.isArray(script) ? script[i] : script;
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : (files0 || null), env || null, sc);
    out.push(r); state = r.state;
  });
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map(r => r.out).join('');

// mutants: validate.js with some of the rules before this fix put back (each pair: [now, before]); a run under them is the
//   job before Q291 / Q292 for the lanes it touched
const BEFORE = {
  loop: ['    const pd1 = pairDispute1v1(g);\n', '    const pd1 = null;\n'],   // the whole-group rule (every lane but a quick / ranked 1V1 before)
  seatOwn: ["OWN: ['duration'] }", "OWN: ['duration', 'seat'] }"],         // Q289: the seat counted as the writer's own
  blank: ["      if (!signals.flagged[k]) console.log('  start-blank ' + m + ': ' + plog(r.steamID) + '@' + (r.d[5] | 0) + ' wrote a start that leaves a seat empty -- it does not vote, nobody flagged (the seat table is the host\\'s, Q292)');\n",
    '      if (recordFlag(signals, [r], k, Date.now())) sigDirty = true;\n'],   // Q130: a blank start flags its writer
  host: ['if (!sp.drop.length && sane.every((f) => SANITY_HOST_SLUGS.indexOf(f) >= 0)) {', 'if (false) {'],   // the whole-group sanity rule flags every writer
  drop: ['const sanityDropFlags = (x) => x.why.some((f) => SANITY_HOST_SLUGS.indexOf(f) < 0);', 'const sanityDropFlags = (x) => x.why.some((f) => SANITY_ROSTER_SLUGS.indexOf(f) < 0);'],   // Q109: the seat flags
  endown: ['    const es = endlessRecordSplit(g, seatGateRoster(startsPending[c.m]));\n', '    const es = null;\n'],   // Q306: an endless group's own-field records were not set aside ahead of the sanity gate
};
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return null; }
    src = src.replace(from, to);
  }
  const script = path.join(__dirname, '..', '.mutant-two-voice-dispute-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };
const ALL_BEFORE = ['loop', 'seatOwn', 'blank', 'drop', 'host'];

// H (the host, seat 0) and J (an honest joiner) play a match of two. J writes what the host's START_GAME made him write
//   (jo: { mt, ros, seat, pc }); H writes his own records (ho: the same fields; default = J's), his result claiming the win
//   (scores H 7000 / J 4000) while J's honest one says J won (4000 / 7000) -- unless opt.agree. Runs: the starts; ten
//   minutes later the results; ten more; two hours on (past STARTS_MATURITY_MS: a matchmade key that never settled voids
//   at the start verdict, the consolation XP to each writer on the attested roster).
function pair(h, jo, ho, opt) {
  opt = opt || {};
  ho = Object.assign({ seat: 0 }, jo, ho || {});
  jo = Object.assign({ seat: 1 }, jo);
  const scOf = (o, win) => { const pc = o.pc || o.ros.length, s = new Array(pc).fill(0); s[0] = win === 'H' ? 7000 : 4000; s[1] = win === 'H' ? 4000 : 7000; for (let i = 2; i < pc; i++) s[i] = 1000 * i; return s; };
  const st = [{ sid: H, d: rec(0xB2, ho.mt, h, ho.seat, 0, false, ho.ros, null, ho.pc) }, { sid: J, d: rec(0xB2, jo.mt, h, jo.seat, 0, false, jo.ros, null, jo.pc) }];
  const re = [{ sid: J, d: rec(0xB1, jo.mt, h, jo.seat, 1, true, jo.ros, scOf(jo, 'J'), jo.pc) },
    { sid: H, d: rec(0xB1, ho.mt, h, ho.seat, 1, true, ho.ros, scOf(ho, opt.agree ? 'J' : 'H'), ho.pc) }];
  const all = st.concat(re);
  return { steps: [[0, st], [10 * MIN, all], [10 * MIN, all], [2 * HOUR, all]], key: keyOf(re[0].d) };
}
const sum = (rs) => ({ fJ: fOf(last(rs), J), fH: fOf(last(rs), H), pdJ: pdOf(last(rs), J), pdH: pdOf(last(rs), H), paidJ: paidIn(rs, J), paidH: paidIn(rs, H), trust: trustIn(rs, J).concat(trustIn(rs, H)) });

// ---- [1] units ----
{
  T('[1] exported', typeof v.pairDisputeTable === 'function' && typeof v.pairDispute1v1 === 'function' && Array.isArray(v.SANITY_HOST_SLUGS));
  if (typeof v.pairDisputeTable === 'function') {
  const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
  const h = 0x2910;
  const tbl = (sid, mt, seat, ros, pc) => v.pairDisputeTable(R(sid, rec(0xB1, mt, h, seat, 1, true, ros, null, pc)));
  eq('[1] pairDisputeTable: the accounts a self-seating record names (bots / empty seats name nobody); null off his seat or outside the seat count',
    [tbl(J, 10, 1, [H, J]), tbl(J, 11, 1, [H, J, null]), tbl(J, 1, 1, [H, J, P]), tbl(J, 1, 2, [H, null], 2), tbl(J, 1, 1, [H, X]), tbl(J, 1, 0, [H, J])],
    [[H, J], [H, J], [H, J, P], null, null, null]);
  const res = (g) => { const x = v.pairDispute1v1(g); return x && { own: x.own.map(o => o.sid + ':' + o.why.join(',')), rest: x.rest.map(o => o.sid).sort(), pair: x.pair && x.pair.slice().sort() }; };
  const HJ = [H, J].sort(), two = { own: [], rest: HJ, pair: HJ };
  const g2 = (mtH, rosH, mtJ, rosJ, seatJ, pcJ) => [R(H, rec(0xB1, mtH, h, 0, 1, true, rosH, [7000, 4000, 0])), R(J, rec(0xB1, mtJ, h, seatJ == null ? 1 : seatJ, 1, true, rosJ, [4000, 7000, 0], pcJ))];
  eq('[1] Q291 lanes: friends\' room, endless, bot match with a bot seat: two voices, a pair, nobody own',
    [res(g2(10, [H, J], 10, [H, J])), res(g2(7, [H, J], 7, [H, J])), res(g2(11, [H, J, null], 11, [H, J, null]))], [two, two, two]);
  eq('[1] Q292 host reshapes: party bit, trio bit, a third account on the table, ranked party bit, team code, an empty third seat, the joiner\'s seat outside the table, a seat count of three on his records only: a pair',
    [res(g2(0x11, [H, J], 0x11, [H, J])), res(g2(0x101, [H, J], 0x101, [H, J])), res(g2(1, [H, J, P], 1, [H, J, P])), res(g2(0x12, [H, J], 0x12, [H, J])),
      res(g2(3, [H, J], 3, [H, J])), res(g2(1, [H, J, null], 1, [H, J, null])), res(g2(1, [H, J], 1, [H, null], 2, 2)), res(g2(1, [H, J], 1, [H, J, null]))],
    [two, two, two, two, two, two, two, two]);
  const three = (mt) => [R(H, rec(0xB1, mt, h, 0, 1, true, [H, J, X], [7000, 4000, 1000])), R(J, rec(0xB1, mt, h, 1, 1, true, [H, J, X], [4000, 7000, 1000])), R(X, rec(0xB1, mt, h, 2, 1, true, [H, J, X], [4000, 7000, 1100]))];
  eq('[1] three writers on tables of three (any lane): three voices, not this rule', [res(three(1)), res(three(10)), res(three(11))], [null, null, null]);
  eq('[1] one account\'s own records disagreeing: not two voices', res([R(J, rec(0xB1, 10, h, 1, 1, true, [H, J], [4000, 7000])), R(J, rec(0xB1, 10, h, 1, 1, true, [H, J], [4100, 7000]))]), null);
  eq('[1] the duration is the only own reason: a bad duration flags its writer alone, a seat outside the table nobody',
    [res([R(H, rec(0xB1, 10, h, 0, 1, true, [H, J], [7000, 4000])), R(J, durBad(rec(0xB1, 10, h, 1, 1, true, [H, J], [4000, 7000])))]).own, res(g2(10, [H, J], 10, [H, J], 5)).own],
    [[J + ':duration'], []]);
  eq('[1] an endless run past DUR_CAP is no duration fault (endless has no cap)', res([R(H, rec(0xB1, 7, h, 0, 1, true, [H, J], [7000, 4000])), R(J, durBad(rec(0xB1, 7, h, 1, 1, true, [H, J], [4000, 7000])))]), two);
  eq('[1] SANITY_HOST_SLUGS: the roster reasons and the seat', v.SANITY_HOST_SLUGS, ['self-seat', 'sid-range', 'dup-sid', 'seat']);
  }
}

// ---- [2] Q291 lanes ----
for (const [name, jo] of [['friends\' room 1V1 (10)', { mt: 10, ros: [H, J] }], ['bot match, two humans and a bot (11)', { mt: 11, ros: [H, J, null] }]]) {
  const m = pair(0x2920 + jo.mt, jo);
  const rs = timeline(m.steps);
  const tag = '[2] ' + name;
  if (!allOk(rs, 4)) { bad(tag + ': runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500)); continue; }
  const now = sum(rs);
  eq(tag + ': nobody flagged, counted once on both, no trust write', [now.fJ, now.fH, now.pdJ, now.pdH, now.trust], [0, 0, 1, 1, []]);
  T(tag + ': logged as two voices', /pair-dispute [^\n]*: 2 records of two voices disagree -- nobody flagged for the disagreement, counted on both players/.test(outOf(rs)), (/pair-dispute[^\n]*|inconsistent[^\n]*/.exec(outOf(rs)) || [''])[0]);
  withMutant(['loop'], tag, (sc) => {
    const ms = timeline(m.steps, sc), old = sum(ms);
    T(tag + ' mutant: the whole-group rule (the job before) -> the honest joiner flagged with the host', allOk(ms, 4) && old.fJ === 1 && old.fH === 1, JSON.stringify(old));
    T(tag + ': paid exactly as before (' + JSON.stringify([now.paidJ, now.paidH]) + ')', JSON.stringify([now.paidJ, now.paidH]) === JSON.stringify([old.paidJ, old.paidH]), JSON.stringify([old.paidJ, old.paidH]));
  });
}

// ---- [3] Q292 host reshapes ----
{
  const cases = [
    ['party bit (quick 0x11)', { mt: 0x11, ros: [H, J] }, null, ['loop']],
    ['trio bit (quick 0x101)', { mt: 0x101, ros: [H, J] }, null, ['loop']],
    ['a third account on the table that never writes', { mt: 1, ros: [H, J, P] }, null, ['loop']],
    ['ranked party bit (0x12)', { mt: 0x12, ros: [H, J] }, null, ['loop']],
    ['a team code (quick team1, 3)', { mt: 3, ros: [H, J] }, null, ['loop']],
    ['an empty third seat (both tables)', { mt: 1, ros: [H, J, null] }, null, ['loop', 'blank']],
    ['an empty third seat on the joiner\'s broadcast only (the host writes two seats)', { mt: 1, ros: [H, J, null] }, { ros: [H, J] }, ['loop', 'blank']],
    ['the joiner\'s seat index outside the table (2 of 2; seat 1 empty on his table)', { mt: 1, ros: [H, null], seat: 2, pc: 2 }, { ros: [H, J], seat: 0 }, ['seatOwn', 'blank', 'drop']],
    ['the same on a ranked 1V1', { mt: 2, ros: [H, null], seat: 2, pc: 2 }, { ros: [H, J], seat: 0 }, ['seatOwn', 'blank', 'drop']],
  ];
  cases.forEach(([name, jo, ho, before], i) => {
    const m = pair(0x2930 + i, jo, ho);
    const rs = timeline(m.steps);
    const tag = '[3] ' + name;
    if (!allOk(rs, 4)) { bad(tag + ': runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500)); return; }
    const now = sum(rs);
    T(tag + ': the honest joiner not flagged, the host neither, no trust write', now.fJ === 0 && now.fH === 0 && now.trust.length === 0,
      JSON.stringify(now) + ' ' + (/(pair-dispute [^\n]*|start-blank[^\n]*|sanity[^\n]*)/.exec(outOf(rs)) || [''])[0]);
    withMutant(before, tag, (sc) => {
      const ms = timeline(m.steps, sc), old = sum(ms);
      T(tag + ' mutant (' + before.join(' + ') + ': the job before) -> the honest joiner flagged', allOk(ms, 4) && old.fJ >= 1, JSON.stringify(old));
      T(tag + ': paid exactly as before (' + JSON.stringify([now.paidJ, now.paidH]) + '), counted at most once', JSON.stringify([now.paidJ, now.paidH]) === JSON.stringify([old.paidJ, old.paidH]) && now.pdJ <= 1 && now.pdH <= 1,
        JSON.stringify([old.paidJ, old.paidH, now.pdJ, now.pdH]));
    });
  });
}

// ---- [4] what stays ----
{
  // three writers: H claims the win, J and X write the honest result; every writer is flagged (as before -- the majority
  //   question is not this fix's: README residual). sc: H's / J's / X's scores
  const three = (mt, hsh, ros, label) => {
    const pc = ros.length, scH = [7000, 4000, 1000].slice(0, pc), scT = [4000, 7000, 1000].slice(0, pc);
    const st = [H, J, X].map((sid, i) => ({ sid, d: rec(0xB2, mt, hsh, i, 0, false, ros, null, pc) }));
    const re = [{ sid: H, d: rec(0xB1, mt, hsh, 0, 1, true, ros, scH, pc) }, { sid: J, d: rec(0xB1, mt, hsh, 1, 1, true, ros, scT, pc) }, { sid: X, d: rec(0xB1, mt, hsh, 2, 3, false, ros, scT, pc) }];
    const all = st.concat(re), steps = [[0, st], [10 * MIN, all], [10 * MIN, all]];
    const rs = timeline(steps);
    const tag = '[4] ' + label;
    if (!allOk(rs, 3)) { bad(tag + ': runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500)); return; }
    const now = [fOf(last(rs), H), fOf(last(rs), J), fOf(last(rs), X)];
    withMutant(['loop'], tag, (sc) => {
      const ms = timeline(steps, sc), old = [fOf(last(ms), H), fOf(last(ms), J), fOf(last(ms), X)];
      eq(tag + ': every writer flagged once, exactly as before', [now, old], [[1, 1, 1], [1, 1, 1]]);
    });
  };
  three(10, 0x2940, [H, J, X], 'a friends\' room of three (10)');
  three(1, 0x2941, [H, J, X], 'a quick brawl of three (1)');
  three(1, 0x2942, [H, J, X], 'the host\'s alt X on the broadcast table writing the host\'s claim (a 1V1 the host made three: residual)');
  // the duration stays the writer's own: the host's result past DUR_CAP flags him alone
  const m = pair(0x2943, { mt: 10, ros: [H, J] });
  m.steps = m.steps.map(([ms, recs]) => [ms, recs.map(r => r.sid === H && r.d[0] === 0xB1 ? { sid: H, d: durBad(r.d) } : r)]);
  const rs = timeline(m.steps);
  if (!allOk(rs, 4)) bad('[4] own duration: runs ' + rs.map(r => r.code));
  else {
    eq('[4] a friends\' room 1V1 whose host writes a duration past DUR_CAP: the host flagged alone, the joiner not', [fOf(last(rs), H), fOf(last(rs), J)], [1, 0]);
    T('[4] logged as flagged alone', /pair-dispute [^\n]*\(duration on his own record\) flagged alone/.test(outOf(rs)));
  }
}

// ---- [5] two accounts of one owner disputing ----
{
  // H and X are one owner's: four friends' rooms and four bot matches, each with two records that disagree. Nothing settles,
  //   nothing is paid, nobody is flagged (before: both flagged once per key -- a flag that cost the owner nothing he wanted)
  const steps = [], seen = [];
  for (let i = 0; i < 8; i++) {
    const mt = i < 4 ? 10 : 11, ros = mt === 10 ? [H, X] : [H, X, null], hsh = 0x2950 + i;
    const st = [{ sid: H, d: rec(0xB2, mt, hsh, 0, 0, false, ros) }, { sid: X, d: rec(0xB2, mt, hsh, 1, 0, false, ros) }];
    const re = [{ sid: H, d: rec(0xB1, mt, hsh, 0, 1, true, ros, [7000, 4000, 0].slice(0, ros.length)) }, { sid: X, d: rec(0xB1, mt, hsh, 1, 1, true, ros, [4000, 7000, 0].slice(0, ros.length)) }];
    seen.push(...st, ...re);
  }
  steps.push([0, seen.filter(r => r.d[0] === 0xB2)], [10 * MIN, seen], [10 * MIN, seen], [2 * HOUR, seen]);
  const rs = timeline(steps);
  if (!allOk(rs, 4)) bad('[5] one owner: runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500));
  else {
    eq('[5] one owner\'s two accounts, eight disputed keys: nobody flagged, nothing paid, counted on each key, one opponent each (the LOOK record needs three)',
      [fOf(last(rs), H), fOf(last(rs), X), paidIn(rs, H), paidIn(rs, X), pdOf(last(rs), H), pdOf(last(rs), X), pdoOf(last(rs), H).length, pdoOf(last(rs), X).length, trustIn(rs, H).concat(trustIn(rs, X))],
      [0, 0, [], [], 8, 8, 1, 1, []]);
    withMutant(['loop'], '[5]', (sc) => {
      const ms = timeline(steps, sc);
      eq('[5] mutant (the job before): both flagged eight times, paid the same nothing', [fOf(last(ms), H), fOf(last(ms), X), paidIn(ms, H), paidIn(ms, X)], [8, 8, [], []]);
    });
  }
}

// ---- [6] an old key the job before flagged ----
withMutant(ALL_BEFORE, '[6]', (sc) => {
  // the job before ran the starts and the results (the friends' room flagged both); the new job takes over its state
  const m = pair(0x2960, { mt: 10, ros: [H, J] });
  const b = pair(0x2961, { mt: 1, ros: [H, null], seat: 2, pc: 2 }, { ros: [H, J], seat: 0 });
  const steps = m.steps.map(([ms, recs], i) => [ms, recs.concat(b.steps[i][1])]);
  const oldAll = timeline(steps, sc), mixed = timeline(steps, [sc, sc, undefined, undefined]);
  if (!allOk(oldAll, 4) || !allOk(mixed, 4)) { bad('[6] runs ' + oldAll.map(r => r.code) + ' / ' + mixed.map(r => r.code)); return; }
  const after2 = timeline(steps.slice(0, 2), sc);
  const k2 = flaggedOf(last(after2)), kEnd = flaggedOf(last(mixed));
  T('[6] the flag keys the job before wrote are all still there after the new job ran twice (' + k2.length + ')', k2.length >= 2 && k2.every(k => kEnd.indexOf(k) >= 0), JSON.stringify([k2, kEnd]));
  eq('[6] the flag counts the job before gave stay (nothing lowered), and the new job adds none',
    [fOf(last(mixed), H), fOf(last(mixed), J)], [fOf(last(after2), H), fOf(last(after2), J)]);
  eq('[6] paid exactly as the job before would have', [paidIn(mixed, H), paidIn(mixed, J)], [paidIn(oldAll, H), paidIn(oldAll, J)]);
  T('[6] the friends\' room dispute counted at most once on each', pdOf(last(mixed), H) <= 1 && pdOf(last(mixed), J) <= 1, JSON.stringify([pdOf(last(mixed), H), pdOf(last(mixed), J)]));
});

// ---- [7] a consistent key whose joiner the host gave a seat outside the table ----
// the host broadcasts seats [{idx 0, H}, {idx 2, J}]: J's client writes seat 2 of 2 and the table [H, empty] (seatSid(1) is
//   '0'); the host writes the same table on his own records, and both agree on the result (J won)
{
  const tail7 = (d) => d.concat([0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0]);   // endless: the depth tail every real writer appends
  const mk = (mt, h, jStart, endless) => {
    const st = [{ sid: H, d: rec(0xB2, mt, h, 0, 0, false, [H, null], null, 2) }].concat(jStart ? [{ sid: J, d: rec(0xB2, mt, h, 2, 0, false, [H, null], null, 2) }] : []);
    const w = (d) => endless ? tail7(d) : d;
    const re = [{ sid: H, d: w(rec(0xB1, mt, h, 0, 2, false, [H, null], [4000, 7000], 2)) }, { sid: J, d: w(rec(0xB1, mt, h, 2, 1, true, [H, null], [4000, 7000], 2)) }];
    const all = st.concat(re);
    return [[0, st], [10 * MIN, all], [10 * MIN, all], [2 * HOUR, all]];
  };
  const cases = [
    // [label, steps, the rules before that flagged, flags before [joiner, host], the log line now]
    ['a quick 1V1, the joiner back cold (no start of his): Q109 dropped his record and flagged him alone; the host\'s blank start (Q130) flagged the host',
      mk(1, 0x2971, false), ['drop', 'blank'], [1, 1], /sanity on [^\n]*\[seat\] \(the host's seat or table: not flagged, Q292\)/],
    ['a quick 1V1 with both starts (both blank, Q130 flagged both; the roster contest holds the key until it voids)',
      mk(1, 0x2972, true), ['drop', 'blank'], [1, 1], /start-blank [^\n]*nobody flagged \(the seat table is the host's, Q292\)/],
    // (Q306 sets an endless record aside on its own seat ahead of the sanity gate, so the run takes its path, not Q292's; the
    //   job before is the one with neither)
    ['an endless run of two (7): the whole-group sanity rule flagged both',
      mk(7, 0x2973, true, true), ['host', 'endown'], [1, 1], /endless sanity \[seat\] on [^\n]*\[seat\] \(not his own field: not flagged\) -- nobody flagged; fewer than two writers left, not settled \(Q306\)/],
    ['a friends\' room (10): Q123 leaves the record out ahead, nobody flagged before or now',
      mk(10, 0x2974, true), ['drop'], [0, 0], /friends' room record\(s\) whose writer is not on his own roster seat -- not counted, nobody flagged \(Q123\)/],
  ];
  for (const [name, steps, before, oldWant, logRe] of cases) {
    const tag = '[7] ' + name;
    const rs = timeline(steps);
    if (!allOk(rs, 4)) { bad(tag + ': runs ' + rs.map(r => r.code) + ' ' + last(rs).out.slice(-1500)); continue; }
    const now = sum(rs);
    T(tag + ': nobody flagged, no trust write', now.fJ === 0 && now.fH === 0 && now.trust.length === 0, JSON.stringify(now) + ' ' + (/(sanity[^\n]*|start-blank[^\n]*|inconsistent[^\n]*)/.exec(outOf(rs)) || [''])[0]);
    T(tag + ': logged', logRe.test(outOf(rs)), (/sanity[^\n]*|start-blank [^\n]*/.exec(outOf(rs)) || [''])[0]);
    withMutant(before, tag, (sc) => {
      const ms = timeline(steps, sc), old = sum(ms);
      eq(tag + ' mutant (' + before.join(' + ') + ': the job before): flags [joiner, host]', allOk(ms, 4) && [old.fJ, old.fH], oldWant);
      T(tag + ': paid exactly as before (' + JSON.stringify([now.paidJ, now.paidH]) + ')', JSON.stringify([now.paidJ, now.paidH]) === JSON.stringify([old.paidJ, old.paidH]), JSON.stringify([old.paidJ, old.paidH]));
    });
  }
}

// ---- [8] wiring pins ----
{
  const pdBody = (/function pairDispute1v1\(g\) \{[\s\S]*?\n\}/.exec(SRC) || [''])[0];
  T('[8] pairDispute1v1 picks no match type (no baseMt / mt comparison in it but the sanity base)', pdBody && !/base\s*(===|!==|<|>)|isMatchmadeMt|isBotMt|isEndlessMt|d\[2\]\s*(===|!==)/.test(pdBody));
  T('[8] it chooses by writers: two accounts, or more with a self-seating table of at most two', /by\.size < 2 \|\| \(by\.size !== 2 && !tables\.some\(\(t\) => t\.length <= 2\)\)/.test(pdBody));
  T('[8] the flag loop asks it for every key, after the Q114 and Q128 skips', (() => { const a = SRC.indexOf('if (processed.has(m)) {\n      RUN.lateMismatch'), b = SRC.indexOf('if (isEndlessMt(g[0].d[2] | 0) && !seatGateRoster(startsPending[m])) {'), c = SRC.indexOf('    const pd1 = pairDispute1v1(g);\n'); return a > 0 && b > a && c > b && SRC.split('    const pd1 = pairDispute1v1(g);\n').length === 2 && SRC.split('pairDispute1v1(').length === 5 && /function signedPairOf\([^)]*\) \{[\s\S]*?\n  const pd = pairDispute1v1\(g\);\n/.test(SRC); })());   // the fifth piece = signedPairOf (the signed 1V1 pair reads the same pair)
  const blank = (/\/\/ Q130: a matchmade start that leaves a seat empty votes nowhere[\s\S]*?BLANK_STARTS\.length = 0;/.exec(SRC) || [''])[0];
  T('[8] the blank-start block flags nobody', blank && !/recordFlag/.test(blank) && /seenBlank/.test(blank));
  T('[8] a consistent key\'s dropped record flags its writer only for a reason outside SANITY_HOST_SLUGS', /const sanityDropFlags = \(x\) => x\.why\.some\(\(f\) => SANITY_HOST_SLUGS\.indexOf\(f\) < 0\);/.test(SRC) && /const flagDrop = sp\.drop\.filter\(sanityDropFlags\);/.test(SRC));
  T('[8] the whole-group sanity rule flags nobody when every reason is the host\'s, and still settles nothing', /if \(!sp\.drop\.length && sane\.every\(\(f\) => SANITY_HOST_SLUGS\.indexOf\(f\) >= 0\)\) \{\n        RUN\.sanityHost = \(RUN\.sanityHost \| 0\) \+ 1;\n        ghWarn\([^\n]*\);\n        continue;\n      \}\n(?:      \/\/ Q294:[^\n]*\n(?:      \/\/[^\n]*\n)*      const hh = sanityHeaderHeld\(g, sane, sp\);\n      if \(hh\) \{\n(?:        [^\n]*\n)+?        continue;\n      \}\n)?      if \(!sp\.drop\.length\) \{\n(?:        if \(endlessHostOnly\(g, sane\)\) \{(?:[^\n]*\n){4}        \}\n)?        recordFlag\(signals, g, c\.m, nowMs\);/.test(SRC));   // Q294: only the header block (host-header-sanity.js pins it) may sit between; Q305: its endless block may open the whole-group branch
  T('[8] the start verdict\'s consolation is unchanged (attested roster + a sane own record; Q294 / Q297: header reasons pass from a writer with no own fault, test/header-consolation.js)', /if \(!Object\.keys\(p\.roster\)\.some\(\(seat\) => p\.roster\[seat\] === h\)\) continue;   \/\/ not on the attested roster\n      const rf = sanityFlags\(\[r\]\);\n      if \(rf\.length && !\(!ownFault\.has\(s\) && rf\.every\(\(f\) => SANITY_HEADER_SLUGS\.indexOf\(f\) >= 0\)\)\) continue;/.test(SRC)
    && /const hdr = p\.hh === 1;/.test(SRC));
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (two-voice-dispute) ===');
process.exit(failN === 0 ? 0 : 1);
