'use strict';
// O618 (client: game repo mvp/KNIFE_O618_FRAME_GUARD_PLAN.md): game-error reports (err_sig) and their retro refund.
//   [1] the row layout (0xED): a client-shaped row decodes; a foreign / short row is null
//   [2] observe: a matchmade report's first sighting is this job's clock and is never moved; a single-player report (no MP flag /
//       no match hash) is not kept; malformed rows counted; the real sids come back for this run only (the state keeps pids)
//   [3] markEvidence: an entry gets the report seen before it / within ERR_OBS_MS after it; not one seen later; not a refunded one
//   [4] loadConfirmed: a good entry parses; bad ones are skipped with a warning; a missing file is an empty list; broken JSON too
//   [5] eligible: signature + build + the date window; a first sighting on or after the entry's "added" date is not evidence;
//       an excluded account is not refunded
//   [6] reconcileConfessions: a convicted leave (window long closed, done) with a listed report: the fine back (not the finish
//       he never played), the exit retracted, a streak pardon, er set, no LATE_CAP; unlisted / wrong build / no sid this run:
//       nothing; a confession entry: its fine back; an entry that also has his own late result: the normal path unchanged;
//       refunded once
//   [7] absenceRefunds: an exit-rate-only start verdict with his report: refunded once the list confirms; a report first seen
//       too long after the match start: not
//   [8] pruneConfessions keeps an unrefunded entry with evidence ERR_HOLD_MS; one without evidence goes at 48 h as before
//   [9] wiring pins: reconcileStarts calls onAbsence on its exit-rate hit; main reads the board, marks, passes errRefund,
//       saves the state; the three workflows persist the state file; code-hash classifies confirmed-errors.json; disp 11 named
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const E = require(path.join(__dirname, '..', 'err-refund.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const D0 = Date.UTC(2026, 10, 20, 12, 0, 0);   // 2026-11-20 12:00 UTC

// client-shaped row (game repo src/systems/err-sig.js merge): [0xED | 1 << 8 | n << 16, total, (atMin, sig, build, mh, seed, mt, sc | fl << 8) x n]
function row(reps, total) {
  const d = [(E.ERR_MAGIC | (1 << 8) | (reps.length << 16)) | 0, (total == null ? reps.length : total) | 0];
  for (const r of reps) d.push(r.atMin | 0, r.sig | 0, r.build | 0, r.mh | 0, r.seed | 0, r.mt | 0, ((r.sc & 0xff) | ((r.fl & 0xff) << 8)) | 0);
  return d;
}
const SID = '76561198000000001', SID2 = '76561198000000002';
const REP = { atMin: Math.floor(D0 / 60000), sig: 0xdeadbeef, build: 2026111701, mh: -123456, seed: 777, mt: 2, sc: 1, fl: E.FLAG_MP };
const KEY = '-123456_777_2';

console.log('=== [1] row layout ===');
{
  const d = E.decodeErrRow(row([REP, Object.assign({}, REP, { mh: 5, fl: 0 })], 9));
  T('[1] two reports decode (total 9, sig unsigned, mt / scene / flag)', d && d.total === 9 && d.last.length === 2 && d.last[0].sig === 0xdeadbeef && d.last[0].mt === 2 && d.last[0].sc === 1 && d.last[0].fl === 1 && d.last[0].mh === -123456, JSON.stringify(d));
  T('[1] key = the record key (d[3]_d[4]_d[2])', E.keyOfRep(d.last[0]) === KEY);
  T('[1] a foreign magic / a short row: null', E.decodeErrRow([0xDE | (1 << 8), 1]) === null && E.decodeErrRow([1]) === null && E.decodeErrRow(null) === null);
  T('[1] mt keeps the full int (team / premade bits above 8)', E.decodeErrRow(row([Object.assign({}, REP, { mt: 4 | (5 << 4) })])).last[0].mt === (4 | (5 << 4)));
}

console.log('=== [2] observe ===');
{
  const st = { r: {}, ab: {} };
  const ents = [{ steamID: SID, d: row([REP, Object.assign({}, REP, { mh: 0 }), Object.assign({}, REP, { mh: 9, fl: 0 })]) }, { steamID: SID2, d: [7, 7] }];
  let o = E.observe(st, ents, D0 + 5 * 60000, v.pid);
  const k = v.pid(SID) + '|' + KEY;
  T('[2] the matchmade report kept at this job\'s clock (only that one)', Object.keys(st.r).length === 1 && st.r[k] && st.r[k].eo === D0 + 5 * 60000 && st.r[k].sig === 'deadbeef' && st.r[k].b === 2026111701 && o.fresh === 1 && o.bad === 1, JSON.stringify({ st, o }));
  T('[2] the state keeps pids, the real sid only in this run\'s map', JSON.stringify(st).indexOf(SID) < 0 && o.sids.get(v.pid(SID)) === SID);
  o = E.observe(st, ents, D0 + 50 * 60000, v.pid);
  T('[2] seen again: the first sighting is not moved', st.r[k].eo === D0 + 5 * 60000 && o.fresh === 0);
}

console.log('=== [3] markEvidence ===');
{
  const st = { r: { ['p|m1']: { sig: 'deadbeef', b: 1, eo: D0 }, ['p|m2']: { sig: 'deadbeef', b: 1, eo: D0 + 3 * DAY }, ['p|m3']: { sig: 'deadbeef', b: 1, eo: D0 } }, ab: {} };
  const cs = { 'p|m1': { t0: D0 + HOUR, cv: 1 }, 'p|m2': { t0: D0, cv: 1 }, 'p|m3': { t0: D0, refunded: 1 }, 'p|m4': { t0: D0 } };
  const n = E.markEvidence(cs, st);
  T('[3] the report seen before the conviction marks it (es / eb / eo)', cs['p|m1'].es === 'deadbeef' && cs['p|m1'].eb === 1 && cs['p|m1'].eo === D0);
  T('[3] one first seen 3 days after the entry: not evidence', !cs['p|m2'].es);
  T('[3] a refunded entry / an entry without a report: untouched', !cs['p|m3'].es && !cs['p|m4'].es && n === 1, String(n));
}

console.log('=== [4] loadConfirmed ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'o618-'));
const wr = (obj) => { const f = path.join(tmp, 'c' + Math.random().toString(36).slice(2) + '.json'); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
const GOOD = { sig: 'DEADBEEF', builds: [2026111701], from: '2026-11-17', until: '2026-11-21', added: '2026-11-23', exclude: [SID2], note: 'O6xx hud' };
let LIST;
{
  const warns = [];
  LIST = E.loadConfirmed(wr({ entries: [GOOD, { sig: 'xyz', builds: [1], from: '2026-11-17', until: '2026-11-18', added: '2026-11-19' }, { sig: 'deadbeef', builds: [], from: '2026-11-17', until: '2026-11-18', added: '2026-11-19' }] }), v.pid, (m) => warns.push(m));
  T('[4] the good entry parses (sig lowercased, until inclusive, exclude by pid)', LIST.length === 1 && LIST[0].sig === 'deadbeef' && LIST[0].until === Date.UTC(2026, 10, 22) && LIST[0].added === Date.UTC(2026, 10, 23) && LIST[0].exclude.has(v.pid(SID2)), JSON.stringify(LIST));
  T('[4] two bad entries skipped with a warning each', warns.length === 2, JSON.stringify(warns));
  const w2 = [];
  T('[4] a missing file: empty list, no warning', E.loadConfirmed(path.join(tmp, 'none.json'), v.pid, (m) => w2.push(m)).length === 0 && w2.length === 0);
  T('[4] broken JSON / no entries array: empty list + a warning', E.loadConfirmed(wr('{oops'), v.pid, (m) => w2.push(m)).length === 0 && E.loadConfirmed(wr({ x: 1 }), v.pid, (m) => w2.push(m)).length === 0 && w2.length === 2);
  T('[4] the shipped confirmed-errors.json parses (an empty list today)', E.loadConfirmed(path.join(__dirname, '..', 'confirmed-errors.json'), v.pid, (m) => bad('shipped list warns: ' + m)).length === 0);
}

console.log('=== [5] eligible ===');
{
  const ev = { es: 'deadbeef', eb: 2026111701, eo: D0 };
  T('[5] sig + build + inside the window + before "added": eligible', !!E.eligible(ev, v.pid(SID), LIST));
  T('[5] another build: no', !E.eligible(Object.assign({}, ev, { eb: 2026111702 }), v.pid(SID), LIST));
  T('[5] another signature: no', !E.eligible(Object.assign({}, ev, { es: 'deadbeee' }), v.pid(SID), LIST));
  T('[5] first seen before the window / after its last day: no', !E.eligible(Object.assign({}, ev, { eo: Date.UTC(2026, 10, 16, 23) }), v.pid(SID), LIST) && !E.eligible(Object.assign({}, ev, { eo: Date.UTC(2026, 10, 22, 0, 1) }), v.pid(SID), LIST));
  T('[5] the last day of the window counts (until inclusive)', !!E.eligible(Object.assign({}, ev, { eo: Date.UTC(2026, 10, 21, 23) }), v.pid(SID), LIST));
  const late = E.loadConfirmed(wr({ entries: [Object.assign({}, GOOD, { added: '2026-11-20', until: '2026-11-25' })] }), v.pid);
  T('[5] first seen on the day the entry went public (or later): not evidence', !E.eligible(ev, v.pid(SID), late) && !!E.eligible(Object.assign({}, ev, { eo: Date.UTC(2026, 10, 19, 23) }), v.pid(SID), late));
  T('[5] an excluded account: no', !E.eligible(ev, v.pid(SID2), LIST));
  T('[5] no evidence / an empty list: no', !E.eligible({}, v.pid(SID), LIST) && !E.eligible(ev, v.pid(SID), []));
}

console.log('=== [6] reconcileConfessions ===');
(async () => {
  const P = v.pid(SID), M = KEY, ck = P + '|' + M;
  const run = async (st, x) => {
    const o = x || {};
    const confState = { [ck]: Object.assign({}, st) }, leavers = { [P]: { leaves: 1, lastMatch: M } }, writes = [];
    const res = await v.reconcileConfessions([], {}, new Set([M]), confState, leavers, o.now == null ? D0 + 5 * DAY : o.now, {
      penalty: 100, lpMax: 9999, maturityMs: 2 * HOUR, lateMs: 6 * HOUR, appliesLpFn: () => true, consistentKeys: new Set(), vecTag: () => '[]', lpBoard: 7,
      readLp: async () => ({ score: 2400, details: null }), writeLp: async (sid, score, det, ev) => { writes.push([sid, score, ev && ev.kind]); return true; },
      errRefund: o.noErr ? undefined : (p, m, s) => {
        const c = E.eligible({ es: s.es, eb: s.eb, eo: s.eo }, p, o.list || LIST);
        const sid = c ? (o.sids || new Map([[P, SID]])).get(p) : null;
        return sid ? { steamID: sid, note: c.note } : null;
      },
    });
    return { res, st: confState[ck], leaves: leavers[P].leaves, lf: leavers[P].lf, writes };
  };
  const conv = { t0: D0, mt: 2, ded: 100, ex: 1, cv: 1, s: 2, v: '[]', b: '7', w: 38, g: 0, done: 1, es: 'deadbeef', eb: 2026111701, eo: D0 - HOUR };
  let r = await run(conv);
  T('[6] a closed conviction with a listed report: the fine back (2500, not the +38 finish), exit retracted, pardon, er, no LATE_CAP mark',
    r.writes.length === 1 && r.writes[0][1] === 2500 && r.writes[0][2] === 'refund' && r.leaves === 0 && r.st.refunded === 1 && r.st.er === 1 && r.res.errRefunded === 1
    && r.res.skEv.length === 1 && r.res.skEv[0].kind === 'pardon' && !r.lf && r.res.late === 0, JSON.stringify(r));
  r = await run(conv, { list: [] });
  T('[6] not listed: nothing, the entry stays open (done, unrefunded)', r.writes.length === 0 && r.leaves === 1 && !r.st.refunded && r.st.done === 1 && r.res.finalized === 0, JSON.stringify(r));
  r = await run(Object.assign({}, conv, { eb: 2026111702 }));
  T('[6] a report from another build: nothing', r.writes.length === 0 && !r.st.refunded);
  r = await run(conv, { sids: new Map() });
  T('[6] his err_sig row not on the board this run (no sid): nothing yet', r.writes.length === 0 && !r.st.refunded);
  r = await run(Object.assign({}, conv, { es: undefined }));
  T('[6] a closed conviction without a report: nothing (as before)', r.writes.length === 0 && !r.st.refunded);
  r = await run(conv, { noErr: true });
  T('[6] no errRefund hook (tests / old callers): a done entry is skipped as before', r.writes.length === 0 && !r.st.refunded);
  r = await run(Object.assign({}, conv, { b: '6' }));
  T('[6] another points board (new season): no points back, the exit retracted', r.writes.length === 0 && r.leaves === 0 && r.st.refunded === 1);
  r = await run({ t0: D0, mt: 2, ded: 100, ex: 1, es: 'deadbeef', eb: 2026111701, eo: D0, done: 1 });
  T('[6] a confession entry with a listed report: its fine back, the exit retracted, no streak event', r.writes.length === 1 && r.writes[0][1] === 2500 && r.leaves === 0 && r.res.skEv.length === 0, JSON.stringify(r));
  r = await run(Object.assign({}, conv, { done: undefined }), { now: D0 + HOUR });
  T('[6] an open conviction entry with a listed report: refunded the same way', r.writes.length === 1 && r.writes[0][1] === 2500 && r.st.er === 1);
  r = await run(Object.assign({}, conv, { refunded: 1 }));
  T('[6] already refunded: nothing again', r.writes.length === 0);
  const closedOnce = await run(Object.assign({}, conv, { done: undefined, es: undefined }), { now: D0 + 7 * HOUR });
  T('[6] a conviction closing without a report: finalized once (as before)', closedOnce.st.done === 1 && closedOnce.res.finalized === 1);

  console.log('=== [7] absenceRefunds ===');
  {
    const st = { r: { [ck]: { sig: 'deadbeef', b: 2026111701, eo: D0 } }, ab: {} };
    E.noteAbsence(st, P, M, D0 - HOUR, D0 + 2 * HOUR);
    E.noteAbsence(st, P, 'x_1_2', D0, D0 + 2 * HOUR);
    T('[7] every hit noted (no report needed at note time)', Object.keys(st.ab).length === 2 && st.ab[ck].t0 === D0 - HOUR);
    T('[7] not listed: nothing', E.absenceRefunds(st, [], D0 + DAY).length === 0);
    const out = E.absenceRefunds(st, LIST, D0 + DAY);
    T('[7] listed: the hit with his report comes back once (the other has no report)', out.length === 1 && out[0].p === P && out[0].m === M && st.ab[ck].done && E.absenceRefunds(st, LIST, D0 + 2 * DAY).length === 0, JSON.stringify(out));
    const st2 = { r: { [ck]: { sig: 'deadbeef', b: 2026111701, eo: D0 + 3 * DAY } }, ab: {} };
    E.noteAbsence(st2, P, M, D0, D0 + 2 * HOUR);
    T('[7] his report first seen 3 days after the match start: not refunded', E.absenceRefunds(st2, E.loadConfirmed(wr({ entries: [Object.assign({}, GOOD, { until: '2026-11-30', added: '2026-12-01' })] }), v.pid), D0 + 4 * DAY).length === 0);
    E.pruneErrState(st, D0 + 40 * DAY);
    T('[7] state pruned after ERR_KEEP_MS', Object.keys(st.r).length === 0 && Object.keys(st.ab).length === 0);
  }

  console.log('=== [8] pruneConfessions hold ===');
  {
    const s = { a: { t0: D0, es: 'deadbeef' }, b: { t0: D0 }, c: { t0: D0, es: 'deadbeef', refunded: 1 }, d: { t0: D0 - 30 * DAY, es: 'deadbeef' } };
    v.pruneConfessions(s, D0 + 3 * DAY, new Set());
    T('[8] past 48 h: evidence kept, none / refunded / past 21 days dropped', !!s.a && !s.b && !s.c && !s.d, JSON.stringify(Object.keys(s)));
  }

  console.log('=== [9] wiring pins ===');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
    T('[9] reconcileStarts takes onAbsence and calls it on the exit-rate hit', /seenKeys, notedSet, heldKeys, onAbsence\) \{/.test(src) && /noteLeave\(leavers, h, m\);[^\n]*\n\s*if \(onAbsence\) \{ try \{ onAbsence\(h, m, p\.t0 \|\| now\); \} catch \(e\) \{\} \}/.test(src));
    T('[9] main: reads the err box, marks evidence, passes noteAbsence + errRefund, absence refunds, saves the state', /errRefund\.observe\(errSt, eb\.ents/.test(src) && /errRefund\.markEvidence\(confState, errSt\)/.test(src) && /errRefund\.noteAbsence\(errSt, h, m, t0, nowMs\)/.test(src) && /seenKeys, noted, heldKeys, errAbsence\);/.test(src) && /errRefund: \(p, m, st\) =>/.test(src) && /errRefund\.absenceRefunds\(errSt, errList, nowMs\)/.test(src) && /errRefund\.saveErrState\(errSt, nowMs, ERR_STATE_FILE, writeStateFile\)/.test(src) && /const ERR_STATE_FILE = process\.env\.ERR_STATE_FILE \|\| 'err-reports\.json';/.test(src));
    T('[9] the err box read sits before reconcileStarts (an absence of this run sees this run\'s reports)', src.indexOf('errRefund.observe(errSt') < src.indexOf('const startsRes = reconcileStarts('));
    const wf = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
    T('[9] the three workflows persist their state file (+ the demo / playtest names)', / err-reports\.json; do/.test(wf('validate.yml')) && /ERR_STATE_FILE: demo-err-reports\.json/.test(wf('demo.yml')) && / demo-err-reports\.json; do/.test(wf('demo.yml')) && /ERR_STATE_FILE: pt-err-reports\.json/.test(wf('playtest.yml')) && / pt-err-reports\.json; do/.test(wf('playtest.yml')));
    T('[9] code-hash classifies confirmed-errors.json as config', /CONFIG_JSON = \[[^\]]*'confirmed-errors\.json'/.test(fs.readFileSync(path.join(__dirname, '..', 'tools', 'code-hash.js'), 'utf8')));
    T('[9] disp 11 = game-error (innocent: no confession, never a void verdict on its own)', v.dispName(11) === 'game-error' && v.dispClassOf(11) === 'innocent');
  }

  console.log(failN ? ('\nerr-refund: ' + failN + ' FAIL') : '\nerr-refund: all ok');
  process.exit(failN ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
