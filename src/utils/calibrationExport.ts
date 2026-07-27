/**
 * TSV export for the Input Calibrator window (HX711 and ADS1115 channels).
 *
 * The layout follows the convention oscilloscope and DAQ exports use: a
 * key/value metadata block, then the sample table, each delimited by an
 * explicit marker line. The markers are what make the file machine-readable
 * without guessing — a reader skips to [DATA] and hands the rest to any TSV
 * parser, and the metadata block can grow new keys later without breaking it.
 *
 * The fit columns are exported alongside the raw points on purpose: a
 * calibration record whose residuals cannot be checked after the fact is not
 * much of a record.
 */
import { AiCalibration } from '../types';
import { CalibrationFitPoint } from './calibration';

const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? 'unknown';
const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'modbus_simple_logger';

/**
 * Everything the calibration window knows about the export.
 *
 * Measured only. The Spec tab has no sample table to export — it derives b from
 * two numbers already written on the sensor's datasheet — so exporting it would
 * produce a file whose data section is always empty.
 */
export interface CalibrationExport {
  /** Window title, e.g. "Input Calibrator". */
  title: string;
  /**
   * Front-end the channel belongs to, e.g. "HX711". Its own key because the
   * window title no longer names it: HX711 and ADS1115 share one window, so the
   * chip is a property of the channel rather than of where the export came from.
   */
  sensor?: string;
  channel: number;
  /** Fitted coefficients, or null when the points admit no unique fit. */
  result: AiCalibration | null;
  /** Points that entered the fit. */
  points: CalibrationFitPoint[];
  /** Rows present in the editor, including incomplete ones. */
  totalRows: number;
  /** Live raw reading at export time. */
  liveRaw: number;
}

const pad = (n: number, width = 2) => n.toString().padStart(width, '0');

/** Local time, not UTC: these files are read next to a lab notebook. */
const stampCompact = (d: Date): string =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
  `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const stampReadable = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
  `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** `20260726_201533_ch07.tsv` */
export const calibrationFileName = (channel: number, at: Date = new Date()): string =>
  `${stampCompact(at)}_ch${pad(channel)}.tsv`;

// Full double precision, so a round-trip through the file reproduces the
// coefficients exactly. The UI's shortened display is for reading, not storing.
const num = (x: number): string => (Number.isFinite(x) ? String(x) : 'NaN');

/** Tabs and newlines would break the row they sit in; nothing else needs escaping. */
const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim();

/**
 * Coefficient of determination for the fit, or null when it is undefined
 * (fewer than two points, or every point at the same physical value).
 */
const rSquared = (points: CalibrationFitPoint[], fit: AiCalibration): number | null => {
  if (points.length < 2) return null;
  const mean = points.reduce((sum, p) => sum + p.phy, 0) / points.length;
  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const predicted = fit.a * p.raw * p.raw + fit.b * p.raw + fit.c;
    ssRes += (p.phy - predicted) ** 2;
    ssTot += (p.phy - mean) ** 2;
  }
  if (ssTot === 0) return null;
  return 1 - ssRes / ssTot;
};

const rmsResidual = (points: CalibrationFitPoint[], fit: AiCalibration): number | null => {
  if (points.length === 0) return null;
  let sum = 0;
  for (const p of points) {
    const predicted = fit.a * p.raw * p.raw + fit.b * p.raw + fit.c;
    sum += (p.phy - predicted) ** 2;
  }
  return Math.sqrt(sum / points.length);
};

/** Build the full file contents. */
export function buildCalibrationTsv(data: CalibrationExport, at: Date = new Date()): string {
  const { result, points } = data;
  const r2 = result ? rSquared(points, result) : null;
  const rms = result ? rmsResidual(points, result) : null;
  const meta: [string, string][] = [
    ['Application', clean(APP_NAME)],
    ['AppVersion', clean(APP_VERSION)],
    ['Exported', stampReadable(at)],
    ['Window', clean(data.title)],
    ['Channel', String(data.channel)],
    ['ChannelLabel', `CH${pad(data.channel)}`],
    ['Sensor', clean(data.sensor ?? '')],
    ['Method', 'Measured'],
    ['Model', 'phy = a*raw^2 + b*raw + c'],
    ['CoefA', result ? num(result.a) : ''],
    ['CoefB', result ? num(result.b) : ''],
    ['CoefC', result ? num(result.c) : ''],
    ['FitType', result ? (result.a === 0 ? 'linear' : 'quadratic') : 'none'],
    ['RSquared', r2 === null ? '' : num(r2)],
    ['RmsResidual', rms === null ? '' : num(rms)],
    ['PointCount', String(points.length)],
    ['EditorRows', String(data.totalRows)],
    ['LiveRaw', num(data.liveRaw)],
  ];

  const lines: string[] = ['[HEADER]'];
  for (const [key, value] of meta) lines.push(`${key}\t${value}`);
  lines.push('[/HEADER]', '', '[DATA]', 'index\tphy\traw\tfit_phy\tresidual');

  points.forEach((p, i) => {
    const fitted = result ? result.a * p.raw * p.raw + result.b * p.raw + result.c : NaN;
    const residual = result ? p.phy - fitted : NaN;
    lines.push(
      `${i + 1}\t${num(p.phy)}\t${num(p.raw)}\t` +
        `${result ? num(fitted) : ''}\t${result ? num(residual) : ''}`,
    );
  });

  lines.push('[/DATA]', '');
  return lines.join('\r\n');
}

/**
 * Save the export via a download rather than showSaveFilePicker(): the picker
 * would put a modal on top of the calibration window and, unlike the logger's
 * save path, there is no stream to keep open afterwards.
 */
export function downloadCalibrationTsv(data: CalibrationExport): string {
  const at = new Date();
  const name = calibrationFileName(data.channel, at);
  const blob = new Blob([buildCalibrationTsv(data, at)], {
    type: 'text/tab-separated-values;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoking synchronously cancels the download in Chromium.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return name;
}
