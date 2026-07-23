import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serial as serialPolyfill } from "web-serial-polyfill";
import { AppHeader } from "./components/AppHeader";
import { CalibrationWorkbench } from "./components/CalibrationWorkbench";
import { ChannelSelector } from "./components/ChannelSelector";
import { LiveChart } from "./components/LiveChart";
import { ModbusConfigPanel } from "./components/ModbusConfigPanel";
import { ModeSelector } from "./components/ModeSelector";
import { RegressionPlot } from "./components/RegressionPlot";
import { useCalibration } from "./hooks/useCalibration";
import { useHx711Live } from "./hooks/useHx711Live";
import { useTheme } from "./hooks/useTheme";
import { WebSerialModbusClient } from "./modbus/webserialClient";
import type {
	AppSettings,
	CalibrationDegree,
	CalibrationMode,
	ModbusPrecision,
	PollingRateOption,
	ReferenceSensorCoeffs,
	SerialSettings,
	XUnit,
} from "./types";
import { readJsonStorage, writeJsonStorage } from "./utils/cookies";
import { calibrationToCsv, downloadCsv } from "./utils/csvExport";
import { calibrationToJson, downloadJson } from "./utils/jsonExport";

function isMobileDevice(): boolean {
	const ua = navigator.userAgent.toLowerCase();
	const mobileKeywords = [
		"android",
		"webos",
		"iphone",
		"ipad",
		"ipod",
		"windows phone",
		"mobile",
	];
	const isMobileUA = mobileKeywords.some((kw) => ua.includes(kw));
	const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
	const isSmall = window.innerWidth <= 768;
	return isMobileUA || (isTouch && isSmall);
}

const shouldUsePolyfill = isMobileDevice() || !("serial" in navigator);
const serial: Serial = shouldUsePolyfill
	? (serialPolyfill as unknown as Serial)
	: navigator.serial;

const BAUD_OPTIONS = [
	4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600,
	1500000, 2000000,
];
const DATA_BITS_OPTIONS: SerialSettings["dataBits"][] = [7, 8];
const STOP_BITS_OPTIONS: SerialSettings["stopBits"][] = [1, 2];
const PARITY_OPTIONS: SerialSettings["parity"][] = ["none", "even", "odd"];
const PRECISION_OPTIONS = [
	{ label: "Normal (i16)", value: "normal" as ModbusPrecision },
	{ label: "Extended (f32)", value: "extended" as ModbusPrecision },
];
const CHART_WINDOW_OPTIONS = [
	{ label: "5s", value: 5 },
	{ label: "10s", value: 10 },
	{ label: "30s", value: 30 },
	{ label: "1min", value: 60 },
	{ label: "2min", value: 120 },
	{ label: "5min", value: 300 },
	{ label: "10min", value: 600 },
];

const POLLING_OPTIONS: PollingRateOption[] = [
	{ label: "50 ms", valueMs: 50 },
	{ label: "100 ms", valueMs: 100 },
	{ label: "200 ms", valueMs: 200 },
	{ label: "500 ms", valueMs: 500 },
	{ label: "1 s", valueMs: 1000 },
	{ label: "2 s", valueMs: 2000 },
	{ label: "5 s", valueMs: 5000 },
	{ label: "10 s", valueMs: 10000 },
	{ label: "20 s", valueMs: 20000 },
	{ label: "30 s", valueMs: 30000 },
	{ label: "1 min", valueMs: 60000 },
	{ label: "2 min", valueMs: 120000 },
	{ label: "5 min", valueMs: 300000 },
];

const DEFAULT_SERIAL: SerialSettings = {
	baudRate: 38400,
	dataBits: 8,
	stopBits: 1,
	parity: "none",
};

const SETTINGS_KEY = "settings_v1";
const REF_COEFFS_KEY = "reference_sensors_v1";
const POLLING_RATE_KEY = "pollingRate_v1";
const CHART_WINDOW_KEY = "chartWindow_v1";

const DEFAULT_SETTINGS: AppSettings = {
	mode: "1port",
	targetCh: 0,
	refCh: 1,
	degree: 1,
	settling: {
		tolerance: 1,
		windowSeconds: 1,
		cutoffFrequency: 1.0,
	},
	serial: DEFAULT_SERIAL,
	slaveId: 1,
	modbusPrecision: "normal",
	theme: "light",
};

function formatTimestamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export default function App() {
	const { theme, isDarkMode, toggleTheme } = useTheme();

	const [connected, setConnected] = useState(false);
	const [client, setClient] = useState<WebSerialModbusClient | null>(null);
	const [connectionError, setConnectionError] = useState<string | null>(null);
	const clientRef = useRef<WebSerialModbusClient | null>(null);

	const [settings, setSettings] = useState<AppSettings>(() => {
		return readJsonStorage<AppSettings>(SETTINGS_KEY) ?? DEFAULT_SETTINGS;
	});

	useEffect(() => {
		writeJsonStorage(SETTINGS_KEY, settings);
	}, [settings]);

	const [xUnit, setXUnit] = useState<XUnit>("raw");

	const cal = useCalibration();

	const [refCoeffs, setRefCoeffs] = useState<ReferenceSensorCoeffs>(() => {
		const saved = readJsonStorage(REF_COEFFS_KEY) as Record<
			string,
			unknown
		> | null;
		if (saved) {
			if ("a0" in saved) {
				return saved as unknown as ReferenceSensorCoeffs;
			}
			// migrate from old { a, b, c, degree } format
			const deg = (saved.degree ?? 1) as CalibrationDegree;
			const oldA = (saved.a as number) ?? 0;
			const oldB = (saved.b as number) ?? 0;
			const oldC = (saved.c as number) ?? 0;
			if (deg === 1) {
				return { degree: 1, a0: oldB, a1: oldA, a2: 0 };
			}
			return { degree: 2, a0: oldC, a1: oldB, a2: oldA };
		}
		return { degree: 1, a0: 0, a1: 1, a2: 0 };
	});

	useEffect(() => {
		writeJsonStorage(REF_COEFFS_KEY, refCoeffs);
	}, [refCoeffs]);

	const [pollingRate, setPollingRate] = useState<PollingRateOption>(() => {
		const saved = readJsonStorage<{ valueMs: number }>(POLLING_RATE_KEY);
		return (
			POLLING_OPTIONS.find((p) => p.valueMs === saved?.valueMs) ??
			POLLING_OPTIONS[2]
		);
	});

	useEffect(() => {
		writeJsonStorage(POLLING_RATE_KEY, { valueMs: pollingRate.valueMs });
	}, [pollingRate]);

	const [chartWindowSeconds, setChartWindowSeconds] = useState<number>(() => {
		const saved = readJsonStorage<{ value: number }>(CHART_WINDOW_KEY);
		return saved?.value ?? CHART_WINDOW_OPTIONS[1].value;
	});

	useEffect(() => {
		writeJsonStorage(CHART_WINDOW_KEY, { value: chartWindowSeconds });
	}, [chartWindowSeconds]);

	const liveChannels = useMemo(() => {
		if (cal.mode === "2port") return [settings.targetCh, settings.refCh];
		return [settings.targetCh];
	}, [cal.mode, settings.targetCh, settings.refCh]);

	const live = useHx711Live({
		client,
		channels: liveChannels,
		pollingMs: pollingRate.valueMs,
		historyWindowSeconds: chartWindowSeconds,
		precision: settings.modbusPrecision,
		settling: settings.settling,
		refCoeffs: cal.mode === "2port" ? refCoeffs : undefined,
	});

	const targetState = live.channels[settings.targetCh];
	const currentFilteredRaw = targetState?.filtered ?? 0;
	const refState = live.channels[settings.refCh];
	const currentRefPhysical = refState?.physical ?? 0;

	const handleConnect = useCallback(async () => {
		setConnectionError(null);
		try {
			if (clientRef.current) {
				await clientRef.current.disconnect();
				clientRef.current = null;
			}

			const newClient = new WebSerialModbusClient(
				settings.slaveId,
				settings.serial,
				serial,
				settings.modbusPrecision === "extended",
				shouldUsePolyfill,
			);
			clientRef.current = newClient;
			await newClient.connect();
			setClient(newClient);
			setConnected(true);
		} catch (err) {
			setConnectionError((err as Error).message ?? "Connection failed");
			setClient(null);
			setConnected(false);
			clientRef.current = null;
		}
	}, [settings.slaveId, settings.serial, settings.modbusPrecision]);

	const handleDisconnect = useCallback(async () => {
		try {
			await clientRef.current?.disconnect();
		} catch {
			// ignore disconnect errors
		}
		clientRef.current = null;
		setClient(null);
		setConnected(false);
	}, []);

	const [configOpen, setConfigOpen] = useState(false);

	const handleExportCsv = useCallback(() => {
		if (!cal.result) return;
		const modeLabel = cal.mode === "1port" ? "1port" : "2port";
		const filename = `calibration_ch${settings.targetCh}_${modeLabel}_${formatTimestamp()}.csv`;
		const csv = calibrationToCsv(cal.result, cal.result.points);
		downloadCsv(filename, csv);
	}, [cal.result, cal.mode, settings.targetCh]);

	const handleExportJson = useCallback(() => {
		if (!cal.result) return;
		const modeLabel = cal.mode === "1port" ? "1port" : "2port";
		const filename = `calibration_ch${settings.targetCh}_${modeLabel}_${formatTimestamp()}.json`;
		const json = calibrationToJson(cal.result, cal.result.points);
		downloadJson(filename, json);
	}, [cal.result, cal.mode, settings.targetCh]);

	return (
		<div
			className={`${isDarkMode ? "dark" : ""} flex min-h-screen flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100`}
		>
			<AppHeader
				isConnected={connected}
				onConnect={handleConnect}
				onDisconnect={handleDisconnect}
				onToggleConfig={() => setConfigOpen((v) => !v)}
				samplingHz={connected ? 1000 / pollingRate.valueMs : undefined}
				actualHz={connected ? live.actualHz : undefined}
			/>

			{connectionError && (
				<div className="mx-2 mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
					{connectionError}
				</div>
			)}

			<div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
				<ModeSelector
					mode={cal.mode}
					onChange={cal.changeMode}
					points1port={cal.pointsByMode.current["1port"].length}
					points2port={cal.pointsByMode.current["2port"].length}
				/>
				<ChannelSelector
					label={cal.mode === "2port" ? "Target CH" : "CH"}
					value={settings.targetCh}
					onChange={(ch) => setSettings((s) => ({ ...s, targetCh: ch }))}
				/>
				{cal.mode === "2port" && (
					<>
						<ChannelSelector
							label="Ref CH"
							value={settings.refCh}
							onChange={(ch) => setSettings((s) => ({ ...s, refCh: ch }))}
						/>
						<span className="text-sm text-slate-500 dark:text-slate-400">
							Ref:
						</span>
						<select
							value={refCoeffs.degree}
							onChange={(e) =>
								setRefCoeffs((r) => ({
									...r,
									degree: Number(e.target.value) as CalibrationDegree,
								}))
							}
							className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
						>
							<option value={1}>1st</option>
							<option value={2}>2nd</option>
						</select>
						{refCoeffs.degree === 2 && (
							<label className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
								a2=
								<input
									type="number"
									step="any"
									value={refCoeffs.a2}
									onChange={(e) =>
										setRefCoeffs((r) => ({ ...r, a2: Number(e.target.value) }))
									}
									className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
								/>
							</label>
						)}
						<label className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
							a1=
							<input
								type="number"
								step="any"
								value={refCoeffs.a1}
								onChange={(e) =>
									setRefCoeffs((r) => ({ ...r, a1: Number(e.target.value) }))
								}
								className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
							/>
						</label>
						<label className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
							a0=
							<input
								type="number"
								step="any"
								value={refCoeffs.a0}
								onChange={(e) =>
									setRefCoeffs((r) => ({ ...r, a0: Number(e.target.value) }))
								}
								className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
							/>
						</label>
					</>
				)}
				<div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
					<span>Settling:</span>
					<label className="flex items-center gap-1">
						Tol:
						<select
							value={settings.settling.tolerance}
							onChange={(e) =>
								setSettings((s) => ({
									...s,
									settling: {
										...s.settling,
										tolerance: Number(e.target.value),
									},
								}))
							}
							className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
						>
							<option value={0.0001}>0.0001</option>
							<option value={0.001}>0.001</option>
							<option value={0.01}>0.01</option>
							<option value={0.1}>0.1</option>
							<option value={1}>1</option>
							<option value={10}>10</option>
							<option value={100}>100</option>
						</select>
					</label>
					<label className="flex items-center gap-1">
						Win(s):
						<input
							type="number"
							min={1}
							max={60}
							step={1}
							value={settings.settling.windowSeconds}
							onChange={(e) =>
								setSettings((s) => ({
									...s,
									settling: {
										...s.settling,
										windowSeconds: Number(e.target.value),
									},
								}))
							}
							className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
						/>
					</label>
					<label className="flex items-center gap-1">
						Fc(Hz):
						<input
							type="number"
							min={0.1}
							max={5}
							step={0.1}
							value={settings.settling.cutoffFrequency}
							onChange={(e) =>
								setSettings((s) => ({
									...s,
									settling: {
										...s.settling,
										cutoffFrequency: Number(e.target.value),
									},
								}))
							}
							className="w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
						/>
					</label>
					<span className="ml-2 text-slate-400 dark:text-slate-600">|</span>
					<label className="flex items-center gap-1">
						<span>Chart:</span>
						<select
							value={chartWindowSeconds}
							onChange={(e) => setChartWindowSeconds(Number(e.target.value))}
							className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
						>
							{CHART_WINDOW_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</label>
				</div>
			</div>

			{connected && live.isPolling && (
				<div className="grid flex-1 grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-[1fr_380px]">
					<div className="flex flex-col gap-2 overflow-hidden">
						<div className="card">
							<LiveChart
								rawHistory={
									live.history[settings.targetCh]?.raw ?? new Float32Array(0)
								}
								filteredHistory={
									live.history[settings.targetCh]?.filtered ??
									new Float32Array(0)
								}
								currentRaw={targetState?.raw ?? 0}
								currentFiltered={currentFilteredRaw}
								currentMvPerV={targetState?.voltage ?? 0}
								currentPhysical={targetState?.physical ?? 0}
								isStable={targetState?.stable ?? false}
								isDark={isDarkMode}
								historyWindowSeconds={chartWindowSeconds}
								refRawHistory={
									live.history[settings.refCh]?.raw ?? new Float32Array(0)
								}
								refFilteredHistory={
									live.history[settings.refCh]?.filtered ?? new Float32Array(0)
								}
								currentRefRaw={refState?.raw ?? 0}
								currentRefFiltered={refState?.filtered ?? 0}
								currentRefPhysical={currentRefPhysical}
							/>
						</div>
						<div className="card flex-1">
							<RegressionPlot
								points={cal.points}
								result={cal.result}
								isDark={isDarkMode}
							/>
						</div>
					</div>

					<div className="card overflow-y-auto">
						<CalibrationWorkbench
							points={cal.points}
							degree={cal.degree}
							result={cal.result}
							validationError={cal.validationError}
							currentFilteredRaw={currentFilteredRaw}
							addPointEnabled={live.allStable}
							xUnit={xUnit}
							mode={cal.mode}
							currentRefPhysical={currentRefPhysical}
							onAddPoint={cal.addPoint}
							onRemovePoint={cal.removePoint}
							onUpdatePointY={cal.updatePointY}
							onClear={cal.clearPoints}
							onDegreeChange={cal.setDegree}
							onXUnitChange={setXUnit}
							onExportCsv={handleExportCsv}
							onExportJson={handleExportJson}
						/>
					</div>
				</div>
			)}

			{!connected && (
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center text-slate-400 dark:text-slate-500">
						<p className="text-lg font-semibold">Not Connected</p>
						<p className="mt-1 text-sm">
							Click "Connect" to select a Modbus device
						</p>
					</div>
				</div>
			)}

			<ModbusConfigPanel
				open={configOpen}
				onClose={() => setConfigOpen(false)}
				slaveId={settings.slaveId}
				onSlaveIdChange={(v) => setSettings((s) => ({ ...s, slaveId: v }))}
				serialSettings={settings.serial}
				onSerialSettingsChange={(v) =>
					setSettings((s) => ({ ...s, serial: v }))
				}
				modbusPrecision={settings.modbusPrecision}
				onModbusPrecisionChange={(v) =>
					setSettings((s) => ({ ...s, modbusPrecision: v }))
				}
				pollingRate={pollingRate}
				onPollingRateChange={setPollingRate}
				pollingOptions={POLLING_OPTIONS}
				baudOptions={BAUD_OPTIONS}
				dataBitsOptions={DATA_BITS_OPTIONS}
				stopBitsOptions={STOP_BITS_OPTIONS}
				parityOptions={PARITY_OPTIONS}
				precisionOptions={PRECISION_OPTIONS}
				connected={connected}
			/>
		</div>
	);
}
