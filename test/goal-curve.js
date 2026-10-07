'use strict';
// Goal-curve closed forms + out-of-domain depth guards.
// The endless / classic goal lines used to be per-level loops (one iteration per claimed level). Shard rows are
// writable by any owner of the game, so one unsigned record claiming endDepth near 2^31 cost ~16 s of CPU per
// evaluation; a few dozen made the reconcile and the seedcap audit time out on every run (state never saved,
// settlement stalled for everyone). Pins:
//   [1] closed forms are value-identical to the original loops on the whole depth domain
//   [2] both curves answer a 2^31 depth in O(1) and clamp past the domain
//   [3] reconcile sanity (team + solo) flags such a record 'depth' fast and derives no cap from it
//   [4] the seedcap picker skips it (audited-with-error once) instead of replaying / capping it
//   [5] the timing budget is meaningful: the original loop blows it on a depth far below 2^31
const path = require('path');
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.STATE_SALT = process.env.STATE_SALT || 'goal-curve-test-salt';
process.env.SC_STATE_FILE = path.join(require('os').tmpdir(), 'goal-curve-test-' + process.pid + '.json');
const v = require(path.join(__dirname, '..', 'validate.js'));
const sc = require(path.join(__dirname, '..', 'seedcap.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

// ---- the original loops, verbatim (reference only) ----
function endlessGoalBaseLoop(depth) {
  const G = v.ENDLESS.GOAL, dd = Math.max(1, depth | 0);
  let goal = G.start, addon = G.addonStart;
  for (let n = 2; n <= dd; n++) { addon += ((n - 1) <= G.earlyLevels) ? G.growEarly : G.growLate; goal += addon; }
  return goal;
}
function classicGoalAtLoop(level) {
  let goal = v.CLASSIC.GOAL.start + v.CLASSIC.GOAL.addonStart, addon = v.CLASSIC.GOAL.addonStart;
  for (let d = 1; d < (level | 0); d++) { if (d <= v.CLASSIC.GOAL.earlyLevels) addon += v.CLASSIC.GOAL.grow; goal += addon; }
  return goal;
}
const CAP = v.ENDLESS.DEPTH_CAP, HUGE = 2147483647;
const msOf = (fn) => { const t = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t) / 1e6; };

// ---- [1] value identity on the domain ----
{
  let e1 = null, c1 = null;
  for (let d = -5; d <= 20000 && !(e1 && c1); d++) {
    if (!e1 && v.endlessGoalBase(d) !== endlessGoalBaseLoop(d)) e1 = d;
    if (!c1 && v.classicGoalAt(d) !== classicGoalAtLoop(d)) c1 = d;
  }
  T('[1] endlessGoalBase == loop for every depth -5..20000', e1 === null, 'first mismatch at ' + e1);
  T('[1] classicGoalAt == loop for every level -5..20000', c1 === null, 'first mismatch at ' + c1);
  // deterministic samples across the rest of the domain (incl. both edges)
  let s = 12345, e2 = null, c2 = null;
  const samples = [20001, CAP - 1, CAP];
  for (let i = 0; i < 300; i++) { s = (s * 1103515245 + 12345) >>> 0; samples.push(20001 + (s % (CAP - 20001))); }
  for (const d of samples) {
    if (!e2 && v.endlessGoalBase(d) !== endlessGoalBaseLoop(d)) e2 = d;
    if (!c2 && v.classicGoalAt(d) !== classicGoalAtLoop(d)) c2 = d;
  }
  T('[1] endlessGoalBase == loop on 303 samples up to the cap', e2 === null, 'first mismatch at ' + e2);
  T('[1] classicGoalAt == loop on 303 samples up to the cap', c2 === null, 'first mismatch at ' + c2);
  T('[1] values stay exact integers at the cap', Number.isSafeInteger(v.endlessGoalBase(CAP)) && Number.isSafeInteger(v.classicGoalAt(CAP)));
  // the companion repo's lockstep probes (client curve mirrors) -- the same numbers as before
  T('[1] lockstep probes unchanged (endless 1/2/12/100, classic 1/10/12/50)',
    JSON.stringify([1, 2, 12, 100].map(v.endlessGoalBase)) === JSON.stringify([1, 2, 12, 100].map(endlessGoalBaseLoop)) &&
    JSON.stringify([1, 10, 12, 50].map(v.classicGoalAt)) === JSON.stringify([1, 10, 12, 50].map(classicGoalAtLoop)));
}

// ---- [2] O(1) + clamp past the domain ----
{
  let r1, r2;
  const ms = msOf(() => { for (let i = 0; i < 1000; i++) { r1 = v.endlessGoalBase(HUGE); r2 = v.classicGoalAt(HUGE); } });
  T('[2] 1000 x (both curves at depth 2^31-1) under 50 ms', ms < 50, ms.toFixed(1) + ' ms');
  T('[2] past the domain clamps to the cap value', r1 === v.endlessGoalBase(CAP) && r2 === v.classicGoalAt(CAP) && v.endlessGoalBase(CAP + 1) === v.endlessGoalBase(CAP));
  T('[2] goalFor scales the clamped base', v.endlessGoalFor(HUGE, 3) === v.endlessGoalBase(CAP) * 3);
}

// ---- record builders (client wire form; team tail = startDepth, endDepth, cont, tokens, seasonId, flags) ----
const A = '76561198000000001', B = '76561198000000002';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
function mk7(writer, seat, o) {
  const d = [0xB1, 3, 7, 222, 9, seat, 0, 0, 2, 1200, 4000, 3500, 0];
  for (const sid of [A, B]) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.startDepth | 0, o.endDepth | 0, 0, 0, 1, o.flags | 0);
  return { steamID: writer, w: writer, d, roster: v.decodeRoster(d), dispCode: 0 };
}

