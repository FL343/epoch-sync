'use strict';
// ============================================================
// voice.js -- player-feedback pipeline (community feedback + votes)
// ============================================================
// Players submit short free-text feedback (client-writable voice_box board) and
// votes (voice_vote board, rolling window). This job harvests both, sanitizes,
// aggregates vote tallies, and republishes the display set onto trusted-writes
// feed boards (voice_feed_<cat>_<hot|new>) that clients read. Nothing a player
// wrote is ever shown to other players without passing through this job: the
// feed boards are the moderation choke point.
//
// Runs as its OWN workflow (feedback.yml), deliberately NOT inside the reconcile
// tick: harvesting two boards + rewriting up to 8 feed boards must never add
// latency to match settlement. State is disjoint (voice.json only), so the
// bot-state pushes of the two workflows can always rebase cleanly past each
// other; the persist step retries the push a few times to absorb the race.
//
// Wire formats (64x int32 details; locked with the client writer -- the client
// repo carries a lockstep test against the constants below):
//   box  entry: [0xB6, VER<<24|cat<<16|enc<<8|len, lang16, itemId, tsMin, body...]
//   vote entry: [0xB7, VER<<24|count<<16, (itemId, tsMin<<2|dir) * count]
//   feed entry: [0xB6, VER<<24|cat<<16|enc<<8|len, lang16, itemId, tsMin, up, down, body...]
// enc: 0=utf-8, 1=utf-16le (client picks whichever is smaller; body <= 208 bytes).
// lang16: two ASCII letters packed c0<<8|c1 (self-describing -- no table to sync).
// dir: 0=clear vote, 1=up, 2=down, 3=report (FB_REPORT_HOLD unique reporters
//      auto-unlist the item to 'held' pending human review, see governance below).
// tsMin: minutes since FB_EPOCH0 (custom epoch -- immune to the int32-seconds
//      2038 family by construction).
// itemId: fnv1a32(steamid + ':' + tsMin) -- recomputed here; mismatch = drop.
//
// Feed placement: one leaderboard entry per account is a Steam invariant, so
// "one display slot per author per board" is structural -- writing an author's
// better item simply overwrites their entry. An item is placeable only while
// its author sid is recoverable (still their current box entry, or already on
// a feed board); items that fall out of both are archived in state (votes kept).
//
// State (voice.json, public repo): sanitized text + HMAC pseudonyms only.
// Author identity for feed writes is recovered from live board reads each run
// and never persisted. Text is persisted only for items that are or were shown
// on the public feed boards (live / archived / held); items that never were or
// never may be (filtered / capped / blocked) keep a keyed fingerprint and their
// text is read back from the author's live box row when needed (publicState).
const fs = require('fs');
const crypto = require('crypto');
const v = require('./validate.js');   // main() is require-guarded; safe to import helpers

const FB_MAGIC = 0xB6, FB_VOTE_MAGIC = 0xB7, FB_VER = 1;
const FB_BODY_MAX = 208;                       // bytes; client enforces, we re-check
const FB_CATS = ['bug', 'idea', 'balance', 'other'];
const FB_EPOCH0 = Date.UTC(2026, 0, 1);        // ms; tsMin = minutes since this
const FB_VOTE_WINDOW = 30;                     // votes per rolling upload (2+30*2=62<=64)
const FB_TS_AHEAD_MAX = 400 * 1440;            // minutes a box stamp may run ahead of the cron (decodeBoxEntry)
const FB_LB = process.env.FB_LB || 'feedback_box';
const FB_VOTE_LB = process.env.FB_VOTE_LB || 'feedback_vote';
const FB_FEED_PREFIX = process.env.FB_FEED_PREFIX || 'feedback_feed';
const FB_STATE_FILE = process.env.FB_STATE_FILE || 'feedback.json';
const FB_FEED_CAP = Math.max(1, Number(process.env.FB_FEED_CAP || 100));
const FB_WRITE_CAP = Math.max(1, Number(process.env.FB_WRITE_CAP || 200));  // safety valve per run
// Governance (V4+V5 slice): daily display allowance per author, and the unique-
// reporter threshold that auto-unlists an item pending review. 15 is a decree
// (2026-08-14): clearly above what one full lobby / premade can muster, still
// reachable at this game's population; retune from real report distributions.
const FB_DAILY_CAP = Math.max(1, Number(process.env.FB_DAILY_CAP || 3));
const FB_REPORT_HOLD = Math.max(1, Number(process.env.FB_REPORT_HOLD || 15));
const FB_WORDLIST_FILE = process.env.FB_WORDLIST_FILE || 'feedback-wordlist.json';
const FB_MOD_FILE = process.env.FB_MOD_FILE || 'feedback-mod.json';

function feedBoardName(catIdx, sort) { return FB_FEED_PREFIX + '_' + FB_CATS[catIdx] + '_' + sort; }

function packLang(code) {
  const s = String(code || 'xx').toLowerCase();
  const a = s.charCodeAt(0) || 120, b = s.charCodeAt(1) || 120;
  return (((a & 0xFF) << 8) | (b & 0xFF)) | 0;
}
function unpackLang(n) { return String.fromCharCode((n >> 8) & 0xFF, n & 0xFF); }

