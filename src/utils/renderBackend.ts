import { useSyncExternalStore } from 'react';

// Rendering backend that Plotly actually used. `scattergl` is a WebGL/regl
// trace, so on a healthy machine this reports GPU-backed WebGL; if the browser
// falls back to a software rasterizer (SwiftShader/llvmpipe) it reports CPU so
// the degradation is visible rather than silent.
export type RenderBackend = { api: string; accel: 'GPU' | 'CPU' | ''; detail: string };

function describe(gl: WebGLRenderingContext | WebGL2RenderingContext, api: string): RenderBackend {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg
    ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
    : String(gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(renderer);
  return { api, accel: software ? 'CPU' : 'GPU', detail: renderer };
}

// getContext() only returns the context that was actually created, so both
// types are probed — asking for 'webgl2' on a 'webgl' canvas yields null.
function contextOf(canvas: HTMLCanvasElement): { gl: WebGLRenderingContext | WebGL2RenderingContext; api: string } | null {
  const gl2 = canvas.getContext('webgl2');
  if (gl2) return { gl: gl2, api: 'WebGL2' };
  const gl1 = (canvas.getContext('webgl') ||
    canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
  if (gl1) return { gl: gl1, api: 'WebGL' };
  return null;
}

/** Inspect the canvas Plotly rendered into. */
export function detectRenderBackend(graphDiv: HTMLElement): RenderBackend {
  const canvas = graphDiv.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return { api: 'SVG/Canvas2D', accel: '', detail: 'no WebGL canvas' };

  const ctx = contextOf(canvas);
  if (!ctx) return { api: 'Canvas2D', accel: 'CPU', detail: 'no WebGL context' };
  return describe(ctx.gl, ctx.api);
}

/**
 * Backend the browser would give a scattergl chart, measured on a throwaway
 * canvas. Used when App Info is opened before any chart has rendered (no data
 * yet). The context is dropped immediately: the per-page WebGL context budget
 * is ~8-16 and the live charts need all of it.
 */
export function probeRenderBackend(): RenderBackend {
  const canvas = document.createElement('canvas');
  const ctx = contextOf(canvas);
  if (!ctx) return { api: 'Canvas2D', accel: 'CPU', detail: 'no WebGL context' };
  try {
    return describe(ctx.gl, ctx.api);
  } finally {
    ctx.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

// Module-level store instead of React state: the charts detect the backend but
// App Info displays it, and they are unrelated subtrees. Passing it up through
// App would add a prop path for a value nothing else consumes.
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
