import { describe, expect, test } from 'bun:test';
import {
  AxisColumnCache,
  decimate2DM4,
  decimateColumnsM4,
  foldDataBufferHalf,
  type AxisDescriptor,
} from '../src/modbus_simple_plotter';
import type { DataPoint } from '../src/types';

const TIME: AxisDescriptor = { kind: 'time', index: 0 };
const RAW1: AxisDescriptor = { kind: 'raw', index: 1 };
const PHY0: AxisDescriptor = { kind: 'physical', index: 0 };
const PAR0: AxisDescriptor = { kind: 'param', index: 0 };

let seq = 0;
function point(i: number, nanParam = false): DataPoint {
  const t = i / 37;
  return {
    seq: seq++,
    timestamp: 1_700_000_000_000 + i * 100,
    aiRaw: Float32Array.of(Math.round(Math.sin(t) * 1000), Math.round(Math.cos(t * 3) * 800 + (i % 7))),
    aiPhysical: Float32Array.of(Math.sin(t) * (1 + i / 5000), Math.tanh(Math.sin(t - 0.4) * 3)),
    param: Float32Array.of(nanParam && i % 53 === 0 ? NaN : (i % 11) * 0.1),
  };
}

function makePoints(n: number, nanParam = false): DataPoint[] {
  return Array.from({ length: n }, (_, i) => point(i, nanParam));
}

/** The cache-backed path must equal the DataPoint path bit for bit. */
function expectSameAsDirect(
  cache: AxisColumnCache,
  points: DataPoint[],
  xDesc: AxisDescriptor,
  yDesc: AxisDescriptor,
  target: number,
) {
  const n = cache.sync(points, xDesc, yDesc);
  expect(n).toBe(points.length);
  const viaCache = decimateColumnsM4(cache.xs, cache.ys, n, xDesc.kind === 'time', target);
  const direct = decimate2DM4(points, xDesc, yDesc, target);
  expect(Array.from(viaCache[0])).toEqual(Array.from(direct[0]));
  expect(Array.from(viaCache[1])).toEqual(Array.from(direct[1]));
  expect(viaCache.slice(2)).toEqual(direct.slice(2));
}

describe('AxisColumnCache', () => {
  test('append-only growth reads only the new points', () => {
    const cache = new AxisColumnCache();
    const buffer = makePoints(1000);
    cache.sync(buffer, TIME, RAW1);

    // Poison the cached prefix: an incremental sync must not rewrite it.
    cache.xs[10] = -12345;
    for (let i = 1000; i < 1500; i++) buffer.push(point(i));
    expect(cache.sync(buffer, TIME, RAW1)).toBe(1500);
    expect(cache.xs[10]).toBe(-12345);
    expect(cache.xs[1499]).toBe(buffer[1499].timestamp);
    expect(cache.ys[1499]).toBe(buffer[1499].aiRaw[1]);
  });

  test('matches direct decimation across saving growth, folds and capacity growth', () => {
    const cache = new AxisColumnCache();
    let buffer: DataPoint[] = [];
    let i = 0;
    for (let step = 0; step < 40; step++) {
      for (let k = 0; k < 777; k++) buffer.push(point(i++, true));
      if (buffer.length >= 16384) buffer = foldDataBufferHalf(buffer);
      expectSameAsDirect(cache, buffer, TIME, RAW1, 2048);
      expectSameAsDirect(cache, buffer, TIME, PAR0, 2048);
    }
  });

  test('XY (non-monotonic X) matches direct decimation', () => {
    const cache = new AxisColumnCache();
    const buffer = makePoints(30000);
    expectSameAsDirect(cache, buffer, PHY0, { kind: 'physical', index: 1 }, 1024);
    for (let i = 30000; i < 31000; i++) buffer.push(point(i));
    expectSameAsDirect(cache, buffer, PHY0, { kind: 'physical', index: 1 }, 1024);
  });

  test('sliding preview (push + splice from front) refills correctly', () => {
    const cache = new AxisColumnCache();
    const buffer = makePoints(600);
    let i = 600;
    for (let step = 0; step < 20; step++) {
      for (let k = 0; k < 3; k++) buffer.push(point(i++));
      buffer.splice(0, buffer.length - 600);
      expectSameAsDirect(cache, buffer, TIME, RAW1, 8192);
    }
  });

  test('axis change refills the columns', () => {
    const cache = new AxisColumnCache();
    const buffer = makePoints(5000);
    expectSameAsDirect(cache, buffer, TIME, RAW1, 1024);
    expectSameAsDirect(cache, buffer, TIME, PAR0, 1024);
    expectSameAsDirect(cache, buffer, PHY0, RAW1, 1024);
  });

  test('a replaced array, or an in-place rewrite of the tail, forces a full refill', () => {
    const cache = new AxisColumnCache();
    const a = makePoints(3000);
    cache.sync(a, TIME, RAW1);

    // Same length, different array object (e.g. save start): refill.
    const b = makePoints(3000).map((p) => ({ ...p, aiRaw: Float32Array.of(7, 7) }));
    cache.sync(b, TIME, RAW1);
    expect(cache.ys[0]).toBe(7);

    // Same array, last cached element replaced in place: refill, not append.
    b[2999] = { ...b[2999], aiRaw: Float32Array.of(9, 9) };
    b.push({ ...b[0], aiRaw: Float32Array.of(5, 5) });
    cache.sync(b, TIME, RAW1);
    expect(cache.ys[2999]).toBe(9);
    expect(cache.ys[3000]).toBe(5);
  });

  test('empty buffer and clear()', () => {
    const cache = new AxisColumnCache();
    expect(cache.sync([], TIME, RAW1)).toBe(0);
    const buffer = makePoints(10);
    expect(cache.sync(buffer, TIME, RAW1)).toBe(10);
    cache.clear();
    expect(cache.length).toBe(0);
    expectSameAsDirect(cache, buffer, TIME, RAW1, 8192);
  });
});
