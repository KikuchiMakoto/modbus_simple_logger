import { useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { WebSerialModbusClient } from './modbus/webserialClient';
import {
  AiCalibration,
  AoCalibration,
  AiChannel,
  AoChannel,
  PollingRateOption,
  DataPoint,
  SerialSettings,
} from './types';
import {
  aiToPhysical,
  aoToPhysical,
  loadAiCalibration,
  loadAoCalibration,
  saveAiCalibration,
  saveAoCalibration,
} from './utils/calibration';

ChartJS.register(LineElement, PointElement, LinearScale, TimeScale, Tooltip, Legend);

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
const AO_CHANNELS = 8;
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

const createAiState = (calibration: AiCalibration[]): AiChannel[] =>
  Array.from({ length: AI_CHANNELS }, (_, idx) => ({
    id: idx,
    raw: 0,
    phy: 0,
    label: `AI${idx + 1}`,
  })).map((ch, idx) => ({ ...ch, phy: aiToPhysical(ch.raw, calibration[idx]) }));

const createAoState = (calibration: AoCalibration[]): AoChannel[] =>
  Array.from({ length: AO_CHANNELS }, (_, idx) => ({
    id: idx,
    raw: 0,
    phy: 0,
    label: `AO${idx + 1}`,
  })).map((ch, idx) => ({ ...ch, phy: aoToPhysical(ch.raw, calibration[idx]) }));

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
  ...Array.from({ length: AI_CHANNELS }, (_, idx) => ({ key: `ai${idx}`, label: `AI${idx + 1}` })),
  ...Array.from({ length: AO_CHANNELS }, (_, idx) => ({ key: `ao${idx}`, label: `AO${idx + 1}` })),
];

