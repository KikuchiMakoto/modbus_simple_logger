/**
 * Whether a given capture fits on the USB bus alongside the Modbus link.
 *
 * The asymmetry this exists for: a UVC camera reserves *isochronous* bandwidth
 * up front and gets it every microframe, while the Modbus adapter's USB serial
 * is a *bulk* endpoint served from whatever is left. Over-configure the camera
 * and the serial link does not merely slow down — the reservation is granted
 * first and the bulk transfers starve. Capping the camera is the only lever
 * that acts on the right side of that, which is why this gate is hard rather
 * than advisory.
 *
 * The figure is a rough one, assuming MJPEG. getUserMedia never reveals which
 * UVC payload format was actually negotiated, so nothing here can be exact —
 * but MJPEG is what cameras use above VGA, so it is the estimate that matches
 * everyday use. An uncompressed fallback would be around ten times heavier,
 * which is what the gap between the thresholds and the bus rate absorbs.
 */

import {
  MODBUS_RESERVE_MBPS,
  USB_BLOCK_MBPS,
  USB_HS_MBPS,
  USB_WARN_MBPS,
  UVC_BYTES_PER_PIXEL,
} from '../constants';
import type { RecordingConfig } from './recordingConfig';

/** Bits per second the camera is expected to pull off the bus. */
export function uvcBitrate(width: number, height: number, fps: number): number {
  return Math.round(width * height * UVC_BYTES_PER_PIXEL * 8 * fps);
}

export type UsbLevel = 'ok' | 'warn' | 'block';

export interface UsbBudgetVerdict {
  /** False means the camera must not be opened. */
  ok: boolean;
  level: UsbLevel;
  mbps: number;
  /** Fraction of the 480 Mbps bus, for the meter. */
  usedFraction: number;
  /** One line for the panel and for the status bar when a start is refused. */
  reason: string;
}

export function checkUsbBudget(config: RecordingConfig): UsbBudgetVerdict {
  // captureFps, not recordFps. The camera reserves bandwidth for what it
  // streams; dropping frames on the way to the file changes the file's size and
  // nothing at all about the bus.
  const { width, height, captureFps } = config;

  const mbps = uvcBitrate(width, height, captureFps) / 1_000_000;
  const level: UsbLevel =
    mbps >= USB_BLOCK_MBPS ? 'block' : mbps >= USB_WARN_MBPS ? 'warn' : 'ok';
  const size = `${width}×${height}@${captureFps}`;

  return {
    ok: level !== 'block',
    level,
    mbps,
    usedFraction: Math.min(1, mbps / USB_HS_MBPS),
    reason:
      level === 'block'
        ? `${size} needs about ${mbps.toFixed(0)} Mbps of the ${USB_HS_MBPS} Mbps bus — enough to starve the ${MODBUS_RESERVE_MBPS} Mbps Modbus link.`
        : `${size} needs about ${mbps.toFixed(0)} Mbps of the ${USB_HS_MBPS} Mbps bus.`,
  };
}

/** The highest capture rate that stays under the block threshold at this size. */
export function largestFittingFps(width: number, height: number): number {
  const perFrame = uvcBitrate(width, height, 1);
  if (perFrame <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((USB_BLOCK_MBPS * 1_000_000) / perFrame);
}
