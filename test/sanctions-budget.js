'use strict';
// test/sanctions-budget.js -- a sanctions run stops on its own time budget (cloud audit Q117, 2026-10-10).
//
// Each sanctions job has a 10-minute timeout. A run the timeout kills never saves its cursor (and the persist step
// after it is skipped), so the next run fetches the same events again. A full ban reads the account's row on every
// display board, so a burst of sanctions used to make every run die at the same place: the cursor never moved again,
// and every killed run reported the accounts it had already handled to Steam once more. sanctions.js now stops taking
// new work after SN_SOFT_MS, stops an event still in flight between two board steps after SN_HARD_MS, and only moves
// the cursor past an event once that event is fully enforced.
//
// The runs below drive the real main() against an in-memory EOS sync stream + Steam leaderboard service (global.fetch
// replaced; no network, no secrets) on a simulated clock: every HTTP call costs simulated time, and a run whose clock
// passes the job limit is KILLED -- its state file is thrown away, exactly as the persist step never runs after a
// timeout. Board writes already sent stay (Steam keeps them). Scenarios:
//   A  a burst of 40 full bans: runs stop between events, never get killed, the cursor always sits on the last fully
//      enforced event, and every account is enforced and reported to Steam exactly once in the end;
//   B  one ban so slow it cannot finish in one run: the run stops between two boards, keeps the cursor, and the next
//      runs finish it (no row lost, none doubled, one platform report); B2 the same for an unban;
//   C  a burst plus a pile of lapsed temporary bans: the expiry sweep waits while events are behind, then clears all;
//   D  the sweep alone with more lapsed rows than one run can restore: it stops between rows and the next run goes on;
//   E  an ordinary run (a few events, fast) behaves exactly as before: everything in one run, sweep included;
//   F  the sweep has one lapsed account whose restore alone crosses the hard deadline: the gate row outlives the stop;
//   G  a page of skipped events still moves the cursor;
//   H  the O198 trust event of an enforced event is queued exactly once, also when the event was stopped midway and
//      re-run by a later run (it is queued with the cursor move, never before the enforcement);
// plus the deadline defaults against the workflow timeout, and mutations of sanctions.js that each turn a check red.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-budget-'));
const STATE = path.join(TMP, 'sanctions.json');
process.env.SN_STATE_FILE = STATE;
process.env.STATE_SALT = process.env.STATE_SALT || 'testsalt';
process.env.APPID = process.env.APPID || '480';
process.env.STEAM_PUBLISHER_KEY = process.env.STEAM_PUBLISHER_KEY || 'testkey';
process.env.EOS_TRUSTED_CLIENT_ID = 'cid';
process.env.EOS_TRUSTED_CLIENT_SECRET = 'csec';
process.env.EOS_DEPLOYMENT_ID = 'dep';
process.env.READ_RETRY_MS = '0';
process.env.BAN_APPIDS = '4815320';   // count platform reports: each account must be reported exactly once
for (const k of ['EXILE_BOARDS', 'RESEND_API_KEY', 'SN_MAIL_TO', 'FB_DIGEST_TO', 'SN_SOFT_MS', 'SN_HARD_MS', 'SN_EVENT_CAP', 'EOS_BASE', 'BAN_LB']) delete process.env[k];
// The four board names that reach this job only through secrets (sanctions.yml hands them over as validate.yml does):
//   set as in test/sanctions-boards.js, so a full ban here walks the whole derived exile list a production job walks
//   (24 boards before season 1, 35 in season 1, 46 from season 2 on) and no run warns about an unnamed board.
const SECRET_NAMES = { LB_PREFIX: 'lb_rec_', RANKED_LB: 'rating_hidden', LP_LB: 'lp_ladder', XP_LB: 'xp_ladder' };
for (const [k, n] of Object.entries(SECRET_NAMES)) process.env[k] = n;
// the reconcile's trust ledger (read-only here; its cursor prunes the queue): a path that does not exist keeps every
//   queued event in the state file, so the checks below see all of them
process.env.TRUST_FILE = path.join(TMP, 'trust.json');

const ROOT = path.join(__dirname, '..');
const v = require('../validate.js');
const s = require('../sanctions.js');
const SSRC = fs.readFileSync(path.join(ROOT, 'sanctions.js'), 'utf8');
const pidOf = (sid) => require('crypto').createHmac('sha256', String(process.env.STATE_SALT)).update(String(sid)).digest('hex').slice(0, 16);

let pass = 0;
function ok(name, cond) { assert.ok(cond, name); pass++; console.log('  ok    ' + name); }

// Job model: the job timeout is 10 minutes; checkout + the test step take well under a minute before `node
// sanctions.js` starts, so a run is killed once its own clock passes 9 minutes.
const JOB_KILL_MS = 9 * 60 * 1000;
const SOURCES = s.exileSources(v.seasonAt(v.seasonNowMs()), []);   // the boards a full ban walks today (season-aware)
const N = SOURCES.length;
const sidOf = (i) => '7656119800' + String(1000000 + i);
const puidOf = (i) => 'puid' + String(i).padStart(4, '0');
const refOf = (i) => '3541ba63-4006-4141-9240-' + String(i).padStart(12, '0');
const logOf = (i) => 'log-' + String(i).padStart(4, '0');

