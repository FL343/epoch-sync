'use strict';
// 5.4a S2 (2026-10-19): per-player "mode x character" career matrix -> xp_ladder 0xCA v2.
// Pins: decodeCharBlock (scan from an offset, pc must match, truncated = null) · careerSeatCodes (per-seat majority, own
// vote fallback, unknown) · creditCareerMatch (quick / ranked W/L in valid only, innocent games + time, abandoner nothing,
// private / bots no W/L, time = own d[9] clamped) · creditCareerEndless (casual record = one game, segmented counts a
// game only at a session end, forced default miner, time cap by depth) · careerBlockOf v2 layout + folding + saturation ·
// careerEnsureWrites (same-score rewrite only with a known board score) · every credit call site is followed by its career
// call (source pin) · mutation self-checks.
//   node test/career-matrix.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const fs = require('fs');
const v = require(path.join(__dirname, '..', 'validate.js'));
const { decodeCharBlock, careerSeatCodes, creditCareerMatch, creditCareerEndless, careerBlockOf, careerEnsureWrites, careerSecOf,
  careerModeOfMt, CHAR_MAGIC, CAREER_MATRIX_MAGIC, CAREER_MODES, CAREER_COLS, CAREER_WL_MASK, pid } = v;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const assert = (label, cond) => { if (cond) ok(label); else bad(label); };

const SIDS = ['76561198000000101', '76561198000000102', '76561198000000103', '76561198000000104'];
const pair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const charBlock = (codes) => { const n = codes.length, out = [(CHAR_MAGIC | (1 << 8) | (n << 16)) | 0]; for (let i = 0; i < n; i += 4) { let w = 0; for (let j = 0; j < 4 && i + j < n; j++) w |= (codes[i + j] & 0xff) << (8 * j); out.push(w | 0); } return out; };
// a settle record as the client writes it (header 10 + scores + disp + roster [+ endless tail 12] [+ char block])
function rec(o) {
  const pc = o.pc, seat = o.seat;
  const d = [0xB1, 3, o.mt, 4242, 77, seat, o.rank || 1, 0, pc, o.dur == null ? 480 : o.dur];
  for (let i = 0; i < pc; i++) d.push(o.scores ? o.scores[i] : 1000 - i * 100);
  d.push(o.disp == null ? 0 : o.disp);
  for (let i = 0; i < pc; i++) d.push(...pair(SIDS[i]));
  if (o.tail) d.push(...o.tail);
  if (o.extra) d.push(...o.extra);
  if (o.codes) d.push(...charBlock(o.codes));
  return { steamID: SIDS[seat], d, dispCode: o.disp == null ? 0 : o.disp };
}

console.log('=== constants (client career.js mirror; pinned two-way in mvp ledger-schema-lockstep) ===');
eq('modes wire order', CAREER_MODES, ['quick', 'ranked', 'private', 'bots', 'endless']);
eq('W/L mask = quick + ranked', CAREER_WL_MASK, 3);
eq('columns = code 0 + characters 1..4', CAREER_COLS, 5);
eq('char block magic 0xD8 / matrix magic 0xC2', [CHAR_MAGIC, CAREER_MATRIX_MAGIC], [0xD8, 0xC2]);
eq('mode of mt', [1, 3, 5, 8, 2, 4, 6, 9, 10, 11, 7, 0x17, 0].map(careerModeOfMt), [0, 0, 0, 0, 1, 1, 1, 1, 2, 3, 4, 4, -1]);

console.log('=== decodeCharBlock ===');
{
  const r = rec({ mt: 1, pc: 3, seat: 0, codes: [3, 1, 4] });
  eq('found right after the roster', decodeCharBlock(r.d, 11 + 9, 3), [3, 1, 4]);
  eq('scanned forward past a Q43-like tag', decodeCharBlock(rec({ mt: 5, pc: 4, seat: 0, extra: [0x74320003], codes: [2, 2, 3, 4] }).d, 11 + 12, 4), [2, 2, 3, 4]);
  eq('pc must match (a 0xD8 byte of another shape is skipped)', decodeCharBlock([0xD8 | (1 << 8) | (2 << 16), 0x0101].concat(charBlock([1, 2, 3])), 0, 3), [1, 2, 3]);
  eq('old record without a block -> null', decodeCharBlock(rec({ mt: 1, pc: 3, seat: 0 }).d, 20, 3), null);
  eq('truncated block -> null', decodeCharBlock([(0xD8 | (1 << 8) | (3 << 16)) | 0], 0, 3), null);
  eq('8 seats = 2 body ints', decodeCharBlock(charBlock([1, 2, 3, 4, 4, 3, 2, 1]), 0, 8), [1, 2, 3, 4, 4, 3, 2, 1]);
}

