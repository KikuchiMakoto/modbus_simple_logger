import { VoltageMode, VOLTAGE_MODES } from '../types';
import { AI_CHANNELS } from '../constants';
import { SlidePanel } from './SlidePanel';

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
    <SlidePanel
      open={open}
      onClose={onClose}
      title="Voltage Config"
      subtitle="AI Channel Display Mode"
      accent="blue"
    >
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-2">
          {voltageConfig.map((mode, idx) => {
            const isHx711 = idx < AI_CHANNELS / 2;
            const allowedModes = isHx711 ? HX711_MODES : ADS1115_MODES;
            return (
              <div
                key={idx}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="w-12 shrink-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  CH {idx.toString().padStart(2, '0')}
                </span>
                <span className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {isHx711 ? 'HX711' : 'ADS1115'}
                </span>
                <select
                  value={mode}
                  onChange={(e) => {
                    const next = [...voltageConfig];
                    next[idx] = e.target.value as VoltageMode;
                    onVoltageConfigChange(next);
                  }}
                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
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
    </SlidePanel>
  );
}
