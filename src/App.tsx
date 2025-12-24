import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSerialModbusClient } from './modbus/webserialClient';
import {
  AiCalibration,
  AiChannel,
  PollingRateOption,
  DataPoint,
  SerialSettings,
} from './types';
import {
  aiToPhysical,
  loadAiCalibration,
  saveAiCalibration,
  getAiStatus,
} from './utils/calibration';
import { dataStorage, MAX_POINTS_IN_MEMORY, StoredDataPoint } from './utils/dataStorage';
import { TsvWriter, createTsvWriter } from './utils/tsvExport';
import { ChartPanel } from './components/ChartPanel';
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
const DEFAULT_SERIAL_SETTINGS: SerialSettings = {
  baudRate: 38400,
  dataBits: 8,
  stopBits: 1,
  parity: 'none',
};
const AI_START_REGISTER = 0x0000;
const AO_START_REGISTER = 0x0100;

const createAiChannels = (calibration: AiCalibration[]): AiChannel[] =>
  Array.from({ length: AI_CHANNELS }, (_, idx) => {
    const raw = 0;
    const physical = aiToPhysical(raw, calibration[idx]);
    return {
      id: idx,
      raw,
      physical,
      label: `CH ${idx.toString().padStart(2, '0')}`,
      status: getAiStatus(raw),
    };
  });

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
];

type ThemeMode = 'light' | 'dark';

type ChartAxisSelections = {
  chart1: { x: string; y: string };
  chart2: { x: string; y: string };
  chart3: { x: string; y: string };
  chart4: { x: string; y: string };
};

const THEME_COOKIE_KEY = 'theme_preference_v1';
const CHART_AXES_COOKIE_KEY = 'chart_axes_v1';

const DEFAULT_CHART_AXES: ChartAxisSelections = {
  chart1: { x: 'time', y: 'raw_00' },
  chart2: { x: 'time', y: 'raw_01' },
  chart3: { x: 'time', y: 'raw_02' },
  chart4: { x: 'time', y: 'raw_03' },
};

