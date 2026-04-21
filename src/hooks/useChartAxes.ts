import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readJsonCookie, writeJsonCookie } from '../utils/cookies';

type ChartAxisSelections = {
  chart1: { x: string; y: string };
  chart2: { x: string; y: string };
};

const CHART_AXES_COOKIE_KEY = 'chart_axes_v1';

const DEFAULT_CHART_AXES: ChartAxisSelections = {
  chart1: { x: 'time', y: 'raw_00' },
  chart2: { x: 'time', y: 'raw_01' },
};

export function useChartAxes(axisOptionKeys: Set<string>) {
  const initialAxes = useMemo(() => loadChartAxes(axisOptionKeys), [axisOptionKeys]);
  const [chart1X, setChart1X] = useState(initialAxes.chart1.x);
  const [chart1Y, setChart1Y] = useState(initialAxes.chart1.y);
  const [chart2X, setChart2X] = useState(initialAxes.chart2.x);
  const [chart2Y, setChart2Y] = useState(initialAxes.chart2.y);

  useEffect(() => {
    writeJsonCookie(CHART_AXES_COOKIE_KEY, {
      chart1: { x: chart1X, y: chart1Y },
      chart2: { x: chart2X, y: chart2Y },
    });
  }, [chart1X, chart1Y, chart2X, chart2Y]);

  return { chart1X, setChart1X, chart1Y, setChart1Y, chart2X, setChart2X, chart2Y, setChart2Y };
}

function loadChartAxes(axisOptionKeys: Set<string>): ChartAxisSelections {
  const saved = readJsonCookie<Partial<ChartAxisSelections>>(CHART_AXES_COOKIE_KEY) ?? {};
  const sanitize = (value: string | undefined, fallback: string, allowTime: boolean) => {
    if (!value || !axisOptionKeys.has(value)) return fallback;
    if (!allowTime && value === 'time') return fallback;
    return value;
  };
  return {
    chart1: {
      x: sanitize(saved.chart1?.x, DEFAULT_CHART_AXES.chart1.x, true),
      y: sanitize(saved.chart1?.y, DEFAULT_CHART_AXES.chart1.y, false),
    },
    chart2: {
      x: sanitize(saved.chart2?.x, DEFAULT_CHART_AXES.chart2.x, true),
      y: sanitize(saved.chart2?.y, DEFAULT_CHART_AXES.chart2.y, false),
    },
  };
}
