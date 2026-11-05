#!/usr/bin/env node
'use strict';
// ============================================================
// tools/state-stash.js -- keep a reconcile run's state when its push to the branch fails, and let the next run start from it (O689)
// ============================================================
// Why: a reconcile run writes the boards as "row read + this run's delta" (XP, CP, points) and keeps the record of what it
//   settled (processed list, backlog, ...) in the state files that its persist step commits and pushes. When GitHub refuses
//   that push three times (2026-11-04, demo channel: `Internal Server Error` / `fatal error in commit_refs`, 4 runs in a day),
//   the record is gone while the board writes stay: the next run starts from the old state and settles the same matches again
//   on top of the rows the failed run already moved. Live 2026-11-04 11:05Z / 11:10Z (runs 41818539651 / 41819118961): one
//   account's XP row 141 -> 164 -> 187 = 23 XP paid twice. Lifetime counters kept in the state (the career block) counted the
//   match once, best-only boards wrote the same value twice -- the row-delta boards are the ones hurt.
// What: when the persist step fails, the files it tried to push are kept in the Actions cache (another service than the git
//   push that just failed; no extra token scope), together with the commit the failed run started from. The next run of the
//   same channel restores the newest kept copy before it settles and uses it ONLY when nothing could have moved the branch's
//   state since:
//     1. the kept copy names this channel and is a real copy (not the "cleared" marker a later successful push leaves),
//     2. its base commit is in this checkout and is an ancestor of HEAD (no history rewrite in between),
//     3. no commit between its base and HEAD touched any of its files (a later push of this channel, a fallback's push back,
//        a manual revert -- even one back to the very same bytes -- all count as "moved"),
//     4. each of its files at HEAD is still the blob it was at the base, and the checkout is unmodified,
//     5. every kept file is there and parses as JSON.
//   Any check that fails, or any error before a file is touched, leaves the checkout as it is: the run does what it did before
//   this tool (settles from the branch state -- at worst a double credit, never a lost settle; architecture decision 10).
//   After a successful push that followed a kept copy, a "cleared" marker is cached on top of it (the newest entry wins the
//   restore), so the stale copy is not downloaded and re-checked every run. The copy is only a cache: losing it (eviction,
//   service down) is the behaviour before this tool, nothing worse.
// Subcommands (the reconcile workflows wire them; test/state-stash.js + test/state-stash-wiring.js pin both sides):
//   restore <channel>                       before the run: records STASH_BASE (= HEAD) in $GITHUB_ENV, applies .state-stash/
//                                           when safe; writes found=stash|tomb|none and applied=1|0 to $GITHUB_OUTPUT, removes
//                                           .state-stash/ either way. Exit 3 (+ halt=1) only when files were half replaced and
//                                           could not be put back (the run step is skipped then: it must not settle).
//   out <channel> <persist outcome> <found> <file...>
//                                           after persist: failure -> keep the files (base = $STASH_BASE, the commit the job
//                                           checked out); success after a found copy -> the cleared marker; else nothing.
//                                           writes write=1|0 to $GITHUB_OUTPUT (1 = .state-stash/ is ready for actions/cache/save).
//   backoff <n>                             seconds to wait before push try n+1 (15 / 45 / 90), never past the job's end:
//                                           $JOB_T0 (unix s at the job's first step) + $JOB_LIMIT_S - RESERVE_S.
// ============================================================
const fs = require('fs'), path = require('path'), cp = require('child_process');

const DIR = '.state-stash';
const VER = 1;
const CHANNELS = ['reconcile', 'playtest', 'demo'];
const SAFE_NAME = /^[A-Za-z0-9][\w.-]*\.json$/;   // root-level state files only (no path, no dot files)
const SHA = /^[0-9a-f]{40}$/;
const BACKOFF_S = [15, 45, 90];   // GitHub's 500s on push mostly clear within tens of seconds (O689 item 3)
const RESERVE_S = 75;   // left for the steps after persist (keeping the copy in the cache) before the job's limit

