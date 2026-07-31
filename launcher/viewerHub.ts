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
// Media rides the same socket as binary frames (see src/utils/mediaFrame.ts for
// the wire format, imported here rather than restated so one definition governs
// both ends). The relay stays one-way: a fragment goes host -> hub -> viewer and
// nothing comes back, so adding video did not require opening the viewer's
// message handler.
import { MEDIA_FLAG_INIT, MEDIA_HEADER_BYTES } from '../src/utils/mediaFrame';

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
// weak link that is sent every fragment anyway falls further behind with each
// one, and the backlog is held in the launcher's memory — eventually pushing
// back on the host's own send. The measurement must not pay for someone else's
// wifi, so the slow viewer loses frames instead. Video is the one stream where
// that is harmless: nobody wants a ten-second-old picture caught up at speed.
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
   * The last initialisation segment the host sent.
   *
   * Kept for exactly the reason the state snapshot above is kept: a viewer that
   * arrives mid-stream has missed the one fragment without which none of the
   * others decode. Replaying it on attach is what makes joining late work at
   * all, and it is why this lives beside `state` rather than in the host page.
   */
  private mediaInit: ArrayBuffer | null = null;
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
    // The init segment last, because it is the only one whose absence is fatal
    // rather than cosmetic — sending it after the JSON keeps it adjacent to the
    // live fragments that follow it.
    if (this.mediaInit) this.sendBinary(socket, this.mediaInit);
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
   * Relay one media fragment.
   *
   * Unlike publishSamples there is no ring buffer: a backlog of video is worth
   * nothing to a viewer, who wants the picture as it is now, not the picture
   * from ten seconds ago followed by a scramble to catch up. Only the init
   * segment is kept, and only because nothing decodes without it.
   */
  publishMedia(frame: ArrayBuffer): void {
    if (frame.byteLength >= MEDIA_HEADER_BYTES) {
      const flags = new DataView(frame).getUint8(1);
      if ((flags & MEDIA_FLAG_INIT) !== 0) this.mediaInit = frame;
    }
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

  /** The host stopped streaming: forget the init segment, tell the viewers. */
  publishMediaEnd(): void {
    this.mediaInit = null;
    this.broadcast({ type: 'media-end' });
  }

  // Called when the host page goes away: viewers are told, rather than being
  // left with a frozen chart they cannot distinguish from a stalled sensor.
  publishHostGone(): void {
    this.state = null;
    this.ring = [];
    this.mediaInit = null;
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
    this.mediaInit = null;
  }
}

export const viewerHub = new ViewerHub();
