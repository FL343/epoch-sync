'use strict';
// A two-player endless run whose connection dropped settles on the part both records wrote (Q438, cloud audit, from Q437 /
// ASK_USER A86 option 1, 2026-11-23; player voice V123). Each client ends such a run alone: the one who lost the host writes
// host-left (2) / migrate-disband (4) with the run as it stood, the host plays on through his grace and writes peers-gone (1)
// (or finished (0): a run-over verdict, or a checkpoint he passed alone). The records differ, so the key used to go to the
// two-voice lane (nothing settled, nobody flagged); a team segment that ends so has no final bit, so even two equal records
// were held (B-F7). endlessCommonVerdict settles it on the smaller depth, each seat's smaller score, the shallower record's
// tail, the final bit on a team segment; nobody flagged.
//   [1] the verdict on one group (unit): team competitive / classic / casual shapes, the dispositions that count, the
//       shallower record's tail on both, the final bit, S first, equal records of a team segment, nothing to change
//   [2] shapes left as before (null): three seats, user-quit, two of one side, another start depth / season / continues /
//       segment flag, a save segment, a couch / casual solo bit, records that cross (picks / bitmap), another seat table,
//       a writer off his seat, one account writing two records, a short tail
//   [3] nothing a record says raises what settles: random pairs -- the depth is never above either, every score at or
//       under each record's, both outputs carry one vector
//   [4] the seedcap audit reads the same rewrite ({ d, roster, w } records): the settled scores and depth; only the writer
//       whose own record settles claims them (Q438 review 1): a modified teammate's host-left at the segment's start
//       convicts nobody (the honest deep seat is vetoed), his own seat over the cap convicts him, two equal records both
//   [5] end to end (validate.js main()): Q437 games A / C (a first segment, no checkpoint yet), game B (the second segment
//       after a settled checkpoint), the host passed a checkpoint alone, casual and classic duos, two equal team records:
//       each settles at the common depth, both credited, nobody flagged, the rating run final at that depth; a user-quit
//       record and records that cross stay with the two-voice lane (not settled, nobody flagged)
//   [6] the run summary counts the settled groups
//   [7] wiring pins + mutation self-check: the call taken out of the grouping -> [5] is held again; each seat's larger
//       score -> [3] / [5] red; the seedcap branch taken out -> [4] red; both writers claiming again -> the honest player
//       convicted ([4] red)
// State isolation is structural (every *_FILE var scanned and redirected, cwd = temp dir), like test/endless-host-copied.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'SEASON_NOW', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'COMP_CHAIN_WAIT_MS', 'ENDLESS_DEPTH_CAP', 'ENDLESS_SCORE_MULT'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';   // same salt as the child runs below, so v.pid() addresses their state rows
const v = require(path.join(__dirname, '..', 'validate.js'));
const attest = require(path.join(__dirname, '..', 'attest.js'));
const perks = require(path.join(__dirname, '..', 'perks.js'));
const sc = require(path.join(__dirname, '..', 'seedcap.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const SEEDCAP = path.join(__dirname, '..', 'seedcap.js');
const SRC_SC = fs.readFileSync(SEEDCAP, 'utf8');
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1])));
// stateless board stub (writes logged, not applied)
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
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

// boards: [{ id, name, entries: [{ steamID, score, details: int[] }] }]; files: { STARTS_FILE: obj, ... } carried state
function runCron(boards, files, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'endless-common-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const sumPath = path.join(dir, 'summary.md');
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z',   // pin the season clock (pre-season: no season twin boards needed)
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', READ_RETRY_MS: '0', GITHUB_STEP_SUMMARY: sumPath,
    }, stateEnv, env || {});
    const r = spawnSync(process.execPath, ['-r', stub, script || VALIDATE], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    let summary = ''; try { summary = fs.readFileSync(sumPath, 'utf8'); } catch (err) {}
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const writes = (r, boardId, sid) => r.posts.filter(p => /SetLeaderboardScore/.test(p.url) && new RegExp('leaderboardid=' + boardId + '(&|$)').test(p.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(p.body)));
const scoreOf = (p) => { const mm = /score=(-?[0-9]+)/.exec(p.body); return mm ? Number(mm[1]) : null; };
const processedOf = (r) => new Set(r.state.PROCESSED_FILE || []);
const flagsOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const pdOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).pd | 0;
const flaggedKey = (r, m) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[m]);

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003';
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// type-7 settle record (result-reporter wire form): magic, ver, mt, hash, seed, seat, rank, progress/win, pc, dur,
//   scores x pc, disp, roster (lo, hi) x pc, endless tail (startDepth, endDepth, continues, tokens, season, flags, build,
//   picksLo, picksHi, rerollLo, rerollHi, resumeTag)
function rec7(hash, seat, roster, tail, o) {
  const pc = roster.length, sc0 = (o && o.scores) || [400, 300, 200, 100];
  const d = [0xB1, 3, 7, hash | 0, (o && o.seed != null) ? o.seed : 5, seat, 0, 0, pc, (o && o.dur != null) ? o.dur : 900];
  for (let i = 0; i < pc; i++) d.push(sc0[i] | 0);
  d.push((o && o.disp) | 0);
  for (const s of roster) { const p = sidPair(s); d.push(p[0], p[1]); }
  for (const x of tail) d.push(x | 0);
  return d;
}
const DUO = [A, B], TRIO = [A, B, C];
const DISP = { FIN: 0, PEERS: 1, HOST: 2, DISBAND: 4, QUIT: 5 };
const DNAME = ['finished', 'peers-gone', 'host-left', 'level-begin-timeout', 'migrate-disband', 'user-quit'];
// a record as the grouping holds it
const R = (sid, seat, roster, tail, o, hash) => { const d = rec7(hash || 0x4380, seat, roster, tail, o); return { steamID: sid, d, roster: v.decodeRoster(d), dispCode: (o && o.disp) | 0, disp: DNAME[(o && o.disp) | 0], shard: seat }; };
// tails: [startDepth, endDepth, continues, tokens, season, flags, build, picksLo, picksHi, rerollLo, rerollHi, resumeTag]
const COMP = attest.SEG_COMP | attest.SEG_LINE;   // a version 7 team competitive segment (the 0.6.1 package of Q437's games)
const CMP = (s, e, x) => [s, e, 0, 0, 0, COMP | ((x && x.flags) | 0), 0, (x && x.lo) | 0, (x && x.hi) | 0, (x && x.rr) | 0, 0, (x && x.tag) | 0];
const CLS = (s, e, x) => [s, e, 0, 0, 0, attest.SEG_CLASSIC | ((x && x.flags) | 0), 0, 0, 0, 0, 0, 0];
const CAS = (s, e, x) => [s, e, (x && x.cont) | 0, 0, 0, (x && x.flags) | 0, 0, (x && x.lo) | 0, (x && x.hi) | 0, (x && x.rr) | 0, 0, 0];
const P = perks.load();
const PK = (arr) => P.packPicks(arr);
const AT = 11 + 3 * 2;   // the tail of a two-seat record
const tailOf = (r) => r.d.slice(AT, AT + 11);
const scoresOf = (r) => r.d.slice(10, 12);

