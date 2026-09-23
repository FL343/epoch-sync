'use strict';
// Chat moderation lane: report snapshot decode (client packReport mirror), harvest/prune/plan purity, thresholds, wiring pins.
const path = require('path');
const fs = require('fs');
const cm = require(path.join(__dirname, '..', 'chat-mute.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));
const { CHAT_MUTE, decodeReport, harvest, prune, plan, reporterCount } = cm;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const assert = (label, cond) => cond ? ok(label) : bad(label);
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + a); else bad(label + ' = ' + a + ' (expected ' + b + ')'); };

// client packReport mirror (same layout as mvp/src/systems/chat-report.js; keep both in lockstep)
function fnv1a32(s) { let h = 0x811c9dc5 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; }
function pack(text, targetSid, scope, tsMin, enc) {
  const bytes = enc === 1 ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'utf8');
  const b = BigInt(targetSid);
  const lo = Number(b & 0xFFFFFFFFn) | 0, hi = Number((b >> 32n) & 0xFFFFFFFFn) | 0;
  const w0 = ((CHAT_MUTE.MAGIC & 0xFF) | ((CHAT_MUTE.VER & 0xFF) << 8) | ((scope & 0xFF) << 16) | ((enc & 0xFF) << 24)) | 0;
  const words = [w0, bytes.length | 0, lo, hi, tsMin | 0, fnv1a32(text)];
  for (let i = 0; i < bytes.length; i++) { const wi = 6 + (i >> 2); if (words.length <= wi) words.push(0); words[wi] = (words[wi] | (bytes[i] << ((i & 3) * 8))) | 0; }
  return words;
}
const T1 = '76561198000000011', R1 = '76561198000000001', R2 = '76561198000000002';
const pidOf = (s) => 'p' + String(s).slice(-4);

console.log('=== chat-mute [1] constants (client lockstep) ===');
eq('boards / magic / thresholds pinned', [CHAT_MUTE.MUTE_LB, CHAT_MUTE.REPORT_LB, CHAT_MUTE.MAGIC, CHAT_MUTE.VER, CHAT_MUTE.BODY_MAX, CHAT_MUTE.AUTO_REPORTERS, CHAT_MUTE.WINDOW_MIN, CHAT_MUTE.AUTO_MUTE_MIN],
  ['chat_mute', 'chat_report_box', 0xB8, 1, 228, 10, 1440, 1440]);
assert('exported through validate.js (CHAT_MUTE + CHAT_MUTE_FILE default)', v.CHAT_MUTE === CHAT_MUTE && v.CHAT_MUTE_FILE === 'chat-mute.json');

console.log('=== chat-mute [2] decodeReport roundtrip (utf8 / utf16le / bad magic / oversize) ===');
{
  const d8 = decodeReport(pack('anyone for ranked? éàü', T1, 1, 123456, 0));
  assert('utf8 roundtrip text + target + scope + tsMin', d8 && d8.text === 'anyone for ranked? éàü' && d8.target === T1 && d8.scope === 1 && d8.tsMin === 123456 && d8.enc === 0);
  const d16 = decodeReport(pack('Привет мир endless tonight?', T1, 3, 7, 1));
  assert('utf16le roundtrip', d16 && d16.text === 'Привет мир endless tonight?' && d16.scope === 3 && d16.enc === 1);
  assert('hash = fnv1a32(full text)', d8.hash === fnv1a32('anyone for ranked? éàü'));
  assert('bad magic -> null', decodeReport([0xB6, 3, 0, 0, 0, 0, 0]) === null);
  const big = pack('x'.repeat(300), T1, 1, 1, 0);
  assert('len > BODY_MAX -> null (client caps at 228; a forged longer len is rejected)', decodeReport(big) === null);
  assert('short array -> null', decodeReport([0xB8]) === null && decodeReport(null) === null);
}

