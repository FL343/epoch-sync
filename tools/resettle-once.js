#!/usr/bin/env node
'use strict';
// ============================================================
// tools/resettle-once.js -- one-shot re-settlement of endless keys the reconcile closed under rules fixed since
//   (cloud audit Q413 + O920 / O922, 2026-11-20; the team competitive lane Q450, 2026-11-26)
// ============================================================
// Why: honest endless runs were closed without a settle by checks that were wrong for them, and the fixes only judge records
//   that come after them -- a closed key is never read again:
//   o920  8 casual co-op sessions from depth 0: `reroll bitmap sanity REJECT (reroll-ahead)` (fixed by Q417, main f7cf5c09)
//   o922  24 resumed casual co-op sessions: `endless perk REJECT (perk_forge: build-mismatch)` (fixed by O922, batch B177)
//   q413  35 casual solo / couch segments resumed from an older checkpoint: `perk REJECT (perk_chain: prefix)` (fixed by Q410 =
//         O903), and every later segment of those runs, closed because the chain memory still followed the old timeline
//   q450  10 segments of one team competitive run (four players, depth 15 -> 61): `team comp segment chain REJECT (chain-gap)`
//         after waiting COMP.CHAIN_WAIT_MS behind a held segment the chain could not pass (fixed by Q418, batch B179, main
//         f1731d33: it moved the chain past that segment 3 hours after the last of them was refused)
//   The players were told to expect them back: settle what the records still on the shards show, take nothing (no continue
//   debit -- they were never charged; nobody's points go down), never settle a key twice (Q144), shallow starts first (the
//   reconcile's own segment order, freshOrder, does that inside a run).
// How: the key goes back to the state it had before the closing run, as far as the key is concerned, and the next reconcile
//   run judges it with today's code:
//   processed.json     the key leaves the list
//   endless-solo.json  (solo / couch keys) the done entries the closing run wrote for it (Q144 / Q245 memory) go; only for a
//                      segment the lane closed without moving its run's chain (a settle always moves it), and only when the
//                      chain did not move at all from the run's first closed segment on (otherwise: review, nothing reopened)
//   starts.json        the key's start entry, as it was at the closing commit (or the one before it); none in either = an
//                      entry dated at the close (the record was seen then: no missing-start signal, no pacing from now)
//   resettle.json      the list (what was reopened, how it was closed, what was removed); validate.js reads it and settles
//                      these keys without continue debits until `until` (RESETTLE_FILE, loadResettleFree); a config file,
//                      not state: no workflow writes it
//   A later segment of such a run that is still open (its result read: waiting at the chain, refused after 7 days on the old
//   timeline) settles once the run's reopened segments do: it is planned with the run (kind 'unblocked'), nothing of it is
//   edited, the list names it for the exemption only (how 'unblocked'), and the dry run must see it settle too.
//   Team competitive keys (lane 'team', Q450): a segment the lane refused at the chain leaves no done entry; its wait clock goes
//   (undo puts it back) and its start entry comes back as above. It is one of these only when, at its close, its run's chain (the
//   start entry's players, the seed) did not move, the wait clock it left was as old as the chain window, and the chain has moved
//   past that head since (run.so: Q418's pass); the run holds no save point (a resumed segment would charge the host the resume
//   fee: nothing is taken) and no other segment under the seed is open or refused outside the list. The lane has no continue
//   debit: the exemption changes nothing for these keys (the list still names them, for undo / status / the reopen-once guard).
//   The chain orders a team run's segments: one the dry run does not see settle (its records gone from the shards, ...) holds
//   the ones after it -- they chain on it -- not the ones before (holdKeys).
//   Nothing else: no board write, no commit, no push. A key listed in any version of resettle.json in the history is never
//   reopened again (`undo` re-closes keys still open; `--again` only reopens a key whose last record says undo re-closed it).
// Subcommands (run from an epoch-sync checkout; read-only unless --yes):
//   plan    --set o920,o922,q413,q450 [--at <commit>] [--json <file>] [--skip m,m]   what would be reopened, from the git history alone
//   apply   --set ... --from-dry <report.json> [--skip m,m] [--yes] [--until-days 7] [--again]
//           edit the working tree (the reconcile job paused); only keys the dry run saw settle, a solo / couch run whole or not at
//           all, a team run from its first segment up to the first that would not settle; a report with a value down, a key
//           closed in B only outside the plan, a new flag outside the plan or a failed run is refused
//   undo    [--yes]                                                  re-close every listed key the reconcile has not taken again
//   finish  [--yes]                                                  delete resettle.json once every key is closed again / expired
//   status                                                           where each listed key is now
//   flags   --keys q413,q407 [--yes]                                 take back the "suspected forgery" flags of these keys (Q407 form)
//   dry-run --snap <dir> [--set ...] [--code <dir>] [--ticks 12] [--work <dir>] [--env-stdin]
//           a board + state snapshot (the vault snapshot layout: manifest.json, boards/<appid>/*.jsonl.gz, cron/*.json) run
//           through the real validate.js twice, offline (tools/resettle-steam.js): as is, and with the keys reopened; reports
//           which keys' records are still on the shards, what settles, who gains what, and any board value that goes down.
//           Needs the job's secrets in the environment (APPID, LB_PREFIX, RANKED_LB, LP_LB, XP_LB, STATE_SALT; others passed
//           through), or as JSON on stdin with --env-stdin (only those names are taken; no publisher key: nothing goes online);
//           the snapshot, the work directory and its logs hold Steam IDs -- they stay on that machine.
// Exit: 0 = done / nothing to do, 1 = something refused or needs review (printed), 2 = usage.
// Node built-ins only, English only (public repo; output names accounts by their de-identified pid only).
// ============================================================
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os'), zlib = require('zlib'), crypto = require('crypto');

// ---- the lists (from the live run logs: master archive/O922_2026-11-20/live-rejects-since-launch.txt; Q413 = audit
//      routes/B-verify-03.md, 13 keys to 11-19T12:31Z, + 7 more the run logs since launch name to 11-19T19:40Z, mailbox M825 / M832
//      / M845: each a solo segment refused `perk REJECT (perk_chain: prefix)`, its writer flagged in the same run; two of the 7,
//      -744718111_1092615113_7 and 316762177_2127984313_7, closed in one commit with a segment of their run that settled, so `plan`
//      holds those two for review -- the chain moved at that close -- and reopens nothing of their runs; `flags` still takes theirs;
//      + 15 the state shows from 11-19T19:51Z to 11-20T12:11Z, before O903 reached main at 12:13Z: flagged and closed by the solo lane
//      in one run, the chain casual and (13 of them) ended -- the perk REJECT exit; whether `perk_chain: prefix` or another perk check
//      is only in the run logs, read before the q413 apply as for the 13 (a key the fixed rule still refuses: the dry run holds it);
//      928483442_ / 1003282118_ / 413513400_1889606694_7 are later segments of 1955281756_1889606694_7's run, listed for `flags`;
//      965906560_1420489742_7 and -88966206_1729740589_7 closed with a settle of their run, held for review like the two above).
//      Co-op keys carry the depths the log line printed: the dry run holds a key that settles at other depths
//      (a record rewritten since; validate.js itself frees a listed key at any depths -- the list lives a week, review suggestion 1).
const SETS = {
  o920: { lane: 'coop', fix: 'Q417', why: 'reroll bitmap sanity REJECT (reroll-ahead)', keys: {
    '-1057409686_261483683_7': [0, 55], '-1716401633_287202448_7': [0, 40], '-2003084531_905572349_7': [0, 40], '-811320951_1979552679_7': [0, 40],
    '1489335873_1715424415_7': [0, 76], '225644457_510034975_7': [0, 52], '3113371_969983324_7': [0, 49], '37274019_378109844_7': [0, 72] } },
  o922: { lane: 'coop', fix: 'O922 (B177)', why: 'endless perk REJECT (perk_forge: build-mismatch)', keys: {
    '-1233970540_832965738_7': [45, 104], '-129533167_1442750312_7': [30, 33], '-1334332717_1767025495_7': [35, 48], '-1466979320_1152452261_7': [35, 70],
    '-1730405734_228498999_7': [35, 41], '-2010811816_1389404028_7': [25, 35], '-2139343137_1434903761_7': [25, 57], '-319745623_2033156732_7': [80, 84],
    '-519503972_405085670_7': [70, 72], '-597337173_1993660537_7': [70, 81], '-834917948_975797039_7': [25, 35], '1027196807_1953124496_7': [30, 36],
    '1127814238_1135794658_7': [10, 79], '1192484926_1183896444_7': [85, 90], '1288751180_1304748171_7': [20, 57], '1424958748_181263892_7': [35, 40],
    '1848098247_945055590_7': [15, 60], '211126201_1328058348_7': [30, 35], '300887346_1521342570_7': [20, 32], '40660911_1913550106_7': [70, 86],
    '439618698_659025595_7': [75, 75], '742898848_676045191_7': [60, 69], '751167286_1572965822_7': [30, 34], '942714292_1599477546_7': [80, 88] } },
  q413: { lane: 'solo', fix: 'Q410 (O903)', why: 'solo segment perk REJECT (perk_chain: prefix) + the run\'s later segments', keys: {
    '403758307_759833717_7': null, '975899634_1658946997_7': null, '1486926998_637995840_7': null, '-1491556382_1057920599_7': null,
    '1402650951_1057920599_7': null, '-208474472_653389368_7': null, '-1490636725_1092770214_7': null, '-1173129200_541892235_7': null,
    '-474609220_2121171552_7': null, '571362144_138684067_7': null, '5128742_1358336056_7': null, '902435330_28611711_7': null,
    '715401068_1301077431_7': null, '-482154105_1978245727_7': null, '1955281756_1889606694_7': null, '-744718111_1092615113_7': null,
    '687288248_1875434390_7': null, '1931428710_880539769_7': null, '-376699473_1538758885_7': null, '316762177_2127984313_7': null,
    '-1763639302_1263948641_7': null, '-1945114912_731808503_7': null, '119571435_1872693108_7': null, '1672300127_885479509_7': null,
    '306848399_134454718_7': null, '728021899_1982546866_7': null, '-1888688969_1321976693_7': null, '-843680383_464287609_7': null,
    '-1448083451_1727966839_7': null, '965906560_1420489742_7': null, '928483442_1889606694_7': null, '1003282118_1889606694_7': null,
    '413513400_1889606694_7': null, '-88966206_1729740589_7': null, '-1486860584_1056385758_7': null } },
  // q450 (cloud audit Q450, mailbox M1075; the run of cloud audit Q418): the state history alone -- each of the 10 closed by one
  //   run between 11-25T18:42Z and 19:42Z (two in the last), the chain unmoved at depth 10 behind the held segment
  //   -656845103_1606489221_7 (10 -> 15), each 7.001 days after the wait clock it left (11-18T18:40Z .. 19:41Z); Q418 reached main
  //   at 11-25T21:33Z and passed that segment (run.so, head 15). In start order (the chain's: 15 -> 20 first). The run's two other
  //   keys under the seed, -690400341_ (0 -> 5) and -707177960_1606489221_7 (5 -> 10), settled on 11-18 and are not listed (a
  //   reopened settle would settle twice; `plan` holds such a key for review: the chain moved at its close).
  q450: { lane: 'team', fix: 'Q418 (B179)', why: 'team comp segment chain REJECT (chain-gap) behind a held segment the chain could not pass', keys: {
    '-673622722_1606489221_7': null, '-623289865_1606489221_7': null, '-640067484_1606489221_7': null, '-589734627_1606489221_7': null,
    '-606512246_1606489221_7': null, '-824621293_1606489221_7': null, '-841398912_1606489221_7': null, '-853781256_1606489221_7': null,
    '-837003637_1606489221_7': null, '-820226018_1606489221_7': null } },
};
// the flags `flags` takes back: q413 = the 35 segments above (their writers were flagged when the segment was refused);
//   q407 = the two friends' rooms of six (cloud audit Q407; only once its fix is on main, else the old rule flags again)
const FLAG_SETS = { q413: Object.keys(SETS.q413.keys), q407: ['1436293812_1720557369_10', '333666603_1234671714_10'] };
const STATE = { processed: 'processed.json', solo: 'endless-solo.json', starts: 'starts.json', signals: 'signals.json', trust: 'trust.json' };
const RESETTLE = 'resettle.json';
const KEY_RE = /^-?\d+_-?\d+_7$/;

