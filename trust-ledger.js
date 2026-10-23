'use strict';
// ============================================================
// trust-ledger.js -- O198 trust ledger v1 (client knife 5.5b-1, 2026-10-23)
// ============================================================
// One permanent, de-identified event stream per account (HMAC pid, like every state file): every violation signal the
// pipeline produces, tagged with its source, kept as evidence. It is the BASE the trust index stands on -- v1 judges
// nothing new from it (the trust_tier algorithm is unchanged; the one new judgment, the shadow-pool bit, reads the seedcap
// reject window directly). Pure functions here; the IO sits in validate.js (sole writer of trust.json), seedcap.js and
// sanctions.js (producers: they queue events in THEIR OWN state file, validate takes them -- never two workflows writing
// one file, the O124 seedcapApplied handshake discipline).
//
// Sources (TRUST_SOURCES, three bits each: recorded? / feeds the trust_tier tier? / feeds the shadow-pool bit?):
//   sc  seedcap conviction        recorded   tier: no (v1 algorithm unchanged)   shadow: YES (= the reject window)
//       a mathematical upper bound exceeded, on a seat its own account wrote, in a group whose records all agree --
//       the highest-confidence conviction the chain has. sev 0 = observation-only (O285 (1): a new world core's first
//       72 h / 200 audits; not a conviction, n.sc does not move).
//   sa  EAC sanction (sanctions.js)  recorded  tier: no  shadow: no -- the ban gate board is its own hard gate already
//   at  guard-signature failure (solo lane)  recorded (split out of f)  tier: as today (still folded into f)  shadow: no
//       -- a failure mixes key / version accidents with forgery
//   fl  consensus forgery flag    recorded   tier: as today (F1 / F2)   shadow: no -- attribution not split yet (O198 (5),
//       waits for the knife 5.8 result signatures, cloud ruling A42)
//   rp  verified reports crossed a tier floor   recorded   tier: as today   shadow: no -- can be brigaded
//   hd  team-gamble host charges crossed a tier floor   recorded   tier: as today   shadow: no
//   tm  guard timeclock signal    SLOT ONLY, not armed: nothing reads tm until Q199 lands (O460: a slow joiner trips it)
//
// State (trust.json, validate.js writes it; three channels as usual: pt- / demo- prefixes):
//   { v: 1, acct: { pid: { n: {sc,sa,at,fl,rp,hd,tm}, fp, first, last: {t, src}, ev: [<= EV_CAP], lv: {rp, hd}, mw } },
//     taken: { seedcap: <last event id taken>, sanctions: <...> } }
//   ev item = { t (unix minutes), s (source), v (sev 0-3), m? (match key), c? (context), fp? ('replay' | 'review') }
//   n = lifetime counts of sev >= 1 events (never decays: "times considered a violation"); fp = convictions later
//   reversed (seedcap replay on a new world core / ops review); lv = the rp / hd tier contribution last recorded (an
//   event is written when it RISES); mw = 1 while the mirror board row is behind the file.
// Mirror board trust_ledger (Trusted writes, FRIENDS-ONLY reads -- it is a count of suspected violations, more sensitive
//   than the coarse public trust_tier; analysis / appeals read it with the publisher key):
//   score = n.sc + n.sa (the high-confidence total; absolute, ForceUpdate self-heals)
//   details = [MAGIC | VER << 8, n.sc, n.sa, n.at, n.fl, n.rp, n.hd, n.tm, fp, last.t, last.src code]   (11 int32)
// ============================================================

const TRUST_LEDGER_MAGIC = 0xE4;
const TRUST_LEDGER_VER = 1;
// trust_tier row score bit 3: an open seedcap reject window = the account matches in the shadow pool (client knife 5.5b-2).
//   Lockstep: the client repo's matchmaker boundary test names the same constant.
const TRUST_REJ_BIT = 8;
const SRC_CODE = Object.freeze({ sc: 1, sa: 2, at: 3, fl: 4, rp: 5, hd: 6, tm: 7 });
const SRCS = Object.keys(SRC_CODE);
const TRUST_SOURCES = Object.freeze({
  sc: Object.freeze({ record: true, tier: false, shadow: true, armed: true }),
  sa: Object.freeze({ record: true, tier: false, shadow: false, armed: true }),
  at: Object.freeze({ record: true, tier: true, shadow: false, armed: true }),
  fl: Object.freeze({ record: true, tier: true, shadow: false, armed: true }),
  rp: Object.freeze({ record: true, tier: true, shadow: false, armed: true }),
  hd: Object.freeze({ record: true, tier: true, shadow: false, armed: true }),
  tm: Object.freeze({ record: false, tier: false, shadow: false, armed: false }),   // O460: not before Q199
});
const EV_CAP = 32;          // events kept per account (the counts in n are lifetime)
const ACCT_CAP = Math.max(1000, Number(process.env.TRUST_ACCT_CAP || 50000));   // size fuse (accounts)
const QUEUE_CAP = Math.max(100, Number(process.env.TRUST_QUEUE_CAP || 2000));   // producer queue fuse (events)
const MIRROR_MAX_PER_RUN = Math.max(1, Number(process.env.TRUST_MIRROR_MAX || 200));

