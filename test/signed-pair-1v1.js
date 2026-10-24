'use strict';
// Client knife 5.8b: the guard match signature block (0xE5) on a quick / ranked 1V1 whose two records disagree.
//   Every human of a multiplayer match now asks his guard for the block: the host's guard signs its own core's final table (role
//   own), a joiner's guard re-signs the host core's frozen table it got over the guard channel (role relay, source = the host).
//   A modded loser who writes a record giving himself the win gets no block, so a disputed two-voice key has at most one usable
//   signed side (validate.js signedPairOf / applySignedPair, MSIG_PAIR):
//   [1] units: signedPairOf -- one usable side (no block / a broken one on the other), both signed, pending, untrusted, the keys
//       the lane does not take (party bits, three seats, a Q61 gamble tag, a writer's own duration fault, one account twice);
//       signedPairSynth (the other writer re-seated on the signed table: rank, win bit, the block gone); dualSignedCount (once
//       per key on both); msigCoverage (agreeing keys signed on all / some / no writer, the 1V1 lane apart)
//   [2] end to end over the REAL validate.js main() (offline board stub, a copy of this tree with one test signing key):
//       record (the shipped mode): the disputed key logs what it would settle and goes on EXACTLY as with the lane off (every
//       XP / rating / points / CP write and the processed set equal); the summary row counts it; agreeing signed keys counted
//   [3] enforce: the honest winner's signed table settles the key -- both players rated (the modded loser as the loser), both
//       paid as an honest match of that table pays, no dispute counted, nobody flagged for a missing block; a broken block on
//       the loser's record flags him ('at'); both signed and still disagreeing -> the old path (void at the start verdict) and
//       ds counted on both; a block the job cannot judge yet -> nothing moves; an untrusted block -> nothing moves
//   [4] seedcap: with enforce, a disputed 1V1 with one usable signed side is audited on that side's scores; record -> not audited
//   [5] wiring pins
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
process.env.STATE_SALT = 's';
delete process.env.MSIG_PAIR;
const ROOT = path.join(__dirname, '..');
const MS = require(path.join(ROOT, 'match-sig.js'));
const G = require(path.join(ROOT, 'tools', 'gen-match-sig-fixtures.js'));
const v = require(path.join(ROOT, 'validate.js'));
const H = require('./lib/settle-stub');

let failN = 0;
const ok = (m) => console.log('  ok    ' + m);
const bad = (m) => { failN++; console.log('  FAIL  ' + m); };
const T = (label, cond, detail) => { if (cond) ok(label); else bad(label + (detail ? ' -- ' + detail : '')); };
const eq = (label, got, want) => T(label, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));

const KEY = 2099102302;
const TABLE = { [String(KEY)]: { pubs: [G.PUB_HEX], sealed: true }, dev: { pubs: [G.PUB_HEX], sealed: false } };
const HO = H.SID(5801), JO = H.SID(5802), TH = H.SID(5803);
const lo = (s) => H.sidPair(s)[0];
const HON = [7000, 4000], LIE = [4000, 9000];   // HO (seat 0) won 7000 to 4000; JO (seat 1) claims 9000 to 4000
// a 1V1 result record: seat, the scores it claims, mt (1 quick / 2 ranked), roster
function res(seat, sc, o) {
  o = o || {};
  const ros = o.ros || [HO, JO];
  const pc = ros.length;
  const rank = 1 + sc.filter((x) => x > sc[seat]).length;
  const d = H.rec(0xB1, o.mt || 1, o.hash || 0x5801, seat, rank, rank === 1, ros, sc, 0);
  if (o.dur != null) d[9] = o.dur;
  void pc;
  return d;
}
const start = (seat, o) => H.rec(0xB2, (o && o.mt) || 1, (o && o.hash) || 0x5801, seat, 0, false, (o && o.ros) || [HO, JO], null, 0);
// the block as the guard builds it: host = role own, a joiner = role relay; source = the host's account
function signed(d, role, o) {
  o = o || {};
  const h5 = MS.head(o.keyId == null ? KEY : o.keyId, o.flags == null ? MS.packFlags({ role, seen: 3 }) : o.flags, o.xcheck || 0, lo(o.src || HO));
  const sig = crypto.sign(null, Buffer.from(MS.message(d, h5, null)), G.privKey());
  return MS.attach(d, h5.concat(MS.sigInts([...sig])));
}
const R = (sid, d) => ({ steamID: sid, d, roster: v.decodeRoster(d), dispCode: 0, shard: 's' });
const tamper = (d) => { const x = d.slice(); x[x.length - 3] ^= 1; return x; };

