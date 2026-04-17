import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { WebSerialModbusClient } from './modbus/webserialClient';
import {
  AiCalibration,
  AiChannel,
  AoChannel,
  PollingRateOption,
  DataPoint,
  SerialSettings,
  ModbusPrecision,
} from './types';
import {
  aiToPhysical,
  loadAiCalibration,
  saveAiCalibration,
  getAiStatus,
  hx711RawToMvPerV,
  hx711RawToMicroStrain,
  ads1115RawToVolt,
} from './utils/calibration';
import {
  dataStorage,
  MAX_POINTS_IN_MEMORY,
  MAX_POINTS_WHILE_SAVING,
  StoredDataPoint,
} from './utils/dataStorage';
import { TsvWriter, createTsvWriter } from './utils/tsvExport';
import { ChartPanel } from './components/ChartPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { HamburgerMenu } from './components/HamburgerMenu';
import { ModbusConfigPanel } from './components/ModbusConfigPanel';
import { readJsonCookie, writeJsonCookie } from './utils/cookies';

// Polyfill Web Serial API for environments without native support (e.g., Android)
// Uses WebUSB as fallback when Web Serial API is not available
import { serial as serialPolyfill } from 'web-serial-polyfill';

// Detect if the device is mobile
function isMobileDevice(): boolean {
  // Check user agent for mobile keywords
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['android', 'webos', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone', 'mobile'];
  const isMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));

  // Check if it's a touch device
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Check screen size (optional additional check)
  const isSmallScreen = window.innerWidth <= 768;

  return isMobileUA || (isTouchDevice && isSmallScreen);
}

// Select which Serial API to use
// On mobile devices, always use polyfill for better compatibility
// On desktop, use polyfill only if native Web Serial API is not available
const serial: Serial = (isMobileDevice() || !('serial' in navigator)) ? serialPolyfill as unknown as Serial : navigator.serial;
const isUsingPolyfill = isMobileDevice() || !('serial' in navigator);

const POLLING_OPTIONS: PollingRateOption[] = [
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
];

const AI_CHANNELS = 16;
const AO_CHANNELS = 8;  // Used only for initialization
const BAUD_OPTIONS = [4800, 9600, 19200, 38400, 57600, 115200, 230400, 250000, 460800, 921600, 1500000, 2000000];
const DATA_BITS_OPTIONS: SerialSettings['dataBits'][] = [7, 8];
const STOP_BITS_OPTIONS: SerialSettings['stopBits'][] = [1, 2];
const PARITY_OPTIONS: SerialSettings['parity'][] = ['none', 'even', 'odd'];
const PRECISION_OPTIONS: { label: string; value: ModbusPrecision }[] = [
  { label: 'Normal(i16t)', value: 'normal' },
  { label: 'Extended(f32t)', value: 'extended' },
];
const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 38400,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
};
const AI_START_REGISTER = 0;
const AI_FLOAT_START_REGISTER = 5000;
const AO_START_REGISTER = 0;
const OUTPUT_HOLDING_RETRY_WINDOW_MS = 60_000;
const OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW = 10;

const computeSensorValues = (raw: number, idx: number) => {
  if (idx < 8) {
    // HX711 (AI 0-7)
    return { voltage: hx711RawToMvPerV(raw), microStrain: hx711RawToMicroStrain(raw) };
  }
  // ADS1115 (AI 8-15)
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
    label: `CH ${channelIndex} (GP8403-${channelIndex})`,
  }));

const formatAiChannelDisplayLabel = (idx: number): string =>
  `CH ${idx.toString().padStart(2, '0')} (${idx < 8 ? 'HX711' : 'ADS1115'}-${idx
    .toString(16)
    .toUpperCase()})`;

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
  ...Array.from({ length: AI_CHANNELS }, (_, idx) => ({
    key: `vlt_${idx.toString().padStart(2, '0')}`,
    label: `vlt_${idx.toString().padStart(2, '0')}`
  })),
];

const axisOptionKeys = new Set(axisOptions.map((option) => option.key));

type ThemeMode = 'light' | 'dark';

type ChartAxisSelections = {
  chart1: { x: string; y: string };
  chart2: { x: string; y: string };
};

const THEME_COOKIE_KEY = 'theme_preference_v1';
const CHART_AXES_COOKIE_KEY = 'chart_axes_v1';

const DEFAULT_CHART_AXES: ChartAxisSelections = {
  chart1: { x: 'time', y: 'raw_00' },
  chart2: { x: 'time', y: 'raw_01' },
};

const DEFAULT_SCRIPT = `# get_ai_raw(ch): Read raw AI value for a channel.
# get_ai_phy(ch): Read calibrated AI value for a channel.
# set_ao(ch, data): Write AO voltage in V (internally clamped to 0-10V).
#
# To use wait/sleep, do NOT use time.sleep() as it freezes the browser.
# Top-level await is available in this runner.
# Use asyncio instead:
# import asyncio
# await asyncio.sleep(1)`;

const getSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const loadChartAxes = (): ChartAxisSelections => {
  const saved = readJsonCookie<Partial<ChartAxisSelections>>(CHART_AXES_COOKIE_KEY) ?? {};
  const sanitize = (value: string | undefined, fallback: string, allowTime: boolean) => {
    if (!value || !axisOptionKeys.has(value)) return fallback;
    if (!allowTime && value === 'time') return fallback;
    return value;
  };
  return {
    chart1: {
      x: sanitize(saved.chart1?.x, DEFAULT_CHART_AXES.chart1.x, true),
      y: sanitize(saved.chart1?.y, DEFAULT_CHART_AXES.chart1.y, false),
    },
    chart2: {
      x: sanitize(saved.chart2?.x, DEFAULT_CHART_AXES.chart2.x, true),
      y: sanitize(saved.chart2?.y, DEFAULT_CHART_AXES.chart2.y, false),
    },
  };
};

function App() {
  const savedTheme = useMemo(() => readJsonCookie<ThemeMode>(THEME_COOKIE_KEY), []);
  const [hasUserThemePreference, setHasUserThemePreference] = useState(() => savedTheme !== null);
  const [theme, setTheme] = useState<ThemeMode>(() => savedTheme ?? getSystemTheme());
  const [slaveId, setSlaveId] = useState(1);
  const [serialSettings, setSerialSettings] = useState<SerialSettings>(DEFAULT_SERIAL_SETTINGS);
  const [modbusPrecision, setModbusPrecision] = useState<ModbusPrecision>('normal');
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(POLLING_OPTIONS[0]);
  const [aiCalibration, setAiCalibration] = useState<AiCalibration[]>(loadAiCalibration(AI_CHANNELS));
  const [aiChannels, setAiChannels] = useState<AiChannel[]>(createAiChannels(aiCalibration));
  const [aoChannels, setAoChannels] = useState<AoChannel[]>(createAoChannels());
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [tsvWriter, setTsvWriter] = useState<TsvWriter | null>(null);
  const [activeSaveFilename, setActiveSaveFilename] = useState('');
  const [saveStartedAt, setSaveStartedAt] = useState<number | null>(null);
  const [saveElapsedMs, setSaveElapsedMs] = useState(0);
  const [savePointCount, setSavePointCount] = useState(0);
  const initialAxes = useMemo(() => loadChartAxes(), []);
  const [chart1X, setChart1X] = useState(initialAxes.chart1.x);
  const [chart1Y, setChart1Y] = useState(initialAxes.chart1.y);
  const [chart2X, setChart2X] = useState(initialAxes.chart2.x);
  const [chart2Y, setChart2Y] = useState(initialAxes.chart2.y);
  const [scriptCode, setScriptCode] = useState(DEFAULT_SCRIPT);
  const scriptRunnerSupported = useMemo(
    () => typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated,
    [],
  );
  const [scriptRunning, setScriptRunning] = useState(false);
  const [scriptRunnerStatus, setScriptRunnerStatus] = useState(
    scriptRunnerSupported
      ? 'Idle'
      : 'Unavailable: requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
  );
  const clientRef = useRef<WebSerialModbusClient | null>(null);
  const aiRawSourceRef = useRef<number[]>(Array(AI_CHANNELS).fill(0));
  const aiPhysicalSourceRef = useRef<number[]>(Array(AI_CHANNELS).fill(0));
  const aoRawSourceRef = useRef<number[]>(Array(AO_CHANNELS).fill(0));
  const scriptExecutingRef = useRef(false);
  const pyWorkerRef = useRef<Worker | null>(null);
  const interruptBufferRef = useRef<Uint8Array | null>(null);
  const aiRawShareRef = useRef<Float64Array | null>(null);
  const aiPhysicalShareRef = useRef<Float64Array | null>(null);
  const pollTimer = useRef<number | undefined>(undefined);
  const pollingInProgressRef = useRef(false);
  const lastSentAoRawRef = useRef<number[] | null>(null);
  const outputHoldingFailureTimestampsRef = useRef<number[]>([]);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const pendingDataPoints = useRef<DataPoint[]>([]);
  const batchUpdateTimer = useRef<number | undefined>(undefined);
  const tsvWriterRef = useRef<TsvWriter | null>(null);
  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(false);
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const [modbusConfigPanelOpen, setModbusConfigPanelOpen] = useState(false);

  const handleMenuSelect = (item: string) => {
    if (item === 'calibration') {
      setCalibrationPanelOpen(true);
    } else if (item === 'modbusConfig') {
      setModbusConfigPanelOpen(true);
    }
  };

  // Initialize IndexedDB
  useEffect(() => {
    dataStorage.init().catch((err) => {
      console.error('Failed to initialize IndexedDB:', err);
      setStatus('IndexedDB initialization failed');
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    if (!hasUserThemePreference) return;
    writeJsonCookie(THEME_COOKIE_KEY, theme);
  }, [theme, hasUserThemePreference]);

  useEffect(() => {
    if (hasUserThemePreference) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [hasUserThemePreference]);

  useEffect(() => {
    saveAiCalibration(aiCalibration);
  }, [aiCalibration]);

  useEffect(() => {
    aiPhysicalSourceRef.current = aiChannels.map((ch) => ch.physical);
  }, [aiChannels]);

  useEffect(() => {
    writeJsonCookie(CHART_AXES_COOKIE_KEY, {
      chart1: { x: chart1X, y: chart1Y },
      chart2: { x: chart2X, y: chart2Y },
    });
  }, [chart1X, chart1Y, chart2X, chart2Y]);

  useEffect(() => {
    if (!tsvWriter || saveStartedAt === null) {
      setSaveElapsedMs(0);
      return;
    }
    const elapsedTimer = window.setInterval(() => {
      setSaveElapsedMs(Math.max(0, Date.now() - saveStartedAt));
    }, 1000);
    return () => window.clearInterval(elapsedTimer);
  }, [tsvWriter, saveStartedAt]);

  // Flush pending data points to chart (batched update)
  const flushPendingDataPoints = useCallback(() => {
    if (pendingDataPoints.current.length === 0) return;

    const pointsToAdd = [...pendingDataPoints.current];
    pendingDataPoints.current = [];
    const displayLimit = tsvWriterRef.current ? MAX_POINTS_WHILE_SAVING : MAX_POINTS_IN_MEMORY;

    setDataPoints((prev) => {
      const currentCount = prev.length;
      const pointsToAddCount = pointsToAdd.length;
      const totalAfterAdd = currentCount + pointsToAddCount;

      if (totalAfterAdd > displayLimit) {
        const pointsToRemove = totalAfterAdd - displayLimit;
        return [...prev.slice(pointsToRemove), ...pointsToAdd];
      }

      return [...prev, ...pointsToAdd];
    });
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
    return Math.min(10000, Math.max(0, milliVolt));
  }, []);

  const getAiRaw = useCallback((ch: number): number | number[] => {
    if (ch === -1) return [...aiRawSourceRef.current];
    if (!Number.isInteger(ch) || ch < 0 || ch >= AI_CHANNELS) return 0;
    return aiRawSourceRef.current[ch] ?? 0;
  }, []);

  const getAiPhysical = useCallback((ch: number): number | number[] => {
    if (ch === -1) return [...aiPhysicalSourceRef.current];
    if (!Number.isInteger(ch) || ch < 0 || ch >= AI_CHANNELS) return 0;
    return aiPhysicalSourceRef.current[ch] ?? 0;
  }, []);

  const setAo = useCallback((ch: number, data: number) => {
    if (!Number.isInteger(ch) || ch < 0 || ch >= AO_CHANNELS) return;
    const nextRaw = [...aoRawSourceRef.current];
    nextRaw[ch] = clampAoVoltageToMilliVolt(data);
    aoRawSourceRef.current = nextRaw;
    setAoChannels((prev) =>
      prev.map((channel, idx) => {
        const value = nextRaw[idx] ?? channel.raw;
        return { ...channel, raw: value, physical: value };
      }),
    );
  }, [clampAoVoltageToMilliVolt]);

  const setAoAll = useCallback((data: unknown) => {
    if (!Array.isArray(data)) return;
    const nextRaw = [...aoRawSourceRef.current];
    const count = Math.min(data.length, AO_CHANNELS);
    for (let idx = 0; idx < count; idx += 1) {
      const voltage = Number(data[idx]);
      if (!Number.isFinite(voltage)) continue;
      nextRaw[idx] = clampAoVoltageToMilliVolt(voltage);
    }
    aoRawSourceRef.current = nextRaw;
    setAoChannels((prev) =>
      prev.map((channel, idx) => {
        const value = nextRaw[idx] ?? channel.raw;
        return { ...channel, raw: value, physical: value };
      }),
    );
  }, [clampAoVoltageToMilliVolt]);

  const ensureWorkerReady = useCallback((): Worker => {
    if (pyWorkerRef.current) return pyWorkerRef.current;
    if (!scriptRunnerSupported) {
      throw new Error(
        'ScriptRunner requires cross-origin isolation (COOP/COEP headers). Reload once after Service Worker installation.',
      );
    }

    const rawSab = new SharedArrayBuffer(AI_CHANNELS * Float64Array.BYTES_PER_ELEMENT);
    const phySab = new SharedArrayBuffer(AI_CHANNELS * Float64Array.BYTES_PER_ELEMENT);
    const intSab = new SharedArrayBuffer(1);

    aiRawShareRef.current = new Float64Array(rawSab);
    aiPhysicalShareRef.current = new Float64Array(phySab);
    interruptBufferRef.current = new Uint8Array(intSab);

    const worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as
        | { type: 'set_ao'; ch: number; data: number }
        | { type: 'status'; message: string }
        | { type: 'done'; message?: string }
        | { type: 'interrupted'; message?: string }
        | { type: 'error'; message: string };
      if (message.type === 'set_ao') {
        setAo(message.ch, message.data);
      } else if (message.type === 'status') {
        setScriptRunnerStatus(message.message);
      } else if (message.type === 'done') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Completed');
      } else if (message.type === 'interrupted') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(message.message ?? 'Stopped');
      } else if (message.type === 'error') {
        scriptExecutingRef.current = false;
        setScriptRunning(false);
        setScriptRunnerStatus(`Error: ${message.message}`);
      }
    };
    worker.onerror = (event) => {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      setScriptRunnerStatus(`Error: ${event.message}`);
    };

    worker.postMessage({
      type: 'init',
      rawSab,
      phySab,
      intSab,
    });

    pyWorkerRef.current = worker;
    return worker;
  }, [scriptRunnerSupported, setAo]);

  const stopScriptRunner = useCallback((nextStatus = 'Stopped') => {
    if (interruptBufferRef.current) {
      interruptBufferRef.current[0] = 2;
      pyWorkerRef.current?.postMessage({ type: 'interrupt' });
    }
    scriptExecutingRef.current = false;
    setScriptRunning(false);
    setScriptRunnerStatus(nextStatus);
  }, []);

  const startScriptRunner = useCallback(async () => {
    if (scriptExecutingRef.current) return;
    try {
      const worker = ensureWorkerReady();
      if (interruptBufferRef.current) interruptBufferRef.current[0] = 0;
      scriptExecutingRef.current = true;
      setScriptRunning(true);
      setScriptRunnerStatus('Running');
      worker.postMessage({ type: 'run', code: scriptCode });
    } catch (err) {
      scriptExecutingRef.current = false;
      setScriptRunning(false);
      stopScriptRunner(`Error: ${(err as Error).message}`);
    }
  }, [ensureWorkerReady, scriptCode, stopScriptRunner]);

  const handleToggleScriptRunner = useCallback(() => {
    if (scriptRunning) {
      stopScriptRunner('Stopped');
      return;
    }
    void startScriptRunner();
  }, [scriptRunning, startScriptRunner, stopScriptRunner]);

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
        setScriptCode(nextValue);
        window.requestAnimationFrame(() => {
          const nextCursor = selectionStart + indent.length;
          textarea.setSelectionRange(nextCursor, nextCursor);
        });
        return;
      }

      const blockStart = lineStartIndex;
      const blockEnd = selectionEnd;
      const block = value.slice(blockStart, blockEnd);
      const indentedBlock = block
        .split('\n')
        .map((line) => (!line.trim() ? line : `${indent}${line}`))
        .join('\n');
      const nextValue = `${value.slice(0, blockStart)}${indentedBlock}${value.slice(blockEnd)}`;
      setScriptCode(nextValue);
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
      if (idx === 0) {
        removedFromFirstLine = removeCount;
      }
      removedTotal += removeCount;
      return line.slice(removeCount);
    }).join('\n');

    const nextValue = `${value.slice(0, blockStart)}${outdentedBlock}${value.slice(blockEnd)}`;
    setScriptCode(nextValue);
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
  }, [setScriptCode]);

  const updateDataHistory = useCallback(async (aiRaw: number[], aiPhysical: number[], aiVoltage: number[]) => {
    const timestamp = Date.now();
    const dataPoint: StoredDataPoint = {
      timestamp,
      aiRaw,
      aiPhysical,
      aiVoltage,
    };

    try {
      // Save to IndexedDB
      await dataStorage.addDataPoint(dataPoint);

      const displayLimit = tsvWriterRef.current ? MAX_POINTS_WHILE_SAVING : MAX_POINTS_IN_MEMORY;
      await dataStorage.keepLatestPoints(displayLimit);

      // Add new point to pending buffer for incremental chart update
      // This updates the chart without accessing IndexedDB
      pendingDataPoints.current.push({
        timestamp,
        aiRaw,
        aiPhysical,
        aiVoltage,
      });

      // Batch update: flush every 5 points or after 100ms
      if (pendingDataPoints.current.length >= 5) {
        // Clear any pending timer
        if (batchUpdateTimer.current !== undefined) {
          window.clearTimeout(batchUpdateTimer.current);
          batchUpdateTimer.current = undefined;
        }
        flushPendingDataPoints();
      } else if (batchUpdateTimer.current === undefined) {
        // Schedule flush after 100ms if not already scheduled
        batchUpdateTimer.current = window.setTimeout(() => {
          batchUpdateTimer.current = undefined;
          flushPendingDataPoints();
        }, 100);
      }
    } catch (err) {
      console.error('Error updating data history:', err);
      setStatus(`IndexedDB error: ${(err as Error).message}`);
      // Don't throw - allow polling to continue
    }
  }, [flushPendingDataPoints]);

  const pollOnce = useCallback(async () => {
    if (!clientRef.current) return;
    let firstError: Error | null = null;
    const pruneAndCountOutputHoldingFailures = () => {
      const now = Date.now();
      outputHoldingFailureTimestampsRef.current = outputHoldingFailureTimestampsRef.current.filter(
        (timestamp) => now - timestamp < OUTPUT_HOLDING_RETRY_WINDOW_MS,
      );
      return outputHoldingFailureTimestampsRef.current.length;
    };
    try {
      const effectivePrecision: 'normal' | 'extended' = modbusPrecision;

      const aiSourceValues = effectivePrecision === 'extended'
        ? await clientRef.current.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER, AI_CHANNELS)
        : await clientRef.current.readInputRegisters(AI_START_REGISTER, AI_CHANNELS);

      aiRawSourceRef.current = aiSourceValues;
      const aiRaw = aiSourceValues;
      const aiPhysical = aiSourceValues.map((value, idx) =>
        aiToPhysical(value, aiCalibration[idx] ?? { a: 0, b: 1, c: 0 })
      );
      const aiVoltage = aiRaw.map((raw, idx) => computeSensorValues(raw, idx).voltage);
      aiPhysicalSourceRef.current = aiPhysical;
      const aiRawShare = aiRawShareRef.current;
      const aiPhysicalShare = aiPhysicalShareRef.current;
      if (aiRawShare && aiPhysicalShare) {
        aiRaw.forEach((value, index) => {
          aiRawShare[index] = value;
        });
        aiPhysical.forEach((value, index) => {
          aiPhysicalShare[index] = value;
        });
      }

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

      // Wait for data history update to complete
      await updateDataHistory(aiRaw, aiPhysical, aiVoltage);

      // Write to TSV file if recording is active
      // Use ref to avoid race condition when closing the writer
      const writer = tsvWriterRef.current;
      if (writer) {
        try {
          await writer.writeRow(Date.now(), aiRaw, aiPhysical, aiVoltage);
          setSavePointCount((prev) => prev + 1);
        } catch (err) {
          // Ignore errors if stream is closing
          if (err instanceof TypeError && (err as Error).message.includes('closing')) {
            console.warn('Stream is closing, skipping write');
          } else {
            throw err;
          }
        }
      }

      console.debug('[App] pollOnce success', {
        effectivePrecision,
        aiCount: aiSourceValues.length,
        aiPreview: aiSourceValues.slice(0, 10),
        aoCount: aoRawSourceRef.current.length,
        aoPreview: aoRawSourceRef.current.slice(0, 10),
      });
    } catch (err) {
      console.error('[App] pollOnce failed', err);
      firstError = err instanceof Error ? err : new Error(String(err));
    }

    const currentAoRaw = aoRawSourceRef.current;
    const shouldWriteAo = hasAoValuesChanged(lastSentAoRawRef.current, currentAoRaw);
    if (shouldWriteAo && clientRef.current) {
      if (pruneAndCountOutputHoldingFailures() >= OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW) {
        const retryLimitError = new Error(
          `AO write retry rate exceeded (${OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW}/min). Skipping AO write until failure rate decreases.`,
        );
        console.warn('[App] AO write skipped due to retry limit', {
          failureCount: outputHoldingFailureTimestampsRef.current.length,
        });
        if (!firstError) firstError = retryLimitError;
      } else {
        try {
          await clientRef.current.writeMultipleHoldingRegisters(AO_START_REGISTER, currentAoRaw);
          lastSentAoRawRef.current = [...currentAoRaw];
        } catch (writeError) {
          outputHoldingFailureTimestampsRef.current.push(Date.now());
          const normalizedWriteError =
            writeError instanceof Error ? writeError : new Error(String(writeError));
          console.warn('[App] AO write failed; retrying once', normalizedWriteError);

          const failureCount = pruneAndCountOutputHoldingFailures();
          if (failureCount >= OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW) {
            if (!firstError) {
              firstError = new Error(
                `Failed to write AO Holding Registers: ${normalizedWriteError.message} (retry rate limit reached)`,
              );
            }
          } else {
            try {
              await clientRef.current.writeMultipleHoldingRegisters(AO_START_REGISTER, currentAoRaw);
              lastSentAoRawRef.current = [...currentAoRaw];
            } catch (retryError) {
              outputHoldingFailureTimestampsRef.current.push(Date.now());
              const normalizedRetryError =
                retryError instanceof Error ? retryError : new Error(String(retryError));
              if (!firstError) {
                firstError = new Error(
                  `Failed to write AO Holding Registers after retry: ${normalizedRetryError.message}`,
                );
              }
            }
          }
        }
      }
    }

    if (firstError) {
      setStatus(firstError.message);
    } else {
      setStatus('Polling');
    }
  }, [aiCalibration, modbusPrecision, updateDataHistory]);

  const runPollingLoop = useCallback(async () => {
    if (pollTimer.current === undefined || pollingInProgressRef.current) return;

    pollingInProgressRef.current = true;
    try {
      await pollOnce();
    } finally {
      pollingInProgressRef.current = false;

      if (pollTimer.current === undefined) return;

      pollTimer.current = window.setTimeout(() => {
        void runPollingLoop();
      }, pollingRate.valueMs);
    }
  }, [pollOnce, pollingRate.valueMs]);

  const scheduleImmediatePoll = useCallback(() => {
    if (pollTimer.current !== undefined) {
      window.clearTimeout(pollTimer.current);
    }
    pollTimer.current = window.setTimeout(() => {
      void runPollingLoop();
    }, 0);
  }, [runPollingLoop]);

  const startPolling = useCallback(() => {
    // Start first poll immediately, which will schedule the next one
    scheduleImmediatePoll();
  }, [scheduleImmediatePoll]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== undefined) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
    pollingInProgressRef.current = false;
    // Flush any pending data points when stopping
    if (batchUpdateTimer.current !== undefined) {
      window.clearTimeout(batchUpdateTimer.current);
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
    return () => {
      if (pyWorkerRef.current) {
        pyWorkerRef.current.terminate();
        pyWorkerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (pollTimer.current === undefined || pollingInProgressRef.current) return;
      scheduleImmediatePoll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pageshow', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pageshow', handleVisibilityChange);
    };
  }, [scheduleImmediatePoll]);

  const handleConnect = async () => {
    console.info('[App] handleConnect start', {
      slaveId,
      serialSettings,
      modbusPrecision,
      connected,
    });
    let pendingClient: WebSerialModbusClient | null = null;
    try {
      // Clean up any existing connection first
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }

      // Clear pending data points buffer
      pendingDataPoints.current = [];

      // Clear IndexedDB for new session
      await dataStorage.clearAllData();
      setDataPoints([]);

      // Use WebSerialModbusClient with the selected Serial API (native or polyfill)
      // On Android and unsupported platforms, this will use web-serial-polyfill with WebUSB
      const client = new WebSerialModbusClient(
        slaveId,
        serialSettings,
        serial,
        modbusPrecision === 'extended'
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
      clientRef.current = client;
      pendingClient = null;
      outputHoldingFailureTimestampsRef.current = [];

      setConnected(true);
      setAcquiring(true);
      setStatus(`Connected @ ${formatSerialSettings(serialSettings)}`);
      await requestWakeLock();
      console.info('[App] handleConnect complete');
    } catch (err) {
      console.error('[App] handleConnect failed', err);
      // Clean up on error
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      if (pendingClient) {
        await pendingClient.disconnect();
      }
      await releaseWakeLock();
      setConnected(false);
      setAcquiring(false);

      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setStatus('Device selection cancelled');
        return;
      }
      setStatus((err as Error).message);
    }
  };

  const handleDisconnect = async () => {
    console.info('[App] handleDisconnect start');
    stopScriptRunner('Stopped');
    setAcquiring(false);
    stopPolling();
    const writerToClose = tsvWriterRef.current;
    tsvWriterRef.current = null;
    setTsvWriter(null);
    setActiveSaveFilename('');
    setSaveStartedAt(null);
    setSaveElapsedMs(0);
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
      outputHoldingFailureTimestampsRef.current = [];
      // Clear pending data points buffer
      pendingDataPoints.current = [];
      // Clear IndexedDB on disconnect
      await dataStorage.clearAllData();
      setDataPoints([]);
      console.info('[App] handleDisconnect data/session cleanup complete');
    } catch (err) {
      console.error('Error during disconnect:', err);
    } finally {
      await releaseWakeLock();
      setConnected(false);
      setStatus('Disconnected');
      console.info('[App] handleDisconnect complete');
    }
  };

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
      setAiChannels((chs) =>
        chs.map((ch, cIdx) => {
          if (cIdx !== idx) return ch;
          const rawValue = aiRawSourceRef.current[idx] ?? ch.raw;
          const physical = aiToPhysical(rawValue, next[idx]);
          const { voltage, microStrain } = computeSensorValues(rawValue, idx);
          return { ...ch, physical, status: getAiStatus(ch.raw), voltage, microStrain };
        }),
      );
      return next;
    });
  };


  const handleDownloadCalibration = () => {
    const calibrationData: Record<string, any> = {};
    aiCalibration.forEach((cal, idx) => {
      const key = idx.toString().padStart(2, '0');
      calibrationData[key] = {
        a: cal.a,
        b: cal.b,
        c: cal.c,
      };
    });
    calibrationData.type = 'Calibration';
    downloadJson('calibration.json', calibrationData);
  };

  const handleLoadCalibrationFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.type !== 'Calibration') {
        setStatus('Invalid calibration file format: missing "type": "Calibration" field');
        return;
      }

      const loadedCalibration: AiCalibration[] = [];
      for (let i = 0; i < AI_CHANNELS; i++) {
        const key = i.toString().padStart(2, '0');
        if (data[key]) {
          loadedCalibration.push({
            a: data[key].a ?? 0,
            b: data[key].b ?? 1,
            c: data[key].c ?? 0,
          });
        } else {
          loadedCalibration.push({ a: 0, b: 1, c: 0 });
        }
      }

      setAiCalibration(loadedCalibration);
      setAiChannels((prev) =>
        prev.map((ch, idx) => {
          const rawValue = aiRawSourceRef.current[idx] ?? ch.raw;
          const physical = aiToPhysical(rawValue, loadedCalibration[idx]);
          const { voltage, microStrain } = computeSensorValues(rawValue, idx);
          return { ...ch, physical, status: getAiStatus(ch.raw), voltage, microStrain };
        }),
      );
      setStatus('Calibration loaded successfully');
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const handleStartSave = async () => {
    try {
      // Create TSV writer (this will prompt user for file location)
      const writer = await createTsvWriter(AI_CHANNELS);
      const startedAt = Date.now();

      // Clear pending data points buffer
      pendingDataPoints.current = [];

      // Clear chart data and IndexedDB for fresh start
      await dataStorage.clearAllData();
      setDataPoints([]);

      // Update both state and ref
      setTsvWriter(writer);
      tsvWriterRef.current = writer;
      setActiveSaveFilename(writer.getFileName());
      setSaveStartedAt(startedAt);
      setSaveElapsedMs(0);
      setSavePointCount(0);
      setStatus('Saving data to file');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // User cancelled the file picker
        return;
      }
      setStatus((err as Error).message);
    }
  };

  const handleStopSave = async () => {
    if (tsvWriter) {
      // Clear ref first to prevent pollOnce from writing to closing stream
      const writerToClose = tsvWriterRef.current;
      tsvWriterRef.current = null;
      setTsvWriter(null);
      setActiveSaveFilename('');
      setSaveStartedAt(null);
      setSaveElapsedMs(0);
      setSavePointCount(0);

      // Close the writer if it exists
      if (writerToClose) {
        try {
          await writerToClose.close();
        } catch (err) {
          console.warn('Error closing TSV writer:', err);
        }
      }

      // Clear pending data points buffer
      pendingDataPoints.current = [];

      // Clear chart data and IndexedDB
      await dataStorage.clearAllData();
      setDataPoints([]);

      setStatus('Stopped saving');
    }
  };

  const getStatusColor = (status: AiChannel['status']) => {
    switch (status) {
      case 'danger':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      default:
        return 'text-emerald-600 dark:text-emerald-400';
    }
  };

  const handleToggleTheme = () => {
    setHasUserThemePreference(true);
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const isDarkMode = theme === 'dark';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200 text-slate-900 transition-colors dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="px-3 py-1">
          <header className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-0.5">
              <div>
                <h1 className="text-xl font-bold text-emerald-600 dark:text-emerald-400">ModbusSimpleLogger</h1>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {isUsingPolyfill ? 'WebUSB' : 'WebSerial'} - {formatSerialSettings(serialSettings)}
                </p>
              </div>
              <div role="status" aria-live="polite" className="text-left text-xs text-slate-600 dark:text-slate-400">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  File: {activeSaveFilename || '-'}
                </p>
                <p className="tabular-nums">
                  Total: {formatElapsedTime(saveElapsedMs)} / Points: {savePointCount}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                aria-label="Toggle dark mode"
                onClick={handleToggleTheme}
                className="relative inline-flex h-8 w-16 items-center rounded-full border border-slate-300 bg-white px-1.5 shadow-inner transition-colors duration-300 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="sr-only">Toggle theme</span>
                <span className="absolute left-2 text-slate-500 dark:text-slate-300" aria-hidden>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 50 50"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path d="M24.906 3.969c-.043.008-.086.02-.125.031-.465.106-.793.523-.782 1V11a1.002 1.002 0 0 0 1.996 0V5c.012-.289-.105-.566-.312-.761a1 1 0 0 0-.777-.27ZM10.656 9.844c-.375.066-.676.34-.781.703-.105.367.004.758.281 1.015l4.25 4.25a1.002 1.002 0 0 0 1.703-.77 1 1 0 0 0-.349-.746l-4.25-4.25c-.207-.222-.508-.336-.813-.312-.031 0-.062 0-.094.01ZM39.031 9.844a.995.995 0 0 0-.594.312l-4.25 4.25a1.002 1.002 0 1 0 1.406 1.406l4.25-4.25c.312-.297.402-.762.218-1.152-.187-.394-.6-.62-1.03-.566ZM24.906 15c-.031.008-.062.02-.094.031-.062.004-.125.016-.188.031l-.03.031C19.29 15.32 15 19.64 15 25c0 5.504 4.496 10 10 10s10-4.497 10-10c0-5.34-4.254-9.645-9.531-9.907-.035 0-.058-.031-.094-.031a2.96 2.96 0 0 0-.312-.062H25c-.031 0-.062 0-.094.01Zm.031 2c.02 0 .043 0 .063 0 .031 0 .062 0 .094 0C29.469 17.05 33 20.613 33 25c0 4.422-3.578 8-8 8-4.418 0-8-3.578-8-8 0-4.398 3.547-7.965 7.938-8ZM4.719 24c-.551.078-.938.59-.86 1.14.078.552.59.938 1.141.86H11a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 11 24H5c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.093 0Zm34 .001c-.551.078-.938.59-.86 1.14.078.552.59.939 1.141.86H45a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 45 24.001h-6c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.094 0ZM15 33.875a1 1 0 0 0-.594.312l-4.25 4.25a.996.996 0 0 0 .348 1.594c.375.086.762-.051 1.004-.348l4.25-4.25a1.003 1.003 0 0 0-.77-1.633c-.031 0-.062 0-.094-.005Zm19.688 0a.995.995 0 0 0-.907.703c-.105.367.004.758.282 1.015l4.25 4.25c.242.297.629.434 1.004.348.371-.086.664-.379.75-.75.086-.375-.051-.762-.348-1.004l-4.25-4.25a.989.989 0 0 0-.718-.312c-.031 0-.062 0-.094.01ZM24.906 37.969c-.043.007-.086.019-.125.03-.465.106-.793.523-.782 1V45a1.002 1.002 0 0 0 1.996 0v-6c.012-.289-.105-.566-.312-.762a1 1 0 0 0-.777-.27Z" />
                  </svg>
                </span>
                <span className="absolute right-2 text-slate-500 dark:text-slate-300" aria-hidden>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                    <path d="M18.92 15.42A7 7 0 0 1 11.2 4.59a1 1 0 0 0-1.18-1.18A9 9 0 1 0 19.1 16.6a1 1 0 0 0-.18-1.18Z" />
                  </svg>
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow transition-transform duration-300 ${isDarkMode ? 'translate-x-6' : 'translate-x-0'}`}
                  aria-hidden
                >
                  {isDarkMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <path d="M21.64 13a1 1 0 0 0-1.05-.14A8 8 0 0 1 11.1 4.41 1 1 0 0 0 9.76 3a10 10 0 1 0 12.3 10Z" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 50 50"
                      fill="currentColor"
                      className="h-4 w-4"
                    >
                      <path d="M24.906 3.969c-.043.008-.086.02-.125.031-.465.106-.793.523-.782 1V11a1.002 1.002 0 0 0 1.996 0V5c.012-.289-.105-.566-.312-.761a1 1 0 0 0-.777-.27ZM10.656 9.844c-.375.066-.676.34-.781.703-.105.367.004.758.281 1.015l4.25 4.25a1.002 1.002 0 0 0 1.703-.77 1 1 0 0 0-.349-.746l-4.25-4.25c-.207-.222-.508-.336-.813-.312-.031 0-.062 0-.094.01ZM39.031 9.844a.995.995 0 0 0-.594.312l-4.25 4.25a1.002 1.002 0 1 0 1.406 1.406l4.25-4.25c.312-.297.402-.762.218-1.152-.187-.394-.6-.62-1.03-.566ZM24.906 15c-.031.008-.062.02-.094.031-.062.004-.125.016-.188.031l-.03.031C19.29 15.32 15 19.64 15 25c0 5.504 4.496 10 10 10s10-4.497 10-10c0-5.34-4.254-9.645-9.531-9.907-.035 0-.058-.031-.094-.031a2.96 2.96 0 0 0-.312-.062H25c-.031 0-.062 0-.094.01Zm.031 2c.02 0 .043 0 .063 0 .031 0 .062 0 .094 0C29.469 17.05 33 20.613 33 25c0 4.422-3.578 8-8 8-4.418 0-8-3.578-8-8 0-4.398 3.547-7.965 7.938-8ZM4.719 24c-.551.078-.938.59-.86 1.14.078.552.59.938 1.141.86H11a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 11 24H5c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.093 0Zm34 .001c-.551.078-.938.59-.86 1.14.078.552.59.939 1.141.86H45a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 45 24.001h-6c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.094 0ZM15 33.875a1 1 0 0 0-.594.312l-4.25 4.25a.996.996 0 0 0 .348 1.594c.375.086.762-.051 1.004-.348l4.25-4.25a1.003 1.003 0 0 0-.77-1.633c-.031 0-.062 0-.094-.005Zm19.688 0a.995.995 0 0 0-.907.703c-.105.367.004.758.282 1.015l4.25 4.25c.242.297.629.434 1.004.348.371-.086.664-.379.75-.75.086-.375-.051-.762-.348-1.004l-4.25-4.25a.989.989 0 0 0-.718-.312c-.031 0-.062 0-.094.01ZM24.906 37.969c-.043.007-.086.019-.125.03-.465.106-.793.523-.782 1V45a1.002 1.002 0 0 0 1.996 0v-6c.012-.289-.105-.566-.312-.762a1 1 0 0 0-.777-.27Z" />
                    </svg>
                  )}
                </span>
              </button>
              <button
                type="button"
                className={connected ? 'button-secondary' : 'button-primary'}
                onClick={handleToggleConnection}
              >
                {connected ? 'Disconnect' : 'Connect'}
              </button>
              {!tsvWriter ? (
                <button type="button" className="button-primary" onClick={handleStartSave}>
                  Start Save
                </button>
              ) : (
                <button type="button" className="button-stop-save-pulse" onClick={handleStopSave}>
                  Stop Save
                </button>
              )}
              <button
                type="button"
                onClick={() => setHamburgerMenuOpen(true)}
                className="button-secondary flex items-center justify-center p-1.5"
                aria-label="Open menu"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            </div>
          </header>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <section className="card">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Analog Input (16)</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
          {aiChannels.map((ch) => (
            <div
              key={ch.id}
              className="rounded-lg border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="border-b border-slate-200 pb-0.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                {formatAiChannelDisplayLabel(ch.id)}
              </div>
              <div className="space-y-0.5 pt-0.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Raw(x)</span>
                  <span className={`text-lg font-bold tabular-nums ${getStatusColor(ch.status)}`}>
                    {(
                      modbusPrecision === 'extended'
                    ) ? Math.trunc(ch.raw) : ch.raw}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-0.5 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Phy(y)</span>
                  <span className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {ch.physical.toFixed(3)}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-0.5 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-slate-600 font-medium dark:text-slate-300">
                    {ch.id < 8 ? 'mV/V' : 'V'}
                  </span>
                  <span className="text-lg font-bold tabular-nums text-sky-600 dark:text-sky-400">
                    {ch.voltage.toFixed(ch.id < 8 ? 4 : 3)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="mb-1.5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Analog Output (8)</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8">
          {aoChannels.map((ch) => (
            <div
              key={ch.id}
              className="rounded-lg border border-slate-200 bg-slate-100 p-1.5 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="border-b border-slate-200 pb-0.5 text-center text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                {ch.label}
              </div>
              <div className="space-y-0.5 pt-0.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-600 dark:text-slate-300">V</span>
                  <span className="text-lg font-bold tabular-nums text-violet-600 dark:text-violet-300">
                    {(ch.physical / 1000).toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ChartPanel
          color="#34d399"
          dataPoints={dataPoints}
          axisOptions={axisOptions}
          xAxis={chart1X}
          yAxis={chart1Y}
          isDarkMode={theme === 'dark'}
          onXAxisChange={setChart1X}
          onYAxisChange={setChart1Y}
        />
        <ChartPanel
          color="#60a5fa"
          dataPoints={dataPoints}
          axisOptions={axisOptions}
          xAxis={chart2X}
          yAxis={chart2Y}
          isDarkMode={theme === 'dark'}
          onXAxisChange={setChart2X}
          onYAxisChange={setChart2Y}
        />
        <section className="card space-y-2 md:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-amber-400">ScriptRunner (Pyodide)</h2>
            <button
              type="button"
              className="button-primary"
              onClick={handleToggleScriptRunner}
              disabled={!scriptRunnerSupported}
            >
              {scriptRunning ? 'Stop' : 'Run'}
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Status: {scriptRunnerStatus}</p>
          <textarea
            value={scriptCode}
            onChange={(e) => setScriptCode(e.target.value)}
            onKeyDown={handleScriptEditorKeyDown}
            className="min-h-[240px] w-full rounded border border-slate-300 bg-white p-2 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            spellCheck={false}
          />
        </section>
      </div>
      </div>

      <HamburgerMenu
        open={hamburgerMenuOpen}
        onClose={() => setHamburgerMenuOpen(false)}
        onSelectItem={handleMenuSelect}
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
        onSaveCalibration={handleDownloadCalibration}
        onLoadCalibration={handleLoadCalibrationFile}
      />
    </div>
  );
}

export default App;
