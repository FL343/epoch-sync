'use strict';
// Q209 (cloud audit 2026-10): the report state is committed to this PUBLIC repository every run, so its whole history is
// readable. Q190 keyed the three report lanes by their own keyed pseudonyms -- but one key per reporter, kept across all
// his reports (player report edges and the day's count under his reporter key, chat watermark / row digest / queued digest
// under it, every vote of a voter under his voter key). Anyone diffing two runs then saw the SAME key gain a report in
// both: once one of his reports was tied to him (a 1V1 opponent, a chat line only he had seen, a report on a post only he
// had read), every other one was his too, and lining the runs up with the match rosters settled in them named him.
// The property pinned here, over the REAL validate.js main() and feedback.js main() against an offline board stub (pinned
// clock): two runs, in each the same reporter files one player report, one chat report and one vote, about different
// targets / items. Nothing written or changed by the first run's reports may show up in what the second run's reports
// write or change: no 16-hex token in common. A key written in the same run as a match settles names the players of
// that match by its timing only (the commit), which no layout can remove -- that is not tested here.
//   [1] player reports (signals.json rep / rseen / day / players): run 1 and run 2 share no token
//   [2] chat reports (chat-mute.json, mail channel on: the digest queue too): run 1 and run 2 share no token
//   [3] votes (feedback state votes / vv / vt / vpre): run 1 and run 2 share no token
//   [4] the token maps are written in key order (in insertion order the tokens one run adds sit together, in harvest order)
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'CONSOLATION_XP', 'REPORT_LB', 'TRUST_LB', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY',
  'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY', 'FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_DIGEST_TAG', 'CHAT_MUTE_LB', 'CHAT_REPORT_LB',
  'PAGE_CAP', 'REPORT_DAILY_CAP', 'FB_LB', 'FB_VOTE_LB', 'FB_FEED_PREFIX', 'FB_STATE_FILE', 'FB_MOD_FILE', 'FB_WORDLIST_FILE', 'FB_DAILY_CAP', 'FB_REPORT_HOLD', 'FB_FEED_CAP', 'FB_WRITE_CAP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const cm = require(path.join(__dirname, '..', 'chat-mute.js'));
const fb = require(path.join(__dirname, '..', 'feedback.js'));
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

const VALIDATE = path.join(__dirname, '..', 'validate.js'), FEEDBACK = path.join(__dirname, '..', 'feedback.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub + pinned clock (as test/report-keys.js)
const STUB = [
  "const fs = require('fs');",
  'const FAKE = Number(process.env.FAKE_NOW || 0);',
  'if (FAKE) { const RealDate = Date; class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE); } static now() { return FAKE; } } global.Date = FakeDate; }',
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t, json: async () => o }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  "    if (/api\\.resend\\.com/.test(u)) return resp({ id: 'm' });",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries.slice() : [];',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (rs && Number(rs[1]) > 1) ents = [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
const fixture = (boards) => JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) });
function run(script, boards, stateFiles, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-unlinkable-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    fs.writeFileSync(path.join(dir, 'fx.json'), fixture(boards));
    fs.writeFileSync(path.join(dir, 'post.log'), '');
    const sd = path.join(dir, 'state'); fs.mkdirSync(sd);
    const fenv = {};
    for (const k of stateFiles) fenv[k] = path.join(sd, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (files[k] != null) fs.writeFileSync(fenv[k], files[k]);
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, { STEAM_PUBLISHER_KEY: 'k', APPID: '1', STATE_SALT: 's', STUB_FIXTURE: path.join(dir, 'fx.json'), STUB_LOG: path.join(dir, 'post.log') }, fenv, env || {});
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), script], { env: e, encoding: 'utf8', cwd: sd, timeout: 120000 });
    const text = {};
    for (const k of stateFiles) { try { text[k] = fs.readFileSync(fenv[k], 'utf8'); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), text };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const tail = (r) => r.out.slice(-600);