// ---- [1] the verdict on one group ----
console.log('-- [1] the verdict on one group --');
{
  // Q437 shape: B lost the host at depth 3 (host-left), A played on alone to 4 (peers-gone)
  const j = R(B, 1, DUO, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST });
  const h = R(A, 0, DUO, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS });
  const ec = v.endlessCommonVerdict([h, j]);
  T('[1] team competitive duo, host-left at 3 / peers-gone at 4: settles at depth 3, each seat\'s smaller score [300,180], the final bit added',
    !!ec && ec.kind === 'settle' && ec.depth === 3 && ec.deep === 4 && ec.low.join(',') === '300,180' && ec.final === true && ec.left === B && ec.stay === A, JSON.stringify(ec && { depth: ec.depth, low: ec.low, final: ec.final }));
  if (ec) {
    const want = CMP(0, 3).slice(0, 11); want[5] |= attest.SEG_FINAL;
    T('[1] both records carry the shallower record\'s tail with the final bit and the settled scores; S (the shallower) first',
      ec.g.length === 2 && ec.g[0].steamID === B && ec.g.every((r) => tailOf(r).join(',') === want.join(',') && scoresOf(r).join(',') === '300,180'), ec.g.map((r) => r.steamID + ':' + scoresOf(r) + '|' + tailOf(r)).join(' '));
    T('[1] the inputs are not changed (copies), each keeps its own disposition, seat, duration and as-written note',
      scoresOf(h).join(',') === '420,180' && tailOf(h)[1] === 4 && ec.g.every((r, i) => r.dispCode === [DISP.HOST, DISP.PEERS][i] && (r.d[5] | 0) === [1, 0][i]) && ec.own[A] === '420,180|4' && ec.own[B] === '300,200|3');
    T('[1] only the writer whose own record settles claims the settled scores (the shallower: B)', Array.isArray(ec.claim) && ec.claim.join(',') === B, JSON.stringify(ec.claim));
  }
  const ec2 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(5, 9), { scores: [900, 800], disp: DISP.FIN }), R(B, 1, DUO, CMP(5, 7), { scores: [700, 850], disp: DISP.DISBAND })]);
  T('[1] migrate-disband counts as losing the host, finished (a checkpoint the host passed alone) as staying: settles at 7, [700,800]',
    !!ec2 && ec2.depth === 7 && ec2.low.join(',') === '700,800' && ec2.final, JSON.stringify(ec2 && { d: ec2.depth, low: ec2.low }));
  const ec3 = v.endlessCommonVerdict([R(A, 0, DUO, CLS(0, 4), { scores: [500, 400], disp: DISP.PEERS }), R(B, 1, DUO, CLS(0, 2), { scores: [300, 450], disp: DISP.HOST })]);
  T('[1] team classic duo: settles at 2 with the final bit', !!ec3 && ec3.depth === 2 && ec3.final && ec3.g.every((r) => (tailOf(r)[5] & attest.SEG_FINAL) && (tailOf(r)[5] & attest.SEG_CLASSIC)));
  const ec4 = v.endlessCommonVerdict([R(A, 0, DUO, CAS(0, 9, { cont: 0x11 }), { scores: [900, 600], disp: DISP.PEERS }), R(B, 1, DUO, CAS(0, 8, { cont: 0x11 }), { scores: [800, 700], disp: DISP.HOST })]);
  T('[1] casual duo: settles at 8, no final bit (a casual record carries no segment flags), the continues as both wrote them',
    !!ec4 && ec4.depth === 8 && !ec4.final && ec4.g.every((r) => tailOf(r)[5] === 0 && tailOf(r)[2] === 0x11) && ec4.low.join(',') === '800,600');
  const e5 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.HOST })]);
  T('[1] two equal team records after a drop (held before: no final bit, B-F7): settle with the final bit added, S = the record of who lost the host',
    !!e5 && e5.final && e5.depth === 4 && e5.g[0].steamID === B && e5.g.every((r) => tailOf(r)[5] === (COMP | attest.SEG_FINAL)));
  T('[1] two equal records: both writers claim the settled scores (each wrote them at that depth)', !!e5 && e5.claim.slice().sort().join(',') === [A, B].sort().join(','), JSON.stringify(e5 && e5.claim));
  T('[1] two equal casual records: nothing to change (null, the usual path)', v.endlessCommonVerdict([R(A, 0, DUO, CAS(0, 4), { disp: DISP.PEERS }), R(B, 1, DUO, CAS(0, 4), { disp: DISP.HOST })]) === null);
  T('[1] a team record already final (a run-over verdict): nothing to change when the two agree',
    v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 4, { flags: attest.SEG_FINAL }), { disp: DISP.FIN }), R(B, 1, DUO, CMP(0, 4, { flags: attest.SEG_FINAL }), { disp: DISP.HOST })]) === null);
  const e6 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 5, { flags: attest.SEG_FINAL }), { scores: [600, 500], disp: DISP.FIN }), R(B, 1, DUO, CMP(0, 5), { scores: [560, 500], disp: DISP.HOST })]);
  T('[1] the host\'s run ended on a verdict inside his grace (final, finished), the other lost him at the same depth: settles, final', !!e6 && e6.final && e6.depth === 5 && e6.low.join(',') === '560,500');
  // the picks made past the drop: the shallower log is a prefix of the deeper one; the bitmap a subset
  const p1 = PK([1]), p12 = PK([1, 2]);
  const e7 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 6, { lo: p12.lo, rr: 3 }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { lo: p1.lo, rr: 1 }), { disp: DISP.HOST })]);
  T('[1] the shallower record\'s pick log and reroll bitmap (a prefix / a subset of the deeper one\'s) are the ones that settle',
    !!e7 && e7.g.every((r) => tailOf(r)[7] === p1.lo && tailOf(r)[9] === 1 && tailOf(r)[1] === 3), e7 && e7.g.map((r) => tailOf(r).join(',')).join(' '));
  const e7b = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 3, { lo: p12.lo }), { scores: [420, 180], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { lo: p1.lo }), { scores: [300, 200], disp: DISP.HOST })]);
  T('[1] the same depth but one more pick on the other record: S = the shorter pick log, only its writer claims', !!e7b && e7b.g[0].steamID === B && e7b.claim.join(',') === B, JSON.stringify(e7b && e7b.claim));
  const e8 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 4, { tag: 77 }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { tag: 0 }), { disp: DISP.HOST })]);
  T('[1] each record keeps its own resume tag (outside the consistency vector)', !!e8 && e8.g[0].d[AT + 11] === 0 && e8.g[1].d[AT + 11] === 77);
  const dup = R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST });
  const e9 = v.endlessCommonVerdict([R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), dup, Object.assign({}, dup, { d: dup.d.slice(), shard: 7 })]);
  T('[1] a byte-identical copy of one record (a retry on a second shard) counts once: two records out', !!e9 && e9.g.length === 2);
}

