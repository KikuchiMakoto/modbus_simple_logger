export type SettlingConfig = {
	tolerance: number;
	windowSeconds: number;
	cutoffFrequency: number;
};

export class SettlingDetector {
	private alpha: number;
	private filtered = 0;
	private initialized = false;
	private buffer: number[] = [];
	private bufferSize: number;
	private consecutiveStable = 0;
	private consecutiveRequired: number;
	private tolerance: number;

	constructor(config: SettlingConfig, samplingIntervalMs = 200) {
		const samplingInterval = samplingIntervalMs / 1000;
		this.alpha =
			1 - Math.exp(-2 * Math.PI * config.cutoffFrequency * samplingInterval);
		this.tolerance = config.tolerance;
		this.bufferSize = Math.ceil(config.windowSeconds / samplingInterval);
		this.consecutiveRequired = this.bufferSize;
	}

	update(raw: number): { filtered: number; stable: boolean; range: number } {
		let filtered: number;
		if (!this.initialized) {
			filtered = raw;
			this.initialized = true;
		} else {
			filtered = this.alpha * raw + (1 - this.alpha) * this.filtered;
		}
		this.filtered = filtered;

		this.buffer.push(filtered);
		if (this.buffer.length > this.bufferSize) {
			this.buffer.shift();
		}

		let range = 0;
		if (this.buffer.length >= 2) {
			let min = this.buffer[0];
			let max = this.buffer[0];
			for (let i = 1; i < this.buffer.length; i++) {
				if (this.buffer[i] < min) min = this.buffer[i];
				if (this.buffer[i] > max) max = this.buffer[i];
			}
			range = max - min;
		}

		if (this.buffer.length >= this.bufferSize && range <= this.tolerance) {
			this.consecutiveStable++;
			if (this.consecutiveStable >= this.consecutiveRequired) {
				return { filtered, stable: true, range };
			}
		} else {
			this.consecutiveStable = 0;
		}

		return { filtered, stable: false, range };
	}

	reset(): void {
		this.filtered = 0;
		this.initialized = false;
		this.buffer = [];
		this.consecutiveStable = 0;
	}
}
