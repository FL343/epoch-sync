'use strict';
// Playtest channel (PT_MODE): board plan / forbidden set, starter-CP seeding, the narrowed
// match-type whitelist, and the structural skips (no rating/points/redeem surface). The mode
// flag is captured at module load, so channel-behavior cases run in child processes.
const path = require('path');
const fs = require('fs');
const cp = require('child_process');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { PT_MT_ALLOWED, PT_SEED_CP, PT_SHARD_COUNT, PT_MIRROR_LB, ptSeedCp, ptBoardPlan, appliesLp, SANITY } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const T = (label, cond) => { if (cond) ok(label); else bad(label); };

// ---- 1) whitelist invariants ----
eq('PT_MT_ALLOWED (lockstep: client quick=1/team1=3/team2=5/3V3=8 + endless=7 + private=10)', PT_MT_ALLOWED, [1, 3, 5, 7, 8, 10]);
for (const b of PT_MT_ALLOWED) T('base ' + b + ' never bears points (appliesLp false)', !appliesLp(b));
for (const b of PT_MT_ALLOWED) T('base ' + b + ' is a narrowing of the live whitelist', SANITY.MT_ALLOWED.indexOf(b) >= 0);
for (const b of [2, 4, 6]) T('ranked base ' + b + ' excluded on the channel', PT_MT_ALLOWED.indexOf(b) < 0);
eq('PT_SEED_CP default', PT_SEED_CP, 60);
eq('PT_SHARD_COUNT default (lockstep: client LEDGER_SHARDS)', PT_SHARD_COUNT, 50);
eq('mirror board name pinned', PT_MIRROR_LB, 'mirror_box');

// ---- 2) channel-mode sanityFlags (child process: PT_MODE is load-time) ----
function childFlags(mt, ptMode) {
  const script = [
    "const v=require(" + JSON.stringify(path.join(__dirname, '..', 'validate.js')) + ");",
    "const d=[0xB1,3," + mt + ",111,7,0,1,1,3,600,100,200,300,0];",
    "console.log(JSON.stringify(v.sanityFlags([{steamID:'76561198000000001',d:d,dispCode:0,roster:{}}])));",
  ].join('');
  const env = Object.assign({}, process.env);
  delete env.PT_MODE;
  if (ptMode) env.PT_MODE = '1';
  const out = cp.execFileSync(process.execPath, ['-e', script], { env }).toString().trim();
  return JSON.parse(out.split('\n').pop());
}
T('PT mode flags a ranked-typed record (mt=2 -> forgery by construction)', childFlags(2, true).indexOf('mt') >= 0);
T('PT mode flags ranked team (mt=4)', childFlags(4, true).indexOf('mt') >= 0);
T('PT mode admits quick (mt=1)', childFlags(1, true).indexOf('mt') < 0);
T('live mode still admits ranked (mt=2) — narrowing is channel-only', childFlags(2, false).indexOf('mt') < 0);

// ---- 3) starter-CP seeding ----
{
  const cpMap = { a: 120, b: 0, c: -40 }, changed = {};
  const n = ptSeedCp(cpMap, changed, ['a', 'b', 'c', 'd', 'e', 'd']);
  eq('seeds only first-seen (null entries)', n, 2);
  eq('new player seeded to the baseline', cpMap.d, PT_SEED_CP);
  eq('seed lands in the write pool', changed.e, PT_SEED_CP);
  T('existing balance untouched', cpMap.a === 120 && changed.a === undefined);
  T('zero balance is NOT first-seen (entry exists)', cpMap.b === 0 && changed.b === undefined);
  T('negative balance (kept debt) is NOT first-seen', cpMap.c === -40 && changed.c === undefined);
}

