'use strict';
// Unit tests for the career win/loss counters + match-progress discount:
// xpProgressFrac / matchProgressOf (min-of-writers, domain-ignoring), careerWon (FFA vs team),
// creditXp career accumulation (valid counts W/L, innocent counts games only, abandoner nothing)
// and the progress-discounted gain expression shared with the client.
//   node test/career-progress.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const { xpProgressFrac, matchProgressOf, careerWon, creditXp, computeXpGain, pid, XP_CFG, CAREER_MAGIC, CAREER_VER } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

// ============================================================
console.log('=== xpProgressFrac (early-settle points discount) ===');
const N = XP_CFG.progressLevels;
eq('progressLevels pinned = 5 (matchmade level count)', N, 5);
eq('0 (legacy record, no data) -> full 1', xpProgressFrac(0), 1);
eq('1 level -> 1/5', xpProgressFrac(1), 1 / N);
eq('2 levels -> 2/5', xpProgressFrac(2), 2 / N);
eq('4 levels -> 4/5', xpProgressFrac(4), 4 / N);
eq('5 levels (full match) -> 1', xpProgressFrac(5), 1);
eq('negative -> full 1 (garbage earns no leverage)', xpProgressFrac(-3), 1);

// ============================================================
console.log('=== matchProgressOf (min-of-writers; out-of-domain ignored) ===');
// d[7] = win(bit0) | progress<<1 -- win bits differ per writer, progress bits should agree.
const rec7 = (d7) => { const d = []; d[7] = d7; return { d }; };
eq('two writers agree (win bits differ): [win|2<<1, 0|2<<1] -> 2', matchProgressOf([rec7(1 | (2 << 1)), rec7(0 | (2 << 1))]), 2);
eq('full match [1|5<<1, 0|5<<1] -> 5', matchProgressOf([rec7(1 | (5 << 1)), rec7(5 << 1)]), 5);
eq('transition skew (4 vs 5) -> min 4', matchProgressOf([rec7(4 << 1), rec7(5 << 1)]), 4);
eq('lone forger deflating (1 vs 5,5) -> min 1 (hurts own award too)', matchProgressOf([rec7(1 << 1), rec7(5 << 1), rec7(5 << 1)]), 1);
eq('forger inflating beyond domain (9) ignored -> 5', matchProgressOf([rec7(9 << 1), rec7(5 << 1)]), 5);
eq('negative d[7] ignored -> other writer wins', matchProgressOf([rec7(-8), rec7(3 << 1)]), 3);
eq('all legacy zero -> 0 (frac 1)', matchProgressOf([rec7(1), rec7(0)]), 0);
eq('legacy zero writer ignored in min: [0, 3<<1] -> 3', matchProgressOf([rec7(0), rec7(3 << 1)]), 3);

// ============================================================
console.log('=== careerWon (client win-definition mirror) ===');
assert('FFA (mt=1): only rank 1 wins', careerWon(1, 1) === true && careerWon(1, 2) === false);
assert('ranked FFA (mt=2): only rank 1 wins', careerWon(2, 1) === true && careerWon(2, 2) === false);
assert('premade-masked FFA (mt=0x21): base 1 -> rank1 only', careerWon(0x21, 1) === true && careerWon(0x21, 2) === false);
assert('team (mt=3/4): winning pair ranks {1,2} both win', careerWon(4, 1) && careerWon(4, 2) && !careerWon(4, 3) && !careerWon(4, 4));

// ============================================================
console.log('=== creditXp: career accumulation + progress discount ===');
const A = '76561198000000001', BB = '76561198000000002', C = '76561198000000003', D = '76561198000000004';
const mkRec = (seat, dispCode, sid) => { const d = []; d[5] = seat; return { d, dispCode, steamID: sid }; };
const TODAY = 20000;
const B = XP_CFG.base;