function fnv1a32(s) {
  let h = 0x811c9dc5 >>> 0; s = String(s == null ? '' : s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h | 0;
}

// int32 words -> body bytes -> string (enc 0=utf8 1=utf16le)
function unpackText(words, ofs, len, enc) {
  const buf = Buffer.alloc(Math.max(0, len | 0));
  for (let i = 0; i < len; i++) {
    const w = words[ofs + (i >> 2)] | 0;
    buf[i] = (w >>> ((i & 3) * 8)) & 0xFF;
  }
  return buf.toString(enc === 1 ? 'utf16le' : 'utf8');
}
function packText(str, enc) {
  const buf = Buffer.from(String(str), enc === 1 ? 'utf16le' : 'utf8');
  const words = [];
  for (let i = 0; i < buf.length; i++) {
    const wi = i >> 2;
    if (words.length <= wi) words.push(0);
    words[wi] = (words[wi] | (buf[i] << ((i & 3) * 8))) | 0;
  }
  return { words, len: buf.length };
}

// Strip control chars (keep \n), collapse newline runs, trim. Returns '' when
// nothing survives -- caller drops the item.
function sanitizeText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function nowTsMin(nowMs) { return Math.floor(((nowMs == null ? Date.now() : nowMs) - FB_EPOCH0) / 60000); }
function dayOfTs(tsMin) { return Math.floor((FB_EPOCH0 + tsMin * 60000) / 86400000); }   // UTC day index

// ============================================================
// Governance (V4+V5): content filter + daily cap + moderation file + report hold
// ============================================================
// Item status machine (items[key].st):
//   live      placeable on feed boards
//   archived  author sid not recoverable -> cannot be placed (auto-flips back)
//   filtered  failed the content filter at admission; never shown; admin 'allow'
//             releases a false positive back to live
//   capped    past the author's FB_DAILY_CAP for that UTC day; never shown
//   held      unique reports crossed FB_REPORT_HOLD -> auto-unlisted pending
//             review. ONLY an admin clearance restores it -- cron never auto-
//             restores, even if reporters retract (review is a human call, §5)
//   blocked   on the moderation block list. The list is DECLARATIVE: on it =
//             blocked, dropped from it = released back to live.

// Content wordlist -- HASHED in the public repo (decree 2026-08-15: a readable
// list is an exact evasion cheat-sheet, so the file carries only
// HMAC-SHA256(STATE_SALT, folded word) cut to 16 hex, plus the folded
// code-point length for the substring tier). The plaintext master lives in
// ~/gmt-secrets; rebuild with tools/build-wordlist.js. Matching re-derives the
// same hashes from sliding windows of the folded text, so substring semantics
// survive hashing intact (~250 cps x ~10 lengths = a few thousand HMACs per
// NEW item -- negligible). FAIL-CLOSED by decree: file missing/unparseable/
// empty -> NO new item is admitted that tick (existing items untouched); a
// broken filter must never behave like an open gate. Two tiers:
//   sub:  substring match on case-folded, separator-stripped text (slurs and
//         unambiguous tokens; catches s-p-a-c-e-d and dotted variants)
//   word: whole-token match on lowercased text (short/ambiguous terms that
//         substring matching would false-positive on; latin scripts only)
function wlHash(salt, s) {
  return crypto.createHmac('sha256', String(salt)).update(String(s), 'utf8').digest('hex').slice(0, 16);
}
function loadWordlist(file) {
  try {
    const w = JSON.parse(fs.readFileSync(file || FB_WORDLIST_FILE, 'utf8'));
    const byLen = {};
    let nSub = 0;
    for (const e of (w.sub || [])) {
      const l = e && (e.l | 0), h = e && String(e.h || '');
      if (l > 0 && l <= 32 && /^[0-9a-f]{16}$/.test(h)) { (byLen[l] = byLen[l] || new Set()).add(h); nSub++; }
    }
    const word = new Set();
    for (const h of (w.word || [])) if (/^[0-9a-f]{16}$/.test(String(h))) word.add(String(h));
    if (!nSub) return null;
    return { byLen, word };
  } catch (e) { return null; }
}
function wlSubHit(folded, wl, salt) {
  const cps = Array.from(folded);
  for (const lStr of Object.keys(wl.byLen)) {
    const L = lStr | 0;
    if (L > cps.length) continue;
    const set = wl.byLen[lStr];
    for (let i = 0; i + L <= cps.length; i++) {
      if (set.has(wlHash(salt, cps.slice(i, i + L).join('')))) return true;
    }
  }
  return false;
}
function wlWordHit(low, wl, salt) {
  if (!wl.word.size) return false;
  for (const tok of low.split(/[^\p{L}\p{N}]+/u)) {
    if (tok && wl.word.has(wlHash(salt, tok))) return true;
  }
  return false;
}

// ---- Ad/promo detection: TOP filtering priority by decree (2026-08-15) ----
// Domains, QQ-group / WeChat plugs, bare long numbers. Spammers evade lazily
// (spacing, fullwidth chars, "[.]"/"(\u70B9)", Chinese numerals, Cyrillic look-
// alikes), so we NORMALIZE first and only then match: NFKC (fullwidth ->
// ascii, circled digits -> digits) + homoglyph fold + CN-numeral -> digit +
// every dot-spelling -> "." + wrapper strip. The arms race is not won here --
// novel evasions get added to the wordlist file (next tick, no code change),
// reports (>=FB_REPORT_HOLD) auto-unlist, and the daily digest + admin block
// the rest. Structurally this board is a terrible ad channel anyway: 15min
// cooldown, 3/day cap, one display slot per author, ~5min publish delay.
const AD_HOMOGLYPH = {
  '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y',
  '\u0456': 'i', '\u0455': 's', '\u0501': 'd', '\u03BD': 'v', '\u03BF': 'o', '\u03B1': 'a', '\u0442': 't', '\u043A': 'k',
};
const AD_CN_DIGIT = {
  '\u96F6': '0', '\u3007': '0', '\u4E00': '1', '\u58F9': '1', '\u4E8C': '2', '\u8D30': '2', '\u4E24': '2',
  '\u4E09': '3', '\u53C1': '3', '\u56DB': '4', '\u8086': '4', '\u4E94': '5', '\u4F0D': '5', '\u516D': '6',
  '\u9646': '6', '\u4E03': '7', '\u67D2': '7', '\u516B': '8', '\u634C': '8', '\u4E5D': '9', '\u7396': '9',
};
// dom = surface for domain matching (dots kept + dot-spellings folded in,
// wrappers/noise stripped, whitespace around dots tightened);
// dig = surface for contact/number matching (everything non-alnum stripped so
// spaced-out digits and keywords rejoin).
function adSurfaces(low) {
  let s = low.normalize ? low.normalize('NFKC').toLowerCase() : low;
  let out = '';
  for (const ch of s) out += AD_HOMOGLYPH[ch] || AD_CN_DIGIT[ch] || ch;
  let dom = out
    .replace(/[\u3002\u3001\u4E36\u30FB\u2027\u00B7\u2219\u2022\u22C5]/g, '.')
    .replace(/\u70B9/g, '.')
    .replace(/\bdot\b/g, '.')
    .replace(/[()[\]{}<>"'`*~|:;!?,]/g, '')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\.{2,}/g, '.');
  const dig = out.replace(/[^\p{L}\p{N}]/gu, '');
  return { norm: out, dom, dig };
}
const AD_DOMAIN_RE = /(?:https?:\/\/|www\.)|(?:[a-z0-9-]{2,}\.)+(?:com|net|org|cn|top|xyz|cc|tv|shop|vip|club|icu|info|io|me|gg|tk|site|online|store|fun|pro|live|app|link|co)\b/;
// contact keyword near a number (keyword ALONE never filters: "\u6709\u4EBA\u5F00\u5916\u6302" is
// honest feedback about cheaters, "\u5916\u6302\u7FA4123456" is the ad)
const AD_CONTACT_NEAR_RE = /(?:qq|\u6263\u6263|\u4F01\u9E45|q\u7FA4|\u52A0\u7FA4|\u8FDB\u7FA4|\u5FAE\u4FE1|weixin|wx|vx|\u8587\u4FE1|\u5A01\u4FE1|\u7535\u62A5|telegram|discord|\u4EE3\u7EC3|\u4EE3\u6253|\u5916\u6302|\u8F85\u52A9|\u4F4E\u4EF7|\u51FA\u552E|\u6536\u8D2D|\u5237\u5206)[^0-9]{0,6}[0-9]{4,}/;
// ...or anywhere in the text alongside a QQ-length number (7+ digits; 6-digit
// error codes stay safe, real QQ/phone plugs are 8-11)
const AD_CONTACT_WORD_RE = /(?:qq|\u6263\u6263|\u4F01\u9E45|q\u7FA4|\u52A0\u7FA4|\u8FDB\u7FA4|\u5FAE\u4FE1|weixin|\u8587\u4FE1|\u5A01\u4FE1|\u7535\u62A5|telegram|discord|\u4EE3\u7EC3|\u4EE3\u6253|\u4F4E\u4EF7|\u51FA\u552E|\u6536\u8D2D|\u5237\u5206)/;
// unambiguous contact words may also plug a letters id (WeChat ids are alnum)
const AD_CONTACT_ID_RE = /(?:\u5FAE\u4FE1|weixin|\u8587\u4FE1|\u5A01\u4FE1|\u6263\u6263|\u4F01\u9E45|\u52A0\u7FA4|\u8FDB\u7FA4)\u53F7?[a-z][a-z0-9_-]{3,}/;
const AD_DIGITRUN_RE = /[0-9]{9,}/;
function adReason(low) {
  const s = adSurfaces(low);
  // URL schemes checked on the intact normalized text (the dom surface strips
  // ':' as wrapper noise, which would eat "https://")
  if (/(?:https?:\/\/|www\.)/.test(s.norm)) return 'ad';
  // spelled-out letters ("g o l d s h o p . c o m") rejoin when all whitespace
  // goes; \b on the TLD keeps ordinary joined sentences from matching
  if (AD_DOMAIN_RE.test(s.dom) || AD_DOMAIN_RE.test(s.dom.replace(/\s+/g, ''))) return 'ad';
  if (AD_CONTACT_NEAR_RE.test(s.dig) || AD_CONTACT_ID_RE.test(s.dig)) return 'ad';
  if (AD_CONTACT_WORD_RE.test(s.dig) && /[0-9]{7,}/.test(s.dig)) return 'ad';
  if (AD_DIGITRUN_RE.test(s.dig)) return 'ad';
  return null;
}

// Shared fold for wordlist matching -- the SAME fold is applied to candidate
// text windows at match time and to master words at build time (tools/
// build-wordlist.js), so hashes line up by construction.
function foldForWordlist(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\s\u200B-\u200F\u2060-\u206F\uFEFF.,_\-*|~'"`!?:;()[\]{}]/g, '');
}

// Why an item must not be shown, or null. Ad heuristics first (top priority,
// code-side so they hold even while the wordlist evolves), then the hashed
// wordlist, then noise heuristics: long single-char runs (keyboard mash) and
// bodies with no letter or digit at all (pure symbol noise).
function filterReason(text, wl, salt) {
  const raw = String(text == null ? '' : text);
  const low = raw.toLowerCase();
  const folded = foldForWordlist(low);
  const ad = adReason(low);
  if (ad) return ad;
  if (wlSubHit(folded, wl, salt)) return 'wordlist';
  if (wlWordHit(low, wl, salt)) return 'wordlist';
  if (/(.)\1{9,}/.test(folded)) return 'spam';
  if (!/[\p{L}\p{N}]/u.test(raw)) return 'noise';
  return null;
}

// Items this author already has on the same UTC day (filtered ones don't
// consume the allowance -- they were never displayable).
function countAuthorDay(items, ap, tsMin) {
  const day = dayOfTs(tsMin | 0);
  let n = 0;
  for (const k of Object.keys(items)) {
    const it = items[k];
    if (it.ap === ap && it.st !== 'filtered' && dayOfTs(it.ts | 0) === day) n++;
  }
  return n;
}

// Moderation control file, written by tools/feedback-admin.js and committed to
// the repo (the next tick applies it). Absent file = empty defaults: moderation
// is opt-in, the wordlist above is the fail-closed side.
//   block: [itemId]        declarative unlist (on = blocked, off = released)
//   allow: [itemId]        wordlist false-positive release (filtered -> live)
//   clear: {itemId: tsMin} held review passed -- reports at/before tsMin stop
//                          counting and the item returns to the boards
//   recat: {itemId: cat}   misfiled item shown under another category (cat =
//                          index into FB_CATS); dropping the key moves it back
function loadMod(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file || FB_MOD_FILE, 'utf8'));
    return {
      block: (m.block || []).map(n => n | 0),
      allow: (m.allow || []).map(n => n | 0),
      clear: (m.clear && typeof m.clear === 'object') ? m.clear : {},
      recat: cleanRecat(m.recat),
    };
  } catch (e) { return { block: [], allow: [], clear: {}, recat: {} }; }
}
// Only integer categories inside FB_CATS survive; anything else is ignored
// (a typo in the hand-edited file must not take an item off every board).
function cleanRecat(r) {
  const out = {};
  if (!r || typeof r !== 'object' || Array.isArray(r)) return out;
  for (const key of Object.keys(r)) {
    const c = r[key];
    if (Number.isInteger(c) && c >= 0 && c < FB_CATS.length && /^-?\d+$/.test(key)) out[String(key | 0)] = c;
  }
  return out;
}

