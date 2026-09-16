'use strict';
// team classic (nostalgia) endless settle lane (client knife 3.9b N3, 2026-09-16): consensus segments flagged SEG_CLASSIC (no SEG_COMP)
//   settle on their own LIFETIME ladders by seat count (endless_classic_{duo,trio,quad}); guard rows on the family save boxes.
//   Rules: one life (no continue), no perks / rerolls (classic-perk), never SUSPENDED, span <= CKPT_EVERY, score cap = classicGoalFor(d, pc) x
//   SCORE_MULT (k = pc/2), chain keyed by roster set + runSeed (season 0 = lifetime), XP x CLASSIC.XP_MUL, no CP outputs.
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));
const { sanityFlags, decodeRoster, teamRunKey, soloChainPlan, classicGoalFor, packClassicScore, ptBoardPlan } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };
const assert = (label, cond) => (cond ? ok(label) : bad(label));

const SA = '76561198000000001', SB = '76561198000000002', SC = '76561198000000003', SD = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-7 record with the full 11-int tail (start/end/cont/tokens/season/flags/build/picksLo/picksHi/rerollLo/rerollHi)
function mk7(writer, seat, o) {
  o = o || {};
  const pc = o.pc == null ? 2 : o.pc;
  const scores = o.scores || [4000, 3500, 3000, 2500];
  const d = [0xB1, 3, 7, 222, o.runSeed == null ? 9 : o.runSeed, seat, 0, 0, pc, (o.dur == null ? 1200 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [SA, SB, SC, SD].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth == null ? 5 : o.endDepth | 0, o.cont | 0, o.tokens | 0, o.seasonId == null ? 1 : o.seasonId | 0,
    o.flags == null ? A.SEG_CLASSIC : o.flags | 0, o.build | 0, o.picksLo | 0, o.picksHi | 0, o.rerollLo | 0, o.rerollHi | 0);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: (o.disp == null ? 0 : o.disp) };
}
const pair = (o) => [mk7(SA, 0, o), mk7(SB, 1, o)];
const trio = (o) => [mk7(SA, 0, Object.assign({ pc: 3 }, o)), mk7(SB, 1, Object.assign({ pc: 3 }, o))];
const quad = (o) => [mk7(SA, 0, Object.assign({ pc: 4 }, o)), mk7(SB, 1, Object.assign({ pc: 4 }, o))];

console.log('=== team classic endless settle (consensus lane, SEG_CLASSIC; client knife 3.9b N3) ===');

console.log('-- constants + surface --');
eq('team classic lifetime ladders (client classicBoardName(false, 2..4))', [v.ENDLESS_LB_CLASSIC_DUO, v.ENDLESS_LB_CLASSIC_TRIO, v.ENDLESS_LB_CLASSIC_QUAD], ['endless_classic_duo', 'endless_classic_trio', 'endless_classic_quad']);
eq('team classic save boxes (guard saveBoardFor(pc, rules=2) / client classicSaveBoardName(test, pc))', [v.SAVE_BOX_LB_CLASSIC_DUO, v.SAVE_BOX_LB_CLASSIC_TRIO, v.SAVE_BOX_LB_CLASSIC_QUAD], ['endless_save_box_classic_duo', 'endless_save_box_classic_trio', 'endless_save_box_classic_quad']);
eq('team level 40s + XP x0.5 (client ENDLESS.CLASSIC)', [v.CLASSIC.LEVEL_S_TEAM, v.CLASSIC.XP_MUL], [40, 0.5]);
eq('classicGoalFor pc 2 = x1 / pc 3 = x1.5 (round-half-up) / pc 4 = x2', [classicGoalFor(1, 2), classicGoalFor(1, 3), classicGoalFor(1, 4), classicGoalFor(2, 3)], [650, 975, 1300, 1793]);
{
  const plan = ptBoardPlan([], { prefix: 'rec_', shards: 1, xpLb: 'xpb', cpLb: 'cpb', endlessLb: 'enb', endlessTrioLb: 'entb', trustLb: 'trb', reportLb: 'rpb', compLb: 'cmp', saveBoxLb: 'sbx',
    classicSoloLb: 'cls', saveBoxClassicLb: 'sbcl', classicDuoLb: 'cl2', saveBoxClassicDuoLb: 'sbcl2', classicTrioLb: 'cl3', saveBoxClassicTrioLb: 'sbcl3', classicQuadLb: 'cl4', saveBoxClassicQuadLb: 'sbcl4' });
  const byName = {}; for (const b of plan.create) byName[b.name] = b.trusted;
  eq('playtest plan provisions the classic ladders (trusted) + classic save boxes (client-writable) for all four seat counts', [byName.cls, byName.sbcl, byName.cl2, byName.sbcl2, byName.cl3, byName.sbcl3, byName.cl4, byName.sbcl4], [1, 0, 1, 0, 1, 0, 1, 0]);
}

