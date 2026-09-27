import { describe, expect, test } from 'bun:test';
import { findCdcLayout, WebUsbSerialPort } from '../src/modbus/webusbSerial';

type Ep = { endpointNumber: number; direction: 'in' | 'out'; type: 'bulk' | 'interrupt'; packetSize: number };
const ep = (n: number, direction: 'in' | 'out', type: Ep['type'] = 'bulk'): Ep => ({ endpointNumber: n, direction, type, packetSize: 64 });
const iface = (interfaceNumber: number, alternates: Array<{ alternateSetting: number; interfaceClass: number; endpoints: Ep[] }>) => ({
  interfaceNumber,
  alternates,
});

function device(configurations: unknown[], active: number | null = null): USBDevice {
  const cfgs = configurations as Array<{ configurationValue: number }>;
  return {
    configurations,
    configuration: active === null ? null : cfgs.find((c) => c.configurationValue === active),
  } as unknown as USBDevice;
}

const standard = {
  configurationValue: 1,
  interfaces: [
    iface(0, [{ alternateSetting: 0, interfaceClass: 2, endpoints: [ep(3, 'in', 'interrupt')] }]),
    iface(1, [{ alternateSetting: 0, interfaceClass: 10, endpoints: [ep(1, 'in'), ep(2, 'out')] }]),
  ],
};

describe('findCdcLayout', () => {
  test('standard two-interface CDC', () => {
    const l = findCdcLayout(device([standard]));
    expect(l).toMatchObject({ configurationValue: 1, controlInterface: 0, dataInterface: 1, dataAlternate: 0 });
  });

  test('CDC only in configuration 2', () => {
    const vendor = { configurationValue: 1, interfaces: [iface(0, [{ alternateSetting: 0, interfaceClass: 255, endpoints: [] }])] };
    const l = findCdcLayout(device([vendor, { ...standard, configurationValue: 2 }]));
    expect(l.configurationValue).toBe(2);
  });

  test('bulk endpoints only on alternate 1', () => {
    const cfg = {
      configurationValue: 1,
      interfaces: [
        standard.interfaces[0],
        iface(1, [
          { alternateSetting: 0, interfaceClass: 10, endpoints: [] },
          { alternateSetting: 1, interfaceClass: 10, endpoints: [ep(1, 'in'), ep(2, 'out')] },
        ]),
      ],
    };
    expect(findCdcLayout(device([cfg])).dataAlternate).toBe(1);
  });

  test('prefers the active configuration', () => {
    const l = findCdcLayout(device([standard, { ...standard, configurationValue: 3 }], 3));
    expect(l.configurationValue).toBe(3);
  });

  test('throws for non-CDC device', () => {
    expect(() => findCdcLayout(device([{ configurationValue: 1, interfaces: [] }]))).toThrow();
  });
});

describe('WebUsbSerialPort', () => {
  test('isDevice distinguishes identical VID/PID devices', () => {
    const a = device([standard]);
    const b = device([standard]);
    const port = new WebUsbSerialPort(a);
    expect(port.isDevice(a)).toBe(true);
    expect(port.isDevice(b)).toBe(false);
  });

  test('a pull completing after cancel does not stop the successor stream', async () => {
    const resolvers: Array<(r: USBInTransferResult) => void> = [];
    const dev = {
      ...device([standard]),
      opened: true,
      transferIn: () => new Promise<USBInTransferResult>((res) => resolvers.push(res)),
    } as unknown as USBDevice;
    const port = new WebUsbSerialPort(dev);
    const first = port.readable!;
    const r1 = first.getReader();
    const pendingRead = r1.read();
    await Promise.resolve();
    await r1.cancel();
    await pendingRead.catch(() => {});
    r1.releaseLock();
    const second = port.readable!;
    expect(second).not.toBe(first);
    const r2 = second.getReader();
    const nextRead = r2.read();
    // Complete the transfer the old pull was awaiting, then the next one.
    const data = (b: number) => ({ status: 'ok', data: new DataView(Uint8Array.of(b).buffer) }) as USBInTransferResult;
    resolvers[0](data(0xaa));
    await Promise.resolve();
    resolvers[1](data(0xbb));
    const got = await nextRead;
    expect(got.done).toBe(false);
    expect(port.readable).toBe(second);
  });
});
