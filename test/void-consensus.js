'use strict';
const path = require('path');
const { voidByConsensus, isVoidDisp } = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { if (got === exp) ok(label + ' = ' + JSON.stringify(got)); else bad(label + ' = ' + JSON.stringify(got) + ' (EXPECT ' + JSON.stringify(exp) + ')'); };

const FIN = 0, PEERS = 1, HOSTLEFT = 2, TIMEOUT = 3, DISBAND = 4, QUIT = 5, RECONFAIL = 6;
const vc = (codes) => voidByConsensus(codes).isVoid;

console.log('=== consensus VOID ===');

console.log('-- isVoidDisp table --');
eq('finished(0) not VOID', isVoidDisp(FIN), false);
eq('peers-gone(1) not VOID', isVoidDisp(PEERS), false);
eq('host-left(2) VOID', isVoidDisp(HOSTLEFT), true);
eq('timeout(3) VOID', isVoidDisp(TIMEOUT), true);
eq('disband(4) VOID', isVoidDisp(DISBAND), true);
eq('user-quit(5) VOID', isVoidDisp(QUIT), true);
eq('recon-fail(6) VOID', isVoidDisp(RECONFAIL), true);
eq('unknown(7) fallback VOID', isVoidDisp(7), true);
eq('unknown(99) fallback VOID', isVoidDisp(99), true);

console.log('-- 2P (strict majority = unanimous) --');
eq('1v1 both finished -> settle', vc([FIN, FIN]), false);
eq('1v1 finished+peers-gone -> settle', vc([FIN, PEERS]), false);
eq('1v1 split (1 VOID 1 VALID) -> settle', vc([HOSTLEFT, FIN]), false);
eq('1v1 split reversed -> settle', vc([FIN, QUIT]), false);
eq('1v1 both VOID -> void', vc([DISBAND, DISBAND]), true);
eq('1v1 both VOID mixed -> void', vc([HOSTLEFT, RECONFAIL]), true);

console.log('-- 3P (strict majority >=2) --');
eq('3P all finished -> settle', vc([FIN, FIN, FIN]), false);
eq('3P single VOID -> settle', vc([HOSTLEFT, FIN, FIN]), false);
eq('3P 2 VOID -> void', vc([DISBAND, DISBAND, FIN]), true);
eq('3P all VOID -> void', vc([DISBAND, DISBAND, DISBAND]), true);

console.log('-- 4P (strict majority >=3) --');
eq('4P all finished -> settle', vc([FIN, FIN, FIN, FIN]), false);
eq('4P single VOID -> settle', vc([QUIT, FIN, FIN, FIN]), false);
eq('4P 2-2 tie -> settle', vc([HOSTLEFT, HOSTLEFT, FIN, FIN]), false);
eq('4P 3 VOID -> void', vc([DISBAND, DISBAND, DISBAND, FIN]), true);
eq('4P all VOID -> void', vc([DISBAND, DISBAND, DISBAND, DISBAND]), true);

console.log('-- counts --');
const r3 = voidByConsensus([DISBAND, DISBAND, FIN]);
eq('3P 2 VOID: voidVotes', r3.voidVotes, 2); eq('3P 2 VOID: present', r3.present, 3); eq('3P 2 VOID: isVoid', r3.isVoid, true);
const r4 = voidByConsensus([HOSTLEFT, HOSTLEFT, FIN, FIN]);
eq('4P 2-2: voidVotes', r4.voidVotes, 2); eq('4P 2-2: present', r4.present, 4); eq('4P 2-2: isVoid', r4.isVoid, false);

console.log('=== ' + (failN === 0 ? 'PASS' : 'FAIL') + ' — ' + failN + ' fail ===');
process.exit(failN === 0 ? 0 : 1);
