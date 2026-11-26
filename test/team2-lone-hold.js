'use strict';
// Q443 (cloud audit, TEMPORARY hold; the local FU4 coordinator's ask M1009, 2026-11-24): while T2LD.HOLD_LONE is on, a
// team-code LONE dissent whose verdict comes out 'settle' (the dissenter's second strike in the window, counted as Q51
// counts) no longer convicts him: the strike is stored (hd: 1), the match settles from the agreeing records, and he is
// excused like a Q56 dissenter not yet due -- no exit rate, no points, flagged once. The live lone dissents of
// 2026-11-20..24 include shapes an honest player writes (Q436 / Q442), so a second one must not convict until those are
// fixed. test/team2-lone-dissent.js keeps pinning the original rule (it runs with T2LD_HOLD_LONE=0).
//   [1] defaults: the hold is on unless T2LD_HOLD_LONE=0
//   [2] the pass, in process: a due lone dissent settles with the dissenter excused (t2ex), the strike marked hd, the
//       stored verdict carries his excuse; a first strike is free and unmarked as before
//   [3] ranked 2v2, the real main(): first strike free, the second (losing side, differing vector) settles -- the three
//       agreeing writers rated, the dissenter neither a leaver nor fined, flagged for both matches
//   [4] quick 3v3 (the live shape): the second strike settles, no exit rate, the five agreeing writers rated
//   [5] a team dissent (Q56) is not held: the due teammate is still convicted, the other excused
//   [6] sticky: a held verdict deferred by the pacing floor settles on the next run with him still excused; and when his
//       record has rotated off by then
//   [7] T2LD_HOLD_LONE=0 brings the original rule back (the [3] match convicts him)
//   [8] mutation self-check: the hold line taken out -> [3] convicts again; the single dissenter's stored excuse taken
//       out -> [6] convicts on the deferred run
//   [9] wiring pins
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

function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'team2-hold-'));
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
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
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
function runSettle(boards, files, env, script) {
  const r = runCron(boards, files, env, script);
  return (/absent-hold /.test(r.out) && v.ABSENT_GRACE_MS) ? runCron(boards, advance(r.state, v.ABSENT_GRACE_MS + 60000), env, script) : r;
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
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
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


const leaverLine = (r, sid) => new RegExp('leaver .*= ' + v.pid(sid).slice(0, 8) + '.*\\(in roster, no record').test(r.out);
const t2lvOf = (r, m) => (sigOf(r).t2lv || {})[m];
const strikeOf = (r, sid, m) => ((sigOf(r).t2ld || {})[v.pid(sid)] || []).find(e => e && e.m === m);
const show = (r, m) => r.out.split('\n').filter(l => l.indexOf(m) >= 0 || /team2|Q443/.test(l)).slice(-12).join(' | ');

// ---- [1] defaults ----
{
  T('[1] the hold is on by default', v.T2LD.HOLD_LONE === true);
  const off = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require(process.argv[1]).T2LD.HOLD_LONE))", VALIDATE],
    { env: Object.assign({}, process.env, { T2LD_HOLD_LONE: '0', STATE_SALT: 's' }), encoding: 'utf8' });
  T('[1] T2LD_HOLD_LONE=0 turns it off', off.stdout === 'false', off.stdout + off.stderr.slice(-300));
  const on1 = spawnSync(process.execPath, ['-e', "process.stdout.write(String(require(process.argv[1]).T2LD.HOLD_LONE))", VALIDATE],
    { env: Object.assign({}, process.env, { T2LD_HOLD_LONE: '1', STATE_SALT: 's' }), encoding: 'utf8' });
  T('[1] any other value leaves it on', on1.stdout === 'true', on1.stdout + on1.stderr.slice(-300));
}

