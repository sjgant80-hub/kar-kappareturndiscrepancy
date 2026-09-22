import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as K from './kernel.mjs';

function buildSequence(length, bandIndices, inVal = 0.6, outVal = 0.1) {
  const seq = new Array(length).fill(outVal);
  for (const i of bandIndices) seq[i] = inVal;
  return seq;
}

test('inKappaBand classifies values correctly and never throws on garbage', () => {
  assert.equal(K.inKappaBand(0.6, 0.5, 0.7), true);
  assert.equal(K.inKappaBand(0.9, 0.5, 0.7), false);
  assert.equal(K.inKappaBand(0.5, 0.5, 0.7), true); // lower boundary inclusive
  assert.equal(K.inKappaBand(0.7, 0.5, 0.7), true); // upper boundary inclusive
  // garbage: must degrade to false, never throw
  assert.equal(K.inKappaBand('nope', 0.5, 0.7), false);
  assert.equal(K.inKappaBand(NaN, 0.5, 0.7), false);
  assert.equal(K.inKappaBand(0.6, 0.9, 0.1), false); // inverted band
});

test('inKappaBand and extractReturnTimes treat kappaLow === kappaHigh as a valid single-point band', () => {
  // kappaLow === kappaHigh must NOT be rejected as "inverted" (that's kappaLow > kappaHigh only)
  assert.equal(K.inKappaBand(0.5, 0.5, 0.5), true);
  assert.equal(K.inKappaBand(0.50000001, 0.5, 0.5), false);

  const seq = buildSequence(10, [1, 4, 7], 0.6, 0.1);
  const rt = K.extractReturnTimes(seq, 0.6, 0.6);
  assert.equal(rt.ok, true);
  assert.deepEqual(rt.entryIndices, [1, 4, 7]);
  assert.deepEqual(rt.returnTimes, [3, 3]);
});

test('extractReturnTimes finds a perfectly periodic return pattern', () => {
  // band entries at 0,4,8,12,16,20 -> five gaps of exactly 4
  const seq = buildSequence(21, [0, 4, 8, 12, 16, 20]);
  const rt = K.extractReturnTimes(seq, 0.5, 0.7);
  assert.equal(rt.ok, true);
  assert.deepEqual(rt.entryIndices, [0, 4, 8, 12, 16, 20]);
  assert.deepEqual(rt.returnTimes, [4, 4, 4, 4, 4]);
});

test('extractReturnTimes reports ok:false on malformed input instead of throwing', () => {
  assert.deepEqual(K.extractReturnTimes(null, 0.5, 0.7), {
    ok: false,
    why: 'sequence must be an array',
  });
  // pin the exact error text, not just ok:false, so a mangled message string is caught
  assert.deepEqual(K.extractReturnTimes([0.1, 0.2, 0.3], 0.9, 0.1), {
    ok: false,
    why: 'kappaLow must be <= kappaHigh',
  });
  // only two band entries -> not enough to form a return-time distribution
  const tooFew = buildSequence(5, [0, 3]);
  assert.equal(K.extractReturnTimes(tooFew, 0.5, 0.7).ok, false);
});

test('extractReturnTimes distinguishes "too short" from "too few band entries" at the length=2 boundary', () => {
  assert.deepEqual(K.extractReturnTimes([0.6], 0.5, 0.7), {
    ok: false,
    why: 'sequence too short to extract return times',
  });
  // length === 2 must fall through the length check and fail on band-entry
  // count instead (max possible entries at length 2 is 2, still < 3)
  const lenTwo = K.extractReturnTimes([0.6, 0.6], 0.5, 0.7);
  assert.deepEqual(lenTwo, {
    ok: false,
    why: 'fewer than 3 kappa-band entries; cannot form a return-time distribution',
  });
});

test('starDiscrepancy pins the classic uniform-grid case', () => {
  const uniform = K.starDiscrepancy([0, 0.25, 0.5, 0.75]);
  assert.equal(uniform.ok, true);
  assert.equal(uniform.discrepancy, 0.25);

  const clumped = K.starDiscrepancy([0.25, 0.25, 0.25, 0.25]);
  assert.equal(clumped.ok, true);
  assert.equal(clumped.discrepancy, 0.75);
});

test('starDiscrepancy accepts the closed-interval boundary p === 1', () => {
  const result = K.starDiscrepancy([0, 1]);
  assert.equal(result.ok, true);
  assert.equal(result.discrepancy, 0.5);
});

test('kappaReturnAperiodicity scores a clumped periodic pattern lower than a spread one', () => {
  // clumped: gaps [4,4,4,4] * theta=0.0625 all fold to 0.25 -> maximally clumped
  const clumpedSeq = buildSequence(17, [0, 4, 8, 12, 16]);
  const clumped = K.kappaReturnAperiodicity(clumpedSeq, { kappaLow: 0.5, kappaHigh: 0.7, theta: 0.0625 });
  assert.equal(clumped.ok, true);
  assert.deepEqual(clumped.returnTimes, [4, 4, 4, 4]);
  assert.equal(clumped.discrepancy, 0.75);
  assert.equal(clumped.score, 0.25);

  // spread: gaps [4,8,12,16] * theta=0.0625 -> fractional points [0.25,0.5,0.75,0]
  const spreadSeq = buildSequence(41, [0, 4, 12, 24, 40]);
  const spread = K.kappaReturnAperiodicity(spreadSeq, { kappaLow: 0.5, kappaHigh: 0.7, theta: 0.0625 });
  assert.equal(spread.ok, true);
  assert.deepEqual(spread.returnTimes, [4, 8, 12, 16]);
  assert.equal(spread.discrepancy, 0.25);
  assert.equal(spread.score, 0.75);

  assert.ok(spread.score > clumped.score);
});

