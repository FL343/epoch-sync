#!/usr/bin/env node
'use strict';
// ============================================================
// tools/trust-report.js -- read-only report over the O198 v1 trust ledger (client knife 5.5b-1)
// ============================================================
// What it answers (O198 (4): "watch the false-positive rate, then retune the reject ladder"):
//   per source x month: events / counted (sev >= 1) / reversed (fp) / accounts
//   per world core (seedcap convictions, ctx.k): convictions / reversed / observation-only records
//   open seedcap reject windows now (the shadow-pool population): accounts, average window, average time left
// Reads files only (no network, no key, writes nothing). pids only -- the ledger never holds a SteamID.
// Usage: node tools/trust-report.js [--trust=trust.json] [--seedcap=seedcap.json] [--json]
//        (channel twins: --trust=demo-trust.json --seedcap=demo-seedcap.json)
// ============================================================
const fs = require('fs');
const path = require('path');
const v = require('../validate.js');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const ROOT = path.join(__dirname, '..');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8')); } catch (e) { return null; } };
const month = (tMin) => new Date((tMin | 0) * 60000).toISOString().slice(0, 7);

// pure: the report object (test/trust-ledger.js feeds it synthetic state)
function report(L, sc, nowMin) {
  const out = { bySource: {}, byCore: {}, windows: { open: 0, avgWindowH: 0, avgLeftH: 0 }, accounts: 0 };
  const acct = (L && L.acct) || {};
  out.accounts = Object.keys(acct).length;
  for (const p of Object.keys(acct)) {
    const seen = new Set();
    for (const e of (acct[p].ev || [])) {
      const k = e.s + ' ' + month(e.t);
      const r = out.bySource[k] = out.bySource[k] || { events: 0, counted: 0, reversed: 0, accounts: 0 };
      r.events++;
      if ((e.v | 0) >= 1) r.counted++;
      if (e.fp) r.reversed++;
      if (!seen.has(k)) { seen.add(k); r.accounts++; }
      if (e.s === 'sc') {
        const core = (e.c && e.c.k) || '?';
        const c = out.byCore[core] = out.byCore[core] || { convictions: 0, reversed: 0, observed: 0 };
        if ((e.v | 0) >= 1) c.convictions++; else if (e.c && e.c.obs) c.observed++;
        if (e.fp) c.reversed++;
      }
    }
  }
  const sus = (sc && sc.suspects) || {};
  let wSum = 0, lSum = 0;
  for (const p of Object.keys(sus)) {
    const su = sus[p];
    if (!v.seedcapRejectActive(su, nowMin)) continue;
    out.windows.open++;
    wSum += v.seedcapRejectWindowMin(v.seedcapNEff ? v.seedcapNEff(su) : (su.n | 0));
    lSum += v.seedcapRejectUntilMin(su) - nowMin;
  }
  if (out.windows.open) { out.windows.avgWindowH = Math.round(wSum / out.windows.open / 6) / 10; out.windows.avgLeftH = Math.round(lSum / out.windows.open / 6) / 10; }
  return out;
}

module.exports = { report };
if (require.main === module) {
  const L = readJson(arg('trust', 'trust.json'));
  const sc = readJson(arg('seedcap', 'seedcap.json'));
  const r = report(L, sc, Math.floor(Date.now() / 60000));
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(r, null, 1) + '\n'); process.exit(0); }
  console.log('trust ledger: ' + r.accounts + ' account(s)');
  console.log('\nsource month     events counted reversed accounts');
  for (const k of Object.keys(r.bySource).sort()) { const x = r.bySource[k]; console.log(k.padEnd(16) + String(x.events).padStart(7) + String(x.counted).padStart(8) + String(x.reversed).padStart(9) + String(x.accounts).padStart(9)); }
  console.log('\nworld core      convictions reversed observed');
  for (const k of Object.keys(r.byCore).sort()) { const x = r.byCore[k]; console.log(k.padEnd(16) + String(x.convictions).padStart(11) + String(x.reversed).padStart(9) + String(x.observed).padStart(9)); }
  console.log('\nopen reject windows (shadow pool): ' + r.windows.open + (r.windows.open ? ' -- avg window ' + r.windows.avgWindowH + ' h, avg left ' + r.windows.avgLeftH + ' h' : ''));
}
