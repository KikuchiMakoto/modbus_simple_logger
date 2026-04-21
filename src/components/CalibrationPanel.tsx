import { useEffect, useRef, useState, memo } from 'react';
import { AiCalibration } from '../types';
import { SlidePanel } from './SlidePanel';

type CalibCellProps = {
  value: number;
  onChange: (v: number) => void;
};

const CalibCell = memo(function CalibCell({ value, onChange }: CalibCellProps) {
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
      className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right text-sm font-semibold text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
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
  onSaveCalibration: () => void;
  onLoadCalibration: (file: File) => void;
};

export function CalibrationPanel({
  open,
  onClose,
  aiCalibration,
  onUpdateCalibration,
  onSaveCalibration,
  onLoadCalibration,
}: CalibrationPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Input Calibration"
      subtitle="a·x² + b·x + c = y"
      maxWidth="max-w-sm"
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
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
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
        <div className="space-y-1.5">
          {aiCalibration.map((cal, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800"
            >
              <span className="w-10 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
                CH {idx.toString().padStart(2, '0')}
              </span>
              <div className="flex flex-1 items-center gap-1.5">
                <span className="text-xs text-slate-500 dark:text-slate-400">a</span>
                <div className="w-20">
                  <CalibCell
                    value={cal.a}
                    onChange={(v) => onUpdateCalibration(idx, 'a', v)}
                  />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">b</span>
                <div className="w-20">
                  <CalibCell
                    value={cal.b}
                    onChange={(v) => onUpdateCalibration(idx, 'b', v)}
                  />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">c</span>
                <div className="w-20">
                  <CalibCell
                    value={cal.c}
                    onChange={(v) => onUpdateCalibration(idx, 'c', v)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SlidePanel>
  );
}
