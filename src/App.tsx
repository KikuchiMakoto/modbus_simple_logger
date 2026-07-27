import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { WebSerialModbusClient } from './modbus/webserialClient';
import {
  AiCalibration,
  AiChannel,
  AoChannel,
  PollingRateOption,
  DataPoint,
  SerialSettings,
  ModbusPrecision,
  ModbusPrecisionSetting,
  VoltageMode,
  DEFAULT_VOLTAGE_CONFIG,
} from './types';
import {
  AI_CHANNELS,
  AO_CHANNELS,
  PARAM_CHANNELS,
  AI_START_REGISTER,
  AI_FLOAT_START_REGISTER,
  AO_START_REGISTER,
  PRECISION_PROBE_ATTEMPTS,
  PRECISION_PROBE_CHANNELS,
  PRECISION_PROBE_TIMEOUT_MS,
  RETRY_DELAY_MS,
  INPUT_READ_RETRY_WINDOW_MS,
  INPUT_READ_MAX_FAILURES_PER_WINDOW,
  INPUT_READ_MAX_FAILURE_RATIO,
  OUTPUT_HOLDING_RETRY_WINDOW_MS,
  OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW,
  MAX_POINTS_IN_MEMORY,
  CHART_MAX_POINTS,
  CHART_REDRAW_INTERVAL_MS,
  READOUT_PUBLISH_INTERVAL_MS,
  CHANNEL_CARD_MIN_INTERVAL_MS,
  CHART_INPUT_INTERVAL_MS,
  NON_SAVING_CHART_PREVIEW_POINTS,
  BATCH_FLUSH_THRESHOLD,
  BATCH_FLUSH_INTERVAL_MS,
  KEEP_LATEST_TRIM_INTERVAL,
  PROMISE_CHAIN_RESET_INTERVAL,
  TSV_FLUSH_INTERVAL_MS,
  TSV_FLUSH_MAX_ROWS,
} from './constants';
import {
  aiToPhysical,
  loadAiCalibration,
  saveAiCalibration,
  getAiStatus,
  hx711RawToMvPerV,
  hx711RawToMicroStrain,
  ads1115RawToVolt,
  rawToDisplayValue,
  sanitizeVoltageConfig,
  hx711SlopePerRaw,
  HX711_DENOMINATOR_UNITS,
  getLevelColor,
  loadVoltageConfig,
  saveVoltageConfig,
  loadAiFreeLabels,
  saveAiFreeLabels,
  loadAoFreeLabels,
  saveAoFreeLabels,
  loadParamFreeLabels,
  saveParamFreeLabels,
} from './utils/calibration';
import {
  dataStorage,
  StoredDataPoint,
} from './utils/dataStorage';
import { createTsvWriter, type TsvSink } from './utils/tsvExport';
import {
  discardRecoveredRun,
  downloadRecoveredRun,
  formatRunSize,
  listRecoverableRuns,
  recoveredDownloadName,
  requestPersistentStorage,
} from './utils/opfsRecovery';
import { readJsonStorage, writeJsonStorage } from './utils/cookies';
import { setUpdateChecksSuspended } from './utils/swUpdate';
import {
  clearBackgroundTimer,
  setBackgroundInterval,
  setBackgroundTimeout,
} from './utils/backgroundTimer';
import { ChartPanel } from './components/ChartPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { CalibrationWizardPanel, DenominatorOption } from './components/CalibrationWizardPanel';
import { HamburgerMenu } from './components/HamburgerMenu';
import { ModbusConfigPanel } from './components/ModbusConfigPanel';
import { VoltageConfigPanel } from './components/VoltageConfigPanel';
import { AppInfoPanel } from './components/AppInfoPanel';
import { ManualPanel } from './components/ManualPanel';
import { ScriptRunnerPanel } from './components/ScriptRunnerPanel';
import { McpPanel } from './components/McpPanel';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from './hooks/useTheme';
import { useChartAxes } from './hooks/useChartAxes';
import { useScriptRunner } from './hooks/useScriptRunner';
import { useNotifications } from './hooks/useNotifications';
import { useMcpBridge, type McpApi } from './hooks/useMcpBridge';
import {
  useViewerHost,
  useViewerClient,
  type ViewerHostHandle,
  type ViewerSample,
  type ViewerStatePayload,
} from './hooks/useViewerFeed';
import { RemoteViewerPanel } from './components/RemoteViewerPanel';
import { isViewerMode } from './utils/appMode';
import { serial as serialPolyfill } from 'web-serial-polyfill';

function isMobileDevice(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;
  return isMobileUA || (isTouchDevice && isSmallScreen);
}

const shouldUsePolyfill = isMobileDevice() || !('serial' in navigator);
const serial: Serial = shouldUsePolyfill ? serialPolyfill as unknown as Serial : navigator.serial;
const serialTransportLabel = shouldUsePolyfill ? 'WebUSB' : 'WebSerial';

// GP8403 full scale. AO state is held in millivolts, so this is both the write
// clamp and the 100% mark of the AO card's level meter — one constant, so the
// meter can never disagree with what the hardware will actually accept.
const AO_FULL_SCALE_MV = 10000;

/**
 * How fast the Modbus loop runs. Deliberately short: this is the rate a
 * feedback script's inputs are refreshed at, and there is no reason to ever
 * want it slower — a run that only needs a sample a minute on disk still wants
 * a control loop that sees fresh data. How much of it is kept is SAVE_RATE_OPTIONS.
 */
const POLLING_OPTIONS: PollingRateOption[] = [
  // 25 ms, not 20: 20 ms was tried on the bench and did not hold rate, 25 ms
  // does. It is still the setting nearest the edge — the read timeout has a
  // 100 ms floor it cannot honour, so what keeps it working is the device
  // answering well inside the cycle rather than anything this code enforces.
  { label: '25 ms', valueMs: 25 },
  { label: '50 ms', valueMs: 50 },
  { label: '100 ms', valueMs: 100 },
];
const DEFAULT_POLLING_RATE_MS = 100;

/**
 * How often a polled sample is written to the TSV file.
 *
 * Only the file: the chart and IndexedDB stay on the poll rate, so the live
 * view is the same whether rows land every 200 ms or every half hour.
 *
 * Starts at 200 ms, independently of the poll rate. Faster save rates were
 * offered briefly and are not on the table: a file written faster than this
 * buys nothing anyone reads back, while the per-row cost lands in the middle of
 * the acquisition loop. Every entry is a whole multiple of every poll rate, so
 * the written interval lands on the poll grid exactly — 200 ms is every 2nd
 * poll at 100 ms polling, every 8th at 25 ms.
 *
 * The floor being above the slowest poll rate is what lets the two lists be
 * independent. Adding a poll rate slower than 200 ms would break that, and the
 * save rate would need clamping to it.
 */
const SAVE_RATE_OPTIONS: PollingRateOption[] = [
  { label: '200 ms', valueMs: 200 },
  { label: '500 ms', valueMs: 500 },
  { label: '1 s', valueMs: 1000 },
  { label: '2 s', valueMs: 2000 },
  { label: '5 s', valueMs: 5000 },
  { label: '10 s', valueMs: 10000 },
  { label: '20 s', valueMs: 20000 },
  { label: '30 s', valueMs: 30000 },
  { label: '1 min', valueMs: 60000 },
  { label: '2 min', valueMs: 120000 },
  { label: '5 min', valueMs: 300000 },
  { label: '10 min', valueMs: 600000 },
  { label: '20 min', valueMs: 1200000 },
  { label: '30 min', valueMs: 1800000 },
];
const DEFAULT_SAVE_RATE_MS = 1000;

const BAUD_OPTIONS = [4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600, 1500000, 2000000];
const DATA_BITS_OPTIONS: SerialSettings['dataBits'][] = [7, 8];
const STOP_BITS_OPTIONS: SerialSettings['stopBits'][] = [1, 2];
const PARITY_OPTIONS: SerialSettings['parity'][] = ['none', 'even', 'odd'];
const PRECISION_OPTIONS: { label: string; value: ModbusPrecisionSetting }[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'Normal(i16t)', value: 'normal' },
  { label: 'Extended(f32t)', value: 'extended' },
];

const PRECISION_LABEL: Record<ModbusPrecision, string> = {
  normal: 'i16t',
  extended: 'f32t',
};
const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 38400,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
};

const computeSensorValues = (raw: number, idx: number) => {
  if (idx < 8) {
    return { voltage: hx711RawToMvPerV(raw), microStrain: hx711RawToMicroStrain(raw) };
  }
  return { voltage: ads1115RawToVolt(raw), microStrain: 0 };
};

const createAiChannels = (calibration: AiCalibration[]): AiChannel[] =>
  Array.from({ length: AI_CHANNELS }, (_, idx) => {
    const raw = 0;
    const physical = aiToPhysical(raw, calibration[idx]);
    const { voltage, microStrain } = computeSensorValues(raw, idx);
    return {
      id: idx,
      raw,
      physical,
      label: `CH ${idx.toString().padStart(2, '0')}`,
      status: getAiStatus(raw),
      voltage,
      microStrain,
    };
  });

const createAoChannels = (): AoChannel[] =>
  Array.from({ length: AO_CHANNELS }, (_, channelIndex) => ({
    id: channelIndex,
    raw: 0,
    physical: 0,
    label: `CH ${channelIndex}`,
  }));

const formatAiChannelDisplayLabel = (idx: number): string =>
  `CH ${idx.toString().padStart(2, '0')}`;

// The hard limits below come from the converter ICs, not from this app: they
// cannot be raised by changing a Voltage Config or a calibration coefficient,
// and a reading that sits against one of them is clipped rather than large.
// Nothing else on the page says which IC is behind which channel block, so it
// is said on the channel label — the one part of a card that is the same in
// every state. Same mechanism as the Start Save note (group-hover on a plain
// absolute box), no tooltip library.
const HX711_SPEC_NOTE = (
  <>
    <strong>HX711</strong> — strain input
    <ul className="mt-1 list-disc space-y-0.5 pl-3">
      <li>Gauge voltage: about 3 V DC</li>
      <li>Raw stops at ±32767</li>
      <li>That is about 4 mV/V (about 8,000 με)</li>
    </ul>
  </>
);

const ADS1115_SPEC_NOTE = (
  <>
    <strong>ADS1115</strong> — general input
    <ul className="mt-1 list-disc space-y-0.5 pl-3">
      <li>5 V board, so keep the input under 5.3 V</li>
      <li>On the 6.144 V range: 0–5.3 V</li>
      <li>Raw 0 to about 28,270</li>
    </ul>
  </>
);

const GP8403_SPEC_NOTE = (
  <>
    <strong>GP8403</strong> — general output
    <ul className="mt-1 list-disc space-y-0.5 pl-3">
      <li>Outputs 0–10 V</li>
      <li>Set in mV, up to 10,000 mV</li>
      <li>Current: about 20 mA</li>
    </ul>
  </>
);

