'use strict';
// O1093 SHADOW (companion KNIFE_O1093 section 5 a): a ranked versus player's deserved points -- catch-up.js builds the table,
// validate.js publishes the number on the 4th int of his rating row and keeps it in his skill entry (`cu`), and logs what
// the catch-up rule would have added to a settled line. Nothing here may move a point: the rule itself comes with
// points-plan.js RULES_VER 3. (When it does, the shadow line goes and this file grows the rule's own checks.)
//   [1] the table, pure: hidden rank (ties share the better place), the points at that place, past the end of the board,
//       the ranked-games gate, a player ahead of his rating gets a number at or under his points (no pool)
//   [2] the ranked games of the career matrix: the ranked cells only
//   [3] the shadow reading of one line: only a strong side's compressed win, never past the deserved points, the floor
//       kept apart, a taxed unit marked
//   [4] over the REAL validate.js main() (offline board stub): a ranked 1V1 of a player first by hidden rating and fourth by
//       points -- his rating write carries [0xCB, plan rating, RULES_VER, the leader's points], his skill entry `cu`; his
//       opponent (3 ranked games) carries 0 and no `cu`; the points written are the ones of a run with CATCH_UP=off
//   [5] the next match, the state carried: the settle logs the line the rule would have raised (+20: the win 10 of 30) and
//       the run's summary counts it; the points written are again those of CATCH_UP=off (the shadow applies nothing)
//   [6] a rating write that failed waits and goes out again from the skill state with the same 4th int
//   [7] CATCH_UP=off: the 4th int stays 0 and a `cu` left in the state is dropped at the player's next rating write
//   [8] fail-open: the table throwing leaves the run settling as ever (exit 0, the same points, the int as it was)
//   [9] wiring: points-plan.js is not touched by the shadow (RULES_VER 2, ratingDetails still the constant 0); both rating
//       row builders go through ratingDet; the settle carries `cu` over its rebuild of the skill entry
//   [M] mutations, each must turn its check red
const fs = require('fs'), os = require('os'), path = require('path');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB.concat(['CATCH_UP'])) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const CU = require(path.join(H.ROOT, 'catch-up.js'));
const tsm = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

