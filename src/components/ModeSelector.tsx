import type { CalibrationMode } from "../types";

interface ModeSelectorProps {
	mode: CalibrationMode;
	onChange: (mode: CalibrationMode) => void;
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
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
			</button>
		</div>
	);
}
