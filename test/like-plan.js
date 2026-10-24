'use strict';
// Likes lane (O520, knife 5.4d L0): like-plan.js -- the pure rules validate.js (processLikes, L1) will call.
//   [1] the two row layouts: fixtures/like-box/cases.json is what tools/gen-like-box-fixtures.js gives today, every case
//       replays, encode / decode round trip, the constants the client mirrors
//   [2] a like in a match (kind 1), the five rules: not oneself / own record, matchmade, finished, settled and not voided
//       (waits in pend until the key is certified) / target at a consensus seat, voter at his own / no premade pair or trio;
//       a teammate in a team match under the pair rule (W79 rework: one per pair per 7 days, the board likes' token, also
//       when it waited for the settle) / one per voter per match, the first one taken
//   [3] a like on a board row / profile (kind 2), the three rules: not oneself, a known player / one per pair per 7 days on
//       this job's clock (the same click seen again never counts twice) / 50 a voter a day, the rest retried later
//   [4] lifetimes and fuses: stale entries, a far-future minute, pending expiry and queueing again, a late settle, the size caps
//   [5] seasons: the season count starts over, the lifetime count goes on
//   [6] idempotent: the same box rows again change nothing
//   [7] boardPlan: writes the rows that differ from the state, adopts what a lost state still shows on the board, never
//       takes a lower read, at most WRITE_MAX a run
//   [8] privacy: no SteamID / match hash / match key in the committed state; two likes of one voter share no token
//   [9] matchIndex: one record per writer (a finished one first), majority roster, a lone record, a split roster
//   [10] a state of a newer layout is left alone; the module stays pure (no clock, no env, no IO)
//   [11] tighter pins (W78 REVIEW section 6): the constants literally, certify never credits a taken like twice, implausible
//       targets, the day's slots start over, boardPlan reads one row per player
// Mutation harness (deliverable dir of W78): LIKE_PLAN_FILE=<copy> node test/like-plan.js runs these cases on a copy.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const LP_FILE = process.env.LIKE_PLAN_FILE || path.join(ROOT, 'like-plan.js');
const LP = require(LP_FILE);
const G = require(path.join(ROOT, 'tools', 'gen-like-box-fixtures.js'));
const { LIKE, encodeBox, decodeBox, countRow, decodeCount, matchIndex, certify, harvest, prune, boardPlan, publicState, keys } = LP;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const eq = (label, got, exp) => { const a = J(got), b = J(exp); T(label + ' = ' + a, a === b, 'expected ' + b); };

const kh = (s) => crypto.createHmac('sha256', 's').update(String(s)).digest('hex').slice(0, 16);   // validate.js pid, salt 's'
const K = keys(kh);
const DAY = 1440;
const T0 = 29877660;          // unix minute 2026-10-22
const S = (n) => '7656119800000' + String(1000 + n);   // plausible SteamIDs
const P = Array.from({ length: 8 }, (_, i) => S(i));
function split(sid) { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number(b >> 32n) | 0]; }
// a settle record (validate.js layout): [0xB1, ver, mt, mh, seed, seat, rank, lv<<1|host, pc, dur, scores x pc, disp, roster lo/hi x pc]
function rec(o) {
  const pc = o.roster.length;
  const d = [0xB1, 3, o.mt, o.mh, o.seed == null ? 77 : o.seed, o.seat, 1, 12, pc, 600];
  for (let s = 0; s < pc; s++) d.push(100 * s);
  d.push(o.disp | 0);
  for (const sid of o.roster) { const [lo, hi] = sid === '0' ? [0, 0] : split(sid); d.push(lo, hi); }
  return { steamID: o.sid, d };
}
// every seated human writes his own record of one match
function matchRecs(mt, mh, roster, opt) {
  opt = opt || {};
  return roster.map((sid, seat) => sid === '0' ? null : rec({ sid, mt, mh, seed: opt.seed, seat, roster, disp: (opt.disp && opt.disp[seat]) | 0 })).filter(Boolean);
}
const keyOf = (mt, mh, seed) => (mh | 0) + '_' + (seed == null ? 77 : seed) + '_' + (mt | 0);
const row = (voter, entries) => ({ voterSid: voter, det: encodeBox(entries) });
const ML = (t, mh, min) => ({ sid: t, ref: mh, kind: 1, min });
const BL = (t, min) => ({ sid: t, ref: 0, kind: 2, min });
const ctxOf = (recs, now, extra) => Object.assign({ kh, now, season: 0, match: matchIndex(recs), known: () => true }, extra || {});
const cnt = (st, sid) => st.cnt[K.target(sid)] || null;

console.log('=== like-plan (O520 likes lane, L0) ===');

// ---------------------------------------------------------------- [1] layouts
{
  const text = fs.readFileSync(G.FILE, 'utf8'), doc = JSON.parse(text);
  T('[1] fixtures/like-box/cases.json is what the generator gives today (node tools/gen-like-box-fixtures.js)', G.render(G.build(LP)) === text);
  const off = doc.cases.filter((c) => J(G.replay(LP, Object.assign({ kind: c.kind }, c.in))) !== J(c.out)).map((c) => c.name);
  T('[1] every case replays (' + doc.cases.length + ')', !off.length, off.join(' | '));
  T('[1] all four kinds present', ['box', 'unbox', 'count', 'uncount'].every((k) => doc.cases.some((c) => c.kind === k)));
  T('[1] null cases present (bad magic / version / size / short / not an array)', doc.cases.filter((c) => c.out === null).length >= 7);
  eq('[1] constants the client mirrors', [doc.consts.BOX_MAGIC, doc.consts.COUNT_MAGIC, doc.consts.BOX_MAX, doc.consts.PAIR_WEEK_MIN], [0xDD, 0xDC, 15, 7 * DAY]);
  // round trip over random entries
  let rt = 0, rtBad = 0, seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  for (let i = 0; i < 300; i++) {
    const n = rnd() % 16, es = [];
    for (let j = 0; j < n; j++) es.push({ sid: (76561197960265728n + BigInt(rnd()) * 7n).toString(), ref: (rnd() | 0), kind: 1 + (rnd() & 1), min: T0 + (rnd() % 100000) });
    const dec = decodeBox(encodeBox(es));
    const want = es.slice(0, LIKE.BOX_MAX).map((e) => ({ sid: e.sid, ref: e.kind === 2 ? e.ref | 0 : e.ref | 0, kind: e.kind, min: e.min }));
    rt++; if (!dec || J(dec.entries) !== J(want)) rtBad++;
  }
  T('[1] decodeBox(encodeBox(x)) = x for 300 random queues (<= 15 entries kept)', rtBad === 0, rtBad + ' of ' + rt);
  const c = { n: 9, sn: 2, s: 4, m: 6, b: 3 }, r = countRow(c);
  eq('[1] decodeCount(countRow(c)) = c', decodeCount(r.score, r.details), c);
  T('[1] encodeBox writes at most 61 ints (a row holds 64)', encodeBox(Array.from({ length: 20 }, (_, i) => BL(P[1], T0 + i))).length === 61);
}

