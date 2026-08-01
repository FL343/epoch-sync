'use strict';
// Redeem channel invariants: wire codecs, bitmap helpers and the pure grant plan.
// The catalog itself is value-locked against the client registry by the companion
// repo's schema-lockstep suite; here we lock shape and semantics.
const { REDEEM_MAGIC, GRANT_MAGIC, GRANT_WORDS, REDEEM_CATALOG, decodeRedeemWant, decodeGrantMask, grantBit, setGrantBit, popcountWords, redeemPlan } = require('../validate.js');

let n = 0;
function ok(cond, msg) { n++; if (!cond) { console.error('FAIL ' + msg); process.exit(1); } console.log('ok ' + n + ' ' + msg); }

// magic allocation stays distinct from every other wire magic in use
ok(REDEEM_MAGIC === 0xCE && GRANT_MAGIC === 0xCF, 'magic pair 0xCE/0xCF');
ok(GRANT_WORDS === 2, 'bitmap is 2 words (64 entitlements)');

// catalog shape: ascending small bits, positive prices, gate only where intended
const bits = Object.keys(REDEEM_CATALOG).map(Number).sort((a, b) => a - b);
ok(bits.length === 5 && bits[0] === 0 && bits[4] === 4, 'catalog covers bits 0..4');
ok(bits.every(b => (REDEEM_CATALOG[b].cp | 0) > 0), 'all prices positive');
ok(REDEEM_CATALOG[0].gateLp === 2000 && bits.slice(1).every(b => REDEEM_CATALOG[b].gateLp == null), 'only bit 0 carries the ladder gate (floor 2000)');

// codecs
ok(JSON.stringify(decodeRedeemWant([0xCE | (1 << 8), 123, 17, 2])) === JSON.stringify([17, 2]), 'want decode');
ok(decodeRedeemWant([0xCD, 0, 1, 0]) === null && decodeRedeemWant([0xCE, 0]) === null, 'want decode rejects wrong magic / short');
ok(JSON.stringify(decodeGrantMask([0xCF | (1 << 8), 9, 5, 0])) === JSON.stringify([5, 0]), 'grant decode');
ok(decodeGrantMask([0xCE, 0, 1, 0]) === null, 'grant decode rejects want magic');

// bit helpers
const w = [0, 0];
setGrantBit(w, 0); setGrantBit(w, 33);
ok(grantBit(w, 0) === 1 && grantBit(w, 33) === 1 && grantBit(w, 1) === 0, 'set/get across words');
ok(popcountWords(w) === 2 && popcountWords([-1, 0]) === 32, 'popcount');

// plan: ascending greedy, skip granted/unknown/gated/unaffordable, funds tracked per pick
{
  const want = [0, 0]; setGrantBit(want, 0); setGrantBit(want, 1); setGrantBit(want, 4); setGrantBit(want, 9);
  // bit0 gated-out, bit1 1500 affordable, bit4 800 affordable, bit9 unknown
  let p = redeemPlan(want, [0, 0], 2500, { 0: false });
  ok(JSON.stringify(p.bits) === JSON.stringify([1, 4]) && p.balance === 200, 'plan: gate blocks bit0, grants 1+4, funds tracked');
  // gate open but funds only cover bit0 partially -> cheaper later item still lands
  p = redeemPlan(want, [0, 0], 900, { 0: true });
  ok(JSON.stringify(p.bits) === JSON.stringify([4]) && p.balance === 100, 'plan: unaffordable early item does not block a cheaper later one');
  // already granted bits are skipped (idempotency without state)
  const granted = [0, 0]; setGrantBit(granted, 1);
  p = redeemPlan(want, granted, 9999, { 0: true });
  ok(JSON.stringify(p.bits) === JSON.stringify([0, 4]) && p.balance === 9999 - 3000 - 800, 'plan: granted bit skipped, replay harmless');
  // nothing wanted -> empty plan
  p = redeemPlan([0, 0], [0, 0], 9999, {});
  ok(p.bits.length === 0 && p.balance === 9999, 'plan: empty want = no-op');
  // wallet debt (negative balance) can never buy
  p = redeemPlan(want, [0, 0], -50, { 0: true });
  ok(p.bits.length === 0, 'plan: negative balance grants nothing');
}

console.log('redeem: all ' + n + ' assertions passed');
