'use strict';
// campaign-story-settle.js - companion knife 5d (O603): campaign story clear attestation decode/verify/boundary plan (cron read side)
//   Mirrors the companion repo's test/lib/story-record.js reference encoder; the guard's C++ (story_record.h) is the only
//   production encoder. The companion's ledger-schema-lockstep section 28c replays the same fixtures through both decoders.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const CS = require(path.join(__dirname, '..', 'campaign-story.js'));
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
  return [(CS.ST_MAGIC | ((m.ver || CS.ST_VER) << 8)) | 0, m.keyId | 0, m.dif | 0, m.passes | 0, m.score | 0, m.elapsedSec | 0, sid[0], sid[1], m.firstAtMin | 0, m.lastAtMin | 0,
    (sat8(m.fast) | (sat8(m.skip) << 8) | (sat8(m.incons) << 16)) | 0, m.fails | 0, m.runT0 | 0,
    (((m.resumes | 0) & 0xffff) | (((m.rowResumes | 0) & 0xffff) << 16)) | 0, 0, 0];
}
function buildSigned(m, seedHex) {
  const base = buildBase(m);
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, CE.toBytes(base), key);
  const d = base.slice();
  for (let i = 0; i < CS.SIG_INTS; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function pubOf(seedHex) {
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  return crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
}

console.log('=== campaign-story: constants + cap table ===');
assert('constants: magic 0xBF / ver 1 / base 16 / sig 16 / 55-level run / one boat level / 40s floor / 600s cap / 1e5 fails / runT0 floor 2026-11-01 / offense 0xC8',
  CS.ST_MAGIC === 0xBF && CS.ST_VER === 1 && CS.BASE_LEN === 16 && CS.SIG_INTS === 16 && CS.RING_STORY === 55 && CS.BOAT_LEVELS === 1 && CS.MIN_PASS_SEC === 40 && CS.MAX_CREDIT_SEC === 600
  && CS.MAX_FAILS === 100000 && CS.RUN_T0_FLOOR === Date.UTC(2026, 10, 1) / 1000 && CS.OFFENSE_MAGIC === 0xC8 && CS.baseLenOf(1) === 16 && CS.baseLenOf(2) === null);
assert('reason codes: the Gold Rush table plus notclear 50 / fails 51 / dup-run 52 (the Gold Rush table itself untouched)', CS.REASON_CODE.notclear === 50 && CS.REASON_CODE.fails === 51 && CS.REASON_CODE['dup-run'] === 52
  && CS.REASON_CODE.overcap === 30 && CS.REASON_CODE['bad-sig'] === 1 && CE.REASON_CODE.notclear === undefined);
assert('validate exports: story box / ladder prefixes, checkpoint board, offense board (default prod names; suffix shared with the Gold Rush lane)',
  V.CAMPAIGN_STORY_BOX_PREFIX === 'campaign_story_box_d' && V.CAMPAIGN_STORY_LB_PREFIX === 'campaign_story_d' && V.CAMPAIGN_STORY_SAVE_LB === 'campaign_story_save_box' && V.CAMPAIGN_STORY_OFFENSE_LB === 'campaign_story_offense' && typeof V.storyStateOf === 'function');
const caps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'gr-caps.json'), 'utf8'));
const sumCap = (d) => caps.storyRing.reduce((a, k) => a + caps.levels[k].cap[d - 1], 0);
assert('gr-caps.json storyRing: 55 levels, W1L1..18, the W2 L0 boat level at index 18, then W2L1..W3L18; the Gold Rush ring unchanged (54, no 2_0)',
  caps.storyRing.length === 55 && caps.storyRing[0] === '1_1' && caps.storyRing[17] === '1_18' && caps.storyRing[18] === '2_0' && caps.storyRing[19] === '2_1' && caps.storyRing[54] === '3_18'
  && caps.ring.length === 54 && caps.ring.indexOf('2_0') < 0);
assert('boat level cap 3144 (2 x 572 + 2000) on all three difficulties; 55-level sums 624750 / 747140 / 738662', JSON.stringify(caps.levels['2_0'].cap) === '[3144,3144,3144]'
  && sumCap(1) === 624750 && sumCap(2) === 747140 && sumCap(3) === 738662, [sumCap(1), sumCap(2), sumCap(3)].join('/'));

