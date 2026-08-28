'use strict';
// test/sanctions.js -- pure-function coverage for the sanction sync pipeline.
const assert = require('assert');
process.env.STATE_SALT = process.env.STATE_SALT || 'testsalt';
const s = require('../sanctions.js');

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); pass++; console.log('  ok    ' + name); }

// ---- normalizeEvents: field-name tolerance + logId filter ----
{
  const j = {
    elements: [
      { logId: 5, eventType: 1, productUserId: 'p1', identityProvider: 'steam', accountId: '123', pending: false, action: 'RESTRICT_GAME_ACCESS' },
      { id: 7, type: 3, puid: 'p2', identityProviderId: 'steam', account_id: '456' },
      { logID: 0, eventType: 1 },   // logId 0 -> dropped
    ],
  };
  const evs = s.normalizeEvents(j);
  ok('normalizeEvents: 2 valid (logId>0), field-name tolerant', evs.length === 2);
  ok('normalizeEvents: create event fields mapped', evs[0].logId === 5 && evs[0].eventType === 1 && evs[0].idp === 'steam' && evs[0].accountId === '123');
  ok('normalizeEvents: delete event via alt names', evs[1].logId === 7 && evs[1].eventType === 3 && evs[1].accountId === '456');
  ok('normalizeEvents: array root + events[] shapes', s.normalizeEvents([{ logId: 1, eventType: 1 }]).length === 1 && s.normalizeEvents({ events: [{ logId: 2, eventType: 2 }] }).length === 1);
  ok('normalizeEvents: empty/garbage -> []', s.normalizeEvents(null).length === 0 && s.normalizeEvents({}).length === 0);
}

// ---- sidOfEvent: identity provider gate + 32/64-bit conversion ----
{
  const base = s.SID64_BASE;
  ok('sidOfEvent: non-steam idp -> null', s.sidOfEvent({ idp: 'epicgames', accountId: '123' }) === null);
  ok('sidOfEvent: no accountId -> null', s.sidOfEvent({ idp: 'steam', accountId: '' }) === null);
  ok('sidOfEvent: 17-digit id passthrough', s.sidOfEvent({ idp: 'steam', accountId: '76561198000000001' }) === '76561198000000001');
  ok('sidOfEvent: 32-bit account number -> steamid64', s.sidOfEvent({ idp: 'steam', accountId: '1' }) === String(base + 1n));
  ok('sidOfEvent: STEAM case-insensitive', s.sidOfEvent({ idp: 'STEAM', accountId: '2' }) === String(base + 2n));
  ok('sidOfEvent: out-of-range number -> null', s.sidOfEvent({ idp: 'steam', accountId: '999999999999' }) === null);
}

// ---- verbOf: eventType + pending -> verb ----
{
  ok('verbOf: type1 + not pending -> ban', s.verbOf({ eventType: 1, pending: false }) === 'ban');
  ok('verbOf: type1 + pending -> skip (awaiting review)', s.verbOf({ eventType: 1, pending: true }) === 'skip');
  ok('verbOf: type2 update + not pending -> ban (re-enforce)', s.verbOf({ eventType: 2, pending: false }) === 'ban');
  ok('verbOf: type3 delete -> unban (even if pending flag noise)', s.verbOf({ eventType: 3, pending: true }) === 'unban');
  ok('verbOf: unknown type -> skip', s.verbOf({ eventType: 9, pending: false }) === 'skip');
}

// ---- expiryMinOf: epoch sec / ms / ISO -> unix minutes, 0 for past/permanent ----
{
  const future = Date.now() + 3600 * 1000;
  ok('expiryMinOf: null -> 0 (permanent)', s.expiryMinOf(null) === 0);
  ok('expiryMinOf: past -> 0', s.expiryMinOf(1000) === 0);
  ok('expiryMinOf: future epoch-ms -> minutes', s.expiryMinOf(future) === Math.floor(future / 60000));
  ok('expiryMinOf: future epoch-sec -> minutes', s.expiryMinOf(Math.floor(future / 1000)) === Math.floor(Math.floor(future / 1000) * 1000 / 60000));
  const iso = new Date(future).toISOString();
  ok('expiryMinOf: ISO string -> minutes', s.expiryMinOf(iso) === Math.floor(Date.parse(iso) / 60000));
}

// ---- hex round-trip: hexFromInts -> validate.decodeDetails ----
{
  const v = require('../validate.js');
  const hex = s.hexFromInts([1, 720000, -5]);
  const back = v.decodeDetails(hex);
  ok('hexFromInts -> decodeDetails round-trip (int32-LE)', back[0] === 1 && back[1] === 720000 && back[2] === -5);
  ok('hexToPct: 2 bytes -> %xx%xx', s.hexToPct('ab01') === '%ab%01');
}

// ---- constants lockstep with client eac-gate (ban board name) ----
{
  ok("BAN_LB == 'ban_board' (client eac-gate BOARD_BAN lockstep)", s.BAN_LB === 'ban_board');
  ok("shadow suffix '_banned'", s.BAN_SHADOW_SUFFIX === '_banned');
}

console.log('ALL PASS (sanctions ' + pass + ')');
