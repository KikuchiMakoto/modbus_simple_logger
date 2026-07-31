/**
 * The hardware-encode gate, and the container/codec choice that comes out of it.
 *
 * Software H.264/VP9 encoding takes a core to itself even at 720p. On this app
 * that core is not spare — it is the one running the acquisition loop, and a
 * recording that costs a poll interval has traded the measurement for the video
 * of the measurement. So when no hardware encoder can be confirmed, recording
 * does not run at all. There is no override.
 *
 * Two signals, both must pass:
 *
 *   1. VideoEncoder.isConfigSupported() with hardwareAcceleration
 *      'prefer-hardware'. In Chromium this is a genuine discriminator: it
 *      answers false for a configuration no hardware encoder will take, and it
 *      is asked per codec, size and rate because that is what encoders
 *      dispatch on. It needs a secure context, which the launcher (127.0.0.1)
 *      and the PWA both are.
 *   2. probeRenderBackend() — if WebGL has fallen back to SwiftShader/llvmpipe
 *      then the GPU process is running in software and no video encoder behind
 *      it is going to be hardware either.
 *
 * Two APIs that look like they belong here and do not, both established by
 * measurement rather than by reading the spec:
 *
 *   - MediaCapabilities.encodingInfo({type: 'record'}) throws in Chromium.
 *     'record' is in the specification and was never shipped; the only accepted
 *     value is 'webrtc'.
 *   - encodingInfo({type: 'webrtc'}).powerEfficient answers false for H.264,
 *     VP8, VP9 and AV1 alike on a machine with a hardware encoder, so it
 *     carries no information about hardware at all.
 *
 * A caveat worth stating plainly, because it decides what this gate costs:
 * MediaRecorder does not go through VideoEncoder, and the two disagree.
 * A machine where isConfigSupported reports no hardware H.264 can still record
 * H.264 MP4 through MediaRecorder perfectly well. So this gate will refuse on
 * some machines that would have worked. That is the deliberate trade — the
 * measurement is worth more than the video of it — and the panel prints exactly
 * what was measured so the refusal can be checked against chrome://gpu rather
 * than taken on faith.
 */

import { probeRenderBackend } from './renderBackend';

export interface MimeCandidate {
  mimeType: string;
  /** File extension, including the dot. */
  ext: string;
  /** What to show the user, e.g. "MP4 (H.264 / AAC)". */
  label: string;
  /**
   * The same codec as a WebCodecs identifier, which is what the hardware probe
   * takes. Kept beside the MIME type so the thing being tested and the thing
   * being recorded cannot drift apart.
   */
  codec: string;
}

/**
 * H.264 first: it is the codec with hardware encoders on essentially every GPU,
 * and MP4 is the container a colleague can open without explaining anything.
 * The WebM entries are the fallback for Chromium builds without MP4 recording.
 */
export const VIDEO_MIME_CANDIDATES: MimeCandidate[] = [
  {
    mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    ext: '.mp4',
    label: 'MP4 (H.264 / AAC)',
    codec: 'avc1.42E01E',
  },
  {
    mimeType: 'video/mp4;codecs="avc1.42E01E"',
    ext: '.mp4',
    label: 'MP4 (H.264)',
    codec: 'avc1.42E01E',
  },
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    ext: '.webm',
    label: 'WebM (VP9 / Opus)',
    codec: 'vp09.00.10.08',
  },
  {
    mimeType: 'video/webm;codecs=vp8,opus',
    ext: '.webm',
    label: 'WebM (VP8 / Opus)',
    codec: 'vp8',
  },
];

/**
 * Audio-only capture is not gated: an AAC/Opus encoder costs nothing worth
 * measuring, and refusing to record a microphone because the GPU has no video
 * encoder would be a rule applied where its reason does not reach.
 */
export const AUDIO_MIME_CANDIDATES: MimeCandidate[] = [
  { mimeType: 'audio/mp4;codecs="mp4a.40.2"', ext: '.m4a', label: 'M4A (AAC)', codec: 'mp4a.40.2' },
  { mimeType: 'audio/webm;codecs=opus', ext: '.webm', label: 'WebM (Opus)', codec: 'opus' },
];

const recorderSupports = (mimeType: string): boolean => {
  if (typeof MediaRecorder === 'undefined') return false;
  try {
    return MediaRecorder.isTypeSupported(mimeType);
  } catch {
    return false;
  }
};

/** WebCodecs' VideoEncoder, absent outside a secure context and in older builds. */
type VideoEncoderCtor = {
  isConfigSupported(config: {
    codec: string;
    width: number;
    height: number;
    framerate?: number;
    bitrate?: number;
    hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  }): Promise<{ supported?: boolean }>;
};

