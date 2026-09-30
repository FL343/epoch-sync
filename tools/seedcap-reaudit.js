#!/usr/bin/env node
'use strict';
// ============================================================
// tools/seedcap-reaudit.js -- READ-ONLY re-audit of the live shards against the current seedcap rules and cores.
// ============================================================
// Why: any change to seedcap.js (tail decode, build replay, chain rule, core routing) or a new compiled world core must be
//   proven on the REAL records before it is pushed: an honest match over the cap is a false veto (and, if self-written, a
//   conviction). This tool replays every settled group through the same functions the cron runs (readGroups ->
//   pickAuditable -> takeSkips -> auditPending -> applyAudit) on a scratch state and prints the outcome. It never saves
//   state, never writes a board, never mails. Gate: exit 1 when any group is over-cap (or when the CLI fails).
// Usage (same environment as seedcap.js -- no app id / board name is hard-coded here):
//   STEAM_PUBLISHER_KEY=... APPID=... LB_PREFIX=... STATE_SALT=... [SEEDCAP_CLI=... SEEDCAP_DIST_DIR=... SEEDCAP_CHANNEL=...]
//   node tools/seedcap-reaudit.js [--state=<seedcap state file>] [--json] [--cli=<exe>] [--old-cli=<exe>] [--allow-over]
//     --state    seed the scratch state's chain from a real state file (carry-in bounds as the cron would see them); default: empty
//     --cli      audit with ONE core (this exe) instead of the live.json selection (e.g. a freshly built out/seedcap_cli.exe)
//     --old-cli  also cap every group with a second exe and report the cap ratio distribution new/old (core change review)
//     --json     machine-readable summary on stdout
//     --allow-over  do not fail the process on over-cap groups (exploration only)
// Output never contains steam ids (pids only, and only counts by default).
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const arg = (name) => { const a = process.argv.find(x => x.startsWith('--' + name + '=')); return a ? a.slice(name.length + 3) : null; };
const has = (name) => process.argv.includes('--' + name);
if (!process.env.STEAM_PUBLISHER_KEY || !process.env.APPID || !process.env.LB_PREFIX) {
  console.error('seedcap-reaudit: STEAM_PUBLISHER_KEY / APPID / LB_PREFIX unset (same environment as seedcap.js)');
  process.exit(2);
}
process.env.STATE_SALT = process.env.STATE_SALT || 'reaudit-scratch-salt';
process.env.SC_STATE_FILE = path.join(os.tmpdir(), 'seedcap-reaudit-' + process.pid + '.json');   // never written: loadState/saveState are not called
const v = require('../validate.js');
const sc = require('../seedcap.js');

const q = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(4); };