// ---- code readiness: each list waits for its fix (a key reopened before it is closed again by the same wrong rule)
function codeReady(dir, set) {
  const rd = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return ''; } };
  const v = rd('validate.js'), pk = rd('perks.js');
  const hook = /function loadResettleFree\(/.test(v) && /resettleFree\.has\(c\.m\)/.test(v);
  const ready = {
    o920: /const rcC = rerollChain\(\{[^}]*\}, null, CASUAL_LIVES\)/.test(v),
    o922: /function coopResumePerkLoose\(pv, startDepth\) \{/.test(v),   // review 1's form: no backing asked for
    q413: /function chainCutOf\(/.test(pk),
    q407: /const rd = roomDispute\(g, vecOf\);/.test(v),
    q450: /function seatOnlyDispute\(/.test(v) && /run\.so = \(Array\.isArray\(run\.so\) \? run\.so : \[\]\)\.concat\(\[m\]\)/.test(v),   // Q418's pass
  };
  // q450: the team lane has no continue debit, so it does not need the exemption hook
  return { ok: (set === 'q407' || set === 'q450' || hook) && !!ready[set], hook, fix: !!ready[set] };
}

// ---- git
function makeGit(repo) {
  const run = (args) => {
    const r = cp.spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + String(r.stderr || '').trim());
    return r.stdout;
  };
  const oidOf = (rev, file) => { const r = cp.spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', rev + ':' + file], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  const lru = new Map();
  const json = (oid) => {
    if (!oid) return null;
    if (lru.has(oid)) { const x = lru.get(oid); lru.delete(oid); lru.set(oid, x); return x; }
    const x = JSON.parse(run(['cat-file', 'blob', oid]));
    lru.set(oid, x);
    while (lru.size > 12) lru.delete(lru.keys().next().value);
    return x;
  };
  const sets = new Map();
  const setOf = (oid) => {
    if (!oid) return new Set();
    if (sets.has(oid)) return sets.get(oid);
    const s = new Set(json(oid) || []);
    sets.set(oid, s);
    while (sets.size > 24) sets.delete(sets.keys().next().value);
    return s;
  };
  return {
    repo, run, oidOf, json, setOf,
    at: (rev, file) => json(oidOf(rev, file)),
    resolve: (rev) => run(['rev-parse', '--verify', rev + '^{commit}']).trim(),
    parent: (c) => { const r = cp.spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '-q', c + '^1'], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; },
    shallow: () => { try { return run(['rev-parse', '--is-shallow-repository']).trim() === 'true'; } catch (e) { return false; } },
    // first-parent commits touching file up to rev, oldest first: [{ c, t (ms) }]
    history: (rev, file) => run(['log', '--first-parent', '--format=%H %ct', rev, '--', file]).split('\n').filter(Boolean)
      .map((l) => { const [c, ct] = l.split(' '); return { c, t: Number(ct) * 1000 }; }).reverse(),
    // every commit (any branch) that touched file
    touching: (file) => run(['log', '--all', '--format=%H', '--', file]).split('\n').filter(Boolean),
  };
}

// ---- small helpers
const short = (c) => String(c || '').slice(0, 12);
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : '?');
const seedOf = (m) => String(m).split('_')[1];
const doneOwner = (k, e) => (Array.isArray(e) && e[2] != null ? String(e[2]) : (String(k).indexOf('|') > 0 ? String(k).split('|')[1] : null));
const doneKeyOf = (k) => String(k).split('|')[0];
const runOwns = (rk, p) => { const a = String(rk).split('|'); return a[0] === 'T' ? String(a[1] || '').split('+').indexOf(p) >= 0 : a[0] === p; };
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
function readJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return dflt; } }
// the way validate.js writes each file (JSON.stringify without spacing), via a sibling temp file
function writeJson(file, obj) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file); }

// the keys every version of resettle.json in the history (and the working tree) lists, with the last record of each
function listedBefore(G, dir) {
  const seen = new Map();
  let commits = [];
  try { commits = G.touching(RESETTLE).reverse(); } catch (e) { /* no history */ }
  for (const c of commits) {
    const j = G.at(c, RESETTLE);
    if (j && j.keys && typeof j.keys === 'object') for (const m of Object.keys(j.keys)) seen.set(m, j.keys[m]);
  }
  const wt = dir ? readJson(path.join(dir, RESETTLE), null) : null;
  if (wt && wt.keys) for (const m of Object.keys(wt.keys)) seen.set(m, wt.keys[m]);
  return seen;
}

// the commit that put key m in the processed list (binary search over the list's first-parent history, oldest first)
function closeOf(G, hist, m) {
  const has = (i) => G.setOf(G.oidOf(hist[i].c, STATE.processed)).has(m);
  if (!hist.length || !has(hist.length - 1)) return { status: 'not-processed' };
  if (has(0)) return { status: 'history-short' };
  let lo = 0, hi = hist.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (has(mid)) hi = mid; else lo = mid; }
  return { status: 'ok', c: hist[hi].c, t: hist[hi].t, i: hi };
}
// the start entry the key gets back: at its close, else just before it, else one dated at the close
function startFor(G, c, t, m) {
  const a = G.at(c, STATE.starts);
  if (a && a[m] && typeof a[m] === 'object') return { src: 'close', e: a[m] };
  const p = G.parent(c), b = p ? G.at(p, STATE.starts) : null;
  if (b && b[m] && typeof b[m] === 'object') return { src: 'before', e: b[m] };
  return { src: 'synth', e: { t0: t, mt: 7, roster: {}, settled: [], synth: true } };
}

