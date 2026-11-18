'use strict';
// O717 placement matches of a season (companion mvp/KNIFE_O717_SEASON_PLACEMENT_PLAN.md of the client repo, sections 3.1-3.3, 7):
//   from season 1 on every player's first PLACEMENT_TARGET (3 since 2026-11-18) settled matches of a season are placement matches -- the promotion
//   series as ever, NO relegation series, the points held under the master line (PLACE_CAP 5999) -- counted on his row's receipt
//   ring (points-plan.js placementOf; validate.js placementMode). The preseason (season 0) keeps its rules.
//   [1] the season gate: placementMode never places in season 0; season 1 places a player whose ring holds fewer than 5 settled
//   [2] the relegation band, a bottom-half finish: placing takes the natural delta, a placed player is forced down
//   [3] the promotion band, a top-half finish: placing goes up to min + PROMO_LAND as ever
//   [4] the cap: 5940 (the master / grandmaster landing) winning five placement matches stays <= 5999; the sixth crosses into master
//   [5] seeded and placing on one settle: the seed settle wins (no clamp, no cap); the boolean form of the calls before O717 reads
//       as the mode object (true = { seeded }, false = neither) over random inputs
//   [6] the count: VOID / LEAVE entries do not count, a confession fine (LEAVE | SEEDED) does not count, a full ring without its
//       seed entry is placed, a row with no ring is placed
//   [7] (client repo: test/rank-gate.js [3] and test/ledger-schema-lockstep.js §21 replay the same rows through its rowPlacement)
//   [8] the real job (stubbed Steam): one season 1 match settles a placing player in the relegation band naturally while a placed
//       one is forced down, holds a placing diamond at 5999 while a placed one is promoted; the same match in the preseason settles
//       by the old rules; two matches of one player in one run: the first one's receipt counts (his 5th placement match, then a
//       normal one)
//   [9] class: every settleLine call of validate.js passes a mode read through the placement rules (lineMode / placementMode /
//       a placing set), and no settle path computes a series clamp of its own (no crosslineDelta call)
//   mutations: each guard turns red on the change it guards against
const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const F = PP.RECEIPT_F;
// a row's details carrying a receipt ring of these flags, newest first
const ringDet = (M, flags) => M.lpDetails(null, flags.map((f, i) => ({ mh: 5100 + i, delta: 10, flags: (f | 0) | ((M.RULES_VER & 0xffff) << 8) })));
const SETTLED = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(i === n - 1 ? F.SEEDED : 0); return a; };   // n settled, the oldest seeded
const line = (M, cur, d0, won, mode) => M.settleLine(cur, { adjDelta: d0, flag: 0, won }, 0, 0, mode);

