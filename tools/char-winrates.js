#!/usr/bin/env node
'use strict';
// ============================================================
// tools/char-winrates.js -- global per-character results from the career matrix in an xp state file (5.4a, 2026-10-19)
// ============================================================
// Sums every player's cm cells ("<mode>:<code>": [games, seconds, wins, losses]) of one channel's xp state file and prints
// per mode x character: games, hours, wins, losses, win rate (W/L only in quick / ranked). No identities: the state is keyed
// by salted ids and only totals are printed. For balance work (knife 3.5c2b / batch 8 calibration) next to the GA4 numbers.
// Character codes are the client's (mvp src/data/characters.js code): 0 unknown (an old client wrote no character block),
// 1 default, 2 merchant, 3 strongman, 4 tamer.
// Usage: node tools/char-winrates.js [xp.json | demo-xp.json | pt-xp.json] [--json]
// ============================================================
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) || 'xp.json';
const asJson = args.includes('--json');
const MODES = ['quick', 'ranked', 'private', 'bots', 'endless'];   // = validate.js CAREER_MODES
const CHARS = ['unknown', 'default', 'merchant', 'strongman', 'tamer'];
const st = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const tot = {};
let players = 0;
for (const p of Object.keys(st)) {
  const cm = st[p] && st[p].cm;
  if (!cm || typeof cm !== 'object') continue;
  players++;
  for (const k of Object.keys(cm)) {
    const a = cm[k] || [];
    const t = tot[k] || (tot[k] = [0, 0, 0, 0]);
    for (let i = 0; i < 4; i++) t[i] += Math.max(0, a[i] | 0);
  }
}
const rows = Object.keys(tot).map((k) => {
  const [m, c] = k.split(':').map(Number), a = tot[k];
  return { mode: MODES[m] || ('mode' + m), char: CHARS[c] || ('code' + c), games: a[0], hours: Math.round(a[1] / 36) / 100, wins: a[2], losses: a[3],
    winRate: (a[2] + a[3]) > 0 ? Math.round((a[2] / (a[2] + a[3])) * 1000) / 10 : null };
}).sort((x, y) => (MODES.indexOf(x.mode) - MODES.indexOf(y.mode)) || (CHARS.indexOf(x.char) - CHARS.indexOf(y.char)));
if (asJson) { console.log(JSON.stringify({ file: path.basename(file), players, rows }, null, 1)); process.exit(0); }
console.log(path.basename(file) + ': ' + players + ' player(s) with career cells');
for (const r of rows) console.log('  ' + r.mode.padEnd(8) + r.char.padEnd(10) + String(r.games).padStart(7) + ' games ' + String(r.hours).padStart(9) + ' h'
  + (r.winRate == null ? '' : ('  ' + r.wins + 'W ' + r.losses + 'L  ' + r.winRate + '%')));
