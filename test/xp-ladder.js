'use strict';
// Unit tests for the authoritative XP ladder helpers: dispClassOf, effectiveLeaverFactor,
// computeXpGain, and the creditXp integration (seat-dedup, daily-first once/day, valid-only
// denominator, repeat-leaver discount, points credited for void matches too).
//   node test/xp-ladder.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';   // pid() needs a salt; any deterministic value
const path = require('path');
const { dispClassOf, effectiveLeaverFactor, computeXpGain, creditXp, pid, XP_CFG, LEAVER_XP } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

// ============================================================
console.log('=== dispClassOf (mirror of client per-end credit table) ===');
eq('0 finished -> valid', dispClassOf(0), 'valid');
eq('1 peers-gone -> valid', dispClassOf(1), 'valid');
eq('2 host-left -> innocent', dispClassOf(2), 'innocent');
eq('3 timeout -> innocent', dispClassOf(3), 'innocent');
eq('4 disband -> innocent', dispClassOf(4), 'innocent');
eq('5 user-quit -> abandoner', dispClassOf(5), 'abandoner');
eq('6 recon-fail -> innocent', dispClassOf(6), 'innocent');
eq('unknown 7 -> innocent (conservative)', dispClassOf(7), 'innocent');

// ============================================================
console.log('=== effectiveLeaverFactor (audit A1: gradient + min-sample gate) ===');
const MS = LEAVER_XP.minSample;   // 20
eq('first leave (1/0 games) -> 1.0 (NO instant-harshest)', effectiveLeaverFactor(1, 0), 1.0);
eq('2 leaves / 0 games -> 2/' + MS + '=10% -> 0.5', effectiveLeaverFactor(2, 0), 0.5);
eq('4 leaves / 0 games -> 4/' + MS + '=20% -> 0.3', effectiveLeaverFactor(4, 0), 0.3);
eq('honest 0 leaves / 100 games -> 1.0', effectiveLeaverFactor(0, 100), 1.0);
eq('reformed 1 leave / 100 games -> diluted <5% -> 1.0', effectiveLeaverFactor(1, 100), 1.0);
eq('habitual 10 leaves / 10 games -> 50% -> 0.3', effectiveLeaverFactor(10, 10), 0.3);
assert('gradient monotonic: more leaves never lighter', effectiveLeaverFactor(1, 0) >= effectiveLeaverFactor(3, 0) && effectiveLeaverFactor(3, 0) >= effectiveLeaverFactor(6, 0));
eq('no history (0/0) -> 1.0', effectiveLeaverFactor(0, 0), 1.0);

// ============================================================
console.log('=== computeXpGain (parity with client per-game formula) ===');
const B = XP_CFG.base;   // 100
eq('valid 1st quick + daily, money 0 -> base+rank0+daily', computeXpGain('valid', 0, 0, false, true, 1), B + XP_CFG.rankBonus[0] + XP_CFG.dailyFirstWin);
eq('valid 4th quick, money 500 -> base + floor(500/50)', computeXpGain('valid', 3, 500, false, false, 1), B + 0 + Math.floor(500 / XP_CFG.moneyDivisor));
eq('valid money cap', computeXpGain('valid', 3, 9999999, false, false, 1), B + XP_CFG.moneyBonusCap);
eq('valid 1st ranked + daily -> round((base+rank0)*mult)+daily', computeXpGain('valid', 0, 0, true, true, 1), Math.round((B + XP_CFG.rankBonus[0]) * XP_CFG.rankedMult) + XP_CFG.dailyFirstWin);
eq('innocent ranked -> round(base*mult) only (no rank/money/daily)', computeXpGain('innocent', 0, 9999, true, true, 1), Math.round(B * XP_CFG.rankedMult));
eq('abandoner -> 0', computeXpGain('abandoner', 0, 9999, true, true, 1), 0);
eq('repeat-leaver discount x0.3 on base', computeXpGain('valid', 3, 0, false, false, 0.3), Math.round(B * 0.3));
assert('factor=null defaults to 1.0', computeXpGain('valid', 3, 0, false, false, null) === B);

// ============================================================
console.log('=== creditXp integration ===');
const A = '76561198000000001', BB = '76561198000000002', C = '76561198000000003';
const mkRec = (seat, dispCode, sid) => { const d = []; d[5] = seat; return { d, dispCode, steamID: sid }; };
const TODAY = 20000;

