/**
 * The single owner of the camera and microphone.
 *
 * Four things want this capture — the Recording Config preview, the chart
 * slot-4 card, the file recorder, and the remote publisher — and every one of
 * them could call getUserMedia itself. None of them do. A UVC camera is often
 * exclusive, and where it is not, opening it twice reserves its USB bandwidth
 * twice, which is exactly what utils/usbBandwidth.ts exists to prevent. So the
 * device is opened here, once, and everyone else reads the result.
 *
 * The timestamp compositor lives here for the same reason: one canvas, drawn
 * once per frame, feeding whatever is watching. Compositing per consumer would
 * multiply the only CPU cost this feature has.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { clearBackgroundTimer, setBackgroundInterval } from '../utils/backgroundTimer';
import { formatTimestamp } from '../utils/tsvFormat';
import type { OverlayPosition, RecordingConfig } from '../utils/recordingConfig';

export interface CameraFeed {
  /** What recorders and the preview should consume: composited if the overlay is on. */
  stream: MediaStream | null;
  /**
   * Object URL for a MediaSource, set only on a viewer (see useRemoteVideo).
   * A local camera hands over a MediaStream; a remote one arrives as fragments
   * appended to a MediaSource, and a <video> takes those through `src`. Both
   * shapes live on one type so the card renders either without branching.
   */
  srcUrl: string | null;
  /** What the camera actually gave us, which is not always what was asked for. */
  settings: MediaTrackSettings | null;
  capabilities: MediaTrackCapabilities | null;
  error: string | null;
  /** True once a device is open. */
  active: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
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

/** The parts of the config that require re-opening the device when they change. */
const captureKey = (config: RecordingConfig): string =>
  [
    config.videoDeviceId ?? '',
    config.audioDeviceId ?? '',
    config.width,
    config.height,
    config.captureFps,
    config.recordFps,
    config.overlayPosition,
  ].join('|');

/**
 * Draw one frame: the camera image, then the wall clock over it.
 *
 * The text is stroked before it is filled so the black outline sits behind the
 * white glyphs rather than eating into them, which is what keeps it readable
 * over both a dark rig and a bright window behind it.
 *
 * The string comes from formatTimestamp — the same function that writes the
 * TSV's timestamp column. Sharing it is the point: the burned-in clock and the
 * data column cannot drift into different formats or different rounding,
 * because there is only one of each.
 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  position: OverlayPosition,
): void {
  ctx.drawImage(video, 0, 0, width, height);
  // The canvas is also used purely to drop frames, with no text wanted.
  if (position === 'none') return;

  const text = formatTimestamp(Date.now());
  const fontSize = Math.max(12, Math.round(height / 24));
  const margin = Math.round(height / 45);

  ctx.font = `bold ${fontSize}px "Iosevka", ui-monospace, monospace`;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, height / 300);

  const right = position === 'top-right' || position === 'bottom-right';
  const top = position === 'top-left' || position === 'top-right';
  ctx.textAlign = right ? 'right' : 'left';
  // 'top' rather than arithmetic on the font size: the baseline of a clipped
  // ascender is not where the eye reads the top edge of the text to be.
  ctx.textBaseline = top ? 'top' : 'alphabetic';
  const x = right ? width - margin : margin;
  const y = top ? margin : height - margin;

  // Stroked before filled, so the black outline sits behind the white glyphs
  // rather than eating into them — which is what keeps it readable over both a
  // dark rig and a bright window behind it.
  ctx.strokeStyle = '#000000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
}

export interface UseCameraFeedOptions {
  config: RecordingConfig;
  /** Open the device only while something is actually watching or recording. */
  active: boolean;
  /**
   * Freeze the current capture. Set while recording: re-opening the device
   * mid-run would cut the recording in half, so setting changes wait for the
   * next Start Save.
   */
  locked: boolean;
}

