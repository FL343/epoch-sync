'use strict';
// cloud audit Q428 (player voice V078 / V107, user 2026-11-22 ASK_USER A82 option 1): a guard-signed endless segment whose predecessor
//   never reached the shards waited out CHAIN_WAIT_MS as 'chain-gap' and was rejected -- and so was every later segment of the run
//   (live 11-22: 54 runs / 240 segments waiting, all chain-gap; one player lost two evenings of couch casual XP and dropped from
//   level 7 to 1 when the client's optimistic XP ledger aged out). The signed lanes (solo + couch: the signature and the owner
//   binding are checked before the planner) now settle such a segment on its own once the wait ran out: the 5.0i truncated credit
//   (XP from its own start depth, the ladder at its end, pacing from the chain head); its successors then chain from its end.
//   Only adds (architecture decision 10): nothing settled before is recomputed, nothing is taken.
//   [0] wiring pins + tripwires: only the solo lane passes gapSettle (the consensus lanes stay as they are: no signature, a forged
//       mid-run segment would buy a depth), only a 'chain-gap' wait gaps (never 'save-orphan'), the window never exceeds
//       CHAIN_WAIT_MS, the summary row
//   [1] pure soloChainPlan: no opts = the old verdicts; with gapSettle: waits inside the window, settles past it (proven = head /
//       0), a missing save point still rejects, a casual / classic token resume past a gap settles and its tag still catches a
//       replay; ordering: a later segment never jumps an earlier one still open this run (waiting, or chained and deferred);
//       a rejected earlier one does not hold it; the COMP_GAP_SETTLE_MS lever (shorter works, longer is capped)
//   [2] main(): a casual solo run [0,5] settled, [5,10] never written, [10,15] (its start row lost too) + [15,20 FINAL] on the
//       shards -- after the wait: [10,15] settles on its own (XP 10->15, no missing-start signal), [15,20] waits for it in the
//       same run (the ordering guard) and chains after it; nothing rejected
//   [3] main(): a couch casual run whose FIRST segment never came (the V078 run 14721703 shape): [5,10] + [10,15] settle after the wait
//   [4] mutation self-checks: the solo lane without gapSettle -> [2] rejects everything (chain-gap); without the ordering guard ->
//       [15,20] jumps [10,15] and [10,15] is then a chain-back reject (lost)
// State isolation is structural (every *_FILE var redirected, cwd = temp dir), harness as test/couch-casual-settle.js.
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const SCRUB = ['PT_MODE', 'STRICT_BOARDS', 'APPLY_MMR', 'ALLOW_TEST', 'DEMO_APPID', 'RANKED_LB', 'LP_LB', 'XP_LB', 'STARTS_MATURITY_MS', 'CONFESS_PRUNE_MS',
  'SEEDCAP_ENFORCE', 'SEEDCAP_REJECT', 'GITHUB_STEP_SUMMARY', 'LEDGER_SHARDS', 'PT_SHARD_COUNT', 'ABSENT_GRACE_MS', 'READ_RETRY_MS', 'SANITY_MIN_START_AGE_MS', 'BOT_PACE_FRAC',
  'SHARD_STRICT_BODY', 'CP_LB', 'ENDLESS_LB', 'ENDLESS_LB_TRIO', 'ENDLESS_LB_QUAD', 'TRUST_LB', 'REPORT_LB', 'START_CONFIRM_MS', 'RESUME_TAG_REQUIRED',
  'ENDLESS_COMP_LB', 'ENDLESS_COMP_LB_DUO', 'ENDLESS_COMP_LB_COUCH', 'SAVE_BOX_LB_COUCH', 'ENDLESS_LB_SOLO', 'COMP_RUN_TTL_MS', 'SOLO_DONE_CAP', 'COUCH_DUO', 'COUCH_SIG_FLAG',
  'ENDLESS_LB_COUCH', 'SAVE_BOX_LB_CASUAL_COUCH', 'COMP_CHAIN_WAIT_MS', 'COMP_GAP_SETTLE_MS', 'ENDLESS_PACE_FRAC', 'SEASON_NOW'];
