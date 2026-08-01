import { useCallback, useEffect, useRef } from 'react';
import { isLauncherMode } from '../utils/appMode';

// Page side of the launcher's sleep-suppression request (desktop exe only).
//
// The page's own Screen Wake Lock only holds while the window is visible;
// this asks the launcher process to hold the *system* awake too, which is the
// part a minimised window cannot do for itself (see launcher/keepAwake.ts).
// A no-op outside the exe.

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10000;

const socketUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${import.meta.env.BASE_URL}__feed`;
};

export type KeepAwakeHandle = {
  /** Ask the launcher to suppress OS sleep, or stop asking. No-op outside the desktop exe. */
  setKeepAwake: (active: boolean) => void;
};

export const useKeepAwake = (): KeepAwakeHandle => {
  const socketRef = useRef<WebSocket | null>(null);
  // The launcher forgets the request when the socket drops (it has to: a page
  // that is gone cannot be measuring). Remembering it here is what restores
  // sleep suppression after a reconnect without the app having to notice that
  // anything happened.
  const keepAwakeRef = useRef(false);

  useEffect(() => {
    if (!isLauncherMode) return;
    let closed = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;

      socket.onopen = () => {
        attempt = 0;
        if (keepAwakeRef.current) socket.send(JSON.stringify({ type: 'keepawake', active: true }));
      };
      socket.onclose = () => {
        socketRef.current = null;
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

  const setKeepAwake = useCallback((active: boolean) => {
    keepAwakeRef.current = active;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'keepawake', active }));
  }, []);

  return { setKeepAwake };
};
