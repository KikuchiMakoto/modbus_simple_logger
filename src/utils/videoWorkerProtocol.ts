/** Messages between the main thread and the video writer worker. */

export interface VideoInitMessage {
  type: 'init';
  /** Name the finished file will be downloaded under, e.g. '20260730_120000.mp4'. */
  fileName: string;
  /** Date.now() at the start of the run, encoded into the OPFS entry name. */
  startedAt: number;
}

export interface VideoChunkMessage {
  type: 'chunk';
  /** Transferred, not copied — the main thread must not touch it afterwards. */
  data: ArrayBuffer;
}

export interface VideoCloseMessage {
  type: 'close';
  /**
   * Whether to delete the OPFS entry after closing. False for a normal stop
   * (the main thread still has to read it out and hand it to the user); true
   * when the recording is being abandoned.
   */
  discard: boolean;
}

export type VideoWorkerRequest = VideoInitMessage | VideoChunkMessage | VideoCloseMessage;

export type VideoWorkerResponse =
  | { type: 'ready' }
  /** Closed cleanly; `opfsName` is where the finished file can be read from. */
  | { type: 'closed'; opfsName: string; bytes: number }
  | { type: 'error'; message: string };
