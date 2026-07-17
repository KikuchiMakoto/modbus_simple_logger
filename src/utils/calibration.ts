import { AiCalibration, AiChannel, VoltageMode, DEFAULT_VOLTAGE_CONFIG, VOLTAGE_MODES } from '../types';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import { readJsonCookie, writeJsonCookie } from './cookies';

const AI_COOKIE_KEY = 'ai_calibration_v1';
const VOLTAGE_CONFIG_COOKIE_KEY = 'voltage_config_v1';
const AI_FREE_LABEL_COOKIE_KEY = 'ai_free_labels_v1';
const AO_FREE_LABEL_COOKIE_KEY = 'ao_free_labels_v1';
const PARAM_FREE_LABEL_COOKIE_KEY = 'param_free_labels_v1';
const INT16_MAX = 32767;

const defaultAiCalibration = (): AiCalibration => ({ a: 0, b: 1, c: 0 });

export const loadAiCalibration = (channels: number): AiCalibration[] => {
  const raw = readJsonCookie<AiCalibration[]>(AI_COOKIE_KEY);
  if (!Array.isArray(raw)) {
    return Array.from({ length: channels }, () => defaultAiCalibration());
  }
  return Array.from({ length: channels }, (_, idx) => raw[idx] ?? defaultAiCalibration());
};

export const saveAiCalibration = (values: AiCalibration[]) => writeJsonCookie(AI_COOKIE_KEY, values);

export const loadVoltageConfig = (): VoltageMode[] => {
  const raw = readJsonCookie<string[]>(VOLTAGE_CONFIG_COOKIE_KEY);
  const validValues = new Set(VOLTAGE_MODES.map(m => m.value));
  if (!Array.isArray(raw)) return [...DEFAULT_VOLTAGE_CONFIG];
  return Array.from({ length: AI_CHANNELS }, (_, i) => {
    const v = raw[i];
    return v && validValues.has(v as VoltageMode) ? v as VoltageMode : DEFAULT_VOLTAGE_CONFIG[i];
  });
};

export const saveVoltageConfig = (config: VoltageMode[]) => writeJsonCookie(VOLTAGE_CONFIG_COOKIE_KEY, config);

const loadFreeLabels = (key: string, channels: number): string[] => {
  const raw = readJsonCookie<string[]>(key);
  if (!Array.isArray(raw)) return Array.from({ length: channels }, () => '');
  return Array.from({ length: channels }, (_, i) => raw[i] ?? '');
};

export const loadAiFreeLabels = (): string[] => loadFreeLabels(AI_FREE_LABEL_COOKIE_KEY, AI_CHANNELS);

export const saveAiFreeLabels = (labels: string[]) => writeJsonCookie(AI_FREE_LABEL_COOKIE_KEY, labels);

export const loadAoFreeLabels = (): string[] => loadFreeLabels(AO_FREE_LABEL_COOKIE_KEY, AO_CHANNELS);

export const saveAoFreeLabels = (labels: string[]) => writeJsonCookie(AO_FREE_LABEL_COOKIE_KEY, labels);

export const loadParamFreeLabels = (): string[] => loadFreeLabels(PARAM_FREE_LABEL_COOKIE_KEY, PARAM_CHANNELS);

export const saveParamFreeLabels = (labels: string[]) => writeJsonCookie(PARAM_FREE_LABEL_COOKIE_KEY, labels);

export const aiToPhysical = (raw: number, cal: AiCalibration): number =>
  cal.a * raw * raw + cal.b * raw + cal.c;

export const getAiStatus = (raw: number): AiChannel['status'] => {
  const normalizedValue = Math.abs(raw);
  const ratio = normalizedValue / INT16_MAX;
  if (ratio >= 0.9) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'normal';
};

export const hx711RawToMvPerV = (raw: number): number =>
  raw / 32768.0 / 128.0 / 2 * 1e3;

export const hx711RawToMicroStrain = (raw: number): number =>
  hx711RawToMvPerV(raw) * 2e3;

export const ads1115RawToVolt = (raw: number): number =>
  raw / 32768.0 * 6.144;

export const isUnknownMode = (mode: VoltageMode): boolean => mode === 'unknown';

export const rawToDisplayValue = (raw: number, mode: VoltageMode): { value: number; unit: string } => {
  switch (mode) {
    case 'unknown':
      return { value: NaN, unit: '' };
    case 'hx711_mv_per_v':
      return { value: hx711RawToMvPerV(raw), unit: 'mV/V' };
    case 'hx711_micro_strain':
      return { value: hx711RawToMicroStrain(raw), unit: 'με' };
    case 'ads1115_10v':
      return { value: raw / 32768.0 * 10.0, unit: 'V' };
    case 'ads1115_6144mv':
      return { value: raw / 32768.0 * 6.144, unit: 'V' };
    case 'ads1115_4096mv':
      return { value: raw / 32768.0 * 4.096, unit: 'V' };
    case 'ads1115_2048mv':
      return { value: raw / 32768.0 * 2.048, unit: 'V' };
    case 'ads1115_1024mv':
      return { value: raw / 32768.0 * 1.024, unit: 'V' };
    case 'ads1115_512mv':
      return { value: raw / 32768.0 * 512, unit: 'mV' };
    case 'ads1115_256mv':
      return { value: raw / 32768.0 * 256, unit: 'mV' };
  }
};

export const getLevelColor = (ratio: number): { bar: string; text: string } => {
  if (ratio > 0.9) return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
  if (ratio > 0.6) return { bar: 'bg-yellow-400', text: 'text-yellow-500 dark:text-yellow-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
};
