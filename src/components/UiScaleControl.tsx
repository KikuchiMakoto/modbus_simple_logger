import { DEFAULT_UI_SCALE, canStepUiScale, setUiScalePercent, stepUiScale, useUiScalePercent } from '../utils/uiScale';
import { Button } from '@/components/ui/button';

function StepButton({ delta, label, children }: { delta: number; label: string; children: string }) {
  // Subscribes in its own right so the end-of-range disabled state is correct
  // no matter which control changed the scale.
  useUiScalePercent();
  return (
    <Button
      variant="outline"
      onClick={() => stepUiScale(delta)}
      disabled={!canStepUiScale(delta)}
      aria-label={label}
      title={label}
      className="h-7 w-6 rounded p-0 text-base font-bold leading-none text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
    >
      {children}
    </Button>
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
      <Button
        variant="outline"
        onClick={() => setUiScalePercent(DEFAULT_UI_SCALE)}
        disabled={uiScalePercent === DEFAULT_UI_SCALE}
        aria-label="Interface scale"
        title={uiScalePercent === DEFAULT_UI_SCALE ? 'Interface scale' : `Reset to ${DEFAULT_UI_SCALE}%`}
        // At 100% it is disabled only because there is nothing to reset, not
        // because it is unavailable — so it keeps full contrast.
        className="w-12 rounded px-0.5 py-1 font-mono text-xs tabular-nums text-slate-800 disabled:cursor-default disabled:opacity-100 disabled:hover:text-slate-800 dark:border-slate-600 dark:text-slate-100 dark:disabled:hover:border-slate-600 dark:disabled:hover:text-slate-100"
      >
        {uiScalePercent}%
      </Button>
      <StepButton delta={1} label="Increase interface scale">+</StepButton>
    </div>
  );
}