console.log('=== the deserved points of a ranked versus player: the shadow (O1093) ===');
// ---- [1] the table ----
// a board shaped like the live top (synthetic numbers): six players by points (points, hidden rating), plus a tail
const TOP = [[6400, 2160], [5800, 2280], [5500, 2100], [5450, 2150], [4800, 2120], [4700, 2180], [900, 1000], [600, 1000]];
const tableOn = (C) => C.tableOf(TOP.map((x) => ({ lp: x[0], hidden: x[1] })));
function pureOff(C) {
  const off = [], t = tableOn(C);
  const eq = (name, got, want) => { if (J(got) !== J(want)) off.push(name + ': ' + J(got) + ' != ' + J(want)); };
  eq('table', [t.n, t.lpDesc.slice(0, 3), t.hiddenDesc.slice(0, 3)], [8, [6400, 5800, 5500], [2280, 2180, 2160]]);
  eq('first by hidden -> the leader\'s points', C.desOf(t, 2280, 99), 6400);
  eq('second by hidden (6th by points) -> the points of place 2', C.desOf(t, 2180, 99), 5800);
  eq('the leader, third by hidden -> the points of place 3 (under his own: no pool)', C.desOf(t, 2160, 99), 5500);
  eq('a tie shares the better place', [C.hiddenRankOf(t, 1000), C.desOf(t, 1000, 99)], [7, 900]);
  eq('rated under everybody -> past the end of the board: none', [C.hiddenRankOf(t, 5), C.desOf(t, 5, 99)], [9, 0]);
  eq('rated above everybody -> place 1', [C.hiddenRankOf(t, 9999), C.desOf(t, 9999, 99)], [1, 6400]);
  eq('under ' + C.CATCH_MIN_GAMES + ' ranked games -> none', [C.desOf(t, 2280, C.CATCH_MIN_GAMES - 1), C.desOf(t, 2280, C.CATCH_MIN_GAMES)], [0, 6400]);
  eq('an empty table -> none', [C.desOf(C.tableOf([]), 2280, 99), C.desOf(null, 2280, 99), C.deservedOf([], 1)], [0, 0, 0]);
  eq('rows without a number are left out', C.tableOf([{ lp: 100, hidden: 1 }, { lp: NaN, hidden: 5 }, null, { lp: 50 }]).n, 1);
  // the invariant the user's call rests on: nobody's deserved points exceed the board's top, and a player whose points place
  //   is at or above his hidden place gets a number at or under his points
  let lcg = 20261127; const rnd = () => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return lcg / 4294967296; };
  for (let g = 0; g < 40; g++) {
    const rows = []; for (let i = 0; i < 60; i++) rows.push({ lp: Math.floor(rnd() * 8000), hidden: 900 + Math.floor(rnd() * 1500) });
    const tb = C.tableOf(rows);
    for (const r of rows) {
      const d = C.desOf(tb, r.hidden, 99), lpRank = 1 + rows.filter((q) => q.lp > r.lp).length, hRank = C.hiddenRankOf(tb, r.hidden);
      if (d > tb.lpDesc[0]) { off.push('above the top'); break; }
      if (lpRank <= hRank && d > r.lp) { off.push('a player ahead of his rating got a pool: ' + J([r, d, lpRank, hRank])); break; }
      if (lpRank > hRank && d < r.lp) { off.push('a player behind his rating got less than his points: ' + J([r, d, lpRank, hRank])); break; }
    }
  }
  return off;
}
{ const off = pureOff(CU); T('[1] the table: hidden rank, the points at that place, ties, the ends, the games gate, no pool for a player ahead of his rating', off.length === 0, off.join(' | ')); }
// ---- [2] ranked games ----
T('[2] ranked games = the ranked cells of the career matrix', CU.rankedGamesOf({ cm: { '0:1': [50, 1, 1, 1], '1:0': [12, 1, 1, 1], '1:3': [9, 1, 1, 1], '10:1': [7, 0, 0, 0], '4:0': [3, 0, 0, 0] } }) === 21
  && CU.rankedGamesOf({}) === 0 && CU.rankedGamesOf(null) === 0 && CU.rankedGamesOf({ cm: { '1:0': 'x' } }) === 0);
// ---- [3] the shadow reading of a line ----
function shadowOff(C) {
  const off = [], eq = (name, got, want) => { if (J(got) !== J(want)) off.push(name + ': ' + J(got) + ' != ' + J(want)); };
  const win = { adjDelta: 10, normalDelta: 30, why: ['expected'] };
  eq('a compressed win under the deserved points', C.shadowExtra(win, 4500, 6400), { extra: 20, low: 0, approx: false });
  eq('never past the deserved points', C.shadowExtra(win, 4500, 4507).extra, 7);
  eq('at or above the deserved points: nothing', [C.shadowExtra(win, 4500, 4500).extra, C.shadowExtra(win, 4500, 0).extra, C.shadowExtra(win, 4500, 4000).extra], [0, 0, 0]);
  eq('a fair win (no "expected"): nothing', C.shadowExtra({ adjDelta: 30, normalDelta: 30, why: [] }, 4500, 6400).extra, 0);
  eq('a win cut by another rule alone (a trio\'s tax in a fair match): nothing -- only the strong side\'s cut is waived', C.shadowExtra({ adjDelta: 22, normalDelta: 30, why: ['trio_tax'] }, 4500, 6400).extra, 0);
  eq('an upset loss, a weak side: nothing', [C.shadowExtra({ adjDelta: -11, normalDelta: -23, why: ['upset_loss'] }, 4500, 6400).extra, C.shadowExtra({ adjDelta: 30, normalDelta: 30, why: ['upset'] }, 4500, 6400).extra], [0, 0]);
  eq('under the floor: counted apart, not in the rule', C.shadowExtra({ adjDelta: 14, normalDelta: 33, why: ['expected'] }, 3900, 4400), { extra: 0, low: 19, approx: false });
  eq('a taxed unit is marked', [C.shadowExtra(win, 4500, 6400, true).approx, C.shadowExtra({ adjDelta: 5, normalDelta: 30, why: ['expected', 'couch_mult'] }, 4500, 6400).approx], [true, true]);
  eq('no plan row, a row without why', [C.shadowExtra(null, 4500, 6400).extra, C.shadowExtra({ adjDelta: 10, normalDelta: 30 }, 4500, 6400).extra], [0, 0]);
  return off;
}
{ const off = shadowOff(CU); T('[3] the shadow reading: only a strong side\'s compressed win, capped at the deserved points, the floor apart', off.length === 0, off.join(' | ')); }

