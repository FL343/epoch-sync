'use strict';
// auditTrusted: every entry on a trusted-writes board must hash into the union of state
// keys (skill / xp / leavers / signals.players); anything outside = foreign-writer
// violation. State keys without a board entry are benign (post-wipe) and only counted.
process.env.STATE_SALT = process.env.STATE_SALT || 'audit-test-salt';
const { auditTrusted } = require('../audit.js');
const { pid } = require('../validate.js');

let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL ' + msg); process.exit(1); } console.log('ok ' + n + ' ' + msg); }

const A = '76561190000000001', B = '76561190000000002', C = '76561190000000003', D = '76561190000000004', X = '76561190000000099';

// 1) clean closure across all four state sources
let r = auditTrusted(
  { rating: [A], points: [B], xp: [C], trust: [D] },
  { skill: { [pid(A)]: {}, [pid(B)]: {} }, leavers: { [pid(B)]: {} }, xp: { [pid(C)]: {} }, signals: { players: { [pid(D)]: {} } } });
ok(r.violations.length === 0, 'union closure: entries covered by any state source pass');
ok(r.entries === 4 && r.known === 4, 'entry/known counts (' + r.entries + '/' + r.known + ')');

// 2) foreign entry -> violation naming the board label, pseudonym only
r = auditTrusted({ points: [A, X] }, { skill: { [pid(A)]: {} }, xp: {}, leavers: {}, signals: {} });
ok(r.violations.length === 1, 'foreign entry flagged (' + r.violations.length + ')');
ok(r.violations[0].indexOf('points') === 0, 'violation names the board label');
ok(r.violations[0].indexOf(pid(X).slice(0, 8)) >= 0, 'violation uses 8-hex pseudonym');
ok(r.violations[0].indexOf(X) < 0, 'violation never contains the raw steamID');

// 3) state-only is benign and counted (post-wipe shape: state kept, boards emptied)
r = auditTrusted({ rating: [] }, { skill: { [pid(A)]: {}, [pid(B)]: {} }, xp: {}, leavers: {}, signals: {} });
ok(r.violations.length === 0 && r.stateOnly === 2, 'state without board entries = benign count (' + r.stateOnly + ')');

// 4) empty everything
r = auditTrusted({}, { skill: {}, xp: {}, leavers: {}, signals: {} });
ok(r.violations.length === 0 && r.entries === 0 && r.known === 0, 'empty audit is clean');


// 5) O276 (client knife 5.1b): every cron-written endless ladder is in the closure; season twins match exactly <seasoned base>_s<digits>
const AU = require('../audit.js');
ok(['endless_board_solo', 'endless_board_overall', 'endless_comp_solo', 'endless_comp_quad', 'endless_comp_overall', 'endless_classic_duo', 'endless_classic_overall'].every(nm => AU.ENDLESS_TRUSTED.indexOf(nm) >= 0), 'trusted endless ladders listed by name (casual / competitive / classic families + the three composites)');
ok(JSON.stringify(AU.seasonTwinOf('endless_board_s1')) === JSON.stringify({ base: 'endless_board', season: 1 }) && JSON.stringify(AU.seasonTwinOf('endless_comp_overall_s2')) === JSON.stringify({ base: 'endless_comp_overall', season: 2 }) && JSON.stringify(AU.seasonTwinOf('endless_board_overall_s1')) === JSON.stringify({ base: 'endless_board_overall', season: 1 }), 'season twins of the base board and of the seasoned families are found');
ok(AU.seasonTwinOf('endless_board_solo') === null && AU.seasonTwinOf('endless_classic_solo_s1') === null && AU.seasonTwinOf('endless_save_box_solo_s1') === null && AU.seasonTwinOf('lp_ladder_s1') === null, 'a ladder is not a twin of endless_board by prefix; classic (lifetime only) / save boxes (client-writable) / points never match');

// 6) O520 likes lane (W79): the like box is inventory only (client-writable), the like counts are inventory + trusted closure
const VL = require('../validate.js');
ok(JSON.stringify(AU.LIKE_BOARDS) === JSON.stringify([[VL.LIKE_BOX_LB, 'like box'], [VL.LIKE_COUNT_LB, 'like count']]) && VL.LIKE_BOX_LB === 'like_box' && VL.LIKE_COUNT_LB === 'like_count', 'like boards in the inventory (like_box / like_count)');
ok(AU.LIKE_TRUSTED.length === 1 && AU.LIKE_TRUSTED[0][0] === 'like_count', 'only the like counts are in the trusted closure (the box is client-writable)');
const auSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'audit.js'), 'utf8');
ok(/for \(const w of LIKE_BOARDS\) want\.push\(w\)/.test(auSrc) && /for \(const w of LIKE_TRUSTED\) trustedWant\.push\(w\)/.test(auSrc), 'audit main wires both lists');
r = auditTrusted({ 'like count': [A, X] }, { skill: {}, xp: { [pid(A)]: {} }, leavers: {}, signals: {} });
ok(r.violations.length === 1 && r.violations[0].indexOf('like count') === 0, 'a like count row for a player without settled XP is a foreign entry');

