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

// two-team update (team match types): team strength = sum of member mu, outcome is binary
// (rank 1 beats rank 2), every member keeps an independent mu/sigma update scaled by his own
// variance share. Generalizes the pairwise closed form below: c^2 = n*beta^2 + sum(sigma^2)
// over all n players on both teams (with 1v1 this reduces to exactly one updateMatch step).
// teamsIn: [{ rank, players: [{ id, mu, sigma }] }] -- exactly 2 teams; sizes may differ
// (an abandoned teammate leaves a 1-man team: the absent player is neither counted in the
// team strength nor updated, so the under-manned side is judged by who actually stayed).
function updateTeamMatch(teamsIn) {
  const teams = (teamsIn || []).map(t => ({
    rank: t.rank,
    players: (t.players || []).map(p => ({ id: p.id, mu: p.mu, sigma: Math.sqrt(p.sigma * p.sigma + TAU * TAU) })),
  }));
  teams.sort((a, b) => a.rank - b.rank);
  const flat = () => teams.reduce((o, t) => o.concat(t.players), []).map(p => ({ id: p.id, mu: p.mu, sigma: p.sigma }));
  if (teams.length !== 2) return flat();
  const w = teams[0], l = teams[1];
  if (!w.players.length || !l.players.length || w.rank === l.rank) return flat();
  let sum2 = 0, muW = 0, muL = 0;
  for (const p of w.players) { sum2 += p.sigma * p.sigma; muW += p.mu; }
  for (const p of l.players) { sum2 += p.sigma * p.sigma; muL += p.mu; }
  const n = w.players.length + l.players.length;
  const c2 = n * BETA * BETA + sum2, c = Math.sqrt(c2);
  const t = (muW - muL) / c;
  const Pt = Phi(t);
  const v = Pt > 1e-9 ? phi(t) / Pt : -t;
  const wgt = v * (v + t);
  for (const p of w.players) { p.mu += (p.sigma * p.sigma / c) * v; p.sigma = Math.sqrt(Math.max(1e-6, p.sigma * p.sigma * (1 - (p.sigma * p.sigma / c2) * wgt))); }
  for (const p of l.players) { p.mu -= (p.sigma * p.sigma / c) * v; p.sigma = Math.sqrt(Math.max(1e-6, p.sigma * p.sigma * (1 - (p.sigma * p.sigma / c2) * wgt))); }
  return flat();
}

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

module.exports = { MU0, SIG0, BETA, TAU, DEFAULTS, phi, Phi, displayRating, updateMatch, updateTeamMatch };
