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
// redraw rate (2 fps — see CHART_REDRAW_INTERVAL_MS). Deliberately conservative — the headroom has not been
// measured on-device yet (docs/chart-library-comparison.md §11-1), so this is a
// doubling rather than the 8192 the hardware may well allow.
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
// not. Chart data flushes up to 10x/s and redrawing four scattergl charts that
// often is wasteful and feeds WebGL/regl resource churn; 2 fps is plenty for a
// preview and keeps the steady GPU/React cost off the acquisition loop, which
// is the competition that matters. Recording is unaffected either way.
//
// One constant, not one per mode: the saving case used to be slower (500 vs
// 200 ms) on the argument that a whole-capture view moves less per sample, but
// the same is true of a 768-point preview, and two numbers only ever meant two
// things to reason about.
//
// This is a FLOOR, not a period. A redraw is only armed by a flush that
// actually added a point to the chart buffer (see flushPendingDataPoints), so
// late in a save — where the decimation stride means a new point every few
// seconds — the redraw rate follows the points rather than this constant.
export const CHART_REDRAW_INTERVAL_MS = 500;
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
