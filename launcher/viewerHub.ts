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
//
// The camera rides the same socket as binary frames — JPEG stills, about one a
// second (see src/utils/mediaFrame.ts). The relay stays one-way: a still goes
// host -> hub -> viewer and nothing comes back, so adding the camera did not
// require opening the viewer's message handler.

export const VIEWER_PATH_SUFFIX = '__viewer';
export const HOST_FEED_PATH_SUFFIX = '__feed';

// How a slow viewer is detected.
//
// Not `bufferedAmount`: Bun's ServerWebSocket does not have it (it is undefined,
// not 0 — a check against it silently never fires, which is worse than no check
// at all, because it looks like protection). What Bun gives instead is send()'s
// return value: the byte count on success, or -1 when the frame was queued
// because the socket is already backed up. A `drain` callback says when it has
// caught up.
//
// Dropping the fragment is the right failure and not a compromise: a viewer on a
// weak link that is sent every still anyway falls further behind with each one,
// and the backlog is held in the launcher's memory — eventually pushing back on
// the host's own send. The measurement must not pay for someone else's wifi, so
// the slow viewer skips pictures instead, which for a slideshow costs nothing
// at all: the next one it does receive is current.
const BACKPRESSURE = -1;

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
  /** Bun returns bytes sent, or -1 when the frame was queued under backpressure. */
  send(data: string | ArrayBufferView | ArrayBuffer): number | unknown;
  close(code?: number, reason?: string): void;
};

class ViewerHub {
  private sockets = new Set<ViewerSocket>();
  private ring: ViewerSample[] = [];
  private state: ViewerState | null = null;
  /**
   * The most recent still.
   *
   * Kept for the same reason the state snapshot is: a viewer that has just
   * attached should see the rig now, not in a second's time. Unlike the init
   * segment this replaced, it is not required for anything to decode — it is
   * simply the current picture, which is all a still ever is.
   */
  private lastSnapshot: ArrayBuffer | null = null;
  /** Sockets whose last media send hit backpressure; skipped until they drain. */
  private congested = new Set<ViewerSocket>();

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
    // Then the picture as it stands, so the card is not blank for a second.
    if (this.lastSnapshot) this.sendBinary(socket, this.lastSnapshot);
  }

  detach(socket: ViewerSocket): void {
    this.sockets.delete(socket);
    this.congested.delete(socket);
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

  /** Returns false when the socket is backed up and should be skipped next time. */
  private sendBinary(socket: ViewerSocket, frame: ArrayBuffer): boolean {
    try {
      return socket.send(frame) !== BACKPRESSURE;
    } catch {
      // as above
      return false;
    }
  }

  /**
   * Relay one still.
   *
   * Unlike publishSamples there is no ring buffer, and unlike a video stream
   * there is nothing to reassemble: only the newest picture matters, so only
   * the newest is kept.
   */
  publishMedia(frame: ArrayBuffer): void {
    this.lastSnapshot = frame;
    for (const socket of this.sockets) {
      // A viewer that is already behind is skipped until its socket drains.
      // Its stream shows a jump, which is the honest outcome; the alternative
      // is the launcher holding video for a link that cannot take it.
      if (this.congested.has(socket)) continue;
      if (!this.sendBinary(socket, frame)) this.congested.add(socket);
    }
  }

  /** Bun's drain callback: this socket has caught up and can be sent to again. */
  drained(socket: ViewerSocket): void {
    this.congested.delete(socket);
  }

  // The host cleared its chart (connect, disconnect, save start/stop). Drop the
  // backlog too, or a viewer joining right afterwards would be seeded with
  // samples from the previous run that the host itself no longer shows.
  publishReset(): void {
    this.ring = [];
    this.broadcast({ type: 'reset' });
  }

  /** The host stopped sending: drop the picture, tell the viewers. */
  publishMediaEnd(): void {
    this.lastSnapshot = null;
    this.broadcast({ type: 'media-end' });
  }

  // Called when the host page goes away: viewers are told, rather than being
  // left with a frozen chart they cannot distinguish from a stalled sensor.
  publishHostGone(): void {
    this.state = null;
    this.ring = [];
    this.lastSnapshot = null;
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
    this.congested.clear();
    this.ring = [];
    this.state = null;
    this.lastSnapshot = null;
  }
}

export const viewerHub = new ViewerHub();
