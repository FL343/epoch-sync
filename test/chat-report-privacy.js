'use strict';
// Chat reports never reach a committed state file (audit Q186, 2026-10-11). The reconcile commits its state files to
// this PUBLIC repository every tick (validate.yml / playtest.yml / demo.yml persist steps); git history keeps them
// forever. The chat lane used to queue the raw harvested rows (reporter SteamID, target SteamID, report text --
// private messages included) under chat-mute.json `pendingMail`: forever on a channel without a mail channel, until
// the next day's digest on the main channel. Now the queue holds keyed digests only and the digest reads the rows
// back from the report box. Pinned end-to-end over the REAL validate.js main() against an offline board stub:
//   [1] no mail channel (playtest / demo shape): reports harvested, every written file free of raw ids and text,
//       nothing queued; same with PT_MODE on, and with ledger records in the same run (every writer, not just chat)
//   [2] mail channel, first tick of the day: the private mail carries text + ids; the files carry neither
//   [3] mail channel, digest already sent today: keyed queue only; the next day's tick mails the rows read back from
//       the report box even though no new report arrived
//   [4] mail send fails: keyed queue kept, retried next tick, files clean throughout
//   [5] the reporter replaces the row before the digest: newer text mailed, the older one counted, never stored
//   [6] legacy state holding the raw queue (`pendingMail`): scrubbed on the first run (moved to the keyed queue with a
//       mail channel, dropped without one)
//   [7] publicState whitelist + queue helpers (cap, keyed digest)
//   [8] source pins
// State isolation is structural (every *_FILE var redirected, cwd = temp dir): the whole temp dir is scanned, so a new
// state file that some later change writes is scanned too.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS', 'CONSOLATION_XP', 'REPORT_LB', 'TRUST_LB', 'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY',
  'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SHARD_STRICT_BODY', 'FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_DIGEST_TAG', 'CHAT_MUTE_LB', 'CHAT_REPORT_LB'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const cm = require(path.join(__dirname, '..', 'chat-mute.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub + pinned clock (FAKE_NOW); the mail endpoint answers STUB_MAIL_STATUS (default 200)
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
  "    if (/api\\.resend\\.com/.test(u)) { const st = Number(process.env.STUB_MAIL_STATUS || 200); return resp({ id: 'm' }, st); }",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const b = byId[/leaderboardid=([0-9]+)/.exec(u)[1]];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  '    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || \'\' })) } });',
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');

// client packReport mirror (same layout as mvp/src/systems/chat-report.js; test/chat-mute.js carries the same mirror)
function fnv1a32(s) { let h = 0x811c9dc5 >>> 0; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h | 0; }
function pack(text, targetSid, scope, tsMin, enc) {
  const bytes = enc === 1 ? Buffer.from(text, 'utf16le') : Buffer.from(text, 'utf8');
  const b = BigInt(targetSid);
  const w0 = ((cm.CHAT_MUTE.MAGIC & 0xFF) | ((cm.CHAT_MUTE.VER & 0xFF) << 8) | ((scope & 0xFF) << 16) | ((enc & 0xFF) << 24)) | 0;
  const words = [w0, bytes.length | 0, Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0, tsMin | 0, fnv1a32(text)];
  for (let i = 0; i < bytes.length; i++) { const wi = 6 + (i >> 2); if (words.length <= wi) words.push(0); words[wi] = (words[wi] | (bytes[i] << ((i & 3) * 8))) | 0; }
  return words;
}

const DAY1 = Date.UTC(2026, 10, 20, 9, 0), DAY2 = DAY1 + 24 * 3600000;   // 2026-11-20 09:00Z, next day 09:00Z
const tsOf = (ms) => Math.floor((ms - cm.CHAT_MUTE.EPOCH0) / 60000);
const R1 = '76561198000000101', R2 = '76561198000000102', R3 = '76561198000000103';
const T1 = '76561198000009001', T2 = '76561198000009002';
const DM = 'private dm line 4711 meet me at the usual place';
const GL = 'global chat line kappa 0815';
const U16 = 'ruchat Привет приватный текст 2222';
const NEWER = 'newer report replaces the older one 3333';
const REPORT_BOX = 50, MUTE_BOX = 51;
// report rows: [{ sid, text, target, scope, ms, enc }]
function reportBoard(rows) {
  return { id: REPORT_BOX, name: 'chat_report_box', entries: rows.map(r => ({ steamID: r.sid, score: tsOf(r.ms), details: pack(r.text, r.target, r.scope, tsOf(r.ms), r.enc | 0) })) };
}
function world(reportRows, extra) {
  const boards = [];
  for (let i = 0; i < 8; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  boards.push(reportBoard(reportRows), { id: MUTE_BOX, name: 'chat_mute', entries: [] });
  return boards.concat(extra || []);
}
const MAIL = { FB_DIGEST_TO: 'owner@example.invalid', RESEND_API_KEY: 'mail-key' };

function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-privacy-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateDir = path.join(dir, 'state'); fs.mkdirSync(stateDir);
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(stateDir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', XP_LB: 'progress', STATE_SALT: 's', RANKED_LB: 'rating', LP_LB: 'points',
      SEASON_NOW: '2026-11-20T00:00:00Z', FAKE_NOW: String(DAY1),
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0',
      LEDGER_SHARDS: '8', READ_RETRY_MS: '0',
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: stateDir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    // every file the run left in its working dir = everything a persist step could commit
    const written = {};
    for (const f of fs.readdirSync(stateDir)) written[f] = fs.readFileSync(path.join(stateDir, f), 'utf8');
    const mails = posts.filter(p => /api\.resend\.com/.test(p.url)).map(p => JSON.parse(p.body));
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, written, mails, chat: state.CHAT_MUTE_FILE || {} };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const RAW_SID = /7656119\d{10}/;
const SECRETS = [R1, R2, R3, T1, T2, DM, GL, U16, NEWER, 'private dm line', 'Привет'];
// the tripwire itself: no raw SteamID (any 7656119xxxxxxxxxx) and no report text in any written file or in the log
function clean(r) {
  const hits = [];
  if (r.code !== 0) hits.push('run exit ' + r.code + ' (a failed run proves nothing): ' + r.out.slice(-200));
  for (const f of Object.keys(r.written)) {
    const t = r.written[f];
    if (RAW_SID.test(t)) hits.push(f + ': raw SteamID');
    for (const s of SECRETS) if (t.includes(s) || t.includes(JSON.stringify(s).slice(1, -1))) hits.push(f + ': ' + s.slice(0, 16));
  }
  if (RAW_SID.test(r.out)) hits.push('log: raw SteamID');
  for (const s of SECRETS.slice(5)) if (r.out.includes(s)) hits.push('log: ' + s.slice(0, 16));
  return hits;
}
const tail = (r) => r.out.slice(-600);
const pendN = (r) => Object.keys(r.chat.pend || {}).length;
const seenN = (r) => Object.keys(r.chat.seen || {}).length;

const rowsBase = [
  { sid: R1, text: DM, target: T1, scope: 3, ms: DAY1 - 30 * 60000 },
  { sid: R2, text: GL, target: T1, scope: 1, ms: DAY1 - 20 * 60000 },
  { sid: R3, text: U16, target: T2, scope: 2, ms: DAY1 - 10 * 60000, enc: 1 },
];

console.log('=== chat-report-privacy [1] no mail channel ===');
{
  const r = runCron(world(rowsBase), null, {});
  T('[1] run ok and the lane harvested all three reports (not a vacuous pass)', r.code === 0 && seenN(r) === 3 && /chat-mute: reports \+3/.test(r.out), tail(r));
  T('[1] every written file + the log: no raw SteamID, no report text', clean(r).length === 0, clean(r).join(' | '));
  T('[1] nothing queued without a mail channel (no pend, no pendingMail)', r.chat.pend === undefined && r.chat.pendingMail === undefined && r.chat.pendLost === undefined, JSON.stringify(r.chat));
  T('[1] no mail sent', r.mails.length === 0);
  const pt = runCron(world(rowsBase), null, { PT_MODE: '1' });
  T('[1] PT_MODE (playtest / demo job): harvested, files clean, nothing queued', pt.code === 0 && seenN(pt) === 3 && clean(pt).length === 0 && pt.chat.pend === undefined, clean(pt).join(' | ') + ' ' + tail(pt));
  // ledger records in the same run: every state writer runs (processed / starts / leavers / confessions / xp ...)
  const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
  const rec = (magic, mt, hash, seat, sids, disp) => {
    const settle = magic === 0xB1, pc = sids.length;
    const d = [magic, settle ? 3 : 1, mt, hash | 0, 1234, seat, settle ? seat + 1 : 0, settle ? ((6 << 1) | (seat === 0 ? 1 : 0)) : 0, pc, settle ? 720 : 0];
    for (let i = 0; i < pc; i++) d.push(settle ? 9000 - 4000 * i : 0);
    d.push(disp | 0);
    for (const s of sids) { const p = sidPair(s); d.push(p[0], p[1]); }
    return d;
  };
  const w = world(rowsBase, [{ id: 5, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
  const sids = [R1, T1];
  w[0].entries.push({ steamID: R1, score: 1, details: rec(0xB1, 1, 0x5101, 0, sids) });
  w[1].entries.push({ steamID: T1, score: 1, details: rec(0xB1, 1, 0x5101, 1, sids) });
  w[2].entries.push({ steamID: R2, score: 1, details: rec(0xB2, 1, 0x5202, 0, [R2, T2]) });
  w[3].entries.push({ steamID: R3, score: 1, details: rec(0xB5, 1, 0x5303, 0, [R3, T2], 5) });
  const lr = runCron(w, null, { PT_MODE: '1' });
  const nState = Object.keys(lr.written).filter(f => !/^(stub|fx|post)/.test(f)).length;
  T('[1] with ledger records too: every written state file clean (' + nState + ' files)', lr.code === 0 && nState >= 3 && clean(lr).length === 0, clean(lr).join(' | ') + ' ' + tail(lr));
}

console.log('=== chat-report-privacy [2] mail channel, first tick of the day ===');
{
  const r = runCron(world(rowsBase), null, MAIL);
  const m = r.mails[0] || { text: '' };
  T('[2] one private mail with all three texts and the raw ids (the private path works)', r.mails.length === 1 && [DM, GL, U16, R1, R2, R3, T1, T2].every(s => m.text.includes(s)), m.text.slice(0, 300));
  T('[2] subject counts 3', /chat reports 2026-11-20: 3 new/.test(m.subject || ''), m.subject);
  T('[2] files + log clean', clean(r).length === 0, clean(r).join(' | '));
  T('[2] queue empty after the send, digest day marked', r.chat.pend === undefined && r.chat.digest && r.chat.digest.day === '2026-11-20', JSON.stringify(r.chat));
}

console.log('=== chat-report-privacy [3] mail channel, digest already sent today ===');
{
  const sent = { seen: {}, rep: {}, auto: {}, digest: { day: '2026-11-20', at: Math.floor(DAY1 / 60000) - 120 } };
  const r1 = runCron(world(rowsBase), { CHAT_MUTE_FILE: sent }, MAIL);
  T('[3] run 1: no mail (already sent today), three keyed entries queued', r1.mails.length === 0 && pendN(r1) === 3, JSON.stringify(r1.chat.pend));
  T('[3] run 1: queue entries are 16-hex keyed digests, keyed by the reporter\'s lane key (Q190: not his pid)', Object.keys(r1.chat.pend || {}).every(k => /^[0-9a-f]{16}$/.test(k) && /^[0-9a-f]{16}$/.test(r1.chat.pend[k])) && (r1.chat.pend || {})[v.CHAT_KEYS.by(R1)] !== undefined && (r1.chat.pend || {})[v.pid(R1)] === undefined);
  T('[3] run 1: files + log clean', clean(r1).length === 0, clean(r1).join(' | '));
  // next day, the board unchanged, no new report: the queue still goes out (read back from the report box)
  const r2 = runCron(world(rowsBase), { CHAT_MUTE_FILE: r1.chat }, Object.assign({ FAKE_NOW: String(DAY2) }, MAIL));
  const m = r2.mails[0] || { text: '' };
  T('[3] run 2 (next day, no new report): mail sent with the three rows read back from the report box', r2.mails.length === 1 && [DM, GL, U16, R1, T2].every(s => m.text.includes(s)) && /3 new/.test(m.subject || ''), (m.subject || '') + ' ' + tail(r2));
  T('[3] run 2: queue cleared, files clean', r2.chat.pend === undefined && clean(r2).length === 0, clean(r2).join(' | '));
}

console.log('=== chat-report-privacy [4] mail send fails ===');
{
  const r1 = runCron(world(rowsBase), null, Object.assign({ STUB_MAIL_STATUS: '500' }, MAIL));
  T('[4] run 1: send attempted and failed, queue kept (keyed), files + log clean', r1.mails.length === 1 && pendN(r1) === 3 && /digest send failed HTTP 500/.test(r1.out) && clean(r1).length === 0, clean(r1).join(' | ') + ' ' + tail(r1));
  const r2 = runCron(world(rowsBase), { CHAT_MUTE_FILE: r1.chat }, Object.assign({ FAKE_NOW: String(DAY1 + 5 * 60000) }, MAIL));
  const m = r2.mails[0] || { text: '' };
  T('[4] run 2 (5 min later, no new report): retried and sent, queue cleared', r2.mails.length === 1 && m.text.includes(DM) && r2.chat.pend === undefined && clean(r2).length === 0, tail(r2));
}

console.log('=== chat-report-privacy [5] the reporter replaces the row before the digest ===');
{
  const sent = { seen: {}, rep: {}, auto: {}, digest: { day: '2026-11-20', at: Math.floor(DAY1 / 60000) - 120 } };
  const r1 = runCron(world(rowsBase), { CHAT_MUTE_FILE: sent }, MAIL);
  const rows2 = rowsBase.map(x => x.sid === R1 ? { sid: R1, text: NEWER, target: T2, scope: 1, ms: DAY1 + 10 * 60000 } : x);
  const r2 = runCron(world(rows2), { CHAT_MUTE_FILE: r1.chat }, Object.assign({ FAKE_NOW: String(DAY1 + 15 * 60000) }, MAIL));
  T('[5] run 2 (same day): the newer row replaces the queued one, one replaced counted, files clean', r2.mails.length === 0 && pendN(r2) === 3 && (r2.chat.pendLost | 0) === 1 && clean(r2).length === 0, JSON.stringify(r2.chat.pend) + ' ' + clean(r2).join(' | '));
  const r3 = runCron(world(rows2), { CHAT_MUTE_FILE: r2.chat }, Object.assign({ FAKE_NOW: String(DAY2) }, MAIL));
  const m = r3.mails[0] || { text: '' };
  T('[5] run 3 (next day): mail has the newer text, not the replaced one, and says one earlier snapshot is gone', r3.mails.length === 1 && m.text.includes(NEWER) && !m.text.includes(DM) && /\+1 earlier snapshot/.test(m.text), m.text.slice(0, 300));
  T('[5] run 3: queue + counter cleared, files clean', r3.chat.pend === undefined && r3.chat.pendLost === undefined && clean(r3).length === 0);
}

console.log('=== chat-report-privacy [6] legacy raw queue in the state file ===');
{
  const legacy = { seen: {}, rep: {}, auto: {}, digest: { day: '2026-11-20', at: Math.floor(DAY1 / 60000) - 120 },
    pendingMail: [{ reporterSid: R1, target: T1, scope: 3, tsMin: tsOf(rowsBase[0].ms), text: DM }, { reporterSid: '76561198000000999', target: T1, scope: 1, tsMin: 5, text: 'gone row' }] };
  const off = runCron(world([]), { CHAT_MUTE_FILE: Object.assign({ pend: { [v.pid(R2)]: 'abcdef0123456789' }, pendLost: 2 }, legacy) }, {});
  T('[6] no mail channel: the raw queue (and a keyed queue left from a mail channel) dropped on the first run, files clean', off.chat.pendingMail === undefined && off.chat.pend === undefined && off.chat.pendLost === undefined && clean(off).length === 0, JSON.stringify(off.chat));
  const on = runCron(world(rowsBase.slice(0, 1)), { CHAT_MUTE_FILE: legacy }, MAIL);
  T('[6] mail channel, digest already sent today: the raw queue becomes two keyed entries, files clean', on.mails.length === 0 && on.chat.pendingMail === undefined && pendN(on) === 2 && clean(on).length === 0, JSON.stringify(on.chat));
  const on2 = runCron(world(rowsBase.slice(0, 1)), { CHAT_MUTE_FILE: on.chat }, Object.assign({ FAKE_NOW: String(DAY2) }, MAIL));
  const m = on2.mails[0] || { text: '' };
  T('[6] next day: the legacy row still on the report box is mailed, the vanished one counted', on2.mails.length === 1 && m.text.includes(DM) && /1 new/.test(m.subject || '') && /\+1 earlier snapshot/.test(m.text) && clean(on2).length === 0, (m.subject || '') + ' ' + m.text.slice(0, 200));
}

console.log('=== chat-report-privacy [7] helpers ===');
{
  const st = { seen: { a: 1 }, rep: {}, auto: {}, pendingMail: [{ reporterSid: R1, text: DM }], foo: R1, pend: { x: 'y' } };
  const pub = cm.publicState(st);
  T('[7] publicState keeps the whitelisted keys only (drops pendingMail and anything unknown)', JSON.stringify(pub) === JSON.stringify({ seen: { a: 1 }, rep: {}, auto: {}, pend: { x: 'y' } }), JSON.stringify(pub));
  T('[7] whitelist pinned', JSON.stringify(cm.PUBLIC_KEYS) === JSON.stringify(['seen', 'sig', 'rep', 'auto', 'digest', 'pend', 'pendLost', 'kv', 'pre']));
  T('[7] untouched state serializes exactly as before (no spurious commit of the live files)', JSON.stringify(cm.publicState({ seen: {}, rep: {}, auto: {} })) === '{"seen":{},"rep":{},"auto":{}}');
  const f = { reporterSid: R1, target: T1, scope: 3, tsMin: 7, text: DM };
  T('[7] mailSig is keyed: the same row under another salt gives another digest', cm.mailSig(f, v.pid) !== cm.mailSig(f, (s) => require('crypto').createHmac('sha256', 'other').update(String(s)).digest('hex').slice(0, 16)));
  const q = {};
  const many = Array.from({ length: cm.PEND_MAX + 5 }, (_, i) => ({ reporterSid: String(76561198000100000n + BigInt(i)), target: T1, scope: 1, tsMin: i, text: 't' + i }));
  cm.queueMail(q, many, v.pid);
  T('[7] queue capped at PEND_MAX, overflow counted', Object.keys(q.pend).length === cm.PEND_MAX && q.pendLost === 5);
  const q2 = {};
  cm.queueMail(q2, [{ reporterSid: 'nope', target: T1, scope: 1, tsMin: 1, text: 'x' }, null], v.pid);
  T('[7] implausible reporter / null rows are not queued', q2.pend === undefined);
  T('[7] mailSig covers the text (same target / scope / minute, other words = other digest)', cm.mailSig(f, v.pid) !== cm.mailSig(Object.assign({}, f, { text: DM + '!' }), v.pid));
  // the digest shows a queued row only while the report box still holds THAT row: a row the harvest never took
  // (here a self-report written over the queued one) is not mailed in its place, it is counted as gone
  const q3 = {};
  cm.queueMail(q3, [f], v.pid);
  const self = { reporterSid: R1, det: pack('self report written over the queued row', R1, 1, 8, 0) };
  const back = cm.pendingRows(q3, [self], v.pid);
  T('[7] pendingRows matches the digest, not just the reporter (replaced row = missing, not mailed)', back.found.length === 0 && back.missing === 1);
  const same = cm.pendingRows(q3, [{ reporterSid: R1, det: pack(DM, T1, 3, 7, 0) }], v.pid);
  T('[7] pendingRows finds the queued row while it is still on the box', same.found.length === 1 && same.found[0].text === DM && same.missing === 0);
}

console.log('=== chat-report-privacy [8] source pins ===');
{
  T('[8] saveChatMute writes publicState only', /function saveChatMute\(st\)[^\n]*JSON\.stringify\(chatMute\.publicState\(st\)\)/.test(SRC));
  T('[8] nothing assigns a raw row queue to the state any more', !/st\.pendingMail\s*=/.test(SRC) && !/pendingMail\b[^\n]*concat/.test(SRC));
  T('[8] the digest reads the rows back from the report box and only after a complete read', /chatMute\.pendingRows\(st, rows, CHAT_KEYS\.by\)/.test(SRC) && /rb\.complete && \(dg\.day !== day/.test(SRC));
  T('[8] legacy raw queue scrubbed on every run before the mail branch', /chatMute\.scrubLegacy\(st, CHAT_KEYS\.by, mailOn\);\s*\n\s*if \(!mailOn\) \{ delete st\.pend; delete st\.pendLost; \}/.test(SRC));
}

console.log(failN ? ('\nFAIL ' + failN) : '\nchat-report-privacy: ALL PASS');
process.exit(failN ? 1 : 0);