class Killed extends Error { constructor() { super('job killed by the timeout'); this.name = 'Killed'; } }

// ---- the fake world: an EOS sync stream + a Steam leaderboard / cheat-reporting service ----
function world(cost, batch) {
  const BATCH = batch || 10;   // events per sync answer (the server picks; the real size is not documented)
  const boards = new Map(), byId = new Map();
  let nextId = 5000;
  const events = [], puidSid = {}, reports = [];
  const clock = { t: 0, start: 0, killed: false };
  const make = (name) => { const b = { id: nextId++, name, rows: new Map() }; boards.set(name, b); byId.set(String(b.id), b); return b; };
  const resp = (status, body) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
  };
  const form = (body) => {
    const out = {};
    for (const kv of String(body || '').split('&')) {
      const i = kv.indexOf('=');
      if (i < 0) continue;
      const k = kv.slice(0, i), val = kv.slice(i + 1);
      out[k] = k === 'details' ? val : decodeURIComponent(val);
    }
    return out;
  };
  const pctToHex = (p) => String(p || '').split('%').filter(Boolean).map(x => x.toLowerCase()).join('');
  async function fetchImpl(url, init) {
    if (clock.killed) throw new Killed();
    const u = String(url);
    clock.t += cost(u);
    if (clock.t - clock.start >= JOB_KILL_MS) { clock.killed = true; throw new Killed(); }
    const qs = u.indexOf('?') >= 0 ? new URLSearchParams(u.slice(u.indexOf('?') + 1)) : new URLSearchParams('');
    const q = Object.fromEntries(qs);
    if (/\/auth\/v1\/oauth\/token/.test(u)) return resp(200, { access_token: 'tok' });
    if (/\/sanctions\/v1\/sync/.test(u)) {
      const last = q.lastLogId || '';
      const at = last ? events.findIndex(e => e.logId === last) : -1;
      if (last && at < 0) return resp(400, { errorCode: 'bad cursor' });
      return resp(200, { elements: events.slice(at + 1, at + 1 + BATCH) });
    }
    if (/\/user\/v1\/product-users/.test(u)) {
      const productUsers = {};
      for (const p of qs.getAll('productUserId')) if (puidSid[p]) productUsers[p] = { accounts: [{ identityProviderId: 'steam', accountId: puidSid[p] }] };
      return resp(200, { productUsers });
    }
    if (/GetLeaderboardsForGame/.test(u)) return resp(200, { response: { leaderboards: [...boards.values()].map(b => ({ id: b.id, name: b.name, entries: b.rows.size })) } });
    if (/GetLeaderboardEntries/.test(u)) {
      const b = byId.get(String(q.leaderboardid));
      if (!b) return resp(400, 'no such board');
      const all = [...b.rows.entries()].map(([sid, r]) => ({ steamID: sid, score: r.score, detailData: r.detailData }));
      return resp(200, { leaderboardEntryInformation: { leaderboardEntries: q.datarequest === 'RequestAroundUser' ? all.filter(e => e.steamID === String(q.steamid)) : all } });
    }
    const f = form(init && init.body);
    if (/FindOrCreateLeaderboard/.test(u)) {
      let b = boards.get(f.name);
      if (!b && String(f.createifnotfound) === '1') b = make(f.name);
      if (!b) return resp(200, { result: { result: 9 } });
      return resp(200, { result: { result: 1, leaderboard: { leaderBoardID: b.id, leaderboardname: b.name } } });
    }
    if (/SetLeaderboardScore/.test(u)) {
      const b = byId.get(String(f.leaderboardid));
      if (!b) return resp(400, 'no such board');
      b.rows.set(String(f.steamid), { score: Number(f.score) | 0, detailData: pctToHex(f.details) });
      return resp(200, { result: { result: 1 } });
    }
    if (/DeleteLeaderboardScore/.test(u)) {
      const b = byId.get(String(f.leaderboardid));
      if (b) b.rows.delete(String(f.steamid));
      return resp(200, { result: { result: 1 } });
    }
    if (/ReportPlayerCheating/.test(u)) { reports.push(String(f.steamid)); return resp(200, { response: { reportid: String(reports.length) } }); }
    if (/RequestPlayerGameBan|RemovePlayerGameBan/.test(u)) return resp(200, { response: {} });
    return resp(404, 'unexpected ' + u);
  }
  const w = {
    boards, events, puidSid, reports, clock, make,
    board: (name) => boards.get(name) || make(name),
    row: (name, sid) => { const b = boards.get(name); return b ? b.rows.get(String(sid)) || null : null; },
    put(name, sid, score, det) { w.board(name).rows.set(String(sid), { score, detailData: det ? v.encodeDetails(det) : '' }); },
    addBan(i, extra) {
      puidSid[puidOf(i)] = sidOf(i);
      events.push(Object.assign({ logId: logOf(i), eventType: 1, productUserId: puidOf(i), action: 'RESTRICT_GAME_ACCESS', pending: false, referenceId: refOf(i) }, extra || {}));
    },
    install() { global.fetch = fetchImpl; },
  };
  w.board('ban_board');
  for (const n of SOURCES) w.board(n);   // every display board exists on this app (no by-name lookups needed)
  return w;
}

