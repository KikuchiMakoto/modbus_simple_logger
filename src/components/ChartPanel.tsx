import { type CSSProperties, type ComponentType, useCallback, useMemo, useState } from 'react';
import { type Config, type Data, type Layout } from 'plotly.js';
import { Plot } from '../plotly';
import { DataPoint } from '../types';

interface AxisOption {
  key: string;
  label: string;
}

interface ChartPanelProps {
  color: string;
  dataPoints: DataPoint[];
  displayRevision: number;
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

// Rendering backend that Plotly actually used for this chart. `scattergl` is a
// WebGL/regl trace, so on a healthy machine this reports GPU-backed WebGL; if the
// browser falls back to a software rasterizer (SwiftShader/llvmpipe) it reports
// CPU so the degradation is visible rather than silent.
type RenderBackend = { api: string; accel: 'GPU' | 'CPU' | ''; detail: string };

function detectRenderBackend(graphDiv: HTMLElement): RenderBackend {
  const canvas = graphDiv.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return { api: 'SVG/Canvas2D', accel: '', detail: 'no WebGL canvas' };

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let api = '';
  const gl2 = canvas.getContext('webgl2');
  if (gl2) {
    gl = gl2;
    api = 'WebGL2';
  } else {
    const gl1 = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl1) {
      gl = gl1;
      api = 'WebGL';
    }
  }
  if (!gl) return { api: 'Canvas2D', accel: 'CPU', detail: 'no WebGL context' };

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg
    ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(renderer);
  return { api, accel: software ? 'CPU' : 'GPU', detail: renderer };
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

export function ChartPanel({
  color,
  dataPoints,
  displayRevision,
  axisOptions,
  xAxis,
  yAxis,
  isDarkMode,
  onXAxisChange,
  onYAxisChange,
}: ChartPanelProps) {
  const xDesc = useMemo(() => parseAxisKey(xAxis), [xAxis]);
  const yDesc = useMemo(() => parseAxisKey(yAxis), [yAxis]);

  const [backend, setBackend] = useState<RenderBackend | null>(null);
  const handleGraphDiv = useCallback((_figure: unknown, graphDiv: HTMLElement) => {
    const next = detectRenderBackend(graphDiv);
    setBackend((prev) =>
      prev && prev.api === next.api && prev.accel === next.accel && prev.detail === next.detail
        ? prev
        : next,
    );
  }, []);

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

  const plotData = useMemo(() => {
    if (isEmpty) return [];
    // Build x/y in a single pass into typed arrays. Plotly's date axis accepts
    // epoch-ms numbers directly, so we avoid the per-point `new Date().toISOString()`
    // allocation entirely; both axes end up numeric.
    const n = dataPoints.length;
    const xData = new Float64Array(n);
    const yData = new Float64Array(n);
    const xIsTime = xDesc.kind === 'time';
    for (let i = 0; i < n; i++) {
      const p = dataPoints[i];
      xData[i] = xIsTime ? p.timestamp : resolveAxisValue(p, xDesc);
      yData[i] = resolveAxisValue(p, yDesc);
    }

    return [
      {
        x: xData,
        y: yData,
        type: 'scattergl' as const,
        mode: 'lines' as const,
        line: { color, width: 1.5 },
        name: `${yAxis} vs ${xAxis}`,
      },
    ];
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
      },
      yaxis: {
        title: { text: yAxis },
        gridcolor: palette.grid,
      },
      margin: { t: 30, r: 30, b: 50, l: 50 },
      uirevision: `${xAxis}-${yAxis}`,
      datarevision: displayRevision,
    }),
    [xAxis, yAxis, palette, displayRevision],
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
    <section className="card space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400">X:</label>
        <select
          value={xAxis}
          onChange={(e) => onXAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          aria-label="X axis"
        >
          {axisOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-400">Y:</label>
        <select
          value={yAxis}
          onChange={(e) => onYAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
        {!isEmpty && backend && (
          <span
            title={`Plotly render backend: ${backend.api}${backend.accel ? ` (${backend.accel})` : ''} — ${backend.detail}`}
            className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[0.6rem] font-semibold leading-none ${
              backend.accel === 'GPU'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : backend.accel === 'CPU'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {backend.api}
            {backend.accel ? ` · ${backend.accel}` : ''}
          </span>
        )}
      </div>
      {isEmpty ? (
        <div className="flex h-[280px] items-center justify-center text-sm text-slate-400">
          No data — connect device and start polling
        </div>
      ) : (
        <NormalizedPlot
          data={plotData}
          layout={plotLayout}
          config={plotConfig}
          style={{ width: '100%', height: '280px' }}
          onInitialized={handleGraphDiv}
          onUpdate={handleGraphDiv}
        />
      )}
    </section>
  );
}
