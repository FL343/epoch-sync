'use strict';
// O792 (2026-11-09, EA gap audit 2 C-04): a friends' room runs up to 30 levels since client O772 (was 3/6/9), and the sanity
//   duration bound DUR_CAP (7200 s) was derived from 9 levels (~41 min worst case). A record past it is dropped and its writer
//   flagged -- an honest 30-level room with host migrations, reconnects and every shop / gamble barrier at its timeout (the
//   job's own extrapolation ~137 min) would have lost its XP and taken a forgery flag per writer (architecture rule 10: never
//   punish the honest). durCapOf now scales the friends' room bound with the record's levels (d[7] >> 1; the clamp 15 = "15 or
//   more" and 0 = an old record read as the room maximum): (levels + 1) x PRIVATE_LEVEL_S, never below DUR_CAP.
//   [0] wiring + class tripwire: every duration bound goes through durCapOf (no direct compare against SANITY.DUR_CAP left);
//       the constants the companion lockstep pins (PRIVATE_LEVELS_MAX = the client ROOM_LEVEL_OPTS max)
//   [1] pure: durCapOf per code / per levels; the premise -- the bound clears the job's own worst-case extrapolation for the
//       longest room (41 min / 9 levels, linear) with margin; recordSanityFlags / sanityFlags / sanitySplit on long records
//   [2] main(): a 2-player 30-level friends' room whose records say 8400 s settles (XP for both), nobody flagged; the same room
//       at 11200 s (past even the widest bound) is still dropped and flagged -- the bound is wider, not gone
//   [3] mutation self-check: durCapOf back to DUR_CAP -> [2]'s honest room is dropped and both writers flagged
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';   // the child runs' salt, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const S = v.SANITY;

console.log('=== O792: a friends\' room\'s duration bound scales with its levels ===');

