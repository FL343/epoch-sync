'use strict';
// Q333 (cloud audit round 2, R2-B2-51): a seedcap veto stops the settlement and flags nobody.
// The veto branches of the reconcile (the main path and the solo segment lane) used to call recordFlag on every writer
// of the group, like a sanity failure does. The seedcap auditor convicts on its own lane already (seedcap.js applyAudit:
// suspect ledger -> reject window, offense board, an sc event in the trust ledger) -- only a self-written over-cap seat,
// nobody inside a new core's observation window (O285 (1)), reversed by a replay on a fixed core. The extra flag hit the
// honest opponents under the cap and every writer of a group a new core vetoed by its own miscount: 90 days in
// trust_tier and a lifetime fl in the trust ledger, kept after the veto went and the match settled (architecture
// decision 10). Now the veto only stops the settlement (counted and warned, as before).
//   [0] wiring pins: neither veto branch calls recordFlag; both still count and warn
//   [1] a two-player ranked match vetoed in the observation shape (seats [0], no suspect): not settled, not processed,
//       nobody flagged, no fl event in the trust ledger; the veto lifted, the match settles once, still nobody flagged
//   [2] the conviction shape (seat 0 self-written over the cap, a suspect entry): the reconcile still flags nobody (the
//       conviction is seedcap.js's own lane), the honest seat 1 included
//   [3] the solo segment lane: a guard-signed segment under a vetoed key is not settled, its owner not flagged; the veto
//       lifted, it settles once
//   [4] mutation self-check: the main-path recordFlag put back turns [1] red
// State isolation is structural (test/lib/settle-stub.js: every *_FILE var redirected, cwd = a temp dir).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);
const A = require(path.join(H.ROOT, 'attest.js'));

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

const MIN = 60000, HOUR = 3600 * 1000, GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const POINTS = 7, XP = 5;
const ENF = { SEEDCAP_ENFORCE: '1' };

// ---- helpers ----
const vetoOf = (key, seats) => ({ v: 1, audited: {}, veto: { [key]: { t: Math.floor(Date.now() / 60000), seats } }, suspects: {}, corrections: [] });
const fOf = (r, sid) => ((((r.state.SIGNALS_FILE || {}).players || {})[v.pid(sid)]) || {}).f | 0;
const flaggedKey = (r, m) => !!(((r.state.SIGNALS_FILE || {}).flagged || {})[m]);
// fl (forgery flag) events of the trust ledger, queued or appended
function flEvents(r) {
  let n = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.s === 'fl' || o.src === 'fl') n++;
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(r.state.TRUST_FILE);
  return n;
}
const processed = (r, key) => new Set(r.state.PROCESSED_FILE || []).has(key);
const vetoLines = (r, key) => r.out.split('\n').filter((l) => l.indexOf('match=' + key + ':') >= 0 && /seedcap over-cap veto/.test(l)).length;

