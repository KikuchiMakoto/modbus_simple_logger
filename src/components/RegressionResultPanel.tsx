import type { CalibrationResult } from "../types";

interface RegressionResultPanelProps {
	result: CalibrationResult | null;
	validationError: string | null;
}

export function RegressionResultPanel({
	result,
	validationError,
}: RegressionResultPanelProps) {
	if (validationError) {
		return (
			<div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
				{validationError}
			</div>
		);
	}

	if (!result) {
		return (
			<div className="text-xs text-slate-400 dark:text-slate-500">
				Add points to calculate regression
			</div>
		);
	}

	return (
		<div className="space-y-1 text-xs">
			<div className="font-semibold text-slate-700 dark:text-slate-300">
				Coefficients (x: raw counts)
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
				<span className="text-slate-500 dark:text-slate-400">a =</span>
				<span className="text-right font-mono text-slate-900 dark:text-slate-100">
					{result.a.toExponential(6)}
				</span>
				{result.degree === 2 && (
					<>
						<span className="text-slate-500 dark:text-slate-400">b =</span>
						<span className="text-right font-mono text-slate-900 dark:text-slate-100">
							{result.b.toExponential(6)}
						</span>
						<span className="text-slate-500 dark:text-slate-400">c =</span>
						<span className="text-right font-mono text-slate-900 dark:text-slate-100">
							{result.c.toExponential(6)}
						</span>
					</>
				)}
				{result.degree === 1 && (
					<>
						<span className="text-slate-500 dark:text-slate-400">b =</span>
						<span className="text-right font-mono text-slate-900 dark:text-slate-100">
							{result.b.toExponential(6)}
						</span>
					</>
				)}
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pt-1">
				<span className="text-slate-500 dark:text-slate-400">R² =</span>
				<span className="text-right font-mono text-emerald-600 dark:text-emerald-400">
					{result.r2.toFixed(6)}
				</span>
				<span className="text-slate-500 dark:text-slate-400">RMSE =</span>
				<span className="text-right font-mono text-slate-900 dark:text-slate-100">
					{result.rmse.toExponential(4)}
				</span>
				<span className="text-slate-500 dark:text-slate-400">n =</span>
				<span className="text-right font-mono text-slate-900 dark:text-slate-100">
					{result.points.length}
				</span>
			</div>
		</div>
	);
}