// One scheduled run = one process: the repo's committed state file goes in, main() runs on the simulated clock, and
// the file comes back out only if the run was not killed and did not fail (the persist step is skipped otherwise).
async function runOnce(mod, w, committed) {
  if (committed == null) { try { fs.unlinkSync(STATE); } catch (e) {} } else fs.writeFileSync(STATE, committed);
  w.clock.start = w.clock.t; w.clock.killed = false;
  w.install();
  const budget = mod.runBudget ? mod.runBudget(() => w.clock.t - w.clock.start) : null;
  const logs = [], log0 = console.log, warn0 = v.ghWarn;
  console.log = (...a) => logs.push(a.join(' '));
  v.ghWarn = (m) => logs.push('::warning::' + m);
  let res = null, err = null;
  try { res = await mod.main(budget ? { budget } : undefined); } catch (e) { err = e; } finally { console.log = log0; v.ghWarn = warn0; }
  const killed = w.clock.killed;
  if (w.afterRun) w.afterRun();
  const out = (killed || err) ? committed : (fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : committed);
  return { killed, err: killed ? null : err, res, committed: out, elapsed: w.clock.t - w.clock.start, logs };
}
const cursorOf = (committed) => { try { return JSON.parse(committed).lastLogId || ''; } catch (e) { return ''; } };
const queueOf = (committed) => { try { return JSON.parse(committed).events || []; } catch (e) { return []; } };   // O198 trust event queue
async function runUntil(mod, w, maxRuns, done) {
  const runs = [];
  let committed = null;
  for (let k = 0; k < maxRuns; k++) {
    const r = await runOnce(mod, w, committed);
    committed = r.committed;
    r.cursor = cursorOf(committed);
    runs.push(r);
    if (done(r)) break;
  }
  return runs;
}

// account i fully enforced: gate row, no row left on its source boards, every row on the shadow byte-exact
function enforced(w, i, homes) {
  if (!w.row('ban_board', sidOf(i))) return false;
  return homes(i).every(n => !w.row(n, sidOf(i)) && (w.row(n + '_banned', sidOf(i)) || {}).score === 100 + i &&
    w.row(n + '_banned', sidOf(i)).detailData === v.encodeDetails([7, i, -3]));
}
function untouched(w, i, homes) {
  return !w.row('ban_board', sidOf(i)) && homes(i).every(n => (w.row(n, sidOf(i)) || {}).score === 100 + i && !w.row(n + '_banned', sidOf(i)));
}

// ---- A: a burst of 40 full bans, about 30 s each (per-call cost scaled by the board count, so the scenario reads the
//      same in every season: a full ban here = gate write + one read per display board + 3 moves + 1 platform report) ----
const COST_A = Math.round(30000 / (N + 9));
const homesA = (i) => [SOURCES[i % N], SOURCES[(i + 7) % N], SOURCES[(i + 13) % N]];
function worldA(cost, batch) {
  const w = world(cost || (() => COST_A), batch);
  for (let i = 0; i < 40; i++) { w.addBan(i); for (const n of homesA(i)) w.put(n, sidOf(i), 100 + i, [7, i, -3]); }
  return w;
}

// ---- B: one ban on every display board, each call slow enough that the ban takes ~600 s on its own ----
const homesB = () => SOURCES.slice();
function worldB() {
  const per = Math.ceil(600000 / (1 + 3 * N));
  const w = world(() => per);
  w.addBan(0);
  for (const n of homesB()) w.put(n, sidOf(0), 100, [7, 0, -3]);
  return w;
}

// ---- B2: the same for an unban (rows parked on every shadow) ----
function worldB2() {
  const per = Math.ceil(600000 / (1 + 3 * N));
  const w = world(() => per);
  w.addBan(0, { eventType: 3 });
  w.put('ban_board', sidOf(0), 1, s.banDetails(0, s.ACT_FULL, refOf(0)));
  for (const n of homesB()) w.put(n + '_banned', sidOf(0), 100, [7, 0, -3]);
  return w;
}
const restoredB2 = (w) => !w.row('ban_board', sidOf(0)) &&
  homesB().every(n => (w.row(n, sidOf(0)) || {}).score === 100 && w.row(n, sidOf(0)).detailData === v.encodeDetails([7, 0, -3]) && !w.row(n + '_banned', sidOf(0)));

// ---- C / D: lapsed temporary bans (gate row expired, rows parked on the shadows); an unban here is about 26 s ----
const COST_D = Math.round(26000 / (N + 6));
function addLapsed(w, j) {
  const sid = '7656119900' + String(1000000 + j);
  const nowMin = Math.floor(Date.now() / 60000);
  w.put('ban_board', sid, 1, s.banDetails(nowMin - 10, s.ACT_FULL, ''));
  const homes = [SOURCES[j % N], SOURCES[(j + 5) % N]];
  for (const n of homes) w.put(n + '_banned', sid, 900 + j, [9, j]);
  return { sid, homes };
}
const restoredLapsed = (w, L) => !w.row('ban_board', L.sid) && L.homes.every(n => (w.row(n, L.sid) || {}).score === 900 + Number(L.sid.slice(-3)) && !w.row(n + '_banned', L.sid));

