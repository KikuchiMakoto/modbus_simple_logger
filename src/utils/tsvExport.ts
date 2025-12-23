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

/**
 * Format a single data row as TSV
 * @param timestamp - Unix timestamp in milliseconds
 * @param aiRaw - Array of raw AI channel values
 * @param aiPhysical - Array of physical AI channel values
 * @param physicalPrecision - Number of decimal places for physical values (default: 3)
 * @returns TSV data row string with newline
 */
export function formatTsvRow(
  timestamp: number,
  aiRaw: number[],
  aiPhysical: number[],
  physicalPrecision: number = 3
): string {
  const timestampStr = formatTimestamp(timestamp);
  const rawValues = aiRaw.map(v => v.toString());
  const phyValues = aiPhysical.map(v => v.toFixed(physicalPrecision));
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

  /**
   * Create a new TSV writer
   * @param stream - FileSystemWritableFileStream to write to
   * @param channels - Number of AI channels
   * @param physicalPrecision - Decimal places for physical values (default: 3)
   */
  constructor(
    stream: FileSystemWritableFileStream,
    channels: number,
    physicalPrecision: number = 3
  ) {
    this.stream = stream;
    this.channels = channels;
    this.physicalPrecision = physicalPrecision;
  }

  /**
   * Write TSV header to the file
   */
  async writeHeader(): Promise<void> {
    const header = createTsvHeader(this.channels);
    await this.stream.write(header);
  }

  /**
   * Write a single data row to the file
   * @param timestamp - Unix timestamp in milliseconds
   * @param aiRaw - Array of raw AI channel values
   * @param aiPhysical - Array of physical AI channel values
   */
  async writeRow(timestamp: number, aiRaw: number[], aiPhysical: number[]): Promise<void> {
    const row = formatTsvRow(timestamp, aiRaw, aiPhysical, this.physicalPrecision);
    await this.stream.write(row);
  }

  /**
   * Write multiple data rows to the file
   * @param dataPoints - Array of data points to write
   */
  async writeRows(
    dataPoints: Array<{ timestamp: number; aiRaw: number[]; aiPhysical: number[] }>
  ): Promise<void> {
    for (const point of dataPoints) {
      await this.writeRow(point.timestamp, point.aiRaw, point.aiPhysical);
    }
  }

  /**
   * Close the file stream
   */
  async close(): Promise<void> {
    await this.stream.close();
  }

  /**
   * Get the underlying stream
   */
  getStream(): FileSystemWritableFileStream {
    return this.stream;
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

  const filename = suggestedName ?? `modbus-log-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`;

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
  const writer = new TsvWriter(stream, channels, physicalPrecision);

  // Write header automatically
  await writer.writeHeader();

  return writer;
}
