'use strict';
// Q417 (O920, cloud 2026-11-19): every endless lane that checks the affix reroll bitmap gives the run as much reach as an
// honest client can take. Found by the O919 audit trail: a launch-night casual duo 0->76 was rejected whole
// ("endless reroll bitmap sanity REJECT (reroll-ahead) ... (Q314)", nobody settled) -- the casual co-op lane checked the
// bitmap with no slack, while the solo / couch casual lane gives the run's lives (O218).
// Why a slack at all (client gm_ruffle mvp/src/systems/endless-run.js computeVerdict + modifiers.js rerollTargetOf):
//   a level is played at depth d; pass -> passed + 1; fail -> fails + 1 and the run still moves on to d + 1 (a continue
//   erases a fail: passed + 1, fails - 1); fails reaching LIVES = over. The reroll window opens at the end of a PASSED,
//   not-over level d with d % 3 == 2 and asks about d + 1. The tail carries endDepth = the final passed count. So a paid
//   reroll's target can sit past endDepth + 1 by the fails the run had when it asked -- at most LIVES - 1, and the solo lane
//   already allows LIVES (CASUAL_LIVES). A team competitive segment has one life: no fail before an ask, no slack.
//   [1] every rerollChain call site in validate.js is a known lane with a known slack (a new site trips this: say which
//       lane it is and how far an honest run reaches there)
//   [2] property: seeded honest casual co-op / solo casual runs (lives 3, continues, paid rerolls) pass the lane's check
//       with the slack the lane passes; honest team competitive segments (one life) pass with none
//   [3] the slack is not a door: a bit past endDepth + 1 + lives is still reroll-ahead in every casual lane
//   [4] mutation self-check: each lane's slack taken out -> [2] goes red for that lane
const fs = require('fs'), path = require('path');
process.env.STATE_SALT = 's';
const VALIDATE = path.join(__dirname, '..', 'validate.js');
const SRC = fs.readFileSync(VALIDATE, 'utf8');
const v = require(VALIDATE);

let failN = 0;
const T = (label, cond, detail) => { if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); } };

// the known call sites: [lane, exact call text, which slack the lane must pass]
const SITES = [
  ['co-op canon vote (Q306 reach)', 'rerollChain({ rerollLo: lo | 0, rerollHi: hi | 0, endDepth: t0.endDepth | 0 }, null, rrSlack)', 'rrSlack'],
  ['solo / couch lane', 'rerollChain(f, soloState.runs[key], (casual || ccCas) ? CASUAL_LIVES : 0,', '(casual || ccCas) ? CASUAL_LIVES : 0'],
  ['team competitive segment lane', 'rerollChain(f, soloState.runs[key]);', '0'],
  ['casual co-op lane', 'rerollChain({ rerollLo: t.rerollLo >>> 0, rerollHi: t.rerollHi >>> 0, endDepth: t.endDepth | 0 }, null, CASUAL_LIVES);', 'CASUAL_LIVES'],
];
// casual vs competitive slack of the canon vote, as the source decides it
const RR_SLACK_LINE = 'const rrSlack = ((t0.flags | 0) & attest.SEG_COMP) ? 0 : CASUAL_LIVES;';

