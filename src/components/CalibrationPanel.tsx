import { useEffect, useRef, useState, memo } from 'react';
import { AiCalibration } from '../types';
import { FloatingWindow } from './FloatingWindow';

type CalibCellProps = {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
};

const CalibCell = memo(function CalibCell({ value, onChange, disabled = false }: CalibCellProps) {
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
      className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
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
          if (!isNaN(parsed)) {
            onChange(parsed);
            setLocalValue(String(parsed));
            return;
          }
        }
        setLocalValue(String(value));
      }}
    />
  );
});

type CalibrationPanelProps = {
  open: boolean;
  onClose: () => void;
  aiCalibration: AiCalibration[];
  onUpdateCalibration: (idx: number, key: keyof AiCalibration, value: number) => void;
  onTareCalibration: (idx: number) => void;
  onSaveCalibration: () => void;
  onLoadCalibration: (file: File) => void;
  // While a script is running, scale coefficients (a, b) and file load are
  // frozen so a live control loop's Phy scale can't shift underneath it. The
  // offset c and Tare stay editable (offset-only, equivalent to zeroing).
  locked?: boolean;
};

export function CalibrationPanel({
  open,
  onClose,
  aiCalibration,
  onUpdateCalibration,
  onTareCalibration,
  onSaveCalibration,
  onLoadCalibration,
  locked = false,
}: CalibrationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Calibration Value"
      subtitle="a·(Raw)²+b·(Raw)+c = Phy"
      defaultWidth={480}
      defaultHeight={560}
      headerActions={
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onLoadCalibration(file);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            disabled={locked}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:border-slate-200 disabled:hover:text-slate-300 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400 dark:disabled:border-slate-800 dark:disabled:text-slate-600"
          >
            Load
          </button>
          <button
            type="button"
            onClick={onSaveCalibration}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex-1 overflow-y-auto p-3">
        {locked && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
            ScriptRunner実行中: スケール係数 a・b と Load は変更できません。オフセット c と Tare のみ調整できます。
          </div>
        )}
        <div className="space-y-1.5">
          {aiCalibration.map((cal, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="w-6 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
                {idx.toString().padStart(2, '0')}
              </span>
              <div className="flex flex-1 items-center gap-1.5">
                <span className="text-xs text-slate-500 dark:text-slate-400">a</span>
                <div className="min-w-0 flex-[3]">
                  <CalibCell
                    value={cal.a}
                    onChange={(v) => onUpdateCalibration(idx, 'a', v)}
                    disabled={locked}
                  />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">b</span>
                <div className="min-w-0 flex-[4]">
                  <CalibCell
                    value={cal.b}
                    onChange={(v) => onUpdateCalibration(idx, 'b', v)}
                    disabled={locked}
                  />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">c</span>
                <div className="min-w-0 flex-[3]">
                  <CalibCell
                    value={cal.c}
                    onChange={(v) => onUpdateCalibration(idx, 'c', v)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onTareCalibration(idx)}
                  title="Set offset c so the current physical value reads 0 (a and b unchanged)"
                  className="shrink-0 rounded border border-slate-300 px-2 py-0.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-600 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
                >
                  Tare
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </FloatingWindow>
  );
}
