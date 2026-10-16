'use strict';
// O480 R1 (pseudo-realtime ladder): the job's pulse row.
// Each channel app id carries one cron_pulse row: score = the unix minute a run reached its end, details [0xCE, RULES_VER].
// A client reads it on idle screens -- a pulse a few ticks old means the job is behind, a RULES_VER other than its own means
// the rules moved since its build: in both cases its points show "to be confirmed" instead of a value that may be wrong.
//   [1] codec: pulseDetails / pulseOf; another magic or no details -> null
//   [2] a quiet run (no consistent match) writes the pulse: the version_gate account carries it, the board is created on the
//       first run (trusted writes), score = this minute, details [0xCE, RULES_VER]
//   [3] the row's own account carries it once it stands (no version_gate read needed), TIERCUT_CARRIER_SID wins over both
//   [4] the main path (a match settles) writes it too, after the points writes
//   [5] no carrier account (no version_gate, no row, no env): nothing written, no board created, the run still succeeds
//   [6] a sandbox run (test shard prefix) writes cron_pulse_test; CRON_PULSE_LB names it explicitly; a dry run writes nothing
//   [7] the playtest channel (PT_MODE) writes it as well (one pulse per channel)
//   [8] wiring: every successful exit path writes it (the two quiet returns and the main path end), a failing run never
//       reaches it
const path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const PP = require(path.join(H.ROOT, 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

console.log('=== the cron pulse row (O480) ===');
// ---- [1] codec ----
T('[1] pulseDetails = [0xCE, RULES_VER]', J(PP.pulseDetails()) === J([0xCE, PP.RULES_VER]) && PP.PULSE_MAGIC === 0xCE);
T('[1] pulseOf decodes a row', J(PP.pulseOf(29400000, [0xCE, 3])) === J({ minute: 29400000, rulesVer: 3 }));
T('[1] another magic or no details -> null', PP.pulseOf(1, [0xCD, 1]) === null && PP.pulseOf(1, []) === null && PP.pulseOf(1, null) === null);

const OPS = H.SID(4890), ME = H.SID(4891);
const VG = { id: 61, name: 'version_gate', entries: [{ steamID: OPS, score: 2026101601 }] };
const base = () => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
const findCreate = (r, name) => r.posts.filter((p) => /FindOrCreateLeaderboard/.test(p.url) && new RegExp('(^|&)name=' + name + '(&|$)').test(p.body));
const pulseWrites = (r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && H.postDetails(p.body) && H.postDetails(p.body)[0] === 0xCE)
  .map((p) => ({ sid: /steamid=([0-9]+)/.exec(p.body)[1], board: /leaderboardid=([0-9]+)/.exec(p.body)[1], score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) }));
const nowMin = () => Math.floor(Date.now() / 60000);

// ---- [2] a quiet run, carrier from version_gate, board created ----
{
  const t0 = nowMin();
  const r = H.runCron(H.shardBoards([], base().concat([VG])), null, null, null, 'cron-pulse');
  const w = pulseWrites(r);
  T('[2] the run succeeds on the quiet path', r.code === 0 && /no consistent matches/.test(r.out), r.out.slice(-400));
  T('[2] the cron_pulse board is created (trusted writes)', findCreate(r, 'cron_pulse').length === 1 && /onlytrustedwrites=1/.test(findCreate(r, 'cron_pulse')[0].body));
  T('[2] one pulse write by the version_gate account: score = this minute, details [0xCE, RULES_VER]', w.length === 1 && w[0].sid === OPS && w[0].score >= t0 && w[0].score <= nowMin()
    && J(w[0].details) === J([0xCE, PP.RULES_VER]), J(w));
  T('[2] logged and summarized', /cron pulse: cron_pulse = minute [0-9]+, rules [0-9]+/.test(r.out) && /cron pulse \(O480\) \| [0-9]+ \/ [0-9]+; [0-9]+ \|/.test(r.summary), r.summary.slice(-300));
}
// ---- [3] carrier from the row itself; TIERCUT_CARRIER_SID first ----
{
  const PULSE = { id: 62, name: 'cron_pulse', entries: [{ steamID: ME, score: 1, details: [0xCE, 0] }] };
  const r = H.runCron(H.shardBoards([], base().concat([PULSE])), null, null, null, 'cron-pulse');
  const w = pulseWrites(r);
  T('[3] the account already on the row carries it (no version_gate needed), the board found by name', w.length === 1 && w[0].sid === ME && w[0].board === '62' && findCreate(r, 'cron_pulse').length === 0, J(w));
  const r2 = H.runCron(H.shardBoards([], base().concat([PULSE, VG])), null, { TIERCUT_CARRIER_SID: OPS }, null, 'cron-pulse');
  T('[3] TIERCUT_CARRIER_SID wins', pulseWrites(r2).length === 1 && pulseWrites(r2)[0].sid === OPS, J(pulseWrites(r2)));
}
// ---- [4] the main path ----
{
  const A = H.SID(4892), B = H.SID(4893), MIN = 60000;
  const ros = [A, B], hash = 0x48C01, sc = [6000, 3000];
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat + 1, seat === 0, ros, sc) }));
  const pts = { id: 7, name: 'points', entries: [{ steamID: A, score: 2500 }, { steamID: B, score: 2400 }] };
  const boards = (recs) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, pts, { id: 8, name: 'cp_bank', entries: [] }, VG]);
  let state = null, last = null;
  for (const [ms, recs] of [[0, S], [5 * MIN, S.concat(R)], [6 * MIN, S.concat(R)], [6 * MIN, S.concat(R)]]) {
    last = H.runCron(boards(recs), state ? H.advance(state, ms) : null, null, null, 'cron-pulse');
    state = last.state;
    if (last.code !== 0) break;
  }
  const settledRun = [last].find((r) => r.posts.some((p) => /leaderboardid=7(&|$)/.test(p.body)));
  T('[4] a settling run writes the pulse after its points writes', last.code === 0 && pulseWrites(last).length === 1 && (!settledRun || (() => {
    const i7 = last.posts.findIndex((p) => /leaderboardid=7(&|$)/.test(p.body)), iP = last.posts.findIndex((p) => H.postDetails(p.body) && H.postDetails(p.body)[0] === 0xCE);
    return i7 >= 0 && iP > i7;
  })()), J(pulseWrites(last)));
}
// ---- [5] no carrier ----
{
  const r = H.runCron(H.shardBoards([], base()), null, null, null, 'cron-pulse');
  T('[5] no carrier: nothing written, no board created, the run succeeds', r.code === 0 && pulseWrites(r).length === 0 && findCreate(r, 'cron_pulse').length === 0
    && /cron pulse: no carrier account/.test(r.out), r.out.slice(-300));
}
// ---- [6] sandbox / explicit name / dry run ----
{
  const VGT = { id: 63, name: 'version_gate', entries: [{ steamID: OPS, score: 1 }] };
  const sb = H.runCron(H.shardBoards([], base().concat([VGT])), null, { LB_PREFIX: 'shard_test_', ALLOW_TEST: '1' }, null, 'cron-pulse');
  T('[6] a sandbox run (test shard prefix) writes cron_pulse_test', findCreate(sb, 'cron_pulse_test').length === 1 && pulseWrites(sb).length === 1 && !/non-test board cron_pulse/.test(sb.out), sb.out.slice(-400));   // (other boards of this bare fixture keep live names: refused, not the pulse's business)
  const ex = H.runCron(H.shardBoards([], base().concat([VG])), null, { CRON_PULSE_LB: 'pulse_x' }, null, 'cron-pulse');
  T('[6] CRON_PULSE_LB names the board', findCreate(ex, 'pulse_x').length === 1 && pulseWrites(ex).length === 1);
  const dry = H.runCron(H.shardBoards([], base().concat([VG])), null, { APPLY_MMR: '0' }, null, 'cron-pulse');
  T('[6] a dry run writes no pulse', dry.code === 0 && pulseWrites(dry).length === 0 && findCreate(dry, 'cron_pulse').length === 0);
}
// ---- [7] the playtest channel ----
{
  const pt = H.runCron(H.shardBoards([], [VG]), null, { PT_MODE: '1', RANKED_LB: '', LP_LB: '' }, null, 'cron-pulse');
  T('[7] PT_MODE writes its own pulse too', pt.code === 0 && pulseWrites(pt).length === 1 && J(pulseWrites(pt)[0].details) === J([0xCE, PP.RULES_VER]), pt.out.slice(-500));
}
// ---- [8] wiring ----
T('[8] both quiet returns write it before the supporter upkeep', (H.SRC.match(/await processChatMute\(\); await writePulse\(\); await processSupporters\(null, \[\]\); writeRunSummary\(\); return; \}/g) || []).length === 2);
T('[8] the main path writes it last, before the summary', /\n  await writePulse\(\);[^\n]*\n  writeRunSummary\(\);\n\}/.test(H.SRC));

console.log(failN ? ('cron-pulse: ' + failN + ' FAIL') : 'cron-pulse: all ok');
process.exit(failN ? 1 : 0);
