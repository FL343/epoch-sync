#!/usr/bin/env node
'use strict';
// ============================================================
// seedcap.js -- per-seed score-cap audit (O124 / knife-9 of the sidecar plan).
// ============================================================
// Post-hoc auditor, its own workflow OUTSIDE the reconcile tick (feedback.yml
// precedent: disjoint state file -> bot pushes rebase cleanly past each other).
// The reconcile stays fast; this job replays every settled/pending match's SEED
// through a compiled world-model CLI (built in the private repo -- generation
// logic and data tables never appear here in source form; the workflow fetches
// bytes via a read-only deploy key) and derives the mathematical upper bound of
// any single seat's score for that seed: field value + mystery-bag max rolls +
// clear bonuses + the classic slot shared-reel compounding (deterministic per
// seed) + max-multiplier envelopes for guard-entropy rolls. Every unknowable
// branch takes MAX, so a score above the cap is causally impossible for an
// honest client -- moderation evidence standard: causal contradiction, not
// statistical anomaly.
//
// Outputs (all consumed by validate.js on ITS next tick -- the reconcile stays
// the only writer of game boards; enforcement is gated by SEEDCAP_ENFORCE /
// SEEDCAP_REJECT env there, observe-first discipline):
//   state.veto[m]        over-cap match keys -> reconcile flags instead of
//                        settling (self-healing: clearing the veto lets the
//                        still-unprocessed match settle later)
//   state.suspects[pid]  pseudonymous repeat-offender ledger (moderation layer;
//                        sids never enter this public state -- resolution goes
//                        through the shard records via the private ops tool)
//   state.corrections[]  already-settled over-cap endless matches -> reconcile
//                        reverses the flagged seats' CP credit / board entry
//   state.chain[pid:pc]  audited endless progress (endDepth -> cumulative cap)
//                        = the startBank bound for continuation sessions
// Failure discipline: a CLI ERR is "cannot cap" -> log and step aside
// (fail-open); flags only ever come from a computed cap the score exceeds.
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const v = require('./validate.js');

const KEY = process.env.STEAM_PUBLISHER_KEY;
const APPID = process.env.APPID;
const PREFIX = process.env.LB_PREFIX;   // no default: the shard prefix is deployment config (de-identified repo)
const SC_STATE_FILE = process.env.SC_STATE_FILE || 'seedcap.json';
const PROCESSED_FILE = process.env.PROCESSED_FILE || 'processed.json';   // read-only (reconcile owns it)
const SIGNALS_FILE = process.env.SIGNALS_FILE || 'signals.json';         // read-only (reconcile owns it; carries applied-correction ids)
const SEEDCAP_CLI = process.env.SEEDCAP_CLI || './seedcap_cli.exe';
const AUDITED_KEEP = Math.max(500, Number(process.env.SC_AUDITED_KEEP || 4000));
const VETO_KEEP_MIN = Math.max(1440, Number(process.env.SC_VETO_KEEP_MIN || 43200));   // 30d
const SUSPECT_MATCH_KEEP = 8;

const nowMin = () => Math.floor(Date.now() / 60000);

