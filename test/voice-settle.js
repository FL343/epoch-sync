'use strict';
// voice.js unit tests: wire codec, validation negatives, vote merge/tally,
// hot score, feed packing, and magic uniqueness against validate.js.
const fs = require('fs');
const path = require('path');
const vv = require('../voice.js');
const v = require('../validate.js');

let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m + (d ? ' (' + d + ')' : '')); } };

// ---- lang16 ----
ok('lang roundtrip zh', vv.unpackLang(vv.packLang('zh')) === 'zh');
ok('lang roundtrip en', vv.unpackLang(vv.packLang('en')) === 'en');
ok('lang bad input -> xx', vv.unpackLang(vv.packLang('')) === 'xx');

// ---- text pack/unpack both encodings ----
for (const [label, txt] of [['ascii', 'hook physics feels floaty on level 3'], ['cjk', '\u94a9\u5b50\u624b\u611f\u6709\u70b9\u98d8\uff0c\u7b2c\u4e09\u5173\u7269\u4ef6\u592a\u5bc6\u4e86'], ['emoji', 'love the slots \ud83c\udfb0\ud83c\udfb0 but the odds\u2026'], ['mixed', '2v2 \u5e73\u5c40 rule \u592a confusing \u4e86']]) {
  for (const enc of [0, 1]) {
    const p = vv.packText(txt, enc);
    ok('text roundtrip ' + label + ' enc' + enc, vv.unpackText(p.words, 0, p.len, enc) === txt);
  }
}

// ---- box entry encode->decode roundtrip (mirrors the client writer) ----
function makeBoxWords(sid, text, cat, lang, ts, encPick) {
  const u8 = vv.packText(text, 0), u16 = vv.packText(text, 1);
  const pick = encPick != null ? (encPick === 1 ? { enc: 1, p: u16 } : { enc: 0, p: u8 })
    : (u16.len < u8.len ? { enc: 1, p: u16 } : { enc: 0, p: u8 });
  const itemId = vv.fnv1a32(String(sid) + ':' + ts);
  const w1 = ((1 & 0xFF) << 24) | ((cat & 0xFF) << 16) | ((pick.enc & 0xFF) << 8) | (pick.p.len & 0xFF);
  return { words: [vv.VOICE_MAGIC | 0, w1 | 0, vv.packLang(lang), itemId | 0, ts | 0].concat(pick.p.words), itemId };
}
const NOW_MIN = vv.nowTsMin();
{
  const sid = '76561198000000001';
  const mk = makeBoxWords(sid, '\u77ff\u8f66\u5173\u7684\u8f66\u6597\u592a\u6321\u89c6\u7ebf\u4e86\uff0c\u5efa\u8bae\u534a\u900f\u660e', 0, 'zh', NOW_MIN - 5);
  const d = vv.decodeBoxEntry(sid, mk.words, NOW_MIN);
  ok('box roundtrip decodes', !!d);
  ok('box roundtrip text exact', d && d.text === '\u77ff\u8f66\u5173\u7684\u8f66\u6597\u592a\u6321\u89c6\u7ebf\u4e86\uff0c\u5efa\u8bae\u534a\u900f\u660e');
  ok('box roundtrip cat/lang/ts', d && d.cat === 0 && d.lang === 'zh' && d.ts === NOW_MIN - 5);
  ok('box wrong sid -> provenance drop', vv.decodeBoxEntry('76561198000000002', mk.words, NOW_MIN) === null);
  const future = makeBoxWords(sid, 'time traveler', 1, 'en', NOW_MIN + 3000);
  ok('box far-future ts drop', vv.decodeBoxEntry(sid, future.words, NOW_MIN) === null);
  const badCat = makeBoxWords(sid, 'x', 9, 'en', NOW_MIN);
  ok('box bad cat drop', vv.decodeBoxEntry(sid, badCat.words, NOW_MIN) === null);
  const ctl = makeBoxWords(sid, String.fromCharCode(7, 0) + '  ', 0, 'en', NOW_MIN);
  ok('box control-only body -> drop', vv.decodeBoxEntry(sid, ctl.words, NOW_MIN) === null);
}
// 208-byte boundary: 104 CJK chars via utf16 = exactly 208 ok; 105 = 210 no encoding fits
{
  const sid = '76561198000000003';
  const t104 = '\u597d'.repeat(104), t105 = '\u597d'.repeat(105);
  ok('cjk 104 utf16 fits', vv.packText(t104, 1).len === 208);
  const okMk = makeBoxWords(sid, t104, 2, 'zh', NOW_MIN);
  const d = vv.decodeBoxEntry(sid, okMk.words, NOW_MIN);
  ok('box 208B boundary decodes', d && d.text === t104);
  ok('cjk 105 exceeds both encodings', vv.packText(t105, 1).len > vv.VOICE_BODY_MAX && vv.packText(t105, 0).len > vv.VOICE_BODY_MAX);
}

