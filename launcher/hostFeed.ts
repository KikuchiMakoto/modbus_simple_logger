// Launcher side of the host page's `__feed` socket.
//
// Three things travel over it, all initiated by the page:
//   - the monitoring feed (state / samples / reset), forwarded to viewerHub;
//   - control frames that switch the viewer server on and off;
//   - the keep-awake request, raised while the page is actually measuring.
//
// Control lives here rather than on a launcher-side setting because the switch
// belongs to the person at the machine, and the only UI they have is the page
// (the packaged exe has no console — see the fatal() dance in main.ts). The
// socket is exposed on the loopback app server only, so "the page" always means
// the local host window, never a remote viewer.
import { viewerHub, type ViewerSample, type ViewerState } from './viewerHub';
import type { ViewerMode } from './viewerServer';
import { setKeepAwake } from './keepAwake';

/** What the page is told about remote monitoring, whenever it changes. */
export type ViewerStatus = {
  running: boolean;
  /** Which way it is published, when running. */
  mode: ViewerMode | null;
  /** URLs another PC can open, once running. Empty while off. */
  urls: string[];
  /** Why the last enable attempt failed, or null. */
  error: string | null;
  viewers: number;
  /** True while a tunnel is being provisioned — it takes a few seconds. */
  starting: boolean;
};

export const OFF_STATUS: ViewerStatus = {
  running: false,
  mode: null,
  urls: [],
  error: null,
  viewers: 0,
  starting: false,
};

type FeedSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

type ControlAction = { type: 'enable'; mode: ViewerMode } | { type: 'disable' };

type ControlHandler = (action: ControlAction) => Promise<ViewerStatus>;

class HostFeed {
  private socket: FeedSocket | null = null;
  private control: ControlHandler | null = null;
  private lastStatus: ViewerStatus = OFF_STATUS;

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
    // Nothing is measuring once the page is gone, and a reload re-raises the
    // request within a second. Holding the machine awake on behalf of a window
    // that no longer exists is how a laptop ends up flat in the morning.
    setKeepAwake(false);
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

  /**
   * One still from the page, relayed verbatim. The launcher never looks inside
   * it: this is a relay, and a JPEG has nothing it needs to know.
   */
  handleBinaryMessage(data: ArrayBuffer): void {
    viewerHub.publishMedia(data);
  }

  handleMessage(raw: string): void {
    let frame: {
      type?: string;
      state?: ViewerState;
      samples?: ViewerSample[];
      mode?: ViewerMode;
      active?: boolean;
    };
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
      // The page stopped sending stills. Said explicitly rather than inferred
      // from them drying up, so a viewer is told the difference between "the
      // host turned the camera off" and "the link went quiet".
      case 'media-end':
        viewerHub.publishMediaEnd();
        break;
      case 'enable':
        void this.runControl({ type: 'enable', mode: frame.mode === 'tunnel' ? 'tunnel' : 'lan' });
        break;
      case 'disable':
        void this.runControl({ type: 'disable' });
        break;
      // Sleep suppression, owned by the page because only the page knows
      // whether a measurement is in progress (see launcher/keepAwake.ts).
      case 'keepawake':
        setKeepAwake(frame.active === true);
        break;
      default:
        break;
    }
  }

  private async runControl(action: ControlAction): Promise<void> {
    if (!this.control) return;
    // A tunnel takes several seconds to provision, so say so before starting:
    // otherwise the toggle sits there looking broken.
    if (action.type === 'enable' && action.mode === 'tunnel') {
      this.pushStatus({ ...OFF_STATUS, starting: true });
    }
    try {
      this.pushStatus(await this.control(action));
    } catch (err) {
      this.pushStatus({ ...OFF_STATUS, error: (err as Error).message ?? String(err) });
    }
  }

  /** Re-send the current status with a fresh viewer count (viewers come and go). */
  refreshViewerCount(): void {
    if (!this.lastStatus.running) return;
    this.pushStatus({ ...this.lastStatus, viewers: viewerHub.viewerCount });
  }
}

export const hostFeed = new HostFeed();
