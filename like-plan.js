'use strict';
// Likes lane (O520, knife 5.4d) -- pure helpers for validate.js (processLikes does the IO).
//
// Two boards, no server (plan: the client repo's mvp/KNIFE_54D_LIKES_PLAN.md section 2):
//   1. `like_box` (client writes, friends reads): one row per VOTER = his rolling queue of likes, at most BOX_MAX entries:
//        [BOX_MAGIC | BOX_VER << 8 | n << 16, (sidLo, sidHi, ref, meta) x n]
//      sid = the player liked; ref = the matchHash (record d[3]) for a like given in a match (kind 1), 0 for a like given on a
//      leaderboard row / public profile (kind 2); meta = unixMinute << 2 | kind. The voter is the row OWNER (a Steam-
//      authenticated write) -- nobody can like in someone else's name; everything else in the row is the voter's claim.
//      The client re-uploads the whole queue (idempotent here); a queued entry stays at least 30 minutes (>= 6 runs).
//   2. `like_count` (trusted writes, everyone reads): one row per player liked, score = lifetime likes counted here,
//      details [COUNT_MAGIC | COUNT_VER << 8, season, seasonCount, matchPart, boardPart]. The season count belongs to the
//      season in details[1] (the season of his last counted like): a reader shows it only while that season is current.
//      The state is the truth, the board only its projection (as trust_tier): boardPlan writes the rows that differ.
//
// What counts (plan section 2.3):
//   kind 1 (in a match), voter V, target T:
//     1. V != T
//     2. V's OWN record of that match is on the shards: matchmade (quick / ranked, team kinds included -- no endless, no
//        friend room, no bot match), disposition finished (0, or 10 = finished, the seat scores judged without the host
//        guard's final summary: validate.js settles it as finished, cloud audit Q68); and the match was SETTLED by this job and not voided (validate.js
//        certifies the key at the settle; a like seen before that waits in `pend`, PENDING_TTL_MIN)
//     3. T sits at a seat of the match's consensus roster (majority per seat; a bot seat holds no SteamID), V at his own
//     4. V and T are not one premade unit: an FFA premade pair / trio (the party bits of the match type) does not count.
//        In a team match a record cannot tell a party from strangers (validate.js, the late-result shield note), so a
//        like to a TEAMMATE counts under the kind 2 pair rule instead (W79 rework, architecture decision 10: the user's
//        rule leaves out premade parties only, and a stranger teammate's like must not be lost): one per (V, T) pair per
//        PAIR_WEEK_MIN, the same pair token as a board like (a party that likes each other could do that on a board row
//        anyway). Opponents count every match
//     5. one like per voter per match: the first one taken counts (a teammate like held by the pair week is not taken:
//        it is looked at again while its key is certified, as a board click held by the week)
//     6. (W79) T is a player this job knows (ctx.known: validate.js = has settled XP), checked when the like counts -- at
//        the settle for a waiting one (certify, ctx.sidOfTarget) -- so every like_count row stays inside the closure
//        audit.js holds trusted boards to
//   kind 2 (on a board row / profile):
//     1. V != T, and T is a player this job knows (ctx.known: has played a match it settled) -- an entry cannot conjure a
//        row for an arbitrary SteamID. No bar on V (decision 2026-10-22: any account counts)
//     2. one per (V, T) pair per PAIR_WEEK_MIN, timed by THIS job's clock (the client minute decides nothing); a teammate
//        like in a team match (kind 1 rule 4) takes the same pair token
//     3. at most BOARD_DAILY_CAP counted per voter per UTC day (a state-size fuse far above normal use); over it nothing
//        is minted, the entry is retried on a later run
//   -> T: lifetime +1, season +1, matchPart / boardPart +1.
//
// State (likes.json and the two channel copies; committed to a PUBLIC repository every run -- keyed tokens, counts and times
// only, never a raw SteamID or a matchHash in the clear; every token is ctx.kh(domain | ...), the job's keyed pseudonym):
//   cnt  { targetKey: { n, s, sn, m, b } }  target key = kh('like-of|' + T), a domain of its own (not validate.js pid):
//                                           the counts are public on like_count anyway; the key must not tie them to the
//                                           other state files
//   mt   { tk: stamp }   kind 1 taken: tk = kh('like-mt|' + V + '|' + m), one per voter per match
//   bt   { et: stamp }   kind 2 entry taken: et = kh('like-bt|' + V + '|' + T + '|' + minute) -- the same click seen again
//                        (it stays queued) is not counted again after the pair week
//   pr   { pt: minute }  the pair: pt = kh('like-pr|' + V + '|' + T), the minute of the last counted kind 2 or teammate like
//   pend { tk: { k, t, at, w, p? } }  kind 1 waiting for its settle: k = key token, t = target key, at = seen (job clock),
//                        w = the entry's minute, p = the pair token (a teammate like only: the pair rule is checked when it
//                        counts, and the voter is not in the state to make it again)
//   ok   { kt: stamp }   keys settled and not voided: kt = kh('like-k|' + m), kept OK_TTL_MIN
//   day  { d, s: [slot] }  today's counted kind 2 likes: one slot token kh('like-day|' + d + '|' + V + '|' + i) each --
//                        the day's count of a voter is the number of his slots found, no counter sits under his key
// No key stays with one voter across his likes (Q209): the tokens of two likes of one voter share nothing, except the pair
// token of a second like of the SAME target (the 7-day rule needs it). What no layout removes (as for the report lanes): a
// token is written in the same commit as the match it belongs to settles, so its timing narrows who wrote it.
//
// Token lifetimes: an entry whose minute is more than ENTRY_TTL_MIN old is stale and not taken; an entry token is stamped
// max(now, min(minute, now + ENTRY_TTL_MIN)) and pruned ENTRY_TTL_MIN after its stamp -- by then the entry is stale. (A
// minute set further ahead than that may come in again after the prune: kind 1 then needs its key certified again, which
// OK_TTL_MIN < ENTRY_TTL_MIN and one settle per key rule out; kind 2 then needs the pair week again -- no more than an
// honest weekly click.) Past a size cap the oldest stamps go first.
const PP = require('./points-plan.js');

