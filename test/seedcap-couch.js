'use strict';
// O606 couch competitive (client knife 5c, 2026-10-31): the seed-cap audit judges a couch segment (SEG_COUCH, two local seats on one
//   account, guard-signed) like an observed core until SC_COUCH_CONVICT: an over-cap group is VETOED, nobody convicted (no suspect,
//   no reject window, no offense row, no sev-3 ledger record), no correction queued, a sev-0 observation record kept and the mail
//   counts it as an observation; the audited chain still extends on an honest one (self stays set, unlike the C3 draft's "empty self").
//   [1] pendingOfGroup reads a couch record through attest.couchTail (keyId = the signing package) and marks it couch
//   [2] over-cap couch: veto, no suspect, no correction, sev-0 record with ctx.couch, flags entry obs + couch
//   [3] honest couch: the chain extends for the writer's own seat (pid:pc:runSeed)
//   [4] opt.couchConvict (the SC_COUCH_CONVICT lever): convicted like any record (suspect + correction)
//   [5] a team (non-couch) endless over-cap is unchanged: convicted
const path = require('path'), crypto = require('crypto');
for (const k of ['SC_COUCH_CONVICT', 'PT_MODE']) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const sc = require(path.join(ROOT, 'seedcap.js'));

let failN = 0;
const ok = (m, cond, detail) => { if (cond) console.log('  ok    ' + m); else { failN++; console.log('  FAIL  ' + m + (detail ? ' -- ' + detail : '')); } };

const SID = '76561198000009901', SIDB = '76561198000009902';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('7d'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
function couchRec(sid, runSeed, ed, seats, flags) {
  const [lo, hi] = sidPair(sid);
  const d = [0xB1, 3, 7, A.hash32('scc-' + runSeed), runSeed, 0, 1, 0, 2, 300, seats[0], seats[1], 0, lo, hi, lo, hi,
    0, ed, 0, 0, 0, flags == null ? (A.SEG_COMP | A.SEG_COUCH | A.SEG_FINAL) : flags, 0, 0, 0, 0, 0, 0,
    0xD8 | (1 << 8) | (2 << 16), 1 | (1 << 8),
    0xE8 | (1 << 8) | (21 << 16), 2099103199, 1, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}

console.log('=== O606 couch segments in the seed-cap audit ===');

// ---- [1] ----
{
  const d = couchRec(SID, 9101, 5, [600, 400]);
  const t = sc.tailOf(d);
  ok('[1] tailOf: a couch record -> its tail + the signing package', t && t.endDepth === 5 && t.keyId === 2099103199 && ((t.flags | 0) & A.SEG_COUCH) !== 0, JSON.stringify(t));
  const pend = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k1', [{ d, w: SID, steamID: SID, roster: v.decodeRoster(d) }]);
  ok('[1] pendingOfGroup: couch mark + self = the writer\'s own seat + the package key', pend && pend.couch === true && pend.self.join(',') === '0' && pend.keyId === 2099103199 && pend.pc === 2,
    pend ? JSON.stringify({ couch: pend.couch, self: pend.self, keyId: pend.keyId, pc: pend.pc }) : 'null');
  const team = couchRec(SID, 9102, 5, [600, 400], A.SEG_COMP | A.SEG_FINAL);
  const pt = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k2', [{ d: team, w: SID, steamID: SID, roster: v.decodeRoster(team) }]);
  ok('[1] a record without the couch bit is not marked couch', pt && pt.couch === false);
}

const entry = (m, scores, couch, runSeed) => ({ m, mt: 7, pc: 2, scores, p: { entry: 'endless' }, tail: { startDepth: 0, endDepth: 5, flags: A.SEG_COMP | (couch ? A.SEG_COUCH : 0) },
  roster: { 0: SID, 1: couch ? SID : SIDB }, self: [0], runSeed, couch: !!couch });
const freshSt = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });

// ---- [2] ----
{
  const st = freshSt();
  const r = sc.applyAudit(st, [entry('c-over', [99999, 1], true, 9201)], { m0: { cap: 5000 } }, new Set(['c-over']), 1000);
  ok('[2] over-cap couch: vetoed', !!st.veto['c-over'] && st.veto['c-over'].seats.join(',') === '0');
  ok('[2] no suspect, no correction (even though the key was processed)', !st.suspects[v.pid(SID)] && st.corrections.length === 0, JSON.stringify({ su: st.suspects, cor: st.corrections }));
  const q = (st.trustQ || st.tq || []).concat(...Object.values(st).filter((x) => Array.isArray(x) && x.length && x[0] && x[0].src === 'sc'));
  const recs = q.filter((x) => x && x.src === 'sc');
  ok('[2] a sev-0 observation record with ctx.couch, no sev-3', recs.length >= 1 && recs.every((x) => (x.sev | 0) === 0) && recs.some((x) => x.ctx && x.ctx.couch === 1), JSON.stringify(recs).slice(0, 400));
  ok('[2] the flags entry: obs + couch, no offenders', r.flags.length === 1 && r.flags[0].obs === true && r.flags[0].couch === 1 && r.flags[0].offenders.length === 0, JSON.stringify(r.flags));
  ok('[2] the mail counts it as an observation of its core', sc.observedAlerts(st, r.flags, 1440 * 30).length === 1);   // (day 0 reads as "mailed" by an unset mo)
}

// ---- [3] ----
{
  const st = freshSt();
  sc.applyAudit(st, [entry('c-ok', [600, 400], true, 9301)], { m0: { cap: 5000 } }, new Set(), 1000);
  const c = st.chain[sc.chainKey(v.pid(SID), 2, 9301)];
  ok('[3] honest couch: the audited chain extends for the writer (self kept)', c && c.d === 5 && c.cap === 5000, JSON.stringify(st.chain));
}

// ---- [4] ----
{
  const st = freshSt();
  sc.applyAudit(st, [entry('c-conv', [99999, 1], true, 9401)], { m0: { cap: 5000 } }, new Set(['c-conv']), 1000, { couchConvict: true });
  ok('[4] couchConvict: suspect + correction like any record', !!st.suspects[v.pid(SID)] && st.corrections.length === 1);
}

// ---- [5] ----
{
  const st = freshSt();
  sc.applyAudit(st, [entry('t-over', [99999, 1], false, 9501)], { m0: { cap: 5000 } }, new Set(['t-over']), 1000);
  ok('[5] a team endless over-cap is convicted as before', !!st.suspects[v.pid(SID)] && st.corrections.length === 1);
}

console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
