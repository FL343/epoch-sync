'use strict';
// O156 bot-match XP (match type 11, client knives 3.7c / 3.7d): allowed-set membership, sanity
// bounds for the full-seat record form (pc = every seat 2..6, roster '0' at bot seats, difficulty
// tier in the mask nibble), the levels-passed reader (zero is a value), rank derivation from the
// record's own vector (party = mean rank), the XP formula (progress + rank term, tier multiplier,
// lone-writer discount, optional day cap), the lone-record lane in groupRecords (every channel),
// the start-orphan conviction exemption, and the settle-branch structure pins (XP is the ONLY surface).
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { BOT_XP, isBotMt, botTierOf, botTierMult, botSeatSplit, botRanksOf, botRankEffOf, botXpGain, botProgressOf, creditXpBot,
        sanityFlags, SANITY, PT_MT_ALLOWED, reconcileStarts, decodeRoster, groupRecords, ENDLESS, TEAM2, pid, xpBoostMult } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-11 settle record: header 10 + pc scores + disp + roster pairs (no tail).
//   Full-seat form: pc counts every seat; bots are roster '0'. Defaults: 1 human (seat 0) + 3 bots,
//   scores 4000/3500/3000/2500 (the human leads), 6 levels passed, adaptive tier (mask nibble 0).
function mk11(writer, seat, o) {
  o = o || {};
  const tier = o.tier == null ? 0 : o.tier;
  const mt = o.mt == null ? (11 | (tier << 4)) : o.mt;
  const pc = o.pc == null ? 4 : o.pc;
  const scores = o.scores || [4000, 3500, 3000, 2500, 2000, 1500].slice(0, pc);
  const prog = o.prog == null ? 6 : o.prog;
  const d = [0xB1, 3, mt, 333, 9, seat, 0, (prog << 1) | (o.win ? 1 : 0), pc, (o.dur == null ? 500 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [A, '0', '0', '0', '0', '0'].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  const dispCode = (o.disp == null ? 0 : o.disp);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode, disp: v.dispName ? v.dispName(dispCode) : String(dispCode), shard: 'lb_rec_0' };
}
// two humans (seats 0,1) + two bots
const duo = (o) => { o = o || {}; const base = Object.assign({ pc: 4, rosterSids: [A, B, '0', '0'] }, o); return [mk11(A, 0, base), mk11(B, 1, base)]; };

console.log('=== O156 bot-match XP (type 11) ===');

// -- constants pinned (companion repo lockstep re-pins the client-shared subset) --
eq('config pinned (mt/base/perLevel/rankMax/fixedMult/loneMult/dayCap/progMax/levelSecs/frac)',
  [BOT_XP.MT, BOT_XP.base, BOT_XP.perLevel, BOT_XP.rankMax, BOT_XP.fixedMult, BOT_XP.loneMult, BOT_XP.dayCapXp, BOT_XP.progMax, BOT_XP.LEVEL_SECONDS, BOT_XP.PACE_FRAC],
  [11, 30, 10, 60, 0.35, 0.6, 0, 6, 75, 0.5]);
eq('tier table', BOT_XP.TIERS, ['auto', 'easy', 'normal', 'hard', 'master']);
eq('isBotMt(11/0x1B/0x4B/10/7/1)', [isBotMt(11), isBotMt(0x1B), isBotMt(0x4B), isBotMt(10), isBotMt(7), isBotMt(1)], [true, true, true, false, false, false]);
eq('botTierOf reads the mask nibble (11 -> 0, 0x2B -> 2, 0x4B -> 4)', [botTierOf(11), botTierOf(0x2B), botTierOf(0x4B)], [0, 2, 4]);
eq('botTierMult: adaptive 1, every fixed tier fixedMult', [botTierMult(11), botTierMult(0x1B), botTierMult(0x4B)], [1, 0.35, 0.35]);
eq('MT_ALLOWED includes 11', SANITY.MT_ALLOWED.indexOf(11) >= 0, true);
eq('PT_MT_ALLOWED includes 11 (playtest + demo channels earn too)', PT_MT_ALLOWED.indexOf(11) >= 0, true);
eq('bots never apply LP / never a team code / not endless / not private', [v.appliesLp(11), v.isTeamMt(11), v.isSubScoreMt(11), v.isEndlessMt(11), v.isPrivateMt(11)], [false, false, false, false, false]);

// -- sanity bounds: full-seat form --
not('clean 1 human + 3 bots', sanityFlags([mk11(A, 0)]), 'pc');
not('clean 1 human + 3 bots: mt allowed', sanityFlags([mk11(A, 0)]), 'mt');
not('clean 1 human + 3 bots: no nobot', sanityFlags([mk11(A, 0)]), 'nobot');
not('clean 1 human + 3 bots: no self-seat', sanityFlags([mk11(A, 0)]), 'self-seat');
not('clean 2 humans + 2 bots', sanityFlags(duo()), 'nobot');
not('clean 3 humans + 3 bots (pc 6)', sanityFlags([mk11(A, 0, { pc: 6, rosterSids: [A, B, C, '0', '0', '0'] }), mk11(B, 1, { pc: 6, rosterSids: [A, B, C, '0', '0', '0'] })]), 'pc');
not('clean 1 human + 1 bot (pc 2)', sanityFlags([mk11(A, 0, { pc: 2, rosterSids: [A, '0'] })]), 'pc');
has('pc=1 rejected (a bot match has at least two seats)', sanityFlags([mk11(A, 0, { pc: 1, scores: [4000], rosterSids: [A] })]), 'pc');
has('pc=7 rejected', sanityFlags([mk11(A, 0, { pc: 7, scores: [1, 2, 3, 4, 5, 6, 7], rosterSids: [A, '0', '0', '0', '0', '0', '0'] })]), 'pc');
not('tier 4 (master) in the mask nibble passes', sanityFlags([mk11(A, 0, { tier: 4 })]), 'mask');
has('tier code 5 = out of domain', sanityFlags([mk11(A, 0, { mt: 11 | (5 << 4) })]), 'mask');
has('trio field on a bot code = forged', sanityFlags([mk11(A, 0, { mt: 11 | (2 << 8) })]), 'mask');
has('all-human record (no bot seat) rejected', sanityFlags([mk11(A, 0, { rosterSids: [A, B, C, '76561198000000004'] })]), 'nobot');
has('all-bot record (no human seat) rejected', sanityFlags([mk11(A, 0, { rosterSids: ['0', '0', '0', '0'] })]), 'nobot');
has('writer sitting at a bot seat = forged', sanityFlags([mk11(A, 1)]), 'self-seat');
has('writer at a foreign human seat = forged (self-seat)', sanityFlags([mk11(A, 0, { rosterSids: [B, '0', '0', '0'] })]), 'self-seat');
{
  const capOk = SANITY.SCORE_CAP * TEAM2.SCORE_MULT - 1, capBad = SANITY.SCORE_CAP * TEAM2.SCORE_MULT + 1;
  not('gamble headroom: score just under x' + TEAM2.SCORE_MULT + ' cap passes', sanityFlags([mk11(A, 0, { scores: [capOk, 1, 1, 1] })]), 'score');
  has('score over x' + TEAM2.SCORE_MULT + ' cap flagged', sanityFlags([mk11(A, 0, { scores: [capBad, 1, 1, 1] })]), 'score');
}

// -- seat split / ranks / effective rank --
eq('botSeatSplit 1h+3b', botSeatSplit(mk11(A, 0)), { humans: [0], bots: [1, 2, 3] });
eq('botSeatSplit 2h+2b', botSeatSplit(duo()[0]), { humans: [0, 1], bots: [2, 3] });
eq('botRanksOf strict order (4000/3500/3000/2500 -> 1,2,3,4)', botRanksOf(mk11(A, 0)), [1, 2, 3, 4]);
eq('botRanksOf ties share (3000/3000/2000/1000 -> 1,1,3,4)', botRanksOf(mk11(A, 0, { scores: [3000, 3000, 2000, 1000] })), [1, 1, 3, 4]);
eq('botRanksOf human last (1000/4000/3000/2000 -> 4,1,2,3)', botRanksOf(mk11(A, 0, { scores: [1000, 4000, 3000, 2000] })), [4, 1, 2, 3]);
eq('rankEff solo = own rank (seat 0 leads -> 1)', botRankEffOf(mk11(A, 0), 0), 1);
eq('rankEff solo human last -> 4', botRankEffOf(mk11(A, 0, { scores: [1000, 4000, 3000, 2000] }), 0), 4);
eq('rankEff party = mean over human seats (ranks 1 and 4 -> 2.5, both writers)', [botRankEffOf(duo({ scores: [4000, 1000, 3000, 2000] })[0], 0), botRankEffOf(duo({ scores: [4000, 1000, 3000, 2000] })[1], 1)], [2.5, 2.5]);
eq('rankEff party both humans ahead of the bots (ranks 1,2 -> 1.5)', botRankEffOf(duo()[0], 1), 1.5);

// -- levels-passed reader: min-of-writers, domain 0..6, zero is a value --
eq('botProgressOf min-of-writers (6,3 -> 3)', botProgressOf([duo({ prog: 6 })[0], duo({ prog: 3 })[1]]), 3);
eq('botProgressOf zero is a value (pull-out before L1 end): (0,3) -> 0', botProgressOf([duo({ prog: 0 })[0], duo({ prog: 3 })[1]]), 0);
eq('botProgressOf all-zero -> 0', botProgressOf([mk11(A, 0, { prog: 0 })]), 0);
eq('botProgressOf ignores out-of-domain (7 -> ignored, 4 kept)', botProgressOf([duo({ prog: 7 })[0], duo({ prog: 4 })[1]]), 4);
eq('botProgressOf all out-of-domain -> 0 (base only)', botProgressOf([mk11(A, 0, { prog: 9 })]), 0);

// -- the pure gain formula (client computeGameXpBot mirrors this matrix through the lockstep test) --
eq('lv6 n4 rank1 adaptive consensus -> 30+60+60 = 150', botXpGain(6, 4, 1, 1, 1, 1, 'valid'), 150);
eq('lv6 n4 rank4 (last) -> 90 (progress only)', botXpGain(6, 4, 4, 1, 1, 1, 'valid'), 90);
eq('lv6 n4 rank2 -> 90 + 60*(2/3) = 130', botXpGain(6, 4, 2, 1, 1, 1, 'valid'), 130);
eq('lv3 n4 rank1 -> 60 + 60*(3/6) = 90', botXpGain(3, 4, 1, 1, 1, 1, 'valid'), 90);
eq('lv0 (pull-out floor) -> base 30, no rank term', botXpGain(0, 4, 1, 1, 1, 1, 'valid'), 30);
eq('lv clamps to progMax (lv 9 -> as 6)', botXpGain(9, 4, 1, 1, 1, 1, 'valid'), 150);
eq('lone discount x0.6 (150 -> 90)', botXpGain(6, 4, 1, 1, BOT_XP.loneMult, 1, 'valid'), 90);
eq('fixed tier x0.35 (150 -> 53)', botXpGain(6, 4, 1, BOT_XP.fixedMult, 1, 1, 'valid'), 53);
eq('fixed + lone (150 -> 32)', botXpGain(6, 4, 1, BOT_XP.fixedMult, BOT_XP.loneMult, 1, 'valid'), 32);
eq('innocent = progress only (rank term gated on valid)', botXpGain(6, 4, 1, 1, 1, 1, 'innocent'), 90);
eq('party mean rank 2.5 -> 90 + 60*0.5 = 120', botXpGain(6, 4, 2.5, 1, 1, 1, 'valid'), 120);
eq('n=2 (1 human + 1 bot) rank1 -> 150, rank2 -> 90', [botXpGain(6, 2, 1, 1, 1, 1, 'valid'), botXpGain(6, 2, 2, 1, 1, 1, 'valid')], [150, 90]);
eq('n=6 rank1 -> 150, rank6 -> 90, rank3 -> 90+60*0.6 = 126', [botXpGain(6, 6, 1, 1, 1, 1, 'valid'), botXpGain(6, 6, 6, 1, 1, 1, 'valid'), botXpGain(6, 6, 3, 1, 1, 1, 'valid')], [150, 90, 126]);
eq('boost multiplies the whole gain (x1.3: 150 -> 195)', botXpGain(6, 4, 1, 1, 1, 1.3, 'valid'), 195);

// -- credit: classes, lone flag, tier from the group-key mt, party mean rank, boost, cap off --
function credit(recs, lv, seedXp, seedState, today, lone) {
  const xp = Object.assign({}, seedXp || {});
  const changed = {};
  const st = seedState || {};
  creditXpBot(recs, lv, xp, changed, st, today == null ? 20000 : today, null, !!lone);
  return { xp, changed, st };
}
eq('solo consensus-shaped call (lone=false) lv6 rank1 -> 150', credit([mk11(A, 0)], 6).xp[A], 150);
eq('solo lone lv6 rank1 -> 90', credit([mk11(A, 0)], 6, {}, {}, 20000, true).xp[A], 90);
eq('solo lone human last -> 90 * 0.6 = 54', credit([mk11(A, 0, { scores: [1000, 4000, 3000, 2000] })], 6, {}, {}, 20000, true).xp[A], 54);
eq('fixed tier (hard) lone lv6 rank1 -> 32', credit([mk11(A, 0, { tier: 3 })], 6, {}, {}, 20000, true).xp[A], 32);
eq('lv0 lone (pull-out floor) -> 18', credit([mk11(A, 0)], 0, {}, {}, 20000, true).xp[A], 18);
eq('innocent lone lv6 -> 54 (progress only)', credit([mk11(A, 0, { disp: 2 })], 6, {}, {}, 20000, true).xp[A], 54);
eq('abandoner -> nothing', credit([mk11(A, 0, { disp: 5 })], 6, {}, {}, 20000, true).xp[A] == null, true);
{
  const r = credit(duo({ scores: [4000, 1000, 3000, 2000] }), 6);
  eq('party: both humans paid the mean-rank amount (ranks 1 & 4 -> eff 2.5 -> 120 each)', [r.xp[A], r.xp[B]], [120, 120]);
  const r2 = credit(duo(), 6);
  eq('party both ahead of the bots (ranks 1,2 -> eff 1.5 -> 140 each)', [r2.xp[A], r2.xp[B]], [140, 140]);
  const r3 = credit([duo({ scores: [4000, 1000, 3000, 2000] })[0], duo({ scores: [4000, 1000, 3000, 2000], disp: 2 })[1]], 6);
  eq('party: an innocent member gets progress only, the valid member the full mean-rank pay', [r3.xp[A], r3.xp[B]], [120, 90]);
}
{
  const bm = xpBoostMult(v.xpLevelOf(1500), false);
  const r = credit([mk11(A, 0)], 6, { [A]: 1500 });
  eq('level boost applies (pre-credit board level ' + v.xpLevelOf(1500) + ', x' + bm + ')', r.xp[A], 1500 + Math.round(150 * bm));
}
{
  const st = {};
  const r1 = credit([mk11(A, 0)], 6, {}, st, 20000);
  eq('no day cap: state untouched (dayCapXp 0)', [r1.xp[A], Object.keys(st).length], [150, 0]);
  let tot = 0; const s2 = {};
  for (let i = 0; i < 12; i++) { const r = credit([mk11(A, 0)], 6, {}, s2, 30000); tot += r.xp[A] | 0; }
  eq('12 wins a day pay 12 x 150 uncapped', tot, 1800);
  // the cap path stays armed behind one constant
  const saved = BOT_XP.dayCapXp;
  BOT_XP.dayCapXp = 200;
  const s3 = {};
  const c1 = credit([mk11(A, 0)], 6, {}, s3, 20000), c2 = credit([mk11(A, 0)], 6, {}, s3, 20000), c3 = credit([mk11(A, 0)], 6, {}, s3, 20001);
  eq('re-armed cap 200: 150 then +50 then next day 150 again', [c1.xp[A], c2.xp[A], c3.xp[A], s3[pid(A)].btXp], [150, 50, 150, 150]);
  BOT_XP.dayCapXp = saved;
  eq('no career / first-win / private-cap state written', [s3[pid(A)].cg, s3[pid(A)].cw, s3[pid(A)].lastWinDay, s3[pid(A)].pvXp], [undefined, undefined, 0, undefined]);
}

// -- groupRecords: the lone lane for type 11 on every channel --
{
  const vecOf = r => { const pc = r.d[8] | 0; return JSON.stringify(r.d.slice(10, 10 + pc)); };
  const lone11 = [mk11(A, 0)];
  const g1 = groupRecords(lone11, { vecOf, MAX_SEATS: 8 });
  eq('lone type-11 record accepted as consistent (single-writer lane, default opts)', [g1.consistentMatches.length, g1.lone, g1.consistentMatches[0] && g1.consistentMatches[0].botLone === true], [1, 0, true]);
  const gOff = groupRecords(lone11, { vecOf, MAX_SEATS: 8, botLoneOk: false });
  eq('test lever botLoneOk:false -> stays lone', [gOff.consistentMatches.length, gOff.lone], [0, 1]);
  const lone10 = [mk11(A, 0, { mt: 10, rosterSids: [A, B, C, '76561198000000004'] })];
  const g10 = groupRecords(lone10, { vecOf, MAX_SEATS: 8 });
  eq('lone type-10 (private) record still lone -- the lane is type 11 only', [g10.consistentMatches.length, g10.lone], [0, 1]);
  const g2 = groupRecords(duo(), { vecOf, MAX_SEATS: 8 });
  eq('two humans vs bots: ordinary consensus group (not lone)', [g2.consistentMatches.length, g2.lone, !!(g2.consistentMatches[0] && g2.consistentMatches[0].botLone)], [1, 0, false]);
  const split = [duo()[0], duo({ scores: [4000, 3500, 3000, 1] })[1]];
  const gSplit = groupRecords(split, { vecOf, MAX_SEATS: 8 });
  eq('two humans disagreeing on a BOT score = inconsistent (the bot column is part of the consensus key)', [gSplit.consistentMatches.length, gSplit.inconsistentGroups.length], [0, 1]);
  const badVec = [Object.assign(mk11(A, 0), { d: mk11(A, 0).d.slice(0, 9) })];   // truncated -> BAD(len)
  const gBad = groupRecords(badVec, { vecOf: r => { const pc = r.d[8] | 0; return (r.d.length < 10 + pc) ? 'BAD(len)' : JSON.stringify(r.d.slice(10, 10 + pc)); }, MAX_SEATS: 8 });
  eq('a malformed lone record is not accepted', gBad.consistentMatches.length, 0);
}

// -- start-orphan conviction exemption (bot matches convict nobody) --
{
  const now = Date.now();
  const pending = { m11: { t0: now - 3 * 3600 * 1000, mt: 11, roster: { 0: 'h1' }, settled: [] } };
  const leavers = {};
  const res = reconcileStarts([], {}, new Set(), new Set(), pending, leavers, now, 2 * 3600 * 1000, {});
  eq('mt=11 orphan past maturity: zero convictions', res.convicted, 0);
  eq('leaver state untouched', Object.keys(leavers).length, 0);
  eq('entry kept as pacing anchor (TTL not reached)', !!pending.m11, true);
  pending.m11.t0 = now - ENDLESS.PENDING_TTL_MS - 1000;
  const res2 = reconcileStarts([], {}, new Set(), new Set(), pending, leavers, now, 2 * 3600 * 1000, {});
  eq('long-TTL prune cleans the stale anchor', !pending.m11 && res2.cleaned >= 1, true);
}

// -- settle-branch structure pins (XP is the ONLY surface) --
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const branch = src.match(/if \(isBotMt\(matchType\)\) \{[\s\S]{0,2400}?\n    \}/);
  if (!branch) bad('bot settle branch missing');
  else {
    const b = branch[0];
    eq('branch exits with continue (skips TrueSkill/LP/CP/B6/leavers wholesale)', /processed\.add\(c\.m\); settledBots\+\+;\s*\r?\n\s*continue;/.test(b), true);
    eq('branch credits ONLY XP (no creditCp/recordMatchSignals/detectLeavers/rankOf inside)', !/creditCp|recordMatchSignals|detectLeavers|updateMatch|teamLpPlan|rankOf/.test(b), true);
    eq('branch passes the lone flag into the credit (loneMult applied there)', /creditXpBot\(g, lvB, xp, changedXp, xpState, today, spSet, !!c\.botLone\)/.test(b), true);
    eq('time-as-work: lv-scaled floor with MIN_START_AGE lower bound', /Math\.max\(SANITY\.MIN_START_AGE_MS, lvB \* BOT_XP\.LEVEL_SECONDS \* 1000 \* BOT_XP\.PACE_FRAC\)/.test(b), true);
    eq('synth first-sighting fallback (fabricator pays the same wall time)', /synth: true/.test(b), true);
  }
  eq('branch placed after the private branch and before matchmade XP credit (creditXp)',
    src.indexOf('if (isPrivateMt(matchType)) {') < src.indexOf('if (isBotMt(matchType)) {') && src.indexOf('if (isBotMt(matchType)) {') < src.indexOf('if (xpId) creditXp(g, matchType'), true);
  eq('groupRecords call site carries no channel lever (lone lane is unconditional for type 11)', /groupRecords\(recs, \{ vecOf, MAX_SEATS \}\)/.test(src), true);
  eq('lone lane gated on type 11 AND a sane vector (test lever only)', /writers < 2 && same && opts\.botLoneOk !== false && isBotMt\(g\[0\]\.d\[2\] \| 0\)/.test(src), true);
  eq('no channel-gated lone flag survives (DEMO_LONE_OK / BOT_LONE_OK retired)', !/DEMO_LONE_OK|BOT_LONE_OK/.test(src), true);
  {
    const fn = src.match(/function creditXpBot[\s\S]*?\n\}\n/);
    eq('credit reads rank/tier/split from the canonical record only (never the self-reported d[6])', !!fn && /const canon = g\[0\], n = canon\.d\[8\] \| 0, mt = canon\.d\[2\] \| 0;/.test(fn[0]) && !/d\[6\]/.test(fn[0]), true);
    eq('day cap only maintained when armed (dayCapXp > 0)', !!fn && /if \(BOT_XP\.dayCapXp > 0\) \{/.test(fn[0]), true);
  }
  eq('start-orphan exemption names isBotMt', /if \(isEndlessMt\(p\.mt\) \|\| isPrivateMt\(p\.mt\) \|\| isBotMt\(p\.mt\)\)/.test(src), true);
  eq('summary line counts bots', /settledBots \+ ' bots/.test(src), true);
  // seedcap auditor never picks a type-11 group (zero stakes)
  const sc = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  eq('seedcap.js pickAuditable excludes base 11', /if \(base < 1 \|\| base > 10 \|\| pc < 1 \|\| pc > 8/.test(sc), true);
  // both channel twins export DEMO_APPID (channel-workflows.js proves identical values across twins)
  for (const wf of ['playtest.yml', 'demo.yml']) {
    const w = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', wf), 'utf8');
    eq(wf + ' exports DEMO_APPID to the reconcile job', /\n\s+DEMO_APPID: \$\{\{ secrets\.DEMO_APPID \}\}\n/.test(w), true);
  }
}

console.log(failN ? ('FAILED ' + failN) : 'all ok');
process.exit(failN ? 1 : 0);
