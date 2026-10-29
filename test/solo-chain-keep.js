'use strict';
// cloud audit Q327 (R2-A3-01, 2026-10): the chain memory of an endless run that a save can still bring back outlives the 45 days.
//   pruneSolo dropped every run 45 days (COMP.RUN_TTL_MS) after its last settled segment, saves included -- but a casual or
//   classic save never expires (client knife 5.1a) and a competitive one lasts its season. A player back after a longer break
//   resumed a save whose run the job no longer knew: the resumed segment waited out its 7 days as chain-gap (casual / classic)
//   or save-orphan (competitive) and was rejected, and every later segment of the run with it. soloRunKept now keeps an entry
//   past the 45 days while a save can bring its run back (a proven checkpoint for casual, a proven depth for classic and for an
//   entry written before this change, an unused save point inside its season + the chain wait for competitive [an entry written
//   before this change WITH a save point included], a held segment for any); COMP.RUN_CAP is a fuse that forgets only entries
//   idle past the 45 days. Review round 1 (2026-10-27) added both bracketed parts: [1] legacy save points, [2] fuse inside 45 days.
//   [0] wiring pins + tripwires (every chain-memory delete goes through soloRunKept; a new resumable kind or segment flag must
//       get a keep rule)
//   [1] pure: soloRunKind / soloRunSeason / seasonEndMs / soloRunKept, every kind, solo and team keys
//   [2] pure: pruneSolo keeps and drops by the rule; the fuse forgets the oldest idle past the 45 days, never a run inside them;
//       soloAdvance records the kind
//   [3] per-season tripwire: in every season of SEASONS a competitive save made on its first day keeps its chain through its last
//       day and the chain wait after it, and is gone the day after (no season too long for the rule)
//   [4] pure: the replay defences ride along -- a used casual row after the break is still caught (save-reused, burnt), a used
//       competitive save point still refuses, a second depth-0 segment is still a restart
//   [5] main(): a casual run saved at depth 5, idle 100 days, resumes: the resumed segment settles (no chain wait)
//   [6] main(): a competitive run saved at depth 10, idle 50 days inside its season, resumes: settles once, save consumed, resume CP
//   [7] mutation self-check: a tree with the old code back (the 45-day line, no kind) fails [5] and [6] (chain-gap / save-orphan)
//   [8] the deploy: chain memory the old code wrote (no kind) and the new code meets after the break keeps its run
//   ([5] / [6] / [8]: a bystander's fresh segment in the first run after the break makes that run take the full path, which saves --
//   and so prunes -- the chain memory, as every live run does)
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), like test/solo-neg-duration.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'COMP_RUN_CAP', 'SOLO_DONE_CAP', 'COMP_CHAIN_WAIT_MS', 'SEASON_NOW'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const MIN = 60000, HOUR = 3600 * 1000, DAY = 86400000;
const TTL = v.COMP.RUN_TTL_MS, WAIT = v.COMP.CHAIN_WAIT_MS;
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const ASRC = fs.readFileSync(path.join(ROOT, 'attest.js'), 'utf8');

console.log('=== Q327: an endless run a save can still bring back keeps its chain memory past the 45 days ===');

