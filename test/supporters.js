'use strict';
process.env.SUPPORTER_DLC_APPID = process.env.SUPPORTER_DLC_APPID || '5219710';   // env-sourced (public repo carries no game ids); test pins the wiring shape
// Supporter pack: ownership-probe plan, wall score/order, opt-out reconcile plan, points multiplier,
// and the validate.js wiring (spSet reaches both credit paths; early-exit paths still reconcile;
// playtest hard-off; state file persisted by the workflow whitelist).
const path = require('path');
const fs = require('fs');
const sp = require(path.join(__dirname, '..', 'supporters.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));
const { SUPPORTER, ownsFromResponse, checkPlan, applyProbe, wallScore, xpMult, wallAction } = sp;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond) => cond ? ok(label) : bad(label);
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (expected ' + b + ')'); };

console.log('=== supporters [1] constants / ownership predicate ===');
eq('constants pinned (dlc/wall/optout/bit/bonus/base/recheck/cap)',
  [SUPPORTER.DLC_APPID, SUPPORTER.WALL_LB, SUPPORTER.OPTOUT_LB, SUPPORTER.GRANT_BIT, SUPPORTER.XP_BONUS_PCT, SUPPORTER.SCORE_BASE, SUPPORTER.RECHECK_NON_MS, SUPPORTER.MAX_CHECKS_PER_RUN],
  [Number(process.env.SUPPORTER_DLC_APPID), 'supporter_wall', 'supporter_optout', 7, 10, 0x7fffffff, 86400000, 150]);
assert('exported through validate.js (SUPPORTER + SUPPORTERS_FILE default)', v.SUPPORTER === SUPPORTER && v.SUPPORTERS_FILE === 'supporters.json');
assert('grant bit 7 is outside the redeem catalog bits and the campaign bits 5/6', ![0, 1, 2, 3, 4, 5, 6].includes(SUPPORTER.GRANT_BIT) && Object.values(v.REDEEM_CATALOG || {}).every(c => ((c && c.bit) | 0) !== SUPPORTER.GRANT_BIT));
const S = '76561198000000001';
assert('owns: personal license true', ownsFromResponse({ appownership: { ownsapp: true, ownersteamid: S } }, S) === true);
assert('owns: family-shared (other owner) false', ownsFromResponse({ appownership: { ownsapp: true, ownersteamid: '76561198000000002' } }, S) === false);
assert('owns: site license false / ownsapp false / malformed false', ownsFromResponse({ appownership: { ownsapp: true, ownersteamid: S, sitelicense: true } }, S) === false
  && ownsFromResponse({ appownership: { ownsapp: false, ownersteamid: S } }, S) === false && ownsFromResponse({}, S) === false && ownsFromResponse(null, S) === false);

console.log('=== supporters [2] probe plan (unknown first, stale non-owners, owners never, capped) ===');
const pidOf = (s) => 'p' + s.slice(-4);
const now = 1_800_000_000_000;
const st = {};
eq('empty state: all valid sids planned, dedup + invalid dropped', checkPlan(st, [S, S, 'nope', '76561198000000003'], pidOf, now), ['76561198000000001', '76561198000000003']);
applyProbe(st, pidOf(S), true, now);
applyProbe(st, pidOf('76561198000000003'), false, now);
eq('after probe: owner never re-planned, fresh non-owner not yet stale', checkPlan(st, [S, '76561198000000003'], pidOf, now + 3600e3), []);
eq('non-owner stale after 24h -> re-planned; owner still not', checkPlan(st, [S, '76561198000000003'], pidOf, now + SUPPORTER.RECHECK_NON_MS), ['76561198000000003']);
{
  const st2 = {}; const many = []; for (let i = 0; i < 200; i++) many.push('7656119800000' + String(1000 + i));
  eq('per-run cap', checkPlan(st2, many, pidOf, now).length, SUPPORTER.MAX_CHECKS_PER_RUN);
  eq('cap override', checkPlan(st2, many, pidOf, now, 5).length, 5);
}
{
  const e = st[pidOf(S)];
  eq('owner entry: o=1 f=firstMin c=lastMin', [e.o, e.f, e.c], [1, Math.floor(now / 60000), Math.floor(now / 60000)]);
  applyProbe(st, pidOf(S), false, now + 10 * 60000);   // a later "false" (refund) must NOT clear ownership? -> policy: consumed; but applyProbe records the truth...
  // policy note: owners are never re-probed by checkPlan, so this path cannot happen in production; applyProbe itself is honest.
  eq('applyProbe honest (records false when told false) -- checkPlan is what makes ownership sticky', st[pidOf(S)].o, 0);
  applyProbe(st, pidOf(S), true, now + 20 * 60000);
  eq('re-owning keeps the ORIGINAL first-seen minute (wall order stable)', st[pidOf(S)].f, Math.floor(now / 60000));
}

console.log('=== supporters [3] wall score / opt-out reconcile ===');
assert('wall score descends with time: earlier supporter sorts first on a Descending board', wallScore(1000) > wallScore(1001) && wallScore(0) === 0x7fffffff);
eq('owner, shown, no row -> write', wallAction({ o: 1, w: 0 }, false), 'write');
eq('owner, shown, row present -> nothing', wallAction({ o: 1, w: 1 }, false), null);
eq('owner opted out with row -> delete', wallAction({ o: 1, w: 1 }, true), 'delete');
eq('owner opted out without row -> nothing', wallAction({ o: 1, w: 0 }, true), null);
eq('non-owner -> nothing regardless', [wallAction({ o: 0, w: 1 }, false), wallAction(null, false)], [null, null]);

console.log('=== supporters [4] points multiplier ===');
eq('xpMult(pct,false) == 1 + pct/100 (non-supporter path bit-identical to the old expression)', [0, 5, 10, 15, 20, 25, 30].map(p => xpMult(p, false)), [0, 5, 10, 15, 20, 25, 30].map(p => 1 + p / 100));
eq('xpMult(pct,true) == 1 + (pct+10)/100 (stacked, uncapped: level 90 tier 30 -> 1.40)', [0, 30].map(p => xpMult(p, true)), [1.10, 1.40]);
assert('validate.xpBoostMult(level, supporter) routes through xpMult (Lv90 -> 1.3 / 1.4; Lv0 -> 1.0 / 1.1)',
  v.xpBoostMult(90) === 1.3 && v.xpBoostMult(90, true) === 1.4 && v.xpBoostMult(0) === 1 && v.xpBoostMult(0, true) === 1.1);
{
  // computeXpGain with the boost: supporter earns strictly more, and the expression shape is round(round(xp)*factor)
  const base = v.computeXpGain('valid', 0, 5000, false, false, 1, v.xpBoostMult(0));
  const sup = v.computeXpGain('valid', 0, 5000, false, false, 1, v.xpBoostMult(0, true));
  assert('supporter points strictly higher (' + base + ' -> ' + sup + ')', sup > base && sup === Math.round(Math.round((100 + 80 + 100) * 1.1)));
}

console.log('=== supporters [5] validate.js wiring pins ===');
const vjs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('creditXp/creditXpPrivate take spSet and pass supporter flag into xpBoostMult',
  /function creditXp\([^)]*careerDet, spSet\)/.test(vjs) && /function creditXpPrivate\([^)]*today, spSet\)/.test(vjs)
  && (vjs.match(/xpBoostMult\(xpLevelOf\(xp\[sid\] \| 0\), !!\(spSet && spSet\.has\(String\(sid\)\)\)\)/g) || []).length === 2);