// ---- [2] shapes left as before ----
console.log('-- [2] shapes left as before --');
{
  const base = () => [R(A, 0, DUO, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST })];
  T('[2] the base shape settles (control)', !!v.endlessCommonVerdict(base()));
  const nulls = [
    ['three seats', [R(A, 0, TRIO, [0, 4, 0, 0, 0, COMP, 0, 0, 0, 0, 0, 0], { disp: DISP.PEERS }), R(B, 1, TRIO, [0, 3, 0, 0, 0, COMP, 0, 0, 0, 0, 0, 0], { disp: DISP.HOST }), R(C, 2, TRIO, [0, 3, 0, 0, 0, COMP, 0, 0, 0, 0, 0, 0], { disp: DISP.HOST })]],
    ['a user-quit record (left on purpose) with peers-gone', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.QUIT })]],
    ['peers-gone on both', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.PEERS })]],
    ['host-left on both', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.HOST }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['finished on both (an ordinary disagreement)', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.FIN }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.FIN })]],
    ['another start depth', [R(A, 0, DUO, CMP(5, 9), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['another season', [R(A, 0, DUO, [0, 4, 0, 0, 1, COMP, 0, 0, 0, 0, 0, 0], { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['other continues (casual)', [R(A, 0, DUO, CAS(0, 9, { cont: 0x12 }), { disp: DISP.PEERS }), R(B, 1, DUO, CAS(0, 8, { cont: 0x11 }), { disp: DISP.HOST })]],
    ['a resumed bit on one record only', [R(A, 0, DUO, CMP(0, 4, { flags: attest.SEG_RESUMED }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['a save segment (suspended)', [R(A, 0, DUO, CMP(0, 4, { flags: attest.SEG_SUSPENDED }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { flags: attest.SEG_SUSPENDED }), { disp: DISP.HOST })]],
    ['a couch bit', [R(A, 0, DUO, CMP(0, 4, { flags: attest.SEG_COUCH }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { flags: attest.SEG_COUCH }), { disp: DISP.HOST })]],
    ['a casual solo bit', [R(A, 0, DUO, CAS(0, 4, { flags: attest.SEG_CASUAL }), { disp: DISP.PEERS }), R(B, 1, DUO, CAS(0, 3, { flags: attest.SEG_CASUAL }), { disp: DISP.HOST })]],
    ['records that cross: the shallower one\'s picks are not a prefix of the deeper one\'s', [R(A, 0, DUO, CMP(0, 4, { lo: PK([1, 2]).lo }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { lo: PK([2]).lo }), { disp: DISP.HOST })]],
    ['records that cross: the shallower one has a reroll bit the deeper one lacks', [R(A, 0, DUO, CMP(0, 4, { rr: 1 }), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3, { rr: 2 }), { disp: DISP.HOST })]],
    ['another seat table', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 1, [A, C], CMP(0, 3), { disp: DISP.HOST })]],
    ['a writer off his own seat', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 0, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['a third account writing the key', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST }), R(C, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
    ['one account writing two different records', [R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST }), R(B, 1, DUO, CMP(0, 2), { disp: DISP.HOST })]],
    ['a short tail (no reroll bitmap)', [R(A, 0, DUO, CMP(0, 4).slice(0, 9), { disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3).slice(0, 9), { disp: DISP.HOST })]],
    ['a non-endless key', [(() => { const r = R(A, 0, DUO, CMP(0, 4), { disp: DISP.PEERS }); r.d[2] = 1; return r; })(), (() => { const r = R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST }); r.d[2] = 1; return r; })()]],
    ['one record only', [R(B, 1, DUO, CMP(0, 3), { disp: DISP.HOST })]],
  ];
  for (const [label, g] of nulls) T('[2] ' + label + ': null (left as before)', v.endlessCommonVerdict(g) === null);
}

// ---- [3] nothing a record says raises what settles ----
console.log('-- [3] nothing a record says raises what settles --');
{
  let seed = 0x438;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  let n = 0, badN = 0, first = '';
  for (let i = 0; i < 400; i++) {
    const sd = rnd(3) * 5, e0 = sd + rnd(6), e1 = sd + rnd(6), mk = [CMP, CLS, CAS][rnd(3)];
    const s0 = [rnd(3000) - 500, rnd(3000) - 500], s1 = [rnd(3000) - 500, rnd(3000) - 500];
    const g = [R(A, 0, DUO, mk(sd, e0), { scores: s0, disp: [DISP.PEERS, DISP.FIN][rnd(2)] }), R(B, 1, DUO, mk(sd, e1), { scores: s1, disp: [DISP.HOST, DISP.DISBAND][rnd(2)] })];
    if (rnd(2)) g.reverse();
    const ec = v.endlessCommonVerdict(g);
    if (!ec) continue;
    n++;
    const okv = ec.depth <= Math.min(e0, e1) && ec.g.every((r) => (tailOf(r)[1] | 0) <= Math.min(e0, e1) && (r.d[10] | 0) <= Math.min(s0[0], s1[0]) && (r.d[11] | 0) <= Math.min(s0[1], s1[1]))
      && ec.g[0].d.slice(10, 12).join(',') === ec.g[1].d.slice(10, 12).join(',') && tailOf(ec.g[0]).join(',') === tailOf(ec.g[1]).join(',');
    if (!okv) { badN++; if (!first) first = JSON.stringify({ e0, e1, s0, s1, out: ec.g.map((r) => scoresOf(r) + '|' + tailOf(r)) }); }
  }
  T('[3] 400 random pairs: every settle (' + n + ') at or under both records on the depth and on each seat, one vector on both', n > 300 && badN === 0, first);
}

// ---- [4] the seedcap audit reads the same rewrite ----
console.log('-- [4] the seedcap audit reads the same rewrite --');
{
  const asSc = (r) => ({ d: r.d, roster: v.decodeRoster(r.d), w: String(r.steamID) });
  const g = [R(A, 0, DUO, [0, 4, 0, 0, 0, attest.SEG_COMP, 0, 0, 0, 0, 0, 0], { scores: [420, 180], disp: DISP.PEERS }), R(B, 1, DUO, [0, 3, 0, 0, 0, attest.SEG_COMP, 0, 0, 0, 0, 0, 0], { scores: [300, 200], disp: DISP.HOST })].map(asSc);
  const ec = v.endlessCommonVerdict(g);
  T('[4] { d, roster, w } records (no steamID / dispCode): the same verdict', !!ec && ec.depth === 3 && ec.low.join(',') === '300,180' && ec.left === B);
  let p = null;
  try { p = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', g); } catch (e) { p = { err: e && e.message }; }
  T('[4] pendingOfGroup audits the settled scores at the settled depth (it held the group as forgery-suspect before: scores differ)',
    !!p && !p.err && p.scores && p.scores.join(',') === '300,180' && p.tail && (p.tail.endDepth | 0) === 3, JSON.stringify(p && { scores: p.scores, tail: p.tail, err: p.err }));
  T('[4] only the writer whose own record settles (B, seat 1) answers for the audited scores; A wrote his at depth 4', !!p && Array.isArray(p.self) && p.self.join(',') === '1', JSON.stringify(p && p.self));
  const pe = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', [R(A, 0, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.FIN }), R(B, 1, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.FIN })].map(asSc));
  T('[4] an ordinary consistent group is audited as before', !!pe && pe.scores.join(',') === '400,300' && (pe.tail.endDepth | 0) === 4);
}
// Q438 review 1: the frame. An honest player (A, seat 0) plays a casual co-op session [0,30] and writes his true money
//   (105525 / 45225: the goal line at 30, 150750, 70% his); a modified teammate (B, seat 1) writes host-left at the session's
//   start [0,0] with 999999 on both seats. The verdict settles at depth 0 on the honest scores; the cap at [0,0] is the
//   CLI's 99070 (stubbed here: applyAudit takes the CLI's answer as input). With both writers claiming, A was convicted.
const FRAME_JS = [
  "process.env.STATE_SALT = 's';",
  'const sc = require(process.argv[1]);',
  'const v = require(process.argv[2]);',
  'const o = JSON.parse(process.argv[3]);',
  "const p = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', o.g);",
  'if (!p) { console.log(JSON.stringify(null)); process.exit(0); }',
  'const st = { audited: {}, chain: {}, veto: {}, suspects: {}, corrections: [], cores: {} };',
  'const log = console.log; console.log = () => {};',
  "sc.applyAudit(st, [p], { m0: { cap: o.cap } }, new Set(), 1000000, { primary: 'root' });",
  'console.log = log;',
  'console.log(JSON.stringify({ self: p.self, depth: p.tail.endDepth | 0, scores: p.scores, veto: (st.veto.k || {}).seats || null, conv: o.sids.filter((s) => !!st.suspects[v.pid(s)]) }));',
].join('\n');
const frame = (scPath, g, cap) => {
  const r = spawnSync(process.execPath, ['-e', FRAME_JS, scPath, VALIDATE, JSON.stringify({ g: g.map((x) => ({ d: x.d, roster: x.roster, w: String(x.steamID) })), cap, sids: [A, B] })],
    { encoding: 'utf8', cwd: path.join(__dirname, '..') });
  try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) { return { err: (r.stdout || '') + (r.stderr || '').slice(0, 300) }; }
};
const FRAME_G = () => [R(A, 0, DUO, CAS(0, 30), { scores: [105525, 45225], disp: DISP.FIN }), R(B, 1, DUO, CAS(0, 0), { scores: [999999, 999999], disp: DISP.HOST })];
{
  const f = frame(SEEDCAP, FRAME_G(), 99070);
  T('[4] the frame: audited at [0,0] on the honest scores; B (seat 1) answers, A (seat 0) does not',
    !!f && !f.err && f.depth === 0 && (f.scores || []).join(',') === '105525,45225' && (f.self || []).join(',') === '1', JSON.stringify(f));
  T('[4] the frame: the honest seat over the start\'s cap is vetoed (held, as the two-voice lane held it) and nobody is convicted',
    !!f && (f.veto || []).join(',') === '0' && Array.isArray(f.conv) && f.conv.length === 0, JSON.stringify(f));
  const f2 = frame(SEEDCAP, [R(A, 0, DUO, CAS(0, 30), { scores: [45225, 105525], disp: DISP.FIN }), R(B, 1, DUO, CAS(0, 0), { scores: [999999, 999999], disp: DISP.HOST })], 99070);
  T('[4] the modified teammate\'s own seat over the cap at the depth he wrote: vetoed and he is convicted (A is not)',
    !!f2 && (f2.veto || []).join(',') === '1' && (f2.conv || []).join(',') === B, JSON.stringify(f2));
  const f3 = frame(SEEDCAP, [R(A, 0, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 4), { scores: [400, 300], disp: DISP.HOST })], 350);
  T('[4] two equal records (both wrote the scores at that depth): both answer, the over seat\'s own writer is convicted as for any group',
    !!f3 && (f3.self || []).join(',') === '0,1' && (f3.veto || []).join(',') === '0' && (f3.conv || []).join(',') === A, JSON.stringify(f3));
  const f4 = frame(SEEDCAP, FRAME_G(), 2000000);
  T('[4] the frame under a cap nobody passes: no veto, nobody convicted', !!f4 && f4.veto === null && (f4.conv || []).length === 0, JSON.stringify(f4));
}

// ---- [5] end to end ----
console.log('-- [5] end to end (validate.js main()) --');
const BOARD = { progress: 5, cp: 8, trio: 11, quad: 12, compTrio: 13, classicTrio: 14, duo: 15, compDuo: 16, classicDuo: 17 };
function world(rows) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  for (const r of rows) boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d });
  boards.push({ id: BOARD.progress, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: BOARD.cp, name: 'cp_bank', entries: [] },
    { id: BOARD.duo, name: 'endless_board', entries: [] }, { id: BOARD.trio, name: 'endless_board_trio', entries: [] }, { id: BOARD.quad, name: 'endless_board_quad', entries: [] },
    { id: BOARD.compTrio, name: 'endless_comp_trio', entries: [] }, { id: BOARD.classicTrio, name: 'endless_classic_trio', entries: [] },
    { id: BOARD.compDuo, name: 'endless_comp_duo', entries: [] }, { id: BOARD.classicDuo, name: 'endless_classic_duo', entries: [] });
  return boards;
}
const RUN_SEED = 5;
// the start attestation of each key sighted `ago` ms ago, with the registered start roster
const attestedKeys = (hashes, roster, ago) => {
  const s = {};
  for (const h of hashes) { s[h + '_' + RUN_SEED + '_7'] = { t0: Date.now() - (ago || 30 * 60000), mt: 7, roster: {}, settled: [] }; roster.forEach((sid, i) => { s[h + '_' + RUN_SEED + '_7'].roster[i] = v.pid(sid); }); }
  return s;
};
const row = (hash, roster, x) => ({ shard: x.shard != null ? x.shard : x.seat, sid: x.sid, d: rec7(hash, x.seat, roster, x.tail, x.o) });
const X = (sid, seat, tail, o) => ({ sid, seat, tail, o });
const ENDLESS_BOARDS = [BOARD.duo, BOARD.compDuo, BOARD.classicDuo];
const credited = (r, sid) => ENDLESS_BOARDS.some((b) => writes(r, b, sid).length > 0) && writes(r, BOARD.progress, sid).length > 0;
const noWrite = (r, ws) => ws.every((s) => !ENDLESS_BOARDS.some((b) => writes(r, b, s).length > 0) && writes(r, BOARD.progress, s).length === 0);
const warnOf = (r, m) => (r.out.match(new RegExp('::warning::match=' + m + ': [^\\n]*', 'g')) || []).join(' || ');
const lineOf = (r, m) => (r.out.match(new RegExp('  match=' + m + ': [^\\n]*', 'g')) || []).join(' || ');
// the rating run of `sid` in the duo family: [runId, depth, ..., r[7] flags]
const ratingRuns = (r, sid) => { const h = ((r.state.SOLO_FILE || {}).hist || {})[v.pid(sid) + '|duo|0']; return (h && h.runs) || []; };
const flagged0 = (r, m) => flagsOf(r, A) === 0 && flagsOf(r, B) === 0 && !flaggedKey(r, m);
let hashN = 0x43800;
// one cron run over the given keys; xsBy = { hash: [X...] }; files = carried state (merged with fresh start attestations)
function runKeys(xsBy, files, script) {
  const rows = [];
  for (const h of Object.keys(xsBy)) for (const x of xsBy[h]) rows.push(row(h | 0, DUO, x));
  const st = Object.assign({}, files || {});
  st.STARTS_FILE = Object.assign({}, (files && files.STARTS_FILE) || {}, attestedKeys(Object.keys(xsBy).filter((h) => !(files && files.STARTS_FILE && files.STARTS_FILE[h + '_' + RUN_SEED + '_7'])), DUO));
  return runCron(world(rows), st, null, script);
}
const mOf = (h) => h + '_' + RUN_SEED + '_7';
const show = (r, m) => 'processed=' + processedOf(r).has(m) + ' credited=' + ([A, B].filter((s) => credited(r, s)).map((s) => s === A ? 'A' : 'B').join('') || '-')
  + ' flags=' + flagsOf(r, A) + '/' + flagsOf(r, B) + ' pd=' + pdOf(r, A) + '/' + pdOf(r, B) + ' ' + (lineOf(r, m) + ' ' + warnOf(r, m)).slice(0, 400);
