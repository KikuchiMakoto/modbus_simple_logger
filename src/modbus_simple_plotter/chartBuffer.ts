import { paddedRange } from './axisTicks';

/**
 * Sentinel placed into converted Float32 vertex buffers when a point is non-finite.
 * Finite coordinates are always mapped into plot pixel space `[0, width]` x `[0, height]`,
 * so anything > GAP_THRESHOLD is guaranteed to be a line-break marker without relying on
 * GLSL `isnan()` behavior under aggressive driver fast-math optimizations.
 */
export const GAP_SENTINEL = 1e9;
export const GAP_THRESHOLD = 1e8;

export interface PreparedPlotGeometry {
  pointCount: number;
  xRange: [number, number];
  yRange: [number, number];
  /** Packed [px0, py0, px1, py1, ...] in CSS-pixel coordinates relative to the plot rect. */
  vertices: Float32Array;
}

/**
 * Map decimated Float64 coordinates into plot-relative Float32 pixel coordinates
 * `[0, plotWidth]` x `[0, plotHeight]` (origin at top-left, +Y downwards).
 *
 * Performing `(v - rangeMin) * scale` in Float64 before writing Float32 preserves
 * full sub-pixel precision even for multi-day 64-bit Unix millisecond timestamps.
 * Reuses `scratch` when large enough to avoid per-redraw GC allocations.
 */
export function buildPlotVertices(
  xData: Float64Array,
  yData: Float64Array,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  plotWidth: number,
  plotHeight: number,
  scratch?: Float32Array,
  xZeroSpanPad?: number,
): PreparedPlotGeometry {
  const n = Math.min(xData.length, yData.length);
  const xRange = paddedRange(xMin, xMax, 0.1, xZeroSpanPad) ?? [0, 1];
  const yRange = paddedRange(yMin, yMax, 0.05) ?? [0, 1];

  const needed = n * 2;
  const vertices = scratch && scratch.length >= needed ? scratch : new Float32Array(Math.max(needed, 256));

  const x0 = xRange[0];
  const y1 = yRange[1];
  const xSpan = xRange[1] - x0;
  const ySpan = y1 - yRange[0];
  const xOverflow = !Number.isFinite(xSpan);
  const yOverflow = !Number.isFinite(ySpan);
  const halfXSpan = xOverflow ? xRange[1] * 0.5 - x0 * 0.5 || 1 : 0;
  const halfYSpan = yOverflow ? y1 * 0.5 - yRange[0] * 0.5 || 1 : 0;
  const scaleX = !xOverflow && xSpan > 0 ? plotWidth / xSpan : 0;
  const scaleY = !yOverflow && ySpan > 0 ? plotHeight / ySpan : 0;

  for (let i = 0; i < n; i++) {
    const x = xData[i];
    const y = yData[i];
    const base = i * 2;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const px = xOverflow
        ? ((x * 0.5 - x0 * 0.5) / halfXSpan) * plotWidth
        : (x - x0) * scaleX;
      // Top-left pixel origin: data yMin sits at y = plotHeight, yMax at y = 0.
      const py = yOverflow
        ? ((y1 * 0.5 - y * 0.5) / halfYSpan) * plotHeight
        : (y1 - y) * scaleY;
      if (Number.isFinite(px) && Number.isFinite(py)) {
        vertices[base] = px;
        vertices[base + 1] = py;
      } else {
        vertices[base] = GAP_SENTINEL;
        vertices[base + 1] = GAP_SENTINEL;
      }
    } else {
      vertices[base] = GAP_SENTINEL;
      vertices[base + 1] = GAP_SENTINEL;
    }
  }

  return {
    pointCount: n,
    xRange,
    yRange,
    vertices,
  };
}
