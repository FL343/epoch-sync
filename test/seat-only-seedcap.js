'use strict';
// Q418 round 2 (cloud audit, REVIEW round 1 section 3): the seed-cap audit of a held team segment whose writers agree on the tail
// and differ only in the seat scores. The reconcile moves its run's chain past such a segment (test/seat-only-chain.js); round 1
// left it unaudited here (pendingOfGroup gives up on a group whose vectors differ), so a modified host could raise the bank on his
// frames, nudge one seat of his own record, have the segment moved past, and the next segment's start bank fell back to the static
// bound (far above any real bank): the per-seed cap no longer held. Now this job reads that shape too:
//   - on the records the reconcile reads (the seat gate of the reconcile's start rosters, STARTS_FILE: an outside account's record
//     on the key counts nowhere here either -- it cannot make the shape unreadable here while the reconcile reads it)
//   - each seat's highest score audited, nobody convicted (self empty), the veto as ever; an audit under the cap extends the run's
//     audited chain for every writer's own seat (chainSelf), so the next segment's start bank is that cap
//   - the reconcile waits for the audit (validate.seatOnlyAuditGate: its seedcapKnowsKey is this job's knownAudit)
//   [1] STARTS_FILE: the processed file's twin, paired with each channel's reconcile in the workflows
//   [2] pendingOfGroup reads the shape (gated, max vector, self empty, chainSelf all), refuses it without a start roster
//   [3] applyAudit: over the cap -> veto only (no suspect, no correction, no offender); under -> the chain extends for all four,
//       the next segment's start bank is the audited cap
//   [4] the reconcile's seedcapKnowsKey agrees with knownAudit (full entry, token, another salt); seatOnlyAuditGate
//   [5] mutation self-checks (seedcap.js and validate.js mutated in a copy)
const fs = require('fs'), path = require('path');
for (const k of ['SC_COUCH_CONVICT', 'PT_MODE', 'STARTS_FILE', 'PROCESSED_FILE', 'SC_FOLD_MIN']) delete process.env[k];
process.env.STATE_SALT = 's';
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const SC_SRC = fs.readFileSync(path.join(ROOT, 'seedcap.js'), 'utf8');
const V_SRC = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');

let failN = 0;
const T = (m, cond, detail) => { if (cond) console.log('  ok    ' + m); else { failN++; console.log('  FAIL  ' + m + (detail ? ' -- ' + detail : '')); } };

const SID = (n) => '7656119800' + String(n).padStart(7, '0');
const sidPair = (sid) => { const b = BigInt(sid); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; };
const SEED = 9;
const ROS = [SID(1), SID(2), SID(3), SID(4)];
const SC = [49325, 30000, 20000, 10000];
// endless team record (type 7): 10 header + pc scores + disp + 2pc roster + the 11-int tail (start, end, continues, tokens, season,
//   flags, build, picksLo, picksHi, rerollLo, rerollHi)
function rec(hash, seat, sd, ed, scores, flags, ros) {
  const r = ros || ROS, d = [0xB1, 3, 7, hash | 0, SEED, seat, 0, 0, r.length, 475];
  for (let i = 0; i < r.length; i++) d.push(scores[i] | 0);
  d.push(0);
  for (const s of r) { const p = sidPair(s); d.push(p[0], p[1]); }
  return d.concat([sd, ed, 0, 0, 0, flags == null ? A.SEG_COMP : flags, 0, 0, 0, 0, 0]);
}
const keyOf = (h) => (h | 0) + '_' + SEED + '_7';
// one segment as this job reads it: {d, roster, w}; scoresOf(seat) = that writer's own record's seat scores
const group = (h, sd, ed, scoresOf, flags) => ROS.map((sid, i) => { const d = rec(h, i, sd, ed, scoresOf(i), flags); return { d, roster: v.decodeRoster(d), w: sid }; });
const startsOf = (m, ros) => ({ [m]: { t0: 1, mt: 7, roster: Object.fromEntries((ros || ROS).map((s, i) => [String(i), v.pid(s)])) } });
// the live shape: seat 3's own record writes seat 2 200 short
const shortAt3 = (i) => (i === 3 ? [49325, 30000, 19800, 10000] : SC);

