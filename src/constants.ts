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
export const CHART_MAX_POINTS = 1024;
export const NON_SAVING_CHART_WINDOW_MS = 60_000;
// Minimum interval between chart redraws (setDisplayRevision bumps). Chart data
// flushes ~10x/s, but redrawing all 4 scattergl charts that often is wasteful
// and feeds WebGL/regl resource churn. Coalescing redraws to ~5 fps keeps the
// live view responsive while cutting steady GPU/React cost roughly in half.
export const CHART_REDRAW_INTERVAL_MS = 200;
// Periodic full chart rebuild (Plotly purge + fresh mount). Plotly.react reuses
// its WebGL/regl resources across in-place updates, and scattergl is known to
// accumulate GPU-side state over many updates — the one remaining way long
// sessions could get progressively heavier. Rebuilding at the save-path
// re-decimation (a natural visual discontinuity where half the points are
// dropped anyway) and at latest every this many ms of continuous plotting
// bounds that accumulation. Re-decimation intervals double each time (~100 s,
// ~200 s, ... at 20 Hz), so the time fallback covers the late-save and
// not-saving phases where re-decimations no longer occur.
export const CHART_PURGE_INTERVAL_MS = 15 * 60_000;

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
