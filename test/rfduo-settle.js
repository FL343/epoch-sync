'use strict';
// rfduo-settle.js - companion knife D3 (O310): couch classic duo run attestation decode / verify / boundary plan + the lane
//   (cron read side). The record encoder below is test-only (real records are signed by the guard, native rfduo_record.h);
//   the companion repo's test/lib/rfduo-record.js is the JS reference and its ledger-schema-lockstep section 28d replays the
//   same kind of signed fixtures through both decoders / boundary plans / fork plans, so the two cannot drift.
//   Sections: [1] constants + cap table  [2] verify + settle plan  [3] boundary plan B2..B7, one case per reason
//   [4] fork / details / signature  [5] validate.js wiring pins  [6] state save + prune  [7] the REAL reconcile on the quiet path
//   against the offline board stub (test/lib/settle-stub.js): box rows -> ladder writes / pending / held / skips / rejects,
//   state carried into a second run, a failed ladder write, the _test suffix, PT_MODE.
//   No date is hard-wired into a verdict: unit cases pass nowSec, the stub runs build runT0 from the (possibly shifted) clock.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const RF = require(path.join(__dirname, '..', 'rfduo.js'));
const CE = require(path.join(__dirname, '..', 'campaign-endless.js'));
const V = require(path.join(__dirname, '..', 'validate.js'));
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond, extra) => { if (cond) ok(label); else bad(label + (extra ? ' -- ' + extra : '')); };
const J = JSON.stringify;

// ---- test-only encoder (layout: rfduo.js header) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const HARD = ['proto', 'ledger', 'cap', 'fast', 'price', 'slot'];
function encodeSid(sid) { const b = BigInt(String(sid)); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }
const u16 = (v) => Math.max(0, Math.min(65535, v | 0));
function buildBase(m) {
  const sid = encodeSid(m.steamId);
  const g = (m.gains || []).slice(-48);
  let hard = 0;
  HARD.forEach((n, i) => { hard |= (Math.min(15, (m.hard && m.hard[n]) | 0) << (i * 4)); });
  const b = [(RF.MAGIC | ((m.ver || RF.VER) << 8) | ((m.mode == null ? 1 : m.mode) << 16) | ((m.pc == null ? 2 : m.pc) << 24)) | 0, m.keyId | 0, m.passes | 0, m.score | 0,
    m.credSec | 0, sid[0], sid[1], m.firstAtMin | 0, m.lastAtMin | 0, m.runT0 | 0, (hard | (Math.min(255, m.unwit | 0) << 24)) | 0,
    (((m.endWhy | 0) & 0xff) | (((m.resumes | 0) & 0xff) << 8) | (((m.segStart | 0) & 0xffff) << 16)) | 0,
    m.slotNet | 0, (u16(m.spins) | (u16(m.gold3) << 16)) | 0, (u16(m.coins) | (u16(m.tnt) << 16)) | 0, m.spend | 0, m.maxGain | 0, (m.digest >>> 0) | 0,
    m.frameSec | 0, (m.soft >>> 0) | 0, m.s1 | 0, m.s2 | 0];
  for (let i = 0; i < 24; i++) b.push((u16(g[2 * i]) | (u16(g[2 * i + 1]) << 16)) | 0);
  b.push(g.length, g.length ? (m.gainsFirstD | 0) : 0);
  return b;
}
function buildSigned(m, seedHex) {
  const base = buildBase(m);
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, CE.toBytes(base), key);
  const d = base.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function pubOf(seedHex) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
}

console.log('=== [1] rfduo: constants + cap table ===');
assert('constants: magic 0xC1 / ver 1 / base 48 / sig 16 / mode 1 (classic) / 2 players / 48 gains / runT0 floor 2026-11-01 / 1e4 passes / 600s / 3500 per spin',
  RF.MAGIC === 0xC1 && RF.VER === 1 && RF.BASE_LEN === 48 && RF.SIG_INTS === 16 && RF.MODE_C === 1 && RF.PC === 2 && RF.GAINS === 48
  && RF.RUN_T0_FLOOR === Date.UTC(2026, 10, 1) / 1000 && RF.MAX_PASSES === 10000 && RF.LEVEL_CREDIT_MAX === 600 && RF.SLOT_NET_MAX === 3500
  && RF.baseLenOf(1) === 48 && RF.baseLenOf(2) === null && RF.baseLenOf(0) === null && J(RF.HARD_NAMES) === J(HARD)
  && J(RF.WHY) === J({ OVER: 1, CAP: 2, QUIT: 3, CRASH: 4, SAVE: 5 }));
assert('validate exports: default board names (box / ladder / save rows), empty suffix, state file', V.RFDUO_BOX_LB === 'rfduo_box' && V.RFDUO_LB === 'rfduo' && V.RFDUO_SAVE_LB === 'rfduo_save'
  && V.RFDUO_SUFFIX === '' && V.RFDUO_FILE === 'rfduo.json' && typeof V.loadRfduo === 'function' && typeof V.saveRfduo === 'function');
