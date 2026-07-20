/*
 * Shared Modbus RTU client base.
 *
 * Encapsulates everything that is transport-agnostic: the AsyncMutex for
 * exclusive access, the minimum-message-interval rule (USB-Serial converters
 * such as CH340/FT232 need ~10ms of silence between Modbus RTU frames; the
 * base rate assumes Normal precision), the frame builder, the CRC16 check,
 * and the Modbus function code helpers (FC 1/3/4/5/6/15/16).
 *
 * Subclasses provide the raw byte I/O via `rawTransfer` (write a frame, read
 * `expectedLength` bytes back, fail on timeout / IO error) and an optional
 * `flushReceiveBuffer` hook used to drain stale bytes after a failed
 * transfer. This keeps the WebSerial transport (browser Web Serial API) and
 * the Tauri transport (serialport crate via custom commands) behind a single
 * public interface so the polling layer in App.tsx does not need to branch
 * per backend.
 */
import { crc16 } from '../utils/crc16';
import { SerialSettings } from '../types';

/**
 * Simple async mutex implementation for exclusive access control
 */
class AsyncMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift()!;
      resolve();
    } else {
      this.locked = false;
    }
  }
}

export abstract class ModbusClientBase {
  protected slaveId: number;
  protected serialSettings: SerialSettings;
  protected transferMutex = new AsyncMutex();
  protected lastTransferTime = 0;
  protected minMessageIntervalMs: number;
  protected isExtendedPrecision: boolean;
  protected readonly isUsingPolyfill: boolean;
  protected debugPrefix = '[ModbusClient]';
  protected readonly verboseFrameLogging: boolean;
  protected disconnecting = false;