console.log('-- consensus sanity (pc 2..4) --');
eq('clean classic duo segment -> []', sanityFlags(pair({ startDepth: 0, endDepth: 5, scores: [2600, 2200] })), []);
eq('clean classic trio segment -> []', sanityFlags(trio({ startDepth: 0, endDepth: 5, scores: [2600, 2200, 2000] })), []);
eq('clean classic quad segment -> []', sanityFlags(quad({ startDepth: 0, endDepth: 5, scores: [2600, 2200, 2000, 1900] })), []);
has('classic + COMP together -> flags (different lanes)', sanityFlags(pair({ flags: A.SEG_CLASSIC | A.SEG_COMP })), 'flags');
has('classic + SUSPENDED -> flags (a classic save is a checkpoint row, the run continues)', sanityFlags(pair({ flags: A.SEG_CLASSIC | A.SEG_SUSPENDED })), 'flags');
not('classic + FINAL legal', sanityFlags(pair({ flags: A.SEG_CLASSIC | A.SEG_FINAL })), 'flags');
not('classic + RESUMED at a non-checkpoint depth legal (purchase-cut row)', sanityFlags(pair({ flags: A.SEG_CLASSIC | A.SEG_RESUMED, startDepth: 3, endDepth: 5 })), 'flags');
has('classic continue nibble -> cont (one life)', sanityFlags(pair({ cont: 1 })), 'cont');
has('classic build word -> classic-perk', sanityFlags(pair({ build: 135 })), 'classic-perk');
has('classic pick log -> classic-perk', sanityFlags(pair({ picksLo: 7 })), 'classic-perk');
has('classic reroll bitmap -> classic-perk', sanityFlags(pair({ rerollLo: 8 })), 'classic-perk');
has('span > CKPT_EVERY -> span', sanityFlags(pair({ startDepth: 0, endDepth: 6 })), 'span');
has('non-final segment with a quit disposition -> disp', sanityFlags(pair({ disp: 5 })), 'disp');
not('final segment with a quit disposition legal', sanityFlags(pair({ flags: A.SEG_CLASSIC | A.SEG_FINAL, disp: 5 })), 'disp');
{
  const line2 = classicGoalFor(5, 2) * v.ENDLESS.SCORE_MULT, line3 = classicGoalFor(5, 3) * v.ENDLESS.SCORE_MULT;
  not('duo score at classicGoalFor(5,2) x SCORE_MULT legal', sanityFlags(pair({ startDepth: 0, endDepth: 5, scores: [line2, 0] })), 'score');
  has('duo score above the classic cap -> score', sanityFlags(pair({ startDepth: 0, endDepth: 5, scores: [line2 + 1, 0] })), 'score');
  not('trio cap scales x1.5 (round-half-up)', sanityFlags(trio({ startDepth: 0, endDepth: 5, scores: [line3, 0, 0] })), 'score');
  has('trio above its scaled cap -> score', sanityFlags(trio({ startDepth: 0, endDepth: 5, scores: [line3 + 1, 0, 0] })), 'score');
  assert('classic cap differs from the modern endless cap at the same depth (own curve)', line2 !== v.endlessGoalFor(5, 2) * v.ENDLESS.SCORE_MULT);
}

