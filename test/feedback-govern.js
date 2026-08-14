'use strict';
// Governance tripwires (V4+V5): hashed wordlist (fail-closed + no plaintext in
// the public file), ad/promo heuristics incl. evasion folding, daily cap,
// moderation file semantics, report-hold state machine, trust seam, digest
// guards, and main() wiring pins.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vv = require('../feedback.js');

let fail = 0, pass = 0;
const ok = (m, c, d) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m + (d ? ' (' + d + ')' : '')); } };

const SALT = 'govern-test-salt';
const SRC = fs.readFileSync(path.join(__dirname, '..', 'feedback.js'), 'utf8');
const WL_PATH = path.join(__dirname, '..', 'feedback-wordlist.json');

// ---- [1] committed wordlist file: loads, hashed-only, no readable words ----
{
  const wl = vv.loadWordlist(WL_PATH);
  ok('[1] committed wordlist loads', !!wl);
  let nSub = 0; for (const k of Object.keys(wl.byLen)) nSub += wl.byLen[k].size;
  ok('[1] wordlist volume sane', nSub >= 20 && wl.word.size >= 5, nSub + '/' + wl.word.size);
  const raw = JSON.parse(fs.readFileSync(WL_PATH, 'utf8'));
  ok('[1] alg pinned', raw.alg === 'hmac-sha256-16hex');
  const allHex = (raw.sub || []).every(e => /^[0-9a-f]{16}$/.test(String(e.h)) && (e.l | 0) > 0) &&
    (raw.word || []).every(h => /^[0-9a-f]{16}$/.test(String(h)));
  ok('[1] entries are 16-hex hashes only', allHex);
  // no readable word in the public file: no CJK/kana/hangul/cyrillic anywhere
  const rawTxt = fs.readFileSync(WL_PATH, 'utf8');
  ok('[1] no non-latin plaintext leaked', !/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(rawTxt));
}
// fail-closed: missing / unparseable / empty / legacy-plaintext all -> null
{
  ok('[1] missing file -> null', vv.loadWordlist(path.join(os.tmpdir(), 'no-such-wordlist.json')) === null);
  const tmp = path.join(os.tmpdir(), 'fb-wl-t-' + process.pid + '.json');
  fs.writeFileSync(tmp, '{not json');
  ok('[1] unparseable -> null', vv.loadWordlist(tmp) === null);
  fs.writeFileSync(tmp, JSON.stringify({ sub: [], word: [] }));
  ok('[1] empty -> null', vv.loadWordlist(tmp) === null);
  fs.writeFileSync(tmp, JSON.stringify({ sub: ['plainword'], word: ['another'] }));
  ok('[1] legacy plaintext format rejected', vv.loadWordlist(tmp) === null);
  fs.unlinkSync(tmp);
}

