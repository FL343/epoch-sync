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
//                        through the shard records via the private ops tool).
//                        {n, t0, t1, ms}: n = cumulative convictions, t1 = latest.
//                        Attribution (2026-09-30): an over-cap seat convicts its
//                        account only when that account WROTE a record of the group
//                        from that very seat (the shard entry owner is the one
//                        unforgeable identity -- the reconcile's self-seat rule).
//                        A roster is self-reported: without this, anyone could write
//                        one fake over-cap record naming a stranger and open a reject
//                        window on them. Unattributed over-cap seats still veto the
//                        match (no settlement gain) and show up in the ops mail.
//                        Under SEEDCAP_REJECT the reconcile turns (n, t1) into a
//                        reject WINDOW (24h / 3d / 7d / 14d cap, validate.js
//                        seedcapRejectWindowMin): inside it the account's own
//                        settlement is discarded, other seats settle; past it the
//                        account settles again with no ops action (never permanent).
//   state.corrections[]  already-settled over-cap endless matches -> reconcile
//                        reverses the flagged seats' CP credit / board entry
//   state.chain[pid:pc:runSeed]  audited endless progress per RUN (endDepth -> cumulative cap)
//                        = the startBank bound for continuation sessions of that same run; only a seat
//                        whose own account wrote the record extends its chain (knife 3.5c2a-A, 2026-09-30:
//                        the old pid:pc key let a forged zero-score deep record lift the carry-in bound of
//                        EVERY later run of that account; legacy keys stay a read-only fallback for 7 days)
// Knife 3.5c2a-A (2026-09-30) audit fixes on the read side (KNIFE_35C2A §3.1):
//   - a guard-signed SOLO record is decoded through its own layout (attest.soloTail): the team-shaped
//     endlessTail read the solo record's keyId/attVer/opHash words as build / pick log / bitmap (O289)
//   - the build that caps a segment is the SEGMENT-START build, replayed from the pick log with the same
//     P.replay verifyPerkPicks uses (perks.buildAt); a session-level co-op record carries the per-draw
//     list (CLI `builds=` token, per level the max over the builds that could be in effect); a log that
//     does not replay is skipped (the reconcile's perk_forge already rejects it)
//   - a solo record names the package that signed it (keyId = buildNum): that package's registered core
//     answers it exactly (live.json window by buildNum), else the time-window selection as before
//   - capability probes read the CLI's "V" answer (no more cap-rise probe with a hard-coded build word)
// Failure discipline: a CLI ERR is "cannot cap" -> log and step aside
// (fail-open); flags only ever come from a computed cap the score exceeds.
// ============================================================
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const v = require('./validate.js');
const attest = require('./attest.js');
const perks = require('./perks.js');   // pick-log replay (segment-start build; same replay as the reconcile's perk_forge check)

