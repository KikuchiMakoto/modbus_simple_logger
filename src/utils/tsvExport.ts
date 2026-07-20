/**
 * TSV (Tab-Separated Values) export utilities
 * Provides functions for formatting and exporting sensor data to TSV format
 */
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../tauri/runtime';

/**
 * Minimal streaming sink the TsvWriter writes to. The browser path uses
 * FileSystemWritableFileStream directly; the Tauri path forwards to
 * `tsv_append` (Rust `OpenOptions::append`) so the file is updated in place
 * and remains valid even if the app is force-quit between flushes.
 */
export interface TsvWritableSink {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Format a timestamp as a human-readable string
 * Format: YYYY/MM/DD HH:mm:ss.fff
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

function appendFormatted(
  out: string[],
  data: Float32Array | number[],
  fmt: (v: number) => string,
): void {
  for (let i = 0; i < data.length; i++) out.push(fmt(data[i]));
}

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
  const parts: string[] = [formatTimestamp(timestamp)];
  appendFormatted(parts, aiRaw, toStr);
  appendFormatted(parts, aiPhysical, fmt);
  appendFormatted(parts, aoRaw, toStr);
  appendFormatted(parts, aiVoltage, fmt);
  appendFormatted(parts, paramValues, fmt);
  return parts.join('\t') + '\n';
}

/**
 * TSV Writer class. Accepts any sink that exposes the minimal write/close
 * surface — the browser File System Access API stream satisfies it natively
 * and the Tauri host forwards writes to a Rust `tsv_append` command.
 */
export class TsvWriter {
  private stream: TsvWritableSink;
  private aiChannels: number;
  private aoChannels: number;
  private paramChannels: number;
  private physicalPrecision: number;
  private fileName: string;
  private writeBuffer: string[] = [];

  constructor(
    stream: TsvWritableSink,
    aiChannels: number,
    aoChannels: number,
    physicalPrecision: number = 3,
    fileName: string = 'unnamed.tsv',
    paramChannels: number = 0
  ) {
    this.stream = stream;
    this.aiChannels = aiChannels;
    this.aoChannels = aoChannels;
    this.paramChannels = paramChannels;
    this.physicalPrecision = physicalPrecision;
    this.fileName = fileName;
  }

  async writeHeader(): Promise<void> {
    const header = createTsvHeader(this.aiChannels, this.aoChannels, this.paramChannels);
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
 * Tauri sink: every flush hits the disk through a single append, so the
 * rolling TSV is always a valid file even if the app crashes mid-session.
 */
class TauriTsvSink implements TsvWritableSink {
  private closed = false;
  constructor(private readonly path: string) {}

  async write(data: string): Promise<void> {
    if (this.closed) throw new Error('TSV stream is closed');
    await invoke<void>('tsv_append', { path: this.path, data });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/**
 * Create a TSV file picker and initialize a TsvWriter.
 * Browser: File System Access API (`showSaveFilePicker`).
 * Tauri: native save dialog + `tsv_create_file` + `tsv_append` commands.
 */
export async function createTsvWriter(
  aiChannels: number,
  aoChannels: number,
  suggestedName?: string,
  physicalPrecision: number = 3,
  paramChannels: number = 0
): Promise<TsvWriter> {
  const now = new Date();
  const defaultName = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.tsv`;
  const filename = suggestedName ?? defaultName;

  if (isTauri()) {
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'TSV Files', extensions: ['tsv'] }],
    });
    if (path === null) {
      throw new DOMException('Save dialog cancelled', 'AbortError');
    }
    await invoke<void>('tsv_create_file', { path });
    const stream = new TauriTsvSink(path);
    const writer = new TsvWriter(stream, aiChannels, aoChannels, physicalPrecision, path, paramChannels);
    await writer.writeHeader();
    return writer;
  }

  if (!('showSaveFilePicker' in window)) {
    throw new Error('File System Access API not supported in this browser');
  }

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
  const writer = new TsvWriter(stream, aiChannels, aoChannels, physicalPrecision, fileHandle.name, paramChannels);
  await writer.writeHeader();
  return writer;
}
