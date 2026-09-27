/*
 * CDC-ACM serial transport over WebUSB.
 *
 * Replaces `web-serial-polyfill`, which is unusable for sustained polling. Its
 * `UsbEndpointUnderlyingSource.pull()` starts the `transferIn` inside a floating
 * async IIFE and returns `undefined`, so the ReadableStream never awaits the
 * transfer it just started. The stream therefore believes every pull completed
 * instantly and keeps pulling while `desiredSize > 0` — which, with the queue
 * drained by a reader, is always.
 *
 * The result is not a slow leak but a strictly linear one. Every byte the device
 * delivers triggers two pulls (one from the `enqueue`, one from the `read()`
 * that consumes it) and satisfies one transfer, so exactly one `transferIn` is
 * orphaned per byte received. Simulated against the real stream implementation:
 *
 *     2760 bytes consumed -> 5520 transferIn issued, 2760 still in flight
 *
 * Those orphans stay submitted to the kernel. Android's usbfs caps the memory
 * held by pending URBs, and that cap — not any transfer count — is what the link
 * hits. Predicting failure as `16200 / (bytesPerFrame * framesPerSecond)`
 * reproduces every timing measured in the field:
 *
 *                  float32 (69 B)      int16 (37 B)
 *     100 ms       23 s / obs 24 s     44 s / obs 44 s
 *     200 ms       47 s / obs 47 s     88 s / obs 88 s
 *     500 ms      117 s / obs 117 s   219 s / obs 219 s
 *
 * which is why lowering the poll rate never fixed it: the leak is metered per
 * byte, so halving the rate only doubles the time to the same failure. Native
 * Web Serial is unaffected because it applies real backpressure, which is why
 * the problem was only ever seen on Android.
 *
 * This implementation awaits every transfer it starts, so the number in flight
 * is bounded by construction — see BulkInPipeline.
 */

/**
 * How many bulk IN transfers to keep outstanding at once.
 *
 * Not 1. Awaiting each transfer before submitting the next is correct but
 * serialises host round-trip latency behind wire time, and a CDC adapter with no
 * OS driver in the path hands up one byte per transfer: a 69-byte float32
 * response costs 69 round trips. At ~1.5 ms each that is ~104 ms for one frame,
 * which does not fit a 100 ms poll at all.
 *
 * Depth 8 amortises the latency until the frame is wire-bound instead
 * (~18 ms for the same response at 38400 baud), restoring the full poll-rate
 * range. Past 8 the wire is the limit and deeper only parks more buffers.
 *
 * Bounded is the whole point: the transfers are submitted ahead of the data, so
 * an unbounded version of this is precisely the polyfill bug above.
 */
const BULK_IN_PIPELINE_DEPTH = 8;

/**
 * Bulk IN transfer size, in whole packets.
 *
 * A bulk transfer completes at the first short packet, so asking for more than
 * the device sends costs nothing and lets one transfer absorb a burst. Kept a
 * multiple of the endpoint's packet size — a non-multiple risks a babble error.
 */
const BULK_IN_PACKETS_PER_TRANSFER = 4;

// USB CDC class requests. Ref: USB CDC specification version 1.1 §6.2.
const kSetLineCoding = 0x20;
const kSetControlLineState = 0x22;
const kSendBreak = 0x23;

const kDefaultBufferSize = 255;
const kDefaultDataBits = 8;
const kDefaultParity = 'none';
const kDefaultStopBits = 1;
const kAcceptableDataBits = [16, 8, 7, 6, 5];
const kAcceptableStopBits = [1, 2];
const kAcceptableParity = ['none', 'even', 'odd'];
const kParityIndexMapping: ParityType[] = ['none', 'odd', 'even'];
const kStopBitsIndexMapping = [1, 1.5, 2];

/** Interface classes that identify the two halves of a CDC-ACM device. */
const kUsbControlInterfaceClass = 2;
const kUsbTransferInterfaceClass = 10;

