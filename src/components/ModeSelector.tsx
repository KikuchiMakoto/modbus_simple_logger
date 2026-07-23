import type { CalibrationMode } from "../types";

interface ModeSelectorProps {
	mode: CalibrationMode;
	onChange: (mode: CalibrationMode) => void;
	points1port: number;
	points2port: number;
}

export function ModeSelector({
	mode,
	onChange,
	points1port,
	points2port,
}: ModeSelectorProps) {
	return (
		<div className="flex gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
			<button
				type="button"
				className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
					mode === "1port"
						? "bg-emerald-500 text-emerald-950"
						: "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
				}`}
				onClick={() => onChange("1port")}
			>
				1-port
				{points1port > 0 && mode !== "1port" && (
					<span className="ml-1 text-xs opacity-70">{points1port}</span>
				)}
			</button>
			<button
				type="button"
				className={`rounded-md px-3 py-1 text-sm font-semibold transition-colors ${
					mode === "2port"
						? "bg-emerald-500 text-emerald-950"
						: "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
				}`}
				onClick={() => onChange("2port")}
			>
				2-port
				{points2port > 0 && mode !== "2port" && (
					<span className="ml-1 text-xs opacity-70">{points2port}</span>
				)}
			</button>
		</div>
	);
}