// ---- plan: read-only, git history up to `at`
//   -> { at, head time, keys: [{ m, set, lane, status, why?, closed, closedAt, start: {src, e}, done: { entryKey: entry }, run?, listed, kind? }],
//        (kind 'unblocked': a later segment of a reopened run still open at `at` -- no close, no start, only the exemption)
//        runs: [{ rk, owner, status, why?, keys, prefix?, t0? }], counts }
//        (prefix: a team run, keys in its chain's order, t0 = each key's start entry's first sighting -- holdKeys holds from a key on)
function planKeys(G, at, setNames, opts) {
  const o = opts || {};
  const SS = o.lists || SETS;   // (tests hand their own lists)
  const head = G.resolve(at || 'HEAD');
  const before = o.listed || listedBefore(G, o.dir);
  const procHist = G.history(head, STATE.processed);
  const procHead = G.setOf(G.oidOf(head, STATE.processed));
  const out = { at: head, keys: [], runs: [], shallow: G.shallow(), notes: [] };
  const refuse = (m) => {
    const r = before.get(m);
    if (!r) return null;
    if (o.again && (r.how === 'reclosed' || r.how === 'released')) return null;
    return 'listed in ' + RESETTLE + ' before (' + (r.how || 'reopened') + (r.at ? ' ' + r.at : '') + ') -- a key is reopened once';
  };
  // co-op lists: the key, its close, its start entry
  for (const name of setNames) {
    const S = SS[name];
    if (!S) throw new Error('unknown set ' + name + ' (sets: ' + Object.keys(SS).join(', ') + ')');
    if (S.lane !== 'coop') continue;
    for (const m of Object.keys(S.keys)) {
      const k = { m, set: name, lane: 'coop', depths: S.keys[m], listed: true };
      const why = refuse(m);
      const cl = why ? null : closeOf(G, procHist, m);
      if (why) Object.assign(k, { status: 'refused', why });
      else if (cl.status !== 'ok') Object.assign(k, { status: cl.status === 'not-processed' ? 'not-processed' : 'review', why: cl.status === 'not-processed' ? 'not in the processed list (nothing to reopen)' : 'closed before the oldest commit in reach (fetch more history)' });
      else Object.assign(k, { status: 'ok', closed: cl.c, closedAt: cl.t, start: startFor(G, cl.c, cl.t, m), done: {} });
      out.keys.push(k);
    }
  }
  // solo / couch lists: the run of each listed key, every segment of it the lane closed from the first listed one on
  const soloNames = setNames.filter((n) => SS[n] && SS[n].lane === 'solo');
  if (soloNames.length) {
    const groups = new Map();   // rk -> { rk, owner, seed, keys: Map(m -> listed?), from: index in soloHist, status, why }
    const soloHist = G.history(head, STATE.solo);
    const idxOf = new Map(soloHist.map((h, i) => [h.c, i]));
    const pending = [];
    for (const name of soloNames) for (const m of Object.keys(SS[name].keys)) {
      const k = { m, set: name, lane: 'solo', listed: true };
      const why = refuse(m);
      const cl = why ? null : closeOf(G, procHist, m);
      if (why) { Object.assign(k, { status: 'refused', why }); out.keys.push(k); continue; }
      if (cl.status !== 'ok') { Object.assign(k, { status: cl.status === 'not-processed' ? 'not-processed' : 'review', why: cl.status === 'not-processed' ? 'not in the processed list (nothing to reopen)' : 'closed before the oldest commit in reach (fetch more history)' }); out.keys.push(k); continue; }
      const st = G.at(cl.c, STATE.solo) || {}, par = G.parent(cl.c), st0 = (par && G.at(par, STATE.solo)) || {};
      const dN = st.done || {}, d0 = st0.done || {};
      const added = Object.keys(dN).filter((x) => doneKeyOf(x) === m && !same(dN[x], d0[x]));
      const owners = [...new Set(added.map((x) => doneOwner(x, dN[x])).filter(Boolean))];
      Object.assign(k, { closed: cl.c, closedAt: cl.t, start: startFor(G, cl.c, cl.t, m), done: {} });
      for (const x of added) k.done[x] = dN[x];
      if (owners.length !== 1) { Object.assign(k, { status: 'review', why: owners.length ? 'closed for ' + owners.length + ' owners at once' : 'no done entry written at its close (not a verified segment)' }); out.keys.push(k); continue; }
      const p = owners[0], seed = seedOf(m);
      const cands = Object.keys(st.runs || {}).filter((rk) => rk.endsWith('|' + seed) && runOwns(rk, p));
      if (cands.length !== 1) { Object.assign(k, { status: 'review', owner: p, why: cands.length ? cands.length + ' chains of this owner under the seed' : 'no chain of the owner under the seed at its close' }); out.keys.push(k); continue; }
      const rk = cands[0];
      if (!same((st0.runs || {})[rk], (st.runs || {})[rk])) { Object.assign(k, { status: 'review', owner: p, run: rk, why: 'the chain moved at its close (a settle, not a reject)' }); out.keys.push(k); continue; }
      if (!idxOf.has(cl.c)) { Object.assign(k, { status: 'review', owner: p, run: rk, why: 'its close did not touch ' + STATE.solo }); out.keys.push(k); continue; }
      Object.assign(k, { status: 'ok', owner: p, run: rk });
      out.keys.push(k);
      let g = groups.get(rk);
      if (!g) groups.set(rk, (g = { rk, owner: p, seed, from: idxOf.get(cl.c), status: 'ok', keys: [] }));
      g.from = Math.min(g.from, idxOf.get(cl.c));
      g.keys.push(k);
      pending.push(k);
    }
    // one pass over the chain memory's history from the earliest group start: chain moves stop a group; done entries the
    //   lane added for the owner under the seed (a key not listed) are the run's later closed segments
    const gl = [...groups.values()];
    if (gl.length) {
      const from = Math.min(...gl.map((g) => g.from));
      const p0 = G.parent(soloHist[from].c);
      let prev = (p0 && G.at(p0, STATE.solo)) || {};
      for (let i = from; i < soloHist.length; i++) {
        const C = soloHist[i], cur = G.at(C.c, STATE.solo) || {};
        const dP = prev.done || {}, dC = cur.done || {}, rP = prev.runs || {}, rC = cur.runs || {};
        const fresh = Object.keys(dC).filter((x) => !same(dC[x], dP[x]));
        for (const g of gl) {
          if (g.status !== 'ok' || i < g.from) continue;
          if (i > g.from && !same(rP[g.rk], rC[g.rk])) {   // (at g.from the chain was checked per key above)
            g.status = 'review'; g.why = rC[g.rk] ? 'the chain moved at ' + short(C.c) + ' (' + iso(C.t) + '): something settled on the run after its first closed segment' : 'the chain left the memory at ' + short(C.c);
            continue;
          }
          for (const x of fresh) {
            const m = doneKeyOf(x);
            if (!m.endsWith('_' + g.seed + '_7') || doneOwner(x, dC[x]) !== g.owner) continue;
            let k = g.keys.find((y) => y.m === m);
            if (k) { if (!(x in k.done)) { k.done[x] = dC[x]; } continue; }
            if (!rC[g.rk] || !same(rP[g.rk], rC[g.rk])) continue;   // (a key closed with a chain move is caught above)
            k = { m, set: g.keys[0].set, lane: 'solo', listed: false, owner: g.owner, run: g.rk, closed: C.c, closedAt: C.t, done: { [x]: dC[x] } };
            const why = refuse(m);
            if (why) Object.assign(k, { status: 'refused', why });
            else if (!procHead.has(m)) Object.assign(k, { status: 'not-processed', why: 'not in the processed list (nothing to reopen)' });
            else {
              const par = G.parent(C.c);
              const inP = G.setOf(G.oidOf(C.c, STATE.processed)).has(m), inP0 = par ? G.setOf(G.oidOf(par, STATE.processed)).has(m) : true;
              if (!inP || inP0) Object.assign(k, { status: 'review', why: 'its done entry and its processed mark did not land in one commit' });
              else Object.assign(k, { status: 'ok', start: startFor(G, C.c, C.t, m) });
            }
            g.keys.push(k); out.keys.push(k);
          }
        }
        prev = cur;
      }
    }
    // the run's later segments still open at `at` with the owner's result in (cloud audit Q413 review 1): the old timeline holds
    //   each at the chain (endless-solo.json wait, refused once COMP.CHAIN_WAIT_MS is out; a resumed segment's save-orphan alike) or
    //   judges it next against the same stuck chain; once the reopened segments settle, it settles too. So it is part of the same
    //   run: kind 'unblocked' -- nothing to reopen (it was never closed), only the continue exemption (resettle.json how
    //   'unblocked'), and the dry run must see it settle like every other segment of the run. A start entry without the owner's
    //   result is left alone (both timelines wait for the record alike); a waiting key under the seed with no start entry naming
    //   anyone holds the run (whose is it?).
    const sH = G.at(head, STATE.solo) || {}, stH = G.at(head, STATE.starts) || {}, wH = sH.wait || {};
    for (const g of gl) {
      if (g.status !== 'ok') continue;
      const mine = new Set(g.keys.map((k) => k.m));
      const cands = [...new Set(Object.keys(wH).concat(Object.keys(stH)))].filter((m) => KEY_RE.test(m) && seedOf(m) === g.seed && !mine.has(m) && !procHead.has(m)).sort();
      for (const m of cands) {
        const s = (stH[m] && typeof stH[m] === 'object') ? stH[m] : null;
        const ros = s ? Object.keys(s.roster || {}).map((x) => String(s.roster[x])) : [];
        const wrote = !!s && Array.isArray(s.settled) && s.settled.map(String).indexOf(g.owner) >= 0;
        const waits = !!(wH[m] && typeof wH[m] === 'object');
        if (!wrote && !waits) continue;   // no result of the owner's read yet: the same in both timelines
        if (!s) { g.status = 'review'; g.why = 'a segment under the seed waits at the chain with no start entry to tell whose it is (' + m + ')'; break; }
        if (!wrote && ros.indexOf(g.owner) < 0) continue;   // another player's key under the same seed
        const k = { m, set: g.keys[0].set, lane: 'solo', listed: false, kind: 'unblocked', owner: g.owner, run: g.rk, behind: g.keys[0].m, done: {}, waitT0: waits ? (Number(wH[m].t0) || null) : null, wrote };
        const why = refuse(m);
        Object.assign(k, why ? { status: 'refused', why } : { status: 'ok' });
        g.keys.push(k); out.keys.push(k);
      }
    }
    for (const g of gl) {
      if (g.status === 'ok') {   // a run is reopened whole or not at all: one segment that cannot be holds the run
        const bad = g.keys.find((k) => k.status !== 'ok');
        if (bad) { g.status = 'review'; g.why = 'segment ' + bad.m + ' is ' + bad.status + (bad.why ? ' (' + bad.why + ')' : '') + ' -- the run goes whole or not at all'; }
      }
      if (g.status !== 'ok') for (const k of g.keys) if (k.status === 'ok') { k.status = 'review'; k.why = 'run held: ' + g.why; }
      out.runs.push({ rk: g.rk, owner: g.owner, status: g.status, why: g.why || null, keys: g.keys.map((k) => k.m) });
    }
  }
  // team competitive lists (cloud audit Q450): segments the lane refused at the chain -- soloChainPlan's wait ran out
  //   (COMP.CHAIN_WAIT_MS) -- behind a held segment its chain has moved past since (Q418's pass, run.so). Such a refusal leaves no
  //   done entry and keeps its wait clock (applyToDir takes it out); a run is reopened only when every listed segment of it is one
  //   of these and nothing of the run could charge anyone (see the header).
  const teamNames = setNames.filter((n) => SS[n] && SS[n].lane === 'team');
  if (teamNames.length) {
    const waitMs = Number(o.chainWaitMs || process.env.COMP_CHAIN_WAIT_MS || 7 * 86400000);   // validate.js COMP.CHAIN_WAIT_MS (same env)
    const sH = G.at(head, STATE.solo) || {}, stH = G.at(head, STATE.starts) || {};
    const groups = new Map();   // seed -> { seed, rk, keys, status, why }: every listed key under one seed, whatever its status
    for (const name of teamNames) for (const m of Object.keys(SS[name].keys)) {
      const k = { m, set: name, lane: 'team', listed: true, done: {} };
      { const sd = seedOf(m); let g = groups.get(sd); if (!g) groups.set(sd, (g = { seed: sd, rk: null, keys: [], status: 'ok', why: null })); g.keys.push(k); }
      const review = (why) => { Object.assign(k, { status: 'review', why }); out.keys.push(k); };
      const why = refuse(m);
      if (why) { Object.assign(k, { status: 'refused', why }); out.keys.push(k); continue; }
      const cl = closeOf(G, procHist, m);
      if (cl.status !== 'ok') { Object.assign(k, { status: cl.status === 'not-processed' ? 'not-processed' : 'review', why: cl.status === 'not-processed' ? 'not in the processed list (nothing to reopen)' : 'closed before the oldest commit in reach (fetch more history)' }); out.keys.push(k); continue; }
      const par = G.parent(cl.c), st = G.at(cl.c, STATE.solo) || {}, st0 = (par && G.at(par, STATE.solo)) || {};
      Object.assign(k, { closed: cl.c, closedAt: cl.t, start: startFor(G, cl.c, cl.t, m) });
      // whose run: the players its start entry names (the run's chain key is their set + the seed)
      const e = k.start.e || {};
      const team = [...new Set((Array.isArray(e.started) && e.started.length ? e.started : Object.values(e.roster || {})).map(String))].sort();
      if (k.start.src === 'synth' || team.length < 2) { review('no start entry naming the team at its close (whose run is it?)'); continue; }
      k.team = team;
      const seed = seedOf(m);
      const cands = Object.keys(st.runs || {}).filter((rk) => { const a = String(rk).split('|'); return a[0] === 'T' && a[a.length - 1] === seed && String(a[1] || '').split('+').sort().join('+') === team.join('+'); });
      if (cands.length !== 1) { review(cands.length ? cands.length + ' team chains of these players under the seed at its close' : 'no team chain of these players under the seed at its close'); continue; }
      const rk = cands[0];
      k.run = rk;
      if (!same((st0.runs || {})[rk], (st.runs || {})[rk])) { review('the chain moved at its close (a settle, not a reject)'); continue; }
      const w0 = (st0.wait || {})[m];
      if (!w0 || typeof w0 !== 'object' || !Number.isFinite(Number(w0.t0))) { review('no chain wait clock before its close (not refused at the chain)'); continue; }
      // (commit times are whole seconds; the run that refused it read its clock before it committed)
      if (!(cl.t + 1000 - Number(w0.t0) > waitMs)) { review('closed ' + Math.round((cl.t - Number(w0.t0)) / 60000) + ' min after its wait clock started, inside the chain window (' + Math.round(waitMs / 60000) + ' min): not the wait-out refusal'); continue; }
      const dN = st.done || {}, d0 = st0.done || {};
      if (Object.keys(dN).some((x) => doneKeyOf(x) === m && !same(dN[x], d0[x]))) { review('a done entry written at its close (the team lane writes none when it refuses)'); continue; }
      Object.assign(k, { status: 'ok', waitT0: Number(w0.t0), headAtClose: (((st.runs || {})[rk] || {}).max | 0) });
      out.keys.push(k);
    }
    for (const g of groups.values()) {
      // a team run is reopened only when every listed segment of it can be (a listed key that cannot -- one that settled, one
      //   whose run cannot be told -- means the list or the state is not what it was drawn from: review, nothing of the run)
      const bad = g.keys.find((k) => k.status !== 'ok'), rks = [...new Set(g.keys.map((k) => k.run).filter(Boolean))];
      g.rk = rks.length === 1 ? rks[0] : null;
      const rH = g.rk ? (sH.runs || {})[g.rk] : null;
      const mine = new Set(g.keys.map((k) => k.m)), passed = new Set(rH && Array.isArray(rH.so) ? rH.so : []);
      const under = (mp) => Object.keys(mp || {}).filter((m) => KEY_RE.test(m) && seedOf(m) === g.seed && !mine.has(m) && !passed.has(m));
      const openK = [...new Set(under(sH.wait).concat(under(stH)))].filter((m) => !procHead.has(m)).sort();
      const leftK = under(sH.wait).filter((m) => procHead.has(m)).sort();
      const hi = Math.max(...g.keys.map((k) => k.headAtClose | 0));
      if (bad) g.why = 'segment ' + bad.m + ' is ' + bad.status + (bad.why ? ' (' + bad.why + ')' : '') + ' -- a team run goes from its first listed segment or not at all';
      else if (rks.length !== 1) g.why = rks.length + ' team chains among the listed segments under the seed';
      else if (!rH) g.why = 'the chain left the memory';
      else if (!((rH.max | 0) > hi)) g.why = 'the chain has not moved past ' + hi + ' since (head ' + (rH.max | 0) + '): nothing for these segments to chain on';
      else if (!passed.size) g.why = 'no held segment passed on the run (run.so, Q418): not this list\'s case';
      else if (rH.saves && typeof rH.saves === 'object' && Object.keys(rH.saves).length) g.why = 'the run holds save points: a resumed segment would charge the host the resume fee (nothing is to be taken)';
      else if (rH.burnt) g.why = 'the run is burnt (a used save row: it settles nothing more)';
      else if (openK.length) g.why = 'a segment under the seed is still open outside the list (' + openK.join(' ') + ')';
      else if (leftK.length) g.why = 'a segment under the seed refused at the chain is not in the list (' + leftK.join(' ') + ')';
      if (g.why) g.status = 'review';
      // the chain's order: the start entries' first sightings (a segment starts once the one before it ended; a tie = one pass)
      const t0Of = (k) => Number(k.start && k.start.e && k.start.e.t0) || 0;
      g.keys.sort((a, b) => (t0Of(a) - t0Of(b)) || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0));
      if (g.status !== 'ok') for (const k of g.keys) if (k.status === 'ok') { k.status = 'review'; k.why = 'run held: ' + g.why; }
      out.runs.push({ rk: g.rk || ('T|?|' + g.seed), owner: null, status: g.status, why: g.why, keys: g.keys.map((k) => k.m), prefix: true, t0: Object.fromEntries(g.keys.map((k) => [k.m, t0Of(k)])) });
    }
  }
  // a key both lists name, or a later segment of one run that another list names: once
  const seenK = new Set();
  out.keys = out.keys.filter((k) => (seenK.has(k.m) ? false : (seenK.add(k.m), true)));
  out.counts = { ok: 0, refused: 0, review: 0, 'not-processed': 0 };
  for (const k of out.keys) out.counts[k.status] = (out.counts[k.status] | 0) + 1;
  if (out.shallow) out.notes.push('this checkout is shallow: a key closed before its oldest commit shows as review, and the reopen-once guard only sees ' + RESETTLE + ' versions in reach');
  return out;
}

