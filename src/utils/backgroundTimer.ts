// Main-thread front end for the timer worker (see src/timerWorker.ts).
//
// A drop-in replacement for window.setTimeout / setInterval whose schedule
// survives the page being hidden or minimised, used by everything on the
// acquisition path: the polling loop, the chart batch flush and the TSV flush
// interval. Anything cosmetic (a UI debounce, an elapsed-time readout) should
// keep using window timers — they are cheaper and nobody minds a frozen clock
// on a screen nobody is looking at.
//
// Ids come from our own counter, never from the browser's, so they are never
// mixed up with a window timer handle.

type PendingTimer = { fn: () => void; delayMs: number; repeat: boolean };

let worker: Worker | null = null;
let workerUsable = true;
let nextId = 1;

/** Live timers, keyed by our id. Entries stay for the lifetime of a repeat. */
const pending = new Map<number, PendingTimer>();
/** Timers running on window fallback, our id → the window handle. */
const fallbackHandles = new Map<number, number>();

const runFallback = (id: number, timer: PendingTimer): void => {
  if (timer.repeat) {
    fallbackHandles.set(id, window.setInterval(timer.fn, timer.delayMs));
    return;
  }
  fallbackHandles.set(
    id,
    window.setTimeout(() => {
      fallbackHandles.delete(id);
      pending.delete(id);
      timer.fn();
    }, timer.delayMs),
  );
};

// The worker died (failed to load, or was killed). Losing the polling loop with
// it would stop the measurement outright and look exactly like a hung app, so
// every live timer is re-armed on window timers. Their remaining delay is not
// knowable from here, so they restart from their full delay: one late tick is a
// far better failure than a loop that never ticks again.
const fallBackToWindowTimers = (): void => {
  workerUsable = false;
  worker = null;
  for (const [id, timer] of pending) runFallback(id, timer);
};

const ensureWorker = (): Worker | null => {
  if (!workerUsable) return null;
  if (worker) return worker;
  try {
    const created = new Worker(new URL('../timerWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<{ id: number }>) => {
      const timer = pending.get(event.data.id);
      if (!timer) return;
      if (!timer.repeat) pending.delete(event.data.id);
      timer.fn();
    };
    created.onerror = () => {
      created.terminate();
      fallBackToWindowTimers();
    };
    worker = created;
    return worker;
  } catch {
    workerUsable = false;
    return null;
  }
};

const schedule = (fn: () => void, delayMs: number, repeat: boolean): number => {
  const id = nextId++;
  const timer: PendingTimer = { fn, delayMs, repeat };
  pending.set(id, timer);

  const active = ensureWorker();
  if (!active) {
    runFallback(id, timer);
    return id;
  }
  active.postMessage({ type: 'set', id, delayMs, repeat });
  return id;
};

const cancel = (id: number | undefined): void => {
  if (id === undefined) return;
  pending.delete(id);
  const fallback = fallbackHandles.get(id);
  if (fallback !== undefined) {
    fallbackHandles.delete(id);
    window.clearInterval(fallback);
    window.clearTimeout(fallback);
    return;
  }
  worker?.postMessage({ type: 'clear', id });
};

export const setBackgroundTimeout = (fn: () => void, delayMs: number): number =>
  schedule(fn, delayMs, false);

export const setBackgroundInterval = (fn: () => void, delayMs: number): number =>
  schedule(fn, delayMs, true);

/** Cancels a timeout or an interval; a stale or undefined id is a no-op. */
export const clearBackgroundTimer = (id: number | undefined): void => cancel(id);
