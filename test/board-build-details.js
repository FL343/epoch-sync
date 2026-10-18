'use strict';
// ============================================================
// board-build-details.js - client knife 3.5d (2026-09-10): every endless ladder row carries the perk build of its best run.
// ============================================================
// details[0] has always been the exact best-run score (the packed tiebreak is /1000-saturated); details[1] is now the
// perk build word of that run (3 slots x [id 7 | lv 2]; 0 = pre-perk writer / warm-up). The hub draws it as three perk
// icons next to the row. Trust: the build comes from the same replay-verified record that produced the score (perk_forge
// already rejected forged builds before the row is touched) and the client never writes it. Being public, the column
// doubles as build-distribution data for balancing. This test pins the WIRING: all six best-row pools (casual 2P/trio,
// solo / duo / trio competitive, each lifetime + season) carry `build`, and all seven SetLeaderboardScore writes on
// endless ladders send [score, build] -- a pool that forgets `build` would silently write 0 (icons vanish), a write that
// keeps the 1-int details would silently drop the column.
const fs = require('fs');
const path = require('path');
const assert = (label, cond) => { if (cond) console.log('  ok    ' + label); else { console.log('  FAIL  ' + label); process.exitCode = 1; } };

const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');

console.log('== endless ladder details[1] = perk build word (knife 3.5d) ==');
// six best-row pools
assert('solo competitive lifetime + season pools carry build (f.build)',
  /changedComp\[sid\] = \{ s: packed, ts: f\.score \| 0, build: f\.build >>> 0 \};/.test(src)
  && /changedCompSeason\[sid\] = \{ s: packed, ts: f\.score \| 0, build: f\.build >>> 0 \};/.test(src));
assert('team competitive (duo / trio) lifetime + season pools carry build (f.build)',
  /fam\.changed\[sid\] = \{ s: packed, ts: teamT, build: f\.build >>> 0, team: rosterSids \};/.test(src)   // O207 (knife 5.1b): + the roster for the team block
  && /fam\.seasonChanged\[sid\] = \{ s: packed, ts: teamT, build: f\.build >>> 0, team: rosterSids \};/.test(src));
assert('casual co-op (2P / trio) lifetime + season pools carry build (t.build = consensus tail)',
  /bChanged\[sid\] = \{ s: packed, ts: teamScore, build: t\.build >>> 0, team: rosterSids \};/.test(src)
  && /bSeasonChanged\[sid\] = \{ s: packed, ts: teamScore, build: t\.build >>> 0, team: rosterSids \};/.test(src));
// nine ladder writes = [score, build] (2P / season / trio / trio-season / quad / quad-season + solo / solo-season / family); no endless write keeps the old 1-int details
const writes = (src.match(/postFormDetails\('\/ISteamLeaderboards\/SetLeaderboardScore\/v1\/'[^\n]*\);/g) || []);
// O207 (knife 5.1b): every endless ladder write goes through one writer, ladderDetails(w) = [w.ts | 0, w.build | 0] + the team block of a team row
const withBuild = writes.filter(l => /\}, ladderDetails\(w\)\);/.test(l));
assert('14 endless ladder writes send ladderDetails(w) (11 [ts, build] + 2 classic + 1 weekly cup board [O180]; found ' + withBuild.length + ' of ' + writes.length + ' SetLeaderboardScore details writes)', withBuild.length === 14);
assert('no endless ladder write builds its details inline any more (one writer: ladderDetails)', !writes.some(l => /\}, \[w\.ts \| 0, (w\.build \| 0|0)\]\);/.test(l)));
assert('ladderDetails = [w.ts | 0, w.build | 0] + the team block when the entry has a roster and the rollout gate is open', /function ladderDetails\(w\) \{ return \[w\.ts \| 0, w\.build \| 0\]\.concat\(w\.team && V51B \? teamBlock\(w\.team\) : \[\]\); \}/.test(src));
assert('no endless ladder write still sends the 1-int details [w.ts | 0]', !/\}, \[w\.ts \| 0\]\);/.test(src));
// the build word is a real number even for pre-perk writers: the tail parser defaults absent ints to 0 and the pools use >>> 0
assert('pools coerce with >>> 0 (absent tail build -> 0, never undefined/NaN in details)', !/build: (f|t)\.build \}/.test(src));
// the trust story is documented next to the writes (the hub reads this column as a fact)
assert('write-site comment documents details[1] = build (trust + balance data axis)', /\[1\] = the perk build word of that best run/.test(src));

if (process.exitCode) { console.log('FAIL (board-build-details)'); } else console.log('ALL PASS (board-build-details)');
