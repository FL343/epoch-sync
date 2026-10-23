'use strict';
// O198 v1 trust ledger (client knife 5.5b-1): trust-ledger.js + its wiring into validate.js / seedcap.js / sanctions.js.
//   [1] units: recordEvent counts sev >= 1 per source, one event per (source, key), the 32-event cap evicts low-confidence
//       events first, tm is a slot only (not armed), the mirror row layout (0xE4 v1, 11 int32) and score (sc + sa)
//   [2] producer queues: ids ascending, the reconcile takes past its cursor once, a gap = lost, the prune drops what was taken
//       and the fuse caps the rest; a queued fp marks the conviction reversed (fp count, n stays)
//   [3] rp / hd: an event when the tier contribution rises, quiet when it falls, again when it rises again
//   [4] size fuse: low-confidence accounts go first, convictions / sanctions / signature failures stay
//   [5] end to end over the REAL validate.js main(): a quick brawl of three whose records disagree (every writer flagged,
//       as before) + a seedcap conviction and a sanction queued by their producers -> trust.json counts them, the cursors
//       move, the mirror board gets one row per account the run can name (the sanctioned account no record names waits,
//       mw kept); the next run takes nothing twice
//   [6] seedcap.applyAudit queues one sc event per conviction (pid only); none for a vetoed seat nobody wrote
//   [7] wiring pins: the three reconcile workflows name + persist their trust file, the seedcap / sanctions jobs read it,
//       the trust upkeep runs the ledger on every exit path, the solo signature failure carries 'at'
//   [8] tools/trust-report.js (pure part)
//   [9] S2: the reject window reads n - fp (t1e = the latest conviction still standing); mutation (n) -> red
//   [10] S2: each verdict filed under its world core (head hash / exact core), the conviction context, per-core 24 h rate
//        alert (once a day), mail text, offense fp tail
//   [11] S2: replay on a new core -- candidates (14 days, other core, not replayed, records still there), reversal (fp,
//        window gone, n stays, veto stands, fp event -> ledger), negatives (still over / CLI error), main wiring
//   [12] S2 end to end over main(): an account whose only conviction was reversed settles again under SEEDCAP_REJECT
//   [13] S4: trust_tier row score = tier | 8 while the reject window is open; the bit clears (row rewritten / deleted)
//   [14] S4 end to end over main(): the bit is written, kept, cleared when the window passes; SHADOW_POOL=0 clears it at once;
//        no bit while SEEDCAP_REJECT is off
//   [15] S4: O285 (1) a new world core (72 h / 200 honest audits) vetoes but convicts nobody (no window, no offense, no
//        correction), records an observation (sev 0), mails once a day; past it the core convicts
const fs = require('fs'), path = require('path');
process.env.STATE_SALT = 's';
const TL = require(path.join(__dirname, '..', 'trust-ledger.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));
const sc = require(path.join(__dirname, '..', 'seedcap.js'));
const { runCron, advance, SID } = require('./lib/settle-stub.js');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); T(label + ' = ' + a, a === b, 'EXPECT ' + b); };
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

console.log('=== trust ledger (O198 v1, knife 5.5b-1) ===');
// ---- [1] units ----
{
  const L = TL.loadLedger(null);
  eq('[1] empty ledger shape', L, { v: 1, acct: {}, taken: {} });
  T('[1] a forgery flag counts', TL.recordEvent(L, 'p1', { t: 100, src: 'fl', sev: 1, m: 'k1' }) && L.acct.p1.n.fl === 1);
  T('[1] the same (source, key) again: nothing', TL.recordEvent(L, 'p1', { t: 101, src: 'fl', sev: 1, m: 'k1' }) === false && L.acct.p1.n.fl === 1 && L.acct.p1.ev.length === 1);
  T('[1] sev 0 is recorded, not counted', TL.recordEvent(L, 'p1', { t: 102, src: 'sc', sev: 0, m: 'k2', ctx: { obs: 1 } }) && L.acct.p1.n.sc === 0 && L.acct.p1.ev.length === 2);
  T('[1] tm is a slot only (not armed: O460 / Q199)', TL.recordEvent(L, 'p1', { t: 103, src: 'tm', sev: 1 }) === false && L.acct.p1.n.tm === 0);
  T('[1] unknown source: nothing', TL.recordEvent(L, 'p1', { t: 103, src: 'zz', sev: 1 }) === false);
  TL.recordEvent(L, 'p1', { t: 104, src: 'sc', sev: 3, m: 'k3', ctx: { cap: 10, s: 20 } });
  for (let i = 0; i < 40; i++) TL.recordEvent(L, 'p1', { t: 200 + i, src: 'fl', sev: 1, m: 'f' + i });
  const a = L.acct.p1;
  T('[1] 32 events kept, the conviction among them, counts lifetime', a.ev.length === TL.EV_CAP && a.ev.some((e) => e.s === 'sc' && e.m === 'k3') && a.n.fl === 41 && a.n.sc === 1, JSON.stringify(a.n));
  T('[1] last = the newest event, first = the oldest', a.last.t === 239 && a.last.src === 'fl' && a.first === 100);
  const det = TL.mirrorDetails(a);
  eq('[1] mirror details: magic 0xE4 | v1 << 8, counts, fp, last', det, [0xE4 | (1 << 8), 1, 0, 0, 41, 0, 0, 0, 0, 239, 4]);
  T('[1] mirror score = sc + sa', TL.mirrorScore(a) === 1 && TL.mirrorScore({ n: { sc: 2, sa: 3 } }) === 5);
  T('[1] mw set on change', a.mw === 1);
  T('[1] tierScore: tier | reject bit 8', TL.tierScore(2, false) === 2 && TL.tierScore(0, true) === 8 && TL.tierScore(3, true) === 11 && TL.tierScore(9, false) === 3 && TL.TRUST_REJ_BIT === 8);
  // source table: shadow only from sc, tm unarmed
  const shadow = Object.keys(TL.TRUST_SOURCES).filter((k) => TL.TRUST_SOURCES[k].shadow);
  eq('[1] TRUST_SOURCES: only sc feeds the shadow bit', shadow, ['sc']);
  eq('[1] TRUST_SOURCES: tier inputs as today (at / fl / rp / hd), sc / sa not', Object.keys(TL.TRUST_SOURCES).filter((k) => TL.TRUST_SOURCES[k].tier), ['at', 'fl', 'rp', 'hd']);
  T('[1] TRUST_SOURCES: tm not armed, all others armed', !TL.TRUST_SOURCES.tm.armed && Object.keys(TL.TRUST_SOURCES).filter((k) => k !== 'tm').every((k) => TL.TRUST_SOURCES[k].armed));
}

