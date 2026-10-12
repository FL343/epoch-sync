'use strict';
// Team-gamble dissent, the dissenter's own seat claim (cloud audit Q76, follow-up to Q51 / Q56): the lone dissent
// (Q51) and team dissent (Q56) took a dissenter's seat from his OWN record and gave up -- back to 'rank-conflict',
// unsettled for everybody, every writer flagged, nobody struck -- when that seat was an agreeing writer's, out of
// range, or not the same on all his records. One modded dissenter writing his seat as the host's (or adding a second
// record at another seat) voided the match at will and charged the three honest writers instead of himself. Same
// class in the team shape: a second, non-refusal record moved a refuser onto the agreeing side and broke the shape.
// Now his seat is where the agreeing writers' roster names him, and one refusal makes an account a refuser.
//   [1] lone shape (team2LoneDissent): claimed seat ignored (agreeing seat, host seat, out of range, a second record
//       at another seat); the side (opp) follows the roster, never his claim; still none when the roster does not
//       name him or names him at an agreeing writer's own seat
//   [2] team shape (team2TeamDissent / team2LateRefusers): claimed seats ignored, a second non-refusal record keeps
//       a refuser a refuser and out of the agreeing side; one refusal + one sane differing claim from two accounts
//       is still not this shape; the cross-team rule follows the roster
//   [3] real main(): the review4-q43 4b / 4c attacks (lone dissenter claims the host's seat; writes a second record
//       at another seat) never flag the honest writers again; on his first strike the match stays unsettled with
//       only him flagged, on his second it settles and he is the leaver; the team shape with a claimed seat strikes
//       both refusers, and with a second, agreeing record (both already struck once elsewhere) settles with both as
//       leavers; the claimed seat is logged; an honest refusal logs as before. Runs on trees with and without the
//       pending start-roster filter (Q80), which drops a misplaced record before this pass
//   [4] wiring pins
// Runs the REAL validate.js main() against an offline board stub (test/team2-lone-dissent.js harness).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
process.env.STATE_SALT = 's';
const v = require(path.join(__dirname, '..', 'validate.js'));

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-seat-'));
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
// with the absent-seat hold in (R1-B2-04), a settle that leaves the dissenter's seat without a record waits one grace
//   (the returned output holds both runs: the strike is logged by the first)
function runSettle(boards, files) {
  const r = runCron(boards, files);
  if (!(/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS)) return r;
  const r2 = runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000));
  return Object.assign(r2, { out: r.out + r2.out });
}
const posts = (r, boardId) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body));
const scoreTo = (r, boardId, sid) => { const p = posts(r, boardId).filter(x => new RegExp('steamid=' + sid + '(&|$)').test(x.body)); return p.length ? Number(/score=(-?[0-9]+)/.exec(p[p.length - 1].body)[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const sigOf = (r) => r.state.SIGNALS_FILE || { players: {} };
const fOf = (r, sid) => ((sigOf(r).players || {})[v.pid(sid)] || {}).f | 0;
const strikesOf = (r, sid) => ((sigOf(r).t2ld || {})[v.pid(sid)] || []).length;
const leavesOf = (r, sid) => (((r.state.LEAVERS_FILE || {})[v.pid(sid)]) || {}).leaves | 0;

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005', F = '76561198000000006';
const G = '76561198000000007', H = '76561198000000008';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const RATING = 6, POINTS = 7, PROGRESS = 5;
// mode-2 settle record written from `seat`. roster: sids by seat (seat 0 = host); win: winning team (0 = seats < ts);
//   o.rank / o.scores / o.win override; o.as = the seat the record CLAIMS (default: the real one); o.ros = the roster
//   this writer writes
function t2(mt, hash, seat, roster, o) {
  o = o || {};
  const pc = roster.length, ts = pc / 2, win = o.win == null ? 0 : o.win;
  const scores = o.scores || roster.map((s, i) => 6000 - 500 * i);
  const myTeam = (seat / ts) | 0, inBlock = seat % ts;
  const rank = o.rank != null ? o.rank : ((myTeam === win) ? 1 + inBlock : ts + 1 + inBlock);
  const d = [0xB1, 3, mt, hash | 0, 4321, o.as == null ? seat : o.as, rank, (6 << 1) | (myTeam === win ? 1 : 0), pc, 900].concat(scores, [o.disp | 0]);
  for (const s of (o.ros || roster)) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d;
}
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
function boardsWith(recs, sids) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {};
  for (const r of recs) { used[r.sid] = used[r.sid] || 0; boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: PROGRESS, name: 'progress', entries: [] }, { id: RATING, name: 'rating', entries: [] },
    { id: POINTS, name: 'points', entries: (sids || [A, B, C, D, E, F, G, H]).map(s => ({ steamID: s, score: 2000 })) }, { id: 8, name: 'cp_bank', entries: [] });
  return boards;
}
// one match's records: every roster seat writes, `dis` (seat -> overrides) changes some; `extra` = more records
//   [{ seat, o }] written by the account at that real seat (a second record lands on its next shard)
function match(mt, hash, roster, dis, extra) {
  const out = [];
  roster.forEach((sid, seat) => { out.push({ sid, d: t2(mt, hash, seat, roster, (dis || {})[seat]) }); });
  for (const x of (extra || [])) out.push({ sid: roster[x.seat], d: t2(mt, hash, x.seat, roster, x.o) });
  return out;
}
function startOf(mt, hash, roster, ago) {
  const ros = {}; roster.forEach((s, i) => { ros[i] = v.pid(s); });
  return { t0: Date.now() - ago, mt, roster: ros, settled: [] };
}
const FLOOR = v.SANITY.MIN_START_AGE_MS;
const R4 = [A, B, C, D];   // host A; team 0 = A, B; team 1 = C, D
const R6 = [A, B, C, D, E, F];   // host A; team 0 = A, B, C; team 1 = D, E, F
const vecOf = r => JSON.stringify(r.d.slice(10, 10 + (r.d[8] | 0)));
const recsOf = (list) => list.map(x => ({ steamID: x.sid, d: x.d, dispCode: x.d[10 + (x.d[8] | 0)] | 0, roster: v.decodeRoster(x.d) }));
const lone = (mt, h, ros, dis, extra) => v.team2LoneDissent(recsOf(match(mt, h, ros, dis, extra)), vecOf);
const team = (mt, h, ros, dis, extra) => v.team2TeamDissent(recsOf(match(mt, h, ros, dis, extra)), vecOf);

// ---- [1] lone shape ----
{
  const c0 = lone(6, 0x100, R4, { 2: { rank: 0 } });
  T('[1] control: honest refusal at seat 2, opposing host', c0 && c0.sid === C && c0.seat === 2 && c0.opp === 1);
  for (const [as, what] of [[1, 'an agreeing writer\'s seat'], [0, 'the host\'s seat'], [3, 'his teammate\'s seat'], [7, 'a seat out of range'], [-1, 'a negative seat']]) {
    const x = lone(6, 0x110 + (as & 0xF), R4, { 2: { rank: 0, as } });
    T('[1] claims ' + what + ' (' + as + '): found at the roster seat 2, opposing', x && x.sid === C && x.seat === 2 && x.opp === 1 && x.recs.length === 1, x && JSON.stringify({ seat: x.seat, opp: x.opp }));
  }
  const two = lone(6, 0x120, R4, { 2: { rank: 0 } }, [{ seat: 2, o: { rank: 0, as: 0 } }]);
  T('[1] a second refusal at another seat (review4 4c): found, both records his, seat 2', two && two.sid === C && two.seat === 2 && two.recs.length === 2);
  const twoS = lone(6, 0x121, R4, { 2: { rank: 0, as: 3 } }, [{ seat: 2, o: { rank: 0, as: 1 } }]);
  T('[1] two records, neither at his real seat: found, seat 2', twoS && twoS.sid === C && twoS.seat === 2 && twoS.recs.length === 2);
  const mixed = lone(6, 0x122, R4, { 2: { rank: 0 } }, [{ seat: 2, o: {} }]);
  T('[1] a refusal plus an agreeing record: still the dissenter (one disagreeing record is enough, as before)', mixed && mixed.sid === C && mixed.recs.length === 2);
  // the side follows the roster: his claim can neither move him off the host's team nor onto it
  const own = lone(6, 0x130, R4, { 1: { rank: 0, as: 3 } });
  T('[1] the host\'s teammate claiming a seat on the other team: still own-side (opp 0)', own && own.sid === B && own.seat === 1 && own.opp === 0);
  const opp = lone(6, 0x131, R4, { 3: { rank: 0, as: 1 } });
  T('[1] an opponent claiming a seat on the host\'s team: still opposing (opp 1)', opp && opp.sid === D && opp.seat === 3 && opp.opp === 1);
  const host = lone(6, 0x132, R4, { 0: { rank: 0, as: 2 } });
  T('[1] the host refusing and claiming another seat: found at seat 0, own-side', host && host.sid === A && host.seat === 0 && host.opp === 0);
  // still none
  const outsider = recsOf(match(6, 0x140, R4, { 2: { rank: 0 } })).map(r => (r.steamID === C ? Object.assign({}, r, { steamID: E }) : r));
  T('[1] a refusing writer the roster does not name: none', v.team2LoneDissent(outsider, vecOf) === null);
  const blank = { ros: [A, B, '0', D] };
  T('[1] the agreeing rosters leave his seat blank: none', lone(6, 0x141, R4, { 0: blank, 1: blank, 2: { rank: 0 } }) === null);
  const swap = { ros: [A, B, D, C] };   // A and B put C at seat 3, where D (an agreeing writer) sits and names himself
  T('[1] the roster names him at an agreeing writer\'s own seat: none', lone(6, 0x142, R4, { 0: swap, 1: swap, 2: { rank: 0, as: 3 } }) === null);
  T('[1] everyone agrees: none', lone(6, 0x143, R4) === null);
  T('[1] two dissenters, one claiming the host\'s seat: none here (the team shape takes it)', lone(6, 0x144, R4, { 2: { rank: 0 }, 3: { rank: 0, as: 0 } }) === null);
  const l6 = lone(9, 0x150, R6, { 5: { rank: 0, as: 0 } });
  T('[1] ranked 3v3, claims the host\'s seat: found at seat 5, opposing', l6 && l6.sid === F && l6.seat === 5 && l6.opp === 1);
}

// ---- [2] team shape ----
{
  const c0 = team(6, 0x200, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  T('[2] control: the other team refuses, seats 2 and 3', c0 && c0.ds.map(d => d.sid + '@' + d.seat).join() === C + '@2,' + D + '@3' && c0.rest.length === 2);
  const s0 = team(6, 0x201, R4, { 2: { rank: 0 }, 3: { rank: 0, as: 0 } });
  T('[2] one refuser claims the host\'s seat: found, seats from the roster', s0 && s0.ds.map(d => d.sid + '@' + d.seat).join() === C + '@2,' + D + '@3' && s0.ds.every(d => d.opp === 1));
  const same = team(6, 0x202, R4, { 2: { rank: 0, as: 1 }, 3: { rank: 0, as: 1 } });
  T('[2] both claim the same agreeing seat: found, 2 and 3', same && same.ds.map(d => d.seat).join() === '2,3');
  const dupS = team(6, 0x203, R4, { 2: { rank: 0 }, 3: { rank: 0 } }, [{ seat: 3, o: { rank: 0, as: 1 } }]);
  T('[2] one refuser adds a second refusal at another seat: found, his two records', dupS && dupS.ds.length === 2 && dupS.ds[1].sid === D && dupS.ds[1].recs.length === 2);
  const mixA = team(6, 0x204, R4, { 2: { rank: 0 }, 3: { rank: 0 } }, [{ seat: 3, o: {} }]);
  T('[2] one refuser adds a second record that agrees with the result: still a refuser, the agreeing side is A and B only',
    mixA && mixA.ds.map(d => d.sid).join() === C + ',' + D && mixA.rest.length === 2 && mixA.rest.every(r => r.steamID === A || r.steamID === B));
  const mixB = team(6, 0x205, R4, { 2: { rank: 0 }, 3: { rank: 0 } }, [{ seat: 3, o: { win: 1, scores: [1000, 900, 6000, 5500] } }]);
  T('[2] ... or a second record claiming the other result: still a refuser', mixB && mixB.ds.length === 2 && mixB.rest.length === 2);
  const mixFirst = recsOf(match(6, 0x206, R4, { 2: { rank: 0 } }, [{ seat: 3, o: { rank: 0 } }]));   // D: agreeing record first, refusal second
  const mf = v.team2TeamDissent(mixFirst, vecOf);
  T('[2] the agreeing record read first, the refusal second: still a refuser', mf && mf.ds.map(d => d.sid).join() === C + ',' + D);
  T('[2] through team2Dissent: the team shape (lone false)', (() => { const x = v.team2Dissent(recsOf(match(6, 0x207, R4, { 2: { rank: 0 } , 3: { rank: 0, as: 0 } })), vecOf); return x && x.lone === false && x.ds.length === 2; })());
  // still none
  T('[2] one refusal + one sane differing claim from two accounts (one record each): none, as before', team(6, 0x210, R4, { 2: { rank: 0 }, 3: { scores: [1, 2, 3, 4] } }) === null);
  T('[2] refusers on both teams by the roster, one claiming a seat on the other\'s team: none', team(6, 0x211, R4, { 1: { rank: 0, as: 3 }, 2: { rank: 0 } }) === null);
  T('[2] the host refusing with his teammate, claiming the other team\'s seats: none (the agreeing side lacks the host)', team(6, 0x212, R4, { 0: { rank: 0, as: 2 }, 1: { rank: 0, as: 3 } }) === null);
  const t6 = team(9, 0x220, R6, { 4: { rank: 0, as: 0 }, 5: { rank: 0, as: 1 } });
  T('[2] ranked 3v3, two refusers claiming host-team seats: found at 4 and 5, third teammate agreeing', t6 && t6.ds.map(d => d.seat).join() === '4,5' && t6.rest.length === 4);
  // late refusers count an account the way the shape does
  const lr = recsOf(match(9, 0x230, R6, { 4: { rank: 0 }, 5: { rank: 0 } }, [{ seat: 3, o: { rank: 0 } }]));   // D: an agreeing record and a refusal
  T('[2] team2LateRefusers: an account with a refusal among its records is a late refuser', v.team2LateRefusers(lr, [v.pid(E), v.pid(F)]).join() === v.pid(D)
    && v.team2LateRefusers(lr, [v.pid(D), v.pid(E), v.pid(F)]).length === 0);
}

// ---- [3] real main() ----
// The start-roster filter (cloud audit Q80, in the pending batch) drops a record whose writer the start roster seats
//   elsewhere before this pass runs: on such a tree a claimed seat never reaches the dissent shapes (that writer is an
//   absentee, a leaver only with his own start attestation -- Q69). The outcomes below hold on both trees; the lines
//   that only one tree can show are asked for on that tree.
const Q80 = /not counted \(Q80\)/.test(SRC);
// a stored strike in an earlier match: host `h`, o = the host played on the other team, x = his team
const strikeIn = (m, ago, h, o, x) => Object.assign({ m, t: Date.now() - ago, h: v.pid(h), o }, x ? { x: x.map(s => v.pid(s)) } : {});
{
  // [3a] the review4-q43 4b attack, first time: B (host A's teammate) refuses and writes his seat as the host's
  const recs = match(6, 0x300, R4, { 1: { rank: 0, as: 0 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x300, R4, FLOOR + 5 * 60000) } });
  T('[3a] run exits 0', r.code === 0, r.out.slice(-800));
  T('[3a] claims the host\'s seat: the three honest writers are not flagged (was: all four), no rank-conflict', [A, C, D].every(s => fOf(r, s) === 0) && !/sanity-flagged \[rank-conflict/.test(r.out), 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
  if (!Q80) {
    T('[3a] not settled, only he is flagged, one strike, verdict free', !processedOf(r).has(m) && fOf(r, B) === 1 && strikesOf(r, B) === 1 && sigOf(r).t2lv[m] && sigOf(r).t2lv[m].v === 'free');
    T('[3a] the claimed seat is logged beside the roster seat', /team2 lone dissent \S+: seat 1 \(wrote seat 0\) = .* own-side host\) -> strike, verdict free/.test(r.out), (r.out.match(/team2 lone dissent[^\n]*/) || [''])[0]);
  } else {
    T('[3a] (start-roster filter tree) his record is dropped first, no strike', /1 record\(s\) from accounts the start roster does not seat there -- not counted \(Q80\)/.test(r.out) && strikesOf(r, B) === 0);
  }
}
{
  // [3b] the 4c way on his second strike: an honest refusal plus a second one at seat 3 -> settles, he is the leaver
  const recs = match(6, 0x301, R4, { 0: { win: 1 }, 1: { win: 1, rank: 0 }, 2: { win: 1 }, 3: { win: 1 } }, [{ seat: 1, o: { win: 1, rank: 0, as: 3 } }]);
  const m = keyOf(recs[0].d);
  const files = { STARTS_FILE: { [m]: startOf(6, 0x301, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld: { [v.pid(B)]: [strikeIn('old_b', 3 * 86400000, A, 0)] } } };
  const r = runSettle(boardsWith(recs), files);
  T('[3b] run exits 0', r.code === 0, r.out.slice(-800));
  T('[3b] a second record at another seat: verdict settle, two strikes', strikesOf(r, B) === 2 && sigOf(r).t2lv[m] && sigOf(r).t2lv[m].v === 'settle', 'strikes=' + strikesOf(r, B) + ' v=' + JSON.stringify((sigOf(r).t2lv || {})[m]));
  T('[3b] settled from the agreeing records; he is the leaver (-100 points, exit rate)', processedOf(r).has(m) && scoreTo(r, POINTS, B) === 1900 && leavesOf(r, B) === 1, 'pts=' + scoreTo(r, POINTS, B) + ' leaves=' + leavesOf(r, B));
  T('[3b] the winners gain, nobody else is flagged', scoreTo(r, POINTS, C) > 2000 && scoreTo(r, POINTS, D) > 2000 && [A, C, D].every(s => fOf(r, s) === 0));
  if (!Q80) T('[3b] logged with his other claimed seat', /team2 lone dissent \S+: seat 1 \(wrote seat 3\) = .*verdict settle/.test(r.out));
}
{
  // [3c] team shape, first time: C and D refuse under host A; D claims the host's seat
  const recs = match(6, 0x310, R4, { 2: { rank: 0 }, 3: { rank: 0, as: 0 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x310, R4, FLOOR + 5 * 60000) } });
  T('[3c] run exits 0', r.code === 0, r.out.slice(-800));
  T('[3c] a refuser claiming the host\'s seat: C struck (free), the agreeing pair never flagged', strikesOf(r, C) === 1 && sigOf(r).t2lv[m] && sigOf(r).t2lv[m].v === 'free' && fOf(r, C) === 1 && [A, B].every(s => fOf(r, s) === 0), 'f=' + [A, B, C, D].map(s => fOf(r, s)).join(','));
  if (!Q80) {
    T('[3c] D struck too, only the two of them flagged', strikesOf(r, D) === 1 && fOf(r, D) === 1);
    T('[3c] logged: D at seat 3 (wrote seat 0), C plain', /team2 team dissent \S+: seat 3 \(wrote seat 0\) = /.test(r.out) && /team2 team dissent \S+: seat 2 = /.test(r.out));
  } else {
    T('[3c] (start-roster filter tree) D\'s record is dropped first', /not counted \(Q80\)/.test(r.out) && strikesOf(r, D) === 0);
  }
}
{
  // [3d] team shape with a second, agreeing record at his own seat (no tree drops it): both have a strike under
  //   another host already -> settles, both leavers
  const RG = [G, H, C, D];
  const recs = match(6, 0x311, RG, { 2: { rank: 0 }, 3: { rank: 0 } }, [{ seat: 3, o: {} }]);
  const m = keyOf(recs[0].d);
  const prior = (k) => [strikeIn('old_' + k, 2 * 86400000, A, 1, [A, B])];
  const files = { STARTS_FILE: { [m]: startOf(6, 0x311, RG, FLOOR + 5 * 60000) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld: { [v.pid(C)]: prior('c'), [v.pid(D)]: prior('d') } } };
  const r = runSettle(boardsWith(recs), files);
  T('[3d] run exits 0', r.code === 0, r.out.slice(-800));
  T('[3d] a second, agreeing record: still both struck, verdict settle, nobody excused', strikesOf(r, C) === 2 && strikesOf(r, D) === 2 && sigOf(r).t2lv[m] && sigOf(r).t2lv[m].v === 'settle' && sigOf(r).t2lv[m].ex.length === 0, JSON.stringify((sigOf(r).t2lv || {})[m]));
  T('[3d] settled; both refusers are leavers, the winners gain', processedOf(r).has(m) && [C, D].every(s => scoreTo(r, POINTS, s) === 1900 && leavesOf(r, s) === 1) && scoreTo(r, POINTS, G) > 2000 && scoreTo(r, POINTS, H) > 2000,
    [C, D, G, H].map(s => scoreTo(r, POINTS, s) + '/' + leavesOf(r, s)).join(' '));
  T('[3d] the agreeing pair is not flagged', fOf(r, G) === 0 && fOf(r, H) === 0);
}
{
  // [3e] honest refusal: logs exactly as before (no claimed-seat note)
  const recs = match(6, 0x320, R4, { 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const r = runCron(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x320, R4, FLOOR + 5 * 60000) } });
  T('[3e] honest refusal: free, only he flagged, the old log line', sigOf(r).t2lv[m] && sigOf(r).t2lv[m].v === 'free' && fOf(r, D) === 1 && [A, B, C].every(s => fOf(r, s) === 0)
    && /team2 lone dissent \S+: seat 3 = \S+ \(4 records, opposing host\) -> strike, verdict free/.test(r.out) && !/wrote seat/.test(r.out));
}

// ---- [4] wiring pins ----
{
  const body = (name) => { const i = SRC.indexOf('\nfunction ' + name + '('); if (i < 0) return ''; const j = SRC.indexOf('\n}\n', i); return SRC.slice(i, j); };
  const ld = body('team2LoneDissent'), td = body('team2TeamDissent'), lr = body('team2LateRefusers');
  T('[4] both shapes take the seat from team2RosterSeat', /team2RosterSeat\(roster, hit\.sid, taken\)/.test(ld) && /team2RosterSeat\(roster, s, taken\)/.test(td));
  T('[4] neither reads the dissenter\'s own seat field', !/recs\[0\]\.d\[5\]/.test(ld) && !/recs\[0\]\.d\[5\]/.test(td) && !/recs\.some\(r => \(r\.d\[5\]/.test(ld + td));
  T('[4] the team shape and late refusers count refusers with team2Refused', /team2Refused\(rs, ts\)/.test(td) && /team2Refused\(rs, ts\)/.test(lr) && !/\.every\(/.test(lr) && !/rs\.every/.test(td));
  T('[4] team2Refused: one refusal is enough', /function team2Refused\(rs, ts\) \{ return rs\.some\(/.test(SRC));
}

console.log(failN ? 'team2-dissent-seat: ' + failN + ' FAILED' : 'team2-dissent-seat: all passed');
process.exit(failN ? 1 : 0);
