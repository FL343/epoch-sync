'use strict';
// Build the public hashed wordlist (feedback-wordlist.json) from the PRIVATE
// plaintext master. The public repo must never carry the words themselves: a
// readable list is an exact evasion cheat-sheet (and a page of slurs in the
// repo besides). Entries are HMAC-SHA256(STATE_SALT, folded word) truncated to
// 16 hex + the word's folded code-point length; the pipeline re-derives the
// same hashes from sliding windows of the folded text, so substring semantics
// survive hashing intact. Probing the filter behaviorally is throttled by the
// client's 15min submit cooldown.
//
// Master file (never committed): ~/gmt-secrets/feedback_wordlist_plain.txt
//   lines "<tier> <word>"; tier sub = substring, word = whole word (latin).
// Salt: env STATE_SALT, else ~/gmt-secrets/epoch_state_salt.txt (same salt as
// the HMAC pseudonyms -- one secret root, no new secret surface).
const fs = require('fs');
const path = require('path');
const os = require('os');
const fb = require('../feedback.js');

const HOME = os.homedir();
const PLAIN = process.env.FB_WORDLIST_PLAIN || path.join(HOME, 'gmt-secrets', 'feedback_wordlist_plain.txt');
const OUT = process.env.FB_WORDLIST_FILE || path.join(__dirname, '..', 'feedback-wordlist.json');
let salt = process.env.STATE_SALT || '';
if (!salt) {
  try { salt = fs.readFileSync(path.join(HOME, 'gmt-secrets', 'epoch_state_salt.txt'), 'utf8').trim(); } catch (e) {}
}
if (!salt) { console.error('no STATE_SALT (env or ~/gmt-secrets/epoch_state_salt.txt)'); process.exit(1); }

const lines = fs.readFileSync(PLAIN, 'utf8').split(/\r?\n/);
const sub = [], word = [];
for (const ln of lines) {
  const m = /^(sub|word)\s+(.+)$/.exec(ln.trim());
  if (!m) continue;
  const folded = fb.foldForWordlist(m[2]);
  if (!folded) continue;
  if (m[1] === 'sub') sub.push({ l: Array.from(folded).length, h: fb.wlHash(salt, folded) });
  else word.push(fb.wlHash(salt, folded));
}
if (!sub.length) { console.error('master produced no sub entries -- refusing to write an empty (fail-closed) list'); process.exit(1); }
const out = {
  _comment: [
    'Hashed content wordlist. Entries are HMAC-SHA256(STATE_SALT, word) cut to',
    '16 hex (+ folded code-point length for the substring tier); the plaintext',
    'master lives outside the repo. Rebuild: node tools/build-wordlist.js.',
    'Pipeline side fails closed: file missing/empty/unreadable = no new items',
    'admitted that tick.',
  ],
  alg: 'hmac-sha256-16hex',
  sub, word,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('wrote ' + OUT + ': sub=' + sub.length + ' word=' + word.length);
