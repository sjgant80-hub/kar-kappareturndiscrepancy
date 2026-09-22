'use strict';

// KappaReturnDiscrepancy — pure kernel.
//
// Instead of scoring aperiodicity via entropy or variance, this treats the
// return times to a kappa-band as a point process and asks whether they
// equidistribute (Weyl's criterion) or clump into a few bins (star
// discrepancy). A periodic driver returns to the band on a fixed schedule,
// so its (scaled, mod-1) return times pile onto a handful of points and the
// star discrepancy is large. A genuinely aperiodic-at-kappa process spreads
// its returns across [0,1) and the discrepancy shrinks toward the ideal
// uniform grid.
//
// Every exported function is total: malformed input returns
// { ok: false, why } instead of throwing. Nothing here does I/O.

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);

const DEFAULT_THETA = (Math.sqrt(5) - 1) / 2; // 1/phi — irrational scaling factor

/**
 * Is `value` inside the closed kappa-band [kappaLow, kappaHigh]?
 * Total: any non-numeric or malformed input simply yields false.
 */
export function inKappaBand(value, kappaLow, kappaHigh) {
  if (!isFiniteNumber(value) || !isFiniteNumber(kappaLow) || !isFiniteNumber(kappaHigh)) {
    return false;
  }
  if (kappaLow > kappaHigh) return false;
  return value >= kappaLow && value <= kappaHigh;
}

/**
 * Walk a fold-state sequence, find every index that lands in the kappa-band,
 * and return the gaps (return times) between consecutive band entries.
 */
export function extractReturnTimes(sequence, kappaLow, kappaHigh) {
  if (!Array.isArray(sequence)) {
    return { ok: false, why: 'sequence must be an array' };
  }
  if (!isFiniteNumber(kappaLow) || !isFiniteNumber(kappaHigh)) {
    return { ok: false, why: 'kappaLow/kappaHigh must be finite numbers' };
  }
  if (kappaLow > kappaHigh) {
    return { ok: false, why: 'kappaLow must be <= kappaHigh' };
  }
  if (sequence.length < 2) {
    return { ok: false, why: 'sequence too short to extract return times' };
  }

  const entryIndices = [];
  for (let i = 0; i < sequence.length; i++) {
    if (inKappaBand(sequence[i], kappaLow, kappaHigh)) entryIndices.push(i);
  }

  if (entryIndices.length < 3) {
    return { ok: false, why: 'fewer than 3 kappa-band entries; cannot form a return-time distribution' };
  }

  const returnTimes = [];
  for (let i = 1; i < entryIndices.length; i++) {
    returnTimes.push(entryIndices[i] - entryIndices[i - 1]);
  }
  return { ok: true, entryIndices, returnTimes };
}

/**
 * Map return times into [0,1) via x_i = frac(returnTime_i * theta).
 * theta defaults to 1/phi (irrational) so a periodic set of return times
 * clumps at a fixed offset instead of landing exactly on 0.
 */
export function fractionalReturns(returnTimes, theta = DEFAULT_THETA) {
  if (!Array.isArray(returnTimes) || returnTimes.length === 0) {
    return { ok: false, why: 'returnTimes must be a non-empty array' };
  }
  if (!isFiniteNumber(theta)) {
    return { ok: false, why: 'theta must be a finite number' };
  }
  const points = [];
  for (const r of returnTimes) {
    if (!isFiniteNumber(r)) {
      return { ok: false, why: 'returnTimes must contain only finite numbers' };
    }
    const scaled = r * theta;
    points.push(scaled - Math.floor(scaled));
  }
  return { ok: true, points };
}

/**
 * Star discrepancy D_N* of a finite point set in [0,1] (Niederreiter's
 * discrete formula). 0 = perfectly equidistributed; larger = more clumped.
 */
export function starDiscrepancy(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return { ok: false, why: 'points must be a non-empty array' };
  }
  for (const p of points) {
    if (!isFiniteNumber(p) || p < 0 || p > 1) {
      return { ok: false, why: 'points must be finite numbers in [0,1]' };
    }
  }
  const n = points.length;
  const sorted = [...points].sort((a, b) => a - b);
  let dPlus = -Infinity;
  let dMinus = -Infinity;
  for (let i = 0; i < n; i++) {
    const dp = (i + 1) / n - sorted[i];
    const dm = sorted[i] - i / n;
    // Math.max instead of a hand-rolled `if (x > best) best = x` loop:
    // the latter is an equivalent-mutant magnet (`>` vs `>=` never changes
    // the final max of a fixed set of numbers), so remove the branch itself
    // rather than try to test-kill an unkillable relational mutant.
    dPlus = Math.max(dPlus, dp);
    dMinus = Math.max(dMinus, dm);
  }
  return { ok: true, discrepancy: Math.max(dPlus, dMinus), n };
}

/**
 * End-to-end pipeline: fold-state sequence -> return times -> fractional
 * returns -> star discrepancy -> aperiodicity score (1 - discrepancy).
 * Higher score = more equidistributed = more aperiodic-at-kappa.
 */
export function kappaReturnAperiodicity(sequence, opts = {}) {
  const kappaLow = isFiniteNumber(opts.kappaLow) ? opts.kappaLow : 0.5;
  const kappaHigh = isFiniteNumber(opts.kappaHigh) ? opts.kappaHigh : 0.7;
  const theta = isFiniteNumber(opts.theta) ? opts.theta : DEFAULT_THETA;

  const rt = extractReturnTimes(sequence, kappaLow, kappaHigh);
  if (!rt.ok) return rt;

  const fr = fractionalReturns(rt.returnTimes, theta);
  if (!fr.ok) return fr;

  const disc = starDiscrepancy(fr.points);
  if (!disc.ok) return disc;

  return {
    ok: true,
    score: 1 - disc.discrepancy,
    discrepancy: disc.discrepancy,
    returnTimes: rt.returnTimes,
    entryIndices: rt.entryIndices,
    n: disc.n,
  };
}
