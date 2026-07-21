import { Plot } from "../plotly";

interface LiveChartProps {
	rawHistory: Float32Array;
	filteredHistory: Float32Array;
	currentRaw: number;
	currentFiltered: number;
	currentMvPerV: number;
	currentPhysical: number;
	isStable: boolean;
	isDark: boolean;
}

export function LiveChart({
	rawHistory,
	filteredHistory,
	currentRaw,
	currentFiltered,
	currentMvPerV,
	currentPhysical,
	isStable,
	isDark,
}: LiveChartProps) {
	const indices = rawHistory.map((_, i) => i);

	// biome-ignore lint/suspicious/noExplicitAny: Plotly trace shapes
	const data: any[] = [
		{
			x: indices,
			y: rawHistory,
			type: "scattergl",
			mode: "lines",
			name: "Raw",
			line: { width: 1, color: "#94a3b8" },
		},
		{
			x: indices,
			y: filteredHistory,
			type: "scattergl",
			mode: "lines",
			name: "Filtered",
			line: { width: 2, color: "#10b981" },
		},
	];

	const layout = {
		title: {
			text: `CH ${currentRaw.toFixed(0)} | F ${currentFiltered.toFixed(0)} | ${currentMvPerV.toFixed(3)} mV/V | ${currentPhysical.toFixed(3)} ${isStable ? "●" : "○"}`,
			font: { size: 11 },
		},
		margin: { l: 40, r: 10, t: 28, b: 24 },
		paper_bgcolor: isDark ? "#1e293b" : "#ffffff",
		plot_bgcolor: isDark ? "#1e293b" : "#ffffff",
		font: { color: isDark ? "#e2e8f0" : "#334155", size: 10 },
		xaxis: {
			visible: false,
			zeroline: false,
		},
		yaxis: {
			zeroline: true,
			zerolinecolor: isDark ? "#475569" : "#cbd5e1",
			gridcolor: isDark ? "#334155" : "#e2e8f0",
		},
		showlegend: false,
		autosize: true,
	};

	const config = {
		displayModeBar: false,
		responsive: true,
	};

	return (
		<div className="h-48 w-full">
			<Plot data={data} layout={layout} config={config} />
		</div>
	);
}
