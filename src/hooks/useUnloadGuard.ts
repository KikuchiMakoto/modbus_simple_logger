import { useEffect } from 'react';

/**
 * Guards against an accidental reload/close while a save is running.
 *
 * Two layers, both Chrome/Edge only (which is all this app targets):
 *
 * 1. `beforeunload` — the browser's own "Leave site?" dialog. Fires for reload,
 *    tab close, window close and back-navigation, i.e. everything the keydown
 *    layer cannot see. The message string is ignored by modern browsers; only
 *    `preventDefault()` matters.
 * 2. `keydown` — swallows F5 / Ctrl+R / Ctrl+Shift+R before the browser acts on
 *    them, so the most common misfire never even reaches the dialog. Ctrl+W and
 *    Ctrl+F4 are NOT interceptable from a page (the browser handles them above
 *    the document); those fall through to layer 1.
 *
 * Deliberately not doing pagehide / visibilitychange / Page Lifecycle here:
 * they fire after the decision is already made, and hooking them risks the
 * background-timer throttling problems this app already works around.
 */
export function useUnloadGuard(active: boolean, message = 'Saving is in progress.'): void {
  useEffect(() => {
    if (!active) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy Chrome path — harmless, and required for the prompt in some
      // older builds. The text itself is never shown.
      e.returnValue = message;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isReloadKey =
        e.key === 'F5' ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'));
      if (!isReloadKey) return;
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    // Capture phase, so an input/editor that stops propagation cannot let the
    // reload through first.
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [active, message]);
}