const settledAt = (r, m, depth, final) => processedOf(r).has(m) && credited(r, A) && credited(r, B) && flagged0(r, m)
  && new RegExp('two endless records after a dropped connection -- settled on the part both wrote: depth ' + depth + '[^\\n]*nobody flagged \\(Q438\\)').test(lineOf(r, m))
  && (final == null || [A, B].every((s) => ratingRuns(r, s).some((x) => (x[1] | 0) === depth && (((x[7] | 0) & 1) === (final ? 1 : 0)))));

// Q437 games A / C: the first segment of a team competitive run, the drop inside levels 1-5 (no checkpoint yet)
const hA = hashN++;
const cA = runKeys({ [hA]: [X(B, 1, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST }), X(A, 0, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS })] });
T('[5] games A / C: a first segment, host-left at 3 / peers-gone at 4 -> settles at 3 (processed, both credited, nobody flagged, no dispute counted), both rating runs final at 3',
  settledAt(cA, mOf(hA), 3, true) && pdOf(cA, A) === 0 && pdOf(cA, B) === 0, show(cA, mOf(hA)));
{
  const bw = writes(cA, BOARD.compDuo, A).concat(writes(cA, BOARD.compDuo, B)).map(scoreOf);
  const want = v.packEndlessScore(3, 300 + 180);
  T('[5] the competitive board takes depth 3 and the team score of the settled seats (480), never the deeper record\'s', bw.length === 2 && bw.every((x) => x === want), bw.join(',') + ' want ' + want);
}
// Q437 game B: the first segment [0,5] settled (a checkpoint both wrote), the drop inside levels 6-10
const hB0 = hashN++, hB1 = hashN++;
const cB0 = runKeys({ [hB0]: [X(A, 0, CMP(0, 5), { scores: [500, 400] }), X(B, 1, CMP(0, 5), { scores: [500, 400] })] });
T('[5] game B, run 1: the checkpoint segment [0,5] settles as ever (not this shape)', processedOf(cB0).has(mOf(hB0)) && credited(cB0, A) && !/Q438/.test(lineOf(cB0, mOf(hB0))), show(cB0, mOf(hB0)));
const carry = (r) => { const o = {}; for (const k of Object.keys(r.state)) o[k] = r.state[k]; return o; };
const cB1 = runKeys({ [hB0]: [X(A, 0, CMP(0, 5), { scores: [500, 400] }), X(B, 1, CMP(0, 5), { scores: [500, 400] })],
  [hB1]: [X(B, 1, CMP(5, 6), { scores: [650, 520], disp: DISP.HOST }), X(A, 0, CMP(5, 7), { scores: [700, 500], disp: DISP.PEERS })] }, carry(cB0));
