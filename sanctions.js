'use strict';
// ============================================================
// sanctions.js -- anti-cheat sanction sync pipeline (EOS -> boards + platform bans)
// ============================================================
// Consumes the EOS Sanctions "sync" Web API (an incremental event stream with a
// lastLogId cursor; eventType 1=create 2=update 3=delete) and enforces downstream:
//   1. ban gate board (trusted-writes 'ban_board'): one row per sanctioned
//      account, score=1. Detail layout (client eac-gate decodes the same way):
//        details[0] = expiry in unix minutes (0 = permanent)
//        details[1] = action code: 1 = full ban (RESTRICT_GAME_ACCESS et al),
//                     2 = matchmaking-only (RESTRICT_MATCHMAKING). Absent/0 =
//                     legacy row = full ban (conservative).
//        details[2..5] = sanction referenceId (UUID, 16 bytes as 4 big-endian
//                     int32s; all-zero = absent) -- the appeal handle the client
//                     must show even when the guard is not running.
//      The client boot gate / queue gate / roster cross-check all read this
//      board; clearing the row (on unban / expiry) restores access. Fail-open on
//      the client side, so a missing board only ever weakens, never strands.
//   2. leaderboard exile (FULL bans only -- a matchmaking restriction is not a
//      score-fraud verdict): the banned account's rows on the display boards are
//      moved to a same-shape '<board>_banned' shadow board (trusted) and deleted
//      from the source. THE SHADOW IS THE STORAGE: restore on unban reads the
//      shadow row back (score + raw detail bytes preserved). No identity or
//      score ever needs to live in repo state -- the state file stays a cursor.
//      Which boards: EXILE_DISPLAY below, derived from validate.js's board-name
//      constants (+ per-season twins); everything else validate.js knows is on
//      EXILE_KEEP with its reason. Source boards are only ever looked up, never
//      created; a shadow board is created when a row first moves onto it.
//   3. platform game bans (optional; FULL bans only -- a Steam game ban is a
//      public account mark): ICheatReportingService report+ban per app id listed
//      in BAN_APPIDS (revoke on unban). Runs only where that env is set (one
//      job), so a two-job workflow cannot double-issue.
//   4. expiry sweep: EOS does not emit a sync event when a temporary sanction
//      lapses on its own (only create/update/delete are in the stream), so a
//      details[0] deadline that passes would otherwise leave the gate row -- and
//      the exiled scores -- in place forever. Every run scans ban_board for
//      expired rows and runs the unban path on them (idempotent; the client
//      additionally fail-opens past the deadline locally so nobody waits on us).
//   5. a mail note per processed event (rare-event observability; same channel
//      as the feedback digest).
// Own workflow (sanctions.yml), hourly + manual dispatch -- never inside the
// reconcile tick. State file is disjoint (sanctions.json / pt-sanctions.json),
// persisted with the usual rebase-retry.
//
// Identity (2026-08-28 drill finding, docs-confirmed): sync events DO carry
// identityProvider + accountId fields, but portal-created sanctions leave both
// null -- only productUserId is guaranteed. So the platform id is resolved via
// the Connect Web API instead (GET /user/v1/product-users?productUserId=...,
// policy action queryProductUsersForAnyUser, max 16 per call), which returns the
// account list per PUID: [{accountId, identityProviderId:'steam', displayName}].
// The event's own identity fields are still used when present (saves a call).
// A PUID with no steam account linked is logged (pseudonymized) and skipped --
// there is nothing to enforce against on the board side.
// Logs are public (Actions): account ids only ever appear as HMAC pseudonyms.
// The mail body may carry the real id (private inbox, needs to be actionable).
const fs = require('fs');
const crypto = require('crypto');
const v = require('./validate.js');
const trustLedger = require('./trust-ledger.js');   // O198 v1 (knife 5.5b-1): sanction events queued for the reconcile's trust ledger

const SN_STATE_FILE = process.env.SN_STATE_FILE || 'sanctions.json';
// O198 v1 trust ledger (knife 5.5b-1): every enacted ban / matchmaking restriction / unban is also queued in this file's `events`
//   (pid only -- the state file still names nobody); the reconcile takes them into its trust.json and keeps the last id it took
//   there (`taken.sanctions`), read back here to prune the queue. The shadow boards stay the storage of everything else.
const TRUST_FILE = process.env.TRUST_FILE || 'trust.json';   // read-only (the reconcile owns it)
const BAN_LB = v.BAN_LB;   // ban gate board (env BAN_LB, default ban_board; lockstep: client eac-gate BOARD_BAN): the name lives in
                           //   validate.js since cloud audit Q338 -- the reconcile reads the board to keep full bans off the cup podium,
                           //   the tier cuts and the composite ladders; this job is still its only writer