console.log('=== careerSeatCodes (per-seat majority; never stops a settle) ===');
{
  const g = [0, 1, 2].map((s) => rec({ mt: 1, pc: 3, seat: s, codes: [3, 1, 4] }));
  eq('all agree', careerSeatCodes(g).codes, [3, 1, 4]);
  eq('all agree -> majority everywhere', careerSeatCodes(g).majority, [true, true, true]);
  const g2 = [rec({ mt: 1, pc: 3, seat: 0, codes: [3, 1, 4] }), rec({ mt: 1, pc: 3, seat: 1, codes: [3, 2, 4] }), rec({ mt: 1, pc: 3, seat: 2, codes: [3, 1, 4] })];
  eq('one writer claims seat 1 is a merchant -> outvoted 2:1', careerSeatCodes(g2).codes, [3, 1, 4]);
  const g3 = [rec({ mt: 1, pc: 2, seat: 0, codes: [3, 1] }), rec({ mt: 1, pc: 2, seat: 1, codes: [2, 4] })];
  const s3 = careerSeatCodes(g3);
  eq('2 writers disagree on both seats -> each seat takes its OWNER\'s vote', s3.codes, [3, 4]);
  eq('... and no majority', s3.majority, [false, false]);
  const g4 = [rec({ mt: 1, pc: 3, seat: 0 }), rec({ mt: 1, pc: 3, seat: 1 }), rec({ mt: 1, pc: 3, seat: 2 })];
  eq('no blocks (old clients) -> unknown 0', careerSeatCodes(g4).codes, [0, 0, 0]);
  const g5 = [rec({ mt: 1, pc: 3, seat: 0, codes: [3, 1, 4] }), rec({ mt: 1, pc: 3, seat: 1 }), rec({ mt: 1, pc: 3, seat: 2 })];
  eq('one block among old records -> its votes are the majority of the block holders', careerSeatCodes(g5).codes, [3, 1, 4]);
  const g6 = [rec({ mt: 1, pc: 2, seat: 0, codes: [3, 1] }), rec({ mt: 1, pc: 2, seat: 0, codes: [2, 2] }), rec({ mt: 1, pc: 2, seat: 1, codes: [3, 1] })];
  eq('a seat writing twice votes once', careerSeatCodes(g6).codes, [3, 1]);
  const ge = [0, 1].map((s) => rec({ mt: 7, pc: 2, seat: s, tail: [0, 5, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], codes: [2, 4] }));
  eq('endless: block found after the 12-int tail', careerSeatCodes(ge).codes, [2, 4]);
}