// ---------------------------------------------------------------- [2] kind 1
{
  const roster = [P[0], P[1], P[2], P[3]], mh = 424242, mt = 1, m = keyOf(mt, mh);
  const recs = matchRecs(mt, mh, roster);
  // a. waits for the settle, then counts once
  let st = {};
  let r = harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 1));
  T('[2a] seen before the settle: pended, nothing counted', r.pended === 1 && !r.counted.length && !cnt(st, P[2]), J(r));
  r = harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 6));
  T('[2a] seen again while waiting: one pending entry, no second', r.why.waiting === 1 && Object.keys(st.pend).length === 1);
  const c1 = certify(st, [m], { kh, now: T0 + 11, season: 0 });
  T('[2a] the settle certifies the key and counts the waiting like', c1.certified === 1 && c1.resolved.length === 1 && Object.keys(st.pend).length === 0);
  eq('[2a] target count', cnt(st, P[2]), { n: 1, s: 1, sn: 0, m: 1, b: 0 });
  r = harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 16));
  T('[2a] the same entry after the settle: dup, still 1', r.why.dup === 1 && cnt(st, P[2]).n === 1);
  // b. a like seen after the settle counts at once
  r = harvest(st, [row(P[1], [ML(P[3], mh, T0 + 2)])], ctxOf(recs, T0 + 21));
  T('[2b] seen after the settle: counted at once', r.counted.length === 1 && cnt(st, P[3]).n === 1 && r.pended === 0);
  // c. oneself
  r = harvest({}, [row(P[0], [ML(P[0], mh, T0)])], ctxOf(recs, T0 + 1));
  T('[2c] liking oneself: self', r.why.self === 1 && !r.counted.length && !r.pended);
  // d. the voter did not finish
  {
    const rq = matchRecs(mt, mh, roster, { disp: { 0: 5 } });
    const s2 = {}; certify(s2, [m], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(rq, T0 + 1));
    T('[2d] voter quit (disp 5): unfinished', r.why.unfinished === 1 && !cnt(s2, P[2]));
    r = harvest(s2, [row(P[1], [ML(P[2], mh, T0)])], ctxOf(rq, T0 + 1));
    T('[2d] another voter of the same match who finished: counted', r.counted.length === 1);
  }
  // e. not matchmade
  for (const [mt2, label] of [[7, 'endless'], [10, 'friend room'], [11, 'bot match']]) {
    const s2 = {}, m2 = keyOf(mt2, mh); certify(s2, [m2], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(matchRecs(mt2, mh, roster), T0 + 1));
    T('[2e] ' + label + ' (mt ' + mt2 + '): notmm', r.why.notmm === 1 && !r.counted.length && !r.pended);
  }
  for (const mt2 of [2, 3, 4, 6, 9]) {
    const s2 = {}, m2 = keyOf(mt2, mh), ro = mt2 === 9 ? [P[0], P[1], P[2], P[3], P[4], P[5]] : roster; certify(s2, [m2], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(ro[ro.length - 1], mh, T0)])], ctxOf(matchRecs(mt2, mh, ro), T0 + 1));
    T('[2e] matchmade mt ' + mt2 + ' (an opponent): counted', r.counted.length === 1, J(r.why));
  }
  // f. target not at a seat / a bot seat
  {
    const ro = [P[0], P[1], P[2], '0'], s2 = {}; certify(s2, [m], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[6], mh, T0), ML(P[2], mh, T0)])], ctxOf(matchRecs(mt, mh, ro), T0 + 1));
    T('[2f] a player not in the roster: notin; the next entry (same match) still counts', r.why.notin === 1 && r.counted.length === 1 && r.counted[0].sid === P[2]);
    eq('[2f] a bot seat holds no SteamID (roster seat 3 absent)', Object.keys(matchIndex(matchRecs(mt, mh, ro))(P[0], mh).roster), ['0', '1', '2']);
  }
  // g. the voter's record is not at his own seat in the consensus roster
  {
    const rq = matchRecs(mt, mh, roster);
    rq.push(rec({ sid: P[6], mt, mh, seat: 1, roster }));   // an outside account claims seat 1
    const s2 = {}; certify(s2, [m], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[6], [ML(P[2], mh, T0)])], ctxOf(rq, T0 + 1));
    T('[2g] a writer the consensus roster does not seat: seat', r.why.seat === 1 && !r.counted.length);
  }
  // h. premade pair (FFA party bits)
  {
    const mtp = 1 | (1 << 4), mp = keyOf(mtp, mh), s2 = {}; certify(s2, [mp], { kh, now: T0, season: 0 });
    const ix = matchRecs(mtp, mh, roster);
    r = harvest(s2, [row(P[0], [ML(P[1], mh, T0)]), row(P[1], [ML(P[0], mh, T0)]), row(P[2], [ML(P[3], mh, T0)])], ctxOf(ix, T0 + 1));
    T('[2h] premade pair (seats 0+1) both ways: premade x2; seats 2 -> 3 (no bit): counted', r.why.premade === 2 && r.counted.length === 1 && r.counted[0].sid === P[3]);
    r = harvest(s2, [row(P[0], [ML(P[2], mh, T0 + 1)])], ctxOf(ix, T0 + 2));
    T('[2h] a pair member likes an opponent: counted', r.counted.length === 1);
  }
  // i. premade trio
  {
    const ro6 = [P[0], P[1], P[2], P[3], P[4], P[5]], mtt = 1 | (2 << 8), mtk = keyOf(mtt, mh), s2 = {}; certify(s2, [mtk], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[1], [ML(P[3], mh, T0)]), row(P[4], [ML(P[0], mh, T0)])], ctxOf(matchRecs(mtt, mh, ro6), T0 + 1));
    T('[2i] trio at seats 1-3: 1 -> 3 premade; 4 -> 0 counted', r.why.premade === 1 && r.counted.length === 1 && r.counted[0].sid === P[0]);
  }
  // j. team matches (W79 rework): a teammate counts under the pair rule (one per pair per 7 days, the board likes' token),
  //    an opponent every match
  {
    const mtk5 = keyOf(5, mh), s2 = {}; certify(s2, [mtk5], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[1], mh, T0)]), row(P[2], [ML(P[0], mh, T0)])], ctxOf(matchRecs(5, mh, roster), T0 + 1));
    T('[2j] 2V2: a stranger teammate (0 -> 1) counted, the opponent (2 -> 0) too', r.counted.length === 2 && !r.why.team && cnt(s2, P[1]).n === 1 && cnt(s2, P[0]).n === 1, J(r));
    T('[2j] the teammate like took the pair token (job clock), the opponent like none', s2.pr[K.pair(P[0], P[1])] === T0 + 1 && s2.pr[K.pair(P[2], P[0])] === undefined && Object.keys(s2.pr).length === 1);
    // the same four again in a second 2V2 two days later: the teammate like is held by the pair week, the opponent counts
    const mh2 = mh + 1, mtk5b = keyOf(5, mh2); certify(s2, [mtk5b], { kh, now: T0 + 2 * DAY, season: 0 });
    const recs2 = matchRecs(5, mh, roster).concat(matchRecs(5, mh2, roster));
    r = harvest(s2, [row(P[0], [ML(P[1], mh, T0), ML(P[1], mh2, T0 + 2 * DAY)]), row(P[2], [ML(P[0], mh2, T0 + 2 * DAY)])], ctxOf(recs2, T0 + 2 * DAY + 1));
    T('[2j] second match within 7 days: the teammate like refused (pair), the opponent like counted', r.why.pair === 1 && r.why.dup === 1 && r.counted.length === 1 && r.counted[0].sid === P[0] && cnt(s2, P[1]).n === 1 && cnt(s2, P[0]).n === 2, J(r));
    T('[2j] ... not taken: no match token for it, the pair minute unchanged', s2.mt[K.match(P[0], mtk5b)] === undefined && s2.pr[K.pair(P[0], P[1])] === T0 + 1);
    // a board like of the same pair within the week: held by the same token (week)
    r = harvest(s2, [row(P[0], [BL(P[1], T0 + 3 * DAY)])], ctxOf(recs2, T0 + 3 * DAY));
    T('[2j] a board like of the pair within 7 days of the teammate like: week, not counted', r.why.week === 1 && !r.counted.length && cnt(s2, P[1]).n === 1);
    // the other way round: a board like first, then a teammate like inside its week
    const s4 = {}; harvest(s4, [row(P[0], [BL(P[1], T0)])], ctxOf([], T0));
    certify(s4, [mtk5], { kh, now: T0 + 1, season: 0 });
    r = harvest(s4, [row(P[0], [ML(P[1], mh, T0 + 1)])], ctxOf(matchRecs(5, mh, roster), T0 + 2));
    T('[2j] a teammate like within 7 days of a board like of the pair: pair, not counted (b 1, m 0)', r.why.pair === 1 && J(cnt(s4, P[1])) === J({ n: 1, s: 1, sn: 0, m: 0, b: 1 }));
    // after the week the next teammate like counts again
    const mh3 = mh + 2, mtk5c = keyOf(5, mh3), now3 = T0 + 1 + 7 * DAY;
    certify(s2, [mtk5c], { kh, now: now3, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[1], mh3, now3)])], ctxOf(matchRecs(5, mh3, roster), now3));
    T('[2j] a teammate like 7 days after the last counted one: counted, the pair minute moves on', r.counted.length === 1 && cnt(s2, P[1]).n === 2 && s2.pr[K.pair(P[0], P[1])] === now3, J(r));
    // waiting for the settle: the pair rule is checked when it counts (certify), with the token carried in the waiting entry
    const s5 = {}, rq = matchRecs(5, 7001, roster).concat(matchRecs(5, 7002, roster));
    r = harvest(s5, [row(P[0], [ML(P[1], 7001, T0), ML(P[1], 7002, T0 + 1)])], ctxOf(rq, T0 + 2));
    T('[2j] two teammate likes of two matches before their settles: both wait, each holding the pair token', r.pended === 2 && Object.values(s5.pend).every((p) => p.p === K.pair(P[0], P[1])), J(s5.pend));
    const c5 = certify(s5, [keyOf(5, 7001), keyOf(5, 7002)], { kh, now: T0 + 10, season: 0 });
    T('[2j] both matches settle in one run: one like counts, the second is dropped by the pair week (pair 1)', c5.resolved.length === 1 && c5.pair === 1 && cnt(s5, P[1]).n === 1 && !Object.keys(s5.pend).length && s5.pr[K.pair(P[0], P[1])] === T0 + 10, J(c5));
    const s6 = {}; harvest(s6, [row(P[2], [ML(P[0], 7001, T0)])], ctxOf(rq, T0 + 2));
    T('[2j] a waiting opponent like holds no pair token', Object.values(s6.pend).length === 1 && Object.values(s6.pend)[0].p === undefined);
    const ro6 = [P[0], P[1], P[2], P[3], P[4], P[5]], mtk8 = keyOf(8, mh), s3 = {}; certify(s3, [mtk8], { kh, now: T0, season: 0 });
    r = harvest(s3, [row(P[0], [ML(P[2], mh, T0)]), row(P[3], [ML(P[2], mh, T0)])], ctxOf(matchRecs(8, mh, ro6), T0 + 1));
    T('[2j] 3V3: seats 0 -> 2 teammates counted (pair token), 3 -> 2 opponents counted', r.counted.length === 2 && cnt(s3, P[2]).n === 2 && Object.keys(s3.pr).length === 1 && s3.pr[K.pair(P[0], P[2])] !== undefined, J(r));
    T('[2j] mateOf: same team in a team match only (2V2 0/1 yes, 0/2 no; 3V3 0/2 yes, 2/3 no; FFA never)', LP.mateOf(5, 0, 1) && !LP.mateOf(5, 0, 2) && LP.mateOf(8, 0, 2) && !LP.mateOf(8, 2, 3) && !LP.mateOf(1, 0, 1) && !LP.mateOf(1 | (1 << 4), 0, 1));
    T('[2j] unitOf: no team-match reason any more (the pair rule replaces it); the switch is gone', LP.unitOf(5, 0, 1) === null && LP.unitOf(8, 0, 2) === null && LIKE.TEAMMATES_COUNT === undefined);
  }
  // k. one like per voter per match
  {
    const s2 = {}; certify(s2, [m], { kh, now: T0, season: 0 });
    r = harvest(s2, [row(P[0], [ML(P[1], mh, T0), ML(P[2], mh, T0 + 1)])], ctxOf(recs, T0 + 2));
    T('[2k] two likes of one match by one voter: the first counts, the second dup', r.counted.length === 1 && r.counted[0].sid === P[1] && r.why.dup === 1);
    const s3 = {};
    r = harvest(s3, [row(P[0], [ML(P[1], mh, T0), ML(P[2], mh, T0 + 1)])], ctxOf(recs, T0 + 2));
    T('[2k] the same before the settle: the first pends, the second waits behind it', r.pended === 1 && r.why.waiting === 1);
    certify(s3, [m], { kh, now: T0 + 5, season: 0 });
    T('[2k] the settle credits only the first', cnt(s3, P[1]) && cnt(s3, P[1]).n === 1 && !cnt(s3, P[2]));
  }
  // l. ambiguous / no record / bad
  {
    const rq = recs.concat([rec({ sid: P[0], mt, mh, seed: 99, seat: 0, roster })]);
    r = harvest({}, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(rq, T0 + 1));
    T('[2l] two keys with the voter\'s hash: ambig', r.why.ambig === 1);
    r = harvest({}, [row(P[0], [ML(P[2], 31337, T0), { sid: P[2], ref: 0, kind: 1, min: T0 }, { sid: P[2], ref: 5, kind: 3, min: T0 }])], ctxOf(recs, T0 + 1));
    T('[2l] no record with that hash: norec (no state); ref 0 / kind 3: bad', r.why.norec === 1 && r.why.bad === 2 && !r.pended);
    r = harvest({}, [{ voterSid: 'x', det: encodeBox([ML(P[2], mh, T0)]) }, { voterSid: P[0], det: [1, 2, 3] }], ctxOf(recs, T0 + 1));
    T('[2l] implausible voter / not a box row: badrow', r.why.badrow === 2);
  }
  // m. a settle resolves only the likes of its own key
  {
    const rq = matchRecs(mt, 1001, roster).concat(matchRecs(mt, 1002, roster));
    const s2 = {};
    r = harvest(s2, [row(P[0], [ML(P[2], 1001, T0)]), row(P[1], [ML(P[3], 1002, T0)])], ctxOf(rq, T0 + 1));
    const c = certify(s2, [keyOf(mt, 1001)], { kh, now: T0 + 5, season: 0 });
    T('[2m] two waiting likes of two matches, one settles: only its like counts, the other keeps waiting', r.pended === 2 && c.resolved.length === 1 && cnt(s2, P[2]) && !cnt(s2, P[3]) && Object.keys(s2.pend).length === 1);
    certify(s2, [keyOf(mt, 1001)], { kh, now: T0 + 10, season: 0 });
    T('[2m] certifying the same key again changes nothing', cnt(s2, P[2]).n === 1 && Object.keys(s2.pend).length === 1);
  }
}