// ---- 4) board plan / forbidden set ----
const CFG = {
  prefix: 'rec_', shards: 50, xpLb: 'xpb', cpLb: 'cpb', endlessLb: 'enb', endlessTrioLb: 'enb3',
  trustLb: 'trb', reportLb: 'rpb', rankedLb: 'rkb', lpLb: 'lpb', redeemLb: 'rdb', grantLb: 'gtb', mirrorLb: 'mrb',
};
{
  const plan = ptBoardPlan([], CFG);
  eq('empty listing -> full surface provisioned', plan.create.length, 61);   // +1 knife-7 unmatched_box
  const byName = {}; for (const b of plan.create) byName[b.name] = b.trusted;
  T('all 50 shards planned client-writable', Array.from({ length: 50 }, (_, i) => byName['rec_' + i]).every(t => t === 0));
  for (const [n, t] of [['xpb', 1], ['cpb', 1], ['enb', 1], ['enb3', 1], ['version_gate', 1], ['gate_window', 1], ['pt_master', 1], ['trb', 1], ['rpb', 0], ['card_box', 0], ['unmatched_box', 0]])
    eq('plan ' + n + ' trusted=' + t, byName[n], t);
  eq('nothing forbidden on a clean app', plan.forbidden, []);
}
{
  const plan = ptBoardPlan(['rec_0', 'rec_7', 'xpb', 'gate_window', 'unrelated'], CFG);
  T('existing boards skipped (idempotent)', plan.create.every(b => ['rec_0', 'rec_7', 'xpb', 'gate_window'].indexOf(b.name) < 0));
  eq('plan size shrinks by the existing four', plan.create.length, 57);   // 61 - 4
}
{
  const plan = ptBoardPlan(['rkb', 'lpb', 'lpb_s3', 'rdb', 'gtb', 'mrb', 'lpbX', 'xpb'], CFG);
  eq('forbidden: rating + points (+season archive) + redeem/grant/mirror', plan.forbidden.sort(), ['gtb', 'lpb', 'lpb_s3', 'mrb', 'rdb', 'rkb'].sort());
  T('lookalike name not forbidden', plan.forbidden.indexOf('lpbX') < 0);
}
{
  const plan = ptBoardPlan([], { prefix: 'rec_', shards: 2, redeemLb: 'rdb', grantLb: 'gtb', mirrorLb: 'mrb' });
  T('unset optional names are simply skipped', plan.create.length === 2 + 5 && plan.forbidden.length === 0);   // 2 shards + version_gate + gate_window + pt_master + card_box + unmatched_box
}

// ---- 5) source pins (the structural skips must stay wired exactly where they are) ----
const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
const pin = (label, re) => T('pin: ' + label, re.test(src));
pin('sanity mt gate is channel-aware', /\(PT_MODE \? PT_MT_ALLOWED : SANITY\.MT_ALLOWED\)\.indexOf\(base\)/);
pin('rating board never resolved on the channel', /const rankedLb = PT_MODE \? null :/);
pin('rating board hard-fail gated', /if \(!rankedLb && !PT_MODE\)/);
pin('points season resolution skipped on the channel', /const lpCur = PT_MODE \? \{ name: null, id: null \} :/);
pin('TrueSkill/points settle block skipped wholesale', /playtest channel: no rating\/points surface \(lock layer 3\)[\s\S]{0,500}?if \(!PT_MODE\) \{/);
pin('redeem channel hard-disabled first', /const processRedeems = async \(cpVals\) => \{[\s\S]{0,300}?if \(PT_MODE\) return;/);
pin('confession strict gate channel-aware', /if \(!lpId0 && !PT_MODE\) strictBoard/);
pin('points-board strict gate channel-aware', /if \(!lpId && !PT_MODE\) \{ strictBoard/);
pin('env: rating/points names optional on the channel', /if \(!RANKED_LB && !PT_MODE\) missing\.push/);
pin('bootstrap refuses on forbidden boards', /forbidden board\(s\) exist on this app[\s\S]{0,200}?process\.exit\(1\)/);
pin('bootstrap create failure is fatal (fail-closed provisioning)', /playtest bootstrap: board create failed[\s\S]{0,120}?process\.exit\(1\)/);
pin('endless starter seed covers roster (debit targets)', /if \(PT_MODE\) ptSeedCp\(cp, changedCp, \[\.\.\.new Set\(rosterSids\.concat\(writerSids\)\)\]\)/);
pin('matchmade starter seed covers writers', /if \(PT_MODE && cpId\) ptSeedCp\(cp, changedCp, writerSids\)/);

// ---- 6) workflow pins (the job must actually run the channel it claims) ----
const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'playtest.yml'), 'utf8');
const wpin = (label, re) => T('workflow pin: ' + label, re.test(wf));
wpin('PT_MODE armed', /PT_MODE: '1'/);
wpin('own appid secret', /APPID: \$\{\{ secrets\.PLAYTEST_APPID \}\}/);
wpin('strict boards on', /STRICT_BOARDS: '1'/);
wpin('offset schedule (minute 3 of each 5)', /cron: '3-59\/5 \* \* \* \*'/);
wpin('own concurrency group', /group: playtest/);
for (const f of ['pt-processed', 'pt-leavers', 'pt-xp', 'pt-starts', 'pt-signals', 'pt-confessions'])
  wpin('disjoint state file ' + f, new RegExp(f + '\\.json'));
T('workflow pin: rating-side state never persisted', !/for f in[^\n]*pt-skill\.json/.test(wf) && !/for f in[^\n]*pt-groups\.json/.test(wf));
const fwf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'feedback.yml'), 'utf8');
T('feedback twin: playtest job with disjoint state', /playtest-feedback:/.test(fwf) && /FB_STATE_FILE: feedback-playtest\.json/.test(fwf) && /APPID: \$\{\{ secrets\.PLAYTEST_APPID \}\}/.test(fwf));
T('feedback twin: serialized after the main job', /needs: feedback/.test(fwf) && /always\(\)/.test(fwf));

console.log(failN ? ('FAIL x' + failN) : 'ALL OK');
process.exit(failN ? 1 : 0);
