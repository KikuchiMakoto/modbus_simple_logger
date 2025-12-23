import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import { DataPoint } from '../types';

interface AxisOption {
  key: string;
  label: string;
}

interface ChartPanelProps {
  title: string;
  color: string;
  dataPoints: DataPoint[];
  axisOptions: AxisOption[];
  xAxis: string;
  yAxis: string;
  onXAxisChange: (value: string) => void;
  onYAxisChange: (value: string) => void;
}

function resolveAxisValue(point: DataPoint, key: string): number {
  if (key === 'time') return point.timestamp;
  if (key.startsWith('ai')) {
    const idx = Number(key.replace('ai', ''));
    return point.ai[idx];
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
  onXAxisChange,
  onYAxisChange,
}: ChartPanelProps) {
  const plotData = useMemo(() => {
    const xData = dataPoints.map((p) => resolveAxisValue(p, xAxis));
    const yData = dataPoints.map((p) => resolveAxisValue(p, yAxis));

    return [
      {
        x: xData,
        y: yData,
        type: 'scattergl' as const,
        mode: 'lines+markers' as const,
        marker: { color, size: 3 },
        line: { color, width: 2 },
        name: `${yAxis} vs ${xAxis}`,
      },
    ];
  }, [xAxis, yAxis, dataPoints, color]);

  const plotLayout = useMemo(
    () => ({
      autosize: true,
      paper_bgcolor: '#0f172a',
      plot_bgcolor: '#1e293b',
      font: { color: '#cbd5e1' },
      xaxis: {
        title: xAxis,
        gridcolor: '#334155',
        type: xAxis === 'time' ? ('date' as const) : ('linear' as const),
      },
      yaxis: {
        title: yAxis,
        gridcolor: '#334155',
      },
      margin: { t: 30, r: 30, b: 50, l: 50 },
    }),
    [xAxis, yAxis],
  );

  const plotConfig = useMemo(
    () => ({
      displayModeBar: true,
      responsive: true,
      displaylogo: false,
    }),
    [],
  );

  return (
    <section className="card space-y-2">
      <h2 className={`text-lg font-semibold ${
        color === '#34d399' ? 'text-emerald-400' :
        color === '#60a5fa' ? 'text-blue-400' :
        color === '#f59e0b' ? 'text-amber-400' :
        'text-pink-400'
      }`}>
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs text-slate-400">X Axis</label>
          <select
            value={xAxis}
            onChange={(e) => onXAxisChange(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
          >
            {axisOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400">Y Axis</label>
          <select
            value={yAxis}
            onChange={(e) => onYAxisChange(e.target.value)}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
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
      </div>
      <Plot data={plotData} layout={plotLayout} config={plotConfig} style={{ width: '100%', height: '300px' }} />
    </section>
  );
}
