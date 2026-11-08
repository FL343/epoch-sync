# shadow/elp -- the ELP shadow history (O759 / O760)

Written once a day by `.github/workflows/elp-shadow.yml` on `main` (code: `shadow/` on `main`, see
`shadow/README.md` there). Computes, never writes: nothing here is read by the reconcile job or the client.

- `elp-shadow.json`: one entry a day (the last 400 days) -- per family the official and the shadow pass lines,
  their difference, credibility, estimated error, day-over-day jump; per family the O759 gate numbers and a
  coarse distribution. Aggregates only: no account or player id. `finals` = each season's last smoothed lines
  (the next season's prior).
- `latest.md`: the summary of the newest day.
