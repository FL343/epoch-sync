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
  ok('[1] no non-latin plaintext leaked', !/[一-鿿぀-ヿ가-힯Ѐ-ӿ]/.test(rawTxt));
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
  const wl = mkWl(['傻逼', 'slurtoken'], ['retard', 'cunt']);
  const fr = (t) => vv.filterReason(t, wl, SALT);
  ok('[2] sub hit inline', fr('你就是个傻逼玩意') === 'wordlist');
  ok('[2] sub hit spaced (fold rejoins)', fr('傻 逼 玩 意') === 'wordlist');
  ok('[2] sub hit dotted', fr('s.l.u.r.t.o.k.e.n here') === 'wordlist');
  ok('[2] word tier hits whole token', fr('what a retard move') === 'wordlist');
  ok('[2] word tier no substring FP', fr('flame retardant walls idea') === null);
  ok('[2] scunthorpe safe', fr('greetings from scunthorpe') === null);
  ok('[2] clean CJK passes', fr('钩子手感有点飘，第三关物件太密了') === null);
  ok('[2] mild profanity passes (philosophy)', fr('this level design is shit but fun') === null);
  ok('[2] spam run', fr('aaaaaaaaaaaaaa') === 'spam');
  ok('[2] symbol noise', fr('!!!???...') === 'noise');
  ok('[2] wrong salt = no match (unreadable without secret)', vv.filterReason('傻逼', wl, 'other-salt') === null);
}

// ---- [3] ad/promo heuristics (TOP priority; evasion normalization) ----
{
  const wl = mkWl(['zzz-never'], []);
  const fr = (t) => vv.filterReason(t, wl, SALT);
  const AD = [
    '低价金币上 goldshop.com 快来', '有意加 www.example.net', 'https://x.yz/abc',
    'g o l d s h o p . c o m 全场五折', 'goldshop[.]com 出金币', 'goldshop(点)com',
    'goldshop。com', 'ｇｏｌｄｓｈｏｐ．ｃｏｍ', 'gоldshоp.cоm',    // fullwidth / cyrillic o
    'goldshop dot com', '加QQ群 123456789', '加 Q Q 群 1 2 3 4 5 6',
    '加群一二三四五六七', '微信abcd123 带你上分', 'vx12345678',
    '代练上分找我 65432101', '联系 98765432123',
  ];
  for (const t of AD) ok('[3] ad: ' + t.slice(0, 24), fr(t) === 'ad', String(fr(t)));
  const PASS = [
    '有人开外挂，麻烦封一下',                    // cheater report must pass
    'version 1.5 feels better than 2.0',        // dots, no TLD
    'i scored 1250000 in endless',              // 7 digits, no contact word
    '第一二关太简单，三四五关不错',              // CN numerals, short runs
    '微信登录崩溃了报错 123',                    // contact word + short number
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
  // no invisible characters in source (zero-width literals are self-laid mines)
  ok('[8] no invisible chars in feedback.js', ![...SRC].some(c => { const p = c.codePointAt(0); return (p >= 0x200B && p <= 0x200F) || (p >= 0x2060 && p <= 0x206F) || p === 0xFEFF; }));

  console.log('feedback-govern: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' ok'));
  process.exit(fail ? 1 : 0);
})();
