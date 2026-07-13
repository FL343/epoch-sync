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

console.log('audit-invariants: all ' + n + ' assertions passed');
