import type { CalibrationMode, ChannelLiveState } from "../types";
import { type LevelStatus, getLevelStatus } from "../utils/calibration";

interface LiveReadingBannerProps {
	mode: CalibrationMode;
	targetCh: number;
	targetState: ChannelLiveState | undefined;
	refCh?: number;
	refState?: ChannelLiveState | undefined;
}

function LevelBadge({ raw }: { raw: number }) {
	const status = getLevelStatus(raw);
	const ratio = (Math.abs(raw) / 32767) * 100;
	const config: Record<
		LevelStatus,
		{ bg: string; badge: string; dot: string }
	> = {
		normal: {
			bg: "bg-emerald-100 dark:bg-emerald-950",
			badge: "text-emerald-700 dark:text-emerald-300",
			dot: "bg-emerald-500",
		},
		warning: {
			bg: "bg-yellow-100 dark:bg-yellow-950",
			badge: "text-yellow-700 dark:text-yellow-300",
			dot: "bg-yellow-500",
		},
		danger: {
			bg: "bg-red-100 dark:bg-red-950",
			badge: "text-red-700 dark:text-red-300",
			dot: "bg-red-500",
		},
	};
	const c = config[status];
	const label =
		status === "danger" ? "Saturated" : status === "warning" ? "High" : null;

	return (
		<output
			className={`inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-xs font-medium ${c.bg} ${c.badge}`}
			aria-label={`Raw value ${ratio.toFixed(0)}% of maximum`}
		>
			<span className={`block size-1.5 rounded-full ${c.dot}`} />
			{ratio.toFixed(0)}%{label && ` ${label}`}
		</output>
	);
}

function StabilityBadge({
	stable,
	range,
	hasReceived,
}: { stable: boolean; range: number; hasReceived: boolean }) {
	if (!hasReceived) {
		return (
			<output
				className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-px font-mono text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400"
				aria-label="Waiting for data"
			>
				<span className="block size-1.5 rounded-full bg-slate-400" />
				Waiting...
			</output>
		);
	}

	if (stable) {
		return (
			<output
				className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-px font-mono text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
				aria-label="Sensor stable"
			>
				<span className="block size-1.5 rounded-full bg-emerald-500" />
				Stable
			</output>
		);
	}

	return (
		<output
			className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-px font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400"
			aria-label={`Sensor unstable, range: ${range.toFixed(4)} cnt`}
		>
			<span className="block size-1.5 rounded-full bg-slate-400" />
			Unstable{range > 0 ? ` (${range.toFixed(4)} cnt)` : ""}
		</output>
	);
}

function ChannelColumn({
	label,
	primaryValue,
	primaryUnit,
	secondaryValue,
	secondaryUnit,
	state,
}: {
	label: string;
	primaryValue: number;
	primaryUnit: string;
	secondaryValue?: number;
	secondaryUnit?: string;
	state: ChannelLiveState | undefined;
}) {
	if (!state) {
		return (
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
					{label}
				</span>
				<span className="font-mono text-sm text-slate-400 dark:text-slate-500">
					—
				</span>
			</div>
		);
	}

	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
				{label}
			</span>
			<div className="flex items-baseline gap-1.5">
				<span className="font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">
					{primaryValue.toFixed(4)}
				</span>
				<span className="font-mono text-xs text-slate-500">{primaryUnit}</span>
				{secondaryValue !== undefined && (
					<span className="font-mono text-sm tabular-nums text-slate-500 dark:text-slate-400">
						{secondaryValue.toFixed(4)} {secondaryUnit}
					</span>
				)}
			</div>
			<div className="mt-0.5 flex items-center gap-2">
				<StabilityBadge
					stable={state.stable}
					range={state.range}
					hasReceived={state.hasReceived}
				/>
				{state.hasReceived && <LevelBadge raw={state.raw} />}
			</div>
		</div>
	);
}

export function LiveReadingBanner({
	mode,
	targetCh,
	targetState,
	refCh,
	refState,
}: LiveReadingBannerProps) {
	return (
		<div className="card mx-2 mt-1 px-3 py-1.5">
			<div className="flex gap-6">
				<ChannelColumn
					label={mode === "2port" ? `Target CH${targetCh}` : `CH${targetCh}`}
					primaryValue={targetState?.filtered ?? 0}
					primaryUnit="cnt"
					secondaryValue={targetState?.voltage ?? 0}
					secondaryUnit="mV/V"
					state={targetState}
				/>
				{mode === "2port" && refCh !== undefined && (
					<>
						<div className="w-px bg-slate-200 dark:bg-slate-700" />
						<ChannelColumn
							label={`Ref CH${refCh}`}
							primaryValue={refState?.physical ?? 0}
							primaryUnit=""
							secondaryValue={refState?.voltage ?? 0}
							secondaryUnit="mV/V"
							state={refState}
						/>
					</>
				)}
			</div>
		</div>
	);
}