const BAN_SHADOW_SUFFIX = '_banned';
// ---- which boards a full ban exiles (cloud audit R1-X13, 2026-10-09) ----
// The first cut kept a hand-written default (xp_ladder, endless_board, endless_board_trio, card_box) plus an
// EXILE_BOARDS secret for "extra names" -- the secret was never set, so every display board added since (solo /
// four-seat casual, the five competitive ladders, classic, campaign endless, ranked points, the supporter wall, and the
// per-season twins from 2026-12-01 on) kept a banned account's rows. The list is now DERIVED from validate.js's own
// board-name constants -- one source of names, none copied here:
//   EXILE_DISPLAY  every board a player sees as a ranking / roster, by validate.js export key (or, for card_box, the
//                  literal name validate.js uses -- the tripwire checks it is still there). season: the family
//                  has per-season twins `<base>_s<N>` (validate.js resolveSeasonBoard) -> _s1.._s<current> are added.
//                  perDif: campaign endless ladders = prefix + 1..CAMPAIGN_ENDLESS_DIF_MAX + suffix. The names that
//                  reach validate.js only through secrets (LB_PREFIX / RANKED_LB / LP_LB / XP_LB) are handed to this job
//                  by sanctions.yml exactly as validate.yml hands them to the reconcile (no board name is written into
//                  this public repo); a job missing one warns once per run and leaves that board alone.
//   EXILE_KEEP     every other board validate.js names (constant key, or the literal name for the few literal boards),
//                  each with the reason it is not exiled.
// test/sanctions-boards.js scans validate.js and fails when a board constant or literal board name sits in neither
// table (or in both), or when the season flags disagree with validate.js -- a new board has to be classified.
// A composite ladder (endless_comp_overall / endless_board_overall / endless_classic_overall) is rebuilt every run from its
// per-size ladders, so it is exiled only together with every one of them, under the same season flag (the test checks it).
// Re-issued 2026-10-27 on the 10-27 main (cloud audit Q40 / R2-B2-53): the boards added after 10-09 are classified.
// EXILE_BOARDS (env) only APPENDS names (a display board outside validate.js); a name on the keep list is refused.
const EXILE_DISPLAY = Object.freeze([
  { key: 'ENDLESS_LB', season: true },              // casual endless, two seats (endless_board)
  { key: 'ENDLESS_LB_SOLO', season: true },
  { key: 'ENDLESS_LB_TRIO', season: true },
  { key: 'ENDLESS_LB_QUAD', season: true },
  { key: 'ENDLESS_COMP_LB', season: true },         // competitive endless, solo (endless_comp_solo)
  { key: 'ENDLESS_COMP_LB_DUO', season: true },
  { key: 'ENDLESS_COMP_LB_TRIO', season: true },
  { key: 'ENDLESS_COMP_LB_QUAD', season: true },
  { key: 'ENDLESS_COMP_LB_COUCH', season: true },   // O606 couch competitive (endless_comp_couch: the dual write; merged rows also sit on the duo ladder)
  { key: 'ENDLESS_COMP_LB_OVERALL', season: true },
  { key: 'ENDLESS_LB_OVERALL', season: true },      // casual composite (endless_board_overall; inputs = the four casual ladders above)
  { key: 'ENDLESS_LB_CLASSIC_SOLO' },               // classic (nostalgia) endless: lifetime ladders only
  { key: 'ENDLESS_LB_CLASSIC_DUO' },
  { key: 'ENDLESS_LB_CLASSIC_TRIO' },
  { key: 'ENDLESS_LB_CLASSIC_QUAD' },
  { key: 'ENDLESS_LB_CLASSIC_OVERALL' },            // classic composite (lifetime only, like its inputs)
  { key: 'CAMPAIGN_ENDLESS_LB_PREFIX', perDif: true },   // campaign endless ladders campaign_endless_d1..d3
  { key: 'XP_LB' },                                 // level ladder (name from the XP_LB secret)
  { key: 'LP_LB', season: true },                   // ranked points (name from the LP_LB secret; never on the playtest/demo apps)
  { key: 'card_box' },                              // cosmetic claim rows that dress a player's board rows; a literal in
                                                    //   validate.js ptBoardPlan (the client repo's playtest-gate test pins that text)
  { key: 'SUPPORTER_WALL_LB' },                     // supporter wall (supporter_wall)
  { key: 'ENDLESS_CUP_HONOR_LB' },                  // Gold Rush Cup name marks (endless_cup_honor; maintainCup never writes an exiled row back)
  { key: 'LIKE_COUNT_LB' },                         // lifetime likes shown on profiles and board rows (like_count; the likes lane only
                                                    //   rewrites rows it reads or players liked this run, so a moved row stays moved)
]);
const EXILE_KEEP = Object.freeze({
  PREFIX: 'match record shards (reconcile input, never shown)',
  RANKED_LB: 'hidden rating (mu / sigma), never shown as a ranking',
  PT_MIRROR_LB: 'client progress mirror (disaster backup, never shown)',
  REPORT_LB: 'player report box (client-written input)',
  UNMATCHED_LB: 'host self-incrimination box (record-only input)',
  ACTIVE_MATCH_LB: 'reconnect-record mirror (each client reads its own row only)',
  TRUST_LB: 'trust tier (matchmaking input, never shown)',
  SUPPORTER_OPTOUT_LB: 'supporter wall opt-out flags (client-written input)',
  CHAT_MUTE_LB: 'chat mute list (clients read it to hide chat -- a banned account staying muted is the point)',
  CHAT_REPORT_LB: 'chat report box (client-written input)',
  CP_LB: 'wallet balance, not a ranking',
  REDEEM_LB: 'wallet redemption box',
  GRANT_LB: 'cosmetic grant box (unlock evidence)',
  CAMPAIGN_LB: 'campaign clear box (unlock evidence)',
  CAMPAIGN_ENDLESS_BOX_PREFIX: 'campaign endless run boxes (guard-written input)',
  CAMPAIGN_ENDLESS_OFFENSE_LB: 'campaign endless offense ledger (ops record)',
  CAMPAIGN_ENDLESS_SAVE_PREFIX: 'campaign endless save rows per difficulty (campaign_endless_save_box_d1..d3, guard-written; a save, not a ranking)',
  SAVE_BOX_LB: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_DUO: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_TRIO: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_QUAD: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_CASUAL: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_COUCH: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_CLASSIC: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_CLASSIC_DUO: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_CLASSIC_TRIO: 'endless save rows (a save, not a ranking)',
  SAVE_BOX_LB_CLASSIC_QUAD: 'endless save rows (a save, not a ranking)',
  version_gate: 'authoritative version gate (ops-written config)',
  gate_window: 'queue gate window (ops-written config)',
  pt_master: 'playtest master switch (ops-written config)',
  CRON_PULSE_LB: 'reconcile heartbeat row (ops monitor, one carrier row)',
  TRUST_LEDGER_LB: 'trust ledger mirror (friends-only reads, never shown; a ban must not erase the record)',
  LIKE_BOX_LB: 'like box (client-written input)',
  ENDLESS_RATING_LB_SOLO: 'endless tier score (the client reads one player\'s row to draw his tier badge; not a ranking list -- the ladder rows the badge sits on are exiled)',
  ENDLESS_RATING_LB_DUO: 'endless tier score (the client reads one player\'s row to draw his tier badge; not a ranking list -- the ladder rows the badge sits on are exiled)',
  ENDLESS_RATING_LB_TRIO: 'endless tier score (the client reads one player\'s row to draw his tier badge; not a ranking list -- the ladder rows the badge sits on are exiled)',
  ENDLESS_RATING_LB_QUAD: 'endless tier score (the client reads one player\'s row to draw his tier badge; not a ranking list -- the ladder rows the badge sits on are exiled)',
  ENDLESS_TIERCUT_LB: 'tier cut carrier (one ops row, no player rows)',
  ENDLESS_CUP_LB: 'Gold Rush Cup carrier (one ops row, no player rows)',
  BAN_LB: 'the ban gate board itself (this job writes it; the reconcile only reads it -- Q338)',
});
// env: extra display boards (comma list), appended to the derived list. Unset in production.
const EXILE_BOARDS = String(process.env.EXILE_BOARDS || '').split(',').map(s => s.trim()).filter(Boolean);