// ---- the world of [4]-[8]: a ranked 1V1 over the real main() ----
const MIN = 60000, RATING = 6, POINTS = 7;
const A = H.SID(4901), B = H.SID(4902), E = H.SID(4903), C = H.SID(4904), D = H.SID(4905);
// A: first by hidden rating (his RANKED rating 2360; his stored one, 1960, would be third), fourth by points; E leads the board
const SKILL0 = () => ({ [v.pid(A)]: { mu: 30, sigma: 2, rm: 40, rv: 2 }, [v.pid(B)]: { mu: 25, sigma: 4 }, [v.pid(E)]: { mu: 36, sigma: 2 }, [v.pid(C)]: { mu: 33, sigma: 2 } });   // D: a points row with no skill entry
const XP0 = () => ({ [v.pid(A)]: { lastWinDay: 0, games: 40, cm: { '1:0': [25, 9000, 20, 5], '0:0': [15, 4000, 9, 6] } }, [v.pid(B)]: { lastWinDay: 0, games: 30, cm: { '1:0': [3, 900, 1, 2], '0:0': [27, 9000, 12, 15] } } });
const LP0 = () => ({ [A]: 4500, [B]: 2400, [E]: 6400, [C]: 5000, [D]: 4800 });
function play(hash, files, lp, env, script) {
  const ros = [A, B];
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, [0, 0]) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat === 0 ? 1 : 2, seat === 0, ros, [6100, 3000]) }));
  const boards = (recs) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: Object.keys(lp).map((s) => ({ steamID: s, score: lp[s] })) }, { id: 8, name: 'cp_bank', entries: [] }]);
  const rs = [];
  let state = null;
  for (const [ms, recs, e2] of [[0, S, null], [6 * MIN, S.concat(R), env && env.__settleEnv], [6 * MIN, S.concat(R), null]]) {
    const e = Object.assign({}, env || {}, e2 || {}); delete e.__settleEnv;
    const r = H.runCron(boards(recs), state ? H.advance(state, ms) : files, e, script || null, 'catch-up');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  const last = rs[rs.length - 1];
  return { rs, last, key: H.keyOf(S[0].d), out: rs.map((r) => r.out).join('') };
}
const ratingWrites = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, RATING, sid)));
const pointsWrites = (m, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, POINTS, sid))).map((w) => w.score);
const skillOf = (m, sid) => ((m.last.state.SKILL_FILE || {})[v.pid(sid)]) || null;
const settled = (m) => m.rs.every((r) => r.code === 0) && new Set(m.last.state.PROCESSED_FILE || []).has(m.key);
const planOf = (s) => tsm.displayRating(s.rm, s.rv);
const files0 = () => ({ SKILL_FILE: SKILL0(), XP_FILE: XP0() });

