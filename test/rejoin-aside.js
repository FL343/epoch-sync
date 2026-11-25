'use strict';
// cloud audit Q415 (round-3 R3-B2-01, 2026-11-19): a six-player friends' room 3V3 on launch night (1436293812_1720557369_10)
//   never settled although its six 'finished' records agree to the last score. The seventh record was seat 3's own: a host
//   migration failed for him alone at level 2, the client kept his rejoin record and wrote a 'migrate-disband' (4) result of
//   the two levels he had seen; he rejoined, played the match out with the others and wrote his 'finished' record to the next
//   shard. The group compared every record as one more voice, so the room stayed unsettled (before Q407: all six flagged).
//   Now such an earlier record leaves the group before anything weighs it (rejoinAsideVerdict): a friends' room / bot match,
//   the same account also wrote a 'finished' record (0 / 10) of the key from one seat, and the earlier one is host-left (2) /
//   level-begin-timeout (3) / migrate-disband (4) from that seat at fewer levels. His 'finished' record still has to agree
//   with the others' for the key to settle. The per-seed cap reads the group the same way (seedcap.js).
//   [1] units: rejoinAsideVerdict on the live shape and on every shape it must leave alone
//   [2] groupRecords: the live shape becomes a consistent entry of the six 'finished' records (in place, counted once);
//       his 'finished' record not there yet / not agreeing -> still not consistent (the Q407 lane takes it as before)
//   [3] the live room end to end (the real validate.js main() on the offline board stub): the earlier record alone first,
//       everyone's 'finished' ten minutes later -- settled, every seat paid exactly what the room pays without the earlier
//       record, nobody flagged, the summary row; the control (main + Q407: the mutant that switches the verdict off) does
//       not settle the room
//   [4] a bot match of three humans: settled the same way; a quick 3P of the same shape keeps the old rule (flag lane)
//   [5] seedcap: the shape is audited on the 'finished' vector (every seat a claimant); an audit taken on the earlier record
//       alone is taken again once (a re-audit, marked ra), never a third time, an error of it neither
//   [6] mutants: each guard of the verdict, the in-place removal (and the compare-only variant: the rejoiner flagged alone as a
//       double writer), the seedcap mirror, its re-audit and both marks -- every one goes red on the case it guards
const fs = require('fs'), path = require('path');
for (const k of ['PT_MODE', 'APPLY_MMR', 'ABSENT_GRACE_MS', 'STARTS_MATURITY_MS', 'GITHUB_STEP_SUMMARY']) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs, so v.pid() addresses their state rows
const H = require('./lib/settle-stub.js');
const v = require(path.join(H.ROOT, 'validate.js'));
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000;
const P = [4150, 4151, 4152, 4153, 4154, 4155].map(H.SID);
const X = H.SID(4159);
const FIN = [11477, 13910, 18940, 14139, 11740, 6411];   // the live room's six 'finished' records (the 03:15:57Z log)
const DIS = [2959, 2300, 204, 3906, 3284, 1430];          // seat 3's 'migrate-disband' record after level 2
const RANK = [3, 2, 1, 4, 5, 6];                          // as written on the live records (team first, then score)
// a parsed record (the reconcile's shape): { steamID, shard, d, dispCode, disp, roster }
function parsed(sid, d, shard) { const pc = d[8] | 0; return { steamID: sid, shard: shard | 0, d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; }
function finD(mt, hash, seat, o) {
  o = o || {};
  const ros = o.ros || P, s = o.sc || FIN.slice(0, ros.length);
  const d = H.rec(0xB1, mt, hash, seat, o.rank != null ? o.rank : (RANK[seat] || seat + 1), (RANK[seat] || 0) === 1, ros, s, o.disp == null ? 0 : o.disp);
  if (o.lv != null) d[7] = (o.lv << 1) | (d[7] & 1);
  d[9] = 706;
  return d;
}
function disD(mt, hash, seat, o) {
  o = o || {};
  const ros = o.ros || P, s = o.sc || DIS.slice(0, ros.length);
  const d = H.rec(0xB1, mt, hash, seat, 1, true, ros, s, o.disp == null ? 4 : o.disp);   // rank 1 as on the live record
  d[7] = ((o.lv == null ? 2 : o.lv) << 1) | 1; d[9] = 248;
  return d;
}
// a record of seat 3 claiming nine seats (out of range), its disposition where a nine-seat record carries it
function badRec(hash, disp, lv) { const d = disD(10, hash, 3, { disp, lv }); d[8] = 9; while (d.length < 40) d.push(0); d[19] = disp; return { steamID: P[3], shard: 3, d, dispCode: disp, disp: v.dispName(disp), roster: {} }; }
// the live room: seat 3's earlier record and his 'finished' one, the five others' 'finished'
const live = (mt, hash, o) => {
  o = o || {};
  const ros = o.ros || P;
  const out = ros.map((sid, seat) => parsed(sid, finD(mt, hash, seat, (o.fin && o.fin[seat]) || { ros }), seat));
  out.splice(3, 0, parsed(ros[3], disD(mt, hash, 3, Object.assign({ ros }, o.dis || {})), 3));
  return out;
};
const vecOf = (r) => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });

// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const mutants = [];
function mutant(file, from, to, tag) {
  const src = fs.readFileSync(path.join(H.ROOT, file), 'utf8');
  if (src.split(from).length !== 2) { T(tag + ' mutant anchor found exactly once', false, from.slice(0, 80)); return null; }
  const out = path.join(H.ROOT, '.mutant-rejoin-aside-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '-' + path.basename(file));
  fs.writeFileSync(out, src.replace(from, to));
  mutants.push(out);
  return out;
}

const EXTRA = [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
  { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
// the live order: starts, seat 3's earlier record four minutes in, everyone's 'finished' ten minutes later, then later runs
//   (with o.noDis: the same room without the earlier record -- the payout every seat should get)
function play(mt, hash, o) {
  o = o || {};
  const ros = o.ros || P;
  const st = ros.map((sid, seat) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, null) })).filter((x) => x.sid !== '0');   // '0' = a bot's seat (writes nothing)
  const dis = { sid: ros[3], d: disD(mt, hash, 3, { ros }) };
  const fin = ros.map((sid, seat) => ({ sid, d: finD(mt, hash, seat, { ros }) })).filter((x) => x.sid !== '0');
  const all = o.noDis ? fin : fin.slice(0, 3).concat([dis], fin.slice(3));   // seat 3's earlier record on one shard, his 'finished' on the next
  const steps = [[0, st], [4 * MIN, o.noDis ? st : st.concat([dis])], [10 * MIN, st.concat(all)], [10 * MIN, null], [30 * MIN, null], [2 * HOUR, null], [6 * HOUR, null]];
  const runs = [];
  let state = null, prev = null;
  for (const [ms, recs0] of steps) {
    const recs = recs0 || prev;
    prev = recs;
    const r = H.runCron(H.shardBoards(recs, EXTRA), state ? H.advance(state, ms) : null, null, o.script || null, 'rejoin-aside');
    runs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { runs, key: H.keyOf(fin[0].d), ok: runs.every((r) => r.code === 0) && runs.length === steps.length, ros };
}
const last = (m) => m.runs[m.runs.length - 1];
const flaggedOf = (r, key) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[key]);
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const procOf = (r, key) => { const p = r.state.PROCESSED_FILE; return Array.isArray(p) ? p.indexOf(key) >= 0 : !!(p && (p[key] || (Array.isArray(p.keys) && p.keys.indexOf(key) >= 0))); };
const xpAll = (m, sid) => m.runs.reduce((a, r) => a.concat(H.postsOf(r, 5, sid).map((x) => x.score)), []);
const settledAt = (m) => m.runs.findIndex((r) => procOf(r, m.key));