// Unique reporters whose LATEST direction is still 'report', cast after the
// item's last admin clearance (self reports never count, tallyVotes discipline).
function reportsSince(slot, authorPid, clearAt) {
  let n = 0;
  for (const pidKey of Object.keys(slot || {})) {
    if (pidKey === authorPid) continue;
    const rec = slot[pidKey];
    if ((rec[0] | 0) === 3 && (rec[1] | 0) > (clearAt | 0)) n++;
  }
  return n;
}

// trust_tier reserve (B5/B6 discipline: record-only until real traffic
// calibrates thresholds): low-trust authors get down-weighted or withheld here
// once the reconcile trust map ships. Zero-effect seam, pinned by tests.
function trustPenaltyOf(pid) { return 0; }

// Apply the moderation file + report threshold to the item set. Mutates items,
// returns whether anything changed. Category moves first (orthogonal to status,
// so a blocked item keeps its move for when it is released), then the block list
// (declarative, wins over everything), then allow (filtered release), then the
// report hold.
function governItems(items, votes, mod, nowMin) {
  let dirty = false;
  const blockSet = new Set(mod.block.map(String));
  const allowSet = new Set(mod.allow.map(String));
  const recat = mod.recat || {};
  for (const key of Object.keys(items)) {
    const item = items[key];
    // recat: item.oc keeps the category the author picked, so dropping the key
    // restores it; the feed pass and the digest just read item.cat
    const rc = recat[key];
    if (rc != null) {
      if ((item.cat | 0) !== rc) { if (item.oc == null) item.oc = item.cat | 0; item.cat = rc; dirty = true; }
      if (item.oc != null && (item.oc | 0) === rc) { delete item.oc; dirty = true; }
    } else if (item.oc != null) {
      item.cat = item.oc | 0; delete item.oc; dirty = true;
    }
    if (blockSet.has(key)) {
      if (item.st !== 'blocked') { item.st = 'blocked'; dirty = true; }
      continue;
    }
    if (item.st === 'blocked') { item.st = 'live'; dirty = true; }
    if (item.st === 'filtered' && allowSet.has(key)) { item.st = 'live'; dirty = true; }
    const clearAt = (mod.clear[key] != null) ? (mod.clear[key] | 0) : -1;
    const rep = reportsSince(votes[key], item.ap, clearAt);
    if (item.st === 'live' && rep >= FB_REPORT_HOLD) {
      item.st = 'held'; item.ha = nowMin | 0; dirty = true;
    } else if (item.st === 'held' && clearAt >= (item.ha | 0) && rep < FB_REPORT_HOLD) {
      // held -> live happens ONLY through a clearance younger than the hold;
      // reporters retracting on their own never restores (human call by decree)
      item.st = 'live'; dirty = true;
    }
  }
  return dirty;
}