// validate.js board name for a table key ('' when the job is not handed the secret that names it).
function boardNameOf(key) {
  if (/^[a-z]/.test(key)) return key;   // a literal board name (validate.js names it as a literal, not a constant)
  const n = v[key];
  return n ? String(n) : '';
}
// Display keys that name no board on this job (a secret sanctions.yml does not pass): those boards would keep a banned
//   account's rows. Empty in production; the test pins the workflow so every secret-only name is passed on all three jobs.
//   (A keep key without a name only loosens the EXILE_BOARDS refusal, and the secret is unset in production.)
function unnamedKeys() {
  return EXILE_DISPLAY.map(e => e.key).filter(k => !boardNameOf(k));
}
// Exact names + name prefixes that must never be exiled (pure; the env append is checked against it).
function keepBoardNames() {
  const names = new Set(), prefixes = [];
  for (const key of Object.keys(EXILE_KEEP)) {
    if (/^[a-z]/.test(key)) { names.add(key); continue; }           // literal board name
    const n = boardNameOf(key);
    if (!n) continue;                                               // no name on this job (unnamedKeys warns once per run)
    if (/_PREFIX$|^PREFIX$/.test(key)) prefixes.push(n); else names.add(n);
  }
  return { names, prefixes, has: (n) => names.has(n) || prefixes.some(p => String(n).indexOf(p) === 0) };
}
// The exile list for the current season (pure): every display board, its season twins _s1.._s<seasonId>, then the
// env append (deduplicated, keep-list names refused).
function exileSources(seasonId, extra) {
  const out = [], seen = new Set();
  const push = (n) => { if (n && !seen.has(n)) { seen.add(n); out.push(n); } };
  for (const e of EXILE_DISPLAY) {
    const base = boardNameOf(e.key);
    if (!base) continue;
    const bases = [];
    if (e.perDif) for (let d = 1; d <= (v.CAMPAIGN_ENDLESS_DIF_MAX | 0); d++) bases.push(base + d + (v.CAMPAIGN_ENDLESS_SUFFIX || ''));
    else bases.push(base);
    for (const b of bases) {
      push(b);
      if (e.season) for (let sn = 1; sn <= (seasonId | 0); sn++) push(v.seasonBoardName(b, sn));
    }
  }
  const keep = keepBoardNames();
  for (const n of (extra || [])) {
    if (keep.has(n)) { v.ghWarn('EXILE_BOARDS lists ' + n + ', which is on the keep list -- ignored'); continue; }
    push(n);
  }
  return out;
}
const BAN_APPIDS = String(process.env.BAN_APPIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const EOS_BASE = process.env.EOS_BASE || 'https://api.epicgames.dev';
const SN_EVENT_CAP = Math.max(1, Number(process.env.SN_EVENT_CAP || 500));   // safety valve per run
const SN_MAP_BATCH = 16;   // documented max productUserId values per Connect query
// ---- run time budget (cloud audit Q117, 2026-10-10) ----
// Each job has a 10-minute timeout (sanctions.yml). A run the timeout kills never reaches saveState, and the persist
// step after it does not run either, so the next run fetches the same events from the same cursor. A full ban reads
// the account's row on every display board (about 35 Steam calls in season 1, about 10 more each season after), so a
// burst of sanctions could make every run die at the same place: bans, unbans and platform bans would all stall, and
// each killed run would report the already-handled accounts to Steam again. Writing the state file more often would
// not help (the persist step is skipped once the job is killed), so the run itself stops in time. Two deadlines,
// measured from process start (the checkout and test steps before this one take well under a minute):
//   SN_SOFT_MS (6 min)    no new sync batch, no new event and no expiry sweep is started after it;
//   SN_HARD_MS (7.5 min)  an event still in flight stops between two board steps.
// The cursor only ever moves past an event once that event is fully enforced, so a stopped run saves the cursor at the
// last finished event, exits 0, and the next tick re-runs a stopped event from the top (every step is idempotent: a
// moved row is no longer on its source board, a restored row is no longer on its shadow).
const SN_SOFT_MS = Math.max(0, Number(process.env.SN_SOFT_MS || 6 * 60 * 1000));
const SN_HARD_MS = Math.max(SN_SOFT_MS, Number(process.env.SN_HARD_MS || 7.5 * 60 * 1000));
class BudgetStop extends Error { constructor(m) { super(m); this.name = 'BudgetStop'; } }
// now(): ms since process start by default (performance.now() is monotonic and counts from the process time origin);
// tests pass a simulated clock and their own deadlines.
function runBudget(now, softMs, hardMs) {
  const clock = now || (() => performance.now());
  const soft = softMs == null ? SN_SOFT_MS : softMs;
  const hard = hardMs == null ? SN_HARD_MS : Math.max(soft, hardMs);
  return {
    soft, hard,
    elapsed: () => clock(),
    softPassed: () => clock() >= soft,
    checkHard(what) { if (clock() >= hard) throw new BudgetStop('time budget: ' + what + ' stopped at ' + Math.round(clock() / 1000) + 's'); },
  };
}

const pid = (s) => crypto.createHmac('sha256', String(process.env.STATE_SALT || '')).update(String(s)).digest('hex').slice(0, 16);
const plog = (s) => pid(s).slice(0, 8);

function loadState() {
  // lastLogId is an opaque STRING id (drill-verified 2026-08-28: a UUID, not a
  // number -- the docs type it "string"); '' = no cursor yet (full sync).
  try {
    const st = JSON.parse(fs.readFileSync(SN_STATE_FILE, 'utf8'));
    if (typeof st.lastLogId !== 'string') st.lastLogId = '';   // migrate the pre-drill numeric field
    if (!st.boards) st.boards = {};
    return st;
  } catch (e) { return { lastLogId: '', boards: {} }; }
}
function saveState(st) { fs.writeFileSync(SN_STATE_FILE, JSON.stringify(st, null, 0)); }

// ---- EOS auth (client_credentials on the trusted-server client) ----
async function eosToken() {
  const id = process.env.EOS_TRUSTED_CLIENT_ID, sec = process.env.EOS_TRUSTED_CLIENT_SECRET;
  const dep = process.env.EOS_DEPLOYMENT_ID;
  if (!id || !sec || !dep) throw new Error('missing EOS_TRUSTED_CLIENT_ID/SECRET or EOS_DEPLOYMENT_ID');
  const res = await fetch(EOS_BASE + '/auth/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&deployment_id=' + encodeURIComponent(dep),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j || !j.access_token) throw new Error('EOS token HTTP ' + res.status + ' ' + JSON.stringify(j && j.errorCode || null));
  return j.access_token;
}

// ---- sync fetch (docs: GET /sanctions/v1/sync, query param lastLogId only) ----
// The endpoint returns the next batch of events after the cursor; batch size is the
// server's choice (no client-side limit parameter exists). Events arrive in log order
// -- the caller consumes them as-is and takes the LAST element's logId as the next
// cursor. Repeat until an empty batch = caught up.
async function fetchSyncBatch(token, lastLogId) {
  const url = EOS_BASE + '/sanctions/v1/sync' + (lastLogId ? '?lastLogId=' + encodeURIComponent(lastLogId) : '');
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new Error('sanctions sync HTTP ' + res.status + ' ' + JSON.stringify(j && (j.errorCode || j.message) || null));
  return j;
}

// ---- event normalization (field names per the Sanctions Web API docs) ----
// Thin mapper so the rest of the file never touches raw payload shape. logId stays
// a STRING (resume token). Events with no logId/puid are unusable and dropped.
function normalizeEvents(json) {
  const raw = (json && Array.isArray(json.elements)) ? json.elements : (Array.isArray(json) ? json : []);
  return raw.map(o => ({
    logId: String(o.logId || ''),
    eventType: Number(o.eventType) || 0,
    puid: String(o.productUserId || ''),
    action: String(o.action || ''),
    pending: !!o.pending,
    automated: !!o.automated,
    idp: String(o.identityProvider || ''),
    accountId: String(o.accountId || ''),
    expiresAt: o.expirationTimestamp || null,
    refId: String(o.referenceId || ''),
    justification: String(o.justification || ''),
    displayName: String(o.displayName || ''),
  })).filter(e => e.logId && e.puid);
}

// steam id straight off the event, when it carries one. Portal-created sanctions
// leave identityProvider/accountId null (drill-verified 2026-08-28), so this is only
// a fast path -- resolveSteamIds below is the real resolver.
function sidOfEvent(ev) {
  if (!/steam/i.test(ev.idp || '')) return null;
  const a = String(ev.accountId || '').replace(/[^0-9]/g, '');
  return a.length === 17 ? a : null;
}

// PUID -> steamid64 via the Connect Web API (docs: GET /user/v1/product-users,
// policy action queryProductUsersForAnyUser, max 16 productUserId values/call).
// Returns a plain {puid: sid} map; a PUID with no linked steam account is absent.
async function resolveSteamIds(token, puids) {
  const out = {};
  for (let i = 0; i < puids.length; i += SN_MAP_BATCH) {
    const batch = puids.slice(i, i + SN_MAP_BATCH);
    const q = batch.map(x => 'productUserId=' + encodeURIComponent(x)).join('&');
    const res = await fetch(EOS_BASE + '/user/v1/product-users?' + q,
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error('product-users HTTP ' + res.status + ' ' + JSON.stringify(j && j.errorCode || null));
    const users = (j && j.productUsers) || {};
    for (const puid of Object.keys(users)) {
      const accts = (users[puid] && users[puid].accounts) || [];
      const steam = accts.find(a => String(a.identityProviderId || '').toLowerCase() === 'steam');
      const sid = steam && String(steam.accountId || '').replace(/[^0-9]/g, '');
      if (sid && sid.length === 17) out[puid] = sid;
    }
  }
  return out;
}

// expiry -> unix minutes int32 (0 = permanent/unknown). Accepts epoch seconds,
// epoch millis, or an ISO string.
function expiryMinOf(x) {
  if (x == null) return 0;
  let ms = 0;
  if (typeof x === 'number') ms = x > 4e10 ? x : x * 1000;
  else { const t = Date.parse(String(x)); ms = Number.isFinite(t) ? t : 0; }
  if (!(ms > Date.now())) return 0;
  return Math.floor(ms / 60000) | 0;
}

// eventType + pending -> enforcement verb ('ban' | 'unban' | 'skip'); pure.
function verbOf(ev) {
  if (ev.eventType === 3) return 'unban';
  if (ev.eventType === 1 || ev.eventType === 2) return ev.pending ? 'skip' : 'ban';
  return 'skip';
}

// ---- ban_board detail codec (client eac-gate.js decodes the same layout) ----
// Action string -> code. Only RESTRICT_MATCHMAKING maps to the softer queue-only
// gate; every other (or unknown/custom) action stays a full ban -- unknown
// severity must not accidentally widen access.
const ACT_FULL = 1, ACT_MM = 2;
function actionCodeOf(action) {
  return /RESTRICT_MATCHMAKING/i.test(String(action || '')) ? ACT_MM : ACT_FULL;
}
// UUID string -> 4 big-endian int32s (all-zero when absent/malformed).
function refIdInts(refId) {
  const hex = String(refId || '').replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return [0, 0, 0, 0];
  const out = [];
  for (let i = 0; i < 4; i++) out.push(parseInt(hex.slice(i * 8, i * 8 + 8), 16) | 0);
  return out;
}
// Inverse (tooling/tests; the client carries its own mirror -- lockstep-pinned).
function refIdFromInts(ints) {
  if (!Array.isArray(ints) || ints.length < 4 || ints.every(x => (x | 0) === 0)) return '';
  let hex = '';
  for (let i = 0; i < 4; i++) hex += ((ints[i] | 0) >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
}
function banDetails(expMin, actCode, refId) {
  return [expMin | 0, actCode | 0].concat(refIdInts(refId));
}

// ---- board row moves (exile/restore) ----
// Detail bytes are round-tripped through validate.js's own codec (decodeDetails ->
// int32 array -> postFormDetails) rather than a second hand-rolled hex/percent
// encoder: one encoder in the repo, and the shadow row is byte-identical to the
// source row it replaces.
async function setRow(boardId, sid, score, detailHex) {
  const det = detailHex ? v.decodeDetails(String(detailHex)) : null;
  const params = {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID,
    leaderboardid: boardId, steamid: sid, score: score | 0, scoremethod: 'ForceUpdate', format: 'json',
  };
  const r = (det && det.length)
    ? await v.postFormDetails('/ISteamLeaderboards/SetLeaderboardScore/v1/', params, det)
    : await v.postForm('/ISteamLeaderboards/SetLeaderboardScore/v1/', params);
  return r.ok;
}
async function delRow(boardId, sid) {
  const r = await v.postForm('/ISteamLeaderboards/DeleteLeaderboardScore/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID,
    leaderboardid: boardId, steamid: sid, format: 'json',
  });
  return r.ok;
}

// ---- platform game bans (ICheatReportingService; publisher key scope) ----
// Two-step per moderation/TOOLS.md: report (carries the evidence text, so an appeal
// review can find it by reportid -- moderation README rule 2) then ban. Only runs
// where BAN_APPIDS is set; unset (the default) = boards-only enforcement.
async function steamBan(sid, appid, durationSec, ev) {
  const evidence = 'EOS sanction ' + (ev.refId || '?') + ' action=' + (ev.action || '?') +
    (ev.automated ? ' (automated detection)' : ' (manual)') +
    ' puid=' + (ev.puid || '?') + ' justification: ' + (ev.justification || '(none)');
  const rep = await v.postForm('/ICheatReportingService/ReportPlayerCheating/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid,
    heuristic: 1, severity: 10, raw_report: evidence, format: 'json',
  });
  const reportid = rep.json && rep.json.response && rep.json.response.reportid;
  if (!reportid) { v.ghWarn('steam ban: no reportid (app ' + appid + ', HTTP ' + rep.status + ')'); return false; }
  const ban = await v.postForm('/ICheatReportingService/RequestPlayerGameBan/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid, reportid,
    duration: durationSec | 0, delayban: 0, flags: 0,
    cheatdescription: 'EOS sanction ' + (ev.refId || ''), format: 'json',
  });
  if (!ban.ok) v.ghWarn('steam ban failed (app ' + appid + ', HTTP ' + ban.status + ')');
  else console.log('  steam ban issued app=' + appid + ' report=' + reportid);
  return ban.ok;
}
async function steamUnban(sid, appid) {
  const r = await v.postForm('/ICheatReportingService/RemovePlayerGameBan/v1/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid, steamid: sid, format: 'json',
  });
  if (!r.ok) v.ghWarn('steam unban failed (app ' + appid + ', HTTP ' + r.status + ')');
  return r.ok;
}