console.log('-- chain (solo planner, classicResume rule, lifetime key) --');
{
  const key = teamRunKey([SB, SA], 0, 9);
  eq('lifetime key = roster set (sorted) | season 0 | runSeed', key, teamRunKey([SA, SB], 0, 9));
  assert('season is NOT part of the classic team key (a classic run outlives seasons)', teamRunKey([SA, SB], 0, 9) !== teamRunKey([SA, SB], 1, 9));
  const st = { runs: {}, wait: {} };
  const now = 1e12;
  const p1 = soloChainPlan(st, key, { startDepth: 0, endDepth: 5, flags: A.SEG_CLASSIC }, 'm1', now);
  assert('fresh classic segment [0,5] plans ok', p1.ok === true);
  v.soloAdvance(st, key, { startDepth: 0, endDepth: 5, flags: A.SEG_CLASSIC }, 'm1', p1, now);
  const p2 = soloChainPlan(st, key, { startDepth: 5, endDepth: 7, flags: A.SEG_CLASSIC | A.SEG_FINAL }, 'm2', now);
  assert('final segment [5,7] chains', p2.ok === true);
  v.soloAdvance(st, key, { startDepth: 5, endDepth: 7, flags: A.SEG_CLASSIC | A.SEG_FINAL }, 'm2', p2, now);
  const p3 = soloChainPlan(st, key, { startDepth: 3, endDepth: 6, flags: A.SEG_CLASSIC | A.SEG_RESUMED }, 'm3', now);
  assert('classic RESUMED from a purchase-cut depth (3, not a checkpoint multiple) after FINAL = revive', p3.ok === true && p3.revive === true && p3.proven === 3);
  const p4 = soloChainPlan(st, key, { startDepth: 9, endDepth: 12, flags: A.SEG_CLASSIC | A.SEG_RESUMED }, 'm4', now);
  assert('classic RESUMED beyond the proven max waits for its chain (chain-gap)', p4.ok === null);
}