// ---- [4] the first match ----
const m1 = play(0xE101, files0(), LP0());
const m1off = play(0xE101, files0(), LP0(), { CATCH_UP: 'off' });
function firstOff(m) {
  const off = [];
  if (!settled(m)) return ['not settled: ' + m.last.out.slice(-400)];
  const wa = ratingWrites(m, A), sa = skillOf(m, A), wb = ratingWrites(m, B), sb = skillOf(m, B);
  if (!(wa.length === 1 && J(wa[0].details) === J([0xCB, planOf(sa), PP.RULES_VER, 6400]))) off.push('A\'s rating row: ' + J(wa) + ' (plan ' + (sa && planOf(sa)) + ')');
  if (!(sa && sa.cu === 6400)) off.push('A\'s skill entry: ' + J(sa));
  if (!(wb.length === 1 && J(wb[0].details.slice(2)) === J([PP.RULES_VER, 0]))) off.push('B\'s rating row: ' + J(wb));
  if (!(sb && !('cu' in sb))) off.push('B\'s skill entry: ' + J(sb));
  return off;
}
{ const off = firstOff(m1); T('[4] A (first by hidden rating, fourth by points, 26 ranked games): rating row [0xCB, plan, RULES_VER, 6400 = the leader\'s points] + skill cu; B (4 ranked games): 0, no cu', off.length === 0, off.join(' | ')); }
T('[4] the points written are the plan\'s own (A the strong side\'s compressed win +10, B the protected loss -7)', J(pointsWrites(m1, A)) === J([4510]) && J(pointsWrites(m1, B)) === J([2393]), J([pointsWrites(m1, A), pointsWrites(m1, B)]));
T('[4] ... and the ones of a run with CATCH_UP=off', settled(m1off) && J(pointsWrites(m1, A)) === J(pointsWrites(m1off, A)) && J(pointsWrites(m1, B)) === J(pointsWrites(m1off, B)));
T('[4] the run\'s summary line names the table (5 points rows, 4 at 4000 and up, 1 of them under his deserved points)', /catch-up \(shadow\): table of 5 points rows; 4 at 4000 and up, 1 of them under their deserved points \(1890 in all\); 2 rating row\(s\) this run, 1 published above the points of their player; the rule would have added 0 to 0 line\(s\) this run -- nothing applied/.test(m1.out), (m1.out.match(/catch-up[^\n]*/g) || []).join(' / '));
T('[4] no shadow line at the first match (no number was published before it)', !/catch-up \(shadow\) [0-9-]+_/.test(m1.out));
T('[4] a state without deserved points carries no `cu` at all (byte for byte the state of before)', !/"cu"/.test(m1off.last.raw.SKILL_FILE) && (m1.last.raw.SKILL_FILE.match(/"cu"/g) || []).length === 1);

// ---- [5] the next match, the state carried ----
const lp1 = Object.assign(LP0(), { [A]: 4510, [B]: 2393 });
const second = (env, script, st) => play(0xE102, st || m1.last.state, lp1, env, script);
const m2 = second(), m2off = play(0xE102, m1off.last.state, lp1, { CATCH_UP: 'off' });
const SHADOW_RE = /catch-up \(shadow\) \S+: \S+ pts 4510 deserved 6400, the win 10 of 30 -> the rule would add 20 -- NOT applied \(O1093\)/;
function secondOff(m) {
  const off = [];
  if (!settled(m)) return ['not settled: ' + m.last.out.slice(-400)];
  if (!SHADOW_RE.test(m.out)) off.push('no shadow line: ' + (m.out.match(/catch-up[^\n]*/g) || []).join(' / '));
  if (!/the rule would have added 20 to 1 line\(s\) this run -- nothing applied/.test(m.out)) off.push('the summary does not count it');
  return off;
}
{ const off = secondOff(m2); T('[5] the settle logs the line the rule would have raised (+20: the win 10 of 30, deserved 6400) and the summary counts it', off.length === 0, off.join(' | ')); }
const samePoints = (x, y) => J(pointsWrites(x, A)) === J(pointsWrites(y, A)) && J(pointsWrites(x, B)) === J(pointsWrites(y, B));
T('[5] the points written are again the plan\'s own and those of CATCH_UP=off: the shadow applies nothing', settled(m2off) && J(pointsWrites(m2, A)) === J([4520]) && samePoints(m2, m2off), J([pointsWrites(m2, A), pointsWrites(m2off, A), pointsWrites(m2, B), pointsWrites(m2off, B)]));
T('[5] A\'s row is published again with the number of this run\'s board', ratingWrites(m2, A).length === 1 && ratingWrites(m2, A)[0].details[3] === 6400 && skillOf(m2, A).cu === 6400, J(ratingWrites(m2, A)));

