'use strict';
// O774 (2026-11-09): the plan rows say which rule shaped the delta (why), so the client's results page can label it.
//   [1] FFA mismatch: strong side won = expected, strong side lost = upset_loss, weak side won = upset, weak side lost = mismatch
//   [2] FFA with a live trio: the trio's win = trio_tax, a solo's loss = solo_shield (only when it is the binding factor)
//   [3] team match: weak team won = upset, strong team lost = upset_loss, strong team won = expected, a shielded loser = teammate_left
//   [4] a fair all-solo FFA has no plan (null), so no label; every label in the golden cases is one of the seven
//   [5] labels never move a number: the same match with why stripped equals the delta fields (adjDelta / flag / normalDelta / won)
//       of the row; mutation: a swapped label turns [1] red
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const load = (src) => { const w = {}; new Function('window', src)(w); return w.POINTS_PLAN; };
const KNOWN = ['upset', 'mismatch', 'expected', 'upset_loss', 'solo_shield', 'trio_tax', 'teammate_left'];

function checks(PP) {
  const out = {};
  // [1] 2-player ranked FFA (mt 2), spread 600 > RS_THRESHOLD
  const sWin = PP.reducedStakesPlan([{ steamID: 'S', seat: 0, mmr: 1600, rank: 1, lp: 300 }, { steamID: 'W', seat: 1, mmr: 1000, rank: 2, lp: 300 }], 2);
  const wWin = PP.reducedStakesPlan([{ steamID: 'S', seat: 0, mmr: 1600, rank: 2, lp: 300 }, { steamID: 'W', seat: 1, mmr: 1000, rank: 1, lp: 300 }], 2);
  out.expected = sWin && J(sWin.S.why) === J(['expected']);
  out.mismatch = sWin && J(sWin.W.why) === J(['mismatch']);
  out.upset = wWin && J(wWin.W.why) === J(['upset']);
  out.upsetLoss = wWin && J(wWin.S.why) === J(['upset_loss']);
  // [2] 4-player FFA, trio on seats 0..2 (trioAt = 1), no rating spread
  const trioParts = (trioRank) => [0, 1, 2].map((s) => ({ steamID: 'T' + s, seat: s, mmr: 1000, rank: trioRank, lp: 300 })).concat([{ steamID: 'X', seat: 3, mmr: 1000, rank: trioRank === 1 ? 4 : 1, lp: 300 }]);
  const tWin = PP.reducedStakesPlan(trioParts(1), 2, 0, 1);
  out.trioTax = tWin && J(tWin.T0.why) === J(['trio_tax']) && J(tWin.X.why) === J(['solo_shield']);
  // [3] 2V2 ranked true team (mt 6): team A seats 0,1 / team B seats 2,3
  const tp = (a, b) => [{ steamID: 'A0', seat: 0, mmr: a, lp: 300 }, { steamID: 'A1', seat: 1, mmr: a, lp: 300 }, { steamID: 'B0', seat: 2, mmr: b, lp: 300 }, { steamID: 'B1', seat: 3, mmr: b, lp: 300 }];
  const team = PP.teamLpPlan(tp(1000, 1600), 6, [0, 0, 0, 0], [], 0);   // weak team A wins
  out.teamUpset = team && J(team.A0.why) === J(['upset']) && J(team.B0.why) === J(['upset_loss']);
  const team2 = PP.teamLpPlan(tp(1600, 1000), 6, [0, 0, 0, 0], [], 0);   // strong team A wins
  out.teamExpected = team2 && J(team2.A0.why) === J(['expected']) && J(team2.B0.why) === J(['mismatch']);
  const shield = PP.teamLpPlan(tp(1000, 1000).filter((p) => p.seat !== 3), 6, [0, 0, 0, 0], [3], 0);   // B1 left, B0 shielded
  out.teammateLeft = shield && J(shield.B0.why) === J(['teammate_left']);
  // [4]
  out.fairNull = PP.reducedStakesPlan([{ steamID: 'A', seat: 0, mmr: 1000, rank: 1, lp: 300 }, { steamID: 'B', seat: 1, mmr: 1100, rank: 2, lp: 300 }], 2) === null;
  return out;
}

