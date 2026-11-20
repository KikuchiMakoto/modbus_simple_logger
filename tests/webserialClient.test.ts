import { describe, expect, test } from 'bun:test';

// backgroundTimer touches `document`/`window` only lazily; give it a window.
(globalThis as { window?: unknown }).window ??= globalThis;

const { WebSerialModbusClient } = await import('../src/modbus/webserialClient');
const { crc16 } = await import('../src/utils/crc16');

const withCrc = (bytes: number[]) => {
  const c = crc16(bytes);
  return Uint8Array.from([...bytes, c & 0xff, (c >> 8) & 0xff]);
};

type Behaviour = {
  write?: (chunk: Uint8Array) => Promise<void>;
  open?: () => Promise<void>;
};

/** Minimal SerialPort: a writable that calls `respond` per frame, and a readable fed by it. */
function fakePort(respond: (frame: Uint8Array) => Uint8Array | null, behaviour: Behaviour = {}) {
  const state = { opens: 0, closes: 0, isOpen: false, writes: 0 };
  let readController: ReadableStreamDefaultController<Uint8Array> | null = null;
  let readable: ReadableStream<Uint8Array> | null = null;
  let writable: WritableStream<Uint8Array> | null = null;
  let push: ((b: Uint8Array) => void) | null = null;
  const port = {
    state,
    get readable() {
      return state.isOpen ? readable : null;
    },
    get writable() {
      return state.isOpen ? writable : null;
    },
    async open() {
      await (behaviour.open?.() ?? Promise.resolve());
      state.opens++;
      state.isOpen = true;
      readable = new ReadableStream<Uint8Array>({
        start(c) {
          readController = c;
          push = (b) => {
            // A reply can still be in flight when failRead() has closed the
            // stream; enqueueing into it then would throw inside the timer.
            try {
              c.enqueue(b);
            } catch {
              /* stream already closed */
            }
          };
        },
      });
      writable = new WritableStream<Uint8Array>({
        write: async (chunk) => {
          state.writes++;
          await (behaviour.write?.(chunk) ?? Promise.resolve());
          const reply = respond(chunk);
          if (reply) setTimeout(() => push?.(reply), 1);
        },
      });
    },
    async close() {
      state.closes++;
      state.isOpen = false;
    },
    getInfo: () => ({}),
    /**
     * Kill the IN side only, as a USB IN fault does; OUT stays writable. Closed
     * rather than errored: the client treats `done` as a dead stream just the
     * same, and an errored stream would leave its reader's `closed` promise
     * rejected with nobody to handle it, which the test runner reports against
     * whichever test happens to be running.
     */
    failRead() {
      readController?.close();
    },
  };
  return port;
}

const serialApi = (port: unknown) => ({ requestPort: async () => port }) as unknown as Serial;
const holdingReply = withCrc([1, 3, 16, ...Array(16).fill(0)]);

describe('WebSerialModbusClient', () => {
  test('a wedged write fails within its deadline and the next transfer reopens', async () => {
    let wedge = true;
    const port = fakePort(() => holdingReply, {
      write: () => (wedge ? new Promise<void>(() => {}) : Promise.resolve()),
    });
    const client = new WebSerialModbusClient(1, undefined, serialApi(port), false);
    await client.connect();
    const t0 = Date.now();
    await expect(client.readHoldingRegisters(0, 8)).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(2000);
    wedge = false;
    // Wait out the first backoff entry, then the link must come back.
    await new Promise((r) => setTimeout(r, 600));
    await expect(client.readHoldingRegisters(0, 8)).resolves.toHaveLength(8);
    expect(port.state.opens).toBeGreaterThanOrEqual(2);
    await client.disconnect();
  }, 10000);

  test('disconnect during a reopen leaves the port closed', async () => {
    let releaseOpen: (() => void) | null = null;
    let failWrites = true;
    let opens = 0;
    const port = fakePort(() => holdingReply, {
      write: () => (failWrites ? Promise.reject(new Error('OUT stall')) : Promise.resolve()),
      open: () => {
        opens++;
        if (opens === 1) return Promise.resolve();
        return new Promise<void>((r) => {
          releaseOpen = r;
        });
      },
    });
    const client = new WebSerialModbusClient(1, undefined, serialApi(port), false);
    await client.connect();
    const failing = client.readHoldingRegisters(0, 8).catch(() => {});
    // Wait until the recovery reopen is blocked inside port.open().
    for (let i = 0; i < 200 && !releaseOpen; i++) await new Promise((r) => setTimeout(r, 5));
    expect(releaseOpen).not.toBeNull();
    failWrites = false;
    const disconnecting = client.disconnect();
    releaseOpen!();
    await failing;
    await disconnecting;
    await new Promise((r) => setTimeout(r, 20));
    expect(client.getPort()).toBeNull();
    expect(port.state.isOpen).toBe(false);
  }, 10000);

  test('no request is written while the read side is known dead and the reopen is throttled', async () => {
    const port = fakePort(() => holdingReply);
    const client = new WebSerialModbusClient(1, undefined, serialApi(port), false);
    await client.connect();
    await expect(client.readHoldingRegisters(0, 8)).resolves.toHaveLength(8);
    // First fault: discovered by a transfer, which then reopens the port.
    port.failRead();
    await expect(client.readHoldingRegisters(0, 8)).rejects.toThrow();
    // Second fault on the fresh stream, inside the reopen backoff window: the
    // recovery is throttled, so the errored reader/writer stay assigned.
    port.failRead();
    await expect(client.readHoldingRegisters(0, 8)).rejects.toThrow();
    const writesBefore = port.state.writes;
    // Still within the backoff: nothing may be put on the wire, because its
    // answer could never be read (an FC16 would still move the outputs).
    await expect(client.readHoldingRegisters(0, 8)).rejects.toThrow(/Link down/);
    expect(port.state.writes).toBe(writesBefore);
    // Once the backoff has passed, the link comes back on its own.
    await new Promise((r) => setTimeout(r, 700));
    await expect(client.readHoldingRegisters(0, 8)).resolves.toHaveLength(8);
    await client.disconnect();
  }, 10000);

  test('a link that stays silent for several polls recovers when replies resume', async () => {
    // Exercises the parked read: it is waited on (and given up on) by several
    // transfers in a row, then has to deliver to whichever transfer is current
    // once bytes finally arrive.
    let silent = true;
    const port = fakePort(() => (silent ? null : holdingReply));
    const client = new WebSerialModbusClient(1, undefined, serialApi(port), false);
    await client.connect();
    for (let i = 0; i < 3; i++) {
      await expect(client.readHoldingRegisters(0, 8)).rejects.toThrow();
    }
    silent = false;
    let ok = false;
    for (let i = 0; i < 10 && !ok; i++) {
      ok = await client.readHoldingRegisters(0, 8).then(() => true, () => false);
      if (!ok) await new Promise((r) => setTimeout(r, 200));
    }
    expect(ok).toBe(true);
    await client.disconnect();
  }, 20000);
});
