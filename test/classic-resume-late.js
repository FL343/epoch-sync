'use strict';
// cloud audit Q454 (2026-11-27, player voice V225 "my classic solo run reached 400-odd levels and is not on the board"): a classic
//   segment of a resumed session judged while its run was still FINAL. A classic token resume (O216: the shop-token row the guard cut
//   at the purchase depth) revives a FINAL run at any proven depth; only the resumed session's first segment carries SEG_RESUMED + the
//   row's tag. When the one-match-at-a-time slot (writerPaced) pushed that first segment a run -- the dead session's last segments
//   settled in the same run -- or the guard's outbox retried it later, the session's next segment was judged on the dead line:
//   chain REJECT (after-final), processed, never settled; every later segment of the run waited for it (live 11-27: run 918040754,
//   84 FINAL, the resume [84,85] deferred, [85,90] rejected, the run stuck at 85 with 80 segments waiting until Q428's gap rule let the
//   next one settle on its own a day later -- five levels' XP lost for good). Q425 only made the casual one wait.
//   Fix (validate.js classicLateResumeFits + the lane's lateResume): a plain classic segment of a FINAL run (not burnt, start > 0,
//   end past the head) waits for the resume on the chain-wait clock; past COMP.CHAIN_WAIT_MS the old verdict, nobody flagged. Never
//   the chain-gap rule (a waited-out gap would settle play past a death that bought no resume).
//   [0] exports + wiring pins (the summary row; soloChainVerdict still judges after-final before the chain)
//   [1] unit: classicLateResumeFits -- the live shape fits, a FINAL one too; not: a run that is not FINAL / burnt / missing, a resume,
//       casual / competitive / couch, depth 0, a segment ending at or behind the head; soloChainPlan unchanged (after-final, never a
//       gap settle on a FINAL run, even past the gap window)
//   [2] main(): the live shape (the dead session's last segment, the resume and the two next segments in one run; the writer slot pushes
//       the resume): the two wait, the resume settles a run later, both chain behind it -- head 95, XP and ladder equal to the usual order
//   [3] main(): the outbox order (the resume reaches the shards a run after its session's next segments): the same end state
//   [4] main(): the resume that never comes: still waiting two days on (no gap settle on a FINAL run), past the chain wait rejected,
//       processed, nobody flagged; the run stays FINAL at its head
//   [5] class tripwires: every resume kind soloChainVerdict lets through a FINAL run has a late-resume wait in the solo lane (Q425 casual
//       + couch casual, Q454 classic) -- a new kind there needs its own; every lane that calls soloChainPlan is accounted for (the solo
//       lane, the team classic lane: the Q454 wait; the seat-only pass: holds, never processes; team competitive: no token resume) --
//       a new caller needs its own decision on a segment of a resumed session seen before the resume
//   [6] mutations (each must turn this file red)
//   [7] main(), team classic (the consensus lane, the same rule): the resume [5,6] reaching the shards a run after the session's next
//       segment [6,10]: it waits, then chains (head 10); the resume that never comes: still waiting two days on, then the old reject
// Usage: node test/classic-resume-late.js [<epoch-sync root>] [--no-mut] [--fail-fast]   (root defaults to this checkout). Outside
//   the tree it is the Q454 repro: an epoch-sync without the fix exits 1, with it 0. Harness = test/casual-resume-late.js (copied
//   tree + one sealed test key + a stub Steam, every *_FILE redirected); its advance() also moves the writer slot marks back.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH', 'ENDLESS_LB_CLASSIC_SOLO', 'SAVE_BOX_LB_CLASSIC', 'COMP_CHAIN_WAIT_MS', 'COMP_GAP_SETTLE_MS', 'ENDLESS_PACE_FRAC', 'SEASON_NOW'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ARGS = process.argv.slice(2);
const NO_MUT = ARGS.indexOf('--no-mut') >= 0;
const FAIL_FAST = ARGS.indexOf('--fail-fast') >= 0;
const ROOT = path.resolve(ARGS.find((a) => !a.startsWith('--')) || path.join(__dirname, '..'));
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
const stopIfRed = () => { if (FAIL_FAST && failN) { console.log('\n' + failN + ' FAILED (fail-fast)'); process.exit(1); } };

const CLS = A.SEG_CLASSIC, RES = A.SEG_RESUMED, FIN = A.SEG_FINAL, CAS = A.SEG_CASUAL, CMP = A.SEG_COMP, COUCH = A.SEG_COUCH;
const HOUR = 3600 * 1000, DAY = 86400000;
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