// ---- the checks, as functions of a module (the mutations below rerun them on edited copies) ----
function relegErrors(M) {
  const errs = [];
  for (const min of [600, 2000, 3000, 4000, 6000]) for (let off = 0; off <= M.BOUNDARY_MARGIN; off += 20) for (const d0 of [-25, -17, -5, -1]) {
    const cur = min + off;
    const p = line(M, cur, d0, false, { placing: true }), n = line(M, cur, d0, false, { placing: false });
    if (p.d !== d0 || p.clamped) errs.push(['placing forced', cur, d0, p.d]);
    if (n.nv > min - M.RELEG_LAND) errs.push(['placed not forced', cur, d0, n.nv]);
  }
  return errs;
}
function promoErrors(M) {
  const errs = [];
  for (const next of [600, 2000, 3000, 4000]) for (let off = 1; off <= M.BOUNDARY_MARGIN; off += 17) for (const d0 of [1, 9, 30]) {
    const cur = next - off;
    const p = line(M, cur, d0, true, { placing: true });
    if (p.nv !== Math.max(cur + d0, next + M.PROMO_LAND) || !p.clamped || p.capped) errs.push(['placing promo', cur, d0, p.nv]);
  }
  return errs;
}
// five placement wins from the season-turn landing of master / grandmaster (5940), then the sixth as a placed player
function capRun(M) {
  let lp = 5940; const seen = [];
  for (let k = 0; k < 5; k++) { lp = M.settleLine(lp, null, 1, 2, { placing: true }).nv; seen.push(lp); }
  const six = M.settleLine(lp, null, 1, 2, { placing: false }).nv;
  return { seen, six };
}
function capErrors(M) {
  const errs = [];
  const r = capRun(M);
  if (r.seen.some((x) => x > 5999) || r.seen[4] !== 5999) errs.push(['five', r.seen]);
  if (r.six !== 6000 + M.PROMO_LAND) errs.push(['sixth', r.six]);
  for (let cur = 5880; cur <= 5999; cur += 7) for (const d0 of [1, 30, 60, 200]) {
    const p = line(M, cur, d0, true, { placing: true });
    if (p.nv > 5999) errs.push(['over', cur, d0, p.nv]);
  }
  const top = line(M, 6100, 23, true, { placing: true });   // already over the cap (out of reach from a season turn): never pushed down
  if (top.nv !== 6100 || !top.capped) errs.push(['over the cap', top.nv]);
  return errs;
}
// seeded + placing = seeded alone; the boolean form = the mode object (random plans, ranks, points)
function seedErrors(M) {
  const errs = [];
  let s = 7177;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 4000; i++) {
    const cur = Math.floor(rnd() * 10000), pc = 2 + Math.floor(rnd() * 5), rank = 1 + Math.floor(rnd() * pc);
    const plan = rnd() < 0.5 ? null : { adjDelta: Math.round(rnd() * 120 - 60), flag: rnd() < 0.2 ? 2 : (rnd() < 0.2 ? 1 : 0), won: rnd() < 0.5 };
    const a = J(M.settleLine(cur, plan, rank, pc, true)), b = J(M.settleLine(cur, plan, rank, pc, { seeded: true }));
    const c = J(M.settleLine(cur, plan, rank, pc, { seeded: true, placing: true }));
    const e = J(M.settleLine(cur, plan, rank, pc, false)), f = J(M.settleLine(cur, plan, rank, pc, { seeded: false, placing: false })), g = J(M.settleLine(cur, plan, rank, pc));
    if (a !== b || a !== c) { errs.push(['seeded', cur, rank, pc, a, c]); if (errs.length > 3) break; }
    if (e !== f || e !== g) { errs.push(['plain', cur, rank, pc, e, f]); if (errs.length > 3) break; }
  }
  const hi = M.settleLine(5990, null, 1, 2, { seeded: true, placing: true });   // the seed settle is not capped (seeded wins)
  if (hi.capped || hi.nv !== 5990 + M.lpDelta(5990, 1, 2)) errs.push(['seeded capped', hi.nv]);
  return errs;
}
function countErrors(M) {
  const errs = [];
  // the counting cases name their target (5: the cases as first written); the last two read the default (PLACEMENT_TARGET)
  const P = (flags, t) => M.placementOf(ringDet(M, flags), t == null ? 5 : t), TG = M.PLACEMENT_TARGET;
  const c = [
    [P(SETTLED(4)), false, 4], [P(SETTLED(5)), true, 5], [P([F.VOID, F.LEAVE, 0, 0, 0, F.SEEDED]), false, 4],
    [P([0, 0, 0, F.SEEDED | F.LEAVE]), false, 3], [P([F.VOID, F.VOID, F.VOID, F.VOID, 0, 0, 0, 0]), true, null],
    [P([F.VOID, F.VOID, F.VOID, F.VOID, 0, 0, 0, F.SEEDED]), false, 4], [M.placementOf([]), true, null], [M.placementOf(null), true, null],
    [P(SETTLED(3), 3), true, 3],
    [M.placementOf(ringDet(M, SETTLED(TG - 1))), false, TG - 1], [M.placementOf(ringDet(M, SETTLED(TG))), true, TG],
  ];
  c.forEach(([r, placed, n], i) => { if (r.placed !== placed || r.n !== n) errs.push([i, r]); });
  return errs;
}

