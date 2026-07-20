/*
 * Web Serial API transport for Modbus RTU.
 *
 * Implements the raw byte I/O (read/write loop, timeouts, receive buffer
 * flush) on top of the browser Web Serial API, sharing CRC16/frame/Mutex
 * logic with the Tauri transport via ModbusClientBase.
 *
 * Designed for CDC-ACM USB-Serial converters that work with OS drivers.
 */
import { ModbusClientBase } from './modbusClientBase';
import { SerialSettings } from '../types';

export class WebSerialModbusClient extends ModbusClientBase {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private serialApi: Serial;

  constructor(
    slaveId = 1,
    serialSettings: SerialSettings = {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    serialApi?: Serial,
    isExtendedPrecision = false,
    isUsingPolyfillOverride?: boolean,
    verboseFrameLogging = false,
  ) {
    super(
      slaveId,
      serialSettings,
      isExtendedPrecision,
      isUsingPolyfillOverride ??
        (typeof navigator === 'undefined' || !('serial' in navigator) || !('requestPort' in navigator.serial)),
      verboseFrameLogging,
    );
    this.serialApi = serialApi || navigator.serial;
    this.debugPrefix = '[WebSerialModbusClient]';
  }

  protected ensureReady(): void {
    if (!this.port || !this.reader || !this.writer) {
      throw new Error('Device not connected');
    }
  }

  protected async rawTransfer(
    frame: Uint8Array,
    expectedLength: number,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    const writer = this.writer!;
    const reader = this.reader!;
    const startTime = Date.now();

    console.debug(`${this.debugPrefix} rawTransfer() write start`);
    await writer.write(frame);
    console.debug(`${this.debugPrefix} rawTransfer() write complete`);

    const buffer: number[] = [];
    while (buffer.length < expectedLength) {
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs >= timeoutMs) {
        throw new Error('Timeout waiting for response');
      }
      const remainingMs = timeoutMs - elapsedMs;
      const readResult = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        let settled = false;
        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('Timeout waiting for response'));
        }, remainingMs);
        reader.read().then(
          (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
          },
          (readError) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            reject(readError);
          },
        );
      });

      const { value, done } = readResult;
      if (done) {
        throw new Error('Stream closed unexpectedly');
      }
      if (value) {
        for (let i = 0; i < value.length; i++) buffer.push(value[i]);
        if (this.verboseFrameLogging) {
          console.debug(`${this.debugPrefix} rawTransfer() read chunk`, {
            chunkLength: value.length,
            totalBuffered: buffer.length,
            chunkHex: this.toHexString(value),
          });
        }
      }
    }

    const responseArray = new Uint8Array(buffer);
    if (responseArray.length > expectedLength) {
      console.warn(`${this.debugPrefix} rawTransfer() excess bytes discarded`, {
        expected: expectedLength,
        received: responseArray.length,
        excess: responseArray.length - expectedLength,
      });
    }
    return responseArray.slice(0, expectedLength);
  }

  async connect(): Promise<boolean> {
    console.info(`${this.debugPrefix} connect() start`, {
      slaveId: this.slaveId,
      serialSettings: this.serialSettings,
      isExtendedPrecision: this.isExtendedPrecision,
    });
    if (!this.serialApi) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    if (this.port) {
      await this.disconnect();
    }

    this.port = await this.serialApi.requestPort();
    const portInfo = this.port.getInfo?.();
    const portInfoReason = portInfo === undefined ? 'no info from getInfo()' : undefined;
    console.info(`${this.debugPrefix} port selected`, {
      portInfo: portInfo ?? null,
      reason: portInfoReason,
    });

    console.info(`${this.debugPrefix} opening port`, this.serialSettings);
    await this.port.open({
      baudRate: this.serialSettings.baudRate,
      dataBits: this.serialSettings.dataBits,
      stopBits: this.serialSettings.stopBits,
      parity: this.serialSettings.parity,
    });
    console.info(`${this.debugPrefix} port opened`);

    if (!this.port.readable || !this.port.writable) {
      throw new Error('Port streams are not available');
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    console.info(`${this.debugPrefix} streams ready (reader/writer locked)`);

    return true;
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    console.info(`${this.debugPrefix} disconnect() start`);

    if (this.reader) {
      console.info(`${this.debugPrefix} cancelling reader`);
      try { await this.reader.cancel(); } catch (err) { console.warn(`${this.debugPrefix} reader cancel failed`, err); }
      try { this.reader.releaseLock(); } catch (err) { console.warn(`${this.debugPrefix} reader releaseLock failed`, err); }
      this.reader = null;
    }

    if (this.writer) {
      console.info(`${this.debugPrefix} closing writer`);
      try { await this.writer.close(); } catch (err) { console.warn(`${this.debugPrefix} writer close failed`, err); }
      this.writer = null;
    }

    if (this.port) {
      console.info(`${this.debugPrefix} closing port`);
      try { await this.port.close(); } catch (err) { console.warn(`${this.debugPrefix} port close failed`, err); }
      this.port = null;
    }

    this.disconnecting = false;
    console.info(`${this.debugPrefix} disconnect() complete`);
  }

  getPort(): SerialPort | null {
    return this.port;
  }

  /**
   * Drain and discard stale bytes from receive buffer.
   * Uses a short read window to avoid blocking regular polling.
   */
  protected async flushReceiveBuffer(maxFlushMs?: number): Promise<void> {
    if (!this.reader || !this.port?.readable) {
      return;
    }
    const effectiveMaxFlushMs = maxFlushMs ?? (this.isUsingPolyfill ? 80 : 30);

    const reader = this.reader;
    const start = Date.now();
    let discardedBytes = 0;

    while (true) {
      const elapsedMs = Date.now() - start;
      if (elapsedMs >= effectiveMaxFlushMs) {
        break;
      }
      const remainingMs = effectiveMaxFlushMs - elapsedMs;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const readResult = await Promise.race<ReadableStreamReadResult<Uint8Array> | null>([
        reader.read(),
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => resolve(null), remainingMs);
        }),
      ]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (readResult === null) {
        try {
          await reader.cancel();
        } catch (cancelError) {
          console.debug(`${this.debugPrefix} flushReceiveBuffer() cancel failed`, cancelError);
        }
        try {
          reader.releaseLock();
        } catch (releaseError) {
          console.debug(`${this.debugPrefix} flushReceiveBuffer() releaseLock failed`, releaseError);
        }
        if (this.port.readable) {
          try {
            this.reader = this.port.readable.getReader();
          } catch (getReaderError) {
            console.warn(`${this.debugPrefix} flushReceiveBuffer() getReader failed`, getReaderError);
            this.reader = null;
            await this.disconnect();
            return;
          }
        } else {
          this.reader = null;
          await this.disconnect();
          return;
        }
        break;
      }

      const { value, done } = readResult;
      if (done || !value || value.length === 0) {
        break;
      }

      discardedBytes += value.length;
    }

    if (discardedBytes > 0) {
      console.warn(`${this.debugPrefix} flushed stale RX bytes`, { discardedBytes });
    }
  }
}
