'use strict';
// ============================================================
// elp-newer-run.js -- 2026-11-24, the night the version 8 package went up: "a newer run" settles the run before it only when it is
//   of the same rules version or a later one (validate.js elpNewerRun / elpRunReady) -- an old-version run after it does not.
//   The bug: a player's first version 8 run and his old version 7 run (parked at a save point before the update) were first seen in
//   the same pass (the same instant). The old run sat after the new one in the list, so the new run counted as given up and settled
//   at the depth it had then -- a miss -- while it was still being played. Two players: -60 at depth 10 and -11 at depth 5; both
//   went on to 24, their line (architecture decision 10: never settle a run the player is still playing).
//   [1] elpNewerRun / elpRunReady / elpPendingSettles on small shapes: an old-version run after it (first seen in the same pass or
//       later) does not settle the run before it; a same- or newer-version run does, first seen in the same pass (every run a pass
//       first sees carries that pass's instant) or later; a parked run followed by a finished run of its version in one pass: both
//       settle in that pass; final / idle / a parked run alone as before. Q433 second draft (cloud audit 2026-11-25): a newer run
//       gives a run up once RATING.GIVEUP_MS passed after the later of its first sighting and the run's last segment
//       (elpGiveUpDue, test/elp-newer-grace.js) -- the shapes that give a run up are read that long after the pass
//   [2] replay of the real case (fixtures/elp-early-settle-1124.json: the two players' state before that pass, keys anonymised,
//       their new and old run as the pass first saw them): the pass at 14:03Z settles neither new run (nor the old run behind it);
//       once each ends at 24 (its final segment), each settles as a pass at T 24 (p1 +99, p2 +119), and the old runs settle exactly
//       as they did that night (p1 -54 at T 10, p2 -19 at T 8)
//   [3] static: elpRunReady decides "newer" through elpNewerRun alone (the list-position test is gone)
//   [4] mutations: back to "any run after it in the list" -> [1] and [2] red, the night's -60 / -11 coming back; a later
//       first-seen instant required as well (the first form of this fix -- the full suite's endless-rating [18] went red on it: every
//       run a pass first sees carries one instant, so it turned off the giving up of every run within one pass) -> [1] red, the
//       same-pass parked run and the finished run behind it held back until the player plays again
// ============================================================
process.env.ELP_PUB_VER = '8';
process.env.ELP_CUTOVER_MS = '1795527551733';
const fs = require('fs');
const os = require('os');
const path = require('path');

