import { useEffect, useRef, useState } from 'react';
import { AiCalibration } from '../types';
import { specToCalibration, fitCalibration, CalibrationFitPoint } from '../utils/calibration';
import { downloadCalibrationTsv } from '../utils/calibrationExport';
import { FloatingWindow } from './FloatingWindow';

// Tap = instantaneous raw; hold ≥ LONG_PRESS_MS = mean of samples collected
// (at SAMPLE_INTERVAL_MS) until release.
const LONG_PRESS_MS = 800;
const SAMPLE_INTERVAL_MS = 50;

type CalibMethod = 'measure' | 'spec';
type SpecMode = 'pair' | 'sensitivity';

type MeasureRow = { phy: string; raw: string };

// A reference (denominator) unit for the spec method and its raw→unit slope.
//   HX711:   fixed electrical units (μV/V, mV/V, με)
//   ADS1115: only the channel's V/mV slope (Voltage Config range must be set)
export type DenominatorOption = { value: string; label: string; slopePerRaw: number };

// Captured raw is kept to sub-count precision (averaging reduces noise) but
// trimmed to 3 decimals so the cell stays readable.
const formatCapturedRaw = (raw: number): string => String(Math.round(raw * 1000) / 1000);

type ChannelDraft = {
  denomUnit: string;
  specMode: SpecMode;
  ratedOutput: string; // reference-unit value at rated output (pair mode)
  physQty: string;     // physical value at rated output (pair mode)
  sensitivity: string; // direct sensitivity (sensitivity mode)
  points: MeasureRow[];
};

const makeDefaultDraft = (defaultDenomUnit: string): ChannelDraft => ({
  denomUnit: defaultDenomUnit,
  specMode: 'pair',
  ratedOutput: '',
  physQty: '',
  sensitivity: '',
  points: [
    { phy: '', raw: '' },
    { phy: '', raw: '' },
  ],
});

const formatCoeff = (x: number): string => {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs < 1e-3 || abs >= 1e6) return x.toExponential(4);
  return x.toPrecision(6);
};

type CaptureButtonProps = {
  getRaw: () => number;
  onCapture: (raw: number) => void;
  disabled?: boolean;
};

// Single button doing tap = instant, hold = averaged capture. Uses pointer
// capture so release is detected even if the pointer drifts off the button.
function CaptureButton({ getRaw, onCapture, disabled = false }: CaptureButtonProps) {
  const startRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const activeRef = useRef(false);
  const intervalRef = useRef<number | undefined>(undefined);

  const stopSampling = () => {
    if (intervalRef.current !== undefined) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  };

  useEffect(() => () => stopSampling(), []);

  const begin = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || activeRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    activeRef.current = true;
    startRef.current = performance.now();
    samplesRef.current = [getRaw()];
    intervalRef.current = window.setInterval(() => {
      samplesRef.current.push(getRaw());
    }, SAMPLE_INTERVAL_MS);
  };

  const end = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    stopSampling();
    const elapsed = performance.now() - startRef.current;
    const samples = samplesRef.current;
    if (elapsed >= LONG_PRESS_MS && samples.length > 0) {
      const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
      onCapture(avg);
    } else {
      onCapture(getRaw());
    }
  };

  const cancel = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    stopSampling();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={cancel}
      title="Tap = instant · Hold (≥0.8s) = average until release"
      className="shrink-0 rounded border border-emerald-400 px-1.5 py-0 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent dark:border-emerald-400/60 dark:text-emerald-400 dark:hover:bg-emerald-400/10 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
    >
      Grab
    </button>
  );
}

