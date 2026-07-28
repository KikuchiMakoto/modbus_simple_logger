// Fan-out hub for read-only remote monitoring.
//
// The launcher owns no measurement state — the serial port, the calibration and
// the chart buffer all live in the host page (see bridge.ts for the same
// reasoning as elsewhere). So the host page pushes what it has just plotted
// up its `__feed` socket, and this hub relays it to every attached viewer.
//
// The relay is strictly one-way: nothing a viewer sends is ever read (see the
// `message` handler in viewerServer.ts). That is what makes "read-only" a
// property of the transport rather than of the viewer's UI — the viewer bundle
// is the same JavaScript as the host's, so disabled buttons alone would prove
// nothing. A viewer PC has no serial port bound to the device and no channel
// back to the host, so it cannot command the hardware even if its page is
// modified.
export const VIEWER_PATH_SUFFIX = '__viewer';
export const HOST_FEED_PATH_SUFFIX = '__feed';

// One plotted sample: [seq, timestamp, aiRaw[], aiPhysical[], param[]]. Tuples
// rather than objects because this is the only frame that scales with the
// sampling rate — key names would roughly double the bytes on the wire for no
// added meaning.
export type ViewerSample = [number, number, number[], number[], number[]];

// Everything that is not per-sample: labels, calibration, voltage modes, serial
// settings and the header's save/connection status. Small and low-rate, so it
// is relayed verbatim rather than diffed — the host re-sends it about once a
// second and the viewer applies it wholesale.
export type ViewerState = Record<string, unknown>;

// Backlog kept for viewers that join later, so a fresh viewer draws a populated
// chart immediately instead of growing one from empty. Matches CHART_MAX_POINTS
// in src/constants.ts: the viewer applies the same per-chart budget, so a larger
// backlog here would only be trimmed on arrival.
const RING_CAPACITY = 2048;

type ViewerSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
};

class ViewerHub {
  private sockets = new Set<ViewerSocket>();
  private ring: ViewerSample[] = [];
  private state: ViewerState | null = null;

  get viewerCount(): number {
    return this.sockets.size;
  }

  private send(socket: ViewerSocket, frame: unknown): void {
    try {
      socket.send(JSON.stringify(frame));
    } catch {
      // A socket that died between the readiness check and the write is dropped
      // by its own close handler; losing one frame to it changes nothing.
    }
  }

  private broadcast(frame: unknown): void {
    if (this.sockets.size === 0) return;
    const payload = JSON.stringify(frame);
    for (const socket of this.sockets) {
      try {
        socket.send(payload);
      } catch {
        // as above
      }
    }
  }

  attach(socket: ViewerSocket): void {
    this.sockets.add(socket);
    // Bring the newcomer up to date in the same order a live viewer saw it:
    // configuration first (so labels and voltage modes are right before any
    // value is drawn), then the backlog.
    if (this.state) this.send(socket, { type: 'state', state: this.state });
    if (this.ring.length > 0) this.send(socket, { type: 'append', samples: this.ring });
  }

  detach(socket: ViewerSocket): void {
    this.sockets.delete(socket);
  }

  publishState(state: ViewerState): void {
    this.state = state;
    this.broadcast({ type: 'state', state });
  }

  publishSamples(samples: ViewerSample[]): void {
    if (samples.length === 0) return;
    this.ring.push(...samples);
    if (this.ring.length > RING_CAPACITY) this.ring.splice(0, this.ring.length - RING_CAPACITY);
    this.broadcast({ type: 'append', samples });
  }

  // The host cleared its chart (connect, disconnect, save start/stop). Drop the
  // backlog too, or a viewer joining right afterwards would be seeded with
  // samples from the previous run that the host itself no longer shows.
  publishReset(): void {
    this.ring = [];
    this.broadcast({ type: 'reset' });
  }

  // Called when the host page goes away: viewers are told, rather than being
  // left with a frozen chart they cannot distinguish from a stalled sensor.
  publishHostGone(): void {
    this.state = null;
    this.ring = [];
    this.broadcast({ type: 'host-gone' });
  }

  closeAll(): void {
    for (const socket of this.sockets) {
      try {
        socket.close(1001, 'Remote monitoring was turned off');
      } catch {
        // already gone
      }
    }
    this.sockets.clear();
    this.ring = [];
    this.state = null;
  }
}

export const viewerHub = new ViewerHub();
