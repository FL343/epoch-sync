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

**Team match types** (base 3/4 = quick/ranked team-brawl): placement follows the fixed
seat convention — seats (0,1) vs (2,3), winning pair takes ranks {1,2} — instead of raw
score order, the rating update treats each side as one team (strength = summed mu,
binary outcome, per-member updates), and ranked team points are the halved team result
(win/loss component from the team-average tier, personal drip added at full value).
A player whose teammate was convicted absent gets his loss compressed (protected).
**Premade pairs inside an FFA match** are declared as a seat-pair bitmask in the
matchType's high bits (the match group key contains the full code, so a lone forged
mask only orphans that record): the pair settles at its average placement and average
tier with one shared delta, and mismatch compensation treats the pair as a single unit.

**Start attestations** close the blind spot of a match nobody settles: each client also
writes a start-type record (a second magic, zeroed result fields, same roster layout)
when play actually begins. A start group with two-plus distinct writers and a
per-seat majority roster is held as pending state; if no consistent settlement appears
before a maturity window (default 2 h) elapses, every consensus-roster member who wrote
no settle record takes an exit-rate hit. Deliberately **no points penalty** on this
path — with zero finisher testimony, a coordinated dodge is indistinguishable from a
crash/migration-failure cascade, so the harsh deduction stays on the finisher-consensus
path above. Anyone who wrote any settle record is exempt (remembered across runs, since
shard entries get overwritten), and lone attestations convict nobody.

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
- `test/void-consensus.js`, `test/leaver-absence.js`, `test/lp-penalty.js`,
  `test/xp-ladder.js`, `test/reduced-stakes.js`, `test/team-rank.js`, `test/team-lp.js`,
  `test/start-orphan.js` — unit tests for the pure helpers (run one with
  `node test/<name>.js`; CI runs all of `test/*.js` before each reconcile).
- `.github/workflows/validate.yml` — scheduled run + state persistence.

State files committed back each run (idempotency): `processed.json`, `skill.json`,
`leavers.json`, `xp.json` (per-player `{ lastWinDay, games }` for the daily-first bonus
and the repeat-leaver rate), `starts.json` (pending start attestations awaiting
settlement or maturity). Player identifiers in state are stored as keyed hashes,
never raw IDs.

## Configuration

All values are injected via environment / Actions secrets — none are committed:
`STEAM_PUBLISHER_KEY`, `APPID`, `LB_PREFIX`, `RANKED_LB`, `LP_LB`, `STATE_SALT`.
Optional: `XP_LB` (progression ladder board name — XP is skipped if unset),
`APPLY_MMR=0` (dry-run, no writes), `ALLOW_TEST=1`, `K_FACTOR`,
`LEAVER_LP_PENALTY` (ranked leaver points deduction, default 100),
`STARTS_MATURITY_MS` (start-attestation verdict window, default 2 h),
`STARTS_FILE` (pending-starts state path, default `starts.json`).
