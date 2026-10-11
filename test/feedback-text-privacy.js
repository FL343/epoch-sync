'use strict';
// Feedback text that never was and never may be shown stays out of the committed state (audit Q189, 2026-10-11).
// feedback*.json is committed to this PUBLIC repository by the feedback workflow and git history keeps every version
// forever. The pipeline used to store the sanitized body of EVERY admitted item there -- including the ones the content
// filter refused (ads, contact numbers, wordlist hits: the text most likely to carry a phone number or an insult), the
// ones over the daily cap (never shown) and the ones the admin blocked (permanent removal). Now only live / archived /
// held items keep text (it is on the feed boards anyway; held needs it to come back after a clearance); the others keep
// a keyed fingerprint and the text is read back from the author's live box row when needed. Pinned end-to-end over the
// REAL feedback.js main() against an offline board stub; every file the run leaves in its working dir and its whole
// log are scanned:
//   [1]  admission: live keeps text; ad-filtered / wordlist-filtered / capped keep a fingerprint only
//   [2]  next day's digest: rows still on the box -> the private mail carries every text, the file none
//   [3]  digest after the author replaced the row: placeholder + count in the mail, still nothing in the file
//   [4]  admin 'allow' with the row still there: released to the feed with its text (public now, by decision)
//   [5]  'allow' after the row is gone: archived without text, nothing posted, a rerun changes nothing
//   [6]  row rewritten under the same item id (same minute): fingerprint mismatch -> the new text is never posted
//   [7]  block strips the text; unblock with the row there restores it; unblock without it archives (stable)
//   [8]  legacy state holding a filtered item's text: rewritten without it on the first run
//   [9]  report hold keeps the text (it was public) and a clearance restores the item from its tombstone even after the
//        author replaced the box row -- the honest-player path architecture decision 10 protects
//   [10] helpers: keyed fingerprint, publicState is a copy, the kept-status list, hydrate checks the fingerprint
//   [11] admin console: text read back from the box (fingerprint-checked), placeholder when replaced / no secrets,
//        terminal text-free
//   [12] source pins
const { spawnSync, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
for (const k of ['FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_DIGEST_TAG', 'FB_LB', 'FB_VOTE_LB', 'FB_FEED_PREFIX', 'FB_STATE_FILE',
  'FB_MOD_FILE', 'FB_WORDLIST_FILE', 'FB_DAILY_CAP', 'FB_REPORT_HOLD', 'FB_FEED_CAP', 'FB_WRITE_CAP', 'LB_PREFIX', 'GITHUB_STEP_SUMMARY']) delete process.env[k];
process.env.STATE_SALT = 's';
const fb = require(path.join(__dirname, '..', 'feedback.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

const FEEDBACK = path.join(__dirname, '..', 'feedback.js');
const ADMIN = path.join(__dirname, '..', 'tools', 'feedback-admin.js');
const SRC = fs.readFileSync(FEEDBACK, 'utf8');

// stateless board stub + pinned clock (FAKE_NOW); every POST is logged; the mail endpoint answers 200
const STUB = [
  "const fs = require('fs');",
  'const FAKE = Number(process.env.FAKE_NOW || 0);',
  'if (FAKE) { const RealDate = Date; class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } } global.Date = FakeDate; }',
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t, json: async () => o }; };',
  'const realFetch = global.fetch;',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  '  if (/^http:\\/\\/127\\.0\\.0\\.1/.test(u)) return realFetch(url, init);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  "    if (/api\\.resend\\.com/.test(u)) return resp({ id: 'm' });",
  '    if (/FindOrCreateLeaderboard/.test(u)) return resp({ result: { result: 2 } });',
  '    return resp({ result: { result: 1 } });',
  '  }',
  "  fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, get: 1 }) + '\\n');",
  "  if (!/[?&]key=k(&|$)/.test(u)) return resp({}, 403);",
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    const ents = (b && !(rs && Number(rs[1]) > 1)) ? b.entries : [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');

// client box writer mirror (same layout as test/feedback-settle.js makeBoxWords)
function boxWords(sid, text, cat, lang, ts) {
  const u8 = fb.packText(text, 0), u16 = fb.packText(text, 1);
  const pick = u16.len < u8.len ? { enc: 1, p: u16 } : { enc: 0, p: u8 };
  const w1 = ((1 & 0xFF) << 24) | ((cat & 0xFF) << 16) | ((pick.enc & 0xFF) << 8) | (pick.p.len & 0xFF);
  return [fb.FB_MAGIC | 0, w1 | 0, fb.packLang(lang), fb.fnv1a32(String(sid) + ':' + ts) | 0, ts | 0].concat(pick.p.words);
}
const idOf = (sid, ts) => String(fb.fnv1a32(String(sid) + ':' + ts));

const DAY1 = Date.UTC(2026, 10, 20, 9, 0), DAY2 = DAY1 + 24 * 3600000;
const tsOf = (ms) => Math.floor((ms - fb.FB_EPOCH0) / 60000);
const A1 = '76561198000000201', A2 = '76561198000000202', A3 = '76561198000000203', A4 = '76561198000000204';
const HONEST = 'the minecart level hides the hook line';
const AD = 'add me on qq 1234567890 cheap gold, Привет';   // ad filter (contact word + number) + Cyrillic (escaped in the file)
const WL = 'this zqxbadword is rude';                                                       // wordlist hit
const CAP = 'fourth note today about the shop prices';                                     // over the daily cap
const NEW2 = 'second post from the same author is fine';
const TAMPER = 'swapped body after review 4242';
const T1 = tsOf(DAY1) - 30, T2 = tsOf(DAY1) - 20, T3 = tsOf(DAY1) - 10, T4 = tsOf(DAY1) - 5, T2B = tsOf(DAY2) - 60;
const ID1 = idOf(A1, T1), ID2 = idOf(A2, T2), ID3 = idOf(A3, T3), ID4 = idOf(A4, T4);
const BOX = 200, VOTE = 201;
const FEED = {}; let fid = 300;
for (let c = 0; c < fb.FB_CATS.length; c++) for (const s of ['hot', 'new']) FEED[fb.feedBoardName(c, s)] = fid++;
const SALT = 's';
const WORDLIST = { sub: [{ l: Array.from('zqxbadword').length, h: fb.wlHash(SALT, 'zqxbadword') }], word: [] };
const ROWS = { A1: { sid: A1, text: HONEST, cat: 0, ts: T1 }, A2: { sid: A2, text: AD, cat: 1, ts: T2 }, A3: { sid: A3, text: CAP, cat: 2, ts: T3 }, A4: { sid: A4, text: WL, cat: 3, ts: T4 } };
// A3 already has three items today -> its fourth is capped (seeded as earlier runs would have left them)
function seedState() {
  const ap3 = v.pid(A3), items = {};
  for (let i = 0; i < 3; i++) items[String(900 + i)] = { ap: ap3, cat: 2, lang: 'en', ts: T3 - 100 - i, text: 'earlier note ' + i, st: 'archived' };
  return { boards: {}, items, votes: {}, digest: { day: '', at: 0 } };
}
function world(rows, opts) {
  opts = opts || {};
  const boards = [{ id: BOX, name: 'feedback_box', entries: rows.map(r => ({ steamID: r.sid, score: r.ts, details: boxWords(r.sid, r.text, r.cat, 'en', r.ts) })) },
    { id: VOTE, name: 'feedback_vote', entries: opts.votes || [] }];
  for (const name of Object.keys(FEED)) boards.push({ id: FEED[name], name, entries: (opts.feed && opts.feed[name]) || [] });
  return boards;
}
const MAIL = { FB_DIGEST_TO: 'owner@example.invalid', RESEND_API_KEY: 'mail-key' };

function stubDir(boards) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-privacy-'));
  fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
  fs.writeFileSync(path.join(dir, 'fx.json'), JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
  fs.writeFileSync(path.join(dir, 'post.log'), '');
  fs.mkdirSync(path.join(dir, 'state'));
  return dir;
}
function readPosts(dir) { return fs.readFileSync(path.join(dir, 'post.log'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
// one real feedback.js run; files = { state, mod } (null = absent); returns everything the run left behind
function run(boards, files, env, nowMs) {
  const dir = stubDir(boards);
  try {
    const sd = path.join(dir, 'state');
    const f = { FB_STATE_FILE: path.join(sd, 'feedback.json'), FB_MOD_FILE: path.join(sd, 'feedback-mod.json'), FB_WORDLIST_FILE: path.join(sd, 'feedback-wordlist.json') };
    fs.writeFileSync(f.FB_WORDLIST_FILE, JSON.stringify(WORDLIST));
    if (files.state) fs.writeFileSync(f.FB_STATE_FILE, typeof files.state === 'string' ? files.state : JSON.stringify(files.state));
    if (files.mod) fs.writeFileSync(f.FB_MOD_FILE, JSON.stringify(files.mod));
    const base = Object.assign({}, process.env);
    for (const k of Object.keys(base)) if (/^FB_|^RESEND_/.test(k)) delete base[k];
    const e = Object.assign(base, { STEAM_PUBLISHER_KEY: 'k', APPID: '1', STATE_SALT: SALT, FAKE_NOW: String(nowMs || DAY1),
      STUB_FIXTURE: path.join(dir, 'fx.json'), STUB_LOG: path.join(dir, 'post.log') }, f, env || {});
    const before = files.state ? fs.readFileSync(f.FB_STATE_FILE, 'utf8') : null;
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), FEEDBACK], { env: e, encoding: 'utf8', cwd: sd, timeout: 60000 });
    const written = {};
    for (const n of fs.readdirSync(sd)) written[n] = fs.readFileSync(path.join(sd, n), 'utf8');
    let state = null; try { state = JSON.parse(written['feedback.json']); } catch (err) {}
    const posts = readPosts(dir).filter(p => !p.get);
    const mails = posts.filter(p => /api\.resend\.com/.test(p.url)).map(p => JSON.parse(p.body));
    // feed writes: decode the details bytes back to the body text
    const feedWrites = posts.filter(p => /SetLeaderboardScore/.test(p.url)).map(p => {
      const q = new URLSearchParams(p.body.replace(/&details=.*$/, ''));
      const m = /&details=(.*)$/.exec(p.body);
      const bytes = m ? Buffer.from(m[1].split('%').filter(Boolean).map(h => parseInt(h, 16))) : Buffer.alloc(0);
      const w = []; for (let i = 0; i + 4 <= bytes.length; i += 4) w.push(bytes.readInt32LE(i));
      const len = w.length > 1 ? (w[1] & 0xFF) : 0, enc = w.length > 1 ? ((w[1] >>> 8) & 0xFF) : 0;
      return { sid: q.get('steamid'), board: q.get('leaderboardid'), itemId: w.length > 3 ? String(w[3]) : '', body: len ? fb.unpackText(w, 7, len, enc) : '' };
    });
    const deletes = posts.filter(p => /DeleteLeaderboardScore/.test(p.url)).map(p => new URLSearchParams(p.body).get('steamid'));
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), written, state, before, posts, mails, feedWrites, deletes };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// the tripwire: none of `secrets` in any written file (raw, or after JSON decoding -- the state file escapes non-ASCII)
// nor in the log
function leaks(r, secrets) {
  const hits = [];
  if (r.code !== 0) hits.push('run exit ' + r.code + ' (a failed run proves nothing): ' + r.out.slice(-300));
  for (const n of Object.keys(r.written)) {
    const raw = r.written[n];
    let dec = raw; try { dec = JSON.stringify(JSON.parse(raw)); } catch (err) {}
    for (const s of secrets) if (raw.includes(s) || dec.includes(s) || dec.includes(JSON.stringify(s).slice(1, -1))) hits.push(n + ': ' + s.slice(0, 24));
  }
  for (const s of secrets) if (r.out.includes(s)) hits.push('log: ' + s.slice(0, 24));
  return hits;
}
const allTexts = [HONEST, AD, WL, CAP, NEW2, TAMPER];
const row = (k, over) => Object.assign({}, ROWS[k], over || {});
const textless = (it) => it && it.text === undefined && /^[0-9a-f]{16}$/.test(String(it.th || ''));

// [1] admission
const r1 = run(world([row('A1'), row('A2'), row('A3'), row('A4')]), { state: seedState() });
const s1 = r1.state || { items: {} };
{
  T('[1] run ok', r1.code === 0, r1.out.slice(-300));
  T('[1] statuses: live / filtered (ad) / capped / filtered (wordlist)',
    (s1.items[ID1] || {}).st === 'live' && (s1.items[ID2] || {}).st === 'filtered' && (s1.items[ID3] || {}).st === 'capped' && (s1.items[ID4] || {}).st === 'filtered',
    JSON.stringify([ID1, ID2, ID3, ID4].map(k => (s1.items[k] || {}).st)));
  T('[1] live item keeps its text (it is on the feed)', (s1.items[ID1] || {}).text === HONEST);
  T('[1] archived items keep their text (they were shown)', (s1.items['900'] || {}).text === 'earlier note 0' && (s1.items['902'] || {}).text === 'earlier note 2');
  T('[1] filtered / capped items keep a fingerprint, no text', textless(s1.items[ID2]) && textless(s1.items[ID3]) && textless(s1.items[ID4]),
    JSON.stringify([s1.items[ID2], s1.items[ID3]]));
  const h = leaks(r1, [AD, WL, CAP]);
  T('[1] no refused text in any written file or the log', !h.length, h.join(' | '));
  T('[1] log carries no player text at all', !allTexts.some(t => r1.out.includes(t)));
  T('[1] only the live item reaches the feed (hot + new)', r1.feedWrites.length === 2 && r1.feedWrites.every(w => w.sid === A1 && w.body === HONEST),
    JSON.stringify(r1.feedWrites));
}

// [2] next day's digest, rows still on the box
const r2 = run(world([row('A1'), row('A2'), row('A3'), row('A4')]), { state: s1 }, MAIL, DAY2);
{
  const m = r2.mails[0] || { text: '' };
  T('[2] one digest mail sent', r2.mails.length === 1, String(r2.mails.length));
  T('[2] mail carries every admitted text (read back from the box)', [HONEST, AD, WL, CAP].every(t => m.text.includes(t)));
  T('[2] mail has no "no longer readable" line', !/no longer readable/.test(m.text));
  const h = leaks(r2, [AD, WL, CAP]);
  T('[2] files and log still clean', !h.length, h.join(' | '));
  T('[2] digest watermark advanced', r2.state && r2.state.digest && r2.state.digest.day === new Date(DAY2).toISOString().slice(0, 10));
}

// [3] digest after A2 replaced its row
const r3 = run(world([row('A1'), { sid: A2, text: NEW2, cat: 1, ts: T2B }, row('A3'), row('A4')]), { state: s1 }, MAIL, DAY2);
{
  const m = r3.mails[0] || { text: '' };
  T('[3] mail: placeholder for the replaced row + count', m.text.includes(fb.FB_DIGEST_GONE) && /no longer readable[^\n]*: 1\n/.test(m.text), m.text.slice(0, 300));
  T('[3] mail: the replacement post and the other rows still come through', [NEW2, WL, CAP, HONEST].every(t => m.text.includes(t)));
  const h = leaks(r3, [AD, WL, CAP]);
  T('[3] files and log clean', !h.length, h.join(' | '));
  T('[3] the old item keeps its fingerprint, status unchanged', textless(r3.state.items[ID2]) && r3.state.items[ID2].st === 'filtered');
}

// [4] allow with the row still there
const r4 = run(world([row('A1'), row('A2'), row('A3'), row('A4')]), { state: s1, mod: { block: [], allow: [Number(ID2)], clear: {} } }, {}, DAY1 + 600000);
{
  const it = (r4.state || { items: {} }).items[ID2] || {};
  T('[4] allowed item live with its text', it.st === 'live' && it.text === AD, JSON.stringify(it));
  T('[4] posted to its feed boards with the reviewed text', r4.feedWrites.filter(w => w.sid === A2 && w.body === AD).length === 2, JSON.stringify(r4.feedWrites));
  const h = leaks(r4, [WL, CAP]);
  T('[4] the other refused texts stay out', !h.length, h.join(' | '));
}

// [5] allow after the row is gone
const box5 = [row('A1'), { sid: A2, text: NEW2, cat: 1, ts: T2B }, row('A3'), row('A4')];
const r5 = run(world(box5), { state: s1, mod: { block: [], allow: [Number(ID2)], clear: {} } }, {}, DAY2);
{
  const it = (r5.state || { items: {} }).items[ID2] || {};
  T('[5] released item without readable text -> archived, fingerprint kept', it.st === 'archived' && textless(it), JSON.stringify(it));
  T('[5] nothing posted for it (no empty / "undefined" body)', !r5.feedWrites.some(w => w.itemId === ID2 || /undefined/.test(w.body)), JSON.stringify(r5.feedWrites));
  const r5b = run(world(box5), { state: r5.written['feedback.json'], mod: { block: [], allow: [Number(ID2)], clear: {} } }, {}, DAY2 + 300000);
  T('[5] rerun is stable (no state change, same bytes)', /no state change/.test(r5b.out) && r5b.written['feedback.json'] === r5.written['feedback.json'], r5b.out.slice(-200));
  const h = leaks(r5, [AD, WL, CAP]);
  T('[5] files and log clean', !h.length, h.join(' | '));
}

// [6] row rewritten under the same item id (same minute, new body)
const r6 = run(world([row('A1'), row('A2', { text: TAMPER }), row('A3'), row('A4')]), { state: s1, mod: { block: [], allow: [Number(ID2)], clear: {} } }, {}, DAY1 + 600000);
{
  T('[6] rewritten body never posted (the item stays off the feed)', !r6.feedWrites.some(w => w.body === TAMPER || w.sid === A2), JSON.stringify(r6.feedWrites));
  T('[6] item archived, fingerprint kept', (r6.state.items[ID2] || {}).st === 'archived' && textless(r6.state.items[ID2]));
  const h = leaks(r6, [TAMPER, AD]);
  T('[6] files and log clean', !h.length, h.join(' | '));
}

// [7] block / unblock (A1 is live and on its two feed boards)
const feedA1 = {};
for (const s of ['hot', 'new']) feedA1[fb.feedBoardName(0, s)] = [{ steamID: A1, score: 1, details: fb.packFeedDetails({ text: HONEST, cat: 0, lang: 'en', ts: T1, itemId: Number(ID1) }, 0, 0) }];
const r7 = run(world([row('A1'), row('A2'), row('A3'), row('A4')], { feed: feedA1 }), { state: s1, mod: { block: [Number(ID1)], allow: [], clear: {} } }, {}, DAY1 + 600000);
{
  const it = (r7.state || { items: {} }).items[ID1] || {};
  T('[7] blocked item: fingerprint only', it.st === 'blocked' && textless(it), JSON.stringify(it));
  T('[7] its feed entries deleted', r7.deletes.filter(s => s === A1).length === 2, JSON.stringify(r7.deletes));
  T('[7] block keeps HONEST out of the files', !leaks(r7, [HONEST, AD, WL, CAP]).length, leaks(r7, [HONEST, AD, WL, CAP]).join(' | '));
  const r7b = run(world([row('A1'), row('A2'), row('A3'), row('A4')]), { state: r7.written['feedback.json'], mod: { block: [], allow: [], clear: {} } }, {}, DAY1 + 900000);
  const it2 = (r7b.state || { items: {} }).items[ID1] || {};
  T('[7] unblock with the row there: live, text back, re-posted', it2.st === 'live' && it2.text === HONEST && r7b.feedWrites.filter(w => w.sid === A1 && w.body === HONEST).length === 2,
    JSON.stringify(it2));
  const box7c = [{ sid: A1, text: NEW2, cat: 0, ts: T2B }, row('A2'), row('A3'), row('A4')];
  const r7c = run(world(box7c), { state: r7.written['feedback.json'], mod: { block: [], allow: [], clear: {} } }, {}, DAY2);
  const it3 = (r7c.state || { items: {} }).items[ID1] || {};
  T('[7] unblock without the row: archived, no text, not posted', it3.st === 'archived' && textless(it3) && !r7c.feedWrites.some(w => w.itemId === ID1), JSON.stringify(it3));
  const r7d = run(world(box7c), { state: r7c.written['feedback.json'], mod: { block: [], allow: [], clear: {} } }, {}, DAY2 + 300000);
  T('[7] ... and stays put on the next run', /no state change/.test(r7d.out), r7d.out.slice(-200));
}

// [8] legacy state (before Q189) holding a filtered item's text
{
  const legacy = JSON.parse(JSON.stringify(s1));
  legacy.items[ID2] = { ap: v.pid(A2), cat: 1, lang: 'en', ts: T2, text: AD, st: 'filtered' };
  legacy.items[ID4] = { ap: v.pid(A4), cat: 3, lang: 'en', ts: T4, text: WL, st: 'filtered' };
  // the same world as [1]'s second tick: nothing else changes, so only the scrub makes the run write
  const r8 = run(world([row('A1'), row('A2'), row('A3'), row('A4')], { feed: (() => { const f = {}; for (const s of ['hot', 'new']) f[fb.feedBoardName(0, s)] = [{ steamID: A1, score: s === 'new' ? T1 : fb.hotScoreOf(0, 0, T1, DAY1 + 300000), details: fb.packFeedDetails({ text: HONEST, cat: 0, lang: 'en', ts: T1, itemId: Number(ID1) }, 0, 0) }]; return f; })() }),
    { state: legacy }, {}, DAY1 + 300000);
  T('[8] legacy text scrubbed on the first run (state saved)', /state saved/.test(r8.out) && textless(r8.state.items[ID2]) && textless(r8.state.items[ID4]), r8.out.slice(-200));
  T('[8] fingerprint matches the old text (a later allow can still read the row back)', typeof fb.textSig === 'function' && r8.state.items[ID2].th === fb.textSig(ID2, AD, SALT));
  const h = leaks(r8, [AD, WL, CAP]);
  T('[8] files and log clean', !h.length, h.join(' | '));
  T('[8] live text kept', r8.state.items[ID1].text === HONEST);
}

// [9] report hold keeps the text; clearance restores from the tombstone after the row moved on
{
  const votes = [];
  for (let i = 0; i < fb.FB_REPORT_HOLD; i++) votes.push({ steamID: '7656119800000' + String(3000 + i), score: 1, details: [fb.FB_VOTE_MAGIC | 0, ((1 << 24) | (1 << 16)) | 0, Number(ID1), ((tsOf(DAY1) << 2) | 3) | 0] });
  const r9 = run(world([row('A1'), row('A2'), row('A3'), row('A4')], { votes, feed: feedA1 }), { state: s1 }, {}, DAY1 + 600000);
  const it = (r9.state || { items: {} }).items[ID1] || {};
  T('[9] reported item held, text kept (it was public; the clearance needs it)', it.st === 'held' && it.text === HONEST, JSON.stringify(it));
  const tomb = {};
  for (const s of ['hot', 'new']) tomb[fb.feedBoardName(0, s)] = [{ steamID: A1, score: fb.FB_TOMB_SCORE, details: fb.tombstoneDetails({ cat: 0, lang: 'en', ts: T1 }, Number(ID1)) }];
  // the author's newer post sits in another category (same-category posts compete for the author's one slot -- the bounded
  // caveat at tombstoneDetails, unchanged here)
  const r9b = run(world([{ sid: A1, text: NEW2, cat: 1, ts: T2B }, row('A2'), row('A3'), row('A4')], { votes, feed: tomb }),
    { state: r9.written['feedback.json'], mod: { block: [], allow: [], clear: { [ID1]: tsOf(DAY2) } } }, {}, DAY2 + 60000);
  const it2 = (r9b.state || { items: {} }).items[ID1] || {};
  T('[9] clearance restores the item from its tombstone with its text', it2.st === 'live' && r9b.feedWrites.some(w => w.itemId === ID1 && w.body === HONEST), JSON.stringify(it2) + ' ' + JSON.stringify(r9b.feedWrites));
  T('[9] refused texts still out', !leaks(r9b, [AD, WL, CAP]).length);
}

// [10] helpers
try {
  T('[10] kept-status list is exactly live / archived / held', JSON.stringify(fb.FB_TEXT_PUBLIC) === JSON.stringify(['live', 'archived', 'held']) && Object.isFrozen(fb.FB_TEXT_PUBLIC));
  T('[10] fingerprint is keyed (salt) and bound to the item id', fb.textSig('1', 'x', 'a') !== fb.textSig('1', 'x', 'b') && fb.textSig('1', 'x', 'a') !== fb.textSig('2', 'x', 'a') && /^[0-9a-f]{16}$/.test(fb.textSig('1', 'x', 'a')));
  T('[10] fingerprint covers the text', fb.textSig('1', 'x', 'a') !== fb.textSig('1', 'y', 'a'));
  const st = { boards: { b: 1 }, items: { 7: { st: 'filtered', text: 'keep me private', ap: 'p', pd: 1 }, 8: { st: 'live', text: 'shown' } }, votes: {}, digest: { day: '', at: 0 } };
  const pub = fb.publicState(st);
  T('[10] publicState strips the text, keeps the other fields, adds the fingerprint', pub.items[7].text === undefined && pub.items[7].pd === 1 && pub.items[7].ap === 'p' && pub.items[7].th === fb.textSig('7', 'keep me private'));
  T('[10] publicState leaves the live copy and the run state alone', pub.items[8].text === 'shown' && st.items[7].text === 'keep me private' && pub.boards === st.boards);
  const items = { 7: { st: 'blocked', th: fb.textSig('7', 'orig') }, 9: { st: 'filtered', th: fb.textSig('9', 'other') } };
  const miss = fb.hydrateText(items, { 7: 'orig', 9: 'changed' });
  T('[10] hydrate: matching text restored, mismatching refused', items[7].text === 'orig' && items[9].text === undefined && miss === 1);
  T('[10] needsTextScrub sees legacy text only on non-kept statuses', fb.needsTextScrub({ items: { 1: { st: 'capped', text: 'x' } } }) && !fb.needsTextScrub({ items: { 1: { st: 'held', text: 'x' }, 2: { st: 'capped', th: 'aa' } } }));
} catch (e) { T('[10] helpers present', false, String(e && e.message)); }

// [11] admin console (local page): box read-back
async function adminData(statePath, env, boards, secrets) {
  const dir = stubDir(boards);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const home = path.join(dir, 'home'); fs.mkdirSync(home);
  if (secrets) { fs.mkdirSync(path.join(home, 'gmt-secrets')); for (const f of Object.keys(secrets)) fs.writeFileSync(path.join(home, 'gmt-secrets', f), secrets[f] + '\n'); }
  const base = Object.assign({}, process.env);
  for (const k of Object.keys(base)) if (/^FB_|^RESEND_|^STEAM_|^APPID$|^STATE_SALT$/.test(k)) delete base[k];
  const e = Object.assign(base, { HOME: home, USERPROFILE: home, PORT: String(port), FB_STATE_FILE: statePath, FB_MOD_FILE: path.join(dir, 'mod.json'),
    STUB_FIXTURE: path.join(dir, 'fx.json'), STUB_LOG: path.join(dir, 'post.log'), FAKE_NOW: String(DAY1 + 600000) }, env);
  const child = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), ADMIN, '--no-pull'], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  try {
    for (let i = 0; i < 100 && !/feedback-admin: http/.test(out); i++) await new Promise(r => setTimeout(r, 50));
    const j = await (await fetch('http://127.0.0.1:' + port + '/data')).json();
    const page = await (await fetch('http://127.0.0.1:' + port + '/')).text();
    const by = {}; for (const it of j.items) by[it.id] = it;
    return { by, out, page, gets: readPosts(dir).filter(p => p.get) };
  } finally { child.kill(); await new Promise(r => setTimeout(r, 50)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-admin-'));
  try {
    const sp = path.join(tmp, 'feedback.json');
    const st = JSON.parse(r1.written['feedback.json']); st.boards = Object.assign({}, st.boards, { feedback_box: BOX });
    fs.writeFileSync(sp, JSON.stringify(st));
    const keys = { STEAM_PUBLISHER_KEY: 'k', APPID: '1', STATE_SALT: SALT };
    const a = await adminData(sp, keys, world([row('A1'), row('A2'), row('A3', { text: TAMPER }), row('A4')]));
    T('[11] console reads refused text back from the box', (a.by[ID2] || {}).text === AD && (a.by[ID4] || {}).text === WL, JSON.stringify(a.by[ID2]));
    T('[11] a rewritten row is not shown as the reviewed text', (a.by[ID3] || {}).text === null && (a.by[ID3] || {}).gone === 'replaced', JSON.stringify(a.by[ID3]));
    T('[11] the box read carries the key passed at call time', a.gets.some(g => /GetLeaderboardEntries/.test(g.url) && /leaderboardid=200\b/.test(g.url)));
    const b = await adminData(sp, keys, world([row('A1'), { sid: A2, text: NEW2, cat: 1, ts: T2B }, row('A3'), row('A4')]));
    T('[11] replaced row: placeholder reason', (b.by[ID2] || {}).text === null && (b.by[ID2] || {}).gone === 'replaced' && (b.by[ID3] || {}).text === CAP);
    const c = await adminData(sp, {}, world([row('A1'), row('A2'), row('A3'), row('A4')]));
    T('[11] no secrets: placeholder says so, no board read', (c.by[ID2] || {}).gone === 'nokey' && !c.gets.some(g => /GetLeaderboardEntries/.test(g.url)), JSON.stringify(c.by[ID2]));
    // the documented setup: secrets in ~/gmt-secrets, nothing in env (validate.js, loaded first, then holds no key)
    const d = await adminData(sp, {}, world([row('A1'), row('A2'), row('A3'), row('A4')]), { 'steam_publisher_key.txt': 'k', 'steam_appid.txt': '1', 'epoch_state_salt.txt': SALT });
    T('[11] secrets from ~/gmt-secrets: text read back, key sent at call time', (d.by[ID2] || {}).text === AD && d.gets.some(g => /GetLeaderboardEntries/.test(g.url) && /[?&]key=k&/.test(g.url)),
      JSON.stringify(d.by[ID2]) + ' ' + JSON.stringify(d.gets.map(g => g.url.slice(0, 120))));
    T('[11] terminal stays text-free', ![a, b, c, d].some(x => allTexts.some(t => x.out.includes(t))), a.out.slice(0, 200));
    // the page's card renderer: a textless item shows the reason, never "null" or a crash
    const m = /<script>([\s\S]*)<\/script>/.exec(a.page);
    const vm = require('vm');
    const sb = { document: { getElementById: () => ({}) }, fetch: () => new Promise(() => {}), confirm: () => false };
    vm.createContext(sb); vm.runInContext((m ? m[1] : '') + '\n;DATA = { holdAt: 15, items: [] }; this.__card = card;', sb);
    const html = (x) => sb.__card(Object.assign({ id: '1', cat: 'bug', lang: 'en', ageMin: 5, st: 'filtered', up: 0, down: 0, rep: 0, repAll: 0 }, x));
    const shown = html({ text: 'a <b> c', gone: '' }), rep = html({ text: null, gone: 'replaced' }), nok = html({ text: null, gone: 'nokey' }), er = html({ text: null, gone: 'err', goneMsg: 'HTTP 500' });
    T('[11] page card: text escaped when present', shown.includes('a &lt;b&gt; c'));
    T('[11] page card: placeholder per reason, no "null"', [rep, nok, er].every(h => /<i>/.test(h) && !/null/.test(h)) && rep !== nok && er.includes('HTTP 500'), rep.slice(0, 160));
  } catch (e) { T('[11] admin console run', false, String(e && e.stack || e)); }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) {} }

  // [12] source pins
  T('[12] saveState writes the public copy', /function saveState\(st\) \{ fs\.writeFileSync\(FB_STATE_FILE, asciiJson\(publicState\(st\)\)\); \}/.test(SRC));
  T('[12] legacy scrub marks the run dirty', SRC.includes('let dirty = needsTextScrub(st);'));
  T('[12] hydrate runs after governance, before placement', SRC.indexOf('hydrateText(st.items, textByItem)') > SRC.indexOf('governItems(st.items, st.votes, mod, nowMin)') &&
    SRC.indexOf('hydrateText(st.items, textByItem)') < SRC.indexOf('// ---- compute + write desired feed sets ----'));

  console.log('feedback-text-privacy: ' + (failN ? failN + ' FAIL' : 'ok'));
  process.exit(failN ? 1 : 0);
})();
