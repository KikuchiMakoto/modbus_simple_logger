import { useEffect, useState } from 'react';
import { FloatingWindow } from './FloatingWindow';

/**
 * Manual AO exerciser: pick a channel, click a voltage, watch the wire.
 *
 * Deliberately unit-less beyond volts. The AI side has calibration turning raw
 * counts into a physical quantity; the output side has nothing equivalent and
 * this window does not invent one — what it commands is the DAC's own 0-10 V,
 * which is why it is a Tester and not an "Output Config".
 */

const FULL_SCALE_V = 10;
const STEPS = [1, 0.5] as const;
type Step = (typeof STEPS)[number];

const clampVolt = (v: number): number => Math.min(FULL_SCALE_V, Math.max(0, v));

// 0, step, 2·step … 10. Built rather than listed so the 0.5 V row stays in sync
// with FULL_SCALE_V if the DAC range ever changes.
const presetsFor = (step: Step): number[] => {
  const out: number[] = [];
  for (let v = 0; v <= FULL_SCALE_V + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

type OutputTesterPanelProps = {
  open: boolean;
  onClose: () => void;
  channelCount: number;
  /** Commanded voltage per channel, as the app currently holds it. */
  voltages: number[];
  /** Free labels from the AO cards, so the dropdown matches the main screen. */
  labels: string[];
  onSetVoltage: (ch: number, volts: number) => void;
  /** No link, no output — the write would go nowhere. */
  connected: boolean;
  /** scriptRunning: a script owns AO while it runs; two writers would fight. */
  locked: boolean;
};

export function OutputTesterPanel({
  open,
  onClose,
  channelCount,
  voltages,
  labels,
  onSetVoltage,
  connected,
  locked,
}: OutputTesterPanelProps) {
  const [channel, setChannel] = useState(0);
  const [step, setStep] = useState<Step>(1);
  const [manual, setManual] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  // A stale "Sent 5.000 V" under a channel it was not sent to would be a lie.
  useEffect(() => setSent(null), [channel]);

  const disabled = !connected || locked;
  const current = voltages[channel] ?? 0;

  const send = (volts: number) => {
    if (disabled) return;
    const clamped = clampVolt(volts);
    onSetVoltage(channel, clamped);
    setSent(`Sent ${clamped.toFixed(3)} V to CH ${channel.toString().padStart(2, '0')}`);
  };

  const manualValue = Number(manual);
  const manualValid = manual.trim() !== '' && Number.isFinite(manualValue);

  const applyManual = () => {
    if (!manualValid) return;
    send(manualValue);
  };

  const allZero = () => {
    if (disabled) return;
    for (let ch = 0; ch < channelCount; ch++) onSetVoltage(ch, 0);
    setSent('All channels set to 0.000 V');
  };

  const presets = presetsFor(step);

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Output Tester"
      subtitle="Manual AO output (GP8403, 0-10 V)"
      accent="blue"
      defaultWidth={400}
      defaultHeight={440}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {/* Channel + live commanded value */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-200">Channel</span>
          <select
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          >
            {Array.from({ length: channelCount }, (_, ch) => (
              <option key={ch} value={ch}>
                CH {ch.toString().padStart(2, '0')}
                {labels[ch] ? ` — ${labels[ch]}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div
          translate="no"
          className="flex items-baseline justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Now</span>
          <span className="tabular-nums text-2xl font-bold leading-none text-sky-600 dark:text-sky-400">
            {current.toFixed(3)}
            <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">V</span>
          </span>
        </div>

        {/* Step selector for the preset grid below. */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[11px] font-semibold text-slate-600 dark:text-slate-300">Step</span>
          <div className="flex flex-1 rounded border border-slate-200 p-0.5 dark:border-slate-700">
            {STEPS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStep(s)}
                className={`flex-1 rounded-sm px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                  step === s
                    ? 'bg-sky-500 text-sky-950'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {s} V
              </button>
            ))}
          </div>
        </div>

        {/* Presets output on click — this window exists to sweep a DAC by hand,
            and a confirm step on every point would double the clicks. The
            manual field below is the one that needs Apply: a half-typed number
            must not reach the hardware. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1">
            {presets.map((v) => (
              <button
                key={v}
                type="button"
                disabled={disabled}
                onClick={() => send(v)}
                translate="no"
                className="rounded border border-sky-400 px-1 py-1 text-xs font-semibold tabular-nums text-sky-600 hover:bg-sky-50 active:bg-sky-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent dark:border-sky-400/60 dark:text-sky-400 dark:hover:bg-sky-400/10 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
              >
                {v.toFixed(1)} V
              </button>
            ))}
          </div>
        </div>

        {/* Manual entry */}
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyManual();
            }}
            placeholder="0.000"
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-right text-sm tabular-nums text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
          />
          <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">V</span>
          <button
            type="button"
            disabled={disabled || !manualValid}
            onClick={applyManual}
            className="shrink-0 rounded bg-sky-500 px-3 py-1 text-xs font-semibold text-sky-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply
          </button>
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={allZero}
          title="Set every AO channel to 0 V"
          className="rounded border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-rose-400 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-rose-400 dark:hover:text-rose-400"
        >
          All channels → 0 V
        </button>

        {/* One status line, in priority order: why output is blocked first,
            what was last sent second. */}
        {!connected ? (
          <p className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Not connected — connect the device to output.
          </p>
        ) : locked ? (
          <p className="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            A script is running and is driving AO. Stop it to output from here.
          </p>
        ) : sent ? (
          <p className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300">
            {sent}
          </p>
        ) : (
          <p className="px-2 text-[11px] text-slate-400 dark:text-slate-500">
            Presets output immediately. Values above 10 V are clamped.
          </p>
        )}
      </div>
    </FloatingWindow>
  );
}
