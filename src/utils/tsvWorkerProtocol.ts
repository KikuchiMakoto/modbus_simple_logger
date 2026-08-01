/**
 * Message protocol shared between the main thread (createTsvWriter in
 * tsvExport.ts) and the TSV writer Web Worker (src/tsvWriterWorker.ts).
 *
 * Types only — imported with `import type` on both sides so no runtime code
 * crosses the boundary.
 */
import type { FileSystemFileHandle } from '../types';

/** main → worker: open the file and write the header. */
export interface TsvInitMessage {
  type: 'init';
  fileHandle: FileSystemFileHandle;
  aiChannels: number;
  aoChannels: number;
  paramChannels: number;
  physicalPrecision: number;
  /** Buffered-row count that triggers a flush (0 disables the row-count flush). */
  flushMaxRows: number;
}

/** main → worker: append one data row (numeric arrays are structured-cloned). */
export interface TsvRowMessage {
  type: 'row';
  timestamp: number;
  aiRaw: Float32Array | number[];
  aiPhysical: Float32Array | number[];
  aoRaw: Float32Array | number[];
  aiVoltage: Float32Array | number[];
  param: Float32Array | number[];
}

/** main → worker: flush buffered rows now (the periodic 60 s timer). */
export interface TsvFlushMessage {
  type: 'flush';
}

/** main → worker: flush remaining rows, close the stream, then reply 'closed'. */
export interface TsvCloseMessage {
  type: 'close';
}

export type TsvWorkerRequest =
  | TsvInitMessage
  | TsvRowMessage
  | TsvFlushMessage
  | TsvCloseMessage;

/** worker → main: init finished, header written, ready for rows. */
export interface TsvReadyMessage {
  type: 'ready';
}

/** worker → main: close finished (stream drained and closed). */
export interface TsvClosedMessage {
  type: 'closed';
}

/** worker → main: a write/flush/close failed; surface it to the user. */
export interface TsvErrorMessage {
  type: 'error';
  message: string;
}

/**
 * worker → main: something the user should know about, but the save itself is
 * fine and continues. Distinct from 'error' because the init handshake rejects
 * on 'error': the crash-recovery mirror is reported during init, and sending it
 * as an error made a browser that cannot provide OPFS fail Start Save outright —
 * losing the save this exists to protect, in the name of protecting it.
 */
export interface TsvWarningMessage {
  type: 'warning';
  message: string;
}

export type TsvWorkerResponse =
  | TsvReadyMessage
  | TsvClosedMessage
  | TsvErrorMessage
  | TsvWarningMessage;
