export type AiCalibration = {
  a: number;
  b: number;
  c: number;
};

export type AoCalibration = {
  a: number;
  b: number;
};

export type AiChannel = {
  id: number;
  raw: number;
  phy: number;
  label: string;
};

export type AoChannel = {
  id: number;
  raw: number;
  phy: number;
  label: string;
};

export type PollingRateOption = {
  label: string;
  valueMs: number;
};

export type DataPoint = {
  timestamp: number;
  ai: number[];
  ao: number[];
};

export type SerialParity = 'none' | 'odd' | 'even';

export type SerialSettings = {
  baudRate: number;
  dataBits: 7 | 8;
  stopBits: 1 | 2;
  parity: SerialParity;
};
