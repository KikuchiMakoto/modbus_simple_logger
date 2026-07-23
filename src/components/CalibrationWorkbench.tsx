import { useState } from "react";
import type {
	CalibrationDegree,
	CalibrationMode,
	CalibrationPoint,
	CalibrationResult,
	XUnit,
} from "../types";
import { hx711RawToMvPerV } from "../utils/calibration";
import { CalibrationRow } from "./CalibrationRow";
import { RegressionResultPanel } from "./RegressionResultPanel";

interface CalibrationWorkbenchProps {
	points: CalibrationPoint[];
	degree: CalibrationDegree;
	result: CalibrationResult | null;
	validationError: string | null;
	currentFilteredRaw: number;
	addPointEnabled: boolean;
	xUnit: XUnit;
	mode: CalibrationMode;
	currentRefPhysical: number;
	ratedCapacity: number;
	onAddPoint: (x: number, y: number) => void;
	onRemovePoint: (index: number) => void;
	onUpdatePointY: (index: number, y: number) => void;
	onClear: () => void;
	onDegreeChange: (degree: CalibrationDegree) => void;
	onXUnitChange: (unit: XUnit) => void;
	onRatedCapacityChange: (value: number) => void;
	onExportCsv: () => void;
	onExportJson: () => void;
}

function formatX(x: number, unit: XUnit): string {
	let value: number;
	switch (unit) {
		case "mv_per_v":
			value = hx711RawToMvPerV(x);
			return value.toFixed(4);
		case "micro_strain":
			value = hx711RawToMvPerV(x) * 2000;
			return value.toFixed(2);
		default:
			return x.toFixed(4);
	}
}

const X_UNIT_OPTIONS: { value: XUnit; label: string }[] = [
	{ value: "raw", label: "raw counts" },
	{ value: "mv_per_v", label: "mV/V" },
	{ value: "micro_strain", label: "με" },
];

export function CalibrationWorkbench({
	points,
	degree,
	result,
	validationError,
	currentFilteredRaw,
	addPointEnabled,
	xUnit,
	mode,
	currentRefPhysical,
	ratedCapacity,
	onAddPoint,
	onRemovePoint,
	onUpdatePointY,
	onClear,
	onDegreeChange,
	onXUnitChange,
	onRatedCapacityChange,
	onExportCsv,
	onExportJson,
}: CalibrationWorkbenchProps) {
	const [yInput, setYInput] = useState("0");

	const handleAddPoint = () => {
		if (mode === "2port") {
			onAddPoint(currentFilteredRaw, currentRefPhysical);
		} else {
			const y = Number(yInput);
			if (Number.isNaN(y)) return;
			onAddPoint(currentFilteredRaw, y);
		}
	};

	const currentFilteredDisplay = formatX(currentFilteredRaw, xUnit);

	return (
		<div className="flex h-full flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				{mode === "2port" ? (
					<span className="w-24 text-right font-mono text-sm text-slate-900 dark:text-slate-100">
						{currentRefPhysical.toFixed(4)}
					</span>
				) : (
					<input
						type="number"
						step="any"
						value={yInput}
						onChange={(e) => setYInput(e.target.value)}
						placeholder="y applied"
						className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
					/>
				)}
				<button
					type="button"
					className="button-primary text-sm"
					disabled={!addPointEnabled}
					onClick={handleAddPoint}
				>
					+ Add Point
				</button>
				<button
					type="button"
					className="button-secondary text-sm"
					onClick={onExportCsv}
				>
					CSV
				</button>
				<button
					type="button"
					className="button-secondary text-sm"
					onClick={onExportJson}
				>
					JSON
				</button>
				<button
					type="button"
					className="button-secondary text-sm text-red-500 hover:border-red-400"
					onClick={onClear}
				>
					Clear
				</button>
			</div>

			<div className="flex flex-wrap items-center gap-2 text-xs">
				<span className="text-slate-500 dark:text-slate-400">x unit:</span>
				<select
					value={xUnit}
					onChange={(e) => onXUnitChange(e.target.value as XUnit)}
					className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				>
					{X_UNIT_OPTIONS.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>

				<span className="ml-2 text-slate-500 dark:text-slate-400">Degree:</span>
				<select
					value={degree}
					onChange={(e) =>
						onDegreeChange(Number(e.target.value) as CalibrationDegree)
					}
					className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				>
					<option value={1}>1 (linear)</option>
					<option value={2}>2 (quadratic)</option>
				</select>

				<span className="ml-2 text-slate-500 dark:text-slate-400">
					Rated capacity:
				</span>
				<input
					type="number"
					step="any"
					min="0"
					value={ratedCapacity || ""}
					onChange={(e) => onRatedCapacityChange(Number(e.target.value) || 0)}
					placeholder="same unit as y"
					className="w-28 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
				/>
			</div>

			<div className="flex items-center gap-1 border-b border-slate-200 pb-1 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
				<span className="w-6 text-center">#</span>
				<span className="flex-1 text-right">x ({xUnit})</span>
				<span className="w-24 text-right">y</span>
				<span className="w-4" />
			</div>

			<div className="flex-1 space-y-0.5 overflow-y-auto">
				{points.map((p, i) => (
					<CalibrationRow
						key={p.timestamp}
						index={i}
						xDisplay={formatX(p.x, xUnit)}
						y={p.y}
						mode={mode}
						onUpdateY={onUpdatePointY}
						onRemove={onRemovePoint}
					/>
				))}
				{points.length === 0 && (
					<div className="py-8 text-center text-xs text-slate-400">
						No points yet. Add a point when stable.
						<div className="mt-1 font-mono text-emerald-500">
							Current filtered: {currentFilteredDisplay}
						</div>
					</div>
				)}
			</div>

			<div className="border-t border-slate-200 pt-2 dark:border-slate-700">
				<RegressionResultPanel
					result={result}
					validationError={validationError}
				/>
			</div>
		</div>
	);
}
