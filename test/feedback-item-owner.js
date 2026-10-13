'use strict';
// Player feedback (feedback.js): an item keeps the author it was admitted for. itemId = fnv1a32(sid:stamp)
// is an unkeyed 32-bit hash, so a box row from another account can carry the same id; such a row must never
// take the item over (the post shown under that account and the author's slot deleted, an admin release of
// a filtered post landing under it). Two guards, both pinned here: stamps more than FB_TS_AHEAD_MAX ahead of
// the cron are dropped (a clock a year fast still passes), so one account has about a million stamps to
// search instead of 2^31; and main() skips a box row whose id names an item admitted for another author
// (foreignBoxRow), whatever the order of the rows on the board.
// Unit checks in-process; main() as a child process on a stateful stubbed Steam and a pinned clock (no
// network, every file in a temp dir), so nothing depends on today's date.
process.env.STATE_SALT = 'owner-test-salt';   // before validate.js loads: in-process v.pid = the child's
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const fb = require(path.join(__dirname, '..', 'feedback.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0, n = 0;
const ok = (label, cond, detail) => { n++; if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail != null ? ' (' + detail + ')' : '')); } };
const SALT = process.env.STATE_SALT;
const DAY1 = Date.UTC(2026, 10, 20, 9, 0), NM1 = fb.nowTsMin(DAY1);
const MIN = 60000;
// fnv1a32 collisions [author sid, author stamp, other sid, other stamp], found offline by a birthday search:
// the author stamps sit a minute before DAY1, the other stamps in the past, inside every bound.
const PAIR_A = ['76561198000000762', 465660, '76561198000051098', 301892];   // a live post
const PAIR_B = ['76561198000001355', 465659, '76561198000051664', 301010];   // a filtered post an admin releases
const PAIR_V = ['76561198000001276', 465659, '76561198000051769', 301010];   // two new rows in one run
// colliding stamps far in the future (a search over all 2^31 stamps of one account): the stamp bound drops them
const FAR_A = ['76561198000000101', 465660, '76561198000088002', 1101626802];
const FAR_B = ['76561198000000102', 465659, '76561198000077000', 1505941386];
const C_SID = '76561198000000801', VOTER = '76561198000000901';
const BAD = 'zqxbadword';                                                    // the one wordlist entry
// client packSubmit mirror (utf8)
const boxWords = (sid, text, cat, ts) => {
  const p = fb.packText(text, 0);
  return [fb.FB_MAGIC | 0, ((1 << 24) | ((cat & 0xFF) << 16) | p.len) | 0, fb.packLang('en'), fb.fnv1a32(String(sid) + ':' + ts), ts | 0].concat(p.words);
};
const idOf = (sid, ts) => fb.fnv1a32(String(sid) + ':' + ts);

console.log('=== feedback-item-owner [0] fixtures: each pair collides ===');
for (const [name, p] of [['A', PAIR_A], ['B', PAIR_B], ['V', PAIR_V], ['far A', FAR_A], ['far B', FAR_B]]) {
  ok('pair ' + name + ': two accounts, one itemId', p[0] !== p[2] && idOf(p[0], p[1]) === idOf(p[2], p[3]));
}
ok('the near pairs use past stamps (inside any bound)', [PAIR_A, PAIR_B, PAIR_V].every(p => p[1] <= NM1 && p[3] <= NM1));

