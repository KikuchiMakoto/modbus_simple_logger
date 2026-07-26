import { VoltageMode, VOLTAGE_MODES } from '../types';
import { AI_CHANNELS } from '../constants';
import { FloatingWindow } from './FloatingWindow';

const HX711_MODES = new Set<string>([
  'unknown', 'hx711_mv_per_v', 'hx711_micro_strain',
]);

const ADS1115_MODES = new Set<string>([
  'unknown', 'ads1115_10v', 'ads1115_6144mv', 'ads1115_4096mv',
  'ads1115_2048mv', 'ads1115_1024mv', 'ads1115_512mv', 'ads1115_256mv',
]);

type VoltageConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  voltageConfig: VoltageMode[];
  onVoltageConfigChange: (config: VoltageMode[]) => void;
};

export function VoltageConfigPanel({
  open,
  onClose,
  voltageConfig,
  onVoltageConfigChange,
}: VoltageConfigPanelProps) {
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Voltage Config"
      subtitle="AI Channel Display Mode"
      accent="blue"
      defaultWidth={380}
      defaultHeight={460}
    >
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-0.5">
          {voltageConfig.map((mode, idx) => {
            const isHx711 = idx < AI_CHANNELS / 2;
            const allowedModes = isHx711 ? HX711_MODES : ADS1115_MODES;
            // Channel number, part name, and the range labels are all
            // identifiers — "HX711 (mV/V)" translated is a range this app does
            // not have.
            return (
              <div
                key={idx}
                translate="no"
                className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="w-10 shrink-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  CH {idx.toString().padStart(2, '0')}
                </span>
                <span className="w-12 shrink-0 text-[0.7rem] text-slate-500 dark:text-slate-400">
                  {isHx711 ? 'HX711' : 'ADS1115'}
                </span>
                <select
                  value={mode}
                  onChange={(e) => {
                    const next = [...voltageConfig];
                    next[idx] = e.target.value as VoltageMode;
                    onVoltageConfigChange(next);
                  }}
                  className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-0 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  {VOLTAGE_MODES
                    .filter((m) => allowedModes.has(m.value))
                    .map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>
    </FloatingWindow>
  );
}