// 3P all-finished quick: full XP, ranks by score, winner gets daily, games++ for all
{
  const g = [mkRec(0, 0, A), mkRec(1, 0, BB), mkRec(2, 0, C)];
  const scores = [300, 200, 100];        // seat0 highest
  const rankOf = { [A]: 1, [BB]: 2, [C]: 3 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  eq('winner(seat0) full + daily', xp[A], B + XP_CFG.rankBonus[0] + Math.floor(300 / XP_CFG.moneyDivisor) + XP_CFG.dailyFirstWin);
  eq('2nd(seat1) full, no daily', xp[BB], B + XP_CFG.rankBonus[1] + Math.floor(200 / XP_CFG.moneyDivisor));
  eq('3rd(seat2) full, no daily', xp[C], B + XP_CFG.rankBonus[2] + Math.floor(100 / XP_CFG.moneyDivisor));
  eq('winner lastWinDay set to today', xpState[pid(A)].lastWinDay, TODAY);
  eq('all 3 valid -> games=1 each', [xpState[pid(A)].games, xpState[pid(BB)].games, xpState[pid(C)].games], [1, 1, 1]);
  eq('changedXp has all 3', Object.keys(changedXp).sort(), [A, BB, C].sort());
}

// daily-first once per UTC day: same winner second match same day -> no second daily
{
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  creditXp([mkRec(0, 0, A), mkRec(1, 0, BB)], 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  const after1 = xp[A];
  creditXp([mkRec(0, 0, A), mkRec(1, 0, BB)], 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  const gain2 = xp[A] - after1;
  eq('2nd win same day: no daily bonus (gain2 = base+rank+money only)', gain2, B + XP_CFG.rankBonus[0] + Math.floor(300 / XP_CFG.moneyDivisor));
  // next day -> daily again
  creditXp([mkRec(0, 0, A), mkRec(1, 0, BB)], 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY + 1);
  const gain3 = xp[A] - after1 - gain2;
  eq('next day win: daily bonus returns', gain3, B + XP_CFG.rankBonus[0] + Math.floor(300 / XP_CFG.moneyDivisor) + XP_CFG.dailyFirstWin);
}

// void match (host-left=innocent for victims): still credits BASE, no daily, games NOT incremented
{
  const g = [mkRec(0, 2, A), mkRec(1, 2, BB)];   // both host-left -> innocent
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  creditXp(g, 2, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  eq('innocent victim still earns base*mult (ranked)', xp[A], Math.round(B * XP_CFG.rankedMult));
  eq('innocent rank1 gets NO daily', xpState[pid(A)] && (xpState[pid(A)].lastWinDay | 0), 0);
  eq('innocent does NOT increment games (Safe-to-Leave)', xpState[pid(A)].games, 0);
}

// abandoner record (user-quit): 0 gain, no games, not in changedXp
{
  const g = [mkRec(0, 5, A), mkRec(1, 0, BB)];   // seat0 quit, seat1 finished
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  eq('abandoner gain 0 (not in xp map)', xp[A] | 0, 0);
  eq('abandoner not in changedXp', changedXp[A], undefined);
  eq('abandoner games stays 0', xpState[pid(A)].games, 0);
  eq('finisher (rank2, no daily) still credited', xp[BB], B + XP_CFG.rankBonus[1] + Math.floor(100 / XP_CFG.moneyDivisor));
}

// repeat-leaver discount applied authoritatively
{
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  leavers[pid(A)] = { leaves: 4 };   // 4 leaves / 0 games -> factor 0.3
  const scores = [0, 0], rankOf = { [A]: 1, [BB]: 2 };
  creditXp([mkRec(0, 0, A), mkRec(1, 0, BB)], 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  // winner raw = base+rank0+daily = 100+80+150 = 330; x0.3 = 99
  eq('repeat leaver winner XP discounted x0.3', xp[A], Math.round((B + XP_CFG.rankBonus[0] + XP_CFG.dailyFirstWin) * 0.3));
  eq('clean player full XP', xp[BB], B + XP_CFG.rankBonus[1]);
}

// seat dedup: two records same seat credited once
{
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  const g = [mkRec(0, 0, A), mkRec(0, 0, A)];   // duplicate seat0
  creditXp(g, 1, [100, 0], { [A]: 1 }, xp, changedXp, xpState, leavers, TODAY);
  eq('duplicate seat credited once (games=1 not 2)', xpState[pid(A)].games, 1);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (XP ladder helpers + creditXp) ===');
process.exit(failN === 0 ? 0 : 1);
