'use strict';
// One-shot pool recovery (validate.loadRecover / recoverPick, client knife 5.0i).
//   A) recoverPick keeps ONLY: solo endless settle records signed by a listed sealed key whose pool row owner is the run's
//      seat 0, plus the start attestations of exactly those matches written by seat 0. Dev keys, unlisted sealed keys,
//      foreign owners, multi-seat rows, other match types and orphan starts are all dropped.
//   B) loadRecover: channel binding, expiry, test-board-only names, key format, missing file -> inert.
//   C) the committed recover-shards.json: bounded date, test boards only, every key registered + sealed.
//   D) wiring: the demo reconcile and the seedcap twin both read the pools; a recovered segment without its start row
//      does not count as a missing-start signal.
//   node test/recover-shards.js
process.env.STATE_SALT = process.env.STATE_SALT || 'test-salt';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const V = require(path.join(__dirname, '..', 'validate.js'));
const A = require(path.join(__dirname, '..', 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };

// ---- signed solo record builder (same layout as test/attest.js) ----
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function keypair(seedHex) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seedHex, 'hex')]), format: 'der', type: 'pkcs8' });
  const pub = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
  return { priv, pub };
}
const lohi = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
function base(m) {
  const [lo, hi] = lohi(m.steamId);
  return [0xB1, 3, m.mt == null ? 7 : m.mt, A.hash32(m.matchId), m.runSeed | 0, 0, 1, 0, m.pc == null ? 1 : m.pc,
    m.dur | 0, m.score | 0, m.disp | 0, lo, hi, m.sd | 0, m.ed | 0, 0, 0, 0, 0,
    m.keyId | 0, 3, 0, 0, 0];
}
function sign(b, priv) {
  const sig = crypto.sign(null, A.toBytes(b), priv);
  const d = b.slice();
  for (let i = 0; i < 16; i++) d.push(sig.readInt32LE(i * 4));
  return d;
}
function start(m) { const d = base(m); d[0] = V.START_MAGIC; d[9] = 0; d[10] = 0; d[11] = 0; return d; }

const kAllowed = keypair('a'.repeat(64)), kUnlisted = keypair('b'.repeat(64)), kDev = keypair('c'.repeat(64));
const TABLE = {
  '2026100101': { pubs: [kAllowed.pub], sealed: true },
  '2026093001': { pubs: [kUnlisted.pub], sealed: true },
  dev: { pubs: [kDev.pub], sealed: false },
};
const CFG = { channel: 'demo', until: Date.parse('2026-10-14T00:00:00Z'), boards: ['lbtest_pool', 'lbtest_pool_b'], keys: new Set(['2026100101']) };
const P1 = '76561198000000001', P2 = '76561198000000002', P3 = '76561198000000003', P4 = '76561198000000004';

console.log('-- A) recoverPick filter --');
{
  const good = { matchId: 'm-good', runSeed: 11, steamId: P1, score: 1200, dur: 300, sd: 0, ed: 3, keyId: 2026100101 };
  const rows = [
    { steamID: P1, board: 'lbtest_pool', d: sign(base(good), kAllowed.priv) },                                                          // kept
    { steamID: P2, board: 'lbtest_pool', d: sign(base({ matchId: 'm-dev', runSeed: 12, steamId: P2, ed: 2, keyId: 0 }), kDev.priv) },    // dev key
    { steamID: P3, board: 'lbtest_pool', d: sign(base({ matchId: 'm-old', runSeed: 13, steamId: P3, ed: 2, keyId: 2026093001 }), kUnlisted.priv) },   // unlisted key
    { steamID: P4, board: 'lbtest_pool', d: sign(base({ matchId: 'm-foreign', runSeed: 14, steamId: P1, ed: 2, keyId: 2026100101 }), kAllowed.priv) },   // row owner != seat 0
    { steamID: P2, board: 'lbtest_pool_b', d: sign(base({ matchId: 'm-duo', runSeed: 15, steamId: P2, ed: 2, keyId: 2026100101, pc: 2 }), kAllowed.priv) },   // two seats
    { steamID: P3, board: 'lbtest_pool_b', d: sign(base({ matchId: 'm-quick', runSeed: 16, steamId: P3, ed: 2, keyId: 2026100101, mt: 1 }), kAllowed.priv) },   // not endless
    { steamID: P1, board: 'lbtest_pool_b', d: start(good) },                                                                             // start of the kept match -> kept
    { steamID: P2, board: 'lbtest_pool_b', d: start({ matchId: 'm-dev', runSeed: 12, steamId: P2 }) },                                   // start without a kept settle
    { steamID: P4, board: 'lbtest_pool_b', d: start({ matchId: 'm-good', runSeed: 11, steamId: P1 }) },                                  // start of the kept match, foreign owner
    { steamID: P1, board: 'lbtest_pool', d: [] },                                                                                         // garbage row
  ];
  const got = V.recoverPick(rows, CFG, TABLE);
  T('exactly one settle record kept', got.recs.length === 1, String(got.recs.length));
  const r = got.recs[0] || {};
  T('kept record = the listed-key / owner-bound segment', r.steamID === P1 && r.d && r.d[3] === A.hash32('m-good'));
  T('kept record is tagged recovered + carries the pool name', r.recovered === true && r.shard === 'r:lbtest_pool');
  T('kept record roster seat 0 = owner', r.roster && r.roster[0] === P1);
  T('kept record disp decoded (finished)', r.dispCode === 0 && r.disp === V.dispName(0));
  T('exactly one start kept (same match, seat-0 owner)', got.starts.length === 1 && got.starts[0].steamID === P1 && got.starts[0].start === true && got.starts[0].recovered === true);
  // the kept record still passes the settle lane's own gate (owner binding + sealed key)
  const cv = A.verifySoloRecord(r.d, TABLE);
  T('kept record verifies + settles through soloSettleGate', cv.ok && A.soloSettleGate(cv, { owner: P1, allowDevKey: false }).settle);
  // empty / null inputs
  const none = V.recoverPick(null, CFG, TABLE);
  T('null rows -> empty', none.recs.length === 0 && none.starts.length === 0);
}

