import { HX711_CHANNELS } from "../constants";

interface ChannelSelectorProps {
	label: string;
	value: number;
	onChange: (ch: number) => void;
}

export function ChannelSelector({
	label,
	value,
	onChange,
}: ChannelSelectorProps) {
	return (
		<label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
			{label}:
			<select
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
			>
				{Array.from({ length: HX711_CHANNELS }, (_, ch) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static channel list
					<option key={ch} value={ch}>
						CH {ch.toString().padStart(2, "0")}
					</option>
				))}
			</select>
		</label>
	);
}
