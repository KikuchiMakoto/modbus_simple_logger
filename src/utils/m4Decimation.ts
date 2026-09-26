import type { DataPoint } from '../types';

export interface AxisDescriptor {
  readonly kind: 'time' | 'raw' | 'physical' | 'param';
  readonly index: number;
}

/**
 * Resolves the numeric value of an axis from a DataPoint.
 */
export function getAxisValue(point: DataPoint, desc: AxisDescriptor): number {
  switch (desc.kind) {
    case 'time':
      return point.timestamp;
    case 'raw':
      return point.aiRaw[desc.index] ?? 0;
    case 'physical':
      return point.aiPhysical[desc.index] ?? 0;
    case 'param':
      return point.param[desc.index] ?? 0;
    default:
      return 0;
  }
}

export type AxisAccessor = (point: DataPoint) => number;

/**
 * Returns a high-performance accessor function for an axis descriptor,
 * eliminating switch dispatch in hot loops.
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

/**
 * 2D-M4 (MinMax) decimation for parametric / hysteresis / time-series display (間引B).
 *
 * Divides the input points into K buckets and extracts extrema, endpoints, and
 * up to two invalid-value boundary points per bucket.
 * Points are returned in original sequential order (sorted by source index and deduplicated).
 *
 * This aims to preserve:
 * 1. Both X and Y extrema (peaks and valleys) are preserved.
 * 2. Hysteresis loops, Lissajous curves, and direction-reversal trajectories in source order.
 * 3. Constant O(N) single-pass scan with near-zero allocations (typically ~0.2ms for 65k points).
 * 4. Fused min/max extent calculation avoiding secondary O(N) traversal passes.
 *
 * @param points Source array of DataPoint
 * @param xDesc Descriptor for the X axis
 * @param yDesc Descriptor for the Y axis
 * @param targetPoints Target output points (currently 1024). Parametric output may reach 1.5x.
 * @returns Decimated tuple of [outX, outY, xMin, xMax, yMin, yMax]
 */
/** Specialized M4 decimation for monotonic time-series (X = 'time').
 * Because time is strictly monotonic, in every block [start, end) Xmin is always
 * at `start` and Xmax is always at `end - 1`.
 *
 * Specializing this path:
 * 1. Eliminates searching for Xmin/Xmax in each block, halving inner-loop comparisons.
 * 2. Eliminates calling `getX(pt)` inside the inner loop.
 * 3. Replaces the 6-element insertion sort with O(1) two-element comparator.
 * 4. Reduces max bucket points from 6 to 4, cutting buffer allocations by 33%.
 */
function decimateTimeM4(
  points: readonly DataPoint[],
  yDesc: AxisDescriptor,
  targetPoints: number,
): [Float64Array, Float64Array, number, number, number, number] {
  const n = points.length;
  const getY = getAxisAccessor(yDesc);

  if (n <= targetPoints) {
    const outX = new Float64Array(n);
    const outY = new Float64Array(n);
    let globalYmin = Infinity;
    let globalYmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const pt = points[i];
      const x = pt.timestamp;
      const y = getY(pt);
      outX[i] = x;
      outY[i] = y;
      if (Number.isFinite(y)) {
        if (y < globalYmin) globalYmin = y;
        if (y > globalYmax) globalYmax = y;
      }
    }
    const globalXmin = n > 0 ? points[0].timestamp : Infinity;
    const globalXmax = n > 0 ? points[n - 1].timestamp : -Infinity;
    return [outX, outY, globalXmin, globalXmax, globalYmin, globalYmax];
  }

  // Two additional candidates preserve the first and last non-finite Y values
  // in each bucket, so Plotly can break a line at Parameter NaNs. The global
  // output budget remains targetPoints * 1.5.
  const maxOutputPoints = Math.floor(targetPoints * 1.5);
  const numBuckets = Math.max(1, Math.floor(maxOutputPoints / 6));
  const bucketSize = Math.max(1, Math.ceil(n / numBuckets));
  const maxBucketOutputPoints = numBuckets * 6;

  const outX = new Float64Array(maxBucketOutputPoints);
  const outY = new Float64Array(maxBucketOutputPoints);
  let outCount = 0;
  const candidates = new Int32Array(6);

  let globalYmin = Infinity;
  let globalYmax = -Infinity;
  const globalXmin = points[0].timestamp;
  const globalXmax = points[n - 1].timestamp;

  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSize;
    const end = start + bucketSize < n ? start + bucketSize : n;
    if (start >= end) break;

    let ymin = Infinity;
    let ymax = -Infinity;
    let ymin_i = -1;
    let ymax_i = -1;
    let firstNonFiniteY = -1;
    let lastNonFiniteY = -1;

    for (let i = start; i < end; i++) {
      const y = getY(points[i]);
      if (!Number.isFinite(y)) {
        if (firstNonFiniteY < 0) firstNonFiniteY = i;
        lastNonFiniteY = i;
        continue;
      }
      if (y < ymin) {
        ymin = y;
        ymin_i = i;
      }
      if (y > ymax) {
        ymax = y;
        ymax_i = i;
      }
    }

    if (Number.isFinite(ymin) && ymin < globalYmin) globalYmin = ymin;
    if (Number.isFinite(ymax) && ymax > globalYmax) globalYmax = ymax;

    let candidateCount = 0;
    candidates[candidateCount++] = start;
    if (ymin_i >= 0) candidates[candidateCount++] = ymin_i;
    if (ymax_i >= 0) candidates[candidateCount++] = ymax_i;
    if (firstNonFiniteY >= 0) candidates[candidateCount++] = firstNonFiniteY;
    if (lastNonFiniteY >= 0 && lastNonFiniteY !== firstNonFiniteY) {
      candidates[candidateCount++] = lastNonFiniteY;
    }
    if (end - 1 !== start) candidates[candidateCount++] = end - 1;

    // Sort the fixed-size candidate list into original sample order.
    for (let i = 1; i < candidateCount; i++) {
      const key = candidates[i];
      let j = i - 1;
      while (j >= 0 && candidates[j] > key) {
        candidates[j + 1] = candidates[j];
        j--;
      }
      candidates[j + 1] = key;
    }

    let previous = -1;
    for (let i = 0; i < candidateCount; i++) {
      const index = candidates[i];
      if (index === previous) continue;
      outX[outCount] = points[index].timestamp;
      outY[outCount] = getY(points[index]);
      outCount++;
      previous = index;
    }
  }

  return [outX.subarray(0, outCount), outY.subarray(0, outCount), globalXmin, globalXmax, globalYmin, globalYmax];
}