/**
 * Where the CDC-ACM function lives on a device: one configuration, its control
 * interface, and the data interface alternate that carries the bulk endpoints.
 *
 * Resolved as a unit, and the values found here are the ones open() selects.
 * The old lookup read `configurations[0]` / `alternates[0]` but then selected
 * configuration value 1 unconditionally, so a device whose CDC function sat in
 * configuration 2, or whose bulk endpoints were on alternate 1 (alternate 0
 * being the zero-bandwidth setting), either failed to connect or ran on
 * endpoints that were not the active ones.
 */
export interface CdcLayout {
  configurationValue: number;
  controlInterface: number;
  dataInterface: number;
  dataAlternate: number;
  inEndpoint: USBEndpoint;
  outEndpoint: USBEndpoint;
}

const bulk = (alt: USBAlternateInterface, direction: USBDirection): USBEndpoint | undefined =>
  alt.endpoints.find((e) => e.direction === direction && e.type === 'bulk') ??
  alt.endpoints.find((e) => e.direction === direction);

/**
 * Find the CDC-ACM layout. Prefers the active configuration, then the others
 * in descriptor order. Exported for tests.
 */
export function findCdcLayout(device: USBDevice): CdcLayout {
  const configs = [...device.configurations];
  const active = device.configuration?.configurationValue;
  if (active !== undefined) configs.sort((a, b) => Number(b.configurationValue === active) - Number(a.configurationValue === active));

  for (const config of configs) {
    const control = config.interfaces.find((i) => i.alternates.some((a) => a.interfaceClass === kUsbControlInterfaceClass));
    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        if (alt.interfaceClass !== kUsbTransferInterfaceClass) continue;
        const inEndpoint = bulk(alt, 'in');
        const outEndpoint = bulk(alt, 'out');
        if (!inEndpoint || !outEndpoint) continue;
        return {
          configurationValue: config.configurationValue,
          // Single-interface CDC variants put everything on the data interface.
          controlInterface: control?.interfaceNumber ?? iface.interfaceNumber,
          dataInterface: iface.interfaceNumber,
          dataAlternate: alt.alternateSetting,
          inEndpoint,
          outEndpoint,
        };
      }
    }
  }
  throw new TypeError('Unable to find a CDC-ACM data interface with bulk IN and OUT endpoints.');
}

/**
 * A bounded, in-order queue of outstanding bulk IN transfers.
 *
 * Owned by the SerialPort rather than by the stream, so a stream that is
 * cancelled and rebuilt adopts the transfers already in flight instead of
 * submitting a second, competing set. Two independent readers on one bulk
 * endpoint would interleave: USB completes transfers in submission order, so
 * whoever submitted first takes the earlier bytes, and a rebuilt stream reading
 * "fresh" would silently receive the middle of a frame.
 */
class BulkInPipeline {
  private queue: Array<Promise<USBInTransferResult>> = [];
  private stopped = false;

  constructor(
    private readonly device: USBDevice,
    private readonly endpointNumber: number,
    private readonly transferSize: number,
    private readonly depth: number,
  ) {}

  /** Submit transfers until `depth` are outstanding. */
  private topUp(): void {
    if (this.stopped) return;
    while (this.queue.length < this.depth) {
      let transfer: Promise<USBInTransferResult>;
      try {
        transfer = this.device.transferIn(this.endpointNumber, this.transferSize);
      } catch {
        // Synchronous throw means the device closed underneath us. Whatever is
        // already queued still settles and is still delivered in order.
        this.stopped = true;
        return;
      }
      // A transfer abandoned by stop() must not surface as an unhandled
      // rejection. Attaching a sink here marks it handled without consuming it:
      // `await` on the original promise still sees the rejection.
      transfer.catch(() => {});
      this.queue.push(transfer);
    }
  }

  /** The oldest outstanding transfer, refilling the pipeline behind it. */
  next(): Promise<USBInTransferResult> {
    this.topUp();
    const head = this.queue.shift();
    if (!head) {
      return Promise.reject(new Error('Bulk IN pipeline is stopped'));
    }
    return head;
  }

  /**
   * Stop submitting and drop the queue.
   *
   * The dropped transfers are still outstanding at the USB layer; they are not
   * awaited because the only caller is a fault path where the endpoint is
   * already broken, and `device.close()` aborts them for good. Bounded at
   * `depth` and only on a fault, which is what separates this from the
   * unbounded, per-byte orphaning described at the top of this file.
   */
  stop(): void {
    this.queue = [];
    this.stopped = true;
  }
}

