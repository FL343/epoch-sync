'use strict';
// cloud audit Q435 (W374, 2026-11-23): since 11-20 eight quick / ranked 2V2 and 3V3 keys went to the team-gamble lone dissent pass
//   (Q51), every one a first strike, 44 seats unsettled; one of them (104176189_1502820882_8, quick 3V3) had seven records of six
//   accounts. The honest way to write two: a joiner's host migration fails in the gamble round or the level before it, t2OnLeave
//   has no proof he was gone and sends him to the results page with the unnamed 't2-forfeit' taint -- a rank-0 refusal written as
//   'migrate-disband' (4) of the levels he had seen; he comes back from the menu card, plays the match out and writes his finished
//   record to the next shard. The taint is sticky in GAME.team2 and a warm rejoin does not clear it, so that finished record is the
//   refusal again (scores as everyone's); after a restart it claims his rank. team2Refused (Q76) read one account on both sides:
//   the match never settled, he was flagged and struck (the second time: a leaver), the opposing host charged.
//   Now rejoinAsideTeam (rejoinAsideVerdict's team branch) takes the early refusal out before anything weighs the group, and a
//   finished refusal of his is read as the winner the others claim; the opposing host is still charged for him (Q57's trust
//   input); a dissenter whose only record is such an early refusal waits for his finished record (absenceHold, signals.t2rh).
//   [1] units: rejoinAsideVerdict / rejoinAsideTeam on the live shape (cold and warm rejoin) and every shape it must leave alone;
//       rejoinEarlyOnly
//   [2] groupRecords: the shape becomes a consistent entry (in place, marked t2Aside, the copy at his place)
//   [3] the real validate.js main() on the offline board stub: the live key (both rejoin kinds) settles in the same run as the
//       key without the early record, every seat paid the same, nobody flagged or struck, the opposing host charged once; his
//       finished record one run late: held, then the same; his second strike in the window (quick and ranked): no leaver, the
//       ranked points as without the early record; he never came back: held for the grace, then the rule as before; a key the
//       old rule already processed is never settled again (the same writes after the switch as the old rule's own later runs)
//   [4] the host charge on its own (applyTeam2LoneDissent): the records back the host, an own-side joiner charges nobody, once
//       per match and seat, a processed key never
//   [5] seedcap: the shape is audited on the finished vector (the reconcile settles it), marked ra
//   [6] mutants: each guard goes red on the case it guards
const fs = require('fs'), path = require('path');
for (const k of ['PT_MODE', 'APPLY_MMR', 'ABSENT_GRACE_MS', 'STARTS_MATURITY_MS', 'GITHUB_STEP_SUMMARY', 'T2LD_K', 'T2LD_WINDOW_MS']) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs, so v.pid() addresses their state rows
const H = require('./lib/settle-stub.js');
const v = require(path.join(H.ROOT, 'validate.js'));
const sc = require(path.join(H.ROOT, 'seedcap.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const J = JSON.stringify;
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const P = [4350, 4351, 4352, 4353, 4354, 4355].map(H.SID);   // seat 0 (the host) .. 5; 3V3: seats 0-2 one team, 3-5 the other
const OUT = H.SID(4359);
const FIN = [9200, 8100, 7400, 6900, 6300, 5800];   // everyone's finished scores (the host's team wins)
const DIS = [3100, 2800, 2500, 2600, 2200, 1900];   // seat 3's scores when his migration failed (level 2)
const T2BY = 0x74320000, GTB = 0xDB | (1 << 8) | (1 << 16);   // Q43 naming int / Q61 gamble block header (validate T2BY_TAG / GT_*)
// a result record as the client writes it: rank by team (the winning team 1..ts, the other ts+1..2ts), 6 levels, disp, roster
function resD(mt, hash, seat, o) {
  o = o || {};
  const ros = o.ros || P, ts = ros.length / 2, win = o.win | 0, myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = H.rec(0xB1, mt, hash, seat, rank, myTeam === win && rank > 0, ros, o.sc || (win ? FIN.slice(0, ros.length).reverse() : FIN.slice(0, ros.length)), o.disp | 0);
  if (o.lv != null) d[7] = (o.lv << 1) | (d[7] & 1);
  d[9] = o.dur || 780;
  if (o.tag != null) d.push(T2BY | o.tag);
  if (o.gt != null) d.push(GTB, o.gt);
  return d;
}
// seat 3's early record: the rank-0 refusal, migrate-disband, two levels, his own scores then
const earlyD = (mt, hash, o) => resD(mt, hash, (o && o.seat != null) ? o.seat : 3, Object.assign({ rank: 0, disp: 4, lv: 2, dur: 300, sc: DIS }, o || {}));
function parsed(sid, d, shard) { const pc = d[8] | 0; return { steamID: sid, shard: shard | 0, d, dispCode: d[10 + pc] | 0, disp: v.dispName(d[10 + pc] | 0), roster: v.decodeRoster(d) }; }
// the live key: everyone's finished record, seat 3's early one before his (o.fin[seat] / o.dis: overrides; o.warm: his finished
//   record the refusal too)
const live = (mt, hash, o) => {
  o = o || {};
  const ros = o.ros || P;
  const out = ros.map((sid, seat) => parsed(sid, resD(mt, hash, seat, Object.assign({ ros, win: o.win }, (seat === 3 && o.warm) ? { rank: 0 } : {}, (o.fin && o.fin[seat]) || {})), seat));
  out.splice(3, 0, parsed(ros[3], earlyD(mt, hash, Object.assign({ ros, win: o.win }, o.dis || {})), 3));
  return out;
};
const asSc = (r) => ({ d: r.d, roster: r.roster, w: String(r.steamID) });
const vecOf = (r) => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));

