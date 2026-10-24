'use strict';
// Nightly read-only invariant audit (independent of the 5-min reconcile loop).
//
// What it proves, every night, for free:
//   1. Board inventory -- every provisioned board still resolves (positive form of the
//      reconcile loop's STRICT_BOARDS gate, which only trips when a run needs the board).
//   2. Foreign-writer probe -- every entry on a Trusted-writes board must map (via the
//      state HMAC) to a player the cron itself has settled/penalized/signaled. An entry
//      outside that closure means the board's trusted-writes flag regressed, the publisher
//      key leaked, or state was lost -- all of which warrant a loud failure (e-mail).
//      This is the practical permission-regression probe: the Web API cannot read a
//      board's read/write configuration, but a misconfig manifests as foreign entries.
//   3. Shard/report hygiene + scale telemetry -- record/attestation/garbage counts,
//      state sizes, page-cap hits; the numbers that say when to raise CONCURRENCY,
//      split shard reads across matrix jobs, or move state off git.
//
// Output discipline (public logs): generic board labels + 8-hex pseudonyms + counts.
// Never board names from env, never raw steamIDs, never key material.
const fs = require('fs');
const { readBoardAll, pid, decodeDetails, getJson, BASE, TRUST_LB, REPORT_LB, START_MAGIC, REPORT_MAGIC, CP_LB, ENDLESS_LB, REDEEM_LB, GRANT_LB,
  ENDLESS_LB_SOLO, ENDLESS_LB_TRIO, ENDLESS_LB_QUAD, ENDLESS_LB_OVERALL, ENDLESS_COMP_LB, ENDLESS_COMP_LB_DUO, ENDLESS_COMP_LB_TRIO, ENDLESS_COMP_LB_QUAD, ENDLESS_COMP_LB_OVERALL,
  ENDLESS_LB_CLASSIC_SOLO, ENDLESS_LB_CLASSIC_DUO, ENDLESS_LB_CLASSIC_TRIO, ENDLESS_LB_CLASSIC_QUAD, ENDLESS_LB_CLASSIC_OVERALL, ENDLESS_CUP_HONOR_LB,
  LIKE_BOX_LB, LIKE_COUNT_LB } = require('./validate.js');
const v = require('./validate.js');   // O348 (3): shardPlan / LEDGER_SHARDS / sandboxOn
// O520 likes lane (client knife 5.4d, W79): the like box (client-writable, friends-reads) is inventory only, like the report
//   box; the like counts are a trusted board in the closure -- the lane counts a like only for a player with settled XP
//   (validate.js processLikes `known`; xp.json is never pruned), so a row for anybody else is a foreign write.
const LIKE_BOARDS = [[LIKE_BOX_LB, 'like box'], [LIKE_COUNT_LB, 'like count']];
const LIKE_TRUSTED = [[LIKE_COUNT_LB, 'like count']];
// O276 (client knife 5.1b, 2026-10-18): every cron-written endless ladder is a trusted board like endless_board (the closure once held only
//   endless_board and its season twins). Their names are this repo's public defaults (the jobs never override them), and every writer of
//   one of them enters the state the closure reads (recordEndlessSignals for every own-record seat, xp for every endless settle).
const ENDLESS_TRUSTED = [ENDLESS_LB_SOLO, ENDLESS_LB_TRIO, ENDLESS_LB_QUAD, ENDLESS_LB_OVERALL, ENDLESS_COMP_LB, ENDLESS_COMP_LB_DUO, ENDLESS_COMP_LB_TRIO, ENDLESS_COMP_LB_QUAD,
  ENDLESS_COMP_LB_OVERALL, ENDLESS_LB_CLASSIC_SOLO, ENDLESS_LB_CLASSIC_DUO, ENDLESS_LB_CLASSIC_TRIO, ENDLESS_LB_CLASSIC_QUAD, ENDLESS_LB_CLASSIC_OVERALL,
  ENDLESS_CUP_HONOR_LB];   // O180 (client knife 5.1c-1): the cup honor board -- a winner is an own-record competitive writer of that week (in signals); a
