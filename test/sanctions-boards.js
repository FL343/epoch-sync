'use strict';
// test/sanctions-boards.js -- which boards a full ban exiles (cloud audit R1-X13, 2026-10-09).
//
// The first cut exiled a hand-kept default of four boards plus an EXILE_BOARDS secret that was never set, so a
// banned account kept its rows on every display board added since. sanctions.js now derives the list from
// validate.js's board-name constants. This file holds:
//   1. the coverage tripwire: every board constant (and literal board name) validate.js declares is in exactly one
//      of sanctions.js EXILE_DISPLAY / EXILE_KEEP, every table entry still exists in validate.js and is exported,
//      and the season flags match validate.js's season-twin families -- with mutation self-proofs;
//   2. the derived list (season twins, campaign difficulties, env append, keep-list refusal);
//   3. fake-Steam reconcile runs of the real ban / unban / sweep code: season twins move, absent source boards are
//      skipped and never created (the demo app has no lp_ladder and must not get one), shadows are created only on
//      a real move, restore creates nothing, listing lag is bypassed, failures throw -- plus behaviour mutations of
//      sanctions.js that each turn one of those checks red.
// Offline: global.fetch is replaced by an in-memory leaderboard service; no network, no secrets.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.STATE_SALT = process.env.STATE_SALT || 'testsalt';
process.env.APPID = process.env.APPID || '480';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'testkey';
process.env.READ_RETRY_MS = '0';
delete process.env.EXILE_BOARDS;
delete process.env.BAN_APPIDS;
// The four board names that reach the reconcile only through secrets, handed to the sanctions job by sanctions.yml the
//   same way (fixture values = the client defaults, except RANKED_LB: its real name appears nowhere in this public repo, so
//   a stand-in here; the private push hook keeps the real one out of every non-test file anyway). A prefix without "test"
//   keeps validate.js's sandbox fence off.
const SECRET_NAMES = { LB_PREFIX: 'lb_rec_', RANKED_LB: 'rating_hidden', LP_LB: 'lp_ladder', XP_LB: 'xp_ladder' };
for (const [k, n] of Object.entries(SECRET_NAMES)) process.env[k] = n;

const ROOT = path.join(__dirname, '..');
const v = require('../validate.js');
const s = require('../sanctions.js');
const VSRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const SSRC = fs.readFileSync(path.join(ROOT, 'sanctions.js'), 'utf8');
const WFSRC = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'sanctions.yml'), 'utf8');

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); pass++; console.log('  ok    ' + name); }
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// =====================================================================================================
// 1. coverage tripwire (pure functions over the validate.js source text + the two tables)
// =====================================================================================================
// Top-level constants that look like board names but are not boards (none today). Adding one here needs a reason.
const NON_BOARD_CONSTS = new Set([]);
const isBoardConst = (n) => /(^|_)LB(_|$)/.test(n) || /(^|_)PREFIX$/.test(n);

