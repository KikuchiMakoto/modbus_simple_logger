/**
 * The hardware-encode gate, and the container/codec choice that comes out of it.
 *
 * Software H.264/VP9 encoding takes a core to itself even at 720p. On this app
 * that core is not spare — it is the one running the acquisition loop, and a
 * recording that costs a poll interval has traded the measurement for the video
 * of the measurement. So when no hardware encoder can be confirmed, recording
 * does not run at all. There is no override.
 *
 * Two signals, both must pass, mirroring how the chart decides a device is
 * constrained (App.tsx: renderer string plus core count):
 *
 *   1. MediaCapabilities.encodingInfo().powerEfficient — the only direct answer
 *      the platform gives about hardware encoding, and it is asked per size and
 *      rate because that is what the encoder actually dispatches on.
 *   2. probeRenderBackend() — if WebGL has fallen back to SwiftShader/llvmpipe
 *      then the GPU process is running in software and no video encoder behind
 *      it is going to be hardware either.
 */

import { probeRenderBackend } from './renderBackend';

export interface MimeCandidate {
  mimeType: string;
  /** File extension, including the dot. */
  ext: string;
  /** What to show the user, e.g. "MP4 (H.264 / AAC)". */
  label: string;
}

/**
 * H.264 first: it is the codec with hardware encoders on essentially every GPU,
 * and MP4 is the container a colleague can open without explaining anything.
 * The WebM entries are the fallback for Chromium builds without MP4 recording.
 */
export const VIDEO_MIME_CANDIDATES: MimeCandidate[] = [
  { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: '.mp4', label: 'MP4 (H.264 / AAC)' },
  { mimeType: 'video/mp4;codecs="avc1.42E01E"', ext: '.mp4', label: 'MP4 (H.264)' },
  { mimeType: 'video/webm;codecs=vp9,opus', ext: '.webm', label: 'WebM (VP9 / Opus)' },
  { mimeType: 'video/webm;codecs=vp8,opus', ext: '.webm', label: 'WebM (VP8 / Opus)' },
];

/**
 * Audio-only capture is not gated: an AAC/Opus encoder costs nothing worth
 * measuring, and refusing to record a microphone because the GPU has no video
 * encoder would be a rule applied where its reason does not reach.
 */
export const AUDIO_MIME_CANDIDATES: MimeCandidate[] = [
  { mimeType: 'audio/mp4;codecs="mp4a.40.2"', ext: '.m4a', label: 'M4A (AAC)' },
  { mimeType: 'audio/webm;codecs=opus', ext: '.webm', label: 'WebM (Opus)' },
];

const recorderSupports = (mimeType: string): boolean => {
  if (typeof MediaRecorder === 'undefined') return false;
  try {
    return MediaRecorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
};

/** The bare content type, without the codecs parameter MediaCapabilities rejects. */
const contentTypeOf = (mimeType: string): string => mimeType;

async function isPowerEfficient(
  mimeType: string,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<boolean | null> {
  const caps = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : undefined;
  if (!caps?.encodingInfo) return null;
  try {
    const info = await caps.encodingInfo({
      type: 'record',
      video: {
        contentType: contentTypeOf(mimeType),
        width,
        height,
        bitrate,
        framerate: fps,
      },
    });
    return info.supported ? info.powerEfficient : false;
  } catch {
    // A malformed content type or an unimplemented path. Not an answer either
    // way — the caller decides what to do with "don't know".
    return null;
  }
}

export interface VideoAccelVerdict {
  /** False means recording must not start. */
  ok: boolean;
  /** The candidate that passed, or null. */
  candidate: MimeCandidate | null;
  /** Headline for the panel. */
  reason: string;
  /** The measurements behind the verdict, shown verbatim so it can be argued with. */
  detail: string;
  /** Renderer string from the WebGL probe. */
  renderer: string;
  /** True when the GPU is a software rasteriser. */
  softwareRenderer: boolean;
}

/**
 * Pick the first candidate that MediaRecorder supports *and* the platform
 * reports as power-efficient at this exact size and rate.
 *
 * When encodingInfo is unavailable entirely (older Chromium), the answer is
 * `null` rather than false, and that is treated as a failure: the whole point
 * is to confirm hardware encoding, and "could not confirm" is not confirmation.
 */
export async function probeVideoAccel(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoAccelVerdict> {
  const backend = probeRenderBackend();
  const softwareRenderer = backend.accel === 'CPU';

  if (softwareRenderer) {
    return {
      ok: false,
      candidate: null,
      reason: 'Hardware video encoding unavailable — recording disabled.',
      detail: `Renderer: ${backend.detail} (${backend.api}, software). A GPU process running in software has no hardware video encoder behind it.`,
      renderer: backend.detail,
      softwareRenderer: true,
    };
  }

  const notes: string[] = [];
  for (const candidate of VIDEO_MIME_CANDIDATES) {
    if (!recorderSupports(candidate.mimeType)) {
      notes.push(`${candidate.label}: not supported by MediaRecorder`);
      continue;
    }
    const efficient = await isPowerEfficient(candidate.mimeType, width, height, fps, bitrate);
    if (efficient === true) {
      return {
        ok: true,
        candidate,
        reason: `Hardware encoding available — ${candidate.label}.`,
        detail: `MediaCapabilities: powerEfficient = true (${candidate.mimeType}; ${width}×${height}@${fps}) · Renderer: ${backend.detail}`,
        renderer: backend.detail,
        softwareRenderer: false,
      };
    }
    notes.push(
      `${candidate.label}: powerEfficient = ${efficient === null ? 'unknown' : 'false'}`,
    );
  }

  return {
    ok: false,
    candidate: null,
    reason: 'Hardware video encoding unavailable — recording disabled.',
    detail: `${notes.join(' · ')} · Renderer: ${backend.detail} · at ${width}×${height}@${fps}`,
    renderer: backend.detail,
    softwareRenderer: false,
  };
}

/** First audio container the recorder can produce. Ungated, see above. */
export function selectAudioMime(): MimeCandidate | null {
  return AUDIO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType)) ?? null;
}

/**
 * Container for the remote stream. Both sides have to agree, so this checks
 * MediaSource as well as MediaRecorder — picking on the recorder alone yields
 * a stream the host can produce and no viewer can play.
 */
export function selectStreamMime(): MimeCandidate | null {
  const sourceSupports = (mimeType: string): boolean => {
    if (typeof MediaSource === 'undefined') return false;
    try {
      return MediaSource.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };
  return (
    VIDEO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType) && sourceSupports(c.mimeType)) ??
    null
  );
}

/** Encoder bitrate for a given size, shared by the recorder and the publisher. */
export function bitrateFor(
  width: number,
  height: number,
  fps: number,
  bitsPerPixelFrame: number,
  min: number,
  max: number,
): number {
  const raw = Math.round(width * height * fps * bitsPerPixelFrame);
  return Math.min(max, Math.max(min, raw));
}
