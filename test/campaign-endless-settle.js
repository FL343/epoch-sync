'use strict';
// campaign-endless-settle.js - knife 3.9b N4: Gold Rush run attestation decode/verify/boundary plan (cron read side)
//   Mirrors the companion repo's test/lib/gr-record.js reference encoder; the guard's C++ is the only production encoder.
//   Negative cases are the same triplets the companion side asserts, so the two decoders / boundary plans cannot drift.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CE = require(path.join(__dirname, '..', 'campaign-endless.js'));
const V = require(path.join(__dirname, '..', 'validate.js'));
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond, extra) => { if (cond) ok(label); else bad(label + (extra ? ' -- ' + extra : '')); };

// reference encoder (test-only: real records are signed by the guard)
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function encodeSid(sid) { const b = BigInt(String(sid)); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }
const sat8 = (v) => Math.max(0, Math.min(255, v | 0));
function buildBase(m) {
  const sid = encodeSid(m.steamId);
  return [(CE.GR_MAGIC | (CE.GR_VER << 8)) | 0, m.keyId | 0, m.dif | 0, m.passes | 0, m.score | 0, m.elapsedSec | 0, sid[0], sid[1], m.firstAtMin | 0, m.lastAtMin | 0,
    (sat8(m.fast) | (sat8(m.skip) << 8) | (sat8(m.incons) << 16) | (sat8(m.quit) << 24)) | 0, ((((m.endWorld | 0) & 0xff) << 8) | ((m.endLevel | 0) & 0xff)) | 0, m.runT0 | 0];
}
function buildSigned(m, seedHex) {
  const base = buildBase(m);
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, CE.toBytes(base), key);
  const d = base.slice();
  for (let i = 0; i < CE.SIG_INTS; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function pubOf(seedHex) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
}

console.log('=== campaign-endless: constants + cap table ===');
assert('constants: magic 0xBB / ver 1 / base 13 / sig 16 / ring 54 / 40s floor / 600s cap / 1e5 passes', CE.GR_MAGIC === 0xBB && CE.GR_VER === 1 && CE.BASE_LEN === 13 && CE.SIG_INTS === 16 && CE.RING === 54 && CE.MIN_PASS_SEC === 40 && CE.MAX_CREDIT_SEC === 600 && CE.MAX_PASSES === 100000);
assert('validate exports: box/ladder prefixes + suffix (default prod names) + offense board + state file + mail threshold', V.CAMPAIGN_ENDLESS_BOX_PREFIX === 'campaign_endless_box_d' && V.CAMPAIGN_ENDLESS_LB_PREFIX === 'campaign_endless_d' && V.CAMPAIGN_ENDLESS_SUFFIX === '' && V.CAMPAIGN_ENDLESS_OFFENSE_LB === 'campaign_endless_offense' && V.CAMPAIGN_ENDLESS_FILE === 'campaign-endless.json' && V.CE_MAIL_MIN === 5);
const caps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gr-caps.json'), 'utf8'));
assert('gr-caps.json: 54-level ring W1L1..W3L18 (no W2 L0) + cap/minLV per difficulty on every level', caps.ring.length === 54 && caps.ring[0] === '1_1' && caps.ring[53] === '3_18' && caps.ring.indexOf('2_0') < 0
  && caps.ring.every(k => caps.levels[k] && caps.levels[k].cap.length === 3 && caps.levels[k].minLV.length === 3 && caps.levels[k].cap[0] > caps.levels[k].minLV[0]));
assert('ringAt: 0 -> W1L1 / 17 -> W1L18 / 18 -> W2L1 / 53 -> W3L18 / 54 -> W1L1 (wrap)', JSON.stringify([0, 17, 18, 53, 54].map(CE.ringAt)) === JSON.stringify([{ world: 1, level: 1 }, { world: 1, level: 18 }, { world: 2, level: 1 }, { world: 3, level: 18 }, { world: 1, level: 1 }]));

