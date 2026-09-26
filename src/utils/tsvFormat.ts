/**
 * Pure TSV (Tab-Separated Values) formatting helpers.
 *
 * These functions contain no browser/DOM APIs, so they are safe to import from
 * both the main thread and the TSV writer Web Worker (src/tsvWriterWorker.ts).
 */

import { formatFloat32 } from './floatFormat';

const PAD2: string[] = [];
for (let i = 0; i < 100; i++) {
  PAD2[i] = i < 10 ? '0' + i : String(i);
}

/**
 * Format a timestamp as a human-readable string
 * Format: YYYY/MM/DD HH:mm:ss.fff
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted timestamp string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = PAD2[date.getMonth() + 1];
  const dd = PAD2[date.getDate()];
  const hh = PAD2[date.getHours()];
  const min = PAD2[date.getMinutes()];
  const ss = PAD2[date.getSeconds()];
  const ms = date.getMilliseconds();
  const fff = ms < 10 ? '00' + ms : ms < 100 ? '0' + ms : String(ms);
  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}.${fff}`;
}

/**
 * Fast trimming of trailing zeros and bare decimal point from toFixed output.
 * Preserves the existing fixed-decimal rounding policy without a
 * parseFloat/toString round trip.
 */
function formatTrimmed(v: number, precision: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toString();
  const s = v.toFixed(precision);
  const dot = s.indexOf('.');
  if (dot === -1) return s === '-0' ? '0' : s;
  let end = s.length - 1;
  while (end > dot && s.charCodeAt(end) === 48 /* '0' */) {
    end--;
  }
  const res = end === dot ? s.slice(0, dot) : (end === s.length - 1 ? s : s.slice(0, end + 1));
  return res === '-0' ? '0' : res;
}

/**
 * Create TSV header row for AI/AO/Parameter channel data
 * Format: timestamp\tai_raw_00\t...\tai_phy_00\t...\tai_vlt_00\t...\tao_raw_00\t...\tpar_00\t...
 * @param aiChannels - Number of AI channels
 * @param aoChannels - Number of AO channels
 * @param paramChannels - Number of Parameter channels (default: 0)
 * @returns TSV header string with newline
 */
export function createTsvHeader(aiChannels: number, aoChannels: number, paramChannels: number = 0): string {
  const ch = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i.toString().padStart(2, '0')}`);
  return [
    'timestamp',
    ...ch('ai_raw_', aiChannels),
    ...ch('ai_phy_', aiChannels),
    ...ch('ai_vlt_', aiChannels),
    ...ch('ao_raw_', aoChannels),
    ...ch('par_', paramChannels),
  ].join('\t') + '\n';
}

/**
 * Format a single data row as TSV
 * @param timestamp - Unix timestamp in milliseconds
 * @param aiRaw - Array of raw AI channel values
 * @param aiPhysical - Array of physical AI channel values
 * @param aoRaw - Array of raw AO channel values (millivolts)
 * @param aiVoltage - Array of AI voltage display values
 * @param paramValues - Array of Parameter values (default: [])
 * @param physicalPrecision - Number of decimal places for physical/voltage/Parameter values (default: 3)
 * @returns TSV data row string with newline
 */
export function formatTsvRow(
  timestamp: number,
  aiRaw: Float32Array | number[],
  aiPhysical: Float32Array | number[],
  aoRaw: Float32Array | number[],
  aiVoltage: Float32Array | number[],
  paramValues: Float32Array | number[] = [],
  physicalPrecision: number = 3
): string {
  // Preallocate exact number of columns to eliminate dynamic resizing.
  const total = 1 + aiRaw.length + aiPhysical.length + aiVoltage.length + aoRaw.length + paramValues.length;
  const parts = new Array<string>(total);
  let p = 0;

  parts[p++] = formatTimestamp(timestamp);
  for (let i = 0; i < aiRaw.length; i++) parts[p++] = aiRaw[i].toString();
  for (let i = 0; i < aiPhysical.length; i++) parts[p++] = formatTrimmed(aiPhysical[i], physicalPrecision);
  for (let i = 0; i < aiVoltage.length; i++) parts[p++] = formatTrimmed(aiVoltage[i], physicalPrecision);
  for (let i = 0; i < aoRaw.length; i++) parts[p++] = aoRaw[i].toString();
  for (let i = 0; i < paramValues.length; i++) parts[p++] = formatFloat32(paramValues[i]);

  return parts.join('\t') + '\n';
}