// ---- [2] producer queues ----
{
  const st = {};
  for (let i = 0; i < 3; i++) TL.queuePush(st, { t: 10 + i, src: 'sc', p: 'pq', sev: 3, m: 'q' + i });
  eq('[2] ids 1..3', st.events.map((e) => e.id), [1, 2, 3]);
  const L = TL.loadLedger({});
  const r1 = TL.takeQueue(L, 'seedcap', st.events);
  T('[2] taken once: 3, cursor 3, counted', r1.took === 3 && L.taken.seedcap === 3 && L.acct.pq.n.sc === 3 && r1.lost === 0);
  const r2 = TL.takeQueue(L, 'seedcap', st.events);
  T('[2] taken again: nothing (cursor)', r2.took === 0 && !r2.changed && L.acct.pq.n.sc === 3);
  const pr = TL.queuePrune(st, L.taken.seedcap);
  T('[2] prune drops what was taken (queue gone)', pr.taken === 3 && !st.events);
  TL.queuePush(st, { t: 20, src: 'sc', p: 'pq', sev: 3, m: 'q9' });   // id 4
  st.events.push({ id: 6, t: 21, src: 'sc', p: 'pq', sev: 3, m: 'q10' });   // id 5 lost to a fuse
  const r3 = TL.takeQueue(L, 'seedcap', st.events);
  T('[2] a gap in the ids is counted lost', r3.took === 2 && r3.lost === 1 && L.taken.seedcap === 6, JSON.stringify(r3));
  // fp marker
  const r4 = TL.takeQueue(L, 'seedcap', [{ id: 7, t: 30, src: 'sc', p: 'pq', m: 'q9', fp: 1 }]);
  const e = L.acct.pq.ev.find((x) => x.m === 'q9');
  T('[2] a queued fp marks that conviction reversed: fp 1, n stays', r4.changed && e.fp === 'replay' && L.acct.pq.fp === 1 && L.acct.pq.n.sc === 5, JSON.stringify(L.acct.pq));
  T('[2] the same fp again: no second count', TL.markFalsePositive(L, 'pq', 'q9', 31) === false && L.acct.pq.fp === 1);
  T('[2] fp for a conviction no longer kept: counted, a marker kept', TL.markFalsePositive(L, 'pq', 'gone', 32, 'review') && L.acct.pq.fp === 2 && L.acct.pq.ev.some((x) => x.m === 'gone' && x.fp === 'review'));
  // fuse
  const big = {}; for (let i = 0; i < TL.QUEUE_CAP + 5; i++) TL.queuePush(big, { t: i, src: 'sa', p: 'x', sev: 3 });
  const pf = TL.queuePrune(big, 0);
  T('[2] queue fuse keeps the newest QUEUE_CAP', pf.fused === 5 && big.events.length === TL.QUEUE_CAP && big.events[0].id === 6);
  T('[2] unreadable cursor (undefined) keeps everything', TL.queuePrune({ events: [{ id: 1 }] }, undefined).taken === 0);
}

// ---- [3] rp / hd rises ----
{
  const L = TL.loadLedger({});
  const Tt = v.TRUST_T;
  T('[3] below the floor: nothing', TL.noteLevels(L, 'pr', 1, { vur: Tt.VUR1 - 1, hd: 0 }, Tt) === false && !L.acct.pr);
  T('[3] reports cross floor 1: one rp event sev 1', TL.noteLevels(L, 'pr', 2, { vur: Tt.VUR1, hd: 0 }, Tt) && L.acct.pr.n.rp === 1 && L.acct.pr.lv.rp === 1);
  T('[3] still at level 1: nothing new', TL.noteLevels(L, 'pr', 3, { vur: Tt.VUR1 + 1, hd: 0 }, Tt) === false && L.acct.pr.n.rp === 1);
  T('[3] floor 2: a second event (sev 2)', TL.noteLevels(L, 'pr', 4, { vur: Tt.VUR2, hd: 0 }, Tt) && L.acct.pr.n.rp === 2 && L.acct.pr.ev.slice(-1)[0].v === 2);
  T('[3] decays to 0: quiet, level forgotten', TL.noteLevels(L, 'pr', 5, { vur: 0, hd: 0 }, Tt) && !L.acct.pr.lv && L.acct.pr.n.rp === 2);
  T('[3] rises again: counted again', TL.noteLevels(L, 'pr', 6, { vur: Tt.VUR1, hd: 0 }, Tt) && L.acct.pr.n.rp === 3);
  T('[3] host charges likewise', TL.noteLevels(L, 'pr', 7, { vur: Tt.VUR1, hd: Tt.HD1 }, Tt) && L.acct.pr.n.hd === 1);
}

// ---- [4] size fuse ----
{
  const L = TL.loadLedger({});
  for (let i = 0; i < TL.ACCT_CAP + 3; i++) TL.recordEvent(L, 'f' + i, { t: 1000 + i, src: 'fl', sev: 1, m: 'm' + i });
  TL.recordEvent(L, 'conv', { t: 1, src: 'sc', sev: 3, m: 'old' });   // the oldest of all, but a conviction
  const n = TL.pruneLedger(L);
  T('[4] fuse evicts the oldest low-confidence accounts only', n === 4 && Object.keys(L.acct).length === TL.ACCT_CAP && !!L.acct.conv && !L.acct.f0 && !!L.acct['f' + (TL.ACCT_CAP + 2)], 'n=' + n);
}