console.log('=== campaign-endless: verify + settle plan ===');
const seed = crypto.createHash('sha256').update('gr-cron-test').digest('hex');
const pub = pubOf(seed);
const TBL = { '2026090701': { pubs: [pub], sealed: true }, 'dev': { pubs: [pub], sealed: false } };
const runT0 = 1788300000;
const meta = { keyId: 2026090701, dif: 2, passes: 7, score: 41234, elapsedSec: 7 * 62, steamId: '76561198000000001', firstAtMin: Math.floor(runT0 / 60) + 1, lastAtMin: Math.floor(runT0 / 60) + 9, fast: 0, skip: 0, incons: 0, quit: 1, endWorld: 1, endLevel: 8, runT0 };
const rec = buildSigned(meta, seed);
const v = CE.verifyGrRecord(rec, TBL);
const planOf = (vv, over) => CE.settlePlan(vv, Object.assign({ owner: meta.steamId, allowDevKey: false, boxDif: 2, caps, nowSec: runT0 + 3600 }, over || {}));
assert('sealed record verifies + fields (dif 2 / passes 7 / score / owner sid / quit 1 / end W1L8 / runT0)', v.ok && v.sealed && v.fields.dif === 2 && v.fields.passes === 7 && v.fields.score === 41234 && v.fields.steamId === meta.steamId && v.fields.quit === 1 && v.fields.endWorld === 1 && v.fields.endLevel === 8 && v.fields.runT0 === runT0);
assert('settlePlan: honest run -> ok (7 passes dif 2 within the 8-level cap sum)', planOf(v).ok === true && planOf(v).cap > meta.score, JSON.stringify(planOf(v)));
assert('owner mismatch -> owner-mismatch (signature != identity)', planOf(v, { owner: '76561198000000002' }).reason === 'owner-mismatch');
assert('record in the wrong difficulty box -> difbox', planOf(v, { boxDif: 1 }).reason === 'difbox');
const vd = CE.verifyGrRecord(buildSigned(Object.assign({}, meta, { keyId: 0 }), seed), TBL);
assert('dev key: verifies but settles only with allowDevKey (*_test suffix)', vd.ok && !vd.sealed && planOf(vd).reason === 'dev-key-on-prod' && planOf(vd, { allowDevKey: true }).ok === true);
assert('unknown keyId -> pending (key table lag), not rejected', (() => { const u = CE.verifyGrRecord(buildSigned(Object.assign({}, meta, { keyId: 2099010101 }), seed), TBL); return !u.ok && u.pending && u.reason === 'unknown-key' && CE.settlePlan(u, {}).pending === true; })());
assert('tampered score -> bad-sig', (() => { const t = rec.slice(); t[4] = 1; return CE.verifyGrRecord(t, TBL).reason === 'bad-sig'; })());
assert('zero-padded tail ok / non-zero tail -> trailing / unknown ver -> pending / bad magic -> magic / short -> short',
  CE.verifyGrRecord(rec.concat(new Array(64 - rec.length).fill(0)), TBL).ok === true && CE.verifyGrRecord(rec.concat([0, 7]), TBL).reason === 'trailing'
  && (() => { const t = rec.slice(); t[0] = (CE.GR_MAGIC | (2 << 8)); return CE.verifyGrRecord(t, TBL).pending === true; })()
  && CE.verifyGrRecord([0xB1].concat(rec.slice(1)), TBL).reason === 'magic' && CE.verifyGrRecord(rec.slice(0, 20), TBL).reason === 'short');
const signed = (over) => CE.verifyGrRecord(buildSigned(Object.assign({}, meta, over), seed), TBL);
assert('B2 sequence: fast / skip / incons > 0 -> reject with that reason', planOf(signed({ fast: 1 })).reason === 'fast' && planOf(signed({ skip: 2 })).reason === 'skip' && planOf(signed({ incons: 1 })).reason === 'incons');
assert('B3 pace: elapsed < 40 x passes -> pace-fast / > 600 x passes -> pace-slow / wall-clock disagreement -> clock', planOf(signed({ elapsedSec: 7 * 39 })).reason === 'pace-fast' && planOf(signed({ elapsedSec: 7 * 601 })).reason === 'pace-slow' && planOf(signed({ lastAtMin: meta.firstAtMin })).reason === 'clock');
assert('B4 upper bound: score above the passes+1 cap sum -> overcap', planOf(signed({ score: 10000000 })).reason === 'overcap');
assert('B5 lower bound: far below the summed minimum values -> lowscore SIGNAL only (shop spending is legal)', (() => { const p = planOf(signed({ score: 100 })); return p.ok === true && p.flags.indexOf('lowscore') >= 0; })());
assert('B6 caps: passes 0 -> nopass / passes > 1e5 -> passes / dif 4 -> dif / endLevel 19 -> endlevel / runT0 before 2026-09-01 or after now+1d -> runt0',
  planOf(signed({ passes: 0 })).reason === 'nopass' && planOf(signed({ passes: 100001 })).reason === 'passes' && CE.boundaryPlan(Object.assign({}, v.fields, { dif: 4 }), caps).reason === 'dif'
  && planOf(signed({ endLevel: 19 })).reason === 'endlevel' && planOf(signed({ runT0: 1700000000 })).reason === 'runt0' && planOf(signed({ runT0: runT0 + 100000 })).reason === 'runt0');