const LIKE = Object.freeze({
  BOX_LB: 'like_box',               // lockstep: client like-box.js BOARD (client writes, friends reads)
  COUNT_LB: 'like_count',           // lockstep: client like-dir.js BOARD (trusted writes, everyone reads)
  BOX_MAGIC: 0xDD, BOX_VER: 1,      // registered: the client repo's mvp/LEDGER_ANTICHEAT.md section 0a (planned 0xDB until 2026-10-22:
                                    //   0xDB went to the Q61 gamble-refusal block of the settle record)
  COUNT_MAGIC: 0xDC, COUNT_VER: 1,
  BOX_MAX: 15,                      // entries per box row (1 + 4 x 15 = 61 ints of the 64 a row holds)
  KIND_MATCH: 1, KIND_BOARD: 2,
  KV: 1,                            // state layout
  ENTRY_TTL_MIN: 8 * 1440,          // an entry older than this is not taken; entry tokens live this long after their stamp
  PENDING_TTL_MIN: 2 * 1440,        // a kind 1 like waits this long for its settle (then it may queue again from the box)
  OK_TTL_MIN: 3 * 1440,             // a settled key takes kind 1 likes this long (< ENTRY_TTL_MIN, see above)
  PAIR_WEEK_MIN: 7 * 1440,          // decision 2026-10-22: one like per (voter, target) per 7 days on a board / profile
  PAIR_TTL_MIN: 8 * 1440,
  BOARD_DAILY_CAP: 50,
  TOKENS_MAX: 100000,               // size fuses (oldest stamps go first)
  PENDING_MAX: 20000,
  OK_MAX: 30000,
  PAIRS_MAX: 100000,
  WRITE_MAX: 400,                   // like_count rows written per run (the rest next run)
});

function sidPlausible(sid) { return /^\d{15,20}$/.test(String(sid == null ? '' : sid)); }
function decodeSid(lo, hi) { return ((BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0)).toString(); }
function splitSid(sid) { const b = BigInt(String(sid)); return [Number(b & 0xFFFFFFFFn) | 0, Number((b >> 32n) & 0xFFFFFFFFn) | 0]; }

