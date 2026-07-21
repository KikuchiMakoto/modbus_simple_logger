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
  VoltageMode,
} from './types';
import {
  AI_CHANNELS,
  AO_CHANNELS,
  PARAM_CHANNELS,
  AI_START_REGISTER,
  AI_FLOAT_START_REGISTER,
  AO_START_REGISTER,
  RETRY_DELAY_MS,
  INPUT_READ_RETRY_WINDOW_MS,
  INPUT_READ_MAX_FAILURES_PER_WINDOW,
  OUTPUT_HOLDING_RETRY_WINDOW_MS,
  OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW,
  MAX_POINTS_IN_MEMORY,
  CHART_MAX_POINTS,
  NON_SAVING_CHART_WINDOW_MS,
  BATCH_FLUSH_THRESHOLD,
  BATCH_FLUSH_INTERVAL_MS,
  KEEP_LATEST_TRIM_INTERVAL,
  PROMISE_CHAIN_RESET_INTERVAL,
  TSV_FLUSH_INTERVAL_MS,
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
  isUnknownMode,
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
import { TsvWriter, createTsvWriter } from './utils/tsvExport';
import { ChartPanel } from './components/ChartPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { HamburgerMenu } from './components/HamburgerMenu';
import { ModbusConfigPanel } from './components/ModbusConfigPanel';
import { VoltageConfigPanel } from './components/VoltageConfigPanel';
import { AppInfoPanel } from './components/AppInfoPanel';
import { ManualPanel } from './components/ManualPanel';
import { ScriptRunnerPanel } from './components/ScriptRunnerPanel';
import { useTheme } from './hooks/useTheme';
import { useChartAxes } from './hooks/useChartAxes';
import { useScriptRunner } from './hooks/useScriptRunner';
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

const POLLING_OPTIONS: PollingRateOption[] = [
  { label: '50 ms', valueMs: 50 },
  { label: '100 ms', valueMs: 100 },
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
  const [modbusPrecision, setModbusPrecision] = useState<ModbusPrecision>('normal');
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(POLLING_OPTIONS.find(p => p.valueMs === 200)!);
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
  const [calibrationPanelOpen, setCalibrationPanelOpen] = useState(false);
  const [hamburgerMenuOpen, setHamburgerMenuOpen] = useState(false);
  const [modbusConfigPanelOpen, setModbusConfigPanelOpen] = useState(false);
  const [voltageConfigPanelOpen, setVoltageConfigPanelOpen] = useState(false);
  const [appInfoPanelOpen, setAppInfoPanelOpen] = useState(false);
  const [manualPanelOpen, setManualPanelOpen] = useState(false);
  const [scriptRunnerPanelOpen, setScriptRunnerPanelOpen] = useState(false);
  const [voltageConfig, setVoltageConfig] = useState<VoltageMode[]>(() => loadVoltageConfig());
  const [aiFreeLabels, setAiFreeLabels] = useState<string[]>(() => loadAiFreeLabels());
  const [aoFreeLabels, setAoFreeLabels] = useState<string[]>(() => loadAoFreeLabels());
  const [paramFreeLabels, setParamFreeLabels] = useState<string[]>(() => loadParamFreeLabels());
  const [paramValues, setParamValues] = useState<number[]>(() => Array(PARAM_CHANNELS).fill(0));

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
  const recentTimestampsRef = useRef<number[]>([]);
  const [actualRateHz, setActualRateHz] = useState<number>(0);
  const pendingDataPoints = useRef<DataPoint[]>([]);
  const batchUpdateTimer = useRef<number | undefined>(undefined);
  const tsvWriterRef = useRef<TsvWriter | null>(null);
  const seqCounterRef = useRef(0);
  const displayUpdateChainRef = useRef<Promise<void>>(Promise.resolve());
  const displayUpdateCountRef = useRef(0);
  const flushTimerRef = useRef<number | undefined>(undefined);
  const keepLatestCountRef = useRef(0);
  const disconnectInProgressRef = useRef(false);
  const connectInProgressRef = useRef(false);
  const acquiringRef = useRef(false);
  const aiCalibrationRef = useRef<AiCalibration[]>(aiCalibration);
  const aoWriteInProgressRef = useRef(false);
  const idealScheduleRef = useRef(0);
  const dataBufferRef = useRef<DataPoint[]>([]);
  // While saving, the chart shows the whole capture downsampled to
  // CHART_MAX_POINTS via count-stride decimation. These track the decimation
  // stride and raw-point counter (reset on each save start).
  const saveDecimationStrideRef = useRef(1);
  const saveRawCounterRef = useRef(0);
  const pollingRateRef = useRef(pollingRate.valueMs);
  const voltageConfigRef = useRef<VoltageMode[]>(voltageConfig);

  const handleMenuSelect = (item: string) => {
    if (item === 'calibration') {
      setCalibrationPanelOpen(true);
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

  useEffect(() => {
    pollingRateRef.current = pollingRate.valueMs;
  }, [pollingRate.valueMs]);

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

    if (tsvWriterRef.current) {
      // Saving: keep the chart bounded by downsampling the WHOLE capture
      // (save-start → now) to ~CHART_MAX_POINTS. Add 1 of every `stride` raw
      // points, and when the buffer doubles, re-decimate by 2 and double the
      // stride. Memory and per-flush cost stay constant regardless of save
      // duration. The full data still goes to TSV.
      for (const p of pointsToAdd) {
        if (saveRawCounterRef.current % saveDecimationStrideRef.current === 0) {
          buffer.push(p);
        }
        saveRawCounterRef.current++;
      }
      if (buffer.length > 2 * CHART_MAX_POINTS) {
        const decimated: DataPoint[] = [];
        for (let i = 0; i < buffer.length; i += 2) decimated.push(buffer[i]);
        dataBufferRef.current = decimated;
        saveDecimationStrideRef.current *= 2;
      }
    } else {
      // Not saving: show a sliding ~NON_SAVING_CHART_WINDOW_MS time window.
      for (const p of pointsToAdd) buffer.push(p);
      const cutoff = Date.now() - NON_SAVING_CHART_WINDOW_MS;
      let drop = 0;
      while (drop < buffer.length && buffer[drop].timestamp < cutoff) drop++;
      if (buffer.length - drop > CHART_MAX_POINTS) {
        drop = buffer.length - CHART_MAX_POINTS;
      }
      if (drop > 0) buffer.splice(0, drop);

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

    setDisplayRevision((v) => v + 1);
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

  const applyAoRawValues = useCallback((nextRaw: number[]) => {
    aoRawSourceRef.current = nextRaw;
    setAoChannels((prev) =>
      prev.map((channel, idx) => {
        const value = nextRaw[idx] ?? channel.raw;
        return { ...channel, raw: value, physical: value };
      }),
    );
  }, []);

  const setAo = useCallback((ch: number, data: number) => {
    if (!Number.isInteger(ch) || ch < 0 || ch >= AO_CHANNELS) return;
    const nextRaw = [...aoRawSourceRef.current];
    nextRaw[ch] = clampAoVoltageToMilliVolt(data);
    applyAoRawValues(nextRaw);
  }, [applyAoRawValues, clampAoVoltageToMilliVolt]);

  const scriptRunner = useScriptRunner(setAo);

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

  const updateDataHistory = useCallback((aiRaw: Float32Array, aiPhysical: Float32Array, param: Float32Array) => {
    const timestamp = Date.now();
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

    const ts = recentTimestampsRef.current;
    ts.push(timestamp);
    if (ts.length > 40) ts.splice(0, ts.length - 40);
    if (ts.length >= 2) {
      const elapsed = ts[ts.length - 1] - ts[0];
      if (elapsed > 0) {
        setActualRateHz(Math.round(((ts.length - 1) / elapsed) * 1000 * 10) / 10);
      }
    }

    if (pendingDataPoints.current.length >= BATCH_FLUSH_THRESHOLD) {
      if (batchUpdateTimer.current !== undefined) {
        window.clearTimeout(batchUpdateTimer.current);
        batchUpdateTimer.current = undefined;
      }
      flushPendingDataPoints();
    } else if (batchUpdateTimer.current === undefined) {
      batchUpdateTimer.current = window.setTimeout(() => {
        batchUpdateTimer.current = undefined;
        flushPendingDataPoints();
      }, BATCH_FLUSH_INTERVAL_MS);
    }
  }, [flushPendingDataPoints]);

  const waitMs = useCallback(async (ms: number) => {
    if (ms <= 0) return;
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }, []);

  const pruneFailuresInWindow = useCallback((timestampsRef: { current: number[] }, windowMs: number) => {
    const now = Date.now();
    timestampsRef.current = timestampsRef.current.filter((timestamp) => now - timestamp < windowMs);
    return timestampsRef.current.length;
  }, []);

  const enqueueDisplayUpdate = useCallback((aiRaw: Float32Array, aiPhysical: Float32Array, param: Float32Array) => {
    displayUpdateChainRef.current = displayUpdateChainRef.current
      .then(() => {
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
        updateDataHistory(aiRaw, aiPhysical, param);
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
        aiVoltage[i] = rawToDisplayValue(aiRaw[i], voltageConfigRef.current[i] ?? 'unknown').value;
      }
      writer.writeRow(timestamp, aiRaw, aiPhysical, aoRaw, aiVoltage, param);
      setSavePointCount((prev) => prev + 1);
    } catch (err) {
      console.error('[App] save update failed', err);
      setStatus(`TSV write error: ${(err as Error).message}`);
    }
  }, [setStatus]);

  const doAoWriteAsync = useCallback(async () => {
    if (aoWriteInProgressRef.current) return;
    const currentAoRaw = aoRawSourceRef.current;
    if (!hasAoValuesChanged(lastSentAoRawRef.current, currentAoRaw)) return;
    if (!clientRef.current) return;

    const failureCount = pruneFailuresInWindow(
      outputHoldingFailureTimestampsRef,
      OUTPUT_HOLDING_RETRY_WINDOW_MS,
    );
    if (failureCount >= OUTPUT_HOLDING_MAX_FAILURES_PER_WINDOW) {
      console.warn('[App] AO write skipped due to retry limit', {
        failureCount: outputHoldingFailureTimestampsRef.current.length,
      });
      return;
    }

    aoWriteInProgressRef.current = true;
    try {
      const latest = aoRawSourceRef.current;
      await clientRef.current.writeMultipleHoldingRegisters(AO_START_REGISTER, latest);
      lastSentAoRawRef.current = [...latest];
    } catch (writeError) {
      outputHoldingFailureTimestampsRef.current.push(Date.now());
      const normalizedWriteError =
        writeError instanceof Error ? writeError : new Error(String(writeError));
      console.warn('[App] AO write failed; retrying once', normalizedWriteError);
      try {
        await waitMs(RETRY_DELAY_MS);
        const latest = aoRawSourceRef.current;
        await clientRef.current.writeMultipleHoldingRegisters(AO_START_REGISTER, latest);
        lastSentAoRawRef.current = [...latest];
      } catch (retryError) {
        outputHoldingFailureTimestampsRef.current.push(Date.now());
        const normalizedRetryError =
          retryError instanceof Error ? retryError : new Error(String(retryError));
        console.warn('[App] AO write failed after retry', normalizedRetryError);
      }
    } finally {
      aoWriteInProgressRef.current = false;
    }
  }, [pruneFailuresInWindow, waitMs]);

  const pollOnce = useCallback(async () => {
    if (!clientRef.current) return;
    const client = clientRef.current;
    let firstError: Error | null = null;
    const pruneAndCountAI = () =>
      pruneFailuresInWindow(inputReadFailureTimestampsRef, INPUT_READ_RETRY_WINDOW_MS);

    // Limit timeout to 75% of the polling interval so a slow/failed read never
    // blocks longer than one cycle.  Floor at 100 ms, cap at 900 ms.
    const readTimeoutMs = Math.min(Math.max(Math.floor(pollingRateRef.current * 0.75), 100), 900);
    // Only retry when the polling interval is long enough that a second attempt
    // fits within the cycle.  At ≤ 400 ms the retry would always overflow.
    const canRetry = pollingRateRef.current >= 500;

    let aiSourceValues: number[] | null = null;
    if (pruneAndCountAI() >= INPUT_READ_MAX_FAILURES_PER_WINDOW) {
      firstError = new Error(
        `AI read retry rate exceeded (${INPUT_READ_MAX_FAILURES_PER_WINDOW}/${Math.round(INPUT_READ_RETRY_WINDOW_MS / 1000)}s). Skipping AI read until failure rate decreases.`,
      );
    } else {
      try {
        aiSourceValues = modbusPrecision === 'extended'
          ? await client.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER, AI_CHANNELS, readTimeoutMs)
          : await client.readInputRegisters(AI_START_REGISTER, AI_CHANNELS, readTimeoutMs);
      } catch (readError) {
        inputReadFailureTimestampsRef.current.push(Date.now());
        const normalizedReadError =
          readError instanceof Error ? readError : new Error(String(readError));
        if (canRetry && pruneAndCountAI() < INPUT_READ_MAX_FAILURES_PER_WINDOW) {
          console.warn('[App] AI read failed; retrying once', normalizedReadError);
          try {
            await waitMs(RETRY_DELAY_MS);
            aiSourceValues = modbusPrecision === 'extended'
              ? await client.readInputRegistersAsFloat32Abcd(AI_FLOAT_START_REGISTER, AI_CHANNELS, readTimeoutMs)
              : await client.readInputRegisters(AI_START_REGISTER, AI_CHANNELS, readTimeoutMs);
          } catch (retryReadError) {
            inputReadFailureTimestampsRef.current.push(Date.now());
            firstError = new Error(
              `Failed to read AI Input Registers after retry: ${(retryReadError instanceof Error ? retryReadError : new Error(String(retryReadError))).message}`,
            );
          }
        } else if (!canRetry) {
          console.warn('[App] AI read failed; skipping retry (polling interval too short)', normalizedReadError);
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

      const timestamp = Date.now();
      enqueueDisplayUpdate(aiRaw, aiPhysical, param);
      enqueueSaveUpdate(timestamp, aiRaw, aiPhysical, param);
    } else if (!firstError) {
      firstError = new Error('AI read failed');
    }

    void doAoWriteAsync();

    setStatus(firstError ? firstError.message : 'Polling');
  }, [
    modbusPrecision,
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
      await pollOnce();
    } finally {
      pollingInProgressRef.current = false;

      if (pollTimer.current === undefined) return;

      idealScheduleRef.current += pollingRate.valueMs;
      const now = Date.now();
      if (idealScheduleRef.current < now - pollingRate.valueMs) {
        idealScheduleRef.current = now;
      }
      const delay = Math.max(0, idealScheduleRef.current - now);

      pollTimer.current = window.setTimeout(() => {
        void runPollingLoop();
      }, delay);
    }
  }, [pollOnce, pollingRate.valueMs]);

  const scheduleImmediatePoll = useCallback(() => {
    if (pollTimer.current !== undefined) {
      window.clearTimeout(pollTimer.current);
    }
    idealScheduleRef.current = 0;
    pollTimer.current = window.setTimeout(() => {
      void runPollingLoop();
    }, 0);
  }, [runPollingLoop]);

  const startPolling = useCallback(() => {
    scheduleImmediatePoll();
  }, [scheduleImmediatePoll]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== undefined) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = undefined;
    }
    pollingInProgressRef.current = false;
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
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (!acquiringRef.current) return;
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
      setDisplayRevision((v) => v + 1);

      const client = new WebSerialModbusClient(
        slaveId,
        serialSettings,
        serial,
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
      clientRef.current = client;
      pendingClient = null;
      outputHoldingFailureTimestampsRef.current = [];
      inputReadFailureTimestampsRef.current = [];

      setConnected(true);
      acquiringRef.current = true;
      setAcquiring(true);
      setStatus(`Connected @ ${formatSerialSettings(serialSettings)}`);
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
    window.clearInterval(flushTimerRef.current);
    flushTimerRef.current = undefined;
    const writerToClose = tsvWriterRef.current;
    tsvWriterRef.current = null;
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
      aoWriteInProgressRef.current = false;
      inputReadFailureTimestampsRef.current = [];
      outputHoldingFailureTimestampsRef.current = [];
      lastAiReadCompletedAtRef.current = 0;
      displayUpdateChainRef.current = Promise.resolve();
      pendingDataPoints.current = [];
      recentTimestampsRef.current = [];
      setActualRateHz(0);
      await dataStorage.clearAllData();
      dataBufferRef.current = [];
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

  useEffect(() => {
    if (typeof serial.addEventListener !== 'function') return;
    const onSerialDisconnect = (event: Event) => {
      const disconnectedPort = (event as { port?: SerialPort }).port;
      const connectedPort = clientRef.current?.getPort();
      if (!connectedPort) return;
      if (disconnectedPort && disconnectedPort !== connectedPort) return;
      console.warn('[App] USB disconnect event received for active port');
      void handleDisconnect();
    };
    serial.addEventListener('disconnect', onSerialDisconnect as EventListener);
    return () => {
      serial.removeEventListener('disconnect', onSerialDisconnect as EventListener);
    };
  }, [handleDisconnect]);

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
    try {
      const writer = await createTsvWriter(AI_CHANNELS, AO_CHANNELS, undefined, 3, PARAM_CHANNELS);
      const startedAt = Date.now();

      pendingDataPoints.current = [];
      recentTimestampsRef.current = [];
      setActualRateHz(0);

      await dataStorage.clearAllData();
      dataBufferRef.current = [];
      // Restart the whole-capture downsampling from this save start.
      saveDecimationStrideRef.current = 1;
      saveRawCounterRef.current = 0;
      setDisplayRevision((v) => v + 1);

      tsvWriterRef.current = writer;
      flushTimerRef.current = window.setInterval(() => {
        tsvWriterRef.current?.flush().catch((err) => console.error('TSV flush error:', err));
      }, TSV_FLUSH_INTERVAL_MS);
      setActiveSaveFilename(writer.getFileName());
      setSaveStartedAt(startedAt);
      setSaveElapsedMs(0);
      setSavePointCount(0);
      setStatus('Saving data to file');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus((err as Error).message);
    }
  };

  const handleStopSave = async () => {
    const writerToClose = tsvWriterRef.current;
    if (!writerToClose) return;
    tsvWriterRef.current = null;
    window.clearInterval(flushTimerRef.current);
    flushTimerRef.current = undefined;
    setActiveSaveFilename('');
    setSaveStartedAt(null);
    setSaveElapsedMs(0);
    setSavePointCount(0);

    try {
      await writerToClose.close();
    } catch (err) {
      console.warn('Error closing TSV writer:', err);
    }

    pendingDataPoints.current = [];
    recentTimestampsRef.current = [];
    setActualRateHz(0);

    await dataStorage.clearAllData();
    dataBufferRef.current = [];
    setDisplayRevision((v) => v + 1);

    setStatus('Stopped saving');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-slate-200 text-slate-900 transition-colors dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 dark:text-slate-100">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="px-3 py-1">
          <header className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-0.5">
              <div>
                <h1 className="text-xl font-bold">
                  <a
                    href="https://github.com/KikuchiMakoto/modbus_simple_logger"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    ModbusSimpleLogger
                  </a>
                </h1>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {serialTransportLabel} - {formatSerialSettings(serialSettings)}
                </p>
              </div>
              <div role="status" aria-live="polite" className="text-left text-xs text-slate-600 dark:text-slate-400">
                <p className="font-semibold text-slate-700 dark:text-slate-300">
                  File: {activeSaveFilename || '-'}
                </p>
                <p className="tabular-nums">
                  Total: {formatElapsedTime(saveElapsedMs)} / Points: {savePointCount}
                </p>
                <p className="tabular-nums">
                  Sampling: {(1000 / pollingRate.valueMs).toFixed(1)} Hz / Actual: {actualRateHz.toFixed(1)} Hz
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                aria-label="Toggle dark mode"
                onClick={toggleTheme}
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
                className={`min-w-[7rem] ${connected ? 'button-secondary' : 'button-primary'}`}
                onClick={handleToggleConnection}
              >
                {connected ? 'Disconnect' : 'Connect'}
              </button>
              {!tsvWriterRef.current ? (
                <button type="button" className={connected ? 'button-primary' : 'button-secondary opacity-60 cursor-not-allowed'} onClick={connected ? handleStartSave : undefined} disabled={!connected}>
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
        <div className="mb-0.5 flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Analog Input (16)</h2>
          <div className="text-right leading-tight text-slate-500 dark:text-slate-400">
            <p className="text-[0.65rem]">
              <em>Phy</em> = <em>a</em>&middot;(<em>Raw</em>)<sup>2</sup> + <em>b</em>&middot;(<em>Raw</em>) + <em>c</em>
            </p>
            <p className="text-[0.6rem]">
              <em>a</em>, <em>b</em>, <em>c</em> : Input Calibration
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {aiChannels.map((ch) => {
            const mode = voltageConfig[ch.id];
            const display = rawToDisplayValue(ch.raw, mode);
            const aiRatio = Math.min(1, Math.abs(ch.raw) / 32767);
            const { bar: aiMeterColor, text: aiTextColor } = getLevelColor(aiRatio);
            const aiMeterHeight = Math.max(2, aiRatio * 100);
            const showVoltage = !isUnknownMode(mode);
            return (
            <div
              key={ch.id}
              translate="no"
              className="flex min-w-0 rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="min-w-0 flex-1 p-1">
                <div className="flex items-center gap-1 border-b border-slate-200 pb-px dark:border-slate-700">
                  <span className="whitespace-nowrap text-base font-semibold text-slate-700 dark:text-slate-200">
                    {formatAiChannelDisplayLabel(ch.id)}
                  </span>
                  <input
                    type="text"
                    value={aiFreeLabels[ch.id] ?? ''}
                    onChange={(e) => handleAiFreeLabelChange(ch.id, e.target.value)}
                    placeholder="Label"
                    className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  />
                </div>
                <div className="space-y-0 pt-px text-lg leading-none">
                  <div className="flex justify-between items-center leading-none">
                    <span className="text-slate-600 font-medium dark:text-slate-300 leading-none">Raw</span>
                    <span className={`text-2xl font-bold leading-none tabular-nums ${aiTextColor}`}>
                      {modbusPrecision === 'extended' ? Math.trunc(ch.raw) : ch.raw}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-px border-t border-slate-200 dark:border-slate-700 leading-none">
                    <span className="text-slate-600 font-medium dark:text-slate-300 leading-none">Phy</span>
                    <span className={`text-2xl font-bold leading-none tabular-nums ${aiTextColor}`}>
                      {ch.physical.toFixed(3)}
                    </span>
                  </div>
                  {showVoltage && (
                  <div className="flex justify-between items-center pt-px border-t border-slate-200 dark:border-slate-700 leading-none">
                    <span className="text-slate-600 font-medium dark:text-slate-300 leading-none">
                      {display.unit}
                    </span>
                    <span className="text-2xl font-bold leading-none tabular-nums text-sky-600 dark:text-sky-400">
                      {display.value.toFixed(3)}
                    </span>
                  </div>
                  )}
                </div>
              </div>
              <div className="flex w-2 items-end overflow-hidden rounded-r-lg">
                <div className={`w-full ${aiMeterColor}`} style={{ height: `${aiMeterHeight}%` }} />
              </div>
            </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="mb-0.5 flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Analog Output (8)</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {aoChannels.map((ch) => (
            <div
              key={ch.id}
              className="min-w-0 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="flex items-center gap-1 border-b border-slate-200 pb-px dark:border-slate-700">
                <span className="whitespace-nowrap text-base font-semibold text-slate-700 dark:text-slate-200">
                  {ch.label}
                </span>
                <input
                  type="text"
                  value={aoFreeLabels[ch.id] ?? ''}
                  onChange={(e) => handleAoFreeLabelChange(ch.id, e.target.value)}
                  placeholder="Label"
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                />
              </div>
              <div className="pt-px text-lg leading-none">
                <div className="flex items-center justify-between leading-none">
                  <span className="font-medium text-slate-600 dark:text-slate-300 leading-none">V</span>
                  <span className="text-2xl font-bold leading-none tabular-nums text-sky-600 dark:text-sky-400">
                    {(ch.physical / 1000).toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="mb-0.5 flex items-center justify-between">
          <h2 className="text-lg font-semibold leading-none">Parameter (16)</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {paramValues.map((value, idx) => (
            <div
              key={idx}
              className="min-w-0 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700/50 dark:bg-slate-900/60"
            >
              <div className="flex items-center gap-1 border-b border-slate-200 pb-px dark:border-slate-700">
                <span className="whitespace-nowrap text-base font-semibold text-slate-700 dark:text-slate-200">
                  {`CH ${idx.toString().padStart(2, '0')}`}
                </span>
                <input
                  type="text"
                  value={paramFreeLabels[idx] ?? ''}
                  onChange={(e) => handleParamFreeLabelChange(idx, e.target.value)}
                  placeholder="Label"
                  className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-1 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                />
              </div>
              <div className="pt-px text-lg leading-none">
                <div className="flex items-center justify-between leading-none">
                  <span className="font-medium text-slate-600 dark:text-slate-300 leading-none">Val</span>
                  <span className="text-2xl font-bold leading-none tabular-nums text-emerald-600 dark:text-emerald-400">
                    {value.toFixed(3)}
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
          dataPoints={dataBufferRef.current}
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

      <VoltageConfigPanel
        open={voltageConfigPanelOpen}
        onClose={() => setVoltageConfigPanelOpen(false)}
        voltageConfig={voltageConfig}
        onVoltageConfigChange={setVoltageConfig}
      />

      <AppInfoPanel
        open={appInfoPanelOpen}
        onClose={() => setAppInfoPanelOpen(false)}
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
    </div>
  );
}

export default App;
