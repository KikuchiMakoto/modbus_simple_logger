/**
 * CRC16 calculation for Modbus RTU (polynomial 0xA001, reflected)
 * Pure implementation - replaces modbus-serial/utils/crc16 + buffer dependency
 */

const CRC16_TABLE = new Uint16Array(256);

// Precompute lookup table
for (let i = 0; i < 256; i++) {
	let crc = i;
	for (let j = 0; j < 8; j++) {
		crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
	}
	CRC16_TABLE[i] = crc;
}

/**
 * Calculate Modbus CRC16 for a byte array
 * @param data - Uint8Array or number array of bytes
 * @returns CRC16 value (0-65535)
 */
export function crc16(data: Uint8Array | number[]): number {
	let crc = 0xffff;
	for (let i = 0; i < data.length; i++) {
		crc = CRC16_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return crc;
}