// ---- the main path: a two-player ranked match (test/pending-writes.js shape) ----
const boardsOf = (recs) => H.shardBoards(recs, [{ id: XP, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] },
  { id: POINTS, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
function match(hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, 2, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, 2, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_2' };
}
// steps: [[ms, records, mut?]]; mut(files) edits the state handed to that run
function timeline(steps, files0, script) {
  const rs = []; let state = null;
  for (const [ms, recs, mut] of steps) {
    let files = state ? H.advance(state, ms) : JSON.parse(J(files0 || {}));
    if (mut) files = mut(files);
    const r = H.runCron(boardsOf(recs), files, ENF, script || null, 'seedcap-veto-flag');
    rs.push(r); state = r.state;
    if (r.code !== 0) break;
  }
  return { rs, last: rs[rs.length - 1], out: rs.map((r) => r.out).join(''), okAll: rs.every((r) => r.code === 0) };
}
const liftVeto = (files) => { files.SC_STATE_FILE = Object.assign({}, files.SC_STATE_FILE, { veto: {} }); return files; };
const SEQ = (mm) => [[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all], [6 * MIN, mm.all]];

function caseObserved(hash, script) {
  const P = H.SID(3331 + (hash & 0xff) * 2), Q = H.SID(3332 + (hash & 0xff) * 2);
  const mm = match(hash, [P, Q]);
  const vet = timeline(SEQ(mm), { SC_STATE_FILE: vetoOf(mm.key, [0]) }, script);
  const after = vet.okAll ? timeline([[10 * MIN, mm.all, liftVeto], [6 * MIN, mm.all]], H.advance(vet.last.state, 0), script) : null;
  return { P, Q, mm, vet, after };
}

console.log('=== Q333: a seedcap veto stops the settlement and flags nobody ===');

// ---- [0] wiring pins ----
{
  const SRC = H.SRC;
  const branch = (head, end) => { const i = SRC.indexOf(head); if (i < 0) return null; const j = SRC.indexOf(end, i); return j < 0 ? null : SRC.slice(i, j); };
  const main = branch('if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[c.m]) {\n', '      continue;\n');
  const late = branch('if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[c.m]) { console.log(\'  quit-lone late ', 'continue; }');
  const solo = branch('if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[m]) {', '      return false;\n');
  T('[0] the main-path veto branch: counted and warned, no recordFlag', !!main && !/recordFlag\(/.test(main) && /RUN\.seedcapVeto = \(RUN\.seedcapVeto \| 0\) \+ 1;/.test(main) && /seedcap over-cap veto/.test(main), main);
  T('[0] the solo veto branch: counted and warned, no recordFlag', !!solo && !/recordFlag\(/.test(solo) && /RUN\.seedcapVeto = \(RUN\.seedcapVeto \| 0\) \+ 1;/.test(solo) && /' \+ laneTag \+ ' segment seedcap over-cap veto/.test(solo), solo);   // O606: laneTag = solo / couch
  T('[0] the quit-lone late veto hold (W113): no recordFlag', !!late && !/recordFlag\(/.test(late), late);
  T('[0] each branch exactly once', SRC.split('seedcap.veto && seedcap.veto[c.m]').length === 3 && SRC.split('seedcap.veto && seedcap.veto[m]').length === 2);
}

// ---- [1] the observation shape ----
const R1 = caseObserved(0x33301);
{
  const { vet, after, mm, P, Q } = R1;
  T('[1] every run exits 0', vet.okAll && after && after.okAll, (vet.last || {}).out && vet.last.out.slice(-600));
  T('[1] vetoed: warned, not settled, not processed, no points or XP written', vetoLines(vet.last, mm.key) >= 1 && !processed(vet.last, mm.key)
    && vet.rs.every((r) => H.setPosts(r, POINTS).length === 0 && H.setPosts(r, XP).length === 0), (vet.out.match(/[^\n]*seedcap[^\n]*/g) || []).join(' | '));
  T('[1] vetoed: nobody flagged, the key not in the flag memory, no fl event', fOf(vet.last, P) === 0 && fOf(vet.last, Q) === 0 && !flaggedKey(vet.last, mm.key) && flEvents(vet.last) === 0,
    J({ f: [fOf(vet.last, P), fOf(vet.last, Q)], fl: flEvents(vet.last) }));
  if (after && after.okAll) {
    const w = (sid) => [].concat(...after.rs.map((r) => H.postsOf(r, POINTS, sid)));
    T('[1] the veto lifted: the match settles once (processed, one points write each)', processed(after.last, mm.key) && w(P).length === 1 && w(Q).length === 1, J({ P: w(P), Q: w(Q) }) + ' ' + after.out.slice(-500));
    T('[1] the veto lifted: still nobody flagged, no fl event', fOf(after.last, P) === 0 && fOf(after.last, Q) === 0 && flEvents(after.last) === 0);
  }
}

// ---- [2] the conviction shape: seat 0 self-written over the cap, a suspect entry (seedcap.js's own lane) ----
{
  const P = H.SID(3341), Q = H.SID(3342);
  const mm = match(0x33302, [P, Q]);
  const sc = vetoOf(mm.key, [0]);
  sc.suspects[v.pid(P)] = { n: 1, t0: Math.floor(Date.now() / 60000), t1: Math.floor(Date.now() / 60000), t1e: Math.floor(Date.now() / 60000), ms: [mm.key], cv: [[mm.key, Math.floor(Date.now() / 60000)]] };
  const vet = timeline(SEQ(mm), { SC_STATE_FILE: sc });
  T('[2] every run exits 0', vet.okAll, (vet.last || {}).out && vet.last.out.slice(-600));
  T('[2] vetoed, not settled', vetoLines(vet.last, mm.key) >= 1 && !processed(vet.last, mm.key));
  T('[2] the reconcile flags nobody: neither the honest seat 1 nor the convicted seat 0 (his conviction stays in seedcap.js)', fOf(vet.last, P) === 0 && fOf(vet.last, Q) === 0 && flEvents(vet.last) === 0,
    J({ f: [fOf(vet.last, P), fOf(vet.last, Q)], fl: flEvents(vet.last) }));
}

// ---- [3] the solo segment lane (test/solo-lane-owner-key.js shape: a tree copy with one test signing key) ----
{
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'seedcap-veto-flag-tree-'));
  try {
    require('./root-listing').copyRootTree(H.ROOT, tree, ['.git', 'test', 'node_modules']);
    const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
    const PRIV = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from('3c'.repeat(32), 'hex')]), format: 'der', type: 'pkcs8' });
    const PUB = crypto.createPublicKey(PRIV).export({ type: 'spki', format: 'der' }).slice(-32).toString('hex');
    const KEY_ID = 2099102733;
    const kf = path.join(tree, 'attest-keys.json');
    const kj = JSON.parse(fs.readFileSync(kf, 'utf8'));
    kj.keys[String(KEY_ID)] = { pubs: [PUB], sealed: true, at: '2026-10-01T00:00:00.000Z' };
    fs.writeFileSync(kf, JSON.stringify(kj, null, 2));
    const start7 = (hash, sid, runSeed) => { const p = H.sidPair(sid); return [0xB2, 1, 7, hash | 0, runSeed, 0, 0, 0, 1, 0, 0, 0, p[0], p[1]]; };
    const signedSolo = (sid, id, runSeed) => {
      const [lo, hi] = H.sidPair(sid);
      const b = [0xB1, 3, 7, A.hash32(id), runSeed, 0, 1, 0, 1, 300, 1000, 0, lo, hi, 5, 8, 0, 0, 0, A.SEG_CASUAL | A.SEG_RESUMED,
        KEY_ID, (5 | ((A.hash32(id + '-tag') & A.RESUME_TAG_MASK) << A.RESUME_TAG_SHIFT)) | 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const sig = crypto.sign(null, A.toBytes(b), PRIV);
      for (let i = 0; i < 16; i++) b.push(sig.readInt32LE(i * 4));
      return b;
    };
    const S = H.SID(3351), RS = 333510;
    const seg = signedSolo(S, 'q333-solo', RS), m = H.keyOf(seg);
    const own = { sid: S, d: start7(seg[3], S, RS) };
    const rows = [own, { sid: S, d: seg }];
    const soloBoards = (recs) => H.shardBoards(recs, [{ id: XP, name: 'progress', entries: [] }, { id: 8, name: 'cp_bank', entries: [{ steamID: S, score: 1000 }] },
      { id: 9, name: 'trust_tier', entries: [] }, { id: 10, name: 'report_box', entries: [] }, { id: 11, name: 'endless_board', entries: [] },
      { id: 12, name: 'endless_board_trio', entries: [] }, { id: 13, name: 'endless_board_quad', entries: [] }, { id: 14, name: 'endless_comp_trio', entries: [] },
      { id: 15, name: v.ENDLESS_LB_SOLO, entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: POINTS, name: 'points', entries: [] }]);
    const soloAdvance = (state, ms) => {
      const files = H.advance(state, ms);
      const so = files.SOLO_FILE;
      if (so) {
        for (const k of Object.keys(so.runs || {})) if (so.runs[k].t) so.runs[k].t -= ms;
        for (const k of Object.keys(so.wait || {})) if (so.wait[k].t0) so.wait[k].t0 -= ms;
        for (const k of Object.keys(so.ms || {})) if (so.ms[k].t) so.ms[k].t -= ms;
        for (const k of Object.keys(so.held || {})) { if (so.held[k].t) so.held[k].t -= ms; if (so.held[k].t0) so.held[k].t0 -= ms; }
        for (const k of Object.keys(so.done || {})) if (Array.isArray(so.done[k])) so.done[k][1] -= Math.floor(ms / 1000);
      }
      return files;
    };
    const runs = {};
    runs[v.soloRunKey(v.pid(S), 0, RS)] = { max: 7, ms: 0, saves: {}, t: Date.now(), seg0: 1, final: 1 };
    const files0 = { SOLO_FILE: { runs, wait: {}, ms: {} }, SC_STATE_FILE: vetoOf(m, [0]) };
    const env = Object.assign({}, ENF, { RESUME_TAG_REQUIRED: '0' });
    const script = path.join(tree, 'validate.js');
    const steps = [[0, [own], null], [2 * HOUR, rows, null], [2 * HOUR, rows, null], [10 * MIN, rows, liftVeto], [10 * MIN, rows, null]];
    const rs = []; let state = null;
    for (const [ms, recs, mut] of steps) {
      let files = state ? soloAdvance(state, ms) : JSON.parse(J(files0));
      if (mut) files = mut(files);
      const r = H.runCron(soloBoards(recs), files, env, script, 'seedcap-veto-flag-solo');
      rs.push(r); state = r.state;
      if (r.code !== 0) break;
    }
    const settles = (r) => r.out.split('\n').filter((l) => l.indexOf('solo settle ' + m + ': ') >= 0).length;
    const soloVeto = (r) => r.out.split('\n').filter((l) => l.indexOf('match=' + m + ': solo segment seedcap over-cap veto') >= 0).length;
    T('[3] every run exits 0', rs.length === steps.length && rs.every((r) => r.code === 0), (rs[rs.length - 1] || {}).out && rs[rs.length - 1].out.slice(-1500));
    if (rs.length === steps.length) {
      T('[3] vetoed while the veto stands: warned, never settled, its owner not flagged, no fl event', soloVeto(rs[1]) === 1 && settles(rs[1]) + settles(rs[2]) === 0
        && fOf(rs[2], S) === 0 && !flaggedKey(rs[2], m) && flEvents(rs[2]) === 0, rs.slice(1, 3).map((r) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join(' | ')).join(' || '));
      T('[3] the veto lifted: the segment settles once, still not flagged', settles(rs[3]) + settles(rs[4]) === 1 && fOf(rs[4], S) === 0 && flEvents(rs[4]) === 0,
        rs.slice(3).map((r) => r.out.split('\n').filter((l) => l.indexOf(m) >= 0).join(' | ')).join(' || '));
    }
  } finally { try { fs.rmSync(tree, { recursive: true, force: true }); } catch (err) {} }
}

// ---- [4] mutation self-check: the main-path recordFlag put back ----
{
  const head = 'if (SEEDCAP_ENFORCE && seedcap && seedcap.veto && seedcap.veto[c.m]) {\n';
  const src = H.SRC;
  T('[4] the mutation point exists exactly once', src.split(head).length === 2);
  const mut = path.join(H.ROOT, '.mutant-seedcap-veto-flag-' + process.pid + '.js');
  try {
    fs.writeFileSync(mut, src.replace(head, head + '      recordFlag(signals, g, c.m, nowMs); sigDirty = true;\n'));
    const M = caseObserved(0x33303, mut);
    const fl = fOf(M.vet.last, M.P) + fOf(M.vet.last, M.Q);
    T('[4] with the flag put back, [1] turns red (both writers flagged, fl events in the trust ledger)', M.vet.okAll && fl === 2 && flEvents(M.vet.last) >= 1,
      J({ f: fl, fl: flEvents(M.vet.last), code: (M.vet.last || {}).code }));
  } finally { try { fs.unlinkSync(mut); } catch (err) {} }
}

console.log(failN ? 'seedcap-veto-flag: ' + failN + ' FAIL' : 'seedcap-veto-flag: all ok');
process.exit(failN ? 1 : 0);