console.log('=== client knife 5.8b: signed 1V1 disputes ===');
// ---- [1] units ----
console.log('[1] signedPairOf / signedPairSynth / dualSignedCount / msigCoverage');
{
  const sp = (g) => v.signedPairOf(g, TABLE, false);
  const hostOk = R(HO, signed(res(0, HON), 1)), joinLie = R(JO, res(1, LIE));
  const one = sp([hostOk, joinLie]);
  eq('host signed, the loser\'s lie unsigned -> one (a = the host, o = the loser, why none)', [one.state, one.a, one.o, one.oWhy], ['one', HO, JO, 'none']);
  const two = sp([R(HO, res(0, LIE)), R(JO, signed(res(1, HON), 2))]);
  eq('the joiner\'s relayed signature, the host\'s lie unsigned -> one (a = the joiner)', [two.state, two.a, two.o], ['one', JO, HO]);
  eq('the loser\'s record with a broken block -> one, why bad', [sp([hostOk, R(JO, tamper(signed(res(1, LIE), 2)))]).state, sp([hostOk, R(JO, tamper(signed(res(1, LIE), 2)))]).oWhy], ['one', 'bad']);
  eq('both signed, different tables (a leaked key) -> dual', sp([hostOk, R(JO, signed(res(1, LIE), 2))]).state, 'dual');
  eq('a key the table does not list -> pending', sp([R(HO, signed(res(0, HON), 1, { keyId: 2099999999 })), joinLie]).state, 'pending');
  eq('an untrusted block on the signed side (cross-check trouble) -> other', sp([R(HO, signed(res(0, HON), 1, { xcheck: MS.packXcheck({ miss: 1 }) })), joinLie]).state, 'other');
  eq('neither signed -> other', sp([R(HO, res(0, HON)), joinLie]).state, 'other');
  eq('party bits on the match type -> skip', sp([R(HO, signed(res(0, HON, { mt: 1 | (1 << 4) }), 1)), R(JO, res(1, LIE, { mt: 1 | (1 << 4) }))]).state, 'skip');
  eq('a friends\' room (mt 10) -> skip (counted only)', sp([R(HO, signed(res(0, HON, { mt: 10 }), 1)), R(JO, res(1, LIE, { mt: 10 }))]).state, 'skip');
  const ros3 = [HO, JO, TH];
  eq('three seats -> skip', sp([R(HO, signed(res(0, [7, 4, 1], { ros: ros3 }), 1)), R(JO, res(1, [4, 9, 1], { ros: ros3 }))]).state, 'skip');
  const tagged = res(1, LIE); tagged.push((0xD8 | (1 << 8) | (2 << 16)) | 0, 0x00000102, (0xDB | (1 << 8) | (1 << 16)) | 0, 1);
  eq('a Q61 gamble refusal tag on a record -> skip (Q61 owns the key)', sp([hostOk, R(JO, tagged)]).state, 'skip');
  eq('a writer\'s own duration fault -> skip (Q290 flags him alone)', sp([hostOk, R(JO, res(1, LIE, { dur: 999999 }))]).state, 'skip');
  eq('one account\'s records only -> skip', sp([hostOk, R(HO, res(0, LIE))]).state, 'skip');
  eq('the signed side\'s own records disagree -> other', sp([hostOk, R(HO, signed(res(0, [7001, 4000]), 1)), joinLie]).state, 'other');
  // synth
  const syn = v.signedPairSynth(one);
  eq('synth: the loser re-seated at seat 1 on the signed table, rank 2, no win bit, no block', [syn.steamID, syn.d[5], syn.d[6], syn.d[7] & 1, syn.d.slice(10, 12), MS.find(syn.d).state, syn.signedSynth], [JO, 1, 2, 0, HON, 'none', true]);
  const synW = v.signedPairSynth(two);
  eq('synth: a host whose lie the joiner\'s signature beats -> seat 0, rank 1, win (he did win that table)', [synW.steamID, synW.d[5], synW.d[6], synW.d[7] & 1], [HO, 0, 1, 1]);
  // dual count
  const sg = { players: {}, flagged: {} };
  eq('dualSignedCount: once per key on both, the same key again counts nothing', [v.dualSignedCount(sg, [HO, JO], 'k1', 1000), v.dualSignedCount(sg, [HO, JO], 'k1', 2000), v.dualSignedCount(sg, [HO, JO], 'k2', 3000), sg.players[v.pid(HO)].ds], [2, 0, 2, 2]);
  // apply (record vs enforce) on a pure group set
  const mk = () => ({ consistentMatches: [], inconsistentGroups: [{ m: 'k1', g: [hostOk, joinLie] }] });
  const ctx = (mode) => ({ mode, pubTable: TABLE, allowDevKey: false, processed: new Set(), contested: new Set(), signals: { players: {}, flagged: {} }, now: 5000 });
  const g1 = mk(), r1 = v.applySignedPair(g1, ctx('record'));
  eq('applySignedPair record: counted (one 1, would 1), the key stays disputed', [r1.one, r1.would, r1.moved, g1.inconsistentGroups.length, g1.consistentMatches.length], [1, 1, 0, 1, 0]);
  const g2 = mk(), c2 = ctx('enforce'), r2 = v.applySignedPair(g2, c2);
  const cm = g2.consistentMatches[0];
  eq('applySignedPair enforce: moved to a consistent group of the signed record + the loser on its table', [r2.moved, g2.inconsistentGroups.length, cm && cm.g.length, cm && cm.g.map((r) => r.d.slice(10, 12).join(',')), cm && cm.signedPair && cm.signedPair.o], [1, 0, 2, ['7000,4000', '7000,4000'], JO]);
  T('applySignedPair enforce, no block on the loser: nobody flagged', !Object.keys(c2.signals.flagged).length && !r2.touched.length);
  const g3 = { consistentMatches: [], inconsistentGroups: [{ m: 'k3', g: [hostOk, R(JO, tamper(signed(res(1, LIE), 2)))] }] }, c3 = ctx('enforce'), r3 = v.applySignedPair(g3, c3);
  eq('applySignedPair enforce, a broken block on the loser: flagged (at), touched', [r3.moved, r3.oneBad, (c3.signals.players[v.pid(JO)] || {}).f | 0, r3.touched], [1, 1, 1, [JO]]);
  const g4 = mk(), c4 = ctx('enforce'); c4.processed.add('k1');
  eq('a processed key / a contested key is left alone', [v.applySignedPair(g4, c4).one, v.applySignedPair(mk(), Object.assign(ctx('enforce'), { contested: new Set(['k1']) })).one], [0, 0]);
  eq('mode off -> nothing at all', v.applySignedPair(mk(), ctx('')).one, 0);
  // coverage
  const cov = v.msigCoverage({ consistentMatches: [
    { m: 'a', g: [R(HO, signed(res(0, HON), 1)), R(JO, signed(res(1, HON), 2))] },
    { m: 'b', g: [R(HO, signed(res(0, HON), 1)), R(JO, res(1, HON))] },
    { m: 'c', g: [R(HO, res(0, HON)), R(JO, res(1, HON))] },
    { m: 'd', g: [R(HO, signed(res(0, [7, 4, 1], { ros: ros3, mt: 10 }), 1)), R(JO, signed(res(1, [7, 4, 1], { ros: ros3, mt: 10 }), 2)), R(TH, res(2, [7, 4, 1], { ros: ros3, mt: 10 }))] },
    { m: 'e', g: [R(HO, signed(res(0, HON), 1))], botLone: true },
  ] }, TABLE, false);
  eq('msigCoverage: 1V1 all / some / none = 1 / 1 / 1; other keys 0 / 1 / 0; lone bot keys apart', cov, { pair: [1, 1, 1], multi: [0, 1, 0] });
}

