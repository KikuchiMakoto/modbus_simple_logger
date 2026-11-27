import {
  CHART_RENDER_TARGET_POINTS_CPU,
  CHART_RENDER_TARGET_POINTS_GPU,
} from '../constants';
import type { DataPoint } from '../types';
import { reportRenderBackend, type RenderBackend } from '../utils/renderBackend';
import { computeLinearTicks, computeTimeTicks, paddedRange, type AxisTick } from './axisTicks';
import { buildPlotVertices, GAP_THRESHOLD } from './chartBuffer';
import { AxisColumnCache } from './columnCache';
import { decimateColumnsM4, type AxisDescriptor, type DecimationResult } from './decimation';

export interface PlotRenderInput {
  dataPoints: readonly DataPoint[];
  displayRevision: number;
  xDesc: AxisDescriptor;
  yDesc: AxisDescriptor;
  xTitle: string;
  yTitle: string;
  color: string;
  isDarkMode: boolean;
  uiScale: number;
}

interface Palette {
  paper: string;
  plot: string;
  grid: string;
  spine: string;
  text: string;
}

const DARK_PALETTE: Palette = {
  paper: '#0f172a',
  plot: '#1e293b',
  grid: '#334155',
  spine: '#64748b',
  text: '#cbd5e1',
};

const LIGHT_PALETTE: Palette = {
  paper: '#f8fafc',
  plot: '#ffffff',
  grid: '#e2e8f0',
  spine: '#94a3b8',
  text: '#0f172a',
};

const SOFTWARE_RENDERER_RE = /swiftshader|llvmpipe|software|microsoft basic/i;
const AXIS_FONT_TICKS = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
const AXIS_FONT_TITLE = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
const LINE_WIDTH_CSS = 1.5;

const VERTEX_SHADER_SRC = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_p0;
layout(location = 1) in vec2 a_p1;

uniform vec2 u_size;
uniform float u_halfExt;
uniform float u_gapThreshold;

out vec2 v_local;
out float v_len;

void main() {
  if (!(a_p0.x <= u_gapThreshold && a_p0.y <= u_gapThreshold &&
        a_p1.x <= u_gapThreshold && a_p1.y <= u_gapThreshold)) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_local = vec2(0.0);
    v_len = 0.0;
    return;
  }

  vec2 delta = a_p1 - a_p0;
  float len = length(delta);
  vec2 dir = len > 1e-4 ? delta / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);

  float s;
  float n;
  if (gl_VertexID == 0 || gl_VertexID == 3) {
    s = -1.0; n = -1.0;
  } else if (gl_VertexID == 1) {
    s = 1.0; n = -1.0;
  } else if (gl_VertexID == 2 || gl_VertexID == 4) {
    s = 1.0; n = 1.0;
  } else {
    s = -1.0; n = 1.0;
  }

  float along = s < 0.0 ? -u_halfExt : (len + u_halfExt);
  float across = n * u_halfExt;
  vec2 pos = a_p0 + dir * along + perp * across;

  vec2 ndc = vec2(
    (pos.x / u_size.x) * 2.0 - 1.0,
    1.0 - (pos.y / u_size.y) * 2.0
  );
  gl_Position = vec4(ndc, 0.0, 1.0);
  v_local = vec2(along, across);
  v_len = len;
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision highp float;

uniform vec4 u_color;
uniform float u_halfWidth;
uniform float u_aa;

in vec2 v_local;
in float v_len;

out vec4 fragColor;

