'use strict';
// O807 (2026-11-09): the backlog file (PENDING_WRITES_FILE) is committed to the public repo, and its entries name boards whose names
// are kept out of it (the secret LP / rating / XP board names: a bot state commit carried one on 2026-11-08 / 11-09, and the push
// checks held every push of the repo while it sat on main). The names are now sealed at the file boundary (pwMapNames + pwSealName
// / pwOpenName in validate.js); in memory the entries keep the real names.
//   [1] the seal: round trip, deterministic, no clear text, a seal of another salt is not misread, a clear name passes through,
//       a sealed name is not sealed twice; pwMapNames covers w / wp / l / xw / cw / rw .b and the keys of ew, nothing else
//   [2] a settle whose writes fail: the values wait under the real names in memory (the harness opens the file), the file on disk
//       names no board in clear
//   [3] a settle whose writes land: the last write it keeps (l) is sealed on disk too
//   [4] class lock: across every run above, no state file the job writes names a configured secret board (exact key or value)
//   [5] a file saved before this change (names in clear) is still honoured: the waiting write goes out, and one that waits on is
//       saved sealed
const H = require('./lib/settle-stub.js');
for (const k of H.SCRUB) delete process.env[k];
process.env.STATE_SALT = 's';
const v = require(H.VALIDATE);

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const J = JSON.stringify;

// distinctive names, so an exact match anywhere in the state can only be the board name itself
const NAMES = { LP_LB: 'zqlpboard', RANKED_LB: 'zqrkboard', XP_LB: 'zqxpboard', CP_LB: 'zqcpboard' };
const SECRET = [NAMES.LP_LB, NAMES.RANKED_LB, NAMES.XP_LB, NAMES.CP_LB];
const POINTS = 7;
const MIN = 60000, GRACE = (v.ABSENT_GRACE_MS || 0) + MIN;
const boardsOf = (recs, pts) => H.shardBoards(recs, [{ id: 5, name: NAMES.XP_LB, entries: [] }, { id: 6, name: NAMES.RANKED_LB, entries: [] },
  { id: POINTS, name: NAMES.LP_LB, entries: Object.keys(pts || {}).map((s) => ({ steamID: s, score: pts[s].score, details: [] })) }, { id: 8, name: NAMES.CP_LB, entries: [] }]);
function match(mt, hash, ros) {
  const sc = ros.map((_, i) => 6000 - 1000 * i);
  const S = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB2, mt, hash, seat, 0, false, ros, sc) }));
  const R = ros.map((s, seat) => ({ sid: s, d: H.rec(0xB1, mt, hash, seat, seat + 1, seat === 0, ros, sc) }));
  return { S, R, all: S.concat(R), key: hash + '_1234_' + mt };
}
const FAIL_ALL = J({ [NAMES.LP_LB]: 500, [NAMES.RANKED_LB]: 500, [NAMES.XP_LB]: 500, [NAMES.CP_LB]: 500 });
const runs = [];
function run(steps, pts, files0) {
  let state = null, last = null;
  for (const [ms, recs, fail] of steps) {
    const env = Object.assign({}, NAMES, fail ? { STUB_FAIL_POST: FAIL_ALL } : {});
    last = H.runCron(boardsOf(recs, pts), state ? H.advance(state, ms) : (files0 || null), env, null, 'pw-no-names');
    runs.push(last); state = last.state;
    if (last.code !== 0) break;
  }
  return last;
}
// every exact key / string value equal to a secret board name (or its season twin name_s<N>), as "file:path"
function namesIn(obj, file) {
  const hits = [], re = new RegExp('^(' + SECRET.join('|') + ')(_s\\d+)?$');
  const walk = (x, at) => {
    if (typeof x === 'string') { if (re.test(x)) hits.push(file + ':' + at); return; }
    if (!x || typeof x !== 'object') return;
    for (const k of Object.keys(x)) { if (re.test(k)) hits.push(file + ':' + at + '/' + k + ' (key)'); walk(x[k], at + '/' + k); }
  };
  walk(obj, '');
  return hits;
}
const rawPW = (r) => (r && r.raw && r.raw.PENDING_WRITES_FILE) || '';

