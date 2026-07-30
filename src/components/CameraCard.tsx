// The camera, in chart slot 4 on the launcher.
//
// The point of recording video alongside the measurement is being able to see
// what the rig was doing; a preview that only exists inside a settings window is
// a preview you look at once, while setting it up. Here it is next to the traces
// it explains, and a camera that has come unplugged mid-run is visible as a
// blank card rather than as a surprise at Stop Save.
//
// It shows the same stream the recorder is encoding — the composited one when
// the timestamp overlay is on — so what is on screen is what is in the file,
// including the burned-in clock.
import { useEffect, useRef } from 'react';
import type { CameraFeed } from '../hooks/useCameraFeed';
import { PLOT_HEIGHT } from './ChartPanel';

export function CameraCard({
  feed,
  recording,
  /** Set on a viewer: the picture is arriving from the host, not from a local device. */
  remote = false,
  /** Viewer-side: browsers will not start audio without a click. */
  muted,
  onToggleMuted,
}: {
  feed: CameraFeed;
  recording: boolean;
  remote?: boolean;
  muted?: boolean;
  onToggleMuted?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Two source shapes, one element: a local camera is a MediaStream on
  // srcObject, a remote one is a MediaSource behind an object URL on src.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (feed.srcUrl) {
      el.srcObject = null;
      if (el.src !== feed.srcUrl) el.src = feed.srcUrl;
    } else {
      el.removeAttribute('src');
      if (el.srcObject !== feed.stream) el.srcObject = feed.stream;
    }
    if (feed.stream || feed.srcUrl) void el.play().catch(() => {});
  }, [feed.stream, feed.srcUrl]);

  const settings = feed.settings;
  const hasPicture = feed.stream !== null || feed.srcUrl !== null;

  return (
    <section className="card card-tight space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[0.7rem] font-semibold leading-none text-slate-600 dark:text-slate-300">
          {remote ? 'Camera (host)' : 'Camera'}
        </span>
        {settings && (
          <span className="truncate text-[0.7rem] leading-none text-slate-400" translate="no">
            {settings.width}×{settings.height} @ {Math.round(settings.frameRate ?? 0)}
          </span>
        )}
        {onToggleMuted && hasPicture && (
          <button
            type="button"
            onClick={onToggleMuted}
            className="rounded border border-slate-300 px-1 py-0 text-[0.6rem] leading-none text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title={muted ? 'Turn the sound on' : 'Mute'}
          >
            {muted ? '🔇 Unmute' : '🔊 Sound'}
          </button>
        )}
        {recording && (
          <span
            className="ml-auto shrink-0 rounded bg-rose-100 px-1 py-0.5 text-[0.6rem] font-semibold leading-none text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
            translate="no"
          >
            ● REC
          </span>
        )}
      </div>

      {/* The empty state matches the plots' exactly — same height, same
          centred grey line — so the row does not step when a camera is bound. */}
      {hasPicture ? (
        <video
          ref={videoRef}
          muted={muted ?? true}
          playsInline
          autoPlay
          className="block w-full bg-black object-contain"
          style={{ height: PLOT_HEIGHT }}
        />
      ) : (
        <div
          className="flex items-center justify-center px-2 text-center text-sm text-slate-400"
          style={{ height: PLOT_HEIGHT }}
        >
          {feed.error
            ? feed.error
            : remote
              ? 'No video from the host'
              : 'No camera — bind one in Recording Config'}
        </div>
      )}
    </section>
  );
}