// ---------------------------------------------------------------- [3] kind 2
{
  let st = {};
  const now0 = T0 + 100;
  let r = harvest(st, [row(P[0], [BL(P[1], now0)])], ctxOf([], now0, { known: (s) => s !== P[1] }));
  T('[3a] a player this job does not know: unknown, nothing minted', r.why.unknown === 1 && !Object.keys(st.bt).length);
  r = harvest(st, [row(P[0], [BL(P[0], now0)])], ctxOf([], now0));
  T('[3a] oneself: self', r.why.self === 1);
  r = harvest(st, [row(P[0], [BL(P[1], now0)])], ctxOf([], now0 + 1));
  eq('[3b] first board like counts', cnt(st, P[1]), { n: 1, s: 1, sn: 0, m: 0, b: 1 });
  r = harvest(st, [row(P[0], [BL(P[1], now0)])], ctxOf([], now0 + 6));
  T('[3b] the same click on the next run: dup', r.why.dup === 1 && cnt(st, P[1]).n === 1);
  const q = [BL(P[1], now0), BL(P[1], now0 + 3 * DAY)];
  r = harvest(st, [row(P[0], q)], ctxOf([], now0 + 3 * DAY + 1));
  T('[3b] a second click 3 days later: week', r.why.week === 1 && cnt(st, P[1]).n === 1);
  r = harvest(st, [row(P[0], q)], ctxOf([], now0 + 7 * DAY + 2));
  T('[3b] past the week (job clock): the newer click counts, the old one stays dup', r.counted.length === 1 && cnt(st, P[1]).n === 2 && r.why.dup === 1);
  r = harvest(st, [row(P[0], q)], ctxOf([], now0 + 7 * DAY + 3));
  T('[3b] and neither counts again on the next run', !r.counted.length && cnt(st, P[1]).n === 2);
  // the client minute decides nothing: a click stamped far back in time within the entry window does not skip the week
  const s2 = {};
  harvest(s2, [row(P[0], [BL(P[1], now0)])], ctxOf([], now0));
  r = harvest(s2, [row(P[0], [BL(P[1], now0 - 6 * DAY)])], ctxOf([], now0 + 1));
  T('[3b] a second click stamped 6 days earlier, 1 minute later on the job clock: week', r.why.week === 1);
  r = harvest(s2, [row(P[1], [BL(P[0], now0)])], ctxOf([], now0 + 2));
  T('[3b] the other direction is its own pair: counted', r.counted.length === 1 && cnt(s2, P[0]).n === 1);
  // c. daily cap
  const s3 = {}, voter = P[7], tg = (i) => '7656119900000' + String(1000 + i);
  let total = 0, capped = 0;
  const day0 = T0 - (T0 % DAY) + 60;   // 01:00 UTC of a day
  const queues = [];
  for (let run = 0; run < 4; run++) {
    const qq = Array.from({ length: 15 }, (_, i) => BL(tg(run * 15 + i), day0 + run * 10));
    queues.push(qq);
    r = harvest(s3, [row(voter, qq)], ctxOf([], day0 + run * 10 + 1));
    total += r.counted.length; capped += (r.why.capped | 0);
  }
  T('[3c] 60 board likes in one day: 50 counted, 10 capped', total === 50 && capped === 10, total + '/' + capped);
  T('[3c] nothing minted for the capped ones', Object.keys(s3.bt).length === 50 && Object.keys(s3.pr).length === 50);
  T('[3c] the day count sits in slot tokens, not under the voter', s3.day.s.length === 50 && !J(s3).includes(voter));
  r = harvest(s3, [row(voter, queues[3])], ctxOf([], day0 + DAY));
  T('[3c] next day the 10 still queued count', r.counted.length === 10 && !r.why.capped, J(r.why));
  T('[3c] ... and the day starts over in the state: only the new day\'s 10 slots, the old day\'s dropped', s3.day.d === Math.floor((day0 + DAY) / DAY) && s3.day.s.length === 10, J({ d: s3.day.d, n: s3.day.s.length }));
  r = harvest(s3, [row(P[6], [BL(tg(1), day0 + 20)])], ctxOf([], day0 + 30));
  T('[3c] another voter is not held by the first one\'s cap', r.counted.length === 1);
}

