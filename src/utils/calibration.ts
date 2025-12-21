import { AiCalibration, AoCalibration } from '../types';

const AI_COOKIE_KEY = 'ai_calibration_v1';
const AO_COOKIE_KEY = 'ao_calibration_v1';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const defaultAiCalibration = (): AiCalibration => ({ a: 1, b: 0, c: 0 });
const defaultAoCalibration = (): AoCalibration => ({ a: 1, b: 0 });

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
  document.cookie = `${key}=${encoded}; max-age=${ONE_YEAR_SECONDS}; path=/`; // 1 year
};

export const loadAiCalibration = (channels: number): AiCalibration[] => {
  const raw = parseCookie(AI_COOKIE_KEY);
  if (!Array.isArray(raw)) {
    return Array.from({ length: channels }, () => defaultAiCalibration());
  }
  return Array.from({ length: channels }, (_, idx) => raw[idx] ?? defaultAiCalibration());
};

export const loadAoCalibration = (channels: number): AoCalibration[] => {
  const raw = parseCookie(AO_COOKIE_KEY);
  if (!Array.isArray(raw)) {
    return Array.from({ length: channels }, () => defaultAoCalibration());
  }
  return Array.from({ length: channels }, (_, idx) => raw[idx] ?? defaultAoCalibration());
};

export const saveAiCalibration = (values: AiCalibration[]) => writeCookie(AI_COOKIE_KEY, values);
export const saveAoCalibration = (values: AoCalibration[]) => writeCookie(AO_COOKIE_KEY, values);

export const aiToPhysical = (raw: number, cal: AiCalibration) => cal.a * raw * raw + cal.b * raw + cal.c;
export const aoToPhysical = (raw: number, cal: AoCalibration) => cal.a * raw + cal.b;
