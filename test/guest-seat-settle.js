'use strict';
// O989 a couch pair in the online queue: one machine = one account (the main) plus a guest seat with no account. The guest
// seats of a table are bits 17-22 of the match type (points-plan.js GUEST_SEAT_SHIFT); the roster leaves them empty and the
// guest of seat g belongs to the account at seat g - 1. Over the REAL validate.js main() (offline board stub,
// test/lib/settle-stub.js) unless a section says "unit":
//   [1] K2: an outside account's start from a declared guest seat (naming itself there) registers nowhere and its result
//       counts nowhere; nobody is flagged, the players settle. Mutants: the start drop taken out -> the key is contested
//       and the players do not settle; the drop and the blank-seat reading both taken out -> the outsider is registered
//   [2] a declared guest seat is no blank seat: the players' starts vote as ever; mutant
//   [3] quick brawl with a couch pair (3 / 4 / 6 seats): the guest takes his place and counts in the player count for
//       everybody -- XP and the hidden rating as at the table where the guest is an account at his main's rating with a
//       newcomer's uncertainty; mutant (the stand-in at the default rating)
//   [4] ranked seats: the main settles by the average place of his two seats (1st + 4th of four: the drip alone); a
//       stranger who wins settles as at the table where the guest is an ordinary account, one who loses never worse (the
//       couch shield); mutants (the guests' plan rows / the shield taken out)
//   [5] team codes: the team is rated at full strength; a couch pair that LOSES is rated (the guest seat is accounted for
//       with its main, Q149 -- before, the pair could only win); the couch 2V2 (two accounts, a guest each) settles, its
//       points times COUCH_DUO_MULT; mutants
//   [6] everybody else quit and confessed: the stayer of a couch table takes the quit-lone settle (units + one end to end)
//   [7] sanity: the header reasons hold the match with nobody flagged; a result written from a guest seat or naming an
//       account there is dropped alone, its writer ranked at his own seat, no leaver, nobody flagged
//   [8] rules-cfg: the file's numbers settle the match, its revision is on the receipts, the pulse row carries it; a later
//       revision does not move a settled match (mutant: the key not remembered -> settled again under the new numbers);
//       COUCH_LP_MULT 0 moves no points, a series match included; an unusable file holds the couch matches only
//   [9] the couch-match signal; the guest's id is in no state file and no board write
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
for (const k of H.FILE_VARS) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const PP = require(path.join(H.ROOT, 'points-plan.js'));
const ts = require(path.join(H.ROOT, 'trueskill.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;
const F = PP.RECEIPT_F, low = (e) => e.flags & 0xff;
const S = (seats) => seats << PP.RANKED_SEAT_SHIFT, G = (seats) => seats << PP.GUEST_SEAT_SHIFT;
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const on = (n) => !ONLY.length || ONLY.indexOf(String(n)) >= 0;

const MIN = 60000, HOUR = 3600000;
const GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const XPB = 5, RATING = 6, POINTS = 7, CPB = 8, VGATE = 9;
const OPS = H.SID(9000001);
const VG = { id: VGATE, name: 'version_gate', entries: [{ steamID: OPS, score: 1 }] };
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: XPB, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: Object.keys(pts).map((s) => ({ steamID: s, score: pts[s].score, details: pts[s].details || [] })) }, { id: CPB, name: 'cp_bank', entries: [] }, VG]);
// steps: [[ms since the previous run, records, files merged into the carried state (optional)]]; pts carried run to run
function run(steps, pts0, files0, script) {
  const pts = JSON.parse(J(pts0 || {}));
  const rs = [];
  let state = null;
  for (const [ms, recs, put] of steps) {
    const files = state ? Object.assign(H.advance(state, ms), put || {}) : Object.assign({}, files0 || {}, put || {});
    const r = H.runCron(boardsOf(recs, pts), files, null, script || null, 'guest-seat');
    rs.push(r); state = r.state;
    for (const p of H.setPosts(r, POINTS)) pts[/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), details: H.postDetails(p.body) || [] };
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], pts, out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
// record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, (progress<<1)|win, pc, dur, scores, disp, roster;
//   a start (0xB2) and a confession (0xB5) carry zeroed results
function rec(magic, mt, hash, seat, rank, win, ros, sc, disp, prog) {
  const zero = magic !== 0xB1, pc = ros.length;
  const d = [magic, zero ? 1 : 3, mt, hash | 0, 1234, seat, zero ? 0 : rank, zero ? 0 : (((prog == null ? 6 : prog) << 1) | (win ? 1 : 0)), pc, zero ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(zero ? 0 : ((sc || [])[i] | 0));
  d.push(disp | 0);
  for (const s of ros) { const p = H.sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const Z = '0';
// a matchmade table (mt) on seats ros ('0' = a guest seat): every account seat writes its start (unless o.noStart), `res` =
//   the seats writing a result (o.disp: { seat: code }); scores descending by seat (o.sc overrides)
function match(mt, hash, ros, res, opt) {
  const o = opt || {};
  const sc = o.sc || ros.map((_, i) => 6000 - 1000 * i);
  const rankOf = (seat) => 1 + sc.filter((x) => x > sc[seat]).length;
  const St = ros.map((s, seat) => ({ sid: s, seat, d: rec(0xB2, mt, hash, seat, 0, false, ros, sc) })).filter((x) => x.sid !== Z && !(o.noStart || []).includes(x.seat));
  const R = res.map((seat) => ({ sid: ros[seat], seat, d: rec(0xB1, mt, hash, seat, rankOf(seat), rankOf(seat) === 1, ros, sc, (o.disp || {})[seat] | 0) }));
  return { S: St, R, all: St.concat(R), key: hash + '_1234_' + mt, mh: hash | 0, sc, ros, mt, rankOf };
}
const cat = (list, f) => [].concat(...list.map(f));
// the four runs of a normal settle, for one table or several at once (different accounts)
const SETTLE = (mm, more) => { const ms = Array.isArray(mm) ? mm : [mm], x = more || []; return [[0, cat(ms, (m) => m.S).concat(x)], [5 * MIN, cat(ms, (m) => m.all).concat(x)], [GRACE, cat(ms, (m) => m.all).concat(x)], [6 * MIN, cat(ms, (m) => m.all).concat(x)]]; };
const posts = (m, board, sid) => [].concat(...m.rs.map((r) => H.postsOf(r, board, sid)));
const lastOf = (m, board, sid) => { const w = posts(m, board, sid); return w.length ? w[w.length - 1] : null; };
const ringOf = (m, sid) => { const w = lastOf(m, POINTS, sid); return w ? PP.lpDetailsOf(w.details).ring : null; };
const settled = (m, key) => new Set(m.last.state.PROCESSED_FILE || []).has(key);
const skillOf = (m, sid) => (m.last.state.SKILL_FILE || {})[v.pid(sid)] || null;
const sigOf = (m, sid) => (((m.last.state.SIGNALS_FILE || {}).players) || {})[v.pid(sid)] || null;
const flaggedN = (m) => Object.keys(((m.last.state.SIGNALS_FILE || {}).flagged) || {}).length;
const leavesOf = (m, sid) => (((m.last.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;
const xpOf = (m, sid) => { const w = lastOf(m, XPB, sid); return w ? w.score : null; };
const xpLine = (m, sid) => (m.out.split('\n').filter((l) => l.indexOf('  xp ' + v.pid(sid).slice(0, 8) + ' ') === 0)[0] || '');
const mu2 = (sk) => (sk ? [sk.mu, sk.sigma] : null);
const pulseOfRun = (r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && H.postDetails(p.body) && H.postDetails(p.body)[0] === PP.PULSE_MAGIC).map((p) => H.postDetails(p.body))[0] || null;
const DFLT = { rev: 0, vals: {} }; for (const k of PP.CFG_KEYS) DFLT.vals[k] = PP.DEFAULTS[k];
const cfgOf = (rev, over) => ({ rev, vals: Object.assign({}, DFLT.vals, over || {}) });
// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const tmpFiles = [];
process.on('exit', () => { for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch (e) {} } });
let mutN = 0;
function mutantOf(file, edits, tag, keep) {
  let src = fs.readFileSync(file, 'utf8');
  for (const [from, to] of edits) {
    if (src.split(from).length !== 2) { bad(tag + ' mutant anchor not found exactly once: ' + from.slice(0, 90)); return null; }
    src = src.replace(from, to);
  }
  const f = path.join(H.ROOT, '.mutant-guest-seat-' + process.pid + '-' + (++mutN) + '.js');
  fs.writeFileSync(f, src); tmpFiles.push(f);
  return f;
}
// a copy of validate.js with the edits (one [from, to] or a list)
const vMut = (edits, tag) => mutantOf(H.VALIDATE, Array.isArray(edits[0]) ? edits : [edits], tag);
// a copy of validate.js that requires a copy of points-plan.js with the edit
function ppMut(edit, tag) {
  const pf = mutantOf(path.join(H.ROOT, 'points-plan.js'), [edit], tag);
  return pf ? mutantOf(H.VALIDATE, [["require('./points-plan.js')", "require('./" + path.basename(pf) + "')"]], tag) : null;
}

console.log('=== O989 guest seats: a couch pair in the online queue ===');
const SIDS = (base) => [0, 1, 2, 3, 4, 5, 6, 7].map((i) => H.SID(base + i));
const DROP_CALL = '  RUN.guestStarts = dropGuestSeatStarts(starts, processed).n;';
const BLANK_READ = 'if (!ro[s] && !isGuestSeat(r.d[2], s)) return true;';

// ---- [1] K2: an outside account claims the guest seat ----
if (on(1)) {
  const [A, B, C, X] = SIDS(98910);
  const mt = 1 | G(0b0010);
  const ros = [A, Z, B, C], rosX = [A, X, B, C];
  const table = (hash) => {
    const mm = match(mt, hash, ros, [0, 2, 3]);
    const xs = { sid: X, seat: 1, d: rec(0xB2, mt, hash, 1, 0, false, rosX, mm.sc) };
    const xr = { sid: X, seat: 1, d: rec(0xB1, mt, hash, 1, 2, false, rosX, mm.sc, 0) };
    return { mm, steps: [[0, mm.S.concat([xs])], [5 * MIN, mm.all.concat([xs, xr])], [GRACE, mm.all.concat([xs, xr])], [6 * MIN, mm.all.concat([xs, xr])]] };
  };
  const t = table(0x98901), m = run(t.steps, {});
  const st = (m.rs[0].state.STARTS_FILE || {})[t.mm.key] || {};
  T('[1] the outside start from the guest seat registers nowhere: the roster seats the three accounts, the guest seat empty',
    m.okAll && J(Object.keys(st.roster || {}).sort()) === J(['0', '2', '3']) && !st.split, J(st) + m.rs[0].out.slice(-600));
  T('[1] the players settle; the outsider earns nothing and is rated nowhere', settled(m, t.mm.key) && [A, B, C].every((s) => xpOf(m, s) > 0 && skillOf(m, s)) && xpOf(m, X) == null && !skillOf(m, X),
    J([xpOf(m, A), xpOf(m, X), skillOf(m, X)]) + m.out.slice(-900));
  T('[1] nobody flagged; the start logged as not counted', flaggedN(m) === 0 && /start record\(s\) written from a guest seat of a couch pair, or naming an account on one -- not counted, nobody flagged \(O989\)/.test(m.out), J((m.last.state.SIGNALS_FILE || {}).flagged));
  const f1 = vMut([DROP_CALL, '  RUN.guestStarts = 0;'], '[1a]');
  if (f1) {
    const t2 = table(0x98902), mx = run(t2.steps, {}, null, f1);
    const sx = (mx.rs[0].state.STARTS_FILE || {})[t2.mm.key] || {};
    T('[1] mutant (the start drop taken out): the outside start splits the table, the players do not settle -- caught', mx.okAll && !!sx.split && !settled(mx, t2.mm.key), J(sx));
  }
  const f2 = vMut([[DROP_CALL, '  RUN.guestStarts = 0;'], [BLANK_READ, 'if (!ro[s]) return true;']], '[1b]');
  if (f2) {
    const t3 = table(0x98903), mx = run(t3.steps, {}, null, f2);
    const sx = (mx.rs[0].state.STARTS_FILE || {})[t3.mm.key] || {};
    // (on the code before O989 he was then paid and rated too: 245 XP and a skill entry in this very case, 2026-11-24. Here the
    //  per-record sanity reasons still drop his result -- the second layer, section [7])
    T('[1] mutant (the drop and the blank-seat reading taken out = the registration of before O989): the outsider is registered on the guest seat, his start the only vote -- caught',
      mx.okAll && (sx.roster || {})['1'] === v.pid(X) && !sx.split && xpOf(mx, X) == null, J([sx.roster, xpOf(mx, X)]));
  }
}

// ---- [2] a declared guest seat is no blank seat ----
if (on(2)) {
  const [A, B, C] = SIDS(98920);
  const mm = match(1 | G(0b0010), 0x98911, [A, Z, B, C], [0, 2, 3]);
  const m = run(SETTLE(mm), {});
  T('[2] the three starts register the table (three attesters, three roster seats), none of them a blank start', m.okAll && new RegExp('start-pending ' + mm.key + ': 3 attesters, roster 3 seats').test(m.out) && settled(m, mm.key),
    m.rs[0].out.split('\n').filter((l) => /start-/.test(l)).join(' | '));
  T('[2] unit: blankSeatStart reads the mask (a seat the mask does not declare is still blank)', (() => {
    const r = (mt, ros) => { const d = rec(0xB2, mt, 1, 0, 0, false, ros, null); return { d, roster: v.decodeRoster(d) }; };
    return v.blankSeatStart(r(1 | G(0b0010), [A, Z, B])) === false && v.blankSeatStart(r(1, [A, Z, B])) === true && v.blankSeatStart(r(1 | G(0b0010), [A, Z, Z])) === true;
  })());
  const f = vMut([BLANK_READ, 'if (!ro[s]) return true;'], '[2]');
  if (f) {
    const vm = require(f);
    const d = rec(0xB2, 1 | G(0b0010), 1, 0, 0, false, [A, Z, B], null);
    T('[2] mutant (the mask not read): the honest start is a blank start again -- caught', vm.blankSeatStart({ d, roster: vm.decodeRoster(d) }) === true);
  }
}

// ---- [3] quick brawl: the guest is a player for everybody ----
if (on(3)) {
  const [A, B, C] = SIDS(98930), [A2, D2, B2, C2] = SIDS(98940), [A3, B3, C3] = SIDS(98950);
  const couch = match(1 | G(0b0010), 0x98921, [A, Z, B, C], [0, 2, 3]);          // A 1st, the guest 2nd, B 3rd, C 4th
  const twin = match(1, 0x98922, [A2, D2, B2, C2], [0, 1, 2, 3]);                 // the same table, the guest an account
  const three = match(1, 0x98923, [A3, B3, C3], [0, 1, 2], { sc: [6000, 4000, 3000] });   // the old reading: the guest is not there
  const sk = (a, d) => { const o = { [v.pid(a)]: { mu: 35, sigma: 2 } }; if (d) o[v.pid(d)] = { mu: 35, sigma: ts.DEFAULTS.sigma }; return o; };
  const m = run(SETTLE([couch, twin, three]), {}, { SKILL_FILE: Object.assign(sk(A), sk(A2, D2)) });
  T('[3] the three tables settle', m.okAll && settled(m, couch.key) && settled(m, twin.key) && settled(m, three.key), m.out.slice(-1200));
  T('[3] logged: the guest counted as a player', new RegExp('couch ' + couch.key + ': guest seat 1 \\(of [0-9a-f]{8}\\) counted as a player at the agreed place').test(m.out));
  T('[3] XP: every account as at the table where the guest is an account (place and player count)', xpOf(m, A) === xpOf(m, A2) && xpOf(m, B) === xpOf(m, B2) && xpOf(m, C) === xpOf(m, C2)
    && / rank3 /.test(xpLine(m, B)) && / rank4 /.test(xpLine(m, C)), J([[A, A2], [B, B2], [C, C2]].map((p) => p.map((s) => xpOf(m, s)))) + xpLine(m, B));
  T('[3] (the case reads apart: without the guest B is 2nd of 3 and earns more)', xpOf(m, B3) > xpOf(m, B) && / rank2 /.test(xpLine(m, B3)), J([xpOf(m, B3), xpOf(m, B)]));
  T('[3] hidden rating: every account moves as at the twin table (the guest = his main\'s rating, a newcomer\'s uncertainty)',
    J(mu2(skillOf(m, A))) === J(mu2(skillOf(m, A2))) && J(mu2(skillOf(m, B))) === J(mu2(skillOf(m, B2))) && J(mu2(skillOf(m, C))) === J(mu2(skillOf(m, C2))),
    J([skillOf(m, B), skillOf(m, B2)]));
  T('[3] the guest has no rating of his own: the skill file holds the accounts only', Object.keys(m.last.state.SKILL_FILE || {}).length === 3 + 4 + 3, String(Object.keys(m.last.state.SKILL_FILE || {}).length));
  const f = vMut(['mu: (skill[pid(x.main)] || ts.DEFAULTS).mu, sigma: ts.DEFAULTS.sigma }));', 'mu: ts.DEFAULTS.mu, sigma: ts.DEFAULTS.sigma }));'], '[3]');
  if (f) {
    const c2 = match(1 | G(0b0010), 0x98924, [A, Z, B, C], [0, 2, 3]);
    const mx = run(SETTLE(c2), {}, { SKILL_FILE: sk(A) }, f);
    T('[3] mutant (the stand-in at the default rating, not his main\'s): B moves otherwise -- caught', mx.okAll && settled(mx, c2.key) && J(mu2(skillOf(mx, B))) !== J(mu2(skillOf(m, B))), J([skillOf(mx, B), skillOf(m, B)]));
  }
  // a known residual (the companion plan keeps "the main is rated at his own place of the whole table"): the main and his own
  //   guest are rated against each other when they finish next to each other. Pinned so it stays small: for a settled main
  //   (sigma 1.5) a place right above his guest is worth about half of a place above a known equal player, right below it
  //   costs less than that; the guest is never rated, so nothing accumulates on his side.
  {
    const dr = (q) => ts.displayRating(q.mu, q.sigma);
    const main = { id: 'm', mu: 30, sigma: 1.5 }, guest = { id: 'g', mu: 30, sigma: ts.DEFAULTS.sigma }, known = { id: 'k', mu: 30, sigma: 1.5 };
    const of = (a, b) => ts.updateMatch([Object.assign({ rank: 1 }, a), Object.assign({ rank: 2 }, b)]).find((x) => x.id === 'm');
    const up = dr(of(main, guest)) - dr(main), down = dr(of(guest, main)) - dr(main), upKnown = dr(of(main, known)) - dr(main);
    T('[3] unit (known residual): a settled main right above his own guest +' + up + ' / right below ' + down + ' display points; above a known equal player +' + upKnown,
      up > 0 && up <= 10 && down < 0 && down >= -10 && up * 2 <= upKnown + 2, J([up, down, upKnown]));
  }
  // three and six seats
  const [E1, E2] = SIDS(98960), [F1, F2, F3, F4, F5] = SIDS(98970);
  const t3 = match(1 | G(0b010), 0x98925, [E1, Z, E2], [0, 2]);
  const t6 = match(1 | G(0b000010), 0x98926, [F1, Z, F2, F3, F4, F5], [0, 2, 3, 4, 5]);
  const u3 = match(1 | G(0b100), 0x98927, [F5, F4, Z], [0, 1], { sc: [3000, 6000, 5000] });   // not aligned to a seat pair: the main at seat 1, his guest at 2
  const m2 = run(SETTLE([t3, t6]), {});
  T('[3] three seats (two accounts) and six seats settle; places count the guest', m2.okAll && settled(m2, t3.key) && settled(m2, t6.key) && / rank3 /.test(xpLine(m2, E2)) && / rank6 /.test(xpLine(m2, F5)), xpLine(m2, E2) + ' | ' + xpLine(m2, F5));
  const m3 = run(SETTLE(u3), {});
  T('[3] a couch pair off the seat-pair grid (main at seat 1, guest at 2) settles too: the main 1st, the solo 3rd of 3', m3.okAll && settled(m3, u3.key) && / rank1 /.test(xpLine(m3, F4)) && / rank3 /.test(xpLine(m3, F5)), xpLine(m3, F4) + ' | ' + xpLine(m3, F5));
}

// ---- [4] ranked seats: the main by the average place, the strangers as at an ordinary table or better ----
const expectPlan = (mt, rows) => PP.matchPlan(rows.map(([id, seat, rank, lp]) => ({ steamID: id, seat, mmr: 1000, rank, lp })), mt, null);
if (on(4) || on(9)) {
  const [A, B, C] = SIDS(98980), [A2, D2, B2, C2] = SIDS(98990), [A3, B3, C3] = SIDS(99000), [A4, D4, B4, C4] = SIDS(99010);
  const MT = 1 | S(0b0101) | G(0b0010), TW = 1 | S(0b0101);
  const pts = (list) => { const o = {}; for (const s of list) o[s] = { score: 1000 }; return o; };
  const c1 = match(MT, 0x98931, [A, Z, B, C], [0, 2, 3]);                                   // A 1st, guest 2nd, B 3rd (loses), C 4th
  const t1 = match(TW, 0x98932, [A2, D2, B2, C2], [0, 1, 2, 3]);
  const c2 = match(MT, 0x98933, [A3, Z, B3, C3], [0, 2, 3], { sc: [6000, 1000, 5000, 4000] });   // A 1st, B 2nd (wins), C 3rd, guest 4th
  const t2 = match(TW, 0x98934, [A4, D4, B4, C4], [0, 1, 2, 3], { sc: [6000, 1000, 5000, 4000] });
  const m = run(SETTLE([c1, t1, c2, t2]), pts([A, B, A2, B2, A3, B3, A4, B4]));
  const delta = (sid) => { const r = ringOf(m, sid); return r && r[0] ? r[0].delta : null; };
  if (on(4)) {
    T('[4] the four tables settle', m.okAll && [c1, t1, c2, t2].every((x) => settled(m, x.key)), m.out.slice(-1500));
    const p1 = expectPlan(MT, [[A, 0, 1, 1000], ['g', 1, 2, 1000], [B, 2, 3, 1000], [C, 3, 4, 1000]]);
    const p2 = expectPlan(MT, [[A3, 0, 1, 1000], ['g', 1, 4, 1000], [B3, 2, 2, 1000], [C3, 3, 3, 1000]]);
    T('[4] the main, 1st with his guest 2nd: the pair\'s average place (1.5 of 4), its win taxed x' + PP.COUCH_PAIR_WIN + ' -> +' + p1[A].adjDelta + ' (a solo 1st: +' + PP.lpDelta(1000, 1, 4) + ')',
      delta(A) === p1[A].adjDelta && p1[A].adjDelta === 27 && J(p1[A].why) === J(['couch_tax']) && lastOf(m, POINTS, A).score === 1000 + 27, J([delta(A), p1[A]]));
    T('[4] the main, 1st with his guest 4th: average place 2.5 of 4 -> the drip alone, +' + p2[A3].adjDelta, delta(A3) === p2[A3].adjDelta && p2[A3].adjDelta === 4, J([delta(A3), p2[A3]]));
    T('[4] a stranger who wins (2nd of 4): exactly as at the ordinary table', delta(B3) === delta(B4) && delta(B3) === PP.lpDelta(1000, 2, 4), J([delta(B3), delta(B4)]));
    T('[4] a stranger who loses (3rd of 4): never worse than at the ordinary table -- shielded x' + PP.COUCH_SOLO_LOSS + ' (' + delta(B2) + ' there, ' + delta(B) + ' here), PROTECTED on his receipt',
      delta(B) > delta(B2) && delta(B2) === PP.lpDelta(1000, 3, 4) && delta(B) === p1[B].adjDelta && (low(ringOf(m, B)[0]) & F.RS) === 2, J([delta(B), delta(B2), p1[B]]));
    T('[4] a quick seat of the table (C) and the guest: no points row', posts(m, POINTS, C).length === 0 && posts(m, POINTS, C3).length === 0 && H.setPosts(m.last, POINTS).every((p) => /steamid=7656/.test(p.body)));
    T('[4] XP: the main and the strangers as at the ordinary table', xpOf(m, A) === xpOf(m, A2) && xpOf(m, B) === xpOf(m, B2) && xpOf(m, C) === xpOf(m, C2), J([[A, A2], [B, B2], [C, C2]].map((p) => p.map((s) => xpOf(m, s)))));
    const fa = vMut(["      for (const x of guests) { const mrow = planIn.find((q) => q.steamID === x.main); planIn.push({ steamID: x.steamID, seat: x.seat | 0, mmr: mrow.mmr, rank: rankOf[x.steamID], lp: mrow.lp }); }\n", ''], '[4a]');
    if (fa) {
      const cx = match(MT, 0x98935, [A, Z, B, C], [0, 2, 3]);
      const mx = run(SETTLE(cx), pts([A, B]), null, fa);
      const r = ringOf(mx, A);
      T('[4] mutant (the guest not in the plan: the main back to a solo): +' + PP.lpDelta(1000, 1, 4) + ' for the 1st place alone -- caught', mx.okAll && !!r && r[0].delta === PP.lpDelta(1000, 1, 4), J(r));
    }
    const fb = ppMut(['if (couch.size && !isCouch && u.length === 1 && base < 0) {', 'if (false) {'], '[4b]');
    if (fb) {
      const cx = match(MT, 0x98936, [A, Z, B, C], [0, 2, 3]);
      const mx = run(SETTLE(cx), pts([A, B]), null, fb);
      const r = ringOf(mx, B);
      T('[4] mutant (the solo shield taken out): the losing stranger pays the full ' + PP.lpDelta(1000, 3, 4) + ' -- caught', mx.okAll && !!r && r[0].delta === PP.lpDelta(1000, 3, 4), J(r));
    }
  }
  // ---- [9] the signal, and no trace of the guest's id ----
  if (on(9)) {
    T('[9] the couch matches counted on the main: cm 1 / cmr 1 (a ranked seat); nobody else carries them', sigOf(m, A) && sigOf(m, A).cm === 1 && sigOf(m, A).cmr === 1 && sigOf(m, A3).cm === 1
      && [B, C, A2, D2].every((s) => sigOf(m, s) && sigOf(m, s).cm == null), J([sigOf(m, A), sigOf(m, B)]));
    const gid = [1, 2, 3, 4, 5].map((s) => v.guestIdOf(s));
    const hay = m.rs.map((r) => J(r.raw) + J(r.posts)).join('\n');
    T('[9] the guest\'s id (and its hash) is in no state file and no board write', gid.every((g) => hay.indexOf(g) < 0 && hay.indexOf(v.pid(g)) < 0 && hay.indexOf(encodeURIComponent(g)) < 0) && /couch [0-9_-]+: guest seat 1/.test(m.out));
    T('[9] summary row', m.rs.some((r) => /\| couch pairs \(O989\)[^|]*\| 0 \/ 2 \/ 2 \/ 0 \|/.test(r.summary)), m.rs.map((r) => (/couch pairs[^\n]*/.exec(r.summary) || [''])[0]).join(' || '));
  }
}

// ---- [5] team codes ----
if (on(5)) {
  const [A, B, C] = SIDS(99020), [A2, D2, B2, C2] = SIDS(99030), [A3, B3, C3] = SIDS(99040);
  const TB = 3 | G(0b0010);
  const win = match(TB, 0x98941, [A, Z, B, C], [0, 2, 3], { sc: [900, 700, 600, 500] });        // team 0 (A + guest) wins on money
  const twin = match(3, 0x98942, [A2, D2, B2, C2], [0, 1, 2, 3], { sc: [900, 700, 600, 500] });
  const lose = match(TB, 0x98943, [A3, Z, B3, C3], [0, 2, 3], { sc: [500, 400, 900, 700] });    // team 0 (A + guest) loses
  const m = run(SETTLE([win, twin, lose]), {}, { SKILL_FILE: { [v.pid(D2)]: { mu: ts.DEFAULTS.mu, sigma: ts.DEFAULTS.sigma } } });
  T('[5] the three team matches settle', m.okAll && settled(m, win.key) && settled(m, twin.key) && settled(m, lose.key), m.out.slice(-1500));
  T('[5] the couch team is rated at full strength: every account moves as at the table where the guest is an account',
    J(mu2(skillOf(m, A))) === J(mu2(skillOf(m, A2))) && J(mu2(skillOf(m, B))) === J(mu2(skillOf(m, B2))) && J(mu2(skillOf(m, C))) === J(mu2(skillOf(m, C2))), J([skillOf(m, A), skillOf(m, A2), skillOf(m, B), skillOf(m, B2)]));
  T('[5] a couch pair that loses is rated: the main\'s rating goes down, the winners\' up; no "named-loser" hold (Q149)',
    skillOf(m, A3) && skillOf(m, A3).mu < ts.DEFAULTS.mu && skillOf(m, B3).mu > ts.DEFAULTS.mu && !new RegExp('named-loser ' + lose.key).test(m.out), J([skillOf(m, A3), skillOf(m, B3)]));
  const fa = vMut(['        for (let i = 0; i < guests.length; i++) sides[teamOfSeat(guests[i].seat, _mts)].push(guestTs[i]);   // O989: the team at its full strength\n', ''], '[5a]');
  if (fa) {
    const wx = match(TB, 0x98944, [A, Z, B, C], [0, 2, 3], { sc: [900, 700, 600, 500] });
    const mx = run(SETTLE(wx), {}, null, fa);
    T('[5] mutant (the guest left out of his team): the win reads as one against two, the main gains more -- caught', mx.okAll && settled(mx, wx.key) && skillOf(mx, A).mu > skillOf(m, A).mu, J([skillOf(mx, A), skillOf(m, A)]));
  }
  const fb = vMut(['      if (guestSeatMaskOf(matchType)) for (let s = 1; s < 2 * tsz; s++) if (isGuestSeat(matchType, s) && accSeats.has(s - 1)) accSeats.add(s);\n', ''], '[5b]');
  if (fb) {
    const lx = match(TB, 0x98945, [A3, Z, B3, C3], [0, 2, 3], { sc: [500, 400, 900, 700] });
    const mx = run(SETTLE(lx), {}, null, fb);
    T('[5] mutant (the guest seat left unaccounted): the lost match moves no rating -- the pair can only win -- caught', mx.okAll && settled(mx, lx.key) && new RegExp('named-loser ' + lx.key).test(mx.out) && !skillOf(mx, A3), J(skillOf(mx, A3)));
  }
  // the couch 2V2: two accounts, a guest each, both ranked
  const [P, Q] = SIDS(99050), [P2, Q2] = SIDS(99060);
  const DUO = 3 | S(0b0101) | G(0b1010);
  const sc = [900, 700, 600, 500];
  const plan = () => PP.matchPlan([[P, 0], ['g1', 1], [Q, 2], ['g3', 3]].map(([id, seat]) => ({ steamID: id, seat, mmr: 1000, rank: 0, lp: 1000 })), DUO, { scores: sc, leaverSeats: [], winTeam: null, absent: [], finished: [] });
  const want1 = plan();
  PP.configure(cfgOf(1, { COUCH_DUO_MULT: 0.5 }).vals); const wantHalf = plan(); PP.configure({});
  const d1 = match(DUO, 0x98946, [P, Z, Q, Z], [0, 2], { sc }), d2 = match(DUO, 0x98947, [P2, Z, Q2, Z], [0, 2], { sc });
  const ptsOf = (a, b) => ({ [a]: { score: 1000 }, [b]: { score: 1000 } });
  const ma = run(SETTLE(d1), ptsOf(P, Q)), mb = run(SETTLE(d2), ptsOf(P2, Q2), { RULES_CFG_FILE: cfgOf(1, { COUCH_DUO_MULT: 0.5 }) });
  const dl = (m, sid) => { const r = ringOf(m, sid); return r && r[0] ? r[0].delta : null; };
  T('[5] the couch 2V2 (two accounts, a guest each) settles on its two writers, a full team each: winner +' + want1[P].adjDelta + ', loser ' + want1[Q].adjDelta,
    ma.okAll && settled(ma, d1.key) && dl(ma, P) === want1[P].adjDelta && dl(ma, Q) === want1[Q].adjDelta && want1[P].adjDelta === Math.round(PP.lpSeg(1000).win / 2 + PP.lpSeg(1000).drip), J([dl(ma, P), dl(ma, Q), want1]));
  T('[5] ... and times COUCH_DUO_MULT (0.5 in the rules-cfg): winner +' + wantHalf[P].adjDelta + ', revision 1 on both receipts',
    mb.okAll && settled(mb, d2.key) && dl(mb, P2) === wantHalf[P].adjDelta && wantHalf[P].adjDelta === Math.round(want1[P].adjDelta * 0.5) && PP.receiptCfgRev(ringOf(mb, P2)[0].flags) === 1 && PP.receiptCfgRev(ringOf(mb, Q2)[0].flags) === 1,
    J([dl(mb, P2), wantHalf, ringOf(mb, P2)]));
}

// ---- [6] everybody else quit: the stayer's quit-lone settle on a couch table ----
if (on(6)) {
  const PEERS_GONE = 1, USER_QUIT = 5;
  const U = SIDS(99070), KEYH = 0x98951;
  const vecOf = (r) => J(r.d.slice(10, 10 + (r.d[8] | 0)));
  const claim = (mod, mt, ros, stay) => {
    const sc = ros.map((_, i) => 600 - 50 * i), key = KEYH + '_1234_' + mt;
    const d = rec(0xB1, mt, KEYH, stay, 1 + sc.filter((y) => y > sc[stay]).length, false, ros, sc, PEERS_GONE);
    const g = [{ steamID: ros[stay], shard: 's0', d, dispCode: PEERS_GONE, disp: mod.dispName(PEERS_GONE), roster: mod.decodeRoster(d) }];
    const acc = ros.map((s, i) => [s, i]).filter((x) => x[0] !== Z);
    const roster = {}; for (const [s, i] of acc) roster[i] = mod.pid(s);
    const p = { t0: 1, mt, roster, settled: [mod.pid(ros[stay])], started: acc.map((x) => mod.pid(x[0])) };
    const qs = new Set(acc.filter((x) => x[1] !== stay).map((x) => mod.pid(x[0]) + '|' + key));
    return mod.quitLoneClaim(p, key, g, {}, new Set(), {}, qs, qs, vecOf);
  };
  const rosA = [U[0], Z, U[1], U[2]];
  const c1 = claim(v, 1 | G(0b0010), rosA, 0), c2 = claim(v, 1 | (1 << 4) | G(0b0010), rosA, 0), c3 = claim(v, 1 | G(0b0010), rosA, 3);
  T('[6] unit: the couch main stayed, the two other accounts quit -> the claim names those two (the guest seat is nobody to wait for)', !!c1 && c1.w === U[0] && J(c1.os.map((x) => x.seat)) === J([2, 3]), J(c1));
  T('[6] unit: the same with the party bit of the couch pair itself in the code', !!c2 && J(c2.os.map((x) => x.seat)) === J([2, 3]), J(c2));
  T('[6] unit: a solo stayed, the couch main and the other solo quit -> the claim names seats 0 and 2', !!c3 && c3.w === U[2] && J(c3.os.map((x) => x.seat)) === J([0, 2]), J(c3));
  T('[6] unit: another party\'s bit keeps the key out, as before ("a party queue")', claim(v, 1 | (1 << 5) | G(0b0010), rosA, 0) === null && v.quitLoneMt(1 | (1 << 4)) !== 1 && v.quitLoneMt(1 | (1 << 4) | G(0b0010)) === 1 && v.quitLoneMt(1 | S(0b0101)) === 1);
  const fa = vMut(['  if (quitLoneMt(g[0].d[2]) !== QUIT_LONE.MT || quitLoneMt(p.mt) !== QUIT_LONE.MT ||', '  if (mtSansSeats(g[0].d[2]) !== QUIT_LONE.MT || mtSansSeats(p.mt) !== QUIT_LONE.MT ||'], '[6a]');
  if (fa) T('[6] mutant (the lane reads the code with the couch pair\'s party bit): that table is out -- caught', claim(require(fa), 1 | (1 << 4) | G(0b0010), rosA, 0) === null);
  const fb = vMut(['const mtQ = g[0].d[2] | 0, acc = accountSeatsOf(mtQ, pc);', 'const mtQ = g[0].d[2] | 0, acc = pc;'], '[6b]');
  if (fb) T('[6] mutant (every seat must carry an account): no claim on a couch table -- caught', claim(require(fb), 1 | G(0b0010), rosA, 0) === null);
  // end to end
  const [A, B, C] = SIDS(99080);
  const mt = 1 | G(0b0010), hash = 0x98952, ros = [A, Z, B, C], sc = [600, 550, 500, 450];
  const base = [A, B, C].map((s) => ({ sid: s, d: rec(0xB2, mt, hash, ros.indexOf(s), 0, false, ros) }))
    .concat([{ sid: A, d: rec(0xB1, mt, hash, 0, 1, true, ros, sc, PEERS_GONE) }], [B, C].map((s) => ({ sid: s, d: rec(0xB5, mt, hash, ros.indexOf(s), 0, false, ros, null, USER_QUIT) })));
  const STEP = 7 * MIN;
  const m = run([[0, base], [STEP, base], [STEP, base], [STEP, base], [2 * HOUR, base]], {});
  const key = hash + '_1234_' + mt;
  T('[6] end to end: settled on the quit-lone lane for the couch main (the win\'s XP, rank 1 of the one writer; the quitters a leave each, no XP)',
    m.okAll && new RegExp('quit-lone settle ' + key + ': ').test(m.out) && xpOf(m, A) > 50 && / rank1 /.test(xpLine(m, A)) && xpOf(m, B) == null && leavesOf(m, B) === 1 && leavesOf(m, C) === 1
    && !new RegExp('couch ' + key).test(m.out), m.out.split('\n').filter((l) => /quit-lone|start-orphan|consolation|  xp /.test(l)).join(' | '));
}

// ---- [7] sanity ----
if (on(7)) {
  const U = SIDS(99090);
  const grp = (mt, ros, seats, o) => {
    const sc = ros.map((_, i) => 6000 - 1000 * i), x = o || {};
    return seats.map((seat) => {
      const rr = (x.rosOf && x.rosOf[seat]) || ros, sid = (x.sidOf && x.sidOf[seat]) || ros[seat];
      const tsz = PP.teamSizeOfMt(mt), rank = PP.isTeamMt(mt) ? (PP.teamOfSeat(seat, tsz) === 0 ? 1 : tsz + 1) : 1 + sc.filter((y) => y > sc[seat]).length;
      const d = rec(0xB1, mt, 0x98961, seat, rank, false, rr, sc, 0);
      return { steamID: sid, shard: 's0', d, dispCode: 0, roster: v.decodeRoster(d) };
    });
  };
  const fl = (mt, ros, seats, o) => v.sanityFlags(grp(mt, ros, seats, o));
  const A = U[0], B = U[1], C = U[2], D = U[3], E = U[4];
  const okCases = [
    ['a brawl of four, the pair at seats 0-1', 1 | G(0b0010), [A, Z, B, C], [0, 2, 3]],
    ['... with the pair\'s own party bit', 1 | (1 << 4) | G(0b0010), [A, Z, B, C], [0, 2, 3]],
    ['a brawl of three, the pair at seats 1-2 (off the pair grid)', 1 | G(0b100), [A, B, Z], [0, 1]],
    ['a brawl of six, two couch pairs and a ranked seat', 1 | S(0b000101) | G(0b001010), [A, Z, B, Z, C, D], [0, 2, 4, 5]],
    ['a 2V2 (team brawl), a pair on each team', 3 | G(0b1010), [A, Z, B, Z], [0, 2]],
    ['a 2V2 (mode 2)', 5 | G(0b0010), [A, Z, B, C], [0, 2, 3]],
    ['a 3V3, guests at seats 2 and 4', 8 | G(0b010100), [A, B, Z, C, Z, D], [0, 1, 3, 5]],
  ];
  T('[7] unit: the honest couch tables pass', okCases.every((c) => fl(c[1], c[2], c[3]).length === 0), J(okCases.map((c) => [c[0], fl(c[1], c[2], c[3])]).filter((x) => x[1].length)));
  const badCases = [
    ['an old ranked code (2)', 2 | G(0b0010), [A, Z, B, C], [0, 2, 3], 'guest-mask'],
    ['a friends\' room', 10 | G(0b0010), [A, Z, B, C], [0, 2, 3], 'guest-mask'],
    ['a bot match', 11 | G(0b0010), [A, Z, B, C], [0, 2, 3], 'guest-mask'],
    ['the guest seat marked ranked', 1 | S(0b0010) | G(0b0010), [A, Z, B, C], [0, 2, 3], 'guest-mask'],
    ['a guest at seat 0', 1 | G(0b0001), [Z, A, B, C], [1, 2, 3], 'guest-range'],
    ['a bit past the seats', 1 | G(0b1000), [A, B, C], [0, 1, 2], 'guest-range'],
    ['one account alone with his guest', 1 | G(0b10), [A, Z], [0], 'guest-range'],
    ['two guests in a row', 1 | G(0b0110), [A, Z, Z, B], [0, 3], 'guest-pair'],
    ['a 2V2 guest at seat 2 (his main on the other team)', 5 | G(0b0100), [A, B, Z, C], [0, 1, 3], 'guest-pair'],
    ['a 3V3 guest at seat 3', 8 | G(0b001000), [A, B, C, Z, D, E], [0, 1, 2, 4, 5], 'guest-pair'],
    ['a party bit over the main and another seat', 1 | (1 << 4) | G(0b100), [A, B, Z, C], [0, 1, 3], 'guest-pair'],
    ['the pair inside a premade trio', 1 | (1 << 8) | G(0b00010), [A, Z, B, C, D], [0, 2, 3, 4], 'guest-pair'],
  ];
  T('[7] unit: each bad header gets its reason', badCases.every((c) => fl(c[1], c[2], c[3]).indexOf(c[4]) >= 0), J(badCases.map((c) => [c[0], fl(c[1], c[2], c[3])]).filter((x, i) => x[1].indexOf(badCases[i][4]) < 0)));
  T('[7] unit: every header reason is a header slug (held, nobody flagged), the record reasons the host\'s (dropped, nobody flagged)',
    ['guest-mask', 'guest-range', 'guest-pair'].every((s) => v.SANITY_HEADER_SLUGS.indexOf(s) >= 0) && ['guest-seat', 'guest-roster'].every((s) => v.SANITY_RECORD_SLUGS.indexOf(s) >= 0 && v.SANITY_HOST_SLUGS.indexOf(s) >= 0));
  {
    const g = grp(1 | G(0b0010), [A, Z, B, C], [0, 2, 3]), hh = v.sanityHeaderHeld(grp(2 | G(0b0010), [A, Z, B, C], [0, 2, 3]));
    T('[7] unit: a bad header holds the group, nobody of its own to flag', !!hh && hh.own.length === 0 && v.sanityFlags(g).length === 0, J(hh));
    const X = U[5];
    const gs = grp(1 | G(0b0010), [A, Z, B, C], [0, 1, 2, 3], { sidOf: { 1: X }, rosOf: { 1: [A, Z, B, C] } });   // an outsider writes from the guest seat
    const gr = grp(1 | G(0b0010), [A, Z, B, C], [0, 2, 3], { rosOf: { 3: [A, X, B, C] } });                         // C's record names an account on it
    const sp1 = v.sanitySplit(gs), sp2 = v.sanitySplit(gr);
    T('[7] unit: a result written from the guest seat is dropped alone (guest-seat), the three players kept', J(sp1.flags) === J(['guest-seat']) && sp1.drop.length === 1 && sp1.drop[0].sid === X && sp1.keep.length === 3 && !v.sanityDropFlags(sp1.drop[0]), J([sp1.flags, sp1.drop.map((x) => x.why)]));
    T('[7] unit: a result naming an account on the guest seat is dropped alone (guest-roster)', J(sp2.flags) === J(['guest-roster']) && sp2.drop.length === 1 && sp2.drop[0].sid === C && sp2.keep.length === 2 && !v.sanityDropFlags(sp2.drop[0]), J([sp2.flags, sp2.drop.map((x) => x.why)]));
  }
  {
    const r = spawnSync(process.execPath, ['-e', "const v=require(process.argv[1]),PP=require(process.argv[2]);const d=[0xB1,3,1|(2<<PP.GUEST_SEAT_SHIFT),1,1234,0,1,13,3,720,3,2,1,0,1,2,0,0,3,4];const g=[{steamID:'1',d,dispCode:0,roster:v.decodeRoster(d)}];console.log(JSON.stringify(v.sanityFlags(g)));", H.VALIDATE, path.join(H.ROOT, 'points-plan.js')],
      { env: Object.assign({}, process.env, { PT_MODE: '1', STATE_SALT: 's' }), encoding: 'utf8' });
    T('[7] unit: the playtest / demo job has no build that writes a guest seat -> mt', /"mt"/.test(r.stdout || ''), (r.stdout || '') + (r.stderr || '').slice(-300));
  }
  // end to end: an honest joiner whose result names an account on the guest seat (the table a modded host handed him)
  const [P, Q, R, X] = SIDS(99100);
  const mt = 1 | G(0b0010), hash = 0x98962;
  const mm = match(mt, hash, [P, Z, Q, R], [0, 2]);
  const rBad = { sid: R, seat: 3, d: rec(0xB1, mt, hash, 3, 4, false, [P, X, Q, R], mm.sc, 0) };
  const m = run(SETTLE(mm, []).map((st, i) => (i === 0 ? st : [st[0], st[1].concat([rBad])])), {});
  T('[7] end to end: his record is dropped alone, the other two settle; he is ranked at his own seat, no leaver, nobody flagged, no XP for the dropped record',
    m.okAll && settled(m, mm.key) && /only that record dropped, nobody flagged/.test(m.out) && !!skillOf(m, R) && leavesOf(m, R) === 0 && flaggedN(m) === 0 && xpOf(m, R) == null && xpOf(m, P) > 0 && !skillOf(m, X),
    m.out.split('\n').filter((l) => /sanity|leaver/.test(l)).join(' | ').slice(-700));
}

// ---- [8] rules-cfg ----
if (on(8)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-cfg-'));
  const put = (name, text) => { const f = path.join(tmp, name); fs.writeFileSync(f, text); return f; };
  const good = cfgOf(3, { COUCH_SOLO_LOSS: 0.5, COUCH_LP_MULT: 0 });
  T('[8] unit: no file / an empty object -> rev 0, the defaults', J(v.loadRulesCfg(path.join(tmp, 'none.json'))) === J(DFLT) && J(v.loadRulesCfg(put('e.json', '{}'))) === J(DFLT));
  T('[8] unit: a usable file reads as written', J(v.loadRulesCfg(put('g.json', J(good)))) === J(good));
  T('[8] unit: not JSON / a value out of range / a missing key / a rev 0 off the defaults -> marked bad, the defaults configured',
    [put('b1.json', '{nope'), put('b2.json', J(cfgOf(1, { COUCH_PAIR_WIN: 1.2 }))), put('b3.json', J({ rev: 1, vals: { COUCH_SOLO_LOSS: 0.8 } })), put('b4.json', J(cfgOf(0, { COUCH_LP_MULT: 0.5 }))), put('b5.json', J(cfgOf(128)))]
      .every((f) => { const c = v.loadRulesCfg(f); return !!c.bad && c.rev === 0 && J(c.vals) === J(DFLT.vals); }));
  T('[8] unit: this checkout\'s own rules-cfg.json (when there is one) is usable', !v.RULES_CFG.bad && (() => { const c = v.loadRulesCfg(path.join(H.ROOT, 'rules-cfg.json')); return !c.bad; })(), J(v.loadRulesCfg(path.join(H.ROOT, 'rules-cfg.json'))));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  T('[8] unit: the pulse row -- [magic, RULES_VER] + [PULSE_CFG, rev, the four numbers in permille], 8 numbers; read back whole; a pulse without the tail reads no cfg',
    J(PP.pulseDetails(good)) === J([PP.PULSE_MAGIC, PP.RULES_VER, PP.PULSE_CFG, 3, 500, 850, 1000, 0]) && J(PP.pulseOf(7, PP.pulseDetails(good)).cfg) === J(good)
    && J(PP.pulseDetails(DFLT)) === J([PP.PULSE_MAGIC, PP.RULES_VER, PP.PULSE_CFG, 0, 800, 850, 1000, 1000]) && PP.pulseOf(7, [PP.PULSE_MAGIC, PP.RULES_VER]).cfg === undefined && J(PP.pulseDetails()) === J([PP.PULSE_MAGIC, PP.RULES_VER]),
    J([PP.pulseDetails(good), PP.pulseOf(7, PP.pulseDetails(good))]));
  T('[8] unit: a later event on a receipt keeps its revision; a receipt without one stays 0 in bits 24-30',
    (() => { let r = PP.receiptPush([], 77, 12, 0, 0xff, 5); r = PP.receiptPush(r, 77, -100, F.LEAVE, 0); const p = PP.receiptPush([], 78, 3, 0, 0xff); return PP.receiptCfgRev(r[0].flags) === 5 && r[0].delta === -88 && PP.receiptVer(r[0].flags) === PP.RULES_VER && (p[0].flags >>> 24) === 0; })());
  // end to end: rev 1 settles the match; rev 2 afterwards moves nothing
  const [A, B, C] = SIDS(99110), [A2, B2, C2] = SIDS(99120), [A3, B3, C3] = SIDS(99130), [N1, N2] = SIDS(99140);
  const MT = 1 | S(0b0101) | G(0b0010);
  const c1 = cfgOf(1, { COUCH_SOLO_LOSS: 0.5, COUCH_PAIR_WIN: 0.5 }), c2 = cfgOf(2, {});
  const pts = (list) => { const o = {}; for (const s of list) o[s] = { score: 1000 }; return o; };
  const want = (cfg, ids) => { PP.configure(cfg.vals); const p = expectPlan(MT, [[ids[0], 0, 1, 1000], ['g', 1, 2, 1000], [ids[1], 2, 3, 1000], [ids[2], 3, 4, 1000]]); PP.configure({}); return p; };
  const freeze = (script, hash, ids) => {
    const mm = match(MT, hash, [ids[0], Z, ids[1], ids[2]], [0, 2, 3]);
    const st = SETTLE(mm).map((x) => [x[0], x[1], { RULES_CFG_FILE: c1 }]).concat([[6 * MIN, mm.all, { RULES_CFG_FILE: c2 }]]);
    return { mm, m: run(st, pts([ids[0], ids[1]]), null, script) };
  };
  const fz = freeze(null, 0x98971, [A, B, C]);
  const w1 = want(c1, [A, B, C]), w2 = want(c2, [A, B, C]);
  const ringA = ringOf(fz.m, A), ringB = ringOf(fz.m, B);
  T('[8] (the case reads apart: rev 1 and rev 2 give the main and the stranger other points)', w1[A].adjDelta !== w2[A].adjDelta && w1[B].adjDelta !== w2[B].adjDelta, J([w1, w2]));
  T('[8] the match settles with the file\'s numbers (rev 1): the main +' + w1[A].adjDelta + ', the losing stranger ' + w1[B].adjDelta, fz.m.okAll && settled(fz.m, fz.mm.key) && !!ringA && ringA[0].delta === w1[A].adjDelta && ringB[0].delta === w1[B].adjDelta, J([ringA, ringB]) + fz.m.out.slice(-600));
  T('[8] revision 1 on every receipt of the couch match (bits 24-30); the RULES_VER bits untouched', PP.receiptCfgRev(ringA[0].flags) === 1 && PP.receiptCfgRev(ringB[0].flags) === 1 && PP.receiptVer(ringA[0].flags) === PP.RULES_VER);
  T('[8] frozen: the run under rev 2 writes no points and the receipts stay as settled', posts(fz.m, POINTS, A).length === 1 && posts(fz.m, POINTS, B).length === 1 && H.setPosts(fz.m.last, POINTS).length === 0);
  T('[8] the pulse row carries the cfg in force: rev 1 with its numbers, then rev 2', J(pulseOfRun(fz.m.rs[3])) === J(PP.pulseDetails(c1)) && J(pulseOfRun(fz.m.last)) === J(PP.pulseDetails(c2)) && /rules-cfg: rev 2 /.test(fz.m.last.out), J([pulseOfRun(fz.m.rs[3]), pulseOfRun(fz.m.last)]));
  const fm = vMut(['    processed.add(c.m); settled++; likeKeys.push(c.m);', '    settled++; likeKeys.push(c.m);'], '[8a]');
  if (fm) {
    const mx = freeze(fm, 0x98972, [A2, B2, C2]);
    T('[8] mutant (a settled key not remembered): the match settles again under rev 2 -- a second points write -- caught', mx.m.okAll && posts(mx.m, POINTS, A2).length >= 2, String(posts(mx.m, POINTS, A2).length));
  }
  const fs2 = vMut(['    const couchRev = guestSeatMaskOf(matchType) ? RULES_CFG.rev : null;', '    const couchRev = null;'], '[8b]');
  if (fs2) {
    const mx = freeze(fs2, 0x98973, [A3, B3, C3]);
    const r = ringOf(mx.m, A3);
    T('[8] mutant (no revision on the receipt): caught', mx.m.okAll && !!r && PP.receiptCfgRev(r[0].flags) === 0, J(r));
  }
  // COUCH_LP_MULT 0: nothing moves, a promotion match included
  {
    const [M0, S0, Q0] = SIDS(99150);
    const mm = match(MT, 0x98974, [M0, Z, S0, Q0], [0, 2, 3]);
    const m = run(SETTLE(mm), { [M0]: { score: 520 }, [S0]: { score: 1000 } }, { RULES_CFG_FILE: cfgOf(4, { COUCH_LP_MULT: 0 }) });
    const r = ringOf(m, M0);
    T('[8] COUCH_LP_MULT 0: the couch main, a win in a promotion match (520, 80 under the line), moves no points and crosses no line; the stranger settles as ever',
      m.okAll && settled(m, mm.key) && PP.boundaryOf(520) === 'promotion' && lastOf(m, POINTS, M0).score === 520 && r[0].delta === 0 && (low(r[0]) & F.SERIES) === 0 && PP.receiptCfgRev(r[0].flags) === 4
      && ringOf(m, S0)[0].delta === expectPlan(MT, [[M0, 0, 1, 520], ['g', 1, 2, 520], [S0, 2, 3, 1000], [Q0, 3, 4, 0]])[S0].adjDelta, J([lastOf(m, POINTS, M0), r, ringOf(m, S0)]));
  }
  // an unusable file: the couch matches wait, everything else settles
  {
    const couch = match(MT, 0x98975, [A, Z, B, C], [0, 2, 3]), plain = match(1, 0x98976, [N1, N2], [0, 1]);
    const st = SETTLE([couch, plain]).map((x) => [x[0], x[1], { RULES_CFG_FILE: 'not a cfg' }]).concat([[6 * MIN, couch.all.concat(plain.all), { RULES_CFG_FILE: c1 }]]);
    const m = run(st, pts([A, B]));
    T('[8] an unusable rules-cfg: warned every run, the couch match waits (not settled, no points), the plain match settles, the pulse row has no cfg',
      m.okAll && /rules-cfg [^\n]* is not usable/.test(m.rs[0].out) && new RegExp('couch-cfg-hold ' + couch.key).test(m.rs[3].out) && !new Set(m.rs[3].state.PROCESSED_FILE || []).has(couch.key)
      && new Set(m.rs[3].state.PROCESSED_FILE || []).has(plain.key) && posts({ rs: m.rs.slice(0, 4) }, POINTS, A).length === 0 && J(pulseOfRun(m.rs[3])) === J([PP.PULSE_MAGIC, PP.RULES_VER]),
      m.rs[3].out.split('\n').filter((l) => /couch|rules-cfg|cron pulse/.test(l)).join(' | '));
    T('[8] ... and settles with the fixed file\'s numbers on the next run', settled(m, couch.key) && ringOf(m, A)[0].delta === want(c1, [A, B, C])[A].adjDelta && PP.receiptCfgRev(ringOf(m, A)[0].flags) === 1, J(ringOf(m, A)));
  }
}
console.log(failN ? ('guest-seat-settle: ' + failN + ' FAIL') : 'guest-seat-settle: all ok');
process.exit(failN ? 1 : 0);
