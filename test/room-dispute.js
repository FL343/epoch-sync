'use strict';
// Q407 (cloud audit round 3, R3-A3-01 / R3-A4-01): a friends' room (type 10) or a bot match (type 11) of three writers or more
// whose records disagree. On launch night (2026-11-17) a six-player friends' room wrote six results that each differed by about
// one item; the whole-group rule left the room unsettled AND flagged all six writers once (signals f, the trust ledger's 'fl'
// event for good). Both lanes pay XP only and no matchmaking reads them; the job cannot tell who wrote the wrong value (a
// modified joiner, a modified host, a client out of step). Now nobody is flagged for the disagreement (architecture decision
// 10, as Q317 for an endless run of three and Q291 for two voices); a writer whose own record's duration breaks its bound is
// still flagged alone; the key still does not settle while its records disagree (no majority settle: ASK_USER A42).
// End-to-end over the REAL validate.js main() against the offline board stub (test/lib/settle-stub.js):
//   [1] the launch-night shape: a six-player friends' room, each writer's record one score off -- nobody flagged, no trust
//       event, nothing paid, not processed, logged; mutant (the branch out: the whole-group rule) -> all six flagged
//   [2] a friends' room of three, the host claims the win, the two joiners agree -- nobody flagged, not settled (no majority
//       settle); mutant -> all three flagged
//   [3] a bot match with three humans and a bot (type 11) whose records disagree -- nobody flagged; mutant -> all three
//   [4] the duration stays the writer's own: one writer of a friends' room of three past the duration cap -- he alone flagged
//   [5] what stays: a quick brawl of three (type 1) whose records disagree flags every writer, as before (O198 (5): quick /
//       ranked keys of three or more wait for the signed results of knife 5.8); a friends' room of two stays on the two-voice
//       lane (pair-dispute, counted on both)
//   [6] control: a friends' room of three whose records agree settles, pays XP, no room-dispute line
//   [7] flags written by the old rule stay (taking them back is the local session's call), nothing is added on later runs
//   [8] run summary row; [9] roomDispute unit; [10] wiring pins + mutation self-check (the branch, the bot-match half, the
//       own-duration rule)
const fs = require('fs'), path = require('path');
process.env.STATE_SALT = 's';   // same salt as the child runs, so v.pid() addresses their state rows
const H = require('./lib/settle-stub.js');
const v = require(H.VALIDATE);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const MIN = 60000, HOUR = 3600 * 1000;
const EXTRA = [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
  { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
// steps: [[ms since the previous run, recs], ...]; script: a mutant validate.js or null; files0: the state before the first run
function timeline(steps, script, files0) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    if (out.length && out[out.length - 1].code !== 0) break;
    const r = H.runCron(H.shardBoards(recs, EXTRA), state ? H.advance(state, ms) : (files0 || null), null, script || null, 'room-dispute');
    out.push(r); state = r.state;
  }
  return out;
}
const last = (rs) => rs[rs.length - 1];
const outOf = (rs) => rs.map((r) => r.out).join('');
const allOk = (rs, n) => rs.length === n && rs.every((r) => r.code === 0);
const sigOf = (r, sid) => (((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {};
const fOf = (r, sid) => sigOf(r, sid).f | 0;
const flaggedKey = (r, m) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[m]);
const trustEv = (r, sid, m) => ((((r.state.TRUST_FILE || {}).acct || {})[v.pid(sid)] || {}).ev || []).filter((e) => e.s === 'fl' && (!m || e.m === m)).length;
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const paidIn = (rs, sid) => [].concat(...rs.map((r) => [5, 6, 7, 8].map((b) => H.postsOf(r, b, sid).map((p) => p.score)).flat()));
const durBad = (d) => d.map((x, i) => (i === 9 ? 90000 : x));   // a duration past every cap (SANITY.DUR_CAP / durCapOf)

const P = [2970, 2971, 2972, 2973, 2974, 2975].map(H.SID);
// a room of n seats (players ros); every writer writes a start, then a result; scoresOf(i) = the score vector writer i claims
//   (default: every writer the same). Runs: the starts; ten minutes later the results; ten more; two hours on (past the
//   start maturity: a friends' room / bot match never voids at the start verdict, nothing changes there).
function room(mt, hash, ros, scoresOf, recEdit) {
  const n = ros.length, writers = ros.map((s, i) => [s, i]).filter(([s]) => s != null);
  const base = Array.from({ length: n }, (_, i) => 1000 * (n - i));
  const st = writers.map(([sid, seat]) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, ros.map((x) => x || '0'), null) }));
  const re = writers.map(([sid, seat]) => {
    const sc = scoresOf ? scoresOf(seat, base.slice()) : base.slice();
    const rank = 1 + sc.filter((x, i) => i !== seat && x > sc[seat]).length;
    let d = H.rec(0xB1, mt, hash, seat, rank, rank === 1, ros.map((x) => x || '0'), sc);
    if (recEdit) d = recEdit(sid, d);
    return { sid, d };
  });
  const all = st.concat(re);
  return { steps: [[0, st], [10 * MIN, all], [10 * MIN, all], [2 * HOUR, all]], key: H.keyOf(re[0].d), writers: writers.map(([s]) => s) };
}
const oneOff = (seat, sc) => { sc[seat] += 10; return sc; };                     // each writer's own score ten higher: six different records
const hostClaims = (seat, sc) => (seat === 0 ? sc : [sc[1], sc[0]].concat(sc.slice(2)));   // the joiners say seat 1 won, the host himself

