import { describe, expect, it } from "vitest";
import {
	HX711_MV_PER_V_SCALE,
	calculateRatedOutput,
	getLevelStatus,
	hx711RawToMvPerV,
} from "./calibration";

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

describe("calculateRatedOutput (linear)", () => {
	it("computes rated output span for positive load", () => {
		const result = calculateRatedOutput(0, 2, 0, 1, 100, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(50, 5);
		expect(result.value.rawZero).toBeCloseTo(0, 5);
		expect(result.value.rawRated).toBeCloseTo(50, 5);
		expect(result.value.mVPerV).toBeCloseTo(50 * HX711_MV_PER_V_SCALE, 10);
		expect(result.value.extrapolated).toBe(false);
	});

	it("computes rated output span with zero offset (span = R/a1)", () => {
		const result = calculateRatedOutput(1, 2, 0, 1, 101, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(50.5, 5);
		expect(result.value.rawZero).toBeCloseTo(-0.5, 5);
		expect(result.value.rawRated).toBeCloseTo(50, 5);
		expect(result.value.mVPerV).toBeCloseTo(50.5 * HX711_MV_PER_V_SCALE, 10);
	});

	it("detects extrapolation when raw outside x range", () => {
		const result = calculateRatedOutput(0, 2, 0, 1, 300, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(150, 5);
		expect(result.value.extrapolated).toBe(true);
	});

	it("returns error for zero rated capacity", () => {
		const result = calculateRatedOutput(0, 2, 0, 1, 0, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("must be positive");
	});

	it("returns error for negative rated capacity", () => {
		const result = calculateRatedOutput(0, 2, 0, 1, -100, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(false);
	});

	it("returns error when a1 is zero", () => {
		const result = calculateRatedOutput(5, 0, 0, 1, 100, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("a1 is zero");
	});

	it("extrapolated defaults to true when no xRange provided", () => {
		const result = calculateRatedOutput(0, 2, 0, 1, 100);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.extrapolated).toBe(true);
	});
});

describe("calculateRatedOutput (quadratic)", () => {
	it("computes rated output span for quadratic curve through zero", () => {
		const result = calculateRatedOutput(0, 2, 1, 2, 15, {
			min: -2,
			max: 5,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(3, 5);
		expect(result.value.rawZero).toBeCloseTo(0, 5);
		expect(result.value.rawRated).toBeCloseTo(3, 5);
		expect(result.value.mVPerV).toBeCloseTo(3 * HX711_MV_PER_V_SCALE, 10);
	});

	it("returns error when zero discriminant is negative", () => {
		const result = calculateRatedOutput(1, 2, 3, 2, 6, {
			min: -2,
			max: 2,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("does not pass through zero");
	});

	it("returns error when rated discriminant is negative", () => {
		const result = calculateRatedOutput(100, 0, -1, 2, 200, {
			min: -10,
			max: 10,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("exceeds the maximum");
	});

	it("falls back to linear when a2 is near zero", () => {
		const result = calculateRatedOutput(0, 2, 1e-16, 2, 100, {
			min: 0,
			max: 100,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(50, 5);
	});

	it("selects correct root pair for span", () => {
		const result = calculateRatedOutput(0, 2, 0.1, 2, 30, {
			min: 0,
			max: 12,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.raw).toBeCloseTo(10, 5);
		expect(result.value.rawZero).toBeCloseTo(0, 5);
		expect(result.value.rawRated).toBeCloseTo(10, 5);
	});
});
