import { type CSSProperties, type ComponentType, useMemo } from 'react';
import { type Config, type Data, type Layout } from 'plotly.js';
import Plot from 'react-plotly.js';
import { DataPoint } from '../types';

interface AxisOption {
  key: string;
  label: string;
}

interface ChartPanelProps {
  title?: string;
  color: string;
  dataPoints: DataPoint[];
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

const isInteropDefaultExport = (
  value: unknown,
): value is { default: ComponentType<PlotProps> } =>
  typeof value === 'object' && value !== null && 'default' in value;

// react-plotly.js can be returned as either the component itself or { default: component }
// depending on CJS/ESM interop, which can otherwise cause React runtime error #130.
const NormalizedPlot: ComponentType<PlotProps> = isInteropDefaultExport(Plot)
  ? Plot.default
  : Plot;

function resolveAxisValue(point: DataPoint, key: string): number {
  if (key === 'time') return point.timestamp;
  if (key.startsWith('raw_')) {
    const idx = Number(key.replace('raw_', ''));
    return point.aiRaw[idx];
  }
  if (key.startsWith('phy_')) {
    const idx = Number(key.replace('phy_', ''));
    return point.aiPhysical[idx];
  }
  if (key.startsWith('vlt_')) {
    const idx = Number(key.replace('vlt_', ''));
    return point.aiVoltage[idx] ?? 0;
  }
  return 0;
}

export function ChartPanel({
  title,
  color,
  dataPoints,
  axisOptions,
  xAxis,
  yAxis,
  isDarkMode,
  onXAxisChange,
  onYAxisChange,
}: ChartPanelProps) {
  const isWebGLAvailable = useMemo(() => {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
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

  const plotData = useMemo(() => {
    const xData = dataPoints.map((p) => resolveAxisValue(p, xAxis));
    const yData = dataPoints.map((p) => resolveAxisValue(p, yAxis));

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
  }, [xAxis, yAxis, dataPoints, color]);

  // Extract datarevision value so plotLayout memo doesn't depend on the entire array
  const dataRevision = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1].timestamp : 0;

  const plotLayout = useMemo(
    () => ({
      autosize: true,
      paper_bgcolor: palette.paper,
      plot_bgcolor: palette.plot,
      font: { color: palette.text },
      xaxis: {
        title: xAxis,
        gridcolor: palette.grid,
        type: xAxis === 'time' ? ('date' as const) : ('linear' as const),
      },
      yaxis: {
        title: yAxis,
        gridcolor: palette.grid,
      },
      margin: { t: 30, r: 30, b: 50, l: 50 },
      uirevision: `${xAxis}-${yAxis}`,
      datarevision: dataRevision,
    }),
    [xAxis, yAxis, palette, dataRevision],
  );

  const plotConfig = useMemo(
    () => ({
      displayModeBar: true,
      responsive: true,
      displaylogo: false,
      // Optimize rendering performance
      scrollZoom: true,
      doubleClick: 'reset' as const,
    }),
    [],
  );

  return (
    <section className="card space-y-1.5">
      <div className="flex items-center gap-2">
        {title ? (
          <h2 className={`text-lg font-semibold ${
            color === '#34d399' ? 'text-emerald-400' :
            color === '#60a5fa' ? 'text-blue-400' :
            color === '#f59e0b' ? 'text-amber-400' :
            'text-pink-400'
          }`}>
            {title}
          </h2>
        ) : null}
        <span className={`text-xs ${isWebGLAvailable ? 'text-emerald-500' : 'text-amber-500'}`}>
          GPU(WebGL): {isWebGLAvailable ? 'ON' : 'OFF'}
        </span>
        <span className="text-xs text-slate-400">X:</span>
        <select
          value={xAxis}
          onChange={(e) => onXAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          {axisOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">Y:</span>
        <select
          value={yAxis}
          onChange={(e) => onYAxisChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
      <NormalizedPlot
        data={plotData}
        layout={plotLayout}
        config={plotConfig}
        style={{ width: '100%', height: '300px' }}
      />
    </section>
  );
}