for (const k of SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const MIN = 60000, HOUR = 3600 * 1000, DAY = 86400000;
const W = v.COMP.CHAIN_WAIT_MS;
const G = Math.min(v.COMP.GAP_SETTLE_MS, W);   // the gap window this tree runs with (the cases below hold for any default <= W)
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

console.log('=== Q428: a signed endless segment whose predecessor never came settles on its own once the wait ran out ===');

// ---- [0] wiring pins + tripwires ----
{
  const pin = (label, s) => T('[0] ' + label, SRC.split(s).length === 2, 'not found exactly once: ' + s.slice(0, 140));
  T('[0] CHAIN_WAIT_MS 7 days, GAP_SETTLE_MS defaults to 1 day', W === 7 * DAY && v.COMP.GAP_SETTLE_MS === DAY, W + ' / ' + v.COMP.GAP_SETTLE_MS);
  pin('the solo lane (solo + couch: signature + owner binding checked above) passes gapSettle',
    'const plan = soloChainPlan(soloState, key, f, m, nowMs, { recovered: !!r.recovered, gapSettle: soloGapTick });');
  // tripwire: a consensus lane (team competitive / team classic / seat-only pass) must not gap-settle without its own decision --
  //   no signature: a forged mid-run segment of colluding writers would buy its depth on the ladder
  const calls = SRC.split('\n').filter((l) => /soloChainPlan\(/.test(l) && !/^\s*\/\//.test(l) && !/^function /.test(l));
  T('[0] exactly one soloChainPlan call passes gapSettle (the solo lane; a consensus lane needs its own decision, Q428)',
    calls.filter((l) => /gapSettle/.test(l)).length === 1 && SRC.split('gapSettle:').length === 2, calls.map((l) => l.trim().slice(0, 110)).join(' || '));
  pin('only a chain-gap wait settles past the gap (a missing save point never: one save, one resume)', "if (gs && reason === 'chain-gap' && nowMs - (w.t0 || 0) > gapMs) {");
  pin('the window never outlasts CHAIN_WAIT_MS (the wait clock is pruned a day after it)', 'gapMs = Math.min(COMP.GAP_SETTLE_MS, COMP.CHAIN_WAIT_MS);');
  pin('a gap-settled segment is no missing-start signal', 'if (!r.recovered && !plan.gap) sigPlayer(signals, p, nowMs).ns += 1;');
  pin('summary row', "'| solo / couch segments whose predecessor never came, settled on their own once the wait ran out (Q428: XP from their own start, nothing taken) | ' + s('soloGapSettled', 0) + ' |',");
}

// ---- [1] pure ----
const NOW = Date.UTC(2026, 10, 22, 12);
const gs = () => ({ seen: {} });
const seg = (sd, ed, flags, extra) => Object.assign({ startDepth: sd, endDepth: ed, flags: flags | 0, seasonId: 0 }, extra || {});
const P = (st, key, f, m, t, o) => v.soloChainPlan(st, key, f, m, t, Object.assign({ requireTag: false }, o || {}));
{
  const key = v.soloRunKey('p1', 0, 4242);
  // a: no opts = the old rule (team lanes, tests): waits, then rejects
  {
    const st = { runs: { [key]: { max: 35, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    const a0 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'ma', NOW), a1 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'ma', NOW + W + 1);
    T('[1a] without gapSettle: waits (chain-gap), then rejects (chain-gap) past CHAIN_WAIT_MS -- unchanged', a0.ok === null && a0.reason === 'chain-gap' && a1.ok === false && a1.reason === 'chain-gap', JSON.stringify([a0, a1]));
  }
  // b: gapSettle: waits inside the window, settles past it; proven = the chain head, 0 without one
  {
    const st = { runs: { [key]: { max: 35, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    const b0 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'mb', NOW, { gapSettle: gs() });
    const b1 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'mb', NOW + G, { gapSettle: gs() });
    const b2 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'mb', NOW + G + 1, { gapSettle: gs() });
    T('[1b] with gapSettle: waits (chain-gap) up to the window', b0.ok === null && b0.reason === 'chain-gap' && b1.ok === null, JSON.stringify([b0, b1]));
    T('[1b] past the window: settles on its own (gap, truncated, proven = head 35)', b2.ok === true && b2.gap === true && b2.truncated === true && b2.proven === 35, JSON.stringify(b2));
    const st2 = { runs: {}, wait: {}, held: {} }, k2 = v.soloRunKey('p2', 0, 77);
    P(st2, k2, seg(5, 10, A.SEG_CASUAL), 'm0', NOW, { gapSettle: gs() });
    const c = P(st2, k2, seg(5, 10, A.SEG_CASUAL), 'm0', NOW + W + 1, { gapSettle: gs() });
    T('[1b] no chain memory at all (the first segment never came): settles past the window, proven 0', c.ok === true && c.gap === true && c.proven === 0, JSON.stringify(c));
    v.soloAdvance(st2, k2, seg(5, 10, A.SEG_CASUAL), 'm0', c, NOW + W + 1);
    const d = P(st2, k2, seg(10, 15, A.SEG_CASUAL), 'm1', NOW + W + 1, { gapSettle: gs() });
    T('[1b] its successor then chains from its end (no gap, no wait)', d.ok === true && !d.gap && d.proven === 10 && !st2.wait.m0, JSON.stringify(d));
  }
  // c: a missing save point (competitive resume) still rejects -- one save, one resume
  {
    const st = { runs: { [key]: { max: 10, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    P(st, key, seg(10, 12, A.SEG_RESUMED), 'mc', NOW, { gapSettle: gs() });
    const c1 = P(st, key, seg(10, 12, A.SEG_RESUMED), 'mc', NOW + W + 1, { gapSettle: gs() });
    T('[1c] a resumed competitive segment with no save point: save-orphan reject past the window, never settled', c1.ok === false && c1.reason === 'save-orphan', JSON.stringify(c1));
  }
  // d: a casual token resume past a gap settles and records its tag; a replay of the same row is still caught
  {
    const st = { runs: { [key]: { max: 5, ms: 0, saves: {}, t: NOW, k: 1 } }, wait: {}, held: {} };
    const f = seg(10, 13, A.SEG_CASUAL | A.SEG_RESUMED, { resumeTag: 4321 });
    P(st, key, f, 'md', NOW, { gapSettle: gs() });
    const d1 = P(st, key, f, 'md', NOW + W + 1, { gapSettle: gs() });
    T('[1d] a casual token resume past a gap (checkpoint 10 never proven): settles on its own, its tag recorded', d1.ok === true && d1.gap === true && d1.proven === 5 && JSON.stringify(d1.rtags) === '[4321]', JSON.stringify(d1));
    v.soloAdvance(st, key, f, 'md', d1, NOW + W + 1);
    const d2 = P(st, key, seg(10, 14, A.SEG_CASUAL | A.SEG_RESUMED, { resumeTag: 4321 }), 'md2', NOW + W + 2, { gapSettle: gs() });
    T('[1d] a second session from the same row: save-reused, the run burnt (the replay rule holds past a gap)', d2.ok === false && d2.reason === 'save-reused' && st.runs[key].burnt === 1, JSON.stringify(d2));
    const st3 = { runs: {}, wait: {}, held: {} }, k3 = v.soloRunKey('p3', 0, 88);
    const fc = seg(7, 9, A.SEG_CLASSIC | A.SEG_RESUMED);
    P(st3, k3, fc, 'mk', NOW, { gapSettle: gs() });
    const e1 = P(st3, k3, fc, 'mk', NOW + W + 1, { gapSettle: gs() });
    T('[1d] a classic token resume past a gap: settles on its own (proven 0)', e1.ok === true && e1.gap === true && e1.proven === 0, JSON.stringify(e1));
    const cas7 = P({ runs: {}, wait: {}, held: {} }, k3, seg(7, 9, A.SEG_CASUAL | A.SEG_RESUMED), 'mx', NOW + W + 1, { gapSettle: gs() });
    T('[1d] a casual resume off a checkpoint still rejects at once (resume-not-checkpoint)', cas7.ok === false && cas7.reason === 'resume-not-checkpoint', JSON.stringify(cas7));
  }
  // e: ordering -- a later segment never jumps an earlier one still open this run
  {
    const st = { runs: { [key]: { max: 35, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    const fA = seg(40, 45, A.SEG_CASUAL), fB = seg(45, 50, A.SEG_CASUAL);
    P(st, key, fB, 'mB', NOW, { gapSettle: gs() });                  // B first seen at NOW
    const X = Math.floor(G / 2);
    P(st, key, fA, 'mA', NOW + X, { gapSettle: gs() });              // A (its predecessor) first seen half a window later (a late retry)
    const t1 = NOW + G + 1, g1 = gs();
    const a1 = P(st, key, fA, 'mA', t1, { gapSettle: g1 }), b1 = P(st, key, fB, 'mB', t1, { gapSettle: g1 });
    T('[1e] B waited out, A (lower) still inside its window: B keeps waiting (an earlier segment of this run is still open)', a1.ok === null && b1.ok === null && /still open/.test(b1.reason), JSON.stringify([a1, b1]));
    const t2 = NOW + X + G + 1, g2 = gs();
    const a2 = P(st, key, fA, 'mA', t2, { gapSettle: g2 });
    if (a2.ok) v.soloAdvance(st, key, fA, 'mA', a2, t2);
    const b2 = P(st, key, fB, 'mB', t2, { gapSettle: g2 });
    T('[1e] A waited out: A settles on its own, then B chains behind it in the same run (no gap)', a2.ok === true && a2.gap === true && b2.ok === true && !b2.gap && b2.proven === 45, JSON.stringify([a2, b2]));
  }
  // f: an earlier segment that chains but is deferred (pacing / one match at a time) holds a waited-out later one
  {
    const st = { runs: { [key]: { max: 40, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    const fA = seg(40, 45, A.SEG_CASUAL), fB = seg(50, 55, A.SEG_CASUAL);
    P(st, key, fB, 'mB', NOW, { gapSettle: gs() });
    const g1 = gs(), t1 = NOW + W + 1;
    const a1 = P(st, key, fA, 'mA', t1, { gapSettle: g1 }), b1 = P(st, key, fB, 'mB', t1, { gapSettle: g1 });   // A chains -- but the caller defers it (not advanced)
    T('[1f] A chains but is deferred this run: the waited-out B waits for it', a1.ok === true && !a1.gap && b1.ok === null && /still open/.test(b1.reason), JSON.stringify([a1, b1]));
    v.soloAdvance(st, key, fA, 'mA', a1, t1 + 5 * MIN);
    const g2 = gs(), t2 = t1 + 5 * MIN;
    const b2 = P(st, key, fB, 'mB', t2, { gapSettle: g2 });
    T('[1f] next run, A settled (head 45): B, still past a gap [45,50], settles on its own', b2.ok === true && b2.gap === true && b2.proven === 45, JSON.stringify(b2));
  }
  // g: a rejected earlier segment does not hold a later one
  {
    const st = { runs: { [key]: { max: 40, ms: 0, saves: {}, t: NOW } }, wait: {}, held: {} };
    const fX = seg(30, 35, A.SEG_CASUAL), fB = seg(45, 50, A.SEG_CASUAL);
    P(st, key, fB, 'mB', NOW, { gapSettle: gs() });
    const g1 = gs(), t1 = NOW + W + 1;
    const x1 = P(st, key, fX, 'mX', t1, { gapSettle: g1 }), b1 = P(st, key, fB, 'mB', t1, { gapSettle: g1 });
    T('[1g] an earlier segment behind the head (chain-back reject) does not hold the waited-out B', x1.ok === false && x1.reason === 'chain-back' && b1.ok === true && b1.gap === true, JSON.stringify([x1, b1]));
  }
  // h: a held segment of the run (key policy) still restarts the clock, gapSettle or not (R1-A5-07)
  {
    const st = { runs: { [key]: { max: 35, ms: 0, saves: {}, t: NOW } }, wait: { mH: { t0: NOW - W - DAY } }, held: { mK: { k: key, t0: NOW - HOUR, t: NOW } } };
    const h1 = P(st, key, seg(40, 45, A.SEG_CASUAL), 'mH', NOW, { gapSettle: gs() });
    T('[1h] a run with a held segment: the waited-out one keeps waiting, its clock restarted (no gap settle)', h1.ok === null && /held by the key policy/.test(h1.reason) && st.wait.mH.t0 === NOW, JSON.stringify(h1));
  }
  // i: the COMP_GAP_SETTLE_MS lever (a later decision on the window: one line in the workflow env)
  {
    const probe = (envMs) => {
      const code = "const v=require(process.argv[1]);const k='K';const st={runs:{K:{max:35,ms:0,saves:{},t:0}},wait:{},held:{}};const f={startDepth:40,endDepth:45,flags:" + A.SEG_CASUAL + ",seasonId:0};"
        + "const o=()=>({gapSettle:{seen:{}},requireTag:false});v.soloChainPlan(st,k,f,'m',0,o());const at=(t)=>{const s=JSON.parse(JSON.stringify(st));const p=v.soloChainPlan(s,k,f,'m',t,o());return p.ok===true?'settle':p.ok===false?'reject':'wait';};"
        + "console.log(JSON.stringify([v.COMP.GAP_SETTLE_MS,at(86400000),at(86400001),at(" + W + "),at(" + (W + 1) + ")]));";
      const env = Object.assign({}, process.env, { COMP_GAP_SETTLE_MS: String(envMs) });
      const r = spawnSync(process.execPath, ['-e', code, path.join(ROOT, 'validate.js')], { env, encoding: 'utf8', timeout: 60000 });
      try { return JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (e) { return [r.status, (r.stderr || '').slice(-300)]; }
    };
    const one = probe(DAY), long = probe(30 * DAY);
    T('[1i] COMP_GAP_SETTLE_MS = 1 day: waits up to one day, settles after it', JSON.stringify(one) === JSON.stringify([DAY, 'wait', 'settle', 'settle', 'settle']), JSON.stringify(one));
    T('[1i] COMP_GAP_SETTLE_MS past CHAIN_WAIT_MS: capped -- settles at the chain wait, never rejects', JSON.stringify(long) === JSON.stringify([30 * DAY, 'wait', 'wait', 'wait', 'settle']), JSON.stringify(long));
  }
}

// ---- main() harness (copied tree + one sealed test key; a stub Steam) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('7e'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
const KEY_ID = 2099112201;
function copyTree(tag, src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-gap-settle-' + tag + '-'));
  require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules']);
  const kf = path.join(dir, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };   // sealed, unlabeled: every channel
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  if (src != null) fs.writeFileSync(path.join(dir, 'validate.js'), src);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-gap-settle-run-'));
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
    const summary = fs.readFileSync(sumPath, 'utf8');
    const state = {};
    for (const k of FILE_VARS) { try { state[k] = JSON.parse(fs.readFileSync(stateEnv[k], 'utf8')); } catch (err) {} }
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), posts, state, summary };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
// move every first-sighting / wait clock in the carried state back by ms (= ms of real time passed between two runs)
function advance(state, ms) {
  const files = JSON.parse(JSON.stringify(state));
  const st = files.STARTS_FILE || {};
  for (const k of Object.keys(st)) { if (st[k] && st[k].t0) st[k].t0 -= ms; if (st[k] && st[k].absentAt) st[k].absentAt -= ms; if (k.charAt(0) === '~' && st[k] && st[k].r) st[k].r -= ms; }
  const sg = files.SIGNALS_FILE;
  if (sg && sg.players) for (const k of Object.keys(sg.players)) { if (sg.players[k].bz) sg.players[k].bz -= ms; if (sg.players[k].at) sg.players[k].at -= ms; }
  if (sg && sg.flagged) for (const k of Object.keys(sg.flagged)) sg.flagged[k] -= ms;
  const so = files.SOLO_FILE;
  if (so) {
    for (const k of Object.keys(so.runs || {})) { if (so.runs[k].t) so.runs[k].t -= ms; for (const d of Object.keys(so.runs[k].saves || {})) if (so.runs[k].saves[d].t) so.runs[k].saves[d].t -= ms; }
    for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
    for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
    for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
    for (const k of Object.keys(so.done || {})) if (Array.isArray(so.done[k])) so.done[k][1] -= Math.floor(ms / 1000);
  }
  return files;
}
const LB = { xp: 5, cp: 8, casSolo: 15, couchCas: 20 };
function world(recs) {
  const boards = [];
  for (let i = 0; i < 50; i++) boards.push({ id: 1000 + i, name: 'shard_' + i, entries: [] });
  const sids = new Set();
  for (const r of recs) { sids.add(r.sid); boards[r.shard].entries.push({ steamID: r.sid, score: 1, details: r.d }); }
  boards.push({ id: LB.xp, name: 'progress', entries: [] }, { id: LB.cp, name: 'cp_bank', entries: [...sids].map(s => ({ steamID: s, score: 1000 })) },
    { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] },
    { id: 11, name: 'endless_board', entries: [] }, { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] },
    { id: LB.casSolo, name: 'endless_board_solo', entries: [] }, { id: 16, name: 'endless_comp_duo', entries: [] }, { id: 17, name: 'endless_board_overall', entries: [] },
    { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] },
    { id: 18, name: 'endless_comp_couch', entries: [] }, { id: 19, name: 'endless_save_box_couch', entries: [] },
    { id: LB.couchCas, name: 'endless_board_couch', entries: [] }, { id: 21, name: 'endless_save_box_casual_couch', entries: [] });
  return boards;
}
// steps: [[ms since the previous run, recs], ...]
function timeline(tree, steps) {
  const out = []; let state = null;
  for (const [ms, recs] of steps) {
    const r = runCron(tree, world(recs), state ? advance(state, ms) : null);
    out.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return out;
}
const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const keyOf = (d) => d[3] + '_' + d[4] + '_' + d[2];
const start7 = (hash, sid, runSeed) => { const p = sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };
// a guard-signed solo segment (attest.js layout attVer 3, as test/solo-chain-keep.js)
function soloSeg(o) {
  const [lo, hi] = sidPair(o.sid);
  const b = [0xB1, 3, 7, A.hash32(o.id), o.runSeed, 0, 1, 0, 1, 300, o.score == null ? 1000 : o.score, o.disp | 0, lo, hi, o.sd, o.ed, 0, 0, 0, o.flags | 0,
    KEY_ID, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  const sig = crypto.sign(null, A.toBytes(b), PRIV);
  for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
  return b;
}
// a guard-signed casual couch segment of sid (attest.js A3 layout, as test/couch-casual-settle.js)
function couchSeg(sid, id, runSeed, o) {
  const n = o.n || 2;
  const d = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, n, 300];
  const seats = o.seats || [600, 400, 300, 200];
  for (let i = 0; i < n; i++) d.push(seats[i] | 0);
  d.push(o.disp | 0);
  for (let i = 0; i < n; i++) { const p = sidPair(sid); d.push(p[0], p[1]); }
  d.push(o.sd | 0, o.ed, 0, 0, 0, o.flags == null ? (A.SEG_CASUAL | A.SEG_COUCH) : o.flags, 0, 0, 0, 0, 0, 0);
  d.push(0xD8 | (1 << 8) | (n << 16), 1 | (2 << 8) | (3 << 16) | (4 << 24));
  d.push(0xE8 | (1 << 8) | (21 << 16), KEY_ID, 1, 0, 0x1234, 0x5678);
  const sig = crypto.sign(null, A.toBytes(d), PRIV);
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
const lines = (r, m, re) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0 && re.test(l)).length;
const sum = (rs, f) => rs.reduce((a, r) => a + f(r), 0);
const linesOf = (rs, m) => rs.map((r, i) => 'r' + i + ': ' + r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join(' | ')).join('\n').slice(0, 2500);
const procHas = (r, m) => (r.state.PROCESSED_FILE || []).indexOf(m) >= 0;
const brk = (rs, n, tag) => { if (rs.length === n && rs.every(r => r.code === 0)) return false; bad(tag + ': run ' + rs.length + ' exit ' + (rs[rs.length - 1] || {}).code + '\n' + ((rs[rs.length - 1] || {}).out || '').slice(-2500)); return true; };
const gapCount = (r) => { const x = /\| solo \/ couch segments whose predecessor never came[^|]*\| (\d+) \|/.exec(r.summary || ''); return x ? Number(x[1]) : -1; };
const nsOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)] || {}).ns | 0);

// [2] a casual solo run: [0,5] settles; [5,10] never written; [10,15] (its start row lost too) and [15,20 FINAL] wait; after the wait
//     [10,15] settles on its own (synthetic start: pacing defers it one run) and [15,20] waits for it, then chains
function caseSolo(tree, n) {
  const S = SID(4280 + n), RS = 428000 + n, F = A.SEG_CASUAL;
  const s0 = soloSeg({ sid: S, id: 'q428-s0-' + n, runSeed: RS, sd: 0, ed: 5, flags: F });
  const s2 = soloSeg({ sid: S, id: 'q428-s2-' + n, runSeed: RS, sd: 10, ed: 15, flags: F });
  const s3 = soloSeg({ sid: S, id: 'q428-s3-' + n, runSeed: RS, sd: 15, ed: 20, flags: F | A.SEG_FINAL });
  const pre = [{ sid: S, d: start7(s0[3], S, RS), shard: 0 }, { sid: S, d: s0, shard: 1 }];
  const late = pre.concat([{ sid: S, d: start7(s3[3], S, RS), shard: 3 }, { sid: S, d: s2, shard: 2 }, { sid: S, d: s3, shard: 4 }]);
  const rs = timeline(tree, [[0, pre], [2 * HOUR, pre], [HOUR, late], [W + HOUR, late], [HOUR, late], [HOUR, late]]);
  return { rs, S, m0: keyOf(s0), m2: keyOf(s2), m3: keyOf(s3) };
}
// [3] a couch casual run whose first segment never came: [5,10] and [10,15] wait, then both settle
function caseCouch(tree, n) {
  const S = SID(4290 + n), RS = 429000 + n;
  const c1 = couchSeg(S, 'q428-c1-' + n, RS, { sd: 5, ed: 10 }), c2 = couchSeg(S, 'q428-c2-' + n, RS, { sd: 10, ed: 15 });
  const recs = [{ sid: S, d: start7(c1[3], S, RS), shard: 0 }, { sid: S, d: start7(c2[3], S, RS), shard: 1 }, { sid: S, d: c1, shard: 2 }, { sid: S, d: c2, shard: 3 }];
  const rs = timeline(tree, [[0, recs], [HOUR, recs], [W + HOUR, recs], [HOUR, recs]]);
  return { rs, S, m1: keyOf(c1), m2: keyOf(c2) };
}

const TREE = copyTree('fix');
// ---- [2] ----
{
  const R = caseSolo(TREE, 0);
  if (!brk(R.rs, 6, '[2]')) {
    const rs = R.rs;
    T('[2] [0,5] settles before the gap', sum(rs.slice(0, 2), (r) => lines(r, R.m0, /solo settle /)) === 1);
    T('[2] inside the window [10,15] and [15,20] wait for their chain (chain-gap), nothing settles or rejects', lines(rs[2], R.m2, /waiting for its chain \(chain-gap\)/) === 1 &&
      lines(rs[2], R.m3, /waiting for its chain \(chain-gap\)/) === 1 && !/chain REJECT/.test(rs[2].out), linesOf(rs.slice(2, 3), R.m2));
    T('[2] past the window: [10,15] passes the chain on its own and its pacing (a synthetic start: seen this run) defers it; [15,20] waits for it (still open)',
      lines(rs[3], R.m2, /solo-pacing/) === 1 && lines(rs[3], R.m3, /still open/) === 1 && !/solo settle /.test(rs[3].out), linesOf([rs[3]], R.m2) + '\n' + linesOf([rs[3]], R.m3));
    T('[2] next run: [10,15] settles on its own (chain gap waited out, head 5), XP 10->15', lines(rs[4], R.m2, /solo settle .*chain gap waited out: settled on its own, head 5, Q428/) === 1 &&
      /xp-endless [^\n]* depth 10->15 \+/.test(rs[4].out) && procHas(rs[4], R.m2), linesOf([rs[4]], R.m2));
    T('[2] ... and [15,20] chains behind it in the same run (no gap mark), XP 15->20', lines(rs[4], R.m3, /solo settle /) === 1 && lines(rs[4], R.m3, /chain gap waited out/) === 0 &&
      /xp-endless [^\n]* depth 15->20 \+/.test(rs[4].out) && procHas(rs[4], R.m3), linesOf([rs[4]], R.m3));
    T('[2] summary counts one gap-settled segment; no reject anywhere; each segment settles once', gapCount(rs[4]) === 1 && sum(rs, (r) => (r.out.match(/chain REJECT/g) || []).length) === 0 &&
      sum(rs, (r) => lines(r, R.m2, /solo settle /)) === 1 && sum(rs, (r) => lines(r, R.m3, /solo settle /)) === 1, 'gap=' + gapCount(rs[4]));
    T('[2] the gap-settled segment without its start row is no missing-start signal', nsOf(rs[5], R.S) === 0, 'ns=' + nsOf(rs[5], R.S));
    T('[2] the casual solo row reaches depth 20', rs.some((r) => r.posts.some((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + LB.casSolo + '(&|$)').test(x.body))));
  }
}
// ---- [3] ----
{
  const R = caseCouch(TREE, 0);
  if (!brk(R.rs, 4, '[3]')) {
    const rs = R.rs;
    T('[3] couch: inside the window both wait (chain-gap, no chain memory)', lines(rs[1], R.m1, /waiting for its chain \(chain-gap\)/) === 1 && lines(rs[1], R.m2, /waiting for its chain \(chain-gap\)/) === 1);
    T('[3] couch: past the window [5,10] settles on its own (head 0), [10,15] chains after it in the same run', lines(rs[2], R.m1, /couch settle .*couch pc 2 casual.*chain gap waited out: settled on its own, head 0, Q428/) === 1 &&
      lines(rs[2], R.m2, /couch settle /) === 1 && lines(rs[2], R.m2, /chain gap waited out/) === 0 && /xp-endless [^\n]* depth 5->10 \+/.test(rs[2].out) && /xp-endless [^\n]* depth 10->15 \+/.test(rs[2].out),
      linesOf([rs[2]], R.m1) + '\n' + linesOf([rs[2]], R.m2));
    T('[3] couch: nothing rejected, the couch casual row written, summary 1', sum(rs, (r) => (r.out.match(/chain REJECT/g) || []).length) === 0 && gapCount(rs[2]) === 1 &&
      rs[2].posts.some((x) => /SetLeaderboardScore/.test(x.url) && new RegExp('leaderboardid=' + LB.couchCas + '(&|$)').test(x.body)));
  }
}
// ---- [4] mutation self-checks ----
{
  const callFix = 'const plan = soloChainPlan(soloState, key, f, m, nowMs, { recovered: !!r.recovered, gapSettle: soloGapTick });';
  const callOld = 'const plan = soloChainPlan(soloState, key, f, m, nowMs, { recovered: !!r.recovered });';
  const guardFix = "      if (soloGapBehind(gs, key, run, f.startDepth | 0)) return { ok: null, reason: reason + ' (an earlier segment of this run is still open)' };\n";
  if (SRC.split(callFix).length !== 2 || SRC.split(guardFix).length !== 2) bad('[4] the fix lines were not found -- the mutants cannot be built');
  else {
    const M1 = copyTree('mut-call', SRC.replace(callFix, callOld));
    const R1 = caseSolo(M1, 1);
    T('[4] mutant (the solo lane without gapSettle): [10,15] and [15,20] are chain-gap REJECTED past the window, nothing settles',
      R1.rs.length === 6 && sum(R1.rs, (r) => lines(r, R1.m2, /chain REJECT \(chain-gap\)/)) === 1 && sum(R1.rs, (r) => lines(r, R1.m3, /chain REJECT \(chain-gap\)/)) === 1 &&
      sum(R1.rs, (r) => lines(r, R1.m2, /solo settle /) + lines(r, R1.m3, /solo settle /)) === 0, linesOf(R1.rs, R1.m2));
    const M2 = copyTree('mut-guard', SRC.replace(guardFix, ''));
    const R2 = caseSolo(M2, 2);
    T('[4] mutant (no ordering guard): [15,20] jumps the deferred [10,15], which is then REJECTED (after-final: [15,20] closed the run; its five levels lost)',
      R2.rs.length === 6 && sum(R2.rs, (r) => lines(r, R2.m3, /chain gap waited out/)) === 1 && sum(R2.rs, (r) => lines(r, R2.m2, /chain REJECT \((after-final|chain-back)\)/)) === 1 &&
      sum(R2.rs, (r) => lines(r, R2.m2, /solo settle /)) === 0, linesOf(R2.rs, R2.m2) + '\n' + linesOf(R2.rs, R2.m3));
    for (const d of [M1, M2]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (err) {} }
  }
}
try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (err) {}
if (failN) { console.log('\n' + failN + ' FAILED'); process.exit(1); }
console.log('\nall passed');
