import { useEffect, useMemo, useRef, useState } from 'react';
import {
  VIDEO_CAPTURE_FPS_OPTIONS,
  VIDEO_FPS_EXPONENT,
  VIDEO_MAX_BITRATE,
  VIDEO_MIN_BITRATE,
  VIDEO_QUALITY_LEVELS,
  VIDEO_RECORD_FPS_OPTIONS,
  VIDEO_SIZES,
  bitsPerPixelFor,
  type VideoQuality,
} from '../constants';
import type { CameraFeed } from '../hooks/useCameraFeed';
import {
  OVERLAY_POSITIONS,
  emptyDeviceLists,
  enumerateMediaDevices,
  resolveBoundDevice,
  type DeviceLists,
  type OverlayPosition,
  type RecordingConfig,
} from '../utils/recordingConfig';
import { bitrateFor, selectVideoMime } from '../utils/videoAccel';
import { FloatingWindow } from './FloatingWindow';

type RecordingConfigPanelProps = {
  open: boolean;
  onClose: () => void;
  config: RecordingConfig;
  onConfigChange: (config: RecordingConfig) => void;
  /** The one live capture, shared with the chart slot and the recorder. */
  feed: CameraFeed;
  /** True while a recording is running: settings are read-only until it ends. */
  locked: boolean;
  /** File being written, or '' when idle. */
  activeFileName: string;
  recordingStartedAt: number | null;
  /** Opens the save dialog before anything starts — see utils/recordingOutput. */
  onStartRecording: () => void;
  onStopRecording: () => void;
};

const SELECT =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const LABEL = 'block text-xs text-slate-600 dark:text-slate-400';

/**
 * What an hour of this bitrate costs on disk. The unit somebody actually plans
 * against — a recording is left running for a shift, not for a second.
 */
function formatGbPerHour(bitsPerSecond: number): string {
  const gb = ((bitsPerSecond / 8) * 3600) / 1_000_000_000;
  return `≈ ${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB/h`;
}

/** `1:02:03` — the same shape as the header's save timer. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Live input level for the bound microphone.
 *
 * Written straight to the DOM rather than through state: a level meter updates
 * every frame, and 60 setState calls a second here would re-render this panel —
 * and re-run its codec probe — sixty times a second, on the thread that must
 * not miss a Modbus deadline.
 */
function MicLevelMeter({ stream }: { stream: MediaStream | null }) {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    const bar = barRef.current;
    if (!bar) return;
    if (!track) {
      bar.style.width = '0%';
      return;
    }

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.fftSize);
    let frame = 0;

    // requestAnimationFrame, deliberately unlike the capture pump in
    // useCameraFeed: this is a readout nobody is looking at when the window is
    // hidden, and it should stop when the window does.
    const tick = () => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const centred = (buffer[i] - 128) / 128;
        sum += centred * centred;
      }
      const level = Math.min(1, Math.sqrt(sum / buffer.length) * 3);
      bar.style.width = `${Math.round(level * 100)}%`;
      bar.style.backgroundColor = level > 0.9 ? '#f43f5e' : level > 0.6 ? '#fbbf24' : '#10b981';
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      // Closing matters: an AudioContext left open holds the audio device awake.
      ctx.close().catch(() => {});
    };
  }, [stream]);

  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
      <div ref={barRef} className="h-full w-0 bg-emerald-500" />
    </div>
  );
}

