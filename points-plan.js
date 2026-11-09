'use strict';
// ============================================================
// points-plan.js - the visible points (LP) rules of a ranked settle: one copy for this job and for the client
// ============================================================
// O480 (2026-10-16): the client shows the points a ranked match gave the moment the match ends. To show the value this
// job will settle (not an estimate), both sides run THIS file: validate.js requires it, and the companion repo vendors a
// comment-stripped copy of it into the client (its scripts/gen-points-vendor.js; byte-locked by its schema lockstep test,
// and both repos replay the golden cases fixtures/points-plan/cases.json). Hence the rules for this file:
//   - self-contained: no require, no process.env, no clock, no I/O. The knobs the job used to read from the environment
//     (RS_* / LEAVER_LP_PENALTY) come in through configure(); the live workflows set none of them;
//   - `//` line comments only, never `//` inside a string, ASCII-only code (the vendor copy strips comments line by line);
//   - it loads as a CommonJS module (module.exports: only when `this` is this file's own exports object, so a script or a
//     new Function('window', src) run inside a host that happens to have a global `module` still lands on window.POINTS_PLAN).
// RULES_VER: +1 in the same change as ANY number or rule here that moves a settled delta. The client copy carries the version
//   it was built with; a job ahead of the client shows the player "to be confirmed" instead of a wrong value (the job
//   publishes its version on the cron_pulse row and in every points receipt).
// FIXTURES_HASH: canonical hash of fixtures/points-plan/cases.json (tools/gen-points-fixtures.js prints it); a change that moves
//   a case regenerates the file and updates this constant in the same change (test/points-plan-fixtures.js holds both).
// ============================================================
(function (cjs, root, factory) {
  const api = factory();
  if (cjs) module.exports = api;
  else if (root) root.POINTS_PLAN = api;
})(typeof module === 'object' && !!module && typeof exports === 'object' && this === exports, typeof window !== 'undefined' ? window : null, function () {
  const RULES_VER = 1;
  const FIXTURES_HASH = 'ba9858dc4c9a5cef';
  // the knobs configure() can move (production runs these defaults)
  const DEFAULTS = Object.freeze({ RS_THRESHOLD: 400, RS_UPSET_BONUS: 1.0, RS_STRONG_UPSET_LOSS: 0.5, RS_SOLO_VS_TRIO: 0.6, RS_TRIO_WIN: 0.7, LEAVER_LP_PENALTY: 100 });
  const LP_MAX = 9999;
  let LEAVER_LP_PENALTY = DEFAULTS.LEAVER_LP_PENALTY;   // ranked leaver authoritative LP deduction (pairs the client optimistic -100)
  // `rs` = mismatch retention coefficient (fraction of the win/loss component applied to EXPECTED outcomes in a
  //   mismatched match) per tier: lower tiers move closer to normal, higher tiers compress hard (protect the top ladder).
  // 7 tiers (2026-07-14): silver/platinum inserted as transition tiers -- narrow bottom (fast first
  //   promotion), wide top. The four legacy tier lines (2000/4000/6000/8000) are unchanged, so every
  //   promotion-series invariant below still holds: band width 2*120=240 < narrowest span 600, and
  //   the largest natural swing (45+5=50) < BOUNDARY_MARGIN. Mirrored by the client ranked-config
  //   LP_SEG + rating-store TIERS (lockstep-pinned by the client test suite; rs is cron-only, not mirrored).
  // Grandmaster rs 0 (cloud audit Q160; was 0.05): the top is zero-sum, so an expected result in a mismatch moves nothing.
  //   At 0.05 a grandmaster's expected win still made +1 (20 * 0.05) out of nobody: a loser at the points floor pays nothing,
  //   so two accounts writing every seat of matches nobody played (one always winning, one kept at 0 points) climbed the top
  //   one point a match without end, about 290 a day at the one-match-at-a-time pace. Below grandmaster rs is unchanged.
  const LP_SEG = [
    { min: 0, win: 45, loss: 15, drip: 5, rs: 0.70 },     // bronze (600 wide)
    { min: 600, win: 40, loss: 17, drip: 4, rs: 0.60 },   // silver
    { min: 2000, win: 35, loss: 20, drip: 3, rs: 0.50 },  // gold
    { min: 3000, win: 31, loss: 22, drip: 2, rs: 0.40 },  // platinum
    { min: 4000, win: 28, loss: 25, drip: 2, rs: 0.30 },  // diamond
    { min: 6000, win: 22, loss: 22, drip: 1, rs: 0.15 },  // master
    { min: 8000, win: 20, loss: 20, drip: 0, rs: 0 },     // grandmaster (zero-sum top; rs 0, Q160)
  ];
  function lpSeg(lp) { let s = LP_SEG[0]; for (const x of LP_SEG) if (lp >= x.min) s = x; return s; }
  // placement seeding (2026-07-14): a player's FIRST ranked settle starts from a TrueSkill-derived
  //   seed instead of 0. Ranked unlock requires ~15 quick matches, so the pre-match display rating is
  //   already a real skill signal. seed = clamp((display - BASE) * SLOPE, 0, CAP); CAP lands mid-
  //   platinum -- diamond+ must be climbed, and 3200 sits outside both boundary bands (3000+120 /
  //   4000-120). New/weak players (display <= 1000) seed 0 = the old everyone-starts-bronze behavior.
  //   The client mirrors this formula optimistically on its first ranked game (read-back corrects).
  const LP_SEED = { BASE: 1000, SLOPE: 4, CAP: 3200 };
  function seedLp(display) { return Math.max(0, Math.min(LP_SEED.CAP, Math.round(((display | 0) - LP_SEED.BASE) * LP_SEED.SLOPE))); }
  // Soft-reset landing per tier index (design-locked): null = keep in place (bottom tiers),
  // else land at the target (min() guards against a mis-edited table ever RAISING points).
  const SOFT_RESET = [null, null, 1200, 2000, 3000, 4000, 5000];
  function softResetLp(lp) {
    let i = 0; for (let k = 0; k < LP_SEG.length; k++) if ((lp | 0) >= LP_SEG[k].min) i = k;
    const t = SOFT_RESET[i];
    return t == null ? (lp | 0) : Math.min(lp | 0, t | 0);
  }
  // Lazy season seeding priority: an entry on the IMMEDIATELY previous season's board wins
  // (soft reset of last season's finish); absent there = sat the season out (or brand new) ->
  // fall back to the display-derived placement seed. Applied at a player's first settle of the
  // new season -- no boundary-time bulk migration ever runs.
  function seasonSeedLp(prevScore, display) {
    return prevScore != null ? softResetLp(prevScore | 0) : seedLp(display);
  }
  function lpDelta(lp, rank, pc) {
    const seg = lpSeg(lp);
    const p = pc <= 1 ? 0.5 : (pc - 1 - (rank - 1)) / (pc - 1);
    const base = p >= 0.5 ? seg.win * (2 * p - 1) : -seg.loss * (1 - 2 * p);
    return Math.round(base + seg.drip);
  }
  // ===== hard promotion/relegation series (user design 2026-07-10). =====
  // A player whose pre-match LP sits within BOUNDARY_MARGIN of a tier line is "in series" -- the
  // client shows the promotion/relegation-match UI + intro music for exactly that state (lockstep
  // mirror of RatingStore.boundaryState). The series rule makes the outcome decisive:
  //   promotion match + top-half finish (teams: team won)  -> always crosses UP   (lands min+PROMO_LAND)
  //   relegation match + bottom-half finish (teams: lost)  -> always crosses DOWN (lands min-RELEG_LAND)
  // Implemented as a clamp on the final per-player delta so it composes with reduced-stakes factors,
  // team halving and the premade average-rank rule; a natural delta already past the line is kept.
  // The margin (120) exceeds the largest natural swing (~50), so line crossings can ONLY happen in a
  // series match -- this clamp adds the reverse guarantee (series win/loss is always decisive).
  // PROTECTED ends (flag 2: mismatch weak side / abandoned-teammate shield, design line 7) keep their
  // compressed natural loss instead of the forced drop. The leaver -100 penalty path stays independent.
  const BOUNDARY_MARGIN = 120, PROMO_LAND = 10, RELEG_LAND = 15;
  function boundaryOf(lp) {
    let i = 0; for (let k = 0; k < LP_SEG.length; k++) if (lp >= LP_SEG[k].min) i = k;
    if (i > 0 && lp - LP_SEG[i].min <= BOUNDARY_MARGIN) return 'relegation';
    if (i < LP_SEG.length - 1 && LP_SEG[i + 1].min - lp <= BOUNDARY_MARGIN) return 'promotion';
    return null;
  }
  function crosslineDelta(lp, delta, won) {
    const b = boundaryOf(lp);
    let i = 0; for (let k = 0; k < LP_SEG.length; k++) if (lp >= LP_SEG[k].min) i = k;
    if (b === 'promotion' && won) return Math.max(delta, LP_SEG[i + 1].min + PROMO_LAND - lp);
    if (b === 'relegation' && !won) return Math.min(delta, LP_SEG[i].min - RELEG_LAND - lp);
    return delta;
  }
  // matchType layout: base mode code in the low nibble, FFA "premade seat-pair" bitmask in bits 4..7
  // (bit k set = seats (2k, 2k+1) queued together as a party). The host derives the mask from the
  // mutually-acknowledged party groups at seat time and broadcasts it with the match start payload,
  // so every honest end composes the same code -- and since the match group key contains d[2], a
  // lone end forging its mask just orphans its own record (and gets convicted absent by the rest).
  // Team codes (3/4/5/6/8/9) never carry a mask: the fixed seat convention already encodes grouping.
  // FFA codes carry it so the settle pass can apply the premade average-rank LP rule (design line 66)
  // with no record-layout change.
  // O82 (6P matchmaking): bits 8..10 = FFA premade-TRIO start seat + 1 (0 = none; v>0 = a mutually
  // acknowledged 3-man party occupies contiguous seats v-1..v+1). Same trust model as the pair mask
  // (host-derived, broadcast, keyed into the match group). Bases 8/9 = quick/ranked mode-2 with
  // teamSize 3 (3V3, seats 0-2 vs 3-5) -- the same mirrored-rounds engine as 5/6, wider seating.
  function baseMt(mt) { return (mt | 0) & 0xF; }
  function premadeMaskOf(mt) { return ((mt | 0) >> 4) & 0xF; }
  function premadeTrioAtOf(mt) { return ((mt | 0) >> 8) & 0x7; }
  // team layout parameters: bases 8/9 seat two teams of 3 (0-2 vs 3-5); every other team base is 2v2.
  function teamSizeOfMt(mt) { const b = baseMt(mt); return (b === 8 || b === 9) ? 3 : 2; }
  function teamOfSeat(seat, ts) { return (((seat | 0) / (ts || 2)) | 0) & 1; }
  // visible points move for ranked matches only; quick classes update the hidden rating.
  // base 6 (ranked mode 2) flips on HERE, in the same change that routes mode-2 groups through the
  // halved team-LP path with a sub-score-derived outcome (teamLpPlan winTeamOverride below) -- the
  // same red line as base 4: a team code must never reach the individual full-stakes LP path.
  // base 4 (ranked team-brawl) flipped HERE earlier, in the same change that shipped the halved team-LP path
  // (teamLpPlan below) -- the plan's red line: a type-4 record must never reach the individual
  // full-stakes LP path. Base 9 (ranked 3V3) joins in the same change that generalizes every
  // team-code consumer to teamSizeOfMt -- same red line, wider seats.
  function appliesLp(mt) { const b = baseMt(mt); return b === 2 || b === 4 || b === 6 || b === 9; }
  // O716 one queue for quick + ranked: bits 11-16 of the match type = the seats that came in through ranked (a mixed table of
  //   one quick family base). No mask (every record written before O716) = the old whole-table rule, so 2/4/6/9 stay all-ranked.
  const RANKED_SEAT_SHIFT = 11;
  function rankedSeatMaskOf(mt) { return ((mt | 0) >> RANKED_SEAT_SHIFT) & 0x3F; }
  function mtSansSeats(mt) { return (mt | 0) & ((1 << RANKED_SEAT_SHIFT) - 1); }
  function seatAppliesLp(mt, seat) { const m = rankedSeatMaskOf(mt); return m ? !!((m >> (seat | 0)) & 1) : appliesLp(mt); }
  function anyAppliesLp(mt) { return appliesLp(mt) || rankedSeatMaskOf(mt) !== 0; }
  // team match types: 3/4 = quick/ranked team-brawl (mode 1); 5/6 = quick/ranked mode 2 (true 2v2);
  // 8/9 = quick/ranked mode 2 at teamSize 3 (O82 6P matchmaking).
  function isTeamMt(mt) { const b = baseMt(mt); return b === 3 || b === 4 || b === 5 || b === 6 || b === 8 || b === 9; }
  // clamp-aware authoritative leaver deduction (never below 0)
  function leaverLpPenalty(cur, pen) { return Math.max(0, (cur | 0) - (pen | 0)); }
  // O774 (2026-11-09, the user: "add the other modifiers so the client can make its best guess"): every plan row also
  //   carries why: the rules that shaped its delta, in the order applied -- 'upset' (weak side placed up), 'mismatch' (weak
  //   side's loss compressed), 'expected' (strong side's win compressed by the tier's rs), 'upset_loss' (strong side lost:
  //   the loss is cut to RS_STRONG_UPSET_LOSS), 'solo_shield' (a solo's loss against a live trio), 'trio_tax' (a trio's win
  //   in that match), 'teammate_left' (a shielded team loser). Labels only: the settle never reads them and no number moves,
  //   so RULES_VER stays; the golden cases carry them (FIXTURES_HASH moves with the case file).
  // ===== mismatch compensation (the matchmaking-fairness layer): compress the strong side's swing, protect/reward the
  //   weak side. authoritative -- the client shows a flat optimistic delta (it can't see opponents' ratings); this is the
  //   only place the real adjusted delta + UPSET/PROTECTED tag is computed, revealed back to the client via board details. =====
  let RS_THRESHOLD = DEFAULTS.RS_THRESHOLD;            // pre-match rating spread (display points) that triggers
  let RS_UPSET_BONUS = DEFAULTS.RS_UPSET_BONUS;        // weak side over-performs: 1.0 = full (>1 = super reward)
  let RS_STRONG_UPSET_LOSS = DEFAULTS.RS_STRONG_UPSET_LOSS; // strong side upset: mild penalty (not the strict tier coeff)
  // O82 solo-tilt (design 2026-08-12, conservative until B5/B6 calibration): in an FFA that
  // contains a live 3-man premade, a solo's LOSS is compressed x0.6 (escort shield, PROTECTED
  // reveal on a real net loss) and the trio's WIN is compressed x0.7 (convoy tax, no reveal --
  // same precedent as the strong-side compression). Composed with the mismatch factor by min()
  // (strongest protection wins, factors never stack multiplicatively).
  let RS_SOLO_VS_TRIO = DEFAULTS.RS_SOLO_VS_TRIO;
  let RS_TRIO_WIN = DEFAULTS.RS_TRIO_WIN;
  const RS_MAGIC = 0xC5;                                                   // reveal-details marker; flags: 0 none / 1 upset / 2 protected
  // pure: parts = [{ steamID, seat, mmr (pre-match display rating), rank (1-based), lp (current) }]. returns null if
  //   not applicable, else { [steamID]: { adjDelta, flag, normalDelta } }. Drip is never discounted (only the
  //   win/loss component is scaled).
  // M3 (PARTY_MODES §5.3, design line 66): FFA settles in UNITS -- a premade seat-pair (both members present)
  //   is one unit: average rank interpolates the win/loss component, average LP picks the tier, and BOTH members
  //   get the same delta (the premade "debt": queuing together taxes the good rank into the pair average).
  //   Mismatch compensation then applies per unit (pair average rating vs the match mean). Solo players are
  //   1-man units == the original per-player formula, bit for bit. A pair whose partner is absent (leaver)
  //   falls back to solo. With no live pair and no mismatch this returns null (caller's plain lpDelta path).
  function reducedStakesPlan(parts, matchType, premadeMask, premadeTrioAt) {
    // O716: a mixed table (a ranked-seat mask) plans too -- every seat, the mismatch read over the whole table (the user's
    //   call 2026-11-07, D11); the settle takes the rows of its ranked seats only. A premade unit is one entry (D4).
    if (!anyAppliesLp(matchType) || isTeamMt(matchType) || !parts || parts.length < 2) return null;
    const units = [], used = new Set();
    const bySeat = {};
    for (const p of parts) bySeat[p.seat | 0] = p;
    // O82: trio unit first (all three members present, else each falls back to solo -- the same
    // conservative absent-partner rule as pairs). trioAt = start seat + 1 (contiguous seats).
    if (premadeTrioAt | 0) {
      const s0 = (premadeTrioAt | 0) - 1;
      const m = [bySeat[s0], bySeat[s0 + 1], bySeat[s0 + 2]];
      if (m[0] && m[1] && m[2]) { units.push(m); for (const p of m) used.add(p.steamID); }
    }
    if (premadeMask | 0) {
      for (let pair = 0; pair < 4; pair++) {
        if (!(((premadeMask | 0) >> pair) & 1)) continue;
        const m0 = bySeat[pair * 2], m1 = bySeat[pair * 2 + 1];
        if (m0 && m1 && !used.has(m0.steamID) && !used.has(m1.steamID)) { units.push([m0, m1]); used.add(m0.steamID); used.add(m1.steamID); }
      }
    }
    for (const p of parts) if (!used.has(p.steamID)) units.push([p]);
    const mmrs = parts.map(p => p.mmr | 0);
    const mismatch = Math.max.apply(null, mmrs) - Math.min.apply(null, mmrs) > RS_THRESHOLD;
    if (!mismatch && units.every(u => u.length === 1)) return null;   // fair all-solo match: plain lpDelta path
    const mean = mmrs.reduce((a, b) => a + b, 0) / mmrs.length;
    const trioLive = units.some(u => u.length === 3);   // O82 solo-tilt applies only against a LIVE trio
    const pc = parts.length, out = {};
    for (const u of units) {
      const uRank = u.reduce((s, p) => s + (p.rank | 0), 0) / u.length;
      const uLp = u.reduce((s, p) => s + (p.lp | 0), 0) / u.length;
      const uMmr = u.reduce((s, p) => s + (p.mmr | 0), 0) / u.length;
      const seg = lpSeg(uLp);
      const prog = pc <= 1 ? 0.5 : (pc - 1 - (uRank - 1)) / (pc - 1);
      const base = prog >= 0.5 ? seg.win * (2 * prog - 1) : -seg.loss * (1 - 2 * prog);
      const normalDelta = Math.round(base + seg.drip);
      let factor = 1, flag = 0;
      const why = [];   // O774: which rule shaped this delta (labels only, never read by the settle; see whyOf below)
      if (mismatch && uMmr < mean) {                             // weak side
        if (base > 0) { factor = RS_UPSET_BONUS; flag = 1; why.push('upset'); }     //   placed up = upset (full/super, not compressed)
        else { factor = seg.rs; if (normalDelta < 0) flag = 2; if (base < 0) why.push('mismatch'); } //   placed down = protected (loss compressed; reveal only on a real net loss)
      } else if (mismatch && uMmr > mean) {                      // strong side (no client reveal)
        if (base >= 0) { factor = seg.rs; if (base > 0) why.push('expected'); }   //   won as expected = gain compressed
        else { factor = RS_STRONG_UPSET_LOSS; why.push('upset_loss'); }          //   lost an upset = mild penalty
      }
      // O82 solo-tilt (min-composed, see RS_SOLO_VS_TRIO note): solo losing vs a live trio gets the
      // escort shield (PROTECTED reveal on a real net loss); the trio's winning delta takes the
      // convoy tax silently (strong-side precedent).
      if (trioLive && u.length === 1 && base < 0) {
        if (RS_SOLO_VS_TRIO < factor) why.push('solo_shield');
        factor = Math.min(factor, RS_SOLO_VS_TRIO);
        if (flag === 0 && normalDelta < 0) flag = 2;
      } else if (trioLive && u.length === 3 && base > 0) {
        if (RS_TRIO_WIN < factor) why.push('trio_tax');
        factor = Math.min(factor, RS_TRIO_WIN);
      }
      const adjDelta = Math.round(base * factor + seg.drip);
      // won = top-half finish at the unit's (average) rank -- the same sign line the base uses;
      // consumed by the series clamp (crosslineDelta) at settle time. Q160 layer 5 (cloud audit): one delta for the whole
      // unit, its strong member's expected win included (see teamLpPlan: held at his own tier, the honest grandmaster in a
      // pair with a gold friend gained nothing; a premade carry of zero-points accounts stays a known residual).
      for (const p of u) out[p.steamID] = { adjDelta, flag, normalDelta, won: prog >= 0.5, why: why.slice() };
    }
    return out;
  }

  // ===== M3 (PARTY_MODES §5.2 + §6 line 118 + §7): team-brawl visible-LP planner (match types 3/4; only 4
  //   actually applies LP). Binary team outcome from the frozen score vector -- a leaver's score still counts
  //   for his team's total. The win/loss component uses the TEAM-average tier (design: "team LP first, then
  //   halve"), is scaled by mismatch compensation at TEAM granularity (team-average rating vs the match mean,
  //   coefficient = team-average tier's rs), then HALVED per member; drip is added per member at full value
  //   from his OWN tier (design line 76: the halving only ever touches the win/loss component).
  //   §7 abandoned-teammate shield: a present member whose teammate was convicted absent gets his loss
  //   compressed by his own tier's rs (min with any mismatch factor) and a PROTECTED reveal on a real net loss.
  //   parts: [{ steamID, seat, mmr, lp }] (present ends only); scores: full 4-seat frozen vector;
  //   leaverSeats: consensus-absent seats. winTeamOverride (mode-2 only): the sub-score-derived
  //   outcome from team2WinTeamOf -- money must never decide a base-5/6 match, so the caller passes
  //   the claims-derived winner and the money comparison below stays a 3/4-only fallback.
  //   absent (Q167, optional): [{ seat, mmr, lp }] -- the losing team's convicted leavers at their pre-match rating; they count
  //   toward the mismatch of an expected win (see the strong-team branch below) and, with their points, toward the
  //   full-team reading of a shielded loser (Q183, below).
  //   finished (Q183, optional): [{ seat, mmr, lp }] -- seats seen agreeing whose record is gone at this settle (Q149: they
  //   finished): members of their team for every reading, as if their record were still there; no output of their own.
  //   Returns { [steamID]: { adjDelta, flag, normalDelta } } or null. =====
  function teamLpPlan(parts, matchType, scores, leaverSeats, winTeamOverride, absent, finished) {
    // O716: a mixed table plans too (team averages over every seat: a quick member reads his points row, or with none this
    //   season the placement seed the settle would give him, not written -- the user's call 2026-11-07, D8); the settle takes
    //   the rows of its ranked seats only
    if (!anyAppliesLp(matchType) || !isTeamMt(matchType)) return null;
    const ts = teamSizeOfMt(matchType);
    if (!parts || !parts.length || !scores || scores.length < 2 * ts) return null;
    const teamOf = s => teamOfSeat(s, ts);
    let aTotal = 0, bTotal = 0;
    for (let s = 0; s < 2 * ts; s++) { if (teamOfSeat(s, ts) === 0) aTotal += scores[s] | 0; else bTotal += scores[s] | 0; }
    const winTeam = (winTeamOverride == null)
      ? (bTotal > aTotal ? 1 : 0)              // tie -> team A (mirrors teamRankOf / the client rule)
      : (winTeamOverride | 0);
    // team aggregates over PRESENT members (an absent leaver has no record: not averaged in)
    // Q183 (cloud audit): ... and over the seats seen agreeing whose record is gone (finished): those players played the match
    //   out and agreed on its result, and only their record went missing before the settle (shard rotation while the group
    //   waited, or a client that overwrote it). Read without them, the honest loser who stayed lost the mismatch protection of
    //   the normal finish: a gold loser whose fresh-account teammate agreed and then lost his record took -7 where the normal
    //   finish gave -2 (up to 11 points lower across tiers), and a withdrawal could just as well lighten a loss or move a win.
    //   Counted here, every reading of every present player is the one of the normal finish.
    const roster = parts.concat(finished || []);
    const agg = [{ n: 0, lp: 0, mmr: 0 }, { n: 0, lp: 0, mmr: 0 }];
    for (const p of roster) { const t = teamOf(p.seat); agg[t].n++; agg[t].lp += p.lp | 0; agg[t].mmr += p.mmr | 0; }
    const mmrs = roster.map(p => p.mmr | 0);
    const mismatch = mmrs.length >= 2 && (Math.max.apply(null, mmrs) - Math.min.apply(null, mmrs) > RS_THRESHOLD);
    const mean = mmrs.reduce((a, b) => a + b, 0) / (mmrs.length || 1);
    // Q167 (cloud audit): the same spread and mean with the losing team's leavers counted at their pre-match rating
    const mmrsA = mmrs.concat((absent || []).map(a => a.mmr | 0));
    const mismatchA = mmrsA.length >= 2 && (Math.max.apply(null, mmrsA) - Math.min.apply(null, mmrsA) > RS_THRESHOLD);
    const meanA = mmrsA.reduce((a, b) => a + b, 0) / (mmrsA.length || 1);
    const shielded = new Set();
    for (const s of (leaverSeats || [])) for (const p of parts) {
      if (teamOf(p.seat) === teamOf(s) && (p.seat | 0) !== (s | 0)) shielded.add(p.steamID);
    }
    const out = {};
    for (const p of parts) {
      const t = teamOf(p.seat), won = t === winTeam;
      const tAvgLp = agg[t].n ? agg[t].lp / agg[t].n : (p.lp | 0);
      const tAvgMmr = agg[t].n ? agg[t].mmr / agg[t].n : (p.mmr | 0);
      const tSeg = lpSeg(tAvgLp), ownSeg = lpSeg(p.lp | 0);
      const base = won ? tSeg.win : -tSeg.loss;
      let factor = 1, flag = 0, protectedLoss = false;
      const why = [];   // O774: which rule shaped this delta (labels only, never read by the settle)
      if (mismatch && tAvgMmr < mean) {                          // weak team
        if (won) { factor = RS_UPSET_BONUS; flag = 1; why.push('upset'); }
        else { factor = tSeg.rs; protectedLoss = true; why.push('mismatch'); }
      } else if ((mismatch && tAvgMmr > mean) || (won && mismatchA && tAvgMmr > meanA)) {   // strong team (Q167: or the weak team left)
        why.push(won ? 'expected' : 'upset_loss');
        // Q160 layer 5 (cloud audit): an expected win compresses at the TEAM-average tier for every member, the strong one
        // included. Holding him at his own tier instead (the rework's fourth layer) cut a grandmaster carrying zero-points
        // accounts, but cut the honest grandmaster queued with lower-tier friends as hard (a gold friend, 6 wins in 8: -12
        // where this gives +12; a master with a diamond friend +20 for +30), and the carry came back once the zeros were
        // walked to silver (14 matches). Architecture decision 10 keeps the honest side whole: the carry is a known residual
        // (+4 a 2V2 win, +9 a 3V3), as the third farming form is, held by O226 and the manual top-100 check.
        // Q167 (cloud audit): an expected win stays an expected win when the weak team leaves at the start (the second half
        // of the condition). The spread and the mean see the present only, so two grandmasters whose two zero-points
        // opponents wrote the level-1 start and left (convicted leavers, -100 points each at the floor) took the full team
        // win every match (+10): no spread among the present. With the losing team's leavers counted at their pre-match
        // rating (mismatchA, meanA) the win is the expected one and takes this same compression, written once here so the
        // strong-team factor of whatever base this sits on serves both. Only this case reads them: the weak team, an upset
        // and a loss keep the present-only reading (a leaver's rating says nothing about how the players who stayed did).
        factor = won ? tSeg.rs : RS_STRONG_UPSET_LOSS;
      }
      if (!won && shielded.has(p.steamID)) { factor = Math.min(factor, ownSeg.rs); protectedLoss = true; why.push('teammate_left'); }
      let normalDelta = Math.round(base / 2 + ownSeg.drip);
      let adjDelta = Math.round(base * factor / 2 + ownSeg.drip);
      // Q183 (cloud audit): the shielded loser also gets the full-team reading -- his team's convicted leavers counted at their
      //   pre-match rating and points (absent), as if they had stayed and lost with him: the points of the normal finish --
      //   and keeps whichever of the two costs him less. Read on the present only, a loser whose higher-tier teammate left
      //   at the start lost up to 2 points more than if that teammate had stayed and lost (the team-average tier compresses
      //   the loss, his own does not); so: never more than staying with the team, never more than before. (Capping the
      //   full-team reading by his own tier as well would add at most a point in some cases: left out, the rule stays "the
      //   better of before and the normal finish".) The leaver himself pays as before (the leave and its points).
      const mine = (!won && shielded.has(p.steamID)) ? (absent || []).filter(a => teamOf(a.seat) === t) : [];
      if (mine.length) {
        let fn = agg[t].n, fl = agg[t].lp, fm = agg[t].mmr;
        for (const a of mine) { fn++; fl += a.lp | 0; fm += a.mmr | 0; }
        const fSeg = lpSeg(fl / fn), fAvg = fm / fn;
        const fMmrs = mmrs.concat(mine.map(a => a.mmr | 0));
        const fMis = Math.max.apply(null, fMmrs) - Math.min.apply(null, fMmrs) > RS_THRESHOLD;
        const fMean = fMmrs.reduce((x, y) => x + y, 0) / fMmrs.length;
        let ff = 1;
        if (fMis && fAvg < fMean) ff = fSeg.rs;                   // the weak team, its loss compressed
        else if (fMis && fAvg > fMean) ff = RS_STRONG_UPSET_LOSS; // the strong team, a mild upset loss
        const fAdj = Math.round(-fSeg.loss * ff / 2 + ownSeg.drip);
        if (fAdj > adjDelta) { adjDelta = fAdj; normalDelta = Math.round(-fSeg.loss / 2 + ownSeg.drip); }
      }
      if (protectedLoss && normalDelta < 0 && flag === 0) flag = 2;
      out[p.steamID] = { adjDelta, flag, normalDelta, won, why };   // won feeds the series clamp at settle; why = O774 labels
    }
    return out;
  }
  // ---- the plan of one ranked match, as the settle calls it (O480: the settle, lateShadow and the client go through here) ----
  //   parts: the rated players [{ steamID, seat, mmr, rank, lp }]; team (team codes only): { scores: the full frozen seat vector,
  //   leaverSeats: the convicted / named absent seats (their teammates' shield), winTeam: the sub-score winner of a mode-2 code
  //   (null = the money fallback of a mode-1 code), absent: the losing team's leavers at their pre-match rating and points (Q167),
  //   finished: seats seen agreeing whose record is gone (Q183) }. An FFA code reads its own party bits. Returns the plan rows
  //   ({ [steamID]: { adjDelta, flag, normalDelta, won } }) or null (no plan applies: the plain lpDelta at each own place).
  function matchPlan(parts, matchType, team) {
    const t = team || {};
    return isTeamMt(matchType)
      ? teamLpPlan(parts, matchType, t.scores, t.leaverSeats, t.winTeam, t.absent, t.finished)
      : reducedStakesPlan(parts, matchType, premadeMaskOf(matchType), premadeTrioAtOf(matchType));
  }
  // ---- the points line of one rated player at a ranked settle (O480: one composition for the settle, lateShadow and the client) ----
  //   cur: his points before the match; plan: his row of the match plan (reducedStakesPlan / teamLpPlan: { adjDelta, flag, won }),
  //   null / undefined when no plan applies (a fair all-solo match: the plain lpDelta at his own place); rank / pc: his place and the
  //   number of rated players (plain path only); seeded: this settle seeded his points (his first settle this season).
  //   The series clamp is skipped for a PROTECTED end (flag 2 keeps its compressed loss) and for a seeded player (the seed is his
  //   placement already); the result stays on the board's 0..LP_MAX.
  //   Returns { d0: the delta before the series clamp, d: after it, won: the side the clamp read, nv: his new points }.
  function settleLine(cur, plan, rank, pc, seeded) {
    const d0 = plan ? plan.adjDelta : lpDelta(cur, rank, pc);
    const won = plan ? !!plan.won : ((rank | 0) <= (pc + 1) / 2);
    const d = ((plan && plan.flag === 2) || seeded) ? d0 : crosslineDelta(cur, d0, won);
    return { d0, d, won, nv: Math.max(0, Math.min(LP_MAX, cur + d)) };
  }
  // ---- the rating the points plan reads, on the player's rating-board row (O480) ----
  //   rating-board details = [RATING_MAGIC, rating, RULES_VER, 0]: rating = the display rating the next ranked settle feeds this
  //   player's mismatch check (his ranked rating; the stored one until he has one). The row's score stays the stored rating after
  //   the repeat-group decay, a different number. A row written before O480 carries no details: ratingDetailsOf() gives null and
  //   the reader falls back to the score.
  const RATING_MAGIC = 0xCB;   // (0xCD / 0xCE are taken: card_box claims / redeem_box wants; the companion repo keeps the magic registry)
  function ratingDetails(rating) { return [RATING_MAGIC, rating | 0, RULES_VER, 0]; }
  function ratingDetailsOf(det) {
    if (!Array.isArray(det) || det.length < 3 || (det[0] & 0xff) !== RATING_MAGIC) return null;
    return { rating: det[1] | 0, rulesVer: det[2] | 0 };
  }
  // ---- points receipts on the player's own points-board row (O480) ----
  //   lp row details = [the RS reveal slot: 6 ints (an RS_MAGIC reveal, or six zeros)] + [RECEIPT_MAGIC, n, (matchHash, delta,
  //   flags) x n]: the n <= RECEIPT_CAP newest matches that moved, or voided, the player's points on this board, newest first.
  //   delta = the net change the match caused on this board while its entry stays in the ring (a fine, its refund and the settle
  //   of the same match add up on one entry); flags: the low byte = RECEIPT_F bits, bits 8..23 = the RULES_VER of the job that
  //   touched the entry last. A row from before O480 (no details, or the reveal alone) reads as an empty ring.
  //   RECEIPT_F: RS = the settle's reveal flag (1 upset, 2 protected); LEAVE = a leaver fine is in delta; SERIES = the series clamp
  //   moved the settle's delta; SEEDED = the settle seeded his points (delta counts from the seed, not from a row); VOID = the match
  //   moved nobody's points (a consensus void, or never settled); RULES = the entry after it in the ring was written under
  //   another RULES_VER (the first receipt after a rules change); COMP = a compensation (reserved).
  const RECEIPT_MAGIC = 0xC6, RECEIPT_CAP = 8, RS_SLOT = 6;
  const RECEIPT_F = Object.freeze({ RS: 3, LEAVE: 4, SERIES: 8, SEEDED: 16, VOID: 32, RULES: 64, COMP: 128 });
  function receiptVer(flags) { return ((flags | 0) >>> 8) & 0xffff; }
  // { rs: the 6-int reveal or null, ring: [{ mh, delta, flags }] newest first } of a row's details
  function lpDetailsOf(det) {
    const d = Array.isArray(det) ? det : [];
    const rs = (d.length >= RS_SLOT && (d[0] & 0xff) === RS_MAGIC) ? d.slice(0, RS_SLOT).map((x) => x | 0) : null;
    const ring = [];
    if (d.length >= RS_SLOT + 2 && (d[RS_SLOT] & 0xff) === RECEIPT_MAGIC) {
      const n = Math.min(RECEIPT_CAP, Math.max(0, d[RS_SLOT + 1] | 0));
      for (let i = 0; i < n && RS_SLOT + 4 + 3 * i < d.length; i++) {
        const o = RS_SLOT + 2 + 3 * i;
        ring.push({ mh: d[o] | 0, delta: d[o + 1] | 0, flags: d[o + 2] | 0 });
      }
    }
    return { rs, ring };
  }
  // the details a points write carries: the reveal slot (rs, or zeros) then the ring
  function lpDetails(rs, ring) {
    const r = (ring || []).slice(0, RECEIPT_CAP);
    const out = (rs && rs.length >= RS_SLOT) ? rs.slice(0, RS_SLOT).map((x) => x | 0) : [0, 0, 0, 0, 0, 0];
    out.push(RECEIPT_MAGIC, r.length);
    for (const e of r) out.push(e.mh | 0, e.delta | 0, e.flags | 0);
    return out;
  }
  // one event of match mh on the ring: change = the points it moved (0 for a void); set / clear = the RECEIPT_F bits it sets /
  //   clears (a settle passes clear 0xff: its flags replace the entry's; a refund clears LEAVE). The entry moves to the front
  //   carrying the net delta; past RECEIPT_CAP the oldest drops. Returns a new ring.
  function receiptPush(ring, mh, change, set, clear) {
    const r = Array.isArray(ring) ? ring : [];
    const key = mh | 0;
    const old = r.find((e) => (e.mh | 0) === key) || null;
    const rest = r.filter((e) => (e.mh | 0) !== key);
    let low = (((old ? (old.flags & 0xff) & ~(clear | 0) : 0) | (set | 0)) & 0xff) & ~RECEIPT_F.RULES;
    if (rest.length && receiptVer(rest[0].flags) !== (RULES_VER & 0xffff)) low |= RECEIPT_F.RULES;
    const e = { mh: key, delta: ((old ? old.delta | 0 : 0) + (change | 0)) | 0, flags: low | ((RULES_VER & 0xffff) << 8) };
    return [e].concat(rest).slice(0, RECEIPT_CAP);
  }
  // the receipt of match mh on a row's details, or null
  function receiptOf(det, mh) { return lpDetailsOf(det).ring.find((e) => e.mh === (mh | 0)) || null; }

  // ===== O728 endless competitive points (user calls 2026-11-08; companion KNIFE_O728_ENDLESS_LP_PLAN sections 2-3) =====
  // A competitive endless run of a family (solo / duo / trio / quad) settles on the versus points scale 0..LP_MAX with the versus
  //   tier table LP_SEG, built like a versus match (the user's call 2026-11-08, "the same structure as versus"): versus matches a
  //   player against his level, so he wins about half; here the target comes from his own level the same way -- the base line is
  //   TARGET_Q of his hidden skill (the trimmed mean depth of the last WINDOW runs: about half the runs pass it), moved by an offset
  //   of -SPREAD..+SPREAD drawn from the run seed. A run that passes level T gains points, one that does not loses -- the sign never
  //   flips. The size is the tier's win (or loss) scaled by two per-mille factors, plus the tier's drip, all x MUL (an endless run
  //   is several versus matches long), capped at SWING_CAP:
  //     gap:   the hidden skill tier above the points tier -> a pass x GAP_UP, a miss x GAP_DOWN (a player rated too low climbs
  //            faster); below it -> the reverse, at master and up only (below master grinding always climbs: the win / loss table
  //            gains more than it takes, and the drip); the same tier (or no skill yet) -> 1000;
  //     stake: a harder target (offset o > 0) gains more and loses less: a pass 1000 + STAKE_STEP x o, a miss 1000 - STAKE_STEP x o.
  //   The run settles through settleLine (the series clamp: a pass in the promotion band always crosses up, a miss in the relegation
  //   band always crosses down) except under the demotion protection: a miss whose hidden skill tier is at or above the points tier
  //   skips the clamp and never drops below the floor of the tier. The master gate: below GATE_TIER (master) in hidden skill, the
  //   points of a player under master stop BOUNDARY_MARGIN + 1 under the master line (no master promotion match); a player already
  //   at master or up is held by the gap factor instead. The first MIN_RUNS runs of a season are placement (no points; their
  //   target from the runs so far, the silver line before any); the last one seeds the points from the hidden skill
  //   (endlessSeedLp). All pure: the job settles the runs in start order.
  // ELP.PRIOR: the loose pass lines (levels, bronze .. grandmaster) per family: what a typical player of each tier reaches. They place
  //   a player's hidden skill in a tier (the gap factor, the protection, the gate, the placement seed); the job blends them into
  //   the live lines as players place and publishes them every day in the tier-cut table v2 (elpTableDetails) the client reads.
  //   Moving a constant of ELP other than PRIOR moves settled runs: ELP.VER + 1 in the same change (the table carries it; a client
  //   built with other constants shows "to be confirmed"). RULES_VER stays the versus rules version.
  // MUL / TARGET_Q: tuned by test/endless-lp-sim.js (2026-11-08): about half the runs pass; from placement to diamond about 150 runs
  //   for a silver-level player, 80 gold, 40 platinum, 20 diamond (the user's table); a grandmaster drifts nowhere (zero-sum top).
  // Invariant (test/endless-lp.js): one run never moves the points by BOUNDARY_MARGIN or more (SWING_CAP), so a tier line is
  //   crossed in a series run only.
  // O803 (2026-11-09, VER 3): a team run (duo / trio / quad) has ONE target for every seat, read from the team's usual level
  //   teamHiddenOf(the hidden skills of the roster) in the hidden100 position of targetLineOf / targetOf; the points of each seat
  //   (endlessDelta / endlessSettle: the gap factor, the protection, the gate), the placement seed and the skill tier keep reading
  //   his own skill. Solo (and the couch pair, one account) are unchanged: the roster is the player alone, teamHiddenOf([h]) = h.
  const ELP = Object.freeze({
    WINDOW: 10, MIN_RUNS: 5, TRIM: 1, GAP_UP: 1500, GAP_DOWN: 500, STAKE_STEP: 100, SPREAD: 2, SEED_CAP: 3200, VER: 3,
    MUL: Object.freeze([850, 850, 1500, 3100, 2800, 2800, 2800]), TARGET_Q: 990, SWING_CAP: 119, GATE_TIER: 5,
    // 2026-11-08 board read (best run per player; a usual run is about 0.7 of the best): playtest solo n 74 -- top 60 % 7, 35 % 13,
    //   20 % 20, 10 % 30, 4 % 63; trial solo n 318 (capped at 20) -- top 80 % 2, 60 % 7, 35 % 14. Bronze is 2 (0.7 x the top-80 %
    //   best of 2..3); the team lines are solo x 1.6 (trial team bests sit far above them, the lines stay loose).
    // O781 (client 2026-11-09, ships with the EA package): the competitive endless curve got a deep wall (past level 30 the goal ratio
    //   climbs 25 per mille a level up to 2000; teams pay x1.06 / 1.12 / 1.18 for 2 / 3 / 4 seats, phased in over levels 10..30). Before
    //   it a player averaging 70 % of the field never hit a wall, so the top lines only measured play time. The lines keep their level
    //   up to platinum (levels 30 and under did not change for one seat) and the diamond / master / grandmaster lines move under the new
    //   wall: each depth the old curve put a constant-efficiency player at maps to that player's wall on the new one (the client's
    //   test/endless-curve.js T6 pins the grandmaster line under the 0.75-efficiency wall and the top gaps >= 2 x SPREAD + 1). The team
    //   lines collapse to about solo x 1.05 at the top (the team factor offsets the denser field). Only PRIOR moved: no ELP.VER bump
    //   (settled runs stay as they are; the daily table blends these with the live lines).
    PRIOR: Object.freeze({
      solo: Object.freeze([2, 6, 10, 15, 24, 35, 42]),
      duo: Object.freeze([3, 10, 16, 24, 32, 38, 44]),
      trio: Object.freeze([3, 10, 16, 24, 32, 38, 44]),
      quad: Object.freeze([3, 10, 16, 24, 32, 38, 44]),
    }),
    ROW_MAGIC: 0xEE, ROW_VER: 1,   // the family points row (elpRowDetails)
    TC_MAGIC: 0xEC, TC_VER: 2,     // the published pass-line table (elpTableDetails; v1 = the O103 cut table, read as no table)
    PROTECT_RS: 2,                 // a protected miss carries the RS value 2 (protected, as a versus row) on its receipt
  });
  const ELP_FAMS = Object.freeze(['solo', 'duo', 'trio', 'quad']);
  // the tier index (0 bronze .. 6 grandmaster) of a points value
  function lpTierIdx(lp) { let i = 0; for (let k = 0; k < LP_SEG.length; k++) if ((lp | 0) >= LP_SEG[k].min) i = k; return i; }
  function elpHash(s) { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
  const elpLinesOk = (pass) => Array.isArray(pass) && pass.length >= LP_SEG.length;
  // the hidden skill x 100 of a family's runs this season. depths = the levels each run passed, NEWEST first; the first WINDOW count.
  //   From MIN_RUNS runs the TRIM highest and the TRIM lowest leave before the mean. Fewer runs than minRuns (default MIN_RUNS) = null;
  //   the placement target reads it with minRuns 1 (the plain mean of the runs so far).
  function hiddenOf(depths, minRuns) {
    const d = (Array.isArray(depths) ? depths : []).slice(0, ELP.WINDOW).map((x) => Math.max(0, x | 0));
    const need = minRuns == null ? ELP.MIN_RUNS : Math.max(1, minRuns | 0);
    if (!d.length || d.length < need) return null;
    const use = d.length >= ELP.MIN_RUNS ? d.slice().sort((a, b) => a - b).slice(ELP.TRIM, d.length - ELP.TRIM) : d;
    let sum = 0; for (const x of use) sum += x;
    return Math.round(sum * 100 / use.length);
  }
  // O803: the usual level of a team: list = the hidden skill (hidden100, or null = no run of the family this season) of every
  //   seat of the roster, in any order. The nulls leave; the rest average with equal weights, rounded to the nearest integer;
  //   nobody with a skill = null (the target then falls to the silver line, as a first placement run). One account = its own skill.
  function teamHiddenOf(list) {
    const xs = (Array.isArray(list) ? list : []).filter((x) => x != null).map((x) => x | 0);
    if (!xs.length) return null;
    let sum = 0; for (const x of xs) sum += x;
    return Math.round(sum / xs.length) | 0;
  }
  // the tier (0..6) a hidden skill sits in: the pass line nearest to it, the lower tier on a tie. No skill (or no lines) = null.
  function tierOfHidden(hidden100, pass) {
    if (hidden100 == null || !elpLinesOk(pass)) return null;
    let at = 0, best = Infinity;
    for (let k = 0; k < LP_SEG.length; k++) { const g = Math.abs((hidden100 | 0) - (pass[k] | 0) * 100); if (g < best) { best = g; at = k; } }
    return at;
  }
  // the target offset of a run, -SPREAD..+SPREAD (> 0 = a harder target), from its run seed (signed or unsigned 32-bit: the same)
  function targetOffset(runSeed) { return (elpHash((runSeed >>> 0) + ':tgt') % (2 * ELP.SPREAD + 1)) - ELP.SPREAD; }
  // the skill tier the rules read (0..6, or null without a skill): the tier of the nearest pass line (tierOfHidden), except that
  //   GATE_TIER (master) and up count only once the skill reached that tier's own line -- the gate: a lucky window of ten runs
  //   that sits nearer the master line than the diamond one does not open master
  function skillTierOf(hidden100, pass) {
    const ht = tierOfHidden(hidden100, pass);
    if (ht == null || ht < ELP.GATE_TIER) return ht;
    let at = ELP.GATE_TIER - 1;
    for (let k = ELP.GATE_TIER; k <= ht; k++) { if ((hidden100 | 0) >= (pass[k] | 0) * 100) at = k; else break; }
    return at;
  }
  // the base line of a run's target, before its offset (the client's dial sits its middle here): TARGET_Q of the hidden skill hidden100
  //   (a placed run: hiddenOf of the runs before it; a placement run: hiddenOf of the runs so far with minRuns 1; a team run, O803:
  //   teamHiddenOf over the roster), the silver line of pass with none yet. lpBefore and placing no longer move it (kept in the
  //   signature: version 1 read them).
  function targetLineOf(lpBefore, pass, hidden100, placing) {
    void lpBefore; void placing;
    return hidden100 == null ? (elpLinesOk(pass) ? (pass[1] | 0) : 0) : Math.round((hidden100 | 0) * ELP.TARGET_Q / 100000);
  }
  // the target T of a run (the run passes when it passes level T): the base line plus the run's offset, at least 1
  function targetOf(lpBefore, pass, runSeed, hidden100, placing) {
    return Math.max(1, targetLineOf(lpBefore, pass, hidden100, placing) + targetOffset(runSeed));
  }
  // the points of one settled run before the series clamp: { d (never 0: a pass >= 1, a miss <= -1; |d| <= SWING_CAP), base (the
  //   tier's win or -loss), gap, stake (per mille), drip, mul (the tier's MUL), st (the skill tier, skillTierOf, or null), protect
  //   (the demotion protection holds: a miss with the skill tier >= the points tier) }
  function endlessDelta(lpBefore, isPass, hidden100, pass, offset) {
    const seg = lpSeg(lpBefore | 0), cur = lpTierIdx(lpBefore), ht = tierOfHidden(hidden100, pass), st = skillTierOf(hidden100, pass);
    const o = Math.max(-ELP.SPREAD, Math.min(ELP.SPREAD, offset | 0));
    const base = isPass ? seg.win : -seg.loss;
    let gap = 1000;
    if (ht != null && ht > cur) gap = isPass ? ELP.GAP_UP : ELP.GAP_DOWN;                                    // rated too low: climbs faster
    else if (ht != null && ht < cur && cur >= ELP.GATE_TIER) gap = isPass ? ELP.GAP_DOWN : ELP.GAP_UP;       // master and up only: rated too high
    const stake = isPass ? 1000 + ELP.STAKE_STEP * o : 1000 - ELP.STAKE_STEP * o, mul = ELP.MUL[cur];
    let d = Math.round((base * gap * stake / 1000000 + seg.drip) * mul / 1000);
    d = Math.max(-ELP.SWING_CAP, Math.min(ELP.SWING_CAP, d));
    d = isPass ? Math.max(1, d) : Math.min(-1, d);
    return { d, base, gap, stake, drip: seg.drip, mul, ht, st, protect: !isPass && (cur < ELP.GATE_TIER || (ht != null && ht >= cur)) };
  }
  // the points line of one settled run: { d0 (endlessDelta's d), d (the change after the clamp / the protection / the gate), nv (the new
  //   points, 0..LP_MAX), series (boundaryOf the points before: 'promotion' / 'relegation' / null), clamped (the series clamp moved
  //   the delta: the receipt's SERIES), protect (the protection moved the result: the clamp skipped and / or the tier floor held --
  //   the receipt's PROTECT_RS; a protected miss at the floor changes nothing, d 0), gated (the gate held the points BOUNDARY_MARGIN
  //   + 1 under the line of a tier the skill does not reach yet, master or grandmaster: no promotion match into it), plan
  //   (endlessDelta's result) }
  function endlessSettle(lpBefore, isPass, hidden100, pass, offset) {
    const cur = Math.max(0, Math.min(LP_MAX, lpBefore | 0));
    const r = endlessDelta(cur, isPass, hidden100, pass, offset);
    const plain = settleLine(cur, { adjDelta: r.d, flag: 0, won: !!isPass }, 0, 0, false);
    let nv = plain.nv, protect = false, gated = false;
    if (r.protect) {
      const pv = Math.max(LP_SEG[lpTierIdx(cur)].min, Math.max(0, Math.min(LP_MAX, cur + r.d)));
      if (pv !== plain.nv) { nv = pv; protect = true; }
    }
    const top = Math.max(ELP.GATE_TIER - 1, r.st == null ? 0 : r.st, lpTierIdx(cur));   // the highest tier the points may reach: the skill's (every tier under master), or the one they are in
    if (top < LP_SEG.length - 1) {
      const line = LP_SEG[top + 1].min, cap = line - BOUNDARY_MARGIN - 1;
      if (cur < line && nv > Math.max(cur, cap)) { nv = Math.max(cur, cap); gated = true; }
    }
    return { d0: r.d, d: nv - cur, nv, series: boundaryOf(cur), clamped: !protect && !gated && plain.d !== plain.d0, protect, gated, plan: r };
  }
  // the points a finished placement seeds from the hidden skill: between the pass lines k and k+1 the skill interpolates over the
  //   tier's width, kept out of both series bands (BOUNDARY_MARGIN + 1 from either line; bronze has no relegation band and starts
  //   at 0), capped at SEED_CAP (mid platinum: diamond and up are climbed, as the versus LP_SEED.CAP). No skill / no lines = 0.
  function endlessSeedLp(hidden100, pass) {
    if (hidden100 == null || !elpLinesOk(pass)) return 0;
    const h = hidden100 | 0, top = LP_SEG.length - 1;
    if (h >= (pass[top] | 0) * 100) return ELP.SEED_CAP;
    let k = 0; for (let i = 0; i < top; i++) if (h >= (pass[i] | 0) * 100) k = i;
    const lo = LP_SEG[k].min, hi = LP_SEG[k + 1].min, span = Math.max(1, ((pass[k + 1] | 0) - (pass[k] | 0)) * 100);
    let lp = lo + Math.round((h - (pass[k] | 0) * 100) * (hi - lo) / span);
    lp = Math.max(k === 0 ? 0 : lo + BOUNDARY_MARGIN + 1, Math.min(hi - BOUNDARY_MARGIN - 1, lp));
    return Math.max(0, Math.min(ELP.SEED_CAP, lp));
  }
  // the points row of an endless family board (endless_rating_<fam>[_test][_s<N>]; the job writes it, the client reads it). score =
  //   the points (no row before the placement ends). details = [ROW_MAGIC | ROW_VER << 8, runs this season, hidden100 (-1 = fewer than
  //   MIN_RUNS runs in the window), points tier 0..6, placed (1), RECEIPT_MAGIC, n, (runId, delta, flags) x n]: the receipt ring of
  //   receiptPush with mh = the run seed | 0 (the record's d[4]; both sides know it). Receipt flags: RS bits PROTECT_RS on a protected miss,
  //   SERIES when the clamp moved the delta, SEEDED on the placement's last run, VOID on a run refunded after a conviction.
  function elpRowDetails(row, ring) {
    const r = (ring || []).slice(0, RECEIPT_CAP), x = row || {};
    const out = [ELP.ROW_MAGIC | (ELP.ROW_VER << 8), x.n | 0, x.hidden100 == null ? -1 : (x.hidden100 | 0), x.tier | 0, x.placed ? 1 : 0, RECEIPT_MAGIC, r.length];
    for (const e of r) out.push(e.mh | 0, e.delta | 0, e.flags | 0);
    return out;
  }
  // { n, hidden100 (or null), tier, placed, ring: [{ mh, delta, flags }] newest first } of a row's details; another layout = null
  function elpRowOf(det) {
    if (!Array.isArray(det) || det.length < 7 || ((det[0] | 0) & 0xff) !== ELP.ROW_MAGIC || (((det[0] | 0) >>> 8) & 0xff) !== ELP.ROW_VER) return null;
    const ring = [];
    if (((det[5] | 0) & 0xff) === RECEIPT_MAGIC) {
      const n = Math.min(RECEIPT_CAP, Math.max(0, det[6] | 0));
      for (let i = 0; i < n && 9 + 3 * i <= det.length; i++) { const o = 7 + 3 * i; ring.push({ mh: det[o] | 0, delta: det[o + 1] | 0, flags: det[o + 2] | 0 }); }
    }
    return { n: det[1] | 0, hidden100: (det[2] | 0) < 0 ? null : (det[2] | 0), tier: det[3] | 0, placed: (det[4] | 0) === 1, ring };
  }
  // the receipt of a run on a family row's details (runId here = the run seed | 0), or null
  function elpReceiptOf(det, runId) { const r = elpRowOf(det); return r ? (r.ring.find((e) => e.mh === (runId | 0)) || null) : null; }
  // the published pass-line table (tier-cut carrier v2 on endless_tiercut; the job writes it once a UTC day and at once when the
  //   season, a line or a rules constant moves). score = the UTC day YYYYMMDD; details = [TC_MAGIC | TC_VER << 8, season, VER, GAP_UP,
  //   GAP_DOWN, STAKE_STEP, SPREAD, (N, pass x 7) x ELP_FAMS] = 39 ints; N = the family's players placed this season.
  //   byFam = { fam: { N, pass } } (a missing family writes N 0 and its prior).
  function elpTableDetails(season, byFam) {
    const out = [ELP.TC_MAGIC | (ELP.TC_VER << 8), season | 0, ELP.VER, ELP.GAP_UP, ELP.GAP_DOWN, ELP.STAKE_STEP, ELP.SPREAD];
    for (const fam of ELP_FAMS) {
      const c = (byFam || {})[fam] || null, p = (c && elpLinesOk(c.pass)) ? c.pass : ELP.PRIOR[fam];
      out.push(c ? (c.N | 0) : 0);
      for (let k = 0; k < LP_SEG.length; k++) out.push(p[k] | 0);
    }
    return out;
  }
  // { day, season, ver, gapUp, gapDown, stakeStep, spread, rulesSame (the constants are this copy's), byFam } of a table row; a v1 row
  //   (the O103 cut table), another version or a short row = null (no table: the client shows "being rated")
  function elpTableOf(score, det) {
    const need = 7 + ELP_FAMS.length * (1 + LP_SEG.length);
    if (!Array.isArray(det) || det.length < need || ((det[0] | 0) & 0xff) !== ELP.TC_MAGIC || (((det[0] | 0) >>> 8) & 0xff) !== ELP.TC_VER) return null;
    const byFam = {}; let at = 7;
    for (const fam of ELP_FAMS) { byFam[fam] = { N: det[at] | 0, pass: det.slice(at + 1, at + 1 + LP_SEG.length).map((x) => x | 0) }; at += 1 + LP_SEG.length; }
    const t = { day: score | 0, season: det[1] | 0, ver: det[2] | 0, gapUp: det[3] | 0, gapDown: det[4] | 0, stakeStep: det[5] | 0, spread: det[6] | 0, byFam };
    t.rulesSame = t.ver === ELP.VER && t.gapUp === ELP.GAP_UP && t.gapDown === ELP.GAP_DOWN && t.stakeStep === ELP.STAKE_STEP && t.spread === ELP.SPREAD;
    return t;
  }
  // ---- the job's pulse (O480): one cron_pulse row per channel ----
  //   score = the unix minute a run of the job reached its end; details = [PULSE_MAGIC, RULES_VER]. A client reads it on idle
  //   screens: a pulse a few ticks old = the job is behind, a RULES_VER other than its own = the rules moved since its build.
  const PULSE_MAGIC = 0xCC;
  function pulseDetails() { return [PULSE_MAGIC, RULES_VER]; }
  function pulseOf(score, det) {
    if (!Array.isArray(det) || det.length < 2 || (det[0] & 0xff) !== PULSE_MAGIC) return null;
    return { minute: score | 0, rulesVer: det[1] | 0 };
  }
  // configure({ NAME: value }): the job hands its environment overrides in here (validate.js passes process.env.<NAME>). A missing,
  //   null or empty value keeps the default, anything else reads as Number(value) -- the reading of the job's old
  //   `Number(process.env.NAME || default)`. Returns the names whose value now differs from the default.
  function configure(o) {
    const v = (k) => ((o && o[k] != null && o[k] !== '') ? Number(o[k]) : DEFAULTS[k]);
    RS_THRESHOLD = v('RS_THRESHOLD'); RS_UPSET_BONUS = v('RS_UPSET_BONUS'); RS_STRONG_UPSET_LOSS = v('RS_STRONG_UPSET_LOSS');
    RS_SOLO_VS_TRIO = v('RS_SOLO_VS_TRIO'); RS_TRIO_WIN = v('RS_TRIO_WIN'); LEAVER_LP_PENALTY = v('LEAVER_LP_PENALTY');
    Object.assign(api, knobs());
    return Object.keys(DEFAULTS).filter((k) => !Object.is(api[k], DEFAULTS[k]));
  }
  function knobs() { return { RS_THRESHOLD, RS_UPSET_BONUS, RS_STRONG_UPSET_LOSS, RS_SOLO_VS_TRIO, RS_TRIO_WIN, LEAVER_LP_PENALTY }; }
  const api = Object.assign({
    RULES_VER, FIXTURES_HASH, DEFAULTS, configure,
    LP_MAX, LP_SEG, lpSeg, LP_SEED, seedLp, SOFT_RESET, softResetLp, seasonSeedLp, lpDelta,
    BOUNDARY_MARGIN, PROMO_LAND, RELEG_LAND, boundaryOf, crosslineDelta, matchPlan, settleLine,
    baseMt, premadeMaskOf, premadeTrioAtOf, teamSizeOfMt, teamOfSeat, appliesLp, isTeamMt,
    RANKED_SEAT_SHIFT, rankedSeatMaskOf, mtSansSeats, seatAppliesLp, anyAppliesLp,
    leaverLpPenalty, RS_MAGIC, reducedStakesPlan, teamLpPlan,
    RATING_MAGIC, ratingDetails, ratingDetailsOf,
    RECEIPT_MAGIC, RECEIPT_CAP, RS_SLOT, RECEIPT_F, receiptVer, lpDetailsOf, lpDetails, receiptPush, receiptOf,
    PULSE_MAGIC, pulseDetails, pulseOf,
    ELP, ELP_FAMS, lpTierIdx, hiddenOf, teamHiddenOf, tierOfHidden, skillTierOf, targetOffset, targetLineOf, targetOf, endlessDelta, endlessSettle, endlessSeedLp,
    elpRowDetails, elpRowOf, elpReceiptOf, elpTableDetails, elpTableOf,
  }, knobs());
  return api;
});