console.log('=== creditCareerMatch ===');
{
  const xs = {}, touched = new Set();
  const rankOf = { [SIDS[0]]: 1, [SIDS[1]]: 2, [SIDS[2]]: 3 };
  const g = [0, 1, 2].map((s) => rec({ mt: 1, pc: 3, seat: s, codes: [3, 1, 4], dur: 470 + s }));
  creditCareerMatch(g, 1, rankOf, xs, touched);
  eq('quick: winner (strongman) cell [g, s, w, l]', xs[pid(SIDS[0])].cm['0:3'], [1, 470, 1, 0]);
  eq('quick: 2nd (default) loss, own d[9]', xs[pid(SIDS[1])].cm['0:1'], [1, 471, 0, 1]);
  eq('touched = all writers', [...touched].sort(), SIDS.slice(0, 3).sort());
  const gr = [0, 1].map((s) => rec({ mt: 2, pc: 2, seat: s, codes: [2, 4], disp: s === 1 ? 2 : 0 }));
  creditCareerMatch(gr, 2, { [SIDS[0]]: 1, [SIDS[1]]: 2 }, xs, null);
  eq('ranked valid winner (merchant)', xs[pid(SIDS[0])].cm['1:2'], [1, 480, 1, 0]);
  eq('ranked innocent (host-left): game + time, no W/L', xs[pid(SIDS[1])].cm['1:4'], [1, 480, 0, 0]);
  const ga = [0, 1].map((s) => rec({ mt: 1, pc: 2, seat: s, codes: [1, 1], disp: s === 1 ? 5 : 0 }));
  const xa = {};
  creditCareerMatch(ga, 1, { [SIDS[0]]: 1, [SIDS[1]]: 2 }, xa, null);
  eq('abandoner counts nothing', xa[pid(SIDS[1])], undefined);
  const gt = [0, 1, 2, 3].map((s) => rec({ mt: 5, pc: 4, seat: s, codes: [1, 2, 3, 4] }));
  const xt = {};
  creditCareerMatch(gt, 5, { [SIDS[0]]: 1, [SIDS[1]]: 2, [SIDS[2]]: 3, [SIDS[3]]: 4 }, xt, null);
  eq('2V2: team rank <= 2 wins (careerWon)', [xt[pid(SIDS[1])].cm['0:2'][2], xt[pid(SIDS[2])].cm['0:3'][3]], [1, 1]);
  const gp = [0, 1].map((s) => rec({ mt: 10, pc: 2, seat: s, codes: [4, 2] }));
  const xp = {};
  creditCareerMatch(gp, 10, { [SIDS[0]]: 1, [SIDS[1]]: 2 }, xp, null);
  eq('private: games + time only', xp[pid(SIDS[0])].cm['2:4'], [1, 480, 0, 0]);
  const gb = [rec({ mt: 11 | (2 << 4), pc: 3, seat: 0, codes: [3, 1, 2] })];
  const xb = {};
  creditCareerMatch(gb, 11 | (2 << 4), null, xb, null);
  eq('bots (tier bits in mt): games + time only, no ranks needed', xb[pid(SIDS[0])].cm['3:3'], [1, 480, 0, 0]);
  const xl = {};
  creditCareerMatch([0, 1].map((s) => rec({ mt: 1, pc: 2, seat: s, codes: [1, 1], dur: 99999 })), 1, { [SIDS[0]]: 1, [SIDS[1]]: 2 }, xl, null);
  eq('time clamped to 3600', xl[pid(SIDS[0])].cm['0:1'][1], 3600);
  const xn = {};
  creditCareerMatch([0, 1].map((s) => rec({ mt: 1, pc: 2, seat: s, codes: [1, 1], dur: -50 })), 1, { [SIDS[0]]: 1, [SIDS[1]]: 2 }, xn, null);
  eq('negative time = 0', xn[pid(SIDS[0])].cm['0:1'][1], 0);
  eq('endless mt is not a match credit', creditCareerMatch(gp, 7, null, {}, null), 0);
}