console.log('=== Q454 a classic segment of a resumed session judged while its run is still FINAL (' + path.basename(ROOT) + ') ===');
const HAS = typeof v.classicLateResumeFits === 'function';
T('[0] validate.js exports classicLateResumeFits', HAS);
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 160));
  pin('summary row', "'| classic segments of a FINAL run that fit a classic token resume not seen yet (Q454): waiting / the resume never came (not settled, nobody flagged) | ' + s('classicLateWait', 0) + ' / ' + s('classicLateGone', 0) + ' |',");
  pin('soloChainVerdict judges after-final before the chain (a classic segment on a dead run never reaches the chain-gap rule)',
    "if (run && run.final && !casualResume && !classicResume) return { ok: false, reason: 'after-final' };");
  pin('the solo lane asks lateResume on after-final before it rejects', "if (plan.ok === false && plan.reason === 'after-final' && lateResume('after-final') === 'wait') return false;");
}

// ---- [1] unit ----
if (HAS) {
  const fits = v.classicLateResumeFits;
  const seg = (sd, ed, flags) => ({ startDepth: sd, endDepth: ed, flags: flags | 0, seasonId: 0 });
  const dead = () => ({ max: 84, final: 1, ms: 0, saves: {}, t: 0, k: 2 });
  eq('[1] the live shape: [85,90] on a run FINAL at 84 fits a classic resume not seen yet', fits(dead(), seg(85, 90, CLS)), true);
  eq('[1] a later segment of the resumed session too ([90,95])', fits(dead(), seg(90, 95, CLS)), true);
  eq('[1] the resumed session\'s own FINAL ([85,88] death) too', fits(dead(), seg(85, 88, CLS | FIN)), true);
  eq('[1] a resume that started below the head ([80,85] of a session resumed at 78): ends past the head -> fits', fits(dead(), seg(80, 85, CLS)), true);
  eq('[1] a segment ending at the head (a stale one of the dead line / a replay behind it) -> no (chain-back after any revive)', fits(dead(), seg(80, 84, CLS)), false);
  eq('[1] a segment ending behind the head -> no', fits(dead(), seg(70, 75, CLS)), false);
  eq('[1] depth 0 -> no (a restart)', fits(dead(), seg(0, 90, CLS)), false);
  eq('[1] a run that is not FINAL -> no (the old path)', fits(Object.assign(dead(), { final: 0 }), seg(85, 90, CLS)), false);
  eq('[1] a burnt run -> no', fits(Object.assign(dead(), { burnt: 1 }), seg(85, 90, CLS)), false);
  eq('[1] no run memory -> no', fits(undefined, seg(85, 90, CLS)), false);
  eq('[1] a classic resume itself -> no (soloChainVerdict lets it through)', fits(dead(), seg(84, 85, CLS | RES)), false);
  eq('[1] casual -> no (Q425 reads it)', fits(dead(), seg(85, 90, CAS)), false);
  eq('[1] classic + casual (illegal mix) -> no', fits(dead(), seg(85, 90, CLS | CAS)), false);
  eq('[1] competitive (no classic bit) -> no', fits(dead(), seg(85, 90, 0)), false);
  eq('[1] classic + COMP -> no', fits(dead(), seg(85, 90, CLS | CMP)), false);
  eq('[1] classic + COUCH -> no (no classic couch run)', fits(dead(), seg(85, 90, CLS | COUCH)), false);
  // the planner itself is not changed: after-final, and never a gap settle on a FINAL run (the lane decides the wait)
  const st = { runs: { k: dead() }, wait: {}, held: {} };
  const P = (f, m, t) => v.soloChainPlan(st, 'k', f, m, t, { requireTag: false, gapSettle: { seen: {} } });
  const T0 = Date.UTC(2026, 10, 27, 4);
  eq('[1] soloChainPlan: [85,90] on a FINAL run -> after-final (unchanged)', P(seg(85, 90, CLS), 'm1', T0), { ok: false, reason: 'after-final' });
  eq('[1] soloChainPlan: [90,95] two days on with gapSettle -> still after-final, never a gap settle', P(seg(90, 95, CLS), 'm2', T0 + 2 * DAY), { ok: false, reason: 'after-final' });
  eq('[1] soloChainPlan: the classic resume [84,85] -> settles + revives (unchanged)', P(seg(84, 85, CLS | RES), 'm0', T0), { ok: true, proven: 84, revive: true });
}
stopIfRed();

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('9e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099112701;
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
// guard-signed solo segment (attVer 5, BASE_LEN 30; layout of test/casual-resume-late.js soloRec; classic: no build / picks / rerolls)
function soloRec(sid, id, runSeed, o) {
  const [lo, hi] = sidPair(sid);
  const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1,
    300, o.score == null ? 1000 : o.score, o.disp | 0, lo, hi, o.sd | 0, o.ed | 0, 0, 0, o.season | 0, o.flags | 0,
    KEY_ID, (5 | (((o.tag | 0) & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  const d = b.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };   // the guard's single-shape start

function copyTree(root, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q454-' + tag + '-'));
  require(path.join(root, 'test', 'root-listing')).copyRootTree(root, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  return dir;
}
const FILE_VARS = Array.from(new Set(Array.from(SRC.matchAll(/process\.env\.([A-Z0-9_]+_FILE)\b/g), m => m[1]))).filter((k) => k !== 'RECOVER_FILE');
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t }; };',
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
  "    return resp({ leaderboardEntryInformation: { leaderboardEntries: ents.map(e => ({ steamID: String(e.steamID), score: e.score | 0, detailData: e.detailData || '' })) } });",
  '  }',
  '  return resp({});',
  '};',
].join('\n');
const hexLE = (arr) => arr.map(n => { const b = ((n | 0) >>> 0).toString(16).padStart(8, '0'); return b.slice(6, 8) + b.slice(4, 6) + b.slice(2, 4) + b.slice(0, 2); }).join('');
function runCron(tree, boards, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q454-run-'));
  try {
    const stub = path.join(dir, 'stub.js'); fs.writeFileSync(stub, STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ boards: boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    const sumPath = path.join(dir, 'summary.md'); fs.writeFileSync(sumPath, '');
    const stateEnv = {};
    for (const k of FILE_VARS) stateEnv[k] = path.join(dir, k.toLowerCase() + '.json');
    for (const k of Object.keys(files || {})) if (stateEnv[k]) fs.writeFileSync(stateEnv[k], JSON.stringify(files[k]));
    const base = Object.assign({}, process.env);
    for (const k of SCRUB) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: 's',
      SEASON_NOW: '2026-10-01T00:00:00Z', STUB_FIXTURE: fxPath, STUB_LOG: logPath, GITHUB_STEP_SUMMARY: sumPath, CONCURRENCY: '1',
      STRICT_BOARDS: '0', READ_RETRY_MS: '0', RECOVER_FILE: path.join(dir, 'no-recover.json'), RESUME_TAG_REQUIRED: '0',
    }, stateEnv);
    const r = spawnSync(process.execPath, ['-r', stub, path.join(tree, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
    const posts = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    const summary = fs.readFileSync(sumPath, 'utf8');
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// carry a run's state into the next run as if `ms` of wall time had passed (stored instants move back instead) -- the starts, the
//   chain memory and its wait clocks, and the writer slot marks (signals.players[].bz: writerPaced reads them against the real clock)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
  }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) if (sg.players[k] && sg.players[k].bz) sg.players[k].bz -= ms;
  return files;
}
const LB = { xp: 5, cp: 8, classic: 31 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const used = {}, sids = new Set();
  for (const r of recs) { sids.add(r.sid); used[r.sid] = r.shard != null ? r.shard : (used[r.sid] || 0); boards[used[r.sid]++].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: LB.classic, name: v.ENDLESS_LB_CLASSIC_SOLO, entries: [] }, { id: 32, name: v.SAVE_BOX_LB_CLASSIC, entries: [] }, { id: 33, name: v.ENDLESS_LB_CLASSIC_DUO, entries: [] },
    { id: 25, name: 'endless_board_solo', entries: [] }, { id: 26, name: 'endless_board_overall', entries: [] });
  return boards;
}
// steps: [msSincePrevious, recs]; files0 seeds the first run
function timeline(tree, steps, files0) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const files = state ? advance(state, ms) : files0;
    const r = runCron(tree, world(recs), files);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const writesTo = (r, id, sid) => r.posts.filter((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + id + '(&|$)').test(x.body) && (!sid || new RegExp('steamid=' + sid + '(&|$)').test(x.body)));
const scoreOf = (w) => Number((/(?:^|&)score=(-?\d+)/.exec(w.body) || [0, 0])[1]);
const lastScore = (r, id, sid) => { const w = writesTo(r, id, sid); return w.length ? scoreOf(w[w.length - 1]) : null; };
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const flaggedOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {}).f | 0);
const trustFl = (r, sid) => ((((r.state.TRUST_FILE || {}).acct || {})[v.pid(sid)] || {}).ev || []).filter((e) => e.s === 'fl').length;
const linesOf = (r, m) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join('\n').slice(0, 1500);
const runOf = (r, key) => (((r.state.SOLO_FILE || {}).runs || {})[key]) || {};
const settledIn = (r, s) => procHas(r, s.m) && new RegExp('settle ' + s.m.replace(/[-]/g, '\\-') + ':').test(r.out);
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2500)); return true; };

