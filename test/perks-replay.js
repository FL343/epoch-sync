'use strict';
// Unit tests for perks.js: the endless perk build replay.
//   - the vendored client table + RNG load and derive deterministically
//   - an honest pick log (choices taken from the derived candidates) replays to exactly its build
//   - fail-closed rejects: forged build word, build without picks, malformed log, more draws than
//     the depth allows, a log that does not extend the run's previous log (perk_chain)
//   - PERKS_CFG mirrors the vendor's fallback constants (companion-repo lockstep re-pins the client side)
//   node test/perks-replay.js
const path = require('path');
const perks = require(path.join(__dirname, '..', 'perks.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

console.log('== vendor load ==');
const P = perks.load();
assert('vendor exposes the replay surface', typeof P.candidates === 'function' && typeof P.replay === 'function' && typeof P.packPicks === 'function' && typeof P.seasonSeed === 'function');
eq('table size (11 first-release perks + 6 behaviour perks + 3 contracts, knife 3.5c1)', P.list().length, 20);
eq('PERKS_CFG == vendor fallback constants', perks.PERKS_CFG, P.FALLBACK);
eq('vendor cfg() reads PERKS_CFG', [P.drawEvery(), P.gateEvery(), P.maxDraws()], [perks.PERKS_CFG.DRAW_EVERY, perks.PERKS_CFG.GATE_EVERY, perks.PERKS_CFG.MAX_DRAWS]);
{
  const s = P.seasonSeed(1);
  const a = P.candidates(s, 0, 0, 0, 0, { mode: 'solo' }), b = P.candidates(s, 0, 0, 0, 0, { mode: 'solo' });
  eq('candidates are a pure derivation (same inputs, same cards)', a.map(c => [c.id, c.lv]), b.map(c => [c.id, c.lv]));
  assert('a different season seed changes the draw somewhere in the first 8 draws', (() => {
    const s2 = P.seasonSeed(2);
    for (let k = 0; k < 8; k++) {
      const x = P.candidates(s, P.depthOfDraw(k), 0, k, 0, { mode: 'solo' }).map(c => c.id).join(',');
      const y = P.candidates(s2, P.depthOfDraw(k), 0, k, 0, { mode: 'solo' }).map(c => c.id).join(',');
      if (x !== y) return true;
    }
    return false;
  })());
}

// honest log: choose card `choice` at every draw k < n over season `season`, return the tail fields
function honest(season, n, choiceFn, mode) {
  const s = P.seasonSeed(season);
  let build = 0, skipBank = 0, seen = 0;   // seen = contract offers so far (the client counts them the same way: PERKS.contractsSeenBefore)
  const arr = P.emptyPicks();
  let contractAt = -1;
  for (let k = 0; k < n; k++) {
    const cards = P.candidates(s, P.depthOfDraw(k), build, k, skipBank, { mode: mode || 'solo', contractsSeen: seen });
    if (P.hasContract(cards)) { seen++; if (contractAt < 0) contractAt = k; }
    const choice = choiceFn ? choiceFn(k, cards) : 1;
    arr[k] = choice;
    if (choice === 5) { skipBank = 1; continue; }
    build = P.applyPick(build, cards, choice);
    skipBank = 0;
  }
  const pk = P.packPicks(arr);
  return { build: build >>> 0, picksLo: pk.lo, picksHi: pk.hi, seasonId: season, arr, contractsSeen: seen, contractAt };
}

console.log('== contract cards (2026-09-09) ==');
{
  // a season where a contract shows up on the free card (index 2) at some draw k >= CONTRACT_MIN_DRAW; the chooser takes it (choice 3)
  let found = null;
  for (let season = 1; season < 200 && !found; season++) {
    const h = honest(season, 8, (k, cards) => (P.hasContract(cards) ? 3 : 1));
    if (h.contractAt >= 0) found = { season, h };
  }
  assert('a contract offer exists within 200 seasons x 8 draws', !!found, 'none');
  if (found) {
    const { season, h } = found;
    const f = Object.assign({ endDepth: 40 }, h);
    const v = perks.verifyPerkPicks(f, null, 1);
    assert('honest log that picked a contract replays to its build (offer counted the same way)', v.ok === true && v.build === h.build, JSON.stringify(v));
    assert('the contract never appears before CONTRACT_MIN_DRAW', h.contractAt >= perks.PERKS_CFG.CONTRACT_MIN_DRAW, 'at=' + h.contractAt);
    assert('at most CONTRACT_MAX offers per run', h.contractsSeen <= perks.PERKS_CFG.CONTRACT_MAX, 'seen=' + h.contractsSeen);
    // forged: claim the contract's build after picking card 3 at draw 0 (no contract can be offered there) -> the replay lands elsewhere
    const early = P.emptyPicks(); early[0] = 3;
    const pk = P.packPicks(early);
    const vf = perks.verifyPerkPicks({ build: h.build, picksLo: pk.lo, picksHi: pk.hi, seasonId: season, endDepth: 40 }, null, 1);
    assert('forged early contract (draw 0, card 3) -> perk_forge (build-mismatch or pick-range)', vf.ok === false && vf.reason === 'perk_forge', JSON.stringify(vf));
  }
}

console.log('== verifyPerkPicks ==');
{
  eq('no build, no picks -> ok (pre-perk / warm-up records)', perks.verifyPerkPicks({ build: 0, picksLo: 0, picksHi: 0, seasonId: 1, endDepth: 12 }, null, 1), { ok: true, n: 0, build: 0 });
  eq('missing fields -> ok (legacy tails read as zeros)', perks.verifyPerkPicks({}, null, 2).ok, true);
  const h3 = honest(1, 3);
  const f3 = Object.assign({ endDepth: 15 }, h3);   // draws at depth 5 / 10 / 15 (no start draw)
  const v3 = perks.verifyPerkPicks(f3, null, 1);
  assert('honest 3-draw log replays to its build (solo pool)', v3.ok === true && v3.n === 3 && v3.build === h3.build, JSON.stringify(v3));
  assert('honest build is non-empty', h3.build !== 0);
  eq('forged build word (any other valid build) -> perk_forge build-mismatch', perks.verifyPerkPicks(Object.assign({}, f3, { build: honest(2, 3).build === h3.build ? honest(3, 3).build : honest(2, 3).build }), null, 1), { ok: false, reason: 'perk_forge', why: 'build-mismatch' });
  eq('build without picks -> perk_forge', perks.verifyPerkPicks({ build: h3.build, picksLo: 0, picksHi: 0, seasonId: 1, endDepth: 10 }, null, 1).why, 'build-without-picks');
  eq('structurally invalid build word (lv 0 slot bits / high bits) -> perk_forge build-shape', perks.verifyPerkPicks(Object.assign({}, f3, { build: 0x8000000 | h3.build }), null, 1).why, 'build-shape');
  {
    const gap = P.emptyPicks(); gap[0] = 1; gap[2] = 1;   // hole in the log
    const pk = P.packPicks(gap);
    eq('malformed log (gap) -> perk_forge picks-shape', perks.verifyPerkPicks({ build: 0, picksLo: pk.lo, picksHi: pk.hi, seasonId: 1, endDepth: 10 }, null, 1).why, 'picks-shape');
  }
  eq('more draws than the depth allows (3 draws, depth 5 allows 1) -> perk_forge picks-count', perks.verifyPerkPicks(Object.assign({}, f3, { endDepth: 5 }), null, 1).why, 'picks-count@3');
  eq('exactly the allowed draws at a checkpoint depth (3 draws, depth 15) -> ok; depth 14 allows 2 -> picks-count', [perks.verifyPerkPicks(Object.assign({}, f3, { endDepth: 15 }), null, 1).ok, perks.verifyPerkPicks(Object.assign({}, f3, { endDepth: 14 }), null, 1).why], [true, 'picks-count@3']);
  eq('depth 0 allows no draw at all (no start draw): one pick at depth 4 -> picks-count', perks.verifyPerkPicks(Object.assign({}, honest(1, 1), { endDepth: 4 }), null, 1).why, 'picks-count@1');
  assert('the season seed is part of the replay (the same log under other seasons reproduces a different build for most of them)', (() => {
    let differ = 0;
    for (let s = 2; s <= 13; s++) if (!perks.verifyPerkPicks(Object.assign({}, f3, { seasonId: s }), null, 1).ok) differ++;
    return differ >= 6;
  })());
  // skip / banked 4th card
  const hs = honest(1, 3, (k) => (k === 0 ? 5 : (k === 1 ? 4 : 1)));
  const vs = perks.verifyPerkPicks(Object.assign({ endDepth: 15 }, hs), null, 1);
  assert('skip then banked 4th card replays', vs.ok === true && vs.n === 3, JSON.stringify(vs));
  {
    const arr = P.emptyPicks(); arr[0] = 4;   // 4th card without a banked skip
    const pk = P.packPicks(arr);
    eq('4th card without a prior skip -> perk_forge pick-4-nobank', perks.verifyPerkPicks({ build: 0, picksLo: pk.lo, picksHi: pk.hi, seasonId: 1, endDepth: 5 }, null, 1).why, 'pick-4-nobank@0');
  }
  // co-op pool: the same log may draw different cards (pool differs by mode) -> replay must use the seat-count pool
  const hc = honest(1, 3, null, 'coop');
  assert('shared team build replays under the co-op pool (pc 2)', perks.verifyPerkPicks(Object.assign({ endDepth: 15 }, hc), null, 2).ok === true);
  eq('modeOf: 1 seat solo, 2+ seats co-op', [perks.modeOf(1), perks.modeOf(2), perks.modeOf(3)], ['solo', 'coop', 'coop']);
}

console.log('== season window (client knife 3.5d: table freeze by season) ==');
{
  // A table entry may carry seasons {from, until}; candidates filter the pool by the record's seasonId, so a perk that opens
  // in season 2 is never offered while replaying a season-1 log -- and a season-2 log that picked it replays only as season 2.
  const saved = P.list();
  const extra = { id: 90, key: 'nextSeasonOnly', axis: 'value', rarity: 'common', scope: 'self', modes: { solo: true, coop: true, duel: true }, rollable: true, icon: 'x', seasons: { from: 2 }, lv: [{}, {}, {}], p: [{}, {}, {}] };
  P._setTableForTest(saved.concat([extra]));
  const offered = (seasonId) => { for (let k = 0; k < 12; k++) for (const seed of [1, 2, 3]) { if (P.candidates(P.seasonSeed(seed), P.depthOfDraw(k), 0, k, 0, { mode: 'solo', seasonId }).some(c => c.id === 90)) return true; } return false; };
  eq('seasons.from = 2: never offered at season 1, offered at season 2', [offered(1), offered(2)], [false, true]);
  eq('vendor exposes inSeason / poolSig (the client pins the pool signature per TABLE_VER)', [typeof P.inSeason, typeof P.poolSig], ['function', 'function']);
  // in production the season seed IS seasonSeed(seasonId) (verifyPerkPicks derives it from the record) -> build the log the same way
  let log = null;
  outer: for (const S of [2, 3, 4, 5]) {
    let build = 0, skipBank = 0, seen = 0; const arr = P.emptyPicks();
    for (let k = 0; k < 8; k++) {
      const cards = P.candidates(P.seasonSeed(S), P.depthOfDraw(k), build, k, skipBank, { mode: 'solo', seasonId: S, contractsSeen: seen });
      if (P.hasContract(cards)) seen++;
      const idx = cards.findIndex(c => c.id === 90), ch = idx >= 0 ? idx + 1 : 1;
      arr[k] = ch; build = P.applyPick(build, cards, ch); skipBank = 0;
      if (idx >= 0) { log = { S, arr, build, n: k + 1 }; break outer; }
    }
  }
  assert('a season >= 2 log that picks the new perk can be built', !!log);
  if (log) {
    const pk = P.packPicks(log.arr);
    const f = { build: log.build >>> 0, picksLo: pk.lo, picksHi: pk.hi, endDepth: P.depthOfDraw(log.n - 1) };
    // the record's seasonId drives the window: verifyPerkPicks passes it into the replay (the same log claimed for season 1 draws
    // from the smaller pool AND from season 1's seed -> cannot reproduce the build)
    assert('replayed as its own season (' + log.S + ') -> ok', perks.verifyPerkPicks(Object.assign({ seasonId: log.S }, f), null, 1).ok === true);
    assert('the same log claimed for season 1 -> perk_forge', perks.verifyPerkPicks(Object.assign({ seasonId: 1 }, f), null, 1).reason === 'perk_forge');
  }
  P._setTableForTest(null);
  eq('table restored', P.list().length, 20);
}

console.log('== perk_chain (run memory) ==');
{
  const h2 = honest(1, 2), h3 = honest(1, 3);
  assert('the 3-draw log extends the 2-draw log', perks.isPrefix(h2.picksLo, h2.picksHi, h3.picksLo, h3.picksHi) === true);
  const run = { pk: { lo: h2.picksLo, hi: h2.picksHi } };
  assert('next segment extending the previous log -> ok', perks.verifyPerkPicks(Object.assign({ endDepth: 15 }, h3), run, 1).ok === true);
  assert('same log again (overlap retry) -> ok', perks.verifyPerkPicks(Object.assign({ endDepth: 10 }, h2), run, 1).ok === true);
  const other = honest(1, 3, (k) => (k === 0 ? 2 : 1));   // first choice differs
  eq('a log that rewrites an earlier pick -> perk_chain', perks.verifyPerkPicks(Object.assign({ endDepth: 15 }, other), run, 1), { ok: false, reason: 'perk_chain', why: 'prefix' });
  eq('a shrunk log (perks vanished) -> perk_chain', perks.verifyPerkPicks({ build: 0, picksLo: 0, picksHi: 0, seasonId: 1, endDepth: 10 }, run, 1).reason, 'perk_chain');
  assert('no memory (first segment / casual) -> chain rule not applied', perks.verifyPerkPicks(Object.assign({ endDepth: 15 }, other), null, 1).ok === true);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' -- ' + failN + ' fail (perks-replay) ===');
if (failN) process.exit(1);