console.log('=== O717 placement matches of a season (points-plan.js settleLine mode / placementOf, validate.js placementMode) ===');
const TG = PP.PLACEMENT_TARGET;   // the placement length (3 since 2026-11-18, was 5): the cases below are built from it
T('PLACEMENT_TARGET 3 and PLACE_CAP 5999 (one under the master line), exported by both the module and the job',
  PP.PLACEMENT_TARGET === 3 && PP.PLACE_CAP === PP.LP_SEG[5].min - 1 && PP.PLACE_CAP === 5999 && v.PLACEMENT_TARGET === 3 && v.placementOf === PP.placementOf);
// [1]
{
  const m0 = v.placementMode(0, false, ringDet(PP, SETTLED(2))), m1 = v.placementMode(1, false, ringDet(PP, SETTLED(2))), m2 = v.placementMode(2, false, ringDet(PP, SETTLED(TG - 1)));
  const done = v.placementMode(1, false, ringDet(PP, SETTLED(TG))), seeded = v.placementMode(1, true, null);
  T('[1] season 0 never places (the preseason keeps its rules); season 1 / 2 place a ring of 2 / ' + (TG - 1) + ' settled; ' + TG + ' settled is placed; the seed settle is seeded, not placing',
    !m0.placing && m0.n === 2 && m1.placing && m1.n === 2 && m2.placing && m2.n === TG - 1 && !done.placing && seeded.seeded && !seeded.placing && seeded.n === 0, J([m0, m1, m2, done, seeded]));
}
// [2]..[6]
let e = relegErrors(PP);
T('[2] relegation band, bottom half: placing = the natural delta (no relegation series), placed = forced to min - ' + PP.RELEG_LAND, !e.length, J(e.slice(0, 3)));
e = promoErrors(PP);
T('[3] promotion band, top half: placing goes up to min + ' + PP.PROMO_LAND + ' as ever (not capped below master)', !e.length, J(e.slice(0, 3)));
e = capErrors(PP);
T('[4] from 5940 five placement wins stay <= 5999 (' + J(capRun(PP).seen) + '), the sixth (placed) crosses into master (' + capRun(PP).six + '); a win over the cap holds his points', !e.length, J(e.slice(0, 3)));
e = seedErrors(PP);
T('[5] seeded + placing = seeded alone (no clamp, no cap); true / false read as { seeded } / neither, and no mode as neither (4000 random lines)', !e.length, J(e.slice(0, 3)));
e = countErrors(PP);
T('[6] the count: VOID / LEAVE do not count, a confession fine (LEAVE | SEEDED) does not count, a full ring without its seed entry is placed, no ring is placed, the target parameter', !e.length, J(e.slice(0, 3)));
{
  // the job's own confession fine receipt: LEAVE (+ SEEDED when the fine seeds his season) -- never counted as a settled match
  const SRC = H.SRC;
  T('[6] the job writes a confession fine with LEAVE (| SEEDED) and a settle leaver fine with LEAVE: neither counts on the ring',
    /set: ev\.kind === 'fine' \? \(RECEIPT_F\.LEAVE \| \(ev\.seeded \? RECEIPT_F\.SEEDED : 0\)\) : 0/.test(SRC) && (SRC.match(/RECEIPT_F\.LEAVE/g) || []).length >= 3);
}