// ---- mutants (copies of the job beside it, so their relative requires resolve) ----
const mutants = [];
function mutant(file, from, to, tag) {
  const src = fs.readFileSync(path.join(H.ROOT, file), 'utf8');
  if (src.split(from).length !== 2) { T(tag + ' mutant anchor found exactly once', false, from.slice(0, 90)); return null; }
  const out = path.join(H.ROOT, '.mutant-t2-rejoin-aside-' + process.pid + '-' + tag.replace(/[^a-z0-9]/gi, '') + '-' + path.basename(file));
  fs.writeFileSync(out, src.replace(from, to));
  mutants.push(out);
  return out;
}

const EXTRA = () => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: 7, name: 'points', entries: P.map((s) => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
// o.script: run a mutant of the job instead (o.switchAt: from that run on, the job itself -- a key the old rule settled, then this one)
// the live order: starts; seat 3's early record four minutes in; everyone's finished ten minutes later (o.late: his one run
//   later, o.never: not at all); later runs. o.noDis: the key without the early record (what every seat should get).
//   o.seed: state files of the first run (a strike he already has)
function play(mt, hash, o) {
  o = o || {};
  const st = P.map((sid, seat) => ({ sid, d: H.rec(0xB2, mt, hash, seat, 0, false, P, null) }));
  const fin = P.map((sid, seat) => ({ sid, d: resD(mt, hash, seat, Object.assign({ win: o.win }, (seat === 3 && o.warm) ? { rank: 0 } : {})) }));
  const dis = { sid: P[3], d: earlyD(mt, hash, { win: o.win }) };
  const all = o.noDis ? fin : fin.slice(0, 3).concat([dis], fin.slice(3));
  const noHis = all.filter((x) => x !== fin[3]);
  const third = o.never ? noHis : (o.late ? noHis : all), fourth = o.never ? noHis : all;
  const steps = [[0, st], [4 * MIN, o.noDis ? st : st.concat([dis])], [10 * MIN, st.concat(third)], [10 * MIN, st.concat(fourth)], [30 * MIN, null], [2 * HOUR, null], [10 * MIN, null]];
  const runs = [];
  let state = o.seed ? JSON.parse(J(o.seed)) : null, prev = null, first = true;
  for (const [ms, recs0] of steps) {
    const recs = recs0 || prev;
    prev = recs;
    const files = state ? ((first && o.seed) ? state : H.advance(state, ms)) : null;
    first = false;
    const r = H.runCron(H.shardBoards(recs, EXTRA()), files, null, (o.switchAt != null && runs.length >= o.switchAt) ? null : (o.script || null), 't2-rejoin-aside');
    runs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { runs, key: H.keyOf(fin[0].d), ok: runs.every((r) => r.code === 0) && runs.length === steps.length };
}
const last = (m) => m.runs[m.runs.length - 1];
const sgOf = (r) => r.state.SIGNALS_FILE || {};
const flaggedOf = (r, key) => !!((sgOf(r).flagged || {})[key]);
const fOf = (r, sid) => (((sgOf(r).players || {})[v.pid(sid)]) || {}).f | 0;
const procOf = (r, key) => { const p = r.state.PROCESSED_FILE; return Array.isArray(p) ? p.indexOf(key) >= 0 : !!(p && (p[key] || (Array.isArray(p.keys) && p.keys.indexOf(key) >= 0))); };
const xpAll = (m, sid) => m.runs.reduce((a, r) => a.concat(H.postsOf(r, 5, sid).map((x) => x.score)), []);
const ratingN = (m, sid) => m.runs.reduce((a, r) => a + H.postsOf(r, 6, sid).length, 0);
const ptsLast = (m, sid) => { let x = null; for (const r of m.runs) { const pp = H.postsOf(r, 7, sid); if (pp.length) x = pp[pp.length - 1].score; } return x; };
const settledAt = (m) => m.runs.findIndex((r) => procOf(r, m.key));
const strikesOf = (r, sid, key) => ((sgOf(r).t2ld || {})[v.pid(sid)] || []).filter((e) => !key || e.m === key).length;
const chargeOf = (r, key) => ((sgOf(r).t2lh || {})[v.pid(P[0])] || []).filter((e) => e.m === key);
const leavesOf = (m, sid) => Math.max(...m.runs.map((r) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0));
const samePay = (m, c) => P.every((sid) => xpAll(m, sid).length === 1 && J(xpAll(m, sid)) === J(xpAll(c, sid)) && ratingN(m, sid) === ratingN(c, sid));
const payStr = (m, c) => J(P.map((sid) => [xpAll(m, sid), xpAll(c, sid), ratingN(m, sid), ratingN(c, sid)]));
const prior = (mt) => ({ SIGNALS_FILE: { players: {}, t2ld: { [v.pid(P[3])]: [{ m: '111_222_' + mt, t: Date.now() - 5 * DAY, h: v.pid(H.SID(4399)), o: 1, x: [v.pid(H.SID(4399))] }] } } });

console.log('=== a 2V2 / 3V3 joiner\'s early team-gamble refusal of a match he came back to and played out is set aside (Q435) ===');
try {
  // ---- [1] units ----
  {
    const g = live(8, 0x4350);
    const x = v.rejoinAsideVerdict(g);
    T('[1] the live key (cold rejoin, his finished record claims his rank): his early refusal out, g = the six finished (same objects, same order)',
      !!x && x.aside.length === 1 && x.aside[0] === g[3] && J(x.sids) === J([P[3]]) && x.g.length === 6 && x.g.every((r, i) => r === g[i < 3 ? i : i + 1])
      && x.t2 && x.t2.length === 1 && x.t2[0].sid === P[3] && x.t2[0].seat === 3 && x.t2[0].recs[0] === g[3] && x.t2[0].own === 0, J(x && { a: x.aside.length, n: x.g.length, t2: x.t2 && x.t2.map((a) => [a.seat, a.own]) }));
    const gw = live(8, 0x4351, { warm: true });
    const y = v.rejoinAsideVerdict(gw);
    const cp = y && y.g[3];
    T('[1] the warm rejoin (his finished record the refusal too): a copy claiming the winner from his seat (his team lost: rank ts + 1), the rest the same objects',
      !!y && y.aside.length === 1 && y.g.length === 6 && cp !== gw[4] && cp.d[6] === 4 && cp.rejoinOwn === 0 && gw[4].d[6] === 0 && J(cp.d.slice(7)) === J(gw[4].d.slice(7))
      && y.g.every((r, i) => i === 3 || r === gw[i < 3 ? i : i + 1]) && y.t2[0].own === 1 && v.team2WinTeamOf(y.g) === 0, J(y && { r: cp && cp.d[6], own: y.t2 && y.t2[0].own }));
    const yw = v.rejoinAsideVerdict(live(8, 0x4352, { warm: true, win: 1 }));
    T('[1] the warm rejoin, his team won: the copy claims rank 1', !!yw && yw.g[3].d[6] === 1 && v.team2WinTeamOf(yw.g) === 1);
    T('[1] ranked 3V3 (9), quick 3V3 with ranked seats (O716 mask), and a 2V2 (5 / 6, four seats): the same', [9, 8 | (0x38 << 11)].every((mt, i) => !!v.rejoinAsideVerdict(live(mt, 0x4353 + i)))
      && [5, 6].every((mt, i) => { const ros = P.slice(0, 4); const y2 = v.rejoinAsideVerdict(live(mt, 0x4355 + i, { ros })); return !!y2 && y2.g.length === 4 && y2.aside.length === 1; }));
    T('[1] his early record host-left (2) / level-begin-timeout (3): the same', !!v.rejoinAsideVerdict(live(8, 0x4357, { dis: { disp: 2 } })) && !!v.rejoinAsideVerdict(live(8, 0x4358, { dis: { disp: 3 } })));
    T('[1] his finished record without the final summary (10): the same', !!v.rejoinAsideVerdict(live(8, 0x4359, { fin: { 3: { disp: 10 } } })));
    T('[1] a seedcap record shape (w, no steamID / dispCode): the same (the warm copy too)', (() => { const a = v.rejoinAsideVerdict(g.map(asSc)), b = v.rejoinAsideVerdict(gw.map(asSc)); return !!a && a.g.length === 6 && !!b && b.g[3].d[6] === 4; })());
    T('[1] two failed migrations (two early refusals of his): both out', (() => {
      const g2 = live(8, 0x435A); g2.splice(4, 0, parsed(P[3], earlyD(8, 0x435A, { lv: 4, sc: DIS.map((s) => s * 2) }), 4));
      const z = v.rejoinAsideVerdict(g2); return !!z && z.aside.length === 2 && z.g.length === 6 && z.t2[0].recs.length === 2;
    })());
    T('[1] two joiners who each came back (seats 1 and 3, one warm): both out, both read', (() => {
      const g2 = live(8, 0x435B, { warm: true }); g2.push(parsed(P[1], earlyD(8, 0x435B, { seat: 1, lv: 3 }), 7));
      const z = v.rejoinAsideVerdict(g2); return !!z && z.aside.length === 2 && z.g.length === 6 && J(z.sids.slice().sort()) === J([P[1], P[3]].sort()) && v.team2WinTeamOf(z.g) === 0;
    })());
    T('[1] another writer who never came back refuses (seat 4): his early refusal out, the other refusal kept (the lone dissent pass\'s)', (() => {
      const z = v.rejoinAsideVerdict(live(8, 0x435C, { fin: { 4: { rank: 0 } } })); return !!z && z.aside.length === 1 && z.g.length === 6 && z.g.filter((r) => r.d[6] === 0).length === 1;
    })());
    const no = (label, grp) => { const z = v.rejoinAsideVerdict(grp); T('[1] left alone: ' + label, z === null, J(z && { a: z.aside.length })); };
    no('his early refusal names a seat (Q43 T2BY_TAG)', live(8, 0x4360, { dis: { tag: 1 } }));
    no('his early refusal carries a Q61 gamble block', live(8, 0x4361, { dis: { gt: 1 } }));
    no('his finished record names a seat', live(8, 0x4362, { warm: true, fin: { 3: { tag: 1 } } }));
    no('his early record claims a rank (no refusal)', live(8, 0x4363, { dis: { rank: 4 } }));
    no('his early record peers-gone (1)', live(8, 0x4364, { dis: { disp: 1 } }));
    no('his early record user-quit (5)', live(8, 0x4365, { dis: { disp: 5 } }));
    no('his early record reconnect-failed (6)', live(8, 0x4366, { dis: { disp: 6 } }));
    no('his early record finished (0): two finished records', live(8, 0x4367, { dis: { disp: 0 } }));
    no('his early record as many levels as his finished', live(8, 0x4368, { dis: { lv: 6 } }));
    no('his early record from another seat', live(8, 0x4369).map((r, i) => (i === 3 ? parsed(P[3], earlyD(8, 0x4369, { seat: 4 }), 3) : r)));
    no('his finished record\'s scores differ from the others\'', live(8, 0x436A, { fin: { 3: { sc: FIN.map((s, i) => (i === 3 ? s + 1 : s)) } } }));
    no('his finished record claims the other winner', live(8, 0x436B, { fin: { 3: { rank: 1 } } }));
    no('the others do not agree on the winner', live(8, 0x436C, { fin: { 5: { rank: 1 } } }));
    no('warm rejoin while another writer refuses (his word would decide the others\' dissent)', live(8, 0x436D, { warm: true, fin: { 4: { rank: 0 } } }));
    no('fewer than two other writers claim a rank', (() => { const ros = P.slice(0, 4); return live(5, 0x436E, { ros, fin: { 1: { rank: 0 }, 2: { rank: 0 } } }); })());
    no('he never came back (no finished record)', live(8, 0x436F).filter((r, i) => i !== 4));
    no('a third record of his (reconnect-failed claiming a rank)', (() => { const g2 = live(8, 0x4370); g2.push(parsed(P[3], resD(8, 0x4370, 3, { disp: 6, lv: 4 }), 8)); return g2; })());
    no('another account\'s early refusal (another voice)', (() => { const g2 = live(8, 0x4371); g2[3] = parsed(OUT, earlyD(8, 0x4371), 3); return g2; })());
    no('a team brawl code (3): Q415\'s rule (left alone)', live(3, 0x4372));
    no('quick FFA (1)', live(1, 0x4373));
    // rejoinEarlyOnly: the dissenter's records against the agreeing side
    const rest = live(8, 0x4374).filter((r, i) => i !== 3 && i !== 4);
    const e = (o) => [parsed(P[3], earlyD(8, 0x4374, o), 3)];
    T('[1] rejoinEarlyOnly: the early refusal alone -> true', v.rejoinEarlyOnly(e({}), rest) === true);
    T('[1] rejoinEarlyOnly: naming a seat / finished (0) / as many levels / claiming a rank / beside a finished record -> false',
      !v.rejoinEarlyOnly(e({ tag: 1 }), rest) && !v.rejoinEarlyOnly(e({ disp: 0 }), rest) && !v.rejoinEarlyOnly(e({ lv: 6 }), rest) && !v.rejoinEarlyOnly(e({ rank: 4 }), rest)
      && !v.rejoinEarlyOnly(e({}).concat([parsed(P[3], resD(8, 0x4374, 3, { rank: 0 }), 4)]), rest));
  }

  // ---- [2] groupRecords ----
  {
    for (const [what, o] of [['cold', {}], ['warm', { warm: true }]]) {
      const g = live(8, 0x4380 + (o.warm ? 1 : 0), o), m = H.keyOf(g[0].d);
      const gr = v.groupRecords(g.slice(), { vecOf, MAX_SEATS: 8, starts: {} });
      const ent = gr.consistentMatches.find((c) => c.m === m);
      T('[2] ' + what + ' rejoin: a consistent entry of six records, nothing in the flag lane, marked t2Aside (seat 3)',
        !!ent && ent.g.length === 6 && !ent.void && gr.inconsistentGroups.length === 0 && gr.flagged === 0 && gr.groups[m] === ent.g
        && Array.isArray(gr.groups[m].t2Aside) && gr.groups[m].t2Aside.length === 1 && gr.groups[m].t2Aside[0].seat === 3 && gr.groups[m].rejoinAside === 1
        && (!o.warm || (ent.g[3].d[6] === 4 && ent.g[3].rejoinOwn === 0)), J({ n: ent && ent.g.length, fl: gr.flagged }));
    }
    const g2 = live(8, 0x4382).filter((r, i) => i !== 4), m2 = H.keyOf(g2[0].d);
    const gr2 = v.groupRecords(g2, { vecOf, MAX_SEATS: 8, starts: {} });
    T('[2] his finished record not there yet: inconsistent as before (the lone dissent pass holds it), not marked', gr2.inconsistentGroups.length === 1 && !gr2.consistentMatches.length && !gr2.groups[m2].t2Aside);
  }

  // ---- [3] the real main() ----
  const ctl = play(8, 0x4390, { noDis: true });
  const cold = play(8, 0x4391), warm = play(8, 0x4392, { warm: true });
  {
    T('[3] all runs exit 0', ctl.ok && cold.ok && warm.ok, [ctl, cold, warm].map((m) => m.runs.map((r) => r.code).join(',')).join(' / '));
    const at0 = settledAt(ctl);
    for (const [what, m] of [['cold rejoin', cold], ['warm rejoin', warm]]) {
      T('[3] ' + what + ': his early refusal alone (run 2): not settled, nobody flagged', !procOf(m.runs[1], m.key) && !flaggedOf(m.runs[1], m.key) && fOf(m.runs[1], P[3]) === 0);
      T('[3] ' + what + ': settled in the same run as the key without the early record', settledAt(m) >= 2 && settledAt(m) === at0, 'at=' + settledAt(m) + ' control at=' + at0);
      T('[3] ' + what + ': every seat paid exactly what the key pays without the early record (XP once, rating once)', samePay(m, ctl), payStr(m, ctl));
      T('[3] ' + what + ': nobody flagged, no forgery mark, seat 3 not struck, never a leaver', m.runs.every((r) => !flaggedOf(r, m.key)) && P.every((sid) => fOf(last(m), sid) === 0)
        && strikesOf(last(m), P[3]) === 0 && !((sgOf(last(m)).t2lv || {})[m.key]) && leavesOf(m, P[3]) === 0);
      const ch = chargeOf(last(m), m.key);
      T('[3] ' + what + ': the opposing host charged once for seat 3 (Q57 kept), players[host].lh 1', ch.length === 1 && J(ch[0].v) === J([v.pid(P[3])])
        && ((((sgOf(last(m)).players || {})[v.pid(P[0])]) || {}).lh | 0) === 1, J(ch));
      T('[3] ' + what + ': the log line and the summary row', /seat 3 = \S+ \(1 early team-gamble refusal\(s\)/.test(m.runs[2].out) && /\(Q435\)$/m.test(m.runs[2].out)
        && /charged for 1 opposing seat\(s\) that came back and played the match out/.test(m.runs[2].out)
        && new RegExp('\\(Q435\\) \\| 1 / ' + (m === warm ? 1 : 0) + ' / 1 / 0 \\|').test(m.runs[2].summary) && /\(Q435\) \| 0 \/ 0 \/ 0 \/ 0 \|/.test(ctl.runs[2].summary)
        && /\(Q415\) \| 0 \|/.test(m.runs[2].summary), (m.runs[2].summary.split('\n').find((l) => /Q435/.test(l)) || '').slice(-60));
      T('[3] ' + what + ': no lone dissent line, no forgery warning', !m.runs.some((r) => new RegExp('team2 lone dissent ' + m.key + '|match=' + m.key + ': 7 inconsistent').test(r.out)));
    }
    // his finished record lands one run after the others'
    const late = play(8, 0x4393, { late: true });
    T('[3] late: run 3 (the others finished, his record not yet): held, nobody struck or flagged',
      late.ok && /wrote only an early team-gamble refusal -- grace \d+s left for his finished record, nobody struck or flagged yet \(Q435\)/.test(late.runs[2].out)
      && !flaggedOf(late.runs[2], late.key) && strikesOf(late.runs[2], P[3]) === 0 && !procOf(late.runs[2], late.key) && / \/ 1 \|$/m.test(late.runs[2].summary.split('\n').find((l) => /Q435/.test(l)) || ''),
      (late.runs[2].out.split('\n').find((l) => /team2 /.test(l)) || '').slice(0, 300));
    T('[3] late: run 4 (his record in): settled, the same payouts, nobody flagged or struck', settledAt(late) === 3 && samePay(late, ctl) && late.runs.every((r) => !flaggedOf(r, late.key))
      && strikesOf(last(late), P[3]) === 0 && P.every((sid) => fOf(last(late), sid) === 0), 'at=' + settledAt(late) + ' ' + payStr(late, ctl));
    // he never came back: the rule as before, after the wait
    const never = play(8, 0x4394, { never: true });
    T('[3] never came back: run 3 held (no strike), run 4 (ten minutes on) the rule as before -- struck, verdict free, flagged, the host charged',
      never.ok && strikesOf(never.runs[2], P[3]) === 0 && !flaggedOf(never.runs[2], never.key) && strikesOf(never.runs[3], P[3], never.key) === 1
      && ((sgOf(never.runs[3]).t2lv || {})[never.key] || {}).v === 'free' && fOf(never.runs[3], P[3]) === 1 && chargeOf(never.runs[3], never.key).length === 1
      && /team2 lone dissent .*verdict free/.test(never.runs[3].out), J({ s2: strikesOf(never.runs[2], P[3]), s3: strikesOf(never.runs[3], P[3]), f: fOf(never.runs[3], P[3]) }));
    // his second strike in the window (the first in another host's match): no leaver
    const c2 = play(8, 0x4395, { seed: prior(8) });
    T('[3] quick, a strike already in the window: settled as without the early record, no leaver, no new strike', c2.ok && settledAt(c2) === at0 && samePay(c2, ctl)
      && leavesOf(c2, P[3]) === 0 && strikesOf(last(c2), P[3]) === 1 && fOf(last(c2), P[3]) === 0, payStr(c2, ctl));
    const ctl9 = play(9, 0x4396, { noDis: true }), d2 = play(9, 0x4397, { seed: prior(9) });
    T('[3] ranked (9), a strike already in the window, his team lost: no leaver, the points of every seat as without the early record',
      ctl9.ok && d2.ok && settledAt(d2) === settledAt(ctl9) && leavesOf(d2, P[3]) === 0 && P.every((sid) => ptsLast(d2, sid) === ptsLast(ctl9, sid) && ptsLast(d2, sid) != null),
      J(P.map((sid) => [ptsLast(d2, sid), ptsLast(ctl9, sid)])));
  }

  // ---- [4] the host charge on its own ----
  {
    const run = (g, processed) => {
      const m = H.keyOf(g[0].d), gr = v.groupRecords(g, { vecOf, MAX_SEATS: 8, starts: {} });
      const signals = { players: {}, flagged: {} };
      const res = v.applyTeam2LoneDissent(gr, signals, processed || new Set(), Date.now(), vecOf);
      return { m, gr, signals, res };
    };
    const a = run(live(8, 0x43A0));
    T('[4] the live key: one charge on the host, the key left consistent', a.res.asideHost === 1 && a.res.hosts === 1 && ((a.signals.t2lh || {})[v.pid(P[0])] || []).length === 1
      && a.res.touched.indexOf(P[0]) >= 0 && a.gr.consistentMatches.length === 1);
    const res2 = v.applyTeam2LoneDissent(a.gr, a.signals, new Set(), Date.now(), vecOf);
    T('[4] a second run on the same key: no second charge, lh stays 1', res2.asideHost === 0 && a.signals.t2lh[v.pid(P[0])].length === 1 && a.signals.t2lh[v.pid(P[0])][0].v.length === 1
      && a.signals.players[v.pid(P[0])].lh === 1);
    const own = (() => { const g = live(8, 0x43A1).map((r) => r); const e = parsed(P[1], earlyD(8, 0x43A1, { seat: 1 }), 9); g.splice(3, 1, e); return run(g); })();
    T('[4] a joiner on the host\'s own team: nobody charged', own.gr.groups[own.m].t2Aside && own.res.asideHost === 0 && !(own.signals.t2lh || {})[v.pid(P[0])]);
    const noHost = run(live(8, 0x43A2).filter((r) => String(r.steamID) !== P[0]));
    T('[4] the host wrote no record (the others\' roster only): nobody charged', noHost.gr.groups[noHost.m].t2Aside && noHost.res.asideHost === 0);
    const done = run(live(8, 0x43A3), new Set([H.keyOf(live(8, 0x43A3)[0].d)]));
    T('[4] a processed key: never charged', done.res.asideHost === 0);
  }

  // ---- [5] seedcap ----
  {
    for (const [what, o] of [['cold', {}], ['warm', { warm: true }]]) {
      const g = live(8, 0x43B0 + (o.warm ? 1 : 0), o).map(asSc), m = H.keyOf(g[0].d);
      const x = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g);
      T('[5] ' + what + ': pendingOfGroup audits the finished vector, every seat a claimant, marked ra', !!x && J(x.scores) === J(FIN) && J(x.self) === J([0, 1, 2, 3, 4, 5]) && x.ra === 1, J(x && { s: x.scores, self: x.self, ra: x.ra }));
      const lone = { audited: { [m]: { c: 50000, s: 3100, o: 0, t: 1, k: 'root' } }, chain: {} };
      const p2 = sc.pickAuditable(lone, { [m]: g });
      T('[5] ' + what + ': audited earlier on the early refusal alone -> taken again once, a re-audit on the finished vector', p2.length === 1 && p2[0].re === 1 && p2[0].ra === 1 && J(p2[0].scores) === J(FIN));
    }
    const nv = live(8, 0x43B2).filter((r, i) => i !== 4).map(asSc);
    T('[5] he never came back: not auditable, as before (the reconcile\'s dissent lane)', sc.pendingOfGroup({ audited: {}, chain: {} }, H.keyOf(nv[0].d), nv) === null);
  }

  // ---- [6] mutants ----
  {
    const units = [
      ['[6b] the early record the refusal', '&& REJOIN_ASIDE.DISP.indexOf(endOf(r)) >= 0 && refused(r) && lvOf(r) < least)) continue;', '&& REJOIN_ASIDE.DISP.indexOf(endOf(r)) >= 0 && lvOf(r) < least)) continue;', () => live(8, 0x43C0, { dis: { rank: 4 } })],
      ['[6c] no record of his names a seat', 'if (!sid || rs.length < 2 || !rs.every(nOf) || rs.some(rejoinNamesSeat)) continue;', 'if (!sid || rs.length < 2 || !rs.every(nOf)) continue;', () => live(8, 0x43C1, { dis: { tag: 1 } })],
      ['[6c2] the gamble block names a seat too', "return (r.d.length > at && ((r.d[at] | 0) & ~0x3F) === T2BY_TAG) || gambleTagOf(r) !== 0;", "return (r.d.length > at && ((r.d[at] | 0) & ~0x3F) === T2BY_TAG);", () => live(8, 0x43C2, { dis: { gt: 1 } })],
      ['[6d] his finished record on the others\' vector', '|| !cand.every((c) => c.done.every((r) => vk(r) === v0))) return null;', ') return null;', () => live(8, 0x43C3, { fin: { 3: { sc: FIN.map((s, i) => (i === 3 ? s + 1 : s)) } } })],
      ['[6e] no copy while another writer refuses', '    if (othersRefuse) return null;\n', '', () => live(8, 0x43C4, { warm: true, fin: { 4: { rank: 0 } } })],
      ['[6f] a rank he claims is the others\' winner', 'if (!refused(r)) { if (team2WinTeamOf([r]) !== win) return null; continue; }', 'if (!refused(r)) continue;', () => live(8, 0x43C5, { fin: { 3: { rank: 1 } } })],
      ['[6g] two other writers claim', 'if (new Set(claims.map(who)).size < 2) return null;', '', () => live(5, 0x43C6, { ros: P.slice(0, 4), fin: { 1: { rank: 0 }, 2: { rank: 0 } } })],
      ['[6h] every record of his one of the two', 'const early = rs.filter((r) => done.indexOf(r) < 0);', 'const early = rs.filter((r) => done.indexOf(r) < 0 && REJOIN_ASIDE.DISP.indexOf(endOf(r)) >= 0);',
        () => { const g2 = live(8, 0x43C7); g2.push(parsed(P[3], resD(8, 0x43C7, 3, { disp: 6, lv: 4 }), 8)); return g2; }],
      ['[6i] fewer levels', '&& REJOIN_ASIDE.DISP.indexOf(endOf(r)) >= 0 && refused(r) && lvOf(r) < least)) continue;', '&& REJOIN_ASIDE.DISP.indexOf(endOf(r)) >= 0 && refused(r) && lvOf(r) <= least)) continue;', () => live(8, 0x43C8, { dis: { lv: 6 } })],
      ['[6j] one seat for every record of his', 'if (!rs.every((r) => (r.d[5] | 0) === seat && nOf(r) === n)) continue;', '', () => live(8, 0x43C9).map((r, i) => (i === 3 ? parsed(P[3], earlyD(8, 0x43C9, { seat: 4 }), 3) : r))],
    ];
    for (const [tag, from, to, grp] of units) {
      const s = mutant('validate.js', from, to, tag);
      if (!s) continue;
      const mv = require(s);
      T(tag + ' mutant: the unit case in [1] goes red (taken as the shape)', v.rejoinAsideVerdict(grp()) === null && !!mv.rejoinAsideVerdict(grp()));
    }
    const cpy = mutant('validate.js', '    d[6] = (teamOfSeat(c.seat, ts) === win) ? 1 : ts + 1;\n', '', '[6k]');
    if (cpy) { const mv = require(cpy); const z = mv.rejoinAsideVerdict(live(8, 0x43CA, { warm: true })); T('[6k] mutant (the warm copy keeps rank 0): [1] goes red -- the group cannot settle (no winner)', !!z && mv.team2WinTeamOf(z.g) === null && v.team2WinTeamOf(v.rejoinAsideVerdict(live(8, 0x43CA, { warm: true })).g) === 0); }
    const eo = mutant('validate.js', '      && ((r.d[7] | 0) >> 1) < least && !rejoinNamesSeat(r);', '      && !rejoinNamesSeat(r);', '[6l]');
    if (eo) { const mv = require(eo); const rest = live(8, 0x43CB).filter((r, i) => i !== 3 && i !== 4), e = [parsed(P[3], earlyD(8, 0x43CB, { lv: 6 }), 3)]; T('[6l] mutant (rejoinEarlyOnly without the levels): [1] goes red', !v.rejoinEarlyOnly(e, rest) && mv.rejoinEarlyOnly(e, rest)); }
    const mk = mutant('validate.js', '      if (ra.t2) g.t2Aside = ra.t2;   // Q435: the opposing host\'s charge (applyTeam2LoneDissent) and the run summary\n', '', '[6m]');
    if (mk) { const mv = require(mk); const g = live(8, 0x43CC), m = H.keyOf(g[0].d); const gr = mv.groupRecords(g, { vecOf, MAX_SEATS: 8, starts: {} }); T('[6m] mutant (the group not marked): [2] goes red', !gr.groups[m].t2Aside); }
    const ow = mutant('validate.js', 'const vic = g.t2Aside.filter((a) => String(a.sid) !== host && teamOfSeat(a.seat, ts) !== teamOfSeat(0, ts));', 'const vic = g.t2Aside.filter((a) => String(a.sid) !== host);', '[6n]');
    const bk = mutant('validate.js', 'if (!vic.length || !team2HostOwnsSeat0({ host, rest, ds: vic })) return;', 'if (!vic.length) return;', '[6o]');
    const charged = (mv, g) => { const gr = mv.groupRecords(g, { vecOf, MAX_SEATS: 8, starts: {} }); return mv.applyTeam2LoneDissent(gr, { players: {}, flagged: {} }, new Set(), Date.now(), vecOf).asideHost; };
    if (ow) { const g = () => { const x = live(8, 0x43CD); x.splice(3, 1, parsed(P[1], earlyD(8, 0x43CD, { seat: 1 }), 9)); return x; }; T('[6n] mutant (an own-side joiner charges the host): [4] goes red', charged(v, g()) === 0 && charged(require(ow), g()) === 1); }
    if (bk) { const g = () => live(8, 0x43CE).filter((r) => String(r.steamID) !== P[0]); T('[6o] mutant (the host charged on the roster alone): [4] goes red', charged(v, g()) === 0 && charged(require(bk), g()) === 1); }
    // the real main() under mutants
    const off = mutant('validate.js', '  if (isSubScoreMt(base)) return rejoinAsideTeam(g);   // Q435: quick / ranked 2V2 / 3V3, below\n', '', '[6a]');
    if (off) {
      const m = play(8, 0x43D0, { script: off });
      T('[6a] mutant (the team branch off = main): [3] goes red -- the key never settles (voided at the start maturity: nobody rated, the consolation only), seat 3 flagged and struck, the host charged (the W374 repro)',
        m.ok && P.every((sid) => ratingN(m, sid) === 0 && xpAll(m, sid).length <= 1 && xpAll(m, sid).every((x) => x < Math.min(...xpAll(ctl, sid))))
        && fOf(last(m), P[3]) === 1 && strikesOf(last(m), P[3], m.key) === 1 && ((sgOf(last(m)).t2lv || {})[m.key] || {}).v === 'free' && chargeOf(last(m), m.key).length === 1,
        'f=' + fOf(last(m), P[3]) + ' s=' + strikesOf(last(m), P[3], m.key) + ' ' + payStr(m, ctl));
    }
    // keys the old rule already processed are never settled again: the same key, the old rule (main) to the end vs the old rule
    //   until it processed the key and this job after -- the same writes in every later run (nothing re-rated, no points taken back
    //   or given, the leaver and the flag as the old rule left them)
    if (off) {
      const postsAfter = (m, from) => J(m.runs.slice(from).map((r) => P.map((sid) => [5, 6, 7].map((b) => H.postsOf(r, b, sid).map((x) => x.score)))));
      const lvRow = (m, sid) => { const x = ((last(m).state.LEAVERS_FILE || {})[v.pid(sid)]) || {}; return J(Object.assign({}, x, { lf: (x.lf || []).length })); };   // lf: wall-clock stamps, compared by count
      const endOf = (m) => J([P.map((sid) => [fOf(last(m), sid), lvRow(m, sid)]), (sgOf(last(m)).t2ld || {})[v.pid(P[3])] ? sgOf(last(m)).t2ld[v.pid(P[3])].length : 0, chargeOf(last(m), m.key).length]);
      for (const [what, mt, seed, sw] of [['quick, his second strike (the old rule: settled, he a leaver)', 8, prior(8), 4], ['ranked, his second strike', 9, prior(9), 4], ['quick, his first strike (the old rule: voided at maturity)', 8, null, 6]]) {
        const allOld = play(mt, 0x43E0 + mt, { script: off, seed }), thenNew = play(mt, 0x43E0 + mt, { script: off, seed, switchAt: sw });
        T('[3] an old key (' + what + '): processed by the old rule before the switch, the same writes after it and the same end state',
          allOld.ok && thenNew.ok && settledAt(allOld) >= 0 && settledAt(allOld) < sw && settledAt(thenNew) === settledAt(allOld) && postsAfter(thenNew, sw) === postsAfter(allOld, sw) && endOf(thenNew) === endOf(allOld),
          'at=' + settledAt(allOld) + '/' + settledAt(thenNew) + ' ' + postsAfter(thenNew, sw).slice(0, 200) + ' vs ' + postsAfter(allOld, sw).slice(0, 200) + ' end ' + endOf(thenNew) + ' vs ' + endOf(allOld));
      }
    }
    const hc = mutant('validate.js', '    if (g && g.length && g.t2Aside && !processed.has(m)) t2AsideHostCharge(signals, res, m, g, now);\n', '', '[6p]');
    if (hc) { const m = play(8, 0x43D1, { script: hc }); T('[6p] mutant (the host charge off): [3] goes red -- settled, the opposing host never charged', m.ok && settledAt(m) >= 0 && chargeOf(last(m), m.key).length === 0); }
    const hd = mutant('validate.js', 'if (!prev && td && td.ds.some((d) => rejoinEarlyOnly(d.recs, td.rest))) {', 'if (false) {', '[6q]');
    if (hd) {
      const m = play(8, 0x43D2, { script: hd, late: true });
      T('[6q] mutant (no hold): [3] goes red -- his record one run late, he is struck and flagged before it lands',
        m.ok && strikesOf(m.runs[2], P[3], m.key) === 1 && fOf(m.runs[2], P[3]) === 1, J({ s: strikesOf(m.runs[2], P[3], m.key), f: fOf(m.runs[2], P[3]) }));
    }
    const sm = mutant('seedcap.js', '  const ra = v.rejoinAsideVerdict(g);\n  if (ra) g = ra.g;', '  const ra = null;', '[6r]');
    if (sm) { const ms = require(sm); const g = live(8, 0x43D3).map(asSc), m = H.keyOf(g[0].d); T('[6r] mutant (seedcap mirror off): [5] goes red -- the key the reconcile settles never auditable', !!sc.pendingOfGroup({ audited: {}, chain: {} }, m, g) && ms.pendingOfGroup({ audited: {}, chain: {} }, m, g) === null); }
  }
} finally {
  for (const f of mutants) { try { fs.unlinkSync(f); } catch (e) {} }
}
console.log(failN ? '=== FAIL -- ' + failN + ' fail (team2-rejoin-aside) ===' : '=== PASS -- 0 fail (team2-rejoin-aside) ===');
process.exit(failN ? 1 : 0);
