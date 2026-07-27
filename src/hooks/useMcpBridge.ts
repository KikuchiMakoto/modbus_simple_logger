import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';
import type { ScriptLogEntry, ScriptRunInfo } from './useScriptRunner';
import { isLauncherMode } from '../utils/appMode';

// Page side of the MCP bridge (desktop exe only).
//
// The launcher process hosts the MCP server but owns no logger state: AI/AO
// values, the Modbus connection and the Pyodide PyScriptRunner all live here. This
// hook answers method calls relayed over a WebSocket to the launcher's own
// origin, dispatching them to the very same SharedArrayBuffers and callbacks the
// PyScriptRunner uses — so the MCP tools and the Python API are two doors into one
// implementation rather than two implementations.
//
// Launcher mode comes from utils/appMode (a marker the launcher injects into the
// index.html it serves). On GitHub Pages / PWA this hook never opens a socket.
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10000;

export type McpRecentSample = {
  seq: number;
  timestamp: number;
  raw: number[];
  phy: number[];
  param: number[];
};

/**
 * Free-text labels the user typed on the AI / AO / Parameter cards. Index = ch,
 * '' = unlabeled. Returned as one object rather than per channel: a client that
 * has to correlate 16+8+16 channels would otherwise need 40 round trips, and
 * this is the same shape the PyScriptRunner panel's AI-prompt button emits.
 */
export type McpLabels = {
  ai: string[];
  ao: string[];
  param: string[];
};

export type McpStatus = {
  connected: boolean;
  polling: boolean;
  saving: boolean;
  // Modbus poll interval on the wire, and the interval at which those polls are
  // recorded. Two independent settings; the second is never the faster one.
  pollingIntervalMs: number;
  saveIntervalMs: number;
  serial: string;
  scriptRunning: boolean;
  scriptSource: string;
  writeEnabled: boolean;
};

// Everything the bridge is allowed to touch. App.tsx supplies this through a
// ref so the socket handlers always see current values without resubscribing.
export type McpApi = {
  getAiRaw: (ch: number) => number;
  getAiPhy: (ch: number) => number;
  getAo: (ch: number) => number;
  getParam: (ch: number) => number;
  getStatus: () => McpStatus;
  getLabels: () => McpLabels;
  readRecent: (n: number) => McpRecentSample[];
  getScript: () => {
    code: string;
    status: string;
    running: boolean;
    source: string;
    lastRun: ScriptRunInfo;
  };
  getScriptLog: (n: number) => ScriptLogEntry[];
  waitForScript: (timeoutMs: number) => Promise<ScriptRunInfo>;
  setAo: (ch: number, volt: number) => void;
  setParam: (ch: number, value: number) => void;
  setAiTare: (ch: number) => void;
  runScript: (code: string) => ScriptRunInfo;
  stopScript: () => ScriptRunInfo;
};

export type McpBridgeState = {
  /** The page is attached to the launcher's bridge socket. */
  bridgeConnected: boolean;
  /** The launcher is actually serving an MCP endpoint (false in a second instance). */
  mcpEnabled: boolean;
  /** Endpoint URL to configure in an MCP client. */
  mcpUrl: string | null;
};

type BridgeRequest = { id: number; method: string; params?: Record<string, unknown> };
type BridgeHello = { type: 'hello'; mcp: { enabled: boolean; url: string | null } };

const requireInt = (value: unknown, max: number, what: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= max) {
    throw new Error(`${what} must be an integer in 0-${max - 1}.`);
  }
  return value;
};

