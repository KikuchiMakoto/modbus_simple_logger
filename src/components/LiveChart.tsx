import { useMemo } from "react";
import { Plot } from "../plotly";

interface LiveChartProps {
	rawHistory: Float32Array;
	filteredHistory: Float32Array;
	historyWindowSeconds: number;
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
	historyWindowSeconds,
	currentRaw,
	currentFiltered,
	currentMvPerV,
	currentPhysical,
	isStable,
	isDark,
}: LiveChartProps) {
	const timeAxis = useMemo(() => {
		const n = rawHistory.length;
		const result = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			result[i] = -historyWindowSeconds + (i / n) * historyWindowSeconds;
		}
		return result;
	}, [rawHistory.length, historyWindowSeconds]);

	const yRange = useMemo(() => {
		const values: number[] = [];
		for (let i = 0; i < rawHistory.length; i++) {
			if (rawHistory[i] !== 0) values.push(rawHistory[i]);
			if (filteredHistory[i] !== 0) values.push(filteredHistory[i]);
		}
		if (values.length === 0) return [0, 1] as [number, number];
		const min = Math.min(...values);
		const max = Math.max(...values);
		if (min === max) return [min - 10, max + 10] as [number, number];
		const pad = (max - min) * 0.15;
		return [min - pad, max + pad] as [number, number];
	}, [rawHistory, filteredHistory]);

	// biome-ignore lint/suspicious/noExplicitAny: Plotly trace shapes
	const data: any[] = [
		{
			x: timeAxis,
			y: rawHistory,
			type: "scattergl",
			mode: "lines",
			name: "Raw",
			line: { width: 1, color: "#94a3b8" },
		},
		{
			x: timeAxis,
			y: filteredHistory,
			type: "scattergl",
			mode: "lines",
			name: "Filtered",
			line: { width: 2, color: "#10b981" },
		},
	];

	const layout = {
		title: {
			text: `<span style="color:#94a3b8">CH ${currentRaw.toFixed(1)}</span> | <span style="color:#10b981">F ${currentFiltered.toFixed(1)}</span> | ${currentMvPerV.toFixed(3)} mV/V | ${currentPhysical.toFixed(3)} ${isStable ? "●" : "○"}`,
			font: { size: 11 },
		},
		margin: { l: 40, r: 10, t: 28, b: 24 },
		paper_bgcolor: isDark ? "#1e293b" : "#ffffff",
		plot_bgcolor: isDark ? "#1e293b" : "#ffffff",
		font: { color: isDark ? "#e2e8f0" : "#334155", size: 10 },
		xaxis: {
			visible: true,
			zeroline: false,
			ticksuffix: " s",
			gridcolor: isDark ? "#334155" : "#e2e8f0",
		},
		yaxis: {
			range: yRange,
			autorange: false,
			zeroline: true,
			zerolinecolor: isDark ? "#475569" : "#cbd5e1",
			gridcolor: isDark ? "#334155" : "#e2e8f0",
		},
		showlegend: false,
		autosize: true,
	};

	const config = {
		displayModeBar: false,
	};

	return (
		<div className="h-48 w-full">
			<Plot
				data={data}
				layout={layout}
				config={config}
				style={{ width: "100%", height: "100%" }}
				useResizeHandler
			/>
		</div>
	);
}