/**
 * ReadableStream source over the bulk IN endpoint.
 *
 * `pull()` is async and returns its promise, so the stream applies real
 * backpressure and calls it again only once the transfer it started has
 * settled. That single property is the fix described at the top of this file.
 */
class UsbEndpointUnderlyingSource implements UnderlyingDefaultSource<Uint8Array> {
  /**
   * Set by cancel(). A pull() that was awaiting a transfer when the reader was
   * cancelled is still alive; when its transfer completes it must not touch
   * the (closed) controller — enqueue would throw, and the catch below used to
   * stop the *shared* pipeline, killing the fresh stream that had already
   * adopted it.
   */
  private cancelled = false;

  constructor(
    private readonly pipeline: BulkInPipeline,
    private readonly onError: () => void,
  ) {}

  async pull(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    try {
      const result = await this.pipeline.next();
      // The transfer completed for a stream nobody reads any more. Its bytes
      // are dropped — the successor stream was built after the cancel, so the
      // client has already treated everything before it as stale.
      if (this.cancelled) return;

      // Any non-ok status ends the stream, including `stall`. Clearing the halt
      // and carrying on was tried and removed: a halted endpoint completes the
      // transfers queued behind the fault too, so resuming means either
      // awaiting them (which hangs if they never settle) or dropping them —
      // and dropping them mid-frame hands the *next* frame a stale leading
      // byte, which is a wrong reading rather than a visible failure. The
      // client above already recovers a dead stream by reopening the port, so
      // the safe answer here is to say so and let it.
      if (result.status !== 'ok') {
        this.pipeline.stop();
        controller.error(new Error(`USB error: ${result.status}`));
        this.onError();
        return;
      }

      if (result.data && result.data.byteLength > 0) {
        controller.enqueue(
          new Uint8Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength,
          ),
        );
      }
    } catch (error) {
      if (this.cancelled) return;
      this.pipeline.stop();
      controller.error(error instanceof Error ? error : new Error(String(error)));
      this.onError();
    }
  }

  /**
   * Honour `reader.cancel()`.
   *
   * The polyfill had no cancel hook at all, so cancelling closed the
   * ReadableStream while `SerialPort.readable` went on returning that same
   * closed stream — every later read resolved `{ done: true }` forever and
   * polling stalled at 0 Hz with the UI still showing a live connection.
   * Dropping the stream here lets the getter build a fresh one, and because the
   * pipeline lives on the port, that fresh stream picks up where this one left
   * off rather than racing it.
   */
  cancel(): void {
    this.cancelled = true;
    this.onError();
  }
}

/** WritableStream sink over the bulk OUT endpoint. */
class UsbEndpointUnderlyingSink implements UnderlyingSink<Uint8Array> {
  constructor(
    private readonly device: USBDevice,
    private readonly endpointNumber: number,
    private readonly onError: () => void,
  ) {}