// mutants: validate.js with the rules before this fix put back
const BEFORE = {
  loop: ['    const rd = roomDispute(g, vecOf);\n', '    const rd = null;\n'],                                       // the whole-group rule
  bot: ['  if (base !== PRIVATE_XP.MT && base !== BOT_XP.MT) return null;\n', '  if (base !== PRIVATE_XP.MT) return null;\n'],   // friends' rooms only
  own: ['if (PAIR_DISPUTE.OWN.indexOf(f) >= 0 && why.indexOf(f) < 0) why.push(f);\n    if (why.length) own.push({ sid, why, recs: rs });',
    'if (PAIR_DISPUTE.OWN.indexOf(f) >= 0 && why.indexOf(f) < 0) why.push(f);\n    if (false) own.push({ sid, why, recs: rs });'],   // nobody flagged at all
};
let mutN = 0;
function withMutant(keys, tag, fn) {
  let src = H.SRC;
  for (const k of keys) {
    const [from, to] = BEFORE[k];
    if (src.split(from).length !== 2) { bad(tag + ' mutant ' + k + ': anchor not found exactly once'); return; }
    src = src.replace(from, to);
  }
  const script = path.join(H.ROOT, '.mutant-room-dispute-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(script, src);
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const flagsOf = (r, ws) => ws.map((s) => fOf(r, s));

// ---- [1] the launch-night shape ----
{
  const tag = '[1] six-player friends\' room, six records each one score off';
  const m = room(10, 0x55901, P, oneOff);
  const rs = timeline(m.steps);
  if (!allOk(rs, 4)) bad(tag + ': runs ' + rs.map((r) => r.code) + ' ' + last(rs).out.slice(-1500));
  else {
    eq(tag + ': nobody flagged, no trust event, the key not flagged', [flagsOf(last(rs), P), P.map((s) => trustEv(last(rs), s)), flaggedKey(last(rs), m.key)], [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0], false]);
    T(tag + ': nothing paid, not processed', P.every((s) => paidIn(rs, s).length === 0) && !processedOf(last(rs)).has(m.key), JSON.stringify(P.map((s) => paidIn(rs, s))));
    T(tag + ': logged as a room dispute (largest agreeing set 1 of 6)', /room-dispute [^\n]*: 6 records of a friends' room of 6 writers disagree -- nobody flagged for the disagreement, not settled; largest agreeing set 1 of 6[^\n]*\(Q407\)/.test(outOf(rs)),
      (/room-dispute[^\n]*|inconsistent[^\n]*/.exec(outOf(rs)) || [''])[0]);
    withMutant(['loop'], tag, (sc) => {
      const ms = timeline(m.steps, sc);
      T(tag + ' mutant (the whole-group rule) -> all six flagged once, a trust event each', allOk(ms, 4) && flagsOf(last(ms), P).every((f) => f === 1) && P.every((s) => trustEv(last(ms), s, m.key) === 1),
        JSON.stringify([flagsOf(last(ms), P), P.map((s) => trustEv(last(ms), s))]));
      T(tag + ': paid exactly as before (nothing)', P.every((s) => paidIn(ms, s).length === 0));
    });
  }
}

// ---- [2] a friends' room of three, two against one ----
{
  const tag = '[2] friends\' room of three, the host claims the win, the joiners agree';
  const ros = P.slice(0, 3), m = room(10, 0x55902, ros, hostClaims);
  const rs = timeline(m.steps);
  if (!allOk(rs, 4)) bad(tag + ': runs ' + rs.map((r) => r.code));
  else {
    eq(tag + ': nobody flagged, not processed, nothing paid', [flagsOf(last(rs), ros), processedOf(last(rs)).has(m.key), ros.map((s) => paidIn(rs, s).length)], [[0, 0, 0], false, [0, 0, 0]]);
    T(tag + ': logged, largest agreeing set 2 of 3, the host apart', /room-dispute [^\n]*: 3 records of a friends' room of 3 writers disagree -- nobody flagged for the disagreement, not settled; largest agreeing set 2 of 3, apart: [^\n]*\(Q407\)/.test(outOf(rs)),
      (/room-dispute[^\n]*/.exec(outOf(rs)) || [''])[0]);
    withMutant(['loop'], tag, (sc) => {
      const ms = timeline(m.steps, sc);
      eq(tag + ' mutant -> all three flagged', allOk(ms, 4) ? flagsOf(last(ms), ros) : ms.map((r) => r.code), [1, 1, 1]);
    });
  }
}

// ---- [3] a bot match with three humans ----
{
  const tag = '[3] bot match, three humans and a bot (11)';
  const ros = P.slice(0, 3).concat([null]), m = room(11, 0x55903, ros, hostClaims);
  const rs = timeline(m.steps);
  const hum = P.slice(0, 3);
  if (!allOk(rs, 4)) bad(tag + ': runs ' + rs.map((r) => r.code));
  else {
    eq(tag + ': nobody flagged, not processed', [flagsOf(last(rs), hum), processedOf(last(rs)).has(m.key)], [[0, 0, 0], false]);
    T(tag + ': logged as a bot match', /room-dispute [^\n]*: 3 records of a bot match of 3 writers disagree -- nobody flagged[^\n]*\(Q407\)/.test(outOf(rs)), (/room-dispute[^\n]*|inconsistent[^\n]*/.exec(outOf(rs)) || [''])[0]);
    withMutant(['loop'], tag, (sc) => { const ms = timeline(m.steps, sc); eq(tag + ' mutant (the whole-group rule) -> all three flagged', allOk(ms, 4) ? flagsOf(last(ms), hum) : null, [1, 1, 1]); });
    withMutant(['bot'], tag, (sc) => { const ms = timeline(m.steps, sc); eq(tag + ' mutant (friends\' rooms only) -> all three flagged', allOk(ms, 4) ? flagsOf(last(ms), hum) : null, [1, 1, 1]); });
  }
}

// ---- [4] the duration stays the writer's own ----
{
  const tag = '[4] friends\' room of three, one writer\'s own record past the duration cap';
  const ros = P.slice(0, 3), bad3 = P[2];
  const m = room(10, 0x55904, ros, oneOff, (sid, d) => (sid === bad3 ? durBad(d) : d));
  const rs = timeline(m.steps);
  if (!allOk(rs, 4)) bad(tag + ': runs ' + rs.map((r) => r.code));
  else {
    eq(tag + ': he alone flagged (one trust event), the other two not', [flagsOf(last(rs), ros), ros.map((s) => trustEv(last(rs), s))], [[0, 0, 1], [0, 0, 1]]);
    T(tag + ': logged with his reason', /room-dispute [^\n]*nobody flagged for the disagreement, [^\n]*\(duration on his own record\) flagged alone[^\n]*\(Q407\)/.test(outOf(rs)), (/room-dispute[^\n]*/.exec(outOf(rs)) || [''])[0]);
    withMutant(['own'], tag, (sc) => { const ms = timeline(m.steps, sc); eq(tag + ' mutant (own rule out) -> nobody flagged', allOk(ms, 4) ? flagsOf(last(ms), ros) : null, [0, 0, 0]); });
  }
}

// ---- [5] what stays ----
{
  const tag = '[5] quick brawl of three (1) whose records disagree';
  const ros = P.slice(0, 3), m = room(1, 0x55905, ros, hostClaims);
  const rs = timeline(m.steps.slice(0, 3));
  if (!allOk(rs, 3)) bad(tag + ': runs ' + rs.map((r) => r.code));
  else {
    eq(tag + ': every writer flagged once, as before', flagsOf(last(rs), ros), [1, 1, 1]);
    T(tag + ': no room-dispute line', !/room-dispute/.test(outOf(rs)));
  }
  const tag2 = '[5] friends\' room of two whose records disagree';
  const m2 = room(10, 0x55906, P.slice(0, 2), hostClaims);
  const rs2 = timeline(m2.steps.slice(0, 3));
  if (!allOk(rs2, 3)) bad(tag2 + ': runs ' + rs2.map((r) => r.code));
  else {
    eq(tag2 + ': nobody flagged, counted on both (the two-voice lane, Q291)', [flagsOf(last(rs2), P.slice(0, 2)), P.slice(0, 2).map((s) => sigOf(last(rs2), s).pd | 0)], [[0, 0], [1, 1]]);
    T(tag2 + ': on the pair-dispute line, not room-dispute', /pair-dispute [^\n]*\(Q289 \/ Q291\)/.test(outOf(rs2)) && !/room-dispute/.test(outOf(rs2)));
  }
}

// ---- [6] control ----
{
  const tag = '[6] friends\' room of three whose records agree';
  const ros = P.slice(0, 3), m = room(10, 0x55907, ros, null);
  const rs = timeline(m.steps);
  if (!allOk(rs, 4)) bad(tag + ': runs ' + rs.map((r) => r.code));
  else {
    T(tag + ': settled, XP paid to all three, nobody flagged, no room-dispute line',
      processedOf(last(rs)).has(m.key) && ros.every((s) => H.postsOf(rs[rs.length - 1], 5, s).length + rs.slice(0, -1).reduce((a, r) => a + H.postsOf(r, 5, s).length, 0) > 0)
      && flagsOf(last(rs), ros).every((f) => f === 0) && !/room-dispute/.test(outOf(rs)), JSON.stringify(ros.map((s) => paidIn(rs, s))));
  }
}

// ---- [7] flags the old rule wrote stay; nothing is added ----
{
  const tag = '[7] a key the job before flagged';
  const m = room(10, 0x55908, P, oneOff);
  withMutant(['loop'], tag, (sc) => {
    const old = timeline(m.steps.slice(0, 2), sc);
    if (!allOk(old, 2)) { bad(tag + ': old runs ' + old.map((r) => r.code)); return; }
    const before = flagsOf(last(old), P);
    const rs = timeline([[10 * MIN, m.steps[1][1]], [2 * HOUR, m.steps[1][1]]], null, H.advance(last(old).state, 0));
    if (!allOk(rs, 2)) { bad(tag + ': runs ' + rs.map((r) => r.code)); return; }
    eq(tag + ': flagged once each before, the same after two more runs (no flag removed, none added)', [before, flagsOf(last(rs), P), P.map((s) => trustEv(last(rs), s, m.key))],
      [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]]);
  });
}

