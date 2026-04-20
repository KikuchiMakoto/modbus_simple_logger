import { AiCalibration, AiChannel } from '../types';
import { readJsonCookie, writeJsonCookie } from './cookies';

const AI_COOKIE_KEY = 'ai_calibration_v1';
const INT16_MAX = 32767;
const WARNING_THRESHOLD = 0.8;
const DANGER_THRESHOLD = 0.9;

const defaultAiCalibration = (): AiCalibration => ({ a: 0, b: 1, c: 0 });

export const loadAiCalibration = (channels: number): AiCalibration[] => {
  const raw = readJsonCookie<AiCalibration[]>(AI_COOKIE_KEY);
  if (!Array.isArray(raw)) {
    return Array.from({ length: channels }, () => defaultAiCalibration());
  }
  return Array.from({ length: channels }, (_, idx) => raw[idx] ?? defaultAiCalibration());
};

export const saveAiCalibration = (values: AiCalibration[]) => writeJsonCookie(AI_COOKIE_KEY, values);

export const aiToPhysical = (raw: number, cal: AiCalibration): number =>
  cal.a * raw * raw + cal.b * raw + cal.c;

export const getAiStatus = (raw: number): AiChannel['status'] => {
  const normalizedValue = Math.abs(raw);
  const maxValue = INT16_MAX;
  const ratio = normalizedValue / maxValue;

  if (ratio >= DANGER_THRESHOLD) return 'danger';
  if (ratio >= WARNING_THRESHOLD) return 'warning';
  return 'normal';
};

// HX711 (AI CH 0-7): raw → mV/V
export const hx711RawToMvPerV = (raw: number): number =>
  raw / 32768.0 / 128.0 / 2 * 1e3;

// HX711 (AI CH 0-7): raw → μɛ (micro strain) — computed internally, not displayed
// Multiply mV/V by gauge factor (2e3) to convert to micro strain
export const hx711RawToMicroStrain = (raw: number): number =>
  hx711RawToMvPerV(raw) * 2e3;

// ADS1115 (AI CH 8-15): raw → V (±6.144V range)
export const ads1115RawToVolt = (raw: number): number =>
  raw / 32768.0 * 6.144;
