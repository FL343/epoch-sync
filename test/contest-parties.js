'use strict';
// Q143 (cloud audit 2026-10, found by the Q130 review B1-B3 and the Q127 rework review): since Q127 a matchmade key
//   contested once stays held until it voids, so an outside account copies the key off a public start, writes one start
//   of its own (a player's seat before the job's first look, or one more seat while the registered roster is
//   provisional), lets one job run read it and withdraws it: the honest match voids two hours later and no log line or
//   state said whose record it was. Now the job notes, when it marks a key contested, the writers of the records that
//   disagree with the key's table (pending['~' + key].w, at most CONTEST_PARTY_CAP, first come), logs them
//   (contest-parties, and again on the line where the key voids) and counts each account once per key in its B6
//   signals: co when another writer's record names him at some seat, cx when no other record does. Nothing is held,
//   settled, rated or flagged differently.
// End-to-end over the REAL validate.js main() against an offline board stub (the harness of test/team-loss-side.js):
//   [0] units: contestTable (one record per writer, per-seat strict majority, commonest seat count), contestParties (an
//       outsider at a player's seat; an outsider from an extra seat with one more seat; a player naming an alt at another
//       player's seat and the alt: both named by another record; an agreeing honest player is never a party; a custom
//       table and agreement test), lateStartSplit (its list afresh per key), noteContestParties (a matchmade key only,
//       first come, deduplicated, at most CONTEST_PARTY_CAP, logged once per new account), noteParties (an older note
//       without w: nothing), the void lines (reconcileStarts: contest-void names the noted accounts, an older note names
//       nobody)
//   [1] an outside start at a player's seat before the first look, withdrawn after one read (seat claimed twice): the
//       contest-parties line names him "named by no other record" once, his cx is 1, the players' co / cx stay 0, the
//       key still voids at maturity (start-orphan names him), nobody flagged, the summary rows count him; [1b] the same
//       with the players' roster copied word for word (disputed, not split)
//   [2] an outside start from an extra seat with a five-seat roster, read while the registered roster is provisional
//       (the Q118 late split), withdrawn a run later: the same, the party from lateStartSplit's own test
//   [3] the same start read on the job's first look (the roster splits at registration): the same
//   [4] a 1V1 loser's own start claims the winner's seat (no roster ever registers): both are noted "named by another
//       record" (co 1 each: nobody can tell who lies, so nobody is flagged); the start stays up for every run and is
//       counted once (the note's list deduplicates); contest-void names both
//   [5] the roster contest with no start read (an outside result claiming a player's seat next to the four results):
//       named by applyRosterContest, contest-void names him
//   [6] honest 4-player ranked: no contest-parties line, nobody's co / cx moves, the summary rows count 0
//   [7] mutants: the counting loop off; the dispute, split or roster-contest note off; the late-split party list empty;
//       every party "named by another record"; the note's list not deduplicated
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contest-parties-'));
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
//   instant moves back instead: start sightings and key notes, absent-seat stamps, the writers' busy marks, the flag memory)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;   // a note's result sighting (only its truth is read)
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k].bz) sg.players[k].bz -= ms;   // .at stays: the players keep playing
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  if (sg && sg.t2ld) for (const k of Object.keys(sg.t2ld)) for (const e of sg.t2ld[k]) if (e) e.t -= ms;   // team-gamble strikes (Q51 / Q56)
  if (sg && sg.t2lv) for (const k of Object.keys(sg.t2lv)) if (sg.t2lv[k]) sg.t2lv[k].t -= ms;
  return files;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const flaggedKeys = (r) => Object.keys((r.state.SIGNALS_FILE || {}).flagged || {});
