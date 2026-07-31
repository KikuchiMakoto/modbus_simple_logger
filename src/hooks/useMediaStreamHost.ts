/**
 * Host side of remote video: a second MediaRecorder on the same capture,
 * encoding at a lower bitrate and pushing fragments up the launcher socket.
 *
 * Separate from the file recorder rather than tapping its chunks, because the
 * two want different things. The file wants the quality the user configured and
 * a chunk interval tuned for crash durability; the stream wants small fragments
 * and a bitrate that survives someone's phone. Sharing one encoder would mean
 * the recording's quality was decided by whoever happened to be watching.
 *
 * It costs a second hardware encode, so it runs only when it is actually being
 * watched: sharing on, video enabled, and at least one viewer attached. Nobody
 * watching means no encoder at all — the same rule publishSamples follows, for
 * the same reason.
 */

import { useEffect, useRef } from 'react';
import { STREAM_CHUNK_INTERVAL_MS } from '../constants';
import { MEDIA_FLAG_INIT, MEDIA_KIND_VIDEO, encodeMediaFrame } from '../utils/mediaFrame';
import { selectStreamMime } from '../utils/videoAccel';

export interface UseMediaStreamHostOptions {
  /** The shared capture from useCameraFeed, or null. */
  stream: MediaStream | null;
  /** Master switch from the Remote Monitoring panel. */
  enabled: boolean;
  /** Sharing is running and somebody is attached. */
  viewerCount: number;
  bitrate: number;
  publishMedia: (frame: ArrayBuffer) => void;
  publishMediaEnd: () => void;
  onError: (message: string) => void;
}

export function useMediaStreamHost({
  stream,
  enabled,
  viewerCount,
  bitrate,
  publishMedia,
  publishMediaEnd,
  onError,
}: UseMediaStreamHostOptions): void {
  // Held in refs so a re-render never restarts the encoder: App re-renders on
  // every chart update, and an encoder that restarted with it would emit an
  // init segment several times a second.
  const publishRef = useRef(publishMedia);
  publishRef.current = publishMedia;
  const endRef = useRef(publishMediaEnd);
  endRef.current = publishMediaEnd;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const active = enabled && viewerCount > 0 && stream !== null;

  useEffect(() => {
    if (!active || !stream) return;

    let recorder: MediaRecorder | null = null;
    let cancelled = false;

    // Async because the hardware check is: the container has to be one the
    // recorder can write, a viewer can play, and a hardware encoder will take.
    (async () => {
      const candidate = selectStreamMime();
      if (cancelled) return;

      if (!candidate) {
        errorRef.current(
          'Remote video unavailable: no format this browser and a viewer both support.',
        );
        return;
      }

      try {
        recorder = new MediaRecorder(stream, {
          mimeType: candidate.mimeType,
          videoBitsPerSecond: bitrate,
        });
      } catch (err) {
        // A GPU whose encoder cannot take a second session lands here.
        // Streaming is what gives way: the recording must not be lost for it.
        errorRef.current(
          `Remote video unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }

      // The first fragment carries ftyp+moov (or the WebM header). It is
      // flagged so the hub can hold on to it and replay it to whoever joins
      // next — without it, a late viewer receives fragments it cannot decode.
      let first = true;
      let seq = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const isInit = first;
        first = false;
        event.data.arrayBuffer().then(
          (buffer) => {
            publishRef.current(
              encodeMediaFrame(MEDIA_KIND_VIDEO, isInit ? MEDIA_FLAG_INIT : 0, seq++, buffer),
            );
          },
          () => {
            // One dropped fragment; the stream recovers at the next one.
          },
        );
      };

      recorder.onerror = () => errorRef.current('Remote video encoder stopped.');
      recorder.start(STREAM_CHUNK_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      } catch {
        // Already gone.
      }
      // Said explicitly rather than left to be inferred from the fragments
      // drying up, so a viewer can tell "the host turned the camera off" from
      // "the link went quiet".
      endRef.current();
    };
    // `active` collapses the three conditions; bitrate and the stream identity
    // are the only other things worth a restart.
  }, [active, stream, bitrate]);
}
