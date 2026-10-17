'use strict';
// Q190 (cloud audit 2026-10): who reported whom must not be readable from the public state history.
// pid() is the one pseudonym every state file shares, and public boards tie a pid back to its SteamID (the voice board pairs
// author SteamIDs with item ids whose state records the author as a pid; several pid-keyed counters equal public scores).
// Report state keyed by pid therefore named every reporter. Now the three report lanes key by their own domain-prefixed
// HMACs, reporter side and target side apart: player reports (signals.json rep / rseen / day.r), chat reports
// (chat-mute.json) and voice votes incl. report votes (feedback state votes). State written before is NOT carried onto
// the lane keys (rework of Q190, coordinator B 2026-10-13): a value copied from a pid-keyed entry into a lane-keyed one in
// the same commit tells anyone who diffs that commit which lane key is which pid. The pid-keyed report state is dropped
// on a complete read of the board, and the reports on the board at that moment are marked as taken in a fixed keyed list
// (rpre / pre); the pid-keyed votes stay on their items without a voter ('~n' keys) and the (voter, item) pairs are marked
// (vpre), so a tally does not move and nobody is counted twice. The dedup key of a player report is one keyed token
// (review of Q190: in the clear its match hash named the match, and starts.json names its players).
// Q209 on top: no key stays with one reporter -- player report edges are keyed per (reporter, target) pair, the day's
// count is a set of slot tokens, chat state holds tokens per row / per pair / per queued row, votes one token per (voter,
// item); a Q190 state moves in place (test/report-unlinkable.js pins the property itself).
//
// Runs the REAL validate.js main() and feedback.js main() against an offline board stub (pinned clock):
//   [1]  fresh run: edges / chat state on lane keys, no pid of anyone in the report state, reporter and target keys of
//        one account differ, the digest queue keyed by the reporter's lane key; a second run counts nothing twice
//   [2]  drop of pid-keyed state (complete reads): nothing carried over, the reports on the boards marked as taken and
//        not counted again, no mute written, a later report taken as usual on the lane keys
//   [3]  partial read (PAGE_CAP=1, a full first page): pid-keyed state left untouched, harvest / lane deferred
//   [4]  untouched empty chat state stays byte-identical (no marker on an empty state)
//   [5]  votes: voter keys, the author's own vote and votes for unknown items are not stored, tallies as before
//   [6]  votes: fold of pid keys (tallies unchanged, no voter carried, pre-fold pairs not taken again)
//   [7]  votes: fold without a full read; after a rollback; leftovers next to the voter-keyed table
//   [8]  source pins
//   [9]  player reports after a rollback: an older version's pid-keyed leftovers next to the lane keys are dropped too
//   [10] Q209: a Q190 state (signals rkv 1, chat kv 1, votes on voter keys) moves in place: same counts, nothing taken
//        twice, the queued digest still found, and a report taken after it shares no key with the earlier ones
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'CONSOLATION_XP', 'REPORT_LB', 'TRUST_LB', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY',
  'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY', 'FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_DIGEST_TAG', 'CHAT_MUTE_LB', 'CHAT_REPORT_LB',
  'PAGE_CAP', 'REPORT_DAILY_CAP', 'FB_LB', 'FB_VOTE_LB', 'FB_FEED_PREFIX', 'FB_STATE_FILE', 'FB_MOD_FILE', 'FB_WORDLIST_FILE', 'FB_DAILY_CAP', 'FB_REPORT_HOLD', 'FB_FEED_CAP', 'FB_WRITE_CAP'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const cm = require(path.join(__dirname, '..', 'chat-mute.js'));
const fb = require(path.join(__dirname, '..', 'feedback.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const FEEDBACK = path.join(__dirname, '..', 'feedback.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8'), CM_SRC = fs.readFileSync(path.join(__dirname, '..', 'chat-mute.js'), 'utf8'), FB_SRC = fs.readFileSync(FEEDBACK, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub + pinned clock (FAKE_NOW). A board with pad: true is filled up to one full page (5000 rows) with
// junk rows, so readBoardAll under PAGE_CAP=1 returns complete: false.
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
  "    else if (b && b.pad) for (let i = ents.length; i < 5000; i++) ents.push({ steamID: String(76561199000000000n + BigInt(i)), score: 0, detailData: '' });",
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
const fixture = (boards) => JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, pad: !!b.pad, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) });

// ---- accounts, clock ----
const R1 = '76561198000000301', R2 = '76561198000000302', X = '76561198000000303';      // X reports and is reported
const T1 = '76561198000009301', T2 = '76561198000009302';
const R9 = '76561198000000399', T9 = '76561198000009399';                                 // only in old state, gone from the boards
const WORLD = [R1, R2, X, T1, T2, R9, T9];
const DAY1 = Date.UTC(2026, 10, 20, 9, 0);
const tsOf = (ms) => Math.floor((ms - cm.CHAT_MUTE.EPOCH0) / 60000);
const NOWMIN = Math.floor(DAY1 / 60000);
const DM = 'private dm line 5150', GL = 'global chat line 6160', PL = 'party chat line 7170';
const MAIL = { FB_DIGEST_TO: 'owner@example.invalid', RESEND_API_KEY: 'mail-key' };

// ---- player report box rows (client packing: [0xB3, ver<<8|count, (sidLo, sidHi, reason, matchHash)*n]) ----
function packReports(list) {
  const det = [v.REPORT_MAGIC, (1 << 8) | list.length];
  for (const r of list) { const b = BigInt(r.t); det.push(Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, r.r | 0, r.m | 0); }
  return det;
}
// ---- chat report box rows (client packReport mirror, as in test/chat-report-privacy.js) ----
function fnv(s) { let h = 0x811c9dc5 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; }
function packChat(text, targetSid, scope, tsMin) {
  const bytes = Buffer.from(text, 'utf8'), b = BigInt(targetSid);
  const w0 = ((cm.CHAT_MUTE.MAGIC & 0xFF) | ((cm.CHAT_MUTE.VER & 0xFF) << 8) | ((scope & 0xFF) << 16)) | 0;
  const words = [w0, bytes.length | 0, Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, tsMin | 0, fnv(text)];
  for (let i = 0; i < bytes.length; i++) { const wi = 6 + (i >> 2); if (words.length <= wi) words.push(0); words[wi] = (words[wi] | (bytes[i] << ((i & 3) * 8))) | 0; }
  return words;
}
const chatRow = (sid, text, target, scope, ms) => ({ steamID: sid, score: tsOf(ms), details: packChat(text, target, scope, tsOf(ms)) });
const REPORT_BOX = 40, CHAT_BOX = 50, MUTE_BOX = 51;
function world(o) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  boards.push({ id: REPORT_BOX, name: 'report_box', pad: !!o.pad, entries: (o.reports || []).map(r => ({ steamID: r.sid, score: 1, details: packReports(r.list) })) });
  boards.push({ id: CHAT_BOX, name: 'chat_report_box', pad: !!o.pad, entries: o.chat || [] });
  boards.push({ id: MUTE_BOX, name: 'chat_mute', entries: o.mute || [] });
  return boards;
}
function runValidate(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-keys-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json'); fs.writeFileSync(fxPath, fixture(boards));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateDir = path.join(dir, 'state'); fs.mkdirSync(stateDir);
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(stateDir, k.toLowerCase() + '.json');
    const before = {};
    for (const k of Object.keys(files || {})) { const t = typeof files[k] === 'string' ? files[k] : JSON.stringify(files[k]); fs.writeFileSync(stateEnv[k], t); before[k] = t; }
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's', RANKED_LB: 'rating', LP_LB: 'points',
      SEASON_NOW: '2026-11-20T00:00:00Z', FAKE_NOW: String(DAY1), APPLY_MMR: '1',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', LEDGER_SHARDS: '8', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: stateDir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {}, text = {};
    for (const k of FILE_VARS) { try { text[k] = fs.readFileSync(stateEnv[k], 'utf8'); state[k] = JSON.parse(text[k]); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, text, before, sig: state.SIGNALS_FILE || {}, chat: state.CHAT_MUTE_FILE || {} };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const tail = (r) => r.out.slice(-700);
// every pid of the accounts in play that shows up in a text
const pidsIn = (t, sids) => (sids || WORLD).filter(s => String(t).includes(v.pid(s)));
const BY = v.REP_KEYS.by, OF = v.REP_KEYS.of, CBY = v.CHAT_KEYS.by, COF = v.CHAT_KEYS.of;
const EDGE = (r, t) => v.REP_KEYS.edge(v.REP_KEYS.pair(r, t), OF(t));                    // Q209: one edge per (reporter, target)
const SLOT = (sid, i) => v.REP_KEYS.slot(Math.floor(DAY1 / 86400000), BY(sid), i);       // Q209: the day's count = slot tokens
const CPAIR = (r, t) => cm.pairTok(CBY, CBY(r), COF(t)), CROW = (row) => cm.rowTok(CBY, CBY(row.steamID), cm.decodeReport(row.details));
const CMAIL = (row) => { const d = cm.decodeReport(row.details); return cm.mailTok({ reporterSid: row.steamID, target: d.target, scope: d.scope, tsMin: d.tsMin, text: d.text }, CBY); };
const reportPart = (s) => JSON.stringify({ rep: s.rep, rseen: s.rseen, dayr: (s.day || {}).r, dayrt: (s.day || {}).rt, players: s.players });
const muteWrites = (r) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + MUTE_BOX + '(&|$)').test(p.body));

