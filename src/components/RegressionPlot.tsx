import { Plot } from "../plotly";
import type { CalibrationPoint, CalibrationResult } from "../types";

interface RegressionPlotProps {
	points: CalibrationPoint[];
	result: CalibrationResult | null;
	isDark: boolean;
}

export function RegressionPlot({
	points,
	result,
	isDark,
}: RegressionPlotProps) {
	// biome-ignore lint/suspicious/noExplicitAny: Plotly trace shapes
	const traces: any[] = [
		{
			x: points.map((p) => p.x),
			y: points.map((p) => p.y),
			type: "scattergl",
			mode: "markers",
			name: "Points",
			marker: { color: "#10b981", size: 8 },
		},
	];

	if (result && points.length >= 2) {
		const xMin = Math.min(...points.map((p) => p.x));
		const xMax = Math.max(...points.map((p) => p.x));
		const padding = (xMax - xMin) * 0.1 || 1;
		const x0 = xMin - padding;
		const x1 = xMax + padding;

		const xFit = [x0, x1];
		let yFit: number[];
		if (result.degree === 2) {
			yFit = xFit.map((x) => result.a * x * x + result.b * x + result.c);
		} else {
			yFit = xFit.map((x) => result.a * x + result.b);
		}

		traces.push({
			x: xFit,
			y: yFit,
			type: "scattergl",
			mode: "lines",
			name: `Fit (R²=${result.r2.toFixed(4)})`,
			line: { color: "#f59e0b", width: 2, dash: "dot" },
		});
	}

	const layout = {
		margin: { l: 40, r: 10, t: 8, b: 24 },
		paper_bgcolor: isDark ? "#1e293b" : "#ffffff",
		plot_bgcolor: isDark ? "#1e293b" : "#ffffff",
		font: { color: isDark ? "#e2e8f0" : "#334155", size: 10 },
		xaxis: {
			title: { text: "x (filtered raw)", font: { size: 10 } },
			zeroline: true,
			zerolinecolor: isDark ? "#475569" : "#cbd5e1",
			gridcolor: isDark ? "#334155" : "#e2e8f0",
		},
		yaxis: {
			title: { text: "y (applied)", font: { size: 10 } },
			zeroline: true,
			zerolinecolor: isDark ? "#475569" : "#cbd5e1",
			gridcolor: isDark ? "#334155" : "#e2e8f0",
		},
		showlegend: true,
		legend: { font: { size: 10 }, x: 1, xanchor: "right" as const, y: 1 },
		autosize: true,
	};

	const config = {
		displayModeBar: false,
		responsive: true,
	};

	return (
		<div className="h-64 w-full">
			<Plot data={traces} layout={layout} config={config} />
		</div>
	);
}