function App() {
  const [slaveId, setSlaveId] = useState(1);
  const [serialSettings, setSerialSettings] = useState<SerialSettings>(DEFAULT_SERIAL_SETTINGS);
  const [pollingRate, setPollingRate] = useState<PollingRateOption>(POLLING_OPTIONS[0]);
  const [aiCalibration, setAiCalibration] = useState<AiCalibration[]>(loadAiCalibration(AI_CHANNELS));
  const [aoCalibration, setAoCalibration] = useState<AoCalibration[]>(loadAoCalibration(AO_CHANNELS));
  const [aiChannels, setAiChannels] = useState<AiChannel[]>(createAiState(aiCalibration));
  const [aoChannels, setAoChannels] = useState<AoChannel[]>(createAoState(aoCalibration));
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [status, setStatus] = useState('Disconnected');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [logHandle, setLogHandle] = useState<FileSystemWritableFileStream | null>(null);
  const [chartX, setChartX] = useState('time');
  const [chartY, setChartY] = useState('ai0');
  const clientRef = useRef<WebSerialModbusClient | null>(null);
  const pollTimer = useRef<number>();

  useEffect(() => {
    saveAiCalibration(aiCalibration);
  }, [aiCalibration]);

  useEffect(() => {
    saveAoCalibration(aoCalibration);
  }, [aoCalibration]);

  const resolveAxisValue = (point: DataPoint, key: string) => {
    if (key === 'time') return point.timestamp;
    if (key.startsWith('ai')) {
      const idx = Number(key.replace('ai', ''));
      return point.ai[idx];
    }
    if (key.startsWith('ao')) {
      const idx = Number(key.replace('ao', ''));
      return point.ao[idx];
    }
    return 0;
  };

  const chartData = useMemo(() => {
    const points = dataPoints.map((p) => ({
      x: resolveAxisValue(p, chartX),
      y: resolveAxisValue(p, chartY),
    }));
    return {
      datasets: [
        {
          label: `${chartY} vs ${chartX}`,
          data: points,
          borderColor: '#34d399',
          backgroundColor: 'rgba(52, 211, 153, 0.3)',
          pointRadius: 2,
        },
      ],
    };
  }, [chartX, chartY, dataPoints]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: {
          type: chartX === 'time' ? 'time' : 'linear',
          title: { display: true, text: chartX },
        },
        y: {
          type: 'linear',
          title: { display: true, text: chartY },
        },
      },
    }),
    [chartX, chartY],
  );

  const updateDataHistory = (ai: number[], ao: number[]) => {
    const timestamp = Date.now();
    setDataPoints((prev) => {
      const next = [...prev, { timestamp, ai, ao }];
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

  const appendLog = async (ai: number[], ao: number[]) => {
    if (!logHandle) return;
    const row = [formatTimestamp(Date.now()), ...ai, ...ao].join(',') + '\n';
    await logHandle.write(row);
  };

  const pollOnce = async () => {
    if (!clientRef.current) return;
    try {
      const aiRaw = await clientRef.current.readInputRegisters(AI_START_REGISTER, AI_CHANNELS);
      const aiPhy = aiRaw.map((value, idx) => aiToPhysical(value, aiCalibration[idx]));
      setAiChannels((prev) => prev.map((ch, idx) => ({ ...ch, raw: aiRaw[idx], phy: aiPhy[idx] })));

      const aoRaw = aoChannels.map((ch) => ch.raw);
      const aoPhy = aoRaw.map((value, idx) => aoToPhysical(value, aoCalibration[idx]));
      setAoChannels((prev) => prev.map((ch, idx) => ({ ...ch, phy: aoPhy[idx] })));
      updateDataHistory(aiPhy, aoPhy);
      await appendLog(aiPhy, aoPhy);
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
      const client = new WebSerialModbusClient(slaveId, serialSettings);
      await client.connect();
      clientRef.current = client;
      setConnected(true);
      setStatus(`Connected @ ${formatSerialSettings(serialSettings)}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        setStatus('デバイス選択をキャンセルしました');
        return;
      }
      setStatus((err as Error).message);
    }
  };

  const handleDisconnect = async () => {
    stopPolling();
    if (clientRef.current) await clientRef.current.disconnect();
    setConnected(false);
    setAcquiring(false);
    setStatus('Disconnected');
  };

  const updateAiCalibration = (idx: number, key: keyof AiCalibration, value: number) => {
    setAiCalibration((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      setAiChannels((chs) =>
        chs.map((ch, cIdx) =>
          cIdx === idx ? { ...ch, phy: aiToPhysical(ch.raw, next[idx]) } : ch,
        ),
      );
      return next;
    });
  };

  const updateAoCalibration = (idx: number, key: keyof AoCalibration, value: number) => {
    setAoCalibration((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      setAoChannels((chs) =>
        chs.map((ch, cIdx) =>
          cIdx === idx ? { ...ch, phy: aoToPhysical(ch.raw, next[idx]) } : ch,
        ),
      );
      return next;
    });
  };

  const handleAoRawChange = (idx: number, value: number) => {
    setAoChannels((prev) => {
      const next = prev.map((ch, cIdx) =>
        cIdx === idx ? { ...ch, raw: value, phy: aoToPhysical(value, aoCalibration[idx]) } : ch,
      );
      return next;
    });
    if (clientRef.current) {
      clientRef.current
        .writeSingleRegister(AO_START_REGISTER + idx, value)
        .catch((err) => setStatus((err as Error).message));
    }
  };

  const handleDownloadCalibration = () => {
    downloadJson('calibration.json', {
      ai: aiCalibration,
      ao: aoCalibration,
    });
  };

  const selectLogFile = async () => {
    if (!('showDirectoryPicker' in window)) {
      setStatus('File System Access API not supported');
      return;
    }
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const fileHandle = await dirHandle.getFileHandle(
        `modbus-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
        { create: true },
      );
      const stream = await fileHandle.createWritable();
      await stream.write('timestamp,' +
        Array.from({ length: AI_CHANNELS }, (_, i) => `ai${i + 1}`).join(',') + ',' +
        Array.from({ length: AO_CHANNELS }, (_, i) => `ao${i + 1}`).join(',') + '\n');
      setLogHandle(stream);
      setStatus('Logging to selected folder');
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  const toggleAcquire = () => {
    if (!connected) return;
    setAcquiring((prev) => !prev);
  };

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-emerald-400">ModbusRTU Web Serial Logger</h1>
          <p className="text-sm text-slate-400">
            AI 16ch / AO 8ch - {formatSerialSettings(serialSettings)}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="button-secondary" onClick={handleDownloadCalibration}>
            キャリブレーションJSONダウンロード
          </button>
          <button className="button-secondary" onClick={selectLogFile}>
            ローカル保存フォルダを選択
          </button>
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
          <label className="block text-sm text-slate-400">ポーリング周期</label>
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
        <div className="flex items-end gap-2 lg:col-span-2">
          <button className="button-primary" onClick={handleConnect} disabled={connected}>
            接続
          </button>
          <button className="button-secondary" onClick={handleDisconnect} disabled={!connected}>
            切断
          </button>
          <button className="button-secondary" onClick={toggleAcquire} disabled={!connected}>
            {acquiring ? '停止' : '取得開始'}
          </button>
        </div>
        <div className="text-sm text-emerald-300 lg:col-span-2">Status: {status}</div>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold">AI 16ch</h2>
          <span className="text-xs text-slate-500">raw / phy</span>
        </div>
        <div className="grid gap-1 text-base">
          <div className="grid grid-cols-6 gap-2 text-sm text-slate-500">
            <span>Name</span>
            <span>Raw(x)</span>
            <span>a</span>
            <span>b</span>
            <span>c</span>
            <span>Phy(y)</span>
          </div>
          {aiChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className="grid grid-cols-6 items-center gap-2 rounded-md bg-slate-900/60 px-2 py-2"
            >
              <span className="text-slate-200">{ch.label}</span>
              <span className="font-semibold text-emerald-300 tabular-nums">{ch.raw}</span>
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
              <span className="font-semibold text-emerald-300 tabular-nums">{ch.phy.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xl font-semibold">AO 8ch</h2>
          <span className="text-xs text-slate-500">raw / phy</span>
        </div>
        <div className="grid gap-1 text-base">
          <div className="grid grid-cols-5 gap-2 text-sm text-slate-500">
            <span>Name</span>
            <span>Raw(x)</span>
            <span>a</span>
            <span>b</span>
            <span>Phy(y)</span>
          </div>
          {aoChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className="grid grid-cols-5 items-center gap-2 rounded-md bg-slate-900/60 px-2 py-2"
            >
              <span className="text-slate-200">{ch.label}</span>
              <input
                type="number"
                value={ch.raw}
                onChange={(e) => handleAoRawChange(idx, Number(e.target.value))}
                className="input-compact input-raw"
              />
              <input
                type="number"
                step="0.001"
                value={aoCalibration[idx].a}
                onChange={(e) => updateAoCalibration(idx, 'a', Number(e.target.value))}
                className="input-compact"
              />
              <input
                type="number"
                step="0.001"
                value={aoCalibration[idx].b}
                onChange={(e) => updateAoCalibration(idx, 'b', Number(e.target.value))}
                className="input-compact"
              />
              <span className="font-semibold text-emerald-300 tabular-nums">{ch.phy.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs text-slate-400">X軸</label>
            <select
              value={chartX}
              onChange={(e) => setChartX(e.target.value)}
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
            <label className="block text-xs text-slate-400">Y軸</label>
            <select
              value={chartY}
              onChange={(e) => setChartY(e.target.value)}
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
        <Line data={chartData} options={chartOptions} />
      </section>
    </div>
  );
}

export default App;