const capsText = fs.readFileSync(path.join(__dirname, '..', 'rfduo-caps.json'), 'utf8');
const caps = JSON.parse(capsText);
assert('rfduo-caps.json: pure ASCII, 15 levels wrapping to level 4, per-level caps / coins (15 each), 60-entry frame table',
  !/[^\x00-\x7f]/.test(capsText) && caps.total === 15 && caps.wrapTo === 4 && caps.mode === 'c' && caps.capL.length === 15 && caps.coinsL.length === 15 && caps.frames.length === 60
  && J(caps.capL) === J([3286, 5989, 3239, 4369, 6719, 6936, 4418, 11661, 14165, 14165, 6111, 9882, 5620, 9238, 11406]) && J(caps.coinsL) === J([1, 1, 1, 3, 2, 2, 4, 2, 4, 0, 2, 5, 0, 2, 6]));
assert('levelOf: 1..15 as is, 16 -> 4, 27 -> 15, 28 -> 4 (the wrap repeats levels 4..15)', [1, 15, 16, 27, 28, 40].map(d => RF.levelOf(caps, d)).join(',') === '1,15,4,15,4,4');
assert('mail decision / reject-hour pruning are the shared Gold Rush ones', RF.mailDecision === CE.mailDecision && RF.pruneRejects === CE.pruneRejects);

console.log('=== [2] rfduo: verify + settle plan ===');
const seed = crypto.createHash('sha256').update('rfduo-cron-test').digest('hex');
const seed2 = crypto.createHash('sha256').update('rfduo-cron-test-held').digest('hex');
const pub = pubOf(seed), pub2 = pubOf(seed2);
const TBL = { '2026111701': { pubs: [pub], sealed: true }, 'dev': { pubs: [pub], sealed: false }, '2026100101': { pubs: [], held: [{ pub: pub2, reason: 'retired' }], sealed: true } };
const runT0 = 1793500000, t0Min = Math.floor(runT0 / 60);
const meta = { keyId: 2026111701, passes: 6, score: 9000, credSec: 7 * 62, steamId: '76561198000000001', firstAtMin: t0Min + 1, lastAtMin: t0Min + 9, runT0,
  hard: {}, unwit: 0, endWhy: 1, resumes: 0, segStart: 1, slotNet: -100, spins: 1, gold3: 0, coins: 5, tnt: 2, spend: 1200, maxGain: 3000, digest: 0x12345678,
  frameSec: 400, soft: 0, s1: 5000, s2: 4000, gains: [1500, 2500, 1800, 2000, 3000, 2800, 900], gainsFirstD: 1 };
const rec = buildSigned(meta, seed);
const v = RF.verifyRfduoRecord(rec, TBL);
const NOW = { nowSec: runT0 + 86400 };
const planOf = (vv, over) => RF.settlePlan(vv, Object.assign({ owner: meta.steamId, allowDevKey: false, caps }, NOW, over || {}));
const signed = (over) => RF.verifyRfduoRecord(buildSigned(Object.assign({}, meta, over), seed), TBL);
const fOf = (over) => Object.assign({}, v.fields, over);
const bp = (over, opts) => RF.boundaryPlan(fOf(over), caps, Object.assign({}, NOW, opts || {}));
const cap8 = caps.capL.slice(0, 8).reduce((a, b) => a + b, 0);
assert('sealed record: 64 ints, verifies, fields (passes 6 / score / owner / runT0 / end over / 7 gains from level 1 / slot / coins / s1 s2)',
  rec.length === 64 && v.ok && v.sealed && v.fields.passes === 6 && v.fields.score === 9000 && v.fields.steamId === meta.steamId && v.fields.runT0 === runT0
  && v.fields.endWhy === 1 && v.fields.segStart === 1 && J(v.fields.gains) === J(meta.gains) && v.fields.gainsFirstD === 1 && v.fields.slotNet === -100 && v.fields.spins === 1
  && v.fields.coins === 5 && v.fields.tnt === 2 && v.fields.s1 === 5000 && v.fields.s2 === 4000 && v.fields.mode === 1 && v.fields.pc === 2 && v.fields.hardBits === 0 && v.fields.digest === 0x12345678);
assert('honest run -> ok, cap = the first passes + 2 level caps (over: the failed level counts, plus one)', planOf(v).ok === true && planOf(v).cap === cap8 && planOf(v).skip === false, J(planOf(v)));
assert('owner mismatch -> owner-mismatch (signature != identity)', planOf(v, { owner: '76561198000000002' }).reason === 'owner-mismatch');
const vd = signed({ keyId: 0 });
assert('dev key: verifies, not sealed; settles only with allowDevKey (the _test suffix)', vd.ok && !vd.sealed && vd.fields.keyName === 'dev' && planOf(vd).reason === 'dev-key-on-prod' && planOf(vd, { allowDevKey: true }).ok === true);
assert('unknown keyId -> pending (key table lag), never a rejection', (() => { const u = signed({ keyId: 2099010101 }); const p = RF.settlePlan(u, {}); return !u.ok && u.pending && u.reason === 'unknown-key' && p.pending === true && p.ok === false; })());
assert('a key the job policy holds (retired) -> key-retired pending; our own sealed key in its slot -> bad-sig',
  (() => { const h = RF.verifyRfduoRecord(buildSigned(Object.assign({}, meta, { keyId: 2026100101 }), seed2), TBL); const b = RF.verifyRfduoRecord(buildSigned(Object.assign({}, meta, { keyId: 2026100101 }), seed), TBL);
    return h.pending === true && h.reason === 'key-retired' && b.reason === 'bad-sig' && !b.pending; })());