// full 3P quick: winner 1w, others 1l; careerDet arrays carry cumulative totals
{
  const g = [mkRec(0, 0, A), mkRec(1, 0, BB), mkRec(2, 0, C)];
  const scores = [300, 200, 100], rankOf = { [A]: 1, [BB]: 2, [C]: 3 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {}, det = {};
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY, 1, det);
  eq('winner career 1g/1w/0l', [xpState[pid(A)].cg, xpState[pid(A)].cw | 0, xpState[pid(A)].cl | 0], [1, 1, 0]);
  eq('2nd career 1g/0w/1l', [xpState[pid(BB)].cg, xpState[pid(BB)].cw | 0, xpState[pid(BB)].cl | 0], [1, 0, 1]);
  eq('careerDet[winner] = [MAGIC, ver, 1, 1, 0]', det[A], [CAREER_MAGIC, CAREER_VER, 1, 1, 0]);
  eq('careerDet[3rd] = [MAGIC, ver, 1, 0, 1]', det[C], [CAREER_MAGIC, CAREER_VER, 1, 0, 1]);
  // second match same run: cumulative totals in det
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY, 1, det);
  eq('cumulative after 2nd settle: winner 2g/2w/0l', det[A], [CAREER_MAGIC, CAREER_VER, 2, 2, 0]);
}

// team match (mt=4): winning pair (team ranks 1,2) BOTH count wins
{
  const g = [mkRec(0, 0, A), mkRec(1, 0, BB), mkRec(2, 0, C), mkRec(3, 0, D)];
  const scores = [100, 40, 95, 60];   // team A total 140 > B 155? no: A=140, B=155 -> B wins
  const rankOf = { [C]: 1, [D]: 2, [A]: 3, [BB]: 4 };   // team-convention ranks (winning pair {1,2})
  const xp = {}, changedXp = {}, xpState = {}, leavers = {}, det = {};
  creditXp(g, 4, scores, rankOf, xp, changedXp, xpState, leavers, TODAY, 1, det);
  eq('team winners (rank1,2) both 1w', [xpState[pid(C)].cw, xpState[pid(D)].cw], [1, 1]);
  eq('team losers (rank3,4) both 1l', [xpState[pid(A)].cl, xpState[pid(BB)].cl], [1, 1]);
}

// innocent (void victim): games only, no W/L; abandoner: nothing at all, no det entry
{
  const g = [mkRec(0, 2, A), mkRec(1, 5, BB)];   // A host-left innocent, B user-quit abandoner
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {}, det = {};
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY, 1, det);
  eq('innocent career 1g/0w/0l (game counts, no W/L)', [xpState[pid(A)].cg, xpState[pid(A)].cw | 0, xpState[pid(A)].cl | 0], [1, 0, 0]);
  eq('abandoner career all zero', [xpState[pid(BB)].cg | 0, xpState[pid(BB)].cw | 0, xpState[pid(BB)].cl | 0], [0, 0, 0]);
  eq('abandoner has NO careerDet entry', det[BB], undefined);
  eq('abandoner gain stays 0 (leaver earns no points -- pinned)', xp[BB] | 0, 0);
}

// progress discount: exact shared expression round(round(xp) * (leaverFactor * progFrac))
{
  const g = [mkRec(0, 1, A), mkRec(1, 1, BB)];   // peers-gone finishers (valid)
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {}, det = {};
  const pf = xpProgressFrac(2);   // settled during level 2 -> x0.4
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY, pf, det);
  const rawA = B + XP_CFG.rankBonus[0] + Math.floor(300 / XP_CFG.moneyDivisor) + XP_CFG.dailyFirstWin;
  eq('early settle (2/5): winner gets round(raw * 0.4)', xp[A], Math.round(rawA * (1 * pf)));
  eq('gain matches computeXpGain(factor=1*pf) directly', xp[A], computeXpGain('valid', 0, 300, false, true, 1 * pf));
  eq('career W/L still counts fully on a discounted match', [xpState[pid(A)].cg, xpState[pid(A)].cw], [1, 1]);
  // full-progress control: pf=1 path unchanged
  const xp2 = {}, det2 = {};
  creditXp(g, 1, scores, rankOf, xp2, {}, {}, {}, TODAY, xpProgressFrac(5), det2);
  eq('full match (5/5) unchanged = raw', xp2[A], rawA);
}

// legacy call sites (no progFrac/careerDet args) behave exactly as before
{
  const g = [mkRec(0, 0, A), mkRec(1, 0, BB)];
  const scores = [300, 100], rankOf = { [A]: 1, [BB]: 2 };
  const xp = {}, changedXp = {}, xpState = {}, leavers = {};
  creditXp(g, 1, scores, rankOf, xp, changedXp, xpState, leavers, TODAY);
  eq('omitted progFrac defaults to full', xp[A], B + XP_CFG.rankBonus[0] + Math.floor(300 / XP_CFG.moneyDivisor) + XP_CFG.dailyFirstWin);
}

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail (career counters + progress discount) ===');
process.exit(failN === 0 ? 0 : 1);
