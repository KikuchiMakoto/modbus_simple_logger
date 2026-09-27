import { describe, expect, test } from 'bun:test';
import { decimate2DM4, DECIMATION_MAX_OUTPUT_RATIO, foldDataBufferHalf } from '../src/utils/m4Decimation';
import type { DataPoint } from '../src/types';

const TIME = { kind: 'time', index: 0 } as const;
const RAW0 = { kind: 'raw', index: 0 } as const;
const PAR0 = { kind: 'param', index: 0 } as const;

function makePoints(n: number, raw: (i: number) => number, par: (i: number) => number, t = (i: number) => 1000 + i * 100): DataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i,
    timestamp: t(i),
    aiRaw: Float32Array.of(raw(i)),
    aiPhysical: Float32Array.of(raw(i)),
    param: Float32Array.of(par(i)),
  }));
}

/**
 * The invariant: between two consecutive finite output points there is no
 * invalid source sample. Output points are matched back to source indices in
 * order (values are unique per test by construction via X or timestamp).
 */
function assertNoBridgedGap(points: DataPoint[], xs: Float64Array, ys: Float64Array, getX: (p: DataPoint) => number, getY: (p: DataPoint) => number) {
  const invalid = points.map((p) => !Number.isFinite(getX(p)) || !Number.isFinite(getY(p)));
  let cursor = 0;
  let prevSource = -1;
  let prevFinite = false;
  for (let k = 0; k < xs.length; k++) {
    const finite = Number.isFinite(xs[k]) && Number.isFinite(ys[k]);
    if (!finite) {
      prevFinite = false;
      continue;
    }
    // Find this output point in the source, advancing monotonically.
    while (cursor < points.length && !(getX(points[cursor]) === xs[k] && getY(points[cursor]) === ys[k])) cursor++;
    expect(cursor).toBeLessThan(points.length);
    if (prevFinite) {
      for (let i = prevSource + 1; i < cursor; i++) {
        if (invalid[i]) throw new Error(`segment ${prevSource}->${cursor} bridges invalid sample ${i}`);
      }
    }
    prevSource = cursor;
    prevFinite = true;
    cursor++;
  }
}

const getT = (p: DataPoint) => p.timestamp;
const getR = (p: DataPoint) => p.aiRaw[0];
const getP = (p: DataPoint) => p.param[0];