export function RecordingConfigPanel({
  open,
  onClose,
  config,
  onConfigChange,
  feed,
  locked,
  activeFileName,
  recordingStartedAt,
  onStartRecording,
  onStopRecording,
}: RecordingConfigPanelProps) {
  const [devices, setDevices] = useState<DeviceLists>(emptyDeviceLists);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /**
   * The element Picture-in-Picture is taken from, deliberately not the preview
   * below.
   *
   * The preview lives inside FloatingWindow, which unmounts its children when
   * the window is closed — and a PiP window whose source element is gone closes
   * with it. That would leave the button working only while the panel is open,
   * which is the one situation where it has nothing to offer. This element is
   * rendered outside the window instead, so the picture survives closing the
   * panel, which is the whole point: a recording runs for an hour and the panel
   * is in the way for fifty-nine minutes of it.
   *
   * It carries the stream only while PiP is up. A second <video> on the same
   * MediaStream costs compositing on the thread that must not miss a Modbus
   * deadline, and there is no reason to pay it for a picture nobody is seeing.
   */
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const [pipActive, setPipActive] = useState(false);

  const set = (patch: Partial<RecordingConfig>) => onConfigChange({ ...config, ...patch });

  const refreshDevices = async () => {
    try {
      setDevices(await enumerateMediaDevices());
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!open) return;
    void refreshDevices();
    // A camera can be plugged in while the panel is open.
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Re-enumerate once the capture is actually open.
   *
   * Chromium hides video inputs from enumerateDevices until camera permission
   * has been granted in this page — audio inputs it lists regardless, since
   * there is always a default. So a panel opened before the first grant showed
   * a populated microphone list next to "No camera found" while the preview
   * beside it was running, which reads as a bug in the app rather than as a
   * permission that had not been asked for yet. Once the feed is live the grant
   * exists, and the list can be believed.
   */
  useEffect(() => {
    if (!open || !feed.active) return;
    void refreshDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feed.active]);

  /**
   * Re-point a binding whose deviceId changed under it. Windows hands out a new
   * id when a camera comes back on a different USB port, and treating that as
   * "the camera was removed" would look like the setting had been lost.
   */
  useEffect(() => {
    if (!open || locked || !devices.labelsVisible) return;
    const video = resolveBoundDevice(config.videoDeviceId, config.videoDeviceLabel, devices.cameras);
    const audio = resolveBoundDevice(
      config.audioDeviceId,
      config.audioDeviceLabel,
      devices.microphones,
    );
    if (video.rebound || audio.rebound) {
      set({
        videoDeviceId: video.deviceId,
        videoDeviceLabel: video.label,
        audioDeviceId: audio.deviceId,
        audioDeviceLabel: audio.label,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locked, devices]);

  /**
   * Bind the first device when nothing has been chosen.
   *
   * The camera has no None: a Recording Config window whose camera is unset
   * shows a black preview and a dead button, which reads as broken rather than
   * as unconfigured. The microphone does have None, so it is only defaulted
   * until the user has said something about it — see `audioChosen`.
   */
  useEffect(() => {
    if (!open || locked || !devices.labelsVisible) return;
    const patch: Partial<RecordingConfig> = {};
    if (config.videoDeviceId === null && devices.cameras.length > 0) {
      patch.videoDeviceId = devices.cameras[0].deviceId;
      patch.videoDeviceLabel = devices.cameras[0].label;
    }
    if (!config.audioChosen && config.audioDeviceId === null && devices.microphones.length > 0) {
      patch.audioDeviceId = devices.microphones[0].deviceId;
      patch.audioDeviceLabel = devices.microphones[0].label;
    }
    if (Object.keys(patch).length > 0) set(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locked, devices, config.videoDeviceId, config.audioDeviceId, config.audioChosen]);

  const requestPermission = async () => {
    setPermissionError(null);
    try {
      // Opened and immediately released: this exists only to make the browser
      // reveal device labels, which stay blank until permission is granted once.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      probe.getTracks().forEach((t) => t.stop());
      await refreshDevices();
    } catch (err) {
      setPermissionError(err instanceof Error ? err.message : String(err));
    }
  };

  // Whether a container exists at all — not whether the encode will be fast.
  // See utils/videoAccel for why the second question is no longer asked.
  const canRecord = useMemo(() => selectVideoMime() !== null, []) && feed.active;

  /**
   * The bitrate the quality setting comes to at the current size and rate.
   *
   * Shown, because a quality name on its own is not something anybody can plan
   * disk space against — and the whole reason quality is the setting rather
   * than the bitrate is that the bitrate moves when the size or rate does.
   * Naming the number keeps that visible instead of hiding it behind a word.
   */
  const bitrate = useMemo(
    () =>
      bitrateFor({
        width: config.width,
        height: config.height,
        fps: config.recordFps,
        bitsPerPixel: bitsPerPixelFor(config.quality),
        fpsExponent: VIDEO_FPS_EXPONENT,
        min: VIDEO_MIN_BITRATE,
        max: VIDEO_MAX_BITRATE,
      }),
    [config.width, config.height, config.recordFps, config.quality],
  );

  const capMax = feed.capabilities;

  /**
   * `getCapabilities()` answers with a *range* — width 1..3840, frameRate 0..30
   * — not the list of modes the camera natively has, and every size inside that
   * range is accepted because Chromium will crop-and-scale to it. So only the
   * maximum is worth trusting, and it is used to hide options rather than to
   * validate anything. The current selection is kept even when it is over, so a
   * config saved against another camera stays visible instead of being silently
   * swapped.
   */
  const sizeOptions = useMemo(() => {
    const maxW = capMax?.width?.max ?? Number.POSITIVE_INFINITY;
    const maxH = capMax?.height?.max ?? Number.POSITIVE_INFINITY;
    const list: { width: number; height: number; ratio: string }[] = VIDEO_SIZES.filter(
      (s) => s.width <= maxW && s.height <= maxH,
    );
    if (list.some((s) => s.width === config.width && s.height === config.height)) return list;
    return [...list, { width: config.width, height: config.height, ratio: '' }].sort(
      (a, b) => a.width * a.height - b.width * b.height,
    );
  }, [capMax, config.width, config.height]);

  const captureFpsOptions = useMemo(() => {
    const max = capMax?.frameRate?.max ?? Number.POSITIVE_INFINITY;
    const list: number[] = VIDEO_CAPTURE_FPS_OPTIONS.filter((f) => f <= max);
    if (!list.includes(config.captureFps)) list.push(config.captureFps);
    return list.sort((a, b) => a - b);
  }, [capMax, config.captureFps]);

  /**
   * Never above the capture rate: the file cannot contain frames the camera did
   * not send.
   */
  const recordFpsCap = config.captureFps;
  const recordFpsOptions = useMemo(
    () => VIDEO_RECORD_FPS_OPTIONS.filter((f) => f <= recordFpsCap),
    [recordFpsCap],
  );

  // Bring an out-of-range selection down rather than showing a value the list
  // does not contain — which a <select> renders as whatever happens to be first.
  useEffect(() => {
    if (locked || config.recordFps <= recordFpsCap) return;
    set({ recordFps: recordFpsCap });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, recordFpsCap, config.recordFps]);

  // Keep the preview attached to whatever the feed is currently producing.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = feed.stream;
    if (feed.stream) void el.play().catch(() => {});
  }, [feed.stream]);

  /**
   * Picture-in-Picture, which is the browser's own floating window rather than
   * one of ours: it is the only surface that stays above *other applications*,
   * and that is what somebody watching a rig while working in something else
   * actually needs.
   *
   * Only ever entered from the click. requestPictureInPicture() requires a user
   * gesture, and there is no way to restore a PiP window on reload.
   */
  const pipSupported =
    typeof document !== 'undefined' &&
    document.pictureInPictureEnabled === true &&
    (feed.stream?.getVideoTracks().length ?? 0) > 0;

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      const el = pipVideoRef.current;
      if (!el || !feed.stream) return;
      el.srcObject = feed.stream;
      // Metadata has to have arrived before the request or Chromium rejects it,
      // and a stream attached a line ago has none yet.
      if (el.readyState === 0) {
        await new Promise<void>((resolve) => {
          el.addEventListener('loadedmetadata', () => resolve(), { once: true });
        });
      }
      await el.play().catch(() => {});
      await el.requestPictureInPicture();
      setPipActive(true);
    } catch {
      // Refused, unsupported, or the gesture had expired. Nothing was claimed
      // and nothing is broken, so there is nothing worth saying about it.
      setPipActive(false);
    }
  };

  // The PiP window has a close button of its own, so leaving is not always our
  // doing. Dropping the stream here is what keeps the second video idle.
  useEffect(() => {
    const el = pipVideoRef.current;
    if (!el) return;
    const onLeave = () => {
      setPipActive(false);
      el.srcObject = null;
    };
    el.addEventListener('leavepictureinpicture', onLeave);
    return () => el.removeEventListener('leavepictureinpicture', onLeave);
  }, []);

  // A camera unbound mid-recording leaves the PiP window showing a frozen last
  // frame, which reads as a live picture of a rig that has stopped moving.
  useEffect(() => {
    if (!pipActive || feed.stream) return;
    void document.exitPictureInPicture?.().catch(() => {});
  }, [pipActive, feed.stream]);

  // A window timer, not the background one: this is a readout, and a recording
  // clock that keeps ticking in a minimised window is work nobody is reading.
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (recordingStartedAt === null) {
      setElapsedMs(0);
      return;
    }
    setElapsedMs(Date.now() - recordingStartedAt);
    const id = window.setInterval(() => setElapsedMs(Date.now() - recordingStartedAt), 1000);
    return () => window.clearInterval(id);
  }, [recordingStartedAt]);

  const pipButton = (
    <button
      type="button"
      onClick={() => void togglePip()}
      disabled={!pipSupported && !pipActive}
      title={
        pipActive
          ? 'Close the floating camera window'
          : pipSupported
            ? 'Show the camera in a window that stays above other applications'
            : 'Picture-in-Picture needs a bound camera'
      }
      aria-label={pipActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
      aria-pressed={pipActive}
      className={`rounded border p-1 disabled:opacity-40 ${
        pipActive
          ? 'border-emerald-400 text-emerald-500 dark:border-emerald-400 dark:text-emerald-400'
          : 'border-slate-300 text-slate-600 hover:border-emerald-400 hover:text-emerald-500 dark:border-slate-700 dark:text-slate-300 dark:hover:border-emerald-400 dark:hover:text-emerald-400'
      }`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );

  return (
    <>
      {/* Outside FloatingWindow, so that closing the panel does not take the PiP
          window with it. Kept out of the layout and out of the accessibility
          tree rather than display:none, which would stop it presenting a frame
          at all. */}
      <video ref={pipVideoRef} muted playsInline aria-hidden tabIndex={-1} className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0" />
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Recording Config"
      subtitle={locked ? 'Recording — settings apply from the next start' : undefined}
      headerActions={pipButton}
      defaultWidth={340}
      defaultHeight={560}
    >
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {locked ? (
          <button
            type="button"
            onClick={onStopRecording}
            className="w-full rounded bg-rose-600 px-2 py-1.5 text-sm font-semibold text-white hover:bg-rose-500"
          >
            Stop Recording · {formatElapsed(elapsedMs)}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartRecording}
            disabled={!canRecord}
            className="w-full rounded bg-emerald-600 px-2 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
          >
            Start Recording…
          </button>
        )}
        <p className="text-[0.7rem] text-slate-500 dark:text-slate-400" translate="no">
          {locked
            ? activeFileName
            : 'Asks where to save, then starts. Finished on Stop — a crash before that loses the recording.'}
        </p>

        {!devices.labelsVisible && (
          <button
            type="button"
            onClick={requestPermission}
            className="w-full rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-500"
          >
            Allow camera &amp; microphone
          </button>
        )}
        {permissionError && (
          <p className="text-xs text-rose-600 dark:text-rose-400">{permissionError}</p>
        )}
        {feed.error && <p className="text-xs text-rose-600 dark:text-rose-400">{feed.error}</p>}

        {/* The two bindings together, camera first: they are one decision about
            what this recording is of, and separating them with a preview made
            the microphone read as an afterthought. */}
        <div>
          <label className={LABEL}>Camera</label>
          <select
            value={config.videoDeviceId ?? ''}
            disabled={locked}
            onChange={(e) => {
              const id = e.target.value || null;
              const found = devices.cameras.find((d) => d.deviceId === id);
              set({ videoDeviceId: id, videoDeviceLabel: found?.label ?? '' });
            }}
            className={SELECT}
          >
            {/* No None. A recording with no camera is an audio file, and if that
                is what is wanted it is reached by unbinding the microphone's
                counterpart, not by turning the video off here. */}
            {devices.cameras.length === 0 && <option value="">No camera found</option>}
            {devices.cameras.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL}>Microphone</label>
          <select
            value={config.audioDeviceId ?? ''}
            disabled={locked}
            onChange={(e) => {
              const id = e.target.value || null;
              const found = devices.microphones.find((d) => d.deviceId === id);
              // audioChosen from here on, so picking None sticks instead of
              // being defaulted back to the first microphone next time.
              set({ audioDeviceId: id, audioDeviceLabel: found?.label ?? '', audioChosen: true });
            }}
            className={SELECT}
          >
            <option value="">None</option>
            {devices.microphones.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          <MicLevelMeter stream={feed.stream} />
        </div>

        <div className="overflow-hidden rounded bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="block h-[140px] w-full object-contain"
          />
        </div>
        {feed.settings && (
          <p className="text-[0.7rem] text-slate-500 dark:text-slate-400" translate="no">
            {feed.settings.width}×{feed.settings.height} @ {Math.round(feed.settings.frameRate ?? 0)}{' '}
            fps
            {(feed.settings.width !== config.width || feed.settings.height !== config.height) &&
              ' — nearest mode the camera has'}
          </p>
        )}

        <div>
          <label className={LABEL}>Burn timestamp</label>
          <select
            value={config.overlayPosition}
            disabled={locked}
            onChange={(e) => set({ overlayPosition: e.target.value as OverlayPosition })}
            className={SELECT}
          >
            {OVERLAY_POSITIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL}>Resolution</label>
          <select
            value={`${config.width}x${config.height}`}
            disabled={locked}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number);
              set({ width: w, height: h });
            }}
            className={SELECT}
          >
            {sizeOptions.map((s) => (
              <option key={`${s.width}x${s.height}`} value={`${s.width}x${s.height}`}>
                {s.width}×{s.height}
                {s.ratio && ` · ${s.ratio}`}
              </option>
            ))}
          </select>
        </div>

        {/* Two rates, because they answer different questions — the same split
            the app already makes between Polling Rate and Save Rate. Capture is
            what the camera streams; recording is how much of it is written. */}
        <div className="flex gap-1.5">
          <div className="flex-1">
            <label className={LABEL}>Capture FPS</label>
            <select
              value={config.captureFps}
              disabled={locked}
              onChange={(e) => {
                const captureFps = Number(e.target.value);
                // Writing more frames than were captured is not a thing a
                // recorder can do, so the record rate follows it down.
                set({ captureFps, recordFps: Math.min(config.recordFps, captureFps) });
              }}
              className={SELECT}
            >
              {captureFpsOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={LABEL}>Recording FPS</label>
            <select
              value={config.recordFps}
              disabled={locked}
              onChange={(e) => set({ recordFps: Number(e.target.value) })}
              className={SELECT}
            >
              {recordFpsOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        {config.recordFps < config.captureFps && (
          <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">
            {config.recordFps < 1
              ? `One frame every ${(1 / config.recordFps).toFixed(0)} s.`
              : `Keeping 1 frame in ${Math.round(config.captureFps / config.recordFps)}.`}{' '}
            The camera still streams at {config.captureFps} fps.
          </p>
        )}

        {/* Quality rather than a bitrate field, because a bitrate only means
            something next to a size and a rate — the same 4 Mbps is generous at
            640×480 and poor at 1080p, and the size gets changed far more often
            than this does. What it sets is bits per pixel per frame; the figure
            beside it is that resolved against the current settings.

            Not a true CRF, which is what this would be if the platform allowed
            it: MediaRecorder accepts videoBitsPerSecond and nothing else, so
            constant quality has to be approximated by recomputing the bitrate
            whenever its inputs move. Real constant-quantizer encoding would
            mean WebCodecs and a hand-written MP4 muxer. */}
        <div className="flex gap-1.5">
          <div className="flex-1">
            <label className={LABEL}>Quality</label>
            <select
              value={config.quality}
              disabled={locked}
              onChange={(e) => set({ quality: e.target.value as VideoQuality })}
              className={SELECT}
            >
              {VIDEO_QUALITY_LEVELS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className={LABEL}>Bitrate</label>
            <p className="py-0.5 text-sm font-semibold text-slate-700 dark:text-slate-200" translate="no">
              {(bitrate / 1_000_000).toFixed(1)} Mbps
              <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                {/* bits/s -> bytes/s -> bytes/hour -> GB. */}
                {formatGbPerHour(bitrate)}
              </span>
            </p>
          </div>
        </div>

      </div>
    </FloatingWindow>
    </>
  );
}
