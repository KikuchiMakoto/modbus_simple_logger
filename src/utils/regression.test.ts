import { describe, expect, it } from "vitest";
import { fitRegression } from "./regression";
import type { RegressionInput } from "./regression";

describe("fitRegression (linear)", () => {
	it("fits perfect linear data (y = 2x + 1)", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 1 },
			{ x: 1, y: 3 },
			{ x: 2, y: 5 },
			{ x: 3, y: 7 },
			{ x: 4, y: 9 },
		];
		const result = fitRegression(points, 1);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a2).toBe(0);
		expect(result.value.a1).toBeCloseTo(2, 10);
		expect(result.value.a0).toBeCloseTo(1, 10);
		expect(result.value.r2).toBeCloseTo(1, 10);
		expect(result.value.rmse).toBeCloseTo(0, 10);
		expect(result.value.n).toBe(5);
		expect(result.value.degree).toBe(1);
	});

	it("fits noisy linear data within tolerance", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 0.9 },
			{ x: 1, y: 3.2 },
			{ x: 2, y: 4.8 },
			{ x: 3, y: 7.1 },
			{ x: 4, y: 9.2 },
		];
		const result = fitRegression(points, 1);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a1).toBeCloseTo(2.05, 2);
		expect(result.value.a0).toBeCloseTo(0.94, 2);
		expect(result.value.r2).toBeGreaterThan(0.99);
	});

	it("returns error for single point", () => {
		const result = fitRegression([{ x: 1, y: 2 }], 1);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("At least 2");
	});

	it("returns error for all identical x values", () => {
		const points: RegressionInput[] = [
			{ x: 5, y: 1 },
			{ x: 5, y: 2 },
			{ x: 5, y: 3 },
		];
		const result = fitRegression(points, 1);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("identical");
	});

	it("handles y = constant (horizontal line)", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 5 },
			{ x: 1, y: 5 },
			{ x: 2, y: 5 },
		];
		const result = fitRegression(points, 1);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a1).toBeCloseTo(0, 10);
		expect(result.value.a0).toBeCloseTo(5, 10);
		expect(result.value.r2).toBeCloseTo(1, 10);
	});
});

describe("fitRegression (quadratic)", () => {
	it("fits perfect quadratic data (y = 3x² + 2x + 1)", () => {
		const points: RegressionInput[] = [
			{ x: -2, y: 9 },
			{ x: -1, y: 2 },
			{ x: 0, y: 1 },
			{ x: 1, y: 6 },
			{ x: 2, y: 17 },
		];
		const result = fitRegression(points, 2);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a2).toBeCloseTo(3, 8);
		expect(result.value.a1).toBeCloseTo(2, 8);
		expect(result.value.a0).toBeCloseTo(1, 8);
		expect(result.value.r2).toBeCloseTo(1, 10);
		expect(result.value.degree).toBe(2);
	});

	it("returns error for 2 points with degree 2", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		];
		const result = fitRegression(points, 2);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("At least 3");
	});

	it("returns error for singular matrix (all x identical)", () => {
		const points: RegressionInput[] = [
			{ x: 3, y: 1 },
			{ x: 3, y: 2 },
			{ x: 3, y: 3 },
		];
		const result = fitRegression(points, 2);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("Singular");
	});

	it("handles constant y values with degree 2 (r² = 1)", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 5 },
			{ x: 1, y: 5 },
			{ x: 2, y: 5 },
		];
		const result = fitRegression(points, 2);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a2).toBeCloseTo(0, 5);
		expect(result.value.a1).toBeCloseTo(0, 5);
		expect(result.value.a0).toBeCloseTo(5, 5);
		expect(result.value.r2).toBeCloseTo(1, 10);
	});

	it("handles linear data with degree 2 (a ≈ 0)", () => {
		const points: RegressionInput[] = [
			{ x: 0, y: 1 },
			{ x: 1, y: 3 },
			{ x: 2, y: 5 },
			{ x: 3, y: 7 },
		];
		const result = fitRegression(points, 2);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.a2).toBeCloseTo(0, 5);
		expect(result.value.a1).toBeCloseTo(2, 5);
		expect(result.value.a0).toBeCloseTo(1, 5);
		expect(result.value.r2).toBeCloseTo(1, 10);
	});
});