// ---- [6] a rating write that failed goes out again with the same int ----
{
  const m = play(0xE101, files0(), LP0(), { __settleEnv: { STUB_FAIL_POST: J({ rating: 500 }) } });
  const failed = H.postsOf(m.rs[1], RATING, A), again = H.postsOf(m.rs[2], RATING, A);
  T('[6] the write that failed and the one of the next run carry the same details (rebuilt from the skill state)', settled(m) && failed.length === 1 && again.length === 1
    && failed[0].details[3] === 6400 && J(again[0].details) === J(failed[0].details), J([failed, again]) + m.last.out.slice(-300));
}
// ---- [7] CATCH_UP=off ----
T('[7] CATCH_UP=off: the 4th int stays 0, no cu', settled(m1off) && ratingWrites(m1off, A).length === 1 && ratingWrites(m1off, A)[0].details[3] === 0 && !('cu' in skillOf(m1off, A)), J(ratingWrites(m1off, A)));
{
  const m = second({ CATCH_UP: 'off' });   // the state of [4] (A holds cu 6400), switched off
  T('[7] ... and a cu left in the state is dropped at the player\'s next rating write, his row back to 0, no shadow line', settled(m) && ratingWrites(m, A).length === 1 && ratingWrites(m, A)[0].details[3] === 0
    && !('cu' in skillOf(m, A)) && !/catch-up/.test(m.out) && samePoints(m, m2), J([ratingWrites(m, A), skillOf(m, A)]));
}

// ---- mutated copies of validate.js / catch-up.js ----
const ROOT = H.ROOT.replace(/\\/g, '/');
function mutant(pairs, file) {
  let m = fs.readFileSync(path.join(H.ROOT, file || 'validate.js'), 'utf8');
  for (const [good, bad] of pairs) { if (m.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80)); m = m.split(good).join(bad); }
  m = m.replace(/require\('\.\//g, "require('" + ROOT + '/').replace(/__dirname/g, JSON.stringify(ROOT));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catch-up-mut-'));
  const p = path.join(dir, file || 'validate.js'); fs.writeFileSync(p, m);
  return { path: p, mod: () => { delete require.cache[p]; return require(p); }, done: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} } };
}
// ---- [8] fail-open ----
{
  const mu = mutant([['const table = catchTab.tableOf(', 'const table = (() => { throw new Error(\'boom\'); })() || catchTab.tableOf(']]);
  try {
    const m = second(null, mu.path);
    T('[8] the table throwing: the run exits 0, the match settles, the same points, a warning, the number as it was', settled(m) && samePoints(m, m2) && /catch-up: the table could not be built \(boom\)/.test(m.out)
      && ratingWrites(m, A).length === 1 && ratingWrites(m, A)[0].details[3] === 6400 && skillOf(m, A).cu === 6400, m.last.out.slice(-500));
  } finally { mu.done(); }
}
// ---- [9] wiring ----
const VSRC = H.SRC, PSRC = fs.readFileSync(path.join(H.ROOT, 'points-plan.js'), 'utf8');
T('[9] the shadow leaves points-plan.js alone: RULES_VER 2, ratingDetails still writes the constant 0 (the companion repo\'s byte-locked copy)', PP.RULES_VER === 2 && J(PP.ratingDetails(1234)) === J([0xCB, 1234, 2, 0])
  && /function ratingDetails\(rating\) \{ return \[RATING_MAGIC, rating \| 0, RULES_VER, 0\]; \}/.test(PSRC));