console.log('=== chat-mute [3] harvest: fresh vs already-seen vs forged ===');
{
  const st = {};
  const now = 30000000;   // unix minutes (~2027)
  const ts = now - Math.floor(CHAT_MUTE.EPOCH0 / 60000) - 10;   // client tsMin 10 min ago
  const rows = [
    { reporterSid: R1, det: pack('spam spam', T1, 1, ts, 0) },
    { reporterSid: R2, det: pack('spam spam', T1, 1, ts, 0) },
    { reporterSid: R1, det: pack('again', T1, 1, ts - 5, 0) },        // older than R1's last seen -> skipped
    { reporterSid: T1, det: pack('self', T1, 1, ts, 0) },             // self-report -> skipped
    { reporterSid: R2, det: pack('future', T1, 1, ts + 5000, 0) },    // far future clock -> skipped
    { reporterSid: 'nope', det: pack('x', T1, 1, ts, 0) },            // implausible reporter -> skipped
  ];
  const r = harvest(st, rows, pidOf, now);
  eq('fresh = 2 (R1, R2), skipped = 4', [r.fresh.length, r.skipped], [2, 4]);
  eq('distinct reporters for target', reporterCount(st, pidOf(T1), now), 2);
  const r2 = harvest(st, rows.slice(0, 2), pidOf, now);
  eq('re-harvest of the same rows = zero fresh (seen watermark)', r2.fresh.length, 0);
  assert('state carries pids only (no raw sid, no text)', !JSON.stringify(st).includes(T1) && !JSON.stringify(st).includes('spam'));
}

console.log('=== chat-mute [4] plan: threshold / longer manual row respected / expiry sweep / idempotent ===');
{
  const st = { seen: {}, rep: {}, auto: {} };
  const now = 30000000;
  for (let i = 1; i <= 9; i++) st.rep[pidOf(T1)] = (st.rep[pidOf(T1)] || []).concat([['r' + i, now - i]]);
  let p = plan(st, [], [T1], pidOf, now);
  eq('9 reporters < 10 -> no write', p.writes.length, 0);
  st.rep[pidOf(T1)].push(['r10', now - 1]);
  p = plan(st, [], [T1], pidOf, now);
  eq('10 reporters -> auto mute 24h', p.writes, [{ sid: T1, until: now + 1440, why: 'auto:10' }]);
  p = plan(st, [{ sid: T1, until: 0 }], [T1], pidOf, now);
  eq('permanent manual row -> untouched', p.writes.length, 0);
  p = plan(st, [{ sid: T1, until: now + 5000 }], [T1], pidOf, now);
  eq('longer manual row -> untouched', p.writes.length, 0);
  p = plan(st, [{ sid: T1, until: now + 100 }], [T1], pidOf, now);
  eq('shorter existing row -> extended to 24h', p.writes.length, 1);
  st.auto[pidOf(T1)] = now + 1440;
  p = plan(st, [], [T1], pidOf, now);
  eq('already wrote this window -> idempotent (no re-write)', p.writes.length, 0);
  p = plan(st, [{ sid: R1, until: now - 1 }, { sid: R2, until: 0 }, { sid: T1, until: now + 50 }], [], pidOf, now);
  eq('expiry sweep deletes only the expired row (permanent 0 and future kept)', p.deletes, [{ sid: R1, why: 'expired' }]);
  // window aging: reporters older than 24h drop out
  const st2 = { seen: {}, rep: { [pidOf(T1)]: Array.from({ length: 12 }, (_, i) => ['r' + i, now - 2000]) }, auto: {} };
  prune(st2, now);
  eq('prune drops reports older than the window', Object.keys(st2.rep).length, 0);
}

console.log('=== chat-mute [5] wiring pins (validate.js + workflows) ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  assert('processChatMute defined and called on the three exit paths', /const processChatMute = async/.test(src) && (src.match(/await processChatMute\(\)/g) || []).length >= 3);
  assert('mute board found-or-created TRUSTED, report box NOT trusted (client writes) + friends reads', /findOrCreateBoard\(CHAT_MUTE_LB, true\)/.test(src) && /findOrCreateBoard\(CHAT_REPORT_LB, false, true\)/.test(src));
  assert('automatic mutes gated by APPLY_MMR (dry-run safe)', /chat-mute[\s\S]{0,4000}APPLY_MMR/.test(src));
  for (const wf of ['validate.yml', 'playtest.yml', 'demo.yml']) {
    const y = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', wf), 'utf8');
    const stateName = wf === 'validate.yml' ? 'chat-mute.json' : (wf === 'playtest.yml' ? 'pt-chat-mute.json' : 'demo-chat-mute.json');
    assert(wf + ': state file ' + stateName + ' in the persist whitelist', y.includes(stateName));
    if (wf !== 'validate.yml') assert(wf + ': CHAT_MUTE_FILE env set to ' + stateName, new RegExp('CHAT_MUTE_FILE:\\s*' + stateName).test(y));
  }
}
console.log(failN ? ('\nFAIL ' + failN) : '\nchat-mute: ALL PASS');
process.exit(failN ? 1 : 0);