// one classic solo run, seeded at the head 80 (its earlier segments settled before): c4 = the dead session's last segment [80,84]
//   FINAL, d0 = the classic token resume [84,86] (the row's tag; live [84,85] -- two levels here so the writer slot holds it 60 s),
//   d1 / d2 = the resumed session's next segments [86,90] / [90,95].
//   o.passes = [[ms before the pass, [seg names on the shards from this pass on]], ...] (records stay on the shards); every start row
//   is on the shards from the first run (step 0). Returns { rs (one per pass), seg (by name), S, key }.
const SEGS = [['c4', 80, 84, CLS | FIN, 0], ['d0', 84, 86, CLS | RES, 0x5A5], ['d1', 86, 90, CLS, 0], ['d2', 90, 95, CLS, 0]];
function play(tree, label, sidN, rs, passes) {
  const S = SID(sidN), key = v.soloRunKey(v.pid(S), 0, rs);
  const seg = {};
  SEGS.forEach(([name, sd, ed, flags, tag], i) => {
    const d = soloRec(S, 'q454-' + label + '-' + name, rs, { sd, ed, flags, tag, score: 2000 + 100 * i });
    seg[name] = { name, d, m: keyOf(d), i };
  });
  const starts = SEGS.map(([name], i) => ({ sid: S, d: start7(seg[name].d[3], S, rs), shard: 10 + i }));
  const seed = { SOLO_FILE: { runs: { [key]: { max: 80, ms: 0, saves: {}, t: Date.now(), seg0: 1, k: 2 } }, wait: {}, ms: {} } };
  const steps = [[0, starts]], on = new Set();
  for (const [ms, names] of passes) { for (const n of names) on.add(n); steps.push([ms, starts.concat([...on].map((n) => ({ sid: S, d: seg[n].d, shard: 30 + seg[n].i })))]); }
  const out = timeline(tree, steps, seed).slice(1);
  return { rs: out, seg, S, key };
}
const settledAny = (X, n) => X.rs.some((r) => settledIn(r, X.seg[n]));
const rejectedAny = (X, n) => X.rs.some((r) => /REJECT/.test(linesOf(r, X.seg[n].m)));
const waitedQ454 = (X, n) => X.rs.some((r) => /waits for it \(Q454\)/.test(linesOf(r, X.seg[n].m)));
const xpSum = (X) => X.rs.reduce((n, r) => n + (lastScore(r, LB.xp, X.S) || 0), 0);
const classicBest = (X) => Math.max(0, ...X.rs.map((r) => writesTo(r, LB.classic, X.S).map(scoreOf)).reduce((a, b) => a.concat(b), []));
const depthOf = (packed) => Math.floor(packed / v.ENDLESS.BOARD_SCALE);
const lastRun = (X) => runOf(X.rs[X.rs.length - 1], X.key);
const lastFlag = (X) => flaggedOf(X.rs[X.rs.length - 1], X.S) + trustFl(X.rs[X.rs.length - 1], X.S);
const allLines = (X) => Object.keys(X.seg).map((n) => n + ' :: ' + X.rs.map((r) => linesOf(r, X.seg[n].m)).join(' | ')).join('\n');