console.log('=== creditCareerEndless ===');
{
  const tail = (sd, ed, fl) => [sd, ed, 0, 0, 1, fl, 0, 0, 0, 0, 0, 0];
  const xs = {};
  const gc = [0, 1].map((s) => rec({ mt: 7, pc: 2, seat: s, tail: tail(0, 6, 0), codes: [2, 4], dur: 1500 }));
  creditCareerEndless(gc, { startDepth: 0, endDepth: 6, flags: 0 }, xs, null, { segmented: false, forced: false });
  eq('casual co-op: one record = one game, chosen character', xs[pid(SIDS[1])].cm['4:4'], [1, 1500, 0, 0]);
  const xg = {};
  const gs = [rec({ mt: 7, pc: 1, seat: 0, dur: 900 })];
  creditCareerEndless(gs, { startDepth: 0, endDepth: 5, flags: 0 }, xg, null, { segmented: true, forced: true });
  eq('solo segment mid-run: time only, default miner (forced)', xg[pid(SIDS[0])].cm['4:1'], [0, 900, 0, 0]);
  creditCareerEndless(gs, { startDepth: 5, endDepth: 10, flags: 2 }, xg, null, { segmented: true, forced: true });
  eq('solo FINAL segment: the session counts one game', xg[pid(SIDS[0])].cm['4:1'], [1, 1800, 0, 0]);
  creditCareerEndless(gs, { startDepth: 10, endDepth: 12, flags: 1 }, xg, null, { segmented: true, forced: true });
  eq('solo SUSPENDED segment (save and quit) ends a session too; time capped by depth 2 x 300 -> 600', xg[pid(SIDS[0])].cm['4:1'], [2, 2400, 0, 0]);
  const xz = {};
  creditCareerEndless([rec({ mt: 7, pc: 1, seat: 0, dur: 5000 })], { startDepth: 3, endDepth: 3, flags: 2 }, xz, null, { segmented: true, forced: true });
  eq('zero-depth segment: floor cap 600 s', xz[pid(SIDS[0])].cm['4:1'], [1, 600, 0, 0]);
  eq('careerSecOf endless 5 levels', careerSecOf(4, 9999, { startDepth: 0, endDepth: 5 }), 1500);
  const xab = {};
  creditCareerEndless([0, 1].map((s) => rec({ mt: 7, pc: 2, seat: s, tail: tail(0, 4, 0), codes: [2, 4], disp: s === 1 ? 5 : 0 })), { startDepth: 0, endDepth: 4, flags: 0 }, xab, null, { segmented: false, forced: false });
  eq('endless abandoner counts nothing', xab[pid(SIDS[1])], undefined);
}

console.log('=== careerBlockOf v2 ===');
{
  eq('no state -> null', careerBlockOf(null), null);
  eq('empty state -> null', careerBlockOf({ games: 3 }), null);
  const st = { cg: 3, cw: 2, cl: 1, cm: { '0:3': [2, 960, 1, 1], '1:2': [1, 600, 1, 0], '2:4': [1, 900, 0, 0], '4:1': [2, 2400, 0, 0], '0:0': [1, 120, 0, 0] } };
  const b = careerBlockOf(st);
  eq('length 6 + 2 x 5 x 2 + 3 x 5', b.length, 41);
  eq('head = v1 meaning + ver 2', b.slice(0, 5), [0xCA, 2, 3, 2, 1]);
  eq('matrix header', b[5] >>> 0, (0xC2 | (5 << 8) | (5 << 16) | (3 << 24)) >>> 0);
  const cellAt = (m, c) => { let i = 6; for (let mm = 0; mm < 5; mm++) for (let cc = 0; cc < 5; cc++) { const wl = (3 >> mm) & 1; if (mm === m && cc === c) return wl ? [b[i], b[i + 1]] : [b[i]]; i += wl ? 2 : 1; } return null; };
  eq('quick strongman: games 2 | 16 min, wins 1 | losses 1', cellAt(0, 3), [2 | (16 << 16), 1 | (1 << 16)]);
  eq('private tamer: games 1 | 15 min (no W/L int)', cellAt(2, 4), [1 | (15 << 16)]);
  eq('endless default: games 2 | 40 min', cellAt(4, 1), [2 | (40 << 16)]);
  eq('unknown column kept', cellAt(0, 0), [1 | (2 << 16), 0]);
  const fold = careerBlockOf({ cg: 1, cw: 1, cl: 0, cm: { '0:9': [1, 300, 1, 0], '0:0': [1, 60, 0, 1] } });
  eq('a code beyond the columns folds into column 0', [fold[6], fold[7]], [2 | (6 << 16), 1 | (1 << 16)]);
  const sat = careerBlockOf({ cg: 70000, cw: 1, cl: 1, cm: { '0:1': [70000, 70000 * 120, 70000, 3] } });
  eq('16-bit saturation stops at 65535', [sat[2], sat[8], sat[9]], [70000, (0xFFFF | (0xFFFF << 16)) | 0, (0xFFFF | (3 << 16)) | 0]);
  eq('state with only matrix cells (never played matchmade) still publishes', careerBlockOf({ cm: { '3:1': [1, 300, 0, 0] } }).slice(0, 5), [0xCA, 2, 0, 0, 0]);
}