// ---- [0] wiring pins + tripwires ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 120));
  T('[0] RUN_TTL_MS still 45 days, CHAIN_WAIT_MS 7 days, CKPT_EVERY 5 (the rule reads all three)', TTL === 45 * DAY && WAIT === 7 * DAY && v.COMP.CKPT_EVERY === 5,
    [TTL, WAIT, v.COMP.CKPT_EVERY].join(' / '));
  T('[0] RUN_CAP fuse defaults to 100000', v.COMP.RUN_CAP === 100000, String(v.COMP.RUN_CAP));
  pin('pruneSolo judges every run by soloRunKept', "    if (!soloRunKept(k, st.runs[k], nowMs, heldKeys, sNow)) delete st.runs[k];");
  pin('soloRunKept: a legacy entry with a save point takes the competitive rule', "  if (run.k == null && !Object.keys(run.saves || {}).length) return max >= 1;");
  pin('the fuse picks from runs idle past the 45 days only', "    const ks = Object.keys(st.runs).filter((k) => nowMs - (st.runs[k].t || 0) > COMP.RUN_TTL_MS);");
  pin('soloAdvance records the kind', "  run.k = Math.max(run.k == null ? 0 : (run.k | 0), soloRunKind(f));");
  pin('summary row', "'| endless runs idle past 45 days whose chain memory stays because a save can still bring them back / forgotten by the fuse (Q327) | ' + s('soloRunKept', 0) + ' / ' + s('soloRunFuse', 0) + ' |',");
  // tripwire: chain memory leaves in pruneSolo only (the rule + the fuse) -- another pruner would bring the bug back
  const dels = SRC.split('\n').filter((l) => /delete\s+st\.runs\[/.test(l) && !/^\s*\/\//.test(l));
  const i0 = SRC.indexOf('\nfunction pruneSolo('), body = i0 < 0 ? '' : SRC.slice(i0, SRC.indexOf('\n}\n', i0));
  T('[0] chain memory is deleted in pruneSolo only (the keep rule and the fuse; a new delete must go through soloRunKept, Q327)',
    dels.length === 2 && dels.every((l) => body.indexOf(l) >= 0), dels.map((l) => l.trim().slice(0, 100)).join(' || '));
  // tripwire: the resumable kinds soloChainPlan knows (casual token row, classic token row, competitive save point) -- a new one
  //   needs a keep rule in soloRunKept (how long can its save wait?)
  const kinds = SRC.match(/const \w+Resume = !!\(fl & attest\.SEG_RESUMED\)/g) || [];
  T('[0] soloChainPlan resumes casual / classic token rows and competitive save points only (a new kind: give soloRunKept a rule, Q327)',
    kinds.length === 2 && /casualResume/.test(kinds.join()) && /classicResume/.test(kinds.join()) && SRC.split("return waitOr('save-orphan')").length === 2, kinds.join(' | '));
  // tripwire: the segment flags soloRunKind sorts by -- a new run-kind flag decides how long its chain memory lives
  const segs = (ASRC.match(/^const SEG_[A-Z_]+ = /gm) || []).map((l) => l.slice(6, -3)).sort();
  T('[0] attest segment flags are the six soloRunKind knows (a new kind flag: decide its keep rule in soloRunKept, Q327)',
    JSON.stringify(segs) === JSON.stringify(['SEG_CASUAL', 'SEG_CLASSIC', 'SEG_COMP', 'SEG_FINAL', 'SEG_RESUMED', 'SEG_SUSPENDED']), segs.join(','));
}

// ---- [1] pure ----
const NOW = Date.UTC(2027, 0, 20, 12);           // inside season 1 (2026-12-01 .. 2027-03-01)
const OLD = NOW - 100 * DAY;                     // a run idle 100 days
const run = (o) => Object.assign({ max: 0, ms: 0, saves: {}, t: OLD }, o || {});
const SK = (season) => v.soloRunKey('p0', season, 4242);
const TK = (season) => 'T|a+b+c|' + season + '|4242';
{
  T('[1] soloRunKind: classic 2, casual 1, solo / team competitive 0', v.soloRunKind({ flags: A.SEG_CLASSIC }) === 2 && v.soloRunKind({ flags: A.SEG_CASUAL | A.SEG_RESUMED }) === 1 &&
    v.soloRunKind({ flags: A.SEG_SUSPENDED }) === 0 && v.soloRunKind({ flags: A.SEG_COMP | A.SEG_FINAL }) === 0 && v.soloRunKind({ flags: A.SEG_CLASSIC | A.SEG_SUSPENDED }) === 2);
  T('[1] soloRunSeason: solo and team keys', v.soloRunSeason(SK(1)) === 1 && v.soloRunSeason(SK(0)) === 0 && v.soloRunSeason(TK(2)) === 2 && v.soloRunSeason('T|a+b|0|-77') === 0);
  T('[1] seasonEndMs: each season ends at the next one\'s start, the last one never', v.SEASONS.every((s, i) => i + 1 < v.SEASONS.length ? v.seasonEndMs(s.id) === v.SEASONS[i + 1].start : v.seasonEndMs(s.id) === null) &&
    v.seasonEndMs(0) === v.SEASONS[0].start);
  const K = (key, r, now, held, sNow) => v.soloRunKept(key, r, now == null ? NOW : now, held, sNow);
  T('[1] inside the 45 days every run stays (no save, depth 0, any kind)', K(SK(1), run({ t: NOW - TTL })) && K(SK(1), run({ t: NOW - TTL, k: 0, final: 1 })) && K(TK(0), run({ t: NOW - 1, k: 1 })));
  T('[1] casual past the 45 days: kept with a proven checkpoint (max 5 / 37), dropped below it (max 4 / 0)',
    K(SK(0), run({ k: 1, max: 5 })) && K(SK(0), run({ k: 1, max: 37, final: 1 })) && !K(SK(0), run({ k: 1, max: 4 })) && !K(SK(0), run({ k: 1, max: 0 })));
  T('[1] classic past the 45 days (solo and team, 400 days): kept with a proven depth, dropped at depth 0',
    K(SK(0), run({ k: 2, max: 1, t: NOW - 400 * DAY })) && K(TK(0), run({ k: 2, max: 9, final: 1, t: NOW - 400 * DAY })) && !K(TK(0), run({ k: 2, max: 0 })));
  T('[1] no kind (written before Q327), no save point, past the 45 days: kept with a proven depth, dropped at depth 0', K(SK(0), run({ max: 3 })) && !K(SK(0), run({ max: 0 })));
  const sv = { '10': { t: OLD } }, used = { '10': { t: OLD, by: 'm1' } };
  {
    // review round 1, must-fix 2: a legacy entry with a save point is a competitive run (only a competitive segment records save
    //   points) -- kept like one, not forever: a competitive save written back after its season ended must not settle into it
    const e0L = v.seasonEndMs(0);
    T('[1] no kind WITH a save point past the 45 days (a competitive run written before Q327): the competitive rule -- kept inside its season with an unused save point (solo and team), dropped with every save used',
      K(SK(1), run({ max: 10, saves: sv })) && K(TK(1), run({ max: 10, saves: sv })) && !K(SK(1), run({ max: 10, saves: used })) && !K(TK(1), run({ max: 10, saves: used })),
      [K(SK(1), run({ max: 10, saves: sv })), K(TK(1), run({ max: 10, saves: sv })), K(SK(1), run({ max: 10, saves: used })), K(TK(1), run({ max: 10, saves: used }))].join(' / '));
    T('[1] no kind WITH a save point, season 0: kept 55 days idle before the season ends, kept through its end + chain wait + 1 day, dropped after (the probe L shape: 09-30 save, 12-20 resume)',
      K(SK(0), run({ max: 10, saves: sv, t: e0L - 60 * DAY }), e0L - 5 * DAY, null, e0L - 5 * DAY) &&
      K(SK(0), run({ max: 10, saves: sv, t: e0L - 60 * DAY }), e0L + WAIT + DAY, null, e0L + WAIT + DAY) &&
      !K(SK(0), run({ max: 10, saves: sv, t: e0L - 60 * DAY }), e0L + WAIT + DAY + 1, null, e0L + WAIT + DAY + 1) &&
      !K(SK(0), run({ max: 10, saves: sv, t: Date.UTC(2026, 8, 30) }), Date.UTC(2026, 11, 20), null, Date.UTC(2026, 11, 20)) &&
      !K(TK(0), run({ max: 10, saves: sv, t: Date.UTC(2026, 8, 30) }), Date.UTC(2026, 11, 20), null, Date.UTC(2026, 11, 20)));
  }
  T('[1] competitive past the 45 days inside its season: kept with an unused save point (solo and team)', K(SK(1), run({ k: 0, max: 10, saves: sv })) && K(TK(1), run({ k: 0, max: 10, saves: sv })));
  T('[1] competitive past the 45 days: dropped with the save used, with no save, when FINAL', !K(SK(1), run({ k: 0, max: 10, saves: used })) && !K(SK(1), run({ k: 0, max: 10 })) &&
    !K(SK(1), run({ k: 0, max: 10, saves: sv, final: 1 })));
  const e0 = v.seasonEndMs(0);
  T('[1] competitive season 0: kept through its end + chain wait + 1 day on the season clock, dropped after',
    K(SK(0), run({ k: 0, max: 10, saves: sv }), e0 + WAIT + DAY, null, e0 + WAIT + DAY) && !K(SK(0), run({ k: 0, max: 10, saves: sv }), e0 + WAIT + DAY + 1, null, e0 + WAIT + DAY + 1) &&
    K(SK(0), run({ k: 0, max: 10, saves: sv, t: e0 - 60 * DAY }), e0 + 2 * DAY, null, e0 + 2 * DAY));
  T('[1] the season part reads the season clock, not the wall clock', K(SK(0), run({ k: 0, max: 10, saves: sv }), e0 + 30 * DAY, null, e0 - DAY) &&
    !K(SK(0), run({ k: 0, max: 10, saves: sv }), e0 - DAY, null, e0 + 30 * DAY));
  T('[1] a run of a held segment stays whatever its kind', K(SK(1), run({ k: 0, max: 0 }), NOW, new Set([SK(1)])) && !K(SK(1), run({ k: 0, max: 0 }), NOW, new Set(['x'])));
}

// ---- [2] pruneSolo + soloAdvance ----
{
  const st = { runs: {
    [SK(1)]: run({ k: 1, max: 10 }), [v.soloRunKey('p1', 1, 1)]: run({ k: 1, max: 3 }), [v.soloRunKey('p2', 1, 2)]: run({ k: 0, max: 10, saves: { '10': { t: OLD } } }),
    [v.soloRunKey('p3', 1, 3)]: run({ k: 0, max: 10 }), [TK(0)]: run({ k: 2, max: 4 }), [v.soloRunKey('p4', 1, 4)]: run({ max: 2 }),
    [v.soloRunKey('p5', 1, 5)]: run({ k: 0, max: 0, t: NOW - DAY }), [v.soloRunKey('p6', 1, 6)]: run({ k: 0, max: 5 }) },
    wait: {}, ms: {}, held: { mh: { k: v.soloRunKey('p6', 1, 6), t0: NOW - DAY, t: NOW - HOUR } } };
  const realNow = Date.now;
  Date.now = () => NOW;   // pruneSolo reads the season clock (seasonNowMs: SEASON_NOW unset -> the wall clock)
  try { v.pruneSolo(st, NOW); } finally { Date.now = realNow; }
  const left = Object.keys(st.runs).sort();
  const want = [SK(1), v.soloRunKey('p2', 1, 2), TK(0), v.soloRunKey('p4', 1, 4), v.soloRunKey('p5', 1, 5), v.soloRunKey('p6', 1, 6)].sort();
  T('[2] pruneSolo keeps casual 10, competitive with a save, team classic, a legacy run with depth, a fresh run, a held run; drops casual 3 and a used-up competitive run',
    JSON.stringify(left) === JSON.stringify(want), left.join(' '));
  // the fuse
  const cap0 = v.COMP.RUN_CAP;
  try {
    v.COMP.RUN_CAP = 3;
    const st2 = { runs: {}, wait: {}, ms: {}, held: {} };
    for (let i = 0; i < 5; i++) st2.runs[v.soloRunKey('q' + i, 0, i)] = run({ k: 2, max: 7, t: NOW - (100 + i) * DAY });
    const warn = console.log; const seen = []; console.log = (s) => seen.push(String(s));
    try { v.pruneSolo(st2, NOW); } finally { console.log = warn; }
    const left2 = Object.keys(st2.runs).sort();
    T('[2] the fuse forgets the oldest past the cap (3 of 5 stay, the two oldest go)', JSON.stringify(left2) === JSON.stringify([0, 1, 2].map((i) => v.soloRunKey('q' + i, 0, i)).sort()), left2.join(' '));
    T('[2] the fuse warns', seen.some((s) => /endless chain memory 5 runs > cap 3/.test(s)), seen.join(' | ').slice(0, 300));
    // review round 1, must-fix 1: the fuse never forgets a run settled inside the 45 days (the code before Q327 kept it whatever
    //   the count) -- it only picks among runs idle past them, and warns either way
    const st4 = { runs: {}, wait: {}, ms: {}, held: {} };
    for (let i = 0; i < 5; i++) st4.runs[v.soloRunKey('r' + i, 1, i)] = run({ k: 1, max: 7, t: NOW - (i + 1) * DAY });
    const seen4 = []; console.log = (s) => seen4.push(String(s));
    try { v.pruneSolo(st4, NOW); } finally { console.log = warn; }
    T('[2] the fuse never forgets a run settled inside the 45 days (cap 3, five runs settled 1-5 days ago: all five stay) and still warns',
      Object.keys(st4.runs).length === 5 && seen4.some((s) => /endless chain memory 5 runs > cap 3 -- oldest 0 /.test(s)), Object.keys(st4.runs).length + ' | ' + seen4.join(' | ').slice(0, 300));
    const st5 = { runs: {}, wait: {}, ms: {}, held: {} };
    for (let i = 0; i < 4; i++) st5.runs[v.soloRunKey('n' + i, 1, i)] = run({ k: 1, max: 7, t: NOW - (i + 1) * DAY });
    for (let i = 0; i < 3; i++) st5.runs[v.soloRunKey('o' + i, 0, i)] = run({ k: 2, max: 7, t: NOW - (100 + i) * DAY });
    const st6 = { runs: {}, wait: {}, ms: {}, held: {} };
    for (let i = 0; i < 2; i++) st6.runs[v.soloRunKey('n' + i, 1, i)] = run({ k: 1, max: 7, t: NOW - (i + 1) * DAY });
    for (let i = 0; i < 3; i++) st6.runs[v.soloRunKey('o' + i, 0, i)] = run({ k: 2, max: 7, t: NOW - (100 + i) * DAY });
    console.log = () => {};
    try { v.pruneSolo(st5, NOW); v.pruneSolo(st6, NOW); } finally { console.log = warn; }
    const n5 = Object.keys(st5.runs).sort(), n6 = Object.keys(st6.runs).sort();
    T('[2] the fuse with both kinds: only runs idle past the 45 days go, oldest first (4 recent + 3 old, cap 3: the 3 old go, the 4 recent stay; 2 recent + 3 old, cap 3: the 2 oldest go)',
      JSON.stringify(n5) === JSON.stringify([0, 1, 2, 3].map((i) => v.soloRunKey('n' + i, 1, i)).sort()) &&
      JSON.stringify(n6) === JSON.stringify([v.soloRunKey('n0', 1, 0), v.soloRunKey('n1', 1, 1), v.soloRunKey('o0', 0, 0)].sort()), n5.join(' ') + ' || ' + n6.join(' '));
  } finally { v.COMP.RUN_CAP = cap0; }
  const st3 = { runs: {}, wait: {}, ms: {}, held: {} };
  const adv = (key, flags, sd, ed) => v.soloAdvance(st3, key, { startDepth: sd, endDepth: ed, flags }, 'm' + key + sd, { ok: true, proven: sd }, NOW);
  adv('c', A.SEG_CASUAL, 0, 5); adv('k', A.SEG_CLASSIC, 0, 3); adv('p', 0, 0, 5); adv('t', A.SEG_COMP | A.SEG_SUSPENDED, 0, 5);
  T('[2] soloAdvance records the kind (casual 1, classic 2, solo competitive 0, team competitive 0)', st3.runs.c.k === 1 && st3.runs.k.k === 2 && st3.runs.p.k === 0 && st3.runs.t.k === 0,
    JSON.stringify(st3.runs));
  st3.runs.l = { max: 5, ms: 0, saves: {}, t: NOW };   // written before Q327
  adv('l', A.SEG_CASUAL | A.SEG_RESUMED, 5, 7); adv('c', 0, 5, 6);
  T('[2] a legacy entry gets its kind on its next segment; a run never moves to a shorter-lived kind', st3.runs.l.k === 1 && st3.runs.c.k === 1, st3.runs.l.k + ' / ' + st3.runs.c.k);
}

// ---- [3] per-season tripwire ----
{
  const bad3 = [];
  for (const s of v.SEASONS.concat([{ id: 0, start: v.SEASONS[0].start - 120 * DAY }])) {
    const end = v.seasonEndMs(s.id);
    const last = end == null ? s.start + 400 * DAY : end - 1;
    const r = run({ k: 0, max: 10, saves: { '10': { t: s.start } }, t: s.start });
    const at = (t) => v.soloRunKept(SK(s.id), r, t, null, t);
    if (!at(last)) bad3.push('season ' + s.id + ': gone before its last day');
    if (end != null && !at(end + WAIT + DAY)) bad3.push('season ' + s.id + ': gone inside the chain wait after its end');
    if (end != null && at(end + WAIT + 2 * DAY)) bad3.push('season ' + s.id + ': still kept two days after the wait (past-season memory never goes)');
  }
  T('[3] every season: a competitive save from its first day keeps its chain through the season and the chain wait, then goes', bad3.length === 0, bad3.join('; '));
}

// ---- [4] the replay defences ride along ----
{
  const st = { runs: {}, wait: {}, ms: {}, held: {} };
  const key = SK(0), t0 = OLD;
  const seg = (sd, ed, flags, tag) => ({ startDepth: sd, endDepth: ed, flags, resumeTag: tag || 0, seasonId: 0, runSeed: 4242 });
  const go = (f, m, t) => { const p = v.soloChainPlan(st, key, f, m, t, { requireTag: false }); if (p.ok) v.soloAdvance(st, key, f, m, p, t); return p; };
  go(seg(0, 5, A.SEG_CASUAL), 'a', t0); go(seg(5, 7, A.SEG_CASUAL | A.SEG_FINAL), 'b', t0 + HOUR);
  const realNow = Date.now; Date.now = () => NOW;
  try { v.pruneSolo(st, NOW); } finally { Date.now = realNow; }
  const p1 = go(seg(5, 9, A.SEG_CASUAL | A.SEG_RESUMED, 0x123), 'c', NOW);
  T('[4] after 100 days the casual row resumes (the run kept)', p1.ok === true && p1.proven === 5 && p1.revive === true, JSON.stringify(p1));
  const p2 = v.soloChainPlan(st, key, seg(5, 8, A.SEG_CASUAL | A.SEG_RESUMED, 0x123), 'd', NOW + HOUR, { requireTag: false });
  T('[4] the same row written back for another session: save-reused, the run burnt', p2.ok === false && p2.reason === 'save-reused' && st.runs[key].burnt === 1, JSON.stringify(p2));
  const p3 = v.soloChainPlan(st, key, seg(0, 5, A.SEG_CASUAL), 'e', NOW + 2 * HOUR, { requireTag: false });
  T('[4] the burnt run settles nothing more', p3.ok === false && p3.reason === 'run-burnt', JSON.stringify(p3));
  const stC = { runs: {}, wait: {}, ms: {}, held: {} }, kc = SK(1), t1 = NOW - 60 * DAY;
  const goC = (f, m, t) => { const p = v.soloChainPlan(stC, kc, f, m, t, { requireTag: false }); if (p.ok) v.soloAdvance(stC, kc, f, m, p, t); return p; };
  goC(seg(0, 5, 0), 'x0', t1); goC(seg(5, 10, A.SEG_SUSPENDED), 'x1', t1 + HOUR);
  Date.now = () => NOW;
  try { v.pruneSolo(stC, NOW); } finally { Date.now = realNow; }
  const q1 = goC(seg(10, 12, A.SEG_RESUMED), 'x2', NOW);
  const q2 = v.soloChainPlan(stC, kc, seg(10, 11, A.SEG_RESUMED), 'x3', NOW + HOUR, { requireTag: false });
  const q3 = v.soloChainPlan(stC, kc, seg(0, 5, 0), 'x4', NOW + HOUR, { requireTag: false });
  T('[4] competitive after 60 days: the save point resumes once (consumed), a second resume of it is save-reused, a depth-0 replay is a restart',
    q1.ok === true && q1.consume === '10' && q2.ok === false && q2.reason === 'save-reused' && q3.ok === false && q3.reason === 'restart', [q1, q2, q3].map((x) => JSON.stringify(x)).join(' '));
}

// ---- main() harness (as test/solo-neg-duration.js) ----
function copyTree(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-chain-keep-' + tag + '-'));
  // another test's scratch file may be listed and gone by the time it is copied (test/root-listing.js, Q225)
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  return dir;
}
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('5d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099102701;
function addTestKey(dir) {
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
}
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(tree, boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-chain-keep-run-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1',
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const summary = fs.readFileSync(sumPath, 'utf8');
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// move every first-sighting / wait clock in the carried state back by ms (= ms of real time passed between two runs)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (st[k] && st[k].t0) st[k].t0 -= ms;
    if (st[k] && st[k].absentAt) st[k].absentAt -= ms;
    if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) { if (so.runs[k].t) so.runs[k].t -= ms; for (const d of Object.keys(so.runs[k].saves || {})) if (so.runs[k].saves[d].t) so.runs[k].saves[d].t -= ms; }
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
  }
  return files;
}
// steps: [[ms since the previous run, recs, tree of this run?], ...]
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs, stepTree] of steps) {
    const r = runCron(stepTree || tree, world(recs), state ? advance(state, ms) : null);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2000)); return true; };
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function startSolo(hash, sid, runSeed) {
  const p = sidPair(sid);
  return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]];
}
function signedSeg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed, 0, 1, 0, 1, 300, o.score == null ? 1000 : o.score, 0, lo, hi, o.sd, o.ed, 0, 0, 0, o.flags | 0,
    KEY_ID, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