console.log('=== feedback-item-owner [1] the stamp bound ===');
{
  const T = fb.FB_TS_AHEAD_MAX;
  ok('FB_TS_AHEAD_MAX is exported as a number', Number.isInteger(T) && T > 0, T);
  ok('a clock a year fast still passes (bound >= 366 days)', T >= 366 * 1440, T);
  ok('stamps one account may use at DAY1 stay under 2^21 (vs 2^31 unbounded)', NM1 + T + 1 < 2 ** 21, NM1 + T + 1);
  const sid = '76561198000000011';
  const edge = fb.decodeBoxEntry(sid, boxWords(sid, 'clock exactly at the bound', 0, NM1 + T), NM1);
  ok('stamp at now + bound: kept, clamped to now, itemId = author stamp', !!edge && edge.ts === NM1 && edge.itemId === idOf(sid, NM1 + T));
  ok('stamp at now + bound + 1 minute: dropped', fb.decodeBoxEntry(sid, boxWords(sid, 'one minute past the bound', 0, NM1 + T + 1), NM1) === null);
  const year = fb.decodeBoxEntry(sid, boxWords(sid, 'clock set a year ahead', 0, NM1 + 365 * 1440), NM1);
  ok('a clock 365 days fast: kept, clamped to now', !!year && year.ts === NM1);
  const day2 = fb.decodeBoxEntry(sid, boxWords(sid, 'clock two days ahead', 0, NM1 + 2 * 1440), NM1);
  ok('a clock 2 days fast: kept (the old +1 day limit stays lifted)', !!day2 && day2.ts === NM1);
  for (const [name, p] of [['A', FAR_A], ['B', FAR_B]]) {
    const w = boxWords(p[2], 'far stamp on someone else\'s id', 0, p[3]);
    ok('far-future colliding row ' + name + ': dropped at DAY1', fb.decodeBoxEntry(p[2], w, NM1) === null);
    ok('far-future colliding row ' + name + ': still dropped a year later', fb.decodeBoxEntry(p[2], w, NM1 + 365 * 1440) === null);
  }
  const noClock = fb.decodeBoxEntry(FAR_A[2], boxWords(FAR_A[2], 'decoded without a clock', 0, FAR_A[3]));
  ok('no clock given (tools, client round trips): no bound, stamp as is', !!noClock && noClock.ts === FAR_A[3]);
}

console.log('=== feedback-item-owner [2] foreignBoxRow ===');
if (typeof fb.foreignBoxRow !== 'function') ok('foreignBoxRow is exported', false);
else {
  const [A, tA, X, tX] = PAIR_A;
  const idA = String(idOf(A, tA));
  const items = { [idA]: { ap: v.pid(A), cat: 0, lang: 'en', ts: tA, text: 'author post', st: 'live' } };
  const wA = boxWords(A, 'author post', 0, tA), wX = boxWords(X, 'not the author', 0, tX);
  const dX = fb.decodeBoxEntry(X, wX, NM1);
  ok('the other account\'s row decodes to the same id (provenance passes)', !!dX && String(dX.itemId) === idA);
  ok('the author\'s own row is not foreign', fb.foreignBoxRow(items, A, wA, NM1) === false);
  ok('the other account\'s row is foreign', fb.foreignBoxRow(items, X, wX, NM1) === true);
  ok('same pseudonym as the admission (v.pid, keyed by STATE_SALT)', v.pid(A) === fb.wlHash(SALT, A) && v.pid(A) !== fb.wlHash(SALT + 'x', A));
  const other = '76561198000000012';
  ok('a row for an item not in the state is not foreign', fb.foreignBoxRow(items, other, boxWords(other, 'brand new', 0, NM1 - 1), NM1) === false);
  ok('an undecodable row is not foreign', fb.foreignBoxRow(items, X, [1, 2, 3], NM1) === false);
  const fw = boxWords(FAR_A[2], 'far', 0, FAR_A[3]);
  ok('a far-future row is not foreign (the decode drops it first)', fb.foreignBoxRow({ [String(idOf(FAR_A[0], FAR_A[1]))]: { ap: v.pid(FAR_A[0]) } }, FAR_A[2], fw, NM1) === false);
  const flipped = { [idA]: Object.assign({}, items[idA], { ap: v.pid(X) }) };
  ok('symmetric: if the other account was admitted first, the late row is the foreign one', fb.foreignBoxRow(flipped, A, wA, NM1) === true && fb.foreignBoxRow(flipped, X, wX, NM1) === false);
}