  constructor(
    slaveId = 1,
    serialSettings: SerialSettings = {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    isExtendedPrecision = false,
    isUsingPolyfill = false,
    verboseFrameLogging = false,
  ) {
    this.slaveId = slaveId;
    this.serialSettings = serialSettings;
    this.isExtendedPrecision = isExtendedPrecision;
    this.verboseFrameLogging = verboseFrameLogging;
    this.isUsingPolyfill = isUsingPolyfill;
    this.minMessageIntervalMs = this.calculateMinInterval();
    console.info(
      `${this.debugPrefix} initialized`,
      {
        slaveId: this.slaveId,
        serialSettings: this.serialSettings,
        isExtendedPrecision: this.isExtendedPrecision,
        isUsingPolyfill: this.isUsingPolyfill,
        verboseFrameLogging: this.verboseFrameLogging,
        minMessageIntervalMs: this.minMessageIntervalMs,
      },
    );
  }

  /**
   * Convert byte array to space-separated lowercase hex string for debug logs.
   */
  protected toHexString(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
  }

  /**
   * Minimum message interval based on Modbus RTU (3.5 char times) and
   * precision mode. Normal: 10ms floor, Extended: 1ms floor; the larger of
   * the floor and 5-char-times is used.
   */
  protected calculateMinInterval(): number {
    const baseIntervalMs = this.isExtendedPrecision ? 1 : 10;
    const bitsPerChar =
      1 +
      this.serialSettings.dataBits +
      (this.serialSettings.parity !== 'none' ? 1 : 0) +
      this.serialSettings.stopBits;
    const silentIntervalMs = (bitsPerChar * 5 * 1000) / this.serialSettings.baudRate;
    return Math.max(baseIntervalMs, silentIntervalMs);
  }

  setPrecisionMode(isExtended: boolean): void {
    console.info(`${this.debugPrefix} setPrecisionMode`, {
      from: this.isExtendedPrecision,
      to: isExtended,
    });
    this.isExtendedPrecision = isExtended;
    this.minMessageIntervalMs = this.calculateMinInterval();
    console.info(`${this.debugPrefix} minMessageIntervalMs updated`, this.minMessageIntervalMs);
  }

  protected abstract ensureReady(): void;

  protected abstract rawTransfer(
    frame: Uint8Array,
    expectedLength: number,
    timeoutMs: number,
  ): Promise<Uint8Array>;

  protected abstract flushReceiveBuffer(): Promise<void>;

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;

  /**
   * Returns the active port object, or `null` when the transport does not
   * expose one to the webview (Tauri: USB unplug is detected through
   * transfer failures, not through a port object).
   */
  abstract getPort(): unknown;

  protected buildFrame(functionCode: number, payload: number[]): Uint8Array {
    const frame = [this.slaveId, functionCode, ...payload];
    const crc = crc16(frame);
    frame.push(crc & 0xff, (crc >> 8) & 0xff);
    const rawFrame = new Uint8Array(frame);
    const logData: Record<string, unknown> = {
      functionCode,
      payload,
    };
    if (this.verboseFrameLogging) {
      logData.frameHex = this.toHexString(rawFrame);
    }
    console.debug(`${this.debugPrefix} buildFrame`, logData);
    return rawFrame;
  }

  protected async transfer(
    frame: Uint8Array,
    expectedLength: number,
    timeout = 1000,
  ): Promise<DataView> {
    this.ensureReady();
    console.debug(`${this.debugPrefix} transfer() queued`, {
      expectedLength,
      timeout,
      txLength: frame.length,
      ...(this.verboseFrameLogging ? { txHex: this.toHexString(frame) } : {}),
    });

    await this.transferMutex.acquire();
    console.debug(`${this.debugPrefix} transfer() mutex acquired`);

    const startTime = Date.now();
    try {
      const now = Date.now();
      const timeSinceLastTransfer = now - this.lastTransferTime;
      if (timeSinceLastTransfer < this.minMessageIntervalMs) {
        const waitTime = this.minMessageIntervalMs - timeSinceLastTransfer;
        console.debug(`${this.debugPrefix} transfer() waiting interval`, {
          waitTime,
          minMessageIntervalMs: this.minMessageIntervalMs,
        });
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      const responseBytes = await this.rawTransfer(frame, expectedLength, timeout);
      const elapsedMs = Date.now() - startTime;
      console.debug(`${this.debugPrefix} transfer() response assembled`, {
        responseLength: responseBytes.length,
        elapsedMs,
        ...(this.verboseFrameLogging ? { rxHex: this.toHexString(responseBytes) } : {}),
      });

      if (responseBytes.length < 3) {
        throw new Error('Response too short for CRC validation');
      }
      const dataWithoutCrc = responseBytes.slice(0, -2);
      const receivedCrc =
        responseBytes[responseBytes.length - 2] |
        (responseBytes[responseBytes.length - 1] << 8);
      const calculatedCrc = crc16(dataWithoutCrc);
      if (receivedCrc !== calculatedCrc) {
        console.error(`${this.debugPrefix} transfer() CRC mismatch`, {
          expected: `0x${calculatedCrc.toString(16)}`,
          received: `0x${receivedCrc.toString(16)}`,
          rxHex: this.toHexString(responseBytes),
        });
        throw new Error(
          `CRC mismatch: expected 0x${calculatedCrc.toString(16)}, got 0x${receivedCrc.toString(16)}`,
        );
      }

      this.lastTransferTime = Date.now();
      console.debug(`${this.debugPrefix} transfer() success`, {
        elapsedMs: this.lastTransferTime - startTime,
      });
      return new DataView(
        responseBytes.buffer,
        responseBytes.byteOffset,
        responseBytes.byteLength,
      );
    } catch (err) {
      console.error(`${this.debugPrefix} transfer() failed`, {
        expectedLength,
        timeout,
        txLength: frame.length,
        elapsedMs: Date.now() - startTime,
        error: err,
      });
      try {
        await this.flushReceiveBuffer();
      } catch (flushErr) {
        console.warn(`${this.debugPrefix} transfer() flush after error failed`, flushErr);
      }
      throw err;
    } finally {
      this.transferMutex.release();
      console.debug(`${this.debugPrefix} transfer() mutex released`);
    }
  }

  async readCoils(start: number, count: number): Promise<boolean[]> {
    console.debug(`${this.debugPrefix} readCoils()`, { start, count });
    if (count < 1 || count > 2000) {
      throw new Error('Count must be between 1 and 2000');
    }
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(1, payload);
    const byteCount = Math.ceil(count / 8);
    const expected = 3 + byteCount + 2;
    const view = await this.transfer(frame, expected);
    const values: boolean[] = [];
    const responseByteCount = view.getUint8(2);
    for (let i = 0; i < count; i += 1) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      const byte = view.getUint8(3 + byteIndex);
      values.push((byte & (1 << bitIndex)) !== 0);
    }
    console.debug(`${this.debugPrefix} readCoils() done`, { responseByteCount, valuesLength: values.length });
    return values;
  }

  async readHoldingRegisters(start: number, count: number): Promise<number[]> {
    console.debug(`${this.debugPrefix} readHoldingRegisters()`, { start, count });
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(3, payload);
    const expected = 5 + count * 2;
    const view = await this.transfer(frame, expected);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount / 2; i += 1) {
      values.push(view.getInt16(3 + i * 2, false));
    }
    console.debug(`${this.debugPrefix} readHoldingRegisters() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  async readInputRegisters(start: number, count: number, timeoutMs = 1000): Promise<number[]> {
    console.debug(`${this.debugPrefix} readInputRegisters()`, { start, count, timeoutMs });
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + count * 2;
    const view = await this.transfer(frame, expected, timeoutMs);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount / 2; i += 1) {
      values.push(view.getInt16(3 + i * 2, false));
    }
    console.debug(`${this.debugPrefix} readInputRegisters() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  async readInputRegistersAsFloat32Abcd(
    start: number,
    count: number,
    timeoutMs = 1000,
  ): Promise<number[]> {
    console.debug(`${this.debugPrefix} readInputRegistersAsFloat32Abcd()`, { start, count, timeoutMs });
    const registerCount = count * 2;
    const payload = [start >> 8, start & 0xff, registerCount >> 8, registerCount & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + registerCount * 2;
    const view = await this.transfer(frame, expected, timeoutMs);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount; i += 4) {
      values.push(view.getFloat32(3 + i, false));
    }
    console.debug(`${this.debugPrefix} readInputRegistersAsFloat32Abcd() done`, {
      byteCount,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    return values;
  }

  async writeSingleCoil(address: number, value: boolean): Promise<void> {
    console.debug(`${this.debugPrefix} writeSingleCoil()`, { address, value });
    const coilValue = value ? 0xff00 : 0x0000;
    const payload = [address >> 8, address & 0xff, coilValue >> 8, coilValue & 0xff];
    const frame = this.buildFrame(5, payload);
    await this.transfer(frame, 8);
    console.debug(`${this.debugPrefix} writeSingleCoil() done`);
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    console.debug(`${this.debugPrefix} writeSingleRegister()`, { address, value });
    const payload = [address >> 8, address & 0xff, value >> 8, value & 0xff];
    const frame = this.buildFrame(6, payload);
    await this.transfer(frame, 8);
    console.debug(`${this.debugPrefix} writeSingleRegister() done`);
  }

  async writeMultipleCoils(start: number, values: boolean[]): Promise<void> {
    console.debug(`${this.debugPrefix} writeMultipleCoils()`, { start, valuesLength: values.length });
    if (values.length === 0) {
      throw new Error('No values provided to write');
    }
    if (values.length > 1968) {
      throw new Error('Cannot write more than 1968 coils in a single request');
    }
    const count = values.length;
    const byteCount = Math.ceil(count / 8);
    const payload: number[] = [start >> 8, start & 0xff, count >> 8, count & 0xff, byteCount];
    for (let i = 0; i < byteCount; i += 1) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const index = i * 8 + bit;
        if (index < values.length && values[index]) {
          byte |= 1 << bit;
        }
      }
      payload.push(byte);
    }
    const frame = this.buildFrame(15, payload);
    const expected = 8;
    await this.transfer(frame, expected);
    console.debug(`${this.debugPrefix} writeMultipleCoils() done`);
  }

  async writeMultipleHoldingRegisters(start: number, values: number[]): Promise<void> {
    console.debug(`${this.debugPrefix} writeMultipleHoldingRegisters()`, {
      start,
      valuesLength: values.length,
      preview: values.slice(0, 10),
    });
    if (values.length === 0) {
      throw new Error('No values provided to write');
    }
    if (values.length > 123) {
      throw new Error('Cannot write more than 123 registers in a single request');
    }
    const count = values.length;
    const byteCount = count * 2;
    const payload: number[] = [start >> 8, start & 0xff, count >> 8, count & 0xff, byteCount];
    for (const value of values) {
      const unsigned = value & 0xffff;
      payload.push(unsigned >> 8, unsigned & 0xff);
    }
    const frame = this.buildFrame(16, payload);
    const expected = 8;
    await this.transfer(frame, expected);
    console.debug(`${this.debugPrefix} writeMultipleHoldingRegisters() done`);
  }
}