// ---- [2] the pass, in process ----
{
  const now = 100 * 86400000;
  const g = recsOf(match(6, 0x120, R4, { 1: { rank: 0 } }));
  const m = keyOf(g[0].d), gr = { groups: { [m]: g }, consistentMatches: [{ m, g, void: false }], inconsistentGroups: [] };
  const sg = { players: {}, flagged: {}, t2ld: { [v.pid(B)]: [{ m: 'old', t: now - 1000, h: '', o: 0 }] } };
  const res = v.applyTeam2LoneDissent(gr, sg, new Set(), now, vecOf);
  const c = gr.consistentMatches[0];
  T('[2] due lone dissent: the match settles from the agreeing records', res.settle === 1 && res.free === 0 && gr.consistentMatches.length === 1 && c.g.length === 3 && !c.g.some(r => r.steamID === B));
  T('[2] ... the dissenter is excused (t2ex), not convicted', Array.isArray(c.t2ex) && c.t2ex.length === 1 && c.t2ex[0] === v.pid(B), JSON.stringify(c.t2ex));
  T('[2] ... counted as held', res.ldHold === 1);
  const st = sg.t2ld[v.pid(B)].find(e => e.m === m);
  T('[2] ... the strike is stored, marked hd', !!st && st.hd === 1 && sg.t2ld[v.pid(B)].length === 2, JSON.stringify(sg.t2ld[v.pid(B)]));
  T('[2] ... the stored verdict is settle and keeps his excuse', sg.t2lv[m] && sg.t2lv[m].v === 'settle' && sg.t2lv[m].p === v.pid(B) && JSON.stringify(sg.t2lv[m].ex) === JSON.stringify([v.pid(B)]), JSON.stringify(sg.t2lv[m]));
  T('[2] ... he alone is flagged, once', !!sg.flagged[m] && ((sg.players[v.pid(B)] || {}).f | 0) === 1 && [A, C, D].every(s => !sg.players[v.pid(s)] || (sg.players[v.pid(s)].f | 0) === 0));
  // a first strike: free and unmarked as before
  const g1 = recsOf(match(6, 0x121, R4, { 1: { rank: 0 } }));
  const m1 = keyOf(g1[0].d), gr1 = { groups: { [m1]: g1 }, consistentMatches: [{ m: m1, g: g1, void: false }], inconsistentGroups: [] };
  const sg1 = { players: {}, flagged: {}, t2ld: {} };
  const res1 = v.applyTeam2LoneDissent(gr1, sg1, new Set(), now, vecOf);
  T('[2] a first strike: free, nothing held, the strike unmarked, the verdict without ex', res1.free === 1 && res1.settle === 0 && (res1.ldHold | 0) === 0 && gr1.consistentMatches.length === 0
    && sg1.t2ld[v.pid(B)].length === 1 && sg1.t2ld[v.pid(B)][0].hd === undefined && sg1.t2lv[m1].v === 'free' && sg1.t2lv[m1].ex === undefined, JSON.stringify(sg1.t2lv[m1]));
  // a stored held verdict, his record still there: settles again with his excuse, no new strike, no second flag
  const g2 = recsOf(match(6, 0x122, R4, { 1: { rank: 0 } }));
  const m2 = keyOf(g2[0].d), gr2 = { groups: { [m2]: g2 }, consistentMatches: [{ m: m2, g: g2, void: false }], inconsistentGroups: [] };
  const sg2 = { players: { [v.pid(B)]: { f: 1, fm: { [m2]: now - 1000 } } }, flagged: { [m2]: now - 1000 },
    t2ld: { [v.pid(B)]: [{ m: 'old', t: now - 9000, h: '', o: 0 }, { m: m2, t: now - 1000, h: v.pid(A), o: 0, hd: 1 }] }, t2lv: { [m2]: { p: v.pid(B), t: now - 1000, v: 'settle', ex: [v.pid(B)] } } };
  const res2 = v.applyTeam2LoneDissent(gr2, sg2, new Set(), now, vecOf);
  T('[2] a stored held verdict: settles with his excuse, no new strike, no second flag', res2.settle === 1 && JSON.stringify(gr2.consistentMatches[0].t2ex) === JSON.stringify([v.pid(B)])
    && sg2.t2ld[v.pid(B)].length === 2 && (sg2.players[v.pid(B)].f | 0) === 1 && (res2.ldHold | 0) === 0, JSON.stringify(gr2.consistentMatches[0]).slice(0, 200));
}