// ---- main() harness: stateful stubbed Steam (writes and deletes change the world for the next run) ----
const hexLE = (arr) => arr.map(x => { const h = ((x | 0) >>> 0).toString(16).padStart(8, '0'); return h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); }).join('');
const STUB = [
  "const fs = require('fs');",
  'const FAKE = Number(process.env.OWNER_FAKE_NOW), RealDate = Date;',
  'class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } }',
  'global.Date = FakeDate;',
  'const W = process.env.OWNER_WORLD;',
  "const load = () => JSON.parse(fs.readFileSync(W, 'utf8')), save = (w) => fs.writeFileSync(W, JSON.stringify(w));",
  'const hexLE = ' + hexLE.toString() + ';',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t, json: async () => o }; };',
  'const words = (body) => { const m = /&details=(.*)$/.exec(body); if (!m) return []; const b = Buffer.from(m[1].split("%").filter(Boolean).map(h => parseInt(h, 16))); const o = []; for (let i = 0; i + 4 <= b.length; i += 4) o.push(b.readInt32LE(i)); return o; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url), w = load();',
  "  if (/api\\.resend\\.com/.test(u)) return resp({ id: 'mail' });",
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || ''), q = new URLSearchParams(body.replace(/&details=.*$/, ''));",
  "    if (/FindOrCreateLeaderboard/.test(u)) { const b = w.boards.find(x => x.name === q.get('name')); return resp(b ? { result: { result: 1, leaderboard: { leaderBoardID: b.id } } } : { result: { result: 2 } }); }",
  "    const b = w.boards.find(x => String(x.id) === q.get('leaderboardid'));",
  '    if (!b) return resp({ result: { result: 2 } });',
  "    if (/SetLeaderboardScore/.test(u)) { const e = { steamID: q.get('steamid'), score: Number(q.get('score')) | 0, details: words(body) }; const i = b.entries.findIndex(x => x.steamID === e.steamID); if (i >= 0) b.entries[i] = e; else b.entries.push(e); }",
  "    if (/DeleteLeaderboardScore/.test(u)) b.entries = b.entries.filter(x => x.steamID !== q.get('steamid'));",
  '    save(w); return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: w.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = w.boards.find(x => String(x.id) === /leaderboardid=([0-9]+)/.exec(u)[1]);',
  '    const rs = Number((/rangestart=([0-9]+)/.exec(u) || [0, 1])[1]), re = Number((/rangeend=([0-9]+)/.exec(u) || [0, 5000])[1]);',
  '    const ents = (b ? b.entries : []).slice(Math.max(0, rs - 1), re);',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: hexLE(e.details || []) })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');

function harness(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-owner-' + tag + '-'));
  const stub = path.join(dir, 'stub.js'), worldF = path.join(dir, 'world.json');
  fs.writeFileSync(stub, STUB);
  fs.writeFileSync(path.join(dir, 'wordlist.json'), JSON.stringify({ sub: [{ l: BAD.length, h: fb.wlHash(SALT, BAD) }], word: [] }));
  const boards = [{ id: 1, name: 'feedback_box', entries: [] }, { id: 2, name: 'feedback_vote', entries: [] }];
  let id = 10;
  for (let c = 0; c < fb.FB_CATS.length; c++) for (const s of ['hot', 'new']) boards.push({ id: id++, name: fb.feedBoardName(c, s), entries: [] });
  fs.writeFileSync(worldF, JSON.stringify({ boards }));
  const world = () => JSON.parse(fs.readFileSync(worldF, 'utf8'));
  const setBox = (rows) => { const w = world(); w.boards[0].entries = rows.map(r => ({ steamID: r[0], score: r[2][4] | 0, details: r[2] })); fs.writeFileSync(worldF, JSON.stringify(w)); };
  const setVotes = (rows) => { const w = world(); w.boards[1].entries = rows.map(r => ({ steamID: r[0], score: 0, details: r[1] })); fs.writeFileSync(worldF, JSON.stringify(w)); };
  const run = (nowMs, mod) => {
    fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify(mod || { block: [], allow: [], clear: {} }));
    const env = Object.assign({}, process.env, {
      OWNER_FAKE_NOW: String(nowMs), OWNER_WORLD: worldF, READ_RETRY_MS: '0', FB_FEED_CAP: '1',
      APPID: '1', STEAM_PUBLISHER_KEY: 'k', STATE_SALT: SALT,
      FB_STATE_FILE: path.join(dir, 'state.json'), FB_MOD_FILE: path.join(dir, 'mod.json'), FB_WORDLIST_FILE: path.join(dir, 'wordlist.json'),
    });
    for (const k of ['FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_LB', 'FB_VOTE_LB', 'FB_FEED_PREFIX', 'FB_WRITE_CAP', 'LB_PREFIX', 'GITHUB_STEP_SUMMARY']) delete env[k];
    const r = spawnSync(process.execPath, ['-r', stub, path.join(__dirname, '..', 'feedback.js')], { env, cwd: dir, encoding: 'utf8' });
    let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch (e) {}
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || ''), st, items: st.items || {} };
  };
  // feed entries per board name: [{sid, itemId, up, text}]
  const feed = () => {
    const o = {};
    for (const b of world().boards) {
      if (!/^feedback_feed_/.test(b.name)) continue;
      o[b.name] = b.entries.map(e => { const d = e.details || []; const len = d.length > 1 ? (d[1] & 0xFF) : 0; const enc = d.length > 1 ? ((d[1] >>> 8) & 0xFF) : 0; return { sid: e.steamID, itemId: d[3] | 0, up: d[5] | 0, text: len ? fb.unpackText(d, 7, len, enc) : '' }; });
    }
    return o;
  };
  const sidsOn = (f) => [...new Set(Object.values(f).flat().map(e => e.sid))];
  const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} };
  return { setBox, setVotes, run, feed, sidsOn, cleanup };
}

