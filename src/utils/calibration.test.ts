import { describe, expect, it } from "vitest";
import { getLevelStatus, hx711RawToMvPerV } from "./calibration";

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

describe("getLevelStatus", () => {
	it("returns normal for zero", () => {
		expect(getLevelStatus(0)).toBe("normal");
	});

	it("returns normal below 80%", () => {
		expect(getLevelStatus(26213)).toBe("normal");
		expect(getLevelStatus(-26213)).toBe("normal");
	});

	it("returns warning at 80-90%", () => {
		expect(getLevelStatus(26214)).toBe("warning");
		expect(getLevelStatus(-26214)).toBe("warning");
		expect(getLevelStatus(29490)).toBe("warning");
	});

	it("returns danger at >=90%", () => {
		expect(getLevelStatus(29491)).toBe("danger");
		expect(getLevelStatus(-29491)).toBe("danger");
		expect(getLevelStatus(32767)).toBe("danger");
		expect(getLevelStatus(-32768)).toBe("danger");
	});
});
