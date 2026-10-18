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

console.log('audit-invariants: all ' + n + ' assertions passed');
