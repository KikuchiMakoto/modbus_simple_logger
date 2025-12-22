import { useEffect, useMemo, useRef, useState } from 'react';
import Plot from 'react-plotly.js';
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
const BAUD_OPTIONS = [9600, 19200, 38400, 57600, 115200];
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
      label: `AI${idx}`,
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
  return new Date(ts).toISOString();
}

function formatSerialSettings(settings: SerialSettings) {
  const parityLetter = settings.parity === 'none' ? 'N' : settings.parity === 'even' ? 'E' : 'O';
  return `${settings.baudRate}bps ${settings.dataBits}${parityLetter}${settings.stopBits}`;
}

const axisOptions = [
  { key: 'time', label: 'Timestamp (ms)' },
  ...Array.from({ length: AI_CHANNELS }, (_, idx) => ({ key: `ai${idx}`, label: `AI${idx}` })),
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
  const [chart1Y, setChart1Y] = useState('ai0');
  const [chart2X, setChart2X] = useState('time');
  const [chart2Y, setChart2Y] = useState('ai1');
  const clientRef = useRef<WebSerialModbusClient | null>(null);
  const pollTimer = useRef<number>();

  useEffect(() => {
    saveAiCalibration(aiCalibration);
  }, [aiCalibration]);

  const resolveAxisValue = (point: DataPoint, key: string) => {
    if (key === 'time') return point.timestamp;
    if (key.startsWith('ai')) {
      const idx = Number(key.replace('ai', ''));
      return point.ai[idx];
    }
    return 0;
  };

  const plotData1 = useMemo(() => {
    const xData = dataPoints.map((p) => resolveAxisValue(p, chart1X));
    const yData = dataPoints.map((p) => resolveAxisValue(p, chart1Y));

    return [
      {
        x: xData,
        y: yData,
        type: 'scattergl' as const,
        mode: 'lines+markers' as const,
        marker: { color: '#34d399', size: 3 },
        line: { color: '#34d399', width: 2 },
        name: `${chart1Y} vs ${chart1X}`,
      },
    ];
  }, [chart1X, chart1Y, dataPoints]);

  const plotLayout1 = useMemo(
    () => ({
      autosize: true,
      paper_bgcolor: '#0f172a',
      plot_bgcolor: '#1e293b',
      font: { color: '#cbd5e1' },
      xaxis: {
        title: chart1X,
        gridcolor: '#334155',
        type: chart1X === 'time' ? ('date' as const) : ('linear' as const),
      },
      yaxis: {
        title: chart1Y,
        gridcolor: '#334155',
      },
      margin: { t: 40, r: 40, b: 60, l: 60 },
    }),
    [chart1X, chart1Y],
  );

  const plotData2 = useMemo(() => {
    const xData = dataPoints.map((p) => resolveAxisValue(p, chart2X));
    const yData = dataPoints.map((p) => resolveAxisValue(p, chart2Y));

    return [
      {
        x: xData,
        y: yData,
        type: 'scattergl' as const,
        mode: 'lines+markers' as const,
        marker: { color: '#60a5fa', size: 3 },
        line: { color: '#60a5fa', width: 2 },
        name: `${chart2Y} vs ${chart2X}`,
      },
    ];
  }, [chart2X, chart2Y, dataPoints]);

  const plotLayout2 = useMemo(
    () => ({
      autosize: true,
      paper_bgcolor: '#0f172a',
      plot_bgcolor: '#1e293b',
      font: { color: '#cbd5e1' },
      xaxis: {
        title: chart2X,
        gridcolor: '#334155',
        type: chart2X === 'time' ? ('date' as const) : ('linear' as const),
      },
      yaxis: {
        title: chart2Y,
        gridcolor: '#334155',
      },
      margin: { t: 40, r: 40, b: 60, l: 60 },
    }),
    [chart2X, chart2Y],
  );

  const plotConfig = useMemo(
    () => ({
      displayModeBar: true,
      responsive: true,
      displaylogo: false,
    }),
    [],
  );

  const updateDataHistory = (ai: number[]) => {
    const timestamp = Date.now();
    setDataPoints((prev) => {
      const next = [...prev, { timestamp, ai }];
      if (acquiring) {
        if (next.length > 1024) {
          const stride = Math.ceil(next.length / 1024);
          return next.filter((_, idx) => idx % stride === 0);
        }
        return next;
      }
      const cutoff = timestamp - 60000;
      return next.filter((p) => p.timestamp >= cutoff);
    });
  };

  const appendLog = async (ai: number[]) => {
    if (!logHandle) return;
    const row = [formatTimestamp(Date.now()), ...ai].join('\t') + '\n';
    await logHandle.write(row);
  };

  const pollOnce = async () => {
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

      updateDataHistory(aiPhysical);
      appendLog(aiPhysical);

      setStatus('Polling');
    } catch (err) {
      console.error(err);
      setStatus((err as Error).message);
    }
  };

  const startPolling = () => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = window.setInterval(pollOnce, pollingRate.valueMs);
  };

  const stopPolling = () => {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    pollTimer.current = undefined;
  };

  useEffect(() => {
    if (acquiring) {
      startPolling();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [acquiring, pollingRate]);

  const handleConnect = async () => {
    try {
      // Clean up any existing connection first
      if (clientRef.current) {
        await clientRef.current.disconnect();
        clientRef.current = null;
      }

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
    } catch (err) {
      console.error('Error during disconnect:', err);
    } finally {
      setConnected(false);
      setStatus('Disconnected');
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
      const [fileHandle] = await (window as any).showOpenFilePicker({
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
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: `modbus-log-${new Date().toISOString().replace(/[:.]/g, '-')}.tsv`,
        types: [
          {
            description: 'TSV Files',
            accept: { 'text/tab-separated-values': ['.tsv'] },
          },
        ],
      });
      const stream = await fileHandle.createWritable();
      await stream.write(
        'timestamp\t' +
          Array.from({ length: AI_CHANNELS }, (_, i) => `ai${i}`).join('\t') +
          '\n',
      );
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
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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

      <section className="card grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="block text-sm text-slate-400">Slave ID</label>
          <input
            type="number"
            value={slaveId}
            onChange={(e) => setSlaveId(parseInt(e.target.value, 10))}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60"
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
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2"
          >
            {POLLING_OPTIONS.map((opt) => (
              <option key={opt.valueMs} value={opt.valueMs}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button className="button-primary" onClick={handleConnect} disabled={connected}>
            Connect
          </button>
          <button className="button-secondary" onClick={handleDisconnect} disabled={!connected}>
            Disconnect
          </button>
        </div>
        <div className="text-sm text-emerald-300 lg:col-span-2">Status: {status}</div>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold">AI Channels (16)</h2>
          <span className="text-xs text-slate-500">Raw | a·x² + b·x + c = Physical</span>
        </div>
        <div className="grid gap-1 text-base">
          <div className="grid grid-cols-6 gap-2 text-sm text-slate-500">
            <span>Name</span>
            <span>Raw (x)</span>
            <span>a</span>
            <span>b</span>
            <span>c</span>
            <span>Physical</span>
          </div>
          {aiChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className="grid grid-cols-6 items-center gap-2 rounded-md bg-slate-900/60 px-2 py-2"
            >
              <span className="text-slate-200">{ch.label}</span>
              <span className={`font-semibold tabular-nums text-right ${getStatusColor(ch.status)}`}>
                {ch.raw}
              </span>
              <input
                type="number"
                step="0.001"
                value={aiCalibration[idx].a}
                onChange={(e) => updateAiCalibration(idx, 'a', Number(e.target.value))}
                className="input-compact"
              />
              <input
                type="number"
                step="0.001"
                value={aiCalibration[idx].b}
                onChange={(e) => updateAiCalibration(idx, 'b', Number(e.target.value))}
                className="input-compact"
              />
              <input
                type="number"
                step="0.001"
                value={aiCalibration[idx].c}
                onChange={(e) => updateAiCalibration(idx, 'c', Number(e.target.value))}
                className="input-compact"
              />
              <span className="font-semibold text-emerald-300 tabular-nums text-right">
                {ch.physical.toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold text-emerald-400">Chart 1</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs text-slate-400">X Axis</label>
              <select
                value={chart1X}
                onChange={(e) => setChart1X(e.target.value)}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
              >
                {axisOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Y Axis</label>
              <select
                value={chart1Y}
                onChange={(e) => setChart1Y(e.target.value)}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
              >
                {axisOptions
                  .filter((opt) => opt.key !== 'time')
                  .map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <Plot data={plotData1} layout={plotLayout1} config={plotConfig} style={{ width: '100%', height: '400px' }} />
        </section>

        <section className="card space-y-3">
          <h2 className="text-lg font-semibold text-blue-400">Chart 2</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs text-slate-400">X Axis</label>
              <select
                value={chart2X}
                onChange={(e) => setChart2X(e.target.value)}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
              >
                {axisOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Y Axis</label>
              <select
                value={chart2Y}
                onChange={(e) => setChart2Y(e.target.value)}
                className="rounded border border-slate-700 bg-slate-800 px-3 py-2"
              >
                {axisOptions
                  .filter((opt) => opt.key !== 'time')
                  .map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <Plot data={plotData2} layout={plotLayout2} config={plotConfig} style={{ width: '100%', height: '400px' }} />
        </section>
      </div>
    </div>
  );
}

export default App;
