// Single-instance lock for the desktop exe.
//
// Two copies of the launcher are never useful and are actively harmful: only
// one of them can own the viewer port (viewerServer.ts picks a winner), only one can
// own the browser profile directory's main process, and — the reason this
// matters most — each one opens its own app window while exactly one serial
// port exists. Double-clicking the exe again while it is running is an
// accident, not a request for a second logger.
//
// The lock is a loopback TCP listener rather than a lock file: the OS releases
// it when the process dies, however it dies, so a crash or a kill from Task
// Manager can never leave a stale lock that keeps the app from starting again.
const LOCK_PORT = 8764;
// Identifies the listener as ours. A fixed port can always be squatted by an
// unrelated program, and refusing to start because *something* holds 8764 would
// be a worse failure than running twice — so the port is only treated as a lock
// when whatever answers on it says this.
const LOCK_MARKER = 'modbus-simple-logger-instance-lock';

export type InstanceLock = { release: () => void };

export type LockResult =
  /** This process now holds the lock. */
  | { held: true; lock: InstanceLock }
  /** Another launcher instance is already running; do not start. */
  | { held: false; lock: null }
  /**
   * The port is taken by something that is not us. Start anyway (unlocked) —
   * an unrelated service on 8764 must not make the app unlaunchable.
   */
  | { held: true; lock: null };

/** Probe the port to see whether the thing holding it is another launcher. */
const isOurLock = async (): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCK_PORT}/`, {
      signal: AbortSignal.timeout(1000),
    });
    return (await response.text()).trim() === LOCK_MARKER;
  } catch {
    // Not speaking HTTP, or gone in the meantime: not ours.
    return false;
  }
};

/**
 * Claim the single-instance lock. `{ held: false }` means another instance owns
 * it and this process should tell the user and exit.
 */
export const acquireInstanceLock = async (): Promise<LockResult> => {
  try {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: LOCK_PORT,
      // The lock is the bound port itself; this body exists only so a second
      // instance can recognise the listener as one of ours.
      fetch: () => new Response(LOCK_MARKER, { status: 200 }),
    });
    return { held: true, lock: { release: () => server.stop(true) } };
  } catch {
    // EADDRINUSE — either a running instance or an unrelated squatter.
    return (await isOurLock()) ? { held: false, lock: null } : { held: true, lock: null };
  }
};
