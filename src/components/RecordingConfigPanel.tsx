import { useEffect, useMemo, useRef, useState } from 'react';
import {
  USB_BUDGET_OPTIONS,
  VIDEO_BITS_PER_PIXEL_FRAME,
  VIDEO_MAX_BITRATE,
  VIDEO_MAX_FPS,
  VIDEO_MIN_BITRATE,
  VIDEO_MIN_FPS,
  VIDEO_MIN_HEIGHT,
  VIDEO_MIN_WIDTH,
  VIDEO_PRESETS,
} from '../constants';
import type { CameraFeed } from '../hooks/useCameraFeed';
import {
  emptyDeviceLists,
  enumerateMediaDevices,
  resolveBoundDevice,
  type DeviceLists,
  type RecordingConfig,
  type UvcFormat,
} from '../utils/recordingConfig';
import { checkUsbBudget, largestFittingFps } from '../utils/usbBandwidth';
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

/** `1:02:03` — the same shape as the header's save timer. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const INPUT_CLASS =
  'w-full rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const LABEL_CLASS = 'block text-xs text-slate-600 dark:text-slate-400';

const UVC_FORMAT_OPTIONS: { value: UvcFormat; label: string }[] = [
  { value: 'mjpeg', label: 'MJPEG (compressed)' },
  { value: 'yuy2', label: 'YUY2 (uncompressed)' },
  { value: 'h264', label: 'H.264 (camera encodes)' },
];

/** A number field that only commits on blur or Enter, like the Slave ID field. */
function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = parseInt(draft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="flex-1">
      <label className={LABEL_CLASS}>{label}</label>
      <input
        type="number"
        value={draft}
        min={min}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        className={INPUT_CLASS}
      />
    </div>
  );
}

/**
 * Live input level for the bound microphone.
 *
 * Reads the same stream the recorder will use, so a flat bar here means the
 * recording would be silent too — which is the entire question this answers.
 */