const requireFinite = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number.`);
  }
  return value;
};

// How long run_script waits for the script to finish before answering
// "still running". Long enough that a syntax error, a bad channel number or a
// failed import — the failures that happen within milliseconds — come back in
// the tool result instead of having to be chased through a second call.
const DEFAULT_RUN_WAIT_MS = 3000;
const MAX_RUN_WAIT_MS = 60000;
// Log lines returned alongside a run outcome. Enough to carry a traceback plus
// the prints leading up to it without flooding a tool result.
const RUN_RESULT_LOG_LINES = 40;

/**
 * The answer to "what happened to my script?" — outcome, the error and the
 * captured output, in one object. run_script, stop_script and get_script_log
 * all return this shape so a client never has to correlate calls.
 */
const describeRun = (api: McpApi, info: ScriptRunInfo, logLines: number) => ({
  runId: info.runId,
  outcome: info.outcome,
  running: info.outcome === 'running',
  source: info.source,
  startedAt: info.startedAt,
  endedAt: info.endedAt,
  durationMs: info.startedAt === null ? null : (info.endedAt ?? Date.now()) - info.startedAt,
  error: info.error,
  traceback: info.traceback,
  log: api.getScriptLog(logLines),
});

export function useMcpBridge(apiRef: { current: McpApi }, writeEnabled: boolean) {
  const [state, setState] = useState<McpBridgeState>({
    bridgeConnected: false,
    mcpEnabled: false,
    mcpUrl: null,
  });
  const writeEnabledRef = useRef(writeEnabled);
  writeEnabledRef.current = writeEnabled;

  // Write tools are gated here rather than in the launcher so there is one
  // source of truth (the UI toggle) and no way to reach the hardware around it.
  const dispatch = useCallback(
    (method: string, params: Record<string, unknown>): unknown | Promise<unknown> => {
      const api = apiRef.current;
      const requireWrite = () => {
        if (!writeEnabledRef.current) {
          throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Server).');
        }
        // A running script owns the outputs; letting an external write interleave
        // with a control loop would fight it. Mirrors the in-app rule that
        // freezes calibration while a script runs.
        if (api.getStatus().scriptRunning) {
          throw new Error('A script is running. Stop it first (stop_script) before writing directly.');
        }
      };

      switch (method) {
        case 'get_ai_raw':
          return api.getAiRaw(requireInt(params.ch, AI_CHANNELS, 'ch'));
        case 'get_ai_phy':
          return api.getAiPhy(requireInt(params.ch, AI_CHANNELS, 'ch'));
        case 'get_ao':
          return api.getAo(requireInt(params.ch, AO_CHANNELS, 'ch'));
        case 'get_param':
          return api.getParam(requireInt(params.ch, PARAM_CHANNELS, 'ch'));
        case 'get_status':
          return api.getStatus();
        case 'get_labels':
          return api.getLabels();
        case 'read_recent':
          return api.readRecent(Math.max(1, requireInt(params.n, 201, 'n')));
        case 'get_script':
          return api.getScript();
        case 'get_script_log':
          return {
            ...describeRun(api, api.getScript().lastRun, requireInt(params.n ?? 100, 301, 'n')),
            status: api.getScript().status,
          };
        case 'set_ao': {
          requireWrite();
          const ch = requireInt(params.ch, AO_CHANNELS, 'ch');
          const volt = requireFinite(params.volt, 'volt');
          api.setAo(ch, volt);
          return { ch, volt: api.getAo(ch) };
        }
        case 'set_param': {
          requireWrite();
          const ch = requireInt(params.ch, PARAM_CHANNELS, 'ch');
          const value = requireFinite(params.value, 'value');
          api.setParam(ch, value);
          return { ch, value: api.getParam(ch) };
        }
        case 'set_ai_tare': {
          requireWrite();
          const ch = requireInt(params.ch, AI_CHANNELS, 'ch');
          api.setAiTare(ch);
          return { ch, tared: true };
        }
        case 'run_script': {
          // Not gated by scriptRunning here: runScript itself refuses to replace
          // a running script, and its message names the conflict precisely.
          if (!writeEnabledRef.current) {
            throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Server).');
          }
          if (typeof params.code !== 'string' || params.code.trim() === '') {
            throw new Error('code must be a non-empty string.');
          }
          const waitMs = params.wait_ms === undefined
            ? DEFAULT_RUN_WAIT_MS
            : Math.min(requireFinite(params.wait_ms, 'wait_ms'), MAX_RUN_WAIT_MS);
          const started = api.runScript(params.code);
          // Wait briefly for the outcome. A script that fails on line 1 reports
          // its traceback here; one that settles into a control loop is still
          // 'running' when the wait expires, which is the correct answer for it.
          if (waitMs <= 0) return describeRun(api, started, RUN_RESULT_LOG_LINES);
          return api.waitForScript(waitMs).then((info) => describeRun(api, info, RUN_RESULT_LOG_LINES));
        }
        case 'stop_script': {
          if (!writeEnabledRef.current) {
            throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Server).');
          }
          return { stopped: true, ...describeRun(api, api.stopScript(), RUN_RESULT_LOG_LINES) };
        }
        default:
          throw new Error(`Unknown method "${method}".`);
      }
    },
    [apiRef],
  );

  useEffect(() => {
    if (!isLauncherMode) return;

    let socket: WebSocket | null = null;
    let retryDelay = RECONNECT_BASE_MS;
    let reconnectTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      const url = `ws://${window.location.host}${import.meta.env.BASE_URL}__bridge`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        retryDelay = RECONNECT_BASE_MS;
        setState((prev) => ({ ...prev, bridgeConnected: true }));
      };

      socket.onmessage = (event: MessageEvent) => {
        let message: BridgeRequest | BridgeHello;
        try {
          message = JSON.parse(String(event.data)) as BridgeRequest | BridgeHello;
        } catch {
          return;
        }
        if ('type' in message && message.type === 'hello') {
          setState((prev) => ({ ...prev, mcpEnabled: message.mcp.enabled, mcpUrl: message.mcp.url }));
          return;
        }
        const request = message as BridgeRequest;
        if (typeof request.id !== 'number' || typeof request.method !== 'string') return;
        // Most methods answer synchronously; run_script may hold its answer back
        // until the script settles, so a promised result is resolved here rather
        // than serialized as an empty object.
        const reply = (frame: Record<string, unknown>) => socket?.send(JSON.stringify(frame));
        try {
          const result = dispatch(request.method, request.params ?? {});
          if (result instanceof Promise) {
            void result.then(
              (value) => reply({ id: request.id, result: value }),
              (err: Error) => reply({ id: request.id, error: err.message }),
            );
          } else {
            reply({ id: request.id, result });
          }
        } catch (err) {
          reply({ id: request.id, error: (err as Error).message });
        }
      };

      socket.onclose = () => {
        setState((prev) => ({ ...prev, bridgeConnected: false }));
        if (disposed) return;
        // The launcher refuses a second connection (409/1013), so a page that
        // lost a race keeps retrying harmlessly until the other one goes away.
        reconnectTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [dispatch]);

  return state;
}