// ---- [8] run summary row ----
{
  const m = room(10, 0x55909, P.slice(0, 3), oneOff);
  const rs = timeline(m.steps.slice(0, 2));
  T('[8] summary row counts the room dispute (1 / 0)', allOk(rs, 2) && /\| friends' rooms \/ bot matches of three writers or more whose records disagree, nobody flagged for it, not settled \(Q407\)[^|]*\| 1 \/ 0 \|/.test(last(rs).summary),
    (/[^\n]*Q407[^\n]*/.exec(last(rs).summary) || ['(no row)'])[0]);
}

// ---- [9] roomDispute unit ----
{
  T('[9] exported', typeof v.roomDispute === 'function');
  if (typeof v.roomDispute === 'function') {
    const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d) });
    const vec = (r) => r.d.slice(9, 9 + 1 + (r.d[8] | 0)).join(',');   // duration + scores: enough to tell the records apart here
    const mk = (mt, scs, ros) => scs.map((sc, i) => R(ros[i], H.rec(0xB1, mt, 0x77, i, 1, i === 0, ros, sc)));
    const ros3 = P.slice(0, 3), A = [3000, 2000, 1000], B = [2000, 3000, 1000];
    const r10 = v.roomDispute(mk(10, [A, B, B], ros3), vec);
    eq('[9] a friends\' room of three, two against one: writers 3, nobody own, most = the two, apart = the one',
      r10 && [r10.base, r10.writers, r10.own.length, r10.most.slice().sort(), r10.apart], [10, 3, 0, [ros3[1], ros3[2]].sort(), [ros3[0]]]);
    const r11 = v.roomDispute(mk(11, [A, B, B], ros3), vec);
    T('[9] a bot match: base 11', !!r11 && r11.base === 11 && r11.writers === 3);
    for (const mt of [1, 2, 3, 5, 7, 8]) T('[9] null for match type ' + mt, v.roomDispute(mk(mt, [A, B, B], ros3), vec) === null);
    T('[9] null for an empty group', v.roomDispute([], vec) === null && v.roomDispute(null, vec) === null);
    T('[9] null for a friends\' room / bot match of two accounts (the two-voice lane takes those first)', v.roomDispute(mk(10, [A, B], P.slice(0, 2)), vec) === null && v.roomDispute(mk(11, [A, B], P.slice(0, 2)), vec) === null
      && v.roomDispute(mk(10, [A, B], P.slice(0, 2)).concat([R(P[1], H.rec(0xB1, 10, 0x77, 1, 1, true, P.slice(0, 2), A))]), vec) === null);
    const own = v.roomDispute(mk(10, [A, B, B], ros3).map((r, i) => (i === 2 ? R(r.steamID, durBad(r.d)) : r)), vec);
    eq('[9] the duration on his own record: own = him, reason duration', own && own.own.map((x) => [x.sid, x.why]), [[ros3[2], ['duration']]]);
    const two = mk(10, [A, B, B], ros3); two.push(R(ros3[1], H.rec(0xB1, 10, 0x77, 1, 1, true, ros3, A)));
    const r2 = v.roomDispute(two, vec);
    T('[9] a writer whose own records disagree votes for no value (apart), nobody own', !!r2 && r2.own.length === 0 && r2.apart.indexOf(ros3[1]) >= 0 && r2.most.indexOf(ros3[1]) < 0, JSON.stringify(r2 && [r2.most, r2.apart]));
  }
}

