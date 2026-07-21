export const hx711RawToMvPerV = (raw: number): number =>
	(raw / 32768.0 / 128.0 / 2) * 1e3;
