import type { RegressionResult } from "./regression";

export function calibrationToCsv(
	result: RegressionResult,
	points: { timestamp: number; x: number; y: number }[],
): string {
	const lines: string[] = [];

	lines.push(
		`# ModbusStrainCalibrator v${import.meta.env.VITE_APP_VERSION ?? "0.0.0"}`,
	);
	lines.push(`# degree=${result.degree}`);
	lines.push(`# a=${result.a}`);
	lines.push(`# b=${result.b}`);
	lines.push(`# c=${result.c}`);
	lines.push(`# r2=${result.r2}`);
	lines.push(`# rmse=${result.rmse}`);
	lines.push(`# n=${result.n}`);
	lines.push(`# updated_at=${new Date().toISOString()}`);
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
