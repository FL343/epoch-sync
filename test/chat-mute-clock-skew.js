'use strict';
// Chat report harvest (chat-mute.js) does not trust the reporter's clock for freshness or ordering.
// A reporter whose computer clock runs fast or slow (wrong time zone + hand-set clock = whole-hour
// offsets) must not lose a report, a clock set back must not hide the next report, and a forged stamp
// must gain nothing. Pure helpers only, fixed clock values (no dependence on today's date).
const path = require('path'), crypto = require('crypto');
const cm = require(path.join(__dirname, '..', 'chat-mute.js'));

let failN = 0, n = 0;
const ok = (label, cond, detail) => { n++; if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail != null ? ' (' + detail + ')' : '')); } };
const fnv1a32 = (s) => { let h = 0x811c9dc5 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; };
// keyed pseudonym like validate.js pid (HMAC-SHA256, 16 hex)
const keyedPid = (salt) => (s) => crypto.createHmac('sha256', salt).update(String(s)).digest('hex').slice(0, 16);
const pidOf = keyedPid('test-salt');

// client chat-report packReport mirror (utf8)
function packReport(text, targetSid, scope, tsMin) {
  const bytes = Buffer.from(text, 'utf8');
  const b = BigInt(targetSid);
  const w0 = ((cm.CHAT_MUTE.MAGIC & 0xFF) | ((cm.CHAT_MUTE.VER & 0xFF) << 8) | ((scope & 0xFF) << 16)) | 0;
  const words = [w0, bytes.length | 0, Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, tsMin | 0, fnv1a32(text)];
  for (let i = 0; i < bytes.length; i++) { const wi = 6 + (i >> 2); if (words.length <= wi) words.push(0); words[wi] = (words[wi] | (bytes[i] << ((i & 3) * 8))) | 0; }
  return words;
}
const EP_MIN = Math.floor(cm.CHAT_MUTE.EPOCH0 / 60000);
const T1 = '76561198000000011', T2 = '76561198000000012';
const R1 = '76561198000000001', R2 = '76561198000000002', R3 = '76561198000000003', R4 = '76561198000000004', R5 = '76561198000000005';
const NOW = 29000000;                 // cron clock, unix minutes (any fixed value works)
const TS = NOW - EP_MIN;              // the same instant as a client tsMin
const WIN = cm.CHAT_MUTE.WINDOW_MIN;

console.log('=== chat-mute-clock-skew [1] a fast reporter clock is clamped, not dropped ===');
{
  const st = {};
  const h = cm.harvest(st, [{ reporterSid: R1, det: packReport('fast clock', T1, 1, TS + 16 * 60) }], pidOf, NOW);
  ok('reporter 16 h fast: harvested (digest) and counted', h.fresh.length === 1 && cm.reporterCount(st, pidOf(T1), NOW) === 1, JSON.stringify([h.fresh.length, h.skipped]));
  ok('clamped count reported', h.clamped === 1, h.clamped);
  ok('window starts at this harvest (stored stamp = now)', JSON.stringify(st.rep[pidOf(T1)]) === JSON.stringify([[pidOf(R1), NOW]]), JSON.stringify(st.rep[pidOf(T1)]));
  cm.prune(st, NOW + WIN + 1);
  ok('and it ages out 24 h after the harvest', cm.reporterCount(st, pidOf(T1), NOW + WIN + 1) === 0);
}

console.log('=== chat-mute-clock-skew [2] clock set back -> the next report is still new ===');
{
  const st = {};
  const a = cm.harvest(st, [{ reporterSid: R2, det: packReport('first', T1, 1, TS + 30) }], pidOf, NOW);
  const row = [{ reporterSid: R2, det: packReport('second', T2, 1, TS + 5) }];   // the same row, overwritten after the clock fix
  const b = cm.harvest(st, row, pidOf, NOW + 10);
  const c = cm.harvest(st, row, pidOf, NOW + 120);
  ok('first report harvested', a.fresh.length === 1);
  ok('second report (earlier stamp) harvested exactly once', b.fresh.length === 1 && c.fresh.length === 0 && b.fresh[0].target === T2, JSON.stringify([b.fresh.length, c.fresh.length]));
  ok('second target counted', cm.reporterCount(st, pidOf(T2), NOW + 120) === 1);
}

