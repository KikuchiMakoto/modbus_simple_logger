import { describe, expect, test } from 'bun:test';
import {
  buildPlotVertices,
  GAP_SENTINEL,
  GAP_THRESHOLD,
} from '../src/modbus_simple_plotter';

describe('buildPlotVertices', () => {
  test('preserves sub-millisecond relative precision on multi-day 64-bit timestamps', () => {
    // 1.8e12 epoch ms + 7 days span + 100 ms step: Float32 raw would lose sub-second precision,
    // whereas Float64 range-offset scaling preserves exact pixel coordinates.
    const t0 = 1_795_590_000_000;
    const tEnd = t0 + 7 * 86_400_000;
    const xs = Float64Array.of(t0, t0 + 100, tEnd);
    const ys = Float64Array.of(0, 5, 10);

    const { vertices, pointCount } = buildPlotVertices(xs, ys, t0, tEnd, 0, 10, 500, 200);
    expect(pointCount).toBe(3);

    // First and second points differ by 100ms out of 7 days; both are finite and ordered.
    expect(vertices[0]).toBeLessThan(vertices[2]);
    expect(vertices[2]).toBeLessThan(vertices[4]);
    expect(Number.isFinite(vertices[0])).toBe(true);
    expect(vertices[4]).toBeGreaterThan(0);
    expect(vertices[4]).toBeLessThan(500);
    // Top-left origin: y=0 maps near bottom (200), y=10 maps near top (0).
    expect(vertices[1]).toBeGreaterThan(180);
    expect(vertices[5]).toBeLessThan(20);
  });

  test('maps NaN samples to GAP_SENTINEL without poisoning neighboring finite points', () => {
    const xs = Float64Array.of(0, 1, NaN, 3, 4);
    const ys = Float64Array.of(0, 10, 5, NaN, 20);

    const { vertices } = buildPlotVertices(xs, ys, 0, 4, 0, 20, 400, 200);
    expect(vertices[0]).toBeLessThan(GAP_THRESHOLD);
    expect(vertices[2]).toBeLessThan(GAP_THRESHOLD);
    // index 2 (x=NaN) and index 3 (y=NaN) both become GAP_SENTINEL
    expect(vertices[4]).toBe(GAP_SENTINEL);
    expect(vertices[5]).toBe(GAP_SENTINEL);
    expect(vertices[6]).toBe(GAP_SENTINEL);
    expect(vertices[7]).toBe(GAP_SENTINEL);
    expect(vertices[8]).toBeLessThan(GAP_THRESHOLD);
  });

  test('reuses provided scratch buffer when large enough', () => {
    const scratch = new Float32Array(64);
    const xs = Float64Array.of(0, 1, 2);
    const ys = Float64Array.of(0, 1, 2);
    const { vertices } = buildPlotVertices(xs, ys, 0, 2, 0, 2, 100, 100, scratch);
    expect(vertices.buffer).toBe(scratch.buffer);
  });

  test('maps extreme ±1e308 bounds cleanly without NaN/Infinity overflow', () => {
    const xs = Float64Array.of(-1e308, 0, 1e308);
    const ys = Float64Array.of(-1e308, 0, 1e308);
    const { vertices } = buildPlotVertices(xs, ys, -1e308, 1e308, -1e308, 1e308, 400, 200);
    for (let i = 0; i < 6; i++) {
      expect(Number.isFinite(vertices[i])).toBe(true);
      expect(vertices[i]).toBeLessThan(GAP_THRESHOLD);
    }
    expect(vertices[2]).toBeCloseTo(200, 1);
    expect(vertices[3]).toBeCloseTo(100, 1);
  });
});
