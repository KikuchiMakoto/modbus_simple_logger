import { useEffect, useRef, useState } from 'react';
import { AiCalibration } from '../types';

type CalibCellProps = {
  value: number;
  onChange: (v: number) => void;
};

function CalibCell({ value, onChange }: CalibCellProps) {
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
}

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
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-sm transform bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                AI Calibration
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                a·x² + b·x + c = y
              </p>
            </div>
            <div className="flex items-center gap-2">
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
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
                aria-label="Close calibration panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1.5">
              {aiCalibration.map((cal, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-800"
                >
                  <span className="w-10 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {idx.toString().padStart(2, '0')}
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
        </div>
      </div>
    </>
  );
}
