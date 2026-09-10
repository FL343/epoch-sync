'use strict';
// Team competitive endless segments (2..3 seats): the consensus lane keyed by the tail's 6th int (SEG_COMP) --
//   tail decode, segment sanity (flags domain / one life / checkpoint stride), the roster-set chain key, the ladder
//   family surface (duo / trio ladders + save boxes), and the wiring pins of the lane in validate.js.
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));
const { ENDLESS_COMP_LB_DUO, ENDLESS_COMP_LB_TRIO, SAVE_BOX_LB_DUO, SAVE_BOX_LB_TRIO, ENDLESS_COMP_LB, SAVE_BOX_LB, COMP,
  teamRunKey, soloMsSlot, soloChainPlan, soloAdvance, sanityFlags, endlessTail, decodeRoster, pid, ptBoardPlan } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };

const SA = '76561198000000001', SB = '76561198000000002', SC = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-7 record with the 6-int tail: 10 header + pc scores + disp + 2*pc roster + 6 tail
function mk7(writer, seat, o) {
  o = o || {};
  const pc = o.pc == null ? 2 : o.pc;
  const scores = o.scores || [4000, 3500, 3000];
  const d = [0xB1, 3, 7, 222, o.runSeed == null ? 9 : o.runSeed, seat, 0, 0, pc, (o.dur == null ? 1200 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [SA, SB, SC].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth == null ? 5 : o.endDepth | 0, o.cont | 0, o.tokens | 0, o.seasonId == null ? 1 : o.seasonId | 0, o.flags == null ? A.SEG_COMP : o.flags | 0);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: (o.disp == null ? 0 : o.disp) };
}
const pair = (o) => [mk7(SA, 0, o), mk7(SB, 1, o)];

console.log('=== team competitive endless settle (consensus lane, SEG_COMP) ===');

console.log('-- constants + surface --');
eq('flag bits: comp=8 beside suspended/final/resumed', [A.SEG_COMP, A.SEG_SUSPENDED, A.SEG_FINAL, A.SEG_RESUMED], [8, 1, 2, 4]);
eq('ladder family names (lifetime; season twins via resolveSeasonBoard)', [ENDLESS_COMP_LB, ENDLESS_COMP_LB_DUO, ENDLESS_COMP_LB_TRIO], ['endless_comp_solo', 'endless_comp_duo', 'endless_comp_trio']);
eq('save box names (client-writable, guard-signed rows; the host\'s guard writes the team rows)', [SAVE_BOX_LB, SAVE_BOX_LB_DUO, SAVE_BOX_LB_TRIO], ['endless_save_box_solo', 'endless_save_box_duo', 'endless_save_box_trio']);
eq('milestone bitmap TTL outlives a season', COMP.MS_TTL_MS, 120 * 86400000);
{
  const plan = ptBoardPlan([], { prefix: 'r_', shards: 1, compDuoLb: ENDLESS_COMP_LB_DUO, saveBoxDuoLb: SAVE_BOX_LB_DUO, compTrioLb: ENDLESS_COMP_LB_TRIO, saveBoxTrioLb: SAVE_BOX_LB_TRIO });
  const byName = {}; for (const b of plan.create) byName[b.name] = b.trusted;
  eq('playtest / demo twins provision the family surface', [byName[ENDLESS_COMP_LB_DUO], byName[SAVE_BOX_LB_DUO], byName[ENDLESS_COMP_LB_TRIO], byName[SAVE_BOX_LB_TRIO]], [1, 0, 1, 0]);
}

console.log('-- tail decode --');
eq('6-int tail: flags read', endlessTail(mk7(SA, 0, { startDepth: 5, endDepth: 10, flags: A.SEG_COMP | A.SEG_SUSPENDED }).d),
  { startDepth: 5, endDepth: 10, continuesUsed: 0, tokensCp: 0, seasonId: 1, flags: 9, build: 0, picksLo: 0, picksHi: 0 });

