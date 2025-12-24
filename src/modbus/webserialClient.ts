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
  ) {
    this.slaveId = slaveId;
    this.serialSettings = serialSettings;
    this.serialApi = serialApi || navigator.serial;
  }

  async connect(): Promise<boolean> {
    if (!this.serialApi) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    // Clean up existing connection if any
    if (this.port) {
      await this.disconnect();
    }

    // Request port from user
    this.port = await this.serialApi.requestPort();

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
    const writer = this.writer!;
    const reader = this.reader!;

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

    // Validate CRC16 of received data
    if (responseArray.length < 3) {
      throw new Error('Response too short for CRC validation');
    }

    const dataWithoutCrc = responseArray.slice(0, -2);
    const receivedCrc = responseArray[responseArray.length - 2] | (responseArray[responseArray.length - 1] << 8);
    const calculatedCrc = crc16(Buffer.from(dataWithoutCrc));

    if (receivedCrc !== calculatedCrc) {
      throw new Error(`CRC mismatch: expected 0x${calculatedCrc.toString(16)}, got 0x${receivedCrc.toString(16)}`);
    }

    return new DataView(responseArray.buffer);
  }

  /**
   * Read Input Registers (Function Code 4)
   * @param start - Starting register address
   * @param count - Number of registers to read
   * @returns Array of signed 16-bit register values
   */
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

  /**
   * Read Input Registers as Float32 values with ABCD byte order
   * Each float32 value is stored in 2 consecutive registers (4 bytes)
   * ABCD byte order: [Register N: AB] [Register N+1: CD]
   * @param start - Starting register address (e.g., 5000)
   * @param count - Number of float32 values to read (will read count*2 registers)
   * @returns Array of float32 values
   */
  async readInputRegistersAsFloat32Abcd(start: number, count: number): Promise<number[]> {
    // Read twice as many registers since each float32 needs 2 registers
    const registerCount = count * 2;
    const payload = [start >> 8, start & 0xff, registerCount >> 8, registerCount & 0xff];
    const frame = this.buildFrame(4, payload);
    const expected = 5 + registerCount * 2; // addr + fc + byteCount + data + crc
    const view = await this.transfer(frame, expected);

    const values: number[] = [];
    const byteCount = view.getUint8(2);

    // Process pairs of registers as float32 (ABCD byte order = big-endian)
    for (let i = 0; i < byteCount; i += 4) {
      const float32Value = view.getFloat32(3 + i, false); // false = big-endian (ABCD)
      values.push(float32Value);
    }

    return values;
  }

  /**
   * Write Single Register (Function Code 6)
   * @param address - Register address
   * @param value - 16-bit value to write
   */
  async writeSingleRegister(address: number, value: number): Promise<void> {
    const payload = [address >> 8, address & 0xff, value >> 8, value & 0xff];
    const frame = this.buildFrame(6, payload);
    await this.transfer(frame, 8);
  }

  /**
   * Write Multiple Holding Registers (Function Code 16)
   * Writes an array of uint16 values to consecutive Holding Registers
   * @param start - Starting register address
   * @param values - Array of uint16 values to write (max 123 registers per Modbus spec)
   */
  async writeMultipleHoldingRegisters(start: number, values: number[]): Promise<void> {
    if (values.length === 0) {
      throw new Error('No values provided to write');
    }
    if (values.length > 123) {
      throw new Error('Cannot write more than 123 registers in a single request');
    }

    const count = values.length;
    const byteCount = count * 2;

    // Build payload: start address (2 bytes) + count (2 bytes) + byte count (1 byte) + data
    const payload: number[] = [
      start >> 8,
      start & 0xff,
      count >> 8,
      count & 0xff,
      byteCount,
    ];

    // Add register values (each as 2 bytes, big-endian)
    for (const value of values) {
      const unsigned = value & 0xffff; // Ensure uint16
      payload.push(unsigned >> 8, unsigned & 0xff);
    }

    const frame = this.buildFrame(16, payload);
    const expected = 8; // addr + fc + start address + count + crc
    await this.transfer(frame, expected);
  }
}
