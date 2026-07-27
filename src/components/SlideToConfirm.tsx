import { useRef, useState } from 'react';

/**
 * Drag-across control for an action that must not happen by accident.
 *
 * The gesture IS the confirmation — the action fires the moment the knob is
 * released past the commit point, with no dialog behind it. That is deliberate:
 * a dialog someone has learnt to dismiss confirms nothing, and both users of
 * this control (zeroing every output, dropping the serial link) are reached for
 * exactly when the thing needs to happen now.
 */

// Fraction of the travel that counts as a completed swipe. Not 1.0: the knob is
// released by lifting a finger, which drifts, and demanding the last pixel turns
// a deliberate gesture into a retry.
const COMMIT_FRACTION = 0.92;

/**
 * How loudly the control announces itself. The gesture is the same either way —
 * this is only about whether the action deserves the eye it pulls.
 *
 *   warn    destructive: dropping every output, discarding an editor's contents
 *   neutral guarded but unremarkable: it should not happen by accident, and it
 *           is not news when it does
 */
export type SlideTone = 'warn' | 'neutral';

const TONE = {
  warn: {
    track: 'border-rose-300 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10',
    fill: 'bg-rose-400/30 dark:bg-rose-400/20',
    label: 'text-rose-600/80 dark:text-rose-400/80',
    labelArmed: 'text-rose-700 dark:text-rose-300',
    knob: 'bg-rose-500 text-white',
  },
  neutral: {
    track: 'border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60',
    fill: 'bg-slate-400/25 dark:bg-slate-400/15',
    label: 'text-slate-500 dark:text-slate-400',
    labelArmed: 'text-slate-700 dark:text-slate-200',
    knob: 'bg-slate-500 text-white dark:bg-slate-600',
  },
} as const;

type SlideToConfirmProps = {
  /** Shown across the track before the commit point is reached. */
  label: string;
  /** Shown once a release would fire. */
  armedLabel: string;
  /** Text inside the knob itself. Keep it to a few characters. */
  knobLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  tone?: SlideTone;
  /**
   * Knob width in px. Set it to the track's INNER height — the height in
   * `className` minus the 1px border on each side — or the knob renders as a
   * pill rather than a circle and the progress fill, which is exactly this
   * wide, stops short of or overhangs its edge.
   */
  knobPx?: number;
  /** Height/typography classes, so a header control can match its neighbours. */
  className?: string;
  labelClassName?: string;
  'aria-label'?: string;
};

export function SlideToConfirm({
  label,
  armedLabel,
  knobLabel,
  onConfirm,
  disabled = false,
  tone = 'warn',
  // Defaults are a matched pair: h-9 is 36 px, less 1 px of border a side.
  knobPx = 34,
  className = 'h-9',
  labelClassName = 'text-[11px]',
  'aria-label': ariaLabel,
}: SlideToConfirmProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragOriginRef = useRef(0);
  const [knobX, setKnobX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const maxTravel = () => Math.max(0, (trackRef.current?.clientWidth ?? 0) - knobPx);

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOriginRef.current = e.clientX - knobX;
    setDragging(true);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setKnobX(Math.max(0, Math.min(maxTravel(), e.clientX - dragOriginRef.current)));
  };

  const end = () => {
    if (!dragging) return;
    setDragging(false);
    const travel = maxTravel();
    if (travel > 0 && knobX >= travel * COMMIT_FRACTION) onConfirm();
    setKnobX(0);
  };

  const travelNow = maxTravel();
  const armed = travelNow > 0 && knobX >= travelNow * COMMIT_FRACTION;
  const palette = TONE[tone];

  return (
    <div
      ref={trackRef}
      className={`relative select-none overflow-hidden rounded-full border ${className} ${
        disabled
          ? 'border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
          : palette.track
      }`}
    >
      {/* Fill behind the knob: the gesture's own progress bar. */}
      <div
        className={`absolute inset-y-0 left-0 ${palette.fill} ${
          dragging ? '' : 'transition-[width] duration-200'
        }`}
        style={{ width: `${knobX + knobPx}px` }}
      />
      {/* Centred in the track MINUS wherever the knob is, not in the whole
          track: it parks at the left and ends at the right, so the free space
          — and with it the label — swaps sides once the swipe is armed. */}
      <span
        style={armed ? { left: 0, right: `${knobPx}px` } : { left: `${knobPx}px`, right: 0 }}
        className={`pointer-events-none absolute inset-y-0 flex items-center justify-center whitespace-nowrap px-1 font-semibold ${labelClassName} ${
          disabled
            ? 'text-slate-400 dark:text-slate-600'
            : armed
              ? palette.labelArmed
              : palette.label
        }`}
      >
        {armed ? armedLabel : label}
      </span>
      <div
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{ width: `${knobPx}px`, transform: `translateX(${knobX}px)` }}
        className={`absolute inset-y-0 left-0 flex touch-none items-center justify-center rounded-full text-xs font-bold ${
          disabled
            ? 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-600'
            : `cursor-grab active:cursor-grabbing ${palette.knob}`
        } ${dragging ? '' : 'transition-transform duration-200'}`}
        role="button"
        aria-label={ariaLabel ?? label}
      >
        {knobLabel}
      </div>
    </div>
  );
}
