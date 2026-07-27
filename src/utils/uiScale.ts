import { useSyncExternalStore } from 'react';
import { readJsonStorage, writeLocalPreference } from './cookies';

// UI scale, in percent, applied as CSS `zoom` on #root (see index.css).
//
// Why an in-app control rather than reading the OS scaling factor: the browser
// never exposes it. devicePixelRatio is the only candidate and it conflates
// three separate things — the OS scaling factor, the browser's own zoom level,
// and the panel's hardware pixel density — so 1.25 could equally mean "Windows
// at 125%", "Chrome at 125%" or "a 1.25x-DPI screen at 100%". Deriving a zoom
// from it would double-apply the OS scaling on every machine where the browser
// already honours it, which is all of them.
//
// Why `zoom` rather than `transform: scale()`: zoom participates in layout, so
// the page reflows to the new size and the scrollable area stays correct. A
// transform only paints the same layout larger, which puts the right-hand edge
// of the page outside the viewport with no way to scroll to it. Both are
// pointer-coordinate hazards for react-rnd, but zoom is the one the drag maths
// can be corrected for (see FloatingWindow's `scale` prop).
//
// Support: Chrome/Edge/Safari always, Firefox since 126. That covers every
// browser this app runs in on Windows, macOS, Linux and Android.

const UI_SCALE_KEY = 'ui_scale_v1';

export const UI_SCALE_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
export const DEFAULT_UI_SCALE = 100;

const isBrowser = typeof window !== 'undefined';

/** Snap an arbitrary percentage to the nearest offered step. */
const nearestStep = (percent: number): number =>
  UI_SCALE_STEPS.reduce(
    (best, step) => (Math.abs(step - percent) < Math.abs(best - percent) ? step : best),
    DEFAULT_UI_SCALE,
  );

function loadUiScale(): number {
  const stored = readJsonStorage<number>(UI_SCALE_KEY);
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return DEFAULT_UI_SCALE;
  return nearestStep(stored);
}

let current = isBrowser ? loadUiScale() : DEFAULT_UI_SCALE;
const listeners = new Set<() => void>();

/** Current scale in percent (50-200). */
export const getUiScalePercent = (): number => current;

/** Current scale as the factor used by CSS zoom and by pointer maths (0.5-2). */
export const getUiScale = (): number => current / 100;

function applyUiScale() {
  if (!isBrowser) return;
  // setProperty with an empty value removes the declaration, so at 100% the
  // `var(--ui-scale, 1)` in index.css falls back to zoom's initial value and
  // the default configuration is byte-for-byte the unzoomed page.
  document.documentElement.style.setProperty(
    '--ui-scale',
    current === 100 ? '' : String(getUiScale()),
  );
}

/**
 * Apply the stored scale. Called from main.tsx before React renders, so the
 * first paint is already at the user's size — restoring it after mount would
 * show one frame at 100% and reflow the whole page.
 */
export function initUiScale() {
  applyUiScale();
}

export function setUiScalePercent(percent: number) {
  const next = nearestStep(percent);
  if (next === current) return;
  current = next;
  writeLocalPreference(UI_SCALE_KEY, next);
  applyUiScale();
  for (const listener of listeners) listener();

  // Plotly sizes its canvas from the measured width of the graph div and only
  // re-measures on a window resize; zoom changes that width without resizing
  // the window, so the chart would keep the old canvas size until the next
  // real resize. The event goes out after a frame, once layout has settled at
  // the new zoom — dispatched synchronously it would measure the old size.
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

/** Move `delta` steps along UI_SCALE_STEPS, clamped at both ends. */
export function stepUiScale(delta: number) {
  const index = UI_SCALE_STEPS.indexOf(current);
  const next = UI_SCALE_STEPS[Math.min(UI_SCALE_STEPS.length - 1, Math.max(0, index + delta))];
  setUiScalePercent(next);
}

export const canStepUiScale = (delta: number): boolean => {
  const index = UI_SCALE_STEPS.indexOf(current);
  return index + delta >= 0 && index + delta < UI_SCALE_STEPS.length;
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current scale in percent, re-rendering the caller when it changes. */
export function useUiScalePercent(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_UI_SCALE,
  );
}
