import { ModbusPrecision, PollingRateOption, SerialSettings } from '../types';
import { SlidePanel } from './SlidePanel';

type ModbusConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  slaveId: number;
  onSlaveIdChange: (value: number) => void;
  serialSettings: SerialSettings;
  onSerialSettingsChange: (settings: SerialSettings) => void;
  modbusPrecision: ModbusPrecision;
  onModbusPrecisionChange: (value: ModbusPrecision) => void;
  pollingRate: PollingRateOption;
  onPollingRateChange: (value: PollingRateOption) => void;
  pollingOptions: PollingRateOption[];
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
  pollingRate,
  onPollingRateChange,
  pollingOptions,
  baudOptions,
  dataBitsOptions,
  stopBitsOptions,
  parityOptions,
  precisionOptions,
  connected,
}: ModbusConfigPanelProps) {
  return (
    <SlidePanel open={open} onClose={onClose} title="Modbus Config">
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

        <div>
          <label className="block text-sm text-slate-600 dark:text-slate-400">Sampling Rate</label>
          <select
            value={pollingRate.valueMs}
            onChange={(e) => {
              const next = pollingOptions.find((p) => p.valueMs === Number(e.target.value));
              if (next) onPollingRateChange(next);
            }}
            className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {pollingOptions.map((opt) => (
              <option key={opt.valueMs} value={opt.valueMs}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </SlidePanel>
  );
}
