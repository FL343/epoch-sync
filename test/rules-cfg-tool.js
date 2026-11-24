'use strict';
// tools/rules-cfg.js (O989): the one way rules-cfg.json is written. The job reads the file with validate.js loadRulesCfg and
// holds every couch match while it cannot use it, so the tool must never write a file the job would refuse.
//   [1] set from no file: revision 1, the numbers given, the others at their defaults; the job's reader takes the file
//   [2] set again: revision + 1, the revision before kept in the log (rev -> vals), a number not given keeps its value
//   [3] a number out of range / with four decimals / an unknown switch / nothing to set: nothing written, exit 1 or 2
//   [4] the same numbers again: nothing written (no revision spent)
//   [5] show / check: the cfg in force; a file the job could not use = exit 1; an unusable file is never overwritten by set
//   [6] revision 127 is the last one (the receipt stamp is 7 bits): a set past it is refused
//   [7] mutation proof: a tool that does not ask the job's reader writes a file the job refuses -- caught by [3]'s check
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'rules-cfg.js');
const PP = require(path.join(ROOT, 'points-plan.js'));
for (const k of Object.keys(process.env)) if (/_FILE$/.test(k)) delete process.env[k];
process.env.STATE_SALT = process.env.STATE_SALT || 's';
const v = require(path.join(ROOT, 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-cfg-tool-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });
const run = (file, args, tool) => { const r = spawnSync(process.execPath, [tool || TOOL].concat(args, ['--file=' + file]), { encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const D = PP.DEFAULTS;

console.log('=== tools/rules-cfg.js (O989) ===');
const f = path.join(dir, 'rules-cfg.json');
// [1]
{
  const r = run(f, ['set', '--pair-win=0.8', '--lp-mult=0']);
  const c = v.loadRulesCfg(f);
  T('[1] set from no file: revision 1, the two numbers given, the others at their defaults; the job reads it', r.code === 0 && !c.bad && c.rev === 1
    && J(c.vals) === J({ COUCH_SOLO_LOSS: D.COUCH_SOLO_LOSS, COUCH_PAIR_WIN: 0.8, COUCH_DUO_MULT: D.COUCH_DUO_MULT, COUCH_LP_MULT: 0 }), r.out + J(c));
  T('[1] the log holds revision 0 (the defaults)', (() => { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return o.log.length === 1 && o.log[0].rev === 0 && o.log[0].vals.COUCH_PAIR_WIN === D.COUCH_PAIR_WIN && !!o.log[0].until; })());
}
// [2]
{
  const r = run(f, ['set', '--duo-mult=0.5']);
  const c = v.loadRulesCfg(f), o = JSON.parse(fs.readFileSync(f, 'utf8'));
  T('[2] set again: revision 2, the number given changed, the others kept', r.code === 0 && !c.bad && c.rev === 2 && c.vals.COUCH_DUO_MULT === 0.5 && c.vals.COUCH_PAIR_WIN === 0.8 && c.vals.COUCH_LP_MULT === 0, r.out + J(c));
  T('[2] the log: revision 1 with its numbers, then revision 0, newest first', o.log.length === 2 && o.log[0].rev === 1 && o.log[0].vals.COUCH_LP_MULT === 0 && o.log[0].vals.COUCH_DUO_MULT === 1 && o.log[1].rev === 0, J(o.log));
}
// [3]
{
  const before = fs.readFileSync(f, 'utf8');
  const cases = [['--pair-win=1.2'], ['--pair-win=-0.1'], ['--solo-loss=0.8125'], ['--pair-win=abc'], ['--speed=0.5'], []];
  const rs = cases.map((a) => run(f, ['set'].concat(a)));
  T('[3] a number out of range / four decimals / not a number / an unknown switch / nothing to set: refused, nothing written', rs.every((r) => r.code === 1 || r.code === 2) && fs.readFileSync(f, 'utf8') === before, J(rs.map((r) => r.code)));
  T('[3] every file the tool wrote reads as a usable cfg on the job', !v.loadRulesCfg(f).bad && PP.rulesCfgOf(JSON.parse(before)) !== null);
}
// [4]
{
  const before = fs.readFileSync(f, 'utf8');
  const r = run(f, ['set', '--duo-mult=0.5', '--pair-win=0.800']);
  T('[4] the same numbers again: nothing written, the revision not spent', r.code === 0 && /no number changes/.test(r.out) && fs.readFileSync(f, 'utf8') === before, r.out);
}
// [5]
{
  const s = run(f, ['show']), c = run(f, ['check']), none = run(path.join(dir, 'none.json'), ['show']);
  T('[5] show / check print the cfg in force; no file = the defaults', s.code === 0 && /^rev 2 /.test(s.out) && /before: rev 1 /.test(s.out) && c.code === 0 && none.code === 0 && /rev 0 .*no file/.test(none.out), s.out + none.out);
  const b = path.join(dir, 'bad.json'); fs.writeFileSync(b, '{"rev":1,"vals":{"COUCH_SOLO_LOSS":2}}');
  const cb = run(b, ['check']), sb = run(b, ['set', '--lp-mult=1']);
  T('[5] a file the job could not use: check exits 1, set refuses to build on it (fix or delete it first)', cb.code === 1 && sb.code === 1 && fs.readFileSync(b, 'utf8') === '{"rev":1,"vals":{"COUCH_SOLO_LOSS":2}}' && !!v.loadRulesCfg(b).bad, cb.out + sb.out);
}
// [6]
{
  const g = path.join(dir, 'last.json');
  const vals = {}; for (const k of PP.CFG_KEYS) vals[k] = D[k];
  fs.writeFileSync(g, J({ rev: 126, vals, log: [] }));
  const a = run(g, ['set', '--lp-mult=0.5']), b2 = run(g, ['set', '--lp-mult=0.25']);
  T('[6] revision 127 is the last (7 bits on a receipt): 126 -> 127 written, the next one refused', a.code === 0 && v.loadRulesCfg(g).rev === 127 && b2.code === 1 && v.loadRulesCfg(g).rev === 127 && v.loadRulesCfg(g).vals.COUCH_LP_MULT === 0.5, a.out + b2.out);
}
// [7]
{
  const src = fs.readFileSync(TOOL, 'utf8');
  const from = "  if (!cfg) throw new Error('not a usable cfg", to = "  if (false) throw new Error('not a usable cfg";
  const from2 = "!/^(0|1|0?\\.[0-9]{1,3}|1\\.0{1,3})$/.test(m[2])", to2 = '!/^[0-9.]+$/.test(m[2])';
  if (src.split(from).length !== 2 || src.split(from2).length !== 2) bad('[7] mutant anchors not found exactly once');
  else {
    const mt = path.join(ROOT, 'tools', '.mutant-rules-cfg-' + process.pid + '.js');
    fs.writeFileSync(mt, src.replace(from, to).replace(from2, to2).replace("const cfg = PP.rulesCfgOf({ rev: cur.rev + 1, vals });", "const cfg = { rev: cur.rev + 1, vals };"));
    try {
      const h = path.join(dir, 'mut.json');
      const r = run(h, ['set', '--pair-win=1.2'], mt);
      T('[7] mutant (the tool does not ask the job\'s reader): it writes a file the job refuses -- caught', r.code === 0 && fs.existsSync(h) && !!v.loadRulesCfg(h).bad, r.out);
    } finally { try { fs.unlinkSync(mt); } catch (e) {} }
  }
}
console.log(failN ? ('rules-cfg-tool: ' + failN + ' FAIL') : 'rules-cfg-tool: all ok');
process.exit(failN ? 1 : 0);
