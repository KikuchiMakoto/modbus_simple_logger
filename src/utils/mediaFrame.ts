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
 * Why fragments over a socket rather than HLS or DASH: those need a segmenter
 * and a manifest the viewer polls, and buy 2-6 seconds of latency for it. What
 * MediaRecorder emits is already a fragmented MP4 (or WebM) stream, and
 * MediaSource will append it as it arrives. The result is under a second, with
 * no format machinery in between.
 *
 * Why not WebRTC, which would be lower still: a LAN viewer is served over plain
 * http on a private address, which is not a secure context, so RTCPeerConnection
 * is unavailable there — and signalling needs a viewer-to-host path, which
 * viewerServer.ts deliberately does not have. MediaSource needs neither.
 */

/** Bytes of header in front of every media frame. */
export const MEDIA_HEADER_BYTES = 8;

export const MEDIA_KIND_VIDEO = 1;

/**
 * First fragment of a stream: the initialisation segment (ftyp+moov, or the
 * WebM header). A viewer cannot decode anything without it, so the hub holds on
 * to the last one and replays it to whoever joins next.
 */
export const MEDIA_FLAG_INIT = 1;

export interface MediaFrame {
  kind: number;
  flags: number;
  /** Monotonic per stream; a gap means fragments were dropped for a slow viewer. */
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

export const isInitFrame = (frame: MediaFrame): boolean =>
  (frame.flags & MEDIA_FLAG_INIT) !== 0;