// ---- [10] wiring pins + mutation self-check ----
{
  const SRC = H.SRC;
  const loop = (/const pd1 = pairDispute1v1\(g\);[\s\S]*?\n {4}if \(recordFlag\(signals, g, m, nowMs\)\) sigDirty = true;/.exec(SRC) || [''])[0];
  T('[10] wiring: the Q407 branch sits after the two-voice lane and right before the whole-group recordFlag, and continues',
    /\n {4}const rd = roomDispute\(g, vecOf\);\n {4}if \(rd\) \{[\s\S]{0,1600}?\n {6}continue;\n {4}\}\n {4}if \(recordFlag\(signals, g, m, nowMs\)\) sigDirty = true;$/.test(loop), loop.slice(-400));
  T('[10] wiring: the branch flags only rd.own', /if \(rd\) \{[\s\S]{0,300}?if \(rd\.own\.length\) \{[\s\S]{0,200}?recordFlag\(signals, \[\]\.concat\(\.\.\.rd\.own\.map\(\(x\) => x\.recs\)\), m, nowMs\)/.test(SRC));
  T('[10] roomDispute takes friends\' rooms and bot matches only, the own reasons from PAIR_DISPUTE.OWN',
    /function roomDispute\(g, vecOf\) \{[\s\S]{0,200}?if \(base !== PRIVATE_XP\.MT && base !== BOT_XP\.MT\) return null;[\s\S]{0,600}?PAIR_DISPUTE\.OWN\.indexOf\(f\) >= 0/.test(SRC));
  T('[10] PAIR_DISPUTE.OWN is still the duration alone', JSON.stringify(v.PAIR_DISPUTE.OWN) === JSON.stringify(['duration']));
  T('[10] summary row and export', /s\('roomDispute', 0\) \+ ' \/ ' \+ s\('roomDisputeOwn', 0\)/.test(SRC) && /Object\.assign\(module\.exports, \{ roomDispute \}\)/.test(SRC));
  for (const k of Object.keys(BEFORE)) T('[10] mutant anchor ' + k + ' found exactly once', SRC.split(BEFORE[k][0]).length === 2);
}

console.log(failN ? ('ROOM-DISPUTE: ' + failN + ' FAIL') : 'ALL OK (room-dispute)');
process.exit(failN ? 1 : 0);
