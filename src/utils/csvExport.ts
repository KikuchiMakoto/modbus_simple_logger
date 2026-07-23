import type { RatedOutputValue } from "./calibration";
import type { RegressionResult } from "./regression";

export function calibrationToCsv(
	result: RegressionResult,
	points: { timestamp: number; x: number; y: number }[],
	ratedCapacity?: number,
	ratedOutput?: RatedOutputValue,
): string {
	const lines: string[] = [];

	lines.push(
		`# ModbusStrainCalibrator v${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}`,
	);
	lines.push(`# degree=${result.degree}`);
	lines.push(`# a2=${result.a2}`);
	lines.push(`# a1=${result.a1}`);
	lines.push(`# a0=${result.a0}`);
	lines.push(`# r2=${result.r2}`);
	lines.push(`# rmse=${result.rmse}`);
	lines.push(`# n=${result.n}`);
	lines.push(`# updated_at=${new Date().toISOString()}`);
	if (ratedCapacity != null && ratedCapacity > 0) {
		lines.push(`# rated_capacity=${ratedCapacity}`);
	}
	if (ratedOutput) {
		lines.push(`# rated_output_raw=${ratedOutput.raw}`);
		lines.push(`# rated_output_mV_V=${ratedOutput.mVPerV}`);
	}
	lines.push("timestamp_ms,x_filtered_raw,y_applied");

	for (const p of points) {
		lines.push(`${p.timestamp},${p.x},${p.y}`);
	}

	return lines.join("\n");
}

export function downloadCsv(filename: string, content: string): void {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}
