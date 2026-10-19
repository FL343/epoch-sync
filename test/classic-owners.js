'use strict';
// Classic loyalty crate lane (classic.js + validate.js processClassicOwners; companion knife 5.3 O81):
//   [1] ownership predicate (ownership.js): one vector set, the same function behind grants.js and the classic lane
//   [2] probe plan: this run's writers first (a known non-owner re-checked after 30 min, an owner after a day), then
//       players never looked at, then the stalest daily re-checks; capped
//   [3] state: own resets the strike count; two definite "not owned" in a row clear ownership; unknown changes nothing
//   [4] mask plan: only bit CLASSIC.BIT moves; word 0 (permanent bits) and the rest of word 1 stay as they are
//   [5] end to end over the REAL validate.js main() (offline board stub, quiet tick = the early-exit path):
//       owner gets bit 32 with his permanent bits kept; second "not owned" clears it; an error answer changes nothing;
//       an owner not on the grant box yet gets a fresh row; v4 endpoint; state is pid keyed (no raw ids);
//       PT_MODE and an unset CLASSIC_APPID never call the ownership endpoint
//   [6] wiring pins: runs last on every path; workflow carries the secret and persists classic.json
//   [7] mutation self-check: a maskPlan that rebuilds word 0 from zero -> [5] goes red
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const own = require(path.join(ROOT, 'ownership.js'));
const cl = require(path.join(ROOT, 'classic.js'));
const grants = require(path.join(ROOT, 'grants.js'));
const { CLASSIC, probeResult, checkPlan, applyProbe, maskPlan } = cl;

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

const A = '76561198000000001', B = '76561198000000002', C = '76561198000000003', D = '76561198000000004', E = '76561198000000005';
const lic = (sid, o) => ({ appownership: Object.assign({ ownsapp: true, permanent: true, timestamp: '2024-05-01T10:00:00Z', ownersteamid: sid, sitelicense: false, usercanceled: false }, o || {}) });

console.log('=== classic-owners [1] ownership predicate (shared) ===');
T('grants.js uses the shared predicate (same function object)', grants.ownLicenseMs === own.ownLicenseMs);
const VEC = [
  ['personal permanent license', lic(A), true],
  ['family sharing (lender is the owner)', lic(A, { ownersteamid: B }), false],
  ['free weekend (not permanent)', lic(A, { permanent: false }), false],
  ['site license', lic(A, { sitelicense: true }), false],
  ['cancelled by the user', lic(A, { usercanceled: true }), false],
  ['does not own', lic(A, { ownsapp: false, permanent: false }), false],
];
for (const [label, j, want] of VEC) {
  T(label + ': ownsStrict ' + want + ' / probeResult ' + (want ? 'own' : 'not') + ' / ownLicenseMs ' + (want ? 'ms' : 'null'),
    own.ownsStrict(j, A) === want && probeResult(j, A) === (want ? 'own' : 'not') && (own.ownLicenseMs(j, A) != null) === want);
}
T('no definite answer (empty / malformed / missing ownsapp) -> probeResult null', [null, {}, { appownership: {} }, { appownership: { ownsapp: 'yes' } }].every(j => probeResult(j, A) === null));
T('ownLicenseMs keeps its old contract: owned but unparsable timestamp -> null', own.ownLicenseMs(lic(A, { timestamp: 'x' }), A) === null && own.ownsStrict(lic(A, { timestamp: 'x' }), A) === true);

console.log('=== classic-owners [2] probe plan ===');
const pidOf = (s) => 'p' + s.slice(-4);
const now = 1_800_000_000_000, MIN = 60000, nowMin = Math.floor(now / MIN);
T('constants: bit 32, daily re-check, writer re-check 30 min, two strikes, caps 150 / 200',
  CLASSIC.BIT === 32 && CLASSIC.RECHECK_MS === 864e5 && CLASSIC.RECHECK_WRITER_MS === 18e5 && CLASSIC.CLEAR_AFTER === 2 && CLASSIC.MAX_CHECKS_PER_RUN === 150 && CLASSIC.MAX_WRITES_PER_RUN === 200);
{
  const st = {};
  st[pidOf(A)] = { o: 0, c: nowMin - 40, n: 1 };     // known non-owner, 40 min ago, writes this run -> re-checked first
  st[pidOf(B)] = { o: 1, c: nowMin - 40, n: 0 };     // owner, 40 min ago, writes this run -> not yet (owners: daily)
  st[pidOf(C)] = { o: 0, c: nowMin - 25 * 60, n: 0 }; // non-owner, 25 h ago, not a writer -> stale
  st[pidOf(D)] = { o: 1, c: nowMin - 26 * 60, n: 0 }; // owner, 26 h ago -> stale, staler than C
  const p = checkPlan(st, [A, B, C, D, E, 'bad'], [A, B], pidOf, now);
  T('writers first (A), then never looked at (E), then stalest re-checks (D before C); fresh owner B waits; bad ids dropped', JSON.stringify(p) === JSON.stringify([A, E, D, C]), JSON.stringify(p));
  const st2 = {}; st2[pidOf(A)] = { o: 0, c: nowMin - 10, n: 0 };
  T('a writer checked 10 min ago is not re-probed', checkPlan(st2, [A], [A], pidOf, now).length === 0);
  const many = []; for (let i = 0; i < 400; i++) many.push('7656119800010' + String(1000 + i));
  T('per-run cap', checkPlan({}, many, [], pidOf, now).length === CLASSIC.MAX_CHECKS_PER_RUN && checkPlan({}, many, [], pidOf, now, 7).length === 7);
}

