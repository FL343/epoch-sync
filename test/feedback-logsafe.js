'use strict';
// Log-safety tripwire: this pipeline runs in a PUBLIC repo whose Actions logs are
// public. Player text must never reach any log call -- logs may carry counts,
// board names, item ids and HTTP statuses only. (The sanitized text living in
// feedback.json is by design -- it is the same content the feed boards display to
// every player in game, keyed by HMAC pseudonym; logs are held to a stricter bar
// because they pair whatever they print with run context.)
// Scans every console.* / ghWarn call SPAN (balanced parens, so multi-line calls
// cannot hide a text identifier on a continuation line), fail-closed.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL ' + n + (d ? ' :: ' + d : '')); } };

const src = fs.readFileSync(path.join(__dirname, '..', 'feedback.js'), 'utf8')
  .replace(/\/\/[^\n]*/g, '');

// Collect full argument spans of log calls (paren walker; strings are not parsed --
// a ')' inside a string literal is rare in log args and would only SHORTEN a span,
// which can hide nothing that the next span-start would not rescan).
function logSpans(s) {
  const spans = [];
  const re = /(?:console\.(?:log|warn|error)|ghWarn)\s*\(/g;
  let m;
  while ((m = re.exec(s))) {
    let depth = 1, i = re.lastIndex;
    while (i < s.length && depth > 0) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') depth--;
      i++;
    }
    spans.push(s.slice(m.index, i));
  }
  return spans;
}

const spans = logSpans(src);
ok('scanner sanity: found log spans', spans.length >= 3, 'got ' + spans.length);
const BAD = /\btext\b|\.text\b|sanitizeText|unpackText/;
const hits = spans.filter(sp => BAD.test(sp));
ok('no player-text identifiers in any log span', hits.length === 0,
  hits.map(h => h.replace(/\s+/g, ' ').slice(0, 90)).join(' | '));

console.log('feedback-logsafe: ' + pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' ok'));
process.exit(fail ? 1 : 0);