console.log('-- sanity: casual vs competitive segment --');
not('casual co-op (flags 0) clean', sanityFlags(pair({ flags: 0, endDepth: 6 })), 'flags');
not('competitive checkpoint segment (5 levels) clean', sanityFlags(pair({ startDepth: 5, endDepth: 10 })), 'flags');
not('competitive checkpoint segment (5 levels) no span flag', sanityFlags(pair({ startDepth: 5, endDepth: 10 })), 'span');
not('competitive save segment (comp|suspended, 3 levels) clean', sanityFlags(pair({ startDepth: 10, endDepth: 13, flags: A.SEG_COMP | A.SEG_SUSPENDED })), 'flags');
not('competitive resumed final segment (comp|resumed|final) clean', sanityFlags(pair({ startDepth: 13, endDepth: 14, flags: A.SEG_COMP | A.SEG_RESUMED | A.SEG_FINAL })), 'flags');
has('unknown flag bit (16)', sanityFlags(pair({ flags: 16 })), 'flags');
has('suspended AND final together', sanityFlags(pair({ flags: A.SEG_COMP | A.SEG_SUSPENDED | A.SEG_FINAL })), 'flags');
has('casual record carrying a segment bit without SEG_COMP', sanityFlags(pair({ flags: A.SEG_FINAL })), 'flags');
has('competitive segment with a continue (one life)', sanityFlags(pair({ startDepth: 0, endDepth: 5, cont: 1 })), 'cont');
has('competitive segment longer than the checkpoint stride', sanityFlags(pair({ startDepth: 0, endDepth: COMP.CKPT_EVERY + 1 })), 'span');
not('casual session longer than the stride is fine (no segments)', sanityFlags(pair({ flags: 0, startDepth: 0, endDepth: 12 })), 'span');
has('trio competitive with a continue', sanityFlags([mk7(SA, 0, { pc: 3, cont: 0x100 }), mk7(SB, 1, { pc: 3, cont: 0x100 }), mk7(SC, 2, { pc: 3, cont: 0x100 })]), 'cont');

console.log('-- chain key: roster SET + season + runSeed --');
{
  const k1 = teamRunKey([SA, SB], 1, 777), k2 = teamRunKey([SB, SA], 1, 777);
  assert('order-free (same set, either seat order)', k1 === k2);
  assert('de-identified (pid, not the raw ids)', k1.indexOf(SA) < 0 && k1.indexOf(pid(SA)) >= 0 && /^T\|/.test(k1));
  assert('a different roster is a different run', teamRunKey([SA, SC], 1, 777) !== k1);
  assert('season / seed are part of the key', teamRunKey([SA, SB], 2, 777) !== k1 && teamRunKey([SA, SB], 1, 778) !== k1);
  // the chain rules are the solo ones: a resume needs a settled suspended segment ending at its start, once
  const st = { runs: {}, wait: {}, ms: {} };
  const T0 = 5000;
  let plan = soloChainPlan(st, k1, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'm0', T0);
  eq('fresh team run settles', plan, { ok: true, proven: 0 });
  soloAdvance(st, k1, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'm0', plan, T0);
  plan = soloChainPlan(st, k1, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'm1', T0);
  eq('save & quit segment chains on the checkpoint', plan, { ok: true, proven: 5 });
  soloAdvance(st, k1, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'm1', plan, T0);
  eq('save point remembered at its end depth', Object.keys(st.runs[k1].saves), ['8']);
  eq('a resume by a DIFFERENT roster never finds the chain (waits, then save-orphan)', soloChainPlan(st, teamRunKey([SA, SC], 1, 777), { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED }, 'mX', T0), { ok: null, reason: 'save-orphan' });
  plan = soloChainPlan(st, k1, { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED | A.SEG_FINAL }, 'm2', T0);
  eq('the same roster resumes once (consume = the save point)', plan, { ok: true, proven: 8, consume: '8' });
  soloAdvance(st, k1, { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED | A.SEG_FINAL }, 'm2', plan, T0);
  eq('anything after the final segment -> after-final (the run is over)', soloChainPlan(st, k1, { startDepth: 8, endDepth: 9, flags: A.SEG_COMP | A.SEG_RESUMED }, 'mY', T0), { ok: false, reason: 'after-final' });
  // audit E-G21: the save-reused rule on the TEAM lane, exercised for real (the old case above was already after-final) --
  //   a second run: checkpoint -> save at 8 -> resume once (not final) -> another resumed segment from the same save point
  const kR = teamRunKey([SA, SB], 1, 778);
  let pR = soloChainPlan(st, kR, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'n0', T0); soloAdvance(st, kR, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'n0', pR, T0);
  pR = soloChainPlan(st, kR, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'n1', T0); soloAdvance(st, kR, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'n1', pR, T0);
  pR = soloChainPlan(st, kR, { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED }, 'n2', T0);
  eq('team resume (not final) consumes the save point once', pR, { ok: true, proven: 8, consume: '8' });
  soloAdvance(st, kR, { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED }, 'n2', pR, T0);
  eq('replaying the same save row (a second resumed segment from depth 8) -> save-reused', soloChainPlan(st, kR, { startDepth: 8, endDepth: 11, flags: A.SEG_COMP | A.SEG_RESUMED }, 'n3', T0), { ok: false, reason: 'save-reused' });
  eq('the same resumed segment re-sighted is idempotent (no second consume)', soloChainPlan(st, kR, { startDepth: 8, endDepth: 10, flags: A.SEG_COMP | A.SEG_RESUMED }, 'n2', T0), { ok: true, proven: 8 });
}