console.log('=== report-keys [1] fresh run: lane keys only ===');
const W1 = {
  reports: [{ sid: R1, list: [{ t: T1, r: 2, m: 111 }, { t: T2, r: 1, m: 111 }] }, { sid: X, list: [{ t: T1, r: 3, m: 5 }] }, { sid: T1, list: [{ t: X, r: 2, m: 9 }] }],
  chat: [chatRow(R1, DM, T1, 3, DAY1 - 600000), chatRow(X, GL, T1, 1, DAY1 - 500000), chatRow(T1, PL, X, 2, DAY1 - 400000)],
};
const sentToday = { seen: {}, rep: {}, auto: {}, digest: { day: '2026-11-20', at: NOWMIN - 120 } };   // digest already out today: the queue stays
let r1;
{
  r1 = runValidate(world(W1), { CHAT_MUTE_FILE: sentToday }, MAIL);
  T('[1] run ok, four player reports counted, three chat reports harvested (not a vacuous pass)', r1.code === 0 && /reports: 4 new \(4 counted/.test(r1.out) && /chat-mute: reports \+3/.test(r1.out), tail(r1));
  const s = r1.sig;
  T('[1] signals on lane keys (rkv)', s.rkv === v.REP_KEYS_VER, JSON.stringify(s.rkv));
  const want = [EDGE(R1, T1), EDGE(R1, T2), EDGE(X, T1), EDGE(T1, X)].sort();
  T('[1] edges = one keyed token per (reporter, target), written in key order', JSON.stringify(Object.keys(s.rep || {})) === JSON.stringify(want), JSON.stringify(Object.keys(s.rep || {})));
  T('[1] an edge holds counts and a stamp only (no pair token, no reporter key)', Object.keys(s.rep || {}).every(k => JSON.stringify(Object.keys(s.rep[k])) === '["n","m","at"]'));
  T('[1] no per-pid report counters (players[].ri / .ro)', Object.keys(s.players || {}).every(h => s.players[h].ri == null && s.players[h].ro == null));
  T('[1] no pid of any account in the report state (rep / rseen / day.r / players)', pidsIn(reportPart(s)).length === 0, pidsIn(reportPart(s)).join(','));
  T('[1] each dedup key is one keyed token: no reason, no match hash in the clear (they name the match; starts.json names its players)',
    Object.keys(s.rseen || {}).length === 4 && Object.keys(s.rseen || {}).every(k => /^[0-9a-f]{16}$/.test(k)), JSON.stringify(Object.keys(s.rseen || {})));
  T('[1] the day\'s counts are slot tokens (R1 two, X one, T1 one), in key order; no counter under a reporter key', JSON.stringify((s.day || {}).rt) === JSON.stringify([SLOT(R1, 0), SLOT(R1, 1), SLOT(X, 0), SLOT(T1, 0)].sort()) && (s.day || {}).r === undefined, JSON.stringify(s.day));
  const laneKeys = WORLD.reduce((a, x) => a.concat([BY(x), OF(x), v.pid(x)]), []);
  T('[1] no key of one account alone (lane key, pid) anywhere in the report state: X reports and is reported, nothing ties the two', laneKeys.every(k => !reportPart(s).includes(k)));
  const c = r1.chat;
  T('[1] chat state on lane keys (kv)', c.kv === cm.KEYS_VER, JSON.stringify(c.kv));
  T('[1] chat: no pid of any account anywhere in chat-mute.json', pidsIn(r1.text.CHAT_MUTE_FILE).length === 0, pidsIn(r1.text.CHAT_MUTE_FILE).join(','));
  T('[1] chat: one token per harvested row (in key order), reporter sets under the target key holding pair tokens', JSON.stringify(Object.keys(c.sig)) === JSON.stringify(W1.chat.map(CROW).sort()) &&
    JSON.stringify(Object.keys(c.rep)) === JSON.stringify([COF(T1), COF(X)].sort()) && JSON.stringify(c.rep[COF(T1)].map(x => x[0]).sort()) === JSON.stringify([CPAIR(R1, T1), CPAIR(X, T1)].sort()) &&
    JSON.stringify(c.rep[COF(X)].map(x => x[0])) === JSON.stringify([CPAIR(T1, X)]) && JSON.stringify(c.seen) === '{}', JSON.stringify(c));
  const cKeys = WORLD.reduce((a, x) => a.concat([CBY(x), v.pid(x)]), []), cText = JSON.stringify({ sig: c.sig, rep: c.rep, pend: c.pend });
  T('[1] chat: no reporter key anywhere (X and T1 report and are reported, nothing ties the two sides)', cKeys.every(k => !cText.includes(k)));
  T('[1] chat: digest queue = one token per queued row, in key order', JSON.stringify(Object.keys(c.pend || {})) === JSON.stringify(W1.chat.map(CMAIL).sort()));
  T('[1] chat: no raw text, no raw SteamID in the file', !/7656119\d{10}/.test(r1.text.CHAT_MUTE_FILE) && ![DM, GL, PL].some(x => r1.text.CHAT_MUTE_FILE.includes(x)));
}
{ // a second run over the same boards: rseen / watermarks under the new keys still dedup
  const r = runValidate(world(W1), { CHAT_MUTE_FILE: r1.text.CHAT_MUTE_FILE, SIGNALS_FILE: r1.text.SIGNALS_FILE }, MAIL);
  const e = r.sig.rep || {};
  T('[1] second run: nothing counted twice (edges n unchanged), no chat row taken again', r.code === 0 && !/reports: \d+ new/.test(r.out) && !/chat-mute: reports \+/.test(r.out) &&
    Object.keys(e).length === 4 && Object.keys(e).every(k => e[k].n === 1), tail(r));
}

{ // automatic mute on the target lane key: 10 distinct reporters on T2 inside the window -> one mute write, auto keyed COF(T2)
  const rs = []; for (let i = 0; i < cm.CHAT_MUTE.AUTO_REPORTERS; i++) rs.push('7656119800000' + String(4100 + i));
  const r = runValidate(world({ chat: rs.map((sid, i) => chatRow(sid, 'line ' + i, T2, 1, DAY1 - 300000 + i * 1000)) }), {}, {});
  const mw = muteWrites(r);
  T('[1] ten distinct reporters: one automatic mute written for the target', r.code === 0 && mw.length === 1 && new RegExp('steamid=' + T2 + '(&|$)').test(mw[0].body), JSON.stringify(mw) + tail(r));
  T('[1] the mute is recorded under the target lane key, the reporters under theirs, no pid', JSON.stringify(Object.keys(r.chat.auto || {})) === JSON.stringify([COF(T2)]) &&
    JSON.stringify(Object.keys(r.chat.rep || {})) === JSON.stringify([COF(T2)]) && pidsIn(r.text.CHAT_MUTE_FILE, rs.concat([T2])).length === 0, JSON.stringify(r.chat));
  const r2 = runValidate(world({ chat: rs.map((sid, i) => chatRow(sid, 'line ' + i, T2, 1, DAY1 - 300000 + i * 1000)) }), { CHAT_MUTE_FILE: r.text.CHAT_MUTE_FILE }, {});
  T('[1] next run over the same rows: no second write (watermarks and auto memory read back)', r2.code === 0 && muteWrites(r2).length === 0, JSON.stringify(muteWrites(r2)));
}

console.log('=== report-keys [2] drop of pid-keyed state (complete reads): nothing carried over ===');
const A0 = DAY1 - 3 * 3600000, U1 = NOWMIN + 600, U9 = NOWMIN + 300;
const legacySignals = () => ({
  day: { d: Math.floor(DAY1 / 86400000), n: {}, r: { [v.pid(R1)]: 1, [v.pid(R9)]: 2 } },
  players: { [v.pid(T1)]: { g: 1, w: 0, v: 0, f: 0, ns: 0, disp: [1, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: A0, ri: 1 }, [v.pid(R1)]: { g: 1, w: 1, v: 0, f: 0, ns: 0, disp: [1, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: A0, ro: 1 } },
  pairs: { [v.pairKey(v.pid(R1), v.pid(T1))]: { n: 1, t: 0, x: 1, at: A0 }, [v.pairKey(v.pid(R1), v.pid(T2))]: { n: 1, t: 0, x: 1, at: A0 } },
  flagged: {},
  rep: { [v.pid(R1) + '>' + v.pid(T1)]: { n: 1, m: 4, at: A0 }, [v.pid(R9) + '>' + v.pid(T9)]: { n: 2, m: 2, at: A0 } },
  rseen: { [v.pid(R1) + '|' + v.pid(T1) + '|2|111']: A0, [v.pid(R9) + '|' + v.pid(T9) + '|1|7']: A0 },
});
const R1MS = DAY1 - 7200000;
const fR1 = { reporterSid: R1, target: T1, scope: 3, tsMin: tsOf(R1MS), text: DM };
const legacyChat = () => ({
  seen: { [v.pid(R1)]: tsOf(R1MS), [v.pid(R9)]: tsOf(R1MS) - 5 },
  sig: { [v.pid(R1)]: v.pid('chat-row|1|3|0|1|' + T1 + '|1|' + tsOf(R1MS)) },   // row digest under the old key (W13)
  rep: { [v.pid(T1)]: [[v.pid(R1), NOWMIN - 120], [v.pid(R9), NOWMIN - 125]], [v.pid(T9)]: [[v.pid(R9), NOWMIN - 125]] },
  auto: { [v.pid(T1)]: U1, [v.pid(T9)]: U9 },
  digest: { day: '2026-11-20', at: NOWMIN - 120 },
  pend: { [v.pid(R1)]: cm.mailSig(fR1, v.pid), [v.pid(R9)]: 'abcdef0123456789' },
});
const W2 = { reports: [{ sid: R1, list: [{ t: T1, r: 2, m: 111 }] }], chat: [chatRow(R1, DM, T1, 3, R1MS)], mute: [{ steamID: T1, score: U1 }] };
const preRow = (row) => cm.preKey(CBY, row.steamID, cm.decodeReport(row.details));
let r2;
{
  r2 = runValidate(world(W2), { SIGNALS_FILE: legacySignals(), CHAT_MUTE_FILE: legacyChat() }, MAIL);
  const r = r2, s = r.sig;
  T('[2] run ok, both drops logged with their counts', r.code === 0 && /reports: pid-keyed report state dropped for the lane keys \(Q190\): 8 entr\(ies\) dropped, 1 report\(s\) on the box marked as taken/.test(r.out) &&
    /chat-mute: pid-keyed state dropped for the lane keys \(Q190\): 9 entr\(ies\) dropped, 1 row\(s\) on the report box marked as taken/.test(r.out), tail(r));
  T('[2] nothing of the pid-keyed report state carried over: no edge, no dedup key, no daily count', JSON.stringify(s.rep) === '{}' && JSON.stringify(s.rseen) === '{}' && Object.keys((s.day || {}).r || {}).length === 0, JSON.stringify([s.rep, s.rseen, s.day]));
  T('[2] the report on the box marked as taken: one keyed token, no account in it', JSON.stringify(s.rpre) === JSON.stringify([v.REP_KEYS.seen(R1, T1, 2, 111)]) && pidsIn(JSON.stringify(s.rpre)).length === 0, JSON.stringify(s.rpre));
  T('[2] and not counted again under the lane keys', !/reports: \d+ new/.test(r.out), tail(r));
  T('[2] per-pid report counters removed, the other player signals kept', s.players[v.pid(T1)].ri === undefined && s.players[v.pid(R1)].ro === undefined && s.players[v.pid(R1)].g === 1);
  T('[2] trust: the dropped reports count toward nobody (fewer, never more); the pairs stay', v.verifiedUniqueReporters(s, T1) === 0 && Object.keys(s.pairs).length === 2);
  T('[2] marked (rkv), no pid left in the report state', s.rkv === v.REP_KEYS_VER && pidsIn(JSON.stringify({ rep: s.rep, rseen: s.rseen, dayr: s.day.r, rpre: s.rpre })).length === 0);
  const c = r.chat;
  T('[2] chat: nothing carried over (watermarks, row digests, reporter sets, mute memory all empty)', JSON.stringify([c.seen || {}, c.sig || {}, c.rep, c.auto]) === '[{},{},{},{}]', JSON.stringify(c));
  T('[2] chat: the queued digest entries counted in pendLost (their rows stay on the box), no queue left', c.pend === undefined && c.pendLost === 2, JSON.stringify([c.pend, c.pendLost]));
  T('[2] chat: the row on the box marked as taken (one keyed token) and not taken again', JSON.stringify(c.pre) === JSON.stringify([preRow(W2.chat[0])]) && !/chat-mute: reports \+/.test(r.out), JSON.stringify(c.pre) + tail(r));
  T('[2] chat: no mute written by the drop (the mute on the board keeps its row and expiry)', muteWrites(r).length === 0, JSON.stringify(muteWrites(r)));
  T('[2] chat: marked (kv), no pid of any account in the file', c.kv === cm.KEYS_VER && pidsIn(r.text.CHAT_MUTE_FILE).length === 0, pidsIn(r.text.CHAT_MUTE_FILE).join(','));
}
{ // a later run: R1 files a new player report (T2) and a new chat report; the marked ones stay untaken
  const later = DAY1 + 3600000, CL = 'later chat line 8180';
  const W2b = { reports: [{ sid: R1, list: [{ t: T1, r: 2, m: 111 }, { t: T2, r: 1, m: 222 }] }], chat: [chatRow(R1, CL, T2, 1, later - 60000)], mute: [{ steamID: T1, score: U1 }] };
  const r = runValidate(world(W2b), { SIGNALS_FILE: r2.text.SIGNALS_FILE, CHAT_MUTE_FILE: r2.text.CHAT_MUTE_FILE }, Object.assign({ FAKE_NOW: String(later) }, MAIL));
  const s = r.sig;
  T('[2] later run: the new report taken on the lane keys, the marked one not', r.code === 0 && /reports: 1 new \(1 counted/.test(r.out) && JSON.stringify(Object.keys(s.rep)) === JSON.stringify([EDGE(R1, T2)]) &&
    JSON.stringify(Object.keys(s.rseen)) === JSON.stringify([v.REP_KEYS.seen(R1, T2, 1, 222)]), tail(r));
  T('[2] later run: the marked list is fixed (unchanged)', JSON.stringify(s.rpre) === JSON.stringify(r2.sig.rpre));
  T('[2] later run: trust verifies the new report (R1 met T2)', v.verifiedUniqueReporters(s, T2) === 1 && v.verifiedUniqueReporters(s, T1) === 0);
  T('[2] later run: the new chat row taken, the marked list unchanged', /chat-mute: reports \+1/.test(r.out) && JSON.stringify(Object.keys(r.chat.sig)) === JSON.stringify([CROW(W2b.chat[0])]) &&
    JSON.stringify(Object.keys(r.chat.rep)) === JSON.stringify([COF(T2)]) && JSON.stringify(r.chat.pre) === JSON.stringify(r2.chat.pre), tail(r));
}
{ // old state with nothing report-related in it: marked at once, nothing dropped, harvest runs on lane keys
  const s0 = legacySignals(); s0.rep = {}; s0.rseen = {}; s0.day.r = {}; delete s0.players[v.pid(T1)].ri; delete s0.players[v.pid(R1)].ro;
  const r = runValidate(world(W2), { SIGNALS_FILE: s0 }, {});
  T('[2] old state without report entries: nothing to drop, harvest runs on lane keys', r.code === 0 && !/dropped for the lane keys/.test(r.out) && /reports: 1 new \(1 counted/.test(r.out) &&
    r.sig.rkv === v.REP_KEYS_VER && r.sig.rpre === undefined && JSON.stringify(Object.keys(r.sig.rep)) === JSON.stringify([EDGE(R1, T1)]), tail(r));
}

console.log('=== report-keys [3] partial read: pid-keyed state untouched ===');
{
  const r = runValidate(world(Object.assign({ pad: true }, W2)), { SIGNALS_FILE: legacySignals(), CHAT_MUTE_FILE: legacyChat() }, Object.assign({ PAGE_CAP: '1' }, MAIL));
  T('[3] run ok, both lanes deferred and say why', r.code === 0 && /harvest deferred until a complete read drops it \(Q190\)/.test(r.out) && /chat-mute: partial read of the report box with pid-keyed state -- lane deferred until a complete read drops it/.test(r.out), tail(r));
  T('[3] signals: report state exactly as before (no drop, no new edge, no marker, nothing marked as taken)', r.sig.rkv === undefined && r.sig.rpre === undefined && JSON.stringify(r.sig.rep) === JSON.stringify(legacySignals().rep) && JSON.stringify(r.sig.rseen) === JSON.stringify(legacySignals().rseen), JSON.stringify(r.sig.rep));
  T('[3] chat: state file untouched', r.text.CHAT_MUTE_FILE === r.before.CHAT_MUTE_FILE);
  T('[3] trust: the old edges still verify the old way meanwhile', v.verifiedUniqueReporters(r.sig, T1) === 1);
}

console.log('=== report-keys [4] untouched empty chat state ===');
{
  const empty = '{"seen":{},"rep":{},"auto":{}}';
  const r = runValidate(world({}), { CHAT_MUTE_FILE: empty }, {});
  // what this tree's lane writes for an empty state anyway (W13 adds an empty sig map): Q190 must add nothing to it
  const st0 = JSON.parse(empty); cm.harvest(st0, [], CBY, NOWMIN, COF); cm.prune(st0, NOWMIN);
  const exp = JSON.stringify(cm.publicState(st0));
  T('[4] empty chat state written back as before the change (no marker, no new field on an empty state)', r.code === 0 && r.text.CHAT_MUTE_FILE === exp && !/"kv"/.test(r.text.CHAT_MUTE_FILE), r.text.CHAT_MUTE_FILE + ' vs ' + exp);
}

// ---- voice votes (feedback.js main) ----
function boxWords(sid, text, cat, ts) {
  const u8 = fb.packText(text, 0);
  const w1 = ((1 & 0xFF) << 24) | ((cat & 0xFF) << 16) | ((0 & 0xFF) << 8) | (u8.len & 0xFF);
  return [fb.FB_MAGIC | 0, w1 | 0, fb.packLang('en'), fb.fnv1a32(String(sid) + ':' + ts) | 0, ts | 0].concat(u8.words);
}
const voteWords = (list) => [fb.FB_VOTE_MAGIC | 0, ((fb.FB_VER & 0xFF) << 24) | ((list.length & 0xFF) << 16)].concat(...list.map(x => [x.id | 0, ((x.ts << 2) | x.dir) | 0]));
const A1 = '76561198000000401', A2 = '76561198000000402', V1 = '76561198000000411', V2 = '76561198000000412', V9 = '76561198000000419';
const FTS = (ms) => Math.floor((ms - fb.FB_EPOCH0) / 60000);
const TA1 = FTS(DAY1) - 30, TA2 = FTS(DAY1) - 20;
const ID1 = String(fb.fnv1a32(A1 + ':' + TA1)), ID2 = String(fb.fnv1a32(A2 + ':' + TA2));
const BOX = 200, VOTE = 201;
function fbWorld(votes, pad) {
  const boards = [{ id: BOX, name: 'feedback_box', entries: [{ steamID: A1, score: TA1, details: boxWords(A1, 'the hook line is too short on level two', 0, TA1) },
    { steamID: A2, score: TA2, details: boxWords(A2, 'shop prices feel high after level five', 2, TA2) }] },
    { id: VOTE, name: 'feedback_vote', pad: !!pad, entries: votes.map(x => ({ steamID: x.sid, score: 1, details: voteWords(x.list) })) }];
  let id = 300;
  for (let c = 0; c < fb.FB_CATS.length; c++) for (const s of ['hot', 'new']) boards.push({ id: id++, name: fb.feedBoardName(c, s), entries: [] });
  return boards;
}
const WORDLIST = { sub: [{ l: Array.from('zqxbadword').length, h: fb.wlHash('s', 'zqxbadword') }], word: [] };   // same shape as test/feedback-text-privacy.js
function runFeedback(boards, state, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-keys-fb-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    fs.writeFileSync(path.join(dir, 'fx.json'), fixture(boards));
    fs.writeFileSync(path.join(dir, 'post.log'), '');
    const sd = path.join(dir, 'state'); fs.mkdirSync(sd);
    const f = { FB_STATE_FILE: path.join(sd, 'feedback.json'), FB_MOD_FILE: path.join(sd, 'feedback-mod.json'), FB_WORDLIST_FILE: path.join(sd, 'feedback-wordlist.json') };
    fs.writeFileSync(f.FB_WORDLIST_FILE, JSON.stringify(WORDLIST));
    if (state) fs.writeFileSync(f.FB_STATE_FILE, typeof state === 'string' ? state : JSON.stringify(state));
    const base = Object.assign({}, process.env);
    for (const k of Object.keys(base)) if (/^FB_|^RESEND_|^PAGE_CAP$/.test(k)) delete base[k];
    const e = Object.assign(base, { STEAM_PUBLISHER_KEY: 'k', APPID: '1', STATE_SALT: 's', FAKE_NOW: String(DAY1),
      STUB_FIXTURE: path.join(dir, 'fx.json'), STUB_LOG: path.join(dir, 'post.log') }, f, env || {});
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), FEEDBACK], { env: e, encoding: 'utf8', cwd: sd, timeout: 60000 });
    let text = null, st = null; try { text = fs.readFileSync(f.FB_STATE_FILE, 'utf8'); st = JSON.parse(text); } catch (err) {}
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), text, st: st || {} };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const VK = fb.voterKey, VT = (sid, item) => fb.voteTok(VK(sid), String(item));   // Q209: one token per (voter, item)

console.log('=== report-keys [5] votes on voter keys ===');
let f5;
{
  const ts = FTS(DAY1) - 10;
  const votes = [{ sid: V1, list: [{ id: ID1, dir: 1, ts }, { id: ID2, dir: 3, ts }] },
    { sid: A1, list: [{ id: ID1, dir: 1, ts }, { id: ID2, dir: 3, ts }] },          // A1 up-votes his own item, reports A2's
    { sid: V2, list: [{ id: 424242, dir: 3, ts }, { id: ID2, dir: 2, ts }] }];      // 424242 = no such item
  f5 = runFeedback(fbWorld(votes), null, {});
  const st = f5.st, vt = fb.storedVotes(st) || {};
  T('[5] run ok, both items admitted (not a vacuous pass)', f5.code === 0 && st.items && st.items[ID1] && st.items[ID2], f5.out.slice(-500));
  T('[5] votes on voter / item tokens stored as vt (vv holds only folded votes: none here); the votes field an older version reads is left empty (rollback: no voter counted twice)', !!st.vt && JSON.stringify(st.vv) === '{}' && JSON.stringify(st.votes) === '{}' && st.vkv === undefined && st.pidVotes === undefined, JSON.stringify([st.votes, st.vv, st.vkv]));
  T('[5] the author\'s own vote is not stored', JSON.stringify(vt[ID1]) === JSON.stringify({ [VT(V1, ID1)]: [1, ts] }), JSON.stringify(vt[ID1]));
  T('[5] report votes on voter / item tokens (the author may report someone else\'s item), written in key order', JSON.stringify(Object.keys(st.vt[ID2] || {})) === JSON.stringify([VT(V1, ID2), VT(A1, ID2), VT(V2, ID2)].sort()), JSON.stringify(st.vt[ID2]));
  T('[5] no key shared by two items (V1 voted on both: two unrelated tokens), no voter key left', VT(V1, ID1) !== VT(V1, ID2) && !Object.keys(st.vt).some(it => Object.keys(st.vt[it]).some(k => k === VK(V1) || k === VK(A1) || k === VK(V2))) &&
    Object.keys(st.vt[ID1]).filter(k => st.vt[ID2][k] !== undefined).length === 0, JSON.stringify(st.vt));
  T('[5] a vote for an item the state does not hold is not stored', vt['424242'] === undefined);
  T('[5] no pid of a voter in the votes', pidsIn(JSON.stringify(vt), [V1, V2, A1, A2]).length === 0, pidsIn(JSON.stringify(vt), [V1, V2, A1, A2]).join(','));
  const t1 = fb.tallyVotes(vt[ID1], st.items[ID1].ap), t2 = fb.tallyVotes(vt[ID2], st.items[ID2].ap);
  T('[5] tallies: ID1 up 1 (self vote never counts), ID2 reports 2 / down 1', t1.up === 1 && t1.down === 0 && t2.rep === 2 && t2.down === 1, JSON.stringify([t1, t2]));
}

console.log('=== report-keys [6] votes: fold of pid keys ===');
const legacyVotes = (items) => ({ boards: {}, items, digest: { day: '', at: 0 },
  votes: { [ID1]: { [v.pid(V1)]: [1, 100], [v.pid(A1)]: [1, 100], [v.pid(V9)]: [2, 100] }, [ID2]: { [v.pid(V1)]: [3, 101], [v.pid(V9)]: [0, 102] }, '999': { [v.pid(V1)]: [1, 99] } } });
const voterKeysIn = (vt) => { const o = new Set(); for (const it of Object.keys(vt || {})) for (const k of Object.keys(vt[it])) if (k.charAt(0) !== '~') o.add(k); return o; };
let f6;
{
  const items = f5.st.items, before = legacyVotes(items);
  // V1 changes his vote on ID1 (up -> down) after the fold; A1 (author of ID1) votes on ID2 for the first time
  f6 = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 2, ts: 150 }, { id: ID2, dir: 3, ts: 101 }] }, { sid: A1, list: [{ id: ID2, dir: 1, ts: 105 }] }]), before, {});
  const r = f6, vt = fb.storedVotes(r.st) || {};
  T('[6] run ok, fold logged with its counts', r.code === 0 && /feedback: pid-keyed votes folded for the voter keys \(Q190\): 3 kept on their items without a voter, 3 dropped, 6 voter\/item pair\(s\) marked as voted/.test(r.out), r.out.slice(-500));
  T('[6] the votes that count stay on their items under numbered keys with no account (stamp order), in vv; A1\'s new vote on its token in vt', JSON.stringify(r.st.vv[ID1]) === JSON.stringify({ '~0': [1, 100], '~1': [2, 100] }) && JSON.stringify(r.st.vv[ID2]) === JSON.stringify({ '~0': [3, 101] }) &&
    JSON.stringify(r.st.vt) === JSON.stringify({ [ID2]: { [VT(A1, ID2)]: [1, 105] } }), JSON.stringify([r.st.vv, r.st.vt]));
  const tb1 = fb.tallyVotes(before.votes[ID1], items[ID1].ap), ta1 = fb.tallyVotes(vt[ID1], items[ID1].ap);
  const tb2 = fb.tallyVotes(before.votes[ID2], items[ID2].ap), ta2 = fb.tallyVotes(vt[ID2], items[ID2].ap);
  T('[6] tallies unchanged by the fold (ID1 up 1 / down 1, the author\'s own vote never counted; ID2 one report, plus A1\'s new up-vote)', JSON.stringify(tb1) === JSON.stringify(ta1) && tb2.rep === 1 && ta2.rep === 1 && ta2.up === tb2.up + 1, JSON.stringify([tb1, ta1, tb2, ta2]));
  T('[6] the report hold counts the same reports as before', fb.reportsSince(vt[ID2], items[ID2].ap, -1) === fb.reportsSince(before.votes[ID2], items[ID2].ap, -1));
  T('[6] V1 had voted on ID1 / ID2 before the fold: his later change there is not taken (the items keep his old votes)', !voterKeysIn(vt).has(VT(V1, ID1)) && !voterKeysIn(vt).has(VT(V1, ID2)), JSON.stringify(vt));
  T('[6] no voter carried over: the only token is A1\'s new vote; no pid of a voter', JSON.stringify([...voterKeysIn(vt)]) === JSON.stringify([VT(A1, ID2)]) && pidsIn(JSON.stringify([r.st.vv, r.st.vt]), [V1, V9, A1]).length === 0, JSON.stringify([...voterKeysIn(vt)]));
  T('[6] the pre-fold pairs marked: 6 keyed tokens (counted or not: the cleared vote and the unknown item too), no account in them', Array.isArray(r.st.vpre) && r.st.vpre.length === 6 && r.st.vpre.every(k => /^[0-9a-f]{16}$/.test(k)) &&
    r.st.vpre.includes(fb.preVoteTok(v.pid(V1), ID1)) && r.st.vpre.includes(fb.preVoteTok(v.pid(V1), '999')) && pidsIn(JSON.stringify(r.st.vpre), [V1, V9, A1]).length === 0, JSON.stringify(r.st.vpre));
  T('[6] dropped: the author\'s own vote, the cleared vote, the unknown item; the pid table left empty', vt['999'] === undefined && JSON.stringify(r.st.votes) === '{}');
}
{ // read back: the next run keeps the folded table and the marks, folds nothing again
  const r = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 2, ts: 150 }] }]), f6.text, {});
  T('[6] next run: folded votes, tokens and marks read back as they were, no second fold', r.code === 0 && !/folded/.test(r.out) && JSON.stringify(r.st.vv) === JSON.stringify(f6.st.vv) && JSON.stringify(r.st.vt) === JSON.stringify(f6.st.vt) && JSON.stringify(r.st.vpre) === JSON.stringify(f6.st.vpre), JSON.stringify([r.st.vv, r.st.vt]));
}
{ // votes stored as vt are read back: a run with no vote rows left keeps them
  const r = runFeedback(fbWorld([]), f5.text, {});
  T('[6] votes stored as vt read back (a later run with an empty vote board keeps them)', r.code === 0 && JSON.stringify(r.st.vt) === JSON.stringify(f5.st.vt) && JSON.stringify(r.st.vv) === '{}' && JSON.stringify(r.st.votes) === '{}' && r.st.vpre === undefined, JSON.stringify(r.st.vt));
}
console.log('=== report-keys [7] votes: fold without a full read, after a rollback, leftovers ===');
{
  const items = f5.st.items;
  const r = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 1, ts: 100 }] }], true), legacyVotes(items), { PAGE_CAP: '1' });
  T('[7] a partial read of the vote board: the fold needs no board, done all the same', r.code === 0 && /pid-keyed votes folded for the voter keys \(Q190\): 3 kept/.test(r.out) &&
    JSON.stringify(r.st.vv[ID1]) === JSON.stringify(f6.st.vv[ID1]) && JSON.stringify(r.st.vpre) === JSON.stringify(f6.st.vpre), r.out.slice(-500));
}
{ // a real rollback: the older version keeps only the fields it knows (vv and vpre are gone) and rebuilds its pid-keyed
  // table from the vote windows; the next run of this version folds that table as on the first run
  const items = f5.st.items;
  const disk = { boards: {}, items, digest: { day: '', at: 0 }, votes: { [ID1]: { [v.pid(V1)]: [1, 100] }, [ID2]: { [v.pid(A1)]: [1, 105] } } };
  const r = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 1, ts: 100 }] }, { sid: A1, list: [{ id: ID2, dir: 1, ts: 105 }] }]), disk, {});
  const vt = fb.storedVotes(r.st) || {};
  T('[7] after a rollback: folded again, each voter counted once, no voter key', r.code === 0 && JSON.stringify(vt[ID1]) === JSON.stringify({ '~0': [1, 100] }) && JSON.stringify(vt[ID2]) === JSON.stringify({ '~0': [1, 105] }) &&
    fb.tallyVotes(vt[ID1], items[ID1].ap).up === 1 && voterKeysIn(vt).size === 0, JSON.stringify(vt));
}
{ // leftovers next to the voter-keyed table (only a hand-edited state: the older version drops vv on save): marked, not
  // kept -- V1 already has his vote under his voter key, a second copy would count him twice. The Q190 voter key in vv
  // moves onto V1's token on that item (Q209).
  const items = f5.st.items;
  const disk = { boards: {}, items, digest: { day: '', at: 0 }, vv: { [ID1]: { [VK(V1)]: [2, 90] } }, votes: { [ID1]: { [v.pid(V1)]: [1, 100] }, [ID2]: { [v.pid(V1)]: [3, 101] } } };
  const r = runFeedback(fbWorld([]), disk, {});
  const vt = fb.storedVotes(r.st) || {}, t = fb.tallyVotes(vt[ID1], items[ID1].ap);
  T('[7] leftovers next to vv: marked, not kept (V1 counts once), pid table emptied', r.code === 0 && JSON.stringify(r.st.vt) === JSON.stringify({ [ID1]: { [VT(V1, ID1)]: [2, 90] } }) && JSON.stringify(r.st.vv) === '{}' && vt[ID2] === undefined &&
    t.up === 0 && t.down === 1 && JSON.stringify(r.st.votes) === '{}' && (r.st.vpre || []).includes(fb.preVoteTok(v.pid(V1), ID2)), JSON.stringify([r.st.vv, r.st.vt, r.st.votes, r.st.vpre]));
}

