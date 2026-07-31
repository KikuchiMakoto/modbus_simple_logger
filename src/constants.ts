export const AI_CHANNELS = 16;
export const AO_CHANNELS = 8;
export const PARAM_CHANNELS = 16;

export const AI_START_REGISTER = 0;
export const AI_FLOAT_START_REGISTER = 5000;
export const AO_START_REGISTER = 0;

// IndexedDB retention while NOT saving (session FIFO store, independent of the
// on-screen chart).
export const MAX_POINTS_IN_MEMORY = 256;

// On-screen chart budget while SAVING: the whole capture (save-start → now) is
// downsampled to this many points. The not-saving preview has its own, smaller
// budget (NON_SAVING_CHART_PREVIEW_POINTS). The full data is always written to
// TSV regardless.
// Raised 1024 → 2048 in v3.1, funded by disabling the scattergl hover pick-index
// (`hoverinfo: 'skip'`, see ChartPanel.tsx): that index is rebuilt per update and
// its cost scales with this constant, so removing it buys headroom at the same
// redraw rate. Deliberately conservative — the headroom has not been measured
// on-device yet (docs/chart-library-comparison.md §11-1), so this is a doubling
// rather than the 8192 the hardware may well allow.
//
// That headroom has since been spent from the other side: CHART_REDRAW_INTERVAL_MS
// went 500 -> 200 ms, so the same point budget is now drawn 2.5x as often. This
// number and that one draw on the same unmeasured budget.
export const CHART_MAX_POINTS = 2048;
// How often a polled sample is fed to the chart buffer (and, while not saving,
// to IndexedDB and the remote viewer feed). Applied as a poll-count stride, so
// it is exact on the poll grid: every poll at 100 ms polling, every 2nd at
// 50 ms, every 5th at 20 ms.
//
// 10 Hz is already twice the chart's own redraw rate, so the points past it
// were never separately visible — they only ever added buffer churn and, at the
// fast poll rates, decimation work between two Modbus transfers. Keeping the
// chart's input rate fixed also means the poll rate can be raised for a control
// loop without the display cost following it up.
//
// The TSV is NOT on this budget: what the file records is the "Save every"
// setting, which can be faster than this.
export const CHART_INPUT_INTERVAL_MS = 100;
// Preview length while NOT saving, as a point count rather than a duration.
// Chart input is a fixed CHART_INPUT_INTERVAL_MS, so the two are the same thing
// — 768 x 100 ms is a ~77 s window — and counting points means the trim is a
// single splice with no clock read and no scan for the cutoff.
//
// It also behaves better when the feed stalls: a time window empties itself
// while the device is silent, leaving a blank chart with no clue what the last
// reading was, where a point budget holds the last 77 s of real data until new
// data pushes it out.
export const NON_SAVING_CHART_PREVIEW_POINTS = 768;
// Minimum interval between chart redraws (setDisplayRevision bumps), saving or
// not. Chart data flushes up to 10x/s and redrawing four scattergl charts every
// flush is wasteful and feeds WebGL/regl resource churn, so this keeps the
// steady GPU/React cost off the acquisition loop — the competition that matters.
// Recording is unaffected either way.
//
// One constant, not one per mode: the saving case used to be slower (500 vs
// 200 ms) on the argument that a whole-capture view moves less per sample, but
// the same is true of a 768-point preview, and two numbers only ever meant two
// things to reason about. Unified at 500 at the time — the slower of the two —
// and now back at 200: 2 fps made a live trace visibly step rather than move,
// which is the one thing a preview is for, and 5 fps is still half the 10 Hz
// chart input rate so no flush goes unseen.
//
// The cost is real and unmeasured on-device: 2.5x the redraws, each over up to
// CHART_MAX_POINTS x 4 charts. Which is why this is now the CAPABLE-device
// figure only — see CHART_REDRAW_INTERVAL_CONSTRAINED_MS.
//
// This is a FLOOR, not a period. A redraw is only armed by a flush that
// actually added a point to the chart buffer (see flushPendingDataPoints), so
// late in a save — where the decimation stride means a new point every few
// seconds — the redraw rate follows the points rather than this constant.
export const CHART_REDRAW_INTERVAL_MS = 200;
// Redraw floor on a device that cannot afford the fast one. 5 fps of four
// scattergl charts is cheap on a GPU and expensive without one, and this app's
// standing rule is that display cost must never be paid out of the acquisition
// loop's budget — so the display is what gives way, back to the 2 fps that was
// the flat rate before.
export const CHART_REDRAW_INTERVAL_CONSTRAINED_MS = 500;
// What counts as "cannot afford it", checked at runtime (see App.tsx):
//
//   - Plotly reporting a CPU rasterizer (utils/renderBackend). The decisive
//     signal: every redraw is then main-thread pixel work, competing directly
//     with the serial I/O continuations rather than running on the GPU.
//   - this many logical cores or fewer. Cores are what the WORKERS need — the
//     TSV writer and whichever script runtime is live are on their own threads,
//     so they are not fighting the main thread for time, they are fighting the
//     renderer for cores.
export const CHART_REDRAW_CONSTRAINED_MAX_CORES = 4;
// A redraw that comes due mid-transfer waits for the gap between polls instead
// of landing on top of it, re-checking this often. Short relative to a poll
// period so the wait costs a fraction of the interval, not a whole one.
export const CHART_REDRAW_DEFER_RETRY_MS = 20;
// Ceiling on that waiting. Without it, a fast poll rate over a slow link — where
// a transfer is in flight most of the time — would defer the chart indefinitely,
// and a frozen chart is a worse failure than a jittery one. At the ceiling the
// redraw goes through regardless.
export const CHART_REDRAW_DEFER_MAX_MS = 1_000;
// How often per-sample readouts (measured rate, saved-point count) are pushed
// into React state. They are numbers a human reads, so 4/s is already more than
// anyone can follow — while a state update per sample put a full re-render of
// the channel cards between two Modbus transfers, turning display cost into
// polling jitter. The underlying values are exact and kept in refs; only the
// publishing is on a budget.
export const READOUT_PUBLISH_INTERVAL_MS = 250;
// Floor on how often the AI channel cards are refreshed, applied only when
// polling faster than this (at the default 100 ms poll rate nothing changes). A
// publish re-renders every channel card, and at 20 Hz that render lands between
// two Modbus transfers — display cost turning straight into polling jitter,
// which is the one trade this app must never make. 10 Hz is already past what
// anyone can read off a moving number. Raise it to 0 to go back to one render
// per sample; the recorded data is unaffected either way.
export const CHANNEL_CARD_MIN_INTERVAL_MS = 100;
// NOTE: CHART_PURGE_INTERVAL_MS (periodic 15-minute purge + remount) was removed
// in v3.1. It was counterproductive: `Plotly.purge()` does not destroy the
// scattergl WebGL context (plotly.js issues #2852 / #6365, the latter still open),
// so every timed remount allocated a fresh context while leaking the old one —
// 4 charts x 4/hour walks straight into the browser's ~8-16 context limit, at
// which point the oldest charts silently stop rendering. Contexts are now
// released explicitly via WEBGL_lose_context when a chart is replaced or
// unmounted (see releaseWebglContext in ChartPanel.tsx), which fixes the
// accumulation the periodic purge was trying to bound. The save-path
// re-decimation still forces one remount, which is a genuine visual
// discontinuity rather than a timer.