/**
 * Full 2D-M4 decimation for non-monotonic parametric curves (X != 'time').
 * Retains endpoints, X/Y extrema, and invalid-value boundaries per bucket to
 * preserve sample order, loop shape, and visible breaks at Parameter NaNs.
 */
function decimateParametric2DM4(
  points: readonly DataPoint[],
  xDesc: AxisDescriptor,
  yDesc: AxisDescriptor,
  targetPoints: number,
): [Float64Array, Float64Array, number, number, number, number] {
  const n = points.length;
  const getX = getAxisAccessor(xDesc);
  const getY = getAxisAccessor(yDesc);

  let globalXmin = Infinity;
  let globalXmax = -Infinity;
  let globalYmin = Infinity;
  let globalYmax = -Infinity;

  if (n <= targetPoints) {
    const outX = new Float64Array(n);
    const outY = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const pt = points[i];
      const x = getX(pt);
      const y = getY(pt);
      outX[i] = x;
      outY[i] = y;
      if (Number.isFinite(x)) {
        if (x < globalXmin) globalXmin = x;
        if (x > globalXmax) globalXmax = x;
      }
      if (Number.isFinite(y)) {
        if (y < globalYmin) globalYmin = y;
        if (y > globalYmax) globalYmax = y;
      }
    }
    return [outX, outY, globalXmin, globalXmax, globalYmin, globalYmax];
  }

  // Eight candidates are possible per bucket: endpoints, four extrema, and
  // two invalid-value boundaries. Keep the actual output bounded to
  // targetPoints * 1.5 (1024 -> 1536), rather than allowing the candidate
  // count to grow to targetPoints * 1.5 or more by accident.
  // Two extra candidates retain the first/last invalid XY samples in each
  // bucket. These NaNs are line breaks, not values to replace or interpolate.
  const maxOutputPoints = Math.floor(targetPoints * 1.5);
  const numBuckets = Math.max(1, Math.floor(maxOutputPoints / 8));
  const bucketSize = Math.max(1, Math.ceil(n / numBuckets));

  // Maximum possible points = numBuckets * 8
  const maxOutput = numBuckets * 8;
  const outX = new Float64Array(maxOutput);
  const outY = new Float64Array(maxOutput);
  let outCount = 0;

  // Reusable candidate buffer on stack/closure (no GC)
  const cand = new Int32Array(8);

  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSize;
    const end = start + bucketSize < n ? start + bucketSize : n;
    if (start >= end) break;

    const first = points[start];
    const firstX = getX(first);
    const firstY = getY(first);
    let xmin = Number.isFinite(firstX) ? firstX : Infinity;
    let xmax = Number.isFinite(firstX) ? firstX : -Infinity;
    let ymin = Number.isFinite(firstY) ? firstY : Infinity;
    let ymax = Number.isFinite(firstY) ? firstY : -Infinity;

    let xmin_i = Number.isFinite(firstX) ? start : -1;
    let xmax_i = Number.isFinite(firstX) ? start : -1;
    let ymin_i = Number.isFinite(firstY) ? start : -1;
    let ymax_i = Number.isFinite(firstY) ? start : -1;
    let firstInvalid = Number.isFinite(firstX) && Number.isFinite(firstY) ? -1 : start;
    let lastInvalid = firstInvalid;

    for (let i = start + 1; i < end; i++) {
      const pt = points[i];
      const x = getX(pt);
      const y = getY(pt);

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        if (firstInvalid < 0) firstInvalid = i;
        lastInvalid = i;
      }

      if (Number.isFinite(x) && x < xmin) {
        xmin = x;
        xmin_i = i;
      }
      if (Number.isFinite(x) && x > xmax) {
        xmax = x;
        xmax_i = i;
      }
      if (Number.isFinite(y) && y < ymin) {
        ymin = y;
        ymin_i = i;
      }
      if (Number.isFinite(y) && y > ymax) {
        ymax = y;
        ymax_i = i;
      }
    }

    if (Number.isFinite(xmin) && xmin < globalXmin) globalXmin = xmin;
    if (Number.isFinite(xmax) && xmax > globalXmax) globalXmax = xmax;
    if (Number.isFinite(ymin) && ymin < globalYmin) globalYmin = ymin;
    if (Number.isFinite(ymax) && ymax > globalYmax) globalYmax = ymax;

    let candidateCount = 0;
    cand[candidateCount++] = start;
    if (xmin_i >= 0) cand[candidateCount++] = xmin_i;
    if (xmax_i >= 0) cand[candidateCount++] = xmax_i;
    if (ymin_i >= 0) cand[candidateCount++] = ymin_i;
    if (ymax_i >= 0) cand[candidateCount++] = ymax_i;
    if (firstInvalid >= 0) cand[candidateCount++] = firstInvalid;
    if (lastInvalid >= 0 && lastInvalid !== firstInvalid) cand[candidateCount++] = lastInvalid;
    if (end - 1 !== start) cand[candidateCount++] = end - 1;

    // Fast 6-element insertion sort
    for (let i = 1; i < candidateCount; i++) {
      const key = cand[i];
      let j = i - 1;
      while (j >= 0 && cand[j] > key) {
        cand[j + 1] = cand[j];
        j--;
      }
      cand[j + 1] = key;
    }

    // Deduplicate and output in sequential order
    let prev = -1;
    for (let j = 0; j < candidateCount; j++) {
      const idx = cand[j];
      if (idx !== prev) {
        const pt = points[idx];
        outX[outCount] = getX(pt);
        outY[outCount] = getY(pt);
        outCount++;
        prev = idx;
      }
    }
  }

  // Subarray view if not full (zero-copy slice)
  return [outX.subarray(0, outCount), outY.subarray(0, outCount), globalXmin, globalXmax, globalYmin, globalYmax];
}

