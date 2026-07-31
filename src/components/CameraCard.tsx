// The camera, in chart slot 4.
//
// The point of recording video alongside the measurement is being able to see
// what the rig was doing; a preview that only exists inside a settings window is
// a preview you look at once, while setting it up. Here it is next to the traces
// it explains, and a camera that has come unplugged mid-run is visible as a
// blank card rather than as a surprise at Stop.
//
// Two sources, two elements. On the host it is the live MediaStream — the same
// one the recorder is encoding, composited, so what is on screen is what is in
// the file including the burned-in clock. On a viewer it is a JPEG still that
// arrives about once a second, which is why there is an <img> here and not a
// second <video>.
import { useEffect, useRef } from 'react';
import type { CameraFeed } from '../hooks/useCameraFeed';
import { PLOT_HEIGHT } from './ChartPanel';

/**
 * How long a still may go unrefreshed before the card stops implying it is
 * current. Several times the send interval, so an ordinary dropped frame passes
 * unremarked and a stalled host does not.
 */
const STALE_AFTER_MS = 5000;

export function CameraCard({
  feed,
  recording,
  /** Set on a viewer: the picture is arriving from the host, not from a device. */
  remote = false,
  snapshotUrl,
  lastFrameAt,
}: {
  feed: CameraFeed;
  recording: boolean;
  remote?: boolean;
  snapshotUrl?: string | null;
  lastFrameAt?: number | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== feed.stream) el.srcObject = feed.stream;
    if (feed.stream) void el.play().catch(() => {});
  }, [feed.stream]);

  const settings = feed.settings;
  const stale = lastFrameAt !== null && lastFrameAt !== undefined && Date.now() - lastFrameAt > STALE_AFTER_MS;
  const hasPicture = remote ? Boolean(snapshotUrl) : feed.stream !== null;

  return (
    <section className="card card-tight space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[0.7rem] font-semibold leading-none text-slate-600 dark:text-slate-300">
          {remote ? 'Camera (host)' : 'Camera'}
        </span>
        {!remote && settings && (
          <span className="truncate text-[0.7rem] leading-none text-slate-400" translate="no">
            {settings.width}×{settings.height} @ {Math.round(settings.frameRate ?? 0)}
          </span>
        )}
        {remote && hasPicture && (
          <span
            className={`truncate text-[0.7rem] leading-none ${stale ? 'text-amber-500' : 'text-slate-400'}`}
          >
            {stale ? 'no new frames' : 'live · ~1 fps'}
          </span>
        )}
        {recording && (
          <span
            className="ml-auto shrink-0 rounded bg-rose-100 px-1 py-0.5 text-[0.6rem] font-semibold leading-none text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
            translate="no"
          >
            {/* Only the lamp blinks, not the word — see .rec-blink. */}
            <span className="rec-blink">●</span> REC
          </span>
        )}
      </div>

      {/* The empty state matches the plots' exactly — same height, same centred
          grey line — so the row does not step when a camera is bound. */}
      {hasPicture ? (
        remote ? (
          <img
            src={snapshotUrl ?? undefined}
            alt="Host camera"
            className="block w-full bg-black object-contain"
            style={{ height: PLOT_HEIGHT }}
          />
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="block w-full bg-black object-contain"
            style={{ height: PLOT_HEIGHT }}
          />
        )
      ) : (
        <div
          className="flex items-center justify-center px-2 text-center text-sm text-slate-400"
          style={{ height: PLOT_HEIGHT }}
        >
          {feed.error
            ? feed.error
            : remote
              ? 'No picture from the host'
              : 'No camera — bind one in Recording Config'}
        </div>
      )}
    </section>
  );
}
