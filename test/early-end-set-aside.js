'use strict';
// cloud audit Q414 (round-3 R3-B2-02 / R3-B3-01, 2026-11-19): an opening host the others left behind by a host migration settled
//   alone ('peers-gone', fewer levels, himself on top) while the others moved to a new host and finished the match. The two kinds
//   of record differ, so every writer was flagged as a suspected forger and the key voided at the start verdict (each writer the
//   50): six keys in the launch week's first two days (four 3- / 4-seat quick, one 5-seat quick, one friends' room). Now the
//   early record is set aside when it says by itself that the match ended early for its writer and every other writer finished
//   the same match (earlyEndVerdict): the finishers settle as if it had not been written, nobody is flagged, and its writer is an
//   absent seat excused like an anti-cheat removal (the O886 cap, by 'early'; past it convicted as a leave) and owed the
//   consolation the void paid him. Not a majority settle (workbench ASK_USER A42): a group whose finishers disagree stays as it was.
//   [1] units: earlyEndVerdict on the live shape and on every shape it must leave alone
//   [2] groupRecords: the shape becomes a consistent entry of the finishers' records (early named), nobody in the flag lane;
//       one finisher only stays in the flag lane (the two-voice lane takes it there)
//   [3] quick 3P end to end (the real validate.js main() on the offline board stub): the early record lands first, the
//       finishers ten minutes later -- settled at once on their scores, nobody flagged, the early writer not convicted, one
//       excuse listed, the 50 owed and paid by the next run, the summary row; the control (main before Q414: the mutant that
//       switches the verdict off) flags the three and voids the key
//   [4] ranked 3P: no points fine for the early writer, the finishers' points written
//   [5] the cap (shared with O886): two excuses listed in the window -> convicted as a leave (exit rate + the fine), nothing owed
//   [6] a friends' room: the finishers credited, nobody flagged, nothing of the early writer's moves (no leaver economy there)
//   [7] seedcap: the shape is audited on the finishers' vector (only their seats claimants); an audit taken on the early record
//       alone is taken again once (a re-audit, marked ee), never a third time
//   [8] mutants: each guard of the verdict, the grouping branch, the excuse, the absent-seat hold, the consolation, the seedcap
//       mirror and its re-audit -- every one goes red on the case it guards
const fs = require('fs'), path = require('path');
for (const k of ['EAC_EXCUSE_CAP', 'EAC_EXCUSE_WINDOW_MS', 'EAC_EXCUSE_FINE', 'PT_MODE', 'APPLY_MMR', 'ABSENT_GRACE_MS', 'STARTS_MATURITY_MS', 'GITHUB_STEP_SUMMARY']) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs, so v.pid() addresses their state rows
const H = require('./lib/settle-stub.js');
const v = require(path.join(H.ROOT, 'validate.js'));
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000;
const A = H.SID(4140), B = H.SID(4141), C = H.SID(4142), X = H.SID(4149);
const P = [A, B, C];
const FIN = [0, 16037, 14000];   // the finishers' table: the old host's seat at 0 (as on the live keys)
const ESC = [2785, 900, 700];    // the old host's own table after two levels
const rankOf = (sc0, seat) => 1 + sc0.filter((x, i) => i !== seat && x > sc0[seat]).length;
// a parsed record (the reconcile's shape): { steamID, d, dispCode, disp, roster }
function parsed(sid, d) { const pc = d[8] | 0; return { steamID: sid, shard: 0, d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; }
function earlyD(mt, hash, opt) {
  const o = opt || {};
  const d = H.rec(0xB1, mt, hash, o.seat == null ? 0 : o.seat, 1, true, o.ros || P, o.sc || ESC, o.disp == null ? 1 : o.disp);
  d[7] = ((o.lv == null ? 2 : o.lv) << 1) | 1; d[9] = 161;
  return d;
}
const finD = (mt, hash, seat, opt) => { const o = opt || {}; const s = o.sc || FIN; const d = H.rec(0xB1, mt, hash, seat, rankOf(s, seat), false, o.ros || P, s, o.disp || 0); if (o.lv != null) d[7] = o.lv << 1; return d; };
const shape = (mt, hash, o) => [parsed(A, earlyD(mt, hash, o && o.e)), parsed(B, finD(mt, hash, 1, o && o.b)), parsed(C, finD(mt, hash, 2, o && o.c))];
const vecOf = (r) => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));

// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const mutants = [];
function mutant(file, from, to, tag) {
  const src = fs.readFileSync(path.join(H.ROOT, file), 'utf8');
  if (src.split(from).length !== 2) { T(tag + ' mutant anchor found exactly once', false, from.slice(0, 80)); return null; }
  const out = path.join(H.ROOT, '.mutant-early-end-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '-' + path.basename(file));
  fs.writeFileSync(out, src.replace(from, to));
  mutants.push(out);
  return out;
}

const EXTRA = (pts) => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: pts || [] },
  { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
// the live order: starts, the early record four minutes in, the finishers' ten minutes later, then one more run (the owed 50)
function play(mt, hash, o) {
  o = o || {};
  const st = P.map((sid, seat) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, P, null) }));
  const e = { sid: A, d: earlyD(mt, hash) };
  const f = [1, 2].map((seat) => ({ sid: P[seat], d: finD(mt, hash, seat) }));
  const pts = o.pts ? P.map((sid) => ({ steamID: sid, score: 500 })) : [];
  const steps = [[0, st], [4 * MIN, st.concat([e])], [10 * MIN, st.concat([e], f)], [10 * MIN, st.concat([e], f)]].concat(o.more || []);
  const runs = [];
  let state = o.files || null, prev = null;
  for (let i = 0; i < steps.length; i++) {
    const ms = steps[i][0], recs = steps[i][1] || prev;
    prev = recs;
    const r = H.runCron(H.shardBoards(recs, EXTRA(pts)), state ? (i === 0 ? state : H.advance(state, ms)) : null, o.env || null, o.script || null, 'early-end');
    runs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { runs, key: H.keyOf(e.d), ok: runs.every((r) => r.code === 0) && runs.length === steps.length };
}
const last = (m) => m.runs[m.runs.length - 1];
const flaggedOf = (r, key) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[key]);
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const procOf = (r, key) => { const p = r.state.PROCESSED_FILE; return Array.isArray(p) ? p.indexOf(key) >= 0 : !!(p && (p[key] || (Array.isArray(p.keys) && p.keys.indexOf(key) >= 0))); };
const lvOf = (r, sid) => ((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || null;
const leavesOf = (r, sid) => { const e = lvOf(r, sid); return e ? (e.leaves | 0) : 0; };
const edOf = (r, sid) => { const e = lvOf(r, sid); return e && Array.isArray(e.ed) ? e.ed.length : 0; };
const cqOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).cq || null;
const xpPosts = (r, sid) => H.postsOf(r, 5, sid).map((x) => x.score);
const ratingPosts = (r, sid) => H.postsOf(r, 6, sid).length;
const pointPosts = (r, sid) => H.postsOf(r, 7, sid).map((x) => x.score);

console.log('=== an early host record the others outlived is set aside, not flagged (Q414) ===');
try {
  // ---- [1] units ----
  {
    const g = shape(1, 0x4141);
    const x = v.earlyEndVerdict(g, vecOf);
    T('[1] the live shape: early = the old host at seat 0 after 2 of 6 levels, g = the two finishers (same objects)',
      !!x && x.kind === 'early' && x.early.sid === A && x.early.seat === 0 && x.early.levels === 2 && x.early.fLevels === 6 && x.early.n === 1
      && x.g.length === 2 && x.g[0] === g[1] && x.g[1] === g[2] && J(x.fin) === J([B, C]), J(x && x.early));
    T('[1] the finishers\' vector: default vecOf reads the same', !!v.earlyEndVerdict(g));
    T('[1] a seedcap record shape (w, no steamID / dispCode)', !!v.earlyEndVerdict(g.map((r) => ({ d: r.d, roster: r.roster, w: r.steamID }))));
    T('[1] a friends\' room (10) and ranked (2): the same', !!v.earlyEndVerdict(shape(10, 0x4142)) && !!v.earlyEndVerdict(shape(2, 0x4143)));
    const no = (label, grp) => T('[1] not this shape: ' + label, v.earlyEndVerdict(grp, vecOf) === null);
    no('a team code (3)', shape(3, 0x4144));
    no('an endless code (7)', shape(7, 0x4145));
    no('a bot match (11)', shape(11, 0x4146));
    no('one finisher (two writers)', shape(1, 0x4147).slice(0, 2));
    no('two finisher records of one account', [shape(1, 0x4148)[0], shape(1, 0x4148)[1], parsed(B, finD(1, 0x4148, 1))]);
    no('the finishers disagree on the scores', shape(1, 0x4149, { c: { sc: [0, 16037, 14550] } }));
    no('the finishers disagree on the levels', shape(1, 0x414A, { c: { lv: 5 } }));
    no('the early record as many levels as theirs', shape(1, 0x414B, { e: { lv: 6 } }));
    no('the early record a quit (5), not peers-gone', shape(1, 0x414C, { e: { disp: 5 } }));
    no('the early record finished (0): the 5-seat key\'s shape', shape(1, 0x414D, { e: { disp: 0 } }));
    no('a finisher reconnect-failed (6)', shape(1, 0x414E, { c: { disp: 6 } }));
    no('a finisher without the summary (10): the Q68 lane', shape(1, 0x414F, { c: { disp: 10 } }));
    const P4 = [A, B, C, X], S4 = [0, 0, 16037, 14000];
    no('two early accounts (4 seats, two finishers)', [parsed(A, earlyD(1, 0x4150, { ros: P4, sc: [2785, 900, 700, 600] })), parsed(B, earlyD(1, 0x4150, { seat: 1, ros: P4, sc: [900, 2785, 700, 600] })),
      parsed(C, finD(1, 0x4150, 2, { ros: P4, sc: S4 })), parsed(X, finD(1, 0x4150, 3, { ros: P4, sc: S4 }))]);
    no('his records from two seats', [parsed(A, earlyD(1, 0x4158)), parsed(A, earlyD(1, 0x4158, { seat: 1 })), parsed(B, finD(1, 0x4158, 1)), parsed(C, finD(1, 0x4158, 2))]);
    no('the early writer also finished', shape(1, 0x4151).concat([parsed(A, finD(1, 0x4151, 0))]));
    no('the early record from another seat than the table gives him', shape(1, 0x4152, { e: { seat: 1 } }));
    no('two tables (a finisher names another account at seat 2)', shape(1, 0x4153, { b: { ros: [A, B, X] } }));
    no('the finishers seat nobody at his seat', shape(1, 0x4154, { b: { ros: ['0', B, C] }, c: { ros: ['0', B, C] } }));
    no('two seats', [parsed(A, earlyD(1, 0x4155, { ros: [A, B], sc: [900, 100] })), parsed(B, finD(1, 0x4155, 1, { ros: [A, B], sc: [0, 9000] }))]);
    const gt = shape(1, 0x4156); gt[1] = Object.assign({}, gt[1], { d: gt[1].d.concat([v.T2BY_TAG | 1]) });
    T('[1] a team-gamble name tail on a record: not this shape', !!v.earlyEndVerdict(shape(1, 0x4156), vecOf) && v.earlyEndVerdict(gt, vecOf) === null);
    T('[1] a BAD vector: not this shape', v.earlyEndVerdict(shape(1, 0x4157), (r) => (r.steamID === B ? 'BAD(pc=3)' : vecOf(r))) === null);
    T('[1] earlySeatOf: his account at his seat only', v.earlySeatOf({ sid: A, seat: 0 }, { steamID: A, seat: 0 }) && !v.earlySeatOf({ sid: A, seat: 0 }, { steamID: A, seat: 1 })
      && !v.earlySeatOf({ sid: A, seat: 0 }, { steamID: B, seat: 0 }) && !v.earlySeatOf(null, { steamID: A, seat: 0 }));
  }

  // ---- [2] groupRecords ----
  {
    const g = shape(1, 0x4160);
    const gr = v.groupRecords(g.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
    const ent = gr.consistentMatches.find((c) => c.m === H.keyOf(g[0].d));
    T('[2] a consistent entry of the two finishers\' records, early named, not void; nothing in the flag lane; counted',
      !!ent && ent.g.length === 2 && ent.g.every((r) => r.steamID !== A) && ent.early && ent.early.sid === A && !ent.void && gr.inconsistentGroups.length === 0
      && gr.flagged === 0 && gr.early.settle === 1, J(ent && { n: ent.g.length, early: ent.early }));
    T('[2] the group list holds the same array (in place: later passes read the finishers only)', gr.groups[H.keyOf(g[0].d)] === (ent && ent.g));
    const g2 = shape(1, 0x4161).slice(0, 2);
    const gr2 = v.groupRecords(g2, { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] one finisher yet: stays in the flag lane (the two-voice lane there flags nobody), no early entry', gr2.inconsistentGroups.length === 1 && gr2.early.settle === 0 && !gr2.consistentMatches.length);
  }

  // ---- [3] quick 3P end to end ----
  const q = play(1, 0x4170, { more: [[2 * HOUR, null], [6 * HOUR, null]] });
  {
    const r3 = q.runs[2], r4 = q.runs[3];
    T('[3] all runs exit 0', q.ok, q.runs.map((r) => r.code).join(','));
    T('[3] the early record alone (run 2): nobody flagged, not settled', !flaggedOf(q.runs[1], q.key) && !procOf(q.runs[1], q.key));
    T('[3] the finishers land (run 3): settled at once on their scores -- both rated, nobody flagged', procOf(r3, q.key) && ratingPosts(r3, B) === 1 && ratingPosts(r3, C) === 1
      && ratingPosts(r3, A) === 0 && !flaggedOf(r3, q.key) && [A, B, C].every((s) => fOf(r3, s) === 0), r3.out.split('\n').filter((l) => /4170|Q414|leaver/.test(l)).join(' | ').slice(-900));
    T('[3] the early writer: no leave, one excuse listed, the 50 owed', leavesOf(r3, A) === 0 && edOf(r3, A) === 1 && !!cqOf(r3, A) && J(cqOf(r3, A).u) === J([{ c: 1 }]),
      J({ lv: lvOf(r3, A), cq: cqOf(r3, A) }));
    T('[3] the finishers\' XP written as for a full match; the early writer no XP at the settle', xpPosts(r3, B).length === 1 && xpPosts(r3, C).length === 1 && xpPosts(r3, A).length === 0);
    T('[3] the next run pays him the 50 once and clears it', J(xpPosts(r4, A)) === J([v.CONSOLATION_XP]) && !cqOf(r4, A), J(xpPosts(r4, A)));
    T('[3] later runs (the start verdict at 2 h, 6 h): nothing more -- no leave, one excuse, the 50 paid once, nobody flagged, the finishers rated once',
      leavesOf(last(q), A) === 0 && edOf(last(q), A) === 1 && q.runs.reduce((n, r) => n + xpPosts(r, A).length, 0) === 1 && q.runs.every((r) => !flaggedOf(r, q.key))
      && q.runs.reduce((n, r) => n + ratingPosts(r, B), 0) === 1 && [A, B, C].every((sid) => fOf(last(q), sid) === 0));
    T('[3] the log names the set-aside and the excuse', /settled alone as the one player left after 2 level\(s\), 2 others finished all 6 on one vector -- his record set aside, the rest consistent, nobody flagged \(Q414\)/.test(r3.out)
      && /settled alone after 2 of the 6 level\(s\) the others finished \(his record set aside\) -- excused, no conviction \(Q414; 1 of 2 in the window\), the 50 consolation owed to the next run/.test(r3.out));
    T('[3] the summary row: set aside 1 / excused 1 / capped 0 / owed 1', /\| keys whose one early 'peers-gone' writer the others outlived \(Q414\)[^|]*\| 1 \/ 1 \/ 0 \/ 1 \|/.test(r3.summary), (r3.summary.split('\n').find((l) => /Q414/.test(l)) || '').slice(-120));
    T('[3] O886 counters untouched', /\(O886\) \| 0 \/ 0 \/ 0 \|/.test(r3.summary));
  }
  const off = mutant('validate.js', 'const ee = (!lo && !ns) ? earlyEndVerdict(g, vecOf) : null;', 'const ee = null;', '[8a]');
  let ctlRun = null;
  if (off) {
    const m = play(1, 0x4171, { script: off, more: [[2 * HOUR, null]] });
    ctlRun = m;
  }

  // ---- [4] ranked ----
  {
    const m = play(2, 0x4180, { pts: true });
    const r3 = m.runs[2];
    T('[4] ranked: settled, nobody flagged, no fine for the early writer, the finishers\' points written', m.ok && procOf(r3, m.key) && !flaggedOf(r3, m.key) && pointPosts(r3, A).length === 0
      && pointPosts(r3, B).length === 1 && pointPosts(r3, C).length === 1 && leavesOf(r3, A) === 0, J({ a: pointPosts(r3, A), b: pointPosts(r3, B), c: pointPosts(r3, C) }));
  }

  // ---- [5] the cap ----
  {
    const nowS = Math.floor(Date.now() / 1000);
    const files = { LEAVERS_FILE: { [v.pid(A)]: { leaves: 0, lastMatch: '', ed: [nowS - 2 * 86400, nowS - 86400] } } };
    const m = play(2, 0x4190, { pts: true, files });
    const r3 = m.runs[2];
    T('[5] past the cap (2 listed in 7 days): convicted as a leave -- exit rate, the fine; nothing owed; the finishers settled, nobody flagged',
      m.ok && procOf(r3, m.key) && leavesOf(r3, A) === 1 && edOf(r3, A) === 2 && pointPosts(r3, A).length === 1 && pointPosts(r3, A)[0] < 500 && !cqOf(r3, A) && !flaggedOf(r3, m.key)
      && /but past 2 excuses in the window -- convicted as a leave \(Q414\)/.test(r3.out) && /\(Q414\)[^|]*\| 1 \/ 0 \/ 1 \/ 0 \|/.test(r3.summary), J({ lv: lvOf(r3, A), pts: pointPosts(r3, A) }));
    const old = { LEAVERS_FILE: { [v.pid(A)]: { leaves: 0, lastMatch: '', ed: [nowS - 9 * 86400, nowS - 8 * 86400] } } };
    const m2 = play(1, 0x4191, { files: old });
    T('[5] excuses older than the window do not count: excused (the list pruned to this one)', m2.ok && leavesOf(m2.runs[2], A) === 0 && edOf(m2.runs[2], A) === 1, J(lvOf(m2.runs[2], A)));
  }

  // ---- [6] a friends' room ----
  {
    const m = play(10, 0x41A0, { more: [[30 * MIN, null], [30 * MIN, null]] });
    const settledAt = m.runs.findIndex((r) => procOf(r, m.key));
    const rs = settledAt >= 0 ? m.runs[settledAt] : last(m);
    T('[6] friends\' room: settled, the finishers credited XP, nobody flagged; nothing of the early writer\'s (no conviction, no excuse spent, nothing owed)',
      m.ok && settledAt >= 0 && xpPosts(rs, B).length === 1 && xpPosts(rs, C).length === 1 && m.runs.every((r) => !flaggedOf(r, m.key)) && leavesOf(last(m), A) === 0 && edOf(last(m), A) === 0
      && !cqOf(last(m), A) && m.runs.every((r) => xpPosts(r, A).length === 0), 'settledAt=' + settledAt + ' ' + rs.out.split('\n').filter((l) => /41a0|Q414|private/i.test(l)).join(' | ').slice(-700));
  }

  // ---- [7] seedcap ----
  {
    const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
    const g = shape(1, 0x41B0).map(asSc), m = H.keyOf(g[0].d);
    const x = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g);
    T('[7] pendingOfGroup: the finishers\' vector, only their seats claimants', !!x && J(x.scores) === J(FIN) && J(x.self) === J([1, 2]), J(x && { s: x.scores, self: x.self }));
    const st = { audited: {}, chain: {} };
    const p1 = sc.pickAuditable(st, { [m]: g });
    T('[7] first sight of the whole shape: picked, marked ee, a first audit (counted)', p1.length === 1 && p1[0].ee === 1 && !p1[0].re);
    const lone = { audited: { [m]: { c: 50000, s: 2785, o: 0, t: 1, k: 'root' } }, chain: {} };
    const p2 = sc.pickAuditable(lone, { [m]: g });
    T('[7] audited earlier on the early record alone: taken again once, as a re-audit marked ee', p2.length === 1 && p2[0].ee === 1 && p2[0].re === 1 && J(p2[0].scores) === J(FIN));
    sc.applyAudit(lone, p2, { m0: { cap: 90000, via: 'root' } }, new Set(), 2, {});
    T('[7] the verdict is kept marked ee (and re), and the key is not picked a third time', lone.audited[m].ee === 1 && lone.audited[m].re === 1 && lone.audited[m].s === 16037
      && sc.pickAuditable(lone, { [m]: g }).length === 0, J(lone.audited[m]));
    const plain = shape(1, 0x41B1).map(asSc); const m3 = H.keyOf(plain[0].d);
    T('[7] a remembered audit of a group of another shape is not taken again', sc.pickAuditable({ audited: { [m3]: { c: 1, s: 1, o: 0, t: 1 } }, chain: {} }, { [m3]: plain.slice(0, 2) }).length === 0);
  }

  // ---- [8] mutants ----
  {
    if (ctlRun) {
      const fl = ctlRun.runs.some((r) => flaggedOf(r, ctlRun.key)), rated = ctlRun.runs.some((r) => ratingPosts(r, B) || ratingPosts(r, C));
      T('[8a] mutant (the verdict off = main before Q414): the three flagged, nobody rated -- [3] goes red', ctlRun.ok && fl && !rated && [A, B, C].every((s) => fOf(last(ctlRun), s) === 1),
        J({ fl, rated, f: [A, B, C].map((s) => fOf(last(ctlRun), s)) }));
    }
    const units = [
      ['[8b] two finishers', 'if (fs.length < 2) return null;', 'if (fs.length < 1) return null;', () => [shape(1, 0x41C0)[0], shape(1, 0x41C0)[1], parsed(B, finD(1, 0x41C0, 1))]],
      ['[8c] fewer levels', '!early.every((r) => lv(r) < fl)) return null;', '!early.every((r) => lv(r) <= fl)) return null;', () => shape(1, 0x41C1, { e: { lv: 6 } })],
      ['[8d] peers-gone only', 'const early = g.filter((r) => dispOf(r) === 1), fin', 'const early = g.filter((r) => dispOf(r) === 1 || dispOf(r) === 5), fin', () => shape(1, 0x41C2, { e: { disp: 5 } })],
      ['[8e] finished only', 'fin = g.filter((r) => dispOf(r) === 0);', 'fin = g.filter((r) => dispOf(r) === 0 || dispOf(r) === 6);', () => shape(1, 0x41C3, { c: { disp: 6 } })],
      ['[8f] one vector', 'if (fl < 1 || !fin.every((r) => vo(r) === v0 && lv(r) === fl)', 'if (fl < 1 || !fin.every((r) => lv(r) === fl)', () => shape(1, 0x41C4, { c: { sc: [0, 16037, 14550] } })],
      ['[8g] free-for-all', 'if (isEndlessMt(mt) || isBotMt(mt) || (isTeamMt(mt) && !team) || pc < 3 || pc > 6) return null;', 'if (isEndlessMt(mt) || isBotMt(mt) || pc < 3 || pc > 6) return null;', () => shape(3, 0x41C5)],   // Q436: the 2V2 / 3V3 codes are taken (test/team2-host-early-end.js)
      ['[8h] one table', 'if (table[s] != null && table[s] !== sid) return null;', '', () => shape(1, 0x41C6, { b: { ros: [A, B, X] } })],
      ['[8i] the finishers seat him', '.length * 2 <= fin.length) return null;', '.length * 2 < 0) return null;', () => shape(1, 0x41C7, { b: { ros: ['0', B, C] }, c: { ros: ['0', B, C] } })],
      ['[8j] his own seat', 'if (early.some((r) => who(r) !== es || (r.d[5] | 0) !== eSeat) || fin.some((r) => who(r) === es)) return null;', 'if (fin.some((r) => who(r) === es)) return null;',
        () => [parsed(A, earlyD(1, 0x41C8)), parsed(A, earlyD(1, 0x41C8, { seat: 1 })), parsed(B, finD(1, 0x41C8, 1)), parsed(C, finD(1, 0x41C8, 2))]],
      ['[8j2] one early account', 'if (early.some((r) => who(r) !== es || (r.d[5] | 0) !== eSeat) || fin.some((r) => who(r) === es)) return null;', 'if (early.some((r) => (r.d[5] | 0) !== eSeat && who(r) === es) || fin.some((r) => who(r) === es)) return null;',
        () => [parsed(A, earlyD(1, 0x41C9, { ros: [A, B, C, X], sc: [2785, 900, 700, 600] })), parsed(B, earlyD(1, 0x41C9, { seat: 1, ros: [A, B, C, X], sc: [900, 2785, 700, 600] })),
          parsed(C, finD(1, 0x41C9, 2, { ros: [A, B, C, X], sc: [0, 0, 16037, 14000] })), parsed(X, finD(1, 0x41C9, 3, { ros: [A, B, C, X], sc: [0, 0, 16037, 14000] }))]],
    ];
    for (const [tag, from, to, grp] of units) {
      const s = mutant('validate.js', from, to, tag);
      if (!s) continue;
      const mv = require(s);
      T(tag + ' mutant: the unit case in [1] goes red (taken as the shape)', v.earlyEndVerdict(grp(), vecOf) === null && !!mv.earlyEndVerdict(grp(), vecOf));
    }
    // the excuse off: the early writer is convicted (the [3] case goes red)
    const s1 = mutant('validate.js', "(earlySeatOf(early, x) ? 'early' : '')", "''", '[8k]');
    if (s1) { const m = play(1, 0x41D0, { script: s1 }); T('[8k] mutant (no early excuse): [3] goes red -- the early writer convicted', m.ok && leavesOf(m.runs[2], A) === 1 && edOf(m.runs[2], A) === 0, J(lvOf(m.runs[2], A))); }
    // the absent-seat hold not lifted: the finishers wait out the grace (a run later)
    const s2 = mutant('validate.js', 'if (c.early) for (let i = absentNow.length - 1; i >= 0; i--) if (earlySeatOf(c.early, absentNow[i])) absentNow.splice(i, 1);', '', '[8l]');
    if (s2) { const m = play(1, 0x41D1, { script: s2 }); T('[8l] mutant (his seat waited for as a late record): [3] goes red -- not settled when the finishers land', m.ok && !procOf(m.runs[2], m.key) && procOf(m.runs[3], m.key)); }
    // the consolation not owed
    const s3 = mutant('validate.js', 'pe.cq = owedUnsent(pe, pe.cq, owedItem(null, Math.floor(nowMs / 86400000)), nowMs);', '', '[8m]');
    if (s3) { const m = play(1, 0x41D2, { script: s3 }); T('[8m] mutant (no consolation owed): [3] goes red -- the early writer gets nothing', m.ok && leavesOf(m.runs[2], A) === 0 && !m.runs.some((r) => xpPosts(r, A).length)); }
    // seedcap: the mirror off / the re-audit off / the mark off
    const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
    const g = shape(1, 0x41E0).map(asSc), m = H.keyOf(g[0].d);
    const c1 = mutant('seedcap.js', "const ee = v.earlyEndVerdict(g);   // cloud audit Q414", 'const ee = null;   // cloud audit Q414', '[8n]');
    if (c1) { const ms = require(c1); T('[8n] mutant (seedcap mirror off): [7] goes red -- the shape not auditable', !!sc.pendingOfGroup({ audited: {}, chain: {} }, m, g) && ms.pendingOfGroup({ audited: {}, chain: {} }, m, g) === null); }
    const c2 = mutant('seedcap.js', 'if (!a || a.ee || !v.earlyEndVerdict(groups[m])) continue;', 'continue;', '[8o]');
    if (c2) { const ms = require(c2); const st = { audited: { [m]: { c: 50000, s: 2785, o: 0, t: 1 } }, chain: {} }; T('[8o] mutant (no re-audit): [7] goes red -- the finishers\' vector never audited', ms.pickAuditable(st, { [m]: g }).length === 0); }
    const c3 = mutant('seedcap.js', '    if (x.ee) st.audited[x.m].ee = 1;', '', '[8p]');
    if (c3) {
      const ms = require(c3); const st = { audited: { [m]: { c: 50000, s: 2785, o: 0, t: 1 } }, chain: {} };
      const pp = ms.pickAuditable(st, { [m]: g }); ms.applyAudit(st, pp, { m0: { cap: 90000, via: 'root' } }, new Set(), 2, {});
      T('[8p] mutant (the audit not marked): [7] goes red -- taken again every run', ms.pickAuditable(st, { [m]: g }).length === 1);
    }
  }
} finally {
  for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} }
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (early-end-set-aside) ===' : '=== PASS -- 0 fail (early-end-set-aside) ===');
process.exit(failN ? 1 : 0);
