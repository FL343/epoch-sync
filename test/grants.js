'use strict';
// Steam inventory keepsakes granter: the pure eligibility helpers, the request-id rules and one whole run against
// a fake Steam (boards, ownership, inventory, grant calls recorded). Pins the things that cannot be undone once
// they reach a player's inventory: who gets what, never twice, never from a borrowed / refunded / too-fresh
// license, never a raw account id in the log, and the promo sweep never carrying a request id.
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const fs = require('fs');
const g = require(path.join(__dirname, '..', 'grants.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));
const pp = require(path.join(__dirname, '..', 'points-plan.js'));
const { GRANTS } = g;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond) => (cond ? ok(label) : bad(label));
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (expected ' + b + ')'); };

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2027-01-20T12:00:00Z');
const LAUNCH = Date.parse('2026-11-17T18:00:00Z');
const S1 = '76561198000000001', S2 = '76561198000000002', S3 = '76561198000000003', S4 = '76561198000000004';

console.log('=== grants [1] catalog + tier lines ===');
eq('rank tier lines = the points ladder platinum..grandmaster', GRANTS.RANK_TIERS.map(([, m]) => m), pp.LP_SEG.slice(3).map((s) => s.min));
eq('item ids pinned', [GRANTS.LAMP_IDS, GRANTS.FIRST_WEEKS, GRANTS.CLASSIC, GRANTS.EA_VETERAN, GRANTS.RANK_VERSUS_BASE, GRANTS.RANK_ENDLESS_BASE, GRANTS.LEVEL_ITEMS],
  [[101, 102, 103, 104, 105], 201, 202, 203, 401, 405, [[411, 50], [412, 100], [413, 200]]]);
eq('endless tier order = the rating tiers (TIERS7, bottom to top)', g.ENDLESS_TIER_ORDER, v.RATING.TIERS7.map(([, t]) => t).reverse());

console.log('=== grants [2] ranked peak from the receipt ring ===');
// current 3950 after newest -120 (so 4070 before it), before that +90 (3980), before that +30 (3950)
const ring = [{ mh: 1, delta: -120, flags: 0 }, { mh: 2, delta: 90, flags: 0 }, { mh: 3, delta: 30, flags: 0 }];
eq('peak = points right after the best match still on the row', g.lpPeakOf(3950, ring), 4070);
eq('no ring = current', g.lpPeakOf(2999, []), 2999);
eq('a void entry (delta 0) changes nothing', g.lpPeakOf(3000, [{ mh: 9, delta: 0, flags: 32 }]), 3000);
eq('peak 4070 -> platinum + diamond', g.versusRankItems(4070), [401, 402]);
eq('2999 -> nothing', g.versusRankItems(2999), []);
eq('8000 -> all four', g.versusRankItems(8000), [401, 402, 403, 404]);
// the real ring codec: a row written by the reconcile job decodes to the same walk
const det = pp.lpDetails(null, [{ mh: 11, delta: -50, flags: 0 }, { mh: 12, delta: 60, flags: 0 }]);
eq('peak through the real details codec', g.lpPeakOf(5990, pp.lpDetailsOf(det).ring), 6040);

console.log('=== grants [3] endless tiers / levels ===');
eq('best tier over families', g.bestTier([null, 'gold', 'master', 'silver']), 'master');
eq('master -> endless platinum..master', g.endlessRankItems('master'), [405, 406, 407]);
eq('gold -> nothing', g.endlessRankItems('gold'), []);
eq('unrated -> nothing', g.endlessRankItems(null), []);
eq('level 120 -> 50 + 100 cups', g.levelItems(120), [411, 412]);
eq('level 49 -> nothing', g.levelItems(49), []);

console.log('=== grants [4] own license + purchase items ===');
const own = (sid, iso, extra) => ({ appownership: Object.assign({ ownsapp: true, permanent: true, timestamp: iso, ownersteamid: sid, sitelicense: false, usercanceled: false }, extra || {}) });
eq('own permanent license -> start ms', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z'), S1), Date.parse('2026-11-18T00:00:00Z'));
eq('family share (owner is someone else) -> null', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z', { ownersteamid: S2 }), S1), null);
eq('free weekend (not permanent) -> null', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z', { permanent: false }), S1), null);
eq('cancelled / refunded (ownsapp false) -> null', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z', { ownsapp: false }), S1), null);
eq('user cancelled -> null', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z', { usercanceled: true }), S1), null);
eq('site license -> null', g.ownLicenseMs(own(S1, '2026-11-18T00:00:00Z', { sitelicense: true }), S1), null);
eq('missing answer -> null', g.ownLicenseMs(null, S1), null);
const cfg = { launchMs: LAUNCH, eaEndMs: null, classicAppid: 1 };
const at = (iso) => Date.parse(iso);
eq('launch week buyer, 14 days passed -> first weeks + veteran', g.purchaseItems(at('2026-11-18T00:00:00Z'), null, at('2026-12-02T00:00:01Z'), cfg), [201, 203]);
eq('same buyer, day 13 -> nothing yet (refund window)', g.purchaseItems(at('2026-11-18T00:00:00Z'), null, at('2026-12-01T00:00:00Z'), cfg), []);
eq('bought after the first two weeks -> veteran only', g.purchaseItems(at('2026-12-10T00:00:00Z'), null, NOW, cfg), [203]);
eq('bought after early access ended -> nothing', g.purchaseItems(at('2027-01-01T00:00:00Z'), null, NOW, Object.assign({}, cfg, { eaEndMs: at('2026-12-31T00:00:00Z') })), []);
eq('launch unset -> no first weeks badge', g.purchaseItems(at('2026-11-18T00:00:00Z'), null, NOW, Object.assign({}, cfg, { launchMs: null })), [203]);
eq('classic owner (long ago) -> classic badge', g.purchaseItems(null, at('2025-07-02T00:00:00Z'), NOW, cfg), [202]);
eq('classic off (no appid) -> no badge', g.purchaseItems(null, at('2025-07-02T00:00:00Z'), NOW, Object.assign({}, cfg, { classicAppid: 0 })), []);

console.log('=== grants [5] request ids / candidates / mode / missing ===');
const r1 = g.requestIdOf('salt', S1, 401), r2 = g.requestIdOf('salt', S1, 402), r3 = g.requestIdOf('salt', S2, 401);
assert('request id deterministic', r1 === g.requestIdOf('salt', S1, 401));
assert('request id differs per item and per player', r1 !== r2 && r1 !== r3);
assert('request id is a uint64 decimal, never 0', /^\d+$/.test(r1) && BigInt(r1) > 0n && BigInt(r1) < (1n << 64n));
assert('request id depends on the salt', r1 !== g.requestIdOf('other', S1, 401));
const nowMin = Math.floor(NOW / 60000);
const mrow = (sid, tMin) => ({ steamID: sid, score: 1, detailData: v.encodeDetails([0xB4 | (1 << 8), tMin]) });
const ents = [mrow(S1, nowMin - 5), mrow(S2, nowMin - 30), mrow(S3, nowMin - 3000), mrow('123', nowMin)];
eq('fast window (20 min) -> recent only', g.candidatesOf(ents, NOW, 20, v.decodeDetails), [S1]);
eq('daily window (48 h) -> newest first', g.candidatesOf(ents, NOW, 2880, v.decodeDetails), [S1, S2]);
eq('full (no window) -> every real id', g.candidatesOf(ents, NOW, null, v.decodeDetails), [S1, S2, S3]);
eq('mode: dispatched fast', g.modeOf('fast', NOW), 'fast');
eq('mode: schedule -> daily', g.modeOf('', at('2027-01-20T06:00:00Z')), 'daily');
eq('mode: schedule on the 1st -> full', g.modeOf('', at('2027-02-01T06:00:00Z')), 'full');
eq('missing = earned minus held', g.missingItems([401, 402, 411, 401], [402]), [401, 411]);

console.log('=== grants [6] one whole run against a fake Steam ===');
function fakeSteam(world) {
  const calls = [];
  const boards = Object.keys(world.boards).map((name, i) => ({ name, id: 1000 + i }));
  const byId = (id) => world.boards[(boards.find((b) => String(b.id) === String(id)) || {}).name] || [];
  const json = (o, status) => ({ status: status || 200, ok: (status || 200) < 400, text: async () => JSON.stringify(o) });
  const fetch = async (url, opts) => {
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams.entries());
    const input = opts && opts.body ? JSON.parse(decodeURIComponent(String(opts.body).replace(/^input_json=/, ''))) : null;
    calls.push({ path: u.pathname, q, input, headers: (opts && opts.headers) || {}, url });
    if (u.pathname.endsWith('/GetLeaderboardsForGame/v2/')) return json({ response: { leaderboards: boards } });
    if (u.pathname.endsWith('/GetLeaderboardEntries/v1/')) {
      let ents = byId(q.leaderboardid);
      if (q.datarequest === 'RequestAroundUser') ents = ents.filter((e) => e.steamID === q.steamid);
      return json({ leaderboardEntryInformation: { leaderboardEntries: ents } });
    }
    if (u.pathname.endsWith('/CheckAppOwnership/v4/')) return json((world.own[q.appid] || {})[q.steamid] || { appownership: { ownsapp: false, permanent: false, timestamp: '1970-01-01T00:00:00Z', ownersteamid: '0' } });
    if (u.pathname.endsWith('/GetInventory/v1/')) return json({ response: { item_json: JSON.stringify((world.inv[q.steamid] || []).map((d, i) => ({ itemid: String(i + 1), itemdefid: String(d) }))) } });
    if (u.pathname.endsWith('/AddPromoItem/v1/')) return json({ response: { item_json: '[]' } });
    if (u.pathname.endsWith('/AddItem/v1/')) {
      (world.inv[input.steamid] = world.inv[input.steamid] || []).push(...input.itemdefid);
      return json({ response: { item_json: JSON.stringify(input.itemdefid.map((d) => ({ itemdefid: String(d) }))) } });
    }
    return json({}, 404);
  };
  return { fetch, calls };
}
const lpRow = (sid, score, ringArr) => ({ steamID: sid, score, detailData: v.encodeDetails(pp.lpDetails(null, ringArr || [])) });
const ENV = { APPID: '4815320', STEAM_PUBLISHER_KEY: 'K-TEST-KEY', CLASSIC_APPID: '3777060', GRANTS_LAUNCH_AT: '2026-11-17T18:00:00Z',
  LP_LB: 'lp_ladder', XP_LB: 'xp_ladder', STATE_SALT: 'test-salt', GRANTS_LIVE: '1' };
function world0() {
  const xpFor = (lv) => { let lo = 0, hi = 1e9; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if (v.xpLevelOf(m) >= lv) hi = m; else lo = m + 1; } return lo; };
  return {
    boards: {
      mirror_box: [mrow(S1, nowMin - 10), mrow(S2, nowMin - 600), mrow(S3, nowMin - 5), mrow(S4, nowMin - 90000)],
      lp_ladder_s1: [lpRow(S1, 3950, [{ mh: 1, delta: -120, flags: 0 }]), lpRow(S2, 8100)],
      lp_ladder: [lpRow(S3, 6100)],     // last season's board (S3 peaked in the pre-season)
      xp_ladder: [{ steamID: S1, score: xpFor(55), detailData: '' }],
      endless_rating_solo: [{ steamID: S3, score: 9000, detailData: '' }],
      endless_tiercut: [{ steamID: '76561198000000099', score: 0, detailData: v.encodeDetails(v.tiercutEncode(1, { solo: { N: 50, cuts: [8000, 6000, 5000, 4000, 3000, 2000] } })) }],
    },
    own: {
      4815320: { [S1]: own(S1, '2026-11-20T00:00:00Z'), [S2]: own(S2, '2026-11-20T00:00:00Z', { ownersteamid: S4 }), [S3]: own(S3, '2027-01-15T00:00:00Z') },
      3777060: { [S1]: own(S1, '2025-08-01T00:00:00Z') },
    },
    inv: { [S2]: [404] },
  };
}
(async () => {
  // season 1 is open at NOW (S1 2026-12-01): this season's board is lp_ladder_s1, last season's lp_ladder
  eq('season at the test clock', v.seasonAt(NOW), 1);
  const logs = [];
  let w = world0(); let fk = fakeSteam(w);
  const st = await g.run({ v, env: ENV, nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: (m) => logs.push(m) });
  eq('daily run looked at the 48 h candidates', st.looked, 3);
  eq('S1: diamond peak (4070) + level 55 + first weeks + veteran + classic', w.inv[S1].slice().sort((a, b) => a - b), [201, 202, 203, 401, 402, 411]);
  eq('S2: grandmaster ranks, already held 404 not regranted, borrowed license gets no purchase item', w.inv[S2].slice().sort((a, b) => a - b), [401, 402, 403, 404]);
  eq('S3: last season master + endless 9000 -> grandmaster tier; license too fresh -> no purchase item', w.inv[S3].slice().sort((a, b) => a - b), [401, 402, 403, 405, 406, 407, 408]);
  assert('S4 (mirror row older than 48 h) untouched', !w.inv[S4]);
  const promos = fk.calls.filter((c) => c.path.endsWith('/AddPromoItem/v1/'));
  eq('one promo sweep per candidate', promos.length, 3);
  assert('promo sweep never carries a request id or an item id', promos.every((c) => c.input.requestid === undefined && c.input.itemdefid === undefined && c.input.notify === true));
  const adds = fk.calls.filter((c) => c.path.endsWith('/AddItem/v1/'));
  assert('every AddItem carries the deterministic request id, one item, notify', adds.every((c) => c.input.itemdefid.length === 1 && c.input.requestid === g.requestIdOf('test-salt', c.input.steamid, c.input.itemdefid[0]) && c.input.notify === true));
  assert('the publisher key travels in the header, never in a URL or body', fk.calls.every((c) => c.headers['x-webapi-key'] === 'K-TEST-KEY' && !String(c.url).includes('K-TEST-KEY') && !String(JSON.stringify(c.input || {})).includes('K-TEST-KEY')));
  assert('no raw account id in any log line', logs.every((m) => !/\d{17}/.test(m)));
  // rerun: nothing new granted
  const before = JSON.stringify(w.inv);
  const st2 = await g.run({ v, env: ENV, nowMs: NOW + 60000, mode: 'daily', fetch: fk.fetch, log: () => {} });
  eq('rerun grants nothing new', JSON.stringify(w.inv) === before ? 'same' : 'changed', 'same');
  eq('rerun AddItem count', Object.values(st2.granted).reduce((a, b) => a + b, 0), 0);
  // fast run: result items only, no promo sweep, no ownership
  w = world0(); fk = fakeSteam(w);
  const st3 = await g.run({ v, env: ENV, nowMs: NOW, mode: 'fast', fetch: fk.fetch, log: () => {} });
  eq('fast run: 20 min window -> S1, S3', st3.looked, 2);
  eq('fast run: no promo / ownership calls', [fk.calls.filter((c) => /AddPromoItem|CheckAppOwnership/.test(c.path)).length], [0]);
  eq('fast run: S1 result items only', w.inv[S1].slice().sort((a, b) => a - b), [401, 402, 411]);
  // not live: only the allow list
  w = world0(); fk = fakeSteam(w);
  await g.run({ v, env: Object.assign({}, ENV, { GRANTS_LIVE: '', GRANTS_ALLOW: S3 }), nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: () => {} });
  assert('not live: only the allow-listed account is granted', !w.inv[S1] && w.inv[S3] && w.inv[S3].length > 0);
  // dry: no writes at all
  w = world0(); fk = fakeSteam(w);
  const st4 = await g.run({ v, env: Object.assign({}, ENV, { GRANTS_DRY: '1' }), nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: () => {} });
  assert('dry run: no AddItem / AddPromoItem call', !fk.calls.some((c) => /AddItem|AddPromoItem/.test(c.path)));
  assert('dry run: the plan is still counted', (st4.wouldGrant[401] | 0) === 3);

  // explicit account list instead of the mirror board (smoke / backfill), still behind the allow gate
  w = world0(); fk = fakeSteam(w);
  const st5 = await g.run({ v, env: Object.assign({}, ENV, { GRANTS_SIDS: S4 + ',' + S4 + ',bogus' }), nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: () => {} });
  assert('GRANTS_SIDS: only the listed account is looked at (old mirror row does not matter)', st5.looked === 1 && !fk.calls.some((c) => c.path.endsWith('/GetLeaderboardEntries/v1/') && c.q.leaderboardid === String(1000 + Object.keys(w.boards).indexOf('mirror_box'))));
  w = world0(); fk = fakeSteam(w);
  const st6 = await g.run({ v, env: Object.assign({}, ENV, { GRANTS_SIDS: S1, GRANTS_LIVE: '', GRANTS_ALLOW: S3 }), nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: () => {} });
  assert('GRANTS_SIDS: the allow gate still applies when not live', st6.looked === 0 && !w.inv[S1]);

  console.log('=== grants [7] mutation proofs ===');
  // a granter that sends the promo sweep with a fixed request id would freeze later lamps -- the run test above must catch it
  const src = fs.readFileSync(path.join(__dirname, '..', 'grants.js'), 'utf8');
  assert('source: the promo call body has no requestid', /\/AddPromoItem\/v1\/', \{ appid, steamid: sid, notify: true \}\)/.test(src));
  const mutated = src.replace("/AddPromoItem/v1/', { appid, steamid: sid, notify: true }", "/AddPromoItem/v1/', { appid, steamid: sid, notify: true, requestid: '1' }");
  assert('mutation applied', mutated !== src);
  const tmp = path.join(__dirname, '..', '.mutant-grants-promo.js');
  fs.writeFileSync(tmp, mutated);
  try {
    const gm = require(tmp);
    w = world0(); fk = fakeSteam(w);
    await gm.run({ v, env: ENV, nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: () => {} });
    const p = fk.calls.filter((c) => c.path.endsWith('/AddPromoItem/v1/'));
    assert('mutant (promo with request id) is caught by the promo check', !p.every((c) => c.input.requestid === undefined));
  } finally { fs.unlinkSync(tmp); }
  // a granter that logs a raw id must be caught by the log check
  const leaky = src.replace("log('grants: ' + pid(sid) + ' ' + (dry", "log('grants: ' + sid + ' ' + (dry");
  assert('log mutation applied', leaky !== src);
  const tmp2 = path.join(__dirname, '..', '.mutant-grants-log.js');
  fs.writeFileSync(tmp2, leaky);
  try {
    const gm = require(tmp2);
    w = world0(); fk = fakeSteam(w);
    const l2 = [];
    await gm.run({ v, env: ENV, nowMs: NOW, mode: 'daily', fetch: fk.fetch, log: (m) => l2.push(m) });
    assert('mutant (raw id in the log) is caught by the log check', l2.some((m) => /\d{17}/.test(m)));
  } finally { fs.unlinkSync(tmp2); }

  if (failN) { console.log('\n' + failN + ' FAIL'); process.exit(1); }
  console.log('\nALL PASS');
})().catch((e) => { console.log('  FAIL  threw ' + (e && e.stack)); process.exit(1); });
