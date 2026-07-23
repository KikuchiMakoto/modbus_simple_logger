export const hx711RawToMvPerV = (raw: number): number =>
	(raw / 32768.0 / 128.0 / 2) * 1e3;

export type LevelStatus = "normal" | "warning" | "danger";

export function getLevelStatus(raw: number): LevelStatus {
	const ratio = Math.abs(raw) / 32767;
	if (ratio >= 0.9) return "danger";
	if (ratio >= 0.8) return "warning";
	return "normal";
}
