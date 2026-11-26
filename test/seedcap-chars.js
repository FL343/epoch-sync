'use strict';
// seedcap chars= (client O1006): the cap core is told which characters were in the match, so the gem lady envelope loosens the
//   cap only in matches she is in (user 2026-11-25). charsOfGroup = union of every record's char block; anything it cannot read
//   exactly -> null (no token = the loose envelope, as before). The token goes only to a core answering chars=1.
// Offline: no CLI is executed (the probe takes a stub run).
const fs = require('fs');
const path = require('path');
const Module = require('module');

process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'test-key';
process.env.APPID = process.env.APPID || '0';
process.env.STATE_SALT = process.env.STATE_SALT || 'seedcap-test-salt';
process.env.SC_STATE_FILE = path.join(require('os').tmpdir(), 'seedcap-chars-test-' + process.pid + '.json');

const SC_PATH = path.join(__dirname, '..', 'seedcap.js');
const sc = require(SC_PATH);
const v = require('../validate.js');

let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m + (d ? ' (' + d + ')' : '')); } };

// a record of one writer: seat s, pc seats, mt; the char block at the offset careerSeatCodes reads from (or none / another seat count)
function rec(mt, pc, s, codes, opt) {
  opt = opt || {};
  const from = 11 + 3 * pc + ((v.baseMt(mt) === 7 && pc >= 2) ? 12 : 0);
  const d = new Array(from).fill(0);
  d[2] = mt; d[5] = s; d[8] = pc;
  if (codes) {
    const n = opt.blockPc != null ? opt.blockPc : pc;
    d.push((0xD8 | (1 << 8) | (n << 16)) | 0);
    const words = new Array(Math.ceil(n / 4)).fill(0);
    for (let k = 0; k < n; k++) words[k >> 2] |= ((codes[k] | 0) & 0xff) << (8 * (k & 3));
    for (const w of words) d.push(w | 0);
  }
  return { d, steamID: 'w' + s };
}
const MT_Q = 1, MT_E = 7;
ok('precondition: mt 1 = a match (not endless), mt 7 = endless', v.baseMt(MT_Q) !== 7 && v.baseMt(MT_E) === 7);

function checks(S, tag) {
  const out = [];
  const t = (m, c, d) => out.push([tag + m, c, d]);
  const U = (g, pc) => S.charsOfGroup(g, pc);
  t('two writers, same block -> the codes in the match', JSON.stringify(U([rec(MT_Q, 4, 0, [1, 4, 5, 2]), rec(MT_Q, 4, 2, [1, 4, 5, 2])], 4)) === '[1,2,4,5]');
  t('writers that differ -> the union (looser, never tighter)', JSON.stringify(U([rec(MT_Q, 4, 0, [1, 4, 1, 2]), rec(MT_Q, 4, 2, [1, 4, 5, 2])], 4)) === '[1,2,4,5]');
  t('a record without a block -> null (no token)', U([rec(MT_Q, 4, 0, [1, 4, 5, 2]), rec(MT_Q, 4, 2, null)], 4) === null);
  t('a 0 (unknown) code -> null', U([rec(MT_Q, 3, 0, [1, 0, 4])], 3) === null);
  t('a block of another seat count -> null', U([rec(MT_Q, 3, 0, [1, 4, 5, 2], { blockPc: 4 })], 3) === null);
  t('co-op endless (block after the 12 extra ints) -> read', JSON.stringify(U([rec(MT_E, 3, 0, [5, 1, 4]), rec(MT_E, 3, 1, [5, 1, 4])], 3)) === '[1,4,5]');
  t('solo endless -> read', JSON.stringify(U([rec(MT_E, 1, 0, [5])], 1)) === '[5]');
  t('no records -> null', U([], 2) === null);
  // the line
  const pC = { entry: 'quick', pc: 4, ts: 0, isTeam: false, team2: false, levels: 6, teams: [], chars: [1, 2, 4, 5] };
  const lnC = S.cliLineOf('m0', pC, 123, { chars: true });
  t('C line to a core that reads it: ends with chars=1,2,4,5', /\schars=1,2,4,5$/.test(lnC), lnC);
  t('C line to a core that does not: no token', S.cliLineOf('m0', pC, 123, { chars: false }).indexOf('chars=') < 0);
  t('C line without p.chars: no token', S.cliLineOf('m0', Object.assign({}, pC, { chars: undefined }), 123, { chars: true }).indexOf('chars=') < 0);
  const pE = { entry: 'endless', pc: 3, startDepth: 0, endDepth: 12, startBank: 0, seasonId: 1, chars: [1, 4, 5] };
  const lnE = S.cliLineOf('m1', pE, 77, { chars: true, rv: true });
  t('E line: chars= after the other tokens', /\schars=1,4,5$/.test(lnE), lnE);
  t('E line to a core that does not read it: no token', S.cliLineOf('m1', pE, 77, { chars: false }).indexOf('chars=') < 0);
  // the probe
  const run = (vv) => () => ({ map: { p0: { v: vv } } });
  t('probe: a core answering chars=1 reads it', S.cliSupportsChars(run('build=1 rerolls=1 classic=1 builds=1 absidx=1 fee=1 rv=1 cond=1 evt=1 chars=1')) === true);
  t('probe: an older core does not', S.cliSupportsChars(run('build=1 rerolls=1 classic=1 builds=1 absidx=1 fee=1 rv=1 cond=1 evt=1')) === false);
  t('probe: a failed run does not', S.cliSupportsChars(() => ({ fail: 'x' })) === false);
  return out;
}
for (const [m, c, d] of checks(sc, '')) ok(m, c, d);

// wiring: pendingOfGroup puts p.chars from EVERY record of the key; the three caps objects carry chars
{
  const src = fs.readFileSync(SC_PATH, 'utf8').replace(/\r\n/g, '\n');
  ok('wiring: pendingOfGroup keeps the whole group (g0) and sets p.chars from it', /function pendingOfGroup\(st, m, g\) \{\n  const g0 = g;/.test(src) && /const chars = charsOfGroup\(g0, pc\);[^\n]*\n    if \(chars\) p\.chars = chars;/.test(src));
  ok('wiring: every caps object asks the core about chars= (primary + overlap + exact)', (src.match(/chars: cliSupportsChars\(run(Primary)?\)/g) || []).length === 3);
}

// mutations: each must turn a check above red
function loadMut(srcText) {
  const m = new Module(SC_PATH, module);
  m.filename = SC_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(SC_PATH));
  m._compile(srcText, SC_PATH);
  return m.exports;
}
{
  const src = fs.readFileSync(SC_PATH, 'utf8');
  const muts = [
    ['a 0 code read as a character', 'if (!((c | 0) > 0 && (c | 0) < 32)) return null; set.add(c | 0);', 'set.add(c | 0);'],
    ['a record without a block skipped', 'if (!codes || codes.length !== (pc | 0)) return null;', 'if (!codes) continue;'],
    ['the token sent to any core', '(caps && caps.chars && p && Array.isArray(p.chars)', '(p && Array.isArray(p.chars)'],
  ];
  for (const [label, a, b] of muts) {
    if (src.split(a).length !== 2) { ok('mutation anchor once: ' + label, false); continue; }
    let red = false;
    try { red = checks(loadMut(src.replace(a, () => b)), '').some(([, c]) => !c); } catch (e) { red = true; }
    ok('mutation "' + label + '" -> a check turns red', red);
  }
}
try { fs.unlinkSync(process.env.SC_STATE_FILE); } catch (e) {}
console.log('seedcap-chars: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