console.log('=== report-keys [8] source pins ===');
{
  T('[8] player reports keyed by the lane keys in harvestReports', /const rk = REP_KEYS\.by\(rp\), tk = REP_KEYS\.of\(target\);/.test(SRC) && !/sigPlayer\(s, rk, now\)/.test(SRC) && !/\.ri = \(/.test(SRC));
  T('[8] trust counts co-presence through the pair token (Q209: the edge key itself comes from the pair token)', /if \(met\.has\(e\.pk\)\) n\+\+;/.test(SRC) && /if \(rep\[REP_KEYS\.edge\(repPairTok\(k\), tk\)\]\) n\+\+;/.test(SRC) && /verifiedUniqueReporters\(s, sid, idx\),\s*hostDissentCount\(/.test(SRC));
  //   (Q190 restack: on today's main the tier line carries Q57's host charges as a third argument after this call)
  T('[8] chat lane passes the two lane keys (harvest / plan / auto / queue)', /chatMute\.harvest\(st, rows, CHAT_KEYS\.by, nowUnixMin, CHAT_KEYS\.of\)/.test(SRC) && /chatMute\.plan\(st, boardRows, targets, CHAT_KEYS\.of, nowUnixMin\)/.test(SRC) &&
    /st\.auto\[CHAT_KEYS\.of\(w\.sid\)\]/.test(SRC) && /chatMute\.queueMail\(st, h\.fresh, CHAT_KEYS\.by, nowUnixMin\)/.test(SRC) && /chatMute\.rekeyLegacy\(st, rows, CHAT_KEYS\.by\)/.test(SRC) && !/chatMute\.[a-zA-Z]+\([^)]*\bpid\b[^)]*\)/.test(SRC));
  T('[8] chat harvest keys targets with the target-side function, skips the rows marked at the drop', /const tk = \(tpidOf \|\| pidOf\)\(rep\.target\), pt = pairTok\(pidOf, rk, tk\);/.test(CM_SRC) && /'kv', 'pre'\]\);/.test(CM_SRC) &&
    /if \(pre\.size && pre\.has\(preKey\(pidOf, r\.reporterSid, rep\)\)\) \{ skipped\+\+; continue; \}/.test(CM_SRC));
  T('[8] player reports: the dedup key is one keyed token, the reports marked at the drop are never taken', /const seenKey = REP_KEYS\.seen\(rp, target, reason, mh\);/.test(SRC) && /if \(s\.rseen\[seenKey\] \|\| pre\.has\(seenKey\)\) continue;/.test(SRC));
  // the drops carry no key over: no lane-key function applied to an old entry inside them
  const body = (src, name) => { const i = src.indexOf('function ' + name + '('); const j = src.indexOf('\nfunction ', i + 10); return i < 0 ? '' : src.slice(i, j < 0 ? undefined : j); };
  const bR = body(SRC, 'rekeyReports'), bC = body(CM_SRC, 'rekeyLegacy'), bV = body(FB_SRC, 'rekeyVotes');
  T('[8] the drops carry nothing onto the lane keys (rekeyReports / rekeyLegacy / rekeyVotes)', bR && bC && bV && !/REP_KEYS\.(by|of|pair)\(/.test(bR) && !/sidOf|\.at\b/.test(bR) &&
    !/ofOf|sidOf|byOf\((sid|k|x)/.test(bC) && /pre\.add\(preKey\(byOf, r\.reporterSid, rep\)\)/.test(bC) && !/voterKey\(/.test(bV) && /to\['~' \+ n\] = x;/.test(bV), [bR.length, bC.length, bV.length].join(','));
  T('[8] votes merged under voter / item tokens after the author / unknown-item / pre-fold filter, stored as vt + vv', /const vk = voterKey\(String\(e\.steamID\)\);\s*if \(mergeVotes\(st\.votes, \(key\) => voteTok\(vk, key\), storableVotes\(st\.items, e\.steamID, decoded, pre\)\)\)/.test(FB_SRC) &&
    /return Object\.assign\(\{\}, storedState\(st\), \{ items \}\);/.test(FB_SRC) && /const sv = storedVotes\(s\);\s*if \(sv\) \{ o\.pidVotes = o\.votes; o\.votes = sv; o\.vkv = FB_VOTER_KEYS; \}/.test(FB_SRC) &&
    /vv = \(s && s\.vv && typeof s\.vv === 'object'\) \? s\.vv : null/.test(FB_SRC));
  const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'tools', 'feedback-admin.js'), 'utf8');
  T('[8] the admin console reads vt + vv', /const votes = fb\.storedVotes\(st\) \|\| st\.votes \|\| \{\};/.test(ADMIN) && !/st\.votes \|\| \{\}\)\[id\]/.test(ADMIN));
  const ks = [v.pid(X), BY(X), OF(X), CBY(X), COF(X), VK(X), VT(X, ID1), VT(X, ID2)];
  T('[8] the five lane keys of one account differ from each other and from his pid', new Set(ks).size === ks.length && ks.every(k => /^[0-9a-f]{16}$/.test(k)), JSON.stringify(ks));
}