test('fractionalReturns and starDiscrepancy reject bad input without throwing', () => {
  assert.deepEqual(K.fractionalReturns([], 0.5), {
    ok: false,
    why: 'returnTimes must be a non-empty array',
  });
  assert.equal(K.fractionalReturns([1, 2, 'x'], 0.5).ok, false);
  assert.equal(K.starDiscrepancy([]).ok, false);
  assert.equal(K.starDiscrepancy([0.2, 1.5, 0.4]).ok, false);
});

// --- targeted mutation-gate kills below ---
// Each test here exists because the corresponding survivor produced the SAME
// observable output under the mutant as under the real kernel for every
// existing input (NaN/boolean coercion quirks, an unread array slot, or a
// golden-ratio identity) — so the input had to be chosen specifically to
// split the two behaviours apart.

test('extractReturnTimes never reads one past the last valid sequence index (line 52 off-by-one guard)', () => {
  // Out-of-bounds reads on a real array just yield `undefined`, which
  // inKappaBand degrades to `false` anyway -- so entryIndices/returnTimes
  // are IDENTICAL whether the loop stops at length-1 or length. Only a
  // Proxy that can *observe* the read distinguishes `i < length` from
  // `i <= length`. Array.isArray() unwraps proxies to their target, so this
  // still passes the kernel's `Array.isArray(sequence)` guard.
  const base = buildSequence(5, [0, 2, 4]);
  let readPastEnd = false;
  const seq = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop) && Number(prop) >= target.length) {
        readPastEnd = true;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const rt = K.extractReturnTimes(seq, 0.5, 0.7);
  assert.equal(rt.ok, true);
  assert.deepEqual(rt.entryIndices, [0, 2, 4]);
  assert.equal(readPastEnd, false);
});

test('extractReturnTimes rejects NaN kappaLow instead of silently treating it as finite (line 17 isFiniteNumber)', () => {
  // Number.isFinite(NaN) is false but typeof NaN === 'number' is true, so
  // `&&` -> `||` in isFiniteNumber makes isFiniteNumber(NaN) wrongly true.
  // Using NaN as a *comparison operand* elsewhere always yields false, which
  // masks the bug -- this only shows up as a different `why` message.
  const seq = buildSequence(10, [1, 4, 7]);
  const rt = K.extractReturnTimes(seq, NaN, 0.7);
  assert.deepEqual(rt, { ok: false, why: 'kappaLow/kappaHigh must be finite numbers' });
});

test('inKappaBand rejects a non-numeric value even when it coerces into range (line 26, first ||)', () => {
  // `true` is not a number per isFiniteNumber, but `true >= 0 && true <= 1`
  // coerces to `1 >= 0 && 1 <= 1` and would wrongly read as "in band" if the
  // guard's first `||` were `&&`.
  assert.equal(K.inKappaBand(true, 0, 1), false);
});

test('inKappaBand rejects a non-numeric kappaLow even when it coerces into range (line 26, second ||)', () => {
  // Same coercion trick, this time on kappaLow: `true` coerces to 1 in the
  // `value >= kappaLow` comparison, which would wrongly pass 1.5 as in-band.
  assert.equal(K.inKappaBand(1.5, true, 2), false);
});

test('extractReturnTimes rejects a non-numeric kappaLow (boolean) even when kappaHigh is valid (line 41)', () => {
  const seq = buildSequence(10, [1, 4, 7]);
  const rt = K.extractReturnTimes(seq, true, 1);
  assert.deepEqual(rt, { ok: false, why: 'kappaLow/kappaHigh must be finite numbers' });
});

test('starDiscrepancy rejects a non-number point that happens to coerce into [0,1] (line 99)', () => {
  // `true` coerces to 1 in both `p < 0` and `p > 1`, so it would slip past
  // validation entirely if the first `||` in the guard were `&&`.
  const result = K.starDiscrepancy([0.2, true, 0.4]);
  assert.deepEqual(result, { ok: false, why: 'points must be finite numbers in [0,1]' });
});

test('fractionalReturns falls back to the exact default theta = (sqrt(5)-1)/2, pinned with a non-integer return time (line 19)', () => {
  // DEFAULT_THETA's sibling constant (sqrt(5)+1)/2 differs from it by
  // exactly 1. Every real return time is an integer index-difference, and
  // frac(r*theta + r) === frac(r*theta) for integer r -- so the "-1"->"+1"
  // mutant is invisible through the normal integer pipeline. A non-integer
  // return time (valid input to fractionalReturns, which doesn't require
  // integrality) breaks that masking.
  const theta = (Math.sqrt(5) - 1) / 2;
  const scaled = 0.5 * theta;
  const expectedPoint = scaled - Math.floor(scaled);

  const result = K.fractionalReturns([0.5]);
  assert.equal(result.ok, true);
  assert.equal(result.points.length, 1);
  assert.equal(result.points[0], expectedPoint);
});