function suite(sc, vv, tag) {
  const out = {};
  const pre = tag ? tag + ' ' : '';
  // ---- [2] ----
  {
    const m = keyOf(0x100), g = group(0x100, 10, 15, shortAt3);
    const x = sc.pendingOfGroup({ audited: {}, chain: {} }, m, g, { starts: startsOf(m) });
    out.read = !!x && x.so === 1;
    out.max = !!x && x.scores.join(',') === SC.join(',');
    out.noSelf = !!x && Array.isArray(x.self) && x.self.length === 0;
    out.chainSelf = !!x && (x.chainSelf || []).join(',') === '0,1,2,3';
    if (!tag) {
      T('[2] the live shape: read as a seat-only segment (so), each seat\'s highest score, nobody to convict, every writer\'s seat for the chain', out.read && out.max && out.noSelf && out.chainSelf,
        x ? JSON.stringify({ so: x.so, scores: x.scores, self: x.self, chainSelf: x.chainSelf, w: x.w }) : 'null');
      T('[2] its tail and run seed are the segment\'s (10 -> 15, team competitive)', x && x.tail.startDepth === 10 && x.tail.endDepth === 15 && x.runSeed === SEED && x.p.entry === 'endless' && x.w === 4);
      T('[2] without the start rosters (no opt) -> not read, as before', sc.pendingOfGroup({ audited: {}, chain: {} }, m, g) === null);
      T('[2] no start roster for this key / a split roster -> not read', sc.pendingOfGroup({ audited: {}, chain: {} }, m, g, { starts: startsOf(keyOf(0x999)) }) === null
        && sc.pendingOfGroup({ audited: {}, chain: {} }, m, g, { starts: { [m]: Object.assign({}, startsOf(m)[m], { split: 1 }) } }) === null);
      const ag = group(0x101, 10, 15, () => SC), am = keyOf(0x101);
      const xa = sc.pendingOfGroup({ audited: {}, chain: {} }, am, ag, { starts: startsOf(am) });
      T('[2] a consistent group: audited as ever (no so mark, every writer convictable)', xa && !xa.so && xa.self.join(',') === '0,1,2,3' && !xa.chainSelf);
      const tm = keyOf(0x102), tg = group(0x102, 10, 15, shortAt3); tg[3].d[23 + 1] = 14;
      T('[2] the tails differ (one record [10,14]) -> not read', sc.pendingOfGroup({ audited: {}, chain: {} }, tm, tg, { starts: startsOf(tm) }) === null);
      const cm = keyOf(0x103), cg = group(0x103, 10, 15, shortAt3, 0);
      T('[2] casual co-op (no chain) -> not read', sc.pendingOfGroup({ audited: {}, chain: {} }, cm, cg, { starts: startsOf(cm) }) === null);
      const mm = keyOf(0x104), mg = group(0x104, 10, 15, shortAt3).slice(1);   // seat 0 wrote nothing, seat 3's record differs
      T('[2] a seat wrote nothing -> not read', sc.pendingOfGroup({ audited: {}, chain: {} }, mm, mg, { starts: startsOf(mm) }) === null);
    }
    // an outside account's record on the key (not on the start roster): the reconcile's seat gate drops it, so does this job
    const om = keyOf(0x105), og = group(0x105, 10, 15, shortAt3);
    const od = rec(0x105, 0, 10, 15, [1, 1, 1, 1], A.SEG_COMP, [SID(77)].concat(ROS.slice(1)));
    og.push({ d: od, roster: v.decodeRoster(od), w: SID(77) });
    const xo = sc.pendingOfGroup({ audited: {}, chain: {} }, om, og, { starts: startsOf(om) });
    out.gate = !!xo && xo.so === 1 && xo.w === 4 && xo.scores.join(',') === SC.join(',');
    if (!tag) T('[2] an outside account\'s record on the key: left out by the seat gate, the four read as ever', out.gate, xo ? JSON.stringify({ so: xo.so, w: xo.w, scores: xo.scores }) : 'null');
    // pickAuditable passes the start rosters on
    const pk = sc.pickAuditable({ audited: {}, chain: {} }, { [m]: g }, { starts: startsOf(m) });
    out.pick = pk.length === 1 && pk[0].so === 1;
    if (!tag) T('[2] pickAuditable reads it with the start rosters it is given', out.pick);
  }
  // ---- [3] ----
  {
    const fresh = () => ({ audited: {}, chain: {}, suspects: {}, veto: {}, corrections: [] });
    // the attack: the host raised seat 0's bank on his frames (every copy carries it) and nudged seat 1 of his own record (+1)
    const m = keyOf(0x200), g = group(0x200, 10, 15, (i) => (i === 0 ? [90000, 30001, 20000, 10000] : [90000, 30000, 20000, 10000]));
    const st = fresh();
    const x = sc.pendingOfGroup(st, m, g, { starts: startsOf(m) });
    const r = x ? sc.applyAudit(st, [x], { m0: { cap: 60000 } }, new Set([m]), 1000) : null;
    out.veto = !!st.veto[m] && st.veto[m].seats.join(',') === '0';
    out.noConvict = Object.keys(st.suspects).length === 0 && st.corrections.length === 0 && !!r && r.flags.length === 1 && r.flags[0].offenders.length === 0;
    out.overMark = !!st.audited[m] && st.audited[m].o === 1 && st.audited[m].so === 1;
    if (!tag) {
      T('[3] over the cap: vetoed (seat 0)', out.veto, JSON.stringify(st.veto));
      T('[3] nobody convicted: no suspect, no correction (even with the key read as processed), no offender row', out.noConvict, JSON.stringify({ su: st.suspects, cor: st.corrections, fl: r && r.flags }));
      T('[3] remembered as audited over the cap, marked seat-only', out.overMark, JSON.stringify(st.audited[m]));
      T('[3] no audited chain from a vetoed segment (the next start bank stays where it was)', Object.keys(st.chain).length === 0);
    }
    // honest: under the cap -> the chain extends for every writer; the next segment's start bank is the audited cap
    const hm = keyOf(0x201), hg = group(0x201, 10, 15, shortAt3);
    const hs = fresh();
    const hx = sc.pendingOfGroup(hs, hm, hg, { starts: startsOf(hm) });
    if (hx) sc.applyAudit(hs, [hx], { m0: { cap: 60000 } }, new Set(), 1000);
    const pids = ROS.map((s) => v.pid(s));
    out.chain = pids.every((p) => { const c = hs.chain[sc.chainKey(p, 4, SEED)]; return c && c.d === 15 && c.cap === 60000; });
    out.bank = sc.chainStartBank(hs, pids, 4, 15, SEED) === 60000;
    if (!tag) {
      T('[3] under the cap: the audited chain extends to 15 for all four writers', out.chain, JSON.stringify(hs.chain));
      T('[3] the next segment [15,20] starts from the audited cap, not the static bound (' + Math.round(v.endlessGoalFor(15, 4) * v.ENDLESS.SCORE_MULT) + ')', out.bank, String(sc.chainStartBank(hs, pids, 4, 15, SEED)));
      T('[3] the honest audit convicts nobody and vetoes nothing', Object.keys(hs.veto).length === 0 && Object.keys(hs.suspects).length === 0 && hs.audited[hm] && hs.audited[hm].o === 0 && hs.audited[hm].so === 1);
    }
    // the highest score of a seat, not the first record's: the host's own record is the one over the cap
    const lm = keyOf(0x202), lg = group(0x202, 10, 15, (i) => (i === 0 ? [70000, 30000, 20000, 10000] : SC));
    const ls = fresh();
    const lx = sc.pendingOfGroup(ls, lm, lg.slice(1).concat([lg[0]]), { starts: startsOf(lm) });   // the high record read last
    if (lx) sc.applyAudit(ls, [lx], { m0: { cap: 60000 } }, new Set(), 1000);
    out.maxVeto = !!ls.veto[lm];
    if (!tag) T('[3] one record over the cap on its own seat (read last): vetoed (each seat\'s highest score)', out.maxVeto, JSON.stringify(ls.audited[lm]));
  }
  // ---- [4] ----
  {
    const m = keyOf(0x300), st = { audited: { [m]: { c: 1, s: 1, o: 0, t: 10, k: 'x' } }, chain: {}, veto: {}, suspects: {}, corrections: [] };
    const full = sc.knownAudit(st, m) && vv.seedcapKnowsKey(st, m);
    sc.pruneAudits(st, 10 + 1440 * 3, null);   // folds the day-old entry into st.seen
    const tok = !st.audited[m] && !!st.seen && sc.knownAudit(st, m) && vv.seedcapKnowsKey(st, m);
    const other = !sc.knownAudit(st, keyOf(0x301)) && !vv.seedcapKnowsKey(st, keyOf(0x301));
    const salted = JSON.parse(JSON.stringify(st)); salted.seen.s = 'zzzz';
    const salt = !sc.knownAudit(salted, m) && !vv.seedcapKnowsKey(salted, m);
    out.known = full && tok && other && salt;
    if (!tag) T('[4] seedcapKnowsKey = knownAudit: a full entry, its folded token, another key, a state of another salt', out.known, JSON.stringify({ full, tok, other, salt }));
    const H = 3600000, now = 100 * H, W = vv.SEAT_ONLY_AUDIT_WAIT_MS;
    const live = { audited: {}, cores: { k: { ts: Math.floor((now - H) / 60000) } } };
    const dead = { audited: {}, cores: { k: { ts: Math.floor((now - W - H) / 60000) } } };
    const g1 = vv.seatOnlyAuditGate(st, m, now - 10 * H, now) === null;
    const g2 = vv.seatOnlyAuditGate(live, m, now - 60000, now) === 'wait' && vv.seatOnlyAuditGate(dead, m, now - 60000, now) === 'wait';
    const g3 = vv.seatOnlyAuditGate(live, m, now - W - H, now) === 'wait';
    const g4 = vv.seatOnlyAuditGate(dead, m, now - W - H, now) === 'stalled' && vv.seatOnlyAuditGate(null, m, now - W - H, now) === 'stalled'
      && vv.seatOnlyAuditGate({ audited: { [keyOf(0x302)]: { e: 'x', t: Math.floor((now - 2 * H) / 60000) } } }, m, now - W - H, now) === 'wait';
    out.gate4 = g1 && g2 && g3 && g4;
    if (!tag) {
      T('[4] seatOnlyAuditGate: audited -> go on', g1);
      T('[4] not audited, waited less than ' + Math.round(W / H) + ' h -> wait (whatever the job did)', g2);
      T('[4] waited longer, but the job filed a verdict within that time -> still wait (it reads the shards; this one it cannot or will not)', g3);
      T('[4] waited longer and the job filed nothing that long (or there is no state) -> go on without it; an error audit of another key counts as a verdict', g4);
    }
  }
  return out;
}

