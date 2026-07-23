import { describe, expect, it, vi } from "vitest";
import { calibrationToJson, downloadJson } from "./jsonExport";
import type { RegressionResult } from "./regression";

const mockResult: RegressionResult = {
	degree: 1,
	a2: 0,
	a1: 2,
	a0: 1,
	r2: 0.999,
	rmse: 0.05,
	n: 5,
};

const mockPoints = [
	{ timestamp: 1000, x: 10, y: 21 },
	{ timestamp: 2000, x: 20, y: 41 },
];

describe("calibrationToJson", () => {
	it("returns an object with correct structure", () => {
		const json = calibrationToJson(mockResult, mockPoints);
		expect(json.app).toBe("ModbusStrainCalibrator");
		expect(json.version).toBe(import.meta.env.VITE_APP_VERSION ?? "0.0.0");
		expect(json.degree).toBe(1);
		expect(json.coefficients).toEqual({ a0: 1, a1: 2, a2: 0 });
		expect(json.metrics).toEqual({ r2: 0.999, rmse: 0.05 });
	});

	it("includes all data points", () => {
		const json = calibrationToJson(mockResult, mockPoints);
		expect(json.points).toHaveLength(2);
		expect(json.points[0]).toEqual({ timestamp: 1000, x: 10, y: 21 });
	});

	it("exports a timestamp in ISO format", () => {
		const json = calibrationToJson(mockResult, mockPoints);
		expect(json.exportedAt).toBeDefined();
		expect(typeof json.exportedAt).toBe("string");
	});

	it("includes rated output fields when provided", () => {
		const json = calibrationToJson(mockResult, mockPoints, 100, {
			raw: 50,
			rawZero: 0,
			rawRated: 50,
			mVPerV: 1.95,
			extrapolated: false,
		});
		expect(json.ratedCapacity).toBe(100);
		expect(json.ratedOutput).toEqual({
			raw: 50,
			rawZero: 0,
			rawRated: 50,
			mVPerV: 1.95,
			extrapolated: false,
		});
	});

	it("omits rated capacity when zero", () => {
		const json = calibrationToJson(mockResult, mockPoints, 0);
		expect(json.ratedCapacity).toBeUndefined();
		expect(json.ratedOutput).toBeUndefined();
	});

	it("omits rated output fields when not provided", () => {
		const json = calibrationToJson(mockResult, mockPoints);
		expect(json.ratedCapacity).toBeUndefined();
		expect(json.ratedOutput).toBeUndefined();
	});
});

describe("downloadJson", () => {
	it("creates a blob, appends a link, clicks it, and cleans up", () => {
		const createObjectURL = vi.fn(() => "blob:test");
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

		let appendedLink: HTMLAnchorElement | null = null;
		const appendChild = vi.fn((el: HTMLAnchorElement) => {
			appendedLink = el;
		});
		const removeChild = vi.fn();
		const click = vi.fn();
		vi.stubGlobal("document", {
			createElement: vi.fn(() => ({ click }) as unknown as HTMLAnchorElement),
			body: { appendChild, removeChild },
		});

		downloadJson("test.json", { key: "value" });

		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(appendChild).toHaveBeenCalledOnce();
		expect(click).toHaveBeenCalledOnce();
		expect(removeChild).toHaveBeenCalledOnce();
		expect(revokeObjectURL).toHaveBeenCalledOnce();

		vi.unstubAllGlobals();
	});
});