const KEY = process.env.STEAM_PUBLISHER_KEY;
const APPID = process.env.APPID;
const PREFIX = process.env.LB_PREFIX;   // no default: the shard prefix is deployment config (de-identified repo)
const SC_STATE_FILE = process.env.SC_STATE_FILE || 'seedcap.json';
const PROCESSED_FILE = process.env.PROCESSED_FILE || 'processed.json';   // read-only (reconcile owns it)
const SIGNALS_FILE = process.env.SIGNALS_FILE || 'signals.json';         // read-only (reconcile owns it; carries applied-correction ids)
const SEEDCAP_CLI = process.env.SEEDCAP_CLI || './seedcap_cli.exe';
// Versioned world cores (2026-09-18): the artifact repo may carry one compiled core per world under
// cores/<id>/seedcap_cli.exe plus live.json = per-channel package windows [{buildNum, core, liveAt, gateAt}].
// A record carries no build number, so the core is picked by WHICH PACKAGE WAS LIVE when the group is
// audited (groups are audited once, within a tick or two of being written). Around a package switch both
// builds coexist (players mid-session on the previous build, the mandatory-update gate not raised yet):
// inside that overlap the previous window's core is consulted too and the cap is the MAX of the two --
// the same "uncertain branch takes the max" rule the cap itself is built on, so a score is over-cap only
// if NEITHER world could have produced it. Overlap = from the new window's liveAt until gateAt + grace
// (no gateAt recorded yet: capped at OVERLAP_MAX). No live.json / no channel / no window / core missing
// on disk -> the root CLI (SEEDCAP_CLI) exactly as before, so this reads older artifact layouts unchanged.
const SEEDCAP_DIST_DIR = process.env.SEEDCAP_DIST_DIR || path.dirname(SEEDCAP_CLI);
const SEEDCAP_CHANNEL = process.env.SEEDCAP_CHANNEL || '';
const OVERLAP_GRACE_MS = 12 * 3600 * 1000;
const OVERLAP_MAX_MS = 7 * 86400 * 1000;
const AUDITED_KEEP = Math.max(500, Number(process.env.SC_AUDITED_KEEP || 4000));
const VETO_KEEP_MIN = Math.max(1440, Number(process.env.SC_VETO_KEEP_MIN || 43200));   // 30d
const SUSPECT_MATCH_KEEP = 8;
// Permanent offense ledger + mass-anomaly alert (2026-09-01): the flag moment also
// (a) mirrors the per-account cumulative over-cap count onto a PRESERVE-class trusted
//     board (score = suspects[pid].n -- absolute, so a missed write self-heals on the
//     account's next flag; details carry the latest offense for analysis), and
// (b) mails the ops inbox when one run flags a wave (a wave usually means a
//     false-positive storm -- world-model drift after a content change -- not a cheat
//     wave) or the suspect roll keeps growing past the floor.
// Neither is gated by SEEDCAP_ENFORCE/REJECT: the analysis record must exist from the
// observation phase onward, ban or no ban.
const OFFENSE_LB = process.env.SC_OFFENSE_LB || 'seedcap_offense';
const OFFENSE_MAGIC = 0xC7;   // details: [magic, tMin, runSeed, mt, cap, claimedScore]
const SC_MAIL_MIN_OVER = Math.max(1, Number(process.env.SC_MAIL_MIN_OVER || 3));
const SC_MAIL_SUS_MIN = Math.max(1, Number(process.env.SC_MAIL_SUS_MIN || 5));

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
    // classic (nostalgia) run (2026-09-30): the segment flags carry SEG_CLASSIC (the flags word sits at the same
    // offset in the client team tail and in the guard-signed solo record), so the world core must replay the
    // classic board set (classic pool / curve / items, no slot coins) instead of the modern one. A classic run
    // has no perks and no rerolls by rule (the reconcile fails a non-zero build / pick log / bitmap closed as
    // 'classic-perk'), so both are forced to 0: the solo record keeps other words at those tail offsets.
    const classic = !!(tail && ((tail.flags | 0) & attest.SEG_CLASSIC));
    // perk build (2026-09-07 tail 7th int = the build at the END of the record; knife 3.5c2a-A: the cap uses the SEGMENT-START build
    //   replayed from the pick log -- a segment [sd, ed] earned its levels with the build after the draw at depth sd, and a satisfied
    //   contract / slot replacement can make the end build worth LESS than the start build [real playtest segment: 198k -> 142k cap]).
    //   Session-level co-op records (pc >= 2 without SEG_COMP: one record per session, a draw every DRAW_EVERY passed levels) also carry
    //   the per-draw list for the CLI's builds= token (unsupported core -> the end build as before, see cliLineOf). A log that does not
    //   replay = replayErr (pickAuditable skips the group; the reconcile rejects it as perk_forge).
    let build = 0, builds = null, buildEnd = 0, replayErr = null;
    if (!classic && tail) {
      buildEnd = (tail.build != null) ? (tail.build >>> 0) : 0;
      if (buildEnd || (tail.picksLo | 0) || (tail.picksHi | 0)) {
        const rb = perks.buildAt(tail, tail.startDepth | 0, pc);
        if (!rb.ok) replayErr = rb.reason + ':' + rb.why;
        else {
          build = rb.build >>> 0;
          if (pc >= 2 && !((tail.flags | 0) & attest.SEG_COMP)) {
            const rl = perks.buildsOf(tail, pc);
            if (!rl.ok) replayErr = rl.reason + ':' + rl.why;
            else if (rl.builds.length) builds = rl.builds;
          }
        }
      }
    }
    // seasonId (2026-09-05): the run's season snapshot from the record tail (5th int; -1 when the
    // record predates it) -- the world core replays the season-keyed boards exactly, so the cap is
    // per-run exact instead of a legacy runSeed-keyed replay.
    return { entry: 'endless', pc, startDepth: tail ? tail.startDepth | 0 : 0, endDepth: tail ? tail.endDepth | 0 : 0,
      seasonId: (tail && tail.seasonId != null) ? (tail.seasonId | 0) : -1,
      build, builds, buildEnd, replayErr,
      // endless affix reroll bitmap (2026-09-11, 10th/11th tail ints): rerolled depths derive their world with it (exact cap); absent = 0
      rerollLo: (!classic && tail && tail.rerollLo != null) ? (tail.rerollLo >>> 0) : 0,
      rerollHi: (!classic && tail && tail.rerollHi != null) ? (tail.rerollHi >>> 0) : 0,
      classic,
      // guard-signed solo record: the package (buildNum) that signed it -> exact core (attest.soloTail keyId; 0 = client-written / legacy)
      keyId: (tail && tail.keyId > 0) ? (tail.keyId | 0) : 0 };
  }
  if (base === 10) {
    // O140 private friend rooms (2026-09-01): world gen is entry-agnostic (same placeItems),
    // so the seed replay applies -- audited on the WIDEST room config (9 levels; rooms run
    // 3/6/9) and the verdict takes a gamble-round headroom multiplier (capMult, applied
    // post-CLI: the flat type-10 code hides whether the room ran mode-2 internally).
    // Generous fail-open envelope, same stance as the matchmade levels:6 constant; the
    // room's stake is XP-lite only, the value here is the offense/suspect SIGNAL (a
    // mathematically impossible vector self-reports the account, seedcap_offense lane).
    return { entry: 'quick', pc, ts: 0, isTeam: false, team2: false, levels: 9, teams: [], capMult: v.TEAM2.SCORE_MULT };
  }
  const ranked = base === 2 || base === 4 || base === 6 || base === 9;
  const team2 = base === 5 || base === 6 || base === 8 || base === 9;
  const isTeam = base === 3 || base === 4;
  const ts = (team2 || isTeam) ? v.teamSizeOfMt(mt) : 0;
  const teams = [];
  if (ts) for (let s = 0; s < pc; s++) teams.push(v.teamOfSeat(s, ts));
  return { entry: ranked ? 'ranked' : 'quick', pc, ts, isTeam, team2, levels: 6, teams };
}
// caps (knife 3.5c2a-A): { builds: bool } = the answering core reads the builds= token (cliSupportsBuilds); a session-level record on a
//   core without it falls back to the END-of-record build in the positional field (= the pre-3.5c2a-A line, no regression), with it the
//   positional field carries the segment-start build and the token the per-draw list
function cliLineOf(tag, p, runSeed, caps) {
  if (p.entry === 'endless') {
    const hasList = !!(p.builds && p.builds.length);
    const useList = hasList && !!(caps && caps.builds);
    const bdSrc = (hasList && !useList) ? (p.buildEnd >>> 0) : (p.build >>> 0);
    const listTok = useList ? (' builds=' + p.builds.map(b => b >>> 0).join(',')) : '';
    // 7th field = seasonId (>=0 season-keyed world); omitted for legacy records (-1) so the CLI takes its legacy path.
    // 8th field = perk build word (2026-09-07), positional after the season: a build on a legacy tail writes the -1
    //   season sentinel explicitly; build 0 is omitted (line unchanged for every pre-perk record).
    // 9th/10th fields = reroll bitmap lo/hi (2026-09-11), positional after the build: a bitmap forces the season (-1) and build (0) sentinels out explicitly;
    //   all-zero bitmap is omitted (line unchanged for every pre-reroll record).
    // 11th field = classic flag (2026-09-30), positional after the bitmap: a classic line writes every sentinel before
    //   it explicitly (season or -1, build, bitmap lo/hi) then 1; a non-classic line never carries it (unchanged).
    const bd = bdSrc || 0;
    const rl = (p.rerollLo >>> 0) || 0, rh = (p.rerollHi >>> 0) || 0, hasRr = !!(rl || rh);
    const cl = !!p.classic;
    const season = (p.seasonId != null && p.seasonId >= 0) ? (p.seasonId | 0) : ((bd || hasRr || cl) ? -1 : null);
    return 'E ' + tag + ' ' + (runSeed | 0) + ' ' + p.pc + ' ' + (p.startDepth | 0) + ' ' + (p.endDepth | 0) + ' ' + Math.round(p.startBank || 0) +
      (season != null ? (' ' + season) : '') + ((bd || hasRr || cl) ? (' ' + bd) : '') + ((hasRr || cl) ? (' ' + rl + ' ' + rh) : '') + (cl ? ' 1' : '') + listTok;
  }
  return 'C ' + tag + ' ' + (runSeed | 0) + ' ' + p.entry + ' ' + p.pc + ' ' + (p.ts | 0) + ' ' +
    (p.isTeam ? 1 : 0) + ' ' + (p.team2 ? 1 : 0) + ' ' + p.levels + ' ' + (p.teams && p.teams.length ? p.teams.join('') : '-');
}
// The build field is read only by a CLI built after 2026-09-07; an older CLI silently ignores it and returns the
//   build-0 cap, which would veto honest perk runs during the CLI rollout window. Not supported -> groups carrying a
//   build are deferred (left unaudited) until the CLI proves it reads the field. Knife 3.5c2a-A (2026-09-30): the probe
//   reads the "V" capability answer (build=1) like the other fields -- the old "cap must rise under perk id 2 lv 3"
//   probe pinned that perk's semantics (knife B changes it) and a table with a different clear-bonus perk would have
//   deferred every perk run forever.
function cliSupportsBuild(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\bbuild=1\b/.test(r.map.p0.v));
}
// The builds= per-draw list token (knife 3.5c2a-A) is read only by a CLI answering builds=1; without it a session-level co-op
//   record is capped with its end-of-record build as before (cliLineOf fallback) -- no deferral, no regression.
function cliSupportsBuilds(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\bbuilds=1\b/.test(r.map.p0.v));
}
// The reroll bitmap fields (2026-09-11) are read only by a CLI that answers the "V" capability probe with rerolls=1; an older CLI prints
//   ERR bad-kind for "V" (or nothing) and would silently drop the bitmap -> groups carrying one are deferred until the CLI is refreshed.
function cliSupportsRerolls(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\brerolls=1\b/.test(r.map.p0.v));
}
// The classic flag (11th E field, 2026-09-30) is read only by a CLI that answers "V" with classic=1; an older CLI would drop
//   it and cap a classic run against the modern world -> classic groups are deferred until the CLI proves it reads the field.
function cliSupportsClassic(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\bclassic=1\b/.test(r.map.p0.v));
}
// ---- versioned cores: window selection (pure) ----
// live = parsed live.json | null. Returns { primary: coreId|null, extra: [coreId], why } where null primary
// = use the root CLI. Windows are sorted by liveAt; the primary is the latest window already live at nowMs.
function selectCores(live, channel, nowMs) {
  const wins = ((live && live.channels && live.channels[channel]) || [])
    .map(w => ({ core: w && w.core ? String(w.core) : null, liveAt: Date.parse(w && w.liveAt), gateAt: (w && w.gateAt) ? Date.parse(w.gateAt) : NaN }))
    .filter(w => Number.isFinite(w.liveAt))
    .sort((a, b) => a.liveAt - b.liveAt);
  let ci = -1;
  for (let i = 0; i < wins.length; i++) if (wins[i].liveAt <= nowMs) ci = i;
  if (ci < 0) return { primary: null, extra: [], why: wins.length ? 'before-first-window' : 'no-window' };
  const cur = wins[ci];
  const extra = [];
  if (ci > 0) {
    const prev = wins[ci - 1];
    const hardEnd = cur.liveAt + OVERLAP_MAX_MS;
    const end = Number.isFinite(cur.gateAt) ? Math.min(hardEnd, cur.gateAt + OVERLAP_GRACE_MS) : hardEnd;
    // a previous window without a core (pre-core package) cannot be consulted; same core = nothing to add
    if (nowMs < end && prev.core && prev.core !== cur.core) extra.push(prev.core);
  }
  return { primary: cur.core, extra, why: extra.length ? 'overlap' : 'window' };
}
function corePathOf(distDir, core) { return path.join(distDir, 'cores', String(core), path.basename(SEEDCAP_CLI)); }
// Resolve the selection against the disk: [{ exe, label }] primary first. A selected core that is not on
// disk degrades to the root CLI (primary) or is dropped (extra) with a warning -- never a hard failure.
function resolveCores(sel, distDir, exists) {
  const has = exists || fs.existsSync;
  const out = [];
  if (sel.primary && has(corePathOf(distDir, sel.primary))) out.push({ exe: corePathOf(distDir, sel.primary), label: sel.primary });
  else {
    if (sel.primary) v.ghWarn('seedcap: core ' + sel.primary + ' selected for channel window but missing on disk -- root CLI used');
    out.push({ exe: SEEDCAP_CLI, label: 'root' });
  }
  for (const c of sel.extra) {
    if (has(corePathOf(distDir, c))) out.push({ exe: corePathOf(distDir, c), label: c });
    else v.ghWarn('seedcap: overlap core ' + c + ' missing on disk -- skipped (cap = primary core only)');
  }
  return out;
}
// Merge an overlap core's verdicts into the primary map: a group keeps the primary's verdict shape; when both
// cores produced a cap the larger one wins. An overlap-core ERR (or a group it was not asked) changes nothing.
function mergeCaps(primaryMap, extraMap) {
  for (const k of Object.keys(extraMap || {})) {
    const a = primaryMap[k], b = extraMap[k];
    if (a && a.cap != null && b && b.cap != null && b.cap > a.cap) primaryMap[k] = Object.assign({}, a, { cap: b.cap, via: 'overlap' });
  }
  return primaryMap;
}
function runCli(lines, exe) {
  const res = spawnSync(exe || SEEDCAP_CLI, [], { input: lines.join('\n') + '\n', maxBuffer: 1 << 24, encoding: 'utf8' });
  if ((res.status | 0) !== 0 || res.error) return { fail: 'exit=' + res.status + (res.error ? ' ' + res.error.message : '') };
  const map = {};
  let head = '';
  for (const L of String(res.stdout).trim().split('\n')) {
    const t = L.trim();
    if (t.startsWith('SEEDCAP ')) { head = t; continue; }
    let m = t.match(/^CAP (\S+) (-?\d+)/);
    if (m) { map[m[1]] = { cap: +m[2] }; continue; }
    m = t.match(/^ERR (\S+) (\S+)$/);
    if (m) { map[m[1]] = { err: m[2] }; continue; }
    m = t.match(/^V (\S+) (.*)$/);   // capability probe answer (2026-09-11)
    if (m) map[m[1]] = { v: m[2] };
  }
  return { map, head };
}

