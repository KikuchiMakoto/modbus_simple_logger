// Launcher side of the host page's `__feed` socket.
//
// Two things travel over it, both initiated by the page:
//   - the monitoring feed (state / samples / reset), forwarded to viewerHub;
//   - control frames that switch the viewer server on and off.
//
// Control lives here rather than on a launcher-side setting because the switch
// belongs to the person at the machine, and the only UI they have is the page
// (the packaged exe has no console — see the fatal() dance in main.ts). The
// socket is exposed on the loopback app server only, so "the page" always means
// the local host window, never a remote viewer.
import { viewerHub, type ViewerSample, type ViewerState } from './viewerHub';

/** What the page is told about remote monitoring, whenever it changes. */
export type ViewerStatus = {
  running: boolean;
  /** URLs another PC can open, once running. Empty while off. */
  urls: string[];
  /** Why the last enable attempt failed, or null. */
  error: string | null;
  viewers: number;
};

type FeedSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

type ControlHandler = (action: 'enable' | 'disable') => Promise<ViewerStatus>;

class HostFeed {
  private socket: FeedSocket | null = null;
  private control: ControlHandler | null = null;
  private lastStatus: ViewerStatus = { running: false, urls: [], error: null, viewers: 0 };

  get connected(): boolean {
    return this.socket !== null;
  }

  /** main.ts installs the handler that actually starts/stops the viewer server. */
  setControlHandler(handler: ControlHandler): void {
    this.control = handler;
  }

  attach(socket: FeedSocket): void {
    this.socket = socket;
    this.pushStatus(this.lastStatus);
  }

  detach(socket: FeedSocket): void {
    if (this.socket !== socket) return;
    this.socket = null;
    // The window that owns the hardware is gone: viewers must be told rather
    // than left staring at a chart frozen at the last sample, which looks
    // exactly like a stalled sensor.
    viewerHub.publishHostGone();
  }

  /** Tell the page the current remote-monitoring status (also on reconnect). */
  pushStatus(status: ViewerStatus): void {
    this.lastStatus = status;
    try {
      this.socket?.send(JSON.stringify({ type: 'status', status }));
    } catch {
      // The socket is closing; the page re-reads the status when it reconnects.
    }
  }

  handleMessage(raw: string): void {
    let frame: { type?: string; state?: ViewerState; samples?: ViewerSample[] };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    switch (frame.type) {
      case 'state':
        if (frame.state) viewerHub.publishState(frame.state);
        break;
      case 'append':
        if (Array.isArray(frame.samples)) viewerHub.publishSamples(frame.samples);
        break;
      case 'reset':
        viewerHub.publishReset();
        break;
      case 'enable':
      case 'disable':
        void this.runControl(frame.type);
        break;
      default:
        break;
    }
  }

  private async runControl(action: 'enable' | 'disable'): Promise<void> {
    if (!this.control) return;
    try {
      this.pushStatus(await this.control(action));
    } catch (err) {
      this.pushStatus({
        running: false,
        urls: [],
        error: (err as Error).message ?? String(err),
        viewers: 0,
      });
    }
  }

  /** Re-send the current status with a fresh viewer count (viewers come and go). */
  refreshViewerCount(): void {
    if (!this.lastStatus.running) return;
    this.pushStatus({ ...this.lastStatus, viewers: viewerHub.viewerCount });
  }
}

export const hostFeed = new HostFeed();
