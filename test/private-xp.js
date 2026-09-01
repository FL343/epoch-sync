'use strict';
// O140 private friend-room XP (match type 10): allowed-set membership, sanity bounds,
// levels reader domain, the XP-lite credit formula (zero-sum win transfer + day cap),
// and the start-orphan conviction exemption. XP is the only surface by construction --
// the settle branch exits before TrueSkill/LP/CP/career/B6 (source-pinned here).
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { PRIVATE_XP, isPrivateMt, privateProgressOf, creditXpPrivate, sanityFlags, SANITY,
        PT_MT_ALLOWED, reconcileStarts, decodeRoster, ENDLESS, TEAM2, pid } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-10 settle record: header 10 + pc scores + disp + roster pairs (no tail)
function mk10(writer, seat, o) {
  o = o || {};
  const mt = o.mt == null ? 10 : o.mt;
  const pc = o.pc == null ? 2 : o.pc;
  const scores = o.scores || [4000, 3500, 3000, 2500, 2000, 1500].slice(0, pc);
  const prog = o.prog == null ? 6 : o.prog;
  const d = [0xB1, 3, mt, 222, 9, seat, 0, (prog << 1) | (o.win ? 1 : 0), pc, (o.dur == null ? 900 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [A, B, C, D, '76561198000000005', '76561198000000006'].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  return { steamID: writer, d, roster: decodeRoster(d), dispCode: (o.disp == null ? 0 : o.disp) };
}

console.log('=== O140 private friend-room XP (type 10) ===');

// -- constants pinned (companion repo lockstep re-pins the client-shared subset) --
eq('config pinned (mt/base/perLevel/transferFrac/dayCap/progMax/defaultLevels/levelSecs/frac)',
  [PRIVATE_XP.MT, PRIVATE_XP.base, PRIVATE_XP.perLevel, PRIVATE_XP.transferFrac, PRIVATE_XP.dayCapXp,
   PRIVATE_XP.progMax, PRIVATE_XP.defaultLevels, PRIVATE_XP.LEVEL_SECONDS, PRIVATE_XP.PACE_FRAC],
  [10, 20, 9, 0.4, 500, 15, 3, 75, 0.5]);
eq('isPrivateMt(10/0x1A/1/7)', [isPrivateMt(10), isPrivateMt(0x1A), isPrivateMt(1), isPrivateMt(7)], [true, true, false, false]);
eq('MT_ALLOWED includes 10', SANITY.MT_ALLOWED.indexOf(10) >= 0, true);
eq('PT_MT_ALLOWED includes 10 (playtest friend rooms earn too)', PT_MT_ALLOWED.indexOf(10) >= 0, true);
eq('private never applies LP / never a team code', [v.appliesLp(10), v.isTeamMt(10), v.isSubScoreMt(10)], [false, false, false]);

// -- sanity bounds --
not('clean 2P private group', sanityFlags([mk10(A, 0), mk10(B, 1)]), 'mt');
not('clean 2P private group (score under x3 cap)', sanityFlags([mk10(A, 0), mk10(B, 1)]), 'score');
has('premade mask on a private code = forged', sanityFlags([mk10(A, 0, { mt: 10 | (1 << 4) }), mk10(B, 1, { mt: 10 | (1 << 4) })]), 'mask');
has('pc=1 rejected', sanityFlags([mk10(A, 0, { pc: 1, scores: [1000] })]), 'pc');
has('pc=7 rejected', sanityFlags([mk10(A, 0, { pc: 7, scores: [1, 2, 3, 4, 5, 6, 7], rosterSids: [A, B, C, D, '76561198000000005', '76561198000000006', '76561198000000007'] })]), 'pc');
{
  const capOk = SANITY.SCORE_CAP * TEAM2.SCORE_MULT - 1, capBad = SANITY.SCORE_CAP * TEAM2.SCORE_MULT + 1;
  not('gamble headroom: score just under x' + TEAM2.SCORE_MULT + ' cap passes', sanityFlags([mk10(A, 0, { scores: [capOk, 100] }), mk10(B, 1, { scores: [capOk, 100] })]), 'score');
  has('score over x' + TEAM2.SCORE_MULT + ' cap flagged', sanityFlags([mk10(A, 0, { scores: [capBad, 100] }), mk10(B, 1, { scores: [capBad, 100] })]), 'score');
}

// -- levels reader: min-of-writers, domain 1..15 (wider than matchmade 1..6) --
eq('privateProgressOf min-of-writers', privateProgressOf([mk10(A, 0, { prog: 9 }), mk10(B, 1, { prog: 6 })]), 6);
eq('privateProgressOf accepts 9 (out of matchmade domain)', privateProgressOf([mk10(A, 0, { prog: 9 }), mk10(B, 1, { prog: 9 })]), 9);
eq('privateProgressOf ignores out-of-domain (0/16)', privateProgressOf([mk10(A, 0, { prog: 0 }), mk10(B, 1, { prog: 16 & 15 || 16 })]), 0 || privateProgressOf([mk10(A, 0, { prog: 0 })]));
eq('privateProgressOf all-zero -> 0 (settle falls back to defaultLevels)', privateProgressOf([mk10(A, 0, { prog: 0 }), mk10(B, 1, { prog: 0 })]), 0);

// -- credit formula: P/T math, zero-sum transfer, innocent/abandoner classes --
function credit(recs, rankOf, lv, seedXp, seedState, today) {
  const xp = Object.assign({}, seedXp || {});
  const changed = {};
  const st = seedState || {};
  creditXpPrivate(recs, rankOf, lv, xp, changed, st, today == null ? 20000 : today);
  return { xp, changed, st };
}
{
  // 2P lv6: P=74 T=30 -> winner 104, loser 44 (bm=1 on an empty board)
  const r = credit([mk10(A, 0), mk10(B, 1)], { [A]: 1, [B]: 2 }, 6);
  eq('2P lv6 winner +104 / loser +44 (P=74 T=30)', [r.xp[A], r.xp[B]], [104, 44]);
  ok('sum == 2P (zero-sum transfer): ' + (r.xp[A] + r.xp[B]) + ' == 148'); if (r.xp[A] + r.xp[B] !== 148) bad('sum drifted');
}
{
  // all-tie: transfer zero -> both P
  const r = credit([mk10(A, 0), mk10(B, 1)], { [A]: 1, [B]: 1 }, 6);
  eq('2P all-tie -> both P=74 (collusive tie farms nothing)', [r.xp[A], r.xp[B]], [74, 74]);
}
{
  // 4P distinct ranks lv3: P=47 T=19; t = round(19*(2.5-r)*2/3)
  const recs = [mk10(A, 0, { pc: 4 }), mk10(B, 1, { pc: 4 }), mk10(C, 2, { pc: 4 }), mk10(D, 3, { pc: 4 })];
  const r = credit(recs, { [A]: 1, [B]: 2, [C]: 3, [D]: 4 }, 3);
  const sum = r.xp[A] + r.xp[B] + r.xp[C] + r.xp[D];
  eq('4P lv3 gradient (rank1>rank2>rank3>rank4)', r.xp[A] > r.xp[B] && r.xp[B] > r.xp[C] && r.xp[C] > r.xp[D], true);
  ok('4P sum ~= 4P (|' + sum + ' - 188| <= 2 rounding)'); if (Math.abs(sum - 4 * 47) > 2) bad('4P transfer sum drifted: ' + sum);
}
{
  // innocent: base only; abandoner: nothing
  const r = credit([mk10(A, 0, { disp: 2 }), mk10(B, 1, { disp: 5 })], { [A]: 1, [B]: 2 }, 6);
  eq('innocent -> base 20, abandoner -> nothing', [r.xp[A], r.xp[B] == null], [20, true]);
}
{
  // day cap: room clips, same-day accumulates, next day resets
  const st = {};
  st[pid(A)] = { lastWinDay: 0, games: 0, pvDay: 20000, pvXp: 480 };   // 20 left today
  const r1 = credit([mk10(A, 0), mk10(B, 1)], { [A]: 1, [B]: 2 }, 6, {}, st, 20000);
  eq('day cap clips (480 used -> +20 of 104)', r1.xp[A], 20);
  eq('cap state advanced to 500', st[pid(A)].pvXp, 500);
  const r2 = credit([mk10(A, 0), mk10(B, 1)], { [A]: 1, [B]: 2 }, 6, {}, st, 20000);
  eq('capped-out same day -> +0', r2.xp[A] == null, true);
  const r3 = credit([mk10(A, 0), mk10(B, 1)], { [A]: 1, [B]: 2 }, 6, {}, st, 20001);
  eq('next UTC day resets the cap', r3.xp[A], 104);
  // career/first-win state untouched (XP-only surface)
  eq('no career counters written (cg/cw/cl stay unset)', [st[pid(A)].cg, st[pid(A)].cw, st[pid(A)].lastWinDay], [undefined, undefined, 0]);
}

// -- start-orphan conviction exemption (friend rooms convict nobody) --
{
  const now = Date.now();
  const pending = { m10: { t0: now - 3 * 3600 * 1000, mt: 10, roster: { 0: 'h1', 1: 'h2' }, settled: [] } };
  const leavers = {};
  const res = reconcileStarts([], {}, new Set(), new Set(), pending, leavers, now, 2 * 3600 * 1000, {});
  eq('mt=10 orphan past maturity: zero convictions', res.convicted, 0);
  eq('leaver state untouched', Object.keys(leavers).length, 0);
  eq('entry kept as pacing anchor (TTL not reached)', !!pending.m10, true);
  pending.m10.t0 = now - ENDLESS.PENDING_TTL_MS - 1000;
  const res2 = reconcileStarts([], {}, new Set(), new Set(), pending, leavers, now, 2 * 3600 * 1000, {});
  eq('long-TTL prune cleans the stale anchor', !pending.m10 && res2.cleaned >= 1, true);
}

// -- settle-branch structure pins (XP is the ONLY surface) --
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const branch = src.match(/if \(isPrivateMt\(matchType\)\) \{[\s\S]{0,2400}?\n    \}/);
  if (!branch) bad('private settle branch missing');
  else {
    const b = branch[0];
    eq('branch exits with continue (skips TrueSkill/LP/CP/B6/leavers wholesale)', /processed\.add\(c\.m\); settledPrivate\+\+;\s*\r?\n\s*continue;/.test(b), true);
    eq('branch credits ONLY XP (no creditCp/recordMatchSignals/detectLeavers inside)', !/creditCp|recordMatchSignals|detectLeavers|updateMatch|teamLpPlan/.test(b), true);
    eq('time-as-work: lv-scaled floor with MIN_START_AGE lower bound', /Math\.max\(SANITY\.MIN_START_AGE_MS, lvP \* PRIVATE_XP\.LEVEL_SECONDS \* 1000 \* PRIVATE_XP\.PACE_FRAC\)/.test(b), true);
    eq('synth first-sighting fallback (fabricator pays the same wall time)', /synth: true/.test(b), true);
  }
  eq('branch placed before matchmade XP credit (creditXp)', src.indexOf('if (isPrivateMt(matchType)) {') < src.indexOf('if (xpId) creditXp(g, matchType'), true);
}

// -- O124 seedcap coverage (user 2026-09-01: friend games take the seed sanity cap too) --
{
  const sc = require(path.join(__dirname, '..', 'seedcap.js'));
  const p10 = sc.capParamsOf(10, 4, null);
  eq('capParamsOf(10): widest-room fail-open envelope (quick/9 levels/no teams)',
    [p10.entry, p10.levels, p10.ts | 0, !!p10.isTeam, !!p10.team2], ['quick', 9, 0, false, false]);
  eq('capParamsOf(10): gamble headroom multiplier rides post-CLI', p10.capMult, TEAM2.SCORE_MULT);
  // pickAuditable admits base 10 (was skipped pre-O140)
  const g10 = { mAB_9_10: [mk10(A, 0), mk10(B, 1)] };
  const pend = sc.pickAuditable({ audited: {}, chain: {}, veto: {}, suspects: {}, corrections: [] }, g10);
  eq('pickAuditable admits a type-10 group', pend.length, 1);
  // applyAudit: capMult widens the verdict line (cap 100 -> eff 300 under x3)
  const st = { audited: {}, chain: {}, veto: {}, suspects: {}, corrections: [] };
  sc.applyAudit(st, pend.map(x => Object.assign({}, x, { scores: [250, 100] })),
    { m0: { cap: 100 } }, new Set(), 12345);
  eq('score 250 under eff cap 300 (100 x ' + TEAM2.SCORE_MULT + ') -> no veto', Object.keys(st.veto).length, 0);
  const st2 = { audited: {}, chain: {}, veto: {}, suspects: {}, corrections: [] };
  sc.applyAudit(st2, pend.map(x => Object.assign({}, x, { scores: [350, 100] })),
    { m0: { cap: 100 } }, new Set(), 12345);
  eq('score 350 over eff cap 300 -> veto + suspect (offense lane feeds)', [Object.keys(st2.veto).length, Object.keys(st2.suspects).length], [1, 1]);
  eq('no corrections for private (nothing on a board to correct)', st2.corrections.length, 0);
}

console.log(failN ? ('\nFAIL x' + failN) : '\nALL PASS (private-xp)');
process.exit(failN ? 1 : 0);