// endless continuation carry-in bound: best audited chain cap among the roster,
// else the pre-seedcap static bound at that depth (generous fail-open for chains
// that predate the audit -- exact from the first fully-audited session onward)
const chainKey = (pid, pc, runSeed) => pid + ':' + pc + ':' + (runSeed | 0);   // per run (knife 3.5c2a-A); legacy key = pid:pc
const CHAIN_LEGACY_KEEP_MIN = 7 * 1440;    // legacy pid:pc entries: read-only fallback for 7 days after the first run of this code, then pruned
const CHAIN_KEEP_MIN = 90 * 1440;          // per-run entries expire after 90 days (a run cannot be resumed past its save row's season anyway)
function chainStartBank(st, rosterPids, pc, startDepth, runSeed) {
  if ((startDepth | 0) <= 0) return 0;
  let best = 0;
  for (const p of rosterPids) {
    const c = st.chain[chainKey(p, pc, runSeed)] || st.chain[p + ':' + pc];   // this run's audited chain; legacy account-wide key as a transitional fallback
    if (c && (c.d | 0) >= (startDepth | 0) && c.cap > best) best = c.cap;
  }
  if (best > 0) return best;
  return Math.round(v.endlessGoalFor(startDepth | 0, pc) * v.ENDLESS.SCORE_MULT);
}
// tail of an endless record by its writer's layout: a guard-signed solo record (pc 1) has its own int layout (attest.soloTail; a pc=1
//   record that is not one falls back to the team-shaped read), everything else = the client team tail (validate.endlessTail)
function tailOf(d) {
  if ((d[8] | 0) === 1) { const t = attest.soloTail(d); if (t) return t; }
  return v.endlessTail(d);
}
// registered core of the package that signed a solo record (live.json window whose buildNum == keyId); null = unknown / pre-core package
function coreForBuildNum(live, channel, buildNum) {
  const wins = (live && live.channels && live.channels[channel]) || [];
  for (const w of wins) if (w && w.core && Number(w.buildNum) === Number(buildNum)) return String(w.core);
  return null;
}

