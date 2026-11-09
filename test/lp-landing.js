'use strict';
// O785 / O786 (companion KNIFE_O785_LP_LANDING_PLAN sections 3 and 7, user calls 2026-11-09): a tier change sticks, and a new
//   season measures everybody with one ruler. A class lock over every tier, every landing and every call site, not a point fix:
//   [L1] every tier past bronze: min + PROMO_LAND and min - RELEG_LAND sit in no series band (a promotion does not land in the
//        new tier's relegation band, a demotion not in the lower tier's promotion band)
//   [L2] softResetLp over 0..LP_MAX: monotone non-decreasing, never raises; every landing past bronze is in a promotion band at
//        the line it is under minus RESET_UNDER (60), grandmaster with master (the reveal is at most diamond), bronze kept but
//        never above the silver landing
//   [L3] one ruler: with a previous season a player without a row lands at softResetLp(seedLp(display)); one whose last finish
//        equals that seed starts exactly there too; the preseason keeps the plain seed; every seasonSeedLp( call in validate.js
//        passes its three arguments
//   [L4] Monte Carlo on the real settleLine (fixed seed): an even-level player (top half half the time) in 2 / 4 / 6 seat FFA
//        and 2v2 team matches, 300 players x 400 matches each, from mid silver and from every season landing: promotions undone
//        within 3 matches <= 15 %, tier changes per 100 matches <= 3 (the old +10 / -15 landings: 87 %, 13-33)
//   [M]  mutations, each must turn its check red: the landings back to 10 / 15 -> [L1] [L4]; the old soft-reset table -> [L2];
//        the hasPrevSeason branch removed -> [L3]
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
const VSRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const PP = require(path.join(ROOT, 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

function loadVariant(pairs) {
  let s = SRC;
  for (const [a, b] of pairs) { if (s.indexOf(a) < 0) throw new Error('mutation anchor missing: ' + a.slice(0, 80)); s = s.split(a).join(b); }
  const win = {}; new Function('window', s)(win); return win.POINTS_PLAN;
}
const RESET_UNDER = 60;

// [L1]
function landingsOff(M) {
  const off = [];
  for (let i = 1; i < M.LP_SEG.length; i++) {
    const up = M.LP_SEG[i].min + M.PROMO_LAND, down = M.LP_SEG[i].min - M.RELEG_LAND;
    if (M.boundaryOf(up) !== null) off.push('up into tier ' + i + ' lands ' + up + ' (' + M.boundaryOf(up) + ')');
    if (M.boundaryOf(down) !== null) off.push('down from tier ' + i + ' lands ' + down + ' (' + M.boundaryOf(down) + ')');
  }
  return off;
}
// [L2]
function resetOff(M) {
  const off = [];
  let prev = -1;
  for (let lp = 0; lp <= M.LP_MAX; lp++) {
    const v = M.softResetLp(lp);
    if (v > lp) { off.push(lp + ' raised to ' + v); break; }
    if (v < prev) { off.push(lp + ' lands ' + v + ' under ' + (lp - 1) + ' -> ' + prev); break; }
    prev = v;
  }
  const S = M.LP_SEG, R = M.SOFT_RESET;
  for (let i = 1; i < S.length; i++) {
    const want = i === S.length - 1 ? S[i - 1].min - RESET_UNDER : S[i].min - RESET_UNDER;
    if ((R[i] | 0) !== want) off.push('tier ' + i + ' lands ' + R[i] + ', want ' + want);
    if (M.boundaryOf(R[i] | 0) !== 'promotion') off.push('tier ' + i + ' landing ' + R[i] + ' is not in a promotion band');
  }
  if (M.softResetLp(S[1].min - 1) > M.softResetLp(S[1].min)) off.push('the top of bronze lands above the silver landing');
  return off;
}
// [L3]
function rulerOff(M) {
  const off = [];
  for (let d = 800; d <= 2700; d += 5) {
    const fresh = M.seasonSeedLp(null, d, true);
    if (fresh !== M.softResetLp(M.seedLp(d))) { off.push('display ' + d + ': a player without a row lands ' + fresh + ', want ' + M.softResetLp(M.seedLp(d))); break; }
    if (M.seasonSeedLp(M.seedLp(d), d, true) !== fresh) { off.push('display ' + d + ': a last finish at the display seed starts elsewhere'); break; }
    if (M.seasonSeedLp(null, d, false) !== M.seedLp(d)) { off.push('display ' + d + ': the preseason does not keep the plain seed'); break; }
  }
  return off;
}
// the arguments of every seasonSeedLp( call in a source (the destructured import has no paren)
function callArgs(src, fn) {
  const out = [];
  const re = new RegExp('\\b' + fn + '\\(', 'g');
  let m;
  while ((m = re.exec(src))) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;   // the definition
    let depth = 0, args = 1, i = m.index + m[0].length, empty = true;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
      else if (ch === ',' && depth === 0) args++;
      if (!/\s/.test(ch)) empty = false;
    }
    out.push({ at: src.slice(0, m.index).split('\n').length, args: empty ? 0 : args });
  }
  return out;
}
// [L4]
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function churn(M, kind, start, seed) {
  const r = rng(seed);
  const tier = (lp) => M.lpTierIdx(lp);
  let promos = 0, undone = 0, changes = 0, n = 0;
  for (let p = 0; p < 300; p++) {
    let lp = start, last = null;
    for (let i = 0; i < 400; i++) {
      const t0 = tier(lp);
      let sl;
      if (kind === 'team') {
        const won = r() < 0.5;
        const parts = [0, 1, 2, 3].map((s) => ({ steamID: 'p' + s, seat: s, mmr: 1500, lp }));
        const row = M.teamLpPlan(parts, 6, won ? [10, 10, 1, 1] : [1, 1, 10, 10], [], won ? 0 : 1, [], []).p0;
        sl = M.settleLine(lp, row, 1, 4, false);
      } else {
        const pc = kind, half = Math.floor(pc / 2), odd = pc % 2;
        let rank = r() < 0.5 ? 1 + Math.floor(r() * (half + odd)) : half + odd + 1 + Math.floor(r() * half);
        rank = Math.min(rank, pc);
        sl = M.settleLine(lp, null, rank, pc, false);
      }
      lp = sl.nv; n++;
      const t1 = tier(lp);
      if (t1 > t0) { promos++; changes++; last = i; }
      if (t1 < t0) { changes++; if (last != null && i - last <= 3) undone++; last = null; }
    }
  }
  return { undone: promos ? undone / promos : 0, per100: 100 * changes / n };
}
function churnOff(M) {
  const off = [], seen = [];
  const starts = [1300].concat(M.SOFT_RESET.slice(1, 6));
  let k = 0;
  for (const kind of [2, 4, 6, 'team']) for (const start of starts) {
    const c = churn(M, kind, start, 9001 + (k++) * 7919);
    seen.push(kind + '@' + start + ' ' + (100 * c.undone).toFixed(0) + '%/' + c.per100.toFixed(1));
    if (c.undone > 0.15 || c.per100 > 3) off.push(kind + ' seats from ' + start + ': undone ' + (100 * c.undone).toFixed(1) + ' %, ' + c.per100.toFixed(1) + ' changes / 100');
  }
  return { off, seen };
}