// ---- box row codec (client like-box.js encodes the same; golden cases fixtures/like-box/cases.json) ----
// entries = [{ sid, ref, kind, min }] (at most BOX_MAX, in queue order) -> int32[]
function encodeBox(entries) {
  const list = (entries || []).slice(0, LIKE.BOX_MAX);
  const out = [(LIKE.BOX_MAGIC | (LIKE.BOX_VER << 8) | (list.length << 16)) | 0];
  for (const e of list) {
    const [lo, hi] = splitSid(e.sid);
    out.push(lo, hi, e.ref | 0, (((e.min >>> 0) & 0x1FFFFFFF) * 4 + ((e.kind | 0) & 3)) | 0);
  }
  return out;
}
// int32[] -> { ver, entries: [{ sid, ref, kind, min }] } | null (not a box row of a layout this job reads)
function decodeBox(det) {
  if (!Array.isArray(det) || det.length < 1) return null;
  const w0 = det[0] | 0;
  if ((w0 & 0xFF) !== LIKE.BOX_MAGIC) return null;
  const ver = (w0 >>> 8) & 0xFF, n = (w0 >>> 16) & 0xFF;
  if (ver !== LIKE.BOX_VER) return null;      // a new layout ships with a reader for both (architecture decision 9)
  if (n > LIKE.BOX_MAX || det.length < 1 + 4 * n) return null;
  const entries = [];
  for (let i = 0; i < n; i++) {
    const o = 1 + 4 * i, meta = det[o + 3] | 0;
    entries.push({ sid: decodeSid(det[o] | 0, det[o + 1] | 0), ref: det[o + 2] | 0, kind: meta & 3, min: meta >>> 2 });
  }
  return { ver, entries };
}
// ---- count row codec (client like-dir.js decodes the same) ----
function countRow(c) {
  return { score: c.n | 0, details: [(LIKE.COUNT_MAGIC | (LIKE.COUNT_VER << 8)) | 0, c.sn | 0, c.s | 0, c.m | 0, c.b | 0] };
}
function decodeCount(score, det) {
  if (!Array.isArray(det) || det.length < 5) return null;
  const w0 = det[0] | 0;
  if ((w0 & 0xFF) !== LIKE.COUNT_MAGIC || ((w0 >>> 8) & 0xFF) !== LIKE.COUNT_VER) return null;
  const c = { n: score | 0, sn: det[1] | 0, s: det[2] | 0, m: det[3] | 0, b: det[4] | 0 };
  if (c.n < 0 || c.s < 0 || c.m < 0 || c.b < 0) return null;
  return c;
}

// ---- match kinds (points-plan.js codes) ----
function isMatchmadeMt(mt) { const b = PP.baseMt(mt); return b === 1 || b === 2 || PP.isTeamMt(mt); }   // = validate.js isMatchmadeMt
// why a like between seats a and b of one match does not count by rule 4, or null
function unitOf(mt, a, b) {
  if (PP.isTeamMt(mt)) return null;            // a teammate counts under the pair rule (mateOf), an opponent always
  const mask = PP.premadeMaskOf(mt);
  if ((a >> 1) === (b >> 1) && ((mask >> (a >> 1)) & 1) === 1) return 'premade';
  const tr = PP.premadeTrioAtOf(mt);
  if (tr > 0 && a >= tr - 1 && a <= tr + 1 && b >= tr - 1 && b <= tr + 1) return 'premade';
  return null;
}
// seats a and b on one team of a team match: the like takes the (V, T) pair token (rule 4)
function mateOf(mt, a, b) {
  if (!PP.isTeamMt(mt)) return false;
  const ts = PP.teamSizeOfMt(mt);
  return PP.teamOfSeat(a, ts) === PP.teamOfSeat(b, ts);
}
const inWeek = (last, now) => last !== undefined && now - (last | 0) < LIKE.PAIR_WEEK_MIN;

