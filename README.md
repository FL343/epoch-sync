# epoch-sync

Scheduled cross-source reconciliation for sharded Steam leaderboards.

Clients each write a per-match record into a sharded leaderboard pool. This job
(GitHub Actions, holding a publisher Web API key) periodically reads the pool, groups
records by match, and compares each side's reported score vector. Mismatched vectors
are flagged as suspected forgery. Trust comes from **cross-source consensus**, not from
any single client being honest.

For consistent matches it derives placement from the agreed score vector, updates a
TrueSkill (mu/sigma) rating, and writes the authoritative display rating + visible
points to trusted (publisher-write-only) leaderboards that clients read back.

Visible points (the LP ladder) move for **ranked matches only** (base matchType 2 or 4);
quick matches update the hidden rating only. A consensus-detected leaver (in roster, no
settle record) loses a fixed points penalty in the ranked ladder — this is the
authoritative half of the client's optimistic deduction, so it survives read-back
rather than being reverted. Single-side records can't frame a leaver (majority roster
vote), and each match is penalized at most once (idempotent via `processed.json`).
A missing record only counts as leaving once it is really gone: a consistent group that
lacks a roster seat's record (any lane, endless included — the private, bot and endless
lanes convict nobody, but settling early would cost the late finisher their XP and, on an
endless segment, its best on the seat-count ladder) waits until (a) a run has read every
record shard in full — the listing must hold exactly `LB_PREFIX`+0..N-1 (N = the client's
shard count, `LEDGER_SHARDS`), and no shard read may fail (408 / 429 / 5xx retry first),
hit the page cap or answer a 200 without its entries block — and (b) the gap has stood for
`ABSENT_GRACE_MS` on this job's own clock (default 5 min, floor 3 min: a finisher's record
can land up to ~2 min after the others' while the client retries a failed upload). The
record landing in the meantime settles the group in full. Start-attestation verdicts
likewise wait for a complete read. The grace stays short on purpose: a group only settles
while its records are still on their shards, and a finisher's next match overwrites
their row.

**Team match types** (base 3/4 = quick/ranked team-brawl): placement follows the fixed
seat convention — seats (0,1) vs (2,3), winning pair takes ranks {1,2} — instead of raw
score order, the rating update treats each side as one team (strength = summed mu,
binary outcome, per-member updates), and ranked team points are the halved team result
(win/loss component from the team-average tier, personal drip added at full value).
A player whose teammate was convicted absent gets his loss compressed (protected). When a
whole team left without a record, the present team is rated against the absent team's
pre-match ratings (the absent ratings never move), never against each other.
**Premade pairs inside an FFA match** are declared as a seat-pair bitmask in the
matchType's high bits (the match group key contains the full code, so a lone forged
mask only orphans that record): the pair settles at its average placement and average
tier with one shared delta, and mismatch compensation treats the pair as a single unit.

**Team-gamble lone dissent**: a team-gamble match (base 5/6/8/9) in which exactly one writer
disagrees with an otherwise consistent, sane, non-void outcome (the client's rank-0 refusal
of a seat that judged itself cut from the gamble, or a differing score vector) is a lone
dissent: only the dissenter is struck and flagged. His first strike inside `T2LD_WINDOW_MS`
(30 days) leaves the match unsettled as before; from the `T2LD_K`-th (2) on, the match
settles from the agreeing records and his seat is a consensus leaver. Strikes in matches
hosted by the same opposing player count once (a modded host cannot convict a victim alone)
until `T2LD_K_HARD` (4) strikes in total convict whatever the host. The verdict of a match
is decided at first sight and kept in `signals.json` (`t2ld` / `t2lv`).
A dissenter's seat is where the agreeing writers' roster places him, never the seat his own
records claim, and a refusal counts however many other records the same account wrote: a
modded dissenter cannot step out of either shape (lone or team, below) by claiming another
seat or adding a second record.
Two or three TEAMMATES writing the rank-0 refusal together (a premade blocking the game
connection as one) against an agreeing side that includes the host are a team dissent: each
of them is struck the same way, and the match settles as soon as ANY of them is due; the ones
not yet due are excused for that match (flagged, never a leaver, no rating or points change).
Opposing hosts that sat on each other's team (each strike keeps its host team: the agreeing
writers seated there first, then the roster) count as one host, so a modded pair taking turns
hosting cannot convict a victim either. A refusal first seen after a match's verdict that no
longer fits the shape does not overturn it: that account is excused (flagged once, never struck). When a whole team
is absent from such a settle, the present team is rated against the absent team's pre-match
ratings. A match the accusation pass charges (two or more refusers name the same account and
it cost them something: he left, nobody claimed a rank, or a namer sits on the side the claims
say won) is left to that pass; names that cost the refusers nothing do not stop a team dissent.