describe('decimate2DM4', () => {
  test('regression: XY does not join across a dropped NaN (baseline a2cecc3 case)', () => {
    const nan = new Set([1, 5, 7]);
    const pts = makePoints(1536, (i) => i, (i) => (nan.has(i) ? NaN : i === 4 ? -10 : i === 6 ? 10 : 0));
    const [xs, ys] = decimate2DM4(pts, RAW0, PAR0, 1024);
    assertNoBridgedGap(pts, xs, ys, getR, getP);
  });

  test('time series with scattered NaN never bridges and respects budget', () => {
    const pts = makePoints(65536, () => 0, (i) => (i % 97 === 3 || i % 256 === 1 || i % 256 === 4 ? NaN : Math.sin(i / 50) * 100 + i));
    const [xs, ys] = decimate2DM4(pts, TIME, PAR0, 1024);
    expect(xs.length).toBeLessThanOrEqual(Math.floor(1024 * DECIMATION_MAX_OUTPUT_RATIO));
    assertNoBridgedGap(pts, xs, ys, getT, getP);
  });

  test('alternating valid/NaN (worst case) stays within budget and never bridges', () => {
    const pts = makePoints(65536, (i) => i, (i) => (i % 2 ? NaN : i));
    for (const x of [TIME, RAW0]) {
      const [xs, ys] = decimate2DM4(pts, x, PAR0, 1024);
      expect(xs.length).toBeLessThanOrEqual(Math.floor(1024 * DECIMATION_MAX_OUTPUT_RATIO));
      assertNoBridgedGap(pts, xs, ys, x === TIME ? getT : getR, getP);
    }
  });

  test('NaN on X also breaks the line in XY mode', () => {
    const pts = makePoints(8000, (i) => (i % 300 === 150 ? NaN : Math.cos(i / 40) * 1000 + i), (i) => Math.sin(i / 40) * 1000 + i);
    const [xs, ys] = decimate2DM4(pts, RAW0, PAR0, 1024);
    assertNoBridgedGap(pts, xs, ys, getR, getP);
  });

  test('finite data keeps global extrema and source order', () => {
    const pts = makePoints(50000, (i) => Math.round(Math.sin(i / 700) * 30000), (i) => (i === 31337 ? 1e6 : i === 777 ? -1e6 : Math.sin(i / 300)));
    const [xs, ys, , , yMin, yMax] = decimate2DM4(pts, TIME, PAR0, 1024);
    expect(yMax).toBe(1e6);
    expect(yMin).toBe(-1e6);
    expect(Array.from(ys)).toContain(1e6);
    expect(Array.from(ys)).toContain(-1e6);
    for (let k = 1; k < xs.length; k++) expect(xs[k]).toBeGreaterThan(xs[k - 1]);
    expect(xs.length).toBeLessThanOrEqual(1536);
  });

  test('XY keeps the X turning points of a loop', () => {
    const pts = makePoints(40000, (i) => (i === 12345 ? 99999 : Math.sin(i / 100) * 1000), (i) => Math.cos(i / 100));
    const [xs, , xMin, xMax] = decimate2DM4(pts, RAW0, PAR0, 1024);
    expect(xMax).toBe(99999);
    expect(Array.from(xs)).toContain(99999);
    expect(xMin).toBeLessThan(-999);
  });

  test('small input is passed through untouched (NaNs included)', () => {
    const pts = makePoints(600, (i) => i, (i) => (i === 10 ? NaN : i));
    const [xs, ys] = decimate2DM4(pts, TIME, PAR0, 1024);
    expect(xs.length).toBe(600);
    expect(Number.isNaN(ys[10])).toBe(true);
  });

  test('non-monotonic timestamps fall back to the XY path safely', () => {
    const pts = makePoints(5000, () => 0, (i) => i, (i) => (i === 2500 ? 0 : 1000 + i));
    const [xs, ys] = decimate2DM4(pts, TIME, PAR0, 1024);
    expect(xs.length).toBeLessThanOrEqual(1536);
    assertNoBridgedGap(pts, xs, ys, getT, getP);
  });

  test('fast path and general path agree on finite data', () => {
    // A single NaN at the very end forces the general path without changing
    // any bucket before it; compare everything up to the last bucket.
    const base = (i: number) => Math.sin(i / 37) * 500 + ((i * 7919) % 101);
    const n = 20000;
    for (const x of [TIME, RAW0]) {
      const finite = makePoints(n, (i) => Math.cos(i / 53) * 900 + i * 0.01, base);
      const tainted = makePoints(n, (i) => Math.cos(i / 53) * 900 + i * 0.01, (i) => (i === n - 1 ? NaN : base(i)));
      const [fx, fy] = decimate2DM4(finite, x, PAR0, 1024);
      const [gx, gy] = decimate2DM4(tainted, x, PAR0, 1024);
      const cut = Math.min(fx.length, gx.length) - 8;
      expect(Array.from(gx.subarray(0, cut))).toEqual(Array.from(fx.subarray(0, cut)));
      expect(Array.from(gy.subarray(0, cut))).toEqual(Array.from(fy.subarray(0, cut)));
    }
  });

  test('all-NaN yields no finite extent', () => {
    const pts = makePoints(3000, () => 0, () => NaN);
    const [, , , , yMin, yMax] = decimate2DM4(pts, TIME, PAR0, 1024);
    expect(Number.isFinite(yMin)).toBe(false);
    expect(Number.isFinite(yMax)).toBe(false);
  });
});

describe('foldDataBufferHalf', () => {
  test('keeps even positions', () => {
    const pts = makePoints(7, (i) => i, () => 0);
    expect(foldDataBufferHalf(pts).map((p) => p.seq)).toEqual([0, 2, 4, 6]);
  });
});