const LB = { xp: 5, cp: 8, solo: 15, comp: 16 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: 14, name: 'endless_comp_trio', entries: [] }, { id: LB.solo, name: v.ENDLESS_LB_SOLO, entries: [] }, { id: LB.comp, name: v.ENDLESS_COMP_LB, entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] });
  return boards;
}
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const summaryKept = (r) => { const x = /\| endless runs idle past 45 days whose chain memory stays[^|]*\| (\d+) \/ (\d+) \|/.exec(r.summary || ''); return x ? Number(x[1]) : -1; };

// another player's fresh casual depth-0 segment (with its start): the first run after the break takes the full path and saves
function bystander(tag) {
  const X = SID(7900 + (A.hash32(tag) & 0xFFF)), RX = 790000 + (A.hash32(tag) & 0xFFF);
  const x = signedSeg({ sid: X, id: 'q327-by-' + tag, runSeed: RX, sd: 0, ed: 5, flags: A.SEG_CASUAL });
  return [{ sid: X, d: startSolo(x[3], X, RX) }, { sid: X, d: x }];
}
// the break and the resume: r3 (after the break) a bystander only, r4 the resumed session's start, r5 / r6 its segment
function breakSteps(pre, sid, b, rs0, gap, t) {
  const by = bystander(String(b[3])), st = { sid, d: startSolo(b[3], sid, rs0) };
  return [[gap, pre.concat(by), t[2]], [2 * HOUR, pre.concat(by, [st]), t[3]], [2 * HOUR, pre.concat(by, [st, { sid, d: b }]), t[4]], [2 * HOUR, pre.concat(by, [st, { sid, d: b }]), t[5]]];
}
// [5] casual: [0,5] settles, 100 days pass, the resumed [5,8] (its start, then the segment two hours later) settles
function caseCasual(tree, n, trees, gap) {
  const S = SID(7301 + n), RS = 733000 + n, t = trees || [];
  const a = signedSeg({ sid: S, id: 'q327-cas-a-' + n, runSeed: RS, sd: 0, ed: 5, flags: A.SEG_CASUAL });
  const b = signedSeg({ sid: S, id: 'q327-cas-b-' + n, runSeed: RS, sd: 5, ed: 8, flags: A.SEG_CASUAL | A.SEG_RESUMED | A.SEG_FINAL });
  const pre = [{ sid: S, d: startSolo(a[3], S, RS) }, { sid: S, d: a }];
  const rs = timeline(tree, [[0, pre, t[0]], [2 * HOUR, pre, t[1]]].concat(breakSteps(pre, S, b, RS, gap || 100 * DAY, t)));
  return { rs, ma: keyOf(a), mb: keyOf(b), S };
}
// [6] competitive: [0,5], [5,10] save & quit, 50 days pass (still season 0 on the season clock), the resumed [10,12] settles
function caseComp(tree, n, trees) {
  const S = SID(7401 + n), RS = 744000 + n, t = trees || [];
  const a = signedSeg({ sid: S, id: 'q327-comp-a-' + n, runSeed: RS, sd: 0, ed: 5 });
  const s = signedSeg({ sid: S, id: 'q327-comp-s-' + n, runSeed: RS, sd: 5, ed: 10, flags: A.SEG_SUSPENDED });
  const b = signedSeg({ sid: S, id: 'q327-comp-b-' + n, runSeed: RS, sd: 10, ed: 12, flags: A.SEG_RESUMED | A.SEG_FINAL });
  const pre = [{ sid: S, d: startSolo(a[3], S, RS) }, { sid: S, d: startSolo(s[3], S, RS) }, { sid: S, d: a }, { sid: S, d: s }];
  const rs = timeline(tree, [[0, pre, t[0]], [2 * HOUR, pre, t[1]]].concat(breakSteps(pre, S, b, RS, 50 * DAY, t)));
  return { rs, ma: keyOf(a), ms: keyOf(s), mb: keyOf(b), S };
}

