export const AI_CHANNELS = 16;
export const AO_CHANNELS = 8;
export const PARAM_CHANNELS = 16;

export const AI_START_REGISTER = 0;
export const AI_FLOAT_START_REGISTER = 5000;
export const AO_START_REGISTER = 0;

// IndexedDB retention while NOT saving (session FIFO store, independent of the
// on-screen chart).
export const MAX_POINTS_IN_MEMORY = 256;

// On-screen chart display budget. The chart never renders more than this many
// points: while not saving it shows a ~NON_SAVING_CHART_WINDOW_MS sliding time
// window; while saving it downsamples the whole capture (save-start → now) to
// this budget. The full data is always written to TSV regardless.
// Raised 1024 → 2048 in v3.1, funded by disabling the scattergl hover pick-index
// (`hoverinfo: 'skip'`, see ChartPanel.tsx): that index is rebuilt per update and
// its cost scales with this constant, so removing it buys headroom at the same
// ~5 fps redraw rate. Deliberately conservative — the headroom has not been
// measured on-device yet (docs/chart-library-comparison.md §11-1), so this is a
// doubling rather than the 8192 the hardware may well allow.
export const CHART_MAX_POINTS = 2048;
export const NON_SAVING_CHART_WINDOW_MS = 60_000;
// Minimum interval between chart redraws (setDisplayRevision bumps). Chart data
// flushes ~10x/s, but redrawing all 4 scattergl charts that often is wasteful
// and feeds WebGL/regl resource churn. Coalescing redraws to ~5 fps keeps the
// live view responsive while cutting steady GPU/React cost roughly in half.
export const CHART_REDRAW_INTERVAL_MS = 200;
// How often per-sample readouts (measured rate, saved-point count) are pushed
// into React state. They are numbers a human reads, so 4/s is already more than
// anyone can follow — while a state update per sample put a full re-render of
// the channel cards between two Modbus transfers, turning display cost into
// polling jitter. The underlying values are exact and kept in refs; only the
// publishing is on a budget.
export const READOUT_PUBLISH_INTERVAL_MS = 250;
// Floor on how often the AI channel cards are refreshed, applied only when
// polling faster than this (at the default 200 ms nothing changes). A publish
// re-renders every channel card, and at 20 Hz that render lands between two
// Modbus transfers — display cost turning straight into polling jitter, which
// is the one trade this app must never make. 10 Hz is already past what anyone
// can read off a moving number. Raise it to 0 to go back to one render per
// sample; the recorded data is unaffected either way.
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

export const RETRY_DELAY_MS = 10;
export const INPUT_READ_RETRY_WINDOW_MS = 60_000;
export const INPUT_READ_MAX_FAILURES_PER_WINDOW = 10;
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
