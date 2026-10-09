'use strict';
// Team-gamble TEAM dissent (Q56, cloud audit follow-up to Q51): two or three teammates who block only the game
// connection through the gamble window (Steam online) all write the client's rank-0 refusal. Q51 only sees ONE
// dissenting account, so such a group fell back to 'rank-conflict' -- unsettled for everybody, every writer flagged,
// nobody struck: Q51's "lose -> void" done as a premade. Now each refusing teammate is struck like a lone dissenter;
// the match settles from the agreeing side as soon as ANY of them is due, and the ones not yet due are excused
// (flagged, never a leaver). Opposing hosts linked by having sat on each other's team count once.
//   [1] detector shapes (team2TeamDissent / team2Dissent), incl. refusals naming the other side (client Q43 tag),
//       the host team taken from the agreeing writers first (team2HostTeam), late refusers (team2LateRefusers), and
//       with Q63 (the after-q43 patch) which keys the Q43 accusation pass owns (team2AccusedKey)
//   [2] verdict rule: linked opposing hosts (t2ldVerdict x)
//   [3] pass level: per-dissenter verdicts, excused set, sticky reuse, rotation, late arrivals, Q43-tagged groups
//       ([3j], by mode; with Q63 the first decider owns the key [3j4] and a group this pass does not take stays
//       the Q43 pass's [3j5]), refusals first seen after a verdict set aside ([3k]-[3p]), the R7b case by mode ([3q])
//       (applyTeam2LoneDissent)
//   [4] ranked 2v2, the whole other team refuses for the first time: free, both struck, only they flagged; at
//       maturity nobody gets an exit-rate hit
//   [5] the same pair again under an unrelated host: settles, both leavers, the winners rated as a team (no
//       rating moves between the two winning teammates)
//   [6] a main account with a fresh partner: settles, the main is the leaver, the partner is excused (6b: and not
//       seeded when he has no points this season)
//   [7] framed by a modded pair taking turns hosting: still free ([7b]: each leaving the partner's seat blank)
//   [8] ranked 3v3, two refusers and their third teammate agreeing: settles, the third is rated and shielded
//   [9] a refusal arriving a run later beside a stored one: struck then, turns the free verdict into a settle
//   [9b] a settle verdict, then the third teammate's refusal naming the host lands in the absent-seat grace: the
//       match still settles (set aside without Q63, struck as a teammate with it)
//   [10] one refusal + one sane differing record: not this shape, unchanged (everyone flagged, no strike)
//   [10b] the losing side refuses naming the host (client Q43 tag, costs them nothing): without Q63 not a team
//       dissent (as before Q56, also with the Q43 pass: it only counts such names); with Q63 struck as a team
//   [10c] the winning side refuses naming the host (they threw away a win): never this pass; with the Q43 pass the
//       host takes the strike, without it the group stays as before Q56
// Three trees run this file: no Q43 (epoch-sync.patch), Q43 merged after epoch-sync.patch (before the Q63
//   follow-up), and Q43 + epoch-sync-after-q43.patch (Q63). Q43 / Q63 below say which one this is.
//   [11] wiring pins
// Runs the REAL validate.js main() against an offline board stub (test/writer-pacing.js harness).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));
const Q43 = typeof v.team2Accusations === 'function';   // the Q43 accusation pass is merged
const Q63 = typeof v.team2AccusedKey === 'function';    // ... and this pass defers to its strikes only (Q63)
const TAG = v.T2_NAME_TAG || v.T2BY_TAG;                // the client Q43 name tag

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    const body = String(init.body || '');",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body }) + '\\n');",
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