console.log('=== O785 / O786 series landings and season start (PROMO_LAND ' + PP.PROMO_LAND + ', RELEG_LAND ' + PP.RELEG_LAND + ', SOFT_RESET ' + JSON.stringify(PP.SOFT_RESET) + ', LP_SEED ' + JSON.stringify(PP.LP_SEED) + ') ===');
const l1 = landingsOff(PP);
T('[L1] every promotion / demotion landing sits outside both series bands', !l1.length, l1.join('; '));
const l2 = resetOff(PP);
T('[L2] the season reset is monotone, never raises, and lands every tier past bronze 60 under its line (grandmaster with master)', !l2.length, l2.join('; '));
const l3 = rulerOff(PP);
T('[L3] one ruler: with a previous season a player without a row lands like one whose finish was his display seed', !l3.length, l3.join('; '));
const calls = callArgs(VSRC, 'seasonSeedLp'), short = calls.filter((c) => c.args !== 3);
T('[L3] every seasonSeedLp( call in validate.js passes 3 arguments (' + calls.length + ' calls)', calls.length >= 3 && !short.length, short.map((c) => 'line ' + c.at + ': ' + c.args).join('; '));
const t0 = Date.now(), l4 = churnOff(PP);
T('[L4] even-level players: promotions undone within 3 matches <= 15 %, tier changes <= 3 per 100 (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)', !l4.off.length, l4.off.join('; '));
console.log('        ' + l4.seen.join(' | '));

// [M]
const old = loadVariant([['const BOUNDARY_MARGIN = 120, PROMO_LAND = 150, RELEG_LAND = 150;', 'const BOUNDARY_MARGIN = 120, PROMO_LAND = 10, RELEG_LAND = 15;']]);
T('[M] the landings back to 10 / 15 turn [L1] red', landingsOff(old).length > 0);
const oc = churnOff(old);
T('[M] the landings back to 10 / 15 turn [L4] red (' + oc.seen[0] + ')', oc.off.length > 0);
const oldTable = loadVariant([['const SOFT_RESET = [540, 540, 1940, 2940, 3940, 5940, 5940];', 'const SOFT_RESET = [null, null, 1200, 2000, 3000, 4000, 5000];']]);
T('[M] the old soft-reset table turns [L2] red (' + resetOff(oldTable)[0] + ')', resetOff(oldTable).length > 0);
const twoRulers = loadVariant([['return hasPrevSeason === true ? softResetLp(seedLp(display)) : seedLp(display);', 'return seedLp(display);']]);
T('[M] the hasPrevSeason branch removed turns [L3] red', rulerOff(twoRulers).length > 0);
const shortSrc = VSRC.replace(', disp, seasonId >= 1);', ', disp);');
T('[M] a call site that drops the third argument turns [L3] red', shortSrc !== VSRC && callArgs(shortSrc, 'seasonSeedLp').some((c) => c.args !== 3));

console.log(failN ? ('lp-landing: ' + failN + ' FAIL') : 'lp-landing: all ok');
process.exit(failN ? 1 : 0);
