'use strict';
// O786 / audit L-03 (companion KNIFE_O785_LP_LANDING_PLAN sections 3.5 and 7 [L5], user call 2026-11-09 "one tier lower overall"):
//   the first placement seed (seedLp of the display rating after the 15 quick matches that unlock ranked) lands where the design
//   says, measured on the REAL trueskill.js -- not on a display value worked out on paper (the old BASE 1000 was: an average
//   player's display after 15 matches is ~1650, not ~1000-1300, so the average seeded gold).
//   A small fixed-seed population: 600 players of true skill N(0, 1), every round tables of 2-6 seats (mostly 2 and 3, as the
//   season simulation's queue makes them) of players near each other in display rating, places by skill + N(0, 1) noise, the
//   real updateMatch. Placed after 15 matches, by skill fifth (weak .. top):
//   [1] the average fifth's median seed is silver; the top fifth's median is gold at most (not platinum); the weak fifth's median
//       is under the average one's by at least a quarter of silver
//   [2] placed after 100 matches instead, the average fifth's median moves up by one tier at most (more quick play before ranked
//       still seeds a little higher: sigma shrinks -- experience counts, but not by two tiers)
//   [M] mutation: BASE back to 1000 turns [1] red (the average fifth seeds gold)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PP = require(path.join(ROOT, 'points-plan.js'));
const ts = require(path.join(ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function population(rounds) {
  const r = rng(20261109);
  const gauss = () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
  const P = [];
  for (let i = 0; i < 600; i++) P.push({ id: 'p' + i, s: gauss(), mu: ts.MU0, sigma: ts.SIG0 });
  const SIZES = [[2, 0.45], [3, 0.27], [4, 0.13], [5, 0.09], [6, 0.06]];
  const size = () => { let u = r(); for (const [n, w] of SIZES) { if (u < w) return n; u -= w; } return 2; };
  const snaps = {};
  for (let k = 1; k <= rounds; k++) {
    // queue order: display rating plus a jitter of about the starting match window (+-200 display)
    const order = P.map((p) => [ts.displayRating(p.mu, p.sigma) + (r() - 0.5) * 400, p]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (let i = 0; i < order.length;) {
      const n = Math.min(size(), order.length - i), table = order.slice(i, i + n); i += n;
      if (table.length < 2) continue;
      const perf = table.map((p) => [p.s + gauss(), p]).sort((a, b) => b[0] - a[0]);
      const out = ts.updateMatch(perf.map(([, p], j) => ({ id: p.id, rank: j + 1, mu: p.mu, sigma: p.sigma })));
      for (const o of out) { const p = table.find((x) => x.id === o.id); p.mu = o.mu; p.sigma = o.sigma; }
    }
    if (k === 15 || k === 100) snaps[k] = P.map((p) => ({ s: p.s, disp: ts.displayRating(p.mu, p.sigma) }));
  }
  return snaps;
}
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
function fifths(snap, M) {
  const sorted = snap.slice().sort((a, b) => a.s - b.s), n = sorted.length;
  return [0, 1, 2, 3, 4].map((q) => median(sorted.slice(Math.floor(q * n / 5), Math.floor((q + 1) * n / 5)).map((x) => M.seedLp(x.disp))));
}
const tier = (lp) => PP.lpTierIdx(lp);
function check(M, snaps) {
  const f15 = fifths(snaps[15], M), f100 = fifths(snaps[100], M);
  const silverW = M.LP_SEG[2].min - M.LP_SEG[1].min;
  return { f15, f100,
    one: tier(f15[2]) === 1 && tier(f15[4]) <= 2 && f15[2] - f15[0] >= silverW / 4,
    two: tier(f100[2]) - tier(f15[2]) <= 1 };
}

console.log('=== O786 first placement seed on the real trueskill.js (LP_SEED ' + JSON.stringify(PP.LP_SEED) + ') ===');
const t0 = Date.now(), snaps = population(100);
const c = check(PP, snaps);
console.log('        median seed by skill fifth after 15 matches ' + c.f15.join(' / ') + ' | after 100 ' + c.f100.join(' / ') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
T('[1] after 15 matches: the average fifth seeds silver, the top fifth gold at most, the weak fifth clearly under the average', c.one, c.f15.join(' / '));
T('[2] after 100 matches the average fifth seeds at most one tier higher than after 15', c.two, c.f15[2] + ' -> ' + c.f100[2]);
const src = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
const A = 'const LP_SEED = { BASE: 1250, SLOPE: 4, CAP: 3200 };';
T('[M] the mutation anchor is the live constant', src.indexOf(A) >= 0);
const win = {}; new Function('window', src.split(A).join('const LP_SEED = { BASE: 1000, SLOPE: 4, CAP: 3200 };'))(win);
const m = check(win.POINTS_PLAN, snaps);
T('[M] BASE back to 1000 turns [1] red (the average fifth seeds ' + m.f15[2] + ')', !m.one);

console.log(failN ? ('seed-calibration: ' + failN + ' FAIL') : 'seed-calibration: all ok');
process.exit(failN ? 1 : 0);
