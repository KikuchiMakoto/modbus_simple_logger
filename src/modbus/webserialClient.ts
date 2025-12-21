/*
 * Web Serial API transport using modbus-serial helpers for CRC16.
 * Designed for CDC-ACM USB-Serial converters that work with OS drivers.
 */
import { Buffer } from 'buffer';
import crc16 from 'modbus-serial/utils/crc16';
import { SerialSettings } from '../types';

export class WebSerialModbusClient {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private slaveId: number;
  private serialSettings: SerialSettings;

  constructor(
    slaveId = 1,
    serialSettings: SerialSettings = {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
  ) {
    this.slaveId = slaveId;
    this.serialSettings = serialSettings;
  }

  async connect(): Promise<boolean> {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    // Request port from user
    this.port = await navigator.serial.requestPort();

    // Open with serial settings
    await this.port.open({
      baudRate: this.serialSettings.baudRate,
      dataBits: this.serialSettings.dataBits,
      stopBits: this.serialSettings.stopBits,
      parity: this.serialSettings.parity,
    });

    // Get readable and writable streams
    if (!this.port.readable || !this.port.writable) {
      throw new Error('Port streams are not available');
    }

    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();

    return true;
  }

  async disconnect() {
    try {
      // Release reader and writer
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
      // Close port
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (err) {
      console.error('Error during disconnect:', err);
      this.port = null;
      this.reader = null;
      this.writer = null;
    }
  }

  private ensureReady() {
    if (!this.port || !this.reader || !this.writer) {
      throw new Error('Device not connected');
    }
  }

  private buildFrame(functionCode: number, payload: number[]): Uint8Array {
    const frame = [this.slaveId, functionCode, ...payload];
    const crc = crc16(Buffer.from(frame));
    frame.push(crc & 0xff, (crc >> 8) & 0xff);
    return new Uint8Array(frame);
  }

  private async transfer(frame: Uint8Array, expectedLength: number): Promise<DataView> {
    this.ensureReady();
    const { writer, reader } = this as {
      writer: WritableStreamDefaultWriter<Uint8Array>;
      reader: ReadableStreamDefaultReader<Uint8Array>;
    };

    // Write frame
    await writer.write(frame);

    // Read response with timeout
    const timeout = 1000; // 1 second timeout
    const buffer: number[] = [];
    const startTime = Date.now();

    while (buffer.length < expectedLength) {
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for response');
      }

      const { value, done } = await reader.read();
      if (done) {
        throw new Error('Stream closed unexpectedly');
      }
      if (value) {
        buffer.push(...Array.from(value));
      }

      // Check if we have enough data
      if (buffer.length >= expectedLength) {
        break;
      }
    }

    // Convert to DataView
    const responseArray = new Uint8Array(buffer.slice(0, expectedLength));
    return new DataView(responseArray.buffer);
  }

  async readInputRegisters(start: number, count: number): Promise<number[]> {
    const payload = [start >> 8, start & 0xff, count >> 8, count & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + count * 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected);
    const values: number[] = [];
    const byteCount = view.getUint8(2);
    for (let i = 0; i < byteCount / 2; i += 1) {
      values.push(view.getInt16(3 + i * 2, false));
    }
    return values;
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    const payload = [address >> 8, address & 0xff, value >> 8, value & 0xff];
    const frame = this.buildFrame(6, payload);
    await this.transfer(frame, 8);
  }
}