console.log('=== Q418 round 2: the seed-cap audit of a held seat-only team segment ===');
const sc = require(path.join(ROOT, 'seedcap.js'));
// ---- [1] ----
{
  T('[1] STARTS_FILE: default starts.json (PROCESSED_FILE default processed.json)', sc.STARTS_FILE === 'starts.json');
  // every seedcap job's PROCESSED_FILE twin is the STARTS_FILE of the reconcile that reads the same SC_STATE_FILE
  const WF = path.join(ROOT, '.github', 'workflows');
  const stepsOf = (txt) => txt.split(/\n\s*- name:/).map((b) => { const o = {}; for (const mm of b.matchAll(/^\s+([A-Z][A-Z0-9_]+):\s*([^\s#]+)/gm)) o[mm[1]] = mm[2].replace(/^['"]|['"]$/g, ''); o.run = /node seedcap\.js/.test(b) ? 'seedcap' : /node validate\.js/.test(b) ? 'validate' : null; return o; });
  const all = [];
  for (const f of fs.readdirSync(WF)) if (/\.ya?ml$/.test(f)) for (const s of stepsOf(fs.readFileSync(path.join(WF, f), 'utf8'))) if (s.SC_STATE_FILE && s.run) all.push(Object.assign({ file: f }, s));
  const caps = all.filter((s) => s.run === 'seedcap'), recs = all.filter((s) => s.run === 'validate');
  const pairs = caps.map((c) => {
    const twin = c.STARTS_FILE || String(c.PROCESSED_FILE || 'processed.json').replace(/processed\.json$/, 'starts.json');
    const r = recs.filter((x) => x.SC_STATE_FILE === c.SC_STATE_FILE);
    return { sc: c.SC_STATE_FILE, twin, rec: r.map((x) => x.STARTS_FILE || 'starts.json') };
  });
  // 2026-11-20: seedcap.yml's playtest / demo twin jobs are retired (one seedcap job left, on the main channel) -> at least one
  //   job, and every job still pairs with the reconcile that reads its state file.
  T('[1] the workflows: ' + caps.length + ' seedcap jobs, each paired with its channel\'s reconcile', caps.length >= 1 && pairs.every((p) => p.rec.length >= 1), JSON.stringify(pairs));
  T('[1] each seedcap job reads the start rosters its channel\'s reconcile writes', pairs.every((p) => p.rec.every((x) => x === p.twin)), JSON.stringify(pairs));
}
const base = suite(sc, v, '');

// ---- [5] mutation self-checks ----
console.log('-- [5] mutation self-checks --');
function mutantModule(src, name, from, to) {
  if (src.split(from).length !== 2) return { anchor: false };
  const file = path.join(ROOT, '.mutant-' + name + '-' + process.pid + '.js');
  fs.writeFileSync(file, src.replace(from, to));
  return { anchor: true, file };
}
const SC_MUT = [
  ['the seat-only shape not read (round 1)', "          const so = side ? null : seatOnlyRecs(m, g, opt && opt.starts);   // Q418\n", '          const so = null;\n', (o) => !o.read],
  ['no seat gate (an outside record breaks the shape here)', "  const gated = g.filter((r) => r && r.d && ro[r.d[5] | 0] === v.pid(String(r.w || '')));\n", '  const gated = g;\n', (o) => !o.gate],
  ['the first record\'s scores, not each seat\'s highest', "    const scores = seatOnly ? d0.slice(10, 10 + pc).map((x, i) => Math.max.apply(null, g.map((r) => r.d[10 + i] | 0)))\n", '    const scores = seatOnly ? d0.slice(10, 10 + pc).map((x) => x | 0)\n', (o) => !o.maxVeto],
  ['the writers convictable', "out.self = [];", 'out.self = selfSeatsOf(all, roster);', (o) => !o.noConvict],
  ['the chain not extended from a seat-only audit', "        const selfSet2 = new Set(x.chainSelf || x.self || []);", '        const selfSet2 = new Set(x.self || []);', (o) => !o.chain && !o.bank],
  ['a correction from a seat-only audit', "      if (!obs && !x.so && corrSeats.length && processed.has(x.m)", '      if (!obs && corrSeats.length && processed.has(x.m)', (o) => !o.noConvict],
  ['pickAuditable drops the start rosters', "    const x = pendingOfGroup(st, m, groups[m], opt);\n", '    const x = pendingOfGroup(st, m, groups[m]);\n', (o) => !o.pick],
];
for (const [label, from, to, red] of SC_MUT) {
  const mu = mutantModule(SC_SRC, 'seat-only-seedcap', from, to);
  if (!mu.anchor) { T('[5] seedcap.js: ' + label + ': anchor found exactly once', false); continue; }
  try {
    const o = suite(require(mu.file), v, 'mut');
    T('[5] seedcap.js: ' + label + ' -> red', red(o), JSON.stringify(o));
  } catch (e) { T('[5] seedcap.js: ' + label + ' -> red (threw)', true); }
  finally { try { fs.unlinkSync(mu.file); } catch (e) {} }
}
// the reconcile half (validate.js copy; seedcap.js keeps the real one)
const V_MUT = [
  ['seedcapKnowsKey reads full entries only', "  if (!sn || typeof sn.h !== 'string' || w < 1) return false;\n", '  return false;\n', (o) => !o.known],
  ['the gate does not wait for a live job', "  if (nowMs - t0 < SEAT_ONLY_AUDIT_WAIT_MS || nowMs - seedcapLastVerdictMs(sc) < SEAT_ONLY_AUDIT_WAIT_MS) return 'wait';\n", "  if (nowMs - t0 < SEAT_ONLY_AUDIT_WAIT_MS) return 'wait';\n", (o) => !o.gate4],
  ['the gate does not wait at all', "  if (nowMs - t0 < SEAT_ONLY_AUDIT_WAIT_MS || nowMs - seedcapLastVerdictMs(sc) < SEAT_ONLY_AUDIT_WAIT_MS) return 'wait';\n", '', (o) => !o.gate4],
];
for (const [label, from, to, red] of V_MUT) {
  const mu = mutantModule(V_SRC, 'seat-only-validate', from, to);
  if (!mu.anchor) { T('[5] validate.js: ' + label + ': anchor found exactly once', false); continue; }
  try {
    const o = suite(sc, require(mu.file), 'mut');
    T('[5] validate.js: ' + label + ' -> red', red(o), JSON.stringify(o));
  } catch (e) { T('[5] validate.js: ' + label + ' -> red (threw)', true); }
  finally { try { fs.unlinkSync(mu.file); } catch (e) {} }
}
if (Object.values(base).some((x) => x !== true)) T('[5] the unmutated run is all true (the mutants are judged against it)', false, JSON.stringify(base));

console.log(failN ? ('FAIL x' + failN + ' (seat-only-seedcap)') : 'ALL OK (seat-only-seedcap)');
process.exit(failN ? 1 : 0);
