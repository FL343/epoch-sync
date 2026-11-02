'use strict';
// ============================================================
// err-refund.js -- O618 game-error retro refunds (game repo mvp/KNIFE_O618_FRAME_GUARD_PLAN.md section 4)
// ============================================================
// The client (game repo src/util/frame-guard.js + src/systems/err-sig.js): when one scene throws on every frame for 3 s, the
//   game shows "something went wrong", leaves to the menu, and writes one row to the client-writable board err_sig (magic 0xED):
//   the error's signature (fnv1a32 of scene | site | message), its build number and the match key (hash32(matchId), runSeed, mt;
//   the same three numbers as a settle record's d[3] / d[4] / d[2]). In a matchmade match that leave is handled like a closed
//   window (user 2026-11-02): no confession, the other records convict him or not exactly as before. Nothing about the report
//   changes a verdict at the time (user 2026-11-01: "a report only says it errored, it exempts nothing; refund after we confirm").
// This module:
//   observe()      every run, read err_sig whole; each report's FIRST sighting time (eo) is this job's own clock, kept by pid and
//                  match key in err-reports.json (30 days). A report's own minute is the client's word and is never trusted.
//   markEvidence() a confession / conviction entry (confState "pid|key") with a report of his for that key seen within
//                  ERR_OBS_MS of the entry gets es (+ eb / ex) -- validate.js keeps such entries ERR_HOLD_MS instead of 48 h.
//                  An exit-rate-only absence hit at the start verdict (reconcileStarts) with a report is noted in the same file.
//   eligible()     a report qualifies once confirmed-errors.json (hand-written, public) lists its signature for its build, its
//                  first sighting is inside the entry's date window AND before the entry was added (a report written after the
//                  list went public, back-dated, is not evidence) and the account is not excluded. No per-account cap (user
//                  2026-11-02: the version + date window bounds it; we would rather miss some abuse than fail a player hit by
//                  one bug several times -- architecture decision 10).
//   The refund itself is reconcileConfessions' own (the "came back and finished" branch): the fine (and for a conviction the
//   settle share w - g on the same points board), the exit, the streak event turns into a pardon, the receipt's LEAVE flag.
// Record-only until an entry is confirmed: with an empty list this module changes nothing a run settles.
// ============================================================
const fs = require('fs');
const path = require('path');

const ERR_MAGIC = 0xED, ERR_HEAD = 2, ERR_PER = 7, ERR_LAST_N = 8;
const FLAG_MP = 1, FLAG_HOST = 2;
const ERR_LB = process.env.ERR_LB || 'err_sig';
const ERR_STATE_FILE = process.env.ERR_STATE_FILE || 'err-reports.json';
const ERR_CONFIRMED_FILE = process.env.ERR_CONFIRMED_FILE || path.join(__dirname, 'confirmed-errors.json');
const ERR_OBS_MS = Number(process.env.ERR_OBS_MS || 48 * 3600 * 1000);       // a report counts for an entry only if first seen within this of the entry (or before it)
const ERR_KEEP_MS = Number(process.env.ERR_KEEP_MS || 30 * 86400 * 1000);    // observed reports / absence notes kept this long
const ERR_HOLD_MS = Number(process.env.ERR_HOLD_MS || 21 * 86400 * 1000);    // a confState entry with evidence is kept this long (not 48 h)
const DAY_MS = 86400 * 1000;