// ---- what a run wrote or changed, as 16-hex tokens ----
// For every leaf the run added or changed: the tokens in its key path and in its value; an array counts as a set (its new
// members). Tokens in entries the run left as they were are not counted.
const HEX = /[0-9a-f]{16}/g;
function atomsOf(x, out) { const t = typeof x === 'string' ? x : JSON.stringify(x); for (const m of (t || '').match(HEX) || []) out.add(m); }
function touched(b, a, keyPath, out) {
  if (a === undefined) return out;
  if (Array.isArray(a)) {
    const bs = new Set((Array.isArray(b) ? b : []).map(x => JSON.stringify(x)));
    for (const x of a) if (!bs.has(JSON.stringify(x))) { atomsOf(x, out); for (const k of keyPath) atomsOf(k, out); }
    return out;
  }
  if (a && typeof a === 'object') {
    for (const k of Object.keys(a)) touched(b && typeof b === 'object' && !Array.isArray(b) ? b[k] : undefined, a[k], keyPath.concat([k]), out);
    return out;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) { for (const k of keyPath) atomsOf(k, out); atomsOf(a, out); }
  return out;
}
const parse = (t) => { try { return JSON.parse(t); } catch (e) { return {}; } };
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
const inter = (a, b) => [...a].filter(x => b.has(x));
const sortedMap = (o) => !o || typeof o !== 'object' || Array.isArray(o) || JSON.stringify(Object.keys(o)) === JSON.stringify(Object.keys(o).slice().sort());

// ---- accounts, clock, boards ----
const R1 = '76561198000000501', T1 = '76561198000009501', T2 = '76561198000009502', OTHER = '76561198000000502';
const DAY1 = Date.UTC(2026, 10, 20, 9, 0), RUN2 = DAY1 + 2 * 3600000;
const tsOf = (ms) => Math.floor((ms - cm.CHAT_MUTE.EPOCH0) / 60000);
function packReports(list) {
  const det = [v.REPORT_MAGIC, (1 << 8) | list.length];
  for (const r of list) { const b = BigInt(r.t); det.push(Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, r.r | 0, r.m | 0); }
  return det;
}
function fnv(s) { let h = 0x811c9dc5 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; }
function packChat(text, targetSid, scope, tsMin) {
  const bytes = Buffer.from(text, 'utf8'), b = BigInt(targetSid);
  const w0 = ((cm.CHAT_MUTE.MAGIC & 0xFF) | ((cm.CHAT_MUTE.VER & 0xFF) << 8) | ((scope & 0xFF) << 16)) | 0;
  const words = [w0, bytes.length | 0, Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, tsMin | 0, fnv(text)];
  for (let i = 0; i < bytes.length; i++) { const wi = 6 + (i >> 2); if (words.length <= wi) words.push(0); words[wi] = (words[wi] | (bytes[i] << ((i & 3) * 8))) | 0; }
  return words;
}
const chatRow = (sid, text, target, ms) => ({ steamID: sid, score: tsOf(ms), details: packChat(text, target, 3, tsOf(ms)) });
function world(reports, chat) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  boards.push({ id: 40, name: 'report_box', entries: reports.map(r => ({ steamID: r.sid, score: 1, details: packReports(r.list) })) });
  boards.push({ id: 50, name: 'chat_report_box', entries: chat });
  boards.push({ id: 51, name: 'chat_mute', entries: [] });
  return boards;
}
const VENV = { LB_PREFIX: 'shard_', XP_LB: 'progress', RANKED_LB: 'rating', LP_LB: 'points', SEASON_NOW: '2026-11-20T00:00:00Z', APPLY_MMR: '1',
  CONCURRENCY: '1', STRICT_BOARDS: '0', LEDGER_SHARDS: '8', READ_RETRY_MS: '0', FB_DIGEST_TO: 'owner@example.invalid', RESEND_API_KEY: 'mail-key' };
const vrun = (boards, files, now) => run(VALIDATE, boards, FILE_VARS, files, Object.assign({ FAKE_NOW: String(now) }, VENV));

// the digest went out earlier today, so the queued rows stay in the state file across both runs
const CHAT0 = JSON.stringify({ seen: {}, sig: {}, rep: {}, auto: {}, digest: { day: '2026-11-20', at: Math.floor(DAY1 / 60000) - 60 } });
// the box keeps the reporter's rolling queue (player reports) and his LAST chat row (one row per reporter)
const W1 = world([{ sid: R1, list: [{ t: T1, r: 2, m: 7001 }] }, { sid: OTHER, list: [{ t: T1, r: 1, m: 7001 }] }],
  [chatRow(R1, 'first line reported', T1, DAY1 - 600000), chatRow(OTHER, 'someone else', T1, DAY1 - 500000)]);