// Decode + validate one voice_box entry. Returns {itemId,cat,lang,ts,text} or null.
// ts is the author's clock: a stamp ahead of ours (wrong time zone + hand-set clock) is clamped to
// nowMin instead of dropped, so a fast clock neither loses the item nor dates it in the future (the
// daily cap, the hot/new order and the digest all key on item.ts). itemId keeps the author's stamp.
// The provenance check binds itemId to sid + stamp, but itemId is an unkeyed 32-bit hash, so what keeps
// another account's row off a chosen itemId is how few stamps one account may use: with every future
// stamp accepted (2^31 per account), seconds of search find a stamp that lands on any given item. Stamps
// more than FB_TS_AHEAD_MAX ahead are dropped again (400 days: a clock set a year ahead still passes),
// which keeps the stamps per account at about a million, within a small factor of the old +1 day limit;
// main() also never lets a row speak for an item admitted for another author (foreignBoxRow).
function decodeBoxEntry(sid, words, nowMin) {
  if (!words || words.length < 6 || words[0] !== FB_MAGIC) return null;
  const w1 = words[1] | 0;
  const ver = (w1 >>> 24) & 0xFF, cat = (w1 >>> 16) & 0xFF, enc = (w1 >>> 8) & 0xFF, len = w1 & 0xFF;
  if (ver !== FB_VER || cat >= FB_CATS.length || enc > 1) return null;
  if (len < 1 || len > FB_BODY_MAX || words.length < 5 + ((len + 3) >> 2)) return null;
  const lang = unpackLang(words[2] | 0), itemId = words[3] | 0, ts = words[4] | 0;
  if (ts < 0) return null;                                          // before the epoch = not a real stamp
  if (nowMin != null && ts > (nowMin | 0) + FB_TS_AHEAD_MAX) return null;   // see above
  if (fnv1a32(String(sid) + ':' + ts) !== itemId) return null;      // provenance check
  const text = sanitizeText(unpackText(words, 5, len, enc));
  if (!text) return null;
  // A tampered oversize body re-encodes past the cap -> fail closed.
  if (Buffer.byteLength(text, 'utf8') > FB_BODY_MAX * 3) return null;
  return { itemId, cat, lang, ts: nowMin == null ? ts : Math.min(ts, nowMin | 0), text };
}

// True when a box row decodes to an item the state already holds for another author. Two accounts'
// rows can carry the same itemId (see decodeBoxEntry); taken as is, such a row becomes that item's
// author for the feed writes: the post is shown under the other account and the real author's slot is
// deleted (an admin release of a filtered item likewise lands under the other account). main() skips
// the row, so an item is only ever attributed to the author it was admitted for: item.ap, the same
// pseudonym (v.pid) as the admission. A new itemId seen twice in one run is covered too: the first row
// admits the item before the second is read.
function foreignBoxRow(items, sid, words, nowMin) {
  const it = decodeBoxEntry(sid, words, nowMin);
  const item = it && items[String(it.itemId)];
  return !!item && item.ap !== v.pid(String(sid));
}

// Decode one voice_vote entry into [{itemId, dir, ts}] (window order kept).
function decodeVoteEntry(words) {
  if (!words || words.length < 2 || words[0] !== FB_VOTE_MAGIC) return [];
  const w1 = words[1] | 0;
  const ver = (w1 >>> 24) & 0xFF, count = (w1 >>> 16) & 0xFF;
  if (ver !== FB_VER || count > FB_VOTE_WINDOW || words.length < 2 + count * 2) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const itemId = words[2 + i * 2] | 0, w = words[3 + i * 2] | 0;
    out.push({ itemId, dir: w & 3, ts: w >>> 2 });
  }
  return out;
}

// Merge decoded vote windows into state.votes: per (voter, itemId) the latest
// ts wins (re-vote / un-vote / report are all just the newest direction).
// voterPid: the voter's key, or a function of the item key giving it (Q209: one token per voter and item, voteTok).
function mergeVotes(votes, voterPid, decoded) {
  let dirty = false;
  for (const vt of decoded) {
    const key = String(vt.itemId);
    const slot = votes[key] || (votes[key] = {});
    const vk = typeof voterPid === 'function' ? voterPid(key) : voterPid;
    const cur = slot[vk];
    if (!cur || vt.ts > cur[1] || (vt.ts === cur[1] && vt.dir !== cur[0])) {
      slot[vk] = [vt.dir, vt.ts];
      dirty = true;
    }
  }
  return dirty;
}

// Q190 (cloud audit 2026-10): votes are keyed by the voter's own pseudonym for this lane, not validate.js pid. The voice
// box pairs author SteamIDs with item ids and the state records each author as a pid (item.ap), and other public boards
// tie pids to SteamIDs too, so pid keys let anyone read off who voted on -- and who REPORTED (dir 3) -- which post.
// voterKey matches no pid and no other lane. A vote by the item's own author is never stored (the tallies skipped it by
// comparing the key to item.ap, which a voter key never equals), nor is a vote for an item the state does not hold
// (clients only see items this job admitted and published; the voter's rolling window still carries it next run).
// st.vkv marks votes on voter keys.
// Q209: a voter key stayed with the voter across every item he voted on or reported, so once one of his votes was tied to
// him (a report on a post only he had seen, a vote cast right after he joined a match) every other one was too. Votes are
// now stored under voteTok -- one token per (voter, item), nothing in it shared by two items -- written as vt (the folded
// pid votes '~0', '~1', ... stay in vv, the field the Q190 version reads, so a rollback keeps them). A Q190 table (vv
// holding voter keys) moves onto the tokens when it is read (storedVotes); st.vkv 2 marks a table on the tokens.
const FB_VOTER_KEYS = 2;
function voterKey(sid) { return v.pid('fb-vote|' + sid); }
function voteTok(vk, itemKey) { return v.pid('fb-vt|' + vk + '|' + itemKey); }
// st.vpre: keyed tokens of the (voter, item) pairs that had a vote on pid keys when those votes were folded (rekeyVotes);
// no account in them, fixed from then on. Such a voter's later votes on that item are not taken (see rekeyVotes).
function preVoteTok(voterPid, itemKey) { return v.pid('fb-pre|' + voterPid + '|' + itemKey); }
// One voter's decoded window -> the votes to store: items the state holds, not his own, not one he voted on before the fold.
function storableVotes(items, sid, decoded, pre) {
  const own = v.pid(String(sid));
  return decoded.filter(vt => { const key = String(vt.itemId), it = items[key]; return !!it && it.ap !== own && !(pre && pre.size && pre.has(preVoteTok(own, key))); });
}
// The pid-keyed table still to fold: the whole vote table before the first fold, afterwards only what an older version
// left in the votes field after a rollback (loadState).
function pidVoteTable(st) { return st.vkv === FB_VOTER_KEYS ? (st.pidVotes || {}) : (st.votes || {}); }
// Fold pid-keyed votes into the voter-keyed table without carrying any voter over. A vote copied from a pid key onto the
// voter's new key in the same commit (same direction, same stamp) shows anyone who diffs that commit which voter key is
// which pid, and so every later vote and report of that voter. So each vote that counts (not the author's own, not for an
// item the state does not hold, not cleared) stays on its item under a numbered key with no account in it ('~0', '~1', ...
// in stamp order; never equal to a voter key or a pid): the item's up / down / report counts and the report hold stay
// exactly as they were. Each (voter, item) pair that had a vote, counted or not, goes into st.vpre, so the voter's rolling
// window -- which still carries those votes -- does not bring them in again under his voter key (that would count him twice,
// and pair the two keys again). The cost: on an item he had voted on before the fold his later change, retraction or report
// is not taken (the item keeps his old vote); new items are voted as usual. Needs no board read.
// Pid-keyed leftovers NEXT TO a voter-keyed table (st.vkv) are only marked in st.vpre, not kept: the same voter may already
// have his vote there under his voter key, and a second copy would count him twice (a report twice: a post held for
// nothing). An older version keeps only the fields it knows (vv and vpre are not among them), so after a real rollback
// the whole table comes back pid-keyed and is folded as on the first run. Returns { kept, dropped, pre }.
function rekeyVotes(st) {
  const leftovers = st.vkv === FB_VOTER_KEYS;
  const from = pidVoteTable(st), votes = leftovers ? (st.votes || {}) : {};
  const pre = new Set(st.vpre || []);
  const res = { kept: 0, dropped: 0, pre: 0 };
  for (const key of Object.keys(from)) {
    const item = (st.items || {})[key], slot = from[key] || {};
    const keep = [];
    for (const k of Object.keys(slot)) {
      pre.add(preVoteTok(k, key));
      const rec = slot[k] || [], dir = rec[0] | 0;
      if (leftovers || !item || k === item.ap || dir < 1 || dir > 3) { res.dropped++; continue; }
      keep.push([dir, rec[1] | 0]);
    }
    if (!keep.length) continue;
    keep.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    const to = votes[key] || (votes[key] = {});
    let n = Object.keys(to).filter(k => k.charAt(0) === '~').length;
    for (const x of keep) { while (to['~' + n]) n++; to['~' + n] = x; n++; res.kept++; }
  }
  st.votes = votes; st.pidVotes = {}; st.vkv = FB_VOTER_KEYS;
  if (pre.size) st.vpre = Array.from(pre).sort(); else delete st.vpre;
  res.pre = pre.size;
  return res;
}

