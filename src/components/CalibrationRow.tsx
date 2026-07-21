interface CalibrationRowProps {
	index: number;
	xDisplay: string;
	y: number;
	onUpdateY: (index: number, y: number) => void;
	onRemove: (index: number) => void;
}

export function CalibrationRow({
	index,
	xDisplay,
	y,
	onUpdateY,
	onRemove,
}: CalibrationRowProps) {
	return (
		<div className="flex items-center gap-1 text-sm">
			<span className="w-6 text-center text-slate-400">{index + 1}</span>
			<span className="flex-1 text-right font-mono text-slate-900 dark:text-slate-100">
				{xDisplay}
			</span>
			<input
				type="number"
				step="any"
				value={y}
				onChange={(e) => onUpdateY(index, Number(e.target.value))}
				className="w-24 rounded border border-slate-300 bg-white px-2 py-0.5 text-right font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			/>
			<button
				type="button"
				onClick={() => onRemove(index)}
				className="rounded p-0.5 text-red-400 hover:text-red-600"
				title="Remove point"
			>
				<svg
					className="size-4"
					viewBox="0 0 16 16"
					fill="currentColor"
					aria-hidden="true"
				>
					<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
				</svg>
			</button>
		</div>
	);
}
