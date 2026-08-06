import { useEffect, useState, memo } from 'react';
import { FloatingWindow } from './FloatingWindow';
import { SlideToConfirm } from './SlideToConfirm';
import { PARAM_CHANNELS } from '../constants';
import { formatFloat32 } from '../utils/floatFormat';

type ParamValueCellProps = {
  value: number;
  onApply: (v: number) => void;
  disabled: boolean;
  ariaLabel: string;
};

/**
 * One channel's value: a draft field and the Set button that commits it.
 *
 * The cell used to commit on blur, the way Input Calib does — but Calibration
 * edits a coefficient in localStorage while this writes the SharedArrayBuffer a
 * running script steers the rig from, and "the edit IS the apply" makes every
 * stray click past a half-typed number a write. So the draft is inert until Set
 * (or Enter); Escape puts it back. Blur does nothing at all — leaving a field
 * is not an instruction.
 *
 * The draft also survives the value moving underneath it: a script writing that
 * channel every 200 ms must not eat what the user is typing. Once applied (or
 * escaped) the cell goes back to mirroring the live value.
 */
const ParamValueCell = memo(function ParamValueCell({
  value,
  onApply,
  disabled,
  ariaLabel,
}: ParamValueCellProps) {
  // What the SAB holds, printed as the shortest string that reads back as the
  // same float32 — see utils/floatFormat. Typing 0.3 and getting
  // 0.30000001192092896 back is the reason this panel formats at all.
  const shown = formatFloat32(value);
  const [draft, setDraft] = useState(shown);
  /** True once the user has typed: their text owns the field until it settles. */
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending) setDraft(shown);
  }, [shown, pending]);

  const trimmed = draft.trim();
  const parsed = Number(trimmed);
  const valid = trimmed !== '' && Number.isFinite(parsed);
  const canApply = pending && valid && !disabled;

  const apply = () => {
    if (!canApply) return;
    onApply(parsed);
    // What the SAB will hold a moment from now. Written here rather than left
    // to the effect so the field never flashes the pre-rounding text.
    setDraft(formatFloat32(Math.fround(parsed)));
    setPending(false);
  };

  const revert = () => {
    setDraft(shown);
    setPending(false);
  };

  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value);
          setPending(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
          if (e.key === 'Escape') revert();
        }}
        title={pending ? 'Not applied yet — press Set or Enter (Escape to discard)' : undefined}
        className={`w-20 shrink-0 rounded border px-1 py-0 text-right text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 ${
          pending && !valid
            ? 'border-rose-400 bg-rose-50 dark:border-rose-500 dark:bg-rose-950/40'
            : pending
              ? 'border-amber-400 bg-amber-50 dark:border-amber-500 dark:bg-amber-950/40'
              : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-700'
        }`}
      />
      <button
        type="button"
        onClick={apply}
        disabled={!canApply}
        aria-label={`Apply ${ariaLabel}`}
        title={
          disabled
            ? 'Locked while a script is running'
            : pending
              ? 'Write this value to the channel'
              : 'Nothing to apply'
        }
        className="shrink-0 rounded border border-slate-300 px-1.5 py-0 text-[0.65rem] font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-600 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400 dark:disabled:border-slate-700 dark:disabled:text-slate-600"
      >
        Set
      </button>
    </>
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
  /** Write `value` to ch's slot in the SAB. */
  onApplyParamValue: (ch: number, value: number) => void;
  /** Rename ch. Same store the main page's Parameter grid edits. */
  onParamLabelChange: (ch: number, text: string) => void;
  /** Zero every value and blank every label, in one go. */
  onClearAll: () => void;
};

const CHANNEL_LABELS = Array.from({ length: PARAM_CHANNELS }, (_, i) =>
  i.toString().padStart(2, '0'),
);

/**
 * Manual Parameter editor: one row per channel — the channel number, its
 * free-text label, its live value and a Set button.
 *
 * There used to be a second value column, "Default", persisted per device and
 * seeded into the SAB once at startup. It is gone: a Parameter is a knob on the
 * running experiment, and a value that only takes effect after a reload was a
 * second meaning for the same 16 slots that had to be explained every time. The
 * label took its place, because that is what a channel actually needs carried
 * between sessions — `3` means nothing next week, `preload_N` does.
 */
export function ParamEditorPanel({
  open,
  onClose,
  locked,
  paramValues,
  paramFreeLabels,
  onApplyParamValue,
  onParamLabelChange,
  onClearAll,
}: ParamEditorPanelProps) {
  // Re-armed every time a run starts locking the editor, rather than kept
  // across runs: accepting the race for one run should not silently carry
  // into the next one.
  const [acceptRisk, setAcceptRisk] = useState(false);
  useEffect(() => {
    if (locked) setAcceptRisk(false);
  }, [locked]);
  const valuesLocked = locked && !acceptRisk;

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Param Editor"
      subtitle="Label and value per channel · Set applies"
      defaultWidth={460}
      defaultHeight={520}
      headerActions={
        locked && (
          <label className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[0.65rem] font-medium text-amber-600 dark:text-amber-400">
            <input
              type="checkbox"
              checked={acceptRisk}
              onChange={(e) => setAcceptRisk(e.target.checked)}
              className="h-3 w-3 accent-amber-500"
            />
            Accept Risk
          </label>
        )
      }
    >
      <div className="flex-1 overflow-y-auto p-2">
        {locked && !acceptRisk && (
          <div className="mb-1.5 rounded border border-slate-300 bg-slate-100 px-2 py-1 text-[0.7rem] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
            Script running: editing is locked. Check "Accept Risk" above to edit values anyway — a manual edit can race the script's own writes to that channel. Labels stay locked either way: a script may be renaming channels itself (SetParamLabel), and the rename it made is how its own log reads.
          </div>
        )}
        {locked && acceptRisk && (
          <div className="mb-1.5 rounded border border-amber-400 bg-amber-50 px-2 py-1 text-[0.7rem] font-medium text-amber-700 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-300">
            Editing values while the script is running — your edits can race the script's own writes to that channel. Labels remain locked.
          </div>
        )}
        <div className="space-y-0.5">
          {CHANNEL_LABELS.map((label, idx) => {
            const value = paramValues[idx] ?? 0;
            return (
              <div
                key={idx}
                translate="no"
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="w-5 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {label}
                </span>
                <input
                  type="text"
                  value={paramFreeLabels[idx] ?? ''}
                  onChange={(e) => onParamLabelChange(idx, e.target.value)}
                  // Labels are never unlocked by Accept Risk — see the notice.
                  disabled={locked}
                  placeholder="Label"
                  aria-label={`CH${label} label`}
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-0 text-xs text-slate-600 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                />
                <ParamValueCell
                  value={value}
                  onApply={(v) => onApplyParamValue(idx, v)}
                  disabled={valuesLocked}
                  ariaLabel={`CH${label} value`}
                />
              </div>
            );
          })}
        </div>
      </div>
      {/* Outside the scroll area: it wipes all 16 channels, and a control that
          only exists once the list is scrolled to the bottom is one that gets
          reached for by scrolling. Sliding rather than clicking for the same
          reason the other three sliders exist — there is no undo behind it. */}
      <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-700">
        <SlideToConfirm
          label="Slide to clear all values and labels"
          armedLabel="Release to clear all 16 channels"
          knobLabel="0"
          onConfirm={onClearAll}
          disabled={locked}
          tone="warn"
          className="h-8"
          knobPx={30}
          labelClassName="text-[0.7rem]"
          aria-label="Clear all Parameter values and labels"
        />
      </div>
    </FloatingWindow>
  );
}
