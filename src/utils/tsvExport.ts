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
 * Create TSV header row for AI channel data
 * Format: timestamp\tai_raw_00\tai_raw_01\t...\tai_phy_00\tai_phy_01\t...
 * @param channels - Number of AI channels
 * @returns TSV header string with newline
 */
export function createTsvHeader(channels: number): string {
  const rawHeaders = Array.from({ length: channels }, (_, i) =>
    `ai_raw_${i.toString().padStart(2, '0')}`
  );
  const phyHeaders = Array.from({ length: channels }, (_, i) =>
    `ai_phy_${i.toString().padStart(2, '0')}`
  );
  return ['timestamp', ...rawHeaders, ...phyHeaders].join('\t') + '\n';
}

function toArrayLike(data: Float32Array | number[]): number[] {
  return data instanceof Float32Array ? Array.from(data) : data;
}

/**
 * Format a single data row as TSV
 * @param timestamp - Unix timestamp in milliseconds
 * @param aiRaw - Array of raw AI channel values (Float32Array or number[])
 * @param aiPhysical - Array of physical AI channel values (Float32Array or number[])
 * @param physicalPrecision - Number of decimal places for physical values (default: 3)
 * @returns TSV data row string with newline
 */
export function formatTsvRow(
  timestamp: number,
  aiRaw: Float32Array | number[],
  aiPhysical: Float32Array | number[],
  physicalPrecision: number = 3
): string {
  const timestampStr = formatTimestamp(timestamp);
  const rawArr = toArrayLike(aiRaw);
  const phyArr = toArrayLike(aiPhysical);
  const rawValues = rawArr.map(v => v.toString());
  const phyValues = phyArr.map(v => v.toFixed(physicalPrecision));
  return [timestampStr, ...rawValues, ...phyValues].join('\t') + '\n';
}

/**
 * TSV Writer class for streaming TSV data to a file
 * Manages FileSystemWritableFileStream and provides convenient methods
 */
export class TsvWriter {
  private stream: FileSystemWritableFileStream;
  private channels: number;
  private physicalPrecision: number;
  private fileName: string;
  private writeBuffer: string[] = [];

  constructor(
    stream: FileSystemWritableFileStream,
    channels: number,
    physicalPrecision: number = 3,
    fileName: string = 'unnamed.tsv'
  ) {
    this.stream = stream;
    this.channels = channels;
    this.physicalPrecision = physicalPrecision;
    this.fileName = fileName;
  }

  async writeHeader(): Promise<void> {
    const header = createTsvHeader(this.channels);
    await this.stream.write(header);
  }

  async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    const data = this.writeBuffer.join('');
    this.writeBuffer = [];
    await this.stream.write(data);
  }

  writeRow(timestamp: number, aiRaw: Float32Array | number[], aiPhysical: Float32Array | number[]): void {
    const rawArr = toArrayLike(aiRaw);
    const phyArr = toArrayLike(aiPhysical);
    if (rawArr.length !== this.channels) {
      throw new Error(`Invalid raw values column count: expected ${this.channels}, got ${rawArr.length}.`);
    }
    if (phyArr.length !== this.channels) {
      throw new Error(`Invalid physical values column count: expected ${this.channels}, got ${phyArr.length}.`);
    }
    this.writeBuffer.push(formatTsvRow(timestamp, aiRaw, aiPhysical, this.physicalPrecision));
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
 * @param channels - Number of AI channels
 * @param suggestedName - Suggested filename (default: auto-generated with timestamp)
 * @param physicalPrecision - Decimal places for physical values (default: 3)
 * @returns TsvWriter instance
 * @throws Error if File System Access API is not supported
 */
export async function createTsvWriter(
  channels: number,
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
  const writer = new TsvWriter(stream, channels, physicalPrecision, fileHandle.name);

  await writer.writeHeader();

  return writer;
}
