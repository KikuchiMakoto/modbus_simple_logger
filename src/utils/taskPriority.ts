// Prioritized Task Scheduling (scheduler.postTask), used to push display work
// behind acquisition work in the browser's own task queues.
//
// Chromium-only, which costs nothing here: WebSerial already confines this app
// to Chromium. Where it is missing the callback runs inline, which is exactly
// the behaviour that existed before any of this — a task with no stated
// priority, dispatched immediately.
//
// The three priorities, as Chromium orders them:
//
//   user-blocking  ahead of ordinary tasks
//   user-visible   what a setTimeout callback effectively is (the default)
//   background     behind everything else, run when nothing better is queued
//
// Note what this does NOT do: it orders tasks that have not started, it does not
// interrupt one that has. A Plotly redraw already underway will hold the thread
// for as long as it takes at any priority, which is why the caller also has to
// choose the moment it starts — see the poll-in-flight fence in App.tsx.

export type TaskPriority = 'user-blocking' | 'user-visible' | 'background';

type SchedulerLike = {
  postTask: (
    callback: () => void,
    options?: { priority?: TaskPriority; delay?: number; signal?: AbortSignal },
  ) => Promise<unknown>;
};

const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;

/** Whether the browser actually has the API. Exported for diagnostics. */
export const taskPrioritySupported = typeof scheduler?.postTask === 'function';

/**
 * Queue `fn` at `priority`, or run it inline where the API is missing.
 *
 * For LOWERING priority. There is deliberately no helper for raising it: the
 * acquisition loop is dispatched straight from its timer callback, so it is
 * already running at the first opportunity the event loop offers — handing it to
 * postTask could only add a task hop, and 'user-blocking' cannot beat "already
 * executing". Making the display yield is the whole mechanism.
 */
export function runAtPriority(fn: () => void, priority: TaskPriority): void {
  if (!taskPrioritySupported) {
    fn();
    return;
  }
  // The returned promise rejects if the task is aborted; nothing here aborts,
  // but an unhandled rejection would still be reported.
  void scheduler!.postTask(fn, { priority }).catch(() => {});
}