// ---- F: one lapsed temporary ban parked on every shadow, each call slow enough that its restore alone takes ~600 s
//      (past the 450 s hard deadline, inside one more run). fGateAfter / fParkedAfter record the board state right after
//      each run (filled by runOnce's caller below) ----
const SID_F = '76561199001000777';
const fGateAfter = [], fParkedAfter = [];
function worldF() {
  const per = Math.ceil(600000 / (1 + 3 * N));
  const w = world(() => per);
  const nowMin = Math.floor(Date.now() / 60000);
  w.put('ban_board', SID_F, 1, s.banDetails(nowMin - 10, s.ACT_FULL, ''));
  for (const n of homesB()) w.put(n + '_banned', SID_F, 777, [7, 7, 7]);
  w.afterRun = () => { fGateAfter.push(!!w.row('ban_board', SID_F)); fParkedAfter.push(homesB().filter(n => w.row(n + '_banned', SID_F)).length); };
  return w;
}
const restoredF = (w) => !w.row('ban_board', SID_F) &&
  homesB().every(n => (w.row(n, SID_F) || {}).score === 777 && w.row(n, SID_F).detailData === v.encodeDetails([7, 7, 7]) && !w.row(n + '_banned', SID_F));

// ---- G (review Q117, rework 1): a whole sync page of events that are all skipped (pending / no linked steam account)
//      must still move the cursor, or every run fetches the same page again and the line stalls ----
function worldG(kind) {
  const w = world(() => 50);
  for (let i = 0; i < 10; i++) {
    if (kind === 'pending') w.events.push({ logId: logOf(i), eventType: 1, productUserId: puidOf(i), action: 'RESTRICT_GAME_ACCESS', pending: true, referenceId: refOf(i) });
    else w.events.push({ logId: logOf(i), eventType: 1, productUserId: puidOf(i), action: 'RESTRICT_GAME_ACCESS', pending: false, referenceId: refOf(i) });   // no puidSid entry = no linked steam account
  }
  return w;
}
async function runG(mod, kind) {
  const w = worldG(kind);
  const r1 = await runOnce(mod, w, null);
  const r2 = await runOnce(mod, w, r1.committed);
  return { r1, r2, c1: cursorOf(r1.committed) };
}