assert('tampered score [3] / tampered gain [30] / tampered gain count [46] -> bad-sig',
  [3, 30, 46].every(i => { const t = rec.slice(); t[i] = (t[i] + 1) | 0; return RF.verifyRfduoRecord(t, TBL).reason === 'bad-sig'; }));
assert('zero padding after the signature ok / a non-zero int after it -> trailing / unknown ver -> pending / another magic -> magic / short -> short / not an array -> short',
  RF.verifyRfduoRecord(rec.concat(new Array(10).fill(0)), TBL).ok === true && RF.verifyRfduoRecord(rec.concat([0, 7]), TBL).reason === 'trailing'
  && (() => { const t = rec.slice(); t[0] = (t[0] & ~0xff00) | (2 << 8); const r = RF.verifyRfduoRecord(t, TBL); return r.pending === true && r.reason === 'ver' && r.fields && r.fields.ver === 2; })()
  && RF.verifyRfduoRecord([0xBB].concat(rec.slice(1)), TBL).reason === 'magic' && RF.verifyRfduoRecord(rec.slice(0, 63), TBL).reason === 'short' && RF.verifyRfduoRecord(null, TBL).reason === 'short');
assert('decodeRfduo: wrong shape -> null; the 16-bit packed pairs decode apart (spins / gold3, coins / tnt; the writer clamps at 65535)',
  RF.decodeRfduo(rec.slice(0, 10)) === null && RF.decodeRfduo([0xBB].concat(rec.slice(1))) === null
  && (() => { const f = RF.decodeRfduo(buildBase(Object.assign({}, meta, { spins: 70000, gold3: 3, coins: 9, tnt: 65535 })).concat(new Array(16).fill(0))); return f.spins === 65535 && f.gold3 === 3 && f.coins === 9 && f.tnt === 65535; })());

console.log('=== [3] rfduo: boundary plan, one case per reason ===');
assert('mode: classic mode 2 / three players -> mode (reject)', bp({ mode: 2 }).reason === 'mode' && bp({ pc: 3 }).reason === 'mode' && !bp({ pc: 3 }).skip);
assert('passes: -1 / 10001 -> passes; 0 -> nopass SKIP (not ranked, not an offense)', bp({ passes: -1 }).reason === 'passes' && bp({ passes: 10001 }).reason === 'passes'
  && bp({ passes: 0 }).reason === 'nopass' && bp({ passes: 0 }).skip === true);
assert('B2 hard flags: each of the six -> flag-<name> (reject, no skip), the lowest nibble named first', HARD.every((n, i) => {
  const p = RF.boundaryPlan(RF.decodeRfduo(buildSigned(Object.assign({}, meta, { hard: { [n]: 1 } }), seed)), caps, NOW); return p.reason === 'flag-' + n && !p.skip;
}) && RF.boundaryPlan(RF.decodeRfduo(buildSigned(Object.assign({}, meta, { hard: { slot: 2, ledger: 1 } }), seed)), caps, NOW).reason === 'flag-ledger');
assert('B2b unwitnessed spins -> unwit SKIP; a hard flag wins over it (checked first)', bp({ unwit: 1 }).reason === 'unwit' && bp({ unwit: 1 }).skip === true
  && RF.boundaryPlan(RF.decodeRfduo(buildSigned(Object.assign({}, meta, { unwit: 3, hard: { price: 1 } }), seed)), caps, NOW).reason === 'flag-price');
assert('end reason outside 1..5 -> endwhy; 2..5 accepted', bp({ endWhy: 0 }).reason === 'endwhy' && bp({ endWhy: 6 }).reason === 'endwhy' && [2, 3, 4, 5].every(w => bp({ endWhy: w, gains: meta.gains.slice(0, 6) }).ok));
assert('final money 0 / negative -> nonpos SKIP (an overbuy can end below zero)', bp({ score: 0 }).reason === 'nonpos' && bp({ score: -50 }).skip === true);
assert('B3 pace: frame floor up to credited + 2s per level + 10s ok, one more -> pace-fast; negative floor -> pace-fast',
  bp({ frameSec: meta.credSec + 2 * 7 + 10 }).ok === true && bp({ frameSec: meta.credSec + 2 * 7 + 11 }).reason === 'pace-fast' && bp({ frameSec: -1 }).reason === 'pace-fast');
assert('B3 pace: credited up to (levels + 1) x 600 ok, one more -> pace-slow (levels = passes + 1 when the run ended on a failed level)',
  bp({ credSec: 8 * 600, lastAtMin: t0Min + 200 }).ok === true && bp({ credSec: 8 * 600 + 1, lastAtMin: t0Min + 200 }).reason === 'pace-slow'
  && bp({ endWhy: 3, gains: meta.gains.slice(0, 6), credSec: 7 * 600 + 1, lastAtMin: t0Min + 200 }).reason === 'pace-slow');