// keys not to reopen (Map m -> why): a co-op key alone; a solo / couch key with every segment of its run (a run reopened with
//   a hole in it would be judged against the old timeline again); a team key with the segments of its run that start no earlier
//   (Q450: they chain on it -- reopened without it they would only wait at the chain again; the ones before it settle as they
//   are). Mutates the plan; counts recomputed.
function holdKeys(plan, skip) {
  if (!skip || !skip.size) return plan;
  const runOf = new Map();
  for (const r of plan.runs) for (const m of r.keys) runOf.set(m, r);
  const held = new Map();
  for (const [m, why] of skip) {
    const r = runOf.get(m);
    if (!r) { held.set(m, why); continue; }
    if (r.prefix) {
      const t = (r.t0 || {})[m] || 0;
      for (const x of r.keys) if (((r.t0 || {})[x] || 0) >= t && !held.has(x)) held.set(x, x === m ? why : 'it chains on ' + m + ' (' + why + ')');
      if (r.status === 'ok' || r.status === 'part') { const all = r.keys.every((x) => held.has(x)); r.status = all ? 'held' : 'part'; r.why = (r.why && r.status === 'part' ? r.why + '; ' : '') + 'held from ' + m + ' on (' + why + ')'; }
      continue;
    }
    for (const x of r.keys) if (!held.has(x)) held.set(x, x === m ? why : 'its run holds ' + m + ' (' + why + ')');
    if (r.status === 'ok') { r.status = 'held'; r.why = 'by hand: ' + m + ' (' + why + ')'; }
  }
  for (const k of plan.keys) if (held.has(k.m) && k.status === 'ok') { k.status = 'refused'; k.why = 'held: ' + held.get(k.m); }
  plan.counts = { ok: 0, refused: 0, review: 0, 'not-processed': 0 };
  for (const k of plan.keys) plan.counts[k.status] = (plan.counts[k.status] | 0) + 1;
  return plan;
}
// a dry run's report.json -> the keys apply must not reopen (Map m -> why): every planned key the dry run did not see settle
function dryVerdicts(report, plan) {
  const byM = new Map(((report && report.keys) || []).map((r) => [r.m, r]));
  const skip = new Map();
  for (const k of plan.keys) {
    if (k.status !== 'ok') continue;
    const r = byM.get(k.m);
    if (!r) skip.set(k.m, 'not in the dry run');
    else if (!/^settled \(tick [0-9]+\)$/.test(String(r.result))) skip.set(k.m, 'dry run: ' + String(r.result).slice(0, 120));
    else if (r.flagB) skip.set(k.m, 'dry run: settled, but a new forgery flag on it in B (' + r.flagB + ')');
  }
  return skip;
}

function printPlan(plan, log) {
  log('plan at ' + short(plan.at) + ': ' + plan.keys.length + ' key(s) -- ' + Object.keys(plan.counts).filter((s) => plan.counts[s]).map((s) => plan.counts[s] + ' ' + s).join(', '));
  for (const n of plan.notes) log('  note: ' + n);
  for (const k of plan.keys) {
    const dep = k.depths ? ' depth ' + k.depths[0] + '->' + k.depths[1] : '';
    const who = k.owner ? ' owner ' + k.owner.slice(0, 8) : k.team ? ' team ' + k.team.map((p) => p.slice(0, 8)).join('+') + (k.waitT0 ? ' (waited at the chain from ' + iso(k.waitT0) + ')' : '') : '';
    const st = k.start ? ' start ' + k.start.src + ' ' + iso(k.start.e && k.start.e.t0) : '';
    const later = k.listed ? '' : k.kind === 'unblocked' ? ' (later segment, still open' + (k.waitT0 ? ': waiting at the chain since ' + iso(k.waitT0) : ': its result read') + ' -- joins the run, exemption only)' : ' (later segment)';
    log('  ' + k.status.padEnd(13) + ' ' + k.set + ' ' + k.lane + ' ' + k.m + later + dep + who
      + (k.closed ? ' closed ' + short(k.closed) + ' ' + iso(k.closedAt) : '') + st + (k.done && Object.keys(k.done).length ? ' done ' + Object.keys(k.done).length : '') + (k.why ? ' -- ' + k.why : ''));
  }
  const unb = new Set(plan.keys.filter((k) => k.kind === 'unblocked').map((k) => k.m));
  for (const r of plan.runs) { const u = r.keys.filter((m) => unb.has(m)).length; log('  run ' + r.rk.replace(/[0-9a-f]{16}/g, (p) => p.slice(0, 8)) + ': ' + r.status + ', ' + r.keys.length + ' segment(s)' + (u ? ' (' + u + ' still open, exemption only)' : '') + (r.prefix ? ' (team: in chain order, from the first up to the first that cannot settle)' : '') + (r.why ? ' -- ' + r.why : '')); }
}

