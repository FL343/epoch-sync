'use strict';
// Golden cases of points-plan.js (O480 R1): the visible points rules live in one self-contained module that the settle
// requires and the client runs as a comment-stripped copy (it replays the same cases in its schema lockstep test), so a
// number that moves on one side only turns one of the two suites red.
//   [1] fixtures/points-plan/cases.json is what tools/gen-points-fixtures.js generates from points-plan.js today
//   [2] FIXTURES_HASH in points-plan.js is the file's canonical hash; the file's rulesVer is RULES_VER
//   [3] every case replays to its out; the settle's own functions are the module's (validate.js exports them by identity)
//   [4] coverage: every case kind, and the situations the rules name, are present
//   [5] sensitivity: a knob moved through configure() moves a case, and configuring back restores every case
//   [6] the module loads the way the client loads it: comments stripped, new Function('window', src) -> window.POINTS_PLAN,
//       same outputs for every case
//   [7] the module stays self-contained: no require, no process.env, no clock, no block comment, ASCII-only code
const fs = require('fs');
const path = require('path');
for (const k of ['RS_THRESHOLD', 'RS_UPSET_BONUS', 'RS_STRONG_UPSET_LOSS', 'RS_SOLO_VS_TRIO', 'RS_TRIO_WIN', 'LEAVER_LP_PENALTY']) delete process.env[k];
const ROOT = path.join(__dirname, '..');
const PP = require(path.join(ROOT, 'points-plan.js'));
const v = require(path.join(ROOT, 'validate.js'));
const G = require(path.join(ROOT, 'tools', 'gen-points-fixtures.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const text = fs.readFileSync(G.FILE, 'utf8');
const doc = JSON.parse(text);

console.log('=== points-plan golden cases (O480) ===');
// [1]
T('[1] the case file is what the generator gives today (node tools/gen-points-fixtures.js to regenerate)', G.render(G.build(PP)) === text);
T('[1] the generator lists every case of the file, in order', J(doc.cases.map((c) => c.name)) === J(G.CASES.map((c) => c.name)), doc.cases.length + ' vs ' + G.CASES.length);
// [2]
T('[2] FIXTURES_HASH = canonical hash of the case file', PP.FIXTURES_HASH === G.canonHash(text), PP.FIXTURES_HASH + ' vs ' + G.canonHash(text));
T('[2] the case file carries RULES_VER', doc.rulesVer === PP.RULES_VER && Number.isInteger(PP.RULES_VER) && PP.RULES_VER >= 1, doc.rulesVer + ' vs ' + PP.RULES_VER);
// [3]
const replayAll = (M) => doc.cases.map((c) => J(G.replay(M, Object.assign({ kind: c.kind }, c.in))));
const want = doc.cases.map((c) => J(c.out));
{
  const got = replayAll(PP), off = [];
  got.forEach((g, i) => { if (g !== want[i]) off.push(doc.cases[i].name); });
  T('[3] every case replays to its out (' + doc.cases.length + ' cases)', !off.length, off.slice(0, 5).join(' | '));
}
for (const k of ['lpSeg', 'lpDelta', 'seedLp', 'softResetLp', 'seasonSeedLp', 'boundaryOf', 'crosslineDelta', 'reducedStakesPlan', 'teamLpPlan', 'leaverLpPenalty', 'appliesLp', 'isTeamMt', 'baseMt', 'premadeMaskOf', 'premadeTrioAtOf', 'teamSizeOfMt', 'teamOfSeat'])
  if (v[k] !== PP[k]) bad('[3] validate.js ' + k + ' is not the module\'s function');
T('[3] the settle\'s exported rules are the module\'s own (identity)', ['LP_SEG', 'LP_SEED', 'SOFT_RESET', 'reducedStakesPlan', 'teamLpPlan', 'lpDelta', 'crosslineDelta'].every((k) => v[k] === PP[k]));
const VSRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
T('[3] the settle composes its plan and its points line through the module (matchPlan / settleLine)',
  /const rsPlan = matchPlan\(planIn, matchType, \{/.test(VSRC) && /const sl = settleLine\(cur, rs, rankOf\[r\.id\], parts\.length, seededNow\.has\(r\.id\)\);/.test(VSRC)
  && /return settleLine\(cur, rs, r\.rank \| 0, n, /.test(VSRC));
// [4]
{
  const kinds = new Set(doc.cases.map((c) => c.kind));
  T('[4] all four kinds present', ['match', 'seed', 'leave', 'boundary'].every((k) => kinds.has(k)), [...kinds].join(','));
  const m = doc.cases.filter((c) => c.kind === 'match');
  const rows = [];
  for (const c of m) for (const id of Object.keys(c.out)) rows.push(Object.assign({ c, id }, c.out[id]));
  const sizes = new Set(m.filter((c) => !PP.isTeamMt(c.in.mt)).map((c) => c.in.parts.length));
  T('[4] FFA matches of 2..6 rated players', [2, 3, 4, 5, 6].every((n) => sizes.has(n)), [...sizes].join(','));
  T('[4] a premade pair and a premade trio', m.some((c) => PP.premadeMaskOf(c.in.mt)) && m.some((c) => PP.premadeTrioAtOf(c.in.mt)));
  T('[4] team codes 4, 6 and 9', [4, 6, 9].every((t) => m.some((c) => PP.baseMt(c.in.mt) === t)));
  T('[4] UPSET and PROTECTED rows', rows.some((r) => r.plan && r.plan.flag === 1) && rows.some((r) => r.plan && r.plan.flag === 2));
  T('[4] a promotion and a relegation forced by the series clamp', rows.some((r) => r.d > r.d0) && rows.some((r) => r.d < r.d0));
  T('[4] a seeded player (series clamp skipped)', m.some((c) => c.in.parts.some((p) => p.seeded)));
  T('[4] both board bounds hit', rows.some((r) => r.nv === PP.LP_MAX) && rows.some((r) => r.nv === 0 && r.d < 0));
  T('[4] seeds with and without a previous season row', doc.cases.some((c) => c.kind === 'seed' && c.in.prev == null) && doc.cases.some((c) => c.kind === 'seed' && c.in.prev != null));
  T('[4] team rows with leaver seats, absent rows and finished rows', m.some((c) => c.in.team && (c.in.team.leaverSeats || []).length) && m.some((c) => c.in.team && c.in.team.absent) && m.some((c) => c.in.team && c.in.team.finished));
}
// [5]
{
  const base = replayAll(PP);
  const moved = (o) => { PP.configure(o); const r = replayAll(PP); PP.configure({}); return r.filter((x, i) => x !== base[i]).length; };
  T('[5] RS_TRIO_WIN 0.5 moves a case', moved({ RS_TRIO_WIN: 0.5 }) > 0);
  T('[5] RS_THRESHOLD 500 moves a case', moved({ RS_THRESHOLD: 500 }) > 0);
  T('[5] LEAVER_LP_PENALTY 99 moves a case', moved({ LEAVER_LP_PENALTY: 99 }) > 0);
  T('[5] configure({}) restores every case and every knob', J(replayAll(PP)) === J(want) && Object.keys(PP.DEFAULTS).every((k) => PP[k] === PP.DEFAULTS[k]));
  T('[5] configure reads a missing / empty value as the default, "0" as zero', J(PP.configure({ RS_THRESHOLD: '', RS_TRIO_WIN: '0' })) === J(['RS_TRIO_WIN']) && PP.RS_THRESHOLD === 400 && PP.RS_TRIO_WIN === 0);
  PP.configure({});
}
// [6] the client's way of loading it (the strip below is the client vendor generator's line strip)
function strip(src) {
  const out = [];
  for (const raw of String(src).split(/\r?\n/)) {
    let line = raw, inS = null, cut = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inS) { if (ch === '\\') { i++; continue; } if (ch === inS) inS = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { inS = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') { cut = i; break; }
    }
    if (cut >= 0) line = line.slice(0, cut);
    line = line.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    out.push(line);
  }
  return out.join('\n') + '\n';
}
const SRC = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
const code = strip(SRC);
{
  const win = {};
  let err = null;
  try { new Function('window', code)(win); } catch (e) { err = e; }
  T('[6] the stripped copy loads with new Function(\'window\', src) onto window.POINTS_PLAN', !err && win.POINTS_PLAN && typeof win.POINTS_PLAN.matchPlan === 'function', err && err.message);
  if (win.POINTS_PLAN) T('[6] the stripped copy replays every case to its out', J(replayAll(win.POINTS_PLAN)) === J(want));
  if (win.POINTS_PLAN) T('[6] the stripped copy carries the same RULES_VER and FIXTURES_HASH', win.POINTS_PLAN.RULES_VER === PP.RULES_VER && win.POINTS_PLAN.FIXTURES_HASH === PP.FIXTURES_HASH);
}
// [7]
T('[7] no require, no process, no clock in the module code', !/\brequire\s*\(|\bprocess\b|\bDate\b|\bperformance\b/.test(code));
T('[7] no block comment in the module (the client copy strips // lines only)', !/\/\*/.test(SRC));
T('[7] ASCII-only module code', !/[^\x00-\x7f]/.test(code));

console.log(failN ? ('points-plan-fixtures: ' + failN + ' FAIL') : 'points-plan-fixtures: all ok');
process.exit(failN ? 1 : 0);
