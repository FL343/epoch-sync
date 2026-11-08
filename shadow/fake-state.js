'use strict';
// ============================================================
// shadow/fake-state.js -- made-up competitive endless histories for trying the shadow before real players exist.
// ============================================================
// Players from shadow/sim-bootstrap.js's population model A (median 7 levels, spread 0.6; team families x 1.6) arrive day by
//   day, play runs (log-normal depths around their true level), and the OFFICIAL code settles them: validate.js
//   ratingHistUpsert (every run one final segment) + elpSettleAll (placement / points) + elpTabRecord with the official
//   lines of the day (validate.js elpLinesOf; no bans here) -- read-only use of the official functions on a made-up state
//   object, so the state has the shape the reconcile job writes. Climbing to grandmaster takes hundreds of runs; the top
//   2 % by true level are fast-forwarded once placed (points 8000..9999 by their level), so the O759 pool has members.
// Ids are random hex ('f' + 12 hex): no real account, no salted pid of anyone.
// Usage (a module): fakeDays({ seed, days, start, families, arrive }) -> [{ day, ms, state }] (each state a deep copy)
//        node shadow/fake-state.js <dir> [days] [arrive]   -> writes <dir>/state-<YYYYMMDD>.json for every day
// ============================================================
const fs = require('fs');
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));
const B = require(path.join(__dirname, 'sim-bootstrap.js'));
const PP = require(path.join(__dirname, '..', 'points-plan.js'));

const DAY = 86400000;
const EA_START = Date.UTC(2026, 10, 17, 12, 0, 0);   // 2026-11-17 12:00 UTC (season 0)

function hex(r, n) { let s = ''; for (let i = 0; i < n; i++) s += Math.floor(r() * 16).toString(16); return s; }
function dayOf(ms) { const d = new Date(ms); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }

function fakeDays(opt) {
  const o = opt || {}, r = B.rng(o.seed || 7), days = o.days || 30, start = o.start || EA_START;
  const fams = o.families || { solo: 1, duo: 0.35 }, arrive = o.arrive == null ? 14 : o.arrive, grow = o.grow == null ? 0.4 : o.grow;
  const st = { hist: {}, elpTab: [] }, players = [], out = [];
  for (let d = 0; d < days; d++) {
    const t0 = start + d * DAY, season = V.seasonAt(t0);
    const n = Math.round(arrive + grow * d);
    for (let i = 0; i < n; i++) {
      for (const [fam, share] of Object.entries(fams)) {
        if (r() >= share) continue;
        const scale = fam === 'solo' ? 1 : 1.6;
        players.push({ pid: 'f' + hex(r, 12), fam, mu: B.MODELS.A.mu(r) * scale, cv: r() < 0.5 ? 0.3 : 0.6, p: 0.3 + 0.6 * r(), ff: -1 });
      }
    }
    let t = t0;
    for (const pl of players) {
      if (r() > pl.p) continue;
      pl.p *= 0.99;
      const k = 1 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) {
        t += 1000 + Math.floor(r() * 60000);
        const seed = (r() * 4294967296) | 0, runId = V.ratingRunId(pl.pid + '|' + season + '|' + seed);
        V.ratingHistUpsert(st, pl.pid, pl.fam, season, runId, B.depthOf(r, pl.mu, pl.cv), t, attest.SEG_FINAL, seed);
      }
    }
    const tEnd = t0 + DAY - 3600000;
    V.elpSettleAll(st, season, tEnd);
    // fast-forward the top players once placed (a long season in one step): true level at or above the population's
    //   top gmTop share (default 2 %: z 2.05 of model A's spread 0.6) -> grandmaster points by their level
    for (const pl of players) {
      const h = st.hist[V.ratingHistKey(pl.pid, pl.fam, season)];
      const cut = 7 * (pl.fam === 'solo' ? 1 : 1.6) * Math.exp(0.6 * (o.gmZ == null ? 2.05 : o.gmZ));
      if (!h || !h.placed || pl.ff === season || pl.mu < cut) continue;
      h.lp = Math.min(9999, 8000 + Math.round((pl.mu - cut) * 60 + r() * 600));
      pl.ff = season;
    }
    const byFam = {};
    for (const [fam] of V.RATING_FAMS) byFam[fam] = V.elpLinesOf(Object.values(V.elpHiddensOf(st, fam, season)), PP.ELP.PRIOR[fam]);
    V.elpTabRecord(st, season, dayOf(tEnd), tEnd, byFam);
    st.ms = tEnd;
    out.push({ day: dayOf(tEnd), ms: tEnd, state: JSON.parse(JSON.stringify(st)) });
  }
  return out;
}

module.exports = { fakeDays, EA_START, DAY, dayOf };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node shadow/fake-state.js <dir> [days] [arrive]'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const days = fakeDays({ days: +(process.argv[3] || 30), arrive: process.argv[4] != null ? +process.argv[4] : undefined });
  for (const x of days) fs.writeFileSync(path.join(dir, 'state-' + x.day + '.json'), JSON.stringify(x.state));
  const last = days[days.length - 1].state;
  for (const fam of ['solo', 'duo']) console.log(fam + ': placed ' + Object.keys(V.elpHiddensOf(last, fam, V.seasonAt(days[days.length - 1].ms))).length);
  console.log('wrote ' + days.length + ' states to ' + dir);
}