assert('ladderDetails = [passes, elapsedMin, keyId, flags, endWorld<<8|endLevel, runT0]; offenseDetails = [0xC8, tMin, dif, reasonCode, passes, score]',
  JSON.stringify(CE.ladderDetails(v.fields)) === JSON.stringify([7, 7, 2026090701, 1 << 24, (1 << 8) | 8, runT0]) && JSON.stringify(CE.offenseDetails(12345, v.fields, 'overcap')) === JSON.stringify([0xC8, 12345, 2, 30, 7, 41234]) && CE.REASON_CODE['fast'] === 10 && CE.REASON_CODE['bad-sig'] === 1);
assert('sigHexOf: 64 hex chars from the sig block; differs across two runs of one account (runT0 in the signed bytes)', /^[0-9a-f]{128}$/.test(CE.sigHexOf(rec)) && CE.sigHexOf(rec) !== CE.sigHexOf(buildSigned(Object.assign({}, meta, { runT0: runT0 + 1 }), seed)));
assert('mailDecision: trailing-24h reject sum >= min and no mail in 24h -> send; pruneRejects keeps 48h', (() => {
  const now = 500000; const rej = { [now - 30]: 9, [now - 3]: 3, [now]: 2 };
  const a = CE.mailDecision(rej, now, 0, 5), b = CE.mailDecision(rej, now, now - 10, 5), c = CE.mailDecision({ [now]: 4 }, now, 0, 5);
  const pr = CE.pruneRejects(rej, now);
  return a.send === true && a.n === 5 && b.send === false && c.send === false && c.n === 4 && pr[now - 30] === 9 && pr[now] === 2 && CE.pruneRejects({ [now - 49]: 1, [now]: 1 }, now)[now - 49] === undefined;
})());

console.log('=== campaign-endless: validate.js wiring pins ===');
const vs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('processCampaignEndless defined + PT_MODE hard-off + client-writable boxes + trusted ladders + dev keys only on the _test suffix + boxDif binding', /const processCampaignEndless = async \(\) => \{\s*if \(PT_MODE\) return;/.test(vs)
  && /await findOrCreateBoard\(boxName, false\)/.test(vs) && /await findOrCreateBoard\(lbName, true\)/.test(vs) && /const allowDevKey = CAMPAIGN_ENDLESS_SUFFIX === '_test';/.test(vs) && /ce\.settlePlan\(v, \{ owner: sid, allowDevKey, boxDif: dif, caps, nowSec \}\)/.test(vs));
assert('called on all three exit paths right after processCampaignGrants', (vs.match(/await processCampaignGrants\(\); await processCampaignEndless\(\);/g) || []).length === 3);
assert('best-only ladder write (ForceUpdate with ladderDetails) + same signature never settles twice + failed write un-settles the signature', /if \(best\[sid\] != null && \(f\.score \| 0\) <= best\[sid\]\) \{ nSame\+\+; continue; \}/.test(vs)
  && /if \(sig && st\.settled\[sig\]\) \{ nDup\+\+; continue; \}/.test(vs) && /scoremethod: 'ForceUpdate', format: 'json' \}, ce\.ladderDetails\(f\)\)/.test(vs) && /if \(sig\) delete st\.settled\[sig\]; continue;/.test(vs));
assert('rejections -> offense ledger (absolute cumulative score + offenseDetails) + hourly histogram + mail decision (ceSendMail, no seedcap import = no circular require)', /offenseRows\[sid\] = \{ score: of\.n, details: ce\.offenseDetails\(nowMin, plan\.fields, plan\.reason\) \};/.test(vs)
  && /st\.rejects\[nowHour\] = \(st\.rejects\[nowHour\] \| 0\) \+ 1;/.test(vs) && /const md = ce\.mailDecision\(st\.rejects, nowHour, st\.mailHour \| 0, CE_MAIL_MIN\);/.test(vs) && /async function ceSendMail\(subject, text\)/.test(vs) && !/^const seedcap = require/m.test(vs));
assert('state file persisted by the workflow', /campaign-endless\.json/.test(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'validate.yml'), 'utf8')));

console.log(failN ? ('\nFAIL ' + failN) : '\nall green');
process.exit(failN ? 1 : 0);
