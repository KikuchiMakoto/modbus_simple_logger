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
import { timestampBaseName } from './outputDirectory';
import type { RecordingConfig } from './recordingConfig';
import type { VideoWorkerRequest, VideoWorkerResponse } from './videoWorkerProtocol';

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
    const settings = stream.getVideoTracks()[0]?.getSettings();
    const width = settings?.width ?? config.width;
    const height = settings?.height ?? config.height;
    // The recording rate, not what getSettings reports: the stream reaching the
    // encoder has already been decimated to it by useCameraFeed's frame pump.
    const fps = config.recordFps;

    bitrate = bitrateFor(
      width,
      height,
      fps,
      VIDEO_BITS_PER_PIXEL_FRAME,
      VIDEO_MIN_BITRATE,
      VIDEO_MAX_BITRATE,
    );

    const accel = await probeVideoAccel(width, height, fps, bitrate);
    if (!accel.candidate) throw new Error('This browser cannot record video.');
    // Software encoding is allowed. It is reported rather than refused: the
    // only signal available describes WebCodecs, MediaRecorder does not go
    // through WebCodecs, and refusing on it was measured turning away machines
    // that record H.264 at full rate.
    if (!accel.hardware) onError(accel.summary, 'warning');
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

  /**
   * Chunks whose bytes are still being read out of their Blob.
   *
   * This has to be tracked, because Blob.arrayBuffer() is asynchronous and
   * MediaRecorder's last ondataavailable fires *before* its 'stop' event.
   * Without waiting for these, stop() posts 'close' while the final chunk is
   * still being read, the worker closes the stream, and that chunk is dropped —
   * which for a recording shorter than one timeslice is the entire file, and
   * shows up as a 0-byte MP4.
   */
  const pendingChunks = new Set<Promise<void>>();

  recorder.ondataavailable = (event) => {
    if (event.data.size === 0) return;
    // Transferred, so a multi-megabyte chunk is never copied across the worker
    // boundary while the acquisition loop is trying to run.
    const pending = event.data.arrayBuffer().then(
      (buffer) => {
        post({ type: 'chunk', data: buffer }, [buffer]);
      },
      (err) => onError(`Recording chunk lost: ${String(err)}`, 'error'),
    );
    pendingChunks.add(pending);
    void pending.finally(() => pendingChunks.delete(pending));
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
      // Only once every chunk's bytes have actually been posted. The worker
      // processes messages in order, so a 'close' queued after them lands last
      // — but a 'close' queued while a Blob is still being read would overtake
      // it entirely.
      await Promise.allSettled([...pendingChunks]);
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
