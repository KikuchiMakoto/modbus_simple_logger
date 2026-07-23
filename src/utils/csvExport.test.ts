import { describe, expect, it, vi } from "vitest";
import { calibrationToCsv, downloadCsv } from "./csvExport";
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

describe("calibrationToCsv", () => {
	it("returns a CSV string with header and metadata", () => {
		const csv = calibrationToCsv(mockResult, mockPoints);
		expect(csv).toContain("# degree=1");
		expect(csv).toContain("# a1=2");
		expect(csv).toContain("# a0=1");
		expect(csv).toContain("# r2=0.999");
		expect(csv).toContain("# rmse=0.05");
		expect(csv).toContain("# n=5");
	});

	it("contains csv column header", () => {
		const csv = calibrationToCsv(mockResult, mockPoints);
		expect(csv).toContain("timestamp_ms,x_filtered_raw,y_applied");
	});

	it("contains data points", () => {
		const csv = calibrationToCsv(mockResult, mockPoints);
		expect(csv).toContain("1000,10,21");
		expect(csv).toContain("2000,20,41");
	});

	it("lines are joined by newline", () => {
		const csv = calibrationToCsv(mockResult, mockPoints);
		const lines = csv.split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(11);
	});
});

describe("downloadCsv", () => {
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

		downloadCsv("test.csv", "a,b\n1,2");

		expect(createObjectURL).toHaveBeenCalledOnce();
		expect(appendChild).toHaveBeenCalledOnce();
		expect(click).toHaveBeenCalledOnce();
		expect(removeChild).toHaveBeenCalledOnce();
		expect(revokeObjectURL).toHaveBeenCalledOnce();

		vi.unstubAllGlobals();
	});
});
