// Launcher side of the host page's keep-awake request.
//
// The page's own Screen Wake Lock (requestWakeLock in App.tsx) only holds
// while the window is visible; this socket lets the page ask the launcher
// process to suppress OS sleep for as long as a measurement is running, which
// is what covers a minimised window. Loopback-only and driven entirely by the
// page — the packaged exe has no console of its own to raise the request from.
import { setKeepAwake } from './keepAwake';

export const KEEP_AWAKE_PATH_SUFFIX = '__feed';

type FeedSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

class KeepAwakeFeed {
  private socket: FeedSocket | null = null;

  get connected(): boolean {
    return this.socket !== null;
  }

  attach(socket: FeedSocket): void {
    this.socket = socket;
  }

  detach(socket: FeedSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    // Nothing is measuring once the page is gone, and a reload re-raises the
    // request within a second. Holding the machine awake on behalf of a window
    // that no longer exists is how a laptop ends up flat in the morning.
    setKeepAwake(false);
  }

  handleMessage(raw: string): void {
    let frame: { type?: string; active?: boolean };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.type === 'keepawake') setKeepAwake(frame.active === true);
  }
}

export const keepAwakeFeed = new KeepAwakeFeed();
