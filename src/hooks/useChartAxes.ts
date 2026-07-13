import { useEffect, useMemo, useState } from 'react';
import { readJsonCookie, writeJsonCookie } from '../utils/cookies';

type ChartAxes = { x: string; y: string };

type ChartAxisSelections = {
  chart1: ChartAxes;
  chart2: ChartAxes;
  chart3: ChartAxes;
  chart4: ChartAxes;
};

const CHART_AXES_COOKIE_KEY = 'chart_axes_v1';

const DEFAULT_CHART_AXES: ChartAxisSelections = {
  chart1: { x: 'time', y: 'raw_00' },
  chart2: { x: 'time', y: 'raw_01' },
  chart3: { x: 'time', y: 'raw_02' },
  chart4: { x: 'time', y: 'raw_03' },
};

export function useChartAxes(axisOptionKeys: Set<string>) {
  const initialAxes = useMemo(() => loadChartAxes(axisOptionKeys), [axisOptionKeys]);
  const [chart1X, setChart1X] = useState(initialAxes.chart1.x);
  const [chart1Y, setChart1Y] = useState(initialAxes.chart1.y);
  const [chart2X, setChart2X] = useState(initialAxes.chart2.x);
  const [chart2Y, setChart2Y] = useState(initialAxes.chart2.y);
  const [chart3X, setChart3X] = useState(initialAxes.chart3.x);
  const [chart3Y, setChart3Y] = useState(initialAxes.chart3.y);
  const [chart4X, setChart4X] = useState(initialAxes.chart4.x);
  const [chart4Y, setChart4Y] = useState(initialAxes.chart4.y);

  useEffect(() => {
    writeJsonCookie(CHART_AXES_COOKIE_KEY, {
      chart1: { x: chart1X, y: chart1Y },
      chart2: { x: chart2X, y: chart2Y },
      chart3: { x: chart3X, y: chart3Y },
      chart4: { x: chart4X, y: chart4Y },
    });
  }, [chart1X, chart1Y, chart2X, chart2Y, chart3X, chart3Y, chart4X, chart4Y]);

  return {
    chart1X, setChart1X, chart1Y, setChart1Y,
    chart2X, setChart2X, chart2Y, setChart2Y,
    chart3X, setChart3X, chart3Y, setChart3Y,
    chart4X, setChart4X, chart4Y, setChart4Y,
  };
}

function loadChartAxes(axisOptionKeys: Set<string>): ChartAxisSelections {
  const saved = readJsonCookie<Partial<ChartAxisSelections>>(CHART_AXES_COOKIE_KEY) ?? {};
  const sanitize = (value: string | undefined, fallback: string, allowTime: boolean) => {
    if (!value || !axisOptionKeys.has(value)) return fallback;
    if (!allowTime && value === 'time') return fallback;
    return value;
  };
  const load = (key: keyof ChartAxisSelections): ChartAxes => ({
    x: sanitize(saved[key]?.x, DEFAULT_CHART_AXES[key].x, true),
    y: sanitize(saved[key]?.y, DEFAULT_CHART_AXES[key].y, false),
  });
  return {
    chart1: load('chart1'),
    chart2: load('chart2'),
    chart3: load('chart3'),
    chart4: load('chart4'),
  };
}