// Tally one item's votes, excluding the author's own (self votes and self
// reports never count). dir 0 entries count as nothing (cleared).
function tallyVotes(slot, authorPid) {
  let up = 0, down = 0, rep = 0;
  for (const pidKey of Object.keys(slot || {})) {
    if (pidKey === authorPid) continue;
    const dir = slot[pidKey][0] | 0;
    if (dir === 1) up++; else if (dir === 2) down++; else if (dir === 3) rep++;
  }
  return { up, down, rep };
}

// hot = net votes weighted minus age in hours (older items decay one point per
// hour; a fresh +1 outweighs a day-old +25 tie). new = tsMin (custom epoch).
function hotScoreOf(up, down, ts, nowMs) {
  const ageH = Math.floor(((nowMs == null ? Date.now() : nowMs) - (FB_EPOCH0 + ts * 60000)) / 3600000);
  const s = (up - down) * 100 - Math.max(0, ageH);
  return Math.max(-2147483648, Math.min(2147483647, s)) | 0;
}

// Held items keep their feed slot as a ZERO-BODY TOMBSTONE instead of being
// deleted: the entry preserves the author sid on the board, so an admin
// clearance can actually put the item back -- a delete would orphan the item
// forever once the author's box slot moves on to a newer submission (state
// keeps HMAC pseudonyms only, never sids, by decree). Clients reject a
// zero-length body at decode (7 words < min 8) and never display it. Bounded
// caveat: the author's other live item in the same category can still claim
// the slot; restorability then degrades to box-recovery only. Blocked/nuked
// items are deleted for real -- permanent removal has no restore surface.
const FB_TOMB_SCORE = -2147483647;
function tombstoneDetails(item, itemId) {
  const w1 = ((FB_VER & 0xFF) << 24) | ((item.cat & 0xFF) << 16);
  return [FB_MAGIC | 0, w1 | 0, packLang(item.lang), itemId | 0, item.ts | 0, 0, 0];
}

function packFeedDetails(item, up, down) {
  // Prefer the smaller encoding, same rule as the client writer.
  const u8 = packText(item.text, 0), u16 = packText(item.text, 1);
  const pick = u16.len < u8.len ? { enc: 1, p: u16 } : { enc: 0, p: u8 };
  if (pick.p.len > FB_BODY_MAX) return null;
  const w1 = ((FB_VER & 0xFF) << 24) | ((item.cat & 0xFF) << 16) | ((pick.enc & 0xFF) << 8) | (pick.p.len & 0xFF);
  return [FB_MAGIC | 0, w1 | 0, packLang(item.lang), item.itemId | 0, item.ts | 0, up | 0, down | 0].concat(pick.p.words);
}

