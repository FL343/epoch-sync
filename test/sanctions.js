'use strict';
// test/sanctions.js -- pure-function coverage for the sanction sync pipeline.
// Field names and cursor semantics follow the Sanctions Web API docs; the payload
// fixtures below are verbatim shapes captured from a real drill event (2026-08-28).
const assert = require('assert');
process.env.STATE_SALT = process.env.STATE_SALT || 'testsalt';
const s = require('../sanctions.js');
const v = require('../validate.js');

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); pass++; console.log('  ok    ' + name); }

// Verbatim drill event (portal-created sanction): note logId is a UUID STRING and
// identityProvider/accountId are NULL -- the two facts that broke the first cut.
const DRILL = {
  referenceId: '3541ba63-4006-4141-9240-54db3a0abe42',
  timestamp: '2026-08-28T13:20:03.831095Z',
  expirationTimestamp: '2026-08-29T13:20:03.830922Z',
  productUserId: '00026ad26f29426095c58ba6abb938f1',
  pending: false, automated: false, source: 'developer-portal',
  justification: 'drill', action: 'RESTRICT_GAME_ACCESS',
  displayName: 'andrew', identityProvider: null, accountId: null,
  eventType: 1, logId: 'a7f5140f-c808-4c90-b287-a0a502695e59',
};

// ---- normalizeEvents ----
{
  const evs = s.normalizeEvents({ elements: [DRILL] });
  ok('normalizeEvents: drill event parses', evs.length === 1);
  ok('logId kept as STRING (never numeric -- Number() would NaN it away)',
    typeof evs[0].logId === 'string' && evs[0].logId === DRILL.logId);
  ok('null identityProvider/accountId survive as empty strings', evs[0].idp === '' && evs[0].accountId === '');
  ok('puid/action/eventType/refId mapped', evs[0].puid === DRILL.productUserId &&
    evs[0].action === 'RESTRICT_GAME_ACCESS' && evs[0].eventType === 1 && evs[0].refId === DRILL.referenceId);
  ok('events without logId or puid are dropped (unusable as a cursor)',
    s.normalizeEvents({ elements: [{ logId: '', productUserId: 'p' }, { logId: 'x', productUserId: '' }] }).length === 0);
  ok('empty/garbage payload -> []', s.normalizeEvents(null).length === 0 && s.normalizeEvents({}).length === 0);
}

// ---- sidOfEvent (fast path only; resolver is the Connect API) ----
{
  ok('sidOfEvent: null idp (portal sanction) -> null, forcing the Connect lookup',
    s.sidOfEvent(s.normalizeEvents({ elements: [DRILL] })[0]) === null);
  ok('sidOfEvent: steam idp + 17-digit id -> that id',
    s.sidOfEvent({ idp: 'steam', accountId: '76561199842505137' }) === '76561199842505137');
  ok('sidOfEvent: non-steam idp -> null', s.sidOfEvent({ idp: 'epicgames', accountId: '76561199842505137' }) === null);
  ok('sidOfEvent: short/garbage account id -> null (no hand-rolled 32->64 bit math)',
    s.sidOfEvent({ idp: 'steam', accountId: '1' }) === null);
  ok('Connect batch size matches the documented cap (16 productUserId per call)', s.SN_MAP_BATCH === 16);
}

// ---- verbOf ----
{
  ok('verbOf: create + not pending -> ban', s.verbOf({ eventType: 1, pending: false }) === 'ban');
  ok('verbOf: create + pending -> skip (awaiting review)', s.verbOf({ eventType: 1, pending: true }) === 'skip');
  ok('verbOf: update -> ban (re-enforce current state)', s.verbOf({ eventType: 2, pending: false }) === 'ban');
  ok('verbOf: delete -> unban', s.verbOf({ eventType: 3, pending: true }) === 'unban');
  ok('verbOf: unknown type -> skip', s.verbOf({ eventType: 9, pending: false }) === 'skip');
}

// ---- expiryMinOf ----
{
  const future = Date.now() + 3600 * 1000;
  ok('expiryMinOf: null -> 0 (permanent)', s.expiryMinOf(null) === 0);
  ok('expiryMinOf: past -> 0 (already lapsed)', s.expiryMinOf(1000) === 0);
  ok('expiryMinOf: ISO string (the documented SanctionEvent shape) -> unix minutes',
    s.expiryMinOf(new Date(future).toISOString()) === Math.floor(future / 60000));
  ok('expiryMinOf: epoch-ms number -> unix minutes', s.expiryMinOf(future) === Math.floor(future / 60000));
}

// ---- cursor state: string, with migration off the pre-drill numeric field ----
{
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = path.join(os.tmpdir(), 'sn-state-test-' + process.pid + '.json');
  const prev = process.env.SN_STATE_FILE;
  try {
    process.env.SN_STATE_FILE = tmp;
    delete require.cache[require.resolve('../sanctions.js')];
    const s2 = require('../sanctions.js');
    fs.writeFileSync(tmp, JSON.stringify({ lastLogId: 0, boards: { a: 1 } }));
    const st = s2.loadState();
    ok('loadState migrates a numeric lastLogId to "" (first cut wrote 0)', st.lastLogId === '');
    ok('loadState keeps the board id cache across migration', st.boards && st.boards.a === 1);
    fs.writeFileSync(tmp, JSON.stringify({ lastLogId: DRILL.logId, boards: {} }));
    ok('loadState round-trips a real UUID cursor', s2.loadState().lastLogId === DRILL.logId);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
    if (prev === undefined) delete process.env.SN_STATE_FILE; else process.env.SN_STATE_FILE = prev;
    delete require.cache[require.resolve('../sanctions.js')];
  }
}

