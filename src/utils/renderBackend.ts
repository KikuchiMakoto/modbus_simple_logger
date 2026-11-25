import { useSyncExternalStore } from 'react';

// Rendering backend actually used by ModbusSimplePlotter (`WebGL2` GPU or
// `Canvas2D` CPU fallback when WebGL2 is unavailable, lost, or backed by a
// software rasterizer such as SwiftShader/llvmpipe).
export type RenderBackend = { api: string; accel: 'GPU' | 'CPU' | ''; detail: string };

// Module-level store instead of React state: the charts detect the backend but
// App Info and App's redraw-floor heuristic consume it across unrelated subtrees.
let current: RenderBackend | null = null;
const listeners = new Set<() => void>();

function same(a: RenderBackend | null, b: RenderBackend) {
  return !!a && a.api === b.api && a.accel === b.accel && a.detail === b.detail;
}

export function reportRenderBackend(next: RenderBackend) {
  if (same(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRenderBackend(): RenderBackend | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
