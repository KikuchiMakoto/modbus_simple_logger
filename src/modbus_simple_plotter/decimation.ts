import type { DataPoint } from '../types';

export interface AxisDescriptor {
  readonly kind: 'time' | 'raw' | 'physical' | 'param';
  readonly index: number;
}

export type AxisAccessor = (point: DataPoint) => number;

/**
 * Returns an accessor for an axis descriptor, so the hot loops below do not
 * dispatch on `kind` per sample.
 */
export function getAxisAccessor(desc: AxisDescriptor): AxisAccessor {
  const index = desc.index;
  switch (desc.kind) {
    case 'time':
      return (p) => p.timestamp;
    case 'raw':
      return (p) => p.aiRaw[index] ?? 0;
    case 'physical':
      return (p) => p.aiPhysical[index] ?? 0;
    case 'param':
      return (p) => p.param[index] ?? 0;
    default:
      return () => 0;
  }
}

/** [outX, outY, xMin, xMax, yMin, yMax]. Extents are over finite values only. */
export type DecimationResult = [Float64Array, Float64Array, number, number, number, number];

/** Output cap as a multiple of the target. See decimate2DM4. */
export const DECIMATION_MAX_OUTPUT_RATIO = 1.5;

// Scratch buffers reused across calls. Four charts decimate one after another
// on the main thread on every redraw, and the buffer can hold 65,536 points;
// reallocating ~1.3 MB of typed arrays per chart per redraw is pure GC churn.
// Nothing here escapes: the returned arrays are always fresh copies.
let scratchX = new Float64Array(0);
let scratchY = new Float64Array(0);
let scratchValid = new Uint8Array(0);
let scratchBoundary = new Int32Array(0);

function ensureScratch(n: number): void {
  if (scratchX.length >= n) return;
  const size = Math.max(n, scratchX.length * 2, 1024);
  scratchX = new Float64Array(size);
  scratchY = new Float64Array(size);
  scratchValid = new Uint8Array(size);
  scratchBoundary = new Int32Array(size * 2 + 4);
}

/**
 * Chart M4 decimation for both time series and XY (parametric) curves.
 *
 * Splits the input into buckets by sample index and, within each bucket, keeps
 * the first/last sample and the Y extrema of every *valid run* — plus the X
 * extrema when X is not monotonic time, where a hysteresis loop turns around on
 * X as often as on Y. Points stay in source order, so loops are drawn in the
 * order they were traced; nothing is sorted by X.
 *
 * Invariant: between any two consecutive finite output points there is no
 * invalid input sample. A NaN in X or Y emits a single NaN gap marker so the
 * plotter breaks the line rather than bridging missing data.
 */
