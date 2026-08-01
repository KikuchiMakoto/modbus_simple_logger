/**
 * Host side of remote monitoring's camera: a JPEG still, about once a second.
 *
 * This was an fMP4 stream into a MediaSource, and every hard bug the feature
 * had came from that — the codec Chromium reports is not the one it was asked
 * for, a viewer joining mid-stream needs the init segment replayed, and
 * playback drifts further behind the live edge the longer it runs, with nothing
 * to pull it back.
 *
 * A still has none of those failure modes. There is no codec to agree on, no
 * header a late viewer must have been present for, and no timeline to fall
 * behind: the newest picture is the one on screen. A frame that never arrives
 * costs nothing, because the next one replaces it whole rather than continuing
 * from it.
 *
 * What it gives up is smoothness, which remote monitoring never needed. The
 * question being answered is whether the rig is still turning.
 *
 * It runs only while somebody is attached — the same rule publishSamples
 * follows, for the same reason.
 */

import { useEffect, useRef } from 'react';
import {
  STREAM_JPEG_QUALITY,
  STREAM_SNAPSHOT_FPS,
  STREAM_SNAPSHOT_MAX_WIDTH,
} from '../constants';
import { clearBackgroundTimer, setBackgroundInterval } from '../utils/backgroundTimer';
import { MEDIA_KIND_JPEG, encodeMediaFrame } from '../utils/mediaFrame';

export interface UseMediaStreamHostOptions {
  /** The shared capture from useCameraFeed, or null. */
  stream: MediaStream | null;
  /** Sharing is running and somebody is attached. */
  viewerCount: number;
  publishMedia: (frame: ArrayBuffer) => void;
  publishMediaEnd: () => void;
}

export function useMediaStreamHost({
  stream,
  viewerCount,
  publishMedia,
  publishMediaEnd,
}: UseMediaStreamHostOptions): void {
  // Held in refs so a re-render never restarts the pump: App re-renders on
  // every chart update.
  const publishRef = useRef(publishMedia);
  publishRef.current = publishMedia;
  const endRef = useRef(publishMediaEnd);
  endRef.current = publishMediaEnd;

  const active = viewerCount > 0 && stream !== null;

  useEffect(() => {
    if (!active || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    // A video element of its own rather than reading the capture canvas
    // directly: useCameraFeed only builds a canvas when the overlay or frame
    // decimation needs one, so there is not always one to read. At one frame a
    // second the extra draw is free.
    //
    // Only the video track is attached. No audio is sent at all — see the note
    // in RemoteViewerPanel.
    const video = document.createElement('video');
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    let seq = 0;
    let inFlight = false;

    // The background timer, not rAF: a minimised host window must keep sending,
    // since watching it from somewhere else is the entire point.
    const timer = setBackgroundInterval(
      () => {
        if (!ctx || video.readyState < 2 || inFlight) return;
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w === 0 || h === 0) return;

        const scale = Math.min(1, STREAM_SNAPSHOT_MAX_WIDTH / w);
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        // A tick is skipped while the previous still is still encoding, rather
        // than queued. What arrives has to be current; a backlog of stale
        // pictures is the one thing worth less than no picture.
        inFlight = true;
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              inFlight = false;
              return;
            }
            blob.arrayBuffer().then(
              (buffer) => {
                publishRef.current(encodeMediaFrame(MEDIA_KIND_JPEG, 0, seq++, buffer));
                inFlight = false;
              },
              () => {
                inFlight = false;
              },
            );
          },
          'image/jpeg',
          STREAM_JPEG_QUALITY,
        );
      },
      Math.max(1, Math.round(1000 / STREAM_SNAPSHOT_FPS)),
    );

    return () => {
      clearBackgroundTimer(timer);
      video.srcObject = null;
      // Said explicitly rather than left to be inferred from the stills drying
      // up, so a viewer can tell "the host stopped" from "the link went quiet".
      endRef.current();
    };
  }, [active, stream]);
}
