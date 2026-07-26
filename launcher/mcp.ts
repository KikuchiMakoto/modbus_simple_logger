// MCP server for the desktop launcher (exe build only).
//
// Exposes the ScriptRunner API surface — get_ai_raw / get_ai_phy / get_ao /
// set_ao / get_param / set_param / set_ai_tare — plus monitoring tools and
// run_script, so a generative-AI client can observe and drive the logger.
//
// Every tool is a thin wrapper over `bridge.call()`: the actual work happens in
// the page against the same SharedArrayBuffers and callbacks the Pyodide
// ScriptRunner uses (see src/hooks/useMcpBridge.ts). Write permission is decided
// page-side by a UI toggle (off by default), so there is a single source of
// truth for it and no way to bypass it from here.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { bridge } from './bridge';
// Single source of truth for the version, same as the web app (which gets it
// via VITE_APP_VERSION). Bun resolves this JSON import at build time and
// `bun build --compile` inlines it into the exe, so the MCP handshake can never
// drift from package.json the way a hand-written literal did.
import pkg from '../package.json' with { type: 'json' };

// Fixed port so MCP clients can be configured with a stable URL. A second
// instance of the app fails to bind it and simply runs without MCP (first
// wins), rather than stealing the endpoint from the running instance.
export const MCP_PORT = 8765;
export const MCP_PATH = '/mcp';

const AI_CH = z.number().int().min(0).max(15).describe('AI channel, 0-15');
const AO_CH = z.number().int().min(0).max(7).describe('AO channel, 0-7');
const PARAM_CH = z.number().int().min(0).max(15).describe('Parameter channel, 0-15');

// Scripts can take a while to hand off to the worker on its first run (Pyodide
// boots lazily), and run_script additionally holds its answer back for up to
// `wait_ms` so a script that fails immediately reports the failure in its own
// result. The bridge budget is that wait plus the boot headroom.
const RUN_SCRIPT_HEADROOM_MS = 20000;
const DEFAULT_RUN_WAIT_MS = 3000;
const MAX_RUN_WAIT_MS = 60000;

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const failure = (err: unknown): CallToolResult => ({
  content: [{ type: 'text', text: (err as Error).message ?? String(err) }],
  isError: true,
});

// Tools never throw: a disconnected window, a disabled write toggle or a
// running script are all normal states the client should see and reason about.
const relay = async (
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs?: number,
): Promise<CallToolResult> => {
  try {
    return text(await bridge.call(method, params, timeoutMs));
  } catch (err) {
    return failure(err);
  }
};