// Q209: the vote table of a state file (the tokens vt + the folded votes and any Q190 voter keys in vv), or null when the file
// holds no voter-keyed table. A voter key in vv (a Q190 version wrote it; vt is then gone, that version keeps no field it
// does not know) becomes the voter's token on that item; were a token already there, the later vote wins. vv's numbered
// keys are taken, vt's are not (they are only ever written to vv), so no folded vote counts twice.
function storedVotes(s) {
  const vt = (s && s.vt && typeof s.vt === 'object') ? s.vt : null, vv = (s && s.vv && typeof s.vv === 'object') ? s.vv : null;
  if (!vt && !vv) return null;
  const out = {};
  for (const key of Object.keys(vt || {})) {
    const slot = vt[key] || {}, to = {};
    for (const k of Object.keys(slot)) if (k.charAt(0) !== '~') to[k] = slot[k];
    if (Object.keys(to).length) out[key] = to;
  }
  for (const key of Object.keys(vv || {})) {
    const slot = vv[key] || {};
    for (const k of Object.keys(slot)) {
      const rec = slot[k];
      if (!Array.isArray(rec)) continue;
      const to = out[key] || (out[key] = {});
      if (k.charAt(0) === '~') { to[k] = rec; continue; }
      const t = voteTok(k, key), cur = to[t];
      if (!cur || (rec[1] | 0) > (cur[1] | 0)) to[t] = rec;
    }
  }
  return out;
}
// how many votes of a state file sit on Q190 voter keys (vv entries that are not a folded '~n' vote)
function q190Votes(s) {
  let n = 0;
  const vv = (s && s.vv && typeof s.vv === 'object') ? s.vv : {};
  for (const key of Object.keys(vv)) for (const k of Object.keys(vv[key] || {})) if (k.charAt(0) !== '~' && Array.isArray(vv[key][k])) n++;
  return n;
}
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(FB_STATE_FILE, 'utf8'));
    const o = { boards: s.boards || {}, items: s.items || {}, votes: s.votes || {}, digest: s.digest || { day: '', at: 0 } };
    // Q190: votes on voter keys are stored as vv (see storedState); votes on disk is then an older version's pid-keyed table
    // Q209: and those on voter / item tokens as vt (storedVotes reads both)
    const sv = storedVotes(s);
    if (sv) { o.pidVotes = o.votes; o.votes = sv; o.vkv = FB_VOTER_KEYS; }
    const vmove = q190Votes(s);   // Q209: a Q190 table moves onto the tokens with this run's write (main), not with a later vote
    if (vmove) o.vmove = vmove;
    if (Array.isArray(s.vpre) && s.vpre.length) o.vpre = s.vpre;
    return o;
  } catch (e) { return { boards: {}, items: {}, votes: {}, digest: { day: '', at: 0 } }; }
}
// State is the ONLY file in this repo that persists player-written text (item bodies of
// live / archived / held items, see publicState), and the CI bot commits it without local hooks -- so the writer itself must
// keep the file ASCII-only (\uXXXX escapes; JSON.parse round-trips them losslessly). Raw
// non-ASCII here leaked real player feedback text into the public repo on the playtest
// channel (2026-08-22) and then bricked every local push on the repo-wide Han scan.
// Escaping per UTF-16 code unit is valid JSON (surrogate pairs stay paired escapes).
function asciiJson(o) {
  return JSON.stringify(o).replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
function saveState(st) { fs.writeFileSync(FB_STATE_FILE, asciiJson(publicState(st))); }
// Q190 (publicState): once on voter keys (st.vkv), the vote table is written as vv and the votes field -- what an older version of this
// job reads -- is left empty (or holds that version's pid-keyed leftovers until they are folded). A rollback then rebuilds
// its pid-keyed table from the vote board windows instead of counting every voter twice (once per key); it keeps only the
// fields it knows (vv and vpre are gone after it), and the next run of this version folds that table again (rekeyVotes).
// Q209: the votes on voter / item tokens go to vt, each item's tokens in key order (in insertion order the tokens one voter
// added in a run would sit in the same place on every item); vv keeps the folded votes ('~0', '~1', ...), so a rollback to
// the Q190 version still counts them and rebuilds the rest from the vote board windows under its voter keys (votes that
// left the windows are lost: only fewer votes count, and a held post stays held -- only an admin clearance releases it).
function storedState(st) {
  const o = Object.assign({}, st);
  delete o.vkv; delete o.pidVotes; delete o.vmove;
  if (st.vkv === FB_VOTER_KEYS) {
    const vv = {}, vt = {};
    for (const key of Object.keys(st.votes || {})) {
      const slot = st.votes[key] || {};
      const folded = Object.keys(slot).filter(k => k.charAt(0) === '~'), toks = Object.keys(slot).filter(k => k.charAt(0) !== '~').sort();
      if (folded.length) { const f = vv[key] = {}; for (const k of folded) f[k] = slot[k]; }
      if (toks.length) { const t = vt[key] = {}; for (const k of toks) t[k] = slot[k]; }
    }
    o.vv = vv; o.votes = st.pidVotes || {};
    if (Object.keys(vt).length) o.vt = vt; else delete o.vt;
  }
  return o;
}

// Which item text may sit in the committed state file (audit Q189, 2026-10-11). The state file
// lives in a PUBLIC repo and git history keeps every version forever, so text goes there only
// when it is public anyway: live / archived items were (or are) on the feed boards every
// player reads, and a held item needs its text to come back after an admin clearance (its feed
// slot is a zero-body tombstone). Text that never was and never may be shown stays out:
// filtered (failed the content filter -- ads, contact numbers, wordlist hits, so the very text
// most likely to carry a phone number or an insult), capped (over the daily cap, never shown)
// and blocked (permanent removal by the admin). Those keep `th`, a keyed fingerprint of the
// admitted text; whenever the text is needed again (an admin 'allow' / unblock, the daily
// digest, the admin console) it is read back from the author's live box row and accepted only
// when the fingerprint matches -- a box row rewritten under the same item id cannot slip
// unreviewed text onto the feed. Display behavior is unchanged: such an item can reach the
// feed only through its box row (it never had a feed slot, or lost it to a real delete), so
// the stored text could never be shown once that row was gone. What is lost is only the
// digest / console view of a row the author has already replaced.
const FB_TEXT_PUBLIC = Object.freeze(['live', 'archived', 'held']);
function textSig(key, text, salt) { return wlHash(salt == null ? process.env.STATE_SALT : salt, 'fb-text|' + key + '|' + text); }
function mayKeepText(item) { return FB_TEXT_PUBLIC.indexOf(item && item.st) >= 0; }
function publicState(st) {
  const items = {};
  for (const key of Object.keys(st.items || {})) {
    const item = st.items[key];
    if (mayKeepText(item) || item.text == null) { items[key] = item; continue; }
    const o = {};
    for (const f of Object.keys(item)) if (f !== 'text') o[f] = item[f];
    o.th = textSig(key, item.text);
    items[key] = o;
  }
  return Object.assign({}, storedState(st), { items });
}
// Legacy state (written before Q189) may still carry text a non-public item must not keep.
function needsTextScrub(st) {
  return Object.keys(st.items || {}).some(k => !mayKeepText(st.items[k]) && st.items[k].text != null);
}
// Runtime-only: put back the text of items whose state copy carries the fingerprint only,
// from this run's box reads (textByItem: itemId -> sanitized text), fingerprint-checked.
// Returns how many items still have no text afterwards. salt: the state salt (default env;
// tools/feedback-admin.js passes its own).
function hydrateText(items, textByItem, salt) {
  let missing = 0;
  for (const key of Object.keys(items)) {
    const item = items[key];
    if (item.text != null) continue;
    const t = textByItem[key];
    if (t != null && item.th != null && textSig(key, t, salt) === item.th) item.text = t;
    else missing++;
  }
  return missing;
}

const FB_DIGEST_GONE = '(text not available: filtered / capped / blocked text is not kept in the public state, and the author has replaced this box row since)';

// ---- daily digest (rides the O49 Resend channel) ----
// First tick after a UTC day rollover mails every item admitted since the last
// watermark to the owner's inbox for a once-over (the name-and-unlist workflow,
// §5). The mail body carries player text -- the inbox is private; LOGS still
// carry counts only (feedback-logsafe tripwire). A failed send keeps the
// watermark -> retried next tick. Unconfigured env = silently off.
// "Since the last digest" is decided by admission, not by the author's clock:
// main() admits every new item with pd:1 and a sent digest clears it, so an
// author whose clock runs hours slow (stamp below the watermark) is still
// mailed. Items admitted before pd existed keep the ts > watermark rule; the
// watermark (max ts mailed) is still kept for them and for a rollback.
async function maybeSendDigest(st, nowMs) {
  const to = process.env.FB_DIGEST_TO, apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return false;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const dg = st.digest || (st.digest = { day: '', at: 0 });
  if (dg.day === day && !process.env.FB_DIGEST_FORCE) return false;
  const since = dg.at | 0;
  const fresh = Object.keys(st.items)
    .map(k => ({ id: k, it: st.items[k] }))
    .filter(x => x.it.pd === 1 || (x.it.pd === undefined && (x.it.ts | 0) > since))
    .sort((a, b) => (a.it.ts | 0) - (b.it.ts | 0));
  let maxTs = since;
  for (const x of fresh) maxTs = Math.max(maxTs, x.it.ts | 0);
  if (fresh.length) {
    // filtered / capped / blocked text is not in the state file (publicState); main() read it
    // back from the box before this call -- an item whose author replaced the row since says so
    let gone = 0;
    const lines = fresh.slice(0, 200).map(x => {
      const t = tallyVotes(st.votes[x.id], x.it.ap);
      if (x.it.text == null) gone++;
      return '[' + FB_CATS[x.it.cat | 0] + '/' + x.it.lang + ' st=' + x.it.st + ' +' + t.up + '/-' + t.down +
        ' rep' + t.rep + ' id=' + x.id + ']\n' + (x.it.text != null ? x.it.text : FB_DIGEST_GONE);
    });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FB_DIGEST_FROM || 'onboarding@resend.dev',
        to: [to],
        subject: (process.env.FB_DIGEST_TAG || '') + 'feedback digest ' + day + ': ' + fresh.length + ' new',
        text: 'New player feedback since the last digest: ' + fresh.length + '\n' +
          (gone ? 'Text no longer readable (author replaced the box row; not kept in the public state): ' + gone + '\n' : '') +
          'Unlist: run tools/feedback-admin.js (or add the id to feedback-mod.json "block").\n\n' +
          lines.join('\n\n'),
      }),
    });
    if (!res.ok) { v.ghWarn('feedback digest send failed HTTP ' + res.status); return false; }
  }
  for (const x of fresh) delete x.it.pd;
  st.digest = { day, at: maxTs };
  return true;
}

