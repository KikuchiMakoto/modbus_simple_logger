import type { RatedOutputValue } from "./calibration";
import type { RegressionResult } from "./regression";

export type CalibrationJson = {
	app: string;
	version: string;
	exportedAt: string;
	degree: number;
	coefficients: { a0: number; a1: number; a2: number };
	metrics: { r2: number; rmse: number };
	ratedCapacity?: number;
	ratedOutput?: RatedOutputValue;
	points: { timestamp: number; x: number; y: number }[];
};

export function calibrationToJson(
	result: RegressionResult,
	points: { timestamp: number; x: number; y: number }[],
	ratedCapacity?: number,
	ratedOutput?: RatedOutputValue,
): CalibrationJson {
	return {
		app: "ModbusStrainCalibrator",
		version: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
		exportedAt: new Date().toISOString(),
		degree: result.degree,
		coefficients: { a2: result.a2, a1: result.a1, a0: result.a0 },
		metrics: { r2: result.r2, rmse: result.rmse },
		...(ratedCapacity != null && ratedCapacity > 0 ? { ratedCapacity } : {}),
		...(ratedOutput ? { ratedOutput } : {}),
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