assert('B3 runT0: before 2026-11-01 / more than a day ahead / after the first level -> runt0; minRunT0 option moves the floor',
  bp({ runT0: RF.RUN_T0_FLOOR - 60, firstAtMin: Math.floor((RF.RUN_T0_FLOOR - 60) / 60) + 1, lastAtMin: Math.floor((RF.RUN_T0_FLOOR - 60) / 60) + 9 }).reason === 'runt0'
  && bp({}, { nowSec: runT0 - 86401 }).reason === 'runt0' && bp({ firstAtMin: t0Min - 1 }).reason === 'runt0'
  && bp({ runT0: RF.RUN_T0_FLOOR - 60, firstAtMin: Math.floor((RF.RUN_T0_FLOOR - 60) / 60) + 1, lastAtMin: Math.floor((RF.RUN_T0_FLOOR - 60) / 60) + 9 }, { minRunT0: 0 }).ok === true);
assert('B3 wall clock from runT0: credited minutes beyond the span -> clock; a long break between levels is fine',
  bp({ lastAtMin: t0Min + 5 }).reason === 'clock' && bp({ lastAtMin: t0Min + 6 }).ok === true && bp({ lastAtMin: t0Min + 3 * 1440 }).ok === true);
assert('B4 per-level gains: at the level cap ok, one above -> overcap-level; a wrapped level uses its wrapped cap; gain before level 1 -> overcap-level',
  bp({ gains: [caps.capL[0]].concat(meta.gains.slice(1)) }).ok === true && bp({ gains: [caps.capL[0] + 1].concat(meta.gains.slice(1)) }).reason === 'overcap-level'
  && bp({ passes: 16, endWhy: 3, gainsFirstD: 16, gains: [caps.capL[3]], credSec: 16 * 62, frameSec: 0, lastAtMin: t0Min + 30, score: 900 }).ok === true
  && bp({ passes: 16, endWhy: 3, gainsFirstD: 16, gains: [caps.capL[3] + 1], credSec: 16 * 62, frameSec: 0, lastAtMin: t0Min + 30, score: 900 }).reason === 'overcap-level'
  && bp({ gainsFirstD: 0 }).reason === 'overcap-level');
assert('B4 gains past the levels played -> gains', bp({ gainsFirstD: 2 }).reason === 'gains' && bp({ gains: meta.gains.concat([100]) }).reason === 'gains');
assert('B6 coins above the summed layout coins -> coins (exactly the sum ok); spins > coins -> spins; triple-gold > spins -> gold3',
  bp({ coins: 16 }).ok === true && bp({ coins: 17 }).reason === 'coins' && bp({ spins: 6 }).reason === 'spins' && bp({ gold3: 2 }).reason === 'gold3');
assert('B6 |slot net| above spins x 3500 -> slotnet (both signs); exactly 3500 x spins ok',
  bp({ slotNet: 3500 }).ok === true && bp({ slotNet: 3501 }).reason === 'slotnet' && bp({ slotNet: -3501 }).reason === 'slotnet');
assert('B6 biggest level gain above the biggest level cap or negative -> maxgain', bp({ maxGain: 11661 }).ok === true && bp({ maxGain: 11662 }).reason === 'maxgain' && bp({ maxGain: -1 }).reason === 'maxgain');
assert('B5 final money: the summed caps ok, one above -> overcap (with cap); a positive slot net lifts the bound, a negative one does not lower it',
  bp({ score: cap8 }).ok === true && bp({ score: cap8 + 1 }).reason === 'overcap' && bp({ score: cap8 + 1 }).cap === cap8
  && bp({ score: cap8 + 3000, slotNet: 3000 }).ok === true && bp({ score: cap8 + 3001, slotNet: 3000 }).reason === 'overcap' && bp({ score: cap8, slotNet: -3000 }).ok === true);
assert('no cap table -> only the record-local checks (ok without cap); no fields -> nofields', RF.boundaryPlan(v.fields, null, NOW).ok === true && RF.boundaryPlan(v.fields, null, NOW).cap === undefined
  && RF.boundaryPlan(null, caps).reason === 'nofields');
assert('settlePlan passes the skip flag through (unwit / nopass / nonpos) and never marks a rejection as a skip',
  planOf(signed({ unwit: 1 })).skip === true && planOf(signed({ passes: 0 })).skip === true && planOf(signed({ score: -1 })).skip === true
  && planOf(signed({ hard: { cap: 1 } })).skip === false && planOf(v, { owner: '1' }).skip === false && planOf(vd).skip === false);