assert('both settle call sites pass spSet', /creditXpPrivate\(g, rankOf, lvP, xp, changedXp, xpState, today, spSet\)/.test(vjs) && /creditXp\(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today, progFrac, careerDet, spSet\)/.test(vjs));
assert('processSupporters: playtest hard-off + env appid gate + probes via CheckAppOwnership + capped plan', /const processSupporters = async \(xpMap, extraSids\) => \{\s*const spSet = new Set\(\);\s*if \(PT_MODE\) return spSet;\s*const S = supporters\.SUPPORTER;\s*if \(!S\.DLC_APPID\)/.test(vjs) && /DLC_APPID: Number\(process\.env\.SUPPORTER_DLC_APPID\) \|\| 0/.test(fs.readFileSync(path.join(__dirname, '..', 'supporters.js'), 'utf8'))
  && /ISteamUser\/CheckAppOwnership\/v2\//.test(vjs) && /supporters\.checkPlan\(st, cands, pid, nowMs\)/.test(vjs));
assert('processSupporters runs on both early-exit paths (quiet days still reconcile the wall) and on the main path before settle',
  (vjs.match(/await processSupporters\(null, \[\]\); writeRunSummary\(\); return; \}/g) || []).length === 2 && /const spSet = await processSupporters\(xp, spSids\);/.test(vjs));
assert('wall writes: Descending board, score = wallScore(first-seen), ForceUpdate; opt-out (score 1) -> DeleteLeaderboardScore; grant bit via postFormDetails GRANT_MAGIC',
  /score: supporters\.wallScore\(e\.f\), scoremethod: 'ForceUpdate'/.test(vjs) && /if \(\(e\.score \| 0\) === 1\) optOut\.add/.test(vjs)
  && /DeleteLeaderboardScore\/v1\/', \{ key: KEY, appid: APPID, leaderboardid: wallId/.test(vjs) && /setGrantBit\(newMask, S\.GRANT_BIT\)/.test(vjs));
assert('state file persisted: validate.yml whitelist has supporters.json; playtest.yml isolates + whitelists pt-supporters.json',
  /for f in [^\n]*\bsupporters\.json\b/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8'))
  && /SUPPORTERS_FILE:\s*pt-supporters\.json/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'playtest.yml'), 'utf8'))
  && /for f in [^\n]*\bpt-supporters\.json\b/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'playtest.yml'), 'utf8')));
assert('state is pid-keyed (applyProbe(st, pid(...)) -- no raw ids in supporters.json)', /supporters\.applyProbe\(st, pid\(plan\[i\]\)/.test(vjs) && /const e = st\[pid\(sid\)\];/.test(vjs));

console.log('');
if (failN) { console.log('[supporters] ' + failN + ' FAIL'); process.exit(1); }
console.log('[supporters] all green');
