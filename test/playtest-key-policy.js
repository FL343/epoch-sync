'use strict';
// Per-channel attest key policy (cloud audit R1-A5-07, 2026-10-08).
//   The key table serves the three reconcile jobs; each job loads it through attest.applyKeyPolicy, so a key labeled with
//   another channel, retired for more than the grace window (and past keepUntil) or revoked does not verify. A record signed by
//   such a key is PENDING (reason 'key-...'): soft, never a reject, never an offense, never marked processed. A sealed key with no
//   valid label is accepted everywhere (fail-open) and named in a warning.
//   File name: the playtest- prefix makes all three job gates run it (validate.yml runs test/*.js, playtest.yml and demo.yml run
//   test/playtest-*.js). Fixed clock + synthetic tables only: no live data, no network (a red test here stops every settlement).
//   A) applyKeyPolicy / keyHoldReason on synthetic tables
//   B) verdicts through the three verifiers (solo / campaign / campaign endless) + their settle gates
//   C) the job's channel (validate.KEY_CHANNEL) from the workflow environment
//   D) wiring: every production read of attest-keys.json goes through the policy
//   E) a held segment never makes its run's later (honest, live-key) segments reject on the chain clock
//   node test/playtest-key-policy.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const A = require(path.join(__dirname, '..', 'attest.js'));
const C = require(path.join(__dirname, '..', 'campaign.js'));
const CE = require(path.join(__dirname, '..', 'campaign-endless.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

// ---- helpers ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function keypair(tag) {
  const seed = crypto.createHash('sha256').update('key-policy-' + tag).digest();
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return { priv, pub: crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex') };
}
function signed(base, priv, toBytes) {
  const sig = crypto.sign(null, toBytes(base), priv);
  const d = base.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const SID = '76561198000000001';
const sidLo = Number(BigInt(SID) & 0xFFFFFFFFn) | 0, sidHi = Number((BigInt(SID) >> 32n) & 0xFFFFFFFFn) | 0;
function soloRec(keyId, priv) {   // attVer 3 layout (25 ints before the signature), one seat
  return signed([0xB1, 3, 7, A.hash32('m1'), 77, 0, 1, 0, 1, 600, 5000, 0, sidLo, sidHi, 1, 6, 0, 0, 0, 0,
    keyId | 0, 3, 0, 0, 0], priv, A.toBytes);
}
function campRec(keyId, priv) {
  return signed([(C.CAMP_MAGIC | (C.CAMP_VER << 8)) | 0, keyId | 0, 1, 54, 54, 60, sidLo, sidHi, 29800000, 29800060, 0], priv, C.toBytes);
}
function grRec(keyId, priv) {
  return signed([(CE.GR_MAGIC | (CE.GR_VER << 8)) | 0, keyId | 0, 1, 3, 900, 300, sidLo, sidHi, 29800000, 29800010, 0, (1 << 8) | 4, 1788300000], priv, CE.toBytes);
}

const NOW = Date.parse('2026-10-20T00:00:00Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const kDemoOld = keypair('demo-old'), kDemoLive = keypair('demo-live'), kPlay = keypair('playtest'), kEa = keypair('ea');
const kBare = keypair('bare'), kRevoked = keypair('revoked'), kDev = keypair('dev'), kForeign = keypair('foreign'), kKeep = keypair('keep');
function table() {
  return {
    2026100101: { pubs: [kDemoOld.pub], sealed: true, at: iso(NOW - 19 * DAY), pubInfo: { [kDemoOld.pub]: { ch: 'demo', retiredAt: iso(NOW - 10 * DAY) } } },
    2026101401: { pubs: [kDemoLive.pub], sealed: true, at: iso(NOW - 6 * DAY), pubInfo: { [kDemoLive.pub]: { ch: 'demo', retiredAt: iso(NOW - 3 * DAY) } } },   // retired inside the grace
    2026092101: { pubs: [kPlay.pub, kDemoOld.pub], sealed: true, pubInfo: { [kPlay.pub]: { ch: 'playtest' }, [kDemoOld.pub]: { ch: 'demo' } } },   // one buildNum, two channels' packages
    2026111701: { pubs: [kEa.pub], sealed: true, pubInfo: { [kEa.pub]: { ch: 'ea' } } },
    2026101501: { pubs: [kBare.pub], sealed: true },   // sealed key without a label (a table edited by a tool before the fix)
    2026100201: { pubs: [kKeep.pub], sealed: true, pubInfo: { [kKeep.pub]: { ch: 'demo', retiredAt: iso(NOW - 20 * DAY), keepUntil: iso(NOW + 2 * DAY) } } },   // retired, kept by hand
    2026101601: { pubs: [kRevoked.pub], sealed: true, pubInfo: { [kRevoked.pub]: { ch: 'demo', revokedAt: iso(NOW - 1 * DAY) } } },
    dev: { pubs: [kDev.pub], sealed: false },
  };
}
const pol = (channel, extra) => Object.assign({ channel, nowMs: NOW }, extra || {});

console.log('== A) applyKeyPolicy ==');
{
  const t = table();
  assert('constants: channels ea/playtest/demo, grace 7 days', JSON.stringify(A.KEY_CHANNELS) === '["ea","playtest","demo"]' && A.KEY_RETIRE_GRACE_MS === 7 * DAY);
  const ea = A.applyKeyPolicy(t, pol('ea'));
  assert('ea job: its own key usable', ea['2026111701'].pubs.length === 1 && ea['2026111701'].held.length === 0);
  assert('ea job: a demo key is held (channel)', ea['2026101401'].pubs.length === 0 && ea['2026101401'].held[0].reason === 'channel');
  assert('ea job: the playtest key is held (channel)', ea['2026092101'].held.some(h => h.pub === kPlay.pub && h.reason === 'channel'));
  const demo = A.applyKeyPolicy(t, pol('demo'));
  assert('demo job: key retired 3 days ago (inside the 7-day grace) still usable', demo['2026101401'].pubs[0] === kDemoLive.pub);
  assert('demo job: key retired 10 days ago is held (retired)', demo['2026100101'].held.length === 1 && demo['2026100101'].held[0].reason === 'retired');
  assert('demo job: one buildNum with a playtest and a demo pub -> only the demo pub usable', JSON.stringify(demo['2026092101'].pubs) === JSON.stringify([kDemoOld.pub]) && demo['2026092101'].held[0].pub === kPlay.pub);
  assert('every job: the unlabeled sealed key stays usable (fail-open, as before the fix)', ['ea', 'playtest', 'demo', null].every(ch => A.applyKeyPolicy(t, pol(ch))['2026101501'].pubs[0] === kBare.pub));
  let wl = [];
  A.applyKeyPolicy(t, pol('demo', { onWarn: (m) => wl.push(m) }));
  assert('... and is named in ONE warning per load', wl.length === 1 && /2026101501/.test(wl[0]) && !/2026101401/.test(wl[0]), JSON.stringify(wl));
  const typo = { 2026101701: { pubs: [kBare.pub], sealed: true, pubInfo: { [kBare.pub]: { ch: 'Demo' } } } };
  assert('a label that is not a channel name counts as unlabeled (usable + warned)', (() => { wl = []; const o = A.applyKeyPolicy(typo, pol('ea', { onWarn: (m) => wl.push(m) })); return o['2026101701'].pubs.length === 1 && wl.length === 1; })());
  const revOnly = { 2026101801: { pubs: [kBare.pub], sealed: true, pubInfo: { [kBare.pub]: { revokedAt: iso(NOW - DAY) } } }, 2026101901: { pubs: [kKeep.pub], sealed: true } };
  const ro = A.applyKeyPolicy(revOnly, pol('demo'));
  assert('revokedAt on an unlabeled table holds that key only (the lever never holds the others)', (ro['2026101801'].held[0] || {}).reason === 'revoked' && ro['2026101901'].pubs.length === 1);
  assert('keepUntil keeps a retired key usable until then', demo['2026100201'].pubs[0] === kKeep.pub &&
    A.applyKeyPolicy(t, pol('demo', { nowMs: NOW + 3 * DAY }))['2026100201'].held[0].reason === 'retired');
  assert('keepUntil never lifts another channel or a revocation', ea['2026100201'].held[0].reason === 'channel');
  assert('demo job: the revoked key is held at once (revoked, no grace)', demo['2026101601'].held[0].reason === 'revoked');
  const ex = A.applyKeyPolicy(t, pol('demo', { exempt: new Set(['2026100101']) }));
  assert('exempt (one-shot recovery keys) lifts retirement only', ex['2026100101'].pubs.length === 1 && A.applyKeyPolicy(t, pol('demo', { exempt: ['2026101601'] }))['2026101601'].held[0].reason === 'revoked');
  const none = A.applyKeyPolicy(t, pol(null));
  assert('channel unknown (null) -> binding off, retirement still applies', none['2026111701'].pubs.length === 1 && none['2026101501'].pubs.length === 1 && none['2026100101'].held[0].reason === 'retired');
  assert('dev key untouched by any policy', ['ea', 'playtest', 'demo', null].every(ch => A.applyKeyPolicy(t, pol(ch)).dev.pubs[0] === kDev.pub));
  const shorter = A.applyKeyPolicy(t, pol('demo', { graceMs: DAY }));
  assert('graceMs override: 1 day -> the key retired 3 days ago is held', shorter['2026101401'].held[0].reason === 'retired');
  assert('input table not mutated', !('held' in t['2026101401']) && t['2026101401'].pubs.length === 1);
  let warned = 0;
  const legacy = { 2026100101: { pubs: [kDemoOld.pub], sealed: true }, dev: { pubs: [kDev.pub], sealed: false } };
  const off = A.applyKeyPolicy(legacy, pol('ea', { onWarn: () => warned++ }));
  assert('a table with no labels at all (pre-fix tools) -> every key usable as before + one warning', off['2026100101'].pubs.length === 1 && off['2026100101'].held.length === 0 && warned === 1);
  assert('no policy -> the table as stored', A.applyKeyPolicy(t, null) === t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-'));
  const file = path.join(dir, 'attest-keys.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, keys: t }));
  assert('loadPubTable(file) without a policy = the stored keys (unchanged behaviour)', JSON.stringify(A.loadPubTable(file)) === JSON.stringify(t));
  assert('loadPubTable(file, policy) = the filtered table', A.loadPubTable(file, pol('ea'))['2026101401'].held[0].reason === 'channel');
  assert('loadPubTable on a missing file -> null (with or without a policy)', A.loadPubTable(path.join(dir, 'nope.json'), pol('ea')) === null && A.loadPubTable(path.join(dir, 'nope.json')) === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('== B) verdicts through the verifiers ==');
{
  const t = table();
  const ea = A.applyKeyPolicy(t, pol('ea')), demo = A.applyKeyPolicy(t, pol('demo'));
  // solo
  const sDemo = soloRec(2026101401, kDemoLive.priv);
  const vEa = A.verifySoloRecord(sDemo, ea);
  assert('solo: demo-signed record on the ea job -> pending key-channel (not bad-sig)', !vEa.ok && vEa.pending === true && vEa.reason === 'key-channel', JSON.stringify(vEa.reason));
  const gEa = A.soloSettleGate(vEa, { owner: SID, allowDevKey: false });
  assert('solo gate: held -> settle false, pending (the lane neither flags nor marks it processed)', gEa.settle === false && gEa.pending === true);
  assert('solo: same record on the demo job settles', A.soloSettleGate(A.verifySoloRecord(sDemo, demo), { owner: SID, allowDevKey: false }).settle === true);
  const vOld = A.verifySoloRecord(soloRec(2026100101, kDemoOld.priv), demo);
  assert('solo: record by a key retired past the grace -> pending key-retired', !vOld.ok && vOld.pending && vOld.reason === 'key-retired');
  assert('solo: plain table (no policy) -> the same record verifies (verdicts unchanged without a policy)', A.verifySoloRecord(soloRec(2026100101, kDemoOld.priv), t).ok === true);
  const forged = A.verifySoloRecord(soloRec(2026101401, kForeign.priv), ea);
  assert('solo: a signature by NO registered key on a known keyId is still bad-sig (a held key is not a free pass to pending)', !forged.ok && forged.reason === 'bad-sig' && !forged.pending);
  const unk = A.verifySoloRecord(soloRec(2026123101, kForeign.priv), ea);
  assert('solo: unknown keyId still unknown-key pending', unk.reason === 'unknown-key' && unk.pending === true);
  const vDev = A.verifySoloRecord(soloRec(0, kDev.priv), ea);
  assert('solo: dev key verifies under the policy; the dev gate still refuses it on a real board', vDev.ok && A.soloSettleGate(vDev, { owner: SID, allowDevKey: false }).reason === 'dev-key-on-prod');
  // campaign
  const cEa = C.verifyCampaignRecord(campRec(2026101401, kDemoLive.priv), ea);
  const cPlan = C.campaignGrantPlan(cEa, { owner: SID });
  assert('campaign: demo-signed record on the ea job -> pending key-channel, no bits', !cEa.ok && cEa.pending && cEa.reason === 'key-channel' && cPlan.bits.length === 0 && cPlan.pending === true);
  assert('campaign: an ea-signed record still grants on the ea job', C.campaignGrantPlan(C.verifyCampaignRecord(campRec(2026111701, kEa.priv), ea), { owner: SID }).bits.length === 1);
  assert('campaign: foreign signature on a held keyId -> bad-sig', C.verifyCampaignRecord(campRec(2026101401, kForeign.priv), ea).reason === 'bad-sig');
  // campaign endless (Gold Rush)
  const gr = CE.verifyGrRecord(grRec(2026100101, kDemoOld.priv), A.applyKeyPolicy(t, pol('ea')));
  const sp = CE.settlePlan(gr, { owner: SID, boxDif: 1 });
  assert('gold rush: held key -> pending (settlePlan pending = no offense ledger, no mail count)', !gr.ok && gr.pending && /^key-/.test(gr.reason) && sp.ok === false && sp.pending === true);
  assert('gold rush: ea-signed record verifies on the ea job', CE.verifyGrRecord(grRec(2026111701, kEa.priv), ea).ok === true);
  assert('gold rush: foreign signature on a held keyId -> bad-sig (still an offense)', CE.verifyGrRecord(grRec(2026101401, kForeign.priv), ea).reason === 'bad-sig');
}

console.log('== C) job channel from the workflow environment ==');
{
  const probe = (env) => {
    const r = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require(process.argv[1]).KEY_CHANNEL))", path.join(__dirname, '..', 'validate.js')],
      { env: Object.assign({}, process.env, { PT_MODE: '', APPID: '', DEMO_APPID: '' }, env), encoding: 'utf8' });
    return r.status === 0 ? r.stdout : 'ERR ' + r.stderr.slice(0, 200);
  };
  assert('main job (PT_MODE unset) -> ea', probe({ APPID: '111' }) === 'ea');
  assert('demo twin (PT_MODE=1, APPID == DEMO_APPID) -> demo', probe({ PT_MODE: '1', APPID: '333', DEMO_APPID: '333' }) === 'demo');
  assert('playtest twin (PT_MODE=1, APPID != DEMO_APPID) -> playtest', probe({ PT_MODE: '1', APPID: '222', DEMO_APPID: '333' }) === 'playtest');
  assert('PT_MODE=1 without DEMO_APPID -> null (binding off, retirement still on)', probe({ PT_MODE: '1', APPID: '222' }) === 'null');
  const wf = (f) => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
  assert('playtest.yml and demo.yml both export DEMO_APPID + PT_MODE (what KEY_CHANNEL relies on)', ['playtest.yml', 'demo.yml'].every(f => /DEMO_APPID:/.test(wf(f)) && /PT_MODE: '1'/.test(wf(f))));
  assert('seedcap.yml names every job channel (SEEDCAP_CHANNEL ea / playtest / demo)', ['ea', 'playtest', 'demo'].every(c => new RegExp('SEEDCAP_CHANNEL: ' + c + '\\b').test(wf('seedcap.yml'))));
}

console.log('== D) wiring ==');
{
  const strip = (s) => s.replace(/\/\/.*$/gm, '');
  const v = strip(fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8'));
  const s = strip(fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8'));
  const direct = (v.match(/attest\.loadPubTable\(/g) || []).length;
  assert('validate.js reads the key table in ONE place (loadJobPubTable), with the job policy', direct === 1 && /function loadJobPubTable\(nowMs, exempt\) \{[\s\S]{0,240}?return attest\.loadPubTable\([\s\S]{0,120}?attest-keys\.json'\), \{\s*channel: KEY_CHANNEL,/.test(v), 'direct=' + direct);
  assert("validate.js: no other code path names 'attest-keys.json'", (v.match(/attest-keys\.json/g) || []).length === 1);
  const uses = (v.match(/loadJobPubTable\(/g) || []).length;
  assert('validate.js: recovery / campaign / campaign endless / solo lanes all load through loadJobPubTable', uses >= 5, 'uses=' + uses);
  assert('validate.js: the recovery keys stay readable for the recovery pick and RECOVERED solo segments only (exempt = recCfg.keys)',
    /recoverPick\(rows, recCfg, loadJobPubTable\(Date\.now\(\), recCfg\.keys\)/.test(v) && /const soloPub = loadJobPubTable\(nowMs\) \|\| \{\};/.test(v) &&
    /const soloPubRec = recCfg \? \(loadJobPubTable\(nowMs, recCfg\.keys\)/.test(v) && /verifySoloRecord\(cand\.d, cand\.recovered \? soloPubRec : soloPub\)/.test(v));
  const sc = s.match(/attest\.loadPubTable\([^;]*;/g) || [];
  assert('seedcap.js: every key table read passes the job policy (channel: SEEDCAP_CHANNEL)', sc.length >= 1 && sc.every(x => /channel: SEEDCAP_CHANNEL/.test(x)), sc.join(' | '));
  assert('held solo segments are counted (RUN.keyHeld / keyHeldNew) and shown in the step summary', /RUN\.keyHeld = \(RUN\.keyHeld \| 0\) \+ 1/.test(v) && /s\('keyHeld', 0\)/.test(v) && /s\('keyHeldNew', 0\)/.test(v));
  assert('a NEW held solo segment raises a warning (soloKeyHeld first sighting -> ghWarn)', /if \(soloKeyHeld\(soloState, [^)]*\)[^)]*\)\) \{\s*RUN\.keyHeldNew[^;]*;\s*ghWarn\(/.test(v));
  assert('waitOr consults soloRunHasHeld before its reject clock', /const waitOr = \(reason\) => \{\s*if \(soloRunHasHeld\(st, key, m, nowMs\)\)/.test(v));
}

console.log('== E) a held segment never costs its run the later segments ==');
{
  const V = require(path.join(__dirname, '..', 'validate.js'));
  const W = V.COMP.CHAIN_WAIT_MS;
  const p = 'p1', key = V.soloRunKey(p, 1, 4242);
  const f2 = { startDepth: 5, endDepth: 10, flags: 0, seasonId: 1, runSeed: 4242 };            // continuing segment 5->10
  const fR = { startDepth: 5, endDepth: 8, flags: A.SEG_RESUMED, seasonId: 1, runSeed: 4242 };   // resumed from a save at 5
  // baseline: no held segment -> the chain clock rejects after CHAIN_WAIT_MS (unchanged behaviour)
  {
    const st = { runs: {}, wait: {}, ms: {}, held: {} };
    assert('baseline: an unchained segment waits ...', V.soloChainPlan(st, key, f2, 'm2', NOW).ok === null);
    assert('... and rejects once CHAIN_WAIT_MS passed (chain-gap)', V.soloChainPlan(st, key, f2, 'm2', NOW + W + 1).ok === false);
  }
  // the predecessor 0->5 is held (key-retired): its successors keep waiting past CHAIN_WAIT_MS, never reject
  {
    const st = { runs: {}, wait: {}, ms: {}, held: {} };
    assert('first sighting of a held segment -> soloKeyHeld true (warn once)', V.soloKeyHeld(st, key, 'm1', '2026100701', 'key-retired', NOW) === true);
    assert('second sighting -> false (no second warning), clock t refreshed', V.soloKeyHeld(st, key, 'm1', '2026100701', 'key-retired', NOW + DAY) === false && st.held.m1.t0 === NOW && st.held.m1.t === NOW + DAY);
    let worst = null;
    for (let d = 0; d <= 30; d++) {   // the held segment is re-sighted every run; 30 days of successor attempts
      const t = NOW + d * DAY;
      V.soloKeyHeld(st, key, 'm1', '2026100701', 'key-retired', t);
      const a = V.soloChainPlan(st, key, f2, 'm2', t), b = V.soloChainPlan(st, key, fR, 'm3', t);
      if (a.ok === false || b.ok === false) { worst = d + ': ' + JSON.stringify([a, b]); break; }
    }
    assert('continuing (chain-gap) and resumed (save-orphan) successors never reject while the run has a held segment (30 days)', worst === null, worst);
    // the table is fixed: the held segment settles (soloAdvance clears the hold), the successor chains at once
    V.soloAdvance(st, key, { startDepth: 0, endDepth: 5, flags: 0 }, 'm1', { ok: true, proven: 0 }, NOW + 31 * DAY);
    assert('table fixed -> the held segment settles and leaves st.held', !st.held.m1);
    assert('... and the continuing successor chains (ok:true)', V.soloChainPlan(st, key, f2, 'm2', NOW + 31 * DAY).ok === true);
  }
  // a held segment that left the board stops protecting after CHAIN_WAIT_MS (its successors then follow the normal clock again)
  {
    const st = { runs: {}, wait: {}, ms: {}, held: {} };
    V.soloKeyHeld(st, key, 'm1', '2026100701', 'key-retired', NOW);
    V.soloChainPlan(st, key, f2, 'm2', NOW + W);   // still protected at the edge (clock restarted)
    assert('a held segment not re-sighted for CHAIN_WAIT_MS protects no more', V.soloChainPlan(st, key, f2, 'm2', NOW + W + 1).ok === null &&
      V.soloChainPlan(st, key, f2, 'm2', NOW + 2 * W + 2).ok === false);
  }
  // another run's held segment does not protect this run
  {
    const st = { runs: {}, wait: {}, ms: {}, held: {} };
    V.soloKeyHeld(st, V.soloRunKey(p, 1, 9999), 'mx', '2026100701', 'key-retired', NOW);
    V.soloChainPlan(st, key, f2, 'm2', NOW);
    assert('a held segment of ANOTHER run changes nothing here', V.soloChainPlan(st, key, f2, 'm2', NOW + W + 1).ok === false);
  }
}

if (failN) { console.log('\n[key-policy] FAIL ' + failN); process.exit(1); }
console.log('\n[key-policy] ALL PASS');
