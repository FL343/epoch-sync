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
// Q209: a target's reporter set holds one pair token per (reporter, target), not the reporter's key
const PT = (r, t) => cm.pairTok(pidOf, pidOf(r), pidOf(t));

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
  ok('window starts at this harvest (stored stamp = now)', JSON.stringify(st.rep[pidOf(T1)]) === JSON.stringify([[PT(R1, T1), NOW]]), JSON.stringify(st.rep[pidOf(T1)]));
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

console.log('=== chat-mute-clock-skew [4] a Q190 state (per-reporter watermark + last-row digest) moves in place (Q209) ===');
{
  // Q190 (kv 1) kept, per reporter key, the stamp (seen) and keyed digest (sig) of his last harvested row; Q209 keeps one
  // token per row instead. The move needs no board read: the row harvested before stays harvested.
  const cur = packReport('already mailed', T1, 1, TS - 30);
  const nxt = packReport('newer report', T2, 1, TS - 20);
  const rk4 = pidOf(R4), rk5 = pidOf(R5);
  const st = { kv: 1, seen: { [rk4]: TS - 30, [rk5]: TS - 50 }, sig: { [rk4]: pidOf(cm.rowKey(cm.decodeReport(cur))), [rk5]: pidOf('chat-row|an older row') },
    rep: { [pidOf(T1)]: [[rk4, NOW - 30]] }, auto: {} };
  const up = cm.upgrade(st, pidOf, NOW);
  ok('moved: two row tokens, one reporter entry, the watermark gone', !!up && up.rows === 2 && up.reports === 1 && st.seen === undefined && st.kv === cm.KEYS_VER, JSON.stringify(up));
  ok('a row token is stamped no earlier than its row, never earlier than the move', Object.values(st.sig).every(x => x === NOW), JSON.stringify(st.sig));
  const h = cm.harvest(st, [{ reporterSid: R4, det: cur }, { reporterSid: R5, det: nxt }], pidOf, NOW);
  ok('the row harvested before the move is not harvested again', !h.fresh.some(f => f.reporterSid === R4));
  ok('the other reporter\'s newer row is harvested', h.fresh.length === 1 && h.fresh[0].reporterSid === R5, JSON.stringify(h.fresh.map(f => f.reporterSid)));
  ok('reporter sets hold pair tokens: R4 keeps his time on T1, R5 counted on T2', JSON.stringify(st.rep[pidOf(T1)]) === JSON.stringify([[PT(R4, T1), NOW - 30]]) &&
    JSON.stringify(st.rep[pidOf(T2)]) === JSON.stringify([[PT(R5, T2), NOW - 20]]), JSON.stringify(st.rep));
  ok('no reporter key left in the state', ![rk4, rk5].some(k => JSON.stringify(st).includes(k)));
  const again = cm.harvest(st, [{ reporterSid: R4, det: cur }, { reporterSid: R5, det: nxt }], pidOf, NOW + 5);
  ok('next run: nothing re-harvested', again.fresh.length === 0, again.fresh.length);
  ok('a state not on kv 1 is not moved', cm.upgrade(st, pidOf, NOW) === null && cm.upgrade({ seen: { a: 1 } }, pidOf, NOW) === null);
}

console.log('=== chat-mute-clock-skew [5] rollback: the Q190 version does not take this state for its own ===');
{
  // Q190 reads a state as its own only on kv 1 (or with no entries at all); anything else it drops on a complete read of
  // the report box and marks the rows then on the box as taken (only fewer reports count). This state must not look like
  // a kv 1 state: harvest writes no watermark and no per-reporter entry, and the marker is 2.
  const st = {};
  const rows = [{ reporterSid: R1, det: packReport('fast', T1, 1, TS + 600) }, { reporterSid: R2, det: packReport('slow', T1, 1, TS - 600) }];
  cm.harvest(st, rows, pidOf, NOW);
  cm.markKeys(st);
  const q190Ready = (x) => x.kv === 1 || !['seen', 'sig', 'rep', 'auto', 'pend', 'pre'].some(k => !!x[k] && Object.keys(x[k]).length > 0);
  ok('marked kv 2 with entries: the Q190 version drops it instead of reading it', st.kv === 2 && !q190Ready(st));
  ok('no watermark written (the field the pre-Q190 rule read)', st.seen === undefined);
  ok('both rows counted once each, on their own row tokens', Object.keys(st.sig).length === 2 && cm.reporterCount(st, pidOf(T1), NOW) === 2);
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
  const sigA = Object.keys(s1.sig || {})[0], sigB = Object.keys(s2.sig || {})[0];
  ok('signature depends on the pseudonym key', !!sigA && !!sigB && sigA !== sigB, sigA + ' / ' + sigB);
  const js = JSON.stringify(s1);
  ok('state has no raw sid and no text', !js.includes(T1) && !js.includes(R1) && !js.includes('private'));
}

console.log('=== chat-mute-clock-skew [8] the same words reported again the next day are a new report ===');
{
  // The same player says the same thing again the next day and the same reporter reports it again: the new row
  // differs from the harvested one only in its stamp. The row signature has to keep the stamp, or the second
  // report is taken for the one already harvested (never counted, never mailed).
  const st = {};
  const LATER = 24 * 60 + 90;           // next day, a little later
  const a = cm.harvest(st, [{ reporterSid: R1, det: packReport('same words', T1, 1, TS) }], pidOf, NOW);
  const row = [{ reporterSid: R1, det: packReport('same words', T1, 1, TS + LATER) }];
  const b = cm.harvest(st, row, pidOf, NOW + LATER);
  const c = cm.harvest(st, row, pidOf, NOW + LATER + 5);
  ok('first report harvested', a.fresh.length === 1);
  ok('next day, same reporter / target / words: harvested again (digest)', b.fresh.length === 1 && b.fresh[0].tsMin === TS + LATER, JSON.stringify(b.fresh.map(f => f.tsMin)));
  ok('and counted again, from the new report', cm.reporterCount(st, pidOf(T1), NOW + LATER) === 1 && JSON.stringify(st.rep[pidOf(T1)]) === JSON.stringify([[PT(R1, T1), NOW + LATER]]), JSON.stringify(st.rep[pidOf(T1)]));
  ok('the run after that does not harvest it again', c.fresh.length === 0, c.fresh.length);
}

console.log(failN ? ('chat-mute-clock-skew: ' + failN + ' FAIL of ' + n) : ('chat-mute-clock-skew: all ' + n + ' passed'));
process.exit(failN ? 1 : 0);
