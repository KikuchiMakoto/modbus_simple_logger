import { useEffect, useState } from 'react';
import { ModbusPrecision, PollingRateOption, SerialSettings } from '../types';
import { FloatingWindow } from './FloatingWindow';

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
  /** "WebSerial" or "WebUSB" — decided by the environment, not by the user. */
  transportLabel: string;
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
  transportLabel,
  connected,
}: ModbusConfigPanelProps) {
  // Slave ID is edited as free text and only committed on blur/Enter.
  // Validating per keystroke and returning without a setState left the
  // controlled input snapping back to the old value, which made the field
  // uneditable: backspace from "1" did nothing (the empty string failed the
  // digits test), and any value reached through an out-of-range prefix — 250 on
  // the way to typing something else — could not be passed through.
  const [slaveIdDraft, setSlaveIdDraft] = useState(String(slaveId));

  // Follow the committed value when it changes from outside (a fresh mount with
  // a persisted setting, or a reset elsewhere) without fighting the user's
  // in-progress typing.
  useEffect(() => {
    setSlaveIdDraft(String(slaveId));
  }, [slaveId]);

  const commitSlaveId = () => {
    const parsed = parseInt(slaveIdDraft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setSlaveIdDraft(String(slaveId));
      return;
    }
    const clamped = Math.min(247, Math.max(1, parsed));
    setSlaveIdDraft(String(clamped));
    if (clamped !== slaveId) onSlaveIdChange(clamped);
  };

  // "Connection Config", not "Modbus Config": the panel also covers the serial
  // link and the polling rate, and the transport may be WebSerial or WebUSB.
  return (
    <FloatingWindow open={open} onClose={onClose} title="Connection Config" defaultWidth={300} defaultHeight={420}>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {/* Read-only, and first: which API the browser gave us is decided by the
            environment (WebSerial where it exists, the WebUSB polyfill on
            mobile), not by anything on this panel. It used to be printed in the
            app header, where it cost a permanent line to say something that
            never changes within a session. */}
        <div
          translate="no"
          className="flex items-baseline justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
        >
          <span className="text-xs text-slate-500 dark:text-slate-400">Transport</span>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{transportLabel}</span>
        </div>

        <div>
          <label className="block text-xs text-slate-600 dark:text-slate-400">Slave ID</label>
          <input
            type="number"
            value={slaveIdDraft}
            onChange={(e) => setSlaveIdDraft(e.target.value)}
            onBlur={commitSlaveId}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSlaveId();
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
            onChange={(e) => onModbusPrecisionChange(e.target.value as ModbusPrecision)}
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
              locked to. "Save Rate" stays live because it is a property of the
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
        </div>
      </div>
    </FloatingWindow>
  );
}
