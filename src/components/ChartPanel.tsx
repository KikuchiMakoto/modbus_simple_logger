import {
  type CSSProperties,
  type ComponentType,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { type Config, type Data, type Layout } from 'plotly.js';
import { Plot } from '../plotly';
import { DataPoint } from '../types';
import { detectRenderBackend, reportRenderBackend } from '../utils/renderBackend';

interface AxisOption {
  key: string;
  label: string;
}

interface ChartPanelProps {
  color: string;
  dataPoints: DataPoint[];
  displayRevision: number;
  /** Used as the Plot's React key: bumping it unmounts the old plot (which
   * runs Plotly.purge, freeing its WebGL/regl resources) and mounts a fresh
   * one, bounding GPU-side accumulation over long sessions. */
  purgeEpoch: number;
  axisOptions: AxisOption[];
  xAxis: string;
  yAxis: string;
  isDarkMode: boolean;
  onXAxisChange: (value: string) => void;
  onYAxisChange: (value: string) => void;
}

type PlotProps = {
  data: Data[];
  layout: Partial<Layout>;
  config: Partial<Config>;
  style?: CSSProperties;
  onInitialized?: (figure: unknown, graphDiv: HTMLElement) => void;
  onUpdate?: (figure: unknown, graphDiv: HTMLElement) => void;
};

// The factory in src/plotly.ts already returns the React component directly, so
// no CJS/ESM default-export normalization is needed here.
const NormalizedPlot = Plot as ComponentType<PlotProps>;

// Plot area height. The empty state matches it exactly, so the card does not
// change size the moment the first sample arrives.
const PLOT_HEIGHT = '245px';

// Force-release the WebGL context(s) behind a graph div.
//
// `Plotly.purge()` — which react-plotly.js calls on unmount — does NOT destroy
// the scattergl (regl) WebGL context: plotly.js issue #2852 and the still-open
// #6365. Without this, every chart rebuild allocates a new context and leaks the
// old one, and once the browser's ~8-16 context budget is exhausted it drops the
// oldest contexts and those charts silently stop rendering. WEBGL_lose_context
// is the established workaround: it tells the driver to drop the context now
// rather than whenever GC happens to collect the canvas.
//
// Both context types are probed because getContext() only returns the context
// that was actually created — asking for 'webgl2' on a 'webgl' canvas yields null.
function releaseWebglContext(graphDiv: HTMLElement) {
  for (const canvas of Array.from(graphDiv.querySelectorAll('canvas'))) {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

type AxisDescriptor =
  | { kind: 'time' }
  | { kind: 'raw'; index: number }
  | { kind: 'phy'; index: number }
  | { kind: 'par'; index: number };

function parseAxisKey(key: string): AxisDescriptor {
  if (key === 'time') return { kind: 'time' };
  if (key.startsWith('raw_')) return { kind: 'raw', index: Number(key.slice(4)) };
  if (key.startsWith('phy_')) return { kind: 'phy', index: Number(key.slice(4)) };
  if (key.startsWith('par_')) return { kind: 'par', index: Number(key.slice(4)) };
  return { kind: 'time' };
}

function resolveAxisValue(point: DataPoint, desc: AxisDescriptor): number {
  switch (desc.kind) {
    case 'time': return point.timestamp;
    case 'raw': return point.aiRaw[desc.index];
    case 'phy': return point.aiPhysical[desc.index];
    case 'par': return point.param[desc.index];
  }
}

// matplotlib/MATLAB-style data margins: return [min, max] expanded by `fraction`
// of the data span on each side (10% on X, 5% on Y). Returns null when the data
// has no finite extent, so the caller falls back to Plotly autorange. A zero
// span (all values equal) pads by 5%/10% of the magnitude, or 1 as a last
// resort, so the axis never collapses to a single point.
function paddedRange(min: number, max: number, fraction: number): [number, number] | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = max - min;
  const pad = span > 0 ? span * fraction : Math.abs(max) * fraction || 1;
  return [min - pad, max + pad];
}

function ChartPanelComponent({
  color,
  dataPoints,
  displayRevision,
  purgeEpoch,
  axisOptions,
  xAxis,
  yAxis,
  isDarkMode,
  onXAxisChange,
  onYAxisChange,
}: ChartPanelProps) {
  const xDesc = useMemo(() => parseAxisKey(xAxis), [xAxis]);
  const yDesc = useMemo(() => parseAxisKey(yAxis), [yAxis]);

  // Last graph div handed to us by react-plotly.js. Tracked so the WebGL context
  // of a replaced chart can be released explicitly — see releaseWebglContext.
  const graphDivRef = useRef<HTMLElement | null>(null);

  const handleGraphDiv = useCallback((_figure: unknown, graphDiv: HTMLElement) => {
    // A different div means the previous chart was remounted (purgeEpoch bump).
    // react-plotly.js already purged it, but the purge leaves the WebGL context
    // alive, so drop it here before it accumulates.
    const previous = graphDivRef.current;
    if (previous && previous !== graphDiv) releaseWebglContext(previous);
    graphDivRef.current = graphDiv;

    // Published to the shared store rather than shown here — the App Info panel
    // is what displays it. reportRenderBackend ignores unchanged values, so this
    // does not notify on every redraw.
    reportRenderBackend(detectRenderBackend(graphDiv));
  }, []);

  // Release the last context when the panel itself goes away (chart count change,
  // route teardown, HMR) — the remount path above never sees this one.
  useEffect(
    () => () => {
      if (graphDivRef.current) releaseWebglContext(graphDivRef.current);
      graphDivRef.current = null;
    },
    [],
  );

  const palette = useMemo(
    () =>
      isDarkMode
        ? {
            paper: '#0f172a',
            plot: '#1e293b',
            grid: '#334155',
            text: '#cbd5e1',
          }
        : {
            paper: '#f8fafc',
            plot: '#ffffff',
            grid: '#e2e8f0',
            text: '#0f172a',
          },
    [isDarkMode],
  );

  const isEmpty = dataPoints.length === 0;

  const plot = useMemo((): { traces: Data[]; xRange: [number, number] | null; yRange: [number, number] | null } => {
    if (isEmpty) return { traces: [], xRange: null, yRange: null };
    // Build x/y in a single pass into typed arrays. Plotly's date axis accepts
    // epoch-ms numbers directly, so we avoid the per-point `new Date().toISOString()`
    // allocation entirely; both axes end up numeric. Track finite min/max in the
    // same pass to compute the padded axis ranges (avoids a second O(n) scan).
    const n = dataPoints.length;
    const xData = new Float64Array(n);
    const yData = new Float64Array(n);
    const xIsTime = xDesc.kind === 'time';
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = dataPoints[i];
      const xv = xIsTime ? p.timestamp : resolveAxisValue(p, xDesc);
      const yv = resolveAxisValue(p, yDesc);
      xData[i] = xv;
      yData[i] = yv;
      if (Number.isFinite(xv)) {
        if (xv < xMin) xMin = xv;
        if (xv > xMax) xMax = xv;
      }
      if (Number.isFinite(yv)) {
        if (yv < yMin) yMin = yv;
        if (yv > yMax) yMax = yv;
      }
    }

    return {
      traces: [
        {
          x: xData,
          y: yData,
          type: 'scattergl' as const,
          mode: 'lines' as const,
          line: { color, width: 1.5 },
          name: `${yAxis} vs ${xAxis}`,
          // scattergl builds a spatial pick-index for hover, and that cost
          // scales with CHART_MAX_POINTS. Nothing here consumes hover: there is
          // no hovertemplate and no onHover/onClick handler on the Plot, so the
          // index is pure waste. 'skip' suppresses both the hover labels and the
          // hover/click events ('none' would keep firing events).
          //
          // Trade-off: this also removes the user's ability to hover a point and
          // read its value. Deleting this line restores it — but CHART_MAX_POINTS
          // was raised to 2048 on the assumption it is set, so drop it back to
          // 1024 at the same time. (Effect not yet measured on-device; see
          // docs/chart-library-comparison.md §11-1.)
          hoverinfo: 'skip' as const,
        },
      ],
      xRange: paddedRange(xMin, xMax, 0.1),
      yRange: paddedRange(yMin, yMax, 0.05),
    };
  }, [displayRevision, color, xDesc, yDesc, xAxis, yAxis, dataPoints, isEmpty]);

  const plotLayout = useMemo(
    () => ({
      autosize: true,
      paper_bgcolor: palette.paper,
      plot_bgcolor: palette.plot,
      font: { color: palette.text },
      xaxis: {
        title: { text: xAxis },
        gridcolor: palette.grid,
        type: xAxis === 'time' ? ('date' as const) : ('linear' as const),
        // Explicit padded range (matplotlib-style 10% X margin). Falls back to
        // Plotly autorange when the data has no finite extent. uirevision below
        // still lets a user's manual zoom/pan persist across data updates.
        ...(plot.xRange
          ? { range: plot.xRange, autorange: false as const }
          : { autorange: true as const }),
      },
      yaxis: {
        title: { text: yAxis },
        gridcolor: palette.grid,
        ...(plot.yRange
          ? { range: plot.yRange, autorange: false as const }
          : { autorange: true as const }),
      },
      margin: { t: 30, r: 30, b: 50, l: 50 },
      // Belt-and-braces with the trace's `hoverinfo: 'skip'`: stops Plotly from
      // running hover hit-testing on mousemove at all. On its own this would
      // only hide the labels (plotly.js#1987 — the spike lines still render),
      // which is why both are set.
      hovermode: false as const,
      uirevision: `${xAxis}-${yAxis}`,
      datarevision: displayRevision,
    }),
    [xAxis, yAxis, palette, displayRevision, plot],
  );

  const plotConfig = useMemo(
    () => ({
      displayModeBar: true,
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      doubleClick: 'reset' as const,
    }),
    [],
  );

  return (
    <section className="card card-tight space-y-0.5">
      {/* The axis pickers are chrome above a fixed-height plot, so they are kept
          to the smallest row that stays clickable — every pixel spent here is a
          pixel the chart itself does not get, four times over on this page. */}
      <div className="flex items-center gap-1.5">
        <label className="text-[0.7rem] leading-none text-slate-400">X:</label>
        <select
          value={xAxis}
          onChange={(e) => onXAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1.5 py-0 text-xs leading-tight text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          aria-label="X axis"
        >
          {axisOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <label className="text-[0.7rem] leading-none text-slate-400">Y:</label>
        <select
          value={yAxis}
          onChange={(e) => onYAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-1.5 py-0 text-xs leading-tight text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          aria-label="Y axis"
        >
          {axisOptions
            .filter((opt) => opt.key !== 'time')
            .map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
        </select>
      </div>
      {isEmpty ? (
        <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: PLOT_HEIGHT }}>
          No data — connect device and start polling
        </div>
      ) : (
        <NormalizedPlot
          key={purgeEpoch}
          data={plot.traces}
          layout={plotLayout}
          config={plotConfig}
          style={{ width: '100%', height: PLOT_HEIGHT }}
          onInitialized={handleGraphDiv}
          onUpdate={handleGraphDiv}
        />
      )}
    </section>
  );
}

// Memoized so the charts re-render only when their own inputs change
// (displayRevision, axes, color, theme) — not on every App commit driven by the
// full-rate numeric-readout state (setAiChannels etc.). All props are
// stable-identity except displayRevision, which is the intended redraw trigger.
export const ChartPanel = memo(ChartPanelComponent);
