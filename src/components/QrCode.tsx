import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

type QrCodeProps = {
  /** The text to encode — here, always a viewer URL. */
  value: string;
  /** Rendered edge length in px, including the quiet zone. */
  size?: number;
};

// Error correction level. 'M' (~15% recoverable) is the usual default and is
// right for a code read off a screen at arm's length: 'L' saves a version or two
// but gives up margin against glare and moiré, and 'Q'/'H' would make the
// modules smaller for robustness this situation does not need.
const EC_LEVEL = 'M';

// Four modules of quiet zone, as the QR spec requires. Scanners that fail on a
// code "that looks fine" are usually failing on a missing quiet zone.
const QUIET_ZONE = 4;

/**
 * A QR code as inline SVG.
 *
 * Rendered as one `<path>` of module squares rather than a `<rect>` per module:
 * a version-6 code is ~1700 modules, which is 1700 DOM nodes for something that
 * never animates and never gets interacted with.
 *
 * Drawn with `currentColor` on a white plate. The plate stays white in dark mode
 * on purpose — inverted QR codes (light modules on dark) are out of spec and
 * plenty of phone cameras refuse to read them.
 */
export function QrCode({ value, size = 200 }: QrCodeProps) {
  const { path, extent } = useMemo(() => {
    // 0 = pick the smallest version that fits the data.
    const qr = qrcode(0, EC_LEVEL);
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const parts: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!qr.isDark(row, col)) continue;
        // Absolute move + 1x1 box, so the subpaths stay independent and the
        // fill rule never has to resolve overlaps.
        parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
      }
    }
    return { path: parts.join(''), extent: count + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${extent} ${extent}`}
      role="img"
      aria-label="QR code for the viewer URL"
      // shape-rendering: without it, browsers antialias the module edges and
      // adjacent modules bleed into each other at small sizes, which is exactly
      // what a scanner cannot tolerate.
      shapeRendering="crispEdges"
      className="rounded bg-white"
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#0f172a" />
    </svg>
  );
}
