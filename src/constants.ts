export const AI_CHANNELS = 16;
export const AO_CHANNELS = 8;
export const PARAM_CHANNELS = 8;

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
export const CHART_MAX_POINTS = 4096;
export const NON_SAVING_CHART_WINDOW_MS = 60_000;

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
