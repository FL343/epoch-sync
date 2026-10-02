'use strict';
// Sandbox write fence: a run whose shard prefix is a TEST prefix may only write to leaderboards whose
// name contains "test". The live channels use a non-test prefix and must be untouched by the fence.
//   1. live prefix: writes go out whatever the board name
//   2. test prefix: writes to non-test / never-named boards are refused before any network call
//   3. names are learned from the board listing (getJson) and from find-or-create results
//   4. every leaderboard write in the repo goes through postForm / postFormDetails (static scan),
//      so a future direct fetch() cannot bypass the fence
// Network is stubbed by replacing global.fetch.
//   node test/sandbox-fence.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const fs = require('fs');
const path = require('path');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const t = (label, cond) => cond ? ok(label) : bad(label);

let posts = [];
let nextCreateId = 900;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (opts && opts.method === 'POST') {
    posts.push(u + ' ' + String(opts.body || ''));
    if (u.includes('FindOrCreateLeaderboard')) {
      const id = nextCreateId++;
      return { status: 200, ok: true, text: async () => JSON.stringify({ result: { result: 1, leaderboard: { leaderBoardID: id } } }) };
    }
    return { status: 200, ok: true, text: async () => JSON.stringify({ result: { result: 1 } }) };
  }
  if (u.includes('GetLeaderboardsForGame')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ response: { leaderboards: [
      { id: 5, name: 'wallet_test', entries: 0 }, { id: 6, name: 'wallet', entries: 0 }, { id: 7, name: 'Ladder_TEST_s1', entries: 0 },
    ] } }) };
  }
  return { status: 404, ok: false, text: async () => '' };
};

const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };

const V = require(path.join(__dirname, '..', 'validate.js'));
const SET = '/ISteamLeaderboards/SetLeaderboardScore/v1/';
const DEL = '/ISteamLeaderboards/DeleteLeaderboardScore/v1/';
const FOC = '/ISteamLeaderboards/FindOrCreateLeaderboard/v2/';
const set = (id) => V.postForm(SET, { key: 'k', appid: 1, leaderboardid: id, steamid: 's', score: 1, scoremethod: 'ForceUpdate', format: 'json' });

(async () => {
  t('isTestBoardName: suffix / mixed case / prefix', V.isTestBoardName('wallet_test') && V.isTestBoardName('Ladder_TEST_s1') && V.isTestBoardName('lbtest_pool'));
  t('isTestBoardName: live names and empty are not test', !V.isTestBoardName('wallet') && !V.isTestBoardName('') && !V.isTestBoardName(null));

  console.log('-- live prefix: fence inert');
  process.env.LB_PREFIX = 'rec_';
  t('sandboxOn() false on a live prefix', V.sandboxOn() === false);
  posts = [];
  let r = await set(6);
  t('live: write to an unnamed board id is sent', r.ok && posts.length === 1);
  r = await V.postForm(FOC, { key: 'k', appid: 1, name: 'wallet', format: 'json' });
  t('live: find-or-create of a live name is sent', r.ok && posts.length === 2);

  console.log('-- test prefix: fence armed');
  process.env.LB_PREFIX = 'pool_test_';
  t('sandboxOn() true on a test prefix', V.sandboxOn() === true);
  posts = [];
  r = await set(12345);
  t('sandbox: never-named board id refused, nothing sent', !r.ok && r.status === 0 && posts.length === 0);
  await V.getJson('https://x/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=k&appid=1&format=json');
  r = await set(5);
  t('sandbox: listed test board (wallet_test) written', r.ok && posts.length === 1);
  r = await set(7);
  t('sandbox: listed mixed-case test board written', r.ok && posts.length === 2);
  r = await set(6);
  t('sandbox: listed live board (wallet) refused, nothing sent', !r.ok && posts.length === 2 && /refused/.test(r.text));
  r = await V.postForm(DEL, { key: 'k', appid: 1, leaderboardid: 6, steamid: 's', format: 'json' });
  t('sandbox: delete on the live board refused', !r.ok && posts.length === 2);
  r = await V.postFormDetails(SET, { key: 'k', appid: 1, leaderboardid: 6, steamid: 's', score: 1, scoremethod: 'ForceUpdate', format: 'json' }, [1, 2]);
  t('sandbox: detail write on the live board refused', !r.ok && posts.length === 2);
  r = await V.postForm(FOC, { key: 'k', appid: 1, name: 'wallet', format: 'json' });
  t('sandbox: find-or-create of a live name refused', !r.ok && posts.length === 2);
  r = await V.postForm(FOC, { key: 'k', appid: 1, name: 'fresh_test', format: 'json' });
  t('sandbox: find-or-create of a test name sent', r.ok && posts.length === 3);
  const created = r.json && r.json.result && r.json.result.leaderboard && r.json.result.leaderboard.leaderBoardID;
  r = await set(created);
  t('sandbox: board id learned from find-or-create is writable', r.ok && posts.length === 4);
  const id = await V.findOrCreateBoard('other_test', 1);
  r = await set(id);
  t('sandbox: findOrCreateBoard helper result writable', id != null && r.ok);
  const warns = logs.filter(l => /sandbox \(test shard prefix\): refused write to non-test board wallet/.test(l));
  t('sandbox: one warning per refused board (not per write)', warns.length === 1);

  console.log('-- static: every leaderboard write goes through postForm / postFormDetails');
  const root = path.join(__dirname, '..');
  const files = fs.readdirSync(root).filter(f => f.endsWith('.js'));
  const leaks = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/fetch\s*\(/.test(line) && /SetLeaderboardScore|DeleteLeaderboardScore|FindOrCreateLeaderboard/.test(line)) leaks.push(f + ':' + (i + 1));
    });
  }
  t('no direct fetch() to a leaderboard write method (' + files.length + ' files scanned)', leaks.length === 0);
  if (leaks.length) leaks.forEach(l => origLog('        ' + l));
  const vsrc = fs.readFileSync(path.join(root, 'validate.js'), 'utf8');
  const guarded = (name) => new RegExp('async function ' + name + '\\(path, params[^)]*\\) \\{\\s*const refused = sandboxRefusal\\(path, params\\);').test(vsrc);
  t('postForm checks the fence before anything else', guarded('postForm'));
  t('postFormDetails checks the fence before anything else', guarded('postFormDetails'));

  console.log = origLog;
  delete process.env.LB_PREFIX;
  if (failN) { console.log('\n' + failN + ' FAILED'); process.exit(1); }
  console.log('\nALL PASS');
})().catch(e => { console.log = origLog; console.error(e); process.exit(1); });
