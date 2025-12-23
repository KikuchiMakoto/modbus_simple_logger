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
import { ChartPanel } from './components/ChartPanel';

const POLLING_OPTIONS: PollingRateOption[] = [
  { label: '200 ms', valueMs: 200 },
  { label: '500 ms', valueMs: 500 },
  { label: '1 s', valueMs: 1000 },
  { label: '2 s', valueMs: 2000 },
  { label: '5 s', valueMs: 5000 },
  { label: '10 s', valueMs: 10000 },
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

function formatTimestamp(ts: number) {
  const date = new Date(ts);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  const fff = String(date.getMilliseconds()).padStart(3, '0');
  return `${yyyy}/${mm}/${dd} ${hh}:${min}:${ss}.${fff}`;
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

function App() {
  const [slaveId, setSlaveId] = useState(1);
  const [serialSettings, setSerialSettings] = useState<SerialSettings>(DEFAULT_SERIAL_SETTINGS);
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(POLLING_OPTIONS[0]);
  const [aiCalibration, setAiCalibration] = useState<AiCalibration[]>(loadAiCalibration(AI_CHANNELS));
  const [aiChannels, setAiChannels] = useState<AiChannel[]>(createAiChannels(aiCalibration));
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [logHandle, setLogHandle] = useState<FileSystemWritableFileStream | null>(null);
  const [chart1X, setChart1X] = useState('time');
  const [chart1Y, setChart1Y] = useState('raw_00');
  const [chart2X, setChart2X] = useState('time');
  const [chart2Y, setChart2Y] = useState('raw_01');
  const [chart3X, setChart3X] = useState('time');
  const [chart3Y, setChart3Y] = useState('raw_02');
  const [chart4X, setChart4X] = useState('time');
  const [chart4Y, setChart4Y] = useState('raw_03');
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
    saveAiCalibration(aiCalibration);
  }, [aiCalibration]);

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
      if (!logHandle) {
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

      if (!logHandle) {
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

  const appendLog = async (aiRaw: number[], aiPhysical: number[]) => {
    if (!logHandle) return;
    const timestamp = formatTimestamp(Date.now());
    const rawValues = aiRaw.map(v => v.toString());
    const phyValues = aiPhysical.map(v => v.toFixed(3));
    const row = [timestamp, ...rawValues, ...phyValues].join('\t') + '\n';
    await logHandle.write(row);
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

      if (logHandle) {
        await appendLog(aiRaw, aiPhysical);
      }

      setStatus('Polling');
    } catch (err) {
      console.error(err);
      setStatus((err as Error).message);
    }
  }, [aiCalibration, logHandle]);

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

      const client = new WebSerialModbusClient(slaveId, serialSettings);
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
    if (!('showSaveFilePicker' in window)) {
      setStatus('File System Access API not supported');
      return;
    }
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: `modbus-log-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`,
        types: [
          {
            description: 'TSV Files',
            accept: { 'text/tab-separated-values': ['.tsv'] },
          },
        ],
      });
      const stream = await fileHandle.createWritable();

      // Create header with timestamp, ai_raw_XX, ai_phy_XX format
      const rawHeaders = Array.from({ length: AI_CHANNELS }, (_, i) =>
        `ai_raw_${i.toString().padStart(2, '0')}`
      );
      const phyHeaders = Array.from({ length: AI_CHANNELS }, (_, i) =>
        `ai_phy_${i.toString().padStart(2, '0')}`
      );
      const header = ['timestamp', ...rawHeaders, ...phyHeaders].join('\t') + '\n';

      await stream.write(header);

      // Clear IndexedDB when starting new recording session
      await dataStorage.clearAllData();
      setDataPoints([]);

      setLogHandle(stream);
      setStatus('Saving data to file');
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const handleStopSave = async () => {
    if (logHandle) {
      await logHandle.close();
      setLogHandle(null);

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
        return 'text-emerald-300';
    }
  };

  return (
    <div className="min-h-screen">
      <div className="sticky top-0 z-10 bg-slate-950 border-b border-slate-800">
        <div className="p-4">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-emerald-400">ModbusRTU Web Serial Logger</h1>
              <p className="text-sm text-slate-400">
                AI 16ch - {formatSerialSettings(serialSettings)}
              </p>
            </div>
            <div className="flex gap-2">
              <button className="button-secondary" onClick={handleLoadCalibration}>
                Load Calibration
              </button>
              <button className="button-secondary" onClick={handleDownloadCalibration}>
                Download Calibration
              </button>
              {!logHandle ? (
                <button className="button-secondary" onClick={handleStartSave}>
                  Start Save
                </button>
              ) : (
                <button className="button-secondary" onClick={handleStopSave}>
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
            <label className="block text-sm text-slate-400">Slave ID</label>
            <input
              type="number"
              value={slaveId}
              onChange={(e) => setSlaveId(parseInt(e.target.value, 10))}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              min={1}
              max={247}
              disabled={connected}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400">Baud rate</label>
            <select
              value={serialSettings.baudRate}
              onChange={(e) =>
                setSerialSettings((prev) => ({ ...prev, baudRate: Number(e.target.value) }))
              }
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
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
            <label className="block text-sm text-slate-400">Data bits</label>
            <select
              value={serialSettings.dataBits}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  dataBits: Number(e.target.value) as SerialSettings['dataBits'],
                }))
              }
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
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
            <label className="block text-sm text-slate-400">Parity</label>
            <select
              value={serialSettings.parity}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  parity: e.target.value as SerialSettings['parity'],
                }))
              }
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
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
            <label className="block text-sm text-slate-400">Stop bits</label>
            <select
              value={serialSettings.stopBits}
              onChange={(e) =>
                setSerialSettings((prev) => ({
                  ...prev,
                  stopBits: Number(e.target.value) as SerialSettings['stopBits'],
                }))
              }
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
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
            <label className="block text-sm text-slate-400">Polling Rate</label>
            <select
              value={pollingRate.valueMs}
              onChange={(e) => {
                const next = POLLING_OPTIONS.find((p) => p.valueMs === Number(e.target.value));
                if (next) setPollingRate(next);
              }}
              className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-1.5"
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
              className={connected ? 'button-secondary' : 'button-primary'}
              onClick={handleToggleConnection}
            >
              {connected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          <div className="text-sm text-emerald-300 lg:col-span-2">Status: {status}</div>
        </section>

        <section className="card">
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">AI Channels (16)</h2>
          <span className="text-2xl font-semibold text-emerald-400">a·x² + b·x + c = y</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
          {aiChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className="rounded-lg bg-slate-900/60 border border-slate-700/50 p-2.5 space-y-1"
            >
              <div className="text-center font-semibold text-slate-200 pb-0.5 border-b border-slate-700 text-base">
                {ch.label}
              </div>
              <div className="space-y-1 text-base">
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">Raw(x)</span>
                  <span className={`font-bold tabular-nums text-xl ${getStatusColor(ch.status)}`}>
                    {ch.raw}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">Calib(a)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].a}
                    onChange={(e) => updateAiCalibration(idx, 'a', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">Calib(b)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].b}
                    onChange={(e) => updateAiCalibration(idx, 'b', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 font-medium">Calib(c)</span>
                  <input
                    type="number"
                    value={aiCalibration[idx].c}
                    onChange={(e) => updateAiCalibration(idx, 'c', Number(e.target.value))}
                    className="input-compact w-24"
                  />
                </div>
                <div className="flex justify-between items-center pt-0.5 border-t border-slate-700">
                  <span className="text-slate-300 font-medium">Phy(y)</span>
                  <span className="font-bold text-emerald-300 tabular-nums text-xl">
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
          onXAxisChange={setChart4X}
          onYAxisChange={setChart4Y}
        />
      </div>
      </div>
    </div>
  );
}

export default App;