// ---- vote entry decode + merge + tally ----
{
  const mkVote = (votes) => {
    const w1 = ((1 & 0xFF) << 24) | ((votes.length & 0xFF) << 16);
    const words = [vv.VOTE_MAGIC | 0, w1 | 0];
    for (const [itemId, dir, ts] of votes) words.push(itemId | 0, ((ts << 2) | dir) | 0);
    return words;
  };
  const d = vv.decodeVoteEntry(mkVote([[111, 1, 500], [222, 2, 501], [111, 0, 502]]));
  ok('vote decode count', d.length === 3);
  ok('vote decode fields', d[0].itemId === 111 && d[0].dir === 1 && d[0].ts === 500 && d[1].dir === 2 && d[2].dir === 0);
  const votes = {};
  vv.mergeVotes(votes, 'voterA', d);
  ok('merge latest wins (up then clear)', votes['111']['voterA'][0] === 0);
  vv.mergeVotes(votes, 'voterB', vv.decodeVoteEntry(mkVote([[111, 1, 400]])));
  vv.mergeVotes(votes, 'voterC', vv.decodeVoteEntry(mkVote([[111, 3, 401]])));
  vv.mergeVotes(votes, 'authorP', vv.decodeVoteEntry(mkVote([[111, 1, 402]])));
  const t = vv.tallyVotes(votes['111'], 'authorP');
  ok('tally: cleared not counted, self excluded', t.up === 1 && t.down === 0 && t.rep === 1);
  ok('vote bad magic -> empty', vv.decodeVoteEntry([0x99, 0]).length === 0);
  ok('vote overcount -> empty', vv.decodeVoteEntry([vv.VOTE_MAGIC, ((1 << 24) | (31 << 16)) | 0]).length === 0);
}

// ---- hot score: net votes x100 minus age hours ----
{
  const ts = vv.nowTsMin() - 120;  // 2h old
  const s = vv.hotScoreOf(3, 1, ts);
  ok('hot score 2h-old +2net = 198', s === 198, 's=' + s);
  ok('new-ish beats older equal-net', vv.hotScoreOf(1, 0, vv.nowTsMin() - 60) > vv.hotScoreOf(1, 0, vv.nowTsMin() - 60 * 30));
}

// ---- feed packing: header + body, caps at 64 words ----
{
  const item = { cat: 1, lang: 'zh', itemId: 12345, ts: 1000, text: '\u5efa\u8bae\u52a0\u4e00\u4e2a\u8272\u76f2\u914d\u8272\u9009\u9879' };
  const det = vv.packFeedDetails(item, 7, 2);
  ok('feed pack header', det[0] === vv.VOICE_MAGIC && det[3] === 12345 && det[5] === 7 && det[6] === 2);
  ok('feed pack <= 64 words', det.length <= 64);
  const big = { ...item, text: '\u597d'.repeat(104) };
  const detBig = vv.packFeedDetails(big, 0, 0);
  ok('feed pack 208B body fits 64 words', detBig && detBig.length <= 64, detBig && detBig.length);
  const over = { ...item, text: '\u597d'.repeat(120) };
  ok('feed pack oversize -> null', vv.packFeedDetails(over, 0, 0) === null);
}

// ---- board naming + constants ----
ok('feed board name shape', vv.feedBoardName(0, 'hot') === 'voice_feed_bug_hot' && vv.feedBoardName(3, 'new') === 'voice_feed_other_new');
ok('cats locked', JSON.stringify(vv.VOICE_CATS) === JSON.stringify(['bug', 'idea', 'balance', 'other']));

// ---- magic uniqueness: voice magics must not collide with any magic validate.js declares ----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const used = new Set();
  for (const m of src.matchAll(/MAGIC\s*=\s*(0x[0-9A-Fa-f]+)/g)) used.add(parseInt(m[1], 16));
  ok('validate.js declares magics', used.size >= 4, [...used].map(x => x.toString(16)).join(','));
  ok('VOICE_MAGIC 0xB6 unused elsewhere', !used.has(vv.VOICE_MAGIC));
  ok('VOTE_MAGIC 0xB7 unused elsewhere', !used.has(vv.VOTE_MAGIC));
}
// validate.js import stays require-safe (main is guarded): the require above did not run main.
ok('validate.js helpers importable', typeof v.postFormDetails === 'function' && typeof v.findOrCreateBoard === 'function');
// Listing-lag bypass pin: the client-writable boards resolve via a pure by-name
// lookup (createifnotfound: 0). Regressing to listing-only = fresh boards invisible
// for 1h+; regressing to createifnotfound: 1 = risk of mis-provisioning as trusted.
{
  const vsrc = fs.readFileSync(path.join(__dirname, "..", "voice.js"), "utf8");
  ok("box/vote lookup uses createifnotfound: 0", vsrc.includes("createifnotfound: 0"));
  ok("feed boards still find-or-create (trusted)", vsrc.includes("v.findOrCreateBoard("));
}

console.log('voice-settle: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' ok'));
process.exit(fail ? 1 : 0);
