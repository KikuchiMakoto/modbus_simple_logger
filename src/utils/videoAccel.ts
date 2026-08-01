/**
 * Which container and codec a recording is written in, and the bitrate it gets.
 *
 * There used to be a hardware-encoder probe here, feeding a banner and a frame
 * rate cap. Both are gone. Whether Media Foundation or libopenh264 does the
 * work is not a question the person recording a rig can act on, and the app
 * could not answer it honestly anyway: the only signal Chromium offers is
 * VideoEncoder.isConfigSupported({hardwareAcceleration: 'prefer-hardware'}),
 * which describes WebCodecs — a path MediaRecorder does not take. On the
 * machine this was developed against it reported no hardware encoder for any
 * codec while MediaRecorder wrote H.264 MP4 at full rate. (MediaCapabilities
 * is no better: encodingInfo({type:'record'}) throws, and the 'webrtc' form
 * answers powerEfficient:false for every codec on a machine that has an
 * encoder.) A warning that is wrong on the machine it was written on is worse
 * than no warning.
 *
 * What keeps the encode cheap now is the defaults, which is where it belonged:
 * a low recording rate and a size the user picked. See VIDEO_DEFAULT_RECORD_FPS.
 */

export interface MimeCandidate {
  mimeType: string;
  /** File extension, including the dot. */
  ext: string;
  /** What to show the user, e.g. "MP4 (H.264 / AAC)". */
  label: string;
  /** The same codec as a WebCodecs identifier. */
  codec: string;
}

/**
 * Ordered by what this costs to produce, not by what compresses best.
 *
 * H.264 first: it has hardware encoders on essentially every GPU, its software
 * encoder is fast, and MP4 is the container a colleague can open without being
 * told anything. (AVC and H.264 are the same codec — `avc1` is simply how the
 * MP4 container names it, so there is no faster variant to switch to.)
 *
 * High profile before Baseline, because the picture this records is a rig at a
 * low frame rate: CABAC and 8×8 transforms are worth several dB at the same
 * bitrate on that kind of near-static scene, and every hardware encoder that
 * does H.264 at all does High. Baseline stays behind it as the fallback for
 * anything that refuses the string.
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
  // High profile, level 5.1 — the level is what the largest size in VIDEO_SIZES
  // needs; a lower one would be a string the encoder is entitled to reject at 4K.
  {
    mimeType: 'video/mp4;codecs="avc1.640033,mp4a.40.2"',
    ext: '.mp4',
    label: 'MP4 (H.264 High / AAC)',
    codec: 'avc1.640033',
  },
  {
    mimeType: 'video/mp4;codecs="avc1.640033"',
    ext: '.mp4',
    label: 'MP4 (H.264 High)',
    codec: 'avc1.640033',
  },
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

/**
 * The best container the recorder can actually produce, or null when it can
 * produce none — which is the only thing about the encoder the user needs told,
 * because it is the only one they can do anything about.
 */
export function selectVideoMime(): MimeCandidate | null {
  return VIDEO_MIME_CANDIDATES.find((c) => recorderSupports(c.mimeType)) ?? null;
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

/**
 * Bitrate for a quality setting at a given size and rate.
 *
 * This exists because MediaRecorder takes a bitrate and nothing else. There is
 * no CRF, no QP, no `quality` — `videoBitsPerSecond` is the entire knob, so a
 * quality setting has to be turned into a number of bits per second here. (The
 * one browser API that does offer constant-quantizer encoding is WebCodecs'
 * VideoEncoder with `bitrateMode: 'quantizer'`, and using it means muxing the
 * MP4 by hand — see the note in RecordingConfigPanel.)
 *
 * The model is `pixels × bitsPerPixel × fps^exponent`, and the exponent is the
 * part that matters. A bitrate linear in fps hands every frame the same budget
 * regardless of rate, which is backwards: at 30 fps consecutive frames are
 * nearly identical and cost little to code, while at 1 fps each frame is
 * effectively a still and needs close to a full intra frame's worth of bits.
 * A sub-linear exponent moves the budget the way the content does, so dropping
 * the rate to record longer buys sharper frames instead of the same frames.
 */
export function bitrateFor({
  width,
  height,
  fps,
  bitsPerPixel,
  fpsExponent,
  min,
  max,
}: {
  width: number;
  height: number;
  fps: number;
  /** Bits per pixel for a frame at 1 fps — i.e. an intra frame's budget. */
  bitsPerPixel: number;
  fpsExponent: number;
  min: number;
  max: number;
}): number {
  const raw = Math.round(width * height * bitsPerPixel * Math.pow(fps, fpsExponent));
  return Math.min(max, Math.max(min, raw));
}
