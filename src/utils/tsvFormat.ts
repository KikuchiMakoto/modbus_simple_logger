/**
 * Pure TSV (Tab-Separated Values) formatting helpers.
 *
 * These functions contain no browser/DOM APIs, so they are safe to import from
 * both the main thread and the TSV writer Web Worker (src/tsvWriterWorker.ts).
 */

/**
 * Format a timestamp as a human-readable string
 * Format: YYYY/MM/DD HH:mm:ss.fff
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted timestamp string
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const fff = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}.${fff}`;
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

/** Append each element of `data` to `out` formatted by `fmt` (no intermediate
 * array — works for both Float32Array and number[]). */
function appendFormatted(
  out: string[],
  data: Float32Array | number[],
  fmt: (v: number) => string,
): void {
  for (let i = 0; i < data.length; i++) out.push(fmt(data[i]));
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
 * @param aiRawAsFloat - When true, AI raw values are emitted with the float
 *   formatter (used in Modbus extended precision mode, where AI Input Registers
 *   are 32-bit floats). Default false: AI raw values are emitted as integers
 *   via toString() (HX711 / ADS1115 ADC counts).
 * @returns TSV data row string with newline
 */
export function formatTsvRow(
  timestamp: number,
  aiRaw: Float32Array | number[],
  aiPhysical: Float32Array | number[],
  aoRaw: Float32Array | number[],
  aiVoltage: Float32Array | number[],
  paramValues: Float32Array | number[] = [],
  physicalPrecision: number = 3,
  aiRawAsFloat: boolean = false
): string {
  const intStr = (v: number) => v.toString();
  // Round to physicalPrecision decimals, then drop trailing zeros and a bare
  // decimal point: 0 -> "0", 1.230 -> "1.23", 1.000 -> "1", -0 -> "0". This
  // trims wasteful zero-fill from the physical/voltage/Parameter columns to keep
  // the file small, without changing the numeric value (parses identically in
  // pandas/Excel).
  const fmt = (v: number) => parseFloat(v.toFixed(physicalPrecision)).toString();
  // Single preallocated parts array, filled by index — no per-column copies.
  const parts: string[] = [formatTimestamp(timestamp)];
  appendFormatted(parts, aiRaw, aiRawAsFloat ? fmt : intStr);
  appendFormatted(parts, aiPhysical, fmt);
  appendFormatted(parts, aiVoltage, fmt);
  appendFormatted(parts, aoRaw, intStr);
  appendFormatted(parts, paramValues, fmt);
  return parts.join('\t') + '\n';
}