**Sanity bounds** catch what consensus can't: colluding clients writing *identical*
impossible records. Only calibration-free structural/physical bounds are enforced —
score caps far above anything the game can produce, duration bounds, seat/player-count
ranges, a match-type whitelist, and roster plausibility (the writing account is
unforgeable, so a roster that puts someone else at the writer's own seat is a forgery).
A flagged match is not settled and not marked processed, so a loosened bound self-heals
still-visible records. A **pacing gate** enforces minimum real match time without
trusting any client-reported duration (speed hacks can't move it): a settle group is
only eligible once its start attestation was first *sighted* a configurable minimum ago
— the clock is this job's own observation time. A group with no attestation ever sighted
starts the clock at its own first sighting and is recorded once as an `ns` signal. On top
of that, **one match at a time per account**: each writer carries a "busy until" mark, a
group becomes eligible only once every writer's previous match had its own minimum time,
and settling it moves the marks. Honest play never overlaps, so it never waits on this;
a batch of fabricated groups written at once settles no faster than really playing them.
Per-day settle counts are recorded as pure signals — thresholds for "suspiciously many
matches per day", like all statistical bounds (win rates, distribution tightening),
wait for real-traffic calibration.

**Signal collection** records — without judging — the rolling aggregates a future trust
layer needs as history from day one: per-player settle/win/void/flag counts, end-of-match
disposition distribution, score moments, and pairwise co-occurrence (matches together,
premade/team together, who places above whom). Windows are pruned on save (pairs 45 d,
players 90 d inactive) and an entry-count fuse warns when the state should move to
external storage. A forgery flag counts toward the trust tier for 90 days from the run
that raised it, even for a player who keeps playing (the lifetime count stays as
history), and one match flags a player once however long its records stay on the shards.
De-identified like all other state.

**Team-gamble host charges** feed the trust tier from the host's side of the dissent strikes
above: each dissenter struck on the opposing team charges the host (roster seat 0) when the
host wrote one of the agreeing records and the records back him as the host -- his own record
sits at seat 0, or every other record of the match that names seat 0 (the struck dissenters'
included) names him -- one entry per match (`signals.json` `t2lh`). A colluding majority of
the agreeing writers can name an honest teammate at seat 0; his own record and the cut
victim's still tell the truth, so he is not charged. Inside
`T2LH_WINDOW_MS` (30 days) the distinct matches and the distinct victims are counted and the
smaller number is the host's count, so one player blocking again and again in the same
host's matches, or a whole team dropping out of one match together, counts once. From
`TRUST_HD1` (3) the host is one trust tier up, from `TRUST_HD2` (8) two: a sort-only soft
avoid in matchmaking that decays with the window, never a verdict (the record carries no
reason for the dissent).

**Start attestations** close the blind spot of a match nobody settles: each client also
writes a start-type record (a second magic, zeroed result fields, same roster layout)
when play actually begins. A start group with two-plus distinct writers and a
per-seat majority roster is held as pending state; if no consistent settlement appears
before a maturity window (default 2 h) elapses, every consensus-roster member who wrote
his own start record but no settle record takes an exit-rate hit. Deliberately **no points penalty** on this
path — with zero finisher testimony, a coordinated dodge is indistinguishable from a
crash/migration-failure cascade, so the harsh deduction stays on the finisher-consensus
path above. Anyone who wrote any settle record is exempt (remembered across runs, since
shard entries get overwritten), and lone attestations convict nobody.

**A leave needs the player's own record** (cloud audit Q69, both paths above). A roster is
what *other* accounts wrote: two accounts that own the game can write a consistent pair of
records for a match that never happened and name anyone at the other seats. So an absent
seat is convicted (exit rate; ranked: the points penalty) only when its player wrote his own
record for that match key — his start attestation (written when level 1 begins; remembered
in `starts.json` as `started`, since a later record can rotate it off its shard), his abandon
confession for that key, or, on the settle path, any settle record of his. A seat that only the others' rosters name is logged
(`never wrote his own record for this match -- not a leaver (Q69)`), counted in the run
summary, and marked on the writers as the `un` signal; it still shields its teammates in
team ladders like any absent seat. Cost: a real leaver whose start upload failed, who quit
before level 1, or whose client suppresses the write goes unpunished (an honest quitter still
confesses; a loading-screen drop was never meant to count; a suppressed write is a modified
client). The team-gamble accusation pass asks the same: an accused who wrote no settle record
is struck as having left only with his own start attestation for the key (pending entry, or
one read this run); otherwise the names are record-only (`nostart`, the namers' `un`), and a
host whose own record was read on the key before is not struck when it rotates off.

It also maintains a separate **cumulative progression ladder** (`XP_LB`, optional): a
per-game points total that only accrues. Each present record earns points derived from
its agreed placement, own score, match type, and a once-per-UTC-day first-win bonus;
records flagged as voluntary-leave earn nothing, and a repeat-leaver discount (gradient
with a minimum-sample gate, so a single leave is never punished) scales the award down.
This is the source of truth the client reads back, so an offline/edited local total is
display-only. The ladder is skipped entirely when `XP_LB` is unset or its board is
absent, so a run is unaffected before it is provisioned.

## Files

- `validate.js` — read shards, decode records, group by match, compare vectors,
  consensus VOID, rating/points update, mismatch compensation (compress the strong side's swing,
  protect/reward the weak side) revealed back to the client via points-board detail bytes.
- `trueskill.js` — TrueSkill (mu/sigma) update + display rating.
- `points-plan.js` — the visible points (LP) rules of a ranked settle: tier table, placement seed, soft
  reset, the promotion/relegation series clamp, the mismatch / premade / team plans, the leaver fine and
  the per-player points line (`settleLine`). Self-contained (no require, no environment: the knobs go in
  through `configure()`), so the companion client vendors a comment-stripped copy of this exact file and
  shows the points this job will settle. `RULES_VER` moves with any rule change.
  `fixtures/points-plan/cases.json` holds golden cases (FFA 2-6 players, premade pair / trio, team
  codes, mismatch UPSET / PROTECTED, the series clamp, seeds, the leaver fine, the board bounds) that
  both repos replay (`test/points-plan-fixtures.js` here); `tools/gen-points-fixtures.js` regenerates
  them with a rules change and prints the `FIXTURES_HASH` the module must carry.
- Couch pairs (O989, 2026-11-24): a matchmade table may seat one machine's two players -- one account (the
  main) and, at the next seat, a guest with no account. Bits 17-22 of the match type name the guest seats
  (`points-plan.js` `GUEST_SEAT_SHIFT`; part of the match key), the roster leaves them empty, a team code
  seats both on one team. `validate.js` counts the guest as a player while his main is at the settle
  (ranking, player count, the rating update at the main's rating with a newcomer's uncertainty, the points
  plan) and writes nothing for him; a start written from a guest seat or naming an account on one counts
  nowhere; the sanity reasons `guest-mask` / `guest-range` / `guest-pair` hold a table whose header is off
  and `guest-seat` / `guest-roster` drop one record, nobody flagged. In a brawl the pair is one unit of the
  points plan (the average place of its two seats); a solo's loss there is compressed and the pair's win
  taxed. A record without the mask is read exactly as before (`test/guest-seat-rules.js` replays a frozen
  copy of the rules file against it), so `RULES_VER` did not move. Tests: `test/guest-seat-settle.js`.
- `rules-cfg.json` (O989; absent = the defaults) -- the four couch numbers of `points-plan.js` that move
  without a build (`CFG_KEYS`). `validate.js` reads it at the start of a run, publishes it on the pulse row
  (`[0xCC, RULES_VER, 0xC9, rev, four values in permille]`: the tail is also the job's word that it reads
  guest seats) and stamps `rev` on the receipts of the couch matches it settles (bits 24-30 of the flags);
  a settled match is never read again under a later revision. A file the job cannot use holds every couch
  match until it is fixed. Write it with `tools/rules-cfg.js set ...` only (`test/rules-cfg-tool.js`); a
  change is a commit on the job's branch.
- `streak-plan.js` — the matchmade win streak rules (O181): events ordered by the match's start minute
  (this job settles out of order), a 12 h window folded into a prefix, freezes (interrupted matches, a
  loss after a teammate left, the first convicted absence in a week), breaks (a confessed quit, a
  repeat absence), the same match twice = the later outcome, the XP tier of the win that brings the
  streak to 2 / 3 / 5 / 7 (+5 / 10 / 15 / 20 %, added into the level / supporter boost) and the tail
  block published after the career matrix on the xp row (`[0xC9 | ver << 8 | len << 16, cur, best,
  matchHash]`). Self-contained like `points-plan.js`; the client vendors a comment-stripped copy.
  Golden cases: `fixtures/streak-plan/cases.json` (`test/streak-plan-fixtures.js`,
  `tools/gen-streak-fixtures.js`); the settle's wiring: `test/streak.js`. Gate `V54B3_STREAK`: the
  full game's job only.
- Points receipts and the pulse (O480): every rating row carries `[0xCB, plan rating, RULES_VER, 0]`
  (the rating the points plan reads for that player); every points row carries the RS reveal slot (6
  ints, zeros when none) then a receipt ring `[0xC6, n, (matchHash, delta, flags) x n <= 8]`, newest first:
  what each recent match did to the player's points (net delta; flags = reveal / leaver fine / series
  clamp / seeded / void / first under new rules; bits 8..23 = RULES_VER). Every points-board write goes
  through one writer, so neither part is ever dropped. A void writes nobody's row: its VOID receipt
  waits in `pending-writes.json` (pid keys, at most 8 per account, 6 h) for the player's next points
  write. One `cron_pulse` row per channel (score = the unix minute a run reached its end, details
  `[0xCC, RULES_VER]`; carrier = the tier-cut carrier rule) tells a client the job is alive and which
  rules it runs. Tests: `test/rating-details.js`, `test/receipt-ring.js`, `test/cron-pulse.js`.
- `test/void-consensus.js`, `test/leaver-absence.js`, `test/lp-penalty.js`,
  `test/xp-ladder.js`, `test/reduced-stakes.js`, `test/team-rank.js`, `test/team-lp.js`,
  `test/start-orphan.js`, `test/sanity-bounds.js`, `test/signals-collect.js`,
  `test/absence-grace.js`, `test/absence-grace-endless.js` — unit tests
  for the pure helpers (run one with
  `node test/<name>.js`; CI runs all of `test/*.js` before each reconcile).
- `.github/workflows/validate.yml` — scheduled run + state persistence.
- `.github/workflows/playtest.yml` / `demo.yml` — the pre-release channel jobs: the same
  reconcile pointed at a second/third app id in restricted-channel mode (`PT_MODE=1`: no
  rating/points/redeem surface, channel boards provisioned idempotently, forbidden boards
  fail the run) with disjoint `pt-*.json` / `demo-*.json` state. `feedback.yml` and
  `sanctions.yml` carry per-channel twin jobs for the same app ids (`seedcap.yml` carried them
  too until 2026-11-20: both apps are closed, so its twins were retired and `pt-seedcap.json` /
  `demo-seedcap.json` stay as the frozen final record the two channel jobs read);
  `test/channel-workflows.js` pins the twins to their template so they cannot drift apart;
  `test/channel-state-files.js` runs the real reconcile under each twin's own state-file names
  and fails when a twin writes a file it does not persist with data in it (the rating-side
  `skill` / `groups` files are left unpersisted only because `PT_MODE` keeps them empty).
- `seedcap.js` / `seedcap.yml` — per-seed score-cap audit (replays every settled/pending
  match's seed through a compiled world model, derives the mathematical score ceiling per
  seat). Writes only its own `seedcap.json` (`audited` / `veto` / `suspects[pid]{n,t0,t1}` /
  `corrections` / `chain`); the reconcile reads it under two switches: `SEEDCAP_ENFORCE`
  (over-cap match = flag-don't-settle + endless board correction) and `SEEDCAP_REJECT`
  (a flagged account's OWN settlement is discarded inside a bounded reject window that
  starts at its latest conviction — 24h / 3 d / 7 d / 14 d cap by conviction count, never
  permanent; the other seats settle normally and the window clears on its own).
  Read-side rules (2026-09-30): a guard-signed solo record is decoded through its own int layout
  (`attest.soloTail`); the build that caps a segment is the segment-START build replayed from the
  pick log (`perks.buildAt`, the same replay as the perk_forge check), a session-level co-op record
  hands the per-draw list to the CLI (`builds=` token, capability-probed); the endless chain memory
  is per run (`pid:pc:runSeed`) and only a self-written seat extends it; a solo record's signing
  package (keyId = buildNum) selects that package's registered core exactly.
- `tools/seedcap-reaudit.js` — READ-ONLY re-audit of the live shards through the same functions the
  seedcap job runs, on a scratch state (never saves, never writes a board, never mails). Run it with
  the job's environment before pushing any seedcap rule change or a new compiled core
  (`--cli=<new exe> --old-cli=<current core>` compares the caps); it exits 1 when any honest-looking
  group ends up over cap.
- `campaign-endless.js` — the single-player campaign endless (Gold Rush) lane: the guard
  sidecar signs one run record per attempt into a client-writable box board per difficulty;
  the reconcile verifies the signature against the sealed key table, binds the record to the
  writer's own account, runs the boundary checks (sequence / pace / wall-clock / per-level
  cap table `gr-caps.json` / int32 + count limits) and promotes the best run per account to
  a trusted per-difficulty ladder. Rejections are counted into a permanent offense board and
  a trailing-24h histogram; a burst of rejections mails the ops inbox (`campaign-endless.json`
  keeps the settled signatures + reject histogram + last mail hour).
- `rfduo.js` — the couch classic duo experimental lane (companion knife D3, 2026-11-01;
  `test/rfduo-settle.js`): the guard judges every event of a two-player classic run, rolls the
  slot reels itself, and signs one run record (magic 0xC1, 64 ints) into the client-writable box
  `rfduo_box`; the reconcile verifies it (same flow as the Gold Rush lane, dev keys only on the
  `_test` boards), binds it to the writer's account, runs the boundary checks (hard flags / pace
  against the frame-model floor / wall clock / per-level caps with the classic wrap / coins / slot
  bounds, cap table `rfduo-caps.json`) and promotes the best run per account to the trusted
  lifetime ladder `rfduo` (details = passes, s1, s2, runT0). Observation only in v1: rejections are
  counted per reason and per hour in `rfduo.json` (shared mass-anomaly mail), never written to an
  offense board; 0 passes / final money <= 0 / a late reel receipt are skipped, not rejected. The
  save rows `rfduo_save` are only find-or-created. Main app only.