console.log('=== classic-owners [3] state ===');
{
  const st = {};
  applyProbe(st, 'p', 'own', now);
  T('own -> o=1 n=0 c=now', st.p.o === 1 && st.p.n === 0 && st.p.c === nowMin);
  applyProbe(st, 'p', 'not', now + MIN);
  T('one "not owned" keeps ownership (one odd answer never flickers the crate)', st.p.o === 1 && st.p.n === 1);
  applyProbe(st, 'p', null, now + 2 * MIN);
  T('unknown answer: ownership and strike count unchanged, check time moves (retried tomorrow, not every tick)', st.p.o === 1 && st.p.n === 1 && st.p.c === nowMin + 2);
  applyProbe(st, 'p', 'not', now + 3 * MIN);
  T('second "not owned" in a row clears ownership', st.p.o === 0 && st.p.n === 2);
  applyProbe(st, 'p', 'own', now + 4 * MIN);
  T('buying it back: owner again, strikes reset', st.p.o === 1 && st.p.n === 0);
}

console.log('=== classic-owners [4] mask plan ===');
{
  const W0 = (1 << 7) | (1 << 3) | (1 << 0);
  T('owner without the bit -> word 0 kept, bit 32 set', JSON.stringify(maskPlan([W0, 0], true)) === JSON.stringify([W0, 1]));
  T('owner with the bit -> nothing to write', maskPlan([W0, 1], true) === null);
  T('non-owner with the bit -> cleared, word 0 kept, other word-1 bits kept', JSON.stringify(maskPlan([W0, 1 | (1 << 5)], false)) === JSON.stringify([W0, 1 << 5]));
  T('non-owner without the bit -> nothing to write', maskPlan([W0, 0], false) === null);
  T('word 0 with the sign bit set survives (int32)', maskPlan([0x80000001 | 0, 0], true)[0] === (0x80000001 | 0));
}