console.log('=== campaign-story: verify + settle plan ===');
const seed = crypto.createHash('sha256').update('story-cron-test').digest('hex');
const pub = pubOf(seed);
const TBL = { '2026111701': { pubs: [pub], sealed: true }, 'dev': { pubs: [pub], sealed: false } };
const runT0 = 1793500000;
const t0Min = Math.floor(runT0 / 60);
const meta = { keyId: 2026111701, dif: 2, passes: 55, score: 512345, elapsedSec: 55 * 70, steamId: '76561198000000001', firstAtMin: t0Min + 1, lastAtMin: t0Min + 200,
  fast: 0, skip: 0, incons: 0, fails: 3, runT0, resumes: 2, rowResumes: 1 };
const rec = buildSigned(meta, seed);
const v = CS.verifyStoryRecord(rec, TBL);
const planOf = (vv, over) => CS.storySettlePlan(vv, Object.assign({ owner: meta.steamId, allowDevKey: false, boxDif: 2, caps, nowSec: runT0 + 86400 }, over || {}));
const signed = (over) => CS.verifyStoryRecord(buildSigned(Object.assign({}, meta, over), seed), TBL);
assert('sealed record verifies + fields (dif 2 / passes 55 / score / owner / fails 3 / runT0 / resumes 2 / rowResumes 1)', rec.length === 32 && v.ok && v.sealed && v.fields.dif === 2 && v.fields.passes === 55
  && v.fields.score === 512345 && v.fields.steamId === meta.steamId && v.fields.fails === 3 && v.fields.runT0 === runT0 && v.fields.resumes === 2 && v.fields.rowResumes === 1);
assert('honest clear -> ok, cap = the dif 2 55-level sum', planOf(v).ok === true && planOf(v).cap === sumCap(2), JSON.stringify(planOf(v)));
assert('owner mismatch -> owner-mismatch / wrong difficulty box -> difbox', planOf(v, { owner: '76561198000000002' }).reason === 'owner-mismatch' && planOf(v, { boxDif: 1 }).reason === 'difbox');
const vd = CS.verifyStoryRecord(buildSigned(Object.assign({}, meta, { keyId: 0 }), seed), TBL);
assert('dev key: verifies but settles only with allowDevKey (*_test suffix)', vd.ok && !vd.sealed && planOf(vd).reason === 'dev-key-on-prod' && planOf(vd, { allowDevKey: true }).ok === true);
assert('unknown keyId -> pending (key table lag), not rejected', (() => { const u = signed({ keyId: 2099010101 }); return !u.ok && u.pending && u.reason === 'unknown-key' && CS.storySettlePlan(u, {}).pending === true; })());
assert('tampered score -> bad-sig / zero tail ok / non-zero tail -> trailing / unknown ver -> pending / Gold Rush magic -> magic / short -> short',
  (() => { const t = rec.slice(); t[4] = 1; return CS.verifyStoryRecord(t, TBL).reason === 'bad-sig'; })()
  && CS.verifyStoryRecord(rec.concat(new Array(64 - rec.length).fill(0)), TBL).ok === true && CS.verifyStoryRecord(rec.concat([0, 7]), TBL).reason === 'trailing'
  && (() => { const t = rec.slice(); t[0] = (CS.ST_MAGIC | (2 << 8)); const r = CS.verifyStoryRecord(t, TBL); return r.pending === true && r.reason === 'ver'; })()
  && CS.verifyStoryRecord([0xBB].concat(rec.slice(1)), TBL).reason === 'magic' && CS.verifyStoryRecord(rec.slice(0, 20), TBL).reason === 'short');
assert('tampered reserved int [14] -> bad-sig (signed)', (() => { const t = rec.slice(); t[14] = 9; return CS.verifyStoryRecord(t, TBL).reason === 'bad-sig'; })());
assert('B2: not a full clear (54 / 0 passes) -> notclear; fast / skip / incons > 0 -> that reason',
  planOf(signed({ passes: 54 })).reason === 'notclear' && planOf(signed({ passes: 0 })).reason === 'notclear'
  && planOf(signed({ fast: 1 })).reason === 'fast' && planOf(signed({ skip: 2 })).reason === 'skip' && planOf(signed({ incons: 1 })).reason === 'incons');