// ---- [2] / [3] end to end ----
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-pair-tree-'));
try {
  require('./root-listing').copyRootTree(ROOT, TREE, ['.git', 'test', 'node_modules']);
  const kf = path.join(TREE, 'attest-keys.json');
  const j = JSON.parse(fs.readFileSync(kf, 'utf8'));
  j.keys[String(KEY)] = { pubs: [G.PUB_HEX], sealed: true, at: '2026-10-01T00:00:00.000Z' };
  fs.writeFileSync(kf, JSON.stringify(j, null, 2));
  const SCRIPT = path.join(TREE, 'validate.js');
  const MIN = 60000, HOUR = 3600000;
  const extra = () => [{ id: 5, name: 'progress', entries: [] }, { id: 6, name: 'rating', entries: [] }, { id: 7, name: 'points', entries: [HO, JO].map((s) => ({ steamID: s, score: 2500 })) }, { id: 8, name: 'cp_bank', entries: [] }, { id: 9, name: 'trust_tier', entries: [] }];
  // the starts; ten minutes later the results; ten more; two hours on (the void of a disputed key)
  function play(hostD, joinD, env) {
    const st = [{ sid: HO, d: start(0) }, { sid: JO, d: start(1) }];
    const all = st.concat([{ sid: HO, d: hostD }, { sid: JO, d: joinD }]);
    const steps = [[0, st], [10 * MIN, all], [10 * MIN, all], [2 * HOUR, all]];
    const rs = [];
    let state = null;
    for (const [ms, recs] of steps) {
      if (rs.length && rs[rs.length - 1].code !== 0) break;
      const r = H.runCron(H.shardBoards(recs, extra()), state ? H.advance(state, ms) : null, env || null, SCRIPT, 'signed-pair');
      rs.push(r); state = r.state;
    }
    return rs;
  }
  const KEYM = 0x5801 + '_1234_1';
  const pays = (rs) => rs.map((r) => H.setPosts(r, 5).concat(H.setPosts(r, 6), H.setPosts(r, 7), H.setPosts(r, 8)).map((p) => p.body.replace(/&key=[^&]*/, '')).sort());
  const processed = (rs) => new Set(rs[rs.length - 1].state.PROCESSED_FILE || []).has(KEYM);
  const sig = (rs, sid) => ((((rs[rs.length - 1].state.SIGNALS_FILE || {}).players) || {})[v.pid(sid)]) || {};
  const out = (rs) => rs.map((r) => r.out).join('');
  const row = (r) => (r.summary.match(/\| guard match signature on multiplayer records[^\n]*/) || [''])[0];
  const okAll = (rs) => rs.length === 4 && rs.every((r) => r.code === 0);
  const hostD = signed(res(0, HON), 1), joinLieD = res(1, LIE);

  console.log('[2] record mode');
  {
    const off = play(hostD, joinLieD, null);
    const rec = play(hostD, joinLieD, { MSIG_PAIR: 'record' });
    T('four runs each exit 0', okAll(off) && okAll(rec), out(rec).slice(-500));
    eq('record: every XP / rating / points / CP write is the same as with the lane off', pays(rec), pays(off));
    eq('record: the key ends as before (processed after the void either way)', [processed(rec), processed(off)], [processed(off), processed(off)]);
    T('record: the would-settle line names the signed side', /msig-pair [^\n]*would settle by [^\n]*signed table \[7000,4000\][^\n]*no block[^\n]*record only \(MSIG_PAIR=record\)/.test(out(rec)), (out(rec).match(/msig-pair[^\n]*/g) || []).join(' | '));
    T('record: the dispute is still counted on both (pd)', (sig(rec, HO).pd | 0) === 1 && (sig(rec, JO).pd | 0) === 1);
    T('record: summary row counts one disputed 1V1 with a signed side, none settled', /MSIG_PAIR record\)[^|]*\| 1 \/ 0 \/ 0 \/ 0 \/ 0 -- /.test(row(rec[1])), row(rec[1]));
    T('off: the row says off and counts nothing', /MSIG_PAIR off\)[^|]*\| 0 \/ 0 \/ 0 \/ 0 \/ 0 -- 0 \/ 0 \/ 0 -- 0 \/ 0 \/ 0 \|/.test(row(off[1])), row(off[1]));
    const both = play(hostD, signed(res(1, HON), 2), { MSIG_PAIR: 'record' });
    T('an honest 1V1 signed on both sides settles as always; coverage 1 / 0 / 0', okAll(both) && processed(both) && /-- 1 \/ 0 \/ 0 -- /.test(both.map(row).join(' ')), both.map(row).join(' || '));
  }

  console.log('[3] enforce mode');
  {
    const en = play(hostD, joinLieD, { MSIG_PAIR: 'enforce' });
    T('enforce: four runs exit 0', okAll(en), out(en).slice(-500));
    T('enforce: the key settles (processed) before the void', processed(en) && /msig-pair settle [^\n]*\(none\) settled at it/.test(out(en)), (out(en).match(/msig-pair[^\n]*/g) || []).join(' | '));
    const rated = (sid) => [].concat(...en.map((r) => H.postsOf(r, 6, sid))).length;
    const xp = (sid) => [].concat(...en.map((r) => H.postsOf(r, 5, sid))).map((p) => p.score);
    T('enforce: both players rated (the loser too)', rated(HO) > 0 && rated(JO) > 0, rated(HO) + ' / ' + rated(JO));
    const honest = play(hostD, signed(res(1, HON), 2), { MSIG_PAIR: 'enforce' });
    const xpH = (sid) => [].concat(...honest.map((r) => H.postsOf(r, 5, sid))).map((p) => p.score);
    eq('enforce: both paid exactly what an honest match of that table pays', [xp(HO), xp(JO)], [xpH(HO), xpH(JO)]);
    T('enforce: no dispute counted, nobody flagged for a missing block', (sig(en, HO).pd | 0) === 0 && (sig(en, JO).pd | 0) === 0 && (sig(en, JO).f | 0) === 0 && (sig(en, HO).f | 0) === 0);
    T('enforce: summary row counts it settled', en.some((r) => /MSIG_PAIR enforce\)[^|]*\| 1 \/ 1 \/ 0 \/ 0 \/ 0 -- /.test(row(r))), en.map(row).join(' || '));
    const br = play(hostD, tamper(signed(joinLieD, 2)), { MSIG_PAIR: 'enforce' });
    T('enforce: a broken block on the loser -> settles, the loser flagged (at)', okAll(br) && processed(br) && (sig(br, JO).f | 0) === 1 && (sig(br, HO).f | 0) === 0, 'f=' + (sig(br, JO).f | 0));
    const du = play(hostD, signed(joinLieD, 2), { MSIG_PAIR: 'enforce' });
    T('enforce: both signed, disagreeing -> not settled by signature, ds counted on both', okAll(du) && !/msig-pair settle/.test(out(du)) && (sig(du, HO).ds | 0) === 1 && (sig(du, JO).ds | 0) === 1, (out(du).match(/msig-pair[^\n]*/g) || []).join(' | '));
    const pe = play(signed(res(0, HON), 1, { keyId: 2099999999 }), joinLieD, { MSIG_PAIR: 'enforce' });
    T('enforce: a key the job does not list -> nothing moves (pending)', okAll(pe) && !/msig-pair settle/.test(out(pe)) && /a signature block this job cannot judge yet/.test(out(pe)));
    const un = play(signed(res(0, HON), 1, { xcheck: MS.packXcheck({ stale: 2 }) }), joinLieD, { MSIG_PAIR: 'enforce' });
    T('enforce: an untrusted block (stale joiner events) -> nothing moves', okAll(un) && !/msig-pair settle/.test(out(un)));
    // mutant: the lane never moves a key -> the same enforce timeline must not settle it (the settle above is this lane's doing)
    const vsrc = fs.readFileSync(SCRIPT, 'utf8');
    const ANCHOR = '    list.splice(i, 1);\n';   // Q68: the lane walks the disputed keys and the held no-summary ones in one loop
    if (vsrc.split(ANCHOR).length !== 2) bad('mutant anchor not found exactly once');
    else {
      fs.writeFileSync(SCRIPT, vsrc.replace(ANCHOR, '    continue;\n' + ANCHOR));
      try {
        const mu = play(hostD, joinLieD, { MSIG_PAIR: 'enforce' });
        T('mutant (the lane moves nothing): the disputed key is not settled by the signature', okAll(mu) && !/msig-pair settle/.test(out(mu)) && (sig(mu, HO).pd | 0) === 1);
      } finally { fs.writeFileSync(SCRIPT, vsrc); }
    }
  }

  console.log('[4] seedcap');
  {
    const probe = path.join(TREE, '.probe-signed-pair.js');
    fs.writeFileSync(probe, [
      "process.env.STATE_SALT = 's';",
      "const v = require('./validate.js'); const sc = require('./seedcap.js');",
      'const d = JSON.parse(process.argv[2]);',
      "const g = d.map((x) => ({ d: x.d, roster: v.decodeRoster(x.d), w: x.w }));",
      "const p = sc.pendingOfGroup({ audited: {}, chain: {} }, 'k', g);",
      "console.log(JSON.stringify(p ? { scores: p.scores, pc: p.pc } : null));",
    ].join('\n'));
    const run = (mode) => {
      const e = Object.assign({}, process.env, { LB_PREFIX: 'shard_', SEEDCAP_CHANNEL: 'ea' });
      if (mode) e.MSIG_PAIR = mode; else delete e.MSIG_PAIR;
      const r = spawnSync(process.execPath, [probe, JSON.stringify([{ d: hostD, w: HO }, { d: joinLieD, w: JO }])], { cwd: TREE, env: e, encoding: 'utf8', timeout: 60000 });
      try { return JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (x) { return 'ERR ' + (r.stderr || r.stdout); }
    };
    eq('enforce: the disputed 1V1 is audited on the signed side\'s scores', run('enforce'), { scores: HON, pc: 2 });
    eq('record: not audited (the reconcile\'s own flag lane, as before)', run('record'), null);
    eq('off: not audited', run(''), null);
  }
} finally { try { fs.rmSync(TREE, { recursive: true, force: true }); } catch (e) {} }

