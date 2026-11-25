import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ModbusSimplePlotter } from '../src/modbus_simple_plotter';
import type { DataPoint } from '../src/types';

function makePoints(n: number, yFn: (i: number) => number): DataPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    seq: i,
    timestamp: 1_795_590_000_000 + i * 100,
    aiRaw: Float32Array.of(i),
    aiPhysical: Float32Array.of(yFn(i)),
    param: Float32Array.of(0),
  }));
}

interface FakeGlTracker {
  drawCalls: number[];
  uploadedFloats: number;
  lostCalled: number;
  deletedBuffers: number;
  deletedVaos: number;
  deletedPrograms: number;
}

interface Fake2dTracker {
  moveTos: number;
  lineTos: number;
  strokes: number;
  fillTexts: string[];
}

function installFakeDom(options: {
  webglAvailable: boolean;
  rendererString?: string;
}) {
  const glTracker: FakeGlTracker = {
    drawCalls: [],
    uploadedFloats: 0,
    lostCalled: 0,
    deletedBuffers: 0,
    deletedVaos: 0,
    deletedPrograms: 0,
  };
  const twoDTracker: Fake2dTracker = {
    moveTos: 0,
    lineTos: 0,
    strokes: 0,
    fillTexts: [],
  };

  let createdLineCanvas: FakeCanvas | null = null;
  let canvasCount = 0;

  class FakeCanvas {
    readonly isBgCanvas = canvasCount++ === 0;
    width = 0;
    height = 0;
    style: Record<string, string> = { cssText: '' };
    private boundMode: '2d' | 'webgl2' | null = null;
    private listeners = new Map<string, Set<(e: Event) => void>>();

    addEventListener(type: string, fn: (e: Event) => void) {
      let set = this.listeners.get(type);
      if (!set) {
        set = new Set();
        this.listeners.set(type, set);
      }
      set.add(fn);
    }

    removeEventListener(type: string, fn: (e: Event) => void) {
      this.listeners.get(type)?.delete(fn);
    }

    dispatchEvent(type: string, ev: Event) {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }

    replaceWith(next: FakeCanvas) {
      createdLineCanvas = next;
    }

    getContext(kind: string) {
      if (this.boundMode && this.boundMode !== kind) return null;
      if (kind === 'webgl2') {
        if (!options.webglAvailable) return null;
        this.boundMode = 'webgl2';
        createdLineCanvas = this;
        let lost = false;
        const UNMASKED_RENDERER_WEBGL = 0x9246;
        return {
          VERTEX_SHADER: 0x8b31,
          FRAGMENT_SHADER: 0x8b30,
          COMPILE_STATUS: 0x8b81,
          LINK_STATUS: 0x8b82,
          ARRAY_BUFFER: 0x8892,
          DYNAMIC_DRAW: 0x88e8,
          FLOAT: 0x1406,
          BLEND: 0x0be2,
          ONE: 1,
          ONE_MINUS_SRC_ALPHA: 0x0303,
          COLOR_BUFFER_BIT: 0x4000,
          TRIANGLES: 0x0004,
          RENDERER: 0x1f01,
          createShader: () => ({}),
          shaderSource: () => {},
          compileShader: () => {},
          getShaderParameter: () => true,
          deleteShader: () => {},
          createProgram: () => ({}),
          attachShader: () => {},
          linkProgram: () => {},
          getProgramParameter: () => true,
          deleteProgram: () => { glTracker.deletedPrograms += 1; },
          createVertexArray: () => ({}),
          deleteVertexArray: () => { glTracker.deletedVaos += 1; },
          createBuffer: () => ({}),
          deleteBuffer: () => { glTracker.deletedBuffers += 1; },
          bindVertexArray: () => {},
          bindBuffer: () => {},
          enableVertexAttribArray: () => {},
          vertexAttribPointer: () => {},
          vertexAttribDivisor: () => {},
          enable: () => {},
          blendFunc: () => {},
          getUniformLocation: (_p: unknown, name: string) => name,
          getExtension: (ext: string) => {
            if (ext === 'WEBGL_debug_renderer_info') {
              return { UNMASKED_RENDERER_WEBGL };
            }
            if (ext === 'WEBGL_lose_context') {
              return {
                loseContext: () => {
                  lost = true;
                  glTracker.lostCalled += 1;
                },
              };
            }
            return null;
          },
          getParameter: () => options.rendererString ?? 'ANGLE (Intel UHD Graphics)',
          isContextLost: () => lost,
          viewport: () => {},
          clearColor: () => {},
          clear: () => {},
          useProgram: () => {},
          bufferData: () => {},
          bufferSubData: (_target: number, _offset: number, view: Float32Array) => {
            glTracker.uploadedFloats = view.length;
          },
          uniform2f: () => {},
          uniform1f: () => {},
          uniform4f: () => {},
          drawArraysInstanced: (_mode: number, _first: number, _count: number, instanceCount: number) => {
            glTracker.drawCalls.push(instanceCount);
          },
        };
      }
      if (kind === '2d') {
        this.boundMode = '2d';
        const isLineCanvas = !this.isBgCanvas;
        return {
          font: '',
          fillStyle: '',
          strokeStyle: '',
          lineWidth: 1,
          lineJoin: 'miter',
          lineCap: 'butt',
          textAlign: 'left',
          textBaseline: 'alphabetic',
          setTransform: () => {},
          fillRect: () => {},
          strokeRect: () => {},
          clearRect: () => {},
          beginPath: () => {},
          moveTo: () => { if (isLineCanvas) twoDTracker.moveTos += 1; },
          lineTo: () => { if (isLineCanvas) twoDTracker.lineTos += 1; },
          stroke: () => { if (isLineCanvas) twoDTracker.strokes += 1; },
          measureText: (txt: string) => ({ width: txt.length * 6 }),
          fillText: (txt: string) => { twoDTracker.fillTexts.push(txt); },
          save: () => {},
          restore: () => {},
          translate: () => {},
          rotate: () => {},
        };
      }
      return null;
    }
  }

  class FakeContainer {
    clientWidth = 600;
    clientHeight = 240;
    children: unknown[] = [];
    replaceChildren(...nodes: unknown[]) {
      this.children = nodes;
    }
  }

  const origDoc = globalThis.document;
  const origWin = globalThis.window;

  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') return new FakeCanvas();
      throw new Error(`Unexpected tag ${tag}`);
    },
  };
  (globalThis as unknown as { window: unknown }).window = {
    devicePixelRatio: 1,
  };

  return {
    container: new FakeContainer() as unknown as HTMLElement,
    glTracker,
    twoDTracker,
    triggerContextLost: () => {
      createdLineCanvas?.dispatchEvent('webglcontextlost', {
        preventDefault: () => {},
      } as unknown as Event);
    },
    restore: () => {
      (globalThis as unknown as { document: unknown }).document = origDoc;
      (globalThis as unknown as { window: unknown }).window = origWin;
    },
  };
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  cleanup = null;
});