// ---------------------------------------------------------------- [4] lifetimes and fuses
{
  const roster = [P[0], P[1], P[2], P[3]], mh = 5150, mt = 2, m = keyOf(mt, mh), recs = matchRecs(mt, mh, roster);
  let st = {};
  let r = harvest(st, [row(P[0], [BL(P[1], T0 - LIKE.ENTRY_TTL_MIN - 1), ML(P[2], mh, T0 - LIKE.ENTRY_TTL_MIN - 1)])], ctxOf(recs, T0));
  T('[4a] entries older than ENTRY_TTL_MIN: stale x2, nothing kept', r.why.stale === 2 && !Object.keys(st.pend).length && !Object.keys(st.bt).length);
  // b. far-future minute: the token outlives the entry's freshness
  st = {};
  const fut = T0 + 3 * DAY;
  harvest(st, [row(P[0], [BL(P[1], fut)])], ctxOf([], T0));
  const et = K.entry(P[0], P[1], fut);
  T('[4b] a board click stamped 3 days ahead: counted, token stamped at its minute', cnt(st, P[1]).n === 1 && st.bt[et] === fut);
  prune(st, fut + LIKE.ENTRY_TTL_MIN);
  T('[4b] token kept until ENTRY_TTL_MIN after that minute', st.bt[et] === fut);
  prune(st, fut + LIKE.ENTRY_TTL_MIN + 1);
  r = harvest(st, [row(P[0], [BL(P[1], fut)])], ctxOf([], fut + LIKE.ENTRY_TTL_MIN + 1));
  T('[4b] once pruned the entry is stale: not counted again', st.bt[et] === undefined && r.why.stale === 1 && cnt(st, P[1]).n === 1);
  const far = T0 + 30 * DAY;
  harvest(st, [row(P[2], [BL(P[3], far)])], ctxOf([], T0));
  T('[4b] a minute further ahead than ENTRY_TTL_MIN is stamped now + ENTRY_TTL_MIN', st.bt[K.entry(P[2], P[3], far)] === T0 + LIKE.ENTRY_TTL_MIN);
  // c. pending expiry, queueing again, a late settle
  st = {};
  harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 1));
  prune(st, T0 + 1 + LIKE.PENDING_TTL_MIN);
  T('[4c] pending kept PENDING_TTL_MIN', Object.keys(st.pend).length === 1);
  prune(st, T0 + 2 + LIKE.PENDING_TTL_MIN);
  T('[4c] then dropped', Object.keys(st.pend).length === 0);
  r = harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 3 * DAY));
  T('[4c] the entry still on the box queues again', r.pended === 1);
  certify(st, [m], { kh, now: T0 + 3 * DAY + 5, season: 0 });
  T('[4c] a settle 3 days late still counts it', cnt(st, P[2]) && cnt(st, P[2]).n === 1);
  // a pending whose entry left the box resolves without it
  const s2 = {};
  harvest(s2, [row(P[1], [ML(P[3], mh, T0 + 2)])], ctxOf(recs, T0 + 3));
  const res = certify(s2, [m], { kh, now: T0 + 9, season: 0 });
  T('[4c] certify resolves a pending with no box row this run', res.resolved.length === 1 && res.resolved[0] === K.target(P[3]));
  T('[4c] the resolved token is stamped from the entry minute', s2.mt[K.match(P[1], m)] === T0 + 9);
  // d. a like seen after the key's OK window waits, it does not count
  const s3 = {};
  certify(s3, [m], { kh, now: T0, season: 0 });
  prune(s3, T0 + LIKE.OK_TTL_MIN + 1);
  r = harvest(s3, [row(P[1], [ML(P[0], mh, T0 + LIKE.OK_TTL_MIN)])], ctxOf(recs, T0 + LIKE.OK_TTL_MIN + 2));
  T('[4d] past OK_TTL_MIN the key takes no like (pends, never certified twice)', r.pended === 1 && !r.counted.length);
  T('[4d] OK_TTL_MIN < ENTRY_TTL_MIN (a pruned entry token cannot meet a certified key again)', LIKE.OK_TTL_MIN < LIKE.ENTRY_TTL_MIN && LIKE.PENDING_TTL_MIN <= LIKE.ENTRY_TTL_MIN);
  // e. fuses
  const s4 = { ok: {}, mt: {} };
  for (let i = 0; i < LIKE.OK_MAX + 5; i++) s4.ok['k' + String(i).padStart(6, '0')] = T0 + i;
  for (let i = 0; i < LIKE.TOKENS_MAX + 3; i++) s4.mt['t' + String(i).padStart(6, '0')] = T0 + i;
  const pr = prune(s4, T0 + 1000);
  T('[4e] size fuses drop the oldest first (ok +5, mt +3)', pr.evicted === 8 && s4.ok.k000000 === undefined && s4.ok.k000005 !== undefined && s4.mt.t000002 === undefined && s4.mt.t000003 !== undefined);
}

