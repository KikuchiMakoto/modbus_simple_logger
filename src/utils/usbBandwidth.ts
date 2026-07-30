/**
 * Whether a given capture size fits on the USB bus alongside the Modbus link.
 *
 * The asymmetry this exists for: a UVC camera reserves *isochronous* bandwidth
 * up front and gets it every microframe, while the Modbus adapter's USB serial
 * is a *bulk* endpoint served from whatever is left. Over-configure the camera
 * and the serial link does not merely slow down — the reservation is granted
 * first and the bulk transfers starve. Capping the camera is the only lever
 * that acts on the right side of that, which is why this gate is hard rather
 * than advisory.
 *
 * Everything here is an estimate. getUserMedia never reveals which UVC payload
 * format was negotiated, so the format is declared by the user and the YUY2
 * worst case is always reported alongside — a number that could be wrong is
 * useful, a number that hides that it could be wrong is not.
 */

import {
  MODBUS_RESERVE_MBPS,
  UVC_BYTES_PER_PIXEL,
  UVC_H264_BITRATE,
  USB_HS_EFFECTIVE_MBPS,
} from '../constants';
import type { RecordingConfig, UvcFormat } from './recordingConfig';

/** Bits per second the camera is expected to pull off the bus. */
export function estimateUvcBitrate(
  width: number,
  height: number,
  fps: number,
  format: UvcFormat,
): number {
  // An on-board H.264 encoder sends a near-constant rate; resolution barely
  // moves it, so scaling by pixels would be actively misleading here.
  if (format === 'h264') return UVC_H264_BITRATE;
  const bytesPerPixel = UVC_BYTES_PER_PIXEL[format];
  return Math.round(width * height * bytesPerPixel * 8 * fps);
}

const toMbps = (bitsPerSecond: number): number => bitsPerSecond / 1_000_000;

export interface UsbBudgetVerdict {
  /** False means recording must not start. */
  ok: boolean;
  /** Estimate for the declared format. */
  estimateMbps: number;
  /** Same size and rate, but assuming the camera fell back to uncompressed. */
  worstCaseMbps: number;
  budgetMbps: number;
  /** Fraction of the budget the estimate uses, for the meter in the panel. */
  usedFraction: number;
  /** True when the declared format fits but YUY2 would not. */
  worstCaseOverBudget: boolean;
  /** Roughly what is left for the Modbus adapter's bulk transfers. */
  headroomMbps: number;
  /** Set when the check was skipped because the camera is on its own bus. */
  skipped: boolean;
  /** One line for the panel and for the status bar when a start is refused. */
  reason: string;
}

export function checkUsbBudget(config: RecordingConfig): UsbBudgetVerdict {
  const { width, height, fps, uvcFormat, usbBudgetMbps, separateUsbBus } = config;

  const estimateMbps = toMbps(estimateUvcBitrate(width, height, fps, uvcFormat));
  const worstCaseMbps = toMbps(estimateUvcBitrate(width, height, fps, 'yuy2'));
  const headroomMbps = Math.max(0, USB_HS_EFFECTIVE_MBPS - estimateMbps);
  const size = `${width}×${height}@${fps}`;

  if (separateUsbBus) {
    return {
      ok: true,
      estimateMbps,
      worstCaseMbps,
      budgetMbps: usbBudgetMbps,
      usedFraction: 0,
      worstCaseOverBudget: false,
      headroomMbps: USB_HS_EFFECTIVE_MBPS,
      skipped: true,
      reason: 'Camera declared to be on a separate USB bus — no contention to check.',
    };
  }

  const ok = estimateMbps <= usbBudgetMbps;
  return {
    ok,
    estimateMbps,
    worstCaseMbps,
    budgetMbps: usbBudgetMbps,
    usedFraction: usbBudgetMbps > 0 ? estimateMbps / usbBudgetMbps : 1,
    worstCaseOverBudget: worstCaseMbps > usbBudgetMbps,
    headroomMbps,
    skipped: false,
    reason: ok
      ? `${size} ${uvcFormat.toUpperCase()} needs about ${estimateMbps.toFixed(0)} Mbps of the ${usbBudgetMbps} Mbps budget.`
      : `${size} ${uvcFormat.toUpperCase()} needs about ${estimateMbps.toFixed(0)} Mbps, over the ${usbBudgetMbps} Mbps budget — it would starve the ${MODBUS_RESERVE_MBPS} Mbps Modbus link.`,
  };
}

/**
 * Sizes at or below the budget for the declared format, used to tell the user
 * what would fit rather than only that their setting does not.
 */
export function largestFittingFps(
  width: number,
  height: number,
  format: UvcFormat,
  budgetMbps: number,
): number {
  if (format === 'h264') return Number.POSITIVE_INFINITY;
  const perFrame = estimateUvcBitrate(width, height, 1, format);
  if (perFrame <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor((budgetMbps * 1_000_000) / perFrame);
}
