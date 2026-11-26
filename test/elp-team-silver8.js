'use strict';
// ============================================================
// elp-team-silver8.js -- Q441 (cloud audit W386, segment 79; O1015's narrow net for a team run): a version 8 team run whose host
//   line came from a member's silver start. A 0.6.4 member who holds a version 7 level of the family, plays its FIRST version 8
//   run and has not read his row when he joins (the 0.6.1-0.6.3 ledger lost the level) sends the silver line in his hello; the host
//   takes the highest hello as the team line (pointsPlan.elpTeamLine), so the game's target sits below every line the job froze for
//   the run (lvLns8, read from his converted level) -- the team ends at the game's target, the game shows a pass, the job judged a
//   miss (W386: A protected at 0, B -45 where the game showed +119 each). On the REAL elpTeamNote / ratingHistUpsert / elpSettleAll,
//   against the same job without the net (BASE: validate.js with the one call taken out):
//   [1] the bad hello (duo): both seats pass at the game's target with the points the game showed; the level chain (r[10] / r[11] /
//       r[12], lv8 / lvs8 / lv), the team's frozen lines (lvL8 / lvLns8) are exactly BASE's; sv8 is frozen in the team entry
//   [2] both members on the silver line, one of them placing: the placement verdict reads the silver target, the seed (the outs) is
//       BASE's; one level short: BASE's verdict (the leniency is the depth of the target only)
//   [3] not on: a quit at the target, one level short, one level past: BASE's result
//   [4] not a member's silver start: his earlier version 8 run of the family settled (sv8 0); nobody holds a version 7 level (sv8 0)
//   [5] the good run (the game's target = the job's): BASE's result; a run settled before Q441: a pass later changes nothing; a team
//       entry frozen before Q441 with one seat settled: the other seat gets the lines at its settle, the settled seat stays
//   [6] the lines by brute force (elpTeamSilverLines8 against every choice per member, 2..4 members), elpHighestOf, and the
//       reading's state (his silver start on the lines that have him on it, his own states on the others)
//   [7] a trio with two members on the silver line: all three pass at the game's target, the chain BASE's
//   [9] mutations: each check above turns red on the matching break
// ============================================================
const path = require('path'), fs = require('fs'), os = require('os');
for (const k of ['ELP_PUB_VER', 'ELP_CUTOVER_MS', 'ELP_DEV_VER', 'ELP_IDLE_MS', 'PT_MODE', 'SEASON_NOW', 'COUCH_DUO']) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const attest = require(path.join(ROOT, 'attest.js'));
const PP = require(path.join(ROOT, 'points-plan.js'));
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = (x) => JSON.stringify(x);
const F = attest.SEG_FINAL, MIN = 60000, DAY = 86400000, T0 = 1764000000000;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const L7 = PP.ELP7.PRIOR, L8 = PP.ELP8.PRIOR;
const V8 = { v7: true, quit: false, v8: true }, QUIT8 = { v7: true, quit: true, v8: true };
const CALL = '  for (const rd of elpTeamSilverReads8(st, p, r, fam, s, nowMs, ctx, team, quit, depth, seed, xs, reads)) reads.push(rd);   // Q441: verdict only\n';

