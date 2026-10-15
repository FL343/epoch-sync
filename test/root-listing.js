'use strict';
// Q225 (cloud audit 2026-10): tests that list the repo root must not trip over the scratch files other tests write there.
//   Since O463 the suite runs four files at a time (tools/run-tests.js --jobs=4 in validate.yml and audit.yml). About 20
//   tests check a mutant of validate.js by writing it into the repo root as .mutant-<name>-<pid>.js (so its relative
//   requires resolve), running it and deleting it. Three tests list the root: flag-prune.js and state-prune-rework.js copy
//   every entry into a temp tree, sandbox-fence.js reads every root *.js. A mutant file listed by one of them and deleted
//   by its owner before the copy / read threw ENOENT and turned the whole file red (once in 21 full runs, 2026-10-14) --
//   the first test run after a code push then fails and that tick does not settle. Those files are never part of the code
//   under test, so the listers skip them, and the copy also skips an entry that is gone by the time it is copied.
// Required by those tests (exports below); run directly it tests itself:
//   [1] rootEntries / copyRootTree on a fake root that loses the race on every listing: a mutant file listed and deleted
//       before the copy, one present during the whole copy, a vanished entry of any other name; the skip list; an
//       ENOENT from inside an entry that is still there is not swallowed. The same fake root makes the old loop throw.
//   [2] static: no test lists the repo root with fs.readdirSync / opendirSync any more (they go through this file); the
//       scanner is checked on the old forms first, so a rewrite it cannot see fails here
//   [3] static: every name a test makes up under the repo root (path.join(<root>, '<name>'...) where <name> is not a file
//       of this repo) starts with .mutant-, so the skip above covers it (write anything else under os.tmpdir())
//   [4] wiring: the three listers use this file
//   node test/root-listing.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRATCH_PREFIX = '.mutant-';
// a scratch file of another test (written into the root, run and deleted while this suite runs in parallel)
function isScratch(name) { return String(name).startsWith(SCRATCH_PREFIX); }

// the repo root's entries without other tests' scratch files
function rootEntries(root) { return fs.readdirSync(root).filter((f) => !isScratch(f)); }

// copy every root entry but the skipped ones into dest; an entry gone between the listing and its copy is not copied
//   (only a top-level entry that no longer exists: an ENOENT from inside an entry that is still there is thrown)
function copyRootTree(root, dest, skip) {
  const skipSet = new Set(skip || []);
  const copied = [];
  for (const f of rootEntries(root)) {
    if (skipSet.has(f)) continue;
    try {
      fs.cpSync(path.join(root, f), path.join(dest, f), { recursive: true });
      copied.push(f);
    } catch (e) {
      if (e && e.code === 'ENOENT' && !fs.existsSync(path.join(root, f))) continue;
      throw e;
    }
  }
  return copied;
}

module.exports = { SCRATCH_PREFIX, isScratch, rootEntries, copyRootTree };
if (require.main !== module) return;

// ---------------------------------------------------------------- self-test
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); T(label + ' = ' + a, a === b, 'EXPECT ' + b); };
const ROOT = path.join(__dirname, '..');

