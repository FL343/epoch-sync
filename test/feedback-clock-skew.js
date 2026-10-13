'use strict';
// Player feedback (feedback.js) does not trust the author's clock: a stamp ahead of the cron is clamped
// to now instead of dropped, and the private digest picks items by admission, not by the author clock,
// so a fast clock cannot push the digest watermark into the future and a slow clock cannot slip under it.
// Pure helpers in-process (mail endpoint stubbed); main() once as a child process on a stubbed fetch and a
// pinned fake clock (no network, every file in a temp dir), so nothing depends on today's date.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const fb = require(path.join(__dirname, '..', 'feedback.js'));

let failN = 0, n = 0;
const ok = (label, cond, detail) => { n++; if (cond) console.log('  ok    ' + label); else { failN++; console.log('  FAIL  ' + label + (detail != null ? ' (' + detail + ')' : '')); } };
const A1 = '76561198000000001', A2 = '76561198000000002', A3 = '76561198000000003';
// client packSubmit mirror (utf8, category 1)
const boxWords = (sid, text, tsMin) => {
  const p = fb.packText(text, 0);
  const itemId = fb.fnv1a32(String(sid) + ':' + tsMin);
  return { words: [fb.FB_MAGIC | 0, ((1 << 24) | (1 << 16) | p.len) | 0, fb.packLang('en'), itemId, tsMin | 0].concat(p.words), itemId };
};

console.log('=== feedback-clock-skew [1] decodeBoxEntry ===');
{
  const NM = 420000;
  const f = boxWords(A1, 'fast by two days', NM + 2880), s = boxWords(A2, 'slow by two hours', NM - 120), e = boxWords(A3, 'before the epoch', -1);
  const df = fb.decodeBoxEntry(A1, f.words, NM), ds = fb.decodeBoxEntry(A2, s.words, NM);
  ok('2 days fast: kept, ts clamped to now, itemId = author stamp', df && df.ts === NM && df.itemId === f.itemId, df && df.ts);
  ok('2 hours slow: kept as stamped', ds && ds.ts === NM - 120);
  ok('pre-epoch stamp still dropped', fb.decodeBoxEntry(A3, e.words, NM) === null);
  ok('provenance still checks the author stamp', fb.decodeBoxEntry(A2, f.words, NM) === null);
}