// Seats whose account wrote one of the group's records from that very seat (writer = shard entry owner: r.w here,
//   r.steamID in the reconcile's record shape; the record's own seat = d[5]) -- the only seats a verdict may
//   convict. A record carrying no writer identity (synthetic input) proves nothing: fail closed.
function selfSeatsOf(g, roster) {
  const out = [];
  for (const seatKey of Object.keys(roster || {})) {
    const s = seatKey | 0, sid = String(roster[seatKey]);
    if (g.some(r => { const wr = r && (r.w || r.steamID); return !!wr && String(wr) === sid && !!r.d && ((r.d[5] | 0) === s); })) out.push(s);
  }
  return out.sort((a, b) => a - b);
}

// ---- pick auditable groups (consistent score vector; audited-once) ----
// groups: m -> [{d, roster, w}] (w = writing account); pure (reads st.audited/st.chain, mutates nothing)
function pickAuditable(st, groups) {
  const pending = [];
  for (const m of Object.keys(groups)) {
    if (st.audited[m]) continue;
    const g = groups[m];
    const d0 = g[0].d;
    const mt = d0[2] | 0, pc = d0[8] | 0, base = v.baseMt(mt);
    if (base < 1 || base > 10 || pc < 1 || pc > 8 || d0.length < 10 + pc) continue;   // 10 = O140 private (audited via capParamsOf); 11 = O156 bot matches excluded (record pc = humans only != world seat count -> no derivable cap; XP-only track, zero stakes)
    const vecOf = (d) => d.slice(10, 10 + pc).join(',');
    if (!g.every(r => vecOf(r.d) === vecOf(d0))) continue;   // forgery-suspect groups are the reconcile's own flag lane
    const scores = d0.slice(10, 10 + pc).map(x => x | 0);
    let tail = null;
    if (v.isEndlessMt(mt)) {
      // conservative tail: widest consistent interpretation (zero-tail abstention
      // rides along; a bigger depth range only ever RAISES the cap = fail-open)
      for (const r of g) {
        const t = tailOf(r.d);
        if (t && (!tail || (t.endDepth | 0) > (tail.endDepth | 0))) tail = t;
      }
      if (!tail || (tail.endDepth | 0) < (tail.startDepth | 0)) continue;
    }
    const p = capParamsOf(mt, pc, tail);
    const roster = v.rosterConsensus(g);
    const rosterPids = Object.keys(roster).map(s2 => v.pid(roster[s2]));
    const runSeed = d0[4] | 0;
    if (p.replayErr) { pending.push({ m, mt, pc, scores, p, tail, roster, self: [], runSeed, skip: 'perk-replay:' + p.replayErr }); continue; }   // forged pick log: not capped (reconcile perk_forge lane)
    if (p.entry === 'endless') p.startBank = chainStartBank(st, rosterPids, pc, p.startDepth, runSeed);
    pending.push({ m, mt, pc, scores, p, tail, roster, self: selfSeatsOf(g, roster), runSeed, keyId: (p.entry === 'endless' && p.keyId > 0) ? (p.keyId | 0) : 0 });
  }
  return pending;
}
// groups the pending list cannot audit (forged pick log): remembered as audited-with-error (fail-open, once), removed from the list
function takeSkips(st, pending, t) {
  const keep = [], skipped = [];
  for (const x of pending) {
    if (!x.skip) { keep.push(x); continue; }
    st.audited[x.m] = { e: x.skip, t };
    skipped.push(x);
    console.log('seedcap: SKIP ' + x.skip + ' m=' + x.m);
  }
  return { pending: keep, skipped };
}