// ---- pure ----
// the kept copy's metadata -> null when usable as a copy, else the reason (string). files: the names it carries.
function metaProblem(meta, channel) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'no metadata';
  if (meta.v !== VER) return 'metadata version ' + meta.v;
  if (meta.channel !== channel) return 'copy of channel ' + meta.channel;
  if (meta.cleared) return 'cleared';
  if (!SHA.test(String(meta.base || ''))) return 'no base commit';
  if (!Array.isArray(meta.files) || !meta.files.length) return 'no files';
  const seen = new Set();
  for (const f of meta.files) {
    if (typeof f !== 'string' || !SAFE_NAME.test(f) || f.indexOf('..') >= 0) return 'bad file name ' + JSON.stringify(f);
    if (seen.has(f)) return 'file listed twice ' + f;
    seen.add(f);
  }
  if (!meta.blobs || typeof meta.blobs !== 'object') return 'no base blobs';
  for (const f of meta.files) {
    if (!Object.prototype.hasOwnProperty.call(meta.blobs, f)) return 'no base blob for ' + f;
    const b = meta.blobs[f];
    if (b !== null && !SHA.test(String(b))) return 'bad base blob for ' + f;
  }
  return null;
}
// the whole decision: meta (the kept copy), git facts of this checkout, the kept files' contents -> { apply, why }
//   ctx: { channel, baseKnown, baseIsAncestor, touched: [commit...] (base..HEAD touching the files), headBlobs: { f: blob|null },
//          dirty: [f...] (modified in the checkout), contents: { f: string|undefined } }
function decide(meta, ctx) {
  const p = metaProblem(meta, ctx.channel);
  if (p) return { apply: false, why: p };
  if (!ctx.baseKnown) return { apply: false, why: 'base commit ' + meta.base.slice(0, 7) + ' not in this checkout' };
  if (!ctx.baseIsAncestor) return { apply: false, why: 'base commit ' + meta.base.slice(0, 7) + ' is not an ancestor of HEAD' };
  if (ctx.touched && ctx.touched.length) return { apply: false, why: 'the branch moved: ' + ctx.touched.length + ' commit(s) since the base touched these files (' + String(ctx.touched[0]).slice(0, 7) + ')' };
  for (const f of meta.files) {
    const h = ctx.headBlobs ? ctx.headBlobs[f] : undefined;
    if (h === undefined) return { apply: false, why: 'no HEAD blob read for ' + f };
    if ((h || null) !== (meta.blobs[f] || null)) return { apply: false, why: f + ' at HEAD is not the base blob' };
  }
  if (ctx.dirty && ctx.dirty.length) return { apply: false, why: 'checkout modified: ' + ctx.dirty.join(',') };
  for (const f of meta.files) {
    const c = ctx.contents ? ctx.contents[f] : undefined;
    if (typeof c !== 'string') return { apply: false, why: 'kept file missing: ' + f };
    try { JSON.parse(c); } catch (e) { return { apply: false, why: 'kept file not JSON: ' + f }; }
  }
  return { apply: true, why: 'base ' + meta.base.slice(0, 7) + ' unchanged on the branch' };
}
// seconds before push try n+1: the planned wait, cut so the job keeps RESERVE_S; without a job clock the old 5 * n
function backoffSeconds(n, nowS, t0S, limitS) {
  const k = Math.max(1, n | 0);
  const plan = BACKOFF_S[Math.min(k, BACKOFF_S.length) - 1];
  const t0 = Number(t0S), lim = Number(limitS);
  if (!(t0 > 0) || !(lim > 0)) return Math.min(plan, 5 * k);
  const left = Math.floor(t0 + lim - RESERVE_S - Number(nowS));
  return Math.max(0, Math.min(plan, left));
}

// ---- git / files (small wrappers; cwd = the checkout) ----
const git = (args, opt) => cp.execFileSync('git', args, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opt || {})).trim();
const gitOk = (args) => { try { git(args); return true; } catch (e) { return false; } };
const blobAt = (rev, f) => { try { return git(['rev-parse', '--verify', '--quiet', rev + ':' + f]) || null; } catch (e) { return null; } };
const setOutput = (k, v) => { const o = process.env.GITHUB_OUTPUT; if (o) fs.appendFileSync(o, k + '=' + v + '\n'); };
const setEnv = (k, v) => { const o = process.env.GITHUB_ENV; if (o) fs.appendFileSync(o, k + '=' + v + '\n'); };
const log = (m) => console.log('[state-stash] ' + m);
const warn = (m) => console.log('::warning::[state-stash] ' + m);
const rmDir = () => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) {} };
const fileOf = (f) => path.join(DIR, 'files', f);

function gitFacts(meta) {
  const files = meta.files;
  const baseKnown = gitOk(['cat-file', '-e', meta.base + '^{commit}']);
  const baseIsAncestor = baseKnown && gitOk(['merge-base', '--is-ancestor', meta.base, 'HEAD']);
  let touched = [];
  if (baseIsAncestor) {
    const out = git(['log', '--format=%H', meta.base + '..HEAD', '--'].concat(files));
    touched = out ? out.split('\n').filter(Boolean) : [];
  }
  const headBlobs = {};
  for (const f of files) headBlobs[f] = blobAt('HEAD', f);
  const st = git(['status', '--porcelain', '--'].concat(files));
  const dirty = st ? st.split('\n').filter(Boolean).map((l) => l.slice(3)) : [];
  return { baseKnown, baseIsAncestor, touched, headBlobs, dirty };
}

// replace the checkout's files with the kept ones, all or nothing (true = all replaced). A file the kept copy brought that
//   HEAD does not have (a state file the failed run created) is removed again on the way back, the others checked out.
function applyAll(meta, contents) {
  const tmp = (f) => f + '.state-stash-tmp';
  const dropTmp = () => { for (const f of meta.files) { try { fs.rmSync(tmp(f), { force: true }); } catch (x) {} } };
  try { for (const f of meta.files) fs.writeFileSync(tmp(f), contents[f]); }
  catch (e) { warn('writing the kept files failed (' + (e && e.message) + ') -- this run starts from the branch state'); dropTmp(); return false; }
  const done = [];
  try {
    for (const f of meta.files) { fs.renameSync(tmp(f), f); done.push(f); }
    return true;
  } catch (e) {
    warn('replacing the files failed (' + (e && e.message) + ') -- putting the checkout back');
    dropTmp();
    try {
      const atHead = done.filter((f) => blobAt('HEAD', f)), fresh = done.filter((f) => !blobAt('HEAD', f));
      if (atHead.length) git(['checkout', 'HEAD', '--'].concat(atHead));
      for (const f of fresh) fs.rmSync(f, { force: true });
    } catch (x) {
      console.log('::error::[state-stash] could not put ' + done.join(',') + ' back: the run must not settle from a half-replaced state');
      setOutput('halt', '1');
      process.exit(3);
    }
    return false;
  }
}

