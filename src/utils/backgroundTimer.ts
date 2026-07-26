// Main-thread front end for the timer worker (see src/timerWorker.ts).
//
// A drop-in replacement for window.setTimeout / setInterval whose schedule
// survives the page being hidden or minimised, used by everything on the
// acquisition path: the polling loop, the chart batch flush, the TSV flush
// interval and the waits inside a Modbus transfer. Anything cosmetic (a UI
// debounce, an elapsed-time readout) should keep using window timers — nobody
// minds a frozen clock on a screen nobody is looking at.
//
// Which backend a timer gets is decided by page visibility, per timer, at the
// moment it is scheduled:
//
//   visible → window.setTimeout. Nothing is throttled while the page is
//             visible, so the worker would add a postMessage round trip for no
//             benefit at all. That is not free: readChunk() takes a fresh
//             timeout for every USB chunk of every frame, so at 20 Hz the
//             worker route cost two messages per chunk — some 12 ms per poll
//             cycle, which showed up directly as 20 Hz settling at 16 Hz.
//   hidden  → the worker, whose timers Chromium does not throttle.
//
// Timers already running when the page is hidden are migrated to the worker
// (their delay restarts, which costs at most one period, once, per hide).
//
// Ids come from our own counter, never from the browser's, so they are never
// mixed up with a window timer handle.

type Backend = 'window' | 'worker';

type PendingTimer = {
  fn: () => void;
  delayMs: number;
  repeat: boolean;
  backend: Backend;
  /** Only set while `backend` is 'window'. */
  handle?: number;
};

let worker: Worker | null = null;
let workerUsable = true;
let nextId = 1;

/** Live timers, keyed by our id. Entries stay for the lifetime of a repeat. */
const pending = new Map<number, PendingTimer>();

const pageVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState === 'visible';

const fire = (id: number): void => {
  const timer = pending.get(id);
  if (!timer) return;
  if (!timer.repeat) pending.delete(id);
  timer.fn();
};

const runOnWindow = (id: number, timer: PendingTimer): void => {
  timer.backend = 'window';
  timer.handle = timer.repeat
    ? window.setInterval(() => fire(id), timer.delayMs)
    : window.setTimeout(() => fire(id), timer.delayMs);
};

const stopWindowTimer = (timer: PendingTimer): void => {
  if (timer.handle === undefined) return;
  window.clearTimeout(timer.handle);
  window.clearInterval(timer.handle);
  timer.handle = undefined;
};

// The worker died (failed to load, or was killed). Losing the polling loop with
// it would stop the measurement outright and look exactly like a hung app, so
// every live timer is re-armed on window timers. Their remaining delay is not
// knowable from here, so they restart from their full delay: one late tick is a
// far better failure than a loop that never ticks again. They stay on window
// timers from then on — throttled while hidden, but running.
const fallBackToWindowTimers = (): void => {
  workerUsable = false;
  worker = null;
  for (const [id, timer] of pending) {
    if (timer.backend === 'worker') runOnWindow(id, timer);
  }
};

const ensureWorker = (): Worker | null => {
  if (!workerUsable) return null;
  if (worker) return worker;
  try {
    const created = new Worker(new URL('../timerWorker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (event: MessageEvent<{ id: number }>) => fire(event.data.id);
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

const runOnWorker = (id: number, timer: PendingTimer): void => {
  const active = ensureWorker();
  if (!active) {
    runOnWindow(id, timer);
    return;
  }
  timer.backend = 'worker';
  active.postMessage({ type: 'set', id, delayMs: timer.delayMs, repeat: timer.repeat });
};

// Going hidden is exactly when window timers start being throttled, so anything
// still pending on one moves across. Coming back visible is left alone: those
// timers are correct where they are, and every hot-path timer is short-lived
// enough to be re-created on the window backend within milliseconds.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (pageVisible()) return;
    for (const [id, timer] of pending) {
      if (timer.backend !== 'window') continue;
      stopWindowTimer(timer);
      runOnWorker(id, timer);
    }
  });
}

const schedule = (fn: () => void, delayMs: number, repeat: boolean): number => {
  const id = nextId++;
  const timer: PendingTimer = { fn, delayMs, repeat, backend: 'window' };
  pending.set(id, timer);
  if (pageVisible()) runOnWindow(id, timer);
  else runOnWorker(id, timer);
  return id;
};

const cancel = (id: number | undefined): void => {
  if (id === undefined) return;
  const timer = pending.get(id);
  if (!timer) return;
  pending.delete(id);
  if (timer.backend === 'window') {
    stopWindowTimer(timer);
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