// ---- [3] ranked 2v2 through the real main(): first strike free, second held ----
let r3first, r3, m3;
{
  const recs1 = match(6, 0x300, R4, { 1: { rank: 0 } });
  const m1 = keyOf(recs1[0].d);
  r3first = runCron(boardsWith(recs1), { STARTS_FILE: { [m1]: startOf(6, 0x300, R4, FLOOR + 5 * 60000) } });
  T('[3] run exits 0', r3first.code === 0, r3first.out.slice(-800));
  T('[3] first strike: free as before (not settled, flagged, one strike)', !processedOf(r3first).has(m1) && t2lvOf(r3first, m1).v === 'free' && fOf(r3first, B) === 1 && strikesOf(r3first, B) === 1);
}
// the same match the original rule convicts in test/team2-lone-dissent.js [4]: C / D win, B (losing side) refuses again
const recs3 = match(6, 0x400, R4, { 0: { win: 1 }, 1: { win: 1, rank: 0, scores: [6000, 5500, 5200, 4500] }, 2: { win: 1 }, 3: { win: 1 } });
m3 = keyOf(recs3[0].d);
const files3 = () => { const f = advance(r3first.state, 3 * 86400000); f.STARTS_FILE = { [m3]: startOf(6, 0x400, R4, FLOOR + 5 * 60000) }; f.PROCESSED_FILE = []; return f; };
{
  const sumPath = path.join(os.tmpdir(), 'team2-hold-summary-' + process.pid + '.md');
  fs.writeFileSync(sumPath, '');
  const r3a = runCron(boardsWith(recs3), files3(), { GITHUB_STEP_SUMMARY: sumPath });   // the verdict run (runSettle's first run)
  const sum = fs.readFileSync(sumPath, 'utf8'); try { fs.unlinkSync(sumPath); } catch (e) {}
  T('[3] run exits 0', r3a.code === 0, r3a.out.slice(-800));
  T('[3] the held verdict is logged where it is decided', /team2 lone dissent .*verdict settle held \(Q443\): settles, he is excused, not a leaver/.test(r3a.out), show(r3a, m3));
  T('[3] the run summary counts it', /\| team-gamble lone \/ team dissent unsettled \/ settled \| [^|]*\(1 due lone dissent\(s\), the dissenter excused, not convicted: Q443 hold\) \|/.test(sum), sum.split('\n').filter(l => /team-gamble lone/.test(l)).join(' / ') || sum.slice(0, 300));
  r3 = (/absent-hold /.test(r3a.out) && v.ABSENT_GRACE_MS) ? runCron(boardsWith(recs3), advance(r3a.state, v.ABSENT_GRACE_MS + 60000)) : r3a;
  T('[3] run exits 0', r3.code === 0, r3.out.slice(-800));
  T('[3] second strike: the match settles from the agreeing records', processedOf(r3).has(m3), show(r3, m3));
  T('[3] ... the stored verdict is settle with his excuse; two strikes, the second marked hd', t2lvOf(r3, m3) && t2lvOf(r3, m3).v === 'settle' && JSON.stringify(t2lvOf(r3, m3).ex) === JSON.stringify([v.pid(B)])
    && strikesOf(r3, B) === 2 && strikeOf(r3, B, m3) && strikeOf(r3, B, m3).hd === 1, JSON.stringify(t2lvOf(r3, m3)));
  T('[3] ... he is NOT a leaver: no exit rate, no points written, no leaver line', leavesOf(r3, B) === 0 && scoreTo(r3, POINTS, B) == null && !leaverLine(r3, B), 'leaves=' + leavesOf(r3, B) + ' pts=' + scoreTo(r3, POINTS, B));
  T('[3] ... the settle logs him excused', new RegExp('leaver ' + m3 + ': seat 1 = ' + v.pid(B).slice(0, 8) + ' team-gamble dissent not yet due -- excused, no conviction').test(r3.out), show(r3, m3));
  T('[3] ... the three agreeing writers are rated, he is not', [A, C, D].every(s => scoreTo(r3, RATING, s) != null) && scoreTo(r3, RATING, B) == null);
  T('[3] ... the outcome is the agreeing side\'s: C and D gain, his teammate A does not', scoreTo(r3, POINTS, C) > 2000 && scoreTo(r3, POINTS, D) > 2000 && scoreTo(r3, POINTS, A) <= 2000, [A, C, D].map(s => scoreTo(r3, POINTS, s)).join(','));
  T('[3] ... he is flagged for this match too, nobody else is', fOf(r3, B) === 2 && [A, C, D].every(s => fOf(r3, s) === 0), 'f=' + [A, B, C, D].map(s => fOf(r3, s)).join(','));
}

