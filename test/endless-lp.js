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
//  [11] O825 (ELP v4) one points value over the four families:
//       - the family left out (or named solo) gives every value of version 3: fixtures/points-plan/elp-v3-solo.json (the 208 rule
//         cases of version 3, frozen) replays; [1]-[3] hold for the team families too (sign, swing cap, series / floor / gate)
//       - elpConvert: a line lands on the same line, the same table is the identity, never lower for a deeper run, there and back
//         within a few hundredths of a level, an independent reading agrees
//       - elpHiddenFor: with MIN_RUNS own runs it IS hiddenOf of them (a one-family player reads what version 3 read, the
//         placement reading too); short of them the newest runs of the other families fill, each read on this family's scale
//       - the team length factor (the user's call 2026-11-10: a pass gains three tenths more, a miss loses less; the cap stays):
//         below master a team pass is the solo one x 1.3 and a team miss the solo one / 1.3 (to the rounding, under the cap), the
//         multipliers are the eight pinned numbers; from master up nothing moves; team is reported exactly where it applied
//       - the team gate (the user's call: a tenth above the line): master / grandmaster open at the line x 1.10 for duo / trio /
//         quad, at the line itself for solo; below master the reading is the solo one
//       - the row v2 round-trips with the four skills; the v1 per-family row reads as none
//       Mutations: TEAM_GAIN 1000 / the factor on both pass and miss / the factor at master and up / TEAM_GATE 100 / a team family
//       by default / no borrowed runs / borrowed runs not converted / a convert without the lines / a v1 row read as a row -> red
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
function signErrors(M, fam) {
  const errs = [];
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) for (const isPass of [true, false]) {
    const r = M.endlessDelta(lp, isPass, h, lines, o, fam), s = M.endlessSettle(lp, isPass, h, lines, o, fam);
    if (isPass ? !(r.d >= 1 && s.nv >= lp) : !(r.d <= -1 && s.nv <= lp)) errs.push([lp, isPass, h, o, r.d, s.nv]);
  }
  return errs;
}
function swingErrors(M, fam) {
  const errs = [];
  let max = 0;
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) for (const isPass of [true, false]) {
    const r = M.endlessDelta(lp, isPass, h, lines, o, fam);
    max = Math.max(max, Math.abs(r.d));
    if (Math.abs(r.d) >= M.BOUNDARY_MARGIN) errs.push([lp, isPass, h, o, r.d]);
    const s = M.endlessSettle(lp, isPass, h, lines, o, fam);
    if (M.boundaryOf(lp) == null && M.lpTierIdx(s.nv) !== M.lpTierIdx(lp) && s.nv !== M.LP_MAX) errs.push(['tier', lp, isPass, h, o, s.nv]);
  }
  return { errs, max };
}
function seriesErrors(M, fam) {
  const errs = [];
  for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) {
    const b = M.boundaryOf(lp), cur = M.lpTierIdx(lp), ht = M.tierOfHidden(h, lines), st = M.skillTierOf(h, lines, fam);
    const allowed = Math.max(GATE(M) - 1, st == null ? 0 : st);   // the highest tier the skill lets the points enter
    const up = M.endlessSettle(lp, true, h, lines, o, fam);
    if (b === 'promotion' && cur + 1 <= allowed && M.lpTierIdx(up.nv) !== cur + 1) errs.push(['promo', lp, h, o, up.nv]);
    if (cur + 1 > allowed && cur < 6 && up.nv > Math.max(lp, M.LP_SEG[cur + 1].min - M.BOUNDARY_MARGIN - 1)) errs.push(['gate', lp, h, o, up.nv]);
    if (cur < 6 && cur + 1 > allowed && M.lpTierIdx(up.nv) > cur) errs.push(['gate-tier', lp, h, o, up.nv]);
    const dn = M.endlessSettle(lp, false, h, lines, o, fam);
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
  const det = PP.elpRowDetails({ n: 7, tier: 1, placed: 1, h: { solo: 950, duo: 1480, trio: null } }, ring);
  const back = PP.elpRowOf(det);
  T('[8] the points row (v2) round-trips: runs, tier, placed, the four skills (none = null), the receipts (64 ints at most; the receipt of a run by its key)', det.length <= 64 && back && back.n === 7 && back.tier === 1 && back.placed
    && J(back.h) === J({ solo: 950, duo: 1480, trio: null, quad: null }) && J(back.ring) === J(ring) && PP.elpReceiptOf(det, -5).delta === 40 && PP.elpReceiptOf(det, 12) === null, J(back));
  const full = PP.elpRowDetails({ n: 99, tier: 6, placed: 1, h: { solo: 0, duo: 4400, trio: 4400, quad: 4400 } }, new Array(12).fill(0).map((x, i) => ({ mh: i, delta: i, flags: 0 })));
  T('[8] a full ring keeps 8 receipts (34 ints); a skill of 0 writes 0 and reads 0 (not none)', full.length === 34 && PP.elpRowOf(full).ring.length === 8 && PP.elpRowOf(full).h.solo === 0 && PP.elpRowOf(full).h.quad === 4400);
  T('[8] another row layout reads as none (the O103 rating row, the v1 per-family row, v3, another magic, a short row)', PP.elpRowOf([1200, 950, 6, 0]) === null && PP.elpRowOf([0xEE | 256, 7, 950, 1, 1, 198, 0]) === null
    && PP.elpRowOf([0xEE | 768, 1, 1, 1, -1, -1, -1, -1, 198, 0]) === null && PP.elpRowOf([0xEF | 512, 1, 1, 1, -1, -1, -1, -1, 198, 0]) === null && PP.elpRowOf(det.slice(0, 9)) === null && PP.ELP.ROW_VER === 2);
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
  T('[10] ELP.VER is 3 or later (O803 moved it to 3: the team run rule; the table carries it, an older client reads rulesSame false)', PP.ELP.VER >= 3, String(PP.ELP.VER));
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

// ---- [11] O825: the checks, as functions of a module (the mutations rerun them on edited copies) ----
const TRIO = [3, 11, 18, 27, 40, 60, 85], QUAD = [4, 12, 20, 30, 44, 66, 90];
const LINES4 = { solo: SOLO, duo: DUO, trio: TRIO, quad: QUAD };
const TEAM_FAMS = ['duo', 'trio', 'quad'];
const FROZEN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'points-plan', 'elp-v3-solo.json'), 'utf8'));
const dropTeam = (o) => { if (Array.isArray(o)) return o.map(dropTeam); if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) if (k !== 'team') r[k] = dropTeam(o[k]); return r; } return o; };
// the frozen version 3 cases: the same values with the family left out, and with it named solo; never a team run
function frozenErrors(M) {
  const errs = [], FAM_AT = { skillTierOf: 2, endlessDelta: 5, endlessSettle: 5 };
  for (const c of FROZEN.cases) {
    const got = M[c.fn].apply(null, c.args);
    if (J(dropTeam(got)) !== J(c.out)) errs.push([c.name, 'no family']);
    if (c.fn === 'endlessDelta' && got.team !== false) errs.push([c.name, 'team']);
    if (c.fn === 'endlessSettle' && got.plan.team !== false) errs.push([c.name, 'plan.team']);
    if (FAM_AT[c.fn] != null) {
      const args = c.args.slice(); while (args.length < FAM_AT[c.fn]) args.push(undefined); args[FAM_AT[c.fn]] = 'solo';
      if (J(dropTeam(M[c.fn].apply(null, args))) !== J(c.out)) errs.push([c.name, 'solo named']);
    }
  }
  return errs;
}
// elpConvert against an independent reading, and its shape: lines land on lines, identity, monotone, there and back
function convertErrors(M) {
  const errs = [], sets = [SOLO, DUO, TRIO, QUAD, M.ELP.PRIOR.solo, M.ELP.PRIOR.duo];
  const want = (d100, from, to) => {
    const x = Math.max(0, d100);
    if (x <= from[0] * 100) return Math.round(x * to[0] / from[0]);
    for (let k = 0; k < 6; k++) if (x < from[k + 1] * 100) return Math.round(to[k] * 100 + (x - from[k] * 100) * (to[k + 1] - to[k]) / (from[k + 1] - from[k]));
    return Math.round(x * to[6] / from[6]);
  };
  for (const from of sets) for (const to of sets) {
    for (let k = 0; k < 7; k++) if (M.elpConvert(from[k] * 100, from, to) !== to[k] * 100) errs.push(['line', k, J(from), J(to), M.elpConvert(from[k] * 100, from, to)]);
    let prev = -1;
    for (let x = 0; x <= 12000; x += 7) {
      const y = M.elpConvert(x, from, to);
      if (y !== want(x, from, to) || !Number.isInteger(y) || y < 0) errs.push(['value', x, y, want(x, from, to)]);
      if (y < prev) errs.push(['monotone', x, y, prev]);
      prev = y;
      if (from === to && y !== x) errs.push(['identity', x, y]);
      const back = M.elpConvert(y, to, from);
      if (Math.abs(back - x) > 5) errs.push(['there and back', x, y, back]);
    }
  }
  if (M.elpConvert(0, SOLO, DUO) !== 0 || M.elpConvert(-50, SOLO, DUO) !== 0 || M.elpConvert(500, null, DUO) !== 500 || M.elpConvert(500, SOLO, [1, 2]) !== 500) errs.push(['edges']);
  return errs;
}
// elpHiddenFor against an independent reading over random run lists; a one-family player reads hiddenOf
function hiddenForErrors(M) {
  const errs = [], FAMS = ['solo', 'duo', 'trio', 'quad'];
  const want = (fam, runs, minRuns) => {
    const own = runs.filter((r) => r[0] === fam).slice(0, 10).map((r) => Math.max(0, r[1]) * 100);
    let list = own;
    if (own.length < 5) list = own.concat(runs.filter((r) => r[0] !== fam && LINES4[r[0]]).map((r) => M.elpConvert(Math.max(0, r[1]) * 100, LINES4[r[0]], LINES4[fam])).slice(0, 5 - own.length));
    if (!list.length || list.length < (minRuns == null ? 5 : minRuns)) return null;
    const use = list.length >= 5 ? list.slice().sort((a, b) => a - b).slice(1, -1) : list;
    return Math.round(use.reduce((a, b) => a + b, 0) / use.length);
  };
  let seed = 11;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 8; };
  for (let i = 0; i < 600; i++) {
    const n = rnd() % 16, runs = [], one = i % 3 === 0 ? FAMS[rnd() % 4] : null;
    for (let j = 0; j < n; j++) runs.push([one || (rnd() % 9 === 0 ? 'duoc' : FAMS[rnd() % 4]), (rnd() % 60) - 3]);
    for (const fam of FAMS) for (const m of [undefined, 1]) {
      const got = M.elpHiddenFor(fam, runs, LINES4, m);
      if (got !== want(fam, runs, m)) errs.push(['value', fam, m, J(runs), got, want(fam, runs, m)]);
      const own = runs.filter((r) => r[0] === fam).map((r) => r[1]);
      if (own.length >= 5 && got !== M.hiddenOf(own)) errs.push(['own five', fam, J(runs), got, M.hiddenOf(own)]);
      if (one === fam && got !== M.hiddenOf(own, m)) errs.push(['one family', fam, m, J(runs), got, M.hiddenOf(own, m)]);
    }
  }
  // the borrowed runs are the NEWEST of the other families, on this family's scale (two own duo runs + the three newest solo runs)
  const mix = [['solo', 10], ['duo', 20], ['solo', 15], ['solo', 24], ['duo', 14], ['solo', 2], ['solo', 2]];
  if (M.elpHiddenFor('duo', mix, LINES4) !== Math.round((2000 + 1600 + 2400) / 3)) errs.push(['the newest fill', M.elpHiddenFor('duo', mix, LINES4)]);
  if (M.elpHiddenFor('duo', [['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10]], LINES4) !== 1600) errs.push(['never played', M.elpHiddenFor('duo', [['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10]], LINES4)]);
  if (M.elpHiddenFor('duo', [], LINES4, 1) !== null || M.elpHiddenFor('duo', null, LINES4) !== null) errs.push(['no run']);
  return errs;
}
// the team length factor: below master a pass x TEAM_GAIN / 1000, a miss x 1000 / TEAM_GAIN; from master up nothing; team reported
const TEAM_MUL = { 850: [1105, 654], 1500: [1950, 1154], 3100: [4030, 2385], 2800: [3640, 2154] };   // the user's three tenths, pinned
function teamFactorErrors(M) {
  const errs = [], CAP = M.ELP.SWING_CAP;
  for (const fam of TEAM_FAMS) for (const lines of [SOLO, DUO]) for (const lp of LPS) for (const h of SKILLS(lines)) for (let o = -M.ELP.SPREAD; o <= M.ELP.SPREAD; o++) for (const isPass of [true, false]) {
    const a = M.endlessDelta(lp, isPass, h, lines, o), b = M.endlessDelta(lp, isPass, h, lines, o, fam), cur = M.lpTierIdx(lp);
    if (b.team !== (cur < GATE(M)) || M.endlessSettle(lp, isPass, h, lines, o, fam).plan.team !== b.team) errs.push(['flag', fam, lp, isPass, b.team]);
    if (cur >= GATE(M)) { if (b.d !== a.d || b.mul !== a.mul) errs.push(['master and up', fam, lp, isPass, a.d, b.d]); continue; }
    if (b.mul !== TEAM_MUL[M.ELP.MUL[cur]][isPass ? 0 : 1]) errs.push(['mul', fam, lp, isPass, b.mul]);
    if (b.gap !== a.gap || b.stake !== a.stake || b.base !== a.base || b.ht !== a.ht) errs.push(['other factors', fam, lp, isPass]);
    if (isPass) {
      if (!(b.d >= a.d && (b.d > a.d || a.d >= CAP))) errs.push(['pass gains more', fam, lp, h, o, a.d, b.d]);
      if (b.d < CAP && Math.abs(b.d - a.d * 1.3) > 1.2) errs.push(['pass x 1.3', fam, lp, h, o, a.d, b.d]);
    } else {
      if (!(b.d >= a.d && (b.d > a.d || a.d >= -5))) errs.push(['miss loses less', fam, lp, h, o, a.d, b.d]);
      if (a.d > -CAP && b.d < -1 && Math.abs(b.d - a.d / 1.3) > 1.2) errs.push(['miss / 1.3', fam, lp, h, o, a.d, b.d]);
    }
  }
  // a family that is no team family reads as none named
  for (const fam of ['solo', 'duoc', null, undefined, '']) for (const lp of [300, 2500, 3500, 5000, 7000]) for (const isPass of [true, false])
    if (J(M.endlessSettle(lp, isPass, 1600, DUO, 1, fam)) !== J(M.endlessSettle(lp, isPass, 1600, DUO, 1))) errs.push(['not a team family', String(fam), lp, isPass]);
  if (!TEAM_FAMS.every((f) => M.elpIsTeam(f)) || ['solo', 'duoc', null, undefined, 'all'].some((f) => M.elpIsTeam(f))) errs.push(['elpIsTeam']);
  return errs;
}
// the team gate: master / grandmaster at the line x TEAM_GATE / 100; below master the solo reading
function teamGateErrors(M) {
  const errs = [];
  for (const fam of TEAM_FAMS) for (const lines of [SOLO, DUO, TRIO, QUAD, M.ELP.PRIOR.duo]) {
    const hs = []; for (let h = 0; h <= 11000; h += 10) hs.push(h);
    for (const k of [5, 6]) hs.push(lines[k] * 100 - 1, lines[k] * 100, lines[k] * 110 - 1, lines[k] * 110);
    for (const h of hs) {
      const ht = M.tierOfHidden(h, lines), s0 = M.skillTierOf(h, lines), t = M.skillTierOf(h, lines, fam);
      const want = ht < 5 ? ht : (h >= lines[5] * 110 ? ((ht >= 6 && h >= lines[6] * 110) ? 6 : 5) : 4);
      if (t !== want || t > s0 || (ht < 5 && t !== s0)) errs.push([fam, J(lines), h, t, want, s0]);
    }
    // the settle: a diamond player on the master line is held under the team gate and promoted as solo
    const on = lines[5] * 100, a = M.endlessSettle(5850, true, on, lines, 2, fam), b = M.endlessSettle(5850, true, on, lines, 2), c = M.endlessSettle(5850, true, lines[5] * 110, lines, 2, fam);
    if (!(a.gated && a.nv === 5879 && !b.gated && b.nv > 5879 && !c.gated && c.nv > 5879)) errs.push(['settle', fam, J(lines), a.nv, b.nv, c.nv]);
  }
  if (M.skillTierOf(null, DUO, 'duo') !== null) errs.push(['no skill']);
  return errs;
}

