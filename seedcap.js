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
//                        deletes the flagged seats' board entries (only while they still
//                        carry that match's score); XP, milestone CP and debits stand
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
const trustLedger = require('./trust-ledger.js');   // O198 v1 (knife 5.5b-1): conviction events queued for the reconcile's trust ledger

const KEY = process.env.STEAM_PUBLISHER_KEY;
const APPID = process.env.APPID;
const PREFIX = process.env.LB_PREFIX;   // no default: the shard prefix is deployment config (de-identified repo)
const SC_STATE_FILE = process.env.SC_STATE_FILE || 'seedcap.json';
const PROCESSED_FILE = process.env.PROCESSED_FILE || 'processed.json';   // read-only (reconcile owns it)
const SIGNALS_FILE = process.env.SIGNALS_FILE || 'signals.json';         // read-only (reconcile owns it; carries applied-correction ids)
// O198 v1 trust ledger (knife 5.5b-1): every conviction is also queued in this file's `events` (ids from `evSeq`); the reconcile
//   takes them into ITS trust.json and keeps the last id it took there (`taken.seedcap`) -- read back here to prune the queue
//   (the O124 seedcapApplied handshake: each side writes only its own file)
const TRUST_FILE = process.env.TRUST_FILE || 'trust.json';               // read-only (reconcile owns it)
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
// knife 5.10a: perk candidate rules dispatch (EA = rules v2, playtest / demo = v1). Never v.KEY_CHANNEL: the seedcap jobs set no PT_MODE,
//   so it reads 'ea' on every job (demo / playtest logs would replay with v2 and skip capping). Empty = v1 (conservative).
const PERK_CH = SEEDCAP_CHANNEL || 'playtest';
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
// O198 v1 (knife 5.5b-1 S2): per world core over-cap rate. A wave on ONE core in a day looks like our cap bug (the core
//   missed a scoring source), not a cheat wave: mail when its last 24 h reach SC_RATE_PERMIL / 1000 over-cap with at least
//   SC_RATE_MIN_OVER over-cap groups (once per core per day). Hourly buckets, a week kept (st.cores[k].h).
const SC_RATE_PERMIL = Math.max(1, Number(process.env.SC_RATE_PERMIL || 50));
const SC_RATE_MIN_OVER = Math.max(1, Number(process.env.SC_RATE_MIN_OVER || 3));
const CORE_HOURS_KEEP = 7 * 24;
// O198 v1 (S2): automatic reversal. When the primary world core changes (a new package's core goes live), every conviction
//   of the last REPLAY_DAYS made on another core is re-audited on the new one (with the usual overlap max); a self-written
//   seat the new cap no longer exceeds was a cap bug -> the conviction is marked false (su.fp / su.fpm; the reconcile's window
//   reads n - fp), the trust ledger gets an fp event, the mail says so. The veto is not lifted (that match settled for the
//   others long ago); n stays (the permanent count). Once per (match, core): audited[m].rk.
const REPLAY_DAYS = 14;
const REPLAY_MAX = Math.max(1, Number(process.env.SC_REPLAY_MAX || 100));
const CONVICTION_KEEP = 8;   // su.cv / su.fpm: the latest convictions [m, t] and the reversed match keys
// O285 (1) observation window (knife 5.5b-1 S4, user 2026-10-23): a world core is new for SC_OBS_H hours after it first went
//   live in this channel (the earliest live.json window naming it, else the first run that filed a verdict under it), or until
//   SC_OBS_N honest audits ran on it, whichever comes first. Inside it an over-cap group is still VETOED (it settles for
//   nobody: no one gains), but nobody is convicted -- no suspect count, no reject window, no shadow-pool bit, no offense row,
//   no endless correction (a new core's cap bug would otherwise land on honest players); the ledger gets an observation
//   record (sev 0) and the mail goes out at once (once per core per day). Past it the core enforces with no ops action.
const SC_OBS_H = Math.max(0, Number(process.env.SC_OBS_H != null ? process.env.SC_OBS_H : 72));
const SC_OBS_N = Math.max(0, Number(process.env.SC_OBS_N != null ? process.env.SC_OBS_N : 200));

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
        const rb = perks.buildAt(tail, tail.startDepth | 0, pc, PERK_CH);
        if (!rb.ok) replayErr = rb.reason + ':' + rb.why;
        else {
          build = rb.build >>> 0;
          if (pc >= 2 && !((tail.flags | 0) & attest.SEG_COMP)) {
            const rl = perks.buildsOf(tail, pc, PERK_CH);
            if (!rl.ok) replayErr = rl.reason + ':' + rl.why;
            else if (rl.builds.length) builds = rl.builds;
          }
        }
      }
    }
    // knife 5.10b (client): debt-pact cash the log paid inside [startDepth, endDepth] (CLI fee= token) + the record's candidate-rules
    //   version (CLI rv= token: the high-roller coin envelope). A log that does not replay is already replayErr above.
    let fee = 0;
    if (!classic && tail && !replayErr && (buildEnd || (tail.picksLo | 0) || (tail.picksHi | 0))) {
      const dc = perks.debtCashOf(tail, pc, PERK_CH, tail.startDepth | 0, tail.endDepth | 0);
      if (!dc.ok) replayErr = dc.reason + ':' + dc.why;
      else fee = dc.cash | 0;
    }
    const rv = classic ? 1 : perks.rulesVerOf(tail, PERK_CH);
    // seasonId (2026-09-05): the run's season snapshot from the record tail (5th int; -1 when the
    // record predates it) -- the world core replays the season-keyed boards exactly, so the cap is
    // per-run exact instead of a legacy runSeed-keyed replay.
    return { entry: 'endless', pc, startDepth: tail ? tail.startDepth | 0 : 0, endDepth: tail ? tail.endDepth | 0 : 0,
      seasonId: (tail && tail.seasonId != null) ? (tail.seasonId | 0) : -1,
      build, builds, buildEnd, replayErr, fee, rv,
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
      (season != null ? (' ' + season) : '') + ((bd || hasRr || cl) ? (' ' + bd) : '') + ((hasRr || cl) ? (' ' + rl + ' ' + rh) : '') + (cl ? ' 1' : '') + listTok +
      // knife 5.10b: fee= (debt cash) / rv= (rules version >= 2) only to a core that reads them (caps.fee / caps.rv; the caller defers otherwise)
      (((p.fee | 0) > 0 && caps && caps.fee) ? (' fee=' + (p.fee | 0)) : '') + (((p.rv | 0) > 1 && caps && caps.rv) ? (' rv=' + (p.rv | 0)) : '');
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
// The fee= / rv= tokens (client knife 5.10b) are read only by a CLI answering fee=1 / rv=1; an older core would drop them and cap a
//   debt-pact / EA run without the debt cash / the high-roller coin envelope (too low = a false veto) -> such groups are deferred.
function cliSupportsFee(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\bfee=1\b/.test(r.map.p0.v));
}
function cliSupportsRv(run) {
  const r = (run || runCli)(['V p0']);
  return !!(r && !r.fail && r.map && r.map.p0 && r.map.p0.v && /\brv=1\b/.test(r.map.p0.v));
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

// O198 v1 (S2): a core's identity = the source hash its CLI prints in the head line ("SEEDCAP <hash12>"); null when it does not run
function headHashOf(head) { const m = /^SEEDCAP\s+([0-9a-f]{6,64})/i.exec(String(head || '')); return m ? m[1].toLowerCase() : null; }
function coreHashOf(exe, run) { const r = (run || ((lines) => runCli(lines, exe)))(['V p0']); return (r && !r.fail) ? headHashOf(r.head) : null; }

// endless continuation carry-in bound: best audited chain cap among the roster,
// else the pre-seedcap static bound at that depth (generous fail-open for chains
// that predate the audit -- exact from the first fully-audited session onward)
const chainKey = (pid, pc, runSeed) => pid + ':' + pc + ':' + (runSeed | 0);   // per run (knife 3.5c2a-A); legacy key = pid:pc
const CHAIN_LEGACY_KEEP_MIN = 7 * 1440;    // legacy pid:pc entries: read-only fallback for 7 days after the first run of this code, then pruned
const CHAIN_KEEP_MIN = 90 * 1440;          // per-run entries expire after 90 days (a run cannot be resumed past its save row's season anyway)
function chainStartBank(st, rosterPids, pc, startDepth, runSeed) {
  if ((startDepth | 0) <= 0) return 0;
  // (the static bound below is O(1) -- endlessGoalFor is a closed form clamped to the depth domain, R1-B2-02)
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
  let t = null;
  if ((d[8] | 0) === 1) t = attest.soloTail(d);
  if (!t) t = v.endlessTail(d);
  if (t && t.runSeed == null) t.runSeed = d[4] | 0;   // knife 5.10a: rules v2 candidate set needs the run seed (d[4] in every layout)
  return t;
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
// one group -> its pending audit item, or null (not auditable). Shared by pickAuditable and the O198 replay (knife 5.5b-1 S2,
//   which re-audits an already-convicted group on a new world core: it ignores st.audited).
function pendingOfGroup(st, m, g) {
  {
    const d0 = g[0].d;
    const mt = d0[2] | 0, pc = d0[8] | 0, base = v.baseMt(mt);
    if (base < 1 || base > 10 || pc < 1 || pc > 8 || d0.length < 10 + pc) return null;   // 10 = O140 private (audited via capParamsOf); 11 = O156 bot matches excluded (record pc = humans only != world seat count -> no derivable cap; XP-only track, zero stakes)
    const vecOf = (d) => d.slice(10, 10 + pc).join(',');
    if (!g.every(r => vecOf(r.d) === vecOf(d0))) return null;   // forgery-suspect groups are the reconcile's own flag lane
    const scores = d0.slice(10, 10 + pc).map(x => x | 0);
    let tail = null;
    if (v.isEndlessMt(mt)) {
      // conservative tail: widest consistent interpretation (zero-tail abstention
      // rides along; a bigger depth range only ever RAISES the cap = fail-open)
      for (const r of g) {
        const t = tailOf(r.d);
        if (t && (!tail || (t.endDepth | 0) > (tail.endDepth | 0))) tail = t;
      }
      if (!tail || (tail.endDepth | 0) < (tail.startDepth | 0)) return null;
      // out-of-domain depth (structural forgery: the reconcile flags it 'depth' and never settles it) is never replayed
      //   or capped here -- one unsigned record claiming a depth near 2^31 used to run the goal curve for ~15 s per run
      //   (R1-B2-02). Remembered once as audited-with-error like a forged pick log (takeSkips).
      if ((tail.startDepth | 0) < 0 || (tail.endDepth | 0) > v.ENDLESS.DEPTH_CAP) return { m, mt, pc, scores, p: null, tail, roster: {}, self: [], runSeed: d0[4] | 0, skip: 'depth' };
    }
    const p = capParamsOf(mt, pc, tail);
    const roster = v.rosterConsensus(g);
    const rosterPids = Object.keys(roster).map(s2 => v.pid(roster[s2]));
    const runSeed = d0[4] | 0;
    if (p.replayErr) return { m, mt, pc, scores, p, tail, roster, self: [], runSeed, skip: 'perk-replay:' + p.replayErr };   // forged pick log: not capped (reconcile perk_forge lane)
    if (p.entry === 'endless') p.startBank = chainStartBank(st, rosterPids, pc, p.startDepth, runSeed);
    // w (O198 v1 context): distinct accounts that wrote a record of the group
    return { m, mt, pc, scores, p, tail, roster, self: selfSeatsOf(g, roster), runSeed, keyId: (p.entry === 'endless' && p.keyId > 0) ? (p.keyId | 0) : 0,
      w: new Set(g.map(r => String((r && (r.w || r.steamID)) || ''))).size };
  }
}
function pickAuditable(st, groups) {
  const pending = [];
  for (const m of Object.keys(groups)) {
    if (st.audited[m]) continue;
    const x = pendingOfGroup(st, m, groups[m]);
    if (x) pending.push(x);
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
// ---- O198 v1 (S2): per-core stats (hourly buckets) ----
// the world core that answered a verdict: the exact core of a guard-signed record, else this run's primary (its CLI head hash)
function coreOfVerdict(r, primary) { return (r && typeof r.via === 'string' && r.via.indexOf('exact:') === 0) ? r.via.slice(6) : (primary || 'root'); }
function coreStat(st, k, t, over) {
  if (!st.cores) st.cores = {};
  const c = st.cores[k] = st.cores[k] || { t0: t | 0, n: 0, o: 0, h: {} };
  if (!c.h) c.h = {};
  c.n++; if (over) c.o++;
  const hk = Math.floor((t | 0) / 60);
  const b = c.h[hk] = c.h[hk] || [0, 0];
  b[0]++; if (over) b[1]++;
  c.ts = t | 0;
  return c;
}
// last 24 h of one core: [audited, over]
function coreRate24(st, k, tNow) {
  const c = st.cores && st.cores[k];
  const out = [0, 0];
  if (!c || !c.h) return out;
  const h0 = Math.floor((tNow | 0) / 60) - 23;
  for (const hk of Object.keys(c.h)) if ((hk | 0) >= h0) { out[0] += c.h[hk][0] | 0; out[1] += c.h[hk][1] | 0; }
  return out;
}
// the cores whose 24 h over-cap rate looks like a cap bug and were not mailed today (pure; marking is the caller's)
function coreAlerts(st, tNow) {
  const out = [], day = Math.floor((tNow | 0) / 1440);
  for (const k of Object.keys(st.cores || {})) {
    const [a, o] = coreRate24(st, k, tNow);
    if (o >= SC_RATE_MIN_OVER && o * 1000 >= SC_RATE_PERMIL * a && (st.cores[k].md | 0) !== day) out.push({ k, a, o, permil: Math.round(o * 1000 / Math.max(1, a)) });
  }
  return out;
}
// O285 (1): first minute a core was live in this channel -- the earliest live.json window naming it, else the first verdict
//   filed under it (st.cores[k].t0); null = never seen
function coreFirstSeen(st, live, channel, k) {
  let t = null;
  for (const w of ((live && live.channels && live.channels[channel]) || [])) {
    if (!w || String(w.core) !== String(k)) continue;
    const ms = Date.parse(w.liveAt);
    if (Number.isFinite(ms)) { const m = Math.floor(ms / 60000); if (t == null || m < t) t = m; }
  }
  const c = st.cores && st.cores[k];
  if (c && c.t0 > 0 && (t == null || (c.t0 | 0) < t)) t = c.t0 | 0;
  return t;
}
// the observation judge of one run (pure): snapshot of each core's honest audits BEFORE this run's verdicts are filed
function observationOf(st, live, channel, tNow) {
  const ok0 = {};
  for (const k of Object.keys(st.cores || {})) ok0[k] = Math.max(0, (st.cores[k].n | 0) - (st.cores[k].o | 0));
  return (k) => {
    const t0 = coreFirstSeen(st, live, channel, k);
    const age = t0 == null ? 0 : (tNow | 0) - t0;
    return age < SC_OBS_H * 60 && (ok0[k] | 0) < SC_OBS_N;
  };
}
// observed over-cap groups of this run per core, not mailed today (pure)
function observedAlerts(st, flags, tNow) {
  const by = {}, day = Math.floor((tNow | 0) / 1440);
  for (const f of (flags || [])) if (f.obs) by[f.k] = (by[f.k] | 0) + 1;
  return Object.keys(by).filter((k) => !(st.cores && st.cores[k] && (st.cores[k].mo | 0) === day)).map((k) => ({ k, n: by[k] }));
}
// the latest conviction still standing (not reversed) -> su.t1e; none standing in the kept list -> t0 (the earliest: a shorter
//   window is the safe side, architecture decision 10)
function standingT1(su) {
  const fpm = su.fpm || [];
  let best = null;
  for (const c of (su.cv || [])) if (fpm.indexOf(c[0]) < 0 && (best == null || (c[1] | 0) > best)) best = c[1] | 0;
  return best != null ? best : (su.t0 | 0);
}
function convictedFor(su, m) { return !!su && (((su.cv || []).some(c => c[0] === m)) || ((su.ms || []).indexOf(m) >= 0)) && (su.fpm || []).indexOf(m) < 0; }
// opt (O198 v1, optional): { primary: the primary core's head hash }. Without it every verdict counts under 'root'.
function applyAudit(st, pending, cliMap, processed, t, opt) {
  let over = 0, okN = 0, errN = 0;
  const flags = [];   // runtime-only offense detail (sids never enter the public state file)
  const primary = (opt && opt.primary) || 'root';
  // this run's per-core counts first (the conviction context carries the run's same-core over-cap share)
  const runCore = {};
  pending.forEach((x, i) => {
    const r = cliMap['m' + i];
    if (!r || r.err != null || r.cap == null) return;
    const k = coreOfVerdict(r, primary), capEff = Math.round(r.cap * (x.p.capMult || 1));
    const rc = runCore[k] = runCore[k] || [0, 0];
    rc[0]++; if (x.scores.some(sc => sc > capEff)) rc[1]++;
  });
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
    const k = coreOfVerdict(r, primary), ov = r.via === 'overlap';   // O198 v1: which world answered (k) + overlap max
    st.audited[x.m] = { c: capEff, s: Math.max.apply(null, x.scores), o: overSeats.length ? 1 : 0, t, k };
    if (ov) st.audited[x.m].ov = 1;
    coreStat(st, k, t, overSeats.length > 0);
    if (overSeats.length) {
      over++;
      // the veto (no settlement) and the correction (reverse a settled gain) stay on every over-cap seat; a
      //   CONVICTION (suspect ledger -> reject window, offense board) only on a self-written seat (selfSeatsOf)
      st.veto[x.m] = { t, seats: overSeats };
      const selfSet = new Set(x.self || []);
      const selfOver = overSeats.filter(s2 => selfSet.has(s2) && x.roster[s2]);
      // O285 (1): a core inside its observation window convicts nobody (the veto above stands)
      const obs = !!(opt && opt.obsOf && opt.obsOf(k));
      const blamed = obs ? [] : selfOver;
      const unblamed = overSeats.filter(s2 => selfOver.indexOf(s2) < 0);
      const nOf = {};
      if (obs) for (const seat of selfOver) {
        const sc0 = x.scores[seat] | 0;
        trustLedger.queuePush(st, { t, src: 'sc', p: v.pid(x.roster[seat]), sev: 0, m: x.m, ctx: { k, obs: 1, cap: capEff | 0, s: sc0, over: sc0 - (capEff | 0), mt: x.mt | 0, pc: x.pc | 0, w: x.w | 0 } });
      }
      for (const seat of blamed) {
        const sid = x.roster[seat];
        const p2 = v.pid(sid);
        const su = st.suspects[p2] = st.suspects[p2] || { n: 0, t0: t, ms: [] };
        const nb = su.n | 0;
        su.n++; su.t1 = t; su.t1e = t;
        nOf[seat] = su.n;
        if (su.ms.indexOf(x.m) < 0) { su.ms.push(x.m); if (su.ms.length > SUSPECT_MATCH_KEEP) su.ms.shift(); }
        if (!Array.isArray(su.cv)) su.cv = [];
        su.cv.push([x.m, t]); if (su.cv.length > CONVICTION_KEEP) su.cv.shift();
        // O198 v1 (S2): the conviction's context, for reading a false positive back out of the ledger
        const sc0 = x.scores[seat] | 0, rc = runCore[k] || [1, 1];
        const ctx = { b: x.keyId | 0, k, ov: ov ? 1 : 0, cap: capEff | 0, s: sc0, over: sc0 - (capEff | 0), ratio: Math.round(1000 * (sc0 - capEff) / Math.max(1, capEff)),
          w: x.w | 0, pc: x.pc | 0, mt: x.mt | 0, r: Math.round(1000 * rc[1] / Math.max(1, rc[0])), nb };
        if (x.tail) { ctx.d0 = x.tail.startDepth | 0; ctx.d1 = x.tail.endDepth | 0; }
        trustLedger.queuePush(st, { t, src: 'sc', p: p2, sev: 3, m: x.m, ctx });   // O198 v1
      }
      if (!obs && processed.has(x.m) && x.p.entry === 'endless' && !st.corrections.some(c => c.m === x.m)) {   // (O285 (1): no correction while observed)
        st.corrections.push({ id: 'sc-' + x.m, m: x.m, seats: overSeats, t });
      }
      flags.push({
        m: x.m, t, runSeed: x.runSeed | 0, mt: x.mt | 0, cap: capEff | 0, k, obs,
        observed: obs ? selfOver.map(s2 => ({ seat: s2, score: x.scores[s2] | 0 })) : [],
        offenders: blamed.map(s2 => ({ seat: s2, sid: String(x.roster[s2]), score: x.scores[s2] | 0, n: nOf[s2] | 0, ne: v.seedcapNEff(st.suspects[v.pid(x.roster[s2])]) })),
        unattributed: unblamed.map(s2 => ({ seat: s2, score: x.scores[s2] | 0 })),
      });
      if (obs) console.log('seedcap: core ' + k + ' is inside its observation window (first ' + SC_OBS_H + ' h / ' + SC_OBS_N + ' honest audits) -- m=' + x.m + ' vetoed, nobody convicted (' + selfOver.length + ' self-written seat(s) recorded only)');
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

// ---- O198 v1 (S2): automatic reversal on a new world core ----
// which convictions to re-audit now: over-cap (o 1) audits of the last REPLAY_DAYS made on another core than `primary`, not yet
//   replayed on it. A group no longer on the shards cannot be replayed (marked, never looked at again on this core).
function replayCandidates(st, groups, primary, tNow) {
  const ms = [], gone = [];
  for (const m of Object.keys(st.audited || {})) {
    const a = st.audited[m];
    if (!a || a.o !== 1 || a.e != null) continue;
    if ((tNow | 0) - (a.t | 0) > REPLAY_DAYS * 1440) continue;
    if (a.k === primary || a.rk === primary) continue;
    if (!groups[m]) { gone.push(m); continue; }
    ms.push(m);
  }
  ms.sort((a, b) => (st.audited[b].t | 0) - (st.audited[a].t | 0));   // the newest first (their windows are the open ones)
  return { ms: ms.slice(0, REPLAY_MAX), gone };
}
// apply the new core's verdicts (pure): items = pending items of the candidate groups (pendingOfGroup), cliMap = their answers.
//   A convicted self-written seat whose score the new cap covers -> reversed: su.fp++, su.fpm, su.t1e, an fp event queued.
//   Every candidate is marked replayed on `primary` (an error included: the same core would answer the same).
function applyReplay(st, items, cliMap, primary, t) {
  const out = { replayed: 0, reversed: [], still: 0 };
  items.forEach((x, i) => {
    const a = st.audited[x.m];
    if (a) a.rk = primary;
    const r = cliMap['m' + i];
    if (!r || r.err != null || r.cap == null) return;
    out.replayed++;
    const capEff = Math.round(r.cap * ((x.p && x.p.capMult) || 1));
    for (const seat of (x.self || [])) {
      const sid = x.roster[seat];
      if (!sid) continue;
      const p2 = v.pid(sid), su = st.suspects[p2];
      if (!convictedFor(su, x.m)) continue;
      if ((x.scores[seat] | 0) > capEff) { out.still++; continue; }
      su.fp = (su.fp | 0) + 1;
      if (!Array.isArray(su.fpm)) su.fpm = [];
      su.fpm.push(x.m); if (su.fpm.length > CONVICTION_KEEP) su.fpm.shift();
      su.t1e = standingT1(su);
      trustLedger.queuePush(st, { t, src: 'sc', p: p2, m: x.m, fp: 1, ctx: { k0: (a && a.k) || '?', k1: primary, cap1: capEff } });
      out.reversed.push({ pid: p2, m: x.m, k0: (a && a.k) || '?', k1: primary, cap0: a ? a.c : null, cap1: capEff, score: x.scores[seat] | 0 });
      console.log('::warning::seedcap REPLAY m=' + x.m + ' core ' + ((a && a.k) || '?') + ' -> ' + primary + ': cap ' + (a ? a.c : '?') + ' -> ' + capEff +
        ', seat ' + seat + ' score ' + (x.scores[seat] | 0) + ' now under the cap -- conviction of ' + p2.slice(0, 8) + ' reversed (n stays ' + su.n + ', effective ' + v.seedcapNEff(su) + '; the veto stands)');
    }
  });
  return out;
}

// ---- offense-board mirror + anomaly mail (pure planners; IO stays at the call site) ----
function offensePlanOf(st, flags) {
  const plan = {};
  for (const f of flags || []) for (const o of (f.offenders || [])) {
    if (!o.sid) continue;
    const su = st.suspects[v.pid(o.sid)];
    plan[o.sid] = {
      score: su ? su.n | 0 : 1,   // absolute cumulative count = idempotent + self-healing
      details: [OFFENSE_MAGIC, f.t | 0, f.runSeed | 0, f.mt | 0, f.cap | 0, o.score | 0, su ? su.fp | 0 : 0],   // + fp (O198 v1 S2: convictions reversed so far)
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
// extra (O198 v1 S2, optional): reasons computed elsewhere (a core's 24 h over-cap rate, reversals) -- each one sends
function mailDecision(newOver, suspectsTotal, lastMailedSus, extra) {
  const reasons = [];
  for (const e of (extra || [])) if (e) reasons.push(String(e));
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
    out.push({ pid: p, n: v.seedcapNEff(su), until, leftMin: until - (nowM | 0) });   // n = the effective count (O198 v1: n - fp)
  }
  out.sort((a, b) => a.until - b.until || (a.pid < b.pid ? -1 : 1));
  return out;
}
const fmtMin = (m) => new Date((m | 0) * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
function alertMailText(reasons, flags, totals, windows, more) {
  const lines = ['seedcap anomaly alert: ' + reasons.join(' + '), ''];
  // O198 v1 (S2): the per-core rate lines and the reversals of this run
  for (const c of ((more && more.cores) || [])) lines.push('CORE ' + c.k + ': ' + c.o + ' of ' + c.a + ' audits over the cap in 24 h (' + (c.permil / 10) + '%) -- more like a cap bug of this core than cheating; check its scoring sources');
  for (const o of ((more && more.observed) || [])) lines.push('OBSERVED core ' + o.k + ': ' + o.n + ' over-cap group(s) this run inside its observation window (first ' + SC_OBS_H + ' h / ' + SC_OBS_N + ' honest audits) -- vetoed, nobody convicted; a new core over the cap this early is most likely its own cap bug');
  for (const x of ((more && more.reversed) || [])) lines.push('REVERSED m=' + x.m + ' core ' + x.k0 + ' -> ' + x.k1 + ' cap ' + x.cap0 + ' -> ' + x.cap1 + ' score ' + x.score + ' pid ' + x.pid.slice(0, 8) + ' (the window now reads n - fp)');
  if (more && ((more.cores || []).length || (more.reversed || []).length || (more.observed || []).length)) lines.push('');
  for (const f of flags || []) {
    lines.push('OVER m=' + f.m + ' mt=' + f.mt + ' seed=' + f.runSeed + ' cap=' + f.cap + '  ' +
      (f.offenders || []).map(o => 'seat' + o.seat + '=' + o.score + ' sid=' + (o.sid || '?') +
        (o.n ? (' n=' + o.n + ' window=' + Math.round(v.seedcapRejectWindowMin(o.ne != null ? o.ne : o.n) / 60) + 'h') : '')).concat(
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
async function sendAlertMail(reasons, flags, totals, windows, more) {
  const to = process.env.SC_MAIL_TO || process.env.FB_DIGEST_TO, apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey) return false;   // unconfigured -> decision stays pending (mailedSus not advanced)
  const text = alertMailText(reasons, flags, totals, windows, more);
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
  // O198 v1 (S2): per-core hourly buckets keep a week
  if (st.cores) {
    const h0 = Math.floor((tNow | 0) / 60) - CORE_HOURS_KEEP;
    for (const k of Object.keys(st.cores)) { const c = st.cores[k]; for (const hk of Object.keys(c.h || {})) if ((hk | 0) < h0) delete c.h[hk]; }
  }
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
    // R1-A5-07: the same per-channel key policy as the reconcile (recovery keys stay readable until the file's date)
    const got = v.recoverPick(rows, rc, attest.loadPubTable(path.join(__dirname, 'attest-keys.json'), { channel: SEEDCAP_CHANNEL || null, nowMs: Date.now(), exempt: rc.keys }) || {});
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
  const needFee = (x) => !!(x.p && (x.p.fee | 0) > 0), needRv = (x) => !!(x.p && (x.p.rv | 0) > 1);
  if (pending.some(needFee) && !cliSupportsFee(runPrimary)) {
    const n = pending.length;
    pending = pending.filter(x => !needFee(x));
    console.log('seedcap: CLI ignores the fee= debt-cash token -- ' + (n - pending.length) + ' debt-pact groups deferred until the CLI is refreshed');
  }
  if (pending.some(needRv) && !cliSupportsRv(runPrimary)) {
    const n = pending.length;
    pending = pending.filter(x => !needRv(x));
    console.log('seedcap: CLI ignores the rv= rules-version token -- ' + (n - pending.length) + ' rules-v2 groups deferred until the CLI is refreshed');
  }
  out.deferred = pendingIn.length - pending.length;
  out.pending = pending;
  if (!pending.length) return out;
  const capsPrimary = { builds: cliSupportsBuilds(runPrimary), fee: cliSupportsFee(runPrimary), rv: cliSupportsRv(runPrimary) };
  const res = runPrimary(pending.map((x, i) => cliLineOf('m' + i, x.p, x.runSeed, capsPrimary)));
  if (res.fail) return Object.assign(out, { fail: 'CLI run failed ' + res.fail });
  out.head = res.head;
  // overlap cores: each answers only the groups it can read (capability probes per core); a failed overlap run
  //   costs nothing but the extra headroom (the primary verdicts stand)
  for (const c of cores.slice(1)) {
    const run = runOf(c.exe);
    const okRr = cliSupportsRerolls(run), okBuild = cliSupportsBuild(run), okCl = cliSupportsClassic(run), caps = { builds: cliSupportsBuilds(run), fee: cliSupportsFee(run), rv: cliSupportsRv(run) };
    const lines = [];
    pending.forEach((x, i) => {
      if (!okRr && x.p && (x.p.rerollLo || x.p.rerollHi)) return;
      if (!okBuild && x.p && x.p.build) return;
      if (!okCl && x.p && x.p.classic) return;
      if ((!caps.fee && needFee(x)) || (!caps.rv && needRv(x))) return;
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
    const okRr = cliSupportsRerolls(run), okBuild = cliSupportsBuild(run), okCl = cliSupportsClassic(run), caps = { builds: cliSupportsBuilds(run), fee: cliSupportsFee(run), rv: cliSupportsRv(run) };
    const lines = [];
    for (const i of ex.idx) {
      const x = pending[i];
      if (!okRr && x.p && (x.p.rerollLo || x.p.rerollHi)) continue;
      if (!okBuild && x.p && x.p.build) continue;
      if (!okCl && x.p && x.p.classic) continue;
      if ((!caps.fee && needFee(x)) || (!caps.rv && needRv(x))) continue;
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

  const primaryHash = coreHashOf(cores[0].exe) || cores[0].label;   // O198 v1 (S2): the world core every verdict of this run is filed under
  const picked = takeSkips(st, pickAuditable(st, groups), nowMin());
  let stats = { over: 0, okN: 0, errN: 0, flags: [] };
  let audited = { pending: [], map: {}, deferred: 0, exact: 0, head: '' };
  if (picked.pending.length) {
    audited = auditPending(picked.pending, { cores, live: cf.live, channel: SEEDCAP_CHANNEL, distDir: SEEDCAP_DIST_DIR });
    if (audited.fail) { console.log('::error::seedcap: ' + audited.fail); process.exit(1); }
    if (audited.pending.length) {
      console.log('seedcap: ' + audited.head + ' auditing ' + audited.pending.length + ' groups' + (audited.exact ? ' (' + audited.exact + ' solo records on the core of the package that signed them)' : ''));
      stats = applyAudit(st, audited.pending, audited.map, processed, nowMin(), { primary: primaryHash, obsOf: observationOf(st, cf.live, SEEDCAP_CHANNEL, nowMin()) });
    }
  }
  if (stats.flags && stats.flags.length) await writeOffense(st, stats.flags);
  // O198 v1 (S2): reversal -- convictions of the last REPLAY_DAYS made on another core, re-audited on this run's primary
  let rp = { replayed: 0, reversed: [], still: 0 };
  {
    const rc = replayCandidates(st, groups, primaryHash, nowMin());
    for (const m of rc.gone) if (st.audited[m]) st.audited[m].rk = primaryHash;   // records gone: nothing to replay on this core
    if (rc.ms.length) {
      const items = rc.ms.map(m => pendingOfGroup(st, m, groups[m])).filter(x => x && !x.skip);
      for (const m of rc.ms) if (!items.some(x => x.m === m) && st.audited[m]) st.audited[m].rk = primaryHash;   // not auditable any more
      if (items.length) {
        const ra = auditPending(items, { cores, live: cf.live, channel: SEEDCAP_CHANNEL, distDir: SEEDCAP_DIST_DIR });
        if (ra.fail) v.ghWarn('seedcap: replay CLI run failed ' + ra.fail + ' -- convictions stay as they are, retried next run');
        else rp = applyReplay(st, ra.pending, ra.map, primaryHash, nowMin());   // capability-deferred items stay unmarked (next run)
      }
      console.log('seedcap: replay on core ' + primaryHash + ': ' + rc.ms.length + ' candidate(s), ' + rp.replayed + ' re-audited, ' + rp.reversed.length + ' reversed, ' + rp.still + ' still over');
    }
  }
  const ca = coreAlerts(st, nowMin());
  const oa = observedAlerts(st, stats.flags, nowMin());   // O285 (1)
  const extra = ca.map(c => 'core ' + c.k + ' over-cap ' + c.o + '/' + c.a + ' in 24h').concat(oa.map(o => 'new core ' + o.k + ' over-cap x' + o.n + ' (observation, nobody convicted)'),
    rp.reversed.length ? ['replay reversed ' + rp.reversed.length + ' conviction(s)'] : []);
  const md = mailDecision(stats.over, Object.keys(st.suspects).length, st.mailSus | 0, extra);
  if (md.send && await sendAlertMail(md.reasons, stats.flags,
      { veto: Object.keys(st.veto).length, suspects: Object.keys(st.suspects).length }, rejectWindowsOf(st, nowMin()), { cores: ca, reversed: rp.reversed, observed: oa })) {
    st.mailSus = md.mailedSus;   // advance only on a delivered mail (failed send retries next run)
    for (const c of ca) st.cores[c.k].md = Math.floor(nowMin() / 1440);   // a core's rate alert: once a day
    for (const o of oa) if (st.cores[o.k]) st.cores[o.k].mo = Math.floor(nowMin() / 1440);   // an observed core: once a day
    console.log('seedcap: anomaly mail sent (' + md.reasons.join(' + ') + ')');
  }
  pruneState(st, applied, nowMin());
  { // O198 v1: drop the queued events the reconcile already took (its cursor in trust.json; unreadable = keep them all)
    const tl = loadJsonObj(TRUST_FILE);
    const qp = trustLedger.queuePrune(st, tl && tl.taken && tl.taken.seedcap);
    if (qp.fused) v.ghWarn('seedcap: ' + qp.fused + ' trust event(s) dropped by the queue fuse (the reconcile has not taken them)');
  }
  saveState(st);
  console.log('seedcap: done groups=' + Object.keys(groups).length + ' audited-now=' + audited.pending.length + ' skipped=' + picked.skipped.length + ' deferred=' + audited.deferred +
    ' ok=' + stats.okN + ' over=' + stats.over + ' err=' + stats.errN + ' veto=' + Object.keys(st.veto).length +
    ' suspects=' + Object.keys(st.suspects).length + ' corrections=' + st.corrections.length);
}

module.exports = { coreFirstSeen, observationOf, observedAlerts, SC_OBS_H, SC_OBS_N, pendingOfGroup, coreOfVerdict, coreStat, coreRate24, coreAlerts, standingT1, convictedFor, replayCandidates, applyReplay, headHashOf, coreHashOf,
  REPLAY_DAYS, REPLAY_MAX, CONVICTION_KEEP, SC_RATE_PERMIL, SC_RATE_MIN_OVER, CORE_HOURS_KEEP,
  selectCores, resolveCores, mergeCaps, corePathOf, OVERLAP_GRACE_MS, OVERLAP_MAX_MS, cliSupportsRerolls, cliSupportsClassic, cliSupportsBuilds, cliSupportsFee, cliSupportsRv, capParamsOf, cliLineOf, cliSupportsBuild, chainKey, chainStartBank, tailOf, coreForBuildNum, selfSeatsOf, pickAuditable, takeSkips, applyAudit, pruneState, readGroups, coresForNow, auditPending, runCli, loadState, saveState, SC_STATE_FILE, AUDITED_KEEP, VETO_KEEP_MIN, CHAIN_LEGACY_KEEP_MIN, CHAIN_KEEP_MIN, offensePlanOf, writeOffense, mailDecision, sendAlertMail, alertMailText, rejectWindowsOf, OFFENSE_LB, OFFENSE_MAGIC, SC_MAIL_MIN_OVER, SC_MAIL_SUS_MIN };
if (require.main === module) {
  main().catch(e => { console.log('::error::seedcap run failed: ' + (e && e.stack || e)); process.exit(1); });
}
