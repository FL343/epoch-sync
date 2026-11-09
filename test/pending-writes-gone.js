'use strict';
// O775: the backlog's waiting writes (PENDING_WRITES_FILE: w / wp / xw / cw / rw / ew) of accounts that no longer own the app.
//   Steam answers a board write of such an account (a refund, a trial removed from the library) with HTTP 200 and result 27 --
//   for every board of his (O624). The backlog took it for an ordinary failure: live 2026-11-09 (demo job) 263 waiting writes of
//   139 accounts went out on every run and came back 27 every time (about 75,000 Web API calls and 263 warnings a day, 7 days
//   each, on the publisher key the three channels share). Now a 27 marks the account on his backlog entry (gone = the time, pid
//   keyed, one log line per account a run, no warning): for GONE_RETRY_MS (24 h) his waiting writes stay home -- not folded into
//   a settling run's writes, not retried by a quiet run, still his rows for every reader -- unless a settle of his this run moves
//   a row of his (he played again: the mark goes first, his waiting writes go with the settle's). Past the day they go once more
//   (a 27 marks him again); a write that lands takes the mark away; the fuse (7 days from the first failure, warned) as before;
//   the mark goes with his last waiting write.
// Over the REAL validate.js main() against an offline board stub (the boards carry over from run to run: every landed write
// applied) that answers result 27 for the accounts listed as gone, HTTP 500 for the ones listed as failing:
//   [1] units: GONE_RETRY_MS, goneHolds (no mark / fresh / the edge / past / unreadable / ahead of now), prunePendingWrites with
//       marks (kept with a waiting write, gone with the last one, past the fuse, unreadable; an old entry without a mark as before)
//   [2] the course: G1 / G2 settle a 1V1 while Steam answers 27 for them (their seeded old-format waiting writes go with it):
//       marked, one line each, no warning; three settling runs and a quiet run send nothing to them (F, failing with 500, is
//       retried every run; H / J settle as usual); G1's match only sighted keeps him held; G1 settles again owning the app: his
//       waiting writes (the endless best his match does not write) go with the settle, land, mark and entry gone; a day later G2
//       is tried once (a quiet run) and marked again, then held; another day later once more (a settling run); past 7 days his
//       writes dropped with their warnings, the mark with them
//   [3] the settle results are the same as without O775: every state file byte for byte, the backlog but for the marks and the
//       try counters, every board -- only fewer requests (against the course with nothing held back)
//   [4] mutants: nothing held back / a settle does not clear the mark / no retry after the day / the mark never pruned / a 27
//       never marked
//   [5] wiring pins
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS',
  'SHARD_STRICT_BODY', 'CP_LB', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'SIG_PAIR_WINDOW_MS', 'LEAVER_XP_RECORD_ONLY_UNTIL', 'DISPUTE_FLOOR_DAY_CAP', 'CONSOLATION_XP',
  'CONSOLE_OWED_MAX_MS', 'REDEEM_LB', 'GRANT_LB', 'LP_LAST_HOLD_MS', 'ENDLESS_LB', 'PAGE_CAP', 'CLASSIC_REPACK_CAP', 'CLASSIC_REPACK_EVERY'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };
const eq = (label, got, want) => T(label + ' = ' + JSON.stringify(got), JSON.stringify(got) === JSON.stringify(want), 'EXPECT ' + JSON.stringify(want));

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const XP = 5, RT = 6, PT = 7, CP = 8, EN = 20;
const KEPT = [XP, RT, PT, CP, EN];   // the boards Steam keeps from run to run in this world
// the offline stub: boards from the fixture, every POST logged; STUB_GONE = sids whose SetLeaderboardScore is answered HTTP 200
//   { result: { result: 27 } } (Steam keeps nothing), STUB_F500 = sids whose SetLeaderboardScore is answered HTTP 500
const NOW = Date.now();   // the frozen wall clock of every child run (advance moves the stored instants back instead)
const STUB = [
  "const fs = require('fs');",
  'const FIX = Number(process.env.STUB_NOW || 0);',
  'if (FIX) { const RD = Date; const FD = function (...a) { if (!new.target) return new RD(FIX).toString(); return Reflect.construct(RD, a.length ? a : [FIX], new.target); };',
  '  FD.prototype = RD.prototype; FD.now = () => FIX; FD.parse = RD.parse; FD.UTC = RD.UTC;',
  "  Object.defineProperty(RD.prototype, 'constructor', { value: FD, writable: true, configurable: true }); globalThis.Date = FD; }",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  "const GONE = JSON.parse(process.env.STUB_GONE || '[]'), F500 = JSON.parse(process.env.STUB_F500 || '[]');",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    const sid = (/steamid=([0-9]+)/.exec(body) || [])[1];",
  '    const set = /SetLeaderboardScore/.test(u), gone = set && GONE.indexOf(sid) >= 0, f500 = set && !gone && F500.indexOf(sid) >= 0;',
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body, applied: !gone && !f500, gone, f500 }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) {',
  "      const nm = decodeURIComponent((/(?:^|&)name=([^&]*)/.exec(body) || [])[1] || '');",
  '      const had = FX.boards.find((b) => b.name === nm);',
  '      const id = had ? had.id : nextId++;',
  '      return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } });',
  '    }',
  '    if (gone) return resp({ result: { result: 27 } });',
  "    if (f500) return resp({ error: 'injected' }, 500);",
  '    return resp({ result: { result: 1 } });',
  '  }',
  '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
  '  if (/GetLeaderboardEntries/.test(u)) {',
  '    const bid = /leaderboardid=([0-9]+)/.exec(u)[1], b = byId[bid];',
  '    let ents = b ? b.entries : [];',
  '    const around = /RequestAroundUser/.test(u) ? /steamid=([0-9]+)/.exec(u)[1] : null;',
  '    if (around) ents = ents.filter(e => String(e.steamID) === around);',
  '    const rs = /rangestart=([0-9]+)/.exec(u);',
  '    if (!around && rs && Number(rs[1]) > 1) ents = [];',
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-writes-gone-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json'); fs.writeFileSync(fxPath, JSON.stringify({ boards }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_NOW: String(NOW),   // preseason: points on the base board
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const raw = {};
    for (const k of FILE_VARS) { try { raw[k] = fs.readFileSync(stateEnv[k], 'utf8'); } catch (err) {} }
    const state = {};
    for (const k of Object.keys(raw)) { try { state[k] = JSON.parse(raw[k]); } catch (err) {} }
    if (state.PENDING_WRITES_FILE) { const V807 = require(path.join(__dirname, '..', 'validate.js')); state.PENDING_WRITES_FILE = V807.pwMapNames(state.PENDING_WRITES_FILE, V807.pwOpenName, e.STATE_SALT); }   // O807: board names are sealed on disk
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, raw, summary: fs.readFileSync(sumPath, 'utf8') };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (every stored instant moves back, the marks too)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) {
    if (!st[k] || typeof st[k] !== 'object') continue;
    for (const f of ['t0', 'absentAt', 'pl', 'kt']) if (st[k][f]) st[k][f] -= ms;
    if (k.charAt(0) === '~' && st[k].r) st[k].r -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) {
    const p = sg.players[k];
    if (p.bz) p.bz -= ms;
    if (p.pdk) for (const m of Object.keys(p.pdk)) p.pdk[m] -= ms;
    if (p.cq && p.cq.t) p.cq.t -= ms;
  }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  if (sg && sg.stall) { sg.stall.from -= ms; sg.stall.at -= ms; }
  const gr = files.GROUPS_FILE;
  if (gr) for (const k of Object.keys(gr)) if (gr[k] && gr[k].at) gr[k].at -= ms;
  const so = files.SOLO_FILE;
  if (so && so.wait) for (const k of Object.keys(so.wait)) if (so.wait[k] && so.wait[k].t0) so.wait[k].t0 -= ms;
  if (so && so.ovGone) for (const k of Object.keys(so.ovGone)) so.ovGone[k] -= ms;
  const pw = files.PENDING_WRITES_FILE;
  if (pw) for (const k of Object.keys(pw)) {
    const e = pw[k];
    if (!e || typeof e !== 'object') continue;
    for (const f of ['w', 'wp', 'l', 'xw', 'cw', 'rw']) if (e[f] && e[f].t) e[f].t -= ms;
    if (e.ew) for (const b of Object.keys(e.ew)) if (e.ew[b] && e.ew[b].t) e.ew[b].t -= ms;
    if (Array.isArray(e.rc)) for (const x of e.rc) if (Array.isArray(x)) x[4] -= ms;
    if (e.gone) e.gone -= ms;
  }
  return files;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