// ---------------------------------------------------------------- [5] seasons
{
  const st = {};
  harvest(st, [row(P[0], [BL(P[1], T0)])], ctxOf([], T0 + 1, { season: 0 }));
  harvest(st, [row(P[2], [BL(P[1], T0 + 10)])], ctxOf([], T0 + 11, { season: 0 }));
  harvest(st, [row(P[3], [BL(P[1], T0 + 20)])], ctxOf([], T0 + 21, { season: 1 }));
  eq('[5] a new season: season count starts over, lifetime goes on', cnt(st, P[1]), { n: 3, s: 1, sn: 1, m: 0, b: 3 });
  eq('[5] the row shows the season it belongs to', countRow(cnt(st, P[1])).details, [0xDC | (1 << 8), 1, 1, 0, 3]);
}

// ---------------------------------------------------------------- [6] idempotent
{
  const roster = [P[0], P[1], P[2], P[3]], mh = 777, m = keyOf(1, mh), recs = matchRecs(1, mh, roster);
  const st = {};
  certify(st, [m], { kh, now: T0, season: 0 });
  const rows = [row(P[0], [ML(P[1], mh, T0), BL(P[2], T0 + 1)]), row(P[3], [ML(P[0], mh, T0), BL(P[1], T0)])];
  const r1 = harvest(st, rows, ctxOf(recs, T0 + 5));
  const s1 = J(publicState(st));
  const r2 = harvest(st, rows, ctxOf(recs, T0 + 10));
  T('[6] first run counts 4', r1.counted.length === 4);
  T('[6] the same rows again: nothing counted, committed state unchanged', !r2.counted.length && J(publicState(st)) === s1);
}

