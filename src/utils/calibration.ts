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

// --- HX711 Calibration window helpers ---------------------------------------

// Denominator (electrical) unit used by the spec-based calibration (method 1).
// Only this unit affects the computed slope b; the physical-quantity unit
// (kg, mm, N, ...) is a display-only label and never enters the arithmetic.
export type Hx711DenominatorUnit = 'uv_per_v' | 'mv_per_v' | 'micro_strain';

export const HX711_DENOMINATOR_UNITS: { value: Hx711DenominatorUnit; label: string }[] = [
  { value: 'uv_per_v', label: 'μV/V' },
  { value: 'mv_per_v', label: 'mV/V' },
  { value: 'micro_strain', label: 'με' },
];

// Denominator-unit value produced per 1 raw count. The raw→unit conversions are
// linear through the origin, so the slope is simply convert(1). μV/V is mV/V×1000.
export const hx711SlopePerRaw = (unit: Hx711DenominatorUnit): number => {
  switch (unit) {
    case 'uv_per_v':
      return hx711RawToMvPerV(1) * 1e3;
    case 'mv_per_v':
      return hx711RawToMvPerV(1);
    case 'micro_strain':
      return hx711RawToMicroStrain(1);
  }
};

// Method 1: b = sensitivity × slope(denominator unit), a = 0, c = 0.
// sensitivity carries units [physical]/[denominator unit] but is just a number
// here; the physical unit label is irrelevant to the result.
export const specToCalibration = (sensitivity: number, unit: Hx711DenominatorUnit): AiCalibration | null => {
  if (!Number.isFinite(sensitivity)) return null;
  const b = sensitivity * hx711SlopePerRaw(unit);
  if (!Number.isFinite(b)) return null;
  return { a: 0, b, c: 0 };
};

export type CalibrationFitPoint = { raw: number; phy: number };

// Solve a 3×3 linear system A·x = rhs via Gaussian elimination with partial
// pivoting. Returns null if the matrix is (near-)singular.
const solve3 = (A: number[][], rhs: number[]): [number, number, number] | null => {
  const m = [
    [A[0][0], A[0][1], A[0][2], rhs[0]],
    [A[1][0], A[1][1], A[1][2], rhs[1]],
    [A[2][0], A[2][1], A[2][2], rhs[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) {
      const t = m[pivot];
      m[pivot] = m[col];
      m[col] = t;
    }
    for (let r = col + 1; r < 3; r++) {
      const f = m[r][col] / m[col][col];
      for (let k = col; k < 4; k++) m[r][k] -= f * m[col][k];
    }
  }
  const x: [number, number, number] = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = m[i][3];
    for (let k = i + 1; k < 3; k++) s -= m[i][k] * x[k];
    x[i] = s / m[i][i];
  }
  if (!x.every((v) => Number.isFinite(v))) return null;
  return x;
};

const fitLinearLeastSquares = (points: CalibrationFitPoint[]): AiCalibration | null => {
  let n = 0;
  let sx = 0;
  let sxx = 0;
  let sy = 0;
  let sxy = 0;
  for (const { raw: x, phy: y } of points) {
    n += 1;
    sx += x;
    sxx += x * x;
    sy += y;
    sxy += x * y;
  }
  const det = sxx * n - sx * sx;
  if (Math.abs(det) < 1e-12) return null;
  const b = (sxy * n - sy * sx) / det;
  const c = (sxx * sy - sx * sxy) / det;
  if (!Number.isFinite(b) || !Number.isFinite(c)) return null;
  return { a: 0, b, c };
};

const fitQuadraticLeastSquares = (points: CalibrationFitPoint[]): AiCalibration | null => {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let s4 = 0;
  let ty = 0;
  let txy = 0;
  let tx2y = 0;
  for (const { raw: x, phy: y } of points) {
    const x2 = x * x;
    s0 += 1;
    s1 += x;
    s2 += x2;
    s3 += x2 * x;
    s4 += x2 * x2;
    ty += y;
    txy += x * y;
    tx2y += x2 * y;
  }
  const sol = solve3(
    [
      [s4, s3, s2],
      [s3, s2, s1],
      [s2, s1, s0],
    ],
    [tx2y, txy, ty],
  );
  if (!sol) return null;
  const [a, b, c] = sol;
  return { a, b, c };
};

// Method 2: least-squares fit of Phy = a·Raw² + b·Raw + c.
//   2 points               → exact line through both (a = 0)
//   3+ points, ≥3 distinct → quadratic least squares (a, b, c)
//   3+ points, 2 distinct  → linear least squares (a = 0)
//   <2 distinct raw values → null (singular / not enough information)
export const fitCalibration = (points: CalibrationFitPoint[]): AiCalibration | null => {
  const n = points.length;
  if (n < 2) return null;
  const distinctRaw = new Set(points.map((p) => p.raw)).size;
  if (distinctRaw < 2) return null;

  if (n === 2) {
    const [p0, p1] = points;
    const dr = p1.raw - p0.raw;
    if (dr === 0) return null;
    const b = (p1.phy - p0.phy) / dr;
    const c = p0.phy - b * p0.raw;
    if (!Number.isFinite(b) || !Number.isFinite(c)) return null;
    return { a: 0, b, c };
  }

  if (distinctRaw >= 3) {
    const quad = fitQuadraticLeastSquares(points);
    if (quad) return quad;
  }
  return fitLinearLeastSquares(points);
};

export const getLevelColor = (ratio: number): { bar: string; text: string } => {
  if (ratio > 0.9) return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
  if (ratio > 0.6) return { bar: 'bg-yellow-400', text: 'text-yellow-500 dark:text-yellow-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
};
