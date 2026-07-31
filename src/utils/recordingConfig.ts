/**
 * Persisted settings for Recording Config: which camera and microphone are
 * bound, how the capture is sized, and what the USB budget check should assume.
 *
 * Stored through the same chokepoint as every other setting (readJsonStorage /
 * writeJsonStorage in ./cookies), so the viewer guard and the cookie lifeboat
 * apply here without this file knowing about either.
 */

import {
  VIDEO_DEFAULT_CAPTURE_FPS,
  VIDEO_DEFAULT_HEIGHT,
  VIDEO_DEFAULT_RECORD_FPS,
  VIDEO_DEFAULT_WIDTH,
  VIDEO_MAX_FPS,
  VIDEO_MIN_FPS,
  VIDEO_MIN_HEIGHT,
  VIDEO_MIN_RECORD_FPS,
  VIDEO_MIN_WIDTH,
} from '../constants';
import { readJsonStorage, writeJsonStorage } from './cookies';

const RECORDING_CONFIG_KEY = 'recording_config_v1';

/**
 * Where the burned-in clock sits, or that there is none.
 *
 * A corner rather than a free position: the point of the choice is to move the
 * clock off whatever part of the rig matters in this particular setup, and the
 * four corners cover that. Anything finer would be a placement tool.
 */
export type OverlayPosition =
  | 'none'
  | 'bottom-left'
  | 'top-left'
  | 'bottom-right'
  | 'top-right';

export const OVERLAY_POSITIONS: { value: OverlayPosition; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-left', label: 'Top left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'top-right', label: 'Top right' },
];

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
  /**
   * Whether the microphone selection is the user's own.
   *
   * Needed because null means two different things for audio: "not picked yet",
   * which should become the first microphone, and "None", which the user chose
   * and must survive. The camera needs no equivalent — it has no None, so null
   * there can only ever mean the first case.
   */
  audioChosen: boolean;
  /** Where the local wall clock (to milliseconds) is burned in, or 'none'. */
  overlayPosition: OverlayPosition;
  width: number;
  height: number;
  /** What the camera is asked to stream. This is what costs USB bandwidth. */
  captureFps: number;
  /**
   * How many of those frames reach the file. Never above captureFps — writing
   * more frames than were captured is not something a recorder can do.
   */
  recordFps: number;
}

export const DEFAULT_RECORDING_CONFIG: RecordingConfig = {
  videoDeviceId: null,
  videoDeviceLabel: '',
  audioDeviceId: null,
  audioDeviceLabel: '',
  audioChosen: false,
  overlayPosition: 'bottom-left',
  width: VIDEO_DEFAULT_WIDTH,
  height: VIDEO_DEFAULT_HEIGHT,
  captureFps: VIDEO_DEFAULT_CAPTURE_FPS,
  recordFps: VIDEO_DEFAULT_RECORD_FPS,
};

const VALID_OVERLAY_POSITIONS = new Set<string>(OVERLAY_POSITIONS.map((p) => p.value));

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const clampFloat = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number.NaN;
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
  // `fps` and `overlayTimestamp` are not fields any more but may be in a stored
  // config, so the type here is the current shape plus the names older versions
  // wrote — they are read below so an existing setting is carried over rather
  // than silently reset.
  const source = raw as Partial<
    Record<keyof RecordingConfig | 'fps' | 'overlayTimestamp', unknown>
  >;
  return {
    videoDeviceId: readDeviceId(source.videoDeviceId),
    videoDeviceLabel: readString(source.videoDeviceLabel),
    audioDeviceId: readDeviceId(source.audioDeviceId),
    audioDeviceLabel: readString(source.audioDeviceLabel),
    audioChosen: source.audioChosen === true,
    // `overlayTimestamp` is what a config written before the position was
    // selectable called this, so a stored `true` becomes the default corner
    // rather than resetting to no overlay at all.
    overlayPosition: VALID_OVERLAY_POSITIONS.has(source.overlayPosition as string)
      ? (source.overlayPosition as OverlayPosition)
      : source.overlayTimestamp === false
        ? 'none'
        : DEFAULT_RECORDING_CONFIG.overlayPosition,
    width: clampInt(source.width, VIDEO_MIN_WIDTH, Number.MAX_SAFE_INTEGER, VIDEO_DEFAULT_WIDTH),
    height: clampInt(source.height, VIDEO_MIN_HEIGHT, Number.MAX_SAFE_INTEGER, VIDEO_DEFAULT_HEIGHT),
    captureFps: clampInt(
      // `fps` is what a config written before capture and recording were split
      // called this; reading it keeps that setting rather than silently
      // resetting a machine that already had one.
      source.captureFps ?? source.fps,
      VIDEO_MIN_FPS,
      VIDEO_MAX_FPS,
      VIDEO_DEFAULT_CAPTURE_FPS,
    ),
    // Not clampInt: the recording rate goes down to 0.1 fps for a time-lapse,
    // and rounding it would land on zero.
    recordFps: clampFloat(
      source.recordFps ?? source.fps,
      VIDEO_MIN_RECORD_FPS,
      VIDEO_MAX_FPS,
      VIDEO_DEFAULT_RECORD_FPS,
    ),
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