let failN = 0;
const T = (label, ok, detail) => { if (ok) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const FIXTURE = path.join(__dirname, 'fixtures', 'elp-early-settle-1124.json');
function load(src) {
  const m = src.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-newer-run-'));
  const p = path.join(dir, 'validate.js');
  fs.writeFileSync(p, m);
  try { return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const NEWER = 'newer = elpNewerRun(h, i)';
const OLD_NEWER = 'newer = i < h.runs.length - 1';

// [1] small shapes: [runId, depth, firstSeen, settled, d, T, lastMs, flags, seed]; flags 1 final, 2 parked, 4 v7, 16 v8
function shapes(v) {
  const t0 = 1795528957049, now = t0 + 60000, IDLE = v.RATING.IDLE_MS;
  const late = t0 + 5000 + v.RATING.GIVEUP_MS;   // Q433 second draft: a newer run gives the run up once its grace passed
  const run = (id, depth, seen, flags) => [id, depth, seen, 0, 0, 0, seen, flags, id];
  const H = (...runs) => ({ runs });
  return {
    sameInstantOld: !v.elpNewerRun(H(run(1, 10, t0, 16), run(2, 7, t0, 6)), 0) && !v.elpRunReady(H(run(1, 10, t0, 16), run(2, 7, t0, 6)), 0, now),
    oldBlockedBehind: JSON.stringify([...v.elpPendingSettles(H(run(1, 10, t0, 16), run(2, 7, t0, 6)), now)]) === '[]',
    samePassSame: v.elpNewerRun(H(run(1, 10, t0, 16), run(2, 3, t0, 16)), 0) && v.elpRunReady(H(run(1, 10, t0, 16), run(2, 3, t0, 16)), 0, late),
    samePassNewer: v.elpNewerRun(H(run(1, 10, t0, 4), run(2, 3, t0, 16)), 0),
    samePassParkedThenFinal: JSON.stringify([...v.elpPendingSettles(H(run(1, 10, t0, 18), run(2, 5, t0, 17)), late)]) === '[0,1]',
    laterOld: !v.elpNewerRun(H(run(1, 10, t0, 16), run(2, 7, t0 + 5000, 6)), 0),
    laterSame: v.elpNewerRun(H(run(1, 10, t0, 16), run(2, 3, t0 + 5000, 16)), 0) && v.elpRunReady(H(run(1, 10, t0, 16), run(2, 3, t0 + 5000, 16)), 0, late),
    laterNewer: v.elpNewerRun(H(run(1, 10, t0, 4), run(2, 3, t0 + 5000, 16)), 0),
    final: v.elpRunReady(H(run(1, 24, t0, 17), run(2, 7, t0, 6)), 0, now),
    idle: v.elpRunReady(H(run(1, 10, t0, 16)), 0, t0 + IDLE) && !v.elpRunReady(H(run(1, 10, t0, 16)), 0, t0 + IDLE - 1),
    parkedWaits: !v.elpRunReady(H(run(1, 10, t0, 18)), 0, t0 + IDLE),
  };
}
// [2] the night's case
const PASS1 = 1795529008000, PASS2 = 1795531100000;   // 14:03:28Z (the pass that settled them early) / 14:38:20Z
const ENDS = { p1: [3364412551, 24, 1795530699293], p2: [989832643, 24, 1795531002085] };
const OLDRUN = { p1: 2238780545, p2: 1726124978 };
function replay(v) {
  const st = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const runOf = (p, id) => st.hist[p + '|solo|0'].runs.find((x) => (x[0] >>> 0) === id);
  v.elpSettleAll(st, 0, PASS1);
  const p1 = { newR: runOf('p1', ENDS.p1[0]).slice(), oldR: runOf('p1', OLDRUN.p1).slice() }, p2 = { newR: runOf('p2', ENDS.p2[0]).slice(), oldR: runOf('p2', OLDRUN.p2).slice() };
  const pass1 = { p1, p2 };
  for (const p of ['p1', 'p2']) { const [id, depth, last] = ENDS[p]; const r = runOf(p, id); r[1] = depth; r[6] = last; r[7] = (r[7] | 0) | 1; }
  v.elpSettleAll(st, 0, PASS2);
  const pass2 = {};
  for (const p of ['p1', 'p2']) pass2[p] = { newR: runOf(p, ENDS[p][0]).slice(0, 9), oldR: runOf(p, OLDRUN[p]).slice(0, 9), lp: st.hist[p + '|all|0'].lp };
  return { pass1, pass2 };
}
function judge(v) {
  const s = shapes(v), r = replay(v);
  const n1 = r.pass1.p1.newR, n2 = r.pass1.p2.newR, q1 = r.pass2.p1, q2 = r.pass2.p2;
  return {
    s,
    pass1Open: n1[3] !== 2 && n2[3] !== 2 && r.pass1.p1.oldR[3] !== 2 && r.pass1.p2.oldR[3] !== 2,
    pass2Pass: q1.newR[3] === 2 && q1.newR[5] === 24 && q1.newR[4] === 99 && q2.newR[3] === 2 && q2.newR[5] === 24 && q2.newR[4] === 119,
    oldSame: q1.oldR[3] === 2 && q1.oldR[4] === -54 && q1.oldR[5] === 10 && q2.oldR[3] === 2 && q2.oldR[4] === -19 && q2.oldR[5] === 8,
    nightBack: n1[3] === 2 && n1[4] === -60 && n1[5] === 24 && n2[3] === 2 && n2[4] === -11 && n2[5] === 26,
    detail: JSON.stringify({ pass1: [n1.slice(0, 8), n2.slice(0, 8)], pass2: [q1, q2] }),
  };
}

console.log('-- [1] [2] the fix --');
const v = require('../validate.js');
const j = judge(v);
for (const k of Object.keys(j.s)) T('[1] ' + k, j.s[k]);
T('[2] the pass at 14:03Z settles neither new run, nor the old run waiting behind it', j.pass1Open, j.detail);
T('[2] each ends at 24 (final): a pass at T 24 -- p1 +99, p2 +119', j.pass2Pass, j.detail);
T('[2] the old runs settle as they did that night (p1 -54 at T 10, p2 -19 at T 8)', j.oldSame, j.detail);

console.log('-- [3] static --');
const rr = v.elpRunReady.toString();
T('[3] elpRunReady decides "newer" through elpNewerRun alone', rr.indexOf(NEWER) >= 0 && rr.indexOf('i < h.runs.length - 1') < 0);

console.log('-- [4] mutation: back to the list position --');
T('[4] the anchor is there', SRC.split(NEWER).length === 2);
const m = judge(load(SRC.split(NEWER).join(OLD_NEWER)));
T('[4] mutation turns [1] red (a same-instant old-version run settles the new one again)', !m.s.sameInstantOld);
T('[4] mutation turns [2] red, with the night\'s -60 (T 24) / -11 (T 26) coming back', !m.pass1Open && m.nightBack, m.detail);
const NARROW = 'for (let k = i + 1; k < h.runs.length; k++) if (elpRunVer(h.runs[k]) >= v) return true;';
const WIDE = 'for (let k = i + 1; k < h.runs.length; k++) if ((h.runs[k][2] || 0) > (h.runs[i][2] || 0) && elpRunVer(h.runs[k]) >= v) return true;';
T('[4] the second anchor is there', SRC.split(NARROW).length === 2);
const w = judge(load(SRC.split(NARROW).join(WIDE)));
T('[4] mutation "a later first-seen instant required" turns [1] red (a same-version run of the same pass gives nothing up; the parked run and the finished run behind it held back)', !w.s.samePassSame && !w.s.samePassParkedThenFinal);

if (failN) { console.log('FAIL (elp-newer-run) ' + failN); process.exit(1); } else console.log('ALL PASS (elp-newer-run)');