// 7) O919 (2026-11-19; audit red 11-18 / 11-19): the grant box has four writer lanes; three reach players outside the state closure
//   (campaign-only clears, DLC / classic owners whose only record never settled). The grant label gets their extra sources, alone.
{
  const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
  const CAMP = require('../campaign.js');
  const S1 = '76561190000000011', S2 = '76561190000000012', S3 = '76561190000000013', S4 = '76561190000000014';
  const noState = { skill: {}, xp: {}, leavers: {}, signals: {} };
  // reference campaign encoder (same as test/campaign-grant.js; real records are signed by the guard)
  const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
  const seed = crypto.createHash('sha256').update('audit-o919-camp').digest('hex');
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
  const pubHex = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
  const campRec = (sid, keyId) => {
    const b = BigInt(sid);
    const base = [(CAMP.CAMP_MAGIC | (CAMP.CAMP_VER << 8)) | 0, keyId | 0, 1, 54, 54, 90, Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, 100, 190, 0];
    const sig = crypto.sign(null, CAMP.toBytes(base), priv);
    const d = base.slice(); for (let i = 0; i < CAMP.SIG_INTS; i++) d.push(sig.readInt32LE(i * 4));
    return d;
  };
  const KEY = 2026111901;
  const live = { [String(KEY)]: { pubs: [pubHex], sealed: true } };
  const held = { [String(KEY)]: { pubs: [], held: [{ pub: pubHex, reason: 'retired' }], sealed: true } };

  ok(AU.campaignRowExplains(campRec(S3, KEY), S3, live, false) === true, 'O919 a sealed campaign clear explains its owner');
  ok(AU.campaignRowExplains(campRec(S3, KEY), S4, live, false) === false, 'O919 a clear sitting on someone else\'s row explains nobody (owner binding)');
  ok(AU.campaignRowExplains(campRec(S3, KEY), S3, held, false) === true, 'O919 a clear signed by a since-retired (held) key still explains its owner (no red after key rotation)');
  ok(AU.campaignRowExplains(campRec(S3, KEY), S4, held, false) === false, 'O919 held key: the owner binding still applies');
  const junk = campRec(S3, KEY); junk[2] = 3;   // tampered after signing
  ok(AU.campaignRowExplains(junk, S3, live, false) === false && AU.campaignRowExplains(junk, S3, held, false) === false, 'O919 a tampered / garbage campaign row explains nobody');
  ok(AU.campaignRowExplains(campRec(S3, 99), S3, live, false) === false, 'O919 an unknown build key explains nobody');

  const sup = { [pid(S1)]: { o: 0, f: 29915781, c: 29915900, w: 1, x: 0 },   // refunded owner: f stays
                [pid(S4)]: { o: 0, f: 0, c: 29915781, w: 0, x: 0 } };        // probed, never owned
  const classic = { [pid(S2)]: { o: 0, c: 29915781, n: 1 } };
  const rows = [{ steamID: S3, details: campRec(S3, KEY) }, { steamID: S4, details: campRec(S3, KEY) }];
  const gx = AU.grantClosureExtra(sup, classic, rows, (d, owner) => AU.campaignRowExplains(d, owner, live, false));
  ok(gx.set.has(pid(S1)) && gx.set.has(pid(S2)) && gx.set.has(pid(S3)) && !gx.set.has(pid(S4)) && gx.supporter === 1 && gx.classic === 1 && gx.campaign === 1,
    'O919 extra = ever-detected supporter owners + classic-probed + verified campaign clears; a probed non-owner and a misplaced clear are not in it');

  // the two real shapes: 11-18 (DLC owners whose only run was rejected) and 11-19 (campaign-only players)
  r = auditTrusted({ grant: [S1, S2, S3] }, noState, { grant: gx.set });
  ok(r.violations.length === 0, 'O919 grant rows of supporter / classic / campaign-only players are not foreign');
  ok(r.known === 0 && r.stateOnly === 0, 'O919 the extras do not enter the state closure counts');
  r = auditTrusted({ grant: [S1, S4] }, noState, { grant: gx.set });
  ok(r.violations.length === 1 && r.violations[0].indexOf('grant') === 0 && r.violations[0].indexOf(pid(S4).slice(0, 8)) >= 0, 'O919 a grant row nothing explains is still foreign');
  r = auditTrusted({ rating: [S1], points: [S2], xp: [S3], grant: [S1] }, noState, { grant: gx.set });
  ok(r.violations.length === 3 && r.violations.every(x => x.indexOf('grant') !== 0), 'O919 the extras cover the grant label only: a rating / points / xp row of the same players is still foreign');

  // class tripwire: every grant-box write in validate.js sits in a lane audit.js lists
  const vSrc = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const WRITE = '(GRANT_MAGIC | (GRANT_VER << 8))';
  const sites = vSrc.split(WRITE).length - 1;
  ok(sites === AU.GRANT_LANES.length, 'O919 grant-box write sites in validate.js (' + sites + ') == lanes the audit knows (' + AU.GRANT_LANES.length + ') -- a new writer lane goes into audit.js GRANT_LANES with its closure source');
  const laneBody = (name) => { const a = vSrc.indexOf('const ' + name + ' = async'); if (a < 0) return ''; const b = vSrc.indexOf('\n  const process', a + 10); return vSrc.slice(a, b < 0 ? vSrc.length : b); };
  ok(AU.GRANT_LANES.every(nm => laneBody(nm).indexOf(WRITE) >= 0), 'O919 each listed lane really writes the grant box (' + AU.GRANT_LANES.join(', ') + ')');
  ok(/auditTrusted\(trusted, state, extraByLabel\)/.test(auSrc) && /extraByLabel\.grant = gx\.set;/.test(auSrc) && /loadJson\(v\.SUPPORTERS_FILE, \{\}\), loadJson\(v\.CLASSIC_FILE, \{\}\), campaignRows/.test(auSrc), 'O919 audit main feeds the grant extras (supporter / classic state + campaign box) into the closure check');

  // mutation self-checks: each mutation of audit.js turns one of the checks above red
  const ROOT = path.join(__dirname, '..').replace(/\\/g, '/');
  const mutant = (good, bad) => {
    if (auSrc.indexOf(good) < 0) throw new Error('mutation anchor missing: ' + good.slice(0, 80));
    const m = auSrc.split(good).join(bad).replace(/require\('\.\//g, "require('" + ROOT + '/');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-o919-mut-'));
    const p = path.join(dir, 'audit.js'); fs.writeFileSync(p, m);
    try { return require(p); } finally { delete require.cache[p]; try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  };
  const muts = [
    ['the closure check ignores the extras', 'if (!known.has(h) && !(extra && extra.has(h)))', 'if (!known.has(h))',
      (M) => M.auditTrusted({ grant: [S1] }, noState, { grant: gx.set }).violations.length !== 0],
    ['the extras cover every label', 'const extra = (extraByLabel && extraByLabel[label]) || null;', 'const extra = (extraByLabel && extraByLabel.grant) || null;',
      (M) => M.auditTrusted({ rating: [S1] }, noState, { grant: gx.set }).violations.length === 0],
    ['a refunded supporter drops out (o only)', '(e.f | 0) > 0 || (e.o | 0) === 1', '(e.o | 0) === 1',
      (M) => !M.grantClosureExtra(sup, {}, [], () => false).set.has(pid(S1))],
    ['a held-key clear stops explaining', "return !!(vd.pending && /^key-/.test(String(vd.reason || '')) && vd.fields && String(vd.fields.steamId) === String(owner));", 'return false;',
      (M) => M.campaignRowExplains(campRec(S3, KEY), S3, held, false) === false],
    ['the campaign owner binding is dropped', 'campaign.campaignGrantPlan(vd, { owner, allowDevKey })', 'campaign.campaignGrantPlan(vd, { allowDevKey })',
      (M) => M.campaignRowExplains(campRec(S3, KEY), S4, live, false) === true],
  ];
  // control: a no-op mutant loads (so a load error cannot pass for a catch) and every check is green on the real code
  let ctl = null; try { ctl = mutant('module.exports = {', 'module.exports = {'); } catch (e) { ctl = null; }
  ok(ctl && typeof ctl.auditTrusted === 'function' && muts.every(([, , , isRed]) => !isRed(AU) && !isRed(ctl)), 'O919 mutation control: the unmutated audit.js passes every mutation check (loaded the same way)');
  for (const [name, good, bad, isRed] of muts) {
    let red = false;
    try { red = !!isRed(mutant(good, bad)); } catch (e) { red = true; }
    ok(red, 'O919 mutation "' + name + '" is caught');
  }
}

console.log('audit-invariants: all ' + n + ' assertions passed');