// The cards sit in an 8-wide grid, so a note anchored left would run off the
// right edge on the outer columns. Anchoring by column half keeps it inside the
// page at the lg+ widths this tool is used at.
function ChannelSpecNote({
  id,
  label,
  note,
  align,
}: {
  id: string;
  label: string;
  note: ReactNode;
  align: 'left' | 'right';
}) {
  return (
    <div className="group/spec relative shrink-0">
      <span
        tabIndex={0}
        aria-describedby={id}
        className="block cursor-help whitespace-nowrap tracking-tighter text-xs font-semibold leading-none text-slate-700 underline decoration-dotted decoration-slate-400 underline-offset-2 dark:text-slate-200 dark:decoration-slate-500"
      >
        {label}
      </span>
      <div
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute top-full z-50 mt-1 hidden w-56 rounded border border-sky-400 bg-sky-50 p-2 text-left text-[0.7rem] font-normal normal-case leading-snug tracking-normal text-sky-900 shadow-lg group-hover/spec:block group-focus-within/spec:block dark:border-sky-500/60 dark:bg-slate-800 dark:text-sky-200 ${
          align === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        {note}
      </div>
    </div>
  );
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatCalibrationTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatSerialSettings(settings: SerialSettings) {
  const parityLetter = settings.parity === 'none' ? 'N' : settings.parity === 'even' ? 'E' : 'O';
  return `${settings.baudRate}bps ${settings.dataBits}${parityLetter}${settings.stopBits}`;
}

function formatElapsedTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

const hasAoValuesChanged = (lastSent: number[] | null, current: number[]): boolean => {
  if (!lastSent) return true;
  if (lastSent.length !== current.length) return true;
  return lastSent.some((value, index) => value !== current[index]);
};

const axisOptions = [
  { key: 'time', label: 'Time' },
  ...Array.from({ length: AI_CHANNELS }, (_, idx) => ({
    key: `raw_${idx.toString().padStart(2, '0')}`,
    label: `raw_${idx.toString().padStart(2, '0')}`
  })),
  ...Array.from({ length: AI_CHANNELS }, (_, idx) => ({
    key: `phy_${idx.toString().padStart(2, '0')}`,
    label: `phy_${idx.toString().padStart(2, '0')}`
  })),
  ...Array.from({ length: PARAM_CHANNELS }, (_, idx) => ({
    key: `par_${idx.toString().padStart(2, '0')}`,
    label: `par_${idx.toString().padStart(2, '0')}`
  })),
];

const axisOptionKeys = new Set(axisOptions.map((option) => option.key));

// Sun / moon for the theme switch, drawn as Feather Icons (MIT, (c) Cole Bemis)
// — the same stroked 24x24 grid as the hamburger and collapse chevrons, so the
// header reads as one icon set. Inlined rather than pulled from an icon package:
// the app must precache every asset for offline use, and these are two paths.
//
function CollapseButton({
  collapsed,
  onToggle,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      title={collapsed ? `Expand ${label}` : `Minimize ${label}`}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`}
      >
        <polyline points="5 8 10 13 15 8" />
      </svg>
    </button>
  );
}

/**
 * Ask the device whether it has the float32 register map, by reading the first
 * PRECISION_PROBE_CHANNELS float channels at AI_FLOAT_START_REGISTER.
 *
 * Run once per connect, never during polling: the answer is a property of the
 * firmware on the other end, so re-asking mid-run could only ever change the
 * register map underneath a recording.
 *
 * Silence is read as "no f32 map" and repeated PRECISION_PROBE_ATTEMPTS times
 * before it is believed. The asymmetry is deliberate — being wrong towards
 * 'normal' lands on the mode this app used by default before Auto existed,
 * while being wrong towards 'extended' would decode 16-bit registers as
 * halves of floats and record numbers that look plausible and are nonsense.
 *
 * The values are required to be finite for the same reason: an unimplemented
 * register block that answers with 0xFFFF padding decodes to NaN, which is a
 * structurally valid float32 frame and would otherwise pass. A device that
 * legitimately reports NaN on channel 0 or 1 will fall back to Normal, and can
 * be set to Extended by hand.
 */
async function probeExtendedPrecision(client: WebSerialModbusClient): Promise<boolean> {
  for (let attempt = 1; attempt <= PRECISION_PROBE_ATTEMPTS; attempt += 1) {
    try {
      const values = await client.readInputRegistersAsFloat32Abcd(
        AI_FLOAT_START_REGISTER,
        PRECISION_PROBE_CHANNELS,
        PRECISION_PROBE_TIMEOUT_MS,
      );
      if (values.length >= PRECISION_PROBE_CHANNELS && values.every((v) => Number.isFinite(v))) {
        console.info('[App] precision probe: float block answered', { attempt, values });
        return true;
      }
      console.warn('[App] precision probe: answer was not a usable float block', { attempt, values });
    } catch (err) {
      console.info(`[App] precision probe: no float block (attempt ${attempt}/${PRECISION_PROBE_ATTEMPTS})`, err);
    }
  }
  return false;
}

// Module scope, not a ref: StrictMode mounts the app twice in development, and
// the recovery prompt is a blocking dialog the user would have to dismiss twice
// for every leftover run.
let recoveryPromptStarted = false;

function App() {
  const { theme, isDarkMode, toggleTheme } = useTheme();
  const {
    chart1X, setChart1X, chart1Y, setChart1Y,
    chart2X, setChart2X, chart2Y, setChart2Y,
    chart3X, setChart3X, chart3Y, setChart3Y,
    chart4X, setChart4X, chart4Y, setChart4Y,
  } = useChartAxes(axisOptionKeys);

  const [slaveId, setSlaveId] = useState(1);
  const [serialSettings, setSerialSettings] = useState<SerialSettings>(DEFAULT_SERIAL_SETTINGS);
  // What the user picked, and what the link ended up using. Auto is the
  // default: the probe can only improve on a fixed 'normal', which is what an
  // f32 device got here before if nobody remembered to change this.
  const [modbusPrecision, setModbusPrecision] = useState<ModbusPrecisionSetting>('auto');
  const [resolvedPrecision, setResolvedPrecision] = useState<ModbusPrecision>('normal');
  // Read by the polling loop, which keeps a closure alive across renders. Set
  // in handleConnect before polling is allowed to start, so no cycle can run
  // against the previous connection's answer.
  const resolvedPrecisionRef = useRef<ModbusPrecision>('normal');
  // Two independent rates: how fast the link is polled, and how much of that is
  // kept. See POLLING_OPTIONS / SAVE_RATE_OPTIONS.
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(
    POLLING_OPTIONS.find((p) => p.valueMs === DEFAULT_POLLING_RATE_MS)!,
  );
  const [saveRate, setSaveRate] = useState<PollingRateOption>(
    SAVE_RATE_OPTIONS.find((p) => p.valueMs === DEFAULT_SAVE_RATE_MS)!,
  );
  const [aiCalibration, setAiCalibration] = useState<AiCalibration[]>(loadAiCalibration(AI_CHANNELS));
  const [aiChannels, setAiChannels] = useState<AiChannel[]>(createAiChannels(aiCalibration));
  const [aoChannels, setAoChannels] = useState<AoChannel[]>(createAoChannels());
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [activeSaveFilename, setActiveSaveFilename] = useState('');
  const [saveStartedAt, setSaveStartedAt] = useState<number | null>(null);
  const [saveElapsedMs, setSaveElapsedMs] = useState(0);
  const [savePointCount, setSavePointCount] = useState(0);
  const [displayRevision, setDisplayRevision] = useState(0);
  // Bumped to force a full Plotly purge + remount of every chart (used as the
  // Plot's React key). Only the save-path re-decimation bumps it — the periodic
  // timed purge was removed in v3.1 (see constants.ts); ChartPanel now releases
  // the WebGL context explicitly, which is what the timer was really after.
  const [chartEpoch, setChartEpoch] = useState(0);
  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(false);
  const [hx711CalibrationPanelOpen, setHx711CalibrationPanelOpen] = useState(false);
  const [ads1115CalibrationPanelOpen, setAds1115CalibrationPanelOpen] = useState(false);
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const [modbusConfigPanelOpen, setModbusConfigPanelOpen] = useState(false);
  const [voltageConfigPanelOpen, setVoltageConfigPanelOpen] = useState(false);
  const [appInfoPanelOpen, setAppInfoPanelOpen] = useState(false);
  const [manualPanelOpen, setManualPanelOpen] = useState(false);
  const [scriptRunnerPanelOpen, setScriptRunnerPanelOpen] = useState(false);
  const [mcpPanelOpen, setMcpPanelOpen] = useState(false);
  const [voltageConfig, setVoltageConfig] = useState<VoltageMode[]>(() => loadVoltageConfig());
  const [aiFreeLabels, setAiFreeLabels] = useState<string[]>(() => loadAiFreeLabels());
  const [aoFreeLabels, setAoFreeLabels] = useState<string[]>(() => loadAoFreeLabels());
  const [paramFreeLabels, setParamFreeLabels] = useState<string[]>(() => loadParamFreeLabels());
  const [paramValues, setParamValues] = useState<number[]>(() => Array(PARAM_CHANNELS).fill(0));
  const [aiCollapsed, setAiCollapsed] = useState<boolean>(() => readJsonStorage<boolean>('ai_collapsed') ?? false);
  // AO and Parameter start collapsed: AI is what a session is normally watching,
  // and the other two are only opened when they are actually being driven. The
  // stored value still wins, so a user who expands them keeps them expanded.
  const [aoCollapsed, setAoCollapsed] = useState<boolean>(() => readJsonStorage<boolean>('ao_collapsed') ?? true);
  const [paramCollapsed, setParamCollapsed] = useState<boolean>(() => readJsonStorage<boolean>('param_collapsed') ?? true);

  const clientRef = useRef<WebSerialModbusClient | null>(null);
  const aiRawSourceRef = useRef<number[]>(Array(AI_CHANNELS).fill(0));
  const aoRawSourceRef = useRef<number[]>(Array(AO_CHANNELS).fill(0));
  const pollTimer = useRef<number | undefined>(undefined);
  const pollingInProgressRef = useRef(false);
  const lastSentAoRawRef = useRef<number[] | null>(null);
  const outputHoldingFailureTimestampsRef = useRef<number[]>([]);
  const inputReadFailureTimestampsRef = useRef<number[]>([]);
  const lastAiReadCompletedAtRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // Readouts (measured rate, saved-point count) are published to React on a
  // budget rather than per sample — see READOUT_PUBLISH_INTERVAL_MS.
  const lastCardPublishRef = useRef(0);
  const lastSaveCountPublishRef = useRef(0);
  const savePointCountRef = useRef(0);
  const pendingDataPoints = useRef<DataPoint[]>([]);
  const batchUpdateTimer = useRef<number | undefined>(undefined);
  const tsvWriterRef = useRef<TsvSink | null>(null);
  const seqCounterRef = useRef(0);
  const displayUpdateChainRef = useRef<Promise<void>>(Promise.resolve());
  const displayUpdateCountRef = useRef(0);
  const flushTimerRef = useRef<number | undefined>(undefined);
  const chartRedrawTimerRef = useRef<number | undefined>(undefined);
  const keepLatestCountRef = useRef(0);
  const disconnectInProgressRef = useRef(false);
  const connectInProgressRef = useRef(false);
  const saveStartInProgressRef = useRef(false);
  // True while the save-file picker is open. On Android the picker is a system
  // activity that backgrounds (and can freeze) the page for as long as it is
  // shown, which would blow the deadline of any Modbus transfer started
  // meanwhile. Polling keeps its schedule but skips issuing requests.
  const filePickerOpenRef = useRef(false);
  const acquiringRef = useRef(false);
  const aiCalibrationRef = useRef<AiCalibration[]>(aiCalibration);
  const aoWriteInProgressRef = useRef(false);
  // Level-triggered, like the evt_cmd_send event in the reference desktop
  // implementation: an AO change that lands while a write is already on the
  // wire sets this instead of being dropped, and the driver runs one more pass
  // when the current transfer finishes. However many changes arrive during a
  // write, they cost exactly one extra frame, and it carries the newest values.
  const aoWriteRequestedRef = useRef(false);
  // Assigned during render further down, once doAoWriteAsync exists. The AO
  // setters are declared above it and must not take a dependency on its
  // identity, so the kick goes through a ref rather than a captured callback.
  const requestAoWriteRef = useRef<() => void>(() => {});
  const idealScheduleRef = useRef(0);
  const dataBufferRef = useRef<DataPoint[]>([]);
  // While saving, the chart shows the whole capture downsampled to
  // CHART_MAX_POINTS via count-stride decimation. These track the decimation
  // stride and raw-point counter (reset on each save start).
  const saveDecimationStrideRef = useRef(1);
  const saveRawCounterRef = useRef(0);
  // The Modbus poll interval on the wire — NOT the save rate. Everything that
  // has to fit inside one transfer cycle (read timeouts, the retry budget, the
  // channel-card publish floor) is measured against this.
  const pollIntervalRef = useRef(pollingRate.valueMs);
  // The recording side: the selected save interval, and the capture time the
  // next recorded sample is due at (0 = record the very next successful poll).
  //
  // A due *time* rather than a poll counter, because polls are not guaranteed to
  // happen: a read can fail, and the loop skips its request entirely while the
  // save-file picker holds the foreground. A counter would let those shift every
  // subsequent row — and would drop a row outright whenever the failed poll
  // happened to be the Nth one. With a deadline, a missed poll costs at most one
  // poll interval of lateness and the phase re-locks by itself.
  const saveIntervalRef = useRef(saveRate.valueMs);
  const nextRecordAtRef = useRef(0);
  // Chart input decimation: feed the display path one poll in every
  // `plotStrideRef`, so it runs at a fixed CHART_INPUT_INTERVAL_MS whatever the
  // poll rate. A plain counter, not a deadline like the save path above: a poll
  // lost to a failed read shifts the phase of a 10 Hz chart trace by 100 ms and
  // nothing else, whereas a missing TSV row is missing data.
  const plotStrideRef = useRef(1);
  const pollsSincePlotRef = useRef(0);
  // Measured poll interval, for the header's parenthetical. Taken from the poll
  // loop rather than from the recorded points, which at the slow save rates are
  // a different and much rarer clock: the header answers "is the link keeping
  // up", and that question is about the wire.
  const recentPollTimestampsRef = useRef<number[]>([]);
  const lastPollRatePublishRef = useRef(0);
  const [actualPollIntervalMs, setActualPollIntervalMs] = useState(0);
  const voltageConfigRef = useRef<VoltageMode[]>(voltageConfig);

  // Remote monitoring (see hooks/useViewerFeed.ts). Held in a ref because the
  // publish calls happen inside the chart-flush path, whose useCallback is
  // deliberately dependency-free: routing them through a ref keeps this feature
  // from re-creating the hottest callback in the file. The hook itself is called
  // further down, once the values it reports on exist.
  const viewerHostRef = useRef<ViewerHostHandle | null>(null);
  const [remoteViewerPanelOpen, setRemoteViewerPanelOpen] = useState(false);
  // A viewer renders the host's serial line; it has no port of its own to
  // describe, and the local DEFAULT_SERIAL_SETTINGS would be a fiction.
  const [remoteSerialLabel, setRemoteSerialLabel] = useState('');

  const handleMenuSelect = (item: string) => {
    if (item === 'calibration') {
      setCalibrationPanelOpen(true);
    } else if (item === 'hx711Calibration') {
      setHx711CalibrationPanelOpen(true);
    } else if (item === 'ads1115Calibration') {
      setAds1115CalibrationPanelOpen(true);
    } else if (item === 'modbusConfig') {
      setModbusConfigPanelOpen(true);
    } else if (item === 'voltageConfig') {
      setVoltageConfigPanelOpen(true);
    } else if (item === 'appInfo') {
      setAppInfoPanelOpen(true);
    } else if (item === 'manual') {
      setManualPanelOpen(true);
    } else if (item === 'scriptRunner') {
      setScriptRunnerPanelOpen(true);
    } else if (item === 'mcp') {
      setMcpPanelOpen(true);
    } else if (item === 'remoteViewer') {
      setRemoteViewerPanelOpen(true);
    }
  };

  const setStatus = useCallback((_msg: string) => {
    // Status display removed from header
  }, []);

  useEffect(() => {
    dataStorage.init().catch((err) => {
      console.error('Failed to initialize IndexedDB:', err);
      setStatus('IndexedDB initialization failed');
    });
  }, [setStatus]);

  // Offer back any run whose picked file never closed cleanly. Blocking
  // window.confirm() rather than in-app UI: this has to be settled before the
  // user can start a new run, and at startup there is no transient user
  // activation to open a save picker with, so recovery is a download.
  //
  // No path here deletes data the user has not confirmed receiving. Cancelling
  // either dialog keeps the copy for the next startup, which is the whole
  // reason the feature is not advertised anywhere in the UI: it either
  // silently works, or it is silently unavailable, and nothing has promised
  // the user that it will be there.
  useEffect(() => {
    // Viewer windows mirror a host's data and never own a save file.
    if (isViewerMode || recoveryPromptStarted) return;
    recoveryPromptStarted = true;

    const run = async () => {
      // Keeps a long recording's mirror from being evicted under storage
      // pressure. Best effort — a refusal changes nothing else.
      requestPersistentStorage().catch(() => {});

      const runs = await listRecoverableRuns();
      if (runs.length === 0) return;

      // One run per startup, not a loop over all of them. Each download here is
      // an <a download>.click() with no transient user activation — dismissing a
      // confirm() does not grant one — and Chromium blocks the second and later
      // such download from a page. The loop would then tell the user that files
      // 2..n "were sent to your downloads" and offer to delete copies that were
      // never written anywhere.
      const [found] = runs;
      const alsoWaiting =
        runs.length > 1
          ? `\n\n${runs.length - 1} more unsaved recording(s) will be offered the next time the app starts.`
          : '';

      const started = new Date(found.startedAt).toLocaleString();
      const offer =
        `An unsaved recording was found.\n\n` +
        `File: ${found.originalName}\n` +
        `Started: ${started}\n` +
        `Size: ${formatRunSize(found.size)}\n\n` +
        `OK downloads it as ${recoveredDownloadName(found.originalName)}.\n` +
        `Cancel deletes the recovery copy.${alsoWaiting}`;
      // Declining deletes it, rather than keeping it for another prompt at the
      // next startup. The user has been shown the run's name, start time and
      // size and said no to it; asking again every launch until they relent is
      // not protecting data, and the dialog says plainly what Cancel does.
      //
      // The second prompt below is the opposite case and still keeps: there,
      // Cancel means "the download did not arrive", so deleting would destroy
      // the very file being rescued.
      if (!window.confirm(offer)) {
        await discardRecoveredRun(found);
        return;
      }

      try {
        await downloadRecoveredRun(found);
      } catch (err) {
        window.alert(
          `Could not recover ${found.originalName}.\n\n${(err as Error).message}\n\n` +
            `The copy has been kept.`,
        );
        return;
      }

      // Nothing here can observe when the download finishes — an <a download>
      // fires no completion event, and the copy is still streaming out of OPFS
      // when click() returns. So the prompt asks the user to check rather than
      // announcing success: deleting the mirror while the browser is still
      // reading it truncates the very file being rescued, and a run this feature
      // exists for can be hundreds of megabytes.
      const cleanup =
        `${recoveredDownloadName(found.originalName)} was sent to your browser's downloads.\n\n` +
        `Once the download has finished and the file opens, press OK to delete the recovery copy.\n\n` +
        `Cancel keeps it and offers it again next time.`;
      if (window.confirm(cleanup)) await discardRecoveredRun(found);
    };

    run().catch((err) => console.warn('TSV recovery check failed:', err));
  }, []);

  useEffect(() => {
    pollIntervalRef.current = pollingRate.valueMs;
    plotStrideRef.current = Math.max(1, Math.round(CHART_INPUT_INTERVAL_MS / pollingRate.valueMs));
    pollsSincePlotRef.current = 0;
  }, [pollingRate.valueMs]);

  useEffect(() => {
    saveIntervalRef.current = saveRate.valueMs;
    // Re-arm rather than carry the old phase over: a change to the save rate
    // should take effect on the next poll, not once the deadline left over from
    // the previous rate expires (up to half an hour away).
    nextRecordAtRef.current = 0;
  }, [saveRate.valueMs]);

  // A manual choice is its own answer — no probe involved — so it takes effect
  // as soon as it is picked rather than at the next connect. (The control is
  // disabled while connected, so this can only run between sessions.)
  useEffect(() => {
    if (modbusPrecision === 'auto') return;
    resolvedPrecisionRef.current = modbusPrecision;
    setResolvedPrecision(modbusPrecision);
  }, [modbusPrecision]);

  useEffect(() => {
    saveAiCalibration(aiCalibration);
    aiCalibrationRef.current = aiCalibration;
  }, [aiCalibration]);

  useEffect(() => {
    saveVoltageConfig(voltageConfig);
    voltageConfigRef.current = voltageConfig;
  }, [voltageConfig]);

  useEffect(() => {
    saveAiFreeLabels(aiFreeLabels);
  }, [aiFreeLabels]);

  useEffect(() => {
    saveAoFreeLabels(aoFreeLabels);
  }, [aoFreeLabels]);

  useEffect(() => {
    saveParamFreeLabels(paramFreeLabels);
  }, [paramFreeLabels]);

  useEffect(() => {
    writeJsonStorage('ai_collapsed', aiCollapsed);
  }, [aiCollapsed]);

  useEffect(() => {
    writeJsonStorage('ao_collapsed', aoCollapsed);
  }, [aoCollapsed]);

  useEffect(() => {
    writeJsonStorage('param_collapsed', paramCollapsed);
  }, [paramCollapsed]);

  const handleAiFreeLabelChange = useCallback((idx: number, value: string) => {
    setAiFreeLabels((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const handleAoFreeLabelChange = useCallback((idx: number, value: string) => {
    setAoFreeLabels((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const handleParamFreeLabelChange = useCallback((idx: number, value: string) => {
    setParamFreeLabels((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }, []);

  const isSaving = !!tsvWriterRef.current;
  useEffect(() => {
    if (!isSaving || saveStartedAt === null) {
      setSaveElapsedMs(0);
      return;
    }
    const elapsedTimer = window.setInterval(() => {
      setSaveElapsedMs(Math.max(0, Date.now() - saveStartedAt));
    }, 1000);
    return () => window.clearInterval(elapsedTimer);
  }, [isSaving, saveStartedAt]);

  const flushPendingDataPoints = useCallback(() => {
    if (pendingDataPoints.current.length === 0) return;

    const pointsToAdd = pendingDataPoints.current;
    pendingDataPoints.current = [];
    const buffer = dataBufferRef.current;

    // What remote viewers are shown: exactly the points this host decided to
    // plot, not every captured point. During a save that means the decimated
    // stream, so the feed's bandwidth is bounded by the chart budget rather than
    // by the poll rate — a 50 Hz capture does not become a 50 Hz socket.
    const published: DataPoint[] = [];
    // Whether the chart buffer actually gained anything. While saving it very
    // often does not — see the redraw arming at the bottom.
    let bufferChanged = false;

    if (isViewerMode) {
      bufferChanged = true;
      // A viewer's points arrive already decimated by the host and already
      // bounded by the hub's backlog, so there is nothing to decide here: keep
      // the most recent chart budget and drop the rest. Notably this skips the
      // IndexedDB write below — a monitor is not a recorder, and the complete
      // record lives on the host's TSV.
      for (const p of pointsToAdd) buffer.push(p);
      if (buffer.length > CHART_MAX_POINTS) buffer.splice(0, buffer.length - CHART_MAX_POINTS);
    } else if (tsvWriterRef.current) {
      // Saving: keep the chart bounded by downsampling the WHOLE capture
      // (save-start → now) to ~CHART_MAX_POINTS. Add 1 of every `stride` raw
      // points, and when the buffer doubles, re-decimate by 2 and double the
      // stride. Memory and per-flush cost stay constant regardless of save
      // duration. The full data still goes to TSV.
      for (const p of pointsToAdd) {
        if (saveRawCounterRef.current % saveDecimationStrideRef.current === 0) {
          buffer.push(p);
          published.push(p);
          bufferChanged = true;
        }
        saveRawCounterRef.current++;
      }
      // Re-decimate at CHART_MAX_POINTS, not at twice it. The old 2x headroom
      // let the buffer oscillate between 2048 and 4096 points, averaging ~3000 —
      // two and a half times what the non-saving window holds at 20 Hz, on four
      // charts, rebuilt several times a second. That is why a 20 Hz capture
      // decayed to 17-18 Hz a few minutes into a save and then held there: the
      // buffer had reached its steady size, and the redraw cost with it. The
      // chart still spans the whole capture; it just carries the same point
      // budget the rest of the app already assumes.
      if (buffer.length > CHART_MAX_POINTS) {
        const decimated: DataPoint[] = [];
        for (let i = 0; i < buffer.length; i += 2) decimated.push(buffer[i]);
        dataBufferRef.current = decimated;
        saveDecimationStrideRef.current *= 2;
        // Deliberately NOT bumping chartEpoch here. Remounting all four plots
        // mid-capture costs a purge plus four fresh WebGL contexts — the same
        // periodic-rebuild anti-pattern v3.1 removed — and halving the buffer
        // twice as often as before would have doubled how often that stall
        // landed. The redraw triggered below already draws the new trace.
      }
    } else {
      // Not saving: a sliding preview of the last NON_SAVING_CHART_PREVIEW_POINTS
      // points, which at the fixed chart input rate is a ~77 s window. No
      // decimation — every point the chart is fed is drawn.
      bufferChanged = true;
      for (const p of pointsToAdd) buffer.push(p);
      published.push(...pointsToAdd);
      if (buffer.length > NON_SAVING_CHART_PREVIEW_POINTS) {
        buffer.splice(0, buffer.length - NON_SAVING_CHART_PREVIEW_POINTS);
      }

      // Persist this batch to IndexedDB in a single transaction (only while not
      // saving; during save the TSV file is the durable store). Convert the
      // Float32Array fields here so the conversion is skipped entirely on the
      // save path.
      const dbBatch: StoredDataPoint[] = pointsToAdd.map((p) => ({
        seq: p.seq,
        timestamp: p.timestamp,
        aiRaw: Array.from(p.aiRaw),
        aiPhysical: Array.from(p.aiPhysical),
        param: Array.from(p.param),
      }));
      dataStorage.addDataPoints(dbBatch).catch((err) => {
        console.error('Error adding data points:', err);
      });
      keepLatestCountRef.current += dbBatch.length;
      if (keepLatestCountRef.current >= KEEP_LATEST_TRIM_INTERVAL) {
        keepLatestCountRef.current = 0;
        dataStorage.keepLatestPoints(MAX_POINTS_IN_MEMORY).catch((err) => {
          console.error('Error trimming data points:', err);
        });
      }
    }

    // Push to remote viewers, if any. publishSamples short-circuits while remote
    // monitoring is off, so this costs one branch on the normal path.
    if (published.length > 0) {
      viewerHostRef.current?.publishSamples(
        published.map((p) => [p.seq, p.timestamp, Array.from(p.aiRaw), Array.from(p.aiPhysical), Array.from(p.param)]),
      );
    }

    // Redraws are data-driven AND rate-limited, and it takes both to be right.
    //
    // Data-driven: a flush that added nothing to the buffer arms nothing. This
    // matters more the longer a save runs. The whole-capture decimation doubles
    // its stride every time the buffer fills, so new chart points arrive every
    // 100 ms at stride 1 but only every 6.4 s at stride 64 — while the flush
    // itself keeps running 10x/s throughout. Arming on every flush therefore
    // redrew four scattergl charts a dozen times per actual change late in a
    // capture, each redraw painting a trace identical to the last, and the
    // waste grew without bound as the run got longer. That cost landed on the
    // main thread between two Modbus transfers, which is exactly where this app
    // cannot afford it.
    //
    // Rate-limited: the floor still has to be here, because early in a save
    // (stride 1) points do arrive 10x/s, and the chart is the whole capture
    // downsampled to a fixed budget — one new sample moves a handful of pixels
    // at most. The trailing-edge timer collapses that burst into one redraw of
    // the latest buffer. Together the two rules mean the redraw rate is
    // whichever is SLOWER of the point rate and this interval, with no idle
    // redraws at either end.
    //
    // Reset paths (connect/disconnect/start/stop-save) still bump
    // setDisplayRevision directly for an immediate redraw.
    if (bufferChanged && chartRedrawTimerRef.current === undefined) {
      chartRedrawTimerRef.current = window.setTimeout(() => {
        chartRedrawTimerRef.current = undefined;
        setDisplayRevision((v) => v + 1);
      }, CHART_REDRAW_INTERVAL_MS);
    }
  }, []);

  const syncAoChannels = useCallback((values: number[]) => {
    if (values.length !== AO_CHANNELS) {
      throw new Error(
        `Unexpected AO register count: expected ${AO_CHANNELS}, got ${values.length}. Check device AO configuration and Modbus communication.`,
      );
    }
    const normalizedValues = values.map((value) => Math.trunc(value));
    aoRawSourceRef.current = normalizedValues;
    lastSentAoRawRef.current = [...normalizedValues];
    setAoChannels((prev) =>
      prev.map((ch, channelIndex) => ({
        ...ch,
        raw: normalizedValues[channelIndex],
        physical: normalizedValues[channelIndex],
      })),
    );
  }, []);

  const clampAoVoltageToMilliVolt = useCallback((voltage: number): number => {
    if (!Number.isFinite(voltage)) return 0;
    const milliVolt = Math.round(voltage * 1000);
    return Math.min(AO_FULL_SCALE_MV, Math.max(0, milliVolt));
  }, []);

  const applyAoRawValues = useCallback((nextRaw: number[]) => {
    aoRawSourceRef.current = nextRaw;
    setAoChannels((prev) =>
      prev.map((channel, idx) => {
        const value = nextRaw[idx] ?? channel.raw;
        return { ...channel, raw: value, physical: value };
      }),
    );
    // Put the frame on the wire now rather than at the end of the next polling
    // cycle. The old path cost a control loop up to one full polling interval of
    // dead time per command — and back when the poll rate was also the save
    // rate, that meant minutes at the slow settings — for a transfer that takes
    // single-digit milliseconds.
    //
    // Nothing here waits or paces: the inter-frame gap and the exclusion
    // against a concurrent AI read are both the transport's job
    // (transfer()'s AsyncMutex and minMessageIntervalMs), and a second
    // implementation of either would just fight it.
    requestAoWriteRef.current();
  }, []);

  const setAo = useCallback((ch: number, data: number) => {
    if (!Number.isInteger(ch) || ch < 0 || ch >= AO_CHANNELS) return;
    const nextRaw = [...aoRawSourceRef.current];
    nextRaw[ch] = clampAoVoltageToMilliVolt(data);
    applyAoRawValues(nextRaw);
  }, [applyAoRawValues, clampAoVoltageToMilliVolt]);

  const applyCalibrationToChannels = useCallback(
    (channels: AiChannel[], calibration: AiCalibration[]) =>
      channels.map((ch, idx) => {
        const rawValue = aiRawSourceRef.current[idx] ?? ch.raw;
        const physical = aiToPhysical(rawValue, calibration[idx] ?? { a: 0, b: 1, c: 0 });
        const { voltage, microStrain } = computeSensorValues(rawValue, idx);
        return { ...ch, raw: rawValue, physical, status: getAiStatus(rawValue), voltage, microStrain };
      }),
    [],
  );

  // Tare: adjust only offset c so the channel's physical value reads 0 at the
  // current raw reading, keeping a and b unchanged.
  //   Phy = a·raw² + b·raw + c  ⇒  c = -(a·raw² + b·raw)
  const handleTareCalibration = useCallback((idx: number) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= AI_CHANNELS) return;
    setAiCalibration((prev) => {
      const cal = prev[idx];
      if (!cal) return prev;
      const raw = aiRawSourceRef.current[idx] ?? 0;
      const newC = -(cal.a * raw * raw + cal.b * raw);
      const next = [...prev];
      next[idx] = { ...cal, c: newC };
      setAiChannels((chs) => applyCalibrationToChannels(chs, next));
      return next;
    });
  }, [applyCalibrationToChannels]);

  const scriptRunner = useScriptRunner(setAo, handleTareCalibration);
  // Only the panel needs this hook; the events themselves call notify() from
  // utils/notifications directly, which is what lets a worker message handler
  // raise one without a component in the way.
  const notifications = useNotifications();

  // Mirror AO values into the ScriptRunner share so get_ao() can read them, in
  // volts to match the unit set_ao() takes (AO state is held in millivolts).
  // The share is created lazily with the worker, so this also keys on
  // scriptRunning to seed it on the first run.
  useEffect(() => {
    const share = scriptRunner.aoShareRef.current;
    if (!share) return;
    for (let i = 0; i < share.length; i++) {
      share[i] = (aoChannels[i]?.physical ?? 0) / 1000;
    }
  }, [aoChannels, scriptRunner.scriptRunning, scriptRunner.aoShareRef]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const share = scriptRunner.paramShareRef.current;
      if (!share) return;
      setParamValues((prev) => {
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== share[i]) return Array.from(share);
        }
        return prev;
      });
    }, 200);
    return () => window.clearInterval(intervalId);
  }, [scriptRunner.paramShareRef]);

  // --- MCP bridge (desktop exe only) -------------------------------------
  //
  // The launcher's MCP server owns no state; it relays tool calls here. The
  // handlers below deliberately reuse the same sources the polling loop and the
  // ScriptRunner use (aiRawSourceRef / aoRawSourceRef / the Parameter share /
  // setAo / handleTareCalibration), so the MCP tools and the Python API cannot
  // drift apart. There is exactly one ScriptRunner, so a script started over MCP
  // and one started from the panel are the same run — never two.
  const [mcpWriteEnabled, setMcpWriteEnabled] = useState(false);
  const mcpApiRef = useRef<McpApi>(null as unknown as McpApi);
  mcpApiRef.current = {
    getAiRaw: (ch) => aiRawSourceRef.current[ch] ?? 0,
    getAiPhy: (ch) =>
      aiToPhysical(aiRawSourceRef.current[ch] ?? 0, aiCalibrationRef.current[ch] ?? { a: 0, b: 1, c: 0 }),
    // AO state is held in millivolts; set_ao/get_ao speak volts like ScriptRunner.
    getAo: (ch) => (aoRawSourceRef.current[ch] ?? 0) / 1000,
    getParam: (ch) => scriptRunner.paramShareRef.current?.[ch] ?? 0,
    getStatus: () => ({
      connected,
      polling: acquiringRef.current,
      saving: activeSaveFilename !== '',
      // Two rates, deliberately both reported: the wire runs at the first, rows
      // land in the file at the second. A control script asking how fresh its
      // inputs are wants pollingIntervalMs.
      pollingIntervalMs: pollIntervalRef.current,
      saveIntervalMs: saveRate.valueMs,
      serial: `${formatSerialSettings(serialSettings)} slave ${slaveId}`,
      scriptRunning: scriptRunner.scriptRunning,
      scriptSource: scriptRunner.scriptSource,
      writeEnabled: mcpWriteEnabled,
    }),
    // Same source and shape as the ScriptRunner panel's AI-prompt button, padded
    // to full channel counts so index always equals ch.
    getLabels: () => ({
      ai: Array.from({ length: AI_CHANNELS }, (_, i) => aiFreeLabels[i] ?? ''),
      ao: Array.from({ length: AO_CHANNELS }, (_, i) => aoFreeLabels[i] ?? ''),
      param: Array.from({ length: PARAM_CHANNELS }, (_, i) => paramFreeLabels[i] ?? ''),
    }),
    readRecent: (n) =>
      dataBufferRef.current.slice(-n).map((point) => ({
        seq: point.seq,
        timestamp: point.timestamp,
        raw: Array.from(point.aiRaw),
        phy: Array.from(point.aiPhysical),
        param: Array.from(point.param),
      })),
    getScript: () => ({
      code: scriptRunner.scriptCode,
      status: scriptRunner.scriptRunnerStatus,
      running: scriptRunner.scriptRunning,
      source: scriptRunner.scriptSource,
      // How the last run ended. Read from the ref, not the rendered value: the
      // bridge answers from a socket handler that can run before React has
      // re-rendered, and a caller polling right after a crash must not be told
      // the run is still fine.
      lastRun: scriptRunner.scriptRunRef.current,
    }),
    getScriptLog: (n) => scriptRunner.scriptLogRef.current.slice(-n),
    waitForScript: scriptRunner.waitForScriptRun,
    setAo,
    setParam: (ch, value) => {
      const share = scriptRunner.paramShareRef.current;
      if (!share) throw new Error('Parameter channels are unavailable (no cross-origin isolation).');
      share[ch] = value;
    },
    setAiTare: handleTareCalibration,
    runScript: scriptRunner.runScriptFromMcp,
    stopScript: () => {
      scriptRunner.stopScriptRunner('Stopped by MCP');
      return scriptRunner.scriptRunRef.current;
    },
  };
  const mcpBridge = useMcpBridge(mcpApiRef, mcpWriteEnabled);

  // --- Remote monitoring (desktop exe only) ------------------------------
  //
  // Host side. The per-sample feed is tapped off the chart flush above; what is
  // left is the slow-moving half — labels, calibration, voltage modes and the
  // header's status line — which is republished on a timer rather than on every
  // change. A second's latency on a label is invisible, and a timer cannot be
  // forgotten the way an extra publish call at each of a dozen setState sites
  // would eventually be.
  const viewerHost = useViewerHost();
  viewerHostRef.current = viewerHost;

  // Rebuilt every render (like mcpApiRef above) so the timer below always reads
  // current values without owning them as dependencies.
  const viewerStateRef = useRef<() => ViewerStatePayload>(null as unknown as () => ViewerStatePayload);
  viewerStateRef.current = () => ({
    aiLabels: Array.from({ length: AI_CHANNELS }, (_, i) => aiFreeLabels[i] ?? ''),
    aoLabels: Array.from({ length: AO_CHANNELS }, (_, i) => aoFreeLabels[i] ?? ''),
    paramLabels: Array.from({ length: PARAM_CHANNELS }, (_, i) => paramFreeLabels[i] ?? ''),
    voltageConfig: voltageConfig.slice(0, AI_CHANNELS),
    calibration: aiCalibration.slice(0, AI_CHANNELS).map(({ a, b, c }) => ({ a, b, c })),
    aoMilliVolts: aoChannels.map((ch) => ch.physical),
    paramValues: [...paramValues],
    connected,
    saving: activeSaveFilename !== '',
    filename: activeSaveFilename,
    saveElapsedMs,
    savePointCount,
    pollingIntervalMs: pollingRate.valueMs,
    saveIntervalMs: saveRate.valueMs,
    actualPollIntervalMs,
    serial: `${serialTransportLabel} - ${formatSerialSettings(serialSettings)}`,
  });

  useEffect(() => {
    if (isViewerMode) return;
    const timer = window.setInterval(() => {
      viewerHostRef.current?.publishState(viewerStateRef.current());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Sleep suppression while there is something to lose by sleeping: a live
  // acquisition, or a script driving outputs. The page's own Screen Wake Lock
  // (requestWakeLock) covers the display while the window is visible; this asks
  // the launcher process to hold the *system* awake, which is the part a
  // minimised window cannot do for itself. Outside the exe the call is a no-op.
  const keepAwakeWanted = acquiring || scriptRunner.scriptRunning;
  const setKeepAwake = viewerHost.setKeepAwake;
  useEffect(() => {
    setKeepAwake(keepAwakeWanted);
  }, [keepAwakeWanted, setKeepAwake]);

  // Viewer side. Received samples are pushed through the same buffer and flush
  // the acquisition loop uses, so the charts and channel cards on a monitor are
  // drawn by exactly the code that draws them on the host — there is no second
  // rendering path to keep in step.
  const ingestRemoteSamples = useCallback(
    (samples: ViewerSample[]) => {
      if (samples.length === 0) return;
      for (const [seq, timestamp, raw, phy, param] of samples) {
        pendingDataPoints.current.push({
          seq,
          timestamp,
          aiRaw: Float32Array.from(raw),
          aiPhysical: Float32Array.from(phy),
          param: Float32Array.from(param),
        });
      }
      // Only the newest sample reaches the channel cards; the rest exist to fill
      // the chart. Physical values come from the host as sent — recomputing them
      // from the viewer's own calibration would show a different number from the
      // one the operator is looking at.
      const [, , lastRaw, lastPhy] = samples[samples.length - 1];
      aiRawSourceRef.current = [...lastRaw];
      setAiChannels((prev) =>
        prev.map((ch, idx) => {
          const rawValue = lastRaw[idx] ?? ch.raw;
          const { voltage, microStrain } = computeSensorValues(rawValue, idx);
          return {
            ...ch,
            raw: rawValue,
            physical: lastPhy[idx] ?? ch.physical,
            status: getAiStatus(rawValue),
            voltage,
            microStrain,
          };
        }),
      );
      flushPendingDataPoints();
    },
    [flushPendingDataPoints],
  );

  const ingestRemoteState = useCallback((state: ViewerStatePayload) => {
    // Every setter is a no-op when the value is unchanged, because this runs
    // once a second and React would otherwise re-render the whole grid on each
    // tick regardless of whether anything moved.
    const replaceIfChanged = <T,>(prev: T, next: T): T =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next;

    setAiFreeLabels((prev) => replaceIfChanged(prev, state.aiLabels));
    setAoFreeLabels((prev) => replaceIfChanged(prev, state.aoLabels));
    setParamFreeLabels((prev) => replaceIfChanged(prev, state.paramLabels));
    // Sanitized, not cast: the host may be running a different version of this
    // app and sending a mode this build does not know.
    setVoltageConfig((prev) => replaceIfChanged(prev, sanitizeVoltageConfig(state.voltageConfig)));
    setAiCalibration((prev) => replaceIfChanged(prev, state.calibration));
    setParamValues((prev) => replaceIfChanged(prev, state.paramValues));
    setAoChannels((prev) =>
      prev.map((ch, idx) => {
        const physical = state.aoMilliVolts[idx] ?? ch.physical;
        return physical === ch.physical ? ch : { ...ch, raw: physical, physical };
      }),
    );
    setConnected(state.connected);
    setActiveSaveFilename(state.filename);
    setSaveElapsedMs(state.saveElapsedMs);
    setSavePointCount(state.savePointCount);
    setActualPollIntervalMs(state.actualPollIntervalMs ?? 0);
    setRemoteSerialLabel(state.serial);
    setPollingRate((prev) =>
      prev.valueMs === state.pollingIntervalMs
        ? prev
        : POLLING_OPTIONS.find((option) => option.valueMs === state.pollingIntervalMs) ?? prev,
    );
    setSaveRate((prev) =>
      prev.valueMs === state.saveIntervalMs
        ? prev
        : SAVE_RATE_OPTIONS.find((option) => option.valueMs === state.saveIntervalMs) ?? prev,
    );
  }, []);

  const ingestRemoteReset = useCallback(() => {
    pendingDataPoints.current = [];
    dataBufferRef.current = [];
    setDisplayRevision((v) => v + 1);
  }, []);

  const viewerClient = useViewerClient({
    onState: ingestRemoteState,
    onSamples: ingestRemoteSamples,
    onReset: ingestRemoteReset,
  });

  const handleScriptEditorKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStartIndex = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const hasSelection = selectionStart !== selectionEnd;
    const indent = '  ';
    if (!event.shiftKey) {
      if (!hasSelection) {
        const nextValue = `${value.slice(0, selectionStart)}${indent}${value.slice(selectionEnd)}`;
        scriptRunner.setScriptCode(nextValue);
        window.requestAnimationFrame(() => {
          const nextCursor = selectionStart + indent.length;
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }
      const blockStart = lineStartIndex;
      const blockEnd = selectionEnd;
      const block = value.slice(blockStart, blockEnd);
      const indentedBlock = block.split('\n').map((line) => (!line.trim() ? line : `${indent}${line}`)).join('\n');
      const nextValue = `${value.slice(0, blockStart)}${indentedBlock}${value.slice(blockEnd)}`;
      scriptRunner.setScriptCode(nextValue);
      window.requestAnimationFrame(() => {
        const selectionEndOffset = indentedBlock.length - block.length;
        textarea.setSelectionRange(selectionStart + indent.length, selectionEnd + selectionEndOffset);
      });
      return;
    }
    const blockStart = lineStartIndex;
    const nextLineBreak = value.indexOf('\n', selectionStart);
    let blockEnd = selectionEnd;
    if (!hasSelection) {
      blockEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    }
    const block = value.slice(blockStart, blockEnd);
    const lines = block.split('\n');
    let removedFromFirstLine = 0;
    let removedTotal = 0;
    const outdentedBlock = lines.map((line, idx) => {
      let removeCount = 0;
      if (line.startsWith(indent)) {
        removeCount = indent.length;
      } else if (line.startsWith(' ')) {
        removeCount = 1;
      }
      if (idx === 0) removedFromFirstLine = removeCount;
      removedTotal += removeCount;
      return line.slice(removeCount);
    }).join('\n');
    const nextValue = `${value.slice(0, blockStart)}${outdentedBlock}${value.slice(blockEnd)}`;
    scriptRunner.setScriptCode(nextValue);
    window.requestAnimationFrame(() => {
      if (!hasSelection) {
        const nextCursor = Math.max(lineStartIndex, selectionStart - removedFromFirstLine);
        textarea.setSelectionRange(nextCursor, nextCursor);
        return;
      }
      const nextStart = Math.max(lineStartIndex, selectionStart - removedFromFirstLine);
      const nextEnd = Math.max(nextStart, selectionEnd - removedTotal);
      textarea.setSelectionRange(nextStart, nextEnd);
    });
  }, [scriptRunner]);

  // `timestamp` is the capture time, taken in pollOnce the moment the AI read
  // returned — NOT Date.now() from in here. This function runs from a promise
  // continuation, so reading the clock here would stamp every point with
  // whenever the display queue happened to drain, mixing render latency into
  // the recorded time base. That also made the two sinks disagree: TSV rows
  // already carried the capture time, so the chart, IndexedDB and TSV described
  // the same sample as having happened at different moments.
  const updateDataHistory = useCallback((timestamp: number, aiRaw: Float32Array, aiPhysical: Float32Array, param: Float32Array) => {
    const seq = seqCounterRef.current++;

    // Persistence (IndexedDB while not saving) and display-buffer maintenance
    // now happen in batches inside flushPendingDataPoints, so here we only
    // enqueue the captured point (Float32Array kept as-is — no per-point copy).
    pendingDataPoints.current.push({
      seq,
      timestamp,
      aiRaw,
      aiPhysical,
      param,
    });

    if (pendingDataPoints.current.length >= BATCH_FLUSH_THRESHOLD) {
      if (batchUpdateTimer.current !== undefined) {
        clearBackgroundTimer(batchUpdateTimer.current);
        batchUpdateTimer.current = undefined;
      }
      flushPendingDataPoints();
    } else if (batchUpdateTimer.current === undefined) {
      // Background timer: this is the path that moves captured points into the
      // chart buffer and IndexedDB. Left on a window timer it would stall to
      // one flush a minute behind a hidden window, so points would sit in
      // `pendingDataPoints` unsaved.
      batchUpdateTimer.current = setBackgroundTimeout(() => {
        batchUpdateTimer.current = undefined;
        flushPendingDataPoints();
      }, BATCH_FLUSH_INTERVAL_MS);
    }
  }, [flushPendingDataPoints]);

  // Retry backoff between failed Modbus reads/writes — part of the acquisition
  // path, so it gets the same throttling-proof timer as the loop itself.
  const waitMs = useCallback(async (ms: number) => {
    if (ms <= 0) return;
    await new Promise<void>((resolve) => setBackgroundTimeout(resolve, ms));
  }, []);

  const pruneFailuresInWindow = useCallback((timestampsRef: { current: number[] }, windowMs: number) => {
    const now = Date.now();
    timestampsRef.current = timestampsRef.current.filter((timestamp) => now - timestamp < windowMs);
    return timestampsRef.current.length;
  }, []);

  /**
   * The display side of a poll: channel cards, and — when `plot` is set — the
   * chart buffer, IndexedDB and the remote viewer feed.
   *
   * Both are on the poll clock, not the save rate. Only the TSV follows "Save
   * every"; a chart that advanced one point per half hour would make a
   * slow-logging run unwatchable. What the poll rate buys is control-loop
   * freshness, and the display has no use for more than 10 Hz of it.
   *
   * @param plot Whether this poll is the one in `plotStrideRef` that reaches
   *   the chart. Fixed at CHART_INPUT_INTERVAL_MS, so the display cost of a run
   *   is the same at 25 ms polling as at 100 ms.
   */
  const enqueueDisplayUpdate = useCallback((timestamp: number, aiRaw: Float32Array, aiPhysical: Float32Array, param: Float32Array, plot: boolean) => {
    displayUpdateChainRef.current = displayUpdateChainRef.current
      .then(() => {
        // Card values are published at CHANNEL_CARD_MIN_INTERVAL_MS at most, and
        // only when the poll interval is shorter than that — i.e. at the 20 and
        // 50 ms settings. There one render per sample is not affordable: every
        // publish re-renders 40 channel cards between two Modbus transfers, and
        // nobody can read a number changing 20 times a second anyway.
        const cardsDue =
          pollIntervalRef.current >= CHANNEL_CARD_MIN_INTERVAL_MS ||
          timestamp - lastCardPublishRef.current >= CHANNEL_CARD_MIN_INTERVAL_MS;
        if (cardsDue) {
          lastCardPublishRef.current = timestamp;
          setAiChannels((prev) =>
            prev.map((ch, idx) => {
              const rawValue = aiRaw[idx] ?? ch.raw;
              const { voltage, microStrain } = computeSensorValues(rawValue, idx);
              return {
                ...ch,
                raw: rawValue,
                physical: aiPhysical[idx] ?? ch.physical,
                status: getAiStatus(rawValue),
                voltage,
                microStrain,
              };
            }),
          );
        }
        if (plot) updateDataHistory(timestamp, aiRaw, aiPhysical, param);
      })
      .catch((err) => {
        console.error('[App] display update event failed', err);
      });
    displayUpdateCountRef.current++;
    if (displayUpdateCountRef.current % PROMISE_CHAIN_RESET_INTERVAL === 0) {
      displayUpdateChainRef.current = Promise.resolve();
    }
  }, [updateDataHistory]);

  const enqueueSaveUpdate = useCallback((timestamp: number, aiRaw: Float32Array, aiPhysical: Float32Array, param: Float32Array) => {
    const writer = tsvWriterRef.current;
    if (!writer) return;
    try {
      const aoRaw = new Float32Array(aoRawSourceRef.current);
      const aiVoltage = new Float32Array(aiRaw.length);
      for (let i = 0; i < aiRaw.length; i++) {
        aiVoltage[i] = rawToDisplayValue(aiRaw[i], voltageConfigRef.current[i] ?? DEFAULT_VOLTAGE_CONFIG[i]).value;
      }
      writer.writeRow(timestamp, aiRaw, aiPhysical, aoRaw, aiVoltage, param);
      // The exact count lives in a ref; React only hears about it a few times a
      // second. This runs synchronously inside pollOnce, in its own task, so as
      // a state update it forced a second full render per sample on top of the
      // channel-value one — doubling the render load during a save, which is
      // exactly when the loop can least afford the competition.
      savePointCountRef.current += 1;
      if (timestamp - lastSaveCountPublishRef.current >= READOUT_PUBLISH_INTERVAL_MS) {
        lastSaveCountPublishRef.current = timestamp;
        setSavePointCount(savePointCountRef.current);
      }
    } catch (err) {
      console.error('[App] save update failed', err);
      setStatus(`TSV write error: ${(err as Error).message}`);
    }
  }, [setStatus]);

  /** One AO block write and its single retry. Both read the newest values. */
  const writeAoBlockOnce = useCallback(async () => {
    try {
      const latest = aoRawSourceRef.current;
      await clientRef.current!.writeMultipleHoldingRegisters(AO_START_REGISTER, latest);
      lastSentAoRawRef.current = [...latest];
    } catch (writeError) {
      outputHoldingFailureTimestampsRef.current.push(Date.now());
      const normalizedWriteError =
        writeError instanceof Error ? writeError : new Error(String(writeError));
      console.warn('[App] AO write failed; retrying once', normalizedWriteError);
      try {
        await waitMs(RETRY_DELAY_MS);
        const latest = aoRawSourceRef.current;
        await clientRef.current!.writeMultipleHoldingRegisters(AO_START_REGISTER, latest);
        lastSentAoRawRef.current = [...latest];
      } catch (retryError) {
        outputHoldingFailureTimestampsRef.current.push(Date.now());
        const normalizedRetryError =
          retryError instanceof Error ? retryError : new Error(String(retryError));
        console.warn('[App] AO write failed after retry', normalizedRetryError);
      }
    }
  }, [waitMs]);

  /**
   * Send the AO block if it differs from what the device was last told.
   *
   * Called on every AO change (immediately, from applyAoRawValues) and once
   * more at the end of each polling cycle, which is the catch-up for a change
   * that arrived while the retry limiter was tripped.
   *
   * Re-entry does not drop the request: a call that arrives mid-write re-arms
   * aoWriteRequestedRef and the loop below runs one more pass. Dropping was
   * survivable while writes only left once per cycle, but with a control loop
   * setting outputs at its own rate it would silently discard commands — and
   * the one that gets discarded is by definition the most recent.
   */
  const doAoWriteAsync = useCallback(async () => {
    if (aoWriteInProgressRef.current) {
      aoWriteRequestedRef.current = true;
      return;
    }

    aoWriteInProgressRef.current = true;
    try {
      for (;;) {
        aoWriteRequestedRef.current = false;
        if (!clientRef.current) break;
        if (!hasAoValuesChanged(lastSentAoRawRef.current, aoRawSourceRef.current)) break;

        const failureCount = pruneFailuresInWindow(
          outputHoldingFailureTimestampsRef,
          OUTPUT_HOLDING_RETRY_WINDOW_MS,
        );
        if (failureCount >= OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW) {
          console.warn('[App] AO write skipped due to retry limit', {
            failureCount: outputHoldingFailureTimestampsRef.current.length,
          });
          break;
        }

        await writeAoBlockOnce();
        // Only loop for changes that arrived during the transfer just made. A
        // failed write leaves the values "changed", so without this the loop
        // would keep retrying a dead device until the limiter caught it.
        if (!aoWriteRequestedRef.current) break;
      }
    } finally {
      aoWriteInProgressRef.current = false;
    }
  }, [pruneFailuresInWindow, writeAoBlockOnce]);

  // Direct assignment during render, like mcpApiRef/viewerStateRef below: an
  // effect would leave the first AO change of the session with no writer.
  requestAoWriteRef.current = () => {
    void doAoWriteAsync();
  };

  const pollOnce = useCallback(async () => {
    if (!clientRef.current) return;
    const client = clientRef.current;
    let firstError: Error | null = null;
    const pruneAndCountAI = () =>
      pruneFailuresInWindow(inputReadFailureTimestampsRef, INPUT_READ_RETRY_WINDOW_MS);

    // 75% of the poll interval, floored at 100 ms. The floor now always wins —
    // every poll rate is 100 ms or faster — so the "never blocks longer than one
    // cycle" property the 75% was for no longer holds, and one timeout costs a
    // poll slot (four of them at 25 ms). The floor stays because it is sized for
    // the wire, not the loop: 16 i16 channels take 93 ms to transfer at the
    // slowest offered 4800 baud, and a tighter deadline would fail reads that
    // were on their way.
    const readTimeoutMs = Math.min(Math.max(Math.floor(pollIntervalRef.current * 0.75), 100), 900);
    // Never true at the current poll rates, and kept deliberately rather than
    // deleted: it is the rule, not an accident of the option list. A retry has
    // to fit inside the cycle, and below 500 ms it cannot. Losing it costs
    // little now — a dropped frame costs one poll rather than one recorded row,
    // because the recording deadline just moves to the next successful poll.
    const canRetry = pollIntervalRef.current >= 500;
    // Proportional to how often we poll — see INPUT_READ_MAX_FAILURE_RATIO.
    const failureBudget = Math.max(
      INPUT_READ_MAX_FAILURES_PER_WINDOW,
      Math.round((INPUT_READ_RETRY_WINDOW_MS / pollIntervalRef.current) * INPUT_READ_MAX_FAILURE_RATIO),
    );

    let aiSourceValues: number[] | null = null;
    if (pruneAndCountAI() >= failureBudget) {
      firstError = new Error(
        `AI read retry rate exceeded (${failureBudget}/${Math.round(INPUT_READ_RETRY_WINDOW_MS / 1000)}s). Skipping AI read until failure rate decreases.`,
      );
    } else {
      try {
        aiSourceValues = resolvedPrecisionRef.current === 'extended'
          ? await client.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER, AI_CHANNELS, readTimeoutMs)
          : await client.readInputRegisters(AI_START_REGISTER, AI_CHANNELS, readTimeoutMs);
      } catch (readError) {
        inputReadFailureTimestampsRef.current.push(Date.now());
        const normalizedReadError =
          readError instanceof Error ? readError : new Error(String(readError));
        if (canRetry && pruneAndCountAI() < failureBudget) {
          console.warn('[App] AI read failed; retrying once', normalizedReadError);
          try {
            await waitMs(RETRY_DELAY_MS);
            aiSourceValues = resolvedPrecisionRef.current === 'extended'
              ? await client.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER, AI_CHANNELS, readTimeoutMs)
              : await client.readInputRegisters(AI_START_REGISTER, AI_CHANNELS, readTimeoutMs);
          } catch (retryReadError) {
            inputReadFailureTimestampsRef.current.push(Date.now());
            firstError = new Error(
              `Failed to read AI Input Registers after retry: ${(retryReadError instanceof Error ? retryReadError : new Error(String(retryReadError))).message}`,
            );
          }
        } else if (!canRetry) {
          console.warn('[App] AI read failed; skipping retry (poll interval too short)', normalizedReadError);
          firstError = new Error(`Failed to read AI Input Registers: ${normalizedReadError.message}`);
        } else {
          firstError = new Error(
            `Failed to read AI Input Registers: ${normalizedReadError.message} (retry rate limit reached)`,
          );
        }
      }
    }

    if (aiSourceValues) {
      lastAiReadCompletedAtRef.current = Date.now();
      aiRawSourceRef.current = aiSourceValues;
      const aiRaw = new Float32Array(aiSourceValues);
      const aiPhysical = new Float32Array(
        aiSourceValues.map((value, idx) =>
          aiToPhysical(value, aiCalibrationRef.current[idx] ?? { a: 0, b: 1, c: 0 })
        )
      );

      const aiRawShare = scriptRunner.aiRawShareRef.current;
      const aiPhysicalShare = scriptRunner.aiPhysicalShareRef.current;
      if (aiRawShare && aiPhysicalShare) {
        aiRawShare.set(aiRaw);
        aiPhysicalShare.set(aiPhysical);
      }

      // Snapshot ScriptRunner Parameter values at capture time so the chart,
      // IndexedDB, and TSV all see the same per-point values.
      const paramShare = scriptRunner.paramShareRef.current;
      const param = paramShare
        ? new Float32Array(paramShare)
        : new Float32Array(PARAM_CHANNELS);

      // One capture time for every sink: chart, IndexedDB, TSV and the rate
      // readout all describe this sample as having happened here.
      const timestamp = lastAiReadCompletedAtRef.current;

      // Does this poll go to the file? Only when the save rate is slower than
      // the poll rate is the answer ever "no" — with the two equal every poll is
      // written and the deadline advances one poll at a time.
      //
      // The half-interval tolerance picks whichever poll lands nearest the
      // deadline instead of the first one past it, which keeps the written
      // interval on the poll grid rather than letting it sit a fraction of a
      // poll late for the whole run. It is strictly less than one poll interval,
      // so it can never make two consecutive polls both due.
      let record = false;
      if (nextRecordAtRef.current === 0) {
        nextRecordAtRef.current = timestamp;
      }
      if (timestamp >= nextRecordAtRef.current - pollIntervalRef.current / 2) {
        record = true;
        nextRecordAtRef.current += saveIntervalRef.current;
        // Fell behind (device stalled, machine slept, picker held the loop):
        // resync from now rather than firing off the backlog of missed
        // deadlines as a burst of rows carrying near-identical timestamps.
        if (nextRecordAtRef.current <= timestamp) {
          nextRecordAtRef.current = timestamp + saveIntervalRef.current;
        }
      }

      const plot = pollsSincePlotRef.current === 0;
      pollsSincePlotRef.current = (pollsSincePlotRef.current + 1) % plotStrideRef.current;

      enqueueDisplayUpdate(timestamp, aiRaw, aiPhysical, param, plot);
      if (record) enqueueSaveUpdate(timestamp, aiRaw, aiPhysical, param);

      // Measured poll interval for the header. Sampled here, at the top of the
      // loop, rather than downstream of the display queue: the number answers
      // "is the link keeping up", so it must not fold in how long the chart
      // took to accept the point.
      const pollTs = recentPollTimestampsRef.current;
      pollTs.push(timestamp);
      if (pollTs.length > 40) pollTs.splice(0, pollTs.length - 40);
      if (pollTs.length >= 2 && timestamp - lastPollRatePublishRef.current >= READOUT_PUBLISH_INTERVAL_MS) {
        lastPollRatePublishRef.current = timestamp;
        const elapsed = pollTs[pollTs.length - 1] - pollTs[0];
        setActualPollIntervalMs(Math.round(elapsed / (pollTs.length - 1)));
      }
    } else if (!firstError) {
      firstError = new Error('AI read failed');
    }

    // Catch-up, not the main path: AO changes go out the moment they happen
    // (applyAoRawValues). This picks up a value that was still owed because
    // the write retry limiter was tripped when it arrived.
    void doAoWriteAsync();

    setStatus(firstError ? firstError.message : 'Polling');
  }, [
    enqueueDisplayUpdate,
    enqueueSaveUpdate,
    pruneFailuresInWindow,
    waitMs,
    setStatus,
    doAoWriteAsync,
    scriptRunner.aiRawShareRef,
    scriptRunner.aiPhysicalShareRef,
    scriptRunner.paramShareRef,
  ]);

  const runPollingLoop = useCallback(async () => {
    if (pollTimer.current === undefined || pollingInProgressRef.current) return;

    pollingInProgressRef.current = true;
    const loopStart = Date.now();
    if (idealScheduleRef.current === 0) {
      idealScheduleRef.current = loopStart;
    }
    try {
      // Skip the request while the save-file picker holds the foreground; the
      // schedule below still advances, so polling resumes on its own tick.
      if (!filePickerOpenRef.current) {
        await pollOnce();
      }
    } finally {
      pollingInProgressRef.current = false;

      if (pollTimer.current === undefined) return;

      const pollIntervalMs = pollingRate.valueMs;
      idealScheduleRef.current += pollIntervalMs;
      const now = Date.now();
      if (idealScheduleRef.current < now - pollIntervalMs) {
        idealScheduleRef.current = now;
      }
      const delay = Math.max(0, idealScheduleRef.current - now);

      // Scheduled on the timer worker, not on window: a hidden or minimised
      // window has its own timers throttled to 1 Hz and then to 1/min, which
      // would turn a 100 ms polling loop into a minute-long gap in the data
      // (see utils/backgroundTimer.ts).
      pollTimer.current = setBackgroundTimeout(() => {
        void runPollingLoop();
      }, delay);
    }
  }, [pollOnce, pollingRate.valueMs]);

  const scheduleImmediatePoll = useCallback(() => {
    if (pollTimer.current !== undefined) {
      clearBackgroundTimer(pollTimer.current);
    }
    idealScheduleRef.current = 0;
    // Deliberately NOT re-phasing the recording deadline here. This runs on
    // every visibilitychange, and a user who alt-tabs ten times during a 30 min
    // save would otherwise get ten extra rows at arbitrary offsets. The deadline
    // needs no help across a gap: it is an absolute time, so a poll returning
    // after a freeze is simply past due and the catch-up clause in pollOnce
    // re-phases it from there.
    pollTimer.current = setBackgroundTimeout(() => {
      void runPollingLoop();
    }, 0);
  }, [runPollingLoop]);

  const startPolling = useCallback(() => {
    // Start of a run, unlike the resyncs scheduleImmediatePoll also serves: no
    // earlier phase to preserve, so record the first sample straight away.
    nextRecordAtRef.current = 0;
    scheduleImmediatePoll();
  }, [scheduleImmediatePoll]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== undefined) {
      clearBackgroundTimer(pollTimer.current);
      pollTimer.current = undefined;
    }
    pollingInProgressRef.current = false;
    if (batchUpdateTimer.current !== undefined) {
      clearBackgroundTimer(batchUpdateTimer.current);
      batchUpdateTimer.current = undefined;
    }
    flushPendingDataPoints();
  }, [flushPendingDataPoints]);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    if (wakeLockRef.current) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = lock;
      lock.addEventListener('release', () => {
        wakeLockRef.current = null;
      });
    } catch (err) {
      console.warn('Wake Lock request failed:', err);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch (err) {
      console.warn('Wake Lock release failed:', err);
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (acquiring) {
      startPolling();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [acquiring, startPolling, stopPolling]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!acquiringRef.current) return;
      // The browser drops a screen wake lock whenever the page stops being
      // visible and never gives it back on its own, so a window that was
      // minimised once during a capture would spend the rest of the run with
      // nothing holding the display awake. Re-take it here; requestWakeLock()
      // is a no-op when one is already held.
      void requestWakeLock();
      if (pollTimer.current === undefined || pollingInProgressRef.current) return;
      scheduleImmediatePoll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
    };
  }, [scheduleImmediatePoll, requestWakeLock]);

  const handleConnect = async () => {
    if (connectInProgressRef.current || disconnectInProgressRef.current) return;
    connectInProgressRef.current = true;
    console.info('[App] handleConnect start', {
      slaveId,
      serialSettings,
      modbusPrecision,
      connected,
    });
    let pendingClient: WebSerialModbusClient | null = null;
    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }

      pendingDataPoints.current = [];

      await dataStorage.clearAllData();
      dataBufferRef.current = [];
      viewerHostRef.current?.publishReset();
      setDisplayRevision((v) => v + 1);
      // The one place a full plot rebuild is free: no measurement is running
      // yet, and the charts are empty. Bounding WebGL/regl accumulation per
      // session is all the purge was ever for — doing it mid-capture (as the
      // save-path re-decimation used to) paid for it out of the sampling rate.
      setChartEpoch((v) => v + 1);

      const client = new WebSerialModbusClient(
        slaveId,
        serialSettings,
        serial,
        // Auto opens on the Normal timing (the wider inter-frame gap) and is
        // corrected by setPrecisionMode() once the probe has answered.
        modbusPrecision === 'extended',
        shouldUsePolyfill,
      );
      pendingClient = client;
      await client.connect();
      console.info('[App] Modbus connect success');
      try {
        console.info('[App] Sync AO holding registers start', {
          startRegister: AO_START_REGISTER,
          channels: AO_CHANNELS,
        });
        const holdingValues = await client.readHoldingRegisters(AO_START_REGISTER, AO_CHANNELS);
        console.info('[App] Sync AO holding registers success', { holdingValues });
        syncAoChannels(holdingValues);
      } catch (err) {
        console.error('[App] Sync AO holding registers failed', err);
        throw new Error(`Failed to sync AO Holding Registers: ${(err as Error).message}`);
      }

      // Resolve Auto here, after the AO sync has already proved the link works
      // end to end. Probing first would make "device is not talking at all"
      // and "device has no float registers" the same silence, and the app
      // would settle on a register map on the strength of a dead cable.
      //
      // Both the ref and the state are set before setAcquiring(true) below, so
      // the polling loop cannot start against a stale answer.
      const resolved: ModbusPrecision =
        modbusPrecision === 'auto'
          ? (await probeExtendedPrecision(client)) ? 'extended' : 'normal'
          : modbusPrecision;
      console.info('[App] precision resolved', { setting: modbusPrecision, resolved });
      client.setPrecisionMode(resolved === 'extended');
      resolvedPrecisionRef.current = resolved;
      setResolvedPrecision(resolved);

      clientRef.current = client;
      pendingClient = null;
      outputHoldingFailureTimestampsRef.current = [];
      inputReadFailureTimestampsRef.current = [];

      setConnected(true);
      acquiringRef.current = true;
      setAcquiring(true);
      // Always names the mode, including when it was chosen by the probe: an
      // Auto that got it wrong has to be visible somewhere the user looks.
      setStatus(
        `Connected @ ${formatSerialSettings(serialSettings)} - ${PRECISION_LABEL[resolved]}` +
          (modbusPrecision === 'auto' ? ' (auto)' : ''),
      );
      await requestWakeLock();
      keepLatestCountRef.current = 0;
      console.info('[App] handleConnect complete');
    } catch (err) {
      console.error('[App] handleConnect failed', err);
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      if (pendingClient) {
        await pendingClient.disconnect();
      }
      await releaseWakeLock();
      setConnected(false);
      acquiringRef.current = false;
      setAcquiring(false);

      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setStatus('Device selection cancelled');
        return;
      }
      setStatus((err as Error).message);
    } finally {
      connectInProgressRef.current = false;
    }
  };

  const handleDisconnect = useCallback(async () => {
    if (disconnectInProgressRef.current) return;
    disconnectInProgressRef.current = true;
    console.info('[App] handleDisconnect start');
    scriptRunner.stopScriptRunner('Stopped');
    acquiringRef.current = false;
    setAcquiring(false);
    stopPolling();
    clearBackgroundTimer(flushTimerRef.current);
    flushTimerRef.current = undefined;
    const writerToClose = tsvWriterRef.current;
    tsvWriterRef.current = null;
    setActiveSaveFilename('');
    setSaveStartedAt(null);
    setSaveElapsedMs(0);
    savePointCountRef.current = 0;
    lastSaveCountPublishRef.current = 0;
    setSavePointCount(0);
    try {
      if (writerToClose) {
        try {
          await writerToClose.close();
        } catch (err) {
          console.warn('Error closing TSV writer during disconnect:', err);
        }
      }
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      lastSentAoRawRef.current = null;
      aoWriteInProgressRef.current = false;
      // Cleared with the rest: a request left armed here would fire one write
      // into the next connection, before anything has set an output on it.
      aoWriteRequestedRef.current = false;
      inputReadFailureTimestampsRef.current = [];
      outputHoldingFailureTimestampsRef.current = [];
      lastAiReadCompletedAtRef.current = 0;
      displayUpdateChainRef.current = Promise.resolve();
      pendingDataPoints.current = [];
      recentPollTimestampsRef.current = [];
      lastPollRatePublishRef.current = 0;
      nextRecordAtRef.current = 0;
      setActualPollIntervalMs(0);
      await dataStorage.clearAllData();
      dataBufferRef.current = [];
      viewerHostRef.current?.publishReset();
      setDisplayRevision((v) => v + 1);
      console.info('[App] handleDisconnect data/session cleanup complete');
    } catch (err) {
      console.error('Error during disconnect:', err);
    } finally {
      await releaseWakeLock();
      setConnected(false);
      setStatus('Disconnected');
      disconnectInProgressRef.current = false;
      console.info('[App] handleDisconnect complete');
    }
  }, [releaseWakeLock, stopPolling, scriptRunner, setStatus]);

  // Two sources, because only one of them exists on any given platform.
  //
  // Native Web Serial fires 'disconnect' on navigator.serial. The WebUSB
  // polyfill used on Android does not: its Serial class is a plain object with
  // requestPort()/getPorts() and no EventTarget at all, so the guard below used
  // to return immediately and nothing ever noticed a device being unplugged
  // mid-run — the save just sat there. WebUSB has its own disconnect event on
  // navigator.usb, which is what actually fires on that path.
  useEffect(() => {
    const cleanups: Array<() => void> = [];

    if (typeof serial.addEventListener === 'function') {
      const onSerialDisconnect = (event: Event) => {
        const disconnectedPort = (event as { port?: SerialPort }).port;
        const connectedPort = clientRef.current?.getPort();
        if (!connectedPort) return;
        if (disconnectedPort && disconnectedPort !== connectedPort) return;
        console.warn('[App] Web Serial disconnect event received for active port');
        void handleDisconnect();
      };
      serial.addEventListener('disconnect', onSerialDisconnect as EventListener);
      cleanups.push(() => serial.removeEventListener('disconnect', onSerialDisconnect as EventListener));
    }

    if (typeof navigator.usb?.addEventListener === 'function') {
      const onUsbDisconnect = (event: Event) => {
        const connectedPort = clientRef.current?.getPort();
        if (!connectedPort) return;

        // Match by USB vendor/product id via the port's own getInfo(), rather
        // than by reaching into the polyfill's private device_ field, which a
        // minified build is free to rename. navigator.usb only fires for
        // devices this origin already has permission for, so on the rare tie
        // (two identical adapters paired) the worst case is tearing down a run
        // the user was about to lose anyway.
        const info = connectedPort.getInfo?.();
        const device = (event as { device?: USBDevice }).device;
        if (
          info && device &&
          info.usbVendorId !== undefined && info.usbProductId !== undefined &&
          (info.usbVendorId !== device.vendorId || info.usbProductId !== device.productId)
        ) {
          return;
        }

        console.warn('[App] WebUSB disconnect event received for active port');
        void handleDisconnect();
      };
      navigator.usb.addEventListener('disconnect', onUsbDisconnect as EventListener);
      cleanups.push(() => navigator.usb.removeEventListener('disconnect', onUsbDisconnect as EventListener));
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [handleDisconnect]);

  // Applying a PWA update reloads the page, which would drop the port and stop
  // the measurement — so no update check runs at all while a device is
  // connected (neither the periodic background one nor the App Info button).
  useEffect(() => {
    setUpdateChecksSuspended(connected);
  }, [connected]);

  const handleToggleConnection = async () => {
    if (connected) {
      await handleDisconnect();
    } else {
      await handleConnect();
    }
  };

  const updateAiCalibration = (idx: number, key: keyof AiCalibration, value: number) => {
    setAiCalibration((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      setAiChannels((chs) => applyCalibrationToChannels(chs, next));
      return next;
    });
  };

  // Overwrite a channel's full a/b/c set at once (HX711 Calibration wizard apply).
  const applyAiCalibrationValues = useCallback((idx: number, cal: AiCalibration) => {
    if (!Number.isInteger(idx) || idx < 0 || idx >= AI_CHANNELS) return;
    setAiCalibration((prev) => {
      const next = [...prev];
      next[idx] = { a: cal.a, b: cal.b, c: cal.c };
      setAiChannels((chs) => applyCalibrationToChannels(chs, next));
      return next;
    });
  }, [applyCalibrationToChannels]);

  // Live raw for a channel (freshest value; used by the capture button).
  const getAiRawValue = useCallback((ch: number) => aiRawSourceRef.current[ch] ?? 0, []);

  // Spec-method reference units per sensor. HX711: fixed electrical-unit slopes.
  // ADS1115: only the channel's V/mV slope (from its Voltage Config range).
  // The earlier 'Raw' option (slope = 1) was a meaningless b=sensitivity update,
  // so it has been dropped — set the voltage range first if the dropdown is
  // empty.
  const getHx711DenominatorOptions = useCallback(
    (): DenominatorOption[] =>
      HX711_DENOMINATOR_UNITS.map((u) => ({
        value: u.value,
        label: u.label,
        slopePerRaw: hx711SlopePerRaw(u.value),
      })),
    [],
  );

  const getAds1115DenominatorOptions = useCallback(
    (ch: number): DenominatorOption[] => {
      const options: DenominatorOption[] = [];
      const mode = voltageConfig[ch];
      if (mode) {
        const { value: slope, unit } = rawToDisplayValue(1, mode);
        if (Number.isFinite(slope) && unit) {
          options.push({ value: 'volt', label: unit, slopePerRaw: slope });
        }
      }
      return options;
    },
    [voltageConfig],
  );

  const handleDownloadCalibration = () => {
    const calibrationData: Record<string, { a: number; b: number; c: number } | string> = {};
    aiCalibration.forEach((cal, idx) => {
      const key = idx.toString().padStart(2, '0');
      calibrationData[key] = {
        a: cal.a,
        b: cal.b,
        c: cal.c,
      };
    });
    calibrationData.type = 'Calibration';
    downloadJson(`${formatCalibrationTimestamp(new Date())}.cal.json`, calibrationData);
  };

  const handleLoadCalibrationFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;

      if (data.type !== 'Calibration') {
        setStatus('Invalid calibration file format: missing "type": "Calibration" field');
        return;
      }

      const loadedCalibration: AiCalibration[] = aiCalibration.map((cal) => ({ ...cal }));
      for (let i = 0; i < AI_CHANNELS; i++) {
        const key = i.toString().padStart(2, '0');
        const channelData = data[key];
        if (!channelData || typeof channelData !== 'object') continue;

        const parsed = channelData as Partial<AiCalibration>;
        if (typeof parsed.a === 'number' && Number.isFinite(parsed.a)) {
          loadedCalibration[i].a = parsed.a;
        }
        if (typeof parsed.b === 'number' && Number.isFinite(parsed.b)) {
          loadedCalibration[i].b = parsed.b;
        }
        if (typeof parsed.c === 'number' && Number.isFinite(parsed.c)) {
          loadedCalibration[i].c = parsed.c;
        }
      }

      setAiCalibration(loadedCalibration);
      setAiChannels((prev) => applyCalibrationToChannels(prev, loadedCalibration));
      setStatus('Calibration loaded successfully');
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const handleStartSave = async () => {
    // Re-entry guard: a second Start (double-click, or a click racing the file
    // picker) would create a second writer that overwrites tsvWriterRef and
    // flushTimerRef, orphaning the first worker/interval with its file never
    // closed. Also refuse to start while a save is already active.
    if (tsvWriterRef.current || saveStartInProgressRef.current) return;
    saveStartInProgressRef.current = true;
    filePickerOpenRef.current = true;
    try {
      const writer = await createTsvWriter(
        AI_CHANNELS,
        AO_CHANNELS,
        undefined,
        3,
        PARAM_CHANNELS,
        TSV_FLUSH_MAX_ROWS,
        (message, severity) => {
          // A warning means the TSV itself is being written correctly and only
          // the crash-recovery mirror is missing. Prefixing it with "TSV write
          // error" would have the user stop a healthy run to investigate.
          if (severity === 'warning') {
            console.warn('TSV worker warning:', message);
            setStatus(message);
            return;
          }
          console.error('TSV worker error:', message);
          setStatus(`TSV write error: ${message}`);
        },
        () => {
          filePickerOpenRef.current = false;
          // The page may have been frozen while the picker was up, so the
          // polling schedule has drifted; resync from now.
          idealScheduleRef.current = 0;
        },
        resolvedPrecision === 'extended',
      );
      try {
        const startedAt = Date.now();

        pendingDataPoints.current = [];

        await dataStorage.clearAllData();
        dataBufferRef.current = [];
        viewerHostRef.current?.publishReset();
        // Restart the whole-capture downsampling from this save start.
        saveDecimationStrideRef.current = 1;
        saveRawCounterRef.current = 0;
        setDisplayRevision((v) => v + 1);

        // Re-phase the recording deadline so the file's first row lands at the
        // save start rather than wherever the free-running deadline happened to
        // be — at a 30 min save rate that is the difference between a file that
        // starts now and one that starts half an hour from now.
        //
        // It has to be adjacent to the writer assignment, not up with the other
        // resets: `await clearAllData()` above can take longer than a poll
        // interval, and a poll landing in that gap would consume the re-phase
        // (advancing the deadline by a full save interval) while
        // enqueueSaveUpdate still had no writer to write to — reintroducing
        // exactly the delay this line exists to prevent.
        nextRecordAtRef.current = 0;
        tsvWriterRef.current = writer;
        // Background timer, for the same reason as the polling loop: a throttled
        // flush would leave captured rows sitting in the worker's buffer instead
        // of on disk, which is the one place a crash must not cost data.
        flushTimerRef.current = setBackgroundInterval(() => {
          // Fire-and-forget: the worker owns the buffer and reports failures via
          // the onError callback above; this just asks it to flush periodically.
          tsvWriterRef.current?.flush();
        }, TSV_FLUSH_INTERVAL_MS);
        setActiveSaveFilename(writer.getFileName());
        setSaveStartedAt(startedAt);
        setSaveElapsedMs(0);
        savePointCountRef.current = 0;
        lastSaveCountPublishRef.current = 0;
        setSavePointCount(0);
        setStatus('Saving data to file');
      } catch (setupErr) {
        // Post-creation setup failed (e.g. IndexedDB clear): close the writer
        // so the worker and its open file are never orphaned.
        writer.close().catch(() => {});
        throw setupErr;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus((err as Error).message);
    } finally {
      // Belt and braces: onPickerSettled already cleared this, but never leave
      // polling suspended if createTsvWriter threw before reaching the picker.
      filePickerOpenRef.current = false;
      saveStartInProgressRef.current = false;
    }
  };

  const handleStopSave = async () => {
    const writerToClose = tsvWriterRef.current;
    if (!writerToClose) return;
    tsvWriterRef.current = null;
    clearBackgroundTimer(flushTimerRef.current);
    flushTimerRef.current = undefined;
    setActiveSaveFilename('');
    setSaveStartedAt(null);
    setSaveElapsedMs(0);
    savePointCountRef.current = 0;
    lastSaveCountPublishRef.current = 0;
    setSavePointCount(0);

    try {
      await writerToClose.close();
    } catch (err) {
      console.warn('Error closing TSV writer:', err);
    }

    pendingDataPoints.current = [];
    // Re-phase the recording deadline the same way the save start did. The poll
    // rate measurement is deliberately left alone: the loop kept running through
    // all of this, so zeroing its readout would only blank a live number.
    nextRecordAtRef.current = 0;

    await dataStorage.clearAllData();
    dataBufferRef.current = [];
    viewerHostRef.current?.publishReset();
    setDisplayRevision((v) => v + 1);

    setStatus('Stopped saving');
  };

  // Auto has no answer until it has connected once, and saying "i16t" before
  // the probe has run would be a claim about a device nobody has asked yet.
  const precisionLabel =
    modbusPrecision === 'auto' && !connected ? 'auto' : PRECISION_LABEL[resolvedPrecision];

  // The page background and its full-height box live on <body> (index.css)
  // rather than on this element: everything below is inside #root, which the UI
  // scale zooms, and a min-h-screen there is measured in zoomed units — a
  // quarter too tall at 125%, for a scrollbar on an otherwise empty page.
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        {/* The header is sticky, so every pixel it takes is a pixel the channel
            grid never gets back. Title, serial settings and the save status sit
            on ONE row (wrapping only when the window is too narrow for it)
            rather than in stacked blocks — that alone takes roughly a third off
            the bar, without squeezing the type down to the point where the
            status line stops being readable at a glance. */}
        <div className="px-2 py-1">
          <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0">
              <h1 className="text-lg font-bold leading-tight">
                <a
                  href="https://github.com/KikuchiMakoto/modbus_simple_logger"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-600 hover:underline dark:text-emerald-400"
                >
                  ModbusSimpleLogger
                </a>
              </h1>
              <p className="text-[0.7rem] leading-tight text-slate-600 dark:text-slate-400">
                {isViewerMode
                  ? remoteSerialLabel || 'Waiting for the host window…'
                  : `${serialTransportLabel} - ${formatSerialSettings(serialSettings)} - ${precisionLabel}`}
              </p>
              <div
                role="status"
                aria-live="polite"
                className="flex flex-wrap items-baseline gap-x-3 gap-y-0 text-[0.7rem] leading-tight text-slate-600 dark:text-slate-400"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  File: {activeSaveFilename || '-'}
                </span>
                <span className="tabular-nums">
                  Total: {formatElapsedTime(saveElapsedMs)} / # {savePointCount}
                </span>
                {/* Measured only, no nominal alongside it: the wire rate is now
                    a fixed constant rather than something the user chose, so
                    printing the target next to it would just be a reminder of
                    what 100 is. What this answers is whether the link is
                    keeping up. What reaches the file is the Save Rate, and its
                    progress is the count to the left. */}
                <span className="tabular-nums">
                  Polling: {actualPollIntervalMs > 0 ? `${actualPollIntervalMs} ms` : '-'}
                </span>
              </div>
            </div>
            {/* ml-auto, not just justify-end: once the header wraps, this group
                becomes the only item on its own line and would otherwise sit at
                the left edge, away from the window controls it belongs with. */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
              {/* The theme toggle's home is the Menu panel's header. A viewer
                  has no menu button (see below), so it keeps one here rather
                  than losing light/dark entirely — a monitor is exactly the
                  window someone leaves on a wall display and wants dimmed. */}
              {isViewerMode && <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />}
              {/* A viewer gets no controls at all — not disabled ones. Every
                  action here (connect, save, and everything behind the menu)
                  acts on hardware this machine does not have, so offering them
                  greyed out would only invite the question of how to enable
                  them. The badge says why they are missing. The restriction
                  itself is enforced by the transport, not by this branch: see
                  launcher/viewerHub.ts. */}
              {isViewerMode ? (
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    viewerClient.hostGone
                      ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300'
                      : viewerClient.connected
                        ? 'border-emerald-400 bg-emerald-50 text-emerald-700 dark:border-emerald-500/60 dark:bg-emerald-500/10 dark:text-emerald-300'
                        : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {viewerClient.hostGone
                    ? 'Monitor - host window closed'
                    : viewerClient.connected
                      ? 'Monitor (read-only)'
                      : 'Monitor - reconnecting…'}
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className={`button-touch min-w-[6rem] ${connected ? 'button-secondary' : 'button-primary'}`}
                    onClick={handleToggleConnection}
                  >
                    {connected ? 'Disconnect' : 'Connect'}
                  </button>
                  {/* Next to Start Save, not in Connection Config, because it is
                      a property of the run rather than of the link: the poll
                      rate is set once for a device, this is chosen per
                      measurement — and unlike the poll rate it stays live
                      mid-run. */}
                  <label className="flex items-center gap-1 text-[0.7rem] text-slate-600 dark:text-slate-400">
                    Save Rate
                    <select
                      value={saveRate.valueMs}
                      onChange={(e) => {
                        const next = SAVE_RATE_OPTIONS.find((option) => option.valueMs === Number(e.target.value));
                        if (next) setSaveRate(next);
                      }}
                      className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      {SAVE_RATE_OPTIONS.map((option) => (
                        <option key={option.valueMs} value={option.valueMs}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* The file the picker creates stays 0 bytes until the writer
                      closes it: a FileSystemWritableFileStream buffers into a
                      swap file and only swings it onto the target on close().
                      Nothing warns about that anywhere else — setStatus() is a
                      no-op and the header has no room for a permanent notice —
                      so it is said here, on the two buttons that bracket the
                      run. No portal/tooltip library: the sticky header (z-10,
                      positioned) is the nearest stacking context and clips
                      nothing, so a plain absolute box paints over the page.
                      Keep the last sentence as-is even once a crash-recovery
                      mirror exists: promising recovery here would have people
                      rely on it, and the promise still breaks under storage
                      eviction or a write that never landed. A rescue path
                      should announce itself only when it actually has
                      something to restore. */}
                  <div className="group relative">
                    {!tsvWriterRef.current ? (
                      <button type="button" className={`button-touch min-w-[6rem] ${connected ? 'button-primary' : 'button-secondary opacity-60 cursor-not-allowed'}`} onClick={connected ? handleStartSave : undefined} disabled={!connected} aria-describedby="save-file-note">
                        Start Save
                      </button>
                    ) : (
                      <button type="button" className="button-stop-save-pulse button-touch min-w-[6rem]" onClick={handleStopSave} aria-describedby="save-file-note">
                        Stop Save
                      </button>
                    )}
                    <div
                      id="save-file-note"
                      role="tooltip"
                      className="pointer-events-none absolute right-0 top-full z-50 mt-1 hidden w-64 rounded border border-amber-400 bg-amber-50 p-2 text-left text-[0.7rem] font-normal leading-snug text-amber-800 shadow-lg group-hover:block group-focus-within:block dark:border-amber-500/60 dark:bg-slate-800 dark:text-amber-200"
                    >
                      The file is written when you press <strong>Stop Save</strong>. It stays 0 bytes while recording, and data is lost if the browser closes first.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setHamburgerMenuOpen(true)}
                    className="button-secondary button-compact flex items-center justify-center"
                    aria-label="Open menu"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="21" y2="12" />
                      <line x1="3" y1="18" x2="21" y2="18" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          </header>
        </div>
      </div>

      {/* AI / AO / Parameter / Plot are read at a glance side by side: the gap
          between the groups is kept tight so more channels stay on one screen.
          It matches the gap between the cards inside a group (gap-1), so the
          page reads as one grid rather than four stacked panels. */}
      <div className="space-y-1 p-1.5">
        <section className="card card-tight">
        <div className="mb-px flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Analog Input (16)</h2>
          <div className="flex items-center gap-2">
            <div translate="no" className="text-right leading-tight text-slate-500 dark:text-slate-400">
              <p className="text-[0.65rem]">
                <em>Phy</em> = <em>a</em>&middot;(<em>Raw</em>)<sup>2</sup> + <em>b</em>&middot;(<em>Raw</em>) + <em>c</em>
              </p>
              <p className="text-[0.6rem]">
                <em>a</em>, <em>b</em>, <em>c</em> : Calibration Value
              </p>
            </div>
            <CollapseButton collapsed={aiCollapsed} onToggle={() => setAiCollapsed((v) => !v)} label="Analog Input" />
          </div>
        </div>
        {!aiCollapsed && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-8">
          {aiChannels.map((ch) => {
            const mode = voltageConfig[ch.id];
            const display = rawToDisplayValue(ch.raw, mode);
            const aiRatio = Math.min(1, Math.abs(ch.raw) / 32767);
            const { bar: aiMeterColor, text: aiTextColor } = getLevelColor(aiRatio);
            const aiMeterHeight = Math.max(2, aiRatio * 100);
            return (
            <div
              key={ch.id}
              translate="no"
              className="flex min-w-0 rounded border border-slate-200 bg-slate-100 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="min-w-0 flex-1 px-1 py-0.5">
                <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                  <ChannelSpecNote
                    id={`ai-spec-note-${ch.id}`}
                    label={formatAiChannelDisplayLabel(ch.id)}
                    note={ch.id < 8 ? HX711_SPEC_NOTE : ADS1115_SPEC_NOTE}
                    align={ch.id % 8 < 4 ? 'left' : 'right'}
                  />
                  <input
                    type="text"
                    value={aiFreeLabels[ch.id] ?? ''}
                    onChange={(e) => handleAiFreeLabelChange(ch.id, e.target.value)}
                    placeholder="Label"
                    readOnly={isViewerMode}
                    className="min-w-0 shrink-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-xs leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  />
                </div>
                <div className="space-y-0 pt-px text-base leading-none">
                  <div className="flex justify-between items-center leading-none">
                    <span className="shrink-0 text-sm text-slate-600 font-medium dark:text-slate-300 leading-none">Raw</span>
                    <span className={`text-xl font-bold leading-none tabular-nums ${aiTextColor}`}>
                      {/* Extended reads float32 registers, so truncating the
                          readout to an integer threw away the only thing that
                          mode is for. Normal carries int16 counts, where a
                          decimal point would be noise. */}
                      {resolvedPrecision === 'extended' ? ch.raw.toFixed(3) : ch.raw}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-px border-t border-slate-200 dark:border-slate-700 leading-none">
                    <span className="shrink-0 text-sm text-slate-600 font-medium dark:text-slate-300 leading-none">Phy</span>
                    <span className={`text-xl font-bold leading-none tabular-nums ${aiTextColor}`}>
                      {ch.physical.toFixed(3)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-px border-t border-slate-200 dark:border-slate-700 leading-none">
                    <span className="shrink-0 text-sm text-slate-600 font-medium dark:text-slate-300 leading-none">
                      {display.unit}
                    </span>
                    <span className="text-xl font-bold leading-none tabular-nums text-sky-600 dark:text-sky-400">
                      {display.value.toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex w-1 items-end overflow-hidden rounded-r">
                <div className={`w-full ${aiMeterColor}`} style={{ height: `${aiMeterHeight}%` }} />
              </div>
            </div>
            );
          })}
        </div>
        )}
      </section>

      <section className="card card-tight">
        <div className="mb-px flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Analog Output (8)</h2>
          <CollapseButton collapsed={aoCollapsed} onToggle={() => setAoCollapsed((v) => !v)} label="Analog Output" />
        </div>
        {!aoCollapsed && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-8">
          {aoChannels.map((ch) => {
            // AO is a commanded value, not a measurement: the full scale is the
            // DAC's own 0-10 V range, and there is no "too high" to warn about.
            // Hence one flat colour — the AI meter's green/yellow/red would
            // imply a limit the output does not have.
            const aoMeterHeight = Math.max(2, Math.min(1, Math.abs(ch.physical) / AO_FULL_SCALE_MV) * 100);
            return (
            <div
              key={ch.id}
              translate="no"
              className="flex min-w-0 rounded border border-slate-200 bg-slate-100 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="min-w-0 flex-1 px-1 py-0.5">
                <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                  <ChannelSpecNote
                    id={`ao-spec-note-${ch.id}`}
                    label={ch.label}
                    note={GP8403_SPEC_NOTE}
                    align={ch.id % 8 < 4 ? 'left' : 'right'}
                  />
                  <input
                    type="text"
                    value={aoFreeLabels[ch.id] ?? ''}
                    onChange={(e) => handleAoFreeLabelChange(ch.id, e.target.value)}
                    placeholder="Label"
                    readOnly={isViewerMode}
                    className="min-w-0 shrink-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-xs leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  />
                </div>
                <div className="pt-px text-base leading-none">
                  <div className="flex items-center justify-between leading-none">
                    <span className="shrink-0 text-sm font-medium text-slate-600 dark:text-slate-300 leading-none">V</span>
                    <span className="text-xl font-bold leading-none tabular-nums text-sky-600 dark:text-sky-400">
                      {(ch.physical / 1000).toFixed(3)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex w-1 items-end overflow-hidden rounded-r">
                <div className="w-full bg-sky-500" style={{ height: `${aoMeterHeight}%` }} />
              </div>
            </div>
            );
          })}
        </div>
        )}
      </section>

      <section className="card card-tight">
        <div className="mb-px flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Parameter (16)</h2>
          <CollapseButton collapsed={paramCollapsed} onToggle={() => setParamCollapsed((v) => !v)} label="Parameter" />
        </div>
        {!paramCollapsed && (
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-8 xl:grid-cols-8">
          {paramValues.map((value, idx) => (
            <div
              key={idx}
              translate="no"
              className="min-w-0 rounded border border-slate-200 bg-slate-100 px-1 py-0.5 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-700">
                <span className="shrink-0 whitespace-nowrap tracking-tighter text-xs font-semibold leading-none text-slate-700 dark:text-slate-200">
                  {`CH ${idx.toString().padStart(2, '0')}`}
                </span>
                <input
                  type="text"
                  value={paramFreeLabels[idx] ?? ''}
                  onChange={(e) => handleParamFreeLabelChange(idx, e.target.value)}
                  placeholder="Label"
                  readOnly={isViewerMode}
                  className="min-w-0 shrink-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-xs leading-none text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                />
              </div>
              <div className="pt-px text-base leading-none">
                <div className="flex items-center justify-between leading-none">
                  <span className="shrink-0 text-sm font-medium text-slate-600 dark:text-slate-300 leading-none">Val</span>
                  <span className="text-xl font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
                    {value.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-4">
        <ChartPanel
          color="#34d399"
          dataPoints={dataBufferRef.current}
          purgeEpoch={chartEpoch}
          displayRevision={displayRevision}
          axisOptions={axisOptions}
          xAxis={chart1X}
          yAxis={chart1Y}
          isDarkMode={isDarkMode}
          onXAxisChange={setChart1X}
          onYAxisChange={setChart1Y}
        />
        <ChartPanel
          color="#60a5fa"
          dataPoints={dataBufferRef.current}
          purgeEpoch={chartEpoch}
          displayRevision={displayRevision}
          axisOptions={axisOptions}
          xAxis={chart2X}
          yAxis={chart2Y}
          isDarkMode={isDarkMode}
          onXAxisChange={setChart2X}
          onYAxisChange={setChart2Y}
        />
        <ChartPanel
          color="#f472b6"
          dataPoints={dataBufferRef.current}
          purgeEpoch={chartEpoch}
          displayRevision={displayRevision}
          axisOptions={axisOptions}
          xAxis={chart3X}
          yAxis={chart3Y}
          isDarkMode={isDarkMode}
          onXAxisChange={setChart3X}
          onYAxisChange={setChart3Y}
        />
        <ChartPanel
          color="#fbbf24"
          dataPoints={dataBufferRef.current}
          purgeEpoch={chartEpoch}
          displayRevision={displayRevision}
          axisOptions={axisOptions}
          xAxis={chart4X}
          yAxis={chart4Y}
          isDarkMode={isDarkMode}
          onXAxisChange={setChart4X}
          onYAxisChange={setChart4Y}
        />
      </div>
      </div>

      <HamburgerMenu
        open={hamburgerMenuOpen}
        onClose={() => setHamburgerMenuOpen(false)}
        onSelectItem={handleMenuSelect}
        isDarkMode={isDarkMode}
        onToggleTheme={toggleTheme}
        showMcp={mcpBridge.bridgeConnected || mcpBridge.mcpEnabled}
        showRemoteViewer={viewerHost.status !== null}
      />

      <ModbusConfigPanel
        open={modbusConfigPanelOpen}
        onClose={() => setModbusConfigPanelOpen(false)}
        slaveId={slaveId}
        onSlaveIdChange={setSlaveId}
        serialSettings={serialSettings}
        onSerialSettingsChange={setSerialSettings}
        modbusPrecision={modbusPrecision}
        onModbusPrecisionChange={setModbusPrecision}
        baudOptions={BAUD_OPTIONS}
        dataBitsOptions={DATA_BITS_OPTIONS}
        stopBitsOptions={STOP_BITS_OPTIONS}
        parityOptions={PARITY_OPTIONS}
        precisionOptions={PRECISION_OPTIONS}
        pollingRate={pollingRate}
        onPollingRateChange={setPollingRate}
        pollingOptions={POLLING_OPTIONS}
        connected={connected}
      />

      <CalibrationPanel
        open={calibrationPanelOpen}
        onClose={() => setCalibrationPanelOpen(false)}
        aiCalibration={aiCalibration}
        onUpdateCalibration={updateAiCalibration}
        onTareCalibration={handleTareCalibration}
        onSaveCalibration={handleDownloadCalibration}
        onLoadCalibration={handleLoadCalibrationFile}
        locked={scriptRunner.scriptRunning}
      />

      <CalibrationWizardPanel
        open={hx711CalibrationPanelOpen}
        onClose={() => setHx711CalibrationPanelOpen(false)}
        locked={scriptRunner.scriptRunning}
        title="HX711 Calib (CH00–07)"
        subtitle="Phy = a·Raw²+b·Raw+c"
        channelStart={0}
        channelCount={8}
        referenceLabel="Reference unit (electrical)"
        defaultDenomUnit="mv_per_v"
        getDenominatorOptions={getHx711DenominatorOptions}
        getAiRaw={getAiRawValue}
        onApply={applyAiCalibrationValues}
      />

      <CalibrationWizardPanel
        open={ads1115CalibrationPanelOpen}
        onClose={() => setAds1115CalibrationPanelOpen(false)}
        locked={scriptRunner.scriptRunning}
        title="ADS1115 Calib (CH08–15)"
        subtitle="Phy = a·Raw²+b·Raw+c"
        channelStart={8}
        channelCount={8}
        referenceLabel="Reference (V)"
        defaultDenomUnit="volt"
        getDenominatorOptions={getAds1115DenominatorOptions}
        getAiRaw={getAiRawValue}
        onApply={applyAiCalibrationValues}
      />

      <VoltageConfigPanel
        open={voltageConfigPanelOpen}
        onClose={() => setVoltageConfigPanelOpen(false)}
        voltageConfig={voltageConfig}
        onVoltageConfigChange={setVoltageConfig}
      />

      <AppInfoPanel
        open={appInfoPanelOpen}
        onClose={() => setAppInfoPanelOpen(false)}
        connected={connected}
        notifications={notifications}
      />

      <ManualPanel
        open={manualPanelOpen}
        onClose={() => setManualPanelOpen(false)}
      />

      <ScriptRunnerPanel
        open={scriptRunnerPanelOpen}
        onClose={() => setScriptRunnerPanelOpen(false)}
        scriptRunner={scriptRunner}
        onEditorKeyDown={handleScriptEditorKeyDown}
        channelLabels={{ ai: aiFreeLabels, ao: aoFreeLabels, param: paramFreeLabels }}
      />

      <McpPanel
        open={mcpPanelOpen}
        onClose={() => setMcpPanelOpen(false)}
        bridge={mcpBridge}
        writeEnabled={mcpWriteEnabled}
        onWriteEnabledChange={setMcpWriteEnabled}
      />

      <RemoteViewerPanel
        open={remoteViewerPanelOpen}
        onClose={() => setRemoteViewerPanelOpen(false)}
        status={viewerHost.status}
        onEnabledChange={viewerHost.setEnabled}
      />
    </div>
  );
}

export default App;