// ---- enforcement (idempotent by construction: absent source row = skip;
//      re-running a processed event converges to the same end state) ----
async function restoreRows(boards, sid) {
  let restored = 0;
  for (const name of boards.sources) {
    if (boards.budget) boards.budget.checkHard('restore');   // Q117: stop between boards; an unban event keeps the cursor, the expiry sweep keeps the gate row
    const shId = await boards.find(name + BAN_SHADOW_SUFFIX);   // look up only: no shadow = nothing was ever exiled here
    if (!shId) continue;
    const row = await v.readUserEntry(shId, sid, 'restore ' + name);
    if (!row) continue;
    const srcId = await boards.find(name);
    if (!srcId) { v.ghWarn('restore: source board ' + name + ' not found (' + plog(sid) + ') -- shadow row kept'); continue; }
    const okW = await setRow(srcId, sid, row.score | 0, String(row.detailData || ''));
    if (!okW) { v.ghWarn('restore write failed ' + name + ' (' + plog(sid) + ') -- shadow row kept'); continue; }
    await delRow(shId, sid);
    restored++;
  }
  return restored;
}

async function enactBan(boards, sid, expMin, ev) {
  const actCode = actionCodeOf(ev && ev.action);
  await setRow(boards.ban, sid, 1, v.encodeDetails(banDetails(expMin, actCode, ev && ev.refId)));
  if (actCode === ACT_MM) {
    // Matchmaking-only: gate row is the whole enforcement (client blocks queue
    // contexts, everything else stays open). Also walk the restore/unban path so
    // a full->mm downgrade (update event) hands the scores and platform access
    // back; on a fresh mm sanction both are structural no-ops.
    const restored = await restoreRows(boards, sid);
    let unbans = 0;
    for (const app of BAN_APPIDS) if (await steamUnban(sid, app)) unbans++;
    console.log('sanction MM-RESTRICT ' + plog(sid) + ': gate row set (queue-only)' +
      (restored ? ', restored ' + restored + ' row(s) (downgrade)' : ''));
    return { moved: 0, bans: 0 };
  }
  let moved = 0;
  for (const name of boards.sources) {
    if (boards.budget) boards.budget.checkHard('exile');   // Q117: stop between boards; the caller keeps the cursor
    const srcId = await boards.find(name);   // look up only: a board this app does not carry is skipped, never created
    if (!srcId) continue;
    const row = await v.readUserEntry(srcId, sid, 'exile ' + name);
    if (!row) continue;
    const shId = await boards.findOrCreate(name + BAN_SHADOW_SUFFIX);   // the shadow is created on its first row
    if (!shId) { v.ghWarn('exile: shadow board for ' + name + ' unavailable (' + plog(sid) + ') -- source row kept'); continue; }
    const okW = await setRow(shId, sid, row.score | 0, String(row.detailData || ''));
    if (!okW) { v.ghWarn('exile write failed ' + name + ' (' + plog(sid) + ') -- source row kept'); continue; }
    await delRow(srcId, sid);
    moved++;
  }
  let bans = 0;
  const dur = expMin > 0 ? Math.max(60, expMin * 60 - Math.floor(Date.now() / 1000)) : 315360000;
  // pass the event object through -- steamBan reads refId/action/justification off
  // it for the evidence text (first cut passed a pre-baked string: '[object Object]')
  for (const app of BAN_APPIDS) if (await steamBan(sid, app, dur, ev || {})) bans++;
  console.log('sanction BAN ' + plog(sid) + ': gate row set, exiled ' + moved + ' board row(s), platform bans ' + bans + '/' + BAN_APPIDS.length);
  return { moved, bans };
}

