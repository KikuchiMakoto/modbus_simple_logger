/**
 * Container/codec choice, and what can be learned about hardware encoding.
 *
 * This began as a gate: no confirmed hardware encoder, no recording, on the
 * grounds that software H.264 takes a core the acquisition loop needs. It is
 * now advisory, because measurement showed the gate was refusing machines that
 * record perfectly well.
 *
 * What the browser actually offers, all established by testing rather than by
 * reading the specification:
 *
 *   - MediaCapabilities.encodingInfo({type: 'record'}) throws in Chromium.
 *     'record' is in the specification and was never shipped; the only accepted
 *     value is 'webrtc'.
 *   - encodingInfo({type: 'webrtc'}).powerEfficient answers false for H.264,
 *     VP8, VP9 and AV1 alike on a machine with a hardware encoder, so it says
 *     nothing about hardware at all.
 *   - VideoEncoder.isConfigSupported with 'prefer-hardware' does discriminate —
 *     but it describes WebCodecs, and MediaRecorder does not go through
 *     WebCodecs. On the machine this was developed against it reports no
 *     hardware encoder for any codec, while MediaRecorder writes real H.264 MP4
 *     at full rate.
 *   - Chromium flags do not move it: --ignore-gpu-blocklist,
 *     --disable-gpu-driver-bug-workarounds and --use-angle=vulkan were each
 *     tried, and the Vulkan backend does take effect (the renderer string
 *     changes) without changing the answer. Video encode goes through Media
 *     Foundation on Windows, which is a separate path from ANGLE's.
 *
 * So there is no signal that truthfully reports what MediaRecorder will do.
 * The probe is kept because "probably software" is worth saying next to a
 * feature that competes with the measurement — but it warns, it does not refuse.
 */

import { probeRenderBackend } from './renderBackend';

export interface MimeCandidate {
  mimeType: string;
  /** File extension, including the dot. */
  ext: string;
  /** What to show the user, e.g. "MP4 (H.264 / AAC)". */
  label: string;
  /** The same codec as a WebCodecs identifier, which is what the probe takes. */
  codec: string;
}

/**
 * Ordered by what this costs to produce, not by what compresses best.
 *
 * H.264 first: it has hardware encoders on essentially every GPU, its software
 * encoder is fast, and MP4 is the container a colleague can open without being
 * told anything.
 *
 * Then VP8, then VP9 — the reverse of the usual preference, and deliberately.
 * VP9 compresses better but its software encoder costs several times VP8's, and
 * the thing being protected here is a polling loop, not disk space. Since
 * software encoding is now permitted rather than refused, the fallback order is
 * where that cost actually gets decided.
 *
 * A note on containers, because it comes up: WebM *is* Matroska, so "record to
 * MKV instead" is already what these two entries do. It does not avoid
 * encoding. Nothing can — getUserMedia hands over decoded frames, never the
 * camera's original MJPEG or H.264 payload, so there is no bitstream sitting
 * there to be remuxed rather than re-encoded.
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
    mimeType: 'video/webm;codecs=vp8,opus',
    ext: '.webm',
    label: 'WebM (VP8 / Opus)',
    codec: 'vp8',
  },
  {
    mimeType: 'video/webm;codecs=vp9,opus',
    ext: '.webm',
    label: 'WebM (VP9 / Opus)',
    codec: 'vp09.00.10.08',
  },
];

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
 * Will a hardware encoder take this configuration? `null` means the question
 * could not be asked (no WebCodecs, or no secure context).
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
      // 'prefer-hardware' rather than 'no-preference': the latter answers "can
      // this be encoded at all", which is true almost everywhere because of the
      // software fallback this is trying to detect.
      hardwareAcceleration: 'prefer-hardware',
    });
    return result.supported === true;
  } catch {
    return null;
  }
}

export interface VideoAccelVerdict {
  /** The container that will be recorded, or null if none is supported at all. */
  candidate: MimeCandidate | null;
  /**
   * True only when a hardware encoder was positively confirmed. False covers
   * both "software" and "could not tell", which are not worth distinguishing
   * to the user given how unreliable the signal is.
   */
  hardware: boolean;
  /** One short line, or '' when there is nothing worth saying. */
  summary: string;
  /** The measurements in full, for the hover. */
  detail: string;
  renderer: string;
}

/**
 * Pick the container to record in, and report whether hardware encoding could
 * be confirmed for it.
 *
 * The container is chosen on MediaRecorder support alone — that is the thing
 * that decides whether recording works. The hardware answer rides along.
 */
export async function probeVideoAccel(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<VideoAccelVerdict> {
  const backend = probeRenderBackend();
  const candidate = VIDEO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType)) ?? null;

  if (!candidate) {
    return {
      candidate: null,
      hardware: false,
      summary: 'This browser cannot record video.',
      detail: `MediaRecorder supports none of: ${VIDEO_MIME_CANDIDATES.map((c) => c.label).join(', ')}.`,
      renderer: backend.detail,
    };
  }

  const hardware = (await hasHardwareEncoder(candidate.codec, width, height, fps, bitrate)) === true;

  return {
    candidate,
    hardware,
    // Nothing is said when hardware is confirmed: a line that only ever reads
    // "everything is fine" is a line that gets skipped when it stops saying so.
    summary: hardware
      ? ''
      : 'Encoding in software — this competes with the polling loop. Keep the size and rate modest.',
    detail: hardware
      ? `VideoEncoder: prefer-hardware accepted ${candidate.codec} at ${width}×${height}@${fps} · Renderer: ${backend.detail}`
      : `VideoEncoder: no hardware encoder reported for ${candidate.codec} at ${width}×${height}@${fps}. ` +
        `Note this describes WebCodecs, and MediaRecorder does not go through it — recording may well be hardware-accelerated anyway. ` +
        `Renderer: ${backend.detail}`,
    renderer: backend.detail,
  };
}

/** First audio container the recorder can produce. */
export function selectAudioMime(): MimeCandidate | null {
  return AUDIO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType)) ?? null;
}

/**
 * Container for the remote stream.
 *
 * MediaSource as well as MediaRecorder, because picking on the recorder alone
 * yields a stream the host can produce and no viewer can play — a failure that
 * only shows up on somebody else's screen.
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
