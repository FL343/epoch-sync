'use strict';
// ============================================================
// tools/resettle-steam.js -- an offline Steam for the re-settlement dry run (cloud audit Q413 + O920 / O922, 2026-11-20)
// ============================================================
// Preloaded by tools/resettle-once.js dry-run into a real `node validate.js` (node -r): global fetch answers from a board
//   snapshot held in RESETTLE_FX (a JSON file: { boards: [{ id, name, trusted, asc, entries: { <steam id>: { score, h } } }],
//   nextId }; h = the detail bytes as Steam returns them, hex), every write lands in that file instead of Steam and is
//   logged as one JSON line in RESETTLE_LOG, and the wall clock reads RESETTLE_NOW_MS (+ the time this process has run).
//   One process per reconcile tick; the file is written back when the process exits, so the next tick reads this
//   tick's writes. Nothing leaves the machine: any other address, and http / https request / get, is refused.
// Answers like Steam does for what validate.js uses: GetLeaderboardsForGame, GetLeaderboardEntries (RequestGlobal pages,
//   RequestAroundUser), SetLeaderboardScore (ForceUpdate; KeepBest keeps the better score), DeleteLeaderboardScore,
//   FindOrCreateLeaderboard. CheckAppOwnership answers 503 (an ownership probe fails; the job keeps what its state says).
// The snapshot holds Steam IDs: it, the log and the work directory stay on the machine that ran the dry run.
// ============================================================
const fs = require('fs');
const FX = process.env.RESETTLE_FX, LOG = process.env.RESETTLE_LOG, NOW0 = Number(process.env.RESETTLE_NOW_MS);
if (!FX || !LOG || !(NOW0 > 0)) { console.error('resettle-steam: RESETTLE_FX / RESETTLE_LOG / RESETTLE_NOW_MS missing'); process.exit(97); }

// the clock: Date.now / new Date() / Date() read NOW0 plus the time this process has run (tools/fake-clock.js, absolute)
(function () {
  const RealDate = Date, realNow = RealDate.now, t0 = realNow();
  const now = () => NOW0 + (realNow() - t0);
  function FakeDate(...args) {
    if (!new.target) return new RealDate(now()).toString();
    return Reflect.construct(RealDate, args.length ? args : [now()], new.target);
  }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = now;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  Object.defineProperty(FakeDate, 'name', { value: 'Date' });
  Object.defineProperty(FakeDate, 'length', { value: 7 });
  Object.defineProperty(RealDate.prototype, 'constructor', { value: FakeDate, writable: true, configurable: true });
  globalThis.Date = FakeDate;
})();

