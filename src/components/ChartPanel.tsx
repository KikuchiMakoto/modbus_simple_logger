import { memo, useEffect, useId, useMemo, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import {
  type AxisDescriptor,
  ModbusSimplePlotter,
  type PlotRenderInput,
} from '../modbus_simple_plotter';
import type { DataPoint } from '../types';
import { useRenderBackend } from '../utils/renderBackend';
import { useUiScalePercent } from '../utils/uiScale';

interface AxisOption {
  key: string;
  label: string;
}

interface ChartPanelProps {
  color: string;
  dataPoints: DataPoint[];
  displayRevision: number;
  /** Used as the PlotCanvas React key: bumping it unmounts the old canvas
   * (disposing its WebGL2 context and vertex buffers) and mounts a fresh
   * one for each session. */
  purgeEpoch: number;
  axisOptions: AxisOption[];
  yAxisOptions: AxisOption[];
  /** The user's free-text label for the X / Y channel ('' = none). Resolved
   * strings rather than the whole label map, so typing a label on one channel
   * re-renders only the charts that plot it. Ignored for 'time'. */
  xLabel: string;
  yLabel: string;
  xAxis: string;
  yAxis: string;
  isDarkMode: boolean;
  onXAxisChange: (value: string) => void;
  onYAxisChange: (value: string) => void;
}

// Plot area height. The empty state matches it exactly, so the card does not
// change size the moment the first sample arrives.
//
// Exported because the launcher puts the System Log in one of the four grid
// slots: that card is not a plot, but it sits in the same row and has to be
// exactly as tall, or the grid steps.
export const PLOT_HEIGHT = '240px';

const AXIS_DESC_CACHE = new Map<string, AxisDescriptor>();

function parseAxisKey(key: string): AxisDescriptor {
  const cached = AXIS_DESC_CACHE.get(key);
  if (cached) return cached;
  let desc: AxisDescriptor;
  if (key === 'time') {
    desc = Object.freeze({ kind: 'time', index: 0 });
  } else if (key.startsWith('raw_')) {
    desc = Object.freeze({ kind: 'raw', index: Number(key.slice(4)) });
  } else if (key.startsWith('phy_')) {
    desc = Object.freeze({ kind: 'physical', index: Number(key.slice(4)) });
  } else if (key.startsWith('par_')) {
    desc = Object.freeze({ kind: 'param', index: Number(key.slice(4)) });
  } else {
    desc = Object.freeze({ kind: 'time', index: 0 });
  }
  AXIS_DESC_CACHE.set(key, desc);
  return desc;
}

interface PlotCanvasProps {
  renderInput: PlotRenderInput;
}

function PlotCanvas({ renderInput }: PlotCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotterRef = useRef<ModbusSimplePlotter | null>(null);
  const latestInputRef = useRef<PlotRenderInput>(renderInput);
  latestInputRef.current = renderInput;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const plotter = new ModbusSimplePlotter(el);
    plotterRef.current = plotter;

    const observer = new ResizeObserver(() => {
      plotter.render(latestInputRef.current);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      plotter.dispose();
      if (plotterRef.current === plotter) plotterRef.current = null;
    };
  }, []);

  useEffect(() => {
    plotterRef.current?.render(renderInput);
  }, [renderInput]);

  return (
    <div
      ref={containerRef}
      translate="no"
      className="relative w-full overflow-hidden"
      style={{ height: PLOT_HEIGHT }}
    />
  );
}

function ChartPanelComponent({
  color,
  dataPoints,
  displayRevision,
  purgeEpoch,
  axisOptions,
  yAxisOptions,
  xLabel,
  yLabel,
  xAxis,
  yAxis,
  isDarkMode,
  onXAxisChange,
  onYAxisChange,
}: ChartPanelProps) {
  const xDesc = useMemo(() => parseAxisKey(xAxis), [xAxis]);
  const yDesc = useMemo(() => parseAxisKey(yAxis), [yAxis]);
  const isPlotDisabled = yAxis === '----';

  // Read from the shared store rather than from local state: the plotter detects
  // the backend on init/fallback and App Info / App consume the same value.
  const backend = useRenderBackend();
  const uiScalePercent = useUiScalePercent();
  const backendNoteId = useId();

  const isEmpty = dataPoints.length === 0;
  const xTitle = xAxis === 'time' ? 'Timestamp' : xLabel;
  const yTitle = yLabel;

  const renderInput = useMemo<PlotRenderInput>(
    () => ({
      dataPoints,
      displayRevision,
      xDesc,
      yDesc,
      xTitle,
      yTitle,
      color,
      isDarkMode,
      uiScale: uiScalePercent / 100,
    }),
    [dataPoints, displayRevision, xDesc, yDesc, xTitle, yTitle, color, isDarkMode, uiScalePercent],
  );

  return (
    <Card className="space-y-0.5 p-1">
      <div className="flex items-center gap-1.5">
        <label className="text-[0.7rem] leading-none text-slate-400">X:</label>
        <NativeSelect
          value={xAxis}
          onChange={(e) => onXAxisChange(e.target.value)}
          className="px-1.5 py-0 leading-tight"
          aria-label="X axis"
        >
          {axisOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
        <label className="text-[0.7rem] leading-none text-slate-400">Y:</label>
        <NativeSelect
          value={yAxis}
          onChange={(e) => onYAxisChange(e.target.value)}
          className="px-1.5 py-0 leading-tight"
          aria-label="Y axis"
        >
          {yAxisOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
        {!isEmpty && !isPlotDisabled && backend && (
          <div className="group/backend relative ml-auto shrink-0">
            <Badge
              translate="no"
              tabIndex={0}
              aria-describedby={backendNoteId}
              variant={backend.accel === 'GPU' ? 'success' : backend.accel === 'CPU' ? 'warning' : 'neutral'}
              className={`block cursor-help ${backend.accel === 'GPU' || backend.accel === 'CPU' ? '' : 'bg-slate-100 dark:bg-slate-800'}`}
            >
              {backend.accel || backend.api}
            </Badge>
            <div
              id={backendNoteId}
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-56 rounded border border-sky-400 bg-sky-50 p-2 text-left text-[0.7rem] font-normal normal-case leading-snug tracking-normal text-sky-900 shadow-lg group-hover/backend:block group-focus-within/backend:block dark:border-sky-500/60 dark:bg-slate-800 dark:text-sky-200"
            >
              <strong translate="no">{backend.api}</strong> — Plot render backend
              <ul className="mt-1 list-disc space-y-0.5 pl-3">
                <li>
                  {backend.api === 'WebGL2'
                    ? 'WebGL2 instanced traces (8k cap), drawn by the GPU'
                    : 'Canvas2D fallback traces (1k cap), drawn by the CPU'}
                </li>
                <li translate="no" className="break-words">{backend.detail}</li>
                {backend.accel === 'CPU' && <li>Canvas2D fallback active — redraw rate capped to protect polling</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
      {isPlotDisabled ? (
        <div aria-hidden="true" style={{ height: PLOT_HEIGHT }} />
      ) : isEmpty ? (
        <div className="flex items-center justify-center text-sm text-slate-400" style={{ height: PLOT_HEIGHT }}>
          No data — connect device and start polling
        </div>
      ) : (
        <PlotCanvas key={purgeEpoch} renderInput={renderInput} />
      )}
    </Card>
  );
}

export const ChartPanel = memo(ChartPanelComponent);