T('[5] game B, run 2: the second segment, host-left at 6 / peers-gone at 7 -> settles at 6, the run final at 6 (it used to wait a day and settle at 5)',
  settledAt(cB1, mOf(hB1), 6, true), show(cB1, mOf(hB1)));
// the host passed the next checkpoint alone: his checkpoint segment (finished) on the key the other wrote host-left on
const hC = hashN++;
const cC = runKeys({ [hC]: [X(A, 0, CMP(0, 5), { scores: [620, 300], disp: DISP.FIN }), X(B, 1, CMP(0, 4), { scores: [560, 330], disp: DISP.HOST })] });
T('[5] the host passed a checkpoint alone (finished [0,5]) / the other lost him at 4 (host-left): settles at 4, final',
  settledAt(cC, mOf(hC), 4, true), show(cC, mOf(hC)));
// casual and classic duos
const hD = hashN++;
const cD = runKeys({ [hD]: [X(A, 0, CAS(0, 9), { scores: [900, 600], disp: DISP.PEERS }), X(B, 1, CAS(0, 8), { scores: [800, 700], disp: DISP.HOST })] });
T('[5] casual duo: settles at 8 (processed, both credited, nobody flagged)', settledAt(cD, mOf(hD), 8, null), show(cD, mOf(hD)));
{
  const bw = writes(cD, BOARD.duo, A).concat(writes(cD, BOARD.duo, B)).map(scoreOf);
  T('[5] casual duo: the board takes depth 8 and the settled team score (1400)', bw.length === 2 && bw.every((x) => x === v.packEndlessScore(8, 800 + 600)), bw.join(','));
}
const hE = hashN++;
const cE = runKeys({ [hE]: [X(A, 0, CLS(0, 4), { scores: [500, 400], disp: DISP.PEERS }), X(B, 1, CLS(0, 3), { scores: [450, 420], disp: DISP.HOST })] });
T('[5] team classic duo: settles at 3', settledAt(cE, mOf(hE), 3, null) && writes(cE, BOARD.classicDuo, A).length === 1, show(cE, mOf(hE)));
// two equal team records after a drop: held before by sanity (no final bit, a non-finished disposition)
const hF = hashN++;
const cF = runKeys({ [hF]: [X(A, 0, CMP(0, 4), { scores: [400, 300], disp: DISP.PEERS }), X(B, 1, CMP(0, 4), { scores: [400, 300], disp: DISP.HOST })] });
T('[5] two equal team competitive records (peers-gone / host-left, no final bit): settle at 4, final', settledAt(cF, mOf(hF), 4, true) && !/endless sanity/.test(warnOf(cF, mOf(hF))), show(cF, mOf(hF)));
// left as before
const hG = hashN++;
const cG = runKeys({ [hG]: [X(A, 0, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS }), X(B, 1, CMP(0, 3), { scores: [300, 200], disp: DISP.QUIT })] });
T('[5] a user-quit record with peers-gone: the two-voice lane as before (not settled, nothing credited, nobody flagged)',
  !processedOf(cG).has(mOf(hG)) && noWrite(cG, DUO) && flagged0(cG, mOf(hG)) && !/Q438/.test(cG.out), show(cG, mOf(hG)));