function rec(magic, mt, hash, seat, rank, win, ros, sc) {
  const start = magic === 0xB2, pc = ros.length;
  const d = [magic, 3, mt, hash | 0, 1234, seat, start ? 0 : rank, start ? 0 : ((6 << 1) | (win ? 1 : 0)), pc, start ? 0 : 720];
  for (let i = 0; i < pc; i++) d.push(start ? 0 : sc[i] | 0);
  d.push(0);
  for (const s of ros) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const H = SID(7751), J = SID(7752), G1 = SID(7753), G2 = SID(7754), F = SID(7755);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const HON = [7000, 4000];   // seat 0 won 7000 to 4000, both write it
const EW1 = 50003, EW1_ROW = 30001;   // G1's waiting best on endless_board (depth 5) over his row there (depth 3)
// the world: the shard records written so far (they stay up), the boards Steam keeps (score + details hex), who is gone / failing
function world(script) {
  const t0 = NOW;
  const w = { recs: [], b: {}, state: null, log: [], script: script || null, gone: [G1, G2], f500: [F], hn: 0x7750 };
  for (const id of KEPT) w.b[id] = {};
  w.b[XP][F] = { score: 100 }; w.b[PT][G2] = { score: 2500 }; w.b[EN][G1] = { score: EW1_ROW, hex: hexLE([1000, 0]) };
  // old-format waiting writes (no mark): G1's endless best, G2's points write, F's XP write (F fails with 500, not 27)
  w.files = { PENDING_WRITES_FILE: {
    [v.pid(G1)]: { ew: { endless_board: { v: EW1, ts: 3000, bd: 0, t: t0 - HOUR, n: 2 } } },
    [v.pid(G2)]: { w: { b: 'points', v: 2620, d: [], t: t0 - HOUR, n: 2 } },
    [v.pid(F)]: { xw: { b: 'progress', v: 300, t: t0 - HOUR, n: 2 } },
  } };
  return w;
}
function boardsOf(w) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of w.recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, detailData: hexLE(r.d) }); }
  const rows = (bid) => Object.keys(w.b[bid]).map((s) => ({ steamID: s, score: w.b[bid][s].score | 0, detailData: w.b[bid][s].hex || '' }));
  boards.push({ id: XP, name: 'progress', entries: rows(XP) }, { id: CP, name: 'cp_bank', entries: rows(CP) }, { id: 9, name: 'trust_tier', entries: [] },
    { id: RT, name: 'rating', entries: rows(RT) }, { id: PT, name: 'points', entries: rows(PT) }, { id: EN, name: 'endless_board', entries: rows(EN) });
  return boards;
}
const bodyHex = (body) => { const m = /(?:^|&)details=((?:%[0-9a-f]{2})+)/i.exec(body); return m ? m[1].split('%').filter(Boolean).join('') : ''; };
function step(w, ms) {
  if (w.state && w.state.__failed) return null;
  const files = w.state ? advance(w.state, ms) : w.files;
  const r = runCron(boardsOf(w), files, { STUB_GONE: JSON.stringify(w.gone), STUB_F500: JSON.stringify(w.f500) }, w.script);
  w.log.push(r);
  if (r.code !== 0) { w.state = { __failed: true }; return r; }
  w.state = r.state;
  for (const p of r.posts) {   // the boards as Steam keeps them: every write that landed (ForceUpdate, absolute; details replaced)
    if (!/SetLeaderboardScore/.test(p.url) || !p.applied) continue;
    const bid = (/leaderboardid=([0-9]+)/.exec(p.body) || [])[1];
    if (!w.b[bid]) continue;
    w.b[bid][/steamid=([0-9]+)/.exec(p.body)[1]] = { score: Number(/score=(-?[0-9]+)/.exec(p.body)[1]), hex: bodyHex(p.body) };
  }
  return r;
}
// the records of a quick 1V1 put up at once: the run that first reads them only sights it (it settles on the next one)
function matchUp(w, a, b) {
  const h = ++w.hn, two = [a, b];
  w.recs.push({ sid: a, d: rec(0xB2, 1, h, 0, 0, false, two, null) }, { sid: b, d: rec(0xB2, 1, h, 1, 0, false, two, null) },
    { sid: a, d: rec(0xB1, 1, h, 0, 1, true, two, HON) }, { sid: b, d: rec(0xB1, 1, h, 1, 2, false, two, HON) });
}
const setTo = (r, sid) => r ? r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && new RegExp('steamid=' + sid + '(&|$)').test(p.body))
  .map((p) => ({ b: Number((/leaderboardid=([0-9]+)/.exec(p.body) || [])[1]), s: Number((/score=(-?[0-9]+)/.exec(p.body) || [])[1]) })) : null;