function loadState() {
  try { return JSON.parse(fs.readFileSync(SC_STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(st) {
  // pids/match-keys/numbers only -- ASCII by construction; keep the asciiJson
  // discipline anyway (feedback.js hard lesson: no raw player text in public state)
  const json = JSON.stringify(st).replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(SC_STATE_FILE, json + '\n');
}
function loadJsonArr(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return []; } }
function loadJsonObj(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; } }

// mt -> cap params (the private repo's fixture generator is the reference twin;
// baseMt/teamSizeOfMt/teamOfSeat come from validate.js = the settlement's own truth)
function capParamsOf(mt, pc, tail) {
  const base = v.baseMt(mt);
  if (base === 7) {
    return { entry: 'endless', pc, startDepth: tail ? tail.startDepth | 0 : 0, endDepth: tail ? tail.endDepth | 0 : 0 };
  }
  const ranked = base === 2 || base === 4 || base === 6 || base === 9;
  const team2 = base === 5 || base === 6 || base === 8 || base === 9;
  const isTeam = base === 3 || base === 4;
  const ts = (team2 || isTeam) ? v.teamSizeOfMt(mt) : 0;
  const teams = [];
  if (ts) for (let s = 0; s < pc; s++) teams.push(v.teamOfSeat(s, ts));
  return { entry: ranked ? 'ranked' : 'quick', pc, ts, isTeam, team2, levels: 6, teams };
}
function cliLineOf(tag, p, runSeed) {
  if (p.entry === 'endless') {
    return 'E ' + tag + ' ' + (runSeed | 0) + ' ' + p.pc + ' ' + (p.startDepth | 0) + ' ' + (p.endDepth | 0) + ' ' + Math.round(p.startBank || 0);
  }
  return 'C ' + tag + ' ' + (runSeed | 0) + ' ' + p.entry + ' ' + p.pc + ' ' + (p.ts | 0) + ' ' +
    (p.isTeam ? 1 : 0) + ' ' + (p.team2 ? 1 : 0) + ' ' + p.levels + ' ' + (p.teams && p.teams.length ? p.teams.join('') : '-');
}
function runCli(lines) {
  const res = spawnSync(SEEDCAP_CLI, [], { input: lines.join('\n') + '\n', maxBuffer: 1 << 24, encoding: 'utf8' });
  if ((res.status | 0) !== 0 || res.error) return { fail: 'exit=' + res.status + (res.error ? ' ' + res.error.message : '') };
  const map = {};
  let head = '';
  for (const L of String(res.stdout).trim().split('\n')) {
    const t = L.trim();
    if (t.startsWith('SEEDCAP ')) { head = t; continue; }
    let m = t.match(/^CAP (\S+) (-?\d+)/);
    if (m) { map[m[1]] = { cap: +m[2] }; continue; }
    m = t.match(/^ERR (\S+) (\S+)$/);
    if (m) map[m[1]] = { err: m[2] };
  }
  return { map, head };
}

// endless continuation carry-in bound: best audited chain cap among the roster,
// else the pre-seedcap static bound at that depth (generous fail-open for chains
// that predate the audit -- exact from the first fully-audited session onward)
function chainStartBank(st, rosterPids, pc, startDepth) {
  if ((startDepth | 0) <= 0) return 0;
  let best = 0;
  for (const p of rosterPids) {
    const c = st.chain[p + ':' + pc];
    if (c && (c.d | 0) >= (startDepth | 0) && c.cap > best) best = c.cap;
  }
  if (best > 0) return best;
  return Math.round(v.endlessGoalFor(startDepth | 0, pc) * v.ENDLESS.SCORE_MULT);
}

// ---- pick auditable groups (consistent score vector; audited-once) ----
// groups: m -> [{d, roster}]; pure (reads st.audited/st.chain, mutates nothing)
function pickAuditable(st, groups) {
  const pending = [];
  for (const m of Object.keys(groups)) {
    if (st.audited[m]) continue;
    const g = groups[m];
    const d0 = g[0].d;
    const mt = d0[2] | 0, pc = d0[8] | 0, base = v.baseMt(mt);
    if (base < 1 || base > 9 || pc < 1 || pc > 8 || d0.length < 10 + pc) continue;
    const vecOf = (d) => d.slice(10, 10 + pc).join(',');
    if (!g.every(r => vecOf(r.d) === vecOf(d0))) continue;   // forgery-suspect groups are the reconcile's own flag lane
    const scores = d0.slice(10, 10 + pc).map(x => x | 0);
    let tail = null;
    if (v.isEndlessMt(mt)) {
      // conservative tail: widest consistent interpretation (zero-tail abstention
      // rides along; a bigger depth range only ever RAISES the cap = fail-open)
      for (const r of g) {
        const t = v.endlessTail(r.d);
        if (!tail || (t.endDepth | 0) > (tail.endDepth | 0)) tail = t;
      }
      if (!tail || (tail.endDepth | 0) < (tail.startDepth | 0)) continue;
    }
    const p = capParamsOf(mt, pc, tail);
    const roster = v.rosterConsensus(g);
    const rosterPids = Object.keys(roster).map(s2 => v.pid(roster[s2]));
    if (p.entry === 'endless') p.startBank = chainStartBank(st, rosterPids, pc, p.startDepth);
    pending.push({ m, mt, pc, scores, p, tail, roster, runSeed: d0[4] | 0 });
  }
  return pending;
}

// ---- apply CLI verdicts onto state (pure state-machine half; testable offline) ----
function applyAudit(st, pending, cliMap, processed, t) {
  let over = 0, okN = 0, errN = 0;
  pending.forEach((x, i) => {
    const r = cliMap['m' + i];
    if (!r) { errN++; st.audited[x.m] = { e: 'no-out', t }; return; }
    if (r.err != null) {
      // cannot cap = step aside (fail-open); remember so a structurally bad
      // record does not loop forever -- reconcile sanity owns that lane
      errN++; st.audited[x.m] = { e: r.err, t };
      console.log('seedcap: ERR ' + r.err + ' m=' + x.m);
      return;
    }
    const overSeats = [];
    x.scores.forEach((sc, seat) => { if (sc > r.cap) overSeats.push(seat); });
    st.audited[x.m] = { c: r.cap, s: Math.max.apply(null, x.scores), o: overSeats.length ? 1 : 0, t };
    if (overSeats.length) {
      over++;
      st.veto[x.m] = { t, seats: overSeats };
      for (const seat of overSeats) {
        const sid = x.roster[seat];
        if (!sid) continue;
        const p2 = v.pid(sid);
        const su = st.suspects[p2] = st.suspects[p2] || { n: 0, t0: t, ms: [] };
        su.n++; su.t1 = t;
        if (su.ms.indexOf(x.m) < 0) { su.ms.push(x.m); if (su.ms.length > SUSPECT_MATCH_KEEP) su.ms.shift(); }
      }
      if (processed.has(x.m) && x.p.entry === 'endless' && !st.corrections.some(c => c.m === x.m)) {
        st.corrections.push({ id: 'sc-' + x.m, m: x.m, seats: overSeats, t });
      }
      // pids only in logs -- never sids (public run logs)
      console.log('::warning::seedcap OVER-CAP m=' + x.m + ' cap=' + r.cap + ' scores=' + x.scores.join(',') +
        ' seats=' + overSeats.join(',') + ' pids=' + overSeats.map(s2 => x.roster[s2] ? v.pid(x.roster[s2]).slice(0, 8) : '?').join(','));
    } else {
      okN++;
      if (x.p.entry === 'endless') {
        // extend audited chains for every rostered seat (per-seat carry bound)
        for (const seatKey of Object.keys(x.roster)) {
          const p2 = v.pid(x.roster[seatKey]);
          const k = p2 + ':' + x.pc;
          const cur = st.chain[k];
          if (!cur || (x.tail.endDepth | 0) > (cur.d | 0)) st.chain[k] = { d: x.tail.endDepth | 0, cap: r.cap };
        }
      }
    }
  });
  return { over, okN, errN };
}

// ---- prune (state stays bounded) ----
function pruneState(st, applied, tNow) {
  const audKeys = Object.keys(st.audited);
  if (audKeys.length > AUDITED_KEEP) {
    audKeys.sort((a, b) => (st.audited[a].t | 0) - (st.audited[b].t | 0));
    for (const k of audKeys.slice(0, audKeys.length - AUDITED_KEEP)) delete st.audited[k];
  }
  for (const m of Object.keys(st.veto)) if (tNow - (st.veto[m].t | 0) > VETO_KEEP_MIN) delete st.veto[m];
  st.corrections = st.corrections.filter(c => !applied.has(c.id));
}

async function main() {
  if (!KEY || !APPID || !PREFIX) { console.log('::error::seedcap: STEAM_PUBLISHER_KEY/APPID/LB_PREFIX unset'); process.exit(1); }
  if (!fs.existsSync(SEEDCAP_CLI)) { console.log('::error::seedcap: CLI missing at ' + SEEDCAP_CLI); process.exit(1); }
  const st = loadState();
  st.audited = st.audited || {};
  st.chain = st.chain || {};
  st.suspects = st.suspects || {};
  st.veto = st.veto || {};
  st.corrections = st.corrections || [];
  const processed = new Set(loadJsonArr(PROCESSED_FILE));
  const signals = loadJsonObj(SIGNALS_FILE);
  const applied = new Set((signals && signals.seedcapApplied) || []);

  const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (!lr.ok) { console.log('::error::seedcap: GetLeaderboardsForGame HTTP ' + lr.status); process.exit(1); }
  const boards = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []);
  const shardIds = [];
  for (const b of boards) {
    const n = String(b.name || b.Name);
    if (n.indexOf(PREFIX) === 0 && n.indexOf('test') < 0) shardIds.push({ id: b.id || b.Id, name: n });
  }
  // always read EVERY shard -- listing entry counts lag and lie (2026-08-21 lesson)
  const groups = {};
  for (const s of shardIds) {
    const rr = await v.readBoardAll(s.id, s.name);
    for (const e of rr.ents) {
      const d = v.decodeDetails(e.detailData);
      if (!d || d.length < 10 || d[0] !== 0xB1) continue;   // settle records only
      const m = d[3] + '_' + d[4] + '_' + d[2];
      (groups[m] = groups[m] || []).push({ d, roster: v.decodeRoster(d) });
    }
  }

  const pending = pickAuditable(st, groups);
  let stats = { over: 0, okN: 0, errN: 0 };
  if (pending.length) {
    const res = runCli(pending.map((x, i) => cliLineOf('m' + i, x.p, x.runSeed)));
    if (res.fail) { console.log('::error::seedcap: CLI run failed ' + res.fail); process.exit(1); }
    console.log('seedcap: ' + res.head + ' auditing ' + pending.length + ' groups');
    stats = applyAudit(st, pending, res.map, processed, nowMin());
  }
  pruneState(st, applied, nowMin());
  saveState(st);
  console.log('seedcap: done groups=' + Object.keys(groups).length + ' audited-now=' + pending.length +
    ' ok=' + stats.okN + ' over=' + stats.over + ' err=' + stats.errN + ' veto=' + Object.keys(st.veto).length +
    ' suspects=' + Object.keys(st.suspects).length + ' corrections=' + st.corrections.length);
}

module.exports = { capParamsOf, cliLineOf, chainStartBank, pickAuditable, applyAudit, pruneState, runCli, loadState, saveState, SC_STATE_FILE, AUDITED_KEEP, VETO_KEEP_MIN };
if (require.main === module) {
  main().catch(e => { console.log('::error::seedcap run failed: ' + (e && e.stack || e)); process.exit(1); });
}