// Auto precision probe (Connection Config → Precision → Auto). One request for
// the first two float channels at AI_FLOAT_START_REGISTER, sent once per
// connect: an answer means the device has the f32 map, silence means it does
// not and the i16 map at AI_START_REGISTER is used instead.
//
// 100 ms is a deliberate order of magnitude more than the exchange costs. The
// request and its reply are 21 characters, which is 4 ms of wire time at the
// default 38400 baud and still only 44 ms at the slowest offered 4800 — so a
// device that has the registers answers well inside the window at every setting
// the app can be configured for.
//
// A device without those registers answers with a Modbus exception frame, which
// is shorter than the reply the transfer is waiting for, so it too resolves as
// a timeout. That is why the probe is repeated: the two "no f32 here" paths and
// a single dropped frame are indistinguishable from the outside, and demoting a
// float device to the i16 map on one lost frame would silently record a
// different set of registers.
export const PRECISION_PROBE_TIMEOUT_MS = 100;
export const PRECISION_PROBE_ATTEMPTS = 3;
export const PRECISION_PROBE_CHANNELS = 2;

export const RETRY_DELAY_MS = 10;
export const INPUT_READ_RETRY_WINDOW_MS = 60_000;
// Floor on the AI-read failure budget, and the share of the polls in one window
// that may fail before reads are suspended. Whichever is larger wins.
//
// A flat count stopped working once the poll rate was decoupled from the save
// rate. It was written when a slow setting meant a slow loop, so ten failures
// took minutes to accumulate; at a fixed 10-40 Hz it is one second of a dead
// device, after which every read is skipped until the failures age out of the
// window — up to a minute of blackout, and at a 200 ms save rate that is 300
// missing rows. The point of the limiter is to stop hammering a device that is
// not answering, and "not answering" is a proportion of attempts, not a count.
//
// At 10% and a 100 ms poll rate this is 60 failures — six seconds of a fully
// dead link before it backs off, while a link dropping a few percent of frames
// never trips at all. That is the intended split.
export const INPUT_READ_MAX_FAILURES_PER_WINDOW = 10;
export const INPUT_READ_MAX_FAILURE_RATIO = 0.1;
export const OUTPUT_HOLDING_RETRY_WINDOW_MS = 60_000;
export const OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW = 10;

