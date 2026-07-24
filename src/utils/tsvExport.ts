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
 * Create TSV header row for AI/AO/Parameter channel data
 * Format: timestamp\tai_raw_00\t...\tai_phy_00\t...\tao_raw_00\t...\tai_vlt_00\t...\tparam_00\t...
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
    ...ch('ao_raw_', aoChannels),
    ...ch('ai_vlt_', aiChannels),
    ...ch('param_', paramChannels),
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
  const toStr = (v: number) => v.toString();
  const fmt = (v: number) => v.toFixed(physicalPrecision);
  // Single preallocated parts array, filled by index — no per-column copies.
  const parts: string[] = [formatTimestamp(timestamp)];
  appendFormatted(parts, aiRaw, toStr);
  appendFormatted(parts, aiPhysical, fmt);
  appendFormatted(parts, aoRaw, toStr);
  appendFormatted(parts, aiVoltage, fmt);
  appendFormatted(parts, paramValues, fmt);
  return parts.join('\t') + '\n';
}

/**
 * TSV Writer class for streaming TSV data to a file
 * Manages FileSystemWritableFileStream and provides convenient methods
 */
export class TsvWriter {
  private stream: FileSystemWritableFileStream;
  private aiChannels: number;
  private aoChannels: number;
  private paramChannels: number;
  private physicalPrecision: number;
  private fileName: string;
  private flushMaxRows: number;
  private writeBuffer: string[] = [];
  // Serializes flushes so a row-count-triggered flush and the periodic timer
  // flush can never issue overlapping stream.write() calls (which could
  // interleave and corrupt the file). Always resolved so one failed write does
  // not stall every later flush.
  private flushChain: Promise<void> = Promise.resolve();

  constructor(
    stream: FileSystemWritableFileStream,
    aiChannels: number,
    aoChannels: number,
    physicalPrecision: number = 3,
    fileName: string = 'unnamed.tsv',
    paramChannels: number = 0,
    flushMaxRows: number = 0
  ) {
    this.stream = stream;
    this.aiChannels = aiChannels;
    this.aoChannels = aoChannels;
    this.paramChannels = paramChannels;
    this.physicalPrecision = physicalPrecision;
    this.fileName = fileName;
    this.flushMaxRows = flushMaxRows;
  }

  async writeHeader(): Promise<void> {
    const header = createTsvHeader(this.aiChannels, this.aoChannels, this.paramChannels);
    await this.stream.write(header);
  }

  /**
   * Flush the buffered rows to the stream. Flushes are serialized on a single
   * chain, so callers (the periodic timer, the row-count trigger, and close())
   * never overlap. Each turn drains whatever is buffered at that moment, so
   * back-to-back flushes are safe and never double-write. The returned promise
   * rejects if this flush's write fails, while the internal chain stays resolved
   * so subsequent flushes still run.
   */
  flush(): Promise<void> {
    const next = this.flushChain.then(
      () => this.drainBuffer(),
      () => this.drainBuffer(),
    );
    this.flushChain = next.catch(() => {});
    return next;
  }

  private async drainBuffer(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    const data = this.writeBuffer.join('');
    this.writeBuffer = [];
    await this.stream.write(data);
  }

  /**
   * Queue a single data row for writing (flushed later via flush()).
   * @param timestamp - Unix timestamp in milliseconds
   * @param aiRaw - Array of raw AI channel values
   * @param aiPhysical - Array of physical AI channel values
   * @param aoRaw - Array of raw AO channel values (millivolts)
   * @param aiVoltage - Array of AI voltage display values
   * @param paramValues - Array of Parameter values (default: [])
   */
  writeRow(
    timestamp: number,
    aiRaw: Float32Array | number[],
    aiPhysical: Float32Array | number[],
    aoRaw: Float32Array | number[],
    aiVoltage: Float32Array | number[],
    paramValues: Float32Array | number[] = []
  ): void {
    if (aiRaw.length !== this.aiChannels) {
      throw new Error(`Invalid AI raw column count: expected ${this.aiChannels}, got ${aiRaw.length}.`);
    }
    if (aiPhysical.length !== this.aiChannels) {
      throw new Error(`Invalid AI physical column count: expected ${this.aiChannels}, got ${aiPhysical.length}.`);
    }
    if (aoRaw.length !== this.aoChannels) {
      throw new Error(`Invalid AO raw column count: expected ${this.aoChannels}, got ${aoRaw.length}.`);
    }
    if (aiVoltage.length !== this.aiChannels) {
      throw new Error(`Invalid AI voltage column count: expected ${this.aiChannels}, got ${aiVoltage.length}.`);
    }
    if (paramValues.length !== this.paramChannels) {
      throw new Error(`Invalid Parameter values column count: expected ${this.paramChannels}, got ${paramValues.length}.`);
    }
    this.writeBuffer.push(formatTsvRow(timestamp, aiRaw, aiPhysical, aoRaw, aiVoltage, paramValues, this.physicalPrecision));
    // Row-count-based flush: cap each flush's work regardless of sampling rate so
    // the join()+write() cost stays bounded (whichever comes first with the
    // periodic timer). Fire-and-forget; errors are logged, mirroring the timer.
    if (this.flushMaxRows > 0 && this.writeBuffer.length >= this.flushMaxRows) {
      this.flush().catch((err) => console.error('TSV auto-flush error:', err));
    }
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
 * @param paramChannels - Number of Parameter channels (default: 0)
 * @param flushMaxRows - Buffered-row count that triggers a flush (0 disables; default: 0)
 * @returns TsvWriter instance
 * @throws Error if File System Access API is not supported
 */
export async function createTsvWriter(
  aiChannels: number,
  aoChannels: number,
  suggestedName?: string,
  physicalPrecision: number = 3,
  paramChannels: number = 0,
  flushMaxRows: number = 0
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
  const writer = new TsvWriter(stream, aiChannels, aoChannels, physicalPrecision, fileHandle.name, paramChannels, flushMaxRows);

  await writer.writeHeader();

  return writer;
}
