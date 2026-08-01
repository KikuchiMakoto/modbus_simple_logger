/**
 * Wire format for streamed media fragments.
 *
 * The remote-monitoring transport is two WebSockets carrying JSON objects. Media
 * rides the same sockets as binary frames, which keeps the whole feature free of
 * a new port, a new manifest, a new auth path and a new set of firewall
 * questions — and leaves the existing `{type: ...}` protocol untouched, because
 * text and binary are told apart by `typeof event.data` before anything is
 * parsed.
 *
 * Why stills rather than a video stream: see MEDIA_KIND_JPEG below. Neither
 * HLS/DASH nor WebRTC was ever a candidate — the first needs a segmenter and a
 * manifest and costs seconds of latency, and the second cannot exist on a LAN
 * viewer, which is served over plain http on a private address and so is not a
 * secure context. What remained was a stream into MediaSource, and that turned
 * out to be more machinery than the job needed.
 */

/** Bytes of header in front of every media frame. */
export const MEDIA_HEADER_BYTES = 8;

/**
 * One JPEG still. The remote picture is a slideshow, not a video stream.
 *
 * This started as fMP4 into a MediaSource and every hard problem the feature
 * had came from that: the codec string Chromium reports is not the one it was
 * asked for, a viewer joining mid-stream needs an init segment replayed, and
 * playback drifts further behind the live edge the longer it runs. None of that
 * exists for a still image — the newest one is simply the one on screen, and a
 * frame that never arrives costs nothing because the next one replaces it
 * whole.
 *
 * It is also the only kind. Remote monitoring sends no audio: sound is a real
 * stream or it is nothing, and a real stream brings back the accumulating
 * buffer this design exists to avoid.
 */
export const MEDIA_KIND_JPEG = 2;

export interface MediaFrame {
  kind: number;
  flags: number;
  /** Monotonic; a gap means stills were dropped for a slow viewer. */
  seq: number;
  payload: Uint8Array;
}

/**
 * `[u8 kind][u8 flags][u16 reserved][u32 seq]`, big-endian, then the fragment.
 *
 * A fixed header rather than a JSON envelope with base64: base64 costs a third
 * more bytes and a copy at both ends, on the one frame type here that is large
 * and frequent.
 */
export function encodeMediaFrame(
  kind: number,
  flags: number,
  seq: number,
  payload: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const out = new Uint8Array(MEDIA_HEADER_BYTES + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint8(0, kind);
  view.setUint8(1, flags);
  view.setUint16(2, 0);
  view.setUint32(4, seq >>> 0);
  out.set(body, MEDIA_HEADER_BYTES);
  return out.buffer;
}

/** Returns null for anything too short to be one of ours. */
export function decodeMediaFrame(data: ArrayBuffer | Uint8Array): MediaFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < MEDIA_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    kind: view.getUint8(0),
    flags: view.getUint8(1),
    seq: view.getUint32(4),
    payload: bytes.subarray(MEDIA_HEADER_BYTES),
  };
}