const createMcpServer = (): McpServer => {
  const server = new McpServer(
    { name: 'modbus-simple-logger', version: pkg.version },
    {
      instructions:
        'Controls a running Modbus Simple Logger desktop window (16 AI channels, 8 AO channels, ' +
        '16 Parameter channels). Channels carry user-typed labels — call get_labels to learn what ' +
        'each one measures. Read tools always work; write tools require the user to enable ' +
        '"MCP write access" in the app menu. For closed-loop or timed control, submit Python via ' +
        'run_script instead of polling set_ao in a loop — MCP round-trips are far too slow for ' +
        'control timing, and the in-app ScriptRunner runs the loop next to the hardware. ' +
        'A submitted script runs in a Python worker, so its failures surface as data, not as tool ' +
        'errors: check outcome/error in the run_script result and call get_script_log for print() ' +
        'output and the full traceback.',
    },
  );

  server.registerTool(
    'get_status',
    {
      title: 'Get logger status',
      description:
        'Connection, polling, saving and ScriptRunner state, plus whether MCP write access is currently enabled.',
      annotations: { readOnlyHint: true },
    },
    async () => relay('get_status'),
  );

  server.registerTool(
    'get_labels',
    {
      title: 'Get channel labels',
      description:
        'Free-text labels the user typed on the AI / AO / Parameter channel cards, as ' +
        '{ ai: string[], ao: string[], param: string[] } with index = channel and "" for unlabeled. ' +
        'Call this before reasoning about readings: the labels say what each channel is physically ' +
        'measuring (load cell, displacement gauge, ...), which channel numbers alone do not.',
      annotations: { readOnlyHint: true },
    },
    async () => relay('get_labels'),
  );

  server.registerTool(
    'get_ai_raw',
    {
      title: 'Read AI raw value',
      description: 'Latest raw AI reading for a channel (same value as ScriptRunner get_ai_raw).',
      inputSchema: { ch: AI_CH },
      annotations: { readOnlyHint: true },
    },
    async ({ ch }) => relay('get_ai_raw', { ch }),
  );

  server.registerTool(
    'get_ai_phy',
    {
      title: 'Read AI physical value',
      description:
        'Latest calibrated AI value for a channel, i.e. a*raw^2 + b*raw + c (same value as ScriptRunner get_ai_phy).',
      inputSchema: { ch: AI_CH },
      annotations: { readOnlyHint: true },
    },
    async ({ ch }) => relay('get_ai_phy', { ch }),
  );

  server.registerTool(
    'get_ao',
    {
      title: 'Read AO output',
      description: 'Current AO output voltage in volts (same value as ScriptRunner get_ao).',
      inputSchema: { ch: AO_CH },
      annotations: { readOnlyHint: true },
    },
    async ({ ch }) => relay('get_ao', { ch }),
  );

  server.registerTool(
    'get_param',
    {
      title: 'Read Parameter channel',
      description: 'Current Parameter scratch value (same value as ScriptRunner get_param).',
      inputSchema: { ch: PARAM_CH },
      annotations: { readOnlyHint: true },
    },
    async ({ ch }) => relay('get_param', { ch }),
  );

  server.registerTool(
    'read_recent',
    {
      title: 'Read recent samples',
      description:
        'Recent samples from the chart buffer: timestamp plus raw / physical / parameter values. ' +
        'This is the display buffer, so while saving is active it is decimated to a fixed point ' +
        'budget — the complete record is the TSV file, not this tool.',
      inputSchema: { n: z.number().int().min(1).max(200).describe('How many of the most recent samples to return') },
      annotations: { readOnlyHint: true },
    },
    async ({ n }) => relay('read_recent', { n }),
  );

  server.registerTool(
    'get_script',
    {
      title: 'Get ScriptRunner state',
      description:
        'The Python code currently in the ScriptRunner editor, its run state, who started it, and ' +
        'how the last run ended (lastRun.outcome is idle / running / completed / stopped / error, ' +
        'with lastRun.error and lastRun.traceback when it failed).',
      annotations: { readOnlyHint: true },
    },
    async () => relay('get_script'),
  );

  server.registerTool(
    'get_script_log',
    {
      title: 'Get ScriptRunner output',
      description:
        'Captured print() output, Python tracebacks and run events for the current or most recent ' +
        'script run, newest last, each entry { t, stream: stdout|stderr|system, text }. This is how ' +
        'you see why a script failed or what a long-running loop is reporting — the log is cleared ' +
        'at the start of every run, and keeps the last 300 lines.',
      inputSchema: {
        n: z
          .number()
          .int()
          .min(1)
          .max(300)
          .optional()
          .describe('How many of the most recent log lines to return (default 100)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ n }) => relay('get_script_log', n === undefined ? {} : { n }),
  );

  server.registerTool(
    'set_ao',
    {
      title: 'Set AO output',
      description:
        'Set an AO output voltage (clamped to 0-10 V, applied asynchronously by the polling loop). ' +
        'Rejected while a script is running — stop it first, or drive the output from the script.',
      inputSchema: { ch: AO_CH, volt: z.number().describe('Output voltage in volts, clamped to 0-10') },
    },
    async ({ ch, volt }) => relay('set_ao', { ch, volt }),
  );

  server.registerTool(
    'set_param',
    {
      title: 'Set Parameter channel',
      description:
        'Set a Parameter scratch value. It shows in the Parameter panel and is recorded per sample in the TSV.',
      inputSchema: { ch: PARAM_CH, value: z.number().describe('Value to store') },
    },
    async ({ ch, value }) => relay('set_param', { ch, value }),
  );

  server.registerTool(
    'set_ai_tare',
    {
      title: 'Tare AI channel',
      description:
        'Zero a channel at its current reading by adjusting only the calibration offset c; the a and b ' +
        'scale factors are left untouched.',
      inputSchema: { ch: AI_CH },
    },
    async ({ ch }) => relay('set_ai_tare', { ch }),
  );

  server.registerTool(
    'run_script',
    {
      title: 'Run Python in ScriptRunner',
      description:
        'Load Python into the ScriptRunner editor and run it. The API is get_ai_raw(ch) / get_ai_phy(ch) / ' +
        'get_ao(ch) / set_ao(ch, volt) / get_param(ch) / set_param(ch, val) / set_ai_tare(ch); wait only with ' +
        '`await asyncio.sleep(s)`, never time.sleep(). Waits up to wait_ms for the script to finish and ' +
        'returns { outcome, error, traceback, log }: a script that fails on startup reports its traceback ' +
        'here, while a control loop is still running when the wait expires — call get_script_log for its ' +
        'later output. This replaces the editor contents; the previous code is backed up and restorable ' +
        'from the app UI.',
      inputSchema: {
        code: z.string().describe('Python source to run'),
        wait_ms: z
          .number()
          .int()
          .min(0)
          .max(MAX_RUN_WAIT_MS)
          .optional()
          .describe(
            `How long to wait for the script to finish before returning, ms (default ${DEFAULT_RUN_WAIT_MS}; 0 returns immediately)`,
          ),
      },
    },
    async ({ code, wait_ms: waitMs }) =>
      relay(
        'run_script',
        waitMs === undefined ? { code } : { code, wait_ms: waitMs },
        (waitMs ?? DEFAULT_RUN_WAIT_MS) + RUN_SCRIPT_HEADROOM_MS,
      ),
  );

  server.registerTool(
    'stop_script',
    {
      title: 'Stop ScriptRunner',
      description:
        'Interrupt the running script. Returns how the run ended plus its captured output, so a loop ' +
        'that had already died of an error reports that error rather than a bare "stopped".',
    },
    async () => relay('stop_script'),
  );

  return server;
};

export type McpHandle = { stop: () => void; port: number };

// Starts the MCP endpoint, or returns null if the port is already taken (another
// instance owns it — first wins) or the server could not start. Never fatal:
// the app itself must keep working without MCP.
export const startMcpServer = async (): Promise<McpHandle | null> => {
  // Stateless: no session bookkeeping, plain JSON responses. All tools are
  // request/response and nothing is ever pushed to the client, so a session or
  // an SSE stream would buy nothing — and this keeps the endpoint trivially
  // reachable (a single curl POST works).
  //
  // Stateless mode requires a fresh server + transport per request (the SDK
  // refuses to reuse one, since message ids would collide between clients).
  // Construction is just object setup — no I/O, no state to carry — because all
  // the real state lives in the page behind the bridge.
  const handle = async (req: Request): Promise<Response> => {
    const server = createMcpServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    // Buffer before tearing the server down so closing can never truncate the
    // body. Responses here are small JSON documents.
    const body = await response.text();
    await server.close();
    return new Response(body, { status: response.status, headers: response.headers });
  };

  try {
    const http = Bun.serve({
      hostname: '127.0.0.1',
      port: MCP_PORT,
      idleTimeout: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        if (pathname !== MCP_PATH) return new Response('Not Found', { status: 404 });
        return handle(req);
      },
    });
    return {
      port: http.port ?? MCP_PORT,
      stop: () => http.stop(true),
    };
  } catch {
    // EADDRINUSE is the expected case (a second app instance).
    return null;
  }
};