// ---------------------------------------------------------------- [7] boardPlan
{
  const st = {};
  const now = T0 + 50, ctx = ctxOf([], now);
  harvest(st, [row(P[0], [BL(P[1], now), BL(P[2], now)]), row(P[3], [BL(P[2], now)])], ctx);
  let p = boardPlan(st, [], [P[1], P[2], P[5]], ctx);
  eq('[7] rows to write for liked players not on the board (none for one without likes)', p.writes.map((w) => [w.sid, w.score, w.details]), [[P[1], 1, [0xDC | 256, 0, 1, 0, 1]], [P[2], 2, [0xDC | 256, 0, 2, 0, 2]]]);
  const good = countRow(cnt(st, P[1]));
  const rows = [
    { sid: P[1], score: good.score, det: good.details },                 // as the state: left alone
    { sid: P[2], score: 1, det: [0xDC | 256, 0, 1, 0, 1] },              // stale read / failed write: rewritten
    { sid: P[4], score: 12, det: [0xDC | 256, 0, 5, 7, 5] },             // no state entry: adopted
    { sid: P[6], score: 3, det: [0xDB, 0] },                             // undecodable, no state: skipped
  ];
  p = boardPlan(st, rows, [P[1], P[2]], ctx);
  eq('[7] only the differing row is written', p.writes.map((w) => w.sid), [P[2]]);
  T('[7] a row the state lost is adopted into it (no write)', p.adopted === 1 && cnt(st, P[4]).n === 12 && cnt(st, P[4]).m === 7);
  T('[7] an undecodable row with no state is left alone', !cnt(st, P[6]));
  p = boardPlan(st, [{ sid: P[2], score: 9, det: [0xDC | 256, 0, 9, 0, 9] }], [], ctx);
  T('[7] a row above the state (an older state restored): state follows the board, no write', p.behind === 1 && !p.writes.length && cnt(st, P[2]).n === 9);
  p = boardPlan(st, [{ sid: P[1], score: 1, det: [0xDB] }], [], ctx);
  T('[7] a broken row of a counted player is rewritten', p.writes.length === 1 && p.writes[0].sid === P[1]);
  harvest(st, [row(P[1], [BL(P[1] === P[2] ? P[3] : P[2], now + 1)])], ctxOf([], now + 2));
  p = boardPlan(st, [{ sid: P[2], score: 9, det: [0xDC | 256, 0, 9, 0, 9] }], [], ctx);
  T('[7] a like on top of the adopted count: written as 10 (state + 1, never read + 1 twice)', p.writes.length === 1 && p.writes[0].score === 10);
  const big = {}, tg = (i) => '7656119900001' + String(1000 + i), sids = [];
  for (let i = 0; i < LIKE.WRITE_MAX + 50; i++) { big.cnt = big.cnt || {}; big.cnt[K.target(tg(i))] = { n: 1, s: 1, sn: 0, m: 0, b: 1 }; sids.push(tg(i)); }
  p = boardPlan(big, [], sids, ctx);
  T('[7] at most WRITE_MAX rows a run, the rest counted in more', p.writes.length === LIKE.WRITE_MAX && p.more === 50);
}

