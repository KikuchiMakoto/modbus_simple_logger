import { useEffect, useRef, useState, memo } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { PARAM_CHANNELS } from '../constants';

type ParamCellProps = {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  ariaLabel: string;
};

/**
 * A single editable cell. Mirrors the Input Calib cell: while the input has
 * focus the displayed text is owned by the user (so a half-typed "0." does
 * not get reparsed and pushed back as "0" mid-keystroke); the value is
 * committed on blur or Enter. No Apply button — committing the edit IS the
 * apply, same as Calibration.
 */
const ParamCell = memo(function ParamCell({ value, onChange, disabled = false, ariaLabel }: ParamCellProps) {
  const [localValue, setLocalValue] = useState(() => String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setLocalValue(String(value));
    }
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={localValue}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(e) => {
        setLocalValue(e.target.value);
      }}
      onBlur={() => {
        focusedRef.current = false;
        const trimmed = localValue.trim();
        if (trimmed !== '') {
          const parsed = Number(trimmed);
          if (Number.isFinite(parsed)) {
            onChange(parsed);
            setLocalValue(String(parsed));
            return;
          }
        }
        setLocalValue(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded border border-slate-300 bg-white px-1 py-0 text-right text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
    />
  );
});

type ParamEditorPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Edit disabled when a Runner (Onetime or Periodic) is driving Parameter. */
  locked: boolean;
  /** Current SAB values, refreshed every 200 ms by App.tsx. */
  paramValues: number[];
  /** Free-text labels for each Parameter ch (persisted separately). */
  paramFreeLabels: string[];
  /** The "Default" column — written to the SAB once at app startup. */
  paramStartupValues: number[];
  /** Write `value` to ch's slot in the SAB. */
  onApplyParamValue: (ch: number, value: number) => void;
  /** Persist `value` as ch's next-launch default. Does NOT touch the SAB. */
  onStartupValueChange: (ch: number, value: number) => void;
};

const CHANNEL_LABELS = Array.from({ length: PARAM_CHANNELS }, (_, i) =>
  i.toString().padStart(2, '0'),
);

/**
 * Manual Parameter editor. Same visual language as Input Calib Value: one row
 * per channel, a label and an inline editable cell for each quantity, no
 * Apply button (committing the edit IS the apply). Two columns here — Default
 * (next-launch seed) and Present (live SAB) — kept on the same row so the
 * difference is obvious: Present is what the rig is doing now, Default is what
 * it will start at next time.
 */
export function ParamEditorPanel({
  open,
  onClose,
  locked,
  paramValues,
  paramFreeLabels,
  paramStartupValues,
  onApplyParamValue,
  onStartupValueChange,
}: ParamEditorPanelProps) {
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Param Editor"
      subtitle="Default applies at next launch, Present applies now"
      defaultWidth={420}
      defaultHeight={460}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-0.5">
          {CHANNEL_LABELS.map((label, idx) => {
            const value = paramValues[idx] ?? 0;
            const startup = paramStartupValues[idx] ?? 0;
            const freeLabel = paramFreeLabels[idx] ?? '';
            return (
              <div
                key={idx}
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800"
                title={freeLabel || undefined}
              >
                <span className="w-5 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {label}
                </span>
                <div className="flex flex-1 items-center gap-1">
                  <span className="text-[0.7rem] text-slate-500 dark:text-slate-400">Default</span>
                  <div className="min-w-0 flex-1">
                    <ParamCell
                      value={startup}
                      onChange={(v) => onStartupValueChange(idx, v)}
                      disabled={locked}
                      ariaLabel={`CH${label} default`}
                    />
                  </div>
                  <span className="text-[0.7rem] text-slate-500 dark:text-slate-400">Present</span>
                  <div className="min-w-0 flex-1">
                    <ParamCell
                      value={value}
                      onChange={(v) => onApplyParamValue(idx, v)}
                      disabled={locked}
                      ariaLabel={`CH${label} present`}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </FloatingWindow>
  );
}