// Lightweight dependency-free X–Y scatter (X = Raw, Y = Physical) with the
// fitted a·x²+b·x+c curve overlaid, so linearity is visible while calibrating.
function CalibrationPlot({ points, fit }: { points: CalibrationFitPoint[]; fit: AiCalibration | null }) {
  const W = 420;
  const H = 118;
  const m = { l: 8, r: 8, t: 10, b: 12 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  if (points.length === 0) {
    return (
      <div className="flex h-[118px] w-full items-center justify-center rounded border border-slate-200 bg-slate-50 text-[11px] text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500">
        Add points to see the X–Y plot
      </div>
    );
  }

  let xMin = Math.min(...points.map((p) => p.raw));
  let xMax = Math.max(...points.map((p) => p.raw));
  let yMin = Math.min(...points.map((p) => p.phy));
  let yMax = Math.max(...points.map((p) => p.phy));

  const curve: { x: number; y: number }[] = [];
  if (fit && xMax > xMin) {
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const x = xMin + ((xMax - xMin) * i) / N;
      const y = fit.a * x * x + fit.b * x + fit.c;
      if (Number.isFinite(y)) {
        curve.push({ x, y });
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
  }

  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const padX = (xMax - xMin) * 0.08;
  const padY = (yMax - yMin) * 0.08;
  xMin -= padX;
  xMax += padX;
  yMin -= padY;
  yMax += padY;

  const sx = (x: number) => m.l + ((x - xMin) / (xMax - xMin)) * pw;
  const sy = (y: number) => m.t + (1 - (y - yMin) / (yMax - yMin)) * ph;

  const curvePath = curve
    .map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[118px] w-full rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
    >
      <rect
        x={m.l}
        y={m.t}
        width={pw}
        height={ph}
        strokeWidth={1}
        className="fill-none stroke-slate-200 dark:stroke-slate-700"
      />
      {curvePath && (
        <path d={curvePath} strokeWidth={1.5} className="fill-none stroke-emerald-500" />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.raw)} cy={sy(p.phy)} r={2.5} className="fill-slate-500 dark:fill-slate-200" />
      ))}
      <text x={m.l + 1} y={8} fontSize={8} className="fill-slate-400 dark:fill-slate-500">
        Phy ↑
      </text>
      <text x={W - m.r} y={H - 3} textAnchor="end" fontSize={8} className="fill-slate-400 dark:fill-slate-500">
        Raw →
      </text>
    </svg>
  );
}

type CalibrationWizardPanelProps = {
  open: boolean;
  onClose: () => void;
  // scriptRunning — freezes Apply (writing scale coefficients).
  locked: boolean;
  title: string;
  subtitle?: string;
  channelStart: number;
  channelCount: number;
  // Reference-unit label shown for the spec method's denominator selector.
  referenceLabel: string;
  defaultDenomUnit: string;
  getDenominatorOptions: (ch: number) => DenominatorOption[];
  getAiRaw: (ch: number) => number;
  onApply: (ch: number, cal: AiCalibration) => void;
};