console.log('=== plan-why: O774 rule labels on plan rows ===');
const PP = load(SRC);
const c = checks(PP);
T('[1] FFA strong side won = expected', c.expected);
T('[1] FFA weak side lost = mismatch', c.mismatch);
T('[1] FFA weak side won = upset', c.upset);
T('[1] FFA strong side lost = upset_loss (its loss is cut to RS_STRONG_UPSET_LOSS)', c.upsetLoss);
T('[2] FFA with a live trio: trio win = trio_tax, solo loss = solo_shield', c.trioTax);
T('[3] team: weak team won = upset / strong team lost = upset_loss', c.teamUpset);
T('[3] team: strong team won = expected / weak team lost = mismatch', c.teamExpected);
T('[3] team: shielded loser = teammate_left', c.teammateLeft);
T('[4] a fair all-solo FFA has no plan (no label)', c.fairNull);
{
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'points-plan', 'cases.json'), 'utf8'));
  const seen = new Set(), unknown = [];
  JSON.stringify(doc, (k, v) => { if (k === 'why') { if (!Array.isArray(v)) unknown.push('not-array'); else v.forEach((w) => { seen.add(w); if (KNOWN.indexOf(w) < 0) unknown.push(w); }); } return v; });
  T('[4] every label in the golden cases is one of the seven' + (unknown.length ? ' -- ' + unknown.join(',') : ''), !unknown.length);
  T('[4] the golden cases cover all seven labels (' + [...seen].sort().join(',') + ')', KNOWN.every((k) => seen.has(k)));
}
// [5] labels never move a number: drop every why.push and the rows' numbers stay the same on the [1]-[3] matches
{
  const noWhy = load(SRC.replace(/why\.push\('[a-z_]+'\);?/g, 'void 0;').replace(/why\.push\(won \? 'expected' : 'upset_loss'\);/g, 'void 0;'));
  const runs = (P) => [
    P.reducedStakesPlan([{ steamID: 'S', seat: 0, mmr: 1600, rank: 1, lp: 300 }, { steamID: 'W', seat: 1, mmr: 1000, rank: 2, lp: 300 }], 2),
    P.reducedStakesPlan([0, 1, 2].map((s) => ({ steamID: 'T' + s, seat: s, mmr: 1000, rank: 1, lp: 300 })).concat([{ steamID: 'X', seat: 3, mmr: 1000, rank: 4, lp: 300 }]), 2, 0, 1),
    P.teamLpPlan([{ steamID: 'A0', seat: 0, mmr: 1000, lp: 300 }, { steamID: 'A1', seat: 1, mmr: 1000, lp: 300 }, { steamID: 'B0', seat: 2, mmr: 1600, lp: 300 }, { steamID: 'B1', seat: 3, mmr: 1600, lp: 300 }], 6, [0, 0, 0, 0], [], 0),
  ];
  const strip = (o) => J(o, (k, v) => (k === 'why' ? undefined : v));
  T('[5] removing the labels leaves every number of the rows the same', strip(runs(PP)) === strip(runs(noWhy)) && J(runs(noWhy)).indexOf('"expected"') < 0);
  const mut = load(SRC.replace("if (base > 0) why.push('expected');", "if (base > 0) why.push('upset_loss');"));
  const m = checks(mut);
  T('[5] mutation: strong-side win labelled upset_loss -> [1] red', SRC.indexOf("if (base > 0) why.push('expected');") >= 0 && !m.expected);
}
console.log(failN ? '\n' + failN + ' FAIL (plan-why)' : '\nplan-why: all ok');
process.exit(failN ? 1 : 0);