console.log('=== O807: the backlog file names no board in clear ===');
// ---- [1] ----
{
  const K = v.pwKeys('s'), K2 = v.pwKeys('other');
  const a = v.pwSealName('zqlpboard', K);
  T('[1] sealed: starts with ~, no clear text, opens back', typeof a === 'string' && a[0] === '~' && !a.includes('zqlpboard') && v.pwOpenName(a, K) === 'zqlpboard', a);
  T('[1] deterministic (a save that changed nothing writes the same bytes); two names, two seals', v.pwSealName('zqlpboard', K) === a && v.pwSealName('zqlpboard_s1', K) !== a);
  T('[1] a seal of another salt is left as it is (not misread as some board)', v.pwOpenName(a, K2) === a);
  T('[1] a clear name (a file saved before O807) passes through; a sealed one is not sealed twice; junk after ~ stays', v.pwOpenName('zqlpboard', K) === 'zqlpboard' && v.pwSealName(a, K) === a && v.pwOpenName('~abc', K) === '~abc');
  const s = { p1: { w: { b: 'zqlpboard', v: 1, t: 2, n: 1 }, wp: { b: 'zqlpboard', v: 1 }, l: { b: 'zqlpboard_s1', v: 1, d: [] }, xw: { b: 'zqxpboard', v: 3 }, cw: { b: 'zqcpboard', v: 4 }, rw: { b: 'zqrkboard', v: 5 },
    ew: { zqlpboard: { v: 9, t: 1, n: 0 } }, rc: [[1, 2, 3, 4, 5]], gone: 123 }, p2: null };
  const sealed = v.pwMapNames(s, v.pwSealName, 's');
  T('[1] pwMapNames seals every name the entry carries (w / wp / l / xw / cw / rw, the keys of ew)', namesIn(sealed, 'mem').length === 0 && Object.keys(sealed.p1.ew)[0][0] === '~' && sealed.p1.l.b[0] === '~', J(sealed));
  T('[1] ... and touches nothing else (values, receipts, the gone mark, an empty entry); the input is not changed', sealed.p1.w.v === 1 && sealed.p1.ew[Object.keys(sealed.p1.ew)[0]].v === 9 && J(sealed.p1.rc) === J(s.p1.rc) && sealed.p1.gone === 123 && sealed.p2 === null && s.p1.w.b === 'zqlpboard');
  T('[1] open after seal gives the backlog back', J(v.pwMapNames(sealed, v.pwOpenName, 's')) === J(s), J(v.pwMapNames(sealed, v.pwOpenName, 's')));
}

const A = H.SID(8071), B = H.SID(8072);
// ---- [2] ----
let failed = null;
{
  const mm = match(2, 0x80701, [A, B]);
  failed = run([[0, mm.S, true], [5 * MIN, mm.all, true], [GRACE, mm.all, true]], { [A]: { score: 2500 }, [B]: { score: 2400 } });
  const pw = (failed.state.PENDING_WRITES_FILE || {})[v.pid(A)] || {};
  T('[2] the failed writes wait under the real board names in memory (points w, and the rating / XP / CP rows that failed)', failed.code === 0 && pw.w && pw.w.b === NAMES.LP_LB
    && ['xw', 'cw', 'rw'].filter((f) => pw[f]).every((f) => pw[f].b === ({ xw: NAMES.XP_LB, cw: NAMES.CP_LB, rw: NAMES.RANKED_LB })[f]) && ['xw', 'rw'].every((f) => pw[f]), J(pw) + ' ' + failed.out.slice(-400));
  const raw = rawPW(failed);
  T('[2] the file on disk: no board name in clear, the names sealed', raw.length > 2 && !SECRET.some((n) => raw.includes(n)) && /"b":"~/.test(raw), raw.slice(0, 400));
}
// ---- [3] ----
{
  const mm = match(2, 0x80702, [A, B]);
  const r = run([[0, mm.S], [5 * MIN, mm.all], [GRACE, mm.all]], { [A]: { score: 2500 }, [B]: { score: 2400 } });
  const pw = (r.state.PENDING_WRITES_FILE || {})[v.pid(A)] || {};
  const raw = rawPW(r);
  T('[3] a landed points write leaves its last write (l) under the real name in memory', r.code === 0 && pw.l && pw.l.b === NAMES.LP_LB, J(r.state.PENDING_WRITES_FILE) + ' ' + r.out.slice(-300));
  T('[3] ... sealed on disk', raw.length > 2 && !SECRET.some((n) => raw.includes(n)) && /"l":\{"b":"~/.test(raw), raw.slice(0, 300));
}
// ---- [5] ----
{
  const mm = match(2, 0x80703, [A, B]);
  const files0 = { PENDING_WRITES_FILE: { [v.pid(A)]: { w: { b: NAMES.LP_LB, v: 2600, d: [], t: Date.now() - 60000, n: 1 } } } };
  const back = run([[0, mm.S]], { [A]: { score: 2500 } }, files0);
  T('[5] a waiting write saved in clear before O807 still goes out (Steam back): written, the backlog clears it', back.code === 0 && H.postsOf(back, POINTS, A).some((p) => p.score === 2600) && !(((back.state.PENDING_WRITES_FILE || {})[v.pid(A)] || {}).w), back.out.slice(-400));
  const still = run([[0, mm.S, true]], { [A]: { score: 2500 } }, files0);
  const e = ((still.state.PENDING_WRITES_FILE || {})[v.pid(A)] || {}).w;
  T('[5] ... and one that waits on is saved sealed', still.code === 0 && e && e.b === NAMES.LP_LB && !rawPW(still).includes(NAMES.LP_LB), rawPW(still).slice(0, 300));
}
// ---- [4] ----
{
  const hits = [];
  for (const r of runs) for (const k of Object.keys(r.raw || {})) { let o = null; try { o = JSON.parse(r.raw[k]); } catch (e) { continue; } hits.push(...namesIn(o, k)); }
  T('[4] class lock: no state file of any run above names a configured secret board (' + runs.length + ' runs)', runs.length >= 6 && hits.length === 0, [...new Set(hits)].slice(0, 8).join(' | '));
}

console.log(failN ? '=== FAIL — ' + failN + ' fail (pending-writes-no-names) ===' : '=== PASS — 0 fail (pending-writes-no-names) ===');
process.exit(failN ? 1 : 0);
