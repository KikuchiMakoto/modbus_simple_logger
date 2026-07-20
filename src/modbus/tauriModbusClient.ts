/*
 * Modbus RTU transport for the Tauri host.
 *
 * Tauri WebView2 does not expose the Web Serial API, so the serial port is
 * opened and read/written by the Rust side via the `serialport` crate and
 * exposed to the webview as Tauri commands:
 *
 *   serial_open(port, baud_rate, data_bits, stop_bits, parity)
 *   serial_close()
 *   serial_transfer(data, expected_len, timeout_ms) -> Vec<u8>
 *
 * Frame/CRC/Mutex/min-interval logic is shared with the Web Serial transport
 * through ModbusClientBase; this subclass only provides the raw byte I/O.
 */
import { invoke } from '@tauri-apps/api/core';
import { ModbusClientBase } from './modbusClientBase';
import { SerialSettings } from '../types';

export type TauriPortInfo = { name: string; kind: string };

export class TauriModbusClient extends ModbusClientBase {
  private portName: string;
  private connected = false;

  constructor(
    portName: string,
    slaveId = 1,
    serialSettings: SerialSettings = {
      baudRate: 38400,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
    },
    isExtendedPrecision = false,
    verboseFrameLogging = false,
  ) {
    super(slaveId, serialSettings, isExtendedPrecision, false, verboseFrameLogging);
    this.portName = portName;
    this.debugPrefix = '[TauriModbusClient]';
  }

  protected ensureReady(): void {
    if (!this.connected) {
      throw new Error('Device not connected');
    }
  }

  protected async rawTransfer(
    frame: Uint8Array,
    expectedLength: number,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    const arr = await invoke<number[]>('serial_transfer', {
      data: Array.from(frame),
      expected_len: expectedLength,
      timeout_ms: timeoutMs,
    });
    return Uint8Array.from(arr);
  }

  /**
   * The Rust `serial_transfer` command drains stale bytes from the OS receive
   * buffer automatically when a transfer fails (timeout, IO error, or CRC
   * mismatch surfaced by the caller). Subclass-specific recovery
   * (cancel+recreate reader) does not apply here, so this is a no-op.
   */
  protected async flushReceiveBuffer(): Promise<void> {
    // no-op
  }

  async connect(): Promise<boolean> {
    console.info(`${this.debugPrefix} connect() start`, {
      port: this.portName,
      slaveId: this.slaveId,
      serialSettings: this.serialSettings,
      isExtendedPrecision: this.isExtendedPrecision,
    });
    await invoke<void>('serial_open', {
      port: this.portName,
      baud_rate: this.serialSettings.baudRate,
      data_bits: this.serialSettings.dataBits,
      stop_bits: this.serialSettings.stopBits,
      parity: this.serialSettings.parity,
    });
    this.connected = true;
    console.info(`${this.debugPrefix} port opened`);
    return true;
  }

  async disconnect() {
    if (this.disconnecting) return;
    this.disconnecting = true;
    console.info(`${this.debugPrefix} disconnect() start`);
    if (this.connected) {
      try {
        await invoke<void>('serial_close');
      } catch (err) {
        console.warn(`${this.debugPrefix} serial_close failed`, err);
      }
      this.connected = false;
    }
    this.disconnecting = false;
    console.info(`${this.debugPrefix} disconnect() complete`);
  }

  /**
   * No `SerialPort` object is exposed to the webview; USB unplug detection
   * in the Tauri build relies on the next transfer failing. Returning null
   * lets the caller's `serial.addEventListener('disconnect', ...)` guard
   * skip registration when the Tauri transport is active.
   */
  getPort(): null {
    return null;
  }
}

export async function listTauriSerialPorts(): Promise<TauriPortInfo[]> {
  return await invoke<TauriPortInfo[]>('list_serial_ports');
}
