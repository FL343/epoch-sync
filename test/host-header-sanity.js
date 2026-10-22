'use strict';
// Q294 (cloud audit 2026-10): the host's match header on every joiner's record. An honest joiner's client takes the entry and
//   mode, the party / trio bits and the seat table from the host's START_GAME unchecked (mvp/src/net/mp.js onStartGame) and
//   result-reporter mtCodeOf builds the record's type code from them: a modded host who sent a team code on a 1V1 or a
//   brawl of three (sanity reason 'pc'), a trio bit on seats that do not exist ('trio-range'), a party bit past the seats
//   ('mask-range'), a pair overlapping the trio ('unit-overlap'), a ranked code on the demo job ('mt') or a bot match with
//   no bot ('nobot') had every writer's record carry it; the records agree, so the whole-group rule flagged every writer --
//   the honest joiners with the host, once per match (three: trust tier 1).
//   Now (validate.js, sanityHeaderHeld): when every shared-field reason is a header reason (SANITY_HEADER_SLUGS) nobody is
//   flagged for it; a writer whose own record breaks its own fields (a duration past DUR_CAP, a second record of his) is
//   flagged alone. The match still does not settle; a matchmade key is voided at the start verdict (two hours on) with its
//   records still up, like a disputed key: each writer of a result on the attested roster gets the 50 consolation XP (his
//   record failed the sanity check on the host's header alone), a writer breaking his own fields does not, and nobody is
//   convicted (a seat that wrote its start and no result is spared: the header broke the match for everyone in it).
// Over the REAL validate.js main() against an offline board stub (the harness of test/two-voice-dispute.js):
//   [1] units: sanityHeaderHeld / sanityWriterFaults / SANITY_HEADER_SLUGS on every header reason, what it leaves alone
//   [2] end to end, the host's header on honest joiners (1V1 / brawl of three, team code / trio bit / party bit / ranked on
//       the demo job / a bot match without a bot): nobody flagged, nothing settled; mutant (the job before) -> all flagged
//   [3] the header plus the host's own broken duration: only the host flagged; mutant -> everyone
//   [4] what stays: a shared reason outside the header (scores past the cap) flags every writer, as before
//   [5] a key the job before flagged: no flag removed, none added
//   [6] wiring pins
//   [7] the void at maturity: every writer consoled once and nothing else paid, nothing before maturity, the bot lane left
//       alone, a seat with a start and no result spared, a writer breaking his own fields not consoled, a score-flagged key
//       not voided, the VOID receipt on a ranked key; mutants (the job before / each part put back)
//   [8] the upgrade: a held key the job before matured (and flagged) voids at this job's first run, nobody convicted; a held
//       key whose results rotate off before maturity is still spared (the mark is kept on the entry)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-header-sanity-'));
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

// mutants: validate.js with the rule before this fix put back
const BEFORE = {
  header: ['      const hh = sanityHeaderHeld(g, sane, sp);\n', '      const hh = null;\n'],   // the whole-group rule flags every writer
  held: ['  if (heldKeys && heldKeys.size) consistentKeys = new Set([...consistentKeys].filter((k) => !heldKeys.has(k)));   // Q294: held keys are the verdict\'s\n', ''],   // a held key's verdict waits for its records to go
  console: ['if (rf.length && !(!ownFault.has(s) && rf.every((f) => SANITY_HEADER_SLUGS.indexOf(f) >= 0))) continue;', 'if (rf.length) continue;'],   // header reasons fail the consolation (Q297: on every voided key)
  spare: ["      if (hdr) { hdrSpared.push(h.slice(0, 8)); continue; }   // Q294: the host's match header broke the match for everyone in it\n", ''],   // a held key convicts
  mark: ['    if (heldKeys && heldKeys.has(m) && p.hh !== 1) p.hh = 1;   // Q294: the host\'s match header held it (cumulative)\n', ''],   // the mark is not kept
};
const VOID_BEFORE = ['header', 'held', 'console', 'spare', 'mark'];
let mutN = 0;
function mutant(keys, tag) {
  let src = SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return null; }
    src = src.replace(from, to);
  }
  const script = path.join(__dirname, '..', '.mutant-host-header-sanity-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  return script;
}
const withMutant = (keys, tag, fn) => { const s = mutant(keys, tag); if (!s) return; try { fn(s); } finally { try { fs.unlinkSync(s); } catch (e) {} } };