// gateLast (review Q117): the expiry sweep has no cursor -- the lapsed gate row IS its work list. Clearing the gate row
//   first and then stopping between two shadows (time budget, or the job timeout) would strand the rest of the rows
//   on their shadows for good (the next sweep no longer sees the account). The sweep therefore clears the gate row
//   only after the rows are back; an unban EVENT keeps the old order (the gate drops at once, the cursor re-runs a
//   stopped event from the top).
async function enactUnban(boards, sid, gateLast) {
  if (!gateLast) await delRow(boards.ban, sid);
  const restored = await restoreRows(boards, sid);
  let unbans = 0;
  for (const app of BAN_APPIDS) if (await steamUnban(sid, app)) unbans++;
  if (gateLast) await delRow(boards.ban, sid);
  console.log('sanction UNBAN ' + plog(sid) + ': gate row cleared, restored ' + restored + ' board row(s), platform unbans ' + unbans + '/' + BAN_APPIDS.length);
  return { restored, unbans };
}

// ---- expiry sweep (pipeline leg 4) ----
// Pure part: which rows of the gate board have lapsed. details[0] is unix
// minutes; 0 = permanent (never sweeps). Exported for tests.
function expiredSids(ents, nowMs) {
  const out = [];
  for (const e of (ents || [])) {
    if ((e.score | 0) <= 0) continue;
    const det = v.decodeDetails(String(e.detailData || ''));
    const expMin = det && det.length ? (det[0] | 0) : 0;
    if (expMin > 0 && expMin * 60000 <= nowMs) out.push(String(e.steamID));
  }
  return out;
}