afterEach(() => {
  cleanup?.();
});

describe('ModbusSimplePlotter', () => {
  test('renders 8192 points without decimation on hardware WebGL2 and cleans up on dispose', () => {
    const env = installFakeDom({
      webglAvailable: true,
      rendererString: 'ANGLE (Intel, Intel(R) UHD Graphics, D3D11)',
    });
    cleanup = env.restore;

    const plotter = new ModbusSimplePlotter(env.container);
    expect(plotter.getMode()).toBe('webgl2');
    expect(plotter.getBackend().accel).toBe('GPU');

    const pts = makePoints(8192, (i) => Math.sin(i * 0.01));
    const input = {
      dataPoints: pts,
      displayRevision: 1,
      xDesc: { kind: 'time' as const, index: 0 },
      yDesc: { kind: 'physical' as const, index: 0 },
      xTitle: 'Timestamp',
      yTitle: 'Load [N]',
      color: '#34d399',
      isDarkMode: true,
      uiScale: 1,
    };
    plotter.render(input);
    // Identical render inputs (e.g. duplicate ResizeObserver notification) are skipped.
    plotter.render(input);
    expect(env.glTracker.drawCalls).toEqual([8191]);
    expect(env.glTracker.uploadedFloats).toBe(8192 * 2);

    // Switching theme redraws immediately without changing data.
    const textsBefore = env.twoDTracker.fillTexts.length;
    plotter.render({ ...input, isDarkMode: false });
    expect(env.glTracker.drawCalls).toEqual([8191, 8191]);
    expect(env.twoDTracker.fillTexts.length).toBeGreaterThan(textsBefore);

    plotter.dispose();
    expect(env.glTracker.deletedBuffers).toBe(1);
    expect(env.glTracker.deletedVaos).toBe(1);
    expect(env.glTracker.deletedPrograms).toBe(1);
    expect(env.glTracker.lostCalled).toBe(1);
  });

  test('bypasses software WebGL2 (SwiftShader) and falls back to Canvas2D with 1k decimation', () => {
    const env = installFakeDom({
      webglAvailable: true,
      rendererString: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))',
    });
    cleanup = env.restore;

    const plotter = new ModbusSimplePlotter(env.container);
    expect(plotter.getMode()).toBe('canvas2d');
    expect(plotter.getBackend().accel).toBe('CPU');
    expect(env.glTracker.lostCalled).toBe(1);

    const pts = makePoints(8192, (i) => Math.sin(i * 0.01));
    plotter.render({
      dataPoints: pts,
      displayRevision: 1,
      xDesc: { kind: 'time', index: 0 },
      yDesc: { kind: 'physical', index: 0 },
      xTitle: 'Timestamp',
      yTitle: '',
      color: '#60a5fa',
      isDarkMode: false,
      uiScale: 1,
    });

    // Canvas2D fallback decimates 8192 -> <= 1536 points
    expect(env.glTracker.drawCalls.length).toBe(0);
    expect(env.twoDTracker.moveTos).toBe(1);
    expect(env.twoDTracker.lineTos).toBeLessThanOrEqual(1536);
    expect(env.twoDTracker.lineTos).toBeGreaterThan(100);
    plotter.dispose();
  });

  test('falls back cleanly to Canvas2D on runtime webglcontextlost and breaks lines at NaN', () => {
    const env = installFakeDom({
      webglAvailable: true,
      rendererString: 'ANGLE (Intel, UHD Graphics)',
    });
    cleanup = env.restore;

    const plotter = new ModbusSimplePlotter(env.container);
    expect(plotter.getMode()).toBe('webgl2');

    const pts = makePoints(5, (i) => (i === 2 ? NaN : i * 10));
    plotter.render({
      dataPoints: pts,
      displayRevision: 1,
      xDesc: { kind: 'raw', index: 0 },
      yDesc: { kind: 'physical', index: 0 },
      xTitle: '',
      yTitle: '',
      color: '#f472b6',
      isDarkMode: true,
      uiScale: 1,
    });
    expect(env.glTracker.drawCalls).toEqual([4]);

    env.triggerContextLost();
    expect(plotter.getMode()).toBe('canvas2d');
    expect(plotter.getBackend().accel).toBe('CPU');
    // Points 0->1 and 3->4 form two separate line runs across the NaN at index 2.
    expect(env.twoDTracker.moveTos).toBe(2);
    expect(env.twoDTracker.lineTos).toBe(2);
    plotter.dispose();
  });

  test('falls back immediately to Canvas2D when WebGL2 is completely unavailable', () => {
    const env = installFakeDom({
      webglAvailable: false,
    });
    cleanup = env.restore;

    const plotter = new ModbusSimplePlotter(env.container);
    expect(plotter.getMode()).toBe('canvas2d');
    expect(plotter.getBackend()).toEqual({
      api: 'Canvas2D',
      accel: 'CPU',
      detail: 'WebGL2 unavailable',
    });

    const pts = makePoints(10, (i) => i);
    plotter.render({
      dataPoints: pts,
      displayRevision: 1,
      xDesc: { kind: 'time', index: 0 },
      yDesc: { kind: 'physical', index: 0 },
      xTitle: 'Timestamp',
      yTitle: 'Value',
      color: '#fbbf24',
      isDarkMode: true,
      uiScale: 1,
    });
    expect(env.twoDTracker.moveTos).toBe(1);
    expect(env.twoDTracker.lineTos).toBe(9);
    plotter.dispose();
  });
});