const zeroN = () => ({ sc: 0, sa: 0, at: 0, fl: 0, rp: 0, hd: 0, tm: 0 });

// normalize a parsed trust.json (or null) into the v1 shape; unknown fields are kept
function loadLedger(obj) {
  const L = (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  if (!(L.v >= 1)) L.v = TRUST_LEDGER_VER;
  if (!L.acct || typeof L.acct !== 'object') L.acct = {};
  if (!L.taken || typeof L.taken !== 'object') L.taken = {};
  return L;
}
function acctOf(L, p, t) {
  let a = L.acct[p];
  if (!a) a = L.acct[p] = { n: zeroN(), fp: 0, first: t | 0, last: { t: t | 0, src: '' }, ev: [] };
  if (!a.n) a.n = zeroN();
  for (const k of SRCS) if (!(a.n[k] >= 0)) a.n[k] = 0;
  if (!Array.isArray(a.ev)) a.ev = [];
  return a;
}
// a high-confidence event (sc / sa) is evicted only after every other kind: the cap keeps the evidence that matters
const keepRank = (e) => ((e && (e.s === 'sc' || e.s === 'sa')) ? 1 : 0);
function capEvents(a) {
  while (a.ev.length > EV_CAP) {
    let drop = -1;
    for (let i = 0; i < a.ev.length; i++) if (!keepRank(a.ev[i])) { drop = i; break; }   // oldest low-confidence first
    a.ev.splice(drop < 0 ? 0 : drop, 1);
  }
}
// record one event; returns true when the ledger changed. ev = { t, src, sev, m?, ctx? }. An unarmed source records nothing.
function recordEvent(L, p, ev) {
  if (!p || !ev || !TRUST_SOURCES[ev.src] || !TRUST_SOURCES[ev.src].record || !TRUST_SOURCES[ev.src].armed) return false;
  const t = ev.t | 0, sev = Math.max(0, Math.min(3, ev.sev | 0));
  const a = acctOf(L, String(p), t);
  // one event per (source, match key): a re-queued producer event never counts twice
  if (ev.m != null && a.ev.some((e) => e.s === ev.src && e.m === String(ev.m) && !e.fp && (e.v | 0) === sev)) return false;
  const item = { t, s: ev.src, v: sev };
  if (ev.m != null) item.m = String(ev.m);
  if (ev.ctx && typeof ev.ctx === 'object' && Object.keys(ev.ctx).length) item.c = ev.ctx;
  a.ev.push(item);
  capEvents(a);
  if (sev >= 1) a.n[ev.src] = (a.n[ev.src] | 0) + 1;
  if (!(a.first > 0) || t < a.first) a.first = t;
  if (t >= (a.last && a.last.t | 0)) a.last = { t, src: ev.src };
  a.mw = 1;
  return true;
}
// a conviction found false later (seedcap replay on a new world core, ops review): the event is marked, fp counts it.
//   The lifetime n stays (user 2026-09-07: the permanent "considered a violation" count); the reject window reads
//   n - fp (validate.js seedcapNEff, from the seedcap side's own fpm list).
function markFalsePositive(L, p, m, t, why) {
  const a = L.acct[String(p)];
  if (!a) return false;
  const e = (a.ev || []).find((x) => x.s === 'sc' && x.m === String(m) && (x.v | 0) >= 1 && !x.fp);
  if (e) e.fp = why || 'replay';
  else if (!a.ev.some((x) => x.s === 'sc' && x.m === String(m) && x.fp)) {
    // the conviction event fell out of the kept events (or predates the ledger): still counted, kept as a marker
    a.ev.push({ t: t | 0, s: 'sc', v: 0, m: String(m), fp: why || 'replay' }); capEvents(a);
  } else return false;   // already marked
  a.fp = (a.fp | 0) + 1;
  a.mw = 1;
  return true;
}
// take a producer queue (seedcap / sanctions state `events`, ids ascending): every event past the cursor is recorded once
//   (sc events with fp set mark a reversal instead). Returns { took, lost } (lost = ids skipped by the producer's fuse).
function takeQueue(L, name, events) {
  const res = { took: 0, lost: 0, changed: false };
  const cur = Number(L.taken[name]) || 0;
  let max = cur, expect = cur + 1;
  const list = (Array.isArray(events) ? events : []).filter((e) => e && Number(e.id) > cur).sort((a, b) => a.id - b.id);
  for (const e of list) {
    const id = Number(e.id) || 0;
    if (cur > 0 && id > expect) res.lost += id - expect;
    expect = id + 1;
    if (id > max) max = id;
    res.took++;
    if (e.fp) { if (markFalsePositive(L, e.p, e.m, e.t, e.fp === 1 ? 'replay' : String(e.fp))) res.changed = true; continue; }
    if (recordEvent(L, e.p, { t: e.t, src: e.src, sev: e.sev, m: e.m, ctx: e.ctx })) res.changed = true;
  }
  if (max !== cur) { L.taken[name] = max; res.changed = true; }
  return res;
}
// rp / hd: an event when the account's tier contribution RISES above the one last recorded (lv); a fall lowers lv quietly
function levelOf(x, floor1, floor2) { x |= 0; return x >= floor2 ? 2 : (x >= floor1 ? 1 : 0); }
function noteLevels(L, p, t, comps, T) {
  if (!p || !comps || !T) return false;
  let changed = false;
  const a0 = L.acct[String(p)];
  for (const [src, val, f1, f2] of [['rp', comps.vur, T.VUR1, T.VUR2], ['hd', comps.hd, T.HD1, T.HD2]]) {
    const lv = levelOf(val, f1, f2);
    const had = (a0 && a0.lv && a0.lv[src]) | 0;
    if (lv > had) {
      recordEvent(L, p, { t, src, sev: lv, ctx: { x: val | 0 } });
      const a = L.acct[String(p)];
      a.lv = Object.assign({}, a.lv || {}, { [src]: lv });
      changed = true;
    } else if (lv < had && a0) {
      a0.lv[src] = lv; if (!a0.lv[src]) delete a0.lv[src]; if (!Object.keys(a0.lv).length) delete a0.lv;
      changed = true;
    }
  }
  return changed;
}
// mirror row of an account (pure)
function mirrorScore(a) { return ((a && a.n && a.n.sc) | 0) + ((a && a.n && a.n.sa) | 0); }
function mirrorDetails(a) {
  const n = (a && a.n) || zeroN();
  const last = (a && a.last) || { t: 0, src: '' };
  return [TRUST_LEDGER_MAGIC | (TRUST_LEDGER_VER << 8), n.sc | 0, n.sa | 0, n.at | 0, n.fl | 0, n.rp | 0, n.hd | 0, n.tm | 0,
    (a && a.fp) | 0, last.t | 0, SRC_CODE[last.src] | 0];
}
// accounts whose mirror row is behind the file (mw), oldest change first, at most `max`
function mirrorDue(L, max) {
  const out = [];
  for (const p of Object.keys(L.acct)) if (L.acct[p] && L.acct[p].mw) out.push(p);
  out.sort((a, b) => ((L.acct[a].last && L.acct[a].last.t) | 0) - ((L.acct[b].last && L.acct[b].last.t) | 0) || (a < b ? -1 : 1));
  return out.slice(0, max == null ? MIRROR_MAX_PER_RUN : max);
}
// size fuse: past ACCT_CAP the accounts with no high-confidence history (no sc / sa / at) go first, oldest last event
//   first. The evidence that matters (convictions, sanctions, signature failures) is never evicted by flag churn.
function pruneLedger(L) {
  const keys = Object.keys(L.acct);
  if (keys.length <= ACCT_CAP) return 0;
  const low = keys.filter((p) => { const n = L.acct[p].n || {}; return !((n.sc | 0) || (n.sa | 0) || (n.at | 0)); });
  low.sort((a, b) => ((L.acct[a].last && L.acct[a].last.t) | 0) - ((L.acct[b].last && L.acct[b].last.t) | 0));
  const drop = Math.min(low.length, keys.length - ACCT_CAP);
  for (let i = 0; i < drop; i++) delete L.acct[low[i]];
  return drop;
}
// trust_tier row score: the 0-3 tier, plus TRUST_REJ_BIT while the account sits in an open reject window
function tierScore(tier, rej) { return (Math.max(0, Math.min(3, tier | 0))) | (rej ? TRUST_REJ_BIT : 0); }

// ---- producer side (seedcap.js / sanctions.js): a queue of events in the producer's OWN state file ----
// push: one event, id = the state's running counter (never reused; validate keeps the last id it took)
function queuePush(st, ev) {
  if (!Array.isArray(st.events)) st.events = [];
  st.evSeq = (Number(st.evSeq) || 0) + 1;
  st.events.push(Object.assign({ id: st.evSeq }, ev));
  return st.evSeq;
}
// prune: drop every event validate already took (taken = its cursor, read from trust.json read-only), then the fuse:
//   past QUEUE_CAP the oldest go (validate counts the gap as lost and warns). Returns { taken, fused }.
function queuePrune(st, takenId) {
  const res = { taken: 0, fused: 0 };
  if (!Array.isArray(st.events)) return res;
  const t = Number(takenId) || 0;
  const before = st.events.length;
  st.events = st.events.filter((e) => e && Number(e.id) > t);
  res.taken = before - st.events.length;
  if (st.events.length > QUEUE_CAP) { res.fused = st.events.length - QUEUE_CAP; st.events = st.events.slice(res.fused); }
  if (!st.events.length) delete st.events;
  return res;
}

module.exports = {
  TRUST_LEDGER_MAGIC, TRUST_LEDGER_VER, TRUST_REJ_BIT, SRC_CODE, TRUST_SOURCES, EV_CAP, ACCT_CAP, QUEUE_CAP, MIRROR_MAX_PER_RUN,
  loadLedger, recordEvent, markFalsePositive, takeQueue, noteLevels, levelOf, mirrorScore, mirrorDetails, mirrorDue, pruneLedger,
  tierScore, queuePush, queuePrune,
};