async function sweepExpired(boards, mail) {
  const { ents } = await v.readBoardAll(boards.ban, 'ban sweep');
  const lapsed = expiredSids(ents, Date.now());
  let done = 0;
  for (const sid of lapsed) {
    // Q117: no new unban once the soft deadline has passed; the rows still lapsed stay on the gate board and the
    // next run picks them up (the client already fail-opens past the deadline on its own)
    if (boards.budget && boards.budget.softPassed()) {
      console.log('expiry sweep: ' + (lapsed.length - done) + ' lapsed row(s) left for the next run (time budget)');
      break;
    }
    const r = await enactUnban(boards, sid, true);   // gate row last: a stop mid-restore leaves it for the next sweep
    mail.push('EXPIRE ' + sid + ' restored=' + r.restored + ' platform=' + r.unbans);
    done++;
  }
  return done;
}


async function maybeMail(lines) {
  const to = process.env.SN_MAIL_TO || process.env.FB_DIGEST_TO, apiKey = process.env.RESEND_API_KEY;
  if (!to || !apiKey || !lines.length) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.FB_DIGEST_FROM || 'onboarding@resend.dev',
        to: [to],
        subject: (process.env.FB_DIGEST_TAG || '') + 'sanctions: ' + lines.length + ' event(s)',
        text: lines.join('\n'),
      }),
    });
    if (!res.ok) v.ghWarn('sanctions mail failed HTTP ' + res.status);
  } catch (e) { v.ghWarn('sanctions mail threw: ' + (e && e.message)); }
}

