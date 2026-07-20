/**
 * Runtime detection for the Tauri host.
 *
 * Tauri 2 injects a `__TAURI_INTERNALS__` object on `window` whenever the
 * webview is loaded inside the Tauri shell. This is independent of
 * `withGlobalTauri` and is safe to use even when the global JS API is
 * disabled (which is the default in this project — invoke is imported from
 * `@tauri-apps/api/core`).
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