console.log('=== chat-mute-clock-skew [3] two reports inside one minute (30 s client cooldown) ===');
{
  const st = {};
  const a = cm.harvest(st, [{ reporterSid: R3, det: packReport('line one', T1, 1, TS) }], pidOf, NOW);
  const b = cm.harvest(st, [{ reporterSid: R3, det: packReport('line two', T2, 1, TS) }], pidOf, NOW + 5);
  ok('same tsMin, different row -> both harvested', a.fresh.length === 1 && b.fresh.length === 1, JSON.stringify([a.fresh.length, b.fresh.length]));
}

console.log('=== chat-mute-clock-skew [4] state written by the previous harvest (seen only, no sig) ===');
{
  const cur = packReport('already mailed', T1, 1, TS - 30);
  const lost = packReport('lost before', T2, 1, TS - 20);
  const st = { seen: { [pidOf(R4)]: TS - 30, [pidOf(R5)]: TS + 40 }, rep: {}, auto: {} };
  const h = cm.harvest(st, [
    { reporterSid: R4, det: cur },     // tsMin === seen -> the row already harvested
    { reporterSid: R5, det: lost },    // tsMin < seen -> skipped by the previous rule, never mailed
  ], pidOf, NOW);
  ok('row equal to seen = not re-harvested', !h.fresh.some(f => f.reporterSid === R4));
  ok('row the previous rule skipped (stamp below seen) = harvested now', h.fresh.length === 1 && h.fresh[0].reporterSid === R5, JSON.stringify(h.fresh.map(f => f.reporterSid)));
  ok('both reporters now carry a row signature', !!st.sig[pidOf(R4)] && !!st.sig[pidOf(R5)]);
  const again = cm.harvest(st, [{ reporterSid: R4, det: cur }, { reporterSid: R5, det: lost }], pidOf, NOW + 5);
  ok('next run: nothing re-harvested', again.fresh.length === 0, again.fresh.length);
}

console.log('=== chat-mute-clock-skew [5] rollback: the previous harvest reads the new state correctly ===');
{
  // previous rule: fresh only while tsMin > seen. After any new harvest seen = the current row's tsMin,
  // so a rolled-back job treats the current rows as harvested and later rows as new.
  const st = {};
  const rows = [{ reporterSid: R1, det: packReport('fast', T1, 1, TS + 600) }, { reporterSid: R2, det: packReport('slow', T1, 1, TS - 600) }];
  cm.harvest(st, rows, pidOf, NOW);
  const prevRuleFresh = rows.filter(r => !((st.seen[pidOf(r.reporterSid)] | 0) >= cm.decodeReport(r.det).tsMin)).length;
  ok('previous rule sees no fresh row in the new state', prevRuleFresh === 0, prevRuleFresh);
  ok('seen keeps the row stamp (not the clamped one)', st.seen[pidOf(R1)] === TS + 600 && st.seen[pidOf(R2)] === TS - 600);
}

console.log('=== chat-mute-clock-skew [6] a forged far-future stamp gains nothing ===');
{
  const st = {};
  cm.harvest(st, [{ reporterSid: R1, det: packReport('forged', T1, 1, TS + 1000000) }], pidOf, NOW);
  ok('counted once, from now', cm.reporterCount(st, pidOf(T1), NOW) === 1);
  cm.prune(st, NOW + WIN + 1);
  ok('gone after the window (no lifetime from the stamp)', cm.reporterCount(st, pidOf(T1), NOW + WIN + 1) === 0 && !st.rep[pidOf(T1)]);
}

console.log('=== chat-mute-clock-skew [7] the row signature is keyed and carries no raw id or text ===');
{
  const row = [{ reporterSid: R1, det: packReport('private words', T1, 1, TS) }];
  const s1 = {}, s2 = {};
  cm.harvest(s1, row, keyedPid('salt-a'), NOW);
  cm.harvest(s2, row, keyedPid('salt-b'), NOW);
  const sigA = Object.values(s1.sig || {})[0], sigB = Object.values(s2.sig || {})[0];
  ok('signature depends on the pseudonym key', !!sigA && !!sigB && sigA !== sigB, sigA + ' / ' + sigB);
  const js = JSON.stringify(s1);
  ok('state has no raw sid and no text', !js.includes(T1) && !js.includes(R1) && !js.includes('private'));
}

console.log(failN ? ('chat-mute-clock-skew: ' + failN + ' FAIL of ' + n) : ('chat-mute-clock-skew: all ' + n + ' passed'));
process.exit(failN ? 1 : 0);
