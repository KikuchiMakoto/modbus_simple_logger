import { AiCalibration, AiChannel } from '../types';

const AI_COOKIE_KEY = 'ai_calibration_v1';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const INT16_MAX = 32767;
const INT16_MIN = -32768;
const WARNING_THRESHOLD = 0.8;
const DANGER_THRESHOLD = 0.9;

const defaultAiCalibration = (): AiCalibration => ({ a: 0, b: 1, c: 0 });

const parseCookie = (key: string) => {
  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${key}=`));
  if (!cookie) return null;
  const value = cookie.split('=')[1];
  try {
    return JSON.parse(decodeURIComponent(value));
  } catch (err) {
    console.warn('Failed to parse cookie', err);
    return null;
  }
};

const writeCookie = (key: string, value: unknown) => {
  const encoded = encodeURIComponent(JSON.stringify(value));
  document.cookie = `${key}=${encoded}; max-age=${ONE_YEAR_SECONDS}; path=/`;
};

export const loadAiCalibration = (channels: number): AiCalibration[] => {
  const raw = parseCookie(AI_COOKIE_KEY);
  if (!Array.isArray(raw)) {
    return Array.from({ length: channels }, () => defaultAiCalibration());
  }
  return Array.from({ length: channels }, (_, idx) => raw[idx] ?? defaultAiCalibration());
};

export const saveAiCalibration = (values: AiCalibration[]) => writeCookie(AI_COOKIE_KEY, values);

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
