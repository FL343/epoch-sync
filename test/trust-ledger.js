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

console.log(failN ? '=== FAIL (' + failN + ') ===' : '=== trust-ledger: ALL PASS ===');
process.exit(failN ? 1 : 0);