// row details (ints) -> { ver, total, last: [{ atMin, sig, build, mh, seed, mt, sc, fl }] } | null -- same layout as the client's ERR_SIG.decode
function decodeErrRow(d) {
  if (!Array.isArray(d) || d.length < ERR_HEAD) return null;
  const h = d[0] | 0;
  if ((h & 0xff) !== ERR_MAGIC || ((h >> 8) & 0xff) < 1) return null;
  const n = Math.min(ERR_LAST_N, (h >> 16) & 0xff);
  const last = [];
  for (let i = 0; i < n; i++) {
    const o = ERR_HEAD + i * ERR_PER;
    if (o + ERR_PER > d.length) break;
    const p = d[o + 6] | 0;
    last.push({ atMin: d[o] | 0, sig: d[o + 1] >>> 0, build: d[o + 2] | 0, mh: d[o + 3] | 0, seed: d[o + 4] | 0, mt: d[o + 5] | 0, sc: p & 0xff, fl: (p >> 8) & 0xff });
  }
  return { ver: (h >> 8) & 0xff, total: d[1] | 0, last };
}
const keyOfRep = (r) => (r.mh | 0) + '_' + (r.seed | 0) + '_' + (r.mt | 0);   // = validate.js match key d[3]_d[4]_d[2]
const hex8 = (u) => (u >>> 0).toString(16).padStart(8, '0');

function loadErrState(file) {
  try { const s = JSON.parse(fs.readFileSync(file || ERR_STATE_FILE, 'utf8')); return { r: s.r || {}, ab: s.ab || {} }; } catch (e) { return { r: {}, ab: {} }; }
}
function saveErrState(st, now, file, write) {
  pruneErrState(st, now);
  const text = JSON.stringify({ r: st.r, ab: st.ab }, null, 0);
  (write || ((f, t) => fs.writeFileSync(f, t)))(file || ERR_STATE_FILE, text);
}
function pruneErrState(st, now) {
  let n = 0;
  for (const k of Object.keys(st.r)) if (now - (st.r[k].eo || 0) > ERR_KEEP_MS) { delete st.r[k]; n++; }
  for (const k of Object.keys(st.ab)) if (now - (st.ab[k].t || 0) > ERR_KEEP_MS) { delete st.ab[k]; n++; }
  return n;
}

// ents: [{ steamID, d: details ints }]; pidFn: steamID -> pid. Records each matchmade report's first sighting.
//   Returns { seen, fresh, sids: Map(pid -> steamID) } (sids: the real ids this run, never written to a file -- the refund needs one)
function observe(st, ents, now, pidFn) {
  const res = { seen: 0, fresh: 0, bad: 0, sids: new Map() };
  for (const e of ents || []) {
    const row = decodeErrRow(e.d);
    if (!row) { res.bad++; continue; }
    const p = pidFn(String(e.steamID));
    res.sids.set(p, String(e.steamID));
    for (const r of row.last) {
      res.seen++;
      if (!(r.fl & FLAG_MP) || !(r.mh | 0)) continue;   // not a matchmade report (single player has no fine; no key)
      const k = p + '|' + keyOfRep(r);
      if (st.r[k]) continue;
      st.r[k] = { sig: hex8(r.sig), b: r.build | 0, eo: now };
      res.fresh++;
    }
  }
  return res;
}

// confState entries ("pid|key") with a report of his for that key seen in time -> es / eb / eo copied onto the entry
function markEvidence(confState, st) {
  let n = 0;
  for (const k of Object.keys(confState)) {
    const c = confState[k];
    if (!c || c.es || c.refunded) continue;
    const r = st.r[k];
    if (!r) continue;
    if (r.eo > (c.t0 || 0) + ERR_OBS_MS) continue;   // reported long after the entry: not this leave's evidence
    c.es = r.sig; c.eb = r.b; c.eo = r.eo;
    n++;
  }
  return n;
}
// reconcileStarts' exit-rate-only hit (no confState entry, e.g. a 2P quick match the other side finished alone): every hit is
//   remembered ERR_KEEP_MS (pid + key + the match's start t0 only); his report is looked up when the list confirms (absenceRefunds),
//   so a report the client sent late still counts when it was first seen within ERR_OBS_MS of the match's start.
function noteAbsence(st, p, m, t0, now) {
  const k = p + '|' + m;
  if (st.ab[k]) return false;
  st.ab[k] = { t: now, t0: t0 || now };
  return true;
}
// pruneConfessions: keep an entry with evidence ERR_HOLD_MS (unrefunded)
const holdEntry = (c, now) => !!(c && c.es && !c.refunded && now - (c.t0 || 0) <= ERR_HOLD_MS);