// a copy of validate.js with string replacements (the one loader of BASE and the mutants)
function modOf(pairs) {
  const ROOTF = ROOT.replace(/\\/g, '/');
  let s = SRC;
  for (const [good, badS] of pairs) { if (s.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 90)); s = s.split(good).join(badS); }
  s = s.replace(/require\('\.\//g, "require('" + ROOTF + '/').replace(/__dirname/g, JSON.stringify(ROOTF));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elp-team-silver8-')), p = path.join(dir, 'validate.js');
  fs.writeFileSync(p, s);
  try { delete require.cache[p]; return require(p); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}
const BASE = modOf([[CALL, '']]);   // the job without the Q441 net

const tab7 = () => ({ day: 20251122, season: 0, ms: T0 - 2 * DAY, key: J([7, 1500, 500, 100, 2]), byFam: { solo: { N: 0, pass: L7.solo }, duo: { N: 0, pass: L7.duo }, trio: { N: 0, pass: L7.trio }, quad: { N: 0, pass: L7.quad } } });
// a placed player of family fam holding version 7 level x7 and settled version 7 runs at these depths (oldest first)
function v7Holder(m, st, n, fam, x7, depths, lp, t0) {
  const p = m.pid(SID(n));
  const runs = depths.map((d, i) => [80000 + 100 * n + i, d, t0 + i * MIN, 2, 0, d, t0 + i * MIN, 1 | m.ELP_R_V7, 40000 + 100 * n + i]);
  st.hist[m.ratingHistKey(p, fam, 0)] = { best: [0, 0], runs, old: [], t: t0 };
  st.hist[m.elpAllKey(p, 0)] = { lp, placed: 1, seedRun: [fam, runs[0][0]], n: depths.length, ring: [], t: t0, lv: { [fam]: Object.assign({}, x7) } };
  return p;
}
const X = (L, Lm, s, last, run) => ({ L, Lm, s, last, run });
// the members of the worlds: [n, version 7 level, depths, points] (A / B of W386: test/endless-level8.js [6]'s A and a bronze teammate)
const HI = [5, X(1800, 1750, 3, 1, 2), [18, 17, 19], 3000], LO = [6, X(500, 500, 3, 0, 2), [5, 4, 6], 1500], MID = [8, X(1500, 1480, 3, 0, 2), [15, 16, 14], 2500];
const RID = 7401, SEED = 2, T1 = T0 + 400 * MIN, AT = T1 + 30 * MIN;
const silverL = (fam) => L8[fam][1] * 100;
// build a world of these members (each [n, x7, depths, lp]; x7 null = a new player: no entry at all) on module m
function worldOf(m, members, fam) {
  const st = { hist: {}, elpTab: [tab7()] };
  const ps = members.map(([n, x7, ds, lp]) => (x7 ? v7Holder(m, st, n, fam, x7, ds, lp, T1) : m.pid(SID(n))));
  return { st, ps, fam };
}
// what the job holds of a seat after the settle: the run, the points entry, the team entry
function seatOf(m, w, q, rid) {
  const h = w.st.hist[m.ratingHistKey(q, w.fam, 0)], r = h && h.runs.find((x) => (x[0] >>> 0) === (rid >>> 0)), c = w.st.hist[m.elpAllKey(q, 0)];
  return { r: r ? r.slice() : null, c: c ? JSON.parse(J(c)) : null };
}
const chainOf = (s) => J([s.r && s.r.slice(10, 13), s.c && [s.c.lv8, s.c.lvs8, s.c.lv, s.c.n, s.c.placed]]);
const teamOf = (w, rid) => { const tm = w.st.elpTeam && w.st.elpTeam[String(rid || RID)]; return tm ? J([tm.lvL8, tm.lvLns8, tm.hasLv8]) : 'none'; };
// play team run RID of the world's members on module m: every seat writes its final segment at `depth` (lv = the segment's bits)
function play(m, members, fam, depth, o) {
  const w = worldOf(m, members, fam);
  if (o && o.prep) o.prep(m, w);
  m.elpTeamNote(w.st, RID, w.ps, fam, 0, AT);
  for (const q of w.ps) m.ratingHistUpsert(w.st, q, fam, 0, RID, depth, AT, F, SEED, (o && o.lv) || V8);
  const out = m.elpSettleAll(w.st, 0, AT + MIN) || [];
  w.out = out; w.seats = w.ps.map((q) => seatOf(m, w, q, RID));
  return w;
}
const off = PP.targetOffset(SEED);
const lineOfHellos = (Ls) => PP.elpLineOfL8(PP.elpTeamLine(Ls));
// the target the game showed when these hellos came in (the host's team target frame: the highest hello)
const gameT = (Ls) => PP.elpTargetOfL8(lineOfHellos(Ls) * 100, SEED);

// ---- [1] the bad hello (W386) ----
function sBad(m) {
  const e = [], fam = 'duo';
  const b0 = worldOf(BASE, [HI, LO], fam), A = b0.ps[0], B = b0.ps[1];
  const xA = BASE.elpMemberLevelBefore8(b0.st, A, fam, 0, RID, AT, AT + MIN, null)[0], xB = BASE.elpMemberLevelBefore8(b0.st, B, fam, 0, RID, AT, AT + MIN, null)[0];
  const Tg = gameT([silverL(fam), xB.L]), Tj = gameT([xA.L, xB.L]);   // A's hello = the silver line, B read his row
  const base = play(BASE, [HI, LO], fam, Tg), got = play(m, [HI, LO], fam, Tg);
  if (!(Tg < Tj) || base.seats.some((s) => (s.r[5] | 0) === Tg)) return ['the world is not a real test: ' + J([Tg, Tj, base.seats.map((s) => s.r[5])])];
  // what the game showed: each seat's own points, a pass, on the host's line (A's client held his silver start, B his own state)
  const sA = BASE.elpMemberSilver8(b0.st, A, fam, 0, RID, AT, AT + MIN, null)[0], ln = lineOfHellos([silverL(fam), xB.L]);
  const shown = [[HI[3], sA.Lm], [LO[3], xB.Lm]].map(([cur, Lm]) => PP.endlessSettleLv8(cur, true, Lm, L8[fam], off, fam, ln).d);
  if (!sA || sA.L !== silverL(fam)) return ['the world is not a real test: A\'s silver start ' + J(sA)];
  got.seats.forEach((s, i) => {
    if (!s.r || s.r[3] !== 2 || (s.r[5] | 0) !== Tg || (s.r[4] | 0) !== shown[i]) e.push('seat ' + i + ' judged ' + J(s.r && [s.r[3], s.r[4], s.r[5]]) + ' != the pass the game showed ' + J([2, shown[i], Tg]));
    if (chainOf(s) !== chainOf(base.seats[i])) e.push('seat ' + i + ' chain ' + chainOf(s) + ' != the job without the net ' + chainOf(base.seats[i]));
  });
  const outs = got.out.filter((x) => (x.runId >>> 0) === RID);
  if (outs.length !== 2 || outs.some((x) => !x.pass || !x.silver)) e.push('the settle entries ' + J(outs.map((x) => [x.pass, x.silver, x.T])));
  if (teamOf(got) !== teamOf(base)) e.push('the frozen lines ' + teamOf(got) + ' != ' + teamOf(base));
  const tm = got.st.elpTeam[String(RID)];
  if (!tm || !tm.sv8 || !tm.sv8[A] || J(tm.sv8[A][0]) !== J([PP.elpLineOfL8(silverL(fam))])) e.push('sv8 not frozen in the team entry: ' + J(tm && tm.sv8));
  return e;
}

// ---- [2] both members on the silver line, one placing ----
function prepPlacing(m, w) { const c = w.st.hist[m.elpAllKey(w.ps[1], 0)]; c.placed = 0; c.n = 2; c.lp = null; delete c.seedRun; }
function sPlace(m) {
  const e = [], fam = 'duo';
  const Tg = gameT([silverL(fam), silverL(fam)]);
  for (const [depth, what] of [[Tg, 'at the game\'s target'], [Tg - 1, 'one level short']]) {
    const base = play(BASE, [HI, MID], fam, depth, { prep: prepPlacing }), got = play(m, [HI, MID], fam, depth, { prep: prepPlacing });
    const bT = base.seats.map((s) => s.r[5] | 0);
    if (depth === Tg && bT.some((t) => t === Tg)) return ['the world is not a real test: ' + J(bT)];
    got.seats.forEach((s, i) => {
      const want = depth === Tg ? Tg : bT[i];
      if (!s.r || (s.r[5] | 0) !== want) e.push(what + ': seat ' + i + ' judged at ' + (s.r && s.r[5]) + ' != ' + want);
      if (chainOf(s) !== chainOf(base.seats[i])) e.push(what + ': seat ' + i + ' chain ' + chainOf(s) + ' != ' + chainOf(base.seats[i]));
      if (i === 1 && J(s.c && s.c.lp) !== J(base.seats[i].c && base.seats[i].c.lp)) e.push(what + ': the placing seat\'s seed ' + (s.c && s.c.lp) + ' != the job without the net ' + (base.seats[i].c && base.seats[i].c.lp));
      if (i === 0 && depth === Tg && !((s.r[4] | 0) > 0)) e.push(what + ': the placed seat\'s pass took ' + s.r[4]);
      if (depth !== Tg && J(s.r) !== J(base.seats[i].r)) e.push(what + ': seat ' + i + ' run ' + J(s.r) + ' != ' + J(base.seats[i].r));
    });
    if (got.seats[1].c.placed !== 1) e.push(what + ': the placing seat did not seed');
  }
  return e;
}

// ---- [3] not on: a quit, one level short, one level past ----
function sNot(m) {
  const e = [], fam = 'duo';
  const b0 = worldOf(BASE, [HI, LO], fam), xB = BASE.elpMemberLevelBefore8(b0.st, b0.ps[1], fam, 0, RID, AT, AT + MIN, null)[0];
  const Tg = gameT([silverL(fam), xB.L]);
  for (const [depth, lv, what] of [[Tg, QUIT8, 'a quit at the target'], [Tg - 1, V8, 'one level short'], [Tg + 1, V8, 'one level past']]) {
    const base = play(BASE, [HI, LO], fam, depth, { lv }), got = play(m, [HI, LO], fam, depth, { lv });
    got.seats.forEach((s, i) => { if (J(s) !== J(base.seats[i])) e.push(what + ': seat ' + i + ' ' + J([s.r && s.r.slice(3, 6), s.c && s.c.lp]) + ' != the job without the net ' + J([base.seats[i].r && base.seats[i].r.slice(3, 6), base.seats[i].c && base.seats[i].c.lp])); });
  }
  return e;
}

// ---- [4] not a member's silver start ----
function sNotSilver(m) {
  const e = [], fam = 'duo';
  // (a) an earlier version 8 run of the family settled for both: their clients hold a version 8 level
  const RID0 = 7400, at0 = AT - 20 * MIN;
  const prep = (q) => (mm, w) => {
    mm.elpTeamNote(w.st, RID0, w.ps, fam, 0, at0);
    const T0r = mm.elpTeamLevel8(JSON.parse(J(w.st)), [RID0, 0, at0], fam, 0, at0 + MIN, null);
    const Tt = PP.elpTargetOfL8(T0r.L, SEED + 1);
    for (const p of w.ps) mm.ratingHistUpsert(w.st, p, fam, 0, RID0, Tt, at0, F, SEED + 1, V8);
    mm.elpSettleAll(w.st, 0, at0 + MIN);
    if (q) q.Tt = Tt;
  };
  const Tg = gameT([silverL(fam), silverL(fam)]), q0 = {};
  const base = play(BASE, [HI, MID], fam, Tg, { prep: prep(q0) }), got = play(m, [HI, MID], fam, Tg, { prep: prep(null) });
  if (base.seats.some((s) => (s.r[5] | 0) === Tg)) e.push('the world is not a real test (a): ' + J(base.seats.map((s) => s.r[5])));
  const tm = got.st.elpTeam[String(RID)];
  if (!tm || tm.sv8 !== 0) e.push('(a) a member with a settled version 8 run of the family got silver lines: ' + J(tm && tm.sv8));
  got.seats.forEach((s, i) => { if (J(s) !== J(base.seats[i])) e.push('(a) seat ' + i + ' ' + J(s.r && s.r.slice(3, 6)) + ' != ' + J(base.seats[i].r && base.seats[i].r.slice(3, 6))); });
  // (b) nobody holds a version 7 level: their starts already are the silver line
  const NEW = [[11, null], [12, null]], Tn = gameT([silverL(fam), silverL(fam)]);
  const bn = play(BASE, NEW, fam, Tn), gn = play(m, NEW, fam, Tn), tn = gn.st.elpTeam[String(RID)];
  if (!tn || tn.sv8 !== 0) e.push('(b) new players got silver lines: ' + J(tn && tn.sv8));
  gn.seats.forEach((s, i) => { if (J(s) !== J(bn.seats[i])) e.push('(b) seat ' + i + ' != the job without the net'); });
  return e;
}

// ---- [5] the good run, old settles, an entry frozen before Q441 ----
function sOld(m) {
  const e = [], fam = 'duo';
  const b0 = worldOf(BASE, [HI, LO], fam), xA = BASE.elpMemberLevelBefore8(b0.st, b0.ps[0], fam, 0, RID, AT, AT + MIN, null)[0], xB = BASE.elpMemberLevelBefore8(b0.st, b0.ps[1], fam, 0, RID, AT, AT + MIN, null)[0];
  const Tj = gameT([xA.L, xB.L]), Tg = gameT([silverL(fam), xB.L]);
  // the good run: the game's target = the job's
  const base = play(BASE, [HI, LO], fam, Tj), got = play(m, [HI, LO], fam, Tj);
  got.seats.forEach((s, i) => { if (J(s) !== J(base.seats[i])) e.push('the good run: seat ' + i + ' != the job without the net ' + J([s.r, base.seats[i].r])); });
  if (teamOf(got) !== teamOf(base)) e.push('the good run: the frozen lines');
  // a run settled before Q441 (the job without the net; the team entry as it froze then): a later pass changes nothing
  const old = play(BASE, [HI, LO], fam, Tg);
  delete old.st.elpTeam[String(RID)].sv8;
  const snap = J(old.st.hist);
  m.elpSettleAll(old.st, 0, AT + 2 * DAY);
  if (J(old.st.hist) !== snap) e.push('a run settled before Q441 was settled again');
  // an entry frozen before Q441 with A settled (B's copy still at a checkpoint): B gets the lines at his settle, A stays
  const w = worldOf(BASE, [HI, LO], fam), [A, B] = w.ps;
  BASE.elpTeamNote(w.st, RID, w.ps, fam, 0, AT);
  BASE.ratingHistUpsert(w.st, A, fam, 0, RID, Tg, AT, F, SEED, V8);
  BASE.ratingHistUpsert(w.st, B, fam, 0, RID, Tg - 3, AT, 0, SEED, V8);
  BASE.elpSettleAll(w.st, 0, AT + MIN);
  const tm = w.st.elpTeam[String(RID)], aR = seatOf(BASE, w, A, RID), bR0 = seatOf(BASE, w, B, RID);
  if (!tm || !tm.hasLv8 || !aR.r || aR.r[3] !== 2 || (bR0.r && bR0.r[3])) return e.concat(['the world is not a real test (frozen half): ' + J([tm, aR.r, bR0.r])]);
  delete tm.sv8;   // what an entry frozen before Q441 holds
  m.ratingHistUpsert(w.st, B, fam, 0, RID, Tg, AT + 2 * MIN, F, SEED, V8);
  m.elpSettleAll(w.st, 0, AT + 3 * MIN);
  const aR2 = seatOf(m, w, A, RID), bR = seatOf(m, w, B, RID);
  if (J(aR2.r) !== J(aR.r)) e.push('the seat settled before Q441 moved: ' + J([aR.r, aR2.r]));
  if (!bR.r || bR.r[3] !== 2 || (bR.r[5] | 0) !== Tg) e.push('the seat settling after Q441 on an entry frozen before it: judged at ' + J(bR.r && bR.r[5]) + ' != ' + Tg);
  if (!tm.sv8) e.push('the entry frozen before Q441 did not get its silver lines at the next settle');
  return e;
}

// ---- [6] the lines by brute force, elpHighestOf, the reading's state ----
function rng(seed) { let x = seed >>> 0; return () => { x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x6D2B79F5) >>> 0; return x / 4294967296; }; }
function bruteLines(sets, silv, own) {
  const n = sets.length, out = {};
  const lineOf = (combo) => PP.elpLineOfL8(Math.max.apply(null, combo.map((c) => c.L)));
  const walk = (i, combo, fn) => { if (i === n) { fn(combo); return; } for (const L of sets[i]) walk(i + 1, combo.concat([{ L, sv: false }]), fn); for (const L of silv[i]) walk(i + 1, combo.concat([{ L, sv: true }]), fn); };
  for (let i = 0; i < n; i++) {
    const on = new Set(), offS = new Set();
    walk(0, [], (combo) => {
      const ln = lineOf(combo);
      if (own.includes(ln)) return;
      if (combo[i].sv) on.add(ln);
      else if (combo.some((c, j) => j !== i && c.sv)) offS.add(ln);
    });
    if (on.size || offS.size) out['p' + i] = [[...on].sort((a, b) => a - b), [...offS].sort((a, b) => a - b)];
  }
  return Object.keys(out).length ? out : 0;
}
function sLines(m) {
  const e = [];
  if (J([...m.elpHighestOf([[3], [1, 5]])].sort()) !== J([3, 5]) || m.elpHighestOf([[3], []]).size !== 0 || J([...m.elpHighestOf([[2, 9], [4, 7]])].sort((a, b) => a - b)) !== J([4, 7, 9])) e.push('elpHighestOf ' + J([[...m.elpHighestOf([[3], [1, 5]])], [...m.elpHighestOf([[2, 9], [4, 7]])]]));
  const R = rng(441);
  const pick = (k) => { const a = []; for (let j = 0; j < k; j++) a.push(2500 + 100 * Math.floor(R() * 14)); return a; };
  for (let t = 0; t < 400 && e.length < 3; t++) {
    const n = 2 + Math.floor(R() * 3), pids = [], sets = [], silv = [];
    for (let i = 0; i < n; i++) { pids.push('p' + i); sets.push(pick(1 + Math.floor(R() * 3))); silv.push(R() < 0.5 ? pick(1 + Math.floor(R() * 2)) : []); }
    const own = [...new Set(sets.flat().filter(() => R() < 0.4).map((L) => PP.elpLineOfL8(L)))];
    const got = m.elpTeamSilverLines8(pids, sets, silv, own), want = bruteLines(sets, silv, own);
    if (J(got) !== J(want)) e.push('case ' + t + ' ' + J({ sets, silv, own }) + ': ' + J(got) + ' != every choice ' + J(want));
  }
  // the reading's state: A (his own silver start on the line) and B (his own states, and his silver start: he holds a version 7
  //   level too) of W386 at the game's target
  const w = worldOf(m, [HI, LO], 'duo'), [A, B] = w.ps;
  m.elpTeamNote(w.st, RID, w.ps, 'duo', 0, AT);
  const r = [RID, 0, AT, 0, 0, 0, AT, m.ELP_R_V8 | 1, SEED], team = m.elpTeamLevel8(w.st, r, 'duo', 0, AT + MIN, null);
  const xsOf = (q) => m.elpMemberLevelBefore8(w.st, q, 'duo', 0, RID, AT, AT + MIN, null), Tg = gameT([silverL('duo'), xsOf(B)[0].L]);
  const rdA = m.elpTeamSilverReads8(w.st, A, r, 'duo', 0, AT + MIN, null, team, false, Tg, SEED, xsOf(A), []);
  const rdB = m.elpTeamSilverReads8(w.st, B, r, 'duo', 0, AT + MIN, null, team, false, Tg, SEED, xsOf(B), []);
  const sA = m.elpMemberSilver8(w.st, A, 'duo', 0, RID, AT, AT + MIN, null).map((x) => x.L);
  if (!rdA.length || rdA.some((rd) => !rd.verdictOnly || !sA.includes(rd.x.L))) e.push('A reads ' + J(rdA.map((rd) => [rd.x.L, rd.L])) + ' (his silver start ' + J(sA) + ' only)');
  const wantB = new Set([xsOf(B)[0].L].concat(m.elpMemberSilver8(w.st, B, 'duo', 0, RID, AT, AT + MIN, null).map((x) => x.L)));
  if (J([...new Set(rdB.map((rd) => rd.x.L))].sort()) !== J([...wantB].sort())) e.push('B reads ' + J(rdB.map((rd) => [rd.x.L, rd.L])) + ' != his states and his silver start ' + J([...wantB]));
  if (m.elpTeamSilverReads8(w.st, A, r, 'duo', 0, AT + MIN, null, undefined, false, Tg, SEED, xsOf(A), []).length) e.push('a run without a team got team silver readings');
  return e;
}

// ---- [7] a trio with two members on the silver line ----
function sTrio(m) {
  const e = [], fam = 'trio', TRIO = [HI, MID, LO];
  const b0 = worldOf(BASE, TRIO, fam), xC = BASE.elpMemberLevelBefore8(b0.st, b0.ps[2], fam, 0, RID, AT, AT + MIN, null)[0];
  const Tg = gameT([silverL(fam), silverL(fam), xC.L]);
  const base = play(BASE, TRIO, fam, Tg), got = play(m, TRIO, fam, Tg);
  if (base.seats.some((s) => (s.r[5] | 0) === Tg)) return ['the world is not a real test: ' + J(base.seats.map((s) => s.r[5]))];
  got.seats.forEach((s, i) => {
    if (!s.r || (s.r[5] | 0) !== Tg || (s.r[4] | 0) <= 0) e.push('seat ' + i + ' judged ' + J(s.r && [s.r[4], s.r[5]]) + ' (a pass at ' + Tg + ')');
    if (chainOf(s) !== chainOf(base.seats[i])) e.push('seat ' + i + ' chain != the job without the net');
  });
  return e;
}

const SCEN = [
  ['[1] the bad hello (W386): both seats pass at the game\'s target with the points the game showed; the chain and the frozen lines are those of the job without the net; sv8 frozen in the team entry', sBad],
  ['[2] both members on the silver line, one placing: the silver target decides the verdict, the seed is the job\'s; one level short: the job\'s verdict', sPlace],
  ['[3] not on a quit at the target, one level short, one level past', sNot],
  ['[4] not a member\'s silver start: his earlier version 8 run of the family settled / nobody holds a version 7 level (sv8 0)', sNotSilver],
  ['[5] the good run unchanged; a run settled before Q441 is not settled again; an entry frozen before Q441: the seat settling after it gets the lines, the settled one stays', sOld],
  ['[6] the lines = every choice per member (2..4 members, 400 cases), elpHighestOf, the reading\'s state', sLines],
  ['[7] a trio with two members on the silver line: all three pass, the chain the job\'s', sTrio],
];
console.log('-- Q441 version 8 team runs: the silver line in a hello --');
for (const [label, fn] of SCEN) { let e; try { e = fn(v); } catch (err) { e = ['threw: ' + (err && err.stack || err).toString().slice(0, 300)]; } T(label, e.length === 0, e.slice(0, 3).join(' | ')); }

// ---- [9] mutations ----
const MUTS = [
  ['the team silver reading never added (the net gone)', [[CALL, '']], sBad],
  ['the reading enters the carry / the outs (not verdict only)', [['      out.push({ x, L: ln * 100, verdictOnly: true });', '      out.push({ x, L: ln * 100 });']], sPlace],
  ['also on a quit', [['  if (!team || quit || !team.sv) return [];', '  if (!team || !team.sv) return [];']], sNot],
  ['at any depth (not only the target)', [['  const hit = (ln) => !have.has(ln * 100) && pointsPlan.elpTargetOfL8(ln * 100, seed) === (depth | 0);', '  const hit = (ln) => !have.has(ln * 100);']], sPlace],
  ['a member whose earlier version 8 run of the family settled still counts', [['  for (const x of ((h && Array.isArray(h.runs)) ? h.runs : [])) if ((x[0] >>> 0) !== rid && x[3] && ((x[7] | 0) & ELP_R_V8) && (x[2] || 0) < at && elpLvOfArr8(x[11])) return [];\n', '']], sNotSilver],
  ['the line read from the lowest choice (the floor rule broken)', [['  const floor = Math.max.apply(null, opts.map((o) => Math.min.apply(null, o)));', '  const floor = Math.min.apply(null, opts.map((o) => Math.min.apply(null, o)));']], sLines],
  ['the entry\'s own lines repeated in sv8', [['.filter((ln) => !own.includes(ln));\n  const out = {};', ';\n  const out = {};']], sLines],
  ['the silver start\'s line read with his converted state', [['[[on, sx.length ? sx : xs], [off, xs]]', '[[on, xs], [off, xs]]']], sLines],
  ['an entry frozen before Q441 never gets the lines', [['  if (tm.sv8 === undefined) {   // Q441', '  if (sets && tm.sv8 === undefined) {   // Q441']], sOld],
  ['only the first member\'s silver start counts (the others\' left out)', [['    const silv = tm.r.map((q) => elpMemberSilver8(st, q, fam, s, r[0] >>> 0, at, nowMs, ctx).map((x) => x.L));', '    const silv = tm.r.map((q, i) => (i ? [] : elpMemberSilver8(st, q, fam, s, r[0] >>> 0, at, nowMs, ctx).map((x) => x.L)));']], sTrio],
];
console.log('-- [9] mutations --');
for (const [label, pairs, fn] of MUTS) {
  let red = false, why = '';
  try { const e = fn(modOf(pairs)); red = e.length > 0; why = e[0] || ''; }
  catch (err) { if (/anchor missing/.test(err.message)) { bad('[9] ' + label + ': ' + err.message); continue; } red = true; why = 'threw: ' + err.message.slice(0, 80); }
  T('[9] mutation "' + label + '" turns its check red', red, why);
}
console.log(failN ? 'FAIL (elp-team-silver8) ' + failN : 'elp-team-silver8: all ok');
process.exit(failN ? 1 : 0);
