// Timer worker: schedules setTimeout / setInterval off the main thread.
//
// Why this exists: Chromium throttles timers of a page that is not visible —
// 1 Hz for a background tab, and after ~5 minutes hidden the "intensive"
// policy drops chained timers to 1 per minute. For a data logger that is fatal:
// minimise the window during a long capture and a 200 ms polling loop silently
// becomes a 60 s one, leaving a gap in the measurement that no amount of
// catch-up can fill.
//
// Timers owned by a dedicated worker are exempt from that throttling, so the
// *scheduling* lives here and only the callback runs on the main thread (see
// utils/backgroundTimer.ts). The desktop launcher additionally disables
// throttling at the browser level (launcher/browser.ts) — this covers the
// static web / PWA deployment, where there are no browser flags to pass.
//
// Note what this does NOT change: the callback still runs on the main thread,
// so a page the browser has fully frozen still cannot poll. Keeping the page
// out of that state is the wake lock's job (App.tsx / launcher/keepAwake.ts).
type TimerRequest =
  | { type: 'set'; id: number; delayMs: number; repeat: boolean }
  | { type: 'clear'; id: number };

// Our id (assigned by the main thread) → the worker's own timer handle.
const handles = new Map<number, number>();

const clear = (id: number): void => {
  const handle = handles.get(id);
  if (handle === undefined) return;
  handles.delete(id);
  // A one-shot handle has already fired and been dropped by then, so this is
  // only ever called on a live handle; clearInterval/clearTimeout are
  // interchangeable for the underlying id.
  clearInterval(handle);
};

self.onmessage = (event: MessageEvent<TimerRequest>) => {
  const request = event.data;

  if (request.type === 'clear') {
    clear(request.id);
    return;
  }

  if (request.repeat) {
    handles.set(
      request.id,
      self.setInterval(() => self.postMessage({ id: request.id }), request.delayMs),
    );
    return;
  }

  handles.set(
    request.id,
    self.setTimeout(() => {
      handles.delete(request.id);
      self.postMessage({ id: request.id });
    }, request.delayMs),
  );
};
