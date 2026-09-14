'use strict';
// O156 bot-match XP (match type 11, client knife 3.7c): allowed-set membership, sanity bounds
// (human-only compacted records, pc 1..6), the levels-passed reader (zero is a value), the
// XP-lite credit formula (flat per-level pay + day cap, no rank term), the demo-only lone-record
// lane in groupRecords (single human vs bots has no second writer), the start-orphan conviction
// exemption, and the settle-branch structure pins (XP is the ONLY surface).
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { BOT_XP, isBotMt, botProgressOf, creditXpBot, sanityFlags, SANITY, PT_MT_ALLOWED,
        reconcileStarts, decodeRoster, groupRecords, ENDLESS, TEAM2, pid, xpBoostMult } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const has = (label, got, flag) => { if (got.indexOf(flag) >= 0) ok(label + ' -> ' + flag); else bad(label + ' missing ' + flag + ' got=' + JSON.stringify(got)); };
const not = (label, got, flag) => { if (got.indexOf(flag) < 0) ok(label + ' (no ' + flag + ')'); else bad(label + ' unexpectedly flagged ' + flag + ' got=' + JSON.stringify(got)); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// wire-form type-11 settle record: header 10 + pc scores + disp + roster pairs (no tail).
//   The client compacts bots out: pc / seat / scores / roster cover HUMAN seats only.
function mk11(writer, seat, o) {
  o = o || {};
  const mt = o.mt == null ? 11 : o.mt;
  const pc = o.pc == null ? 1 : o.pc;
  const scores = o.scores || [4000, 3500, 3000, 2500, 2000, 1500].slice(0, pc);
  const prog = o.prog == null ? 6 : o.prog;
  const d = [0xB1, 3, mt, 333, 9, seat, 0, (prog << 1) | (o.win ? 1 : 0), pc, (o.dur == null ? 500 : o.dur)];
  for (let i = 0; i < pc; i++) d.push(scores[i] | 0);
  d.push(o.disp == null ? 0 : o.disp);
  const ros = o.rosterSids || [A, B, C, '76561198000000004', '76561198000000005', '76561198000000006'].slice(0, pc);
  for (const sid of ros) { const p = sidPair(sid); d.push(p[0], p[1]); }
  const dispCode = (o.disp == null ? 0 : o.disp);
  return { steamID: writer, d, roster: decodeRoster(d), dispCode, disp: v.dispName ? v.dispName(dispCode) : String(dispCode), shard: 'lb_rec_0' };
}

console.log('=== O156 bot-match XP (type 11) ===');

// -- constants pinned (companion repo lockstep re-pins the client-shared subset: base/perLevel/dayCap) --
eq('config pinned (mt/base/perLevel/dayCap/progMax/levelSecs/frac)',
  [BOT_XP.MT, BOT_XP.base, BOT_XP.perLevel, BOT_XP.dayCapXp, BOT_XP.progMax, BOT_XP.LEVEL_SECONDS, BOT_XP.PACE_FRAC],
  [11, 30, 10, 900, 6, 75, 0.5]);
eq('isBotMt(11/0x1B/10/7/1)', [isBotMt(11), isBotMt(0x1B), isBotMt(10), isBotMt(7), isBotMt(1)], [true, true, false, false, false]);
eq('MT_ALLOWED includes 11', SANITY.MT_ALLOWED.indexOf(11) >= 0, true);
eq('PT_MT_ALLOWED includes 11 (playtest + demo channels earn too)', PT_MT_ALLOWED.indexOf(11) >= 0, true);
eq('bots never apply LP / never a team code / not endless / not private', [v.appliesLp(11), v.isTeamMt(11), v.isSubScoreMt(11), v.isEndlessMt(11), v.isPrivateMt(11)], [false, false, false, false, false]);

// -- sanity bounds: human-only compacted records --
not('clean pc=1 bot record (single human + bots)', sanityFlags([mk11(A, 0)]), 'pc');
not('clean pc=1 bot record: mt allowed', sanityFlags([mk11(A, 0)]), 'mt');
not('clean 2-human group', sanityFlags([mk11(A, 0, { pc: 2 }), mk11(B, 1, { pc: 2 })]), 'pc');
has('pc=0 rejected', sanityFlags([mk11(A, 0, { pc: 0, scores: [], rosterSids: [] })]), 'pc');
has('pc=7 rejected', sanityFlags([mk11(A, 0, { pc: 7, scores: [1, 2, 3, 4, 5, 6, 7], rosterSids: [A, B, C, '76561198000000004', '76561198000000005', '76561198000000006', '76561198000000007'] })]), 'pc');
has('premade mask on a bot code = forged', sanityFlags([mk11(A, 0, { mt: 11 | (1 << 4) })]), 'mask');
{
  const capOk = SANITY.SCORE_CAP * TEAM2.SCORE_MULT - 1, capBad = SANITY.SCORE_CAP * TEAM2.SCORE_MULT + 1;
  not('gamble headroom: score just under x' + TEAM2.SCORE_MULT + ' cap passes', sanityFlags([mk11(A, 0, { scores: [capOk] })]), 'score');
  has('score over x' + TEAM2.SCORE_MULT + ' cap flagged', sanityFlags([mk11(A, 0, { scores: [capBad] })]), 'score');
}
has('writer at a foreign seat = forged (self-seat)', sanityFlags([mk11(A, 0, { rosterSids: [B] })]), 'self-seat');

// -- levels-passed reader: min-of-writers, domain 0..6, zero is a value --
eq('botProgressOf min-of-writers (6,3 -> 3)', botProgressOf([mk11(A, 0, { pc: 2, prog: 6 }), mk11(B, 1, { pc: 2, prog: 3 })]), 3);
eq('botProgressOf zero is a value (pull-out before L1 end): (0,3) -> 0', botProgressOf([mk11(A, 0, { pc: 2, prog: 0 }), mk11(B, 1, { pc: 2, prog: 3 })]), 0);
eq('botProgressOf all-zero -> 0', botProgressOf([mk11(A, 0, { prog: 0 })]), 0);
eq('botProgressOf ignores out-of-domain (7 -> ignored, 4 kept)', botProgressOf([mk11(A, 0, { pc: 2, prog: 7 }), mk11(B, 1, { pc: 2, prog: 4 })]), 4);
eq('botProgressOf all out-of-domain -> 0 (base only)', botProgressOf([mk11(A, 0, { prog: 9 })]), 0);

// -- credit formula: flat per-level pay, classes, boost, day cap --
function credit(recs, lv, seedXp, seedState, today) {
  const xp = Object.assign({}, seedXp || {});
  const changed = {};
  const st = seedState || {};
  creditXpBot(recs, lv, xp, changed, st, today == null ? 20000 : today);
  return { xp, changed, st };
}
eq('lv6 valid -> 30 + 10*6 = 90', credit([mk11(A, 0)], 6).xp[A], 90);
eq('lv0 valid (pull-out floor) -> base 30', credit([mk11(A, 0)], 0).xp[A], 30);
eq('lv3 -> 60', credit([mk11(A, 0)], 3).xp[A], 60);
eq('lv clamps to progMax (lv 9 -> 90)', credit([mk11(A, 0)], 9).xp[A], 90);
eq('innocent pays the same as valid (no rank term to gate)', credit([mk11(A, 0, { disp: 2 })], 6).xp[A], 90);
eq('abandoner -> nothing', credit([mk11(A, 0, { disp: 5 })], 6).xp[A] == null, true);
{
  const r = credit([mk11(A, 0, { pc: 2 }), mk11(B, 1, { pc: 2 })], 6);
  eq('2 humans: both paid the flat amount (no zero-sum transfer)', [r.xp[A], r.xp[B]], [90, 90]);
}
{
  const bm = xpBoostMult(v.xpLevelOf(1500), false);
  const r = credit([mk11(A, 0)], 6, { [A]: 1500 });
  eq('level boost applies (pre-credit board level ' + v.xpLevelOf(1500) + ', x' + bm + ')', r.xp[A], 1500 + Math.round(90 * bm));
}
{
  const st = {};
  st[pid(A)] = { lastWinDay: 0, games: 0, btDay: 20000, btXp: 880 };   // 20 left today
  const r1 = credit([mk11(A, 0)], 6, {}, st, 20000);
  eq('day cap clips (880 used -> +20 of 90)', r1.xp[A], 20);
  eq('cap state advanced to 900', st[pid(A)].btXp, 900);
  const r2 = credit([mk11(A, 0)], 6, {}, st, 20000);
  eq('capped-out same day -> +0', r2.xp[A] == null, true);
  const r3 = credit([mk11(A, 0)], 6, {}, st, 20001);
  eq('next UTC day resets the cap', r3.xp[A], 90);
  eq('no career / first-win / private-cap state written', [st[pid(A)].cg, st[pid(A)].cw, st[pid(A)].lastWinDay, st[pid(A)].pvXp], [undefined, undefined, 0, undefined]);
  eq('10 bot matches a day saturate the cap exactly (9 x 90 + 90 -> 900)', (() => { const s2 = {}; let tot = 0; for (let i = 0; i < 12; i++) { const r = credit([mk11(A, 0)], 6, {}, s2, 30000); tot += r.xp[A] | 0; } return tot; })(), 900);
}

// -- groupRecords: demo-only lone lane for type 11 --
{
  const vecOf = r => { const pc = r.d[8] | 0; return JSON.stringify(r.d.slice(10, 10 + pc)); };
  const lone11 = [mk11(A, 0)];
  const gDemo = groupRecords(lone11, { vecOf, MAX_SEATS: 8, demoLoneOk: true });
  eq('demo job: lone type-11 record accepted as consistent (single-writer lane)', [gDemo.consistentMatches.length, gDemo.lone, gDemo.consistentMatches[0] && gDemo.consistentMatches[0].demoLone === true], [1, 0, true]);
  const gPt = groupRecords(lone11, { vecOf, MAX_SEATS: 8, demoLoneOk: false });
  eq('playtest/live job: the same lone record stays lone (never settles)', [gPt.consistentMatches.length, gPt.lone], [0, 1]);
  const lone10 = [Object.assign(mk11(A, 0, { mt: 10, pc: 2 }), {})];
  const g10 = groupRecords(lone10, { vecOf, MAX_SEATS: 8, demoLoneOk: true });
  eq('demo job: lone type-10 (private) record still lone -- the lane is type 11 only', [g10.consistentMatches.length, g10.lone], [0, 1]);
  const two = [mk11(A, 0, { pc: 2 }), mk11(B, 1, { pc: 2 })];
  const g2 = groupRecords(two, { vecOf, MAX_SEATS: 8, demoLoneOk: false });
  eq('two humans vs bots: ordinary consensus group on every channel', [g2.consistentMatches.length, g2.lone, !!(g2.consistentMatches[0] && g2.consistentMatches[0].demoLone)], [1, 0, false]);
  const badVec = [Object.assign(mk11(A, 0), { d: mk11(A, 0).d.slice(0, 9) })];   // truncated -> BAD(pc)
  const gBad = groupRecords(badVec, { vecOf: r => { const pc = r.d[8] | 0; return (r.d.length < 10 + pc) ? 'BAD(len)' : JSON.stringify(r.d.slice(10, 10 + pc)); }, MAX_SEATS: 8, demoLoneOk: true });
  eq('demo job: a malformed lone record is not accepted', gBad.consistentMatches.length, 0);
}

// -- DEMO_LONE_OK derivation (module-load env): demo twin = PT_MODE + APPID == DEMO_APPID --
{
  const probe = (env) => execFileSync(process.execPath, ['-e', "process.stdout.write(String(require(process.argv[1]).DEMO_LONE_OK))", path.join(__dirname, '..', 'validate.js')],
    { env: Object.assign({}, process.env, env), encoding: 'utf8' }).trim();
  eq('demo twin (PT_MODE=1, APPID == DEMO_APPID) -> true', probe({ PT_MODE: '1', APPID: '5049460', DEMO_APPID: '5049460' }), 'true');
  eq('playtest twin (PT_MODE=1, APPID != DEMO_APPID) -> false', probe({ PT_MODE: '1', APPID: '5049450', DEMO_APPID: '5049460' }), 'false');
  eq('live job (no PT_MODE) -> false even with matching ids', probe({ PT_MODE: '', APPID: '5049460', DEMO_APPID: '5049460' }), 'false');
  eq('DEMO_APPID unset -> false', probe({ PT_MODE: '1', APPID: '5049460', DEMO_APPID: '' }), 'false');
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
    eq('time-as-work: lv-scaled floor with MIN_START_AGE lower bound', /Math\.max\(SANITY\.MIN_START_AGE_MS, lvB \* BOT_XP\.LEVEL_SECONDS \* 1000 \* BOT_XP\.PACE_FRAC\)/.test(b), true);
    eq('synth first-sighting fallback (fabricator pays the same wall time)', /synth: true/.test(b), true);
  }
  eq('branch placed after the private branch and before matchmade XP credit (creditXp)',
    src.indexOf('if (isPrivateMt(matchType)) {') < src.indexOf('if (isBotMt(matchType)) {') && src.indexOf('if (isBotMt(matchType)) {') < src.indexOf('if (xpId) creditXp(g, matchType'), true);
  eq('groupRecords call site passes the demo lone flag', /groupRecords\(recs, \{ vecOf, MAX_SEATS, demoLoneOk: DEMO_LONE_OK \}\)/.test(src), true);
  eq('lone lane gated on channel flag AND type 11 AND a sane vector', /writers < 2 && same && opts\.demoLoneOk && isBotMt\(g\[0\]\.d\[2\] \| 0\)/.test(src), true);
  eq('DEMO_LONE_OK = PT_MODE && DEMO_APPID > 0 && APPID === DEMO_APPID (source pin)', /const DEMO_LONE_OK = PT_MODE && DEMO_APPID > 0 && APPID === DEMO_APPID;/.test(src), true);
  eq('start-orphan exemption names isBotMt', /if \(isEndlessMt\(p\.mt\) \|\| isPrivateMt\(p\.mt\) \|\| isBotMt\(p\.mt\)\)/.test(src), true);
  eq('summary line counts bots', /settledBots \+ ' bots/.test(src), true);
  // seedcap auditor never picks a type-11 group (compacted pc != world seat count; zero stakes)
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