function MicLevelMeter({ stream }: { stream: MediaStream | null }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    const bar = barRef.current;
    const peakMark = peakRef.current;
    if (!bar || !peakMark) return;
    if (!track) {
      bar.style.width = '0%';
      peakMark.style.left = '0%';
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
    let peakHold = 0;

    // The bar is written straight to the DOM rather than through state. A level
    // meter updates every frame, and 60 setState calls a second here would
    // re-render this panel — and re-run its budget and codec checks — sixty
    // times a second, on the thread that must not miss a Modbus deadline. The
    // one thing this component must not do is cost the measurement anything.
    //
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
      const rms = Math.sqrt(sum / buffer.length);
      const level = Math.min(1, rms * 3);
      peakHold = Math.max(level, peakHold * 0.98);

      bar.style.width = `${Math.round(level * 100)}%`;
      bar.style.backgroundColor =
        level > 0.9 ? '#f43f5e' : level > 0.6 ? '#fbbf24' : '#10b981';
      peakMark.style.left = `${Math.round(peakHold * 100)}%`;

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
    <div className="mt-1">
      <div className="relative h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
        <div ref={barRef} className="h-full w-0 bg-emerald-500" />
        <div
          ref={peakRef}
          className="absolute top-0 h-full w-0.5 bg-slate-500 dark:bg-slate-300"
          style={{ left: '0%' }}
        />
      </div>
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

  const bitrate = useMemo(
    () =>
      bitrateFor(
        config.width,
        config.height,
        config.fps,
        VIDEO_BITS_PER_PIXEL_FRAME,
        VIDEO_MIN_BITRATE,
        VIDEO_MAX_BITRATE,
      ),
    [config.width, config.height, config.fps],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    probeVideoAccel(config.width, config.height, config.fps, bitrate).then((verdict) => {
      if (!cancelled) setAccel(verdict);
    });
    return () => {
      cancelled = true;
    };
  }, [open, config.width, config.height, config.fps, bitrate]);

  const budget = useMemo(() => checkUsbBudget(config), [config]);
  const canEnable = accel?.ok === true && budget.ok;

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

  // Keep the preview attached to whatever the feed is currently producing.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = feed.stream;
    if (feed.stream) void el.play().catch(() => {});
  }, [feed.stream]);

  const fitFps = largestFittingFps(
    config.width,
    config.height,
    config.uvcFormat,
    config.usbBudgetMbps,
  );

  const capMax = feed.capabilities;

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="Recording Config"
      subtitle={locked ? 'Recording — settings apply from the next Start Save' : undefined}
      defaultWidth={380}
      defaultHeight={620}
    >
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {/* The gate, first and unmissable. Everything below it is pointless if
            this is red, and a user who cannot record deserves to know why before
            they spend time on the settings. */}
        {accel && (
          <div
            className={`rounded border px-2 py-1 text-xs ${
              accel.ok
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200'
            }`}
          >
            <p className="font-semibold">{accel.reason}</p>
            <p className="mt-0.5 break-words opacity-80" translate="no">
              {accel.detail}
            </p>
          </div>
        )}

        {/* The recording control, and the destination it needs. Both live at
            the top because this window is now where a recording is started —
            it is no longer a side effect of Start Save, so the button that does
            it should be the first thing in the window that owns it. */}
        <div className="space-y-1.5 rounded border border-slate-200 p-2 dark:border-slate-700">
          <div className="flex items-baseline gap-1.5">
            <span className={LABEL_CLASS}>Save to</span>
            <span
              className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200"
              translate="no"
              title={outputDirName ?? undefined}
            >
              {outputDirName ?? 'no folder chosen'}
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
              Stop Recording
            </button>
          ) : (
            <button
              type="button"
              onClick={onStartRecording}
              disabled={!canEnable || !feed.active}
              className="w-full rounded bg-emerald-600 px-2 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-400 dark:disabled:bg-slate-700"
            >
              Start Recording
            </button>
          )}

          {locked ? (
            <p className="text-[0.7rem] text-slate-600 dark:text-slate-300" translate="no">
              ● {activeFileName} · {formatElapsed(elapsedMs)}
            </p>
          ) : (
            <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">
              {/* The over-budget case is called out separately from "no camera".
                  The camera is not opened at all while the setting is over
                  budget — a UVC camera reserves its bandwidth the moment it
                  opens — so the preview below goes black, and without this line
                  that reads as a broken camera rather than as a refused
                  setting. */}
              {!budget.ok
                ? 'The camera is not opened while this size is over the USB budget — see below.'
                : !feed.active
                  ? 'Bind a camera or microphone below first.'
                  : outputDirName
                    ? 'Files are named by the time they start, like the TSV.'
                    : 'You will be asked for a folder when you press this.'}
            </p>
          )}

          {/* Said where it matters rather than buried in a manual. The file is
              written through a handle that only commits on close, so this is
              the same caveat Start Save carries — and unlike the TSV there is
              no crash-recovery mirror, because mirroring gigabytes of video
              would cost the acquisition loop the disk bandwidth it needs. */}
          <p className="text-[0.7rem] text-amber-600 dark:text-amber-400">
            The file is finished when you press Stop. A crash before that loses the recording.
          </p>
        </div>

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

        <div>
          <label className={LABEL_CLASS}>Camera</label>
          <select
            value={config.videoDeviceId ?? ''}
            disabled={locked}
            onChange={(e) => {
              const id = e.target.value || null;
              const found = devices.cameras.find((d) => d.deviceId === id);
              set({ videoDeviceId: id, videoDeviceLabel: found?.label ?? '' });
            }}
            className={INPUT_CLASS}
          >
            <option value="">None</option>
            {devices.cameras.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded border border-slate-200 bg-black dark:border-slate-700">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="block h-[150px] w-full object-contain"
          />
        </div>
        {feed.settings && (
          <p className="text-[0.7rem] text-slate-500 dark:text-slate-400" translate="no">
            Actual: {feed.settings.width}×{feed.settings.height} @{' '}
            {Math.round(feed.settings.frameRate ?? 0)} fps
            {(feed.settings.width !== config.width || feed.settings.height !== config.height) && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                — the camera chose the nearest mode it has
              </span>
            )}
          </p>
        )}

        <div>
          <label className={LABEL_CLASS}>Microphone</label>
          <select
            value={config.audioDeviceId ?? ''}
            disabled={locked}
            onChange={(e) => {
              const id = e.target.value || null;
              const found = devices.microphones.find((d) => d.deviceId === id);
              set({ audioDeviceId: id, audioDeviceLabel: found?.label ?? '' });
            }}
            className={INPUT_CLASS}
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

        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={config.overlayTimestamp}
            disabled={locked}
            onChange={(e) => set({ overlayTimestamp: e.target.checked })}
            className="h-4 w-4"
          />
          <span>Burn local time into the video</span>
        </label>

        <div className="flex gap-1.5">
          <NumberField
            label="Width"
            value={config.width}
            min={VIDEO_MIN_WIDTH}
            max={Number.MAX_SAFE_INTEGER}
            disabled={locked}
            onCommit={(width) => set({ width })}
          />
          <NumberField
            label="Height"
            value={config.height}
            min={VIDEO_MIN_HEIGHT}
            max={Number.MAX_SAFE_INTEGER}
            disabled={locked}
            onCommit={(height) => set({ height })}
          />
          <NumberField
            label="FPS"
            value={config.fps}
            min={VIDEO_MIN_FPS}
            max={VIDEO_MAX_FPS}
            disabled={locked}
            onCommit={(fps) => set({ fps })}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {VIDEO_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={locked}
              onClick={() => set({ width: p.width, height: p.height, fps: p.fps })}
              className="rounded border border-slate-300 px-1.5 py-0.5 text-[0.7rem] text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Reported, never enforced: plenty of cameras understate or omit their
            capabilities, and refusing a size on the strength of that would block
            a mode the camera can actually do. */}
        {capMax?.width?.max !== undefined &&
          (config.width > (capMax.width.max ?? 0) ||
            config.height > (capMax.height?.max ?? 0)) && (
            <p className="text-[0.7rem] text-amber-600 dark:text-amber-400" translate="no">
              This camera reports a maximum of {capMax.width.max}×{capMax.height?.max} @{' '}
              {capMax.frameRate?.max ?? '?'} fps.
            </p>
          )}

        {/* USB budget. The camera reserves isochronous bandwidth up front; the
            Modbus adapter's serial link is bulk and gets what is left. */}
        <div className="space-y-1 rounded border border-slate-200 p-1.5 dark:border-slate-700">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              USB bandwidth
            </span>
            <select
              value={config.uvcFormat}
              disabled={locked}
              onChange={(e) => set({ uvcFormat: e.target.value as UvcFormat })}
              className="ml-auto rounded border border-slate-300 bg-white px-1 py-0 text-[0.7rem] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {UVC_FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={config.usbBudgetMbps}
              disabled={locked}
              onChange={(e) => set({ usbBudgetMbps: Number(e.target.value) })}
              className="rounded border border-slate-300 bg-white px-1 py-0 text-[0.7rem] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {USB_BUDGET_OPTIONS.map((mbps) => (
                <option key={mbps} value={mbps}>
                  {mbps} Mbps
                </option>
              ))}
            </select>
          </div>

          {!budget.skipped && (
            <>
              <div className="h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
                <div
                  className={`h-full ${budget.ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ width: `${Math.min(100, Math.round(budget.usedFraction * 100))}%` }}
                />
              </div>
              <p
                className={`text-[0.7rem] ${budget.ok ? 'text-slate-600 dark:text-slate-400' : 'text-rose-600 dark:text-rose-400'}`}
                translate="no"
              >
                {budget.estimateMbps.toFixed(0)} Mbps of {budget.budgetMbps} Mbps
                {!budget.ok && fitFps >= 1 && ` — ${fitFps} fps would fit at this size`}
              </p>
              {/* Always shown, pass or fail. The browser never says which UVC
                  format it negotiated, so a green bar based on the declared one
                  is a claim that could be wrong — and hiding that would be the
                  dishonest part, not the estimate itself. */}
              {config.uvcFormat !== 'yuy2' && budget.worstCaseOverBudget && (
                <p className="text-[0.7rem] text-amber-600 dark:text-amber-400" translate="no">
                  If the camera falls back to YUY2 this needs{' '}
                  {budget.worstCaseMbps.toFixed(0)} Mbps — over budget.
                </p>
              )}
            </>
          )}

          <label className="flex items-center gap-1.5 text-[0.7rem] text-slate-600 dark:text-slate-400">
            <input
              type="checkbox"
              checked={config.separateUsbBus}
              disabled={locked}
              onChange={(e) => set({ separateUsbBus: e.target.checked })}
              className="h-3 w-3"
            />
            <span>Camera is on a separate USB bus / USB3 port (skip this check)</span>
          </label>
        </div>

        <p className="text-[0.7rem] text-slate-500 dark:text-slate-400">
          Recording starts with Start Save and is saved to your downloads folder at Stop Save, under
          the same name as the TSV.
        </p>
      </div>
    </FloatingWindow>
  );
}
