import { describe, expect, it } from "vitest";
import { hx711RawToMvPerV } from "./calibration";

describe("hx711RawToMvPerV", () => {
	it("converts zero to zero", () => {
		expect(hx711RawToMvPerV(0)).toBe(0);
	});

	it("converts positive raw value", () => {
		const result = hx711RawToMvPerV(32768);
		expect(result).toBeCloseTo(1000 / (128 * 2), 10);
	});

	it("converts negative raw value", () => {
		const result = hx711RawToMvPerV(-32768);
		expect(result).toBeCloseTo(-1000 / (128 * 2), 10);
	});

	it("converts full scale", () => {
		const result = hx711RawToMvPerV(8388608);
		expect(result).toBeCloseTo(1000, 10);
	});
});
