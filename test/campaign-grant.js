'use strict';
// campaign-grant.js - O159 knife-7d: campaign clear attestation decode/verify/grant plan (cron read side)
//   Mirrors mvp/test/lib/campaign-record.js (the reference encoder); the guard's C++ is the only production
//   encoder. Negative cases are the same triplets the mvp side asserts, so the two decoders cannot drift.
const path = require('path');
const crypto = require('crypto');
const C = require(path.join(__dirname, '..', 'campaign.js'));
const V = require(path.join(__dirname, '..', 'validate.js'));
let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond, extra) => { if (cond) ok(label); else bad(label + (extra ? ' -- ' + extra : '')); };

// reference encoder (test-only: real records are signed by the guard)
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function encodeSid(sid) { const b = BigInt(String(sid)); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }
function buildBase(m) {
  const sid = encodeSid(m.steamId);
  return [(C.CAMP_MAGIC | (C.CAMP_VER << 8)) | 0, m.keyId | 0, m.tierBits | 0, m.lastU | 0, m.credited | 0, m.elapsedMin | 0,
    sid[0], sid[1], m.firstAtMin | 0, m.lastAtMin | 0, (((m.fast | 0) & 0xffff) | (((m.skip | 0) & 0xffff) << 16)) | 0];
}
function buildSigned(m, seedHex) {
  const base = buildBase(m);
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, C.toBytes(base), key);
  const d = base.slice();
  for (let i = 0; i < C.SIG_INTS; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function pubOf(seedHex) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
}

console.log('=== campaign-grant: constants ===');
assert('constants: magic 0xB9 / ver 1 / base 11 / sig 16 / U 54,162 / bits banner 6 title 5', C.CAMP_MAGIC === 0xB9 && C.CAMP_VER === 1 && C.BASE_LEN === 11 && C.SIG_INTS === 16 && C.U_NORMAL === 54 && C.U_EXPERT === 162 && C.BIT_BANNER === 6 && C.BIT_TITLE === 5);
assert('validate exports CAMPAIGN_LB (default campaign_box) + grant bits are outside REDEEM_CATALOG (exclusive, not purchasable)', V.CAMPAIGN_LB === 'campaign_box' && !V.REDEEM_CATALOG[5] && !V.REDEEM_CATALOG[6]);