// confirmed-errors.json -> [{ sig, builds:Set, from, until (ms, end exclusive), added (ms), exclude:Set(pid) }]
//   A malformed file or entry is not applied (warn + skip), never fails the run.
function loadConfirmed(file, pidFn, warn) {
  const w = warn || (() => {});
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file || ERR_CONFIRMED_FILE, 'utf8')); } catch (e) { if (e && e.code !== 'ENOENT') w('confirmed-errors.json unreadable: ' + (e && e.message)); return []; }
  const out = [];
  const list = (raw && Array.isArray(raw.entries)) ? raw.entries : null;
  if (!list) { w('confirmed-errors.json: no entries array -- ignored'); return []; }
  for (const x of list) {
    const sig = String((x && x.sig) || '').toLowerCase();
    const from = Date.parse(String((x && x.from) || '') + 'T00:00:00Z');
    const until = Date.parse(String((x && x.until) || '') + 'T00:00:00Z');
    const added = Date.parse(String((x && x.added) || '') + 'T00:00:00Z');
    const builds = Array.isArray(x && x.builds) ? x.builds.map(Number).filter(n => n > 0) : [];
    if (!/^[0-9a-f]{8}$/.test(sig) || !builds.length || !(from > 0) || !(until >= from) || !(added > 0)) { w('confirmed-errors.json: bad entry skipped (' + JSON.stringify(x).slice(0, 120) + ')'); continue; }
    const exclude = new Set((Array.isArray(x.exclude) ? x.exclude : []).map(s => pidFn(String(s))));
    out.push({ sig, builds: new Set(builds), from, until: until + DAY_MS, added, exclude, note: String(x.note || '') });   // added: from 00:00 UTC of that date a first sighting is no longer evidence
  }
  return out;
}
// the evidence { es, eb, eo } of player p qualifies under the list -> the matching entry or null
function eligible(ev, p, list) {
  if (!ev || !ev.es || !(ev.eo > 0)) return null;
  for (const c of list || []) {
    if (c.sig !== ev.es || !c.builds.has(ev.eb | 0)) continue;
    if (ev.eo < c.from || ev.eo >= c.until) continue;   // first sighting inside the bug's date window
    if (ev.eo >= c.added) continue;                      // seen only after the entry went public: not evidence
    if (c.exclude.has(p)) continue;
    return c;
  }
  return null;
}
// absence notes the list confirms (not yet refunded) -> [{ k, p, m }]; marks them done (caller retracts the exit + pardons the streak)
function absenceRefunds(st, list, now) {
  const out = [];
  for (const k of Object.keys(st.ab)) {
    const a = st.ab[k];
    if (a.done) continue;
    const r = st.r[k];
    if (!r || r.eo > (a.t0 || 0) + ERR_OBS_MS) continue;   // no report of his for that match, or first seen too long after it
    const i = k.indexOf('|');
    const p = k.slice(0, i), m = k.slice(i + 1);
    if (!eligible({ es: r.sig, eb: r.b, eo: r.eo }, p, list)) continue;
    a.done = now;
    out.push({ k, p, m, sig: r.sig, b: r.b });
  }
  return out;
}

module.exports = {
  ERR_MAGIC, ERR_HEAD, ERR_PER, ERR_LAST_N, FLAG_MP, FLAG_HOST, ERR_LB, ERR_STATE_FILE, ERR_CONFIRMED_FILE, ERR_OBS_MS, ERR_KEEP_MS, ERR_HOLD_MS,
  decodeErrRow, keyOfRep, loadErrState, saveErrState, pruneErrState, observe, markEvidence, noteAbsence, holdEntry, loadConfirmed, eligible, absenceRefunds,
};