const TREE = copyTree(ROOT, 'main');
try {
  // the usual order (control): the dead line, the resume a run later, its session after it -- nothing is judged on the dead line
  const U = play(TREE, 'u', 9454000, 945400, [[2 * HOUR, ['c4']], [2 * HOUR, ['d0']], [2 * HOUR, ['d1', 'd2']], [2 * HOUR, []]]);
  if (!brk(U.rs, 4, '[2] usual order')) {
    T('[2] control (usual order): all four settle, head 95, the run not FINAL', ['c4', 'd0', 'd1', 'd2'].every((n) => settledAny(U, n)) && lastRun(U).max === 95 && !lastRun(U).final, JSON.stringify(lastRun(U)) + '\n' + allLines(U));
    T('[2] control: the classic ladder at depth 95', depthOf(classicBest(U)) === 95, String(classicBest(U)));
  }
  // [2] the live shape: c4 + d0 + d1 + d2 on the shards in one run, 121 s after their starts were first seen -- c4 settles (FINAL,
  //   pacing 4 levels x 30 s = 120 s), its writer slot pushes d0 (ready 180 s after the starts: the run may start up to 59 s late)
  const L = play(TREE, 'l', 9454001, 945401, [[121 * 1000, ['c4', 'd0', 'd1', 'd2']], [2 * HOUR, []], [2 * HOUR, []]]);
  if (!brk(L.rs, 3, '[2] live shape')) {
    const r1 = L.rs[0];
    T('[2] run 1: the dead line\'s FINAL settles, the resume is deferred by the writer slot (the live order)', settledIn(r1, L.seg.c4) && !procHas(r1, L.seg.d0.m) && /writer-pacing/.test(linesOf(r1, L.seg.d0.m)), linesOf(r1, L.seg.c4.m) + '\n' + linesOf(r1, L.seg.d0.m));
    T('[2] run 1: [86,90] and [90,95] wait for the resume (Q454), not processed', waitedQ454(L, 'd1') && waitedQ454(L, 'd2') && !procHas(r1, L.seg.d1.m) && !procHas(r1, L.seg.d2.m), allLines(L));
    T('[2] the resume settles a run later and both chain behind it: all four settled, none rejected', ['c4', 'd0', 'd1', 'd2'].every((n) => settledAny(L, n)) && !rejectedAny(L, 'd1') && !rejectedAny(L, 'd2'), allLines(L));
    eq('[2] the run: head 95, not FINAL (the live run stuck at the resume\'s end)', [lastRun(L).max, !!lastRun(L).final], [95, false]);
    T('[2] the classic ladder at depth 95', depthOf(classicBest(L)) === 95, String(classicBest(L)));
    T('[2] XP equal to the usual order (no level lost)', xpSum(L) === xpSum(U) && xpSum(U) > 0, 'got ' + xpSum(L) + ' want ' + xpSum(U) + ' (> 0)');
    eq('[2] nobody flagged', lastFlag(L), 0);
    eq('[2] the summary counts the waits', L.rs.map((r) => (/classic token resume not seen yet \(Q454\)[^|]*\| ([^|]*) \|/.exec(r.summary) || [0, '?'])[1].trim())[0], '2 / 0');
  }
  stopIfRed();
  // [3] the outbox order: c4 + d1 + d2 a run before the resume
  const O = play(TREE, 'o', 9454002, 945402, [[2 * HOUR, ['c4', 'd1', 'd2']], [2 * HOUR, ['d0']], [2 * HOUR, []]]);
  if (!brk(O.rs, 3, '[3] outbox order')) {
    T('[3] run 1: [86,90] and [90,95] wait for the resume (Q454)', waitedQ454(O, 'd1') && waitedQ454(O, 'd2') && !procHas(O.rs[0], O.seg.d1.m), allLines(O));
    T('[3] the resume comes a run later: all four settled, none rejected', ['c4', 'd0', 'd1', 'd2'].every((n) => settledAny(O, n)) && !rejectedAny(O, 'd1') && !rejectedAny(O, 'd2'), allLines(O));
    eq('[3] the run: head 95, not FINAL; XP equal to the usual order', [lastRun(O).max, !!lastRun(O).final, xpSum(O)], [95, false, xpSum(U)]);
    eq('[3] nobody flagged', lastFlag(O), 0);
  }
  stopIfRed();
  // [4] the resume never comes: c4 + d1; two days on (past the gap window: Q428 never settles it on a dead run), then past the chain wait
  const N = play(TREE, 'n', 9454003, 945403, [[2 * HOUR, ['c4', 'd1']], [2 * DAY, []], [5 * DAY + HOUR, []], [2 * HOUR, []]]);
  if (!brk(N.rs, 4, '[4] never comes')) {
    T('[4] two days on: still waiting (Q454), not settled, not processed -- no gap settle on a FINAL run', /waits for it \(Q454\)/.test(linesOf(N.rs[1], N.seg.d1.m)) && !procHas(N.rs[1], N.seg.d1.m) && !settledAny(N, 'd1') && !/chain gap waited out/.test(linesOf(N.rs[1], N.seg.d1.m)), linesOf(N.rs[1], N.seg.d1.m));
    T('[4] past the chain wait: the old verdict (after-final), processed, never settled', /never came -- not settled, nobody flagged \(Q454\)/.test(linesOf(N.rs[2], N.seg.d1.m)) && /chain REJECT \(after-final\)/.test(linesOf(N.rs[2], N.seg.d1.m)) && procHas(N.rs[2], N.seg.d1.m) && !settledAny(N, 'd1'), linesOf(N.rs[2], N.seg.d1.m));
    eq('[4] the run stays FINAL at its head 84', [lastRun(N).max, !!lastRun(N).final], [84, true]);
    eq('[4] nobody flagged', lastFlag(N), 0);
    T('[4] the summary counts the one that never came', /classic token resume not seen yet \(Q454\)[^|]*\| 0 \/ 1 \|/.test(N.rs[2].summary), (/\(Q454\)[^\n]*/.exec(N.rs[2].summary) || [''])[0]);
  }
  stopIfRed();
  // [7] team classic (the consensus lane; the same rule): a run FINAL at 5, the resumed session's segment [6,10] seen before the resume [5,6]
  {
    const SA = SID(9454010), SB = SID(9454011), RS = 945410, TT = 0x3C5A;
    const kT = v.teamRunKey([SA, SB], 0, RS);
    const tm = (id, seat, o) => {   // wire-form type-7 record, pc 2 (test/resume-replay.js tm): header, scores, disp, roster, the tail + the resume tag
      const d = [0xB1, 3, 7, A.hash32(id) | 0, RS, seat, 0, 0, 2, 1200, 1000, 900, 0];
      for (const s of [SA, SB]) { const q = sidPair(s); d.push(q[0], q[1]); }
      d.push(o.sd | 0, o.ed | 0, 0, 0, 0, o.flags | 0, 0, 0, 0, 0, 0, o.tag | 0);
      return d;
    };
    const both = (id, o, sh) => [{ sid: SA, d: tm(id, 0, o), shard: sh }, { sid: SB, d: tm(id, 1, o), shard: sh + 1 }];
    const teamPlay = (label, passes) => {
      const seg = { r: both('q454-t-' + label + '-r', { sd: 5, ed: 6, flags: CLS | RES, tag: TT }, 20), n: both('q454-t-' + label + '-n', { sd: 6, ed: 10, flags: CLS }, 22) };
      const seed = { SOLO_FILE: { runs: { [kT]: { max: 5, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 } }, wait: {}, ms: {} } };
      const steps = [], on = new Set();
      passes.forEach(([ms, names], i) => { for (const n of names) on.add(n); steps.push([i === 0 ? 0 : ms, [...on].reduce((a, n) => a.concat(seg[n]), [])]); });
      return { rs: timeline(TREE, steps, seed), m: { r: keyOf(seg.r[0].d), n: keyOf(seg.n[0].d) } };
    };
    const tSettled = (X, n) => X.rs.some((r) => r.out.indexOf('endless-classic settle ' + X.m[n] + ':') >= 0);
    const tLines = (X, n) => X.rs.map((r, i) => i + ': ' + linesOf(r, X.m[n])).join('\n');
    const tRun = (X) => runOf(X.rs[X.rs.length - 1], kT);
    const TO = teamPlay('o', [[0, ['n']], [2 * HOUR, ['r']], [2 * HOUR, []], [2 * HOUR, []]]);
    if (!brk(TO.rs, 4, '[7] team outbox order')) {
      T('[7] team: run 1: [6,10] waits for the resume (Q454), not processed', /waits for it \(Q454\)/.test(linesOf(TO.rs[0], TO.m.n)) && !procHas(TO.rs[0], TO.m.n), tLines(TO, 'n'));
      T('[7] team: the resume settles, [6,10] chains behind it; nothing rejected', tSettled(TO, 'r') && tSettled(TO, 'n') && !TO.rs.some((r) => /REJECT/.test(linesOf(r, TO.m.n))), tLines(TO, 'r') + '\n' + tLines(TO, 'n'));
      eq('[7] team: the run head 10, not FINAL (before: stuck at the resume\'s end 6)', [tRun(TO).max, !!tRun(TO).final], [10, false]);
      eq('[7] team: nobody flagged', [flaggedOf(TO.rs[3], SA) + trustFl(TO.rs[3], SA), flaggedOf(TO.rs[3], SB) + trustFl(TO.rs[3], SB)], [0, 0]);
    }
    stopIfRed();
    const TN = teamPlay('n', [[0, ['n']], [2 * DAY, []], [5 * DAY + HOUR, []]]);
    if (!brk(TN.rs, 3, '[7] team never comes')) {
      T('[7] team: two days on still waiting (Q454), not processed', /waits for it \(Q454\)/.test(linesOf(TN.rs[1], TN.m.n)) && !procHas(TN.rs[1], TN.m.n) && !tSettled(TN, 'n'), tLines(TN, 'n'));
      T('[7] team: past the chain wait the old reject (after-final), processed, never settled', /never came -- not settled, nobody flagged \(Q454\)/.test(linesOf(TN.rs[2], TN.m.n)) && /team classic segment chain REJECT \(after-final\)/.test(linesOf(TN.rs[2], TN.m.n)) && procHas(TN.rs[2], TN.m.n) && !tSettled(TN, 'n'), tLines(TN, 'n'));
      eq('[7] team: the run stays FINAL at 5', [tRun(TN).max, !!tRun(TN).final], [5, true]);
    }
    stopIfRed();
  }
} finally { try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {} }