console.log('=== [4] rfduo: fork plan + details + signature ===');
assert('forkPlan: first sighting / same content re-signed by a newer build is no fork / different content of the same (account, runT0, resumes) -> fork / another resumes, runT0 or account -> no fork', (() => {
  const forks = {};
  const a = RF.forkPlan(forks, 'p1', v.fields);
  if (!(a.first && !a.fork && a.key === 'p1:' + runT0 + ':0')) return false;
  forks[a.key] = { fp: a.fp, t: 1 };
  const resend = RF.forkPlan(forks, 'p1', signed({ keyId: 2026111801 }).fields);
  const fork = RF.forkPlan(forks, 'p1', signed({ score: 9100 }).fields);
  const forkD = RF.forkPlan(forks, 'p1', signed({ digest: 0x12345679 }).fields);
  const otherSeg = RF.forkPlan(forks, 'p1', signed({ resumes: 1, score: 9100 }).fields);
  const otherRun = RF.forkPlan(forks, 'p1', signed({ runT0: runT0 + 60, score: 9100 }).fields);
  const otherAcct = RF.forkPlan(forks, 'p2', signed({ score: 9100 }).fields);
  return !resend.fork && !resend.first && fork.fork && forkD.fork && !otherSeg.fork && otherSeg.first && !otherRun.fork && !otherAcct.fork && RF.forkPlan(forks, 'p1', null).key === null;
})());
assert('fork fingerprint = passes:score:credSec:endWhy:hardBits:digest (keyId / signature left out)', RF.forkFpOf(v.fields) === [6, 9000, 434, 1, 0, 0x12345678].join(':'));
assert('ladder details = [passes, s1, s2, runT0]', J(RF.ladderDetails(v.fields)) === J([6, 5000, 4000, runT0]));
assert('sigHexOf: 128 hex chars = the last 16 ints; differs across two runs of one account; empty for an unknown version / a short row',
  /^[0-9a-f]{128}$/.test(RF.sigHexOf(rec)) && RF.sigHexOf(rec) === CE.toBytes(rec.slice(48, 64)).toString('hex') && RF.sigHexOf(rec) !== RF.sigHexOf(buildSigned(Object.assign({}, meta, { runT0: runT0 + 1 }), seed))
  && RF.sigHexOf((() => { const t = rec.slice(); t[0] = (t[0] & ~0xff00) | (2 << 8); return t; })()) === '' && RF.sigHexOf(rec.slice(0, 20)) === '');

console.log('=== [5] rfduo: validate.js wiring pins ===');
const vs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
const bodyAt = vs.indexOf('const processRfduo = async () => {');
const body = bodyAt >= 0 ? vs.slice(bodyAt, vs.indexOf('\n  };\n', bodyAt) + 6) : '';
assert('processRfduo defined + PT_MODE hard-off on its first line + no cap table = lane skipped', /const processRfduo = async \(\) => \{\s*if \(PT_MODE\) return;/.test(vs) && body.length > 1000
  && /rfduo-caps\.json unreadable -- lane skipped'\); return; \}/.test(body) && /has no level caps -- lane skipped'\); return; \}/.test(body));
assert('boards: client-writable box, trusted ladder, client-writable save rows find-or-created only (never read)',
  /const boxId = byName\(RFDUO_BOX_LB\) \|\| await findOrCreateBoard\(RFDUO_BOX_LB, false\);/.test(body) && /const lbId = byName\(RFDUO_LB\) \|\| await findOrCreateBoard\(RFDUO_LB, true\);/.test(body)
  && /if \(!byName\(RFDUO_SAVE_LB\)\) await findOrCreateBoard\(RFDUO_SAVE_LB, false\);/.test(body) && (body.match(/RFDUO_SAVE_LB/g) || []).length === 2
  && /const RFDUO_BOX_LB = process\.env\.RFDUO_BOX_LB \|\| \('rfduo_box' \+ RFDUO_SUFFIX\);/.test(vs) && /const RFDUO_SAVE_LB = process\.env\.RFDUO_SAVE_LB \|\| \('rfduo_save' \+ RFDUO_SUFFIX\);/.test(vs)
  && /const RFDUO_SUFFIX = process\.env\.RFDUO_SUFFIX \|\| '';/.test(vs));
assert('dev keys only on the _test suffix + the settle call (owner binding, caps, now)', /const allowDevKey = RFDUO_SUFFIX === '_test';/.test(body)
  && /const plan = rf\.settlePlan\(v, \{ owner: sid, allowDevKey, caps, nowSec \}\);/.test(body) && /const pubTable = loadJobPubTable\(nowMs\) \|\| \{\};/.test(body));
assert('called on all three exit paths right after the campaign story lane (and only there)', (vs.match(/await processCampaignStory\(\); await processRfduo\(\);/g) || []).length === 3
  && (vs.match(/await processRfduo\(\)/g) || []).length === 3);
assert('same signature never settles twice; a row without a readable signature is keyed by a hash of its raw details',
  /const sig = rf\.sigHexOf\(d\) \|\| \('raw:' \+ crypto\.createHash\('sha256'\)\.update\(String\(e\.detailData \|\| ''\)\)\.digest\('hex'\)\.slice\(0, 32\)\);\s*if \(st\.settled\[sig\]\) \{ nDup\+\+; continue; \}/.test(body));
assert('pending (unknown key / version) and held keys are never settled and never counted as rejections',
  /if \(plan\.pending\) \{ if \(keyHeld\(plan\.reason\)\) nHeld\+\+; else nPend\+\+; continue; \}/.test(body));
