import { ModbusPrecisionSetting, PollingRateOption, SerialSettings } from '../types';
import { FloatingWindow } from './FloatingWindow';

type ModbusConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  slaveId: number;
  onSlaveIdChange: (value: number) => void;
  serialSettings: SerialSettings;
  onSerialSettingsChange: (settings: SerialSettings) => void;
  modbusPrecision: ModbusPrecisionSetting;
  onModbusPrecisionChange: (value: ModbusPrecisionSetting) => void;
  pollingRate: PollingRateOption;
  onPollingRateChange: (value: PollingRateOption) => void;
  pollingOptions: PollingRateOption[];
  baudOptions: number[];
  dataBitsOptions: SerialSettings['dataBits'][];
  stopBitsOptions: SerialSettings['stopBits'][];
  parityOptions: SerialSettings['parity'][];
  precisionOptions: { label: string; value: ModbusPrecisionSetting }[];
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
  // "Connection Config", not "Modbus Config": the panel also covers the serial
  // link and the polling rate, and the transport may be WebSerial or WebUSB.
  return (
    <FloatingWindow open={open} onClose={onClose} title="Connection Config" defaultWidth={300} defaultHeight={420}>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400">Slave ID</label>
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
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            min={1}
            max={247}
            disabled={connected}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400">Baud rate</label>
          <select
            value={serialSettings.baudRate}
            onChange={(e) =>
              onSerialSettingsChange({ ...serialSettings, baudRate: Number(e.target.value) })
            }
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          <label className="block text-xs text-slate-600 dark:text-slate-400">Data bits</label>
          <select
            value={serialSettings.dataBits}
            onChange={(e) =>
              onSerialSettingsChange({
                ...serialSettings,
                dataBits: Number(e.target.value) as SerialSettings['dataBits'],
              })
            }
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          <label className="block text-xs text-slate-600 dark:text-slate-400">Parity</label>
          <select
            value={serialSettings.parity}
            onChange={(e) =>
              onSerialSettingsChange({
                ...serialSettings,
                parity: e.target.value as SerialSettings['parity'],
              })
            }
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          <label className="block text-xs text-slate-600 dark:text-slate-400">Stop bits</label>
          <select
            value={serialSettings.stopBits}
            onChange={(e) =>
              onSerialSettingsChange({
                ...serialSettings,
                stopBits: Number(e.target.value) as SerialSettings['stopBits'],
              })
            }
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          <label className="block text-xs text-slate-600 dark:text-slate-400">Precision</label>
          <select
            value={modbusPrecision}
            onChange={(e) => onModbusPrecisionChange(e.target.value as ModbusPrecisionSetting)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
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
          <label className="block text-xs text-slate-600 dark:text-slate-400">Polling Rate</label>
          {/* Locked once connected, like the serial settings above: the poll
              rate is a property of the link, and the loop's schedule, its read
              timeout and its retry budget are all derived from it. Changing it
              mid-run also moves the sample grid the recording deadline is
              locked to. "Save every" stays live because it is a property of the
              measurement, and re-phasing it costs nothing. */}
          <select
            value={pollingRate.valueMs}
            onChange={(e) => {
              const next = pollingOptions.find((p) => p.valueMs === Number(e.target.value));
              if (next) onPollingRateChange(next);
            }}
            className="w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            disabled={connected}
          >
            {pollingOptions.map((opt) => (
              <option key={opt.valueMs} value={opt.valueMs}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[0.65rem] leading-tight text-slate-500 dark:text-slate-500">
            How often the device is read, and how often the chart moves — this
            is the rate a feedback script sees. How often a reading is written
            to file is <strong>Save every</strong>, next to Start Save. Fixed
            while connected.
          </p>
        </div>
      </div>
    </FloatingWindow>
  );
}