async function main() {
  const missing = [];
  for (const k of ['APPID', 'STEAM_PUBLISHER_KEY', 'STATE_SALT']) if (!process.env[k]) missing.push(k);
  if (missing.length) { console.error('missing env: ' + missing.join(', ')); process.exit(1); }
  const nowMs = Date.now(), nowMin = nowTsMin(nowMs);
  const st = loadState();
  let dirty = needsTextScrub(st);              // legacy text a non-public item must not keep: rewrite this run
  const wl = loadWordlist();
  const mod = loadMod();
  if (!wl) v.ghWarn('feedback wordlist unavailable -- admitting no new items this tick (fail-closed)');

  // ---- resolve boards (find-or-create bypasses the listing lag; box/vote are
  //      client-writable and provisioned out of band -- absent = skip, warn) ----
  const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + process.env.STEAM_PUBLISHER_KEY + '&appid=' + process.env.APPID + '&format=json');
  const list = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []);
  const byName = (n) => { const f = list.find(x => String(x.name || x.Name) === n); return f ? (f.id || f.ID) : null; };
  // Listing-lag bypass for the two client-writable boards: FindOrCreateLeaderboard
  // with createifnotfound=0 is a pure by-name lookup (never creates, so it can
  // never mis-provision them as trusted-writes). Ids are cached in state.
  const findBoard = async (n) => {
    if (st.boards[n]) return st.boards[n];
    let id = byName(n);
    if (!id) {
      const res = await v.postForm('/ISteamLeaderboards/FindOrCreateLeaderboard/v2/', {
        key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, name: n, createifnotfound: 0, format: 'json',
      });
      const lb = (res.json && res.json.result && res.json.result.leaderboard) || (res.json && res.json.leaderboard) || null;
      id = lb && (lb.leaderBoardID || lb.leaderboardID || lb.id || lb.ID) || null;
    }
    if (id) { st.boards[n] = id; dirty = true; }
    return id;
  };
  const boxId = await findBoard(FB_LB), voteId = await findBoard(FB_VOTE_LB);
  if (!boxId) { console.log('feedback box board absent (pre-create ' + FB_LB + ', client-writable) -- skip run'); return; }
  let foreignN = 0;                            // box rows naming an item admitted for another author (skipped)

  // ---- harvest submissions (admission gate: filter + daily cap) ----
  const sidByItem = {};                        // runtime only, never persisted
  const textByItem = {};                       // runtime only: box text per item id (hydrateText)
  const box = await v.readBoardAll(boxId, 'voice box');
  let newItems = 0, filteredN = 0, cappedN = 0;
  for (const e of box.ents) {
    const sid = String(e.steamID);
    if (foreignBoxRow(st.items, sid, v.decodeDetails(e.detailData), nowMin)) { foreignN++; continue; }   // an item keeps its author
    const it = decodeBoxEntry(sid, v.decodeDetails(e.detailData), nowMin);
    if (!it) continue;
    sidByItem[String(it.itemId)] = sid;
    textByItem[String(it.itemId)] = it.text;
    const key = String(it.itemId);
    if (!st.items[key]) {
      if (!wl) continue;                       // fail-closed: no filter, no admissions
      const ap = v.pid(sid);
      let stt = 'live';
      if (filterReason(it.text, wl, process.env.STATE_SALT) && mod.allow.indexOf(it.itemId | 0) < 0) stt = 'filtered';
      else if (countAuthorDay(st.items, ap, it.ts) >= FB_DAILY_CAP) stt = 'capped';
      st.items[key] = { ap, cat: it.cat, lang: it.lang, ts: it.ts, text: it.text, st: stt, pd: 1 };
      if (stt === 'filtered') filteredN++; else if (stt === 'capped') cappedN++;
      newItems++; dirty = true;
    }
  }
  if (foreignN) v.ghWarn('feedback: skipped ' + foreignN + ' box row(s) carrying the id of an item admitted for another author ' +
    '(an id collision attempt, or STATE_SALT changed without resetting the feedback state)');

  // ---- harvest votes ----
  // Q190: votes still on pid keys are folded once (and an older version's leftovers after a rollback), no voter carried
  //   over (rekeyVotes); needs no board read, so the vote board below is always taken on voter keys only
  if (st.vkv !== FB_VOTER_KEYS || Object.keys(st.pidVotes || {}).length) {
    const had = Object.keys(pidVoteTable(st)).length;
    const mv = rekeyVotes(st);
    if (had) {
      dirty = true;
      console.log('feedback: pid-keyed votes folded for the voter keys (Q190): ' + mv.kept + ' kept on their items without a voter, ' + mv.dropped + ' dropped, ' + mv.pre + ' voter/item pair(s) marked as voted');
    }
  }
  if (st.vmove) {
    dirty = true;
    console.log('feedback: votes moved onto one token per voter and item (Q209): ' + st.vmove + ' vote(s)');
    delete st.vmove;
  }
  let voteEnts = 0;
  if (voteId) {
    const vb = await v.readBoardAll(voteId, 'feedback votes');
    const pre = new Set(st.vpre || []);
    for (const e of vb.ents) {
      const decoded = decodeVoteEntry(v.decodeDetails(e.detailData));
      if (!decoded.length) continue;
      voteEnts++;
      const vk = voterKey(String(e.steamID));
      if (mergeVotes(st.votes, (key) => voteTok(vk, key), storableVotes(st.items, e.steamID, decoded, pre))) dirty = true;
    }
  }

  // ---- governance: moderation file (block/allow/clear) + report hold ----
  if (governItems(st.items, st.votes, mod, nowMin)) dirty = true;
  // filtered / capped / blocked items carry a fingerprint only (publicState): read their text back
  // from the box rows just harvested (an 'allow' / unblock above needs it for the feed, the digest
  // below for the mail); never persisted for them -- saveState strips it again
  hydrateText(st.items, textByItem);

  // ---- read current feed boards (recovers author sids for older items) ----
  const feeds = {};                            // name -> { id, entries: {sid: {itemId, score}} }
  for (let c = 0; c < FB_CATS.length; c++) {
    for (const sort of ['hot', 'new']) {
      const name = feedBoardName(c, sort);
      let id = st.boards[name] || byName(name);
      if (!id) { id = await v.findOrCreateBoard(name); }
      if (!id) { console.log('feed board unavailable: ' + name + ' -- skip'); continue; }
      if (st.boards[name] !== id) { st.boards[name] = id; dirty = true; }
      const br = await v.readBoardAll(id, name);
      const entries = {};
      for (const e of br.ents) {
        const d = v.decodeDetails(e.detailData);
        if (d[0] === FB_MAGIC && d.length >= 7) {
          entries[String(e.steamID)] = { itemId: d[3] | 0, score: e.score | 0, up: d[5] | 0, down: d[6] | 0, tomb: (d[1] & 0xFF) === 0 };
          if (!sidByItem[String(d[3] | 0)]) sidByItem[String(d[3] | 0)] = String(e.steamID);
        } else {
          entries[String(e.steamID)] = { itemId: 0, score: e.score | 0, up: 0, down: 0, tomb: false };
        }
      }
      feeds[name] = { id, entries };
    }
  }

  // ---- archive items that are no longer placeable anywhere ----
  // placeable = author sid recoverable AND text present (an item released from filtered / blocked
  // whose box row is gone has neither; archiving it on both keeps the flip stable)
  for (const key of Object.keys(st.items)) {
    const item = st.items[key];
    const placeable = !!sidByItem[key] && item.text != null;
    if (item.st === 'live' && !placeable) { item.st = 'archived'; dirty = true; }
    else if (item.st === 'archived' && placeable) { item.st = 'live'; dirty = true; }
  }

  // ---- compute + write desired feed sets ----
  let writes = 0, dels = 0, tombs = 0, writeFail = 0;
  for (let c = 0; c < FB_CATS.length; c++) {
    // candidates: live items of this category with a recoverable author
    const cand = [];
    for (const key of Object.keys(st.items)) {
      const item = st.items[key];
      if (item.st !== 'live' || (item.cat | 0) !== c || !sidByItem[key]) continue;
      const t = tallyVotes(st.votes[key], item.ap);
      cand.push({ key, item, sid: sidByItem[key], up: t.up, down: t.down });
    }
    for (const sort of ['hot', 'new']) {
      const name = feedBoardName(c, sort);
      const feed = feeds[name];
      if (!feed) continue;
      const scored = cand.map(x => ({ ...x, score: sort === 'hot' ? hotScoreOf(x.up, x.down, x.item.ts, nowMs) - trustPenaltyOf(x.item.ap) : (x.item.ts | 0) }))
        .sort((a, b) => b.score - a.score || (b.item.ts | 0) - (a.item.ts | 0));
      const seen = new Set(); const desired = [];
      for (const x of scored) {                 // one slot per author = their best item
        if (seen.has(x.sid)) continue;
        seen.add(x.sid); desired.push(x);
        if (desired.length >= FB_FEED_CAP) break;
      }
      const desiredSids = new Set(desired.map(x => x.sid));
      for (const x of desired) {
        const cur = feed.entries[x.sid];
        // items are keyed by itemId (x.key); the item record itself has no itemId
        // field -- comparing a nonexistent field made every run rewrite every
        // entry (caught by the e2e idempotency assertion).
        if (cur && !cur.tomb && cur.itemId === (x.key | 0) && cur.score === x.score && cur.up === x.up && cur.down === x.down) continue;
        if (writes + dels + tombs >= FB_WRITE_CAP) { v.ghWarn('feedback write cap reached (' + FB_WRITE_CAP + ') -- rest next run'); break; }
        const det = packFeedDetails({ ...x.item, itemId: x.key | 0 }, x.up, x.down);
        if (!det) continue;
        const r = await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', {
          key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, leaderboardid: feed.id,
          steamid: x.sid, score: x.score, scoremethod: 'ForceUpdate', format: 'json',
        }, det);
        if (r.ok) writes++; else { writeFail++; v.ghWarn('feed write failed ' + name + ' HTTP ' + r.status); }
      }
      for (const sid of Object.keys(feed.entries)) {
        if (desiredSids.has(sid)) continue;
        if (writes + dels + tombs >= FB_WRITE_CAP) break;
        const cur = feed.entries[sid];
        const heldItem = cur.itemId && st.items[String(cur.itemId)] && st.items[String(cur.itemId)].st === 'held'
          ? st.items[String(cur.itemId)] : null;
        if (heldItem) {
          // held -> tombstone, not delete (restorability; see tombstoneDetails)
          if (cur.tomb) continue;
          const r = await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', {
            key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, leaderboardid: feed.id,
            steamid: sid, score: FB_TOMB_SCORE, scoremethod: 'ForceUpdate', format: 'json',
          }, tombstoneDetails(heldItem, cur.itemId));
          if (r.ok) tombs++; else { writeFail++; v.ghWarn('feed tombstone failed ' + name + ' HTTP ' + r.status); }
          continue;
        }
        const r = await v.postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', {
          key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, leaderboardid: feed.id,
          steamid: sid, format: 'json',
        });
        if (r.ok) dels++; else v.ghWarn('feed delete failed ' + name + ' HTTP ' + r.status);
      }
    }
  }

  if (await maybeSendDigest(st, nowMs)) { dirty = true; console.log('feedback digest sent (' + st.digest.day + ')'); }

  if (dirty) saveState(st);
  const cnt = {};
  for (const k of Object.keys(st.items)) { const s2 = st.items[k].st; cnt[s2] = (cnt[s2] || 0) + 1; }
  console.log('feedback: items+' + newItems + ' (total ' + Object.keys(st.items).length +
    ', filtered ' + (cnt.filtered || 0) + ', capped ' + (cnt.capped || 0) +
    ', held ' + (cnt.held || 0) + ', blocked ' + (cnt.blocked || 0) + '), voteEnts=' + voteEnts +
    ', feed writes=' + writes + ' tombs=' + tombs + ' dels=' + dels + (writeFail ? ' FAILED=' + writeFail : '') +
    (foreignN ? ' foreignRows=' + foreignN : '') + (dirty ? ' state saved' : ' no state change'));
}