// ---- the matches of this run's records (validate.js passes recs after the seat gate) ----
// recs = [{ steamID, d, dispCode?, roster? }] (settle records 0xB1). Returns lookup(voterSid, matchHash) ->
//   null (no record of his with that hash) | { why } (ambiguous) | { m, mt, vSeat, vDisp, roster }
// roster = consensus seat -> SteamID over the key's records (one record per writer, strict majority per seat, as
// validate.js rosterConsensus); vDisp = a finished code (0 or 10, isFinished) when one of the voter's own records of the key
// says finished.
// Q68: 10 (finished-nosummary) is a finished match too -- validate.js settles it like 0 (the copy takes the agreed seat
// scores); the client counts that like as finished (its match-end disposition stays 'finished'), so the lane must as well.
const isFinished = (c) => (c | 0) === 0 || (c | 0) === 10;
function matchIndex(recs) {
  const byKey = new Map(), byVoter = new Map();
  for (const r of recs || []) {
    const d = r && r.d;
    if (!Array.isArray(d) || (d[0] | 0) !== 0xB1 || d.length < 11) continue;
    const pc = d[8] | 0;
    if (pc < 1 || pc > 8) continue;
    const m = (d[3] | 0) + '_' + (d[4] | 0) + '_' + (d[2] | 0);
    const sid = String(r.steamID);
    const disp = r.dispCode != null ? (r.dispCode | 0) : (d.length > 10 + pc ? d[10 + pc] | 0 : 0);
    let roster = r.roster;
    if (!roster) { roster = {}; const base = 11 + pc; if (d.length >= base + 2 * pc) for (let s = 0; s < pc; s++) { const x = decodeSid(d[base + 2 * s] | 0, d[base + 2 * s + 1] | 0); if (x !== '0') roster[s] = x; } }
    const rec = { sid, m, mt: d[2] | 0, mh: d[3] | 0, seat: d[5] | 0, disp, roster };
    if (!byKey.has(m)) byKey.set(m, new Map());
    const w = byKey.get(m);
    if (!w.has(sid) || (!isFinished(w.get(sid).disp) && isFinished(disp))) w.set(sid, rec);   // one record per writer (a finished one first)
    if (!byVoter.has(sid)) byVoter.set(sid, []);
    byVoter.get(sid).push(rec);
  }
  const rosterOf = new Map();
  const consensus = (m) => {
    if (rosterOf.has(m)) return rosterOf.get(m);
    const g = [...byKey.get(m).values()], votes = {};
    for (const r of g) for (const k of Object.keys(r.roster || {})) { const s = k | 0, x = String(r.roster[k]); (votes[s] = votes[s] || {})[x] = (votes[s][x] || 0) + 1; }
    const out = {};
    for (const k of Object.keys(votes)) { let best = null, bn = 0; for (const x of Object.keys(votes[k])) if (votes[k][x] > bn) { bn = votes[k][x]; best = x; } if (best && bn * 2 > g.length) out[k | 0] = best; }
    rosterOf.set(m, out);
    return out;
  };
  return function lookup(voterSid, mh) {
    const mine = (byVoter.get(String(voterSid)) || []).filter((r) => r.mh === (mh | 0));
    if (!mine.length) return null;
    const keys = [...new Set(mine.map((r) => r.m))];
    if (keys.length > 1) return { why: 'ambig' };
    const own = byKey.get(keys[0]).get(String(voterSid));
    return { m: own.m, mt: own.mt, vSeat: own.seat, vDisp: own.disp, roster: consensus(own.m) };
  };
}

// ---- state ----
const MAPS = ['cnt', 'mt', 'bt', 'pr', 'pend', 'ok'];
function norm(st) {
  st = (st && typeof st === 'object' && !Array.isArray(st)) ? st : {};
  for (const k of MAPS) if (!st[k] || typeof st[k] !== 'object' || Array.isArray(st[k])) st[k] = {};
  if (!st.day || typeof st.day !== 'object') st.day = { d: 0, s: [] };
  if (!Array.isArray(st.day.s)) st.day.s = [];
  return st;
}
// false = a state written by a newer layout of this lane: leave it alone (an older job after a rollback changes nothing)
function ready(st) { return !st || st.kv == null || st.kv === LIKE.KV; }
const sortKeys = (o) => { const r = {}; for (const k of Object.keys(o || {}).sort()) r[k] = o[k]; return r; };
// the only keys that reach the committed file (keyed tokens, counts, times); maps in key order (Q209)
const PUBLIC_KEYS = Object.freeze(['kv', ...MAPS, 'day']);
function publicState(st) {
  const o = {};
  for (const k of PUBLIC_KEYS) {
    if (!st || st[k] === undefined) continue;
    if (k === 'day') { if (st.day && st.day.s && st.day.s.length) o.day = { d: st.day.d | 0, s: [...st.day.s].sort() }; }
    else if (MAPS.indexOf(k) >= 0) o[k] = sortKeys(st[k]);
    else o[k] = st[k];
  }
  return o;
}
function hasEntries(st) { return MAPS.some((k) => st && st[k] && Object.keys(st[k]).length > 0) || !!(st && st.day && st.day.s && st.day.s.length); }