console.log('-- audit 2026-09-06: chain head is a floor (B-F2) / save point merge keeps `by` (B-F6) --');
{
  const st = { runs: {}, wait: {}, ms: {} };
  const k = teamRunKey([SA, SB], 1, 900);
  const T0 = 7000;
  let plan = soloChainPlan(st, k, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'r0', T0); soloAdvance(st, k, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'r0', plan, T0);
  // a rolled-back save attempt whose residual suspended records (2 of 3 ends could not retract) settled first
  plan = soloChainPlan(st, k, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'r1', T0);
  eq('residual suspended segment settles (ghost save point at 8)', plan, { ok: true, proven: 5 });
  soloAdvance(st, k, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'r1', plan, T0);
  eq('the retry of the same attempt (same span, new key) is a replay -> chain-back', soloChainPlan(st, k, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'r1b', T0), { ok: false, reason: 'chain-back' });
  plan = soloChainPlan(st, k, { startDepth: 5, endDepth: 10, flags: A.SEG_COMP }, 'r2', T0);
  eq('the run continued: next checkpoint [5,10] overlaps the head 8 but reaches past it -> ok, proven = head, overlap noted', plan, { ok: true, proven: 8, overlap: 5 });
  soloAdvance(st, k, { startDepth: 5, endDepth: 10, flags: A.SEG_COMP }, 'r2', plan, T0);
  eq('head advanced to 10; the following segment chains normally', [st.runs[k].max, soloChainPlan(st, k, { startDepth: 10, endDepth: 15, flags: A.SEG_COMP }, 'r3', T0)], [10, { ok: true, proven: 10 }]);
  eq('a second depth-0 segment on the same run is still a restart replay', soloChainPlan(st, k, { startDepth: 0, endDepth: 5, flags: A.SEG_COMP }, 'rX', T0), { ok: false, reason: 'restart' });
  // B-F6: a second suspended segment ending at an already-consumed save point must not erase the consume mark
  st.runs[k].saves['8'].by = 'consumed-by-r9';
  soloAdvance(st, k, { startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED }, 'r1c', { ok: true, proven: 5 }, T0 + 1);
  eq('save point re-registration merges (keeps `by`, refreshes t)', [st.runs[k].saves['8'].by, st.runs[k].saves['8'].t], ['consumed-by-r9', T0 + 1]);
}