const st = JSON.parse(fs.readFileSync(FX, 'utf8'));
const byId = new Map(), byName = new Map();
for (const b of st.boards) { byId.set(String(b.id), b); byName.set(b.name, b); }
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(Object.assign({ at: Date.now() }, o)) + '\n');
for (const mod of ['https', 'http']) {
  try {
    const m = require(mod);
    const deny = (what) => function () { log({ op: 'blocked', what: mod + '.' + what }); throw new Error('resettle-steam: ' + mod + '.' + what + ' refused (the dry run stays offline)'); };
    m.request = deny('request'); m.get = deny('get');
  } catch (e) { /* module missing */ }
}
const resp = (o, code) => { const t = JSON.stringify(o); return { ok: (code || 200) < 400, status: code || 200, text: async () => t, json: async () => JSON.parse(t) }; };
function parseForm(body) {
  const o = {};
  for (const kv of String(body || '').split('&')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    o[k] = (k === 'details') ? v : decodeURIComponent(v);
  }
  return o;
}
// details arrive percent-encoded one byte at a time (validate.js pctBytes); Steam hands them back as hex
const pctToHex = (s) => (String(s).match(/%[0-9a-fA-F]{2}/g) || []).map((x) => x.slice(1).toLowerCase()).join('');
const better = (b, a, c) => (b.asc ? a < c : a > c);
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (/\/ISteamUser\/CheckAppOwnership\//.test(u)) return resp({ error: 'offline' }, 503);
  if (!u.startsWith('https://partner.steam-api.com/ISteamLeaderboards/')) { log({ op: 'blocked', what: u.split('?')[0].slice(0, 80) }); return resp({ error: 'blocked' }, 599); }
  if (init && init.method === 'POST') {
    const p = parseForm(init.body);
    delete p.key;
    if (/FindOrCreateLeaderboard/.test(u)) {
      let b = byName.get(p.name);
      if (!b) { b = { id: st.nextId++, name: p.name, trusted: p.onlytrustedwrites === '1', asc: p.sortmethod === 'Ascending', entries: {} }; st.boards.push(b); byId.set(String(b.id), b); byName.set(b.name, b); log({ op: 'create', board: p.name }); }
      return resp({ result: { result: 1, leaderboard: { leaderBoardID: b.id, leaderboardid: b.id, leaderBoardName: b.name } } });
    }
    const b = byId.get(String(p.leaderboardid));
    if (!b) { log({ op: 'write-unknown-board', id: String(p.leaderboardid) }); return resp({ result: { result: 2 } }); }
    if (/SetLeaderboardScore/.test(u)) {
      const was = b.entries[p.steamid] || null, score = Number(p.score) | 0;
      const h = p.details != null ? pctToHex(p.details) : (was ? was.h : '');
      if (p.scoremethod === 'KeepBest' && was && !better(b, score, was.score)) { log({ op: 'keep', board: b.name, sid: p.steamid, score, was: was.score }); return resp({ result: { result: 1, score_changed: false } }); }
      b.entries[p.steamid] = { score, h };
      log({ op: 'set', board: b.name, sid: p.steamid, score, h, was: was ? was.score : null, wasH: was ? was.h : null });
      return resp({ result: { result: 1, score_changed: true } });
    }
    if (/DeleteLeaderboardScore/.test(u)) {
      const was = b.entries[p.steamid] || null;
      delete b.entries[p.steamid];
      log({ op: 'del', board: b.name, sid: p.steamid, was: was ? was.score : null, wasH: was ? was.h : null });
      return resp({ result: { result: 1 } });
    }
    log({ op: 'unknown-write', what: u.split('?')[0].slice(0, 80) });
    return resp({ result: { result: 2 } });
  }
  if (/GetLeaderboardsForGame/.test(u)) {
    return resp({ response: { result: 1, leaderboards: st.boards.map((b) => ({ id: b.id, name: b.name, entries: Object.keys(b.entries).length,
      sortmethod: b.asc ? 'Ascending' : 'Descending', displaytype: 'Numeric', onlytrustedwrites: !!b.trusted, onlyfriendsreads: false })) } });
  }
  if (/GetLeaderboardEntries/.test(u)) {
    const b = byId.get((/[?&]leaderboardid=([0-9]+)/.exec(u) || [])[1]);
    if (!b) return resp({ leaderboardEntryInformation: { leaderboardEntries: [] } });
    let ents = Object.keys(b.entries).map((sid) => ({ steamID: sid, score: b.entries[sid].score, detailData: b.entries[sid].h || '' }));
    ents.sort((x, y) => (b.asc ? x.score - y.score : y.score - x.score) || (x.steamID < y.steamID ? -1 : x.steamID > y.steamID ? 1 : 0));
    ents = ents.map((e, i) => Object.assign({ rank: i + 1 }, e));
    if (/RequestAroundUser/.test(u)) {
      const sid = (/[?&]steamid=([0-9]+)/.exec(u) || [])[1];
      ents = ents.filter((e) => e.steamID === sid);
    } else {
      const rs = Number((/[?&]rangestart=([0-9]+)/.exec(u) || [])[1] || 1), re = Number((/[?&]rangeend=([0-9]+)/.exec(u) || [])[1] || 5000);
      ents = ents.slice(Math.max(0, rs - 1), re);
    }
    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents } });
  }
  log({ op: 'unknown-read', what: u.split('?')[0].slice(0, 80) });
  return resp({ error: 'unknown' }, 404);
};
process.on('exit', () => { try { fs.writeFileSync(FX, JSON.stringify(st)); } catch (e) { /* the caller sees the tick before */ } });
