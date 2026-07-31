import { useCallback, useEffect, useRef, useState } from 'react';
import { isLauncherMode, isViewerMode, viewerToken } from '../utils/appMode';
import { STREAM_MAX_BUFFERED_BYTES } from '../constants';
import type { ScriptLogEntry } from './useScriptRunner';
import type { ModbusPrecision } from '../types';

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
  // The host's two rate settings, which the viewer maps back onto its own
  // option lists, plus the poll interval the host's loop actually measured.
  pollingIntervalMs: number;
  saveIntervalMs: number;
  actualPollIntervalMs: number;
  // The register map actually in use on the wire, so the viewer can match the
  // host's Raw formatting (Extended prints toFixed(3); Normal prints int).
  // Sent on the same wholesale snapshot as everything else.
  precision: ModbusPrecision;
  serial: string;
  /**
   * Tail of the host's script log, so a viewer's chart slot 3 shows the run's
   * output rather than a permanently empty box (a viewer runs no script itself).
   *
   * Capped and sent wholesale on the same 1 Hz snapshot as everything else,
   * rather than as an incremental stream: the log is small, and a viewer that
   * joins mid-run gets the recent history in one frame instead of only what
   * happened after it arrived.
   */
  scriptLog: ScriptLogEntry[];
  /** What the host's Script Log window puts in its subtitle. */
  scriptStatus: string;
  scriptRunning: boolean;
};

/** How much of the host's log travels. Roughly a screenful in the chart slot. */
export const VIEWER_SCRIPT_LOG_TAIL = 100;

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
  /**
   * Ask the launcher to suppress OS sleep while a measurement is running. The
   * page's own Screen Wake Lock only holds while the window is visible, so this
   * is what covers a minimised window (see launcher/keepAwake.ts). No-op
   * outside the desktop exe.
   */
  setKeepAwake: (active: boolean) => void;
  /** Push the samples just added to the chart buffer. No-op when monitoring is off. */
  publishSamples: (samples: ViewerSample[]) => void;
  /** Push the current configuration/status snapshot. */
  publishState: (state: ViewerStatePayload) => void;
  /** The host cleared its chart; viewers must drop their backlog too. */
  publishReset: () => void;
  /**
   * Push one encoded media fragment. Binary, so it is told apart from every
   * frame above by its type rather than by a field — which is what let video
   * join this socket without changing the JSON protocol at all.
   */
  publishMedia: (frame: ArrayBuffer) => void;
  /** The host stopped streaming; viewers should tear their MediaSource down. */
  publishMediaEnd: () => void;
  /** The encoder's actual mimeType, which is not always the one requested. */
  publishMediaStart: (mimeType: string) => void;
  /** How many viewers are attached, or 0. Streaming is skipped when nobody is watching. */
  viewerCount: number;
};

export const useViewerHost = (): ViewerHostHandle => {
  const socketRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ViewerServerStatus | null>(null);
  // Mirrors `status.running` for the send path, which runs from the chart flush
  // and must not re-subscribe to React state to know whether to serialise.
  const runningRef = useRef(false);
  // The launcher forgets the keep-awake request when the socket drops (it has
  // to: a page that is gone cannot be measuring). Remembering it here is what
  // restores sleep suppression after a reconnect without the app having to
  // notice that anything happened.
  const keepAwakeRef = useRef(false);

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
        if (keepAwakeRef.current) socket.send(JSON.stringify({ type: 'keepawake', active: true }));
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

  const setKeepAwake = useCallback(
    (active: boolean) => {
      keepAwakeRef.current = active;
      send({ type: 'keepawake', active });
    },
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

  const publishMedia = useCallback((frame: ArrayBuffer) => {
    const socket = socketRef.current;
    if (!runningRef.current || !socket || socket.readyState !== WebSocket.OPEN) return;
    // Checked here as well as in the launcher's hub: if the loopback socket is
    // backing up, the encoder is outrunning the transport and queueing more of
    // it only grows a buffer in the page that the acquisition loop shares.
    if (socket.bufferedAmount > STREAM_MAX_BUFFERED_BYTES) return;
    socket.send(frame);
  }, []);

  const publishMediaEnd = useCallback(() => {
    if (!runningRef.current) return;
    send({ type: 'media-end' });
  }, [send]);

  const publishMediaStart = useCallback(
    (mimeType: string) => {
      if (!runningRef.current) return;
      send({ type: 'media-start', mimeType });
    },
    [send],
  );

  return {
    status,
    setEnabled,
    setKeepAwake,
    publishSamples,
    publishState,
    publishReset,
    publishMedia,
    publishMediaEnd,
    publishMediaStart,
    viewerCount: status?.viewers ?? 0,
  };
};

export type ViewerClientCallbacks = {
  onState: (state: ViewerStatePayload) => void;
  onSamples: (samples: ViewerSample[]) => void;
  onReset: () => void;
  /** One media fragment, still wrapped in its header (see utils/mediaFrame.ts). */
  onMedia?: (frame: ArrayBuffer) => void;
  /** The codec the host is producing, before any fragment of it arrives. */
  onMediaStart?: (mimeType: string) => void;
  /** The host stopped streaming, or went away. */
  onMediaEnd?: () => void;
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
      // Without this a binary frame arrives as a Blob, and MediaSource would
      // need an async read per fragment — latency spent for nothing.
      socket.binaryType = 'arraybuffer';
      current = socket;

      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        setHostGone(false);
      };
      socket.onmessage = (event) => {
        // Media is the only binary frame on this socket, so the split is by
        // type and the JSON path below is untouched by its existence.
        if (typeof event.data !== 'string') {
          callbacksRef.current.onMedia?.(event.data as ArrayBuffer);
          return;
        }
        let frame: {
          type?: string;
          state?: ViewerStatePayload;
          samples?: ViewerSample[];
          mimeType?: string;
        };
        try {
          frame = JSON.parse(event.data);
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
          case 'media-start':
            if (frame.mimeType) callbacksRef.current.onMediaStart?.(frame.mimeType);
            break;
          case 'media-end':
            callbacksRef.current.onMediaEnd?.();
            break;
          case 'host-gone':
            // Keep what is on screen — the last minute of a measurement is
            // still worth reading — but stop implying it is live.
            setHostGone(true);
            // The video is the exception: a frozen last frame of the rig is not
            // "the last minute still worth reading", it is a picture that looks
            // live and is not.
            callbacksRef.current.onMediaEnd?.();
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