const getSystemTheme = (): ThemeMode => {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const loadChartAxes = (): ChartAxisSelections => {
  const saved = readJsonCookie<Partial<ChartAxisSelections>>(CHART_AXES_COOKIE_KEY) ?? {};
  return {
    chart1: { ...DEFAULT_CHART_AXES.chart1, ...saved.chart1 },
    chart2: { ...DEFAULT_CHART_AXES.chart2, ...saved.chart2 },
    chart3: { ...DEFAULT_CHART_AXES.chart3, ...saved.chart3 },
    chart4: { ...DEFAULT_CHART_AXES.chart4, ...saved.chart4 },
  };
};

function App() {
  const savedTheme = useMemo(() => readJsonCookie<ThemeMode>(THEME_COOKIE_KEY), []);
  const [hasUserThemePreference, setHasUserThemePreference] = useState(() => savedTheme !== null);
  const [theme, setTheme] = useState<ThemeMode>(() => savedTheme ?? getSystemTheme());
  const [slaveId, setSlaveId] = useState(1);
  const [serialSettings, setSerialSettings] = useState<SerialSettings>(DEFAULT_SERIAL_SETTINGS);
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(POLLING_OPTIONS[0]);
  const [aiCalibration, setAiCalibration] = useState<AiCalibration[]>(loadAiCalibration(AI_CHANNELS));
  const [aiChannels, setAiChannels] = useState<AiChannel[]>(createAiChannels(aiCalibration));
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [tsvWriter, setTsvWriter] = useState<TsvWriter | null>(null);
  const initialAxes = useMemo(() => loadChartAxes(), []);
  const [chart1X, setChart1X] = useState(initialAxes.chart1.x);
  const [chart1Y, setChart1Y] = useState(initialAxes.chart1.y);
  const [chart2X, setChart2X] = useState(initialAxes.chart2.x);
  const [chart2Y, setChart2Y] = useState(initialAxes.chart2.y);
  const [chart3X, setChart3X] = useState(initialAxes.chart3.x);
  const [chart3Y, setChart3Y] = useState(initialAxes.chart3.y);
  const [chart4X, setChart4X] = useState(initialAxes.chart4.x);
  const [chart4Y, setChart4Y] = useState(initialAxes.chart4.y);
  const clientRef = useRef<WebSerialModbusClient | null>(null);
  const pollTimer = useRef<number>();

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
    writeJsonCookie(CHART_AXES_COOKIE_KEY, {
      chart1: { x: chart1X, y: chart1Y },
      chart2: { x: chart2X, y: chart2Y },
      chart3: { x: chart3X, y: chart3Y },
      chart4: { x: chart4X, y: chart4Y },
    });
  }, [chart1X, chart1Y, chart2X, chart2Y, chart3X, chart3Y, chart4X, chart4Y]);

  const updateDataHistory = async (aiRaw: number[], aiPhysical: number[]) => {
    const timestamp = Date.now();
    const dataPoint: StoredDataPoint = {
      timestamp,
      aiRaw,
      aiPhysical,
    };

    try {
      // Save to IndexedDB
      await dataStorage.addDataPoint(dataPoint);

      // If not saving to file, keep only latest 512 points in IndexedDB
      if (!tsvWriter) {
        await dataStorage.keepLatestPoints(MAX_POINTS_IN_MEMORY);
      }

      // Update chart data from IndexedDB
      await updateChartData();
    } catch (err) {
      console.error('Error updating data history:', err);
      setStatus(`IndexedDB error: ${(err as Error).message}`);
      // Don't throw - allow polling to continue
    }
  };

  const updateChartData = async () => {
    try {
      const allPoints = await dataStorage.getAllDataPoints();

      let displayPoints: DataPoint[];

      if (!tsvWriter) {
        // Data save is OFF: display all points (should be max 512)
        displayPoints = allPoints.map(p => ({
          timestamp: p.timestamp,
          aiRaw: p.aiRaw,
          aiPhysical: p.aiPhysical,
        }));
      } else {
        // Data save is ON: decimate to max 512 points
        if (allPoints.length <= MAX_POINTS_IN_MEMORY) {
          displayPoints = allPoints.map(p => ({
            timestamp: p.timestamp,
            aiRaw: p.aiRaw,
            aiPhysical: p.aiPhysical,
          }));
        } else {
          // Decimate by integer stride
          const stride = Math.ceil(allPoints.length / MAX_POINTS_IN_MEMORY);
          displayPoints = allPoints
            .filter((_, idx) => idx % stride === 0)
            .map(p => ({
              timestamp: p.timestamp,
              aiRaw: p.aiRaw,
              aiPhysical: p.aiPhysical,
            }));
        }
      }

      setDataPoints(displayPoints);
    } catch (err) {
      console.error('Error updating chart data:', err);
      setStatus(`Chart update error: ${(err as Error).message}`);
    }
  };

  const pollOnce = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      const aiRaw = await clientRef.current.readInputRegisters(AI_START_REGISTER, AI_CHANNELS);
      const aiPhysical = aiRaw.map((value, idx) =>
        aiToPhysical(value, aiCalibration[idx] ?? { a: 0, b: 1, c: 0 })
      );

      setAiChannels((prev) =>
        prev.map((ch, idx) => ({
          ...ch,
          raw: aiRaw[idx] ?? ch.raw,
          physical: aiPhysical[idx] ?? ch.physical,
          status: getAiStatus(aiRaw[idx] ?? ch.raw),
        })),
      );

      // Wait for data history update to complete
      await updateDataHistory(aiRaw, aiPhysical);

      // Write to TSV file if recording is active
      if (tsvWriter) {
        await tsvWriter.writeRow(Date.now(), aiRaw, aiPhysical);
      }

      setStatus('Polling');
    } catch (err) {
      console.error(err);
      setStatus((err as Error).message);
    }
  }, [aiCalibration, tsvWriter]);

  const startPolling = useCallback(() => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = window.setInterval(pollOnce, pollingRate.valueMs);
  }, [pollOnce, pollingRate.valueMs]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = undefined;
  }, []);

  useEffect(() => {
    if (acquiring) {
      startPolling();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [acquiring, startPolling, stopPolling]);

  const handleConnect = async () => {
    try {
      // Clean up any existing connection first
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }

      // Clear IndexedDB for new session
      await dataStorage.clearAllData();
      setDataPoints([]);

      // Use WebSerialModbusClient with the selected Serial API (native or polyfill)
      // On Android and unsupported platforms, this will use web-serial-polyfill with WebUSB
      const client = new WebSerialModbusClient(slaveId, serialSettings, serial);
      await client.connect();
      clientRef.current = client;

      setConnected(true);
      setAcquiring(true);
      setStatus(`Connected @ ${formatSerialSettings(serialSettings)}`);
    } catch (err) {
      // Clean up on error
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
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
    setAcquiring(false);
    stopPolling();
    try {
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }
      // Clear IndexedDB on disconnect
      await dataStorage.clearAllData();
      setDataPoints([]);
    } catch (err) {
      console.error('Error during disconnect:', err);
    } finally {
      setConnected(false);
      setStatus('Disconnected');
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
          const physical = aiToPhysical(ch.raw, next[idx]);
          return { ...ch, physical, status: getAiStatus(ch.raw) };
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

  const handleLoadCalibration = async () => {
    if (!('showOpenFilePicker' in window)) {
      setStatus('File System Access API not supported in this browser');
      return;
    }
    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [
          {
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const file = await fileHandle.getFile();
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
          const physical = aiToPhysical(ch.raw, loadedCalibration[idx]);
          return { ...ch, physical, status: getAiStatus(ch.raw) };
        }),
      );
      setStatus('Calibration loaded successfully');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setStatus((err as Error).message);
    }
  };

  const handleStartSave = async () => {
    try {
      // Create TSV writer (this will prompt user for file location)
      const writer = await createTsvWriter(AI_CHANNELS);

      // Clear IndexedDB when starting new recording session
      await dataStorage.clearAllData();
      setDataPoints([]);

      setTsvWriter(writer);
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
      await tsvWriter.close();
      setTsvWriter(null);

      // When stopping save, keep only latest 512 points in IndexedDB
      await dataStorage.keepLatestPoints(MAX_POINTS_IN_MEMORY);
      await updateChartData();

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
        <div className="p-4">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">ModbusSimpleLogger</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {isUsingPolyfill ? 'WebUSB' : 'WebSerial'} - {formatSerialSettings(serialSettings)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={isDarkMode}
                aria-label="Toggle dark mode"
                onClick={handleToggleTheme}
                className="relative inline-flex h-10 w-20 items-center rounded-full border border-slate-300 bg-white px-2 shadow-inner transition-colors duration-300 hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-800"
              >
                <span className="sr-only">Toggle theme</span>
                <span className="absolute left-3 text-slate-500 dark:text-slate-300" aria-hidden>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 50 50"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path d="M24.906 3.969c-.043.008-.086.02-.125.031-.465.106-.793.523-.782 1V11a1.002 1.002 0 0 0 1.996 0V5c.012-.289-.105-.566-.312-.761a1 1 0 0 0-.777-.27ZM10.656 9.844c-.375.066-.676.34-.781.703-.105.367.004.758.281 1.015l4.25 4.25a1.002 1.002 0 0 0 1.703-.77 1 1 0 0 0-.349-.746l-4.25-4.25c-.207-.222-.508-.336-.813-.312-.031 0-.062 0-.094.01ZM39.031 9.844a.995.995 0 0 0-.594.312l-4.25 4.25a1.002 1.002 0 1 0 1.406 1.406l4.25-4.25c.312-.297.402-.762.218-1.152-.187-.394-.6-.62-1.03-.566ZM24.906 15c-.031.008-.062.02-.094.031-.062.004-.125.016-.188.031l-.03.031C19.29 15.32 15 19.64 15 25c0 5.504 4.496 10 10 10s10-4.497 10-10c0-5.34-4.254-9.645-9.531-9.907-.035 0-.058-.031-.094-.031a2.96 2.96 0 0 0-.312-.062H25c-.031 0-.062 0-.094.01Zm.031 2c.02 0 .043 0 .063 0 .031 0 .062 0 .094 0C29.469 17.05 33 20.613 33 25c0 4.422-3.578 8-8 8-4.418 0-8-3.578-8-8 0-4.398 3.547-7.965 7.938-8ZM4.719 24c-.551.078-.938.59-.86 1.14.078.552.59.938 1.141.86H11a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 11 24H5c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.093 0Zm34 .001c-.551.078-.938.59-.86 1.14.078.552.59.939 1.141.86H45a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 45 24.001h-6c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.094 0ZM15 33.875a1 1 0 0 0-.594.312l-4.25 4.25a.996.996 0 0 0 .348 1.594c.375.086.762-.051 1.004-.348l4.25-4.25a1.003 1.003 0 0 0-.77-1.633c-.031 0-.062 0-.094-.005Zm19.688 0a.995.995 0 0 0-.907.703c-.105.367.004.758.282 1.015l4.25 4.25c.242.297.629.434 1.004.348.371-.086.664-.379.75-.75.086-.375-.051-.762-.348-1.004l-4.25-4.25a.989.989 0 0 0-.718-.312c-.031 0-.062 0-.094.01ZM24.906 37.969c-.043.007-.086.019-.125.03-.465.106-.793.523-.782 1V45a1.002 1.002 0 0 0 1.996 0v-6c.012-.289-.105-.566-.312-.762a1 1 0 0 0-.777-.27Z" />
                  </svg>
                </span>
                <span className="absolute right-3 text-slate-500 dark:text-slate-300" aria-hidden>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                    <path d="M18.92 15.42A7 7 0 0 1 11.2 4.59a1 1 0 0 0-1.18-1.18A9 9 0 1 0 19.1 16.6a1 1 0 0 0-.18-1.18Z" />
                  </svg>
                </span>
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-emerald-950 shadow transition-transform duration-300 ${isDarkMode ? 'translate-x-8' : 'translate-x-0'}`}
                  aria-hidden
                >
                  {isDarkMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                      <path d="M21.64 13a1 1 0 0 0-1.05-.14A8 8 0 0 1 11.1 4.41 1 1 0 0 0 9.76 3a10 10 0 1 0 12.3 10Z" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 50 50"
                      fill="currentColor"
                      className="h-5 w-5"
                    >
                      <path d="M24.906 3.969c-.043.008-.086.02-.125.031-.465.106-.793.523-.782 1V11a1.002 1.002 0 0 0 1.996 0V5c.012-.289-.105-.566-.312-.761a1 1 0 0 0-.777-.27ZM10.656 9.844c-.375.066-.676.34-.781.703-.105.367.004.758.281 1.015l4.25 4.25a1.002 1.002 0 0 0 1.703-.77 1 1 0 0 0-.349-.746l-4.25-4.25c-.207-.222-.508-.336-.813-.312-.031 0-.062 0-.094.01ZM39.031 9.844a.995.995 0 0 0-.594.312l-4.25 4.25a1.002 1.002 0 1 0 1.406 1.406l4.25-4.25c.312-.297.402-.762.218-1.152-.187-.394-.6-.62-1.03-.566ZM24.906 15c-.031.008-.062.02-.094.031-.062.004-.125.016-.188.031l-.03.031C19.29 15.32 15 19.64 15 25c0 5.504 4.496 10 10 10s10-4.497 10-10c0-5.34-4.254-9.645-9.531-9.907-.035 0-.058-.031-.094-.031a2.96 2.96 0 0 0-.312-.062H25c-.031 0-.062 0-.094.01Zm.031 2c.02 0 .043 0 .063 0 .031 0 .062 0 .094 0C29.469 17.05 33 20.613 33 25c0 4.422-3.578 8-8 8-4.418 0-8-3.578-8-8 0-4.398 3.547-7.965 7.938-8ZM4.719 24c-.551.078-.938.59-.86 1.14.078.552.59.938 1.141.86H11a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 11 24H5c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.093 0Zm34 .001c-.551.078-.938.59-.86 1.14.078.552.59.939 1.141.86H45a1.003 1.003 0 0 0 .879-1.504A1.004 1.004 0 0 0 45 24.001h-6c-.031 0-.062 0-.094 0s-.062 0-.094 0-.062 0-.094 0ZM15 33.875a1 1 0 0 0-.594.312l-4.25 4.25a.996.996 0 0 0 .348 1.594c.375.086.762-.051 1.004-.348l4.25-4.25a1.003 1.003 0 0 0-.77-1.633c-.031 0-.062 0-.094-.005Zm19.688 0a.995.995 0 0 0-.907.703c-.105.367.004.758.282 1.015l4.25 4.25c.242.297.629.434 1.004.348.371-.086.664-.379.75-.75.086-.375-.051-.762-.348-1.004l-4.25-4.25a.989.989 0 0 0-.718-.312c-.031 0-.062 0-.094.01ZM24.906 37.969c-.043.007-.086.019-.125.03-.465.106-.793.523-.782 1V45a1.002 1.002 0 0 0 1.996 0v-6c.012-.289-.105-.566-.312-.762a1 1 0 0 0-.777-.27Z" />
                    </svg>
                  )}
                </span>
              </button>
              <button type="button" className="button-secondary" onClick={handleLoadCalibration}>
                Load Calib
              </button>
              <button type="button" className="button-secondary" onClick={handleDownloadCalibration}>
                Save Calib
              </button>
              {!tsvWriter ? (
                <button type="button" className="button-primary" onClick={handleStartSave}>
                  Start Save
                </button>
              ) : (
                <button type="button" className="button-primary" onClick={handleStopSave}>
                  Stop Save
                </button>
              )}
            </div>
          </header>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <section className="card grid gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Slave ID</label>
            <input
              type="number"
              value={slaveId}
              onChange={(e) => setSlaveId(parseInt(e.target.value, 10))}
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              min={1}
              max={247}
              disabled={connected}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Baud rate</label>
            <select
              value={serialSettings.baudRate}
              onChange={(e) =>
                setSerialSettings((prev) => ({ ...prev, baudRate: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={connected}
            >
              {BAUD_OPTIONS.map((baud) => (
                <option key={baud} value={baud}>
                  {baud} bps
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Data bits</label>
            <select
              value={serialSettings.dataBits}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  dataBits: Number(e.target.value) as SerialSettings['dataBits'],
                }))
              }
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={connected}
            >
              {DATA_BITS_OPTIONS.map((bits) => (
                <option key={bits} value={bits}>
                  {bits}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Parity</label>
            <select
              value={serialSettings.parity}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  parity: e.target.value as SerialSettings['parity'],
                }))
              }
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={connected}
            >
              {PARITY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === 'none' ? 'None' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Stop bits</label>
            <select
              value={serialSettings.stopBits}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  stopBits: Number(e.target.value) as SerialSettings['stopBits'],
                }))
              }
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              disabled={connected}
            >
              {STOP_BITS_OPTIONS.map((bits) => (
                <option key={bits} value={bits}>
                  {bits}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-600 dark:text-slate-400">Polling Rate</label>
            <select
              value={pollingRate.valueMs}
              onChange={(e) => {
                const next = POLLING_OPTIONS.find((p) => p.valueMs === Number(e.target.value));
                if (next) setPollingRate(next);
              }}
              className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {POLLING_OPTIONS.map((opt) => (
                <option key={opt.valueMs} value={opt.valueMs}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={connected ? 'button-secondary' : 'button-primary'}
              onClick={handleToggleConnection}
            >
              {connected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </section>

        <section className="card">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">AI Channels (16)</h2>
          <span className="text-2xl font-semibold text-emerald-400">a·x² + b·x + c = y</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {aiChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className="rounded-lg bg-slate-100 border border-slate-200 p-2.5 space-y-1 dark:bg-slate-900/60 dark:border-slate-700/50"
            >
              <div className="text-center font-semibold text-slate-700 pb-0.5 border-b border-slate-200 text-base dark:text-slate-200 dark:border-slate-700">
                {ch.label}
              </div>
              <div className="space-y-1 text-base">
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Raw(x)</span>
                  <span className={`font-bold tabular-nums text-xl ${getStatusColor(ch.status)}`}>
                    {ch.raw}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Calib(a)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].a}
                    onChange={(e) => updateAiCalibration(idx, 'a', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Calib(b)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].b}
                    onChange={(e) => updateAiCalibration(idx, 'b', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Calib(c)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].c}
                    onChange={(e) => updateAiCalibration(idx, 'c', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center pt-0.5 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-slate-600 font-medium dark:text-slate-300">Phy(y)</span>
                  <span className="font-bold tabular-nums text-xl text-emerald-600 dark:text-emerald-400">
                    {ch.physical.toFixed(3)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <ChartPanel
          title="Chart 1"
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
          title="Chart 2"
          color="#60a5fa"
          dataPoints={dataPoints}
          axisOptions={axisOptions}
          xAxis={chart2X}
          yAxis={chart2Y}
          isDarkMode={theme === 'dark'}
          onXAxisChange={setChart2X}
          onYAxisChange={setChart2Y}
        />
        <ChartPanel
          title="Chart 3"
          color="#f59e0b"
          dataPoints={dataPoints}
          axisOptions={axisOptions}
          xAxis={chart3X}
          yAxis={chart3Y}
          isDarkMode={theme === 'dark'}
          onXAxisChange={setChart3X}
          onYAxisChange={setChart3Y}
        />
        <ChartPanel
          title="Chart 4"
          color="#ec4899"
          dataPoints={dataPoints}
          axisOptions={axisOptions}
          xAxis={chart4X}
          yAxis={chart4Y}
          isDarkMode={theme === 'dark'}
          onXAxisChange={setChart4X}
          onYAxisChange={setChart4Y}
        />
      </div>
      </div>
    </div>
  );
}

export default App;