const boardsTo = (r, sid) => (setTo(r, sid) || []).map((x) => x.b).sort((a, b) => a - b);
const pend = (r, s) => ((((r && r.state) || {}).PENDING_WRITES_FILE) || {})[v.pid(s)] || null;
const pk = (r, s) => pend(r, s) || {};   // his entry, {} when he has none
const warn27 = (r, sid) => r.out.split('\n').filter((l) => /^::warning::/.test(l) && (l.indexOf(v.pid(sid).slice(0, 8)) >= 0) && !/dropped after/.test(l));
const markLines = (r) => r.out.split('\n').filter((l) => /: a board write answered result 27 \(no longer owns the app\) -- his waiting writes are not sent for 24 h unless a settle of his comes first \(O775\)/.test(l));
const sumO775 = (r) => { const m = /\| backlog writes answered result 27 \(the account no longer owns the app\): accounts marked this run \/ waiting writes not sent \(they go a day after the last 27, or with a settle of his\) \/ marks cleared by a settle of his \(O775\) \| ([^|]*) \|/.exec(r.summary); return m ? m[1].trim() : null; };
const heldLine = (r) => r.out.split('\n').filter((l) => /^backlog: [0-9]+ waiting write\(s\) of [0-9]+ account\(s\) not sent/.test(l)).map((l) => (/^backlog: ([0-9]+) waiting write\(s\) of ([0-9]+) account/.exec(l) || []).slice(1).join('/'));
const fine = (w) => w.log.length > 0 && w.log.every((r) => r.code === 0);

// the course of [2] (12 runs): r0 / r1 the 1V1 of G1 and G2 and the one of H and J (r1 settles both, Steam answers 27 for G1 / G2),
//   r2 / r3 another H-J 1V1 sighted / settled, r4 quiet, r5 G1 owns the app again and his 1V1 with H is sighted, r6 settled,
//   r7 a day later (quiet), r8 quiet, r9 another day later (an H-J 1V1 sighted: a settling run), r10 it settles, r11 past 7 days
function course(script) {
  const w = world(script);
  // r0 / r1
  const h1 = ++w.hn, h2 = ++w.hn;
  w.recs.push({ sid: G1, d: rec(0xB2, 1, h1, 0, 0, false, [G1, G2], null) }, { sid: G2, d: rec(0xB2, 1, h1, 1, 0, false, [G1, G2], null) },
    { sid: H, d: rec(0xB2, 1, h2, 0, 0, false, [H, J], null) }, { sid: J, d: rec(0xB2, 1, h2, 1, 0, false, [H, J], null) });
  step(w, 0);
  w.recs.push({ sid: G1, d: rec(0xB1, 1, h1, 0, 1, true, [G1, G2], HON) }, { sid: G2, d: rec(0xB1, 1, h1, 1, 2, false, [G1, G2], HON) },
    { sid: H, d: rec(0xB1, 1, h2, 0, 1, true, [H, J], HON) }, { sid: J, d: rec(0xB1, 1, h2, 1, 2, false, [H, J], HON) });
  step(w, 10 * MIN);
  matchUp(w, J, H); step(w, 5 * MIN); step(w, 5 * MIN);   // r2 sighted / r3 settled
  step(w, 5 * MIN);                                       // r4 quiet
  w.gone = [G2];                                          // G1 owns the app again (a trial added back, a purchase)
  matchUp(w, G1, H); step(w, 5 * MIN); step(w, 5 * MIN);  // r5 sighted / r6 settled
  step(w, DAY + MIN);                                     // r7 a day later, quiet
  step(w, 5 * MIN);                                       // r8 quiet
  matchUp(w, H, J); step(w, DAY + MIN); step(w, 5 * MIN); // r9 another day later, sighted (a settling run) / r10 settled
  step(w, 7 * DAY);                                       // r11 past the fuse
  return w;
}
const MARK8 = '0 / 8 / 0', HELD8 = ['8/2'];   // a run that holds back G1's four waiting writes (ew, rw, xw, cw) and G2's four (w, rw, xw, cw)

// ---- [1] units ----
{
  const now = Date.parse('2026-11-09T12:00:00Z'), R = v.GONE_RETRY_MS, D7 = 7 * DAY;
  eq('[1] GONE_RETRY_MS = one day; the fuse stays 7 days; the waiting writes a mark holds back', [R, v.PENDING_W_MAX_MS, v.PENDING_W_FIELDS], [DAY, D7, ['w', 'wp', 'xw', 'cw', 'rw', 'ew']]);
  eq('[1] goneHolds: no entry / no mark / a fresh mark / 1 ms inside the day / the day\'s edge / unreadable / ahead of now',
    [v.goneHolds(null, now), v.goneHolds({ xw: {} }, now), v.goneHolds({ gone: now }, now), v.goneHolds({ gone: now - R + 1 }, now), v.goneHolds({ gone: now - R }, now),
      v.goneHolds({ gone: 'x' }, now), v.goneHolds({ gone: now + 1000 }, now)],
    [false, false, true, true, false, false, false]);
  const live = { b: 'progress', v: 450, t: now - 1000, n: 1 };
  const s = {
    a: { xw: Object.assign({}, live), gone: now - 1000 },                                  // a waiting write: kept, mark too
    b: { gone: now - 1000 },                                                               // nothing to hold back: the entry goes
    c: { rc: [[2, 0, 32, 0, now - 1000]], gone: now - 1000 },                              // queued receipts are not a waiting write
    d: { cw: { b: 'cp_bank', v: 20, t: now - 1000, n: 1 }, gone: now - D7 - 1 },           // a mark past the fuse goes, the write stays
    e: { xw: { b: 'progress', v: 9, t: now - D7 - 1, n: 7 }, gone: now - 1000 },           // its last write dropped by the fuse: the mark with it
    f: { ew: { endless_board: { v: 50003, ts: 3000, t: now - 1000, n: 1 } }, gone: 'junk' }, // an unreadable mark goes
    g: { w: { b: 'points', v: 2620, d: [], t: now - 1000, n: 1 } },                        // a file written before O775: as it was
  };
  const r = v.prunePendingWrites(s, now);
  eq('[1] prunePendingWrites with marks: kept with a waiting write / the entry gone with nothing to hold / gone beside receipts only / past the fuse / with the last write dropped / unreadable; an old entry unchanged',
    [r.writes, s], [1, { a: { xw: live, gone: now - 1000 }, c: { rc: [[2, 0, 32, 0, now - 1000]] }, d: { cw: { b: 'cp_bank', v: 20, t: now - 1000, n: 1 } },
      f: { ew: { endless_board: { v: 50003, ts: 3000, t: now - 1000, n: 1 } } }, g: { w: { b: 'points', v: 2620, d: [], t: now - 1000, n: 1 } } }]);
}