console.log('=== report-keys [9] player reports after a rollback: leftovers dropped too ===');
{
  // state after the drop and one later run (r2 + the later report), then an older version ran: it keeps the whole signals
  // file (rkv, rpre, the lane-keyed edges) and wrote its own pid-keyed edge / dedup key / per-pid counters next to them
  const s1 = JSON.parse(r2.text.SIGNALS_FILE);
  s1.rep[EDGE(R1, T2)] = { n: 1, m: 2, at: DAY1 + 3600000 };
  s1.rseen[v.REP_KEYS.seen(R1, T2, 1, 222)] = DAY1 + 3600000;
  s1.rep[v.pid(R1) + '>' + v.pid(T2)] = { n: 1, m: 2, at: DAY1 + 7200000 };
  s1.rseen[v.pid(R1) + '|' + v.pid(T2) + '|1|222'] = DAY1 + 7200000;
  s1.players[v.pid(T2)] = { g: 1, w: 0, v: 0, f: 0, ns: 0, disp: [1, 0, 0, 0, 0, 0, 0], s1: 0, s2: 0, smax: 0, at: DAY1, ri: 1 };
  T('[9] the leftovers are seen as pid-keyed state (harvest waits for them to go)', v.repKeysReady(JSON.parse(JSON.stringify(s1))) === false && v.repKeysReady(JSON.parse(r2.text.SIGNALS_FILE)) === true);
  const only = (o) => Object.assign({ day: { d: 0, n: {} }, players: {}, pairs: {}, flagged: {}, rep: {}, rseen: {} }, o);
  T('[9] a per-pid counter alone is pid-keyed state too, before and after the first drop (an edge aged out, the counter not)',
    v.repKeysReady(only({ players: { a: { at: 1, ri: 1 } } })) === false && v.repKeysReady(only({ rkv: v.REP_KEYS_VER, players: { a: { at: 1, ro: 1 } } })) === false &&
    v.repKeysReady(only({ rkv: v.REP_KEYS_VER, players: { a: { at: 1 } } })) === true);
  const later = DAY1 + 3 * 3600000;
  const W9 = { reports: [{ sid: R1, list: [{ t: T1, r: 2, m: 111 }, { t: T2, r: 1, m: 222 }, { t: X, r: 3, m: 333 }] }] };
  const part = runValidate(world(Object.assign({ pad: true }, W9)), { SIGNALS_FILE: s1 }, { FAKE_NOW: String(later), PAGE_CAP: '1' });
  T('[9] partial read: deferred, nothing dropped', part.code === 0 && /harvest deferred until a complete read drops it/.test(part.out) && JSON.stringify(part.sig.rep) === JSON.stringify(s1.rep), tail(part));
  const r = runValidate(world(W9), { SIGNALS_FILE: s1 }, { FAKE_NOW: String(later) });
  const s = r.sig;
  T('[9] complete read: only the leftovers dropped, logged', r.code === 0 && /pid-keyed report state dropped for the lane keys \(Q190\): 3 entr\(ies\) dropped/.test(r.out), tail(r));
  T('[9] the lane-keyed edge and its dedup token kept; the pid-keyed edge, dedup key and counter gone', JSON.stringify(Object.keys(s.rep)) === JSON.stringify([EDGE(R1, T2)]) &&
    JSON.stringify(Object.keys(s.rseen)) === JSON.stringify([v.REP_KEYS.seen(R1, T2, 1, 222)]) && s.players[v.pid(T2)].ri === undefined && pidsIn(JSON.stringify({ rep: s.rep, rseen: s.rseen })).length === 0, JSON.stringify([s.rep, s.rseen]));
  T('[9] the reports on the box now added to the marked list (the one filed meanwhile is not taken)', s.rpre.length === 3 && s.rpre.includes(v.REP_KEYS.seen(R1, X, 3, 333)) && s.rpre.includes(v.REP_KEYS.seen(R1, T1, 2, 111)) &&
    !/reports: \d+ new/.test(r.out) && !s.rep[EDGE(R1, X)] && !s.rep[EDGE(R1, T1)], JSON.stringify(s.rpre) + tail(r));
}

