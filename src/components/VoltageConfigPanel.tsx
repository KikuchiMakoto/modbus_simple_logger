import { VoltageDisplayMode } from '../types';

type VoltageConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  modes: VoltageDisplayMode[];
  modeOptions: { value: VoltageDisplayMode; label: string }[];
  onModeChange: (channelIndex: number, mode: VoltageDisplayMode) => void;
};

export function VoltageConfigPanel({
  open,
  onClose,
  modes,
  modeOptions,
  onModeChange,
}: VoltageConfigPanelProps) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-md transform bg-white shadow-2xl transition-transform duration-300 dark:bg-slate-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h2 className="text-xl font-bold text-sky-600 dark:text-sky-400">
              Voltage Config
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-sky-400 hover:text-sky-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-400"
              aria-label="Close voltage config panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3">
              {modes.map((mode, channelIndex) => (
                <div key={channelIndex} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <label className="mb-1 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                    CH {channelIndex.toString().padStart(2, '0')}
                  </label>
                  <select
                    value={mode}
                    onChange={(e) => onModeChange(channelIndex, e.target.value as VoltageDisplayMode)}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {modeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
