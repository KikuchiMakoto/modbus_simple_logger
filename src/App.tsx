import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serial as serialPolyfill } from "web-serial-polyfill";
import { AppHeader } from "./components/AppHeader";
import { CalibrationWorkbench } from "./components/CalibrationWorkbench";
import { ChannelSelector } from "./components/ChannelSelector";
import { LiveChart } from "./components/LiveChart";
import { ModbusConfigPanel } from "./components/ModbusConfigPanel";
import { ModeSelector } from "./components/ModeSelector";
import { RegressionPlot } from "./components/RegressionPlot";
import { POLLING_INTERVAL_MS } from "./constants";
import { useCalibration } from "./hooks/useCalibration";
import { useHx711Live } from "./hooks/useHx711Live";
import { useTheme } from "./hooks/useTheme";
import { WebSerialModbusClient } from "./modbus/webserialClient";
import type {
	AppSettings,
	CalibrationDegree,
	CalibrationMode,
	ModbusPrecision,
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
const POLLING_OPTIONS = [{ label: "200 ms", valueMs: POLLING_INTERVAL_MS }];

const DEFAULT_SERIAL: SerialSettings = {
	baudRate: 38400,
	dataBits: 8,
	stopBits: 1,
	parity: "none",
};

const SETTINGS_KEY = "settings_v1";
const REF_COEFFS_KEY = "reference_sensors_v1";

const DEFAULT_SETTINGS: AppSettings = {
	mode: "1port",
	targetCh: 0,
	refCh: 1,
	degree: 1,
	settling: {
		tolerance: 5,
		windowSeconds: 1.0,
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
		return (
			readJsonStorage<ReferenceSensorCoeffs>(REF_COEFFS_KEY) ?? {
				degree: 1,
				a: 1,
				b: 0,
				c: 0,
			}
		);
	});

	useEffect(() => {
		writeJsonStorage(REF_COEFFS_KEY, refCoeffs);
	}, [refCoeffs]);

	const liveChannels = useMemo(() => {
		if (cal.mode === "2port") return [settings.targetCh, settings.refCh];
		return [settings.targetCh];
	}, [cal.mode, settings.targetCh, settings.refCh]);

	const live = useHx711Live({
		client,
		channels: liveChannels,
		pollingMs: POLLING_INTERVAL_MS,
		precision: settings.modbusPrecision,
		settling: settings.settling,
		refCoeffs: cal.mode === "2port" ? refCoeffs : undefined,
	});

	const targetState = live.channels[settings.targetCh];
	const currentFilteredRaw = targetState?.filtered ?? 0;

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
			/>

			{connectionError && (
				<div className="mx-2 mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
					{connectionError}
				</div>
			)}

			<div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
				<ModeSelector mode={cal.mode} onChange={cal.changeMode} />
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
						{(["a", "b", "c"] as const).map((param) => (
							<label
								key={param}
								className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400"
							>
								{param}=
								<input
									type="number"
									step="any"
									value={refCoeffs[param]}
									onChange={(e) =>
										setRefCoeffs((r) => ({
											...r,
											[param]: Number(e.target.value),
										}))
									}
									className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
								/>
							</label>
						))}
					</>
				)}
				<label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
					Settling:
					<select
						value={`${settings.settling.tolerance}_${settings.settling.windowSeconds.toFixed(1)}_${settings.settling.cutoffFrequency.toFixed(1)}`}
						onChange={(e) => {
							const [t, w, c] = e.target.value.split("_");
							setSettings((s) => ({
								...s,
								settling: {
									tolerance: Number(t),
									windowSeconds: Number(w),
									cutoffFrequency: Number(c),
								},
							}));
						}}
						className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
					>
						<option value="5_1.0_1.0">Normal</option>
						<option value="10_2.0_0.5">Slow</option>
						<option value="2_0.4_2.0">Fast</option>
					</select>
				</label>
			</div>

			{connected && live.isPolling && (
				<div className="grid flex-1 grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-[1fr_380px]">
					<div className="flex flex-col gap-2 overflow-hidden">
						<div className="card overflow-hidden">
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
							/>
						</div>
						<div className="card flex-1 overflow-hidden">
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
				pollingRate={POLLING_OPTIONS[0]}
				onPollingRateChange={() => {}}
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