// ---- apply CLI verdicts onto state (pure state-machine half; testable offline) ----
function applyAudit(st, pending, cliMap, processed, t) {
  let over = 0, okN = 0, errN = 0;
  const flags = [];   // runtime-only offense detail (sids never enter the public state file)
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
    const capEff = Math.round(r.cap * (x.p.capMult || 1));   // O140: private takes the gamble headroom post-CLI
    const overSeats = [];
    x.scores.forEach((sc, seat) => { if (sc > capEff) overSeats.push(seat); });
    st.audited[x.m] = { c: capEff, s: Math.max.apply(null, x.scores), o: overSeats.length ? 1 : 0, t };
    if (overSeats.length) {
      over++;
      // the veto (no settlement) and the correction (reverse a settled gain) stay on every over-cap seat; a
      //   CONVICTION (suspect ledger -> reject window, offense board) only on a self-written seat (selfSeatsOf)
      st.veto[x.m] = { t, seats: overSeats };
      const selfSet = new Set(x.self || []);
      const blamed = overSeats.filter(s2 => selfSet.has(s2) && x.roster[s2]);
      const unblamed = overSeats.filter(s2 => blamed.indexOf(s2) < 0);
      const nOf = {};
      for (const seat of blamed) {
        const sid = x.roster[seat];
        const p2 = v.pid(sid);
        const su = st.suspects[p2] = st.suspects[p2] || { n: 0, t0: t, ms: [] };
        su.n++; su.t1 = t;
        nOf[seat] = su.n;
        if (su.ms.indexOf(x.m) < 0) { su.ms.push(x.m); if (su.ms.length > SUSPECT_MATCH_KEEP) su.ms.shift(); }
      }
      if (processed.has(x.m) && x.p.entry === 'endless' && !st.corrections.some(c => c.m === x.m)) {
        st.corrections.push({ id: 'sc-' + x.m, m: x.m, seats: overSeats, t });
      }
      flags.push({
        m: x.m, t, runSeed: x.runSeed | 0, mt: x.mt | 0, cap: capEff | 0,
        offenders: blamed.map(s2 => ({ seat: s2, sid: String(x.roster[s2]), score: x.scores[s2] | 0, n: nOf[s2] | 0 })),
        unattributed: unblamed.map(s2 => ({ seat: s2, score: x.scores[s2] | 0 })),
      });
      // pids only in logs -- never sids (public run logs)
      console.log('::warning::seedcap OVER-CAP m=' + x.m + ' cap=' + capEff + ' scores=' + x.scores.join(',') +
        ' seats=' + overSeats.join(',') + ' pids=' + blamed.map(s2 => v.pid(x.roster[s2]).slice(0, 8)).join(',') +
        (unblamed.length ? ' unattributed=' + unblamed.join(',') + ' (not self-written)' : ''));
    } else {
      okN++;
      if (x.p.entry === 'endless') {
        // extend the audited chain of THIS run for every seat whose own account wrote the record (knife 3.5c2a-A: a forged
        //   zero-score deep record can only lift the chain of the run it forges, never the account's other runs; a stranger
        //   named in a roster gets nothing)
        const selfSet2 = new Set(x.self || []);
        for (const seatKey of Object.keys(x.roster)) {
          if (!selfSet2.has(seatKey | 0)) continue;
          const p2 = v.pid(x.roster[seatKey]);
          const k = chainKey(p2, x.pc, x.runSeed);
          const cur = st.chain[k];
          if (!cur || (x.tail.endDepth | 0) > (cur.d | 0)) st.chain[k] = { d: x.tail.endDepth | 0, cap: r.cap, t };
        }
      }
    }
  });
  return { over, okN, errN, flags };
}