const W2 = world([{ sid: R1, list: [{ t: T1, r: 2, m: 7001 }, { t: T2, r: 3, m: 7002 }] }, { sid: OTHER, list: [{ t: T1, r: 1, m: 7001 }] }],
  [chatRow(R1, 'second line reported', T2, RUN2 - 600000), chatRow(OTHER, 'someone else', T1, DAY1 - 500000)]);
const r1 = vrun(W1, { CHAT_MUTE_FILE: CHAT0 }, DAY1);
const r2 = vrun(W2, r1.text, RUN2);
const SIG_KEYS = ['rep', 'rseen', 'rpre', 'day', 'players'];

console.log('=== report-unlinkable [1] player reports: two runs of one reporter share no token ===');
{
  const s0 = {}, s1 = parse(r1.text.SIGNALS_FILE), s2 = parse(r2.text.SIGNALS_FILE);
  T('[1] both runs ok and each counted the reporter\'s new report (not a vacuous pass)', r1.code === 0 && r2.code === 0 && /reports: 2 new \(2 counted/.test(r1.out) && /reports: 1 new \(1 counted/.test(r2.out), tail(r1) + tail(r2));
  const a1 = touched(pick(s0, SIG_KEYS), pick(s1, SIG_KEYS), [], new Set()), a2 = touched(pick(s1, SIG_KEYS), pick(s2, SIG_KEYS), [], new Set());
  T('[1] each run wrote tokens', a1.size > 0 && a2.size > 0, a1.size + ' / ' + a2.size);
  const both = inter(a1, a2);
  T('[1] no token written by run 1 is written or changed again by run 2 (nothing ties the reporter\'s two reports)', both.length === 0, both.join(','));
}

console.log('=== report-unlinkable [2] chat reports: two runs of one reporter share no token ===');
{
  const c0 = parse(CHAT0), c1 = parse(r1.text.CHAT_MUTE_FILE), c2 = parse(r2.text.CHAT_MUTE_FILE);
  T('[2] both runs harvested the reporter\'s row (not a vacuous pass)', /chat-mute: reports \+2/.test(r1.out) && /chat-mute: reports \+1/.test(r2.out), tail(r1) + tail(r2));
  const a1 = touched(c0, c1, [], new Set()), a2 = touched(c1, c2, [], new Set());
  T('[2] each run wrote tokens (the digest queue included)', a1.size > 0 && a2.size > 0 && Object.keys(c2.pend || {}).length >= 2, a1.size + ' / ' + a2.size + ' ' + JSON.stringify(c2.pend));
  const both = inter(a1, a2);
  T('[2] no token written by run 1 is written or changed again by run 2', both.length === 0, both.join(','));
}

console.log('=== report-unlinkable [3] votes: two runs of one voter share no token ===');
const A1 = '76561198000000601', V1 = '76561198000000611';
{
  function boxWords(sid, text, cat, ts) {
    const u8 = fb.packText(text, 0);
    const w1 = ((1 & 0xFF) << 24) | ((cat & 0xFF) << 16) | ((0 & 0xFF) << 8) | (u8.len & 0xFF);
    return [fb.FB_MAGIC | 0, w1 | 0, fb.packLang('en'), fb.fnv1a32(String(sid) + ':' + ts) | 0, ts | 0].concat(u8.words);
  }
  const voteWords = (list) => [fb.FB_VOTE_MAGIC | 0, ((fb.FB_VER & 0xFF) << 24) | ((list.length & 0xFF) << 16)].concat(...list.map(x => [x.id | 0, ((x.ts << 2) | x.dir) | 0]));
  const FTS = (ms) => Math.floor((ms - fb.FB_EPOCH0) / 60000);
  const TA = FTS(DAY1) - 30, TB = FTS(DAY1) - 25;
  const ID1 = fb.fnv1a32(A1 + ':' + TA), ID2 = fb.fnv1a32(A1 + ':' + TB);
  const fbWorld = (votes) => {
    const boards = [{ id: 200, name: 'feedback_box', entries: [{ steamID: A1, score: TB, details: boxWords(A1, 'the hook line is too short on level two', 0, TA) }] },
      { id: 201, name: 'feedback_vote', entries: votes.map(x => ({ steamID: x.sid, score: 1, details: voteWords(x.list) })) }];
    let id = 300;
    for (let c = 0; c < fb.FB_CATS.length; c++) for (const s of ['hot', 'new']) boards.push({ id: id++, name: fb.feedBoardName(c, s), entries: [] });
    return boards;
  };
  // the author's box keeps his last post: run 0 admits ID1, run 0b admits ID2 (no votes yet); then V1 votes on ID1, later on ID2
  const WORDLIST = JSON.stringify({ sub: [{ l: Array.from('zqxbadword').length, h: fb.wlHash('s', 'zqxbadword') }], word: [] });   // as test/report-keys.js
  const FBF = ['FB_STATE_FILE', 'FB_MOD_FILE', 'FB_WORDLIST_FILE'];
  const frun = (boards, state, now) => run(FEEDBACK, boards, FBF, { FB_STATE_FILE: state, FB_WORDLIST_FILE: WORDLIST }, { FAKE_NOW: String(now) });
  const boxB = (ts) => { const w = fbWorld([]); w[0].entries = [{ steamID: A1, score: ts, details: boxWords(A1, ts === TA ? 'the hook line is too short on level two' : 'shop prices feel high after level five', 0, ts) }]; return w; };
  const f0 = frun(boxB(TA), null, DAY1);
  const f0b = frun(boxB(TB), f0.text.FB_STATE_FILE, DAY1 + 60000);
  const items = parse(f0b.text.FB_STATE_FILE).items || {};
  const w1 = boxB(TB); w1[1].entries = [{ steamID: V1, score: 1, details: voteWords([{ id: ID1, dir: 3, ts: FTS(DAY1) }]) }];
  const f1 = frun(w1, f0b.text.FB_STATE_FILE, DAY1 + 120000);
  const w2 = boxB(TB); w2[1].entries = [{ steamID: V1, score: 1, details: voteWords([{ id: ID1, dir: 3, ts: FTS(DAY1) }, { id: ID2, dir: 3, ts: FTS(RUN2) }]) }];
  const f2 = frun(w2, f1.text.FB_STATE_FILE, RUN2);
  const VK = ['votes', 'vv', 'vt', 'vpre'];
  const s0 = parse(f0b.text.FB_STATE_FILE), s1 = parse(f1.text.FB_STATE_FILE), s2 = parse(f2.text.FB_STATE_FILE);
  T('[3] both items admitted, each run stored the voter\'s new vote (not a vacuous pass)', f0.code === 0 && f0b.code === 0 && f1.code === 0 && f2.code === 0 && items[String(ID1)] && items[String(ID2)] &&
    JSON.stringify(s1) !== JSON.stringify(s0) && JSON.stringify(s2) !== JSON.stringify(s1), f2.out.slice(-400));
  const a1 = touched(pick(s0, VK), pick(s1, VK), [], new Set()), a2 = touched(pick(s1, VK), pick(s2, VK), [], new Set());
  T('[3] each run wrote tokens', a1.size > 0 && a2.size > 0, a1.size + ' / ' + a2.size);
  const both = inter(a1, a2);
  T('[3] no token written by run 1 is written or changed again by run 2 (nothing ties the voter\'s two votes)', both.length === 0, both.join(','));
  var fbState = s2;
}

console.log('=== report-unlinkable [4] the token maps are written in key order ===');
{
  const s = parse(r2.text.SIGNALS_FILE), c = parse(r2.text.CHAT_MUTE_FILE), f = fbState || {};
  const maps = { 'signals rep': s.rep, 'signals rseen': s.rseen, 'chat sig': c.sig, 'chat rep': c.rep, 'chat pend': c.pend };
  for (const it of Object.keys(f.vt || {})) maps['votes ' + it] = f.vt[it];
  const unsorted = Object.keys(maps).filter(k => !sortedMap(maps[k]));
  const dayRt = (s.day || {}).rt;
  T('[4] signals / chat / vote maps in key order, the day\'s slot list sorted', unsorted.length === 0 && (!Array.isArray(dayRt) || JSON.stringify(dayRt) === JSON.stringify(dayRt.slice().sort())), unsorted.join(', '));
}

console.log(failN ? 'FAIL ' + failN : 'report-unlinkable: ALL PASS');
process.exit(failN ? 1 : 0);