export function CalibrationWizardPanel({
  open,
  onClose,
  locked,
  title,
  subtitle,
  channelStart,
  channelCount,
  referenceLabel,
  defaultDenomUnit,
  getDenominatorOptions,
  getAiRaw,
  onApply,
}: CalibrationWizardPanelProps) {
  const [channel, setChannel] = useState(channelStart);
  const [method, setMethod] = useState<CalibMethod>('measure');
  const [drafts, setDrafts] = useState<Record<number, ChannelDraft>>({});
  const [applied, setApplied] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);

  // Re-render a few times a second while open so the live Raw readout ticks
  // (the panel otherwise only re-renders on interaction).
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => forceTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [open]);

  const draft = drafts[channel] ?? makeDefaultDraft(defaultDenomUnit);

  const patch = (partial: Partial<ChannelDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [channel]: { ...(prev[channel] ?? makeDefaultDraft(defaultDenomUnit)), ...partial },
    }));
    setApplied(null);
    setDownloaded(null);
  };

  // --- Spec preview ---
  const denomOptions = getDenominatorOptions(channel);
  const selectedDenom =
    denomOptions.find((o) => o.value === draft.denomUnit) ?? denomOptions[0];
  const denomLabel = selectedDenom?.label ?? '';

  const specSensitivity: number | null = (() => {
    if (draft.specMode === 'pair') {
      if (draft.ratedOutput.trim() === '' || draft.physQty.trim() === '') return null;
      const rated = Number(draft.ratedOutput);
      const phy = Number(draft.physQty);
      if (!Number.isFinite(rated) || rated === 0 || !Number.isFinite(phy)) return null;
      return phy / rated;
    }
    if (draft.sensitivity.trim() === '') return null;
    const s = Number(draft.sensitivity);
    return Number.isFinite(s) ? s : null;
  })();

  const specResult: AiCalibration | null =
    specSensitivity === null || !selectedDenom
      ? null
      : specToCalibration(specSensitivity, selectedDenom.slopePerRaw);

  // --- Measured preview ---
  const validPoints: CalibrationFitPoint[] = draft.points
    .filter(
      (p) =>
        p.raw.trim() !== '' &&
        p.phy.trim() !== '' &&
        Number.isFinite(Number(p.raw)) &&
        Number.isFinite(Number(p.phy)),
    )
    .map((p) => ({ raw: Number(p.raw), phy: Number(p.phy) }));

  const measureResult: AiCalibration | null =
    validPoints.length >= 2 ? fitCalibration(validPoints) : null;

  const result = method === 'measure' ? measureResult : specResult;

  const handleApply = () => {
    if (!result || locked) return;
    onApply(channel, result);
    setApplied(
      `Applied to CH ${channel.toString().padStart(2, '0')}: ` +
        `a=${formatCoeff(result.a)}, b=${formatCoeff(result.b)}, c=${formatCoeff(result.c)}`,
    );
  };

  // Measured only — the Spec tab has no sample table to write out. Downloadable
  // as soon as a point exists, with or without a usable fit: a degenerate set is
  // still worth keeping a record of. Unlike Apply this writes nothing to the
  // device, so it stays available while a script holds the calibration locked.
  const canDownload = validPoints.length > 0;

  const handleDownload = () => {
    if (!canDownload) return;
    const name = downloadCalibrationTsv({
      title,
      channel,
      result: measureResult,
      points: validPoints,
      totalRows: draft.points.length,
      liveRaw: getAiRaw(channel),
    });
    setDownloaded(name);
  };

  const inputClass =
    'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      defaultWidth={420}
      defaultHeight={560}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Pinned top: channel + tabs, plus the plot / points controls /
            column header while in the Measured method. */}
        <div className="shrink-0 space-y-1.5 p-2 pb-1.5">
          {/* Channel selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Channel</span>
            <select
              value={channel}
              onChange={(e) => {
                setChannel(Number(e.target.value));
                setApplied(null);
                setDownloaded(null);
              }}
              className="flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
            >
              {Array.from({ length: channelCount }, (_, i) => channelStart + i).map((ch) => (
                <option key={ch} value={ch}>
                  CH {ch.toString().padStart(2, '0')}
                </option>
              ))}
            </select>
            <span translate="no" className="tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
              Raw: {Math.round(getAiRaw(channel))}
            </span>
          </div>

          {/* Method tabs — measured (multi-point) first, since a spec sheet is
              often unavailable. */}
          <div className="flex rounded border border-slate-200 p-0.5 dark:border-slate-700">
            {([
              ['measure', 'Measured'],
              ['spec', 'Spec'],
            ] as [CalibMethod, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMethod(value);
                  setDownloaded(null);
                }}
                className={`flex-1 rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  method === value
                    ? 'bg-emerald-500 text-emerald-950'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {method === 'measure' && (
            <>
              <CalibrationPlot points={validPoints} fit={measureResult} />
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  Points ({validPoints.length} valid / {draft.points.length} rows)
                </span>
                <button
                  type="button"
                  onClick={() => patch({ points: [...draft.points, { phy: '', raw: '' }] })}
                  className="rounded border border-slate-300 px-1.5 py-0 text-[11px] font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
                >
                  + Add row
                </button>
              </div>
              <div className="flex items-center gap-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                <span className="w-4 shrink-0">#</span>
                <span translate="no" className="flex-1">Physical</span>
                <span translate="no" className="flex-1">Raw</span>
                <span className="w-[66px] shrink-0" />
              </div>
            </>
          )}
        </div>

        {/* Scrolling middle: the variable-length content. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          {method === 'measure' ? (
            <div className="space-y-1 pb-2">
              {draft.points.map((row, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <span className="w-4 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">
                    {idx + 1}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.phy}
                    onChange={(e) => {
                      const points = draft.points.slice();
                      points[idx] = { ...points[idx], phy: e.target.value };
                      patch({ points });
                    }}
                    placeholder="Physical"
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.raw}
                    onChange={(e) => {
                      const points = draft.points.slice();
                      points[idx] = { ...points[idx], raw: e.target.value };
                      patch({ points });
                    }}
                    placeholder="Raw"
                    className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-0.5 text-right text-xs tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <CaptureButton
                    getRaw={() => getAiRaw(channel)}
                    onCapture={(raw) => {
                      const points = draft.points.slice();
                      points[idx] = { ...points[idx], raw: formatCapturedRaw(raw) };
                      patch({ points });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => patch({ points: draft.points.filter((_, i) => i !== idx) })}
                    title="Remove row"
                    className="shrink-0 rounded border border-slate-300 px-1 py-0 text-[11px] font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:text-slate-200"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Grab: tap = instant, hold = average. 2 pts → line (a=0), 3+ pts → quadratic least squares.
              </p>
            </div>
          ) : (
            <div className="space-y-2 py-1">
              {/* Reference (denominator) unit — the only unit that affects b */}
              <div>
                <label className="mb-0.5 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {referenceLabel} — sets slope b
                </label>
                <select
                  value={selectedDenom?.value ?? ''}
                  onChange={(e) => patch({ denomUnit: e.target.value })}
                  className={inputClass}
                  disabled={denomOptions.length === 0}
                >
                  {denomOptions.length === 0 && (
                    <option value="">(no options)</option>
                  )}
                  {denomOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {denomOptions.length === 0 && (
                  <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    Set the voltage range in the main app's Voltage Config first, then come back.
                  </p>
                )}
              </div>

              {/* Spec input mode */}
              <div className="flex rounded border border-slate-200 p-0.5 dark:border-slate-700">
                {([
                  ['pair', 'Rated pair'],
                  ['sensitivity', 'Sensitivity'],
                ] as [SpecMode, string][]).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => patch({ specMode: value })}
                    className={`flex-1 rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                      draft.specMode === value
                        ? 'bg-slate-600 text-white dark:bg-slate-500'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {draft.specMode === 'pair' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">Rated output</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.ratedOutput}
                      onChange={(e) => patch({ ratedOutput: e.target.value })}
                      placeholder="e.g. 2.0"
                      className={inputClass}
                    />
                    <span className="w-12 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{denomLabel}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">Physical</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft.physQty}
                      onChange={(e) => patch({ physQty: e.target.value })}
                      placeholder="e.g. 5"
                      className={inputClass}
                    />
                    <span className="w-12 shrink-0" />
                  </div>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500">
                    Slope b = physical ÷ rated output (× reference-unit scale).
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="w-20 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">Sensitivity</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.sensitivity}
                    onChange={(e) => patch({ sensitivity: e.target.value })}
                    placeholder="e.g. 2.5"
                    className={inputClass}
                  />
                  <span className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400">/{denomLabel}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pinned bottom: preview + apply. */}
        <div className="shrink-0 space-y-1.5 border-t border-slate-200 p-2 pt-1.5 dark:border-slate-700">
          <div className="rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
            <div className="mb-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">Preview</div>
            {result ? (
              <div className="grid grid-cols-3 gap-1.5 tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">a</div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.a)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">b</div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.b)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">c</div>
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.c)}</div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 dark:text-slate-500">
                {method === 'measure' && validPoints.length >= 2
                  ? 'Cannot compute: Raw values are degenerate (no unique fit).'
                  : 'Not enough input.'}
              </div>
            )}
          </div>

          {locked && (
            <div className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Apply is disabled while a script is running (preview still works).
            </div>
          )}

          {applied && !locked && (
            <div className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
              {applied}
            </div>
          )}

          {downloaded && method === 'measure' && (
            <div className="truncate rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300">
              Saved {downloaded}
            </div>
          )}

          <button
            type="button"
            disabled={!result || locked}
            onClick={handleApply}
            className="w-full rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply (overwrite a,b,c)
          </button>

          {/* Measured only: the Spec tab has no points to write out. */}
          {method === 'measure' && (
            <button
              type="button"
              disabled={!canDownload}
              onClick={handleDownload}
              title="Save the points and coefficients as a TSV file"
              className="w-full rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-300 disabled:hover:text-slate-600 dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400 dark:disabled:hover:border-slate-600 dark:disabled:hover:text-slate-300"
            >
              Download TSV
            </button>
          )}
        </div>
      </div>
    </FloatingWindow>
  );
}