const TREE = copyTree('fix');
addTestKey(TREE);
// ---- [5] ----
{
  const R = caseCasual(TREE, 0);
  if (!brk(R.rs, 6, '[5]')) {
    const rs = R.rs;
    T('[5] the casual run settles to depth 5 before the break', sum(rs.slice(0, 2), (r) => lines(r, R.ma, /solo settle /)) === 1);
    T('[5] after 100 days the run is still in the chain memory (kind 1, depth 5) and counted as kept', (() => { const so = rs[2].state.SOLO_FILE || {}; const k = Object.keys(so.runs || {}).find((x) => x.indexOf(v.pid(R.S) + '|') === 0); return k && so.runs[k].k === 1 && so.runs[k].max === 5; })() &&
      summaryKept(rs[2]) === 1, 'kept=' + summaryKept(rs[2]));
    T('[5] the resumed segment settles once, never waits for its chain, never rejected', sum(rs, (r) => lines(r, R.mb, /solo settle /)) === 1 && sum(rs, (r) => lines(r, R.mb, /waiting for its chain|chain REJECT/)) === 0,
      'settle=' + rs.map((r) => lines(r, R.mb, /solo settle /)).join('/') + ' wait=' + rs.map((r) => lines(r, R.mb, /waiting for its chain/)).join('/'));
  }
}
// ---- [6] ----
{
  const R = caseComp(TREE, 0);
  if (!brk(R.rs, 6, '[6]')) {
    const rs = R.rs;
    T('[6] the competitive run settles to its save at depth 10 before the break', sum(rs.slice(0, 2), (r) => lines(r, R.ma, /solo settle /) + lines(r, R.ms, /solo settle /)) === 2);
    T('[6] after 50 days the resumed segment settles once (the save point consumed, the resume CP taken once), never waits or rejects',
      sum(rs, (r) => lines(r, R.mb, /solo settle /)) === 1 && sum(rs, (r) => lines(r, R.mb, /waiting for its chain|chain REJECT/)) === 0 && sum(rs, (r) => lines(r, R.mb, /resume \(save@10\)/)) === 1,
      'settle=' + rs.map((r) => lines(r, R.mb, /solo settle /)).join('/') + ' wait=' + rs.map((r) => lines(r, R.mb, /waiting for its chain/)).join('/'));
  }
}
// ---- [7] mutation self-check: the old code back (the 45-day line, no kind) ----
const MUT = copyTree('mut');   // the old code: also the tree before the deploy in [8]
addTestKey(MUT);
{
  const fixLine = "    if (!soloRunKept(k, st.runs[k], nowMs, heldKeys, sNow)) delete st.runs[k];\n";
  const oldLine = "    if (nowMs - (st.runs[k].t || 0) > COMP.RUN_TTL_MS) delete st.runs[k];\n";
  const kindLine = "  run.k = Math.max(run.k == null ? 0 : (run.k | 0), soloRunKind(f));   // Q327: the run's save kind (0 competitive, 1 casual, 2 classic) decides how long its memory lives\n";
  if (SRC.split(fixLine).length !== 2 || SRC.split(kindLine).length !== 2) bad('[7] the fix lines were not found -- the mutant cannot be built');
  else {
    fs.writeFileSync(path.join(MUT, 'validate.js'), SRC.replace(fixLine, oldLine).replace(kindLine, ''));
    const M5 = caseCasual(MUT, 1), M6 = caseComp(MUT, 1);
    T('[7] mutant: [5] fails (the resumed casual segment waits for its chain: chain-gap, never settles)', M5.rs.length === 6 && sum(M5.rs, (r) => lines(r, M5.mb, /solo settle /)) === 0 &&
      sum(M5.rs, (r) => lines(r, M5.mb, /waiting for its chain \(chain-gap\)/)) >= 1);
    T('[7] mutant: [6] fails (the resumed competitive segment waits for its save: save-orphan, never settles)', M6.rs.length === 6 && sum(M6.rs, (r) => lines(r, M6.mb, /solo settle /)) === 0 &&
      sum(M6.rs, (r) => lines(r, M6.mb, /waiting for its chain \(save-orphan\)/)) >= 1);
  }
}
// ---- [8] the deploy: runs 1-2 on the old code, then the new one after the break ----
{
  const D = caseCasual(TREE, 2, [MUT, MUT, TREE, TREE, TREE, TREE], 60 * DAY);
  if (!brk(D.rs, 6, '[8]')) {
    const so = D.rs[1].state.SOLO_FILE || {}, k = Object.keys(so.runs || {}).find((x) => x.indexOf(v.pid(D.S) + '|') === 0);
    T('[8] the old code wrote the run without a kind', !!k && so.runs[k].k == null && so.runs[k].max === 5, JSON.stringify(k && so.runs[k]));
    T('[8] the new code keeps it after 60 days (no kind, proven depth) and the resumed segment settles', sum(D.rs, (r) => lines(r, D.mb, /solo settle /)) === 1 &&
      sum(D.rs, (r) => lines(r, D.mb, /waiting for its chain|chain REJECT/)) === 0, 'settle=' + D.rs.map((r) => lines(r, D.mb, /solo settle /)).join('/'));
  }
}
for (const d of [TREE, MUT]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (err) {} }
if (failN) { console.log('\n' + failN + ' FAILED'); process.exit(1); }
console.log('\nall passed');
