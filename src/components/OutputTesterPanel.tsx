import { useEffect, useRef, useState } from 'react';
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
const PRESET_STEP_V = 0.5;

const clampVolt = (v: number): number => Math.min(FULL_SCALE_V, Math.max(0, v));

// 0, 0.5, 1 … 10. Built rather than listed so the grid stays in sync with
// FULL_SCALE_V if the DAC range ever changes.
const PRESETS: number[] = (() => {
  const out: number[] = [];
  for (let v = 0; v <= FULL_SCALE_V + 1e-9; v += PRESET_STEP_V) out.push(Math.round(v * 100) / 100);
  return out;
})();

// Fraction of the slider's travel that counts as a completed swipe. Not 1.0:
// the knob is released by lifting a finger, which drifts, and demanding the
// last pixel turns a deliberate gesture into a retry.
const ZERO_SWIPE_COMMIT = 0.92;
const ZERO_KNOB_PX = 44;

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
  const [manual, setManual] = useState('');
  const [sent, setSent] = useState<string | null>(null);

  // Slide-to-zero state. knobX is the knob's offset along the track in px;
  // dragging suppresses the snap-back transition while a finger is down.
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef(0);
  const [knobX, setKnobX] = useState(0);
  const [dragging, setDragging] = useState(false);

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

  // --- Slide to zero ---
  //
  // A plain button sat one stray click away from dropping every output, which
  // on a rig under test is the most disruptive thing this window can do. The
  // gesture is the confirmation — no dialog, because a dialog someone has
  // learnt to dismiss confirms nothing, and because the whole point of the
  // control is that it is reached for when the outputs need to go down NOW.
  // Completing the swipe zeroes immediately; there is no second step.
  const maxTravel = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - ZERO_KNOB_PX);

  const beginZeroDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = e.clientX - knobX;
    setDragging(true);
  };

  const moveZeroDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setKnobX(Math.max(0, Math.min(maxTravel(), e.clientX - dragOriginRef.current)));
  };

  const endZeroDrag = () => {
    if (!dragging) return;
    setDragging(false);
    const travel = maxTravel();
    if (travel > 0 && knobX >= travel * ZERO_SWIPE_COMMIT) allZero();
    setKnobX(0);
  };

  const travelNow = maxTravel();
  const zeroProgress = travelNow > 0 ? knobX / travelNow : 0;
  const zeroArmed = zeroProgress >= ZERO_SWIPE_COMMIT;

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Output Tester"
      subtitle="Manual AO output (GP8403, 0-10 V)"
      accent="blue"
      defaultWidth={400}
      defaultHeight={480}
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

        {/* Presets output on click — this window exists to sweep a DAC by hand,
            and a confirm step on every point would double the clicks. The
            manual field below is the one that needs Apply: a half-typed number
            must not reach the hardware. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Four per row — an even count, so every row starts on a whole volt
              and the whole volts stay in the same two columns all the way down.
              They are tinted as well: 21 identically-styled buttons would have
              to be read one by one, and a sweep is usually driven off the whole
              volts with the halves as in-between points. */}
          <div className="grid grid-cols-4 gap-1">
            {PRESETS.map((v) => {
              const whole = Number.isInteger(v);
              return (
                <button
                  key={v}
                  type="button"
                  disabled={disabled}
                  onClick={() => send(v)}
                  translate="no"
                  className={`rounded border px-1 py-1 text-xs font-semibold tabular-nums disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-transparent disabled:text-slate-300 disabled:hover:bg-transparent dark:disabled:border-slate-700 dark:disabled:text-slate-600 ${
                    whole
                      ? 'border-sky-400 bg-sky-50 text-sky-700 hover:bg-sky-100 active:bg-sky-200 dark:border-sky-400/60 dark:bg-sky-400/10 dark:text-sky-300 dark:hover:bg-sky-400/20'
                      : 'border-sky-200 text-sky-600 hover:bg-sky-50 active:bg-sky-100 dark:border-sky-400/30 dark:text-sky-400/90 dark:hover:bg-sky-400/10'
                  }`}
                >
                  {v.toFixed(1)} V
                </button>
              );
            })}
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

        {/* Slide to zero. Warning-coloured because it acts on every channel at
            once, and gated by the gesture because it acts the instant the
            gesture completes. */}
        <div
          ref={trackRef}
          className={`relative h-9 select-none overflow-hidden rounded-full border ${
            disabled
              ? 'border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
              : 'border-rose-300 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10'
          }`}
        >
          {/* Fill behind the knob: the gesture's own progress bar. */}
          <div
            className={`absolute inset-y-0 left-0 bg-rose-400/30 dark:bg-rose-400/20 ${
              dragging ? '' : 'transition-[width] duration-200'
            }`}
            style={{ width: `${knobX + ZERO_KNOB_PX}px` }}
          />
          <span
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-semibold ${
              disabled
                ? 'text-slate-400 dark:text-slate-600'
                : zeroArmed
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-rose-600/80 dark:text-rose-400/80'
            }`}
          >
            {zeroArmed ? 'Release to zero all channels' : 'Slide to zero all channels →'}
          </span>
          <div
            onPointerDown={beginZeroDrag}
            onPointerMove={moveZeroDrag}
            onPointerUp={endZeroDrag}
            onPointerCancel={endZeroDrag}
            style={{ width: `${ZERO_KNOB_PX}px`, transform: `translateX(${knobX}px)` }}
            className={`absolute inset-y-0 left-0 flex touch-none items-center justify-center rounded-full text-sm font-bold ${
              disabled
                ? 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-600'
                : 'cursor-grab bg-rose-500 text-white active:cursor-grabbing dark:bg-rose-500'
            } ${dragging ? '' : 'transition-transform duration-200'}`}
            role="button"
            aria-label="Slide to set every AO channel to 0 V"
          >
            0V
          </div>
        </div>

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
