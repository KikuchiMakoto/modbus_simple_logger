/**
 * Camera recording: MediaRecorder on one side, a worker owning the output file
 * on the other.
 *
 * Started from its own button in Recording Config rather than riding along with
 * Start Save. That is what makes the destination a choice at all: a recording
 * begun by its own click carries the user activation a folder picker needs,
 * where one begun inside Start Save would be running after the TSV picker had
 * already spent it — which is why the first version of this could only offer a
 * download to the browser's own folder.
 *
 * The split of responsibilities matches createTsvWriter: the caller keeps the
 * picker and the permission prompt, and this owns everything after the file
 * handle exists.
 */

import {
  VIDEO_BITS_PER_PIXEL_FRAME,
  VIDEO_CHUNK_INTERVAL_MS,
  VIDEO_MAX_BITRATE,
  VIDEO_MIN_BITRATE,
} from '../constants';
import { bitrateFor, probeVideoAccel, selectAudioMime } from './videoAccel';
import { checkUsbBudget } from './usbBandwidth';
import { timestampBaseName } from './outputDirectory';
import type { RecordingConfig } from './recordingConfig';
import type { VideoWorkerRequest, VideoWorkerResponse } from './videoWorkerProtocol';

/** Thrown when no hardware encoder could be confirmed. Recording must not run. */
export class HardwareEncodeUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'HardwareEncodeUnavailableError';
  }
}

/** Thrown when the requested capture would not leave room for the Modbus link. */
export class UsbBudgetExceededError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'UsbBudgetExceededError';
  }
}

export interface VideoRecorderHandle {
  /** File name being written, e.g. '20260731_140312.mp4'. */
  getFileName(): string;
  isRecording(): boolean;
  /** Stop and close the file. Resolves with the bytes written. */
  stop(): Promise<number>;
}

export interface CreateVideoRecorderOptions {
  /** From useCameraFeed — this function never opens a device itself. */
  stream: MediaStream;
  config: RecordingConfig;
  /** The folder the user chose, with write permission already granted. */
  directory: FileSystemDirectoryHandle;
  onError: (message: string, severity: 'error' | 'warning') => void;
}

export async function createVideoRecorder({
  stream,
  config,
  directory,
  onError,
}: CreateVideoRecorderOptions): Promise<VideoRecorderHandle> {
  const hasVideo = stream.getVideoTracks().length > 0;
  const hasAudio = stream.getAudioTracks().length > 0;
  if (!hasVideo && !hasAudio) throw new Error('Nothing to record: no camera or microphone.');

  let mimeType: string;
  let ext: string;
  let bitrate = 0;

  if (hasVideo) {
    // Re-checked here rather than trusted from the panel: the stored config
    // travels between machines, and a setting that was fine on the desktop it
    // was saved on must not quietly start a software encode on a laptop.
    const budget = checkUsbBudget(config);
    if (!budget.ok) throw new UsbBudgetExceededError(budget.reason);

    const settings = stream.getVideoTracks()[0]?.getSettings();
    const width = settings?.width ?? config.width;
    const height = settings?.height ?? config.height;
    const fps = settings?.frameRate ?? config.fps;

    bitrate = bitrateFor(
      width,
      height,
      fps,
      VIDEO_BITS_PER_PIXEL_FRAME,
      VIDEO_MIN_BITRATE,
      VIDEO_MAX_BITRATE,
    );

    const accel = await probeVideoAccel(width, height, fps, bitrate);
    if (!accel.ok || !accel.candidate) {
      throw new HardwareEncodeUnavailableError(`${accel.reason} ${accel.detail}`);
    }
    mimeType = accel.candidate.mimeType;
    ext = accel.candidate.ext;
  } else {
    // Audio alone is not gated: an AAC or Opus encoder costs nothing this app
    // needs to protect, so the rule that exists to keep the acquisition loop
    // fed has nothing to say here.
    const audio = selectAudioMime();
    if (!audio) throw new Error('No supported audio container for recording.');
    mimeType = audio.mimeType;
    ext = audio.ext;
  }

  const fileName = `${timestampBaseName()}${ext}`;
  const fileHandle = await directory.getFileHandle(fileName, { create: true });

  const worker = new Worker(new URL('../videoWriterWorker.ts', import.meta.url), {
    type: 'module',
  });

  const post = (message: VideoWorkerRequest, transfer?: Transferable[]) => {
    if (transfer) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  };

  // Open the file before starting the encoder, so a permission or disk failure
  // is reported before any frames have been captured and thrown away.
  await new Promise<void>((resolve, reject) => {
    const onMessage = (event: MessageEvent<VideoWorkerResponse>) => {
      if (event.data.type === 'ready') {
        worker.removeEventListener('message', onMessage);
        resolve();
      } else if (event.data.type === 'error') {
        worker.removeEventListener('message', onMessage);
        worker.terminate();
        reject(new Error(event.data.message));
      }
    };
    const onErr = (event: ErrorEvent) => {
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      reject(new Error(event.message || 'Video writer worker failed to start'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onErr, { once: true });
    post({ type: 'init', fileHandle });
  });

  worker.addEventListener('message', (event: MessageEvent<VideoWorkerResponse>) => {
    if (event.data.type === 'error') onError(event.data.message, 'error');
  });

  const recorder = new MediaRecorder(stream, {
    mimeType,
    ...(bitrate > 0 ? { videoBitsPerSecond: bitrate } : {}),
  });

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    // Transferred, so a multi-megabyte chunk is never copied across the worker
    // boundary while the acquisition loop is trying to run.
    event.data.arrayBuffer().then(
      (buffer) => post({ type: 'chunk', data: buffer }, [buffer]),
      (err) => onError(`Recording chunk lost: ${String(err)}`, 'error'),
    );
  };

  recorder.onerror = (event) => {
    const err = (event as unknown as { error?: DOMException }).error;
    onError(`Recording stopped: ${err?.message ?? 'encoder error'}`, 'error');
  };

  recorder.start(VIDEO_CHUNK_INTERVAL_MS);

  /** Wait for the encoder to flush its tail into a final ondataavailable. */
  const stopRecorder = (): Promise<void> =>
    new Promise((resolve) => {
      if (recorder.state === 'inactive') {
        resolve();
        return;
      }
      recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });

  return {
    getFileName: () => fileName,
    isRecording: () => recorder.state === 'recording',

    async stop(): Promise<number> {
      await stopRecorder();
      // The last chunk arrives with the 'stop' event but is posted
      // asynchronously; the worker processes messages in order, so the close
      // queued now lands after it.
      return new Promise((resolve) => {
        const onMessage = (event: MessageEvent<VideoWorkerResponse>) => {
          if (event.data.type !== 'closed') return;
          worker.removeEventListener('message', onMessage);
          const { bytes } = event.data;
          worker.terminate();
          resolve(bytes);
        };
        worker.addEventListener('message', onMessage);
        post({ type: 'close' });
      });
    },
  };
}