// ---- [0] wiring + class tripwire ----
{
  const code = H.SRC.split('\n').filter((l) => !/^\s*\/\//.test(l));
  const direct = code.filter((l) => /SANITY\.DUR_CAP/.test(l) && !/^\s*(if \(base !== PRIVATE_XP\.MT\) return SANITY\.DUR_CAP;|return Math\.max\(SANITY\.DUR_CAP, )/.test(l));
  T('[0] no duration bound compares against SANITY.DUR_CAP directly (a new one goes through durCapOf, which knows the friends\' room)', direct.length === 0,
    direct.map((l) => l.trim().slice(0, 140)).join(' || '));
  const via = code.filter((l) => /dur > durCapOf\(base, r\.d\)/.test(l));
  T('[0] both bounds (sanityFlags + recordSanityFlags) go through durCapOf', via.length === 2, via.length + ' found');
  T('[0] constants: DUR_CAP 7200, PRIVATE_LEVELS_MAX 30 (client ROOM_LEVEL_OPTS max, companion lockstep section 12), PRIVATE_LEVEL_S 360',
    S.DUR_CAP === 7200 && S.PRIVATE_LEVELS_MAX === 30 && S.PRIVATE_LEVEL_S === 360, JSON.stringify([S.DUR_CAP, S.PRIVATE_LEVELS_MAX, S.PRIVATE_LEVEL_S]));
  T('[0] the progress field\'s clamp is PRIVATE_XP.progMax (15, the client result-reporter clamps d[7] >> 1 to 4 bits)', v.PRIVATE_XP.progMax === 15 && v.PRIVATE_XP.MT === 10);
}

// ---- [1] pure ----
const d7 = (lv, win) => ((lv | 0) << 1) | (win ? 1 : 0);
const dOf = (lv) => [0xB1, 3, 10, 1, 1234, 0, 1, d7(lv, true), 2, 0];
{
  for (const b of [1, 2, 3, 4, 5, 6, 8, 9, 11]) T('[1] code ' + b + ': DUR_CAP whatever its levels', v.durCapOf(b, dOf(15)) === S.DUR_CAP);
  T('[1] friends\' room, 3 / 9 / 14 levels: DUR_CAP (their worst case is far below it)', [3, 9, 14].every((lv) => v.durCapOf(10, dOf(lv)) === S.DUR_CAP));
  const top = (S.PRIVATE_LEVELS_MAX + 1) * S.PRIVATE_LEVEL_S;
  T('[1] friends\' room at the clamp (15 = "15 or more"): the room maximum, ' + top + ' s', v.durCapOf(10, dOf(15)) === top && top === 11160);
  T('[1] friends\' room without the progress field (0, an old record) or a nonsense one: the room maximum (lenient)', v.durCapOf(10, dOf(0)) === top && v.durCapOf(10, [0xB1, 3, 10, 1, 1, 0, 1, -7]) === top && v.durCapOf(10, null) === top);
  // the premise (EA gap audit 2 C-04): the job's own worst case for the longest room, extrapolated linearly from its 9-level figure
  //   (41 min), with a sudden-death level on top, still fits under the bound with room for the extra gamble rounds of O772 part 2
  const worst = Math.round((S.PRIVATE_LEVELS_MAX + 1) * 41 * 60 / 9);
  T('[1] premise: the longest room\'s extrapolated worst case (' + worst + ' s) fits with >= 10% margin', worst * 1.1 <= v.durCapOf(10, dOf(15)), worst + ' vs ' + v.durCapOf(10, dOf(15)));
  const rec = (mt, lv, dur, seat) => ({ steamID: H.SID(7920 + (seat | 0)), d: H.rec(0xB1, mt, 0x7920, seat | 0, 1, true, [H.SID(7920), H.SID(7921)], [500, 300]).map((x, i) => (i === 7 ? d7(lv, (seat | 0) === 0) : i === 9 ? dur : x)), dispCode: 0 });
  const recFlags = (r) => v.recordSanityFlags(r, v.baseMt(r.d[2]), r.d[8] | 0);
  T('[1] recordSanityFlags: a 30-level friends\' room record at 8400 s is clean', recFlags(rec(10, 15, 8400)).indexOf('duration') < 0, JSON.stringify(recFlags(rec(10, 15, 8400))));
  T('[1] recordSanityFlags: the same record at 11200 s is past the bound', recFlags(rec(10, 15, 11200)).indexOf('duration') >= 0);
  T('[1] recordSanityFlags: a quick record at 8400 s is past DUR_CAP as before', recFlags(rec(1, 6, 8400)).indexOf('duration') >= 0);
  const g = [rec(10, 15, 8400, 0), rec(10, 15, 8350, 1)];
  T('[1] sanityFlags: the long honest room is clean', v.sanityFlags(g).indexOf('duration') < 0, JSON.stringify(v.sanityFlags(g)));
  T('[1] sanitySplit: nothing dropped, nobody flagged', v.sanitySplit(g).drop.length === 0);
  const g2 = [rec(10, 15, 11200, 0), rec(10, 15, 8350, 1)];
  T('[1] sanitySplit: the one record past the bound is dropped (its writer alone)', v.sanitySplit(g2).drop.length === 1 && v.sanitySplit(g2).drop[0].sid === H.SID(7920));
}

// ---- end to end ----
const PROGRESS = 5;
const MIN = 60000;
const boardsOf = (recs) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
// a 2-player friends' room: starts + both finishers' results; d[7] = 15 levels (the clamp of a 30-level room), d[9] = dur
function room(hash, P0, P1, dur) {
  const ros = [P0, P1], sc = [500, 300];
  const S0 = ros.map((sid, seat) => ({ sid, d: H.rec(0xB2, 10, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((sid, seat) => ({ sid, d: H.rec(0xB1, 10, hash, seat, seat + 1, seat === 0, ros, sc).map((x, i) => (i === 7 ? d7(15, seat === 0) : i === 9 ? dur - seat * 40 : x)) }));
  return { all: S0.concat(R), key: hash + '_1234_10' };
}
function run(recs, script) {
  const rs = []; let state = null;
  for (const ms of [0, 7 * MIN, 7 * MIN, 30 * MIN]) {   // past the start age, the roster confirmation, the absence grace and the 15-level pacing floor
    const r = H.runCron(boardsOf(recs), state ? H.advance(state, ms) : null, null, script || null, 'o792');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return rs;
}
const xpOf = (rs, sid) => { let x = 0; for (const r of rs) for (const p of H.postsOf(r, PROGRESS, sid)) x = p.score; return x; };
const flagF = (rs, sid) => ((((rs[rs.length - 1].state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const lines = (rs, re) => rs.reduce((a, r) => a + r.out.split('\n').filter((l) => re.test(l)).length, 0);
function caseLong(dur, n, script) {
  const P0 = H.SID(7930 + 2 * n), P1 = H.SID(7931 + 2 * n);
  const m = room(0x7920 + n, P0, P1, dur);
  const rs = run(m.all, script);
  return { rs, P0, P1, key: m.key, okAll: rs.length === 4 && rs.every((r) => r.code === 0) };
}
{
  const A = caseLong(8400, 0);
  T('[2] runs ok', A.okAll, A.rs.length ? A.rs[A.rs.length - 1].out.slice(-1500) : '');
  T('[2] the honest 30-level room (8400 s) settles: XP for both', xpOf(A.rs, A.P0) > 0 && xpOf(A.rs, A.P1) > 0 && lines(A.rs, new RegExp('private settle ' + A.key)) === 1,
    xpOf(A.rs, A.P0) + ' / ' + xpOf(A.rs, A.P1));
  T('[2] no duration flag, nobody flagged', lines(A.rs, /sanity.*duration|sanity on /) === 0 && flagF(A.rs, A.P0) === 0 && flagF(A.rs, A.P1) === 0, flagF(A.rs, A.P0) + '/' + flagF(A.rs, A.P1));
  const B = caseLong(11200, 1);
  T('[2] the same room at 11200 s (past even the widest bound): dropped, flagged, not settled', B.okAll && xpOf(B.rs, B.P0) === 0 && lines(B.rs, /sanity on /) >= 1 && flagF(B.rs, B.P0) === 1,
    'xp ' + xpOf(B.rs, B.P0) + ' f ' + flagF(B.rs, B.P0));
}
// ---- [3] mutation self-check ----
{
  const fix = "  if (base !== PRIVATE_XP.MT) return SANITY.DUR_CAP;\n";
  if (H.SRC.split(fix).length !== 2) bad('[3] the fix line was not found -- the mutant cannot be built');
  else {
    const mut = path.join(H.ROOT, '.mutant-o792-' + process.pid + '.js');   // in the root: validate.js requires its siblings relatively
    fs.writeFileSync(mut, H.SRC.replace(fix, '  return SANITY.DUR_CAP;\n'));
    try {
      const M = caseLong(8400, 2, mut);
      T('[3] mutant (DUR_CAP for every code): the honest 30-level room is dropped, both writers flagged, no XP', M.okAll && xpOf(M.rs, M.P0) === 0 && xpOf(M.rs, M.P1) === 0 &&
        flagF(M.rs, M.P0) === 1 && flagF(M.rs, M.P1) === 1, 'xp ' + xpOf(M.rs, M.P0) + '/' + xpOf(M.rs, M.P1) + ' f ' + flagF(M.rs, M.P0) + '/' + flagF(M.rs, M.P1));
    } finally { try { fs.unlinkSync(mut); } catch (e) {} }
  }
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (private-dur-cap) ===' : '=== PASS -- 0 fail (private-dur-cap) ===');
process.exit(failN ? 1 : 0);