console.log('=== feedback-item-owner [3] main(): a colliding row from another account never takes an item over ===');
{
  const h = harness('cross');
  try {
    const [A, tA, XA, tXA] = PAIR_A, [B, tB, XB, tXB] = PAIR_B;
    const idA = idOf(A, tA), idB = idOf(B, tB), tC = NM1 - 30, idC = idOf(C_SID, tC);
    const rowA = [A, 'a', boxWords(A, 'the hook line is hidden behind the cart', 0, tA)];
    const rowC = [C_SID, 'c', boxWords(C_SID, 'an older post that stays off the boards', 0, tC)];
    const rowB = [B, 'b', boxWords(B, BAD + ' add me for trades', 1, tB)];
    const rowXA = [XA, 'xa', boxWords(XA, 'words of the other account', 0, tXA)];
    const rowXB = [XB, 'xb', boxWords(XB, 'more words of the other account', 1, tXB)];
    const BUG = [fb.feedBoardName(0, 'hot'), fb.feedBoardName(0, 'new')], IDEA = [fb.feedBoardName(1, 'hot'), fb.feedBoardName(1, 'new')];

    h.setBox([rowA, rowC, rowB]);
    const r1 = h.run(DAY1 + 1 * MIN);
    ok('run 1: main() exits 0', r1.code === 0, r1.code + ' ' + r1.out.slice(0, 300));
    ok('run 1: A and C admitted live, B filtered', (r1.items[idA] || {}).st === 'live' && (r1.items[idC] || {}).st === 'live' && (r1.items[idB] || {}).st === 'filtered',
      JSON.stringify([r1.items[idA], r1.items[idC], r1.items[idB]].map(x => x && x.st)));
    let f = h.feed();
    ok('run 1: the bug boards show A\'s post under A (feed cap 1, C stays off)', BUG.every(b => f[b].length === 1 && f[b][0].sid === A && f[b][0].itemId === idA), JSON.stringify(BUG.map(b => f[b])));

    // run 2: the other accounts' rows appear after the authors' rows; an admin releases B; a voter upvotes A
    h.setBox([rowA, rowC, rowB, rowXA, rowXB]);
    h.setVotes([[VOTER, [fb.FB_VOTE_MAGIC | 0, ((1 << 24) | (1 << 16)) | 0, idA, (((NM1 + 2) << 2) | 1) | 0]]]);
    const r2 = h.run(DAY1 + 6 * MIN, { block: [], allow: [idB], clear: {} });
    ok('run 2: main() exits 0', r2.code === 0, r2.code + ' ' + r2.out.slice(0, 300));
    f = h.feed();
    ok('run 2: A\'s post still under A on the bug boards, with the upvote', BUG.every(b => f[b].length === 1 && f[b][0].sid === A && f[b][0].itemId === idA && f[b][0].up === 1), JSON.stringify(BUG.map(b => f[b])));
    ok('run 2: B\'s released post shows under B on the idea boards', IDEA.every(b => f[b].length === 1 && f[b][0].sid === B && f[b][0].itemId === idB), JSON.stringify(IDEA.map(b => f[b])));
    ok('run 2: nothing on any board under the other accounts', !h.sidsOn(f).includes(XA) && !h.sidsOn(f).includes(XB), JSON.stringify(h.sidsOn(f)));
    ok('run 2: items keep their authors and texts', r2.items[idA].ap === v.pid(A) && r2.items[idB].ap === v.pid(B) && /hook line/.test(r2.items[idA].text) && r2.items[idB].st === 'live');
    ok('run 2: C (off the boards, found only through its own box row) stays live', (r2.items[idC] || {}).st === 'live');
    ok('run 2: the other accounts\' words are nowhere in the state', !JSON.stringify(r2.st).includes('other account'));
    ok('run 2: the log counts the two skipped rows and warns', /foreignRows=2\b/.test(r2.out) && /::warning::.*skipped 2 box row/.test(r2.out), r2.out.slice(-400));
    ok('run 2: the warning carries no steamID', !/76561\d{12}/.test(r2.out));

    // run 3: same rows, the other accounts' rows first (the board order is up to the writer's score)
    h.setBox([rowXA, rowXB, rowA, rowC, rowB]);
    const r3 = h.run(DAY1 + 11 * MIN, { block: [], allow: [idB], clear: {} });
    f = h.feed();
    ok('run 3 (rows reordered): A under A, B under B, nothing under the others', r3.code === 0 && BUG.every(b => f[b][0] && f[b][0].sid === A) && IDEA.every(b => f[b][0] && f[b][0].sid === B) &&
      !h.sidsOn(f).includes(XA) && !h.sidsOn(f).includes(XB), JSON.stringify(f));
    ok('run 3: the log counts the two skipped rows again', /foreignRows=2\b/.test(r3.out));

    // run 4 + 5: A posts again (A's box row moves on) and the voter takes the upvote back, so A's first post
    // drops off the boards; from then on nothing of A's points at it, only the other account's row does
    const tA2 = NM1 + 14, idA2 = idOf(A, tA2);
    const rowA2 = [A, 'a2', boxWords(A, 'a second post by the same author', 0, tA2)];
    h.setBox([rowA2, rowC, rowB, rowXA, rowXB]);
    h.setVotes([[VOTER, [fb.FB_VOTE_MAGIC | 0, ((1 << 24) | (1 << 16)) | 0, idA, ((NM1 + 15) << 2) | 0]]]);
    const r4 = h.run(DAY1 + 16 * MIN, { block: [], allow: [idB], clear: {} });
    f = h.feed();
    ok('run 4: A\'s new post admitted for A and shown under A on both bug boards', r4.code === 0 && (r4.items[idA2] || {}).ap === v.pid(A) &&
      BUG.every(b => f[b].length === 1 && f[b][0].sid === A && f[b][0].itemId === idA2), JSON.stringify(BUG.map(b => f[b])));
    ok('run 4: nothing under the other account', !h.sidsOn(f).includes(XA));
    const r5 = h.run(DAY1 + 21 * MIN, { block: [], allow: [idB], clear: {} });
    f = h.feed();
    ok('run 5: A\'s first post (off the boards, A\'s row moved on) is archived, not kept alive by the other account\'s row',
      r5.code === 0 && (r5.items[idA] || {}).st === 'archived' && !h.sidsOn(f).includes(XA), (r5.items[idA] || {}).st + ' ' + JSON.stringify(h.sidsOn(f)));
    ok('run 5: both colliding rows are still skipped', /foreignRows=2\b/.test(r5.out), r5.out.slice(-300));
  } finally { h.cleanup(); }
}

