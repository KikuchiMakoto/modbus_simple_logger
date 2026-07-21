import { useCallback, useEffect, useRef, useState } from "react";
import { AI_FLOAT_START_REGISTER, AI_START_REGISTER } from "../constants";
import type { ChannelLiveState, ReferenceSensorCoeffs } from "../types";
import { hx711RawToMvPerV } from "../utils/calibration";
import { type SettlingConfig, SettlingDetector } from "../utils/settling";

type Precision = "normal" | "extended";

interface UseHx711LiveOpts {
	client: {
		readInputRegisters(start: number, count: number): Promise<number[]>;
		readInputRegistersAsFloat32Abcd(
			start: number,
			count: number,
		): Promise<number[]>;
	} | null;
	channels: number[];
	pollingMs: number;
	precision: Precision;
	settling: SettlingConfig;
	refCoeffs?: ReferenceSensorCoeffs;
}

interface UseHx711LiveReturn {
	channels: Record<number, ChannelLiveState>;
	allStable: boolean;
	timestamp: number;
	isPolling: boolean;
	history: Record<number, { raw: Float32Array; filtered: Float32Array }>;
}

const HISTORY_SECONDS = 10;

function createRingBuffer(size: number): Float32Array {
	return new Float32Array(size);
}

function readChannelValue(
	client: NonNullable<UseHx711LiveOpts["client"]>,
	ch: number,
	precision: Precision,
): Promise<number> {
	if (precision === "normal") {
		return client
			.readInputRegisters(AI_START_REGISTER + ch, 1)
			.then((values) => values[0]);
	}
	return client
		.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER + ch, 1)
		.then((values) => values[0]);
}

function applyRefPhysical(raw: number, coeffs: ReferenceSensorCoeffs): number {
	if (coeffs.degree === 2) {
		return coeffs.a * raw * raw + coeffs.b * raw + coeffs.c;
	}
	return coeffs.a * raw + coeffs.b;
}

export function useHx711Live(opts: UseHx711LiveOpts): UseHx711LiveReturn {
	const { client, channels, pollingMs, precision, settling, refCoeffs } = opts;

	const [channelStates, setChannelStates] = useState<
		Record<number, ChannelLiveState>
	>(() => {
		const init: Record<number, ChannelLiveState> = {};
		for (const ch of channels) {
			init[ch] = {
				raw: 0,
				filtered: 0,
				voltage: 0,
				physical: 0,
				stable: false,
				range: 0,
			};
		}
		return init;
	});

	const [allStable, setAllStable] = useState(false);
	const [timestamp, setTimestamp] = useState(Date.now());
	const [isPolling, setIsPolling] = useState(false);

	const detectorsRef = useRef<Map<number, SettlingDetector>>(new Map());
	const historyRef = useRef<
		Record<
			number,
			{ raw: Float32Array; filtered: Float32Array; pos: number; size: number }
		>
	>({});
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const wakeLockRef = useRef<WakeLockSentinel | null>(null);

	// Re-initialize detectors when channels or settling config changes
	useEffect(() => {
		const detectors = detectorsRef.current;
		detectors.clear();
		for (const ch of channels) {
			detectors.set(ch, new SettlingDetector(settling, pollingMs));
		}

		const historySize = Math.ceil(HISTORY_SECONDS / (pollingMs / 1000));
		for (const ch of channels) {
			if (!historyRef.current[ch]) {
				historyRef.current[ch] = {
					raw: createRingBuffer(historySize),
					filtered: createRingBuffer(historySize),
					pos: 0,
					size: historySize,
				};
			}
		}
	}, [channels, settling, pollingMs]);

	const poll = useCallback(async () => {
		if (!client) return;

		const newStates: Record<number, ChannelLiveState> = {};
		let allStable_ = true;

		for (const ch of channels) {
			const detector = detectorsRef.current.get(ch);
			if (!detector) continue;

			try {
				const raw = await readChannelValue(client, ch, precision);
				const { filtered, stable, range } = detector.update(raw);
				const voltage = hx711RawToMvPerV(raw);

				let physical = raw;
				if (refCoeffs && ch === channels[channels.length - 1]) {
					physical = applyRefPhysical(filtered, refCoeffs);
				}

				newStates[ch] = { raw, filtered, voltage, physical, stable, range };

				if (!stable) allStable_ = false;

				// Update ring buffer
				const hist = historyRef.current[ch];
				if (hist) {
					hist.raw[hist.pos] = raw;
					hist.filtered[hist.pos] = filtered;
					hist.pos = (hist.pos + 1) % hist.size;
				}
			} catch {
				newStates[ch] = {
					raw: 0,
					filtered: 0,
					voltage: 0,
					physical: 0,
					stable: false,
					range: 0,
				};
				allStable_ = false;
			}
		}

		setChannelStates(newStates);
		setAllStable(allStable_);
		setTimestamp(Date.now());
	}, [client, channels, precision, refCoeffs]);

	// Start/stop polling
	useEffect(() => {
		if (!client) {
			setIsPolling(false);
			return;
		}

		setIsPolling(true);

		// Acquire wake lock
		navigator.wakeLock
			?.request("screen")
			.then((lock) => {
				wakeLockRef.current = lock;
			})
			.catch(() => {});

		intervalRef.current = setInterval(poll, pollingMs);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
			wakeLockRef.current?.release().catch(() => {});
			wakeLockRef.current = null;
			setIsPolling(false);
		};
	}, [client, pollingMs, poll]);

	// Build history output (ordered raw/filtered arrays)
	const history: Record<number, { raw: Float32Array; filtered: Float32Array }> =
		{};
	for (const ch of channels) {
		const hist = historyRef.current[ch];
		if (hist) {
			const raw = new Float32Array(hist.size);
			const filtered = new Float32Array(hist.size);
			const pos = hist.pos;
			for (let i = 0; i < hist.size; i++) {
				const srcIdx = (pos + i) % hist.size;
				raw[i] = hist.raw[srcIdx];
				filtered[i] = hist.filtered[srcIdx];
			}
			history[ch] = { raw, filtered };
		} else {
			history[ch] = { raw: new Float32Array(0), filtered: new Float32Array(0) };
		}
	}

	return { channels: channelStates, allStable, timestamp, isPolling, history };
}