function boardConsts(src) {
  const out = new Set();
  for (const line of src.split('\n')) {
    if (!/^const\s/.test(line)) continue;
    const re = /(?:^const\s+|,\s*)([A-Z][A-Z0-9_]*)\s*=(?!=)/g;
    let m;
    while ((m = re.exec(line))) if (isBoardConst(m[1]) && !NON_BOARD_CONSTS.has(m[1])) out.add(m[1]);
  }
  return out;
}
function literalBoards(src) {
  const out = new Set();
  const plan = src.match(/function ptBoardPlan\([\s\S]*?\n\}\n/);
  if (plan) for (const m of plan[0].matchAll(/\badd\(\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\b(?:findOrCreateBoard|byName|byNameLb)\(\s*'([^']+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/\bresolveSeasonBoard\(\s*\w+\s*,\s*'([^']+)'/g)) out.add(m[1]);
  return out;
}
// Families with per-season twins: the base argument of every resolveSeasonBoard / seasonBoardName call.
//   - a CONSTANT is the family;
//   - a local loop variable is resolved through the nearest loop that binds it: `for (const [fam, lbName] of [[...], ...])`,
//     `for (const b of [A, B])`, or the same over a top-level `const NAME = [...]` array (destructured column or element);
//   - the helpers' own parameter (inside the bodies of seasonBoardName / resolveSeasonBoard) is skipped;
//   - a field of a loop object (`f.name` over Object.values(...)) is skipped for seasonBoardName only: that helper only spells a
//     name, and the board it names was created by a resolveSeasonBoard call the scanner resolves (every season twin is created
//     there). The same field passed to resolveSeasonBoard is a creation site the scanner cannot name -> unresolved (red).
//   Anything else is unresolved (red): the scanner never skips a call it cannot place (Q40 re-issue: the 10-09 scanner read
//   `for (const b of [...])`, `f.name` and the rating loop's `base` as resolved-to-nothing).
function topLevelArray(src, name) {
  const m = new RegExp('^const\\s+' + name + '\\s*=\\s*\\[', 'm').exec(src);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}
function arrayItems(text) {   // top-level items of an array literal text '[a, [b, c], d]' (strings / constants / nested arrays)
  const out = [];
  let depth = 0, cur = '';
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
// the source with string literals and comments blanked to spaces (same length): brace / paren counting only
function blankCode(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i], nx = src[i + 1];
    if (ch === '/' && nx === '/') { while (i < n && src[i] !== '\n') out[i++] = ' '; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; for (; i < end; i++) if (src[i] !== '\n') out[i] = ' '; continue; }
    if (ch === '/') {   // a regex literal (the usual heuristic: a slash where an expression starts), blanked like a string
      let k = i - 1;
      while (k >= 0 && /[ \t]/.test(src[k])) k--;
      const prev = k >= 0 ? src[k] : '\n';
      let w = k;   // the identifier ending at k (walked back by hand: an end-anchored regex on src.slice(0, k + 1) is quadratic)
      while (w >= 0 && /[A-Za-z0-9_$]/.test(src[w])) w--;
      const word = /[A-Za-z_$]/.test(prev) ? src.slice(w + 1, k + 1).replace(/^[0-9]+/, '') : '';
      if ('(,=:[!&|?{};+-*%<>~^\n'.indexOf(prev) >= 0 || word === 'return' || word === 'typeof' || word === 'in' || word === 'of') {
        let j = i + 1, cls = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
          j++;
        }
        if (j < n && src[j] === '/') { for (; i <= j; i++) out[i] = ' '; continue; }
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      out[i++] = ' ';
      while (i < n && src[i] !== ch) { if (src[i] === '\\') { out[i++] = ' '; } if (i < n && src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) out[i++] = ' ';
      continue;
    }
    i++;
  }
  return out.join('');
}
// does the loop whose header starts at `at` enclose position `pos`? (header parens, then a braced body or one statement)
function loopEncloses(code, at, pos) {
  let i = code.indexOf('(', at), depth = 0;
  for (; i < code.length; i++) { if (code[i] === '(') depth++; else if (code[i] === ')' && --depth === 0) break; }
  i++;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] === '{') {
    depth = 0;
    for (let j = i; j < code.length; j++) { if (code[j] === '{') depth++; else if (code[j] === '}' && --depth === 0) return pos > i && pos < j; }
    return false;
  }
  depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { if (--depth < 0) return pos >= i && pos < j; }
    else if (c === ';' && depth === 0) return pos >= i && pos < j;
  }
  return false;
}
function helperBodies(src) {
  const out = [];
  for (const re of [/function seasonBoardName\(/g, /async function resolveSeasonBoard\(/g]) {
    for (const m of src.matchAll(re)) {
      const close = src.indexOf('\n}\n', m.index);
      const oneLine = src.indexOf('\n', m.index);
      const lineEnd = src.slice(m.index, oneLine);
      out.push([m.index, /\}\s*$/.test(lineEnd) ? oneLine : (close < 0 ? src.length : close + 2)]);
    }
  }
  return out;
}
function seasonFamilies(src) {
  const fams = new Set(), unresolved = [];
  const calls = [];
  const ARG = '([A-Za-z_][A-Za-z0-9_]*)(\\.[A-Za-z_][A-Za-z0-9_]*)?';
  for (const m of src.matchAll(new RegExp('\\bresolveSeasonBoard\\(\\s*\\w+\\s*,\\s*' + ARG, 'g'))) calls.push({ id: m[1], member: !!m[2], at: m.index, create: true });
  for (const m of src.matchAll(new RegExp('\\bseasonBoardName\\(\\s*' + ARG, 'g'))) calls.push({ id: m[1], member: !!m[2], at: m.index, create: false });
  const helpers = helperBodies(src);
  // the enclosure check needs a sane blanked source; should a future construct fool the blanker (braces / parens no longer
  //   balance), fall back to the nearest loop that binds the name (the 10-09 rule) rather than turn red over the scanner itself
  let code = blankCode(src);
  { let d = 0, p = 0, bad = false; for (const ch of code) { if (ch === '{') d++; else if (ch === '}' && --d < 0) bad = true; else if (ch === '(') p++; else if (ch === ')' && --p < 0) bad = true; }
    if (bad || d || p) { console.log('    (scanner note: blanked validate.js does not balance -- loop enclosure check off this run)'); code = null; } }
  for (const c of calls) {
    if (helpers.some(([a, b]) => c.at > a && c.at < b)) continue;   // the helpers forwarding their own `base` parameter
    if (!c.member && /^[A-Z][A-Z0-9_]*$/.test(c.id)) { fams.add(c.id); continue; }
    const before = src.slice(0, c.at);
    const loops = [...before.matchAll(/for\s*\(\s*const\s+(\[[^\]]*\]|[A-Za-z_][A-Za-z0-9_]*)\s+of\s+(\[|[A-Za-z_][A-Za-z0-9_.]*(?:\([^)]*\))?)/g)];
    let done = false;
    for (let i = loops.length - 1; i >= 0 && !done; i--) {
      const bind = loops[i][1];
      const cols = bind[0] === '[' ? bind.slice(1, -1).split(',').map(x => x.trim()) : null;
      const col = cols ? cols.indexOf(c.id) : (bind === c.id ? -2 : -1);
      if (col === -1 || (code && !loopEncloses(code, loops[i].index, c.at))) continue;   // a loop that binds the name but is already closed
      done = true;
      if (c.member) { if (c.create) unresolved.push(c.id + '.field'); break; }   // a field of a loop object: see above
      let arr = null;
      if (loops[i][2] === '[') {
        const start = loops[i].index + loops[i][0].length - 1;
        let depth = 0, end = -1;
        for (let j = start; j < src.length; j++) { if (src[j] === '[') depth++; else if (src[j] === ']' && --depth === 0) { end = j; break; } }
        arr = end > 0 ? src.slice(start, end + 1) : null;
      } else if (/^[A-Z][A-Z0-9_]*$/.test(loops[i][2])) arr = topLevelArray(src, loops[i][2]);
      if (!arr) { unresolved.push(c.id); break; }
      let n = 0;
      for (const item of arrayItems(arr)) {
        const cell = col === -2 ? item : (item[0] === '[' ? (arrayItems(item)[col] || '') : '');
        if (/^[A-Z][A-Z0-9_]*$/.test(cell)) { fams.add(cell); n++; }
      }
      if (!n) unresolved.push(c.id);
    }
    if (!done) unresolved.push(c.member ? c.id + '.field' : c.id);
  }
  return { fams, unresolved };
}
function coverageProblems(src, display, keep) {
  const probs = [];
  const found = new Set([...boardConsts(src), ...literalBoards(src)]);
  const dKeys = display.map(e => e.key), kKeys = Object.keys(keep);
  const dSet = new Set(dKeys), kSet = new Set(kKeys);
  if (dSet.size !== dKeys.length) probs.push('duplicate EXILE_DISPLAY entry');
  for (const n of found) {
    if (dSet.has(n) && kSet.has(n)) probs.push('in both tables: ' + n);
    else if (!dSet.has(n) && !kSet.has(n)) probs.push('unclassified board: ' + n);
  }
  for (const k of [...dSet, ...kSet]) if (!found.has(k)) probs.push('stale table entry (not in validate.js): ' + k);
  for (const k of kKeys) if (!String(keep[k] || '').trim()) probs.push('keep entry without a reason: ' + k);
  const sf = seasonFamilies(src);
  for (const u of sf.unresolved) probs.push('season call base not resolvable: ' + u);
  for (const e of display) {
    if (e.season && !sf.fams.has(e.key)) probs.push('season flag on a family without season twins: ' + e.key);
    if (!e.season && sf.fams.has(e.key)) probs.push('season twins not exiled: ' + e.key);
  }
  for (const f of sf.fams) if (!dSet.has(f) && !kSet.has(f)) probs.push('season family unclassified: ' + f);
  return probs;
}

// Composite ladders (writeOverall) are recomputed every run from the per-size ladders' rows: exiling the composite row alone
//   gives it back next run, exiling an input alone leaves the composite carrying it. So a composite and all of its inputs are
//   exiled together, with one season flag. The table names validate.js's own OVERALL_FAMS rows (label -> composite + inputs).
const COMPOSITES = [
  { label: 'overall comp', key: 'ENDLESS_COMP_LB_OVERALL', inputs: ['ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD'] },
  { label: 'overall casual', key: 'ENDLESS_LB_OVERALL', inputs: ['ENDLESS_LB_SOLO', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD'] },
  { label: 'overall classic', key: 'ENDLESS_LB_CLASSIC_OVERALL', inputs: ['ENDLESS_LB_CLASSIC_SOLO', 'ENDLESS_LB_CLASSIC_DUO', 'ENDLESS_LB_CLASSIC_TRIO', 'ENDLESS_LB_CLASSIC_QUAD'] },
];
function compositeProblems(display) {
  const probs = [];
  const at = new Map(display.map(e => [e.key, e]));
  for (const c of COMPOSITES) {
    const ce = at.get(c.key);
    if (!ce) { probs.push('composite not exiled: ' + c.key); continue; }
    for (const k of c.inputs) {
      const e = at.get(k);
      if (!e) probs.push('composite input not exiled: ' + c.key + ' <- ' + k);
      else if (!!e.season !== !!ce.season) probs.push('composite input season flag differs: ' + c.key + ' <- ' + k);
    }
  }
  return probs;
}
// validate.js side: every OVERALL_FAMS label is one of the table's, the composite boards are the table's (each composite id is
//   resolved from its own constant), and no composite exists that the table does not know (a new `label: 'overall ...'` row).
function compositeSourceProblems(src) {
  const probs = [];
  const labels = [...src.matchAll(/label:\s*'(overall [a-z]+)'/g)].map(m => m[1]);
  if (!labels.length) probs.push('no OVERALL_FAMS label found in validate.js (writeOverall moved?)');
  for (const l of labels) if (!COMPOSITES.some(c => c.label === l)) probs.push('composite unknown to the test: ' + l);
  for (const c of COMPOSITES) {
    if (labels.indexOf(c.label) < 0) probs.push('composite gone from validate.js: ' + c.label);
    if (!new RegExp('\\b' + c.key + '\\b').test(src)) probs.push('composite constant gone: ' + c.key);
  }
  return probs;
}

// Secret-only board constants: `const KEY = process.env.NAME;` with no default -- the name exists only as a secret.
function secretOnlyKeys(src) {
  const out = {};
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) = process\.env\.([A-Z][A-Z0-9_]*);/gm)) if (isBoardConst(m[1])) out[m[1]] = m[2];
  return out;
}
// The sanctions.yml jobs that run sanctions.js, each with the env keys of its steps.
function sanctionsJobs(wf) {
  const starts = [];
  for (const m of wf.matchAll(/\n  ([a-z][a-z0-9-]*):\n/g)) starts.push({ name: m[1], at: m.index });
  const jobs = [];
  for (let i = 0; i < starts.length; i++) {
    const body = wf.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : wf.length);
    if (!/run: node sanctions\.js/.test(body)) continue;
    const env = {};
    for (const l of body.split('\n')) { const x = /^          ([A-Z][A-Z0-9_]*):\s*(.*)$/.exec(l); if (x) env[x[1]] = x[2].trim(); }
    jobs.push({ name: starts[i].name, env });
  }
  return jobs;
}
// Every secret-only key the two tables use must be handed to every sanctions job from the secret of the same name.
function workflowProblems(vsrc, wf, display, keep) {
  const probs = [], so = secretOnlyKeys(vsrc);
  const used = display.map(e => e.key).concat(Object.keys(keep)).filter(k => has(so, k));
  const jobs = sanctionsJobs(wf);
  if (jobs.length !== 3) probs.push('expected 3 jobs running sanctions.js (main / playtest / demo), found ' + jobs.length);
  for (const j of jobs) for (const k of used) {
    const e = so[k];
    if (j.env[e] !== '${{ secrets.' + e + ' }}') probs.push(j.name + ' does not pass the ' + e + ' secret (it names ' + k + ')');
  }
  return probs;
}
// Secret-only names written into a source as a string literal (what a canonical-name table would do).
function literalSecretNames(srcs) {
  const out = [];
  for (const n of Object.values(SECRET_NAMES)) for (const src of srcs) if (new RegExp('[\'"`]' + n).test(src)) { out.push(n); break; }
  return out;
}

