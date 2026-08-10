// OS-level sleep suppression for the desktop exe.
//
// The page already takes a Screen Wake Lock while acquiring (App.tsx), but that
// only holds while the page is *visible*: minimise the window and Windows is
// free to sleep in the middle of a capture. The launcher process, on the other
// hand, is always there and has no visibility state — so on Windows it tells
// the power manager directly, via SetThreadExecutionState:
//
//   ES_CONTINUOUS       the state persists until it is cleared, rather than
//                       applying to this one call;
//   ES_SYSTEM_REQUIRED  no system sleep — the part the wake lock cannot do;
//   ES_DISPLAY_REQUIRED no display sleep, which also keeps the lock screen (and
//                       its "page hidden" side effects) away.
//
// It is armed and cleared by the page over the __feed socket, so the suppression
// tracks an actual measurement rather than the app merely being open: nobody
// wants an idle window on a laptop to keep it awake all night.
//
// Windows-only by design. The Linux equivalents all mean taking a dependency on
// whichever inhibitor the desktop session happens to run (systemd-logind,
// GNOME, KDE), and the exe is a Windows deliverable.
import { dlopen, FFIType } from 'bun:ffi';

const ES_CONTINUOUS = 0x80000000;
const ES_SYSTEM_REQUIRED = 0x00000001;
const ES_DISPLAY_REQUIRED = 0x00000002;

type Kernel32 = { symbols: { SetThreadExecutionState: (flags: number) => number } };

let kernel32: Kernel32 | null = null;
let loadFailed = false;
let active = false;

const load = (): Kernel32 | null => {
  if (kernel32 || loadFailed) return kernel32;
  if (process.platform !== 'win32') {
    loadFailed = true;
    return null;
  }
  try {
    kernel32 = dlopen('kernel32.dll', {
      SetThreadExecutionState: { args: [FFIType.u32], returns: FFIType.u32 },
    }) as unknown as Kernel32;
    return kernel32;
  } catch (err) {
    // No FFI available, or the symbol is missing. Sleep suppression is a
    // convenience; never let its absence take the launcher down with it.
    console.error('Sleep suppression unavailable:', err);
    loadFailed = true;
    return null;
  }
};

/**
 * Keep the machine (and its display) awake, or stop doing so. Idempotent — the
 * page re-sends its current state on every reconnect.
 *
 * The execution state is per-thread and this always runs on the launcher's main
 * JS thread, which lives as long as the process, so a state set here stays set
 * until it is cleared here.
 */
export const setKeepAwake = (enabled: boolean): void => {
  if (enabled === active) return;
  const lib = load();
  if (!lib) return;
  try {
    // Returns the previous execution state, or 0 on failure.
    const previous = lib.symbols.SetThreadExecutionState(
      enabled
        ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
        : // ES_CONTINUOUS alone clears the requirements and restores normal
          // idle behaviour.
          ES_CONTINUOUS,
    );
    if (previous === 0) {
      console.error('SetThreadExecutionState refused the request; sleep is not being suppressed.');
      return;
    }
    active = enabled;
  } catch (err) {
    console.error('SetThreadExecutionState failed:', err);
  }
};
