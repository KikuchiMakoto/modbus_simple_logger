// Response framing for Modbus RTU, as a pure function.
//
// Split out of webserialClient's transfer() so the one part of the transport
// with no I/O in it — deciding what a pile of received bytes *is* — can be
// exercised without a device attached (tests/frameScan.test.ts). A
// pure function with an explicit result type is the next best thing.
//
// What this replaces: transfer() used to frame responses purely by byte count
// and validate only the CRC, never the slave ID and never the function code.
// Combined with readChunk()'s deliberate parking of an abandoned read (required
// by the WebUSB polyfill — see its docstring), one read timeout was enough to
// desynchronise the request and response streams permanently: the late response
// was handed to the next caller, and because consecutive polls issue an
// identical request, it matched on length and on CRC and was accepted as the
// answer to the wrong request. Every row from then on recorded the previous
// sample's values under the current timestamp, with no error and no log line.
import { crc16 } from '../utils/crc16';

/** addr + (fc | 0x80) + exception code + CRC16. */
export const MODBUS_EXCEPTION_FRAME_LENGTH = 5;

/** Function codes whose response is addr + fc + byteCount + data + CRC16. */
const READ_FUNCTION_CODES: ReadonlySet<number> = new Set([1, 2, 3, 4]);
/** addr + fc + byteCount + CRC16. */
const READ_RESPONSE_OVERHEAD = 5;

const MODBUS_EXCEPTION_TEXT: Record<number, string> = {
  0x01: 'illegal function',
  0x02: 'illegal data address',
  0x03: 'illegal data value',
  0x04: 'device failure',
  0x05: 'acknowledge',
  0x06: 'device busy',
  0x08: 'memory parity error',
  0x0a: 'gateway path unavailable',
  0x0b: 'gateway target failed to respond',
};

/**
 * A response the device refused — not a broken link.
 *
 * Its own type for two reasons: the user gets "illegal data address" instead of
 * "Timeout waiting for response" (which sends them looking at cables and baud
 * rates), and transfer() can skip the post-failure recovery flush, because an
 * exception is a complete CRC-valid frame with nothing stale left behind it.
 */
export class ModbusExceptionError extends Error {
  constructor(
    readonly functionCode: number,
    readonly exceptionCode: number,
  ) {
    super(
      `Modbus exception 0x${exceptionCode.toString(16).padStart(2, '0')}` +
        ` (${MODBUS_EXCEPTION_TEXT[exceptionCode] ?? 'unknown'})` +
        ` for function ${functionCode}`,
    );
    this.name = 'ModbusExceptionError';
  }
}

export type ScanResult =
  /** A complete, CRC-valid frame occupies buffer[0 .. length-1]. */
  | { kind: 'frame'; length: number; isException: boolean }
  /** The leading `count` bytes cannot begin our response. Drop and rescan. */
  | { kind: 'drop'; count: number }
  /** What is buffered is a valid prefix; `atLeast` bytes are needed in total. */
  | { kind: 'need'; atLeast: number };

/**
 * Decide what the buffered bytes are, for the request that was just sent.
 *
 * Header-first, which is why the result has three states rather than being a
 * boolean: byte count alone cannot tell a 37-byte success from a 5-byte
 * exception, and the length is only knowable once addr and fc are in hand. So
 * `need.atLeast` is 2 until the header arrives and only then becomes 5 or
 * `successLength`.
 *
 * Resync is one byte at a time and never a full clear: the byte being dropped
 * may itself be the first byte of the real frame, and clearing would discard a
 * response that had already arrived.
 *
 * @param buffer - Bytes received so far, oldest first.
 * @param slaveId - Expected unit address (the request's byte 0).
 * @param functionCode - Expected function code (the request's byte 1).
 * @param successLength - Total length of a successful response to this request.
 */
export function scanModbusFrame(
  buffer: readonly number[],
  slaveId: number,
  functionCode: number,
  successLength: number,
): ScanResult {
  if (buffer.length < 1) return { kind: 'need', atLeast: 2 };
  if (buffer[0] !== slaveId) return { kind: 'drop', count: 1 };
  if (buffer.length < 2) return { kind: 'need', atLeast: 2 };

  const fc = buffer[1];
  if ((fc & 0x7f) !== functionCode) return { kind: 'drop', count: 1 };

  const isException = (fc & 0x80) !== 0;

  // Read responses (FC1/3/4) carry their own byte count at [2], and for the
  // request just sent it is known exactly. Checking it here, before waiting for
  // `successLength` bytes, is what stops a stray `addr fc` pair in line noise
  // from being taken as the start of a 37-byte frame: without it, a complete
  // 5-byte exception queued right behind the noise was never looked at, and the
  // transfer timed out waiting for bytes that were never coming.
  if (!isException && READ_FUNCTION_CODES.has(functionCode)) {
    if (buffer.length < 3) return { kind: 'need', atLeast: 3 };
    if (buffer[2] !== successLength - READ_RESPONSE_OVERHEAD) return { kind: 'drop', count: 1 };
  }

  const length = isException ? MODBUS_EXCEPTION_FRAME_LENGTH : successLength;
  if (buffer.length < length) return { kind: 'need', atLeast: length };

  // The CRC is what makes the two single-byte checks above trustworthy: a stale
  // tail reproduces a plausible address and function code often enough that
  // neither is evidence on its own.
  const received = buffer[length - 2] | (buffer[length - 1] << 8);
  if (crc16(buffer, length - 2) !== received) return { kind: 'drop', count: 1 };

  return { kind: 'frame', length, isException };
}
