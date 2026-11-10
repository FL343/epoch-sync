# ELP shadow (O759 / O760) -- computes, never writes

A daily side job that runs next to the reconcile job and changes nothing it does. It reads the
`endless-solo.json` the reconcile job already committed, computes two candidate rules for the endless
competitive points, prints a summary, and keeps the history on the branch `shadow/elp`. Nothing is
written to Steam, to a board, to a state file, or to `main`.

| | |
|---|---|
| workflow | `.github/workflows/elp-shadow.yml` (01:37 UTC daily + by hand; no secret, GitHub-hosted runner, own concurrency group, off the reconcile minutes) |
| code | `shadow/elp-shadow-plan.js` (pure math + constants) · `shadow/elp-shadow.js` (one day) |
| tools | `shadow/sim-bootstrap.js` (how many players / how much smoothing) · `shadow/fake-state.js` (made-up seasons) |
| tests | `shadow/test/*.js` -- run by the shadow workflow only, never by the reconcile workflows |
| history | branch `shadow/elp`: `elp-shadow.json` (one entry a day, 400 days; `finals` = each season's last smoothed lines) + `latest.md` |

## Why a separate job

The reconcile workflows run every `test/*.js` before each settle and skip the settle when one is red, and
`points-plan.js` is mirrored byte for byte by the companion client. So the shadow adds no file to `test/`, does
not touch `validate.js` / `points-plan.js` / the reconcile workflows, and lives in its own workflow and its own
branch. `shadow/test/elp-shadow-run.js` [5] pins that (no official file refers to the shadow; the workflow uses
no secret, no Steam, pushes only `shadow/elp`, has no step named `test`, and the official workflow scans stay
green with it). A failed shadow run only loses one day of history.

## What it computes

**O760 -- pass lines from a few hundred players.** The official table blends the prior into the live lines by
head count (N <= 20 prior only, N >= 200 live only); the live lines read the top tiers off the top 1 % / 4 % of
the sorted hidden skills, i.e. off 2 / 8 players at N = 200. The shadow reads the same percentiles off a fitted
curve instead:

1. fit a log-normal to the hidden skills of the family's placed players: `hybrid` = least squares of log(skill)
   on the normal score over the players at or above the median (the bottom -- zeros, tourists -- does not bend
   the top), the plain sorted value for the one cut below the median;
2. the seven lines from the curve by the official definition (same percentiles, same span middles);
3. each line weighed against the prior by credibility `Z_k = N / (N + (C_K[k] / TAU)^2)` in log space;
4. EMA over days (`EMA_ALPHA` of today), restarting on a season change;
5. round + the official monotone fix.

Prior: season 0 = the static preset; season 1 = the season-0 final mixed 50/50 with the preset (S0 is two
weeks); season 2+ = the previous season's final.

**O759 -- grandmaster calibration (off, opens by itself).** (O825, 2026-11-10: a player has ONE points value a
season, on the entry `pid|all|season`; the family entries keep the runs. The pool of a family = the players at
grandmaster points who have a hidden skill in that family from their own runs -- a player of two families sits in
both pools; the walk back over the recorded changes goes over his runs of every family in start order and counts this
family's -- an estimate: a run a save point held back settled later than the runs started after it, and a refund
moves the points without a run.)
Per family the grandmaster pool (points >= 8000)
ranked by hidden skill; deserved points = 8000 + percentile x 1999. The switch would open when the effective
pool (grandmasters with a full window of 10 settled runs) is >= 20 and the ranks of the players in both pools
correlate >= 0.8 day over day (Spearman; the workflow fetches the state of a day earlier from the git history).
The summary shows the gate, the deserved-minus-points spread, and what the calibration would have done to the
last day's grandmaster runs (a pass below the deserved points + up to 60, a miss above them - up to 20, a run
never past the swing cap 119). The two caps are first guesses.

## Bootstrap results (`node shadow/sim-bootstrap.js`, 2026-11-08)

Four population models (A median 7 levels spread 0.6, B spread 0.9, C two groups -- not log-normal, D many
tourists). Relative RMSE of the grandmaster line at N = 300: sorted values 17-26 %, hybrid fit 9-14 %. The
published line (whole numbers, silver .. grandmaster, mean |error| vs the truth, averaged over the models):

| N | 20 | 50 | 100 | 150 | 200 | 300 | 500 | 1000 |
|---|---|---|---|---|---|---|---|---|
| shadow | 18.6 % | 14.5 % | 10.6 % | 9.2 % | 8.4 % | 6.9 % | 5.6 % | 4.6 % |
| official blend | 27.7 % | 24.2 % | 18.9 % | 11.7 % | 11.1 % | 8.7 % | 6.8 % | 5.3 % |

(per model the shadow is lower at every point but one: model C at N 150, 8.6 vs 8.5 %). TAU 0.3 is the
lowest-error prior weight of 0.2 .. 0.7. With `C_K` = 0.94 / 0.89 / 0.94 / 1.05 / 1.25 /
1.74 / 2.29 a line counts as real data (Z >= 0.9) from about 90 placed players (bronze .. gold), 110 platinum,
160 diamond, 300 master, 520 grandmaster. EMA 0.3 halves the day-over-day jitter (3.0 % -> 1.4 % on the largest
tier) and follows a jump to 90 % in 6.5 days. Bronze / silver errors at a few levels are mostly the rounding to
whole levels.

## Not done here

- Fully banned players are not left out (the official job takes the lower line with / without them, Q338; the
  ban rows are on Steam and the shadow makes no Steam call).
- The "if on" O759 numbers use today's deserved points and walk the points back over the recorded changes
  (a conviction refund in between is not undone).
- Adopting either rule is its own change: O760 = the official table code (cron only; the client reads the
  table), O759 = the client's optimistic rule first (shipped switched off), then the cron half.

## One-time setup

The branch `shadow/elp` was created by hand (an orphan branch with this repository's first `elp-shadow.json`);
the workflow fails loudly when it is missing.
