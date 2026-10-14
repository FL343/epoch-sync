#!/usr/bin/env node
'use strict';
// ============================================================
// tools/code-hash.js -- fingerprint of the reconcile CODE, for skipping a test run that already passed (O463).
// ============================================================
// Why: validate.yml runs the whole test suite before every 5-min reconcile. As audit fixes landed end-to-end tests
//   (each spawning validate.js tens to hundreds of times) the suite went from seconds (2026-10-08) to 3+ min (10-13)
//   while the settlement itself stayed at about a second -- most of the cadence, and at that rate past the 10-min job
//   timeout (no settlement at all). Same code + same node = same verdict, so a pass needs proving once per code change.
// What goes in: every tracked file (path + blob id from `git ls-files -s`) EXCEPT the state files the workflows write
//   back on every tick (otherwise the key would change every 5 min), plus the node version. State files are read from
//   the workflows themselves -- the persist loops (`for f in a.json b.json; do` + `[ -f "$f" ]`) and the literal
//   `git add [--] <file>` lines -- so a new state file lands in the list the day its workflow learns to write it.
//   Hand-maintained root json (key rings, word lists, caps) are code: CONFIG_JSON. test/code-hash.js fails when a
//   root-level json is in neither list, so a new file has to be classified on purpose.
// Usage: node tools/code-hash.js            -> prints the hex fingerprint (validate.yml: cache key tests-pass-<hex>)
//        node tools/code-hash.js --explain  -> also lists the state / config split (stderr)
// ============================================================
const fs = require('fs'), path = require('path'), cp = require('child_process'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CONFIG_JSON = ['attest-keys.json', 'feedback-mod.json', 'feedback-wordlist.json', 'gr-caps.json', 'recover-shards.json'];

// root-level files any workflow writes back (persist loops + literal git add)
function stateFiles(root) {
  const out = new Set();
  const dir = path.join(root, '.github', 'workflows');
  for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/for f in ([^;\n]+); do\s*\n\s*\[ -f "\$f" \]/g)) for (const n of m[1].trim().split(/\s+/)) out.add(n);
    for (const m of src.matchAll(/^\s*git add (?:-- )?([^\n]+)$/gm)) for (const n of m[1].trim().split(/\s+/)) if (!n.startsWith('$')) out.add(n);
  }
  for (const n of out) if (!/^[\w.-]+$/.test(n)) out.delete(n);   // root-level names only
  return out;
}

// `git ls-files -s` text -> fingerprint (pure: test/code-hash.js feeds it synthetic listings)
function codeHash(lsFiles, state, nodeVersion) {
  const lines = String(lsFiles).split('\n').filter(Boolean).filter((l) => !state.has(l.split('\t')[1]));
  return crypto.createHash('sha256').update('o463-v1\n' + nodeVersion + '\n' + lines.join('\n')).digest('hex').slice(0, 40);
}

function lsFiles(root) {
  const r = cp.spawnSync('git', ['ls-files', '-s'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('git ls-files failed: ' + (r.stderr || r.error));
  return r.stdout;
}

module.exports = { CONFIG_JSON, stateFiles, codeHash, lsFiles };

if (require.main === module) {
  const state = stateFiles(ROOT);
  const ls = lsFiles(ROOT);
  if (process.argv.includes('--explain')) {
    const rootJson = ls.split('\n').filter(Boolean).map((l) => l.split('\t')[1]).filter((p) => /^[^/]+\.json$/.test(p));
    process.stderr.write('state (skipped): ' + [...state].sort().join(' ') + '\n');
    process.stderr.write('config json (hashed): ' + rootJson.filter((p) => !state.has(p)).join(' ') + '\n');
  }
  process.stdout.write(codeHash(ls, state, process.version) + '\n');
}