// ---- [4] quick 3v3 (dissenter on the host's team): the second strike settles, no exit rate ----
{
  const R6 = [A, B, C, D, E, F];
  const recs1 = match(8, 0x900, R6, { 2: { rank: 0 } });
  const m1 = keyOf(recs1[0].d);
  const r1 = runCron(boardsWith(recs1), { STARTS_FILE: { [m1]: startOf(8, 0x900, R6, FLOOR + 5 * 60000) } });
  T('[4] first: free', t2lvOf(r1, m1).v === 'free' && fOf(r1, C) === 1);
  const recs2 = match(8, 0x901, R6, { 2: { rank: 0, scores: [1, 2, 3, 4, 5, 6] } });
  const m2 = keyOf(recs2[0].d);
  const f2 = advance(r1.state, 86400000);
  f2.STARTS_FILE = { [m2]: startOf(8, 0x901, R6, FLOOR + 5 * 60000) };
  const r2 = runSettle(boardsWith(recs2), f2);
  T('[4] second: settles, the dissenter excused (no exit rate)', processedOf(r2).has(m2) && leavesOf(r2, C) === 0 && !leaverLine(r2, C) && JSON.stringify(t2lvOf(r2, m2).ex) === JSON.stringify([v.pid(C)]), show(r2, m2));
  T('[4] the five agreeing writers are rated, he is not', [A, B, D, E, F].every(s => scoreTo(r2, RATING, s) != null) && scoreTo(r2, RATING, C) == null);
}

// ---- [5] a team dissent (Q56) is not held ----
{
  // C (due: one earlier own-side strike) and D both refuse; host A and B agree
  const recs = match(6, 0x500, R4, { 2: { rank: 0 }, 3: { rank: 0 } });
  const m = keyOf(recs[0].d);
  const prior = { players: {}, flagged: {}, t2ld: { [v.pid(C)]: [{ m: 'earlier', t: Date.now() - 86400000, h: '', o: 0 }] } };
  const r = runSettle(boardsWith(recs), { STARTS_FILE: { [m]: startOf(6, 0x500, R4, FLOOR + 5 * 60000) }, SIGNALS_FILE: prior });
  T('[5] settles, the due teammate is convicted, the other excused (no Q443 hold on a team dissent)', processedOf(r).has(m) && leavesOf(r, C) === 1 && leavesOf(r, D) === 0 && !/Q443/.test(r.out)
    && !(strikeOf(r, C, m) || {}).hd, show(r, m));
}

// ---- [6] sticky held verdicts ----
const recs6 = match(6, 0xA00, R4, { 1: { rank: 0 } });
const m6 = keyOf(recs6[0].d);
// every seat attested its own start (pend.started), so a seat whose record has rotated off is still a seat the settle
//   could convict (Q69 named-only would spare him anyway)
const files6 = () => ({ STARTS_FILE: { [m6]: Object.assign(startOf(6, 0xA00, R4, 60000), { started: R4.map(s => v.pid(s)) }) }, SIGNALS_FILE: { players: {}, flagged: {}, t2ld: { [v.pid(B)]: [{ m: 'earlier', t: Date.now() - 86400000, h: '', o: 0 }] } } });
function sticky(script, label) {
  const r1 = runCron(boardsWith(recs6), files6(), null, script);
  const held = t2lvOf(r1, m6) && t2lvOf(r1, m6).v === 'settle' && !processedOf(r1).has(m6) && strikesOf(r1, B) === 2;
  const r2 = runSettle(boardsWith(recs6), advance(r1.state, FLOOR + 60000), null, script);
  // (past the Q121 leave-wait too: he wrote a start, so the settle first waits until the match must be over)
  const r2b = runSettle(boardsWith(recs6.filter(x => x.sid !== B)), advance(r1.state, FLOOR + 2 * 3600000), null, script);
  return { r1, r2, r2b, held, label };
}
{
  const s = sticky(null);
  T('[6] held verdict decided, settle deferred by the pacing floor', s.held, JSON.stringify(t2lvOf(s.r1, m6)) + ' ' + s.r1.out.slice(-300));
  T('[6] next run, his record still there: settles, no new strike, still excused', processedOf(s.r2).has(m6) && strikesOf(s.r2, B) === 2 && leavesOf(s.r2, B) === 0 && !leaverLine(s.r2, B), show(s.r2, m6));
  T('[6] next run, his record rotated off: settles, still excused', processedOf(s.r2b).has(m6) && leavesOf(s.r2b, B) === 0 && !leaverLine(s.r2b, B), show(s.r2b, m6));
  T('[6] flagged once for the match', fOf(s.r2, B) === 1 && fOf(s.r2b, B) === 1);
}

