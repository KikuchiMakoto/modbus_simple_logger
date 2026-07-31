/**
 * Persisted settings for Recording Config: which camera and microphone are
 * bound, how the capture is sized, and what the USB budget check should assume.
 *
 * Stored through the same chokepoint as every other setting (readJsonStorage /
 * writeJsonStorage in ./cookies), so the viewer guard and the cookie lifeboat
 * apply here without this file knowing about either.
 */

import {
  USB_CAMERA_BUDGET_MBPS,
  VIDEO_DEFAULT_FPS,
  VIDEO_DEFAULT_HEIGHT,
  VIDEO_DEFAULT_WIDTH,
  VIDEO_MAX_FPS,
  VIDEO_MIN_FPS,
  VIDEO_MIN_HEIGHT,
  VIDEO_MIN_WIDTH,
} from '../constants';
import { readJsonStorage, writeJsonStorage } from './cookies';

const RECORDING_CONFIG_KEY = 'recording_config_v1';

/** What the USB budget check should assume the camera puts on the wire. */
export type UvcFormat = 'mjpeg' | 'yuy2' | 'h264';

export interface RecordingConfig {
  /** null = no camera bound. Recording then captures audio only, or nothing. */
  videoDeviceId: string | null;
  /**
   * Kept alongside the id because a deviceId is not stable across re-plugs on
   * Windows — the label is what lets a rebind survive unplugging the camera.
   */
  videoDeviceLabel: string;
  audioDeviceId: string | null;
  audioDeviceLabel: string;
  /** Burn the local wall clock (to milliseconds) into every frame. */
  overlayTimestamp: boolean;
  width: number;
  height: number;
  fps: number;
  /** Declared, not detected: the browser never says which format it negotiated. */
  uvcFormat: UvcFormat;
  usbBudgetMbps: number;
  /**
   * The one escape hatch on the bandwidth gate. If the camera really is on its
   * own host controller there is no contention to protect against, and blocking
   * that setup would just be wrong.
   */
  separateUsbBus: boolean;
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  videoDeviceId: null,
  videoDeviceLabel: '',
  audioDeviceId: null,
  audioDeviceLabel: '',
  overlayTimestamp: true,
  width: VIDEO_DEFAULT_WIDTH,
  height: VIDEO_DEFAULT_HEIGHT,
  fps: VIDEO_DEFAULT_FPS,
  uvcFormat: 'mjpeg',
  usbBudgetMbps: USB_CAMERA_BUDGET_MBPS,
  separateUsbBus: false,
};

const VALID_FORMATS = new Set<string>(['mjpeg', 'yuy2', 'h264']);

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');

const readDeviceId = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/**
 * Everything from storage goes through here. An older build's shape, a
 * hand-edited value, or a partially written object all have to come out as a
 * config the rest of the app can use without checking anything again.
 *
 * There is no upper clamp on width/height on purpose: the ceiling is whatever
 * the camera can do, and the USB budget check is what decides whether a given
 * size is allowed to run.
 */
export const sanitizeRecordingConfig = (raw: unknown): RecordingConfig => {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_RECORDING_CONFIG };
  const source = raw as Partial<Record<keyof RecordingConfig, unknown>>;
  return {
    videoDeviceId: readDeviceId(source.videoDeviceId),
    videoDeviceLabel: readString(source.videoDeviceLabel),
    audioDeviceId: readDeviceId(source.audioDeviceId),
    audioDeviceLabel: readString(source.audioDeviceLabel),
    // Defaults to on when absent, matching DEFAULT_RECORDING_CONFIG.
    overlayTimestamp: source.overlayTimestamp !== false,
    width: clampInt(source.width, VIDEO_MIN_WIDTH, Number.MAX_SAFE_INTEGER, VIDEO_DEFAULT_WIDTH),
    height: clampInt(source.height, VIDEO_MIN_HEIGHT, Number.MAX_SAFE_INTEGER, VIDEO_DEFAULT_HEIGHT),
    fps: clampInt(source.fps, VIDEO_MIN_FPS, VIDEO_MAX_FPS, VIDEO_DEFAULT_FPS),
    uvcFormat:
      typeof source.uvcFormat === 'string' && VALID_FORMATS.has(source.uvcFormat)
        ? (source.uvcFormat as UvcFormat)
        : DEFAULT_RECORDING_CONFIG.uvcFormat,
    usbBudgetMbps: clampInt(source.usbBudgetMbps, 1, 10_000, USB_CAMERA_BUDGET_MBPS),
    separateUsbBus: source.separateUsbBus === true,
  };
};

export const loadRecordingConfig = (): RecordingConfig =>
  sanitizeRecordingConfig(readJsonStorage(RECORDING_CONFIG_KEY));

export const saveRecordingConfig = (config: RecordingConfig) =>
  writeJsonStorage(RECORDING_CONFIG_KEY, { ...config });

/** True when there is at least one device to capture from. */
export const hasBoundDevice = (config: RecordingConfig): boolean =>
  config.videoDeviceId !== null || config.audioDeviceId !== null;

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  /** Labels are blank until the user has granted permission at least once. */
  labelsVisible: boolean;
}

export const emptyDeviceLists: DeviceLists = {
  cameras: [],
  microphones: [],
  labelsVisible: false,
};

export async function enumerateMediaDevices(): Promise<DeviceLists> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return emptyDeviceLists;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const microphones = devices.filter((d) => d.kind === 'audioinput');
  return {
    cameras,
    microphones,
    labelsVisible: [...cameras, ...microphones].some((d) => d.label !== ''),
  };
}

/**
 * Match a saved binding against what is plugged in now.
 *
 * The id is tried first because it is exact. The label is the fallback because
 * Windows hands out a new deviceId when a camera comes back on a different USB
 * port — the binding is still meant to point at the same physical camera, and
 * silently reverting to "no camera" would look like the setting was lost.
 */
export function resolveBoundDevice(
  deviceId: string | null,
  label: string,
  available: MediaDeviceInfo[],
): { deviceId: string | null; label: string; rebound: boolean } {
  if (deviceId === null) return { deviceId: null, label: '', rebound: false };

  const byId = available.find((d) => d.deviceId === deviceId);
  if (byId) return { deviceId: byId.deviceId, label: byId.label || label, rebound: false };

  if (label !== '') {
    const byLabel = available.find((d) => d.label === label);
    if (byLabel) return { deviceId: byLabel.deviceId, label: byLabel.label, rebound: true };
  }

  // Gone. Keep the label so the panel can say which device is missing rather
  // than just showing an empty selector.
  return { deviceId: null, label, rebound: false };
}