let hn = 0;
// one match: ws = [[sid, seat, table, pc, writesStart, writesResult]] -- every result agrees on the scores (rank = seat + 1);
//   opt.mut(sid, d) rewrites a writer's result (his own fields); opt.env = the job's env (PT_MODE: the demo job).
//   Runs: the starts; ten minutes later the results; ten more; two hours on (past STARTS_MATURITY_MS).
function play(mt, ws, opt, script) {
  opt = opt || {};
  const hsh = 0x2940 + (++hn);
  const st = ws.filter(w => w[4]).map(([sid, seat, ros, pc]) => ({ sid, d: rec(0xB2, mt, hsh, seat, 0, false, ros, null, pc) }));
  const sc = opt.sc || [7000, 5000, 4000, 3000].slice(0, 4);
  const re = ws.filter(w => w[5] !== false).map(([sid, seat, ros, pc]) => {
    const d = rec(0xB1, mt, hsh, seat, Math.min(seat, pc - 1) + 1, seat === 0, ros, sc.slice(0, pc).concat([3000, 3000, 3000]).slice(0, pc), pc);
    return { sid, d: opt.mut ? opt.mut(sid, d) : d };
  });
  const all = st.concat(re).concat(opt.extra || []);
  const env = opt.env || null;
  const steps = opt.steps ? opt.steps(st, all, env) : [[0, st, env], [10 * MIN, all, env], [10 * MIN, all, env], [2 * HOUR, all, env]];
  const rs = timeline(steps, script, opt.files0);
  return { rs, key: hsh + '_1234_' + mt };
}
function sum(p, sids, n) {
  const rs = p.rs, r = last(rs), o = { ok: allOk(rs, n || 4) };
  for (const s of sids) o[s] = { f: fOf(r, s), xp: paidIn(rs, s), lv: leavesOf(r, s), trust: trustIn(rs, s) };
  o.processed = processedOf(r).has(p.key);
  o.line = (/::warning::match=[^\n]*sanity[^\n]*/.exec(outOf(rs)) || [''])[0].replace(/^::warning::/, '');
  o.verdict = (new RegExp('  start-orphan ' + p.key + ': started, never settled[^\\n]*').exec(outOf(rs)) || [''])[0].trim();
  return o;
}

// ---- [1] units ----
{
  eq('[1] SANITY_HEADER_SLUGS', v.SANITY_HEADER_SLUGS, ['mt', 'pc', 'mask-range', 'trio-range', 'unit-overlap', 'nobot']);
  const g1 = (mt, ros, pc, extra) => ros.map((s, i) => s == null ? null : R(s, rec(0xB1, mt, 0x2900, i, i + 1, i === 0, ros, null, pc))).filter(Boolean).concat(extra || []);
  const held = (g) => v.sanityHeaderHeld(g);
  const cases = [
    ['a team code (3) on a 1V1', g1(3, two, 2), ['pc']],
    ['a trio bit on a 1V1 (0x101)', g1(0x101, two, 2), ['trio-range']],
    ['a party bit past the seats (0x21: seats 2..3 of 2)', g1(0x21, two, 2), ['mask-range']],
    ['a pair overlapping the trio (0x111, four seats)', g1(0x111, [H, J, X, Y], 4), ['unit-overlap']],
    ['a team code (3) on a brawl of three', g1(3, three, 3), ['pc']],
    ['a ranked 2V2 code (4) on six seats', g1(4, [H, J, X, Y, Z, P], 6), ['pc']],
    ['a bot match with no bot seat (11)', g1(11, two, 2), ['nobot']],
  ];
  for (const [name, g, want] of cases) {
    const hh = held(g);
    T('[1] ' + name + ': held for ' + JSON.stringify(want) + ', nobody flagged', !!hh && JSON.stringify(hh.flags) === JSON.stringify(want) && hh.own.length === 0, JSON.stringify(hh));
  }
  // the writer's own fields: a duration past DUR_CAP or a second record of his are his, the seat is the host's (Q292)
  const gd = g1(3, two, 2).map(r => r.steamID === H ? R(H, durBad(r.d)) : r);
  const hd = held(gd);
  T('[1] the header + the host\'s own duration: held, only the host listed [duration]', !!hd && hd.own.length === 1 && hd.own[0].sid === H && JSON.stringify(hd.own[0].why) === '["duration"]', JSON.stringify(hd));
  const gw = g1(3, two, 2).concat([R(H, rec(0xB1, 3, 0x2900, 0, 1, true, two, null, 2))]);
  const hw = held(gw);
  T('[1] the header + a second record of the host: only the host listed [dup-writer]', !!hw && hw.own.length === 1 && hw.own[0].sid === H && hw.own[0].why[0] === 'dup-writer', JSON.stringify(hw));
  const gs = [R(H, rec(0xB1, 3, 0x2900, 0, 1, true, [H, J, null], null, 3)), R(J, rec(0xB1, 3, 0x2900, 3, 2, false, [H, J, null], null, 3))];
  const hs = held(gs);
  T('[1] the header + the joiner seated outside the table (the host\'s seat): held, nobody listed', !!hs && hs.own.length === 0, JSON.stringify(hs));
  // what it leaves alone (the rules before)
  const sc = (g, f) => g.map(r => { const d = r.d.slice(); for (let i = 0; i < (d[8] | 0); i++) d[10 + i] = f; return R(r.steamID, d); });
  const none = [
    ['a clean match', g1(1, two, 2)],
    ['scores past the cap (shared, not the header)', sc(g1(1, two, 2), 999999)],
    ['the header + scores past the cap', sc(g1(3, two, 2), 999999)],
    ['a team code with a party bit (team-mask: no honest client writes it)', g1(0x13, [H, J, X, Y], 4)],
    ['a writer\'s own duration only (Q109 splits it)', g1(1, two, 2).map(r => r.steamID === J ? R(J, durBad(r.d)) : r)],
    ['one writer with a bot match header and no bot seat (his own word: the bot lane\'s lone human is the host)', g1(11, two, 2).slice(0, 1)],
    ['one writer, two records of a team code on a 1V1', g1(3, two, 2).slice(0, 1).concat(g1(3, two, 2).slice(0, 1))],
  ];
  for (const [name, g] of none) T('[1] ' + name + ': not held', held(g) === null, JSON.stringify(held(g)));
  // the per-writer half is sanitySplit's (same faults it drops)
  const gq = g1(1, two, 2).map(r => r.steamID === J ? R(J, durBad(r.d)) : r);
  eq('[1] sanityWriterFaults == sanitySplit\'s drop (a writer\'s own duration)', v.sanityWriterFaults(gq).map(x => [x.sid, x.why]), v.sanitySplit(gq).drop.map(x => [x.sid, x.why]));
}

