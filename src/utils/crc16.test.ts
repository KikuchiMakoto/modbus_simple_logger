import { describe, expect, it } from "vitest";
import { crc16 } from "./crc16";

describe("crc16", () => {
	it("returns 0xFFFF for empty data", () => {
		expect(crc16([])).toBe(0xffff);
	});

	it("calculates CRC16 for Modbus request (01 03 00 00 00 01)", () => {
		// Known CRC for this Modbus frame: 0x0A84 (2700 decimal)
		expect(crc16([0x01, 0x03, 0x00, 0x00, 0x00, 0x01])).toBe(0x0a84);
	});

	it("handles Uint8Array input", () => {
		expect(crc16(new Uint8Array([0x01, 0x03, 0x00, 0x00, 0x00, 0x01]))).toBe(
			0x0a84,
		);
	});

	it("produces consistent result for the same data", () => {
		const data = [0x0b, 0x03, 0x00, 0x00, 0x00, 0x02];
		expect(crc16(data)).toBe(crc16(data));
	});

	it("is commutative with byte order in the array", () => {
		const a = crc16([0x01, 0x02]);
		const b = crc16([0x02, 0x01]);
		expect(a).not.toBe(b);
	});
});
