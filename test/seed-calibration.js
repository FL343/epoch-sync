'use strict';
// O786 / audit L-03 (companion KNIFE_O785_LP_LANDING_PLAN sections 3.5 and 7 [L5], user call 2026-11-09 "one tier lower overall"):
//   the first placement seed (seedLp of the display rating a player has when ranked unlocks) lands where the design says,
//   measured on the REAL trueskill.js -- not on a display value worked out on paper (the old BASE 1000 was: an average player's
//   display after 15 matches is ~1650, not ~1000-1300, so the average seeded gold).
// 2026-11-18 (user calls): ranked unlocks after 5 quick matches instead of 15 (a client-side gate), and BASE goes 1250 -> 1050
//   with it. After 5 matches sigma is still ~3.8 and the display about 300 lower than after 15; with 1250 a third of the new
//   players would seed bronze and 15 % at exactly 0 points. 1050 gives a player who goes to ranked as soon as it opens the
//   spread chosen on 2026-11-09 (about 10 % bronze / 49 % silver / 35 % gold / 6 % platinum).
//   A small fixed-seed population: 600 players of true skill N(0, 1), every round tables of 2-6 seats (mostly 2 and 3, as the
//   season simulation's queue makes them) of players near each other in display rating, places by skill + N(0, 1) noise, the
//   real updateMatch. Placed after UNLOCK (5) matches, by skill fifth (weak .. top):
//   [1] the average fifth's median seed is silver, and so is the below-average fifth's; the top fifth's median is gold at most
//       (not platinum); the weak fifth's median is under the average one's by at least a quarter of silver; at most 8 % of the
//       players seed at exactly 0
//   [2] placed after 15 or 30 matches instead, the average fifth's median moves up by one tier at most (more quick play before
//       ranked still seeds higher: sigma shrinks -- experience counts). After 100 matches it is about two tiers (printed, known
//       and accepted with the unlock at 5: the seed cap holds it under diamond)
//   [M] mutations: BASE back to 1250 turns [1] red (the below-average fifth seeds bronze, 15 % at 0); BASE 1000 turns [1] red
//       (the average fifth seeds gold)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PP = require(path.join(ROOT, 'points-plan.js'));
const ts = require(path.join(ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const UNLOCK = 5;   // the quick matches that unlock ranked (the client's RANKED_CONFIG.QUICK_UNLOCK_GAMES; the job does not read it)
const SNAPS = [UNLOCK, 15, 30, 100];
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
    if (SNAPS.indexOf(k) >= 0) snaps[k] = P.map((p) => ({ s: p.s, disp: ts.displayRating(p.mu, p.sigma) }));
  }
  return snaps;
}
const median = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
function fifths(snap, M) {
  const sorted = snap.slice().sort((a, b) => a.s - b.s), n = sorted.length;
  return [0, 1, 2, 3, 4].map((q) => median(sorted.slice(Math.floor(q * n / 5), Math.floor((q + 1) * n / 5)).map((x) => M.seedLp(x.disp))));
}
const tier = (lp) => PP.lpTierIdx(lp);
const share = (snap, M) => { const c = [0, 0, 0, 0, 0, 0, 0]; let zero = 0; for (const x of snap) { const v = M.seedLp(x.disp); c[tier(v)]++; if (v === 0) zero++; } return { tiers: c.map((x) => Math.round(100 * x / snap.length)), zero: 100 * zero / snap.length }; };
function check(M, snaps) {
  const f = {}; for (const k of SNAPS) f[k] = fifths(snaps[k], M);
  const fu = f[UNLOCK], sh = share(snaps[UNLOCK], M);
  const silverW = M.LP_SEG[2].min - M.LP_SEG[1].min;
  return { f, sh,
    one: tier(fu[2]) === 1 && tier(fu[1]) === 1 && tier(fu[4]) <= 2 && fu[2] - fu[0] >= silverW / 4 && sh.zero <= 8,
    two: tier(f[15][2]) - tier(fu[2]) <= 1 && tier(f[30][2]) - tier(fu[2]) <= 1 };
}

console.log('=== first placement seed on the real trueskill.js (LP_SEED ' + JSON.stringify(PP.LP_SEED) + ', ranked unlocks after ' + UNLOCK + ' quick matches) ===');
const t0 = Date.now(), snaps = population(100);
const c = check(PP, snaps);
console.log('        median seed by skill fifth after ' + SNAPS.map((k) => k + ' matches ' + c.f[k].join(' / ')).join(' | ') + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
console.log('        after ' + UNLOCK + ' matches: bronze / silver / gold / platinum ' + c.sh.tiers.slice(0, 4).join(' / ') + ' %, at 0 points ' + c.sh.zero.toFixed(1) + ' %');
T('[1] after ' + UNLOCK + ' matches: the average and the below-average fifth seed silver, the top fifth gold at most, the weak fifth clearly under the average, at most 8 % at 0 points', c.one, c.f[UNLOCK].join(' / ') + ' at 0: ' + c.sh.zero.toFixed(1) + ' %');
T('[2] after 15 or 30 matches the average fifth seeds at most one tier higher than after ' + UNLOCK, c.two, c.f[UNLOCK][2] + ' -> ' + c.f[15][2] + ' -> ' + c.f[30][2]);
T('[2] ... and never past the seed cap (after 100 matches the average fifth seeds ' + c.f[100][2] + ', under diamond)', c.f[100].every((v) => v <= PP.LP_SEED.CAP) && tier(c.f[100][4]) <= 3);
const src = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
const A = 'const LP_SEED = { BASE: 1050, SLOPE: 4, CAP: 3200 };';
T('[M] the mutation anchor is the live constant', src.indexOf(A) >= 0);
const mutant = (base) => { const win = {}; new Function('window', src.split(A).join('const LP_SEED = { BASE: ' + base + ', SLOPE: 4, CAP: 3200 };'))(win); return check(win.POINTS_PLAN, snaps); };   // eslint-disable-line no-new-func
const m1250 = mutant(1250), m1000 = mutant(1000);
T('[M] BASE back to 1250 turns [1] red (the below-average fifth seeds ' + m1250.f[UNLOCK][1] + ', ' + m1250.sh.zero.toFixed(1) + ' % at 0 points)', !m1250.one);
T('[M] BASE 1000 turns [1] red (the average fifth seeds ' + m1000.f[UNLOCK][2] + ')', !m1000.one);

console.log(failN ? ('seed-calibration: ' + failN + ' FAIL') : 'seed-calibration: all ok');
process.exit(failN ? 1 : 0);