// ---- [5] class tripwire: every resume kind soloChainVerdict lets through a FINAL run has a late-resume wait in the solo lane ----
{
  const af = /if \(run && run\.final((?: && !\w+)+)\) return \{ ok: false, reason: 'after-final' \};/.exec(SRC);
  const kinds = af ? af[1].split('&&').map((x) => x.trim().replace(/^!/, '')).filter(Boolean) : [];
  // the resume kinds this file knows: their late-resume reading (Q425 / Q454); a kind missing here = a new one passes after-final
  const KNOWN = { casualResume: 'casualLateResumeAt(soloState.runs[key], f', classicResume: 'classicLateResumeFits(soloState.runs[key], f)' };
  T('[5] the after-final exemptions read (soloChainVerdict)', kinds.length >= 2, String(af && af[0]));
  const lr = /const lateResume = \(why\) => \{([\s\S]*?)\n    \};/.exec(SRC);
  T('[5] the solo lane\'s lateResume read', !!lr);
  for (const k of kinds) {
    T('[5] ' + k + ' (passes a FINAL run) has a late-resume reading in the solo lane (Q425 / Q454) -- a new resume kind there needs its own wait for the segments of its session seen first',
      !!KNOWN[k] && !!lr && lr[1].indexOf(KNOWN[k]) >= 0, k + ' -> ' + (KNOWN[k] || 'unknown kind'));
  }
  // every caller of soloChainPlan, and what it does with a segment of a resumed session judged before the resume (after-final)
  const CALLERS = [
    ['the solo lane (lateResume: Q425 / Q454)', 'const plan = soloChainPlan(soloState, key, f, m, nowMs, { recovered: !!r.recovered, gapSettle: soloGapTick });'],
    ['the seat-only pass (Q418: any plan but a settle leaves the segment held, never processed)', 'const plan = soloChainPlan(soloState, key, f, m, nowMs);'],
    ['the team classic lane (the Q454 wait below it)', 'const plan = soloChainPlan(soloState, key, f, c.m, nowMs);'],
    ['the team competitive lane (save points, no token resume: a FINAL run stays over)', 'const plan0 = soloChainPlan(soloState, key, f, c.m, nowMs);'],
  ];
  const calls = SRC.split('\n').filter((l) => /soloChainPlan\(/.test(l) && !/^\s*\/\//.test(l) && !/^function /.test(l)).map((l) => l.trim());
  T('[5] soloChainPlan has exactly the four known callers (a new one needs its own after-final decision, Q425 / Q454)', calls.length === CALLERS.length && CALLERS.every(([, s]) => calls.some((l) => l.indexOf(s) === 0)), calls.join(' || '));
  const seatOnly = /const seatOnlyPass = [\s\S]*?\n  \};/.exec(SRC);
  T('[5] the seat-only pass holds on any plan but a settle', !!seatOnly && seatOnly[0].indexOf("if (plan.ok !== true || plan.consume) { console.log(tag + ': chain '") >= 0 && seatOnly[0].indexOf('processed.add') < 0, seatOnly ? '' : 'seatOnlyPass not found');
  const tc = SRC.indexOf('const plan = soloChainPlan(soloState, key, f, c.m, nowMs);'), tcEnd = SRC.indexOf('// ===== team competitive segment', tc);
  const tcBody = tc >= 0 && tcEnd > tc ? SRC.slice(tc, tcEnd) : '';
  const tcWait = tcBody.indexOf("if (plan.reason === 'after-final' && classicLateResumeFits(soloState.runs[key], f)) {"), tcRej = tcBody.indexOf('processed.add(c.m);');
  T('[5] the team classic lane asks classicLateResumeFits before its chain reject processes the key', tcWait > 0 && tcRej > tcWait, 'wait at ' + tcWait + ', reject at ' + tcRej);
  const tcomp = SRC.indexOf('const plan0 = soloChainPlan(soloState, key, f, c.m, nowMs);');
  const tcompHead = SRC.lastIndexOf('if ((t.flags | 0) & attest.SEG_COMP) {', tcomp);
  T('[5] the team competitive lane only takes SEG_COMP segments (sanity: never with SEG_CLASSIC)', tcompHead > 0 && tcomp - tcompHead < 4000 && /\(\(fl & attest\.SEG_LINE\) && \(fl & attest\.SEG_CLASSIC\)\)/.test(SRC) && /never COMP \(a different lane\)/.test(SRC), String(tcomp - tcompHead));
}

// ---- [6] mutations: each must turn this file red ----
if (!NO_MUT) {
  const VAL = SRC;
  const MUTS = [
    ['the lane does not ask for classic', "const cl = classic && why === 'after-final' && classicLateResumeFits(soloState.runs[key], f);", 'const cl = false;'],
    ['a run that is not FINAL fits', 'if (!run || run.burnt || !run.final) return false;', 'if (!run || run.burnt) return false;'],
    ['a burnt run fits', 'if (!run || run.burnt || !run.final) return false;', 'if (!run || !run.final) return false;'],
    ['a segment ending at or behind the head fits', '(f.endDepth | 0) > (run.max | 0);\n}', 'true;\n}'],
    ['depth 0 fits', 'return (f.startDepth | 0) > 0 && (f.endDepth | 0) > (run.max | 0);', 'return (f.endDepth | 0) > (run.max | 0);'],
    ['a resume / casual / competitive / couch fits', '(fl & (attest.SEG_RESUMED | attest.SEG_CASUAL | attest.SEG_COMP | attest.SEG_COUCH))) return false;', '(fl & 0)) return false;'],
    ['the wrong fix: a classic segment on a dead run goes to the chain-gap rule (settles on its own past the gap window)',
      "if (run && run.final && !casualResume && !classicResume) return { ok: false, reason: 'after-final' };",
      "if (run && run.final && !casualResume && !classicResume && !(fl & attest.SEG_CLASSIC)) return { ok: false, reason: 'after-final' };"],
    ['the classic wait never ends', 'const gone = nowMs - (w.t0 || 0) > COMP.CHAIN_WAIT_MS;', 'const gone = cl ? false : nowMs - (w.t0 || 0) > COMP.CHAIN_WAIT_MS;'],
    ['the classic counters swapped', 'if (cl) { if (gone) RUN.classicLateGone = (RUN.classicLateGone | 0) + 1; else RUN.classicLateWait = (RUN.classicLateWait | 0) + 1; }',
      'if (cl) { if (!gone) RUN.classicLateGone = (RUN.classicLateGone | 0) + 1; else RUN.classicLateWait = (RUN.classicLateWait | 0) + 1; }'],
    ['the team classic lane does not ask', "if (plan.reason === 'after-final' && classicLateResumeFits(soloState.runs[key], f)) {", 'if (false) {'],
    ['the team classic wait never ends', 'const goneK = nowMs - (wK.t0 || 0) > COMP.CHAIN_WAIT_MS;', 'const goneK = false;'],
    ['the team classic wait ends at once', 'if (!goneK) continue;', 'if (false) continue;'],
  ];
  for (const [label, from, to] of MUTS) {
    const n = VAL.split(from).length - 1;
    if (n !== 1) { bad('[6] mutation anchor for "' + label + '" occurs ' + n + ' times in validate.js (want 1)'); continue; }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'q454-mut-'));
    try {
      require(path.join(ROOT, 'test', 'root-listing')).copyRootTree(ROOT, dir, ['.git', 'node_modules']);
      fs.copyFileSync(__filename, path.join(dir, 'test', path.basename(__filename)));   // run as the repro from outside the tree: the child is this same file
      fs.writeFileSync(path.join(dir, 'validate.js'), VAL.replace(from, () => to));
      const r = spawnSync(process.execPath, [path.join(dir, 'test', path.basename(__filename)), dir, '--no-mut', '--fail-fast'], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      const fails = ((r.stdout || '').match(/^ {2}FAIL {2}.*$/gm) || []);
      T('[6] mutation "' + label + '" -> red (' + fails.length + ' FAIL)', r.status === 1 && fails.length > 0, 'exit ' + r.status + '\n' + (r.stdout || '').slice(-1200) + (r.stderr || '').slice(-600));
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }
}

console.log(failN ? ('\n' + failN + ' FAILED') : '\nall ok');
process.exit(failN ? 1 : 0);