console.log('-- audit 2026-09-06: consensus grouping counts writers, solo lane picks pc=1 (D-F11 / B-F10 / E-G3) --');
{
  const { groupRecords, isEndlessMt } = v;
  const vecOf = (r) => { const pc = r.d[8] | 0; if (pc < 1 || pc > 8 || r.d.length < 10 + pc) return 'BAD(pc=' + pc + ')'; let vv = r.d.slice(10, 10 + pc); if (isEndlessMt(r.d[2] | 0)) { const at = 11 + 3 * pc; if (r.d.length < at + 4) return 'BAD(tail)'; vv = vv.concat(r.d.slice(at, at + Math.min(6, r.d.length - at))); } return JSON.stringify(vv); };
  const run = (recs) => groupRecords(recs, { vecOf, MAX_SEATS: 8 });
  const trio = (o) => [mk7(SA, 0, Object.assign({ pc: 3 }, o)), mk7(SB, 1, Object.assign({ pc: 3 }, o)), mk7(SC, 2, Object.assign({ pc: 3 }, o))];
  let g = run(trio({ startDepth: 5, endDepth: 10 }));
  eq('3 of 3 ends agree -> consistent', [g.consistent, g.lone, g.flagged, g.consistentMatches[0].g.length], [1, 0, 0, 3]);
  g = run(trio({ startDepth: 5, endDepth: 10 }).slice(0, 2));
  eq('2 of 3 ends agree (third silent) -> consistent (2 writers)', [g.consistent, g.lone, g.flagged], [1, 0, 0]);
  g = run(trio({ startDepth: 5, endDepth: 10 }).slice(0, 1));
  eq('1 of 3 -> lone (never settles)', [g.consistent, g.lone], [0, 1]);
  const dup = [mk7(SA, 0, { pc: 3, startDepth: 5, endDepth: 10 }), mk7(SA, 0, { pc: 3, startDepth: 5, endDepth: 10 })];   // the SAME account twice (cold reconnect double-write / results on a suspended key)
  g = run(dup);
  eq('the same writer twice = one voice -> lone (D-F11; used to pass as 2 consistent)', [g.consistent, g.lone], [0, 1]);
  const diff = [mk7(SA, 0, { pc: 3, startDepth: 5, endDepth: 10 }), mk7(SB, 1, { pc: 3, startDepth: 5, endDepth: 10, scores: [4000, 9999, 3000] })];
  g = run(diff);
  eq('2 writers, different vectors -> inconsistent (flagged)', [g.consistent, g.flagged], [0, 1]);
  const soloRec = mk7(SA, 0, { pc: 1, scores: [5000], rosterSids: [SA], startDepth: 0, endDepth: 5, flags: 0 });
  const foreign = mk7(SB, 1, { pc: 2, startDepth: 0, endDepth: 5 });
  g = run([foreign, soloRec]);
  eq('a foreign same-key pc=2 record cannot push a pc=1 segment out of the solo lane (B-F10)', [g.soloN, g.consistentMatches[0].solo, g.consistentMatches[0].g.length, g.consistentMatches[0].g[0].steamID], [1, true, 1, SA]);
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  assert('main() consumes groupRecords (single grouping path)', /const gr = groupRecords\(recs, \{ vecOf, MAX_SEATS \}\);/.test(SRC) && /const writers = new Set\(g\.map\(r => String\(r\.steamID\)\)\)\.size;/.test(SRC) && /if \(writers < 2\) \{ lone\+\+;/.test(SRC));
}

console.log('-- audit 2026-09-06 B-F7: competitive segment disposition sanity --');
{
  has('checkpoint segment with a non-finished disp (host-left) -> disp', sanityFlags(pair({ startDepth: 5, endDepth: 10, disp: 4 })), 'disp');
  has('suspended segment with a quit disp -> disp', sanityFlags(pair({ startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_SUSPENDED, disp: 5 })), 'disp');
  not('final segment may carry host-left', sanityFlags(pair({ startDepth: 5, endDepth: 8, flags: A.SEG_COMP | A.SEG_FINAL, disp: 4 })), 'disp');
  not('clean checkpoint (finished) stays clean', sanityFlags(pair({ startDepth: 5, endDepth: 10 })), 'disp');
}

console.log('-- milestone slot per member --');
{
  const st = { runs: {}, wait: {}, ms: {} };
  const a = soloMsSlot(st, pid(SA), 1, 'DUO', 1), b = soloMsSlot(st, pid(SB), 1, 'DUO', 1);
  assert('each member owns a slot (per player x season x family)', a !== b && Object.keys(st.ms).length === 2);
}

console.log('-- wiring pins (validate.js lane) --');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const lane = src.slice(src.indexOf('if ((t.flags | 0) & attest.SEG_COMP) {'), src.indexOf('processed.add(c.m); settledEndlessComp++;'));
  assert('the lane branches on SEG_COMP inside the endless (type 7) settle block, before the casual chain/pacing', lane.length > 0 && src.indexOf('if ((t.flags | 0) & attest.SEG_COMP) {') < src.indexOf('let chainMax = 0;'));
  assert('family picked by seat count (trio >= 3, else duo)', /compFam\[pc7 >= 3 \? 'TRIO' : 'DUO'\]/.test(lane));
  assert('boards are the gate (cp + family lifetime + seasonal when a season is live)', /if \(!cpId \|\| !fam\.id \|\| \(seasonId >= 1 && !fam\.seasonId\)\)/.test(lane));
  assert('incomplete roster = sanity flag, not settled', /rosterSids\.length !== pc7/.test(lane) && /recordFlag\(signals, g, c\.m, nowMs\)/.test(lane));
  assert('chain keyed by teamRunKey(roster, season, runSeed=d[4]) through the solo chain planner', /teamRunKey\(rosterSids, t\.seasonId, g\[0\]\.d\[4\] \| 0\)/.test(lane) && /soloChainPlan\(soloState, key, f, c\.m, nowMs\)/.test(lane));
  assert('chain reject marks the segment processed; a wait leaves it fresh', /plan\.ok === false\) \{[\s\S]*?processed\.add\(c\.m\);[\s\S]*?continue;/.test(lane) && /plan\.ok === null\) \{[^}]*continue; \}/.test(lane));
  assert('pacing on the proven chain depth (start attestation or first sighting)', /endlessRequiredMs\(f, plan\.proven\)/.test(lane) && /startsPending\[c\.m\]/.test(lane));
  assert('resume fee debited to seat 0 (host) on consume', /const host = rosterSids\[0\];/.test(lane) && /cp\[host\] = \(cp\[host\] == null \? 0 : cp\[host\]\) - COMP\.RESUME_CP;/.test(lane));
  assert('no continue debit in the lane (one life)', !/endlessDebits\(/.test(lane));
  assert('milestones per writer via the family slot', /soloMsSlot\(soloState, pid\(sid\), t\.seasonId, fam\.fam, nowMs\)/.test(lane));
  assert('board write = writers only, packed (endDepth, team bank), lifetime + season (season only when the run\'s season is current)', /packEndlessScore\(f\.endDepth, teamT\)/.test(lane) && /fam\.seasonId && \(t\.seasonId \| 0\) === \(seasonId \| 0\)/.test(lane));
  assert('progress XP per segment (writers only; audit B-F2: from the proven depth on an overlapping retry)', /creditXpEndless\(g, \{ startDepth: Math\.max\(f\.startDepth \| 0, plan\.proven \| 0\), endDepth: f\.endDepth \| 0 \}, xp, changedXp, spSet\)/.test(lane));
  assert('audit B-F5: a reject-window writer is skipped in the milestone/ladder loop (bitmap lives outside the snapshot)', /if \(scPendingRestore && scPendingRestore\.sids\.indexOf\(sid\) >= 0\) \{ console\.log\('  endless-comp '/.test(lane));
  assert('solo lane milestones moved to the per-season family slot too', /soloMilestones\(soloMsSlot\(soloState, p, f\.seasonId, 'SOLO', nowMs\), f\.endDepth\)/.test(src));
  assert('consistency vector compares the whole 9-int tail (flags + perk build / pick log are lockstep facts)', /v = v\.concat\(r\.d\.slice\(at, at \+ Math\.min\(9, r\.d\.length - at\)\)\);/.test(src) && /JSON\.stringify\(r\.d\.slice\(at, at \+ Math\.min\(9, r\.d\.length - at\)\)\)/.test(src));
  assert('main app provisions the family surface up-front', /\[ENDLESS_COMP_LB_DUO, true\], \[SAVE_BOX_LB_DUO, false\], \[ENDLESS_COMP_LB_TRIO, true\], \[SAVE_BOX_LB_TRIO, false\]/.test(src));
  assert('family boards resolved find-or-create + season twins + save boxes', /compFam\[fam\] = \{ fam, low, name: lbName, id, seasonId: season\.id, best, seasonBest, det, seasonDet, complete, seasonComplete, saveBoxId: sbId/.test(src));
  assert('on-demand base reads cover the family ladders', /compFamIncomplete/.test(src) && /fam\.best\[sid\] = e\.score \| 0/.test(src));
  assert('seedcap correction deletes from the family pair for a comp segment', /const famC = \(\(tC\.flags \| 0\) & attest\.SEG_COMP\) \? compFam\[useTrioC \? 'TRIO' : 'DUO'\] : null;/.test(src) && /\] : famC \? \[/.test(src));
  assert('write phase writes both family pools (lifetime + season)', /for \(const \[pool, bid, label\] of \[\[fam\.changed, fam\.id, fam\.low \+ ' comp'\], \[fam\.seasonChanged, fam\.seasonId, fam\.low \+ ' comp season'\]\]\)/.test(src));
  assert('past-season prune runs over the three save boxes', /for \(const \[sbxId, sbxLabel\] of \[\[saveBoxId, 'save box'\], \[compFam\.DUO\.saveBoxId, 'duo save box'\], \[compFam\.TRIO\.saveBoxId, 'trio save box'\]\]\)/.test(src));
  assert('reject-window snapshot covers the family pools', /compDuoBest: compFam\.DUO\.best\[sid\]/.test(src) && /scPut\(compFam\.TRIO\.seasonBest, sn\.sid, sn\.compTrioSeasonBest\)/.test(src) && /scPut\(changedCompTrioSeason, sn\.sid, sn\.changedCompTrioSeason\)/.test(src));
  assert('run summary counts the lane', /RUN\.endlessComp = settledEndlessComp;/.test(src) && /team comp, \+' \+ s\('solo', 0\)/.test(src));
  assert('sanity keeps casual flags at 0 and pins the competitive segment rules', /else if \(fl !== 0\) out\.push\('flags'\);/.test(src) && /if \(t\.endDepth - t\.startDepth > COMP\.CKPT_EVERY\) out\.push\('span'\);/.test(src));
}

console.log(failN ? ('=== FAIL — ' + failN + ' fail (team-comp-settle) ===') : '=== ALL OK (team-comp-settle) ===');
process.exit(failN ? 1 : 0);
