/**
 * CRC16 calculation for Modbus RTU (polynomial 0xA001, reflected)
 * Pure implementation - replaces modbus-serial/utils/crc16 + buffer dependency
 */

const CRC16_TABLE = new Uint16Array(256);

// Precompute lookup table
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1;
  }
  CRC16_TABLE[i] = crc;
}

/**
 * Calculate Modbus CRC16 for a byte array
 * @param data - Uint8Array or readonly number array of bytes
 * @param length - Optional maximum number of bytes to include (default: data.length)
 * @returns CRC16 value (0-65535)
 */
export function crc16(data: Uint8Array | readonly number[], length: number = data.length): number {
  let crc = 0xFFFF;
  const requestedLength = Number.isFinite(length) ? Math.trunc(length) : 0;
  const len = Math.max(0, Math.min(data.length, requestedLength));
  for (let i = 0; i < len; i++) {
    crc = CRC16_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return crc;
}
