import { FloatingWindow } from './FloatingWindow';

type ModbusConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  /** "WebSerial" or "WebUSB" — decided by the environment, not by the user. */
  transportLabel: string;
};

/**
 * The link is one fixed, non-configurable configuration — there is exactly
 * one Modbus RTU setup this app speaks. This panel is read-only: it exists so
 * someone wiring up hardware can see what the app expects without having to
 * read the source.
 */
export function ModbusConfigPanel({ open, onClose, transportLabel }: ModbusConfigPanelProps) {
  const rows: [string, string][] = [
    ['Slave ID', '1'],
    ['Baud rate', '38400 bps'],
    ['Data bits', '8'],
    ['Parity', 'None'],
    ['Stop bits', '1'],
    ['Precision', 'Normal (i16t)'],
    ['Polling Rate', '100 ms'],
  ];

  // "Connection Config", not "Modbus Config": the panel also covers the serial
  // link and the polling rate, and the transport may be WebSerial or WebUSB.
  return (
    <FloatingWindow open={open} onClose={onClose} title="Connection Config" defaultWidth={300} defaultHeight={340}>
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

        {/* Everything below is a fixed property of the link, not a setting: one
            slave id, one serial framing, one register map, one poll rate. There
            is nothing here to edit. */}
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between rounded border border-slate-200 bg-slate-50 px-2 py-1 dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{value}</span>
          </div>
        ))}
      </div>
    </FloatingWindow>
  );
}