console.log('=== feedback-item-owner [4] main(): two new rows with one id in the same run ===');
{
  const h = harness('same');
  try {
    const [V, tV, Y, tY] = PAIR_V, idV = idOf(V, tV);
    h.setBox([[V, 'v', boxWords(V, 'the honest new post', 0, tV)], [Y, 'y', boxWords(Y, 'the colliding new post', 0, tY)]]);
    const r = h.run(DAY1 + 1 * MIN);
    const f = h.feed(), BUG = [fb.feedBoardName(0, 'hot'), fb.feedBoardName(0, 'new')];
    ok('main() exits 0', r.code === 0, r.code + ' ' + r.out.slice(0, 300));
    ok('the first row admits the item: its author and its text', (r.items[idV] || {}).ap === v.pid(V) && /honest new post/.test((r.items[idV] || {}).text || ''));
    ok('the item is shown under its author, nothing under the second account', BUG.every(b => f[b].length === 1 && f[b][0].sid === V && f[b][0].itemId === idV), JSON.stringify(BUG.map(b => f[b])));
    ok('the second row is counted as skipped', /foreignRows=1\b/.test(r.out), r.out.slice(-300));
  } finally { h.cleanup(); }
}

console.log(failN ? ('feedback-item-owner: ' + failN + ' FAIL of ' + n) : ('feedback-item-owner: all ' + n + ' passed'));
process.exit(failN ? 1 : 0);