// ---- apply: edit the state files in dir (a working tree or a dry run's copy)
function applyToDir(dir, plan, opts) {
  const o = opts || {};
  const now = Number(o.now) || Date.now();
  const P = path.join(dir, STATE.processed), SO = path.join(dir, STATE.solo), SS = path.join(dir, STATE.starts), RS = path.join(dir, RESETTLE);
  const proc = readJson(P, null), solo = readJson(SO, null), starts = readJson(SS, null);
  if (!Array.isArray(proc) || !solo || !starts) throw new Error('state files missing or unreadable in ' + dir);
  const rs = readJson(RS, null) || { v: 1, note: 'cloud audit Q413 / O920 / O922 / Q450: keys reopened once by tools/resettle-once.js; validate.js settles them without continue debits until `until`', until: '', keys: {} };
  const inProc = new Set(proc);
  const res = { reopened: [], unblocked: [], skipped: [] };
  for (const k of plan.keys) {
    if (k.status !== 'ok') continue;
    if (rs.keys[k.m] && !(o.again && (rs.keys[k.m].how === 'reclosed' || rs.keys[k.m].how === 'released'))) { res.skipped.push([k.m, 'already in ' + RESETTLE]); continue; }
    if (k.kind === 'unblocked') {   // still open: no state edit, the exemption only (its wait clock and start entry stay as they are)
      if (inProc.has(k.m)) { res.skipped.push([k.m, 'closed since the plan']); continue; }
      rs.keys[k.m] = { cp: 'free', set: k.set, lane: k.lane, how: 'unblocked', at: iso(now), behind: k.behind, waiting: k.waitT0 ? iso(k.waitT0) : null };
      res.unblocked.push(k.m);
      continue;
    }
    if (!inProc.has(k.m)) { res.skipped.push([k.m, 'not in the processed list any more']); continue; }
    const done = {};
    let moved = false;
    for (const x of Object.keys(k.done || {})) {
      const e = (solo.done || {})[x];
      if (e === undefined) continue;   // pruned since: nothing to take out
      if (!same(e, k.done[x])) { moved = true; break; }
      done[x] = e;
    }
    if (moved) { res.skipped.push([k.m, 'its done entry changed since the plan']); continue; }
    for (const x of Object.keys(done)) delete solo.done[x];
    // a chain-gap clock the rejection left behind (the reject path keeps it until the prune): the key judged again would find it
    //   out of time at once and be refused before its predecessor settles -- it goes, and undo puts it back
    const wait = (solo.wait && solo.wait[k.m] && typeof solo.wait[k.m] === 'object') ? solo.wait[k.m] : null;
    if (wait) delete solo.wait[k.m];
    inProc.delete(k.m);
    let start = 'kept';
    if (!starts[k.m] && k.start) { starts[k.m] = JSON.parse(JSON.stringify(k.start.e)); start = k.start.src; }
    rs.keys[k.m] = Object.assign({ cp: 'free', set: k.set, lane: k.lane, how: 'reopened', at: iso(now), closed: short(k.closed), closedAt: iso(k.closedAt), start, done },
      k.depths ? { depths: k.depths } : {}, wait ? { wait } : {});
    res.reopened.push(k.m);
  }
  if (!res.reopened.length && !res.unblocked.length) return res;
  const until = now + Math.max(1, Number(o.untilDays) || 7) * 86400000;
  rs.v = 1;
  rs.until = iso(Math.max(until, Date.parse(rs.until || '') || 0));
  writeJson(P, proc.filter((m) => inProc.has(m)));
  writeJson(SO, solo);
  writeJson(SS, starts);
  fs.writeFileSync(RS, JSON.stringify(rs, null, 1) + '\n');
  res.until = rs.until;
  return res;
}

// ---- undo: re-close what is still open (the done entries go back), mark the rest; the exemption ends now
function undoInDir(dir, opts) {
  const now = Number((opts || {}).now) || Date.now();
  const P = path.join(dir, STATE.processed), SO = path.join(dir, STATE.solo), RS = path.join(dir, RESETTLE);
  const rs = readJson(RS, null);
  if (!rs || !rs.keys) return { reclosed: [], taken: [], none: true };
  const proc = readJson(P, []), solo = readJson(SO, {});
  const inProc = new Set(proc), res = { reclosed: [], taken: [], released: [] };
  solo.done = solo.done || {};
  for (const m of Object.keys(rs.keys)) {
    const r = rs.keys[m];
    if (r.how === 'unblocked') {   // never closed by the tool: taken by the reconcile, or left as it was (open), the exemption gone
      if (inProc.has(m)) { r.how = 'taken'; res.taken.push(m); } else { r.how = 'released'; delete r.cp; res.released.push(m); }
      r.undoAt = iso(now);
      continue;
    }
    if (r.how !== 'reopened') continue;
    if (inProc.has(m)) { r.how = 'taken'; r.undoAt = iso(now); res.taken.push(m); continue; }   // the reconcile took it again (settled or closed)
    proc.push(m); inProc.add(m);
    for (const x of Object.keys(r.done || {})) if (solo.done[x] === undefined) solo.done[x] = r.done[x];
    if (r.wait && typeof r.wait === 'object') { solo.wait = solo.wait || {}; if (solo.wait[m] === undefined) solo.wait[m] = r.wait; }
    r.how = 'reclosed'; r.undoAt = iso(now); delete r.cp;
    res.reclosed.push(m);
  }
  rs.until = iso(now);
  if (res.reclosed.length) { writeJson(P, proc); writeJson(SO, solo); }
  fs.writeFileSync(RS, JSON.stringify(rs, null, 1) + '\n');
  return res;
}

// ---- status / finish
function statusOf(dir, nowMs) {
  const rs = readJson(path.join(dir, RESETTLE), null);
  if (!rs || !rs.keys) return null;
  const proc = new Set(readJson(path.join(dir, STATE.processed), []));
  const solo = readJson(path.join(dir, STATE.solo), {});
  const rows = Object.keys(rs.keys).map((m) => {
    const r = rs.keys[m];
    const back = proc.has(m);
    const doneNow = Object.keys((solo && solo.done) || {}).some((x) => doneKeyOf(x) === m);
    const closed = r.how === 'unblocked' || (r.how === 'taken' && !r.closed) ? 'closed (settled or rejected -- see the run log)' : (r.lane === 'solo' ? (doneNow ? 'closed again (done entry back: settled or rejected -- see the run log)' : 'closed again') : 'closed again');
    return { m, set: r.set, lane: r.lane, how: r.how, open: !back, state: !back ? (r.how === 'released' ? 'open, exemption ended (left as the reconcile has it)' : 'open (waiting for the reconcile)') : closed };
  });
  const until = Date.parse(rs.until || '');
  return { rows, until: rs.until, expired: !(until > (nowMs || Date.now())), allClosed: rows.every((r) => !r.open) };
}

// ---- flags: take back the "suspected forgery" flags of these keys (the Q407 form, many keys in one pass)
//   signals.json players[pid].fm: the key's cell goes (the trust tier counts the cells of the last 90 days); f / fx are
//     lifetime counts and stay; flagged[key] stays (it keeps the same key from being flagged again while its records are up).
//   trust.json acct[pid].ev: the key's fl events get fp 'review', acct.fp + 1 per key, acct.mw = 1 (the mirror row is rewritten).
function flagsInDir(dir, keys) {
  const SG = path.join(dir, STATE.signals), TR = path.join(dir, STATE.trust);
  const sg = readJson(SG, null), tr = readJson(TR, null);
  if (!sg || !tr) throw new Error('signals.json / trust.json missing in ' + dir);
  const rows = [];
  for (const K of keys) {
    const pids = Object.keys(sg.players || {}).filter((h) => sg.players[h] && sg.players[h].fm && Object.prototype.hasOwnProperty.call(sg.players[h].fm, K));
    const evOnly = Object.keys((tr.acct || {})).filter((h) => pids.indexOf(h) < 0 && (tr.acct[h].ev || []).some((e) => e.s === 'fl' && e.m === K && !e.fp));
    for (const h of pids.concat(evOnly)) {
      const p = sg.players[h], a = (tr.acct || {})[h];
      const ev = a ? (a.ev || []).filter((e) => e.s === 'fl' && e.m === K && !e.fp) : [];
      if (p && p.fm) delete p.fm[K];
      if (a && ev.length) { for (const e of ev) e.fp = 'review'; a.fp = (a.fp | 0) + 1; a.mw = 1; }
      rows.push({ m: K, p: h, fm: !!(p && pids.indexOf(h) >= 0), ev: ev.length });
    }
    if (!pids.length && !evOnly.length) rows.push({ m: K, p: null });
  }
  return { rows, sg, tr, write: () => { writeJson(SG, sg); writeJson(TR, tr); } };
}