export function decimate2DM4(
  points: readonly DataPoint[],
  xDesc: AxisDescriptor,
  yDesc: AxisDescriptor,
  targetPoints: number,
): DecimationResult {
  const n = points.length;
  const getX = getAxisAccessor(xDesc);
  const getY = getAxisAccessor(yDesc);
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  if (n <= targetPoints) {
    const outX = new Float64Array(n);
    const outY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const x = getX(p);
      const y = getY(p);
      outX[i] = x;
      outY[i] = y;
      if (Number.isFinite(x)) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      if (Number.isFinite(y)) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
    return [outX, outY, xMin, xMax, yMin, yMax];
  }

  const fast = decimateFinite(points, getX, getY, xDesc.kind !== 'time', targetPoints);
  if (fast) return fast;

  ensureScratch(n);
  const xs = scratchX;
  const ys = scratchY;
  const valid = scratchValid;
  let monotonic = xDesc.kind === 'time';
  let prevX = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const x = getX(p);
    const y = getY(p);
    xs[i] = x;
    ys[i] = y;
    const fx = Number.isFinite(x);
    const fy = Number.isFinite(y);
    valid[i] = fx && fy ? 1 : 0;
    if (fx) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (monotonic) {
        if (x < prevX) monotonic = false;
        prevX = x;
      }
    } else {
      monotonic = false;
    }
    if (fy) {
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }

  const trackX = !monotonic;
  const { core, maxOutput, numBuckets, bucketSize } = layout(n, trackX, targetPoints);
  const activeBuckets = Math.min(numBuckets, Math.ceil(n / bucketSize));

  const outX = new Float64Array(maxOutput);
  const outY = new Float64Array(maxOutput);
  let out = 0;
  let lastEmitted = -1;
  let lastInvalid = -1;
  const bounds = scratchBoundary;
  const cand = new Int32Array(core);
  let keep = new Uint8Array(64);

  const emitRun = (start: number, end: number, invalidBefore: number): void => {
    if (invalidBefore > lastEmitted && out > 0) {
      outX[out] = NaN;
      outY[out] = NaN;
      out++;
    }
    let count = 0;
    cand[count++] = start;
    if (end - 1 !== start) {
      let yminI = start;
      let ymaxI = start;
      let xminI = start;
      let xmaxI = start;
      for (let i = start + 1; i < end; i++) {
        const y = ys[i];
        if (y < ys[yminI]) yminI = i;
        if (y > ys[ymaxI]) ymaxI = i;
        if (trackX) {
          const x = xs[i];
          if (x < xs[xminI]) xminI = i;
          if (x > xs[xmaxI]) xmaxI = i;
        }
      }
      cand[count++] = yminI;
      cand[count++] = ymaxI;
      if (trackX) {
        cand[count++] = xminI;
        cand[count++] = xmaxI;
      }
      cand[count++] = end - 1;
      for (let i = 1; i < count; i++) {
        const key = cand[i];
        let j = i - 1;
        while (j >= 0 && cand[j] > key) {
          cand[j + 1] = cand[j];
          j--;
        }
        cand[j + 1] = key;
      }
    }
    let prev = -1;
    for (let i = 0; i < count; i++) {
      const idx = cand[i];
      if (idx === prev) continue;
      outX[out] = xs[idx];
      outY[out] = ys[idx];
      out++;
      prev = idx;
    }
    lastEmitted = end - 1;
  };

  const costOf = (len: number): number => (len < core ? len : core) + 1;

  for (let b = 0; b < activeBuckets; b++) {
    const bStart = b * bucketSize;
    if (bStart >= n) break;
    const bEnd = Math.min(n, bStart + bucketSize);

    const invalidAtStart = lastInvalid;
    let portions = 0;
    let runStart = -1;
    for (let i = bStart; i < bEnd; i++) {
      if (valid[i]) {
        if (runStart < 0) runStart = i;
      } else {
        if (runStart >= 0) {
          bounds[portions * 2] = runStart;
          bounds[portions * 2 + 1] = i;
          portions++;
          runStart = -1;
        }
        lastInvalid = i;
      }
    }
    if (runStart >= 0) {
      bounds[portions * 2] = runStart;
      bounds[portions * 2 + 1] = bEnd;
      portions++;
    }
    if (portions === 0) continue;

    // This bucket may spend whatever is left after reserving one full run plus
    // marker (core + 1) for every active bucket still to come.
    const budget = maxOutput - out - (activeBuckets - b - 1) * (core + 1);
    let total = 0;
    for (let r = 0; r < portions; r++) total += costOf(bounds[r * 2 + 1] - bounds[r * 2]);

    if (total <= budget) {
      for (let r = 0; r < portions; r++) {
        const s = bounds[r * 2];
        emitRun(s, bounds[r * 2 + 1], s === bStart ? invalidAtStart : s - 1);
      }
      continue;
    }

    if (keep.length < portions) keep = new Uint8Array(portions * 2);
    keep.fill(0, 0, portions);
    let remaining = budget;
    for (;;) {
      let best = -1;
      let bestLen = 0;
      for (let r = 0; r < portions; r++) {
        if (keep[r]) continue;
        const len = bounds[r * 2 + 1] - bounds[r * 2];
        if (len > bestLen && costOf(len) <= remaining) {
          best = r;
          bestLen = len;
        }
      }
      if (best < 0) break;
      keep[best] = 1;
      remaining -= costOf(bestLen);
    }
    for (let r = 0; r < portions; r++) {
      if (!keep[r]) continue;
      const s = bounds[r * 2];
      const before = s === bStart ? invalidAtStart : s - 1;
      emitRun(s, bounds[r * 2 + 1], before);
    }
  }

  return [outX.subarray(0, out), outY.subarray(0, out), xMin, xMax, yMin, yMax];
}