// ---- [3] reconcile sanity: flagged 'depth', fast, no cap derived ----
{
  const g = [mk7(A, 0, { startDepth: 0, endDepth: HUGE }), mk7(B, 1, { startDepth: 0, endDepth: HUGE })];
  let f1; const ms1 = msOf(() => { f1 = v.sanityFlags(g); });
  T('[3] team record at depth 2^31-1 -> depth flag', f1.indexOf('depth') >= 0, JSON.stringify(f1));
  T('[3] ... in under 50 ms', ms1 < 50, ms1.toFixed(1) + ' ms');
  const gC = [mk7(A, 0, { startDepth: 0, endDepth: HUGE, flags: attest.SEG_CLASSIC | attest.SEG_FINAL }), mk7(B, 1, { startDepth: 0, endDepth: HUGE, flags: attest.SEG_CLASSIC | attest.SEG_FINAL })];
  let f2; const ms2 = msOf(() => { f2 = v.sanityFlags(gC); });
  T('[3] team classic record at depth 2^31-1 -> depth flag in under 50 ms', f2.indexOf('depth') >= 0 && ms2 < 50, JSON.stringify(f2) + ' ' + ms2.toFixed(1) + ' ms');
  const gOk = [mk7(A, 0, { startDepth: 0, endDepth: 6 }), mk7(B, 1, { startDepth: 0, endDepth: 6 })];
  T('[3] an honest depth-6 co-op record stays clean', v.sanityFlags(gOk).length === 0, JSON.stringify(v.sanityFlags(gOk)));
  const seg = (o) => Object.assign({ startDepth: 0, endDepth: 5, flags: 0, continuesUsed: 0, tokensCp: 0, seasonId: 1, dispCode: attest.DISP_FINISHED, score: 1000, durationSec: 300, build: 0, picksLo: 0, picksHi: 0, rerollLo: 0, rerollHi: 0 }, o);
  let f3; const ms3 = msOf(() => { f3 = v.soloSanity(seg({ startDepth: HUGE - 5, endDepth: HUGE })); });
  T('[3] signed solo segment at depth 2^31-1 -> depth flag in under 50 ms', f3.indexOf('depth') >= 0 && ms3 < 50, JSON.stringify(f3) + ' ' + ms3.toFixed(1) + ' ms');
  let f4; const ms4 = msOf(() => { f4 = v.soloSanity(seg({ startDepth: HUGE - 5, endDepth: HUGE, flags: attest.SEG_CLASSIC | attest.SEG_FINAL })); });
  T('[3] classic solo segment at depth 2^31-1 -> depth flag in under 50 ms', f4.indexOf('depth') >= 0 && ms4 < 50, JSON.stringify(f4) + ' ' + ms4.toFixed(1) + ' ms');
  T('[3] in-domain solo score cap unchanged (depth 5 line)', v.soloSanity(seg({ score: v.endlessGoalBase(5) * v.ENDLESS.SCORE_MULT })).length === 0 &&
    v.soloSanity(seg({ score: v.endlessGoalBase(5) * v.ENDLESS.SCORE_MULT + 1 })).indexOf('score') >= 0);
}