{
  const consts = boardConsts(VSRC), lits = literalBoards(VSRC), sf = seasonFamilies(VSRC);
  ok('scanner sees the known board constants (sanity: ' + consts.size + ' found)',
    consts.has('ENDLESS_LB') && consts.has('CP_LB') && consts.has('PREFIX') && consts.has('CAMPAIGN_ENDLESS_LB_PREFIX') && consts.size >= 40);
  ok('scanner sees the literal ops boards in ptBoardPlan', lits.has('version_gate') && lits.has('gate_window') && lits.has('pt_master'));
  ok("card_box stays the ptBoardPlan literal (the client repo's playtest-gate test pins add('card_box', 0)) and is classified by that name",
    lits.has('card_box') && s.EXILE_DISPLAY.some(e => e.key === 'card_box') && s.boardNameOf('card_box') === 'card_box');
  ok('season families resolved, including the competitive loop variable (duo / trio / quad), the `for (const b of [...])` loop and the rating loop over RATING_FAMS',
    sf.unresolved.length === 0 && ['LP_LB', 'ENDLESS_LB', 'ENDLESS_LB_SOLO', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'ENDLESS_COMP_LB',
      'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_TRIO', 'ENDLESS_COMP_LB_QUAD', 'ENDLESS_COMP_LB_OVERALL', 'ENDLESS_LB_OVERALL',
      'ENDLESS_RATING_LB_SOLO', 'ENDLESS_RATING_LB_DUO', 'ENDLESS_RATING_LB_TRIO', 'ENDLESS_RATING_LB_QUAD'].every(f => sf.fams.has(f)));
  { const fb = seasonFamilies(VSRC + '\n}\n');   // a source the blanker cannot balance: the scanner falls back, it does not turn red by itself
    ok('scanner fallback: an unbalanced source keeps the nearest-loop rule (same families, nothing unresolved)',
      fb.unresolved.length === 0 && [...sf.fams].every(f => fb.fams.has(f))); }
  ok('classic family has no season twins (its loop never calls the season resolver), nor the classic composite',
    !sf.fams.has('ENDLESS_LB_CLASSIC_DUO') && !sf.fams.has('ENDLESS_LB_CLASSIC_OVERALL'));
  const probs = coverageProblems(VSRC, s.EXILE_DISPLAY, s.EXILE_KEEP);
  if (probs.length) console.log('    ' + probs.join('\n    '));
  ok('every validate.js board is in exactly one of EXILE_DISPLAY / EXILE_KEEP, season flags agree', probs.length === 0);
  const missingExport = [...s.EXILE_DISPLAY.map(e => e.key), ...Object.keys(s.EXILE_KEEP)].filter(k => /^[A-Z]/.test(k) && !has(v, k));
  ok('every table key is exported by validate.js (sanctions reads the name from the export)', missingExport.length === 0 || (console.log('    ' + missingExport.join(' ')), false));
  ok('every display key names a board on a job that is handed the secret-only names (nothing unnamed)',
    s.EXILE_DISPLAY.every(e => !!s.boardNameOf(e.key)) && s.unnamedKeys().length === 0);
  ok('secret-only names come from the env, exactly as the reconcile reads them',
    s.boardNameOf('LP_LB') === SECRET_NAMES.LP_LB && s.boardNameOf('XP_LB') === SECRET_NAMES.XP_LB && s.boardNameOf('PREFIX') === SECRET_NAMES.LB_PREFIX && s.boardNameOf('RANKED_LB') === SECRET_NAMES.RANKED_LB);
  { const saved = v.LP_LB; v.LP_LB = undefined;   // a job that is not handed LP_LB: that ladder is named nowhere, so it is left alone
    const l = s.exileSources(1), un = s.unnamedKeys();
    v.LP_LB = saved;
    ok('a job missing a secret-only name lists it in unnamedKeys and leaves that board out (no guessed name)',
      un.length === 1 && un[0] === 'LP_LB' && !l.some(n => n.indexOf(SECRET_NAMES.LP_LB) === 0) && l.includes(SECRET_NAMES.XP_LB)); }
  ok('openBoards warns once per run when a table key names no board', /function openBoards[\s\S]*?unnamedKeys\(\)[\s\S]*?ghWarn\(/.test(SSRC.slice(SSRC.indexOf('async function openBoards'), SSRC.indexOf('function boardStateSig'))));
  const lit = literalSecretNames([SSRC, VSRC]);
  ok('no secret-only board name is written into sanctions.js / validate.js as a string literal (a canonical table would publish it)',
    lit.length === 0 || (console.log('    ' + lit.join(' ')), false));
  const wf = workflowProblems(VSRC, WFSRC, s.EXILE_DISPLAY, s.EXILE_KEEP);
  if (wf.length) console.log('    ' + wf.join('\n    '));
  ok('sanctions.yml hands every secret-only table name to all three sanctions jobs', wf.length === 0);
  ok('scanner sees the four secret-only board names validate.js reads (LB_PREFIX / RANKED_LB / LP_LB / XP_LB)',
    JSON.stringify(secretOnlyKeys(VSRC)) === JSON.stringify({ PREFIX: 'LB_PREFIX', RANKED_LB: 'RANKED_LB', LP_LB: 'LP_LB', XP_LB: 'XP_LB' }));
  { const cut = WFSRC.split('\n'), at = cut.findIndex((l, i) => i > WFSRC.slice(0, WFSRC.indexOf('\n  demo-sanctions:\n')).split('\n').length && /^          LP_LB:/.test(l));
    const wf2 = cut.filter((l, i) => i !== at).join('\n');
    const p = workflowProblems(VSRC, wf2, s.EXILE_DISPLAY, s.EXILE_KEEP);
    ok('mutation: the demo job loses LP_LB -> red, naming that job', at > 0 && p.length === 1 && /^demo-sanctions does not pass the LP_LB secret/.test(p[0])); }
  { const p = workflowProblems(VSRC + '\nconst NEW_RANKING_LB = process.env.NEW_RANKING_LB;\n', WFSRC, s.EXILE_DISPLAY.concat([{ key: 'NEW_RANKING_LB' }]), s.EXILE_KEEP);
    ok('mutation: a new secret-only display board -> red on all three jobs until sanctions.yml passes it', p.length === 3 && p.every(x => /NEW_RANKING_LB/.test(x))); }
  ok('mutation: a canonical-name table in sanctions.js -> red',
    literalSecretNames([SSRC + "\nconst CANON = { LP_LB: '" + SECRET_NAMES.LP_LB + "' };\n"]).length === 1);
  ok('the user-named display boards are all on the exile list',
    ['endless_board', 'endless_board_solo', 'endless_board_trio', 'endless_board_quad', 'endless_comp_solo', 'endless_comp_duo', 'endless_comp_trio',
      'endless_comp_quad', 'endless_comp_overall', 'endless_classic_solo', 'endless_classic_duo', 'endless_classic_trio', 'endless_classic_quad',
      'campaign_endless_d1', 'campaign_endless_d2', 'campaign_endless_d3', 'xp_ladder', 'lp_ladder', 'card_box', 'supporter_wall']
      .every(n => s.exileSources(0).includes(n)));
  // the second-round audit's list (R2-B2-53, 2026-10-27): the display boards a ban left up on the c862e74c main, the ones added
  //   after 10-09 among them (the composites, the cup honor board, the like count)
  const R2_B2_53 = ['endless_board_solo', 'endless_board_quad', 'endless_board_overall', 'endless_comp_solo', 'endless_comp_duo', 'endless_comp_trio',
    'endless_comp_quad', 'endless_comp_overall', 'endless_classic_solo', 'endless_classic_duo', 'endless_classic_trio', 'endless_classic_quad',
    'endless_classic_overall', 'endless_cup_honor', 'like_count', 'lp_ladder', 'campaign_endless_d1', 'supporter_wall'];
  const l0x = s.exileSources(0), l1x = s.exileSources(1);
  ok('R2-B2-53: every display board the second-round audit found left up is exiled (and the season 1 twins of the seasonal ones)',
    R2_B2_53.every(n => l0x.includes(n)) && ['endless_board_overall_s1', 'endless_comp_overall_s1', 'endless_board_solo_s1', 'lp_ladder_s1'].every(n => l1x.includes(n)) &&
    !l1x.includes('endless_classic_overall_s1'));
  const keep = s.keepBoardNames();
  ok('the user-named non-display boards are all on the keep list',
    ['endless_save_box_solo', 'endless_save_box_casual', 'endless_save_box_classic_quad', 'cp_bank', 'redeem_box', 'grant_box', 'campaign_box',
      'trust_tier', 'report_box', 'unmatched_box', 'active_match_box', SECRET_NAMES.RANKED_LB,
      'trust_ledger', 'like_box', 'endless_rating_solo', 'endless_rating_duo', 'endless_rating_trio', 'endless_rating_quad', 'endless_tiercut', 'endless_cup']
      .every(n => keep.has(n)));
  const cp = compositeProblems(s.EXILE_DISPLAY);
  if (cp.length) console.log('    ' + cp.join('\n    '));
  ok('every composite ladder is exiled together with all of its per-size inputs, under the same season flag', cp.length === 0);
  ok('the composite input table matches validate.js: each composite is written by writeOverall from its per-size families',
    compositeSourceProblems(VSRC).length === 0 || (console.log('    ' + compositeSourceProblems(VSRC).join('\n    ')), false));
  ok('no name is both exiled and kept', s.exileSources(3).every(n => !keep.has(n)));
}

// ---- mutation self-proofs: each edit must turn the tripwire red ----
{
  const D = s.EXILE_DISPLAY, K = s.EXILE_KEEP;
  const red = (label, src, display, keep, want) => {
    const p = coverageProblems(src, display, keep);
    ok('mutation turns the tripwire red: ' + label, p.some(x => x.indexOf(want) === 0));
  };
  // insertion points found structurally (the 10-09 cut anchored on two unrelated lines of validate.js; a rewrite of either
  //   would have turned this test red for nothing): the closing line of ptBoardPlan, and the end of the file
  const planAt = VSRC.indexOf('function ptBoardPlan(');
  const planEnd = planAt < 0 ? -1 : VSRC.indexOf('\n}\n', planAt) + 1;
  assert.ok(planAt > 0 && planEnd > planAt, 'ptBoardPlan found');
  red('a new board constant in validate.js', VSRC + "\nconst NEW_RANKING_LB = process.env.NEW_RANKING_LB || 'new_ranking';\n", D, K, 'unclassified board: NEW_RANKING_LB');
  red('a second declarator on one const line', VSRC + "\nconst SIDE_KNOB = 1, SIDE_LB = 'side';\n", D, K, 'unclassified board: SIDE_LB');
  red('a new literal board in ptBoardPlan', VSRC.slice(0, planEnd) + "  add('pt_new_switch', 1);\n" + VSRC.slice(planEnd), D, K, 'unclassified board: pt_new_switch');
  red('a display entry dropped', VSRC, D.filter(e => e.key !== 'ENDLESS_LB_QUAD'), K, 'unclassified board: ENDLESS_LB_QUAD');
  red('a keep entry dropped', VSRC, D, Object.fromEntries(Object.entries(K).filter(([k]) => k !== 'SAVE_BOX_LB')), 'unclassified board: SAVE_BOX_LB');
  red('a board in both tables', VSRC, D.concat([{ key: 'CP_LB' }]), K, 'in both tables: CP_LB');
  red('a stale entry', VSRC, D.concat([{ key: 'OLD_GONE_LB' }]), K, 'stale table entry (not in validate.js): OLD_GONE_LB');
  red('season flag removed from a seasonal family', VSRC, D.map(e => e.key === 'ENDLESS_COMP_LB_OVERALL' ? { key: e.key } : e), K, 'season twins not exiled: ENDLESS_COMP_LB_OVERALL');
  red('season flag on a lifetime-only family', VSRC, D.map(e => e.key === 'XP_LB' ? { key: e.key, season: true } : e), K, 'season flag on a family without season twins: XP_LB');
  red('validate.js gives a lifetime family season twins', VSRC + "\nasync function x(lr) { await resolveSeasonBoard(lr, ENDLESS_LB_CLASSIC_SOLO, 1); }\n", D, K, 'season twins not exiled: ENDLESS_LB_CLASSIC_SOLO');
  red('a season loop column the scanner cannot resolve', VSRC + "\nasync function y(lr, someName) { await resolveSeasonBoard(lr, someName, 1); }\n", D, K, 'season call base not resolvable: someName');
  red('a keep entry without a reason', VSRC, D, Object.assign({}, K, { CP_LB: ' ' }), 'keep entry without a reason: CP_LB');
  // Q40 re-issue: the loop shapes the 10-09 scanner read as "resolved to nothing"
  red('a season loop over an inline list of constants (`for (const b of [...])`)', VSRC + "\nasync function z(lr) { for (const q of [ENDLESS_LB_CLASSIC_SOLO]) await resolveSeasonBoard(lr, q, 1); }\n", D, K, 'season twins not exiled: ENDLESS_LB_CLASSIC_SOLO');
  red('a season loop over a top-level table (`for (const [f, nm] of SOME_FAMS)`)', VSRC + "\nconst ZZ_FAMS = [['duo', ENDLESS_LB_CLASSIC_DUO]];\nasync function z2(lr) { for (const [f, nm] of ZZ_FAMS) await resolveSeasonBoard(lr, nm, 1); }\n", D, K, 'season twins not exiled: ENDLESS_LB_CLASSIC_DUO');
  red('a season board created from a field of a loop object', VSRC + "\nasync function z3(lr, o) { for (const f of Object.values(o)) await resolveSeasonBoard(lr, f.name, 1); }\n", D, K, 'season call base not resolvable: f.field');
  red('a season call on a parameter outside the two helpers', VSRC + "\nasync function z4(lr, base) { await resolveSeasonBoard(lr, base, 1); }\n", D, K, 'season call base not resolvable: base');
  red('the casual composite losing its season flag', VSRC, D.map(e => e.key === 'ENDLESS_LB_OVERALL' ? { key: e.key } : e), K, 'season twins not exiled: ENDLESS_LB_OVERALL');
  const cred = (label, display, want) => ok('mutation turns the composite check red: ' + label, compositeProblems(display).some(x => x.indexOf(want) === 0));
  cred('a composite input dropped', D.filter(e => e.key !== 'ENDLESS_LB_CLASSIC_TRIO'), 'composite input not exiled: ENDLESS_LB_CLASSIC_OVERALL <- ENDLESS_LB_CLASSIC_TRIO');
  cred('a composite dropped', D.filter(e => e.key !== 'ENDLESS_LB_OVERALL'), 'composite not exiled: ENDLESS_LB_OVERALL');
  cred('an input exiled without its season twins while the composite has them', D.map(e => e.key === 'ENDLESS_LB_SOLO' ? { key: e.key } : e), 'composite input season flag differs: ENDLESS_LB_OVERALL <- ENDLESS_LB_SOLO');
  ok('mutation turns the composite source check red: a new composite family in validate.js',
    compositeSourceProblems(VSRC + "\nconst X = [{ label: 'overall party', id: 1 }];\n").includes('composite unknown to the test: overall party'));
}

// =====================================================================================================
// 2. the derived list
// =====================================================================================================
{
  const l0 = s.exileSources(0), l1 = s.exileSources(1), l2 = s.exileSources(2);
  ok('preseason: no season twins', l0.every(n => !/_s\d+$/.test(n)));
  ok('season 1: _s1 twins of the twelve seasonal display families (O606: + endless_comp_couch), nothing else gains a twin',
    l1.filter(n => /_s1$/.test(n)).sort().join(',') === ['endless_board', 'endless_board_solo', 'endless_board_trio', 'endless_board_quad', 'endless_board_overall',
      'endless_comp_solo', 'endless_comp_duo', 'endless_comp_trio', 'endless_comp_quad', 'endless_comp_couch', 'endless_comp_overall', 'lp_ladder'].map(n => n + '_s1').sort().join(','));
  ok('season 2: keeps the season 1 twins (an archived season board is still shown) and adds _s2',
    l2.includes('lp_ladder_s1') && l2.includes('lp_ladder_s2') && l2.includes('endless_comp_overall_s2') && l2.includes('endless_board_overall_s2') && l2.length === l0.length + 24);
  ok('preseason list: 25 display boards (campaign endless counted per difficulty; O606: + endless_comp_couch)', l0.length === 25);
  ok('twin names come from validate.js seasonBoardName (the name the reconcile writes)', l1.includes(v.seasonBoardName(v.ENDLESS_COMP_LB_DUO, 1)));
  ok('campaign endless ladders expanded over difficulties 1..CAMPAIGN_ENDLESS_DIF_MAX',
    v.CAMPAIGN_ENDLESS_DIF_MAX === 3 && ['campaign_endless_d1', 'campaign_endless_d2', 'campaign_endless_d3'].every(n => l0.includes(n)) && !l0.includes('campaign_endless_d4'));
  ok('no duplicates in the list', new Set(l2).size === l2.length);
  const ex = s.exileSources(0, ['custom_board', 'cp_bank', 'xp_ladder', 'campaign_endless_box_d1', 'custom_board']);
  ok('env append: a new name is added once', ex.filter(n => n === 'custom_board').length === 1 && ex[ex.length - 1] === 'custom_board');
  ok('env append: a keep-list name (exact or by prefix) is refused', !ex.includes('cp_bank') && !ex.includes('campaign_endless_box_d1'));
  ok('env append: a match-record shard is refused (the shard prefix comes from LB_PREFIX on this job)',
    !s.exileSources(0, ['lb_rec_3']).includes('lb_rec_3') && s.keepBoardNames().has('lb_rec_0'));
  ok('env append: a name already derived is not doubled', ex.filter(n => n === 'xp_ladder').length === 1);
  ok('env EXILE_BOARDS no longer replaces the list (unset here = empty append)', Array.isArray(s.EXILE_BOARDS) && s.EXILE_BOARDS.length === 0);
  ok('sanctions.js names no board of its own besides the gate board and the literal-name table keys', !/'(xp_ladder|endless_board|lp_ladder|supporter_wall)/.test(SSRC));
}

// =====================================================================================================
// 3. fake-Steam reconcile runs
// =====================================================================================================
function fakeSteam(opts) {
  const o = opts || {};
  const boards = new Map();   // name -> { id, trusted, rows: Map sid -> { score, detailData } }
  const byId = new Map();
  let nextId = 1000;
  const calls = { creates: [], lookups: [], listings: 0, sets: [], dels: [] };
  const hidden = new Set(o.hidden || []);   // names the listing does not show yet (listing lag)
  const failing = { listing: 0, lookup: new Set() };
  function make(name, trusted) {
    const b = { id: nextId++, name, trusted: trusted ? 1 : 0, rows: new Map() };
    boards.set(name, b); byId.set(String(b.id), b);
    return b;
  }
  const resp = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const form = (body) => {
    const out = {};
    for (const kv of String(body || '').split('&')) {
      const i = kv.indexOf('=');
      if (i < 0) continue;
      const k = kv.slice(0, i), val = kv.slice(i + 1);
      out[k] = k === 'details' ? val : decodeURIComponent(val);
    }
    return out;
  };
  const pctToHex = (p) => String(p || '').split('%').filter(Boolean).map(x => x.toLowerCase()).join('');
  async function fetchImpl(url, init) {
    const u = String(url);
    const q = u.indexOf('?') >= 0 ? Object.fromEntries(new URLSearchParams(u.slice(u.indexOf('?') + 1))) : {};
    if (/GetLeaderboardsForGame/.test(u)) {
      calls.listings++;
      if (failing.listing) return resp(502, 'bad gateway');
      return resp(200, { response: { leaderboards: [...boards.values()].filter(b => !hidden.has(b.name)).map(b => ({ id: b.id, name: b.name, entries: b.rows.size })) } });
    }
    if (/GetLeaderboardEntries/.test(u)) {
      const b = byId.get(String(q.leaderboardid));
      if (!b) return resp(400, 'no such board');
      const all = [...b.rows.entries()].map(([sid, r]) => ({ steamID: sid, score: r.score, detailData: r.detailData }));
      const ents = q.datarequest === 'RequestAroundUser' ? all.filter(e => e.steamID === String(q.steamid)) : all;
      return resp(200, { leaderboardEntryInformation: { leaderboardEntries: ents } });
    }
    const f = form(init && init.body);
    if (/FindOrCreateLeaderboard/.test(u)) {
      const create = String(f.createifnotfound) === '1';
      (create ? calls.creates : calls.lookups).push(f.name);
      if (!create && failing.lookup.has(f.name)) return resp(503, 'unavailable');
      let b = boards.get(f.name);
      if (!b && create) b = make(f.name, String(f.onlytrustedwrites) === '1');
      if (!b) return resp(200, { result: { result: 9 } });
      return resp(200, { result: { result: 1, leaderboard: { leaderBoardID: b.id, leaderboardname: b.name } } });
    }
    if (/SetLeaderboardScore/.test(u)) {
      const b = byId.get(String(f.leaderboardid));
      if (!b) return resp(400, 'no such board');
      b.rows.set(String(f.steamid), { score: Number(f.score) | 0, detailData: pctToHex(f.details) });
      calls.sets.push(b.name);
      return resp(200, { result: { result: 1 } });
    }
    if (/DeleteLeaderboardScore/.test(u)) {
      const b = byId.get(String(f.leaderboardid));
      if (b) b.rows.delete(String(f.steamid));
      calls.dels.push(b ? b.name : '?');
      return resp(200, { result: { result: 1 } });
    }
    return resp(404, 'unexpected ' + u);
  }
  return {
    boards, calls, hidden, failing, make,
    put(name, sid, score, det) { const b = boards.get(name) || make(name, 1); b.rows.set(String(sid), { score, detailData: det ? v.encodeDetails(det) : '' }); return b; },
    row(name, sid) { const b = boards.get(name); return b ? b.rows.get(String(sid)) || null : null; },
    install() { global.fetch = fetchImpl; },
  };
}
// a resolver-backed board set for a fixed season (the run code calls openBoards, which picks the season from the clock)
async function boardsFor(mod, steam, seasonId, fresh) {
  const ban = steam.boards.get('ban_board') ? steam.boards.get('ban_board').id : (steam.make('ban_board', 1)).id;
  const r = mod.boardResolver(fresh || {}, Date.now());
  return { ban, sources: mod.exileSources(seasonId, mod.EXILE_BOARDS), find: r.find, findOrCreate: r.findOrCreate, absent: r.absent };
}
const SID = '76561198000000042', OTHER = '76561198000000077';
const FULL = { action: 'RESTRICT_GAME_ACCESS', refId: '3541ba63-4006-4141-9240-54db3a0abe42' };
const MM = { action: 'RESTRICT_MATCHMAKING', refId: '' };

// main app at season 1: rows everywhere, some boards absent
async function scenarioMain(mod) {
  const st = fakeSteam(); st.install();
  st.make('ban_board', 1);
  const display = ['endless_board', 'endless_board_s1', 'endless_board_solo', 'endless_comp_overall', 'endless_comp_overall_s1', 'endless_comp_duo_s1',
    'endless_classic_quad', 'campaign_endless_d2', 'lp_ladder', 'lp_ladder_s1', 'xp_ladder', 'card_box', 'supporter_wall',
    'endless_board_overall', 'endless_board_overall_s1', 'endless_classic_overall', 'endless_cup_honor', 'like_count'];   // the last five: boards added after 10-09
  display.forEach((n, i) => st.put(n, SID, 1000 + i, [0xCA, i, -7]));
  st.put('endless_board', OTHER, 5);
  st.put('cp_bank', SID, 300); st.put('endless_save_box_solo', SID, 9, [1, 2, 3]); st.put('trust_tier', SID, 2); st.put('chat_mute', SID, 1);
  const keep2 = ['trust_ledger', 'like_box', 'endless_rating_solo', 'endless_rating_duo_s1', 'endless_tiercut', 'endless_cup', 'endless_comp_solo_w202648'];   // after 10-09: kept (+ a cup week board, out of reach)
  keep2.forEach((n, i) => st.put(n, SID, 7 + i));
  st.make('xp_ladder_banned', 1);   // shadow the first cut provisioned
  st.make('endless_board_quad', 1); // present, but the banned account has no row on it
  const before = new Set(st.boards.keys());
  const b = await boardsFor(mod, st, 1);
  const r = await mod.enactBan(b, SID, 0, FULL);
  const afterBan = new Set(st.boards.keys());
  const created = [...afterBan].filter(n => !before.has(n));
  const ban = { r, created, display, moved: display.every(n => !st.row(n, SID) && st.row(n + '_banned', SID) && st.row(n + '_banned', SID).score === 1000 + display.indexOf(n)),
    bytes: display.every((n, i) => (st.row(n + '_banned', SID) || {}).detailData === v.encodeDetails([0xCA, i, -7])),
    kept: !!st.row('cp_bank', SID) && !!st.row('endless_save_box_solo', SID) && !!st.row('trust_tier', SID) && !!st.row('chat_mute', SID) && !!st.row('endless_board', OTHER) &&
      keep2.every(n => !!st.row(n, SID) && !st.boards.has(n + '_banned')),
    gate: !!st.row('ban_board', SID), sourceCreates: st.calls.creates.filter(n => !/_banned$/.test(n)) };
  const b2 = await boardsFor(mod, st, 2);   // unban one season later: the season 1 rows go back to the season 1 boards
  const beforeUnban = new Set(st.boards.keys());
  const ur = await mod.enactUnban(b2, SID);
  const unbanCreated = [...st.boards.keys()].filter(n => !beforeUnban.has(n));
  const unban = { ur, unbanCreated, restored: display.every((n, i) => st.row(n, SID) && st.row(n, SID).score === 1000 + i && st.row(n, SID).detailData === v.encodeDetails([0xCA, i, -7]) && !st.row(n + '_banned', SID)),
    gateCleared: !st.row('ban_board', SID) };
  return { st, ban, unban };
}

// demo app: no lp_ladder at all (ptBoardPlan refuses to run while one exists)
async function scenarioDemo(mod) {
  const st = fakeSteam(); st.install();
  st.make('ban_board', 1);
  ['xp_ladder', 'endless_board', 'endless_comp_solo', 'card_box'].forEach((n, i) => st.put(n, SID, 50 + i));
  const b = await boardsFor(mod, st, 1);
  await mod.enactBan(b, SID, 0, FULL);
  await mod.enactUnban(await boardsFor(mod, st, 1), SID);
  const names = [...st.boards.keys()];
  const plan = v.ptBoardPlan(names, { shards: 0, prefix: 'x', rankedLb: SECRET_NAMES.RANKED_LB, lpLb: 'lp_ladder', redeemLb: 'redeem_box', grantLb: 'grant_box', mirrorLb: 'mirror_box' });
  return { st, names, plan, restored: ['xp_ladder', 'endless_board', 'endless_comp_solo', 'card_box'].every((n, i) => st.row(n, SID) && st.row(n, SID).score === 50 + i) };
}

(async () => {
  // ---- the real module ----
  {
    const m = await scenarioMain(s);
    ok('main app: a full ban moves the row off every display board present, season 1 twins included', m.ban.moved && m.ban.r.moved === m.ban.display.length);
    ok('main app: score and detail bytes survive the move byte-exact', m.ban.bytes);
    ok('main app: keep-list boards (wallet, save, trust, chat mute, trust ledger, like box, tier score / cuts, cup carrier) and other players untouched', m.ban.kept);
    ok('main app: gate row written', m.ban.gate);
    ok('main app: no source board is ever created (no createifnotfound=1 on a non-shadow name)', m.ban.sourceCreates.length === 0);
    ok('main app: shadows created only where a row moved (absent boards and the empty quad board get none)',
      m.ban.created.every(n => /_banned$/.test(n)) && !m.ban.created.includes('endless_board_quad_banned') && !m.ban.created.includes('endless_classic_solo_banned') &&
      m.ban.created.length === m.ban.display.length - 1);   // xp_ladder_banned already existed
    ok('main app: unban in season 2 restores every row (season 1 rows back on the season 1 boards), byte-exact', m.unban.restored && m.unban.ur.restored === m.ban.display.length);
    ok('main app: unban creates no board at all (no _s2 shadows, no absent sources)', m.unban.unbanCreated.length === 0);
    ok('main app: unban clears the gate row', m.unban.gateCleared);
  }
  {
    const d = await scenarioDemo(s);
    ok('demo app: lp_ladder / lp_ladder_s1 and their shadows are never created', !d.names.some(n => /^lp_ladder/.test(n)));
    ok('demo app: after ban + unban, validate.js ptBoardPlan still finds no forbidden board', d.plan.forbidden.length === 0);
    ok('demo app: rows the demo does carry are exiled and restored', d.restored);
  }
  // ---- matchmaking-only ban: gate row only ----
  {
    const st = fakeSteam(); st.install();
    st.make('ban_board', 1); st.put('xp_ladder', SID, 10); st.put('lp_ladder', SID, 20);
    const r = await s.enactBan(await boardsFor(s, st, 0), SID, 0, MM);
    ok('matchmaking-only ban: gate row set, no row moved, no shadow created',
      r.moved === 0 && !!st.row('ban_board', SID) && !!st.row('xp_ladder', SID) && st.calls.creates.length === 0);
  }
  // ---- listing lag: a fresh source board and a fresh shadow are both found ----
  {
    const st = fakeSteam(); st.install();
    st.make('ban_board', 1); st.put('endless_classic_trio', SID, 77);
    st.hidden.add('endless_classic_trio');
    const fresh = {};   // the state's `fresh` map, shared by the two runs
    await s.enactBan(await boardsFor(s, st, 0, fresh), SID, 0, FULL);
    ok('listing lag: a source board missing from the listing is found by the no-create lookup and exiled',
      !st.row('endless_classic_trio', SID) && st.row('endless_classic_trio_banned', SID) && st.calls.lookups.includes('endless_classic_trio'));
    ok('listing lag: the shadow created this run is remembered in `fresh` (id + minute)',
      Array.isArray(fresh.endless_classic_trio_banned) && fresh.endless_classic_trio_banned[0] === st.boards.get('endless_classic_trio_banned').id &&
      Object.keys(fresh).join(',') === 'endless_classic_trio_banned');
    st.hidden.add('endless_classic_trio_banned');
    const before = st.boards.size, lk = st.calls.lookups.length;
    const ur = await s.enactUnban(await boardsFor(s, st, 0, fresh), SID);
    ok('listing lag: restore within the hour finds the new shadow through `fresh` (no lookup) and creates nothing',
      ur.restored === 1 && st.row('endless_classic_trio', SID) && st.boards.size === before && !st.calls.lookups.slice(lk).includes('endless_classic_trio_banned'));
    // the same, after `fresh` was lost (an older state file): the by-name lookup still finds the shadow
    st.put('endless_classic_trio', SID, 78);
    st.hidden.delete('endless_classic_trio_banned');
    await s.enactBan(await boardsFor(s, st, 0, {}), SID, 0, FULL);
    st.hidden.add('endless_classic_trio_banned');
    const lk2 = st.calls.lookups.length;
    const ur2 = await s.enactUnban(await boardsFor(s, st, 0, {}), SID);
    ok('listing lag: without `fresh` the no-create lookup finds the shadow and the row is restored',
      ur2.restored === 1 && st.row('endless_classic_trio', SID).score === 78 && st.calls.lookups.slice(lk2).includes('endless_classic_trio_banned') && st.boards.size === before);
  }
  // ---- failures stop the run instead of skipping silently ----
  {
    const st = fakeSteam(); st.install();
    st.make('ban_board', 1); st.put('xp_ladder', SID, 10);
    st.failing.listing = 1;
    let threw = false;
    try { await s.enactBan(await boardsFor(s, st, 0), SID, 0, FULL); } catch (e) { threw = /listing/.test(e.message); }
    ok('a failed board listing throws (the event loop stops before the cursor moves)', threw && !!st.row('xp_ladder', SID));
    st.failing.listing = 0; st.hidden.add('xp_ladder'); st.failing.lookup.add('xp_ladder');
    threw = false;
    const warns = [], w0 = v.ghWarn;
    v.ghWarn = (m) => warns.push(String(m));
    let r = null, b = null;
    try { b = await boardsFor(s, st, 0); r = await s.enactBan(b, SID, 0, FULL); } catch (e) { threw = true; } finally { v.ghWarn = w0; }
    // Steam's answer to a no-create lookup of an unknown name is not documented, so a failed lookup is not allowed
    // to stop the run (that would stall every channel lacking a display board); it is named in a warning instead.
    ok('a lookup that fails (5xx) warns, counts the board as absent this run, and leaves the row in place (no create, no throw)',
      !threw && r && r.moved === 0 && !!st.row('xp_ladder', SID) && !st.boards.has('xp_ladder_banned') && b.absent.has('xp_ladder') &&
      warns.some(m => /board lookup xp_ladder HTTP 503/.test(m)));
  }
  // ---- expiry sweep: a lapsed temp ban restores the rows ----
  {
    const st = fakeSteam(); st.install();
    const gate = st.make('ban_board', 1);
    st.put('endless_comp_quad', SID, 99, [5, 6]);
    await s.enactBan(await boardsFor(s, st, 0), SID, Math.floor(Date.now() / 60000) + 30, FULL);
    gate.rows.get(SID).detailData = v.encodeDetails(s.banDetails(Math.floor(Date.now() / 60000) - 1, s.ACT_FULL, FULL.refId));   // let it lapse
    const mail = [];
    const n = await s.sweepExpired(await boardsFor(s, st, 0), mail);
    ok('expiry sweep: lapsed gate row cleared and the exiled row restored', n === 1 && !st.row('ban_board', SID) && st.row('endless_comp_quad', SID).score === 99 && /restored=1/.test(mail[0] || ''));
  }
  // ---- openBoards: only the gate board id is cached; the first cut's four cached ids are dropped ----
  {
    const st = fakeSteam(); st.install();
    const gate = st.make('ban_board', 1);
    const state = { lastLogId: 'x', boards: { ban_board: gate.id, xp_ladder: 1, xp_ladder_banned: 2, card_box: 3 } };
    const b = await s.openBoards(state);
    ok('openBoards: cached gate id used without a create call; source / shadow ids no longer cached',
      b.ban === gate.id && st.calls.creates.length === 0 && JSON.stringify(state.boards) === JSON.stringify({ ban_board: gate.id }));
    ok('openBoards: exile list is the current season list', JSON.stringify(b.sources) === JSON.stringify(s.exileSources(v.seasonAt(v.seasonNowMs()), s.EXILE_BOARDS)));
    const st2 = fakeSteam(); st2.install();
    const empty = { lastLogId: '', boards: {} };
    const b2 = await s.openBoards(empty);
    ok('openBoards: without a cache the gate board is find-or-created (it is ours to provision)',
      !!b2.ban && st2.calls.creates.join(',') === 'ban_board' && empty.boards.ban_board === b2.ban);
    ok('openBoards: no `fresh` in, nothing persisted for it (state signature equals the gate-only one)',
      s.boardStateSig(empty) === JSON.stringify({ b: { ban_board: b2.ban }, f: null }));
    // `fresh` entries live 3 hours, then are dropped (the listing shows the board by then)
    const st3 = fakeSteam(); st3.install();
    const gate3 = st3.make('ban_board', 1), sh = st3.make('xp_ladder_banned', 1), old = st3.make('card_box_banned', 1);
    st3.hidden.add('xp_ladder_banned');
    const nowMin = Math.floor(Date.now() / 60000);
    const state3 = { lastLogId: 'y', boards: { ban_board: gate3.id }, fresh: { xp_ladder_banned: [sh.id, nowMin - 10], card_box_banned: [old.id, nowMin - 4 * 60], junk: 'x' } };
    const sig0 = s.boardStateSig(state3);
    const b3 = await s.openBoards(state3);
    ok('openBoards: `fresh` keeps entries younger than 3 hours and drops the older / malformed ones',
      JSON.stringify(state3.fresh) === JSON.stringify({ xp_ladder_banned: [sh.id, nowMin - 10] }) && s.boardStateSig(state3) !== sig0);
    const lk3 = st3.calls.lookups.length;
    ok('openBoards: a kept `fresh` entry resolves a shadow the listing does not show yet, without a lookup',
      (await b3.find('xp_ladder_banned')) === sh.id && st3.calls.lookups.length === lk3);
    await b3.findOrCreate('lp_ladder_banned');
    ok('openBoards: a shadow created during the run lands in state.fresh (so the state is saved)',
      Array.isArray(state3.fresh.lp_ladder_banned) && state3.fresh.lp_ladder_banned[0] === st3.boards.get('lp_ladder_banned').id);
  }

  // ---- behaviour mutations of sanctions.js: each must turn a check above red ----
  function variant(mutate) {
    const file = path.join(ROOT, 'sanctions.js');
    const out = mutate(SSRC);
    assert.ok(out !== SSRC, 'mutation applies');
    const m = new Module(file, module);
    m.filename = file; m.paths = Module._nodeModulePaths(ROOT);
    m._compile(out, file);
    return m.exports;
  }
  {
    const mut = variant(src => src.replace('const srcId = await boards.find(name);   // look up only: a board this app', 'const srcId = await boards.findOrCreate(name);   // look up only: a board this app'));
    const d = await scenarioDemo(mut);
    ok('mutation self-proof: exile resolving sources with find-or-create creates lp_ladder on the demo app (caught)',
      d.names.some(n => /^lp_ladder/.test(n)) || d.plan.forbidden.length > 0);
  }
  {
    const mut = variant(src => src.replace("const shId = await boards.find(name + BAN_SHADOW_SUFFIX);   // look up only: no shadow", "const shId = await boards.findOrCreate(name + BAN_SHADOW_SUFFIX);   // look up only: no shadow"));
    const m = await scenarioMain(mut);
    ok('mutation self-proof: restore creating shadows is caught (unban would create boards)', m.unban.unbanCreated.length > 0);
  }
  {
    const mut = variant(src => src.replace("if (!listing.has(name) && !fr[name]) fr[name] =", "if (false) fr[name] ="));
    const st = fakeSteam(); st.install();
    st.make('ban_board', 1); st.put('card_box', SID, 5); st.hidden.add('card_box_banned');
    const fresh = {};
    await mut.enactBan(await boardsFor(mut, st, 0, fresh), SID, 0, FULL);
    st.hidden.add('card_box_banned');
    const lk = st.calls.lookups.length;
    await mut.enactUnban(await boardsFor(mut, st, 0, fresh), SID);
    ok('mutation self-proof: not remembering a new shadow in `fresh` is caught (restore falls back to the lookup)',
      Object.keys(fresh).length === 0 && st.calls.lookups.slice(lk).includes('card_box_banned'));
  }
  {
    const mut = variant(src => src.replace("name, createifnotfound: 0, format: 'json',", "name, createifnotfound: 1, format: 'json',"));
    const d = await scenarioDemo(mut);
    ok('mutation self-proof: a by-name lookup that creates is caught (absent boards appear on the demo app)', d.names.some(n => /^lp_ladder/.test(n)));
  }
  {
    const mut = variant(src => src.replace('for (let sn = 1; sn <= (seasonId | 0); sn++)', 'for (let sn = 1; sn < (seasonId | 0); sn++)'));
    const m = await scenarioMain(mut);
    ok('mutation self-proof: dropping the current-season twins is caught (season 1 rows stay up)', !m.ban.moved);
  }
  {
    const mut = variant(src => src.replace("  { key: 'SUPPORTER_WALL_LB' },", ''));
    ok('mutation self-proof: removing a display entry is caught by the tripwire',
      coverageProblems(VSRC, mut.EXILE_DISPLAY, mut.EXILE_KEEP).includes('unclassified board: SUPPORTER_WALL_LB'));
  }

  console.log('ALL PASS (sanctions-boards ' + pass + ')');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