const keys = (kh) => ({
  target: (t) => kh('like-of|' + t),
  match: (v, m) => kh('like-mt|' + v + '|' + m),
  key: (m) => kh('like-k|' + m),
  entry: (v, t, min) => kh('like-bt|' + v + '|' + t + '|' + (min >>> 0)),
  pair: (v, t) => kh('like-pr|' + v + '|' + t),
  slot: (d, v, i) => kh('like-day|' + (d | 0) + '|' + v + '|' + (i | 0)),
});
const stampOf = (min, now) => Math.max(now, Math.min(min >>> 0, now + LIKE.ENTRY_TTL_MIN));

function credit(st, tkey, kind, season) {
  const c = st.cnt[tkey] || (st.cnt[tkey] = { n: 0, s: 0, sn: season | 0, m: 0, b: 0 });
  if ((c.sn | 0) !== (season | 0)) { c.sn = season | 0; c.s = 0; }
  c.n += 1; c.s += 1;
  if (kind === LIKE.KIND_MATCH) c.m += 1; else c.b += 1;
}

// Keys settled this run and not voided (validate.js, at the settle sites; matchmade keys only matter): from now on they take
// kind 1 likes for OK_TTL_MIN, and the likes waiting for them count now. ctx = { kh, now (unix minute), season } and, from
// validate.js (W79 / L1), sidOfTarget(targetKey) -> SteamID | null (the players of this run's records) + known(sid): a
// waiting like counts only for a target this job knows (has settled XP for -- the same closure audit.js holds every
// like_count row to); one it cannot name or does not know is dropped unminted (its box entry, still queued, is harvested
// again and then needs the known rule like any kind 1 like). Without them (the L0 tests) nothing is checked. A waiting
// teammate like (p, rule 4) counts only outside the pair week, and then takes the pair token (pair: dropped, the same).
// Returns { certified, resolved: [targetKey], resolvedSids: [sid], unknown, pair, deferred }.
function certify(st, settledKeys, ctx) {
  const res = { certified: 0, resolved: [], resolvedSids: [], unknown: 0, pair: 0, deferred: false };
  if (!ready(st)) { res.deferred = true; return res; }
  norm(st);
  const K = keys(ctx.kh), now = ctx.now | 0;
  for (const m of settledKeys || []) { const kt = K.key(m); if (st.ok[kt] === undefined) { st.ok[kt] = now; res.certified++; } }
  for (const tk of Object.keys(st.pend)) {
    const p = st.pend[tk];
    if (!p || st.ok[p.k] === undefined) continue;
    delete st.pend[tk];
    if (st.mt[tk] !== undefined) continue;
    const sid = ctx.sidOfTarget ? ctx.sidOfTarget(p.t) : null;
    if (ctx.sidOfTarget && ctx.known && !(sid && ctx.known(sid))) { res.unknown++; continue; }
    if (p.p && inWeek(st.pr[p.p], now)) { res.pair++; continue; }
    st.mt[tk] = stampOf(p.w == null ? now : p.w, now);
    if (p.p) st.pr[p.p] = now;
    credit(st, p.t, LIKE.KIND_MATCH, ctx.season);
    res.resolved.push(p.t);
    if (sid) res.resolvedSids.push(sid);
  }
  if (hasEntries(st)) st.kv = LIKE.KV;
  return res;
}