// ---- [2] the course ----
const ref = course();
const L = ref.log;
T('[2] (the course ran: 12 runs, every one exit 0)', fine(ref) && L.length === 12, L.map((r) => r.code).join(','));
if (fine(ref) && L.length === 12) {
  // r0: a quiet run (starts only) reads the old-format file and retries the waiting writes it can name: each answered 27
  eq('[2] r0 (quiet, a file without marks): G1\'s waiting best and G2\'s waiting points sent once, both answered 27 -> marked (pid-keyed, no steamID in the file)',
    [setTo(L[0], G1), setTo(L[0], G2), !!pk(L[0], G1).gone, !!pk(L[0], G2).gone, [G1, G2].some((x) => JSON.stringify(L[0].state.PENDING_WRITES_FILE).includes(x))],
    [[{ b: EN, s: EW1 }], [{ b: PT, s: 2620 }], true, true, false]);
  eq('[2] r0: one line per account, no warning, the summary counts them', [markLines(L[0]).length, warn27(L[0], G1).length + warn27(L[0], G2).length, sumO775(L[0])], [2, 0, '2 / 0 / 0']);
  // r1: both settle their 1V1 (Steam still answers 27): the settle clears the marks first, their waiting writes go with it
  eq('[2] r1 (G1 / G2 settle): the marks cleared by the settle, their waiting writes sent with its writes (G1: rating, XP, CP + the waiting best; G2: rating, points, XP, CP)',
    [boardsTo(L[1], G1).filter((b) => KEPT.indexOf(b) >= 0), boardsTo(L[1], G2), sumO775(L[1])], [[XP, RT, CP, EN], [XP, RT, PT, CP], '2 / 0 / 2']);
  eq('[2] r1: every write answered 27 -> marked again, one line per account, no warning for them (F\'s 500 is still warned: an ordinary failure)',
    [!!pk(L[1], G1).gone, !!pk(L[1], G2).gone, markLines(L[1]).length, warn27(L[1], G1).length + warn27(L[1], G2).length, warn27(L[1], F).length > 0], [true, true, 2, 0, true]);
  eq('[2] r1: the failed writes wait as before (G1: ew rw xw cw, G2: w rw xw cw)', [Object.keys(pk(L[1], G1)).sort(), Object.keys(pk(L[1], G2)).sort()],
    [['cw', 'ew', 'gone', 'rw', 'xw'], ['cw', 'gone', 'rw', 'w', 'xw']]);
  // r2-r5: held back
  eq('[2] r2-r5 (two settling runs, a quiet run, a run sighting G1\'s next 1V1): nothing sent to G1 / G2', [2, 3, 4, 5].map((i) => [setTo(L[i], G1).length, setTo(L[i], G2).length]), [[0, 0], [0, 0], [0, 0], [0, 0]]);
  eq('[2] r2-r5: the summary counts the eight writes held back, one line a run', [2, 3, 4, 5].map((i) => [sumO775(L[i]), heldLine(L[i])]), [2, 3, 4, 5].map(() => [MARK8, HELD8]));
  eq('[2] r2-r5: the others as before -- F (500) retried by every settling run, H / J settle (r3 writes H\'s XP / rating / CP)', [[2, 3, 4, 5].map((i) => setTo(L[i], F).length), boardsTo(L[3], H)], [[1, 1, 0, 1], [XP, RT, CP]]);
  eq('[2] r2-r5: the waiting writes stay as they were (value, first failure, tries)', [pk(L[5], G1).xw, pk(L[5], G2).w].map((x) => x && [x.v, x.n]), [[450, 1], [2620, 4]]);
  // r6: G1 owns the app again and settles: his waiting writes go with it and land
  //   (CP: his first settle in r1 found no wallet row -> the one-shot starter CP (O789 (1), every channel) + 20; that write
  //   answered 27 and waited as 60 + 20 -- laid back in here, he is not seeded a second time: + 20 = 100)
  const CP6 = v.PT_SEED_CP + 20 + 20;
  eq('[2] r6 (G1 settles, owns the app again): the mark cleared, his waiting best (not a board his 1V1 writes) sent with his rating / XP / CP -- XP and CP counted on the waiting 450 / starter ' + v.PT_SEED_CP + ' + 20 (no second seed)',
    [setTo(L[6], G1), sumO775(L[6]), heldLine(L[6])], [[{ b: RT, s: ref.b[RT][G1].score }, { b: XP, s: 765 }, { b: CP, s: CP6 }, { b: EN, s: EW1 }], '0 / 4 / 1', ['4/1']]);
  eq('[2] r6: everything landed -- his entry gone (mark and writes), the boards hold them', [pend(L[6], G1), ref.b[EN][G1].score, ref.b[XP][G1].score, ref.b[CP][G1].score], [null, EW1, 765, CP6]);
  // r7-r10: G2, a day after each 27
  eq('[2] r7 (a day later, quiet): G2 tried once -- the first retry answered 27 marks him again, his other waiting writes stay home with it', [setTo(L[7], G2), sumO775(L[7]), !!pk(L[7], G2).gone], [[{ b: PT, s: 2620 }], '1 / 3 / 0', true]);
  eq('[2] r8: held again', [setTo(L[8], G2), sumO775(L[8])], [[], '0 / 4 / 0']);
  eq('[2] r9 (another day later, a settling run): his four waiting writes folded into its writes once more, answered 27, marked again',
    [boardsTo(L[9], G2), sumO775(L[9]), Object.keys(pk(L[9], G2)).sort()], [[XP, RT, PT, CP], '1 / 0 / 0', ['cw', 'gone', 'rw', 'w', 'xw']]);
  eq('[2] r10: held again', [setTo(L[10], G2), sumO775(L[10])], [[], '0 / 4 / 0']);
  eq('[2] r2-r10: requests to G1 / G2 = only the runs of [2] above (r6: 4, r7: 1, r9: 4)', [2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => setTo(L[i], G1).length + setTo(L[i], G2).length), [0, 0, 0, 0, 4, 1, 0, 4, 0]);
  // r11: past the fuse
  const out11 = L[11].out;
  eq('[2] r11 (7 days on): G2\'s writes dropped by the fuse with their warnings as before, the mark with them (no entry left)',
    [['points write of ', 'xp write of ', 'cp write of ', 'rating write of '].map((p) => new RegExp('::warning::' + p + v.pid(G2).slice(0, 8) + ' dropped after [0-9]+ failed tries over 7 days').test(out11)), pend(L[11], G2)],
    [[true, true, true, true], null]);
}

