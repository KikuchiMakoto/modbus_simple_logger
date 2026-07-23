export type PollingRateOption = {
	label: string;
	valueMs: number;
};

export type SerialParity = "none" | "odd" | "even";

export type SerialSettings = {
	baudRate: number;
	dataBits: 7 | 8;
	stopBits: 1 | 2;
	parity: SerialParity;
};

export type ModbusPrecision = "normal" | "extended";

// ── Calibrator-specific types ──

export type CalibrationDegree = 1 | 2;

export type CalibrationPoint = {
	x: number;
	y: number;
	timestamp: number;
};

export type CalibrationResult = {
	ch: number;
	mode: "1port" | "2port";
	degree: CalibrationDegree;
	a0: number;
	a1: number;
	a2: number;
	r2: number;
	rmse: number;
	n: number;
	points: CalibrationPoint[];
	refCh?: number;
	refCoeffs?: ReferenceSensorCoeffs;
	updatedAt: number;
	label?: string;
};

export type ReferenceSensorCoeffs = {
	degree: CalibrationDegree;
	a0: number;
	a1: number;
	a2: number;
};

export type ChannelLiveState = {
	raw: number;
	filtered: number;
	voltage: number;
	physical: number;
	stable: boolean;
	range: number;
	hasReceived: boolean;
};

export type XUnit = "raw" | "mv_per_v" | "micro_strain";

export type CalibrationMode = "1port" | "2port";

export type AppSettings = {
	mode: CalibrationMode;
	targetCh: number;
	refCh: number;
	degree: CalibrationDegree;
	settling: {
		tolerance: number;
		windowSeconds: number;
		cutoffFrequency: number;
	};
	serial: SerialSettings;
	slaveId: number;
	modbusPrecision: "normal" | "extended";
	theme: "light" | "dark";
};