// Fold this run's box rows into state (pure; mutates st). rows = [{ voterSid, det }] (det = decoded int32[]).
// ctx = { kh, now (unix minute, this job's clock), season, match: lookup from matchIndex, known(sid) -> bool }.
// Returns { counted: [{ sid, kind }], pended, why: { reason: n }, targets: [sid] (every plausible target seen: rows to
// (re)write in boardPlan), deferred }.
function harvest(st, rows, ctx) {
  const res = { counted: [], pended: 0, why: {}, targets: [], deferred: false };
  if (!ready(st)) { res.deferred = true; return res; }
  norm(st);
  const K = keys(ctx.kh), now = ctx.now | 0;
  const why = (r) => { res.why[r] = (res.why[r] | 0) + 1; };
  const tset = new Set();
  const today = Math.floor(now / 1440);
  if ((st.day.d | 0) !== today) st.day = { d: today, s: [] };
  const slots = new Set(st.day.s), dayOf = new Map();
  const dayCount = (v) => { if (!dayOf.has(v)) { let i = 0; while (slots.has(K.slot(today, v, i))) i++; dayOf.set(v, i); } return dayOf.get(v); };
  for (const r of rows || []) {
    const V = String(r && r.voterSid);
    const box = sidPlausible(V) ? decodeBox(r.det) : null;
    if (!box) { why('badrow'); continue; }
    for (const e of box.entries) {
      const T = e.sid;
      if (!sidPlausible(T) || (e.kind !== LIKE.KIND_MATCH && e.kind !== LIKE.KIND_BOARD)) { why('bad'); continue; }
      if (T === V) { why('self'); continue; }
      if (!tset.has(T)) { tset.add(T); res.targets.push(T); }
      if (now - (e.min >>> 0) > LIKE.ENTRY_TTL_MIN) { why('stale'); continue; }
      if (e.kind === LIKE.KIND_MATCH) {
        if ((e.ref | 0) === 0) { why('bad'); continue; }
        const info = ctx.match ? ctx.match(V, e.ref | 0) : null;
        if (!info) { why('norec'); continue; }
        if (info.why) { why(info.why); continue; }
        if (!isMatchmadeMt(info.mt)) { why('notmm'); continue; }
        if (!isFinished(info.vDisp)) { why('unfinished'); continue; }
        const ros = info.roster || {};
        if (String(ros[info.vSeat]) !== V) { why('seat'); continue; }
        const tSeats = Object.keys(ros).filter((s) => String(ros[s]) === T).map((s) => s | 0);
        if (tSeats.length !== 1) { why('notin'); continue; }
        const u = unitOf(info.mt, info.vSeat | 0, tSeats[0]);
        if (u) { why(u); continue; }
        const pt = mateOf(info.mt, info.vSeat | 0, tSeats[0]) ? K.pair(V, T) : null;   // a teammate: the pair rule (rule 4)
        const tk = K.match(V, info.m);
        if (st.mt[tk] !== undefined) { why('dup'); continue; }
        const kt = K.key(info.m);
        if (st.ok[kt] !== undefined) {
          // the match is settled: T must be a player this job knows (W79: the audit closure of like_count; one named only by
          // the others' rosters who never wrote a result of his own is not) -- nothing minted, the entry may count later
          if (ctx.known && !ctx.known(T)) { why('unknown'); continue; }
          if (pt && inWeek(st.pr[pt], now)) { why('pair'); continue; }   // not taken: may count once the week is over
          delete st.pend[tk];
          st.mt[tk] = stampOf(e.min, now);
          if (pt) st.pr[pt] = now;
          credit(st, K.target(T), LIKE.KIND_MATCH, ctx.season);
          res.counted.push({ sid: T, kind: LIKE.KIND_MATCH });
        } else if (st.pend[tk] !== undefined) why('waiting');
        else { st.pend[tk] = pt ? { k: kt, t: K.target(T), at: now, w: e.min >>> 0, p: pt } : { k: kt, t: K.target(T), at: now, w: e.min >>> 0 }; res.pended++; }
      } else {
        if (!ctx.known || !ctx.known(T)) { why('unknown'); continue; }
        const et = K.entry(V, T, e.min);
        if (st.bt[et] !== undefined) { why('dup'); continue; }
        const pt = K.pair(V, T), last = st.pr[pt];
        if (last !== undefined && now - (last | 0) < LIKE.PAIR_WEEK_MIN) { why('week'); continue; }
        const n = dayCount(V);
        if (n >= LIKE.BOARD_DAILY_CAP) { why('capped'); continue; }
        st.bt[et] = stampOf(e.min, now);
        st.pr[pt] = now;
        slots.add(K.slot(today, V, n)); dayOf.set(V, n + 1);
        credit(st, K.target(T), LIKE.KIND_BOARD, ctx.season);
        res.counted.push({ sid: T, kind: LIKE.KIND_BOARD });
      }
    }
  }
  st.day.s = [...slots].sort();
  if (hasEntries(st)) st.kv = LIKE.KV;
  return res;
}

