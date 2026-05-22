/**
 * TSV (Tab-Separated Values) export utilities
 * Provides functions for formatting and exporting sensor data to TSV format
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
 * Create TSV header row for AI/AO channel data
 * Format: timestamp\tai_raw_00\t...\tai_phy_00\t...\tao_raw_00\t...\tai_vlt_00\t...
 * @param aiChannels - Number of AI channels
 * @param aoChannels - Number of AO channels
 * @returns TSV header string with newline
 */
export function createTsvHeader(aiChannels: number, aoChannels: number): string {
  const ch = (prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i.toString().padStart(2, '0')}`);
  return [
    'timestamp',
    ...ch('ai_raw_', aiChannels),
    ...ch('ai_phy_', aiChannels),
    ...ch('ao_raw_', aoChannels),
    ...ch('ai_vlt_', aiChannels),
  ].join('\t') + '\n';
}

function toArrayLike(data: Float32Array | number[]): number[] {
  return data instanceof Float32Array ? Array.from(data) : data;
}

/**
 * Format a single data row as TSV
 * @param timestamp - Unix timestamp in milliseconds
 * @param aiRaw - Array of raw AI channel values
 * @param aiPhysical - Array of physical AI channel values
 * @param aoRaw - Array of raw AO channel values (millivolts)
 * @param aiVoltage - Array of AI voltage display values
 * @param physicalPrecision - Number of decimal places for physical/voltage values (default: 3)
 * @returns TSV data row string with newline
 */
export function formatTsvRow(
  timestamp: number,
  aiRaw: Float32Array | number[],
  aiPhysical: Float32Array | number[],
  aoRaw: Float32Array | number[],
  aiVoltage: Float32Array | number[],
  physicalPrecision: number = 3
): string {
  const timestampStr = formatTimestamp(timestamp);
  const fmt = (v: number) => v.toFixed(physicalPrecision);
  return [
    timestampStr,
    ...toArrayLike(aiRaw).map(v => v.toString()),
    ...toArrayLike(aiPhysical).map(fmt),
    ...toArrayLike(aoRaw).map(v => v.toString()),
    ...toArrayLike(aiVoltage).map(fmt),
  ].join('\t') + '\n';
}

/**
 * TSV Writer class for streaming TSV data to a file
 * Manages FileSystemWritableFileStream and provides convenient methods
 */
export class TsvWriter {
  private stream: FileSystemWritableFileStream;
  private aiChannels: number;
  private aoChannels: number;
  private physicalPrecision: number;
  private fileName: string;
  private writeBuffer: string[] = [];

  constructor(
    stream: FileSystemWritableFileStream,
    aiChannels: number,
    aoChannels: number,
    physicalPrecision: number = 3,
    fileName: string = 'unnamed.tsv'
  ) {
    this.stream = stream;
    this.aiChannels = aiChannels;
    this.aoChannels = aoChannels;
    this.physicalPrecision = physicalPrecision;
    this.fileName = fileName;
  }

  async writeHeader(): Promise<void> {
    const header = createTsvHeader(this.aiChannels, this.aoChannels);
    await this.stream.write(header);
  }

  async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    const data = this.writeBuffer.join('');
    this.writeBuffer = [];
    await this.stream.write(data);
  }

  writeRow(
    timestamp: number,
    aiRaw: Float32Array | number[],
    aiPhysical: Float32Array | number[],
    aoRaw: Float32Array | number[],
    aiVoltage: Float32Array | number[]
  ): void {
    const rawArr = toArrayLike(aiRaw);
    const phyArr = toArrayLike(aiPhysical);
    if (rawArr.length !== this.aiChannels) {
      throw new Error(`Invalid AI raw column count: expected ${this.aiChannels}, got ${rawArr.length}.`);
    }
    if (phyArr.length !== this.aiChannels) {
      throw new Error(`Invalid AI physical column count: expected ${this.aiChannels}, got ${phyArr.length}.`);
    }
    this.writeBuffer.push(formatTsvRow(timestamp, aiRaw, aiPhysical, aoRaw, aiVoltage, this.physicalPrecision));
  }

  async close(): Promise<void> {
    await this.flush();
    await this.stream.close();
  }

  getFileName(): string {
    return this.fileName;
  }
}

/**
 * Create a TSV file picker and initialize a TsvWriter
 * @param aiChannels - Number of AI channels
 * @param aoChannels - Number of AO channels
 * @param suggestedName - Suggested filename (default: auto-generated with timestamp)
 * @param physicalPrecision - Decimal places for physical values (default: 3)
 * @returns TsvWriter instance
 * @throws Error if File System Access API is not supported
 */
export async function createTsvWriter(
  aiChannels: number,
  aoChannels: number,
  suggestedName?: string,
  physicalPrecision: number = 3
): Promise<TsvWriter> {
  if (!('showSaveFilePicker' in window)) {
    throw new Error('File System Access API not supported in this browser');
  }

  const now = new Date();
  const defaultName = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.tsv`;
  const filename = suggestedName ?? defaultName;

  const fileHandle = await window.showSaveFilePicker({
    suggestedName: filename,
    types: [
      {
        description: 'TSV Files',
        accept: { 'text/tab-separated-values': ['.tsv'] },
      },
    ],
  });

  const stream = await fileHandle.createWritable();
  const writer = new TsvWriter(stream, aiChannels, aoChannels, physicalPrecision, fileHandle.name);

  await writer.writeHeader();

  return writer;
}