assert('skips: counted by reason in st.skips and settled, never in the reject histogram (no mail weight)', (() => {
  const m = /if \(plan\.skip\) \{([\s\S]*?)continue;\s*\}/.exec(body);
  return !!m && /st\.skips\[plan\.reason\] = \(st\.skips\[plan\.reason\] \| 0\) \+ 1; st\.settled\[sig\] = nowMin;/.test(m[1]) && !/rejects|reasons/.test(m[1]);
})());
assert('rejections: observation only -- reason count + hourly histogram + settled, and no offense board anywhere in the lane',
  /st\.reasons\[plan\.reason\] = \(st\.reasons\[plan\.reason\] \| 0\) \+ 1;\s*st\.rejects\[nowHour\] = \(st\.rejects\[nowHour\] \| 0\) \+ 1;\s*st\.settled\[sig\] = nowMin;/.test(body)
  && !/offense/i.test(body.replace(/\/\/[^\n]*/g, '').replace(/'[^'\n]*'/g, "''")) && !/RFDUO_OFFENSE/.test(vs));
assert('fork drop after a clean verdict, before settling: no rejection count, no ladder write',
  /const fk = rf\.forkPlan\(st\.forks, pid\(sid\), f\);\s*if \(fk\.fork\) \{ nFork\+\+; st\.settled\[sig\] = nowMin;[^\n]*continue; \}\s*if \(fk\.key && fk\.first\) st\.forks\[fk\.key\] = \{ fp: fk\.fp, t: nowMin \};/.test(body)
  && !/fk\.fork[^\n]*(rejects|reasons)/.test(body));
assert('only-raise ForceUpdate with ladderDetails; a failed write un-settles the signature',
  /if \(best\[sid\] != null && \(f\.score \| 0\) <= best\[sid\]\) \{ nSame\+\+; continue; \}/.test(body) && /if \(!APPLY_MMR\) \{/.test(body)
  && /leaderboardid: lbId, steamid: sid, score: f\.score \| 0, scoremethod: 'ForceUpdate', format: 'json' \}, rf\.ladderDetails\(f\)\);/.test(body)
  && /if \(!wOk\) \{ ghWarn\('rfduo ladder write failed '[^\n]*delete st\.settled\[sig\]; continue; \}/.test(body));
assert('mail: shared 24h decision on the lane\'s own reject hours + its own mailHour (ceSendMail; set only when sent)',
  /const md = rf\.mailDecision\(st\.rejects, nowHour, st\.mailHour \| 0, CE_MAIL_MIN\);/.test(body) && /await ceSendMail\('rfduo ALERT: '/.test(body) && /if \(sent\) st\.mailHour = nowHour;/.test(body));
assert('state saved on every run that got past the cap table; run summary row carries the lane', /saveRfduo\(st, nowMs\);\s*if \(nUp \|\| nSame/.test(body) && /RUN\.rfduo = /.test(body)
  && /couch classic duo \(rfduo\) \| ' \+[^\n]*s\('rfduo', '-'\)/.test(vs));
assert('the workflow persists rfduo.json; rfduo-caps.json is config (tools/code-hash.js)', /for f in [^\n]*\brfduo\.json\b/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8'))
  && require(path.join(__dirname, '..', 'tools', 'code-hash.js')).CONFIG_JSON.includes('rfduo-caps.json'));

console.log('=== [6] rfduo: state save + prune ===');
assert('rfduoStateOf fills the missing parts; saveRfduo prunes signatures / forks past 120 days and reject hours past 48h, keeps reasons / skips', (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfduo-'));
  const old = process.cwd();
  try {
    process.chdir(dir);
    const nowMs = Date.UTC(2026, 11, 1), nowMin = Math.floor(nowMs / 60000), nowHour = Math.floor(nowMs / 3600000);
    const empty = V.rfduoStateOf({});
    if (J(Object.keys(empty)) !== J(['settled', 'rejects', 'reasons', 'skips', 'forks', 'mailHour'])) return false;
    const st = V.rfduoStateOf({ settled: { a: nowMin - 200 * 1440, b: nowMin }, forks: { f1: { fp: 'x', t: nowMin - 200 * 1440 }, f2: { fp: 'y', t: nowMin } },
      rejects: { [nowHour - 60]: 1, [nowHour]: 2 }, reasons: { 'flag-cap': 3 }, skips: { unwit: 1 }, mailHour: nowHour - 5 });
    V.saveRfduo(st, nowMs);
    const back = V.rfduoStateOf(JSON.parse(fs.readFileSync(path.join(dir, V.RFDUO_FILE), 'utf8')));
    return !back.settled.a && back.settled.b === nowMin && !back.forks.f1 && back.forks.f2 && back.rejects[nowHour] === 2 && back.rejects[nowHour - 60] === undefined
      && back.reasons['flag-cap'] === 3 && back.skips.unwit === 1 && back.mailHour === nowHour - 5 && J(V.loadRfduo()) === J(back);
  } finally { process.chdir(old); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
})());

console.log('=== [7] rfduo: the real reconcile against the offline board stub ===');
{
  const H = require('./lib/settle-stub.js');
  const hookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfduo-keys-'));
  try {
    // the job's key table: a sealed ea key, a sealed key past its retirement (held), the dev key -- all from the test seeds
    const sealedPubInfo = { [pub]: { ch: 'ea' } };
    const keys = { v: 1, keys: { '2026111701': { pubs: [pub], sealed: true, pubInfo: sealedPubInfo },
      '2026100101': { pubs: [pub2], sealed: true, pubInfo: { [pub2]: { ch: 'ea', retiredAt: '2026-01-01T00:00:00Z' } } }, dev: { pubs: [pub], sealed: false } } };
    const hook = path.join(hookDir, 'keys-hook.js');
    fs.writeFileSync(hook, "'use strict';\nconst fs = require('fs');\nconst real = fs.readFileSync;\nconst TABLE = " + J(J(keys)) +
      ";\nfs.readFileSync = function (p, o) { if (/attest-keys\\.json$/.test(String(p))) return typeof o === 'string' || (o && o.encoding) ? TABLE : Buffer.from(TABLE); return real.apply(this, arguments); };\n");
    // appended to an inherited NODE_OPTIONS (tools/time-bomb.js preloads its fake clock the same way); forward slashes: inside
    //   quotes Node's NODE_OPTIONS parser treats a backslash as an escape
    const nodeOpts = ((process.env.NODE_OPTIONS || '') + ' --require "' + hook.replace(/\\/g, '/') + '"').trim();
    const nowSec = Math.floor(Date.now() / 1000);
    const T0 = Math.max(RF.RUN_T0_FLOOR + 60, nowSec - 7200), T0M = Math.floor(T0 / 60);
    const base = () => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }];
    const S = (n) => H.SID(7100 + n);
    const mk = (n, over, sd) => buildSigned(Object.assign({}, meta, { steamId: S(n), runT0: T0, firstAtMin: T0M + 1, lastAtMin: T0M + 9 }, over || {}), sd || seed);
    const rows = {
      good: { steamID: S(1), score: 1, details: mk(1) },
      flag: { steamID: S(2), score: 1, details: mk(2, { hard: { slot: 1 } }) },
      unwit: { steamID: S(3), score: 1, details: mk(3, { unwit: 2 }) },
      owner: { steamID: S(4), score: 1, details: mk(40) },
      unknown: { steamID: S(5), score: 1, details: mk(5, { keyId: 2099010101 }) },
      held: { steamID: S(6), score: 1, details: mk(6, { keyId: 2026100101 }, seed2) },
      dev: { steamID: S(7), score: 1, details: mk(7, { keyId: 0 }) },
      same: { steamID: S(8), score: 1, details: mk(8) },
      junk: { steamID: S(9), score: 1, details: [0xC1, 1, 2, 3] },
    };
    const boards = (box, extra) => H.shardBoards([], base().concat([{ id: 71, name: 'rfduo_box', entries: box }, { id: 72, name: 'rfduo', entries: [{ steamID: S(8), score: 99999, details: [1, 0, 0, 0] }] }], extra || []));
    const findCreate = (r, name) => r.posts.filter((p) => /FindOrCreateLeaderboard/.test(p.url) && new RegExp('(^|&)name=' + name + '(&|$)').test(p.body));
    const ladder = (r, id) => H.setPosts(r, id || 72).map((p) => ({ sid: /steamid=([0-9]+)/.exec(p.body)[1], score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), method: (/scoremethod=([A-Za-z]+)/.exec(p.body) || [])[1], details: H.postDetails(p.body) }));
    const env = { NODE_OPTIONS: nodeOpts, APPLY_MMR: '1' };
    const r1 = H.runCron(boards(Object.values(rows)), null, env, null, 'rfduo');
    const st1 = r1.state.RFDUO_FILE || {};
    const w1 = ladder(r1);
    assert('[7] run 1 succeeds on the quiet path and reports the lane', r1.code === 0 && /no consistent matches/.test(r1.out) && /rfduo: 1 ladder writes, 1 not better, 1 pending, 1 key-held, 4 rejected \(observation only\), 1 not ranked, 0 already settled, 0 forks dropped/.test(r1.out), r1.out.slice(-1500));
    assert('[7] exactly one ladder write: the honest run, ForceUpdate, score = final money, details [passes, s1, s2, runT0]',
      w1.length === 1 && w1[0].sid === S(1) && w1[0].score === 9000 && w1[0].method === 'ForceUpdate' && J(w1[0].details) === J([6, 5000, 4000, T0]), J(w1));
    assert('[7] the save-row board is find-or-created client-writable (it did not exist); box / ladder existed, not created; nothing written to the box or save rows',
      findCreate(r1, 'rfduo_save').length === 1 && /onlytrustedwrites=0/.test(findCreate(r1, 'rfduo_save')[0].body) && findCreate(r1, 'rfduo_box').length === 0 && findCreate(r1, 'rfduo').length === 0
      && H.setPosts(r1, 71).length === 0);
    const created1 = r1.posts.filter((p) => /FindOrCreateLeaderboard/.test(p.url)).map((p) => decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(p.body) || [])[1] || ''));
    assert('[7] no offense board touched (observation only): the only rfduo board looked up by name is the save-row board, no offense board created',
      J(created1.filter((n) => /rfduo/.test(n))) === J(['rfduo_save']) && !created1.some((n) => /offense/.test(n)), J(created1));
    assert('[7] state: reasons flag-slot / owner-mismatch / dev-key-on-prod / short, one each; skips unwit 1; 4 rejects this hour; 7 signatures settled (pending + held not); one fork key per settled clean run',
      J(Object.entries(st1.reasons || {}).sort()) === J([['dev-key-on-prod', 1], ['flag-slot', 1], ['owner-mismatch', 1], ['short', 1]]) && J(st1.skips) === J({ unwit: 1 })
      && Object.values(st1.rejects || {}).reduce((a, b) => a + b, 0) === 4 && Object.keys(st1.settled || {}).length === 7
      && !st1.settled[RF.sigHexOf(rows.unknown.details)] && !st1.settled[RF.sigHexOf(rows.held.details)] && Object.keys(st1.settled).filter(k => /^raw:/.test(k)).length === 1
      && Object.keys(st1.forks || {}).length === 2, J(st1));
    assert('[7] summary row carries the lane', /couch classic duo \(rfduo\) \| [^|\n]*1up\/1same\/1pend\/1held\/4rej\/1skip/.test(r1.summary), (r1.summary.match(/[^\n]*rfduo[^\n]*/) || [''])[0]);
    // run 2: same boards, state carried -> nothing new, the pending / held rows stay pending, counts unchanged
    const r2 = H.runCron(boards(Object.values(rows)), { RFDUO_FILE: st1 }, env, null, 'rfduo');
    const st2 = r2.state.RFDUO_FILE || {};
    assert('[7] run 2 (state carried): no ladder write, 7 already settled, pending / held still pending, counts unchanged',
      r2.code === 0 && ladder(r2).length === 0 && /rfduo: 0 ladder writes, 0 not better, 1 pending, 1 key-held, 0 rejected \(observation only\), 0 not ranked, 7 already settled/.test(r2.out)
      && J(st2.reasons) === J(st1.reasons) && J(st2.skips) === J(st1.skips) && J(st2.settled) === J(st1.settled), r2.out.slice(-800));
    // run 3: a different content of the honest segment (an old save played again) -> fork dropped, not written, not counted
    const forkRow = { steamID: S(1), score: 1, details: mk(1, { score: 9500, digest: 0x0BADF00D }) };
    const r3 = H.runCron(boards([forkRow]), { RFDUO_FILE: st1 }, env, null, 'rfduo');
    const st3 = r3.state.RFDUO_FILE || {};
    assert('[7] run 3: a second content of the same (account, runT0, resumes) -> fork dropped, no ladder write, no reject count, settled',
      r3.code === 0 && ladder(r3).length === 0 && /1 forks dropped/.test(r3.out) && J(st3.reasons) === J(st1.reasons) && !!st3.settled[RF.sigHexOf(forkRow.details)], r3.out.slice(-800));
    // run 4: the ladder write fails -> the signature is not settled (retried next run)
    const r4 = H.runCron(boards([rows.good]), null, Object.assign({ STUB_FAIL_POST: J({ rfduo: 500 }) }, env), null, 'rfduo');
    const st4 = r4.state.RFDUO_FILE || {};
    assert('[7] run 4: a failed ladder write leaves the signature unsettled (retried next run)', r4.code === 0 && ladder(r4).length === 1 && !(st4.settled || {})[RF.sigHexOf(rows.good.details)]
      && /rfduo ladder write failed/.test(r4.out), r4.out.slice(-800));
    // run 5: the _test suffix -> the dev-key record settles on rfduo_test; prod-named boards untouched
    const testBoards = H.shardBoards([], base().concat([{ id: 81, name: 'rfduo_box_test', entries: [rows.dev] }, { id: 82, name: 'rfduo_test', entries: [] }, { id: 83, name: 'rfduo_save_test', entries: [] }]));
    const r5 = H.runCron(testBoards, null, Object.assign({ RFDUO_SUFFIX: '_test' }, env), null, 'rfduo');
    const w5 = ladder(r5, 82);
    assert('[7] run 5 (_test suffix): the dev-key record settles on rfduo_test; no prod-named board is created',
      r5.code === 0 && w5.length === 1 && w5[0].sid === S(7) && w5[0].score === 9000 && findCreate(r5, 'rfduo').length === 0 && findCreate(r5, 'rfduo_box').length === 0 && findCreate(r5, 'rfduo_save').length === 0, r5.out.slice(-800));
    // run 6: PT_MODE (playtest / demo jobs) -> the lane never runs: no board touched, no state file
    //   (the twin jobs refuse to run while a ranked board exists on their app: progress / cp_bank only + the rfduo boards)
    const ptBoards = H.shardBoards([], [{ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }, { id: 71, name: 'rfduo_box', entries: Object.values(rows) },
      { id: 72, name: 'rfduo', entries: [] }]);
    const r6 = H.runCron(ptBoards, null, Object.assign({ PT_MODE: '1' }, env), null, 'rfduo');
    assert('[7] run 6 (PT_MODE): the run completes, no rfduo board created or written, no state file', r6.code === 0 && /no consistent matches/.test(r6.out) && ladder(r6).length === 0
      && !r6.posts.some((p) => /FindOrCreateLeaderboard/.test(p.url) && /(^|&)name=rfduo/.test(p.body)) && r6.state.RFDUO_FILE === undefined && !/rfduo: /.test(r6.out),
      'code ' + r6.code + ' ' + r6.out.slice(-400));
  } finally { try { fs.rmSync(hookDir, { recursive: true, force: true }); } catch (e) { /* temp */ } }
}

console.log(failN ? ('\nFAIL ' + failN) : '\nall green');
process.exit(failN ? 1 : 0);