console.log('-- B) loadRecover --');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-'));
  const w = (name, obj) => { const f = path.join(dir, name); fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
  const now = Date.parse('2026-10-07T00:00:00Z');
  const goodF = w('good.json', { channel: 'demo', until: '2026-10-14T00:00:00Z', boards: ['lbtest_pool', 'lbtest_pool_b', 'lbtest_pool_c'], keys: ['2026100101', '2026100401'] });
  const c = V.loadRecover(goodF, 'demo', now);
  T('valid file -> cfg (3 boards, 2 keys)', c && c.boards.length === 3 && c.keys.size === 2 && c.keys.has('2026100401'));
  T('other channel -> inert', V.loadRecover(goodF, 'playtest', now) === null);
  T('no channel -> inert', V.loadRecover(goodF, '', now) === null);
  T('past until -> inert', V.loadRecover(goodF, 'demo', Date.parse('2026-10-14T00:00:01Z')) === null);
  T('missing file -> inert', V.loadRecover(path.join(dir, 'nope.json'), 'demo', now) === null);
  T('unparseable file -> inert', V.loadRecover(w('junk.json', '{not json'), 'demo', now) === null);
  const liveOnly = w('live.json', { channel: 'demo', until: '2026-10-14T00:00:00Z', boards: ['lb_rec_0', 'wallet'], keys: ['2026100101'] });
  T('only non-test board names -> inert (never reads a live board)', V.loadRecover(liveOnly, 'demo', now) === null);
  const mixed = V.loadRecover(w('mixed.json', { channel: 'demo', until: '2026-10-14T00:00:00Z', boards: ['lb_rec_0', 'lbtest_pool'], keys: ['2026100101'] }), 'demo', now);
  T('live names dropped from a mixed list', mixed && mixed.boards.length === 1 && mixed.boards[0] === 'lbtest_pool');
  T('malformed keys -> inert', V.loadRecover(w('keys.json', { channel: 'demo', until: '2026-10-14T00:00:00Z', boards: ['lbtest_pool'], keys: ['dev', '123'] }), 'demo', now) === null);
  T('no until -> inert', V.loadRecover(w('nountil.json', { channel: 'demo', boards: ['lbtest_pool'], keys: ['2026100101'] }), 'demo', now) === null);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('-- C) committed recover-shards.json --');
{
  const file = path.join(__dirname, '..', 'recover-shards.json');
  if (!fs.existsSync(file)) ok('no committed recovery file (recovery retired)');
  else {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'attest-keys.json'), 'utf8')).keys || {};
    const until = Date.parse(j.until);
    T('channel is a trial channel', j.channel === 'demo' || j.channel === 'playtest', j.channel);
    T('until parses', until > 0, j.until);
    T('every board is a test board', Array.isArray(j.boards) && j.boards.length > 0 && j.boards.every(V.isTestBoardName), JSON.stringify(j.boards));
    T('every key registered + sealed', Array.isArray(j.keys) && j.keys.length > 0 && j.keys.every(k => keys[k] && keys[k].sealed === true), JSON.stringify(j.keys));
    const newest = Math.max(...j.keys.map(k => Date.parse((keys[k] || {}).at || 0) || 0));
    T('window bounded: until <= newest listed key + 21 days', until - newest <= 21 * 864e5, j.until);
    T('loads for its channel before until', !!V.loadRecover(file, j.channel, until - 1));
  }
}

