'use strict';
// O728 endless competitive points (points-plan.js ELP section): the pure rules both repos run.
//   [1] the sign never flips: every pass gains (d >= 1 before the clamp; the line never goes down), every miss loses (d <= -1;
//       the line never goes up) -- over every tier, skill tier, offset and the board bounds
//   [2] one run swings less than BOUNDARY_MARGIN: outside a series band the points tier never changes in one run
//   [3] the series clamp and the demotion protection: a pass in the promotion band always crosses up; a miss in the relegation
//       band crosses down unless the hidden skill tier is at or above the points tier -- then the points never leave the tier
//   [4] the gap and stake factors point the right way (a skill above the points gains more / loses less; a harder target gains
//       more / loses less), and a missing skill is neutral
//   [5] the hidden skill: the newest WINDOW runs, the highest and the lowest left out from MIN_RUNS, null below; the placement read
//   [6] the target: the tier line plus an offset in -SPREAD..+SPREAD (signed / unsigned seeds alike, each offset 12-28 % of seeds),
//       at least 1; placement targets from the skill so far (silver with none)
//   [7] the placement seed: outside both series bands, at most SEED_CAP, never lower for a higher skill
//   [8] the family row and the published table round-trip; a v1 table / another row layout read as none
//   [9] mutations: each guard above turns red on the change it guards against
const path = require('path');
const fs = require('fs');
const PP = require(path.join(__dirname, '..', 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const SOLO = [2, 6, 10, 15, 24, 38, 55], DUO = [3, 10, 16, 24, 38, 61, 88];
const LPS = [];
for (let lp = 0; lp <= PP.LP_MAX; lp += 7) LPS.push(lp);
for (const s of PP.LP_SEG) for (const x of [s.min - 121, s.min - 120, s.min - 1, s.min, s.min + 1, s.min + 120, s.min + 121]) if (x >= 0 && x <= PP.LP_MAX) LPS.push(x);
LPS.push(PP.LP_MAX);
const SKILLS = (lines) => [null, 0].concat(lines.map((x) => x * 100), lines.map((x) => x * 100 + 49), [99999]);

// ---- the checks, as functions of a module (the mutations below rerun them on edited copies) ----
function signErrors(M) {
  const errs = [];
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) for (const isPass of [true, false]) {
    const r = M.endlessDelta(lp, isPass, h, lines, o), s = M.endlessSettle(lp, isPass, h, lines, o);
    if (isPass ? !(r.d >= 1 && s.nv >= lp) : !(r.d <= -1 && s.nv <= lp)) errs.push([lp, isPass, h, o, r.d, s.nv]);
  }
  return errs;
}
function swingErrors(M) {
  const errs = [];
  let max = 0;
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) for (const isPass of [true, false]) {
    const r = M.endlessDelta(lp, isPass, h, lines, o);
    max = Math.max(max, Math.abs(r.d));
    if (Math.abs(r.d) >= M.BOUNDARY_MARGIN) errs.push([lp, isPass, h, o, r.d]);
    const s = M.endlessSettle(lp, isPass, h, lines, o);
    if (M.boundaryOf(lp) == null && M.lpTierIdx(s.nv) !== M.lpTierIdx(lp) && s.nv !== M.LP_MAX) errs.push(['tier', lp, isPass, h, o, s.nv]);
  }
  return { errs, max };
}
function seriesErrors(M) {
  const errs = [];
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) {
    const b = M.boundaryOf(lp), cur = M.lpTierIdx(lp), ht = M.tierOfHidden(h, lines);
    const up = M.endlessSettle(lp, true, h, lines, o);
    if (b === 'promotion' && !(M.lpTierIdx(up.nv) === cur + 1)) errs.push(['promo', lp, h, o, up.nv]);
    const dn = M.endlessSettle(lp, false, h, lines, o);
    const guarded = ht != null && ht >= cur;
    if (guarded && M.lpTierIdx(dn.nv) !== cur) errs.push(['protect', lp, h, o, dn.nv]);
    if (b === 'relegation' && !guarded && dn.nv > M.LP_SEG[cur].min - M.RELEG_LAND) errs.push(['releg', lp, h, o, dn.nv]);   // forced down (a natural drop past it is kept)
    if (dn.protect && !guarded) errs.push(['flag', lp, h, o]);
  }
  return errs;
}
function seedErrors(M) {
  const errs = [];
  for (const lines of [SOLO, DUO]) {
    let prev = -1;
    for (let h = 0; h <= 10000; h += 13) {
      const s = M.endlessSeedLp(h, lines);
      if (M.boundaryOf(s) != null || s > M.ELP.SEED_CAP || s < 0 || s < prev) errs.push([h, s, prev]);
      prev = s;
    }
  }
  return errs;
}
function hiddenErrors(M) {
  const errs = [];
  const want = (d) => { const w = d.slice(0, 10).map((x) => Math.max(0, x)); if (w.length < 5) return null; const s = w.slice().sort((a, b) => a - b).slice(1, -1); return Math.round(s.reduce((a, b) => a + b, 0) * 100 / s.length); };
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  for (let i = 0; i < 400; i++) {
    const n = rnd() % 14, d = [];
    for (let j = 0; j < n; j++) d.push((rnd() % 60) - 3);
    if (M.hiddenOf(d) !== want(d)) errs.push(['hidden', J(d), M.hiddenOf(d), want(d)]);
    const p = d.slice(0, 10).map((x) => Math.max(0, x));
    const wp = p.length >= 5 ? want(d) : (p.length ? Math.round(p.reduce((a, b) => a + b, 0) * 100 / p.length) : null);
    if (M.hiddenOf(d, 1) !== wp) errs.push(['placing', J(d), M.hiddenOf(d, 1), wp]);
  }
  return errs;
}

