/**
 * Full configuration Export / Import / Print report utility.
 * Captures all user configurations persisted in localStorage/cookies,
 * and formats printable HTML report for saving as PDF or printing on paper.
 */

import { readJsonStorage, writeJsonStorage, writeLocalPreference, type JsonValue } from './cookies';
import { logSystem, SOURCE } from './systemLog';
import type { AiCalibration, VoltageMode } from '../types';

export const FULL_CONFIG_FORMAT_ID = 'modbus_simple_logger_full_config';
export const FULL_CONFIG_SCHEMA_VERSION = 1;

// Storage keys
const AI_CALIBRATION_KEY = 'ai_calibration_v1';
const VOLTAGE_CONFIG_KEY = 'voltage_config_v1';
const AI_LABELS_KEY = 'ai_free_labels_v1';
const AO_LABELS_KEY = 'ao_free_labels_v1';
const PARAM_LABELS_KEY = 'param_free_labels_v1';
const CHART_AXES_KEY = 'chart_axes_v1';
const THEME_KEY = 'theme_preference_v1';
const UI_SCALE_KEY = 'ui_scale_v1';
const LOG_LEVEL_KEY = 'systemLogLevel';
const COLLAPSED_AI_KEY = 'ai_collapsed';
const COLLAPSED_AO_KEY = 'ao_collapsed';
const COLLAPSED_PARAM_KEY = 'param_collapsed';
const DEVICE_MEMO_KEY = 'device_memo_v1';
const SCRIPT_TABS_KEY = 'scriptRunnerTabs';
const SCRIPT_CODE_KEY = 'scriptRunnerCode';

export type FullConfigPayload = {
  format: string;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  settings: {
    aiCalibration?: AiCalibration[];
    voltageConfig?: VoltageMode[];
    aiFreeLabels?: string[];
    aoFreeLabels?: string[];
    paramFreeLabels?: string[];
    chartAxes?: JsonValue;
    themePreference?: string;
    uiScale?: number;
    systemLogLevel?: string;
    collapsedAi?: boolean;
    collapsedAo?: boolean;
    collapsedParam?: boolean;
    deviceMemo?: string;
    scriptTabs?: JsonValue;
    scriptRunnerCode?: string;
  };
};

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

