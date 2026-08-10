// Messages between the main thread and a script worker.
//
// Extracted from pyodideWorker/useScriptRunner when BASIC and Lua joined
// Python: the runtimes have nothing in common, but the *contract* is identical
// — receive shared buffers, run a string, report what happened, and ask the main
// thread to perform the side effects a worker cannot (AO writes, tare).
//
// Only Pyodide is left, so there is currently one worker on each end of this
// contract. It stays a shared module rather than being folded back into either
// side because both ends have to agree on it, and for a while they did not:
// each had its own hand-written copy of these unions and its own bare `2` for
// the interrupt byte, which is exactly the drift this file exists to prevent.
//
// The instrument API is deliberately split the same way in every language:
//   - reads are synchronous, straight out of the SharedArrayBuffers the polling
//     loop publishes into;
//   - writes are messages, because the Modbus transfer mutex and the minimum
//     inter-frame interval live on the main thread and must not be bypassed.

export type ScriptWorkerRequest =
  /** Hand over the shared buffers. Sent once, when the worker is created. */
  | {
      type: 'init';
      rawSab: SharedArrayBuffer;
      phySab: SharedArrayBuffer;
      aoSab: SharedArrayBuffer;
      paramSab: SharedArrayBuffer;
      intSab: SharedArrayBuffer;
    }
  | { type: 'run'; code: string }
  /**
   * Stop request. The main thread also writes 2 into the interrupt buffer
   * before sending this: a runtime busy in a tight loop never reaches its
   * message queue, so the shared byte is the only thing that can reach it.
   */
  | { type: 'interrupt' };

export type ScriptWorkerResponse =
  /** One-line runtime state for the status bar ("Initializing...", "Ready"). */
  | { type: 'status'; message: string }
  | { type: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'done'; message?: string }
  | { type: 'interrupted'; message?: string }
  /** `message` is the one-line summary; `traceback` the full detail, if any. */
  | { type: 'error'; message: string; traceback?: string }
  /** Volts. Routed through the main thread's AO write path, never direct. */
  | { type: 'set_ao'; ch: number; data: number }
  | { type: 'set_ai_tare'; ch: number }
  /** Free-text label for a Param channel, persisted like a UI edit. Empty text clears it. */
  | { type: 'set_param_label'; ch: number; text: string };

/**
 * Interrupt buffer states. One byte, shared, polled by the runtime.
 *
 * `PENDING` exists for the window before a run starts: a Stop pressed while a
 * runtime is still booting has nothing to interrupt yet, so it is left armed
 * for the run branch to honour instead of being dropped.
 */
export const INTERRUPT_NONE = 0;
export const INTERRUPT_PENDING = 2;
