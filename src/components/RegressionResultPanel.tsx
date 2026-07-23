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
				{result.degree === 2 && (
					<>
						<span className="text-slate-500 dark:text-slate-400">a2 =</span>
						<span className="text-right font-mono text-slate-900 dark:text-slate-100">
							{result.a2.toExponential(6)}
						</span>
					</>
				)}
				<span className="text-slate-500 dark:text-slate-400">a1 =</span>
				<span className="text-right font-mono text-slate-900 dark:text-slate-100">
					{result.a1.toExponential(6)}
				</span>
				<span className="text-slate-500 dark:text-slate-400">a0 =</span>
				<span className="text-right font-mono text-slate-900 dark:text-slate-100">
					{result.a0.toExponential(6)}
				</span>
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
			{result.ratedOutput && (
				<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-t border-slate-200 pt-1 dark:border-slate-700">
					<span className="text-slate-500 dark:text-slate-400">
						{result.mode === "2port" ? "Target rated output" : "Rated output"}:
					</span>
					<span className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
						{result.ratedOutput.mVPerV.toFixed(4)} mV/V
					</span>
					<span className="text-slate-500 dark:text-slate-400">
						raw span:
					</span>
					<span className="text-right font-mono text-slate-900 dark:text-slate-100">
						{result.ratedOutput.raw.toFixed(1)}
					</span>
					<span className="text-slate-400 dark:text-slate-500">
						(raw zero: {result.ratedOutput.rawZero.toFixed(1)}, rated:{" "}
						{result.ratedOutput.rawRated.toFixed(1)})
					</span>
					<span />
					{result.ratedOutput.extrapolated && (
						<>
							<span className="text-amber-600 dark:text-amber-400">
								&#x26a0; extrapolated
							</span>
							<span />
						</>
					)}
				</div>
			)}
		</div>
	);
}