// ---- [7] the knob off: the original rule ----
{
  const r = runSettle(boardsWith(recs3), files3(), { T2LD_HOLD_LONE: '0' });
  T('[7] T2LD_HOLD_LONE=0: the [3] match convicts him (-100 points, exit rate), strike unmarked', processedOf(r).has(m3) && leavesOf(r, B) === 1 && scoreTo(r, POINTS, B) === 1900 && !(strikeOf(r, B, m3) || {}).hd && !/Q443/.test(r.out),
    'leaves=' + leavesOf(r, B) + ' pts=' + scoreTo(r, POINTS, B));
}

// ---- [8] mutation self-check ----
{
  const mutant = (from, to, tagS) => {
    if (SRC.split(from).length !== 2) { bad('[8] mutation anchor not found exactly once: ' + tagS); return null; }
    return SRC.replace(from, to);
  };
  const runMut = (tagS, from, to, fn) => {
    const m = mutant(from, to, tagS);
    if (!m) return;
    const script = path.join(__dirname, '..', '.mutant-team2-lone-hold-' + process.pid + '.js');
    try { fs.writeFileSync(script, m); fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
  };
  runMut('the hold line', "if (vd === 'settle' && td.lone && T2LD.HOLD_LONE) { vd = 'held'; cur.hd = 1; res.ldHold = (res.ldHold | 0) + 1; RUN.t2ldHold = (RUN.t2ldHold | 0) + 1; }", '', (script) => {
    const r = runSettle(boardsWith(recs3), files3(), null, script);
    T('[8] the hold line taken out -> the [3] match convicts him again ([3] would be red)', processedOf(r).has(m3) && leavesOf(r, B) === 1 && scoreTo(r, POINTS, B) === 1900, 'leaves=' + leavesOf(r, B) + ' pts=' + scoreTo(r, POINTS, B));
  });
  runMut('the single dissenter\'s stored excuse', "(all.length === 1 && ex.length) ? { ex } : {}", '{}', (script) => {
    const s = sticky(script);
    T('[8] the stored excuse taken out -> the deferred run convicts him ([6] would be red)', s.held && processedOf(s.r2).has(m6) && leavesOf(s.r2, B) === 1, show(s.r2, m6));
    T('[8] ... and so does the run after his record rotated off', processedOf(s.r2b).has(m6) && leavesOf(s.r2b, B) === 1, show(s.r2b, m6));
  });
}

// ---- [9] wiring pins ----
{
  const body = SRC.slice(SRC.indexOf('function applyTeam2LoneDissent('), SRC.indexOf('// ===== Q43 team-gamble accusations'));
  T('[9] the hold lives in the lone-dissent pass, gated on a lone dissent and the knob, exactly once', (SRC.match(/T2LD\.HOLD_LONE\)/g) || []).length === 1
    && /if \(vd === 'settle' && td\.lone && T2LD\.HOLD_LONE\)/.test(body));
  T('[9] the knob reads T2LD_HOLD_LONE', /HOLD_LONE: process\.env\.T2LD_HOLD_LONE !== '0'/.test(SRC));
  const sumFn = SRC.slice(SRC.indexOf('function writeRunSummary('), SRC.indexOf('function writeRunSummary(') + 40000);
  T('[9] the run summary row names held matches', /'\| team-gamble lone \/ team dissent unsettled \/ settled \| ' \+ s\('t2ld', '0\/0'\) \+ \(RUN\.t2ldHold \?/.test(sumFn));
}

if (failN) { console.log('team2-lone-hold: ' + failN + ' FAILED'); process.exit(1); }
console.log('team2-lone-hold: all passed');