console.log('=== O728 endless points (points-plan.js ELP) ===');
// [1]
{
  const e = signErrors(PP);
  T('[1] every pass gains and every miss loses (' + LPS.length + ' points values x skills x offsets x 2 line sets)', !e.length, J(e.slice(0, 3)));
}
// [2]
{
  const { errs, max } = swingErrors(PP);
  T('[2] the largest swing of one run (' + max + ') stays under BOUNDARY_MARGIN ' + PP.BOUNDARY_MARGIN + ', and outside a band the tier holds', !errs.length && max < PP.BOUNDARY_MARGIN, J(errs.slice(0, 3)));
  T('[2] the largest swing is the bronze pass with a higher skill on a harder target (45 x 1.5 x 1.2 + 5 = 86)', max === 86 && PP.endlessDelta(0, true, 5500, SOLO, 2).d === 86, String(max));
}
// [3]
{
  const e = seriesErrors(PP);
  T('[3] series: a promotion-band pass crosses up; a relegation-band miss crosses down unless protected; protected never leaves its tier', !e.length, J(e.slice(0, 3)));
  const p = PP.endlessSettle(2050, false, 1000, SOLO, 0), q = PP.endlessSettle(2050, false, 600, SOLO, 0);
  T('[3] 2050 gold miss: skill gold = protected (2033), skill silver = forced down (1985)', p.protect && p.nv === 2033 && !q.protect && q.clamped && q.nv === 1985, J([p, q]));
  const f = PP.endlessSettle(2000, false, 1000, SOLO, 0);
  T('[3] a protected miss at the tier floor changes nothing (d 0)', f.protect && f.d === 0 && f.nv === 2000, J(f));
  const g = PP.endlessSettle(2500, false, 1000, SOLO, 0);
  T('[3] protection that moves nothing is not reported (2500 miss, skill gold)', !g.protect && g.plan.protect && g.d === -17, J(g));
}
// [4]
{
  const errs = [];
  for (let t = 0; t < 7; t++) {
    const lp = PP.LP_SEG[t].min + 300;
    for (const isPass of [true, false]) {
      const same = PP.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, 0).d;
      const none = PP.endlessDelta(lp, isPass, null, SOLO, 0).d;
      if (same !== none) errs.push(['none', t, isPass]);
      if (t < 6 && !(PP.endlessDelta(lp, isPass, SOLO[t + 1] * 100, SOLO, 0).d >= same)) errs.push(['above', t, isPass]);
      if (t > 0 && !(PP.endlessDelta(lp, isPass, SOLO[t - 1] * 100, SOLO, 0).d <= same)) errs.push(['below', t, isPass]);
      for (let o = -2; o < 2; o++) if (!(PP.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, o + 1).d >= PP.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, o).d)) errs.push(['stake', t, isPass, o]);
    }
  }
  T('[4] a higher skill and a harder target never cost points; no skill = the same tier', !errs.length, J(errs.slice(0, 4)));
  T('[4] the gold table of the plan (pass +38 / miss -17; skill above +56 / -7; skill below +21 / -27)',
    J([1000, 1500, 600].map((h) => [PP.endlessDelta(2500, true, h, SOLO, 0).d, PP.endlessDelta(2500, false, h, SOLO, 0).d])) === J([[38, -17], [56, -7], [21, -27]]));
}
// [5]
{
  const e = hiddenErrors(PP);
  T('[5] hidden skill = the trimmed mean of the newest 10 (null under 5); the placement read = the plain mean under 5', !e.length, J(e.slice(0, 3)));
  T('[5] tierOfHidden: the nearest line, the lower tier on a tie, null without a skill', PP.tierOfHidden(950, SOLO) === 2 && PP.tierOfHidden(400, SOLO) === 0 && PP.tierOfHidden(401, SOLO) === 1 && PP.tierOfHidden(null, SOLO) === null && PP.tierOfHidden(500, null) === null);
}
// [6]
{
  const cnt = [0, 0, 0, 0, 0];
  let same = true, range = true;
  for (let s = 0; s < 5000; s++) {
    const o = PP.targetOffset(s);
    if (!(o >= -2 && o <= 2)) range = false; else cnt[o + 2]++;
    const neg = (s * 2654435761) | 0;
    if (PP.targetOffset(neg) !== PP.targetOffset(neg >>> 0)) same = false;
  }
  T('[6] offsets -2..+2, each 12-28 % of 5000 seeds (' + cnt.join(' / ') + ')', range && cnt.every((c) => c >= 600 && c <= 1400));
  T('[6] a signed and an unsigned seed of the same bits read the same offset', same);
  const errs = [];
  for (let t = 0; t < 7; t++) for (let s = 0; s < 40; s++) { const T0 = PP.targetOf(PP.LP_SEG[t].min + 50, SOLO, s, null, false); if (T0 !== Math.max(1, SOLO[t] + PP.targetOffset(s))) errs.push([t, s, T0]); }
  T('[6] target = the points tier line + offset, at least 1', !errs.length && PP.targetOf(0, SOLO, 1, null, false) === 1, J(errs.slice(0, 3)));
  T('[6] placement: no run yet = the silver line; a skill = its tier line', PP.targetOf(9000, SOLO, 0, null, true) === SOLO[1] + PP.targetOffset(0) && PP.targetOf(0, SOLO, 0, 2400, true) === SOLO[4] + PP.targetOffset(0));
}
// [7]
{
  const e = seedErrors(PP);
  T('[7] the seed sits outside both series bands, at most SEED_CAP ' + PP.ELP.SEED_CAP + ', never lower for a higher skill', !e.length, J(e.slice(0, 3)));
  T('[7] a skill at a line seeds just above that tier\'s relegation band; at or above platinum caps', PP.endlessSeedLp(1000, SOLO) === 2121 && PP.endlessSeedLp(2000, SOLO) === 3200 && PP.endlessSeedLp(null, SOLO) === 0);
}
// [8]
{
  const ring = PP.receiptPush(PP.receiptPush([], 77, -13, PP.ELP.PROTECT_RS, 0xff), -5, 40, PP.RECEIPT_F.SERIES, 0xff);
  const det = PP.elpRowDetails({ n: 7, hidden100: 950, tier: 1, placed: 1 }, ring);
  const back = PP.elpRowOf(det);
  T('[8] the family row round-trips (64 ints at most; the receipt of a run by its id)', det.length <= 64 && back && back.n === 7 && back.hidden100 === 950 && back.tier === 1 && back.placed && J(back.ring) === J(ring)
    && PP.elpReceiptOf(det, -5).delta === 40 && PP.elpReceiptOf(det, 12) === null, J(back));
  const full = PP.elpRowDetails({ n: 99, hidden100: null, tier: 6, placed: 1 }, new Array(12).fill(0).map((x, i) => ({ mh: i, delta: i, flags: 0 })));
  T('[8] a full ring keeps 8 receipts (31 ints); hidden null writes -1 and reads null', full.length === 31 && PP.elpRowOf(full).ring.length === 8 && PP.elpRowOf(full).hidden100 === null);
  T('[8] another row layout reads as none (the O103 rating row, v2, another magic)', PP.elpRowOf([1200, 950, 6, 0]) === null && PP.elpRowOf([0xEE | 512, 1, 1, 1, 1, 198, 0]) === null && PP.elpRowOf([0xEF | 256, 1, 1, 1, 1, 198, 0]) === null);
  const tbl = PP.elpTableDetails(1, { solo: { N: 30, pass: SOLO } });
  const tb = PP.elpTableOf(20261201, tbl);
  T('[8] the table round-trips (39 ints; a family without data carries its prior with N 0; rulesSame)', tbl.length === 39 && tb && tb.day === 20261201 && tb.season === 1 && J(tb.byFam.solo.pass) === J(SOLO) && tb.byFam.solo.N === 30
    && J(tb.byFam.quad.pass) === J(PP.ELP.PRIOR.quad) && tb.byFam.quad.N === 0 && tb.rulesSame === true);
  const v1 = [0xEC | 256, 0].concat(new Array(28).fill(0)), v3 = tbl.slice(); v3[0] = 0xEC | (3 << 8);
  const other = tbl.slice(); other[4] = 400;
  T('[8] a v1 cut table and an unknown v3 read as none; another constant reads with rulesSame false', PP.elpTableOf(1, v1) === null && PP.elpTableOf(1, v3) === null && PP.elpTableOf(1, other).rulesSame === false && PP.elpTableOf(1, tbl.slice(0, 38)) === null);
  T('[8] the priors: 7 lines a family, rising by at least 1 (the table needs a monotone list)', PP.ELP_FAMS.every((f) => PP.ELP.PRIOR[f].length === 7 && PP.ELP.PRIOR[f].every((x, i, a) => i === 0 || x >= a[i - 1] + 1)));
}
// [9] mutations
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  const mut = (label, from, to) => {
    if (SRC.indexOf(from) < 0) { bad('[9] mutation anchor missing: ' + label); return null; }
    const win = {};
    try { new Function('window', SRC.split(from).join(to))(win); } catch (e) { bad('[9] mutation ' + label + ' does not load: ' + e.message); return null; }
    return win.POINTS_PLAN;
  };
  const floor = 'd = isPass ? Math.max(1, d) : Math.min(-1, d);';
  {
    T('[9] mutation anchor: the sign floor line', SRC.indexOf(floor) >= 0);
    const both = (() => { const win = {}; new Function('window', SRC.split(floor).join('').split('GAP_DOWN: 500').join('GAP_DOWN: 300'))(win); return win.POINTS_PLAN; })();
    T('[9] the sign floor removed (with GAP_DOWN 300) turns [1] red', signErrors(both).length > 0);
    const kept = mut('GAP_DOWN 300 with the floor', 'GAP_DOWN: 500', 'GAP_DOWN: 300');
    T('[9] ... and with the floor kept [1] stays green (the floor is what holds)', kept && signErrors(kept).length === 0);
  }
  const g = mut('GAP_UP 2500', 'GAP_UP: 1500', 'GAP_UP: 2500');
  T('[9] GAP_UP 2500 (a bronze pass 140) turns [2] red', g && swingErrors(g).errs.length > 0);
  const st = mut('STAKE_STEP 600', 'STAKE_STEP: 100', 'STAKE_STEP: 600');
  T('[9] STAKE_STEP 600 turns [2] red', st && swingErrors(st).errs.length > 0);
  const np = mut('no protection', 'if (r.protect) {', 'if (false) {');
  T('[9] the protection removed turns [3] red', np && seriesErrors(np).length > 0);
  const nc = mut('no series clamp on a miss', 'const plain = settleLine(cur, { adjDelta: r.d, flag: 0, won: !!isPass }, 0, 0, false);', 'const plain = settleLine(cur, { adjDelta: r.d, flag: isPass ? 0 : 2, won: !!isPass }, 0, 0, false);');
  T('[9] the series clamp skipped on every miss turns [3] red', nc && seriesErrors(nc).length > 0);
  const gd = mut('gap read backwards', '((ht > cur) === !!isPass ? ELP.GAP_UP : ELP.GAP_DOWN)', '((ht > cur) === !!isPass ? ELP.GAP_DOWN : ELP.GAP_UP)');
  T('[9] the gap read backwards turns [4] red', gd && PP.endlessDelta(2500, true, 1500, SOLO, 0).d !== gd.endlessDelta(2500, true, 1500, SOLO, 0).d && gd.endlessDelta(2500, true, 1500, SOLO, 0).d < gd.endlessDelta(2500, true, 1000, SOLO, 0).d);
  const tr = mut('TRIM 0', 'TRIM: 1', 'TRIM: 0');
  T('[9] TRIM 0 turns [5] red', tr && hiddenErrors(tr).length > 0);
  const sb = mut('seed on the band edge', 'lo + BOUNDARY_MARGIN + 1', 'lo + BOUNDARY_MARGIN');
  T('[9] the seed allowed on the relegation band edge turns [7] red', sb && seedErrors(sb).length > 0);
  const sc = mut('SEED_CAP 4100', 'SEED_CAP: 3200', 'SEED_CAP: 4100');
  T('[9] a seed cap inside diamond turns [7] red', sc && seedErrors(sc).length > 0);
}

console.log(failN ? ('endless-lp: ' + failN + ' FAIL') : 'endless-lp: all ok');
process.exit(failN ? 1 : 0);