//   foreign row here = its trusted-writes flag regressed = a self-written name mark. The weekly boards (<comp ladder>_w<YYYYWW>) rotate and are
//   not in the closure (seasonTwinOf takes _s<N> only); the carrier row sits on the ops carrier account (not a player) and is left out too.
// season twins (`<base>_s<N>`) of the base board and the season-twinned families (classic ladders are lifetime only)
const ENDLESS_SEASONED = [ENDLESS_LB, ENDLESS_LB_SOLO, ENDLESS_LB_TRIO, ENDLESS_LB_QUAD, ENDLESS_LB_OVERALL, ENDLESS_COMP_LB, ENDLESS_COMP_LB_DUO, ENDLESS_COMP_LB_TRIO, ENDLESS_COMP_LB_QUAD, ENDLESS_COMP_LB_OVERALL];
function seasonTwinOf(name) {
  const m = /^(.+)_s(\d+)$/.exec(String(name));
  return m && ENDLESS_SEASONED.indexOf(m[1]) >= 0 ? { base: m[1], season: m[2] | 0 } : null;
}

const KEY = process.env.STEAM_PUBLISHER_KEY;
const APPID = Number(process.env.APPID);
const PREFIX = process.env.LB_PREFIX;
const RANKED_LB = process.env.RANKED_LB, LP_LB = process.env.LP_LB, XP_LB = process.env.XP_LB;
const MIN_SHARDS = Math.max(1, Number(process.env.AUDIT_MIN_SHARDS || 50));
const ghWarn = m => console.log('::warning::' + m);
const ghErr = m => console.log('::error::' + m);

function loadJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || dflt; } catch (e) { return dflt; } }

// Pure core (exported for the unit test): every entry sid on a trusted board must hash into
// the union of state keys -- the cron persists state for every player it ever writes boards
// for (skill on rating, skill/leavers on points, xp state on xp, signals.players on trust).
// stateOnly counts the benign inverse (state without a board entry: normal after a wipe).
function auditTrusted(boards, state) {
  const known = new Set([].concat(
    Object.keys(state.skill || {}), Object.keys(state.xp || {}),
    Object.keys(state.leavers || {}), Object.keys((state.signals && state.signals.players) || {})));
  const violations = [];
  const onBoard = new Set();
  for (const label of Object.keys(boards)) {
    for (const sid of boards[label]) {
      const h = pid(String(sid));
      onBoard.add(h);
      if (!known.has(h)) violations.push(label + ' entry ' + h.slice(0, 8) + ' outside cron state (foreign writer / lost state)');
    }
  }
  let stateOnly = 0;
  for (const h of known) if (!onBoard.has(h)) stateOnly++;
  return { violations, stateOnly, known: known.size, entries: onBoard.size };
}