console.log('=== classic-owners [5] end to end (real validate.js main, offline stub) ===');
const STUB = [
  "const fs = require('fs');",
  "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
  'const byId = {}; for (const b of FX.boards) byId[String(b.id)] = b;',
  'let nextId = 90000;',
  'const resp = (o, st) => { const t = JSON.stringify(o); return { ok: (st || 200) < 400, status: st || 200, text: async () => t, json: async () => o }; };',
  'global.fetch = async (url, init) => {',
  '  const u = String(url);',
  "  if (init && init.method === 'POST') {",
  "    fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u, body: String(init.body || '') }) + '\\n');",
  '    if (/FindOrCreateLeaderboard/.test(u)) { const id = nextId++; return resp({ result: { result: 1, leaderboard: { leaderBoardID: id, leaderboardid: id } } }); }',
  '    return resp({ result: { result: 1 } });',
  '  }',
  "  if (/CheckAppOwnership/.test(u)) { fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ url: u.replace(/key=[^&]*/, 'key=K') }) + '\\n'); const sid = /steamid=([0-9]+)/.exec(u)[1]; const a = FX.own[sid]; if (a === 'err') return resp({}, 500); return resp(a || { appownership: { ownsapp: false, permanent: false, ownersteamid: '0' } }); }",
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
const SALT = 's';
const pidReal = (s) => require('crypto').createHmac('sha256', SALT).update(String(s)).digest('hex').slice(0, 16);
function runCron(fx, stateObj, env, script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-owners-'));
  try {
    fs.writeFileSync(path.join(dir, 'stub.js'), STUB);
    const fxPath = path.join(dir, 'fx.json');
    fs.writeFileSync(fxPath, JSON.stringify({ own: fx.own, boards: fx.boards.map(b => ({ id: b.id, name: b.name, entries: (b.entries || []).map(e => ({ steamID: e.steamID, score: e.score | 0, detailData: hexLE(e.details || []) })) })) }));
    const logPath = path.join(dir, 'post.log'); fs.writeFileSync(logPath, '');
    if (stateObj) fs.writeFileSync(path.join(dir, 'classic.json'), JSON.stringify(stateObj));
    const base = Object.assign({}, process.env);
    for (const k of Object.keys(base)) if (/^(PT_MODE|STRICT_BOARDS|APPLY_MMR|DEMO_APPID|CLASSIC_APPID|SUPPORTER_DLC_APPID|RANKED_LB|LP_LB|XP_LB|LEDGER_SHARDS|GITHUB_STEP_SUMMARY|[A-Z0-9_]+_FILE)$/.test(k)) delete base[k];
    const e = Object.assign(base, {
      STEAM_PUBLISHER_KEY: 'k', APPID: '1', LB_PREFIX: 'shard_', RANKED_LB: 'rating', LP_LB: 'points', XP_LB: 'progress', STATE_SALT: SALT, SEASON_NOW: '2026-10-01T00:00:00Z',
      STUB_FIXTURE: fxPath, STUB_LOG: logPath, CONCURRENCY: '1', STRICT_BOARDS: '0', LEDGER_SHARDS: '2', READ_RETRY_MS: '0',
    }, env || {});
    const r = spawnSync(process.execPath, ['-r', path.join(dir, 'stub.js'), script || path.join(ROOT, 'validate.js')], { env: e, encoding: 'utf8', cwd: dir, timeout: 120000 });
    const log = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const st = fs.existsSync(path.join(dir, 'classic.json')) ? fs.readFileSync(path.join(dir, 'classic.json'), 'utf8') : null;
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), log, state: st };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) {} }
}
const GRANT_ID = 70;
const gmask = (w0, w1) => [(0xCF | (1 << 8)), 1000, w0 | 0, w1 | 0];
const FX = {
  own: { [A]: lic(A), [B]: lic(B, { ownsapp: false, permanent: false }), [C]: 'err', [D]: lic(D) },
  boards: [
    { id: 1000, name: 'shard_0', entries: [] }, { id: 1001, name: 'shard_1', entries: [] },
    { id: 5, name: 'progress', entries: [A, B, C, D].map((s, i) => ({ steamID: s, score: 1000 + i })) },
    { id: 8, name: 'cp_bank', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 9, name: 'points', entries: [] },
    { id: GRANT_ID, name: 'grant_box', entries: [
      { steamID: A, score: 2, details: gmask((1 << 7) | (1 << 3), 0) },   // supporter + a redeemed item, no classic yet
      { steamID: B, score: 1, details: gmask(0, 1) },                      // had classic, refunded (one strike already)
      { steamID: C, score: 2, details: gmask(1 << 0, 1) },                 // has classic; the probe errors this run
    ] },
  ],
};
const ST0 = { [pidReal(B)]: { o: 1, c: 0, n: 1 }, [pidReal(C)]: { o: 1, c: 0, n: 0 } };
const decodePosted = (body) => {
  const m = /details=([%0-9a-f]+)/i.exec(body); if (!m) return null;
  const bytes = m[1].split('%').filter(Boolean).map(h => parseInt(h, 16));
  const out = []; for (let i = 0; i + 3 < bytes.length; i += 4) out.push((bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) | 0);
  return out;
};
function grantWrites(log) {
  const w = {};
  for (const l of log) if (l.body && /SetLeaderboardScore/.test(l.url) && new RegExp('leaderboardid=' + GRANT_ID + '(&|$)').test(l.body)) w[/steamid=([0-9]+)/.exec(l.body)[1]] = decodePosted(l.body);
  return w;
}
{
  const r = runCron(FX, ST0, { CLASSIC_APPID: '3777060' });
  const w = grantWrites(r.log);
  const probes = r.log.filter(l => l.url && /CheckAppOwnership/.test(l.url));
  T('the run finished (exit 0)', r.code === 0, r.out.slice(-400));
  const probed = new Set(probes.map(p => /steamid=([0-9]+)/.exec(p.url)[1]));
  T('ownership asked through CheckAppOwnership v4 with the classic appid, for each known player (the erroring one may be retried by getJson)', probed.size === 4 && probes.every(p => /\/CheckAppOwnership\/v4\//.test(p.url) && /appid=3777060/.test(p.url)), JSON.stringify(probes.map(p => p.url)).slice(0, 300));
  T('A (owner, no bit) -> bit 32 set, permanent bits 7 and 3 kept', w[A] && w[A][2] === ((1 << 7) | (1 << 3)) && w[A][3] === 1, JSON.stringify(w[A]));
  T('B (second "not owned" in a row) -> bit 32 cleared', w[B] && w[B][2] === 0 && w[B][3] === 0, JSON.stringify(w[B]));
  T('C (probe error) -> nothing written', !w[C]);
  T('D (owner, no grant row yet) -> fresh row with only bit 32', w[D] && w[D][2] === 0 && w[D][3] === 1 && (w[D][0] & 0xff) === 0xCF, JSON.stringify(w[D]));
  const st = r.state ? JSON.parse(r.state) : {};
  T('state is pid keyed (no raw SteamID anywhere in classic.json)', !!r.state && !/7656119/.test(r.state) && st[pidReal(A)] && st[pidReal(A)].o === 1 && st[pidReal(B)].o === 0 && st[pidReal(C)].o === 1);
  T('summary line printed', /classic: owners \d+ \(probed 4, unknown 1\) bit \+2 -1/.test(r.out), (r.out.match(/classic:[^\n]*/) || [''])[0]);
  const r2 = runCron(FX, ST0, { CLASSIC_APPID: '3777060', PT_MODE: '1' });
  T('PT_MODE: the lane never asks Steam about the classic license', !r2.log.some(l => l.url && /CheckAppOwnership/.test(l.url)));
  const r3 = runCron(FX, ST0, {});
  T('CLASSIC_APPID unset: lane off, no probe, no classic write', !r3.log.some(l => l.url && /CheckAppOwnership/.test(l.url)) && !grantWrites(r3.log)[D] && /CLASSIC_APPID unset -> lane off/.test(r3.out));
  const r4 = runCron(FX, ST0, { CLASSIC_APPID: '3777060', APPLY_MMR: '0' });
  T('dry run (APPLY_MMR=0): probes but writes nothing to the grant box', Object.keys(grantWrites(r4.log)).length === 0 && /would set bit 32/.test(r4.out));
}

console.log('=== classic-owners [6] wiring pins ===');
{
  const vjs = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate.yml'), 'utf8');
  T('both early exits run the lane after the supporter lane', (vjs.match(/await processSupporters\(null, \[\]\); await processClassicOwners\(null, \[\]\); writeRunSummary\(\); return; \}/g) || []).length === 2);
  T('main path: the lane runs after the redeem / campaign grant lanes (last grant-box writer)', /await processRedeems\(cp\);\s*await processCampaignGrants\(\); await processCampaignEndless\(\);\s*await processClassicOwners\(xp, spSids\);/.test(vjs));
  T('every other grant-box lane records its writes in grantSeen (the classic lane ORs word 0 from it)', (vjs.match(/grantSeen\[[^\]]+\] = newMask/g) || []).length === 4);
  T('validate.yml passes the secret CLASSIC_APPID and persists classic.json', /CLASSIC_APPID: \$\{\{ secrets\.CLASSIC_APPID \}\}/.test(wf) && /for f in [^\n]*\bclassic\.json\b/.test(wf));
}

console.log('=== classic-owners [7] mutation self-check ===');
{
  const src = fs.readFileSync(path.join(ROOT, 'classic.js'), 'utf8');
  const mut = src.replace("const m = g.slice();", "const m = [0, g[1]];").replace("if (m[0] !== g[0]) throw new Error('classic maskPlan touched the permanent word');", '');
  if (mut === src) bad('mutation point not found (classic.js maskPlan changed? update this test)');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classic-mut-'));
    try {
      require('./root-listing').copyRootTree(ROOT, dir, ['.git', 'test', 'node_modules', 'classic.js']);
      fs.writeFileSync(path.join(dir, 'classic.js'), mut);
      const rm = runCron(FX, ST0, { CLASSIC_APPID: '3777060' }, path.join(dir, 'validate.js'));
      const wm = grantWrites(rm.log);
      T('a maskPlan that rebuilds word 0 from zero drops A\'s permanent bits ([5] catches it)', wm[A] && wm[A][2] === 0);
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }
}

console.log('');
if (failN) { console.log('[classic-owners] ' + failN + ' FAIL'); process.exit(1); }
console.log('[classic-owners] all green');
