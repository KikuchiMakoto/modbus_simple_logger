/*
 * Minimal WebUSB transport using modbus-serial helpers for CRC16.
 * The implementation purposefully keeps the API small for browser usage.
 */
import { Buffer } from 'buffer';
import crc16 from 'modbus-serial/utils/crc16';

type EndpointPair = {
  inEndpoint: USBEndpoint;
  outEndpoint: USBEndpoint;
};

export class WebUsbModbusClient {
  private device: USBDevice | null = null;
  private endpoints: EndpointPair | null = null;
  private slaveId: number;

  constructor(slaveId = 1) {
    this.slaveId = slaveId;
  }

  async connect(filters: USBDeviceRequestOptions['filters']): Promise<void> {
    if (!('usb' in navigator)) {
      throw new Error('WebUSB is not supported in this browser');
    }
    this.device = await navigator.usb.requestDevice({ filters });
    await this.device.open();
    if (this.device.configuration == null) {
      await this.device.selectConfiguration(1);
    }

    const iface = this.device.configuration?.interfaces.find((i) =>
      i.alternates.some((alt) => alt.interfaceClass === 255 || alt.interfaceClass === 10),
    ) ?? this.device.configuration?.interfaces[0];

    if (!iface) throw new Error('No usable interface found');
    const alt = iface.alternates[0];
    await this.device.claimInterface(iface.interfaceNumber);
    await this.device.selectAlternateInterface(iface.interfaceNumber, alt.alternateSetting);

    const inEndpoint = alt.endpoints.find((e) => e.direction === 'in');
    const outEndpoint = alt.endpoints.find((e) => e.direction === 'out');
    if (!inEndpoint || !outEndpoint) {
      throw new Error('Failed to find bulk endpoints');
    }
    this.endpoints = { inEndpoint, outEndpoint };
  }

  async disconnect() {
    if (this.device) {
      try {
        await this.device.close();
      } finally {
        this.device = null;
        this.endpoints = null;
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
    const result = await device.transferIn(endpoints.inEndpoint.endpointNumber, expectedLength);
    if (!result.data) throw new Error('No data from device');
    return result.data;
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