// ---- [5] end to end ----
{
  const MIN = 60000;
  const H = SID(5501), J = SID(5502), X = SID(5503), Y = SID(5504);
  const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const rec = (magic, mt, hash, seat, rank, win, ros, sc3) => {
    const start = magic === 0xB2, pc = ros.length;
    const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
    for (let i = 0; i < pc; i++) d.push(start ? 0 : sc3[i] | 0);
    d.push(0);
    for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
    return d;
  };
  const ros = [H, J, X], hsh = 0x5501;
  const st = ros.map((sid, i) => ({ sid, d: rec(0xB2, 1, hsh, i, 0, false, ros) }));
  const re = [{ sid: H, d: rec(0xB1, 1, hsh, 0, 1, true, ros, [7000, 4000, 1000]) }, { sid: J, d: rec(0xB1, 1, hsh, 1, 1, true, ros, [4000, 7000, 1000]) },
    { sid: X, d: rec(0xB1, 1, hsh, 2, 3, false, ros, [4000, 7000, 1000]) }];
  const boardsWith = (recs) => {
    const b = [];
    for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    const used = {};
    for (const r of recs) { used[r.sid] = used[r.sid] || 0; b[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
    b.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: ros.map((s) => ({ steamID: s, score: 2500 })) },
      { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }, { id: 11, name: 'trust_ledger', entries: [] });
    return b;
  };
  const nowM = Math.floor(Date.now() / 60000);
  const scFile = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [], evSeq: 1,
    events: [{ id: 1, t: nowM - 5, src: 'sc', p: v.pid(X), sev: 3, m: 'mkx', ctx: { cap: 100, s: 900 } }] };
  const snFile = { lastLogId: 'abc', boards: {}, evSeq: 5, events: [{ id: 5, t: nowM - 3, src: 'sa', p: v.pid(Y), sev: 3, ctx: { a: 1, x: 0 } }] };
  const r1 = runCron(boardsWith(st), { SC_STATE_FILE: scFile, SN_STATE_FILE: snFile }, null, null, 'trust-ledger');
  const r2 = runCron(boardsWith(st.concat(re)), Object.assign(advance(r1.state, 10 * MIN), { SC_STATE_FILE: scFile, SN_STATE_FILE: snFile }), null, null, 'trust-ledger');
  const r3 = runCron(boardsWith(st.concat(re)), Object.assign(advance(r2.state, 10 * MIN), { SC_STATE_FILE: scFile, SN_STATE_FILE: snFile }), null, null, 'trust-ledger');
  const L1 = r1.state.TRUST_FILE || {}, L3 = r3.state.TRUST_FILE || {};
  T('[5] runs ok', [r1, r2, r3].every((r) => r.code === 0), [r1, r2, r3].map((r) => r.code + ' ' + r.out.slice(-800)).join(' || '));
  T('[5] run 1 takes both queues (cursors 1 / 5)', L1.taken && L1.taken.seedcap === 1 && L1.taken.sanctions === 5, JSON.stringify(L1.taken));
  T('[5] the conviction and the sanction are counted on their pids', ((L1.acct || {})[v.pid(X)] || {}).n && L1.acct[v.pid(X)].n.sc === 1 && L1.acct[v.pid(Y)].n.sa === 1, JSON.stringify(L1.acct));
  const fl = [H, J, X].map((s) => (((L3.acct || {})[v.pid(s)] || {}).n || {}).fl | 0);
  eq('[5] the disagreeing brawl: every writer has one fl event (as their f)', fl, [1, 1, 1]);
  const fs3 = [H, J, X].map((s) => ((((r3.state.SIGNALS_FILE || {}).players || {})[v.pid(s)]) || {}).f | 0);
  eq('[5] ... and f itself unchanged (one each)', fs3, [1, 1, 1]);
  T('[5] the next run takes nothing twice (counts stay)', L3.acct[v.pid(X)].n.sc === 1 && L3.acct[v.pid(Y)].n.sa === 1 && L3.taken.seedcap === 1 && L3.taken.sanctions === 5);
  const ledPosts = [r1, r2, r3].flatMap((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && /leaderboardid=11(&|$)/.test(p.body)));
  const of = (sid) => ledPosts.filter((p) => new RegExp('steamid=' + sid + '(&|$)').test(p.body));
  const { postDetails } = require('./lib/settle-stub.js');
  const xd = of(X).map((p) => postDetails(p.body)).pop() || [];
  T('[5] mirror rows for the named accounts (H J X), X carries sc 1 + fl 1', of(H).length >= 1 && of(J).length >= 1 && of(X).length >= 1 && xd[0] === (0xE4 | 256) && xd[1] === 1 && xd[4] === 1, JSON.stringify(xd));
  T('[5] the mirror score of X = sc + sa = 1', of(X).length && /score=1(&|$)/.test(of(X).slice(-1)[0].body));
  T('[5] no row for the sanctioned account no record names (sid unknown): mw kept for a later run', of(Y).length === 0 && L3.acct[v.pid(Y)].mw === 1);
  T('[5] mirror rows written are marked done (mw cleared)', !L3.acct[v.pid(H)].mw && !L3.acct[v.pid(X)].mw);
  T('[5] the ledger names no SteamID', [H, J, X, Y].every((s) => JSON.stringify(L3).indexOf(s) < 0));
  T('[5] run summary row', /trust ledger events taken/.test(r1.summary));
}

// ---- [6] seedcap queues ----
{
  const SIDA = SID(5601), SIDB = SID(5602);
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const pend = [{ m: 'w1', mt: 1, pc: 2, scores: [9999, 7777], p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [1], runSeed: 21 }];
  sc.applyAudit(st, pend, { m0: { cap: 5000 } }, new Set(), 3000);
  const evs = st.events || [];
  T('[6] one sc event, for the self-written over-cap seat only (seat 0 is vetoed, nobody wrote it)', evs.length === 1 && evs[0].p === v.pid(SIDB) && evs[0].src === 'sc' && evs[0].sev === 3 && evs[0].m === 'w1' && evs[0].id === 1, JSON.stringify(evs));
  T('[6] the queue names no SteamID', JSON.stringify(st.events).indexOf(SIDA) < 0 && JSON.stringify(st.events).indexOf(SIDB) < 0);
  T('[6] context: cap / score / prior count', evs[0].ctx && evs[0].ctx.cap === 5000 && evs[0].ctx.s === 7777 && evs[0].ctx.nb === 0, JSON.stringify(evs[0].ctx));
}