async function main() {
  const missing = [];
  if (!KEY) missing.push('STEAM_PUBLISHER_KEY');
  if (!APPID) missing.push('APPID');
  if (!PREFIX) missing.push('LB_PREFIX');
  if (!RANKED_LB) missing.push('RANKED_LB');
  if (!LP_LB) missing.push('LP_LB');
  if (!process.env.STATE_SALT) missing.push('STATE_SALT');
  if (missing.length) { ghErr('missing env: ' + missing.join(', ')); process.exit(1); }
  const t0 = Date.now();
  const violations = [];

  const lr = await getJson(BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (!lr.ok) { ghErr('board listing HTTP ' + lr.status); process.exit(1); }
  const all = ((lr.json && lr.json.response && lr.json.response.leaderboards) || []);
  const byName = {};
  for (const b of all) byName[String(b.name || b.Name)] = { id: b.id || b.ID, entries: b.entries | 0 };

  // 1) inventory
  // Phase-2 seam (not implemented in v1): a client-writable snapshot-mirror board exists as a
  // disaster backup (client optimistic values; never consumed by the reconcile loop). Once real
  // traffic calibrates thresholds, this audit is the natural place to read it and record a
  // per-player mirror-vs-authoritative drift signal (record-only, like the other signals; wide
  // bounds -- legitimate drift includes the 5-min pre-correction window, menu credits and
  // multi-device last-writer). Until then the mirror board is deliberately NOT in the inventory
  // or trusted-closure lists below: it is client-writable by design, so foreign-writer logic
  // does not apply and its absence should not fail the audit.
  const want = [[RANKED_LB, 'rating'], [LP_LB, 'points'], [TRUST_LB, 'trust'], [REPORT_LB, 'report'], [CP_LB, 'cp'], [ENDLESS_LB, 'endless'], [REDEEM_LB, 'redeem'], [GRANT_LB, 'grant']];
  if (XP_LB) want.push([XP_LB, 'xp']);
  for (const w of LIKE_BOARDS) want.push(w);   // O520: provisioned by the reconcile's bootstrap every run
  for (const [name, label] of want) if (!byName[name]) violations.push(label + ' board missing from listing');
  const shardListed = all.filter(b => { const n = String(b.name || b.Name); return n.indexOf(PREFIX) === 0 && n.indexOf('test') < 0; });
  // O348 (3) (knife 5.5b-1 S5): the reconcile's shard set (PREFIX+0..N-1, shardPlan) -- extra prefix boards are reported, not read
  const shardSel = v.shardPlan(shardListed.map((b) => String(b.name || b.Name)), PREFIX, v.LEDGER_SHARDS, v.sandboxOn());
  const shardReadSet = new Set(shardSel.read);
  const shardBoards = shardListed.filter((b) => shardReadSet.has(String(b.name || b.Name)));
  if (shardSel.extra.length) violations.push(shardSel.extra.length + ' extra board(s) with the shard prefix (not read): ' + shardSel.extra.slice(0, 5).join(', '));
  if (shardBoards.length < MIN_SHARDS) violations.push('shard boards ' + shardBoards.length + ' < expected ' + MIN_SHARDS);
  console.log('inventory: ' + shardBoards.length + ' shards + ' + want.filter(w => byName[w[0]]).length + '/' + want.length + ' core boards');

  // 2) trusted-board closure vs state
  const state = {
    skill: loadJson(process.env.SKILL_FILE || 'skill.json', {}),
    xp: loadJson(process.env.XP_FILE || 'xp.json', {}),
    leavers: loadJson(process.env.LEAVERS_FILE || 'leavers.json', {}),
    signals: loadJson(process.env.SIGNALS_FILE || 'signals.json', {}),
  };
  const trusted = {};
  // cp/endless entries hash into the closure via signals.players: the settle path records an
  // endless participation signal for every roster member (including debited non-writers), and
  // every CP-credited player is a settled matchmade participant.
  // grant entries hash into the closure the same way cp does: a granted player necessarily had
  // wallet balance, i.e. settled matchmade participation. The redeem box itself is client-
  // writable by design (like report/mirror) and is inventory-only above.
  const trustedWant = [[RANKED_LB, 'rating'], [LP_LB, 'points'], [TRUST_LB, 'trust'], [CP_LB, 'cp'], [ENDLESS_LB, 'endless'], [GRANT_LB, 'grant']];
  if (XP_LB) trustedWant.push([XP_LB, 'xp']);
  for (const n of ENDLESS_TRUSTED) trustedWant.push([n, n]);   // O276: the other cron-written endless ladders (absent ones are skipped below)
  for (const w of LIKE_TRUSTED) trustedWant.push(w);           // O520: like counts (see LIKE_TRUSTED)
  // seasonal ladders (`<base>_s<N>`, cron-created trusted boards): audit them like their base
  // boards -- the foreign-writer closure applies identically. Discovered from the listing so a
  // new season needs no audit change; test boards are excluded as everywhere else.
  //   O276: the endless twins match exactly `<seasoned base>_s<digits>` (the old prefix test also took endless_board_solo for a
  //   twin of endless_board -- harmless then, since it is trusted too, now listed by name above).
  for (const b of all) {
    const n = String(b.name || b.Name);
    if (n.indexOf('test') >= 0) continue;
    if (n.indexOf(LP_LB + '_s') === 0) trustedWant.push([n, 'points_' + n.slice(LP_LB.length + 1)]);
    else { const tw = seasonTwinOf(n); if (tw) trustedWant.push([n, tw.base === ENDLESS_LB ? 'endless_s' + tw.season : n]); }
  }
  for (const [name, label] of trustedWant) {
    if (!byName[name]) continue;
    const br = await readBoardAll(byName[name].id, label + ' board');
    trusted[label] = br.ents.map(e => String(e.steamID));
    console.log(label + ': ' + trusted[label].length + ' entries');
  }
  const res = auditTrusted(trusted, state);
  for (const v of res.violations) violations.push(v);
  console.log('closure: ' + res.entries + ' board pids vs ' + res.known + ' state pids; state-only (benign, e.g. post-wipe) ' + res.stateOnly);

  // 3) shard/report hygiene + telemetry
  let recCount = 0, startCount = 0, garbage = 0, shardEntries = 0;
  for (const b of shardBoards) {
    if ((b.entries | 0) === 0) continue;
    const br = await readBoardAll(b.id || b.ID, 'shard');
    for (const e of br.ents) {
      shardEntries++;
      const d = decodeDetails(e.detailData);
      if (d[0] === 0xB1) recCount++; else if (d[0] === START_MAGIC) startCount++; else garbage++;
    }
  }
  if (garbage) ghWarn('shards carry ' + garbage + ' entries with unknown magic (client-writable noise; watch the trend)');
  console.log('shards: ' + shardEntries + ' entries (' + recCount + ' records / ' + startCount + ' attestations / ' + garbage + ' unknown)');
  let repEntries = 0, repMalformed = 0;
  if (byName[REPORT_LB] && byName[REPORT_LB].entries > 0) {
    const br = await readBoardAll(byName[REPORT_LB].id, 'report board');
    for (const e of br.ents) { repEntries++; if (decodeDetails(e.detailData)[0] !== REPORT_MAGIC) repMalformed++; }
  }
  console.log('report box: ' + repEntries + ' entries (' + repMalformed + ' malformed)');
  const sz = f => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
  const stateBytes = ['skill.json', 'xp.json', 'leavers.json', 'processed.json', 'starts.json', 'signals.json']
    .map(f => sz(process.env[f.replace('.json', '').toUpperCase() + '_FILE'] || f)).reduce((a, b) => a + b, 0);
  console.log('state size: ' + stateBytes + ' bytes; signals pairs: ' + Object.keys((state.signals && state.signals.pairs) || {}).length);

  // summary + verdict
  const p = process.env.GITHUB_STEP_SUMMARY;
  if (p) {
    try {
      fs.appendFileSync(p, [
        '### audit', '| metric | value |', '|---|---|',
        '| violations | ' + violations.length + ' |',
        '| shards / entries | ' + shardBoards.length + ' / ' + shardEntries + ' |',
        '| records / attestations / unknown | ' + recCount + ' / ' + startCount + ' / ' + garbage + ' |',
        '| trusted entries (rating/points/trust' + (XP_LB ? '/xp' : '') + ') | ' + trustedWant.map(w => (trusted[w[1]] || []).length).join(' / ') + ' |',
        '| state pids / state-only | ' + res.known + ' / ' + res.stateOnly + ' |',
        '| report box entries / malformed | ' + repEntries + ' / ' + repMalformed + ' |',
        '| state bytes / signal pairs | ' + stateBytes + ' / ' + Object.keys((state.signals && state.signals.pairs) || {}).length + ' |',
        '| duration | ' + ((Date.now() - t0) / 1000).toFixed(1) + 's |', '',
      ].join('\n'));
    } catch (e) {}
  }
  if (violations.length) {
    for (const v of violations) ghErr(v);
    process.exit(1);
  }
  console.log('audit clean (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
}

if (require.main === module) {
  main().catch(e => { ghErr('audit failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = { auditTrusted, ENDLESS_TRUSTED, seasonTwinOf, LIKE_BOARDS, LIKE_TRUSTED };
