#!/usr/bin/env node
'use strict';
// ============================================================
// shadow/elp-shadow.js -- the O759 / O760 shadow, one day: reads the committed state, prints a summary, appends one entry
//   to the history file. Never writes the state, a board, or main; never calls Steam (no network at all).
// ============================================================
// Inputs: the state file the reconcile job committed (endless-solo.json: hist + elpTab), optionally the same file as of
//   about a day earlier (the day-over-day rank correlation of O759), and the history so far (the shadow/elp branch).
// Output: aggregates only -- per family and tier counts, lines, differences, error estimates; per family the O759 gate
//   numbers and a coarse distribution of what the calibration would have done. No account id, no salted pid, no run id
//   or seed is ever printed or stored (shadow/test/elp-shadow-run.js scans the output for the made-up ids). Per-family
//   empirical / fitted values are shown from SHADOW.SHOW_MIN placed players up, the grandmaster distribution from 5.
// Usage: node shadow/elp-shadow.js [--state endless-solo.json] [--prev <file>] [--history <in.json>] [--out <out.json>]
//          [--md <latest.md>] [--now <ms>]
// ============================================================
const fs = require('fs');
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const PP = require(path.join(__dirname, '..', 'points-plan.js'));
const S = require(path.join(__dirname, 'elp-shadow-plan.js'));

const SH = S.SHADOW, ELP = PP.ELP, FAMS = PP.ELP_FAMS, TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster'];
const DAY = 86400000, KEEP_DAYS = 400, GM_SHOW_MIN = 5;
const r3 = (x) => (x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000);
const dayOf = (ms) => { const d = new Date(ms); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };

function readJson(f) { if (!f) return null; try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

// the competitive history entries of family fam in season s: [{ key (internal only), h }]
function entriesOf(st, fam, s) {
  const tail = '|' + fam + '|' + (s | 0), out = [];
  for (const k of Object.keys((st && st.hist) || {})) if (k.endsWith(tail) && st.hist[k]) out.push({ key: k.slice(0, k.length - tail.length), h: st.hist[k] });
  return out;
}
// the official lines of family fam: the newest table of season s recorded at or before nowMs; none -> recomputed
function officialOf(st, fam, s, nowMs, h100) {
  let at = null;
  for (const x of ((st && st.elpTab) || [])) if ((x.season | 0) === (s | 0) && x.ms <= nowMs && (!at || x.ms > at.ms)) at = x;
  const c = at && at.byFam && at.byFam[fam];
  if (c && Array.isArray(c.pass) && c.pass.length === 7) return { pass: c.pass.map((v) => v | 0), w: r3(c.w), N: c.N | 0, src: 'table ' + at.day };
  const l = V.elpLinesOf(h100, ELP.PRIOR[fam]);
  return { pass: l.pass, w: r3(l.w), N: l.N, src: 'recomputed (no table this season; bans not left out)' };
}

// ---- O760, one family ----
function lineDay(st, fam, s, nowMs, hist) {
  const hid = V.elpHiddensOf(st, fam, s), h100 = Object.values(hid), N = h100.length;
  const off = officialOf(st, fam, s, nowMs, h100);
  const prior = S.priorOf(fam, s, hist.finals);
  const today = dayOf(nowMs);
  let prevDay = null;
  for (const e of hist.days) if ((e.season | 0) === (s | 0) && e.day < today && e.fams && e.fams[fam] && (!prevDay || e.day > prevDay.day)) prevDay = e;
  const prevSmooth = prevDay ? prevDay.fams[fam].smooth : null;
  const sh = S.shadowLines(h100, prior.lines, prevSmooth);
  const jump = prevSmooth ? sh.smooth.map((v, k) => r3(Math.abs(v - prevSmooth[k]) / Math.max(SH.LINE_FLOOR, prevSmooth[k]))) : null;
  const tierMoves = h100.reduce((n, h) => n + (PP.tierOfHidden(h, off.pass) !== PP.tierOfHidden(h, sh.pass) ? 1 : 0), 0);
  const show = N >= SH.SHOW_MIN;
  const emp = show ? S.linesOf('emp', h100) : null;
  return {
    N, prior: { src: prior.src, lines: prior.lines.map(r3) },
    official: off,
    pass: sh.pass, diff: sh.pass.map((v, k) => v - off.pass[k]),
    raw: sh.raw.map(r3), smooth: sh.smooth.map(r3), Z: sh.Z.map(r3), seRel: S.seRelOf(N).map(r3),
    jump, jumpMax: jump ? Math.max.apply(null, jump) : null, prevDay: prevDay ? prevDay.day : null,
    tierMoves,
    fit: show && sh.fit ? { method: sh.method, mu: r3(sh.fit.mu), sigma: r3(sh.fit.sigma), n: sh.fit.n, lines: sh.fitLines.map(r3) } : null,
    emp: emp ? { lines: emp.lines.map(r3), pass: S.finalize(emp.lines) } : null,
  };
}

// ---- O759, one family ----
function gmPool(st, fam, s) {
  const pool = [];
  for (const { key, h } of entriesOf(st, fam, s)) {
    if (!h.placed || h.lp == null || (h.lp | 0) < SH.GM_MIN) continue;
    const dep = V.elpSettledDepths(h, null), H = PP.hiddenOf(dep);
    if (H == null) continue;
    pool.push({ key, h, H, lp: h.lp | 0, full: dep.length >= ELP.WINDOW });
  }
  const eff = pool.filter((x) => x.full), pct = S.pctRanks(eff.map((x) => x.H));
  eff.forEach((x, i) => { x.pct = pct[i]; x.deserved = S.deservedOf(pct[i]); });
  return { pool, eff };
}
const GAP_EDGES = [-1000, -300, 0, 1, 301, 1001];   // buckets: < -1000 | -1000..-301 | -300..-1 | =0 | 1..300 | 301..1000 | > 1000
const GAP_NAMES = ['<-1000', '-1000..-301', '-300..-1', '=0', '1..300', '301..1000', '>1000'];
function bucketOf(g) { let i = 0; while (i < GAP_EDGES.length && g >= GAP_EDGES[i]) i++; return i; }
function quant(a, q) { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * (b.length - 1) + 0.5))] : null; }
function gmDay(st, prevSt, fam, s, nowMs) {
  const { pool, eff } = gmPool(st, fam, s);
  let corr = null, pairs = 0;
  if (prevSt) {
    const prev = gmPool(prevSt, fam, s).eff, pm = new Map(prev.map((x) => [x.key, x.H]));
    const a = [], b = [];
    for (const x of eff) if (pm.has(x.key)) { a.push(pm.get(x.key)); b.push(x.H); }
    pairs = a.length;
    if (pairs >= SH.GM_CORR_PAIRS) corr = r3(S.spearman(a, b));
  }
  const gate = S.gateOf(eff.length, corr);
  const gaps = eff.map((x) => x.deserved - x.lp);
  // what the calibration would have done to the runs of the last day (points before each run: walked back from the
  //   current points over the recorded changes, newest first; the deserved points are today's)
  const ifOn = { runs: 0, plus: 0, minus: 0, zero: 0, sumPlus: 0, sumMinus: 0, hist: { '1..20': 0, '21..40': 0, '41..60': 0, '-1..-10': 0, '-11..-20': 0 } };
  for (const x of eff) {
    let after = x.lp;
    const runs = (x.h.runs || []).filter((r) => r[3]);
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i], d = r[4] | 0, before = after - d;
      after = before;
      if ((r[6] || r[2] || 0) < nowMs - DAY || before < SH.GM_MIN) continue;
      const e = S.extraIfOn(before, d, (r[1] | 0) >= (r[5] | 0), x.deserved);
      ifOn.runs++;
      if (e > 0) { ifOn.plus++; ifOn.sumPlus += e; ifOn.hist[e <= 20 ? '1..20' : e <= 40 ? '21..40' : '41..60']++; }
      else if (e < 0) { ifOn.minus++; ifOn.sumMinus += e; ifOn.hist[e >= -10 ? '-1..-10' : '-11..-20']++; }
      else ifOn.zero++;
    }
  }
  const show = eff.length >= GM_SHOW_MIN;
  const buckets = GAP_NAMES.map(() => 0);
  for (const g of gaps) buckets[bucketOf(g)]++;
  return {
    pool: pool.length, effective: eff.length, fullShare: pool.length ? r3(eff.length / pool.length) : null, pairs, corr, gate,
    gap: show ? { p10: quant(gaps, 0.1), p50: quant(gaps, 0.5), p90: quant(gaps, 0.9), buckets: Object.fromEntries(GAP_NAMES.map((n, i) => [n, buckets[i]])) } : null,
    ifOn: show ? ifOn : { runs: ifOn.runs, note: 'fewer than ' + GM_SHOW_MIN + ' in the effective pool: distribution not shown' },
  };
}