// ---- dry run helpers
// the literal (non-secret) env of the reconcile step in a workflow file: the `env:` block of the step that runs `node validate.js`
function workflowEnv(ymlText) {
  const L = String(ymlText).split('\n');
  const ri = L.findIndex((l) => /^\s*run:\s*node validate\.js\s*$/.test(l));
  if (ri < 0) return {};
  const runInd = L[ri].search(/\S/);
  let ei = -1;
  for (let i = ri - 1; i >= 0; i--) { const ind = L[i].search(/\S/); if (ind === runInd && /^\s*env:\s*$/.test(L[i])) { ei = i; break; } if (ind >= 0 && ind < runInd) break; }
  const env = {};
  if (ei < 0) return env;
  for (let i = ei + 1; i < ri; i++) {
    const m = /^\s*([A-Z0-9_]+):\s*(.*?)\s*$/.exec(L[i].replace(/\s+#.*$/, ''));
    if (!m || /\$\{\{/.test(m[2])) continue;
    env[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }
  return env;
}
const SECRET_ENV = ['APPID', 'LB_PREFIX', 'RANKED_LB', 'LP_LB', 'XP_LB', 'SUPPORTER_DLC_APPID', 'CLASSIC_APPID', 'STATE_SALT'];
const hexInts = (h) => { const b = Buffer.from(String(h || ''), 'hex'), out = []; for (let i = 0; i + 4 <= b.length; i += 4) out.push(b.readInt32LE(i)); return out; };
// a vault snapshot -> { fx, meta } (fx = tools/resettle-steam.js's board file)
function loadSnapshot(snap, appid) {
  const man = readJson(path.join(snap, 'manifest.json'), null);
  if (!man || !man.appids || !man.appids[String(appid)]) throw new Error('no manifest.json for appid ' + appid + ' in ' + snap);
  const fx = { nextId: 1, boards: [] };
  let maxId = 0;
  for (const b of man.appids[String(appid)].boards) {
    const entries = {};
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(snap, b.file))).toString('utf8');
    for (const line of raw.split('\n')) { if (!line) continue; const r = JSON.parse(line); entries[String(r.sid)] = { score: Number(r.score) | 0, h: r.d ? String(r.d).toLowerCase() : '' }; }
    fx.boards.push({ id: Number(b.id), name: b.name, trusted: !!b.onlytrustedwrites, asc: /asc/i.test(String(b.sortmethod || '')), entries });
    maxId = Math.max(maxId, Number(b.id) || 0);
    if (!b.complete) throw new Error('board ' + b.name + ' was not read whole in the snapshot (page cap) -- take a new snapshot');
  }
  fx.nextId = maxId + 1000;
  return { fx, man };
}
// every record of the listed keys on the snapshot's boards: m -> [{ board, sid, kind }]
function recordsOf(fx, keys) {
  const want = new Set(keys), out = {};
  for (const m of keys) out[m] = [];
  for (const b of fx.boards) for (const sid of Object.keys(b.entries)) {
    const d = hexInts(b.entries[sid].h);
    if (d.length < 5) continue;
    const m = d[3] + '_' + d[4] + '_' + d[2];
    if (want.has(m)) out[m].push({ board: b.name, sid, kind: (d[0] & 0xff) === 0xB1 ? 'settle' : (d[0] & 0xff) === 0xB2 ? 'start' : 'other ' + (d[0] & 0xff), sd: d.length > 13 ? d : null });
  }
  return out;
}
function copyCode(code, to, stateNames) {
  const files = cp.spawnSync('git', ['-C', code, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\0').filter(Boolean);
  for (const f of files) {
    if ((!f.includes('/') && stateNames.has(f)) || f.startsWith('test/')) continue;
    const src = path.join(code, f);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(to, f)), { recursive: true });
    fs.copyFileSync(src, path.join(to, f));
  }
}
function boardDiff(fxA, fxB) {
  const out = [];
  const byName = new Map(fxA.boards.map((b) => [b.name, b]));
  for (const b of fxB.boards) {
    const a = byName.get(b.name) || { entries: {}, asc: b.asc };
    const sids = new Set(Object.keys(a.entries).concat(Object.keys(b.entries)));
    for (const sid of sids) {
      const x = a.entries[sid], y = b.entries[sid];
      if (x && y && x.score === y.score && x.h === y.h) continue;
      out.push({ board: b.name, sid, a: x ? x.score : null, b: y ? y.score : null, ah: x ? x.h : null, bh: y ? y.h : null, down: !!(x && (!y || (b.asc ? y.score > x.score : y.score < x.score))) });
    }
  }
  return out;
}
// the forgery flags on file in a state directory: 'pid|key' for every signals.json fm cell and every trust.json fl event
function flagCells(dir) {
  const out = new Set();
  const sg = readJson(path.join(dir, STATE.signals), null), tr = readJson(path.join(dir, STATE.trust), null);
  for (const h of Object.keys((sg && sg.players) || {})) for (const K of Object.keys((sg.players[h] && sg.players[h].fm) || {})) out.add(h + '|' + K);
  for (const h of Object.keys((tr && tr.acct) || {})) for (const e of ((tr.acct[h] && tr.acct[h].ev) || [])) if (e && e.s === 'fl' && e.m) out.add(h + '|' + e.m);
  return out;
}
// what a dry run's report.json lets apply do: { refuse: [why] } (empty = usable; the key verdicts come from dryVerdicts)
function reportGate(rep, nowMs) {
  const refuse = [], warn = [];
  if (!rep || rep.v !== 2 || !rep.exit) refuse.push('not a report of this version of the tool (dry-run again)');
  else {
    if ((rep.down | 0) > 0) refuse.push((rep.down | 0) + ' board value(s) go down in B');
    if ((rep.onlyB || []).length) refuse.push((rep.onlyB || []).length + ' key(s) closed in B only outside the plan: ' + rep.onlyB.slice(0, 5).join(' '));
    if ((rep.flagsOther || []).length) refuse.push('new forgery flags in B on keys outside the plan: ' + rep.flagsOther.slice(0, 5).map((x) => x.m).join(' '));
    const bad = (rep.exit.A || []).concat(rep.exit.B || []).filter((c) => c !== 0).length;
    if (bad) refuse.push(bad + ' reconcile run(s) of the dry run did not exit 0');
  }
  const age = (Number(nowMs) || Date.now()) - Date.parse((rep && rep.snapshot) || '');
  if (!(age < 24 * 3600000)) warn.push('the dry run\'s snapshot is ' + (Number.isFinite(age) ? Math.round(age / 3600000) + ' hours' : 'of unknown age') + ' old: records may have left the shards since (a reopened key whose records are gone only waits, nobody charged, but it is not settled either) -- a fresh snapshot and dry run is safer');
  return { refuse, warn };
}
function dryRun(o) {
  const log = o.log || console.log;
  const code = path.resolve(o.code || o.repo || '.'), repo = path.resolve(o.repo || '.');
  for (const k of ['APPID', 'STATE_SALT']) if (!process.env[k]) throw new Error(k + ' is not set: the dry run needs the reconcile job\'s secrets in the environment (see the README)');
  const salt = process.env.STATE_SALT, pidOf = (sid) => crypto.createHmac('sha256', salt).update(String(sid)).digest('hex').slice(0, 16);
  for (const s of o.sets) { const r = codeReady(code, s); if (!r.ok && !o.anyCode && !o.lists) throw new Error('the code in ' + code + ' lacks ' + (r.hook ? 'the fix for ' + s + ' (' + SETS[s].fix + ')' : 'the resettle hook (this patch)') + ' -- dry-run the tree that will run (or pass --any-code to see the old rule)'); }
  const { fx, man } = loadSnapshot(o.snap, process.env.APPID);
  const G = makeGit(repo);
  const at = o.at || (man.cron && man.cron.head);
  if (!at) throw new Error('the snapshot names no reconcile commit (manifest cron.head); pass --at');
  try { G.resolve(at); } catch (e) { throw new Error('commit ' + short(at) + ' is not in ' + repo + ' (git fetch origin main first)'); }
  // the snapshot's state must be that commit's (the plan reads the commit's history)
  for (const f of [STATE.processed, STATE.solo, STATE.starts]) {
    const snapF = path.join(o.snap, 'cron', f), oid = G.oidOf(at, f);
    const h = cp.spawnSync('git', ['-C', repo, 'hash-object', snapF], { encoding: 'utf8' }).stdout.trim();
    if (oid !== h) throw new Error(f + ' in the snapshot is not ' + f + ' at ' + short(at));
  }
  const plan = planKeys(G, at, o.sets, { dir: null, lists: o.lists, chainWaitMs: o.chainWaitMs || (o.envExtra && o.envExtra.COMP_CHAIN_WAIT_MS) });   // the chain window the reconcile in B runs with
  printPlan(plan, log);
  const targets = plan.keys.filter((k) => k.status === 'ok').map((k) => k.m);
  const snapAt = Date.parse(man.at || '') || Number(G.run(['log', '-1', '--format=%ct', at]).trim()) * 1000;
  const work = path.resolve(o.work || fs.mkdtempSync(path.join(os.tmpdir(), 'resettle-dry-')));
  fs.mkdirSync(work, { recursive: true });
  const recs = recordsOf(fx, plan.keys.map((k) => k.m));
  const stateNames = require(path.join(code, 'tools', 'code-hash.js')).stateFiles(code);
  const wfEnv = workflowEnv(fs.readFileSync(path.join(code, '.github', 'workflows', 'validate.yml'), 'utf8'));
  const sides = {};
  for (const side of ['A', 'B']) {
    const dir = path.join(work, side);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    copyCode(code, dir, stateNames);
    for (const f of fs.readdirSync(path.join(o.snap, 'cron'))) if (/\.json$/.test(f) && stateNames.has(f)) fs.copyFileSync(path.join(o.snap, 'cron', f), path.join(dir, f));
    fs.rmSync(path.join(dir, RESETTLE), { force: true });
    const fxPath = path.join(dir, '.fx.json'), logPath = path.join(dir, '.writes.jsonl');
    fs.writeFileSync(fxPath, JSON.stringify(fx)); fs.writeFileSync(logPath, '');
    let ap = null;
    if (side === 'B') ap = applyToDir(dir, plan, { now: snapAt, untilDays: 7 });
    const runs = [];
    for (let t = 1; t <= o.ticks; t++) {
      const env = Object.assign({ PATH: process.env.PATH, HOME: dir, TMPDIR: dir, TEMP: dir, TMP: dir, LANG: 'C.UTF-8' }, wfEnv);
      for (const k of SECRET_ENV) if (process.env[k]) env[k] = process.env[k];
      Object.assign(env, { STEAM_PUBLISHER_KEY: 'offline', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: path.join(dir, '.summary-' + t + '.md'),
        RESETTLE_FX: fxPath, RESETTLE_LOG: logPath, RESETTLE_NOW_MS: String(snapAt + t * 5 * 60000) }, o.envExtra || {});
      const r = cp.spawnSync(process.execPath, ['-r', path.join(code, 'tools', 'resettle-steam.js'), 'validate.js'], { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 15 * 60000 });
      const out = (r.stdout || '') + (r.stderr || '');
      fs.writeFileSync(path.join(dir, '.tick-' + t + '.log'), out);
      runs.push({ t, code: r.status, out, summary: readJsonText(path.join(dir, '.summary-' + t + '.md')) });
      log('  ' + side + ' tick ' + t + ' (' + iso(snapAt + t * 5 * 60000) + '): exit ' + r.status);
    }
    sides[side] = { dir, runs, fx: readJson(fxPath, null), proc: new Set(readJson(path.join(dir, STATE.processed), [])), ap, flags: flagCells(dir) };
  }
  // report (pids only)
  const L = [];
  const A = sides.A, B = sides.B;
  L.push('resettle dry run: snapshot ' + (man.at || '?') + ', state ' + short(at) + ', code ' + short(cp.spawnSync('git', ['-C', code, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()) + ' (' + (cp.spawnSync('git', ['-C', code, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).stdout.trim() ? 'with local changes' : 'clean') + '), ' + o.ticks + ' tick(s) of 5 min');
  L.push('exit codes: A ' + A.runs.map((r) => r.code).join(',') + ' / B ' + B.runs.map((r) => r.code).join(','));
  L.push('reopened in B: ' + ((B.ap && B.ap.reopened.length) || 0) + ((B.ap && B.ap.unblocked.length) ? ', still-open later segments listed for the exemption: ' + B.ap.unblocked.length : '') + (B.ap && B.ap.skipped.length ? ', skipped ' + B.ap.skipped.map((s) => s[0] + ' (' + s[1] + ')').join('; ') : ''));
  // a co-op key settles as the session its rejection logged or not at all: other depths on the agreed record (a record rewritten
  //   since) are no settle of this list -- the key is held (dryVerdicts; cloud audit Q413 review 1, suggestion 1)
  const outcome = (m, depths) => {
    let last = 'not read (no record of it this run)';
    const settled = new RegExp('(endless|endless-comp|solo|couch) settle ' + m.replace(/[-]/g, '\\-') + ':');   // Q450: + the team competitive lane's line
    for (const r of B.runs) {
      let charged = false;
      for (const l of r.out.split('\n').filter((x) => x.indexOf(m) >= 0)) {
        const tv = teamLineOf(l, m);
        if (tv === 'fee') { charged = true; continue; }
        if (tv === 'catch-up') return 'settled as a catch-up (tick ' + r.t + '): the chain left as it is -- not this list\'s settle';
        if (settled.test(l)) {
          if (charged) return 'settled with the resume fee charged to the host (tick ' + r.t + '): nothing is to be taken';
          const dm = depths ? / depth (-?[0-9]+)->(-?[0-9]+)/.exec(l) : null;
          if (depths && (!dm || Number(dm[1]) !== depths[0] || Number(dm[2]) !== depths[1])) return 'settled at ' + (dm ? 'depth ' + dm[1] + '->' + dm[2] : 'depths the log line does not show') + ', not the listed ' + depths[0] + '->' + depths[1] + ' (tick ' + r.t + '): another record than the one rejected';
          return 'settled (tick ' + r.t + ')';
        }
        if (/REJECT|not settled|disagree/.test(l)) last = 'refused again: ' + l.trim().slice(0, 160);
        else if (/deferred|waiting|waits|left pending|held|grace|pacing/.test(l)) last = 'waiting: ' + l.trim().slice(0, 160);
      }
    }
    return last;
  };
  L.push('');
  L.push('keys (records on the snapshot\'s boards; what the reconcile did with them in B):');
  // forgery flags B wrote that A did not (signals.json fm cells, trust.json fl events): on a planned key the key is held
  //   (dryVerdicts), anywhere else the whole report is refused (cloud audit Q413 review 1, suggestion 2)
  const newFlags = new Map();
  for (const x of B.flags) if (!A.flags.has(x)) { const i = x.indexOf('|'), m = x.slice(i + 1); if (!newFlags.has(m)) newFlags.set(m, new Set()); newFlags.get(m).add(x.slice(0, 8)); }
  const planned = new Set(plan.keys.map((k) => k.m));
  const rows = [];
  for (const k of plan.keys) {
    const rr = recs[k.m] || [];
    const writers = [...new Set(rr.filter((x) => x.kind === 'settle').map((x) => pidOf(x.sid).slice(0, 8)))];
    const starts = rr.filter((x) => x.kind === 'start').length;
    const res = k.status !== 'ok' ? k.status + (k.why ? ' (' + k.why + ')' : '') : (writers.length ? outcome(k.m, k.lane === 'coop' ? k.depths : null) : 'records gone from the shards -- cannot be settled');
    const flagB = newFlags.has(k.m) ? [...newFlags.get(k.m)].join(' ') : null;
    rows.push(Object.assign({ m: k.m, set: k.set, lane: k.lane, listed: k.listed, kind: k.kind || (k.listed ? 'listed' : 'later'), status: k.status, writers, starts, result: res, processedA: A.proc.has(k.m), processedB: B.proc.has(k.m) }, flagB ? { flagB } : {}));
    L.push('  ' + k.set + ' ' + k.m + (k.listed ? '' : k.kind === 'unblocked' ? ' (still open, joins its run)' : ' (later)') + ': settle records ' + writers.length + (writers.length ? ' [' + writers.join(' ') + ']' : '') + ', start records ' + starts + ' -> ' + res + (flagB ? '  ** NEW FORGERY FLAG IN B (' + flagB + ') **' : ''));
  }
  const flagsOther = [...newFlags.keys()].filter((m) => !planned.has(m)).map((m) => ({ m, p: [...newFlags.get(m)].join(' ') }));
  const diff = boardDiff(A.fx, B.fx);
  const byBoard = {};
  for (const d of diff) (byBoard[d.board] = byBoard[d.board] || []).push(d);
  L.push('');
  L.push('board rows that differ between A (as is) and B (keys reopened), per board (account = pid; value A -> B):');
  for (const name of Object.keys(byBoard).sort()) {
    const ds = byBoard[name];
    L.push('  ' + name + ': ' + ds.length + ' row(s)' + (ds.some((d) => d.down) ? '  ** A VALUE WENT DOWN **' : ''));
    for (const d of ds.slice(0, 60)) L.push('    ' + pidOf(d.sid).slice(0, 8) + ' ' + d.a + ' -> ' + d.b + (d.a === d.b ? ' (details changed)' : '') + (d.down ? '  DOWN' : ''));
    if (ds.length > 60) L.push('    ... ' + (ds.length - 60) + ' more');
  }
  const onlyA = [...A.proc].filter((m) => !B.proc.has(m)), onlyBAll = [...B.proc].filter((m) => !A.proc.has(m));
  // a still-open later segment of a reopened run closes in B only by design (it was planned: kind 'unblocked', exempt, held unless
  //   it settled); anything else closed in B only is a key the reopen moved without the plan knowing -- the report is refused
  const unblockedSet = new Set(plan.keys.filter((k) => k.kind === 'unblocked' && k.status === 'ok').map((k) => k.m));
  const unblockedB = onlyBAll.filter((m) => unblockedSet.has(m)), onlyB = onlyBAll.filter((m) => !unblockedSet.has(m));
  L.push('');
  L.push('processed list: ' + onlyA.length + ' key(s) closed in A but open in B (reopened and still waiting), ' + unblockedB.length + ' still-open later segment(s) of a reopened run closed in B (planned, exempt), '
    + onlyB.length + ' closed in B only (should be none)' + (onlyB.length ? ': ' + onlyB.slice(0, 20).join(' ') : ''));
  const down = diff.filter((d) => d.down);
  L.push(down.length ? 'VALUES DOWN: ' + down.length + ' (look before applying)' : 'no board value goes down');
  L.push(flagsOther.length ? 'NEW FORGERY FLAGS IN B ON KEYS OUTSIDE THE PLAN: ' + flagsOther.map((x) => x.m + ' (' + x.p + ')').join(' ') : 'no new forgery flag in B outside the plan' + (rows.some((r) => r.flagB) ? ' (' + rows.filter((r) => r.flagB).length + ' planned key(s) flagged in B: held)' : ''));
  const exitBad = A.runs.concat(B.runs).filter((r) => r.code !== 0).length;
  if (exitBad) L.push('RUNS THAT DID NOT EXIT 0: ' + exitBad + ' (see the .tick-n.log files)');
  const freeRows = B.runs.map((r) => (/\| [^|\n]*continue debits not charged[^|\n]*\| ([^|\n]+) \|/.exec(r.summary) || [])[1]).filter(Boolean);
  if (freeRows.length) L.push('continue debits not charged (B, per tick): ' + freeRows.join(' / '));
  const text = L.join('\n') + '\n';
  fs.writeFileSync(path.join(work, 'report.txt'), text);
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify({ v: 2, at: short(at), snapshot: man.at || null, ticks: o.ticks, keys: rows, boards: Object.keys(byBoard).map((n) => ({ board: n, rows: byBoard[n].length, down: byBoard[n].filter((d) => d.down).length })),
    onlyA, unblockedB, onlyB, down: down.length, flagsOther, exit: { A: A.runs.map((r) => r.code), B: B.runs.map((r) => r.code) } }, null, 1));
  log(text);
  log('work directory (holds Steam IDs, keep it on this machine): ' + work);
  return { plan, rows, diff, down: down.length, onlyB, unblockedB, flagsOther, exitBad, work };
}
// Q450: what a validate.js log line says about team competitive key m beyond a settle: 'fee' (the host was charged the resume
//   fee: a resumed segment -- nothing is to be taken, the key is held), 'catch-up' (settled for the writers behind only, the chain
//   left as it is: not this list's settle), else null. The formats are validate.js's (test/resettle-team.js pins them).
function teamLineOf(l, m) {
  const esc = String(m).replace(/[-]/g, '\\-');
  if (new RegExp('endless-comp cp ' + esc + ': host \\S+ -[0-9]+ resume').test(l)) return 'fee';
  if (new RegExp('endless-comp catch-up ' + esc + ':').test(l)) return 'catch-up';
  return null;
}
function readJsonText(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } }

// ---- command line
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (!x.startsWith('--')) { a._.push(x); continue; }
    const eq = x.indexOf('=');
    if (eq > 0) { a[x.slice(2, eq)] = x.slice(eq + 1); continue; }
    const k = x.slice(2), nx = argv[i + 1];
    if (nx != null && !nx.startsWith('--') && ['set', 'keys', 'at', 'json', 'until-days', 'snap', 'code', 'repo', 'ticks', 'work', 'skip', 'from-dry'].indexOf(k) >= 0) { a[k] = nx; i++; } else a[k] = true;
  }
  return a;
}
function setList(s, all) {
  const names = String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const out = names.indexOf('all') >= 0 ? Object.keys(all) : names;
  for (const n of out) if (!all[n]) throw new Error('unknown list ' + n + ' (lists: ' + Object.keys(all).join(', ') + ')');
  return out;
}
function cleanState(G, files) {
  const r = cp.spawnSync('git', ['-C', G.repo, 'status', '--porcelain', '--'].concat(files), { encoding: 'utf8' });
  return r.stdout.trim();
}
function main(argv) {
  const a = parseArgs(argv), cmd = a._[0], log = (s) => console.log(s);
  const repo = path.resolve(a.repo || '.');
  if (!cmd || a.help) { const L = fs.readFileSync(__filename, 'utf8').split('\n').slice(2), n = L.findIndex((l) => !l.startsWith('//')); console.log(L.slice(0, n < 0 ? L.length : n).join('\n')); return cmd ? 0 : 2; }
  const G = makeGit(repo);
  if (cmd === 'plan' || cmd === 'apply') {
    const sets = setList(a.set, SETS);
    if (!sets.length) { console.error('--set o920 / o922 / q413 / q450 (comma separated, or all)'); return 2; }
    for (const s of sets) { const r = codeReady(repo, s); log('code: ' + s + ' needs ' + SETS[s].fix + (r.fix ? ' -- in this checkout' : ' -- NOT in this checkout') + (r.hook ? '' : '; the resettle hook is not in validate.js')); }
    if (cmd === 'apply') {
      const dirty = cleanState(G, [STATE.processed, STATE.solo, STATE.starts, RESETTLE]);
      if (dirty) { console.error('the state files have local changes -- start from a clean checkout of origin/main:\n' + dirty); return 1; }
      const bad = sets.filter((s) => !codeReady(repo, s).ok);
      if (bad.length) { console.error('refused: ' + bad.join(', ') + ' would be judged by the old rule again (its fix or the resettle hook is not in this checkout)'); return 1; }
    }
    const plan = planKeys(G, a.at || 'HEAD', sets, { dir: cmd === 'apply' ? repo : null, again: !!a.again });
    const skip = new Map(String(a.skip || '').split(',').map((x) => x.trim()).filter(Boolean).map((m) => [m, 'skipped by hand (--skip)']));
    if (cmd === 'apply') {
      if (a['from-dry']) {
        const rep = JSON.parse(fs.readFileSync(path.resolve(String(a['from-dry'])), 'utf8'));
        log('dry run: ' + String(a['from-dry']) + ' (snapshot ' + (rep.snapshot || '?') + ', state ' + (rep.at || '?') + ', ' + (rep.down | 0) + ' value(s) down, ' + ((rep.unblockedB || []).length) + ' still-open later segment(s) settled in B)');
        const gate = reportGate(rep);
        for (const w of gate.warn) log('warning: ' + w);
        if (gate.refuse.length) { console.error('refused: that dry run cannot be used -- ' + gate.refuse.join('; ') + ' (look at its report.txt)'); return 1; }
        for (const [m, why] of dryVerdicts(rep, plan)) if (!skip.has(m)) skip.set(m, why);
      } else if (!a['no-dry']) { console.error('apply needs --from-dry <work>/report.json (a dry run of these lists on the code that will run); --no-dry only if the user agreed to skip it'); return 2; }
      else log('warning: --no-dry: nothing checks that the keys settle, that no board value goes down, that no new flag is written -- only with the user\'s go-ahead');
    }
    holdKeys(plan, skip);
    printPlan(plan, log);
    if (a.json) fs.writeFileSync(path.resolve(String(a.json)), JSON.stringify(plan, null, 1));
    if (cmd === 'plan') return plan.counts.review || plan.counts.refused ? 1 : 0;
    if (a.at && G.resolve(a.at) !== G.resolve('HEAD')) { console.error('apply plans at HEAD only'); return 2; }
    if (!a.yes) { log('dry: nothing written (add --yes to edit the working tree)'); return 0; }
    const res = applyToDir(repo, plan, { untilDays: a['until-days'], again: !!a.again });
    log('reopened ' + res.reopened.length + ' key(s)' + (res.unblocked.length ? ', listed ' + res.unblocked.length + ' still-open later segment(s) for the exemption' : '') + (res.until ? ', no continue debits until ' + res.until : '') + (res.skipped.length ? '; skipped ' + res.skipped.map((s) => s[0] + ' (' + s[1] + ')').join('; ') : ''));
    log('next: git add ' + [STATE.processed, STATE.solo, STATE.starts, RESETTLE].join(' ') + ' && git commit (the reconcile job still paused), push, then enable the job');
    return res.skipped.length ? 1 : 0;
  }
  if (cmd === 'undo') {
    const dirty = cleanState(G, [STATE.processed, STATE.solo, RESETTLE]);
    if (dirty) { console.error('the state files have local changes:\n' + dirty); return 1; }
    const st = statusOf(repo);
    if (!st) { log('no ' + RESETTLE + ' here: nothing to undo'); return 0; }
    for (const r of st.rows) log('  ' + r.m + ': ' + r.how + ', ' + r.state);
    if (!a.yes) { log('dry: nothing written (add --yes)'); return 0; }
    const res = undoInDir(repo, {});
    log('re-closed ' + res.reclosed.length + ', already taken by the reconcile ' + res.taken.length + (res.released.length ? ', still-open later segments left as they are ' + res.released.length : '') + '; the continue exemption ends now');
    return 0;
  }
  if (cmd === 'status' || cmd === 'finish') {
    const st = statusOf(repo);
    if (!st) { log('no ' + RESETTLE + ' here'); return 0; }
    for (const r of st.rows) log('  ' + (r.set || '?') + ' ' + r.m + ': ' + r.how + ', ' + r.state);
    log('until ' + st.until + (st.expired ? ' (passed)' : '') + '; ' + st.rows.filter((r) => r.open).length + ' still open');
    if (cmd === 'status') return 0;
    if (!st.allClosed && !st.expired) { log('not yet: keys are still open and the exemption still runs (finish refuses)'); return 1; }
    if (!a.yes) { log('dry: would delete ' + RESETTLE + ' (add --yes); its history keeps the reopen-once guard'); return 0; }
    fs.rmSync(path.join(repo, RESETTLE));
    log('deleted ' + RESETTLE + ' (commit the deletion; git history keeps the list)');
    return 0;
  }
  if (cmd === 'flags') {
    const sets = setList(a.keys, FLAG_SETS);
    if (!sets.length) { console.error('--keys q413 / q407'); return 2; }
    const dirty = cleanState(G, [STATE.signals, STATE.trust]);
    if (dirty && a.yes) { console.error('signals.json / trust.json have local changes:\n' + dirty); return 1; }
    const bad = sets.filter((s) => !codeReady(repo, s).fix);
    if (bad.length) { console.error('refused: ' + bad.join(', ') + ' -- the fix is not on this checkout, the old rule would flag the same keys again'); return 1; }
    const keys = [].concat(...sets.map((s) => FLAG_SETS[s]));
    const r = flagsInDir(repo, keys);
    for (const x of r.rows) log('  ' + x.m + ': ' + (x.p ? x.p.slice(0, 8) + (x.fm ? ' fm cell removed' : ' (no fm cell)') + ', ' + x.ev + ' trust event(s) marked fp=review' : 'no flag on file'));
    log(r.rows.filter((x) => x.p).length + ' flag(s) on ' + keys.length + ' key(s)');
    if (!a.yes) { log('dry: nothing written (add --yes)'); return 0; }
    r.write();
    log('written: ' + STATE.signals + ' / ' + STATE.trust + ' (commit them with the reconcile job paused)');
    return 0;
  }
  if (cmd === 'dry-run') {
    if (!a.snap) { console.error('--snap <vault snapshot directory>'); return 2; }
    if (a['env-stdin']) {   // the job's secrets as JSON on stdin ({ env: {...} } as the vault's tier3-env holds them, or flat): never on disk
      const j = JSON.parse(fs.readFileSync(0, 'utf8'));
      const e = (j && j.env) || j || {};
      for (const k of SECRET_ENV) if (e[k] != null && e[k] !== '') process.env[k] = String(e[k]);
    }
    const sets = setList(a.set || 'all', SETS);
    const r = dryRun({ snap: path.resolve(String(a.snap)), code: a.code ? path.resolve(String(a.code)) : repo, repo, sets, ticks: Math.max(1, Math.min(48, Number(a.ticks) || 12)), work: a.work, at: a.at, anyCode: !!a['any-code'] });
    return r.down || r.onlyB.length || r.flagsOther.length || r.exitBad ? 1 : 0;
  }
  console.error('unknown subcommand ' + cmd);
  return 2;
}

module.exports = { SETS, FLAG_SETS, STATE, RESETTLE, KEY_RE, codeReady, teamLineOf, makeGit, listedBefore, closeOf, startFor, planKeys, holdKeys, dryVerdicts, reportGate, printPlan, applyToDir, undoInDir, statusOf, flagsInDir, flagCells, workflowEnv, loadSnapshot, recordsOf, boardDiff, dryRun, parseArgs };

if (require.main === module) {
  let code = 1;
  try { code = main(process.argv.slice(2)); } catch (e) { console.error('resettle-once: ' + (e && e.message || e)); code = 1; }
  process.exit(code);
}