  async write(chunk: Uint8Array): Promise<void> {
    try {
      const result = await this.device.transferOut(
        this.endpointNumber,
        chunk as BufferSource,
      );
      if (result.status !== 'ok') throw new Error(`USB error: ${result.status}`);
    } catch (error) {
      // Throw, not controller.error() + return. With the latter the write()
      // that hit the fault resolved as if the frame had gone out, and only the
      // *next* write rejected — so the client waited a full read deadline for
      // an answer to a request that was never sent. A rejected sink write
      // errors the stream and rejects this very writer.write().
      this.onError();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

/** A CDC-ACM device presented through the Web Serial `SerialPort` shape. */
export class WebUsbSerialPort {
  private readonly layout: CdcLayout;
  private readonly inEndpoint: USBEndpoint;
  private readonly outEndpoint: USBEndpoint;

  private readable_: ReadableStream<Uint8Array> | null = null;
  private writable_: WritableStream<Uint8Array> | null = null;
  private pipeline_: BulkInPipeline | null = null;
  private serialOptions_: SerialOptions = { baudRate: 9600 };
  private outputSignals_: SerialOutputSignals = {
    dataTerminalReady: false,
    requestToSend: false,
    break: false,
  };

  constructor(private readonly device: USBDevice) {
    this.layout = findCdcLayout(device);
    this.inEndpoint = this.layout.inEndpoint;
    this.outEndpoint = this.layout.outEndpoint;
  }

  /** True when `device` is the very USBDevice behind this port. */
  isDevice(device: USBDevice): boolean {
    return device === this.device;
  }

  get readable(): ReadableStream<Uint8Array> | null {
    if (!this.readable_ && this.device.opened) {
      if (!this.pipeline_) {
        this.pipeline_ = new BulkInPipeline(
          this.device,
          this.inEndpoint.endpointNumber,
          this.inEndpoint.packetSize * BULK_IN_PACKETS_PER_TRANSFER,
          BULK_IN_PIPELINE_DEPTH,
        );
      }
      // Identity-checked: a late callback from a previous stream must not
      // clear the reference to its successor.
      const stream: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>(
        new UsbEndpointUnderlyingSource(this.pipeline_, () => {
          if (this.readable_ === stream) this.readable_ = null;
        }),
        { highWaterMark: this.serialOptions_.bufferSize ?? kDefaultBufferSize },
      );
      this.readable_ = stream;
    }
    return this.readable_;
  }

  get writable(): WritableStream<Uint8Array> | null {
    if (!this.writable_ && this.device.opened) {
      const stream: WritableStream<Uint8Array> = new WritableStream<Uint8Array>(
        new UsbEndpointUnderlyingSink(
          this.device,
          this.outEndpoint.endpointNumber,
          () => {
            if (this.writable_ === stream) this.writable_ = null;
          },
        ),
        new ByteLengthQueuingStrategy({
          highWaterMark: this.serialOptions_.bufferSize ?? kDefaultBufferSize,
        }),
      );
      this.writable_ = stream;
    }
    return this.writable_;
  }

  async open(options: SerialOptions): Promise<void> {
    this.serialOptions_ = options;
    this.validateOptions();
    try {
      const { configurationValue, controlInterface, dataInterface, dataAlternate } = this.layout;
      await this.device.open();
      if (this.device.configuration?.configurationValue !== configurationValue) {
        await this.device.selectConfiguration(configurationValue);
      }
      await this.device.claimInterface(controlInterface);
      if (controlInterface !== dataInterface) {
        await this.device.claimInterface(dataInterface);
      }
      // Only when non-default: alternate 0 is what a fresh claim already has,
      // and some CDC firmwares STALL a redundant SET_INTERFACE.
      if (dataAlternate !== 0) {
        await this.device.selectAlternateInterface(dataInterface, dataAlternate);
      }
      await this.setLineCoding();
      await this.setSignals({ dataTerminalReady: true });
    } catch (error) {
      if (this.device.opened) {
        try { await this.device.close(); } catch { /* best effort */ }
      }
      throw new Error(`Error setting up device: ${String(error)}`);
    }
    // A fresh claim means a fresh endpoint: any pipeline left over from a
    // previous open refers to transfers the kernel aborted at release time.
    this.pipeline_ = null;
    this.readable_ = null;
    this.writable_ = null;
  }

  async close(): Promise<void> {
    // Stop first, so nothing is resubmitted while the streams are winding down.
    this.pipeline_?.stop();
    this.pipeline_ = null;

    // Only touch a stream that is not locked: cancel()/abort() reject with a
    // TypeError on a locked stream, which would make close() throw and leave the
    // interface claimed — the state that makes the next Connect fail.
    const promises: Array<Promise<unknown>> = [];
    if (this.readable_ && !this.readable_.locked) {
      promises.push(this.readable_.cancel().catch(() => {}));
    }
    if (this.writable_ && !this.writable_.locked) {
      promises.push(this.writable_.abort().catch(() => {}));
    }
    await Promise.all(promises);
    this.readable_ = null;
    this.writable_ = null;

    if (this.device.opened) {
      try {
        await this.setSignals({ dataTerminalReady: false, requestToSend: false });
      } catch {
        // The device may already be gone; closing it is what matters.
      }
      await this.device.close();
    }
  }

  async forget(): Promise<void> {
    return this.device.forget();
  }

  getInfo(): SerialPortInfo {
    return {
      usbVendorId: this.device.vendorId,
      usbProductId: this.device.productId,
    };
  }

  reconfigure(options: SerialOptions): Promise<void> {
    this.serialOptions_ = { ...this.serialOptions_, ...options };
    this.validateOptions();
    return this.setLineCoding();
  }

  async setSignals(signals: SerialOutputSignals): Promise<void> {
    this.outputSignals_ = { ...this.outputSignals_, ...signals };
    if (
      signals.dataTerminalReady !== undefined ||
      signals.requestToSend !== undefined
    ) {
      // Ref: USB CDC specification version 1.1 §6.2.14.
      const value =
        (this.outputSignals_.dataTerminalReady ? 1 << 0 : 0) |
        (this.outputSignals_.requestToSend ? 1 << 1 : 0);
      await this.device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: kSetControlLineState,
        value,
        index: this.layout.controlInterface,
      });
    }
    if (signals.break !== undefined) {
      // Ref: USB CDC specification version 1.1 §6.2.15.
      await this.device.controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: kSendBreak,
        value: this.outputSignals_.break ? 0xffff : 0x0000,
        index: this.layout.controlInterface,
      });
    }
  }

  private validateOptions(): void {
    const { baudRate, dataBits, stopBits, parity } = this.serialOptions_;
    if (baudRate % 1 !== 0) {
      throw new RangeError(`invalid Baud Rate ${baudRate}`);
    }
    if (dataBits !== undefined && !kAcceptableDataBits.includes(dataBits)) {
      throw new RangeError(`invalid dataBits ${dataBits}`);
    }
    if (stopBits !== undefined && !kAcceptableStopBits.includes(stopBits)) {
      throw new RangeError(`invalid stopBits ${stopBits}`);
    }
    if (parity !== undefined && !kAcceptableParity.includes(parity)) {
      throw new RangeError(`invalid parity ${parity}`);
    }
  }

  private async setLineCoding(): Promise<void> {
    // Ref: USB CDC specification version 1.1 §6.2.12.
    const buffer = new ArrayBuffer(7);
    const view = new DataView(buffer);
    view.setUint32(0, this.serialOptions_.baudRate, true);
    view.setUint8(
      4,
      kStopBitsIndexMapping.indexOf(this.serialOptions_.stopBits ?? kDefaultStopBits),
    );
    view.setUint8(
      5,
      kParityIndexMapping.indexOf(this.serialOptions_.parity ?? kDefaultParity),
    );
    view.setUint8(6, this.serialOptions_.dataBits ?? kDefaultDataBits);
    const result = await this.device.controlTransferOut(
      {
        requestType: 'class',
        recipient: 'interface',
        request: kSetLineCoding,
        value: 0x00,
        index: this.layout.controlInterface,
      },
      buffer,
    );
    if (result.status !== 'ok') {
      throw new DOMException('Failed to set line coding.', 'NetworkError');
    }
  }
}

/** `navigator.serial` shape backed by WebUSB. */
class WebUsbSerial {
  async requestPort(options?: SerialPortRequestOptions): Promise<WebUsbSerialPort> {
    const filters: USBDeviceFilter[] = [];
    for (const filter of options?.filters ?? []) {
      const usbFilter: USBDeviceFilter = { classCode: kUsbControlInterfaceClass };
      if (filter.usbVendorId !== undefined) usbFilter.vendorId = filter.usbVendorId;
      if (filter.usbProductId !== undefined) usbFilter.productId = filter.usbProductId;
      filters.push(usbFilter);
    }
    if (filters.length === 0) {
      filters.push({ classCode: kUsbControlInterfaceClass });
    }
    const device = await navigator.usb.requestDevice({ filters });
    return new WebUsbSerialPort(device);
  }

  async getPorts(): Promise<WebUsbSerialPort[]> {
    const devices = await navigator.usb.getDevices();
    const ports: WebUsbSerialPort[] = [];
    for (const device of devices) {
      try {
        ports.push(new WebUsbSerialPort(device));
      } catch {
        // Not a CDC-ACM device; skip it.
      }
    }
    return ports;
  }
}

export const webUsbSerial = new WebUsbSerial();