function run(opt) {
  const st = readJson(opt.state);
  if (!st) throw new Error('state file not readable: ' + opt.state);
  const prevSt = readJson(opt.prev);
  const hist0 = readJson(opt.history);
  const hist = (hist0 && hist0.v === SH.VER && Array.isArray(hist0.days)) ? hist0 : { v: SH.VER, days: [], finals: {} };
  hist.finals = hist.finals || {};
  const nowMs = opt.now != null ? +opt.now : Date.now(), s = V.seasonAt(nowMs), day = dayOf(nowMs);
  const entry = { day, ms: nowMs, season: s, stateMs: st.ms || null, prevStateMs: prevSt ? (prevSt.ms || null) : null, fams: {}, gm: {} };
  for (const fam of FAMS) { entry.fams[fam] = lineDay(st, fam, s, nowMs, hist); entry.gm[fam] = gmDay(st, prevSt, fam, s, nowMs); }
  hist.days = hist.days.filter((e) => e.day !== day).concat([entry]).sort((a, b) => a.day - b.day).slice(-KEEP_DAYS);
  hist.finals[String(s)] = Object.fromEntries(FAMS.map((f) => [f, entry.fams[f].smooth]));
  hist.updated = nowMs;
  return { hist, entry, text: render(entry) };
}