export const BATCH_FLUSH_THRESHOLD = 5;
export const BATCH_FLUSH_INTERVAL_MS = 100;
export const KEEP_LATEST_TRIM_INTERVAL = 10;
export const PROMISE_CHAIN_RESET_INTERVAL = 100;
export const TSV_FLUSH_INTERVAL_MS = 60_000;
// Row-count flush cap for TSV saving. The writer flushes on whichever comes
// first: this many buffered rows, or TSV_FLUSH_INTERVAL_MS. This bounds the
// per-flush join()+write() cost so a single large periodic flush (which grows
// with the sampling rate) becomes many small sub-frame flushes, avoiding the
// periodic main-thread hitch at high sampling rates (e.g. 50/100 Hz). The
// interval remains the low-sampling-rate durability fallback.
export const TSV_FLUSH_MAX_ROWS = 500;
// Hard ceiling on rows held in the writer's buffer. Rows are only dropped from
// the buffer once their write has actually resolved, so a stream that keeps
// rejecting would otherwise grow it without limit until the worker died — taking
// the whole run's unwritten tail with it. At the cap the oldest rows are dropped
// and reported as data loss, which is the honest outcome: something is gone, and
// the user is told which end of the file it was.
export const TSV_MAX_BUFFERED_ROWS = 20_000;
// Cadence of the OPFS crash-recovery mirror, which the writer worker drives on
// its own timer rather than piggy-backing on the picked file's flush.
//
// Sharing that flush was the original design and it made the mirror useless for
// the case it exists for: nothing reached OPFS until the first stream flush, so
// a crash inside the first TSV_FLUSH_INTERVAL_MS left a 0-byte mirror and
// startup had nothing to offer back. The mirror's whole justification is that
// it can be written durably and cheaply as data arrives (a synchronous OPFS
// append with no swap file), so it runs at the rate the user would actually
// accept losing, while the stream keeps its performance-tuned interval.
export const TSV_MIRROR_FLUSH_INTERVAL_MS = 1_000;
// Row-count cap for the same, so a high sampling rate does not leave a second's
// worth of rows sitting in memory between ticks.
export const TSV_MIRROR_FLUSH_MAX_ROWS = 100;

// ---------------------------------------------------------------------------
// Video recording (Recording Config)
// ---------------------------------------------------------------------------

// Sizes offered in the panel, filtered at runtime by what the camera reports it
// can do (see VideoTrack.getCapabilities). Typed entry was removed: a camera
// answers with a *range* rather than a list of modes, and every size inside that
// range "succeeds" because Chromium will crop-and-scale to it — so a free-form
// field could only ever produce a number that looks accepted whether or not the
// camera has anything like it.
// The sizes UVC cameras actually offer, both aspect ratios, ordered by pixel
// count so the list reads as "bigger" downwards rather than as two lists. The
// ratio is labelled because at a glance 1280×960 and 1280×720 are the same
// number, and picking the wrong one crops the part of the rig that mattered.
// The camera's reported maximum trims this at runtime.
export const VIDEO_SIZES = [
  { width: 640, height: 480, ratio: '4:3' },
  { width: 800, height: 600, ratio: '4:3' },
  { width: 1024, height: 768, ratio: '4:3' },
  { width: 1280, height: 720, ratio: '16:9' },
  { width: 1280, height: 960, ratio: '4:3' },
  { width: 1600, height: 1200, ratio: '4:3' },
  { width: 1920, height: 1080, ratio: '16:9' },
  { width: 2048, height: 1536, ratio: '4:3' },
  { width: 2560, height: 1440, ratio: '16:9' },
  { width: 2592, height: 1944, ratio: '4:3' },
  { width: 3264, height: 2448, ratio: '4:3' },
  { width: 3840, height: 2160, ratio: '16:9' },
  { width: 4096, height: 3072, ratio: '4:3' },
  { width: 5120, height: 2880, ratio: '16:9' },
  { width: 5184, height: 3888, ratio: '4:3' },
] as const;

