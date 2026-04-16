import { ModbusPrecision, SerialSettings } from '../types';

type ModbusConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  slaveId: number;
  onSlaveIdChange: (value: number) => void;
  serialSettings: SerialSettings;
  onSerialSettingsChange: (settings: SerialSettings) => void;
  modbusPrecision: ModbusPrecision;
  onModbusPrecisionChange: (value: ModbusPrecision) => void;
  baudOptions: number[];
  dataBitsOptions: SerialSettings['dataBits'][];
  stopBitsOptions: SerialSettings['stopBits'][];
  parityOptions: SerialSettings['parity'][];
  precisionOptions: { label: string; value: ModbusPrecision }[];
  connected: boolean;
};

export function ModbusConfigPanel({
  open,
  onClose,
  slaveId,
  onSlaveIdChange,
  serialSettings,
  onSerialSettingsChange,
  modbusPrecision,
  onModbusPrecisionChange,
  baudOptions,
  dataBitsOptions,
  stopBitsOptions,
  parityOptions,
  precisionOptions,
  connected,
}: ModbusConfigPanelProps) {
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
            <h2 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              Modbus Config
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400"
              aria-label="Close modbus config panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Slave ID</label>
              <input
                type="number"
                value={slaveId}
                onChange={(e) => {
                  const rawValue = e.target.value.trim();
                  if (!/^\d+$/.test(rawValue)) return;
                  const next = parseInt(rawValue, 10);
                  if (next < 1 || next > 247) return;
                  onSlaveIdChange(next);
                }}
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                min={1}
                max={247}
                disabled={connected}
              />
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Baud rate</label>
              <select
                value={serialSettings.baudRate}
                onChange={(e) =>
                  onSerialSettingsChange({ ...serialSettings, baudRate: Number(e.target.value) })
                }
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={connected}
              >
                {baudOptions.map((baud) => (
                  <option key={baud} value={baud}>
                    {baud} bps
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Data bits</label>
              <select
                value={serialSettings.dataBits}
                onChange={(e) =>
                  onSerialSettingsChange({
                    ...serialSettings,
                    dataBits: Number(e.target.value) as SerialSettings['dataBits'],
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={connected}
              >
                {dataBitsOptions.map((bits) => (
                  <option key={bits} value={bits}>
                    {bits}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Parity</label>
              <select
                value={serialSettings.parity}
                onChange={(e) =>
                  onSerialSettingsChange({
                    ...serialSettings,
                    parity: e.target.value as SerialSettings['parity'],
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={connected}
              >
                {parityOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'none' ? 'None' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Stop bits</label>
              <select
                value={serialSettings.stopBits}
                onChange={(e) =>
                  onSerialSettingsChange({
                    ...serialSettings,
                    stopBits: Number(e.target.value) as SerialSettings['stopBits'],
                  })
                }
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={connected}
              >
                {stopBitsOptions.map((bits) => (
                  <option key={bits} value={bits}>
                    {bits}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-slate-600 dark:text-slate-400">Precision</label>
              <select
                value={modbusPrecision}
                onChange={(e) => onModbusPrecisionChange(e.target.value as ModbusPrecision)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                disabled={connected}
              >
                {precisionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
