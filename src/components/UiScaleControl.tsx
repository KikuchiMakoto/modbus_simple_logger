import { DEFAULT_UI_SCALE, canStepUiScale, setUiScalePercent, stepUiScale, useUiScalePercent } from '../utils/uiScale';

function StepButton({ delta, label, children }: { delta: number; label: string; children: string }) {
  // Subscribes in its own right so the end-of-range disabled state is correct
  // no matter which control changed the scale.
  useUiScalePercent();
  return (
    <button
      type="button"
      onClick={() => stepUiScale(delta)}
      disabled={!canStepUiScale(delta)}
      aria-label={label}
      title={label}
      className="h-7 w-6 rounded border border-slate-300 text-base font-bold leading-none text-slate-700 hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
    >
      {children}
    </button>
  );
}

/**
 * Interface scale, as three buttons and nothing else. It lives in the Menu
 * panel's header, where there is no room to explain itself — the controls are
 * −/+ around a percentage, which needs no caption, and the effect is visible
 * the instant it is pressed.
 */
export function UiScaleControl() {
  const uiScalePercent = useUiScalePercent();
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <StepButton delta={-1} label="Decrease interface scale">−</StepButton>
      {/* The percentage doubles as the reset control: at anything but 100% it is
          the one click back to the default, which the two step buttons would
          otherwise take up to five of. */}
      <button
        type="button"
        onClick={() => setUiScalePercent(DEFAULT_UI_SCALE)}
        disabled={uiScalePercent === DEFAULT_UI_SCALE}
        aria-label="Interface scale"
        title={uiScalePercent === DEFAULT_UI_SCALE ? 'Interface scale' : `Reset to ${DEFAULT_UI_SCALE}%`}
        className="w-12 rounded border border-slate-300 px-0.5 py-1 text-center font-mono text-xs font-semibold tabular-nums text-slate-800 hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-default disabled:border-slate-300 disabled:text-slate-800 disabled:hover:text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:hover:border-emerald-400 dark:hover:text-emerald-400 dark:disabled:border-slate-600 dark:disabled:text-slate-100"
      >
        {uiScalePercent}%
      </button>
      <StepButton delta={1} label="Increase interface scale">+</StepButton>
    </div>
  );
}