void main() {
  float dx = max(0.0, max(-v_local.x, v_local.x - v_len));
  float dist = length(vec2(dx, v_local.y));
  float alpha = 1.0 - smoothstep(u_halfWidth - u_aa, u_halfWidth + u_aa, dist);
  if (alpha <= 0.001) discard;
  float a = u_color.a * alpha;
  fragColor = vec4(u_color.rgb * a, a);
}
`;

function parseCssColor(color: string): [number, number, number, number] {
  const hex = color.trim();
  if (hex.startsWith('#')) {
    if (hex.length === 7) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b, 1];
    } else if (hex.length === 4) {
      const r = parseInt(hex[1] + hex[1], 16) / 255;
      const g = parseInt(hex[2] + hex[2], 16) / 255;
      const b = parseInt(hex[3] + hex[3], 16) / 255;
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b, 1];
    }
  }
  return [0.2, 0.83, 0.6, 1];
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function readRendererString(gl: WebGL2RenderingContext): string {
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const val = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return val ? String(val) : 'WebGL2';
  } catch {
    return 'WebGL2';
  }
}

interface GlState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  vboByteCapacity: number;
  uSize: WebGLUniformLocation | null;
  uHalfExt: WebGLUniformLocation | null;
  uGapThreshold: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uHalfWidth: WebGLUniformLocation | null;
  uAa: WebGLUniformLocation | null;
}

interface DecimationCache {
  points: readonly DataPoint[];
  length: number;
  firstPoint: DataPoint | undefined;
  lastPoint: DataPoint | undefined;
  displayRevision: number;
  xKind: AxisDescriptor['kind'];
  xIndex: number;
  yKind: AxisDescriptor['kind'];
  yIndex: number;
  targetPoints: number;
  result: DecimationResult;
}

/**
 * Zero-dependency chart renderer (`ModbusSimplePlotter`) with built-in M4
 * decimation, WebGL2 instanced anti-aliased line rendering, and automatic
 * Canvas2D fallback (on missing WebGL2, software rasterizers, or context loss).
 */
export class ModbusSimplePlotter {
  private readonly container: HTMLElement;
  private readonly bgCanvas: HTMLCanvasElement;
  private readonly bgCtx: CanvasRenderingContext2D;
  private lineCanvas: HTMLCanvasElement;
  private glState: GlState | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private backend: RenderBackend;
  private mode: 'webgl2' | 'canvas2d';
  private vertexScratch: Float32Array | undefined;
  private decimationCache: DecimationCache | null = null;
  private readonly columns = new AxisColumnCache();
  private lastAxisKey = '';
  private lastRenderKey = '';
  private lastFirstPoint: DataPoint | undefined;
  private lastLastPoint: DataPoint | undefined;
  private lastInput: PlotRenderInput | null = null;
  private disposed = false;

  private readonly onContextLost = (e: Event) => {
    e.preventDefault();
    if (this.disposed) return;
    this.switchToCanvas2D('WebGL2 context lost');
    if (this.lastInput) this.render(this.lastInput);
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
    const bgCtx = this.bgCanvas.getContext('2d');
    if (!bgCtx) {
      throw new Error('Failed to acquire 2D context for plot axes');
    }
    this.bgCtx = bgCtx;

    this.lineCanvas = document.createElement('canvas');
    this.lineCanvas.style.cssText = 'position:absolute;display:block;pointer-events:none;';

    this.container.replaceChildren(this.bgCanvas, this.lineCanvas);

    const init = this.tryInitWebGL2();
    this.backend = init.backend;
    this.mode = init.mode;
    reportRenderBackend(this.backend);
  }

  getBackend(): RenderBackend {
    return this.backend;
  }

  getMode(): 'webgl2' | 'canvas2d' {
    return this.mode;
  }

  private tryInitWebGL2(): { mode: 'webgl2' | 'canvas2d'; backend: RenderBackend } {
    const gl = this.lineCanvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      this.ctx2d = this.replaceLineCanvasFor2D();
      return {
        mode: 'canvas2d',
        backend: { api: 'Canvas2D', accel: 'CPU', detail: 'WebGL2 unavailable' },
      };
    }

    const renderer = readRendererString(gl);
    if (SOFTWARE_RENDERER_RE.test(renderer)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      this.ctx2d = this.replaceLineCanvasFor2D();
      return {
        mode: 'canvas2d',
        backend: {
          api: 'Canvas2D',
          accel: 'CPU',
          detail: `Software WebGL2 bypassed (${renderer})`,
        },
      };
    }

    const program = createProgram(gl);
    const vao = program ? gl.createVertexArray() : null;
    const vbo = program ? gl.createBuffer() : null;
    if (!program || !vao || !vbo) {
      if (vbo) gl.deleteBuffer(vbo);
      if (vao) gl.deleteVertexArray(vao);
      if (program) gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      this.ctx2d = this.replaceLineCanvasFor2D();
      return {
        mode: 'canvas2d',
        backend: { api: 'Canvas2D', accel: 'CPU', detail: 'WebGL2 shader setup failed' },
      };
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 8, 8);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.lineCanvas.addEventListener('webglcontextlost', this.onContextLost);

    this.glState = {
      gl,
      program,
      vao,
      vbo,
      vboByteCapacity: 0,
      uSize: gl.getUniformLocation(program, 'u_size'),
      uHalfExt: gl.getUniformLocation(program, 'u_halfExt'),
      uGapThreshold: gl.getUniformLocation(program, 'u_gapThreshold'),
      uColor: gl.getUniformLocation(program, 'u_color'),
      uHalfWidth: gl.getUniformLocation(program, 'u_halfWidth'),
      uAa: gl.getUniformLocation(program, 'u_aa'),
    };

    return {
      mode: 'webgl2',
      backend: { api: 'WebGL2', accel: 'GPU', detail: renderer },
    };
  }

  private replaceLineCanvasFor2D(): CanvasRenderingContext2D | null {
    // An HTMLCanvasElement bound to WebGL2 cannot subsequently yield a 2D context,
    // so switching cleanly requires replacing the element itself.
    this.lineCanvas.removeEventListener('webglcontextlost', this.onContextLost);
    const next = document.createElement('canvas');
    next.style.cssText = this.lineCanvas.style.cssText;
    this.lineCanvas.replaceWith(next);
    this.lineCanvas = next;
    return next.getContext('2d');
  }

  private switchToCanvas2D(reason: string): void {
    if (this.mode === 'canvas2d') return;
    this.releaseGlResources();
    this.ctx2d = this.replaceLineCanvasFor2D();
    this.mode = 'canvas2d';
    this.decimationCache = null;
    this.lastRenderKey = '';
    this.backend = { api: 'Canvas2D', accel: 'CPU', detail: reason };
    reportRenderBackend(this.backend);
  }

  private releaseGlResources(): void {
    const state = this.glState;
    if (!state) return;
    this.glState = null;
    this.lineCanvas.removeEventListener('webglcontextlost', this.onContextLost);
    const { gl, vbo, vao, program } = state;
    if (!gl.isContextLost()) {
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  private getDecimated(input: PlotRenderInput): DecimationResult {
    const targetPoints =
      this.mode === 'webgl2' ? CHART_RENDER_TARGET_POINTS_GPU : CHART_RENDER_TARGET_POINTS_CPU;
    const len = input.dataPoints.length;
    const firstPoint = len > 0 ? input.dataPoints[0] : undefined;
    const lastPoint = len > 0 ? input.dataPoints[len - 1] : undefined;
    const c = this.decimationCache;
    if (
      c &&
      c.points === input.dataPoints &&
      c.length === len &&
      c.firstPoint === firstPoint &&
      c.lastPoint === lastPoint &&
      c.displayRevision === input.displayRevision &&
      c.xKind === input.xDesc.kind &&
      c.xIndex === input.xDesc.index &&
      c.yKind === input.yDesc.kind &&
      c.yIndex === input.yDesc.index &&
      c.targetPoints === targetPoints
    ) {
      return c.result;
    }

    const n = this.columns.sync(input.dataPoints, input.xDesc, input.yDesc);
    const result = decimateColumnsM4(
      this.columns.xs,
      this.columns.ys,
      n,
      input.xDesc.kind === 'time',
      targetPoints,
    );
    this.decimationCache = {
      points: input.dataPoints,
      length: len,
      firstPoint,
      lastPoint,
      displayRevision: input.displayRevision,
      xKind: input.xDesc.kind,
      xIndex: input.xDesc.index,
      yKind: input.yDesc.kind,
      yIndex: input.yDesc.index,
      targetPoints,
      result,
    };
    return result;
  }

  render(input: PlotRenderInput): void {
    if (this.disposed) return;
    this.lastInput = input;

    const totalW = this.container.clientWidth;
    const totalH = this.container.clientHeight;
    if (totalW <= 0 || totalH <= 0) return;

    const effectiveDpr = Math.min(4, Math.max(1, (window.devicePixelRatio || 1) * input.uiScale));
    const len = input.dataPoints.length;
    const firstPoint = len > 0 ? input.dataPoints[0] : undefined;
    const lastPoint = len > 0 ? input.dataPoints[len - 1] : undefined;
    const renderKey = `${this.mode}|${totalW}|${totalH}|${effectiveDpr}|${input.displayRevision}|${len}|${input.xDesc.kind}|${input.xDesc.index}|${input.yDesc.kind}|${input.yDesc.index}|${input.xTitle}|${input.yTitle}|${input.color}|${input.isDarkMode ? 1 : 0}`;
    if (
      renderKey === this.lastRenderKey &&
      this.lastFirstPoint === firstPoint &&
      this.lastLastPoint === lastPoint
    ) {
      return;
    }
    this.lastRenderKey = renderKey;
    this.lastFirstPoint = firstPoint;
    this.lastLastPoint = lastPoint;

    const [xData, yData, xMin, xMax, yMin, yMax] = this.getDecimated(input);

    const xZeroSpanPad = input.xDesc.kind === 'time' ? 1_000 : undefined;
    const xRange = paddedRange(xMin, xMax, 0.1, xZeroSpanPad) ?? [0, 1];
    const yRange = paddedRange(yMin, yMax, 0.05) ?? [0, 1];

    const maxXTicks = Math.max(3, Math.min(7, Math.floor(totalW / (input.xDesc.kind === 'time' ? 105 : 85))));
    const maxYTicks = Math.max(3, Math.min(6, Math.floor(totalH / 44)));

    const xTicks =
      input.xDesc.kind === 'time'
        ? computeTimeTicks(xRange[0], xRange[1], maxXTicks)
        : computeLinearTicks(xRange[0], xRange[1], maxXTicks);
    const yTicks = computeLinearTicks(yRange[0], yRange[1], maxYTicks);

    this.bgCtx.font = AXIS_FONT_TICKS;
    let maxYLabelW = 0;
    for (const t of yTicks) {
      const w = this.bgCtx.measureText(t.label).width;
      if (w > maxYLabelW) maxYLabelW = w;
    }

    const marginTop = 8;
    const marginRight = 14;
    const marginBottom = input.xTitle ? 36 : 20;
    const marginLeft = Math.min(
      92,
      Math.max(input.yTitle ? 52 : 40, Math.ceil(maxYLabelW + (input.yTitle ? 28 : 12))),
    );

    const plotW = Math.max(16, totalW - marginLeft - marginRight);
    const plotH = Math.max(16, totalH - marginTop - marginBottom);

    this.drawAxesLayer({
      totalW,
      totalH,
      effectiveDpr,
      marginTop,
      marginRight,
      marginBottom,
      marginLeft,
      plotW,
      plotH,
      xRange,
      yRange,
      xTicks,
      yTicks,
      xKind: input.xDesc.kind,
      xTitle: input.xTitle,
      yTitle: input.yTitle,
      isDarkMode: input.isDarkMode,
    });

    const prepared = buildPlotVertices(
      xData,
      yData,
      xMin,
      xMax,
      yMin,
      yMax,
      plotW,
      plotH,
      this.vertexScratch,
      xZeroSpanPad,
    );
    this.vertexScratch = prepared.vertices;

    this.positionLineCanvas(marginLeft, marginTop, plotW, plotH, effectiveDpr);

    if (this.mode === 'webgl2' && this.glState) {
      this.drawWebGL2(
        this.glState,
        prepared.vertices,
        prepared.pointCount,
        plotW,
        plotH,
        effectiveDpr,
        input.color,
      );
    } else if (this.ctx2d) {
      this.drawCanvas2D(
        this.ctx2d,
        prepared.vertices,
        prepared.pointCount,
        plotW,
        plotH,
        effectiveDpr,
        input.color,
      );
    }
  }

  private drawAxesLayer(params: {
    totalW: number;
    totalH: number;
    effectiveDpr: number;
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    plotW: number;
    plotH: number;
    xRange: [number, number];
    yRange: [number, number];
    xTicks: AxisTick[];
    yTicks: AxisTick[];
    xKind: AxisDescriptor['kind'];
    xTitle: string;
    yTitle: string;
    isDarkMode: boolean;
  }): void {
    const {
      totalW,
      totalH,
      effectiveDpr,
      marginTop,
      marginLeft,
      plotW,
      plotH,
      xRange,
      yRange,
      xTicks,
      yTicks,
      xKind,
      xTitle,
      yTitle,
      isDarkMode,
    } = params;

    const axisKey = `${totalW}|${totalH}|${effectiveDpr}|${xRange[0]}|${xRange[1]}|${yRange[0]}|${yRange[1]}|${xKind}|${xTitle}|${yTitle}|${isDarkMode ? 1 : 0}|${marginLeft}`;
    if (axisKey === this.lastAxisKey) return;
    this.lastAxisKey = axisKey;

    const physW = Math.max(1, Math.round(totalW * effectiveDpr));
    const physH = Math.max(1, Math.round(totalH * effectiveDpr));
    if (this.bgCanvas.width !== physW) this.bgCanvas.width = physW;
    if (this.bgCanvas.height !== physH) this.bgCanvas.height = physH;

    const ctx = this.bgCtx;
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    const palette = isDarkMode ? DARK_PALETTE : LIGHT_PALETTE;
    const rawXSpan = xRange[1] - xRange[0];
    const rawYSpan = yRange[1] - yRange[0];
    const xFrac = (v: number) =>
      Number.isFinite(rawXSpan) && rawXSpan > 0
        ? (v - xRange[0]) / rawXSpan
        : (v * 0.5 - xRange[0] * 0.5) / (xRange[1] * 0.5 - xRange[0] * 0.5 || 1);
    const yFrac = (v: number) =>
      Number.isFinite(rawYSpan) && rawYSpan > 0
        ? (yRange[1] - v) / rawYSpan
        : (yRange[1] * 0.5 - v * 0.5) / (yRange[1] * 0.5 - yRange[0] * 0.5 || 1);

    // 1. Paper and plot-area backgrounds
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, totalW, totalH);
    ctx.fillStyle = palette.plot;
    ctx.fillRect(marginLeft, marginTop, plotW, plotH);

    // 2. Grid lines
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of xTicks) {
      const x = Math.round(marginLeft + xFrac(t.value) * plotW) + 0.5;
      if (x >= marginLeft && x <= marginLeft + plotW) {
        ctx.moveTo(x, marginTop);
        ctx.lineTo(x, marginTop + plotH);
      }
    }
    for (const t of yTicks) {
      const y = Math.round(marginTop + yFrac(t.value) * plotH) + 0.5;
      if (y >= marginTop && y <= marginTop + plotH) {
        ctx.moveTo(marginLeft, y);
        ctx.lineTo(marginLeft + plotW, y);
      }
    }
    ctx.stroke();

    // 3. matplotlib / MATLAB / gnuplot spine box + outward tick marks
    ctx.strokeStyle = palette.spine;
    ctx.lineWidth = 1;
    ctx.strokeRect(marginLeft - 0.5, marginTop - 0.5, plotW + 1, plotH + 1);

    ctx.beginPath();
    for (const t of xTicks) {
      const x = Math.round(marginLeft + xFrac(t.value) * plotW) + 0.5;
      if (x >= marginLeft && x <= marginLeft + plotW) {
        ctx.moveTo(x, marginTop + plotH + 0.5);
        ctx.lineTo(x, marginTop + plotH + 4.5);
      }
    }
    for (const t of yTicks) {
      const y = Math.round(marginTop + yFrac(t.value) * plotH) + 0.5;
      if (y >= marginTop && y <= marginTop + plotH) {
        ctx.moveTo(marginLeft - 0.5, y);
        ctx.lineTo(marginLeft - 4.5, y);
      }
    }
    ctx.stroke();

    // 4. Tick labels
    ctx.fillStyle = palette.text;
    ctx.font = AXIS_FONT_TICKS;

    ctx.textBaseline = 'top';
    let lastRight = -Infinity;
    for (const t of xTicks) {
      const tx = marginLeft + xFrac(t.value) * plotW;
      const w = ctx.measureText(t.label).width;
      let align: CanvasTextAlign = 'center';
      let leftEdge = tx - w * 0.5;
      if (leftEdge < 2) {
        align = 'left';
        leftEdge = tx;
      } else if (tx + w * 0.5 > totalW - 2) {
        align = 'right';
        leftEdge = tx - w;
      }
      if (leftEdge < lastRight + 8) continue;
      ctx.textAlign = align;
      ctx.fillText(t.label, tx, marginTop + plotH + 6);
      lastRight = leftEdge + w;
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yTicks) {
      const ty = marginTop + yFrac(t.value) * plotH;
      if (ty < marginTop - 2 || ty > marginTop + plotH + 2) continue;
      ctx.fillText(t.label, marginLeft - 7, ty);
    }

    // 5. Axis titles
    ctx.font = AXIS_FONT_TITLE;
    if (xTitle) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(xTitle, marginLeft + plotW * 0.5, totalH - 3);
    }
    if (yTitle) {
      ctx.save();
      ctx.translate(12, marginTop + plotH * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(yTitle, 0, 0);
      ctx.restore();
    }
  }

  private positionLineCanvas(
    left: number,
    top: number,
    plotW: number,
    plotH: number,
    effectiveDpr: number,
  ): void {
    const s = this.lineCanvas.style;
    const leftPx = `${left}px`;
    const topPx = `${top}px`;
    const widthPx = `${plotW}px`;
    const heightPx = `${plotH}px`;
    if (s.left !== leftPx) s.left = leftPx;
    if (s.top !== topPx) s.top = topPx;
    if (s.width !== widthPx) s.width = widthPx;
    if (s.height !== heightPx) s.height = heightPx;

    const physW = Math.max(1, Math.round(plotW * effectiveDpr));
    const physH = Math.max(1, Math.round(plotH * effectiveDpr));
    if (this.lineCanvas.width !== physW) this.lineCanvas.width = physW;
    if (this.lineCanvas.height !== physH) this.lineCanvas.height = physH;
  }

  private drawWebGL2(
    state: GlState,
    vertices: Float32Array,
    pointCount: number,
    plotW: number,
    plotH: number,
    effectiveDpr: number,
    color: string,
  ): void {
    const { gl } = state;
    if (gl.isContextLost()) {
      this.switchToCanvas2D('WebGL2 context lost');
      if (this.ctx2d) {
        this.drawCanvas2D(this.ctx2d, vertices, pointCount, plotW, plotH, effectiveDpr, color);
      }
      return;
    }

    gl.viewport(0, 0, this.lineCanvas.width, this.lineCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (pointCount < 2) return;

    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.vbo);

    const neededBytes = pointCount * 8;
    if (neededBytes > state.vboByteCapacity) {
      const nextCap = Math.max(neededBytes, state.vboByteCapacity * 2, 4096);
      gl.bufferData(gl.ARRAY_BUFFER, nextCap, gl.DYNAMIC_DRAW);
      state.vboByteCapacity = nextCap;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices.subarray(0, pointCount * 2));

    const halfWidth = LINE_WIDTH_CSS * 0.5;
    const aa = 0.75 / effectiveDpr;
    const halfExt = halfWidth + aa;
    const [r, g, b, a] = parseCssColor(color);

    gl.uniform2f(state.uSize, plotW, plotH);
    gl.uniform1f(state.uHalfExt, halfExt);
    gl.uniform1f(state.uGapThreshold, GAP_THRESHOLD);
    gl.uniform4f(state.uColor, r, g, b, a);
    gl.uniform1f(state.uHalfWidth, halfWidth);
    gl.uniform1f(state.uAa, aa);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, pointCount - 1);
    gl.bindVertexArray(null);
  }

  private drawCanvas2D(
    ctx: CanvasRenderingContext2D,
    vertices: Float32Array,
    pointCount: number,
    plotW: number,
    plotH: number,
    effectiveDpr: number,
    color: string,
  ): void {
    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
    ctx.clearRect(0, 0, plotW, plotH);
    if (pointCount < 2) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH_CSS;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();

    let penDown = false;
    for (let i = 0; i < pointCount; i++) {
      const base = i * 2;
      const x = vertices[base];
      const y = vertices[base + 1];
      if (!(x <= GAP_THRESHOLD && y <= GAP_THRESHOLD)) {
        penDown = false;
        continue;
      }
      if (!penDown) {
        ctx.moveTo(x, y);
        penDown = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseGlResources();
    this.ctx2d = null;
    this.decimationCache = null;
    this.columns.clear();
    this.lastInput = null;
    this.vertexScratch = undefined;
    this.container.replaceChildren();
  }
}
