'use strict';
// Unit tests for the scale-safe board reads:
//   1. readBoardAll -- cursor pagination over GetLeaderboardEntries (the API silently caps one
//      request at 5000 rows; the old single read dropped records / base values past that with no
//      error). Short page => complete:true; PAGE_CAP hit => complete:false (caller must on-demand
//      fetch missing base values instead of settling from 0).
//   2. readUserEntry -- single-player targeted read (RequestAroundUser 0/0) used for exactly those
//      missing base values; absent entry => null (genuine new player, base 0 is then correct).
// Network is stubbed by replacing global.fetch; URLs are parsed to route/paginate like the API.
//   node test/board-paging.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const path = require('path');
const V = require(path.join(__dirname, '..', 'validate.js'));
const { readBoardAll, readUserEntry, PAGE_SIZE, PAGE_CAP } = V;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const eq = (label, got, exp) => { const a = JSON.stringify(got), b = JSON.stringify(exp); if (a === b) ok(label + ' = ' + (a.length > 90 ? a.slice(0, 90) + '…' : a)); else bad(label + ' = ' + a + ' (EXPECT ' + b + ')'); };
const t = (label, cond) => cond ? ok(label) : bad(label);

// ---- fetch stub: serves a synthetic board of N entries, honoring rangestart/rangeend and
//      RequestAroundUser; counts calls so pagination behavior is assertable. ----
let boardSize = 0, calls = [];
const entry = (i) => ({ steamID: 'sid' + i, score: i, detailData: '' });
global.fetch = async (url) => {
  calls.push(url);
  const q = {};
  for (const kv of String(url).split('?')[1].split('&')) { const [k, v] = kv.split('='); q[k] = decodeURIComponent(v || ''); }
  let ents = [];
  if (q.datarequest === 'RequestAroundUser') {
    const n = Number(String(q.steamid).replace('sid', ''));
    if (n >= 1 && n <= boardSize) ents = [entry(n)];
  } else {
    const start = Number(q.rangestart), end = Math.min(Number(q.rangeend), boardSize);
    for (let i = start; i <= end; i++) ents.push(entry(i));
  }
  return { status: 200, ok: true, text: async () => JSON.stringify({ leaderboardEntryInformation: { leaderboardEntries: ents } }) };
};

(async () => {
  console.log('=== readBoardAll: cursor pagination ===');
  eq('PAGE_SIZE is the API cap', PAGE_SIZE, 5000);
  t('PAGE_CAP >= 2 (paging actually enabled)', PAGE_CAP >= 2);

  boardSize = 0; calls = [];
  let r = await readBoardAll(101, 'empty');
  eq('empty board: 0 entries, complete', [r.ents.length, r.complete, calls.length], [0, true, 1]);

  boardSize = 3; calls = [];
  r = await readBoardAll(101, 'small');
  eq('small board: 1 short page, complete', [r.ents.length, r.complete, calls.length], [3, true, 1]);
  eq('small board: entries in rank order', r.ents.map(e => e.steamID), ['sid1', 'sid2', 'sid3']);

  boardSize = PAGE_SIZE; calls = [];
  r = await readBoardAll(101, 'exact-page');
  // a full first page cannot prove exhaustion -- a second (empty) page confirms it
  eq('exactly one full page: 2 calls, complete', [r.ents.length, r.complete, calls.length], [PAGE_SIZE, true, 2]);

  boardSize = PAGE_SIZE + 7; calls = [];
  r = await readBoardAll(101, 'two-pages');
  eq('5000+7: both pages merged, complete', [r.ents.length, r.complete, calls.length], [PAGE_SIZE + 7, true, 2]);
  eq('page boundary continuity (…,5000,5001,…)', [r.ents[PAGE_SIZE - 1].steamID, r.ents[PAGE_SIZE].steamID], ['sid' + PAGE_SIZE, 'sid' + (PAGE_SIZE + 1)]);

  boardSize = PAGE_SIZE * PAGE_CAP + 1; calls = [];
  r = await readBoardAll(101, 'over-cap');
  eq('board past PAGE_CAP: capped read, complete=false (caller must on-demand fetch)', [r.ents.length, r.complete, calls.length], [PAGE_SIZE * PAGE_CAP, false, PAGE_CAP]);

  console.log('=== readUserEntry: targeted base-value read ===');
  boardSize = PAGE_SIZE * PAGE_CAP + 50; calls = [];
  const hit = await readUserEntry(101, 'sid' + (PAGE_SIZE * PAGE_CAP + 20), 'points');
  t('player beyond the bulk window is found (no silent base-0 reset)', !!hit && hit.score === PAGE_SIZE * PAGE_CAP + 20);
  const miss = await readUserEntry(101, 'sid999999999', 'points');
  eq('absent player returns null (genuine new player, base 0 correct)', miss, null);

  console.log(failN ? ('=== FAIL (' + failN + ') ===') : '=== PASS (board-paging) ===');
  process.exit(failN ? 1 : 0);
})().catch(e => { console.log('  FAIL  unhandled: ' + (e && e.stack || e)); process.exit(1); });
