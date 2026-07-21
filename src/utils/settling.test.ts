import { describe, expect, it } from "vitest";
import { SettlingDetector } from "./settling";

function createDetector(
	overrides: Partial<{
		tolerance: number;
		windowSeconds: number;
		cutoffFrequency: number;
		samplingIntervalMs: number;
	}> = {},
) {
	return new SettlingDetector(
		{
			tolerance: overrides.tolerance ?? 5,
			windowSeconds: overrides.windowSeconds ?? 1,
			cutoffFrequency: overrides.cutoffFrequency ?? 10,
		},
		overrides.samplingIntervalMs ?? 200,
	);
}

describe("SettlingDetector", () => {
	it("returns stable for constant input after initial window", () => {
		const d = createDetector({
			tolerance: 5,
			windowSeconds: 0.4,
			cutoffFrequency: 10,
		});
		const results: boolean[] = [];
		for (let i = 0; i < 5; i++) {
			results.push(d.update(10000).stable);
		}
		expect(results[0]).toBe(false);
		expect(results[results.length - 1]).toBe(true);
	});

	it("never becomes stable with large oscillations", () => {
		const d = createDetector({
			tolerance: 5,
			windowSeconds: 0.4,
			cutoffFrequency: 10,
		});
		for (let i = 0; i < 20; i++) {
			const value = i % 2 === 0 ? 10000 : 11000;
			const result = d.update(value);
			if (i < 2) continue;
			expect(result.stable).toBe(false);
		}
	});

	it("becomes stable after oscillations settle", () => {
		const d = createDetector({
			tolerance: 10,
			windowSeconds: 0.4,
			cutoffFrequency: 10,
		});
		for (let i = 0; i < 10; i++) {
			d.update(i % 2 === 0 ? 10000 : 10008);
		}
		for (let i = 0; i < 10; i++) {
			const result = d.update(10005);
			if (i >= 2) {
				expect(result.stable).toBe(true);
			}
		}
	});

	it("returns filtered value close to input for constant input", () => {
		const d = createDetector({ cutoffFrequency: 10 });
		const result = d.update(12345);
		expect(result.filtered).toBeCloseTo(12345, 0);
	});

	it("returns range of zero for constant input", () => {
		const d = createDetector({
			tolerance: 5,
			windowSeconds: 0.4,
			cutoffFrequency: 10,
		});
		for (let i = 0; i < 5; i++) {
			d.update(10000);
		}
		const result = d.update(10000);
		expect(result.range).toBeCloseTo(0, 5);
	});

	it("resets state correctly", () => {
		const d = createDetector({
			tolerance: 5,
			windowSeconds: 0.4,
			cutoffFrequency: 10,
		});
		for (let i = 0; i < 5; i++) {
			d.update(10000);
		}
		expect(d.update(10000).stable).toBe(true);
		d.reset();
		const result = d.update(10000);
		expect(result.stable).toBe(false);
	});
});
