#!/usr/bin/env node
'use strict';
// ============================================================
// tools/rules-cfg.js -- read and change rules-cfg.json, the numbers of points-plan.js that move without a build (O989).
// ============================================================
// rules-cfg.json sits beside validate.js ({ rev, vals, log }): the job reads it at the start of every run (validate.js
// loadRulesCfg), settles couch matches with its numbers, publishes them on its pulse row for the client and stamps `rev` on
// the receipts of the couch matches it settles. No file = revision 0 = the defaults of points-plan.js.
// A change is a commit on the job's branch like any other: it takes effect at the next run, it is in the history, and a
// match already settled is never read again with the new numbers. This tool only writes the file -- it validates the
// numbers with the job's own reader (points-plan.js rulesCfgOf), raises `rev` by one and keeps the revisions before in
// `log` (rev -> vals, newest first, at most 126), so a receipt's revision can always be read back to its numbers.
//   node tools/rules-cfg.js show                      the cfg in force (the file, or the defaults)
//   node tools/rules-cfg.js check                     exit 1 when the file is there and the job could not use it
//   node tools/rules-cfg.js set --pair-win=0.8 ...    write the next revision; a number not given keeps its value
//       --solo-loss=X   COUCH_SOLO_LOSS  a solo's loss in a brawl with a live couch pair is multiplied by X   (default 0.8)
//       --pair-win=X    COUCH_PAIR_WIN   the couch pair's win in a brawl is multiplied by X                    (default 0.85)
//       --duo-mult=X    COUCH_DUO_MULT   a couch main's whole delta at a table of two accounts, both couch    (default 1)
//       --lp-mult=X     COUCH_LP_MULT    every couch main's whole delta (0 = a couch match moves no points)    (default 1)
//     each X in 0..1, at most three decimals
//   --file=PATH  another file than rules-cfg.json beside validate.js (tests)
// Exit: 0 done · 1 not usable / a bad number · 2 usage
// ============================================================
const fs = require('fs'), path = require('path');
const PP = require(path.join(__dirname, '..', 'points-plan.js'));

const ARGS = { 'solo-loss': 'COUCH_SOLO_LOSS', 'pair-win': 'COUCH_PAIR_WIN', 'duo-mult': 'COUCH_DUO_MULT', 'lp-mult': 'COUCH_LP_MULT' };
const LOG_CAP = 126;
const defaults = () => { const vals = {}; for (const k of PP.CFG_KEYS) vals[k] = PP.DEFAULTS[k]; return { rev: 0, vals }; };
// { cfg, log, bad } of a file: no file / an empty object = the defaults; bad = why the job could not use it
function read(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return (e && e.code === 'ENOENT') ? { cfg: defaults(), log: [] } : { cfg: defaults(), log: [], bad: 'unreadable (' + (e && e.code) + ')' }; }
  let o;
  try { o = JSON.parse(text); } catch (e) { return { cfg: defaults(), log: [], bad: 'not JSON' }; }
  if (o && typeof o === 'object' && !Array.isArray(o) && !Object.keys(o).length) return { cfg: defaults(), log: [] };
  const cfg = PP.rulesCfgOf(o);
  if (!cfg) return { cfg: defaults(), log: [], bad: 'rev or a value out of range' };
  return { cfg, log: Array.isArray(o.log) ? o.log.filter((x) => !!PP.rulesCfgOf(x)).map((x) => Object.assign(PP.rulesCfgOf(x), x.until ? { until: String(x.until) } : {})) : [] };
}
function render(cfg, log) {
  const line = (x) => JSON.stringify(x);
  return '{\n  "rev": ' + cfg.rev + ',\n  "vals": ' + line(cfg.vals) + ',\n  "log": [' + (log.length ? '\n' + log.map((x) => '    ' + line(x)).join(',\n') + '\n  ' : '') + ']\n}\n';
}
// the next revision of `cur` with `over` ({ KEY: number }); throws on a number the job would not take
function next(cur, log, over, nowIso) {
  const vals = Object.assign({}, cur.vals, over);
  const cfg = PP.rulesCfgOf({ rev: cur.rev + 1, vals });
  if (!cfg) throw new Error('not a usable cfg (each number 0..1, at most three decimals; revision at most 127): ' + JSON.stringify({ rev: cur.rev + 1, vals }));
  if (PP.CFG_KEYS.every((k) => cfg.vals[k] === cur.vals[k])) return null;
  const was = Object.assign({ rev: cur.rev, vals: cur.vals }, nowIso ? { until: nowIso } : {});
  return { cfg, log: [was].concat(log).slice(0, LOG_CAP) };
}
function main(argv) {
  const cmd = argv[0];
  const fileArg = argv.find((a) => a.startsWith('--file='));
  const file = fileArg ? fileArg.slice(7) : path.join(__dirname, '..', 'rules-cfg.json');
  const r = read(file);
  const show = (c) => 'rev ' + c.rev + '  ' + PP.CFG_KEYS.map((k) => k + '=' + c.vals[k]).join('  ');
  if (cmd === 'show' || cmd === 'check') {
    if (r.bad) { console.error('rules-cfg: ' + file + ' is not usable (' + r.bad + '): the job runs the defaults and holds every couch match'); return 1; }
    console.log(show(r.cfg) + (fs.existsSync(file) ? '' : '  (no file: the defaults)'));
    if (cmd === 'show') for (const x of r.log) console.log('  before: ' + show(x) + (x.until ? '  until ' + x.until : ''));
    return 0;
  }
  if (cmd !== 'set') { console.error('usage: node tools/rules-cfg.js show | check | set --solo-loss=X --pair-win=X --duo-mult=X --lp-mult=X [--file=PATH]'); return 2; }
  if (r.bad) { console.error('rules-cfg: ' + file + ' is not usable (' + r.bad + '): fix or delete it first'); return 1; }
  const over = {};
  for (const a of argv.slice(1)) {
    if (a.startsWith('--file=')) continue;
    const m = /^--([a-z-]+)=(.+)$/.exec(a);
    if (!m || !ARGS[m[1]] || !/^(0|1|0?\.[0-9]{1,3}|1\.0{1,3})$/.test(m[2])) { console.error('rules-cfg: cannot read ' + a + ' (a number 0..1 with at most three decimals for --' + Object.keys(ARGS).join(' / --') + ')'); return 2; }
    over[ARGS[m[1]]] = Number(m[2]);
  }
  if (!Object.keys(over).length) { console.error('rules-cfg: nothing to set'); return 2; }
  let nx;
  try { nx = next(r.cfg, r.log, over, new Date().toISOString()); } catch (e) { console.error('rules-cfg: ' + e.message); return 1; }
  if (!nx) { console.log('rules-cfg: no number changes -- ' + show(r.cfg) + ' (nothing written)'); return 0; }
  fs.writeFileSync(file, render(nx.cfg, nx.log));
  console.log('rules-cfg: wrote ' + file);
  console.log('  was: ' + show(r.cfg));
  console.log('  now: ' + show(nx.cfg));
  console.log('  commit it on the job\'s branch: it is in force from the next run; matches already settled keep their points');
  return 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { read, render, next, main, ARGS, LOG_CAP };