// [11]
{
  const E = PP.ELP;
  T('[11] ELP v4: VER 4, ROW_VER 2, TEAM_GAIN 1300, TEAM_GATE 110 (the table keeps TC_VER 2 and carries the version)', E.VER === 4 && E.ROW_VER === 2 && E.TEAM_GAIN === 1300 && E.TEAM_GATE === 110 && E.TC_VER === 2 && PP.elpTableDetails(0, {})[2] === 4, J([E.VER, E.ROW_VER, E.TEAM_GAIN, E.TEAM_GATE]));
  const fe = frozenErrors(PP);
  T('[11] the family left out or named solo gives every value of version 3 (' + FROZEN.cases.length + ' frozen cases: hidden skill, tiers, the gate, targets, deltas, settles, seeds)', FROZEN.cases.length >= 200 && FROZEN.elpVer === 3 && !fe.length, J(fe.slice(0, 3)));
  for (const fam of TEAM_FAMS) {
    const se = signErrors(PP, fam), sw = swingErrors(PP, fam), sr = seriesErrors(PP, fam);
    T('[11] a ' + fam + ' run keeps [1]-[3]: every pass gains / every miss loses, the largest change ' + sw.max + ' stays under BOUNDARY_MARGIN, series / floor / gate', !se.length && !sw.errs.length && sw.max === E.SWING_CAP && !sr.length, J([se.slice(0, 2), sw.errs.slice(0, 2), sr.slice(0, 2)]));
  }
  const ce = convertErrors(PP);
  T('[11] elpConvert: a line lands on the same line, the same table is the identity, never lower for a deeper run, there and back within 0.05 of a level (6 line sets, every pair)', !ce.length, J(ce.slice(0, 3)));
  T('[11] elpConvert: solo 12.5 reads as duo 20 (half way between the gold and the platinum lines of both), 1 as 1.5, 60 as 96', PP.elpConvert(1250, SOLO, DUO) === 2000 && PP.elpConvert(100, SOLO, DUO) === 150 && PP.elpConvert(6000, SOLO, DUO) === 9600);
  const he = hiddenForErrors(PP);
  T('[11] elpHiddenFor: five own runs = hiddenOf of them (a one-family player reads version 3, the placement reading too); fewer = the newest runs of the other families fill, read on this family\'s scale (600 random histories x 4 families)', !he.length, J(he.slice(0, 2)));
  const tf = teamFactorErrors(PP);
  T('[11] the team length factor: below master a team pass = the solo one x 1.3, a team miss = the solo one / 1.3 (rounding; the cap ' + E.SWING_CAP + ' and the sign floor hold); master and up unchanged; team reported where it applied; solo / duoc / none = no factor', !tf.length, J(tf.slice(0, 3)));
  T('[11] gold 2500 duo: pass 74 (solo 57), miss -20 (solo -25); platinum 3500 duo pass is at the cap (119)',
    J([PP.endlessDelta(2500, true, 1600, DUO, 0, 'duo').d, PP.endlessDelta(2500, false, 1600, DUO, 0, 'duo').d, PP.endlessDelta(2500, true, 1600, DUO, 0).d, PP.endlessDelta(2500, false, 1600, DUO, 0).d, PP.endlessDelta(3500, true, 2400, DUO, 0, 'duo').d]) === J([74, -20, 57, -25, 119]));
  const tg = teamGateErrors(PP);
  T('[11] the team gate: master / grandmaster open at the line x 1.10 for duo / trio / quad (the line itself for solo); below master the solo reading; a diamond player on the master line is held at 5879 as a team and promoted as solo', !tg.length, J(tg.slice(0, 3)));
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'points-plan', 'cases.json'), 'utf8'));
  const en = doc.cases.filter((c) => c.kind === 'endless');
  const has = (fn, n, f) => en.filter((c) => c.in.fn === fn && (!f || f(c))).length >= n;
  T('[11] the golden cases carry the new rules for the client copy: elpIsTeam (6), elpConvert (12), elpHiddenFor (12), the team gate (6), team deltas of all 7 tiers pass and miss, team settles (10), the row v2 both ways',
    has('elpIsTeam', 6) && has('elpConvert', 12) && has('elpHiddenFor', 12) && has('skillTierOf', 6, (c) => c.in.args.length === 3 && PP.elpIsTeam(c.in.args[2]))
    && [0, 1, 2, 3, 4, 5, 6].every((t) => [true, false].every((p) => has('endlessDelta', 1, (c) => PP.elpIsTeam(c.in.args[5]) && PP.lpTierIdx(c.in.args[0]) === t && c.in.args[1] === p)))
    && has('endlessSettle', 10, (c) => PP.elpIsTeam(c.in.args[5])) && has('endlessSettle', 1, (c) => PP.elpIsTeam(c.in.args[5]) && c.out.gated) && has('endlessDelta', 1, (c) => c.out.team === true) && has('endlessDelta', 20, (c) => c.out.team === false)
    && has('elpRowDetails', 2, (c) => (c.out[0] >>> 8) === 2) && has('elpRowOf', 1, (c) => c.out && c.out.h) && has('elpRowOf', 1, (c) => (c.in.args[0][0] >>> 8) === 1 && c.out === null));
  // mutations
  const SRC3 = fs.readFileSync(path.join(__dirname, '..', 'points-plan.js'), 'utf8');
  const mut3 = (label, pairs) => {
    let s = SRC3;
    for (const [from, to] of pairs) { if (s.indexOf(from) < 0) { bad('[11] mutation anchor missing: ' + label + ' (' + from.slice(0, 60) + ')'); return null; } s = s.split(from).join(to); }
    const win = {};
    try { new Function('window', s)(win); } catch (e3) { bad('[11] mutation ' + label + ' does not load: ' + e3.message); return null; }
    return win.POINTS_PLAN;
  };
  const MUL_LINE = 'const mul = team ? Math.round(isPass ? ELP.MUL[cur] * ELP.TEAM_GAIN / 1000 : ELP.MUL[cur] * 1000 / ELP.TEAM_GAIN) : ELP.MUL[cur];';
  const g1 = mut3('TEAM_GAIN 1000', [['TEAM_GAIN: 1300', 'TEAM_GAIN: 1000']]);
  T('[11] TEAM_GAIN 1000 (no length factor) turns the factor check red', g1 && teamFactorErrors(g1).length > 0);
  const g2 = mut3('the factor on both pass and miss', [[MUL_LINE, 'const mul = team ? Math.round(ELP.MUL[cur] * ELP.TEAM_GAIN / 1000) : ELP.MUL[cur];']]);
  T('[11] the factor on a miss too (a team miss then loses MORE) turns the factor check red', g2 && teamFactorErrors(g2).some((e) => e[0] === 'miss loses less'));
  const g3 = mut3('the factor at master and up', [['team = elpIsTeam(fam) && cur < ELP.GATE_TIER;', 'team = elpIsTeam(fam);']]);
  T('[11] the factor at master and up turns the factor check red (the zero-sum top would pay teams more than it takes)', g3 && teamFactorErrors(g3).some((e) => e[0] === 'master and up' || e[0] === 'flag'));
  const g4 = mut3('TEAM_GATE 100', [['TEAM_GATE: 110', 'TEAM_GATE: 100']]);
  T('[11] TEAM_GATE 100 (the solo gate for teams) turns the gate check red', g4 && teamGateErrors(g4).length > 0);
  const g5 = mut3('a team family by default', [["function elpIsTeam(fam) { return fam === 'duo' || fam === 'trio' || fam === 'quad'; }", "function elpIsTeam(fam) { return fam !== 'solo'; }"]]);
  T('[11] a call without a family read as a team run turns the frozen version 3 cases red', g5 && frozenErrors(g5).length > 0);
  const g6 = mut3('no borrowed runs', [['if (elpLinesOk(to)) {', 'if (false) {']]);
  T('[11] no borrowed runs (a new party size starts from nothing again) turns the hidden skill check red', g6 && hiddenForErrors(g6).length > 0 && g6.elpHiddenFor('duo', [['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10], ['solo', 10]], LINES4) === null);
  const g7 = mut3('borrowed runs not converted', [['all.push(elpConvert(Math.max(0, r[1] | 0) * 100, lines[r[0]], to));', 'all.push(Math.max(0, r[1] | 0) * 100);']]);
  T('[11] borrowed runs taken at their own depth (not read on this family\'s scale) turn the hidden skill check red', g7 && hiddenForErrors(g7).length > 0);
  const g8 = mut3('a convert by the bronze ratio only', [['if (x < f1 * 100) return t0 * 100 + Math.round((x - f0 * 100) * (t1 - t0) / Math.max(1, f1 - f0));', 'if (x < f1 * 100) return Math.round(x * (passTo[0] | 0) / Math.max(1, passFrom[0] | 0));']]);
  T('[11] a convert that ignores the lines between bronze and grandmaster turns the convert check red', g8 && convertErrors(g8).length > 0);
  const g10 = mut3('the v1 row read as a row', [['(((det[0] | 0) >>> 8) & 0xff) !== ELP.ROW_VER) return null;\n    const h = {}, ring = [];', '(((det[0] | 0) >>> 8) & 0xff) > ELP.ROW_VER) return null;\n    const h = {}, ring = [];']]);
  T('[11] a v1 per-family row read as a v2 row turns the row check red (its hidden skill would read as the tier)', g10 && g10.elpRowOf([0xEE | 256, 7, 950, 1, 1, 198, 2, -5, 40, 264, 77, -13, 258]) !== null);
}

console.log(failN ? ('endless-lp: ' + failN + ' FAIL') : 'endless-lp: all ok');
process.exit(failN ? 1 : 0);
