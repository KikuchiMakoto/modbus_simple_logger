/**
 * File recording: MediaRecorder on one side, an OPFS-owning worker on the other.
 *
 * The shape mirrors createTsvWriter (./tsvExport.ts) deliberately — build it,
 * get a handle back or an exception, and close the handle when the run ends —
 * because App drives both from the same two buttons and they should fail the
 * same way.
 *
 * What is different is what happens on failure. A TSV writer that will not open
 * means Start Save failed. A recorder that will not open means the video is
 * missing from a save that is otherwise working perfectly, and the caller is
 * expected to carry on: the button the user pressed was about the measurement.
 */

import {
  VIDEO_BITS_PER_PIXEL_FRAME,
  VIDEO_CHUNK_INTERVAL_MS,
  VIDEO_MAX_BITRATE,
  VIDEO_MIN_BITRATE,
} from '../constants';
import { bitrateFor, probeVideoAccel, selectAudioMime } from './videoAccel';
import { checkUsbBudget } from './usbBandwidth';
import { VIDEO_DIR } from './opfsRecoveryShared';
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
  /** File name the finished recording is offered under, e.g. '20260730_120000.mp4'. */
  getFileName(): string;
  /** True while MediaRecorder is running. */
  isRecording(): boolean;
  /**
   * Stop and finish. Resolves with the finished file, or null when nothing was
   * captured. The caller owns handing it to the user.
   */
  stop(): Promise<File | null>;
  /**
   * Delete the OPFS copy. Call only once the file has actually been handed
   * over: until then it is the sole copy, and it is also what the startup sweep
   * would offer back if the app died between stop() and the download.
   */
  remove(): Promise<void>;
  /** Stop and throw the recording away (device lost, or a failed start). */
  abort(): Promise<void>;
}

const stripExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
};

/** The base name a recording takes from the TSV file it accompanies. */
export const recordingBaseName = (tsvFileName: string): string => stripExtension(tsvFileName);

export interface CreateVideoRecorderOptions {
  /** From useCameraFeed — this function never opens a device itself. */
  stream: MediaStream;
  config: RecordingConfig;
  /** Base name without extension; the container decides the extension. */
  baseName: string;
  onError: (message: string, severity: 'error' | 'warning') => void;
}

export async function createVideoRecorder({
  stream,
  config,
  baseName,
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
    // needs to protect, so the rule that exists to keep the acquisition loop fed
    // has nothing to say here.
    const audio = selectAudioMime();
    if (!audio) throw new Error('No supported audio container for recording.');
    mimeType = audio.mimeType;
    ext = audio.ext;
  }

  const fileName = `${baseName}${ext}`;
  const startedAt = Date.now();

  const worker = new Worker(new URL('../videoWriterWorker.ts', import.meta.url), {
    type: 'module',
  });

  const post = (message: VideoWorkerRequest, transfer?: Transferable[]) => {
    if (transfer) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  };

  // Open the OPFS file before starting the encoder, so a storage failure is
  // reported before any frames have been captured and thrown away.
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
    post({ type: 'init', fileName, startedAt });
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
    // Transferred, so a 4 MB chunk is never copied across the worker boundary
    // while the acquisition loop is trying to run.
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

  const closeWorker = (discard: boolean): Promise<{ opfsName: string; bytes: number }> =>
    new Promise((resolve) => {
      const onMessage = (event: MessageEvent<VideoWorkerResponse>) => {
        if (event.data.type !== 'closed') return;
        worker.removeEventListener('message', onMessage);
        const { opfsName, bytes } = event.data;
        worker.terminate();
        resolve({ opfsName, bytes });
      };
      worker.addEventListener('message', onMessage);
      post({ type: 'close', discard });
    });

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

  // Set by stop(); remove() needs it and only stop() learns it.
  let finishedOpfsName = '';

  return {
    getFileName: () => fileName,
    isRecording: () => recorder.state === 'recording',

    async stop(): Promise<File | null> {
      await stopRecorder();
      // The last chunk arrives with the 'stop' event but is written
      // asynchronously; the worker processes messages in order, so the close
      // message queued now lands after it.
      const { opfsName, bytes } = await closeWorker(false);
      if (!opfsName || bytes === 0) return null;
      finishedOpfsName = opfsName;

      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(VIDEO_DIR, { create: false });
      const file = await (await dir.getFileHandle(opfsName)).getFile();
      // Re-wrapped so the download carries the name the user should see rather
      // than the OPFS entry's encoded one. The File stays backed by the on-disk
      // entry, so an hour of video is never read into memory.
      return new File([file], fileName, { type: mimeType });
    },

    async remove(): Promise<void> {
      if (!finishedOpfsName) return;
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(VIDEO_DIR, { create: false });
        await dir.removeEntry(finishedOpfsName);
      } catch {
        // A leftover costs one startup prompt, which is the safe direction to
        // fail: the alternative is deleting a recording that never arrived.
      }
      finishedOpfsName = '';
    },

    async abort(): Promise<void> {
      await stopRecorder();
      await closeWorker(true);
    },
  };
}
