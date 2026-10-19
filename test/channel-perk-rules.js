'use strict';
// ============================================================
// channel-perk-rules.js -- perk candidate rules dispatch by release channel (knife 5.10a, 2026-10-19)
// ============================================================
// The EA appid replays pick logs with candidate rules v2 from its first season; the playtest / demo appids keep v1 forever
// (the vendor's CAND_RULES). This pins:
//   [1] validate.js: PERK_CH = KEY_CHANNEL || (PT_MODE ? 'playtest' : 'ea'), and all three endless lanes pass it
//   [2] seedcap.js: PERK_CH comes from SEEDCAP_CHANNEL (never v.KEY_CHANNEL: the seedcap jobs set no PT_MODE -> 'ea' everywhere),
//       tails carry the run seed, buildAt / buildsOf get the channel
//   [3] behaviour: a v2 (EA) log verifies on 'ea' and is rejected on 'demo' / 'playtest' / no channel; a v1 log verifies on
//       'demo' / 'playtest' / no channel and is rejected on 'ea'; a v2 log replayed with the wrong run seed is rejected
// ============================================================
const fs = require('fs');
const path = require('path');
const perks = require('../perks.js');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (m, c) => (c ? ok(m) : bad(m));
const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

console.log('=== [1] validate.js channel wiring ===');
{
  const s = src('validate.js');
  assert('PERK_CH derives from KEY_CHANNEL (v1 when a PT job cannot tell its channel)', /const PERK_CH = KEY_CHANNEL \|\| \(PT_MODE \? 'playtest' : 'ea'\);/.test(s));
  assert('solo / team comp / casual co-op lanes all pass PERK_CH', (s.match(/perks\.verifyPerkPicks\([^\n]*, PERK_CH\)/g) || []).length === 3 && !/perks\.verifyPerkPicks\([^\n]*, (1|pc7)\);/.test(s));
}

console.log('=== [2] seedcap.js channel wiring ===');
{
  const s = src('seedcap.js');
  assert('PERK_CH from SEEDCAP_CHANNEL (empty = v1)', /const PERK_CH = SEEDCAP_CHANNEL \|\| 'playtest';/.test(s));
  assert('seedcap never reads v.KEY_CHANNEL for perk rules', !/KEY_CHANNEL[^\n]*perks\./.test(s) && !/perks\.[a-zA-Z]+\([^\n]*v\.KEY_CHANNEL/.test(s));
  assert('buildAt / buildsOf get the channel', /perks\.buildAt\(tail, tail\.startDepth \| 0, pc, PERK_CH\)/.test(s) && /perks\.buildsOf\(tail, pc, PERK_CH\)/.test(s));
  assert('tails carry the run seed (d[4])', /if \(t && t\.runSeed == null\) t\.runSeed = d\[4\] \| 0;/.test(s));
  const wf = src('.github/workflows/seedcap.yml');
  assert('the three seedcap jobs set SEEDCAP_CHANNEL ea / playtest / demo', /SEEDCAP_CHANNEL: ea/.test(wf) && /SEEDCAP_CHANNEL: playtest/.test(wf) && /SEEDCAP_CHANNEL: demo/.test(wf));
}

console.log('=== [3] replay behaviour by channel ===');
{
  const P = perks.load();
  assert('vendor knows the rule table (ea = 2, playtest / demo / none = 1)', P.rulesVer('ea', 0) === 2 && P.rulesVer('playtest', 0) === 1 && P.rulesVer('demo', 3) === 1 && P.rulesVer(undefined, 0) === 1);
  // build a pick log the way the client does (drawCtxAt + candidates with the same opts), for a channel
  const makeLog = (ch, seasonId, runSeed, n, mode) => {
    const sSeed = P.seasonSeed(seasonId), picks = P.emptyPicks();
    let build = 0;
    for (let k = 0; k < n; k++) {
      const base = { mode, seasonId, channel: ch, runSeed };
      const ctx = P.drawCtxAt(sSeed, picks, k, base);
      const cards = P.candidates(sSeed, P.depthOfDraw(k), ctx.build, k, ctx.skipBank, Object.assign({}, base, { contractsSeen: ctx.contractsSeen, prevShown: ctx.prevShown }));
      const choice = 1 + ((k * 7 + runSeed) >>> 0) % cards.length;
      picks[k] = choice;
      build = P.applyPick(ctx.build, cards, choice);
    }
    const pk = P.packPicks(picks);
    return { build: build >>> 0, picksLo: pk.lo, picksHi: pk.hi, seasonId, endDepth: P.depthOfDraw(n - 1), runSeed };
  };
  let v2ok = 0, v2demo = 0, v2none = 0, v2seed = 0, v1ok = 0, v1ea = 0, N = 0;
  for (let i = 0; i < 40; i++) {
    const seasonId = i % 3, runSeed = (i * 2654435761) | 0, mode = (i & 1) ? 'coop' : 'solo', pc = (i & 1) ? 2 : 1, n = 3 + (i % 6);
    const f2 = makeLog('ea', seasonId, runSeed, n, mode);
    if (perks.verifyPerkPicks(f2, null, pc, 'ea').ok) v2ok++;
    if (perks.verifyPerkPicks(f2, null, pc, 'demo').ok) v2demo++;
    if (perks.verifyPerkPicks(f2, null, pc).ok) v2none++;
    if (perks.verifyPerkPicks(Object.assign({}, f2, { runSeed: runSeed ^ 0x5a5a5a5a }), null, pc, 'ea').ok) v2seed++;
    const f1 = makeLog('demo', seasonId, runSeed, n, mode);
    if (perks.verifyPerkPicks(f1, null, pc, 'demo').ok && perks.verifyPerkPicks(f1, null, pc, 'playtest').ok && perks.verifyPerkPicks(f1, null, pc).ok) v1ok++;
    if (perks.verifyPerkPicks(f1, null, pc, 'ea').ok) v1ea++;
    N++;
  }
  assert('EA (v2) logs verify on the EA job (' + v2ok + '/' + N + ')', v2ok === N);
  assert('the same EA logs are rejected on the demo job (' + v2demo + '/' + N + ' slipped) and with no channel (' + v2none + ')', v2demo <= 1 && v2none <= 1);
  assert('EA logs replayed with a different run seed are rejected (' + v2seed + '/' + N + ' slipped)', v2seed <= 2);
  assert('demo / playtest (v1) logs verify on demo, playtest and no-channel jobs (' + v1ok + '/' + N + ')', v1ok === N);
  assert('v1 logs are rejected on the EA job (' + v1ea + '/' + N + ' slipped)', v1ea <= 1);
  // buildAt on the EA job reproduces the partial build of a v2 log
  const f = makeLog('ea', 1, 12345, 6, 'solo');
  const r = perks.buildAt(f, f.endDepth, 1, 'ea');
  assert('buildAt(ea) on a v2 log = the final build', r.ok && r.build === f.build);
  const rl = perks.buildsOf(f, 1, 'ea');
  assert('buildsOf(ea) on a v2 log ends at the final build', rl.ok && rl.builds.length === 6 && rl.builds[5] === f.build);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (channel-perk-rules) ===');
if (failN) process.exit(1);