function sitesOf(src) {
  const out = [];
  const re = /rerollChain\(/g; let m;
  while ((m = re.exec(src))) { if (/function\s+$/.test(src.slice(Math.max(0, m.index - 9), m.index))) continue; out.push(m.index); }
  return out;
}

console.log('-- [1] every rerollChain call site is a known lane --');
{
  const at = sitesOf(SRC);
  T('[1] ' + SITES.length + ' call sites (found ' + at.length + ')', at.length === SITES.length, at.map((i) => SRC.slice(i, i + 80)).join(' | '));
  for (const [lane, text] of SITES) T('[1] ' + lane + ': its call is there exactly once', SRC.split(text).length === 2, text);
  T('[1] the canon vote: casual co-op gets CASUAL_LIVES, team competitive 0', SRC.split(RR_SLACK_LINE).length === 2);
  T('[1] CASUAL_LIVES is the client\'s ENDLESS.LIVES (3)', v.CASUAL_LIVES === 3, String(v.CASUAL_LIVES));
}

// honest runs (the client's rules), seeded
let seed = 0x0417c0de;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
function honestRun(lives, pFail, pCont, pPay, maxD) {
  let passed = 0, fails = 0, lo = 0, hi = 0, d = 0;
  for (;;) {
    d++;
    const pass = rnd() >= pFail;
    if (pass) passed++; else fails++;
    let over = !pass && fails >= lives;
    if (!pass && pCont && rnd() < pCont) { passed++; fails--; over = false; }
    if (over) break;
    if (pass && d % 3 === 2 && rnd() < pPay) { const k = (d + 1 - 3) / 3; if (k < 32) lo = (lo | (1 << k)) >>> 0; else if (k < 64) hi = (hi | (1 << (k - 32))) >>> 0; }
    if (d >= maxD) break;
  }
  return { rerollLo: lo, rerollHi: hi, endDepth: passed };
}
const casualRuns = [], compRuns = [];
for (let i = 0; i < 4000; i++) casualRuns.push(honestRun(3, 0.1 + 0.25 * rnd(), rnd() < 0.3 ? 0.5 : 0, 0.3 + 0.7 * rnd(), 4 + Math.floor(rnd() * 120)));
for (let i = 0; i < 1000; i++) compRuns.push(honestRun(1, 0.05 + 0.2 * rnd(), 0, 0.3 + 0.7 * rnd(), 4 + Math.floor(rnd() * 120)));
const withBits = casualRuns.filter((r) => r.rerollLo || r.rerollHi).length;
// the slack each lane passes, read back from the source text (the property runs against what validate.js does)
function laneSlacks(src, mod) {
  const has = (t) => src.split(t).length === 2;
  return {
    canonCasual: has(RR_SLACK_LINE) ? mod.CASUAL_LIVES : 0,
    soloCasual: has(SITES[1][1]) ? mod.CASUAL_LIVES : 0,
    coopCasual: has(SITES[3][1]) ? mod.CASUAL_LIVES : 0,
  };
}
function property(src, mod) {
  const s = laneSlacks(src, mod);
  const rej = (runs, slack) => runs.filter((r) => mod.rerollChain(r, null, slack)).length;
  // the canon vote's casual reach (end to end through endlessRerollCanon: test/endless-reroll-vote.js [1] / [4])
  return { coop: rej(casualRuns, s.coopCasual), solo: rej(casualRuns, s.soloCasual), canon: rej(casualRuns, s.canonCasual), comp: rej(compRuns, 0) };
}

console.log('-- [2] honest runs pass every lane --');
{
  const p = property(SRC, v);
  T('[2] ' + casualRuns.length + ' honest casual runs (' + withBits + ' with a paid reroll): the casual co-op lane rejects none', p.coop === 0, String(p.coop));
  T('[2] the same runs: the solo / couch casual lane rejects none', p.solo === 0, String(p.solo));
  T('[2] the same runs: the canon vote finds every honest casual bitmap reachable', p.canon === 0, String(p.canon));
  T('[2] ' + compRuns.length + ' honest team competitive segments (one life): no slack needed, none rejected', p.comp === 0, String(p.comp));
  T('[2] control: with no slack the casual runs DO get rejected (the shape O920 hit)', casualRuns.filter((r) => v.rerollChain(r, null, 0)).length > 0);
  T('[2] the launch-night shape: duo 0->76 with a paid reroll for 78 (bit 25) settles under the casual slack', v.rerollChain({ rerollLo: (1 << 25) >>> 0, rerollHi: 0, endDepth: 76 }, null, v.CASUAL_LIVES) === null);
}

console.log('-- [3] the slack is not a door --');
{
  // endDepth e reaches target 3+3k only while 3+3k <= e + 1 + lives
  let bad = 0;
  for (let e = 0; e <= 80; e++) {
    const kMax = Math.floor((e + 1 + v.CASUAL_LIVES - 3) / 3);
    const k = kMax + 1;
    if (k < 0 || k > 63) continue;
    const f = { rerollLo: k < 32 ? (1 << k) >>> 0 : 0, rerollHi: k >= 32 ? (1 << (k - 32)) >>> 0 : 0, endDepth: e };
    if (v.rerollChain(f, null, v.CASUAL_LIVES) !== 'reroll-ahead') bad++;
  }
  T('[3] a bit one target past endDepth + 1 + lives is reroll-ahead at every depth 0..80', bad === 0, String(bad));
  T('[3] team competitive: a bit past endDepth + 1 is still reroll-ahead (target 9 at passed 6)', v.rerollChain({ rerollLo: 4, rerollHi: 0, endDepth: 6 }, null, 0) === 'reroll-ahead');
}

console.log('-- [4] mutation self-check --');
{
  const mut = [
    ['the casual co-op lane loses its slack', SITES[3][1], SITES[3][1].replace(', null, CASUAL_LIVES);', ', null);'), 'coop'],
    ['the solo / couch casual lane loses its slack', SITES[1][1], SITES[1][1].replace('(casual || ccCas) ? CASUAL_LIVES : 0,', '0,'), 'solo'],
    ['the canon vote loses its casual slack', RR_SLACK_LINE, 'const rrSlack = 0;', 'canon'],
  ];
  for (const [label, from, to, key] of mut) {
    if (SRC.split(from).length !== 2) { T('[4] ' + label + ': anchor found once', false); continue; }
    const msrc = SRC.replace(from, to);
    const p = property(msrc, v);
    T('[4] ' + label + ' -> [2] goes red for it', p[key] > 0, JSON.stringify(p));
  }
}

console.log(failN ? ('FAIL x' + failN + ' (reroll-slack-lanes)') : 'ALL OK (reroll-slack-lanes)');
process.exit(failN ? 1 : 0);