// [8] the real job
const MIN = 60000;
const POINTS = 7, S1B = 9;
const PRE = { SEASON_NOW: '2098-12-31T20:00:00Z' }, S1 = { SEASON_NOW: '2099-01-01T00:10:00Z' };
const ents = (rows) => Object.keys(rows || {}).map((s) => ({ steamID: s, score: rows[s].score, details: rows[s].details || [] }));
const boardsOf = (recs, rows) => H.shardBoards(recs, [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: ents(rows.points) }, { id: S1B, name: 'points_s1', entries: ents(rows.s1) }, { id: 8, name: 'cp_bank', entries: [] }]);
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, all: S.concat(R) };
}
function run(steps, rows, files, script) {
  const rs = [];
  let state = files || null;
  for (const [ms, recs, env] of steps) {
    const r = H.runCron(boardsOf(recs, rows), rs.length ? H.advance(state, ms) : state, env, script || null, 'placement-rules');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, out: rs.map((r) => r.out).join(''), okAll: rs.length === steps.length && rs.every((r) => r.code === 0) };
}
// the last points write of sid on the board across the runs, or null
const lastPts = (r, board, sid) => { let x = null; for (const rr of r.rs) for (const p of H.postsOf(rr, board, sid)) x = p.score; return x; };
const C = H.SID(7171), D = H.SID(7172), A = H.SID(7173), B = H.SID(7174), E = H.SID(7175);
const X1 = H.SID(7176), X2 = H.SID(7177), X3 = H.SID(7178), Y1 = H.SID(7179), Y2 = H.SID(7180), Y3 = H.SID(7181);
const row = (M, score, n) => ({ score, details: ringDet(M, SETTLED(n)) });
// one 4-seat ranked FFA (mt 2), fair (default ratings: the plain lpDelta): seat 0 first .. seat 3 last
//   C 5900 placing (2 settled) 1st, D 5900 placed (5) 2nd, A 2050 placing (1 settled) 3rd, B 2050 placed (5) 4th
const m1 = match(2, 0x7171, [C, D, A, B]);
const rowsOf = (M, board) => { const r = { [C]: row(M, 5900, 2), [D]: row(M, 5900, 5), [A]: row(M, 2050, 1), [B]: row(M, 2050, 5) }; return board === 's1' ? { points: {}, s1: r } : { points: r, s1: {} }; };
const WANT_S1 = { C: 5999, D: 6150, A: 2046, B: 1850 }, WANT_PRE = { C: 6150, D: 6150, A: 1850, B: 1850 };
const got = (r, board) => ({ C: lastPts(r, board, C), D: lastPts(r, board, D), A: lastPts(r, board, A), B: lastPts(r, board, B) });
// E twice in one run: 2050 with 2 settled -> the 3rd (last) placement match (natural -17: 2033), then a normal one in the band (forced 1850)
const mX = match(2, 0x7172, [X1, X2, X3, E]), mY = match(2, 0x7173, [Y1, Y2, Y3, E]);
const rowsE = (M) => ({ points: {}, s1: { [E]: row(M, 2050, 2) } });
const E_STEPS = [[0, mX.S, S1], [5 * MIN, mX.S.concat(mY.S), S1], [6 * MIN, mX.all.concat(mY.all), S1]];
// the newest receipt on the row the runs wrote for sid (season 1 board), or null
function receiptOf(r, sid) { for (const rr of r.rs) for (const p of H.postsOf(rr, S1B, sid)) return PP.lpDetailsOf(p.details).ring[0]; return null; }
function jobCases(script, M) {
  const r1 = run([[0, m1.S, S1], [5 * MIN, m1.all, S1]], rowsOf(M, 's1'), null, script);
  const r0 = run([[0, m1.S, PRE], [5 * MIN, m1.all, PRE]], rowsOf(M, 'pre'), null, script);
  // X's start first, Y's 5 minutes later (one match at a time: Y waits one floor behind X), both results in the third run
  const r2 = run(E_STEPS, rowsE(M), null, script);
  return { r1, r0, r2, s1: got(r1, S1B), pre: got(r0, POINTS), e: lastPts(r2, S1B, E), eRun: r2.rs.map((rr) => H.postsOf(rr, S1B, E).length) };
}
{
  const j = jobCases(null, PP);
  T('[8] the runs settle (season 1, the preseason, two matches in one run)', j.r1.okAll && j.r0.okAll && j.r2.okAll, (j.r1.out + j.r0.out + j.r2.out).slice(-900));
  T('[8] season 1: placing C (diamond 5900, 1st) held at 5999, placed D promoted to 6150, placing A (gold 2050, 3rd) natural 2046, placed B forced to 1850',
    J(j.s1) === J(WANT_S1), J(j.s1));
  const plog = (sid) => v.pid(String(sid)).slice(0, 8);
  T('[8] the settle log names the placement matches: C [PLACEMENT 3/3, held under master], A [PLACEMENT 2/3], D / B none',
    new RegExp(plog(C) + '[^\\n]*\\[PLACEMENT 3/3, held under master\\]').test(j.r1.out) && new RegExp(plog(A) + '[^\\n]*\\[PLACEMENT 2/3\\]').test(j.r1.out)
    && !new RegExp(plog(D) + '[^\\n]*\\[PLACEMENT').test(j.r1.out) && !new RegExp(plog(B) + '[^\\n]*\\[PLACEMENT').test(j.r1.out), j.r1.out.split('\n').filter((l) => / settle /.test(l)).join(' | ').slice(0, 900));
  T('[8] the same match in the preseason settles by the old rules: C / D promoted to 6150, A / B forced to 1850', J(j.pre) === J(WANT_PRE), J(j.pre));
  T('[8] E\'s two matches settled in one run (one write, the third run): the 3rd (last) placement match natural (2033), then a normal one in the band forced down: 1850 (the first match\'s receipt counted)',
    j.e === 1850 && J(j.eRun) === '[0,0,1]' && new RegExp(v.pid(String(E)).slice(0, 8) + '[^\\n]*\\[PLACEMENT 3/3\\]').test(j.r2.out), String(j.e) + ' writes per run ' + J(j.eRun));
  // the receipt of C's capped placement match: no SERIES (the cap took the promotion back: nothing landed; his client reads
  //   clamped && !capped the same way), not LEAVE / VOID (it counts), delta 99. D, placed and promoted in the same match: SERIES.
  const cp = receiptOf(j.r1, C), dp = receiptOf(j.r1, D);
  T('[8] C\'s receipt: delta 99 (5900 -> 5999), no SERIES (held under master: no promotion happened), counted (no LEAVE / VOID): 3 settled on his ring now; D\'s (promoted to 6150): SERIES',
    !!cp && cp.delta === 99 && !(cp.flags & F.SERIES) && !(cp.flags & (F.LEAVE | F.VOID)) && !!dp && !!(dp.flags & F.SERIES)
    && (() => { for (const rr of j.r1.rs) for (const p of H.postsOf(rr, S1B, C)) return PP.placementOf(p.details).n === 3; return false; })(), J([cp, dp]));
  T('[8] the settle log: no [SERIES PROMOTED] on C\'s held match, one on D\'s', !new RegExp(plog(C) + '[^\\n]*\\[SERIES').test(j.r1.out) && new RegExp(plog(D) + '[^\\n]*\\[SERIES PROMOTED').test(j.r1.out));
}

