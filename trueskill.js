'use strict';

const MU0 = 25.0;
const SIG0 = 25.0 / 3.0;
const BETA = 25.0 / 6.0;
const TAU = 25.0 / 300.0;
const SCALE = 40.0;
const OFFSET = 0;

function phi(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

const DEFAULTS = { mu: MU0, sigma: SIG0 };

function displayRating(mu, sigma) { return Math.max(0, Math.round((mu - 3 * sigma) * SCALE + OFFSET + 1000)); }

function updateMatch(playersIn) {
  const ps = playersIn.map(p => ({ id: p.id, rank: p.rank, mu: p.mu, sigma: Math.sqrt(p.sigma * p.sigma + TAU * TAU) }));
  const sorted = [...ps].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length - 1; i++) {
    const w = sorted[i], l = sorted[i + 1];
    if (w.rank === l.rank) continue;
    const c2 = 2 * BETA * BETA + w.sigma * w.sigma + l.sigma * l.sigma;
    const c = Math.sqrt(c2);
    const t = (w.mu - l.mu) / c;
    const Pt = Phi(t);
    const v = Pt > 1e-9 ? phi(t) / Pt : -t;
    const wgt = v * (v + t);
    w.mu += (w.sigma * w.sigma / c) * v;
    l.mu -= (l.sigma * l.sigma / c) * v;
    w.sigma = Math.sqrt(Math.max(1e-6, w.sigma * w.sigma * (1 - (w.sigma * w.sigma / c2) * wgt)));
    l.sigma = Math.sqrt(Math.max(1e-6, l.sigma * l.sigma * (1 - (l.sigma * l.sigma / c2) * wgt)));
  }
  return ps.map(p => ({ id: p.id, mu: p.mu, sigma: p.sigma }));
}

module.exports = { MU0, SIG0, BETA, TAU, DEFAULTS, phi, Phi, displayRating, updateMatch };
