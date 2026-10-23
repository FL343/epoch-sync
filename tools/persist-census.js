#!/usr/bin/env node
'use strict';
// ============================================================
// tools/persist-census.js -- read-only O199 census of persistent-face layout versions on one channel's live boards
// ============================================================
// Architecture decision 9: an old decoder may go only when its acceptance window is over AND no record of that version is
//   left to read. The rule that counts (client knife 5.5b-1 S6) is the UNSETTLED records: a settled record is never decoded
//   again, and a player who never comes back leaves his old rows on the shards for good. Save rows are different: a casual /
//   classic save row is read when its owner resumes, however old -- save-row decoders are never removed (registry `atLeast`).
// What it prints (pid-free; counts only):
//   shards: every result record by ledger header version, guard-signed solo segments by attestation layout, other endless
//           records by tail length -- all, and the ones not settled yet (when the channel's processed file is given)
//   save boxes: every row by layout version, per box board
// Reads the boards with the publisher key, writes nothing (no POST at all). The reconcile prints the unsettled part every run
//   (step summary row "unsettled records by layout version") -- this tool adds the save boxes and the settled history.
// Usage: STEAM_PUBLISHER_KEY=... APPID=<channel app id> LB_PREFIX=<shard prefix> STATE_SALT=... \
//          node tools/persist-census.js [--processed=<channel>-processed.json] [--json]
// ============================================================
const fs = require('fs');
const path = require('path');
const v = require('../validate.js');

const SAVE_MAGIC = 0xBA;   // save_box row header low byte (the version sits in bits 8-15)
// save rows by board -> { board: { ver: n } } (pure)
function saveBoxCensus(rowsByBoard) {
  const out = {};
  for (const name of Object.keys(rowsByBoard || {})) {
    const c = out[name] = {};
    for (const d of rowsByBoard[name] || []) {
      if (!Array.isArray(d) || !d.length || (d[0] & 0xff) !== SAVE_MAGIC) continue;
      const ver = (d[0] >>> 8) & 0xff;
      c[ver] = (c[ver] | 0) + 1;
    }
  }
  return out;
}

async function main() {
  const KEY = process.env.STEAM_PUBLISHER_KEY, APPID = process.env.APPID, PREFIX = process.env.LB_PREFIX;
  if (!KEY || !APPID || !PREFIX) { console.error('set STEAM_PUBLISHER_KEY / APPID / LB_PREFIX (and STATE_SALT)'); process.exit(2); }
  const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
  let processed = null;
  if (arg('processed')) processed = new Set(JSON.parse(fs.readFileSync(path.resolve(arg('processed')), 'utf8')));
  const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + KEY + '&appid=' + APPID + '&format=json');
  if (!lr.ok) { console.error('listing failed HTTP ' + lr.status); process.exit(1); }
  const boards = (lr.json && lr.json.response && lr.json.response.leaderboards) || [];
  const listed = boards.filter((b) => String(b.name || b.Name).indexOf(PREFIX) === 0 && String(b.name || b.Name).indexOf('test') < 0);
  const sel = v.shardPlan(listed.map((b) => String(b.name || b.Name)), PREFIX, v.LEDGER_SHARDS, false);
  const recs = [];
  for (const b of listed.filter((x) => sel.read.indexOf(String(x.name || x.Name)) >= 0)) {
    const rr = await v.readBoardAll(b.id || b.ID, 'shard');
    for (const e of rr.ents) { const d = v.decodeDetails(e.detailData); if (d && d[0] === 0xB1) recs.push({ d }); }
  }
  const rows = {};
  for (const b of boards.filter((x) => /save_box/.test(String(x.name || x.Name)) && !/test/.test(String(x.name || x.Name)))) {
    const rr = await v.readBoardAll(b.id || b.ID, 'save box');
    rows[String(b.name || b.Name)] = rr.ents.map((e) => v.decodeDetails(e.detailData));
  }
  const all = v.persistCensus(recs, null), open = processed ? v.persistCensus(recs, processed) : null, sb = saveBoxCensus(rows);
  if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify({ shards: sel.read.length, records: recs.length, all, unsettled: open, saveBoxes: sb }, null, 1) + '\n'); return; }
  console.log('shards read ' + sel.read.length + ' (' + recs.length + ' result records)');
  console.log('  all        ' + v.fmtCensus(all));
  if (open) console.log('  unsettled  ' + v.fmtCensus(open));
  for (const name of Object.keys(sb).sort()) console.log('save box ' + name + ': ' + (Object.keys(sb[name]).sort((a, b) => a - b).map((k) => 'v' + k + ' ' + sb[name][k]).join(', ') || '(empty)'));
}

module.exports = { saveBoxCensus, SAVE_MAGIC };
if (require.main === module) main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