- Endless competitive points (O728, 2026-11-08, replacing the O103 rating; rules in `points-plan.js` ELP,
  `test/endless-lp.js` + golden cases kind `endless`; settle `test/endless-rating.js`): every settled
  competitive endless segment (solo lane, team lane, couch lane on duo while merged) enters or raises its
  run in a per-(player, family, season) history kept in `endless-solo.json` (`hist`, pid-keyed). Each run
  settles once, in start order (its final segment, a newer run of the player once 2 h passed with neither the
  newer run nor a segment of the run new [Q433], or 24 h without a segment and without a save point), onto the
  family's points on the versus scale, shaped like a versus match (rules v2):
  the target follows the player's own hidden skill (trimmed mean depth of the last 10 runs) plus an offset by
  the run seed, so about half the runs pass; passing gains, missing loses, the versus table times a per-tier
  multiplier (capped under the series margin). Below master grinding climbs (no pull down, a tier floor);
  master and grandmaster open only once the hidden skill reaches their line (the gate); at master and up a
  skill below the points is stricter and the series clamp applies. `test/endless-lp-sim.js` simulates it.
  The first 5 runs of a season are placement (no points; the fifth seeds the points from the hidden skill). Rows on `endless_rating_{solo,duo,trio,quad}` (+ season twins; EA app id
  only) are the projection: score = the points, details = magic 0xEE, runs, hidden skill, tier, placed and a
  receipt ring keyed by the run seed; a seedcap conviction refunds the run as recorded (VOID receipt). The
  pass lines (prior blending into the live percentile middles as players place) are recorded once per UTC
  day (and at once on a rules change) and published on the `endless_tiercut` carrier (v2: magic 0xEC | 2 << 8,
  season, the rules constants, N + seven lines per family; v1 rows read as no table). The carrier account is
  `TIERCUT_CARRIER_SID` or, unset, the account already carrying the app's `version_gate` row. Board names:
  `ENDLESS_RATING_LB_*`, `ENDLESS_TIERCUT_LB`.
  ELP version 7 (O942, 2026-11-21; `points-plan.js` ELP7, `test/endless-level.js`): a competitive run ENDS at
  its target, so a passed run's depth is its target and the depth mean only drifts down -- a version 7 run's
  target follows a per-player, per-family level (a staircase: a pass multiplies it, a miss divides it, the
  step shrinking on a reversal; the tiers read its smoothed value; a three-step placement with a missed run
  floored at its depth; a quit or a run that passed no level leaves the level; points x the run's line / 10
  levels; a team run's line = the roster's highest level, each seat stepping his own). A run's version is
  fixed by its first segment: solo / couch by the signing key (`attest-keys.json` pubInfo `elp`, stamped by
  the client's build tool; the dev key reads `ELP_DEV_VER`, default 6), team by the segment flag `SEG_LINE`
  (128); version 6 runs settle exactly as before. The level states ride the points entry (`lv`) and the row
  (v3, after the four hidden skills). Where the job cannot tell which reading of a level the client started
  from (a family's first version 7 run: every reading of the version 6 skill his client may have held; the
  row's state), it keeps them all: a reading whose target lies below the run's depth cannot have been the
  client's (the line would have ended the run there) and is left out (a run that stood parked keeps them
  all: its target may have been read again on resume), the verdict and points take the best of the rest,
  and the level CARRIED to the next run is the lowest of their steps (`elpLvChoose`; `r[10]` keeps the
  target that step read, `r[11]` the state). Since Q432 (2026-11-22; the 0.6.1 client never read the row's
  levels back, so it walked its own chain) every kept reading's step is carried on as well (`c.lvs[fam]`,
  `r[12]`, at most `ELP_LV_SET_MAX`) and the next run reads the whole set: no run the client ended at its own
  line is judged a miss (simulation: 2-8 % of line-ends before, 0 after; about 1 % of deaths judged passes,
  in the player's favour). The row's level stays the lowest. Once a season (`elp3.q432`), `elpQ432Lift`
  re-reads the season's settled solo / couch points runs with that set from the family's first version 7
  run: a miss a kept reading passes at its depth becomes a pass, the difference added (only up; a quit, a
  placement run, an online team run are not re-read). A team run freezes every line the host may have read
  (`elpTeam[run].lvLns`: any member's reading that is at least every member's lowest; since O992, 2026-11-23, also the
  other members' readings down to the highest of THEIR lowest -- the host may have started before the hello of the member who
  sets that floor reached him). One pass walks every
  player's runs in one order by first seen, so a team run's line freezes the same in one pass and in two.
  Two levers, both off by default and set by the upload runbook the moment the version 7 package's gate
  goes up: `ELP_PUB_VER=7` (the published table carries 7, the version 7 priors, the live lines from the
  smoothed levels; a version 6 client reads that table as "being rated", so never before the gate) and
  `ELP_CUTOVER_MS=<that instant>` (every version 6 run parked at a save point then settles at its save
  depth; a run still being played waits for its own end).
  ELP version 8 (O991, 2026-11-23; `points-plan.js` ELP8, `test/endless-level8.js`, `test/endless-level8-main.js`,
  `test/endless-lp8-sim.js`): the competitive money curve gets a grow phase (levels 1-15 ask for little money, the
  levels after it are steep), so every level rule reads the depth past `GROW_END` (15): the target is at least
  `T_MIN` (20), a step / a placement step / the missed-placement floor scale the part of the level past level 15,
  a death in the grow phase (15 levels passed or fewer) takes points but leaves the level (R2), lambda = the line
  / 20 levels (`PROP.REF` 2000), the master / grandmaster gate asks 103 % of the line solo and 104 % in a team, the priors
  and the CP milestones are per family (solo 22..40 and 26 / 29 / 33; duo / trio 25..48 and 32 / 36 / 41; quad
  27..51 and 35 / 40 / 44). A run's version comes from its first segment as in version 7: solo / couch by the
  signing key (`elp: 8`; the dev key reads `ELP_DEV_VER`: a job replaying a version 8 dev build sets 8), team by
  the segment flag `SEG_V8` (256, always with `SEG_LINE`; a job without it rejects the segment, so this half goes
  live before the package); the run row carries `ELP_R_V8` (16) ALONE, so the version 7 readings never see a
  version 8 run, and keeps it when the team's final segment ends the copy of a member who stopped writing
  (`ratingHistFinal`; a version 7 copy still loses `ELP_R_V7` there, as before -- it then settles under version 6).
  Version 7 and older runs settle exactly as before (`fixtures/elp8/v7-world.json` pins a world of
  them to the values of the job before this change); a version 7 reading never takes a version 8 table, a version
  8 reading takes version 8 tables only (else the version 8 prior). The version 8 level rides the points entry
  (`lv8`, the set its readings carried `lvs8`) and the row: v4 = v3 + the four families' version 8 states (58 ints
  at most; v2 / v3 / v4 are read, `RATING.ROW_VERS`). A family's first version 8 run starts from the player's
  version 7 level of the family read through the two line tables (`elpConvert`: the same tier position on both
  curves), capped at the deepest of his newest three runs of the family x 1.15 read the same way (a level his
  recent play does not back -- the 0.6.1 duo tail -- is not carried on); no version 7 level = the silver line.
  Where the client may have read other lines (the version 7 tables of the three instants or the version 7 prior; the
  version 8 tables of the three instants or the version 8 prior), every such start is a reading and `elpLvChoose8`
  takes the version 7 rule (and the Q432 set) over them.
  The two levers move again at the version 8 package's gate, together: `ELP_PUB_VER=8` (the table carries 8 and the
  version 8 priors; the live lines read the version 8 smoothed levels, players without one left out -- a version 7
  client reads that table as "being rated", so never before the gate) and `ELP_CUTOVER_MS=<that instant>` (every
  run parked at a save point whose version is below the published one -- version 6 and 7 then: `elpCutVer` =
  max(7, the published version) -- settles at its save depth under its own rules; a version 8 run, or a run still
  being played, is never cut). Until then the live workflow keeps `ELP_PUB_VER=7` and the version 7 instant.
