import { describe, expect, test } from 'bun:test';
import { scanModbusFrame } from '../src/modbus/frameScan';
import { crc16 } from '../src/utils/crc16';

const withCrc = (bytes: number[]): number[] => {
  const c = crc16(bytes);
  return [...bytes, c & 0xff, (c >> 8) & 0xff];
};

/** Drive the scanner over `bytes` the way transfer() does. */
function frameOut(bytes: number[], fc: number, successLength: number) {
  const buf = bytes.slice();
  for (;;) {
    const r = scanModbusFrame(buf, 1, fc, successLength);
    if (r.kind === 'drop') {
      buf.splice(0, r.count);
      continue;
    }
    if (r.kind === 'frame') return { ...r, bytes: buf.slice(0, r.length) };
    return null;
  }
}

describe('scanModbusFrame', () => {
  const exception = withCrc([0x01, 0x84, 0x02]);
  const ok = withCrc([0x01, 0x04, 32, ...Array(32).fill(0x11)]);

  test('noise that looks like a header does not hide a following exception', () => {
    const got = frameOut([0x01, 0x04, ...exception], 4, 37);
    expect(got?.isException).toBe(true);
    expect(got?.bytes).toEqual(exception);
  });

  test('valid response found after a false header', () => {
    expect(frameOut([0x01, 0x04, 0x07, ...ok], 4, 37)?.bytes).toEqual(ok);
  });

  test('partial valid response waits instead of dropping', () => {
    for (let cut = 1; cut < ok.length; cut++) {
      const r = scanModbusFrame(ok.slice(0, cut), 1, 4, 37);
      expect(r.kind).toBe('need');
    }
  });

  test('write echo (FC6) is not subject to byte-count check', () => {
    const echo = withCrc([0x01, 0x06, 0x00, 0x02, 0x03, 0xe8]);
    expect(frameOut(echo, 6, 8)?.bytes).toEqual(echo);
  });

  test('bad CRC is dropped', () => {
    const bad = ok.slice();
    bad[10] ^= 0xff;
    expect(frameOut(bad, 4, 37)).toBeNull();
  });
});
