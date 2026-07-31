/**
 * Viewer side of remote video: fragments in, a playable <video> out.
 *
 * MediaSource rather than HLS/DASH because the fragments the host's
 * MediaRecorder emits are already appendable — there is no manifest to write, no
 * segmenter to run, and the latency is one chunk interval rather than several
 * segments' worth.
 *
 * It also works where WebRTC does not: a LAN viewer is served over plain http on
 * a private address and so is not a secure context. MediaSource does not care;
 * RTCPeerConnection would refuse to exist there at all.
 *
 * The result is shaped like a CameraFeed, so chart slot 4 renders a local camera
 * and a remote one through the same card.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraFeed } from './useCameraFeed';
import { decodeMediaFrame, isInitFrame } from '../utils/mediaFrame';

export interface RemoteVideoHandle {
  feed: CameraFeed;
  /** Hand to useViewerClient as onMedia. */
  onMedia: (frame: ArrayBuffer) => void;
  /** Hand to useViewerClient as onMediaEnd. */
  onMediaEnd: () => void;
  /** Hand to useViewerClient as onMediaStart. */
  onMediaStart: (mimeType: string) => void;
}

const emptyFeed: CameraFeed = {
  stream: null,
  srcUrl: null,
  settings: null,
  capabilities: null,
  error: null,
  active: false,
  hasVideo: false,
  hasAudio: false,
};

/**
 * Fallback for a host that never announced its codec (an older build).
 *
 * Guessing is what this used to do always, and it was wrong: Chromium answers a
 * request for avc1.42E01E by encoding avc1.42001f, so a SourceBuffer built from
 * the requested string rejects the stream and the card stays black. The host now
 * sends recorder.mimeType and this is only the last resort.
 */
function preferredMime(): string | null {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E01E"',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
  ];
  return candidates.find((c) => MediaSource.isTypeSupported(c)) ?? null;
}

export function useRemoteVideo(): RemoteVideoHandle {
  const [feed, setFeed] = useState<CameraFeed>(emptyFeed);

  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  // Fragments that arrived while the SourceBuffer was busy. appendBuffer throws
  // if called during an update, so they queue rather than being dropped — the
  // wait is milliseconds, and losing one mid-group costs the rest of the group.
  const queueRef = useRef<Uint8Array[]>([]);
  const startedRef = useRef(false);
  // What the host said its encoder is producing. Believed over any guess.
  const mimeRef = useRef<string | null>(null);

  const teardown = useCallback(() => {
    startedRef.current = false;
    queueRef.current = [];
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setFeed(emptyFeed);
  }, []);

  useEffect(() => teardown, [teardown]);

  const pump = useCallback(() => {
    const buffer = sourceBufferRef.current;
    if (!buffer || buffer.updating) return;
    const next = queueRef.current.shift();
    if (!next) return;
    try {
      buffer.appendBuffer(next as BufferSource);
    } catch {
      // QuotaExceededError is the one that happens in practice, once the
      // buffered range has grown past what the browser will hold. Dropping back
      // toward the live edge is the right answer for a live stream: what the
      // viewer wants is now, not a complete history of the last ten minutes.
      try {
        const buffered = buffer.buffered;
        if (buffered.length > 0) {
          const end = buffered.end(buffered.length - 1);
          buffer.remove(buffered.start(0), Math.max(buffered.start(0), end - 2));
        }
      } catch {
        // Nothing left to try here; the next init segment rebuilds the source.
      }
    }
  }, []);

  const onMedia = useCallback(
    (raw: ArrayBuffer) => {
      const frame = decodeMediaFrame(raw);
      if (!frame) return;

      // A new init segment means a new stream — the host restarted its encoder,
      // or this viewer just joined and the hub replayed the one it kept. Either
      // way the existing MediaSource cannot decode what follows it.
      if (isInitFrame(frame) && startedRef.current) teardown();

      if (!startedRef.current) {
        // Nothing before the init segment decodes, so anything that arrives
        // first is discarded rather than queued.
        if (!isInitFrame(frame)) return;

        if (typeof MediaSource === 'undefined') {
          setFeed({ ...emptyFeed, error: 'This browser cannot play the remote video.' });
          return;
        }
        const mime = mimeRef.current ?? preferredMime();
        if (!mime || !MediaSource.isTypeSupported(mime)) {
          setFeed({
            ...emptyFeed,
            error: mime
              ? `This browser cannot play the host's format (${mime}).`
              : 'This browser supports none of the streamed formats.',
          });
          return;
        }

        startedRef.current = true;
        const source = new MediaSource();
        mediaSourceRef.current = source;
        const url = URL.createObjectURL(source);
        objectUrlRef.current = url;

        source.addEventListener(
          'sourceopen',
          () => {
            try {
              const buffer = source.addSourceBuffer(mime);
              // 'sequence': the host's fragments carry their own timeline and a
              // viewer joining mid-stream would otherwise be asked to seek to a
              // presentation time it has no data before.
              buffer.mode = 'sequence';
              buffer.addEventListener('updateend', pump);
              sourceBufferRef.current = buffer;
              pump();
            } catch (err) {
              setFeed({
                ...emptyFeed,
                error: `Cannot play the host's video: ${err instanceof Error ? err.message : String(err)}`,
              });
            }
          },
          { once: true },
        );

        setFeed({
          ...emptyFeed,
          srcUrl: url,
          active: true,
          hasVideo: true,
          hasAudio: true,
        });
      }

      queueRef.current.push(frame.payload);
      pump();
    },
    [pump, teardown],
  );

  const onMediaEnd = useCallback(() => {
    mimeRef.current = null;
    teardown();
  }, [teardown]);

  /**
   * A new encoder on the host. The codec may differ from the last one, so the
   * current MediaSource is dropped rather than fed a stream it was not built
   * for — the init segment that follows rebuilds it.
   */
  const onMediaStart = useCallback(
    (mimeType: string) => {
      mimeRef.current = mimeType;
      if (startedRef.current) teardown();
    },
    [teardown],
  );

  return { feed, onMedia, onMediaEnd, onMediaStart };
}
