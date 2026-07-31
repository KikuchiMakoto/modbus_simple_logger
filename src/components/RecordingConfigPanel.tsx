import { useEffect, useMemo, useRef, useState } from 'react';
import {
  VIDEO_BITS_PER_PIXEL_FRAME,
  VIDEO_CAPTURE_FPS_OPTIONS,
  VIDEO_MAX_BITRATE,
  VIDEO_MIN_BITRATE,
  VIDEO_RECORD_FPS_OPTIONS,
  VIDEO_SIZES,
  VIDEO_SOFTWARE_MAX_RECORD_FPS,
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
import { bitrateFor, probeVideoAccel, type VideoAccelVerdict } from '../utils/videoAccel';
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
  onStartRecording: () => void;
  onStopRecording: () => void;
  /** The chosen output folder, or null when none has been picked yet. */
  outputDirName: string | null;
  onChooseOutputDir: () => void;
};

const SELECT =
  'w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const LABEL = 'block text-xs text-slate-600 dark:text-slate-400';

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
  outputDirName,
  onChooseOutputDir,
}: RecordingConfigPanelProps) {
  const [devices, setDevices] = useState<DeviceLists>(emptyDeviceLists);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [accel, setAccel] = useState<VideoAccelVerdict | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  // The encoder is asked to keep up with the recording rate, not the capture
  // rate: frames dropped before the encoder are frames it never has to encode.
  const bitrate = useMemo(
    () =>
      bitrateFor(
        config.width,
        config.height,
        config.recordFps,
        VIDEO_BITS_PER_PIXEL_FRAME,
        VIDEO_MIN_BITRATE,
        VIDEO_MAX_BITRATE,
      ),
    [config.width, config.height, config.recordFps],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    probeVideoAccel(config.width, config.height, config.recordFps, bitrate).then((verdict) => {
      if (!cancelled) setAccel(verdict);
    });
    return () => {
      cancelled = true;
    };
  }, [open, config.width, config.height, config.recordFps, bitrate]);

  // Software encoding is a warning, not a bar: the only capability signal
  // available describes WebCodecs, which MediaRecorder does not use.
  const canRecord = accel?.candidate != null && feed.active;

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
   * Never above the capture rate — the file cannot contain frames the camera
   * did not send — and much lower again when the encode is in software.
   *
   * The software ceiling is on this rate rather than on the capture rate
   * because this is the one that drives the cost: every recorded frame is a
   * frame the CPU compresses, on the machine whose polling loop must not miss a
   * deadline.
   */
  const softwareLimited = accel !== null && !accel.hardware;
  const recordFpsCap = softwareLimited
    ? Math.min(config.captureFps, VIDEO_SOFTWARE_MAX_RECORD_FPS)
    : config.captureFps;
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

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Recording Config"
      subtitle={locked ? 'Recording — settings apply from the next start' : undefined}
      defaultWidth={340}
      defaultHeight={560}
    >
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {/* A warning, not a refusal. The only signal available describes
            WebCodecs while MediaRecorder does not go through it, so this is a
            hint about likely cost rather than a fact about capability — and it
            was measured being wrong. The measurements are on the hover. */}
        {accel && accel.summary !== '' && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {accel.summary}{' '}
            <span className="cursor-help underline decoration-dotted" title={accel.detail}>
              details
            </span>
          </p>
        )}

        <div className="flex items-baseline gap-1.5">
          <span className={LABEL}>Save to</span>
          <span
            className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200"
            translate="no"
            title={outputDirName ?? undefined}
          >
            {outputDirName ?? '—'}
          </span>
          <button
            type="button"
            onClick={onChooseOutputDir}
            disabled={locked}
            className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[0.7rem] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Choose…
          </button>
        </div>

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
            Start Recording
          </button>
        )}
        <p className="text-[0.7rem] text-slate-500 dark:text-slate-400" translate="no">
          {locked
            ? activeFileName
            : 'Finished on Stop — a crash before that loses the recording.'}
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
            <label className={LABEL}>
              Recording FPS
              {softwareLimited && (
                <span
                  className="ml-1 cursor-help text-amber-600 underline decoration-dotted dark:text-amber-400"
                  title={`Capped at ${VIDEO_SOFTWARE_MAX_RECORD_FPS} fps because the encode looks like software. Every recorded frame is compressed on the CPU that runs the polling loop.`}
                >
                  ≤{VIDEO_SOFTWARE_MAX_RECORD_FPS}
                </span>
              )}
            </label>
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

      </div>
    </FloatingWindow>
  );
}