// ---- offense-board mirror + anomaly mail (pure planners; IO stays at the call site) ----
function offensePlanOf(st, flags) {
  const plan = {};
  for (const f of flags || []) for (const o of (f.offenders || [])) {
    if (!o.sid) continue;
    const su = st.suspects[v.pid(o.sid)];
    plan[o.sid] = {
      score: su ? su.n | 0 : 1,   // absolute cumulative count = idempotent + self-healing
      details: [OFFENSE_MAGIC, f.t | 0, f.runSeed | 0, f.mt | 0, f.cap | 0, o.score | 0],
    };
  }
  return plan;
}
async function writeOffense(st, flags) {
  const plan = offensePlanOf(st, flags);
  const sids = Object.keys(plan);
  if (!sids.length) return;
  const bid = await v.findOrCreateBoard(OFFENSE_LB);   // trusted writes, global reads
  if (!bid) { v.ghWarn('seedcap: offense board unavailable -- count lives on in suspects state'); return; }
  for (const sid of sids) {
    const w = plan[sid];
    const res = await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', {
      key: KEY, appid: APPID, leaderboardid: bid, steamid: sid, score: w.score, scoremethod: 'ForceUpdate', format: 'json',
    }, w.details);
    if (res.ok) console.log('seedcap: offense ' + v.pid(sid).slice(0, 8) + ' n=' + w.score);
    else v.ghWarn('seedcap: offense write failed HTTP ' + res.status + ' (suspects state still keeps the count)');
  }
}
function mailDecision(newOver, suspectsTotal, lastMailedSus) {
  const reasons = [];
  if ((newOver | 0) >= SC_MAIL_MIN_OVER) reasons.push('over-cap x' + (newOver | 0) + ' in one run');
  let mailedSus = lastMailedSus | 0;
  if ((suspectsTotal | 0) >= SC_MAIL_SUS_MIN && (suspectsTotal | 0) > mailedSus) {
    reasons.push('suspect accounts now ' + (suspectsTotal | 0));
    mailedSus = suspectsTotal | 0;
  }
  return { send: reasons.length > 0, reasons, mailedSus };
}
// active reject windows right now (pure; pids only -- the mail goes to ops, sids come from the
// flags of THIS run only). Sorted by expiry so the soonest-to-clear account reads first.
function rejectWindowsOf(st, nowM) {
  const out = [];
  for (const p of Object.keys((st && st.suspects) || {})) {
    const su = st.suspects[p];
    if (!v.seedcapRejectActive(su, nowM)) continue;
    const until = v.seedcapRejectUntilMin(su);
    out.push({ pid: p, n: su.n | 0, until, leftMin: until - (nowM | 0) });
  }
  out.sort((a, b) => a.until - b.until || (a.pid < b.pid ? -1 : 1));
  return out;
}
const fmtMin = (m) => new Date((m | 0) * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
function alertMailText(reasons, flags, totals, windows) {
  const lines = ['seedcap anomaly alert: ' + reasons.join(' + '), ''];
  for (const f of flags || []) {
    lines.push('OVER m=' + f.m + ' mt=' + f.mt + ' seed=' + f.runSeed + ' cap=' + f.cap + '  ' +
      (f.offenders || []).map(o => 'seat' + o.seat + '=' + o.score + ' sid=' + (o.sid || '?') +
        (o.n ? (' n=' + o.n + ' window=' + Math.round(v.seedcapRejectWindowMin(o.n) / 60) + 'h') : '')).concat(
        (f.unattributed || []).map(u => 'seat' + u.seat + '=' + u.score + ' (not self-written: vetoed, nobody convicted)')).join(' | '));
  }
  lines.push('', 'totals: veto=' + (totals.veto | 0) + ' suspects=' + (totals.suspects | 0));
  lines.push('', 'reject windows now open (SEEDCAP_REJECT lever; ladder 24h / 3d / 7d / 14d by conviction count, never permanent;',
    'inside the window only the flagged account\'s own settlement is discarded, other seats settle):');
  if (windows && windows.length) {
    for (const w of windows) lines.push('  ' + w.pid.slice(0, 8) + ' n=' + w.n + ' until ' + fmtMin(w.until) + ' (' + Math.ceil(w.leftMin / 60) + 'h left)');
  } else lines.push('  (none)');
  lines.push('', 'A wave here usually means a false-positive storm (world-model drift after a content change),',
    'not a cheat wave -- audit before trusting the windows. The veto is flag-dont-settle and',
    'self-heals once a flag is cleared; a window clears on its own or early via the review tool.');
  return lines.join('\n');
}
async function sendAlertMail(reasons, flags, totals, windows) {
  const to = process.env.SC_MAIL_TO || process.env.FB_DIGEST_TO, apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return false;   // unconfigured -> decision stays pending (mailedSus not advanced)
  const text = alertMailText(reasons, flags, totals, windows);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FB_DIGEST_FROM || 'onboarding@resend.dev',
        to: [to],
        subject: (process.env.FB_DIGEST_TAG || '') + 'seedcap ALERT: ' + reasons.join(' + '),
        text,
      }),
    });
    if (!res.ok) { v.ghWarn('seedcap mail failed HTTP ' + res.status); return false; }
    return true;
  } catch (e) { v.ghWarn('seedcap mail threw: ' + (e && e.message)); return false; }
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
  // knife 3.5c2a-A chain hygiene: per-run entries expire (t stamped at write); legacy pid:pc entries (no t) stay readable for
  //   CHAIN_LEGACY_KEEP_MIN after the first run that saw them, then go in one sweep
  if (st.chain) {
    let legacyN = 0;
    for (const k of Object.keys(st.chain)) {
      const c = st.chain[k];
      if (k.split(':').length === 2) { legacyN++; continue; }
      if (c && c.t > 0 && tNow - (c.t | 0) > CHAIN_KEEP_MIN) delete st.chain[k];
    }
    if (legacyN) {
      if (!(st.chainLegacyT > 0)) st.chainLegacyT = tNow | 0;
      else if (tNow - (st.chainLegacyT | 0) > CHAIN_LEGACY_KEEP_MIN) { for (const k of Object.keys(st.chain)) if (k.split(':').length === 2) delete st.chain[k]; delete st.chainLegacyT; }
    } else if (st.chainLegacyT) delete st.chainLegacyT;
  }
}
// ---- shard read + CLI routing (shared by main() and tools/seedcap-reaudit.js; no state writes here) ----
async function readGroups() {
  const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (!lr.ok) return { fail: 'GetLeaderboardsForGame HTTP ' + lr.status };
  const boards = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []);
  const shardIds = [];
  for (const b of boards) {
    const n = String(b.name || b.Name);
    if (n.indexOf(PREFIX) === 0 && n.indexOf('test') < 0) shardIds.push({ id: b.id || b.Id, name: n });
  }
  // always read EVERY shard -- listing entry counts lag and lie (2026-08-21 lesson)
  const groups = {};
  let records = 0;
  for (const s of shardIds) {
    const rr = await v.readBoardAll(s.id, s.name);
    for (const e of rr.ents) {
      const d = v.decodeDetails(e.detailData);
      if (!d || d.length < 10 || d[0] !== 0xB1) continue;   // settle records only
      records++;
      const m = d[3] + '_' + d[4] + '_' + d[2];
      // w = the shard entry owner (unforgeable writer) -- the only identity a conviction may rest on (selfSeatsOf)
      (groups[m] = groups[m] || []).push({ d, roster: v.decodeRoster(d), w: String(e.steamID || '') });
    }
  }
  // one-shot pool recovery (validate.recoverPick, client knife 5.0i): the channel's reconcile settles the recovered solo
  //   segments, so its seedcap twin audits exactly the same filtered set (settle records only; read-only; inert past the date)
  const rc = v.loadRecover(v.RECOVER_FILE, SEEDCAP_CHANNEL, Date.now());
  if (rc) {
    const rows = await v.readRecoverRows(rc, boards);
    const got = v.recoverPick(rows, rc, attest.loadPubTable(path.join(__dirname, 'attest-keys.json')) || {});
    let kept = 0;
    for (const r of got.recs) {
      const m = r.d[3] + '_' + r.d[4] + '_' + r.d[2];
      if ((groups[m] || []).some(x => x.w === String(r.steamID))) continue;
      records++; kept++;
      (groups[m] = groups[m] || []).push({ d: r.d, roster: r.roster, w: String(r.steamID || '') });
    }
    console.log('seedcap: recover ' + kept + ' solo segment(s) from ' + rows.length + ' pool rows');
  }
  return { groups, shards: shardIds.length, records };
}
// which compiled world(s) answer this run: live.json channel window -> primary + overlap cores (root CLI when unregistered)
function coresForNow(distDir, channel, nowMs) {
  let live = null;
  try { live = JSON.parse(fs.readFileSync(path.join(distDir, 'live.json'), 'utf8')); } catch (e) {}
  const sel = (live && channel) ? selectCores(live, channel, nowMs) : { primary: null, extra: [], why: live ? 'no-channel' : 'no-live-json' };
  return { live, sel, cores: resolveCores(sel, distDir) };
}
// Run the CLI over a pending list: capability deferrals on the primary, overlap cores (cap = max), then the EXACT core of every
//   guard-signed solo record whose package is registered (keyId -> live.json buildNum -> core on disk): its verdict replaces the
//   primary/overlap one (the world that signed the record is known, nothing to envelope). Returns { pending (audited subset), map }.
function auditPending(pendingIn, ctx) {
  const cores = ctx.cores, live = ctx.live, channel = ctx.channel, distDir = ctx.distDir;
  const runOf = (exe) => (lines) => runCli(lines, exe);
  const runPrimary = runOf(cores[0].exe);
  let pending = pendingIn;
  const out = { pending: [], map: {}, deferred: 0, exact: 0, head: '' };
  if (pending.some(x => x.p && (x.p.rerollLo || x.p.rerollHi)) && !cliSupportsRerolls(runPrimary)) {
    const n = pending.length;
    pending = pending.filter(x => !(x.p && (x.p.rerollLo || x.p.rerollHi)));
    console.log('seedcap: CLI ignores the reroll bitmap fields -- ' + (n - pending.length) + ' reroll groups deferred until the CLI is refreshed');
  }
  if (pending.some(x => x.p && x.p.build) && !cliSupportsBuild(runPrimary)) {
    const n = pending.length;
    pending = pending.filter(x => !(x.p && x.p.build));
    console.log('seedcap: CLI ignores the perk build field -- ' + (n - pending.length) + ' perk groups deferred until the CLI is refreshed');
  }
  if (pending.some(x => x.p && x.p.classic) && !cliSupportsClassic(runPrimary)) {
    const n = pending.length;
    pending = pending.filter(x => !(x.p && x.p.classic));
    console.log('seedcap: CLI ignores the classic flag -- ' + (n - pending.length) + ' classic groups deferred until the CLI is refreshed');
  }
  out.deferred = pendingIn.length - pending.length;
  out.pending = pending;
  if (!pending.length) return out;
  const capsPrimary = { builds: cliSupportsBuilds(runPrimary) };
  const res = runPrimary(pending.map((x, i) => cliLineOf('m' + i, x.p, x.runSeed, capsPrimary)));
  if (res.fail) return Object.assign(out, { fail: 'CLI run failed ' + res.fail });
  out.head = res.head;
  // overlap cores: each answers only the groups it can read (capability probes per core); a failed overlap run
  //   costs nothing but the extra headroom (the primary verdicts stand)
  for (const c of cores.slice(1)) {
    const run = runOf(c.exe);
    const okRr = cliSupportsRerolls(run), okBuild = cliSupportsBuild(run), okCl = cliSupportsClassic(run), caps = { builds: cliSupportsBuilds(run) };
    const lines = [];
    pending.forEach((x, i) => {
      if (!okRr && x.p && (x.p.rerollLo || x.p.rerollHi)) return;
      if (!okBuild && x.p && x.p.build) return;
      if (!okCl && x.p && x.p.classic) return;
      lines.push(cliLineOf('m' + i, x.p, x.runSeed, caps));
    });
    if (!lines.length) continue;
    const r2 = run(lines);
    if (r2.fail) { v.ghWarn('seedcap: overlap core ' + c.label + ' run failed ' + r2.fail + ' -- primary caps stand'); continue; }
    mergeCaps(res.map, r2.map);
  }
  // exact core by keyId (solo records): grouped per core exe; a core that cannot read a field skips that line (primary verdict stands)
  const exactOf = new Map();
  pending.forEach((x, i) => {
    if (!(x.keyId > 0) || !live || !channel) return;
    const c = coreForBuildNum(live, channel, x.keyId);
    if (!c || c === cores[0].label) return;
    const exe = corePathOf(distDir, c);
    if (!fs.existsSync(exe)) return;
    if (!exactOf.has(exe)) exactOf.set(exe, { label: c, idx: [] });
    exactOf.get(exe).idx.push(i);
  });
  for (const [exe, ex] of exactOf) {
    const run = runOf(exe);
    const okRr = cliSupportsRerolls(run), okBuild = cliSupportsBuild(run), okCl = cliSupportsClassic(run), caps = { builds: cliSupportsBuilds(run) };
    const lines = [];
    for (const i of ex.idx) {
      const x = pending[i];
      if (!okRr && x.p && (x.p.rerollLo || x.p.rerollHi)) continue;
      if (!okBuild && x.p && x.p.build) continue;
      if (!okCl && x.p && x.p.classic) continue;
      lines.push(cliLineOf('m' + i, x.p, x.runSeed, caps));
    }
    if (!lines.length) continue;
    const r3 = run(lines);
    if (r3.fail) { v.ghWarn('seedcap: exact core ' + ex.label + ' run failed ' + r3.fail + ' -- window caps stand'); continue; }
    for (const k of Object.keys(r3.map)) { if (r3.map[k] && r3.map[k].cap != null) { res.map[k] = Object.assign({}, r3.map[k], { via: 'exact:' + ex.label }); out.exact++; } }
  }
  out.map = res.map;
  return out;
}