(async () => {
  const rg = await sc.readGroups();
  if (rg.fail) { console.error('seedcap-reaudit: ' + rg.fail); process.exit(1); }
  const groups = rg.groups;
  // scratch state: nothing audited yet (everything is re-audited), chain optionally seeded from a real state file
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const stateFile = arg('state');
  if (stateFile) { try { st.chain = JSON.parse(fs.readFileSync(stateFile, 'utf8')).chain || {}; } catch (e) { console.error('seedcap-reaudit: cannot read --state ' + stateFile); process.exit(2); } }
  const picked = sc.takeSkips(st, sc.pickAuditable(st, groups), Math.floor(Date.now() / 60000));
  const distDir = process.env.SEEDCAP_DIST_DIR || path.dirname(process.env.SEEDCAP_CLI || './seedcap_cli.exe');
  const channel = process.env.SEEDCAP_CHANNEL || '';
  const cliOverride = arg('cli');
  const cf = cliOverride ? { live: null, sel: { primary: null, extra: [], why: 'cli-override' }, cores: [{ exe: cliOverride, label: 'override' }] } : sc.coresForNow(distDir, channel, Date.now());
  const ctx = { cores: cf.cores, live: cf.live, channel, distDir };
  const audited = sc.auditPending(picked.pending, ctx);
  if (audited.fail) { console.error('seedcap-reaudit: ' + audited.fail); process.exit(1); }
  const stats = sc.applyAudit(st, audited.pending, audited.map, new Set(), Math.floor(Date.now() / 60000));
  const byMt = {}, headroom = [];
  let solo = 0, classic = 0, exactN = audited.exact, err = 0;
  audited.pending.forEach((x, i) => {
    const r = audited.map['m' + i];
    const k = 'mt' + (x.mt | 0);
    byMt[k] = byMt[k] || { n: 0, over: 0, err: 0 };
    byMt[k].n++;
    if (x.pc === 1 && x.p.entry === 'endless') solo++;
    if (x.p.classic) classic++;
    if (!r || r.err != null) { byMt[k].err++; err++; return; }
    const cap = Math.round(r.cap * (x.p.capMult || 1));
    const mx = Math.max.apply(null, x.scores);
    if (mx > cap) byMt[k].over++;
    if (cap > 0) headroom.push(mx / cap);
  });
  const out = {
    channel: channel || '-', cores: cf.cores.map(c => c.label), why: cf.sel.why, shards: rg.shards, records: rg.records,
    groups: Object.keys(groups).length, auditable: picked.pending.length + picked.skipped.length, skipped: picked.skipped.length, deferred: audited.deferred,
    audited: audited.pending.length, solo, classic, exactCore: exactN, err,
    over: stats.over, convicted: Object.keys(st.suspects).length, byMt,
    scoreOverCap: { p50: q(headroom, 0.5), p90: q(headroom, 0.9), p99: q(headroom, 0.99), max: q(headroom, 1) },
  };
  const oldCli = arg('old-cli');
  if (oldCli) {
    const old = sc.auditPending(audited.pending, { cores: [{ exe: oldCli, label: 'old' }], live: null, channel: '', distDir });
    const ratios = [];
    let overOld = 0;
    audited.pending.forEach((x, i) => {
      const a = audited.map['m' + i], b = old.map && old.map['m' + i];
      if (!a || !b || a.err != null || b.err != null || !(b.cap > 0)) return;
      ratios.push(a.cap / b.cap);
      if (Math.max.apply(null, x.scores) > Math.round(b.cap * (x.p.capMult || 1))) overOld++;
    });
    out.old = { exe: oldCli, overOld, deferred: old.deferred, capNewOverOld: { min: q(ratios, 0), p10: q(ratios, 0.1), p50: q(ratios, 0.5), p90: q(ratios, 0.9), max: q(ratios, 1) } };
  }
  if (has('json')) console.log(JSON.stringify(out, null, 1));
  else {
    console.log('seedcap-reaudit (read-only): channel=' + out.channel + ' cores=' + out.cores.join(',') + ' (' + out.why + ')');
    console.log('  shards=' + out.shards + ' records=' + out.records + ' groups=' + out.groups + ' auditable=' + out.auditable + ' skipped=' + out.skipped + ' deferred=' + out.deferred + ' audited=' + out.audited + ' (solo ' + out.solo + ', classic ' + out.classic + ', exact-core ' + out.exactCore + ') err=' + out.err);
    console.log('  OVER-CAP=' + out.over + ' convicted=' + out.convicted + ' score/cap p50=' + out.scoreOverCap.p50 + ' p90=' + out.scoreOverCap.p90 + ' p99=' + out.scoreOverCap.p99 + ' max=' + out.scoreOverCap.max);
    for (const k of Object.keys(out.byMt).sort()) console.log('  ' + k + ': n=' + out.byMt[k].n + ' over=' + out.byMt[k].over + ' err=' + out.byMt[k].err);
    if (out.old) console.log('  vs ' + out.old.exe + ': overOld=' + out.old.overOld + ' deferred=' + out.old.deferred + ' cap new/old min=' + out.old.capNewOverOld.min + ' p10=' + out.old.capNewOverOld.p10 + ' p50=' + out.old.capNewOverOld.p50 + ' p90=' + out.old.capNewOverOld.p90 + ' max=' + out.old.capNewOverOld.max);
  }
  if (out.over > 0 && !has('allow-over')) { console.error('seedcap-reaudit: GATE FAILED -- ' + out.over + ' honest-looking group(s) over cap; do not push this rule/core'); process.exit(1); }
})().catch(e => { console.error('seedcap-reaudit: ' + (e && e.stack || e)); process.exit(1); });