function layout(n: number, trackX: boolean, targetPoints: number) {
  const core = trackX ? 6 : 4;
  const capacity = core + 2;
  const maxOutput = Math.max(capacity, Math.floor(targetPoints * DECIMATION_MAX_OUTPUT_RATIO));
  const numBuckets = Math.max(1, Math.floor(maxOutput / capacity));
  return { core, capacity, maxOutput, numBuckets, bucketSize: Math.ceil(n / numBuckets) };
}

function decimateFinite(
  points: readonly DataPoint[],
  getX: AxisAccessor,
  getY: AxisAccessor,
  trackX: boolean,
  targetPoints: number,
): DecimationResult | null {
  const n = points.length;
  const { maxOutput, numBuckets, bucketSize } = layout(n, trackX, targetPoints);
  const outX = new Float64Array(maxOutput);
  const outY = new Float64Array(maxOutput);
  const cand = [0, 0, 0, 0, 0, 0];
  let out = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let prevX = -Infinity;

  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSize;
    if (start >= n) break;
    const end = Math.min(n, start + bucketSize);

    const p0 = points[start];
    const x0 = getX(p0);
    const y0 = getY(p0);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
    if (!trackX) {
      if (x0 < prevX) return null;
      prevX = x0;
    }
    let ylo = y0;
    let yhi = y0;
    let xlo = x0;
    let xhi = x0;
    let yloI = start;
    let yhiI = start;
    let xloI = start;
    let xhiI = start;

    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      const x = getX(p);
      const y = getY(p);
      if (x - x !== 0 || y - y !== 0) return null;
      if (trackX) {
        if (x < xlo) { xlo = x; xloI = i; }
        else if (x > xhi) { xhi = x; xhiI = i; }
      } else {
        if (x < prevX) return null;
        prevX = x;
      }
      if (y < ylo) { ylo = y; yloI = i; }
      else if (y > yhi) { yhi = y; yhiI = i; }
    }

    if (ylo < yMin) yMin = ylo;
    if (yhi > yMax) yMax = yhi;
    if (trackX) {
      if (xlo < xMin) xMin = xlo;
      if (xhi > xMax) xMax = xhi;
    }

    let count = 0;
    cand[count++] = start;
    if (end - 1 !== start) {
      cand[count++] = yloI;
      cand[count++] = yhiI;
      if (trackX) {
        cand[count++] = xloI;
        cand[count++] = xhiI;
      }
      cand[count++] = end - 1;
      for (let i = 1; i < count; i++) {
        const key = cand[i];
        let j = i - 1;
        while (j >= 0 && cand[j] > key) {
          cand[j + 1] = cand[j];
          j--;
        }
        cand[j + 1] = key;
      }
    }
    let prev = -1;
    for (let i = 0; i < count; i++) {
      const idx = cand[i];
      if (idx === prev) continue;
      const p = points[idx];
      outX[out] = getX(p);
      outY[out] = getY(p);
      out++;
      prev = idx;
    }
  }

  if (!trackX) {
    xMin = getX(points[0]);
    xMax = getX(points[n - 1]);
  }
  return [outX.subarray(0, out), outY.subarray(0, out), xMin, xMax, yMin, yMax];
}

/**
 * Origami folding for the in-memory capture buffer.
 *
 * The existing history is reduced by exactly one half by retaining source
 * positions [0, 2, 4, ...]. The caller doubles the future intake stride at the
 * same time, so all channels and Parameters remain on one consistent sampling
 * grid without selecting peaks from one representative channel.
 */
export function foldDataBufferHalf(buffer: readonly DataPoint[]): DataPoint[] {
  const n = buffer.length;
  if (n <= 1) return buffer.slice();
  const result = new Array<DataPoint>(Math.ceil(n / 2));
  for (let source = 0, target = 0; source < n; source += 2, target += 1) {
    result[target] = buffer[source];
  }
  return result;
}
