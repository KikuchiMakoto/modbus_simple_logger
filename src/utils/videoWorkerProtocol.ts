/** Messages between the main thread and the video writer worker. */

export interface VideoInitMessage {
  type: 'init';
  /**
   * The file to write, already created in the folder the user chose. The main
   * thread keeps the picker and the permission prompt (both need a user
   * gesture); the worker owns everything from createWritable() onwards, the
   * same split createTsvWriter uses.
   */
  fileHandle: FileSystemFileHandle;
}

export interface VideoChunkMessage {
  type: 'chunk';
  /** Transferred, not copied — the main thread must not touch it afterwards. */
  data: ArrayBuffer;
}

export interface VideoCloseMessage {
  type: 'close';
}

export type VideoWorkerRequest = VideoInitMessage | VideoChunkMessage | VideoCloseMessage;

export type VideoWorkerResponse =
  | { type: 'ready' }
  /** The stream closed and the file is on disk. */
  | { type: 'closed'; bytes: number }
  | { type: 'error'; message: string };
