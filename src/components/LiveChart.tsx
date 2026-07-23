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
	refRawHistory?: Float32Array;
	refFilteredHistory?: Float32Array;
	currentRefRaw?: number;
	currentRefFiltered?: number;
	currentRefPhysical?: number;
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
	refRawHistory = new Float32Array(0),
	refFilteredHistory = new Float32Array(0),
	currentRefRaw = 0,
	currentRefFiltered = 0,
	currentRefPhysical = 0,
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

	const refYRange = useMemo(() => {
		const values: number[] = [];
		for (let i = 0; i < refRawHistory.length; i++) {
			if (refRawHistory[i] !== 0) values.push(refRawHistory[i]);
			if (refFilteredHistory[i] !== 0) values.push(refFilteredHistory[i]);
		}
		if (values.length === 0) return [0, 1] as [number, number];
		const min = Math.min(...values);
		const max = Math.max(...values);
		if (min === max) return [min - 10, max + 10] as [number, number];
		const pad = (max - min) * 0.15;
		return [min - pad, max + pad] as [number, number];
	}, [refRawHistory, refFilteredHistory]);

	// biome-ignore lint/suspicious/noExplicitAny: Plotly trace shapes
	const data: any[] = [
		{
			x: timeAxis,
			y: rawHistory,
			type: "scattergl",
			mode: "lines",
			name: "Raw",
			line: { width: 1, color: "rgba(16,185,129,0.5)" },
		},
		{
			x: timeAxis,
			y: filteredHistory,
			type: "scattergl",
			mode: "lines",
			name: "Filtered",
			line: { width: 2, color: "#10b981" },
		},
		...(refRawHistory.length > 0
			? [
					{
						x: timeAxis,
						y: refRawHistory,
						type: "scattergl" as const,
						mode: "lines" as const,
						name: "Ref Raw",
						yaxis: "y2" as const,
						line: { width: 1, color: "rgba(244,63,94,0.5)" },
					},
					{
						x: timeAxis,
						y: refFilteredHistory,
						type: "scattergl" as const,
						mode: "lines" as const,
						name: "Ref Filtered",
						yaxis: "y2" as const,
						line: { width: 2, color: "#f43f5e" },
					},
				]
			: []),
	];

	const showRef = refRawHistory.length > 0;

	const titleText = showRef
		? `<span style="color:#10b981">CH ${currentRaw.toFixed(4)} F ${currentFiltered.toFixed(4)}</span> ${currentMvPerV.toFixed(4)} mV/V ${isStable ? "●" : "○"}<br><span style="color:#f43f5e">${currentRefPhysical.toFixed(4)} Ref ${currentRefRaw.toFixed(4)} F ${currentRefFiltered.toFixed(4)}</span>`
		: `<span style="color:#10b981">CH ${currentRaw.toFixed(4)} F ${currentFiltered.toFixed(4)}</span> | ${currentMvPerV.toFixed(4)} mV/V | ${isStable ? "●" : "○"}`;

	const layout = {
		title: {
			text: titleText,
			font: { size: 11 },
		},
		margin: { l: 40, r: showRef ? 50 : 10, t: 28, b: 24 },
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
		...(showRef && {
			yaxis2: {
				title: { text: "Ref" },
				overlaying: "y",
				side: "right",
				range: refYRange,
				autorange: false,
				zeroline: false,
				gridcolor: isDark ? "#334155" : "#e2e8f0",
			},
		}),
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