console.log('=== careerEnsureWrites (cells moved, XP did not) ===');
{
  const changedXp = { [SIDS[0]]: 500 };
  const xp = { [SIDS[0]]: 450, [SIDS[1]]: 1200 };
  const n = careerEnsureWrites(new Set([SIDS[0], SIDS[1], SIDS[2]]), changedXp, xp);
  eq('rewrites only the one with a known board score and no xp change', n, 1);
  eq('same score as the board', changedXp[SIDS[1]], 1200);
  eq('an xp change is never touched', changedXp[SIDS[0]], 500);
  eq('unknown board score -> no guessed write', changedXp[SIDS[2]], undefined);
}

console.log('=== source pins: every credit site is followed by its career call; the write rewrites + refills ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const after = (a, b) => { const i = src.indexOf(a); return i >= 0 && src.indexOf(b, i) > i && src.indexOf(b, i) - i < 900; };
  assert('matchmade creditXp -> creditCareerMatch', after('if (xpId) creditXp(g, matchType, scores, rankOf, xp, changedXp, xpState, leavers, today, progFrac, careerDet, spSet,', 'creditCareerMatch(g, matchType, rankOf, xpState, careerTouched)'));
  assert('private -> creditCareerMatch', after('if (xpId) creditXpPrivate(g, rankOf, lvP, xp, changedXp, xpState, today, spSet);', 'creditCareerMatch(g, matchType, rankOf, xpState, careerTouched)'));
  assert('bots -> creditCareerMatch (no ranks)', after('if (xpId) creditXpBot(g, lvB, xp, changedXp, xpState, today, spSet, !!c.botLone, sigB.use && MSIG.BOTS);', 'creditCareerMatch(g, matchType, null, xpState, careerTouched)'));
  // O198 v1 (knife 5.5b-1 S3): the solo lane's reject-window branch pays the segment's XP on purpose WITHOUT a career credit
  //   (user ruling 0-3: the XP counts, the career W-L does not) -- that one credit is taken out of the count, pinned by its text
  const WIN_XP = "if (xpId) creditXpEndless(c.g, { startDepth: Math.max(f.startDepth | 0, plan.proven | 0), endDepth: f.endDepth }, xp, changedXp, spSet, classic ? CLASSIC.XP_MUL : 1);   // S3: same credit as a settle";
  assert('the reject-window XP credit is there once (S3), inside the scInWin branch', src.split(WIN_XP).length === 2 && src.indexOf(WIN_XP) > src.indexOf('if (scInWin) {'));
  const nEndlessXp = src.split('if (xpId) creditXpEndless(').length - 1 - (src.split(WIN_XP).length - 1);
  const nEndlessCareer = src.split('creditCareerEndless(').length - 2;   // minus the definition
  eq('every endless XP credit has a career credit (the reject-window one aside)', [nEndlessXp, nEndlessCareer], [4, 4]);
  const iEns = src.indexOf('careerEnsureWrites(careerTouched, changedXp, xp)'), iFill = src.indexOf('careerRefilled = fillCareerDetails(changedXp, careerDet, xpState)'), iW = src.indexOf('const wXp = await mapPool(Object.keys(changedXp)');
  assert('same-score rewrites, then refill, then the xp write', iEns > 0 && iFill > iEns && iW > iFill);
  // mutation self-check: drop the private career call -> the pin goes red
  const mut = src.replace('      if (xpId) creditCareerMatch(g, matchType, rankOf, xpState, careerTouched);   // 5.4a career: games + time, no W/L (user 09-05)', '');
  const i2 = mut.indexOf('if (xpId) creditXpPrivate(g, rankOf, lvP, xp, changedXp, xpState, today, spSet);');
  const j2 = mut.indexOf('creditCareerMatch(g, matchType, rankOf, xpState, careerTouched)', i2);
  assert('mutation self-check: removing the private career call is caught', mut !== src && !(j2 > i2 && j2 - i2 < 900));
}

if (failN) { console.log('\ncareer-matrix: ' + failN + ' FAIL'); process.exit(1); }
console.log('\ncareer-matrix: all ok');