assert('B3 pace: 54 x 40s is enough (the boat level is exempt), one second less -> pace-fast', planOf(signed({ elapsedSec: 54 * 40 })).ok === true && planOf(signed({ elapsedSec: 54 * 40 - 1 })).reason === 'pace-fast');
assert('B3 pace: (55 + fails) x 600s is the ceiling (a retry is another timed attempt), one more second -> pace-slow',
  planOf(signed({ elapsedSec: (55 + 3) * 600, lastAtMin: t0Min + 2000 })).ok === true && planOf(signed({ elapsedSec: (55 + 3) * 600 + 1, lastAtMin: t0Min + 2000 })).reason === 'pace-slow');
assert('B3 wall clock from runT0: credited minutes beyond the span -> clock; offline days between sessions are fine', planOf(signed({ lastAtMin: t0Min + 30 })).reason === 'clock'
  && planOf(signed({ lastAtMin: t0Min + 3 * 1440 })).ok === true);
assert('B4: score above the 55-level cap sum -> overcap; exactly the sum -> ok', planOf(signed({ score: sumCap(2) + 1 })).reason === 'overcap' && planOf(signed({ score: sumCap(2) })).ok === true);
assert('B5: far below the summed minimum values -> lowscore SIGNAL only', (() => { const p = planOf(signed({ score: 100 })); return p.ok === true && p.flags.indexOf('lowscore') >= 0; })());
assert('B6: fails > 1e5 -> fails / dif 4 -> dif / runT0 before 2026-11-01 or after now+1d or after the first pass -> runt0 / negative score -> score',
  planOf(signed({ fails: 100001 })).reason === 'fails' && CS.storyBoundaryPlan(Object.assign({}, v.fields, { dif: 4 }), caps).reason === 'dif'
  && planOf(signed({ runT0: 1790000000, firstAtMin: Math.floor(1790000000 / 60) + 1 })).reason === 'runt0' && planOf(signed({ runT0: runT0 + 200000 }), { nowSec: runT0 }).reason === 'runt0'
  && planOf(signed({ firstAtMin: t0Min - 1 })).reason === 'runt0' && planOf(signed({ score: -5 })).reason === 'score');
assert('no story cap table -> captable (fail-closed); a table whose storyRing is not 55 long -> captable', CS.storyBoundaryPlan(v.fields, { ring: caps.ring, levels: caps.levels }).reason === 'captable'
  && CS.storyBoundaryPlan(v.fields, Object.assign({}, caps, { storyRing: caps.storyRing.slice(1) })).reason === 'captable');

console.log('=== campaign-story: one clear per run + details ===');
assert('runPlan: first sighting / same signature again (not a dup) / another signature for the same (account, dif, runT0) -> dup-run / another runT0 or difficulty or account -> no dup', (() => {
  const runs = {};
  const sig = CS.sigHexOf(rec);
  const a = CS.runPlan(runs, 'p1', v.fields, sig);
  if (!(a.first && !a.dup && a.key === 'p1:2:' + runT0)) return false;
  runs[a.key] = { sig, t: 1 };
  const again = CS.runPlan(runs, 'p1', v.fields, sig);
  const other = signed({ score: 600000 });
  const dup = CS.runPlan(runs, 'p1', other.fields, CS.sigHexOf(buildSigned(Object.assign({}, meta, { score: 600000 }), seed)));
  const otherRun = CS.runPlan(runs, 'p1', signed({ runT0: runT0 + 60 }).fields, 'x');
  const otherDif = CS.runPlan(runs, 'p1', signed({ dif: 1 }).fields, 'x');
  const otherAcct = CS.runPlan(runs, 'p2', v.fields, 'x');
  return !again.dup && !again.first && dup.dup && !otherRun.dup && otherRun.first && !otherDif.dup && !otherAcct.dup;
})());
assert('ladder details = [elapsedSec, fails, keyId, flags, resumes | rowResumes << 16, runT0]; offense details = [0xC8, tMin, dif, code, passes, score]',
  JSON.stringify(CS.storyLadderDetails(v.fields)) === JSON.stringify([55 * 70, 3, 2026111701, 0, 2 | (1 << 16), runT0])
  && JSON.stringify(CS.offenseDetails(12345, v.fields, 'notclear')) === JSON.stringify([0xC8, 12345, 2, 50, 55, 512345]));
assert('sigHexOf: 128 hex chars; differs across two runs of one account', /^[0-9a-f]{128}$/.test(CS.sigHexOf(rec)) && CS.sigHexOf(rec) !== CS.sigHexOf(buildSigned(Object.assign({}, meta, { runT0: runT0 + 1 }), seed)));