(async () => {
  // ---- deadlines vs the workflow timeout ----
  {
    ok('defaults: no new work after 6 minutes, an in-flight event stops after 7.5 minutes', s.SN_SOFT_MS === 360000 && s.SN_HARD_MS === 450000);
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'sanctions.yml'), 'utf8');
    const jobs = (wf.match(/run: node sanctions\.js/g) || []).length;
    const tmo = [...wf.matchAll(/timeout-minutes:\s*(\d+)/g)].map(m => Number(m[1]));
    ok('sanctions.yml: every job running sanctions.js has a timeout, and the hard deadline leaves 2.5 minutes of it for the steps around the run',
      jobs >= 3 && tmo.length >= jobs && tmo.every(m => s.SN_HARD_MS + 150000 <= m * 60000));
    ok('sanctions.yml does not override the deadlines (if it ever does, this check has to read the override)', !/SN_SOFT_MS|SN_HARD_MS/.test(wf));
    ok('the runs below walk the full derived exile list (every secret-only display board named, season twins in): ' + N + ' boards',
      s.unnamedKeys().length === 0 && SOURCES.indexOf(SECRET_NAMES.XP_LB) >= 0 && SOURCES.indexOf(SECRET_NAMES.LP_LB) >= 0 && N >= 24);
    let t = 0;
    const b = s.runBudget(() => t, 100, 50);
    ok('runBudget: the hard deadline is never earlier than the soft one', b.soft === 100 && b.hard === 100);
    const b2 = s.runBudget(() => t, 100, 200);
    t = 99; let threw = null;
    try { b2.checkHard('x'); } catch (e) { threw = e; }
    const before = !b2.softPassed() && !threw;
    t = 150; try { b2.checkHard('x'); } catch (e) { threw = e; }
    const mid = b2.softPassed() && !threw;
    t = 200; try { b2.checkHard('exile'); } catch (e) { threw = e; }
    ok('runBudget: soft passes at its deadline, checkHard throws a BudgetStop only from the hard deadline on',
      before && mid && threw instanceof s.BudgetStop && /exile stopped at 0s/.test(threw.message));
  }

  // ---- A ----
  {
    const w = worldA();
    const runs = await runUntil(s, w, 15, r => r.cursor === logOf(39) || r.killed);
    ok('A: no run is ever killed by the job timeout', runs.every(r => !r.killed && !r.err));
    ok('A: the first run stops on the time budget, between two events, with work left', runs[0].res && runs[0].res.stop === 'soft' && runs[0].res.processed > 0 && runs[0].res.processed < 40);
    ok('A: a run that stops says so in a warning (the backlog shows in the run log)', runs[0].logs.some(l => /::warning::sanctions: time budget reached/.test(l)) && runs[0].logs.some(l => /expiry sweep deferred/.test(l)));
    ok('A: every run ends before the job limit', runs.every(r => r.elapsed < JOB_KILL_MS));
    ok('A: no event is ever stopped midway in a burst of ordinary bans (runs stop between events)', runs.every(r => r.res && r.res.stop !== 'hard'));
    let consistent = true, total = 0;
    for (const r of runs) total += r.res.processed;
    const last = runs[runs.length - 1];
    for (let i = 0; i < 40; i++) if (!enforced(w, i, homesA)) consistent = false;
    ok('A: the burst drains within a few runs: cursor on the last event, all 40 accounts enforced byte-exact', last.cursor === logOf(39) && consistent && runs.length <= 8);
    ok('A: each account is enforced once and reported to Steam once (no re-run of a finished event)', total === 40 && w.reports.length === 40 && new Set(w.reports).size === 40);
  }
  // A, run by run: the committed cursor never runs ahead of the board state, and never lags it
  {
    const w = worldA();
    let committed = null, good = true, steps = 0;
    for (let k = 0; k < 15; k++) {
      const r = await runOnce(s, w, committed);
      committed = r.committed;
      const cur = cursorOf(committed);
      const n = cur ? Number(cur.slice(4)) + 1 : 0;
      for (let i = 0; i < 40; i++) if (i < n ? !enforced(w, i, homesA) : !untouched(w, i, homesA)) good = false;
      steps++;
      if (cur === logOf(39)) break;
    }
    ok('A: after every run, the accounts up to the cursor are enforced and the ones after it are untouched', good && steps > 1);
  }

  // ---- B ----
  {
    const w = worldB();
    const runs = await runUntil(s, w, 6, r => r.cursor === logOf(0) || r.killed);
    ok('B: no run is ever killed, though the ban alone outlasts the job limit', runs.every(r => !r.killed && !r.err));
    ok('B: the first run stops the ban between two boards and keeps the cursor before it',
      runs[0].res.stop === 'hard' && runs[0].cursor === '' && runs[0].logs.some(l => /re-runs from the top next time/.test(l)) &&
      SOURCES.some(n => w.boards.get(n + '_banned')) && runs.length > 1);
    ok('B: a later run finishes it: cursor past the event, every row on its shadow byte-exact, sources empty, gate row set',
      runs[runs.length - 1].cursor === logOf(0) && enforced(w, 0, homesB));
    ok('B: the account is reported to Steam exactly once (platform bans run only when the board moves are done)', w.reports.length === 1);
  }

  // ---- B2 ----
  {
    const w = worldB2();
    const runs = await runUntil(s, w, 6, r => r.cursor === logOf(0) || r.killed);
    ok('B2: a slow unban is stopped between two shadows, keeps the cursor, and a later run finishes it (no run killed)',
      runs.every(r => !r.killed && !r.err) && runs[0].res.stop === 'hard' && runs[0].cursor === '' && runs.length > 1 &&
      runs[runs.length - 1].cursor === logOf(0) && restoredB2(w));
  }

  // ---- C: burst + lapsed rows ----
  {
    const w = worldA();
    const lapsed = [];
    for (let j = 0; j < 12; j++) lapsed.push(addLapsed(w, j));
    const runs = await runUntil(s, w, 15, r => (r.cursor === logOf(39) && lapsed.every(L => restoredLapsed(w, L))) || r.killed);
    ok('C: no run is ever killed (the sweep waits while events are behind)', runs.every(r => !r.killed && !r.err));
    ok('C: runs that stop on the budget do not start the sweep', runs.filter(r => r.res.stop).length > 0 && runs.filter(r => r.res.stop).every(r => r.logs.some(l => /expiry sweep deferred/.test(l))));
    ok('C: in this scenario the sweep stops on the soft check between rows, not by the hard deadline in the middle of an unban (a stop mid-unban loses nothing either: F)', !runs.some(r => r.logs.some(l => /expiry sweep: time budget/.test(l))));
    ok('C: in the end every event is enforced and every lapsed row is cleared and restored',
      runs[runs.length - 1].cursor === logOf(39) && lapsed.every(L => restoredLapsed(w, L)));
  }

  // ---- D: sweep only, more lapsed rows than one run can restore ----
  {
    const w = world(() => COST_D);
    const lapsed = [];
    for (let j = 0; j < 30; j++) lapsed.push(addLapsed(w, j));
    const runs = await runUntil(s, w, 10, r => lapsed.every(L => restoredLapsed(w, L)) || r.killed);
    ok('D: no run is ever killed by a long expiry sweep', runs.every(r => !r.killed && !r.err));
    ok('D: the first run stops the sweep between rows and leaves the rest', runs[0].res.lapsed > 0 && runs[0].res.lapsed < 30 && runs[0].logs.some(l => /left for the next run/.test(l)));
    ok('D: later runs restore the rest (each lapsed row exactly once)', lapsed.every(L => restoredLapsed(w, L)) && runs.reduce((a, r) => a + r.res.lapsed, 0) === 30);
    ok('D: in this scenario the sweep stops between rows (the soft check), not in the middle of an unban (a stop mid-unban loses nothing either: F)', !runs.some(r => r.logs.some(l => /expiry sweep: time budget/.test(l))));
  }

  // ---- F (review Q117, rework 1): the sweep has one lapsed account whose restore alone runs past the hard deadline ----
  //      The sweep has no cursor -- the lapsed gate row is its work list -- so the gate row must outlive a stop mid-restore.
  {
    const w = worldF();
    const runs = await runUntil(s, w, 6, r => restoredF(w) || r.killed);
    const r0 = runs[0];
    ok('F: no run is ever killed', runs.every(r => !r.killed && !r.err));
    ok('F: the first run stops the sweep on the hard deadline in the middle of the one unban', runs.length > 1 && r0.logs.some(l => /expiry sweep: time budget: restore stopped/.test(l)) && r0.res.lapsed === 0);
    ok('F: after that stop the gate row is still on the gate board (the next sweep still sees the account)', fGateAfter[0] === true);
    ok('F: after that stop part of the rows are back and part are still on the shadows', fParkedAfter[0] > 0 && fParkedAfter[0] < N);
    ok('F: a later run finishes the restore and only then clears the gate row: every row back byte-exact, no row left on a shadow', restoredF(w) && runs[runs.length - 1].res.lapsed === 1);
  }

  // ---- E: an ordinary run ----
  {
    const w = world(() => 50);
    w.addBan(0); w.put(SOURCES[0], sidOf(0), 100, [7, 0, -3]);
    w.events.push({ logId: 'log-pend', eventType: 1, productUserId: 'puid-x', action: 'RESTRICT_GAME_ACCESS', pending: true, referenceId: '' });
    w.puidSid['puid-u'] = sidOf(1);
    w.put('ban_board', sidOf(1), 1, s.banDetails(0, s.ACT_FULL, ''));
    w.put(SOURCES[1] + '_banned', sidOf(1), 55, [1]);
    w.events.push({ logId: 'log-unban', eventType: 3, productUserId: 'puid-u', action: 'RESTRICT_GAME_ACCESS', pending: false, referenceId: '' });
    const L = addLapsed(w, 3);
    const r = await runOnce(s, w, null);
    ok('E: an ordinary run does everything in one go: ban, skip, unban, sweep; cursor on the last event; nothing deferred',
      !r.killed && !r.err && r.res.stop === '' && r.res.processed === 2 && r.res.skipped === 1 && r.res.lapsed === 1 && cursorOf(r.committed) === 'log-unban' &&
      enforced(w, 0, () => [SOURCES[0]]) && (w.row(SOURCES[1], sidOf(1)) || {}).score === 55 && !w.row('ban_board', sidOf(1)) && restoredLapsed(w, L) &&
      !r.logs.some(l => /deferred|time budget/.test(l)));
    const r2 = await runOnce(s, w, r.committed);
    ok('E: a caught-up run changes nothing (no state write, no warning)', r2.committed === r.committed && r2.res.processed === 0 && !r2.logs.some(l => /::warning::/.test(l)));
  }

  // ---- G: a page of skipped events moves the cursor ----
  {
    const g1 = await runG(s, 'pending');
    ok('G: a page of 10 pending events: one run skips all 10 and the cursor lands on the last one; the next run has nothing left',
      !g1.r1.killed && !g1.r1.err && g1.r1.res.skipped === 10 && g1.r1.res.processed === 0 && g1.c1 === logOf(9) && g1.r2.res.skipped === 0);
    const g2 = await runG(s, 'unmapped');
    ok('G: a page of 10 events with no linked steam account: one run skips all 10 and the cursor lands on the last one; the next run has nothing left',
      !g2.r1.killed && !g2.r1.err && g2.r1.res.skipped === 10 && g2.r1.res.unmapped === 10 && g2.c1 === logOf(9) && g2.r2.res.skipped === 0);
  }

  // ---- H: the O198 trust event queue moves with the cursor ----
  // A stopped event saves the run's state and is re-run from the top by a later run. Its trust event (one 'sa' entry per
  // enforced event, which the reconcile counts every time it takes one -- a sanction event has no match key) must be
  // queued exactly once: not by the stopped attempt, and once by the run that finishes it.
  {
    // H1: the burst, run by run -- the queue holds one ban event per account up to the cursor, none after it, ids
    //     consecutive in event order
    const w = worldA();
    let committed = null, good = true, steps = 0;
    for (let k = 0; k < 15; k++) {
      const r = await runOnce(s, w, committed);
      committed = r.committed;
      const cur = cursorOf(committed);
      const n = cur ? Number(cur.slice(4)) + 1 : 0;
      const q = queueOf(committed);
      if (q.length !== n) good = false;
      for (let i = 0; i < q.length; i++) {
        const e = q[i];
        if (!(e.id === i + 1 && e.src === 'sa' && e.sev === 3 && e.p === pidOf(sidOf(i)) && e.ctx && e.ctx.a === s.ACT_FULL && e.ctx.x === 0)) good = false;
      }
      steps++;
      if (cur === logOf(39)) break;
    }
    ok('H: a burst queues one trust event per enforced ban, in event order, and after every run exactly the ones up to the cursor', good && steps > 1);
  }
  {
    // H2: one ban stopped midway, finished by a later run
    const w = worldB();
    const runs = await runUntil(s, w, 6, r => r.cursor === logOf(0) || r.killed);
    const q0 = queueOf(runs[0].committed), qN = queueOf(runs[runs.length - 1].committed);
    ok('H: a ban stopped midway queues nothing for it (the stopped run saves its state, the cursor still before the event)',
      runs[0].res.stop === 'hard' && runs[0].cursor === '' && runs[0].committed != null && q0.length === 0);
    ok('H: the run that finishes the stopped ban queues its trust event once (sev 3, the one id)',
      runs.length > 1 && enforced(w, 0, homesB) && qN.length === 1 && qN[0].id === 1 && qN[0].sev === 3 && qN[0].p === pidOf(sidOf(0)));
  }
  {
    // H3: the same for an unban (history-only event, sev 0)
    const w = worldB2();
    const runs = await runUntil(s, w, 6, r => r.cursor === logOf(0) || r.killed);
    const q0 = queueOf(runs[0].committed), qN = queueOf(runs[runs.length - 1].committed);
    ok('H: an unban stopped midway queues nothing; the run that finishes it queues one (sev 0, history only)',
      runs[0].res.stop === 'hard' && q0.length === 0 && runs.length > 1 && restoredB2(w) &&
      qN.length === 1 && qN[0].id === 1 && qN[0].sev === 0 && qN[0].ctx && qN[0].ctx.u === 1 && qN[0].p === pidOf(sidOf(0)));
  }
  {
    // H4: an ordinary run queues the same events as before the budget (one per enforced event, nothing for skips or lapses)
    const w = world(() => 50);
    w.addBan(0); w.put(SOURCES[0], sidOf(0), 100, [7, 0, -3]);
    w.events.push({ logId: 'log-pend', eventType: 1, productUserId: 'puid-x', action: 'RESTRICT_GAME_ACCESS', pending: true, referenceId: '' });
    w.puidSid['puid-m'] = sidOf(2);
    w.events.push({ logId: 'log-mm', eventType: 1, productUserId: 'puid-m', action: 'RESTRICT_MATCHMAKING', pending: false, referenceId: '', expirationTimestamp: Date.now() + 86400000 });
    w.puidSid['puid-u'] = sidOf(1);
    w.put('ban_board', sidOf(1), 1, s.banDetails(0, s.ACT_FULL, ''));
    w.events.push({ logId: 'log-unban', eventType: 3, productUserId: 'puid-u', action: 'RESTRICT_GAME_ACCESS', pending: false, referenceId: '' });
    addLapsed(w, 4);
    const r = await runOnce(s, w, null);
    const q = queueOf(r.committed);
    ok('H: an ordinary run queues one trust event per enforced event, in order, with the fields it always had (skips and lapses queue nothing)',
      !r.killed && !r.err && r.res.stop === '' && q.length === 3 &&
      q[0].id === 1 && q[0].p === pidOf(sidOf(0)) && q[0].sev === 3 && q[0].ctx.a === s.ACT_FULL && q[0].ctx.x === 0 &&
      q[1].id === 2 && q[1].p === pidOf(sidOf(2)) && q[1].sev === 2 && q[1].ctx.a === s.ACT_MM && q[1].ctx.x === 1 &&
      q[2].id === 3 && q[2].p === pidOf(sidOf(1)) && q[2].sev === 0 && q[2].ctx.u === 1 &&
      q.every(e => e.src === 'sa' && Number.isInteger(e.t) && e.t > 0));
  }

  // ---- mutations of sanctions.js: each must turn a check above red ----
  function variant(mutate) {
    const file = path.join(ROOT, 'sanctions.js');
    const out = mutate(SSRC);
    assert.ok(out !== SSRC, 'mutation applies');
    const m = new Module(file, module);
    m.filename = file; m.paths = Module._nodeModulePaths(ROOT);
    m._compile(out, file);
    return m.exports;
  }
  {
    const mut = variant(src => src.replace("      if (budget.softPassed()) { stop = 'soft'; break rounds; }\n", ''));
    // one sync answer holds the whole burst, so no batch boundary (where the run also checks) falls in between
    const runs = await runUntil(mut, worldA(null, 100), 15, r => r.cursor === logOf(39) || r.killed);
    ok('mutation self-proof: without the between-events check a run starts events past the soft deadline and stops one midway (caught by A)',
      runs.some(r => r.res && r.res.stop === 'hard'));
  }
  {
    const mut = variant(src => src.replace("    if (boards.budget) boards.budget.checkHard('exile');", ''));
    const runs = await runUntil(mut, worldB(), 6, r => r.killed);
    ok('mutation self-proof: without the between-boards check in the exile loop the slow ban runs into the job limit (caught by B)', runs.some(r => r.killed));
  }
  {
    const mut = variant(src => src.replace("      processed++;\n      cursor = ev.logId;                       // only now: the event is fully enforced\n",
      "      processed++;\n").replace("      const verb = verbOf(ev);\n      if (verb === 'skip') {", "      cursor = ev.logId;\n      const verb = verbOf(ev);\n      if (verb === 'skip') {"));
    const w = worldB();
    const runs = await runUntil(mut, w, 6, r => r.cursor === logOf(0) || r.killed);
    ok('mutation self-proof: moving the cursor before the event is done skips the stopped ban for good (caught by B)',
      runs[runs.length - 1].cursor === logOf(0) && !enforced(w, 0, homesB));
  }
  {
    const mut = variant(src => src.replace("    if (boards.budget) boards.budget.checkHard('restore');", ''));
    const runs = await runUntil(mut, worldB2(), 6, r => r.killed);
    ok('mutation self-proof: without the between-boards check in the restore loop the slow unban runs into the job limit (caught by B2)', runs.some(r => r.killed));
  }
  {
    const mut = variant(src => src.replace("    if (boards.budget && boards.budget.softPassed()) {\n      console.log('expiry sweep: '", "    if (false) {\n      console.log('expiry sweep: '"));
    const w = world(() => COST_D);
    for (let j = 0; j < 30; j++) addLapsed(w, j);
    const runs = await runUntil(mut, w, 3, r => r.killed);
    ok('mutation self-proof: without the between-rows check the sweep starts unbans past the soft deadline and one is stopped midway (caught by D)',
      runs.some(r => r.logs.some(l => /expiry sweep: time budget/.test(l))));
  }
  {
    const mut = variant(src => src.replace("  if (stop || budget.softPassed()) {", "  if (false) {"));
    const w = worldA();
    for (let j = 0; j < 12; j++) addLapsed(w, j);
    const runs = await runUntil(mut, w, 2, r => r.killed);
    ok('mutation self-proof: a sweep started after a run stopped on the budget is caught (C: the run does not report it deferred)',
      runs.some(r => r.res && r.res.stop && !r.logs.some(l => /expiry sweep deferred/.test(l))));
  }
  {
    // review Q117 rework 1: the sweep clears the gate row first again (the pre-rework order) -> a stop mid-restore strands rows
    const mut = variant(src => src.replace("  if (!gateLast) await delRow(boards.ban, sid);\n", "  await delRow(boards.ban, sid);\n"));
    const w = worldF();
    const n0 = fGateAfter.length;
    const runs = await runUntil(mut, w, 4, r => restoredF(w) || r.killed);
    ok('mutation self-proof: with the gate row cleared before the restore, a sweep stopped mid-restore strands the rest of the rows for good (caught by F)',
      !restoredF(w) && fGateAfter[n0] === false && homesB().some(n => w.row(n + '_banned', SID_F)) && runs.every(r => !r.killed));
  }
  {
    const mut = variant(src => src.replace("        cursor = ev.logId;                     // advance even when skipped: it is a resume token\n", ''));
    const g = await runG(mut, 'pending');
    ok('mutation self-proof: without the cursor move on a skipped event a page of pending events never moves the cursor (caught by G)', g.c1 !== logOf(9));
  }
  {
    const mut = variant(src => src.replace("        unmapped++; skipped++;\n        cursor = ev.logId;\n", "        unmapped++; skipped++;\n"));
    const g = await runG(mut, 'unmapped');
    ok('mutation self-proof: without the cursor move on an event with no linked steam account a page of them never moves the cursor (caught by G)', g.c1 !== logOf(9));
  }
  {
    // the trust event queued up front again (the order main had before this patch, when a stopped event could not
    //   save its state): the stopped attempt leaves one event and the re-run a second one
    const moveUp = (src, push, call) => {   // one queuePush line back above its enact call (main's order before this patch)
      const i = src.indexOf(push), j = i < 0 ? -1 : src.lastIndexOf(call, i);
      if (j < 0) return src;
      const e = src.indexOf('\n', i) + 1;
      return src.slice(0, j) + src.slice(i, e) + src.slice(j, i) + src.slice(e);
    };
    const mut = variant(src => moveUp(moveUp(src,
      "          trustLedger.queuePush(st, { t: nowM, src: 'sa', p: pid(sid), sev: actionCodeOf", "          const r = await enactBan("),
      "          trustLedger.queuePush(st, { t: nowM, src: 'sa', p: pid(sid), sev: 0,", "          const r = await enactUnban(boards, sid);"));
    const w = worldB();
    const runs = await runUntil(mut, w, 6, r => r.cursor === logOf(0) || r.killed);
    ok('mutation self-proof: with the trust event queued before the enforcement, a ban stopped midway is queued once per attempt (caught by H)',
      runs.length > 1 && queueOf(runs[0].committed).length === 1 && queueOf(runs[runs.length - 1].committed).length === runs.length);
  }
  {
    // the whole budget out: the patch's base behaviour (one run must handle everything, killed runs keep no state)
    const mut = variant(src => src.replace("    softPassed: () => clock() >= soft,", "    softPassed: () => false,").replace("    checkHard(what) { if (clock() >= hard)", "    checkHard(what) { if (false)"));
    const w = worldA();
    const runs = await runUntil(mut, w, 8, () => false);
    ok('mutation self-proof: with no budget at all every run is killed and the cursor never moves (the Q117 stall, caught by A)',
      runs.every(r => r.killed) && runs.every(r => r.cursor === '') && !enforced(w, 39, homesA) && w.reports.length > 40);
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('ALL PASS (sanctions-budget ' + pass + ')');
})().catch(e => { console.error(e && e.stack || e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e2) {} process.exit(1); });
