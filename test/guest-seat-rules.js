'use strict';
// O989 shipped with RULES_VER unchanged (2): the couch-pair rules read only a match type with a guest-seat mask, which no
// build before O989 can write, and a job whose pulse row shows another RULES_VER than a client's makes that client show every
// ranked result as "to be confirmed" (its confidence gate is a plain inequality). That call stands on two facts, pinned here
// against test/fixtures/pre-o989/points-plan.js -- a frozen copy of the rules file as every live build vendors it (taken at the
// commit before O989; self-contained, so it also IS their decoder of the pulse row and of the receipts):
//   [1] no guest mask -> the same output, field for field: the points plans (brawl / team, every party form, mismatch,
//       leavers, absent and finished rows), the settle line, the seeds, the receipts and the pulse reading, over the golden
//       cases of before O989 and a few thousand generated tables
//   [2] the golden cases of before O989 are still in the case file, byte for byte (inputs and outputs); the new cases are
//       couch tables only
//   [3] an old build reads the new pulse row as before (minute, RULES_VER -- the tail is not looked at): its confidence
//       inputs do not move; the row stays far under the 64 numbers a leaderboard row holds
//   [4] an old build reads a receipt with a rules-cfg revision in bits 24-30 as before (the RULES_VER bits, the flag byte)
//   [5] mutation proof: a rules file whose couch rules do not look at the mask (the shield on every brawl with a premade
//       pair; the multiplier on every team row) turns [1] red
// When RULES_VER moves for another reason this test has done its job: it skips itself (see the first line of code).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const PP = require(path.join(ROOT, 'points-plan.js'));
const OLD = require(path.join(__dirname, 'fixtures', 'pre-o989', 'points-plan.js'));
const G = require(path.join(ROOT, 'tools', 'gen-points-fixtures.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

console.log('=== O989: a table without a guest seat settles as before, an old build reads the new rows as before ===');
if (PP.RULES_VER !== OLD.RULES_VER) {
  console.log('  skip  RULES_VER moved (' + OLD.RULES_VER + ' -> ' + PP.RULES_VER + '): the frozen copy is no longer what the live builds run');
  console.log('guest-seat-rules: all ok (skipped)');
  process.exit(0);
}
const PRE_HASH = 'e482ca6f7351bb55';   // FIXTURES_HASH of the case file before O989 (the frozen copy carries it)

// ---- generated tables without a guest mask (deterministic) ----
let seed = 0x9891989;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (xs) => xs[ri(0, xs.length - 1)];
const LPS = [0, 40, 480, 520, 590, 610, 700, 1000, 1890, 1990, 2010, 2100, 2950, 3050, 3990, 4100, 5900, 6100, 7990, 8100, 9990];
const MMRS = [600, 900, 1000, 1100, 1300, 1450, 1500, 1700, 2100, 2600];
function brawl() {
  const pc = ri(2, 6);
  const ranked = ri(0, 3) === 0 ? 0 : ri(1, (1 << pc) - 1);
  let mt = (ranked ? 1 : 2) | (ranked << PP.RANKED_SEAT_SHIFT);
  if (pc >= 5 && ri(0, 3) === 0) mt |= ri(1, pc - 2) << 8;                                  // a premade trio (trioAt = start seat + 1)
  for (let k = 0; k < 3; k++) if (2 * k + 1 < pc && ri(0, 2) === 0) mt |= 1 << (4 + k);       // premade pairs (overlaps with a trio included: the old rule decides)
  const order = []; for (let i = 0; i < pc; i++) order.push(i);
  for (let i = pc - 1; i > 0; i--) { const j = ri(0, i), t = order[i]; order[i] = order[j]; order[j] = t; }
  const tie = ri(0, 4) === 0;
  const parts = [];
  for (let seat = 0; seat < pc; seat++) {
    if (pc > 2 && ri(0, 7) === 0) continue;                                                   // an absent seat
    parts.push({ steamID: 's' + seat, seat, mmr: pick(MMRS), rank: tie ? Math.max(1, order[seat]) : order[seat] + 1, lp: pick(LPS) });
  }
  return { mt, parts, team: null };
}
function team() {
  const base = pick([3, 4, 5, 6, 8, 9]), ts = (base === 8 || base === 9) ? 3 : 2, pc = 2 * ts;
  const quickFam = base === 3 || base === 5 || base === 8;
  const mt = base | ((quickFam ? ri(0, (1 << pc) - 1) : 0) << PP.RANKED_SEAT_SHIFT);
  const scores = []; for (let i = 0; i < pc; i++) scores.push(ri(0, 9) * 100);
  const gone = []; for (let s = 0; s < pc; s++) if (ri(0, 6) === 0) gone.push(s);
  const parts = [];
  for (let seat = 0; seat < pc; seat++) if (gone.indexOf(seat) < 0) parts.push({ steamID: 's' + seat, seat, mmr: pick(MMRS), rank: 0, lp: pick(LPS) });
  const row = (seat) => ({ seat, mmr: pick(MMRS), lp: pick(LPS) });
  const leaverSeats = gone.filter(() => ri(0, 1) === 0);
  const absent = leaverSeats.filter(() => ri(0, 1) === 0).map(row);
  const finished = gone.filter((s) => leaverSeats.indexOf(s) < 0 && ri(0, 1) === 0).map(row);
  return { mt, parts, team: { scores, leaverSeats, winTeam: ri(0, 2) === 0 ? null : ri(0, 1), absent, finished } };
}
// everything the settle reads off a table: the plan rows and each rated player's line in each mode
function reading(M, t) {
  const plan = M.matchPlan(t.parts, t.mt, t.team);
  const lines = t.parts.map((p) => [false, true, { seeded: false, placing: true }].map((mode) => M.settleLine(p.lp, plan ? plan[p.steamID] : null, p.rank || 1, t.parts.length, mode)));
  return J([plan, lines]);
}
const TABLES = [];
for (let i = 0; i < 4000; i++) TABLES.push(i % 3 === 2 ? team() : brawl());

// ---- [1] ----
{
  const diff = TABLES.filter((t) => reading(PP, t) !== reading(OLD, t));
  T('[1] ' + TABLES.length + ' generated tables without a guest mask (brawls and team codes, parties, mixed ranked seats, leavers): plan and settle line the same, field for field', diff.length === 0,
    diff.length + ' differ, first: ' + (diff[0] ? J(diff[0]) + ' new ' + reading(PP, diff[0]) + ' old ' + reading(OLD, diff[0]) : ''));
  T('[1] (the tables reach the rules: plans, flags, series clamps and parties all occur)', (() => {
    let plans = 0, flags = 0, clamps = 0, units = 0;
    for (const t of TABLES) { const p = PP.matchPlan(t.parts, t.mt, t.team); if (!p) continue; plans++; for (const k of Object.keys(p)) { if (p[k].flag) flags++; } if (PP.premadeMaskOf(t.mt) || PP.premadeTrioAtOf(t.mt)) units++;
      for (const q of t.parts) { const l = PP.settleLine(q.lp, p[q.steamID], q.rank || 1, t.parts.length, false); if (l.clamped) clamps++; } }
    return plans > 1000 && flags > 200 && clamps > 50 && units > 300;
  })());
  const doc = JSON.parse(fs.readFileSync(G.FILE, 'utf8'));
  const old = doc.cases.filter((c) => !/^couch/.test(c.name));
  const same = old.filter((c) => J(G.replay(PP, Object.assign({ kind: c.kind }, c.in))) === J(G.replay(OLD, Object.assign({ kind: c.kind }, c.in))));
  T('[1] the ' + old.length + ' golden cases of before O989 replay to the same output on both rules files', same.length === old.length && old.length > 50, same.length + ' of ' + old.length);
  const seeds = []; for (let d = 0; d <= 3600; d += 37) for (const prev of [null, 0, 590, 2400, 6100, 9000]) for (const hs of [false, true]) seeds.push([prev, d, hs]);
  T('[1] seeds, tier reads and the leaver fine: the same', seeds.every(([p, d, hs]) => PP.seasonSeedLp(p, d, hs) === OLD.seasonSeedLp(p, d, hs) && PP.seedLp(d) === OLD.seedLp(d))
    && LPS.every((lp) => J(PP.lpSeg(lp)) === J(OLD.lpSeg(lp)) && PP.boundaryOf(lp) === OLD.boundaryOf(lp) && PP.softResetLp(lp) === OLD.softResetLp(lp) && PP.leaverLpPenalty(lp, 100) === OLD.leaverLpPenalty(lp, 100)));
  T('[1] every knob the frozen copy has keeps its default; configure({}) on the new file touches none of them', Object.keys(OLD.DEFAULTS).every((k) => PP.DEFAULTS[k] === OLD.DEFAULTS[k]) && PP.configure({}).length === 0);
  // receipts: every push without a revision gives the old ring
  let rN = [], rO = [], okR = true;
  for (let i = 0; i < 400; i++) {
    const mh = ri(1, 12), ch = ri(-120, 60), set = pick([0, 1, 2, 4, 8, 16, 32, 3 | 8, 4 | 16]), clear = pick([0, 0xff, 4]);
    rN = PP.receiptPush(rN, mh, ch, set, clear); rO = OLD.receiptPush(rO, mh, ch, set, clear);
    if (J(rN) !== J(rO) || J(PP.lpDetails(null, rN)) !== J(OLD.lpDetails(null, rO))) { okR = false; break; }
  }
  T('[1] receipts: 400 events without a revision build the same ring and the same row details', okR, J([rN.slice(0, 2), rO.slice(0, 2)]));
}

// ---- [2] ----
{
  const text = fs.readFileSync(G.FILE, 'utf8'), doc = JSON.parse(text);
  const pre = Object.assign({}, doc, { cases: doc.cases.filter((c) => !/^couch/.test(c.name)) });
  const added = doc.cases.filter((c) => /^couch/.test(c.name));
  T('[2] the case file without its couch cases is the case file of before O989 (canonical hash ' + PRE_HASH + ')', OLD.FIXTURES_HASH === PRE_HASH && G.canonHash(G.render(pre)) === PRE_HASH, G.canonHash(G.render(pre)));
  T('[2] every case added is a couch table (a guest mask in its match type); none of the old cases carries one', added.length >= 6 && added.every((c) => PP.guestSeatMaskOf(c.in.mt) !== 0)
    && pre.cases.every((c) => !(c.in && c.in.mt != null && PP.guestSeatMaskOf(c.in.mt))), added.map((c) => c.name).join(','));
  T('[2] the case file carries RULES_VER ' + OLD.RULES_VER + ', as before', doc.rulesVer === OLD.RULES_VER);
}

// ---- [3] ----
{
  const dflt = { rev: 0, vals: {} }; for (const k of PP.CFG_KEYS) dflt.vals[k] = PP.DEFAULTS[k];
  const moved = { rev: 127, vals: { COUCH_SOLO_LOSS: 0, COUCH_PAIR_WIN: 1, COUCH_DUO_MULT: 0.001, COUCH_LP_MULT: 0.999 } };
  const rows = [PP.pulseDetails(), PP.pulseDetails(dflt), PP.pulseDetails(moved)];
  T('[3] an old build reads every form of the new pulse row as { minute, rulesVer } alone, RULES_VER as its own (its confidence gate sees no change)',
    rows.every((d) => J(OLD.pulseOf(29000000, d)) === J({ minute: 29000000, rulesVer: OLD.RULES_VER })), J(rows.map((d) => OLD.pulseOf(1, d))));
  T('[3] the new reader: the tail read back whole; a row without one (a job before O989, or holding couch matches) reads no cfg', J(PP.pulseOf(1, rows[2]).cfg) === J(moved) && J(PP.pulseOf(1, rows[1]).cfg) === J(dflt)
    && PP.pulseOf(1, rows[0]).cfg === undefined && PP.pulseOf(1, OLD.pulseDetails()).cfg === undefined && J(PP.pulseOf(1, OLD.pulseDetails())) === J(OLD.pulseOf(1, OLD.pulseDetails())));
  T('[3] a tail that is not a cfg (a value off its range, a short row) reads no cfg and does not hide the pulse', PP.pulseOf(1, [0xCC, 2, 0xC9, 1, 800, 850, 1000, 1001]).cfg === undefined
    && PP.pulseOf(1, [0xCC, 2, 0xC9, 1, 800]).cfg === undefined && PP.pulseOf(1, [0xCC, 2, 0xC8, 1, 800, 850, 1000, 1000]).cfg === undefined && PP.pulseOf(1, [0xCC, 2, 0xC9, 1, 800, 850, 1000, 1001]).rulesVer === 2);
  T('[3] the row is 8 numbers (a leaderboard row holds 64)', rows[2].length === 8 && rows[1].length === 8 && rows[0].length === 2);
}

// ---- [4] ----
{
  let ring = PP.receiptPush([], 501, 27, PP.RECEIPT_F.SERIES, 0xff, 5);
  ring = PP.receiptPush(ring, 502, -17, 2, 0xff, 127);
  const det = PP.lpDetails(null, ring), o = OLD.lpDetailsOf(det), n = PP.lpDetailsOf(det);
  T('[4] an old build reads receipts carrying a rules-cfg revision: the same entries (match, delta), the flag byte and RULES_VER as written',
    o.ring.length === 2 && o.ring.every((e, i) => e.mh === n.ring[i].mh && e.delta === n.ring[i].delta && (e.flags & 0xff) === (n.ring[i].flags & 0xff) && OLD.receiptVer(e.flags) === OLD.RULES_VER)
    && J(OLD.receiptOf(det, 501)) === J(PP.receiptOf(det, 501)) && (o.ring[0].flags & 0xff) === 2 && (o.ring[1].flags & 0xff) === PP.RECEIPT_F.SERIES, J(o));
  T('[4] ... and its placement count reads them as ordinary settled matches', J(OLD.placementOf(det, OLD.PLACEMENT_TARGET)) === J(PP.placementOf(det, PP.PLACEMENT_TARGET)) && J(OLD.placementOf(det, 5)) === J(OLD.placementOf(PP.lpDetails(null, ring.map((e) => Object.assign({}, e, { flags: e.flags & 0xffffff }))), 5)));
  T('[4] the revision stays clear of the sign bit (a row number is a signed 32-bit integer)', ring.every((e) => e.flags > 0 && (e.flags | 0) === e.flags) && PP.receiptCfgRev(ring[0].flags) === 127 && PP.receiptCfgRev(ring[1].flags) === 5);
}

// ---- [5] mutation proof ----
{
  const src = fs.readFileSync(path.join(ROOT, 'points-plan.js'), 'utf8');
  const load = (from, to) => {
    if (src.split(from).length !== 2) { bad('[5] mutant anchor not found exactly once: ' + from.slice(0, 80)); return null; }
    const f = path.join(ROOT, '.mutant-guest-rules-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js');
    fs.writeFileSync(f, src.replace(from, to));
    try { return require(f); } finally { try { fs.unlinkSync(f); } catch (e) {} }
  };
  const m1 = load('if (couch.size && !isCouch && u.length === 1 && base < 0) {', 'if (units.some((q) => q.length === 2) && u.length === 1 && base < 0) {');
  if (m1) T('[5] mutant (the solo shield on every brawl with a premade pair, mask or not): [1] goes red', TABLES.some((t) => reading(m1, t) !== reading(OLD, t)));
  const m2 = load('return gs >= 0 && seatHere.has(gs); }).length) : 1;', 'return gs >= 0 && seatHere.has(gs); }).length) : 0.5;');
  if (m2) T('[5] (a team multiplier on every table moves nothing while the row test still reads the mask)', TABLES.every((t) => reading(m2, t) === reading(OLD, t)));
  const m3 = load('if (cMult !== 1 && guestSeatOfMain(matchType, p.seat) >= 0 && seatHere.has(guestSeatOfMain(matchType, p.seat))) {', 'if (guestSeatOfMain(matchType, p.seat) < 0) {');
  if (m3) T('[5] mutant (the couch multiplier row test reversed: every ordinary team row marked): [1] goes red', TABLES.some((t) => reading(m3, t) !== reading(OLD, t)));
  const m4 = load('const rev = cfgRev == null ? (old ? receiptCfgRev(old.flags) : 0) : ((cfgRev | 0) & 0x7f);', 'const rev = 1;');
  if (m4) T('[5] mutant (a revision on every receipt): the ring differs from the old one', J(m4.receiptPush([], 1, 2, 0, 0xff)) !== J(OLD.receiptPush([], 1, 2, 0, 0xff)));
}
console.log(failN ? ('guest-seat-rules: ' + failN + ' FAIL') : 'guest-seat-rules: all ok');
process.exit(failN ? 1 : 0);