// maybeSendDigest with the mail endpoint stubbed (in-process; fetch + env restored after)
async function digest(st, nowMs, okSend) {
  const sent = [];
  const keep = global.fetch, keepEnv = [process.env.FB_DIGEST_TO, process.env.RESEND_API_KEY, process.env.FB_DIGEST_FORCE];
  process.env.FB_DIGEST_TO = 'ops@example.invalid'; process.env.RESEND_API_KEY = 'k'; delete process.env.FB_DIGEST_FORCE;
  global.fetch = async (url, init) => { sent.push(JSON.parse(init.body).text); return { ok: okSend !== false, status: okSend !== false ? 200 : 500, text: async () => '{}' }; };
  try { return { r: await fb.maybeSendDigest(st, nowMs), sent }; }
  finally {
    global.fetch = keep;
    if (keepEnv[0] === undefined) delete process.env.FB_DIGEST_TO; else process.env.FB_DIGEST_TO = keepEnv[0];
    if (keepEnv[1] === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = keepEnv[1];
    if (keepEnv[2] !== undefined) process.env.FB_DIGEST_FORCE = keepEnv[2];
  }
}

(async () => {
  console.log('=== feedback-clock-skew [2] digest picks by admission, not by the author clock ===');
  {
    const D1 = Date.UTC(2026, 9, 20, 0, 5), D2 = Date.UTC(2026, 9, 21, 0, 5);
    const wm = fb.nowTsMin(D1) - 10;                    // last digest watermark (max ts mailed)
    const st = { items: {
      100: { ap: 'a', cat: 1, lang: 'en', ts: wm - 5, text: 'legacy already mailed', st: 'live' },
      101: { ap: 'b', cat: 1, lang: 'en', ts: wm + 3, text: 'legacy not yet mailed', st: 'live' },
      102: { ap: 'c', cat: 1, lang: 'en', ts: wm - 90, text: 'slow clock admitted after the digest', st: 'live', pd: 1 },
      103: { ap: 'd', cat: 1, lang: 'en', ts: wm + 7, text: 'good clock', st: 'live', pd: 1 },
    }, votes: {}, digest: { day: '2026-10-19', at: wm } };
    const failSend = await digest(JSON.parse(JSON.stringify(st)), D1, false);
    ok('failed send: returns false', failSend.r === false && failSend.sent.length === 1);
    const a = await digest(st, D1);
    const body = a.sent.join('\n');
    ok('mailed: slow-clock item below the watermark', body.includes('slow clock admitted after the digest'));
    ok('mailed: new item + legacy item above the watermark', body.includes('good clock') && body.includes('legacy not yet mailed'));
    ok('not re-mailed: legacy item at/below the watermark', !body.includes('legacy already mailed'));
    ok('pending marks cleared after a sent digest', st.items[102].pd === undefined && st.items[103].pd === undefined);
    ok('watermark = max ts mailed', st.digest.at === wm + 7 && st.digest.day === '2026-10-20', JSON.stringify(st.digest));
    const b = await digest(st, D2);
    ok('next day: nothing mailed twice', a.r === true && b.r === true && b.sent.length === 0, b.sent.length);
    const keepPd = { items: { 7: { ap: 'e', cat: 0, lang: 'en', ts: 1, text: 'kept pending', st: 'live', pd: 1 } }, votes: {}, digest: { day: '', at: 0 } };
    await digest(keepPd, D1, false);
    ok('failed send keeps the pending mark', keepPd.items[7].pd === 1);
  }

  console.log('=== feedback-clock-skew [3] main(): admission marks pending and clamps a fast stamp ===');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-clock-skew-'));
    try {
      const NOW_MS = Date.UTC(2026, 9, 20, 12, 0);
      const stub = path.join(dir, 'stub.js');
      fs.writeFileSync(stub, [
        "const fs = require('fs');",
        'const FAKE = Number(process.env.FAKE_NOW), REAL0 = Date.now(), RealDate = Date;',
        'class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FAKE + (RealDate.now() - REAL0)); } static now() { return FAKE + (RealDate.now() - REAL0); } }',
        'global.Date = FakeDate;',
        "const FX = JSON.parse(fs.readFileSync(process.env.STUB_FIXTURE, 'utf8'));",
        'const resp = (o) => { const t = JSON.stringify(o); return { ok: true, status: 200, text: async () => t, json: async () => o }; };',
        'global.fetch = async (url, init) => {',
        '  const u = String(url);',
        "  if (init && init.method === 'POST') return resp({ result: { result: 1 } });",
        '  if (/GetLeaderboardsForGame/.test(u)) return resp({ response: { leaderboards: FX.boards.map(b => ({ id: b.id, name: b.name, entries: b.entries.length })) } });',
        '  if (/GetLeaderboardEntries/.test(u)) { const b = FX.boards.find(x => String(x.id) === /leaderboardid=([0-9]+)/.exec(u)[1]); const rs = Number((/rangestart=([0-9]+)/.exec(u) || [0, 1])[1]); return resp({ leaderboardEntryInformation: { leaderboardEntries: (b && rs <= 1) ? b.entries : [] } }); }',
        '  return resp({});',
        '};',
      ].join('\n'));
      const hex = (arr) => arr.map(x => { const h = ((x | 0) >>> 0).toString(16).padStart(8, '0'); return h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2); }).join('');
      const nowMin = fb.nowTsMin(NOW_MS);
      const fast = boxWords(A1, 'posted with a clock 16 h fast', nowMin + 960), good = boxWords(A2, 'posted with a good clock', nowMin - 3);
      const boards = [{ id: 1, name: 'feedback_box', entries: [{ steamID: A1, score: nowMin + 960, detailData: hex(fast.words) }, { steamID: A2, score: nowMin - 3, detailData: hex(good.words) }] }, { id: 2, name: 'feedback_vote', entries: [] }];
      let id = 10;
      for (const c of fb.FB_CATS) for (const s of ['hot', 'new']) boards.push({ id: id++, name: 'feedback_feed_' + c + '_' + s, entries: [] });
      fs.writeFileSync(path.join(dir, 'fx.json'), JSON.stringify({ boards }));
      fs.writeFileSync(path.join(dir, 'wordlist.json'), JSON.stringify({ sub: [{ l: 4, h: '0123456789abcdef' }], word: [] }));
      const env = Object.assign({}, process.env, {
        FAKE_NOW: String(NOW_MS), STUB_FIXTURE: path.join(dir, 'fx.json'), READ_RETRY_MS: '0',
        APPID: '1', STEAM_PUBLISHER_KEY: 'k', STATE_SALT: 's',
        FB_STATE_FILE: path.join(dir, 'state.json'), FB_MOD_FILE: path.join(dir, 'mod.json'), FB_WORDLIST_FILE: path.join(dir, 'wordlist.json'),
      });
      for (const k of ['FB_DIGEST_TO', 'RESEND_API_KEY', 'FB_DIGEST_FORCE', 'FB_LB', 'FB_VOTE_LB', 'FB_FEED_PREFIX']) delete env[k];
      const r = spawnSync(process.execPath, ['-r', stub, path.join(__dirname, '..', 'feedback.js')], { env, cwd: dir, encoding: 'utf8' });
      ok('main() exits 0', r.status === 0, r.status + ' ' + String((r.stderr || '') + (r.stdout || '')).slice(0, 300));
      let st = {}; try { st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')); } catch (e) {}
      const items = st.items || {};
      const f = items[String(fast.itemId)], g = items[String(good.itemId)];
      ok('both posts admitted with the pending mark', !!f && !!g && f.pd === 1 && g.pd === 1, JSON.stringify(Object.values(items).map(i => [i.ts, i.pd])));
      ok('fast stamp stored clamped to the run clock', !!f && f.ts >= nowMin && f.ts <= nowMin + 1, f && f.ts);
      ok('good stamp stored as is', !!g && g.ts === nowMin - 3);
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
  }

  console.log(failN ? ('feedback-clock-skew: ' + failN + ' FAIL of ' + n) : ('feedback-clock-skew: all ' + n + ' passed'));
  process.exit(failN ? 1 : 0);
})().catch(e => { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