function cmdRestore(channel) {
  setOutput('applied', '0');
  // the commit this job checked out (the run has not touched the files yet): the base of the copy this run may keep
  setEnv('STASH_BASE', git(['rev-parse', 'HEAD']));
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8')); }
  catch (e) { log('no kept state (' + (fs.existsSync(DIR) ? 'unreadable metadata' : 'nothing restored') + ')'); setOutput('found', fs.existsSync(DIR) ? 'stash' : 'none'); rmDir(); return; }
  if (meta && meta.cleared && meta.channel === channel) { log('cleared marker (run ' + meta.run + ') -- nothing kept'); setOutput('found', 'tomb'); rmDir(); return; }
  setOutput('found', 'stash');
  let verdict;
  const contents = {};
  try {
    const p = metaProblem(meta, channel);
    if (p) verdict = { apply: false, why: p };
    else {
      for (const f of meta.files) { try { contents[f] = fs.readFileSync(fileOf(f), 'utf8'); } catch (e) {} }
      verdict = decide(meta, Object.assign({ channel, contents }, gitFacts(meta)));
    }
  } catch (e) { verdict = { apply: false, why: 'check failed: ' + (e && e.message) }; }
  const from = 'kept state of run ' + (meta && meta.run) + ' (' + (meta && meta.at) + ')';
  if (!verdict.apply) { log(from + ' not used: ' + verdict.why + ' -- this run starts from the branch state'); rmDir(); return; }
  if (!applyAll(meta, contents)) { rmDir(); return; }
  console.log('::notice::[state-stash] ' + from + ' applied (' + verdict.why + '; ' + meta.files.length + ' files): its settles are not done again (O689)');
  setOutput('applied', '1');
  rmDir();
}

function cmdOut(channel, outcome, found, files) {
  setOutput('write', '0');
  rmDir();
  const run = process.env.GITHUB_RUN_ID || 'local', at = new Date().toISOString();
  if (outcome === 'failure') {
    const base = String(process.env.STASH_BASE || '');
    if (!SHA.test(base)) { warn('no base commit recorded (STASH_BASE) -- the state of this run is not kept'); return; }
    const list = [...new Set(files.filter((f) => SAFE_NAME.test(f) && fs.existsSync(f)))];
    if (!list.length) { warn('no state file to keep'); return; }
    for (const f of list) {   // a rebase stopped half way leaves conflict markers: such a copy would never be used anyway
      try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { warn(f + ' is not JSON (' + (e && e.message) + ') -- the state of this run is not kept'); return; }
    }
    fs.mkdirSync(path.join(DIR, 'files'), { recursive: true });
    const blobs = {};
    for (const f of list) { fs.copyFileSync(f, fileOf(f)); blobs[f] = blobAt(base, f); }
    const meta = { v: VER, channel, base, files: list, blobs, run, attempt: process.env.GITHUB_RUN_ATTEMPT || '1', at };
    fs.writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify(meta));
    log('push failed -- ' + list.length + ' state files kept for the next run (base ' + base.slice(0, 7) + ')');
    setOutput('write', '1');
    return;
  }
  if (outcome === 'success' && found === 'stash') {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, 'meta.json'), JSON.stringify({ v: VER, channel, cleared: true, run, at }));
    log('pushed after a kept state was found -- clearing it');
    setOutput('write', '1');
  }
}

function main(argv) {
  const [cmd, channel, ...rest] = argv;
  if (cmd === 'backoff') {
    process.stdout.write(String(backoffSeconds(Number(channel), Date.now() / 1000, process.env.JOB_T0, process.env.JOB_LIMIT_S)) + '\n');
    return;
  }
  if (CHANNELS.indexOf(channel) < 0) { console.error('usage: state-stash.js restore|out <' + CHANNELS.join('|') + '> ... | backoff <n>'); process.exit(2); }
  if (cmd === 'restore') {
    try { cmdRestore(channel); }
    catch (e) { warn('restore failed before touching a file (' + (e && e.message) + ') -- this run starts from the branch state'); rmDir(); }
    return;
  }
  if (cmd === 'out') {
    const [outcome, found, ...files] = rest;
    try { cmdOut(channel, outcome, found, files); }
    catch (e) { warn('keeping the state failed (' + (e && e.message) + ')'); setOutput('write', '0'); }
    return;
  }
  console.error('unknown subcommand ' + cmd); process.exit(2);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { metaProblem, decide, backoffSeconds, BACKOFF_S, RESERVE_S, VER, CHANNELS, DIR };