console.log('=== report-keys [10] Q209: a Q190 state moves in place ===');
{
  // a Q190 state (exactly as that version wrote it): edges keyed reporter key '>' target key with the pair token inside,
  // the day's count under the reporter key; chat: watermark, last-row digest and queued digest under the reporter key,
  // reporter sets of reporter keys; votes on voter keys in vv
  const A10 = DAY1 - 3 * 3600000, d = Math.floor(DAY1 / 86400000);
  const q190Signals = () => ({
    rkv: 1,
    day: { d, n: {}, r: { [BY(R1)]: 2, [BY(X)]: 1 } },
    players: {}, flagged: {},
    pairs: { [v.pairKey(v.pid(R1), v.pid(T1))]: { n: 1, t: 0, x: 1, at: A10 }, [v.pairKey(v.pid(X), v.pid(T1))]: { n: 1, t: 0, x: 1, at: A10 }, [v.pairKey(v.pid(R1), v.pid(T2))]: { n: 1, t: 0, x: 1, at: A10 } },
    rep: { [BY(R1) + '>' + OF(T1)]: { n: 1, m: 4, at: A10, pk: v.REP_KEYS.pair(R1, T1) }, [BY(X) + '>' + OF(T1)]: { n: 1, m: 8, at: A10, pk: v.REP_KEYS.pair(X, T1) },
      [BY(R1) + '>' + OF(T2)]: { n: 1, m: 2, at: A10, pk: v.REP_KEYS.pair(R1, T2) } },
    rseen: { [v.REP_KEYS.seen(R1, T1, 2, 111)]: A10, [v.REP_KEYS.seen(X, T1, 3, 5)]: A10, [v.REP_KEYS.seen(R1, T2, 1, 111)]: A10 },
  });
  const row1 = chatRow(R1, DM, T1, 3, R1MS), dec1 = cm.decodeReport(row1.details);
  const f1 = { reporterSid: R1, target: T1, scope: 3, tsMin: dec1.tsMin, text: DM };
  const q190Chat = () => ({ kv: 1, seen: { [CBY(R1)]: dec1.tsMin }, sig: { [CBY(R1)]: CBY(cm.rowKey(dec1)) }, rep: { [COF(T1)]: [[CBY(R1), NOWMIN - 120]] }, auto: {},
    digest: { day: '2026-11-19', at: NOWMIN - 1440 }, pend: { [CBY(R1)]: cm.mailSig(f1, CBY) } });
  const before = q190Signals();
  const vurB = [T1, T2].map(t => v.verifiedUniqueReporters(before, t));
  const W10 = { reports: [{ sid: R1, list: [{ t: T1, r: 2, m: 111 }, { t: T2, r: 1, m: 111 }, { t: X, r: 2, m: 444 }, { t: T9, r: 2, m: 445 }] }, { sid: X, list: [{ t: T1, r: 3, m: 5 }] }],
    chat: [row1] };
  const r = runValidate(world(W10), { SIGNALS_FILE: q190Signals(), CHAT_MUTE_FILE: q190Chat() }, Object.assign({ REPORT_DAILY_CAP: '3' }, MAIL));
  const s = r.sig, c = r.chat;
  T('[10] run ok, both moves logged with their counts', r.code === 0 && /report state moved onto pair-keyed edges and daily slot tokens \(Q209\): 3 edge\(s\), 3 daily slot\(s\)/.test(r.out) &&
    /chat-mute: state moved onto per-row and per-pair tokens \(Q209\): 1 row\(s\), 1 report\(s\), 1 queued/.test(r.out), tail(r));
  T('[10] signals: on the new layout, the three old edges on their edge tokens with their counts and stamps, nothing dropped', s.rkv === v.REP_KEYS_VER && !/dropped for the lane keys/.test(r.out) &&
    JSON.stringify(s.rep[EDGE(R1, T1)]) === JSON.stringify({ n: 1, m: 4, at: A10 }) && JSON.stringify(s.rep[EDGE(X, T1)]) === JSON.stringify({ n: 1, m: 8, at: A10 }) && JSON.stringify(s.rep[EDGE(R1, T2)]) === JSON.stringify({ n: 1, m: 2, at: A10 }), JSON.stringify(s.rep));
  T('[10] the reports taken before are not taken again; of the two new ones of R1 one counted, one over the daily cap (2 + 1 = 3: the cap counts the day as before)',
    /reports: 2 new \(1 counted, 1 over daily cap/.test(r.out) && Object.keys(s.rep).length === 4 && s.rep[EDGE(R1, X)] && s.rep[EDGE(R1, X)].n === 1 && !s.rep[EDGE(R1, T9)], tail(r));
  T('[10] the day\'s count: R1 three slots, X one, no counter under a reporter key', JSON.stringify(s.day.rt) === JSON.stringify([SLOT(R1, 0), SLOT(R1, 1), SLOT(R1, 2), SLOT(X, 0)].sort()) && s.day.r === undefined, JSON.stringify(s.day));
  T('[10] trust counts the same reporters as before the move (T1 two, T2 one)', JSON.stringify([T1, T2].map(t => v.verifiedUniqueReporters(s, t))) === JSON.stringify(vurB) && vurB[0] === 2 && vurB[1] === 1, JSON.stringify(vurB));
  const keys1 = [R1, X, T1, T2].reduce((a, x) => a.concat([BY(x), CBY(x)]), []);
  T('[10] no reporter key left anywhere in either file', keys1.every(k => !r.text.SIGNALS_FILE.includes(k) && !r.text.CHAT_MUTE_FILE.includes(k)));
  T('[10] chat: the row taken before is not taken again (its token found), the reporter set holds the pair token with the old time', !/chat-mute: reports \+/.test(r.out) && c.kv === cm.KEYS_VER &&
    JSON.stringify(Object.keys(c.sig)) === JSON.stringify([CROW(row1)]) && JSON.stringify(c.rep) === JSON.stringify({ [COF(T1)]: [[CPAIR(R1, T1), NOWMIN - 120]] }) && c.seen === undefined, JSON.stringify(c));
  const mail = r.posts.filter(p => /api\.resend\.com/.test(p.url));
  T('[10] chat: the queued row still found when the digest goes out (its text in the mail, nothing missing), the queue emptied', mail.length === 1 && mail[0].body.includes(DM) && /chat reports 2026-11-20: 1 new/.test(mail[0].body) &&
    !/no longer on the report box/.test(mail[0].body) && c.pend === undefined && c.digest.day === '2026-11-20', JSON.stringify(mail) + tail(r));
  const quiet = runValidate(world({}), { SIGNALS_FILE: q190Signals(), CHAT_MUTE_FILE: q190Chat() }, {});
  T('[10] a run with no new report writes the moved state all the same (no reporter key waits in the file for the next report)', quiet.code === 0 && /report state moved onto/.test(quiet.out) &&
    quiet.sig.rkv === v.REP_KEYS_VER && quiet.chat.kv === cm.KEYS_VER && keys1.every(k => !quiet.text.SIGNALS_FILE.includes(k) && !quiet.text.CHAT_MUTE_FILE.includes(k)), tail(quiet));
  const r2b = runValidate(world(W10), { SIGNALS_FILE: r.text.SIGNALS_FILE, CHAT_MUTE_FILE: r.text.CHAT_MUTE_FILE }, Object.assign({ REPORT_DAILY_CAP: '3' }, MAIL));
  T('[10] next run: no second move, nothing new counted, chat row not taken again', r2b.code === 0 && !/moved onto/.test(r2b.out) && /reports: 1 new \(0 counted, 1 over daily cap/.test(r2b.out) && !/chat-mute: reports \+/.test(r2b.out) &&
    JSON.stringify(r2b.sig.rep) === JSON.stringify(s.rep), tail(r2b));
}
{ // votes on Q190 voter keys: moved onto the per-item tokens with the run's write, tallies unchanged, folded votes stay in vv
  const items = f5.st.items;
  // the feed board ids as a run left them, so the move is the only change this run makes (it must still be written)
  const disk = { boards: f5.st.boards, items, digest: { day: '', at: 0 }, votes: {}, vv: { [ID1]: { '~0': [2, 90], [VK(V1)]: [1, 100] }, [ID2]: { [VK(V1)]: [3, 101], [VK(V2)]: [2, 102] } } };
  const tB = [ID1, ID2].map(id => fb.tallyVotes(disk.vv[id], items[id].ap));
  const r = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 1, ts: 100 }, { id: ID2, dir: 3, ts: 101 }] }]), disk, {});
  const vt = fb.storedVotes(r.st) || {}, tA = [ID1, ID2].map(id => fb.tallyVotes(vt[id], items[id].ap));
  T('[10] votes: moved with this run\'s write (logged), on one token per voter and item, the folded vote stays in vv', r.code === 0 && /votes moved onto one token per voter and item \(Q209\): 3 vote\(s\)/.test(r.out) &&
    JSON.stringify(r.st.vv) === JSON.stringify({ [ID1]: { '~0': [2, 90] } }) &&
    JSON.stringify(r.st.vt) === JSON.stringify({ [ID1]: { [VT(V1, ID1)]: [1, 100] }, [ID2]: [[VT(V1, ID2), [3, 101]], [VT(V2, ID2), [2, 102]]].sort().reduce((o, x) => (o[x[0]] = x[1], o), {}) }), JSON.stringify([r.st.vv, r.st.vt]) + r.out.slice(-400));
  T('[10] votes: tallies and the report hold unchanged by the move', JSON.stringify(tA) === JSON.stringify(tB) && fb.reportsSince(vt[ID2], items[ID2].ap, -1) === fb.reportsSince(disk.vv[ID2], items[ID2].ap, -1), JSON.stringify([tB, tA]));
  T('[10] votes: no voter key left in the file', ![V1, V2].some(x => r.text.includes(VK(x))));
  const r2b = runFeedback(fbWorld([{ sid: V1, list: [{ id: ID1, dir: 1, ts: 100 }, { id: ID2, dir: 3, ts: 101 }] }]), r.text, {});
  T('[10] votes: next run reads it back, no second move, no rewrite', r2b.code === 0 && !/moved onto/.test(r2b.out) && r2b.text === r.text, r2b.out.slice(-400));
}

console.log(failN ? 'FAIL ' + failN : 'report-keys: ALL PASS');
process.exit(failN ? 1 : 0);