// ---------------------------------------------------------------- [8] privacy
{
  const roster = [P[0], P[1], P[2], P[3]], mh1 = 987654321, mh2 = 123123123;
  const recs = matchRecs(1, mh1, roster).concat(matchRecs(3, mh2, [P[0], P[4], P[5], P[6]], { seed: 55 }));
  const m1 = keyOf(1, mh1), m2 = keyOf(3, mh2, 55);
  const st = {};
  // every token of the committed state (voter side: the target counts are public anyway) -> its value
  const flat = (s) => {
    const o = publicState(s), f = new Map();
    for (const k of ['mt', 'bt', 'pr', 'pend', 'ok']) for (const t of Object.keys(o[k] || {})) f.set(t, J(o[k][t]));
    for (const p of Object.values(o.pend || {})) f.set(p.k, 'key');
    for (const t of ((o.day && o.day.s) || [])) f.set(t, 'slot');
    return f;
  };
  // the tokens one step adds or changes
  let before = flat(st);
  const step = (fn) => { fn(); const now = flat(st), t = [...now.keys()].filter((k) => before.get(k) !== now.get(k)); before = now; return t; };
  // like A (match, counted at once), like B (board), like C (match, waits, then its settle) -- one voter, three runs + a settle
  const A = step(() => { certify(st, [m1], { kh, now: T0, season: 0 }); harvest(st, [row(P[0], [ML(P[2], mh1, T0)])], ctxOf(recs, T0 + 1)); });
  const B = step(() => harvest(st, [row(P[0], [ML(P[2], mh1, T0), BL(P[3], T0 + 10)])], ctxOf(recs, T0 + 11)));
  const C = step(() => harvest(st, [row(P[0], [ML(P[2], mh1, T0), BL(P[3], T0 + 10), ML(P[5], mh2, T0 + 20)])], ctxOf(recs, T0 + 21)))
    .concat(step(() => certify(st, [m2], { kh, now: T0 + 26, season: 0 })));
  T('[8] each like wrote tokens (A ' + A.length + ', B ' + B.length + ', C ' + C.length + ')', A.length && B.length && C.length && cnt(st, P[5]) && cnt(st, P[5]).n === 1);
  const shared = A.filter((t) => B.indexOf(t) >= 0 || C.indexOf(t) >= 0).length + B.filter((t) => C.indexOf(t) >= 0).length;
  T('[8] three likes of one voter (match, board, a waiting one) share no token', shared === 0);
  const text = J(publicState(st));
  const leaks = [...P, String(mh1), String(mh2), m1, m2].filter((x) => text.indexOf(x) >= 0);
  T('[8] no SteamID, match hash or match key in the committed state', !leaks.length, leaks.join(','));
  T('[8] the target key is not validate.js pid (a domain of its own)', K.target(P[2]) !== kh(P[2]));
  T('[8] committed maps in key order', ['mt', 'bt', 'pr', 'pend', 'ok', 'cnt'].every((k) => { const ks = Object.keys(JSON.parse(text)[k] || {}); return J(ks) === J([...ks].sort()); }));
  // a second like of the same target on a board, after the week, reuses the pair token -- the one designed exception
  const s2 = {};
  harvest(s2, [row(P[0], [BL(P[3], T0)])], ctxOf([], T0 + 1));
  const a1 = flat(s2);
  harvest(s2, [row(P[0], [BL(P[3], T0 + 8 * DAY)])], ctxOf([], T0 + 8 * DAY + 1));
  const a2 = flat(s2), touched = [...a2.keys()].filter((k) => a1.get(k) !== a2.get(k) && a1.has(k));
  T('[8] the only earlier token a second like of the same target touches is the pair token', touched.length === 1 && touched[0] === K.pair(P[0], P[3]) && cnt(s2, P[3]).n === 2, J(touched));
}

// ---------------------------------------------------------------- [9] matchIndex
{
  const roster = [P[0], P[1], P[2], P[3]], mh = 4040, mt = 1;
  let ix = matchIndex([rec({ sid: P[0], mt, mh, seat: 0, roster })]);
  eq('[9] a lone record is its own majority', ix(P[0], mh), { m: keyOf(mt, mh), mt, vSeat: 0, vDisp: 0, roster: { 0: P[0], 1: P[1], 2: P[2], 3: P[3] } });
  T('[9] other accounts / hashes: null', ix(P[1], mh) === null && ix(P[0], mh + 1) === null);
  const alt = [P[0], P[5], P[2], P[3]];
  ix = matchIndex([rec({ sid: P[0], mt, mh, seat: 0, roster }), rec({ sid: P[2], mt, mh, seat: 2, roster: alt })]);
  T('[9] two records split on seat 1: no majority there', ix(P[0], mh).roster[1] === undefined && ix(P[0], mh).roster[0] === P[0]);
  ix = matchIndex([rec({ sid: P[0], mt, mh, seat: 0, roster, disp: 6 }), rec({ sid: P[0], mt, mh, seat: 0, roster, disp: 0 }), rec({ sid: P[1], mt, mh, seat: 1, roster })]);
  T('[9] one record per writer, a finished one first', ix(P[0], mh).vDisp === 0);
  ix = matchIndex([rec({ sid: P[0], mt, mh, seat: 0, roster }), { steamID: P[1], d: [0xB2, 3, mt, mh, 77, 1, 0, 0, 4, 0] }, { steamID: P[2], d: null }]);
  T('[9] non-settle rows are ignored', ix(P[1], mh) === null);
  ix = matchIndex([{ steamID: P[0], d: rec({ sid: P[0], mt, mh, seat: 0, roster }).d, dispCode: 4, roster: { 0: P[0], 1: P[1] } }]);
  T('[9] validate.js recs fields (dispCode, roster) are taken as given', ix(P[0], mh).vDisp === 4 && J(ix(P[0], mh).roster) === J({ 0: P[0], 1: P[1] }));
}