const pointsOf = (r, sid) => posts(r, 7).filter(p => new RegExp('steamid=' + sid + '(&|$)').test(p.body)).map(p => Number(/score=(-?[0-9]+)/.exec(p.body)[1]));
const xpOf = (rs, sid) => {   // the last XP value posted for sid over a run list (the progress board starts empty)
  let lastXp = 0;
  for (const r of rs) for (const p of posts(r, 5)) if (new RegExp('steamid=' + sid + '(&|$)').test(p.body)) lastXp = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
  return lastXp;
};

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster
//   ros: one steam id per seat ('0' = nobody); sc: the seat scores the record claims (default by player count)
const SC = { 4: [6100, 5200, 4800, 3900], 6: [6100, 5200, 4400, 4800, 3900, 3500] };
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp) {
  const zero = magic !== 0xB1, pc = ros.length;   // a start (0xB2) and a confession (0xB5) carry zeroed results
  const d = [magic, 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : (sc || SC[pc])[i]);
  d.push(disp | 0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
// team convention: seats 0..ts-1 = team A, ts..2ts-1 = team B; rank claims {1..ts} for the winning team by seat order
const tsOf = (mt) => ((mt & 0xF) === 8 || (mt & 0xF) === 9) ? 3 : 2;
const teamRank = (mt, seat, winTeam) => { const ts = tsOf(mt), team = ((seat / ts) | 0) & 1; return (team === winTeam ? 1 : 1 + ts) + (seat % ts); };
const settle = (mt, hash, seat, ros, winTeam, sc) => rec(0xB1, mt, hash, seat, teamRank(mt, seat, winTeam), (((seat / tsOf(mt)) | 0) & 1) === winTeam, ros, sc);
const start = (mt, hash, seat, ros) => rec(0xB2, mt, hash, seat, 0, false, ros);
const confess = (mt, hash, seat, ros) => rec(0xB5, mt, hash, seat, 0, false, ros, null, 5);   // disp 5 = user-quit
const refuse = (mt, hash, seat, ros) => rec(0xB1, mt, hash, seat, 0, false, ros);   // the client's rank-0 team-gamble refusal
const ffaSettle = (hash, seat, ros) => rec(0xB1, 2, hash, seat, 1 + seat, seat === 0, ros);
const ffaStart = (hash, seat, ros) => rec(0xB2, 2, hash, seat, 0, false, ros);
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];

const MT = 2;   // ranked FFA (matchmade)
const rankOf = (sc, seat) => 1 + sc.filter((x, i) => x > sc[seat] || (x === sc[seat] && i < seat)).length;
const startF = (h, seat, ros) => rec(0xB2, MT, h, seat, 0, false, ros);
const settleF = (h, seat, ros, sc) => rec(0xB1, MT, h, seat, rankOf(sc, seat), rankOf(sc, seat) === 1, ros, sc);
const SC4 = [6100, 5200, 4800, 3900], SC2 = [6100, 3900];
const P = [SID(431), SID(432), SID(433), SID(434)], O = SID(439), A = SID(438), Wn = SID(441), L = SID(442);
const ALL = P.concat([O, A, Wn, L]);
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
  for (const [ms, recs, env] of steps) {
    const r = runCron(boardsWith(recs), state ? advance(state, ms) : null, env || null, script);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const MIN = 60000, HOUR = 3600 * 1000;
const GRACE = (v.ABSENT_GRACE_MS || 300000) + MIN;
const allOk = (rs, n) => rs.length === n && rs.every(r => r.code === 0);
const outOf = (rs) => rs.map(r => r.out).join('');
const last = (rs) => rs[rs.length - 1];
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const coOf = (r, sid) => sigOf(r, sid).co | 0, cxOf = (r, sid) => sigOf(r, sid).cx | 0;
const cc = (r, sids) => JSON.stringify(sids.map((s) => coOf(r, s) + '/' + cxOf(r, s)));
const short = (sid) => v.pid(sid).slice(0, 8);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const partyLines = (out, key) => out.split('\n').filter((l) => new RegExp('contest-parties ' + esc(key) + ':').test(l));
const OFF = (sid, seat) => short(sid) + '@' + seat + ' (named by no other record)';
const ON = (sid, seat) => short(sid) + '@' + seat + ' (named by another record)';
const ROW143 = (r, on, off) => new RegExp("\\| accounts noted in contested keys' disagreeing records, named by another record / by none -- counted, nobody flagged \\(Q143\\) \\| " + on + ' / ' + off + ' \\|').test(r.summary);
const ROW127 = (r, nv, held) => new RegExp('\\| contested matchmade keys voided, no start roster / held to maturity \\(Q127\\) \\| ' + nv + ' / ' + held + ' \\|').test(r.summary);
const noPoints = (rs, sids) => sids.every((s) => [].concat(...rs.map((r) => pointsOf(r, s))).length === 0);
const noFlags = (r, sids) => sids.every((s) => fOf(r, s) === 0);
function mutant(tag, from, to) {
  if (SRC.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once'); return null; }
  const script = path.join(__dirname, '..', '.mutant-contest-parties-' + tag + '-' + process.pid + '.js');
  fs.writeFileSync(script, SRC.replace(from, to));
  return script;
}
function withMutant(tag, from, to, fn) {
  const script = mutant(tag, from, to);
  if (!script) return;
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const capture = (fn) => { const l0 = console.log, lines = []; console.log = (...a) => lines.push(a.join(' ')); try { fn(); } finally { console.log = l0; } return lines; };

console.log('=== whose records contested a matchmade key: logged and counted, nobody flagged (Q143) ===');

// ---- [0] units ----
{
  const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
  const h = 0x1430, honest = P.map((s, i) => R(s, startF(h, i, P)));
  const OS = R(O, startF(h, 0, [O, P[1], P[2], P[3]])), OS5 = R(O, startF(h, 4, P.concat([O])));
  const tab = v.contestTable(honest.concat([OS]));
  T('[0] contestTable: one record per writer, the per-seat majority, the commonest seat count',
    tab.pc === 4 && P.every((s, i) => tab.roster[i] === v.pid(s)) && Object.keys(tab.roster).length === 4
    && v.contestTable(honest.concat([OS5])).pc === 4 && v.contestTable([honest[0], honest[0], OS, OS5]).pc === 4, JSON.stringify(tab));
  const p1 = v.contestParties(honest.concat([OS]));
  T('[0] an outside start at a player\'s seat: the outsider only, named by no other record',
    p1.length === 1 && p1[0].h === v.pid(O) && p1[0].seat === 0 && p1[0].on === false, JSON.stringify(p1));
  const p2 = v.contestParties(honest.concat([OS5]));
  T('[0] an outside start from an extra seat with one more seat: the outsider only', p2.length === 1 && p2[0].h === v.pid(O) && p2[0].seat === 4 && !p2[0].on, JSON.stringify(p2));
  T('[0] honest starts only: no party', v.contestParties(honest).length === 0);
  const alt = [P[0], A, P[2], P[3]];
  const p3 = v.contestParties([R(P[0], startF(h, 0, alt)), R(A, startF(h, 1, alt)), honest[1], honest[2], honest[3]]);
  T('[0] a player naming an alt at another player\'s seat, and the alt: both parties, both named by another record (the players name P0, P0 names the alt)',
    p3.length === 2 && p3.some((q) => q.h === v.pid(P[0]) && q.on) && p3.some((q) => q.h === v.pid(A) && q.on && q.seat === 1), JSON.stringify(p3));
  const reg = {}; P.forEach((s, i) => { reg[i] = v.pid(s); });
  const p4 = v.contestParties(honest.concat([OS5, OS5]), { roster: reg, pc: 0 }, (r) => (r.d[8] | 0) === 4);
  T('[0] a custom table and agreement test (the late split): the disagreeing writer once', p4.length === 1 && p4[0].h === v.pid(O) && p4[0].seat === 4, JSON.stringify(p4));
  // lateStartSplit fills LATE_SPLIT_WHO afresh for each key it splits
  const O2 = SID(437);
  const pOf = () => ({ prov: v.startSig(honest[0]), roster: reg, mt: MT, t0: Date.now() });
  const q1 = capture(() => v.lateStartSplit(pOf(), honest.concat([OS5]), 'L1_1234_2')), who1 = v.LATE_SPLIT_WHO.slice();
  const q2 = capture(() => v.lateStartSplit(pOf(), honest.concat([R(O2, startF(h, 4, P.concat([O2])))]), 'L2_1234_2')), who2 = v.LATE_SPLIT_WHO.slice();
  T('[0] lateStartSplit: the splitting starts by its own test, afresh for each key (the second key\'s list holds its own outsider only)',
    q1.length === 1 && q2.length === 1 && who1.length === 1 && who1[0].h === v.pid(O) && who2.length === 1 && who2[0].h === v.pid(O2), JSON.stringify([who1, who2]));
  // noteContestParties
  v.CONTEST_PARTIES.length = 0;
  const pend = {}, now = Date.now(), K = '7_1234_2', many = Array.from({ length: 10 }, (_, i) => ({ h: ('0' + i).repeat(8), seat: i, on: i % 2 === 0 }));
  const l1 = capture(() => v.noteContestParties(pend, K, now, many));
  const w = (pend['~' + K] || {}).w || [];
  T('[0] noteContestParties: first come, at most CONTEST_PARTY_CAP, each counted once, one log line',
    v.CONTEST_PARTY_CAP === 8 && w.length === 8 && w[0] === '00'.repeat(8) + 'o' && w[1] === '01'.repeat(8) + 'x' && v.CONTEST_PARTIES.length === 8
    && l1.length === 1 && /contest-parties 7_1234_2: 00000000@0 \(named by another record\), 01010101@1 \(named by no other record\)/.test(l1[0]), JSON.stringify([w, l1]));
  const pend2 = { ['~' + K]: { t0: now, s: [], r: 0, c: 1, w: ['02'.repeat(8) + 'x'] } };
  v.CONTEST_PARTIES.length = 0;
  const l2 = capture(() => { v.noteContestParties(pend2, K, now, many.slice(0, 4)); v.noteContestParties(pend2, K, now, many.slice(0, 4)); });
  T('[0] deduplicated against the note (an earlier run): only the new accounts, once', pend2['~' + K].w.length === 4 && v.CONTEST_PARTIES.length === 3 && l2.length === 1
    && l2[0].indexOf('02020202') < 0, JSON.stringify([pend2['~' + K].w, l2]));
  v.CONTEST_PARTIES.length = 0;
  const pend3 = {};
  capture(() => { v.noteContestParties(pend3, '7_1234_10', now, many); v.noteContestParties(pend3, '7_1234_7', now, many); });
  T('[0] a friends\' room or endless key: no note, nothing counted', Object.keys(pend3).length === 0 && v.CONTEST_PARTIES.length === 0);
  T('[0] noteParties: decodes the list; an older note without it gives nothing',
    v.noteParties({ w: ['ab'.repeat(8) + 'o', 'cd'.repeat(8) + 'x'] }) === 'abababab (named by another record), cdcdcdcd (named by no other record)' && v.noteParties({ c: 1 }) === '' && v.noteParties(null) === '');
  // the void line (no entry: contest-void at maturity)
  const old = now - v.STARTS_MATURITY_MS - MIN;
  const pend4 = { '~K1_1234_2': { t0: old, s: [], r: 0, c: 1, w: [v.pid(O) + 'x'] }, '~K2_1234_2': { t0: old, s: [], r: 0, c: 1 } };
  const l4 = capture(() => v.reconcileStarts([], {}, new Set(), new Set(), pend4, {}, now, v.STARTS_MATURITY_MS, {}, true, 0));
  T('[0] contest-void names the noted accounts; an older note names nobody',
    l4.some((l) => /contest-void K1_1234_2: [^\n]*no start roster -- void, nobody rated \(Q127\); contested by [0-9a-f]{8} \(named by no other record\) \(Q143\)/.test(l) && l.indexOf(short(O)) >= 0)
    && l4.some((l) => /contest-void K2_1234_2: [^\n]*nobody rated \(Q127\)$/.test(l)), JSON.stringify(l4));
  v.CONTEST_PARTIES.length = 0;
}

// ---- e2e scenarios ----
const S4 = (h) => P.map((s, i) => ({ sid: s, d: startF(h, i, P) }));
const R4 = (h) => P.map((s, i) => ({ sid: s, d: settleF(h, i, P, SC4) }));
// [1] dispute: an outside start at seat 0 before the first look, withdrawn after one read
const case1 = (() => {
  const h = 0x1431, S = S4(h), R = R4(h), OS = { sid: O, d: startF(h, 0, [O, P[1], P[2], P[3]]) };
  return { key: keyOf(S[0].d), steps: [[0, S.concat([OS])], [5 * MIN, S], [5 * MIN, S.concat(R)], [5 * MIN, S.concat(R)], [2 * HOUR, S.concat(R)]] };
})();
// [1b] the same with the players' roster copied word for word (the seat claimed twice is the only disagreement: no split)
const case1b = (() => {
  const h = 0x1437, S = S4(h), R = R4(h), OS = { sid: O, d: startF(h, 0, P) };
  return { key: keyOf(S[0].d), steps: [[0, S.concat([OS])], [5 * MIN, S], [5 * MIN, S.concat(R)], [5 * MIN, S.concat(R)], [2 * HOUR, S.concat(R)]] };
})();
// [2] late split: an outside start from seat 4 (five seats) read while the roster is provisional
const case2 = (() => {
  const h = 0x1432, S = S4(h), R = R4(h), OS = { sid: O, d: startF(h, 4, P.concat([O])) };
  return { key: keyOf(S[0].d), steps: [[0, S], [2 * MIN, S.concat([OS])], [5 * MIN, S], [5 * MIN, S.concat(R)], [5 * MIN, S.concat(R)], [2 * HOUR, S.concat(R)]] };
})();
// [3] the same start on the first look: the roster splits at registration
const case3 = (() => {
  const h = 0x1433, S = S4(h), R = R4(h), OS = { sid: O, d: startF(h, 4, P.concat([O])) };
  return { key: keyOf(S[0].d), steps: [[0, S.concat([OS])], [5 * MIN, S], [5 * MIN, S.concat(R)], [5 * MIN, S.concat(R)], [2 * HOUR, S.concat(R)]] };
})();
// [4] 1V1: the loser's own start claims the winner's seat and stays up
const case4 = (() => {
  const h = 0x1434, SW = { sid: Wn, d: startF(h, 0, [Wn, L]) }, SL = { sid: L, d: startF(h, 0, [L, Wn]) };
  const R = [0, 1].map((i) => ({ sid: [Wn, L][i], d: settleF(h, i, [Wn, L], SC2) }));
  const up = [SW, SL];
  return { key: keyOf(SW.d), steps: [[0, up], [5 * MIN, up], [5 * MIN, up.concat(R)], [5 * MIN, up.concat(R)], [2 * HOUR, up.concat(R)]] };
})();
// [5] the roster contest, no start read: an outside result claiming seat 0 next to the four results
const case5 = (() => {
  const h = 0x1435, R = R4(h), OR = { sid: O, d: settleF(h, 0, [O, P[1], P[2], P[3]], SC4) };
  return { key: keyOf(R[0].d), steps: [[0, R.concat([OR])], [5 * MIN, R], [2 * HOUR, R]] };
})();
// [6] honest control
const case6 = (() => {
  const h = 0x1436, S = S4(h), R = R4(h);
  return { key: keyOf(S[0].d), steps: [[0, S], [5 * MIN, S.concat(R)], [GRACE, S.concat(R)], [3 * HOUR, S.concat(R)]] };
})();

function outsideCase(tag, c, seat, at, how) {
  const rs = timeline(c.steps), n = c.steps.length, out = outOf(rs), pl = partyLines(out, c.key);
  T(tag + ' runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T(tag + ' one contest-parties line, in the run that read the start (' + how + '): the outsider, named by no other record, no player',
    pl.length === 1 && partyLines(rs[at].out, c.key).length === 1 && pl[0].indexOf(OFF(O, seat)) >= 0 && P.every((s) => pl[0].indexOf(short(s)) < 0), JSON.stringify(pl));
  T(tag + ' counted once in his signals (cx 1, co 0); the players\' co / cx stay 0; nobody flagged',
    cxOf(last(rs), O) === 1 && coOf(last(rs), O) === 0 && P.every((s) => coOf(last(rs), s) === 0 && cxOf(last(rs), s) === 0) && noFlags(last(rs), P.concat([O])),
    cc(last(rs), P.concat([O])));
  T(tag + ' the summary row counts him in that run', ROW143(rs[at], 0, 1) && rs.every((r, i) => i === at || ROW143(r, 0, 0)));
  T(tag + ' still voided at maturity, nobody rated; the start-orphan line names him',
    processedOf(last(rs)).has(c.key) && noPoints(rs, P) && new RegExp('start-orphan ' + esc(c.key) + ':[^\\n]*contested once \\(Q127\\), nobody rated, contested by ' + short(O) + ' \\(named by no other record\\) \\(Q143\\)').test(last(rs).out)
    && ROW127(last(rs), 0, 1), last(rs).out.slice(-900));
  return rs;
}
{
  outsideCase('[1] seat claimed twice before the first look:', case1, 0, 0, 'the start-dispute');
  const rs1b = outsideCase('[1b] the same, the players\' roster copied word for word:', case1b, 0, 0, 'the start-dispute');
  T('[1b] the seat claimed twice is the only disagreement: disputed, not split', /start-dispute /.test(rs1b[0].out) && !/start-split /.test(outOf(rs1b)));
  const rs2 = outsideCase('[2] late split (Q118):', case2, 4, 1, 'the late split');
  T('[2] the late split happened in that run', /start-split [^\n]*a start record read after the roster was registered names another roster/.test(rs2[1].out));
  const rs3 = outsideCase('[3] split at registration:', case3, 4, 0, 'the split');
  T('[3] the voters split in that run', /start-split [^\n]*the voters do not agree on the roster/.test(rs3[0].out));
}
{
  const rs = timeline(case4.steps), n = case4.steps.length, pl = partyLines(outOf(rs), case4.key);
  T('[4] runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T('[4] both 1V1 players noted once, each named by another record', pl.length === 1 && pl[0].indexOf(ON(Wn, 0)) >= 0 && pl[0].indexOf(ON(L, 0)) >= 0, JSON.stringify(pl));
  T('[4] counted once each although the start stays up for every run (co 1, cx 0), nobody flagged',
    coOf(last(rs), Wn) === 1 && coOf(last(rs), L) === 1 && cxOf(last(rs), Wn) === 0 && cxOf(last(rs), L) === 0 && noFlags(last(rs), [Wn, L]), cc(last(rs), [Wn, L]));
  T('[4] voided at maturity from its note, nobody rated; contest-void names both',
    processedOf(last(rs)).has(case4.key) && noPoints(rs, [Wn, L])
    && new RegExp('contest-void ' + esc(case4.key) + ': [^\\n]*no start roster -- void, nobody rated \\(Q127\\); contested by [^\\n]*' + short(Wn) + '[^\\n]*\\(Q143\\)').test(last(rs).out)
    && new RegExp('contest-void ' + esc(case4.key) + ': [^\\n]*' + short(L)).test(last(rs).out) && ROW127(last(rs), 1, 0), last(rs).out.slice(-900));
}
{
  const rs = timeline(case5.steps), n = case5.steps.length, pl = partyLines(outOf(rs), case5.key);
  T('[5] runs exit 0', allOk(rs, n), last(rs).out.slice(-800));
  T('[5] the roster contest names the outsider (named by no other record), no player', pl.length === 1 && partyLines(rs[0].out, case5.key).length === 1
    && /roster contest, not settled/.test(rs[0].out) && pl[0].indexOf(OFF(O, 0)) >= 0 && P.every((s) => pl[0].indexOf(short(s)) < 0), JSON.stringify(pl));
  T('[5] cx 1 for him, nothing for the players, nobody flagged', cxOf(last(rs), O) === 1 && P.every((s) => coOf(last(rs), s) === 0 && cxOf(last(rs), s) === 0)
    && noFlags(last(rs), P.concat([O])), cc(last(rs), P.concat([O])));
  T('[5] voided at maturity from its note; contest-void names him', processedOf(last(rs)).has(case5.key) && noPoints(rs, P)
    && new RegExp('contest-void ' + esc(case5.key) + ': [^\\n]*; contested by ' + short(O) + ' \\(named by no other record\\) \\(Q143\\)').test(last(rs).out), last(rs).out.slice(-900));
}
{
  const rs = timeline(case6.steps), n = case6.steps.length;
  T('[6] honest 4-player ranked: runs exit 0, rated as before', allOk(rs, n) && P.every((s) => [].concat(...rs.map((r) => pointsOf(r, s))).length === 1), last(rs).out.slice(-800));
  T('[6] no contest-parties line, nobody\'s co / cx, the rows count 0', !/contest-parties /.test(outOf(rs)) && P.every((s) => coOf(last(rs), s) === 0 && cxOf(last(rs), s) === 0)
    && rs.every((r) => ROW143(r, 0, 0) && ROW127(r, 0, 0)), cc(last(rs), P));
}

// ---- [7] mutants ----
const COUNT_AT = '    if (on) { sp.co = (sp.co | 0) + 1; RUN.contestOn = (RUN.contestOn | 0) + 1; } else { sp.cx = (sp.cx | 0) + 1; RUN.contestOff = (RUN.contestOff | 0) + 1; }';
withMutant('count', COUNT_AT, '    void on; void sp;', (script) => {
  const m = timeline(case1.steps, script);
  T('[7] mutant: the counting loop off -> [1] his cx stays 0', allOk(m, case1.steps.length) && cxOf(last(m), O) === 0, cc(last(m), [O]));
});
withMutant('dispute', '        if (mm) noteContestParties(pending, m, now, contestParties(sg[m]));   // Q143: whose records\n        RUN.disputed', '        RUN.disputed', (script) => {
  const m = timeline(case1b.steps, script);
  T('[7] mutant: the dispute note off -> [1b] nobody named, nothing counted', allOk(m, case1b.steps.length) && !partyLines(outOf(m), case1b.key).length && cxOf(last(m), O) === 0);
});
withMutant('split', '      if (mm) noteContestParties(pending, m, now, contestParties(sg[m]));   // Q143: whose records\n      RUN.split', '      RUN.split', (script) => {
  const m = timeline(case3.steps, script);
  T('[7] mutant: the split note off -> [3] nobody named', allOk(m, case3.steps.length) && !partyLines(outOf(m), case3.key).length && cxOf(last(m), O) === 0);
});
withMutant('late', '  if (mm) for (const q of contestParties(recs, { roster: p.roster || {}, pc: 0 }, (r) => startSig(r) === p.prov || blankSeatStart(r) || ownSeat(r))) LATE_SPLIT_WHO.push(q);\n', '', (script) => {
  const m = timeline(case2.steps, script);
  T('[7] mutant: the late-split list empty -> [2] nobody named', allOk(m, case2.steps.length) && !partyLines(outOf(m), case2.key).length && cxOf(last(m), O) === 0);
});
withMutant('contest', '    if (res.contested.has(m)) noteContestParties(pending, m, now, contestParties(recsM));   // Q143: whose records\n', '', (script) => {
  const m = timeline(case5.steps, script);
  T('[7] mutant: the roster-contest note off -> [5] nobody named', allOk(m, case5.steps.length) && !partyLines(outOf(m), case5.key).length && cxOf(last(m), O) === 0);
});
withMutant('allon', '    if (!out.has(h)) out.set(h, { h, seat: r.d[5] | 0, on: !!namedBy[h] });', '    if (!out.has(h)) out.set(h, { h, seat: r.d[5] | 0, on: true });', (script) => {
  const m = timeline(case1.steps, script);
  T('[7] mutant: every party "named by another record" -> [1] the outsider counted co', allOk(m, case1.steps.length) && coOf(last(m), O) === 1 && cxOf(last(m), O) === 0, cc(last(m), [O]));
});
withMutant('dedup', '    if (w.length >= CONTEST_PARTY_CAP || w.some((x) => x.slice(0, 16) === q.h)) continue;', '    if (w.length >= CONTEST_PARTY_CAP) continue;', (script) => {
  const m = timeline(case4.steps, script);
  T('[7] mutant: the note not deduplicated -> [4] counted every run', allOk(m, case4.steps.length) && coOf(last(m), Wn) > 1, cc(last(m), [Wn, L]));
});

console.log(failN ? '=== FAIL -- ' + failN + ' fail (contest-parties) ===' : '=== PASS -- 0 fail (contest-parties) ===');
process.exit(failN ? 1 : 0);
