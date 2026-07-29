import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Press-and-hold button for an action that must not happen by accident.
 *
 * The hold IS the confirmation — the action fires when the press has lasted
 * long enough, with no dialog behind it. Same reasoning as SlideToConfirm (a
 * dialog someone has learnt to dismiss confirms nothing), in the footprint of an
 * ordinary button: where a swipe needs a track wide enough to swipe along, this
 * needs only its own label, which is what lets it sit in a window header next to
 * Run/Stop.
 *
 * The fill growing across the button is the whole feedback story: it says a
 * press is being counted, roughly how much is left, and — by letting go and
 * watching it snap back — that nothing happened.
 */

// How long the press has to last. Long enough that a click cannot reach it, short
// enough to not feel broken: a plain click is under ~200 ms, and past about a
// second a deliberate hold starts to read as the button being stuck.
const HOLD_MS = 700;

type HoldToConfirmProps = {
  label: string;
  /** Shown while the press is being counted. Falls back to `label`. */
  holdingLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
};

export function HoldToConfirm({
  label,
  holdingLabel,
  onConfirm,
  disabled = false,
  className = '',
  title,
}: HoldToConfirmProps) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  }, []);

  // A press interrupted by anything other than a release — the tab being hidden,
  // the window losing focus mid-hold — must not go on counting in the
  // background and fire at nothing.
  useEffect(() => () => cancel(), [cancel]);

  const start = () => {
    if (disabled || timerRef.current !== null) return;
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };

  return (
    <button
      type="button"
      // Pointer events, not mouse/touch pairs: one set covers mouse, pen and
      // finger, and `onPointerLeave` is what makes dragging off the button the
      // way out of a press already started.
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      // Keyboard equivalent. Space/Enter repeat while held, so the first one
      // starts the timer and the rest are ignored by the guard in start().
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      disabled={disabled}
      title={title}
      className={`relative overflow-hidden select-none touch-none ${className}`}
    >
      {/* Under the label, and inert: a fill that could swallow the pointer would
          end the press it is drawing. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 bg-rose-400/40 dark:bg-rose-400/30"
        style={{
          width: holding ? '100%' : '0%',
          // No transition on the way back, so a released press is *gone*, not
          // gently unwound — the difference between "cancelled" and "still
          // counting" has to be readable at a glance.
          transition: holding ? `width ${HOLD_MS}ms linear` : 'none',
        }}
      />
      <span className="relative">{holding ? (holdingLabel ?? label) : label}</span>
    </button>
  );
}