console.log('=== a writer\'s own earlier record of a room he came back to and finished is set aside (Q415) ===');
try {
  // ---- [1] units ----
  {
    const g = live(10, 0x4150);
    const x = v.rejoinAsideVerdict(g);
    T('[1] the live room: seat 3\'s migrate-disband taken out, g = the six finished (same objects, same order)',
      !!x && x.aside.length === 1 && x.aside[0] === g[3] && J(x.sids) === J([P[3]]) && x.g.length === 6 && x.g.every((r, i) => r === g[i < 3 ? i : i + 1]), J(x && { a: x.aside.length, n: x.g.length }));
    T('[1] a seedcap record shape (w, no steamID / dispCode): the same', (() => { const y = v.rejoinAsideVerdict(g.map(asSc)); return !!y && y.aside.length === 1 && y.g.length === 6; })());
    T('[1] a bot match (11): the same', !!v.rejoinAsideVerdict(live(11, 0x4151)));
    T('[1] host-left (2) and level-begin-timeout (3) earlier records: the same', !!v.rejoinAsideVerdict(live(10, 0x4152, { dis: { disp: 2 } })) && !!v.rejoinAsideVerdict(live(10, 0x4153, { dis: { disp: 3 } })));
    T('[1] his later record finished without the final summary (10): the same', !!v.rejoinAsideVerdict(live(10, 0x4154, { fin: { 3: { disp: 10 } } })));
    T('[1] a second earlier record of his (two failed migrations): both taken out', (() => {
      const g2 = live(10, 0x4155); g2.splice(4, 0, parsed(P[3], disD(10, 0x4155, 3, { lv: 4, sc: DIS.map((s) => s * 2) }), 4));
      const y = v.rejoinAsideVerdict(g2); return !!y && y.aside.length === 2 && y.g.length === 6 && J(y.sids) === J([P[3]]);
    })());
    T('[1] two writers who each came back: both taken out', (() => {
      const g2 = live(10, 0x4156); g2.push(parsed(P[1], disD(10, 0x4156, 1, { lv: 3 }), 7));
      const y = v.rejoinAsideVerdict(g2); return !!y && y.aside.length === 2 && y.g.length === 6 && J(y.sids.slice().sort()) === J([P[1], P[3]].sort());
    })());
    T('[1] his finished record disagreeing with the others: his earlier one still taken out (the group then differs as before)', (() => {
      const y = v.rejoinAsideVerdict(live(10, 0x4157, { fin: { 3: { sc: FIN.map((s, i) => (i === 3 ? s + 1 : s)) } } })); return !!y && y.aside.length === 1 && y.g.length === 6;
    })());
    const no = (label, grp) => T('[1] left alone: ' + label, v.rejoinAsideVerdict(grp) === null);
    no('quick (1)', live(1, 0x4160));
    no('ranked (2)', live(2, 0x4161));
    no('a team code (3)', live(3, 0x4162));
    no('endless (7): Q306 / Q317', live(7, 0x4163));
    no('the earlier record peers-gone (1)', live(10, 0x4164, { dis: { disp: 1 } }));
    no('the earlier record user-quit (5)', live(10, 0x4165, { dis: { disp: 5 } }));
    no('the earlier record reconnect-failed (6)', live(10, 0x4166, { dis: { disp: 6 } }));
    no('the earlier record finished (0): two finished records of one account', live(10, 0x4167, { dis: { disp: 0 } }));
    no('the earlier record as many levels as his finished', live(10, 0x4168, { dis: { lv: 6 } }));
    no('the earlier record from another seat', live(10, 0x4169, { dis: {} }).map((r, i) => (i === 3 ? parsed(P[3], disD(10, 0x4169, 2), 3) : r)));
    no('the earlier record of another seat count', (() => { const g2 = live(10, 0x416A); g2[3] = parsed(P[3], disD(10, 0x416A, 3, { ros: P.slice(0, 5) }), 3); return g2; })());
    no('no finished record of his (he never came back)', live(10, 0x416B).filter((r, i) => i !== 4));
    no('the earlier record another account\'s (another voice)', (() => { const g2 = live(10, 0x416C); g2[3] = parsed(X, disD(10, 0x416C, 3), 3); return g2; })());
    no('his finished later record reconnect-failed (6), not finished', live(10, 0x416D, { fin: { 3: { disp: 6 } } }));
    no('his finished records from two seats', (() => { const g2 = live(10, 0x416E); g2.push(parsed(P[3], finD(10, 0x416E, 2), 8)); return g2; })());
    no('malformed records of his (a seat count out of range)', [parsed(P[0], finD(10, 0x416F, 0), 0), badRec(0x416F, 0, 6), badRec(0x416F, 4, 2)]);
    no('one record only', [live(10, 0x4170)[3]]);
  }

  // ---- [2] groupRecords ----
  {
    const g = live(10, 0x4180), m = H.keyOf(g[0].d);
    const gr = v.groupRecords(g.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
    const ent = gr.consistentMatches.find((c) => c.m === m);
    T('[2] a consistent entry of the six finished records, nothing in the flag lane, the group marked for the count (1 record)',
      !!ent && ent.g.length === 6 && ent.g.every((r) => r.dispCode === 0) && !ent.void && gr.inconsistentGroups.length === 0 && gr.flagged === 0 && gr.groups[m].rejoinAside === 1, J({ n: ent && ent.g.length, mark: gr.groups[m].rejoinAside }));
    T('[2] the group list holds the same array (in place: the later passes and the pre-settle checks read six records)', gr.groups[m] === (ent && ent.g) && gr.groups[m].length === 6);
    const g2 = live(10, 0x4181).filter((r, i) => i !== 4), m2 = H.keyOf(g2[0].d);
    const gr2 = v.groupRecords(g2, { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] his finished record not there yet: not consistent, all six records kept (the Q407 lane takes it), not marked', gr2.inconsistentGroups.length === 1 && gr2.groups[m2].length === 6 && !gr2.consistentMatches.length && !gr2.groups[m2].rejoinAside);
    const g3 = live(10, 0x4182, { fin: { 3: { sc: FIN.map((s, i) => (i === 3 ? s + 1 : s)) } } }), m3 = H.keyOf(g3[0].d);
    const gr3 = v.groupRecords(g3, { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] his finished record disagreeing: not consistent, six records left (his earlier one out)', gr3.inconsistentGroups.length === 1 && gr3.groups[m3].length === 6 && !gr3.consistentMatches.length);
    const g4 = live(1, 0x4183), m4 = H.keyOf(g4[0].d);
    const gr4 = v.groupRecords(g4, { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] a quick key of the same shape: the old rule (the flag lane, all seven records)', gr4.flagged === 1 && gr4.groups[m4].length === 7 && !gr4.consistentMatches.length);
  }

  // ---- [3] the live room end to end ----
  const base = play(10, 0x4190, { noDis: true });
  const q = play(10, 0x4191);
  {
    const at = settledAt(q), at0 = settledAt(base);
    T('[3] all runs exit 0', q.ok && base.ok, q.runs.map((r) => r.code).join(',') + ' / ' + base.runs.map((r) => r.code).join(','));
    T('[3] the earlier record alone (run 2): not settled, nobody flagged', !procOf(q.runs[1], q.key) && !flaggedOf(q.runs[1], q.key));
    T('[3] settled in the same run as the room without the earlier record', at >= 2 && at === at0, 'at=' + at + ' control at=' + at0);
    T('[3] every seat paid exactly what the room pays without the earlier record (once each)', P.every((sid) => xpAll(q, sid).length === 1 && J(xpAll(q, sid)) === J(xpAll(base, sid))),
      J(P.map((sid) => [xpAll(q, sid), xpAll(base, sid)])));
    T('[3] nobody flagged, no forgery mark on any account, in any run', q.runs.every((r) => !flaggedOf(r, q.key)) && P.every((sid) => fOf(last(q), sid) === 0));
    const rs = q.runs[Math.max(0, at)];
    T('[3] the log names the set-aside; no double-writer line', /1 earlier record\(s\) of 1 writer\(s\) who came back and finished the match set aside, nobody flagged for them \(Q415\): \S+@\S+=migrate-disband after 2 level\(s\)/.test(q.runs[2].out)
      && !q.runs.some((r) => /dup-writer/.test(r.out)), (q.runs[2].out.split('\n').find((l) => /Q415/.test(l)) || '').slice(0, 300));
    T('[3] the summary row: 1 in the run the records met', /\| friends' room \/ bot match keys with an earlier host-left \/ level-begin-timeout \/ migrate-disband record of a writer who came back and finished[^|]*\(Q415\) \| 1 \|/.test(q.runs[2].summary)
      && /\(Q415\) \| 0 \|/.test(base.runs[2].summary), (q.runs[2].summary.split('\n').find((l) => /Q415/.test(l)) || '').slice(-80));
    T('[3] Q407 does not see the room any more', !q.runs.some((r) => new RegExp('room-dispute ' + q.key).test(r.out)));
    void rs;
  }
  const off = mutant('validate.js', '    const ra = rejoinAsideVerdict(g);\n    if (ra) {', '    const ra = null;\n    if (ra) {', '[6a]');
  const ctl = off ? play(10, 0x4192, { script: off }) : null;

  // ---- [4] a bot match ----
  {
    const R5 = P.slice(0, 4).concat(['0']), hum = P.slice(0, 4);   // four humans and a bot; the rejoiner at seat 3
    const m = play(11, 0x41A0, { ros: R5 }), m0 = play(11, 0x41A1, { ros: R5, noDis: true });
    T('[4] a bot match of four humans: settled as without the earlier record, the same payouts (once each), nobody flagged',
      m.ok && m0.ok && settledAt(m) >= 0 && settledAt(m) === settledAt(m0) && hum.every((sid) => xpAll(m, sid).length === 1 && J(xpAll(m, sid)) === J(xpAll(m0, sid))) && m.runs.every((r) => !flaggedOf(r, m.key)),
      'at=' + settledAt(m) + '/' + settledAt(m0) + ' ' + J(hum.map((sid) => [xpAll(m, sid), xpAll(m0, sid)])) + ' ' + (m.runs[2].out.split('\n').filter((l) => /16[0-9]+_1234_11|Q415|bot/.test(l)).join(' | ')).slice(0, 600));
  }

  // ---- [5] seedcap ----
  {
    const g = live(10, 0x41B0).map(asSc), m = H.keyOf(g[0].d);
    const x = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g);
    T('[5] pendingOfGroup: the finished vector, every seat a claimant, marked ra', !!x && J(x.scores) === J(FIN) && J(x.self) === J([0, 1, 2, 3, 4, 5]) && x.ra === 1, J(x && { s: x.scores, self: x.self, ra: x.ra }));
    T('[5] the group without the earlier record: the same audit, not marked', (() => { const y = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g.filter((r, i) => i !== 3)); return !!y && J(y.scores) === J(FIN) && !y.ra; })());
    const st = { audited: {}, chain: {} };
    const p1 = sc.pickAuditable(st, { [m]: g });
    T('[5] first sight of the whole shape: picked once, marked ra, a first audit (counted)', p1.length === 1 && p1[0].ra === 1 && !p1[0].re);
    const lone = { audited: { [m]: { c: 50000, s: 3906, o: 0, t: 1, k: 'root' } }, chain: {} };
    const p2 = sc.pickAuditable(lone, { [m]: g });
    T('[5] audited earlier on the earlier record alone: taken again once, a re-audit marked ra, on the finished vector', p2.length === 1 && p2[0].ra === 1 && p2[0].re === 1 && J(p2[0].scores) === J(FIN));
    sc.applyAudit(lone, p2, { m0: { cap: 90000, via: 'root' } }, new Set(), 2, {});
    T('[5] the verdict is kept marked ra (and re), and the key is not picked a third time', lone.audited[m].ra === 1 && lone.audited[m].re === 1 && lone.audited[m].s === 18940
      && sc.pickAuditable(lone, { [m]: g }).length === 0, J(lone.audited[m]));
    const er = { audited: { [m]: { c: 50000, s: 3906, o: 0, t: 1, k: 'root' } }, chain: {} };
    const p3 = sc.pickAuditable(er, { [m]: g });
    sc.applyAudit(er, p3, { m0: { err: 'boom' } }, new Set(), 2, {});
    T('[5] the re-audit errs: remembered as an error marked ra, not taken again', er.audited[m].e === 'boom' && er.audited[m].ra === 1 && sc.pickAuditable(er, { [m]: g }).length === 0, J(er.audited[m]));
    const plain = live(10, 0x41B1).map(asSc).filter((r, i) => i !== 3), m3 = H.keyOf(plain[0].d);
    T('[5] a remembered audit of a group without the shape is not taken again', sc.pickAuditable({ audited: { [m3]: { c: 1, s: 1, o: 0, t: 1 } }, chain: {} }, { [m3]: plain }).length === 0);
    const q1 = live(1, 0x41B2).map(asSc), m4 = H.keyOf(q1[0].d);
    T('[5] a quick key of the shape: not auditable, as before (the reconcile\'s flag lane)', sc.pendingOfGroup({ audited: {}, chain: {} }, m4, q1) === null);
  }

  // ---- [6] mutants ----
  {
    if (ctl) {
      T('[6a] mutant (the verdict off = main + Q407): the room never settles, nobody paid, nobody flagged -- [3] goes red',
        ctl.ok && settledAt(ctl) < 0 && P.every((sid) => xpAll(ctl, sid).length === 0) && ctl.runs.every((r) => !flaggedOf(r, ctl.key))
        && ctl.runs.some((r) => new RegExp('room-dispute ' + ctl.key).test(r.out)));
    }
    const units = [
      ['[6b] friends\' room / bot only', 'if (base !== PRIVATE_XP.MT && base !== BOT_XP.MT) return null;   // friends\' room / bot match only (the t2Leave lane)', '', () => live(1, 0x41C0)],
      ['[6c] host-left / level-begin-timeout / migrate-disband only', 'const REJOIN_ASIDE = { DISP: [2, 3, 4],', 'const REJOIN_ASIDE = { DISP: [1, 2, 3, 4, 5],', () => live(10, 0x41C1, { dis: { disp: 1 } })],
      ['[6d] his later record finished', 'FIN: [0, DISP_NOSUMMARY] };', 'FIN: [0, 6, DISP_NOSUMMARY] };', () => live(10, 0x41C2, { fin: { 3: { disp: 6 } } })],
      ['[6e] fewer levels', '&& (r.d[5] | 0) === seat && pcOf(r) === pc && lv(r) < top);', '&& (r.d[5] | 0) === seat && pcOf(r) === pc && lv(r) <= top);', () => live(10, 0x41C3, { dis: { lv: 6 } })],
      ['[6f] from his seat', '&& (r.d[5] | 0) === seat && pcOf(r) === pc && lv(r) < top);', '&& pcOf(r) === pc && lv(r) < top);', () => live(10, 0x41C4).map((r, i) => (i === 3 ? parsed(P[3], disD(10, 0x41C4, 2), 3) : r))],
      ['[6g] his finished from one seat', 'if (fin.some((r) => (r.d[5] | 0) !== seat || pcOf(r) !== pc)) continue;', '', () => { const g2 = live(10, 0x41C5); g2.push(parsed(P[3], finD(10, 0x41C5, 2), 8)); return g2; }],
      ['[6h] fewer than every finished of his', 'const top = Math.min(...fin.map(lv));', 'const top = Math.max(...fin.map(lv));',
        () => { const g2 = live(10, 0x41C6, { dis: { lv: 4 } }); g2.push(parsed(P[3], finD(10, 0x41C6, 3, { lv: 3, sc: FIN.map((s) => s + 7) }), 8)); return g2; }],
      ['[6i] well-formed records only', 'if (!sid || rs.length < 2 || rs.some((r) => !pcOf(r))) continue;', 'if (!sid || rs.length < 2) continue;',
        () => [parsed(P[0], finD(10, 0x41C7, 0), 0), badRec(0x41C7, 0, 6), badRec(0x41C7, 4, 2)]],
    ];
    for (const [tag, from, to, grp] of units) {
      const s = mutant('validate.js', from, to, tag);
      if (!s) continue;
      const mv = require(s);
      T(tag + ' mutant: the unit case in [1] goes red (taken as the shape)', v.rejoinAsideVerdict(grp()) === null && !!mv.rejoinAsideVerdict(grp()));
    }
    // the record only skipped in the comparison, not taken out of the group (pit 1 of the queue row): the room settles, but the
    //   pre-settle checks see his two records -- the rejoiner flagged alone as a double writer and his records dropped
    const s1 = mutant('validate.js', '      g.splice(0, g.length, ...ra.g);   // in place: groups[m] is this array (the later passes and the start cross-check read it)\n      g.rejoinAside = ra.aside.length;',
      '      g.rejoinAside = ra.aside.length;', '[6j]');
    if (s1) {
      const s1b = s1 && (() => { const src = fs.readFileSync(s1, 'utf8'); const a = '    const vecs = g.map(vecOf);\n    let same = vecs.every('; if (src.split(a).length !== 2) return null; fs.writeFileSync(s1, src.replace(a, '    const vecs = (ra ? ra.g : g).map(vecOf);\n    let same = vecs.every(')); return s1; })();
      T('[6j] the compare-only anchor found', !!s1b);
      const m = play(10, 0x41D0, { script: s1 });
      const at = settledAt(m);
      T('[6j] mutant (compared without his earlier record, the group left whole): [3] goes red -- the pre-settle check flags the rejoiner alone as a double writer, the room settles without him',
        m.ok && fOf(last(m), P[3]) === 1 && xpAll(m, P[3]).length === 0 && P.filter((sid, i) => i !== 3).every((sid) => xpAll(m, sid).length === 1) && m.runs.some((r) => /sanity on \S+\[dup-writer\]/.test(r.out)),
        'at=' + at + ' f=' + fOf(last(m), P[3]) + ' xp=' + J(xpAll(m, P[3])) + ' ' + (m.runs.map((r) => r.out.split('\n').filter((l) => /dup-writer|sanity/.test(l)).join(' | ')).join(' || ')).slice(0, 400));
    }
    // seedcap: the mirror off / the re-audit off / the marks off
    const g = live(10, 0x41E0).map(asSc), m = H.keyOf(g[0].d);
    const c1 = mutant('seedcap.js', '  const ra = v.rejoinAsideVerdict(g);\n  if (ra) g = ra.g;', '  const ra = null;', '[6k]');
    if (c1) { const ms = require(c1); T('[6k] mutant (seedcap mirror off): [5] goes red -- the key the reconcile settles never auditable', !!sc.pendingOfGroup({ audited: {}, chain: {} }, m, g) && ms.pendingOfGroup({ audited: {}, chain: {} }, m, g) === null); }
    const c2 = mutant('seedcap.js', 'if (!a || a.ra || !v.rejoinAsideVerdict(groups[m])) continue;', 'continue;', '[6l]');
    if (c2) { const ms = require(c2); const st = { audited: { [m]: { c: 50000, s: 3906, o: 0, t: 1 } }, chain: {} }; T('[6l] mutant (no re-audit): [5] goes red -- the finished vector never audited', ms.pickAuditable(st, { [m]: g }).length === 0); }
    const c3 = mutant('seedcap.js', '    if (x.ra) st.audited[x.m].ra = 1;   // Q415', '    // Q415', '[6m]');
    if (c3) {
      const ms = require(c3); const st = { audited: { [m]: { c: 50000, s: 3906, o: 0, t: 1 } }, chain: {} };
      const pp = ms.pickAuditable(st, { [m]: g }); ms.applyAudit(st, pp, { m0: { cap: 90000, via: 'root' } }, new Set(), 2, {});
      T('[6m] mutant (the audit not marked): [5] goes red -- taken again every run', ms.pickAuditable(st, { [m]: g }).length === 1);
    }
    const c4 = mutant('seedcap.js', "      errN++; st.audited[x.m] = Object.assign({ e: r.err, t }, x.ra ? { ra: 1 } : {});", "      errN++; st.audited[x.m] = { e: r.err, t };", '[6n]');
    if (c4) {
      const ms = require(c4); const st = { audited: { [m]: { c: 50000, s: 3906, o: 0, t: 1 } }, chain: {} };
      const pp = ms.pickAuditable(st, { [m]: g }); ms.applyAudit(st, pp, { m0: { err: 'boom' } }, new Set(), 2, {});
      T('[6n] mutant (an error not marked): [5] goes red -- taken again every run', ms.pickAuditable(st, { [m]: g }).length === 1);
    }
  }
} finally {
  for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} }
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (rejoin-aside) ===' : '=== PASS -- 0 fail (rejoin-aside) ===');
process.exit(failN ? 1 : 0);
