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
//   [4] casual co-op (client knife 5.10c): replayOpts passes casual = casualOf(f, pc) (team comp tails carry SEG_COMP); a casual co-op
//       log verifies with casual flags and is rejected when the same log is replayed as a competitive segment, and the other way round
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
  // the whole draw context goes through (the client's _mkDraw does Object.assign({}, base, ctx) since knife 5.10c: hand-picking
  //   contractsSeen / prevShown dropped fusedSeen and made honest fusion logs fail their own replay)
  const makeLog = (ch, seasonId, runSeed, n, mode, casual, pickFn) => {
    const sSeed = P.seasonSeed(seasonId), picks = P.emptyPicks();
    let build = 0;
    for (let k = 0; k < n; k++) {
      const base = { mode, seasonId, channel: ch, runSeed, casual: !!casual };
      const ctx = P.drawCtxAt(sSeed, picks, k, base);
      const cards = P.candidates(sSeed, P.depthOfDraw(k), ctx.build, k, ctx.skipBank, Object.assign({}, base, ctx));
      const choice = pickFn ? pickFn(k, cards) : 1 + ((k * 7 + runSeed) >>> 0) % cards.length;
      picks[k] = choice;
      build = P.applyPick(ctx.build, cards, choice);
    }
    const pk = P.packPicks(picks);
    return { build: build >>> 0, picksLo: pk.lo, picksHi: pk.hi, seasonId, endDepth: P.depthOfDraw(n - 1), runSeed, picks };
  };
  let v2ok = 0, v2demo = 0, v2none = 0, v2seed = 0, v1ok = 0, v1ea = 0, N = 0;
  for (let i = 0; i < 40; i++) {
    const seasonId = i % 3, runSeed = (i * 2654435761) | 0, mode = (i & 1) ? 'coop' : 'solo', pc = (i & 1) ? 2 : 1, n = 3 + (i % 6);
    const f2 = makeLog('ea', seasonId, runSeed, n, mode, mode === 'coop');   // a co-op record without SEG_COMP = casual co-op (casualOf)
    if (perks.verifyPerkPicks(f2, null, pc, 'ea').ok) v2ok++;
    if (perks.verifyPerkPicks(f2, null, pc, 'demo').ok) v2demo++;
    if (perks.verifyPerkPicks(f2, null, pc).ok) v2none++;
    if (perks.verifyPerkPicks(Object.assign({}, f2, { runSeed: runSeed ^ 0x5a5a5a5a }), null, pc, 'ea').ok) v2seed++;
    const f1 = makeLog('demo', seasonId, runSeed, n, mode, mode === 'coop');
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

  console.log('=== [4] casual co-op (knife 5.10c) ===');
  const ps = src('perks.js');
  assert('replayOpts passes casual = casualOf(f, pc) (one function for every caller)',
    /function replayOpts\(f, pc, ch\) \{ return \{ mode: modeOf\(pc\), seasonId: \(f && f\.seasonId\) \| 0, channel: ch, runSeed: \(f && f\.runSeed\) \| 0, casual: casualOf\(f, pc\) \}; \}/.test(ps)
    && /function casualOf\(f, pc\) \{ return \(pc \| 0\) >= 2 && !\(\(\(f && f\.flags\) \| 0\) & require\('\.\/attest\.js'\)\.SEG_COMP\); \}/.test(ps));
  const attest = require('../attest.js');
  assert('casualOf: co-op without SEG_COMP = casual; team comp segment / solo = not', perks.casualOf({ flags: 0 }, 2) === true && perks.casualOf({}, 3) === true
    && perks.casualOf({ flags: attest.SEG_COMP }, 2) === false && perks.casualOf({ flags: 0 }, 1) === false && perks.casualOf({ flags: attest.SEG_CLASSIC }, 2) === true);
  let cOk = 0, cAsComp = 0, kOk = 0, kAsCas = 0, diffN = 0, NC = 0;
  for (let i = 0; i < 40; i++) {
    const seasonId = i % 3, runSeed = (i * 40503 + 7) | 0, n = 4 + (i % 6);
    const fc = makeLog('ea', seasonId, runSeed, n, 'coop', true), fk = makeLog('ea', seasonId, runSeed, n, 'coop', false);
    if (fc.picksLo !== fk.picksLo || fc.picksHi !== fk.picksHi || fc.build !== fk.build) diffN++;
    if (perks.verifyPerkPicks(Object.assign({}, fc, { flags: 0 }), null, 2, 'ea').ok) cOk++;
    if (perks.verifyPerkPicks(Object.assign({}, fc, { flags: attest.SEG_COMP }), null, 2, 'ea').ok) cAsComp++;
    if (perks.verifyPerkPicks(Object.assign({}, fk, { flags: attest.SEG_COMP }), null, 2, 'ea').ok) kOk++;
    if (perks.verifyPerkPicks(Object.assign({}, fk, { flags: 0 }), null, 2, 'ea').ok) kAsCas++;
    NC++;
  }
  assert('casual co-op logs verify as casual (' + cOk + '/' + NC + '), competitive co-op logs verify as competitive (' + kOk + '/' + NC + ')', cOk === NC && kOk === NC);
  // the same seeds draw differently in the two modes (the casual-only card changes the pool) -> a log replayed in the other mode fails
  //   unless that log never saw a difference (counted: the pools only differ where the casual-only card is eligible)
  assert('cross-mode replays fail wherever the two modes drew differently (casual as comp ' + cAsComp + ', comp as casual ' + kAsCas + ', logs that differ ' + diffN + '/' + NC + ')',
    diffN >= NC / 2 && cAsComp <= NC - diffN + 2 && kAsCas <= NC - diffN + 2);

  console.log('=== [5] fusion cards (knife 5.10c rule 12) ===');
  // chooser: take a fusion card whenever one is offered, else a recipe card, else card 1 -> some seeds end holding a fusion
  const fusionIds = P.list().filter(p => Array.isArray(p.fuse)).map(p => p.id | 0);
  const recipeIds = [].concat.apply([], P.list().filter(p => Array.isArray(p.fuse)).map(p => p.fuse.map(x => x | 0)));
  assert('the table has the two fusions and their four recipe cards', fusionIds.length === 2 && recipeIds.length === 4);
  const greedy = (k, cards) => {
    const fz = cards.findIndex(c => c.tag === 'fuse');
    if (fz >= 0) return fz + 1;
    const rc = cards.findIndex(c => recipeIds.indexOf(c.id | 0) >= 0 && c.tag !== 'replace');
    return rc >= 0 ? rc + 1 : 1;
  };
  let fused = 0, fOk = 0, fDemo = 0, fFlip = 0, FN = 0;
  for (let i = 0; i < 400 && fused < 12; i++) {
    const seasonId = i % 3, runSeed = (i * 2246822519 + 3) | 0, mode = (i & 1) ? 'coop' : 'solo', pc = (i & 1) ? 2 : 1;
    const f = makeLog('ea', seasonId, runSeed, 12, mode, mode === 'coop', greedy);
    FN++;
    const held = P.heldOf(f.build).map(x => x.id | 0);
    if (!held.some(id => fusionIds.indexOf(id) >= 0)) continue;
    fused++;
    if (perks.verifyPerkPicks(f, null, pc, 'ea').ok) fOk++;
    if (perks.verifyPerkPicks(f, null, pc, 'demo').ok) fDemo++;
    // the fusion pick is a card choice like any other: flip it to the next card and the replayed build differs from the claimed one
    const k = f.picks.findIndex((ch, kk) => kk < 12 && ch > 0 && (() => {
      const ctx = P.drawCtxAt(P.seasonSeed(seasonId), f.picks.map((x, j) => (j < kk ? x : 0)), kk, { mode, seasonId, channel: 'ea', runSeed, casual: mode === 'coop' });
      const cards = P.candidates(P.seasonSeed(seasonId), P.depthOfDraw(kk), ctx.build, kk, ctx.skipBank, Object.assign({ mode, seasonId, channel: 'ea', runSeed, casual: mode === 'coop' }, ctx));
      return cards[ch - 1] && cards[ch - 1].tag === 'fuse';
    })());
    if (k >= 0) {
      const alt = f.picks.slice(); alt[k] = alt[k] === 1 ? 2 : 1;
      const pk = P.packPicks(alt);
      if (perks.verifyPerkPicks(Object.assign({}, f, { picksLo: pk.lo, picksHi: pk.hi }), null, pc, 'ea').ok) fFlip++;
    }
  }
  assert('greedy logs reach a fusion on some seeds (' + fused + ' of ' + FN + ')', fused >= 4);
  assert('fusion logs replay on the EA job (' + fOk + '/' + fused + ')', fOk === fused);
  assert('fusion logs are rejected on the demo job (rules v1 has no fusions; ' + fDemo + ' slipped)', fDemo === 0);
  assert('a log whose fusion pick is flipped to another card no longer matches the claimed build (' + fFlip + ' slipped)', fFlip === 0);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (channel-perk-rules) ===');
if (failN) process.exit(1);