- Gold Rush Cup (client knife 5.1c-1, 2026-10-18; `test/endless-cup.js`): every competitive endless settle
  on the EA app id also keeps the player's best of the week on `<competitive ladder>_w<YYYYWW>` (ISO week,
  Monday 00:00 UTC; the week the settle runs in; team rows carry the team block; created at the week's
  first write, never deleted). Week 2026-W47 is edition 1. The first run after a week ends settles it: a
  family is held with 40 solo players / 15 teams (a team = a roster set), and its top three places
  (a tie shares the place) win a name mark on `endless_cup_honor` (one row per winner: score = the week,
  details = magic, week, size << 8 | place per family) worn until the next settle; a seedcap conviction of
  the winning run revokes the mark, the place is not re-awarded. A carrier row on `endless_cup` (same
  carrier account as the tier cuts) carries this week, the thresholds, the entrants per family and which
  editions were held. Verdicts live in `endless-solo.json` (`cup`). Board names: `ENDLESS_CUP_LB`,
  `ENDLESS_CUP_HONOR_LB`.

State files committed back each run (idempotency): `processed.json`, `skill.json`,
`leavers.json` (per-player `{ leaves, lastMatch, w: [[matchHash, finishes after]], o }`: the lifetime
leave count plus the leaves the repeat-leaver window -- the last 50 matchmade events -- can still see; an
entry without `w` predates the window and its leaves count as the player's oldest events), `xp.json` (per-player `{ lastWinDay, games }` for the daily-first bonus
and the repeat-leaver rate, the career counters, and on the full game's job the win streak
`sk`: `{ p, b, h, l, e: [[start minute, matchHash, k]], f: [[minute, matchHash]] }`), `starts.json` (pending start attestations awaiting
settlement or maturity), `signals.json` (rolling per-player/pairwise signal aggregates +
flag dedup + daily settle counters), `groups.json` (per-player recent-opponents memory for
the repeat-group rating decay — consecutive matches against mostly the same people update
TrueSkill at x1/x0.5/x0.25/x0; TTL-scoped, points/XP untouched), `confessions.json`
(pending abandon confessions: immediate leaver penalty at quit time, refunded if the
confessor later settles the same match — amounts only, no identities), `pending-writes.json`
(O480: points receipts waiting for their player's next points write). Player identifiers in
state are stored as keyed hashes, never raw IDs.

## Configuration

All values are injected via environment / Actions secrets — none are committed:
`STEAM_PUBLISHER_KEY`, `APPID`, `LB_PREFIX`, `RANKED_LB`, `LP_LB`, `STATE_SALT`.
Optional: `XP_LB` (progression ladder board name — XP is skipped if unset),
`APPLY_MMR=0` (dry-run, no writes), `ALLOW_TEST=1`, `K_FACTOR`,
`LEAVER_LP_PENALTY` (ranked leaver points deduction, default 100),
`STARTS_MATURITY_MS` (start-attestation verdict window, default 2 h),
`ABSENT_GRACE_MS` (how long a group missing a roster seat's record waits before settling
without it, default 5 min, never below 3 min), `LEDGER_SHARDS` (record shard count on the
main / demo channel, default 50; the playtest channel uses `PT_SHARD_COUNT`),
`SHARD_STRICT_BODY=0` (escape hatch: read a shard's 200 without an entries block as an
empty board again instead of an incomplete read — only if Steam turns out to answer that
way for a board the listing still counts as non-empty), `READ_RETRY_MS` (base backoff
between board read retries, default 8 s; tests set 0),
`STARTS_FILE` (pending-starts state path, default `starts.json`),
`SANITY_SCORE_CAP` / `SANITY_SCORE_FLOOR` / `SANITY_DUR_CAP` / `SANITY_MIN_START_AGE_MS`
(sanity bounds + pacing gate; generous defaults, tighten only with real-traffic data; a friends'
room's duration bound scales with the levels its record played, `durCapOf`), `PT_SEED_CP` (the
one-shot starter wallet of an account the job has never seen on the CP board, every channel,
default 60, `0` = off),
`SIGNALS_FILE` / `SIG_PAIR_WINDOW_MS` / `SIG_PLAYER_WINDOW_MS` / `SIG_PAIRS_CAP`
(signal-collection state path, rolling windows, size fuse),
`GROUPS_FILE` (repeat-group decay state path, default `groups.json`),
`CONFESSIONS_FILE` (pending abandon-confession state path, default `confessions.json`),
`PENDING_WRITES_FILE` / `RECEIPT_HOLD_MS` (O480 points-row backlog path, default `pending-writes.json`; how long a
queued receipt waits, default 6 h), `CRON_PULSE_LB` (O480 pulse board, default `cron_pulse`, `cron_pulse_test` in a
sandbox run),
`T2LD_K` / `T2LD_K_HARD` / `T2LD_WINDOW_MS` (team-gamble lone dissent: strikes that convict, total
strike cap whatever the host, rolling window; defaults 2 / 4 / 30 days),
`T2LH_WINDOW_MS` / `TRUST_HD1` / `TRUST_HD2` (team-gamble host charges: rolling window, and the
counts that add one / two trust tiers; defaults 30 days / 3 / 8).
