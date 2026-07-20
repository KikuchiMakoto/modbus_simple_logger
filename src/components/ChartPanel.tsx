import { type CSSProperties, type ComponentType, useMemo } from 'react';
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
};

// The factory in src/plotly.ts already returns the React component directly, so
// no CJS/ESM default-export normalization is needed here.
const NormalizedPlot = Plot as ComponentType<PlotProps>;

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
        />
      )}
    </section>
  );
}