// Drop what has run out (pure; mutates). Returns { evicted } (tokens dropped by a size fuse before their time).
function prune(st, now) {
  if (!ready(st)) return { evicted: 0, deferred: true };
  norm(st);
  now = now | 0;
  let evicted = 0;
  const cap = (map, max, at) => {
    const ks = Object.keys(map);
    if (ks.length <= max) return;
    ks.sort((a, b) => (at(map[a]) - at(map[b])) || (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < ks.length - max; i++) { delete map[ks[i]]; evicted++; }
  };
  const ttl = (map, t, at) => { for (const k of Object.keys(map)) if (now - at(map[k]) > t) delete map[k]; };
  const num = (v) => v | 0, pat = (p) => (p && p.at) | 0;
  ttl(st.mt, LIKE.ENTRY_TTL_MIN, num); cap(st.mt, LIKE.TOKENS_MAX, num);
  ttl(st.bt, LIKE.ENTRY_TTL_MIN, num); cap(st.bt, LIKE.TOKENS_MAX, num);
  ttl(st.pr, LIKE.PAIR_TTL_MIN, num); cap(st.pr, LIKE.PAIRS_MAX, num);
  ttl(st.ok, LIKE.OK_TTL_MIN, num); cap(st.ok, LIKE.OK_MAX, num);
  ttl(st.pend, LIKE.PENDING_TTL_MIN, pat); cap(st.pend, LIKE.PENDING_MAX, pat);
  if ((st.day.d | 0) !== Math.floor(now / 1440)) st.day = { d: Math.floor(now / 1440), s: [] };
  if (hasEntries(st)) st.kv = LIKE.KV;
  return { evicted };
}

// like_count rows to write (pure apart from adopting into st). boardRows = [{ sid, score, det }] read this run (all or
// part of the board); sids = SteamIDs to make sure of (harvest targets: a row whose first write failed is retried while an
// entry naming him is still on the box). The state is the truth: a row that differs from it is rewritten. Two exceptions,
// both "the state lost what the board still shows" (a restored older state file; only this job writes the board): a row
// with no state entry, or one whose lifetime count is above the state's, is taken INTO the state instead (adopted /
// behind). A row read lower than the state is a stale read or a failed write: rewritten, never adopted (no "read + 1").
// Returns { writes: [{ sid, score, details }] (at most WRITE_MAX), adopted, behind, more, deferred }.
function boardPlan(st, boardRows, sids, ctx) {
  const res = { writes: [], adopted: 0, behind: 0, more: 0, deferred: false };
  if (!ready(st)) { res.deferred = true; return res; }
  norm(st);
  const K = keys(ctx.kh);
  const seen = new Set(), want = [];
  const same = (a, b) => a && b && a.n === b.n && a.sn === b.sn && a.s === b.s && a.m === b.m && a.b === b.b;
  for (const r of boardRows || []) {
    const sid = String(r && r.sid);
    if (!sidPlausible(sid) || seen.has(sid)) continue;
    seen.add(sid);
    const k = K.target(sid), got = decodeCount(r.score, r.det), e = st.cnt[k];
    if (!e) { if (got) { st.cnt[k] = got; res.adopted++; } continue; }
    const cur = { n: e.n | 0, sn: e.sn | 0, s: e.s | 0, m: e.m | 0, b: e.b | 0 };
    if (got && got.n > cur.n) { st.cnt[k] = got; res.behind++; continue; }
    if (!same(got, cur)) want.push(sid);
  }
  for (const sid of sids || []) {
    const s = String(sid);
    if (!sidPlausible(s) || seen.has(s)) continue;
    seen.add(s);
    if (st.cnt[K.target(s)]) want.push(s);
  }
  for (const sid of want.slice(0, LIKE.WRITE_MAX)) { const row = countRow(st.cnt[K.target(sid)]); res.writes.push({ sid, score: row.score, details: row.details }); }
  res.more = Math.max(0, want.length - LIKE.WRITE_MAX);
  if (hasEntries(st)) st.kv = LIKE.KV;
  return res;
}

module.exports = { LIKE, sidPlausible, encodeBox, decodeBox, countRow, decodeCount, isMatchmadeMt, unitOf, mateOf, matchIndex,
  norm, ready, publicState, PUBLIC_KEYS, keys, certify, harvest, prune, boardPlan };
