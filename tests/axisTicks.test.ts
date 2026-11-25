import { describe, expect, test } from 'bun:test';
import { computeLinearTicks, computeTimeTicks, paddedRange } from '../src/modbus_simple_plotter';

describe('paddedRange', () => {
  test('expands span symmetrically by fraction', () => {
    expect(paddedRange(0, 100, 0.1)).toEqual([-10, 110]);
    expect(paddedRange(-10, 10, 0.05)).toEqual([-11, 11]);
  });

  test('prevents collapse on zero-span constant data', () => {
    expect(paddedRange(100, 100, 0.1)).toEqual([90, 110]);
    expect(paddedRange(0, 0, 0.05)).toEqual([-1, 1]);
    // Epoch-ms single point pads by explicit 1000ms instead of ~10% of 56 years.
    const t = 1_795_590_000_000;
    expect(paddedRange(t, t, 0.1, 1_000)).toEqual([t - 1_000, t + 1_000]);
  });

  test('returns null for non-finite bounds', () => {
    expect(paddedRange(Infinity, -Infinity, 0.1)).toBeNull();
    expect(paddedRange(NaN, 10, 0.1)).toBeNull();
  });

  test('handles extreme finite bounds without overflowing to Infinity', () => {
    const r = paddedRange(-1e308, 1e308, 0.1);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r![0])).toBe(true);
    expect(Number.isFinite(r![1])).toBe(true);
  });
});

describe('computeLinearTicks', () => {
  test('generates clean numeric labels without -0 artifacts', () => {
    const ticks = computeLinearTicks(-10, 10, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.some((t) => t.label === '0')).toBe(true);
    expect(ticks.some((t) => t.label === '-0')).toBe(false);
    for (const t of ticks) {
      expect(t.value).toBeGreaterThanOrEqual(-10 - 1e-9);
      expect(t.value).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  test('formats sub-unit 2.5 steps with sufficient decimals', () => {
    const ticks = computeLinearTicks(0, 1, 5);
    const labels = ticks.map((t) => t.label);
    expect(labels).toContain('0');
    expect(labels).toContain('0.25');
    expect(labels).toContain('0.5');
  });
});

describe('computeTimeTicks', () => {
  test('formats short windows with seconds and aligns cleanly', () => {
    const base = new Date(2026, 5, 1, 12, 0, 0, 0).getTime();
    const ticks = computeTimeTicks(base, base + 60_000, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks[0].label).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  test('formats millisecond-scale spans without returning empty ticks', () => {
    const start = new Date(2026, 5, 1, 12, 0, 0, 0).getTime();
    const ticks = computeTimeTicks(start, start + 25, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0].label).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  test('includes date when spanning across midnight', () => {
    const start = new Date(2026, 5, 1, 22, 0, 0, 0).getTime();
    const end = new Date(2026, 5, 2, 4, 0, 0, 0).getTime();
    const ticks = computeTimeTicks(start, end, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.some((t) => /\d{2}\/\d{2}/.test(t.label))).toBe(true);
  });

  test('handles week-long span with date labels', () => {
    const start = new Date(2026, 5, 1, 0, 0, 0, 0).getTime();
    const end = start + 7 * 86_400_000;
    const ticks = computeTimeTicks(start, end, 6);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.every((t) => /^\d{2}\/\d{2}/.test(t.label))).toBe(true);
  });
});
