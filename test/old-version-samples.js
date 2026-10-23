'use strict';
// O199 (architecture decision 9): every OLD persisted layout this job still accepts is pinned by a sample that the SHIPPED
//   writer of that build produced -- not by today's encoder run with an old version number (today's encoder and today's
//   decoder share one author: a misremembered layout is wrong on both sides and a self-made sample stays green).
//   The samples (test/fixtures/old-samples/) are generated in the client repo from the shipped commits' own sources
//   (guard C++ headers compiled as they shipped, the client ledger writer run as it shipped) and derived here as data only.
//   Accepted old versions pinned here:
//     save_box rows ver 2 (shipped 2026-09-07; today 6)        -> the plaintext head the prune reads
//     solo attest records attVer 3 (shipped 2026-09-07; today 5) -> signature, fields, sanity, settle gate, perk / reroll rules
//     solo attest attVer 5 from a guard before the resume tag  -> same version number as today, tag reads 0
//     team endless tails of 4 / 6 / 11 ints (today 12)          -> tail decode with the defaults, consensus, sanity, perk replay
//   [0] the manifest: every sample's sha256, nothing unlisted, every covered version has its sample
//   [1] save_box v2 heads through the detail-hex round trip the prune uses
//   [2] solo attest v3 + old-writer v5: verify, fields (+ defaults for fields the old layout lacks), soloTail, soloSanity,
//       settle gate owner binding, perk replay + reroll bounds; a flipped signature / body int -> bad-sig; unknown key -> pending
//   [3] team tails 4 / 6 / 11: endlessTail per record (defaults for absent ints), scores / roster / seat, zero-tail
//       abstention, sanityFlags + recordSanityFlags clean, reroll bounds + perk replay
//   [4] mutation self-check: a shifted tail, a lost body int and an edited sample are each caught by the checks above
// Pure, in-process: no state files, no network, nothing written.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
for (const k of ['PT_MODE', 'SEASON_NOW', 'RESUME_TAG_REQUIRED']) delete process.env[k];
const ROOT = path.join(__dirname, '..');
const v = require(path.join(ROOT, 'validate.js'));
const A = require(path.join(ROOT, 'attest.js'));
const perks = require(path.join(ROOT, 'perks.js'));
const DIR = path.join(__dirname, 'fixtures', 'old-samples');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const sortKeys = (o) => { const r = {}; for (const k of Object.keys(o).sort()) r[k] = o[k]; return r; };
const eq = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const diff = (a, b) => { const out = []; for (const k of new Set(Object.keys(a).concat(Object.keys(b)))) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k + ': ' + JSON.stringify(a[k]) + ' vs ' + JSON.stringify(b[k])); return out.join('; '); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const load = (n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8'));

console.log('=== O199: old-version samples from the shipped writers still read the same ===');

// ---- [0] manifest ----
const M = load('MANIFEST.json');
{
  const listed = Object.keys(M.files || {});
  const onDisk = fs.readdirSync(DIR).filter((n) => n !== 'MANIFEST.json').sort();
  T('[0] every sample on disk is listed (and nothing listed is missing)', JSON.stringify(onDisk) === JSON.stringify(listed.slice().sort()),
    'disk ' + onDisk.join(',') + ' / listed ' + listed.join(','));
  for (const n of listed) {
    const p = path.join(DIR, n);
    T('[0] sha256 of ' + n, fs.existsSync(p) && sha256(fs.readFileSync(p)) === M.files[n]);
  }
  const want = [['save_box', 2], ['attest_solo', 3], ['endless_tail', 4], ['endless_tail', 6], ['endless_tail', 11]];
  for (const [face, ver] of want) {
    const c = (M.covers || []).find((x) => x.face === face && x.v === ver);
    T('[0] accepted ' + face + ' v' + ver + ' is covered by a listed sample', !!(c && M.files[c.file]));
  }
  T('[0] the old-writer attVer 5 sample is listed', !!((M.extras || []).find((x) => x.face === 'attest_solo' && x.v === 5 && M.files[x.file])));
}

// ---- [1] save_box v2 heads ----
function checkSaveRows(j) {
  const errs = [];
  for (const r of j.rows) {
    if (!Array.isArray(r.ints) || r.ints.length !== 38) { errs.push(r.name + ': ' + (r.ints || []).length + ' ints (v2 rows are 38)'); continue; }
    const h = A.saveBoxHead(v.decodeDetails(v.encodeDetails(r.ints)));   // the prune reads e.detailData through decodeDetails
    if (!h || !eq(h, r.head)) errs.push(r.name + ': head ' + (h ? diff(h, r.head) : 'null'));
  }
  return errs;
}
const SB = load('save-box-v2-rows.json');
{
  const errs = checkSaveRows(SB);
  T('[1] ' + SB.rows.length + ' save_box v2 rows: the head reads as the shipped guard wrote it', !errs.length, errs.join(' | '));
  T('[1] the samples include a consumed tombstone and team rows', SB.rows.some((r) => r.head.consumed) && SB.rows.some((r) => r.name.indexOf('duo') >= 0));
  T('[1] every row carries ver 2 in the head (the job reads any accepted version)', SB.rows.every((r) => r.head.ver === 2));
}

// ---- [2] solo attest records ----
const STRANGER = '76561198000000077';
const tableOf = (j) => { const t = {}; for (const r of j.records) t[String(r.keyId)] = { pubs: [j.pub], sealed: true }; return t; };
const ATT_DEFAULTS = { build: 0, picksLo: 0, picksHi: 0, picks: '0', rerollLo: 0, rerollHi: 0, rerolls: '0', resumeTag: 0 };
function checkAttest(j, table) {
  const errs = [];
  for (const r of j.records) {
    const res = A.verifySoloRecord(r.ints, table);
    if (!res.ok) { errs.push(r.name + ': verify ' + res.reason); continue; }
    if (res.sealed !== !!r.sealed) errs.push(r.name + ': sealed ' + res.sealed);
    const want = Object.assign({}, ATT_DEFAULTS, r.expect);
    if (!eq(res.fields, want)) errs.push(r.name + ': fields ' + diff(res.fields, want));
    const f = res.fields;
    const st = A.soloTail(r.ints);
    const stWant = { startDepth: f.startDepth, endDepth: f.endDepth, continuesUsed: f.continuesUsed, tokensCp: f.tokensCp, seasonId: f.seasonId, flags: f.flags,
      build: f.build, picksLo: f.picksLo, picksHi: f.picksHi, rerollLo: f.rerollLo, rerollHi: f.rerollHi, keyId: f.keyId, attVer: f.attVer, resumeTag: 0 };
    if (!st || !eq(st, stWant)) errs.push(r.name + ': soloTail ' + (st ? diff(st, stWant) : 'null'));
    const san = v.soloSanity(f);
    if (san.length) errs.push(r.name + ': soloSanity [' + san.join(',') + ']');
    const g1 = A.soloSettleGate(res, { owner: j.owner });
    if (!g1.settle) errs.push(r.name + ': settle gate ' + g1.reason);
    const g2 = A.soloSettleGate(res, { owner: STRANGER });
    if (g2.settle || g2.reason !== 'owner-mismatch') errs.push(r.name + ': a stranger row owner was not refused (' + g2.reason + ')');
    const pv = perks.verifyPerkPicks(f, null, 1);
    if (!pv.ok) errs.push(r.name + ': perk replay ' + pv.reason + ' ' + pv.why);
    const casual = !!(f.flags & A.SEG_CASUAL);
    const rc = v.rerollChain(f, null, casual ? v.CASUAL_LIVES : 0);
    if (rc) errs.push(r.name + ': reroll ' + rc);
  }
  return errs;
}
const AT3 = load('attest-solo-v3.json'), AT5 = load('attest-solo-v5-oldwriter.json');
{
  T('[2] the attVer 3 layout is still a layout this job reads', !!(A.LAYOUTS && A.LAYOUTS[3]));
  for (const j of [AT3, AT5]) {
    const tbl = tableOf(j);
    const errs = checkAttest(j, tbl);
    T('[2] ' + j.records.length + ' attVer ' + j.attVer + (j.oldWriterOfCurrent ? ' (old writer)' : '') + ' records verify and read as signed', !errs.length, errs.join(' | '));
    T('[2] attVer ' + j.attVer + ' samples carry the version byte ' + j.attVer + ' and no resume tag bits',
      j.records.every((r) => (r.ints[21] & 0xff) === j.attVer && ((r.ints[21] >>> A.RESUME_TAG_SHIFT) & A.RESUME_TAG_MASK) === 0));
    const r0 = j.records[0];
    const lay = A.LAYOUTS[j.attVer];
    const flipSig = r0.ints.slice(); flipSig[lay.baseLen + 3] ^= 1;
    T('[2] attVer ' + j.attVer + ': a flipped signature int -> bad-sig', A.verifySoloRecord(flipSig, tbl).reason === 'bad-sig');
    const flipBody = r0.ints.slice(); flipBody[10] = (flipBody[10] | 0) + 1;
    T('[2] attVer ' + j.attVer + ': a changed score under the signature -> bad-sig', A.verifySoloRecord(flipBody, tbl).reason === 'bad-sig');
    const un = A.verifySoloRecord(r0.ints, {});
    T('[2] attVer ' + j.attVer + ': an unregistered key -> pending (unknown-key), never rejected', !un.ok && un.pending && un.reason === 'unknown-key');
  }
  T('[2] the old-writer samples carry perks and rerolls (the replay ran, not the trivial no-perk path)',
    AT5.records.some((r) => r.expect.picksLo && r.expect.rerollLo));
}

// ---- [3] team endless tails ----
const TAIL_DEFAULTS = { seasonId: -1, flags: 0, build: 0, picksLo: 0, picksHi: 0, rerollLo: 0, rerollHi: 0, resumeTag: 0 };
function recsOf(run) {
  return run.records.map((x) => {
    const d = x.details, pc = d[8] | 0;
    return { steamID: x.steamID, d, dispCode: d.length > 10 + pc ? (d[10 + pc] | 0) : 0, roster: v.decodeRoster(d), seat: x.seat, zeroTail: !!x.zeroTail };
  });
}
function checkRun(run, ver) {
  const errs = [], pc = run.pc;
  const g = recsOf(run);
  const want = Object.assign({}, TAIL_DEFAULTS, run.tail);
  const rosterWant = {}; run.roster.forEach((s, i) => { rosterWant[i] = s; });
  for (const r of g) {
    const d = r.d, tag = run.name + '@' + r.seat;
    if ((d[0] & 0xff) !== 0xB1 || d[1] !== 3 || d[2] !== 7 || (d[8] | 0) !== pc || (d[5] | 0) !== r.seat) { errs.push(tag + ': header ' + d.slice(0, 9).join(',')); continue; }
    if (d.length !== 11 + 3 * pc + ver) errs.push(tag + ': ' + d.length + ' ints (want ' + (11 + 3 * pc + ver) + ')');
    if (JSON.stringify(d.slice(10, 10 + pc)) !== JSON.stringify(run.scores)) errs.push(tag + ': scores ' + d.slice(10, 10 + pc).join(','));
    if (!eq(r.roster, rosterWant)) errs.push(tag + ': roster ' + diff(r.roster, rosterWant));
    const t = v.endlessTail(d);
    if (!t) { errs.push(tag + ': no tail'); continue; }
    if (r.zeroTail) {
      if (t.startDepth || t.endDepth || t.continuesUsed || t.tokensCp) errs.push(tag + ': zero tail reads non-zero');
    } else if (!eq(t, want)) errs.push(tag + ': tail ' + diff(t, want));
    const rs = v.recordSanityFlags(r, 7, pc);
    if (rs.length) errs.push(tag + ': recordSanityFlags [' + rs.join(',') + ']');
  }
  const ab = v.endlessAbstention(g, 8);
  const canon = g.findIndex((r) => !r.zeroTail);
  if (!ab.same || ab.canonIdx !== canon) errs.push(run.name + ': abstention ' + JSON.stringify(ab) + ' (canonical writer ' + canon + ')');
  const gRot = g.slice(); if (canon > 0) gRot.unshift(gRot.splice(canon, 1)[0]);
  const sf = v.sanityFlags(gRot);
  if (sf.length) errs.push(run.name + ': sanityFlags [' + sf.join(',') + ']');
  const t0 = v.endlessTail(gRot[0].d);
  if (t0) {
    const rc = v.rerollChain(t0, null);
    if (rc) errs.push(run.name + ': reroll ' + rc);
    const pv = perks.verifyPerkPicks({ build: t0.build >>> 0, picksLo: t0.picksLo | 0, picksHi: t0.picksHi | 0, seasonId: t0.seasonId | 0, endDepth: t0.endDepth | 0 }, null, pc);
    if (!pv.ok) errs.push(run.name + ': perk replay ' + pv.reason + ' ' + pv.why);
  }
  return errs;
}
const TAILS = { 4: load('endless-tail-v4.json'), 6: load('endless-tail-v6.json'), 11: load('endless-tail-v11.json') };
{
  for (const ver of [4, 6, 11]) {
    const j = TAILS[ver];
    T('[3] tail ' + ver + ': sample header says ver ' + ver, j.ver === ver);
    for (const run of j.runs) {
      const errs = checkRun(run, ver);
      T('[3] tail ' + ver + ' ' + run.name + ' (' + run.pc + ' seats, ' + run.records.length + ' records)', !errs.length, errs.join(' | '));
    }
  }
  T('[3] the samples include a cold-rejoin zero tail', [4, 6, 11].some((ver) => TAILS[ver].runs.some((r) => r.records.some((x) => x.zeroTail))));
  T('[3] the tail 11 samples carry a non-trivial perk log', TAILS[11].runs.some((r) => r.tail.picksLo && r.tail.rerollLo));
  T('[3] the tail 6 / 11 flag tables still match this job (COMP / SUSPENDED / FINAL / RESUMED / CLASSIC)',
    TAILS[6].flagsTable.COMP === A.SEG_COMP && TAILS[6].flagsTable.SUSPENDED === A.SEG_SUSPENDED && TAILS[6].flagsTable.FINAL === A.SEG_FINAL &&
    TAILS[6].flagsTable.RESUMED === A.SEG_RESUMED && TAILS[11].flagsTable.CLASSIC === A.SEG_CLASSIC);
}

// ---- [4] mutation self-check: the checks above can fail ----
{
  const run = JSON.parse(JSON.stringify(TAILS[11].runs[0]));
  for (const x of run.records) { const pc = x.details[8] | 0; x.details.splice(11 + 3 * pc, 0, 0); x.details.pop(); }   // tail one int later
  T('[4] a tail read one int off is caught', checkRun(run, 11).length > 0);
  const run4 = JSON.parse(JSON.stringify(TAILS[4].runs[0]));
  for (const x of run4.records) x.details.pop();   // lost the last tail int (tokensCp)
  T('[4] a record that lost a tail int is caught', checkRun(run4, 4).length > 0);
  const sb = JSON.parse(JSON.stringify(SB)); sb.rows[0].ints[2] = 1;   // consumed bit set by hand
  T('[4] a changed save_box head is caught', checkSaveRows(sb).length > 0);
  const at = JSON.parse(JSON.stringify(AT3)); at.records[0].expect.endDepth = 6;
  T('[4] an expectation that disagrees with the signed record is caught', checkAttest(at, tableOf(at)).length > 0);
  const n0 = Object.keys(M.files)[0];
  const edited = Buffer.concat([fs.readFileSync(path.join(DIR, n0)), Buffer.from(' ')]);
  T('[4] an edited sample no longer matches its manifest sha256', sha256(edited) !== M.files[n0]);
}

console.log(failN ? '\nFAIL ' + failN : '\nall ok');
process.exit(failN ? 1 : 0);
