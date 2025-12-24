/*
 * Minimal WebUSB transport using modbus-serial helpers for CRC16.
 * The implementation purposefully keeps the API small for browser usage.
 */
import { Buffer } from 'buffer';
import crc16 from 'modbus-serial/utils/crc16';
import { SerialSettings } from '../types';

type EndpointPair = {
  inEndpoint: USBEndpoint;
  outEndpoint: USBEndpoint;
};

export class WebUsbModbusClient {
  private device: USBDevice | null = null;
  private endpoints: EndpointPair | null = null;
  private slaveId: number;
  private serialSettings: SerialSettings;
  private controlInterfaceNumber: number | null = null;

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

  async connect(
    filters: USBDeviceRequestOptions['filters'] = [
      { classCode: 0x02 },
      { classCode: 0x0a },
      { classCode: 0xff },
    ],
  ): Promise<boolean> {
    if (!('usb' in navigator)) {
      throw new Error('WebUSB is not supported in this browser');
    }
    this.device = await navigator.usb.requestDevice({ filters });
    await this.device.open();
    if (this.device.configuration == null) {
      await this.device.selectConfiguration(1);
    }

    const interfaces = this.device.configuration?.interfaces ?? [];
    const controlIface = interfaces.find((i) =>
      i.alternates.some((alt) => alt.interfaceClass === 2),
    );
    const dataIface = interfaces.find((i) =>
      i.alternates.some((alt) => alt.interfaceClass === 10),
    );
    const vendorIface = interfaces.find((i) =>
      i.alternates.some((alt) => alt.interfaceClass === 255),
    );
    const iface = dataIface ?? vendorIface ?? interfaces[0];

    if (!iface) throw new Error('No usable interface found');
    const alt = iface.alternates[0];
    try {
      await this.device.claimInterface(iface.interfaceNumber);
      await this.device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting);
    } catch (err) {
      throw new Error(
        'Unable to claim interface. Close any app using this USB device and reconnect it.',
      );
    }

    if (controlIface) {
      this.controlInterfaceNumber = controlIface.interfaceNumber;
      if (controlIface.interfaceNumber !== iface.interfaceNumber) {
        const controlAlt = controlIface.alternates[0];
        await this.device.claimInterface(controlIface.interfaceNumber);
        await this.device.selectAlternateInterface(
          controlIface.interfaceNumber,
          controlAlt.alternateSetting,
        );
      }
    }

    const inEndpoint = alt.endpoints.find((e) => e.direction === 'in');
    const outEndpoint = alt.endpoints.find((e) => e.direction === 'out');
    if (!inEndpoint || !outEndpoint) {
      throw new Error('Failed to find bulk endpoints');
    }
    this.endpoints = { inEndpoint, outEndpoint };
    return this.applyLineCoding();
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.close();
      } finally {
        this.device = null;
        this.endpoints = null;
        this.controlInterfaceNumber = null;
      }
    }
  }

  private ensureReady() {
    if (!this.device || !this.endpoints) {
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
    const { device, endpoints } = this as { device: USBDevice; endpoints: EndpointPair };

    await device.transferOut(endpoints.outEndpoint.endpointNumber, frame);

    // Add timeout protection (1 second, same as WebSerial implementation)
    const timeout = 1000;
    const transferPromise = device.transferIn(endpoints.inEndpoint.endpointNumber, expectedLength);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout waiting for response')), timeout)
    );

    const result = await Promise.race([transferPromise, timeoutPromise]);
    if (!result.data) throw new Error('No data from device');

    // Validate CRC16 of received data
    const receivedData = new Uint8Array(result.data.buffer);
    if (receivedData.length < 3) {
      throw new Error('Response too short for CRC validation');
    }

    const dataWithoutCrc = receivedData.slice(0, -2);
    const receivedCrc = receivedData[receivedData.length - 2] | (receivedData[receivedData.length - 1] << 8);
    const calculatedCrc = crc16(Buffer.from(dataWithoutCrc));

    if (receivedCrc !== calculatedCrc) {
      throw new Error(`CRC mismatch: expected 0x${calculatedCrc.toString(16)}, got 0x${receivedCrc.toString(16)}`);
    }

    return result.data;
  }

  private async applyLineCoding(): Promise<boolean> {
    if (!this.device || this.controlInterfaceNumber == null) {
      return false;
    }
    const { baudRate, dataBits, stopBits, parity } = this.serialSettings;
    const parityCode = parity === 'none' ? 0 : parity === 'odd' ? 1 : 2;
    const stopBitsCode = stopBits === 1 ? 0 : 2;
    const payload = new Uint8Array(7);
    payload[0] = baudRate & 0xff;
    payload[1] = (baudRate >> 8) & 0xff;
    payload[2] = (baudRate >> 16) & 0xff;
    payload[3] = (baudRate >> 24) & 0xff;
    payload[4] = stopBitsCode;
    payload[5] = parityCode;
    payload[6] = dataBits;
    try {
      await this.device.controlTransferOut(
        {
          requestType: 'class',
          recipient: 'interface',
          request: 0x20,
          value: 0x00,
          index: this.controlInterfaceNumber,
        },
        payload,
      );
      await this.device.controlTransferOut(
        {
          requestType: 'class',
          recipient: 'interface',
          request: 0x22,
          value: 0x03,
          index: this.controlInterfaceNumber,
        },
      );
      return true;
    } catch (err) {
      console.warn('Serial line coding not supported', err);
      return false;
    }
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
