import { AiCalibration, AiChannel } from '../types';
import { readJsonCookie, writeJsonCookie } from './cookies';

const AI_COOKIE_KEY = 'ai_calibration_v1';
const INT16_MAX = 32767;
const INT16_MIN = -32768;
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

export const clampVoltage = (voltage: number): number =>
  Math.max(0, Math.min(10, voltage));

export const voltageToModbus = (voltage: number): number =>
  Math.round(clampVoltage(voltage) * 1000);