// ---- [5] wiring ----
console.log('[5] wiring pins');
{
  const src = fs.readFileSync(path.join(ROOT, 'validate.js'), 'utf8');
  const at = (s) => src.indexOf(s);
  T('the lane runs after the team-2 accusations and before consistentKeys (a moved key never reaches the start verdict)',
    at('const t2acRes = applyTeam2Accusations(') > 0 && at('const spRes = applySignedPair(gr,') > at('const t2acRes = applyTeam2Accusations(') && at('const consistentKeys = new Set(consistentMatches.map(c => c.m));') > at('const spRes = applySignedPair(gr,'));
  T('the lane reads the key table through the job\'s channel policy', /const msigPub = loadJobPubTable\(Date\.now\(\)\) \|\| \{\};/.test(src));
  T('the dev key only on the test shards (sandboxOn), the contested keys excluded', /applySignedPair\(gr, \{ mode: MSIG\.PAIR, pubTable: msigPub, allowDevKey: sandboxOn\(\), processed, contested: rcRes\.contested,/.test(src));
  const scs = fs.readFileSync(path.join(ROOT, 'seedcap.js'), 'utf8');
  T('seedcap reads the key table with its channel and only acts on enforce', /if \(v\.MSIG\.PAIR !== 'enforce'\) return null;/.test(scs) && /attest\.loadPubTable\(path\.join\(__dirname, 'attest-keys\.json'\), \{ channel: SEEDCAP_CHANNEL \|\| null,/.test(scs));
}

console.log(failN ? ('signed-pair-1v1: ' + failN + ' FAIL') : 'signed-pair-1v1: all ok');
process.exit(failN ? 1 : 0);
