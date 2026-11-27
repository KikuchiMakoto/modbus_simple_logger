import type { DataPoint } from '../types';
import { getAxisAccessor, type AxisDescriptor } from './decimation';

/**
 * Columnar copy of the two axes one chart plots, kept in step with the display
 * buffer incrementally.
 *
 * Why: most of a full M4 pass over a 65,536-point save buffer is not the M4
 * itself but reading each DataPoint through an accessor (three typed arrays per
 * point, scattered over the heap). Scanning two contiguous Float64Arrays is
 * 3-6x faster, and on the main thread — shared with Modbus polling — that is
 * the cost that turns into poll jitter.
 *
 * Correctness rests on App's buffer discipline, which this class checks rather
 * than trusts blindly:
 *   - a DataPoint is never mutated after it is created (each poll allocates
 *     fresh Float32Arrays), so a cached value cannot go stale;
 *   - between resets the buffer only grows at the end (saving: push), or drops
 *     from the front (preview: push + splice(0, k));
 *   - every other change (save start/stop, connect, Origami fold) replaces the
 *     array object.
 * `sync()` appends only when the array is the same object AND the prefix it
 * cached is provably intact (same first and same last-cached element);
 * anything else is a full refill. A refill is the old per-redraw cost, paid
 * once — after a fold, an axis change, or a sliding-preview step (600 points,
 * negligible).
 *
 * Values are widened Float32 -> Float64 exactly, so decimating these columns is
 * bit-identical to decimating the DataPoints directly.
 */
export class AxisColumnCache {
  private xsBuf = new Float64Array(0);
  private ysBuf = new Float64Array(0);
  private points: readonly DataPoint[] | null = null;
  private count = 0;
  private first: DataPoint | undefined;
  private last: DataPoint | undefined;
  private xKind: AxisDescriptor['kind'] | null = null;
  private xIndex = -1;
  private yKind: AxisDescriptor['kind'] | null = null;
  private yIndex = -1;

  /** X column; valid for indices [0, length). May be longer than length. */
  get xs(): Float64Array {
    return this.xsBuf;
  }

  /** Y column; valid for indices [0, length). May be longer than length. */
  get ys(): Float64Array {
    return this.ysBuf;
  }

  get length(): number {
    return this.count;
  }

  /**
   * Bring the columns up to date with `points` for the given axes. Returns the
   * number of valid entries (`points.length`).
   */
  sync(points: readonly DataPoint[], xDesc: AxisDescriptor, yDesc: AxisDescriptor): number {
    const n = points.length;
    const sameAxes =
      this.xKind === xDesc.kind &&
      this.xIndex === xDesc.index &&
      this.yKind === yDesc.kind &&
      this.yIndex === yDesc.index;
    const prefixIntact =
      sameAxes &&
      this.points === points &&
      n >= this.count &&
      (this.count === 0 || (points[0] === this.first && points[this.count - 1] === this.last));

    const from = prefixIntact ? this.count : 0;
    if (from === n && prefixIntact) return n;

    this.ensureCapacity(n, from);
    const getX = getAxisAccessor(xDesc);
    const getY = getAxisAccessor(yDesc);
    const xs = this.xsBuf;
    const ys = this.ysBuf;
    for (let i = from; i < n; i++) {
      const p = points[i];
      xs[i] = getX(p);
      ys[i] = getY(p);
    }

    this.points = points;
    this.count = n;
    this.first = n > 0 ? points[0] : undefined;
    this.last = n > 0 ? points[n - 1] : undefined;
    this.xKind = xDesc.kind;
    this.xIndex = xDesc.index;
    this.yKind = yDesc.kind;
    this.yIndex = yDesc.index;
    return n;
  }

  /** Drop all cached data and buffers (e.g. on plotter dispose). */
  clear(): void {
    this.xsBuf = new Float64Array(0);
    this.ysBuf = new Float64Array(0);
    this.points = null;
    this.count = 0;
    this.first = undefined;
    this.last = undefined;
    this.xKind = null;
    this.yKind = null;
    this.xIndex = -1;
    this.yIndex = -1;
  }

  private ensureCapacity(n: number, keep: number): void {
    if (this.xsBuf.length >= n) return;
    // Doubling keeps the save buffer's growth (one point per 100 ms up to
    // 65,536) to a handful of reallocations per session.
    const size = Math.max(n, this.xsBuf.length * 2, 1024);
    const xs = new Float64Array(size);
    const ys = new Float64Array(size);
    if (keep > 0) {
      xs.set(this.xsBuf.subarray(0, keep));
      ys.set(this.ysBuf.subarray(0, keep));
    }
    this.xsBuf = xs;
    this.ysBuf = ys;
  }
}
