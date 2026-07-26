import { useCallback, useEffect, useRef, useState } from 'react';
import { isLauncherMode, isViewerMode, viewerToken } from '../utils/appMode';

// Page side of read-only remote monitoring (desktop exe only).
//
// Two roles, one protocol, deliberately kept in one file so the sender and the
// receiver of every frame are read side by side:
//
//   useViewerHost()   runs in the window that owns the hardware. Opens the
//                     loopback `__feed` socket, pushes what it has just plotted,
//                     and carries the on/off switch for the viewer server.
//   useViewerClient() runs on a remote monitor. Opens the `__viewer` socket and
//                     hands received frames to App.
//
// Neither hook exists on GitHub Pages / PWA: both return an inert result unless
// their marker (see utils/appMode.ts) says otherwise.
//
// The host never *pulls*. Remote monitoring is a side effect of the host's own
// chart update, so a viewer can never make the acquisition loop do extra work
// and a stalled viewer can never slow the measurement down.

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10000;

/** One plotted sample, as it goes on the wire. Mirrors ViewerSample in launcher/viewerHub.ts. */
export type ViewerSample = [seq: number, timestamp: number, aiRaw: number[], aiPhy: number[], param: number[]];

/**
 * Everything about the host that is not per-sample. Sent about once a second and
 * applied wholesale by the viewer: at this size a diff would cost more code than
 * the bytes it saves, and a viewer that joins mid-measurement gets a complete
 * picture from a single frame.
 */
export type ViewerStatePayload = {
  aiLabels: string[];
  aoLabels: string[];
  paramLabels: string[];
  voltageConfig: string[];
  calibration: { a: number; b: number; c: number }[];
  aoMilliVolts: number[];
  paramValues: number[];
  connected: boolean;
  saving: boolean;
  filename: string;
  saveElapsedMs: number;
  savePointCount: number;
  pollingIntervalMs: number;
  actualRateHz: number;
  serial: string;
};

/** How remote monitoring is published. Mirrors ViewerMode in launcher/viewerServer.ts. */
export type ViewerMode = 'lan' | 'tunnel';

/** What the launcher reports about the viewer server. Mirrors ViewerStatus in launcher/hostFeed.ts. */
export type ViewerServerStatus = {
  running: boolean;
  mode: ViewerMode | null;
  urls: string[];
  error: string | null;
  viewers: number;
  starting: boolean;
};

const socketUrl = (suffix: string, query = ''): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${import.meta.env.BASE_URL}${suffix}${query}`;
};

export type ViewerHostHandle = {
  /** Null until the launcher answers, so the UI can tell "off" from "not known yet". */
  status: ViewerServerStatus | null;
  /** Turn sharing on in a given mode, or off. Switching mode re-enables. */
  setEnabled: (enabled: boolean, mode?: ViewerMode) => void;
  /** Push the samples just added to the chart buffer. No-op when monitoring is off. */
  publishSamples: (samples: ViewerSample[]) => void;
  /** Push the current configuration/status snapshot. */
  publishState: (state: ViewerStatePayload) => void;
  /** The host cleared its chart; viewers must drop their backlog too. */
  publishReset: () => void;
};

export const useViewerHost = (): ViewerHostHandle => {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ViewerServerStatus | null>(null);
  // Mirrors `status.running` for the send path, which runs from the chart flush
  // and must not re-subscribe to React state to know whether to serialise.
  const runningRef = useRef(false);

  useEffect(() => {
    if (!isLauncherMode) return;
    let closed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(socketUrl('__feed'));
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data as string) as { type?: string; status?: ViewerServerStatus };
          if (frame.type === 'status' && frame.status) {
            runningRef.current = frame.status.running;
            setStatus(frame.status);
          }
        } catch {
          // Not a frame we understand; the launcher only ever sends status.
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        runningRef.current = false;
        setStatus(null);
        if (closed) return;
        // The launcher outlives the page, so a close here means the exe is going
        // away (shutdown) or the socket blipped. Back off and retry either way;
        // if the exe really is gone, the window is closing with it.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        attempt++;
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const send = useCallback((frame: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean, mode: ViewerMode = 'lan') =>
      send(enabled ? { type: 'enable', mode } : { type: 'disable' }),
    [send],
  );

  // The three publish paths short-circuit while monitoring is off, so the
  // acquisition loop pays nothing at all — not even the JSON serialisation —
  // for a feature that is not switched on.
  const publishSamples = useCallback(
    (samples: ViewerSample[]) => {
      if (!runningRef.current || samples.length === 0) return;
      send({ type: 'append', samples });
    },
    [send],
  );

  const publishState = useCallback(
    (state: ViewerStatePayload) => {
      if (!runningRef.current) return;
      send({ type: 'state', state });
    },
    [send],
  );

  const publishReset = useCallback(() => {
    if (!runningRef.current) return;
    send({ type: 'reset' });
  }, [send]);

  return { status, setEnabled, publishSamples, publishState, publishReset };
};

export type ViewerClientCallbacks = {
  onState: (state: ViewerStatePayload) => void;
  onSamples: (samples: ViewerSample[]) => void;
  onReset: () => void;
};

export type ViewerClientHandle = {
  /** Whether the viewer socket is up. False also covers a rejected token. */
  connected: boolean;
  /** True once the launcher says the host window closed: the data is stale. */
  hostGone: boolean;
};

export const useViewerClient = (callbacks: ViewerClientCallbacks): ViewerClientHandle => {
  const [connected, setConnected] = useState(false);
  const [hostGone, setHostGone] = useState(false);
  // Held in a ref so a re-render of App (which happens on every chart update)
  // never tears the socket down and reconnects it.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!isViewerMode) return;
    const token = viewerToken();
    let closed = false;
    let attempt = 0;
    let retryTimer: number | undefined;
    let current: WebSocket | null = null;

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(socketUrl('__viewer', token ? `?k=${encodeURIComponent(token)}` : ''));
      current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        setHostGone(false);
      };
      socket.onmessage = (event) => {
        let frame: { type?: string; state?: ViewerStatePayload; samples?: ViewerSample[] };
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          return;
        }
        switch (frame.type) {
          case 'state':
            if (frame.state) callbacksRef.current.onState(frame.state);
            break;
          case 'append':
            if (Array.isArray(frame.samples)) callbacksRef.current.onSamples(frame.samples);
            break;
          case 'reset':
            callbacksRef.current.onReset();
            break;
          case 'host-gone':
            // Keep what is on screen — the last minute of a measurement is
            // still worth reading — but stop implying it is live.
            setHostGone(true);
            break;
          default:
            break;
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        // Covers the host turning monitoring off, the exe exiting, the network
        // dropping and a refused token alike. Retrying is right for all but the
        // last, and a refused token retries harmlessly against a 403.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        attempt++;
        retryTimer = window.setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      closed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      current?.close();
      current = null;
    };
  }, []);

  return { connected, hostGone };
};