export const VIDEO_MIN_WIDTH = 640;
export const VIDEO_MIN_HEIGHT = 480;

/**
 * Capture rate — what the camera is asked to stream, and therefore what it
 * reserves USB bandwidth for.
 */
export const VIDEO_CAPTURE_FPS_OPTIONS = [5, 10, 15, 20, 24, 30, 60] as const;

/**
 * Recording rate — how many of those frames are written to the file.
 *
 * Separate from the capture rate for the same reason Save Rate is separate from
 * Polling Rate: they answer different questions. The capture rate is what the
 * link can carry; the recording rate is what the record needs to be useful. A
 * rig watched overnight is perfectly served by 1 fps, and writing 30 would
 * multiply the file thirtyfold to say the same thing.
 */
// Down to one frame every ten seconds. A rig watched overnight for a slow leak
// or a creeping deflection is a time-lapse, not a video, and 0.1 fps turns eight
// hours into under three thousand frames.
export const VIDEO_RECORD_FPS_OPTIONS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 24, 30, 60,
] as const;

export const VIDEO_DEFAULT_WIDTH = 1280;
export const VIDEO_DEFAULT_HEIGHT = 960;
export const VIDEO_DEFAULT_CAPTURE_FPS = 15;
export const VIDEO_DEFAULT_RECORD_FPS = 15;

/**
 * Ceiling on the recording rate when no hardware encoder could be confirmed.
 *
 * Software encoding is allowed — the capability signal is too unreliable to
 * refuse on — but it is allowed on a short leash. Every recorded frame is a
 * frame the CPU has to compress, on the machine whose polling loop must not
 * miss a deadline, so what gets limited is the rate that actually drives that
 * cost. The capture rate is left alone: it costs the camera and the bus, not
 * this CPU, and it is what keeps the preview smooth.
 */
export const VIDEO_SOFTWARE_MAX_RECORD_FPS = 5;
export const VIDEO_MIN_FPS = 1;
/** The recording rate alone goes sub-1, for time-lapse use. */
export const VIDEO_MIN_RECORD_FPS = 0.1;
export const VIDEO_MAX_FPS = 240;

// Encoder bitrate, derived rather than tabulated because the size is free-form.
// 0.07 bit per pixel per frame is around the knee for H.264 at these sizes:
// 1280x720@15 -> 1.0 Mbps, 1920x1080@30 -> 4.4 Mbps.
export const VIDEO_BITS_PER_PIXEL_FRAME = 0.07;
export const VIDEO_MIN_BITRATE = 500_000;
// A ceiling that still looks right at 4K and stops an accidental setting from
// filling the disk: 40 Mbps is ~18 GB/hour, which is a lot but not unbounded.
export const VIDEO_MAX_BITRATE = 40_000_000;

// MediaRecorder chunk interval for the file. Each chunk is appended to OPFS
// synchronously, so this is also the worst-case data loss on a crash.
export const VIDEO_CHUNK_INTERVAL_MS = 1_000;

// --- Remote streaming -------------------------------------------------------

// Separate from the file's bitrate: the recording must not lose quality because
// somebody is watching over a phone.
// The remote picture is a JPEG slideshow rather than a video stream, so what
// matters is how often a still arrives and how big it is.
//
// About one a second. Enough to see whether a rig is still turning, whether
// something has moved, whether smoke is coming off it — which is what remote
// monitoring is for. A video stream bought smoothness nobody asked for at the
// cost of every hard bug this feature had.
export const STREAM_SNAPSHOT_FPS = 1;
// Stills are scaled down to this before encoding. A 640-wide JPEG at moderate
// quality is 30-60 kB, so a frame a second is well under half a megabit even
// over a phone link.
export const STREAM_SNAPSHOT_MAX_WIDTH = 640;
export const STREAM_JPEG_QUALITY = 0.6;

// Past this much queued on the host's socket, stills are dropped rather than
// buffered. A slow link must cost the measurement nothing, and for a slideshow
// dropping is free: the next picture to get through is the current one anyway.
export const STREAM_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