if (require.main === module) {
  main().catch(e => { console.error('feedback run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = {
  FB_MAGIC, FB_VOTE_MAGIC, FB_VER, FB_BODY_MAX, FB_CATS, FB_EPOCH0,
  FB_VOTE_WINDOW, FB_LB, FB_VOTE_LB, FB_FEED_PREFIX, FB_FEED_CAP, FB_TS_AHEAD_MAX,
  FB_DAILY_CAP, FB_REPORT_HOLD, FB_WORDLIST_FILE, FB_MOD_FILE,
  feedBoardName, packLang, unpackLang, fnv1a32, unpackText, packText, sanitizeText,
  nowTsMin, decodeBoxEntry, foreignBoxRow, decodeVoteEntry, mergeVotes, tallyVotes, hotScoreOf, packFeedDetails,
  FB_VOTER_KEYS, voterKey, voteTok, storedVotes, preVoteTok, storableVotes, rekeyVotes, pidVoteTable, storedState,
  dayOfTs, loadWordlist, adSurfaces, adReason, filterReason, countAuthorDay,
  loadMod, reportsSince, trustPenaltyOf, governItems, maybeSendDigest,
  wlHash, wlSubHit, wlWordHit, foldForWordlist, asciiJson,
  FB_TOMB_SCORE, tombstoneDetails,
  FB_TEXT_PUBLIC, FB_DIGEST_GONE, textSig, mayKeepText, publicState, needsTextScrub, hydrateText,
};