// ---- detail codec is validate.js's, not a second hand-rolled one ----
{
  const hex = v.encodeDetails([720000, -5]);
  const back = v.decodeDetails(hex);
  ok('exile detail round-trip uses the shared codec (encodeDetails <-> decodeDetails)',
    back.length === 2 && back[0] === 720000 && back[1] === -5);
  ok('sanctions.js exports no private hex/percent encoder',
    s.hexToPct === undefined && s.hexFromInts === undefined);
}

// ---- constants lockstep with the client gate ----
{
  ok("BAN_LB == 'ban_board' (client eac-gate BOARD_BAN lockstep)", s.BAN_LB === 'ban_board');
  ok("shadow suffix '_banned'", s.BAN_SHADOW_SUFFIX === '_banned');
}

// ---- action code (two-state gate: full ban vs matchmaking-only) ----
{
  ok('actionCodeOf: RESTRICT_GAME_ACCESS -> full (1)', s.actionCodeOf('RESTRICT_GAME_ACCESS') === s.ACT_FULL);
  ok('actionCodeOf: RESTRICT_MATCHMAKING -> mm (2)', s.actionCodeOf('RESTRICT_MATCHMAKING') === s.ACT_MM);
  ok('actionCodeOf: unknown/custom action -> full (unknown severity must not widen access)',
    s.actionCodeOf('SOME_CUSTOM_ACTION') === s.ACT_FULL && s.actionCodeOf('') === s.ACT_FULL && s.actionCodeOf(null) === s.ACT_FULL);
  ok('ACT codes pinned (client eac-gate decodes 1=full 2=mm; legacy 0/absent=full)',
    s.ACT_FULL === 1 && s.ACT_MM === 2);
}

// ---- referenceId <-> 4x int32 round-trip (appeal handle in ban_board details) ----
{
  const ints = s.refIdInts(DRILL.referenceId);
  ok('refIdInts: UUID -> exactly 4 int32s', ints.length === 4 && ints.every(x => (x | 0) === x));
  ok('refIdFromInts round-trips the drill UUID byte-exact',
    s.refIdFromInts(ints) === DRILL.referenceId);
  ok('refIdInts: malformed/absent -> all-zero sentinel',
    s.refIdInts('').join(',') === '0,0,0,0' && s.refIdInts('not-a-uuid').join(',') === '0,0,0,0');
  ok('refIdFromInts: all-zero sentinel -> empty string (absent)',
    s.refIdFromInts([0, 0, 0, 0]) === '' && s.refIdFromInts(null) === '');
  ok('high-bit UUID survives the int32 sign boundary (>>>0 on the way back)',
    s.refIdFromInts(s.refIdInts('ffffffff-ffff-ffff-ffff-ffffffffffff')) === 'ffffffff-ffff-ffff-ffff-ffffffffffff');
}

// ---- banDetails layout ([exp, act, ref x4]) + shared-codec round trip ----
{
  const det = s.banDetails(29798629, s.ACT_MM, DRILL.referenceId);
  ok('banDetails: [expMin, actCode, ref0..3] = 6 ints',
    det.length === 6 && det[0] === 29798629 && det[1] === s.ACT_MM);
  const back = v.decodeDetails(v.encodeDetails(det));
  ok('banDetails survives the shared detail codec byte-exact',
    back.join(',') === det.join(',') && s.refIdFromInts(back.slice(2)) === DRILL.referenceId);
}

// ---- expiry sweep (natural lapse never appears in the event stream) ----
{
  const now = Date.now();
  const fut = Math.floor(now / 60000) + 60, past = Math.floor(now / 60000) - 5;
  const row = (sid, expMin, score) => ({ steamID: sid, score: score == null ? 1 : score,
    detailData: v.encodeDetails(s.banDetails(expMin, s.ACT_FULL, DRILL.referenceId)) });
  ok('expiredSids: lapsed row is swept', s.expiredSids([row('76561198000000001', past)], now).join(',') === '76561198000000001');
  ok('expiredSids: future expiry is kept', s.expiredSids([row('76561198000000002', fut)], now).length === 0);
  ok('expiredSids: permanent (exp=0) never sweeps', s.expiredSids([row('76561198000000003', 0)], now).length === 0);
  ok('expiredSids: score<=0 rows ignored', s.expiredSids([row('76561198000000004', past, 0)], now).length === 0);
  ok('expiredSids: legacy single-int details still decode (exp only)',
    s.expiredSids([{ steamID: '76561198000000005', score: 1, detailData: v.encodeDetails([past]) }], now).length === 1);
  ok('expiredSids: empty/garbage input -> []', s.expiredSids(null, now).length === 0 && s.expiredSids([{}], now).length === 0);
}

console.log('ALL PASS (sanctions ' + pass + ')');