const videoEncoder = (): VideoEncoderCtor | null => {
  const ctor = (globalThis as unknown as { VideoEncoder?: VideoEncoderCtor }).VideoEncoder;
  return ctor?.isConfigSupported ? ctor : null;
};

/**
 * Will a hardware encoder take this exact configuration?
 *
 * `null` means the question could not be asked at all (no WebCodecs, or no
 * secure context). The caller treats that as a failure: this gate exists to
 * confirm hardware encoding, and "could not ask" is not confirmation.
 */
async function hasHardwareEncoder(
  codec: string,
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<boolean | null> {
  const encoder = videoEncoder();
  if (!encoder) return null;
  try {
    const result = await encoder.isConfigSupported({
      codec,
      width,
      height,
      framerate: fps,
      bitrate,
      // 'prefer-hardware' rather than 'no-preference': the latter answers
      // "can this be encoded at all", which is true almost everywhere because
      // of the software fallback this gate exists to keep away from the
      // acquisition loop.
      hardwareAcceleration: 'prefer-hardware',
    });
    return result.supported === true;
  } catch {
    // A codec string this build does not parse. Not an answer either way.
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
 * Pick the first container MediaRecorder can write *and* a hardware encoder
 * will take at this exact size and rate.
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

  if (!videoEncoder()) {
    return {
      ok: false,
      candidate: null,
      reason: 'Hardware video encoding could not be confirmed — recording disabled.',
      detail: `WebCodecs (VideoEncoder) is unavailable here${
        typeof window !== 'undefined' && !window.isSecureContext
          ? ', because this page is not a secure context'
          : ''
      }. Without it there is no way to ask whether a hardware encoder exists, and an unconfirmed encoder is treated as absent.`,
      renderer: backend.detail,
      softwareRenderer: false,
    };
  }

  const notes: string[] = [];
  for (const candidate of VIDEO_MIME_CANDIDATES) {
    if (!recorderSupports(candidate.mimeType)) {
      notes.push(`${candidate.label}: MediaRecorder cannot write it`);
      continue;
    }
    const hardware = await hasHardwareEncoder(candidate.codec, width, height, fps, bitrate);
    if (hardware === true) {
      return {
        ok: true,
        candidate,
        reason: `Hardware encoding available — ${candidate.label}.`,
        detail: `VideoEncoder: prefer-hardware accepted ${candidate.codec} at ${width}×${height}@${fps} · Renderer: ${backend.detail}`,
        renderer: backend.detail,
        softwareRenderer: false,
      };
    }
    notes.push(
      `${candidate.label}: no hardware encoder for ${candidate.codec}${hardware === null ? ' (not testable)' : ''}`,
    );
  }

  return {
    ok: false,
    candidate: null,
    reason: 'Hardware video encoding unavailable — recording disabled.',
    // The measurements, verbatim, so the refusal can be checked against
    // chrome://gpu ("Video Encode") rather than taken on faith. Note that
    // MediaRecorder does not go through VideoEncoder and the two can disagree,
    // so this may refuse a machine that would in fact have recorded.
    detail: `${notes.join(' · ')} · Renderer: ${backend.detail} · at ${width}×${height}@${fps}, ${Math.round(bitrate / 1000)} kbps`,
    renderer: backend.detail,
    softwareRenderer: false,
  };
}

/** First audio container the recorder can produce. Ungated, see above. */
export function selectAudioMime(): MimeCandidate | null {
  return AUDIO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType)) ?? null;
}

/**
 * Container for the remote stream.
 *
 * Three conditions, not one. MediaSource as well as MediaRecorder, because
 * picking on the recorder alone yields a stream the host can produce and no
 * viewer can play — a failure that only shows up on somebody else's screen. And
 * the same hardware requirement as the file recorder, because this is a second
 * encoder running next to the first one, on the same machine, beside the same
 * acquisition loop; if software encoding is too expensive to record with, it is
 * not suddenly affordable because the reason is a spectator.
 */
export async function selectStreamMime(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<MimeCandidate | null> {
  const sourceSupports = (mimeType: string): boolean => {
    if (typeof MediaSource === 'undefined') return false;
    try {
      return MediaSource.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  };

  for (const candidate of VIDEO_MIME_CANDIDATES) {
    if (!recorderSupports(candidate.mimeType) || !sourceSupports(candidate.mimeType)) continue;
    if ((await hasHardwareEncoder(candidate.codec, width, height, fps, bitrate)) === true) {
      return candidate;
    }
  }
  return null;
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
