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

Visible points (the LP ladder) move for **ranked matches only** (matchType 2); quick
matches update the hidden rating only. A consensus-detected leaver (in roster, no
settle record) loses a fixed points penalty in the ranked ladder — this is the
authoritative half of the client's optimistic deduction, so it survives read-back
rather than being reverted. Single-side records can't frame a leaver (majority roster
vote), and each match is penalized at most once (idempotent via `processed.json`).

## Files

- `validate.js` — read shards, decode records, group by match, compare vectors,
  consensus VOID, rating/points update.
- `trueskill.js` — TrueSkill (mu/sigma) update + display rating.
- `test/void-consensus.js`, `test/leaver-absence.js` — unit tests for the pure helpers
  (`node test/void-consensus.js`).
- `.github/workflows/validate.yml` — scheduled run + state persistence.

State files committed back each run (idempotency): `processed.json`, `skill.json`,
`leavers.json`. Player identifiers in state are stored as keyed hashes, never raw IDs.

## Configuration

All values are injected via environment / Actions secrets — none are committed:
`STEAM_PUBLISHER_KEY`, `APPID`, `LB_PREFIX`, `RANKED_LB`, `LP_LB`, `STATE_SALT`.
Optional: `APPLY_MMR=0` (dry-run, no writes), `ALLOW_TEST=1`, `K_FACTOR`,
`LEAVER_LP_PENALTY` (ranked leaver points deduction, default 100).