async function main() {
  if (!KEY || !APPID || !PREFIX) { console.log('::error::seedcap: STEAM_PUBLISHER_KEY/APPID/LB_PREFIX unset'); process.exit(1); }
  if (!fs.existsSync(SEEDCAP_CLI)) { console.log('::error::seedcap: CLI missing at ' + SEEDCAP_CLI); process.exit(1); }   // root copy = the fallback for every selection miss
  const st = loadState();
  st.audited = st.audited || {};
  st.chain = st.chain || {};
  st.suspects = st.suspects || {};
  st.veto = st.veto || {};
  st.corrections = st.corrections || [];
  const processed = new Set(loadJsonArr(PROCESSED_FILE));
  const signals = loadJsonObj(SIGNALS_FILE);
  const applied = new Set((signals && signals.seedcapApplied) || []);

  const rg = await readGroups();
  if (rg.fail) { console.log('::error::seedcap: ' + rg.fail); process.exit(1); }
  const groups = rg.groups;

  // versioned cores: which compiled world(s) answer this run (root CLI when the artifact repo has no live.json yet)
  const cf = coresForNow(SEEDCAP_DIST_DIR, SEEDCAP_CHANNEL, Date.now());
  const cores = cf.cores, sel = cf.sel;
  console.log('seedcap: cores channel=' + (SEEDCAP_CHANNEL || '-') + ' primary=' + cores[0].label +
    (cores.length > 1 ? ' overlap=' + cores.slice(1).map(c => c.label).join(',') : '') + ' (' + sel.why + ')');

  const picked = takeSkips(st, pickAuditable(st, groups), nowMin());
  let stats = { over: 0, okN: 0, errN: 0, flags: [] };
  let audited = { pending: [], map: {}, deferred: 0, exact: 0, head: '' };
  if (picked.pending.length) {
    audited = auditPending(picked.pending, { cores, live: cf.live, channel: SEEDCAP_CHANNEL, distDir: SEEDCAP_DIST_DIR });
    if (audited.fail) { console.log('::error::seedcap: ' + audited.fail); process.exit(1); }
    if (audited.pending.length) {
      console.log('seedcap: ' + audited.head + ' auditing ' + audited.pending.length + ' groups' + (audited.exact ? ' (' + audited.exact + ' solo records on the core of the package that signed them)' : ''));
      stats = applyAudit(st, audited.pending, audited.map, processed, nowMin());
    }
  }
  if (stats.flags && stats.flags.length) await writeOffense(st, stats.flags);
  const md = mailDecision(stats.over, Object.keys(st.suspects).length, st.mailSus | 0);
  if (md.send && await sendAlertMail(md.reasons, stats.flags,
      { veto: Object.keys(st.veto).length, suspects: Object.keys(st.suspects).length }, rejectWindowsOf(st, nowMin()))) {
    st.mailSus = md.mailedSus;   // advance only on a delivered mail (failed send retries next run)
    console.log('seedcap: anomaly mail sent (' + md.reasons.join(' + ') + ')');
  }
  pruneState(st, applied, nowMin());
  saveState(st);
  console.log('seedcap: done groups=' + Object.keys(groups).length + ' audited-now=' + audited.pending.length + ' skipped=' + picked.skipped.length + ' deferred=' + audited.deferred +
    ' ok=' + stats.okN + ' over=' + stats.over + ' err=' + stats.errN + ' veto=' + Object.keys(st.veto).length +
    ' suspects=' + Object.keys(st.suspects).length + ' corrections=' + st.corrections.length);
}

module.exports = { selectCores, resolveCores, mergeCaps, corePathOf, OVERLAP_GRACE_MS, OVERLAP_MAX_MS, cliSupportsRerolls, cliSupportsClassic, cliSupportsBuilds, capParamsOf, cliLineOf, cliSupportsBuild, chainKey, chainStartBank, tailOf, coreForBuildNum, selfSeatsOf, pickAuditable, takeSkips, applyAudit, pruneState, readGroups, coresForNow, auditPending, runCli, loadState, saveState, SC_STATE_FILE, AUDITED_KEEP, VETO_KEEP_MIN, CHAIN_LEGACY_KEEP_MIN, CHAIN_KEEP_MIN, offensePlanOf, writeOffense, mailDecision, sendAlertMail, alertMailText, rejectWindowsOf, OFFENSE_LB, OFFENSE_MAGIC, SC_MAIL_MIN_OVER, SC_MAIL_SUS_MIN };
if (require.main === module) {
  main().catch(e => { console.log('::error::seedcap run failed: ' + (e && e.stack || e)); process.exit(1); });
}