// ---- [2] hashed matching: substring semantics survive hashing ----
function mkWl(subWords, wordWords) {
  const sub = subWords.map(w => { const f = vv.foldForWordlist(w); return { l: Array.from(f).length, h: vv.wlHash(SALT, f) }; });
  const word = wordWords.map(w => vv.wlHash(SALT, vv.foldForWordlist(w)));
  const tmp = path.join(os.tmpdir(), 'fb-wl-syn-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ alg: 'hmac-sha256-16hex', sub, word }));
  const wl = vv.loadWordlist(tmp);
  fs.unlinkSync(tmp);
  return wl;
}
{
  const wl = mkWl(['\u50bb\u903c', 'slurtoken'], ['retard', 'cunt']);
  const fr = (t) => vv.filterReason(t, wl, SALT);
  ok('[2] sub hit inline', fr('\u4f60\u5c31\u662f\u4e2a\u50bb\u903c\u73a9\u610f') === 'wordlist');
  ok('[2] sub hit spaced (fold rejoins)', fr('\u50bb \u903c \u73a9 \u610f') === 'wordlist');
  ok('[2] sub hit dotted', fr('s.l.u.r.t.o.k.e.n here') === 'wordlist');
  ok('[2] word tier hits whole token', fr('what a retard move') === 'wordlist');
  ok('[2] word tier no substring FP', fr('flame retardant walls idea') === null);
  ok('[2] scunthorpe safe', fr('greetings from scunthorpe') === null);
  ok('[2] clean CJK passes', fr('\u94a9\u5b50\u624b\u611f\u6709\u70b9\u98d8\uff0c\u7b2c\u4e09\u5173\u7269\u4ef6\u592a\u5bc6\u4e86') === null);
  ok('[2] mild profanity passes (philosophy)', fr('this level design is shit but fun') === null);
  ok('[2] spam run', fr('aaaaaaaaaaaaaa') === 'spam');
  ok('[2] symbol noise', fr('!!!???...') === 'noise');
  ok('[2] wrong salt = no match (unreadable without secret)', vv.filterReason('\u50bb\u903c', wl, 'other-salt') === null);
}

// ---- [3] ad/promo heuristics (TOP priority; evasion normalization) ----
{
  const wl = mkWl(['zzz-never'], []);
  const fr = (t) => vv.filterReason(t, wl, SALT);
  const AD = [
    '\u4f4e\u4ef7\u91d1\u5e01\u4e0a goldshop.com \u5feb\u6765', '\u6709\u610f\u52a0 www.example.net', 'https://x.yz/abc',
    'g o l d s h o p . c o m \u5168\u573a\u4e94\u6298', 'goldshop[.]com \u51fa\u91d1\u5e01', 'goldshop(\u70b9)com',
    'goldshop\u3002com', '\uff47\uff4f\uff4c\uff44\uff53\uff48\uff4f\uff50\uff0e\uff43\uff4f\uff4d', 'g\u043eldsh\u043ep.c\u043em',    // fullwidth / cyrillic o
    'goldshop dot com', '\u52a0QQ\u7fa4 123456789', '\u52a0 Q Q \u7fa4 1 2 3 4 5 6',
    '\u52a0\u7fa4\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03', '\u5fae\u4fe1abcd123 \u5e26\u4f60\u4e0a\u5206', 'vx12345678',
    '\u4ee3\u7ec3\u4e0a\u5206\u627e\u6211 65432101', '\u8054\u7cfb 98765432123',
  ];
  for (const t of AD) ok('[3] ad: ' + t.slice(0, 24), fr(t) === 'ad', String(fr(t)));
  const PASS = [
    '\u6709\u4eba\u5f00\u5916\u6302\uff0c\u9ebb\u70e6\u5c01\u4e00\u4e0b',                    // cheater report must pass
    'version 1.5 feels better than 2.0',        // dots, no TLD
    'i scored 1250000 in endless',              // 7 digits, no contact word
    '\u7b2c\u4e00\u4e8c\u5173\u592a\u7b80\u5355\uff0c\u4e09\u56db\u4e94\u5173\u4e0d\u9519',              // CN numerals, short runs
    '\u5fae\u4fe1\u767b\u5f55\u5d29\u6e83\u4e86\u62a5\u9519 123',                    // contact word + short number
  ];
  for (const t of PASS) ok('[3] pass: ' + t.slice(0, 24), fr(t) === null, String(fr(t)));
}

// ---- [4] daily cap ----
{
  ok('[4] FB_DAILY_CAP default 3', vv.FB_DAILY_CAP === 3);
  const day0 = 300000;                     // some tsMin
  const items = {
    a: { ap: 'A', st: 'live', ts: day0 }, b: { ap: 'A', st: 'capped', ts: day0 + 10 },
    c: { ap: 'A', st: 'filtered', ts: day0 + 20 },                    // filtered never consumes
    d: { ap: 'B', st: 'live', ts: day0 + 30 },                        // other author
    e: { ap: 'A', st: 'live', ts: day0 + 2000 },                      // other day (>=1440min)
  };
  ok('[4] count = same author, same day, non-filtered', vv.countAuthorDay(items, 'A', day0 + 40) === 2);
  ok('[4] other author independent', vv.countAuthorDay(items, 'B', day0 + 40) === 1);
}

// ---- [5] report hold state machine ----
{
  ok('[5] FB_REPORT_HOLD default 15', vv.FB_REPORT_HOLD === 15);
  const slot = {};
  for (let i = 0; i < 15; i++) slot['R' + i] = [3, 600];
  slot['AUTH'] = [3, 601];                                            // author self-report ignored
  slot['U1'] = [1, 602]; slot['C1'] = [0, 603];                       // non-reports ignored
  ok('[5] reportsSince counts unique latest-dir-3, self excluded', vv.reportsSince(slot, 'AUTH', -1) === 15);
  ok('[5] clearAt cutoff', vv.reportsSince(slot, 'AUTH', 600) === 0);
  const items = { '100': { ap: 'AUTH', st: 'live', ts: 500 }, '200': { ap: 'B', st: 'filtered', ts: 500 }, '300': { ap: 'C', st: 'archived', ts: 500 } };
  const votes = { '100': slot };
  ok('[5] threshold -> held (+ha stamped)', vv.governItems(items, votes, { block: [], allow: [], clear: {} }, 700) === true &&
     items['100'].st === 'held' && items['100'].ha === 700);
  vv.governItems(items, votes, { block: [], allow: [], clear: {} }, 800);
  ok('[5] no auto-restore while held', items['100'].st === 'held');
  // reporters retracting does NOT restore either (human call by decree)
  for (let i = 0; i < 15; i++) votes['100']['R' + i] = [0, 900];
  vv.governItems(items, votes, { block: [], allow: [], clear: {} }, 950);
  ok('[5] retraction alone never restores', items['100'].st === 'held');
  vv.governItems(items, votes, { block: [], allow: [], clear: { '100': 960 } }, 1000);
  ok('[5] admin clear >= ha restores', items['100'].st === 'live');
  // re-reports after clearance count fresh and re-hold
  for (let i = 0; i < 15; i++) votes['100']['R' + i] = [3, 1100];
  vv.governItems(items, votes, { block: [], allow: [], clear: { '100': 960 } }, 1200);
  ok('[5] post-clear reports re-hold', items['100'].st === 'held' && items['100'].ha === 1200);
  // block list declarative both ways + wins over everything
  vv.governItems(items, votes, { block: [100, 300], allow: [], clear: {} }, 1300);
  ok('[5] block wins (held->blocked, archived->blocked)', items['100'].st === 'blocked' && items['300'].st === 'blocked');
  vv.governItems(items, votes, { block: [100], allow: [200], clear: {} }, 1400);
  ok('[5] off-list releases + allow releases filtered', items['300'].st === 'live' && items['200'].st === 'live');
  ok('[5] on-list stays blocked despite reports', items['100'].st === 'blocked');
}

// ---- [6] moderation file loader ----
{
  ok('[6] loadMod missing -> empty defaults', JSON.stringify(vv.loadMod(path.join(os.tmpdir(), 'nope-mod.json'))) ===
     JSON.stringify({ block: [], allow: [], clear: {} }));
  const committed = vv.loadMod(path.join(__dirname, '..', 'feedback-mod.json'));
  ok('[6] committed skeleton parses', Array.isArray(committed.block) && Array.isArray(committed.allow) && typeof committed.clear === 'object');
}

// ---- [7] digest guards (network path is e2e-only) ----
(async () => {
  {
    delete process.env.FB_DIGEST_TO; delete process.env.RESEND_API_KEY; delete process.env.FB_DIGEST_FORCE;
    const st = { items: {}, votes: {}, digest: { day: '', at: 0 } };
    ok('[7] unconfigured -> off', (await vv.maybeSendDigest(st, Date.now())) === false && st.digest.day === '');
    process.env.FB_DIGEST_TO = 'x@example.com'; process.env.RESEND_API_KEY = 'k';
    st.digest.day = new Date().toISOString().slice(0, 10);
    ok('[7] same-day guard -> no resend', (await vv.maybeSendDigest(st, Date.now())) === false);
    delete process.env.FB_DIGEST_TO; delete process.env.RESEND_API_KEY;
  }

  // ---- [8] main() wiring pins (admission gate order + seams) ----
  ok('[8] fail-closed admission pin', SRC.includes('if (!wl) continue;'));
  ok('[8] filterReason wired with salt', SRC.includes('filterReason(it.text, wl, process.env.STATE_SALT)'));
  ok('[8] governItems wired in main', SRC.includes('governItems(st.items, st.votes, mod, nowMin)'));
  ok('[8] trust seam wired + zero-effect', SRC.includes('- trustPenaltyOf(') && vv.trustPenaltyOf('any') === 0);
  ok('[8] wordlist-missing warn (counts only)', SRC.includes('feedback wordlist unavailable'));
  ok('[8] held/blocked never candidates (single live gate)', /item\.st !== 'live'/.test(SRC));
  // held -> tombstone (restorability), blocked/nuke -> real delete
  {
    const t = vv.tombstoneDetails({ cat: 2, lang: 'en', ts: 777 }, 12345);
    ok('[8] tombstone shape (7 words, zero body len, id/ts kept)',
       t.length === 7 && (t[0] | 0) === vv.FB_MAGIC && (t[1] & 0xFF) === 0 && t[3] === 12345 && t[4] === 777 && t[5] === 0 && t[6] === 0);
    ok('[8] tombstone score bottom-pinned', vv.FB_TOMB_SCORE === -2147483647);
    ok('[8] held branch tombstones instead of delete (wiring)',
       /st\.items\[String\(cur\.itemId\)\]\.st === 'held'/.test(SRC) && SRC.includes('tombstoneDetails(heldItem, cur.itemId)'));
    ok('[8] tombstone slot rewritten on restore (idempotency skips need !cur.tomb)', SRC.includes('cur && !cur.tomb &&'));
  }
  // no invisible characters in source (zero-width literals are self-laid mines)
  ok('[8] no invisible chars in feedback.js', ![...SRC].some(c => { const p = c.codePointAt(0); return (p >= 0x200B && p <= 0x200F) || (p >= 0x2060 && p <= 0x206F) || p === 0xFEFF; }));

  console.log('feedback-govern: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' ok'));
  process.exit(fail ? 1 : 0);
})();