const VCODE = VSRC.replace(/\/\/.*$/gm, '');
T('[9] both rating row builders go through ratingDet (no bare ratingDetails( call left in validate.js but its own)', (VCODE.match(/ratingDetails\(/g) || []).length === 1 && (VCODE.match(/det: ratingDet\(plan, cuOf\(/g) || []).length === 2
  && /function ratingDet\(plan, cu\) \{ const d = ratingDetails\(plan\); if \(\(cu \| 0\) > 0\) d\[3\] = cu \| 0; return d; \}/.test(VSRC));
T('[9] the table is built after the settles and before the rating rows are laid ahead and the state saved', VSRC.indexOf('const table = catchTab.tableOf(') > VSRC.indexOf('const ratingSids = Object.keys(changed);')
  && VSRC.indexOf('const table = catchTab.tableOf(') < VSRC.indexOf("for (const sid of ratingSids) rowLayAhead('rw', sid, ratingWriteOf(sid).disp);")
  && VSRC.indexOf("for (const sid of ratingSids) rowLayAhead('rw', sid, ratingWriteOf(sid).disp);") < VSRC.indexOf('saveSettled(true);'));
T('[9] the table reads the plan rating (the ranked rating, the stored one standing in), the settle\'s own choice', /const hiddenOf = \(sk\) => \{ const rr = rankedRatingOf\(sk\) \|\| /.test(VSRC));

// ---- [M] mutations ----
{
  // pure, catch-up.js
  const pure = [
    ['the games gate removed', [['(rankedGames | 0) < CATCH_MIN_GAMES', 'false']], (C) => pureOff(C).length > 0],
    ['ties take the worse place', [['if (a[mid] > h) lo = mid + 1;', 'if (a[mid] >= h) lo = mid + 1;']], (C) => pureOff(C).length > 0],
    ['the deserved points read off the place below', [['(lpDesc[k - 1] | 0)', '(lpDesc[k] | 0)']], (C) => pureOff(C).length > 0],
    ['the shadow counts every win (no "expected")', [["row.why.indexOf('expected') < 0", 'false']], (C) => shadowOff(C).length > 0],
    ['the shadow not capped at the deserved points', [['Math.min((row.normalDelta | 0) - (row.adjDelta | 0), d - cur)', '((row.normalDelta | 0) - (row.adjDelta | 0))']], (C) => shadowOff(C).length > 0],
    ['the shadow counts a player under the floor in the rule', [['if (cur >= CATCH_FLOOR) out.extra = more; else out.low = more;', 'out.extra = more;']], (C) => shadowOff(C).length > 0],
  ];
  for (const [name, pairs, isRed] of pure) {
    const mu = mutant(pairs, 'catch-up.js');
    let red = false;
    try { red = !!isRed(mu.mod()); } catch (e) { red = true; } finally { mu.done(); }
    T('[M] "' + name + '" turns its check red', red);
  }
  // over the real main() of a mutated validate.js
  const e2e = [
    ['the rating row no longer carries the number', [['if ((cu | 0) > 0) d[3] = cu | 0; return d;', 'return d;']], (p) => firstOff(play(0xE101, files0(), LP0(), null, p)).length > 0],
    ['the table reads the stored rating (the rating board\'s score) instead of the plan rating', [['const rr = rankedRatingOf(sk) || ((sk && Number.isFinite(sk.mu)', 'const rr = ((sk && Number.isFinite(sk.mu)']], (p) => firstOff(play(0xE101, files0(), LP0(), null, p)).length > 0],
    ['the settle drops cu when it rebuilds the skill entry', [['if (Number.isFinite(cu0) && cu0 > 0) ent.cu = cu0 | 0;', '']], (p) => secondOff(second(null, p)).length > 0],
    ['the shadow applies what it counts', [['if (sx.extra > 0) { catchRun.n++; catchRun.pts += sx.extra; }', 'if (sx.extra > 0) { catchRun.n++; catchRun.pts += sx.extra; lp[r.id] += sx.extra; changedLp[r.id] = lp[r.id]; }']], (p) => !samePoints(second(null, p), m2off)],
  ];
  for (const [name, pairs, isRed] of e2e) {
    const mu = mutant(pairs);
    let red = false;
    try { red = !!isRed(mu.path); } catch (e) { red = true; console.log('    (' + (e && e.message) + ')'); } finally { mu.done(); }
    T('[M] "' + name + '" turns its check red', red);
  }
}

console.log(failN ? ('catch-up: ' + failN + ' FAIL') : 'catch-up: all ok');
process.exit(failN ? 1 : 0);