console.log('=== campaign-story: validate.js wiring pins ===');
const vs = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
assert('processCampaignStory defined + PT_MODE hard-off + no storyRing = lane skipped + client-writable boxes + trusted ladders + checkpoint board created client-writable',
  /const processCampaignStory = async \(\) => \{\s*if \(PT_MODE\) return;/.test(vs) && /if \(!Array\.isArray\(caps\.storyRing\)\) \{ ghWarn\('campaign story: gr-caps\.json has no storyRing -- lane skipped'\); return; \}/.test(vs)
  && /if \(!byName\(CAMPAIGN_STORY_SAVE_LB\)\) await findOrCreateBoard\(CAMPAIGN_STORY_SAVE_LB, false\);/.test(vs)
  && /cs\.storySettlePlan\(v, \{ owner: sid, allowDevKey, boxDif: dif, caps, nowSec \}\)/.test(vs));
assert('called on all three exit paths right after the Gold Rush lane', (vs.match(/await processCampaignEndless\(\); await processCampaignStory\(\);/g) || []).length === 3);
assert('one clear per run checked before settling (no offense row) + best-only ForceUpdate + failed write un-settles the signature and the run',
  /const rp = cs\.runPlan\(sst\.runs, pid\(sid\), f, sig\);\s*if \(rp\.dup\) \{ nRun\+\+; if \(sig\) sst\.settled\[sig\] = nowMin;[^\n]*continue; \}/.test(vs) && !/rp\.dup[^\n]*offenseRows/.test(vs)
  && /scoremethod: 'ForceUpdate', format: 'json' \}, cs\.storyLadderDetails\(f\)\)/.test(vs) && /if \(sig\) delete sst\.settled\[sig\]; if \(rp\.first\) delete sst\.runs\[rp\.key\]; continue;/.test(vs));
assert('state rides in campaign-endless.json under story (settled / runs / offenses / rejects / mailHour) and is pruned on the same horizon', (() => {
  const st = V.storyStateOf({});
  return JSON.stringify(Object.keys(st)) === JSON.stringify(['settled', 'runs', 'offenses', 'rejects', 'mailHour']) && /if \(st\.story\) \{   \/\/ knife 5d/.test(vs)
    && /saveCe\(stAll, nowMs\);/.test(vs);
})());
assert('saveCe prunes old story signatures / runs / reject hours and keeps fresh ones (temp state file)', (() => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  const old = process.cwd();
  try {
    process.chdir(dir);
    const nowMs = Date.UTC(2026, 11, 1), nowMin = Math.floor(nowMs / 60000), nowHour = Math.floor(nowMs / 3600000);
    const st = { settled: {}, offenses: {}, rejects: {}, forks: {}, story: { settled: { a: nowMin - 200 * 1440, b: nowMin }, runs: { r1: { sig: 'a', t: nowMin - 200 * 1440 }, r2: { sig: 'b', t: nowMin } }, offenses: {}, rejects: { [nowHour - 60]: 1, [nowHour]: 2 }, mailHour: 0 } };
    V.saveCe(st, nowMs);
    const back = JSON.parse(fs.readFileSync(path.join(dir, V.CAMPAIGN_ENDLESS_FILE), 'utf8'));
    return !back.story.settled.a && back.story.settled.b === nowMin && !back.story.runs.r1 && back.story.runs.r2 && back.story.rejects[nowHour] === 2 && back.story.rejects[nowHour - 60] === undefined;
  } finally { process.chdir(old); }
})());
assert('the Gold Rush lane still reads its own ring (story fields ignored there): honest Gold Rush record still within its cap', (() => {
  const f = { dif: 2, passes: 7, endWorld: 1, endLevel: 8, fast: 0, skip: 0, incons: 0, elapsedSec: 7 * 62, runT0: 1788300000, firstAtMin: Math.floor(1788300000 / 60) + 1, lastAtMin: Math.floor(1788300000 / 60) + 9, score: 41234 };
  const p = CE.boundaryPlan(f, caps, { nowSec: 1788303600 });
  return p.ok === true && p.cap === caps.ring.slice(0, 8).reduce((a, k) => a + caps.levels[k].cap[1], 0);
})());

console.log(failN ? ('\nFAIL ' + failN) : '\nall green');
process.exit(failN ? 1 : 0);
