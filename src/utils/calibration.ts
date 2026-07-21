export const hx711RawToMvPerV = (raw: number): number =>
  raw / 32768.0 / 128.0 / 2 * 1e3;

export const hx711RawToMicroStrain = (raw: number): number =>
  hx711RawToMvPerV(raw) * 2e3;

export const getLevelColor = (ratio: number): { bar: string; text: string } => {
  if (ratio > 0.9) return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
  if (ratio > 0.6) return { bar: 'bg-yellow-400', text: 'text-yellow-500 dark:text-yellow-400' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' };
};