function runCron(boards, files, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-team-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const e = Object.assign({}, process.env, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: '', CONCURRENCY: '1', STRICT_BOARDS: '0',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pinned: ranked points go to 'points' (season boards start later)
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg) {
    for (const k of Object.keys(sg.players || {})) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
    for (const k of Object.keys(sg.t2ld || {})) for (const e of sg.t2ld[k]) e.t -= ms;
    for (const k of Object.keys(sg.t2lv || {})) sg.t2lv[k].t -= ms;
    for (const k of Object.keys(sg.flagged || {})) sg.flagged[k] -= ms;
  }
  return files;
}
// With the absent-seat hold in (cloud audit R1-B2-04, merged before or after this), a group missing a seat's
//   record -- the dissenter's seat once a settle verdict leaves it out -- settles one grace period later: follow up
//   with that run. Without the hold the first run settles and no follow-up happens.
function runSettle(boards, files) {
  const r = runCron(boards, files);
  return (/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS) ? runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000)) : r;
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const scoreTo = (r, boardId, sid) => { const p = posts(r, boardId).filter(x => new RegExp('steamid=' + sid + '(&|$)').test(x.body)); return p.length ? Number(/score=(-?[0-9]+)/.exec(p[p.length - 1].body)[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const strikesOf = (r, sid) => ((sigOf(r).t2ld || {})[v.pid(sid)] || []).length;
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
// mode-2 settle record. roster: sids by seat (seat 0 = host); win: winning team (0 = seats < ts); ranks by the
//   winning-block convention; o.rank / o.scores override for the dissenting writer
function t2(mt, hash, seat, roster, o) {
  o = o || {};
  const pc = roster.length, ts = pc / 2, win = o.win == null ? 0 : o.win;
  const scores = o.scores || roster.map((s, i) => 6000 - 500 * i);
  const myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = [0xB1, 3, mt, hash | 0, 4321, seat, rank, (6 << 1) | (myTeam === win ? 1 : 0), pc, 900].concat(scores, [o.disp | 0]);
  for (const s of (o.ros || roster)) { const p = sidPair(s); d.push(p[0], p[1]); }   // o.ros: the roster this writer writes ('0' = blank seat)
  if (o.tail != null) d.push(o.tail);   // one int after the roster (the client Q43 name tag)
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs, sids) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: (sids || [A, B, C, D, E, F]).map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// one match's records: every roster seat writes, `dis` (seat -> overrides) changes some, `skip` drops seats
function match(mt, hash, roster, dis, skip) {
  const out = [];
  roster.forEach((sid, seat) => { if (skip && skip.indexOf(seat) >= 0) return; out.push({ sid, d: t2(mt, hash, seat, roster, (dis || {})[seat]) }); });
  return out;
}
// an attested start sighted `ago` ms before the run (pid roster, like reconcileStarts registers it)
function startOf(mt, hash, roster, ago) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [] };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const R4 = [A, B, C, D];   // host A; team 0 = A, B; team 1 = C, D
const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const recsOf = (list) => list.map(x => ({ steamID: x.sid, d: x.d, dispCode: x.d[10 + (x.d[8] | 0)] | 0, roster: v.decodeRoster(x.d) }));
const G = '76561198000000007', H = '76561198000000008';
const R6 = [A, B, C, D, E, F];   // host A; team 0 = A, B, C; team 1 = D, E, F
const tsm = require(path.join(__dirname, '..', 'trueskill.js'));
const skillOf = (r, sid) => ((r.state.SKILL_FILE || {})[v.pid(sid)]) || null;
const flaggedHas = (r, m) => !!((sigOf(r).flagged || {})[m]);
// a stored strike in an earlier match (e2e state): host `h` on the other team, his team `x`
const strikeIn = (m, ago, h, x) => ({ m, t: Date.now() - ago, h: v.pid(h), o: 1, x: x.map(s => v.pid(s)) });
const signalsWith = (t2ld) => ({ players: {}, flagged: {}, t2ld });

// ---- [1] detector shapes ----
{
  const td = v.team2TeamDissent(recsOf(match(6, 0x100, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), vecOf);
  T('[1] 2v2, the whole other team refuses: found', td && td.ds.length === 2 && td.ds[0].sid === C && td.ds[1].sid === D && td.ds.every(d => d.opp === 1) && td.host === A && td.rest.length === 2 && td.win === 0);
  T('[1] the host\'s team is listed', td && td.hostTeam.slice().sort().join() === [A, B].sort().join());
  T('[1] Q51 still owns it: team2LoneDissent finds nobody', v.team2LoneDissent(recsOf(match(6, 0x100, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  T('[1] one refusal + one sane differing claim: none', v.team2TeamDissent(recsOf(match(6, 0x101, R4, { 2: { rank: 0 }, 3: { scores: [1, 2, 3, 4] } })), vecOf) === null);
  T('[1] refusers on both teams: none', v.team2TeamDissent(recsOf(match(6, 0x102, R4, { 1: { rank: 0 }, 2: { rank: 0 } })), vecOf) === null);
  T('[1] the host refusing with his teammate (agreeing side lacks the host): none', v.team2TeamDissent(recsOf(match(6, 0x103, R4, { 0: { rank: 0 }, 1: { rank: 0 } })), vecOf) === null);
  T('[1] one agreeing account only: none', v.team2TeamDissent(recsOf(match(6, 0x104, R4, { 2: { rank: 0 }, 3: { rank: 0 } }, [1])), vecOf) === null);
  T('[1] the agreeing side split: none', v.team2TeamDissent(recsOf(match(6, 0x105, R4, { 1: { scores: [1, 2, 3, 4] }, 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  T('[1] the agreeing side votes void: none', v.team2TeamDissent(recsOf(match(6, 0x106, R4, { 0: { disp: 3 }, 1: { disp: 3 }, 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  const outsider = recsOf(match(6, 0x107, R4, { 2: { rank: 0 }, 3: { rank: 0 } })).map(r => (r.steamID === D ? Object.assign({}, r, { steamID: E }) : r));
  T('[1] a refuser the others do not name at that seat: none', v.team2TeamDissent(outsider, vecOf) === null);
  T('[1] team brawl (mode 1, no gamble): none', v.team2TeamDissent(recsOf(match(4, 0x108, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  const t6 = v.team2TeamDissent(recsOf(match(9, 0x109, R6, { 4: { rank: 0 }, 5: { rank: 0 } })), vecOf);
  T('[1] 3v3, two refusers and their third teammate agreeing: found', t6 && t6.ds.map(d => d.sid).join() === [E, F].join() && t6.ds.every(d => d.opp === 1) && t6.rest.length === 4);
  const t6w = v.team2TeamDissent(recsOf(match(9, 0x10A, R6, { 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } })), vecOf);
  T('[1] 3v3, the whole other team: found', t6w && t6w.ds.length === 3 && t6w.hostTeam.slice().sort().join() === [A, B, C].sort().join());
  T('[1] 3v3, the whole other team refusing against only two agreeing accounts: none', v.team2TeamDissent(recsOf(match(9, 0x10F, R6, { 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } }, [2])), vecOf) === null);
  T('[1] the agreeing pair itself out of bounds (sanity): none', v.team2TeamDissent(recsOf(match(6, 0x110, R4, { 0: { scores: [5000000, 1, 2, 3] }, 1: { scores: [5000000, 1, 2, 3] }, 2: { rank: 0 }, 3: { rank: 0 } })), vecOf) === null);
  T('[1] 3v3, four refusers (more than a team): none', v.team2TeamDissent(recsOf(match(9, 0x10B, R6, { 2: { rank: 0 }, 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } })), vecOf) === null);
  const t6o = v.team2TeamDissent(recsOf(match(9, 0x10C, R6, { 1: { rank: 0 }, 2: { rank: 0 } })), vecOf);
  T('[1] 3v3, the host\'s two teammates: found, own-side', t6o && t6o.ds.length === 2 && t6o.ds.every(d => d.opp === 0));
  T('[1] everyone agrees: none', v.team2TeamDissent(recsOf(match(6, 0x10D, R4)), vecOf) === null && v.team2Dissent(recsOf(match(6, 0x10D, R4)), vecOf) === null);
  const lone = v.team2Dissent(recsOf(match(6, 0x10E, R4, { 2: { rank: 0 } })), vecOf);
  T('[1] team2Dissent: a Q51 lone dissent in the common shape', lone && lone.lone === true && lone.ds.length === 1 && lone.ds[0].sid === C && lone.ds[0].opp === 1 && lone.hostTeam.slice().sort().join() === [A, B].sort().join());
  const pair = v.team2Dissent(recsOf(match(6, 0x100, R4, { 2: { rank: 0 }, 3: { rank: 0 } })), vecOf);
  T('[1] team2Dissent: the pair', pair && pair.lone === false && pair.ds.length === 2);
  // the client Q43 name tag (one int after the roster) on a refusal. Without Q63 a group naming the agreeing side
  //   is Q43's (the detector says none); with Q63 the detector ignores names and the pass asks team2AccusedKey
  const named = (list, tags) => recsOf(list.map(x => (tags[x.d[5]] == null ? x : { sid: x.sid, d: x.d.concat([tags[x.d[5]]]) })));
  T('[1] the tag value matches the client Q43 T2BY_TAG', TAG === 0x74320000 && (v.T2BY_TAG == null || v.T2BY_TAG === TAG) && (v.T2_NAME_TAG == null || v.T2_NAME_TAG === TAG));
  const nm = (x) => (Q63 ? (x && x.ds.length >= 2) : x === null);
  const nmL = Q63 ? 'found (Q63: names do not move the detector)' : 'none';
  T('[1] both refusers name the host (Q43 shape): ' + nmL, nm(v.team2TeamDissent(named(match(6, 0x111, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 1, 3: TAG | 1 }), vecOf)));
  T('[1] one of them names the host: ' + nmL, nm(v.team2TeamDissent(named(match(6, 0x112, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 3: TAG | 1 }), vecOf)));
  T('[1] they name the host\'s teammate (an agreeing seat): ' + nmL, nm(v.team2TeamDissent(named(match(6, 0x113, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 2 }), vecOf)));
  T('[1] 3v3, one of three names the host: ' + nmL, nm(v.team2TeamDissent(named(match(9, 0x114, R6, { 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } }), { 5: TAG | 1 }), vecOf)));
  const ownOnly = v.team2TeamDissent(named(match(6, 0x115, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 8, 3: TAG | 4 }), vecOf);
  T('[1] naming only each other (own side, never an honest client\'s tag): still found', ownOnly && ownOnly.ds.length === 2);
  const selfOnly = v.team2TeamDissent(named(match(6, 0x116, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 4 }), vecOf);
  T('[1] a tag naming only his own seat: still found', selfOnly && selfOnly.ds.length === 2);
  const stray = v.team2TeamDissent(named(match(6, 0x117, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: 0x12340001, 3: 1 }), vecOf);
  T('[1] an int after the roster that is not the tag: still found', stray && stray.ds.length === 2);
  const hiRank = v.team2TeamDissent(named(match(6, 0x11A, R4, { 2: { rank: 9 }, 3: { rank: 0 } }), { 2: TAG | 1 }), vecOf);
  T('[1] a tag on a refusal that is not the client\'s rank 0 (Q43 ignores it): still found', hiRank && hiRank.ds.length === 2);
  const insane = v.team2TeamDissent(named(match(6, 0x118, R4, { 2: { rank: 0, scores: [5000000, 1, 2, 3] }, 3: { rank: 0 } }), { 2: TAG | 1 }), vecOf);
  T('[1] a tag on a refusal out of bounds testifies to nothing: still found', insane && insane.ds.length === 2);
  if (!Q63) {
    const late = named(match(6, 0x119, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 1 });
    T('[1] team2NamesSeat reads the tag at the end of the roster', v.team2NamesSeat(late[2], [0, 1]) === true && v.team2NamesSeat(late[2], [1]) === false && v.team2NamesSeat(late[3], [0, 1]) === false && v.team2NamesSeat(late[0], [0, 1]) === false);
  } else {
    // Q63: the key is the Q43 pass's only when that pass charges it -- now (team2Accusations strike) or on an earlier run
    const mOf = (g) => keyOf(g[0].d);
    const lose = named(match(6, 0x120, R4, { 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 1, 3: TAG | 1 });
    T('[1] Q63: the losing side naming the host whose team claims the win: not Q43\'s (names cost them nothing)', v.team2AccusedKey(lose, {}, mOf(lose)) === false
      && v.team2Accusations(lose).length === 1 && v.team2Accusations(lose)[0].why === '' && v.team2TeamDissent(lose, vecOf) !== null);
    const W1 = { win: 1 };
    const win = named(match(6, 0x121, R4, { 0: W1, 1: W1, 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 1, 3: TAG | 1 });
    T('[1] Q63: the winning side naming the host (they threw away a win): Q43\'s', v.team2TeamDissent(win, vecOf) !== null && v.team2AccusedKey(win, {}, mOf(win)) === true);
    const one = named(match(6, 0x122, R4, { 0: W1, 1: W1, 2: { rank: 0 }, 3: { rank: 0 } }), { 2: TAG | 1 });
    T('[1] Q63: one winner naming the host (below the Q43 minimum): not Q43\'s', v.team2AccusedKey(one, {}, mOf(one)) === false);
    const left = named(match(9, 0x123, R6, { 3: { rank: 0 }, 4: { rank: 0 } }, [1]), { 3: TAG | 2, 4: TAG | 2 });
    T('[1] Q63: 3v3, two refusers naming a host teammate who wrote nothing: found by the detector, Q43\'s (he left)', v.team2TeamDissent(left, vecOf) !== null && v.team2AccusedKey(left, {}, mOf(left)) === true);
    const st = (val) => ({ t2av: { [mOf(lose) + '|' + v.pid(A)]: { t: 1, v: val } } });
    T('[1] Q63: a strike the Q43 pass stored on an earlier run keeps the key Q43\'s; its record-only verdicts do not', v.team2AccusedKey(lose, st('free'), mOf(lose)) === true
      && v.team2AccusedKey(lose, st('judge'), mOf(lose)) === true && v.team2AccusedKey(lose, st('nocost'), mOf(lose)) === false && v.team2AccusedKey(lose, st('lone'), mOf(lose)) === false
      && v.team2AccusedKey(lose, { t2av: { ['other|' + v.pid(A)]: { t: 1, v: 'free' } } }, mOf(lose)) === false);
  }
  // the host's team comes from the agreeing WRITERS first (Q56 review R4): the roster consensus is written by the
  //   host's team itself, so a modded pair leaving the partner's seat blank must not hide the partner
  const hideMate = { 0: { ros: [A, '0', C, D] }, 1: { ros: [A, '0', C, D] } };
  const tb = v.team2TeamDissent(recsOf(match(6, 0x11B, R4, Object.assign({ 2: { rank: 0 }, 3: { rank: 0 } }, hideMate))), vecOf);
  T('[1] the partner blank in every agreeing roster: still on the host\'s team (he wrote a record there)', tb && tb.ds.length === 2 && tb.hostTeam.slice().sort().join() === [A, B].sort().join(), tb && tb.hostTeam.join());
  const lb = v.team2Dissent(recsOf(match(6, 0x11C, R4, Object.assign({ 2: { rank: 0 } }, hideMate))), vecOf);
  T('[1] ... in the lone (Q51) shape too', lb && lb.lone === true && lb.hostTeam.slice().sort().join() === [A, B].sort().join(), lb && lb.hostTeam.join());
  const wr = recsOf(match(6, 0x11D, R4, hideMate)).filter(r => r.steamID === A || r.steamID === B || r.steamID === C);
  T('[1] team2HostTeam: writers seated on the host\'s team first, the roster adds, no duplicates, the other team never',
    v.team2HostTeam({ 0: A }, 2, wr).slice().sort().join() === [A, B].sort().join() && v.team2HostTeam({ 0: A, 1: B, 2: C }, 2, wr).length === 2
    && v.team2HostTeam({ 0: A, 1: B }, 2).slice().sort().join() === [A, B].sort().join() && v.team2HostTeam({ 0: A, 1: G }, 2, wr).slice().sort().join() === [A, B, G].sort().join());
  // late refusers (first seen after a verdict): accounts outside the known set whose every record refuses
  const lr = recsOf(match(9, 0x11E, R6, { 3: { rank: 0, tail: TAG | 1 }, 4: { rank: 0 }, 5: { rank: 0 } }));
  T('[1] team2LateRefusers: refusal-only accounts outside the known set', v.team2LateRefusers(lr, [v.pid(E), v.pid(F)]).join() === v.pid(D)
    && v.team2LateRefusers(lr, [v.pid(D), v.pid(E), v.pid(F)]).length === 0 && v.team2LateRefusers(recsOf(match(4, 0x11F, R4, { 2: { rank: 0 } })), []).length === 0);
}

// ---- [2] verdict rule: linked opposing hosts ----
{
  const now = 100 * 86400000;
  const s = (m, ago, h, o, x) => { const e = { m, t: now - ago, h, o: o | 0 }; if (x) e.x = x; return e; };
  T('[2] a modded pair taking turns hosting: one count', v.t2ldVerdict([s('a', 1000, 'H', 1, ['H', 'P'])], s('x', 0, 'P', 1, ['P', 'H']), now) === 'free');
  T('[2] the second host sat on the first one\'s team (any partner now): one count', v.t2ldVerdict([s('a', 1000, 'H', 1, ['H', 'P'])], s('x', 0, 'P', 1, ['P', 'Q']), now) === 'free');
  T('[2] a non-hosting friend on both opposing teams does not link two strangers', v.t2ldVerdict([s('a', 1000, 'S1', 1, ['S1', 'F'])], s('x', 0, 'S2', 1, ['S2', 'F']), now) === 'settle');
  T('[2] unrelated hosts: two counts', v.t2ldVerdict([s('a', 1000, 'H', 1, ['H', 'P'])], s('x', 0, 'G', 1, ['G', 'Q']), now) === 'settle');
  T('[2] links chain (H-P, P-Q): one count for three', v.t2ldVerdict([s('a', 2000, 'H', 1, ['H', 'P']), s('b', 1000, 'P', 1, ['P', 'Q'])], s('x', 0, 'Q', 1, ['Q', 'R']), now) === 'free');
  T('[2] K_HARD still convicts linked hosts', v.t2ldVerdict([s('a', 3000, 'H', 1, ['H', 'P']), s('b', 2000, 'P', 1, ['P', 'H']), s('c', 1000, 'H', 1, ['H', 'P'])], s('x', 0, 'P', 1, ['P', 'H']), now) === 'settle');
  T('[2] strikes without x (written before Q56) link by their host alone', v.t2ldVerdict([s('a', 1000, 'H', 1)], s('x', 0, 'H', 1), now) === 'free' && v.t2ldVerdict([s('a', 1000, 'P', 1)], s('x', 0, 'H', 1), now) === 'settle');
  T('[2] ... and a new strike whose team holds the old host links to it', v.t2ldVerdict([s('a', 1000, 'P', 1)], s('x', 0, 'H', 1, ['H', 'P']), now) === 'free');
  T('[2] own-side strikes still count each', v.t2ldVerdict([s('a', 1000, '', 0)], s('x', 0, '', 0), now) === 'settle');
  T('[2] an opposing link never absorbs an own-side strike', v.t2ldVerdict([s('a', 1000, 'H', 1, ['H', 'P'])], s('x', 0, '', 0), now) === 'settle');
}

// ---- [3] pass level ----
{
  const now = 100 * 86400000, pC = v.pid(C), pD = v.pid(D), pE = v.pid(E), pF = v.pid(F);
  const pass = (g, sg, extra) => {
    const m = keyOf(g[0].d), gr = { groups: { [m]: g }, consistentMatches: (extra && extra.cm) ? [{ m, g, void: false }] : [], inconsistentGroups: (extra && extra.cm) ? [] : [{ m, g }] };
    const res = v.applyTeam2LoneDissent(gr, sg, new Set(), now, vecOf);
    return { m, gr, res };
  };
  const old = (h, x) => ({ m: 'old', t: now - 86400000, h: v.pid(h), o: 1, x: x.map(s => v.pid(s)) });
  // a) both first strikes: free, only the two flagged, verdict stored for both
  const g = recsOf(match(6, 0x300, R4, { 2: { rank: 0 }, 3: { rank: 0 } }));
  const sgA = { players: {}, flagged: {}, t2ld: {} };
  const a = pass(g, sgA);
  T('[3a] both fresh: free, dropped', a.res.free === 1 && a.res.settle === 0 && a.gr.consistentMatches.length === 0 && a.gr.inconsistentGroups.length === 0);
  T('[3a] one strike each, opposing, with the host team', [pC, pD].every(p => sgA.t2ld[p] && sgA.t2ld[p].length === 1 && sgA.t2ld[p][0].o === 1 && (sgA.t2ld[p][0].x || []).slice().sort().join() === [v.pid(A), v.pid(B)].sort().join()));
  T('[3a] verdict stored for both', Array.isArray(sgA.t2lv[a.m].p) && sgA.t2lv[a.m].p.slice().sort().join() === [pC, pD].sort().join() && sgA.t2lv[a.m].v === 'free');
  T('[3a] only the two flagged; signals ld on each, lh twice on the host', sgA.players[pC].f === 1 && sgA.players[pD].f === 1 && !(sgA.players[v.pid(A)] || {}).f && sgA.players[pC].ld === 1 && sgA.players[pD].ld === 1 && sgA.players[v.pid(A)].lh === 2);
  // b) one of them due: settle, the other excused
  const sgB = { players: {}, flagged: {}, t2ld: { [pC]: [old(E, [E, F])] } };
  const b = pass(g, sgB);
  const eB = b.gr.consistentMatches[0];
  T('[3b] C due, D fresh: settle from the agreeing pair', b.res.settle === 1 && eB && eB.g.length === 2 && eB.g.every(r => r.steamID === A || r.steamID === B));
  T('[3b] D excused (t2ex), C not', eB && eB.t2ex.join() === pD && sgB.t2lv[b.m].ex.join() === pD && sgB.t2lv[b.m].v === 'settle');
  T('[3b] the excused one flagged, the due one not', sgB.players[pD].f === 1 && !sgB.players[pC].f);
  T('[3b] the key\'s record set is the agreeing side', b.gr.groups[b.m].length === 2);
  // c) the same records again: the stored verdict, no new strike, no new flag
  const c = pass(g, sgB);
  T('[3c] rerun: settle again with the same excused set, no new strike or flag', c.res.settle === 1 && c.gr.consistentMatches[0].t2ex.join() === pD && sgB.t2ld[pC].length === 2 && sgB.t2ld[pD].length === 1 && sgB.players[pD].f === 1);
  // d) the excused one's record rotated off: C alone looks like a lone dissent -- stored verdict, D still excused
  const d = pass(g.filter(r => r.steamID !== D), sgB);
  T('[3d] one record gone: stored verdict, D still excused', d.res.settle === 1 && d.gr.consistentMatches[0].t2ex.join() === pD && sgB.t2ld[pC].length === 2);
  // e) both dissenting records gone: the agreeing pair alone keeps the excused set
  const e = pass(g.filter(r => r.steamID === A || r.steamID === B), sgB, { cm: true });
  T('[3e] all dissenting records gone: the agreeing group carries t2ex', e.gr.consistentMatches.length === 1 && Array.isArray(e.gr.consistentMatches[0].t2ex) && e.gr.consistentMatches[0].t2ex.join() === pD);
  // f) a wholly different dissenter later: never convicted, no strike (Q51)
  const sgF = { players: {}, flagged: {}, t2ld: {}, t2lv: {} };
  const gF = recsOf(match(6, 0x301, R4, { 1: { rank: 0 } }));
  sgF.t2lv[keyOf(gF[0].d)] = { p: [pC, pD], t: now - 1000, v: 'settle', ex: [pD] };
  const f = pass(gF, sgF);
  T('[3f] a different later dissenter: free, no strike', f.res.free === 1 && f.res.settle === 0 && !sgF.t2ld[v.pid(B)]);
  // g) a free lone verdict, then his teammate's refusal lands and the teammate is due: settle, the first excused
  const sgG = { players: {}, flagged: {}, t2ld: { [pC]: [{ m: keyOf(g[0].d), t: now - 60000, h: v.pid(A), o: 1, x: [v.pid(A), v.pid(B)] }], [pD]: [old(E, [E, F])] } };
  sgG.t2lv = { [keyOf(g[0].d)]: { p: pC, t: now - 60000, v: 'free' } };
  sgG.flagged[keyOf(g[0].d)] = now - 60000; sgG.players[pC] = { g: 0, w: 0, v: 0, f: 1, ns: 0, at: now };
  const gg = pass(g, sgG);
  T('[3g] the late teammate is struck and due: the free verdict turns into a settle', gg.res.settle === 1 && sgG.t2ld[pD].length === 2 && sgG.t2lv[gg.m].v === 'settle');
  T('[3g] the earlier refuser (free) is excused, not struck again', gg.gr.consistentMatches[0].t2ex.join() === pC && sgG.t2ld[pC].length === 1 && sgG.players[pC].f === 1);
  // h) a settle lone verdict, then his teammate's refusal lands and the teammate is fresh: still settle, the late one excused + flagged
  const sgH = { players: {}, flagged: {}, t2ld: { [pC]: [old(E, [E, F]), { m: keyOf(g[0].d), t: now - 60000, h: v.pid(A), o: 1, x: [v.pid(A), v.pid(B)] }] } };
  sgH.t2lv = { [keyOf(g[0].d)]: { p: pC, t: now - 60000, v: 'settle' } };
  const hh = pass(g, sgH);
  T('[3h] a late fresh teammate cannot unsettle a settle verdict: settle, he is excused and flagged', hh.res.settle === 1 && hh.gr.consistentMatches[0].t2ex.join() === pD && sgH.t2ld[pD].length === 1 && sgH.players[pD].f === 1 && !(sgH.players[pC] || {}).f);
  // i) 3v3 two refusers with the third agreeing, neither due: free
  const g6 = recsOf(match(9, 0x302, R6, { 4: { rank: 0 }, 5: { rank: 0 } }));
  const sgI = { players: {}, flagged: {}, t2ld: {} };
  const ii = pass(g6, sgI);
  T('[3i] 3v3 pair, both fresh: free, both struck', ii.res.free === 1 && sgI.t2ld[pE].length === 1 && sgI.t2ld[pF].length === 1 && !(sgI.players[v.pid(D)] || {}).f);
  // j) the losing side refuses naming the host (client Q43 tag). Without Q63: left alone for the Q43 pass -- no
  //    strike, no verdict, still inconsistent. With Q63: such names cost them nothing (Q43 only counts them), so
  //    they are struck like any team refusal; only a key the Q43 pass charges is left alone (j2, j3)
  const gJ = recsOf(match(6, 0x303, R4, { 2: { rank: 0 }, 3: { rank: 0 } }).map(x => (x.d[5] >= 2 ? { sid: x.sid, d: x.d.concat([TAG | 1]) } : x)));
  const sgJ = { players: {}, flagged: {}, t2ld: { [pC]: [old(E, [E, F])] } };
  const jj = pass(gJ, sgJ);
  const untouched = (x, sg, n) => x.res.free === 0 && x.res.settle === 0 && sg.t2ld[pC].length === n && !sg.t2ld[pD] && !(sg.t2lv || {})[x.m] && !(sg.players[pC] || {}).f && x.gr.inconsistentGroups.length === 1;
  if (!Q63) T('[3j] refusers naming the host: untouched (no strike, no verdict, no flag, group kept)', untouched(jj, sgJ, 1));
  else {
    T('[3j] Q63: the losing side naming the host: struck as a team (C second: settle, D excused)', jj.res.settle === 1 && sgJ.t2ld[pC].length === 2 && sgJ.t2ld[pD].length === 1 && sgJ.t2lv[jj.m].v === 'settle' && sgJ.t2lv[jj.m].ex.join() === pD);
    const gJ2 = recsOf(match(6, 0x307, R4, { 0: { win: 1 }, 1: { win: 1 }, 2: { rank: 0 }, 3: { rank: 0 } }).map(x => (x.d[5] >= 2 ? { sid: x.sid, d: x.d.concat([TAG | 1]) } : x)));
    const sgJ2 = { players: {}, flagged: {}, t2ld: { [pC]: [old(E, [E, F])] } };
    T('[3j2] Q63: the winning side naming the host (Q43 strikes him): untouched', untouched(pass(gJ2, sgJ2), sgJ2, 1));
    const sgJ3 = { players: {}, flagged: {}, t2ld: { [pC]: [old(E, [E, F])] }, t2av: { [jj.m + '|' + v.pid(A)]: { t: now - 60000, v: 'free' } } };
    T('[3j3] Q63: a strike the Q43 pass stored on this key earlier: untouched, even for names that cost nothing now', untouched(pass(gJ, sgJ3), sgJ3, 1));
    // j4) whoever decides first owns the key: 3v3, E and F refuse naming B (costs them nothing) -- a team dissent,
    //     both fresh: free. Then B's record rotates off, so the same names now read 'left' (a Q43 strike). The
    //     stored verdict stands: still free, nobody struck again, B not flagged (the Q43 pass skips the key too)
    const gJ4 = recsOf(match(9, 0x309, R6, { 4: { rank: 0, tail: TAG | 2 }, 5: { rank: 0, tail: TAG | 2 } }));
    const sgJ4 = { players: {}, flagged: {}, t2ld: {} };
    const j4 = pass(gJ4, sgJ4);
    T('[3j4] first sight, names costing nothing: a team dissent, free, E and F struck', j4.res.free === 1 && sgJ4.t2ld[pE].length === 1 && sgJ4.t2ld[pF].length === 1 && sgJ4.t2lv[j4.m].v === 'free');
    const gJ4b = gJ4.filter(r => r.steamID !== B);
    T('[3j4] B rotated off: the same names are now a Q43 strike', v.team2AccusedKey(gJ4b, {}, j4.m) === true);
    const j4b = pass(gJ4b, sgJ4);
    T('[3j4] ... the stored verdict stands: free again, no new strike, B not flagged', j4b.res.free === 1 && j4b.gr.inconsistentGroups.length === 0 && sgJ4.t2ld[pE].length === 1 && sgJ4.t2ld[pF].length === 1 && !(sgJ4.players[v.pid(B)] || {}).f && sgJ4.t2lv[j4.m].v === 'free');
    v.applyTeam2Accusations({ groups: { [j4.m]: gJ4b }, consistentMatches: [], inconsistentGroups: [] }, sgJ4, new Set(), now);
    T('[3j4] ... and the Q43 pass leaves it too (B not struck)', !((sgJ4.t2ac || {})[v.pid(B)] || []).length && !(sgJ4.players[v.pid(B)] || {}).f);
    // j5) a group this pass does not take stays the Q43 pass's: the agreeing side split (A says his team won, B says
    //     the other one did), C and D refuse naming A. No team dissent here; the Q43 pass counts the names once
    //     (nocost: A's claim stands, the losers paid nothing) and a rerun of both passes counts nothing more
    const gJ5 = recsOf(match(6, 0x30A, R4, { 1: { win: 1 }, 2: { rank: 0, tail: TAG | 1 }, 3: { rank: 0, tail: TAG | 1 } }));
    const sgJ5 = { players: {}, flagged: {}, t2ld: {} };
    const both = () => { const x = pass(gJ5, sgJ5); v.applyTeam2Accusations(x.gr, sgJ5, new Set(), now); return x; };
    const j5 = both();
    T('[3j5] the agreeing side split: not this pass (no strike, no verdict), the Q43 pass counts the names once', j5.res.free === 0 && j5.res.settle === 0 && !sgJ5.t2ld[pC] && !sgJ5.t2ld[pD] && !(sgJ5.t2lv || {})[j5.m]
      && ((sgJ5.t2av || {})[j5.m + '|' + v.pid(A)] || {}).v === 'nocost' && (sgJ5.players[v.pid(A)] || {}).an === 1);
    both();
    T('[3j5] rerun: counted once only', (sgJ5.players[v.pid(A)] || {}).an === 1 && !sgJ5.t2ld[pC]);
  }
  // k) a refusal first seen after the verdict that breaks the shape is set aside (Q56 review R7b). 3v3, the host's
  //    teammate C never wrote; E and F refused against A and B and the verdict is settle; then their third teammate
  //    D's refusal lands -- three refusers against two agreeing accounts is no team dissent. Before: the group fell
  //    back to rank-conflict for good and E / F walked free. Now D is set aside. (Names play no part: every tree.)
  const pDd = v.pid(D);
  const gK = recsOf(match(9, 0x304, R6, { 3: { rank: 0 }, 4: { rank: 0 }, 5: { rank: 0 } }, [2]));
  const mK = keyOf(gK[0].d);
  const sgK = { players: {}, flagged: {}, t2ld: { [pE]: [old(G, [G, H]), { m: mK, t: now - 60000, h: v.pid(A), o: 1, x: [v.pid(A), v.pid(B), v.pid(C)] }] } };
  sgK.t2lv = { [mK]: { p: [pE, pF], t: now - 60000, v: 'settle', ex: [pF] } };
  sgK.flagged[mK] = now - 60000; sgK.players[pF] = { g: 0, w: 0, v: 0, f: 1, ns: 0, at: now };
  const kk = pass(gK, sgK);
  const eK = kk.gr.consistentMatches[0];
  T('[3k] a late refusal breaking the shape does not overturn a settle verdict', kk.res.settle === 1 && eK && eK.g.length === 2 && eK.g.every(r => [A, B].indexOf(r.steamID) >= 0) && kk.gr.groups[mK].length === 2);
  T('[3k] the late one is excused (in t2ex), flagged once, never struck; the stored verdict keeps him in lt', eK && eK.t2ex.slice().sort().join() === [pF, pDd].sort().join() && (sgK.players[pDd] || {}).f === 1 && !sgK.t2ld[pDd] && (sgK.t2lv[mK].lt || []).join() === pDd && sgK.t2lv[mK].v === 'settle');
  T('[3k] nobody else touched (no new strike, F not flagged again)', sgK.t2ld[pE].length === 2 && !sgK.t2ld[pF] && sgK.players[pF].f === 1 && !(sgK.players[pE] || {}).f);
  const kk2 = pass(gK, sgK);
  T('[3k] rerun: still settle, the late one not flagged twice', kk2.res.settle === 1 && kk2.gr.consistentMatches[0].t2ex.indexOf(pDd) >= 0 && (sgK.players[pDd] || {}).f === 1);
  // l) the refusing records rotated off, only the late one and the agreeing side left: the verdict and excused set stand
  const kk3 = pass(gK.filter(r => r.steamID !== E && r.steamID !== F), sgK);
  T('[3l] the known refusals gone, the late one still there: settle, both excused sets carried', kk3.res.settle === 0 && kk3.gr.consistentMatches.length === 1 && kk3.gr.consistentMatches[0].g.length === 2 && kk3.gr.consistentMatches[0].t2ex.slice().sort().join() === [pF, pDd].sort().join() && (sgK.players[pDd] || {}).f === 1);
  // m) a free verdict and a late refusal breaking the shape: still free (dropped), the late one flagged once, not struck
  const sgM = { players: {}, flagged: {}, t2ld: {} };
  sgM.t2lv = { [mK]: { p: [pE, pF], t: now - 60000, v: 'free', ex: [] } };
  sgM.flagged[mK] = now - 60000;
  const mm = pass(gK, sgM);
  T('[3m] a free verdict and a late refusal: dropped, the late one flagged once, no strike', mm.res.free === 1 && mm.gr.consistentMatches.length === 0 && mm.gr.inconsistentGroups.length === 0 && (sgM.players[pDd] || {}).f === 1 && !sgM.t2ld[pDd] && (sgM.t2lv[mK].lt || []).join() === pDd);
  pass(gK, sgM);
  T('[3m] rerun: not flagged twice', (sgM.players[pDd] || {}).f === 1);
  // n) a late account with a sane differing claim (not a refusal) is not set aside: unchanged (rank-conflict, left as is)
  const gN = recsOf(match(9, 0x305, R6, { 3: { scores: [1, 2, 3, 4, 5, 6] }, 4: { rank: 0 }, 5: { rank: 0 } }));
  const mN = keyOf(gN[0].d);
  const sgN = { players: {}, flagged: {}, t2ld: {} };
  sgN.t2lv = { [mN]: { p: [pE, pF], t: now - 60000, v: 'settle', ex: [] } };
  const nn = pass(gN, sgN);
  T('[3n] a late sane differing claim: not set aside, left as is', nn.res.settle === 0 && nn.res.free === 0 && nn.gr.inconsistentGroups.length === 1 && !(sgN.players[pDd] || {}).f && !sgN.t2lv[mN].lt);
  // o) no verdict yet: a refusal set that does not fit is never set aside (only a stored verdict is protected)
  const sgO = { players: {}, flagged: {}, t2ld: {} };
  const oo = pass(gK, sgO);
  // p) the known refusals gone, a late refusal AND a differing sane claim on the agreeing side: setting the late
  //    one aside leaves a new lone dissenter, not the stored ones -- a real conflict, left as is (never resolved here)
  const gP = recsOf(match(9, 0x306, R6, { 2: { scores: [1, 2, 3, 4, 5, 6] }, 3: { rank: 0 } })).filter(r => r.steamID !== E && r.steamID !== F);
  const mP = keyOf(gP[0].d);
  const sgP = { players: {}, flagged: {}, t2ld: {} };
  sgP.t2lv = { [mP]: { p: [pE, pF], t: now - 60000, v: 'settle', ex: [] } };
  const pp = pass(gP, sgP);
  T('[3p] set aside only when what is left is the stored verdict: a new lone dissenter behind it is left as is', pp.res.settle === 0 && pp.res.free === 0 && pp.gr.inconsistentGroups.length === 1 && !(sgP.players[pDd] || {}).f && !sgP.t2lv[mP].lt && !sgP.t2ld[v.pid(C)]);
  T('[3o] no stored verdict: nothing set aside, left as is', oo.res.settle === 0 && oo.res.free === 0 && oo.gr.inconsistentGroups.length === 1 && !(sgO.t2lv || {})[mK] && !(sgO.players[pDd] || {}).f);
  // q) the R7b case itself: all six wrote, the late third teammate D NAMES the host. Without Q63 the name breaks the
  //    shape and D is set aside like [3k]; with Q63 names do not, so D is struck as a teammate (fresh: excused)
  const gQ = recsOf(match(9, 0x308, R6, { 3: { rank: 0, tail: TAG | 1 }, 4: { rank: 0 }, 5: { rank: 0 } }));
  const mQ = keyOf(gQ[0].d);
  const sgQ = { players: {}, flagged: {}, t2ld: { [pE]: [old(G, [G, H]), { m: mQ, t: now - 60000, h: v.pid(A), o: 1, x: [v.pid(A), v.pid(B), v.pid(C)] }] } };
  sgQ.t2lv = { [mQ]: { p: [pE, pF], t: now - 60000, v: 'settle', ex: [pF] } };
  sgQ.flagged[mQ] = now - 60000; sgQ.players[pF] = { g: 0, w: 0, v: 0, f: 1, ns: 0, at: now };
  const qq = pass(gQ, sgQ), eQ = qq.gr.consistentMatches[0];
  T('[3q] the late refusal naming the host: still settle from A, B, C, D and F excused', qq.res.settle === 1 && eQ && eQ.g.length === 3 && eQ.g.every(r => [A, B, C].indexOf(r.steamID) >= 0)
    && eQ.t2ex.slice().sort().join() === [pF, pDd].sort().join() && (sgQ.players[pDd] || {}).f === 1 && sgQ.t2lv[mQ].v === 'settle');
  if (!Q63) T('[3q] without Q63: D set aside (never struck, kept in lt)', !sgQ.t2ld[pDd] && (sgQ.t2lv[mQ].lt || []).join() === pDd);
  else T('[3q] Q63: D struck as a teammate (one strike, in the verdict, excused), nothing set aside', (sgQ.t2ld[pDd] || []).length === 1 && sgQ.t2lv[mQ].p.indexOf(pDd) >= 0 && sgQ.t2lv[mQ].ex.slice().sort().join() === [pF, pDd].sort().join() && !sgQ.t2lv[mQ].lt);
  pass(gQ, sgQ);
  T('[3q] rerun: D not flagged or struck again', (sgQ.players[pDd] || {}).f === 1 && (sgQ.t2ld[pDd] || []).length === (Q63 ? 1 : 0));
}

// ---- [4] ranked 2v2, the whole other team refuses for the first time ----
let r4;
{
  const recs = match(6, 0x400, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  r4 = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x400, R4, FLOOR + 5 * 60000) } });
  T('[4] run exits 0', r4.code === 0, r4.out.slice(-800));
  T('[4] not settled', !processedOf(r4).has(m) && posts(r4, RATING).length === 0 && posts(r4, POINTS).length === 0);
  T('[4] only the two refusers flagged', fOf(r4, C) === 1 && fOf(r4, D) === 1 && fOf(r4, A) === 0 && fOf(r4, B) === 0, 'f=' + [A, B, C, D].map(s => fOf(r4, s)).join(','));
  T('[4] one strike each, match verdict free', strikesOf(r4, C) === 1 && strikesOf(r4, D) === 1 && sigOf(r4).t2lv[m].v === 'free');
  T('[4] logged per refuser and per match', /team2 team dissent .*seat 2 .*own verdict free/.test(r4.out) && /team2 team dissent .*2 dissenters -> match verdict free/.test(r4.out));
  const r4b = runCron(boardsWith(recs), advance(r4.state, v.STARTS_MATURITY_MS + 60000));
  T('[4] at maturity the orphan verdict processes it, no exit-rate hit for anyone', processedOf(r4b).has(m) && [A, B, C, D].every(s => leavesOf(r4b, s) === 0), r4b.out.slice(-600));
  T('[4] the refusers earn no consolation; the agreeing pair does', posts(r4b, PROGRESS).every(p => !/steamid=7656119800000000[34](&|$)/.test(p.body)) && [A, B].every(s => posts(r4b, PROGRESS).some(p => new RegExp('steamid=' + s + '(&|$)').test(p.body))));
  T('[4] still one strike each, f unchanged', strikesOf(r4b, C) === 1 && strikesOf(r4b, D) === 1 && fOf(r4b, C) === 1 && fOf(r4b, A) === 0);
}

// ---- [5] the same pair again, under an unrelated host: settles, both leavers, the winners rated as a team ----
{
  const RG = [G, H, C, D];   // host G, partner H: unrelated to A / B
  const recs = match(6, 0x500, RG, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const files = advance(r4.state, 3 * 86400000);
  files.STARTS_FILE = { [m]: startOf(6, 0x500, RG, FLOOR + 5 * 60000) };
  files.PROCESSED_FILE = [];
  const r = runSettle(boardsWith(recs, [A, B, C, D, G, H]), files);
  T('[5] run exits 0', r.code === 0, r.out.slice(-800));
  T('[5] verdict settle, two strikes each, nobody excused', strikesOf(r, C) === 2 && strikesOf(r, D) === 2 && sigOf(r).t2lv[m].v === 'settle' && sigOf(r).t2lv[m].ex.length === 0, JSON.stringify(sigOf(r).t2lv[m]));
  T('[5] settled; both refusers are leavers (-100 points, exit rate)', processedOf(r).has(m) && scoreTo(r, POINTS, C) === 1900 && scoreTo(r, POINTS, D) === 1900 && leavesOf(r, C) === 1 && leavesOf(r, D) === 1, [C, D].map(s => scoreTo(r, POINTS, s) + '/' + leavesOf(r, s)).join(' '));
  T('[5] the winners gain points', scoreTo(r, POINTS, G) > 2000 && scoreTo(r, POINTS, H) > 2000, [G, H].map(s => scoreTo(r, POINTS, s)).join(','));
  const sG = skillOf(r, G), sH = skillOf(r, H);
  T('[5] both winners\' hidden rating rises (no rating moved between teammates)', sG && sH && sG.mu > tsm.MU0 && sH.mu > tsm.MU0, JSON.stringify([sG, sH]));
  T('[5] the absent team\'s ratings never move', !skillOf(r, C) && !skillOf(r, D) && scoreTo(r, RATING, C) == null && scoreTo(r, RATING, D) == null);
  T('[5] logged', /whole team 1 absent -> rated against its 2 pre-match rating/.test(r.out) && /leaver .* seat 2 = /.test(r.out) && /leaver .* seat 3 = /.test(r.out));
  T('[5] the agreeing pair is not flagged', fOf(r, G) === 0 && fOf(r, H) === 0);
}

// ---- [6] a main account with a fresh partner: the main is the leaver, the partner excused ----
{
  const recs = match(6, 0x600, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const sg = signalsWith({ [v.pid(C)]: [strikeIn('earlier', 86400000, G, [G, H])] });
  const r = runSettle(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x600, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[6] run exits 0', r.code === 0, r.out.slice(-800));
  T('[6] settled from the agreeing pair', processedOf(r).has(m) && sigOf(r).t2lv[m].v === 'settle');
  T('[6] the main (second strike) is the leaver', scoreTo(r, POINTS, C) === 1900 && leavesOf(r, C) === 1 && strikesOf(r, C) === 2);
  T('[6] the fresh partner is excused: struck and flagged, no leave, no points, no rating', strikesOf(r, D) === 1 && fOf(r, D) === 1 && leavesOf(r, D) === 0 && scoreTo(r, POINTS, D) == null && scoreTo(r, RATING, D) == null && !skillOf(r, D));
  T('[6] excused line logged', /leaver .* seat 3 = .*excused, no conviction/.test(r.out));
  T('[6] the winners rated and paid', [A, B].every(s => scoreTo(r, RATING, s) != null && scoreTo(r, POINTS, s) > 2000));
  T('[6] the main is not flagged (convicted instead)', fOf(r, C) === 0);
}

// ---- [6b] the excused partner has no points this season yet: no placement seed for him ----
{
  const recs = match(6, 0x601, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const sg = signalsWith({ [v.pid(C)]: [strikeIn('earlier', 86400000, G, [G, H])] });
  const r = runSettle(boardsWith(recs, [A, B, C]), { STARTS_FILE: { [m]: startOf(6, 0x601, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[6b] run exits 0', r.code === 0, r.out.slice(-800));
  T('[6b] settled, the main is the leaver', processedOf(r).has(m) && scoreTo(r, POINTS, C) === 1900);
  T('[6b] the excused partner gets no placement seed (no points write, no leaver seed line)', scoreTo(r, POINTS, D) == null && !/leaver, first settle this season/.test(r.out));
}

// ---- [7] framed by a modded pair taking turns hosting ----
{
  // both C and D were cut once before in a match hosted by B (A his partner then); now A hosts with B: linked
  const recs = match(6, 0x700, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const sg = signalsWith({ [v.pid(C)]: [strikeIn('earlier', 86400000, B, [B, A])], [v.pid(D)]: [strikeIn('earlier', 86400000, B, [B, A])] });
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x700, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[7] still free, nobody leaves', sigOf(r).t2lv[m].v === 'free' && !processedOf(r).has(m) && leavesOf(r, C) === 0 && leavesOf(r, D) === 0, r.out.slice(-500));
  T('[7] the strikes are recorded (two each)', strikesOf(r, C) === 2 && strikesOf(r, D) === 2);
  // the same victims under an unrelated host now: settle (the linked pair counted once, the new host once)
  const RG = [G, H, C, D];
  const recs2 = match(6, 0x701, RG, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r.state, 86400000);
  f2.STARTS_FILE = { [m2]: startOf(6, 0x701, RG, FLOOR + 5 * 60000) };
  const r2 = runSettle(boardsWith(recs2, [A, B, C, D, G, H]), f2);
  T('[7] then an unrelated host: settle', sigOf(r2).t2lv[m2].v === 'settle' && processedOf(r2).has(m2) && leavesOf(r2, C) === 1 && leavesOf(r2, D) === 1, r2.out.slice(-500));
}

// ---- [7b] the same modded pair taking turns hosting, each leaving the partner's seat blank in its own roster ----
{
  // review R4: the host team used to come from the agreeing roster consensus only -- written by the modded pair
  //   itself -- so a blank partner seat stored x = [host] and the two matches did not link. The writers count now.
  const recs = match(6, 0x710, R4, { 0: { ros: [A, '0', C, D] }, 1: { ros: [A, '0', C, D] }, 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x710, R4, FLOOR + 5 * 60000) } });
  const xOf = (rr, sid) => ((sigOf(rr).t2ld || {})[v.pid(sid)] || []).map(e => (e.x || []).slice().sort().join('|'));
  T('[7b] first match: free, the stored host team holds both modded accounts', r.code === 0 && sigOf(r).t2lv[m].v === 'free' && xOf(r, C).join() === [v.pid(A), v.pid(B)].sort().join('|'), r.out.slice(-500));
  const RB = [B, A, C, D];   // now B hosts, A his partner, and both leave A's seat blank
  const recs2 = match(6, 0x711, RB, { 0: { ros: [B, '0', C, D] }, 1: { ros: [B, '0', C, D] }, 2: { rank: 0 }, 3: { rank: 0 } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r.state, 2 * 86400000);
  f2.STARTS_FILE = { [m2]: startOf(6, 0x711, RB, FLOOR + 5 * 60000) };
  const r2 = runSettle(boardsWith(recs2), f2);
  T('[7b] second match: still free, the victims are not leavers and lose no points', r2.code === 0 && sigOf(r2).t2lv[m2].v === 'free' && !processedOf(r2).has(m2)
    && leavesOf(r2, C) === 0 && leavesOf(r2, D) === 0 && scoreTo(r2, POINTS, C) == null && scoreTo(r2, POINTS, D) == null, r2.out.slice(-500));
  T('[7b] two strikes each, both stored with the two-account host team', strikesOf(r2, C) === 2 && strikesOf(r2, D) === 2 && xOf(r2, D).every(x => x.split('|').length === 2));
}

// ---- [8] ranked 3v3: two refusers, their third teammate agrees ----
{
  const recs = match(9, 0x800, R6, { 4: { rank: 0 }, 5: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const sg = signalsWith({ [v.pid(E)]: [strikeIn('earlier', 86400000, G, [G, H])] });
  const r = runSettle(boardsWith(recs, [A, B, C, D, E, F]), { STARTS_FILE: { [m]: startOf(9, 0x800, R6, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[8] run exits 0', r.code === 0, r.out.slice(-800));
  T('[8] settled; E (second strike) leaver, F excused', processedOf(r).has(m) && leavesOf(r, E) === 1 && scoreTo(r, POINTS, E) === 1900 && leavesOf(r, F) === 0 && scoreTo(r, POINTS, F) == null && fOf(r, F) === 1, [E, F].map(s => leavesOf(r, s) + '/' + scoreTo(r, POINTS, s)).join(' '));
  T('[8] the four agreeing writers rated, the third teammate among them', [A, B, C, D].every(s => scoreTo(r, RATING, s) != null) && scoreTo(r, RATING, E) == null && scoreTo(r, RATING, F) == null);
  T('[8] no whole-team fallback (the third teammate is present)', !/whole team .* absent/.test(r.out));
  const pD = scoreTo(r, POINTS, D);
  T('[8] the third teammate loses at most a shielded amount', pD != null && pD < 2000 && pD >= 2000 - 30, 'D pts ' + pD);
}

// ---- [9] a refusal arriving a run later beside a stored one ----
{
  // run 1: only C has written (refusal); D is still missing -> Q51 lone dissent, C fresh: free
  const all = match(6, 0x900, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(all[0].d);
  const sg = signalsWith({ [v.pid(D)]: [strikeIn('earlier', 86400000, G, [G, H])] });
  const r1 = runCron(boardsWith(all.filter(x => x.sid !== D)), { STARTS_FILE: { [m]: startOf(6, 0x900, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[9] run 1: C alone, a lone dissent, free', sigOf(r1).t2lv[m] && sigOf(r1).t2lv[m].v === 'free' && strikesOf(r1, C) === 1 && /team2 lone dissent .*verdict free/.test(r1.out), r1.out.slice(-400));
  // run 2: D's refusal lands; D is due -> the match settles, D leaver, C excused
  const r2 = runSettle(boardsWith(all), advance(r1.state, 60000));
  T('[9] run 2: D struck and due, the verdict turns into a settle', strikesOf(r2, D) === 2 && sigOf(r2).t2lv[m].v === 'settle' && processedOf(r2).has(m), r2.out.slice(-600));
  T('[9] D leaver; C excused (not struck again, flagged once)', leavesOf(r2, D) === 1 && leavesOf(r2, C) === 0 && strikesOf(r2, C) === 1 && fOf(r2, C) === 1 && scoreTo(r2, POINTS, C) == null);
}

// ---- [9b] a settle verdict, then the third teammate's refusal naming the host lands inside the absent-seat grace ----
{
  // review R7b: the late named refusal broke the shape and the group fell back to rank-conflict for good, so the
  //   two refusers already due walked free. Now the late one is set aside (without Q63) or struck as a teammate
  //   (Q63: names that cost nothing do not break the shape); either way excused, and the match settles.
  const all = match(9, 0x910, R6, { 3: { rank: 0, tail: TAG | 1 }, 4: { rank: 0 }, 5: { rank: 0 } });
  const m = keyOf(all[0].d);
  const sg = signalsWith({ [v.pid(E)]: [strikeIn('earlier', 86400000, G, [G, H])], [v.pid(F)]: [strikeIn('earlier', 86400000, G, [G, H])] });
  const r1 = runCron(boardsWith(all.filter(x => x.sid !== D)), { STARTS_FILE: { [m]: startOf(9, 0x910, R6, FLOOR + 5 * 60000) }, SIGNALS_FILE: sg });
  T('[9b] run 1: E and F due, verdict settle, held for the absent seat', r1.code === 0 && sigOf(r1).t2lv[m] && sigOf(r1).t2lv[m].v === 'settle' && !processedOf(r1).has(m), r1.out.slice(-500));
  const r2a = runCron(boardsWith(all), advance(r1.state, 60000));
  const r2 = (/absent-hold /.test(r2a.out) && v.ABSENT_GRACE_MS) ? runCron(boardsWith(all), advance(r2a.state, v.ABSENT_GRACE_MS + 60000)) : r2a;
  T('[9b] D\'s late refusal does not overturn it: settled, E and F leavers', r2.code === 0 && processedOf(r2).has(m) && leavesOf(r2, E) === 1 && leavesOf(r2, F) === 1 && scoreTo(r2, POINTS, E) === 1900 && scoreTo(r2, POINTS, F) === 1900, r2.out.slice(-800));
  T('[9b] D excused (no leave, no points), flagged once', leavesOf(r2, D) === 0 && scoreTo(r2, POINTS, D) == null && fOf(r2, D) === 1, 'f ' + fOf(r2, D) + ' leaves ' + leavesOf(r2, D));
  if (!Q63) T('[9b] without Q63: D set aside, never struck', strikesOf(r2, D) === 0 && (sigOf(r2).t2lv[m].lt || []).join() === v.pid(D) && /first seen after the verdict \(settle\) -> set aside, excused/.test(r2a.out), 'lt ' + JSON.stringify(sigOf(r2).t2lv[m].lt));
  else T('[9b] Q63: D struck once as a teammate (fresh: excused), nothing set aside', strikesOf(r2, D) === 1 && !sigOf(r2).t2lv[m].lt && /team2 team dissent [^\n]*seat 3 [^\n]*-> strike, own verdict free/.test(r2a.out), r2a.out.slice(-600));
  T('[9b] the winners rated and paid, nobody on their side flagged', [A, B, C].every(s => scoreTo(r2, RATING, s) != null && scoreTo(r2, POINTS, s) > 2000 && fOf(r2, s) === 0));
}

// ---- [10] one refusal + one sane differing record: not this shape, unchanged ----
{
  const recs = match(6, 0xA00, R4, { 2: { rank: 0 }, 3: { scores: [1, 2, 3, 4] } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0xA00, R4, FLOOR + 5 * 60000) } });
  T('[10] not settled, every writer flagged, no strike', !processedOf(r).has(m) && [A, B, C, D].every(s => fOf(r, s) === 1) && strikesOf(r, C) === 0 && strikesOf(r, D) === 0 && !(sigOf(r).t2lv || {})[m], 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
}

// ---- [10b] the losing side refuses naming the host (client Q43 tag): the names cost them nothing ----
{
  const recs = match(6, 0xA10, R4, { 2: { rank: 0 }, 3: { rank: 0 } }).map(x => (x.d[5] >= 2 ? { sid: x.sid, d: x.d.concat([TAG | 1]) } : x));
  const m = keyOf(recs[0].d);
  const r = runSettle(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0xA10, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: signalsWith({ [v.pid(C)]: [strikeIn('old', 86400000, E, [E, F])] }) });
  T('[10b] run exits 0', r.code === 0, r.out.slice(-800));
  const acA = ((sigOf(r).t2ac || {})[v.pid(A)] || []).length, anA = ((sigOf(r).players || {})[v.pid(A)] || {}).an | 0;
  if (!Q63) {
    T('[10b] without Q63: not a team dissent, the victims not struck even when one already has a strike', !processedOf(r).has(m) && strikesOf(r, C) === 1 && strikesOf(r, D) === 0 && !(sigOf(r).t2lv || {})[m] && !/team2 team dissent/.test(r.out));
    T('[10b] ... as before Q56 (every writer flagged), the host never struck' + (Q43 ? '; the Q43 pass only counts the names' : ''), [A, B, C, D].every(s => fOf(r, s) === 1) && acA === 0 && anA === (Q43 ? 1 : 0), 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(',') + ' ac ' + acA + ' an ' + anA);
  } else {
    T('[10b] Q63: struck as a team: C second (leaver), D excused, the match settles', processedOf(r).has(m) && strikesOf(r, C) === 2 && strikesOf(r, D) === 1 && leavesOf(r, C) === 1 && leavesOf(r, D) === 0 && fOf(r, D) === 1, r.out.slice(-600));
    T('[10b] Q63: the host neither struck nor flagged; the winners paid', acA === 0 && fOf(r, A) === 0 && fOf(r, B) === 0 && scoreTo(r, POINTS, A) > 2000 && scoreTo(r, POINTS, B) > 2000);
  }
}

// ---- [10c] the winning side refuses naming the host (they threw away a win): never this pass ----
{
  const recs = match(6, 0xA20, R4, { 0: { win: 1 }, 1: { win: 1 }, 2: { rank: 0 }, 3: { rank: 0 } }).map(x => (x.d[5] >= 2 ? { sid: x.sid, d: x.d.concat([TAG | 1]) } : x));
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0xA20, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: signalsWith({ [v.pid(C)]: [strikeIn('old', 86400000, E, [E, F])] }) });
  T('[10c] run exits 0', r.code === 0, r.out.slice(-800));
  T('[10c] not settled, the victims never struck by this pass', !processedOf(r).has(m) && strikesOf(r, C) === 1 && strikesOf(r, D) === 0 && !(sigOf(r).t2lv || {})[m] && !/team2 team dissent/.test(r.out));
  if (Q43) T('[10c] with the Q43 pass: the host takes the strike, only he is flagged', ((sigOf(r).t2ac || {})[v.pid(A)] || []).length === 1 && fOf(r, A) === 1 && [B, C, D].every(s => fOf(r, s) === 0), 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
  else T('[10c] without the Q43 pass: as before Q56 (every writer flagged)', [A, B, C, D].every(s => fOf(r, s) === 1), 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
}

// ---- [11] wiring pins ----
{
  T('[11] exports', typeof v.team2TeamDissent === 'function' && typeof v.team2Dissent === 'function' && typeof v.team2HostTeam === 'function' && typeof v.team2LateRefusers === 'function'
    && (Q63 ? typeof v.team2AccusedKey === 'function' && v.team2NamesSeat === undefined : typeof v.team2NamesSeat === 'function'));
  const pass = SRC.slice(SRC.indexOf('function applyTeam2LoneDissent'), SRC.indexOf('function leaverLpPenalty'));
  T('[11] the pass detects through team2Dissent', /(?:const|let) td = team2Dissent\(g, vecOf\)/.test(pass));
  if (Q63) T('[11] Q63: the pass leaves a key the Q43 pass charges, at first sight only', /if \(!prev && td && team2AccusedKey\(g, signals, m\)\) td = null;/.test(pass));
  const loop = SRC.slice(SRC.indexOf('const leavers0 = detectLeavers(g)'), SRC.indexOf('processed.add(c.m); settled++;'));
  T('[11] the settle loop reads the excused set from the entry', /const t2ex = new Set\(Array\.isArray\(c\.t2ex\)/.test(loop));
  T('[11] excused: no placement seed, no conviction', /if \(t2ex\.has\(pid\(String\(x\.steamID\)\)\)\) continue;/.test(loop) && /team-gamble dissent not yet due -- excused/.test(loop));
  T('[11] whole-team-absent rating only for a dissent settle', /Array\.isArray\(c\.t2ex\)\)\s*\n?\s*\? leavers0\.filter/.test(loop));
}

if (failN) { console.log('team2-team-dissent: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-team-dissent: all passed');