// ---- [3] the settle results are those of the course with nothing held back ----
const MUT = {
  // nothing held back: every waiting write goes on every run, as before O775 (the sends of before; the marks are only written)
  noHold: ['    if (!goneHolds(lpBacklog[k], nowMs)) return false;\n', '    return false;\n'],
  // a settle does not clear the mark: a player back with a settle sends only his new writes
  noBack: ['      delete e.gone; if (!Object.keys(e).length) delete lpBacklog[k]; backlogDirty = true; n++;\n', '      continue;\n'],
  // no try after the day: held for good (until the fuse)
  noRetry: ['const GONE_RETRY_MS = 24 * 3600 * 1000;', 'const GONE_RETRY_MS = 1e15;'],
  // the mark never pruned
  noPrune: ['      if (!(t > 0) || now - t > PENDING_W_MAX_MS || !PENDING_W_FIELDS.some((f) => e[f] != null)) delete e.gone;\n', '      void t;\n'],
  // a 27 never marks
  noMark: ['    e.gone = nowMs; backlogDirty = true;\n', '    backlogDirty = true;\n'],
};
let mutN = 0;
const mutPaths = [];
function withMut(key, fn) {
  const [from, to] = MUT[key];
  const n = SRC.split(from).length - 1;
  if (n !== 1) { failN++; console.log('  FAIL  [4] mutant ' + key + ': anchor found ' + n + ' times'); return; }
  const script = path.join(__dirname, '..', '.mutant-pending-writes-gone-' + process.pid + '-' + (++mutN) + '.js');
  mutPaths.push(script);
  fs.writeFileSync(script, SRC.split(from).join(to));
  try { fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
}
const strip = (pw) => JSON.stringify(pw || {}, (k, x) => (k === 'gone' || k === 'n') ? undefined : x);
withMut('noHold', (s) => {
  const m = course(s), M = m.log;
  T('[3] (the course with nothing held back ran)', fine(m) && M.length === 12, M.map((r) => r.code).join(','));
  if (!(fine(m) && M.length === 12 && fine(ref) && L.length === 12)) return;
  const other = [...new Set([].concat(...L.map((r) => Object.keys(r.raw))))].filter((k) => k !== 'PENDING_WRITES_FILE').sort();
  const diff = [], diffB = [];
  // r5 (G1 owns the app again, his 1V1 only sighted): without O775 his waiting writes went out on that run and landed; with it they
  //   wait for his settle (r6) -- the one backlog difference, his entry, left out of the comparison of r5 and pinned on its own
  const sansG1 = (pw) => { const o = Object.assign({}, pw || {}); delete o[v.pid(G1)]; return o; };
  for (let i = 0; i < 12; i++) {
    for (const k of new Set(Object.keys(L[i].raw).concat(Object.keys(M[i].raw)))) if (k !== 'PENDING_WRITES_FILE' && L[i].raw[k] !== M[i].raw[k]) diff.push('r' + i + ' ' + k);
    const a = L[i].state.PENDING_WRITES_FILE, b = M[i].state.PENDING_WRITES_FILE;
    if (strip(i === 5 ? sansG1(a) : a) !== strip(i === 5 ? sansG1(b) : b)) diffB.push('r' + i);
  }
  T('[3] the settle\'s state files of every run byte for byte the same (' + other.join(', ') + ')', other.length >= 5 && diff.length === 0, diff.slice(0, 8).join(', '));
  T('[3] the backlog of every run the same but for the marks and the try counters', diffB.length === 0, diffB.join(', '));
  eq('[3] r5, the one backlog difference: G1 owning the app again, his waiting writes landed on the next retry before O775 / wait for his settle (r6) with it',
    [Object.keys(pk(M[5], G1)), Object.keys(pk(L[5], G1)).sort()], [[], ['cw', 'ew', 'gone', 'rw', 'xw']]);
  eq('[3] every board Steam keeps the same at the end (rating, XP, points, CP, endless best)', KEPT.map((b) => JSON.stringify(ref.b[b]) === JSON.stringify(m.b[b])), KEPT.map(() => true));
  const sets = (log, who) => log.map((r) => r.posts.filter((p) => /SetLeaderboardScore/.test(p.url) && (who ? new RegExp('steamid=(' + who.join('|') + ')(&|$)').test(p.body) : true)).map((p) => p.body).join('\n'));
  eq('[3] the requests for everybody else the same run by run (H, J, F)', JSON.stringify(sets(L, [H, J, F])) === JSON.stringify(sets(M, [H, J, F])), true);
  const nG = (log) => log.reduce((a, r) => a + setTo(r, G1).length + setTo(r, G2).length, 0);
  T('[3] only fewer requests to G1 / G2 (12 runs: ' + nG(L) + ' with O775, ' + nG(M) + ' with nothing held back)', nG(L) < nG(M));
  T('[3] (the course with nothing held back sends the waiting writes every run: r2-r5 to G1 / G2)', [2, 3, 4, 5].every((i) => setTo(M[i], G1).length + setTo(M[i], G2).length > 0));
});

// ---- [4] mutants ----
withMut('noHold', (s) => { const m = course(s); T('[4] mutant noHold: G1 / G2 sent their waiting writes again in r2-r4 -> caught', fine(m) && [2, 3, 4].every((i) => setTo(m.log[i], G1).length + setTo(m.log[i], G2).length > 0)); });
withMut('noBack', (s) => {
  const m = course(s);
  T('[4] mutant noBack: r6 G1 settles, his waiting best not sent with it (still waiting after the run) -> caught',
    fine(m) && !setTo(m.log[6], G1).some((x) => x.b === EN) && !!(pend(m.log[6], G1) || {}).ew);
});
withMut('noRetry', (s) => { const m = course(s); T('[4] mutant noRetry: G2 never tried after the day (r7 / r9 send nothing) -> caught', fine(m) && setTo(m.log[7], G2).length === 0 && setTo(m.log[9], G2).length === 0); });
withMut('noPrune', (s) => { const m = course(s); T('[4] mutant noPrune: after the fuse G2\'s entry is left with the mark alone -> caught', fine(m) && JSON.stringify(Object.keys(pend(m.log[11], G2) || {})) === '["gone"]'); });
withMut('noMark', (s) => { const m = course(s); T('[4] mutant noMark: nobody marked, G1 / G2 sent again on r2 -> caught', fine(m) && !pk(m.log[1], G1).gone && setTo(m.log[2], G1).length + setTo(m.log[2], G2).length > 0); });
T('[4] (every mutant file removed)', mutPaths.length === 6 && !mutPaths.some((f) => fs.existsSync(f)));

// ---- [5] wiring pins ----
{
  const cnt = (re) => (SRC.match(re) || []).length;
  const i0 = SRC.indexOf('  const wRating = await mapPool(ratingSids, '), i1 = SRC.indexOf("  if (backlogDirty) savePendingWrites(lpBacklog, nowMs, true);   // Q319: the endless bests that wait");
  const phase = SRC.slice(i0, i1);
  eq('[5] every settle write of a backlog board hands a failure to wroteGone before its warning (18 writers), none warns a 27 itself',
    [i0 > 0 && i1 > i0, (phase.match(/if \(!okFlag && !wroteGone\(sid, res\)\) ghWarn\('write /g) || []).length, (phase.match(/if \(!okFlag\) ghWarn\(/g) || []).length], [true, 18, 0]);
  T('[5] the retries ask goneHeld before they send, and hand a failure to wroteGone (points, last season\'s points, XP / CP / rating, endless best)',
    /if \(!pw\) continue;\n      if \(goneHeld\(sid, 'w'\)\) continue;/.test(SRC) && /if \(!sid \|\| !lpPrevWaiting\(sid\)\) continue;\n      if \(goneHeld\(sid, 'wp'\)\) continue;/.test(SRC)
    && /if \(goneHeld\(sid, f\)\) continue;/.test(SRC) && /if \(!sid \|\| !bid\) continue;\n        if \(goneHeld\(sid, 'ew\|' \+ name\)\) continue;/.test(SRC)
    && /if \(!landed && !wroteGone\(sid, r\)\) ghWarn\(ROW_NAME\[f\]/.test(SRC) && /if \(!landed && !wroteGone\(sid, r\)\) ghWarn\('endless best write retry/.test(SRC)
    && /if \(!ok\) \{ lpLastDrop\(sid\); wroteGone\(sid, res\); \}/.test(SRC) && /why = wroteGone\(sid, res\) \?/.test(SRC));
  const iBack = SRC.indexOf('  goneBack([changedLp, changedXp, changedCp, changed].concat(ebBoards.map((d) => d.pool)), careerTouched);'),
    iHold = SRC.indexOf("  goneHoldList(lpRetrySids, 'w', changedLp); goneHoldList(xpRetrySids, 'xw', changedXp); goneHoldList(cpRetrySids, 'cw', changedCp);"),
    iFold = SRC.indexOf('  for (const sid of lpRetrySids) { const pw = lpWaiting(sid);'), iRate = SRC.indexOf("  for (const sid of goneHoldList(rowPendingSids('rw', ratingSids), 'rw', changed)) {"),
    iLay = SRC.indexOf("  for (const sid of Object.keys(changedXp)) rowLayAhead('xw', sid, changedXp[sid] | 0);");
  T('[5] the settle: a settle of his clears the mark, then the folds leave out the ones still held (points / XP / CP, rating), before anything is laid ahead',
    iBack > 0 && iHold > iBack && iFold > iHold && iRate > iFold && iLay > iRate);
  T('[5] ebLay: a held account keeps the waiting best as his row, set aside (not in the pool) for goneBack', /if \(goneHeld\(sid, 'ew\|' \+ d\.name\)\) \{ ebHeld\.push\(\{ d, k, sid, ent \}\); return; \}\n    d\.pool\[sid\] = ent; ebLaidEnts\.add\(ent\);/.test(SRC));
  T('[5] a landed write clears the mark (points, last season\'s points, XP / CP / rating, endless best)', cnt(/goneClear\(sid\);   \/\/ O775/g) === 4 && /if \(landed\) \{\n      goneClear\(sid\);   \/\/ O775\n      rowWrote/.test(SRC));
  eq('[5] the summary row and the header', [cnt(/marks cleared by a settle of his \(O775\) \| ' \+ s\('wGone', 0\) \+ ' \/ ' \+ s\('wHeld', 0\) \+ ' \/ ' \+ s\('wBack', 0\)/g), /\/\/   gone: the time \(ms\) Steam last answered a board write of his with result 27 \(O775;/.test(SRC)], [1, true]);
}

console.log(failN ? '=== FAIL -- ' + failN + ' fail (pending-writes-gone) ===' : '=== PASS -- 0 fail (pending-writes-gone) ===');
process.exit(failN ? 1 : 0);