// ---- [7] wiring pins ----
{
  const VJ = read('validate.js');
  for (const [wf, pre] of [['validate.yml', ''], ['playtest.yml', 'pt-'], ['demo.yml', 'demo-']]) {
    const y = read('.github/workflows/' + wf);
    T('[7] ' + wf + ': TRUST_FILE ' + pre + 'trust.json + SN_STATE_FILE ' + pre + 'sanctions.json', y.indexOf('TRUST_FILE: ' + pre + 'trust.json') >= 0 && y.indexOf('SN_STATE_FILE: ' + pre + 'sanctions.json') >= 0);
    T('[7] ' + wf + ': persists ' + pre + 'trust.json', new RegExp('for f in [^;]*\\b' + pre + 'trust\\.json[^;]*; do').test(y));
  }
  for (const wf of ['seedcap.yml', 'sanctions.yml']) {
    const y = read('.github/workflows/' + wf);
    T('[7] ' + wf + ': every job reads its channel trust file', ['TRUST_FILE: trust.json', 'TRUST_FILE: pt-trust.json', 'TRUST_FILE: demo-trust.json'].every((x) => y.indexOf(x) >= 0));
  }
  T('[7] maintainTrust = ledger begin + board + ledger end (finally), the ledger fail-open', /const maintainTrust = async \(\) => \{\s*let led = null;\s*try \{ led = trustLedgerBegin\(\); \} catch \(e\) \{ ghWarn\([^\n]*\n\s*try \{ await maintainTrustBoard\(led\); \} finally \{ if \(led\) \{ try \{ await trustLedgerEnd\(led\); \} catch \(e\) \{ ghWarn\(/.test(VJ));
  T('[7] maintainTrust on every exit path (2 quiet + main)', (VJ.match(/await maintainTrust\(\);/g) || []).length === 3);
  T('[7] the solo signature failure carries the at source', /recordFlag\(signals, c\.g, m, nowMs, 'at'\)/.test(VJ));
  T('[7] every flag reaches the run event list (flagPlayer pushes TRUST_RUN_EV)', /p\.fm\[m\] = now; p\.fx = p\.f;\s*capFlagKeys\(p\);\s*TRUST_RUN_EV\.push\(/.test(VJ));
  T('[7] the ledger file is written through writeStateFile (persisted twins)', /writeStateFile\(TRUST_FILE,/.test(VJ));
  T('[7] mirror board friends-only reads (findOrCreateBoard trusted + friends)', /findOrCreateBoard\(TRUST_LEDGER_LB, true, true\)/.test(VJ));
  const SJ = read('seedcap.js'), NJ = read('sanctions.js');
  T('[7] seedcap prunes its queue by the ledger cursor before saving', /trustLedger\.queuePrune\(st, tl && tl\.taken && tl\.taken\.seedcap\);[\s\S]{0,300}saveState\(st\);/.test(SJ));
  T('[7] sanctions queues on ban and unban, prunes by its cursor', (NJ.match(/trustLedger\.queuePush\(st, \{ t: nowM, src: 'sa'/g) || []).length === 2 && /queuePrune\(st, tl && tl\.taken && tl\.taken\.sanctions\)/.test(NJ));
}

// ---- [8] report tool ----
{
  const rep = require(path.join(ROOT, 'tools', 'trust-report.js'));
  const L = TL.loadLedger({});
  TL.recordEvent(L, 'a', { t: 29000000, src: 'sc', sev: 3, m: 'k', ctx: { k: 'c1' } });
  TL.recordEvent(L, 'b', { t: 29000000, src: 'sc', sev: 0, m: 'o', ctx: { k: 'c2', obs: 1 } });
  TL.markFalsePositive(L, 'a', 'k', 29000001);
  const r = rep.report(L, { suspects: { a: { n: 1, t0: 29000000, t1: 29000000 } } }, 29000060);
  T('[8] per core: c1 one conviction reversed, c2 one observation', r.byCore.c1 && r.byCore.c1.convictions === 1 && r.byCore.c1.reversed === 1 && r.byCore.c2.observed === 1, JSON.stringify(r.byCore));
  T('[8] open window counted with its length', r.windows.open === 1 && r.windows.avgWindowH === 24 && r.windows.avgLeftH === 23, JSON.stringify(r.windows));
}

// ---- [9] S2: the reject window reads the effective count n - fp ----
{
  const su = (o) => Object.assign({ n: 2, t0: 1000, t1: 5000, ms: ['a', 'b'], cv: [['a', 1000], ['b', 5000]] }, o);
  T('[9] no fp: window by n (2 -> 3 days from t1)', v.seedcapRejectUntilMin(su({})) === 5000 + 3 * 1440 && v.seedcapNEff(su({})) === 2);
  T('[9] one reversed (the latest): nEff 1, the window from the conviction still standing (t1e) for 24 h', v.seedcapNEff(su({ fp: 1, fpm: ['b'], t1e: 1000 })) === 1 && v.seedcapRejectUntilMin(su({ fp: 1, fpm: ['b'], t1e: 1000 })) === 1000 + 1440);
  T('[9] every conviction reversed: no window at all', v.seedcapNEff(su({ fp: 2 })) === 0 && !v.seedcapRejectActive(su({ fp: 2 }), 5001));
  T('[9] a legacy entry (no fp, no t1e) reads exactly as before', v.seedcapRejectUntilMin({ n: 1, t0: 100 }) === 100 + 1440 && v.seedcapRejectUntilMin({ n: 3, t0: 1, t1: 200 }) === 200 + 7 * 1440);
  T('[9] standingT1: the newest conviction not reversed; none kept -> t0', sc.standingT1(su({ fpm: ['b'] })) === 1000 && sc.standingT1(su({ fpm: ['a', 'b'] })) === 1000 && sc.standingT1({ n: 1, t0: 77, cv: [['x', 900]], fpm: ['x'] }) === 77);
  // mutation self-check: the window counting n instead of n - fp keeps a fully reversed account in the window
  const src = read('validate.js');
  const mut = src.replace('const nEff = seedcapNEff(su);', 'const nEff = su.n | 0;');
  T('[9] mutation applies', mut !== src);
  const mf = path.join(ROOT, '.mutant-trust-ledger-' + process.pid + '.js');
  try {
    fs.writeFileSync(mf, mut);
    const vm = require(mf);
    T('[9] mutant (n, not n - fp): the reversed account stays in a window -> the case above would go red', vm.seedcapRejectActive(su({ fp: 2 }), 5001) === true);
  } finally { try { fs.unlinkSync(mf); } catch (e) {} }
}

// ---- [10] S2: every verdict filed under its world core; the conviction carries its context; per-core rate alert ----
{
  const SIDA = SID(5701), SIDB = SID(5702);
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const t = 600000;
  const mk = (m, scores, self) => ({ m, mt: 1, pc: 2, scores, p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self, runSeed: 7, w: 2 });
  const pend = [mk('c1', [100, 6000], [0, 1]), mk('c2', [100, 200], [0, 1]), mk('c3', [100, 200], [0, 1]), mk('c4', [100, 200], [0, 1])];
  const map = { m0: { cap: 5000 }, m1: { cap: 5000 }, m2: { cap: 5000 }, m3: { cap: 5000, via: 'exact:eeeeeeeeeeee' } };
  sc.applyAudit(st, pend, map, new Set(), t, { primary: 'aaaaaaaaaaaa' });
  T('[10] audited carries the answering core (primary / exact)', st.audited.c1.k === 'aaaaaaaaaaaa' && st.audited.c4.k === 'eeeeeeeeeeee', JSON.stringify(st.audited));
  const ev = (st.events || [])[0] || {};
  const c = ev.ctx || {};
  T('[10] conviction context: core / cap / score / over / ratio / writers / same-core run share / prior count', c.k === 'aaaaaaaaaaaa' && c.cap === 5000 && c.s === 6000 && c.over === 1000 && c.ratio === 200 && c.w === 2 && c.r === 333 && c.nb === 0 && c.ov === 0, JSON.stringify(c));
  T('[10] the suspect keeps the conviction time (cv) and t1e', st.suspects[v.pid(SIDB)].cv[0][0] === 'c1' && st.suspects[v.pid(SIDB)].t1e === t);
  T('[10] per-core stats: primary 3 audits / 1 over, exact 1 / 0', st.cores.aaaaaaaaaaaa.n === 3 && st.cores.aaaaaaaaaaaa.o === 1 && st.cores.eeeeeeeeeeee.n === 1 && st.cores.eeeeeeeeeeee.o === 0);
  eq('[10] 24 h rate of the primary', sc.coreRate24(st, 'aaaaaaaaaaaa', t + 10), [3, 1]);
  T('[10] one over-cap is below the alert floor (needs >= ' + sc.SC_RATE_MIN_OVER + ' over and >= ' + sc.SC_RATE_PERMIL / 10 + '%)', sc.coreAlerts(st, t + 10).length === 0);
  // a wave on one core: 3 more over of 40 audits within the day
  const wave = [];
  for (let i = 0; i < 40; i++) wave.push(mk('w' + i, [100, i < 3 ? 9000 : 10], [0]));
  const wmap = {}; wave.forEach((x, i) => { wmap['m' + i] = { cap: 5000 }; });
  sc.applyAudit(st, wave, wmap, new Set(), t + 60, { primary: 'aaaaaaaaaaaa' });
  const al = sc.coreAlerts(st, t + 70);
  T('[10] 4 over of 43 on one core in 24 h (9.3%) -> one alert for that core', al.length === 1 && al[0].k === 'aaaaaaaaaaaa' && al[0].o === 4 && al[0].a === 43, JSON.stringify(al));
  st.cores.aaaaaaaaaaaa.md = Math.floor((t + 70) / 1440);
  T('[10] mailed today -> no second alert today', sc.coreAlerts(st, t + 80).length === 0);
  T('[10] the 24 h window rolls off', sc.coreRate24(st, 'aaaaaaaaaaaa', t + 25 * 60)[0] === 0);
  const md = sc.mailDecision(0, 0, 0, ['core x over-cap 4/43 in 24h']);
  T('[10] an extra reason alone sends the mail', md.send && md.reasons[0] === 'core x over-cap 4/43 in 24h');
  const txt = sc.alertMailText(md.reasons, [], { veto: 0, suspects: 0 }, [], { cores: al, reversed: [{ m: 'r1', k0: 'old', k1: 'new', cap0: 10, cap1: 20, score: 15, pid: 'abcdef0123456789' }] });
  T('[10] mail text: the core rate line and the reversal line', /CORE aaaaaaaaaaaa: 4 of 43 audits over the cap in 24 h/.test(txt) && /REVERSED m=r1 core old -> new cap 10 -> 20 score 15 pid abcdef01/.test(txt), txt.slice(0, 400));
  T('[10] offense details carry fp (7th int)', sc.offensePlanOf({ suspects: { [v.pid(SIDB)]: { n: 3, fp: 1 } } }, [{ t: 1, runSeed: 2, mt: 1, cap: 5, offenders: [{ sid: SIDB, score: 9 }] }])[SIDB].details[6] === 1);
  T('[10] head hash parse', sc.headHashOf('SEEDCAP 08f46e52a393') === '08f46e52a393' && sc.headHashOf('') === null && sc.coreHashOf(null, () => ({ head: 'SEEDCAP abcdefabcdef', map: {} })) === 'abcdefabcdef');
}

// ---- [11] S2: automatic reversal on a new world core ----
{
  const SIDA = SID(5801), SIDB = SID(5802);
  const mk = (m, scores) => ({ m, mt: 1, pc: 2, scores, p: { entry: 'quick' }, tail: null, roster: { 0: SIDA, 1: SIDB }, self: [1], runSeed: 9, w: 2 });
  const fresh = () => {
    const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
    sc.applyAudit(st, [mk('r1', [10, 6000])], { m0: { cap: 5000 } }, new Set(), 100000, { primary: 'oldcoreoldco' });
    return st;
  };
  const st = fresh();
  const pB = v.pid(SIDB);
  T('[11] baseline: convicted, window open', st.suspects[pB].n === 1 && v.seedcapRejectActive(st.suspects[pB], 100001));
  const groups = { r1: [{ d: [0xB1], w: SIDB }] };
  eq('[11] candidates on a new core: r1', sc.replayCandidates(st, groups, 'newcorenewco', 100100).ms, ['r1']);
  eq('[11] no candidate on the same core', sc.replayCandidates(st, groups, 'oldcoreoldco', 100100).ms, []);
  eq('[11] no candidate past ' + sc.REPLAY_DAYS + ' days', sc.replayCandidates(st, groups, 'newcorenewco', 100000 + sc.REPLAY_DAYS * 1440 + 1).ms, []);
  eq('[11] records gone from the shards: listed gone, not replayed', sc.replayCandidates(st, {}, 'newcorenewco', 100100), { ms: [], gone: ['r1'] });
  const ev0 = (st.events || []).length;
  const out = sc.applyReplay(st, [mk('r1', [10, 6000])], { m0: { cap: 7000 } }, 'newcorenewco', 100100);
  T('[11] the new cap covers the score -> reversed: fp 1, nEff 0, window gone, n stays 1', out.reversed.length === 1 && st.suspects[pB].fp === 1 && st.suspects[pB].n === 1 && v.seedcapNEff(st.suspects[pB]) === 0 && !v.seedcapRejectActive(st.suspects[pB], 100101), JSON.stringify(st.suspects[pB]));
  const fpEv = (st.events || [])[ev0] || {};
  T('[11] an fp event queued for the ledger (pid only)', fpEv.fp === 1 && fpEv.p === pB && fpEv.m === 'r1' && fpEv.ctx.k0 === 'oldcoreoldco' && fpEv.ctx.k1 === 'newcorenewco' && JSON.stringify(st.events).indexOf(SIDB) < 0, JSON.stringify(fpEv));
  T('[11] marked replayed on the new core (no second replay)', st.audited.r1.rk === 'newcorenewco' && sc.replayCandidates(st, groups, 'newcorenewco', 100200).ms.length === 0);
  T('[11] the veto is not lifted', !!(st.veto && st.veto.r1));
  T('[11] a second replay of the same conviction cannot count twice', sc.applyReplay(st, [mk('r1', [10, 6000])], { m0: { cap: 9000 } }, 'thirdcorethi', 100300).reversed.length === 0 && st.suspects[pB].fp === 1);
  // the ledger reads the fp event
  const L = TL.loadLedger({});
  TL.takeQueue(L, 'seedcap', st.events);
  T('[11] ledger: the conviction marked replay, fp 1, n.sc stays 1', L.acct[pB].n.sc === 1 && L.acct[pB].fp === 1 && L.acct[pB].ev.some((e) => e.m === 'r1' && e.fp === 'replay'), JSON.stringify(L.acct[pB]));
  // negative: the new cap still below the score
  const st2 = fresh();
  const o2 = sc.applyReplay(st2, [mk('r1', [10, 6000])], { m0: { cap: 5500 } }, 'newcorenewco', 100100);
  T('[11] new core still caps below the score: nothing reversed, the window stays', o2.reversed.length === 0 && o2.still === 1 && v.seedcapRejectActive(st2.suspects[pB], 100101) && st2.audited.r1.rk === 'newcorenewco');
  // an error answer: marked (the same core answers the same), nothing reversed
  const st3 = fresh();
  const o3 = sc.applyReplay(st3, [mk('r1', [10, 6000])], { m0: { err: 'x' } }, 'newcorenewco', 100100);
  T('[11] a CLI error on replay reverses nothing', o3.reversed.length === 0 && v.seedcapRejectActive(st3.suspects[pB], 100101));
  // wiring: main replays after the audit, with the run's cores, and mails the reversals
  const SJ = read('seedcap.js');
  T('[11] main: replay candidates on the primary core, re-audited through auditPending, applied by applyReplay', /replayCandidates\(st, groups, primaryHash, nowMin\(\)\)/.test(SJ) && /const ra = auditPending\(items, \{ cores, live: cf\.live, channel: SEEDCAP_CHANNEL, distDir: SEEDCAP_DIST_DIR \}\);/.test(SJ) && /rp = applyReplay\(st, ra\.pending, ra\.map, primaryHash, nowMin\(\)\);/.test(SJ));
  T('[11] main: the primary core is named by its head hash', /const primaryHash = coreHashOf\(cores\[0\]\.exe\) \|\| cores\[0\]\.label;/.test(SJ));
}

// ---- [12] S2 end to end: a fully reversed account settles again (SEEDCAP_REJECT on) ----
{
  const { rec: srec, keyOf } = require('./lib/settle-stub.js');
  const A = SID(5901), B = SID(5902), C = SID(5903), ros = [A, B, C];
  const h = 0x5901, scs = [3000, 6000, 9000];
  const recs = ros.map((sid, i) => ({ sid, d: srec(0xB1, 2, h, i, 3 - i, i === 2, ros, scs) }));
  const boards = () => {
    const b = [];
    for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    for (const r of recs) b[0].entries.push({ steamID: r.sid, score: 1, details: r.d });
    b.push({ id: 5, name: 'progress', entries: ros.map((s) => ({ steamID: s, score: 1000 })) }, { id: 6, name: 'rating', entries: [] },
      { id: 7, name: 'points', entries: ros.map((s) => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] });
    return b;
  };
  const pointsOf = (r, sid) => { const w = r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && /leaderboardid=7(&|$)/.test(p.body) && new RegExp('steamid=' + sid + '(&|$)').test(p.body)); return w.length ? Number(/score=(-?[0-9]+)/.exec(w[w.length - 1].body)[1]) : null; };
  const nowM = Math.floor(Date.now() / 60000);
  const two = (su) => {
    const files = { SC_STATE_FILE: { suspects: { [v.pid(C)]: su } } };
    const r1 = runCron(boards(), files, { SEEDCAP_REJECT: '1' }, null, 'trust-ledger-12');
    return runCron(boards(), Object.assign(advance(r1.state, v.SANITY.MIN_START_AGE_MS + 1000), files), { SEEDCAP_REJECT: '1' }, null, 'trust-ledger-12');
  };
  const open = two({ n: 1, t0: nowM, t1: nowM, ms: ['x'] });
  const rev = two({ n: 1, t0: nowM, t1: nowM, ms: ['x'], fp: 1, fpm: ['x'] });
  const m = keyOf(recs[0].d);
  T('[12] runs ok + the match settles both times', open.code === 0 && rev.code === 0 && (open.state.PROCESSED_FILE || []).indexOf(m) >= 0 && (rev.state.PROCESSED_FILE || []).indexOf(m) >= 0, open.out.slice(-600) + rev.out.slice(-600));
  T('[12] window open (n 1): C (the winner) gets no points', pointsOf(open, C) == null && pointsOf(open, A) != null && /inside reject window/.test(open.out));
  T('[12] the same conviction reversed (fp 1): C settles like everyone else', pointsOf(rev, C) != null && pointsOf(rev, C) > 2500 && !/inside reject window/.test(rev.out), JSON.stringify([A, B, C].map((s) => pointsOf(rev, s))));
}

// ---- [13] S4: the shadow-pool bit on trust_tier rows ----
{
  const T0 = 1000000;
  const sig = { players: {}, rep: {}, pairs: {} };
  const S1 = SID(6001), S2 = SID(6002), S3 = SID(6003);
  const rejSet = new Set([S1, S3]);
  const plan = v.trustPlan(sig, { [S2]: 8, [S3]: 8 }, new Set([S1]), T0, { rejOf: (sid) => rejSet.has(sid) });
  eq('[13] tier 0 + open window -> row score 8 (written once, marked rej); a row already at 8 untouched', plan.writes, [{ sid: S1, tier: 8, rej: true }]);
  eq('[13] a row whose window closed (tier 0, no bit) is deleted', plan.deletes, [S2]);
  const plan2 = v.trustPlan(sig, { [S1]: 8 }, new Set(), T0);
  eq('[13] no rejOf (switch off / SEEDCAP_REJECT off): the bit clears -> row deleted', [plan2.writes, plan2.deletes], [[], [S1]]);
  T('[13] the lockstep constant', v.TRUST_REJ_BIT === 8 && TL.TRUST_REJ_BIT === 8);
  // a tier-1 account in a window: score 9; the bit goes, the tier stays (score 1)
  const sigF = { players: { [v.pid(S1)]: { f: 3, fx: 3, fm: { a: T0, b: T0, c: T0 }, at: T0 } }, rep: {}, pairs: {} };
  eq('[13] tier 1 + window -> 9', v.trustPlan(sigF, {}, new Set([S1]), T0, { rejOf: () => true }).writes, [{ sid: S1, tier: 9, rej: true }]);
  eq('[13] window closes -> back to 1 (rewritten, not deleted)', v.trustPlan(sigF, { [S1]: 9 }, new Set(), T0, { rejOf: () => false }).writes, [{ sid: S1, tier: 1 }]);
  const VJ = read('validate.js');
  T('[13] the bit is judged only while SEEDCAP_REJECT judges windows and SHADOW_POOL is on, by the window itself (n - fp)', /const scSus = \(SEEDCAP_REJECT && SHADOW_POOL && led && led\.sc && led\.sc\.suspects\) \|\| null;/.test(VJ) && /const rejOf = \(sid\) => !!\(scSus && seedcapRejectActive\(scSus\[pid\(sid\)\], tLedT\)\);/.test(VJ));
  T('[13] SHADOW_POOL defaults on (only an explicit 0 turns it off)', /const SHADOW_POOL = process\.env\.SHADOW_POOL !== '0';/.test(VJ));
}

// ---- [14] S4 end to end: the bit appears on the row, then goes ----
{
  const { rec: srec, keyOf } = require('./lib/settle-stub.js');
  const A = SID(6101), B = SID(6102), C = SID(6103), ros = [A, B, C];
  const h = 0x6101, scs = [3000, 6000, 9000];
  const recs = ros.map((sid, i) => ({ sid, d: srec(0xB1, 2, h, i, 3 - i, i === 2, ros, scs) }));
  const boards = (trust) => {
    const b = [];
    for (let i = 0; i < 50; i++) b.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
    for (const r of recs) b[0].entries.push({ steamID: r.sid, score: 1, details: r.d });
    b.push({ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
      { id: 7, name: 'points', entries: ros.map((s) => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] },
      { id: 9, name: 'trust_tier', entries: trust || [] });
    return b;
  };
  const trustPosts = (r) => r.posts.filter((p) => /leaderboardid=9(&|$)/.test(p.body)).map((p) => ({ op: /Delete/.test(p.url) ? 'del' : 'set', sid: (/steamid=([0-9]+)/.exec(p.body) || [])[1], score: Number((/score=(-?[0-9]+)/.exec(p.body) || [])[1]) }));
  const nowM = Math.floor(Date.now() / 60000);
  const susOpen = { suspects: { [v.pid(C)]: { n: 1, t0: nowM, t1: nowM, ms: ['x'] } } };
  const susOld = { suspects: { [v.pid(C)]: { n: 1, t0: nowM - 3000, t1: nowM - 3000, ms: ['x'] } } };
  const r1 = runCron(boards(), { SC_STATE_FILE: susOpen }, { SEEDCAP_REJECT: '1' }, null, 'trust-ledger-14');
  eq('[14] an open window: C\'s trust_tier row is written with score 8 (tier 0 | the bit)', trustPosts(r1), [{ op: 'set', sid: C, score: 8 }]);
  T('[14] summary counts the shadow-pool row', /shadow pool \(reject-window bit on trust_tier\) rows \/ suspects not nameable this run \| 1 \/ 0/.test(r1.summary), r1.summary.split('\n').filter((l) => /shadow/.test(l)).join(' | '));
  const r2 = runCron(boards([{ steamID: C, score: 8 }]), Object.assign(advance(r1.state, 60000), { SC_STATE_FILE: susOpen }), { SEEDCAP_REJECT: '1' }, null, 'trust-ledger-14');
  eq('[14] still open: no rewrite', trustPosts(r2), []);
  const r3 = runCron(boards([{ steamID: C, score: 8 }]), Object.assign(advance(r2.state, 60000), { SC_STATE_FILE: susOld }), { SEEDCAP_REJECT: '1' }, null, 'trust-ledger-14');
  T('[14] the window passed (the conviction 50 h ago, a 24 h window): the row goes', trustPosts(r3).length === 1 && trustPosts(r3)[0].op === 'del' && trustPosts(r3)[0].sid === C, JSON.stringify(trustPosts(r3)));
  const r4 = runCron(boards([{ steamID: C, score: 8 }]), Object.assign(advance(r2.state, 60000), { SC_STATE_FILE: susOpen }), { SEEDCAP_REJECT: '1', SHADOW_POOL: '0' }, null, 'trust-ledger-14');
  T('[14] the remote switch SHADOW_POOL=0 clears the bit at once (row deleted, window still open)', trustPosts(r4).length === 1 && trustPosts(r4)[0].op === 'del' && trustPosts(r4)[0].sid === C, JSON.stringify(trustPosts(r4)));
  const r5 = runCron(boards(), { SC_STATE_FILE: susOpen }, null, null, 'trust-ledger-14');
  eq('[14] SEEDCAP_REJECT off (no windows judged): no bit', trustPosts(r5), []);
}

// ---- [15] S4: O285 (1) a new world core convicts nobody for its first 72 h / 200 honest audits ----
{
  const SIDA = SID(6201), SIDB = SID(6202);
  const tNow = 29000000;
  const live = { v: 1, channels: { demo: [
    { buildNum: 1, core: 'oldcoreoldco', liveAt: new Date((tNow - 10 * 1440) * 60000).toISOString(), gateAt: null },
    { buildNum: 2, core: 'newcorenewco', liveAt: new Date((tNow - 60) * 60000).toISOString(), gateAt: null },
  ] } };
  const st = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const obsOf = sc.observationOf(st, live, 'demo', tNow);
  T('[15] a core live for 1 h is in observation; one live for 10 days is not', obsOf('newcorenewco') === true && obsOf('oldcoreoldco') === false);
  T('[15] a core never seen (no window, no verdict yet) is in observation', obsOf('nevernevern1') === true);
  T('[15] first seen = the earliest window naming it (minutes)', sc.coreFirstSeen(st, live, 'demo', 'oldcoreoldco') === tNow - 10 * 1440);
  const mk = (m) => ({ m, mt: 7, pc: 1, scores: [9000], p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 3 }, roster: { 0: SIDB }, self: [0], runSeed: 3, w: 1 });
  const processed = new Set(['o1']);
  const out = sc.applyAudit(st, [mk('o1')], { m0: { cap: 5000 } }, processed, tNow, { primary: 'newcorenewco', obsOf });
  T('[15] observed over-cap: vetoed, nobody convicted, no correction, no offense', !!st.veto.o1 && !st.suspects[v.pid(SIDB)] && st.corrections.length === 0 && Object.keys(sc.offensePlanOf(st, out.flags)).length === 0, JSON.stringify({ sus: st.suspects, cor: st.corrections }));
  const ev = (st.events || [])[0] || {};
  T('[15] the ledger gets an observation record (sev 0, obs, the core)', ev.src === 'sc' && ev.sev === 0 && ev.ctx.obs === 1 && ev.ctx.k === 'newcorenewco' && ev.p === v.pid(SIDB), JSON.stringify(ev));
  const L = TL.loadLedger({}); TL.takeQueue(L, 'seedcap', st.events);
  T('[15] ... which counts nothing (n.sc 0) and opens no window', L.acct[v.pid(SIDB)].n.sc === 0 && !v.seedcapRejectActive(st.suspects[v.pid(SIDB)], tNow));
  const oa = sc.observedAlerts(st, out.flags, tNow);
  eq('[15] observed alert for that core', oa, [{ k: 'newcorenewco', n: 1 }]);
  st.cores.newcorenewco.mo = Math.floor(tNow / 1440);
  eq('[15] mailed today -> no second observed alert today', sc.observedAlerts(st, out.flags, tNow), []);
  T('[15] mail text names the observed core', /OBSERVED core newcorenewco: 1 over-cap group/.test(sc.alertMailText(['x'], out.flags, { veto: 1, suspects: 0 }, [], { observed: oa })));
  // past the window: the same core convicts
  const st2 = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] };
  const later = tNow + sc.SC_OBS_H * 60 + 1;
  sc.applyAudit(st2, [mk('o2')], { m0: { cap: 5000 } }, new Set(), later, { primary: 'newcorenewco', obsOf: sc.observationOf(st2, live, 'demo', later) });
  T('[15] after ' + sc.SC_OBS_H + ' h the core convicts as usual', st2.suspects[v.pid(SIDB)] && st2.suspects[v.pid(SIDB)].n === 1);
  // the honest-audit count ends it early
  const st3 = { audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [], cores: { newcorenewco: { t0: tNow - 60, n: sc.SC_OBS_N, o: 0, h: {} } } };
  T('[15] ' + sc.SC_OBS_N + ' honest audits end the observation early', sc.observationOf(st3, live, 'demo', tNow)('newcorenewco') === false);
  const SJ = read('seedcap.js');
  T('[15] main passes the observation judge of this run (snapshot before the verdicts)', /obsOf: observationOf\(st, cf\.live, SEEDCAP_CHANNEL, nowMin\(\)\)/.test(SJ));
  T('[15] the observed branch never touches the suspect ledger', /const blamed = obs \? \[\] : selfOver;/.test(SJ));
}

console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== trust-ledger: ALL PASS ===');
process.exit(failN ? 1 : 0);
