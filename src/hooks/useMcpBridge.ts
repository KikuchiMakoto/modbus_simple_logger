import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CHANNELS, AO_CHANNELS, PARAM_CHANNELS } from '../constants';

// Page side of the MCP bridge (desktop exe only).
//
// The launcher process hosts the MCP server but owns no logger state: AI/AO
// values, the Modbus connection and the Pyodide ScriptRunner all live here. This
// hook answers method calls relayed over a WebSocket to the launcher's own
// origin, dispatching them to the very same SharedArrayBuffers and callbacks the
// ScriptRunner uses — so the MCP tools and the Python API are two doors into one
// implementation rather than two implementations.
//
// Launcher mode is detected exactly as in main.tsx: the launcher serves the app
// from 127.0.0.1 and nothing else does. On GitHub Pages / PWA this hook never
// opens a socket.
const isLauncherMode = typeof window !== 'undefined' && window.location.hostname === '127.0.0.1';

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
 * this is the same shape the ScriptRunner panel's AI-prompt button emits.
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
  pollingIntervalMs: number;
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
  getScript: () => { code: string; status: string; running: boolean; source: string };
  setAo: (ch: number, volt: number) => void;
  setParam: (ch: number, value: number) => void;
  setAiTare: (ch: number) => void;
  runScript: (code: string) => void;
  stopScript: () => void;
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
    (method: string, params: Record<string, unknown>): unknown => {
      const api = apiRef.current;
      const requireWrite = () => {
        if (!writeEnabledRef.current) {
          throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Access).');
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
            throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Access).');
          }
          if (typeof params.code !== 'string' || params.code.trim() === '') {
            throw new Error('code must be a non-empty string.');
          }
          api.runScript(params.code);
          return { started: true };
        }
        case 'stop_script': {
          if (!writeEnabledRef.current) {
            throw new Error('MCP write access is disabled. Enable it in the app menu (MCP Access).');
          }
          api.stopScript();
          return { stopped: true };
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
        try {
          const result = dispatch(request.method, request.params ?? {});
          socket?.send(JSON.stringify({ id: request.id, result }));
        } catch (err) {
          socket?.send(JSON.stringify({ id: request.id, error: (err as Error).message }));
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