// ---- [2] end to end: the host's header on honest joiners ----
const DEMO = { PT_MODE: '1', APPID: '2', DEMO_APPID: '2' };
const HEADER_CASES = [
  // [label, mt, ws, honest, opt]
  ['a quick 1V1, the host sends a team code (3)', 3, [[H, 0, two, 2, true], [J, 1, two, 2, true]], [J]],
  ['a quick 1V1, the host sends a trio bit (0x101)', 0x101, [[H, 0, two, 2, true], [J, 1, two, 2, true]], [J]],
  ['a quick 1V1, the host sends a party bit past the seats (0x21)', 0x21, [[H, 0, two, 2, true], [J, 1, two, 2, true]], [J]],
  ['a quick brawl of three, a team code (3) to both joiners', 3, [[H, 0, three, 3, true], [J, 1, three, 3, true], [X, 2, three, 3, true]], [J, X]],
  ['a ranked brawl of three, a trio bit (0x202: seats 1..3 of 3)', 0x202, [[H, 0, three, 3, true], [J, 1, three, 3, true], [X, 2, three, 3, true]], [J, X]],
  ['a quick brawl of four, a pair overlapping the trio (0x111)', 0x111, [[H, 0, [H, J, X, Y], 4, true], [J, 1, [H, J, X, Y], 4, true], [X, 2, [H, J, X, Y], 4, true], [Y, 3, [H, J, X, Y], 4, true]], [J, X, Y]],
  ['the demo job, a ranked 1V1 code (2) the job does not run', 2, [[H, 0, two, 2, true], [J, 1, two, 2, true]], [J], { env: DEMO }],
  ['a bot match of two humans with no bot seat (11)', 11, [[H, 0, two, 2, true], [J, 1, two, 2, true]], [J]],
];
for (const [name, mt, ws, honest, opt] of HEADER_CASES) {
  const tag = '[2] ' + name;
  const p = play(mt, ws, opt);
  const now = sum(p, [H].concat(honest));
  if (!now.ok) { bad(tag + ': runs ' + p.rs.map(r => r.code) + ' ' + last(p.rs).out.slice(-1500)); continue; }
  T(tag + ': nobody flagged, no trust write', [H].concat(honest).every(s => now[s].f === 0 && now[s].trust.length === 0), JSON.stringify(now));
  T(tag + ': logged as the host\'s header (Q294)', /the host's match header, nobody flagged \(Q294\), not settled/.test(now.line), now.line);
  withMutant(['header'], tag, (sc) => {
    const old = sum(play(mt, ws, opt, sc), [H].concat(honest));
    T(tag + ' mutant (the job before): every writer flagged once', old.ok && [H].concat(honest).every(s => old[s].f === 1), JSON.stringify(old));
  });
}

// ---- [3] the header plus the host's own broken duration ----
{
  const tag = '[3] a quick 1V1 with a team code (3), the host\'s own result past DUR_CAP';
  const ws = [[H, 0, two, 2, true], [J, 1, two, 2, true]];
  const opt = { mut: (sid, d) => sid === H ? durBad(d) : d };
  const now = sum(play(3, ws, opt), [H, J]);
  T(tag + ': only the host flagged', now.ok && now[H].f === 1 && now[J].f === 0, JSON.stringify(now));
  T(tag + ': logged with his own fault', /only [0-9a-f]{8}\[duration\] flagged \(own fields\) \(Q294\)/.test(now.line), now.line);
  withMutant(['header'], tag, (sc) => {
    const old = sum(play(3, ws, opt, sc), [H, J]);
    T(tag + ' mutant (the job before): both flagged', old.ok && old[H].f === 1 && old[J].f === 1, JSON.stringify(old));
  });
}

// ---- [4] what stays: a shared reason outside the header ----
{
  const tag = '[4] a quick 1V1, both records claim scores past the cap (and a team code)';
  for (const mt of [1, 3]) {
    const now = sum(play(mt, [[H, 0, two, 2, true], [J, 1, two, 2, true]], { sc: [999999, 999999] }), [H, J]);
    T(tag + ' mt ' + mt + ': both flagged as before', now.ok && now[H].f === 1 && now[J].f === 1 && /sanity-flagged \[/.test(now.line), JSON.stringify(now));
  }
}

// ---- [5] a key the job before flagged ----
{
  const tag = '[5] a quick 1V1 with a team code, flagged by the job before, then this job';
  const ws = [[H, 0, two, 2, true], [J, 1, two, 2, true]];
  withMutant(['header'], tag, (sc) => {
    const p = play(3, ws, null, [sc, sc, VALIDATE, VALIDATE]);
    const now = sum(p, [H, J]);
    T(tag + ': the flags stay (once each), none added', now.ok && now[H].f === 1 && now[J].f === 1, JSON.stringify(now));
  });
}

// ---- [6] wiring pins ----
{
  T('[6] the Q294 branch sits after the Q292 one and before the whole-group flag', (() => {
    const a = SRC.indexOf('if (!sp.drop.length && sane.every((f) => SANITY_HOST_SLUGS.indexOf(f) >= 0)) {'), b = SRC.indexOf('      const hh = sanityHeaderHeld(g, sane, sp);\n'), c = SRC.indexOf('      if (!sp.drop.length) {\n        recordFlag(signals, g, c.m, nowMs);');
    return a > 0 && b > a && c > b;
  })());
  const br = (/      const hh = sanityHeaderHeld\(g, sane, sp\);\n[\s\S]*?\n        continue;\n      \}\n/.exec(SRC) || [''])[0];
  T('[6] it flags only the writers whose own records break their own fields, and settles nothing', /recordFlag\(signals, hh\.own\.map\(x => \(\{ steamID: x\.sid \}\)\), c\.m, nowMs\)/.test(br) && (br.match(/recordFlag\(/g) || []).length === 1 && /continue;/.test(br));
  const hb = (/function sanityHeaderHeld\(g, sane, sp\) \{[\s\S]*?\n\}/.exec(SRC) || [''])[0];
  T('[6] sanityHeaderHeld: every shared reason a header reason, the key not split, own = sanityDropFlags', /shared\.some\(\(f\) => SANITY_HEADER_SLUGS\.indexOf\(f\) < 0\)/.test(hb) && /\.drop\.length\) return null/.test(hb) && /sanityWriterFaults\(g\)\.filter\(sanityDropFlags\)/.test(hb));
  T('[6] sanitySplit drops what sanityWriterFaults names (one copy of the per-writer half)', /function sanitySplit\(g\) \{[\s\S]*?const drop = sanityWriterFaults\(g\);[\s\S]*?\n\}/.test(SRC));
  T('[6] main: held keys = the consistent (not solo) keys sanityHeaderHeld holds, passed to the verdict (which takes them out of its consistent set); confessions keep consistentKeys',
    /const heldKeys = new Set\(consistentMatches\.filter\(\(c\) => !c\.solo && sanityHeaderHeld\(c\.g\)\)\.map\(\(c\) => c\.m\)\);/.test(SRC)
      && /const startsRes = reconcileStarts\(starts, groups, consistentKeys, [^\n]*, noted, heldKeys\);/.test(SRC) && /\n      consistentKeys,   \/\/ absolution probe/.test(SRC)
      && /function reconcileStarts\([^\n]*, notedSet, heldKeys\) \{\n  confState = confState \|\| \{\};\n  if \(heldKeys && heldKeys\.size\) consistentKeys = new Set\(\[\.\.\.consistentKeys\]\.filter\(\(k\) => !heldKeys\.has\(k\)\)\);/.test(SRC));
  const vb = (/function reconcileStarts\([\s\S]*?\n\}/.exec(SRC) || [''])[0];
  T('[6] reconcileStarts: the mark is kept on the entry (after the lane exemption), the spare comes after the confession and exit-note checks, the consolation relaxes header reasons only',
    /\n    if \(heldKeys && heldKeys\.has\(m\) && p\.hh !== 1\) p\.hh = 1;[^\n]*\n    if \(now - \(p\.t0 \|\| 0\) < maturityMs\) continue;/.test(vb)
      && /p\.noted\.indexOf\(h\) >= 0\) \{ spared\.push[^\n]*\n      if \(hdr\) \{ hdrSpared\.push/.test(vb)
      && /if \(rf\.length && !\(!ownFault\.has\(s\) && rf\.every\(\(f\) => SANITY_HEADER_SLUGS\.indexOf\(f\) >= 0\)\)\) continue;/.test(vb));   // Q297: on every voided key (test/header-consolation.js)
}

// ---- [7] the void at maturity ----
{
  for (const [name, mt, ws, honest, opt] of HEADER_CASES) {
    const tag = '[7] ' + name, who = [H].concat(honest);
    const p = play(mt, ws, opt);
    const now = sum(p, who);
    if (!now.ok) { bad(tag + ': runs ' + p.rs.map(r => r.code) + ' ' + last(p.rs).out.slice(-1500)); continue; }
    if (mt === 11) {   // the bot lane: no void and no consolation by design (O156) -- left as it was
      T(tag + ': the bot lane is not voided, nobody paid or convicted', !now.processed && who.every(s => now[s].xp.length === 0 && now[s].lv === 0), JSON.stringify(now));
      continue;
    }
    T(tag + ': nothing before maturity (the third run, twenty minutes on)', !processedOf(p.rs[2]).has(p.key) && who.every(s => paidIn(p.rs.slice(0, 3), s).length === 0));
    T(tag + ': voided at maturity, every writer consoled once with 50 XP and paid nothing else, nobody convicted',
      now.processed && who.every(s => JSON.stringify(now[s].xp) === '[50]' && now[s].lv === 0 && now[s].f === 0), JSON.stringify(now));
    T(tag + ': the verdict says the host\'s header held it (Q294)', /the host's match header held it \(Q294\): nobody convicted/.test(now.verdict), now.verdict);
    if (v.appliesLp(mt) && !(opt && opt.env && opt.env.PT_MODE)) T(tag + ': a ranked key -> a VOID receipt for its accounts', new RegExp('receipt ' + p.key + ': never settled -> VOID receipt for ' + who.length + ' account').test(outOf(p.rs)));
    withMutant(VOID_BEFORE, tag, (sc) => {
      const old = sum(play(mt, ws, opt, sc), who);
      T(tag + ' mutant (the job before): not voided, nobody paid', old.ok && !old.processed && who.every(s => old[s].xp.length === 0), JSON.stringify(old));
    });
  }
  {
    const tag = '[7] a quick brawl of three with a team code (3), the third seat wrote its start and no result';
    const ws = [[H, 0, three, 3, true], [J, 1, three, 3, true], [X, 2, three, 3, true, false]];
    const now = sum(play(3, ws), [H, J, X]);
    T(tag + ': H and J consoled, X spared (no exit, no XP)', now.ok && now.processed && JSON.stringify(now[H].xp) === '[50]' && JSON.stringify(now[J].xp) === '[50]' && now[X].xp.length === 0 && now[X].lv === 0, JSON.stringify(now));
    T(tag + ': logged as spared', /nobody convicted, 1 spared \(/.test(now.verdict), now.verdict);
    withMutant(['spare'], tag, (sc) => {
      const old = sum(play(3, ws, null, sc), [H, J, X]);
      T(tag + ' mutant (spare put back): X convicted', old.ok && old.processed && old[X].lv === 1, JSON.stringify(old));
    });
    // control: the same match with an honest header (quick brawl, mt 1) settles; the void path is not involved
    const ctl = sum(play(1, ws), [H, J, X]);
    T(tag + ' control (mt 1, an honest header): settles (no Q294 verdict)', ctl.ok && ctl.processed && !/Q294/.test(ctl.verdict) && !/Q294/.test(ctl.line), JSON.stringify(ctl));
  }
  {
    const tag = '[7] a quick 1V1 with a team code (3), the host\'s own result past DUR_CAP';
    const ws = [[H, 0, two, 2, true], [J, 1, two, 2, true]];
    const opt = { mut: (sid, d) => sid === H ? durBad(d) : d };
    const now = sum(play(3, ws, opt), [H, J]);
    T(tag + ': voided, J consoled, H (his own fields) not', now.ok && now.processed && JSON.stringify(now[J].xp) === '[50]' && now[H].xp.length === 0 && now[H].lv === 0 && now[H].f === 1 && now[J].f === 0, JSON.stringify(now));
    withMutant(['console'], tag, (sc) => {
      const old = sum(play(3, ws, opt, sc), [H, J]);
      T(tag + ' mutant (header reasons fail the consolation again): J not consoled', old.ok && old.processed && old[J].xp.length === 0, JSON.stringify(old));
    });
  }
  {
    const tag = '[7] a quick 1V1 with a team code (3), both records claim scores past the cap';
    const now = sum(play(3, [[H, 0, two, 2, true], [J, 1, two, 2, true]], { sc: [999999, 999999] }), [H, J]);
    T(tag + ': not held, so not voided while its records are up; nobody paid', now.ok && !now.processed && now[H].xp.length === 0 && now[J].xp.length === 0, JSON.stringify(now));
  }
}

// ---- [8] the upgrade ----
{
  const tag = '[8] a brawl of three with a team code (3), X wrote only his start; the job before ran past maturity, then this job';
  const ws = [[H, 0, three, 3, true], [J, 1, three, 3, true], [X, 2, three, 3, true, false]];
  const five = (st, all, env) => [[0, st, env], [10 * MIN, all, env], [10 * MIN, all, env], [2 * HOUR, all, env], [10 * MIN, all, env]];
  withMutant(VOID_BEFORE, tag, (sc) => {
    const p = play(3, ws, { steps: five }, [sc, sc, sc, sc, VALIDATE]);
    const before = processedOf(p.rs[3]).has(p.key), r4 = p.rs[3];
    T(tag + ': under the job before the matured key stays held, everyone flagged once, nobody convicted or paid',
      !before && fOf(r4, H) === 1 && fOf(r4, J) === 1 && leavesOf(r4, X) === 0 && paidIn(p.rs.slice(0, 4), H).length === 0);
    const now = sum(p, [H, J, X], 5);
    const r5 = [p.rs[4]];
    T(tag + ': this job voids it at its first run: H and J consoled, X spared, the old flags kept (none added or removed)',
      now.ok && now.processed && JSON.stringify(paidIn(r5, H)) === '[50]' && JSON.stringify(paidIn(r5, J)) === '[50]' && paidIn(r5, X).length === 0
        && now[X].lv === 0 && now[H].f === 1 && now[J].f === 1 && now[X].f === 0, JSON.stringify(now));
  });
  const tag2 = '[8] a brawl of three with a team code (3), X wrote only his start, the results rotate off before maturity';
  const gone = (st, all, env) => [[0, st, env], [10 * MIN, all, env], [10 * MIN, all, env], [2 * HOUR, st, env]];
  const now = sum(play(3, ws, { steps: gone }), [H, J, X]);
  T(tag2 + ': voided with nobody convicted (the mark kept on the entry), nobody consoled (no record left)',
    now.ok && now.processed && now[X].lv === 0 && [H, J, X].every(s => now[s].xp.length === 0) && /nobody convicted, 1 spared/.test(now.verdict), JSON.stringify(now));
  withMutant(['mark'], tag2, (sc) => {
    const old = sum(play(3, ws, { steps: gone }, sc), [H, J, X]);
    T(tag2 + ' mutant (the mark not kept): X convicted', old.ok && old.processed && old[X].lv === 1, JSON.stringify(old));
  });
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (host-header-sanity) ===');
process.exit(failN === 0 ? 0 : 1);