console.log('-- D) wiring --');
{
  const vSrc = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  const sSrc = fs.readFileSync(path.join(__dirname, '..', 'seedcap.js'), 'utf8');
  T('reconcile reads the pools only on the demo app', /APPID === DEMO_APPID\) \? loadRecover\(RECOVER_FILE, 'demo', Date\.now\(\)\)/.test(vSrc));
  T('reconcile pushes recovered segments + starts into the normal pipeline', /for \(const r of fresh\) recs\.push\(r\);/.test(vSrc) && /for \(const s of got\.starts\) starts\.push\(s\);/.test(vSrc));
  T('seedcap twin reads the same filtered set', /v\.loadRecover\(v\.RECOVER_FILE, SEEDCAP_CHANNEL, Date\.now\(\)\)/.test(sSrc) && /v\.recoverPick\(rows, rc,/.test(sSrc));
  T('recovered segment without a start row is not a missing-start signal', /if \(!r\.recovered\) sigPlayer\(signals, p, nowMs\)\.ns \+= 1;/.test(vSrc));
}

console.log('-- E) truncated chain (recovered rows only) --');
{
  const now = Date.parse('2026-10-07T00:00:00Z');
  const fresh = () => ({ runs: {}, wait: {}, ms: {} });
  const seg = (sd, ed, flags) => ({ startDepth: sd, endDepth: ed, flags: flags | 0 });
  let p = V.soloChainPlan(fresh(), 'k', seg(10, 15), 'm1', now);
  T('live row, no chain memory -> waits (unchanged)', p.ok === null && p.reason === 'chain-gap');
  p = V.soloChainPlan(fresh(), 'k', seg(10, 15), 'm1', now, { recovered: true });
  T('recovered row, no chain memory -> settles from its own start (head 0)', p.ok === true && p.truncated === true && p.proven === 0);
  const st = fresh(); st.runs.k = { max: 5, ms: 0, saves: {} };
  p = V.soloChainPlan(st, 'k', seg(10, 15), 'm2', now, { recovered: true });
  T('recovered row ahead of the head -> settles, head kept as proven', p.ok === true && p.truncated === true && p.proven === 5);
  p = V.soloChainPlan(st, 'k', seg(10, 15), 'm3', now);
  T('live row ahead of the head -> waits (unchanged)', p.ok === null);
  const st2 = fresh(); st2.runs.k = { max: 10, ms: 0, saves: {} };
  p = V.soloChainPlan(st2, 'k', seg(10, 15), 'm4', now, { recovered: true });
  T('recovered row on the head -> normal chain verdict (not truncated)', p.ok === true && !p.truncated && p.proven === 10);
  const st3 = fresh(); st3.runs.k = { max: 20, ms: 0, saves: {} };
  p = V.soloChainPlan(st3, 'k', seg(10, 15), 'm5', now, { recovered: true });
  T('recovered row behind the head -> chain-back reject (unchanged)', p.ok === false && p.reason === 'chain-back');
  p = V.soloChainPlan(fresh(), 'k', seg(10, 15, A.SEG_RESUMED), 'm6', now, { recovered: true });
  T('recovered RESUMED row without its save -> still needs the save proof', p.ok === null && p.reason === 'save-orphan');
  const st4 = fresh(); st4.runs.k = { max: 15, ms: 0, saves: {}, final: 1 };
  p = V.soloChainPlan(st4, 'k', seg(15, 20), 'm7', now, { recovered: true });
  T('recovered row after the run is final -> rejected (unchanged)', p.ok === false && p.reason === 'after-final');
  const vSrc = fs.readFileSync(path.join(__dirname, '..', 'validate.js'), 'utf8');
  T('solo lane passes the recovered flag; team lanes do not', /soloChainPlan\(soloState, key, f, m, nowMs, \{ recovered: !!r\.recovered \}\)/.test(vSrc)
    && (vSrc.match(/soloChainPlan\(soloState, key, f, c\.m, nowMs\)/g) || []).length === 2);
}

if (failN) { console.log('\nrecover-shards: ' + failN + ' FAIL'); process.exit(1); }
console.log('\nrecover-shards: all ok');