// ---- board resolution (per run, only when an event or a lapsed row needs it) ----
// find(name): look up only. Order: the run's board listing (GetLeaderboardsForGame), then the shadows this job
//   created in the last few hours (state `fresh` -- the listing hides a new board for an hour or more), then a
//   by-name lookup with createifnotfound=0 (same bypass as feedback.js). A board that does not exist resolves to
//   null and is skipped: the playtest / demo apps carry no ranked points board, and must not (validate.js ptBoardPlan refuses
//   to run while one exists), so a source board is never created from here.
// findOrCreate(name): shadow boards only, on the first row that moves onto them; the new id goes into `fresh`.
// A failed listing throws (the event loop stops before the cursor advances; the sweep warns and retries next tick).
//   A failed by-name lookup only warns and reads as absent: Steam's answer for an unknown name is not documented,
//   and a lookup that kept throwing would stall every later event on a channel that lacks one display board.
//   Restore does not depend on it for its own shadows: they are in the listing or in `fresh`.
const FRESH_MS = 3 * 3600 * 1000;   // well past the listing lag
async function lookupBoard(name) {
  const res = await v.postForm('/ISteamLeaderboards/FindOrCreateLeaderboard/v2/', {
    key: process.env.STEAM_PUBLISHER_KEY, appid: process.env.APPID, name, createifnotfound: 0, format: 'json',
  });
  const lb = (res.json && res.json.result && res.json.result.leaderboard) || (res.json && res.json.leaderboard) || null;
  const id = (res.ok && lb && (lb.leaderBoardID || lb.leaderboardID || lb.id || lb.ID)) || null;
  if (!id && !(res.ok && res.json)) v.ghWarn('board lookup ' + name + ' HTTP ' + res.status + ' -- treated as absent this run');
  return id;
}
function boardResolver(fresh, nowMs) {
  const ids = new Map(), absent = new Set();
  const fr = fresh || {};
  let listing = null;
  async function listed() {
    if (listing) return listing;
    const lr = await v.getJson(v.BASE + '/ISteamLeaderboards/GetLeaderboardsForGame/v2/?key=' + process.env.STEAM_PUBLISHER_KEY + '&appid=' + process.env.APPID + '&format=json');
    if (!lr.ok) throw new Error('board listing HTTP ' + lr.status);
    listing = new Map();
    for (const b of ((lr.json && lr.json.response && lr.json.response.leaderboards) || [])) {
      const id = b.id || b.ID, name = b.name || b.Name;
      if (id != null && name) listing.set(String(name), id);
    }
    return listing;
  }
  async function find(name) {
    if (ids.has(name)) return ids.get(name);
    if (absent.has(name)) return null;
    const id = (await listed()).get(name) || (fr[name] && fr[name][0]) || await lookupBoard(name);
    if (id) ids.set(name, id); else absent.add(name);
    return id || null;
  }
  async function findOrCreate(name) {
    if (ids.has(name)) return ids.get(name);
    const id = (await listed()).get(name) || (fr[name] && fr[name][0]) || await v.findOrCreateBoard(name, true);
    if (id) {
      ids.set(name, id); absent.delete(name);
      if (!listing.has(name) && !fr[name]) fr[name] = [id, Math.floor((nowMs || Date.now()) / 60000)];
    }
    return id || null;
  }
  return { find, findOrCreate, absent };
}

// State keeps the gate board id (read every run by the sweep) and `fresh` (shadows created in the last FRESH_MS,
// pruned here). Exile sources are resolved by name per run, so a board created later -- a season twin, a board a
// channel gains -- is picked up without touching state. The ids the first cut cached for its four boards are dropped.
async function openBoards(st, nowMs, budget) {
  const now = nowMs || Date.now();
  const cached = st.boards || {};
  const ban = cached[BAN_LB] || await v.findOrCreateBoard(BAN_LB, true);
  st.boards = ban ? { [BAN_LB]: ban } : {};
  const fresh = {};
  for (const [n, e] of Object.entries(st.fresh || {})) if (Array.isArray(e) && e[0] && now - (e[1] | 0) * 60000 < FRESH_MS) fresh[n] = e;
  st.fresh = fresh;   // the resolver adds to this object; boardStateSig / main drop it when empty
  const r = boardResolver(fresh, now);
  const unnamed = unnamedKeys();
  if (unnamed.length) v.ghWarn('sanctions: no board name on this job for ' + unnamed.join(', ') + ' (secret not passed) -- a ban does not exile those boards');
  return { ban, sources: exileSources(v.seasonAt(v.seasonNowMs()), EXILE_BOARDS), find: r.find, findOrCreate: r.findOrCreate, absent: r.absent, budget: budget || null };
}

// What main() persists from openBoards: the gate id and the live `fresh` entries (an empty `fresh` is not written).
function boardStateSig(st) {
  const f = st.fresh && Object.keys(st.fresh).length ? st.fresh : null;
  return JSON.stringify({ b: st.boards || {}, f });
}

