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
const { readBoardAll, pid, decodeDetails, getJson, BASE, TRUST_LB, REPORT_LB, START_MAGIC, REPORT_MAGIC } = require('./validate.js');

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
  const want = [[RANKED_LB, 'rating'], [LP_LB, 'points'], [TRUST_LB, 'trust'], [REPORT_LB, 'report']];
  if (XP_LB) want.push([XP_LB, 'xp']);
  for (const [name, label] of want) if (!byName[name]) violations.push(label + ' board missing from listing');
  const shardBoards = all.filter(b => { const n = String(b.name || b.Name); return n.indexOf(PREFIX) === 0 && n.indexOf('test') < 0; });
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
  const trustedWant = [[RANKED_LB, 'rating'], [LP_LB, 'points'], [TRUST_LB, 'trust']];
  if (XP_LB) trustedWant.push([XP_LB, 'xp']);
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
module.exports = { auditTrusted };