const hH = hashN++;
const cH = runKeys({ [hH]: [X(A, 0, CMP(0, 4, { rr: 1 }), { disp: DISP.PEERS }), X(B, 1, CMP(0, 3, { rr: 2 }), { disp: DISP.HOST })] });
T('[5] records that cross (a reroll bit only the shallower one has): the two-voice lane as before', !processedOf(cH).has(mOf(hH)) && noWrite(cH, DUO) && flagged0(cH, mOf(hH)) && !/Q438/.test(cH.out), show(cH, mOf(hH)));

// ---- [6] the run summary ----
console.log('-- [6] the run summary --');
{
  const rowE = (r) => ((r.summary.match(/\| two-player endless runs after a dropped connection, settled on the part both records wrote[^\n|]*\| ([0-9]+) \|/) || [])[1]);
  T('[6] games A / C count 1', rowE(cA) === '1', rowE(cA));
  T('[6] the checkpoint alone counts 0, game B run 2 counts 1', rowE(cB0) === '0' && rowE(cB1) === '1', rowE(cB0) + ' ' + rowE(cB1));
  T('[6] a user-quit record counts 0', rowE(cG) === '0', rowE(cG));
}

// ---- [7] wiring pins + mutation self-check ----
console.log('-- [7] wiring pins + mutation self-check --');
{
  const gi = SRC.indexOf('function groupRecords(recs, opts)'), ci = SRC.indexOf('const ec = endlessCommonVerdict(g);', gi), wi = SRC.indexOf('const writers = new Set(g.map(r => String(r.steamID))).size;', gi);
  T('[7] the grouping reads the verdict ahead of the consistency test (after the solo / couch entries)', gi > 0 && ci > gi && wi > ci && SRC.indexOf('couch segment', gi) < ci);
  const blk = ci > 0 ? SRC.slice(ci, SRC.indexOf('continue;', ci)) : '';
  T('[7] the verdict\'s branch flags nobody and says so', blk.length > 0 && !/recordFlag|flagPlayer|sigDirty|inconsistentGroups/.test(blk) && /nobody flagged \(Q438\)/.test(blk));
  const fi = SRC.indexOf('function endlessCommonVerdict(g)'), fb = fi > 0 ? SRC.slice(fi, SRC.indexOf('\n}\n', fi)) : '';
  T('[7] the verdict takes each seat\'s smaller score (Math.min) and only adds the final bit', /Math\.min\(S\.d\[10 \+ i\] \| 0, L\.d\[10 \+ i\] \| 0\)/.test(fb) && /tail\[5\] = \(tail\[5\] \| fin\) \| 0;/.test(fb));
  T('[7] seedcap.js audits the same rewrite at the top of pendingOfGroup, the claimants only', /const ec = v\.endlessCommonVerdict\(g\);\n\s*if \(ec\) \{\n\s*g = ec\.g;\n\s*all = ec\.g\.filter\(\(r\) => ec\.claim\.indexOf\(/.test(SRC_SC));
  const mutant = (src, from, to, tagS) => {
    if (src.split(from).length !== 2) { bad('[7] mutation anchor not found exactly once: ' + tagS); return null; }
    return src.replace(from, to);
  };
  const runMut = (label, from, to, fn) => {
    const m = mutant(SRC, from, to, label);
    if (!m) return;
    const script = path.join(__dirname, '..', '.mutant-endless-common-' + process.pid + '.js');
    try { fs.writeFileSync(script, m); fn(script); } finally { try { fs.unlinkSync(script); } catch (e) {} }
  };
  // the call taken out of the grouping: games A / C go back to the two-voice lane (not settled, both counted a dispute)
  runMut('the call taken out', 'const ec = endlessCommonVerdict(g);', 'const ec = null;', (script) => {
    const h = hashN++;
    const r = runKeys({ [h]: [X(B, 1, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST }), X(A, 0, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS })] }, null, script);
    T('[7] the call taken out -> games A / C held again (not processed, nothing credited, a dispute counted on both)', !processedOf(r).has(mOf(h)) && noWrite(r, DUO) && pdOf(r, A) === 1 && pdOf(r, B) === 1, show(r, mOf(h)));
    const h2 = hashN++;
    const r2 = runKeys({ [h2]: [X(A, 0, CMP(0, 4), { scores: [400, 300], disp: DISP.PEERS }), X(B, 1, CMP(0, 4), { scores: [400, 300], disp: DISP.HOST })] }, null, script);
    T('[7] the call taken out -> two equal team records held by sanity again (B-F7)', !processedOf(r2).has(mOf(h2)) && noWrite(r2, DUO) && /endless sanity \[disp\]/.test(warnOf(r2, mOf(h2))), show(r2, mOf(h2)));
  });
  // each seat's larger score: the unit property and the board value go red
  runMut('each seat\'s larger score', 'Math.min(S.d[10 + i] | 0, L.d[10 + i] | 0)', 'Math.max(S.d[10 + i] | 0, L.d[10 + i] | 0)', (script) => {
    const r = spawnSync(process.execPath, ['-e', [
      "process.env.STATE_SALT = 's';",
      'const v = require(' + JSON.stringify(script) + ');',
      'const ec = v.endlessCommonVerdict(JSON.parse(process.argv[1]));',
      'console.log(JSON.stringify(ec && ec.low));',
    ].join('\n'), JSON.stringify([R(A, 0, DUO, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST })])], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
    T('[7] each seat\'s larger score -> the settled scores rise above a record\'s ([420,200], [3] would be red)', (r.stdout || '').trim() === '[420,200]', (r.stdout || '') + (r.stderr || '').slice(0, 300));
    const h = hashN++;
    const rc = runKeys({ [h]: [X(B, 1, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST }), X(A, 0, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS })] }, null, script);
    const bw = writes(rc, BOARD.compDuo, A).map(scoreOf);
    T('[7] each seat\'s larger score -> the board takes the larger team score (620, not 480)', bw.length === 1 && bw[0] === v.packEndlessScore(3, 620), bw.join(','));
  });
  // the seedcap branch taken out: the audit holds the group as forgery-suspect (null) again
  {
    const from = SRC_SC.slice(SRC_SC.indexOf('const ec = v.endlessCommonVerdict(g);'), SRC_SC.indexOf('\n    }\n', SRC_SC.indexOf('const ec = v.endlessCommonVerdict(g);')) + 7);
    const m = /^const ec = v\.endlessCommonVerdict\(g\);\n[\s\S]*all = ec\.g\.filter[\s\S]*\n    \}\n$/.test(from) ? mutant(SRC_SC, from, '', 'seedcap branch') : (bad('[7] mutation anchor not found exactly once: seedcap branch'), null);
    if (m) {
      const script = path.join(__dirname, '..', '.mutant-seedcap-common-' + process.pid + '.js');
      try {
        fs.writeFileSync(script, m);
        const r = spawnSync(process.execPath, ['-e', [
          "process.env.STATE_SALT = 's';",
          'const sc = require(' + JSON.stringify(script) + ');',
          "const p = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', JSON.parse(process.argv[1]));",
          'console.log(JSON.stringify(p && p.scores));',
        ].join('\n'), JSON.stringify([R(A, 0, DUO, CMP(0, 4), { scores: [420, 180], disp: DISP.PEERS }), R(B, 1, DUO, CMP(0, 3), { scores: [300, 200], disp: DISP.HOST })].map((x) => ({ d: x.d, roster: x.roster, w: x.steamID })))], { encoding: 'utf8', cwd: path.join(__dirname, '..') });
        T('[7] the seedcap branch taken out -> the group is not audited again (null, [4] would be red)', (r.stdout || '').trim() === 'null', (r.stdout || '') + (r.stderr || '').slice(0, 300));
      } finally { try { fs.unlinkSync(script); } catch (e) {} }
    }
  }
  // both writers claiming again (the first draft: all = ec.g): the frame convicts the honest player
  {
    const fromC = 'all = ec.g.filter((r) => ec.claim.indexOf(String(r.steamID != null ? r.steamID : (r.w || \'\'))) >= 0);';
    const m = mutant(SRC_SC, fromC, 'all = ec.g;', 'seedcap claimants');
    if (m) {
      const script = path.join(__dirname, '..', '.mutant-seedcap-claim-' + process.pid + '.js');
      try {
        fs.writeFileSync(script, m);
        const f = frame(script, FRAME_G(), 99070);
        T('[7] both writers claiming again -> the honest player (A) is convicted in the frame ([4] would be red)', !!f && Array.isArray(f.conv) && f.conv.indexOf(A) >= 0, JSON.stringify(f));
      } finally { try { fs.unlinkSync(script); } catch (e) {} }
    }
  }
}

console.log(failN ? ('FAIL x' + failN + ' (endless-common-part)') : 'ALL OK (endless-common-part)');
process.exit(failN ? 1 : 0);