// ---------------------------------------------------------------- [10] layout guard and purity
{
  const st = { kv: LIKE.KV + 1, cnt: {}, pend: {}, ok: {} };
  const before = J(st);
  const ctx = ctxOf([], T0);
  const r = harvest(st, [row(P[0], [BL(P[1], T0)])], ctx);
  const c = certify(st, ['1_2_1'], ctx);
  const b = boardPlan(st, [{ sid: P[1], score: 5, det: [0xDC | 256, 0, 5, 0, 5] }], [P[1]], ctx);
  const p = prune(st, T0 + 99999);
  T('[10] a newer layout: harvest / certify / boardPlan / prune all defer and change nothing', r.deferred && c.deferred && b.deferred && p.deferred && J(st) === before);
  const empty = {};
  harvest(empty, [], ctx); prune(empty, T0);
  eq('[10] an untouched lane commits an empty state (no kv, no day)', publicState(empty), { cnt: {}, mt: {}, bt: {}, pr: {}, pend: {}, ok: {} });
  const src = fs.readFileSync(LP_FILE, 'utf8').replace(/\/\/.*$/gm, '');
  const reqs = [...src.matchAll(/require\(([^)]*)\)/g)].map((x) => x[1]);
  T('[10] the module requires only points-plan.js', J(reqs) === J(["'./points-plan.js'"]), J(reqs));
  T('[10] no clock, no env, no IO, no randomness in the module', !/Date\b|process\.|\bfs\b|Math\.random|setTimeout/.test(src));
}

// ---------------------------------------------------------------- [11] tighter pins (W78 REVIEW section 6, added by W79)
{
  // the plan's numbers, literally: a change to any of them has to show up here
  eq('[11] LIKE constants', LIKE, { BOX_LB: 'like_box', COUNT_LB: 'like_count', BOX_MAGIC: 0xDD, BOX_VER: 1, COUNT_MAGIC: 0xDC, COUNT_VER: 1, BOX_MAX: 15,
    KIND_MATCH: 1, KIND_BOARD: 2, KV: 1, ENTRY_TTL_MIN: 8 * DAY, PENDING_TTL_MIN: 2 * DAY, OK_TTL_MIN: 3 * DAY, PAIR_WEEK_MIN: 7 * DAY, PAIR_TTL_MIN: 8 * DAY,
    BOARD_DAILY_CAP: 50, TOKENS_MAX: 100000, PENDING_MAX: 20000, OK_MAX: 30000, PAIRS_MAX: 100000, WRITE_MAX: 400 });
  // certify never credits a like of a voter / match already taken (a waiting copy of it next to the taken one)
  const roster = [P[0], P[1], P[2], P[3]], mh = 6060, mt = 1, m = keyOf(mt, mh), recs = matchRecs(mt, mh, roster);
  const st = {};
  harvest(st, [row(P[0], [ML(P[2], mh, T0)])], ctxOf(recs, T0 + 1));
  const pendCopy = J(st.pend);
  certify(st, [m], { kh, now: T0 + 5, season: 0 });
  st.pend = JSON.parse(pendCopy);   // the waiting entry back (a state restored next to the taken token)
  const c = certify(st, [m], { kh, now: T0 + 10, season: 0 });
  T('[11] certify: a waiting like whose voter / match is taken already is dropped, not counted again', c.resolved.length === 0 && cnt(st, P[2]).n === 1 && !Object.keys(st.pend).length, J(c));
  // a target that is not a SteamID is refused, a board like and a match like alike (even with everyone known)
  const s2 = {}; certify(s2, [m], { kh, now: T0, season: 0 });
  const r = harvest(s2, [row(P[0], [BL('123', T0), ML('42', mh, T0), BL('0', T0)])], ctxOf(recs, T0 + 1));
  T('[11] implausible targets (too few digits / zero): bad, nothing counted or minted', r.why.bad === 3 && !r.counted.length && !Object.keys(s2.cnt).length && !Object.keys(s2.bt).length, J(r));
  // boardPlan: one row per player -- a second row of the same SteamID on the board is ignored
  const s3 = { cnt: { [K.target(P[1])]: { n: 3, s: 3, sn: 0, m: 1, b: 2 } } };
  const row3 = countRow(s3.cnt[K.target(P[1])]), row5 = countRow({ n: 5, s: 5, sn: 0, m: 1, b: 4 }), row1 = countRow({ n: 1, s: 1, sn: 0, m: 0, b: 1 });
  let b = boardPlan(s3, [{ sid: P[1], score: row3.score, det: row3.details }, { sid: P[1], score: row5.score, det: row5.details }], [P[1]], ctxOf([], T0));
  T('[11] boardPlan: a second, higher row of the same player is not adopted (the first one read is his row)', !b.writes.length && b.behind === 0 && cnt(s3, P[1]).n === 3, J(b));
  b = boardPlan(s3, [{ sid: P[1], score: row1.score, det: row1.details }, { sid: P[1], score: row1.score, det: row1.details }], [P[1]], ctxOf([], T0));
  T('[11] boardPlan: two low rows of one player -> one write, not two', b.writes.length === 1 && b.writes[0].sid === P[1] && b.writes[0].score === 3, J(b.writes));
}

console.log(failN ? ('like-plan: ' + failN + ' FAIL') : 'like-plan: all ok');
process.exit(failN ? 1 : 0);
