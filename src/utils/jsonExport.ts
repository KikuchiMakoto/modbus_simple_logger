import type { RegressionResult } from "./regression";

export type CalibrationJson = {
	app: string;
	version: string;
	exportedAt: string;
	degree: number;
	coefficients: { a: number; b: number; c: number };
	metrics: { r2: number; rmse: number };
	points: { timestamp: number; x: number; y: number }[];
};

export function calibrationToJson(
	result: RegressionResult,
	points: { timestamp: number; x: number; y: number }[],
): CalibrationJson {
	return {
		app: "ModbusStrainCalibrator",
		version: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
		exportedAt: new Date().toISOString(),
		degree: result.degree,
		coefficients: { a: result.a, b: result.b, c: result.c },
		metrics: { r2: result.r2, rmse: result.rmse },
		points: points.map((p) => ({
			timestamp: p.timestamp,
			x: p.x,
			y: p.y,
		})),
	};
}

export function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