console.log('=== campaign-grant: verify + plan ===');
const seed = crypto.createHash('sha256').update('camp-cron-test').digest('hex');
const pub = pubOf(seed);
const TBL = { '2026090301': { pubs: [pub], sealed: true }, 'dev': { pubs: [pub], sealed: false } };
const meta = { keyId: 2026090301, tierBits: 1, lastU: 54, credited: 54, elapsedMin: 60, steamId: '76561198000000001', firstAtMin: 29800000, lastAtMin: 29800060, fast: 2, skip: 1 };
const rec = buildSigned(meta, seed);
const v = verifyOk(rec);
function verifyOk(d) { return C.verifyCampaignRecord(d, TBL); }
assert('sealed record verifies + fields (tier 1 / lastU 54 / credited 54 / owner sid / fast 2 / skip 1)', v.ok && v.sealed && v.fields.tierBits === 1 && v.fields.lastU === 54 && v.fields.credited === 54 && v.fields.steamId === '76561198000000001' && v.fields.fast === 2 && v.fields.skip === 1);
assert('plan: owner match -> [6] (banner)', JSON.stringify(C.campaignGrantPlan(v, { owner: '76561198000000001' }).bits) === '[6]');
const v3 = verifyOk(buildSigned(Object.assign({}, meta, { tierBits: 3, lastU: 162, credited: 162 }), seed));
assert('expert clear -> [6,5] (banner + title)', v3.ok && JSON.stringify(C.campaignGrantPlan(v3, { owner: '76561198000000001' }).bits) === '[6,5]');
assert('owner mismatch -> no bits (identity binding: signature != identity)', C.campaignGrantPlan(v, { owner: '76561198000000002' }).reason === 'owner-mismatch');
const vd = verifyOk(buildSigned(Object.assign({}, meta, { keyId: 0 }), seed));
assert('dev key: verifies but settles only with allowDevKey (*_test board)', vd.ok && !vd.sealed && C.campaignGrantPlan(vd, { owner: meta.steamId }).reason === 'dev-key-on-prod' && JSON.stringify(C.campaignGrantPlan(vd, { owner: meta.steamId, allowDevKey: true }).bits) === '[6]');
assert('unknown keyId -> pending (key table lag), not rejected', (() => { const u = C.verifyCampaignRecord(buildSigned(Object.assign({}, meta, { keyId: 2099010101 }), seed), TBL); return !u.ok && u.pending && u.reason === 'unknown-key'; })());
assert('tampered credited -> bad-sig', (() => { const t = rec.slice(); t[4] = 1; return C.verifyCampaignRecord(t, TBL).reason === 'bad-sig'; })());
assert('signed but tier unproven (credited 10) -> tier-proof; tierBits 0 -> tier', C.verifyCampaignRecord(buildSigned(Object.assign({}, meta, { credited: 10 }), seed), TBL).reason === 'tier-proof' && C.verifyCampaignRecord(buildSigned(Object.assign({}, meta, { tierBits: 0 }), seed), TBL).reason === 'tier');
assert('zero-padded tail ok / non-zero tail -> trailing / unknown ver -> pending / bad magic -> magic / short -> short',
  C.verifyCampaignRecord(rec.concat(new Array(64 - rec.length).fill(0)), TBL).ok === true && C.verifyCampaignRecord(rec.concat([0, 7]), TBL).reason === 'trailing'
  && (() => { const t = rec.slice(); t[0] = (C.CAMP_MAGIC | (2 << 8)); return C.verifyCampaignRecord(t, TBL).pending === true; })()
  && C.verifyCampaignRecord([0xB1].concat(rec.slice(1)), TBL).reason === 'magic' && C.verifyCampaignRecord(rec.slice(0, 20), TBL).reason === 'short');
assert('decodeCampaign: null on wrong shape; fields on right shape', C.decodeCampaign([1, 2, 3]) === null && C.decodeCampaign(rec).keyName === '2026090301');

console.log('=== campaign-grant: validate.js wiring pins ===');
const fs = require('fs');
const vs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('processCampaignGrants defined + PT_MODE hard-off + client-writable campaign board + owner binding + allowDevKey only *_test', /const processCampaignGrants = async \(\) => \{\s*if \(PT_MODE\) return;/.test(vs)
  && /findOrCreateBoard\(CAMPAIGN_LB, false\)/.test(vs) && /campaign\.campaignGrantPlan\(v, \{ owner: sid, allowDevKey \}\)/.test(vs) && /const allowDevKey = \/_test\$\/\.test\(CAMPAIGN_LB\);/.test(vs));
assert('called on all three exit paths right after processRedeems', (vs.match(/await processRedeems\(null\); await processCampaignGrants\(\);/g) || []).length === 2 && /await processRedeems\(cp\);\s*await processCampaignGrants\(\);/.test(vs));
assert('grant write = grant_box mask OR (GRANT_MAGIC|ver<<8, tMin, w0, w1) ForceUpdate, no wallet debit', /const det = \[\(GRANT_MAGIC \| \(GRANT_VER << 8\)\) \| 0, Math\.floor\(nowMs \/ 60000\) \| 0, newMask\[0\] \| 0, newMask\[1\] \| 0\];[\s\S]{0,400}campaign grant write failed/.test(vs) && !/campaign[\s\S]{0,1200}wallet debit/.test(vs.slice(vs.indexOf('const processCampaignGrants'))));

console.log(failN ? ('\nFAIL ' + failN) : '\nall green');
process.exit(failN ? 1 : 0);