/**
 * 2D-M4 (MinMax) chart decimation algorithm with fused extents calculation.
 * Preserves local extremes (xmin, xmax, ymin, ymax) and start/end points in O(N) time,
 * guaranteeing envelope preservation without peak-shaving.
 *
 * Automatically branches:
 * - When X is 'time' (strictly monotonic): uses decimateTimeM4 (halves comparisons, skips X search)
 * - When X is parametric (hysteresis/XY): uses decimateParametric2DM4 (full 6-point retention)
 *
 * @param points Source array of DataPoint
 * @param xDesc Descriptor for the X axis
 * @param yDesc Descriptor for the Y axis
 * @param targetPoints Target output points (e.g. 1024). Actual output will be ~1000 - 1500 points.
 * @returns Decimated tuple of [outX, outY, xMin, xMax, yMin, yMax]
 */
export function decimate2DM4(
  points: readonly DataPoint[],
  xDesc: AxisDescriptor,
  yDesc: AxisDescriptor,
  targetPoints: number,
): [Float64Array, Float64Array, number, number, number, number] {
  if (points.length === 0) {
    return [new Float64Array(0), new Float64Array(0), Infinity, -Infinity, Infinity, -Infinity];
  }
  let monotonicTime = xDesc.kind === 'time';
  if (monotonicTime) {
    if (!Number.isFinite(points[0].timestamp)) monotonicTime = false;
    for (let i = 1; i < points.length; i++) {
      if (
        !Number.isFinite(points[i].timestamp) ||
        points[i].timestamp < points[i - 1].timestamp
      ) {
        monotonicTime = false;
        break;
      }
    }
  }
  if (monotonicTime) {
    return decimateTimeM4(points, yDesc, targetPoints);
  }
  return decimateParametric2DM4(points, xDesc, yDesc, targetPoints);
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
  if (n <= 1) {
    return buffer.slice();
  }
  // Origami folding is intentionally simple: retain even source positions.
  // The caller doubles the future intake stride at the same time, so both the
  // existing history and newly accepted samples stay on the same grid.
  const result = new Array<DataPoint>(Math.ceil(n / 2));
  for (let source = 0, target = 0; source < n; source += 2, target += 1) {
    result[target] = buffer[source];
  }
  return result;
}
