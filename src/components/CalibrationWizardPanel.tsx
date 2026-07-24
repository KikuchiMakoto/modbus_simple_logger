import { useEffect, useRef, useState } from 'react';
import { AiCalibration } from '../types';
import { specToCalibration, fitCalibration, CalibrationFitPoint } from '../utils/calibration';
import { FloatingWindow } from './FloatingWindow';

// Tap = instantaneous raw; hold ≥ LONG_PRESS_MS = mean of samples collected
// (at SAMPLE_INTERVAL_MS) until release.
const LONG_PRESS_MS = 800;
const SAMPLE_INTERVAL_MS = 50;

type CalibMethod = 'measure' | 'spec';
type SpecMode = 'pair' | 'sensitivity';

type MeasureRow = { phy: string; raw: string };

// A reference (denominator) unit for the spec method and its raw→unit slope.
//   HX711:  fixed electrical units (μV/V, mV/V, με)
//   ADS1115: 'Raw' (slope 1) and 'V'/'mV' (slope from the channel's range)
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
      className="shrink-0 rounded border border-emerald-400 px-2 py-0.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-50 active:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent dark:border-emerald-400/60 dark:text-emerald-400 dark:hover:bg-emerald-400/10 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
    >
      Grab
    </button>
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

  const inputClass =
    'w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      defaultWidth={460}
      defaultHeight={600}
    >
      <div className="flex-1 overflow-y-auto p-3">
        {/* Channel selector */}
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Channel</span>
          <select
            value={channel}
            onChange={(e) => {
              setChannel(Number(e.target.value));
              setApplied(null);
            }}
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {Array.from({ length: channelCount }, (_, i) => channelStart + i).map((ch) => (
              <option key={ch} value={ch}>
                CH {ch.toString().padStart(2, '0')}
              </option>
            ))}
          </select>
          <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
            Raw: {Math.round(getAiRaw(channel))}
          </span>
        </div>

        {/* Method tabs — measured (multi-point) first, since a spec sheet is
            often unavailable. */}
        <div className="mb-3 flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          {([
            ['measure', 'Measured'],
            ['spec', 'Spec'],
          ] as [CalibMethod, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMethod(value)}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
                method === value
                  ? 'bg-emerald-500 text-emerald-950'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {method === 'measure' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Points ({validPoints.length} valid / {draft.points.length} rows)
              </span>
              <button
                type="button"
                onClick={() => patch({ points: [...draft.points, { phy: '', raw: '' }] })}
                className="rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
              >
                + Add row
              </button>
            </div>
            <div className="flex items-center gap-1.5 px-1 text-[11px] text-slate-400 dark:text-slate-500">
              <span className="w-5 shrink-0">#</span>
              <span className="flex-1">Physical</span>
              <span className="flex-1">Raw</span>
              <span className="w-[76px] shrink-0" />
            </div>
            {draft.points.map((row, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-xs text-slate-500 dark:text-slate-400">
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
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
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
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-sm tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
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
                  className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-semibold text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-400 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>
            ))}
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Grab: tap = instant, hold = average. 2 pts → line (a=0), 3+ pts → quadratic least squares.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Reference (denominator) unit — the only unit that affects b */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                {referenceLabel} — sets slope b
              </label>
              <select
                value={selectedDenom?.value ?? ''}
                onChange={(e) => patch({ denomUnit: e.target.value })}
                className={inputClass}
              >
                {denomOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Spec input mode */}
            <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
              {([
                ['pair', 'Rated pair'],
                ['sensitivity', 'Sensitivity'],
              ] as [SpecMode, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch({ specMode: value })}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors ${
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
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">Rated output</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.ratedOutput}
                    onChange={(e) => patch({ ratedOutput: e.target.value })}
                    placeholder="e.g. 2.0"
                    className={inputClass}
                  />
                  <span className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">{denomLabel}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">Physical</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft.physQty}
                    onChange={(e) => patch({ physQty: e.target.value })}
                    placeholder="e.g. 5"
                    className={inputClass}
                  />
                  <span className="w-14 shrink-0" />
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Slope b = physical ÷ rated output (× reference-unit scale).
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-xs text-slate-500 dark:text-slate-400">Sensitivity</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={draft.sensitivity}
                  onChange={(e) => patch({ sensitivity: e.target.value })}
                  placeholder="e.g. 2.5"
                  className={inputClass}
                />
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">/{denomLabel}</span>
              </div>
            )}
          </div>
        )}

        {/* Preview + Apply */}
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Preview</div>
          {result ? (
            <div className="grid grid-cols-3 gap-2 tabular-nums">
              <div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">a</div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.a)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">b</div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.b)}</div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">c</div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{formatCoeff(result.c)}</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400 dark:text-slate-500">
              {method === 'measure' && validPoints.length >= 2
                ? 'Cannot compute: Raw values are degenerate (no unique fit).'
                : 'Not enough input.'}
            </div>
          )}
        </div>

        {locked && (
          <div className="mt-2 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Apply is disabled while a script is running (preview still works).
          </div>
        )}

        {applied && !locked && (
          <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
            {applied}
          </div>
        )}

        <button
          type="button"
          disabled={!result || locked}
          onClick={handleApply}
          className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-emerald-950 shadow hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Apply to this channel (overwrite a, b, c)
        </button>
      </div>
    </FloatingWindow>
  );
}