// ---- [1] behavior on a fake root that loses the race
console.log('-- [1] rootEntries / copyRootTree when another test writes and deletes a scratch file around the listing');
{
  const W = fs.mkdtempSync(path.join(os.tmpdir(), 'root-listing-'));
  const FAKE = path.join(W, 'root');
  fs.mkdirSync(FAKE);
  const put = (rel, body) => { const p = path.join(FAKE, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
  put('validate.js', '// v\n'); put('attest-keys.json', '{}\n'); put('perks-vendor/a.js', '// a\n');
  put('.github/workflows/x.yml', 'x\n'); put('.git/HEAD', 'ref\n'); put('test/t.js', '// t\n'); put('node_modules/m/i.js', '// m\n');
  put('.mutant-present-1.js', '// a mutant that stays for the whole copy\n');
  // every listing of FAKE: the "other test" writes its scratch files just before the listing and deletes them right
  //   after it returns -- they are listed but gone by the time they are copied / read
  const GHOSTS = ['.mutant-gone-2.js', 'zz-gone-3.txt'];
  const orig = fs.readdirSync;
  let listings = 0;
  fs.readdirSync = function (p) {
    if (path.resolve(String(p)) !== FAKE) return orig.apply(this, arguments);
    listings++;
    for (const g of GHOSTS) fs.writeFileSync(path.join(FAKE, g), '// gone\n');
    try { return orig.apply(this, arguments); } finally { for (const g of GHOSTS) fs.unlinkSync(path.join(FAKE, g)); }
  };
  const tree = (d) => { const out = []; const walk = (r) => { for (const e of orig(path.join(d, r), { withFileTypes: true })) { const rel = path.join(r, e.name); if (e.isDirectory()) walk(rel); else out.push(rel.split(path.sep).join('/')); } }; walk(''); return out.sort(); };
  try {
    // the old loop (flag-prune.js / state-prune-rework.js before Q225) on this root: the race bites
    let oldErr = null;
    const OLD = path.join(W, 'old');
    fs.mkdirSync(OLD);
    try {
      for (const f of fs.readdirSync(FAKE)) {
        if (f === '.git' || f === 'test' || f === 'node_modules') continue;
        fs.cpSync(path.join(FAKE, f), path.join(OLD, f), { recursive: true });
      }
    } catch (e) { oldErr = e; }
    T('[1] the old copy loop throws ENOENT on this root (the race the fake root stages)', oldErr && oldErr.code === 'ENOENT', oldErr ? oldErr.message : 'no error');
    // the old sandbox-fence scan on this root
    let scanErr = null;
    try { for (const f of fs.readdirSync(FAKE).filter((x) => x.endsWith('.js'))) fs.readFileSync(path.join(FAKE, f), 'utf8'); } catch (e) { scanErr = e; }
    T('[1] the old *.js scan throws ENOENT on this root', scanErr && scanErr.code === 'ENOENT', scanErr ? scanErr.message : 'no error');

    eq('[1] rootEntries: no scratch file, listed or present', rootEntries(FAKE).sort(), ['.git', '.github', 'attest-keys.json', 'node_modules', 'perks-vendor', 'test', 'validate.js', 'zz-gone-3.txt']);
    const DEST = path.join(W, 'dest');
    fs.mkdirSync(DEST);
    let copied = null, err = null;
    try { copied = copyRootTree(FAKE, DEST, ['.git', 'test', 'node_modules']); } catch (e) { err = e; }
    T('[1] copyRootTree does not throw', !err, err && err.message);
    eq('[1] copyRootTree returns what it copied (the vanished entry is not among them)', copied && copied.slice().sort(), ['.github', 'attest-keys.json', 'perks-vendor', 'validate.js']);
    eq('[1] the copied tree: every file of the root but the skipped dirs and the scratch / vanished files', tree(DEST), ['.github/workflows/x.yml', 'attest-keys.json', 'perks-vendor/a.js', 'validate.js']);
    T('[1] the fake root was listed (the race was staged)', listings >= 3, 'listings ' + listings);
    T('[1] the fake root is as it was (ghosts gone, the present mutant kept)', fs.existsSync(path.join(FAKE, '.mutant-present-1.js')) && !GHOSTS.some((g) => fs.existsSync(path.join(FAKE, g))));

    // an ENOENT from inside an entry that is still there (a file vanishing under a copied directory) is not swallowed
    const origCp = fs.cpSync;
    fs.cpSync = function (src) {
      if (path.basename(String(src)) === 'perks-vendor') { const e = new Error("ENOENT: no such file or directory, lstat '" + path.join(String(src), 'a.js') + "'"); e.code = 'ENOENT'; throw e; }
      return origCp.apply(this, arguments);
    };
    let inner = null;
    try { copyRootTree(FAKE, fs.mkdtempSync(path.join(W, 'd2-')), ['.git', 'test', 'node_modules']); } catch (e) { inner = e; } finally { fs.cpSync = origCp; }
    T('[1] an ENOENT under an entry that still exists is thrown', inner && inner.code === 'ENOENT' && /perks-vendor/.test(inner.message), inner ? inner.message : 'swallowed');
    // any other error is thrown too
    fs.cpSync = function () { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
    let other = null;
    try { copyRootTree(FAKE, fs.mkdtempSync(path.join(W, 'd3-')), []); } catch (e) { other = e; } finally { fs.cpSync = origCp; }
    T('[1] a non-ENOENT error is thrown', other && other.code === 'EACCES', other ? other.message : 'swallowed');
  } finally {
    fs.readdirSync = orig;
    fs.rmSync(W, { recursive: true, force: true });
  }
  eq('[1] isScratch', ['.mutant-a-1.js', '.mutant-', 'mutant-a.js', '.github', 'validate.js', 'x.mutant-a.js'].map(isScratch), [true, true, false, false, false, false]);
}

// ---- static helpers (shared by [2] / [3])
// the text inside the parentheses that open at src[i] (i at '('), or null
function parenArg(src, i) {
  let depth = 0, q = null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(i + 1, j);
  }
  return null;
}
// split a call's argument text on its top-level commas
function topArgs(text) {
  const out = []; let depth = 0, q = null, cur = '';
  for (let j = 0; j < text.length; j++) {
    const c = text[j];
    if (q) { cur += c; if (c === '\\') { cur += text[++j] || ''; } else if (c === q) q = null; continue; }
    if (c === '\'' || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const squash = (s) => s.replace(/\s+/g, '').replace(/"/g, '\'');
// the expressions that mean "the repo root" in a test file: path.join / path.resolve(__dirname, '..'), a name assigned
//   one of those, path.dirname(X) for X = path.join(__dirname, '..', '<file>')
function rootForms(src) {
  const forms = new Set(['path.join(__dirname,\'..\')', 'path.resolve(__dirname,\'..\')', 'path.join(__dirname,\'../\')', 'path.resolve(__dirname,\'../\')',
    '__dirname+\'/..\'', 'process.cwd()', '\'.\'', '\'./\'']);   // the last two: tools/run-tests.js runs every test with cwd = the root
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:join|resolve)\(/g)) {
    const a = parenArg(src, m.index + m[0].length - 1);
    if (a == null) continue;
    const args = topArgs(a).map(squash);
    if (args[0] !== '__dirname' || !/^'\.\.\/?'$/.test(args[1] || '')) continue;
    if (args.length === 2) forms.add(m[1]);
    else if (args.length === 3 && /^'[^'/]+'$/.test(args[2])) forms.add('path.dirname(' + m[1] + ')');
  }
  return forms;
}
// [2] the directory listings of the root in a source text
function rootListings(src) {
  const forms = rootForms(src), hits = [];
  for (const m of src.matchAll(/\b(readdirSync|opendirSync|readdir|opendir)\s*\(/g)) {
    const a = parenArg(src, m.index + m[0].length - 1);
    if (a == null) continue;
    const first = squash(topArgs(a)[0] || '');
    if (forms.has(first)) hits.push(src.slice(0, m.index).split('\n').length + ': ' + m[1] + '(' + first + ')');
  }
  return hits;
}
// [3] the names a source text makes up under the root: path.join / resolve(<root>, '<lit>'...) -> '<lit>' (first segment)
function rootNames(src) {
  const forms = rootForms(src), out = [];
  for (const m of src.matchAll(/\bpath\.(?:join|resolve)\s*\(/g)) {
    const a = parenArg(src, m.index + m[0].length - 1);
    if (a == null) continue;
    const args = topArgs(a);
    let rest = null;
    if (args.length >= 3 && squash(args[0]) === '__dirname' && /^'\.\.\/?'$/.test(squash(args[1]))) rest = args[2];
    else if (args.length >= 2 && forms.has(squash(args[0]))) rest = args[1];
    if (rest == null) continue;
    const lit = rest.match(/^(['"`])([^'"`]*)\1?/);
    if (!lit) continue;   // a computed name: not checked (see the header)
    out.push({ line: src.slice(0, m.index).split('\n').length, name: lit[2].split('/')[0] });
  }
  return out;
}

const SELF = path.basename(__filename);
const TESTS = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && f !== SELF).sort();
const SRC = {};
for (const f of TESTS) SRC[f] = fs.readFileSync(path.join(__dirname, f), 'utf8');

// ---- [2] no raw listing of the root
console.log('-- [2] static: no test lists the repo root itself');
{
  // the scanner on the old forms first (a scanner that sees nothing would pass anything)
  const OLD_COPY = "const ROOT = path.join(__dirname, '..');\nfor (const f of fs.readdirSync(ROOT)) {\n  if (f === '.git') continue;\n  fs.cpSync(path.join(ROOT, f), path.join(TREE, f), { recursive: true });\n}\n";
  const OLD_SCAN = "  const root = path.join(__dirname, '..');\n  const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));\n";
  const INLINE = "for (const f of fs.readdirSync( path.join(__dirname, '..') )) {}\nfs.opendirSync(path.resolve(__dirname, \"..\"));\nfs.readdirSync('.'); fs.readdirSync(process.cwd());\n";
  const VIA_FILE = "const VALIDATE = path.join(__dirname, '..', 'validate.js');\nconst names = fs.readdirSync(path.dirname(VALIDATE));\n";
  const NOT_ROOT = "const WF = path.join(__dirname, '..', '.github', 'workflows');\nfs.readdirSync(WF); fs.readdirSync(dir); fs.readdirSync(path.join(__dirname, '..', 'tools'));\n";
  eq('[2] scanner sees the old copy loop', rootListings(OLD_COPY), ['2: readdirSync(ROOT)']);
  eq('[2] scanner sees the old sandbox-fence scan', rootListings(OLD_SCAN), ['2: readdirSync(root)']);
  eq('[2] scanner sees inline root paths and the cwd', rootListings(INLINE), ['1: readdirSync(path.join(__dirname,\'..\'))', '2: opendirSync(path.resolve(__dirname,\'..\'))', '3: readdirSync(\'.\')', '3: readdirSync(process.cwd())']);
  eq('[2] scanner sees path.dirname(<root file>)', rootListings(VIA_FILE), ['2: readdirSync(path.dirname(VALIDATE))']);
  eq('[2] scanner leaves listings of other directories alone', rootListings(NOT_ROOT), []);
  const hits = [];
  for (const f of TESTS) for (const h of rootListings(SRC[f])) hits.push('test/' + f + ':' + h);
  T('[2] no test/*.js lists the repo root itself (' + TESTS.length + ' files; use rootEntries / copyRootTree from test/' + SELF + ')', hits.length === 0, hits.join('; '));
}

// ---- [3] names made up under the root are scratch names
console.log('-- [3] static: every name a test makes up under the repo root starts with ' + SCRATCH_PREFIX);
{
  const SAMPLE = "const s = path.join(__dirname, '..', '.mutant-x-' + process.pid + '.js');\nconst b = path.join(__dirname, '..', '.scratch-y.js');\nconst ROOT = path.join(__dirname, '..');\nconst c = path.join(ROOT, 'validate.js'); const d = path.join(ROOT, 'out-' + n);\n";
  eq('[3] scanner reads the first literal segment under the root', rootNames(SAMPLE).map((x) => x.line + ':' + x.name), ['1:.mutant-x-', '2:.scratch-y.js', '4:validate.js', '4:out-']);
  const have = new Set(rootEntries(ROOT));
  const made = [], bad3 = [];
  for (const f of TESTS) for (const x of rootNames(SRC[f])) {
    if (x.name === '' || x.name === '..' || x.name === '.' || have.has(x.name)) continue;
    made.push(x.name);
    if (!isScratch(x.name)) bad3.push('test/' + f + ':' + x.line + ' ' + x.name);
  }
  T('[3] the scanner finds the mutant writers (' + made.length + ' made-up names)', made.length >= 20, 'found ' + made.length);
  T('[3] every made-up root name starts with ' + SCRATCH_PREFIX + ' (else rootEntries does not skip it: name it so, or write under os.tmpdir())', bad3.length === 0, bad3.join('; '));
}

// ---- [4] wiring
console.log('-- [4] wiring: the three root listers go through this file');
{
  const uses = (f, fn) => /require\(\s*'\.\/root-listing'\s*\)/.test(SRC[f] || '') && new RegExp('\\b' + fn + '\\s*\\(').test(SRC[f] || '');
  T('[4] flag-prune.js copies the root with copyRootTree', uses('flag-prune.js', 'copyRootTree'));
  T('[4] state-prune-rework.js copies the root with copyRootTree', uses('state-prune-rework.js', 'copyRootTree'));
  T('[4] sandbox-fence.js lists the root with rootEntries', uses('sandbox-fence.js', 'rootEntries'));
}

if (failN) { console.log('\nroot-listing: ' + failN + ' FAILED'); process.exit(1); }
console.log('\nroot-listing: ALL PASS');
