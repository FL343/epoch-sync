'use strict';
// O728 endless competitive points (points-plan.js ELP, version 2: the versus-shaped rules of the user's call 2026-11-08): the pure
// rules both repos run. (test/endless-lp-sim.js simulates players over them; this file pins each rule.)
//   [1] the sign never flips: every pass gains (d >= 1 before the clamp; the points never go down), every miss loses (d <= -1;
//       the points never go up) -- over every tier, skill, offset and the board bounds
//   [2] one run never moves the points by BOUNDARY_MARGIN or more (SWING_CAP binds): outside a series band the tier holds
//   [3] series, floor, gate: a promotion-band pass crosses up (where the skill lets it); below master a miss never leaves the tier
//       (the floor); at master and up a relegation-band miss crosses down unless the skill tier is at or above the points tier; the
//       gate keeps the points BOUNDARY_MARGIN + 1 under the master line (grandmaster line) until the skill reaches that line
//   [4] the factors: a skill tier above the points gains more / loses less (any tier); below it: the same as the same tier below
//       master, stricter at master and up; a harder target never costs points; the per-tier multiplier
//   [5] the hidden skill (the newest WINDOW runs, trimmed from MIN_RUNS) and the two tier readings (nearest line / the gate's)
//   [6] the target: TARGET_Q of the hidden skill + the offset (signed / unsigned seeds alike, each offset 12-28 % of seeds), at
//       least 1; the silver line before any run; the points and the placement flag do not move it
//   [7] the placement seed: outside both series bands, at most SEED_CAP, never lower for a higher skill
//   [8] the family row and the published table round-trip; a v1 table / another row layout read as none
//   [9] mutations: each guard above turns red on the change it guards against
//  [10] O803 (ELP v3) the one target of a team run: teamHiddenOf = the equal-weight mean of the seats that have a skill (the
//       nulls leave, nobody = null, one seat = itself, rounded), the six shapes of the golden cases; two seats of one run with
//       different skills read the SAME target from it (targetOf in the hidden100 position) while their points (endlessDelta /
//       endlessSettle with their own skill) differ and keep one sign; the fixtures carry the function. Mutations: the mean read
//       as the maximum -> red; the null filter dropped -> red (a null seat then counts as 0 and nobody-with-a-skill reads 0)
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
for (const s of PP.LP_SEG) for (const x of [s.min - 122, s.min - 121, s.min - 120, s.min - 1, s.min, s.min + 1, s.min + 120, s.min + 121]) if (x >= 0 && x <= PP.LP_MAX) LPS.push(x);
LPS.push(PP.LP_MAX);
const SKILLS = (lines) => [null, 0].concat(lines.map((x) => x * 100), lines.map((x) => x * 100 - 1), lines.map((x) => x * 100 + 49), [99999]);
const GATE = (M) => M.ELP.GATE_TIER;

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
    const b = M.boundaryOf(lp), cur = M.lpTierIdx(lp), ht = M.tierOfHidden(h, lines), st = M.skillTierOf(h, lines);
    const allowed = Math.max(GATE(M) - 1, st == null ? 0 : st);   // the highest tier the skill lets the points enter
    const up = M.endlessSettle(lp, true, h, lines, o);
    if (b === 'promotion' && cur + 1 <= allowed && M.lpTierIdx(up.nv) !== cur + 1) errs.push(['promo', lp, h, o, up.nv]);
    if (cur + 1 > allowed && cur < 6 && up.nv > Math.max(lp, M.LP_SEG[cur + 1].min - M.BOUNDARY_MARGIN - 1)) errs.push(['gate', lp, h, o, up.nv]);
    if (cur < 6 && cur + 1 > allowed && M.lpTierIdx(up.nv) > cur) errs.push(['gate-tier', lp, h, o, up.nv]);
    const dn = M.endlessSettle(lp, false, h, lines, o);
    if (cur < GATE(M) && M.lpTierIdx(dn.nv) !== cur) errs.push(['floor', lp, h, o, dn.nv]);
    const guarded = cur < GATE(M) || (ht != null && ht >= cur);
    if (guarded && M.lpTierIdx(dn.nv) !== cur) errs.push(['protect', lp, h, o, dn.nv]);
    if (b === 'relegation' && !guarded && dn.nv > M.LP_SEG[cur].min - M.RELEG_LAND) errs.push(['releg', lp, h, o, dn.nv]);   // forced down (a natural drop past it is kept)
    if (dn.protect && !guarded) errs.push(['flag', lp, h, o]);
  }
  return errs;
}
function factorErrors(M) {
  const errs = [];
  for (let t = 0; t < 7; t++) {
    const lp = M.LP_SEG[t].min + 300;
    for (const isPass of [true, false]) {
      const same = M.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, 0).d;
      if (same !== M.endlessDelta(lp, isPass, null, SOLO, 0).d) errs.push(['none', t, isPass]);
      if (t < 6 && !(M.endlessDelta(lp, isPass, SOLO[t + 1] * 100, SOLO, 0).d > same)) errs.push(['above', t, isPass]);
      if (t > 0) {
        const below = M.endlessDelta(lp, isPass, SOLO[t - 1] * 100, SOLO, 0).d;
        if (t < GATE(M) ? below !== same : !(below < same)) errs.push(['below', t, isPass, below, same]);
      }
      for (let o = -2; o < 2; o++) if (!(M.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, o + 1).d >= M.endlessDelta(lp, isPass, SOLO[t] * 100, SOLO, o).d)) errs.push(['stake', t, isPass, o]);
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

// O803 [10]: the shapes every teamHiddenOf copy must give (the golden cases pin the same six; the mutations below rerun this)
function teamErrors(M) {
  const errs = [];
  const want = [[[], null], [[null], null], [[null, null, null], null], [[1200], 1200], [[1200, 800], 1000], [[1200, null, 801], 1001], [[0, 0], 0], [[950, 1200, 400, 1050], 900], [[300, 301], 301], [[null, 7], 7], [[800, 1200], 1000]];
  for (const [list, out] of want) if (M.teamHiddenOf(list) !== out) errs.push([J(list), M.teamHiddenOf(list), out]);
  if (M.teamHiddenOf(null) !== null || M.teamHiddenOf(undefined) !== null) errs.push(['no list', M.teamHiddenOf(null)]);
  // one seat = its own skill, whatever it is (the solo / couch reading)
  for (const h of [0, 1, 650, 2400, 12345]) if (M.teamHiddenOf([h]) !== h) errs.push(['one seat', h, M.teamHiddenOf([h])]);
  return errs;
}
// O803 [10]: a pair of one run (same lines, same seed) with different skills: one target from the team level, their own points
function pairErrors(M) {
  const errs = [];
  for (const lines of [SOLO, DUO]) for (const [lpA, hA, lpB, hB] of [[2500, 2000, 429, 800], [1000, 600, 4500, 2400], [6500, 3800, 300, 150], [9000, 5500, 2200, 1000]]) {
    let differ = false;
    for (let s = 0; s < 25; s++) {
      const th = M.teamHiddenOf([hA, hB]), TA = M.targetOf(lpA, lines, s, th, false), TB = M.targetOf(lpB, lines, s, th, false);
      if (TA !== TB) errs.push(['T', lpA, hA, lpB, hB, s, TA, TB]);
      const o = M.targetOffset(s);
      for (const pass of [true, false]) {
        const dA = M.endlessDelta(lpA, pass, hA, lines, o).d, dB = M.endlessDelta(lpB, pass, hB, lines, o).d;
        if (Math.sign(dA) !== Math.sign(dB)) errs.push(['sign', lpA, hA, lpB, hB, s, pass, dA, dB]);
        if (dA !== dB) differ = true;
      }
    }
    if (!differ) errs.push(['same d everywhere', lpA, hA, lpB, hB]);   // the points read each seat's own numbers (a coincidence at one seed is fine)
  }
  return errs;
}

console.log('=== O728 endless points (points-plan.js ELP v' + PP.ELP.VER + ') ===');
// [1]
{
  const e = signErrors(PP);
  T('[1] every pass gains and every miss loses (' + LPS.length + ' points values x skills x offsets x 2 line sets)', !e.length, J(e.slice(0, 3)));
}
// [2]
{
  const { errs, max } = swingErrors(PP);
  T('[2] the largest change of one run (' + max + ') stays under BOUNDARY_MARGIN ' + PP.BOUNDARY_MARGIN + ', and outside a band the tier holds', !errs.length && max < PP.BOUNDARY_MARGIN, J(errs.slice(0, 3)));
  T('[2] SWING_CAP binds (' + PP.ELP.SWING_CAP + ': a platinum pass with a higher skill on a harder target would be ' + Math.round((31 * 1.5 * 1.2 + 2) * PP.ELP.MUL[3] / 1000) + ')', max === PP.ELP.SWING_CAP && PP.endlessDelta(3500, true, 2400, SOLO, 2).d === PP.ELP.SWING_CAP && PP.ELP.SWING_CAP === PP.BOUNDARY_MARGIN - 1);
}
// [3]
{
  const e = seriesErrors(PP);
  T('[3] series / floor / gate over every case (promotion where the skill lets it, no drop below master, forced drop at master and up unless protected, the gate)', !e.length, J(e.slice(0, 4)));
  const a = PP.endlessSettle(2050, false, 600, SOLO, 0), b = PP.endlessSettle(2010, false, 600, SOLO, -2);
  T('[3] below master a miss never leaves the tier, whatever the skill: 2050 gold miss (skill silver) -> ' + a.nv + '; 2010 miss -> held at 2000', a.nv >= 2000 && b.nv === 2000 && b.protect, J([a, b]));
  const c = PP.endlessSettle(8050, false, 3800, SOLO, 0), d = PP.endlessSettle(8050, false, 5500, SOLO, 0);
  T('[3] grandmaster line 8050: a miss with the skill at master drops to master (forced to 7985, or further by itself); with the skill at grandmaster it is protected', c.nv <= 7985 && PP.lpTierIdx(c.nv) === 5 && d.nv >= 8000 && d.protect, J([c, d]));
  const g = PP.endlessSettle(5850, true, 3700, SOLO, 2), g2 = PP.endlessSettle(5850, true, 3800, SOLO, 2), g3 = PP.endlessSettle(5870, true, 3700, SOLO, 0);
  T('[3] the master gate: skill 3700 (nearer the master line, not on it) stops at 5879; skill 3800 enters the band and the promotion', g.nv === 5879 && g.gated && g2.nv > 5879 && !g2.gated && g3.nv === 5879, J([g, g2, g3]));
  const h = PP.endlessSettle(7850, true, 5000, SOLO, 2), h2 = PP.endlessSettle(7950, true, 5500, SOLO, 0);
  const h3 = PP.endlessSettle(7950, true, 5500, SOLO, -2);
  T('[3] the grandmaster gate: skill 5000 stops at 7879; skill 5500 is promoted (to 8010 at least)', h.nv === 7879 && h.gated && h2.nv >= 8010 && PP.lpTierIdx(h2.nv) === 6 && h3.nv >= 8010, J([h, h2, h3]));
  const k = PP.endlessSettle(6500, true, 3000, SOLO, 0);
  T('[3] already at master: the gate never pushes the points down (a pass still gains, held by the strict factor instead)', k.nv > 6500 && !k.gated, J(k));
  const f = PP.endlessSettle(2500, false, 1000, SOLO, 0);
  T('[3] a protection that moves nothing is not reported (2500 miss)', !f.protect && f.plan.protect && f.d === f.d0, J(f));
}
// [4]
{
  const e = factorErrors(PP);
  T('[4] skill above the points gains more / loses less; below it the same as the same tier under master, stricter at master and up; a harder target never costs', !e.length, J(e.slice(0, 4)));
  T('[4] gold 2500 (MUL ' + PP.ELP.MUL[2] + '): pass 57 / miss -25; skill above 83 / -10; skill below = the same',
    J([1000, 1500, 600].map((hh) => [PP.endlessDelta(2500, true, hh, SOLO, 0).d, PP.endlessDelta(2500, false, hh, SOLO, 0).d])) === J([[57, -25], [83, -10], [57, -25]]));
  T('[4] grandmaster: the zero-sum table x MUL (pass ' + PP.endlessDelta(9000, true, 5500, SOLO, 0).d + ' / miss ' + PP.endlessDelta(9000, false, 5500, SOLO, 0).d + ')', PP.endlessDelta(9000, true, 5500, SOLO, 0).d === -PP.endlessDelta(9000, false, 5500, SOLO, 0).d);
  T('[4] MUL: 7 per-mille factors, one per tier', PP.ELP.MUL.length === 7 && PP.ELP.MUL.every((x) => Number.isInteger(x) && x > 0));
}
// [5]
{
  const e = hiddenErrors(PP);
  T('[5] hidden skill = the trimmed mean of the newest 10 (null under 5); the placement read = the plain mean under 5', !e.length, J(e.slice(0, 3)));
  T('[5] tierOfHidden: the nearest line, the lower tier on a tie, null without a skill', PP.tierOfHidden(950, SOLO) === 2 && PP.tierOfHidden(400, SOLO) === 0 && PP.tierOfHidden(401, SOLO) === 1 && PP.tierOfHidden(null, SOLO) === null && PP.tierOfHidden(500, null) === null);
  const got = [3400, 3799, 3800, 5000, 5499, 5500, 1200, null].map((x) => PP.skillTierOf(x, SOLO)), want = [4, 4, 5, 5, 5, 6, 2, null];
  T('[5] skillTierOf: master / grandmaster only on reaching their line (3400 -> diamond though nearer master; 5000 -> master though nearer grandmaster) = ' + J(got), J(got) === J(want));
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
  for (const h of [100, 650, 1000, 2400, 5600, 12345]) for (let s = 0; s < 40; s++) for (const lp of [0, 2500, 9000]) for (const pl of [false, true]) {
    const T0 = PP.targetOf(lp, SOLO, s, h, pl);
    if (T0 !== Math.max(1, Math.round(h * PP.ELP.TARGET_Q / 100000) + PP.targetOffset(s))) errs.push([h, s, lp, pl, T0]);
  }
  T('[6] target = TARGET_Q (' + PP.ELP.TARGET_Q + ') of the hidden skill + the offset, at least 1; the points and the placement flag do not move it', !errs.length && PP.targetOf(0, SOLO, 1, 100, false) === 1, J(errs.slice(0, 3)));
  T('[6] targetOf = max(1, targetLineOf + the offset); targetLineOf = the base line (the dial middle), below the floor of 1 too', [100, 1849, 6000, null].every((h) => [0, 3, 9].every((s) => PP.targetOf(500, SOLO, s, h, false) === Math.max(1, PP.targetLineOf(500, SOLO, h, false) + PP.targetOffset(s)))) && PP.targetLineOf(0, SOLO, 40, false) === 0 && PP.targetLineOf(0, SOLO, 1849, true) === 18);
  T('[6] no skill yet (the first placement run): the silver line + the offset', PP.targetOf(9000, SOLO, 0, null, true) === SOLO[1] + PP.targetOffset(0) && PP.targetOf(0, DUO, 3, null, false) === Math.max(1, DUO[1] + PP.targetOffset(3)));
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
  T('[8] the family row round-trips (64 ints at most; the receipt of a run by its key)', det.length <= 64 && back && back.n === 7 && back.hidden100 === 950 && back.tier === 1 && back.placed && J(back.ring) === J(ring)
    && PP.elpReceiptOf(det, -5).delta === 40 && PP.elpReceiptOf(det, 12) === null, J(back));
  const full = PP.elpRowDetails({ n: 99, hidden100: null, tier: 6, placed: 1 }, new Array(12).fill(0).map((x, i) => ({ mh: i, delta: i, flags: 0 })));
  T('[8] a full ring keeps 8 receipts (31 ints); hidden null writes -1 and reads null', full.length === 31 && PP.elpRowOf(full).ring.length === 8 && PP.elpRowOf(full).hidden100 === null);
  T('[8] another row layout reads as none (the O103 rating row, v2, another magic)', PP.elpRowOf([1200, 950, 6, 0]) === null && PP.elpRowOf([0xEE | 512, 1, 1, 1, 1, 198, 0]) === null && PP.elpRowOf([0xEF | 256, 1, 1, 1, 1, 198, 0]) === null);
  const tbl = PP.elpTableDetails(1, { solo: { N: 30, pass: SOLO } });
  const tb = PP.elpTableOf(20261201, tbl);
  T('[8] the table round-trips (39 ints; a family without data carries its prior with N 0; rulesSame)', tbl.length === 39 && tb && tb.day === 20261201 && tb.season === 1 && J(tb.byFam.solo.pass) === J(SOLO) && tb.byFam.solo.N === 30
    && J(tb.byFam.quad.pass) === J(PP.ELP.PRIOR.quad) && tb.byFam.quad.N === 0 && tb.rulesSame === true && tb.ver === PP.ELP.VER);
  const v1 = [0xEC | 256, 0].concat(new Array(28).fill(0)), v3 = tbl.slice(); v3[0] = 0xEC | (3 << 8);
  const other = tbl.slice(); other[2] = PP.ELP.VER - 1;
  T('[8] a v1 cut table and an unknown v3 read as none; another rules version reads with rulesSame false', PP.elpTableOf(1, v1) === null && PP.elpTableOf(1, v3) === null && PP.elpTableOf(1, other).rulesSame === false && PP.elpTableOf(1, tbl.slice(0, 38)) === null);
  T('[8] the priors: 7 lines a family, rising by at least 1 (the table needs a monotone list)', PP.ELP_FAMS.every((f) => PP.ELP.PRIOR[f].length === 7 && PP.ELP.PRIOR[f].every((x, i, a) => i === 0 || x >= a[i - 1] + 1)));
}
// [9] mutations
{
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  const mut = (label, pairs) => {
    let s = SRC;
    for (const [from, to] of pairs) { if (s.indexOf(from) < 0) { bad('[9] mutation anchor missing: ' + label + ' (' + from.slice(0, 60) + ')'); return null; } s = s.split(from).join(to); }
    const win = {};
    try { new Function('window', s)(win); } catch (e) { bad('[9] mutation ' + label + ' does not load: ' + e.message); return null; }
    return win.POINTS_PLAN;
  };
  const floor = 'd = isPass ? Math.max(1, d) : Math.min(-1, d);';
  const both = mut('no sign floor, GAP_DOWN 300', [[floor, ''], ['GAP_DOWN: 500', 'GAP_DOWN: 300']]);
  T('[9] the sign floor removed (with GAP_DOWN 300) turns [1] red', both && signErrors(both).length > 0);
  const kept = mut('GAP_DOWN 300 with the floor', [['GAP_DOWN: 500', 'GAP_DOWN: 300']]);
  T('[9] ... and with the floor kept [1] stays green (the floor is what holds)', kept && signErrors(kept).length === 0);
  const nc = mut('no swing cap', [['d = Math.max(-ELP.SWING_CAP, Math.min(ELP.SWING_CAP, d));', '']]);
  T('[9] the swing cap removed turns [2] red', nc && swingErrors(nc).errs.length > 0);
  const nf = mut('no floor below master', [['protect: !isPass && (cur < ELP.GATE_TIER || (ht != null && ht >= cur))', 'protect: !isPass && ht != null && ht >= cur']]);
  T('[9] the floor below master removed turns [3] red', nf && seriesErrors(nf).length > 0);
  const ng = mut('no gate', [['if (cur < line && nv > Math.max(cur, cap))', 'if (false)']]);
  T('[9] the gate removed turns [3] red', ng && seriesErrors(ng).length > 0);
  const gn = mut('the gate on the nearest line', [['    if (ht == null || ht < ELP.GATE_TIER) return ht;', '    return ht;']]);
  T('[9] the gate read from the nearest line (not the line itself) turns [3] / [5] red', gn && (seriesErrors(gn).length > 0 || J([3400, 5000].map((x) => gn.skillTierOf(x, SOLO))) !== J([4, 5])));
  const gd = mut('gap read backwards', [['if (ht != null && ht > cur) gap = isPass ? ELP.GAP_UP : ELP.GAP_DOWN;', 'if (ht != null && ht > cur) gap = isPass ? ELP.GAP_DOWN : ELP.GAP_UP;']]);
  T('[9] the gap read backwards turns [4] red', gd && factorErrors(gd).length > 0);
  const ns = mut('no strict factor at master and up', [['else if (ht != null && ht < cur && cur >= ELP.GATE_TIER) gap = isPass ? ELP.GAP_DOWN : ELP.GAP_UP;', '']]);
  T('[9] the strict factor at master and up removed turns [4] red', ns && factorErrors(ns).length > 0);
  const pull = mut('the strict factor below master too', [['else if (ht != null && ht < cur && cur >= ELP.GATE_TIER) gap', 'else if (ht != null && ht < cur) gap']]);
  T('[9] the strict factor below master too (the old pull down) turns [4] red', pull && factorErrors(pull).length > 0);
  const tr = mut('TRIM 0', [['TRIM: 1', 'TRIM: 0']]);
  T('[9] TRIM 0 turns [5] red', tr && hiddenErrors(tr).length > 0);
  const sb = mut('seed on the band edge', [['lo + BOUNDARY_MARGIN + 1', 'lo + BOUNDARY_MARGIN']]);
  T('[9] the seed allowed on the relegation band edge turns [7] red', sb && seedErrors(sb).length > 0);
  const sc = mut('SEED_CAP 4100', [['SEED_CAP: 3200', 'SEED_CAP: 4100']]);
  T('[9] a seed cap inside diamond turns [7] red', sc && seedErrors(sc).length > 0);
}

// [10] O803: the one target of a team run
{
  T('[10] ELP.VER is 3 (O803: the team run rule moved; the table carries it, an older client reads rulesSame false)', PP.ELP.VER === 3, String(PP.ELP.VER));
  const e = teamErrors(PP);
  T('[10] teamHiddenOf: the nulls leave, the rest average equally and round; nobody = null; one seat = itself ([] / [null] / [1200] / [1200, 800] = 1000 / [1200, null, 801] = 1001 / [0, 0] = 0)', !e.length, J(e.slice(0, 3)));
  const pe = pairErrors(PP);
  T('[10] two seats of one run with different skills (4 pairs x 25 seeds x 2 line sets): the same target from the team level; their points differ and keep one sign (both gain on a pass, both lose on a miss)', !pe.length, J(pe.slice(0, 3)));
  const th = PP.teamHiddenOf([2000, 800]);
  T('[10] the pair 2000 / 800 reads the team level 1400: target = targetOf(.., 1400) for both, not either own line (' + PP.targetOf(2500, DUO, 7, th, false) + ' vs own ' + PP.targetOf(2500, DUO, 7, 2000, false) + ' / ' + PP.targetOf(429, DUO, 7, 800, false) + ')',
    th === 1400 && PP.targetOf(2500, DUO, 7, th, false) === PP.targetOf(429, DUO, 7, th, false) && PP.targetOf(2500, DUO, 7, th, false) !== PP.targetOf(2500, DUO, 7, 2000, false) && PP.targetOf(429, DUO, 7, th, false) !== PP.targetOf(429, DUO, 7, 800, false));
  T('[10] nobody with a skill: the silver line (as a first placement run); undefined seats count as nulls', PP.targetLineOf(0, DUO, PP.teamHiddenOf([null, null]), false) === DUO[1] && PP.teamHiddenOf([undefined, 900]) === 900);
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'points-plan', 'cases.json'), 'utf8'));
  const cases = doc.cases.filter((c) => c.kind === 'endless' && c.in.fn === 'teamHiddenOf');
  T('[10] the golden cases carry teamHiddenOf (6 at least) and replay (the client vendor replays the same file)', cases.length >= 6 && cases.every((c) => PP.teamHiddenOf.apply(null, c.in.args) === c.out), cases.length + ' cases');
  // mutations (the loader of [9])
  const SRC2 = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  const mut2 = (label, pairs) => {
    let s = SRC2;
    for (const [from, to] of pairs) { if (s.indexOf(from) < 0) { bad('[10] mutation anchor missing: ' + label + ' (' + from.slice(0, 60) + ')'); return null; } s = s.split(from).join(to); }
    const win = {};
    try { new Function('window', s)(win); } catch (e2) { bad('[10] mutation ' + label + ' does not load: ' + e2.message); return null; }
    return win.POINTS_PLAN;
  };
  const mx = mut2('the maximum instead of the mean', [['return Math.round(sum / xs.length) | 0;', 'return Math.max.apply(null, xs) | 0;']]);
  T('[10] the team level read as the strongest seat turns the shapes red (1200 / 800 would read 1200)', mx && teamErrors(mx).length > 0 && mx.teamHiddenOf([1200, 800]) === 1200);
  const nn = mut2('no null filter', [['.filter((x) => x != null).map((x) => x | 0);', '.map((x) => x | 0);']]);
  T('[10] the null filter dropped turns the shapes red (a seat without a skill counts as 0; nobody-with-a-skill reads 0, not null)', nn && teamErrors(nn).length > 0 && nn.teamHiddenOf([1200, null, 801]) !== 1001 && nn.teamHiddenOf([null]) !== null);
  const pr = mut2('pairs read their own skill', [['const xs = (Array.isArray(list) ? list : []).filter((x) => x != null).map((x) => x | 0);', 'const xs = (Array.isArray(list) ? list : []).filter((x) => x != null).map((x) => x | 0).slice(0, 1);']]);
  T('[10] the team level read from the first seat only turns the shapes red (and the pair check: the second seat keeps its own line)', pr && teamErrors(pr).length > 0);
}

console.log(failN ? ('endless-lp: ' + failN + ' FAIL') : 'endless-lp: all ok');
process.exit(failN ? 1 : 0);
