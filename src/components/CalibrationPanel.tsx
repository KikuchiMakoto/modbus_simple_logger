import { AiCalibration } from '../types';

type CalibrationPanelProps = {
  open: boolean;
  onClose: () => void;
  aiCalibration: AiCalibration[];
  onUpdateCalibration: (idx: number, key: keyof AiCalibration, value: number) => void;
};

export function CalibrationPanel({
  open,
  onClose,
  aiCalibration,
  onUpdateCalibration,
}: CalibrationPanelProps) {
  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Slide-in Panel */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-full max-w-2xl transform bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                AI Calibration
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                a·x² + b·x + c = y
              </p>
            </div>
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

          {/* Calibration Table */}
          <div className="flex-1 overflow-y-auto p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-600 dark:border-slate-700 dark:text-slate-400">
                  <th className="pb-2 pr-2 font-semibold">CH</th>
                  <th className="pb-2 px-2 font-semibold">a</th>
                  <th className="pb-2 px-2 font-semibold">b</th>
                  <th className="pb-2 pl-2 font-semibold">c</th>
                </tr>
              </thead>
              <tbody>
                {aiCalibration.map((cal, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    <td className="py-1.5 pr-2 font-semibold text-slate-700 dark:text-slate-200">
                      CH {idx.toString().padStart(2, '0')}
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={cal.a}
                        onChange={(e) =>
                          onUpdateCalibration(idx, 'a', Number(e.target.value))
                        }
                        className="input-compact w-full"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        value={cal.b}
                        onChange={(e) =>
                          onUpdateCalibration(idx, 'b', Number(e.target.value))
                        }
                        className="input-compact w-full"
                      />
                    </td>
                    <td className="py-1.5 pl-2">
                      <input
                        type="number"
                        value={cal.c}
                        onChange={(e) =>
                          onUpdateCalibration(idx, 'c', Number(e.target.value))
                        }
                        className="input-compact w-full"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