console.log('-- wiring pins (validate.js lane) --');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const lane = src.slice(src.indexOf('if (isClassicSeg) {'), src.indexOf('processed.add(c.m); settledEndlessClassic++;'));
  assert('classic branch sits inside the endless (type 7) block before the SEG_COMP lane', lane.length > 0 && src.indexOf('if (isClassicSeg) {') < src.indexOf('if ((t.flags | 0) & attest.SEG_COMP) {'));
  assert('outer casual/cp board gate is bypassed for classic segments', /if \(!isClassicSeg && \(!cpId \|\| !bId \|\| \(seasonId >= 1 && !bSeasonId\)\)\)/.test(src));
  assert('family picked by seat count (classicLadderOf: 4 quad / 3 trio / else duo)', /const classicLadderOf = \(pc\) => pc >= 4 \? classicFam\.QUAD : pc >= 3 \? classicFam\.TRIO : classicFam\.DUO;/.test(src) && /classicLadderOf\(pc7\)/.test(lane));
  assert('incomplete roster = sanity flag, not settled', /rosterSids\.length !== pc7/.test(lane) && /recordFlag\(signals, g, c\.m, nowMs\)/.test(lane));
  assert('chain keyed by teamRunKey(roster, season 0, runSeed) through the solo chain planner', /teamRunKey\(rosterSids, 0, g\[0\]\.d\[4\] \| 0\)/.test(lane) && /soloChainPlan\(soloState, key, f, c\.m, nowMs\)/.test(lane));
  assert('perk / reroll tail pinned to 0 in the plan input (sanity classic-perk already refused any other value)', /build: 0, picksLo: 0, picksHi: 0, seasonId: t\.seasonId \| 0, rerollLo: 0, rerollHi: 0/.test(lane));
  assert('pacing on the 40s team level', /endlessRequiredMs\(f, plan\.proven, CLASSIC\.LEVEL_S_TEAM\)/.test(lane));
  assert('no CP outputs in the lane (no milestones / resume fee / continue debit)', !/soloMilestones\(/.test(lane) && !/COMP\.RESUME_CP/.test(lane) && !/endlessDebits\(/.test(lane) && !/changedCp\[/.test(lane));
  assert('no perk replay in the lane (sanity zeroed the tail)', !/verifyPerkPicks\(/.test(lane));
  assert('ladder write = writers only, packClassicScore(endDepth, team bank), lifetime family pool (no season pool)', /packClassicScore\(f\.endDepth, teamK\)/.test(lane) && /famK\.changed\[sid\] = \{ s: packed, ts: teamK \}/.test(lane) && !/seasonChanged/.test(lane));
  assert('progress XP x CLASSIC.XP_MUL (from the proven depth on an overlapping retry)', /creditXpEndless\(g, \{ startDepth: Math\.max\(f\.startDepth \| 0, plan\.proven \| 0\), endDepth: f\.endDepth \| 0 \}, xp, changedXp, spSet, CLASSIC\.XP_MUL\)/.test(lane));
  assert('audit B-F5 reject-window writer skipped', /scPendingRestore && scPendingRestore\.sids\.indexOf\(sid\) >= 0/.test(lane));
  assert('sanity: CLASSIC bit legal, own arm (COMP|SUSPENDED refused / cont / classic-perk / span / disp) + classic cap', /attest\.SEG_RESUMED \| attest\.SEG_CLASSIC\)\) !== 0\) out\.push\('flags'\);/.test(src) && /else if \(fl & attest\.SEG_CLASSIC\) \{/.test(src) && /scoreCap = \(\(fl & attest\.SEG_CLASSIC\) \? classicGoalFor\(t\.endDepth, pc\) : endlessGoalFor\(t\.endDepth, pc\)\) \* ENDLESS\.SCORE_MULT;/.test(src));
  assert('main app provisions the classic surface up-front', /\[ENDLESS_LB_CLASSIC_SOLO, true\], \[SAVE_BOX_LB_CLASSIC, false\], \[ENDLESS_LB_CLASSIC_DUO, true\], \[SAVE_BOX_LB_CLASSIC_DUO, false\], \[ENDLESS_LB_CLASSIC_TRIO, true\], \[SAVE_BOX_LB_CLASSIC_TRIO, false\], \[ENDLESS_LB_CLASSIC_QUAD, true\], \[SAVE_BOX_LB_CLASSIC_QUAD, false\]/.test(src));
  assert('family boards resolved find-or-create (trusted ladders + client-writable save boxes), no season twin', /classicFam\[fam\] = \{ fam, low, name: lbName, id, best, complete, saveBoxId: sbId, changed: null \};/.test(src) && !/resolveSeasonBoard\(lr, ENDLESS_LB_CLASSIC_/.test(src));
  assert('classic save boxes are NOT in the past-season prune list (lifetime rows)', !/\[classicFam\.\w+\.saveBoxId, /.test(src) && !/\[classicSaveBoxId, /.test(src));
  assert('seedcap correction targets the classic family / solo classic ladder with the classic packing', /const clsC = !!\(\(tC\.flags \| 0\) & attest\.SEG_CLASSIC\);/.test(src) && /const packedC = clsC \? packClassicScore\(tC\.endDepth, teamScoreC\) : packEndlessScore\(tC\.endDepth, teamScoreC\);/.test(src));
  assert('reject-window snapshot covers the three classic family pools', /classicDuoBest: classicFam\.DUO\.best\[sid\]/.test(src) && /scPut\(classicFam\.TRIO\.best, sn\.sid, sn\.classicTrioBest\)/.test(src) && /scPut\(changedEndlessClassicQuad, sn\.sid, sn\.changedEndlessClassicQuad\)/.test(src));
  assert('write phase writes the three family pools with details [team bank, 0]', /for \(const fam of \['DUO', 'TRIO', 'QUAD'\]\) \{\s*\n\s*const F = classicFam\[fam\];/.test(src) && /leaderboardid: F\.id, steamid: sid, score: w\.s, scoremethod: 'ForceUpdate', format: 'json' \}, \[w\.ts \| 0, 0\]\)/.test(src));
  assert('run summary counts the lane', /RUN\.endlessClassic = settledEndlessClassic;/.test(src) && /team-classic\), voided/.test(src));
}

console.log(failN ? ('=== FAIL — ' + failN + ' fail (classic-team-settle) ===') : '=== ALL OK (classic-team-settle) ===');
process.exit(failN ? 1 : 0);
