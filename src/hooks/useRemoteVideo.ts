/**
 * Viewer side of remote monitoring's camera: JPEG stills in, an <img> out.
 *
 * There is no MediaSource here any more, and that is the point. The stream
 * version of this needed the host's exact codec string (Chromium does not
 * encode the one it is asked for), an init segment replayed to anyone joining
 * late, and a running correction to stop playback drifting behind the live
 * edge. All three were bugs before they were features.
 *
 * A still needs none of it: decode the newest one, show it, throw away the
 * previous. Latency is one network hop and cannot accumulate, because nothing
 * is being played back — there is no timeline to fall behind on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MEDIA_KIND_JPEG, decodeMediaFrame } from '../utils/mediaFrame';

export interface RemoteVideoHandle {
  /** Object URL of the most recent still, or null. */
  snapshotUrl: string | null;
  /** When it arrived, so the card can say the picture has gone stale. */
  lastFrameAt: number | null;
  /** Hand to useViewerClient as onMedia. */
  onMedia: (frame: ArrayBuffer) => void;
  /** Hand to useViewerClient as onMediaEnd. */
  onMediaEnd: () => void;
}

export function useRemoteVideo(): RemoteVideoHandle {
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  // The URL currently on screen, so it can be revoked once replaced. Without
  // this every still leaks a blob for the life of the page — at one a second
  // that is 3600 an hour.
  const currentRef = useRef<string | null>(null);

  const replace = useCallback((url: string | null) => {
    const previous = currentRef.current;
    currentRef.current = url;
    setSnapshotUrl(url);
    // Revoked after the swap, not before: revoking a URL the <img> is still
    // showing blanks it for a frame.
    if (previous) URL.revokeObjectURL(previous);
  }, []);

  useEffect(() => () => replace(null), [replace]);

  const onMedia = useCallback(
    (raw: ArrayBuffer) => {
      const frame = decodeMediaFrame(raw);
      if (!frame || frame.kind !== MEDIA_KIND_JPEG) return;
      // Copied out of the received buffer: the payload is a view onto it, and
      // a Blob must own bytes that outlive this callback.
      const blob = new Blob([frame.payload.slice()], { type: 'image/jpeg' });
      replace(URL.createObjectURL(blob));
      setLastFrameAt(Date.now());
    },
    [replace],
  );

  const onMediaEnd = useCallback(() => {
    replace(null);
    setLastFrameAt(null);
  }, [replace]);

  return { snapshotUrl, lastFrameAt, onMedia, onMediaEnd };
}