export function exportFullConfig(appVersion: string): void {
  const payload: FullConfigPayload = {
    format: FULL_CONFIG_FORMAT_ID,
    schemaVersion: FULL_CONFIG_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    settings: {
      aiCalibration: readJsonStorage<AiCalibration[]>(AI_CALIBRATION_KEY) ?? undefined,
      voltageConfig: readJsonStorage<VoltageMode[]>(VOLTAGE_CONFIG_KEY) ?? undefined,
      aiFreeLabels: readJsonStorage<string[]>(AI_LABELS_KEY) ?? undefined,
      aoFreeLabels: readJsonStorage<string[]>(AO_LABELS_KEY) ?? undefined,
      paramFreeLabels: readJsonStorage<string[]>(PARAM_LABELS_KEY) ?? undefined,
      chartAxes: readJsonStorage<JsonValue>(CHART_AXES_KEY) ?? undefined,
      themePreference: readJsonStorage<string>(THEME_KEY) ?? undefined,
      uiScale: readJsonStorage<number>(UI_SCALE_KEY) ?? undefined,
      systemLogLevel: readJsonStorage<string>(LOG_LEVEL_KEY) ?? undefined,
      collapsedAi: readJsonStorage<boolean>(COLLAPSED_AI_KEY) ?? undefined,
      collapsedAo: readJsonStorage<boolean>(COLLAPSED_AO_KEY) ?? undefined,
      collapsedParam: readJsonStorage<boolean>(COLLAPSED_PARAM_KEY) ?? undefined,
      deviceMemo: readJsonStorage<string>(DEVICE_MEMO_KEY) ?? undefined,
      scriptTabs: readJsonStorage<JsonValue>(SCRIPT_TABS_KEY) ?? undefined,
      scriptRunnerCode: readJsonStorage<string>(SCRIPT_CODE_KEY) ?? undefined,
    },
  };

  const filename = `${formatTimestamp(new Date())}.config.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  logSystem('INFO', SOURCE.app, `Full configuration exported to ${filename} (v${appVersion})`);
}

export async function importFullConfig(file: File, currentVersion: string): Promise<boolean> {
  let text: string;
  try {
    text = await file.text();
  } catch (err) {
    logSystem('ERROR', SOURCE.app, `Failed to read file ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logSystem('ERROR', SOURCE.app, `Failed to parse config file ${file.name}: invalid JSON`);
    return false;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    logSystem('ERROR', SOURCE.app, `Invalid config file ${file.name}: expected JSON object`);
    return false;
  }

  const payload = parsed as Partial<FullConfigPayload>;
  if (payload.format !== FULL_CONFIG_FORMAT_ID) {
    logSystem('ERROR', SOURCE.app, `File ${file.name} is not a valid Modbus Simple Logger full configuration file.`);
    return false;
  }

  const fileVersion = payload.appVersion || 'unknown';
  if (fileVersion !== currentVersion) {
    logSystem(
      'WARN',
      SOURCE.app,
      `Full config imported from a different app version (file: v${fileVersion}, current: v${currentVersion}). Please verify channel calibration and script compatibility.`,
    );
  } else {
    logSystem('INFO', SOURCE.app, `Full config imported from matching version v${currentVersion}.`);
  }

  const s = payload.settings;
  if (!s || typeof s !== 'object') {
    logSystem('ERROR', SOURCE.app, 'Configuration file contains no settings payload.');
    return false;
  }

  if (Array.isArray(s.aiCalibration)) {
    writeJsonStorage(AI_CALIBRATION_KEY, s.aiCalibration);
  }
  if (Array.isArray(s.voltageConfig)) {
    writeJsonStorage(VOLTAGE_CONFIG_KEY, s.voltageConfig);
  }
  if (Array.isArray(s.aiFreeLabels)) {
    writeJsonStorage(AI_LABELS_KEY, s.aiFreeLabels);
  }
  if (Array.isArray(s.aoFreeLabels)) {
    writeJsonStorage(AO_LABELS_KEY, s.aoFreeLabels);
  }
  if (Array.isArray(s.paramFreeLabels)) {
    writeJsonStorage(PARAM_LABELS_KEY, s.paramFreeLabels);
  }
  if (s.chartAxes !== undefined && s.chartAxes !== null) {
    writeJsonStorage(CHART_AXES_KEY, s.chartAxes);
  }
  if (typeof s.themePreference === 'string') {
    writeLocalPreference(THEME_KEY, s.themePreference);
  }
  if (typeof s.uiScale === 'number') {
    writeLocalPreference(UI_SCALE_KEY, s.uiScale);
  }
  if (typeof s.systemLogLevel === 'string') {
    writeLocalPreference(LOG_LEVEL_KEY, s.systemLogLevel);
  }
  if (typeof s.collapsedAi === 'boolean') {
    writeJsonStorage(COLLAPSED_AI_KEY, s.collapsedAi);
  }
  if (typeof s.collapsedAo === 'boolean') {
    writeJsonStorage(COLLAPSED_AO_KEY, s.collapsedAo);
  }
  if (typeof s.collapsedParam === 'boolean') {
    writeJsonStorage(COLLAPSED_PARAM_KEY, s.collapsedParam);
  }
  if (typeof s.deviceMemo === 'string') {
    writeJsonStorage(DEVICE_MEMO_KEY, s.deviceMemo);
  }
  if (s.scriptTabs !== undefined && s.scriptTabs !== null) {
    writeJsonStorage(SCRIPT_TABS_KEY, s.scriptTabs);
  }
  if (typeof s.scriptRunnerCode === 'string') {
    writeJsonStorage(SCRIPT_CODE_KEY, s.scriptRunnerCode);
  }

  logSystem('INFO', SOURCE.app, 'Full configuration saved to local storage. Reloading application to apply all settings...');
  setTimeout(() => {
    window.location.reload();
  }, 300);

  return true;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function printFullConfigReport(appVersion: string): void {
  const ts = formatTimestamp(new Date());

  const aiCalibration = readJsonStorage<AiCalibration[]>(AI_CALIBRATION_KEY) ?? [];
  const voltageConfig = readJsonStorage<VoltageMode[]>(VOLTAGE_CONFIG_KEY) ?? [];
  const aiLabels = readJsonStorage<string[]>(AI_LABELS_KEY) ?? [];
  const aoLabels = readJsonStorage<string[]>(AO_LABELS_KEY) ?? [];
  const paramLabels = readJsonStorage<string[]>(PARAM_LABELS_KEY) ?? [];
  const chartAxes = readJsonStorage<Record<string, { x: string; y: string }>>(CHART_AXES_KEY) ?? {};
  const deviceMemo = readJsonStorage<string>(DEVICE_MEMO_KEY) ?? '';
  const theme = readJsonStorage<string>(THEME_KEY) ?? 'system';
  const uiScale = readJsonStorage<number>(UI_SCALE_KEY) ?? 100;
  const logLevel = readJsonStorage<string>(LOG_LEVEL_KEY) ?? 'INFO';
  const scriptTabs = readJsonStorage<{ tabs?: Array<{ id: string; name: string; language: string; code: string }>; activeId?: string }>(SCRIPT_TABS_KEY);

  let aiRowsHtml = '';
  for (let ch = 0; ch < 16; ch++) {
    const isHx711 = ch < 8;
    const typeLabel = isHx711 ? 'HX711' : 'ADS1115';
    const mode = voltageConfig[ch] || (isHx711 ? 'hx711_mv_per_v' : 'ads1115_6144mv');
    const label = aiLabels[ch] || '';
    const cal = aiCalibration[ch] || { a: 0, b: 1, c: 0 };
    aiRowsHtml += `
      <tr>
        <td class="center font-mono">CH${String(ch).padStart(2, '0')}</td>
        <td class="center font-mono">${typeLabel}</td>
        <td class="font-mono text-xs">${escapeHtml(mode)}</td>
        <td class="font-mono">${escapeHtml(label)}</td>
        <td class="right font-mono">${cal.a}</td>
        <td class="right font-mono">${cal.b}</td>
        <td class="right font-mono">${cal.c}</td>
      </tr>
    `;
  }

  let aoRowsHtml = '';
  for (let ch = 0; ch < 8; ch++) {
    const label = aoLabels[ch] || '';
    aoRowsHtml += `
      <tr>
        <td class="center font-mono">AO${String(ch).padStart(2, '0')}</td>
        <td class="font-mono">${escapeHtml(label)}</td>
      </tr>
    `;
  }

  let paramRowsHtml = '';
  for (let ch = 0; ch < 16; ch++) {
    const label = paramLabels[ch] || '';
    paramRowsHtml += `
      <tr>
        <td class="center font-mono">P${String(ch).padStart(2, '0')}</td>
        <td class="font-mono">${escapeHtml(label)}</td>
      </tr>
    `;
  }

  let chartAxesHtml = '';
  for (let c = 0; c < 4; c++) {
    const sel = chartAxes[String(c)] ?? { x: 'time', y: `phy_${c}` };
    chartAxesHtml += `
      <tr>
        <td class="center font-mono">Chart ${c + 1}</td>
        <td class="font-mono">${escapeHtml(sel.x)}</td>
        <td class="font-mono">${escapeHtml(sel.y)}</td>
      </tr>
    `;
  }

  let scriptTabsHtml = '';
  if (scriptTabs && Array.isArray(scriptTabs.tabs) && scriptTabs.tabs.length > 0) {
    for (const t of scriptTabs.tabs) {
      const isActive = t.id === scriptTabs.activeId ? ' (Active)' : '';
      scriptTabsHtml += `
        <div class="script-box">
          <div class="script-header font-mono">
            <strong>${escapeHtml(t.name)}</strong> [${escapeHtml(t.language)}]${isActive}
          </div>
          <pre class="script-body"><code>${escapeHtml(t.code)}</code></pre>
        </div>
      `;
    }
  } else {
    scriptTabsHtml = '<p class="muted">No script tabs saved.</p>';
  }

  const memoHtml = deviceMemo.trim()
    ? `<pre class="memo-box">${escapeHtml(deviceMemo)}</pre>`
    : '<p class="muted">None</p>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(ts)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 12mm 12mm 12mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      line-height: 1.4;
      color: #111;
      background: #fff;
      margin: 0;
      padding: 0;
    }
    .header {
      border-bottom: 2px solid #0f766e;
      padding-bottom: 6px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .title {
      font-size: 16px;
      font-weight: bold;
      color: #0f766e;
    }
    .meta {
      font-size: 10px;
      color: #666;
    }
    h2 {
      font-size: 12px;
      margin: 12px 0 6px 0;
      padding-bottom: 2px;
      border-bottom: 1px solid #ccc;
      color: #333;
      page-break-after: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
      page-break-inside: auto;
    }
    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 4px 6px;
      text-align: left;
    }
    th {
      background-color: #f3f4f6;
      font-weight: 600;
      font-size: 10px;
      color: #374151;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .font-mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .text-xs { font-size: 9px; }
    .muted { color: #888; font-style: italic; }
    .memo-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      padding: 6px 8px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10px;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 4px 0 10px 0;
    }
    .script-box {
      border: 1px solid #d1d5db;
      border-radius: 4px;
      margin-bottom: 8px;
      page-break-inside: avoid;
    }
    .script-header {
      background: #f3f4f6;
      padding: 4px 8px;
      border-bottom: 1px solid #d1d5db;
      font-size: 10px;
    }
    .script-body {
      margin: 0;
      padding: 6px 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 9px;
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-all;
      background: #fff;
    }
    .grid-2 {
      display: flex;
      gap: 12px;
    }
    .grid-2 > div {
      flex: 1;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">Modbus Simple Logger &mdash; Configuration Report</div>
      <div class="meta">App Version: v${escapeHtml(appVersion)} | Generated: ${escapeHtml(new Date().toLocaleString())}</div>
    </div>
    <div class="meta font-mono right">
      Report ID: ${escapeHtml(ts)}
    </div>
  </div>

  <h2>1. Device &amp; Experiment Memo</h2>
  ${memoHtml}

  <h2>2. Analog Input Channels (CH00 - CH15) &amp; Calibration</h2>
  <table>
    <thead>
      <tr>
        <th style="width: 50px;" class="center">Channel</th>
        <th style="width: 60px;" class="center">Frontend</th>
        <th style="width: 120px;">Range / Mode</th>
        <th>Label</th>
        <th style="width: 70px;" class="right">a (x&sup2;)</th>
        <th style="width: 70px;" class="right">b (x)</th>
        <th style="width: 70px;" class="right">c (offset)</th>
      </tr>
    </thead>
    <tbody>
      ${aiRowsHtml}
    </tbody>
  </table>

  <div class="grid-2">
    <div>
      <h2>3. Analog Output (GP8403)</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 50px;" class="center">Channel</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          ${aoRowsHtml}
        </tbody>
      </table>
    </div>
    <div>
      <h2>4. Scratch Parameters (P00 - P15)</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 50px;" class="center">Channel</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          ${paramRowsHtml}
        </tbody>
      </table>
    </div>
  </div>

  <div class="grid-2">
    <div>
      <h2>5. Chart Axis Selections</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 70px;" class="center">Plot</th>
            <th>X Axis</th>
            <th>Y Axis</th>
          </tr>
        </thead>
        <tbody>
          ${chartAxesHtml}
        </tbody>
      </table>
    </div>
    <div>
      <h2>6. UI &amp; Environment Preferences</h2>
      <table>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Theme</td><td class="font-mono">${escapeHtml(theme)}</td></tr>
          <tr><td>UI Scale</td><td class="font-mono">${uiScale}%</td></tr>
          <tr><td>System Log Level</td><td class="font-mono">${escapeHtml(logLevel)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2>7. Script Runner Tabs &amp; Source Code</h2>
  ${scriptTabsHtml}
</body>
</html>`;

  // Hidden iframe pattern to avoid tab popup blocker and set document.title for filename
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    logSystem('ERROR', SOURCE.app, 'Unable to create print document iframe.');
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  // Give resources/fonts a frame to settle, then print
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      logSystem('ERROR', SOURCE.app, `Print error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Clean up iframe after user dismisses print dialog
      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 2000);
    }
  }, 150);
}