// [9] class: the settle lines of the job
{
  const SRC = H.SRC;
  const code = SRC.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const calls = [];
  const re = /settleLine\(/g; let m;
  while ((m = re.exec(code))) {
    let depth = 1, i = m.index + m[0].length, start = i;
    while (i < code.length && depth > 0) { const ch = code[i]; if (ch === '(') depth++; else if (ch === ')') depth--; i++; }
    calls.push(code.slice(start, i - 1));
  }
  const settleCalls = calls.filter((c) => c.split(',').length >= 5);
  const named = (c) => /lineMode\(|placementMode\(|placing: /.test(c);
  T('[9] every settleLine call of validate.js passes a mode read through the placement rules (' + settleCalls.length + ' calls: lineMode / placementMode / a placing set)',
    settleCalls.length >= 3 && settleCalls.every(named), J(settleCalls.filter((c) => !named(c))));
  const direct = (code.match(/crosslineDelta\(/g) || []).length;
  T('[9] no settle path of validate.js computes a series clamp of its own (crosslineDelta is called only inside points-plan.js)', direct === 0, direct + ' call(s)');
}

// mutations
const SRCP = fs.readFileSync(path.join(H.ROOT, 'points-plan.js'), 'utf8');
const mutP = (label, pairs) => {
  let s = SRCP;
  for (const [from, to] of pairs) { if (s.indexOf(from) < 0) { bad('mutation anchor missing: ' + label + ' (' + from.slice(0, 60) + ')'); return null; } s = s.split(from).join(to); }
  const win = {};
  try { new Function('window', s)(win); } catch (err) { bad('mutation ' + label + ' does not load: ' + err.message); return null; }
  return win.POINTS_PLAN;
};
const CLAMP = 'let d = ((plan && plan.flag === 2) || seeded || (placing && !won)) ? d0 : crosslineDelta(cur, d0, won);';
{
  const g1 = mutP('the relegation series kept for placing', [[CLAMP, 'let d = ((plan && plan.flag === 2) || seeded) ? d0 : crosslineDelta(cur, d0, won);']]);
  T('[2] mutation: the relegation series kept in a placement match turns [2] red', g1 && relegErrors(g1).length > 0);
  const g2 = mutP('the promotion series dropped for placing', [[CLAMP, 'let d = ((plan && plan.flag === 2) || seeded || placing) ? d0 : crosslineDelta(cur, d0, won);']]);
  T('[3] mutation: no promotion series in a placement match either turns [3] red', g2 && promoErrors(g2).length > 0);
  const g3 = mutP('no cap', [['if (d > room) { d = room; capped = true; }', 'void room;']]);
  T('[4] mutation: no cap under master turns [4] red (a placement promotes into master)', g3 && capErrors(g3).length > 0);
  const g3b = mutP('the cap at the board top', [['const PLACE_CAP = LP_SEG[5].min - 1;', 'const PLACE_CAP = LP_MAX;']]);
  T('[4] mutation: the cap at the top of the board turns [4] red', g3b && capErrors(g3b).length > 0);
  const g4 = mutP('placing wins over seeded', [['const seeded = !!m.seeded, placing = !seeded && !!m.placing;', 'const seeded = !!m.seeded, placing = !!m.placing;']]);
  T('[5] mutation: placing over seeded (the seed settle capped) turns [5] red', g4 && seedErrors(g4).length > 0);
  const g4b = mutP('a boolean read as placing', [["const m = (mode !== null && typeof mode === 'object') ? mode : { seeded: !!mode };", "const m = (mode !== null && typeof mode === 'object') ? mode : { seeded: !!mode, placing: true };"]]);
  T('[5] mutation: the boolean form read as a placement match turns [5] red (the calls before O717 must keep their rules)', g4b && seedErrors(g4b).length > 0);
  const g5 = mutP('VOID counted', [['if (!(fl & (RECEIPT_F.VOID | RECEIPT_F.LEAVE))) n++;', 'if (!(fl & RECEIPT_F.LEAVE)) n++;']]);
  T('[6] mutation: a VOID entry counted as a match turns [6] red', g5 && countErrors(g5).length > 0);
  const g5b = mutP('LEAVE counted', [['if (!(fl & (RECEIPT_F.VOID | RECEIPT_F.LEAVE))) n++;', 'if (!(fl & RECEIPT_F.VOID)) n++;']]);
  T('[6] mutation: a leaver fine counted as a match turns [6] red', g5b && countErrors(g5b).length > 0);
  const g5c = mutP('a full ring read from its entries', [['if (seen >= RECEIPT_CAP && !seeded) return { placed: true, n: null, ring: true, seen };', '']]);
  T('[6] mutation: a full ring without its seed entry counted from its entries turns [6] red', g5c && countErrors(g5c).length > 0);
}
// the job's mutations: a copy of validate.js (requires made absolute), loaded in-process for the pure function, run for the job
const ROOTF = H.ROOT.replace(/\\/g, '/');
function mutV(pairs) {
  let s = H.SRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80)); s = s.split(good).join(badS); }
  s = s.replace(/require\('\.\//g, "require('" + ROOTF + '/').replace(/__dirname/g, JSON.stringify(ROOTF));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'placement-rules-mut-'));
  const p = path.join(dir, 'validate.js'); fs.writeFileSync(p, s);
  return { path: p, mod: () => { delete require.cache[p]; return require(p); }, done: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} } };
}
{
  const mu = mutV([["return { seeded: false, placing: (seasonIdNow | 0) >= 1 && !pl.placed, n: pl.n };", "return { seeded: false, placing: !pl.placed, n: pl.n };"]]);
  let red = false;
  try { const m = mu.mod(); red = m.placementMode(0, false, ringDet(PP, SETTLED(2))).placing === true; } catch (err) { red = true; } finally { mu.done(); }
  T('[1] mutation: no season gate (the preseason placing too) turns [1] red', red);
}
{
  const mu = mutV([['const pm = placementMode(seasonId, seededNow.has(id), lpPlan(id, lpDet[id], null, []).det);', 'const pm = placementMode(seasonId, seededNow.has(id), lpDet[id]);']]);
  let e2 = null;
  try { const r = run(E_STEPS, rowsE(PP), null, mu.path); e2 = lastPts(r, S1B, E); } finally { mu.done(); }
  T('[8] mutation: the ring read without this run\'s receipts (the row as read) turns [8] red (E\'s second match placing too: ' + e2 + ')', e2 !== 1850);
}
{
  const mu = mutV([['const sl = settleLine(cur, rs, rankX[r.id], nP, lineMode(r.id));', 'const sl = settleLine(cur, rs, rankX[r.id], nP, seededNow.has(r.id));']]);
  let s1 = null, cls = true;
  try {
    const r = run([[0, m1.S, S1], [5 * MIN, m1.all, S1]], rowsOf(PP, 's1'), null, mu.path); s1 = got(r, S1B);
    const code = fs.readFileSync(mu.path, 'utf8').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    cls = /settleLine\(cur, rs, rankX\[r\.id\], nP, seededNow\.has\(r\.id\)\)/.test(code);
  } finally { mu.done(); }
  T('[8] / [9] mutation: the settle line without the placement mode turns [8] red (' + J(s1) + ') and is the call [9] names', J(s1) !== J(WANT_S1) && cls);
}
{
  const mu = mutV([['const series = !!sl.clamped && !sl.capped;', 'const series = !!sl.clamped;']]);
  let cp = null;
  try { const r = run([[0, m1.S, S1], [5 * MIN, m1.all, S1]], rowsOf(PP, 's1'), null, mu.path); cp = receiptOf(r, C); } finally { mu.done(); }
  T('[8] mutation: SERIES on a placement match held under master (the receipt before the fix) turns [8] red', !!cp && !!(cp.flags & F.SERIES), J(cp));
  T('[8] the lone 1V1 supplement names the same rule (no SERIES when the cap held the points)', /\(\(sl\.clamped && !sl\.capped\) \? RECEIPT_F\.SERIES : 0\)/.test(H.SRC) && !/\(sl\.clamped \? RECEIPT_F\.SERIES : 0\)/.test(H.SRC));
}

console.log(failN ? ('placement-rules: ' + failN + ' FAIL') : 'placement-rules: all ok');
process.exit(failN ? 1 : 0);