// ---- the summary (stdout / latest.md) ----
const pad = (x, n) => String(x == null ? '-' : x).padStart(n);
const pcts = (a) => (a ? a.map((x) => pad(x == null ? '-' : (100 * x).toFixed(1) + '%', 9)).join('') : TIERS.map(() => pad('-', 9)).join(''));
const ints = (a) => (a ? a.map((x) => pad(x, 9)).join('') : TIERS.map(() => pad('-', 9)).join(''));
function render(e) {
  const L = [];
  L.push('ELP shadow (O759 / O760) -- day ' + e.day + ', season ' + e.season + '. SHADOW ONLY: nothing is written to Steam or to the reconcile state.');
  L.push('');
  L.push('O760 pass lines: official (head-count blend, published) vs shadow (' + SH.FIT_METHOD + ' log-normal fit + credibility vs prior, TAU ' + SH.TAU + ' + EMA ' + SH.EMA_ALPHA + ')');
  for (const fam of FAMS) {
    const f = e.fams[fam];
    L.push('');
    L.push('[' + fam + '] placed N ' + f.N + ' | official: ' + f.official.src + ', w ' + f.official.w + ' | shadow prior: ' + f.prior.src + (f.prevDay ? ' | smoothed with ' + f.prevDay : ''));
    if (!f.N) L.push('  N 0: no placed players -- both use the prior.');
    L.push('  ' + 'tier'.padEnd(14) + TIERS.map((t) => pad(t.slice(0, 8), 9)).join(''));
    L.push('  ' + 'official'.padEnd(14) + ints(f.official.pass));
    L.push('  ' + 'shadow'.padEnd(14) + ints(f.pass));
    L.push('  ' + 'diff'.padEnd(14) + ints(f.diff.map((x) => (x > 0 ? '+' + x : x))));
    L.push('  ' + 'credibility'.padEnd(14) + f.Z.map((x) => pad(x.toFixed(2), 9)).join(''));
    L.push('  ' + 'est. error'.padEnd(14) + pcts(f.seRel));
    L.push('  ' + 'jump vs prev'.padEnd(14) + pcts(f.jump));
    if (f.emp) L.push('  ' + 'empirical'.padEnd(14) + ints(f.emp.pass) + '   (the live reading the official job uses at w 1)');
    if (f.fit) L.push('  fit: mu ' + f.fit.mu + ', sigma ' + f.fit.sigma + ' over ' + f.fit.n + ' players (levels: ' + f.fit.lines.map((x) => x.toFixed(1)).join(' / ') + ')');
    else if (f.N) L.push('  N < ' + SH.SHOW_MIN + ': fitted / empirical values not shown');
    L.push('  placed players whose skill tier would differ under the shadow lines: ' + f.tierMoves + ' of ' + f.N);
  }
  L.push('');
  L.push('O759 grandmaster calibration (off; would open at an effective pool >= ' + SH.GM_POOL_MIN + ' with full windows and a day-over-day rank correlation >= ' + SH.GM_CORR_MIN + ')');
  for (const fam of FAMS) {
    const g = e.gm[fam];
    L.push('  [' + fam + '] pool ' + g.pool + ' | full window ' + g.effective + (g.fullShare != null ? ' (' + (100 * g.fullShare).toFixed(0) + '%)' : '') +
      ' | correlation ' + (g.corr == null ? '- (' + g.pairs + ' pairs)' : g.corr + ' over ' + g.pairs) +
      ' | gate ' + (g.gate.open ? 'WOULD OPEN' : 'closed') + ' (pool ' + (g.gate.pool ? 'ok' : g.gate.needPool + ' more') + ', correlation ' + (g.gate.corr ? 'ok' : (g.gate.needCorr == null ? 'not measured' : 'short by ' + g.gate.needCorr)) + ')');
    if (g.gap) L.push('      deserved - points: p10 ' + g.gap.p10 + ', median ' + g.gap.p50 + ', p90 ' + g.gap.p90 + ' | ' + Object.entries(g.gap.buckets).map(([k, v]) => k + ': ' + v).join(', '));
    if (g.ifOn && g.ifOn.plus != null) L.push('      if on, last day: runs ' + g.ifOn.runs + ', ' + g.ifOn.plus + ' with a bonus (total +' + g.ifOn.sumPlus + '), ' + g.ifOn.minus + ' with an extra loss (total ' + g.ifOn.sumMinus + '), ' + g.ifOn.zero + ' unchanged | ' + Object.entries(g.ifOn.hist).map(([k, v]) => k + ': ' + v).join(', '));
    else if (g.ifOn) L.push('      if on, last day: runs ' + g.ifOn.runs + ' (' + g.ifOn.note + ')');
  }
  return L.join('\n') + '\n';
}

function argsOf(argv) {
  const o = { state: path.join(__dirname, '..', 'endless-solo.json') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--state') o.state = argv[++i]; else if (k === '--prev') o.prev = argv[++i]; else if (k === '--history') o.history = argv[++i];
    else if (k === '--out') o.out = argv[++i]; else if (k === '--md') o.md = argv[++i]; else if (k === '--now') o.now = +argv[++i];
    else throw new Error('unknown argument ' + k);
  }
  return o;
}

module.exports = { run, render, lineDay, gmDay, gmPool, officialOf, entriesOf, argsOf, dayOf };

if (require.main === module) {
  const o = argsOf(process.argv.slice(2));
  const res = run(o);
  if (o.out) fs.writeFileSync(o.out, JSON.stringify(res.hist, null, 1) + '\n');
  if (o.md) fs.writeFileSync(o.md, res.text);
  process.stdout.write(res.text);
}
