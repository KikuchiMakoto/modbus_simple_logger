export interface AxisTick {
  value: number;
  label: string;
}

const NICE_TIME_STEPS_MS = [
  1,
  2,
  5,
  10,
  20,
  50,
  100,
  200,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  120_000,
  300_000,
  600_000,
  900_000,
  1_800_000,
  3_600_000,
  7_200_000,
  10_800_000,
  21_600_000,
  43_200_000,
  86_400_000,
  172_800_000,
  604_800_000,
];

const DAY_MS = 86_400_000;

/**
 * matplotlib/MATLAB-style data margins: return [min, max] expanded by `fraction`
 * of the data span on each side (10% on X, 5% on Y). Returns null when the data
 * has no finite extent. A zero span pads by `zeroSpanPad` if supplied (used
 * for epoch-ms timestamps so a single point does not pad by ~10% of 56 years),
 * otherwise `fraction` of the magnitude, or 1 as a last resort.
 */
export function paddedRange(
  min: number,
  max: number,
  fraction: number,
  zeroSpanPad?: number,
): [number, number] | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min > max) {
    const tmp = min;
    min = max;
    max = tmp;
  }
  const halfSpan = max * 0.5 - min * 0.5;
  const pad =
    halfSpan > 0
      ? halfSpan * 2 * fraction
      : zeroSpanPad !== undefined
        ? zeroSpanPad
        : Math.abs(max) * fraction || 1;
  const lo = min - pad;
  const hi = max + pad;
  return [
    Number.isFinite(lo) ? lo : -Number.MAX_VALUE,
    Number.isFinite(hi) ? hi : Number.MAX_VALUE,
  ];
}

function niceNumberStep(span: number, targetTicks: number): { step: number; decimals: number } {
  const safeSpan = span > 0 && Number.isFinite(span) ? span : 1;
  const roughStep = safeSpan / Math.max(1, targetTicks - 1);
  const exp = Math.floor(Math.log10(roughStep));
  const mag = 10 ** exp;
  const norm = roughStep / mag;

  let niceNorm: number;
  let extraDecimal = 0;
  if (norm <= 1.2) {
    niceNorm = 1;
  } else if (norm <= 2.2) {
    niceNorm = 2;
  } else if (norm <= 3.0) {
    niceNorm = 2.5;
    extraDecimal = 1;
  } else if (norm <= 6.5) {
    niceNorm = 5;
  } else {
    niceNorm = 10;
  }

  const step = niceNorm * mag;
  const stepExp = Math.floor(Math.log10(step) + 1e-9);
  const decimals = Math.max(0, -stepExp + extraDecimal);
  return { step, decimals };
}

export function formatLinearTick(value: number, step: number, decimals: number, maxAbs: number): string {
  // Snap tiny floating-point residuals near zero to avoid "-0".
  const snapped = Math.abs(value) < step * 1e-7 ? 0 : value;
  if (snapped === 0) return '0';
  if (maxAbs >= 1e6 || (maxAbs > 0 && step < 1e-4)) {
    return snapped.toExponential(2).replace(/\.?0+e/, 'e');
  }
  const fixed = snapped.toFixed(Math.min(decimals, 8));
  if (!fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

function computeSubRangeSpan(min: number, max: number): number {
  const span = max - min;
  return Number.isFinite(span) ? span : Number.MAX_VALUE;
}

/** Compute nicely spaced linear ticks inside `[min, max]`. */
export function computeLinearTicks(min: number, max: number, maxTicks = 6): AxisTick[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const targetCount = Math.max(2, Math.floor(maxTicks));
  const span = computeSubRangeSpan(min, max);
  const { step, decimals } = niceNumberStep(span, targetCount);
  if (!(step > 0) || !Number.isFinite(step)) return [];

  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  const eps = step * 1e-9;
  const firstK = Math.ceil((min - eps) / step);
  const lastK = Math.floor((max + eps) / step);

  const ticks: AxisTick[] = [];
  const cap = Math.min(lastK, firstK + 24);
  for (let k = firstK; k <= cap; k++) {
    const raw = k * step;
    if (raw < min - eps || raw > max + eps) continue;
    const val = Math.abs(raw) < eps ? 0 : raw;
    ticks.push({
      value: val,
      label: formatLinearTick(val, step, decimals, maxAbs),
    });
  }
  return ticks;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTimeLabel(ms: number, stepMs: number, spanMs: number, showDate: boolean): string {
  const d = new Date(ms);
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());

  if (stepMs >= DAY_MS) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  }
  if (stepMs < 100) {
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }
  if (stepMs < 1_000) {
    const tenths = Math.floor(d.getMilliseconds() / 100);
    return `${hh}:${mm}:${ss}.${tenths}`;
  }
  const timePart = stepMs < 60_000 || spanMs <= 3_600_000 ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  if (showDate) {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${timePart}`;
  }
  return timePart;
}

function pickTimeStepMs(spanMs: number, targetTicks: number): number {
  const rough = spanMs / Math.max(1, targetTicks - 1);
  for (const step of NICE_TIME_STEPS_MS) {
    if (step >= rough) return step;
  }
  const roughDays = rough / DAY_MS;
  const { step: niceDays } = niceNumberStep(roughDays, 2);
  return Math.max(7, Math.round(niceDays)) * DAY_MS;
}

/**
 * Compute nicely spaced local-time ticks inside `[minMs, maxMs]`.
 * Aligns sub-day ticks to local midnight so hour/minute grids land on clean
 * wall-clock boundaries regardless of UTC timezone offset.
 */
export function computeTimeTicks(minMs: number, maxMs: number, maxTicks = 5): AxisTick[] {
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || maxMs <= minMs) return [];
  const spanMs = maxMs - minMs;
  const targetCount = Math.max(2, Math.floor(maxTicks));
  const stepMs = pickTimeStepMs(spanMs, targetCount);

  const startDate = new Date(minMs);
  const localMidnight = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
  ).getTime();

  const ticks: AxisTick[] = [];
  const rawValues: number[] = [];

  if (stepMs >= DAY_MS) {
    const stepDays = Math.max(1, Math.round(stepMs / DAY_MS));
    const cursor = new Date(localMidnight);
    while (cursor.getTime() < minMs - 1) {
      cursor.setDate(cursor.getDate() + stepDays);
    }
    for (let i = 0; i < 24 && cursor.getTime() <= maxMs + 1; i++) {
      rawValues.push(cursor.getTime());
      cursor.setDate(cursor.getDate() + stepDays);
    }
  } else {
    const firstK = Math.ceil((minMs - localMidnight - 1) / stepMs);
    for (let i = 0; i < 24; i++) {
      const t = localMidnight + (firstK + i) * stepMs;
      if (t > maxMs + 1) break;
      if (t >= minMs - 1) rawValues.push(t);
    }
  }

  let prevDayKey = '';
  const startDay = new Date(minMs);
  const endDay = new Date(maxMs);
  const spansMultipleDays =
    startDay.getFullYear() !== endDay.getFullYear() ||
    startDay.getMonth() !== endDay.getMonth() ||
    startDay.getDate() !== endDay.getDate();

  for (let i = 0; i < rawValues.length; i++) {
    const t = rawValues[i];
    const d = new Date(t);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const showDate = spansMultipleDays && (i === 0 || dayKey !== prevDayKey);
    prevDayKey = dayKey;
    ticks.push({
      value: t,
      label: formatTimeLabel(t, stepMs, spanMs, showDate),
    });
  }
  return ticks;
}