export function useCameraFeed({ config, active, locked }: UseCameraFeedOptions): CameraFeed {
  const [feed, setFeed] = useState<CameraFeed>(emptyFeed);

  const key = captureKey(config);
  // While locked, keep whatever key was in force when the lock came down, so a
  // config edit during a recording does not re-run the effect.
  const lockedKeyRef = useRef<string | null>(null);
  if (locked && lockedKeyRef.current === null) lockedKeyRef.current = key;
  if (!locked && lockedKeyRef.current !== null) lockedKeyRef.current = null;
  const effectiveKey = lockedKeyRef.current ?? key;

  // Read inside the effect without making the effect depend on identity.
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!active) {
      setFeed(emptyFeed);
      return;
    }

    const snapshot = configRef.current;
    const wantVideo = snapshot.videoDeviceId !== null;
    const wantAudio = snapshot.audioDeviceId !== null;
    if (!wantVideo && !wantAudio) {
      setFeed(emptyFeed);
      return;
    }

    let cancelled = false;
    let rawStream: MediaStream | null = null;
    let compositeStream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let frameTimer: number | undefined;

    const stopAll = () => {
      clearBackgroundTimer(frameTimer);
      frameTimer = undefined;
      compositeStream?.getTracks().forEach((t) => t.stop());
      rawStream?.getTracks().forEach((t) => t.stop());
      if (video) {
        video.srcObject = null;
        video = null;
      }
    };

    (async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser.');
        }

        rawStream = await navigator.mediaDevices.getUserMedia({
          // `ideal`, never `exact`: exact fails the whole call when a camera
          // does not offer that precise mode, taking the audio track with it.
          // With ideal the camera opens at its nearest mode and the panel shows
          // what was actually granted, which is the failure the user can act on.
          video: wantVideo
            ? {
                deviceId: { exact: snapshot.videoDeviceId as string },
                width: { ideal: snapshot.width },
                height: { ideal: snapshot.height },
                frameRate: { ideal: snapshot.captureFps },
              }
            : false,
          // The processing chain is off on purpose. This records what a rig
          // sounded like — a knock, a squeal, a relay — not a phone call, and
          // noise suppression is built to remove exactly those.
          audio: wantAudio
            ? {
                deviceId: { exact: snapshot.audioDeviceId as string },
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
              }
            : false,
        });

        if (cancelled) {
          stopAll();
          return;
        }

        const videoTrack = rawStream.getVideoTracks()[0] ?? null;
        const audioTracks = rawStream.getAudioTracks();
        const settings = videoTrack?.getSettings() ?? null;
        const capabilities = videoTrack?.getCapabilities?.() ?? null;

        let outputStream = rawStream;

        // The canvas path is needed for two independent reasons, and either one
        // is enough: drawing the timestamp, and emitting fewer frames than the
        // camera produces. Frame decimation cannot be done on a raw track — the
        // only place frames can be dropped is the pump that feeds
        // captureStream(0).
        const needsCanvas =
          videoTrack !== null &&
          (snapshot.overlayPosition !== 'none' ||
            snapshot.recordFps < (settings?.frameRate ?? snapshot.captureFps));

        if (videoTrack && needsCanvas) {
          const width = settings?.width ?? snapshot.width;
          const height = settings?.height ?? snapshot.height;

          video = document.createElement('video');
          video.srcObject = new MediaStream([videoTrack]);
          video.muted = true;
          video.playsInline = true;
          await video.play().catch(() => {
            // Autoplay refusal on a muted, srcObject-backed element is not a
            // thing Chromium does, but a failure here must not take the raw
            // stream down with it — fall through and let the pump run; the
            // first frames will simply be blank.
          });

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) throw new Error('Could not create the timestamp overlay canvas.');

          // captureStream(0) plus an explicit requestFrame, driven by the
          // background timer rather than requestAnimationFrame. rAF stops when
          // the window is minimised, and a logger that keeps measuring while
          // minimised must not be recording a frozen picture of the moment it
          // was hidden.
          const captured = canvas.captureStream(0);
          const canvasTrack = captured.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

          // The recording rate, not the capture rate. The camera keeps
          // streaming at whatever it negotiated, and this decides how much of
          // it is kept.
          //
          // Not clamped to 1: the recording rate goes to 0.1 fps for a
          // time-lapse, which is a ten-second interval, and flooring it here
          // would silently turn every time-lapse back into 1 fps.
          const fps = Math.max(0.01, snapshot.recordFps);
          frameTimer = setBackgroundInterval(
            () => {
              if (!video || video.readyState < 2) return;
              drawFrame(ctx, video, width, height, snapshot.overlayPosition);
              canvasTrack.requestFrame();
            },
            Math.max(1, Math.round(1000 / fps)),
          );

          compositeStream = new MediaStream([canvasTrack, ...audioTracks]);
          outputStream = compositeStream;
        }

        if (cancelled) {
          stopAll();
          return;
        }

        setFeed({
          stream: outputStream,
          srcUrl: null,
          settings,
          capabilities,
          error: null,
          active: true,
          hasVideo: videoTrack !== null,
          hasAudio: audioTracks.length > 0,
        });
      } catch (err) {
        stopAll();
        if (cancelled) return;
        setFeed({
          ...emptyFeed,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [active, effectiveKey]);

  return useMemo(() => feed, [feed]);
}
