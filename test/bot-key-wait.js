'use strict';
// Cloud audit Q408 (round 3, R3-A4-02): a lone bot match whose guard signature block this job cannot judge YET (a 'pending'
//   block: its key not in the table, retired past its grace, held for another channel, a block version the job does not read)
//   waits for the key, as a solo segment does -- before, it settled at once on the x0.6 lane and was processed, so the key
//   pushed an hour later could not lift it (an honest player lost 40% of the match's XP for good).
//   [1] botKeyPending (pure) + BOT_KEY_WAIT_MS (12 h, at most half the kept-record window)
//   [2] end to end over the REAL validate.js main(): the key missing, then pushed -> held (no XP, not processed, one warning),
//       still held a run later (no second warning), then 150 once the table has the key; mutant 'wait' -> 90 at once
//   [3] a retired key nobody brings back -> held, then x0.6 (90) once BOT_KEY_WAIT_MS has run out; mutant 'out' -> never settles
//   [4] the record leaves the shards while it waits (the player kept playing) -> the kept copy (Q373) settles it at 150 once the
//       key comes; mutant 'keep' (nothing kept) -> never settles
//   [5] what does not change: no block / MSIG_BOTS off / the key present (a broken block 90, a good one 150) -> settled at once
//       as before; a block naming a key the table lacks waits even when its score was moved (checked once the key is known)
//   [6] the writer's slot is claimed once: his next (unsigned) bot match settles while the first one waits; mutant 'claim'
//       (asked again every run) -> the next match is deferred behind the waiting one
//   [7] the summary row; [8] wiring pins (each mutant anchor once in validate.js, the harness shifts bw)
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const MS = require(path.join(ROOT, 'match-sig.js'));
const G = require(path.join(ROOT, 'tools', 'gen-match-sig-fixtures.js'));
const v = require(path.join(ROOT, 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const sp = (s) => { const b = BigInt(s); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
// a lone bot record as the client writes it (test/match-sig.js botRec): the human on seat 0, three bots, six levels
function botRec(o) {
  const sc = [9000, 4000, 3000, 2000], pc = sc.length;
  const d = [0xB1, 3, 11, o.h, 4242, 0, 1, (6 << 1) | 1, pc, 720];
  for (const s of sc) d.push(s | 0);
  d.push(0);
  d.push(...sp(o.sid));
  for (let i = 1; i < pc; i++) d.push(0, 0);
  d.push((0xD8 | (1 << 8) | (pc << 16)) | 0, 0x01020304);
  return d;
}
const KEY = 2099102301;
function sign(d) {
  const h5 = MS.head(KEY, MS.packFlags({ role: MS.ROLE_OWN, seen: 1, levels: 6 }), 0, d[11 + (d[8] | 0)]);
  const sig = crypto.sign(null, Buffer.from(MS.message(d, h5, null)), G.privKey());
  return MS.attach(d, h5.concat(MS.sigInts([...sig])));
}
const tamper = (d, i, val) => { const x = d.slice(); x[i] = val | 0; return x; };

console.log('=== cloud audit Q408: a lone bot match waits for a signing key this job cannot judge yet ===');
// ---- [1] ----
console.log('[1] botKeyPending / BOT_KEY_WAIT_MS');
{
  const P = v.botKeyPending;
  eq('one pending block -> waits', P(['pending:unknown-key']), true);
  eq('a retired / channel / revoked key, another block or ledger version -> waits',
    [P(['pending:key-retired']), P(['pending:key-channel']), P(['pending:key-revoked']), P(['pending:msig-ver']), P(['pending:ledger-ver'])], [true, true, true, true, true]);
  eq('a usable block -> nothing to wait for', P(['ok']), false);
  eq('no block / a broken block / a block whose own trust says no -> settles as before',
    [P(['none:none']), P(['bad:bad-sig']), P(['bad:owner-mismatch']), P(['untrusted:relay'])], [false, false, false, false]);
  eq('ok + pending (two records of one writer) -> waits; pending + broken -> settles as before (the broken one decides)',
    [P(['ok', 'pending:unknown-key']), P(['pending:unknown-key', 'bad:bad-sig'])], [true, false]);
  eq('nothing / not a list -> no wait', [P([]), P(null), P(undefined)], [false, false, false]);
  eq('BOT_KEY_WAIT_MS = 12 h by default', v.BOT_KEY_WAIT_MS, 12 * 3600 * 1000);
}

// ---- end-to-end tree: a copy of this repo, the key table written per run, validate.js per mutant ----
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-key-wait-tree-'));
require('./root-listing').copyRootTree(ROOT, TREE, ['.git', 'test', 'node_modules']);
const KF = path.join(TREE, 'attest-keys.json');
const KEYS0 = JSON.parse(fs.readFileSync(path.join(ROOT, 'attest-keys.json'), 'utf8'));
const SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
const SCRIPT = path.join(TREE, 'validate.js');
const MUT = {
  wait: ['if (MSIG.BOTS && c.botLone && botKeyPending(sigB.kinds)) {', 'if (false) {'],
  out: ['if (waitedB < BOT_KEY_WAIT_MS) {', 'if (true) {'],
  keep: ['RUN.keptKeep = (RUN.keptKeep | 0) + keptKeep(pendB, g.concat(dropRecs), nowMs, keptKeys(SALT));', ''],
  claim: ['if (!heldB && writerPaced(c.m, writerSids, pendB.t0, reqMsB)) continue;', 'if (writerPaced(c.m, writerSids, pendB.t0, reqMsB)) continue;'],
};
function useScript(mut) {
  let s = SRC;
  if (mut) { const [a, b] = MUT[mut]; if (s.split(a).length !== 2) throw new Error('mutant anchor ' + mut + ' not found once'); s = s.replace(a, b); }
  fs.writeFileSync(SCRIPT, s);
}
// key: 'none' = the table without the test key; 'live' = the key, sealed, every channel; 'retired' = retired 8 days ago on 'ea'
function useKeys(key) {
  const j = JSON.parse(JSON.stringify(KEYS0));
  delete j.keys[String(KEY)];
  if (key === 'live') j.keys[String(KEY)] = { pubs: [G.PUB_HEX], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  if (key === 'retired') j.keys[String(KEY)] = { pubs: [G.PUB_HEX], sealed: true, at: '2026-10-01T00:00:00.000Z',
    pubInfo: { [G.PUB_HEX]: { ch: 'ea', retiredAt: new Date(Date.now() - 8 * 86400000).toISOString() } } };
  fs.writeFileSync(KF, JSON.stringify(j, null, 2));
}
const PROGRESS = 5;
const MIN = 60000, HOUR = 60 * MIN;
const boardsOf = (recs) => H.shardBoards(recs, [{ id: PROGRESS, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [] }, { id: 8, name: 'cp_bank', entries: [] }]);
// steps: [{ recs, key, after (ms since the last run), env }] -> per run { code, out, summary, xp: {sid: score}, state }
function play(steps, mut) {
  useScript(mut || null);
  const runs = [];
  let state = null;
  for (const st of steps) {
    useKeys(st.key || 'none');
    const files = state ? H.advance(state, st.after == null ? 10 * MIN : st.after) : null;
    const r = H.runCron(boardsOf(st.recs), files, st.env === undefined ? { MSIG_BOTS: '1' } : st.env, SCRIPT, 'bkw');
    const xp = {};
    for (const p of H.setPosts(r, PROGRESS)) xp[/steamid=([0-9]+)/.exec(p.body)[1]] = Number(/score=(-?[0-9]+)/.exec(p.body)[1]);
    runs.push({ code: r.code, out: r.out, summary: r.summary, xp, state: r.state });
    state = r.state;
  }
  return runs;
}
const P1 = '76561198000000061', P2 = '76561198000000062', P3 = '76561198000000063', P4 = '76561198000000064', P5 = '76561198000000065', P6 = '76561198000000066';
const keyOfRec = (d) => d[3] + '_' + d[4] + '_' + d[2];
const processedHas = (run, m) => new Set(run.state.PROCESSED_FILE || []).has(m);
const warns = (out) => (out.match(/::warning::[^\n]*waits up to[^\n]*Q408/g) || []).length;
const rowOf = (summary) => (summary.match(/\| lone bot matches waiting for a signing key[^\n]*/) || [''])[0];
const allOk = (runs) => runs.every((r) => r.code === 0);

try {
  // ---- [2] ----
  console.log('[2] the key missing, then pushed');
  {
    const A = { sid: P1, d: sign(botRec({ sid: P1, h: 71001 })) };
    const m = keyOfRec(A.d);
    const steps = [{ recs: [A] }, { recs: [A] }, { recs: [A], after: 30 * MIN }, { recs: [A], key: 'live' }];
    const r = play(steps);
    T('every run exits 0', allOk(r), r.map((x) => x.code).join(','));
    eq('first run: inside the time floor, nothing paid', r[0].xp[P1], undefined);
    T('second run: held for the key -- no XP, not processed, logged', r[1].xp[P1] === undefined && !processedHas(r[1], m) && /bots-key-wait [^\n]*pending:unknown-key[^\n]*not settled \(Q408\)/.test(r[1].out),
      (r[1].out.match(/bots[^\n]*/g) || []).join(' | '));
    eq('second run: one warning naming the wait', warns(r[1].out), 1);
    T('third run (30 min on): still held, no second warning', r[2].xp[P1] === undefined && warns(r[2].out) === 0 && /bots-key-wait [^\n]*held 30 of 720 min/.test(r[2].out), (r[2].out.match(/bots-key-wait[^\n]*/g) || []).join(' | '));
    T('the start entry carries the wait stamp (bw) and the kept copy (kr)', r[2].state.STARTS_FILE && r[2].state.STARTS_FILE[m] && r[2].state.STARTS_FILE[m].bw > 0 && !!r[2].state.STARTS_FILE[m].kr);
    T('fourth run, the table has the key: paid as signed (150), processed', r[3].xp[P1] === 150 && processedHas(r[3], m) && /bots settle [^\n]*\(signed x1\.0\)/.test(r[3].out), JSON.stringify(r[3].xp));
    const mu = play(steps.slice(0, 2), 'wait');
    eq('mutant wait (no hold): settled at x0.6 on the second run, as before the fix', mu[1].xp[P1], 90);
  }

  // ---- [3] ----
  console.log('[3] a retired key that never comes back');
  {
    const A = { sid: P2, d: sign(botRec({ sid: P2, h: 71002 })) };
    const steps = [{ recs: [A], key: 'retired' }, { recs: [A], key: 'retired' }, { recs: [A], key: 'retired', after: 11 * HOUR }, { recs: [A], key: 'retired', after: 2 * HOUR }];
    const r = play(steps);
    T('every run exits 0', allOk(r), r.map((x) => x.code).join(','));
    T('held while the wait runs (second and third run: no XP, kind key-retired)', r[1].xp[P2] === undefined && r[2].xp[P2] === undefined && /bots-key-wait [^\n]*pending:key-retired/.test(r[1].out));
    T('past 12 h: settles on the x0.6 lane (90), logged', r[3].xp[P2] === 90 && /bots-key-wait [^\n]*waited [0-9]+ min, the key still cannot be judged/.test(r[3].out) && /bots settle [^\n]*\(lone lane x0\.6\)/.test(r[3].out),
      JSON.stringify(r[3].xp) + ' ' + (r[3].out.match(/bots[^\n]*/g) || []).join(' | '));
    const mu = play(steps, 'out');
    eq('mutant out (the wait never ends): still nothing paid after 13 h', mu[3].xp[P2], undefined);
  }

  // ---- [4] ----
  console.log('[4] the record leaves the shards while it waits');
  {
    const A = { sid: P3, d: sign(botRec({ sid: P3, h: 71003 })) };
    const steps = [{ recs: [A] }, { recs: [A] }, { recs: [] }, { recs: [], key: 'live' }];
    const r = play(steps);
    T('every run exits 0', allOk(r), r.map((x) => x.code).join(','));
    T('third run, the row gone: read from its kept copy, still held', /kept records: 1 read/.test(r[2].out) && r[2].xp[P3] === undefined && /bots-key-wait/.test(r[2].out), (r[2].out.match(/kept records[^\n]*|bots[^\n]*/g) || []).join(' | '));
    eq('fourth run, the key pushed: the kept copy settles it as signed (150)', r[3].xp[P3], 150);
    const mu = play(steps, 'keep');
    eq('mutant keep (nothing kept): the match is lost (nothing paid)', mu[3].xp[P3], undefined);
  }

  // ---- [5] ----
  console.log('[5] what does not change');
  {
    const un = { sid: P4, d: botRec({ sid: P4, h: 71004 }) };
    const tp = { sid: P5, d: tamper(sign(botRec({ sid: P5, h: 71005 })), 10, 9999) };
    const pd = { sid: P6, d: sign(botRec({ sid: P6, h: 71006 })) };
    const r = play([{ recs: [un, tp, pd] }, { recs: [un, tp, pd] }]);
    T('both runs exit 0', allOk(r));
    eq('key not listed: no block -> 90 at once; a pending block -> held', [r[1].xp[P4], r[1].xp[P6]], [90, undefined]);
    eq('key not listed: a moved score under the block waits too (the signature is checked once the key is known)', r[1].xp[P5], undefined);
    const lv = play([{ recs: [tp, pd], key: 'live' }, { recs: [tp, pd], key: 'live' }]);
    eq('the key present: a broken block -> 90 at once (bad-sig), a good one -> 150 at once, nothing held',
      [lv[1].xp[P5], lv[1].xp[P6], /bots-key-wait/.test(lv[1].out), /\[msig bad:bad-sig\]/.test(lv[1].out)], [90, 150, false, true]);
    const off = play([{ recs: [pd], env: null }, { recs: [pd], env: null }]);
    eq('MSIG_BOTS off: a pending block is paid x0.6 at once, as before (nothing waits)', off[1].xp[P6], 90);
    T('MSIG_BOTS off: the row says nothing waits', /\(MSIG_BOTS off: nothing waits\) \| 0 \/ 0 \/ 0 \|/.test(off[1].summary), rowOf(off[1].summary));
  }

  // ---- [6] ----
  console.log('[6] the writer\'s slot is claimed once (his next match is not deferred behind the waiting one)');
  {
    const A = { sid: P1, d: sign(botRec({ sid: P1, h: 72001 })) };
    const B = { sid: P1, d: botRec({ sid: P1, h: 72002 }) };   // his next match, no block
    const mB = keyOfRec(B.d);
    // the job's 5-minute cadence: A first seen, then A held while B is first seen, then B past its floor
    const steps = [{ recs: [A] }, { recs: [A, B], after: 5 * MIN }, { recs: [A, B], after: 5 * MIN }];
    const r = play(steps);
    T('every run exits 0', allOk(r), r.map((x) => x.code).join(','));
    T('A held on the second run', /bots-key-wait 72001_/.test(r[1].out), (r[1].out.match(/bots[^\n]*|writer-pacing[^\n]*/g) || []).join(' | '));
    T('third run: B settles (90), A still waits', r[2].xp[P1] === 90 && processedHas(r[2], mB) && /bots-key-wait 72001_/.test(r[2].out),
      JSON.stringify(r[2].xp) + ' ' + (r[2].out.match(/bots[^\n]*|writer-pacing[^\n]*/g) || []).join(' | '));
    const mu = play(steps, 'claim');
    T('mutant claim (asked every run): B deferred behind A on the third run', mu[2].xp[P1] === undefined && /writer-pacing 72002_/.test(mu[2].out),
      JSON.stringify(mu[2].xp) + ' ' + (mu[2].out.match(/bots[^\n]*|writer-pacing[^\n]*/g) || []).join(' | '));
  }

  // ---- [7] ----
  console.log('[7] summary row');
  {
    const A = { sid: P2, d: sign(botRec({ sid: P2, h: 73001 })) };
    const r = play([{ recs: [A] }, { recs: [A] }, { recs: [A] }, { recs: [A], after: 13 * HOUR }]);
    T('newly held: 1 / 1 / 0', /\| 1 \/ 1 \/ 0 \|$/.test(rowOf(r[1].summary)), rowOf(r[1].summary));
    T('still held: 1 / 0 / 0', /\| 1 \/ 0 \/ 0 \|$/.test(rowOf(r[2].summary)), rowOf(r[2].summary));
    T('waited out: 0 / 0 / 1, named x0.6 after 12 h', /settled at x0\.6 after 12 h \| 0 \/ 0 \/ 1 \|$/.test(rowOf(r[3].summary)), rowOf(r[3].summary));
  }
} finally { try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {} }

// ---- [8] ----
console.log('[8] wiring pins');
{
  for (const k of Object.keys(MUT)) eq('mutant anchor "' + k + '" appears once in validate.js', SRC.split(MUT[k][0]).length - 1, 1);
  T('the wait is at most half the kept-record window (a kept copy outlives the wait)', /BOT_KEY_WAIT_MS = Math\.min\([^\n]*Math\.floor\(KEPT_REC_MAX_MS \/ 2\)\)/.test(SRC));
  T('the writerPaced contract names the one exception', /claims the slot once on its first hold and never asks again, Q408/.test(SRC));
  T('the harness shifts the wait stamp with the clock (settle-stub advance)', /st\[k\]\.bw -= ms/.test(fs.readFileSync(path.join(__dirname, 'lib', 'settle-stub.js'), 'utf8')));
}

console.log(failN ? ('bot-key-wait: ' + failN + ' FAIL') : 'bot-key-wait: all ok');
process.exit(failN ? 1 : 0);