// ---- [4] seedcap picker: skip, never replay / cap ----
{
  const st = { audited: {}, chain: {} };
  const groups = {
    huge: [mk7(A, 0, { startDepth: HUGE - 10, endDepth: HUGE }), mk7(B, 1, { startDepth: HUGE - 10, endDepth: HUGE })],
    neg: [mk7(A, 0, { startDepth: -3, endDepth: 4 }), mk7(B, 1, { startDepth: -3, endDepth: 4 })],
    fine: [mk7(A, 0, { startDepth: 0, endDepth: 6 }), mk7(B, 1, { startDepth: 0, endDepth: 6 })],
  };
  let pend; const ms = msOf(() => { pend = sc.pickAuditable(st, groups); });
  const byM = {}; for (const x of pend) byM[x.m] = x;
  T('[4] picker answers in under 50 ms', ms < 50, ms.toFixed(1) + ' ms');
  T('[4] depth 2^31-1 group -> skip depth (no cap params)', byM.huge && byM.huge.skip === 'depth' && byM.huge.p === null);
  T('[4] negative start depth -> skip depth', byM.neg && byM.neg.skip === 'depth');
  T('[4] honest group still picked with a cap (startBank computed)', byM.fine && !byM.fine.skip && byM.fine.p && typeof byM.fine.p.startBank === 'number');
  const tk = sc.takeSkips(st, pend, 777);
  T('[4] takeSkips remembers the skip once (audited-with-error), keeps the honest group', tk.pending.length === 1 && tk.pending[0].m === 'fine' && st.audited.huge && st.audited.huge.e === 'depth' && st.audited.neg && st.audited.neg.e === 'depth');
  T('[4] remembered group is not picked again', sc.pickAuditable(st, { huge: groups.huge }).length === 0);
  let b; const msB = msOf(() => { b = sc.chainStartBank({ chain: {} }, [], 2, HUGE, 1); });
  T('[4] chainStartBank static bound at a forged start depth is O(1) and finite', msB < 50 && Number.isFinite(b), msB.toFixed(1) + ' ms');
}

// ---- [5] structural pin + the budget is meaningful ----
{
  const loopy = (fn) => /\bfor\s*\(|\bwhile\s*\(/.test(String(fn));
  T('[5] neither curve function contains a loop (a per-level loop is the DoS shape)', !loopy(v.endlessGoalBase) && !loopy(v.classicGoalAt));
  const D = 1 << 28;   // 1/8 of the attack depth
  const msLoop = msOf(() => endlessGoalBaseLoop(D)), msNew = msOf(() => v.endlessGoalBase(D));
  T('[5] the original loop at depth 2^28 already exceeds the 50 ms budget used above', msLoop > 50, msLoop.toFixed(1) + ' ms');
  T('[5] closed form at the same depth is under 1 ms', msNew < 1, msNew.toFixed(3) + ' ms');
}

try { require('fs').unlinkSync(process.env.SC_STATE_FILE); } catch (e) {}
console.log(failN ? ('FAIL x' + failN) : 'ALL OK (goal-curve)');
process.exit(failN ? 1 : 0);