async function main(opts) {
  const missing = [];
  for (const k of ['APPID', 'STEAM_PUBLISHER_KEY', 'STATE_SALT', 'EOS_TRUSTED_CLIENT_ID', 'EOS_TRUSTED_CLIENT_SECRET', 'EOS_DEPLOYMENT_ID']) {
    if (!process.env[k]) missing.push(k);
  }
  if (missing.length) { console.error('missing env: ' + missing.join(', ')); process.exit(1); }
  const budget = (opts && opts.budget) || runBudget();   // Q117: see SN_SOFT_MS / SN_HARD_MS
  const st = loadState();
  const token = await eosToken();
  const mail = [];
  let processed = 0, skipped = 0, unmapped = 0;
  let cursor = String(st.lastLogId || '');
  const cursor0 = cursor;
  const boards0 = boardStateSig(st);   // persist when the board cache changes (sweep-only runs)
  const events0 = JSON.stringify(st.events || null);   // O198 v1: persist when the trust event queue moves
  let boards = null;
  let stop = '';   // '' = caught up (or a cap reached); 'soft' = budget reached between events; 'hard' = an event stopped midway
  // Documented resume protocol: ask with the cursor, consume the batch IN THE ORDER
  // RETURNED, then set the cursor to the LAST element's logId. logId is opaque -- it
  // is never sorted or compared, only carried forward. An empty batch = caught up.
  // Q117: the cursor moves past an event only once that event is done (skipped, or fully enforced), so a run that
  // stops on the time budget resumes at the first event it did not finish -- any logId the stream handed out is a
  // resume point of the same kind as a batch's last one.
  rounds:
  for (let round = 0; round < 20 && processed + skipped < SN_EVENT_CAP; round++) {
    if (budget.softPassed()) { stop = 'soft'; break; }
    const evs = normalizeEvents(await fetchSyncBatch(token, cursor));
    if (!evs.length) break;
    // One identity lookup per batch (docs cap 16/call; resolveSteamIds pages).
    const need = [...new Set(evs.filter(e => !sidOfEvent(e)).map(e => e.puid))];
    const map = need.length ? await resolveSteamIds(token, need) : {};
    for (const ev of evs) {
      if (budget.softPassed()) { stop = 'soft'; break rounds; }
      const verb = verbOf(ev);
      if (verb === 'skip') {
        console.log('sanction event ' + plog(ev.puid) + ' type=' + ev.eventType + ' -> skip' + (ev.pending ? ' (pending)' : ''));
        skipped++;
        cursor = ev.logId;                     // advance even when skipped: it is a resume token
        continue;
      }
      const sid = sidOfEvent(ev) || map[ev.puid] || null;
      if (!sid) {
        // No steam account linked to this PUID: nothing to enforce on the board side.
        // The client-side gate still applies (the guard queries its own sanctions).
        v.ghWarn('sanction ' + verb + ' for ' + plog(ev.puid) + ' has no linked steam account -- board enforcement skipped');
        unmapped++; skipped++;
        cursor = ev.logId;
        continue;
      }
      if (!boards) boards = await openBoards(st, undefined, budget);
      if (!boards.ban) throw new Error('ban gate board unavailable -- refusing to advance the cursor');
      const nowM = Math.floor(Date.now() / 60000);
      try {
        if (verb === 'ban') {
          const r = await enactBan(boards, sid, expiryMinOf(ev.expiresAt), ev);
          mail.push((actionCodeOf(ev.action) === ACT_MM ? 'MM-RESTRICT ' : 'BAN ') + sid + ' action=' + ev.action + (ev.automated ? ' (automated)' : '') +
            ' exp=' + (expiryMinOf(ev.expiresAt) || 'permanent') + ' exiled=' + r.moved + ' platform=' + r.bans + ' ref=' + ev.refId);
          // O198 v1, queued only once the event is fully enforced (Q117): a stopped event re-runs from the top next time, so
          //   queued up front the stopped attempt and the re-run would each leave one (no match key: the reconcile counts both)
          trustLedger.queuePush(st, { t: nowM, src: 'sa', p: pid(sid), sev: actionCodeOf(ev.action) === ACT_MM ? 2 : 3, ctx: { a: actionCodeOf(ev.action) | 0, x: expiryMinOf(ev.expiresAt) > 0 ? 1 : 0 } });   // O198 v1
        } else {
          const r = await enactUnban(boards, sid);
          mail.push('UNBAN ' + sid + ' restored=' + r.restored + ' platform=' + r.unbans + ' ref=' + ev.refId);
          trustLedger.queuePush(st, { t: nowM, src: 'sa', p: pid(sid), sev: 0, ctx: { u: 1 } });   // O198 v1: history only (no count); after the unban (Q117)
        }
      } catch (e) {
        if (!(e instanceof BudgetStop)) throw e;
        console.log('sanction ' + verb + ' ' + plog(sid) + ': ' + e.message + ' -- re-runs from the top next time');
        stop = 'hard';
        break rounds;
      }
      processed++;
      cursor = ev.logId;                       // only now: the event is fully enforced
    }
  }
  // Expiry sweep every run (leg 4): natural lapses never appear in the event
  // stream. Board resolution is cached in state, the gate board is tiny, and the
  // sweep is idempotent -- a failed run just retries next tick.
  // Q117: not started once the soft deadline has passed (a backlog of events goes first); it also stops between rows.
  let lapsed = 0;
  if (stop || budget.softPassed()) {
    console.log('expiry sweep deferred to the next run (time budget)');
  } else {
    try {
      if (!boards) boards = await openBoards(st, undefined, budget);
      if (boards.ban) lapsed = await sweepExpired(boards, mail);
    } catch (e) {
      if (e instanceof BudgetStop) console.log('expiry sweep: ' + e.message + ' -- the rest waits for the next run');
      else v.ghWarn('expiry sweep failed (retries next tick): ' + (e && e.message));
    }
  }
  // O198 v1: the queued events the reconcile already took go (its cursor in trust.json; unreadable = keep them all)
  let tl = null; try { tl = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8')); } catch (e) {}
  const qp = trustLedger.queuePrune(st, tl && tl.taken && tl.taken.sanctions);
  if (qp.fused) v.ghWarn('sanctions: ' + qp.fused + ' trust event(s) dropped by the queue fuse (the reconcile has not taken them)');
  if (stop) {
    v.ghWarn('sanctions: time budget reached at ' + Math.round(budget.elapsed() / 1000) + 's after ' + processed + ' enforced event(s) this run' +
      (stop === 'hard' ? ' (one event stopped midway, it re-runs from the top)' : '') + ' -- cursor saved at the last finished event, the next run continues');
  }
  if (st.fresh && !Object.keys(st.fresh).length) delete st.fresh;
  if (cursor !== cursor0 || boardStateSig(st) !== boards0 || !fs.existsSync(SN_STATE_FILE) || qp.taken || qp.fused || JSON.stringify(st.events || null) !== events0) {
    st.lastLogId = cursor;
    saveState(st);
  }
  await maybeMail(mail);
  console.log('sanctions: processed ' + processed + ', skipped ' + skipped + (unmapped ? ' (unmapped ' + unmapped + ')' : '') +
    (lapsed ? ', expired ' + lapsed : '') + ', cursor ' + (cursor ? cursor.slice(0, 8) + '...' : '(none)') +
    (boards && boards.absent.size ? ', boards not on this app: ' + [...boards.absent].filter(n => n.slice(-BAN_SHADOW_SUFFIX.length) !== BAN_SHADOW_SUFFIX).length : '') +
    (stop ? ', stopped on the time budget' : ''));
  return { processed, skipped, unmapped, lapsed, cursor, stop };
}

if (require.main === module) {
  main().catch(e => { console.error('sanctions run failed: ' + (e && e.stack || e)); process.exit(1); });
}
module.exports = {
  SN_STATE_FILE, BAN_LB, BAN_SHADOW_SUFFIX, EXILE_BOARDS, SN_MAP_BATCH,
  normalizeEvents, sidOfEvent, expiryMinOf, verbOf, loadState, saveState,
  ACT_FULL, ACT_MM, actionCodeOf, refIdInts, refIdFromInts, banDetails, expiredSids,
  EXILE_DISPLAY, EXILE_KEEP, boardNameOf, unnamedKeys, keepBoardNames, exileSources,   // cloud audit R1-X13 (test/sanctions-boards.js)
  boardResolver, openBoards, boardStateSig, enactBan, enactUnban, restoreRows, sweepExpired,
  SN_SOFT_MS, SN_HARD_MS, BudgetStop, runBudget, main,   // cloud audit Q117 (test/sanctions-budget.js)
};
